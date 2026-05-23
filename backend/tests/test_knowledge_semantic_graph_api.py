from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.session import get_session
from app.main import app
from app.models import knowledge as _knowledge_models  # noqa: F401
from app.models import maintenance_domain as _maintenance_models  # noqa: F401
from app.models.base import Base
from app.models.knowledge import KnowledgeChunk, KnowledgeDocument
from app.models.maintenance_domain import AuthUser, Role, UserRole
from app.core.config import get_settings
from app.modules.knowledge.deps import CurrentUserCtx, require_user_ctx
from app.modules.knowledge.application.search_service import _semantic_entity_similarity_score
from app.modules.maintenance.security import create_access_token


@pytest.fixture
async def semantic_graph_client() -> AsyncIterator[AsyncClient]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _override_get_session():
        async with session_factory() as session:
            yield session

    async def _override_user_ctx():
        return CurrentUserCtx(
            user_id=1,
            username="semantic_expert",
            roles=["expert"],
            display_name="语义图谱专家",
        )

    app.dependency_overrides[get_session] = _override_get_session
    app.dependency_overrides[require_user_ctx] = _override_user_ctx
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            client._semantic_session_factory = session_factory
            yield client
    finally:
        app.dependency_overrides.pop(get_session, None)
        app.dependency_overrides.pop(require_user_ctx, None)
        await engine.dispose()


@pytest.fixture
async def semantic_graph_auth_client() -> AsyncIterator[AsyncClient]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as session:
        roles = {
            code: Role(code=code, name=name)
            for code, name in [
                ("worker", "检修员"),
                ("expert", "技术专家"),
                ("admin", "系统管理员"),
            ]
        }
        session.add_all(roles.values())
        await session.flush()

        users: dict[str, AuthUser] = {}
        for username, role_code in [
            ("semantic_worker", "worker"),
            ("semantic_expert", "expert"),
            ("semantic_admin", "admin"),
        ]:
            user = AuthUser(
                username=username,
                password_hash="not-used",
                display_name=username,
                is_active=True,
                status="active",
            )
            session.add(user)
            await session.flush()
            session.add(UserRole(user_id=user.id, role_id=roles[role_code].id))
            users[role_code] = user
        await session.commit()

    settings = get_settings()
    tokens = {
        role_code: create_access_token(
            secret=settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
            user_id=user.id,
            username=user.username,
            roles=[role_code],
            expires_minutes=60,
        )
        for role_code, user in users.items()
    }

    async def _override_get_session():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = _override_get_session
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            client._tokens = tokens
            yield client
    finally:
        app.dependency_overrides.pop(get_session, None)
        await engine.dispose()


@pytest.mark.asyncio
async def test_semantic_graph_requires_login(semantic_graph_auth_client: AsyncClient):
    resp = await semantic_graph_auth_client.get("/api/v1/knowledge/semantic-graph")

    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_semantic_graph_worker_can_read_but_cannot_write(
    semantic_graph_auth_client: AsyncClient,
):
    worker_headers = {
        "Authorization": f"Bearer {semantic_graph_auth_client._tokens['worker']}"
    }

    read_resp = await semantic_graph_auth_client.get(
        "/api/v1/knowledge/semantic-graph",
        headers=worker_headers,
    )
    write_resp = await semantic_graph_auth_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "component", "canonical_name": "火花塞"},
        headers=worker_headers,
    )

    assert read_resp.status_code == 200
    assert write_resp.status_code == 403


@pytest.mark.asyncio
async def test_semantic_graph_expert_and_admin_can_write(
    semantic_graph_auth_client: AsyncClient,
):
    expert_headers = {
        "Authorization": f"Bearer {semantic_graph_auth_client._tokens['expert']}"
    }
    admin_headers = {
        "Authorization": f"Bearer {semantic_graph_auth_client._tokens['admin']}"
    }

    expert_resp = await semantic_graph_auth_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "component", "canonical_name": "火花塞"},
        headers=expert_headers,
    )
    admin_resp = await semantic_graph_auth_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "fault_cause", "canonical_name": "积碳"},
        headers=admin_headers,
    )

    assert expert_resp.status_code == 201
    assert admin_resp.status_code == 201


