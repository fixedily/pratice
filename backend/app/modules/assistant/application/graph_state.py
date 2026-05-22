"""Runtime graph state for agent orchestration."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from app.modules.assistant.application.runtime_types import AgentStageName

TraceEventType = Literal[
    "stage_completed",
    "critique_created",
    "revision_requested",
    "replan_applied",
    "terminated",
]


@dataclass(slots=True)
class StageArtifact:
    """Normalized stage output kept in the graph runtime."""

    stage_name: AgentStageName
    status: str
    summary: str
    payload: dict[str, Any] = field(default_factory=dict)
    iteration: int = 1
    citations: list[str] = field(default_factory=list)

    def as_trace(self) -> dict[str, Any]:
        return {
            "event_type": "stage_completed",
            "stage_name": self.stage_name,
            "status": self.status,
            "summary": self.summary,
            "iteration": self.iteration,
            "citations": list(self.citations),
        }


@dataclass(slots=True)
class CritiqueArtifact:
    """Structured critique emitted by review-like stages."""

    stage_name: AgentStageName
    verdict: Literal["pass", "revise", "manual_review"]
    target_stage: AgentStageName | None
    summary: str
    issues: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "stage_name": self.stage_name,
            "verdict": self.verdict,
            "target_stage": self.target_stage,
            "summary": self.summary,
            "issues": list(self.issues),
        }


@dataclass(slots=True)
class RevisionRequest:
    """Instruction to rerun a prior stage after critique."""

    target_stage: AgentStageName
    reason: str
    revision_round: int
    issues: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "target_stage": self.target_stage,
            "reason": self.reason,
            "revision_round": self.revision_round,
            "issues": list(self.issues),
        }


@dataclass(slots=True)
class ReplanDecision:
    """Decision emitted by the replanner."""

    action: str
    target_stage: AgentStageName | None
    reason: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "action": self.action,
            "target_stage": self.target_stage,
            "reason": self.reason,
        }


@dataclass(slots=True)
class TerminationDecision:
    """Final graph outcome."""

    status: str
    reason: str
    manual_review_required: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "reason": self.reason,
            "manual_review_required": self.manual_review_required,
        }


@dataclass(slots=True)
class ExecutionBudget:
    """Execution limits used to stop self-looping."""

    max_rounds: int = 3
    max_replans: int = 2
    rounds_used: int = 0
    replans_used: int = 0

    def consume_round(self) -> None:
        self.rounds_used += 1

    def consume_replan(self) -> None:
        self.replans_used += 1


@dataclass(slots=True)
class GraphState:
    """Mutable runtime state for an agent graph execution."""

    run_id: str
    request_context: dict[str, Any]
    trace: list[dict[str, Any]] = field(default_factory=list)
    stages: dict[str, StageArtifact] = field(default_factory=dict)
    critiques: list[CritiqueArtifact] = field(default_factory=list)
    revision_requests: list[RevisionRequest] = field(default_factory=list)
    replans: list[dict[str, Any]] = field(default_factory=list)
    current_plan: list[dict[str, Any]] = field(default_factory=list)
    termination: TerminationDecision | None = None
    revision_rounds: int = 0
    budget: ExecutionBudget = field(default_factory=ExecutionBudget)

    @classmethod
    def new(cls, *, run_id: str, request_context: dict[str, Any]) -> "GraphState":
        return cls(run_id=run_id, request_context=request_context)

    def record_stage(self, artifact: StageArtifact) -> None:
        self.stages[artifact.stage_name] = artifact
        self.trace.append(artifact.as_trace())

    def record_critique(self, critique: CritiqueArtifact) -> None:
        self.critiques.append(critique)
        if critique.verdict == "revise":
            self.revision_rounds += 1
        self.trace.append(
            {
                "event_type": "critique_created",
                "stage_name": critique.stage_name,
                "target_stage": critique.target_stage,
                "summary": critique.summary,
                "issues": list(critique.issues),
            }
        )

    def record_revision_request(self, request: RevisionRequest) -> None:
        self.revision_requests.append(request)
        self.trace.append(
            {
                "event_type": "revision_requested",
                "target_stage": request.target_stage,
                "summary": request.reason,
                "issues": list(request.issues),
                "revision_round": request.revision_round,
            }
        )

    def record_replan(self, decision: ReplanDecision) -> None:
        payload = decision.as_dict()
        self.replans.append(payload)
        self.trace.append({"event_type": "replan_applied", **payload})

    def record_termination(self, decision: TerminationDecision) -> None:
        self.termination = decision
        self.trace.append({"event_type": "terminated", **decision.as_dict()})
