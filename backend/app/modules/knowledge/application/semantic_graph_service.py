"""Semantic knowledge graph query service."""
from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from difflib import SequenceMatcher

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import (
    KgExtractedCandidate,
    KgExtractionJob,
    KgEntity,
    KgEntityAlias,
    KgEntityMerge,
    KgEntityReview,
    KgRelation,
    KgRelationEvidence,
    KgRelationReview,
    KnowledgeChunk,
    KnowledgeDocument,
)
from app.modules.knowledge.schemas.semantic_graph import (
    SemanticEntitySearchItem,
    SemanticEntitySearchResponse,
    SemanticExtractionCandidate,
    SemanticDuplicateEntityCandidate,
    SemanticDuplicateEntityRecommendationResponse,
    SemanticExtractionCandidateListResponse,
    SemanticExtractionCandidateReviewCreate,
    SemanticExtractionFromDocumentRequest,
    SemanticExtractionJob,
    SemanticExtractionJobCreate,
    SemanticExtractionJobDetail,
    SemanticGraphEntity,
    SemanticGraphEntityAlias,
    SemanticGraphEntityAliasCreate,
    SemanticGraphEntityCreate,
    SemanticGraphEntityDetail,
    SemanticGraphEntityMergeCreate,
    SemanticGraphEntityMergeResponse,
    SemanticGraphEntityReviewCreate,
    SemanticGraphEntityUpdate,
    SemanticGraphRelation,
    SemanticGraphRelationCreate,
    SemanticGraphRelationDetail,
    SemanticGraphRelationEvidence,
    SemanticGraphRelationEvidenceCreate,
    SemanticGraphRelationReviewCreate,
    SemanticGraphRelationUpdate,
    SemanticGraphResponse,
    SemanticGraphStatsResponse,
    SemanticGraphQualityStatsResponse,
)


COMPONENT_TERMS = (
    "火花塞",
    "节气门",
    "空气滤芯",
    "燃油泵",
    "喷油嘴",
    "正时链条",
    "气门间隙",
    "点火线圈",
)
CAUSE_TERMS = (
    "混合气过浓",
    "积碳",
    "堵塞",
    "点火异常",
    "燃油供给异常",
    "供油不足",
)
ACTION_TERMS = (
    "检查",
    "清洗",
    "更换",
    "调整",
    "拆卸",
    "测量",
    "复核",
    "测试",
)
MITIGATION_ACTION_TERMS = (
    "停机",
    "断电",
    "冷却",
    "通风",
    "隔离",
)
SAFETY_RISK_TERMS = (
    "燃油风险",
    "高温烫伤",
    "点火高压",
    "电气短路",
    "异物进入缸体",
)
STANDARD_PARAMETER_TERMS = (
    "火花塞间隙",
    "气门间隙",
    "紧固扭矩",
    "点火线圈阻值",
)
FORBIDDEN_ACTION_TERMS = (
    "带电检查点火线圈",
    "高温拆检",
    "未停机拆检",
)
APPLICABLE_CONDITION_TERMS = (
    "发动机高温",
    "未断电",
    "未停机",
    "燃油未隔离",
)


def _to_float(value: Decimal | float | int | None) -> float | None:
    if value is None:
        return None
    return float(value)


def _entity_schema(row: KgEntity) -> SemanticGraphEntity:
    return SemanticGraphEntity(
        id=row.id,
        entity_type=row.entity_type,
        canonical_name=row.canonical_name,
        display_name=row.display_name,
        description=row.description,
        status=row.status,
        source_type=row.source_type,
        confidence=_to_float(row.confidence),
        attributes=row.attributes or {},
        primary_chunk_id=row.primary_chunk_id,
        primary_document_id=row.primary_document_id,
    )


def _alias_schema(row: KgEntityAlias) -> SemanticGraphEntityAlias:
    return SemanticGraphEntityAlias(
        id=row.id,
        entity_id=row.entity_id,
        alias_name=row.alias_name,
        alias_type=row.alias_type,
        confidence=_to_float(row.confidence),
        status=row.status,
        created_at=row.created_at.isoformat() if row.created_at else "",
        updated_at=row.updated_at.isoformat() if row.updated_at else "",
    )


def _relation_schema(row: KgRelation) -> SemanticGraphRelation:
    return SemanticGraphRelation(
        id=row.id,
        source_entity_id=row.source_entity_id,
        target_entity_id=row.target_entity_id,
        relation_type=row.relation_type,
        directional=row.directional,
        weight=_to_float(row.weight),
        confidence=_to_float(row.confidence),
        status=row.status,
        source_type=row.source_type,
        evidence_summary=row.evidence_summary,
        notes=row.notes,
        attributes=row.attributes or {},
        created_at=row.created_at.isoformat() if row.created_at else "",
        updated_at=row.updated_at.isoformat() if row.updated_at else "",
    )


def _evidence_schema(row: KgRelationEvidence) -> SemanticGraphRelationEvidence:
    return SemanticGraphRelationEvidence(
        id=row.id,
        relation_id=row.relation_id,
        chunk_id=row.chunk_id,
        document_id=row.document_id,
        excerpt=row.excerpt,
        page_reference=row.page_reference,
        section_reference=row.section_reference,
        evidence_type=row.evidence_type,
        confidence=_to_float(row.confidence),
        created_at=row.created_at.isoformat() if row.created_at else "",
    )


def _job_schema(row: KgExtractionJob) -> SemanticExtractionJob:
    return SemanticExtractionJob(
        id=row.id,
        job_type=row.job_type,
        trigger_source=row.trigger_source,
        document_id=row.document_id,
        chunk_id=row.chunk_id,
        case_id=row.case_id,
        status=row.status,
        summary=row.summary,
        error_message=row.error_message,
        started_at=row.started_at.isoformat() if row.started_at else None,
        finished_at=row.finished_at.isoformat() if row.finished_at else None,
        created_at=row.created_at.isoformat() if row.created_at else "",
    )


def _candidate_schema(row: KgExtractedCandidate) -> SemanticExtractionCandidate:
    return SemanticExtractionCandidate(
        id=row.id,
        job_id=row.job_id,
        candidate_type=row.candidate_type,
        payload=row.payload or {},
        normalized_payload=row.normalized_payload or {},
        confidence=_to_float(row.confidence),
        status=row.status,
        review_note=row.review_note,
        chunk_id=row.chunk_id,
        document_id=row.document_id,
        created_at=row.created_at.isoformat() if row.created_at else "",
        updated_at=row.updated_at.isoformat() if row.updated_at else "",
    )


