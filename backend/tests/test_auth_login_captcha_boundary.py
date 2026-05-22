"""登录、图形验证码与失败锁定边界条件测试。"""
from __future__ import annotations

import asyncio
import re
import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.core.config import get_settings
from app.core.redis import get_redis_service
from app.modules.maintenance.application.captcha_service import CAPTCHA_LENGTH, peek_code_for_tests

# 复用 test_maintenance_contract 中的 DB / 种子用户 / client（需 pytest.ini pythonpath=tests）
pytest_plugins = ("test_maintenance_contract",)

PREFIX = "/api/v1/maintenance"
LOCK_MESSAGE = "登录失败次数过多，请稍后再试"


@pytest_asyncio.fixture(autouse=True)
async def _isolate_login_redis_state():
    """每个用例前清空内存 Redis，避免锁定计数在用例间泄漏。"""
    redis = get_redis_service()
    if hasattr(redis, "_memory"):
        redis._memory.clear()
    yield
    if hasattr(redis, "_memory"):
        redis._memory.clear()


def _unique_username(prefix: str = "bd") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


async def _fetch_captcha(client: AsyncClient) -> tuple[str, str]:
    r = await client.get(f"{PREFIX}/auth/captcha")
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    captcha_id = data["captchaId"]
    code = await peek_code_for_tests(captcha_id)
    assert code, "测试环境应能读取验证码明文"
    return captcha_id, code


async def _post_login(
    client: AsyncClient,
    *,
    username: str,
    password: str = "wrong",
    captcha_id: str | None = None,
    captcha_code: str | None = None,
):
    payload: dict[str, str] = {"username": username, "password": password}
    if captcha_id is not None:
        payload["captchaId"] = captcha_id
    if captcha_code is not None:
        payload["captchaCode"] = captcha_code
    return await client.post(f"{PREFIX}/auth/login", json=payload)


# ---------------------------------------------------------------------------
# 验证码签发与校验
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_captcha_issue_code_length_and_image(client: AsyncClient):
    captcha_id, code = await _fetch_captcha(client)
    assert len(code) == CAPTCHA_LENGTH == 4
    assert code == code.upper()
    assert all(ch in "23456789ABCDEFGHJKLMNPQRSTUVWXYZ" for ch in code)

    r = await client.get(f"{PREFIX}/auth/captcha")
    image = r.json()["data"]["image"]
    assert image.startswith("data:image/svg+xml;base64,")


