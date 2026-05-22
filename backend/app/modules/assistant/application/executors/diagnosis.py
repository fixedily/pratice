"""Diagnosis-stage executor."""
from __future__ import annotations

from app.modules.assistant.application.executors.base import NoopStageExecutor


class DiagnosisStageExecutor(NoopStageExecutor):
    def __init__(self) -> None:
        super().__init__("diagnosis", "诊断阶段已完成")
