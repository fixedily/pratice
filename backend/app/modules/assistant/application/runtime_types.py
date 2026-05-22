"""Typed runtime configuration models for the assistant pipeline."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

AgentStageName = Literal["perception", "diagnosis", "planning", "review", "knowledge"]

DEFAULT_AGENT_STAGE_ORDER: tuple[AgentStageName, ...] = (
    "perception",
    "diagnosis",
    "planning",
    "review",
    "knowledge",
)

DEFAULT_PLANNING_TRIGGER_RULES: tuple[str, ...] = (
    "procedural_query",
    "maintenance_task_present",
    "high_risk_followup",
)


@dataclass(slots=True)
class PipelineConfig:
    mode: str = "conditional"
    default_order: list[AgentStageName] = field(default_factory=lambda: list(DEFAULT_AGENT_STAGE_ORDER))
    fail_strategy: str = "degrade"
    review_gate: bool = True
    knowledge_writeback: str = "suggest_only"


@dataclass(slots=True)
class RoutingConfig:
    force_planning_on_procedure: bool = True
    force_review_on_high_risk: bool = True
    force_review_on_low_confidence: bool = True
    skip_perception_without_multimodal: bool = True
    skip_knowledge_when_selected_chunks_locked: bool = False


@dataclass(slots=True)
class AgentStageConfig:
    agent_name: AgentStageName
    enabled: bool = True
    model_provider: str = "zhipu"
    model_name: str = "glm-4.5"
    prompt_version: str = "v1"
    timeout_ms: int = 45000
    max_retries: int = 1
    toolset: list[str] = field(default_factory=list)
    fallback_agent: str | None = None


@dataclass(slots=True)
class ReviewConfig:
    low_confidence_threshold: float = 0.72
    max_revision_rounds: int = 1


@dataclass(slots=True)
class PlanningConfig:
    bind_task_execution: bool = True
    trigger_rules: list[str] = field(default_factory=lambda: list(DEFAULT_PLANNING_TRIGGER_RULES))


@dataclass(slots=True)
class GraphConfig:
    max_rounds: int = 3
    max_replans: int = 2
    prompt_version: str = "v1"


@dataclass(slots=True)
class ResolvedAgentConfig:
    pipeline: PipelineConfig = field(default_factory=PipelineConfig)
    routing: RoutingConfig = field(default_factory=RoutingConfig)
    review: ReviewConfig = field(default_factory=ReviewConfig)
    planning: PlanningConfig = field(default_factory=PlanningConfig)
    graph: GraphConfig = field(default_factory=GraphConfig)
    agents: dict[AgentStageName, AgentStageConfig] = field(
        default_factory=lambda: {
            agent_name: AgentStageConfig(agent_name=agent_name)
            for agent_name in DEFAULT_AGENT_STAGE_ORDER
        }
    )


@dataclass(slots=True)
class RunPlanStep:
    agent_name: AgentStageName
    title: str
    should_run: bool
    forced: bool = False
    reason: str = "default_order"
    skip_reason: str | None = None


@dataclass(slots=True)
class ResolvedRunPlan:
    mode: str
    steps: list[RunPlanStep]
