"""Phase 15: 标准化检修任务与作业闭环测试."""
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import SQLAlchemyError

from app.core.database import get_session
from app.main import app
from app.modules.tasks.application.task_service import MaintenanceTaskService
from app.schemas.tasks import MaintenanceTaskCreate


@pytest.fixture(autouse=True)
def override_db_session():
    """覆盖数据库依赖，避免测试受本机驱动影响。"""

    async def _override_get_session():
        yield SimpleNamespace()

    app.dependency_overrides[get_session] = _override_get_session
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_session, None)


def build_task_payload(status: str = "in_progress", completed_steps: int = 0) -> dict:
    return {
        "id": 101,
        "title": "摩托车发动机 LX200 / 启动困难检修任务",
        "work_order_id": "WO-20260331-01",
        "asset_code": "ENG-LX200-01",
        "report_source": "巡检上报",
        "priority": "high",
        "equipment_type": "摩托车发动机",
        "equipment_model": "LX200",
        "maintenance_level": "standard",
        "fault_type": "启动困难",
        "symptom_description": "发动机启动困难，点火异常。",
        "status": status,
        "advice_card": "智能建议：优先检查点火与供油系统。",
        "workflow_total": 5,
        "workflow_completed": 3 if status == "completed" else 1,
        "total_steps": 3,
        "completed_steps": completed_steps,
        "source_refs": [
            {
                "chunk_id": 11,
                "document_id": 2,
                "title": "发动机标准检修流程",
                "source_name": "engine_manual.pdf",
                "equipment_type": "摩托车发动机",
                "equipment_model": "LX200",
                "fault_type": "启动困难",
                "section_reference": "第 2 章",
                "page_reference": "P12",
                "excerpt": "先检查火花塞、供油和压缩比。",
            }
        ],
        "steps": [
            {
                "id": 1,
                "step_order": 1,
                "title": "检修前安全隔离",
                "instruction": "确认发动机已停机断电。",
                "risk_warning": "禁止带电拆检。",
                "caution": "佩戴绝缘手套。",
                "confirmation_text": "已完成检修前安全隔离",
                "status": "completed" if completed_steps > 0 else "pending",
                "completion_note": "已执行" if completed_steps > 0 else None,
                "completed_at": None,
                "knowledge_refs": [],
            },
            {
                "id": 2,
                "step_order": 2,
                "title": "关键部件排查",
                "instruction": "检查点火和供油系统。",
                "risk_warning": "防止误喷油。",
                "caution": "先排查火花塞。",
                "confirmation_text": "已完成关键部件排查",
                "status": "pending",
                "completion_note": None,
                "completed_at": None,
                "knowledge_refs": [],
            },
        ],
        "created_at": None,
        "updated_at": None,
    }


@pytest.mark.asyncio
async def test_create_maintenance_task_endpoint():
    """创建任务端点返回标准步骤和智能建议。"""
    with patch(
        "app.routers.tasks.MaintenanceTaskService.create_task",
        new=AsyncMock(return_value=build_task_payload()),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/tasks",
                json={
                    "work_order_id": "WO-20260331-01",
                    "asset_code": "ENG-LX200-01",
                    "report_source": "巡检上报",
                    "priority": "high",
                    "equipment_type": "摩托车发动机",
                    "equipment_model": "LX200",
                    "maintenance_level": "standard",
                    "fault_type": "启动困难",
                    "symptom_description": "发动机启动困难，点火异常。",
                    "source_chunk_ids": [11],
                },
            )

    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "摩托车发动机 LX200 / 启动困难检修任务"
    assert data["work_order_id"] == "WO-20260331-01"
    assert data["priority"] == "high"
    assert data["total_steps"] == 3
    assert data["advice_card"]


