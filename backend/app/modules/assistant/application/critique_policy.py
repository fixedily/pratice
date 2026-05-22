"""Policies for turning review outcomes into critique artifacts."""
from __future__ import annotations

from typing import Any

from app.modules.assistant.application.graph_state import CritiqueArtifact


class CritiquePolicy:
    """Generate structured critique items from diagnosis and review outputs."""

    def build_from_outputs(
        self,
        *,
        diagnosis_structured: dict[str, Any] | None,
        execution_brief: dict[str, Any] | None,
        low_confidence_threshold: float,
    ) -> CritiqueArtifact:
        execution_brief = execution_brief or {}
        diagnosis_structured = diagnosis_structured or {}

        blocking_issues = [str(item) for item in execution_brief.get("blocking_issues") or []]
        if execution_brief.get("authorization_required") or blocking_issues:
            summary = "当前结果仍需人工复核或授权，暂不直接收口。"
            issues = blocking_issues or ["当前工单包含高风险或高优先级操作。"]
            return CritiqueArtifact(
                stage_name="review",
                verdict="manual_review",
                target_stage=None,
                summary=summary,
                issues=issues,
            )

        confidence_raw = diagnosis_structured.get("confidence")
        try:
            confidence = float(confidence_raw or 0)
        except (TypeError, ValueError):
            confidence = 0.0
        if confidence > 1:
            confidence = confidence / 100.0

        if confidence < low_confidence_threshold:
            return CritiqueArtifact(
                stage_name="review",
                verdict="revise",
                target_stage="diagnosis",
                summary="诊断置信度低于阈值，需要补充证据并修订结论。",
                issues=[f"当前置信度约为 {confidence:.2f}，低于阈值 {low_confidence_threshold:.2f}。"],
            )

        return CritiqueArtifact(
            stage_name="review",
            verdict="pass",
            target_stage=None,
            summary="审核通过，当前诊断结果可继续流转。",
            issues=[],
        )
