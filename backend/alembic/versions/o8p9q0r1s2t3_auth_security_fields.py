"""auth_security_fields

Revision ID: o8p9q0r1s2t3
Revises: n7o8p9q0r1s2
Create Date: 2026-05-22
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "o8p9q0r1s2t3"
down_revision: Union[str, Sequence[str], None] = "n7o8p9q0r1s2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("real_name", sa.String(length=128), nullable=True))
        batch.add_column(sa.Column("phone", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("email", sa.String(length=255), nullable=True))
        batch.add_column(sa.Column("department", sa.String(length=128), nullable=True))
        batch.add_column(sa.Column("status", sa.String(length=32), nullable=False, server_default="active"))
        batch.add_column(sa.Column("failed_login_count", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("locked_until", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("last_login_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("register_ip", sa.String(length=64), nullable=True))
        batch.create_unique_constraint("uq_users_phone", ["phone"])
        batch.create_unique_constraint("uq_users_email", ["email"])

    op.create_table(
        "password_reset_requests",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("account", sa.String(length=255), nullable=False),
        sa.Column("contact", sa.String(length=255), nullable=False),
        sa.Column("reason", sa.String(length=1000), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("request_ip", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_password_reset_requests_account", "password_reset_requests", ["account"])
    op.create_index("ix_password_reset_requests_user_id", "password_reset_requests", ["user_id"])

    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("code_hash", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("request_ip", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_password_reset_tokens_user_id", "password_reset_tokens", ["user_id"])

    op.create_table(
        "auth_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_auth_logs_user_id", "auth_logs", ["user_id"])
    op.create_index("ix_auth_logs_action", "auth_logs", ["action"])

    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        conn.execute(
            sa.text(
                "SELECT setval("
                "pg_get_serial_sequence('roles', 'id'), "
                "GREATEST((SELECT COALESCE(MAX(id), 1) FROM roles), 1)"
                ")"
            )
        )
    for code, name in (
        ("inspector", "巡检员"),
        ("maintainer", "检修员"),
        ("engineer", "设备工程师"),
    ):
        if conn.dialect.name == "sqlite":
            conn.execute(
                sa.text("INSERT OR IGNORE INTO roles (code, name) VALUES (:code, :name)"),
                {"code": code, "name": name},
            )
        else:
            conn.execute(
                sa.text(
                    "INSERT INTO roles (code, name) "
                    "VALUES (CAST(:code AS VARCHAR(32)), CAST(:name AS VARCHAR(64))) "
                    "ON CONFLICT (code) DO NOTHING"
                ),
                {"code": code, "name": name},
            )


def downgrade() -> None:
    op.drop_index("ix_auth_logs_action", table_name="auth_logs")
    op.drop_index("ix_auth_logs_user_id", table_name="auth_logs")
    op.drop_table("auth_logs")
    op.drop_index("ix_password_reset_tokens_user_id", table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")
    op.drop_index("ix_password_reset_requests_user_id", table_name="password_reset_requests")
    op.drop_index("ix_password_reset_requests_account", table_name="password_reset_requests")
    op.drop_table("password_reset_requests")
    op.execute("DELETE FROM roles WHERE code IN ('inspector', 'maintainer', 'engineer')")
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("uq_users_email", type_="unique")
        batch.drop_constraint("uq_users_phone", type_="unique")
        batch.drop_column("register_ip")
        batch.drop_column("last_login_at")
        batch.drop_column("locked_until")
        batch.drop_column("failed_login_count")
        batch.drop_column("status")
        batch.drop_column("department")
        batch.drop_column("email")
        batch.drop_column("phone")
        batch.drop_column("real_name")
