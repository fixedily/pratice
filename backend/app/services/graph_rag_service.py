"""Graph RAG — relation-graph expansion for knowledge retrieval.

Given a set of seed chunk IDs (from the primary vector/BM25 search), this
service walks the ``knowledge_relations`` table to find related documents /
chunks and returns them as additional candidates.

Walk strategy
─────────────
1. Collect the *document IDs* that own the seed chunks.
2. Query ``knowledge_relations`` for all edges where source_id or target_id
   is one of those document IDs (source_kind / target_kind == 'document').
3. Collect the neighbour document IDs (up to ``max_hops`` hops, default 1).
4. Load the top-K chunks from each neighbour document, ranked by their
   existing ``score`` column (or creation order as fallback).
5. Return the extra chunks as serialised dicts, ready to be merged into the
   main result list.

The expansion is intentionally shallow (1 hop by default) to keep latency
low.  A second hop can be enabled via ``max_hops=2`` but is not recommended
for interactive queries.
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.knowledge import KnowledgeChunk, KnowledgeDocument, KnowledgeRelation

logger = logging.getLogger(__name__)

# Relation types that are useful for fault-diagnosis expansion
_USEFUL_RELATION_TYPES = frozenset(
    {
        "similar_fault",
        "prerequisite",
        "related_case",
    }
)
_DOCUMENT_NODE_KINDS = ("knowledge_document", "document")


def _build_excerpt(content: str, limit: int = 200) -> str:
    text = " ".join((content or "").split())
    if len(text) <= limit:
        return text
    return text[:limit] + "..."


async def graph_expand(
    session: AsyncSession,
    seed_chunk_ids: list[int],
    *,
    max_hops: int = 1,
    max_extra_chunks: int = 10,
    relation_types: frozenset[str] | None = None,
    base_score: float = 0.0,
) -> list[dict[str, Any]]:
    """Return extra chunks reachable from *seed_chunk_ids* via the relation graph.

    Parameters
    ----------
    session:
        Active async SQLAlchemy session.
    seed_chunk_ids:
        Chunk IDs returned by the primary search.
    max_hops:
        Graph traversal depth.  1 = direct neighbours only.
    max_extra_chunks:
        Maximum number of extra chunks to return.
    relation_types:
        Whitelist of relation types to follow.  Defaults to
        ``_USEFUL_RELATION_TYPES``.

    Returns
    -------
    list[dict]
        Serialised chunk dicts (same schema as the primary search results)
        with an extra ``"graph_source": True`` flag.
    """
    if not seed_chunk_ids or max_extra_chunks <= 0:
        return []

    allowed_types = relation_types if relation_types is not None else _USEFUL_RELATION_TYPES

    try:
        # ── Step 1: resolve seed document IDs ────────────────────────────────
        chunk_rows = (
            await session.execute(
                select(KnowledgeChunk.id, KnowledgeChunk.document_id).where(
                    KnowledgeChunk.id.in_(seed_chunk_ids)
                )
            )
        ).all()
        seed_doc_ids: set[int] = {row.document_id for row in chunk_rows}
        if not seed_doc_ids:
            return []

        # ── Step 2: walk the relation graph ───────────────────────────────────
        frontier: set[int] = set(seed_doc_ids)
        visited: set[int] = set(seed_doc_ids)
        relation_type_by_doc_id: dict[int, str] = {}

        for _hop in range(max_hops):
            if not frontier:
                break
            rel_rows = (
                await session.execute(
                    select(
                        KnowledgeRelation.source_id,
                        KnowledgeRelation.target_id,
                        KnowledgeRelation.relation_type,
                    ).where(
                        KnowledgeRelation.source_kind.in_(list(_DOCUMENT_NODE_KINDS)),
                        KnowledgeRelation.target_kind.in_(list(_DOCUMENT_NODE_KINDS)),
                        KnowledgeRelation.relation_type.in_(list(allowed_types)),
                        or_(
                            KnowledgeRelation.source_id.in_(list(frontier)),
                            KnowledgeRelation.target_id.in_(list(frontier)),
                        ),
                    )
                )
            ).all()

            new_frontier: set[int] = set()
            for row in rel_rows:
                endpoints = ((row.source_id, row.target_id), (row.target_id, row.source_id))
                for current, neighbour in endpoints:
                    if current not in frontier or neighbour in visited:
                        continue
                    visited.add(neighbour)
                    new_frontier.add(neighbour)
                    relation_type_by_doc_id.setdefault(neighbour, row.relation_type)
            frontier = new_frontier

        neighbour_doc_ids = visited - seed_doc_ids
        if not neighbour_doc_ids:
            return []

        # ── Step 3: load top chunks from neighbour documents ─────────────────
        chunk_result = (
            await session.execute(
                select(KnowledgeChunk, KnowledgeDocument)
                .join(KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id)
                .where(KnowledgeChunk.document_id.in_(list(neighbour_doc_ids)))
                .order_by(KnowledgeChunk.document_id, KnowledgeChunk.chunk_index)
                .limit(max_extra_chunks * 3)  # over-fetch, then trim
            )
        ).all()

        # ── Step 4: serialise ─────────────────────────────────────────────────
        extra: list[dict[str, Any]] = []
        seen_chunk_ids: set[int] = set(seed_chunk_ids)
        for chunk, doc in chunk_result:
            if chunk.id in seen_chunk_ids:
                continue
            seen_chunk_ids.add(chunk.id)
            relation_type = relation_type_by_doc_id.get(doc.id)
            reason = "图谱关联扩展"
            if relation_type:
                reason = f"图谱关联扩展（{relation_type}）"
            extra.append(
                {
                    "chunk_id": chunk.id,
                    "document_id": doc.id,
                    "title": doc.title or "",
                    "source_name": doc.source_name or "",
                    "source_type": doc.source_type or "",
                    "equipment_type": doc.equipment_type or "",
                    "equipment_model": doc.equipment_model or "",
                    "fault_type": doc.fault_type or "",
                    "content": chunk.content or "",
                    "excerpt": _build_excerpt(chunk.content or ""),
                    "section_reference": chunk.section_reference or doc.section_reference,
                    "section_path": getattr(chunk, "section_path", None),
                    "step_anchor": getattr(chunk, "step_anchor", None),
                    "page_reference": chunk.page_reference or doc.page_reference,
                    "image_anchor": getattr(chunk, "image_anchor", None),
                    "source_modality": getattr(chunk, "source_modality", None),
                    "ocr_text": getattr(chunk, "ocr_text", None),
                    "image_caption": getattr(chunk, "image_caption", None),
                    "evidence_summary": getattr(chunk, "evidence_summary", None),
                    "expanded_content": None,
                    "recommendation_reason": reason,
                    "score": float(base_score),
                    "retrieval_score": float(base_score),
                    "rerank_score": float(base_score),
                    "reason": reason,
                    "graph_source": True,
                    "graph_relation_type": relation_type,
                    "_content": chunk.content or "",
                    "_heading": getattr(chunk, "heading", None),
                    "_document_updated_at": getattr(doc, "updated_at", None),
                    "_retrieval_channel": "graph_expand",
                    "_retrieval_path": ["graph_expand"],
                }
            )
            if len(extra) >= max_extra_chunks:
                break

        logger.debug(
            "graph_expand: seed_docs=%d neighbours=%d extra_chunks=%d",
            len(seed_doc_ids),
            len(neighbour_doc_ids),
            len(extra),
        )
        return extra

    except Exception:
        logger.exception("graph_expand_failed")
        return []
