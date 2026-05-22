"""认证相关别名路由（与检修域能力共享实现）。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.session import get_session
from app.modules.maintenance.application.auth_service import MaintenanceAuthService
from app.modules.maintenance.application.captcha_service import issue_captcha, verify_and_consume
from app.modules.maintenance.auth_cookies import REFRESH_COOKIE_NAME, clear_refresh_cookie, set_refresh_cookie
from app.modules.maintenance.errors import MaintenanceAPIError
from app.services.email_service import EmailService
from app.services.sms_service import SmsService
from app.services.verification_code_service import (
    ALLOWED_EMAIL_SCENES,
    ALLOWED_SMS_SCENES,
    EMAIL_CODE_EXPIRE_SECONDS,
    SMS_CODE_EXPIRE_SECONDS,
    VerificationCodeService,
)

router = APIRouter(prefix="/api/auth", tags=["认证"])


def _ok(data: Any) -> dict[str, Any]:
    return {"success": True, "data": data, "business_code": None, "message": None}


def _json_ok(data: Any, message: str | None = None) -> JSONResponse:
    return JSONResponse(content=_ok(data) | {"message": message})


def _err(exc: MaintenanceAPIError) -> Response:
    import json

    payload = {
        "success": False,
        "data": exc.data,
        "business_code": exc.business_code,
        "message": exc.message,
        "errors": exc.errors,
    }
    return Response(
        content=json.dumps(payload, ensure_ascii=False),
        media_type="application/json",
        status_code=exc.status_code,
    )


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _svc(session: AsyncSession, settings: Settings) -> MaintenanceAuthService:
    return MaintenanceAuthService(session, settings)


async def _verify_optional_captcha(body: dict[str, Any]) -> None:
    captcha_id = body.get("captchaId") or body.get("captcha_id")
    captcha_code = body.get("captchaCode") or body.get("captcha_code")
    if captcha_id or captcha_code:
        await verify_and_consume(captcha_id, captcha_code)


@router.get("/captcha")
async def get_captcha_alias() -> dict[str, Any]:
    """GET /api/auth/captcha — 与检修域验证码接口一致。"""
    return _ok(await issue_captcha())


@router.post("/email-code/send")
async def send_email_code_alias(
    body: dict[str, Any],
    settings: Settings = Depends(get_settings),
):
    try:
        email = str(body.get("email") or "").strip().lower()
        scene = str(body.get("scene") or "").strip()
        if scene not in ALLOWED_EMAIL_SCENES:
            raise MaintenanceAPIError(400, "INVALID_VERIFY_SCENE", "验证码场景不符合平台规范")
        if "@" not in email:
            raise MaintenanceAPIError(400, "INVALID_EMAIL", "请输入有效邮箱")
        await _verify_optional_captcha(body)
        verify_service = VerificationCodeService(settings)
        await verify_service.send_code_limit_check(scene, email)
        code = verify_service.generate_code()
        await verify_service.save_code(scene, email, code, EMAIL_CODE_EXPIRE_SECONDS)
        await EmailService(settings).send_verification_code(email, code, scene)
        return _ok({"expires_in": EMAIL_CODE_EXPIRE_SECONDS})
    except MaintenanceAPIError as exc:
        return _err(exc)


@router.post("/sms-code/send")
async def send_sms_code_alias(
    body: dict[str, Any],
    settings: Settings = Depends(get_settings),
):
    try:
        phone = str(body.get("phone") or "").strip()
        scene = str(body.get("scene") or "").strip()
        if scene not in ALLOWED_SMS_SCENES:
            raise MaintenanceAPIError(400, "INVALID_VERIFY_SCENE", "验证码场景不符合平台规范")
        if len(phone) < 6:
            raise MaintenanceAPIError(400, "INVALID_PHONE", "请输入有效手机号")
        await _verify_optional_captcha(body)
        verify_service = VerificationCodeService(settings)
        await verify_service.send_code_limit_check(scene, phone)
        code = verify_service.generate_code()
        await verify_service.save_code(scene, phone, code, SMS_CODE_EXPIRE_SECONDS)
        await SmsService(settings).send_verification_code(phone, code, scene)
        return _ok({"expires_in": SMS_CODE_EXPIRE_SECONDS})
    except MaintenanceAPIError as exc:
        return _err(exc)


@router.post("/login")
async def login_alias(
    body: dict[str, Any],
    request: Request,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    try:
        data = await _svc(session, settings).login(
            body.get("account") or body.get("username", ""),
            body.get("password", ""),
            captcha_id=body.get("captchaId") or body.get("captcha_id"),
            captcha_code=body.get("captchaCode") or body.get("captcha_code"),
            client_ip=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
            remember_me=bool(body.get("remember_me") or body.get("rememberMe")),
        )
        refresh_token = str(data.pop("refresh_token") or "")
        response = _json_ok(data)
        if refresh_token:
            set_refresh_cookie(
                response,
                request,
                settings,
                refresh_token=refresh_token,
                remember_me=bool(body.get("remember_me") or body.get("rememberMe")),
            )
        return response
    except MaintenanceAPIError as exc:
        return _err(exc)


@router.post("/register")
async def register_alias(
    body: dict[str, Any],
    request: Request,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    try:
        data = await _svc(session, settings).register(body, client_ip=_client_ip(request))
        res = _ok(data)
        res["message"] = "注册申请已提交，请等待管理员审核。"
        return res
    except MaintenanceAPIError as exc:
        return _err(exc)


@router.post("/password-reset/request")
async def password_reset_request_alias(
    body: dict[str, Any],
    request: Request,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    try:
        data = await _svc(session, settings).request_password_reset(body, client_ip=_client_ip(request))
        res = _ok(data)
        res["message"] = data.get("message")
        return res
    except MaintenanceAPIError as exc:
        return _err(exc)


@router.post("/password-reset/confirm")
async def password_reset_confirm_alias(
    body: dict[str, Any],
    request: Request,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    try:
        data = await _svc(session, settings).confirm_password_reset(body, client_ip=_client_ip(request))
        res = _ok(data)
        res["message"] = "密码已重置，请重新登录"
        return res
    except MaintenanceAPIError as exc:
        return _err(exc)


@router.post("/logout")
async def logout_alias(request: Request):
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_refresh_cookie(response, request)
    return response


@router.post("/refresh")
async def refresh_alias(
    request: Request,
    body: dict[str, Any] | None = None,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    try:
        body = body or {}
        refresh_token = request.cookies.get(REFRESH_COOKIE_NAME) or str(body.get("refresh_token") or "")
        data = await _svc(session, settings).refresh(refresh_token)
        refresh_cookie = str(data.pop("refresh_token") or "")
        response = _json_ok(data)
        if refresh_cookie:
            set_refresh_cookie(
                response,
                request,
                settings,
                refresh_token=refresh_cookie,
                remember_me=bool(data.get("remember_me")),
            )
        return response
    except MaintenanceAPIError as exc:
        return _err(exc)
