"""Base interfaces for graph stage executors."""
from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from typing import Any

from app.modules.assistant.application.graph_state import GraphState, StageArtifact
from app.modules.assistant.application.runtime_types import AgentStageName

EmitCallback = Callable[[dict[str, Any]], Awaitable[None]]


class StageExecutor(ABC):
    """Abstract stage executor for graph-mode orchestration."""

    stage_name: AgentStageName

    @abstractmethod
    async def run(
        self,
        state: GraphState,
        *,
        emit: EmitCallback | None = None,
    ) -> StageArtifact:
        """Execute a stage and return a normalized artifact."""


class NoopStageExecutor(StageExecutor):
    """Fallback executor used while graph mode is being wired in."""

    def __init__(self, stage_name: AgentStageName, summary: str):
        self.stage_name = stage_name
        self.summary = summary

    async def run(
        self,
        state: GraphState,
        *,
        emit: EmitCallback | None = None,
    ) -> StageArtifact:
        return StageArtifact(
            stage_name=self.stage_name,
            status="completed",
            summary=self.summary,
            payload={"request_context": dict(state.request_context)},
        )
