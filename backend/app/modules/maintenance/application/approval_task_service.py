"""Approval gate operations for work-order steps and agent review stops."""
from __future__ import annotations

from datetime import datetime, timezone
from time import perf_counter
from typing import Any, Awaitable, Callable

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.metrics import increment_counter, observe_duration
from app.db.models.maintenance import (
    ApprovalTask,
    AuthUser,
    Role,
    UserNotification,
    UserRole,
    WorkOrder,
    WorkOrderEvent,
)
from app.modules.maintenance.datetime_util import to_iso_cn, utc_now_naive
from app.modules.maintenance.deps import CurrentUserCtx
from app.modules.maintenance.errors import MaintenanceAPIError

AuditCallback = Callable[[str, str, str, int | None, dict | None, str | None], Awaitable[None]]

APPROVAL_SOURCE_WORK_ORDER_STEP = "work_order_step"
APPROVAL_SOURCE_AGENT_REVIEW = "agent_review"
APPROVAL_RESOLUTION_BY_ACTION = {
    "approve": "approved",
    "reject": "rejected",
    "return": "returned",
}
APPROVAL_EVENT_BY_RESOLUTION = {
    "approved": "approval_approved",
    "rejected": "approval_rejected",
    "returned": "approval_returned",
}


def _approval_state(task: ApprovalTask) -> str:
    if task.status == "pending":
        return "pending"
    return task.resolution or task.status


def serialize_approval_task(task: ApprovalTask) -> dict[str, Any]:
    return {
        "id": task.id,
        "work_order_id": task.work_order_id,
        "step_no": task.step_no,
        "status": task.status,
        "resolution": task.resolution,
        "approval_state": _approval_state(task),
        "comment": task.comment,
        "material_attachment_ids": task.material_attachment_ids or [],
        "approver_user_id": task.approver_user_id,
        "source_type": task.source_type,
        "agent_run_id": task.agent_run_id,
        "maintenance_task_id": task.maintenance_task_id,
        "risk_level": task.risk_level,
        "reason": task.reason,
        "payload": task.payload or {},
        "resolved_at": to_iso_cn(task.resolved_at),
        "created_at": to_iso_cn(task.created_at),
        "updated_at": to_iso_cn(task.updated_at),
        "blocking": task.status == "pending" or task.resolution in {"rejected", "returned"},
    }


def _parse_work_order_id(raw: object) -> int | None:
    if raw is None:
        return None
    if isinstance(raw, int) and raw > 0:
        return raw
    text = str(raw).strip()
    if not text:
        return None
    digits = "".join(ch for ch in text if ch.isdigit())
    if not digits:
        return None
    parsed = int(digits)
    return parsed if parsed > 0 else None


