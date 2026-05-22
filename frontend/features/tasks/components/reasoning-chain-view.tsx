"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { ChevronDown, ChevronUp, Network, Sparkles } from "lucide-react";
import type {
  ReasoningGraphNodeModel,
  ReasoningGraphRelationModel,
} from "@/features/tasks/components/reasoning-subgraph-view-model";
import { cn } from "@/shared/lib/utils";

type RelatedEntity = {
  id: string;
  title: string;
  subtitle: string;
  confidenceLabel?: string;
};

type Props = {
  questionNode: ReasoningGraphNodeModel;
  primaryEntityNode: ReasoningGraphNodeModel | null;
  additionalEntities: RelatedEntity[];
  relations: ReasoningGraphRelationModel[];
  expanded: boolean;
  overflowCount: number;
  onToggleExpanded: () => void;
  selectedRelationId: string | null;
  selectedChunkId: number | null;
  focusedNodeId: string | null;
  onSelectQuestion: () => void;
  onSelectEntity: () => void;
  onSelectRelation: (relationId: string, chunkId: number | null) => void;
};

const DESKTOP_TARGET_HEIGHT = 196;
const DESKTOP_RELATION_START_Y = 92;
const DESKTOP_RELATION_STEP = 214;
const DESKTOP_QUESTION_Y = 24;
const DESKTOP_ENTITY_HEIGHT = 140;
const DESKTOP_CANVAS_MIN_WIDTH = 1040;
const DESKTOP_CANVAS_SIDE_PADDING = 40;

function getRelationAccent(relation: ReasoningGraphRelationModel) {
  return relation.isFallback
    ? {
        stroke: "#f59e0b",
        lineClass: "stroke-amber-500/80",
        pillIdle: "border-amber-500/20 bg-background/92 text-amber-700 dark:text-amber-300",
        pillActive: "border-amber-500/35 bg-amber-500/14 text-amber-900 dark:text-amber-100",
        nodeIdle:
          "border-amber-500/18 bg-amber-500/10 text-slate-900 shadow-[0_12px_34px_rgba(245,158,11,0.08)] dark:text-slate-50",
        nodeActive:
          "border-amber-500/35 bg-amber-500/16 text-amber-950 shadow-[0_16px_40px_rgba(245,158,11,0.14)] dark:text-amber-100",
      }
    : {
        stroke: "#10b981",
        lineClass: "stroke-emerald-500/80",
        pillIdle: "border-emerald-500/20 bg-background/92 text-emerald-700 dark:text-emerald-300",
        pillActive: "border-emerald-500/35 bg-emerald-500/14 text-emerald-900 dark:text-emerald-100",
        nodeIdle:
          "border-emerald-500/18 bg-emerald-500/10 text-slate-900 shadow-[0_12px_34px_rgba(16,185,129,0.08)] dark:text-slate-50",
        nodeActive:
          "border-emerald-500/35 bg-emerald-500/16 text-emerald-950 shadow-[0_16px_40px_rgba(16,185,129,0.14)] dark:text-emerald-100",
      };
}

function questionNodeClasses(active: boolean) {
  return active
    ? "border-blue-500/30 bg-blue-500/16 text-blue-950 shadow-[0_12px_30px_rgba(37,99,235,0.14)] dark:text-blue-100"
    : "border-blue-500/18 bg-blue-500/10 text-slate-900 shadow-[0_10px_28px_rgba(37,99,235,0.08)] dark:text-slate-50";
}

function entityNodeClasses(active: boolean) {
  return active
    ? "border-cyan-500/30 bg-cyan-500/15 text-cyan-950 shadow-[0_12px_30px_rgba(6,182,212,0.14)] dark:text-cyan-100"
    : "border-cyan-500/18 bg-cyan-500/10 text-slate-900 shadow-[0_10px_28px_rgba(6,182,212,0.08)] dark:text-slate-50";
}

