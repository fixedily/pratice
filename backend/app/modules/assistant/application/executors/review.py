"""Review-stage executor."""
from __future__ import annotations

from app.modules.assistant.application.executors.base import NoopStageExecutor


class ReviewStageExecutor(NoopStageExecutor):
    def __init__(self) -> None:
        super().__init__("review", "审核阶段已完成")
