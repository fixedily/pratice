"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Header } from "@/shared/components/brand/app-header";
import { useMaintenanceAuth } from "@/features/auth/maintenance-auth";
import { canAccessAdmin } from "@/features/auth/permissions";
import { getMaintenanceToken } from "@/features/auth/lib/token-store";
import {
  fetchHealth,
  fetchMaintenanceHealth,
  fetchMaintenanceSettingsOverview,
  pingBackendReadiness,
  type SettingsOverviewResponse,
} from "@/shared/lib/http";
import { cn } from "@/shared/lib/utils";
import { SettingsSidebar } from "@/features/settings/components/SettingsSidebar";
import { StatusOverview } from "@/features/settings/components/StatusOverview";
import { cardClass, pageText } from "@/features/settings/components/settings-ui";
import { settingsBackendRoadmap, settingsMenuItems, type SettingsPanelId } from "@/features/settings/config/settingsConfig";
import type { StatusCardData, Tone } from "@/features/settings/mock/settingsMock";
import { OverviewPanel } from "@/features/settings/components/panels/OverviewPanel";
import { BasicSettingsPanel } from "@/features/settings/components/panels/BasicSettingsPanel";
import { ModelServicePanel } from "@/features/settings/components/panels/ModelServicePanel";
import { KnowledgeSettingsPanel } from "@/features/settings/components/panels/KnowledgeSettingsPanel";
import { RagSettingsPanel } from "@/features/settings/components/panels/RagSettingsPanel";
import { AgentSettingsPanel } from "@/features/settings/components/panels/AgentSettingsPanel";
import { AlertNotificationPanel } from "@/features/settings/components/panels/AlertNotificationPanel";
import { WorkOrderFlowPanel } from "@/features/settings/components/panels/WorkOrderFlowPanel";
import { RolePermissionPanel } from "@/features/settings/components/panels/RolePermissionPanel";
import { DataInterfacePanel } from "@/features/settings/components/panels/DataInterfacePanel";
import { EvaluationMonitoringPanel } from "@/features/settings/components/panels/EvaluationMonitoringPanel";
import { AuditLogPanel } from "@/features/settings/components/panels/AuditLogPanel";
import { DeploymentOpsPanel } from "@/features/settings/components/panels/DeploymentOpsPanel";
import type { SettingsPanelProps } from "@/features/settings/components/panels/types";

export type CheckState = {
  label: string;
  tone: Tone;
  detail?: string;
  checkedAt?: string | null;
};

const DEFAULT_CHECK_STATE: CheckState = { label: "未检查", tone: "neutral", checkedAt: null };
const SETTINGS_PANEL_ID_SET = new Set<SettingsPanelId>(settingsMenuItems.map((item) => item.id));

function resolveSettingsPanel(value: string | null): SettingsPanelId | null {
  if (!value) return null;
  return SETTINGS_PANEL_ID_SET.has(value as SettingsPanelId) ? (value as SettingsPanelId) : null;
}

function normalizeHealthTone(value: string): Tone {
  const lowered = value.toLowerCase();
  if (lowered.includes("failure") || lowered.includes("error") || lowered.includes("异常") || lowered.includes("失败")) return "danger";
  if (lowered.includes("warning") || lowered.includes("degraded") || lowered.includes("警告")) return "warning";
  if (
    lowered.includes("healthy") ||
    lowered.includes("ok") ||
    lowered.includes("connected") ||
    lowered.includes("正常") ||
    lowered.includes("就绪") ||
    lowered.includes("连通")
  ) {
    return "success";
  }
  return "neutral";
}

function formatTimestamp(value?: string | null) {
  if (!value) return "暂无";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(parsed));
}

function buildStatusCards(overview: SettingsOverviewResponse | null, healthState: CheckState, maintenanceState: CheckState): StatusCardData[] {
  const rag = overview?.rag_summary;
  const knowledge = overview?.knowledge_summary;
  const modelOnline = Boolean(rag?.embedding_model || rag?.reranker_model);
  const indexed = Number(knowledge?.retrieval_enabled_count ?? 0) > 0;
  const searchReady = Boolean(rag?.vector_store_backend) && indexed;
  const notificationReady = maintenanceState.tone === "success" || healthState.tone === "success";

  return [
    {
      title: "模型服务在线",
      value: modelOnline ? "已接入" : "待配置",
      detail: rag?.embedding_model || rag?.reranker_model || "等待配置 LLM / Embedding / Rerank 链路",
      tone: modelOnline ? "success" : "warning",
    },
    {
      title: "知识库已索引",
      value: indexed ? `${knowledge?.retrieval_enabled_count ?? 0} 条可检索` : "待构建",
      detail: `文档 ${knowledge?.document_count ?? 0} 份，导入任务 ${knowledge?.import_job_count ?? 0} 个`,
      tone: indexed ? "success" : "warning",
    },
    {
      title: "检索服务正常",
      value: searchReady ? "可用" : "需关注",
      detail: rag?.vector_store_backend ? `向量后端：${rag.vector_store_backend}` : "等待向量库配置",
      tone: searchReady ? "success" : "warning",
    },
    {
      title: "通知服务正常",
      value: notificationReady ? "可用" : "待检查",
      detail: "站内通知已内置，邮件与企业微信为后续企业接口扩展项",
      tone: notificationReady ? "success" : "neutral",
    },
  ];
}

