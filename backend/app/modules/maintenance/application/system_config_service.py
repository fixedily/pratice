"""System configuration and health operations for maintenance."""
from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from sqlalchemy import desc, distinct, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.models.maintenance import SystemConfig
from app.db.models.knowledge import AgentRun, KnowledgeDocument, KnowledgeImportJob, KnowledgeRelation
from app.models.maintenance_domain import AuditLog, FlowTemplate, KnowledgeArticle
from app.modules.assistant.application.config_resolver import AgentConfigResolver
from app.modules.maintenance.datetime_util import to_iso_cn, utc_now_naive
from app.modules.maintenance.deps import CurrentUserCtx
from app.modules.maintenance.errors import MaintenanceAPIError


DEFAULT_SYSTEM_CONFIGS: dict[str, dict[str, Any]] = {
    "platform.system_name": {
        "value": "FaultDiag 工业设备故障诊断与检修闭环系统",
        "value_type": "string",
        "reload_policy": "hot",
    },
    "platform.project_name": {
        "value": "制造产线设备检修智能化试点",
        "value_type": "string",
        "reload_policy": "hot",
    },
    "maintenance.default_device_type": {
        "value": "发动机 / 机泵 / 电机类设备",
        "value_type": "string",
        "reload_policy": "hot",
    },
    "maintenance.default_level": {
        "value": "L2 标准检修",
        "value_type": "string",
        "reload_policy": "hot",
    },
    "platform.timezone": {
        "value": "Asia/Shanghai",
        "value_type": "string",
        "reload_policy": "restart",
    },
    "data.retention_policy": {
        "value": "工单与审计日志保留 365 天，模型调用摘要保留 90 天",
        "value_type": "string",
        "reload_policy": "hot",
    },
    "model.provider": {
        "value": "zhipu",
        "value_type": "string",
        "reload_policy": "hot",
    },
    "model.chat_model": {
        "value": "glm-4.5",
        "value_type": "string",
        "reload_policy": "hot",
    },
    "model.vision_model": {
        "value": "glm-4.5v",
        "value_type": "string",
        "reload_policy": "hot",
    },
    "model.embedding_model": {
        "value": "bge-m3:latest",
        "value_type": "string",
        "reload_policy": "hot",
    },
    "model.reranker_model": {
        "value": "BAAI/bge-reranker-v2-m3",
        "value_type": "string",
        "reload_policy": "hot",
    },
    "model.api_base": {
        "value": "https://open.bigmodel.cn/api/paas/v4",
        "value_type": "string",
        "reload_policy": "hot",
    },
    "model.temperature": {
        "value": "0.1",
        "value_type": "number",
        "reload_policy": "hot",
    },
    "model.max_tokens": {
        "value": "4096",
        "value_type": "number",
        "reload_policy": "hot",
    },
}

AGENT_STAGE_NAMES = ("perception", "diagnosis", "planning", "review", "knowledge")
AGENT_TRIGGER_RULE_NAMES = ("procedural_query", "maintenance_task_present", "high_risk_followup")
AGENT_TRIGGER_RULES = set(AGENT_TRIGGER_RULE_NAMES)
AGENT_KNOWLEDGE_WRITEBACK_MODES = {"suggest_only", "case_draft"}

AGENT_SYSTEM_CONFIGS: dict[str, dict[str, Any]] = {
    "agent.pipeline.mode": {
        "value": "conditional",
        "value_type": "string",
        "reload_policy": "hot",
    },
    "agent.pipeline.default_order": {
        "value": json.dumps(list(AGENT_STAGE_NAMES), ensure_ascii=False),
        "value_type": "json",
        "reload_policy": "hot",
    },
    "agent.pipeline.fail_strategy": {
        "value": "degrade",
        "value_type": "string",
        "reload_policy": "hot",
    },
    "agent.pipeline.review_gate": {
        "value": "true",
        "value_type": "boolean",
        "reload_policy": "hot",
    },
    "agent.pipeline.knowledge_writeback": {
        "value": "suggest_only",
        "value_type": "string",
        "reload_policy": "hot",
    },
    "agent.routing.force_planning_on_procedure": {
        "value": "true",
        "value_type": "boolean",
        "reload_policy": "hot",
    },
    "agent.routing.force_review_on_high_risk": {
        "value": "true",
        "value_type": "boolean",
        "reload_policy": "hot",
    },
    "agent.routing.force_review_on_low_confidence": {
        "value": "true",
        "value_type": "boolean",
        "reload_policy": "hot",
    },
    "agent.routing.skip_perception_without_multimodal": {
        "value": "true",
        "value_type": "boolean",
        "reload_policy": "hot",
    },
    "agent.routing.skip_knowledge_when_selected_chunks_locked": {
        "value": "false",
        "value_type": "boolean",
        "reload_policy": "hot",
    },
    "agent.planning.bind_task_execution": {
        "value": "true",
        "value_type": "boolean",
        "reload_policy": "hot",
    },
    "agent.planning.trigger_rules": {
        "value": json.dumps(list(AGENT_TRIGGER_RULE_NAMES), ensure_ascii=False),
        "value_type": "json",
        "reload_policy": "hot",
    },
    "agent.review.low_confidence_threshold": {
        "value": "0.72",
        "value_type": "number",
        "reload_policy": "hot",
    },
}