@pytest.mark.asyncio
async def test_semantic_graph_entity_relation_evidence_review_flow(
    semantic_graph_client: AsyncClient,
):
    symptom_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={
            "entity_type": "fault_symptom",
            "canonical_name": "发动机启动困难",
            "display_name": "发动机启动困难",
            "description": "发动机无法顺利启动或启动时间明显变长。",
            "confidence": 0.96,
            "source_type": "manual",
            "created_by": "tester",
        },
    )
    assert symptom_resp.status_code == 201
    symptom = symptom_resp.json()
    assert symptom["entity_type"] == "fault_symptom"
    assert symptom["status"] == "active"

    alias_resp = await semantic_graph_client.post(
        f"/api/v1/knowledge/semantic-graph/entities/{symptom['id']}/aliases",
        json={"alias_name": "启动困难", "alias_type": "short_name", "confidence": 0.9},
    )
    assert alias_resp.status_code == 201
    assert alias_resp.json()["alias_name"] == "启动困难"

    cause_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={
            "entity_type": "fault_cause",
            "canonical_name": "混合气过浓",
            "display_name": "混合气过浓",
            "confidence": 0.88,
            "source_type": "manual",
        },
    )
    assert cause_resp.status_code == 201
    cause = cause_resp.json()

    relation_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/relations",
        json={
            "source_entity_id": symptom["id"],
            "target_entity_id": cause["id"],
            "relation_type": "symptom_possible_cause",
            "confidence": 0.84,
            "status": "draft",
            "source_type": "manual",
            "evidence_summary": "启动困难并伴随冒黑烟时，需排查混合气过浓。",
        },
    )
    assert relation_resp.status_code == 201
    relation = relation_resp.json()
    assert relation["status"] == "draft"
    assert relation["relation_type"] == "symptom_possible_cause"

    evidence_resp = await semantic_graph_client.post(
        f"/api/v1/knowledge/semantic-graph/relations/{relation['id']}/evidence",
        json={
            "excerpt": "启动困难并伴随排气管冒黑烟，通常提示混合气过浓。",
            "evidence_type": "manual_excerpt",
            "confidence": 0.86,
        },
    )
    assert evidence_resp.status_code == 201
    assert evidence_resp.json()["relation_id"] == relation["id"]

    review_resp = await semantic_graph_client.post(
        f"/api/v1/knowledge/semantic-graph/relations/{relation['id']}/reviews",
        json={
            "action": "approve",
            "review_note": "证据充分，进入正式图谱。",
            "reviewer_name": "domain-expert",
        },
    )
    assert review_resp.status_code == 200
    assert review_resp.json()["status"] == "approved"

    detail_resp = await semantic_graph_client.get(
        f"/api/v1/knowledge/semantic-graph/relations/{relation['id']}"
    )
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["relation"]["status"] == "approved"
    assert len(detail["evidence"]) == 1

    graph_resp = await semantic_graph_client.get("/api/v1/knowledge/semantic-graph")
    assert graph_resp.status_code == 200
    graph = graph_resp.json()
    assert len(graph["entities"]) == 2
    assert len(graph["relations"]) == 1


@pytest.mark.asyncio
async def test_semantic_graph_rejects_duplicate_entity(
    semantic_graph_client: AsyncClient,
):
    payload = {
        "entity_type": "component",
        "canonical_name": "火花塞",
        "display_name": "火花塞",
    }
    first_resp = await semantic_graph_client.post("/api/v1/knowledge/semantic-graph/entities", json=payload)
    second_resp = await semantic_graph_client.post("/api/v1/knowledge/semantic-graph/entities", json=payload)

    assert first_resp.status_code == 201
    assert second_resp.status_code == 400
    assert "already exists" in second_resp.json()["message"]


