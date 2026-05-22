"""Email provider selection and SMTP behavior tests."""
from __future__ import annotations

import logging

import pytest

from app.core.config import Settings
from app.modules.maintenance.errors import MaintenanceAPIError
from app.services.email_service import EmailService, MockEmailProvider, SmtpEmailProvider
from app.services.verification_code_service import ALLOWED_EMAIL_SCENES


class _DummySmtp:
    instances: list["_DummySmtp"] = []

    def __init__(self, host: str, port: int, timeout: int) -> None:
        self.host = host
        self.port = port
        self.timeout = timeout
        self.started_tls = False
        self.login_args: tuple[str, str] | None = None
        self.sent = False
        self.instances.append(self)

    def __enter__(self) -> "_DummySmtp":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def starttls(self) -> None:
        self.started_tls = True

    def login(self, user: str, password: str) -> None:
        self.login_args = (user, password)

    def send_message(self, msg) -> None:
        self.sent = True


def _settings(**overrides) -> Settings:
    base = {
        "JWT_SECRET_KEY": "k" * 40,
        "EMAIL_PROVIDER": "smtp",
        "SMTP_HOST": "smtp.example.com",
        "SMTP_PORT": 465,
        "SMTP_USER": "sender@example.com",
        "SMTP_PASSWORD": "smtp-secret",
        "SMTP_FROM_NAME": "FaultDiag 运维管理后台",
        "SMTP_USE_SSL": True,
    }
    base.update(overrides)
    return Settings(**base)


@pytest.mark.asyncio
async def test_email_provider_mock_logs_code_without_smtp(monkeypatch, caplog):
    def fail_smtp(*args, **kwargs):
        raise AssertionError("SMTP should not be used in mock mode")

    monkeypatch.setattr("smtplib.SMTP_SSL", fail_smtp)
    caplog.set_level(logging.INFO)

    service = EmailService(_settings(EMAIL_PROVIDER="mock"))
    assert isinstance(service.provider, MockEmailProvider)

    await service.send_verification_code("worker@example.com", "123456", "register")

    logs = caplog.text
    assert "email_verify_code_mock" in logs
    assert "worker@example.com" in logs
    assert "register" in logs
    assert "123456" in logs


def test_login_security_scene_is_allowed_for_email_codes():
    assert "login_security" in ALLOWED_EMAIL_SCENES


@pytest.mark.asyncio
async def test_smtp_provider_uses_ssl(monkeypatch):
    _DummySmtp.instances = []
    monkeypatch.setattr("smtplib.SMTP_SSL", _DummySmtp)

    service = EmailService(_settings(SMTP_USE_SSL=True, SMTP_PORT=465))
    assert isinstance(service.provider, SmtpEmailProvider)

    await service.send_email("to@example.com", "FaultDiag 测试", "<p>ok</p>")

    instance = _DummySmtp.instances[0]
    assert instance.host == "smtp.example.com"
    assert instance.port == 465
    assert instance.started_tls is False
    assert instance.login_args == ("sender@example.com", "smtp-secret")
    assert instance.sent is True


@pytest.mark.asyncio
async def test_smtp_provider_uses_starttls(monkeypatch):
    _DummySmtp.instances = []
    monkeypatch.setattr("smtplib.SMTP", _DummySmtp)

    service = EmailService(_settings(SMTP_USE_SSL=False, SMTP_PORT=587))
    await service.send_email("to@example.com", "FaultDiag 测试", "<p>ok</p>")

    instance = _DummySmtp.instances[0]
    assert instance.host == "smtp.example.com"
    assert instance.port == 587
    assert instance.started_tls is True
    assert instance.sent is True


@pytest.mark.asyncio
async def test_smtp_missing_config_returns_clear_error():
    service = EmailService(_settings(SMTP_PASSWORD=None))

    with pytest.raises(MaintenanceAPIError) as exc:
        await service.send_email("to@example.com", "FaultDiag 测试", "<p>ok</p>")

    assert exc.value.business_code == "EMAIL_SERVICE_NOT_CONFIGURED"
    assert exc.value.message == "邮箱服务未配置"


@pytest.mark.asyncio
async def test_smtp_failure_log_does_not_include_password(monkeypatch, caplog):
    class FailingSmtp(_DummySmtp):
        def login(self, user: str, password: str) -> None:
            raise RuntimeError("login failed")

    monkeypatch.setattr("smtplib.SMTP_SSL", FailingSmtp)
    caplog.set_level(logging.WARNING)
    service = EmailService(_settings(SMTP_PASSWORD="super-sensitive-secret"))

    with pytest.raises(MaintenanceAPIError):
        await service.send_email("to@example.com", "FaultDiag 测试", "<p>ok</p>")

    assert "super-sensitive-secret" not in caplog.text
