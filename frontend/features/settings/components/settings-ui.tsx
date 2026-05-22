import type { LucideIcon } from "lucide-react";
import type React from "react";

import { cn } from "@/shared/lib/utils";
import type { Tone } from "@/features/settings/mock/settingsMock";

export const pageText = {
  title: "text-slate-950 dark:text-slate-50",
  primary: "text-slate-700 dark:text-slate-200",
  secondary: "text-slate-600 dark:text-slate-300",
  tertiary: "text-slate-500 dark:text-slate-400",
};

export const cardClass =
  "rounded-xl border border-slate-200/80 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.06)] dark:border-white/[0.08] dark:bg-[#101822] dark:shadow-[0_18px_42px_rgba(0,0,0,0.28)]";

export const mutedPanelClass =
  "rounded-xl border border-slate-200/80 bg-slate-50/80 dark:border-white/[0.08] dark:bg-white/[0.03]";

export function toneClass(tone: Tone = "neutral") {
  if (tone === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300";
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-300";
  if (tone === "danger") return "border-red-200 bg-red-50 text-red-700 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-300";
  return "border-slate-200 bg-slate-100 text-slate-600 dark:border-white/[0.10] dark:bg-white/[0.05] dark:text-slate-300";
}

export function statusText(tone: Tone = "neutral") {
  if (tone === "success") return "正常";
  if (tone === "warning") return "关注";
  if (tone === "danger") return "异常";
  return "待检查";
}

export function SettingsSectionShell({
  title,
  description,
  icon: Icon,
  children,
  actions,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className={cn("px-5 py-4", cardClass)}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className={cn("text-lg font-semibold", pageText.title)}>{title}</h2>
              <p className={cn("mt-1 text-sm", pageText.tertiary)}>{description}</p>
            </div>
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function SettingsField({ label, value, hint, sensitive }: { label: string; value: string; hint?: string; sensitive?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-slate-200/80 bg-white px-4 py-3 dark:border-white/[0.08] dark:bg-white/[0.03]")}>
      <div className={cn("text-xs font-medium", pageText.tertiary)}>{label}</div>
      <div className={cn("mt-2 break-words text-sm font-semibold", sensitive ? "font-mono tracking-wide" : "", pageText.title)}>{value}</div>
      {hint ? <div className={cn("mt-1 text-xs", pageText.tertiary)}>{hint}</div> : null}
    </div>
  );
}

export function MetricCard({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint?: string; tone?: Tone }) {
  return (
    <div className={cn("p-4", cardClass)}>
      <div className="flex items-center justify-between gap-3">
        <div className={cn("text-sm font-medium", pageText.secondary)}>{label}</div>
        <span className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", toneClass(tone))}>{statusText(tone)}</span>
      </div>
      <div className={cn("mt-3 text-2xl font-semibold", pageText.title)}>{value}</div>
      {hint ? <div className={cn("mt-2 text-xs", pageText.tertiary)}>{hint}</div> : null}
    </div>
  );
}

export function ToggleRow({ label, enabled, description }: { label: string; enabled: boolean; description: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 rounded-xl border px-4 py-3", enabled ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-400/20 dark:bg-emerald-400/[0.08]" : "border-slate-200 bg-slate-50 dark:border-white/[0.08] dark:bg-white/[0.03]")}>
      <div className="min-w-0">
        <div className={cn("text-sm font-semibold", pageText.title)}>{label}</div>
        <div className={cn("mt-1 text-xs leading-5", pageText.tertiary)}>{description}</div>
      </div>
      <span className={cn("shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium", enabled ? toneClass("success") : toneClass("neutral"))}>
        {enabled ? "启用" : "停用"}
      </span>
    </div>
  );
}

export function ConfigGrid({ fields }: { fields: Array<{ label: string; value: string; hint?: string; sensitive?: boolean }> }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {fields.map((field) => (
        <SettingsField key={field.label} {...field} />
      ))}
    </div>
  );
}
