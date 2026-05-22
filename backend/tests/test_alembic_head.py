from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


ROOT = Path(__file__).resolve().parents[1]


def test_alembic_has_single_head() -> None:
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    script = ScriptDirectory.from_config(cfg)

    assert script.get_heads() == ["o8p9q0r1s2t3"]
