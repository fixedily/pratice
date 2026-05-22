"""认证相关别名路由（与检修域能力共享实现）。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.modules.maintenance.application.captcha_service import issue_captcha

router = APIRouter(prefix="/api/auth", tags=["认证"])


def _ok(data: Any) -> dict[str, Any]:
    return {"success": True, "data": data, "business_code": None, "message": None}


@router.get("/captcha")
async def get_captcha_alias() -> dict[str, Any]:
    """GET /api/auth/captcha — 与检修域验证码接口一致。"""
    return _ok(await issue_captcha())
