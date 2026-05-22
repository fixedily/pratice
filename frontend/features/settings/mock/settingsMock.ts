export type Tone = "success" | "warning" | "danger" | "neutral";

export type StatusCardData = {
  title: string;
  value: string;
  detail: string;
  tone: Tone;
};

export type MetricItem = {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
};

export type ConfigField = {
  label: string;
  value: string;
  hint?: string;
  sensitive?: boolean;
};

export type ToggleItem = {
  label: string;
  enabled: boolean;
  description: string;
};

export type AgentItem = {
  name: string;
  role: string;
  status: string;
  enabled: boolean;
};

export type RoleItem = {
  role: string;
  scope: string;
  users: string;
};

export type IntegrationItem = {
  name: string;
  category: string;
  status: string;
  endpoint: string;
  tone: Tone;
};

export type LogItem = {
  type: string;
  actor: string;
  action: string;
  time: string;
};

export const basicSettings: ConfigField[] = [
  { label: "系统名称", value: "FaultDiag 工业设备故障诊断与检修闭环系统" },
  { label: "企业/项目名称", value: "制造产线设备检修智能化试点" },
  { label: "默认设备类型", value: "发动机 / 机泵 / 电机类设备" },
  { label: "默认检修等级", value: "L2 标准检修" },
  { label: "时区", value: "Asia/Shanghai" },
  { label: "数据保留策略", value: "工单与审计日志保留 365 天，模型调用摘要保留 90 天" },
];

export const modelFields: ConfigField[] = [
  { label: "供应商", value: "OpenAI Compatible / DeepSeek / Qwen / 本地 Ollama" },
  { label: "对话模型", value: "deepseek-chat" },
  { label: "视觉模型", value: "qwen-vl-plus" },
  { label: "Embedding 模型", value: "text-embedding-v3" },
  { label: "Rerank 模型", value: "bge-reranker-v2-m3" },
  { label: "API Base", value: "https://api.example.com/v1" },
  { label: "API Key", value: "sk-********************9f3a", sensitive: true },
  { label: "temperature", value: "0.2" },
  { label: "max_tokens", value: "4096" },
];

export const ragToggles: ToggleItem[] = [
  { label: "Query Rewrite", enabled: true, description: "将现场描述改写为适合检修语义检索的问题。" },
  { label: "Multi-Query", enabled: true, description: "从故障现象、部件和维修动作生成多路召回。" },
  { label: "HyDE", enabled: false, description: "生成假设性维修说明以补强弱查询召回。" },
  { label: "Rerank", enabled: true, description: "对向量与关键词召回结果进行工业语义重排。" },
  { label: "Sentence Window", enabled: true, description: "返回命中句相邻上下文，降低断章取义风险。" },
  { label: "引用来源", enabled: true, description: "回答必须展示手册、案例或工单证据来源。" },
  { label: "无依据拒答", enabled: true, description: "证据不足时拒绝给出确定性维修结论。" },
  { label: "低置信度人工确认", enabled: true, description: "关键操作建议进入专家复核或安全确认。" },
];

export const agentItems: AgentItem[] = [
  { name: "感知 Agent", role: "解析故障文本、图片、设备型号与现场上下文。", status: "运行中", enabled: true },
  { name: "诊断 Agent", role: "结合 RAG 证据生成故障原因、风险等级与检修建议。", status: "运行中", enabled: true },
  { name: "规划 Agent", role: "把诊断结果转为工单步骤、工具材料与安全确认项。", status: "待接入", enabled: false },
  { name: "审核 Agent", role: "检查回答证据、风险提示和流程合规性。", status: "运行中", enabled: true },
  { name: "知识库 Agent", role: "从案例与标注中抽取实体、关系和可复用经验。", status: "运行中", enabled: true },
];

export const alertToggles: ToggleItem[] = [
  { label: "站内通知", enabled: true, description: "工单分派、诊断完成、审核待办通过站内消息触达。" },
  { label: "邮件通知", enabled: false, description: "面向主管和专家的跨班组通知通道。" },
  { label: "企业微信", enabled: false, description: "对接企业即时通讯，支撑现场移动协同。" },
  { label: "工单超时", enabled: true, description: "超过 SLA 自动提醒负责人并记录审计。" },
  { label: "设备异常", enabled: true, description: "设备状态异常可触发诊断或工单创建。" },
  { label: "诊断完成", enabled: true, description: "模型完成初诊后通知检修员和专家。" },
  { label: "重复告警合并", enabled: true, description: "同设备、同故障窗口期内合并提醒，降低噪声。" },
];

