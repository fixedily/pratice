"""Semantic knowledge graph query endpoints."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.modules.knowledge.application.semantic_graph_service import (
    SemanticKnowledgeGraphService,
)
from app.modules.knowledge.schemas.semantic_graph import (
    SemanticDuplicateEntityRecommendationResponse,
    SemanticEntitySearchResponse,
    SemanticExtractionCandidate,
    SemanticExtractionCandidateListResponse,
    SemanticExtractionCandidateReviewCreate,
    SemanticExtractionFromDocumentRequest,
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
    SemanticGraphResponse,
    SemanticGraphRelationEvidence,
    SemanticGraphRelationEvidenceCreate,
    SemanticGraphRelationReviewCreate,
    SemanticGraphRelationUpdate,
    SemanticGraphStatsResponse,
    SemanticGraphQualityStatsResponse,
)

router = APIRouter(prefix="/api/v1/knowledge/semantic-graph", tags=["knowledge-semantic-graph"])


def _svc(session: AsyncSession) -> SemanticKnowledgeGraphService:
    return SemanticKnowledgeGraphService(session)


def _bad_request(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get("", response_model=SemanticGraphResponse)
async def get_semantic_graph(
    session: Annotated[AsyncSession, Depends(get_session)],
    relation_type: str | None = Query(None, description="Filter by semantic relation type"),
    entity_type: str | None = Query(None, description="Filter by semantic entity type"),
    status: str | None = Query("approved", description="Filter by relation status"),
    limit: int = Query(200, ge=1, le=1000),
):
    return await _svc(session).get_graph(
        relation_type=relation_type,
        entity_type=entity_type,
        status=status,
        limit=limit,
    )


@router.get("/entities", response_model=SemanticEntitySearchResponse)
async def search_semantic_entities(
    session: Annotated[AsyncSession, Depends(get_session)],
    query: str | None = Query(None, description="Search by canonical name, display name, or description"),
    entity_type: str | None = Query(None, description="Filter by semantic entity type"),
    status: str | None = Query("active", description="Filter by entity status"),
    limit: int = Query(20, ge=1, le=100),
):
    return await _svc(session).search_entities(
        query=query,
        entity_type=entity_type,
        status=status,
        limit=limit,
    )


@router.get(
    "/entities/duplicate-recommendations",
    response_model=SemanticDuplicateEntityRecommendationResponse,
)
async def recommend_duplicate_semantic_entities(
    session: Annotated[AsyncSession, Depends(get_session)],
    entity_type: str | None = Query(None, description="Filter by semantic entity type"),
    min_score: float = Query(0.82, ge=0, le=1),
    limit: int = Query(50, ge=1, le=200),
):
    return await _svc(session).recommend_duplicate_entities(
        entity_type=entity_type,
        min_score=min_score,
        limit=limit,
    )


@router.post(
    "/extraction-jobs",
    response_model=SemanticExtractionJobDetail,
    status_code=status.HTTP_201_CREATED,
)
async def create_semantic_extraction_job(
    data: SemanticExtractionJobCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        return await _svc(session).create_extraction_job(data)
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.post(
    "/documents/{document_id}/extraction-jobs",
    response_model=SemanticExtractionJobDetail,
    status_code=status.HTTP_201_CREATED,
)
async def create_semantic_extraction_job_from_document(
    document_id: int,
    data: SemanticExtractionFromDocumentRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        detail = await _svc(session).create_rule_extraction_job_from_document(document_id, data)
    except ValueError as exc:
        raise _bad_request(exc) from exc
    if detail is None:
        raise HTTPException(status_code=404, detail="Knowledge document not found")
    return detail


@router.get("/extraction-candidates", response_model=SemanticExtractionCandidateListResponse)
async def list_semantic_extraction_candidates(
    session: Annotated[AsyncSession, Depends(get_session)],
    candidate_type: str | None = Query(None, description="Filter by extracted candidate type"),
    status: str | None = Query("pending_review", description="Filter by candidate review status"),
    job_id: int | None = Query(None, description="Filter by extraction job ID"),
    limit: int = Query(50, ge=1, le=200),
):
    return await _svc(session).list_extraction_candidates(
        candidate_type=candidate_type,
        status=status,
        job_id=job_id,
        limit=limit,
    )


@router.post("/extraction-candidates/{candidate_id}/reviews", response_model=SemanticExtractionCandidate)
async def review_semantic_extraction_candidate(
    candidate_id: int,
    data: SemanticExtractionCandidateReviewCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        candidate = await _svc(session).review_extraction_candidate(candidate_id, data)
    except ValueError as exc:
        raise _bad_request(exc) from exc
    if candidate is None:
        raise HTTPException(status_code=404, detail="Semantic extraction candidate not found")
    return candidate


@router.post("/entities", response_model=SemanticGraphEntity, status_code=status.HTTP_201_CREATED)
async def create_semantic_entity(
    data: SemanticGraphEntityCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        return await _svc(session).create_entity(data)
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.get("/entities/{entity_id}", response_model=SemanticGraphEntityDetail)
async def get_semantic_entity_detail(
    entity_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    detail = await _svc(session).get_entity_detail(entity_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Semantic entity not found")
    return detail


@router.patch("/entities/{entity_id}", response_model=SemanticGraphEntity)
async def update_semantic_entity(
    entity_id: int,
    data: SemanticGraphEntityUpdate,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    entity = await _svc(session).update_entity(entity_id, data)
    if entity is None:
        raise HTTPException(status_code=404, detail="Semantic entity not found")
    return entity


@router.post(
    "/entities/{entity_id}/aliases",
    response_model=SemanticGraphEntityAlias,
    status_code=status.HTTP_201_CREATED,
)
async def add_semantic_entity_alias(
    entity_id: int,
    data: SemanticGraphEntityAliasCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        alias = await _svc(session).add_entity_alias(entity_id, data)
    except ValueError as exc:
        raise _bad_request(exc) from exc
    if alias is None:
        raise HTTPException(status_code=404, detail="Semantic entity not found")
    return alias


@router.post("/entities/{entity_id}/reviews", response_model=SemanticGraphEntity)
async def review_semantic_entity(
    entity_id: int,
    data: SemanticGraphEntityReviewCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    entity = await _svc(session).review_entity(entity_id, data)
    if entity is None:
        raise HTTPException(status_code=404, detail="Semantic entity not found")
    return entity


@router.post("/entities/{entity_id}/merge", response_model=SemanticGraphEntityMergeResponse)
async def merge_semantic_entity(
    entity_id: int,
    data: SemanticGraphEntityMergeCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        result = await _svc(session).merge_entity(entity_id, data)
    except ValueError as exc:
        raise _bad_request(exc) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Semantic entity not found")
    return result


@router.get("/neighbors", response_model=SemanticGraphResponse)
async def get_semantic_neighbors(
    session: Annotated[AsyncSession, Depends(get_session)],
    entity_id: int = Query(..., description="Semantic entity ID"),
    depth: int = Query(1, ge=1, le=3),
    relation_type: str | None = Query(None, description="Filter by semantic relation type"),
    status: str | None = Query("approved", description="Filter by relation status"),
):
    return await _svc(session).get_neighbors(
        entity_id=entity_id,
        depth=depth,
        relation_type=relation_type,
        status=status,
    )


@router.get("/relations/{relation_id}", response_model=SemanticGraphRelationDetail)
async def get_semantic_relation_detail(
    relation_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    detail = await _svc(session).get_relation_detail(relation_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Semantic relation not found")
    return detail


@router.post("/relations", response_model=SemanticGraphRelation, status_code=status.HTTP_201_CREATED)
async def create_semantic_relation(
    data: SemanticGraphRelationCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        return await _svc(session).create_relation(data)
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.patch("/relations/{relation_id}", response_model=SemanticGraphRelation)
async def update_semantic_relation(
    relation_id: int,
    data: SemanticGraphRelationUpdate,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    relation = await _svc(session).update_relation(relation_id, data)
    if relation is None:
        raise HTTPException(status_code=404, detail="Semantic relation not found")
    return relation


@router.post(
    "/relations/{relation_id}/evidence",
    response_model=SemanticGraphRelationEvidence,
    status_code=status.HTTP_201_CREATED,
)
async def add_semantic_relation_evidence(
    relation_id: int,
    data: SemanticGraphRelationEvidenceCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        evidence = await _svc(session).add_relation_evidence(relation_id, data)
    except ValueError as exc:
        raise _bad_request(exc) from exc
    if evidence is None:
        raise HTTPException(status_code=404, detail="Semantic relation not found")
    return evidence


@router.post("/relations/{relation_id}/reviews", response_model=SemanticGraphRelation)
async def review_semantic_relation(
    relation_id: int,
    data: SemanticGraphRelationReviewCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    relation = await _svc(session).review_relation(relation_id, data)
    if relation is None:
        raise HTTPException(status_code=404, detail="Semantic relation not found")
    return relation


@router.get("/stats", response_model=SemanticGraphStatsResponse)
async def get_semantic_graph_stats(
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await _svc(session).get_stats()


@router.get("/quality-stats", response_model=SemanticGraphQualityStatsResponse)
async def get_semantic_graph_quality_stats(
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await _svc(session).get_quality_stats()


__all__ = ["router"]
