"""登录失败计数与临时锁定（Redis / 内存降级）。"""
from __future__ import annotations

from app.core.config import get_settings
from app.core.redis import get_redis_service
from app.modules.maintenance.errors import MaintenanceAPIError


def _identity(username: str, client_ip: str | None) -> tuple[str, str]:
    user = (username or "").strip().lower()
    ip = (client_ip or "unknown").strip() or "unknown"
    return user, ip


async def _lock_retry_seconds(username: str, client_ip: str | None) -> int | None:
    user, ip = _identity(username, client_ip)
    if not user:
        return None
    redis = get_redis_service()
    lock_key = redis.key("login", "lock", user, ip)
    ttl = await redis.ttl(lock_key)
    if ttl > 0:
        return ttl
    return None


async def ensure_login_allowed(username: str, client_ip: str | None) -> None:
    """锁定期间禁止继续尝试登录。"""
    retry_after = await _lock_retry_seconds(username, client_ip)
    if retry_after is not None:
        raise MaintenanceAPIError(
            429,
            "ACCOUNT_LOCKED",
            "登录失败次数过多，请稍后再试",
            data={"retry_after_seconds": retry_after},
        )


async def record_login_failure(username: str, client_ip: str | None) -> None:
    """账号+IP 维度累计失败次数，达阈值后临时锁定。"""
    settings = get_settings()
    user, ip = _identity(username, client_ip)
    if not user:
        return
    redis = get_redis_service()
    fail_key = redis.key("login", "fail", user, ip)
    lock_key = redis.key("login", "lock", user, ip)
    count = await redis.incr(fail_key)
    if count == 1:
        await redis.expire(fail_key, settings.login_fail_window_seconds)
    if count >= settings.login_fail_max:
        await redis.set(lock_key, "1", ex=settings.login_lock_seconds)
        await redis.delete(fail_key)


async def clear_login_failures(username: str, client_ip: str | None) -> None:
    """登录成功后清除失败计数与锁定标记。"""
    user, ip = _identity(username, client_ip)
    if not user:
        return
    redis = get_redis_service()
    await redis.delete(
        redis.key("login", "fail", user, ip),
        redis.key("login", "lock", user, ip),
    )