@pytest.mark.asyncio
async def test_captcha_case_insensitive_match(client: AsyncClient):
    captcha_id, code = await _fetch_captcha(client)
    resp = await _post_login(
        client,
        username="tc_worker",
        password="testpass",
        captcha_id=captcha_id,
        captcha_code=code.lower(),
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_captcha_trims_whitespace(client: AsyncClient):
    captcha_id, code = await _fetch_captcha(client)
    resp = await _post_login(
        client,
        username="tc_worker",
        password="testpass",
        captcha_id=captcha_id,
        captcha_code=f"  {code}  ",
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("captcha_id", "captcha_code", "expected_code"),
    [
        (None, "ABCD", "CAPTCHA_REQUIRED"),
        ("", "ABCD", "CAPTCHA_REQUIRED"),
        ("00000000-0000-0000-0000-000000000001", None, "CAPTCHA_REQUIRED"),
        ("00000000-0000-0000-0000-000000000001", "", "CAPTCHA_REQUIRED"),
        ("00000000-0000-0000-0000-000000000001", "   ", "CAPTCHA_REQUIRED"),
    ],
)
async def test_captcha_missing_fields(
    client: AsyncClient,
    captcha_id: str | None,
    captcha_code: str | None,
    expected_code: str,
):
    resp = await _post_login(
        client,
        username="tc_worker",
        password="testpass",
        captcha_id=captcha_id,
        captcha_code=captcha_code,
    )
    assert resp.status_code == 400
    assert resp.json()["business_code"] == expected_code


@pytest.mark.asyncio
@pytest.mark.parametrize("wrong_code", ["ABC", "ABCDE", "ABCDEF", "12", ""])
async def test_captcha_wrong_length_or_value(client: AsyncClient, wrong_code: str):
    captcha_id, _ = await _fetch_captcha(client)
    if not wrong_code.strip():
        resp = await _post_login(
            client,
            username="tc_worker",
            password="testpass",
            captcha_id=captcha_id,
            captcha_code=wrong_code,
        )
        assert resp.json()["business_code"] == "CAPTCHA_REQUIRED"
        return

    resp = await _post_login(
        client,
        username="tc_worker",
        password="testpass",
        captcha_id=captcha_id,
        captcha_code=wrong_code,
    )
    assert resp.status_code == 400
    assert resp.json()["business_code"] in {"CAPTCHA_INVALID", "CAPTCHA_EXPIRED"}


@pytest.mark.asyncio
async def test_captcha_one_time_consumption(client: AsyncClient):
    captcha_id, code = await _fetch_captcha(client)
    first = await _post_login(
        client,
        username="tc_worker",
        password="testpass",
        captcha_id=captcha_id,
        captcha_code=code,
    )
    assert first.status_code == 200

    second = await _post_login(
        client,
        username="tc_worker",
        password="testpass",
        captcha_id=captcha_id,
        captcha_code=code,
    )
    assert second.status_code == 400
    assert second.json()["business_code"] == "CAPTCHA_EXPIRED"


@pytest.mark.asyncio
async def test_captcha_unknown_id_expired(client: AsyncClient):
    resp = await _post_login(
        client,
        username="tc_worker",
        password="testpass",
        captcha_id=str(uuid.uuid4()),
        captcha_code="ABCD",
    )
    assert resp.status_code == 400
    assert resp.json()["business_code"] == "CAPTCHA_EXPIRED"


@pytest.mark.asyncio
async def test_captcha_snake_case_body_keys(client: AsyncClient):
    captcha_id, code = await _fetch_captcha(client)
    resp = await client.post(
        f"{PREFIX}/auth/login",
        json={
            "username": "tc_worker",
            "password": "testpass",
            "captcha_id": captcha_id,
            "captcha_code": code,
        },
    )
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# 登录失败计数与锁定
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_login_four_wrong_passwords_not_locked(client: AsyncClient):
    username = _unique_username("four_fail")
    for _ in range(4):
        captcha_id, captcha_code = await _fetch_captcha(client)
        resp = await _post_login(
            client,
            username=username,
            password="wrong-password",
            captcha_id=captcha_id,
            captcha_code=captcha_code,
        )
        assert resp.status_code == 401
        assert resp.json()["business_code"] == "INVALID_CREDENTIALS"


@pytest.mark.asyncio
async def test_login_fifth_failure_locks_with_fixed_message(client: AsyncClient):
    username = _unique_username("fifth_lock")
    for attempt in range(5):
        captcha_id, captcha_code = await _fetch_captcha(client)
        resp = await _post_login(
            client,
            username=username,
            password="wrong-password",
            captcha_id=captcha_id,
            captcha_code=captcha_code,
        )
        if attempt < 4:
            assert resp.status_code == 401
        else:
            assert resp.status_code == 429
            body = resp.json()
            assert body["business_code"] == "ACCOUNT_LOCKED"
            assert body["message"] == LOCK_MESSAGE
            assert "retry_after_seconds" in body["data"]
            assert body["data"]["retry_after_seconds"] > 0
            # 文案中不应拼接倒计时秒数
            assert not re.search(r"\d+\s*秒", body["message"])


@pytest.mark.asyncio
async def test_login_locked_rejects_correct_password(client: AsyncClient):
    username = _unique_username("locked_ok_pwd")
    for _ in range(5):
        captcha_id, captcha_code = await _fetch_captcha(client)
        await _post_login(
            client,
            username=username,
            password="wrong-password",
            captcha_id=captcha_id,
            captcha_code=captcha_code,
        )

    captcha_id, captcha_code = await _fetch_captcha(client)
    resp = await _post_login(
        client,
        username=username,
        password="testpass",
        captcha_id=captcha_id,
        captcha_code=captcha_code,
    )
    assert resp.status_code == 429
    assert resp.json()["business_code"] == "ACCOUNT_LOCKED"


@pytest.mark.asyncio
async def test_login_captcha_failures_count_toward_lockout(client: AsyncClient):
    username = _unique_username("captcha_lock")
    for attempt in range(5):
        captcha_id, _ = await _fetch_captcha(client)
        resp = await _post_login(
            client,
            username=username,
            password="testpass",
            captcha_id=captcha_id,
            captcha_code="ZZZZ",
        )
        if attempt < 4:
            assert resp.status_code == 400
            assert resp.json()["business_code"] == "CAPTCHA_INVALID"
        else:
            # 第 5 次验证码错误累计后触发锁定
            assert resp.status_code == 429
            assert resp.json()["business_code"] == "ACCOUNT_LOCKED"

    captcha_id, captcha_code = await _fetch_captcha(client)
    locked = await _post_login(
        client,
        username=username,
        password="testpass",
        captcha_id=captcha_id,
        captcha_code=captcha_code,
    )
    assert locked.status_code == 429
    assert locked.json()["business_code"] == "ACCOUNT_LOCKED"


@pytest.mark.asyncio
async def test_login_success_clears_failure_counter(client: AsyncClient):
    username = "tc_worker"
    for _ in range(4):
        captcha_id, captcha_code = await _fetch_captcha(client)
        fail = await _post_login(
            client,
            username=username,
            password="wrong-password",
            captcha_id=captcha_id,
            captcha_code=captcha_code,
        )
        assert fail.status_code == 401

    ok_captcha_id, ok_code = await _fetch_captcha(client)
    ok = await _post_login(
        client,
        username=username,
        password="testpass",
        captcha_id=ok_captcha_id,
        captcha_code=ok_code,
    )
    assert ok.status_code == 200

    # 再失败 4 次仍不应锁定
    for _ in range(4):
        captcha_id, captcha_code = await _fetch_captcha(client)
        resp = await _post_login(
            client,
            username=username,
            password="wrong-password",
            captcha_id=captcha_id,
            captcha_code=captcha_code,
        )
        assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_lockout_username_case_insensitive(client: AsyncClient):
    base = _unique_username("case")
    variants = [base.upper(), base.lower(), base, base.upper(), base.lower()]
    for i, variant in enumerate(variants):
        captcha_id, captcha_code = await _fetch_captcha(client)
        resp = await _post_login(
            client,
            username=variant,
            password="wrong-password",
            captcha_id=captcha_id,
            captcha_code=captcha_code,
        )
        if i < 4:
            assert resp.status_code == 401
        else:
            assert resp.status_code == 429
            assert resp.json()["business_code"] == "ACCOUNT_LOCKED"


@pytest.mark.asyncio
async def test_login_lockout_isolated_per_username(client: AsyncClient):
    locked_user = _unique_username("iso_a")
    other_user = _unique_username("iso_b")

    for _ in range(5):
        captcha_id, captcha_code = await _fetch_captcha(client)
        await _post_login(
            client,
            username=locked_user,
            password="wrong-password",
            captcha_id=captcha_id,
            captcha_code=captcha_code,
        )

    captcha_id, captcha_code = await _fetch_captcha(client)
    other = await _post_login(
        client,
        username=other_user,
        password="wrong-password",
        captcha_id=captcha_id,
        captcha_code=captcha_code,
    )
    assert other.status_code == 401
    assert other.json()["business_code"] == "INVALID_CREDENTIALS"


@pytest.mark.asyncio
async def test_login_lock_expires_after_ttl(monkeypatch, client: AsyncClient):
    monkeypatch.setenv("LOGIN_FAIL_MAX", "2")
    monkeypatch.setenv("LOGIN_LOCK_SECONDS", "1")
    get_settings.cache_clear()

    username = _unique_username("ttl")
    for _ in range(2):
        captcha_id, captcha_code = await _fetch_captcha(client)
        resp = await _post_login(
            client,
            username=username,
            password="wrong-password",
            captcha_id=captcha_id,
            captcha_code=captcha_code,
        )
        assert resp.status_code in {401, 429}

    captcha_id, captcha_code = await _fetch_captcha(client)
    locked = await _post_login(
        client,
        username=username,
        password="wrong-password",
        captcha_id=captcha_id,
        captcha_code=captcha_code,
    )
    assert locked.status_code == 429

    await asyncio.sleep(1.2)

    captcha_id, captcha_code = await _fetch_captcha(client)
    after = await _post_login(
        client,
        username=username,
        password="wrong-password",
        captcha_id=captcha_id,
        captcha_code=captcha_code,
    )
    assert after.status_code == 401
    assert after.json()["business_code"] == "INVALID_CREDENTIALS"

    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_login_fail_max_configurable(monkeypatch, client: AsyncClient):
    monkeypatch.setenv("LOGIN_FAIL_MAX", "2")
    monkeypatch.setenv("LOGIN_LOCK_SECONDS", "60")
    get_settings.cache_clear()

    username = _unique_username("max2")
    for attempt in range(2):
        captcha_id, captcha_code = await _fetch_captcha(client)
        resp = await _post_login(
            client,
            username=username,
            password="wrong-password",
            captcha_id=captcha_id,
            captcha_code=captcha_code,
        )
        if attempt == 0:
            assert resp.status_code == 401
        else:
            assert resp.status_code == 429
            assert resp.json()["business_code"] == "ACCOUNT_LOCKED"

    get_settings.cache_clear()


# ---------------------------------------------------------------------------
# 注册 / 忘记密码验证码边界（不计入登录锁定）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_requires_captcha(client: AsyncClient):
    resp = await client.post(
        f"{PREFIX}/auth/register",
        json={"username": _unique_username("reg"), "password": "secret12"},
    )
    assert resp.status_code == 400
    assert resp.json()["business_code"] == "CAPTCHA_REQUIRED"


@pytest.mark.asyncio
async def test_register_duplicate_username(client: AsyncClient):
    captcha_id, code = await _fetch_captcha(client)
    resp = await client.post(
        f"{PREFIX}/auth/register",
        json={
            "username": "tc_worker",
            "real_name": "重复用户",
            "department": "检修部",
            "requested_role": "maintainer",
            "password": "secret123",
            "confirm_password": "secret123",
            "captchaId": captcha_id,
            "captchaCode": code,
        },
    )
    assert resp.status_code == 409
    assert resp.json()["business_code"] == "DUPLICATE_ACCOUNT"


@pytest.mark.asyncio
async def test_register_short_username_and_password(client: AsyncClient):
    captcha_id, code = await _fetch_captcha(client)
    short_user = await client.post(
        f"{PREFIX}/auth/register",
        json={
            "username": "ab",
            "real_name": "短用户名",
            "department": "检修部",
            "requested_role": "maintainer",
            "password": "secret123",
            "confirm_password": "secret123",
            "captchaId": captcha_id,
            "captchaCode": code,
        },
    )
    assert short_user.status_code == 400
    assert short_user.json()["business_code"] == "INVALID_USERNAME"

    captcha_id2, code2 = await _fetch_captcha(client)
    short_pwd = await client.post(
        f"{PREFIX}/auth/register",
        json={
            "username": _unique_username("shortpwd"),
            "real_name": "短密码",
            "department": "检修部",
            "requested_role": "maintainer",
            "password": "12345",
            "confirm_password": "12345",
            "captchaId": captcha_id2,
            "captchaCode": code2,
        },
    )
    assert short_pwd.status_code == 400
    assert short_pwd.json()["business_code"] == "INVALID_PASSWORD"


@pytest.mark.asyncio
async def test_password_reset_request_requires_account_and_hides_unknown_user(client: AsyncClient):
    captcha_id, code = await _fetch_captcha(client)
    invalid = await client.post(
        f"{PREFIX}/auth/password-reset/request",
        json={
            "account": "",
            "captchaId": captcha_id,
            "captchaCode": code,
        },
    )
    assert invalid.status_code == 400
    assert invalid.json()["business_code"] == "INVALID_ACCOUNT"

    captcha_id2, code2 = await _fetch_captcha(client)
    missing = await client.post(
        f"{PREFIX}/auth/password-reset/request",
        json={
            "account": _unique_username("nouser"),
            "captchaId": captcha_id2,
            "captchaCode": code2,
        },
    )
    assert missing.status_code == 200
    assert missing.json()["data"]["message"] == "如果账号存在，系统将发送重置验证码。"


@pytest.mark.asyncio
async def test_forgot_password_invalid_captcha_does_not_lock_login(client: AsyncClient):
    """注册/找回密码的验证码错误不计入登录失败锁定。"""
    username = _unique_username("forgot_no_lock")
    for _ in range(6):
        cid, _ = await _fetch_captcha(client)
        await client.post(
            f"{PREFIX}/auth/password-reset/request",
            json={
                "account": username,
                "captchaId": cid,
                "captchaCode": "ZZZZ",
            },
        )

    login_captcha_id, login_code = await _fetch_captcha(client)
    login = await _post_login(
        client,
        username="tc_worker",
        password="testpass",
        captcha_id=login_captcha_id,
        captcha_code=login_code,
    )
    assert login.status_code == 200
