"""Phase 29: router response mapping for graph payloads."""
from datetime import datetime, timezone

from app.modules.assistant.router import _build_agent_response


def test_build_agent_response_maps_graph_runtime_fields():
    response = _build_agent_response(
        {
            "run_id": "run-9",
            "status": "completed",
            "summary": "ok",
            "graph_trace": [
                {
                    "event_type": "critique_created",
                    "stage_name": "review",
                    "summary": "证据不足",
                    "target_stage": "diagnosis",
                    "issues": ["缺少稳定证据引用"],
                }
            ],
            "critiques": [
                {
                    "stage_name": "review",
                    "verdict": "revise",
                    "target_stage": "diagnosis",
                    "summary": "证据不足",
                    "issues": ["缺少稳定证据引用"],
                }
            ],
            "replans": [{"action": "rerun_stage", "target_stage": "diagnosis", "reason": "critique_requested_revision"}],
            "current_plan": [{"stage_name": "diagnosis", "iteration": 2, "reason": "default", "status": "completed"}],
            "revision_rounds": 1,
            "termination_reason": "revision_completed",
            "final_resolution": {"status": "completed", "reason": "revision_completed", "manual_review_required": False},
            "created_at": datetime.now(timezone.utc),
        }
    )

    assert response.graph_trace[0].event_type == "critique_created"
    assert response.critiques[0].verdict == "revise"
    assert response.replans[0].action == "rerun_stage"
    assert response.current_plan[0].iteration == 2
    assert response.termination_reason == "revision_completed"
