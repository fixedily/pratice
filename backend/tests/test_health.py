# File: tests/test_health.py
"""Health endpoint tests."""
import pytest
from httpx import AsyncClient, ASGITransport

from app.core.config import get_settings
from app.core.redis import reset_redis_service
from app.main import app


@pytest.mark.asyncio
async def test_health_check():
    """Test that /health endpoint returns correct status."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "database" in data
        assert "redis" in data
        assert {"status", "backend", "enabled", "available"}.issubset(data["redis"])


@pytest.mark.asyncio
async def test_ready_fails_when_enabled_redis_unavailable(monkeypatch):
    """Production readiness should fail if Redis is enabled but unavailable."""
    async def db_ok() -> bool:
        return True

    monkeypatch.setenv("REDIS_ENABLED", "true")
    monkeypatch.setenv("REDIS_HOST", "127.0.0.1")
    monkeypatch.setenv("REDIS_PORT", "1")
    monkeypatch.setattr("app.routers.health.check_database_connection", db_ok)
    get_settings.cache_clear()
    await reset_redis_service()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/ready")
        assert response.status_code == 503
        data = response.json()
        assert data["status"] == "not_ready"
        assert data["redis"]["status"] == "degraded"
        assert data["redis"]["available"] is False
    await reset_redis_service()
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_ready_ignores_redis_when_disabled(monkeypatch):
    """Local/dev readiness can pass when Redis is explicitly disabled."""
    async def db_ok() -> bool:
        return True

    monkeypatch.setenv("REDIS_ENABLED", "false")
    monkeypatch.setattr("app.routers.health.check_database_connection", db_ok)
    get_settings.cache_clear()
    await reset_redis_service()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/ready")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ready"
        assert data["redis"]["status"] == "disabled"
        assert data["redis"]["backend"] == "disabled"
    await reset_redis_service()
    get_settings.cache_clear()
