"""Resolve persisted assistant runtime config into typed objects."""
from __future__ import annotations

import json
from collections.abc import Mapping

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.maintenance import SystemConfig
from app.modules.assistant.application.runtime_types import (
    DEFAULT_AGENT_STAGE_ORDER,
    DEFAULT_PLANNING_TRIGGER_RULES,
    AgentStageConfig,
    AgentStageName,
    PipelineConfig,
    PlanningConfig,
    ResolvedAgentConfig,
    ReviewConfig,
    RoutingConfig,
)

KNOWN_AGENT_STAGES = set(DEFAULT_AGENT_STAGE_ORDER)
KNOWN_TRIGGER_RULES = set(DEFAULT_PLANNING_TRIGGER_RULES)


class AgentConfigResolver:
    """Load and parse `agent.*` system configs."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def load(self) -> ResolvedAgentConfig:
        if not hasattr(self.session, "execute"):
            return self.parse_map({})
        rows = (
            await self.session.execute(
                select(SystemConfig).where(SystemConfig.key.like("agent.%")).order_by(SystemConfig.key.asc())
            )
        ).scalars().all()
        raw_map = {row.key: row.value for row in rows}
        return self.parse_map(raw_map)

    @staticmethod
    def parse_map(raw_map: Mapping[str, str]) -> ResolvedAgentConfig:
        resolved = ResolvedAgentConfig()

        def _bool(key: str, default: bool) -> bool:
            return str(raw_map.get(key, str(default).lower())).strip().lower() == "true"

        def _text(key: str, default: str) -> str:
            return str(raw_map.get(key, default)).strip() or default

        def _nullable_text(key: str) -> str | None:
            value = str(raw_map.get(key, "")).strip()
            return value or None

        def _int(key: str, default: int) -> int:
            raw = str(raw_map.get(key, default)).strip()
            try:
                return int(raw or default)
            except (TypeError, ValueError):
                return default

        def _float(key: str, default: float) -> float:
            raw = str(raw_map.get(key, default)).strip()
            try:
                return float(raw or default)
            except (TypeError, ValueError):
                return default

        def _json_list(key: str, default: list[str], *, allowed: set[str] | None = None) -> list[str]:
            raw = str(raw_map.get(key, "")).strip()
            if not raw:
                return list(default)
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                return list(default)
            if not isinstance(parsed, list):
                return list(default)
            normalized = [str(item).strip() for item in parsed if str(item).strip()]
            if allowed is not None:
                normalized = [item for item in normalized if item in allowed]
            return normalized or list(default)

        resolved.pipeline = PipelineConfig(
            mode=_text("agent.pipeline.mode", "conditional"),
            default_order=[
                stage  # type: ignore[list-item]
                for stage in _json_list(
                    "agent.pipeline.default_order",
                    list(DEFAULT_AGENT_STAGE_ORDER),
                    allowed=KNOWN_AGENT_STAGES,
                )
            ],
            fail_strategy=_text("agent.pipeline.fail_strategy", "degrade"),
            review_gate=_bool("agent.pipeline.review_gate", True),
            knowledge_writeback=_text("agent.pipeline.knowledge_writeback", "suggest_only"),
        )
        resolved.routing = RoutingConfig(
            force_planning_on_procedure=_bool("agent.routing.force_planning_on_procedure", True),
            force_review_on_high_risk=_bool("agent.routing.force_review_on_high_risk", True),
            force_review_on_low_confidence=_bool("agent.routing.force_review_on_low_confidence", True),
            skip_perception_without_multimodal=_bool("agent.routing.skip_perception_without_multimodal", True),
            skip_knowledge_when_selected_chunks_locked=_bool(
                "agent.routing.skip_knowledge_when_selected_chunks_locked",
                False,
            ),
        )
        resolved.review = ReviewConfig(
            low_confidence_threshold=_float("agent.review.low_confidence_threshold", 0.72)
        )
        resolved.planning = PlanningConfig(
            bind_task_execution=_bool("agent.planning.bind_task_execution", True),
            trigger_rules=_json_list(
                "agent.planning.trigger_rules",
                list(DEFAULT_PLANNING_TRIGGER_RULES),
                allowed=KNOWN_TRIGGER_RULES,
            ),
        )
        for agent_name in DEFAULT_AGENT_STAGE_ORDER:
            agent = resolved.agents[agent_name]
            resolved.agents[agent_name] = AgentStageConfig(
                agent_name=agent_name,
                enabled=_bool(f"agent.{agent_name}.enabled", agent.enabled),
                model_provider=_text(f"agent.{agent_name}.model_provider", agent.model_provider),
                model_name=_text(f"agent.{agent_name}.model_name", agent.model_name),
                timeout_ms=_int(f"agent.{agent_name}.timeout_ms", agent.timeout_ms),
                max_retries=_int(f"agent.{agent_name}.max_retries", agent.max_retries),
                toolset=_json_list(f"agent.{agent_name}.toolset", []),
                fallback_agent=_nullable_text(f"agent.{agent_name}.fallback_agent"),
            )
        return resolved
