"use client";

import { FileText, X } from "lucide-react";

type RelatedItem = {
  chunkId: number;
  label: string;
  meta: string;
  active: boolean;
};

type ProcedureInfo = {
  stepLabel: string;
  headline: string;
  actionLabel?: string | null;
  objectLabel?: string | null;
  detail?: string | null;
  sections: Array<{
    label: string;
    items: string[];
  }>;
  meta: string[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  procedureInfo?: ProcedureInfo | null;
  title: string;
  meta: string;
  scoreLabel: string;
  excerpt: string;
  relatedItems: RelatedItem[];
  onSelectChunk: (chunkId: number) => void;
  emptyMessage?: string;
};

export function ReasoningEvidenceInspector({
  open,
  onClose,
  procedureInfo,
  title,
  meta,
  scoreLabel,
  excerpt,
  relatedItems,
  onSelectChunk,
  emptyMessage = "当前节点还没有可查看的证据片段。",
}: Props) {
  if (!open) return null;

  const hasSelection = Boolean(procedureInfo || title || excerpt || relatedItems.length);

  return (
    <aside
      data-testid="reasoning-evidence-inspector"
      className="rounded-2xl border border-border/70 bg-white/95 p-4 shadow-[0_18px_46px_rgba(15,23,42,0.08)] dark:bg-slate-950/85"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            证据检视
          </div>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">仅在选中关系节点后展开，专门查看当前关系的证据。</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/85 text-muted-foreground transition-colors hover:bg-muted/20"
          aria-label="关闭证据抽屉"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {hasSelection ? (
        <div className="space-y-4">
          {procedureInfo ? (
            <div
              data-testid="reasoning-procedure-detail"
              className="rounded-2xl border border-sky-500/20 bg-sky-500/6 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-sky-500/20 bg-background/85 px-2.5 py-1 text-[11px] font-medium text-sky-700 dark:text-sky-300">
                  {procedureInfo.stepLabel}
                </span>
                {procedureInfo.actionLabel ? (
                  <span className="rounded-full border border-sky-500/15 bg-white/65 px-2.5 py-1 text-[11px] font-medium text-foreground/80 dark:bg-slate-900/35">
                    动作 {procedureInfo.actionLabel}
                  </span>
                ) : null}
                {procedureInfo.objectLabel ? (
                  <span className="rounded-full border border-sky-500/15 bg-white/65 px-2.5 py-1 text-[11px] font-medium text-foreground/80 dark:bg-slate-900/35">
                    对象 {procedureInfo.objectLabel}
                  </span>
                ) : null}
              </div>

              <div className="mt-3 text-sm font-semibold leading-6 text-foreground">{procedureInfo.headline}</div>

              {procedureInfo.detail ? (
                <p className="mt-3 text-sm leading-6 text-foreground/90">{procedureInfo.detail}</p>
              ) : null}

              {procedureInfo.sections.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {procedureInfo.sections.map((section) => (
                    <div key={`${procedureInfo.stepLabel}-${section.label}`} className="space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">{section.label}</div>
                      <ul className="space-y-1 pl-5 text-sm leading-6 text-foreground/90">
                        {section.items.map((item) => (
                          <li key={`${section.label}-${item}`} className="list-disc">
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : null}

              {procedureInfo.meta.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {procedureInfo.meta.map((item) => (
                    <span
                      key={`${procedureInfo.stepLabel}-${item}`}
                      className="rounded-full border border-border bg-background/85 px-2.5 py-1 text-[11px] text-muted-foreground"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/6 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-muted-foreground">结论依据</div>
                <div className="mt-1 text-sm font-semibold leading-6 text-foreground">{title}</div>
                <div className="text-xs text-muted-foreground">{meta}</div>
              </div>
              {scoreLabel && scoreLabel !== "--" ? <span className="app-chip-muted">{scoreLabel}</span> : null}
            </div>
            <p className="mt-3 text-sm leading-6 text-foreground/90">{excerpt}</p>
          </div>

          {relatedItems.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">关联证据</div>
              <div className="space-y-2">
                {relatedItems.map((item) => (
                  <button
                    key={item.chunkId}
                    type="button"
                    onClick={() => onSelectChunk(item.chunkId)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      item.active
                        ? "border-emerald-500/30 bg-emerald-500/8"
                        : "border-border bg-background/80 hover:bg-muted/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-foreground">{item.label}</span>
                      {item.active ? (
                        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">当前</span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.meta}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-background/60 px-4 py-6 text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      )}
    </aside>
  );
}
