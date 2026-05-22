"""Registry for named assistant pipeline stage executors."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from app.modules.assistant.application.executors.base import StageExecutor
from app.modules.assistant.application.runtime_types import AgentStageName

LegacyStageExecutor = Callable[..., Awaitable[dict[str, Any]]]


class AgentRegistry:
    """Resolve stage names to concrete executor callables."""

    def __init__(self, executors: dict[AgentStageName, StageExecutor | LegacyStageExecutor]):
        self.executors = executors

    def get(self, agent_name: AgentStageName) -> StageExecutor | LegacyStageExecutor:
        return self.executors[agent_name]
