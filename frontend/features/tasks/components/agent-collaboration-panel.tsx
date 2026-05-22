"use client";

import { AlertTriangle, CheckCircle2, Flag, GitBranch, RefreshCw, Route } from "lucide-react";
import { formatDateTimeLocal } from "@/shared/lib/utils";
import type { AgentFinalResolution } from "@/shared/lib/http";
import type {
  AgentCollaborationCritique,
  AgentCollaborationModel,
  AgentCollaborationPlanItem,
  AgentCollaborationReplan,
} from "@/features/tasks/components/agent-collaboration-view-model";

function planStatusClass(status: AgentCollaborationPlanItem["status"]) {
  if (status === "completed") return "border-emerald-500/20 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300";
  if (status === "running") return "border-sky-500/20 bg-sky-500/8 text-sky-700 dark:text-sky-300";
  if (status === "failed") return "border-red-500/20 bg-red-500/8 text-red-700 dark:text-red-300";
  return "border-amber-500/20 bg-amber-500/8 text-amber-700 dark:text-amber-300";
}

function critiqueVerdictLabel(verdict: string) {
  if (verdict === "revise") return "需修订";
  if (verdict === "manual_review") return "人工复核";
  if (verdict === "pass") return "通过";
  return verdict || "未知";
}

function resolutionTone(finalResolution: AgentFinalResolution | null) {
  if (!finalResolution) return "border-border bg-muted/20";
  if (finalResolution.manual_review_required) return "border-amber-500/20 bg-amber-500/8";
  return "border-emerald-500/20 bg-emerald-500/8";
}

function replanActionLabel(action: string) {
  if (action === "rerun_stage") return "回跑阶段";
  if (action === "manual_review") return "转人工复核";
  if (action === "finish") return "结束执行";
  return action || "未知动作";
}

function CritiqueList({ critiques }: { critiques: AgentCollaborationCritique[] }) {
  if (critiques.length === 0) {
    return <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">当前没有触发额外审核意见。</div>;
  }
  return (
    <div className="space-y-3">
      {critiques.map((item, index) => (
        <div key={`${item.time}-${index}`} className="rounded-lg border border-border bg-background/70 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{item.summary}</span>
            <span className={`rounded-full border px-2 py-0.5 text-xs ${item.verdict === "manual_review" ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300"}`}>
              {critiqueVerdictLabel(item.verdict)}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {item.targetStage ? `目标阶段：${item.targetStage}` : "目标阶段：当前审核节点"} · {formatDateTimeLocal(item.time)}
          </div>
          {item.issues.length > 0 ? (
            <ul className="mt-3 space-y-1.5 pl-5 text-sm leading-6 text-foreground/90">
              {item.issues.map((issue, issueIndex) => (
                <li key={`${item.time}-${issueIndex}`} className="list-disc">{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ReplanList({ replans }: { replans: AgentCollaborationReplan[] }) {
  if (replans.length === 0) {
    return <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">当前没有触发阶段重规划。</div>;
  }
  return (
    <div className="space-y-3">
      {replans.map((item, index) => (
        <div key={`${item.time}-${index}`} className="rounded-lg border border-border bg-background/70 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{replanActionLabel(item.action)}</span>
            {item.targetStage ? <span className="app-chip-muted">{item.targetStage}</span> : null}
          </div>
          <div className="mt-1 text-sm leading-6 text-muted-foreground">{item.reason}</div>
          <div className="mt-2 text-xs text-muted-foreground">{formatDateTimeLocal(item.time)}</div>
        </div>
      ))}
    </div>
  );
}

export function AgentCollaborationPanel({ model }: { model: AgentCollaborationModel }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-background/75 p-4">
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground"><GitBranch className="h-4 w-4" /> 修订轮次</div>
          <div className="mt-2 text-2xl font-semibold text-foreground">{model.revisionRounds}</div>
        </div>
        <div className="rounded-xl border border-border bg-background/75 p-4">
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-4 w-4" /> 审核意见</div>
          <div className="mt-2 text-2xl font-semibold text-foreground">{model.critiques.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-background/75 p-4">
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground"><RefreshCw className="h-4 w-4" /> 重规划</div>
          <div className="mt-2 text-2xl font-semibold text-foreground">{model.replans.length}</div>
        </div>
        <div className={`rounded-xl border p-4 ${resolutionTone(model.finalResolution)}`}>
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground"><Flag className="h-4 w-4" /> 最终收束</div>
          <div className="mt-2 text-sm font-semibold text-foreground">
            {model.finalResolution?.manual_review_required ? "需人工复核" : model.finalResolution?.reason || "等待执行结束"}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background/70 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Route className="h-4 w-4 text-muted-foreground" />
          当前执行路径
        </div>
        {model.currentPlan.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {model.currentPlan.map((item) => (
              <div key={item.key} className={`rounded-lg border px-4 py-3 ${planStatusClass(item.status)}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">{item.label}</div>
                  <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px]">第 {item.iteration} 轮</span>
                </div>
                <div className="mt-2 text-sm leading-6 text-foreground/85">{item.helper}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">当前任务还没有形成可展示的协作执行路径。</div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-border bg-background/70 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            审核与修订
          </div>
          <CritiqueList critiques={model.critiques} />
        </section>

        <section className="rounded-xl border border-border bg-background/70 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            重规划与收束
          </div>
          <ReplanList replans={model.replans} />
          {model.finalResolution ? (
            <div className={`mt-3 rounded-lg border px-4 py-3 ${resolutionTone(model.finalResolution)}`}>
              <div className="text-sm font-medium text-foreground">
                {model.finalResolution.manual_review_required ? "最终状态：人工复核" : "最终状态：已完成"}
              </div>
              <div className="mt-1 text-sm leading-6 text-muted-foreground">{model.finalResolution.reason}</div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
