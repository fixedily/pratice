"""add knowledge base metadata fields

Revision ID: m6n7o8p9q0r1
Revises: l5m6n7o8p9q0
Create Date: 2026-05-22 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "m6n7o8p9q0r1"
down_revision: Union[str, Sequence[str], None] = "l5m6n7o8p9q0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("knowledge_bases") as batch_op:
        batch_op.add_column(
            sa.Column("type", sa.String(length=30), nullable=False, server_default="comprehensive")
        )
        batch_op.add_column(
            sa.Column("visibility", sa.String(length=30), nullable=False, server_default="internal")
        )

    op.execute(
        """
        UPDATE knowledge_bases
        SET type = 'comprehensive', visibility = 'internal'
        WHERE type IS NULL OR visibility IS NULL
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("knowledge_bases") as batch_op:
        batch_op.drop_column("visibility")
        batch_op.drop_column("type")
