# GraphRAG 升级执行计划

## 目标

将当前系统从“文档切片检索 + 文档关系图谱展示”升级为面向多模态装备检修的实体级 GraphRAG 系统。

升级后的系统应具备：

- 实体级检修知识组织：故障现象、故障原因、部件、维修动作、文档证据等成为一等节点。
- 图谱增强检索：用户问题先做实体识别与图谱扩展，再结合向量检索召回证据。
- 多跳推理能力：支持从现象追溯原因、部件、检测方法、维修动作和证据文档。
- 可解释输出：每个检修建议都能展示推理路径、证据来源、置信度和安全提示。
- 可持续维护：实体抽取、关系抽取、人工审核、实体归一化、图谱修正形成闭环。

## 总体原则

- 保留当前文档图谱，不推倒重来。
- 在现有“任务-文档-分段”之上新增实体语义层。
- 先做稳定的 5 类核心实体，再扩展工具、安全风险、标准参数、历史案例。
- 所有图谱结论必须能回溯到文档分段、历史案例或人工确认记录。
- 自动抽取结果默认带置信度，低置信度进入待审核区，避免污染正式图谱。

## 目标架构

```text
文档上传 / 案例导入 / 多模态资料
-> 文档解析与切片
-> 实体抽取与关系抽取
-> 实体归一化与人工审核
-> 实体级知识图谱
-> 用户问题实体识别
-> 图谱多跳扩展
-> 向量检索补充
-> 证据重排序
-> 检修方案生成
-> 推理链与证据可视化
```

## 阶段一：补齐实体图谱数据底座

Status: completed

目标：保留现有文档图谱，新增实体和关系数据结构，为 GraphRAG 做底座。

### 1.1 保留现有文档图谱

- [ ] 保留现有检修任务、知识文档、知识分段节点。
- [ ] 保留现有任务、文档、分段之间的引用关系。
- [ ] 前端保留当前文档图谱视图，作为资料组织视角。

### 1.2 新增实体表

- [x] 新增 `kg_entities` 表。
- [ ] 字段建议：

```text
id
name
normalized_name
type
aliases
description
confidence
status
source
created_at
updated_at
```

- [ ] 第一批实体类型：

```text
fault_symptom       故障现象
fault_cause         故障原因
component           部件
maintenance_action  维修动作
knowledge_chunk     文档分段证据
```

### 1.3 新增实体关系表

- [x] 新增 `kg_relations` 表。
- [ ] 字段建议：

```text
id
source_entity_id
target_entity_id
relation_type
confidence
status
evidence_chunk_id
evidence_text
created_at
updated_at
```

- [ ] 第一批关系类型：

```text
symptom_possible_cause      现象 -> 可能原因 -> 原因
cause_related_component     原因 -> 关联部件 -> 部件
symptom_check_component     现象 -> 排查部件 -> 部件
component_action            部件 -> 检修动作 -> 维修动作
action_applies_to           维修动作 -> 适用于 -> 部件
entity_evidenced_by_chunk   实体 -> 证据来自 -> 文档分段
relation_evidenced_by_chunk 关系 -> 证据来自 -> 文档分段
```

### 1.4 新增实体别名表

- [x] 新增 `kg_entity_aliases` 表。
- [x] 支持同义词、简称、英文名、型号别名。
- [ ] 示例：

```text
火花塞 / 火嘴 / 点火塞 / spark plug
化油器 / carburetor
氧传感器 / O2 sensor
```

### 1.5 验收标准

- [x] 可以在数据库中存储实体节点和实体关系。
- [x] 实体和关系均可绑定原始文档分段证据。
- [x] 同一个实体可维护多个别名。
- [ ] 当前文档 RAG 功能不受影响。

### 1.6 已落地后端接口

