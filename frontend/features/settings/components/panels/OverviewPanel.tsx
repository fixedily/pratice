import { Gauge, RefreshCw, ShieldCheck } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { SettingsSectionShell, MetricCard, mutedPanelClass, pageText } from "@/features/settings/components/settings-ui";
import { cn } from "@/shared/lib/utils";
import type { SettingsPanelProps } from "@/features/settings/components/panels/types";

export function OverviewPanel({ overview, overviewLoading, overviewError, roleLabel, onRefreshOverview }: SettingsPanelProps) {
  const knowledge = overview?.knowledge_summary;
  const rag = overview?.rag_summary;
  const workflow = overview?.workflow_summary;
  const audit = overview?.audit_summary;

  return (
    <SettingsSectionShell
      title="赛题能力与企业运行总览"
      description="集中呈现多模态检索、知识沉淀、标准化作业和企业运维治理的当前完成度。"
      icon={Gauge}
      actions={
        <Button type="button" variant="outline" onClick={onRefreshOverview} disabled={overviewLoading}>
          <RefreshCw className="h-4 w-4" />
          刷新概览
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="知识文档" value={String(knowledge?.document_count ?? 0)} hint="已发布手册、案例和工单沉淀资料" tone={(knowledge?.document_count ?? 0) > 0 ? "success" : "warning"} />
        <MetricCard label="检索可用条目" value={String(knowledge?.retrieval_enabled_count ?? 0)} hint="已进入 RAG 检索链路的知识资产" tone={(knowledge?.retrieval_enabled_count ?? 0) > 0 ? "success" : "warning"} />
        <MetricCard label="流程模板" value={String(workflow?.published_flow_template_count ?? 0)} hint="按设备类型和检修等级发布的 SOP" tone={(workflow?.published_flow_template_count ?? 0) > 0 ? "success" : "warning"} />
        <MetricCard label="审计事件" value={String(audit?.recent_count ?? 0)} hint="系统关键动作追踪记录" tone="neutral" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className={cn("p-5", mutedPanelClass)}>
          <div className={cn("text-sm font-semibold", pageText.title)}>能力链路</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <MetricCard label="模型治理" value={rag?.embedding_model || "待配置"} hint="Embedding / Rerank / LLM 接入状态" tone={rag?.embedding_model ? "success" : "warning"} />
            <MetricCard label="向量后端" value={rag?.vector_store_backend || "待配置"} hint="FAISS 或 pgvector 等检索基础设施" tone={rag?.vector_store_backend ? "success" : "warning"} />
          </div>
        </div>
        <div className={cn("p-5", mutedPanelClass)}>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <div className={cn("text-sm font-semibold", pageText.title)}>当前访问角色</div>
          </div>
          <div className={cn("mt-3 text-2xl font-semibold", pageText.title)}>{roleLabel}</div>
          <div className={cn("mt-2 text-sm leading-6", pageText.tertiary)}>
            高级设置仅管理员可见。普通角色保留运行状态、权限范围和部署检查入口，避免暴露敏感模型与接口配置。
          </div>
        </div>
      </div>
      {overviewError ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-300">管理员概览加载失败：{overviewError}</div> : null}
    </SettingsSectionShell>
  );
}
