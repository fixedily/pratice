"""Registry for named assistant pipeline stage executors."""
from __future__ import annotations

from app.modules.assistant.application.executors.base import StageExecutor
from app.modules.assistant.application.runtime_types import AgentStageName


class AgentRegistry:
    """Resolve stage names to concrete executor callables."""

    def __init__(self, executors: dict[AgentStageName, StageExecutor]):
        self.executors = executors

    def get(self, agent_name: AgentStageName) -> StageExecutor:
        return self.executors[agent_name]
