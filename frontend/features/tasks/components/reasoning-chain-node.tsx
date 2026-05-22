"use client";

import type {
  ReasoningGraphNodeModel,
  ReasoningGraphRelationModel,
} from "@/features/tasks/components/reasoning-subgraph-view-model";

type Props = {
  relation: ReasoningGraphRelationModel;
  sequenceLabel: string;
  questionNode: ReasoningGraphNodeModel;
  primaryEntityNode: ReasoningGraphNodeModel;
  selectedRelationId: string | null;
  selectedChunkId: number | null;
  focusedNodeId: string | null;
  onSelectQuestion: () => void;
  onSelectEntity: () => void;
  onSelectRelation: (relationId: string, chunkId: number | null) => void;
};

function getQuestionNodeClasses(active: boolean) {
  return active
    ? "border-blue-500/30 bg-blue-500/16 text-blue-950 shadow-[0_12px_30px_rgba(37,99,235,0.14)] dark:text-blue-100"
    : "border-blue-500/18 bg-blue-500/10 text-slate-900 shadow-[0_10px_28px_rgba(37,99,235,0.08)] dark:text-slate-50";
}

function getEntityNodeClasses(active: boolean) {
  return active
    ? "border-cyan-500/30 bg-cyan-500/15 text-cyan-950 shadow-[0_12px_30px_rgba(6,182,212,0.14)] dark:text-cyan-100"
    : "border-cyan-500/18 bg-cyan-500/10 text-slate-900 shadow-[0_10px_28px_rgba(6,182,212,0.08)] dark:text-slate-50";
}

function getTargetNodeClasses(active: boolean, fallback: boolean) {
  if (fallback) {
    return active
      ? "border-amber-500/35 bg-amber-500/16 text-amber-950 shadow-[0_12px_30px_rgba(245,158,11,0.14)] dark:text-amber-100"
      : "border-amber-500/20 bg-amber-500/10 text-slate-900 shadow-[0_10px_28px_rgba(245,158,11,0.08)] dark:text-slate-50";
  }
  return active
    ? "border-emerald-500/35 bg-emerald-500/16 text-emerald-950 shadow-[0_12px_30px_rgba(16,185,129,0.14)] dark:text-emerald-100"
    : "border-emerald-500/20 bg-emerald-500/10 text-slate-900 shadow-[0_10px_28px_rgba(16,185,129,0.08)] dark:text-slate-50";
}

