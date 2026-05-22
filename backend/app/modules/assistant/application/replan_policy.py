"""Policies for routing critique results into replanning actions."""
from __future__ import annotations

from app.modules.assistant.application.graph_state import GraphState


class ReplanPolicy:
    """Decide whether a critique should trigger rerun, manual review, or finish."""

    def __init__(self, *, max_replans: int):
        self.max_replans = max_replans

    def decide(self, state: GraphState) -> dict[str, str | None]:
        latest = state.critiques[-1] if state.critiques else None
        if latest is None:
            return {"action": "finish", "target_stage": None, "reason": "no_critique"}
        if latest.verdict == "manual_review":
            return {"action": "manual_review", "target_stage": None, "reason": "human_gate"}
        if len(state.replans) >= self.max_replans:
            return {"action": "finish", "target_stage": None, "reason": "replan_budget_exhausted"}
        return {
            "action": "rerun_stage",
            "target_stage": latest.target_stage or "diagnosis",
            "reason": "critique_requested_revision",
        }