@pytest.mark.asyncio
async def test_extraction_candidate_can_be_approved_into_entity(
    semantic_graph_client: AsyncClient,
):
    job_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/extraction-jobs",
        json={
            "job_type": "rule_extract",
            "trigger_source": "manual",
            "summary": "从维修手册分段抽取实体候选。",
            "candidates": [
                {
                    "candidate_type": "entity",
                    "payload": {
                        "entity_type": "component",
                        "canonical_name": "火花塞",
                        "display_name": "火花塞",
                        "aliases": ["spark plug"],
                    },
                    "confidence": 0.91,
                }
            ],
        },
    )
    assert job_resp.status_code == 201
    job_payload = job_resp.json()
    candidate_id = job_payload["candidates"][0]["id"]
    assert job_payload["job"]["status"] == "completed"

    list_resp = await semantic_graph_client.get(
        "/api/v1/knowledge/semantic-graph/extraction-candidates"
    )
    assert list_resp.status_code == 200
    assert list_resp.json()["total"] == 1

    review_resp = await semantic_graph_client.post(
        f"/api/v1/knowledge/semantic-graph/extraction-candidates/{candidate_id}/reviews",
        json={"action": "approve", "review_note": "实体名称准确。"},
    )
    assert review_resp.status_code == 200
    reviewed = review_resp.json()
    assert reviewed["status"] == "approved"
    entity_id = reviewed["normalized_payload"]["entity_id"]

    detail_resp = await semantic_graph_client.get(
        f"/api/v1/knowledge/semantic-graph/entities/{entity_id}"
    )
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["entity"]["canonical_name"] == "火花塞"
    assert detail["aliases"][0]["alias_name"] == "spark plug"


@pytest.mark.asyncio
async def test_extraction_relation_candidate_creates_relation_with_evidence(
    semantic_graph_client: AsyncClient,
):
    symptom_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "fault_symptom", "canonical_name": "排气冒黑烟"},
    )
    cause_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "fault_cause", "canonical_name": "混合气过浓"},
    )
    assert symptom_resp.status_code == 201
    assert cause_resp.status_code == 201

    job_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/extraction-jobs",
        json={
            "job_type": "llm_extract",
            "trigger_source": "document_chunk",
            "candidates": [
                {
                    "candidate_type": "relation",
                    "payload": {
                        "source_entity_id": symptom_resp.json()["id"],
                        "target_entity_id": cause_resp.json()["id"],
                        "relation_type": "symptom_possible_cause",
                        "evidence": "排气冒黑烟时，应检查混合气是否过浓。",
                    },
                    "confidence": 0.87,
                }
            ],
        },
    )
    assert job_resp.status_code == 201
    candidate_id = job_resp.json()["candidates"][0]["id"]

    review_resp = await semantic_graph_client.post(
        f"/api/v1/knowledge/semantic-graph/extraction-candidates/{candidate_id}/reviews",
        json={"action": "approve", "reviewer_name": "domain-expert"},
    )
    assert review_resp.status_code == 200
    relation_id = review_resp.json()["normalized_payload"]["relation_id"]

    relation_resp = await semantic_graph_client.get(
        f"/api/v1/knowledge/semantic-graph/relations/{relation_id}"
    )
    assert relation_resp.status_code == 200
    relation_detail = relation_resp.json()
    assert relation_detail["relation"]["status"] == "approved"
    assert relation_detail["evidence"][0]["excerpt"] == "排气冒黑烟时，应检查混合气是否过浓。"


