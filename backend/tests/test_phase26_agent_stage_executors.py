"""Phase 26: assistant stage executor contracts."""
from __future__ import annotations

import pytest

from app.modules.assistant.application.executors import (
    DiagnosisStageExecutor,
    KnowledgeStageExecutor,
    PerceptionStageExecutor,
    PlanningStageExecutor,
    ReviewStageExecutor,
    StageExecutionContext,
)
from app.modules.assistant.application.runtime_types import ResolvedAgentConfig
from app.modules.assistant.schemas import AgentAssistRequest


def _context(
    *,
    request: AgentAssistRequest | None = None,
    runtime_state: dict | None = None,
    events: list[tuple[str, dict]] | None = None,
) -> StageExecutionContext:
    async def emit(event: str, data: dict) -> None:
        if events is not None:
            events.append((event, data))

    return StageExecutionContext(
        request=request or AgentAssistRequest(query="泵故障"),
        runtime_state=runtime_state or {},
        resolved_config=ResolvedAgentConfig(),
        emit=emit if events is not None else None,
    )


@pytest.mark.asyncio
async def test_perception_without_multimodal_returns_noop_summary():
    artifact = await PerceptionStageExecutor().run(_context(request=AgentAssistRequest(query="泵故障")))

    assert artifact.status == "completed"
    assert artifact.payload == {}
    assert "无需额外处理" in artifact.summary


@pytest.mark.asyncio
async def test_perception_with_image_returns_structured_payload():
    class FakeImageAnalysisService:
        async def analyze(self, **kwargs):
            return type(
                "ImageAnalysis",
                (),
                {
                    "summary": "图片显示泵体有渗漏痕迹。",
                    "keywords": ["渗漏", "泵体"],
                    "warning": "需人工复核。",
                },
            )()

    class FakeKnowledgeService:
        image_analysis_service = FakeImageAnalysisService()

        async def _hydrate_attachment_image_request(self, request):
            return request, {"used_attachment_ids": [], "ignored_attachment_ids": []}

    artifact = await PerceptionStageExecutor(knowledge_service=FakeKnowledgeService()).run(
        _context(request=AgentAssistRequest(query="泵故障", image_base64="ZmFrZQ==", image_mime_type="image/png"))
    )

    payload = artifact.payload["perception_payload"]
    assert payload["input_modalities"] == ["text", "image"]
    assert payload["image_summary"] == "图片显示泵体有渗漏痕迹。"
    assert payload["image_keywords"] == ["渗漏", "泵体"]


@pytest.mark.asyncio
async def test_diagnosis_writes_retrieval_payload_and_selected_chunks():
    events: list[tuple[str, dict]] = []

    class FakeKnowledgeService:
        async def search_multimodal(self, request):
            return {
                "query": request.query,
                "effective_query": request.query,
                "effective_keywords": ["泵"],
                "image_analysis": None,
                "results": [
                    {
                        "chunk_id": 7,
                        "title": "泵检修手册",
                        "page_reference": "P1",
                        "content": "检查泵体振动和轴承温度。",
                    }
                ],
                "grounded": True,
                "coverage_warnings": [],
                "reasoning_chain": None,
                "query_type": "text_related",
            }

    executor = DiagnosisStageExecutor(knowledge_service=FakeKnowledgeService())
    artifact = await executor.run(_context(events=events))

    assert artifact.status == "completed"
    assert artifact.payload["retrieval_payload"]["effective_query"] == "泵故障"
    assert artifact.payload["retrieval_results"][0]["chunk_id"] == 7
    assert artifact.payload["selected_chunk_ids"] == [7]
    assert [event for event, _ in events] == ["stage_start", "stage_finish"]


@pytest.mark.asyncio
async def test_planning_writes_refs_preview_and_related_cases():
    events: list[tuple[str, dict]] = []

    class FakeTaskService:
        async def _load_knowledge_refs(self, chunk_ids):
            return [{"chunk_id": chunk_ids[0], "title": "泵检修手册"}]

    class FakeCaseService:
        async def recommend_cases(self, **kwargs):
            return [{"id": 3, "title": "泵轴承温升案例"}]

    async def build_task_preview(request, knowledge_refs):
        return [{"title": f"核对{knowledge_refs[0]['title']}"}]

    executor = PlanningStageExecutor(
        task_service=FakeTaskService(),
        case_service=FakeCaseService(),
        build_task_preview=build_task_preview,
    )
    artifact = await executor.run(
        _context(
            runtime_state={
                "selected_chunk_ids": [7],
                "retrieval_payload": {"effective_query": "泵故障"},
            },
            events=events,
        )
    )

    assert artifact.payload["knowledge_refs"][0]["chunk_id"] == 7
    assert artifact.payload["task_preview"][0]["title"] == "核对泵检修手册"
    assert artifact.payload["related_cases"][0]["id"] == 3
    assert [event for event, _ in events] == ["stage_start", "stage_finish"]