- [x] `GET /api/v1/knowledge/semantic-graph`
- [x] `GET /api/v1/knowledge/semantic-graph/entities`
- [x] `POST /api/v1/knowledge/semantic-graph/entities`
- [x] `GET /api/v1/knowledge/semantic-graph/entities/{entity_id}`
- [x] `PATCH /api/v1/knowledge/semantic-graph/entities/{entity_id}`
- [x] `POST /api/v1/knowledge/semantic-graph/entities/{entity_id}/aliases`
- [x] `POST /api/v1/knowledge/semantic-graph/entities/{entity_id}/reviews`
- [x] `GET /api/v1/knowledge/semantic-graph/neighbors`
- [x] `POST /api/v1/knowledge/semantic-graph/relations`
- [x] `GET /api/v1/knowledge/semantic-graph/relations/{relation_id}`
- [x] `PATCH /api/v1/knowledge/semantic-graph/relations/{relation_id}`
- [x] `POST /api/v1/knowledge/semantic-graph/relations/{relation_id}/evidence`
- [x] `POST /api/v1/knowledge/semantic-graph/relations/{relation_id}/reviews`
- [x] `GET /api/v1/knowledge/semantic-graph/stats`

### 1.7 已完成验证

- [x] 语义图谱维护接口端到端测试：创建实体、添加别名、创建关系、添加证据、审核关系、查询图谱。
- [x] 重复实体唯一性校验：同一 `entity_type + canonical_name` 返回 400。
- [x] Alembic 单 head 检查通过。

## 阶段二：实体抽取与关系抽取流水线

Status: in_progress

目标：从检修手册、历史工单、案例记录中自动抽取实体与关系。

### 2.1 抽取流程

- [x] 文档上传后进入抽取任务队列。
- [x] 对知识分段逐段执行实体抽取。
- [x] 对包含多个实体的分段执行关系抽取。
- [x] 抽取结果绑定来源分段和原文证据。
- [x] 低置信度结果进入待审核状态。

### 2.2 抽取输出格式

建议统一为结构化 JSON：

```json
{
  "entities": [
    {
      "name": "发动机启动困难",
      "type": "fault_symptom",
      "aliases": ["启动困难"],
      "confidence": 0.91,
      "evidence": "发动机出现启动困难时，应检查..."
    }
  ],
  "relations": [
    {
      "source": "发动机启动困难",
      "target": "混合气过浓",
      "type": "symptom_possible_cause",
      "confidence": 0.86,
      "evidence": "启动困难并伴随冒黑烟，可能为混合气过浓。"
    }
  ]
}
```

### 2.3 人工审核机制

- [x] 新增待审核实体列表。
- [x] 新增待审核关系列表。
- [x] 支持确认、驳回。
- [ ] 支持编辑、合并。
- [x] 已确认内容进入正式图谱。

### 2.4 验收标准

- [x] 上传一份检修文档后，可以自动生成实体和关系草稿。
- [x] 每个实体和关系都有来源分段。
- [x] 人工可以确认或驳回抽取结果。
- [x] 已确认的实体关系能出现在知识图谱页面中。

### 2.5 已落地后端接口

- [x] `POST /api/v1/knowledge/semantic-graph/extraction-jobs`
- [x] `POST /api/v1/knowledge/semantic-graph/documents/{document_id}/extraction-jobs`
- [x] `GET /api/v1/knowledge/semantic-graph/extraction-candidates`
- [x] `POST /api/v1/knowledge/semantic-graph/extraction-candidates/{candidate_id}/reviews`

### 2.6 已完成验证

- [x] 创建抽取任务并写入实体候选。
- [x] 查询待审核候选列表。
- [x] 审核通过实体候选后生成正式实体和别名。
- [x] 审核通过关系候选后生成正式关系和证据。
- [x] 从知识文档分段规则抽取实体候选和关系候选。
- [x] 审核通过名称型关系候选后自动解析或创建端点实体。
- [x] 创建知识文档后自动触发语义图谱候选抽取。

## 阶段三：实体归一化与图谱清洗

Status: in_progress

目标：避免同义实体重复、错误关系堆积，保证图谱长期可用。

