"""短信验证码服务占位实现。"""
from __future__ import annotations

import logging

from app.core.config import Settings, get_settings
from app.modules.maintenance.errors import MaintenanceAPIError

logger = logging.getLogger(__name__)


class SmsService:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    async def send_verification_code(self, phone: str, code: str, scene: str) -> None:
        if self.settings.debug:
            logger.info("sms_verify_code_mock phone=%s scene=%s code=%s", phone, scene, code)
            return
        logger.info("sms_verify_code_mock_unconfigured phone=%s scene=%s", phone, scene)
        raise MaintenanceAPIError(503, "SMS_SERVICE_NOT_CONFIGURED", "短信服务未配置")
