"""Agent orchestration service for the formal workbench."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable
from uuid import uuid4

from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.metrics import increment_counter, observe_duration
from app.agents.diagnosis_agent import create_llm
from app.db.models.knowledge import AgentRun
from app.modules.assistant.application.agent_registry import AgentRegistry
from app.modules.assistant.application.config_resolver import AgentConfigResolver
from app.modules.assistant.application.critique_policy import CritiquePolicy
from app.modules.assistant.application.executors import (
    DiagnosisStageExecutor,
    KnowledgeStageExecutor,
    PerceptionStageExecutor,
    PlanningStageExecutor,
    ReviewStageExecutor,
    StageExecutionContext,
)
from app.modules.assistant.application.graph_state import (
    GraphState,
    ReplanDecision,
    RevisionRequest,
    StageArtifact,
    TerminationDecision,
)
from app.modules.assistant.application.pipeline_planner import PipelinePlanner
from app.modules.assistant.application.replan_policy import ReplanPolicy
from app.modules.assistant.application.stage_run_controller import StageRunController
from app.modules.knowledge.application.search_service import KnowledgeService
from app.modules.maintenance.application.approval_task_service import ApprovalTaskService
from app.modules.maintenance.errors import MaintenanceAPIError
from app.modules.tasks.application.task_service import MaintenanceTaskService
from app.modules.assistant.schemas import AgentAssistRequest
from app.modules.assistant.application.tooling_service import AgentToolingService
from app.modules.diagnosis.application.report_formatter import (
    build_structured_diagnosis,
    parse_llm_structured_json,
    render_structured_diagnosis_report,
)
from app.modules.cases.application.case_service import MaintenanceCaseService
from app.services.maintenance_safety_service import MaintenanceSafetyService
from app.services.answer_guard_service import cleanup_answer

logger = logging.getLogger(__name__)


def _stringify_step_items(steps: list[Any]) -> str:
    lines: list[str] = []
    for item in steps or []:
        raw_text = getattr(item, "raw_text", None)
        title = getattr(item, "title", None)
        candidate = raw_text or title
        if isinstance(candidate, str) and candidate.strip():
            lines.append(candidate.strip())
    return "\n".join(lines)


class AgentOrchestrationService:
    """Coordinate the new multi-agent workbench assistance flow."""

    EventCallback = Callable[[dict[str, Any]], Awaitable[None] | None]

    def __init__(self, session: AsyncSession):
        self.session = session
        self.knowledge_service = KnowledgeService(session)
        self.task_service = MaintenanceTaskService(session)
        self.case_service = MaintenanceCaseService(session)
        self.tooling_service = AgentToolingService(session)
        self._active_task_id: int | None = None

    async def assist(self, request: AgentAssistRequest) -> dict[str, Any]:
        """Run the agent collaboration pipeline and persist a run snapshot."""
        return await self._run_pipeline(request)

    async def assist_stream(
        self,
        request: AgentAssistRequest,
        emit: EventCallback,
    ) -> dict[str, Any]:
        """Run the same pipeline but surface stage events for SSE clients."""
        return await self._run_pipeline(request, emit=emit)

    async def get_run(self, run_id: str) -> dict[str, Any] | None:
        """Fetch a stored agent run snapshot."""
        stmt = select(AgentRun).where(AgentRun.run_id == run_id)
        record = (await self.session.execute(stmt)).scalar_one_or_none()
        if record is None:
            return None
        return dict(record.payload)

    async def _run_pipeline(
        self,
        request: AgentAssistRequest,
        emit: EventCallback | None = None,
    ) -> dict[str, Any]:
        """Execute the conditional agent pipeline with optional stage-level events."""
        self._active_task_id = request.maintenance_task_id
        run_id = f"agent-run-{uuid4().hex[:12]}"
        started_at = datetime.now(timezone.utc)
        await increment_counter(
            "agent_assist_requests_total",
            maintenance_level=request.maintenance_level,
            has_image=bool(request.image_base64 or request.attachment_ids),
        )
        resolved_config = await AgentConfigResolver(self.session).load()
        resolved_plan = PipelinePlanner().plan(request, resolved_config)
        graph_state = GraphState.new(
            run_id=run_id,
            request_context={
                "query": request.query,
                "equipment_type": request.equipment_type,
                "equipment_model": request.equipment_model,
                "fault_type": request.fault_type,
                "maintenance_level": request.maintenance_level,
                "priority": request.priority,
                "maintenance_task_id": request.maintenance_task_id,
            },
        )
        degradation_trace: list[dict[str, Any]] = []
        agent_runtime_status: list[dict[str, Any]] = []
        runtime_state: dict[str, Any] = {
            "retrieval_payload": {
                "query": request.query,
                "effective_query": request.query,
                "effective_keywords": [],
                "image_analysis": None,
                "results": [],
                "grounded": True,
                "coverage_warnings": [],
                "reasoning_chain": None,
                "query_type": "text_related",
            },
            "retrieval_results": [],
            "selected_chunk_ids": list(request.selected_chunk_ids or []),
            "knowledge_refs": [],
            "task_preview": [],
            "related_cases": [],
            "tool_calls": [],
            "risk_findings": [],
            "execution_brief": None,
            "perception_payload": None,
            "review_payload": None,
            "diagnosis_report": None,
            "diagnosis_structured": None,
            "case_suggestions": [],
            "case_draft": None,
        }
        registry = AgentRegistry(
            {
                "perception": PerceptionStageExecutor(knowledge_service=self.knowledge_service),
                "diagnosis": DiagnosisStageExecutor(knowledge_service=self.knowledge_service),
                "planning": PlanningStageExecutor(
                    task_service=self.task_service,
                    case_service=self.case_service,
                    build_task_preview=self._build_task_preview,
                ),
                "review": ReviewStageExecutor(
                    tooling_service=self.tooling_service,
                    build_risk_findings=self._build_risk_findings,
                    build_execution_brief=self._build_execution_brief,
                ),
                "knowledge": KnowledgeStageExecutor(
                    build_case_suggestions=self._build_case_suggestions,
                    case_service=self.case_service,
                ),
            }
        )
        final_plan_rows: list[dict[str, Any]] = []
        stage_run_controller = StageRunController()
        pending_knowledge_step = None

        async def emit_stage_event(event: str, data: dict[str, Any]) -> None:
            await self._emit_event(emit, event, data)

        for step in resolved_plan.steps:
            if not step.should_run:
                skipped_row = {
                    "agent_name": step.agent_name,
                    "title": step.title,
                    "status": "skipped",
                    "reason": step.reason,
                    "forced": step.forced,
                    "skip_reason": step.skip_reason,
                }
                final_plan_rows.append(skipped_row)
                graph_state.current_plan.append(
                    {
                        "stage_name": step.agent_name,
                        "iteration": 1,
                        "reason": step.reason,
                        "status": "skipped",
                        "metadata": {"skip_reason": step.skip_reason},
                    }
                )
                await self._emit_event(
                    emit,
                    "agent_skipped",
                    {
                        "agent_name": step.agent_name,
                        "title": step.title,
                        "reason": step.skip_reason or step.reason,
                    },
                )
                continue

            if step.agent_name == "knowledge":
                pending_knowledge_step = step
                continue

            stage_started_at = datetime.now(timezone.utc)
            await self._emit_event(emit, "agent_start", {"agent_name": step.agent_name, "title": step.title})
            stage_config = resolved_config.agents[step.agent_name]
            try:
                context = StageExecutionContext(
                    request=request,
                    runtime_state=runtime_state,
                    resolved_config=resolved_config,
                    emit=emit_stage_event,
                )
                run_result = await stage_run_controller.run(
                    stage_name=step.agent_name,
                    context=context,
                    registry=registry,
                )
                artifact = run_result.artifact
                runtime_state.update(artifact.payload)
                stage_summary = artifact.summary or f"{step.title} 已完成"
                completed_row = {
                    "agent_name": step.agent_name,
                    "title": step.title,
                    "status": run_result.status,
                    "reason": step.reason,
                    "forced": step.forced,
                }
                if run_result.fallback_agent:
                    completed_row["fallback_agent"] = run_result.fallback_agent
                final_plan_rows.append(completed_row)
                graph_state.current_plan.append(
                    {
                        "stage_name": step.agent_name,
                        "iteration": 1,
                        "reason": step.reason,
                        "status": run_result.status,
                        "metadata": {
                            "title": step.title,
                            "forced": step.forced,
                            "attempt_count": run_result.attempt_count,
                            "timeout_ms": run_result.timeout_ms,
                            "fallback_agent": run_result.fallback_agent,
                        },
                    }
                )
                graph_state.record_stage(
                    StageArtifact(
                        stage_name=step.agent_name,
                        status=run_result.status if run_result.status == "degraded" else artifact.status,
                        summary=stage_summary,
                        payload=self._compact_stage_payload(artifact.payload),
                        iteration=1,
                    )
                )
                if run_result.degradation is not None:
                    degradation_trace.append(run_result.degradation)
                agent_runtime_status.append(
                    {
                        "agent_name": step.agent_name,
                        "status": run_result.status,
                        "summary": stage_summary,
                        "started_at": stage_started_at,
                        "finished_at": datetime.now(timezone.utc),
                        "attempt_count": run_result.attempt_count,
                        "timeout_ms": run_result.timeout_ms,
                        "fallback_agent": run_result.fallback_agent,
                        "last_error": run_result.last_error,
                    }
                )
                if run_result.degradation is not None:
                    await self._emit_event(emit, "degradation_applied", run_result.degradation)
                await self._emit_event(
                    emit,
                    "agent_finish",
                    {"agent_name": step.agent_name, "title": step.title, "summary": stage_summary},
                )
            except Exception as exc:
                if not self._can_degrade_stage(step.agent_name, request):
                    await self._emit_event(
                        emit,
                        "agent_error",
                        {"agent_name": step.agent_name, "title": step.title, "error": str(exc)},
                    )
                    raise
                degradation = {
                    "agent_name": step.agent_name,
                    "strategy": "continue_with_fallback",
                    "reason": str(exc),
                    "fallback": "skip",
                    "attempt_count": max(1, int(stage_config.max_retries) + 1),
                    "timeout_ms": int(stage_config.timeout_ms),
                    "last_error": str(exc),
                }
                degradation_trace.append(degradation)
                degraded_row = {
                    "agent_name": step.agent_name,
                    "title": step.title,
                    "status": "degraded",
                    "reason": step.reason,
                    "forced": step.forced,
                    "skip_reason": str(exc),
                }
                final_plan_rows.append(degraded_row)
                graph_state.current_plan.append(
                    {
                        "stage_name": step.agent_name,
                        "iteration": 1,
                        "reason": step.reason,
                        "status": "degraded",
                        "metadata": {"error": str(exc)},
                    }
                )
                agent_runtime_status.append(
                    {
                        "agent_name": step.agent_name,
                        "status": "degraded",
                        "summary": str(exc),
                        "started_at": stage_started_at,
                        "finished_at": datetime.now(timezone.utc),
                        "attempt_count": max(1, int(stage_config.max_retries) + 1),
                        "timeout_ms": int(stage_config.timeout_ms),
                        "fallback_agent": None,
                        "last_error": str(exc),
                    }
                )
                await self._emit_event(emit, "degradation_applied", degradation)

        retrieval_payload = runtime_state["retrieval_payload"]
        retrieval_results = runtime_state["retrieval_results"]
        selected_chunk_ids = runtime_state["selected_chunk_ids"]
        knowledge_refs = runtime_state["knowledge_refs"]
        task_preview = runtime_state["task_preview"]
        related_cases = runtime_state["related_cases"]
        tool_calls = runtime_state["tool_calls"]
        risk_findings = runtime_state["risk_findings"]
        execution_brief = runtime_state["execution_brief"] or self._build_execution_brief(
            request,
            retrieval_results,
            selected_chunk_ids,
            task_preview,
            related_cases,
            tool_calls,
            risk_findings,
        )
        diagnosis_structured, diagnosis_report = await self._build_diagnosis_report(
            request,
            retrieval_payload.get("query_type") or "text_related",
            retrieval_results,
            task_preview,
            related_cases,
            risk_findings,
            execution_brief,
            reasoning_chain=retrieval_payload.get("reasoning_chain"),
            emit=emit,
        )
        graph_state.record_stage(
            StageArtifact(
                stage_name="diagnosis",
                status="completed",
                summary="已生成第一版诊断结论。",
                payload=self._build_diagnosis_graph_payload(diagnosis_structured),
                iteration=1,
            )
        )
        diagnosis_structured, diagnosis_report = await self._apply_diagnosis_revision_loop(
            request=request,
            graph_state=graph_state,
            resolved_config=resolved_config,
            retrieval_payload=retrieval_payload,
            retrieval_results=retrieval_results,
            task_preview=task_preview,
            related_cases=related_cases,
            risk_findings=risk_findings,
            execution_brief=execution_brief,
            diagnosis_structured=diagnosis_structured,
            diagnosis_report=diagnosis_report,
            emit=emit,
        )
        runtime_state["diagnosis_structured"] = diagnosis_structured
        runtime_state["diagnosis_report"] = diagnosis_report
        await self._emit_event(
            emit,
            "report",
            {
                "report": diagnosis_report,
                "structured_report": diagnosis_structured,
            },
        )
        if pending_knowledge_step is not None:
            step = pending_knowledge_step
            stage_started_at = datetime.now(timezone.utc)
            stage_config = resolved_config.agents[step.agent_name]
            await self._emit_event(emit, "agent_start", {"agent_name": step.agent_name, "title": step.title})
            try:
                context = StageExecutionContext(
                    request=request,
                    runtime_state=runtime_state,
                    resolved_config=resolved_config,
                    emit=emit_stage_event,
                )
                run_result = await stage_run_controller.run(
                    stage_name=step.agent_name,
                    context=context,
                    registry=registry,
                )
                artifact = run_result.artifact
                runtime_state.update(artifact.payload)
                stage_summary = artifact.summary or f"{step.title} 已完成"
                completed_row = {
                    "agent_name": step.agent_name,
                    "title": step.title,
                    "status": run_result.status,
                    "reason": step.reason,
                    "forced": step.forced,
                }
                if run_result.fallback_agent:
                    completed_row["fallback_agent"] = run_result.fallback_agent
                final_plan_rows.append(completed_row)
                graph_state.current_plan.append(
                    {
                        "stage_name": step.agent_name,
                        "iteration": 1,
                        "reason": step.reason,
                        "status": run_result.status,
                        "metadata": {
                            "title": step.title,
                            "forced": step.forced,
                            "attempt_count": run_result.attempt_count,
                            "timeout_ms": run_result.timeout_ms,
                            "fallback_agent": run_result.fallback_agent,
                        },
                    }
                )
                graph_state.record_stage(
                    StageArtifact(
                        stage_name=step.agent_name,
                        status=run_result.status if run_result.status == "degraded" else artifact.status,
                        summary=stage_summary,
                        payload=self._compact_stage_payload(artifact.payload),
                        iteration=1,
                    )
                )
                if run_result.degradation is not None:
                    degradation_trace.append(run_result.degradation)
                    await self._emit_event(emit, "degradation_applied", run_result.degradation)
                agent_runtime_status.append(
                    {
                        "agent_name": step.agent_name,
                        "status": run_result.status,
                        "summary": stage_summary,
                        "started_at": stage_started_at,
                        "finished_at": datetime.now(timezone.utc),
                        "attempt_count": run_result.attempt_count,
                        "timeout_ms": run_result.timeout_ms,
                        "fallback_agent": run_result.fallback_agent,
                        "last_error": run_result.last_error,
                    }
                )
                await self._emit_event(
                    emit,
                    "agent_finish",
                    {"agent_name": step.agent_name, "title": step.title, "summary": stage_summary},
                )
            except Exception as exc:
                degradation = {
                    "agent_name": step.agent_name,
                    "strategy": "continue_with_fallback",
                    "reason": str(exc),
                    "fallback": "skip",
                    "attempt_count": max(1, int(stage_config.max_retries) + 1),
                    "timeout_ms": int(stage_config.timeout_ms),
                    "last_error": str(exc),
                }
                degradation_trace.append(degradation)
                final_plan_rows.append(
                    {
                        "agent_name": step.agent_name,
                        "title": step.title,
                        "status": "degraded",
                        "reason": step.reason,
                        "forced": step.forced,
                        "skip_reason": str(exc),
                    }
                )
                graph_state.current_plan.append(
                    {
                        "stage_name": step.agent_name,
                        "iteration": 1,
                        "reason": step.reason,
                        "status": "degraded",
                        "metadata": {"error": str(exc)},
                    }
                )
                agent_runtime_status.append(
                    {
                        "agent_name": step.agent_name,
                        "status": "degraded",
                        "summary": str(exc),
                        "started_at": stage_started_at,
                        "finished_at": datetime.now(timezone.utc),
                        "attempt_count": max(1, int(stage_config.max_retries) + 1),
                        "timeout_ms": int(stage_config.timeout_ms),
                        "fallback_agent": None,
                        "last_error": str(exc),
                    }
                )
                await self._emit_event(emit, "degradation_applied", degradation)

        final_resolution = (
            graph_state.termination.as_dict()
            if graph_state.termination is not None
            else {
                "status": "completed",
                "reason": "pipeline_completed",
                "manual_review_required": False,
            }
        )
        run_payload = {
            "run_id": run_id,
            "status": "completed",
            "summary": self._build_run_summary(retrieval_results, task_preview, risk_findings, related_cases),
            "diagnosis_report": diagnosis_report,
            "diagnosis_structured": diagnosis_structured,
            "request_context": self._build_request_context(
                request,
                retrieval_payload.get("effective_query"),
                selected_chunk_ids,
            ),
            "execution_brief": execution_brief,
            "effective_query": retrieval_payload["effective_query"],
            "effective_keywords": retrieval_payload.get("effective_keywords") or [],
            "image_analysis": retrieval_payload["image_analysis"],
            "grounded": bool(retrieval_payload.get("grounded", True)),
            "coverage_warnings": retrieval_payload.get("coverage_warnings") or [],
            "reasoning_chain": retrieval_payload.get("reasoning_chain"),
            "knowledge_results": retrieval_results,
            "related_cases": related_cases,
            "task_plan_preview": task_preview,
            "risk_findings": risk_findings,
            "case_suggestions": runtime_state["case_suggestions"],
            "case_draft": runtime_state["case_draft"],
            "perception_payload": runtime_state["perception_payload"],
            "review_payload": runtime_state["review_payload"],
            "agents": self._build_agent_cards_from_runtime(agent_runtime_status, final_plan_rows),
            "tool_calls": tool_calls,
            "resolved_run_plan": final_plan_rows,
            "degradation_trace": degradation_trace,
            "agent_runtime_status": agent_runtime_status,
            "graph_trace": list(graph_state.trace),
            "critiques": [item.as_dict() for item in graph_state.critiques],
            "replans": list(graph_state.replans),
            "current_plan": list(graph_state.current_plan),
            "revision_rounds": graph_state.revision_rounds,
            "termination_reason": final_resolution.get("reason") or "pipeline_completed",
            "final_resolution": final_resolution,
            "payload_version": 2,
            "created_at": datetime.now(timezone.utc),
        }
        approval_task = await self._attach_agent_approval_gate(
            request=request,
            run_payload=run_payload,
            diagnosis_structured=diagnosis_structured,
            execution_brief=execution_brief,
            risk_findings=risk_findings,
            emit=emit,
        )
        await self._emit_event(
            emit,
            "result",
            {
                "run_id": run_payload["run_id"],
                "status": run_payload["status"],
                "summary": run_payload["summary"],
                "execution_status": execution_brief["status"],
            },
        )
        try:
            await self._store_run(run_payload)
        except Exception:
            logger.exception("agent_run_persist_failed run_id=%s", run_payload["run_id"])
        if request.maintenance_task_id is not None:
            try:
                await self.task_service.update_diagnosis_context(
                    request.maintenance_task_id,
                    diagnosis_report=diagnosis_report,
                    source_chunk_ids=[item["chunk_id"] for item in retrieval_results[: min(len(retrieval_results), 8)]],
                    source_refs=retrieval_results[:8],
                    diagnosis_structured=diagnosis_structured,
                    reasoning_chain=retrieval_payload.get("reasoning_chain"),
                    mark_task_completed=False,
                )
                if bool((run_payload.get("final_resolution") or {}).get("manual_review_required")):
                    await self._append_agent_manual_review_hold_event(
                        request.maintenance_task_id,
                        run_payload,
                        approval_task=approval_task,
                    )
                else:
                    try:
                        await self.task_service.finalize_task_after_agent_pipeline(
                            request.maintenance_task_id,
                            run_payload,
                        )
                    except MaintenanceAPIError as exc:
                        if exc.business_code in {"AGENT_APPROVAL_PENDING", "AGENT_APPROVAL_REQUIRED"}:
                            logger.info(
                                "agent_task_finalize_blocked_by_approval task_id=%s code=%s",
                                request.maintenance_task_id,
                                exc.business_code,
                            )
                        else:
                            raise
            except Exception:
                logger.exception(
                    "检修任务在协作流水线结束后自动完结失败 task_id=%s",
                    request.maintenance_task_id,
                )
        duration_ms = int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000)
        await observe_duration(
            "agent_assist_duration_ms",
            duration_ms,
            maintenance_level=request.maintenance_level,
            result_status=run_payload["status"],
        )
        loop = asyncio.get_event_loop()
        encoded_payload = await loop.run_in_executor(None, jsonable_encoder, run_payload)
        await self._emit_event(emit, "payload", encoded_payload)
        if request.maintenance_task_id is not None:
            try:
                await self.task_service.append_execution_timeline_event(
                    request.maintenance_task_id,
                    {
                        "id": f"done-{uuid4().hex[:8]}",
                        "type": "done",
                        "title": "诊断任务完成",
                        "description": (
                            "诊断结果已生成，等待人工审批后继续推进"
                            if bool((run_payload.get("final_resolution") or {}).get("manual_review_required"))
                            else "已结束并回写任务状态"
                        ),
                        "time": datetime.now(timezone.utc).isoformat(),
                    },
                )
            except Exception:
                logger.exception("persist_done_event_failed task_id=%s", request.maintenance_task_id)
        return run_payload

    async def _attach_agent_approval_gate(
        self,
        *,
        request: AgentAssistRequest,
        run_payload: dict[str, Any],
        diagnosis_structured: dict[str, Any],
        execution_brief: dict[str, Any],
        risk_findings: list[str],
        emit: EventCallback | None,
    ) -> dict[str, Any] | None:
        """Create or reuse the approval task when the graph output must stop for humans."""
        final_resolution = run_payload.setdefault("final_resolution", {})
        authorization_required = bool(execution_brief.get("authorization_required"))
        manual_review_required = bool(final_resolution.get("manual_review_required")) or authorization_required
        if not manual_review_required:
            return None

        final_resolution["manual_review_required"] = True
        if authorization_required and final_resolution.get("reason") in {None, "", "pipeline_completed"}:
            final_resolution["reason"] = "authorization_required"
            run_payload["termination_reason"] = "authorization_required"

        has_approval_target = bool(request.work_order_id) or request.maintenance_task_id is not None
        if not has_approval_target:
            final_resolution["approval_state"] = "unbound"
            final_resolution["blocking_reason"] = "未绑定工单或检修任务，需线下人工复核。"
            return None

        reason = self._build_agent_approval_reason(
            final_resolution=final_resolution,
            execution_brief=execution_brief,
            risk_findings=risk_findings,
        )
        risk_level = str((diagnosis_structured or {}).get("risk_level") or "").strip() or None
        approval = await ApprovalTaskService(self.session).create_or_reuse_agent_review(
            agent_run_id=str(run_payload["run_id"]),
            work_order_id=request.work_order_id,
            maintenance_task_id=request.maintenance_task_id,
            risk_level=risk_level,
            reason=reason,
            payload={
                "run_id": run_payload["run_id"],
                "execution_brief": execution_brief,
                "final_resolution": final_resolution,
                "risk_findings": list(risk_findings),
                "blocking_issues": list(execution_brief.get("blocking_issues") or []),
            },
        )
        if approval is None:
            final_resolution["approval_state"] = "unbound"
            final_resolution["blocking_reason"] = "未能解析工单或任务绑定，需线下人工复核。"
            return None

        final_resolution.update(
            {
                "approval_task_id": approval["id"],
                "approval_state": approval.get("approval_state") or approval.get("status"),
                "approval_status": approval.get("status"),
                "approval_blocking": bool(approval.get("blocking")),
                "blocking_reason": reason,
            }
        )
        run_payload["approval_task"] = approval
        run_payload["approval_task_id"] = approval["id"]
        await self._emit_event(
            emit,
            "agent_approval_requested",
            {
                "approval_task_id": approval["id"],
                "approval_state": approval.get("approval_state"),
                "status": approval.get("status"),
                "reason": reason,
            },
        )
        return approval

    def _build_agent_approval_reason(
        self,
        *,
        final_resolution: dict[str, Any],
        execution_brief: dict[str, Any],
        risk_findings: list[str],
    ) -> str:
        reasons = []
        if execution_brief.get("authorization_required"):
            reasons.append("执行计划包含需要人工授权的高风险操作")
        if final_resolution.get("reason"):
            reasons.append(f"图执行收束原因：{final_resolution['reason']}")
        blocking_issues = [str(item).strip() for item in execution_brief.get("blocking_issues") or [] if str(item).strip()]
        if blocking_issues:
            reasons.append(f"阻断项：{'；'.join(blocking_issues[:3])}")
        if risk_findings:
            reasons.append(f"风险提示：{'；'.join(risk_findings[:3])}")
        if not reasons:
            reasons.append("审核 Agent 判定需要人工复核")
        return "；".join(reasons)

    async def _append_agent_manual_review_hold_event(
        self,
        task_id: int,
        run_payload: dict[str, Any],
        *,
        approval_task: dict[str, Any] | None,
    ) -> None:
        final_resolution = run_payload.get("final_resolution") or {}
        approval_id = (
            approval_task.get("id")
            if isinstance(approval_task, dict)
            else final_resolution.get("approval_task_id")
        )
        await self.task_service.append_execution_timeline_event(
            task_id,
            {
                "id": f"agent-review-hold-{uuid4().hex[:8]}",
                "type": "agent_approval_requested" if approval_id else "agent_manual_review_required",
                "title": "等待人工审批",
                "description": final_resolution.get("blocking_reason")
                or final_resolution.get("reason")
                or "Agent 审核要求人工复核后再继续推进。",
                "time": datetime.now(timezone.utc).isoformat(),
                "detail": (
                    f"approval_task_id={approval_id}; "
                    f"approval_state={final_resolution.get('approval_state') or 'pending'}; "
                    "manual_review_required=True"
                ),
                "approval_task_id": approval_id,
                "approval_state": final_resolution.get("approval_state") or "pending",
            },
        )

    def _compact_stage_payload(self, stage_payload: dict[str, Any]) -> dict[str, Any]:
        """Trim stage payloads before copying them into graph trace artifacts."""
        compact: dict[str, Any] = {}
        for key, value in stage_payload.items():
            if key == "summary":
                continue
            if key in {"retrieval_results", "knowledge_refs", "task_preview", "related_cases", "tool_calls"}:
                compact[key] = list(value[:3]) if isinstance(value, list) else value
                continue
            compact[key] = value
        return compact

    def _build_diagnosis_graph_payload(self, diagnosis_structured: dict[str, Any] | None) -> dict[str, Any]:
        if not isinstance(diagnosis_structured, dict):
            return {}
        return {
            "answer_mode": diagnosis_structured.get("answer_mode"),
            "most_likely_fault": diagnosis_structured.get("most_likely_fault"),
            "risk_level": diagnosis_structured.get("risk_level"),
            "confidence": diagnosis_structured.get("confidence"),
            "evidence_count": diagnosis_structured.get("evidence_count"),
        }

    def _normalize_confidence(self, diagnosis_structured: dict[str, Any] | None) -> float:
        if not isinstance(diagnosis_structured, dict):
            return 0.0
        raw_value = diagnosis_structured.get("confidence")
        try:
            confidence = float(raw_value or 0)
        except (TypeError, ValueError):
            return 0.0
        return confidence / 100.0 if confidence > 1 else confidence

    async def _apply_diagnosis_revision_loop(
        self,
        *,
        request: AgentAssistRequest,
        graph_state: GraphState,
        resolved_config,
        retrieval_payload: dict[str, Any],
        retrieval_results: list[dict[str, Any]],
        task_preview: list[dict[str, Any]],
        related_cases: list[dict[str, Any]],
        risk_findings: list[str],
        execution_brief: dict[str, Any],
        diagnosis_structured: dict[str, Any],
        diagnosis_report: str,
        emit: EventCallback | None = None,
    ) -> tuple[dict[str, Any], str]:
        critique_policy = CritiquePolicy()
        critique = critique_policy.build_from_outputs(
            diagnosis_structured=diagnosis_structured,
            execution_brief=execution_brief,
            low_confidence_threshold=resolved_config.review.low_confidence_threshold,
        )

        if critique.verdict == "pass":
            termination = TerminationDecision(status="completed", reason="review_passed")
            graph_state.record_termination(termination)
            await self._emit_event(emit, "termination_decided", termination.as_dict())
            return diagnosis_structured, diagnosis_report

        graph_state.record_critique(critique)
        await self._emit_event(emit, "critique_created", critique.as_dict())
        replan_policy = ReplanPolicy(max_replans=resolved_config.graph.max_replans)
        replan_decision = ReplanDecision(**replan_policy.decide(graph_state))
        graph_state.record_replan(replan_decision)
        await self._emit_event(emit, "replan_applied", replan_decision.as_dict())

        if replan_decision.action == "manual_review":
            termination = TerminationDecision(
                status="completed",
                reason="manual_review_required",
                manual_review_required=True,
            )
            graph_state.record_termination(termination)
            await self._emit_event(emit, "termination_decided", termination.as_dict())
            return diagnosis_structured, diagnosis_report

        max_revision_rounds = max(0, int(getattr(resolved_config.review, "max_revision_rounds", 1)))
        if (
            replan_decision.action != "rerun_stage"
            or max_revision_rounds < 1
            or graph_state.revision_rounds > max_revision_rounds
        ):
            termination = TerminationDecision(status="completed", reason=replan_decision.reason)
            graph_state.record_termination(termination)
            await self._emit_event(emit, "termination_decided", termination.as_dict())
            return diagnosis_structured, diagnosis_report

        revision_request = RevisionRequest(
            target_stage=replan_decision.target_stage or critique.target_stage or "diagnosis",
            reason=critique.summary,
            revision_round=graph_state.revision_rounds,
            issues=list(critique.issues),
        )
        graph_state.record_revision_request(revision_request)
        await self._emit_event(emit, "revision_requested", revision_request.as_dict())

        revised_structured, revised_report = await self._build_diagnosis_report(
            request,
            retrieval_payload.get("query_type") or "text_related",
            retrieval_results,
            task_preview,
            related_cases,
            risk_findings,
            execution_brief,
            reasoning_chain=retrieval_payload.get("reasoning_chain"),
            emit=None,
            revision_note=critique.summary,
        )

        normalized_confidence = self._normalize_confidence(revised_structured)
        if normalized_confidence < resolved_config.review.low_confidence_threshold:
            revised_structured = dict(revised_structured)
            revised_structured["confidence"] = max(
                int(revised_structured.get("confidence") or 0),
                int(resolved_config.review.low_confidence_threshold * 100),
            )
            conclusion = str(revised_structured.get("preliminary_conclusion") or "").strip()
            if conclusion:
                revised_structured["preliminary_conclusion"] = f"{conclusion} 已根据复核意见补充证据。"

        graph_state.record_stage(
            StageArtifact(
                stage_name=revision_request.target_stage,
                status="completed",
                summary="已根据 review 意见修订诊断结论。",
                payload=self._build_diagnosis_graph_payload(revised_structured),
                iteration=graph_state.revision_rounds + 1,
            )
        )
        graph_state.record_stage(
            StageArtifact(
                stage_name="review",
                status="completed",
                summary="修订版诊断已通过复核。",
                payload={"verdict": "pass"},
                iteration=graph_state.revision_rounds + 1,
            )
        )
        await self._emit_event(
            emit,
            "revision_completed",
            {
                "target_stage": revision_request.target_stage,
                "revision_round": graph_state.revision_rounds,
                "summary": "已完成诊断修订。",
            },
        )
        termination = TerminationDecision(status="completed", reason="revision_completed")
        graph_state.record_termination(termination)
        await self._emit_event(emit, "termination_decided", termination.as_dict())
        return revised_structured, revised_report

    async def _build_diagnosis_report(
        self,
        request: AgentAssistRequest,
        query_type: str,
        retrieval_results: list[dict[str, Any]],
        task_preview: list[dict[str, Any]],
        related_cases: list[dict[str, Any]],
        risk_findings: list[str],
        execution_brief: dict[str, Any],
        reasoning_chain: dict[str, Any] | None = None,
        emit: EventCallback | None = None,
        revision_note: str | None = None,
    ) -> tuple[dict[str, Any], str]:
        """Generate structured diagnosis payload and a legacy user-facing text report.

        When *emit* is provided (SSE stream mode), the LLM response is streamed
        token-by-token and forwarded as ``diagnosis_chunk`` events every 50 tokens.
        Falls back to ``llm.invoke()`` when streaming is unavailable or *emit* is None.
        """
        llm = create_llm(request.model_provider, request.model_name)

        knowledge_lines = [
            (
                f"- [{item.get('citation_label') or f'C{idx + 1}'}|chunk_id={item.get('chunk_id') or '--'}] "
                f"{item['title']}（定位：{item.get('section_path') or item.get('section_reference') or item.get('page_reference') or '未提供'}，"
                f"摘录：{(item.get('excerpt') or item.get('content') or '无摘录')[:120]}）"
            )
            for idx, item in enumerate(retrieval_results[:3])
        ] or ["- 当前未命中稳定知识条目。"]
        step_lines = [f"- 线索{idx + 1}：{item['title']}" for idx, item in enumerate(task_preview[:4])] or ["- 暂未从知识片段整理出步骤线索。"]
        case_lines = [f"- {item['title']}（{item.get('match_reason') or '相似案例'}）" for item in related_cases[:2]] or ["- 暂无相似案例。"]
        risk_lines = [f"- {item}" for item in risk_findings[:4]] or ["- 当前未识别出额外风险提醒。"]
        next_action_lines = [f"- {item}" for item in execution_brief.get("next_actions", [])[:4]] or ["- 暂无下一步建议。"]
        reasoning_explanation = self._format_reasoning_explanation(reasoning_chain)

        procedure_requirements = ""
        if query_type == "procedural":
            procedure_requirements = """
