"""Runtime controls for assistant stage execution."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from time import perf_counter
from typing import Any, cast

from app.core.metrics import increment_counter, observe_duration
from app.modules.assistant.application.agent_registry import AgentRegistry
from app.modules.assistant.application.executors.base import StageExecutionContext
from app.modules.assistant.application.graph_state import StageArtifact
from app.modules.assistant.application.runtime_types import AgentStageName


class StageTimeoutError(TimeoutError):
    """Raised when one stage execution attempt exceeds its timeout."""


@dataclass(slots=True)
class StageRunResult:
    artifact: StageArtifact
    status: str
    attempt_count: int
    timeout_ms: int
    fallback_agent: str | None = None
    last_error: str | None = None
    degradation: dict[str, Any] | None = None


class StageRunController:
    """Apply configured timeout, retry, and fallback behavior around executors."""

    async def run(
        self,
        *,
        stage_name: AgentStageName,
        context: StageExecutionContext,
        registry: AgentRegistry,
    ) -> StageRunResult:
        started_at = perf_counter()
        stage_config = context.resolved_config.agents[stage_name]
        timeout_ms = max(1, int(stage_config.timeout_ms))
        max_retries = max(0, int(stage_config.max_retries))
        last_error: Exception | None = None

        for attempt_index in range(max_retries + 1):
            try:
                artifact = await self._run_with_timeout(
                    registry.get(stage_name),
                    context,
                    timeout_ms=timeout_ms,
                    stage_name=stage_name,
                )
                result = StageRunResult(
                    artifact=artifact,
                    status="completed",
                    attempt_count=attempt_index + 1,
                    timeout_ms=timeout_ms,
                    last_error=str(last_error) if last_error is not None else None,
                )
                await self._record_metrics(
                    stage_name=stage_name,
                    status=result.status,
                    fallback_agent=None,
                    duration_ms=(perf_counter() - started_at) * 1000,
                )
                return result
            except Exception as exc:
                last_error = exc
                if isinstance(exc, StageTimeoutError):
                    await self._emit(
                        context,
                        "agent_timeout",
                        {
                            "agent_name": stage_name,
                            "attempt": attempt_index + 1,
                            "timeout_ms": timeout_ms,
                            "error": str(exc),
                        },
                    )
                if attempt_index < max_retries:
                    await self._emit(
                        context,
                        "agent_retry",
                        {
                            "agent_name": stage_name,
                            "attempt": attempt_index + 2,
                            "max_attempts": max_retries + 1,
                            "reason": str(exc),
                        },
                    )
                    continue
                break

        fallback_name = self._resolve_fallback(stage_name, context, registry)
        if fallback_name is not None:
            await self._emit(
                context,
                "fallback_agent_start",
                {"agent_name": stage_name, "fallback_agent": fallback_name, "reason": str(last_error)},
            )
            try:
                fallback_config = context.resolved_config.agents[fallback_name]
                fallback_timeout_ms = max(1, int(fallback_config.timeout_ms))
                artifact = await self._run_with_timeout(
                    registry.get(fallback_name),
                    context,
                    timeout_ms=fallback_timeout_ms,
                    stage_name=fallback_name,
                )
                await self._emit(
                    context,
                    "fallback_agent_finish",
                    {
                        "agent_name": stage_name,
                        "fallback_agent": fallback_name,
                        "summary": artifact.summary,
                    },
                )
                result = StageRunResult(
                    artifact=artifact,
                    status="degraded",
                    attempt_count=max_retries + 1,
                    timeout_ms=timeout_ms,
                    fallback_agent=fallback_name,
                    last_error=str(last_error) if last_error is not None else None,
                    degradation={
                        "agent_name": stage_name,
                        "strategy": "fallback_agent",
                        "reason": str(last_error),
                        "fallback": fallback_name,
                        "attempt_count": max_retries + 1,
                        "timeout_ms": timeout_ms,
                        "fallback_agent": fallback_name,
                        "last_error": str(last_error),
                    },
                )
                await self._record_metrics(
                    stage_name=stage_name,
                    status=result.status,
                    fallback_agent=fallback_name,
                    duration_ms=(perf_counter() - started_at) * 1000,
                )
                return result
            except Exception as fallback_exc:
                await self._emit(
                    context,
                    "fallback_agent_finish",
                    {
                        "agent_name": stage_name,
                        "fallback_agent": fallback_name,
                        "status": "failed",
                        "error": str(fallback_exc),
                    },
                )
                last_error = fallback_exc

        if last_error is None:
            raise RuntimeError(f"{stage_name} stage failed without an error")
        await self._record_metrics(
            stage_name=stage_name,
            status="failed",
            fallback_agent=None,
            duration_ms=(perf_counter() - started_at) * 1000,
        )
        await increment_counter(
            "agent_stage_failures_total",
            agent_name=stage_name,
            error_type=type(last_error).__name__,
        )
        raise last_error

    async def _run_with_timeout(
        self,
        executor,
        context: StageExecutionContext,
        *,
        timeout_ms: int,
        stage_name: AgentStageName,
    ) -> StageArtifact:
        try:
            return await asyncio.wait_for(executor.run(context), timeout=timeout_ms / 1000)
        except asyncio.TimeoutError as exc:
            raise StageTimeoutError(f"{stage_name} timed out after {timeout_ms}ms") from exc

    def _resolve_fallback(
        self,
        stage_name: AgentStageName,
        context: StageExecutionContext,
        registry: AgentRegistry,
    ) -> AgentStageName | None:
        fallback = context.resolved_config.agents[stage_name].fallback_agent
        if not fallback or fallback == stage_name:
            return None
        if fallback not in registry.executors:
            return None
        fallback_name = cast(AgentStageName, fallback)
        if not context.resolved_config.agents[fallback_name].enabled:
            return None
        return fallback_name

    async def _emit(self, context: StageExecutionContext, event: str, data: dict[str, Any]) -> None:
        if context.emit is not None:
            await context.emit(event, data)

    async def _record_metrics(
        self,
        *,
        stage_name: AgentStageName,
        status: str,
        fallback_agent: str | None,
        duration_ms: float,
    ) -> None:
        await increment_counter(
            "agent_stage_runs_total",
            agent_name=stage_name,
            status=status,
            fallback_agent=fallback_agent,
        )
        await observe_duration(
            "agent_stage_duration_ms",
            duration_ms,
            agent_name=stage_name,
            status=status,
            fallback_agent=fallback_agent,
        )