@pytest.mark.asyncio
async def test_rule_extraction_job_from_document_generates_chunk_candidates(
    semantic_graph_client: AsyncClient,
):
    session_factory = semantic_graph_client._semantic_session_factory
    async with session_factory() as session:
        document = KnowledgeDocument(
            title="摩托车发动机维修手册",
            source_name="engine-manual.pdf",
            source_type="manual",
            equipment_type="摩托车发动机",
            equipment_model="LX200",
            fault_type="启动困难",
            content="启动困难检修章节",
            status="published",
        )
        session.add(document)
        await session.flush()
        session.add(
            KnowledgeChunk(
                document_id=document.id,
                chunk_index=0,
                heading="启动困难排查",
                content="发动机启动困难并伴随排气冒黑烟时，应检查火花塞积碳和混合气过浓，检修前先断电、通风并隔离燃油，必要时清洗节气门。",
                equipment_type="摩托车发动机",
                equipment_model="LX200",
                fault_type="启动困难",
                section_reference="2.1",
                page_reference="P12",
            )
        )
        await session.commit()
        document_id = document.id

    job_resp = await semantic_graph_client.post(
        f"/api/v1/knowledge/semantic-graph/documents/{document_id}/extraction-jobs",
        json={"limit_chunks": 20},
    )
    assert job_resp.status_code == 201
    payload = job_resp.json()
    assert payload["job"]["document_id"] == document_id
    candidates = payload["candidates"]
    assert any(
        item["candidate_type"] == "entity"
        and item["payload"]["entity_type"] == "component"
        and item["payload"]["canonical_name"] == "火花塞"
        for item in candidates
    )
    assert any(
        item["candidate_type"] == "entity"
        and item["payload"]["entity_type"] == "safety_risk"
        and item["payload"]["canonical_name"] in {"燃油风险", "点火高压"}
        for item in candidates
    )
    relation_candidates = [item for item in candidates if item["candidate_type"] == "relation"]
    assert any(item["payload"]["relation_type"] == "symptom_possible_cause" for item in relation_candidates)
    assert any(item["payload"]["relation_type"] == "action_has_safety_risk" for item in relation_candidates)
    assert any(item["payload"]["relation_type"] == "risk_mitigated_by_action" for item in relation_candidates)
    assert all(item["chunk_id"] is not None and item["document_id"] == document_id for item in candidates)

    relation_candidate = next(
        item
        for item in relation_candidates
        if item["payload"]["relation_type"] == "symptom_possible_cause"
    )
    review_resp = await semantic_graph_client.post(
        f"/api/v1/knowledge/semantic-graph/extraction-candidates/{relation_candidate['id']}/reviews",
        json={"action": "approve"},
    )
    assert review_resp.status_code == 200
    relation_id = review_resp.json()["normalized_payload"]["relation_id"]

    detail_resp = await semantic_graph_client.get(
        f"/api/v1/knowledge/semantic-graph/relations/{relation_id}"
    )
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["evidence"][0]["document_id"] == document_id
    assert detail["evidence"][0]["page_reference"] == "P12"


@pytest.mark.asyncio
async def test_document_create_automatically_generates_extraction_candidates(
    semantic_graph_client: AsyncClient,
):
    create_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/documents",
        json={
            "title": "LX200 启动困难检修",
            "source_name": "lx200-starting.md",
            "source_type": "manual",
            "equipment_type": "摩托车发动机",
            "equipment_model": "LX200",
            "fault_type": "启动困难",
            "section_reference": "3.2",
            "page_reference": "P21",
            "content": "发动机启动困难时，应检查火花塞积碳和混合气过浓，必要时清洗节气门。",
        },
    )
    assert create_resp.status_code == 201
    document_id = create_resp.json()["id"]

    candidates_resp = await semantic_graph_client.get(
        "/api/v1/knowledge/semantic-graph/extraction-candidates",
        params={"status": "pending_review", "limit": 100},
    )
    assert candidates_resp.status_code == 200
    candidates = candidates_resp.json()["items"]
    assert any(item["document_id"] == document_id for item in candidates)
    assert any(
        item["candidate_type"] == "entity"
        and item["payload"]["entity_type"] == "fault_symptom"
        and item["payload"]["canonical_name"] == "启动困难"
        for item in candidates
    )
    assert any(
        item["candidate_type"] == "relation"
        and item["payload"]["relation_type"] == "symptom_possible_cause"
        for item in candidates
    )


