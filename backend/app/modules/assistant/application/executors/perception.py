"""Perception-stage executor."""
from __future__ import annotations

from app.modules.assistant.application.executors.base import NoopStageExecutor


class PerceptionStageExecutor(NoopStageExecutor):
    def __init__(self) -> None:
        super().__init__("perception", "感知阶段已完成")
