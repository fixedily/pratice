"use client";

import type { ReasoningEvidenceBadge } from "@/features/tasks/components/reasoning-subgraph-view-model";

type Props = {
  badges: ReasoningEvidenceBadge[];
  selectedChunkId: number | null;
  onSelectChunk: (chunkId: number) => void;
};

export function ReasoningEvidenceBadgeGroup({ badges, selectedChunkId, onSelectChunk }: Props) {
  if (!badges.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {badges.map((badge) => {
        const active = selectedChunkId === badge.chunkId;
        return (
          <button
            key={badge.chunkId}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectChunk(badge.chunkId);
            }}
            title={`${badge.label} ${badge.meta}`}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              active
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-border bg-muted/25 text-muted-foreground hover:bg-muted/45"
            }`}
          >
            {badge.label}
          </button>
        );
      })}
    </div>
  );
}
