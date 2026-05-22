"""Phase 28: replanning policy and task closure gate."""
from types import SimpleNamespace

import pytest

from app.modules.assistant.application.graph_state import CritiqueArtifact, GraphState
from app.modules.assistant.application.replan_policy import ReplanPolicy
from app.modules.tasks.application.task_service import MaintenanceTaskService


class _FakeResult:
    def __init__(self, task):
        self._task = task

    def scalar_one_or_none(self):
        return self._task


class _FakeSession:
    def __init__(self, task):
        self.task = task
        self.committed = False

    async def execute(self, _stmt):
        return _FakeResult(self.task)

    async def commit(self):
        self.committed = True

    async def rollback(self):
        raise AssertionError("rollback should not be called")


def _build_task(status: str = "in_progress"):
    return SimpleNamespace(
        id=42,
        status=status,
        execution_timeline=[],
        steps=[
            SimpleNamespace(status="pending", completed_at=None),
            SimpleNamespace(status="in_progress", completed_at=None),
        ],
    )


def test_replan_policy_routes_evidence_gap_back_to_diagnosis():
    state = GraphState.new(run_id="run-4", request_context={"query": "异响"})
    state.record_critique(
        CritiqueArtifact(
            stage_name="review",
            verdict="revise",
            target_stage="diagnosis",
            summary="证据不足",
            issues=["缺少稳定证据引用"],
        )
    )

    decision = ReplanPolicy(max_replans=2).decide(state)

    assert decision["action"] == "rerun_stage"
    assert decision["target_stage"] == "diagnosis"


@pytest.mark.asyncio
async def test_finalize_task_after_agent_pipeline_uses_final_resolution():
    task = _build_task()
    session = _FakeSession(task)
    service = MaintenanceTaskService(session)

    await service.finalize_task_after_agent_pipeline(
        42,
        {
            "final_resolution": {
                "status": "completed",
                "manual_review_required": False,
                "reason": "revision_completed",
            }
        },
    )

    assert session.committed is True
    assert task.status == "completed"
    assert all(step.status == "completed" for step in task.steps)
    assert "final_resolution.status=completed" in task.execution_timeline[-1]["detail"]