@pytest.mark.asyncio
async def test_review_writes_tools_risks_and_execution_brief():
    events: list[tuple[str, dict]] = []
    tool_call = {
        "tool_name": "safety_check",
        "title": "安全前置检查",
        "status": "completed",
        "summary": "已通过",
        "blocking": False,
        "requires_human_authorization": False,
        "details": [],
    }

    class FakeToolingService:
        async def run_tool_chain(self, **kwargs):
            return {"tool_calls": [tool_call]}

    def build_risk_findings(request, task_preview, knowledge_refs, tool_calls):
        return ["确认断电挂牌"]

    def build_execution_brief(
        request,
        retrieval_results,
        selected_chunk_ids,
        task_preview,
        related_cases,
        tool_calls,
        risk_findings,
    ):
        return {
            "status": "ready",
            "decision": "可以进入检修准备。",
            "recommended_path": "standard",
            "next_actions": [],
            "blocking_issues": [],
            "authorization_required": False,
        }

    executor = ReviewStageExecutor(
        tooling_service=FakeToolingService(),
        build_risk_findings=build_risk_findings,
        build_execution_brief=build_execution_brief,
    )
    artifact = await executor.run(
        _context(
            runtime_state={
                "knowledge_refs": [{"chunk_id": 7}],
                "task_preview": [{"title": "检查泵体"}],
                "related_cases": [],
                "retrieval_results": [],
                "selected_chunk_ids": [7],
            },
            events=events,
        )
    )

    assert artifact.payload["tool_calls"] == [tool_call]
    assert artifact.payload["risk_findings"] == ["确认断电挂牌"]
    assert artifact.payload["execution_brief"]["status"] == "ready"
    assert artifact.payload["review_payload"]["verdict"] == "pass"
    assert [event for event, _ in events] == ["stage_start", "tool_call", "stage_finish"]


@pytest.mark.asyncio
async def test_review_outputs_evidence_gaps_when_knowledge_is_missing():
    class FakeToolingService:
        async def run_tool_chain(self, **kwargs):
            return {"tool_calls": []}

    def build_risk_findings(request, task_preview, knowledge_refs, tool_calls):
        return []

    def build_execution_brief(
        request,
        retrieval_results,
        selected_chunk_ids,
        task_preview,
        related_cases,
        tool_calls,
        risk_findings,
    ):
        return {
            "status": "need_more_input",
            "decision": "需要补充输入。",
            "recommended_path": "standard",
            "next_actions": [],
            "blocking_issues": [],
            "authorization_required": False,
        }

    artifact = await ReviewStageExecutor(
        tooling_service=FakeToolingService(),
        build_risk_findings=build_risk_findings,
        build_execution_brief=build_execution_brief,
    ).run(
        _context(
            runtime_state={
                "retrieval_payload": {
                    "grounded": False,
                    "coverage_warnings": ["缺少设备型号依据。"],
                },
                "retrieval_results": [],
                "selected_chunk_ids": [],
                "knowledge_refs": [],
                "task_preview": [],
                "related_cases": [],
            }
        )
    )

    review_payload = artifact.payload["review_payload"]
    assert review_payload["verdict"] == "revise"
    assert "当前未命中稳定知识依据。" in review_payload["evidence_gaps"]
    assert "缺少设备型号依据。" in review_payload["evidence_gaps"]


@pytest.mark.asyncio
async def test_knowledge_writes_case_suggestions():
    def build_case_suggestions(request, knowledge_refs, related_cases):
        return [f"沉淀{knowledge_refs[0]['title']}", f"关联{related_cases[0]['title']}"]

    executor = KnowledgeStageExecutor(build_case_suggestions=build_case_suggestions)
    artifact = await executor.run(
        _context(
            runtime_state={
                "knowledge_refs": [{"title": "泵检修手册"}],
                "related_cases": [{"title": "泵轴承温升案例"}],
            }
        )
    )

    assert artifact.payload["case_suggestions"] == ["沉淀泵检修手册", "关联泵轴承温升案例"]
    assert "2 条案例沉淀建议" in artifact.summary


@pytest.mark.asyncio
async def test_knowledge_case_draft_mode_creates_pending_review_case():
    class FakeCaseService:
        def __init__(self):
            self.created = None

        async def create_case(self, data):
            self.created = data
            return {"id": 42, "status": "pending_review", "title": data.title}

    case_service = FakeCaseService()
    config = ResolvedAgentConfig()
    config.pipeline.knowledge_writeback = "case_draft"
    executor = KnowledgeStageExecutor(
        build_case_suggestions=lambda request, knowledge_refs, related_cases: ["建议入库"],
        case_service=case_service,
    )

    artifact = await executor.run(
        StageExecutionContext(
            request=AgentAssistRequest(
                query="泵体渗漏",
                equipment_type="离心泵",
                equipment_model="CP-100",
                fault_type="渗漏",
            ),
            runtime_state={
                "knowledge_refs": [],
                "related_cases": [],
                "task_preview": [{"title": "检查密封圈", "instruction": "检查并更换密封圈。"}],
                "diagnosis_report": "初步判断为密封圈老化。",
            },
            resolved_config=config,
        )
    )

    assert artifact.payload["case_draft"] == {
        "id": 42,
        "status": "pending_review",
        "title": "CP-100 - 渗漏",
        "review_entry": "/api/v1/cases/42/review",
    }
    assert case_service.created.resolution_summary == "初步判断为密封圈老化。"