export function ReasoningChainNode({
  relation,
  sequenceLabel,
  questionNode,
  primaryEntityNode,
  selectedRelationId,
  selectedChunkId,
  focusedNodeId,
  onSelectQuestion,
  onSelectEntity,
  onSelectRelation,
}: Props) {
  const relationActive = relation.graphId === selectedRelationId || focusedNodeId === relation.graphId;
  const questionActive = focusedNodeId === questionNode.id && selectedRelationId == null;
  const entityActive = focusedNodeId === primaryEntityNode.id && selectedRelationId == null;
  const selectedBadge =
    (selectedChunkId != null ? relation.evidenceBadges.find((badge) => badge.chunkId === selectedChunkId) : null) ??
    relation.evidenceBadges[0] ??
    null;

  return (
    <section
      className={`relative overflow-hidden rounded-[22px] border px-4 py-5 transition-colors sm:px-5 ${
        relationActive
          ? "border-emerald-500/30 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)] dark:bg-slate-950/45"
          : "border-border/70 bg-white/90 shadow-[0_12px_34px_rgba(15,23,42,0.05)] dark:bg-slate-950/30"
      }`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.7),transparent_52%)] dark:bg-[radial-gradient(circle_at_top,rgba(148,163,184,0.12),transparent_52%)]" />
      <svg
        viewBox="0 0 100 74"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden
      >
        <line x1="50" y1="19" x2="26" y2="58" stroke="#2563eb" strokeWidth="1.7" strokeLinecap="round" />
        <line x1="50" y1="19" x2="74" y2="58" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" opacity="0.75" />
        <line
          x1="26"
          y1="58"
          x2="74"
          y2="58"
          stroke={relation.isFallback ? "#f59e0b" : "#ef4444"}
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeDasharray="4 3"
        />
      </svg>

      <div className="relative min-h-[280px]">
        <div className="absolute left-3 top-1 rounded-full border border-border/70 bg-background/90 px-2 py-1 text-[11px] font-medium text-muted-foreground">
          关系 {sequenceLabel}
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelectQuestion();
          }}
          className={`absolute left-1/2 top-0 w-[min(76%,280px)] -translate-x-1/2 rounded-[20px] border px-4 py-3 text-left transition-colors ${getQuestionNodeClasses(questionActive)}`}
        >
          <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-current/70">{questionNode.subtitle}</div>
          <div className="mt-1 text-sm font-semibold leading-5 text-current">{questionNode.title}</div>
        </button>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelectEntity();
          }}
          className={`absolute bottom-0 left-0 flex h-[112px] w-[116px] flex-col items-center justify-center rounded-[28px] border px-3 text-center transition-colors sm:h-[126px] sm:w-[132px] ${getEntityNodeClasses(entityActive)}`}
        >
          <div className="text-[11px] font-medium text-current/70">{primaryEntityNode.subtitle}</div>
          <div className="mt-2 text-base font-semibold leading-5 text-current">{primaryEntityNode.title}</div>
          {primaryEntityNode.confidenceLabel ? (
            <div className="mt-2 text-[11px] text-current/70">{primaryEntityNode.confidenceLabel}</div>
          ) : null}
        </button>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelectRelation(relation.graphId, relation.chunkIds[0] ?? null);
          }}
          className={`absolute bottom-11 left-1/2 -translate-x-1/2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            relation.isFallback
              ? relationActive
                ? "border-amber-500/40 bg-amber-500/16 text-amber-900 dark:text-amber-100"
                : "border-amber-500/20 bg-background/92 text-amber-700 dark:text-amber-300"
              : relationActive
                ? "border-red-500/40 bg-red-500/12 text-red-900 dark:text-red-100"
                : "border-red-500/20 bg-background/92 text-red-700 dark:text-red-300"
          }`}
        >
          {relation.relationLabel}
          <span className="ml-2 text-[11px] opacity-75">{relation.confidenceLabel}</span>
        </button>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelectRelation(relation.graphId, relation.chunkIds[0] ?? null);
          }}
          className={`absolute bottom-0 right-0 flex h-[124px] w-[126px] flex-col items-center justify-center rounded-[32px] border px-3 text-center transition-colors sm:h-[138px] sm:w-[148px] ${getTargetNodeClasses(relationActive, relation.isFallback)}`}
        >
          <div className="text-[11px] font-medium text-current/70">{relation.targetNode.subtitle}</div>
          <div className="mt-2 text-base font-semibold leading-5 text-current">{relation.targetNode.title}</div>
          <div className="mt-2 rounded-full border border-current/15 bg-white/55 px-2.5 py-1 text-[11px] text-current/80 dark:bg-slate-900/35">
            {relation.supportLabel}
          </div>
        </button>

        <div className="absolute left-[20%] top-[36%] rounded-full bg-white/94 px-2 py-1 text-[11px] text-slate-600 shadow-sm dark:bg-slate-900/90 dark:text-slate-300">
          命中实体
        </div>
        <div className="absolute right-[8%] top-[34%] rounded-full bg-white/90 px-2 py-1 text-[11px] text-slate-500 shadow-sm dark:bg-slate-900/85 dark:text-slate-300">
          推理指向
        </div>

        <div className="pointer-events-none absolute bottom-2 left-1/2 w-[calc(100%-10.5rem)] max-w-[180px] min-w-[120px] -translate-x-1/2 rounded-2xl border border-border/60 bg-background/90 px-3 py-2 shadow-sm dark:bg-slate-950/80 sm:left-[30%] sm:w-auto sm:max-w-[calc(100%-15rem)] sm:translate-x-0">
          <div className="text-[11px] font-medium text-muted-foreground">关系说明</div>
          <div className="mt-1 text-sm font-medium leading-5 text-foreground">{relation.summary}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {selectedBadge ? (
              <span className="rounded-full border border-border/70 bg-muted/20 px-2 py-1">
                当前证据 {selectedBadge.label}
              </span>
            ) : null}
            <span>{relation.evidenceBadges.length > 0 ? `${relation.evidenceBadges.length} 条关联证据` : "当前关系暂无证据"}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
