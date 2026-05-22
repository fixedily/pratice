from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import get_session
from app.main import app


@pytest.fixture(autouse=True)
def override_db_session():
    async def _override_get_session():
        yield SimpleNamespace()

    app.dependency_overrides[get_session] = _override_get_session
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_session, None)


@pytest.mark.asyncio
async def test_agent_assist_endpoint_returns_run_plan_and_runtime_status():
    mocked_payload = {
        "run_id": "agent-run-conditional-1",
        "status": "completed",
        "summary": "条件分支编排已完成。",
        "resolved_run_plan": [
            {"agent_name": "perception", "title": "感知 Agent", "status": "skipped", "reason": "routing_rule"},
            {"agent_name": "diagnosis", "title": "诊断 Agent", "status": "completed", "reason": "default_order"},
            {"agent_name": "planning", "title": "规划 Agent", "status": "completed", "reason": "procedural_query"},
        ],
        "degradation_trace": [
            {
                "agent_name": "knowledge",
                "strategy": "non_blocking_skip",
                "reason": "writeback_disabled",
                "fallback": "skip",
            }
        ],
        "agent_runtime_status": [
            {
                "agent_name": "diagnosis",
                "status": "completed",
                "summary": "已生成诊断报告",
                "started_at": "2026-05-17T10:00:00Z",
                "finished_at": "2026-05-17T10:00:05Z",
            },
            {
                "agent_name": "planning",
                "status": "completed",
                "summary": "已生成任务步骤",
                "started_at": "2026-05-17T10:00:05Z",
                "finished_at": "2026-05-17T10:00:06Z",
            },
        ],
        "request_context": None,
        "execution_brief": {
            "status": "ready",
            "decision": "可进入工单生成",
            "recommended_path": "标准检修流程",
            "next_actions": [],
        },
        "effective_query": "拆卸气缸头步骤",
        "effective_keywords": [],
        "image_analysis": None,
        "grounded": True,
        "coverage_warnings": [],
        "reasoning_chain": None,
        "knowledge_results": [],
        "related_cases": [],
        "task_plan_preview": [],
        "risk_findings": [],
        "case_suggestions": [],
        "agents": [],
        "tool_calls": [],
        "created_at": datetime.now(timezone.utc),
    }

    with patch("app.modules.assistant.router.AgentOrchestrationService.assist", new=AsyncMock(return_value=mocked_payload)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/agents/assist",
                json={"query": "拆卸气缸头步骤", "equipment_type": "摩托车发动机"},
            )

    assert response.status_code == 200
    payload = response.json()
    assert payload["resolved_run_plan"][0]["agent_name"] == "perception"
    assert payload["resolved_run_plan"][0]["status"] == "skipped"
    assert payload["degradation_trace"][0]["agent_name"] == "knowledge"
    assert payload["agent_runtime_status"][1]["agent_name"] == "planning"


@pytest.mark.asyncio
async def test_agent_assist_stream_emits_agent_level_events():
    async def fake_assist_stream(self, request, emit):
        await emit({"event": "agent_start", "data": {"agent_name": "diagnosis", "title": "诊断 Agent"}})
        await emit({"event": "agent_finish", "data": {"agent_name": "diagnosis", "summary": "已生成诊断报告"}})
        await emit({"event": "agent_skipped", "data": {"agent_name": "review", "reason": "low_risk"}})
        await emit({"event": "degradation_applied", "data": {"agent_name": "knowledge", "fallback": "skip"}})
        await emit({"event": "payload", "data": {"run_id": "agent-run-stream-conditional"}})
        return {"run_id": "agent-run-stream-conditional"}

    with patch("app.modules.assistant.router.AgentOrchestrationService.assist_stream", new=fake_assist_stream):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            async with client.stream(
                "GET",
                "/api/v1/agents/assist/stream",
                params={"query": "压缩机异常振动", "equipment_type": "压缩机"},
            ) as response:
                events = []
                async for line in response.aiter_lines():
                    if line.startswith("event:"):
                        events.append(line.removeprefix("event:").strip())

    assert "agent_start" in events
    assert "agent_finish" in events
    assert "agent_skipped" in events
    assert "degradation_applied" in events
    assert events[-1] == "done"