@pytest.mark.asyncio
async def test_create_task_serializes_datetime_inside_source_snapshot():
    """知识引用快照中的 datetime 应在入库前转成 JSON 安全字符串。"""
    session = SimpleNamespace(
        add=lambda *_args, **_kwargs: None,
        flush=AsyncMock(),
        commit=AsyncMock(),
    )
    service = MaintenanceTaskService(session=session)
    now = datetime.now(timezone.utc)
    service._load_knowledge_refs = AsyncMock(
        return_value=[
            {
                "chunk_id": 1299,
                "title": "摩托车发动机维修手册",
                "_document_updated_at": now,
            }
        ]
    )
    service.get_task_detail = AsyncMock(return_value={"id": 1})

    captured: list[object] = []

    def capture_add(obj):
        captured.append(obj)
        if getattr(obj, "id", None) is None and obj.__class__.__name__ == "MaintenanceTask":
            obj.id = 1

    session.add = capture_add

    await service.create_task(
        MaintenanceTaskCreate(
            equipment_type="摩托车发动机",
            equipment_model="LX200",
            maintenance_level="standard",
            fault_type="启动困难",
            symptom_description="发动机启动困难",
            source_chunk_ids=[1299],
        )
    )

    task = next(item for item in captured if item.__class__.__name__ == "MaintenanceTask")
    assert task.source_snapshot[0]["_document_updated_at"] == now.isoformat()
    assert task.template_id is None
    assert not any(item.__class__.__name__ == "MaintenanceTaskStep" for item in captured)


@pytest.mark.asyncio
async def test_update_diagnosis_context_serializes_datetime_inside_source_snapshot():
    """诊断结果回写时也要避免把 datetime 直接写入 JSON 列。"""
    task = SimpleNamespace(
        diagnosis_report=None,
        source_chunk_ids=[],
        source_snapshot=[],
        status="pending",
        steps=[],
    )
    session = SimpleNamespace(
        execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: task)),
        commit=AsyncMock(),
    )
    service = MaintenanceTaskService(session=session)
    now = datetime.now(timezone.utc)

    await service.update_diagnosis_context(
        24,
        diagnosis_report="已生成诊断报告",
        source_chunk_ids=[1299],
        source_refs=[{"chunk_id": 1299, "_document_updated_at": now}],
    )

    assert task.source_snapshot == [{"chunk_id": 1299, "_document_updated_at": now.isoformat()}]
    assert task.status == "completed"
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_diagnosis_context_replaces_steps_with_diagnosis_steps():
    """诊断结果回写后，任务步骤应来自结构化 next_steps，而不是流程模板。"""
    task = SimpleNamespace(
        id=24,
        diagnosis_report=None,
        diagnosis_structured=None,
        source_chunk_ids=[],
        source_snapshot=[],
        status="pending",
        steps=[SimpleNamespace(status="pending", completed_at=None)],
    )
    session = SimpleNamespace(
        execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: task)),
        commit=AsyncMock(),
    )
    service = MaintenanceTaskService(session=session)

    await service.update_diagnosis_context(
        24,
        diagnosis_report="已生成诊断报告",
        source_chunk_ids=[1299],
        source_refs=[{"chunk_id": 1299, "title": "维修手册"}],
        diagnosis_structured={
            "next_steps": [
                {
                    "step_no": 1,
                    "title": "拆卸气缸头盖",
                    "summary": "依次拆下相关密封件。",
                    "sections": [{"label": "注意", "items": ["记录螺栓位置"]}],
                    "meta": ["知识生成步骤"],
                    "raw_text": None,
                }
            ]
        },
        reasoning_chain={
            "question": "气缸头盖如何拆卸",
            "matched_entities": [],
            "expanded_relations": [],
            "evidence_chunks": [],
            "selected_answer_claims": ["需按手册顺序拆卸并记录螺栓位置"],
            "confidence": 0.82,
            "warnings": [],
            "explanation_text": "依据维修手册片段生成步骤。",
        },
    )

    assert task.diagnosis_structured["_reasoning_chain"]["question"] == "气缸头盖如何拆卸"
    assert task.diagnosis_structured["next_steps"][0]["action"] == "拆卸"
    assert task.diagnosis_structured["next_steps"][0]["object"] == "气缸头盖"
    assert task.diagnosis_structured["next_steps"][0]["detail"] == "依次拆下相关密封件。"
    assert len(task.steps) == 1
    assert task.steps[0].template_step_id is None
    assert task.steps[0].title == "拆卸气缸头盖"
    assert "记录螺栓位置" in task.steps[0].instruction
    assert task.steps[0].status == "completed"
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_diagnosis_context_rolls_back_when_commit_fails():
    """任务诊断回写若提交失败，应立即 rollback，避免同一 Session 继续污染后续链路。"""
    task = SimpleNamespace(
        id=24,
        diagnosis_report=None,
        diagnosis_structured=None,
        source_chunk_ids=[],
        source_snapshot=[],
        status="pending",
        steps=[],
    )
    session = SimpleNamespace(
        execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: task)),
        commit=AsyncMock(side_effect=SQLAlchemyError("commit failed")),
        rollback=AsyncMock(),
    )
    service = MaintenanceTaskService(session=session)

    with pytest.raises(SQLAlchemyError):
        await service.update_diagnosis_context(
            24,
            diagnosis_report="已生成诊断报告",
            source_chunk_ids=[1299],
            source_refs=[{"chunk_id": 1299, "title": "维修手册"}],
        )

    session.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_task_detail_builds_fallback_timeline_without_overriding_status():
    """若任务已有诊断结果但尚无 execution_timeline，应补时间线但不能覆盖真实状态。"""
    updated_at = datetime.now(timezone.utc)
    task = SimpleNamespace(
        id=24,
        title="摩托车检修任务",
        work_order_id=None,
        asset_code="ENG-01",
        report_source=None,
        priority="medium",
        equipment_type="摩托车发动机",
        equipment_model="LX200",
        maintenance_level="standard",
        fault_type="启动困难",
        symptom_description="启动困难",
        status="pending",
        advice_card=None,
        diagnosis_report="已生成诊断报告",
        diagnosis_structured=None,
        source_snapshot=[],
        execution_timeline=[],
        steps=[],
        created_at=updated_at,
        updated_at=updated_at,
    )
    session = SimpleNamespace(
        execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: task)),
    )
    service = MaintenanceTaskService(session=session)

    with (
        patch.object(MaintenanceTaskService, "_find_linked_work_order_id", new=AsyncMock(return_value=None)),
        patch.object(MaintenanceTaskService, "_find_linked_case_id", new=AsyncMock(return_value=None)),
    ):
        detail = await service.get_task_detail(24)

    assert detail["status"] == "pending"
    assert len(detail["execution_timeline"]) == 4
    assert [event["type"] for event in detail["execution_timeline"]] == [
        "node_start",
        "node_finish",
        "report",
        "done",
    ]
    assert detail["execution_timeline"][-1]["title"] == "诊断结果已回写"


