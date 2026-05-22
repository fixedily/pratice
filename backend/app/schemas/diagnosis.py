"""Diagnosis schemas for legacy diagnose APIs and structured outputs."""
import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


PROCEDURE_ACTION_FAMILIES = (
    ("拆卸", ("拆卸", "拆下", "取下", "取出", "旋下")),
    ("拔出", ("拔出", "拔下")),
    ("检查", ("检查", "复核", "确认", "观察", "测量")),
    ("更换", ("更换", "替换")),
    ("调整", ("调整", "校准")),
    ("安装", ("安装", "装上", "复装")),
    ("清洁", ("清洁", "清理")),
    ("润滑", ("润滑",)),
    ("加注", ("加注", "加入")),
    ("排放", ("排放", "放出")),
    ("松开", ("松开", "断开")),
    ("紧固", ("紧固", "拧紧")),
)


def _normalize_step_text(value: str | None) -> str:
    return (
        str(value or "")
        .replace("\u3000", " ")
        .replace("\n", " ")
        .replace("\r", " ")
        .strip()
    )


def _tidy_chinese_procedure_text(value: str | None) -> str:
    return (
        _normalize_step_text(value)
        .replace(" ,", ",")
        .replace(" .", ".")
        .replace(" :", ":")
        .replace(" ;", ";")
    )


def _trim_semantic_fragment(value: str | None) -> str:
    return re.sub(r"^[，。；;、:：\s]+|[，。；;、:：\s]+$", "", _tidy_chinese_procedure_text(value))


def _trim_stop_clause(value: str) -> str:
    return re.sub(r"(避免|防止|确保|确认|以免|用于).*$", "", value).strip()


def _find_semantic_action(texts: list[str]) -> tuple[str, str, int] | None:
    best_match: tuple[str, str, int] | None = None
    for raw_text in texts:
        text = _tidy_chinese_procedure_text(raw_text)
        if not text:
            continue
        for canonical, variants in PROCEDURE_ACTION_FAMILIES:
            for variant in variants:
                index = text.find(variant)
                if index < 0:
                    continue
                if (
                    best_match is None
                    or index < best_match[2]
                    or (index == best_match[2] and len(variant) > len(best_match[1]))
                ):
                    best_match = (canonical, variant, index)
    return best_match


def _derive_semantic_object(text: str, action_match: tuple[str, str, int] | None) -> str:
    normalized = (_tidy_chinese_procedure_text(text).split("。")[0].split("；")[0].strip())
    if not normalized or action_match is None:
        return ""

    canonical, variant, _ = action_match
    variants = next((family_variants for family_canonical, family_variants in PROCEDURE_ACTION_FAMILIES if family_canonical == canonical), (variant, canonical))
    deduped_variants = list(dict.fromkeys((*variants, variant, canonical)))

    for item in deduped_variants:
        index = normalized.find(item)
        if index < 0:
            continue
        trailing = normalized[index + len(item) :]
        candidate = _trim_semantic_fragment(
            _trim_stop_clause(
                re.sub(
                    r"^(?:并|再|将|把|对|于|向|往|小心|垂直|逐一|依次|缓慢|轻轻|逆时针转动|顺时针转动|逆时针|顺时针)+",
                    "",
                    trailing,
                )
            ).split("并")[0].split("然后")[0].split("再")[0].split("使用")[0].split("用")[0]
        )
        if len(candidate) >= 2:
            return candidate
    return ""


def _derive_semantic_headline(title: str, summary: str, raw_text: str, action: str, object_label: str) -> str:
    for raw_candidate in (summary, raw_text, title):
        candidate = _tidy_chinese_procedure_text(raw_candidate)
        candidate = candidate.split("。")[0].split("；")[0].strip()
        if not candidate:
            continue
        candidate = re.sub(r"^(?:步骤\s*)?\d+[.、:：)]\s*", "", candidate).strip()
        headline = re.sub(r"^(使用|请|先|再|将|把)", "", candidate).strip()
        if object_label:
            headline = headline.replace(object_label, "").strip()
        if action and headline.startswith(action):
            headline = headline[len(action) :].strip()
        headline = re.sub(r"^(使用|请|先|再|将|把)", "", headline).strip()
        headline = _trim_semantic_fragment(_trim_stop_clause(headline))
        if not headline:
            continue
        if action and headline == action:
            continue
        if headline == title:
            continue
        return headline
    return _tidy_chinese_procedure_text(title) or "按步骤执行"


def _derive_semantic_detail(title: str, summary: str, raw_text: str) -> str:
    normalized_summary = _tidy_chinese_procedure_text(summary)
    if normalized_summary and normalized_summary != "按手册原文执行该步骤。":
        return normalized_summary
    normalized_raw_text = _tidy_chinese_procedure_text(raw_text)
    if normalized_raw_text:
        raw_without_index = re.sub(r"^(?:步骤\s*)?\d+[.、:：)]\s*", "", normalized_raw_text).strip()
        normalized_title = _tidy_chinese_procedure_text(title)
        if normalized_title and raw_without_index.startswith(normalized_title):
            trailing = _trim_semantic_fragment(raw_without_index[len(normalized_title) :])
            if trailing:
                return trailing
        if normalized_raw_text != title:
            return raw_without_index or normalized_raw_text
    return _tidy_chinese_procedure_text(title)


