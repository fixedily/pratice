from types import SimpleNamespace

import pytest

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


@pytest.mark.asyncio
async def test_finalize_task_after_agent_pipeline_completes_task_when_planning_and_review_pass():
    task = _build_task()
    session = _FakeSession(task)
    service = MaintenanceTaskService(session)

    await service.finalize_task_after_agent_pipeline(
        42,
        {
            "resolved_run_plan": [
                {"agent_name": "planning", "status": "completed"},
                {"agent_name": "review", "status": "completed"},
            ]
        },
    )

    assert session.committed is True
    assert task.status == "completed"
    assert all(step.status == "completed" for step in task.steps)
    assert task.execution_timeline[-1]["code"] == "AGENT_PIPELINE_COMPLETED"
    assert task.execution_timeline[-1]["task_finalized"] is True


@pytest.mark.asyncio
async def test_finalize_task_after_agent_pipeline_keeps_task_in_progress_when_planning_or_review_missing():
    task = _build_task()
    session = _FakeSession(task)
    service = MaintenanceTaskService(session)

    await service.finalize_task_after_agent_pipeline(
        42,
        {
            "resolved_run_plan": [
                {"agent_name": "planning", "status": "skipped"},
                {"agent_name": "review", "status": "degraded"},
            ]
        },
    )

    assert session.committed is True
    assert task.status == "in_progress"
    assert [step.status for step in task.steps] == ["pending", "in_progress"]
    assert "planning.status=skipped" in task.execution_timeline[-1]["detail"]
    assert task.execution_timeline[-1]["task_finalized"] is False
