"""Knowledge ingestion and retrieval service."""
from __future__ import annotations

import base64
import logging
from difflib import SequenceMatcher
from pathlib import Path
from time import perf_counter
from typing import Any

from sqlalchemy import case, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.metrics import increment_counter, observe_duration
from app.db.models.knowledge import KnowledgeChunk, KnowledgeDocument
from app.db.models.maintenance import Attachment
from app.models.knowledge import KgEntity, KgEntityAlias, KgRelation, KgRelationEvidence
from app.modules.knowledge.application.semantic_graph_service import SemanticKnowledgeGraphService
from app.modules.knowledge.schemas.semantic_graph import SemanticExtractionFromDocumentRequest
from app.modules.knowledge.schemas.search import KnowledgeDocumentCreate, KnowledgeSearchRequest
from app.services.image_analysis_service import FaultImageAnalysisService
from app.services.knowledge_answer_guard import build_grounding_assessment
from app.services.knowledge_chunking import split_text_into_chunks
from app.services.knowledge_device_models import ensure_device_model
from app.services.knowledge_document_ingest import prepare_chunk_payloads
from app.services.knowledge_index_sync import refresh_document_indices
from app.services.knowledge_base_service import KnowledgeBaseService
from app.services.knowledge_query_profile import (
    build_query_bundle,
    infer_query_profile,
)
from app.services.knowledge_query_rewrite import (
    analyze_procedural_query,
    apply_query_rewrite_rules,
    build_effective_keywords,
    expand_tokens_with_synonyms,
    extract_search_tokens,
)
from app.services.knowledge_rerank import (
    compute_equipment_model_bonus,
    compute_fault_type_bonus,
    compute_recency_bonus,
    compute_source_type_bonus,
    compute_token_coverage_bonus,
    contains_safety_terms,
    merge_candidates,
    rerank_results,
    resolve_candidate_limit,
)

logger = logging.getLogger(__name__)
from app.services.knowledge_result_formatting import (
    build_excerpt,
    build_reason,
    serialize_search_row,
)
from app.services.knowledge_retrieval_sql import (
    build_equipment_model_filter,
    build_token_search_expressions,
)


def _normalize_graph_match_text(value: str) -> str:
    return "".join(str(value or "").lower().split()).replace("-", "").replace("_", "")


def _semantic_entity_similarity_score(
    search_text: str,
    keyword_texts: list[str],
    entity_names: list[str],
) -> float:
    candidates = [text for text in [search_text, *keyword_texts] if text]
    if not candidates or not entity_names:
        return 0.0
    best = 0.0
    for name in entity_names:
        if not name:
            continue
        for candidate in candidates:
            if not candidate:
                continue
            ratio = SequenceMatcher(None, candidate, name).ratio()
            containment = min(len(candidate), len(name)) / max(len(candidate), len(name))
            if candidate in name or name in candidate:
                ratio = max(ratio, containment)
            best = max(best, ratio)
    return best


