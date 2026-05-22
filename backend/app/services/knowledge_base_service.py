"""Knowledge base lifecycle helpers."""
from __future__ import annotations

import hashlib
import re
from datetime import datetime
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.models.knowledge import KnowledgeBase, KnowledgeDocument

DEFAULT_KNOWLEDGE_BASE_SLUG = "maintenance-default"
DEFAULT_KNOWLEDGE_BASE_NAME = "设备检修知识库"
DEFAULT_KNOWLEDGE_BASE_DESCRIPTION = "设备检修、故障诊断与维修手册的统一知识库。"

KNOWLEDGE_BASE_TYPES = frozenset({"comprehensive", "device", "manual", "sop", "case"})
KNOWLEDGE_BASE_VISIBILITY = frozenset({"private", "internal", "public"})

CATEGORY_DEFINITIONS: tuple[tuple[str, str], ...] = (
    ("manual", "设备手册"),
    ("image", "现场图片"),
    ("sop", "SOP流程"),
    ("case", "故障案例"),
    ("expert", "专家经验"),
)


def _utc_naive_now() -> datetime:
    return datetime.utcnow()


def _slugify_name(name: str) -> str:
    ascii_name = (
        name.encode("ascii", errors="ignore").decode("ascii").strip().lower()
    )
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name).strip("-")
    if len(slug) >= 2:
        return slug[:80]
    digest = hashlib.sha256(name.encode("utf-8")).hexdigest()[:10]
    return f"kb-{digest}"


def build_visibility_filter(user_id: int | None) -> ColumnElement[bool]:
    """SQL filter for knowledge bases visible to the given user."""
    public_clause = KnowledgeBase.visibility == "public"
    if user_id is None:
        return public_clause

    internal_clause = KnowledgeBase.visibility == "internal"
    private_clause = and_(
        KnowledgeBase.visibility == "private",
        KnowledgeBase.owner_id == user_id,
    )
    return or_(public_clause, internal_clause, private_clause)


def can_access_knowledge_base(base: KnowledgeBase, user_id: int | None) -> bool:
    """Return whether the user may read/use this knowledge base."""
    visibility = (base.visibility or "internal").strip().lower()
    if visibility == "public":
        return True
    if user_id is None:
        return False
    if visibility == "internal":
        return True
    if visibility == "private":
        return base.owner_id is not None and base.owner_id == user_id
    return False


def resolve_document_category_id(
    *,
    source_type: str | None,
    document_type: str | None,
) -> str:
    """Map a document to a UI category id (aligned with the management console)."""
    normalized_source = (source_type or "").strip().lower()
    normalized_doc_type = (document_type or "").strip().lower()

    if normalized_doc_type == "image":
        return "image"
    if normalized_source in {"sop", "procedure"}:
        return "sop"
    if normalized_source == "case":
        return "case"
    if normalized_source == "expert":
        return "expert"
    return "manual"


