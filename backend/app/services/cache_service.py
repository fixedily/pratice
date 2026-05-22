"""TTL cache for knowledge search results.

Redis is used when configured and reachable so cache entries are shared across
workers.  If Redis is disabled or degraded, the service falls back to the
process-local TTL cache used by the demo/development path.

Configuration (via environment variables / Settings):
    ENABLE_SEARCH_CACHE   bool   default True
    SEARCH_CACHE_TTL      int    seconds, default 300 (5 min)
    SEARCH_CACHE_MAXSIZE  int    max entries, default 1000
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Any

try:
    from cachetools import TTLCache as CachetoolsTTLCache
except ModuleNotFoundError:  # pragma: no cover - runtime fallback
    CachetoolsTTLCache = None

logger = logging.getLogger(__name__)
SEARCH_CACHE_INDEX_PART = "__search_cache_keys__"


class FallbackTTLCache:
    """Minimal TTL cache fallback used when cachetools is unavailable."""

    def __init__(self, *, maxsize: int, ttl: int):
        self.maxsize = maxsize
        self.ttl = ttl
        self._data: dict[str, tuple[float, Any]] = {}

    def _purge_expired(self) -> None:
        now = time.monotonic()
        expired_keys = [key for key, (expires_at, _) in self._data.items() if expires_at <= now]
        for key in expired_keys:
            self._data.pop(key, None)

    def get(self, key: str, default: Any = None) -> Any:
        self._purge_expired()
        item = self._data.get(key)
        if item is None:
            return default
        expires_at, value = item
        if expires_at <= time.monotonic():
            self._data.pop(key, None)
            return default
        return value

    def __setitem__(self, key: str, value: Any) -> None:
        self._purge_expired()
        if key not in self._data and len(self._data) >= self.maxsize:
            oldest_key = next(iter(self._data))
            self._data.pop(oldest_key, None)
        self._data[key] = (time.monotonic() + self.ttl, value)

    def pop(self, key: str, default: Any = None) -> Any:
        self._purge_expired()
        item = self._data.pop(key, None)
        if item is None:
            return default
        return item[1]

    def clear(self) -> None:
        self._data.clear()

    def __len__(self) -> int:
        self._purge_expired()
        return len(self._data)


# ── 单例缓存实例（模块级，进程内共享）────────────────────────────────────────
_cache: Any | None = None


def _get_cache() -> Any:
    global _cache
    if _cache is None:
        try:
            from app.core.config import get_settings

            s = get_settings()
            maxsize = getattr(s, "search_cache_maxsize", 1000)
            ttl = getattr(s, "search_cache_ttl", 300)
        except Exception:
            maxsize, ttl = 1000, 300
        if CachetoolsTTLCache is not None:
            _cache = CachetoolsTTLCache(maxsize=maxsize, ttl=ttl)
            logger.info("SearchCache 初始化: backend=cachetools maxsize=%d ttl=%ds", maxsize, ttl)
        else:
            _cache = FallbackTTLCache(maxsize=maxsize, ttl=ttl)
            logger.warning("SearchCache 初始化降级: backend=fallback maxsize=%d ttl=%ds", maxsize, ttl)
    return _cache


# ── 公开接口 ─────────────────────────────────────────────────────────────────

def make_cache_key(
    query: str | None,
    equipment_type: str | None = None,
    equipment_model: str | None = None,
    fault_type: str | None = None,
    limit: int = 10,
    graph_relation_types: list[str] | None = None,
) -> str:
    """Deterministic cache key from search parameters."""
    raw = json.dumps(
        {
            "q": (query or "").strip().lower(),
            "et": equipment_type or "",
            "em": equipment_model or "",
            "ft": fault_type or "",
            "lim": limit,
            "grt": sorted(graph_relation_types or []),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return "search:" + hashlib.md5(raw.encode()).hexdigest()


def _redis_cache_key(key: str) -> str:
    from app.core.redis import get_redis_service

    if key.startswith("search:"):
        return get_redis_service().key("search", key.split(":", 1)[1])
    return get_redis_service().key("search", key)


def _redis_index_key() -> str:
    from app.core.redis import get_redis_service

    return get_redis_service().key("cache", SEARCH_CACHE_INDEX_PART)


def _cache_enabled() -> bool:
    try:
        from app.core.config import get_settings

        return bool(getattr(get_settings(), "enable_search_cache", True))
    except Exception:
        return True


def _cache_ttl() -> int:
    try:
        from app.core.config import get_settings

        return int(getattr(get_settings(), "search_cache_ttl", 300))
    except Exception:
        return 300


def _memory_get(key: str) -> Any | None:
    value = _get_cache().get(key)
    if value is not None:
        logger.debug("cache_hit key=%s backend=memory", key)
    return value


def _memory_set(key: str, value: Any) -> None:
    _get_cache()[key] = value
    logger.debug("cache_set key=%s backend=memory", key)


def get(key: str) -> Any | None:
    """Return cached value or *None* on miss / disabled."""
    if not _cache_enabled():
        return None
    return _memory_get(key)


def set(key: str, value: Any) -> None:  # noqa: A001
    """Store *value* under *key*.  Silently skips if cache is disabled."""
    if not _cache_enabled():
        return
    _memory_set(key, value)


async def get_async(key: str) -> Any | None:
    """Return cached value from Redis first, then memory fallback."""
    if not _cache_enabled():
        return None
    try:
        from app.core.redis import get_redis_service

        redis = get_redis_service()
        if redis.available:
            raw = await redis.get(_redis_cache_key(key))
            if raw is not None:
                logger.debug("cache_hit key=%s backend=redis", key)
                return json.loads(raw)
    except Exception as exc:
        logger.warning("search_cache_redis_get_failed key=%s error=%s", key, exc)
    return _memory_get(key)


async def set_async(key: str, value: Any) -> None:
    """Store value in Redis when possible and memory as a local fallback."""
    if not _cache_enabled():
        return
    stored_in_redis = False
    try:
        from app.core.redis import get_redis_service

        redis = get_redis_service()
        if redis.available:
            payload = json.dumps(value, ensure_ascii=False, default=str)
            redis_key = _redis_cache_key(key)
            await redis.set(redis_key, payload, ex=_cache_ttl())
            await redis.sadd(_redis_index_key(), redis_key)
            stored_in_redis = True
            logger.debug("cache_set key=%s backend=redis", key)
    except Exception as exc:
        logger.warning("search_cache_redis_set_failed key=%s error=%s", key, exc)
    if not stored_in_redis:
        _memory_set(key, value)


def invalidate(key: str) -> None:
    """Remove a single key (no-op if absent)."""
    cache = _get_cache()
    cache.pop(key, None)


async def invalidate_async(key: str) -> None:
    invalidate(key)
    try:
        from app.core.redis import get_redis_service

        redis = get_redis_service()
        if redis.available:
            await redis.delete(_redis_cache_key(key))
    except Exception as exc:
        logger.warning("search_cache_redis_invalidate_failed key=%s error=%s", key, exc)


def clear() -> None:
    """Flush the entire cache (e.g. after bulk document import)."""
    _get_cache().clear()
    logger.info("SearchCache cleared backend=memory")


async def clear_async() -> None:
    """Flush search cache entries without touching unrelated Redis keys."""
    clear()
    try:
        from app.core.redis import get_redis_service

        redis = get_redis_service()
        if redis.available:
            index_key = _redis_index_key()
            keys = await redis.smembers(index_key)
            if keys:
                await redis.delete(*keys)
            await redis.delete(index_key)
            logger.info("SearchCache cleared backend=redis count=%d", len(keys))
    except Exception as exc:
        logger.warning("search_cache_redis_clear_failed error=%s", exc)


def stats() -> dict[str, int]:
    """Return current cache occupancy for monitoring."""
    cache = _get_cache()
    return {"size": len(cache), "maxsize": cache.maxsize}