class KnowledgeService:
    """Service layer for knowledge documents and search."""

    MULTIMODAL_PROMPT_TEMPLATE_VERSION = "multimodal-rag-v1"

    def __init__(self, session: AsyncSession):
        self.session = session
        self.image_analysis_service = FaultImageAnalysisService()

    @staticmethod
    def _resolve_result_score(item: dict[str, Any]) -> float:
        for key in ("rerank_score", "score", "retrieval_score"):
            value = item.get(key)
            if value is None:
                continue
            try:
                return float(value)
            except (TypeError, ValueError):
                continue
        return 0.0

    async def create_document(
        self,
        data: KnowledgeDocumentCreate,
        chunk_payloads: list[dict[str, str | None]] | None = None,
    ) -> tuple[KnowledgeDocument, int]:
        """Persist a source document and its searchable chunks."""
        knowledge_base_id = data.knowledge_base_id
        if knowledge_base_id is None:
            knowledge_base_id = await KnowledgeBaseService(self.session).resolve_knowledge_base_id(None)
        document = KnowledgeDocument(
            knowledge_base_id=knowledge_base_id,
            title=data.title,
            source_name=data.source_name,
            document_type=(data.document_type or "pdf").strip() or "pdf",
            source_modality=data.source_modality,
            object_key=data.object_key or data.source_name,
            source_type=data.source_type,
            equipment_type=data.equipment_type,
            equipment_model=data.equipment_model,
            fault_type=data.fault_type,
            section_reference=data.section_reference,
            page_reference=data.page_reference,
            content=data.content,
            status="published",
        )
        self.session.add(document)
        await self.session.flush()

        if data.equipment_model:
            await self._ensure_device_model(data)

        chunk_payloads = self._prepare_chunk_payloads(data, chunk_payloads)
        self.session.add_all(
            [
                KnowledgeChunk(
                    document_id=document.id,
                    knowledge_base_id=document.knowledge_base_id,
                    chunk_index=index,
                    heading=chunk_payload["heading"],
                    content=chunk_payload["content"] or "",
                    equipment_type=chunk_payload["equipment_type"] or data.equipment_type,
                    equipment_model=chunk_payload["equipment_model"] or data.equipment_model,
                    fault_type=chunk_payload["fault_type"] or data.fault_type,
                    section_reference=chunk_payload["section_reference"] or data.section_reference,
                    section_path=chunk_payload.get("section_path"),
                    step_anchor=chunk_payload.get("step_anchor"),
                    page_reference=chunk_payload["page_reference"] or data.page_reference,
                    image_anchor=chunk_payload.get("image_anchor"),
                    source_modality=chunk_payload.get("source_modality"),
                    ocr_text=chunk_payload.get("ocr_text"),
                    image_caption=chunk_payload.get("image_caption"),
                    evidence_summary=chunk_payload.get("evidence_summary"),
                )
                for index, chunk_payload in enumerate(chunk_payloads, start=1)
            ]
        )

        await self.session.commit()
        try:
            from app.services import cache_service

            await cache_service.clear_async()
        except Exception:
            logger.warning("search_cache_clear_failed after create_document", exc_info=True)
        await self.session.refresh(document)

        try:
            if chunk_payloads:
                await refresh_document_indices(self.session, document_id=document.id)
        except Exception:
            logger.warning(
                "index_update_failed doc_id=%s — run build_faiss_index to reconcile",
                document.id,
            )

        await self._create_semantic_extraction_candidates(document.id)
        return document, len(chunk_payloads)

    async def _create_semantic_extraction_candidates(self, document_id: int) -> None:
        try:
            await SemanticKnowledgeGraphService(self.session).create_rule_extraction_job_from_document(
                document_id,
                SemanticExtractionFromDocumentRequest(trigger_source="document_import"),
            )
        except Exception:
            logger.exception("semantic_extraction_failed document_id=%s", document_id)

    async def search_multimodal(self, request: KnowledgeSearchRequest) -> dict[str, Any]:
        """Search knowledge with optional image-derived retrieval hints."""
        started_at = perf_counter()
        image_analysis = None
        hydrated_request, attachment_context = await self._hydrate_attachment_image_request(request)
        has_image_input = bool((hydrated_request.image_base64 or "").strip())

        # ── 缓存检查（仅对无图片请求缓存，图片 base64 体积大且每次可能不同）──
        from app.services import cache_service as _cache

        _cache_key: str | None = None
        if not has_image_input:
            _cache_key = _cache.make_cache_key(
                query=hydrated_request.query,
                equipment_type=hydrated_request.equipment_type,
                equipment_model=hydrated_request.equipment_model,
                fault_type=hydrated_request.fault_type,
                limit=hydrated_request.limit or 10,
                graph_relation_types=hydrated_request.graph_relation_types,
            )
            cached = await _cache.get_async(_cache_key)
            if cached is not None:
                return cached

        if has_image_input:
            image_analysis = await self.image_analysis_service.analyze(
                image_base64=hydrated_request.image_base64 or "",
                image_mime_type=hydrated_request.image_mime_type,
                image_filename=hydrated_request.image_filename,
                query=hydrated_request.query,
                equipment_type=hydrated_request.equipment_type,
                equipment_model=hydrated_request.equipment_model,
                model_provider=hydrated_request.model_provider,
                model_name=hydrated_request.model_name,
            )
        effective_keywords = self._build_effective_keywords(
            query=hydrated_request.query,
            equipment_model=hydrated_request.equipment_model,
            fault_type=hydrated_request.fault_type,
            image_keywords=image_analysis.keywords if image_analysis is not None else None,
        )
        effective_query = " ".join(effective_keywords) if effective_keywords else hydrated_request.query
        if has_image_input and image_analysis is not None and not effective_query:
            effective_query = self.image_analysis_service.merge_query(
                query=hydrated_request.query,
                analysis=image_analysis,
                equipment_model=hydrated_request.equipment_model,
            )
        query_bundle = build_query_bundle(
            query=hydrated_request.query,
            effective_keywords=effective_keywords,
            image_summary=(image_analysis.summary if image_analysis is not None else None),
            equipment_model=hydrated_request.equipment_model,
        )
        query_profile = infer_query_profile(
            query_bundle=query_bundle,
            has_image=has_image_input,
        )

        semantic_graph_context = await self._build_semantic_graph_context(
            query=effective_query or hydrated_request.query or "",
            effective_keywords=effective_keywords,
            relation_types=getattr(hydrated_request, "graph_relation_types", None) or [],
        )
        if semantic_graph_context.get("enhanced_keywords"):
            enhanced_terms = [
                term for term in semantic_graph_context["enhanced_keywords"]
                if term and term not in effective_keywords
            ]
            if enhanced_terms:
                effective_keywords.extend(enhanced_terms)
                effective_query = " ".join(effective_keywords)

        search_request = hydrated_request.model_copy(update={"query": effective_query})

        try:
            from app.core.config import get_settings
            from app.services.query_rewrite_service import generate_multi_queries

            query_variants = await generate_multi_queries(
                effective_query or hydrated_request.query or "",
                get_settings(),
            )
        except Exception:
            query_variants = [effective_query or hydrated_request.query or ""]

        variant_result_sets: list[list[dict[str, Any]]] = []
        retrieval_path = [query_profile.retrieval_path_tag]
        for variant in query_variants:
            variant_req = search_request.model_copy(update={"query": variant})
            variant_results = await self.search(variant_req, query_profile=query_profile)
            if variant_results:
                variant_result_sets.append(variant_results)
        if variant_result_sets:
            results = self._fuse_variant_results(variant_result_sets)
        else:
            results = await self.search(search_request, query_profile=query_profile)
        if results:
            retrieval_path.extend(self._collect_retrieval_channels(results))
        if semantic_graph_context.get("matched_entities"):
            retrieval_path.append("semantic_graph_entity_link")

        # ── Graph RAG 扩展（1-hop 关联文档）──────────────────────────────────
        try:
            from app.core.config import get_settings
            from app.services.graph_rag_service import graph_expand

            settings = get_settings()
            if getattr(settings, "enable_graph_rag", False) and results:
                seed_results = [item for item in results if item.get("chunk_id") is not None][:5]
                if seed_results:
                    seed_ids = [int(item["chunk_id"]) for item in seed_results]
                    min_seed_score = min(self._resolve_result_score(item) for item in seed_results)
                    graph_base_score = round(max(0.0, min_seed_score) * 0.5, 4)
                    graph_extra = await graph_expand(
                        self.session,
                        seed_ids,
                        max_hops=1,
                        max_extra_chunks=max(0, int(getattr(settings, "graph_rag_max_neighbors", 3))),
                        base_score=graph_base_score,
                    )
                    appended = False
                    if graph_extra:
                        existing_ids = {
                            int(item["chunk_id"])
                            for item in results
                            if item.get("chunk_id") is not None
                        }
                        for extra in graph_extra:
                            chunk_id = extra.get("chunk_id")
                            if chunk_id is None or int(chunk_id) in existing_ids:
                                continue
                            existing_ids.add(int(chunk_id))
                            results.append(extra)
                            appended = True
                    if appended:
                        retrieval_path.append("graph_expand")
        except Exception:
            pass  # graph expansion is best-effort

        semantic_evidence_results = await self._load_semantic_graph_evidence_results(
            request=search_request,
            graph_context=semantic_graph_context,
        )
        if semantic_evidence_results:
            existing_ids = {item["chunk_id"] for item in results if item.get("chunk_id") is not None}
            for item in semantic_evidence_results:
                if item["chunk_id"] not in existing_ids:
                    existing_ids.add(item["chunk_id"])
                    results.append(item)
            retrieval_path.append("semantic_graph_evidence")
        results = self._rerank_semantic_graph_results(
            results,
            graph_context=semantic_graph_context,
            limit=search_request.limit,
        )

        results = await self._attach_expanded_context(results)
        results = self._assign_citation_labels(results)
        assessment = build_grounding_assessment(
            request_query=hydrated_request.query,
            query_type=query_profile.query_type,
            results=results,
            image_analysis_used=image_analysis is not None,
        )

        result_status = "hit" if results else "miss"
        await increment_counter(
            "knowledge_search_requests_total",
            has_image=has_image_input,
            result_status=result_status,
        )
        await observe_duration(
            "knowledge_search_duration_ms",
            (perf_counter() - started_at) * 1000,
            has_image=has_image_input,
            result_status=result_status,
        )

        image_model_name = self._resolve_image_model_name(hydrated_request, image_analysis)
        reasoning_chain = self._build_reasoning_chain(
            question=hydrated_request.query or effective_query,
            graph_context=semantic_graph_context,
            results=results,
            confidence=assessment["answer_confidence"],
            warnings=assessment["coverage_warnings"],
        )
        payload = {
            "query": hydrated_request.query,
            "effective_query": effective_query,
            "effective_keywords": effective_keywords,
            "query_type": query_profile.query_type,
            "image_analysis_used": image_analysis is not None,
            "retrieval_path": retrieval_path,
            "input_modalities": self._build_input_modalities(hydrated_request, image_analysis),
            "multimodal_context": {
                **attachment_context,
                "has_image_input": has_image_input,
                "image_analysis_used": image_analysis is not None,
                "image_analysis_source": image_analysis.source if image_analysis is not None else None,
                "image_analysis_warning": image_analysis.warning if image_analysis is not None else None,
                "effective_query": effective_query,
            },
            "model_name": image_model_name,
            "knowledge_corpus_version": self._build_knowledge_corpus_version(results),
            "prompt_template_version": self.MULTIMODAL_PROMPT_TEMPLATE_VERSION,
            "answer_confidence": assessment["answer_confidence"],
            "coverage_warnings": assessment["coverage_warnings"],
            "grounded": assessment["grounded"],
            "image_analysis": (
                {
                    "summary": image_analysis.summary,
                    "keywords": image_analysis.keywords,
                    "source": image_analysis.source,
                    "warning": image_analysis.warning,
                }
                if image_analysis is not None
                else None
            ),
            "graph_context": semantic_graph_context if semantic_graph_context.get("matched_entities") else None,
            "reasoning_chain": reasoning_chain,
            "results": results,
        }
        # ── 写入缓存（仅无图片请求）──────────────────────────────────────────
        if _cache_key is not None:
            await _cache.set_async(_cache_key, payload)
        return payload

    async def _hydrate_attachment_image_request(
        self,
        request: KnowledgeSearchRequest,
    ) -> tuple[KnowledgeSearchRequest, dict[str, Any]]:
        attachment_ids = list(request.attachment_ids or [])
        context = {
            "attachment_ids": attachment_ids,
            "used_attachment_ids": [],
            "ignored_attachment_ids": [],
            "image_input_source": "request_image" if request.image_base64 else "none",
            "resolved_image_filename": request.image_filename,
            "resolved_image_mime_type": request.image_mime_type,
        }
        if request.image_base64 or not attachment_ids:
            return request, context

        for attachment_id in attachment_ids[:3]:
            attachment = await self.session.get(Attachment, int(attachment_id))
            if attachment is None:
                raise ValueError(f"附件 #{attachment_id} 不存在，无法执行多模态检索。")
            if not (attachment.mime_type or "").startswith("image/"):
                context["ignored_attachment_ids"].append(int(attachment_id))
                continue
            path = self._attachment_storage_path(attachment.storage_key)
            if not path.is_file():
                raise ValueError(f"附件 #{attachment_id} 文件已丢失，无法执行多模态检索。")
            image_bytes = path.read_bytes()
            hydrated_request = request.model_copy(
                update={
                    "image_base64": base64.b64encode(image_bytes).decode("utf-8"),
                    "image_mime_type": attachment.mime_type,
                    "image_filename": Path(attachment.storage_key).name,
                }
            )
            context["used_attachment_ids"] = [int(attachment_id)]
            context["image_input_source"] = "attachment"
            context["resolved_image_filename"] = hydrated_request.image_filename
            context["resolved_image_mime_type"] = hydrated_request.image_mime_type
            return hydrated_request, context

        raise ValueError("提供的附件中未找到可用于多模态检索的图片。")

    def _attachment_storage_path(self, storage_key: str) -> Path:
        from app.core.config import get_settings

        upload_dir = Path(get_settings().maintenance_upload_dir)
        return upload_dir / storage_key

    def _build_input_modalities(
        self,
        request: KnowledgeSearchRequest,
        image_analysis: Any | None,
    ) -> list[str]:
        modalities: list[str] = []
        if request.query:
            modalities.append("text")
        if request.attachment_ids:
            modalities.append("attachment")
        if request.image_base64:
            modalities.append("image")
        if image_analysis is not None:
            if image_analysis.source == "glm_ocr":
                modalities.append("ocr")
            else:
                modalities.append("vision")
        deduped: list[str] = []
        for item in modalities:
            if item not in deduped:
                deduped.append(item)
        return deduped

    def _resolve_image_model_name(
        self,
        request: KnowledgeSearchRequest,
        image_analysis: Any | None,
    ) -> str | None:
        if image_analysis is None:
            return None
        if request.model_name:
            return request.model_name
        if image_analysis.source == "glm_ocr":
            return "glm-ocr"
        if request.model_provider == "anthropic":
            return "claude-sonnet-4-20250514"
        return "gpt-4o-mini"

    def _build_knowledge_corpus_version(self, results: list[dict[str, Any]]) -> str:
        from app.core.config import get_settings

        settings = get_settings()
        document_ids = sorted(
            {
                int(item["document_id"])
                for item in results
                if item.get("document_id") is not None
            }
        )
        doc_part = ",".join(str(item) for item in document_ids[:8]) or "none"
        return f"{settings.vector_store_backend}:{settings.embedding_model}:{doc_part}"

    async def search(
        self,
        request: KnowledgeSearchRequest,
        query_profile=None,
    ) -> list[dict[str, Any]]:
        """Search knowledge chunks with metadata filters."""
        query_profile = query_profile or infer_query_profile(
            query_bundle=[request.query or ""],
            has_image=bool(request.image_base64),
        )
        query = (request.query or "").strip()
        if not query and not any([request.equipment_type, request.equipment_model, request.fault_type]):
            return []

        sql_hits = await self._sql_search(request, query)
        vector_hits = await self._vector_search(request, query=query)
        bm25_hits = await self._bm25_search(request, query=query)
        merged = self._fuse_ranked_candidates(
            channels={
                "sql": sql_hits,
                "vector": vector_hits,
                "bm25": bm25_hits,
            },
            query_profile=query_profile,
        )
        reranked = self._rerank_results(request, merged, query_profile=query_profile)
        return await self._refine_procedural_results(
            request,
            reranked,
            query_profile=query_profile,
        )

    async def _sql_search(self, request: KnowledgeSearchRequest, query: str) -> list[dict[str, Any]]:
        dialect_name = self.session.get_bind().dialect.name
        tokens = self._extract_search_tokens(query) if query else []
        candidate_limit = self._resolve_candidate_limit(request.limit)

        if query and dialect_name == "postgresql":
            chunk_search_text = func.concat_ws(
                " ",
                func.coalesce(KnowledgeChunk.heading, ""),
                func.coalesce(KnowledgeChunk.content, ""),
                func.coalesce(KnowledgeChunk.equipment_model, ""),
                func.coalesce(KnowledgeChunk.fault_type, ""),
                func.coalesce(KnowledgeChunk.section_reference, ""),
                func.coalesce(KnowledgeChunk.section_path, ""),
                func.coalesce(KnowledgeChunk.step_anchor, ""),
                func.coalesce(KnowledgeChunk.page_reference, ""),
                func.coalesce(KnowledgeChunk.image_anchor, ""),
                func.coalesce(KnowledgeChunk.ocr_text, ""),
                func.coalesce(KnowledgeChunk.image_caption, ""),
                func.coalesce(KnowledgeChunk.evidence_summary, ""),
            )
            document_search_text = func.concat_ws(
                " ",
                func.coalesce(KnowledgeDocument.title, ""),
                func.coalesce(KnowledgeDocument.source_name, ""),
                func.coalesce(KnowledgeDocument.equipment_model, ""),
                func.coalesce(KnowledgeDocument.fault_type, ""),
            )
            chunk_tsv = func.to_tsvector("simple", chunk_search_text)
            document_tsv = func.to_tsvector("simple", document_search_text)
            ts_query_text = " ".join(tokens) if tokens else query
            ts_query = func.plainto_tsquery("simple", ts_query_text)
            chunk_match = chunk_tsv.bool_op("@@")(ts_query)
            document_match = document_tsv.bool_op("@@")(ts_query)
            token_score_expr, token_match_expr = self._build_token_search_expressions(tokens)
            score_expr = (
                case((chunk_match, func.ts_rank_cd(chunk_tsv, ts_query) * 8.0), else_=0.0)
                + case((document_match, func.ts_rank_cd(document_tsv, ts_query) * 5.0), else_=0.0)
                + token_score_expr
            )
            stmt = (
                select(KnowledgeChunk, KnowledgeDocument, score_expr.label("score"))
                .join(KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id)
                .where(KnowledgeDocument.status == "published")
                .where(or_(chunk_match, document_match, token_match_expr))
            )
        else:
            score_expr = literal(0.0)
            stmt = (
                select(KnowledgeChunk, KnowledgeDocument, score_expr.label("score"))
                .join(KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id)
                .where(KnowledgeDocument.status == "published")
            )
            if query:
                score_expr, token_match_expr = self._build_token_search_expressions(tokens)
                stmt = stmt.where(token_match_expr)

        stmt = self._apply_metadata_filters(stmt, request)
        stmt = stmt.order_by(
            score_expr.desc() if query else KnowledgeDocument.updated_at.desc(),
            KnowledgeChunk.chunk_index.asc(),
        )
        rows = (await self.session.execute(stmt.limit(candidate_limit))).all()
        results: list[dict[str, Any]] = []
        for chunk, document, score in rows:
            row = self._serialize_search_row(
                request=request,
                query=query,
                chunk=chunk,
                document=document,
                retrieval_score=score,
            )
            row["_retrieval_channel"] = "sql"
            row["_retrieval_path"] = ["sql"]
            results.append(row)
        return results

    def _serialize_search_row(
        self,
        *,
        request: KnowledgeSearchRequest,
        query: str,
        chunk: KnowledgeChunk,
        document: KnowledgeDocument,
        retrieval_score: float | None,
    ) -> dict[str, Any]:
        return serialize_search_row(
            request=request,
            query=query,
            chunk=chunk,
            document=document,
            retrieval_score=retrieval_score,
        )

    async def _build_semantic_graph_context(
        self,
        *,
        query: str,
        effective_keywords: list[str],
        relation_types: list[str] | None = None,
    ) -> dict[str, Any]:
        empty_context = {"matched_entities": [], "expanded_relations": [], "enhanced_keywords": []}
        search_text = _normalize_graph_match_text(" ".join([query, *effective_keywords]))
        if not search_text:
            return empty_context

        try:
            entities = (await self.session.execute(select(KgEntity).where(KgEntity.status != "merged"))).scalars().all()
            if not entities:
                return empty_context

            aliases = (
                await self.session.execute(
                    select(KgEntityAlias).where(KgEntityAlias.entity_id.in_([entity.id for entity in entities]))
                )
            ).scalars().all()
            alias_map: dict[int, list[str]] = {}
            for alias in aliases:
                alias_map.setdefault(alias.entity_id, []).append(alias.alias_name)

            keyword_texts = [_normalize_graph_match_text(keyword) for keyword in effective_keywords if keyword]
            matched: list[KgEntity] = []
            match_meta: dict[int, tuple[str, float]] = {}
            fuzzy_candidates: list[tuple[float, KgEntity]] = []
            for entity in entities:
                names = [entity.canonical_name, entity.display_name or "", *alias_map.get(entity.id, [])]
                normalized_names = [_normalize_graph_match_text(name) for name in names if name]
                if any(
                    name and (
                        name in search_text
                        or any(keyword and (name in keyword or keyword in name) for keyword in keyword_texts)
                    )
                    for name in normalized_names
                ):
                    matched.append(entity)
                    match_meta[entity.id] = ("exact_or_alias", 1.0)
                    continue
                score = _semantic_entity_similarity_score(search_text, keyword_texts, normalized_names)
                if score >= 0.72:
                    fuzzy_candidates.append((score, entity))
            if not matched and fuzzy_candidates:
                fuzzy_candidates.sort(key=lambda item: (-item[0], item[1].entity_type, item[1].id))
                for score, entity in fuzzy_candidates[:6]:
                    matched.append(entity)
                    match_meta[entity.id] = ("name_similarity", round(score, 4))
            matched = matched[:6]
            if not matched:
                return empty_context

            matched_ids = {entity.id for entity in matched}
            relation_type_set = {item.strip() for item in relation_types or [] if item and item.strip()}
            frontier = set(matched_ids)
            visited_relation_ids: set[int] = set()
            relation_rows: list[KgRelation] = []
            for _ in range(2):
                if not frontier:
                    break
                relation_stmt = select(KgRelation).where(
                    KgRelation.status == "approved",
                    KgRelation.confidence >= 0.6,
                    or_(
                        KgRelation.source_entity_id.in_(frontier),
                        KgRelation.target_entity_id.in_(frontier),
                    ),
                )
                if relation_type_set:
                    relation_stmt = relation_stmt.where(KgRelation.relation_type.in_(relation_type_set))
                relations = (await self.session.execute(relation_stmt)).scalars().all()
                next_frontier: set[int] = set()
                for relation in relations:
                    if relation.id in visited_relation_ids:
                        continue
                    visited_relation_ids.add(relation.id)
                    relation_rows.append(relation)
                    next_frontier.add(relation.source_entity_id)
                    next_frontier.add(relation.target_entity_id)
                frontier = next_frontier - matched_ids
                matched_ids.update(next_frontier)
                if len(relation_rows) >= 20:
                    relation_rows = relation_rows[:20]
                    break

            entity_map = {
                entity.id: entity
                for entity in (
                    await self.session.execute(select(KgEntity).where(KgEntity.id.in_(matched_ids)))
                ).scalars().all()
            }
            evidence_rows = []
            if relation_rows:
                evidence_rows = (
                    await self.session.execute(
                        select(KgRelationEvidence).where(
                            KgRelationEvidence.relation_id.in_([relation.id for relation in relation_rows])
                        )
                    )
                ).scalars().all()
            evidence_by_relation: dict[int, list[int]] = {}
            for evidence in evidence_rows:
                if evidence.chunk_id is not None:
                    evidence_by_relation.setdefault(evidence.relation_id, []).append(evidence.chunk_id)

            enhanced_keywords: list[str] = []
            for entity in entity_map.values():
                if entity.canonical_name not in enhanced_keywords:
                    enhanced_keywords.append(entity.canonical_name)

            return {
                "matched_entities": [
                    {
                        "id": entity.id,
                        "entity_type": entity.entity_type,
                        "canonical_name": entity.canonical_name,
                        "match_type": match_meta.get(entity.id, ("exact_or_alias", 1.0))[0],
                        "match_score": match_meta.get(entity.id, ("exact_or_alias", 1.0))[1],
                    }
                    for entity in matched
                ],
                "expanded_relations": [
                    {
                        "id": relation.id,
                        "relation_type": relation.relation_type,
                        "source_entity_id": relation.source_entity_id,
                        "source_name": entity_map[relation.source_entity_id].canonical_name,
                        "target_entity_id": relation.target_entity_id,
                        "target_name": entity_map[relation.target_entity_id].canonical_name,
                        "confidence": float(relation.confidence) if relation.confidence is not None else None,
                        "evidence_chunk_ids": evidence_by_relation.get(relation.id, []),
                    }
                    for relation in relation_rows
                    if relation.source_entity_id in entity_map and relation.target_entity_id in entity_map
                ],
                "enhanced_keywords": enhanced_keywords,
            }
        except Exception:
            logger.debug("semantic_graph_context_build_skipped", exc_info=True)
            return empty_context

    async def _load_semantic_graph_evidence_results(
        self,
        *,
        request: KnowledgeSearchRequest,
        graph_context: dict[str, Any],
    ) -> list[dict[str, Any]]:
        chunk_ids: list[int] = []
        for relation in graph_context.get("expanded_relations") or []:
            for chunk_id in relation.get("evidence_chunk_ids") or []:
                if chunk_id not in chunk_ids:
                    chunk_ids.append(chunk_id)
        if not chunk_ids:
            return []

        rows = (
            await self.session.execute(
                select(KnowledgeChunk, KnowledgeDocument)
                .join(KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id)
                .where(KnowledgeChunk.id.in_(chunk_ids))
                .where(KnowledgeDocument.status == "published")
            )
        ).all()
        order = {chunk_id: index for index, chunk_id in enumerate(chunk_ids)}
        results: list[dict[str, Any]] = []
        for chunk, document in rows:
            row = self._serialize_search_row(
                request=request,
                query=request.query or "",
                chunk=chunk,
                document=document,
                retrieval_score=max(0.65 - order.get(chunk.id, 0) * 0.01, 0.3),
            )
            row["_retrieval_channel"] = "semantic_graph_evidence"
            row["_retrieval_path"] = ["semantic_graph_evidence"]
            row["recommendation_reason"] = f"{row['recommendation_reason']}，来自语义图谱关系证据"
            results.append(row)
        results.sort(key=lambda item: order.get(item["chunk_id"], 9999))
        return results

    def _rerank_semantic_graph_results(
        self,
        results: list[dict[str, Any]],
        *,
        graph_context: dict[str, Any],
        limit: int,
    ) -> list[dict[str, Any]]:
        if not results:
            return results

        evidence_chunk_ids: set[int] = set()
        relation_confidence_by_chunk: dict[int, float] = {}
        for relation in graph_context.get("expanded_relations") or []:
            confidence = float(relation.get("confidence") or 0.0)
            for chunk_id in relation.get("evidence_chunk_ids") or []:
                evidence_chunk_ids.add(int(chunk_id))
                relation_confidence_by_chunk[int(chunk_id)] = max(
                    relation_confidence_by_chunk.get(int(chunk_id), 0.0),
                    confidence,
                )

        enhanced_keywords = [
            str(keyword)
            for keyword in graph_context.get("enhanced_keywords") or []
            if str(keyword or "").strip()
        ]

        def score(item: dict[str, Any]) -> tuple[float, int]:
            base = float(
                item.get("rerank_score")
                or item.get("score")
                or item.get("retrieval_score")
                or 0.0
            )
            chunk_id = int(item.get("chunk_id") or 0)
            boost = 0.0
            if chunk_id in evidence_chunk_ids:
                boost += 0.25 + relation_confidence_by_chunk.get(chunk_id, 0.0) * 0.15
            if item.get("_retrieval_channel") == "semantic_graph_evidence":
                boost += 0.15
            searchable = " ".join(
                str(item.get(key) or "")
                for key in ("title", "excerpt", "evidence_summary", "expanded_content")
            )
            boost += min(
                0.2,
                sum(0.05 for keyword in enhanced_keywords if keyword and keyword in searchable),
            )
            fused = round(base + boost, 4)
            item["rerank_score"] = max(float(item.get("rerank_score") or 0.0), fused)
            item["score"] = item["rerank_score"]
            return fused, -chunk_id

        return sorted(results, key=score, reverse=True)[:limit]

    def _build_reasoning_chain(
        self,
        *,
        question: str | None,
        graph_context: dict[str, Any],
        results: list[dict[str, Any]],
        confidence: float,
        warnings: list[str],
    ) -> dict[str, Any]:
        evidence_chunks = [
            {
                "chunk_id": item["chunk_id"],
                "document_id": item["document_id"],
                "title": item["title"],
                "source_name": item["source_name"],
                "citation_label": item.get("citation_label"),
                "section_reference": item.get("section_reference"),
                "page_reference": item.get("page_reference"),
                "excerpt": item.get("excerpt") or "",
                "score": item.get("score") or item.get("rerank_score") or item.get("retrieval_score"),
            }
            for item in results[:5]
            if item.get("chunk_id") is not None and item.get("document_id") is not None
        ]
        selected_claims = self._build_selected_answer_claims(graph_context, evidence_chunks)
        return {
            "question": question,
            "matched_entities": graph_context.get("matched_entities") or [],
            "expanded_relations": graph_context.get("expanded_relations") or [],
            "evidence_chunks": evidence_chunks,
            "selected_answer_claims": selected_claims,
            "confidence": round(float(confidence or 0.0), 4),
            "warnings": warnings,
            "explanation_text": self._build_reasoning_explanation(
                graph_context=graph_context,
                evidence_chunks=evidence_chunks,
                selected_claims=selected_claims,
            ),
        }

    def _build_selected_answer_claims(
        self,
        graph_context: dict[str, Any],
        evidence_chunks: list[dict[str, Any]],
    ) -> list[str]:
        claims: list[str] = []
        matched_names = [
            item["canonical_name"]
            for item in graph_context.get("matched_entities") or []
            if item.get("canonical_name")
        ]
        if matched_names:
            claims.append(f"问题命中了图谱实体：{'、'.join(matched_names[:4])}。")
        for relation in (graph_context.get("expanded_relations") or [])[:4]:
            source = relation.get("source_name")
            target = relation.get("target_name")
            relation_type = relation.get("relation_type")
            if source and target and relation_type:
                claims.append(f"{source} 通过 {relation_type} 指向 {target}。")
        if evidence_chunks:
            labels = [
                chunk.get("citation_label") or f"chunk:{chunk['chunk_id']}"
                for chunk in evidence_chunks[:3]
            ]
            claims.append(f"证据来源包括：{'、'.join(labels)}。")
        return claims

    def _build_reasoning_explanation(
        self,
        *,
        graph_context: dict[str, Any],
        evidence_chunks: list[dict[str, Any]],
        selected_claims: list[str],
    ) -> str:
        if not selected_claims:
            return "当前主要依据关键词与文档分段召回结果，尚未形成稳定图谱推理路径。"
        target = self._resolve_reasoning_target(graph_context, selected_claims)
        lines = [f"系统判断{target}，是因为："]
        lines.extend(f"{index}. {claim}" for index, claim in enumerate(selected_claims[:3], start=1))
        if evidence_chunks:
            first = evidence_chunks[0]
            source = first.get("source_name") or first.get("title")
            section = first.get("section_reference") or first.get("page_reference")
            suffix = f" {section}" if section else ""
            lines.append(f"{len(lines)}. 对应证据来自《{source}》{suffix}。")
        return "\n".join(lines)

    @staticmethod
    def _resolve_reasoning_target(graph_context: dict[str, Any], selected_claims: list[str]) -> str:
        for relation in graph_context.get("expanded_relations") or []:
            target = str(relation.get("target_name") or "").strip()
            if target:
                return f"优先排查{target}"
        for claim in selected_claims:
            text = str(claim).strip("。")
            if "指向" in text:
                target = text.rsplit("指向", maxsplit=1)[-1].strip()
                if target:
                    return f"优先排查{target}"
        return "生成当前建议"

    async def _expand_chunk_context(
        self,
        chunk_id: int,
        document_id: int,
        *,
        section_path: str | None = None,
        section_reference: str | None = None,
        window: int = 1,
    ) -> str:
        """Small-to-big: fetch adjacent chunks from the same section and merge content."""
        stmt = select(
            KnowledgeChunk.id,
            KnowledgeChunk.content,
            KnowledgeChunk.chunk_index,
            KnowledgeChunk.section_path,
            KnowledgeChunk.section_reference,
        ).where(KnowledgeChunk.document_id == document_id)

        normalized_section_path = str(section_path or "").strip()
        normalized_section_reference = str(section_reference or "").strip()
        if normalized_section_path:
            stmt = stmt.where(KnowledgeChunk.section_path == normalized_section_path)
        elif normalized_section_reference:
            stmt = stmt.where(KnowledgeChunk.section_reference == normalized_section_reference)

        stmt = stmt.order_by(KnowledgeChunk.chunk_index.asc(), KnowledgeChunk.id.asc())
        rows = (await self.session.execute(stmt)).all()
        ids = [row.id for row in rows]
        contents = {row.id: row.content or "" for row in rows}
        if chunk_id not in ids:
            return contents.get(chunk_id, "")
        idx = ids.index(chunk_id)
        start = max(0, idx - window)
        end = min(len(ids), idx + window + 1)
        return "\n\n".join(contents[ids[i]] for i in range(start, end) if contents.get(ids[i]))

    async def _vector_search(
        self,
        request: KnowledgeSearchRequest,
        *,
        query: str,
    ) -> list[dict[str, Any]]:
        if not query:
            return []
        try:
            from app.services.embedding_service import get_embedding_service

            svc = get_embedding_service()
            if svc is None:
                return []
            hits = await svc.search(query, top_k=request.limit * 3)
            if not hits:
                return []
            chunk_ids = [chunk_id for chunk_id, _ in hits]
            score_map = {chunk_id: score for chunk_id, score in hits}
            stmt = (
                select(KnowledgeChunk, KnowledgeDocument)
                .join(KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id)
                .where(KnowledgeChunk.id.in_(chunk_ids))
                .where(KnowledgeDocument.status == "published")
            )
            stmt = self._apply_metadata_filters(stmt, request)
            rows = (await self.session.execute(stmt)).all()
            results: list[dict[str, Any]] = []
            for chunk, document in rows:
                mapped_score = score_map.get(chunk.id, 0.0)
                row = self._serialize_search_row(
                    request=request,
                    query=query,
                    chunk=chunk,
                    document=document,
                    retrieval_score=mapped_score,
                )
                row["_retrieval_channel"] = "vector"
                results.append(row)
            results.sort(
                key=lambda item: (
                    float(item.get("retrieval_score") or 0.0),
                    item["chunk_id"],
                ),
                reverse=True,
            )
            return results
        except Exception:
            import logging

            logging.getLogger(__name__).debug("vector_search failed, falling back", exc_info=True)
            return []

    async def _bm25_search(
        self,
        request: KnowledgeSearchRequest,
        *,
        query: str,
    ) -> list[dict[str, Any]]:
        """BM25 lexical search as a third retrieval channel."""
        if not query:
            return []
        try:
            from app.services.bm25_service import get_bm25_service

            svc = get_bm25_service()
            if svc is None:
                return []
            hits = svc.search(query, top_k=request.limit * 3)
            if not hits:
                return []
            chunk_ids = [chunk_id for chunk_id, _ in hits]
            score_map = {chunk_id: score for chunk_id, score in hits}
            stmt = (
                select(KnowledgeChunk, KnowledgeDocument)
                .join(KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id)
                .where(KnowledgeChunk.id.in_(chunk_ids))
                .where(KnowledgeDocument.status == "published")
            )
            stmt = self._apply_metadata_filters(stmt, request)
            rows = (await self.session.execute(stmt)).all()
            results: list[dict[str, Any]] = []
            for chunk, document in rows:
                row = self._serialize_search_row(
                    request=request,
                    query=query,
                    chunk=chunk,
                    document=document,
                    retrieval_score=score_map.get(chunk.id, 0.0),
                )
                row["_retrieval_channel"] = "bm25"
                results.append(row)
            results.sort(
                key=lambda item: (
                    float(item.get("retrieval_score") or 0.0),
                    item["chunk_id"],
                ),
                reverse=True,
            )
            return results
        except Exception:
            return []

    def _apply_metadata_filters(self, stmt: Any, request: KnowledgeSearchRequest) -> Any:
        if request.equipment_type:
            stmt = stmt.where(self._build_equipment_type_filter(request.equipment_type))
        if request.equipment_model:
            stmt = stmt.where(self._build_equipment_model_filter(request.equipment_model))
        if request.fault_type:
            stmt = stmt.where(KnowledgeChunk.fault_type == request.fault_type)
        return stmt

    async def _refine_procedural_results(
        self,
        request: KnowledgeSearchRequest,
        results: list[dict[str, Any]],
        *,
        query_profile: Any | None = None,
    ) -> list[dict[str, Any]]:
        if not results:
            return results
        query_text = (request.query or "").strip()
        procedural_query = (
            getattr(query_profile, "query_type", None) == "procedural"
            or any(marker in query_text for marker in ("步骤", "流程", "顺序", "拆卸", "拆下", "安装", "更换"))
        )
        if not procedural_query:
            return results
        procedural_analysis = analyze_procedural_query(query_text)

        if procedural_analysis.scope == "single_step":
            step_ranked = sorted(
                results,
                key=lambda item: (
                    self._score_procedural_item_match(item, procedural_analysis),
                    float(item.get("rerank_score") or item.get("retrieval_score") or 0.0),
                    item["chunk_id"],
                ),
                reverse=True,
            )
            top_step_score = self._score_procedural_item_match(step_ranked[0], procedural_analysis)
            if top_step_score > 0:
                filtered = [
                    item
                    for item in step_ranked
                    if self._score_procedural_item_match(item, procedural_analysis) >= max(top_step_score - 1.2, 1.0)
                ]
                return filtered[: request.limit]

        ranked_sections = self._rank_procedural_sections(query_text, results)
        if not ranked_sections:
            return results

        best_key, best_items, best_score = ranked_sections[0]
        if not best_key or best_score <= 0:
            return results

        second_score = ranked_sections[1][2] if len(ranked_sections) > 1 else None
        if second_score is not None and best_score < second_score + 2:
            return results

        expanded_section = await self._load_section_siblings(
            request=request,
            section_key=best_key,
            anchor_items=best_items,
        )
        if not expanded_section:
            return results

        if len(expanded_section) >= min(request.limit, 4):
            return expanded_section[: request.limit]

        expanded_ids = {item["chunk_id"] for item in expanded_section}
        remainder = [item for item in results if item["chunk_id"] not in expanded_ids]
        combined = expanded_section + remainder
        return combined[: request.limit]

    def _rank_procedural_sections(
        self,
        query: str,
        results: list[dict[str, Any]],
    ) -> list[tuple[tuple[int, str, str], list[dict[str, Any]], float]]:
        focus_terms = self._extract_procedural_focus_terms(query)
        procedural_analysis = analyze_procedural_query(query)
        buckets: dict[tuple[int, str, str], list[dict[str, Any]]] = {}

        for item in results[: max(12, len(results))]:
            section_path = str(item.get("section_path") or "").strip()
            section_reference = str(item.get("section_reference") or "").strip()
            section_value = section_path or section_reference
            if not section_value:
                continue
            key = (
                int(item.get("document_id") or 0),
                "section_path" if section_path else "section_reference",
                section_value,
            )
            buckets.setdefault(key, []).append(item)

        ranked: list[tuple[tuple[int, str, str], list[dict[str, Any]], float]] = []
        for key, items in buckets.items():
            score = 0.0
            section_text = " ".join(
                str(part or "")
                for part in (
                    key[2],
                    items[0].get("title"),
                    items[0].get("excerpt"),
                )
            )
            for term in focus_terms:
                if term and term in section_text:
                    score += 4.0
            if procedural_analysis.action and procedural_analysis.action in key[2]:
                score += 4.5
            if procedural_analysis.object_terms:
                score += sum(2.8 for term in procedural_analysis.object_terms if term in key[2])
            if any(term in query for term in ("拆卸", "拆下")) and "安装" in section_text:
                score -= 6.0
            if procedural_analysis.action == "检查" and "安装" in section_text and "检查" not in key[2]:
                score -= 4.2
            if procedural_analysis.action in {"拆卸", "拆下"} and "检查" in key[2] and not any(
                term in key[2] for term in procedural_analysis.object_terms
            ):
                score -= 2.2
            if "装配部件清单" in section_text:
                score -= 8.0
            if any(term in section_text for term in ("步骤", "流程", "顺序", "拆卸", "拆下")):
                score += 3.5
            if any(term in query for term in ("发动机",)) and "发动机" in section_text:
                score += 3.0
            score += max(float(item.get("rerank_score") or item.get("retrieval_score") or 0.0) for item in items)
            score += max(len(items) - 1, 0) * 0.8
            ranked.append((key, items, score))

        ranked.sort(key=lambda entry: entry[2], reverse=True)
        return ranked

    async def _load_section_siblings(
        self,
        *,
        request: KnowledgeSearchRequest,
        section_key: tuple[int, str, str],
        anchor_items: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        document_id, field_name, field_value = section_key
        if not document_id or not field_value:
            return []

        field = KnowledgeChunk.section_path if field_name == "section_path" else KnowledgeChunk.section_reference
        stmt = (
            select(KnowledgeChunk, KnowledgeDocument)
            .join(KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id)
            .where(KnowledgeChunk.document_id == document_id)
            .where(field == field_value)
            .where(KnowledgeDocument.status == "published")
            .order_by(KnowledgeChunk.chunk_index.asc())
        )
        rows = (await self.session.execute(stmt)).all()
        if not rows:
            return []

        anchor_by_chunk_id = {int(item["chunk_id"]): item for item in anchor_items if item.get("chunk_id") is not None}
        lead_score = max(float(item.get("rerank_score") or item.get("retrieval_score") or 0.0) for item in anchor_items)

        section_results: list[dict[str, Any]] = []
        for index, row in enumerate(rows):
            chunk, document = row[0], row[1]
            serialized = self._serialize_search_row(
                request=request,
                query=(request.query or "").strip(),
                chunk=chunk,
                document=document,
                retrieval_score=max(lead_score - index * 0.01, 0.0),
            )
            existing = anchor_by_chunk_id.get(int(chunk.id))
            if existing is not None:
                serialized["retrieval_score"] = existing.get("retrieval_score")
                serialized["rerank_score"] = existing.get("rerank_score")
                serialized["score"] = existing.get("score") or existing.get("rerank_score")
                serialized["recommendation_reason"] = existing.get("recommendation_reason") or serialized["recommendation_reason"]
            else:
                serialized["rerank_score"] = round(max(lead_score - index * 0.01, 0.0), 4)
                serialized["score"] = serialized["rerank_score"]
                serialized["recommendation_reason"] = f"{serialized['recommendation_reason']}，同章节步骤展开"
            serialized["_retrieval_channel"] = "section_expand"
            serialized["_retrieval_path"] = list(existing.get("_retrieval_path") or []) if existing else ["section_expand"]
            if "section_expand" not in serialized["_retrieval_path"]:
                serialized["_retrieval_path"].append("section_expand")
            section_results.append(serialized)
        return section_results

    def _extract_procedural_focus_terms(self, query: str) -> list[str]:
        procedural_analysis = analyze_procedural_query(query)
        if procedural_analysis.focus_terms:
            return list(procedural_analysis.focus_terms)
        focus_terms = self._extract_search_tokens(query)
        preferred: list[str] = []
        for term in focus_terms:
            if term in {"步骤", "流程", "顺序", "操作"}:
                continue
            preferred.append(term)
        return preferred[:6]

    def _score_procedural_item_match(
        self,
        item: dict[str, Any],
        procedural_analysis,
    ) -> float:
        if not getattr(procedural_analysis, "is_procedural", False):
            return 0.0
        structural_text = " ".join(
            str(part or "")
            for part in (
                item.get("section_reference"),
                item.get("section_path"),
                item.get("step_anchor"),
            )
        )
        narrative_text = " ".join(
            str(part or "")
            for part in (
                item.get("title"),
                item.get("excerpt"),
                item.get("expanded_content"),
            )
        )
        score = 0.0
        if procedural_analysis.action:
            if procedural_analysis.action in structural_text:
                score += 3.4
            elif procedural_analysis.action in narrative_text:
                score += 1.0
        for term in procedural_analysis.object_terms:
            if term in structural_text:
                score += 2.3
            elif term in narrative_text:
                score += 0.7
        if procedural_analysis.scope == "single_step" and item.get("step_anchor"):
            score += 1.4
        return score

    def _build_equipment_type_filter(self, equipment_type: str) -> Any:
        candidates = self._expand_equipment_type_candidates(equipment_type)
        clauses = []
        for candidate in candidates:
            like_value = f"%{candidate}%"
            clauses.extend(
                [
                    KnowledgeChunk.equipment_type == candidate,
                    KnowledgeDocument.equipment_type == candidate,
                    KnowledgeChunk.equipment_type.ilike(like_value),
                    KnowledgeDocument.equipment_type.ilike(like_value),
                    KnowledgeDocument.title.ilike(like_value),
                    KnowledgeDocument.source_name.ilike(like_value),
                ]
            )
        return or_(*clauses)

    def _expand_equipment_type_candidates(self, equipment_type: str) -> list[str]:
        normalized = equipment_type.strip()
        if not normalized:
            return []
        candidates = [normalized]
        for suffix in ("发动机", "设备", "系统", "总成"):
            if normalized.endswith(suffix):
                trimmed = normalized[: -len(suffix)].strip()
                if trimmed:
                    candidates.append(trimmed)
        deduped: list[str] = []
        seen: set[str] = set()
        for item in candidates:
            lowered = item.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            deduped.append(item)
        return deduped

    def _fuse_ranked_candidates(
        self,
        *,
        channels: dict[str, list[dict[str, Any]]],
        query_profile: Any,
    ) -> list[dict[str, Any]]:
        weights = {"sql": 1.0, "vector": 0.9, "bm25": 0.75}
        fused: dict[int, dict[str, Any]] = {}
        for channel_name, items in channels.items():
            for rank, item in enumerate(items):
                chunk_id = item["chunk_id"]
                fused_score = weights.get(channel_name, 0.7) / (60 + rank + 1)
                candidate = fused.setdefault(chunk_id, dict(item))
                candidate["_raw_scores"] = list(candidate.get("_raw_scores") or [])
                candidate["_raw_scores"].append(float(item.get("retrieval_score") or 0.0))
                candidate["_fusion_score"] = float(candidate.get("_fusion_score") or 0.0) + fused_score
                candidate["retrieval_score"] = candidate["_fusion_score"]
                candidate["score"] = candidate["retrieval_score"]
                candidate["rerank_score"] = candidate["retrieval_score"]
                path = list(candidate.get("_retrieval_path") or [])
                if channel_name not in path:
                    path.append(channel_name)
                candidate["_retrieval_path"] = path
                if "_retrieval_channel" not in candidate:
                    candidate["_retrieval_channel"] = channel_name
                if float(item.get("retrieval_score") or 0.0) > float(candidate.get("_best_raw_score") or float("-inf")):
                    candidate["_best_raw_score"] = float(item.get("retrieval_score") or 0.0)
                    for field in (
                        "excerpt",
                        "expanded_content",
                        "recommendation_reason",
                        "_content",
                        "_heading",
                    ):
                        if item.get(field) is not None:
                            candidate[field] = item.get(field)
        for candidate in fused.values():
            self._apply_query_profile_bonus(candidate, query_profile)
        ranked = sorted(
            fused.values(),
            key=lambda item: (
                float(item.get("retrieval_score") or 0.0),
                float(item.get("_best_raw_score") or 0.0),
                item["chunk_id"],
            ),
            reverse=True,
        )
        return ranked

    def _apply_query_profile_bonus(self, candidate: dict[str, Any], query_profile: Any) -> None:
        modality = candidate.get("source_modality") or "text"
        bonus = 0.0
        modality_bonus = getattr(query_profile, "modality_bonus", {}) or {}
        bonus += float(modality_bonus.get(modality, 0.0))
        if candidate.get("step_anchor"):
            bonus += float(getattr(query_profile, "step_anchor_bonus", 0.0) or 0.0)
        if candidate.get("section_path"):
            bonus += float(getattr(query_profile, "section_path_bonus", 0.0) or 0.0)
        source_type_bonus = getattr(query_profile, "source_type_bonus", {}) or {}
        bonus += float(source_type_bonus.get(candidate.get("source_type") or "", 0.0))
        if bonus:
            candidate["retrieval_score"] = float(candidate.get("retrieval_score") or 0.0) + bonus
            candidate["score"] = candidate["retrieval_score"]
            candidate["rerank_score"] = candidate["retrieval_score"]

    def _fuse_variant_results(
        self,
        variant_result_sets: list[list[dict[str, Any]]],
    ) -> list[dict[str, Any]]:
        fused: dict[int, dict[str, Any]] = {}
        rrf_k = 20
        for variant_index, items in enumerate(variant_result_sets):
            variant_weight = 1.0 if variant_index == 0 else 0.92
            for rank, item in enumerate(items):
                chunk_id = item["chunk_id"]
                rank_score = variant_weight / (rrf_k + rank + 1)
                candidate = fused.setdefault(chunk_id, dict(item))
                existing_path = list(candidate.get("_retrieval_path") or [])
                candidate["_variant_fusion_score"] = float(candidate.get("_variant_fusion_score") or 0.0) + rank_score
                candidate["_variant_hits"] = int(candidate.get("_variant_hits") or 0) + 1
                if float(item.get("rerank_score") or item.get("score") or 0.0) > float(
                    candidate.get("rerank_score") or candidate.get("score") or 0.0
                ):
                    for key, value in item.items():
                        candidate[key] = value
                path = existing_path or list(candidate.get("_retrieval_path") or [])
                for channel in item.get("_retrieval_path") or []:
                    if channel not in path:
                        path.append(channel)
                candidate["_retrieval_path"] = path

        ranked = sorted(
            fused.values(),
            key=lambda item: (
                float(item.get("_variant_fusion_score") or 0.0),
                int(item.get("_variant_hits") or 0),
                float(item.get("rerank_score") or item.get("score") or 0.0),
                float(item.get("retrieval_score") or 0.0),
                item["chunk_id"],
            ),
            reverse=True,
        )
        return ranked

    async def _attach_expanded_context(self, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        enriched: list[dict[str, Any]] = []
        for item in results:
            expanded = await self._expand_chunk_context(
                chunk_id=item["chunk_id"],
                document_id=item["document_id"],
                section_path=item.get("section_path"),
                section_reference=item.get("section_reference"),
                window=1,
            )
            source_modality = item.get("source_modality") or self._infer_source_modality(item)
            enriched_item = dict(item)
            enriched_item["source_modality"] = source_modality
            enriched_item["expanded_content"] = expanded or item.get("_content")
            if not enriched_item.get("ocr_text") and source_modality in {"ocr", "vision", "image"}:
                enriched_item["ocr_text"] = item.get("_content")
            enriched.append(enriched_item)
        return enriched

    def _assign_citation_labels(self, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        labeled: list[dict[str, Any]] = []
        for index, item in enumerate(results, start=1):
            labeled_item = dict(item)
            labeled_item["citation_label"] = f"C{index}"
            labeled.append(labeled_item)
        return labeled

    def _infer_source_modality(self, item: dict[str, Any]) -> str:
        image_anchor = (item.get("image_anchor") or "").strip().lower()
        source_name = (item.get("source_name") or "").strip().lower()
        if image_anchor or source_name.endswith((".png", ".jpg", ".jpeg", ".webp")):
            return "ocr"
        return "text"

    def _collect_retrieval_channels(self, results: list[dict[str, Any]]) -> list[str]:
        channels: list[str] = []
        for item in results:
            for channel in item.get("_retrieval_path") or []:
                if channel not in channels:
                    channels.append(channel)
        return channels

    def _merge_candidates(
        self,
        keyword_results: list[dict[str, Any]],
        vector_results: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return merge_candidates(keyword_results, vector_results)

    def _rerank_results(
        self,
        request: KnowledgeSearchRequest,
        candidates: list[dict[str, Any]],
        *,
        query_profile: Any | None = None,
    ) -> list[dict[str, Any]]:
        return rerank_results(request, candidates, query_profile=query_profile)

    def _resolve_candidate_limit(self, limit: int) -> int:
        return resolve_candidate_limit(limit)

    def _compute_equipment_model_bonus(
        self,
        request: KnowledgeSearchRequest,
        item: dict[str, Any],
    ) -> float:
        return compute_equipment_model_bonus(request, item)

    def _compute_fault_type_bonus(
        self,
        request: KnowledgeSearchRequest,
        item: dict[str, Any],
    ) -> float:
        return compute_fault_type_bonus(request, item)

    def _compute_source_type_bonus(
        self,
        request: KnowledgeSearchRequest,
        item: dict[str, Any],
    ) -> float:
        return compute_source_type_bonus(request, item)

    def _compute_token_coverage_bonus(
        self,
        request: KnowledgeSearchRequest,
        item: dict[str, Any],
    ) -> tuple[float, list[str]]:
        return compute_token_coverage_bonus(request, item)

    def _compute_recency_bonus(self, updated_at: Any) -> float:
        return compute_recency_bonus(updated_at)

    def _contains_safety_terms(self, item: dict[str, Any]) -> bool:
        return contains_safety_terms(item)

    async def _ensure_device_model(self, data: KnowledgeDocumentCreate) -> None:
        await ensure_device_model(self.session, data)

    def _build_excerpt(self, content: str, query: str) -> str:
        return build_excerpt(content, query)

    def _build_reason(
        self,
        request: KnowledgeSearchRequest,
        document: KnowledgeDocument,
        chunk: KnowledgeChunk,
    ) -> str:
        return build_reason(request, document, chunk)

    def _build_effective_keywords(
        self,
        query: str | None,
        equipment_model: str | None,
        fault_type: str | None,
        image_keywords: list[str] | None = None,
    ) -> list[str]:
        """Build a deterministic rewritten keyword set for retrieval and UI display."""
        return build_effective_keywords(
            query=query,
            equipment_model=equipment_model,
            fault_type=fault_type,
            image_keywords=image_keywords,
        )

    def _extract_search_tokens(self, query: str) -> list[str]:
        """Extract deterministic retrieval tokens for Chinese/English maintenance queries."""
        return extract_search_tokens(query)

    def _expand_tokens_with_synonyms(self, query: str, tokens: list[str]) -> list[str]:
        """Expand extracted tokens with deterministic maintenance-domain synonyms."""
        return expand_tokens_with_synonyms(query, tokens)

    def _apply_query_rewrite_rules(self, query: str, tokens: list[str]) -> list[str]:
        """Inject canonical maintenance terms when a known symptom pattern appears."""
        return apply_query_rewrite_rules(query, tokens)

    def _build_equipment_model_filter(self, equipment_model: str) -> Any:
        return build_equipment_model_filter(equipment_model)

    def _build_token_search_expressions(self, tokens: list[str]) -> tuple[Any, Any]:
        return build_token_search_expressions(tokens)

    def _prepare_chunk_payloads(
        self,
        data: KnowledgeDocumentCreate,
        chunk_payloads: list[dict[str, str | None]] | None = None,
    ) -> list[dict[str, str | None]]:
        return prepare_chunk_payloads(data, chunk_payloads)


__all__ = ["KnowledgeService", "split_text_into_chunks"]