function clampDesktopMetric(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildDesktopMetrics(relations: ReasoningGraphRelationModel[], canvasWidth: number) {
  const questionX = clampDesktopMetric(canvasWidth * 0.03, 32, 54);
  const questionWidth = clampDesktopMetric(canvasWidth * 0.25, 284, 348);
  const entityX = clampDesktopMetric(canvasWidth * 0.075, 78, 124);
  const entityWidth = clampDesktopMetric(canvasWidth * 0.19, 212, 272);
  const targetWidth = clampDesktopMetric(canvasWidth * 0.3, 304, 420);
  const targetX = canvasWidth - targetWidth - DESKTOP_CANVAS_SIDE_PADDING;
  const relationWidth = clampDesktopMetric(canvasWidth * 0.1, 120, 144);
  const branchStartX = entityX + entityWidth + clampDesktopMetric(canvasWidth * 0.028, 28, 44);
  const relationGap = Math.max(96, targetX - branchStartX - relationWidth);
  const relationX = branchStartX + relationGap * 0.42;
  const lastRowBottom =
    DESKTOP_RELATION_START_Y +
    Math.max(0, relations.length - 1) * DESKTOP_RELATION_STEP +
    DESKTOP_TARGET_HEIGHT;
  const height = Math.max(378, lastRowBottom + 48);
  const branchOriginY = height / 2 + 6;
  const entityY = branchOriginY - DESKTOP_ENTITY_HEIGHT / 2;
  const questionAnchorX = questionX + questionWidth - 54;
  const questionAnchorY = DESKTOP_QUESTION_Y + 74;
  const entityQuestionAnchorX = entityX + entityWidth * 0.58;
  const entityQuestionAnchorY = entityY + 24;
  const rows = relations.map((relation, index) => {
    const targetY = DESKTOP_RELATION_START_Y + index * DESKTOP_RELATION_STEP;
    const targetCenterY = targetY + DESKTOP_TARGET_HEIGHT / 2;
    const relationY = targetCenterY - 18;
    return {
      relation,
      targetY,
      targetCenterY,
      relationY,
    };
  });

  return {
    canvasWidth,
    height,
    questionX,
    questionWidth,
    entityX,
    entityWidth,
    relationX,
    relationWidth,
    targetX,
    targetWidth,
    branchStartX,
    entityY,
    branchOriginY,
    questionAnchorX,
    questionAnchorY,
    entityQuestionAnchorX,
    entityQuestionAnchorY,
    rows,
  };
}

function GraphLegend({ additionalEntities }: { additionalEntities: RelatedEntity[] }) {
  if (additionalEntities.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {additionalEntities.map((entity) => (
        <span
          key={entity.id}
          className="rounded-full border border-sky-500/15 bg-background/90 px-3 py-1 text-xs text-muted-foreground"
        >
          {entity.title}
          <span className="ml-1.5 text-[11px] text-muted-foreground/80">{entity.subtitle}</span>
        </span>
      ))}
    </div>
  );
}

function GraphHeader({ additionalEntities }: { additionalEntities: RelatedEntity[] }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <Network className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          主推理子图
        </div>
        <p className="mt-1 text-xs leading-6 text-muted-foreground">
          问题与主实体只出现一次，关系以共享根节点向外分支；仅点中关系节点才展开右侧证据抽屉。
        </p>
      </div>
      <GraphLegend additionalEntities={additionalEntities} />
    </div>
  );
}

