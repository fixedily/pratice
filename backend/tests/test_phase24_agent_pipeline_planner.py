import pytest

from app.modules.assistant.application.config_resolver import AgentConfigResolver
from app.modules.assistant.application.pipeline_planner import PipelinePlanner
from app.schemas.agents import AgentAssistRequest


def test_agent_config_resolver_parses_boolean_json_and_number_fields():
    resolved = AgentConfigResolver.parse_map(
        {
            "agent.pipeline.mode": "conditional",
            "agent.pipeline.default_order": "[\"perception\", \"diagnosis\", \"planning\", \"review\", \"knowledge\"]",
            "agent.pipeline.review_gate": "true",
            "agent.routing.skip_perception_without_multimodal": "true",
            "agent.review.low_confidence_threshold": "0.72",
            "agent.planning.trigger_rules": "[\"procedural_query\", \"maintenance_task_present\"]",
            "agent.planning.enabled": "true",
            "agent.planning.toolset": "[\"task_writeback\", \"safety_check\"]",
            "agent.planning.timeout_ms": "60000",
        }
    )

    assert resolved.pipeline.mode == "conditional"
    assert resolved.pipeline.default_order == ["perception", "diagnosis", "planning", "review", "knowledge"]
    assert resolved.pipeline.review_gate is True
    assert resolved.routing.skip_perception_without_multimodal is True
    assert resolved.review.low_confidence_threshold == pytest.approx(0.72)
    assert resolved.agents["planning"].toolset == ["task_writeback", "safety_check"]
    assert resolved.agents["planning"].timeout_ms == 60000


def test_pipeline_planner_forces_planning_for_procedural_query():
    resolved = AgentConfigResolver.parse_map({})
    request = AgentAssistRequest(
        query="拆卸气缸头步骤",
        equipment_type="摩托车发动机",
        maintenance_level="standard",
    )

    run_plan = PipelinePlanner().plan(request, resolved)
    planning_step = next(step for step in run_plan.steps if step.agent_name == "planning")

    assert planning_step.should_run is True
    assert planning_step.forced is True
    assert planning_step.reason == "procedural_query"


def test_pipeline_planner_skips_perception_without_multimodal_input():
    resolved = AgentConfigResolver.parse_map({"agent.routing.skip_perception_without_multimodal": "true"})
    request = AgentAssistRequest(
        query="压缩机异常振动",
        equipment_type="压缩机",
        maintenance_level="standard",
    )

    run_plan = PipelinePlanner().plan(request, resolved)
    perception_step = next(step for step in run_plan.steps if step.agent_name == "perception")

    assert perception_step.should_run is False
    assert perception_step.skip_reason == "no_multimodal_input"