@pytest.mark.asyncio
async def test_get_task_detail_does_not_treat_advice_card_as_final_diagnosis():
    """初始建议卡片不应阻止新建任务进入真实诊断流。"""
    created_at = datetime(2026, 3, 31, 10, 0, tzinfo=timezone.utc)
    task = SimpleNamespace(
        id=25,
        title="摩托车发动机标准检修任务",
        work_order_id=None,
        asset_code="ENG-LX200-02",
        report_source=None,
        priority="medium",
        equipment_type="摩托车发动机",
        equipment_model="LX200",
        maintenance_level="standard",
        fault_type="启动困难",
        symptom_description="启动困难",
        status="pending",
        advice_card="智能建议：优先检查点火与供油系统。",
        diagnosis_report=None,
        diagnosis_structured=None,
        source_snapshot=[],
        execution_timeline=[],
        steps=[],
        created_at=created_at,
        updated_at=created_at,
    )
    session = SimpleNamespace(
        execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: task)),
    )
    service = MaintenanceTaskService(session=session)

    with (
        patch.object(MaintenanceTaskService, "_find_linked_work_order_id", new=AsyncMock(return_value=None)),
        patch.object(MaintenanceTaskService, "_find_linked_case_id", new=AsyncMock(return_value=None)),
    ):
        detail = await service.get_task_detail(25)

    assert detail["status"] == "pending"
    assert detail["execution_timeline"] == []