function RelationTargetButton({
  relation,
  active,
  onSelect,
  className,
  testId,
  style,
}: {
  relation: ReasoningGraphRelationModel;
  active: boolean;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  testId?: string;
  style?: CSSProperties;
}) {
  const accent = getRelationAccent(relation);
  const primaryEvidence = relation.evidenceBadges[0] ?? null;
  const evidenceSourceLabel = primaryEvidence
    ? `${primaryEvidence.label} · ${primaryEvidence.sourceTitle}`
    : "当前节点尚未关联证据来源";
  const evidenceSourceMeta = primaryEvidence
    ? `${primaryEvidence.sourceMeta}${relation.evidenceBadges.length > 1 ? ` · 另有 ${relation.evidenceBadges.length - 1} 条` : ""}`
    : "点击关系后可在右侧查看补充说明";

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onSelect}
      style={style}
      className={cn(
        "group overflow-hidden rounded-[26px] border px-4 py-3.5 text-left transition-colors",
        active ? accent.nodeActive : accent.nodeIdle,
        className,
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-current/70">{relation.targetNode.subtitle}</div>
            <div className="mt-1 overflow-hidden text-sm font-semibold leading-6 text-current [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
              {relation.targetNode.title}
            </div>
            {relation.targetNode.description ? (
              <div className="mt-1 overflow-hidden text-[12px] leading-5 text-current/78 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                {relation.targetNode.description}
              </div>
            ) : null}
            {relation.targetNode.tags && relation.targetNode.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5 overflow-hidden">
                {relation.targetNode.tags.map((tag) => (
                  <span
                    key={`${relation.graphId}-${tag}`}
                    className="rounded-full border border-current/15 bg-white/55 px-2 py-0.5 text-[10px] font-medium text-current/75 dark:bg-slate-900/35"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {relation.targetNode.confidenceLabel ? (
            <span className="shrink-0 text-[11px] font-medium text-current/70">{relation.targetNode.confidenceLabel}</span>
          ) : null}
        </div>
        <div className="mt-auto">
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-current/80">
            <span className="rounded-full border border-current/15 bg-white/55 px-2.5 py-1 dark:bg-slate-900/35">
              {relation.supportLabel}
            </span>
            {primaryEvidence ? (
              <span className="rounded-full border border-current/15 bg-white/55 px-2.5 py-1 dark:bg-slate-900/35">
                来源 {primaryEvidence.label}
              </span>
            ) : null}
          </div>
          <div className="mt-2 overflow-hidden text-[11px] leading-5 text-current/72 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:1]">
            {evidenceSourceLabel}
          </div>
          <div className="overflow-hidden text-[11px] leading-5 text-current/62 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:1]">
            {evidenceSourceMeta}
          </div>
        </div>
      </div>
    </button>
  );
}

function DesktopGraph({
  questionNode,
  primaryEntityNode,
  relations,
  focusedNodeId,
  selectedRelationId,
  onSelectQuestion,
  onSelectEntity,
  onSelectRelation,
}: {
  questionNode: ReasoningGraphNodeModel;
  primaryEntityNode: ReasoningGraphNodeModel;
  relations: ReasoningGraphRelationModel[];
  focusedNodeId: string | null;
  selectedRelationId: string | null;
  onSelectQuestion: () => void;
  onSelectEntity: () => void;
  onSelectRelation: (relationId: string, chunkId: number | null) => void;
}) {
  const questionActive = focusedNodeId === questionNode.id && selectedRelationId == null;
  const entityActive = focusedNodeId === primaryEntityNode.id && selectedRelationId == null;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [desktopCanvasWidth, setDesktopCanvasWidth] = useState(DESKTOP_CANVAS_MIN_WIDTH);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = () => {
      setDesktopCanvasWidth(Math.max(container.clientWidth, DESKTOP_CANVAS_MIN_WIDTH));
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const metrics = useMemo(
    () => buildDesktopMetrics(relations, desktopCanvasWidth),
    [desktopCanvasWidth, relations],
  );

  return (
    <div className="hidden xl:block">
      <div ref={containerRef} className="overflow-x-auto pb-2" data-testid="reasoning-graph-desktop-scroll">
        <div style={{ width: `${metrics.canvasWidth}px`, minWidth: `${DESKTOP_CANVAS_MIN_WIDTH}px` }}>
          <div
            className="relative overflow-hidden rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.94)_0%,rgba(240,249,255,0.9)_100%)] p-5 shadow-[0_18px_44px_rgba(15,23,42,0.05)] dark:bg-[linear-gradient(180deg,rgba(2,6,23,0.92)_0%,rgba(10,25,47,0.86)_100%)]"
            data-testid="reasoning-graph-canvas"
            style={{
              height: `${metrics.height}px`,
              width: `${metrics.canvasWidth}px`,
              minWidth: `${DESKTOP_CANVAS_MIN_WIDTH}px`,
            }}
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.1),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.12),transparent_34%)]" />

            <svg
              viewBox={`0 0 ${metrics.canvasWidth} ${metrics.height}`}
              className="pointer-events-none absolute inset-0 h-full w-full"
              aria-hidden
            >
              <defs>
                <linearGradient id="reasoning-branch-line" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.85" />
                  <stop offset="55%" stopColor="#60a5fa" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.18" />
                </linearGradient>
              </defs>
              <path
                d={`M ${metrics.questionAnchorX} ${metrics.questionAnchorY} C ${metrics.questionAnchorX + clampDesktopMetric(metrics.canvasWidth * 0.02, 16, 24)} ${metrics.questionAnchorY + 26}, ${metrics.entityQuestionAnchorX - clampDesktopMetric(metrics.canvasWidth * 0.04, 40, 58)} ${metrics.entityQuestionAnchorY - 22}, ${metrics.entityQuestionAnchorX} ${metrics.entityQuestionAnchorY}`}
                fill="none"
                stroke="url(#reasoning-branch-line)"
                strokeWidth="2.1"
                strokeDasharray="6 6"
                strokeLinecap="round"
              />
              {metrics.rows.map(({ relation, targetCenterY }) => {
                const active = selectedRelationId === relation.graphId || focusedNodeId === relation.graphId;
                const accent = getRelationAccent(relation);
                const targetAnchorX = metrics.targetX;
                const firstControlX = metrics.branchStartX + Math.min(148, Math.max(88, (metrics.relationX - metrics.branchStartX) * 0.6));
                const secondControlX =
                  targetAnchorX - Math.min(148, Math.max(84, (targetAnchorX - (metrics.relationX + metrics.relationWidth)) * 0.36));

                return (
                  <g key={relation.graphId}>
                    <path
                      d={`M ${metrics.branchStartX} ${metrics.branchOriginY} C ${firstControlX} ${metrics.branchOriginY}, ${secondControlX} ${targetCenterY}, ${targetAnchorX} ${targetCenterY}`}
                      fill="none"
                      stroke={accent.stroke}
                      strokeWidth={active ? 3.2 : 2}
                      strokeLinecap="round"
                      opacity={active ? 0.95 : 0.42}
                    />
                    <circle
                      cx={metrics.branchStartX}
                      cy={metrics.branchOriginY}
                      r={active ? 6 : 4.5}
                      fill={accent.stroke}
                      opacity={active ? 0.95 : 0.82}
                    />
                    <circle
                      cx={targetAnchorX}
                      cy={targetCenterY}
                      r={active ? 6 : 4.5}
                      fill={accent.stroke}
                      opacity={active ? 0.95 : 0.82}
                    />
                  </g>
                );
              })}
            </svg>

            <button
              type="button"
              data-testid="reasoning-graph-question"
              onClick={(event) => {
                event.stopPropagation();
                onSelectQuestion();
              }}
              className={cn(
                "absolute rounded-[22px] border px-4 py-3 text-left transition-colors",
                questionNodeClasses(questionActive),
              )}
              style={{
                left: `${metrics.questionX}px`,
                top: `${DESKTOP_QUESTION_Y}px`,
                width: `${metrics.questionWidth}px`,
              }}
            >
              <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-current/70">{questionNode.subtitle}</div>
              <div className="mt-1 text-sm font-semibold leading-5 text-current">{questionNode.title}</div>
            </button>

            <button
              type="button"
              data-testid="reasoning-graph-entity"
              onClick={(event) => {
                event.stopPropagation();
                onSelectEntity();
              }}
              className={cn(
                "absolute flex flex-col justify-center rounded-[28px] border px-5 py-4 text-left transition-colors",
                entityNodeClasses(entityActive),
              )}
              style={{
                left: `${metrics.entityX}px`,
                top: `${metrics.entityY}px`,
                width: `${metrics.entityWidth}px`,
                height: `${DESKTOP_ENTITY_HEIGHT}px`,
              }}
            >
              <div className="text-[11px] font-medium text-current/70">{primaryEntityNode.subtitle}</div>
              <div className="mt-2 text-lg font-semibold leading-6 text-current">{primaryEntityNode.title}</div>
              {primaryEntityNode.confidenceLabel ? (
                <div className="mt-3 text-[11px] text-current/70">命中置信度 {primaryEntityNode.confidenceLabel}</div>
              ) : null}
            </button>

            {metrics.rows.map(({ relation, targetY, relationY }) => {
              const active = selectedRelationId === relation.graphId || focusedNodeId === relation.graphId;
              const accent = getRelationAccent(relation);

              return (
                <div key={relation.graphId}>
                  <button
                    type="button"
                    data-testid={`reasoning-graph-relation-${relation.graphId}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectRelation(relation.graphId, relation.chunkIds[0] ?? null);
                    }}
                    className={cn(
                      "absolute rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      active ? accent.pillActive : accent.pillIdle,
                    )}
                    style={{
                      left: `${metrics.relationX}px`,
                      top: `${relationY}px`,
                      width: `${metrics.relationWidth}px`,
                    }}
                  >
                    <span className="truncate">{relation.relationLabel}</span>
                  </button>

                  <RelationTargetButton
                    relation={relation}
                    active={active}
                    testId={`reasoning-graph-target-${relation.graphId}`}
                    onSelect={(event) => {
                      event.stopPropagation();
                      onSelectRelation(relation.graphId, relation.chunkIds[0] ?? null);
                    }}
                    className="absolute"
                    style={{
                      left: `${metrics.targetX}px`,
                      top: `${targetY}px`,
                      width: `${metrics.targetWidth}px`,
                      height: `${DESKTOP_TARGET_HEIGHT}px`,
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileGraph({
  questionNode,
  primaryEntityNode,
  relations,
  focusedNodeId,
  selectedRelationId,
  onSelectQuestion,
  onSelectEntity,
  onSelectRelation,
}: {
  questionNode: ReasoningGraphNodeModel;
  primaryEntityNode: ReasoningGraphNodeModel;
  relations: ReasoningGraphRelationModel[];
  focusedNodeId: string | null;
  selectedRelationId: string | null;
  onSelectQuestion: () => void;
  onSelectEntity: () => void;
  onSelectRelation: (relationId: string, chunkId: number | null) => void;
}) {
  const questionActive = focusedNodeId === questionNode.id && selectedRelationId == null;
  const entityActive = focusedNodeId === primaryEntityNode.id && selectedRelationId == null;

  return (
    <div className="space-y-4 xl:hidden" data-testid="reasoning-graph-mobile">
      <button
        type="button"
        data-testid="reasoning-graph-question-mobile"
        onClick={(event) => {
          event.stopPropagation();
          onSelectQuestion();
        }}
        className={cn("w-full rounded-[22px] border px-4 py-3 text-left transition-colors", questionNodeClasses(questionActive))}
      >
        <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-current/70">{questionNode.subtitle}</div>
        <div className="mt-1 text-sm font-semibold leading-5 text-current">{questionNode.title}</div>
      </button>

      <div className="flex justify-center">
        <button
          type="button"
          data-testid="reasoning-graph-entity-mobile"
          onClick={(event) => {
            event.stopPropagation();
            onSelectEntity();
          }}
          className={cn(
            "w-full max-w-[280px] rounded-[26px] border px-4 py-4 text-left transition-colors",
            entityNodeClasses(entityActive),
          )}
        >
          <div className="text-[11px] font-medium text-current/70">{primaryEntityNode.subtitle}</div>
          <div className="mt-1.5 text-base font-semibold leading-6 text-current">{primaryEntityNode.title}</div>
          {primaryEntityNode.confidenceLabel ? (
            <div className="mt-2 text-[11px] text-current/70">命中置信度 {primaryEntityNode.confidenceLabel}</div>
          ) : null}
        </button>
      </div>

      <div className="relative pl-6">
        <div className="absolute left-[1.15rem] top-0 bottom-5 w-px bg-border/70" />
        <div className="space-y-4">
          {relations.map((relation) => {
            const active = selectedRelationId === relation.graphId || focusedNodeId === relation.graphId;
            const accent = getRelationAccent(relation);

            return (
              <div key={relation.graphId} className="relative pl-5">
                <div className="absolute left-0 top-8 h-px w-5 bg-border/70" />
                <button
                  type="button"
                  data-testid={`reasoning-graph-relation-mobile-${relation.graphId}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectRelation(relation.graphId, relation.chunkIds[0] ?? null);
                  }}
                  className={cn(
                    "mb-2 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                    active ? accent.pillActive : accent.pillIdle,
                  )}
                >
                  {relation.relationLabel}
                </button>
                <RelationTargetButton
                  relation={relation}
                  active={active}
                  testId={`reasoning-graph-target-mobile-${relation.graphId}`}
                  onSelect={(event) => {
                    event.stopPropagation();
                    onSelectRelation(relation.graphId, relation.chunkIds[0] ?? null);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ReasoningChainView({
  questionNode,
  primaryEntityNode,
  additionalEntities,
  relations,
  expanded,
  overflowCount,
  onToggleExpanded,
  selectedRelationId,
  focusedNodeId,
  onSelectQuestion,
  onSelectEntity,
  onSelectRelation,
}: Props) {
  if (!primaryEntityNode) {
    return (
      <section className="space-y-4 rounded-2xl border border-border/70 bg-slate-50/85 p-4 shadow-sm dark:bg-slate-950/25">
        <GraphHeader additionalEntities={additionalEntities} />
        <div className="rounded-2xl border border-dashed border-border bg-background/70 px-4 py-8 text-sm text-muted-foreground">
          当前推理结果还没有命中可用于构图的主实体。
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border/70 bg-slate-50/85 p-4 shadow-sm dark:bg-slate-950/25">
      <GraphHeader additionalEntities={additionalEntities} />

      {relations.length > 0 ? (
        <>
          <DesktopGraph
            questionNode={questionNode}
            primaryEntityNode={primaryEntityNode}
            relations={relations}
            focusedNodeId={focusedNodeId}
            selectedRelationId={selectedRelationId}
            onSelectQuestion={onSelectQuestion}
            onSelectEntity={onSelectEntity}
            onSelectRelation={onSelectRelation}
          />
          <MobileGraph
            questionNode={questionNode}
            primaryEntityNode={primaryEntityNode}
            relations={relations}
            focusedNodeId={focusedNodeId}
            selectedRelationId={selectedRelationId}
            onSelectQuestion={onSelectQuestion}
            onSelectEntity={onSelectEntity}
            onSelectRelation={onSelectRelation}
          />
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-background/70 px-4 py-8 text-sm text-muted-foreground">
          当前推理结果已命中主实体，但还没有可展示的关系分支。
        </div>
      )}

      {overflowCount > 0 ? (
        <div>
          <button
            type="button"
            onClick={onToggleExpanded}
            className="inline-flex items-center gap-2 rounded-full border border-dashed border-border bg-background/80 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/20"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {expanded ? "收起更多关系" : `展开更多关系（+${overflowCount}）`}
          </button>
        </div>
      ) : null}

      <div className="rounded-2xl border border-dashed border-border/80 bg-background/65 px-4 py-3 text-xs leading-6 text-muted-foreground">
        <div className="inline-flex items-center gap-2 font-medium text-foreground/80">
          <Sparkles className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          交互说明
        </div>
        <div className="mt-1">
          点击问题或主实体只聚焦节点；点击关系标签或右侧目标节点，才会打开证据检视与关联证据。
        </div>
      </div>
    </section>
  );
}
