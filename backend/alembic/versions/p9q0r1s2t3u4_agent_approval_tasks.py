"""extend approval tasks for agent review gates

Revision ID: p9q0r1s2t3u4
Revises: o8p9q0r1s2t3
Create Date: 2026-05-23 15:10:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "p9q0r1s2t3u4"
down_revision = "o8p9q0r1s2t3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        op.execute(sa.text("DROP TABLE IF EXISTS _alembic_tmp_approval_tasks"))

    with op.batch_alter_table("approval_tasks") as batch:
        batch.alter_column("work_order_id", existing_type=sa.Integer(), nullable=True)
        batch.add_column(
            sa.Column(
                "source_type",
                sa.String(length=32),
                nullable=False,
                server_default="work_order_step",
            )
        )
        batch.add_column(sa.Column("agent_run_id", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("maintenance_task_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("risk_level", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("reason", sa.Text(), nullable=True))
        batch.add_column(sa.Column("payload", sa.JSON(), nullable=True))

    op.create_index(
        "ix_approval_tasks_source_status",
        "approval_tasks",
        ["source_type", "status"],
    )
    op.create_index(
        "ix_approval_tasks_agent_run_id",
        "approval_tasks",
        ["agent_run_id"],
    )
    op.create_index(
        "ix_approval_tasks_maintenance_task_id",
        "approval_tasks",
        ["maintenance_task_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_approval_tasks_maintenance_task_id", table_name="approval_tasks")
    op.drop_index("ix_approval_tasks_agent_run_id", table_name="approval_tasks")
    op.drop_index("ix_approval_tasks_source_status", table_name="approval_tasks")
    with op.batch_alter_table("approval_tasks") as batch:
        batch.drop_column("payload")
        batch.drop_column("reason")
        batch.drop_column("risk_level")
        batch.drop_column("maintenance_task_id")
        batch.drop_column("agent_run_id")
        batch.drop_column("source_type")
        batch.alter_column("work_order_id", existing_type=sa.Integer(), nullable=False)
