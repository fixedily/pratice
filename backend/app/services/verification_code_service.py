"""邮箱 / 手机动态验证码存储与校验。"""
from __future__ import annotations

import hashlib
import hmac
import secrets

from app.core.config import Settings, get_settings
from app.core.redis import get_redis_service
from app.modules.maintenance.errors import MaintenanceAPIError

EMAIL_CODE_EXPIRE_SECONDS = 10 * 60
SMS_CODE_EXPIRE_SECONDS = 5 * 60
SEND_INTERVAL_SECONDS = 60

ALLOWED_EMAIL_SCENES = {"register", "reset_password", "bind_email", "login_security"}
ALLOWED_SMS_SCENES = {"register", "reset_password", "bind_phone"}


class VerificationCodeService:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.redis = get_redis_service()

    @staticmethod
    def generate_code() -> str:
        return f"{secrets.randbelow(1_000_000):06d}"

    def _code_key(self, scene: str, target: str) -> str:
        return self.redis.key("verify_code", scene, target.lower())

    def _limit_key(self, scene: str, target: str) -> str:
        return self.redis.key("verify_code_limit", scene, target.lower())

    def _hash_code(self, scene: str, target: str, code: str) -> str:
        raw = f"{scene}:{target.lower()}:{code}".encode("utf-8")
        return hmac.new(self.settings.jwt_secret_key.encode("utf-8"), raw, hashlib.sha256).hexdigest()

    async def send_code_limit_check(self, scene: str, target: str) -> None:
        key = self._limit_key(scene, target)
        ttl = await self.redis.ttl(key)
        if ttl > 0:
            raise MaintenanceAPIError(
                429,
                "VERIFY_CODE_SEND_TOO_OFTEN",
                "验证码发送过于频繁，请稍后再试",
                data={"retry_after_seconds": ttl},
            )

    async def save_code(self, scene: str, target: str, code: str, expire_seconds: int) -> None:
        await self.redis.set(self._code_key(scene, target), self._hash_code(scene, target, code), ex=expire_seconds)
        await self.redis.set(self._limit_key(scene, target), "1", ex=SEND_INTERVAL_SECONDS)

    async def verify_code(self, scene: str, target: str, code: str) -> None:
        clean_code = (code or "").strip()
        if not clean_code:
            raise MaintenanceAPIError(400, "VERIFY_CODE_REQUIRED", "请输入邮箱验证码")
        stored_hash = await self.redis.get(self._code_key(scene, target))
        if stored_hash is None:
            raise MaintenanceAPIError(400, "VERIFY_CODE_EXPIRED", "验证码已过期，请重新获取")
        expected = self._hash_code(scene, target, clean_code)
        if not hmac.compare_digest(stored_hash, expected):
            raise MaintenanceAPIError(400, "VERIFY_CODE_INVALID", "验证码错误，请重新输入")
        await self.redis.delete(self._code_key(scene, target))