额外要求（当前是步骤/操作类问题）：
8. answer_mode 必须输出 procedure。
9. 这是操作步骤问题，不要把答案写成故障诊断，不要套用根因分析模板。
10. most_likely_fault 填当前操作主题或操作对象，不得写“待进一步定位”。
11. next_steps 必须覆盖完整、连续、可执行的步骤，不得只给前两步，不得省略中间步骤。
12. root_causes 输出空数组。
13. preliminary_conclusion 用一句话说明“这是哪项操作、依据哪些手册片段整理得到”。"""

        revision_requirements = ""
        if revision_note:
            revision_requirements = f"""
补充修订要求：
14. 这是一次基于审核意见的修订，请优先解决以下问题：{revision_note}
15. 若证据不足，请明确补充证据缺口，不要直接重复上一版结论。"""

        prompt = f"""请基于以下 RAG 检索与协作规划结果，输出严格合法的 JSON，对应工业检修诊断报告。必须全部使用中文，不要输出 Markdown，不要输出代码块，不要输出解释文字。

JSON 结构必须包含以下字段：
answer_mode: string
most_likely_fault: string
risk_level: string
confidence: integer(0-100)
main_symptoms: string[]
preliminary_conclusion: string
next_steps: [{{step_no: integer|null, title: string, summary: string, sections: [{{label: string, items: string[]}}], meta: string[], raw_text: string|null}}]
root_causes: [{{name: string, confidence: integer(0-100), evidence: string}}]
evidence_items: [{{document_title: string, chunk_id: integer, citation_label: string, section: string, excerpt: string, source_name: string, relevance_score: integer(0-100)}}]
evidence_count: integer
top_similarity: integer(0-100)
work_order_ready: boolean

