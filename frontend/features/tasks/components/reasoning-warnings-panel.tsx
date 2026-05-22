"use client";

import { AlertTriangle } from "lucide-react";

type Props = {
  warnings: string[];
  degraded: boolean;
};

export function ReasoningWarningsPanel({ warnings, degraded }: Props) {
  if (!warnings.length && !degraded) return null;

  return (
    <section className="rounded-xl border border-amber-500/20 bg-amber-500/8 p-4">
      <div className="mb-2 inline-flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5" />
        推理提示
      </div>
      <div className="space-y-1 text-sm leading-6 text-muted-foreground">
        {degraded ? <div>当前仅返回命中实体与证据片段，尚未形成完整关系链。</div> : null}
        {warnings.map((warning, index) => (
          <div key={`${warning}-${index}`}>{warning}</div>
        ))}
      </div>
    </section>
  );
}