### 3.1 实体归一化

- [x] 实现 `type + normalized_name` 唯一性策略。
- [x] 支持按别名命中已有实体。
- [ ] 支持按向量相似度推荐可能重复实体。
- [x] 支持按标准名和别名相似度推荐可能重复实体。
- [x] 支持人工合并重复实体。

### 3.2 关系去重

- [x] 同一 source、target、relation_type 的关系合并证据。
- [x] 多个证据分段可共同支撑同一条关系。
- [x] 关系置信度可随证据数量和人工确认状态更新。

### 3.3 图谱质量指标

- [x] 统计重复实体数量。
- [x] 统计待审核实体/关系数量。
- [x] 统计无证据关系数量。
- [x] 统计低置信度关系数量。

### 3.4 验收标准

- [x] “火花塞 / 火嘴 / spark plug” 能归一到同一实体。
- [x] 同一关系不会因为多段文档重复抽取而无限膨胀。
- [x] 每条正式关系至少有一条证据或人工确认记录。

### 3.5 已落地后端接口

- [x] `POST /api/v1/knowledge/semantic-graph/entities/{entity_id}/merge`
- [x] `GET /api/v1/knowledge/semantic-graph/quality-stats`
- [x] `GET /api/v1/knowledge/semantic-graph/entities/duplicate-recommendations`

### 3.6 已完成验证

- [x] 合并实体时迁移别名，并将源实体标准名写入目标别名。
- [x] 合并实体时迁移关系端点。
- [x] 合并后重复关系会合并证据并删除重复边。
- [x] 名称型实体候选和关系端点解析支持按别名命中已有实体。
- [x] 质量统计覆盖待审核候选、无证据关系和低置信度关系。
- [x] 疑似重复实体推荐支持标准名、显示名和别名重叠匹配。
- [x] 新增关系证据或人工确认后自动刷新关系置信度。
- [x] 质量统计可区分“无证据关系”和“既无证据也无人工确认的关系”。

## 阶段四：GraphRAG 检索链路

Status: in_progress

目标：将问答从纯向量检索升级为“实体识别 + 图谱扩展 + 向量补充”的 GraphRAG。

### 4.1 用户问题解析

- [x] 识别问题中的故障现象、部件、动作、标准参数等实体。
- [x] 将问题实体链接到 `kg_entities`。
- [x] 无法精确命中时，使用别名和向量相似度召回候选实体。
- [x] 无法精确命中时，使用标准名、显示名和别名文本召回候选实体。
- [x] 无法精确命中时，使用标准名、显示名和别名相似度召回候选实体。

### 4.2 图谱多跳扩展

- [x] 从命中实体出发进行 1-2 跳扩展。
- [ ] 优先扩展以下路径：

```text
故障现象 -> 可能原因 -> 故障原因
故障原因 -> 关联部件 -> 部件
部件 -> 检修动作 -> 维修动作
实体/关系 -> 证据来自 -> 文档分段
```

- [x] 支持按置信度、人工确认状态过滤。
- [x] 支持按关系类型过滤。

### 4.3 向量检索融合

- [x] 保留现有向量检索。
- [x] 将图谱扩展得到的实体、原因、部件、动作作为查询增强词。
- [x] 合并图谱证据分段与向量召回分段。
- [x] 对证据进行重排序。

### 4.4 生成上下文结构

传给大模型的上下文建议分区：

```text
用户问题
命中实体
候选故障原因
关联部件
推荐检测/维修动作
证据文档分段
历史案例
安全注意事项
```

### 4.5 验收标准

- [x] 用户输入“启动困难、排气管冒黑烟”时，系统能扩展到“混合气过浓、化油器、氧传感器”等相关节点。
- [x] 回答中能引用图谱路径和文档分段。
- [x] 纯向量召回不足时，图谱扩展能补充相关证据。

### 4.6 已落地后端能力

