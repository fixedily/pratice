"""Phase 26: graph executor registry skeleton."""
import pytest

from app.modules.assistant.application.agent_registry import AgentRegistry
from app.modules.assistant.application.executors.base import StageExecutor
from app.modules.assistant.application.graph_state import GraphState, StageArtifact


class FakeDiagnosisExecutor(StageExecutor):
    stage_name = "diagnosis"

    async def run(self, state: GraphState, *, emit=None) -> StageArtifact:
        return StageArtifact(stage_name="diagnosis", status="completed", summary="ok", payload={})


@pytest.mark.asyncio
async def test_registry_returns_executor_instances():
    registry = AgentRegistry({"diagnosis": FakeDiagnosisExecutor()})
    executor = registry.get("diagnosis")

    result = await executor.run(GraphState.new(run_id="run-2", request_context={}))

    assert executor.stage_name == "diagnosis"
    assert result.summary == "ok"