class ApprovalTaskService:
    """Create, resolve, and enforce approval gates."""

    def __init__(self, session: AsyncSession, audit: AuditCallback | None = None) -> None:
        self.session = session
        self._audit = audit

    async def list_for_work_order(self, work_order_id: int) -> dict[str, Any]:
        rows = (
            await self.session.execute(
                select(ApprovalTask)
                .where(ApprovalTask.work_order_id == work_order_id)
                .order_by(ApprovalTask.id.desc())
            )
        ).scalars().all()
        return {
            "items": [serialize_approval_task(row) for row in rows],
            "total": len(rows),
            "page": 1,
            "page_size": max(len(rows), 1),
        }

    async def create_for_work_order(
        self,
        work_order_id: int,
        body: dict[str, Any],
        ctx: CurrentUserCtx,
    ) -> dict[str, Any]:
        work_order = await self.session.get(WorkOrder, work_order_id)
        if work_order is None:
            raise MaintenanceAPIError(404, "NOT_FOUND", "工单不存在")
        source_type = str(body.get("source_type") or APPROVAL_SOURCE_WORK_ORDER_STEP).strip()
        if source_type not in {APPROVAL_SOURCE_WORK_ORDER_STEP, APPROVAL_SOURCE_AGENT_REVIEW}:
            raise MaintenanceAPIError(400, "VALIDATION_ERROR", "source_type 非法")
        step_no = int(body.get("step_no") or work_order.current_step_no or 0)
        if source_type == APPROVAL_SOURCE_WORK_ORDER_STEP and step_no < 1:
            raise MaintenanceAPIError(400, "VALIDATION_ERROR", "step_no 必填")
        reason = str(body.get("reason") or body.get("comment") or "").strip()
        agent_run_id = str(body.get("agent_run_id") or "").strip() or None
        maintenance_task_id = body.get("maintenance_task_id")
        if maintenance_task_id in ("", None):
            maintenance_task_id = None
        else:
            maintenance_task_id = int(maintenance_task_id)
        task = await self._find_reusable_pending(
            work_order_id=work_order_id,
            step_no=step_no,
            source_type=source_type,
            agent_run_id=agent_run_id,
            maintenance_task_id=maintenance_task_id,
        )
        reused = task is not None
        if task is None:
            task = ApprovalTask(
                work_order_id=work_order_id,
                step_no=step_no,
                status="pending",
                source_type=source_type,
                agent_run_id=agent_run_id,
                maintenance_task_id=maintenance_task_id,
                risk_level=str(body.get("risk_level") or "").strip() or None,
                reason=reason or None,
                material_attachment_ids=body.get("material_attachment_ids") or [],
                payload=body.get("payload") if isinstance(body.get("payload"), dict) else {},
            )
            self.session.add(task)
            await self.session.flush()
            await self._record_requested_event(
                task,
                actor_user_id=ctx.user_id,
                reason=reason,
            )
            await self._notify_approvers(task, work_order)
            await increment_counter("approval_tasks_created_total", source_type=source_type)
        await self.session.commit()
        return {**serialize_approval_task(task), "reused": reused}

    async def create_or_reuse_agent_review(
        self,
        *,
        agent_run_id: str,
        work_order_id: object | None,
        maintenance_task_id: int | None,
        risk_level: str | None,
        reason: str,
        payload: dict[str, Any],
    ) -> dict[str, Any] | None:
        resolved_work_order_id = _parse_work_order_id(work_order_id)
        if resolved_work_order_id is None and maintenance_task_id is None:
            return None
        task = await self._find_reusable_pending(
            work_order_id=resolved_work_order_id,
            step_no=0,
            source_type=APPROVAL_SOURCE_AGENT_REVIEW,
            agent_run_id=agent_run_id,
            maintenance_task_id=maintenance_task_id,
        )
        reused = task is not None
        work_order = await self.session.get(WorkOrder, resolved_work_order_id) if resolved_work_order_id else None
        if task is None:
            task = ApprovalTask(
                work_order_id=resolved_work_order_id,
                step_no=int(getattr(work_order, "current_step_no", None) or 0),
                status="pending",
                source_type=APPROVAL_SOURCE_AGENT_REVIEW,
                agent_run_id=agent_run_id,
                maintenance_task_id=maintenance_task_id,
                risk_level=risk_level,
                reason=reason,
                payload=payload,
            )
            self.session.add(task)
            await self.session.flush()
            await self._record_requested_event(task, actor_user_id=None, reason=reason)
            if work_order is not None:
                await self._notify_approvers(task, work_order)
            await increment_counter("approval_tasks_created_total", source_type=APPROVAL_SOURCE_AGENT_REVIEW)
        await self.session.commit()
        return {**serialize_approval_task(task), "reused": reused}

    async def resolve(self, approval_task_id: int, body: dict[str, Any], ctx: CurrentUserCtx) -> dict[str, Any]:
        if not ctx.has_any("expert", "safety", "admin"):
            raise MaintenanceAPIError(403, "FORBIDDEN", "仅专家、安全员或管理员可审批")
        task = await self.session.get(ApprovalTask, approval_task_id)
        if task is None:
            raise MaintenanceAPIError(404, "NOT_FOUND", "审批任务不存在")
        action = str(body.get("action") or "").strip().lower()
        resolution = APPROVAL_RESOLUTION_BY_ACTION.get(action)
        if resolution is None:
            raise MaintenanceAPIError(400, "VALIDATION_ERROR", "action 仅支持 approve / reject / return")
        comment = str(body.get("comment") or "").strip()
        if not comment:
            raise MaintenanceAPIError(400, "VALIDATION_ERROR", "comment 必填")
        started = perf_counter()
        if task.status != "pending":
            raise MaintenanceAPIError(409, "APPROVAL_ALREADY_RESOLVED", "审批任务已处理")
        task.status = "resolved"
        task.resolution = resolution
        task.comment = comment
        task.approver_user_id = ctx.user_id
        task.resolved_at = utc_now_naive()
        task.updated_at = utc_now_naive()
        await self._record_resolution_event(task, ctx.user_id, comment)
        if self._audit is not None:
            await self._audit(
                "approval.resolved",
                "approval_task",
                str(task.id),
                ctx.user_id,
                {"resolution": resolution, "source_type": task.source_type},
                None,
            )
        await increment_counter("approval_tasks_resolved_total", source_type=task.source_type, resolution=resolution)
        await observe_duration(
            "approval_task_resolution_duration_ms",
            (perf_counter() - started) * 1000,
            source_type=task.source_type,
            resolution=resolution,
        )
        await self.session.commit()
        return serialize_approval_task(task)

    async def assert_no_blocking_agent_approval(
        self,
        *,
        work_order_id: int | None = None,
        maintenance_task_id: int | None = None,
    ) -> None:
        latest = await self._latest_agent_gate(work_order_id=work_order_id, maintenance_task_id=maintenance_task_id)
        if latest is None:
            return
        source_type = getattr(latest, "source_type", None)
        if source_type != APPROVAL_SOURCE_AGENT_REVIEW:
            return
        status = getattr(latest, "status", None)
        resolution = getattr(latest, "resolution", None)
        if status == "pending":
            await increment_counter("approval_task_blocked_actions_total", source_type=source_type, status="pending")
            raise MaintenanceAPIError(409, "AGENT_APPROVAL_PENDING", "Agent 高风险审批未完成")
        if resolution != "approved":
            await increment_counter(
                "approval_task_blocked_actions_total",
                source_type=source_type,
                status=resolution or status or "unknown",
            )
            raise MaintenanceAPIError(409, "AGENT_APPROVAL_REQUIRED", "Agent 审批未通过，禁止继续推进")

    async def assert_step_approved_if_required(
        self,
        *,
        work_order_id: int,
        step_no: int,
        requires_approval: bool,
    ) -> None:
        if not requires_approval:
            return
        latest = (
            await self.session.execute(
                select(ApprovalTask)
                .where(
                    ApprovalTask.work_order_id == work_order_id,
                    ApprovalTask.step_no == step_no,
                    ApprovalTask.source_type == APPROVAL_SOURCE_WORK_ORDER_STEP,
                )
                .order_by(ApprovalTask.id.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if latest is not None and latest.status == "resolved" and latest.resolution == "approved":
            return
        status_label = "missing" if latest is None else latest.status if latest.status == "pending" else latest.resolution
        await increment_counter("approval_task_blocked_actions_total", source_type=APPROVAL_SOURCE_WORK_ORDER_STEP, status=status_label)
        if latest is not None and latest.status == "pending":
            raise MaintenanceAPIError(409, "APPROVAL_PENDING", "当前高危工步审批未完成")
        raise MaintenanceAPIError(409, "APPROVAL_REQUIRED", "当前高危工步需要审批通过后才能确认")

    async def _find_reusable_pending(
        self,
        *,
        work_order_id: int | None,
        step_no: int,
        source_type: str,
        agent_run_id: str | None,
        maintenance_task_id: int | None,
    ) -> ApprovalTask | None:
        conditions = [ApprovalTask.source_type == source_type, ApprovalTask.status == "pending"]
        if source_type == APPROVAL_SOURCE_AGENT_REVIEW:
            matchers = []
            if agent_run_id:
                matchers.append(ApprovalTask.agent_run_id == agent_run_id)
            if work_order_id is not None:
                matchers.append(ApprovalTask.work_order_id == work_order_id)
            if maintenance_task_id is not None:
                matchers.append(ApprovalTask.maintenance_task_id == maintenance_task_id)
            if not matchers:
                return None
            conditions.append(or_(*matchers))
        else:
            conditions.extend([ApprovalTask.work_order_id == work_order_id, ApprovalTask.step_no == step_no])
        return (
            await self.session.execute(
                select(ApprovalTask).where(and_(*conditions)).order_by(ApprovalTask.id.desc()).limit(1)
            )
        ).scalar_one_or_none()

    async def _latest_agent_gate(
        self,
        *,
        work_order_id: int | None,
        maintenance_task_id: int | None,
    ) -> ApprovalTask | None:
        matchers = []
        if work_order_id is not None:
            matchers.append(ApprovalTask.work_order_id == work_order_id)
        if maintenance_task_id is not None:
            matchers.append(ApprovalTask.maintenance_task_id == maintenance_task_id)
        if not matchers:
            return None
        return (
            await self.session.execute(
                select(ApprovalTask)
                .where(ApprovalTask.source_type == APPROVAL_SOURCE_AGENT_REVIEW, or_(*matchers))
                .order_by(ApprovalTask.id.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def _record_requested_event(self, task: ApprovalTask, *, actor_user_id: int | None, reason: str) -> None:
        if task.work_order_id is None:
            return
        event_type = "agent_approval_requested" if task.source_type == APPROVAL_SOURCE_AGENT_REVIEW else "approval_requested"
        self.session.add(
            WorkOrderEvent(
                work_order_id=task.work_order_id,
                from_status=None,
                to_status="S7",
                event_type=event_type,
                payload={
                    "approval_task_id": task.id,
                    "step_no": task.step_no,
                    "source_type": task.source_type,
                    "agent_run_id": task.agent_run_id,
                    "maintenance_task_id": task.maintenance_task_id,
                    "risk_level": task.risk_level,
                    "reason": reason,
                },
                actor_user_id=actor_user_id,
            )
        )

    async def _record_resolution_event(self, task: ApprovalTask, actor_user_id: int, comment: str) -> None:
        if task.work_order_id is None:
            return
        self.session.add(
            WorkOrderEvent(
                work_order_id=task.work_order_id,
                from_status=None,
                to_status="S7",
                event_type=APPROVAL_EVENT_BY_RESOLUTION[task.resolution or "approved"],
                payload={
                    "approval_task_id": task.id,
                    "step_no": task.step_no,
                    "source_type": task.source_type,
                    "agent_run_id": task.agent_run_id,
                    "maintenance_task_id": task.maintenance_task_id,
                    "resolution": task.resolution,
                    "comment": comment,
                },
                actor_user_id=actor_user_id,
            )
        )

    async def _notify_approvers(self, task: ApprovalTask, work_order: WorkOrder) -> None:
        user_ids = {
            uid
            for uid in [
                work_order.assigned_safety_user_id,
                work_order.assigned_expert_user_id,
            ]
            if uid
        }
        role_rows = (
            await self.session.execute(
                select(AuthUser.id)
                .join(UserRole, UserRole.user_id == AuthUser.id)
                .join(Role, Role.id == UserRole.role_id)
                .where(AuthUser.is_active.is_(True), AuthUser.status == "active", Role.code.in_(["admin", "expert", "safety"]))
                .limit(20)
            )
        ).all()
        user_ids.update(int(row[0]) for row in role_rows)
        now = utc_now_naive()
        for user_id in user_ids:
            self.session.add(
                UserNotification(
                    user_id=user_id,
                    kind="approval_pending",
                    source_key=f"approval_task:{task.id}",
                    title="高风险操作待审批",
                    detail=f"工单 WO-{int(work_order.id):06d} 有一项高风险操作等待审批。",
                    link_url=f"/tickets/{work_order.id}",
                    is_read=False,
                    created_at=now,
                    updated_at=now,
                )
            )
