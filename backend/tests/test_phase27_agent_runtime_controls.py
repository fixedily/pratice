"""Phase 27: agent stage runtime controls."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.core.metrics import build_metrics_snapshot, reset_metrics
from app.modules.assistant.application.agent_registry import AgentRegistry
from app.modules.assistant.application.executors.base import StageExecutionContext, StageExecutor
from app.modules.assistant.application.graph_state import StageArtifact
from app.modules.assistant.application.runtime_types import ResolvedAgentConfig
from app.modules.assistant.application.stage_run_controller import StageRunController, StageTimeoutError
from app.modules.assistant.schemas import AgentAssistRequest
from app.services.agent_tooling_service import AgentToolingService


class FailingExecutor(StageExecutor):
    stage_name = "diagnosis"

    def __init__(self) -> None:
        self.calls = 0

    async def run(self, context: StageExecutionContext) -> StageArtifact:
        self.calls += 1
        raise RuntimeError("stage failed")


class SlowExecutor(StageExecutor):
    stage_name = "diagnosis"

    def __init__(self) -> None:
        self.calls = 0

    async def run(self, context: StageExecutionContext) -> StageArtifact:
        self.calls += 1
        await asyncio.sleep(0.05)
        return StageArtifact(stage_name=self.stage_name, status="completed", summary="slow ok", payload={})


class PayloadExecutor(StageExecutor):
    def __init__(self, stage_name: str, payload: dict | None = None) -> None:
        self.stage_name = stage_name
        self.payload = payload or {}

    async def run(self, context: StageExecutionContext) -> StageArtifact:
        return StageArtifact(
            stage_name=self.stage_name,
            status="completed",
            summary=f"{self.stage_name} ok",
            payload=dict(self.payload),
        )


def _context(config: ResolvedAgentConfig, events: list[tuple[str, dict]] | None = None) -> StageExecutionContext:
    async def emit(event: str, data: dict) -> None:
        if events is not None:
            events.append((event, data))

    return StageExecutionContext(
        request=AgentAssistRequest(query="泵故障"),
        runtime_state={},
        resolved_config=config,
        emit=emit if events is not None else None,
    )


@pytest.mark.asyncio
async def test_stage_run_controller_retries_failed_executor():
    await reset_metrics()
    config = ResolvedAgentConfig()
    config.agents["diagnosis"].max_retries = 2
    executor = FailingExecutor()
    registry = AgentRegistry({"diagnosis": executor})

    with pytest.raises(RuntimeError, match="stage failed"):
        await StageRunController().run(
            stage_name="diagnosis",
            context=_context(config),
            registry=registry,
        )

    assert executor.calls == 3
    metrics = await build_metrics_snapshot()
    assert any(item["name"] == "agent_stage_failures_total" for item in metrics["counters"])


@pytest.mark.asyncio
async def test_stage_run_controller_times_out_and_retries():
    config = ResolvedAgentConfig()
    config.agents["diagnosis"].timeout_ms = 1
    config.agents["diagnosis"].max_retries = 1
    events: list[tuple[str, dict]] = []
    executor = SlowExecutor()
    registry = AgentRegistry({"diagnosis": executor})

    with pytest.raises(StageTimeoutError):
        await StageRunController().run(
            stage_name="diagnosis",
            context=_context(config, events),
            registry=registry,
        )

    assert executor.calls == 2
    assert [event for event, _ in events] == ["agent_timeout", "agent_retry", "agent_timeout"]


@pytest.mark.asyncio
async def test_stage_run_controller_uses_enabled_fallback_once():
    await reset_metrics()
    config = ResolvedAgentConfig()
    config.agents["diagnosis"].max_retries = 0
    config.agents["diagnosis"].fallback_agent = "knowledge"
    registry = AgentRegistry(
        {
            "diagnosis": FailingExecutor(),
            "knowledge": PayloadExecutor("knowledge", {"case_suggestions": ["沉淀案例"]}),
        }
    )
    events: list[tuple[str, dict]] = []

    result = await StageRunController().run(
        stage_name="diagnosis",
        context=_context(config, events),
        registry=registry,
    )

    assert result.status == "degraded"
    assert result.fallback_agent == "knowledge"
    assert result.artifact.payload == {"case_suggestions": ["沉淀案例"]}
    assert result.degradation is not None
    assert result.degradation["agent_name"] == "diagnosis"
    assert result.degradation["strategy"] == "fallback_agent"
    assert result.degradation["reason"] == "stage failed"
    assert result.degradation["fallback"] == "knowledge"
    assert result.degradation["attempt_count"] == 1
    assert result.degradation["timeout_ms"] == 45000
    assert [event for event, _ in events] == ["fallback_agent_start", "fallback_agent_finish"]
    metrics = await build_metrics_snapshot()
    assert any(
        item["name"] == "agent_stage_runs_total"
        and item["labels"].get("agent_name") == "diagnosis"
        and item["labels"].get("status") == "degraded"
        for item in metrics["counters"]
    )


@pytest.mark.asyncio
async def test_stage_run_controller_ignores_disabled_fallback():
    config = ResolvedAgentConfig()
    config.agents["diagnosis"].fallback_agent = "knowledge"
    config.agents["knowledge"].enabled = False
    registry = AgentRegistry(
        {
            "diagnosis": FailingExecutor(),
            "knowledge": PayloadExecutor("knowledge"),
        }
    )

    with pytest.raises(RuntimeError, match="stage failed"):
        await StageRunController().run(
            stage_name="diagnosis",
            context=_context(config),
            registry=registry,
        )


@pytest.mark.asyncio
async def test_agent_tooling_default_toolset_runs_all_tools():
    service = AgentToolingService(SimpleNamespace())

    result = await service.run_tool_chain(
        request=AgentAssistRequest(query="泵故障"),
        knowledge_refs=[],
        task_preview=[],
        related_cases=[{"id": 1, "title": "泵案例", "match_reason": "同类故障"}],
        toolset=[],
    )

    assert [item["tool_name"] for item in result["tool_calls"]] == [
        "query_device_telemetry",
        "fetch_historical_repairs",
        "validate_safety_preconditions",
        "require_human_authorization",
    ]


@pytest.mark.asyncio
async def test_agent_tooling_filters_to_requested_toolset():
    service = AgentToolingService(SimpleNamespace())

    result = await service.run_tool_chain(
        request=AgentAssistRequest(query="泵故障"),
        knowledge_refs=[],
        task_preview=[],
        related_cases=[],
        toolset=["validate_safety_preconditions"],
    )

    assert [item["tool_name"] for item in result["tool_calls"]] == ["validate_safety_preconditions"]
    assert result["telemetry_call"]["status"] == "skipped"


@pytest.mark.asyncio
async def test_agent_tooling_preserves_fixed_order_and_ignores_unknown_tools(caplog):
    service = AgentToolingService(SimpleNamespace())

    result = await service.run_tool_chain(
        request=AgentAssistRequest(query="泵故障"),
        knowledge_refs=[],
        task_preview=[],
        related_cases=[],
        toolset=["unknown_tool", "validate_safety_preconditions", "query_device_telemetry"],
    )

    assert [item["tool_name"] for item in result["tool_calls"]] == [
        "query_device_telemetry",
        "validate_safety_preconditions",
    ]
    assert "unknown_tools_ignored" in caplog.text
