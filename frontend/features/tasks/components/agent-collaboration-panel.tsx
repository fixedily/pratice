"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, ArrowUpRight, BrainCircuit, CheckCircle2, Flag, GitBranch, MessageSquareText, RefreshCw, Route } from "lucide-react";
import { formatDateTimeLocal } from "@/shared/lib/utils";
import type { AgentFinalResolution } from "@/shared/lib/http";
import type {
  AgentCollaborationCritique,
  AgentCollaborationDecision,
  AgentCollaborationHandoff,
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

function approvalStateLabel(state: string | null | undefined) {
  if (state === "pending") return "待审批";
  if (state === "approved") return "已通过";
  if (state === "rejected") return "已驳回";
  if (state === "returned") return "已退回";
  return "未生成审批";
}

function replanActionLabel(action: string) {
  if (action === "rerun_stage") return "回跑阶段";
  if (action === "manual_review") return "转人工复核";
  if (action === "finish") return "结束执行";
  return action || "未知动作";
}

function HandoffList({ handoffs }: { handoffs: AgentCollaborationHandoff[] }) {
  if (handoffs.length === 0) {
    return <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">当前记录中还没有形成跨 Agent 交接。</div>;
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {handoffs.map((item) => (
        <div key={item.key} className="rounded-lg border border-border bg-background/70 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            <span>{item.from}</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span>{item.to}</span>
          </div>
          <div className="mt-2 text-sm leading-6 text-muted-foreground">{item.summary}</div>
          {item.time ? <div className="mt-2 text-xs text-muted-foreground">{formatDateTimeLocal(item.time)}</div> : null}
        </div>
      ))}
    </div>
  );
}

function DecisionList({ decisions }: { decisions: AgentCollaborationDecision[] }) {
  if (decisions.length === 0) {
    return <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">当前记录中还没有可展示的 Agent 决策摘要。</div>;
  }
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {decisions.map((item) => (
        <div key={item.key} className={`rounded-lg border px-4 py-3 ${planStatusClass(item.status)}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 text-sm font-semibold">
              <BrainCircuit className="h-4 w-4" />
              {item.agent}
            </div>
            {item.time ? <span className="text-[11px] text-muted-foreground">{formatDateTimeLocal(item.time)}</span> : null}
          </div>
          <div className="mt-3 grid gap-2 text-sm leading-6">
            <div>
              <span className="font-medium text-foreground/80">输入：</span>
              <span className="text-foreground/85">{item.input}</span>
            </div>
            <div>
              <span className="font-medium text-foreground/80">判断：</span>
              <span className="text-foreground/85">{item.output}</span>
            </div>
          </div>
          {item.basis.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {item.basis.map((basis) => (
                <span key={`${item.key}-${basis}`} className="rounded-md border border-current/15 bg-background/45 px-2 py-1 text-xs">
                  {basis}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
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
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground"><BrainCircuit className="h-4 w-4" /> 参与 Agent</div>
          <div className="mt-2 text-2xl font-semibold text-foreground">{model.activeAgentCount}</div>
        </div>
        <div className="rounded-xl border border-border bg-background/75 p-4">
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground"><MessageSquareText className="h-4 w-4" /> 交接次数</div>
          <div className="mt-2 text-2xl font-semibold text-foreground">{model.handoffs.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-background/75 p-4">
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground"><GitBranch className="h-4 w-4" /> 修订轮次</div>
          <div className="mt-2 text-2xl font-semibold text-foreground">{model.revisionRounds}</div>
        </div>
        <div className={`rounded-xl border p-4 ${resolutionTone(model.finalResolution)}`}>
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground"><Flag className="h-4 w-4" /> 最终收束</div>
          <div className="mt-2 text-sm font-semibold text-foreground">
            {model.finalResolution?.manual_review_required ? "需人工复核" : model.finalResolution?.reason || "等待执行结束"}
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-background/70 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <MessageSquareText className="h-4 w-4 text-muted-foreground" />
          Agent 交接链路
        </div>
        <HandoffList handoffs={model.handoffs} />
      </section>

      <section className="rounded-xl border border-border bg-background/70 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <BrainCircuit className="h-4 w-4 text-muted-foreground" />
          Agent 决策摘要
        </div>
        <DecisionList decisions={model.decisions} />
      </section>

      {model.finalResolution?.manual_review_required || model.approvalTask ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">人工审批阻断</div>
              <div className="mt-1 text-sm leading-6 text-muted-foreground">
                {model.finalResolution?.blocking_reason || model.finalResolution?.reason || "审核 Agent 要求人工复核后再继续推进。"}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                审批任务：{model.finalResolution?.approval_task_id || model.approvalTask?.id || "--"} · 状态：
                {approvalStateLabel(model.finalResolution?.approval_state || model.approvalTask?.approval_state)}
              </div>
            </div>
            {model.approvalTask?.work_order_id ? (
              <Link href={`/tickets/${model.approvalTask.work_order_id}`} className="app-btn-secondary h-9 px-3 text-xs">
                <ArrowUpRight className="h-3.5 w-3.5" />
                前往工单审批
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

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
