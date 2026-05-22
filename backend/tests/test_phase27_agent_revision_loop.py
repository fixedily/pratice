"""Phase 27: diagnosis-review revision loop."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.schemas.agents import AgentAssistRequest
from app.services.agent_orchestration_service import AgentOrchestrationService


@pytest.mark.asyncio
async def test_assist_runs_single_revision_round_before_completion():
    service = AgentOrchestrationService(session=SimpleNamespace())
    service._store_run = AsyncMock()
    service.knowledge_service.search_multimodal = AsyncMock(
        return_value={
            "query": "压缩机振动且温升",
            "effective_query": "压缩机振动且温升",
            "effective_keywords": ["压缩机", "振动", "温升"],
            "image_analysis": None,
            "results": [
                {
                    "chunk_id": 101,
                    "citation_label": "C1",
                    "title": "压缩机维护手册",
                    "section_reference": "2.1",
                    "section_path": "第二章 > 2.1",
                    "page_reference": "P12",
                    "excerpt": "先核查轴承与润滑状态。",
                    "source_name": "manual.pdf",
                }
            ],
            "grounded": True,
            "coverage_warnings": [],
            "reasoning_chain": None,
            "query_type": "text_related",
        }
    )
    service.task_service._load_knowledge_refs = AsyncMock(
        return_value=[
            {
                "chunk_id": 101,
                "title": "压缩机维护手册",
                "section_reference": "2.1",
                "section_path": "第二章 > 2.1",
                "excerpt": "先核查轴承与润滑状态。",
            }
        ]
    )
    service.case_service.recommend_cases = AsyncMock(return_value=[])
    service.tooling_service.run_tool_chain = AsyncMock(return_value={"tool_calls": []})
    service._build_diagnosis_report = AsyncMock(
        side_effect=[
            (
                {
                    "answer_mode": "diagnosis",
                    "most_likely_fault": "轴承润滑不足",
                    "risk_level": "中风险",
                    "confidence": 50,
                    "main_symptoms": ["振动", "温升"],
                    "preliminary_conclusion": "第一版诊断结论。",
                    "next_steps": [],
                    "root_causes": [],
                    "evidence_items": [],
                    "evidence_count": 1,
                    "top_similarity": 72,
                    "work_order_ready": False,
                },
                "第一版诊断报告",
            ),
            (
                {
                    "answer_mode": "diagnosis",
                    "most_likely_fault": "轴承润滑不足",
                    "risk_level": "中风险",
                    "confidence": 86,
                    "main_symptoms": ["振动", "温升"],
                    "preliminary_conclusion": "已补充证据后的诊断结论。",
                    "next_steps": [],
                    "root_causes": [],
                    "evidence_items": [],
                    "evidence_count": 2,
                    "top_similarity": 84,
                    "work_order_ready": True,
                },
                "修订后的诊断报告",
            ),
        ]
    )

    payload = await service.assist(
        AgentAssistRequest(
            query="压缩机振动且温升",
            equipment_type="压缩机",
            maintenance_level="standard",
        )
    )

    service._store_run.assert_awaited_once()
    assert service._build_diagnosis_report.await_count == 2
    assert payload["revision_rounds"] == 1
    assert payload["critiques"][0]["verdict"] == "revise"
    assert payload["termination_reason"] == "revision_completed"
    assert payload["diagnosis_report"] == "修订后的诊断报告"
