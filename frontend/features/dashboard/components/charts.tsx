"use client";

import { useEffect, useId, useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
} from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltipContent,
  type ChartConfig,
} from "@/shared/components/ui/chart";

export interface SeriesPoint {
  label: string;
  value: number;
}

export interface DualSeriesPoint {
  label: string;
  tasks: number;
  alerts: number;
  closed: number;
}

export interface ClosureTrendMetric {
  label: string;
  value: string;
  helper?: string;
  tone?: "amber" | "blue" | "emerald" | "red" | "slate";
}

export interface ClosureStagePoint extends SeriesPoint {
  ratio: number;
  avgDuration: string;
  status: "normal" | "processing" | "blocked" | "done";
  isBottleneck?: boolean;
}

interface TrendAxisTickProps {
  x?: number;
  y?: number;
  index?: number;
  payload?: {
    value?: string;
  };
}

interface StatusSegment {
  label: string;
  value: number;
  color: string;
}

interface MiniChartProps {
  data: number[];
  color?: string;
  height?: number;
}

function clampNumber(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

const trendChartConfig = {
  alerts: {
    label: "告警触发数",
    color: "rgb(245 158 11)",
  },
  tasks: {
    label: "诊断任务数",
    color: "rgb(59 130 246)",
  },
  closed: {
    label: "已闭环数",
    color: "rgb(34 197 94)",
  },
} satisfies ChartConfig;

const donutChartConfig = {
  pending: { label: "待处理", color: "rgb(245 158 11)" },
  diagnosisCompleted: { label: "诊断中", color: "rgb(59 130 246)" },
  completed: { label: "已完成", color: "rgb(34 197 94)" },
} satisfies ChartConfig;

export function MiniChart({
  data,
  color = "#5e6ad2",
  height = 40,
}: MiniChartProps) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  const areaPoints = `0,100 ${points} 100,100`;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
    >
      <defs>
        <linearGradient id={`gradient-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#gradient-${color})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

interface TrendChartCardProps {
  title: string;
  value: string | number;
  unit?: string;
  change?: number;
  data: number[];
  color?: string;
  loading?: boolean;
}

export function TrendChartCard({
  title,
  value,
  unit,
  change,
  data,
  color = "#5e6ad2",
  loading = false,
}: TrendChartCardProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-4">
        <div className="h-4 w-24 rounded bg-[rgba(255,255,255,0.05)] skeleton-pulse" />
        <div className="mt-3 flex items-end justify-between">
          <div className="space-y-2">
            <div className="h-7 w-20 rounded bg-[rgba(255,255,255,0.05)] skeleton-pulse" />
            <div className="h-3 w-14 rounded bg-[rgba(255,255,255,0.05)] skeleton-pulse" />
          </div>
          <div className="h-10 w-24 rounded bg-[rgba(255,255,255,0.05)] skeleton-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-4 transition-colors hover:border-[rgba(255,255,255,0.12)] hover:bg-[rgba(255,255,255,0.03)]">
      <span className="text-sm text-[#8a8f98]">{title}</span>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-semibold text-[#f7f8f8]">
              {value}
            </span>
            {unit && <span className="text-sm text-[#8a8f98]">{unit}</span>}
          </div>
          {change !== undefined && (
            <div className="mt-1 flex items-center gap-1">
              {change >= 0 ? (
                <TrendingUp className="h-3 w-3 text-[#22c55e]" />
              ) : (
                <TrendingDown className="h-3 w-3 text-[#ef4444]" />
              )}
              <span
                className={`text-xs ${change >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"}`}
              >
                {Math.abs(change)}%
              </span>
              <span className="text-xs text-[#8a8f98]">vs 上周</span>
            </div>
          )}
        </div>
        <div className="w-24">
          <MiniChart data={data} color={color} height={40} />
        </div>
      </div>
    </div>
  );
}

interface ProgressBarProps {
  value: number;
  max?: number;
  color?: string;
  showLabel?: boolean;
  size?: "sm" | "md";
}

