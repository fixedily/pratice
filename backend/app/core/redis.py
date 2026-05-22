"""Redis 异步客户端封装，连接失败时降级为进程内内存存储。"""
from __future__ import annotations

import logging
import math
import time
from typing import Any

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

_redis_service: RedisService | None = None


class _MemoryEntry:
    __slots__ = ("value", "expires_at")

    def __init__(self, value: str, expires_at: float | None) -> None:
        self.value = value
        self.expires_at = expires_at


class RedisService:
    """统一 key 前缀与基础 KV 操作；不可用时自动降级内存缓存。"""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        prefix = (settings.redis_prefix or "dachuang").strip().rstrip(":")
        self._prefix = f"{prefix}:"
        self._client: Any | None = None
        self._available = False
        self._memory: dict[str, _MemoryEntry] = {}
        self._degraded_logged = False
        self._last_error: str | None = None

    @property
    def available(self) -> bool:
        return self._available

    @property
    def enabled(self) -> bool:
        return bool(self.settings.redis_enabled)

    @property
    def degraded(self) -> bool:
        """True 表示当前使用内存降级而非 Redis。"""
        return self.enabled and not self._available

    @property
    def backend(self) -> str:
        if not self.enabled:
            return "disabled"
        return "redis" if self._available else "memory"

    @property
    def status(self) -> str:
        if not self.enabled:
            return "disabled"
        return "connected" if self._available else "degraded"

    def key(self, *parts: str) -> str:
        return self._prefix + ":".join(str(p) for p in parts if p)

    async def connect(self) -> bool:
        if not self.settings.redis_enabled:
            self._available = False
            self._client = None
            self._last_error = None
            logger.warning("redis_disabled using in_memory_fallback")
            return False
        try:
            from redis.asyncio import Redis

            kwargs: dict[str, Any] = {
                "host": self.settings.redis_host,
                "port": self.settings.redis_port,
                "db": self.settings.redis_db,
                "decode_responses": True,
                "socket_connect_timeout": self.settings.redis_socket_timeout,
            }
            if self.settings.redis_password:
                kwargs["password"] = self.settings.redis_password
            client = Redis(**kwargs)
            await client.ping()
            self._client = client
            self._available = True
            self._last_error = None
            logger.info(
                "redis_connected host=%s port=%s db=%s",
                self.settings.redis_host,
                self.settings.redis_port,
                self.settings.redis_db,
            )
            return True
        except Exception as exc:
            self._available = False
            self._client = None
            self._last_error = str(exc)
            logger.warning("redis_connect_failed fallback=memory error=%s", exc)
            return False

    async def close(self) -> None:
        if self._client is not None:
            try:
                await self._client.aclose()
            except Exception:
                logger.exception("redis_close_failed")
        self._client = None
        self._available = False

    async def ping(self) -> bool:
        """Return True only when the configured Redis backend responds."""
        if not self.enabled:
            return False
        if self._client is None or not self._available:
            return await self.connect()
        try:
            await self._client.ping()
            self._available = True
            self._last_error = None
            return True
        except Exception as exc:
            self._available = False
            self._last_error = str(exc)
            logger.warning("redis_ping_failed error=%s", exc)
            return False

    def status_snapshot(self) -> dict[str, Any]:
        """Small, non-sensitive Redis status payload for health endpoints."""
        return {
            "status": self.status,
            "backend": self.backend,
            "enabled": self.enabled,
            "available": self.available,
            "degraded": self.degraded,
            "host": self.settings.redis_host,
            "port": self.settings.redis_port,
            "db": self.settings.redis_db,
            "last_error": self._last_error,
        }

    def _log_degraded_once(self) -> None:
        if not self._degraded_logged:
            self._degraded_logged = True
            logger.warning("redis_operation_using_memory_fallback")

    def _mark_operation_failed(self, exc: Exception) -> None:
        self._available = False
        self._last_error = str(exc)
        self._log_degraded_once()

    def _purge_memory(self) -> None:
        now = time.monotonic()
        expired = [k for k, e in self._memory.items() if e.expires_at is not None and e.expires_at <= now]
        for k in expired:
            self._memory.pop(k, None)

    async def get(self, key: str) -> str | None:
        if self._available and self._client is not None:
            try:
                return await self._client.get(key)
            except Exception as exc:
                logger.warning("redis_get_failed key=%s error=%s", key, exc)
                self._mark_operation_failed(exc)
        self._purge_memory()
        entry = self._memory.get(key)
        if entry is None:
            return None
        if entry.expires_at is not None and entry.expires_at <= time.monotonic():
            self._memory.pop(key, None)
            return None
        return entry.value

    async def set(self, key: str, value: str, *, ex: int | None = None) -> bool:
        if self._available and self._client is not None:
            try:
                await self._client.set(key, value, ex=ex)
                return True
            except Exception as exc:
                logger.warning("redis_set_failed key=%s error=%s", key, exc)
                self._mark_operation_failed(exc)
        self._purge_memory()
        expires_at = time.monotonic() + ex if ex else None
        self._memory[key] = _MemoryEntry(value, expires_at)
        return True

    async def delete(self, *keys: str) -> int:
        if not keys:
            return 0
        if self._available and self._client is not None:
            try:
                return int(await self._client.delete(*keys))
            except Exception as exc:
                logger.warning("redis_delete_failed error=%s", exc)
                self._mark_operation_failed(exc)
        removed = 0
        for key in keys:
            if self._memory.pop(key, None) is not None:
                removed += 1
        return removed

    async def exists(self, key: str) -> bool:
        if self._available and self._client is not None:
            try:
                return bool(await self._client.exists(key))
            except Exception as exc:
                logger.warning("redis_exists_failed key=%s error=%s", key, exc)
                self._mark_operation_failed(exc)
        return await self.get(key) is not None

    async def incr(self, key: str) -> int:
        if self._available and self._client is not None:
            try:
                return int(await self._client.incr(key))
            except Exception as exc:
                logger.warning("redis_incr_failed key=%s error=%s", key, exc)
                self._mark_operation_failed(exc)
        current = await self.get(key)
        next_val = int(current or 0) + 1
        entry = self._memory.get(key)
        ttl_left: int | None = None
        if entry and entry.expires_at is not None:
            ttl_left = max(1, math.ceil(entry.expires_at - time.monotonic()))
        await self.set(key, str(next_val), ex=ttl_left)
        return next_val

    async def ttl(self, key: str) -> int:
        """剩余过期秒数；不存在返回 -2，无过期返回 -1。"""
        if self._available and self._client is not None:
            try:
                return int(await self._client.ttl(key))
            except Exception as exc:
                logger.warning("redis_ttl_failed key=%s error=%s", key, exc)
                self._mark_operation_failed(exc)
        self._purge_memory()
        entry = self._memory.get(key)
        if entry is None:
            return -2
        if entry.expires_at is None:
            return -1
        remaining = math.ceil(entry.expires_at - time.monotonic())
        return remaining if remaining > 0 else -2

    async def expire(self, key: str, seconds: int) -> bool:
        if self._available and self._client is not None:
            try:
                return bool(await self._client.expire(key, seconds))
            except Exception as exc:
                logger.warning("redis_expire_failed key=%s error=%s", key, exc)
                self._mark_operation_failed(exc)
        entry = self._memory.get(key)
        if entry is None:
            return False
        entry.expires_at = time.monotonic() + seconds
        return True

    async def getdel(self, key: str) -> str | None:
        """读取并删除（验证码一次性消费）。"""
        if self._available and self._client is not None:
            try:
                value = await self._client.getdel(key)
                if value is not None:
                    return str(value)
                return None
            except Exception:
                # 旧版 Redis 无 GETDEL，回退 get + delete
                try:
                    value = await self._client.get(key)
                    if value is not None:
                        await self._client.delete(key)
                    return value
                except Exception as exc:
                    logger.warning("redis_getdel_failed key=%s error=%s", key, exc)
                    self._mark_operation_failed(exc)
        self._purge_memory()
        entry = self._memory.pop(key, None)
        if entry is None:
            return None
        if entry.expires_at is not None and entry.expires_at <= time.monotonic():
            return None
        return entry.value

    async def sadd(self, key: str, *values: str) -> int:
        if not values:
            return 0
        if self._available and self._client is not None:
            try:
                return int(await self._client.sadd(key, *values))
            except Exception as exc:
                logger.warning("redis_sadd_failed key=%s error=%s", key, exc)
                self._mark_operation_failed(exc)
        return 0

    async def smembers(self, key: str) -> set[str]:
        if self._available and self._client is not None:
            try:
                values = await self._client.smembers(key)
                return {str(value) for value in values}
            except Exception as exc:
                logger.warning("redis_smembers_failed key=%s error=%s", key, exc)
                self._mark_operation_failed(exc)
        return set()


def get_redis_service() -> RedisService:
    global _redis_service
    settings = get_settings()
    if _redis_service is None or _redis_service.settings is not settings:
        _redis_service = RedisService(settings)
    return _redis_service


async def init_redis() -> RedisService:
    global _redis_service
    settings = get_settings()
    if _redis_service is not None and _redis_service.settings is not settings:
        await _redis_service.close()
        _redis_service = None
    service = get_redis_service()
    await service.connect()
    return service


async def reset_redis_service() -> None:
    """Reset singleton state; mainly useful for tests that mutate settings."""
    await close_redis()


async def close_redis() -> None:
    global _redis_service
    if _redis_service is not None:
        await _redis_service.close()
        _redis_service = None
