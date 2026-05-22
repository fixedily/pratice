"""add knowledge graph semantic tables

Revision ID: j3c4d5e6f7g8
Revises: i2b3c4d5e6f7
Create Date: 2026-05-13 22:10:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "j3c4d5e6f7g8"
down_revision: Union[str, Sequence[str], None] = "i2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "kg_entities",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("entity_type", sa.String(length=50), nullable=False),
        sa.Column("canonical_name", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("source_type", sa.String(length=30), nullable=True),
        sa.Column("confidence", sa.Numeric(5, 2), nullable=True),
        sa.Column(
            "primary_chunk_id",
            sa.Integer(),
            sa.ForeignKey("knowledge_chunks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "primary_document_id",
            sa.Integer(),
            sa.ForeignKey("knowledge_documents.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("attributes", sa.JSON(), nullable=True),
        sa.Column("created_by", sa.String(length=100), nullable=True),
        sa.Column("updated_by", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("entity_type", "canonical_name", name="uq_kg_entities_type_canonical"),
    )
    op.create_index("ix_kg_entities_entity_type", "kg_entities", ["entity_type"], unique=False)
    op.create_index("ix_kg_entities_canonical_name", "kg_entities", ["canonical_name"], unique=False)
    op.create_index("ix_kg_entities_status", "kg_entities", ["status"], unique=False)
    op.create_index("ix_kg_entities_source_type", "kg_entities", ["source_type"], unique=False)
    op.create_index("ix_kg_entities_primary_chunk_id", "kg_entities", ["primary_chunk_id"], unique=False)
    op.create_index(
        "ix_kg_entities_primary_document_id",
        "kg_entities",
        ["primary_document_id"],
        unique=False,
    )

    op.create_table(
        "kg_entity_aliases",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "entity_id",
            sa.Integer(),
            sa.ForeignKey("kg_entities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("alias_name", sa.String(length=255), nullable=False),
        sa.Column("alias_type", sa.String(length=30), nullable=False),
        sa.Column("confidence", sa.Numeric(5, 2), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("entity_id", "alias_name", name="uq_kg_entity_aliases_entity_alias"),
    )
    op.create_index("ix_kg_entity_aliases_entity_id", "kg_entity_aliases", ["entity_id"], unique=False)
    op.create_index("ix_kg_entity_aliases_alias_name", "kg_entity_aliases", ["alias_name"], unique=False)
    op.create_index("ix_kg_entity_aliases_alias_type", "kg_entity_aliases", ["alias_type"], unique=False)
    op.create_index("ix_kg_entity_aliases_status", "kg_entity_aliases", ["status"], unique=False)

    op.create_table(
        "kg_relations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "source_entity_id",
            sa.Integer(),
            sa.ForeignKey("kg_entities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "target_entity_id",
            sa.Integer(),
            sa.ForeignKey("kg_entities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("relation_type", sa.String(length=50), nullable=False),
        sa.Column("directional", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("weight", sa.Numeric(6, 3), nullable=True),
        sa.Column("confidence", sa.Numeric(5, 2), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("source_type", sa.String(length=30), nullable=True),
        sa.Column("evidence_summary", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("attributes", sa.JSON(), nullable=True),
        sa.Column("created_by", sa.String(length=100), nullable=True),
        sa.Column("updated_by", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_kg_relations_source_entity_id", "kg_relations", ["source_entity_id"], unique=False)
    op.create_index("ix_kg_relations_target_entity_id", "kg_relations", ["target_entity_id"], unique=False)
    op.create_index("ix_kg_relations_relation_type", "kg_relations", ["relation_type"], unique=False)
    op.create_index("ix_kg_relations_status", "kg_relations", ["status"], unique=False)
    op.create_index("ix_kg_relations_source_type", "kg_relations", ["source_type"], unique=False)

    op.create_table(
        "kg_relation_evidence",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "relation_id",
            sa.Integer(),
            sa.ForeignKey("kg_relations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "chunk_id",
            sa.Integer(),
            sa.ForeignKey("knowledge_chunks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "document_id",
            sa.Integer(),
            sa.ForeignKey("knowledge_documents.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("excerpt", sa.Text(), nullable=True),
        sa.Column("page_reference", sa.String(length=100), nullable=True),
        sa.Column("section_reference", sa.String(length=255), nullable=True),
        sa.Column("evidence_type", sa.String(length=30), nullable=True),
        sa.Column("confidence", sa.Numeric(5, 2), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_kg_relation_evidence_relation_id", "kg_relation_evidence", ["relation_id"], unique=False)
    op.create_index("ix_kg_relation_evidence_chunk_id", "kg_relation_evidence", ["chunk_id"], unique=False)
    op.create_index("ix_kg_relation_evidence_document_id", "kg_relation_evidence", ["document_id"], unique=False)
    op.create_index(
        "ix_kg_relation_evidence_evidence_type",
        "kg_relation_evidence",
        ["evidence_type"],
        unique=False,
    )

    op.create_table(
        "kg_relation_reviews",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "relation_id",
            sa.Integer(),
            sa.ForeignKey("kg_relations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("action", sa.String(length=30), nullable=False),
        sa.Column("review_status_before", sa.String(length=30), nullable=True),
        sa.Column("review_status_after", sa.String(length=30), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("reviewer_id", sa.String(length=100), nullable=True),
        sa.Column("reviewer_name", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_kg_relation_reviews_relation_id", "kg_relation_reviews", ["relation_id"], unique=False)
    op.create_index("ix_kg_relation_reviews_action", "kg_relation_reviews", ["action"], unique=False)

    op.create_table(
        "kg_entity_reviews",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "entity_id",
            sa.Integer(),
            sa.ForeignKey("kg_entities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("action", sa.String(length=30), nullable=False),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("reviewer_id", sa.String(length=100), nullable=True),
        sa.Column("reviewer_name", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_kg_entity_reviews_entity_id", "kg_entity_reviews", ["entity_id"], unique=False)
    op.create_index("ix_kg_entity_reviews_action", "kg_entity_reviews", ["action"], unique=False)

    op.create_table(
        "kg_entity_merges",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "source_entity_id",
            sa.Integer(),
            sa.ForeignKey("kg_entities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "target_entity_id",
            sa.Integer(),
            sa.ForeignKey("kg_entities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("merged_by", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_kg_entity_merges_source_entity_id", "kg_entity_merges", ["source_entity_id"], unique=False)
    op.create_index("ix_kg_entity_merges_target_entity_id", "kg_entity_merges", ["target_entity_id"], unique=False)

    op.create_table(
        "kg_extraction_jobs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("job_type", sa.String(length=30), nullable=False),
        sa.Column("trigger_source", sa.String(length=30), nullable=False),
        sa.Column(
            "document_id",
            sa.Integer(),
            sa.ForeignKey("knowledge_documents.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "chunk_id",
            sa.Integer(),
            sa.ForeignKey("knowledge_chunks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "case_id",
            sa.Integer(),
            sa.ForeignKey("maintenance_cases.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_kg_extraction_jobs_job_type", "kg_extraction_jobs", ["job_type"], unique=False)
    op.create_index("ix_kg_extraction_jobs_trigger_source", "kg_extraction_jobs", ["trigger_source"], unique=False)
    op.create_index("ix_kg_extraction_jobs_document_id", "kg_extraction_jobs", ["document_id"], unique=False)
    op.create_index("ix_kg_extraction_jobs_chunk_id", "kg_extraction_jobs", ["chunk_id"], unique=False)
    op.create_index("ix_kg_extraction_jobs_case_id", "kg_extraction_jobs", ["case_id"], unique=False)
    op.create_index("ix_kg_extraction_jobs_status", "kg_extraction_jobs", ["status"], unique=False)

    op.create_table(
        "kg_extracted_candidates",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "job_id",
            sa.Integer(),
            sa.ForeignKey("kg_extraction_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("candidate_type", sa.String(length=30), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("normalized_payload", sa.JSON(), nullable=True),
        sa.Column("confidence", sa.Numeric(5, 2), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column(
            "chunk_id",
            sa.Integer(),
            sa.ForeignKey("knowledge_chunks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "document_id",
            sa.Integer(),
            sa.ForeignKey("knowledge_documents.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_kg_extracted_candidates_job_id", "kg_extracted_candidates", ["job_id"], unique=False)
    op.create_index(
        "ix_kg_extracted_candidates_candidate_type",
        "kg_extracted_candidates",
        ["candidate_type"],
        unique=False,
    )
    op.create_index("ix_kg_extracted_candidates_status", "kg_extracted_candidates", ["status"], unique=False)
    op.create_index("ix_kg_extracted_candidates_chunk_id", "kg_extracted_candidates", ["chunk_id"], unique=False)
    op.create_index(
        "ix_kg_extracted_candidates_document_id",
        "kg_extracted_candidates",
        ["document_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_kg_extracted_candidates_document_id", table_name="kg_extracted_candidates")
    op.drop_index("ix_kg_extracted_candidates_chunk_id", table_name="kg_extracted_candidates")
    op.drop_index("ix_kg_extracted_candidates_status", table_name="kg_extracted_candidates")
    op.drop_index("ix_kg_extracted_candidates_candidate_type", table_name="kg_extracted_candidates")
    op.drop_index("ix_kg_extracted_candidates_job_id", table_name="kg_extracted_candidates")
    op.drop_table("kg_extracted_candidates")

    op.drop_index("ix_kg_extraction_jobs_status", table_name="kg_extraction_jobs")
    op.drop_index("ix_kg_extraction_jobs_case_id", table_name="kg_extraction_jobs")
    op.drop_index("ix_kg_extraction_jobs_chunk_id", table_name="kg_extraction_jobs")
    op.drop_index("ix_kg_extraction_jobs_document_id", table_name="kg_extraction_jobs")
    op.drop_index("ix_kg_extraction_jobs_trigger_source", table_name="kg_extraction_jobs")
    op.drop_index("ix_kg_extraction_jobs_job_type", table_name="kg_extraction_jobs")
    op.drop_table("kg_extraction_jobs")

    op.drop_index("ix_kg_entity_merges_target_entity_id", table_name="kg_entity_merges")
    op.drop_index("ix_kg_entity_merges_source_entity_id", table_name="kg_entity_merges")
    op.drop_table("kg_entity_merges")

    op.drop_index("ix_kg_entity_reviews_action", table_name="kg_entity_reviews")
    op.drop_index("ix_kg_entity_reviews_entity_id", table_name="kg_entity_reviews")
    op.drop_table("kg_entity_reviews")

    op.drop_index("ix_kg_relation_reviews_action", table_name="kg_relation_reviews")
    op.drop_index("ix_kg_relation_reviews_relation_id", table_name="kg_relation_reviews")
    op.drop_table("kg_relation_reviews")

    op.drop_index("ix_kg_relation_evidence_evidence_type", table_name="kg_relation_evidence")
    op.drop_index("ix_kg_relation_evidence_document_id", table_name="kg_relation_evidence")
    op.drop_index("ix_kg_relation_evidence_chunk_id", table_name="kg_relation_evidence")
    op.drop_index("ix_kg_relation_evidence_relation_id", table_name="kg_relation_evidence")
    op.drop_table("kg_relation_evidence")

    op.drop_index("ix_kg_relations_source_type", table_name="kg_relations")
    op.drop_index("ix_kg_relations_status", table_name="kg_relations")
    op.drop_index("ix_kg_relations_relation_type", table_name="kg_relations")
    op.drop_index("ix_kg_relations_target_entity_id", table_name="kg_relations")
    op.drop_index("ix_kg_relations_source_entity_id", table_name="kg_relations")
    op.drop_table("kg_relations")

    op.drop_index("ix_kg_entity_aliases_status", table_name="kg_entity_aliases")
    op.drop_index("ix_kg_entity_aliases_alias_type", table_name="kg_entity_aliases")
    op.drop_index("ix_kg_entity_aliases_alias_name", table_name="kg_entity_aliases")
    op.drop_index("ix_kg_entity_aliases_entity_id", table_name="kg_entity_aliases")
    op.drop_table("kg_entity_aliases")

    op.drop_index("ix_kg_entities_primary_document_id", table_name="kg_entities")
    op.drop_index("ix_kg_entities_primary_chunk_id", table_name="kg_entities")
    op.drop_index("ix_kg_entities_source_type", table_name="kg_entities")
    op.drop_index("ix_kg_entities_status", table_name="kg_entities")
    op.drop_index("ix_kg_entities_canonical_name", table_name="kg_entities")
    op.drop_index("ix_kg_entities_entity_type", table_name="kg_entities")
    op.drop_table("kg_entities")