@pytest.mark.asyncio
async def test_get_task_detail_builds_reasoning_chain_from_snapshot_when_missing():
    """老任务没有持久化推理链时，应从诊断结构和证据快照生成可展示子图。"""
    updated_at = datetime.now(timezone.utc)
    task = SimpleNamespace(
        id=26,
        title="摩托车检修任务",
        work_order_id=None,
        asset_code="ENG-01",
        report_source=None,
        priority="medium",
        equipment_type="摩托车发动机",
        equipment_model="LX200",
        maintenance_level="standard",
        fault_type="启动困难",
        symptom_description="启动困难、排气冒黑烟",
        status="completed",
        advice_card=None,
        diagnosis_report="已生成诊断报告",
        diagnosis_structured={
            "answer_mode": "diagnosis",
            "most_likely_fault": "混合气过浓",
            "risk_level": "medium",
            "confidence": 82,
            "main_symptoms": ["启动困难", "排气冒黑烟"],
            "preliminary_conclusion": "优先排查混合气过浓。",
            "next_steps": [],
            "root_causes": [],
            "evidence_items": [],
            "evidence_count": 1,
            "top_similarity": 88,
            "work_order_ready": True,
        },
        source_snapshot=[
            {
                "chunk_id": 1299,
                "document_id": 7,
                "title": "发动机检修手册",
                "source_name": "发动机检修手册",
                "citation_label": "C1",
                "section_reference": "3.2 节",
                "excerpt": "冒黑烟通常与混合气过浓相关。",
                "score": 0.88,
            }
        ],
        execution_timeline=[],
        steps=[],
        created_at=updated_at,
        updated_at=updated_at,
    )
    session = SimpleNamespace(
        execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: task)),
    )
    service = MaintenanceTaskService(session=session)

    with (
        patch.object(MaintenanceTaskService, "_find_linked_work_order_id", new=AsyncMock(return_value=None)),
        patch.object(MaintenanceTaskService, "_find_linked_case_id", new=AsyncMock(return_value=None)),
    ):
        detail = await service.get_task_detail(26)

    reasoning_chain = detail["reasoning_chain"]
    assert reasoning_chain["question"] == "启动困难、排气冒黑烟"
    assert reasoning_chain["evidence_chunks"][0]["citation_label"] == "C1"
    assert "系统判断优先排查混合气过浓，是因为" in reasoning_chain["explanation_text"]


