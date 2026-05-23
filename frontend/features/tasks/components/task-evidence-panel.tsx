"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  BookOpen,
  ExternalLink,
  FileSearch,
  GitBranch,
  LocateFixed,
  ScanSearch,
  Sparkles,
} from "lucide-react";

import { translateReasoningRelationLabel } from "@/features/tasks/components/reasoning-subgraph-view-model";
import { Button } from "@/shared/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import type { KnowledgeReasoningChain, MaintenanceTaskDetail } from "@/shared/lib/http";

type KnowledgeRef = NonNullable<MaintenanceTaskDetail["source_refs"]>[number];

export type TaskEvidencePanelItem = {
  id: string;
  title: string;
  section: string;
  helper: string;
  excerpt: string;
  detailExcerpt: string;
  score: {
    label: string;
    value: string;
  };
  badges: string[];
  group: "direct" | "related";
  recommendationReason: string;
  sourceName?: string | null;
  citationLabel?: string | null;
  rawRef?: KnowledgeRef;
};

type Props = {
  items: TaskEvidencePanelItem[];
  evidenceCount: number;
  evidenceSimilarity: string;
  evidenceStatusNote: string;
  reasoningChain: KnowledgeReasoningChain | null;
};

type EvidenceGroup = {
  key: "direct" | "related";
  title: string;
  helper: string;
  icon: typeof ScanSearch;
  items: TaskEvidencePanelItem[];
};

function buildReasoningContext(
  item: TaskEvidencePanelItem | null,
  reasoningChain: KnowledgeReasoningChain | null,
) {
  if (!item?.rawRef || !reasoningChain) {
    return {
      linkedChunk: null,
      linkedRelations: [],
      matchedEntities: [],
      selectedClaims: reasoningChain?.selected_answer_claims ?? [],
      explanationText: reasoningChain?.explanation_text ?? null,
    };
  }

  const chunkId = item.rawRef.chunk_id;
  const linkedChunk = reasoningChain.evidence_chunks.find((chunk) => chunk.chunk_id === chunkId) ?? null;
  const linkedRelations = reasoningChain.expanded_relations.filter((relation) =>
    relation.evidence_chunk_ids.includes(chunkId),
  );
  const linkedEntityIds = new Set<number>();
  linkedRelations.forEach((relation) => {
    linkedEntityIds.add(relation.source_entity_id);
    linkedEntityIds.add(relation.target_entity_id);
  });
  const matchedEntities = reasoningChain.matched_entities.filter((entity) => linkedEntityIds.has(entity.id));

  return {
    linkedChunk,
    linkedRelations,
    matchedEntities,
    selectedClaims: reasoningChain.selected_answer_claims,
    explanationText: reasoningChain.explanation_text ?? null,
  };
}

