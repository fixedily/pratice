"""Knowledge-stage executor."""
from __future__ import annotations

from app.modules.assistant.application.executors.base import NoopStageExecutor


class KnowledgeStageExecutor(NoopStageExecutor):
    def __init__(self) -> None:
        super().__init__("knowledge", "知识阶段已完成")
