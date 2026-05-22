"""Phase 25: graph runtime state and response contract."""
from datetime import datetime, timezone

from app.modules.assistant.application.graph_state import CritiqueArtifact, GraphState, StageArtifact
from app.schemas.agents import AgentAssistResponse


def test_graph_state_records_trace_and_response_fields():
    state = GraphState.new(
        run_id="run-graph-1",
        request_context={"query": "压缩机异常振动", "equipment_type": "压缩机"},
    )
    state.record_stage(
        StageArtifact(
            stage_name="diagnosis",
            status="completed",
            summary="生成第一版诊断初稿",
            payload={"confidence": 0.61},
            iteration=1,
        )
    )
    state.record_critique(
        CritiqueArtifact(
            stage_name="review",
            verdict="revise",
            target_stage="diagnosis",
            summary="证据不足，需要补充诊断依据",
            issues=["缺少稳定证据引用"],
        )
    )

    response = AgentAssistResponse(
        run_id="run-graph-1",
        status="running",
        summary="诊断修订中",
        graph_trace=state.trace,
        critiques=[item.as_dict() for item in state.critiques],
        replans=[],
        current_plan=[{"stage_name": "diagnosis", "iteration": 1, "reason": "default"}],
        revision_rounds=1,
        termination_reason=None,
        created_at=datetime.now(timezone.utc),
    )

    assert response.graph_trace[0].stage_name == "diagnosis"
    assert response.critiques[0].verdict == "revise"
    assert response.revision_rounds == 1
