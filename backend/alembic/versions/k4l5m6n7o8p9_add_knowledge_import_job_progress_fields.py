"""add knowledge import job progress and batch fields

Revision ID: k4l5m6n7o8p9
Revises: j3c4d5e6f7g8
Create Date: 2026-05-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "k4l5m6n7o8p9"
down_revision: Union[str, Sequence[str], None] = "j3c4d5e6f7g8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("knowledge_import_jobs") as batch_op:
        batch_op.add_column(sa.Column("batch_id", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("file_size", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("file_hash", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("file_type", sa.String(length=50), nullable=True))
        batch_op.add_column(
            sa.Column("progress", sa.Integer(), nullable=False, server_default="0")
        )
        batch_op.add_column(sa.Column("current_stage", sa.String(length=30), nullable=True))
        batch_op.add_column(sa.Column("error_stage", sa.String(length=30), nullable=True))
    op.create_index(
        "ix_knowledge_import_jobs_batch_id",
        "knowledge_import_jobs",
        ["batch_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_knowledge_import_jobs_batch_id", table_name="knowledge_import_jobs")
    with op.batch_alter_table("knowledge_import_jobs") as batch_op:
        batch_op.drop_column("error_stage")
        batch_op.drop_column("current_stage")
        batch_op.drop_column("progress")
        batch_op.drop_column("file_type")
        batch_op.drop_column("file_hash")
        batch_op.drop_column("file_size")
        batch_op.drop_column("batch_id")