export function ProgressBar({
  value,
  max = 100,
  color = "#5e6ad2",
  showLabel = false,
  size = "sm",
}: ProgressBarProps) {
  const percentage = Math.min((value / max) * 100, 100);

  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.05)] ${
          size === "sm" ? "h-1.5" : "h-2"
        }`}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-[#8a8f98]">
          {Math.round(percentage)}%
        </span>
      )}
    </div>
  );
}

interface DonutChartProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
}

export function DonutChart({
  value,
  max = 100,
  size = 80,
  strokeWidth = 8,
  color = "#5e6ad2",
  label,
}: DonutChartProps) {
  const percentage = Math.min((value / max) * 100, 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-semibold text-[#f7f8f8]">
          {Math.round(percentage)}%
        </span>
        {label && <span className="text-[10px] text-[#8a8f98]">{label}</span>}
      </div>
    </div>
  );
}

interface ClosureTrendChartProps {
  title: string;
  subtitle: string;
  data: DualSeriesPoint[];
  summaryItems: ClosureTrendMetric[];
  insight: string;
}

export function ClosureTrendChart({
  title,
  subtitle,
  data,
  summaryItems,
  insight,
}: ClosureTrendChartProps) {
  const gradientId = useId().replace(/:/g, "");
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const series =
    data.length > 0 ? data : [{ label: "--", tasks: 0, alerts: 0, closed: 0 }];

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 639px)");
    const syncViewport = () => {
      setIsCompactViewport(mediaQuery.matches);
    };

    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);
    return () => {
      mediaQuery.removeEventListener("change", syncViewport);
    };
  }, []);

  const renderAxisTick = ({
    x = 0,
    y = 0,
    index = 0,
    payload,
  }: TrendAxisTickProps) => {
    const label = payload?.value ?? "";
    const shouldShow =
      !isCompactViewport || index % 2 === 0 || index === series.length - 1;

    return (
      <text
        x={x}
        y={y}
        dy={14}
        textAnchor="middle"
        data-label-visible={shouldShow ? "true" : "false"}
        className="fill-muted-foreground text-[11px] sm:text-xs"
      >
        {shouldShow ? label : ""}
      </text>
    );
  };

  return (
    <section
      data-testid="closure-trend-panel"
      className="rounded-2xl border border-border/60 bg-card p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all hover:border-border hover:shadow-[0_8px_28px_rgba(15,23,42,0.08)] sm:p-6"
    >
      <div data-testid="closure-trend-header" className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground/80">{subtitle}</p>
      </div>

      <div
        data-testid="closure-trend-summary"
        className="mt-5 grid gap-3 sm:grid-cols-3"
      >
        {summaryItems.map((item, index) => (
          <div
            key={item.label}
            data-testid={`closure-trend-summary-item-${item.label}`}
            className={`rounded-xl border bg-gradient-to-br px-4 py-3.5 shadow-sm transition-all hover:shadow-md ${
              index === 0
                ? "border-blue-200/60 from-blue-50/80 to-blue-100/40 dark:border-blue-500/20 dark:from-blue-950/30 dark:to-blue-900/20"
                : index === 1
                  ? "border-amber-200/60 from-amber-50/80 to-amber-100/40 dark:border-amber-500/20 dark:from-amber-950/30 dark:to-amber-900/20"
                  : "border-emerald-200/60 from-emerald-50/80 to-emerald-100/40 dark:border-emerald-500/20 dark:from-emerald-950/30 dark:to-emerald-900/20"
            }`}
          >
            <div className="text-xs font-medium text-muted-foreground/70">
              {item.label}
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              {item.value}
            </div>
            {item.helper ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {item.helper}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-xl border border-border/50 bg-muted/20 px-4 py-4 sm:px-5 sm:py-5">
        <div className="border-b border-border/60 pb-3">
          <div className="rounded-lg border border-emerald-200/70 bg-emerald-50/70 px-3 py-2 text-xs leading-relaxed text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-950/25 dark:text-emerald-200">
            {insight}
          </div>
        </div>
        <div
          data-testid="closure-trend-plot"
          className="mt-3 h-[220px] sm:h-[240px] xl:h-[260px]"
        >
          <div
            data-testid="closure-trend-axis"
            data-compact={isCompactViewport ? "true" : "false"}
            className="h-full w-full"
          >
            <ChartContainer
              data-testid="closure-trend-chart"
              config={trendChartConfig}
              className="h-full w-full"
            >
              <ComposedChart
                data={series}
                margin={{ top: 12, right: 8, left: 8, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id={`${gradientId}-tasks`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--color-tasks)"
                      stopOpacity={0.25}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--color-tasks)"
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 3"
                  opacity={0.3}
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={renderAxisTick}
                  tickMargin={8}
                  height={30}
                  interval={0}
                />
                <Tooltip content={<ChartTooltipContent />} />
                <Bar
                  dataKey="alerts"
                  fill="var(--color-alerts)"
                  radius={[6, 6, 0, 0]}
                  barSize={24}
                  opacity={0.82}
                />
                <Line
                  type="monotone"
                  dataKey="tasks"
                  stroke="var(--color-tasks)"
                  strokeWidth={3}
                  dot={{ r: 3, strokeWidth: 2, fill: "var(--color-tasks)" }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="closed"
                  stroke="var(--color-closed)"
                  strokeWidth={3}
                  dot={{ r: 3, strokeWidth: 2, fill: "var(--color-closed)" }}
                  activeDot={{ r: 5 }}
                />
                <ChartLegend
                  verticalAlign="top"
                  align="right"
                  content={<ChartLegendContent />}
                />
              </ComposedChart>
            </ChartContainer>
          </div>
        </div>
      </div>
    </section>
  );
}

interface StatusDonutCardProps {
  title: string;
  completionRate: number;
  segments: StatusSegment[];
}

export function StatusDonutCard({
  title,
  completionRate,
  segments,
}: StatusDonutCardProps) {
  const safeRate = Math.max(0, Math.min(100, clampNumber(completionRate)));
  const total = segments.reduce(
    (sum, segment) => sum + Math.max(0, clampNumber(segment.value)),
    0,
  );
  const chartData = segments.map((segment) => ({
    key:
      segment.label === "待处理"
        ? "pending"
        : segment.label === "诊断完成" || segment.label === "诊断中"
          ? "diagnosisCompleted"
          : "completed",
    label: segment.label,
    value: Math.max(0, clampNumber(segment.value)),
    fill: segment.color,
  }));

  return (
    <section
      data-testid="status-donut-panel"
      className="rounded-2xl border border-border/60 bg-card p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground/80">
            按当前任务状态查看闭环推进结构
          </p>
        </div>
        <div className="rounded-full border border-border/60 bg-gradient-to-br from-blue-50/80 to-blue-100/40 dark:from-blue-950/30 dark:to-blue-900/20 px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
          完成率
        </div>
      </div>

      <div
        data-testid="status-donut-body"
        data-mobile-layout="stacked"
        className="mt-5 grid gap-4"
      >
        <div className="mx-auto">
          <div className="relative inline-flex h-32 w-32 shrink-0 items-center justify-center sm:h-36 sm:w-36">
            <svg
              data-testid="status-donut-track"
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 128 128"
              aria-hidden="true"
            >
              <circle
                cx="64"
                cy="64"
                r="43"
                fill="none"
                stroke="currentColor"
                strokeWidth="12"
                className="text-slate-200/90 dark:text-slate-700/70"
              />
            </svg>
            <ChartContainer
              data-testid="status-donut-chart"
              config={donutChartConfig}
              className="relative z-10 size-32 sm:size-36"
            >
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={38}
                  outerRadius={50}
                  strokeWidth={0}
                >
                  {chartData.map((item) => (
                    <Cell key={item.key} fill={item.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div
              data-testid="status-donut-center"
              className="absolute inset-0 flex flex-col items-center justify-center"
            >
              <span className="text-3xl font-bold text-foreground">
                {Math.round(safeRate)}%
              </span>
              <span className="text-xs font-medium text-muted-foreground/70">
                已闭环
              </span>
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-2.5">
          {segments.map((segment) => (
            <div
              key={segment.label}
              className="rounded-xl border border-border/50 bg-background/80 px-3.5 py-3 backdrop-blur-sm transition-all hover:border-border hover:shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full shadow-sm"
                    style={{ backgroundColor: segment.color }}
                  />
                  <span className="truncate text-sm font-medium text-foreground">
                    {segment.label}
                  </span>
                </div>
                <span className="text-base font-bold text-foreground">
                  {segment.value}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between pl-5.5 text-[11px] text-muted-foreground/70">
                <span>占比</span>
                <span>
                  {total > 0
                    ? `${Math.round((segment.value / total) * 100)}%`
                    : "0%"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-[11px] leading-5 text-amber-900 dark:border-amber-500/20 dark:bg-amber-950/25 dark:text-amber-200">
        当前仍有部分任务未完成案例沉淀，建议优先处理停留时间较长的任务。
      </div>
    </section>
  );
}

interface ClosureStageBarChartProps {
  title: string;
  subtitle?: string;
  data: ClosureStagePoint[];
}

export function ClosureStageBarChart({
  title,
  subtitle = "按照检修闭环流程查看任务分布，快速识别当前积压环节。",
  data,
}: ClosureStageBarChartProps) {
  const series =
    data.length > 0
      ? data
      : [
          {
            label: "暂无数据",
            value: 0,
            ratio: 0,
            avgDuration: "--",
            status: "normal" as const,
          },
        ];

  const getStageTone = (item: ClosureStagePoint) => {
    if (item.isBottleneck || item.status === "blocked") {
      return "border-amber-300 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/25 dark:text-amber-100";
    }
    if (item.status === "processing") {
      return "border-blue-200 bg-blue-50/70 text-blue-950 dark:border-blue-500/25 dark:bg-blue-950/25 dark:text-blue-100";
    }
    if (item.status === "done") {
      return "border-emerald-200 bg-emerald-50/70 text-emerald-950 dark:border-emerald-500/25 dark:bg-emerald-950/25 dark:text-emerald-100";
    }
    return "border-border/60 bg-background/70 text-foreground";
  };

  const getBadgeLabel = (item: ClosureStagePoint) => {
    if (item.isBottleneck || item.status === "blocked") return "积压";
    if (item.status === "processing") return "处理中";
    if (item.status === "done") return "已闭环";
    return "正常";
  };

  return (
    <section
      data-testid="closure-stage-panel"
      className="rounded-2xl border border-border/60 bg-card p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all hover:border-border hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] sm:p-6"
    >
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground/80">{subtitle}</p>
      </div>

      <div
        data-testid="closure-stage-chart"
        className="mt-5 grid gap-3 md:grid-cols-5"
      >
        <div data-testid="closure-stage-values" className="contents">
          {series.map((item, index) => (
            <div key={item.label} className="relative">
              {index < series.length - 1 ? (
                <div className="absolute left-[calc(100%-0.2rem)] top-10 hidden h-px w-4 bg-border md:block" />
              ) : null}
              <div
                data-testid={`closure-stage-value-${item.label}`}
                className={`min-h-[164px] rounded-xl border p-4 transition-all ${getStageTone(item)}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold">{item.label}</div>
                  <span className="rounded-full border border-current/20 bg-background/40 px-2 py-0.5 text-[11px] font-medium">
                    {getBadgeLabel(item)}
                  </span>
                </div>
                <div className="mt-5 text-3xl font-bold tabular-nums">
                  {item.value}
                </div>
                <div className="mt-1 text-xs opacity-75">
                  占比 {Math.round(item.ratio)}%
                </div>
                <div className="mt-4 border-t border-current/10 pt-3 text-xs opacity-80">
                  平均停留 {item.avgDuration}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
