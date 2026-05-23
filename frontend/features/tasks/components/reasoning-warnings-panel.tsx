"use client";

import { AlertTriangle } from "lucide-react";
import type { KnowledgeSafetyWarning } from "@/shared/lib/http";

type Props = {
  warnings: string[];
  safetyWarnings?: KnowledgeSafetyWarning[];
  degraded: boolean;
};

function safetyToneClass(level?: string) {
  if (level === "blocking") {
    return "border-red-500/25 bg-red-500/8 text-red-700 dark:text-red-300";
  }
  if (level === "warning") {
    return "border-amber-500/25 bg-amber-500/8 text-amber-700 dark:text-amber-300";
  }
  return "border-sky-500/25 bg-sky-500/8 text-sky-700 dark:text-sky-300";
}

export function ReasoningWarningsPanel({ warnings, safetyWarnings = [], degraded }: Props) {
  if (!warnings.length && !safetyWarnings.length && !degraded) return null;

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
      {safetyWarnings.length > 0 ? (
        <div className="mt-4 space-y-2" data-testid="reasoning-safety-warnings">
          {safetyWarnings.map((warning) => (
            <div
              key={`${warning.code}-${warning.relation_ids.join("-")}-${warning.matched_terms.join("-")}`}
              className={`rounded-md border p-3 ${safetyToneClass(warning.level)}`}
            >
              <div className="text-sm font-medium">{warning.title}</div>
              <div className="mt-1 text-xs leading-5">{warning.message}</div>
              {warning.recommendation ? (
                <div className="mt-2 text-xs leading-5 text-muted-foreground">{warning.recommendation}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