export function TaskEvidencePanel({
  items,
  evidenceCount,
  evidenceSimilarity,
  evidenceStatusNote,
  reasoningChain,
}: Props) {
  const [selectedItem, setSelectedItem] = useState<TaskEvidencePanelItem | null>(null);

  const groups = useMemo<EvidenceGroup[]>(() => {
    const directItems = items.filter((item) => item.group === "direct");
    const relatedItems = items.filter((item) => item.group === "related");

    const evidenceGroups: EvidenceGroup[] = [
      {
        key: "direct",
        title: "直接命中",
        helper: "根据当前问题直接召回的知识证据",
        icon: ScanSearch,
        items: directItems,
      },
      {
        key: "related",
        title: "关联推荐",
        helper: "沿图谱关系或上下文扩展补充的证据",
        icon: Sparkles,
        items: relatedItems,
      },
    ];

    return evidenceGroups.filter((group) => group.items.length > 0);
  }, [items]);

  const reasoningContext = useMemo(
    () => buildReasoningContext(selectedItem, reasoningChain),
    [reasoningChain, selectedItem],
  );

  return (
    <>
      <div data-testid="task-evidence-panel" className="space-y-5">
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs leading-6 text-muted-foreground">
          {evidenceStatusNote}
        </div>

        {items.length > 0 ? (
          groups.map((group) => {
            const Icon = group.icon;
            return (
              <section
                key={group.key}
                data-testid={`task-evidence-group-${group.key}`}
                className="space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Icon className="h-4 w-4 text-brand" />
                      {group.title}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{group.helper}</p>
                  </div>
                  <span className="app-chip-muted shrink-0">{group.items.length} 条</span>
                </div>

                <div className="space-y-3">
                  {group.items.map((item) => (
                    <div
                      key={item.id}
                      data-testid={`task-evidence-card-${item.id}`}
                      className="rounded-lg border border-border bg-muted/30 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-medium text-foreground">{item.title}</div>
                            {item.citationLabel ? <span className="app-chip-muted">{item.citationLabel}</span> : null}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">{item.section}</div>
                        </div>
                        <span className="app-chip-muted shrink-0">
                          {item.score.label} {item.score.value}
                        </span>
                      </div>

                      {item.badges.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.badges.map((badge) => (
                            <span key={`${item.id}-${badge}`} className="app-chip-muted">
                              {badge}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      <div className="mt-3 text-xs leading-6 text-muted-foreground">
                        {item.recommendationReason || item.helper}
                      </div>
                      <div className="mt-2 text-sm leading-6 text-foreground/90">{item.excerpt}</div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs text-muted-foreground">
                          {item.sourceName || "知识来源"}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-testid={`task-evidence-open-${item.id}`}
                          onClick={() => setSelectedItem(item)}
                        >
                          <FileSearch className="h-4 w-4" />
                          查看依据
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
            当前任务尚未返回可展示的关键证据来源。
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
          <span>命中证据数 {evidenceCount} 条</span>
          <span>最高相关度 {evidenceSimilarity}</span>
        </div>
      </div>

      <Sheet open={selectedItem != null} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <SheetContent
          side="right"
          className="w-full gap-0 border-border bg-background sm:max-w-xl"
          data-testid="task-evidence-detail-sheet"
        >
          <SheetHeader className="border-b border-border px-5 py-4">
            <div className="flex flex-wrap gap-2 pr-8">
              {selectedItem?.citationLabel ? <span className="app-chip-muted">{selectedItem.citationLabel}</span> : null}
              {selectedItem?.badges.map((badge) => (
                <span key={`sheet-${selectedItem.id}-${badge}`} className="app-chip-muted">
                  {badge}
                </span>
              ))}
            </div>
            <SheetTitle className="pr-8 text-base">{selectedItem?.title || "证据详情"}</SheetTitle>
            <SheetDescription>
              {selectedItem?.group === "related" ? "关联推荐详情与可追溯依据" : "直接命中详情与可追溯依据"}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <section className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" />
                为什么推荐
              </div>
              <p className="text-sm leading-6 text-foreground/90">
                {selectedItem?.recommendationReason || selectedItem?.helper || "当前结果未返回推荐理由。"}
              </p>
              <div className="mt-3 text-xs text-muted-foreground">
                {selectedItem?.score.label} {selectedItem?.score.value}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <LocateFixed className="h-3.5 w-3.5" />
                原文定位
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">来源文件</dt>
                  <dd className="mt-1 text-foreground">
                    {selectedItem?.rawRef?.source_name || selectedItem?.sourceName || "--"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">文档编号 / Chunk</dt>
                  <dd className="mt-1 text-foreground">
                    {selectedItem?.rawRef?.document_id ? `#${selectedItem.rawRef.document_id}` : "--"}
                    {selectedItem?.rawRef?.chunk_id ? ` / C${selectedItem.rawRef.chunk_id}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">章节 / 路径</dt>
                  <dd className="mt-1 text-foreground">
                    {selectedItem?.rawRef?.section_path ||
                      selectedItem?.rawRef?.section_reference ||
                      selectedItem?.section ||
                      "--"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">页码 / 步骤</dt>
                  <dd className="mt-1 text-foreground">
                    {selectedItem?.rawRef?.page_reference || "--"}
                    {selectedItem?.rawRef?.step_anchor ? ` · 步骤 ${selectedItem.rawRef.step_anchor}` : ""}
                  </dd>
                </div>
              </dl>
            </section>

            {reasoningContext.linkedRelations.length > 0 || reasoningContext.matchedEntities.length > 0 ? (
              <section className="rounded-lg border border-border bg-muted/20 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <GitBranch className="h-3.5 w-3.5" />
                  推理链关联
                </div>
                {reasoningContext.matchedEntities.length > 0 ? (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {reasoningContext.matchedEntities.map((entity) => (
                      <span key={entity.id} className="app-chip-muted">
                        {entity.canonical_name}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="space-y-2">
                  {reasoningContext.linkedRelations.map((relation) => (
                    <div key={relation.id} className="rounded-md border border-border bg-background/80 px-3 py-2 text-sm">
                      <span className="font-medium text-foreground">{relation.source_name}</span>
                      <span className="mx-1 text-muted-foreground">
                        {translateReasoningRelationLabel(relation.relation_type)}
                      </span>
                      <span className="font-medium text-foreground">{relation.target_name}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {reasoningContext.selectedClaims.length > 0 || reasoningContext.explanationText ? (
              <section className="rounded-lg border border-border bg-muted/20 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <BookOpen className="h-3.5 w-3.5" />
                  结论采用
                </div>
                {reasoningContext.selectedClaims.length > 0 ? (
                  <div className="space-y-2 text-sm leading-6 text-foreground/90">
                    {reasoningContext.selectedClaims.slice(0, 3).map((claim, index) => (
                      <p key={`${claim}-${index}`}>{claim}</p>
                    ))}
                  </div>
                ) : null}
                {reasoningContext.explanationText ? (
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{reasoningContext.explanationText}</p>
                ) : null}
              </section>
            ) : null}

            <section className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <FileSearch className="h-3.5 w-3.5" />
                证据摘录
              </div>
              <p className="text-sm leading-6 text-foreground/90">
                {selectedItem?.detailExcerpt || selectedItem?.excerpt || "当前结果未返回可展示摘录。"}
              </p>
              {selectedItem?.rawRef?.image_caption ? (
                <p className="mt-3 text-xs leading-6 text-muted-foreground">
                  图像说明：{selectedItem.rawRef.image_caption}
                </p>
              ) : null}
              {selectedItem?.rawRef?.ocr_text ? (
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  OCR 线索：{selectedItem.rawRef.ocr_text}
                </p>
              ) : null}
              {reasoningContext.linkedChunk?.excerpt &&
              reasoningContext.linkedChunk.excerpt !== selectedItem?.detailExcerpt &&
              reasoningContext.linkedChunk.excerpt !== selectedItem?.excerpt ? (
                <p className="mt-3 text-xs leading-6 text-muted-foreground">
                  推理链引用：{reasoningContext.linkedChunk.excerpt}
                </p>
              ) : null}
            </section>
          </div>

          <SheetFooter className="border-t border-border px-5 py-4">
            {selectedItem?.rawRef?.document_id && selectedItem?.rawRef?.chunk_id ? (
              <Button asChild className="w-full sm:w-auto">
                <Link href={`/knowledge/${selectedItem.rawRef.document_id}?focusChunk=${selectedItem.rawRef.chunk_id}`}>
                  <ExternalLink className="h-4 w-4" />
                  定位到原文
                </Link>
              </Button>
            ) : null}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