@pytest.mark.asyncio
async def test_update_maintenance_task_step_endpoint():
    """步骤更新端点会返回更新后的任务详情。"""
    with patch(
        "app.routers.tasks.MaintenanceTaskService.update_task_step",
        new=AsyncMock(return_value=build_task_payload(completed_steps=1)),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.patch(
                "/api/v1/tasks/101/steps/1",
                json={"status": "completed", "completion_note": "已完成安全隔离"},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["completed_steps"] == 1
    assert data["steps"][0]["status"] == "completed"


@pytest.mark.asyncio
async def test_delete_maintenance_task_endpoint():
    """删除任务端点会调用服务层删除并返回 204。"""
    with patch(
        "app.routers.tasks.MaintenanceTaskService.delete_task",
        new=AsyncMock(return_value=None),
    ) as mocked_delete_task:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.delete("/api/v1/tasks/101")

    assert response.status_code == 204
    mocked_delete_task.assert_awaited_once_with(101)


@pytest.mark.asyncio
async def test_upsert_maintenance_task_execution_timeline_endpoint():
    """时间线写入端点返回 204，并调用服务层写入。"""
    with patch(
        "app.routers.tasks.MaintenanceTaskService.upsert_execution_timeline",
        new=AsyncMock(return_value=None),
    ) as mocked_upsert:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.patch(
                "/api/v1/tasks/101/execution-timeline",
                json={
                    "events": [
                        {
                            "id": "connected-1",
                            "type": "connected",
                            "title": "SSE 连接建立",
                            "description": "已连接",
                            "time": "12:00:00",
                        }
                    ]
                },
            )

    assert response.status_code == 204
    mocked_upsert.assert_awaited_once()


@pytest.mark.asyncio
async def test_list_maintenance_history_endpoint():
    """历史端点返回任务摘要列表。"""
    mocked_history = [
        {
            "id": 101,
            "title": "摩托车发动机 LX200 / 启动困难检修任务",
            "work_order_id": "WO-20260331-01",
            "asset_code": "ENG-LX200-01",
            "report_source": "巡检上报",
            "priority": "high",
            "equipment_type": "摩托车发动机",
            "equipment_model": "LX200",
            "maintenance_level": "standard",
            "status": "in_progress",
            "workflow_total": 5,
            "workflow_completed": 2,
            "total_steps": 3,
            "completed_steps": 1,
            "created_at": None,
            "updated_at": None,
        }
    ]

    with patch(
        "app.routers.tasks.MaintenanceTaskService.list_history",
        new=AsyncMock(return_value=mocked_history),
    ) as mocked_list_history:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                "/api/v1/history?limit=5&status=in_progress&priority=high&work_order_id=WO-20260331"
            )

    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert data["tasks"][0]["work_order_id"] == "WO-20260331-01"
    assert data["tasks"][0]["priority"] == "high"
    assert data["tasks"][0]["equipment_model"] == "LX200"
    mocked_list_history.assert_awaited_once_with(
        limit=5,
        status_filter="in_progress",
        priority_filter="high",
        work_order_id="WO-20260331",
    )

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_upsert_execution_timeline_marks_task_completed_when_report_is_saved():
    """一旦诊断报告被回写，任务与未完成步骤应立即切换为 completed。"""
    task = SimpleNamespace(
        id=101,
        status="pending",
        execution_timeline=[],
        diagnosis_report=None,
        steps=[
            SimpleNamespace(status="pending", completed_at=None),
            SimpleNamespace(status="in_progress", completed_at=None),
        ],
    )
    session = SimpleNamespace(
        execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: task)),
        commit=AsyncMock(),
    )
    service = MaintenanceTaskService(session=session)

    await service.upsert_execution_timeline(
        101,
        [{"id": "report-1", "type": "report", "title": "报告生成", "description": "已生成", "time": "12:00:00"}],
        diagnosis_report="■ 诊断结论\n已生成稳定诊断报告",
    )

    assert task.status == "completed"
    assert task.diagnosis_report == "■ 诊断结论\n已生成稳定诊断报告"
    assert all(step.status == "completed" for step in task.steps)
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_reset_task_for_retry_clears_stale_diagnosis_artifacts():
    """重新运行前应清掉旧的结构化诊断与证据快照，避免详情页继续展示上一轮结果。"""
    completed_at = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)
    task = SimpleNamespace(
        id=101,
        status="completed",
        execution_timeline=[{"id": "done-1", "type": "done"}],
        diagnosis_report="■ 操作结论\n先拆卸火花塞",
        diagnosis_structured={
            "answer_mode": "procedure",
            "most_likely_fault": "拆卸火花塞",
            "next_steps": [{"step_no": 1, "title": "拆卸火花塞", "raw_text": "拆卸火花塞"}],
            "_reasoning_chain": {"question": "如何拆卸火花塞"},
        },
        advice_card="旧的建议卡片",
        source_chunk_ids=[3, 8],
        source_snapshot=[{"chunk_id": 3, "citation_label": "C3", "title": "摩托车发动机维修手册"}],
        steps=[
            SimpleNamespace(status="completed", completion_note="已执行", completed_at=completed_at),
            SimpleNamespace(status="in_progress", completion_note="处理中", completed_at=None),
        ],
    )
    session = SimpleNamespace(
        execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: task)),
        commit=AsyncMock(),
    )
    service = MaintenanceTaskService(session=session)

    with patch.object(MaintenanceTaskService, "get_task_detail", new=AsyncMock(return_value={"id": 101})) as mocked_detail:
        payload = await service.reset_task_for_retry(101)

    assert payload == {"id": 101}
    assert task.status == "pending"
    assert task.execution_timeline == []
    assert task.diagnosis_report is None
    assert task.diagnosis_structured is None
    assert task.advice_card is None
    assert task.source_chunk_ids == []
    assert task.source_snapshot == []
    assert all(step.status == "pending" for step in task.steps)
    assert all(step.completion_note is None for step in task.steps)
    assert all(step.completed_at is None for step in task.steps)
    session.commit.assert_awaited_once()
    mocked_detail.assert_awaited_once_with(101)


@pytest.mark.asyncio
async def test_list_history_keeps_persisted_status_and_real_step_progress():
    """历史列表应保留真实状态与真实已完成步骤数，不再用诊断内容补完成态。"""
    task = SimpleNamespace(
        id=7,
        title="摩托车检修任务",
        work_order_id=None,
        asset_code=None,
        report_source=None,
        priority="medium",
        equipment_type="摩托车发动机",
        equipment_model="LX200",
        maintenance_level="routine",
        status="pending",
        diagnosis_report="已生成报告",
        steps=[
            SimpleNamespace(status="pending"),
            SimpleNamespace(status="completed"),
        ],
        diagnosis_structured=None,
        advice_card=None,
        source_snapshot=[],
        execution_timeline=[],
        fault_type=None,
        symptom_description=None,
        created_at=None,
        updated_at=None,
    )
    session = SimpleNamespace(
        execute=AsyncMock(
            side_effect=[
                SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [task])),
                SimpleNamespace(all=lambda: []),
                SimpleNamespace(all=lambda: []),
            ]
        ),
    )
    service = MaintenanceTaskService(session=session)

    history = await service.list_history(limit=10)

    assert history[0]["status"] == "pending"
    assert history[0]["completed_steps"] == 1
    assert history[0]["workflow_total"] == 5
    assert history[0]["workflow_completed"] == 3