for _stage in AGENT_STAGE_NAMES:
    AGENT_SYSTEM_CONFIGS.update(
        {
            f"agent.{_stage}.enabled": {
                "value": "true",
                "value_type": "boolean",
                "reload_policy": "hot",
            },
            f"agent.{_stage}.model_provider": {
                "value": "zhipu",
                "value_type": "string",
                "reload_policy": "hot",
            },
            f"agent.{_stage}.model_name": {
                "value": "glm-4.5",
                "value_type": "string",
                "reload_policy": "hot",
            },
            f"agent.{_stage}.timeout_ms": {
                "value": "45000",
                "value_type": "number",
                "reload_policy": "hot",
            },
            f"agent.{_stage}.max_retries": {
                "value": "1",
                "value_type": "number",
                "reload_policy": "hot",
            },
            f"agent.{_stage}.toolset": {
                "value": "[]",
                "value_type": "json",
                "reload_policy": "hot",
            },
            f"agent.{_stage}.fallback_agent": {
                "value": "",
                "value_type": "string",
                "reload_policy": "hot",
            },
        }
    )

DEFAULT_SYSTEM_CONFIGS.update(AGENT_SYSTEM_CONFIGS)

BOOLEAN_AGENT_KEYS = {
    "agent.pipeline.review_gate",
    "agent.routing.force_planning_on_procedure",
    "agent.routing.force_review_on_high_risk",
    "agent.routing.force_review_on_low_confidence",
    "agent.routing.skip_perception_without_multimodal",
    "agent.routing.skip_knowledge_when_selected_chunks_locked",
    "agent.planning.bind_task_execution",
    *(f"agent.{stage}.enabled" for stage in AGENT_STAGE_NAMES),
}

JSON_AGENT_ALLOWED_VALUES: dict[str, set[str] | None] = {
    "agent.pipeline.default_order": set(AGENT_STAGE_NAMES),
    "agent.planning.trigger_rules": AGENT_TRIGGER_RULES,
    **{f"agent.{stage}.toolset": None for stage in AGENT_STAGE_NAMES},
}

NUMBER_AGENT_RANGES = {
    "agent.review.low_confidence_threshold": (0.0, 1.0),
    **{f"agent.{stage}.timeout_ms": (1000, 300000) for stage in AGENT_STAGE_NAMES},
    **{f"agent.{stage}.max_retries": (0, 5) for stage in AGENT_STAGE_NAMES},
}


def _validate_non_empty(value: str, field_name: str) -> None:
    if not value.strip():
        raise MaintenanceAPIError(400, "VALIDATION_ERROR", f"{field_name} 不能为空")


def _validate_temperature(value: str) -> None:
    try:
        numeric = float(value)
    except ValueError as exc:
        raise MaintenanceAPIError(400, "VALIDATION_ERROR", "temperature 必须是数字") from exc
    if numeric < 0 or numeric > 2:
        raise MaintenanceAPIError(400, "VALIDATION_ERROR", "temperature 必须在 0 到 2 之间")


def _validate_max_tokens(value: str) -> None:
    try:
        numeric = int(value)
    except ValueError as exc:
        raise MaintenanceAPIError(400, "VALIDATION_ERROR", "max_tokens 必须是正整数") from exc
    if numeric <= 0:
        raise MaintenanceAPIError(400, "VALIDATION_ERROR", "max_tokens 必须是正整数")


