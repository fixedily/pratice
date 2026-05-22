"""Structured contracts shared by stage executors."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class StageExecutionContext(BaseModel):
    """Normalized context delivered into a stage executor."""

    request_context: dict[str, Any] = Field(default_factory=dict)
    shared_state: dict[str, Any] = Field(default_factory=dict)


class StageExecutionResult(BaseModel):
    """Minimal structured payload returned from a stage executor."""

    stage_name: str
    status: str = "completed"
    summary: str
    payload: dict[str, Any] = Field(default_factory=dict)
    citations: list[str] = Field(default_factory=list)


class ReviewCritiquePayload(BaseModel):
    """Review-stage critique contract used by revision loops."""

    verdict: str = "pass"
    target_stage: str | None = None
    summary: str
    issues: list[str] = Field(default_factory=list)


class ReplanDecisionPayload(BaseModel):
    """Replanner output contract."""

    action: str
    target_stage: str | None = None
    reason: str
