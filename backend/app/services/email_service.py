"""Provider-based email sending service for verification codes."""
from __future__ import annotations

import asyncio
import html
import logging
import smtplib
from abc import ABC, abstractmethod
from email.message import EmailMessage

from app.core.config import Settings, get_settings
from app.modules.maintenance.errors import MaintenanceAPIError
from app.services.verification_code_service import EMAIL_CODE_EXPIRE_SECONDS

logger = logging.getLogger(__name__)

SCENE_LABELS = {
    "register": "账号注册",
    "reset_password": "重置密码",
    "bind_email": "绑定邮箱",
    "login_security": "登录安全验证",
}


class BaseEmailProvider(ABC):
    """Email provider contract used by auth flows."""

    @abstractmethod
    async def send_email(self, to_email: str, subject: str, html_content: str) -> None:
        """Send an HTML email."""


class SmtpEmailProvider(BaseEmailProvider):
    """SMTP implementation using smtplib."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _ensure_configured(self) -> None:
        if not (
            self.settings.smtp_host
            and self.settings.smtp_user
            and self.settings.smtp_password
            and self.settings.smtp_port
        ):
            raise MaintenanceAPIError(503, "EMAIL_SERVICE_NOT_CONFIGURED", "邮箱服务未配置")

    async def send_email(self, to_email: str, subject: str, html_content: str) -> None:
        self._ensure_configured()
        await asyncio.to_thread(self._send_email_sync, to_email, subject, html_content)

    def _send_email_sync(self, to_email: str, subject: str, html_content: str) -> None:
        msg = EmailMessage()
        msg["Subject"] = subject if "FaultDiag" in subject else f"FaultDiag - {subject}"
        msg["From"] = f"{self.settings.smtp_from_name} <{self.settings.smtp_user}>"
        msg["To"] = to_email
        msg.set_content("请使用支持 HTML 的邮件客户端查看验证码。")
        msg.add_alternative(html_content, subtype="html")

        try:
            if self.settings.smtp_use_ssl:
                with smtplib.SMTP_SSL(self.settings.smtp_host, self.settings.smtp_port, timeout=10) as server:
                    server.login(self.settings.smtp_user, self.settings.smtp_password)
                    server.send_message(msg)
            else:
                with smtplib.SMTP(self.settings.smtp_host, self.settings.smtp_port, timeout=10) as server:
                    server.starttls()
                    server.login(self.settings.smtp_user, self.settings.smtp_password)
                    server.send_message(msg)
        except MaintenanceAPIError:
            raise
        except Exception as exc:
            logger.warning(
                "email_send_failed provider=smtp to=%s host=%s error_type=%s",
                to_email,
                self.settings.smtp_host,
                type(exc).__name__,
            )
            raise MaintenanceAPIError(503, "EMAIL_SEND_FAILED", "验证码邮件发送失败，请稍后重试") from exc


class MockEmailProvider(BaseEmailProvider):
    """Development/CI provider that does not send real email."""

    async def send_email(self, to_email: str, subject: str, html_content: str) -> None:
        logger.info(
            "mock_email_send to=%s subject=%s html_length=%s",
            to_email,
            subject,
            len(html_content),
        )


class EmailService:
    """Facade used by auth/business code; hides provider selection."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.provider = self._build_provider()

    def _build_provider(self) -> BaseEmailProvider:
        provider = (self.settings.email_provider or "smtp").strip().lower()
        if provider == "mock":
            return MockEmailProvider()
        if provider == "smtp":
            return SmtpEmailProvider(self.settings)
        raise MaintenanceAPIError(500, "EMAIL_PROVIDER_NOT_SUPPORTED", "邮箱服务类型不支持")

    async def send_email(self, to_email: str, subject: str, html_content: str) -> None:
        await self.provider.send_email(to_email, subject, html_content)

    async def send_verification_code(self, to_email: str, code: str, scene: str) -> None:
        scene_label = SCENE_LABELS.get(scene, "邮箱验证")
        minutes = EMAIL_CODE_EXPIRE_SECONDS // 60
        safe_scene = html.escape(scene_label)
        subject = f"FaultDiag {scene_label}验证码"
        content = f"""
        <div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.7;color:#1f2937">
          <h2 style="color:#10b981">FaultDiag 运维管理后台</h2>
          <p>你正在进行：<strong>{safe_scene}</strong></p>
          <p>本次验证码为：</p>
          <div style="font-size:28px;font-weight:700;letter-spacing:6px;color:#0f766e;margin:16px 0">{html.escape(code)}</div>
          <p>验证码 {minutes} 分钟内有效，使用后立即失效。</p>
          <p style="color:#64748b">如非本人操作，请忽略本邮件，并及时联系系统管理员检查账号安全。</p>
        </div>
        """
        if (self.settings.email_provider or "smtp").strip().lower() == "mock":
            logger.info(
                "email_verify_code_mock to=%s subject=%s scene=%s code=%s",
                to_email,
                subject,
                scene,
                code,
            )
        elif self.settings.debug:
            logger.info("email_verify_code_debug to=%s scene=%s code=%s", to_email, scene, code)
        else:
            logger.info("email_verify_code_send to=%s scene=%s code_prefix=%s***", to_email, scene, code[:2])
        await self.send_email(to_email, subject, content)
