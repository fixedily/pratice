"""Knowledge base models for the 软件杯检修知识系统."""
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    Numeric,
    event,
    insert,
    select,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

DEFAULT_KNOWLEDGE_BASE_SLUG = "maintenance-default"
DEFAULT_KNOWLEDGE_BASE_NAME = "设备检修知识库"
DEFAULT_KNOWLEDGE_BASE_DESCRIPTION = "设备检修、故障诊断与维修手册的统一知识库。"


class KnowledgeBase(Base):
    """Business-domain knowledge repository grouping multiple documents."""

    __tablename__ = "knowledge_bases"
    __table_args__ = (UniqueConstraint("slug", name="uq_knowledge_bases_slug"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    type: Mapped[str] = mapped_column(String(30), default="comprehensive", nullable=False, index=True)
    visibility: Mapped[str] = mapped_column(String(30), default="internal", nullable=False, index=True)
    owner_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    documents: Mapped[list["KnowledgeDocument"]] = relationship(
        back_populates="knowledge_base",
        cascade="all, delete-orphan",
    )


class DeviceModel(Base):
    """Supported equipment model metadata."""

    __tablename__ = "device_models"
    __table_args__ = (
        UniqueConstraint("equipment_type", "model_code", name="uq_device_models_type_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    equipment_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    model_code: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    manufacturer: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class KnowledgeDocument(Base):
    """Source knowledge document imported into the system."""

    __tablename__ = "knowledge_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    knowledge_base_id: Mapped[int] = mapped_column(
        ForeignKey("knowledge_bases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source_name: Mapped[str] = mapped_column(String(255), nullable=False)
    document_type: Mapped[str] = mapped_column(String(30), default="pdf", nullable=False, index=True)
    source_modality: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    object_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    equipment_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    equipment_model: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    fault_type: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    section_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    page_reference: Mapped[str | None] = mapped_column(String(50), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="published", nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    knowledge_base: Mapped["KnowledgeBase"] = relationship(back_populates="documents")
    chunks: Mapped[list["KnowledgeChunk"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="KnowledgeChunk.chunk_index",
    )


class KnowledgeImportJob(Base):
    """Track formal knowledge import runs for the management console."""

    __tablename__ = "knowledge_import_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    knowledge_base_id: Mapped[int] = mapped_column(
        ForeignKey("knowledge_bases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    batch_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    import_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    file_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    file_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    equipment_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    equipment_model: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    fault_type: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    section_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    replace_existing: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="pending", nullable=False, index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    current_stage: Mapped[str | None] = mapped_column(String(30), nullable=True)
    error_stage: Mapped[str | None] = mapped_column(String(30), nullable=True)
    file_bytes: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chunk_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    document_id: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_documents.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    preview_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class AgentRun(Base):
    """Persisted agent collaboration run snapshot for playback and recovery."""

    __tablename__ = "agent_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class KnowledgeChunk(Base):
    """Searchable chunk derived from a source knowledge document."""

    __tablename__ = "knowledge_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("knowledge_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    knowledge_base_id: Mapped[int] = mapped_column(
        ForeignKey("knowledge_bases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    heading: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    equipment_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    equipment_model: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    fault_type: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    section_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    section_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    step_anchor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    page_reference: Mapped[str | None] = mapped_column(String(50), nullable=True)
    image_anchor: Mapped[str | None] = mapped_column(String(100), nullable=True)
    source_modality: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    ocr_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    document: Mapped[KnowledgeDocument] = relationship(back_populates="chunks")


def _ensure_default_knowledge_base_id(connection) -> int:
    base_table = KnowledgeBase.__table__
    stmt = select(base_table.c.id).where(base_table.c.slug == DEFAULT_KNOWLEDGE_BASE_SLUG).limit(1)
    existing = connection.execute(stmt).scalar_one_or_none()
    if existing is not None:
        return int(existing)

    now = datetime.utcnow()
    result = connection.execute(
        insert(base_table).values(
            name=DEFAULT_KNOWLEDGE_BASE_NAME,
            slug=DEFAULT_KNOWLEDGE_BASE_SLUG,
            description=DEFAULT_KNOWLEDGE_BASE_DESCRIPTION,
            type="comprehensive",
            visibility="internal",
            owner_id=None,
            created_at=now,
            updated_at=now,
        )
    )
    return int(result.inserted_primary_key[0])


@event.listens_for(KnowledgeDocument, "before_insert")
def _assign_default_knowledge_base_id(mapper, connection, target) -> None:  # noqa: ANN001
    if getattr(target, "knowledge_base_id", None) is not None:
        return
    target.knowledge_base_id = _ensure_default_knowledge_base_id(connection)


@event.listens_for(KnowledgeChunk, "before_insert")
def _assign_chunk_knowledge_base_id(mapper, connection, target) -> None:  # noqa: ANN001
    if getattr(target, "knowledge_base_id", None) is not None:
        return
    if getattr(target, "document_id", None) is not None:
        document_table = KnowledgeDocument.__table__
        stmt = select(document_table.c.knowledge_base_id).where(
            document_table.c.id == target.document_id
        )
        document_base_id = connection.execute(stmt).scalar_one_or_none()
        if document_base_id is not None:
            target.knowledge_base_id = int(document_base_id)
            return
    target.knowledge_base_id = _ensure_default_knowledge_base_id(connection)


class MaintenanceCase(Base):
    """User-uploaded maintenance case for later review and knowledge reuse."""

    __tablename__ = "maintenance_cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    work_order_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    asset_code: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    report_source: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    priority: Mapped[str] = mapped_column(
        String(30), default="medium", nullable=False, index=True
    )
    equipment_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    equipment_model: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    fault_type: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    task_id: Mapped[int | None] = mapped_column(
        ForeignKey("maintenance_tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    symptom_description: Mapped[str] = mapped_column(Text, nullable=False)
    processing_steps: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    resolution_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachment_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    attachment_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    knowledge_refs: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(
        String(30), default="pending_review", nullable=False, index=True
    )
    reviewer_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    source_document_id: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_documents.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class MaintenanceCaseCorrection(Base):
    """Manual correction records for retrieval/model outputs tied to a case."""

    __tablename__ = "maintenance_case_corrections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("maintenance_cases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    correction_target: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    original_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    corrected_content: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="accepted", nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class KnowledgeRelation(Base):
    """Structured relation table for documents, cases and future task entities."""

    __tablename__ = "knowledge_relations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_kind: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    source_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    target_kind: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    relation_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class KgEntity(Base):
    """Semantic knowledge graph entity."""

    __tablename__ = "kg_entities"
    __table_args__ = (
        UniqueConstraint("entity_type", "canonical_name", name="uq_kg_entities_type_canonical"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    canonical_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="active", nullable=False, index=True)
    source_type: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    confidence: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    primary_chunk_id: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_chunks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    primary_document_id: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_documents.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    attributes: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=dict)
    created_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class KgEntityAlias(Base):
    """Alias and variant names for semantic entities."""

    __tablename__ = "kg_entity_aliases"
    __table_args__ = (
        UniqueConstraint("entity_id", "alias_name", name="uq_kg_entity_aliases_entity_alias"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_id: Mapped[int] = mapped_column(
        ForeignKey("kg_entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    alias_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    alias_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    confidence: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="active", nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class KgRelation(Base):
    """Semantic relation between knowledge graph entities."""

    __tablename__ = "kg_relations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_entity_id: Mapped[int] = mapped_column(
        ForeignKey("kg_entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_entity_id: Mapped[int] = mapped_column(
        ForeignKey("kg_entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    relation_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    directional: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    weight: Mapped[float | None] = mapped_column(Numeric(6, 3), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="draft", nullable=False, index=True)
    source_type: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    evidence_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    attributes: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=dict)
    created_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class KgRelationEvidence(Base):
    """Evidence records that support a semantic relation."""

    __tablename__ = "kg_relation_evidence"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    relation_id: Mapped[int] = mapped_column(
        ForeignKey("kg_relations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chunk_id: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_chunks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    document_id: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_documents.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    section_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    evidence_type: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    confidence: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class KgRelationReview(Base):
    """Review history for semantic relations."""

    __tablename__ = "kg_relation_reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    relation_id: Mapped[int] = mapped_column(
        ForeignKey("kg_relations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    action: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    review_status_before: Mapped[str | None] = mapped_column(String(30), nullable=True)
    review_status_after: Mapped[str | None] = mapped_column(String(30), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewer_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reviewer_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class KgEntityReview(Base):
    """Review history for semantic entities."""

    __tablename__ = "kg_entity_reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_id: Mapped[int] = mapped_column(
        ForeignKey("kg_entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    action: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewer_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reviewer_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class KgEntityMerge(Base):
    """Merge history for deduplicated semantic entities."""

    __tablename__ = "kg_entity_merges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_entity_id: Mapped[int] = mapped_column(
        ForeignKey("kg_entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_entity_id: Mapped[int] = mapped_column(
        ForeignKey("kg_entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    merged_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class KgExtractionJob(Base):
    """Extraction job for semantic entities and relations."""

    __tablename__ = "kg_extraction_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    trigger_source: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    document_id: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_documents.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    chunk_id: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_chunks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    case_id: Mapped[int | None] = mapped_column(
        ForeignKey("maintenance_cases.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class KgExtractedCandidate(Base):
    """Candidate entity or relation extracted before formal review."""

    __tablename__ = "kg_extracted_candidates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("kg_extraction_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    candidate_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    normalized_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    status: Mapped[str] = mapped_column(
        String(30), default="pending_review", nullable=False, index=True
    )
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    chunk_id: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_chunks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    document_id: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_documents.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