@pytest.mark.asyncio
async def test_entity_merge_moves_aliases_relations_and_deduplicates(
    semantic_graph_client: AsyncClient,
):
    target_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "component", "canonical_name": "火花塞"},
    )
    source_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "component", "canonical_name": "火嘴"},
    )
    cause_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "fault_cause", "canonical_name": "积碳"},
    )
    assert target_resp.status_code == 201
    assert source_resp.status_code == 201
    assert cause_resp.status_code == 201
    target_id = target_resp.json()["id"]
    source_id = source_resp.json()["id"]
    cause_id = cause_resp.json()["id"]

    alias_resp = await semantic_graph_client.post(
        f"/api/v1/knowledge/semantic-graph/entities/{source_id}/aliases",
        json={"alias_name": "spark plug", "alias_type": "synonym"},
    )
    assert alias_resp.status_code == 201

    relation_ids = []
    for entity_id, evidence in [
        (target_id, "火花塞积碳会导致点火异常。"),
        (source_id, "火嘴积碳时需要清理或更换。"),
    ]:
        relation_resp = await semantic_graph_client.post(
            "/api/v1/knowledge/semantic-graph/relations",
            json={
                "source_entity_id": entity_id,
                "target_entity_id": cause_id,
                "relation_type": "component_has_cause",
                "confidence": 0.72,
            },
        )
        assert relation_resp.status_code == 201
        relation_id = relation_resp.json()["id"]
        relation_ids.append(relation_id)
        evidence_resp = await semantic_graph_client.post(
            f"/api/v1/knowledge/semantic-graph/relations/{relation_id}/evidence",
            json={"excerpt": evidence, "evidence_type": "manual"},
        )
        assert evidence_resp.status_code == 201

    merge_resp = await semantic_graph_client.post(
        f"/api/v1/knowledge/semantic-graph/entities/{source_id}/merge",
        json={"target_entity_id": target_id, "reason": "同义部件", "merged_by": "tester"},
    )
    assert merge_resp.status_code == 200
    merge_payload = merge_resp.json()
    assert merge_payload["moved_aliases"] == 2
    assert merge_payload["removed_duplicate_relations"] == 1

    target_detail_resp = await semantic_graph_client.get(
        f"/api/v1/knowledge/semantic-graph/entities/{target_id}"
    )
    assert target_detail_resp.status_code == 200
    aliases = {item["alias_name"] for item in target_detail_resp.json()["aliases"]}
    assert {"火嘴", "spark plug"}.issubset(aliases)

    relation_detail_resp = await semantic_graph_client.get(
        f"/api/v1/knowledge/semantic-graph/relations/{relation_ids[0]}"
    )
    assert relation_detail_resp.status_code == 200
    relation_detail = relation_detail_resp.json()
    assert relation_detail["relation"]["source_entity_id"] == target_id
    assert len(relation_detail["evidence"]) == 2


@pytest.mark.asyncio
async def test_quality_stats_counts_pending_and_relation_risks(
    semantic_graph_client: AsyncClient,
):
    entity_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "component", "canonical_name": "喷油嘴"},
    )
    cause_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "fault_cause", "canonical_name": "堵塞"},
    )
    assert entity_resp.status_code == 201
    assert cause_resp.status_code == 201

    relation_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/relations",
        json={
            "source_entity_id": entity_resp.json()["id"],
            "target_entity_id": cause_resp.json()["id"],
            "relation_type": "component_has_cause",
            "confidence": 0.42,
        },
    )
    assert relation_resp.status_code == 201
    job_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/extraction-jobs",
        json={
            "candidates": [
                {
                    "candidate_type": "entity",
                    "payload": {"entity_type": "component", "canonical_name": "喷油器"},
                    "confidence": 0.5,
                },
                {
                    "candidate_type": "relation",
                    "payload": {
                        "source_entity_id": entity_resp.json()["id"],
                        "target_entity_id": cause_resp.json()["id"],
                        "relation_type": "component_has_cause",
                    },
                    "confidence": 0.5,
                },
            ]
        },
    )
    assert job_resp.status_code == 201

    stats_resp = await semantic_graph_client.get(
        "/api/v1/knowledge/semantic-graph/quality-stats"
    )
    assert stats_resp.status_code == 200
    stats = stats_resp.json()
    assert stats["pending_entity_candidates"] == 1
    assert stats["pending_relation_candidates"] == 1
    assert stats["relations_without_evidence"] == 1
    assert stats["relations_without_evidence_or_review"] == 1
    assert stats["low_confidence_relations"] == 1
    assert stats["safety_risk_entities"] == 0
    assert stats["standard_parameter_entities"] == 0
    assert stats["forbidden_action_entities"] == 0
    assert stats["relations_with_safety_risk"] == 0


