"""Knowledge module auth dependencies."""
from __future__ import annotations

from typing import Annotated

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import Settings, get_settings
from app.db.models.maintenance import AuthUser
from app.db.session import get_session
from app.modules.maintenance.deps import CurrentUserCtx, bearer_scheme, get_current_user_ctx
from app.modules.maintenance.security import decode_token

OptionalUserCtx = CurrentUserCtx | None


async def resolve_optional_user_ctx(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> CurrentUserCtx | None:
    """Return authenticated user when Bearer token is valid; otherwise None."""
    if creds is None or not creds.credentials:
        return None
    try:
        payload = decode_token(
            creds.credentials,
            secret=settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
        )
    except jwt.PyJWTError:
        return None

    uid = int(payload["sub"])
    result = await session.execute(
        select(AuthUser).options(selectinload(AuthUser.roles)).where(AuthUser.id == uid)
    )
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        return None
    roles = [r.code for r in user.roles]
    return CurrentUserCtx(
        user_id=user.id,
        username=user.username,
        roles=roles,
        display_name=user.display_name,
    )


async def require_user_ctx(
    ctx: Annotated[CurrentUserCtx, Depends(get_current_user_ctx)],
) -> CurrentUserCtx:
    return ctx


async def optional_user_ctx(
    ctx: Annotated[CurrentUserCtx | None, Depends(resolve_optional_user_ctx)],
) -> CurrentUserCtx | None:
    return ctx