class DiagnosisRequest(BaseModel):
    """Legacy synchronous diagnosis request payload."""

    start_time: str = Field(..., description="起始时间，格式 YYYY-MM-DD HH:MM:SS")
    end_time: str = Field(..., description="结束时间，格式 YYYY-MM-DD HH:MM:SS")
    symptom_description: str | None = Field(default=None, description="症状描述")
    model_provider: str = Field(default="openai", description="模型提供商")
    model_name: str | None = Field(default=None, description="模型名称")
    maintenance_task_id: int | None = Field(default=None, description="关联检修任务 ID")

    @field_validator("start_time", "end_time", "symptom_description", "model_provider", "model_name", mode="before")
    @classmethod
    def strip_optional_strings(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value


class DiagnosisResponse(BaseModel):
    """Legacy synchronous diagnosis response payload."""

    code: int = 200
    message: str = "诊断完成"
    data: Any = None


class DiagnosisRootCause(BaseModel):
    """Candidate root cause with confidence and evidence note."""

    name: str
    confidence: int = Field(ge=0, le=100)
    evidence: str


class DiagnosisEvidenceItem(BaseModel):
    """Structured evidence reference for diagnosis."""

    document_title: str
    chunk_id: int | None = None
    citation_label: str | None = None
    section: str | None = None
    excerpt: str | None = None
    source_name: str | None = None
    relevance_score: int | None = Field(default=None, ge=0, le=100)


class DiagnosisStepSection(BaseModel):
    """Structured sub-section inside one action/procedure step."""

    label: str
    items: list[str] = Field(default_factory=list)


class DiagnosisStep(BaseModel):
    """Structured step/action returned for diagnosis and procedure answers."""

    step_no: int | None = None
    title: str
    summary: str = ""
    sections: list[DiagnosisStepSection] = Field(default_factory=list)
    meta: list[str] = Field(default_factory=list)
    raw_text: str | None = None
    action: str | None = None
    object: str | None = None
    headline: str | None = None
    detail: str | None = None

    @field_validator("title", "summary", "raw_text", "action", "object", "headline", "detail", mode="before")
    @classmethod
    def strip_optional_text(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("meta", mode="before")
    @classmethod
    def normalize_meta(cls, value: object) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [value.strip()] if value.strip() else []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        return []

    @model_validator(mode="after")
    def enrich_semantic_fields(self) -> "DiagnosisStep":
        normalized_title = _tidy_chinese_procedure_text(self.title)
        normalized_summary = _tidy_chinese_procedure_text(self.summary)
        normalized_raw_text = _tidy_chinese_procedure_text(self.raw_text or f"{normalized_title} {normalized_summary}")

        action_match = _find_semantic_action(
            [
                _tidy_chinese_procedure_text(self.action),
                normalized_title,
                normalized_summary,
                normalized_raw_text,
            ]
        )
        action = action_match[0] if action_match else _tidy_chinese_procedure_text(self.action) or None
        object_label = _tidy_chinese_procedure_text(self.object)
        if not object_label:
            object_label = (
                _derive_semantic_object(normalized_title, action_match)
                or _derive_semantic_object(normalized_summary, action_match)
                or _derive_semantic_object(normalized_raw_text, action_match)
            )
        headline = _tidy_chinese_procedure_text(self.headline)
        if not headline:
            headline = _derive_semantic_headline(
                normalized_title,
                normalized_summary,
                normalized_raw_text,
                action or "",
                object_label,
            )
        detail = _tidy_chinese_procedure_text(self.detail)
        if not detail:
            detail = _derive_semantic_detail(normalized_title, normalized_summary, normalized_raw_text)

        self.title = normalized_title or self.title
        self.summary = normalized_summary
        self.raw_text = normalized_raw_text or None
        self.action = action
        self.object = object_label or None
        self.headline = headline or None
        self.detail = detail or None
        return self


class DiagnosisStructuredPayload(BaseModel):
    """Structured diagnosis payload returned by backend services."""

    answer_mode: Literal["diagnosis", "procedure"] = "diagnosis"
    most_likely_fault: str
    risk_level: str
    confidence: int = Field(ge=0, le=100)
    main_symptoms: list[str] = Field(default_factory=list)
    preliminary_conclusion: str
    next_steps: list[DiagnosisStep] = Field(default_factory=list)
    root_causes: list[DiagnosisRootCause] = Field(default_factory=list)
    evidence_items: list[DiagnosisEvidenceItem] = Field(default_factory=list)
    evidence_count: int = 0
    top_similarity: int | None = Field(default=None, ge=0, le=100)
    work_order_ready: bool = False

    @field_validator("next_steps", mode="before")
    @classmethod
    def coerce_next_steps(cls, value: object) -> list[DiagnosisStep | dict[str, Any]]:
        if value is None:
            return []
        if isinstance(value, list):
            normalized: list[DiagnosisStep | dict[str, Any]] = []
            for index, item in enumerate(value, start=1):
                if isinstance(item, str):
                    normalized.append(
                        {
                            "step_no": index,
                            "title": item.strip() or f"步骤 {index}",
                            "summary": "",
                            "sections": [],
                            "meta": [],
                            "raw_text": item.strip() or None,
                        }
                    )
                else:
                    normalized.append(item)
            return normalized
        return []
