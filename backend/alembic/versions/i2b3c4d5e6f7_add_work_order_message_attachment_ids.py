"""add work_order_messages attachment ids

Revision ID: i2b3c4d5e6f7
Revises: h1a2b3c4d5e6
Create Date: 2026-05-12 16:55:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "i2b3c4d5e6f7"
down_revision = "h1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    dialect_name = op.get_bind().dialect.name
    if dialect_name == "sqlite":
        with op.batch_alter_table("work_order_messages") as batch_op:
            batch_op.add_column(sa.Column("attachment_ids", sa.JSON(), nullable=True))
        return

    op.add_column("work_order_messages", sa.Column("attachment_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    dialect_name = op.get_bind().dialect.name
    if dialect_name == "sqlite":
        with op.batch_alter_table("work_order_messages") as batch_op:
            batch_op.drop_column("attachment_ids")
        return

    op.drop_column("work_order_messages", "attachment_ids")