- [x] `/api/v1/knowledge/search` 响应新增 `graph_context`。
- [x] `graph_context.matched_entities` 返回问题命中的语义实体。
- [x] `graph_context.expanded_relations` 返回 1-2 跳扩展关系、路径端点和证据分段 ID。
- [x] `graph_context.enhanced_keywords` 返回图谱扩展得到的查询增强词。
- [x] 图谱证据分段会并入检索结果，检索路径标记为 `semantic_graph_evidence`。
- [x] 搜索请求支持通过 `graph_relation_types` 限制语义图谱扩展关系类型。
- [x] 图谱证据分段按原检索分、关系置信度和增强词覆盖进行融合排序。
- [x] `graph_context.matched_entities` 返回实体匹配方式和匹配分数。

## 阶段五：可解释推理链展示

Status: in_progress

目标：展示每次问答背后的推理子图，而不是只展示全量知识图谱。

### 5.1 推理链数据结构

- [x] 为每次问答保存推理链。
- [x] 推理链包含：

```text
question
matched_entities
expanded_relations
evidence_chunks
selected_answer_claims
confidence
warnings
```

- [x] 检索响应返回 `reasoning_chain`。
- [x] Agent 协作运行将 `reasoning_chain` 写入 `AgentRun.payload`。

### 5.2 推理子图页面

- [x] 展示“问题 -> 现象 -> 原因 -> 部件 -> 动作 -> 证据”的子图。
- [x] 每条边展示关系类型、置信度、证据来源。
- [x] 点击证据节点可以查看原文分段。
- [x] 任务详情 API 返回最近一次诊断的 `reasoning_chain`。

### 5.3 答案解释文本

- [x] 在检索响应中加入“依据说明”。
- [x] 在最终自然语言回答中加入“依据说明”。
- [x] 输出格式示例：

```text
系统判断优先排查化油器，是因为：
1. 问题中命中了“启动困难”和“冒黑烟”两个故障现象。
2. 图谱中这两个现象共同指向“混合气过浓”。
3. “混合气过浓”关联排查部件包括“化油器”和“氧传感器”。
4. 对应证据来自《发动机检修手册》第 3.2 节。
```

### 5.4 验收标准

- [x] 每次问答都能展示推理子图。
- [x] 用户能看到每个建议对应的证据来源。
- [x] 回答不是“模型直接说”，而是“基于图谱路径和证据生成”。

## 阶段六：安全审核与工业可信机制

Status: pending

目标：让系统具备工业场景下的安全边界和可信输出能力。

### 6.1 新增安全相关实体

- [ ] 新增 `safety_risk` 安全风险。
- [ ] 新增 `standard_parameter` 标准参数。
- [ ] 新增 `forbidden_action` 禁忌操作。
- [ ] 新增 `applicable_condition` 适用条件。

### 6.2 生成前安全审核

- [ ] 检查是否涉及高压、电气、燃油、吊装等危险操作。
- [ ] 检查是否缺少关键标准参数。
- [ ] 检查是否缺少证据来源。
- [ ] 检查是否包含低置信度推理。

### 6.3 输出策略

- [ ] 高风险操作必须提示专业人员执行。
- [ ] 低证据结论必须标记为“建议排查”，不能写成确定结论。
- [ ] 缺少标准参数时，应提示查阅标准文件或人工复核。

### 6.4 验收标准

- [ ] 涉及高风险维修时，答案自动加入安全提示。
- [ ] 无证据结论不会以确定语气输出。
- [ ] 安全审核结果能在推理链中展示。

## 阶段七：多智能体协同

Status: pending

目标：在图谱和 GraphRAG 稳定后，再接入多智能体分工。

建议分工：

```text
文档解析 Agent：解析文本、图片、表格、检修记录。
实体抽取 Agent：抽取故障现象、部件、原因、动作。
实体归一化 Agent：合并同义实体，维护别名。
图谱推理 Agent：执行多跳路径搜索和候选原因推断。
证据检索 Agent：召回文档分段和历史案例。
方案生成 Agent：生成检修步骤和排查建议。
安全审核 Agent：检查风险操作、标准参数和证据强度。
解释生成 Agent：生成推理链说明和演示展示文本。
```

