"""Review-stage executor."""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

from app.modules.assistant.application.executors.base import StageExecutionContext, StageExecutor
from app.modules.assistant.application.graph_state import StageArtifact


BuildRiskFindings = Callable[[Any, list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]], list[str]]
BuildExecutionBrief = Callable[
    [Any, list[dict[str, Any]], list[int], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[str]],
    dict[str, Any],
]


class ReviewStageExecutor(StageExecutor):
    stage_name = "review"

    def __init__(
        self,
        *,
        tooling_service: Any,
        build_risk_findings: BuildRiskFindings,
        build_execution_brief: BuildExecutionBrief,
    ):
        self.tooling_service = tooling_service
        self.build_risk_findings = build_risk_findings
        self.build_execution_brief = build_execution_brief

    async def run(self, context: StageExecutionContext) -> StageArtifact:
        request = context.request
        emit = context.emit
        if emit is not None:
            await emit(
                "stage_start",
                {
                    "stage": "tools",
                    "title": "工具执行与合规校验",
                    "message": "正在执行遥测、案例、前置条件和人工授权工具。",
                },
            )
        knowledge_refs = context.runtime_state.get("knowledge_refs") or []
        task_preview = context.runtime_state.get("task_preview") or []
        related_cases = context.runtime_state.get("related_cases") or []
        retrieval_results = context.runtime_state.get("retrieval_results") or []
        selected_chunk_ids = context.runtime_state.get("selected_chunk_ids") or []
        retrieval_payload = context.runtime_state.get("retrieval_payload") or {}
        tool_chain = await self.tooling_service.run_tool_chain(
            request=request,
            knowledge_refs=knowledge_refs,
            task_preview=task_preview,
            related_cases=related_cases,
            toolset=context.resolved_config.agents["review"].toolset,
        )
        tool_calls = tool_chain["tool_calls"]
        for tool_call in tool_calls:
            if emit is not None:
                await emit(
                    "tool_call",
                    {
                        "tool_name": tool_call["tool_name"],
                        "title": tool_call["title"],
                        "status": tool_call["status"],
                        "summary": tool_call["summary"],
                        "blocking": tool_call["blocking"],
                        "requires_human_authorization": tool_call["requires_human_authorization"],
                        "details": tool_call.get("details") or [],
                    },
                )
        risk_findings = self.build_risk_findings(request, task_preview, knowledge_refs, tool_calls)
        execution_brief = self.build_execution_brief(
            request,
            retrieval_results,
            selected_chunk_ids,
            task_preview,
            related_cases,
            tool_calls,
            risk_findings,
        )
        review_payload = self._build_review_payload(
            retrieval_payload=retrieval_payload,
            retrieval_results=retrieval_results,
            selected_chunk_ids=selected_chunk_ids,
            knowledge_refs=knowledge_refs,
            tool_calls=tool_calls,
            execution_brief=execution_brief,
        )
        if emit is not None:
            await emit(
                "stage_finish",
                {
                    "stage": "tools",
                    "title": "工具执行与合规校验",
                    "summary": execution_brief["decision"],
                    "authorization_required": execution_brief["authorization_required"],
                    "blocking_issues": execution_brief["blocking_issues"],
                },
            )
        return StageArtifact(
            stage_name=self.stage_name,
            status="completed",
            summary=execution_brief["decision"],
            payload={
                "tool_calls": tool_calls,
                "risk_findings": risk_findings,
                "execution_brief": execution_brief,
                "review_payload": review_payload,
            },
        )

    def _build_review_payload(
        self,
        *,
        retrieval_payload: dict[str, Any],
        retrieval_results: list[dict[str, Any]],
        selected_chunk_ids: list[int],
        knowledge_refs: list[dict[str, Any]],
        tool_calls: list[dict[str, Any]],
        execution_brief: dict[str, Any],
    ) -> dict[str, Any]:
        coverage_warnings = list(retrieval_payload.get("coverage_warnings") or [])
        evidence_gaps: list[str] = []
        if not retrieval_results and not selected_chunk_ids:
            evidence_gaps.append("当前未命中稳定知识依据。")
        if not knowledge_refs and selected_chunk_ids:
            evidence_gaps.append("已选知识条目未能加载为可审查引用。")
        if retrieval_payload.get("grounded") is False:
            evidence_gaps.append("回答依据未通过 grounded 校验。")
        evidence_gaps.extend(coverage_warnings)
        blocking_issues = list(execution_brief.get("blocking_issues") or [])
        authorization_required = bool(execution_brief.get("authorization_required"))
        tool_findings = [
            {
                "tool_name": tool_call.get("tool_name"),
                "status": tool_call.get("status"),
                "blocking": bool(tool_call.get("blocking")),
                "requires_human_authorization": bool(tool_call.get("requires_human_authorization")),
                "summary": tool_call.get("summary"),
            }
            for tool_call in tool_calls
        ]
        if blocking_issues or authorization_required:
            verdict = "manual_review"
            recommended_action = "先完成人工复核与授权，再推进关键步骤。"
        elif evidence_gaps:
            verdict = "revise"
            recommended_action = "补充知识依据或现场信息后重新生成诊断。"
        else:
            verdict = "pass"
            recommended_action = "审核通过，可进入检修执行准备。"
        return {
            "verdict": verdict,
            "blocking_issues": blocking_issues,
            "authorization_required": authorization_required,
            "evidence_gaps": list(dict.fromkeys(str(item) for item in evidence_gaps if str(item).strip())),
            "tool_findings": tool_findings,
            "recommended_action": recommended_action,
        }