class SemanticKnowledgeGraphService:
    """Query and maintenance service for semantic graph entities and relations."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_extraction_job(
        self,
        data: SemanticExtractionJobCreate,
    ) -> SemanticExtractionJobDetail:
        now = datetime.now(UTC).replace(tzinfo=None)
        job = KgExtractionJob(
            job_type=data.job_type,
            trigger_source=data.trigger_source,
            document_id=data.document_id,
            chunk_id=data.chunk_id,
            case_id=data.case_id,
            status="completed",
            summary=data.summary,
            started_at=now,
            finished_at=now,
        )
        self._session.add(job)
        await self._session.flush()

        candidates = [
            KgExtractedCandidate(
                job_id=job.id,
                candidate_type=item.candidate_type,
                payload=item.payload,
                normalized_payload=item.normalized_payload,
                confidence=item.confidence,
                status=item.status,
                review_note=item.review_note,
                chunk_id=item.chunk_id or data.chunk_id,
                document_id=item.document_id or data.document_id,
            )
            for item in data.candidates
        ]
        self._session.add_all(candidates)
        await self._session.commit()
        await self._session.refresh(job)
        for candidate in candidates:
            await self._session.refresh(candidate)
        return SemanticExtractionJobDetail(
            job=_job_schema(job),
            candidates=[_candidate_schema(candidate) for candidate in candidates],
        )

    async def create_rule_extraction_job_from_document(
        self,
        document_id: int,
        data: SemanticExtractionFromDocumentRequest,
    ) -> SemanticExtractionJobDetail | None:
        document = await self._session.get(KnowledgeDocument, document_id)
        if document is None:
            return None

        chunks = (
            await self._session.execute(
                select(KnowledgeChunk)
                .where(KnowledgeChunk.document_id == document_id)
                .order_by(KnowledgeChunk.chunk_index.asc())
                .limit(data.limit_chunks)
            )
        ).scalars().all()
        now = datetime.now(UTC).replace(tzinfo=None)
        job = KgExtractionJob(
            job_type=data.job_type,
            trigger_source=data.trigger_source,
            document_id=document_id,
            status="completed",
            summary=f"Rule extraction generated from {len(chunks)} chunks.",
            started_at=now,
            finished_at=now,
        )
        self._session.add(job)
        await self._session.flush()

        candidates: list[KgExtractedCandidate] = []
        for chunk in chunks:
            for item in _extract_candidates_from_chunk(
                document=document,
                chunk=chunk,
                include_relations=data.include_relations,
            ):
                candidates.append(
                    KgExtractedCandidate(
                        job_id=job.id,
                        candidate_type=item["candidate_type"],
                        payload=item["payload"],
                        confidence=item["confidence"],
                        status=data.status,
                        chunk_id=chunk.id,
                        document_id=document.id,
                    )
                )
        self._session.add_all(candidates)
        await self._session.commit()
        await self._session.refresh(job)
        for candidate in candidates:
            await self._session.refresh(candidate)
        return SemanticExtractionJobDetail(
            job=_job_schema(job),
            candidates=[_candidate_schema(candidate) for candidate in candidates],
        )

    async def list_extraction_candidates(
        self,
        *,
        candidate_type: str | None = None,
        status: str | None = "pending_review",
        job_id: int | None = None,
        limit: int = 50,
    ) -> SemanticExtractionCandidateListResponse:
        stmt = select(KgExtractedCandidate)
        if candidate_type:
            stmt = stmt.where(KgExtractedCandidate.candidate_type == candidate_type)
        if status:
            stmt = stmt.where(KgExtractedCandidate.status == status)
        if job_id:
            stmt = stmt.where(KgExtractedCandidate.job_id == job_id)
        stmt = stmt.order_by(KgExtractedCandidate.updated_at.desc()).limit(limit)
        rows = (await self._session.execute(stmt)).scalars().all()
        return SemanticExtractionCandidateListResponse(
            total=len(rows),
            items=[_candidate_schema(row) for row in rows],
        )

    async def review_extraction_candidate(
        self,
        candidate_id: int,
        data: SemanticExtractionCandidateReviewCreate,
    ) -> SemanticExtractionCandidate | None:
        candidate = await self._session.get(KgExtractedCandidate, candidate_id)
        if candidate is None:
            return None

        action = data.action.strip().lower()
        candidate.review_note = data.review_note
        if action in {"reject", "rejected"}:
            candidate.status = data.status or "rejected"
        elif action in {"approve", "approved", "confirm", "confirmed"}:
            candidate.normalized_payload = await self._materialize_candidate(candidate)
            candidate.status = data.status or "approved"
        else:
            candidate.status = data.status or action

        await self._session.commit()
        await self._session.refresh(candidate)
        return _candidate_schema(candidate)

    async def create_entity(self, data: SemanticGraphEntityCreate) -> SemanticGraphEntity:
        entity = KgEntity(
            entity_type=data.entity_type,
            canonical_name=data.canonical_name,
            display_name=data.display_name or data.canonical_name,
            description=data.description,
            status=data.status,
            source_type=data.source_type,
            confidence=data.confidence,
            primary_chunk_id=data.primary_chunk_id,
            primary_document_id=data.primary_document_id,
            attributes=data.attributes,
            created_by=data.created_by,
            updated_by=data.created_by,
        )
        self._session.add(entity)
        try:
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise ValueError("Semantic entity already exists or references invalid evidence.") from exc
        await self._session.refresh(entity)
        return _entity_schema(entity)

    async def update_entity(
        self,
        entity_id: int,
        data: SemanticGraphEntityUpdate,
    ) -> SemanticGraphEntity | None:
        entity = await self._session.get(KgEntity, entity_id)
        if entity is None:
            return None
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(entity, key, value)
        await self._session.commit()
        await self._session.refresh(entity)
        return _entity_schema(entity)

    async def get_entity_detail(self, entity_id: int) -> SemanticGraphEntityDetail | None:
        entity = await self._session.get(KgEntity, entity_id)
        if entity is None:
            return None
        aliases = (
            await self._session.execute(
                select(KgEntityAlias)
                .where(KgEntityAlias.entity_id == entity_id)
                .order_by(KgEntityAlias.id.asc())
            )
        ).scalars().all()
        return SemanticGraphEntityDetail(
            entity=_entity_schema(entity),
            aliases=[_alias_schema(alias) for alias in aliases],
        )

    async def add_entity_alias(
        self,
        entity_id: int,
        data: SemanticGraphEntityAliasCreate,
    ) -> SemanticGraphEntityAlias | None:
        entity = await self._session.get(KgEntity, entity_id)
        if entity is None:
            return None
        alias = KgEntityAlias(
            entity_id=entity_id,
            alias_name=data.alias_name,
            alias_type=data.alias_type,
            confidence=data.confidence,
            status=data.status,
        )
        self._session.add(alias)
        try:
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise ValueError("Semantic entity alias already exists.") from exc
        await self._session.refresh(alias)
        return _alias_schema(alias)

    async def review_entity(
        self,
        entity_id: int,
        data: SemanticGraphEntityReviewCreate,
    ) -> SemanticGraphEntity | None:
        entity = await self._session.get(KgEntity, entity_id)
        if entity is None:
            return None
        next_status = data.status or _infer_entity_status(data.action)
        entity.status = next_status
        review = KgEntityReview(
            entity_id=entity_id,
            action=data.action,
            review_note=data.review_note,
            reviewer_id=data.reviewer_id,
            reviewer_name=data.reviewer_name,
        )
        self._session.add(review)
        await self._session.commit()
        await self._session.refresh(entity)
        return _entity_schema(entity)

    async def create_relation(self, data: SemanticGraphRelationCreate) -> SemanticGraphRelation:
        await self._ensure_entity_exists(data.source_entity_id)
        await self._ensure_entity_exists(data.target_entity_id)
        relation = KgRelation(
            source_entity_id=data.source_entity_id,
            target_entity_id=data.target_entity_id,
            relation_type=data.relation_type,
            directional=data.directional,
            weight=data.weight,
            confidence=data.confidence,
            status=data.status,
            source_type=data.source_type,
            evidence_summary=data.evidence_summary,
            notes=data.notes,
            attributes=data.attributes,
            created_by=data.created_by,
            updated_by=data.created_by,
        )
        self._session.add(relation)
        await self._session.commit()
        await self._session.refresh(relation)
        return _relation_schema(relation)

    async def update_relation(
        self,
        relation_id: int,
        data: SemanticGraphRelationUpdate,
    ) -> SemanticGraphRelation | None:
        relation = await self._session.get(KgRelation, relation_id)
        if relation is None:
            return None
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(relation, key, value)
        await self._session.commit()
        await self._session.refresh(relation)
        return _relation_schema(relation)

    async def add_relation_evidence(
        self,
        relation_id: int,
        data: SemanticGraphRelationEvidenceCreate,
    ) -> SemanticGraphRelationEvidence | None:
        relation = await self._session.get(KgRelation, relation_id)
        if relation is None:
            return None
        evidence = KgRelationEvidence(
            relation_id=relation_id,
            chunk_id=data.chunk_id,
            document_id=data.document_id,
            excerpt=data.excerpt,
            page_reference=data.page_reference,
            section_reference=data.section_reference,
            evidence_type=data.evidence_type,
            confidence=data.confidence,
        )
        self._session.add(evidence)
        try:
            await self._refresh_relation_confidence(relation)
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise ValueError("Semantic relation evidence references invalid document or chunk.") from exc
        await self._session.refresh(evidence)
        return _evidence_schema(evidence)

    async def review_relation(
        self,
        relation_id: int,
        data: SemanticGraphRelationReviewCreate,
    ) -> SemanticGraphRelation | None:
        relation = await self._session.get(KgRelation, relation_id)
        if relation is None:
            return None
        previous_status = relation.status
        next_status = data.status or _infer_relation_status(data.action)
        relation.status = next_status
        review = KgRelationReview(
            relation_id=relation_id,
            action=data.action,
            review_status_before=previous_status,
            review_status_after=next_status,
            review_note=data.review_note,
            reviewer_id=data.reviewer_id,
            reviewer_name=data.reviewer_name,
        )
        self._session.add(review)
        await self._refresh_relation_confidence(relation, latest_action=data.action)
        await self._session.commit()
        await self._session.refresh(relation)
        return _relation_schema(relation)

    async def search_entities(
        self,
        *,
        query: str | None = None,
        entity_type: str | None = None,
        status: str | None = "active",
        limit: int = 20,
    ) -> SemanticEntitySearchResponse:
        stmt = select(KgEntity)
        if query:
            pattern = f"%{query.strip()}%"
            stmt = stmt.where(
                or_(
                    KgEntity.canonical_name.ilike(pattern),
                    KgEntity.display_name.ilike(pattern),
                    KgEntity.description.ilike(pattern),
                )
            )
        if entity_type:
            stmt = stmt.where(KgEntity.entity_type == entity_type)
        if status:
            stmt = stmt.where(KgEntity.status == status)
        stmt = stmt.order_by(KgEntity.updated_at.desc()).limit(limit)
        entities = (await self._session.execute(stmt)).scalars().all()
        if not entities:
            return SemanticEntitySearchResponse(total=0, items=[])

        entity_ids = [entity.id for entity in entities]
        relation_counts = (
            await self._session.execute(
                select(
                    KgRelation.source_entity_id,
                    func.count(KgRelation.id),
                )
                .where(KgRelation.source_entity_id.in_(entity_ids))
                .group_by(KgRelation.source_entity_id)
            )
        ).all()
        inbound_counts = (
            await self._session.execute(
                select(
                    KgRelation.target_entity_id,
                    func.count(KgRelation.id),
                )
                .where(KgRelation.target_entity_id.in_(entity_ids))
                .group_by(KgRelation.target_entity_id)
            )
        ).all()
        count_map: dict[int, int] = defaultdict(int)
        for entity_id, count in relation_counts:
            count_map[entity_id] += int(count)
        for entity_id, count in inbound_counts:
            count_map[entity_id] += int(count)

        items = [
            SemanticEntitySearchItem(
                entity=_entity_schema(entity),
                relation_count=count_map.get(entity.id, 0),
            )
            for entity in entities
        ]
        return SemanticEntitySearchResponse(total=len(items), items=items)

    async def recommend_duplicate_entities(
        self,
        *,
        entity_type: str | None = None,
        min_score: float = 0.82,
        limit: int = 50,
    ) -> SemanticDuplicateEntityRecommendationResponse:
        stmt = select(KgEntity).where(KgEntity.status != "merged")
        if entity_type:
            stmt = stmt.where(KgEntity.entity_type == entity_type)
        entities = (await self._session.execute(stmt.order_by(KgEntity.id.asc()))).scalars().all()
        if len(entities) < 2:
            return SemanticDuplicateEntityRecommendationResponse(total=0, items=[])

        aliases = (
            await self._session.execute(
                select(KgEntityAlias).where(KgEntityAlias.entity_id.in_([entity.id for entity in entities]))
            )
        ).scalars().all()
        alias_map: dict[int, list[str]] = defaultdict(list)
        for alias in aliases:
            alias_map[alias.entity_id].append(alias.alias_name)

        candidates: list[tuple[float, str, KgEntity, KgEntity]] = []
        for index, entity in enumerate(entities):
            names = _entity_match_names(entity, alias_map.get(entity.id, []))
            for other in entities[index + 1 :]:
                if entity.entity_type != other.entity_type:
                    continue
                score, matched_on = _duplicate_entity_score(
                    names,
                    _entity_match_names(other, alias_map.get(other.id, [])),
                )
                if score >= min_score:
                    candidates.append((score, matched_on, entity, other))

        candidates.sort(key=lambda item: (-item[0], item[2].entity_type, item[2].id, item[3].id))
        items = [
            SemanticDuplicateEntityCandidate(
                entity=_entity_schema(entity),
                duplicate_entity=_entity_schema(other),
                score=round(score, 4),
                matched_on=matched_on,
            )
            for score, matched_on, entity, other in candidates[:limit]
        ]
        return SemanticDuplicateEntityRecommendationResponse(total=len(candidates), items=items)

    async def get_graph(
        self,
        *,
        relation_type: str | None = None,
        entity_type: str | None = None,
        status: str | None = "approved",
        limit: int = 200,
    ) -> SemanticGraphResponse:
        stmt = select(KgRelation)
        if relation_type:
            stmt = stmt.where(KgRelation.relation_type == relation_type)
        if status:
            stmt = stmt.where(KgRelation.status == status)
        stmt = stmt.order_by(KgRelation.id.desc()).limit(limit)
        relation_rows = (await self._session.execute(stmt)).scalars().all()
        if not relation_rows:
            return SemanticGraphResponse(entities=[], relations=[])

        entity_ids = {
            row.source_entity_id for row in relation_rows
        } | {
            row.target_entity_id for row in relation_rows
        }
        entity_stmt = select(KgEntity).where(KgEntity.id.in_(entity_ids))
        if entity_type:
            entity_stmt = entity_stmt.where(KgEntity.entity_type == entity_type)
        entities = (await self._session.execute(entity_stmt)).scalars().all()
        entity_map = {entity.id: entity for entity in entities}

        filtered_relations = [
            relation
            for relation in relation_rows
            if relation.source_entity_id in entity_map and relation.target_entity_id in entity_map
        ]
        return SemanticGraphResponse(
            entities=[_entity_schema(entity) for entity in entities],
            relations=[_relation_schema(relation) for relation in filtered_relations],
        )

    async def get_neighbors(
        self,
        *,
        entity_id: int,
        depth: int = 1,
        relation_type: str | None = None,
        status: str | None = "approved",
    ) -> SemanticGraphResponse:
        depth = min(max(depth, 1), 3)
        visited_entity_ids = {entity_id}
        visited_relations: dict[int, KgRelation] = {}
        frontier = {entity_id}

        for _ in range(depth):
            if not frontier:
                break
            stmt = select(KgRelation).where(
                or_(
                    KgRelation.source_entity_id.in_(frontier),
                    KgRelation.target_entity_id.in_(frontier),
                )
            )
            if relation_type:
                stmt = stmt.where(KgRelation.relation_type == relation_type)
            if status:
                stmt = stmt.where(KgRelation.status == status)
            rows = (await self._session.execute(stmt)).scalars().all()
            next_frontier: set[int] = set()
            for row in rows:
                visited_relations[row.id] = row
                if row.source_entity_id not in visited_entity_ids:
                    visited_entity_ids.add(row.source_entity_id)
                    next_frontier.add(row.source_entity_id)
                if row.target_entity_id not in visited_entity_ids:
                    visited_entity_ids.add(row.target_entity_id)
                    next_frontier.add(row.target_entity_id)
            frontier = next_frontier

        entities = (
            await self._session.execute(
                select(KgEntity).where(KgEntity.id.in_(visited_entity_ids))
            )
        ).scalars().all()
        return SemanticGraphResponse(
            entities=[_entity_schema(entity) for entity in entities],
            relations=[_relation_schema(relation) for relation in visited_relations.values()],
        )

    async def get_relation_detail(self, relation_id: int) -> SemanticGraphRelationDetail | None:
        relation = await self._session.get(KgRelation, relation_id)
        if relation is None:
            return None
        evidence_rows = (
            await self._session.execute(
                select(KgRelationEvidence)
                .where(KgRelationEvidence.relation_id == relation_id)
                .order_by(KgRelationEvidence.id.asc())
            )
        ).scalars().all()
        return SemanticGraphRelationDetail(
            relation=_relation_schema(relation),
            evidence=[_evidence_schema(item) for item in evidence_rows],
        )

    async def get_stats(self) -> SemanticGraphStatsResponse:
        entity_counts = (
            await self._session.execute(
                select(KgEntity.entity_type, func.count(KgEntity.id)).group_by(KgEntity.entity_type)
            )
        ).all()
        relation_counts = (
            await self._session.execute(
                select(KgRelation.relation_type, func.count(KgRelation.id)).group_by(KgRelation.relation_type)
            )
        ).all()
        relation_status_counts = (
            await self._session.execute(
                select(KgRelation.status, func.count(KgRelation.id)).group_by(KgRelation.status)
            )
        ).all()

        entities_by_type = {key: int(value) for key, value in entity_counts}
        relations_by_type = {key: int(value) for key, value in relation_counts}
        relations_by_status = {key: int(value) for key, value in relation_status_counts}
        return SemanticGraphStatsResponse(
            total_entities=sum(entities_by_type.values()),
            total_relations=sum(relations_by_type.values()),
            entities_by_type=entities_by_type,
            relations_by_type=relations_by_type,
            relations_by_status=relations_by_status,
        )

    async def get_quality_stats(self) -> SemanticGraphQualityStatsResponse:
        duplicate_groups = (
            await self._session.execute(
                select(
                    KgEntity.entity_type,
                    func.lower(KgEntity.canonical_name),
                    func.count(KgEntity.id),
                )
                .group_by(KgEntity.entity_type, func.lower(KgEntity.canonical_name))
                .having(func.count(KgEntity.id) > 1)
            )
        ).all()
        pending_counts = (
            await self._session.execute(
                select(KgExtractedCandidate.candidate_type, func.count(KgExtractedCandidate.id))
                .where(KgExtractedCandidate.status == "pending_review")
                .group_by(KgExtractedCandidate.candidate_type)
            )
        ).all()
        pending_by_type = {key: int(value) for key, value in pending_counts}
        relations_without_evidence = (
            await self._session.execute(
                select(func.count(KgRelation.id))
                .outerjoin(KgRelationEvidence, KgRelationEvidence.relation_id == KgRelation.id)
                .where(KgRelationEvidence.id.is_(None))
            )
        ).scalar_one()
        relations_without_evidence_or_review = (
            await self._session.execute(
                select(func.count(KgRelation.id))
                .outerjoin(KgRelationEvidence, KgRelationEvidence.relation_id == KgRelation.id)
                .outerjoin(KgRelationReview, KgRelationReview.relation_id == KgRelation.id)
                .where(KgRelationEvidence.id.is_(None))
                .where(KgRelationReview.id.is_(None))
            )
        ).scalar_one()
        low_confidence_relations = (
            await self._session.execute(
                select(func.count(KgRelation.id)).where(KgRelation.confidence < 0.6)
            )
        ).scalar_one()
        safety_entity_counts = (
            await self._session.execute(
                select(KgEntity.entity_type, func.count(KgEntity.id))
                .where(
                    KgEntity.entity_type.in_(
                        [
                            "safety_risk",
                            "standard_parameter",
                            "forbidden_action",
                        ]
                    )
                )
                .group_by(KgEntity.entity_type)
            )
        ).all()
        safety_entity_by_type = {key: int(value) for key, value in safety_entity_counts}
        relations_with_safety_risk = (
            await self._session.execute(
                select(func.count(KgRelation.id)).where(
                    KgRelation.relation_type.in_(
                        [
                            "action_has_safety_risk",
                            "action_forbidden_under_condition",
                            "risk_mitigated_by_action",
                        ]
                    )
                )
            )
        ).scalar_one()
        return SemanticGraphQualityStatsResponse(
            duplicate_entity_groups=len(duplicate_groups),
            pending_entity_candidates=pending_by_type.get("entity", 0),
            pending_relation_candidates=pending_by_type.get("relation", 0),
            relations_without_evidence=int(relations_without_evidence or 0),
            relations_without_evidence_or_review=int(relations_without_evidence_or_review or 0),
            low_confidence_relations=int(low_confidence_relations or 0),
            safety_risk_entities=safety_entity_by_type.get("safety_risk", 0),
            standard_parameter_entities=safety_entity_by_type.get("standard_parameter", 0),
            forbidden_action_entities=safety_entity_by_type.get("forbidden_action", 0),
            relations_with_safety_risk=int(relations_with_safety_risk or 0),
        )

    async def merge_entity(
        self,
        source_entity_id: int,
        data: SemanticGraphEntityMergeCreate,
    ) -> SemanticGraphEntityMergeResponse | None:
        if source_entity_id == data.target_entity_id:
            raise ValueError("Source and target entity must be different.")
        source = await self._session.get(KgEntity, source_entity_id)
        target = await self._session.get(KgEntity, data.target_entity_id)
        if source is None or target is None:
            return None
        if source.entity_type != target.entity_type:
            raise ValueError("Only entities of the same type can be merged.")

        moved_aliases = await self._move_aliases(source, target)
        moved_relations = await self._move_relations_to_target(source.id, target.id)
        removed_duplicate_relations = await self._deduplicate_entity_relations(target.id)
        self._session.add(
            KgEntityMerge(
                source_entity_id=source.id,
                target_entity_id=target.id,
                reason=data.reason,
                merged_by=data.merged_by,
            )
        )
        source.status = "merged"
        source.updated_by = data.merged_by
        await self._session.commit()
        return SemanticGraphEntityMergeResponse(
            source_entity_id=source.id,
            target_entity_id=target.id,
            moved_relations=moved_relations,
            moved_aliases=moved_aliases,
            removed_duplicate_relations=removed_duplicate_relations,
        )

    async def _ensure_entity_exists(self, entity_id: int) -> None:
        entity = await self._session.get(KgEntity, entity_id)
        if entity is None:
            raise ValueError(f"Semantic entity {entity_id} does not exist.")

    async def _find_entity_by_name(self, entity_type: str, name: str) -> KgEntity | None:
        normalized = name.strip()
        entity = (
            await self._session.execute(
                select(KgEntity).where(
                    KgEntity.entity_type == entity_type,
                    func.lower(KgEntity.canonical_name) == normalized.lower(),
                )
            )
        ).scalar_one_or_none()
        if entity is not None:
            return entity
        return (
            await self._session.execute(
                select(KgEntity)
                .join(KgEntityAlias, KgEntityAlias.entity_id == KgEntity.id)
                .where(KgEntity.entity_type == entity_type)
                .where(func.lower(KgEntityAlias.alias_name) == normalized.lower())
            )
        ).scalar_one_or_none()

    async def _move_aliases(self, source: KgEntity, target: KgEntity) -> int:
        moved = 0
        aliases = (
            await self._session.execute(
                select(KgEntityAlias).where(KgEntityAlias.entity_id == source.id)
            )
        ).scalars().all()
        target_alias_names = {
            row.alias_name.lower()
            for row in (
                await self._session.execute(
                    select(KgEntityAlias).where(KgEntityAlias.entity_id == target.id)
                )
            ).scalars().all()
        }
        target_alias_names.add(target.canonical_name.lower())
        for alias in aliases:
            if alias.alias_name.lower() in target_alias_names:
                await self._session.delete(alias)
                continue
            alias.entity_id = target.id
            moved += 1
        if source.canonical_name.lower() not in target_alias_names:
            self._session.add(
                KgEntityAlias(
                    entity_id=target.id,
                    alias_name=source.canonical_name,
                    alias_type="merged_name",
                    confidence=source.confidence,
                    status="active",
                )
            )
            moved += 1
        return moved

    async def _move_relations_to_target(self, source_entity_id: int, target_entity_id: int) -> int:
        moved = 0
        relations = (
            await self._session.execute(
                select(KgRelation).where(
                    or_(
                        KgRelation.source_entity_id == source_entity_id,
                        KgRelation.target_entity_id == source_entity_id,
                    )
                )
            )
        ).scalars().all()
        for relation in relations:
            if relation.source_entity_id == source_entity_id:
                relation.source_entity_id = target_entity_id
                moved += 1
            if relation.target_entity_id == source_entity_id:
                relation.target_entity_id = target_entity_id
                moved += 1
        return moved

    async def _deduplicate_entity_relations(self, entity_id: int) -> int:
        relations = (
            await self._session.execute(
                select(KgRelation)
                .where(
                    or_(
                        KgRelation.source_entity_id == entity_id,
                        KgRelation.target_entity_id == entity_id,
                    )
                )
                .order_by(KgRelation.id.asc())
            )
        ).scalars().all()
        by_key: dict[tuple[int, int, str], KgRelation] = {}
        removed = 0
        for relation in relations:
            key = (relation.source_entity_id, relation.target_entity_id, relation.relation_type)
            existing = by_key.get(key)
            if existing is None:
                by_key[key] = relation
                continue
            evidence_rows = (
                await self._session.execute(
                    select(KgRelationEvidence).where(KgRelationEvidence.relation_id == relation.id)
                )
            ).scalars().all()
            for evidence in evidence_rows:
                evidence.relation_id = existing.id
            existing.confidence = max(
                _to_float(existing.confidence) or 0,
                _to_float(relation.confidence) or 0,
            )
            await self._session.delete(relation)
            removed += 1
        return removed

    async def _refresh_relation_confidence(
        self,
        relation: KgRelation,
        *,
        latest_action: str | None = None,
    ) -> None:
        evidence_count = (
            await self._session.execute(
                select(func.count(KgRelationEvidence.id)).where(
                    KgRelationEvidence.relation_id == relation.id
                )
            )
        ).scalar_one()
        approved_review_count = (
            await self._session.execute(
                select(func.count(KgRelationReview.id)).where(
                    KgRelationReview.relation_id == relation.id,
                    KgRelationReview.action.in_(["approve", "approved", "confirm", "confirmed"]),
                )
            )
        ).scalar_one()

        current = _to_float(relation.confidence) or 0.0
        evidence_score = min(0.8, 0.55 + 0.08 * int(evidence_count or 0))
        if approved_review_count:
            evidence_score = max(evidence_score, 0.85)

        normalized_action = (latest_action or "").strip().lower()
        if normalized_action in {"reject", "rejected"}:
            relation.confidence = min(current, 0.2)
            return
        if normalized_action in {"approve", "approved", "confirm", "confirmed"}:
            relation.confidence = max(current, evidence_score, 0.85)
            return
        relation.confidence = max(current, evidence_score)

    async def _materialize_candidate(self, candidate: KgExtractedCandidate) -> dict:
        candidate_type = candidate.candidate_type.strip().lower()
        if candidate_type == "entity":
            return await self._materialize_entity_candidate(candidate)
        if candidate_type == "relation":
            return await self._materialize_relation_candidate(candidate)
        raise ValueError(f"Unsupported extraction candidate type: {candidate.candidate_type}.")

    async def _materialize_entity_candidate(self, candidate: KgExtractedCandidate) -> dict:
        payload = candidate.payload or {}
        entity_type = _required_payload_str(payload, "entity_type")
        canonical_name = _required_payload_str(payload, "canonical_name", fallback_key="name")
        existing = await self._find_entity_by_name(entity_type, canonical_name)
        if existing is not None:
            return {"entity_id": existing.id, "reused": True}

        entity = KgEntity(
            entity_type=entity_type,
            canonical_name=canonical_name,
            display_name=payload.get("display_name") or payload.get("name") or canonical_name,
            description=payload.get("description"),
            status=payload.get("status") or "active",
            source_type=payload.get("source_type") or "extraction",
            confidence=candidate.confidence,
            primary_chunk_id=candidate.chunk_id,
            primary_document_id=candidate.document_id,
            attributes=payload.get("attributes") or {},
        )
        self._session.add(entity)
        await self._session.flush()
        for alias_name in payload.get("aliases") or []:
            if isinstance(alias_name, str) and alias_name.strip():
                self._session.add(
                    KgEntityAlias(
                        entity_id=entity.id,
                        alias_name=alias_name.strip(),
                        alias_type="extracted",
                        confidence=candidate.confidence,
                        status="active",
                    )
                )
        return {"entity_id": entity.id, "reused": False}

    async def _materialize_relation_candidate(self, candidate: KgExtractedCandidate) -> dict:
        payload = candidate.payload or {}
        source_entity_id = await self._resolve_relation_endpoint(payload, "source", candidate)
        target_entity_id = await self._resolve_relation_endpoint(payload, "target", candidate)
        relation_type = _required_payload_str(payload, "relation_type")
        await self._ensure_entity_exists(source_entity_id)
        await self._ensure_entity_exists(target_entity_id)

        relation = KgRelation(
            source_entity_id=source_entity_id,
            target_entity_id=target_entity_id,
            relation_type=relation_type,
            directional=bool(payload.get("directional", True)),
            weight=payload.get("weight"),
            confidence=candidate.confidence,
            status=payload.get("status") or "approved",
            source_type=payload.get("source_type") or "extraction",
            evidence_summary=payload.get("evidence_summary") or payload.get("evidence"),
            notes=payload.get("notes"),
            attributes=payload.get("attributes") or {},
        )
        existing_relation = await self._find_equivalent_relation(
            source_entity_id=source_entity_id,
            target_entity_id=target_entity_id,
            relation_type=relation_type,
        )
        if existing_relation is not None:
            relation = existing_relation
            relation.confidence = max(
                _to_float(relation.confidence) or 0,
                _to_float(candidate.confidence) or 0,
            )
        else:
            self._session.add(relation)
            await self._session.flush()
        if candidate.chunk_id or candidate.document_id or payload.get("evidence"):
            self._session.add(
                KgRelationEvidence(
                    relation_id=relation.id,
                    chunk_id=candidate.chunk_id,
                    document_id=candidate.document_id,
                    excerpt=payload.get("evidence"),
                    page_reference=payload.get("page_reference"),
                    section_reference=payload.get("section_reference"),
                    evidence_type=payload.get("evidence_type") or "extracted",
                    confidence=candidate.confidence,
                )
            )
        return {"relation_id": relation.id}

    async def _find_equivalent_relation(
        self,
        *,
        source_entity_id: int,
        target_entity_id: int,
        relation_type: str,
    ) -> KgRelation | None:
        return (
            await self._session.execute(
                select(KgRelation).where(
                    KgRelation.source_entity_id == source_entity_id,
                    KgRelation.target_entity_id == target_entity_id,
                    KgRelation.relation_type == relation_type,
                )
            )
        ).scalar_one_or_none()

    async def _resolve_relation_endpoint(
        self,
        payload: dict,
        prefix: str,
        candidate: KgExtractedCandidate,
    ) -> int:
        entity_id_key = f"{prefix}_entity_id"
        entity_type_key = f"{prefix}_entity_type"
        name_key = f"{prefix}_name"
        if payload.get(entity_id_key) is not None:
            return _payload_int(payload, entity_id_key)

        entity_type = _required_payload_str(payload, entity_type_key)
        canonical_name = _required_payload_str(payload, name_key, fallback_key=prefix)
        existing = await self._find_entity_by_name(entity_type, canonical_name)
        if existing is not None:
            return existing.id

        entity = KgEntity(
            entity_type=entity_type,
            canonical_name=canonical_name,
            display_name=canonical_name,
            status="active",
            source_type="extraction",
            confidence=candidate.confidence,
            primary_chunk_id=candidate.chunk_id,
            primary_document_id=candidate.document_id,
            attributes={},
        )
        self._session.add(entity)
        await self._session.flush()
        return entity.id


def _extract_candidates_from_chunk(
    *,
    document: KnowledgeDocument,
    chunk: KnowledgeChunk,
    include_relations: bool,
) -> list[dict]:
    text = " ".join(
        value
        for value in [
            chunk.heading,
            chunk.content,
            chunk.ocr_text,
            chunk.image_caption,
            chunk.evidence_summary,
        ]
        if value
    )
    candidates: list[dict] = []
    seen_entities: set[tuple[str, str]] = set()

    def add_entity(entity_type: str, name: str, confidence: float, aliases: list[str] | None = None) -> None:
        normalized = name.strip()
        if not normalized or (entity_type, normalized) in seen_entities:
            return
        seen_entities.add((entity_type, normalized))
        payload = {
            "entity_type": entity_type,
            "canonical_name": normalized,
            "display_name": normalized,
            "source_type": "rule_extract",
            "attributes": {
                "document_title": document.title,
                "chunk_index": chunk.chunk_index,
            },
        }
        if aliases:
            payload["aliases"] = aliases
        candidates.append(
            {
                "candidate_type": "entity",
                "payload": payload,
                "confidence": confidence,
            }
        )

    if document.equipment_model:
        add_entity("equipment_model", document.equipment_model, 0.92)
    if chunk.equipment_model and chunk.equipment_model != document.equipment_model:
        add_entity("equipment_model", chunk.equipment_model, 0.9)
    fault_name = chunk.fault_type or document.fault_type
    if fault_name:
        add_entity("fault_symptom", fault_name, 0.88)

    components = [term for term in COMPONENT_TERMS if term in text]
    causes = [term for term in CAUSE_TERMS if term in text]
    safety_risks = _infer_safety_risks(text)
    actions = [term for term in (*ACTION_TERMS, *MITIGATION_ACTION_TERMS) if term in text]
    standard_parameters = _infer_standard_parameters(text)
    forbidden_actions = _infer_forbidden_actions(text)
    applicable_conditions = _infer_applicable_conditions(text)
    for term in components:
        add_entity("component", term, 0.86)
    for term in causes:
        add_entity("fault_cause", term, 0.82)
    for term in actions:
        add_entity("maintenance_action", term, 0.74)
    for term in safety_risks:
        add_entity("safety_risk", term, 0.8)
    for term in standard_parameters:
        add_entity("standard_parameter", term, 0.78)
    for term in forbidden_actions:
        add_entity("forbidden_action", term, 0.84)
    for term in applicable_conditions:
        add_entity("applicable_condition", term, 0.78)

    if not include_relations:
        return candidates

    evidence = _build_evidence_excerpt(text)

    def add_relation(
        source_type: str,
        source_name: str,
        target_type: str,
        target_name: str,
        relation_type: str,
        confidence: float,
    ) -> None:
        candidates.append(
            {
                "candidate_type": "relation",
                "payload": {
                    "source_entity_type": source_type,
                    "source_name": source_name,
                    "target_entity_type": target_type,
                    "target_name": target_name,
                    "relation_type": relation_type,
                    "source_type": "rule_extract",
                    "evidence": evidence,
                    "page_reference": chunk.page_reference,
                    "section_reference": chunk.section_reference,
                },
                "confidence": confidence,
            }
        )

    if fault_name:
        for cause in causes:
            add_relation("fault_symptom", fault_name, "fault_cause", cause, "symptom_possible_cause", 0.8)
        for component in components:
            add_relation("fault_symptom", fault_name, "component", component, "symptom_related_component", 0.78)
    for component in components:
        for action in actions:
            add_relation("component", component, "maintenance_action", action, "component_requires_action", 0.72)
    for action in actions:
        for risk in safety_risks:
            if not _is_mitigation_action_for_risk(action, risk):
                add_relation("maintenance_action", action, "safety_risk", risk, "action_has_safety_risk", 0.76)
        for parameter in standard_parameters:
            add_relation("maintenance_action", action, "standard_parameter", parameter, "action_requires_parameter", 0.74)
        for forbidden in forbidden_actions:
            add_relation(
                "maintenance_action",
                action,
                "forbidden_action",
                forbidden,
                "action_forbidden_under_condition",
                0.82,
            )
        for condition in applicable_conditions:
            add_relation(
                "maintenance_action",
                action,
                "applicable_condition",
                condition,
                "action_forbidden_under_condition",
                0.72,
            )
    for risk in safety_risks:
        for action in actions:
            if _is_mitigation_action_for_risk(action, risk):
                add_relation("safety_risk", risk, "maintenance_action", action, "risk_mitigated_by_action", 0.74)
    return candidates


def _is_mitigation_action_for_risk(action: str, risk: str) -> bool:
    if action in {"断电", "停机", "隔离"} and risk in {"点火高压", "电气短路"}:
        return True
    if action == "冷却" and risk == "高温烫伤":
        return True
    if action in {"通风", "隔离"} and risk == "燃油风险":
        return True
    return False


def _infer_safety_risks(text: str) -> list[str]:
    risks: list[str] = []
    if any(term in text for term in ("燃油", "喷油", "油管", "混合气", "冒黑烟")):
        risks.append("燃油风险")
    if any(term in text for term in ("高温", "烫伤", "冷却")):
        risks.append("高温烫伤")
    if any(term in text for term in ("点火线圈", "高压帽", "火花塞", "点火", "高压")):
        risks.append("点火高压")
    if any(term in text for term in ("带电", "断电", "短路", "接线", "电气")):
        risks.append("电气短路")
    if any(term in text for term in ("异物", "灰尘", "缸体", "气缸")):
        risks.append("异物进入缸体")
    return [risk for risk in SAFETY_RISK_TERMS if risk in risks]


def _infer_standard_parameters(text: str) -> list[str]:
    parameters: list[str] = []
    if "火花塞" in text and "间隙" in text:
        parameters.append("火花塞间隙")
    if "气门间隙" in text:
        parameters.append("气门间隙")
    if any(term in text for term in ("扭矩", "力矩", "紧固")):
        parameters.append("紧固扭矩")
    if "点火线圈" in text and any(term in text for term in ("阻值", "电阻", "测量")):
        parameters.append("点火线圈阻值")
    return [parameter for parameter in STANDARD_PARAMETER_TERMS if parameter in parameters]


def _infer_forbidden_actions(text: str) -> list[str]:
    forbidden: list[str] = []
    if "带电" in text and any(term in text for term in ("检查", "测试", "点火线圈", "高压帽")):
        forbidden.append("带电检查点火线圈")
    if "高温" in text and any(term in text for term in ("拆卸", "拆检", "维修")):
        forbidden.append("高温拆检")
    if any(term in text for term in ("未停机", "未熄火", "运行中")) and any(term in text for term in ("拆卸", "拆检", "检查")):
        forbidden.append("未停机拆检")
    return [item for item in FORBIDDEN_ACTION_TERMS if item in forbidden]


def _infer_applicable_conditions(text: str) -> list[str]:
    conditions: list[str] = []
    if "高温" in text:
        conditions.append("发动机高温")
    if "未断电" in text or "带电" in text:
        conditions.append("未断电")
    if any(term in text for term in ("未停机", "未熄火", "运行中")):
        conditions.append("未停机")
    if "燃油" in text and any(term in text for term in ("隔离", "未隔离", "泄漏")):
        conditions.append("燃油未隔离")
    return [item for item in APPLICABLE_CONDITION_TERMS if item in conditions]


def _build_evidence_excerpt(text: str, max_chars: int = 180) -> str:
    compact = " ".join(text.split())
    if len(compact) <= max_chars:
        return compact
    return compact[:max_chars].rstrip()


def _normalize_entity_match_name(value: str) -> str:
    return "".join(value.lower().split()).replace("-", "").replace("_", "")


def _entity_match_names(entity: KgEntity, aliases: list[str]) -> list[str]:
    names = [entity.canonical_name]
    if entity.display_name:
        names.append(entity.display_name)
    names.extend(aliases)
    normalized: list[str] = []
    seen: set[str] = set()
    for name in names:
        value = _normalize_entity_match_name(name)
        if value and value not in seen:
            seen.add(value)
            normalized.append(value)
    return normalized


def _duplicate_entity_score(left_names: list[str], right_names: list[str]) -> tuple[float, str]:
    best_score = 0.0
    best_match = ""
    for left in left_names:
        for right in right_names:
            if left == right:
                return 1.0, left
            if len(left) >= 2 and len(right) >= 2 and (left in right or right in left):
                score = min(len(left), len(right)) / max(len(left), len(right))
                score = max(score, 0.9)
            else:
                score = SequenceMatcher(None, left, right).ratio()
            if score > best_score:
                best_score = score
                best_match = f"{left}~{right}"
    return best_score, best_match


def _infer_entity_status(action: str) -> str:
    normalized = action.strip().lower()
    if normalized in {"approve", "approved", "confirm", "confirmed", "activate", "active"}:
        return "active"
    if normalized in {"reject", "rejected"}:
        return "rejected"
    if normalized in {"draft", "pending", "pending_review"}:
        return "draft"
    return normalized


def _infer_relation_status(action: str) -> str:
    normalized = action.strip().lower()
    if normalized in {"approve", "approved", "confirm", "confirmed"}:
        return "approved"
    if normalized in {"reject", "rejected"}:
        return "rejected"
    if normalized in {"draft", "pending", "pending_review"}:
        return "draft"
    return normalized


def _required_payload_str(payload: dict, key: str, *, fallback_key: str | None = None) -> str:
    value = payload.get(key)
    if value is None and fallback_key:
        value = payload.get(fallback_key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Candidate payload missing required string field: {key}.")
    return value.strip()


def _payload_int(payload: dict, key: str) -> int:
    value = payload.get(key)
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value)
    raise ValueError(f"Candidate payload missing required integer field: {key}.")


__all__ = ["SemanticKnowledgeGraphService"]