验收标准：

- [ ] 每个 Agent 有明确输入、输出和失败处理。
- [ ] Agent 之间通过结构化数据交接，不直接堆长文本。
- [ ] 所有关键结论仍然回写图谱或绑定证据。

## 推荐排期

### 第 1 周：数据结构升级

- [ ] 新增实体、关系、别名、证据绑定表。
- [ ] 后端提供基础 CRUD。
- [ ] 前端能展示实体图谱。
- [ ] 当前文档图谱不受影响。

### 第 2 周：实体/关系抽取流水线

- [ ] 对已有文档批量抽取 5 类实体。
- [ ] 抽取 6-8 类核心关系。
- [ ] 抽取结果进入待审核区。
- [ ] 已确认结果进入正式图谱。

### 第 3 周：GraphRAG 检索链路

- [ ] 用户问题实体识别。
- [ ] 实体链接。
- [ ] 一跳/二跳图谱扩展。
- [ ] 证据分段召回。
- [ ] 向量检索融合。
- [ ] 答案生成 Prompt 改造。

### 第 4 周：推理链可视化与可信输出

- [ ] 问答推理子图。
- [ ] 证据引用。
- [ ] 置信度展示。
- [ ] 安全风险提示。
- [ ] 答案来源说明。

## 近期优先执行清单

### P0：先定数据模型

- [ ] 确认 `kg_entities` 字段。
- [ ] 确认 `kg_relations` 字段。
- [ ] 确认 `kg_entity_aliases` 字段。
- [ ] 确认实体状态枚举：draft / confirmed / rejected / merged。
- [ ] 确认关系状态枚举：draft / confirmed / rejected。

### P0：先跑通 5 类实体

- [ ] 故障现象。
- [ ] 故障原因。
- [ ] 部件。
- [ ] 维修动作。
- [ ] 文档分段。

### P1：做一个真实闭环样例

样例问题：

```text
摩托车启动困难，排气管冒黑烟怎么修？
```

期望链路：

```text
启动困难 + 排气管冒黑烟
-> 混合气过浓
-> 化油器 / 氧传感器 / 空气滤清器
-> 检查阻风门 / 清洗喷嘴 / 检测传感器
-> 引用维修手册分段和历史案例
```

### P1：前端展示从“全图”转向“推理子图”

- [ ] 保留全量知识图谱视图。
- [ ] 新增问答推理链视图。
- [ ] 支持查看每条边的证据。

## 是否真实可用的验收指标

- [ ] 同义实体能合并。
- [ ] 每个正式结论有证据分段。
- [ ] 图谱能做二跳推理。
- [ ] 错误实体和关系能人工修正。
- [ ] 问答能展示推理路径。
- [ ] 高风险维修有安全提示。
- [ ] 新增文档能持续更新图谱。
- [ ] 图谱质量有可观测指标。

## 风险与规避

| 风险 | 表现 | 规避策略 |
| ---- | ---- | ---- |
| 图谱被低质量抽取污染 | 错误实体和关系越来越多 | 低置信度进入待审核，正式图谱只接收确认结果 |
| 同义实体重复 | 火花塞、火嘴、spark plug 分裂成多个节点 | 别名表、归一化字段、人工合并 |
| 图谱只做展示 | 问答仍只靠向量检索 | GraphRAG 链路必须把图谱扩展结果加入召回上下文 |
| 推理链不可解释 | 答案有建议但没有依据 | 每条关系绑定证据分段和置信度 |
| 多智能体过早接入 | 架构复杂但结果不稳定 | 先跑通图谱和 GraphRAG，再拆 Agent |

## 当前下一步

优先完成数据模型设计和迁移脚本：

```text
kg_entities
kg_relations
kg_entity_aliases
实体/关系与知识分段证据绑定
```

完成后再进入实体抽取流水线开发。