export const workflowSteps = [
  "异常告警",
  "智能诊断",
  "生成工单",
  "维修处理",
  "验收确认",
  "案例沉淀",
];

export const roleItems: RoleItem[] = [
  { role: "系统管理员", scope: "系统配置、用户权限、部署运维、审计导出", users: "2 人" },
  { role: "检修主管", scope: "工单分派、进度监管、异常升级、绩效统计", users: "4 人" },
  { role: "检修工程师", scope: "执行工单、确认步骤、提交案例与现场附件", users: "18 人" },
  { role: "设备管理员", scope: "维护设备台账、设备型号、位置与责任专家", users: "5 人" },
  { role: "知识管理员", scope: "知识导入、审核发布、图谱维护、版本管理", users: "3 人" },
  { role: "普通查看者", scope: "只读查看工单、知识和运行报告", users: "12 人" },
];

export const integrationItems: IntegrationItem[] = [
  { name: "模型 API", category: "智能服务", status: "已配置", endpoint: "/v1/chat/completions", tone: "success" },
  { name: "知识库目录", category: "文件存储", status: "可访问", endpoint: "maintenance_uploads/", tone: "success" },
  { name: "设备台账数据库", category: "主数据", status: "待对接", endpoint: "asset_db.devices", tone: "warning" },
  { name: "SCADA", category: "实时数据", status: "规划中", endpoint: "opc.tcp://scada.local", tone: "neutral" },
  { name: "MES", category: "生产系统", status: "规划中", endpoint: "https://mes.example.local", tone: "neutral" },
  { name: "ERP", category: "经营系统", status: "未启用", endpoint: "https://erp.example.local", tone: "neutral" },
  { name: "CMMS", category: "维修系统", status: "待联调", endpoint: "https://cmms.example.local", tone: "warning" },
];

export const evaluationMetrics: MetricItem[] = [
  { label: "CRUD_RAG", value: "82.4", hint: "配置类知识问答综合得分", tone: "success" },
  { label: "DomainRAG", value: "78.9", hint: "设备检修领域问答得分", tone: "success" },
  { label: "Recall@5", value: "0.84", hint: "前 5 条命中参考证据比例", tone: "success" },
  { label: "MRR", value: "0.71", hint: "首个相关证据排名质量", tone: "success" },
  { label: "NDCG", value: "0.79", hint: "证据排序质量", tone: "success" },
  { label: "Faithfulness", value: "0.88", hint: "回答忠实于证据程度", tone: "success" },
  { label: "Answer Relevance", value: "0.86", hint: "回答与检修问题相关性", tone: "success" },
];

export const logItems: LogItem[] = [
  { type: "登录日志", actor: "admin", action: "登录系统设置中心", time: "2026-05-16 09:20" },
  { type: "操作日志", actor: "expert_01", action: "审核通过知识图谱关系", time: "2026-05-16 09:05" },
  { type: "模型调用日志", actor: "diagnosis-agent", action: "完成工单 #1042 诊断", time: "2026-05-16 08:44" },
  { type: "知识库更新日志", actor: "knowledge-admin", action: "重建检修手册向量索引", time: "2026-05-15 18:12" },
  { type: "工单流转日志", actor: "worker_07", action: "提交验收确认", time: "2026-05-15 17:36" },
  { type: "系统异常日志", actor: "system", action: "外部 CMMS 接口超时", time: "2026-05-15 16:10" },
];

export const deploymentChecks: MetricItem[] = [
  { label: "后端服务", value: "待检查", hint: "FastAPI readiness", tone: "neutral" },
  { label: "数据库", value: "待检查", hint: "SQLAlchemy 连接池", tone: "neutral" },
  { label: "向量库", value: "已配置", hint: "FAISS / pgvector", tone: "success" },
  { label: "文件存储", value: "可写", hint: "上传目录权限", tone: "success" },
  { label: "模型服务", value: "配置检查", hint: "LLM / Embedding / Rerank", tone: "warning" },
  { label: "目标 CPU 架构 适配", value: "部署验收项", hint: "目标环境检查", tone: "warning" },
  { label: "Linux", value: "部署验收项", hint: "V11 / V10", tone: "warning" },
];
