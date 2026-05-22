"""add knowledge bases hierarchy

Revision ID: l5m6n7o8p9q0
Revises: k4l5m6n7o8p9
Create Date: 2026-05-22 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "l5m6n7o8p9q0"
down_revision: Union[str, Sequence[str], None] = "k4l5m6n7o8p9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "knowledge_bases",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("slug", name="uq_knowledge_bases_slug"),
    )
    op.create_index("ix_knowledge_bases_slug", "knowledge_bases", ["slug"], unique=False)

    op.execute(
        """
        INSERT INTO knowledge_bases (id, name, slug, description, created_at, updated_at)
        VALUES (
            1,
            '设备检修知识库',
            'maintenance-default',
            '设备检修、故障诊断与维修手册的统一知识库。',
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        )
        """
    )

    with op.batch_alter_table("knowledge_documents") as batch_op:
        batch_op.add_column(sa.Column("knowledge_base_id", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column("document_type", sa.String(length=30), nullable=False, server_default="pdf")
        )
        batch_op.add_column(sa.Column("source_modality", sa.String(length=30), nullable=True))
        batch_op.add_column(sa.Column("object_key", sa.String(length=500), nullable=True))

    op.execute("UPDATE knowledge_documents SET knowledge_base_id = 1 WHERE knowledge_base_id IS NULL")
    op.execute(
        """
        UPDATE knowledge_documents
        SET document_type = CASE
            WHEN lower(source_name) LIKE '%.png'
              OR lower(source_name) LIKE '%.jpg'
              OR lower(source_name) LIKE '%.jpeg'
              OR lower(source_name) LIKE '%.webp'
              THEN 'image'
            WHEN lower(source_name) LIKE '%.json'
              OR lower(source_name) LIKE '%.jsonl'
              OR lower(source_name) LIKE '%.ndjson'
              THEN 'json'
            WHEN lower(source_name) LIKE '%.txt'
              OR lower(source_name) LIKE '%.md'
              OR lower(source_name) LIKE '%.markdown'
              THEN 'text'
            ELSE 'pdf'
        END
        WHERE document_type IS NULL OR document_type = 'pdf'
        """
    )

    with op.batch_alter_table("knowledge_documents") as batch_op:
        batch_op.alter_column("knowledge_base_id", nullable=False)
        batch_op.create_foreign_key(
            "fk_knowledge_documents_knowledge_base_id",
            "knowledge_bases",
            ["knowledge_base_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_index("ix_knowledge_documents_knowledge_base_id", ["knowledge_base_id"])

    with op.batch_alter_table("knowledge_chunks") as batch_op:
        batch_op.add_column(sa.Column("knowledge_base_id", sa.Integer(), nullable=True))

    op.execute(
        """
        UPDATE knowledge_chunks
        SET knowledge_base_id = (
            SELECT knowledge_base_id FROM knowledge_documents
            WHERE knowledge_documents.id = knowledge_chunks.document_id
        )
        WHERE knowledge_base_id IS NULL
        """
    )

    with op.batch_alter_table("knowledge_chunks") as batch_op:
        batch_op.alter_column("knowledge_base_id", nullable=False)
        batch_op.create_foreign_key(
            "fk_knowledge_chunks_knowledge_base_id",
            "knowledge_bases",
            ["knowledge_base_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_index("ix_knowledge_chunks_knowledge_base_id", ["knowledge_base_id"])

    with op.batch_alter_table("knowledge_import_jobs") as batch_op:
        batch_op.add_column(sa.Column("knowledge_base_id", sa.Integer(), nullable=True))

    op.execute("UPDATE knowledge_import_jobs SET knowledge_base_id = 1 WHERE knowledge_base_id IS NULL")

    with op.batch_alter_table("knowledge_import_jobs") as batch_op:
        batch_op.alter_column("knowledge_base_id", nullable=False)
        batch_op.create_foreign_key(
            "fk_knowledge_import_jobs_knowledge_base_id",
            "knowledge_bases",
            ["knowledge_base_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_index("ix_knowledge_import_jobs_knowledge_base_id", ["knowledge_base_id"])


def downgrade() -> None:
    with op.batch_alter_table("knowledge_import_jobs") as batch_op:
        batch_op.drop_index("ix_knowledge_import_jobs_knowledge_base_id")
        batch_op.drop_constraint("fk_knowledge_import_jobs_knowledge_base_id", type_="foreignkey")
        batch_op.drop_column("knowledge_base_id")

    with op.batch_alter_table("knowledge_chunks") as batch_op:
        batch_op.drop_index("ix_knowledge_chunks_knowledge_base_id")
        batch_op.drop_constraint("fk_knowledge_chunks_knowledge_base_id", type_="foreignkey")
        batch_op.drop_column("knowledge_base_id")

    with op.batch_alter_table("knowledge_documents") as batch_op:
        batch_op.drop_index("ix_knowledge_documents_knowledge_base_id")
        batch_op.drop_constraint("fk_knowledge_documents_knowledge_base_id", type_="foreignkey")
        batch_op.drop_column("object_key")
        batch_op.drop_column("source_modality")
        batch_op.drop_column("document_type")
        batch_op.drop_column("knowledge_base_id")

    op.drop_index("ix_knowledge_bases_slug", table_name="knowledge_bases")
    op.drop_table("knowledge_bases")
