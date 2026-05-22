"""Authentication and admin-user operations for maintenance."""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import Settings
from app.db.models.maintenance import AuthLog, AuthUser, PasswordResetRequest, Role, UserRole
from app.modules.maintenance.datetime_util import utc_now_naive
from app.modules.maintenance.deps import CurrentUserCtx
from app.modules.maintenance.errors import MaintenanceAPIError
from app.modules.maintenance.application.captcha_service import verify_and_consume
from app.modules.maintenance.application.login_security_service import (
    clear_login_failures,
    ensure_login_allowed,
    record_login_failure,
)
from app.modules.maintenance.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.services.email_service import EmailService
from app.services.verification_code_service import EMAIL_CODE_EXPIRE_SECONDS, VerificationCodeService


_CAPTCHA_FAIL_CODES = frozenset({"CAPTCHA_REQUIRED", "CAPTCHA_INVALID", "CAPTCHA_EXPIRED"})
_ACCOUNT_OR_PASSWORD_ERROR = "账号或密码错误"
_ALLOWED_REQUESTED_ROLES = {
    "inspector": "巡检员",
    "maintainer": "检修员",
    "engineer": "设备工程师",
}
PASSWORD_RESET_GENERIC_MESSAGE = "如果账号存在，系统将发送重置验证码。"