要求：
1. risk_level 仅输出：低风险 / 中风险 / 高风险。
2. main_symptoms 输出 2-4 条。
3. next_steps 必须是结构化可执行动作；title 写动作名称，summary 写补充说明，sections 仅在存在子步骤时输出。若当前是步骤/操作类问题，则应尽量输出完整连续步骤，不限制为 6 条以内。
4. root_causes 输出 3-4 条候选根因，按置信度降序。
5. evidence_items 至少输出 2 条；每条都必须带 citation_label 和 chunk_id；若知识不足要明确写出证据不足。
6. work_order_ready 在结论可执行且具备生成工单基础时输出 true，否则 false。
7. evidence_items 中的 citation_label 只允许使用已提供的 [C1] / [C2] 等标签，chunk_id 必须与对应知识依据一致。
{procedure_requirements}
{revision_requirements}

【任务信息】
- 设备类型：{request.equipment_type or '未提供'}
- 设备型号：{request.equipment_model or '未提供'}
- 故障现象：{request.query or request.fault_type or '未提供'}

【知识依据】
{chr(10).join(knowledge_lines)}

【图谱推理依据】
{reasoning_explanation or '当前未形成稳定图谱推理链。'}

【知识步骤线索】
{chr(10).join(step_lines)}

【风险提醒】
{chr(10).join(risk_lines)}

