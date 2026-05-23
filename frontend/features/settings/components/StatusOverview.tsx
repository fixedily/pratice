import { Activity, BellRing, BrainCircuit, CheckCircle2, Library, SearchCheck } from "lucide-react";

import { cardClass, pageText, toneClass } from "@/features/settings/components/settings-ui";
import type { StatusCardData } from "@/features/settings/mock/settingsMock";
import { cn } from "@/shared/lib/utils";

const icons = [BrainCircuit, Library, SearchCheck, BellRing];

export function StatusOverview({ items, updatedAt }: { items: StatusCardData[]; updatedAt: string }) {
  return (
    <div className={cn("p-4", cardClass)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className={cn("text-sm font-semibold", pageText.title)}>平台运行状态</div>
          <div className={cn("mt-1 text-xs", pageText.tertiary)}>面向公开演示的核心能力健康态势，兼顾企业运维检查。</div>
        </div>
        <div className={cn("flex items-center gap-2 text-xs", pageText.tertiary)}>
          <Activity className="h-4 w-4" />
          最近检查：{updatedAt}
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item, index) => {
          const Icon = icons[index] ?? CheckCircle2;
          return (
            <div key={item.title} className="rounded-xl border border-slate-200/80 bg-slate-50/75 p-4 dark:border-white/[0.08] dark:bg-white/[0.03]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-white text-emerald-700 dark:border-emerald-400/20 dark:bg-white/[0.05] dark:text-emerald-300">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className={cn("truncate text-sm font-medium", pageText.secondary)}>{item.title}</div>
                    <div className={cn("mt-1 truncate text-lg font-semibold", pageText.title)}>{item.value}</div>
                  </div>
                </div>
                <span className={cn("shrink-0 rounded-full border px-2 py-1 text-xs font-medium", toneClass(item.tone))}>在线</span>
              </div>
              <div className={cn("mt-3 text-xs leading-5", pageText.tertiary)}>{item.detail}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
