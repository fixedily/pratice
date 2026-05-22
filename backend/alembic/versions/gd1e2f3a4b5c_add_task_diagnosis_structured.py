"""add diagnosis_structured to maintenance_tasks

Revision ID: gd1e2f3a4b5c
Revises: fc9d7e1b2a34
Create Date: 2026-05-08 00:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "gd1e2f3a4b5c"
down_revision = "fc9d7e1b2a34"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "maintenance_tasks",
        sa.Column("diagnosis_structured", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("maintenance_tasks", "diagnosis_structured")
