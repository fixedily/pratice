"""Phase 26: graph executor registry skeleton."""
import pytest

from app.modules.assistant.application.agent_registry import AgentRegistry
from app.modules.assistant.application.executors.base import StageExecutionContext, StageExecutor
from app.modules.assistant.application.graph_state import StageArtifact
from app.modules.assistant.application.runtime_types import ResolvedAgentConfig
from app.modules.assistant.schemas import AgentAssistRequest


class FakeDiagnosisExecutor(StageExecutor):
    stage_name = "diagnosis"

    async def run(self, context: StageExecutionContext) -> StageArtifact:
        return StageArtifact(
            stage_name="diagnosis",
            status="completed",
            summary=f"ok:{context.request.query}",
            payload={"seen": True},
        )


@pytest.mark.asyncio
async def test_registry_returns_executor_instances():
    registry = AgentRegistry({"diagnosis": FakeDiagnosisExecutor()})
    executor = registry.get("diagnosis")
    context = StageExecutionContext(
        request=AgentAssistRequest(query="pump fault"),
        runtime_state={},
        resolved_config=ResolvedAgentConfig(),
    )

    result = await executor.run(context)

    assert executor.stage_name == "diagnosis"
    assert result.summary == "ok:pump fault"
    assert result.payload == {"seen": True}