@pytest.mark.asyncio
async def test_quality_stats_counts_safety_graph_entities_and_relations(
    semantic_graph_client: AsyncClient,
):
    action_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "maintenance_action", "canonical_name": "拆卸"},
    )
    risk_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "safety_risk", "canonical_name": "点火高压"},
    )
    parameter_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "standard_parameter", "canonical_name": "火花塞间隙"},
    )
    forbidden_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "forbidden_action", "canonical_name": "带电检查点火线圈"},
    )
    assert action_resp.status_code == 201
    assert risk_resp.status_code == 201
    assert parameter_resp.status_code == 201
    assert forbidden_resp.status_code == 201

    relation_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/relations",
        json={
            "source_entity_id": action_resp.json()["id"],
            "target_entity_id": risk_resp.json()["id"],
            "relation_type": "action_has_safety_risk",
            "confidence": 0.86,
            "status": "approved",
        },
    )
    assert relation_resp.status_code == 201

    stats_resp = await semantic_graph_client.get(
        "/api/v1/knowledge/semantic-graph/quality-stats"
    )
    assert stats_resp.status_code == 200
    stats = stats_resp.json()
    assert stats["safety_risk_entities"] == 1
    assert stats["standard_parameter_entities"] == 1
    assert stats["forbidden_action_entities"] == 1
    assert stats["relations_with_safety_risk"] == 1


@pytest.mark.asyncio
async def test_relation_confidence_updates_with_evidence_and_review(
    semantic_graph_client: AsyncClient,
):
    symptom_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "fault_symptom", "canonical_name": "排气冒黑烟"},
    )
    cause_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "fault_cause", "canonical_name": "混合气过浓"},
    )
    assert symptom_resp.status_code == 201
    assert cause_resp.status_code == 201

    relation_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/relations",
        json={
            "source_entity_id": symptom_resp.json()["id"],
            "target_entity_id": cause_resp.json()["id"],
            "relation_type": "symptom_possible_cause",
            "confidence": 0.2,
            "status": "pending_review",
        },
    )
    assert relation_resp.status_code == 201
    relation_id = relation_resp.json()["id"]

    evidence_resp = await semantic_graph_client.post(
        f"/api/v1/knowledge/semantic-graph/relations/{relation_id}/evidence",
        json={"excerpt": "排气冒黑烟时，应检查混合气是否过浓。", "evidence_type": "manual"},
    )
    assert evidence_resp.status_code == 201
    detail_resp = await semantic_graph_client.get(
        f"/api/v1/knowledge/semantic-graph/relations/{relation_id}"
    )
    assert detail_resp.status_code == 200
    assert detail_resp.json()["relation"]["confidence"] >= 0.6

    review_resp = await semantic_graph_client.post(
        f"/api/v1/knowledge/semantic-graph/relations/{relation_id}/reviews",
        json={"action": "approve"},
    )
    assert review_resp.status_code == 200
    assert review_resp.json()["status"] == "approved"
    assert review_resp.json()["confidence"] >= 0.85


@pytest.mark.asyncio
async def test_quality_stats_treats_manual_review_as_relation_support(
    semantic_graph_client: AsyncClient,
):
    source_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "component", "canonical_name": "空气滤芯"},
    )
    target_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "maintenance_action", "canonical_name": "更换"},
    )
    assert source_resp.status_code == 201
    assert target_resp.status_code == 201
    relation_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/relations",
        json={
            "source_entity_id": source_resp.json()["id"],
            "target_entity_id": target_resp.json()["id"],
            "relation_type": "component_requires_action",
            "confidence": 0.4,
            "status": "pending_review",
        },
    )
    assert relation_resp.status_code == 201
    relation_id = relation_resp.json()["id"]

    before_resp = await semantic_graph_client.get(
        "/api/v1/knowledge/semantic-graph/quality-stats"
    )
    assert before_resp.status_code == 200
    assert before_resp.json()["relations_without_evidence_or_review"] == 1

    review_resp = await semantic_graph_client.post(
        f"/api/v1/knowledge/semantic-graph/relations/{relation_id}/reviews",
        json={"action": "approve", "review_note": "人工确认来自维修规范。"},
    )
    assert review_resp.status_code == 200

    after_resp = await semantic_graph_client.get(
        "/api/v1/knowledge/semantic-graph/quality-stats"
    )
    assert after_resp.status_code == 200
    stats = after_resp.json()
    assert stats["relations_without_evidence"] == 1
    assert stats["relations_without_evidence_or_review"] == 0
    assert stats["low_confidence_relations"] == 0


