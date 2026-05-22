"""Knowledge-stage executor."""
from __future__ import annotations

from typing import Any, Callable

from app.modules.assistant.application.executors.base import StageExecutionContext, StageExecutor
from app.modules.assistant.application.graph_state import StageArtifact
from app.modules.cases.schemas import MaintenanceCaseCreate


BuildCaseSuggestions = Callable[[Any, list[dict[str, Any]], list[dict[str, Any]]], list[str]]


class KnowledgeStageExecutor(StageExecutor):
    stage_name = "knowledge"

    def __init__(self, *, build_case_suggestions: BuildCaseSuggestions, case_service: Any | None = None) -> None:
        self.build_case_suggestions = build_case_suggestions
        self.case_service = case_service

    async def run(self, context: StageExecutionContext) -> StageArtifact:
        request = context.request
        knowledge_refs = context.runtime_state.get("knowledge_refs") or []
        related_cases = context.runtime_state.get("related_cases") or []
        task_preview = context.runtime_state.get("task_preview") or []
        diagnosis_report = context.runtime_state.get("diagnosis_report")
        case_suggestions = self.build_case_suggestions(request, knowledge_refs, related_cases)
        payload: dict[str, Any] = {"case_suggestions": case_suggestions}
        writeback_mode = context.resolved_config.pipeline.knowledge_writeback
        if writeback_mode == "case_draft" and self.case_service is not None:
            case_draft = await self._create_case_draft(
                request=request,
                knowledge_refs=knowledge_refs,
                task_preview=task_preview,
                diagnosis_report=diagnosis_report,
            )
            payload["case_draft"] = case_draft
        summary = f"已输出 {len(case_suggestions)} 条案例沉淀建议，并推荐 {len(related_cases)} 条相似案例。"
        if payload.get("case_draft"):
            summary = f"{summary} 已生成待审核案例草稿。"
        return StageArtifact(
            stage_name=self.stage_name,
            status="completed",
            summary=summary,
            payload=payload,
        )

    async def _create_case_draft(
        self,
        *,
        request: Any,
        knowledge_refs: list[dict[str, Any]],
        task_preview: list[dict[str, Any]],
        diagnosis_report: str | None,
    ) -> dict[str, Any]:
        title_parts = [
            request.equipment_model or request.equipment_type or "设备",
            request.fault_type or request.query or "检修诊断",
        ]
        title = " - ".join(str(item).strip() for item in title_parts if str(item or "").strip())[:120]
        processing_steps = [
            str(step.get("instruction") or step.get("title") or "").strip()
            for step in task_preview
            if str(step.get("instruction") or step.get("title") or "").strip()
        ]
        if not processing_steps:
            processing_steps = ["根据 Agent 诊断报告与知识引用完成人工复核后补充处理步骤。"]
        resolution_summary = (diagnosis_report or "Agent 已生成诊断报告，请审核后补充最终处理结果。").strip()
        normalized_refs = [
            ref
            for ref in knowledge_refs
            if all(ref.get(key) is not None for key in ("chunk_id", "document_id", "title", "source_name", "equipment_type"))
            and str(ref.get("excerpt") or ref.get("content") or "").strip()
        ]
        for ref in normalized_refs:
            if not ref.get("excerpt") and ref.get("content"):
                ref["excerpt"] = str(ref["content"])[:240]
        data = MaintenanceCaseCreate(
            title=title or "Agent 诊断案例草稿",
            work_order_id=request.work_order_id,
            asset_code=request.asset_code,
            report_source=request.report_source,
            priority=request.priority,
            equipment_type=request.equipment_type or "未标注设备",
            equipment_model=request.equipment_model,
            fault_type=request.fault_type,
            task_id=request.maintenance_task_id,
            symptom_description=request.query or request.fault_type or "Agent 协作生成的待审核案例草稿。",
            processing_steps=processing_steps,
            resolution_summary=resolution_summary[:2000],
            knowledge_refs=normalized_refs,
        )
        case_payload = await self.case_service.create_case(data)
        case_id = int(case_payload["id"])
        return {
            "id": case_id,
            "status": case_payload.get("status"),
            "title": case_payload.get("title"),
            "review_entry": f"/api/v1/cases/{case_id}/review",
        }
