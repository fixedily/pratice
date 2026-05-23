"use client";

import { useEffect, useMemo, useState } from "react";
import type { KnowledgeReasoningChain } from "@/shared/lib/http";
import { ReasoningChainSummary } from "@/features/tasks/components/reasoning-chain-summary";
import { ReasoningChainView } from "@/features/tasks/components/reasoning-chain-view";
import { ReasoningEvidenceInspector } from "@/features/tasks/components/reasoning-evidence-inspector";
import {
  buildReasoningSubgraphViewModel,
  type ReasoningProcedureStepHint,
} from "@/features/tasks/components/reasoning-subgraph-view-model";
import { ReasoningWarningsPanel } from "@/features/tasks/components/reasoning-warnings-panel";

function formatPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "--";
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
}

function sectionLabel(section?: string | null, page?: string | null) {
  return [section, page].filter(Boolean).join(" / ") || "命中片段";
}

type Props = {
  reasoningChain: KnowledgeReasoningChain | null | undefined;
  procedureSteps?: ReasoningProcedureStepHint[];
};

export function ReasoningSubgraphPanel({ reasoningChain, procedureSteps = [] }: Props) {
  const model = useMemo(
    () => buildReasoningSubgraphViewModel(reasoningChain, procedureSteps),
    [procedureSteps, reasoningChain],
  );
  const [expanded, setExpanded] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(model.defaultRelationId);
  const [selectedChunkId, setSelectedChunkId] = useState<number | null>(model.defaultChunkId);

  useEffect(() => {
    setExpanded(false);
    setFocusedNodeId(null);
    setSelectedRelationId(model.defaultRelationId);
    setSelectedChunkId(model.defaultChunkId);
  }, [model.defaultChunkId, model.defaultRelationId]);

  const allRelations = useMemo(() => [...model.visibleRelations, ...model.overflowRelations], [
    model.overflowRelations,
    model.visibleRelations,
  ]);
  const graphRelations = useMemo(
    () => (expanded ? allRelations : model.visibleRelations),
    [allRelations, expanded, model.visibleRelations],
  );

  const selectedRelation = useMemo(
    () => allRelations.find((item) => item.graphId === selectedRelationId) ?? null,
    [allRelations, selectedRelationId],
  );
  const selectedEvidence = useMemo(
    () => {
      if (!selectedRelation) return null;
      const relationChunkIds = selectedRelation.chunkIds;
      if (selectedChunkId != null && relationChunkIds.includes(selectedChunkId)) {
        return model.evidenceByChunkId.get(selectedChunkId) ?? null;
      }
      const fallbackChunkId = relationChunkIds[0] ?? null;
      return fallbackChunkId != null ? model.evidenceByChunkId.get(fallbackChunkId) ?? null : null;
    },
    [model.evidenceByChunkId, selectedChunkId, selectedRelation],
  );
  const drawerOpen = selectedRelation != null;
  const selectedProcedureInfo = useMemo(() => {
    const step = selectedRelation?.procedureStep;
    if (!step) return null;
    return {
      stepLabel: step.stepNo ? `操作步骤 ${step.stepNo}` : "操作步骤",
      headline: step.headline?.trim() || step.title || selectedRelation?.targetNode.title || "",
      actionLabel: step.actionLabel ?? null,
      objectLabel: step.objectLabel ?? null,
      detail: step.detail?.trim() || step.summary?.trim() || step.rawText?.trim() || "",
      sections: step.sections ?? [],
      meta: step.meta ?? [],
    };
  }, [selectedRelation]);

  const selectedRelationClaim = selectedRelation?.summary ?? null;
  const inspectorMeta = useMemo(() => {
    if (!selectedEvidence) {
      return selectedRelationClaim || "选择关系节点后，可在这里查看证据详情。";
    }

    const citation = selectedEvidence.citation_label || `chunk:${selectedEvidence.chunk_id}`;
    const section = sectionLabel(selectedEvidence.section_reference, selectedEvidence.page_reference);
    return selectedRelationClaim ? `${citation} · ${section} · ${selectedRelationClaim}` : `${citation} · ${section}`;
  }, [selectedEvidence, selectedRelationClaim]);
  const inspectorRelatedItems = useMemo(() => {
    const relationChunkIds = selectedRelation?.chunkIds ?? [];
    if (relationChunkIds.length > 0) {
      return relationChunkIds
        .map((chunkId) => model.evidenceByChunkId.get(chunkId))
        .filter((chunk): chunk is NonNullable<typeof chunk> => Boolean(chunk))
        .map((chunk) => ({
          chunkId: chunk.chunk_id,
          label: chunk.citation_label || `chunk:${chunk.chunk_id}`,
          meta: sectionLabel(chunk.section_reference, chunk.page_reference),
          active: chunk.chunk_id === selectedEvidence?.chunk_id,
        }));
    }

    return [];
  }, [model.evidenceByChunkId, selectedEvidence?.chunk_id, selectedRelation]);

  if (!model.hasData) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
        当前任务尚未返回可视化推理链。重新运行诊断后，系统会在这里展示问题、图谱实体、关系路径与证据片段。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ReasoningChainSummary summaryText={model.summaryText} confidenceLabel={model.confidenceLabel} />

      <div
        className={`grid gap-4 ${drawerOpen ? "2xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]" : "grid-cols-1"}`}
        onClick={() => {
          setFocusedNodeId(null);
          setSelectedRelationId(null);
          setSelectedChunkId(null);
        }}
      >
        <ReasoningChainView
          questionNode={model.questionNode}
          primaryEntityNode={model.primaryEntityNode}
          additionalEntities={model.additionalEntities}
          relations={graphRelations}
          expanded={expanded}
          overflowCount={model.overflowRelations.length}
          onToggleExpanded={() => setExpanded((current) => !current)}
          focusedNodeId={focusedNodeId}
          selectedRelationId={selectedRelationId}
          selectedChunkId={selectedChunkId}
          onSelectQuestion={() => {
            setFocusedNodeId(model.questionNode.id);
            setSelectedRelationId(null);
            setSelectedChunkId(null);
          }}
          onSelectEntity={() => {
            setFocusedNodeId(model.primaryEntityNode?.id ?? null);
            setSelectedRelationId(null);
            setSelectedChunkId(null);
          }}
          onSelectRelation={(relationId, chunkId) => {
            setFocusedNodeId(relationId);
            setSelectedRelationId(relationId);
            setSelectedChunkId(chunkId);
          }}
        />

        <div className="space-y-4">
          <ReasoningEvidenceInspector
            open={drawerOpen}
            onClose={() => {
              setFocusedNodeId(null);
              setSelectedRelationId(null);
              setSelectedChunkId(null);
            }}
            procedureInfo={selectedProcedureInfo}
            title={selectedEvidence?.title || selectedRelationClaim || ""}
            meta={inspectorMeta}
            scoreLabel={formatPercent(selectedEvidence?.score)}
            excerpt={
              selectedEvidence?.excerpt ||
              (selectedRelationClaim
                ? "当前关系已选中，但还没有关联的证据摘录。"
                : "选择左侧关系节点后，可在这里查看证据详情。")
            }
            relatedItems={inspectorRelatedItems}
            onSelectChunk={setSelectedChunkId}
            emptyMessage="选择左侧关系节点后，可在这里查看证据详情。"
          />
          <ReasoningWarningsPanel
            warnings={model.warnings}
            safetyWarnings={model.safetyWarnings}
            degraded={model.isDegradedNoRelationFlow}
          />
        </div>
      </div>
    </div>
  );
}
