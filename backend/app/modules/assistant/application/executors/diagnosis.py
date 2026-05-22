"""Diagnosis-stage executor."""
from __future__ import annotations

import logging
from typing import Any

from app.modules.assistant.application.executors.base import StageExecutionContext, StageExecutor
from app.modules.assistant.application.graph_state import StageArtifact
from app.modules.knowledge.schemas.search import KnowledgeSearchRequest
from app.services.answer_guard_service import (
    expand_query_for_corrective,
    score_retrieval_quality,
    should_trigger_corrective_retrieval,
)

logger = logging.getLogger(__name__)


class DiagnosisStageExecutor(StageExecutor):
    stage_name = "diagnosis"

    def __init__(self, *, knowledge_service: Any):
        self.knowledge_service = knowledge_service

    async def run(self, context: StageExecutionContext) -> StageArtifact:
        request = context.request
        emit = context.emit
        if emit is not None:
            await emit(
                "stage_start",
                {
                    "stage": "retrieval",
                    "title": "知识召回与引用整理",
                    "message": "正在检索知识依据并整理有效查询词。",
                },
            )
        retrieval_payload = {
            "query": request.query,
            "effective_query": request.query,
            "effective_keywords": [],
            "image_analysis": None,
            "results": [],
            "grounded": True,
            "coverage_warnings": [],
            "reasoning_chain": None,
            "query_type": "text_related",
        }
        if any(
            [
                request.query,
                request.equipment_type,
                request.equipment_model,
                request.fault_type,
                request.image_base64,
                request.attachment_ids,
            ]
        ):
            knowledge_request = KnowledgeSearchRequest(
                work_order_id=request.work_order_id,
                report_source=request.report_source,
                priority=request.priority,
                maintenance_level=request.maintenance_level,
                query=request.query,
                equipment_type=request.equipment_type,
                equipment_model=request.equipment_model,
                fault_type=request.fault_type,
                image_base64=request.image_base64,
                image_mime_type=request.image_mime_type,
                image_filename=request.image_filename,
                attachment_ids=request.attachment_ids,
                model_provider=request.model_provider,
                model_name=request.model_name,
                limit=request.limit,
            )
            retrieval_payload = await self.knowledge_service.search_multimodal(knowledge_request)
        retrieval_results = retrieval_payload["results"]
        retrieval_quality = score_retrieval_quality(request.query or "", retrieval_results)
        if should_trigger_corrective_retrieval(retrieval_quality) and request.query:
            corrective_queries = expand_query_for_corrective(request.query)
            for cq in corrective_queries[1:]:
                corrective_request = KnowledgeSearchRequest(
                    query=cq,
                    equipment_type=request.equipment_type,
                    equipment_model=request.equipment_model,
                    fault_type=request.fault_type,
                    limit=request.limit,
                )
                try:
                    corrective_payload = await self.knowledge_service.search_multimodal(corrective_request)
                    new_results = corrective_payload.get("results", [])
                    existing_ids = {item["chunk_id"] for item in retrieval_results}
                    for item in new_results:
                        if item["chunk_id"] not in existing_ids:
                            retrieval_results.append(item)
                            existing_ids.add(item["chunk_id"])
                    if score_retrieval_quality(cq, retrieval_results) == "relevant":
                        break
                except Exception:
                    logger.debug("Corrective retrieval pass failed for query: %s", cq)
            retrieval_payload["results"] = retrieval_results
            logger.info(
                "Corrective RAG: quality=%s -> %d total results after expansion",
                retrieval_quality,
                len(retrieval_results),
            )
        selected_chunk_ids = context.runtime_state.get("selected_chunk_ids") or [
            item["chunk_id"] for item in retrieval_results[: min(3, len(retrieval_results))]
        ]
        summary = self._build_retrieval_summary(retrieval_payload.get("effective_query"), retrieval_results)
        if emit is not None:
            await emit(
                "stage_finish",
                {
                    "stage": "retrieval",
                    "title": "知识召回与引用整理",
                    "summary": summary,
                    "knowledge_count": len(retrieval_results),
                    "selected_chunk_ids": selected_chunk_ids,
                },
            )
        return StageArtifact(
            stage_name=self.stage_name,
            status="completed",
            summary=summary,
            payload={
                "retrieval_payload": retrieval_payload,
                "retrieval_results": retrieval_results,
                "selected_chunk_ids": list(selected_chunk_ids),
            },
        )

    def _build_retrieval_summary(self, effective_query: str | None, results: list[dict[str, Any]]) -> str:
        if not results:
            return "未命中稳定知识条目，建议补充更明确的故障描述、设备型号或图片。"
        top = results[0]
        return (
            f"已围绕“{effective_query or top['title']}”召回 {len(results)} 条知识，"
            f"首条来源为 {top['title']}（{top['page_reference'] or '页码待补充'}）。"
        )
