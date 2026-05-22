"""Authentication and admin-user operations for maintenance."""
from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import Settings
from app.db.models.maintenance import AuthUser, Role, UserRole
from app.modules.maintenance.datetime_util import utc_now_naive
from app.modules.maintenance.deps import CurrentUserCtx
from app.modules.maintenance.errors import MaintenanceAPIError
from app.modules.maintenance.application.captcha_service import verify_and_consume
from app.modules.maintenance.application.login_security_service import (
    clear_login_failures,
    ensure_login_allowed,
    record_login_failure,
)
from app.modules.maintenance.security import create_access_token, hash_password, verify_password


_CAPTCHA_FAIL_CODES = frozenset({"CAPTCHA_REQUIRED", "CAPTCHA_INVALID", "CAPTCHA_EXPIRED"})


class MaintenanceAuthService:
    """Auth, user profile, and admin user management."""

    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings

    async def _record_failed_login(self, username: str, client_ip: str | None) -> None:
        """累计失败次数；达阈值后 ensure_login_allowed 将抛出 ACCOUNT_LOCKED。"""
        await record_login_failure(username, client_ip)
        await ensure_login_allowed(username, client_ip)

    async def login(
        self,
        username: str,
        password: str,
        *,
        captcha_id: str | None = None,
        captcha_code: str | None = None,
        client_ip: str | None = None,
    ) -> dict[str, Any]:
        await ensure_login_allowed(username, client_ip)
        try:
            await verify_and_consume(captcha_id, captcha_code)
        except MaintenanceAPIError as exc:
            if exc.business_code in _CAPTCHA_FAIL_CODES:
                await self._record_failed_login(username, client_ip)
            raise
        result = await self.session.execute(
            select(AuthUser).options(selectinload(AuthUser.roles)).where(AuthUser.username == username)
        )
        user = result.scalar_one_or_none()
        if user is None or not verify_password(password, user.password_hash):
            await self._record_failed_login(username, client_ip)
            raise MaintenanceAPIError(401, "INVALID_CREDENTIALS", "用户名或密码错误")
        if not user.is_active:
            await self._record_failed_login(username, client_ip)
            raise MaintenanceAPIError(401, "INVALID_CREDENTIALS", "用户已禁用")
        await clear_login_failures(username, client_ip)
        roles = [r.code for r in user.roles]
        token = create_access_token(
            secret=self.settings.jwt_secret_key,
            algorithm=self.settings.jwt_algorithm,
            user_id=user.id,
            username=user.username,
            roles=roles,
            expires_minutes=self.settings.access_token_expire_minutes,
        )
        return {
            "access_token": token,
            "token_type": "bearer",
            "expires_in": self.settings.access_token_expire_minutes * 60,
            "user": {
                "id": user.id,
                "username": user.username,
                "display_name": user.display_name,
                "roles": roles,
            },
        }

    @staticmethod
    async def _verify_body_captcha(body: dict[str, Any]) -> None:
        await verify_and_consume(
            body.get("captchaId") or body.get("captcha_id"),
            body.get("captchaCode") or body.get("captcha_code"),
        )

    async def register(self, body: dict[str, Any]) -> dict[str, Any]:
        await self._verify_body_captcha(body)
        username = str(body.get("username") or "").strip()
        password = str(body.get("password") or "")
        if not username:
            raise MaintenanceAPIError(400, "INVALID_USERNAME", "请输入用户名")
        if len(username) < 3:
            raise MaintenanceAPIError(400, "INVALID_USERNAME", "用户名至少 3 个字符")
        if not password:
            raise MaintenanceAPIError(400, "INVALID_PASSWORD", "请输入密码")
        if len(password) < 6:
            raise MaintenanceAPIError(400, "INVALID_PASSWORD", "密码至少 6 个字符")

        user = AuthUser(
            username=username,
            password_hash=hash_password(password),
            display_name=username,
            is_active=True,
            created_at=utc_now_naive(),
            updated_at=utc_now_naive(),
        )
        self.session.add(user)
        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            raise MaintenanceAPIError(409, "DUPLICATE_USERNAME", "用户名已存在") from None

        worker_role = (await self.session.execute(select(Role).where(Role.code == "worker"))).scalar_one_or_none()
        if worker_role is None:
            await self.session.rollback()
            raise MaintenanceAPIError(500, "ROLE_NOT_CONFIGURED", "默认注册角色未配置")
        self.session.add(UserRole(user_id=user.id, role_id=worker_role.id))
        await self.session.commit()
        return {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "roles": ["worker"],
        }

    async def forgot_password(self, body: dict[str, Any]) -> dict[str, Any]:
        await self._verify_body_captcha(body)
        username = str(body.get("username") or "").strip()
        new_password = str(body.get("new_password") or "")
        confirm_password = str(body.get("confirm_password") or "")
        if not username:
            raise MaintenanceAPIError(400, "INVALID_USERNAME", "请输入用户名")
        if not new_password:
            raise MaintenanceAPIError(400, "INVALID_PASSWORD", "请输入新密码")
        if len(new_password) < 6:
            raise MaintenanceAPIError(400, "INVALID_PASSWORD", "密码至少 6 个字符")
        if new_password != confirm_password:
            raise MaintenanceAPIError(400, "PASSWORD_MISMATCH", "两次输入的密码不一致")

        result = await self.session.execute(
            select(AuthUser).where(AuthUser.username == username)
        )
        user = result.scalar_one_or_none()
        if user is None:
            raise MaintenanceAPIError(404, "USER_NOT_FOUND", "用户不存在")

        user.password_hash = hash_password(new_password)
        user.updated_at = utc_now_naive()
        await self.session.commit()
        return {"username": user.username, "updated": True}

    async def get_me(self, ctx: CurrentUserCtx) -> dict[str, Any]:
        result = await self.session.execute(
            select(AuthUser).options(selectinload(AuthUser.roles)).where(AuthUser.id == ctx.user_id)
        )
        user = result.scalar_one()
        return {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "roles": [r.code for r in user.roles],
        }

    async def admin_list_users(self, page: int, page_size: int) -> dict[str, Any]:
        stmt = select(AuthUser).options(selectinload(AuthUser.roles))
        total = (await self.session.execute(select(func.count()).select_from(AuthUser))).scalar_one()
        stmt = stmt.offset((page - 1) * page_size).limit(page_size)
        rows = (await self.session.execute(stmt)).scalars().all()
        items = [
            {
                "id": u.id,
                "username": u.username,
                "display_name": u.display_name,
                "is_active": u.is_active,
                "roles": [r.code for r in u.roles],
            }
            for u in rows
        ]
        return {"items": items, "total": total, "page": page, "page_size": page_size}

    async def admin_create_user(self, body: dict[str, Any]) -> dict[str, Any]:
        user = AuthUser(
            username=body["username"],
            password_hash=hash_password(body["password"]),
            display_name=body.get("display_name") or body["username"],
            is_active=True,
            created_at=utc_now_naive(),
            updated_at=utc_now_naive(),
        )
        self.session.add(user)
        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            raise MaintenanceAPIError(409, "DUPLICATE_USERNAME", "用户名已存在") from None
        for code in body.get("role_codes", []):
            role = (await self.session.execute(select(Role).where(Role.code == code))).scalar_one_or_none()
            if role:
                self.session.add(UserRole(user_id=user.id, role_id=role.id))
        await self.session.commit()
        return {"id": user.id, "username": user.username}

    async def admin_assign_roles(self, user_id: int, body: dict[str, Any]) -> None:
        await self.session.execute(select(AuthUser).where(AuthUser.id == user_id))
        await self.session.execute(
            UserRole.__table__.delete().where(UserRole.user_id == user_id)
        )
        for code in body.get("role_codes", []):
            role = (await self.session.execute(select(Role).where(Role.code == code))).scalar_one_or_none()
            if role:
                self.session.add(UserRole(user_id=user_id, role_id=role.id))
        await self.session.commit()
