"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Play } from "lucide-react";
import Link from "next/link";
import { useMaintenanceAuth } from "@/features/auth/maintenance-auth";
import { fetchWorkbenchOverview, fetchHealth } from "@/features/dashboard/api";
import { ROUTES, protectedEntryHref } from "@/shared/lib/routes";
import { cn } from "@/shared/lib/utils";

import { Button } from "@/shared/components/ui/button";
import { SectionBadge } from "@/shared/components/ui/section-badge";
import { ui } from "@/shared/theme/ui-tokens";

function formatInt(n: number) {
  return n.toLocaleString("en-US");
}

function boundedDelta(value: number, min: number, max: number) {
  const delta = Math.floor(Math.random() * 3) - 1;
  const nextValue = Math.max(min, Math.min(max, value + delta));
  return { value: nextValue, delta: nextValue - value };
}

function calcClosureRate(closedTotal: number, pending: number, newAlerts: number) {
  return Math.max(86, Math.min(94, 84 + Math.round(closedTotal / 12) - Math.round(pending / 10) - Math.round(newAlerts / 8)));
}

type TrendPoint = { id: string; value: number };

function buildTrendLine(points: TrendPoint[]) {
  const width = 320;
  const height = 76;
  const paddingX = 6;
  const paddingY = 9;
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;
  const maxValue = Math.max(12, ...points.map((point) => point.value));

  const coords = points.map((point, index) => {
    const x = paddingX + (innerWidth / Math.max(1, points.length - 1)) * index;
    const y = paddingY + (1 - point.value / maxValue) * innerHeight;
    return { ...point, x, y };
  });

  const linePath = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const areaPath = coords.length
    ? `${linePath} L ${coords[coords.length - 1]!.x.toFixed(1)} ${height - paddingY} L ${coords[0]!.x.toFixed(1)} ${height - paddingY} Z`
    : "";

  return { width, height, coords, linePath, areaPath };
}

type Severity = "high" | "medium" | "low";
type AlertItem = {
  id: string;
  device: string;
  type: string;
  severity: Severity;
  createdAtMs: number;
  entering?: boolean;
  exiting?: boolean;
};

type HeroProps = {
  initialNowMs: number;
};

const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;

function getChinaTimeParts(timestampMs: number) {
  const date = new Date(timestampMs + CHINA_TIME_OFFSET_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hours: date.getUTCHours(),
    minutes: date.getUTCMinutes(),
  };
}

function createInitialAlerts(baseMs: number): AlertItem[] {
  return [
    { id: "a0", device: "发动机总成", type: "S7 执行处理", severity: "high", createdAtMs: baseMs - 2 * 60_000 },
    { id: "a1", device: "火花塞", type: "S3 等待接单", severity: "medium", createdAtMs: baseMs - 5 * 60_000 },
    { id: "a2", device: "起动电机", type: "S10 案例沉淀", severity: "low", createdAtMs: baseMs - 12 * 60_000 },
  ];
}

function useTweenNumber(target: number, durationMs = 700) {
  const [value, setValue] = useState(0);
  const valueRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const fromRef = useRef(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    fromRef.current = valueRef.current;
    startRef.current = null;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const p = Math.min(1, (t - startRef.current) / durationMs);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3);
      const next = Math.round(fromRef.current + (target - fromRef.current) * eased);
      valueRef.current = next;
      setValue(next);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  return value;
}

