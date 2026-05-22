"""Planning-stage executor."""
from __future__ import annotations

from app.modules.assistant.application.executors.base import NoopStageExecutor


class PlanningStageExecutor(NoopStageExecutor):
    def __init__(self) -> None:
        super().__init__("planning", "规划阶段已完成")
