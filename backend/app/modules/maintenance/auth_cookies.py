"""Refresh-token cookie helpers for maintenance auth routes."""
from __future__ import annotations

from fastapi import Request, Response

from app.core.config import Settings

REFRESH_COOKIE_NAME = "faultdiag_refresh_token"
REFRESH_COOKIE_PATH = "/api"


def _use_secure_cookie(request: Request) -> bool:
    return request.url.scheme == "https"


def set_refresh_cookie(
    response: Response,
    request: Request,
    settings: Settings,
    *,
    refresh_token: str,
    remember_me: bool,
) -> None:
    max_age = settings.refresh_token_remember_days * 24 * 60 * 60 if remember_me else None
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        max_age=max_age,
        httponly=True,
        secure=_use_secure_cookie(request),
        samesite="lax",
        path=REFRESH_COOKIE_PATH,
    )


def clear_refresh_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        httponly=True,
        secure=_use_secure_cookie(request),
        samesite="lax",
        path=REFRESH_COOKIE_PATH,
    )
