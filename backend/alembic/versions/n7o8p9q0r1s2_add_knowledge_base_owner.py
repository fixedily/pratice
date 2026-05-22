"""add knowledge base owner_id

Revision ID: n7o8p9q0r1s2
Revises: m6n7o8p9q0r1
Create Date: 2026-05-22 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "n7o8p9q0r1s2"
down_revision: Union[str, Sequence[str], None] = "m6n7o8p9q0r1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("knowledge_bases") as batch_op:
        batch_op.add_column(sa.Column("owner_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_knowledge_bases_owner_id",
            "users",
            ["owner_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_knowledge_bases_owner_id", ["owner_id"])


def downgrade() -> None:
    with op.batch_alter_table("knowledge_bases") as batch_op:
        batch_op.drop_index("ix_knowledge_bases_owner_id")
        batch_op.drop_constraint("fk_knowledge_bases_owner_id", type_="foreignkey")
        batch_op.drop_column("owner_id")
