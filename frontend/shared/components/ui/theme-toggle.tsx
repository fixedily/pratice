"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useAppTheme } from "@/shared/theme/app-theme";
import { cn } from "@/shared/lib/utils";

type ThemeToggleVariant = "fixed" | "icon";

export function ThemeToggle({
  className,
  variant = "fixed",
}: {
  className?: string;
  variant?: ThemeToggleVariant;
}) {
  const { themePreference, setThemePreference } = useAppTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = themePreference === "dark";
  const isFixed = variant === "fixed";

  if (!mounted) {
    return <span className={cn(isFixed ? "fixed right-4 top-3 h-[52px] w-[26px] sm:right-6 sm:top-2 sm:h-[56px] sm:w-[28px]" : "inline-flex h-8 w-8", className)} aria-hidden />;
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="切换浅色/深色模式"
      title={isDark ? "切换到浅色模式" : "切换到深色模式"}
      onClick={() => setThemePreference(isDark ? "light" : "dark")}
      className={cn(
        isFixed
          ? [
              "fixed right-4 top-3 z-[60] inline-flex h-[52px] w-[26px] items-center rounded-full border p-[3px] sm:right-6 sm:top-2 sm:h-[56px] sm:w-[28px]",
              "backdrop-blur-[8px] transition-all duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
              "shadow-[0_10px_24px_rgba(15,23,42,0.12)] hover:border-brand/55 hover:shadow-[0_0_16px_rgba(16,185,129,0.18)]",
            ]
          : [
              "inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground transition-colors",
              "hover:bg-accent hover:text-accent-foreground",
            ],
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
        className,
      )}
      style={
        isFixed
          ? {
              background: isDark ? "rgba(2,8,23,0.82)" : "rgba(255,255,255,0.92)",
              borderColor: isDark ? "rgba(16,185,129,0.58)" : "rgba(15,23,42,0.18)",
            }
          : undefined
      }
    >
      {isFixed ? (
        <>
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute left-1/2 -translate-x-1/2 text-[10px] font-medium tracking-[0.02em]",
              isDark ? "top-[5px] text-emerald-300/90 sm:top-[6px]" : "bottom-[5px] text-slate-500 sm:bottom-[6px]",
            )}
          >
            {isDark ? "夜" : "日"}
          </span>
          <span
            aria-hidden
            className={cn(
              "absolute left-1/2 -translate-x-1/2 inline-flex h-[22px] w-[22px] items-center justify-center rounded-full border",
              "transition-all duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
              isDark ? "top-[27px] sm:top-[31px]" : "top-[3px]",
            )}
            style={{
              background: isDark ? "#111827" : "#ffffff",
              borderColor: isDark ? "rgba(110,231,183,0.32)" : "rgba(15,23,42,0.14)",
              boxShadow: isDark
                ? "0 0 0 1px rgba(16,185,129,0.24), 0 0 10px rgba(16,185,129,0.18)"
                : "0 4px 12px rgba(15,23,42,0.16)",
            }}
          >
            {isDark ? (
              <Moon className="h-3.5 w-3.5 text-emerald-200" aria-hidden />
            ) : (
              <Sun className="h-3.5 w-3.5 text-amber-500" aria-hidden />
            )}
          </span>
        </>
      ) : isDark ? (
        <Moon className="h-4 w-4" aria-hidden />
      ) : (
        <Sun className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}

