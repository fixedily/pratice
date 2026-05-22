"""Planning-stage executor."""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from app.modules.assistant.application.executors.base import StageExecutionContext, StageExecutor
from app.modules.assistant.application.graph_state import StageArtifact


BuildTaskPreview = Callable[[Any, list[dict[str, Any]]], Awaitable[list[dict[str, Any]]]]


class PlanningStageExecutor(StageExecutor):
    stage_name = "planning"

    def __init__(
        self,
        *,
        task_service: Any,
        case_service: Any,
        build_task_preview: BuildTaskPreview,
    ):
        self.task_service = task_service
        self.case_service = case_service
        self.build_task_preview = build_task_preview

    async def run(self, context: StageExecutionContext) -> StageArtifact:
        request = context.request
        emit = context.emit
        if emit is not None:
            await emit(
                "stage_start",
                {
                    "stage": "planning",
                    "title": "作业步骤规划 / 案例查询",
                    "message": "正在依据知识片段整理检修步骤并查询相似案例。",
                },
            )
        selected_chunk_ids = list(context.runtime_state.get("selected_chunk_ids") or [])
        retrieval_payload = context.runtime_state.get("retrieval_payload") or {}
        knowledge_refs = await self.task_service._load_knowledge_refs(selected_chunk_ids)
        task_preview, related_cases = await asyncio.gather(
            self.build_task_preview(request, knowledge_refs),
            self.case_service.recommend_cases(
                equipment_type=request.equipment_type,
                equipment_model=request.equipment_model,
                fault_type=request.fault_type or retrieval_payload.get("effective_query"),
                limit=3,
            ),
        )
        summary = f"已整理 {len(task_preview)} 条知识步骤线索，命中 {len(related_cases)} 条相似案例。"
        if emit is not None:
            await emit(
                "stage_finish",
                {
                    "stage": "planning",
                    "title": "作业步骤规划 / 案例查询",
                    "summary": summary,
                    "step_count": len(task_preview),
                    "case_count": len(related_cases),
                },
            )
        return StageArtifact(
            stage_name=self.stage_name,
            status="completed",
            summary=summary,
            payload={
                "knowledge_refs": knowledge_refs,
                "task_preview": task_preview,
                "related_cases": related_cases,
            },
        )
