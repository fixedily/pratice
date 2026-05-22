# File: app/routers/health.py
"""Health and readiness endpoints for service monitoring."""
import logging
from typing import Any

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.core.redis import get_redis_service
from app.db.session import check_database_connection

router = APIRouter(tags=["Health"])
logger = logging.getLogger(__name__)


class RedisHealth(BaseModel):
    status: str
    backend: str
    enabled: bool
    available: bool
    degraded: bool
    host: str
    port: int
    db: int
    last_error: str | None = None


class HealthResponse(BaseModel):
    """Response schema for health check endpoint."""

    status: str
    database: str
    redis: RedisHealth


async def _redis_health() -> dict[str, Any]:
    redis = get_redis_service()
    if redis.enabled:
        await redis.ping()
    return redis.status_snapshot()


@router.get(
    "/health",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
    summary="Health Check",
    description="Verify application, database, and Redis connectivity."
)
async def health_check() -> HealthResponse:
    """Check application and database health.

    Returns:
        HealthResponse with status and database connection state.
    """
    db_connected = await check_database_connection()
    redis_status = await _redis_health()
    redis_ok = (not redis_status["enabled"]) or redis_status["available"]
    overall_status = "healthy" if db_connected and redis_ok else "degraded"
    database_status = "connected" if db_connected else "disconnected"
    logger.info(
        "health_check status=%s database=%s redis=%s",
        overall_status,
        database_status,
        redis_status["status"],
    )

    return HealthResponse(
        status=overall_status,
        database=database_status,
        redis=RedisHealth(**redis_status),
    )


@router.get(
    "/ready",
    status_code=status.HTTP_200_OK,
    summary="Readiness Check",
    description="Verify dependencies required to receive production traffic.",
)
async def readiness_check() -> JSONResponse:
    db_connected = await check_database_connection()
    redis_status = await _redis_health()
    redis_ready = (not redis_status["enabled"]) or redis_status["available"]
    ready = db_connected and redis_ready
    payload = {
        "status": "ready" if ready else "not_ready",
        "database": "connected" if db_connected else "disconnected",
        "redis": redis_status,
    }
    return JSONResponse(
        status_code=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content=payload,
    )
