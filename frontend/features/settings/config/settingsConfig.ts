import {
  Activity,
  BellRing,
  Bot,
  BrainCircuit,
  ClipboardCheck,
  Database,
  Gauge,
  KeyRound,
  Library,
  Network,
  ScrollText,
  ServerCog,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export type SettingsPanelId =
  | "overview"
  | "basic"
  | "models"
  | "knowledge"
  | "rag"
  | "agents"
  | "alerts"
  | "workflow"
  | "roles"
  | "interfaces"
  | "evaluation"
  | "audit"
  | "deployment";

export type SettingsMenuItem = {
  id: SettingsPanelId;
  label: string;
  description: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

export const settingsMenuItems: SettingsMenuItem[] = [
  { id: "overview", label: "能力总览", description: "场景能力与企业运行态势", icon: Gauge },
  { id: "basic", label: "基础设置", description: "平台基础信息与业务默认值", icon: Settings },
  { id: "models", label: "模型服务", description: "大模型、Embedding 与重排服务", icon: BrainCircuit, adminOnly: true },
  { id: "knowledge", label: "知识库设置", description: "手册、案例、索引与图谱治理", icon: Library, adminOnly: true },
  { id: "rag", label: "RAG 检索设置", description: "混合检索、重排与证据策略", icon: Network, adminOnly: true },
  { id: "agents", label: "智能体设置", description: "感知、诊断、规划与审核协同", icon: Bot, adminOnly: true },
  { id: "alerts", label: "告警通知设置", description: "站内、邮件与企业微信通知", icon: BellRing, adminOnly: true },
  { id: "workflow", label: "工单流程设置", description: "诊断到验收的标准作业流程", icon: ClipboardCheck, adminOnly: true },
  { id: "roles", label: "权限角色设置", description: "组织角色与权限边界", icon: ShieldCheck },
  { id: "interfaces", label: "数据源与接口", description: "SCADA、MES、ERP、CMMS 集成", icon: Database, adminOnly: true },
  { id: "evaluation", label: "评测与监控", description: "RAG 质量与平台运行指标", icon: Activity, adminOnly: true },
  { id: "audit", label: "日志审计", description: "操作、模型、知识与工单追踪", icon: ScrollText, adminOnly: true },
  { id: "deployment", label: "部署运维", description: "国产化部署与服务健康检查", icon: ServerCog },
];

export const settingsBackendRoadmap = [
  "GET /api/v1/maintenance/admin/settings-runtime：运行环境、国产化适配与服务依赖状态。",
  "GET /api/v1/maintenance/admin/settings-models：模型供应商、脱敏密钥、模型连通性与调用限额。",
  "GET /api/v1/maintenance/admin/settings-retrieval：RAG 策略、GraphRAG 状态与检索质量指标。",
  "GET /api/v1/maintenance/admin/settings-integrations：SCADA、MES、ERP、CMMS 等数据源状态。",
  "POST /api/v1/maintenance/admin/checks/model-connectivity：模型服务测试连接。",
  "POST /api/v1/maintenance/admin/checks/deployment：目标 CPU 架构 与Linux部署验收检查。",
  "PATCH /api/v1/maintenance/admin/system-configs/{key}：保存非敏感配置并记录审计日志。",
];

export const saveHint = {
  icon: KeyRound,
  title: "配置保存策略",
  description: "当前版本仅做前端保存提示。真实接入后，普通配置写入 system_configs，敏感密钥通过服务器侧环境变量或密钥托管服务维护。",
};