class MaintenanceAuthService:
    """Auth, user profile, and admin user management."""

    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings

    async def _record_failed_login(self, username: str, client_ip: str | None) -> None:
        """累计失败次数；达阈值后 ensure_login_allowed 将抛出 ACCOUNT_LOCKED。"""
        await record_login_failure(username, client_ip)
        await ensure_login_allowed(username, client_ip)

    async def _log_auth(
        self,
        *,
        action: str,
        success: bool,
        user_id: int | None = None,
        ip: str | None = None,
        user_agent: str | None = None,
        reason: str | None = None,
    ) -> None:
        self.session.add(
            AuthLog(
                user_id=user_id,
                action=action,
                ip=ip,
                user_agent=(user_agent or "")[:255] or None,
                success=success,
                reason=reason,
                created_at=utc_now_naive(),
            )
        )

    @staticmethod
    def _normalize_account(account: str) -> str:
        return (account or "").strip()

    async def _find_user_by_account(self, account: str) -> AuthUser | None:
        normalized = self._normalize_account(account)
        if not normalized:
            return None
        lower = normalized.lower()
        result = await self.session.execute(
            select(AuthUser)
            .options(selectinload(AuthUser.roles))
            .where(
                or_(
                    func.lower(AuthUser.username) == lower,
                    func.lower(AuthUser.email) == lower,
                    AuthUser.phone == normalized,
                )
            )
        )
        return result.scalar_one_or_none()

    @staticmethod
    def _validate_password_strength(password: str, username: str = "") -> None:
        if len(password) < 8:
            raise MaintenanceAPIError(400, "INVALID_PASSWORD", "密码长度至少 8 位")
        if password.lower() == username.lower():
            raise MaintenanceAPIError(400, "INVALID_PASSWORD", "密码不能与用户名相同")
        has_letter = any(ch.isalpha() for ch in password)
        has_digit = any(ch.isdigit() for ch in password)
        if not (has_letter and has_digit):
            raise MaintenanceAPIError(400, "INVALID_PASSWORD", "密码需包含字母和数字")

    @staticmethod
    def _mask_email(email: str) -> str:
        local, _, domain = email.partition("@")
        if not domain:
            return "***"
        if len(local) <= 2:
            masked_local = local[:1] + "***"
        else:
            masked_local = local[:2] + "***"
        return f"{masked_local}@{domain}"

    async def _role_by_code(self, code: str) -> Role:
        role = (await self.session.execute(select(Role).where(Role.code == code))).scalar_one_or_none()
        if role is not None:
            return role
        role = Role(code=code, name=_ALLOWED_REQUESTED_ROLES[code])
        self.session.add(role)
        await self.session.flush()
        return role

    async def _record_db_login_failure(self, user: AuthUser, client_ip: str | None, user_agent: str | None) -> None:
        user.failed_login_count = (user.failed_login_count or 0) + 1
        if user.failed_login_count >= self.settings.login_fail_max:
            user.status = "locked"
            user.locked_until = utc_now_naive() + timedelta(seconds=self.settings.login_lock_seconds)
            await self._log_auth(
                action="login",
                success=False,
                user_id=user.id,
                ip=client_ip,
                user_agent=user_agent,
                reason="account_locked",
            )
            await self.session.commit()
            raise MaintenanceAPIError(
                429,
                "ACCOUNT_LOCKED",
                "密码错误次数过多，账号已临时锁定，请稍后再试。",
                data={"retry_after_seconds": self.settings.login_lock_seconds},
            )
        await self._log_auth(
            action="login",
            success=False,
            user_id=user.id,
            ip=client_ip,
            user_agent=user_agent,
            reason="invalid_credentials",
        )
        await self.session.commit()

    async def login(
        self,
        username: str,
        password: str,
        *,
        captcha_id: str | None = None,
        captcha_code: str | None = None,
        client_ip: str | None = None,
        user_agent: str | None = None,
        remember_me: bool = False,
    ) -> dict[str, Any]:
        account = self._normalize_account(username)
        await ensure_login_allowed(account, client_ip)
        try:
            await verify_and_consume(captcha_id, captcha_code)
        except MaintenanceAPIError as exc:
            if exc.business_code in _CAPTCHA_FAIL_CODES:
                await self._record_failed_login(account, client_ip)
            raise
        user = await self._find_user_by_account(account)
        if user is None or not verify_password(password, user.password_hash):
            if user is None:
                await self._record_failed_login(account, client_ip)
            else:
                await self._record_db_login_failure(user, client_ip, user_agent)
            raise MaintenanceAPIError(401, "INVALID_CREDENTIALS", _ACCOUNT_OR_PASSWORD_ERROR)
        now = utc_now_naive()
        if user.status == "locked" and user.locked_until and user.locked_until <= now:
            user.status = "active"
            user.locked_until = None
            user.failed_login_count = 0
        if user.status == "pending":
            raise MaintenanceAPIError(403, "ACCOUNT_PENDING", "账号正在审核中，请联系管理员")
        if user.status == "disabled" or not user.is_active:
            raise MaintenanceAPIError(403, "ACCOUNT_DISABLED", "账号已被禁用，请联系管理员")
        if user.status == "locked":
            retry_after = 60
            if user.locked_until:
                retry_after = max(1, int((user.locked_until - now).total_seconds()))
            raise MaintenanceAPIError(
                429,
                "ACCOUNT_LOCKED",
                "密码错误次数过多，账号已临时锁定，请稍后再试。",
                data={"retry_after_seconds": retry_after},
            )
        await clear_login_failures(account, client_ip)
        user.failed_login_count = 0
        user.locked_until = None
        user.last_login_at = now
        await self._log_auth(action="login", success=True, user_id=user.id, ip=client_ip, user_agent=user_agent)
        roles = [r.code for r in user.roles]
        token = create_access_token(
            secret=self.settings.jwt_secret_key,
            algorithm=self.settings.jwt_algorithm,
            user_id=user.id,
            username=user.username,
            roles=roles,
            expires_minutes=self.settings.access_token_expire_minutes,
        )
        refresh_days = (
            self.settings.refresh_token_remember_days
            if remember_me
            else self.settings.refresh_token_expire_days
        )
        refresh_token = create_refresh_token(
            secret=self.settings.jwt_secret_key,
            algorithm=self.settings.jwt_algorithm,
            user_id=user.id,
            username=user.username,
            roles=roles,
            expires_days=refresh_days,
            remember_me=remember_me,
        )
        await self.session.commit()
        return {
            "access_token": token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "expires_in": self.settings.access_token_expire_minutes * 60,
            "refresh_expires_in": refresh_days * 24 * 60 * 60,
            "user": {
                "id": user.id,
                "username": user.username,
                "display_name": user.display_name,
                "real_name": user.real_name,
                "status": user.status,
                "roles": roles,
            },
        }

    @staticmethod
    async def _verify_body_captcha(body: dict[str, Any]) -> None:
        await verify_and_consume(
            body.get("captchaId") or body.get("captcha_id"),
            body.get("captchaCode") or body.get("captcha_code"),
        )

    async def register(self, body: dict[str, Any], *, client_ip: str | None = None) -> dict[str, Any]:
        await self._verify_body_captcha(body)
        username = str(body.get("username") or "").strip()
        real_name = str(body.get("real_name") or body.get("realName") or "").strip()
        phone = str(body.get("phone") or "").strip() or None
        email = str(body.get("email") or "").strip().lower() or None
        department = str(body.get("department") or "").strip()
        requested_role = str(body.get("requested_role") or body.get("requestedRole") or "maintainer").strip()
        password = str(body.get("password") or "")
        if not username:
            raise MaintenanceAPIError(400, "INVALID_USERNAME", "请输入用户名")
        if len(username) < 3:
            raise MaintenanceAPIError(400, "INVALID_USERNAME", "用户名至少 3 个字符")
        if not real_name:
            raise MaintenanceAPIError(400, "INVALID_REAL_NAME", "请输入真实姓名")
        if not department:
            raise MaintenanceAPIError(400, "INVALID_DEPARTMENT", "请输入所属部门")
        if requested_role not in _ALLOWED_REQUESTED_ROLES:
            raise MaintenanceAPIError(400, "INVALID_ROLE", "申请角色不符合平台规范")
        if not password:
            raise MaintenanceAPIError(400, "INVALID_PASSWORD", "请输入密码")
        self._validate_password_strength(password, username)
        if str(body.get("confirm_password") or body.get("confirmPassword") or password) != password:
            raise MaintenanceAPIError(400, "PASSWORD_MISMATCH", "两次输入的密码不一致")
        email_code = str(body.get("email_code") or body.get("emailCode") or "").strip()
        if email and email_code:
            await VerificationCodeService(self.settings).verify_code("register", email, email_code)

        user = AuthUser(
            username=username,
            password_hash=hash_password(password),
            display_name=real_name,
            real_name=real_name,
            phone=phone,
            email=email,
            department=department,
            status="pending",
            is_active=False,
            register_ip=client_ip,
            created_at=utc_now_naive(),
            updated_at=utc_now_naive(),
        )
        self.session.add(user)
        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            raise MaintenanceAPIError(409, "DUPLICATE_ACCOUNT", "用户名、邮箱或手机号已存在") from None

        role = await self._role_by_code(requested_role)
        self.session.add(UserRole(user_id=user.id, role_id=role.id))
        await self._log_auth(action="register", success=True, user_id=user.id, ip=client_ip, reason="pending_review")
        await self.session.commit()
        return {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "status": user.status,
            "roles": [requested_role],
        }

    async def request_password_reset(self, body: dict[str, Any], *, client_ip: str | None = None) -> dict[str, Any]:
        await self._verify_body_captcha(body)
        account = str(body.get("account") or body.get("username") or "").strip()
        if not account:
            raise MaintenanceAPIError(400, "INVALID_ACCOUNT", "请输入账号、邮箱或手机号")

        user = await self._find_user_by_account(account)
        if user is not None and user.email:
            verify_service = VerificationCodeService(self.settings)
            await verify_service.send_code_limit_check("reset_password", user.email)
            code = verify_service.generate_code()
            await verify_service.save_code("reset_password", user.email, code, EMAIL_CODE_EXPIRE_SECONDS)
            await EmailService(self.settings).send_verification_code(user.email, code, "reset_password")
            await self._log_auth(
                action="password_reset_request",
                success=True,
                user_id=user.id,
                ip=client_ip,
                reason="email_code_sent",
            )
            await self.session.commit()
            return {
                "message": PASSWORD_RESET_GENERIC_MESSAGE,
                "masked_email": self._mask_email(user.email),
                "need_admin_reset": False,
                "expires_in": EMAIL_CODE_EXPIRE_SECONDS,
            }
        if user is not None and not user.email:
            req = PasswordResetRequest(
                account=account,
                contact=user.phone or user.username,
                reason="账号未绑定邮箱，需管理员协助重置密码",
                user_id=user.id,
                status="pending",
                request_ip=client_ip,
                created_at=utc_now_naive(),
                updated_at=utc_now_naive(),
            )
            self.session.add(req)
            await self._log_auth(
                action="password_reset_request",
                success=True,
                user_id=user.id,
                ip=client_ip,
                reason="admin_reset_required",
            )
            await self.session.commit()
            return {
                "message": "该账号未绑定邮箱，请联系系统管理员重置密码。",
                "need_admin_reset": True,
            }
        await self._log_auth(
            action="password_reset_request",
            success=True,
            ip=client_ip,
            reason="generic_no_user",
        )
        await self.session.commit()
        return {
            "message": PASSWORD_RESET_GENERIC_MESSAGE,
            "need_admin_reset": False,
        }

    async def forgot_password(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self.request_password_reset(body)

    async def confirm_password_reset(self, body: dict[str, Any], *, client_ip: str | None = None) -> dict[str, Any]:
        account = str(body.get("account") or "").strip()
        email_code = str(body.get("email_code") or body.get("emailCode") or "").strip()
        new_password = str(body.get("new_password") or body.get("newPassword") or "")
        confirm_password = str(body.get("confirm_password") or body.get("confirmPassword") or "")
        if not account:
            raise MaintenanceAPIError(400, "INVALID_ACCOUNT", "请输入账号、邮箱或手机号")
        if new_password != confirm_password:
            raise MaintenanceAPIError(400, "PASSWORD_MISMATCH", "两次输入的密码不一致")
        user = await self._find_user_by_account(account)
        if user is None or not user.email:
            raise MaintenanceAPIError(400, "RESET_VERIFY_FAILED", "验证码错误或已过期")
        await VerificationCodeService(self.settings).verify_code("reset_password", user.email, email_code)
        self._validate_password_strength(new_password, user.username)
        user.password_hash = hash_password(new_password)
        user.failed_login_count = 0
        user.locked_until = None
        if user.status == "locked":
            user.status = "active"
        user.updated_at = utc_now_naive()
        await self._log_auth(
            action="password_reset_confirm",
            success=True,
            user_id=user.id,
            ip=client_ip,
            reason="email_code_verified",
        )
        await self.session.commit()
        return {"message": "密码已重置，请重新登录"}

    async def refresh(self, refresh_token: str) -> dict[str, Any]:
        try:
            payload = decode_token(
                refresh_token,
                secret=self.settings.jwt_secret_key,
                algorithm=self.settings.jwt_algorithm,
            )
        except Exception:
            raise MaintenanceAPIError(401, "INVALID_REFRESH_TOKEN", "刷新令牌无效或已过期") from None
        if payload.get("typ") != "refresh":
            raise MaintenanceAPIError(401, "INVALID_REFRESH_TOKEN", "刷新令牌无效或已过期")
        user = await self._find_user_by_account(str(payload.get("username") or ""))
        if user is None or user.status != "active" or not user.is_active:
            raise MaintenanceAPIError(401, "INVALID_REFRESH_TOKEN", "刷新令牌无效或已过期")
        roles = [r.code for r in user.roles]
        remember_me = bool(payload.get("remember_me"))
        refresh_days = (
            self.settings.refresh_token_remember_days
            if remember_me
            else self.settings.refresh_token_expire_days
        )
        refresh_token = create_refresh_token(
            secret=self.settings.jwt_secret_key,
            algorithm=self.settings.jwt_algorithm,
            user_id=user.id,
            username=user.username,
            roles=roles,
            expires_days=refresh_days,
            remember_me=remember_me,
        )
        access_token = create_access_token(
            secret=self.settings.jwt_secret_key,
            algorithm=self.settings.jwt_algorithm,
            user_id=user.id,
            username=user.username,
            roles=roles,
            expires_minutes=self.settings.access_token_expire_minutes,
        )
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "expires_in": self.settings.access_token_expire_minutes * 60,
            "refresh_expires_in": refresh_days * 24 * 60 * 60,
            "remember_me": remember_me,
        }

    async def get_me(self, ctx: CurrentUserCtx) -> dict[str, Any]:
        result = await self.session.execute(
            select(AuthUser).options(selectinload(AuthUser.roles)).where(AuthUser.id == ctx.user_id)
        )
        user = result.scalar_one()
        return {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "status": user.status,
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