@pytest.mark.asyncio
async def test_duplicate_entity_recommendations_use_alias_overlap(
    semantic_graph_client: AsyncClient,
):
    spark_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "component", "canonical_name": "火花塞"},
    )
    plug_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "component", "canonical_name": "spark plug"},
    )
    pump_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "component", "canonical_name": "燃油泵"},
    )
    assert spark_resp.status_code == 201
    assert plug_resp.status_code == 201
    assert pump_resp.status_code == 201
    spark_id = spark_resp.json()["id"]
    plug_id = plug_resp.json()["id"]

    alias_resp = await semantic_graph_client.post(
        f"/api/v1/knowledge/semantic-graph/entities/{spark_id}/aliases",
        json={"alias_name": "spark plug", "alias_type": "english_name"},
    )
    assert alias_resp.status_code == 201

    rec_resp = await semantic_graph_client.get(
        "/api/v1/knowledge/semantic-graph/entities/duplicate-recommendations",
        params={"entity_type": "component", "min_score": 0.9},
    )
    assert rec_resp.status_code == 200
    items = rec_resp.json()["items"]
    assert any(
        {item["entity"]["id"], item["duplicate_entity"]["id"]} == {spark_id, plug_id}
        and item["score"] == 1.0
        for item in items
    )
    assert all(
        pump_resp.json()["id"] not in {item["entity"]["id"], item["duplicate_entity"]["id"]}
        for item in items
    )


@pytest.mark.asyncio
async def test_knowledge_search_returns_semantic_graph_context_and_evidence(
    semantic_graph_client: AsyncClient,
):
    session_factory = semantic_graph_client._semantic_session_factory
    async with session_factory() as session:
        document = KnowledgeDocument(
            title="启动困难与黑烟诊断",
            source_name="engine_graph_rag.pdf",
            source_type="manual",
            equipment_type="摩托车发动机",
            equipment_model="LX200",
            fault_type="启动困难",
            content="启动困难且排气冒黑烟时，应检查混合气过浓以及氧传感器信号。",
            status="published",
        )
        session.add(document)
        await session.flush()
        chunk = KnowledgeChunk(
            document_id=document.id,
            chunk_index=0,
            content=document.content,
            equipment_type=document.equipment_type,
            equipment_model=document.equipment_model,
            fault_type=document.fault_type,
            section_reference="诊断章节",
            page_reference="P8",
            source_modality="text",
            evidence_summary="图谱关系证据分段",
        )
        session.add(chunk)
        await session.commit()
        chunk_id = chunk.id

    symptom_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "fault_symptom", "canonical_name": "启动困难"},
    )
    cause_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "fault_cause", "canonical_name": "混合气过浓"},
    )
    component_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "component", "canonical_name": "氧传感器"},
    )
    assert symptom_resp.status_code == 201
    assert cause_resp.status_code == 201
    assert component_resp.status_code == 201

    symptom_id = symptom_resp.json()["id"]
    cause_id = cause_resp.json()["id"]
    component_id = component_resp.json()["id"]
    first_relation_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/relations",
        json={
            "source_entity_id": symptom_id,
            "target_entity_id": cause_id,
            "relation_type": "symptom_possible_cause",
            "confidence": 0.86,
            "status": "approved",
        },
    )
    second_relation_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/relations",
        json={
            "source_entity_id": cause_id,
            "target_entity_id": component_id,
            "relation_type": "cause_related_component",
            "confidence": 0.82,
            "status": "approved",
        },
    )
    assert first_relation_resp.status_code == 201
    assert second_relation_resp.status_code == 201
    evidence_resp = await semantic_graph_client.post(
        f"/api/v1/knowledge/semantic-graph/relations/{first_relation_resp.json()['id']}/evidence",
        json={"chunk_id": chunk_id, "excerpt": "启动困难且排气冒黑烟时，应检查混合气过浓。"},
    )
    assert evidence_resp.status_code == 201

    search_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/search",
        json={"query": "启动困难、排气管冒黑烟", "equipment_type": "摩托车发动机", "limit": 5},
    )
    assert search_resp.status_code == 200
    payload = search_resp.json()
    assert "semantic_graph_entity_link" in payload["retrieval_path"]
    assert payload["graph_context"]["matched_entities"][0]["canonical_name"] == "启动困难"
    enhanced_keywords = set(payload["graph_context"]["enhanced_keywords"])
    assert {"混合气过浓", "氧传感器"}.issubset(enhanced_keywords)
    relation_types = {item["relation_type"] for item in payload["graph_context"]["expanded_relations"]}
    assert {"symptom_possible_cause", "cause_related_component"}.issubset(relation_types)
    assert any(result["chunk_id"] == chunk_id for result in payload["results"])
    graph_result = next(result for result in payload["results"] if result["chunk_id"] == chunk_id)
    assert graph_result["score"] is not None
    reasoning_chain = payload["reasoning_chain"]
    assert reasoning_chain["question"] == "启动困难、排气管冒黑烟"
    assert reasoning_chain["matched_entities"][0]["canonical_name"] == "启动困难"
    assert reasoning_chain["expanded_relations"]
    assert reasoning_chain["evidence_chunks"][0]["chunk_id"] == chunk_id
    assert reasoning_chain["selected_answer_claims"]
    assert reasoning_chain["confidence"] == payload["answer_confidence"]
    assert isinstance(reasoning_chain["warnings"], list)
    assert payload["safety_warnings"]
    assert reasoning_chain["safety_warnings"] == payload["safety_warnings"]
    safety_codes = {item["code"] for item in payload["safety_warnings"]}
    assert "FUEL_SYSTEM_RISK" in safety_codes
    assert "GRAPH_RELATION_WITHOUT_EVIDENCE" in safety_codes
    assert "系统判断优先排查混合气过浓，是因为" in reasoning_chain["explanation_text"]

    filtered_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/search",
        json={
            "query": "启动困难、排气管冒黑烟",
            "equipment_type": "摩托车发动机",
            "graph_relation_types": ["symptom_possible_cause"],
            "limit": 5,
        },
    )
    assert filtered_resp.status_code == 200
    filtered_payload = filtered_resp.json()
    filtered_relation_types = {
        item["relation_type"] for item in filtered_payload["graph_context"]["expanded_relations"]
    }
    assert filtered_relation_types == {"symptom_possible_cause"}
    assert "氧传感器" not in set(filtered_payload["graph_context"]["enhanced_keywords"])


