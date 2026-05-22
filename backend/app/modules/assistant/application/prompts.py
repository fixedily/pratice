"""Prompt catalog for graph stage executors."""
from __future__ import annotations

from app.modules.assistant.application.graph_state import GraphState
from app.modules.assistant.application.runtime_types import AgentStageName

PROMPT_TEMPLATES: dict[AgentStageName, dict[str, str]] = {
    "perception": {
        "v1": "请总结当前多模态输入中的可见异常点：{query}",
    },
    "diagnosis": {
        "v1": "请基于当前证据输出结构化诊断初稿：{query}",
    },
    "planning": {
        "v1": "请根据当前诊断结论生成结构化检修步骤：{query}",
    },
    "review": {
        "v1": "请只做批评，不要重写答案。当前诊断：{latest_diagnosis}",
    },
    "knowledge": {
        "v1": "请总结本次运行值得沉淀到知识库的内容：{query}",
    },
}


def render_stage_prompt(stage_name: AgentStageName, state: GraphState, *, version: str = "v1") -> str:
    """Render a stage prompt from the current graph state."""
    stage_versions = PROMPT_TEMPLATES[stage_name]
    template = stage_versions[version if version in stage_versions else "v1"]
    diagnosis = state.stages.get("diagnosis")
    return template.format(
        query=state.request_context.get("query", ""),
        latest_diagnosis=diagnosis.summary if diagnosis is not None else "",
    )