export default function SettingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, isLoading } = useMaintenanceAuth();
  const isAdmin = canAccessAdmin(user);
  const requestedPanel = useMemo(() => resolveSettingsPanel(searchParams.get("panel")), [searchParams]);
  const [overview, setOverview] = useState<SettingsOverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [healthState, setHealthState] = useState<CheckState>(DEFAULT_CHECK_STATE);
  const [maintenanceState, setMaintenanceState] = useState<CheckState>(DEFAULT_CHECK_STATE);
  const [readinessState, setReadinessState] = useState<CheckState>(DEFAULT_CHECK_STATE);

  const roleLabel = useMemo(() => {
    const roles = user?.roles ?? [];
    if (roles.includes("admin")) return "系统管理员";
    if (roles.includes("expert")) return "设备专家";
    if (roles.includes("safety")) return "安全审核员";
    if (roles.includes("worker")) return "检修工程师";
    return "普通查看者";
  }, [user]);

  const visiblePanelIds = useMemo(() => settingsMenuItems.filter((item) => isAdmin || !item.adminOnly).map((item) => item.id), [isAdmin]);
  const resolvedPanel = useMemo<SettingsPanelId>(() => {
    if (requestedPanel && visiblePanelIds.includes(requestedPanel)) {
      return requestedPanel;
    }
    return "overview";
  }, [requestedPanel, visiblePanelIds]);
  const activePanel = resolvedPanel;

  useEffect(() => {
    if (isLoading) return;
    const params = new URLSearchParams(searchParams.toString());
    if (resolvedPanel === "overview") {
      params.delete("panel");
    } else {
      params.set("panel", resolvedPanel);
    }
    const nextQuery = params.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery === currentQuery) return;
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [isLoading, pathname, resolvedPanel, router, searchParams]);

  const buildPanelHref = useCallback((nextPanel: SettingsPanelId) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextPanel === "overview") {
      params.delete("panel");
    } else {
      params.set("panel", nextPanel);
    }
    const nextQuery = params.toString();
    return nextQuery ? `${pathname}?${nextQuery}` : pathname;
  }, [pathname, searchParams]);

  const updateCheckState = useCallback((label: string, tone: Tone, detail?: string) => {
    return { label, tone, detail, checkedAt: new Date().toISOString() } satisfies CheckState;
  }, []);

  const loadOverview = useCallback(async () => {
    if (!isAdmin) {
      setOverview(null);
      setOverviewError(null);
      return;
    }
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const payload = await fetchMaintenanceSettingsOverview(getMaintenanceToken());
      setOverview(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "系统概览加载失败";
      setOverviewError(message);
    } finally {
      setOverviewLoading(false);
    }
  }, [isAdmin]);

  const runHealthCheck = useCallback(async () => {
    try {
      const data = await fetchHealth();
      const redisLabel = data.redis ? ` / Redis ${data.redis.status}` : "";
      const label = `${data.status} / DB ${data.database}${redisLabel}`;
      setHealthState(updateCheckState(label, normalizeHealthTone(label), "系统、数据库与 Redis 连接"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "检查失败";
      setHealthState(updateCheckState(`失败：${message}`, "danger", "系统健康检查"));
    }
  }, [updateCheckState]);

  const runMaintenanceCheck = useCallback(async () => {
    try {
      const data = await fetchMaintenanceHealth();
      const status = typeof data?.status === "string" ? data.status : "连通正常";
      setMaintenanceState(updateCheckState(status, normalizeHealthTone(status), "检修域与业务服务"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "检查失败";
      setMaintenanceState(updateCheckState(`失败：${message}`, "danger", "检修域连通检查"));
    }
  }, [updateCheckState]);

  const runReadinessCheck = useCallback(async () => {
    try {
      await pingBackendReadiness();
      setReadinessState(updateCheckState("后端已就绪", "success", "后端 readiness"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "检查失败";
      setReadinessState(updateCheckState(`失败：${message}`, "danger", "后端就绪检查"));
    }
  }, [updateCheckState]);

  useEffect(() => {
    document.documentElement.classList.add("settings-stable-scrollbar");
    document.body.classList.add("settings-stable-scrollbar");
    return () => {
      document.documentElement.classList.remove("settings-stable-scrollbar");
      document.body.classList.remove("settings-stable-scrollbar");
    };
  }, []);

  useEffect(() => {
    if (!isLoading) {
      void loadOverview();
    }
  }, [isLoading, loadOverview]);

  useEffect(() => {
    void runHealthCheck();
    void runMaintenanceCheck();
    void runReadinessCheck();
  }, [runHealthCheck, runMaintenanceCheck, runReadinessCheck]);

  const latestCheckedAt = useMemo(() => {
    const values = [healthState.checkedAt, maintenanceState.checkedAt, readinessState.checkedAt].filter(Boolean);
    return values.length > 0 ? formatTimestamp(values.sort().at(-1) ?? null) : "暂无";
  }, [healthState.checkedAt, maintenanceState.checkedAt, readinessState.checkedAt]);

  const statusCards = useMemo(() => buildStatusCards(overview, healthState, maintenanceState), [healthState, maintenanceState, overview]);

  const handleSave = useCallback((scope: string) => {
    toast.success(`${scope} 已保存到前端演示态`, {
      description: "真实写入将在后续接入后端 system_configs 与审计接口。",
    });
  }, []);

  const panelProps = useMemo<SettingsPanelProps>(
    () => ({
      overview,
      overviewLoading,
      overviewError,
      user,
      roleLabel,
      healthState,
      maintenanceState,
      readinessState,
      onSave: handleSave,
      onRefreshOverview: () => void loadOverview(),
      onRunHealthCheck: () => void runHealthCheck(),
      onRunMaintenanceCheck: () => void runMaintenanceCheck(),
      onRunReadinessCheck: () => void runReadinessCheck(),
    }),
    [
      handleSave,
      healthState,
      loadOverview,
      maintenanceState,
      overview,
      overviewError,
      overviewLoading,
      readinessState,
      roleLabel,
      runHealthCheck,
      runMaintenanceCheck,
      runReadinessCheck,
      user,
    ],
  );

  const panel = useMemo(() => {
    switch (activePanel) {
      case "basic":
        return <BasicSettingsPanel {...panelProps} />;
      case "models":
        return <ModelServicePanel {...panelProps} />;
      case "knowledge":
        return <KnowledgeSettingsPanel {...panelProps} />;
      case "rag":
        return <RagSettingsPanel {...panelProps} />;
      case "agents":
        return <AgentSettingsPanel {...panelProps} />;
      case "alerts":
        return <AlertNotificationPanel {...panelProps} />;
      case "workflow":
        return <WorkOrderFlowPanel {...panelProps} />;
      case "roles":
        return <RolePermissionPanel {...panelProps} />;
      case "interfaces":
        return <DataInterfacePanel {...panelProps} />;
      case "evaluation":
        return <EvaluationMonitoringPanel {...panelProps} />;
      case "audit":
        return <AuditLogPanel {...panelProps} />;
      case "deployment":
        return <DeploymentOpsPanel {...panelProps} />;
      case "overview":
      default:
        return <OverviewPanel {...panelProps} />;
    }
  }, [activePanel, panelProps]);

  return (
    <div className="min-h-screen bg-[#f5f7f5] text-slate-950 dark:bg-[#08111a] dark:text-slate-50">
      <Header />
      <main className="app-main app-main-wide">
        <div className="mx-auto max-w-[1500px] space-y-5">
          <div className={cn("p-5", cardClass)}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className={cn("text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300")}>FaultDiag Settings</div>
                <h1 className={cn("mt-2 text-2xl font-semibold", pageText.title)}>平台治理与运维中心</h1>
                <p className={cn("mt-2 max-w-3xl text-sm leading-6", pageText.tertiary)}>
                  面向公开演示多模态检修能力，面向企业落地管理模型、知识、检索、智能体、流程、权限、接口、监控和审计。
                </p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300">
                当前角色：{roleLabel}
              </div>
            </div>
          </div>

          <StatusOverview items={statusCards} updatedAt={latestCheckedAt} />

          <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <SettingsSidebar activeId={activePanel} isAdmin={isAdmin} hrefFor={buildPanelHref} />
            <div className="min-w-0 space-y-5">
              {panel}
              <div className={cn("p-5", cardClass)}>
                <div className={cn("text-sm font-semibold", pageText.title)}>未来后端接口接入说明</div>
                <div className="mt-3 grid gap-2">
                  {settingsBackendRoadmap.map((item) => (
                    <div key={item} className={cn("rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 dark:bg-white/[0.03]", pageText.tertiary)}>
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