def _validate_boolean_string(value: str, field_name: str) -> None:
    if value.strip().lower() not in {"true", "false"}:
        raise MaintenanceAPIError(400, "VALIDATION_ERROR", f"{field_name} 仅支持 true / false")


def _validate_json_string_list(value: str, field_name: str, *, allowed: set[str] | None = None) -> None:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise MaintenanceAPIError(400, "VALIDATION_ERROR", f"{field_name} 必须是 JSON 数组") from exc
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        raise MaintenanceAPIError(400, "VALIDATION_ERROR", f"{field_name} 必须是字符串数组")
    if allowed is not None:
        invalid = [item for item in parsed if item not in allowed]
        if invalid:
            raise MaintenanceAPIError(
                400,
                "VALIDATION_ERROR",
                f"{field_name} 包含非法值：{', '.join(invalid)}",
            )


def _validate_bounded_number(
    value: str,
    field_name: str,
    *,
    min_value: float,
    max_value: float,
    integer_only: bool = False,
) -> None:
    try:
        numeric = int(value) if integer_only else float(value)
    except ValueError as exc:
        raise MaintenanceAPIError(400, "VALIDATION_ERROR", f"{field_name} 必须是合法数字") from exc
    if numeric < min_value or numeric > max_value:
        raise MaintenanceAPIError(
            400,
            "VALIDATION_ERROR",
            f"{field_name} 必须在 {min_value:g} 到 {max_value:g} 之间",
        )


