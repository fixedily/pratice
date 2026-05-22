"""add work order suspend fields

Revision ID: h1a2b3c4d5e6
Revises: gd1e2f3a4b5c
Create Date: 2026-05-11 20:05:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "h1a2b3c4d5e6"
down_revision = "gd1e2f3a4b5c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    dialect_name = op.get_bind().dialect.name
    if dialect_name == "sqlite":
        with op.batch_alter_table("work_orders") as batch_op:
            batch_op.add_column(
                sa.Column("is_suspended", sa.Boolean(), nullable=False, server_default=sa.false()),
            )
            batch_op.add_column(
                sa.Column("suspended_reason", sa.String(length=256), nullable=True),
            )
            batch_op.add_column(
                sa.Column("pre_suspend_status", sa.String(length=4), nullable=True),
            )
            batch_op.add_column(
                sa.Column("suspended_at", sa.DateTime(), nullable=True),
            )
            batch_op.alter_column("is_suspended", server_default=None)
        return

    op.add_column(
        "work_orders",
        sa.Column("is_suspended", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "work_orders",
        sa.Column("suspended_reason", sa.String(length=256), nullable=True),
    )
    op.add_column(
        "work_orders",
        sa.Column("pre_suspend_status", sa.String(length=4), nullable=True),
    )
    op.add_column(
        "work_orders",
        sa.Column("suspended_at", sa.DateTime(), nullable=True),
    )
    op.alter_column("work_orders", "is_suspended", server_default=None)


def downgrade() -> None:
    dialect_name = op.get_bind().dialect.name
    if dialect_name == "sqlite":
        with op.batch_alter_table("work_orders") as batch_op:
            batch_op.drop_column("suspended_at")
            batch_op.drop_column("pre_suspend_status")
            batch_op.drop_column("suspended_reason")
            batch_op.drop_column("is_suspended")
        return

    op.drop_column("work_orders", "suspended_at")
    op.drop_column("work_orders", "pre_suspend_status")
    op.drop_column("work_orders", "suspended_reason")
    op.drop_column("work_orders", "is_suspended")
