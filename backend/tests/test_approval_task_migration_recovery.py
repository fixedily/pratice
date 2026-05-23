from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config

from app.core.config import get_settings
from app.core.database import reset_engine


ROOT = Path(__file__).resolve().parents[1]


def _create_legacy_approval_task_schema(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(
            """
            CREATE TABLE alembic_version (
                version_num VARCHAR(32) NOT NULL
            );
            INSERT INTO alembic_version (version_num) VALUES ('o8p9q0r1s2t3');

            CREATE TABLE users (
                id INTEGER NOT NULL,
                username VARCHAR(64) NOT NULL,
                PRIMARY KEY (id)
            );

            CREATE TABLE work_orders (
                id INTEGER NOT NULL,
                title VARCHAR(100) NOT NULL,
                PRIMARY KEY (id)
            );

            CREATE TABLE approval_tasks (
                id INTEGER NOT NULL,
                work_order_id INTEGER NOT NULL,
                step_no INTEGER NOT NULL,
                status VARCHAR(32) NOT NULL,
                resolution VARCHAR(32),
                comment TEXT,
                material_attachment_ids JSON,
                approver_user_id INTEGER,
                resolved_at DATETIME,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                PRIMARY KEY (id),
                FOREIGN KEY(approver_user_id) REFERENCES users (id),
                FOREIGN KEY(work_order_id) REFERENCES work_orders (id) ON DELETE CASCADE
            );

            CREATE TABLE _alembic_tmp_approval_tasks (
                id INTEGER NOT NULL,
                work_order_id INTEGER,
                step_no INTEGER NOT NULL,
                status VARCHAR(32) NOT NULL,
                source_type VARCHAR(32) DEFAULT 'work_order_step' NOT NULL,
                PRIMARY KEY (id)
            );
            """
        )
        conn.commit()
    finally:
        conn.close()


def test_agent_approval_task_migration_recovers_from_leftover_sqlite_batch_table(tmp_path: Path) -> None:
    db_path = tmp_path / "approval_migration_recovery.db"
    _create_legacy_approval_task_schema(db_path)

    previous_database_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{db_path}"
    get_settings.cache_clear()
    reset_engine()
    try:
        cfg = Config(str(ROOT / "alembic.ini"))
        cfg.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])

        command.upgrade(cfg, "head")

        conn = sqlite3.connect(db_path)
        try:
            columns = {row[1] for row in conn.execute("PRAGMA table_info(approval_tasks)")}
            assert {
                "source_type",
                "agent_run_id",
                "maintenance_task_id",
                "risk_level",
                "reason",
                "payload",
            }.issubset(columns)
            assert conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='_alembic_tmp_approval_tasks'"
            ).fetchone() is None
            assert conn.execute("SELECT version_num FROM alembic_version").fetchone() == ("p9q0r1s2t3u4",)
        finally:
            conn.close()
    finally:
        if previous_database_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous_database_url
        get_settings.cache_clear()
        reset_engine()