@pytest.mark.asyncio
async def test_knowledge_search_links_entity_by_name_similarity(
    semantic_graph_client: AsyncClient,
):
    symptom_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "fault_symptom", "canonical_name": "排气冒黑烟"},
    )
    cause_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/entities",
        json={"entity_type": "fault_cause", "canonical_name": "混合气过浓"},
    )
    assert symptom_resp.status_code == 201
    assert cause_resp.status_code == 201
    relation_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/semantic-graph/relations",
        json={
            "source_entity_id": symptom_resp.json()["id"],
            "target_entity_id": cause_resp.json()["id"],
            "relation_type": "symptom_possible_cause",
            "confidence": 0.86,
            "status": "approved",
        },
    )
    assert relation_resp.status_code == 201

    search_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/search",
        json={"query": "排气管黑烟", "equipment_type": "摩托车发动机", "limit": 5},
    )
    assert search_resp.status_code == 200
    payload = search_resp.json()
    assert payload["graph_context"]["matched_entities"][0]["canonical_name"] == "排气冒黑烟"
    assert payload["graph_context"]["matched_entities"][0]["match_type"] in {
        "exact_or_alias",
        "name_similarity",
    }
    assert payload["graph_context"]["matched_entities"][0]["match_score"] >= 0.72
    assert "混合气过浓" in set(payload["graph_context"]["enhanced_keywords"])


def test_semantic_entity_similarity_score_supports_near_entity_names():
    assert _semantic_entity_similarity_score(
        "排气管黑烟",
        [],
        ["排气冒黑烟"],
    ) >= 0.72


@pytest.mark.asyncio
async def test_knowledge_search_blocks_forbidden_live_ignition_check(
    semantic_graph_client: AsyncClient,
):
    search_resp = await semantic_graph_client.post(
        "/api/v1/knowledge/search",
        json={"query": "带电检查点火线圈是否可以", "equipment_type": "摩托车发动机", "limit": 5},
    )

    assert search_resp.status_code == 200
    payload = search_resp.json()
    blocking = [
        item for item in payload["safety_warnings"]
        if item["code"] == "FORBIDDEN_LIVE_IGNITION_CHECK"
    ]
    assert blocking
    assert blocking[0]["level"] == "blocking"
    assert payload["reasoning_chain"]["safety_warnings"] == payload["safety_warnings"]