@pytest.mark.asyncio
async def test_list_history_treats_completed_task_steps_as_fully_done():
    """若任务状态已完成，但历史步骤状态滞后，列表进度应按已完成任务补齐。"""
    task = SimpleNamespace(
        id=8,
        title="摩托车检修任务",
        work_order_id=None,
        asset_code=None,
        report_source=None,
        priority="medium",
        equipment_type="摩托车发动机",
        equipment_model="LX200",
        maintenance_level="standard",
        status="completed",
        diagnosis_report="已生成报告",
        diagnosis_structured=None,
        advice_card=None,
        source_snapshot=[],
        fault_type=None,
        symptom_description=None,
        steps=[
            SimpleNamespace(status="pending"),
            SimpleNamespace(status="pending"),
            SimpleNamespace(status="completed"),
        ],
        created_at=None,
        updated_at=None,
        execution_timeline=[],
    )
    session = SimpleNamespace(
        execute=AsyncMock(
            side_effect=[
                SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [task])),
                SimpleNamespace(all=lambda: []),
                SimpleNamespace(all=lambda: []),
            ]
        ),
    )
    service = MaintenanceTaskService(session=session)

    history = await service.list_history(limit=10)

    assert history[0]["status"] == "completed"
    assert history[0]["total_steps"] == 3
    assert history[0]["completed_steps"] == 3
    assert history[0]["workflow_total"] == 5
    assert history[0]["workflow_completed"] == 3


@pytest.mark.asyncio
async def test_list_history_uses_structured_next_steps_when_runtime_steps_missing():
    """若旧任务没有持久化 task.steps，但已有结构化 next_steps，列表应回退显示结构化步骤数。"""
    task = SimpleNamespace(
        id=9,
        title="摩托车检修任务",
        work_order_id=None,
        asset_code=None,
        report_source=None,
        priority="medium",
        equipment_type="摩托车发动机",
        equipment_model="LX200",
        maintenance_level="standard",
        status="completed",
        diagnosis_report="已生成报告",
        diagnosis_structured={
            "next_steps": [
                {"title": "拆卸气缸头盖"},
                {"title": "检查火花塞"},
                {"title": "复装并试车"},
                {"title": "人工复核与合规校验"},
            ]
        },
        advice_card=None,
        source_snapshot=[],
        fault_type=None,
        symptom_description=None,
        steps=[],
        created_at=None,
        updated_at=None,
        execution_timeline=[],
    )
    session = SimpleNamespace(
        execute=AsyncMock(
            side_effect=[
                SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [task])),
                SimpleNamespace(all=lambda: []),
                SimpleNamespace(all=lambda: []),
            ]
        ),
    )
    service = MaintenanceTaskService(session=session)

    history = await service.list_history(limit=10)

    assert history[0]["status"] == "completed"
    assert history[0]["total_steps"] == 4
    assert history[0]["completed_steps"] == 4
    assert history[0]["workflow_total"] == 5
    assert history[0]["workflow_completed"] == 3


@pytest.mark.asyncio
async def test_export_maintenance_task_endpoint():
    """导出端点返回任务详情和导出摘要。"""
    mocked_export = {
        "task": build_task_payload(status="completed", completed_steps=3),
        "exported_at": "2026-03-28T23:58:00",
        "export_summary": "任务已完成，共 3 步。",
    }

    with patch(
        "app.routers.tasks.MaintenanceTaskService.export_task",
        new=AsyncMock(return_value=mocked_export),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/v1/export/101")

    assert response.status_code == 200
    data = response.json()
    assert data["task"]["status"] == "completed"
    assert data["export_summary"] == "任务已完成，共 3 步。"


def test_maintenance_task_requires_symptom_or_sources():
    """创建任务时至少要有故障描述或知识条目。"""
    with pytest.raises(ValueError):
        MaintenanceTaskCreate(
            equipment_type="摩托车发动机",
            equipment_model="LX200",
            maintenance_level="standard",
        )
