"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { settingsMenuItems, type SettingsPanelId } from "@/features/settings/config/settingsConfig";
import { cardClass, pageText } from "@/features/settings/components/settings-ui";
import { cn } from "@/shared/lib/utils";

export function SettingsSidebar({
  activeId,
  isAdmin,
  hrefFor,
}: {
  activeId: SettingsPanelId;
  isAdmin: boolean;
  hrefFor: (id: SettingsPanelId) => string;
}) {
  const visibleItems = settingsMenuItems.filter((item) => isAdmin || !item.adminOnly);

  return (
    <aside className={cn("fd-sidebar-scroll lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-auto", cardClass)}>
      <div className="border-b border-slate-200/80 px-4 py-4 dark:border-white/[0.08]">
        <div className={cn("text-sm font-semibold", pageText.title)}>系统设置</div>
        <div className={cn("mt-1 text-xs", pageText.tertiary)}>平台治理与运维中心</div>
      </div>
      <nav className="flex gap-2 overflow-auto p-3 lg:block lg:space-y-1">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeId;
          return (
            <Link
              key={item.id}
              href={hrefFor(item.id)}
              scroll={false}
              className={cn(
                "group flex min-w-[11rem] items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition lg:min-w-0 lg:w-full",
                active
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 shadow-[0_0_0_1px_rgba(16,185,129,0.08)] dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300"
                  : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-300 dark:hover:border-white/[0.08] dark:hover:bg-white/[0.04] dark:hover:text-white",
              )}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{item.label}</span>
                  <span className={cn("mt-0.5 block truncate text-xs", active ? "text-emerald-700/75 dark:text-emerald-200/75" : pageText.tertiary)}>
                    {item.description}
                  </span>
                </span>
              </span>
              <ChevronRight className={cn("hidden h-4 w-4 shrink-0 transition lg:block", active ? "opacity-100" : "opacity-0 group-hover:opacity-60")} />
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
