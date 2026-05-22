"""Build an initial conditional run plan for assistant requests."""
from __future__ import annotations

from app.modules.assistant.application.runtime_types import ResolvedAgentConfig, ResolvedRunPlan, RunPlanStep
from app.schemas.agents import AgentAssistRequest


class PipelinePlanner:
    """Derive the initial pipeline run plan from request context and config."""

    STAGE_TITLES = {
        "perception": "感知 Agent",
        "diagnosis": "诊断 Agent",
        "planning": "规划 Agent",
        "review": "审核 Agent",
        "knowledge": "知识库 Agent",
    }

    PROCEDURAL_TOKENS = ("步骤", "如何", "怎么", "拆卸", "安装", "更换")

    def plan(self, request: AgentAssistRequest, config: ResolvedAgentConfig) -> ResolvedRunPlan:
        query_text = (request.query or "").strip()
        is_multimodal = bool(request.image_base64 or request.attachment_ids)
        is_procedural = any(token in query_text for token in self.PROCEDURAL_TOKENS)
        has_locked_chunks = bool(request.selected_chunk_ids)
        has_task_binding = request.maintenance_task_id is not None
        is_high_risk_followup = request.priority in {"high", "urgent"}

        steps: list[RunPlanStep] = []
        for stage_name in config.pipeline.default_order:
            stage_config = config.agents[stage_name]
            title = self.STAGE_TITLES[stage_name]

            if not stage_config.enabled:
                steps.append(
                    RunPlanStep(
                        agent_name=stage_name,
                        title=title,
                        should_run=False,
                        reason="config_disabled",
                        skip_reason="config_disabled",
                    )
                )
                continue

            if stage_name == "perception" and config.routing.skip_perception_without_multimodal and not is_multimodal:
                steps.append(
                    RunPlanStep(
                        agent_name=stage_name,
                        title=title,
                        should_run=False,
                        reason="routing_rule",
                        skip_reason="no_multimodal_input",
                    )
                )
                continue

            if stage_name == "knowledge" and config.routing.skip_knowledge_when_selected_chunks_locked and has_locked_chunks:
                steps.append(
                    RunPlanStep(
                        agent_name=stage_name,
                        title=title,
                        should_run=False,
                        reason="routing_rule",
                        skip_reason="selected_chunks_locked",
                    )
                )
                continue

            forced = False
            reason = "default_order"
            if (
                stage_name == "planning"
                and config.routing.force_planning_on_procedure
                and "procedural_query" in config.planning.trigger_rules
                and is_procedural
            ):
                forced = True
                reason = "procedural_query"
            elif (
                stage_name == "planning"
                and "maintenance_task_present" in config.planning.trigger_rules
                and has_task_binding
            ):
                forced = True
                reason = "maintenance_task_present"
            elif (
                stage_name == "planning"
                and "high_risk_followup" in config.planning.trigger_rules
                and is_high_risk_followup
            ):
                forced = True
                reason = "high_risk_followup"
            elif stage_name == "review" and config.pipeline.review_gate:
                reason = "review_gate_enabled"

            steps.append(
                RunPlanStep(
                    agent_name=stage_name,
                    title=title,
                    should_run=True,
                    forced=forced,
                    reason=reason,
                )
            )

        return ResolvedRunPlan(mode=config.pipeline.mode, steps=steps)
