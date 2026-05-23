"""Semantic knowledge graph query schemas."""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


def _strip_optional(value: object) -> object:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return value


def _strip_required(value: object) -> object:
    if isinstance(value, str):
        return value.strip()
    return value


class SemanticGraphEntity(BaseModel):
    id: int
    entity_type: str
    canonical_name: str
    display_name: str | None = None
    description: str | None = None
    status: str
    source_type: str | None = None
    confidence: float | None = None
    attributes: dict = Field(default_factory=dict)
    primary_chunk_id: int | None = None
    primary_document_id: int | None = None


class SemanticGraphEntityAlias(BaseModel):
    id: int
    entity_id: int
    alias_name: str
    alias_type: str
    confidence: float | None = None
    status: str
    created_at: str
    updated_at: str


class SemanticGraphEntityCreate(BaseModel):
    entity_type: str = Field(..., min_length=1, max_length=50)
    canonical_name: str = Field(..., min_length=1, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    status: str = Field(default="active", max_length=30)
    source_type: str | None = Field(default="manual", max_length=30)
    confidence: float | None = Field(default=None, ge=0, le=1)
    primary_chunk_id: int | None = None
    primary_document_id: int | None = None
    attributes: dict = Field(default_factory=dict)
    created_by: str | None = Field(default=None, max_length=100)

    @field_validator("entity_type", "canonical_name", mode="before")
    @classmethod
    def strip_required_strings(cls, value: object) -> object:
        return _strip_required(value)

    @field_validator("display_name", "description", "status", "source_type", "created_by", mode="before")
    @classmethod
    def strip_optional_strings(cls, value: object) -> object:
        return _strip_optional(value)


class SemanticGraphEntityUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    status: str | None = Field(default=None, max_length=30)
    source_type: str | None = Field(default=None, max_length=30)
    confidence: float | None = Field(default=None, ge=0, le=1)
    primary_chunk_id: int | None = None
    primary_document_id: int | None = None
    attributes: dict | None = None
    updated_by: str | None = Field(default=None, max_length=100)

    @field_validator("display_name", "description", "status", "source_type", "updated_by", mode="before")
    @classmethod
    def strip_optional_strings(cls, value: object) -> object:
        return _strip_optional(value)


class SemanticGraphEntityAliasCreate(BaseModel):
    alias_name: str = Field(..., min_length=1, max_length=255)
    alias_type: str = Field(default="synonym", max_length=30)
    confidence: float | None = Field(default=None, ge=0, le=1)
    status: str = Field(default="active", max_length=30)

    @field_validator("alias_name", "alias_type", "status", mode="before")
    @classmethod
    def strip_required_strings(cls, value: object) -> object:
        return _strip_required(value)


class SemanticGraphEntityReviewCreate(BaseModel):
    action: str = Field(..., min_length=1, max_length=30)
    status: str | None = Field(default=None, max_length=30)
    review_note: str | None = None
    reviewer_id: str | None = Field(default=None, max_length=100)
    reviewer_name: str | None = Field(default=None, max_length=100)

    @field_validator("action", mode="before")
    @classmethod
    def strip_action(cls, value: object) -> object:
        return _strip_required(value)

    @field_validator("status", "review_note", "reviewer_id", "reviewer_name", mode="before")
    @classmethod
    def strip_optional_strings(cls, value: object) -> object:
        return _strip_optional(value)


class SemanticGraphRelation(BaseModel):
    id: int
    source_entity_id: int
    target_entity_id: int
    relation_type: str
    directional: bool
    weight: float | None = None
    confidence: float | None = None
    status: str
    source_type: str | None = None
    evidence_summary: str | None = None
    notes: str | None = None
    attributes: dict = Field(default_factory=dict)
    created_at: str
    updated_at: str


class SemanticGraphRelationCreate(BaseModel):
    source_entity_id: int
    target_entity_id: int
    relation_type: str = Field(..., min_length=1, max_length=50)
    directional: bool = True
    weight: float | None = Field(default=None, ge=0)
    confidence: float | None = Field(default=None, ge=0, le=1)
    status: str = Field(default="approved", max_length=30)
    source_type: str | None = Field(default="manual", max_length=30)
    evidence_summary: str | None = None
    notes: str | None = None
    attributes: dict = Field(default_factory=dict)
    created_by: str | None = Field(default=None, max_length=100)

    @field_validator("relation_type", mode="before")
    @classmethod
    def strip_relation_type(cls, value: object) -> object:
        return _strip_required(value)

    @field_validator("status", "source_type", "evidence_summary", "notes", "created_by", mode="before")
    @classmethod
    def strip_optional_strings(cls, value: object) -> object:
        return _strip_optional(value)


class SemanticGraphRelationUpdate(BaseModel):
    relation_type: str | None = Field(default=None, max_length=50)
    directional: bool | None = None
    weight: float | None = Field(default=None, ge=0)
    confidence: float | None = Field(default=None, ge=0, le=1)
    status: str | None = Field(default=None, max_length=30)
    source_type: str | None = Field(default=None, max_length=30)
    evidence_summary: str | None = None
    notes: str | None = None
    attributes: dict | None = None
    updated_by: str | None = Field(default=None, max_length=100)

    @field_validator("relation_type", "status", "source_type", "evidence_summary", "notes", "updated_by", mode="before")
    @classmethod
    def strip_optional_strings(cls, value: object) -> object:
        return _strip_optional(value)


class SemanticGraphRelationEvidence(BaseModel):
    id: int
    relation_id: int
    chunk_id: int | None = None
    document_id: int | None = None
    excerpt: str | None = None
    page_reference: str | None = None
    section_reference: str | None = None
    evidence_type: str | None = None
    confidence: float | None = None
    created_at: str


class SemanticGraphRelationEvidenceCreate(BaseModel):
    chunk_id: int | None = None
    document_id: int | None = None
    excerpt: str | None = None
    page_reference: str | None = Field(default=None, max_length=100)
    section_reference: str | None = Field(default=None, max_length=255)
    evidence_type: str | None = Field(default="document_chunk", max_length=30)
    confidence: float | None = Field(default=None, ge=0, le=1)

    @field_validator("excerpt", "page_reference", "section_reference", "evidence_type", mode="before")
    @classmethod
    def strip_optional_strings(cls, value: object) -> object:
        return _strip_optional(value)


class SemanticGraphRelationReviewCreate(BaseModel):
    action: str = Field(..., min_length=1, max_length=30)
    status: str | None = Field(default=None, max_length=30)
    review_note: str | None = None
    reviewer_id: str | None = Field(default=None, max_length=100)
    reviewer_name: str | None = Field(default=None, max_length=100)

    @field_validator("action", mode="before")
    @classmethod
    def strip_action(cls, value: object) -> object:
        return _strip_required(value)

    @field_validator("status", "review_note", "reviewer_id", "reviewer_name", mode="before")
    @classmethod
    def strip_optional_strings(cls, value: object) -> object:
        return _strip_optional(value)


class SemanticGraphResponse(BaseModel):
    entities: list[SemanticGraphEntity]
    relations: list[SemanticGraphRelation]


class SemanticGraphRelationDetail(BaseModel):
    relation: SemanticGraphRelation
    evidence: list[SemanticGraphRelationEvidence]


class SemanticGraphEntityDetail(BaseModel):
    entity: SemanticGraphEntity
    aliases: list[SemanticGraphEntityAlias] = Field(default_factory=list)


class SemanticGraphStatsResponse(BaseModel):
    total_entities: int
    total_relations: int
    entities_by_type: dict[str, int]
    relations_by_type: dict[str, int]
    relations_by_status: dict[str, int]


class SemanticGraphQualityStatsResponse(BaseModel):
    duplicate_entity_groups: int
    pending_entity_candidates: int
    pending_relation_candidates: int
    relations_without_evidence: int
    relations_without_evidence_or_review: int
    low_confidence_relations: int
    safety_risk_entities: int = 0
    standard_parameter_entities: int = 0
    forbidden_action_entities: int = 0
    relations_with_safety_risk: int = 0


class SemanticGraphEntityMergeCreate(BaseModel):
    target_entity_id: int
    reason: str | None = None
    merged_by: str | None = Field(default=None, max_length=100)

    @field_validator("reason", "merged_by", mode="before")
    @classmethod
    def strip_optional_strings(cls, value: object) -> object:
        return _strip_optional(value)


class SemanticGraphEntityMergeResponse(BaseModel):
    source_entity_id: int
    target_entity_id: int
    moved_relations: int
    moved_aliases: int
    removed_duplicate_relations: int


class SemanticEntitySearchItem(BaseModel):
    entity: SemanticGraphEntity
    relation_count: int = 0


class SemanticEntitySearchResponse(BaseModel):
    total: int
    items: list[SemanticEntitySearchItem]


class SemanticDuplicateEntityCandidate(BaseModel):
    entity: SemanticGraphEntity
    duplicate_entity: SemanticGraphEntity
    score: float
    matched_on: str


class SemanticDuplicateEntityRecommendationResponse(BaseModel):
    total: int
    items: list[SemanticDuplicateEntityCandidate]


class SemanticExtractionCandidateCreate(BaseModel):
    candidate_type: str = Field(..., min_length=1, max_length=30)
    payload: dict
    normalized_payload: dict | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    status: str = Field(default="pending_review", max_length=30)
    review_note: str | None = None
    chunk_id: int | None = None
    document_id: int | None = None

    @field_validator("candidate_type", "status", mode="before")
    @classmethod
    def strip_required_strings(cls, value: object) -> object:
        return _strip_required(value)

    @field_validator("review_note", mode="before")
    @classmethod
    def strip_optional_strings(cls, value: object) -> object:
        return _strip_optional(value)


class SemanticExtractionJobCreate(BaseModel):
    job_type: str = Field(default="manual_extract", max_length=30)
    trigger_source: str = Field(default="manual", max_length=30)
    document_id: int | None = None
    chunk_id: int | None = None
    case_id: int | None = None
    summary: str | None = None
    candidates: list[SemanticExtractionCandidateCreate] = Field(default_factory=list)

    @field_validator("job_type", "trigger_source", mode="before")
    @classmethod
    def strip_required_strings(cls, value: object) -> object:
        return _strip_required(value)

    @field_validator("summary", mode="before")
    @classmethod
    def strip_optional_strings(cls, value: object) -> object:
        return _strip_optional(value)


class SemanticExtractionFromDocumentRequest(BaseModel):
    job_type: str = Field(default="rule_extract", max_length=30)
    trigger_source: str = Field(default="document", max_length=30)
    status: str = Field(default="pending_review", max_length=30)
    limit_chunks: int = Field(default=200, ge=1, le=1000)
    include_relations: bool = True

    @field_validator("job_type", "trigger_source", "status", mode="before")
    @classmethod
    def strip_required_strings(cls, value: object) -> object:
        return _strip_required(value)


class SemanticExtractionJob(BaseModel):
    id: int
    job_type: str
    trigger_source: str
    document_id: int | None = None
    chunk_id: int | None = None
    case_id: int | None = None
    status: str
    summary: str | None = None
    error_message: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    created_at: str


class SemanticExtractionCandidate(BaseModel):
    id: int
    job_id: int
    candidate_type: str
    payload: dict
    normalized_payload: dict = Field(default_factory=dict)
    confidence: float | None = None
    status: str
    review_note: str | None = None
    chunk_id: int | None = None
    document_id: int | None = None
    created_at: str
    updated_at: str


class SemanticExtractionJobDetail(BaseModel):
    job: SemanticExtractionJob
    candidates: list[SemanticExtractionCandidate] = Field(default_factory=list)


class SemanticExtractionCandidateListResponse(BaseModel):
    total: int
    items: list[SemanticExtractionCandidate]


class SemanticExtractionCandidateReviewCreate(BaseModel):
    action: str = Field(..., min_length=1, max_length=30)
    status: str | None = Field(default=None, max_length=30)
    review_note: str | None = None
    reviewer_id: str | None = Field(default=None, max_length=100)
    reviewer_name: str | None = Field(default=None, max_length=100)

    @field_validator("action", mode="before")
    @classmethod
    def strip_action(cls, value: object) -> object:
        return _strip_required(value)

    @field_validator("status", "review_note", "reviewer_id", "reviewer_name", mode="before")
    @classmethod
    def strip_optional_strings(cls, value: object) -> object:
        return _strip_optional(value)