class KnowledgeBaseService:
    """Resolve and bootstrap knowledge bases for imports and listings."""

    def __init__(self, session: AsyncSession):
        self.session = session

    def _serialize_base(
        self,
        base: KnowledgeBase,
        *,
        document_count: int = 0,
    ) -> dict[str, Any]:
        return {
            "id": base.id,
            "name": base.name,
            "slug": base.slug,
            "description": base.description,
            "type": base.type,
            "visibility": base.visibility,
            "owner_id": base.owner_id,
            "document_count": document_count,
            "created_at": base.created_at,
            "updated_at": base.updated_at,
        }

    async def assert_can_access_base(
        self,
        knowledge_base_id: int,
        user_id: int | None,
    ) -> KnowledgeBase:
        base = await self.get_knowledge_base(knowledge_base_id)
        if base is None:
            raise ValueError("指定的知识库不存在。")
        if not can_access_knowledge_base(base, user_id):
            raise PermissionError("无权访问该知识库。")
        return base

    async def ensure_default_knowledge_base(self) -> KnowledgeBase:
        """Return the default maintenance knowledge base, creating it when missing."""
        stmt = select(KnowledgeBase).where(KnowledgeBase.slug == DEFAULT_KNOWLEDGE_BASE_SLUG)
        existing = (await self.session.execute(stmt)).scalar_one_or_none()
        if existing is not None:
            return existing

        base = KnowledgeBase(
            name=DEFAULT_KNOWLEDGE_BASE_NAME,
            slug=DEFAULT_KNOWLEDGE_BASE_SLUG,
            description=DEFAULT_KNOWLEDGE_BASE_DESCRIPTION,
            type="comprehensive",
            visibility="internal",
            owner_id=None,
        )
        self.session.add(base)
        await self.session.commit()
        await self.session.refresh(base)
        return base

    async def get_knowledge_base(self, knowledge_base_id: int) -> KnowledgeBase | None:
        stmt = select(KnowledgeBase).where(KnowledgeBase.id == knowledge_base_id)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_knowledge_bases(
        self,
        *,
        limit: int = 20,
        user_id: int | None = None,
    ) -> list[KnowledgeBase]:
        stmt = (
            select(KnowledgeBase)
            .where(build_visibility_filter(user_id))
            .order_by(KnowledgeBase.updated_at.desc(), KnowledgeBase.id.asc())
            .limit(max(1, min(limit, 100)))
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_knowledge_bases_with_counts(
        self,
        *,
        limit: int = 50,
        user_id: int | None = None,
    ) -> list[dict[str, Any]]:
        """List knowledge bases with document counts for the management console."""
        stmt = (
            select(
                KnowledgeBase,
                func.count(KnowledgeDocument.id).label("document_count"),
            )
            .where(build_visibility_filter(user_id))
            .outerjoin(KnowledgeDocument, KnowledgeDocument.knowledge_base_id == KnowledgeBase.id)
            .group_by(KnowledgeBase.id)
            .order_by(KnowledgeBase.updated_at.desc(), KnowledgeBase.id.asc())
            .limit(max(1, min(limit, 100)))
        )
        rows = (await self.session.execute(stmt)).all()
        return [
            self._serialize_base(base, document_count=int(document_count or 0))
            for base, document_count in rows
        ]

    async def get_knowledge_base_detail(
        self,
        knowledge_base_id: int,
        *,
        user_id: int | None = None,
    ) -> dict[str, Any]:
        base = await self.assert_can_access_base(knowledge_base_id, user_id)
        count_stmt = select(func.count(KnowledgeDocument.id)).where(
            KnowledgeDocument.knowledge_base_id == knowledge_base_id
        )
        document_count = int((await self.session.execute(count_stmt)).scalar_one() or 0)
        return self._serialize_base(base, document_count=document_count)

    async def create_knowledge_base(
        self,
        *,
        name: str,
        description: str | None = None,
        type: str = "comprehensive",
        visibility: str = "internal",
        owner_id: int | None = None,
    ) -> dict[str, Any]:
        normalized_name = name.strip()
        if not normalized_name:
            raise ValueError("知识库名称不能为空。")

        normalized_type = (type or "comprehensive").strip().lower()
        if normalized_type not in KNOWLEDGE_BASE_TYPES:
            raise ValueError("知识库类型无效，请选择 comprehensive/device/manual/sop/case。")

        normalized_visibility = (visibility or "internal").strip().lower()
        if normalized_visibility not in KNOWLEDGE_BASE_VISIBILITY:
            raise ValueError("可见范围无效，请选择 private/internal/public。")

        if normalized_visibility == "private" and owner_id is None:
            raise ValueError("仅自己可见的知识库需要登录后创建。")

        slug = await self._allocate_unique_slug(normalized_name)
        now = _utc_naive_now()
        base = KnowledgeBase(
            name=normalized_name,
            slug=slug,
            description=(description or "").strip() or None,
            type=normalized_type,
            visibility=normalized_visibility,
            owner_id=owner_id,
            created_at=now,
            updated_at=now,
        )
        self.session.add(base)
        await self.session.commit()
        await self.session.refresh(base)
        return await self.get_knowledge_base_detail(base.id, user_id=owner_id)

    async def update_knowledge_base(
        self,
        knowledge_base_id: int,
        *,
        user_id: int | None = None,
        name: str | None = None,
        description: str | None = None,
        type: str | None = None,
        visibility: str | None = None,
    ) -> dict[str, Any]:
        base = await self.assert_can_access_base(knowledge_base_id, user_id)

        if name is not None:
            normalized_name = name.strip()
            if not normalized_name:
                raise ValueError("知识库名称不能为空。")
            base.name = normalized_name

        if description is not None:
            base.description = description.strip() or None

        if type is not None:
            normalized_type = type.strip().lower()
            if normalized_type not in KNOWLEDGE_BASE_TYPES:
                raise ValueError("知识库类型无效。")
            base.type = normalized_type

        if visibility is not None:
            normalized_visibility = visibility.strip().lower()
            if normalized_visibility not in KNOWLEDGE_BASE_VISIBILITY:
                raise ValueError("可见范围无效。")
            if normalized_visibility == "private" and base.owner_id is None and user_id:
                base.owner_id = user_id
            base.visibility = normalized_visibility

        base.updated_at = _utc_naive_now()
        await self.session.commit()
        await self.session.refresh(base)
        return await self.get_knowledge_base_detail(base.id, user_id=user_id)

    async def list_category_stats(
        self,
        knowledge_base_id: int,
        *,
        user_id: int | None = None,
    ) -> dict[str, Any]:
        """Return per-category document counts for one knowledge base."""
        await self.assert_can_access_base(knowledge_base_id, user_id)
        stmt = select(
            KnowledgeDocument.source_type,
            KnowledgeDocument.document_type,
        ).where(KnowledgeDocument.knowledge_base_id == knowledge_base_id)
        rows = (await self.session.execute(stmt)).all()

        counts: dict[str, int] = {category_id: 0 for category_id, _ in CATEGORY_DEFINITIONS}
        for source_type, document_type in rows:
            category_id = resolve_document_category_id(
                source_type=source_type,
                document_type=document_type,
            )
            counts[category_id] = counts.get(category_id, 0) + 1

        total = sum(counts.values())
        categories = [
            {"id": "all", "name": "全部文档", "count": total},
            *[
                {"id": category_id, "name": label, "count": counts.get(category_id, 0)}
                for category_id, label in CATEGORY_DEFINITIONS
                if counts.get(category_id, 0) > 0
            ],
        ]
        return {
            "knowledge_base_id": knowledge_base_id,
            "total": total,
            "categories": categories,
        }

    async def resolve_knowledge_base_id(
        self,
        knowledge_base_id: int | None,
        *,
        user_id: int | None = None,
    ) -> int:
        """Validate an explicit base id (with ACL) or fall back to the default base."""
        if knowledge_base_id is not None and knowledge_base_id > 0:
            base = await self.assert_can_access_base(knowledge_base_id, user_id)
            return base.id

        default_base = await self.ensure_default_knowledge_base()
        return default_base.id

    async def _allocate_unique_slug(self, name: str) -> str:
        base_slug = _slugify_name(name)
        candidate = base_slug
        suffix = 1
        while True:
            stmt = select(KnowledgeBase.id).where(KnowledgeBase.slug == candidate)
            exists = (await self.session.execute(stmt)).scalar_one_or_none()
            if exists is None:
                return candidate
            suffix += 1
            candidate = f"{base_slug}-{suffix}"[:100]