export function Hero({ initialNowMs }: HeroProps) {
  const { isLoggedIn } = useMaintenanceAuth();
  const trendPointCount = 12;
  // 注意：首屏必须是确定性的（避免 SSR/CSR hydration mismatch）
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>(() => {
    const initialValues = [4, 6, 5, 8, 7, 10, 6, 9, 8, 7, 9, 6];
    return initialValues.slice(0, trendPointCount).map((value, i) => ({ id: `point-${i}`, value }));
  });
  const nextTrendPointIdRef = useRef(trendPointCount);

  const [kpi, setKpi] = useState(() => ({
    devices: { value: 21, delta: 2 },
    alerts: { value: 7, delta: -1 },
    done: { value: calcClosureRate(85, 21, 7), delta: 1 },
  }));
  const kpiIntervalRef = useRef<number | null>(null);
  const trendIntervalRef = useRef<number | null>(null);
  const alertsIntervalRef = useRef<number | null>(null);
  const alertExitTimersRef = useRef<number[]>([]);
  const alertEnterTimersRef = useRef<number[]>([]);
  const [nowMs, setNowMs] = useState(() => initialNowMs);

  const [alerts, setAlerts] = useState<AlertItem[]>(() => createInitialAlerts(initialNowMs));
  const alertSeqRef = useRef(3);

  const formatEventTime = (createdAtMs: number) => {
    const eventDate = getChinaTimeParts(createdAtMs);
    const nowDate = getChinaTimeParts(nowMs);
    const hours = String(eventDate.hours).padStart(2, "0");
    const minutes = String(eventDate.minutes).padStart(2, "0");
    const isToday = eventDate.year === nowDate.year && eventDate.month === nowDate.month && eventDate.day === nowDate.day;

    if (isToday) return `今日 ${hours}:${minutes}`;

    const month = String(eventDate.month).padStart(2, "0");
    const day = String(eventDate.day).padStart(2, "0");
    return `${month}-${day} ${hours}:${minutes}`;
  };

  const randomAlert = (): Omit<AlertItem, "id" | "createdAtMs"> => {
    const devices = ["发动机总成", "火花塞", "起动电机", "气缸组件", "点火线圈", "润滑系统"];
    const types = ["S3 等待接单", "S5 维修接单", "S7 执行处理", "S8 结果回填", "S9 验收确认", "S10 案例沉淀"];
    const severity: Severity = (() => {
      const r = Math.random();
      return r < 0.25 ? "high" : r < 0.65 ? "medium" : "low";
    })();
    const device = devices[Math.floor(Math.random() * devices.length)] ?? devices[0]!;
    const type = types[Math.floor(Math.random() * types.length)] ?? types[0]!;
    return { device, type, severity };
  };

  // KPI 只做低频小幅刷新，避免营销预览看起来像随机数仪表盘。
  useEffect(() => {
    const tick = () => {
      setKpi((prev) => {
        const devices = boundedDelta(prev.devices.value, 16, 25);
        const alerts = boundedDelta(prev.alerts.value, 4, 10);

        return {
          devices,
          alerts,
          done: prev.done,
        };
      });
    };

    const timeoutId = window.setTimeout(() => {
      tick();
      kpiIntervalRef.current = window.setInterval(tick, 6500);
    }, 6500);

    return () => {
      window.clearTimeout(timeoutId);
      if (kpiIntervalRef.current) window.clearInterval(kpiIntervalRef.current);
    };
  }, []);

  // 闭环完成率与近 24 小时完成量联动，同时受当前待处理和今日检索任务影响。
  useEffect(() => {
    setKpi((prev) => {
      const closedTotal = trendPoints.reduce((sum, point) => sum + point.value, 0);
      const nextRate = calcClosureRate(closedTotal, prev.devices.value, prev.alerts.value);
      if (nextRate === prev.done.value) return prev;

      return {
        ...prev,
        done: { value: nextRate, delta: nextRate - prev.done.value },
      };
    });
  }, [trendPoints, kpi.alerts.value, kpi.devices.value]);

  // 近 24 小时闭环趋势按 2 小时粒度展示完成量，保留自然峰谷。
  useEffect(() => {
    const tick = () => {
      setTrendPoints((prev) => {
        const previous = prev[prev.length - 1]?.value ?? 6;
        const nextValue = Math.max(3, Math.min(11, previous + Math.floor(Math.random() * 5) - 2));
        const next = prev.slice(1);
        next.push({ id: `point-${nextTrendPointIdRef.current++}`, value: nextValue });
        return next;
      });
    };

    trendIntervalRef.current = window.setInterval(tick, 3600);
    return () => {
      if (trendIntervalRef.current) window.clearInterval(trendIntervalRef.current);
    };
  }, []);

  // 风险任务：每 2s 顶部弹出新的待办风险；底部淡出后移除。
  useEffect(() => {
    const maxAlerts = 3;
    const exitMs = 520;

    // 时间持续更新（列表时间不会“卡住”）
    const mountedNowMs = Date.now();
    setNowMs(mountedNowMs);
    setAlerts(createInitialAlerts(mountedNowMs));
    const nowTimer = window.setInterval(() => setNowMs(Date.now()), 1000);

    const tick = () => {
      setAlerts((prev) => {
        const next: AlertItem[] = [
          {
            id: `a${alertSeqRef.current++}`,
            createdAtMs: Date.now(),
            entering: true,
            ...randomAlert(),
          },
          ...prev,
        ];

        // 让最新告警从淡入开始（下一帧移除 entering）
        const enterId = next[0]!.id;
        const enterTimer = window.setTimeout(() => {
          setAlerts((curr) => curr.map((x) => (x.id === enterId ? { ...x, entering: false } : x)));
        }, 20);
        alertEnterTimersRef.current.push(enterTimer);

        if (next.length > maxAlerts) {
          const idx = maxAlerts;
          if (next[idx]) next[idx] = { ...next[idx]!, exiting: true };
          const timer = window.setTimeout(() => {
            setAlerts((curr) => curr.filter((x) => x.id !== next[idx]!.id));
          }, exitMs);
          alertExitTimersRef.current.push(timer);
          return next.slice(0, maxAlerts + 1);
        }
        return next;
      });
    };

    alertsIntervalRef.current = window.setInterval(tick, 2000);
    return () => {
      if (alertsIntervalRef.current) window.clearInterval(alertsIntervalRef.current);
      window.clearInterval(nowTimer);
      alertExitTimersRef.current.forEach((t) => window.clearTimeout(t));
      alertExitTimersRef.current = [];
      alertEnterTimersRef.current.forEach((t) => window.clearTimeout(t));
      alertEnterTimersRef.current = [];
    };
  }, []);

  const devicesDisplay = useTweenNumber(kpi.devices.value, 820);
  const alertsDisplay = useTweenNumber(kpi.alerts.value, 740);
  const doneDisplay = useTweenNumber(kpi.done.value, 780);

  const stats = useMemo(
    () => [
      { label: "待处理工单", value: devicesDisplay, delta: kpi.devices.delta, suffix: "", isMain: false },
      { label: "今日检索任务", value: alertsDisplay, delta: kpi.alerts.delta, suffix: "", isMain: false },
      { label: "闭环完成率", value: doneDisplay, delta: kpi.done.delta, suffix: "%", isMain: true },
    ],
    [alertsDisplay, devicesDisplay, doneDisplay, kpi.alerts.delta, kpi.devices.delta, kpi.done.delta],
  );
  const trendLine = useMemo(() => buildTrendLine(trendPoints), [trendPoints]);
  const trendSummary = useMemo(() => {
    const latestSlot = trendPoints[trendPoints.length - 1]?.value ?? 0;
    const previousSlot = trendPoints[trendPoints.length - 2]?.value ?? latestSlot;
    const total = trendPoints.reduce((sum, point) => sum + point.value, 0);
    const delta = latestSlot - previousSlot;

    return { total, delta };
  }, [trendPoints]);

  return (
    <section id="home" className="relative overflow-hidden pt-24 pb-12 lg:pt-28 lg:pb-14">
      {/* 背景光晕层 */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          className="absolute -left-24 -top-24 h-[460px] w-[560px] rounded-full blur-[90px]"
          style={{ background: "radial-gradient(ellipse, rgba(148,163,184,0.2) 0%, transparent 70%)" }}
        />
        <div
          className="absolute -right-12 top-1/4 h-[420px] w-[520px] rounded-full blur-[110px]"
          style={{ background: "radial-gradient(ellipse, rgba(24,182,99,0.12) 0%, transparent 72%)" }}
        />
      </div>
      <div className={`${ui.container} relative`}>
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          {/* Left content */}
          <div className="text-center lg:text-left">
            <SectionBadge className="mb-5 text-[13px]">设备检修知识与作业助手</SectionBadge>

            {/* 层级：说明(微) → 主标题(最大) → 强调行(中) → 收束行(小) */}
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.2em] text-text-tertiary sm:text-xs">
              多模态检修知识检索与作业系统
            </p>
            <h1 className="mb-3 text-4xl font-bold leading-[1.06] tracking-[-0.045em] text-text-primary sm:text-5xl lg:text-[64px]">
              <span className="block">把检修问题变成</span>
              <span className="block">可追溯依据与</span>
              <span className="block">
                <span className="hero-accent">作业步骤</span>
              </span>
            </h1>
            <p className="mx-auto mb-8 max-w-[540px] text-[16px] leading-7 text-text-secondary lg:mx-0">
              支持文字、图片和设备型号输入，先检索维修手册、SOP 与历史案例，再生成标准化作业指引，并将处理结果回流为可审核、可复用的知识条目。
            </p>

            <div className="mt-6 flex h-12 flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center lg:justify-start">
              <Button
                variant="brand"
                size="marketingLg"
                className="h-12 rounded-xl bg-brand text-[#04120b] shadow-[0_12px_32px_rgba(24,195,126,0.24)] hover:bg-brand-dark hover:shadow-[0_16px_34px_rgba(24,195,126,0.28)]"
                asChild
              >
                <Link
                  href={isLoggedIn ? "/tasks" : protectedEntryHref(ROUTES.dashboard)}
                  onClick={() => {
                    if (!isLoggedIn) void fetchWorkbenchOverview();
                  }}
                >
                  {isLoggedIn ? "继续检修" : "进入检修演示"}
                  <ArrowRight className="h-4 w-4 opacity-90" />
                </Link>
              </Button>
              <Button
                type="button"
                variant="brandSecondary"
                size="marketingLg"
                className="h-12 rounded-xl border-[#dde5ec] bg-card text-[#111827] hover:bg-bg-elevated dark:border-white/[0.10] dark:bg-white/[0.04] dark:text-[#e7edf3] dark:hover:bg-white/[0.08] dark:hover:text-[#f5f7fa]"
                onClick={() => {
                  void fetchHealth();
                }}
              >
                <Play className="h-4 w-4 opacity-80" />
                查看系统能力
              </Button>
            </div>

            {/* Trust indicators */}
            <div className="mt-10 border-t border-border/80 pt-5">
              <p className="mb-5 text-[13px] leading-snug text-landing-text-muted">
                围绕检修主线，串联多模态检索、图谱证据链与工单闭环，覆盖作业指引、结果回填与案例审核入库。
              </p>
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 lg:justify-start">
                {["检修知识检索", "图谱与证据链", "工单闭环", "案例审核入库"].map((name, i) => (
                  <span key={name} className="inline-flex items-center gap-x-3">
                    {i > 0 ? (
                      <span className="hidden select-none text-[10px] text-[rgba(255,255,255,0.2)] sm:inline" aria-hidden>
                        ·
                      </span>
                    ) : null}
                    <span className="cursor-default text-[11px] font-medium tracking-[0.08em] text-landing-text-faint transition-opacity duration-200 hover:text-landing-text-subtle sm:text-xs">
                      {name}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Right content - Product preview */}
          <div className="relative">
            <div className="mx-auto max-w-[560px] rounded-[20px] border border-white/[0.08] bg-card p-3 shadow-[0_20px_50px_rgba(0,0,0,0.28)] sm:p-3.5">
              <div className="relative rounded-[16px] border border-[rgba(24,195,126,0.18)] bg-[#0c1320] p-3.5 shadow-[0_12px_30px_rgba(2,6,23,0.24)] sm:p-4">
                <div className="animate-float-glow absolute right-3 top-3 rounded-md border border-white/[0.08] bg-[#f4f7f5] px-2.5 py-2 sm:right-4 sm:top-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft">
                      <div className="h-2 w-2 rounded-full bg-accent" />
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-[#0f172a]">知识回流</div>
                      <div className="text-[10px] text-[#6b7280]">S8 结果回填中</div>
                    </div>
                  </div>
                </div>
                {/* Window header */}
                <div className="mb-3.5 flex items-center gap-2 border-b border-white/[0.08] pb-3.5 pr-24 sm:pr-28">
                  <div className="flex gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/90" />
                    <div className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]/90" />
                    <div className="h-2.5 w-2.5 rounded-full bg-[#28ca42]/90" />
                  </div>
                  <div className="flex-1 text-center">
                    <span className="text-[11px] text-[#d5deec]">检修知识闭环工作台</span>
                  </div>
                </div>

                {/* Mock workbench content */}
                <div className="space-y-3">
                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2.5">
                    {stats.map((stat) => {
                      const isMain = stat.isMain;
                      return (
                        <div
                          key={stat.label}
                          className={`rounded-md border p-2.5 sm:p-3 ${isMain
                              ? "border-[rgba(24,195,126,0.28)] bg-[linear-gradient(135deg,rgba(6,45,34,0.96),rgba(4,33,26,0.96)_65%)]"
                              : "border-white/[0.06] bg-white/[0.03]"
                            }`}
                        >
                          <div className={isMain ? "mb-1 text-[11px] text-brand/70" : "mb-1 text-[11px] text-[#8fa1b7]"}>{stat.label}</div>
                          <div
                            className={
                              isMain
                                ? "text-[32px] font-semibold leading-none tracking-tight text-brand-light sm:text-[34px]"
                                : "text-[34px] font-semibold tabular-nums leading-none tracking-tight text-[#e7edf8]"
                            }
                          >
                            {formatInt(stat.value)}
                            {stat.suffix ? <span className="ml-0.5 text-[18px]">{stat.suffix}</span> : null}
                          </div>
                          <div
                            className={`text-[11px] tabular-nums ${isMain ? "font-medium text-[rgba(74,222,128,0.7)]" : "text-[#7f8ba1]"
                              }`}
                          >
                            {stat.delta >= 0 ? `+${stat.delta}` : `${stat.delta}`}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Alert list preview */}
                  <div className="rounded-md border border-white/[0.06] bg-white/[0.03] p-2.5 sm:p-3">
                    <div className="mb-2.5 text-[11px] text-[#c8d0de]">待处理检修任务</div>
                    <div className="space-y-2">
                      {alerts.slice(0, 3).map((alert) => (
                        <div
                          key={alert.id}
                          className={cn(
                            "flex items-center justify-between rounded border border-white/[0.04] bg-black/20 px-2 py-1.5",
                            "transition-[opacity,transform] duration-500 ease-out",
                            // 淡入：不做位移弹入
                            alert.entering ? "opacity-0" : "opacity-100",
                            // 底部淡出：仅淡出，不做位移
                            alert.exiting ? "opacity-0" : "",
                          )}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <div
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${alert.severity === "high"
                                  ? "bg-landing-status-error"
                                  : alert.severity === "medium"
                                    ? "bg-landing-status-warning"
                                    : "bg-landing-status-info"
                                }`}
                            />
                            <span className="truncate text-[11px] text-[#e7edf8]">{alert.device}</span>
                            <span className="hidden truncate text-[11px] text-[#8290a6] sm:inline">
                              {alert.type}
                            </span>
                          </div>
                          <span className="shrink-0 pl-2 text-[10px] tabular-nums text-[#7f8ba1]">
                            {formatEventTime(alert.createdAtMs)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Chart placeholder */}
                  <div className="rounded-md border border-white/[0.06] bg-white/[0.03] p-2.5 sm:p-3">
                    <div className="mb-2.5 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-medium text-[#dce5f3]">近 24 小时闭环任务</div>
                        <div className="mt-0.5 text-[10px] text-[#7f8ba1]">每 2 小时完成量，联动闭环完成率</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[18px] font-semibold leading-none tabular-nums text-brand-light">
                          {trendSummary.total}
                        </div>
                        <div
                          className={cn(
                            "mt-0.5 text-[10px] tabular-nums",
                            trendSummary.delta >= 0 ? "text-brand-light/80" : "text-[#94a3b8]",
                          )}
                        >
                          较上一时段 {trendSummary.delta >= 0 ? "+" : ""}
                          {trendSummary.delta}
                        </div>
                      </div>
                    </div>
                    <div className="relative h-[72px] overflow-hidden rounded-[6px] bg-[linear-gradient(180deg,rgba(15,23,42,0.15),rgba(15,23,42,0.02))]">
                      <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-white/[0.05]" />
                      <svg
                        className="h-full w-full overflow-visible"
                        viewBox={`0 0 ${trendLine.width} ${trendLine.height}`}
                        preserveAspectRatio="none"
                        role="img"
                        aria-label="近 24 小时每 2 小时已闭环任务折线趋势"
                      >
                        <defs>
                          <linearGradient id="hero-closure-line" x1="0" x2="1" y1="0" y2="0">
                            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.55" />
                            <stop offset="55%" stopColor="#34d399" stopOpacity="1" />
                            <stop offset="100%" stopColor="#86efac" stopOpacity="0.82" />
                          </linearGradient>
                          <linearGradient id="hero-closure-area" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.24" />
                            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <path d={trendLine.areaPath} fill="url(#hero-closure-area)" className="transition-all duration-700 ease-out" />
                        <path
                          d={trendLine.linePath}
                          fill="none"
                          stroke="rgba(16,185,129,0.18)"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="9"
                          vectorEffect="non-scaling-stroke"
                        />
                        <path
                          d={trendLine.linePath}
                          fill="none"
                          stroke="url(#hero-closure-line)"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="3"
                          vectorEffect="non-scaling-stroke"
                          className="drop-shadow-[0_0_10px_rgba(34,197,94,0.45)] transition-all duration-700 ease-out"
                        />
                        {trendLine.coords.map((point, index) => (
                          <circle
                            key={point.id}
                            cx={point.x}
                            cy={point.y}
                            r={index === trendLine.coords.length - 1 ? 3.2 : 2.1}
                            fill={index === trendLine.coords.length - 1 ? "#86efac" : "#22c55e"}
                            opacity={index % 2 === 0 || index === trendLine.coords.length - 1 ? 1 : 0.42}
                            className="transition-all duration-700 ease-out"
                          />
                        ))}
                      </svg>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] tracking-[-0.01em] text-[#7f8ba1]">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-brand-light" />
                        每 2 小时闭环
                      </span>
                      <span>单位：件 / 2h</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2.5 rounded-md border border-white/[0.08] bg-[#111827] px-2.5 py-2 sm:px-3 sm:py-2.5">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.06] bg-[#0f172a]">
                        <span className="text-[10px] font-semibold text-[#94a3b8]">AI</span>
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-medium text-[#d1d5db]">知识检索 · 命中维修手册</div>
                        <div className="truncate text-[10px] text-[#9ca3af]">已关联相似案例与作业步骤</div>
                      </div>
                    </div>
                    <span className="shrink-0 rounded border border-[rgba(74,222,128,0.2)] bg-[rgba(74,222,128,0.08)] px-1.5 py-0.5 text-[8px] font-medium tabular-nums tracking-wide text-[rgba(74,222,128,0.95)]">
                      LIVE
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