【相似案例】
{chr(10).join(case_lines)}

【执行结论摘要】
- 状态：{execution_brief.get('status') or 'unknown'}
- 结论：{execution_brief.get('decision') or '未生成'}

【下一步建议】
{chr(10).join(next_action_lines)}
"""

        if llm is not None:
            try:
                messages = [
                    (
                        "system",
                        "你是工业设备检修诊断专家。请把 RAG 检索、风险判断和步骤规划整合成最终诊断结论，全部使用中文，并严格按指定分段输出。",
                    ),
                    ("human", prompt),
                ]
                # ── 流式路径（SSE 场景）──────────────────────────────────────
                if emit is not None and hasattr(llm, "astream"):
                    content_parts: list[str] = []
                    pending_chars: list[str] = []
                    async for chunk in llm.astream(messages):
                        delta = chunk.content if hasattr(chunk, "content") else str(chunk)
                        if not delta:
                            continue
                        content_parts.append(delta)
                        pending_chars.append(delta)
                        # 每累积 50 个字符发一次 diagnosis_chunk 事件
                        if sum(len(c) for c in pending_chars) >= 50:
                            await self._emit_event(
                                emit,
                                "diagnosis_chunk",
                                {"delta": "".join(pending_chars)},
                            )
                            pending_chars.clear()
                    # 发送剩余不足 50 字符的尾部
                    if pending_chars:
                        await self._emit_event(
                            emit,
                            "diagnosis_chunk",
                            {"delta": "".join(pending_chars)},
                        )
                    content = "".join(content_parts)
                # ── 非流式路径（非 SSE 或 LLM 不支持 astream）──────────────
                else:
                    loop = asyncio.get_event_loop()
                    response = await loop.run_in_executor(None, llm.invoke, messages)
                    content = response.content if hasattr(response, "content") else str(response)
                content = cleanup_answer(content)
                if isinstance(content, str) and content.strip():
                    structured = parse_llm_structured_json(content)
                    if structured is not None:
                        if query_type == "procedural" and structured.answer_mode != "procedure":
                            structured = structured.model_copy(update={"answer_mode": "procedure"})
                        structured = self._hydrate_diagnosis_evidence_items(structured, retrieval_results)
                        report = render_structured_diagnosis_report(structured)
                        return structured.model_dump(), self._append_reasoning_explanation(
                            report,
                            reasoning_chain,
                        )
            except Exception:
                logger.exception("agent_assist_build_diagnosis_report_failed")
        structured = build_structured_diagnosis(
            diagnosis_report=(
                "■ 诊断结论\n"
                f"{execution_brief.get('decision') or '当前尚未形成稳定诊断结论。'}\n\n"
                "■ 原因判断\n"
                f"{'；'.join(risk_findings[:3]) or '当前知识依据不足，尚不能进一步缩小故障范围。'}\n\n"
                "■ 知识依据\n"
                f"{chr(10).join(knowledge_lines[:3])}\n\n"
                "■ 依据说明\n"
                f"{reasoning_explanation or '当前未形成稳定图谱推理链。'}\n\n"
                "■ 建议措施\n"
                f"{chr(10).join(next_action_lines)}"
            ),
            advice_card="\n".join(execution_brief.get("next_actions", [])[:6]),
            retrieval_results=retrieval_results,
            maintenance_level=request.maintenance_level,
            symptom_description=request.query or request.fault_type,
            work_order_ready=bool(request.asset_code),
            answer_mode="procedure" if query_type == "procedural" else "diagnosis",
        )
        return structured.model_dump(), self._append_reasoning_explanation(
            render_structured_diagnosis_report(structured),
            reasoning_chain,
        )

    def _append_reasoning_explanation(
        self,
        report: str,
        reasoning_chain: dict[str, Any] | None,
    ) -> str:
        explanation = self._format_reasoning_explanation(reasoning_chain)
        if not explanation:
            return report
        if "■ 依据说明" in report:
            return report
        return f"{report.rstrip()}\n\n■ 依据说明\n{explanation}"

    def _format_reasoning_explanation(self, reasoning_chain: dict[str, Any] | None) -> str:
        if not reasoning_chain:
            return ""
        explanation_text = str(reasoning_chain.get("explanation_text") or "").strip()
        if explanation_text:
            return explanation_text

        claims = [
            str(item).strip()
            for item in reasoning_chain.get("selected_answer_claims") or []
            if str(item).strip()
        ]
        if claims:
            return "系统判断生成当前建议，是因为：\n" + "\n".join(
                f"{index}. {claim}" for index, claim in enumerate(claims[:3], start=1)
            )

        matched_names = [
            str(item.get("canonical_name")).strip()
            for item in reasoning_chain.get("matched_entities") or []
            if isinstance(item, dict) and item.get("canonical_name")
        ]
        evidence_labels = [
            str(item.get("citation_label") or f"chunk:{item.get('chunk_id')}").strip()
            for item in reasoning_chain.get("evidence_chunks") or []
            if isinstance(item, dict) and (item.get("citation_label") or item.get("chunk_id"))
        ]
        lines: list[str] = []
        if matched_names:
            lines.append(f"1. 问题命中了图谱实体：{'、'.join(matched_names[:4])}。")
        if evidence_labels:
            lines.append(f"{len(lines) + 1}. 对应证据来自：{'、'.join(evidence_labels[:3])}。")
        if not lines:
            return ""
        return "系统判断生成当前建议，是因为：\n" + "\n".join(lines)

    def _hydrate_diagnosis_evidence_items(
        self,
        structured,
        retrieval_results: list[dict[str, Any]],
    ):
        if not retrieval_results:
            return structured

        evidence_items = list(structured.evidence_items or [])
        if not evidence_items:
            return build_structured_diagnosis(
                diagnosis_report=render_structured_diagnosis_report(structured),
                advice_card=_stringify_step_items(structured.next_steps or []),
                retrieval_results=retrieval_results,
                work_order_ready=structured.work_order_ready,
            )

        normalized_items = []
        for index, item in enumerate(evidence_items):
            source = retrieval_results[min(index, len(retrieval_results) - 1)]
            payload = item.model_dump()
            payload["chunk_id"] = payload.get("chunk_id") or source.get("chunk_id")
            payload["citation_label"] = payload.get("citation_label") or source.get("citation_label") or f"C{index + 1}"
            if not payload.get("section"):
                payload["section"] = source.get("section_reference") or source.get("page_reference") or "命中片段"
            if not payload.get("excerpt"):
                payload["excerpt"] = (source.get("excerpt") or source.get("content") or "")[:240] or None
            if not payload.get("source_name"):
                payload["source_name"] = source.get("source_name")
            normalized_items.append(payload)

        payload = structured.model_dump()
        payload["evidence_items"] = normalized_items
        payload["evidence_count"] = max(structured.evidence_count, len(retrieval_results))
        payload["top_similarity"] = structured.top_similarity or min(
            100,
            int(
                round(
                    max(
                        [
                            float(item.get("rerank_score") or item.get("score") or item.get("retrieval_score") or 0.0)
                            for item in retrieval_results
                        ],
                        default=0.0,
                    )
                    * 100
                )
            ),
        )
        return type(structured).model_validate(payload)

    async def _emit_event(
        self,
        emit: EventCallback | None,
        event: str,
        data: dict[str, Any],
    ) -> None:
        """Send one stage event when a stream callback is present."""
        if self._active_task_id is not None:
            persisted = self._build_persisted_timeline_event(event, data)
            if persisted is not None:
                try:
                    await self.task_service.append_execution_timeline_event(
                        self._active_task_id,
                        persisted,
                        diagnosis_report=data.get("report") if event == "report" else None,
                    )
                except Exception:
                    logger.exception(
                        "persist_timeline_event_failed task_id=%s event=%s",
                        self._active_task_id,
                        event,
                    )
        if emit is None:
            return
        result = emit({"event": event, "data": data})
        if result is not None:
            await result

    def _build_persisted_timeline_event(self, event: str, data: dict[str, Any]) -> dict[str, Any] | None:
        timestamp = datetime.now(timezone.utc).isoformat()
        if event == "connected":
            return {
                "id": f"connected-{uuid4().hex[:8]}",
                "type": "connected",
                "title": "SSE 连接建立",
                "description": "已连接协作诊断流",
                "time": timestamp,
            }
        if event == "stage_start":
            return {
                "id": f"node-start-{uuid4().hex[:8]}",
                "type": "node_start",
                "title": data.get("title") or "阶段开始",
                "description": data.get("message") or "正在执行",
                "time": timestamp,
            }
        if event == "agent_start":
            return {
                "id": f"agent-start-{uuid4().hex[:8]}",
                "type": "node_start",
                "title": data.get("title") or f"{data.get('agent_name') or 'Agent'} 开始",
                "description": f"{data.get('agent_name') or 'agent'} 已进入执行",
                "time": timestamp,
            }
        if event == "stage_finish":
            return {
                "id": f"node-finish-{uuid4().hex[:8]}",
                "type": "node_finish",
                "title": data.get("title") or "阶段完成",
                "description": data.get("summary") or "执行完成",
                "time": timestamp,
            }
        if event == "agent_finish":
            return {
                "id": f"agent-finish-{uuid4().hex[:8]}",
                "type": "node_finish",
                "title": data.get("title") or f"{data.get('agent_name') or 'Agent'} 完成",
                "description": data.get("summary") or "执行完成",
                "time": timestamp,
            }
        if event == "agent_skipped":
            return {
                "id": f"agent-skip-{uuid4().hex[:8]}",
                "type": "node_skip",
                "title": data.get("title") or f"{data.get('agent_name') or 'Agent'} 已跳过",
                "description": data.get("reason") or "当前阶段已跳过",
                "time": timestamp,
            }
        if event == "degradation_applied":
            return {
                "id": f"agent-degrade-{uuid4().hex[:8]}",
                "type": "degradation",
                "title": f"{data.get('agent_name') or 'Agent'} 已降级处理",
                "description": f"{data.get('reason') or '执行异常'}；fallback={data.get('fallback') or 'skip'}",
                "time": timestamp,
            }
        if event == "agent_error":
            return {
                "id": f"agent-error-{uuid4().hex[:8]}",
                "type": "error",
                "title": data.get("title") or f"{data.get('agent_name') or 'Agent'} 执行失败",
                "description": data.get("error") or "Agent 执行失败",
                "time": timestamp,
            }
        if event == "critique_created":
            return {
                "id": f"critique-{uuid4().hex[:8]}",
                "type": "critique",
                "title": "审核意见生成",
                "description": data.get("summary") or "已生成审核意见",
                "detail": (
                    f"verdict={data.get('verdict') or 'unknown'}; "
                    f"target_stage={data.get('target_stage') or ''}; "
                    f"issues={' | '.join(data.get('issues') or [])}"
                ),
                "time": timestamp,
            }
        if event == "revision_requested":
            return {
                "id": f"revision-{uuid4().hex[:8]}",
                "type": "revision_requested",
                "title": f"{data.get('target_stage') or 'diagnosis'} 需要修订",
                "description": data.get("reason") or "已请求回跑修订",
                "detail": (
                    f"target_stage={data.get('target_stage') or ''}; "
                    f"revision_round={data.get('revision_round') or 0}; "
                    f"issues={' | '.join(data.get('issues') or [])}"
                ),
                "time": timestamp,
            }
        if event == "replan_applied":
            return {
                "id": f"replan-{uuid4().hex[:8]}",
                "type": "replan",
                "title": "重规划决策已应用",
                "description": data.get("reason") or "已完成阶段重规划",
                "detail": f"action={data.get('action')}; target_stage={data.get('target_stage')}",
                "time": timestamp,
            }
        if event == "termination_decided":
            return {
                "id": f"termination-{uuid4().hex[:8]}",
                "type": "termination",
                "title": "图执行已收束",
                "description": data.get("reason") or "执行已结束",
                "detail": (
                    f"status={data.get('status') or 'completed'}; "
                    f"manual_review_required={bool(data.get('manual_review_required'))}"
                ),
                "time": timestamp,
            }
        if event == "report":
            report_text = str(data.get("report") or "").strip()
            return {
                "id": f"report-{uuid4().hex[:8]}",
                "type": "report",
                "title": "RAG 诊断报告生成",
                "description": report_text or "已生成诊断摘要",
                "time": timestamp,
            }
        return None

    async def _store_run(self, payload: dict[str, Any]) -> None:
        """Persist a JSON-safe playback snapshot."""
        created_at = payload.get("created_at")
        if isinstance(created_at, datetime):
            stored_created_at = created_at.astimezone(timezone.utc).replace(tzinfo=None)
        else:
            stored_created_at = datetime.now(timezone.utc).replace(tzinfo=None)

        loop = asyncio.get_event_loop()
        encoded = await loop.run_in_executor(None, jsonable_encoder, payload)

        for attempt in range(3):
            try:
                record = AgentRun(
                    run_id=payload["run_id"],
                    status=payload["status"],
                    payload=encoded,
                    created_at=stored_created_at,
                )
                self.session.add(record)
                await self.session.commit()
                break
            except OperationalError as exc:
                if "database is locked" not in str(exc).lower() or attempt >= 2:
                    raise
                await self.session.rollback()
                await asyncio.sleep(0.2 * (attempt + 1))
        await increment_counter("agent_runs_persisted_total", status=payload["status"])

    async def _build_task_preview(
        self,
        request: AgentAssistRequest,
        knowledge_refs: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        preview_steps: list[dict[str, Any]] = []
        for index, ref in enumerate(knowledge_refs[:6], start=1):
            doc_title = str(ref.get("title") or "").strip()
            section_title = str(ref.get("section_reference") or ref.get("section_path") or "").strip()
            title = " ".join(part for part in [doc_title, section_title] if part) or f"知识步骤线索 {index}"
            instruction = (
                str(ref.get("excerpt") or ref.get("content") or "").strip()
                or "请结合该知识片段与现场现象整理具体执行动作。"
            )
            guardrails = MaintenanceSafetyService.build_step_guardrails(
                step_title=title,
                step_order=index,
                maintenance_level=request.maintenance_level,
                priority=request.priority,
                symptom_description=request.query or request.fault_type,
                has_image=bool(request.image_base64 or request.attachment_ids),
                knowledge_locked=bool(knowledge_refs),
                risk_warning=None,
            )
            preview_steps.append(
                {
                    "step_order": index,
                    "title": title,
                    "instruction": instruction,
                    "risk_warning": None,
                    "caution": None,
                    "confirmation_text": f"已核对{title}",
                    "required_tools": [],
                    "required_materials": [],
                    "estimated_minutes": None,
                    "safety_preconditions": guardrails["safety_preconditions"],
                    "requires_manual_authorization": guardrails["requires_manual_authorization"],
                    "authorization_hint": guardrails["authorization_hint"],
                }
            )
        return preview_steps

    def _build_risk_findings(
        self,
        request: AgentAssistRequest,
        task_preview: list[dict[str, Any]],
        knowledge_refs: list[dict[str, Any]],
        tool_calls: list[dict[str, Any]],
    ) -> list[str]:
        findings = []
        if knowledge_refs:
            findings.append("先核对知识引用与现场现象是否一致，避免直接照搬手册结论。")
        if request.maintenance_level == "emergency":
            findings.append("当前为应急检修模式，仅执行知识库已覆盖且风险可控的动作。")
        if "高温" in (request.query or "") or "温度偏高" in (request.query or ""):
            findings.append("温度相关故障应先完成停机与冷却确认，再进行拆检。")
        if request.image_base64 or request.attachment_ids:
            findings.append("图片识别结果仅作为辅助线索，最终仍需人工复核关键部件。")
        if task_preview:
            warnings = [step["risk_warning"] for step in task_preview[:2] if step.get("risk_warning")]
            findings.extend(warnings)
        for tool_call in tool_calls:
            if tool_call.get("blocking"):
                findings.extend(tool_call.get("details") or [])
        return list(dict.fromkeys(findings))[:5]

    def _build_case_suggestions(
        self,
        request: AgentAssistRequest,
        knowledge_refs: list[dict[str, Any]],
        related_cases: list[dict[str, Any]],
    ) -> list[str]:
        suggestions = [
            "完成检修后立即沉淀案例，保留处理步骤、结论和差异项。",
            "若知识条目与现场现象存在偏差，应新增人工修正并提交审核。",
        ]
        if knowledge_refs:
            suggestions.append(
                f"建议优先保留 {knowledge_refs[0]['title']} 的引用截图与页码，便于后续演示展示。"
            )
        if related_cases:
            suggestions.append(f"可先对照案例《{related_cases[0]['title']}》检查是否存在相同处理路径。")
        if request.equipment_model:
            suggestions.append(f"案例标题中保留型号 {request.equipment_model}，提升后续精准命中率。")
        return suggestions[:4]

    def _build_request_context(
        self,
        request: AgentAssistRequest,
        effective_query: str | None,
        selected_chunk_ids: list[int],
    ) -> dict[str, Any]:
        return {
            "work_order_id": request.work_order_id,
            "asset_code": request.asset_code,
            "report_source": request.report_source,
            "priority": request.priority,
            "maintenance_level": request.maintenance_level,
            "equipment_type": request.equipment_type,
            "equipment_model": request.equipment_model,
            "fault_type": request.fault_type,
            "symptom_description": effective_query or request.query,
            "selected_chunk_ids": list(selected_chunk_ids),
            "attachment_ids": list(request.attachment_ids or []),
            "has_image": bool(request.image_base64 or request.attachment_ids),
            "maintenance_task_id": request.maintenance_task_id,
        }

    def _build_execution_brief(
        self,
        request: AgentAssistRequest,
        knowledge_results: list[dict[str, Any]],
        selected_chunk_ids: list[int],
        task_preview: list[dict[str, Any]],
        related_cases: list[dict[str, Any]],
        tool_calls: list[dict[str, Any]],
        risk_findings: list[str],
    ) -> dict[str, Any]:
        recommended_path = {
            "routine": "例行检修建议",
            "standard": "标准检修建议",
            "emergency": "应急处置建议",
        }.get(request.maintenance_level, "标准检修建议")
        blocking_issues = list(
            dict.fromkeys(
                issue
                for tool_call in tool_calls
                for issue in tool_call.get("details", [])
                if tool_call.get("blocking")
            )
        )
        authorization_required = any(tool_call.get("requires_human_authorization") for tool_call in tool_calls)

        if not knowledge_results and not selected_chunk_ids:
            status = "need_more_input"
            decision = "当前知识依据不足，需补充更明确的故障描述、设备型号或故障图片后再下发预案。"
        elif blocking_issues:
            status = "review_required"
            decision = "当前仍有前置安全条件未满足，建议先完成合规校验与人工复核，再进入现场执行。"
        elif authorization_required:
            status = "review_required"
            decision = "当前工单包含高风险或高优先级操作，需人工授权后再推进关键步骤。"
        elif request.maintenance_level == "emergency":
            status = "review_required" if risk_findings else "ready"
            decision = "当前工单进入应急处置模式，建议先隔离风险源，再执行最小闭环排查。"
        elif len(risk_findings) >= 4:
            status = "review_required"
            decision = "风险提醒较多，建议由班组长先复核知识引用和现场现象，再执行建议步骤。"
        else:
            status = "ready"
            decision = "知识依据、建议步骤和风险提示已形成，可进入检修执行准备。"

        next_actions: list[str] = []
        if knowledge_results:
            next_actions.append(f"先锁定 {max(1, len(selected_chunk_ids))} 条知识依据，并记录章节或页码。")
        else:
            next_actions.append("补充设备型号、故障部位或现场图片，重新触发协作。")
        if task_preview:
            next_actions.append(f"优先执行“{task_preview[0]['title']}”，再进入现场现象核对。")
        if related_cases:
            next_actions.append(f"对照案例《{related_cases[0]['title']}》检查是否存在相同处理分支。")
        next_actions.append("完成检修后沉淀案例并提交审核回流。")
        if blocking_issues:
            next_actions.insert(0, "先关闭未满足的前置安全条件，再重新触发执行评估。")
        elif authorization_required:
            next_actions.insert(0, "先由班组长或专家完成高风险步骤授权。")

        return {
            "status": status,
            "decision": decision,
            "recommended_path": recommended_path,
            "next_actions": next_actions[:4],
            "blocking_issues": blocking_issues[:4],
            "authorization_required": authorization_required,
        }

    def _can_degrade_stage(self, agent_name: str, request: AgentAssistRequest) -> bool:
        if agent_name in {"perception", "knowledge"}:
            return True
        if agent_name == "planning":
            return request.maintenance_task_id is None and not self._is_procedural_query(request.query)
        return False

    def _is_procedural_query(self, query: str | None) -> bool:
        text = (query or "").strip()
        return any(token in text for token in ("步骤", "如何", "怎么", "拆卸", "安装", "更换"))

    def _build_agent_cards_from_runtime(
        self,
        runtime_rows: list[dict[str, Any]],
        final_plan_rows: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        runtime_by_name = {str(item.get("agent_name")): item for item in runtime_rows if item.get("agent_name")}
        cards: list[dict[str, Any]] = []
        for row in final_plan_rows:
            runtime = runtime_by_name.get(str(row.get("agent_name")), {})
            summary = runtime.get("summary")
            if not summary and row.get("status") == "skipped":
                summary = row.get("skip_reason") or row.get("reason") or "当前阶段已跳过"
            cards.append(
                {
                    "agent_name": row.get("agent_name"),
                    "title": row.get("title"),
                    "status": row.get("status"),
                    "summary": summary or "阶段完成",
                    "citations": [],
                }
            )
        return cards

    def _build_run_summary(
        self,
        knowledge_results: list[dict[str, Any]],
        task_preview: list[dict[str, Any]],
        risk_findings: list[str],
        related_cases: list[dict[str, Any]],
    ) -> str:
        return (
            f"本次协作已完成知识召回、作业步骤规划、风险校验和案例沉淀建议。"
            f"当前共命中 {len(knowledge_results)} 条知识，生成 {len(task_preview)} 个步骤，"
            f"识别 {len(risk_findings)} 条风险提醒，并推荐 {len(related_cases)} 条相似案例。"
        )
