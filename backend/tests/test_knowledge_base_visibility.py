"""Knowledge base visibility (ACL) unit tests.

手动联调建议：
1. 用户 A 登录 → 新建「仅自己」知识库 → 用户 B 登录后列表中不应出现该库。
2. 用户 A 新建「团队内部」库 → 用户 B 应能在下拉中看到。
3. 未登录访问 GET /api/v1/knowledge/bases → 仅返回 visibility=public 的库。
4. 用户 B 向用户 A 的 private 库 POST /imports（带 knowledge_base_id）→ 应返回 403。
"""
from __future__ import annotations

from datetime import datetime

import pytest

from app.models.knowledge import KnowledgeBase
from app.services.knowledge_base_service import (
    build_visibility_filter,
    can_access_knowledge_base,
)


def _base(
    *,
    visibility: str,
    owner_id: int | None = None,
    base_id: int = 1,
) -> KnowledgeBase:
    now = datetime.utcnow()
    return KnowledgeBase(
        id=base_id,
        name="测试库",
        slug="test-kb",
        visibility=visibility,
        owner_id=owner_id,
        type="comprehensive",
        created_at=now,
        updated_at=now,
    )


@pytest.mark.parametrize(
    ("visibility", "owner_id", "viewer_id", "expected"),
    [
        ("public", None, None, True),
        ("public", 10, 20, True),
        ("internal", None, None, False),
        ("internal", None, 1, True),
        ("private", 10, 10, True),
        ("private", 10, 20, False),
        ("private", 10, None, False),
        ("private", None, 1, False),
    ],
)
def test_can_access_knowledge_base(
    visibility: str,
    owner_id: int | None,
    viewer_id: int | None,
    expected: bool,
) -> None:
    base = _base(visibility=visibility, owner_id=owner_id)
    assert can_access_knowledge_base(base, viewer_id) is expected


def test_build_visibility_filter_anonymous_only_public() -> None:
    clause = build_visibility_filter(None)
    compiled = str(clause.compile(compile_kwargs={"literal_binds": True}))
    assert "public" in compiled.lower()
    assert "internal" not in compiled.lower()
    assert "private" not in compiled.lower()


def test_build_visibility_filter_logged_in_includes_internal_and_private() -> None:
    clause = build_visibility_filter(42)
    compiled = str(clause.compile(compile_kwargs={"literal_binds": True}))
    assert "public" in compiled.lower()
    assert "internal" in compiled.lower()
    assert "private" in compiled.lower()
    assert "42" in compiled
