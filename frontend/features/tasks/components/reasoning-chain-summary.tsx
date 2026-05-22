"use client";

type Props = {
  summaryText: string;
  confidenceLabel: string;
};

export function ReasoningChainSummary({ summaryText, confidenceLabel }: Props) {
  return (
    <div className="rounded-xl border border-border bg-background/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">推理子图</div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{summaryText}</p>
        </div>
        <span className="app-chip-muted shrink-0">置信度 {confidenceLabel}</span>
      </div>
    </div>
  );
}
