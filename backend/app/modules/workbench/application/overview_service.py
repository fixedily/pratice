"""Aggregated workbench overview service."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.metrics import build_metrics_snapshot
from app.db.models.knowledge import KnowledgeChunk, KnowledgeDocument, MaintenanceCase
from app.db.models.tasks import MaintenanceTask
from app.evaluation.workflow_quality_metrics import build_quality_highlights, build_runtime_highlights
from app.modules.tasks.application.task_service import MaintenanceTaskService
from app.modules.cases.application.case_service import MaintenanceCaseService

FEATURED_QUERIES: list[str] = []

AGENT_CAPABILITIES = [
    "KnowledgeRetrieverAgent：负责查询重写、知识召回与引用整理",
    "WorkOrderPlannerAgent：负责生成标准化检修步骤预案",
    "RiskControlAgent：负责风险提示、缺项检查与合规校验",
    "CaseCuratorAgent：负责案例沉淀、修正建议与知识回流",
]
EVALUATION_RESULTS_PATH = Path(__file__).resolve().parents[4] / "evaluation" / "workflow_eval_results.json"


class WorkbenchOverviewService:
    """Build aggregated payloads for the formal workbench home page."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.task_service = MaintenanceTaskService(session)
        self.case_service = MaintenanceCaseService(session)

    async def build_overview(self) -> dict:
        """Return counts, featured queries and recent business items."""
        published_documents = await self._count(
            select(func.count()).select_from(KnowledgeDocument).where(
                KnowledgeDocument.status == "published"
            )
        )
        knowledge_chunks = await self._count(select(func.count()).select_from(KnowledgeChunk))
        active_tasks = await self._count(
            select(func.count()).select_from(MaintenanceTask).where(
                MaintenanceTask.status.in_(["pending", "in_progress"])
            )
        )
        pending_cases = await self._count(
            select(func.count()).select_from(MaintenanceCase).where(
                MaintenanceCase.status == "pending_review"
            )
        )

        recent_tasks = await self.task_service.list_history(limit=5)
        recent_cases = await self.case_service.list_cases(limit=5)
        recommended_knowledge = await self._build_recommended_knowledge(limit=4, task_limit=5)
        evaluation_payload = self._load_evaluation_payload()
        runtime_snapshot = await build_metrics_snapshot()

        return {
            "generated_at": datetime.now(timezone.utc),
            "stats": [
                {"key": "knowledge_documents", "label": "知识文档", "value": published_documents, "accent": "cyan"},
                {"key": "knowledge_chunks", "label": "知识分段", "value": knowledge_chunks, "accent": "blue"},
                {"key": "active_tasks", "label": "进行中任务", "value": active_tasks, "accent": "green"},
                {"key": "pending_cases", "label": "待审核案例", "value": pending_cases, "accent": "amber"},
            ],
            "featured_queries": FEATURED_QUERIES,
            "agent_capabilities": AGENT_CAPABILITIES,
            "quality_highlights": build_quality_highlights(evaluation_payload),
            "runtime_highlights": build_runtime_highlights(runtime_snapshot),
            "recommended_knowledge_count": len(recommended_knowledge),
            "recommended_knowledge": recommended_knowledge,
            "recent_tasks": recent_tasks,
            "recent_cases": recent_cases,
        }

    async def _count(self, stmt) -> int:
        result = await self.session.execute(stmt)
        return int(result.scalar_one() or 0)

    async def _build_recommended_knowledge(self, *, limit: int, task_limit: int) -> list[dict[str, Any]]:
        stmt = (
            select(MaintenanceTask.source_snapshot)
            .where(MaintenanceTask.source_snapshot.is_not(None))
            .order_by(MaintenanceTask.updated_at.desc())
            .limit(task_limit)
        )
        rows = (await self.session.execute(stmt)).scalars().all()
        deduped: dict[str, dict[str, Any]] = {}

        for snapshot in rows:
            if not isinstance(snapshot, list):
                continue
            for ref in snapshot:
                if not isinstance(ref, dict):
                    continue
                key = str(
                    ref.get("chunk_id")
                    or f"{ref.get('document_id')}-{ref.get('title')}-{ref.get('section_reference')}"
                )
                if key in deduped:
                    continue
                title = str(ref.get("title") or ref.get("source_name") or "").strip()
                if not title:
                    continue
                excerpt = str(ref.get("excerpt") or "").replace("\n", " ").strip() or None
                section_reference = (
                    str(ref.get("section_reference") or ref.get("section_path") or "").strip() or None
                )
                page_reference = str(ref.get("page_reference") or "").strip() or None
                source_name = str(ref.get("source_name") or "").strip() or None
                deduped[key] = {
                    "chunk_id": int(ref["chunk_id"]) if ref.get("chunk_id") is not None else None,
                    "document_id": int(ref["document_id"]) if ref.get("document_id") is not None else None,
                    "title": title,
                    "source_name": source_name,
                    "section_reference": section_reference,
                    "page_reference": page_reference,
                    "excerpt": excerpt,
                }
                if len(deduped) >= limit:
                    return list(deduped.values())

        return list(deduped.values())

    def _load_evaluation_payload(self) -> dict | None:
        try:
            return json.loads(EVALUATION_RESULTS_PATH.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return None


__all__ = ["WorkbenchOverviewService"]