class MaintenanceSystemConfigService:
    """System config read/write plus subsystem health."""

    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings

    async def _ensure_default_system_configs(self) -> None:
        changed = False
        for key, defaults in DEFAULT_SYSTEM_CONFIGS.items():
            exists = await self.session.get(SystemConfig, key)
            if exists is not None:
                continue
            self.session.add(
                SystemConfig(
                    key=key,
                    value=str(defaults["value"]),
                    value_type=str(defaults["value_type"]),
                    reload_policy=str(defaults["reload_policy"]),
                    is_sensitive=False,
                    updated_at=utc_now_naive(),
                )
            )
            changed = True
        if changed:
            await self.session.commit()

    async def list_system_configs(self, ctx: CurrentUserCtx) -> dict[str, Any]:
        if not ctx.has_any("admin"):
            raise MaintenanceAPIError(403, "FORBIDDEN", "仅管理员")
        await self._ensure_default_system_configs()
        rows = (await self.session.execute(select(SystemConfig).order_by(SystemConfig.key.asc()))).scalars().all()
        items = []
        for config in rows:
            entry: dict[str, Any] = {
                "key": config.key,
                "value_type": config.value_type,
                "reload_policy": config.reload_policy,
                "is_sensitive": config.is_sensitive,
                "updated_at": to_iso_cn(config.updated_at),
            }
            if config.is_sensitive:
                entry["value_masked"] = "****"
            else:
                entry["value"] = config.value
            items.append(entry)
        provider = next((item.get("value") for item in items if item["key"] == "model.provider"), "zhipu")
        items.append(
            {
                "key": "model.api_key_status",
                "value_type": "string",
                "reload_policy": "hot",
                "is_sensitive": True,
                "updated_at": to_iso_cn(utc_now_naive()),
                "value_masked": self._resolve_model_secret_status(str(provider)),
            }
        )
        total = len(items)
        return {"items": items, "total": total, "page": 1, "page_size": max(total, 1)}

    async def patch_system_config(self, key: str, body: dict[str, Any], ctx: CurrentUserCtx) -> dict[str, Any]:
        if not ctx.has_any("admin"):
            raise MaintenanceAPIError(403, "FORBIDDEN", "仅管理员")
        if key in DEFAULT_SYSTEM_CONFIGS:
            await self._ensure_default_system_configs()
        config = await self.session.get(SystemConfig, key)
        if config is None:
            raise MaintenanceAPIError(404, "NOT_FOUND", "配置不存在")
        if config.is_sensitive:
            raise MaintenanceAPIError(400, "VALIDATION_ERROR", "敏感配置不可通过接口写入")
        next_value = str(body.get("value", config.value)).strip()
        if not next_value:
            raise MaintenanceAPIError(400, "VALIDATION_ERROR", "配置值不能为空")
        if key == "model.api_base":
            _validate_non_empty(next_value, "API Base")
        elif key == "model.temperature":
            _validate_temperature(next_value)
        elif key == "model.max_tokens":
            _validate_max_tokens(next_value)
        elif key in BOOLEAN_AGENT_KEYS:
            _validate_boolean_string(next_value, key)
        elif key in JSON_AGENT_ALLOWED_VALUES:
            _validate_json_string_list(next_value, key, allowed=JSON_AGENT_ALLOWED_VALUES[key])
        elif key in NUMBER_AGENT_RANGES:
            minimum, maximum = NUMBER_AGENT_RANGES[key]
            _validate_bounded_number(
                next_value,
                key,
                min_value=minimum,
                max_value=maximum,
                integer_only=key.endswith("timeout_ms") or key.endswith("max_retries"),
            )
        elif key == "agent.pipeline.knowledge_writeback" and next_value not in AGENT_KNOWLEDGE_WRITEBACK_MODES:
            raise MaintenanceAPIError(
                400,
                "VALIDATION_ERROR",
                "agent.pipeline.knowledge_writeback 仅支持 suggest_only / case_draft",
            )
        previous_value = config.value
        config.value = next_value
        config.updated_at = utc_now_naive()
        config.updated_by_user_id = ctx.user_id
        self.session.add(
            AuditLog(
                action="system_config.updated",
                resource_type="system_config",
                resource_id=config.key,
                actor_user_id=ctx.user_id,
                payload={"previous_value": previous_value, "next_value": config.value},
                business_code="SYSTEM_CONFIG_UPDATED",
                created_at=utc_now_naive(),
            )
        )
        await self.session.commit()
        return {
            "key": config.key,
            "value": config.value,
            "value_type": config.value_type,
            "reload_policy": config.reload_policy,
            "is_sensitive": config.is_sensitive,
            "updated_at": to_iso_cn(config.updated_at),
        }

    async def check_model_connectivity(self, body: dict[str, Any], ctx: CurrentUserCtx) -> dict[str, Any]:
        if not ctx.has_any("admin"):
            raise MaintenanceAPIError(403, "FORBIDDEN", "仅管理员")
        draft = self._normalize_model_connectivity_payload(body)
        results = await self._run_model_connectivity_checks(draft)
        overall_status = "success" if all(item["status"] == "success" for item in results.values()) else "failure"
        return {
            "overall_status": overall_status,
            "provider": draft["provider"],
            "api_base": draft["api_base"],
            "credential_status": self._resolve_model_secret_status(draft["provider"]),
            "tested_at": to_iso_cn(utc_now_naive()),
            "results": results,
        }

    async def get_settings_overview(self, ctx: CurrentUserCtx) -> dict[str, Any]:
        if not ctx.has_any("admin"):
            raise MaintenanceAPIError(403, "FORBIDDEN", "仅管理员")

        knowledge_summary = await self._build_knowledge_summary()
        workflow_summary = await self._build_workflow_summary()
        audit_summary = await self._build_audit_summary()
        agent_summary = await self._build_agent_summary()
        return {
            "knowledge_summary": knowledge_summary,
            "rag_summary": self._build_rag_summary(),
            "workflow_summary": workflow_summary,
            "audit_summary": audit_summary,
            "agent_summary": agent_summary,
        }

    async def _build_knowledge_summary(self) -> dict[str, Any]:
        document_count = (
            await self.session.execute(
                select(func.count()).select_from(KnowledgeDocument).where(KnowledgeDocument.status == "published")
            )
        ).scalar_one()
        import_job_count = (
            await self.session.execute(select(func.count()).select_from(KnowledgeImportJob))
        ).scalar_one()
        published_article_count = (
            await self.session.execute(
                select(func.count()).select_from(KnowledgeArticle).where(KnowledgeArticle.status == "published")
            )
        ).scalar_one()
        retrieval_enabled_count = (
            await self.session.execute(
                select(func.count(distinct(KnowledgeArticle.id)))
                .select_from(KnowledgeArticle)
                .join(
                    KnowledgeRelation,
                    (KnowledgeRelation.source_kind == "knowledge_article")
                    & (KnowledgeRelation.source_id == KnowledgeArticle.id)
                    & (KnowledgeRelation.target_kind == "knowledge_document")
                    & (KnowledgeRelation.relation_type == "published_into"),
                )
                .join(
                    KnowledgeDocument,
                    KnowledgeDocument.id == KnowledgeRelation.target_id,
                )
                .where(KnowledgeArticle.status == "published")
                .where(KnowledgeDocument.status == "published")
            )
        ).scalar_one()

        timestamps: list[str] = []
        latest_document_updated = (
            await self.session.execute(select(func.max(KnowledgeDocument.updated_at)))
        ).scalar_one_or_none()
        latest_import_updated = (
            await self.session.execute(select(func.max(KnowledgeImportJob.updated_at)))
        ).scalar_one_or_none()
        latest_article_updated = (
            await self.session.execute(select(func.max(KnowledgeArticle.updated_at)))
        ).scalar_one_or_none()
        for value in (latest_document_updated, latest_import_updated, latest_article_updated):
            if value is not None:
                timestamps.append(to_iso_cn(value))

        last_updated_at = max(timestamps) if timestamps else None
        return {
            "document_count": int(document_count or 0),
            "import_job_count": int(import_job_count or 0),
            "published_article_count": int(published_article_count or 0),
            "retrieval_enabled_count": int(retrieval_enabled_count or 0),
            "last_updated_at": last_updated_at,
        }

    def _build_rag_summary(self) -> dict[str, Any]:
        return {
            "vector_store_backend": self.settings.vector_store_backend,
            "embedding_model": self.settings.embedding_model,
            "enable_reranker": bool(self.settings.enable_reranker),
            "reranker_model": self.settings.reranker_model,
            "reranker_top_k": int(self.settings.reranker_top_k),
            "enable_search_cache": bool(self.settings.enable_search_cache),
        }

    async def _build_agent_summary(self) -> dict[str, Any]:
        await self._ensure_default_system_configs()
        resolved = await AgentConfigResolver(self.session).load()
        latest_run = (
            await self.session.execute(select(AgentRun).order_by(desc(AgentRun.created_at)).limit(1))
        ).scalar_one_or_none()
        payload = dict(latest_run.payload) if latest_run is not None and isinstance(latest_run.payload, dict) else {}
        runtime_rows = {
            str(item.get("agent_name")): item
            for item in payload.get("agent_runtime_status", [])
            if isinstance(item, dict) and item.get("agent_name")
        }
        last_run_at = payload.get("created_at")
        if last_run_at is None and latest_run is not None:
            last_run_at = to_iso_cn(latest_run.created_at)

        agents: list[dict[str, Any]] = []
        for stage_name in resolved.pipeline.default_order:
            stage_config = resolved.agents[stage_name]
            latest = runtime_rows.get(stage_name, {})
            agents.append(
                {
                    "agent_name": stage_name,
                    "enabled": stage_config.enabled,
                    "model_provider": stage_config.model_provider,
                    "model_name": stage_config.model_name,
                    "timeout_ms": stage_config.timeout_ms,
                    "max_retries": stage_config.max_retries,
                    "toolset": stage_config.toolset,
                    "fallback_agent": stage_config.fallback_agent,
                    "last_status": latest.get("status"),
                    "last_summary": latest.get("summary"),
                    "last_run_at": latest.get("finished_at") or last_run_at,
                }
            )

        return {
            "pipeline_mode": resolved.pipeline.mode,
            "default_order": resolved.pipeline.default_order,
            "fail_strategy": resolved.pipeline.fail_strategy,
            "review_gate": resolved.pipeline.review_gate,
            "knowledge_writeback": resolved.pipeline.knowledge_writeback,
            "last_run_id": payload.get("run_id"),
            "last_run_status": payload.get("status"),
            "last_run_at": last_run_at,
            "degradation_count": len(payload.get("degradation_trace", [])),
            "agents": agents,
        }

    def _resolve_model_secret_status(self, provider: str) -> str:
        normalized = (provider or "zhipu").strip().lower()
        if normalized in {"ollama", "local"}:
            return "本地直连"
        if normalized in {"dashscope", "qwen"}:
            return "已托管" if self.settings.dashscope_api_key else "未配置"
        if normalized == "deepseek":
            return "已托管" if self.settings.deepseek_api_key else "未配置"
        if normalized == "openai":
            return "已托管" if self.settings.openai_api_key else "未配置"
        return "已托管" if self.settings.zhipu_api_key else "未配置"

    def _resolve_provider_api_key(self, provider: str) -> str | None:
        normalized = (provider or "zhipu").strip().lower()
        if normalized in {"ollama", "local"}:
            return "ollama"
        if normalized in {"dashscope", "qwen"}:
            return self.settings.dashscope_api_key
        if normalized == "deepseek":
            return self.settings.deepseek_api_key
        if normalized == "openai":
            return self.settings.openai_api_key
        return self.settings.zhipu_api_key

    def _normalize_model_connectivity_payload(self, body: dict[str, Any]) -> dict[str, Any]:
        provider = str(body.get("provider", "")).strip().lower()
        chat_model = str(body.get("chat_model", "")).strip()
        vision_model = str(body.get("vision_model", "")).strip()
        embedding_model = str(body.get("embedding_model", "")).strip()
        reranker_model = str(body.get("reranker_model", "")).strip()
        api_base = str(body.get("api_base", "")).strip()
        temperature_raw = str(body.get("temperature", "")).strip()
        max_tokens_raw = str(body.get("max_tokens", "")).strip()

        _validate_non_empty(provider, "provider")
        _validate_non_empty(api_base, "API Base")
        _validate_temperature(temperature_raw)
        _validate_max_tokens(max_tokens_raw)

        return {
            "provider": provider,
            "chat_model": chat_model,
            "vision_model": vision_model,
            "embedding_model": embedding_model,
            "reranker_model": reranker_model,
            "api_base": api_base,
            "temperature": float(temperature_raw),
            "max_tokens": int(max_tokens_raw),
        }

    async def _run_model_connectivity_checks(self, draft: dict[str, Any]) -> dict[str, Any]:
        checked_at = to_iso_cn(utc_now_naive())
        return {
            "chat": await self._probe_openai_chat_lane(
                draft["api_base"],
                draft["chat_model"],
                checked_at,
                draft["provider"],
            ),
            "vision": await self._probe_openai_vision_lane(
                draft["api_base"],
                draft["vision_model"],
                checked_at,
                draft["provider"],
            ),
            "embedding": await self._probe_openai_embedding_lane(
                draft["api_base"],
                draft["embedding_model"],
                checked_at,
                draft["provider"],
            ),
            "reranker": await self._probe_reranker_lane(
                draft["reranker_model"],
                checked_at,
                draft["provider"],
            ),
        }

    async def _probe_openai_chat_lane(
        self,
        api_base: str,
        model_name: str,
        checked_at: str,
        provider: str,
    ) -> dict[str, Any]:
        api_key = self._resolve_provider_api_key(provider)
        if not api_key:
            return self._failure_probe_result("当前 provider 缺少服务端凭证", model_name, checked_at)
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    f"{api_base.rstrip('/')}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": model_name,
                        "messages": [{"role": "user", "content": "ping"}],
                        "max_tokens": 1,
                        "temperature": 0,
                    },
                )
                response.raise_for_status()
        except Exception as exc:
            return self._failure_probe_result(f"chat 连通失败: {exc}", model_name, checked_at)
        return self._success_probe_result("chat 连通成功", model_name, checked_at)

    async def _probe_openai_vision_lane(
        self,
        api_base: str,
        model_name: str,
        checked_at: str,
        provider: str,
    ) -> dict[str, Any]:
        api_key = self._resolve_provider_api_key(provider)
        if not api_key:
            return self._failure_probe_result("当前 provider 缺少服务端凭证", model_name, checked_at)
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    f"{api_base.rstrip('/')}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": model_name,
                        "messages": [{"role": "user", "content": [{"type": "text", "text": "ping"}]}],
                        "max_tokens": 1,
                        "temperature": 0,
                    },
                )
                response.raise_for_status()
        except Exception as exc:
            return self._failure_probe_result(f"vision 连通失败: {exc}", model_name, checked_at)
        return self._success_probe_result("vision 连通成功", model_name, checked_at)

    async def _probe_openai_embedding_lane(
        self,
        api_base: str,
        model_name: str,
        checked_at: str,
        provider: str,
    ) -> dict[str, Any]:
        api_key = self._resolve_provider_api_key(provider)
        if not api_key:
            return self._failure_probe_result("当前 provider 缺少服务端凭证", model_name, checked_at)
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    f"{api_base.rstrip('/')}/embeddings",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={"model": model_name, "input": ["ping"]},
                )
                response.raise_for_status()
        except Exception as exc:
            return self._failure_probe_result(f"embedding 连通失败: {exc}", model_name, checked_at)
        return self._success_probe_result("embedding 连通成功", model_name, checked_at)

    async def _probe_reranker_lane(
        self,
        model_name: str,
        checked_at: str,
        provider: str,
    ) -> dict[str, Any]:
        if provider in {"dashscope", "qwen"}:
            api_key = self._resolve_provider_api_key(provider)
            if not api_key:
                return self._failure_probe_result("DashScope 缺少服务端凭证", model_name, checked_at)
            return self._success_probe_result("DashScope rerank 凭证可用", model_name, checked_at)

        from app.services.rerank_service import _get_reranker

        try:
            reranker = await asyncio.to_thread(_get_reranker, model_name)
        except Exception as exc:
            return self._failure_probe_result(f"本地 reranker 初始化失败: {exc}", model_name, checked_at)
        if reranker is None:
            return self._failure_probe_result("本地 reranker 初始化失败", model_name, checked_at)
        return self._success_probe_result("本地 reranker 可加载", model_name, checked_at)

    def _success_probe_result(self, detail: str, model_name: str, checked_at: str) -> dict[str, Any]:
        return {
            "status": "success",
            "detail": detail,
            "tested_model": model_name,
            "timestamp": checked_at,
        }

    def _failure_probe_result(self, detail: str, model_name: str, checked_at: str) -> dict[str, Any]:
        return {
            "status": "failure",
            "detail": detail,
            "tested_model": model_name,
            "timestamp": checked_at,
        }

    async def _build_workflow_summary(self) -> dict[str, Any]:
        published_flow_template_count = (
            await self.session.execute(
                select(func.count()).select_from(FlowTemplate).where(FlowTemplate.status == "published")
            )
        ).scalar_one()
        device_type_count = (
            await self.session.execute(
                select(func.count(distinct(FlowTemplate.device_type))).where(FlowTemplate.status == "published")
            )
        ).scalar_one()
        latest_template = (
            await self.session.execute(
                select(FlowTemplate).where(FlowTemplate.status == "published").order_by(FlowTemplate.id.desc()).limit(1)
            )
        ).scalar_one_or_none()
        default_stages = [
            "故障输入",
            "信息解析",
            "知识检索",
            "原因分析",
            "建议生成",
            "结果校验",
        ]
        if latest_template and isinstance(latest_template.steps_json, list) and latest_template.steps_json:
            extracted_stages = []
            for step in latest_template.steps_json:
                if isinstance(step, dict):
                    title = str(step.get("title") or "").strip()
                    if title:
                        extracted_stages.append(title)
            if extracted_stages:
                default_stages = extracted_stages
        return {
            "published_flow_template_count": int(published_flow_template_count or 0),
            "device_type_count": int(device_type_count or 0),
            "default_stages": default_stages,
        }

    async def _build_audit_summary(self) -> dict[str, Any]:
        recent_count = (
            await self.session.execute(select(func.count()).select_from(AuditLog))
        ).scalar_one()
        recent_logs = (
            await self.session.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(5))
        ).scalars().all()
        latest_items = [
            {
                "id": row.id,
                "action": row.action,
                "resource_type": row.resource_type,
                "resource_id": row.resource_id,
                "actor_user_id": row.actor_user_id,
                "created_at": to_iso_cn(row.created_at),
            }
            for row in recent_logs
        ]
        return {
            "recent_count": int(recent_count or 0),
            "latest_items": latest_items,
        }

    async def health_sub(self) -> dict[str, Any]:
        try:
            await self.session.execute(text("SELECT 1"))
            db_status = "ok"
        except Exception:
            db_status = "error"
        from app.core.redis import get_redis_service

        redis = get_redis_service()
        if redis.enabled:
            await redis.ping()
        return {
            "app": "ok",
            "database": db_status,
            "redis": redis.status_snapshot(),
            "vector": "skipped",
            "llm": "config_only",
        }
