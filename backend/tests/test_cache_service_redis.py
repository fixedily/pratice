from __future__ import annotations

import pytest

from app.services import cache_service


class FakeRedis:
    available = True

    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.sets: dict[str, set[str]] = {}

    def key(self, *parts: str) -> str:
        return "test:" + ":".join(str(part) for part in parts if part)

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def set(self, key: str, value: str, *, ex: int | None = None) -> bool:
        self.values[key] = value
        return True

    async def sadd(self, key: str, *values: str) -> int:
        bucket = self.sets.setdefault(key, set())
        before = len(bucket)
        bucket.update(values)
        return len(bucket) - before

    async def smembers(self, key: str) -> set[str]:
        return set(self.sets.get(key, set()))

    async def delete(self, *keys: str) -> int:
        removed = 0
        for key in keys:
            if key in self.values:
                removed += 1
                self.values.pop(key, None)
            if key in self.sets:
                removed += 1
                self.sets.pop(key, None)
        return removed


@pytest.fixture(autouse=True)
def clear_memory_cache(monkeypatch):
    monkeypatch.setattr(cache_service, "_cache_enabled", lambda: True)
    cache_service.clear()
    yield
    cache_service.clear()


@pytest.mark.asyncio
async def test_search_cache_uses_redis_first(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr("app.core.redis.get_redis_service", lambda: fake)

    await cache_service.set_async("search:abc", {"results": [{"chunk_id": 1}], "query": "泵故障"})

    assert "test:search:abc" in fake.values
    assert await cache_service.get_async("search:abc") == {
        "results": [{"chunk_id": 1}],
        "query": "泵故障",
    }


@pytest.mark.asyncio
async def test_search_cache_clear_deletes_indexed_redis_keys(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr("app.core.redis.get_redis_service", lambda: fake)
    await cache_service.set_async("search:abc", {"ok": True})

    await cache_service.clear_async()

    assert fake.values == {}
    assert fake.sets == {}


@pytest.mark.asyncio
async def test_search_cache_falls_back_to_memory_when_redis_unavailable(monkeypatch):
    fake = FakeRedis()
    fake.available = False
    monkeypatch.setattr("app.core.redis.get_redis_service", lambda: fake)

    await cache_service.set_async("search:abc", {"fallback": True})

    assert fake.values == {}
    assert await cache_service.get_async("search:abc") == {"fallback": True}
