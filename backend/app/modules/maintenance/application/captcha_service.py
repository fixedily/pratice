"""图形验证码生成与校验（Redis 存储，失败时内存降级）。"""
from __future__ import annotations

import base64
import random
import uuid

from app.core.config import get_settings
from app.core.redis import get_redis_service
from app.modules.maintenance.errors import MaintenanceAPIError

CAPTCHA_LENGTH = 4
CAPTCHA_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


def _captcha_key(captcha_id: str) -> str:
    return get_redis_service().key("captcha", captcha_id)


def _random_code() -> str:
    return "".join(random.choice(CAPTCHA_CHARS) for _ in range(CAPTCHA_LENGTH))


def _build_svg_data_uri(code: str) -> str:
    width, height = 128, 44
    lines = []
    for _ in range(6):
        x1, y1 = random.randint(0, width), random.randint(0, height)
        x2, y2 = random.randint(0, width), random.randint(0, height)
        lines.append(
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="rgba(45,212,191,0.25)" stroke-width="1"/>'
        )
    chars_svg = []
    for i, ch in enumerate(code):
        x = 18 + i * 24 + random.randint(-2, 2)
        y = 30 + random.randint(-3, 3)
        rotate = random.randint(-18, 18)
        chars_svg.append(
            f'<text x="{x}" y="{y}" fill="#5eead4" font-size="22" font-family="ui-monospace,monospace" '
            f'font-weight="700" transform="rotate({rotate} {x} {y})">{ch}</text>'
        )
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">'
        f'<rect width="100%" height="100%" rx="6" fill="#071018" stroke="rgba(45,212,191,0.45)" stroke-width="1"/>'
        f'{"".join(lines)}'
        f'{"".join(chars_svg)}'
        "</svg>"
    )
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


async def issue_captcha() -> dict[str, str]:
    """生成验证码，写入 Redis（TTL 默认 1 分钟）；Redis 不可用时内存降级。"""
    settings = get_settings()
    redis = get_redis_service()
    captcha_id = str(uuid.uuid4())
    code = _random_code()
    await redis.set(_captcha_key(captcha_id), code, ex=settings.captcha_ttl_seconds)
    return {
        "captchaId": captcha_id,
        "image": _build_svg_data_uri(code),
    }


async def verify_and_consume(captcha_id: str | None, captcha_code: str | None) -> None:
    """校验并一次性消费验证码。"""
    cid = (captcha_id or "").strip()
    code = (captcha_code or "").strip()
    if not cid or not code:
        raise MaintenanceAPIError(400, "CAPTCHA_REQUIRED", "请输入验证码")
    redis = get_redis_service()
    stored = await redis.getdel(_captcha_key(cid))
    if stored is None:
        raise MaintenanceAPIError(400, "CAPTCHA_EXPIRED", "验证码已过期，请刷新后重试")
    if stored.upper() != code.upper():
        raise MaintenanceAPIError(400, "CAPTCHA_INVALID", "验证码错误，请重新输入")


async def peek_code_for_tests(captcha_id: str) -> str | None:
    """仅测试使用：读取未消费的验证码明文。"""
    return await get_redis_service().get(_captcha_key(captcha_id))
