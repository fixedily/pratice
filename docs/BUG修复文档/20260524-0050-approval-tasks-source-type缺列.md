# BUG 修复报告

## 基本信息
- 日期：2026-05-24
- 报告人：Codex
- 模块/功能：后端数据库迁移 / 检修审批任务
- 严重级别（低/中/高）：高
- 影响范围：访问检修审批任务相关接口时，ORM 查询 `approval_tasks.source_type` 会因 SQLite 缺列失败。
 - 严重级别依据（是否阻断/可绕过/影响用户数）：阻断相关页面和接口查询，普通用户无法通过前端绕过。

## 问题描述
- 期望结果：启动或查询检修审批任务时，数据库结构与 SQLAlchemy 模型一致，查询正常返回。
- 实际结果：SQLite 抛出 `sqlalchemy.exc.OperationalError: no such column: approval_tasks.source_type`。

## 复现步骤（必须可复现）
1) 使用当前本地 `sensor_data.db` 启动后端或执行涉及 `ApprovalTask` 的查询。
2) 后端执行 `SELECT approval_tasks.source_type ... FROM approval_tasks`。
3) SQLite 返回 `no such column: approval_tasks.source_type`。

## 复现环境
- 设备/系统：Windows，本地 SQLite 开发库。
- 应用版本/配置：`DATABASE_URL` 使用默认 `sensor_data.db`；Alembic 当前版本为 `o8p9q0r1s2t3`。
- 相关依赖或外部条件：Alembic head 为 `p9q0r1s2t3u4`，本地库存在 `_alembic_tmp_approval_tasks` 残留表。

## 定位过程
- 关键线索：`approval_tasks` 表缺少 `source_type`、`agent_run_id`、`maintenance_task_id`、`risk_level`、`reason`、`payload`。
- 排查路径：检查 SQLAlchemy 模型、Alembic head、当前 SQLite `alembic_version` 和 `PRAGMA table_info(approval_tasks)`。
- 根因说明：本地 SQLite 停在旧迁移版本，且一次未完成的 Alembic batch migration 留下 `_alembic_tmp_approval_tasks`，导致 `alembic upgrade head` 重试时被临时表阻塞。

## 修复方案
- 修改点说明：在 `p9q0r1s2t3u4_agent_approval_tasks.py` 的 SQLite 升级流程开始前清理 Alembic batch 残留临时表。
- 影响评估：仅 SQLite 方言执行 `DROP TABLE IF EXISTS _alembic_tmp_approval_tasks`；PostgreSQL 等数据库不受影响。
- 风险点：若迁移中断发生在极端阶段，需要确认原始 `approval_tasks` 表仍存在；本次复现中原始表完整存在。
- 回滚方案：恢复迁移文件变更，并手动删除或重建本地 SQLite 开发库后重新迁移。

## 变更内容
- 代码/配置改动摘要：迁移脚本增加 SQLite 残留临时表清理；新增回归测试覆盖旧库加残留临时表的恢复迁移。
- 相关文件：
 - `backend/alembic/versions/p9q0r1s2t3u4_agent_approval_tasks.py`
 - `backend/tests/test_approval_task_migration_recovery.py`
 - 回归风险/可能受影响模块：检修审批任务迁移、SQLite 本地开发数据库初始化。

## 单元测试
- 新增/更新测试：`backend/tests/test_approval_task_migration_recovery.py`
- 若未补测试，原因说明：已补测试。

## 验证步骤（手动，逐步）
1) 在项目根目录执行 `cd backend`。
2) 执行 `..\venv\Scripts\python.exe -m alembic upgrade head`。
3) 执行 `..\venv\Scripts\python.exe -m alembic current`，确认输出为 `p9q0r1s2t3u4 (head)`。
4) 查询 `approval_tasks` 表结构，确认存在 `source_type`、`agent_run_id`、`maintenance_task_id`、`risk_level`、`reason`、`payload`。
5) 启动后端并进入原本报错的检修审批任务页面，确认不再出现 `no such column: approval_tasks.source_type`。

## 验证结果
- 结果说明：迁移已在本地 `sensor_data.db` 上执行成功；`approval_tasks` 新列存在；ORM `select(ApprovalTask).limit(1)` 查询通过。
- 是否通过：是

## 遗留问题/后续动作
- 当前仓库缺少 `specs/PROJECT-CONTEXT.md`，本次已按现有代码结构完成修复。
