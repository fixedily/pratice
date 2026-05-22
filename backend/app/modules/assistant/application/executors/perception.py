"""Perception-stage executor."""
from __future__ import annotations

from typing import Any

from app.modules.assistant.application.executors.base import StageExecutionContext, StageExecutor
from app.modules.assistant.application.graph_state import StageArtifact
from app.modules.knowledge.schemas.search import KnowledgeSearchRequest


class PerceptionStageExecutor(StageExecutor):
    stage_name = "perception"

    def __init__(self, *, knowledge_service: Any | None = None) -> None:
        self.knowledge_service = knowledge_service

    async def run(self, context: StageExecutionContext) -> StageArtifact:
        request = context.request
        summary = "已接收多模态输入，准备进行感知识别。"
        if not (request.image_base64 or request.attachment_ids):
            summary = "未接收到多模态输入，本阶段无需额外处理。"
            return StageArtifact(
                stage_name=self.stage_name,
                status="completed",
                summary=summary,
                payload={},
            )

        perception_payload = {
            "input_modalities": ["text", "image"],
            "image_summary": None,
            "image_keywords": [],
            "image_warning": None,
            "used_attachment_ids": [],
            "ignored_attachment_ids": [],
        }
        try:
            hydrated_request = KnowledgeSearchRequest(
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
            attachment_context = {
                "used_attachment_ids": [],
                "ignored_attachment_ids": [],
            }
            if self.knowledge_service is not None:
                hydrated_request, attachment_context = await self.knowledge_service._hydrate_attachment_image_request(
                    hydrated_request
                )
                perception_payload["used_attachment_ids"] = list(attachment_context.get("used_attachment_ids") or [])
                perception_payload["ignored_attachment_ids"] = list(
                    attachment_context.get("ignored_attachment_ids") or []
                )
            if (hydrated_request.image_base64 or "").strip() and self.knowledge_service is not None:
                image_analysis = await self.knowledge_service.image_analysis_service.analyze(
                    image_base64=hydrated_request.image_base64 or "",
                    image_mime_type=hydrated_request.image_mime_type,
                    image_filename=hydrated_request.image_filename,
                    query=hydrated_request.query,
                    equipment_type=hydrated_request.equipment_type,
                    equipment_model=hydrated_request.equipment_model,
                    model_provider=hydrated_request.model_provider,
                    model_name=hydrated_request.model_name,
                )
                perception_payload.update(
                    {
                        "image_summary": image_analysis.summary,
                        "image_keywords": list(image_analysis.keywords or []),
                        "image_warning": image_analysis.warning,
                    }
                )
            elif self.knowledge_service is None:
                perception_payload["image_warning"] = "当前感知阶段未接入图片解析服务，仅记录多模态输入。"
        except Exception as exc:
            perception_payload["image_warning"] = f"图片感知处理失败，已降级为人工复核：{exc}"
        summary = "已完成多模态输入整理，图片线索将作为辅助依据进入后续诊断。"
        return StageArtifact(
            stage_name=self.stage_name,
            status="completed",
            summary=summary,
            payload={"perception_payload": perception_payload},
        )
