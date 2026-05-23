"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertCircle,
  CheckCircle,
  ClipboardCheck,
  Clock3,
  RefreshCw,
  Server,
  TimerReset,
  TrendingUp,
} from "lucide-react";
import {
  fetchWorkbenchOverview,
  type WorkbenchOverview,
} from "@/features/dashboard/api";
import { fetchCasesList } from "@/features/cases/api";
import {
  fetchMaintenanceHistory,
  type MaintenanceTaskHistoryItem,
} from "@/features/tasks/api";
import { getMaintenanceToken } from "@/features/auth/lib/token-store";
import { listWorkOrders } from "@/features/tickets/api";
import { Header } from "@/shared/components/brand/app-header";
import { StatCard } from "@/features/dashboard/components/stat-card";
import {
  ClosureStageBarChart,
  ClosureTrendChart,
  type ClosureStagePoint,
  StatusDonutCard,
} from "@/features/dashboard/components/charts";
import {
  EmptyState,
  ErrorState,
} from "@/features/dashboard/components/empty-state";
import { DashboardSkeleton } from "@/features/dashboard/components/skeleton";
import { Button } from "@/shared/components/ui/button";
import type { MaintenanceCaseListItem, WorkOrderItem } from "@/shared/lib/http";
type FaultLifecycleStatus = "pending" | "processing" | "resolved";

function normalizeFaultStatus(rawStatus: string): FaultLifecycleStatus {
  const st = String(rawStatus || "").toLowerCase();
  if (["pending", "open"].includes(st)) return "pending";
  if (["in_progress", "processing"].includes(st)) return "processing";
  if (["resolved", "closed", "done", "complete", "completed"].includes(st))
    return "resolved";
  return "pending";
}

function formatTrendLabel(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function formatTrendTimeLabel(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function buildTodayHourlyTrendBuckets(
  records: WorkbenchOverview["recent_tasks"],
  start: Date,
  end: Date,
) {
  const hourCount = 24;
  const buckets = Array.from({ length: hourCount }, (_, index) => {
    const date = new Date(start);
    date.setHours(index, 0, 0, 0);
    return {
      label: formatTrendTimeLabel(date),
      tasks: 0,
      alerts: 0,
      closed: 0,
    };
  });

  const addToBucket = (
    key: "alerts" | "tasks" | "closed",
    dateText: string | null | undefined,
  ) => {
    const date = getSafeDate(dateText);
    if (!date || date < start || date > end) return;
    const bucketIndex = Math.min(
      hourCount - 1,
      Math.max(0, Math.floor((date.getTime() - start.getTime()) / 3_600_000)),
    );
    buckets[bucketIndex][key] += 1;
  };

  for (const item of records) {
    const status = normalizeFaultStatus(String(item.status || ""));
    const createdAt = item.created_at ?? item.updated_at;
    const updatedAt = item.updated_at ?? item.created_at;

    addToBucket("alerts", createdAt);

    if (status !== "pending" || Number(item.completed_steps ?? 0) > 0) {
      addToBucket("tasks", updatedAt);
    }

    if (status === "resolved") {
      addToBucket("closed", updatedAt);
    }
  }

  return buckets;
}

function buildDailyTrendBuckets(
  records: WorkbenchOverview["recent_tasks"],
  start: Date,
  end: Date,
) {
  const dayCount =
    Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const buckets = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      label: formatTrendLabel(date),
      tasks: 0,
      alerts: 0,
      closed: 0,
    };
  });

  const addToBucket = (
    key: "alerts" | "tasks" | "closed",
    dateText: string | null | undefined,
  ) => {
    const date = getSafeDate(dateText);
    if (!date || date < start || date > end) return;
    const bucketIndex = Math.min(
      dayCount - 1,
      Math.max(0, Math.floor((date.getTime() - start.getTime()) / 86_400_000)),
    );
    buckets[bucketIndex][key] += 1;
  };

  for (const item of records) {
    const status = normalizeFaultStatus(String(item.status || ""));
    const createdAt = item.created_at ?? item.updated_at;
    const updatedAt = item.updated_at ?? item.created_at;

    addToBucket("alerts", createdAt);

    if (status !== "pending" || Number(item.completed_steps ?? 0) > 0) {
      addToBucket("tasks", updatedAt);
    }

    if (status === "resolved") {
      addToBucket("closed", updatedAt);
    }
  }

  return buckets;
}

function buildTrendBuckets(
  records: WorkbenchOverview["recent_tasks"],
  range: ClosureRange,
  anchorText: string | null | undefined,
) {
  const { start, end } = getClosureRangeWindow(range, anchorText);
  if (range === "today") {
    return buildTodayHourlyTrendBuckets(records, start, end);
  }
  return buildDailyTrendBuckets(records, start, end);
}

type ClosureTaskStatus =
  | "pending"
  | "diagnosis_completed"
  | "completed"
  | "failed";

type ClosureKpiTone = "amber" | "blue" | "emerald" | "red" | "slate";
type ClosureRange = "today" | "7d" | "30d";

interface ClosureKpiCard {
  title: string;
  value: string;
  helper: string;
  tone: ClosureKpiTone;
  icon: typeof AlertCircle;
}

interface RiskTaskRow {
  id: string;
  deviceName: string;
  maintenanceLevel: string;
  stage: string;
  lastUpdatedAge: string;
  priority: "高" | "中" | "低";
  status: "处理中" | "超过 3 天未更新";
  taskId?: number;
}

const closureOverviewShellClassName =
  "grid gap-5 xl:items-start xl:grid-cols-[minmax(0,1.85fr)_minmax(300px,340px)] 2xl:grid-cols-[minmax(0,1.9fr)_minmax(320px,360px)]";

const closureOverviewSidePanelClassName = "grid content-start gap-4 self-start";

const emptyClosureStageData: ClosureStagePoint[] = [
  {
    label: "告警触发",
    value: 0,
    ratio: 0,
    avgDuration: "--",
    status: "normal",
  },
  {
    label: "问题诊断",
    value: 0,
    ratio: 0,
    avgDuration: "--",
    status: "normal",
  },
  {
    label: "生成工单",
    value: 0,
    ratio: 0,
    avgDuration: "--",
    status: "normal",
  },
  {
    label: "工单处理",
    value: 0,
    ratio: 0,
    avgDuration: "--",
    status: "normal",
  },
  {
    label: "案例沉淀",
    value: 0,
    ratio: 0,
    avgDuration: "--",
    status: "normal",
  },
];

function formatMaintenanceLevel(level: string | null | undefined) {
  const normalized = String(level || "")
    .trim()
    .toLowerCase();
  if (["urgent", "emergency", "critical", "high"].includes(normalized))
    return "紧急";
  if (normalized === "standard") return "标准";
  if (["low", "minor"].includes(normalized)) return "低优先";
  return level || "未分级";
}

function getSafeDate(dateText: string | null | undefined) {
  if (!dateText) return null;
  const date = new Date(dateText);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getClosureRangeWindow(
  range: ClosureRange,
  anchorText: string | null | undefined,
) {
  const anchor = getSafeDate(anchorText) ?? new Date();
  const end = new Date(anchor);
  end.setHours(23, 59, 59, 999);
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  if (range === "7d") start.setDate(start.getDate() - 6);
  if (range === "30d") start.setDate(start.getDate() - 29);
  return { start, end };
}

function isDateInClosureRange(
  dateText: string | null | undefined,
  range: ClosureRange,
  anchorText: string | null | undefined,
) {
  const date = getSafeDate(dateText);
  if (!date) return false;
  const { start, end } = getClosureRangeWindow(range, anchorText);
  return date >= start && date <= end;
}

function filterByClosureRange<T>(
  items: T[],
  getDateText: (item: T) => string | null | undefined,
  range: ClosureRange,
  anchorText: string | null | undefined,
) {
  return items.filter((item) =>
    isDateInClosureRange(getDateText(item), range, anchorText),
  );
}

function getRangeLabel(range: ClosureRange) {
  if (range === "today") return "今日";
  if (range === "30d") return "近 30 日";
  return "近 7 日";
}

function formatRiskTaskId(taskId: number, dateText: string | null | undefined) {
  const sourceDate = dateText ? new Date(dateText) : new Date();
  const safeDate = Number.isNaN(sourceDate.getTime()) ? new Date() : sourceDate;
  const stamp = `${safeDate.getFullYear()}${String(safeDate.getMonth() + 1).padStart(2, "0")}${String(
    safeDate.getDate(),
  ).padStart(2, "0")}`;
  return `MT-${stamp}-${String(taskId).padStart(3, "0")}`;
}

function getRiskPriority(
  level: string | null | undefined,
): RiskTaskRow["priority"] {
  const normalized = String(level || "").toLowerCase();
  if (["urgent", "emergency", "critical", "high"].includes(normalized))
    return "高";
  if (["low", "minor"].includes(normalized)) return "低";
  return "中";
}

function getDurationDaysText(
  startText: string | null | undefined,
  endText?: string | null,
) {
  const start = startText ? new Date(startText) : null;
  const end = endText ? new Date(endText) : new Date();
  if (!start || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    return "--";
  const days = Math.max(0.1, (end.getTime() - start.getTime()) / 86_400_000);
  return `${days.toFixed(1)} 天`;
}

function getDurationDaysValue(
  startText: string | null | undefined,
  endText?: string | null,
) {
  const start = startText ? new Date(startText) : null;
  const end = endText ? new Date(endText) : new Date();
  if (!start || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    return 0;
  return Math.max(0, (end.getTime() - start.getTime()) / 86_400_000);
}

function getRiskStageFromHistory(
  task: MaintenanceTaskHistoryItem,
): string | null {
  const rawStatus = String(task.status || "").toLowerCase();
  const workflowTotal = task.workflow_total > 0 ? task.workflow_total : 5;
  const completed = Math.max(
    0,
    Math.min(task.workflow_completed ?? 0, workflowTotal),
  );

  if (rawStatus === "completed" && completed >= workflowTotal) return null;
  if (completed >= 4) return "生成工单";
  if (completed >= 3) return "步骤输出";
  if (completed >= 2) return "知识检索";
  if (completed >= 1) return "任务创建";
  return "任务创建";
}

function getRiskStatus(
  stage: string,
  durationDays: number,
): RiskTaskRow["status"] {
  if (durationDays >= 3) return "超过 3 天未更新";
  return "处理中";
}

function isHighlightedRiskTask(task: RiskTaskRow) {
  return task.status === "超过 3 天未更新" || task.priority === "高";
}

function sortRiskTasks(tasks: RiskTaskRow[]) {
  const statusWeight = { "超过 3 天未更新": 2, 处理中: 1 } satisfies Record<
    RiskTaskRow["status"],
    number
  >;
  const priorityWeight = { 高: 3, 中: 2, 低: 1 } satisfies Record<
    RiskTaskRow["priority"],
    number
  >;

  return [...tasks].sort((left, right) => {
    return (
      statusWeight[right.status] - statusWeight[left.status] ||
      priorityWeight[right.priority] - priorityWeight[left.priority]
    );
  });
}

function getToneClass(tone: ClosureKpiTone) {
  if (tone === "amber") {
    return "border-amber-200 bg-amber-50/70 text-amber-700 dark:border-amber-500/25 dark:bg-amber-950/25 dark:text-amber-300";
  }
  if (tone === "blue") {
    return "border-blue-200 bg-blue-50/70 text-blue-700 dark:border-blue-500/25 dark:bg-blue-950/25 dark:text-blue-300";
  }
  if (tone === "emerald") {
    return "border-emerald-200 bg-emerald-50/70 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-950/25 dark:text-emerald-300";
  }
  if (tone === "red") {
    return "border-red-200 bg-red-50/70 text-red-700 dark:border-red-500/25 dark:bg-red-950/25 dark:text-red-300";
  }
  return "border-border bg-muted/40 text-muted-foreground";
}

function ClosureKpiCardView({ item }: { item: ClosureKpiCard }) {
  const Icon = item.icon;
  return (
    <div
      data-testid={`closure-kpi-${item.title}`}
      className="group rounded-2xl border border-border/60 bg-card p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all hover:border-border hover:shadow-[0_8px_28px_rgba(15,23,42,0.08)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            {item.title}
          </p>
          <div className="mt-3 text-3xl font-bold tracking-tight text-foreground">
            {item.value}
          </div>
        </div>
        <div className={`rounded-xl border p-2.5 ${getToneClass(item.tone)}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {item.helper}
      </p>
    </div>
  );
}

function mapHistoryToClosureStatus(
  task: MaintenanceTaskHistoryItem,
): ClosureTaskStatus {
  const rawStatus = String(task.status || "").toLowerCase();
  const workflowTotal = task.workflow_total > 0 ? task.workflow_total : 5;
  const workflowCompleted = Math.max(
    0,
    Math.min(task.workflow_completed ?? 0, workflowTotal),
  );

  if (rawStatus === "in_progress" || rawStatus === "pending") return "pending";
  if (rawStatus === "completed") {
    return workflowCompleted >= workflowTotal
      ? "completed"
      : "diagnosis_completed";
  }
  if (rawStatus === "skipped" || rawStatus === "failed") return "failed";
  return "pending";
}

export default function DashboardPage() {
  const router = useRouter();
  const [viewState, setViewState] = useState<
    "normal" | "loading" | "empty" | "error"
  >("normal");
  const [overview, setOverview] = useState<WorkbenchOverview | null>(null);
  const [historyTasks, setHistoryTasks] = useState<
    MaintenanceTaskHistoryItem[]
  >([]);
  const [linkedWorkOrders, setLinkedWorkOrders] = useState<WorkOrderItem[]>([]);
  const [linkedCases, setLinkedCases] = useState<MaintenanceCaseListItem[]>([]);
  const [isMobileClosureLayout, setIsMobileClosureLayout] = useState(false);
  const [closureRange, setClosureRange] = useState<ClosureRange>("7d");

  const loadOverview = useCallback(async () => {
    setViewState("loading");
    try {
      const o = await fetchWorkbenchOverview();
      setOverview(o);
      const maintenanceToken = getMaintenanceToken();
      const [workOrderResult, caseResult] = await Promise.allSettled([
        maintenanceToken
          ? listWorkOrders(maintenanceToken, 1)
          : Promise.resolve(null),
        fetchCasesList({ limit: 50 }),
      ]);
      const historyResult = await Promise.allSettled([
        fetchMaintenanceHistory({ limit: 50 }),
      ]);
      setLinkedWorkOrders(
        workOrderResult.status === "fulfilled"
          ? (workOrderResult.value?.items ?? [])
          : [],
      );
      if (caseResult.status === "fulfilled") {
        const cases = caseResult.value.cases ?? [];
        setLinkedCases(cases);
      } else {
        setLinkedCases([]);
      }
      setHistoryTasks(
        historyResult[0]?.status === "fulfilled"
          ? (historyResult[0].value.tasks ?? [])
          : [],
      );

      const hasNonZeroStats = Array.isArray(o.stats)
        ? o.stats.some((s) => Number(s?.value ?? 0) > 0)
        : false;
      const hasRecentItems =
        (Array.isArray(o.recent_tasks) && o.recent_tasks.length > 0) ||
        (Array.isArray(o.recent_cases) && o.recent_cases.length > 0);
      setViewState(hasNonZeroStats || hasRecentItems ? "normal" : "empty");
    } catch {
      setViewState("error");
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const syncLayoutMode = () => {
      setIsMobileClosureLayout(mediaQuery.matches);
    };

    syncLayoutMode();
    mediaQuery.addEventListener("change", syncLayoutMode);
    return () => {
      mediaQuery.removeEventListener("change", syncLayoutMode);
    };
  }, []);

  const handleRefresh = () => {
    void loadOverview();
  };

  const closureOverview = useMemo(() => {
    const rangeLabel = getRangeLabel(closureRange);
    const generatedAt = overview?.generated_at ?? new Date().toISOString();
    const recentTasks = filterByClosureRange(
      overview?.recent_tasks ?? [],
      (task) => task.updated_at ?? task.created_at,
      closureRange,
      generatedAt,
    );
    const filteredHistoryTasks = filterByClosureRange(
      historyTasks,
      (task) => task.updated_at ?? task.created_at,
      closureRange,
      generatedAt,
    );
    const filteredCases = filterByClosureRange(
      linkedCases,
      (item) => item.updated_at,
      closureRange,
      generatedAt,
    );
    const filteredWorkOrders = filterByClosureRange(
      linkedWorkOrders,
      (item) => item.updated_at ?? item.created_at,
      closureRange,
      generatedAt,
    );
    const filteredUnresolvedFaults = recentTasks.filter(
      (task) => normalizeFaultStatus(String(task.status || "")) !== "resolved",
    );
    const activeTaskCount = Math.max(
      filteredHistoryTasks.filter((task) => {
        const status = String(task.status || "").toLowerCase();
        return status === "pending" || status === "in_progress";
      }).length,
      recentTasks.filter(
        (task) =>
          normalizeFaultStatus(String(task.status || "")) !== "resolved",
      ).length,
    );
    const closureTasks = filteredHistoryTasks.map(mapHistoryToClosureStatus);
    const pendingCount = closureTasks.filter(
      (status) => status === "pending",
    ).length;
    const diagnosisCompletedCount = closureTasks.filter(
      (status) => status === "diagnosis_completed",
    ).length;
    const resolvedCount = closureTasks.filter(
      (status) => status === "completed",
    ).length;
    const total = pendingCount + diagnosisCompletedCount + resolvedCount;

    const trendSeries = buildTrendBuckets(
      overview?.recent_tasks ?? [],
      closureRange,
      generatedAt,
    );
    const pendingReviewCount = filteredCases.filter(
      (item) => item.status === "pending_review",
    ).length;
    const rangeWorkOrderTotal = filteredWorkOrders.length;
    const rangeCaseTotal = filteredCases.length;
    const executionCount = Math.max(0, activeTaskCount - pendingCount);
    const caseBacklog = rangeCaseTotal + pendingReviewCount;
    const stageBase = [
      {
        label: "告警触发",
        value: filteredUnresolvedFaults.length,
        avgDuration: "0.4 天",
        status: "normal" as const,
      },
      {
        label: "问题诊断",
        value: activeTaskCount,
        avgDuration: "0.8 天",
        status: "processing" as const,
      },
      {
        label: "生成工单",
        value: rangeWorkOrderTotal,
        avgDuration: "0.6 天",
        status:
          rangeWorkOrderTotal > 0 ? ("done" as const) : ("normal" as const),
      },
      {
        label: "工单处理",
        value: executionCount,
        avgDuration: "1.2 天",
        status:
          executionCount > 0 ? ("processing" as const) : ("normal" as const),
      },
      {
        label: "案例沉淀",
        value: caseBacklog,
        avgDuration: caseBacklog > 0 ? "2.7 天" : "0 天",
        status: caseBacklog > 0 ? ("blocked" as const) : ("normal" as const),
      },
    ];
    const bottleneckStage = stageBase.reduce(
      (max, item) => (item.value > max.value ? item : max),
      stageBase[0] ?? {
        label: "暂无数据",
        value: 0,
        avgDuration: "--",
        status: "normal" as const,
      },
    );
    const stageTotal = Math.max(
      stageBase.reduce((sum, item) => sum + item.value, 0),
      1,
    );
    const stageBars: ClosureStagePoint[] = stageBase.map((item) => ({
      ...item,
      ratio: (item.value / stageTotal) * 100,
      isBottleneck: item.label === bottleneckStage.label && item.value > 0,
    }));
    const statusSegments = [
      { label: "待处理", value: pendingCount, color: "rgb(245 158 11)" },
      {
        label: "诊断中",
        value: diagnosisCompletedCount,
        color: "rgb(59 130 246)",
      },
      { label: "已完成", value: resolvedCount, color: "rgb(34 197 94)" },
    ];
    const completionRate = total > 0 ? (resolvedCount / total) * 100 : 0;
    const unclosedCount = Math.max(
      activeTaskCount,
      pendingCount + diagnosisCompletedCount,
    );
    const trendSummary = [
      {
        label: "闭环率",
        value: `${Math.round(completionRate)}%`,
        helper: `${resolvedCount} / ${total} 个任务已闭环`,
        tone: "emerald" as const,
      },
      {
        label: "主要堵点",
        value: bottleneckStage.value > 0 ? bottleneckStage.label : "暂无积压",
        helper: `${bottleneckStage.value} 条任务停留在该阶段`,
        tone:
          bottleneckStage.status === "blocked"
            ? ("amber" as const)
            : ("slate" as const),
      },
      {
        label: "已形成工单",
        value: `${rangeWorkOrderTotal}`,
        helper: `${rangeLabel}已进入执行或归档流程`,
        tone: "blue" as const,
      },
    ];
    const kpis: ClosureKpiCard[] = [
      {
        title: "未闭环异常",
        value: `${unclosedCount}`,
        helper:
          unclosedCount > 0
            ? "当前范围内仍需推进的异常任务"
            : "当前范围内暂无待闭环异常",
        tone: "amber",
        icon: AlertCircle,
      },
      {
        title: "超时任务",
        value: "0",
        helper: "超过 3 天未更新的重点任务",
        tone: "red",
        icon: Clock3,
      },
      {
        title: "高优先级任务",
        value: "0",
        helper: "需优先推进的紧急检修任务",
        tone: "blue",
        icon: TrendingUp,
      },
      {
        title: "主要堵点",
        value: bottleneckStage.value > 0 ? bottleneckStage.label : "暂无积压",
        helper: `${bottleneckStage.value} 条任务停留在该阶段`,
        tone: bottleneckStage.status === "blocked" ? "red" : "amber",
        icon: TimerReset,
      },
      {
        title: "闭环率",
        value: `${Math.round(completionRate)}%`,
        helper: `${resolvedCount} / ${total} 个任务已完成闭环`,
        tone: "emerald",
        icon: ClipboardCheck,
      },
    ];
    const recentTaskMap = new Map(
      recentTasks.map((task) => [Number(task.id), task]),
    );
    const riskTasksFromHistory: RiskTaskRow[] = filteredHistoryTasks.flatMap(
      (task) => {
        const summary = recentTaskMap.get(Number(task.id));
        const stage = getRiskStageFromHistory(task);
        if (!stage) return [];
        const durationSource =
          task.updated_at ??
          task.created_at ??
          summary?.updated_at ??
          summary?.created_at;
        const durationDays = getDurationDaysValue(durationSource, generatedAt);
        return [
          {
            id: formatRiskTaskId(task.id, task.created_at ?? task.updated_at),
            deviceName:
              task.title ||
              summary?.title ||
              [
                task.equipment_type || summary?.equipment_type,
                task.equipment_model || summary?.equipment_model,
              ]
                .filter(Boolean)
                .join(" ") ||
              `检修任务 ${task.id}`,
            maintenanceLevel: formatMaintenanceLevel(
              task.maintenance_level || summary?.maintenance_level,
            ),
            stage,
            lastUpdatedAge: getDurationDaysText(durationSource, generatedAt),
            priority: getRiskPriority(
              task.maintenance_level || summary?.maintenance_level,
            ),
            status: getRiskStatus(stage, durationDays),
            taskId: task.id,
          } satisfies RiskTaskRow,
        ];
      },
    );
    const recentRiskTasks: RiskTaskRow[] = recentTasks.flatMap((task) => {
      const status = normalizeFaultStatus(String(task.status || ""));
      if (status === "resolved") return [];
      const stage = status === "processing" ? "生成工单" : "问题诊断";
      const durationSource = task.updated_at ?? task.created_at;
      const durationDays = getDurationDaysValue(durationSource, generatedAt);
      return [
        {
          id: formatRiskTaskId(
            Number(task.id),
            task.created_at ?? task.updated_at,
          ),
          deviceName:
            task.title || task.equipment_type || `检修任务 ${task.id}`,
          maintenanceLevel: formatMaintenanceLevel(task.maintenance_level),
          stage,
          lastUpdatedAge: getDurationDaysText(durationSource, generatedAt),
          priority: getRiskPriority(task.maintenance_level),
          status: getRiskStatus(stage, durationDays),
          taskId: Number(task.id),
        } satisfies RiskTaskRow,
      ];
    });
    const historyTaskIds = new Set(
      riskTasksFromHistory
        .map((task) => task.taskId)
        .filter((taskId): taskId is number => Number.isFinite(taskId)),
    );
    const mergedHighlightedRiskTasks = sortRiskTasks([
      ...riskTasksFromHistory.filter(isHighlightedRiskTask),
      ...recentRiskTasks
        .filter((task) => !historyTaskIds.has(task.taskId ?? -1))
        .filter(isHighlightedRiskTask),
    ]);
    const fallbackRiskTasks = sortRiskTasks(
      recentRiskTasks.filter((task) => !historyTaskIds.has(task.taskId ?? -1)),
    );
    const riskTaskSource =
      mergedHighlightedRiskTasks.length > 0
        ? mergedHighlightedRiskTasks
        : fallbackRiskTasks;
    const overdueTaskCount = riskTaskSource.filter(
      (task) => task.status === "超过 3 天未更新",
    ).length;
    const highPriorityTaskCount = riskTaskSource.filter(
      (task) => task.priority === "高",
    ).length;
    const riskTasks = riskTaskSource.slice(0, 6);

    kpis[1] = {
      title: "超时任务",
      value: `${overdueTaskCount}`,
      helper:
        overdueTaskCount > 0
          ? "超过 3 天未更新的重点任务"
          : "当前暂无超时风险任务",
      tone: overdueTaskCount > 0 ? "red" : "slate",
      icon: Clock3,
    };
    kpis[2] = {
      title: "高优先级任务",
      value: `${highPriorityTaskCount}`,
      helper:
        highPriorityTaskCount > 0
          ? "需优先推进的紧急检修任务"
          : "当前暂无高优先级风险任务",
      tone: highPriorityTaskCount > 0 ? "blue" : "slate",
      icon: TrendingUp,
    };
    const insight = `${rangeLabel}闭环率为 ${Math.round(completionRate)}%，${
      unclosedCount > 0 ? `当前仍有 ${unclosedCount} 条未闭环异常，` : ""
    }主要堵点在${bottleneckStage.value > 0 ? bottleneckStage.label : "末端归档"}阶段。`;

    return {
      trendSeries,
      trendSummary,
      completionRate,
      statusSegments,
      stageBars,
      kpis,
      insight,
      riskTasks,
      hasData:
        recentTasks.length > 0 ||
        filteredHistoryTasks.length > 0 ||
        filteredUnresolvedFaults.length > 0 ||
        activeTaskCount > 0 ||
        rangeWorkOrderTotal > 0 ||
        rangeCaseTotal > 0,
    };
  }, [closureRange, historyTasks, linkedCases, linkedWorkOrders, overview]);

  const renderClosureOverview = (mode: "normal" | "empty" | "loading") => {
    if (mode === "loading") {
      return (
        <section
          data-testid="closure-overview-shell"
          data-mobile-stack={isMobileClosureLayout ? "true" : "false"}
          className={closureOverviewShellClassName}
        >
          <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm sm:p-6">
            <div className="h-5 w-32 rounded bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
            <div className="mt-3 h-4 w-64 rounded bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={`summary-skeleton-${index}`}
                  className="rounded-xl border border-border/60 bg-background/70 px-4 py-3.5"
                >
                  <div className="h-3 w-16 rounded bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
                  <div className="mt-3 h-7 w-20 rounded bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-xl border border-border/50 bg-muted/30 px-4 py-4 sm:px-5 sm:py-5">
              <div className="h-9 w-full max-w-[520px] rounded-xl bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
              <div className="mt-3 h-[220px] rounded-xl bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)] sm:h-[240px] xl:h-[260px]" />
            </div>
          </div>
          <div
            data-testid="closure-overview-side-panel"
            className={closureOverviewSidePanelClassName}
          >
            <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-2">
                  <div className="h-5 w-24 rounded bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
                  <div className="h-4 w-40 rounded bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
                </div>
                <div className="h-7 w-14 rounded-full bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
              </div>
              <div className="mt-5 mx-auto h-32 w-32 rounded-full bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
              <div className="mt-5 grid gap-2.5">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={`status-skeleton-${index}`}
                    className="rounded-xl border border-border/50 bg-background/70 px-3.5 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="h-4 w-20 rounded bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
                      <div className="h-4 w-6 rounded bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
                    </div>
                    <div className="mt-2 h-3 w-full rounded bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
                  </div>
                ))}
              </div>
              <div className="mt-4 h-10 rounded-xl bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
            </div>
          </div>
        </section>
      );
    }

    if (mode === "empty") {
      return (
        <section
          data-testid="closure-overview-shell"
          data-mobile-stack={isMobileClosureLayout ? "true" : "false"}
          className={closureOverviewShellClassName}
        >
          <ClosureTrendChart
            title="异常处理趋势"
            subtitle="对比异常触发、诊断处理和闭环完成情况，判断处理能力是否跟上异常增长。"
            data={[]}
            summaryItems={[
              { label: "闭环率", value: "0%", helper: "0 / 0 个任务已闭环" },
              { label: "主要堵点", value: "暂无数据", helper: "暂无阶段积压" },
              { label: "已形成工单", value: "0", helper: "暂无执行工单" },
            ]}
            insight="当前暂无异常处理趋势数据，待接入异常、诊断和闭环任务后生成分析。"
          />
          <div
            data-testid="closure-overview-side-panel"
            className={closureOverviewSidePanelClassName}
          >
            <StatusDonutCard
              title="闭环推进状态"
              completionRate={0}
              segments={[
                { label: "待处理", value: 0, color: "rgb(245 158 11)" },
                { label: "诊断中", value: 0, color: "rgb(59 130 246)" },
                { label: "已完成", value: 0, color: "rgb(34 197 94)" },
              ]}
            />
          </div>
        </section>
      );
    }

    return (
      <section
        data-testid="closure-overview-shell"
        data-mobile-stack={isMobileClosureLayout ? "true" : "false"}
        className={closureOverviewShellClassName}
      >
        <ClosureTrendChart
          title="异常处理趋势"
          subtitle="对比异常触发、诊断处理和闭环完成情况，判断处理能力是否跟上异常增长。"
          data={closureOverview.trendSeries}
          summaryItems={closureOverview.trendSummary}
          insight={closureOverview.insight}
        />
        <div
          data-testid="closure-overview-side-panel"
          className={closureOverviewSidePanelClassName}
        >
          <StatusDonutCard
            title="闭环推进状态"
            completionRate={closureOverview.completionRate}
            segments={closureOverview.statusSegments}
          />
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="app-main">
        {/* Page Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">检修总览</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              统一查看设备状态、诊断任务、工单处理与知识沉淀
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="app-btn-secondary h-8 gap-1.5 px-3"
              onClick={handleRefresh}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              刷新
            </button>
          </div>
        </div>

        {/* Error State */}
        {viewState === "error" && (
          <ErrorState
            title="数据加载失败"
            description="无法连接到诊断服务器，请检查网络连接"
            onRetry={() => void loadOverview()}
          />
        )}

        {/* Loading State */}
        {viewState === "loading" && (
          <div className="space-y-6">
            <DashboardSkeleton />

            <section className="space-y-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-bold text-foreground">
                  检修闭环总览
                </h2>
              </div>
              {renderClosureOverview("loading")}
              <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm sm:p-6">
                <div className="h-5 w-32 rounded bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
                <div className="mt-3 h-4 w-72 rounded bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
                <div className="mt-5 grid gap-3 md:grid-cols-5">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div
                      key={`closure-stage-skeleton-${index}`}
                      className="min-h-[164px] rounded-xl border border-border/60 bg-background/70 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="h-4 w-16 rounded bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
                        <div className="h-5 w-10 rounded-full bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
                      </div>
                      <div className="mt-6 h-8 w-12 rounded bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
                      <div className="mt-3 h-3 w-20 rounded bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
                      <div className="mt-6 h-px bg-slate-100/70 dark:bg-[rgba(255,255,255,0.05)]" />
                      <div className="mt-3 h-3 w-24 rounded bg-slate-100 skeleton-pulse dark:bg-[rgba(255,255,255,0.05)]" />
                    </div>
                  ))}
                </div>
              </section>
            </section>
          </div>
        )}

        {/* Empty State */}
        {viewState === "empty" && (
          <div className="space-y-6">
            {/* Stats - Even empty state shows stats */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                title="设备总数"
                value={0}
                unit="台"
                icon={<Server className="h-4 w-4" />}
              />
              <StatCard
                title="在线设备"
                value={0}
                unit="台"
                icon={<Activity className="h-4 w-4" />}
                status="success"
              />
              <StatCard
                title="故障告警"
                value={0}
                unit="条"
                icon={<AlertCircle className="h-4 w-4" />}
                status="warning"
              />
              <StatCard
                title="今日已处理"
                value={0}
                unit="条"
                icon={<CheckCircle className="h-4 w-4" />}
                status="success"
              />
            </div>

            <section className="space-y-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-bold text-foreground">
                  检修闭环总览
                </h2>
              </div>
              {renderClosureOverview("empty")}
              <ClosureStageBarChart
                title="闭环阶段分布"
                subtitle="按照检修闭环流程查看任务分布，快速识别当前积压环节。"
                data={emptyClosureStageData}
              />
            </section>

            <EmptyState
              type="no-devices"
              title="暂无监控设备"
              description="当前暂无监控设备与诊断数据，请检查数据接入与后端服务状态。"
            />
          </div>
        )}

        {/* Normal State */}
        {viewState === "normal" && (
          <div className="space-y-6">
            <section className="space-y-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-foreground">
                    检修闭环总览
                  </h2>
                </div>
                <div className="inline-flex w-fit rounded-xl border border-border bg-card p-1">
                  {[
                    { key: "today", label: "今日" },
                    { key: "7d", label: "近 7 日" },
                    { key: "30d", label: "近 30 日" },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setClosureRange(item.key as ClosureRange)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        closureRange === item.key
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div id="fault-alerts" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                {closureOverview.kpis.map((item) => (
                  <ClosureKpiCardView key={item.title} item={item} />
                ))}
              </div>
            </section>

            <section
              id="risk-tasks"
              data-testid="closure-risk-tasks-panel"
              className="rounded-2xl border border-border/60 bg-card shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
            >
              <div className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    重点待办与风险任务
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    优先关注超过 3 天未更新和高优先级检修任务。
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => router.push("/tasks")}
                >
                  查看全部任务
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 text-left font-medium">
                        任务编号
                      </th>
                      <th className="px-5 py-3 text-left font-medium">
                        设备名称
                      </th>
                      <th className="px-5 py-3 text-left font-medium">
                        检修等级
                      </th>
                      <th className="px-5 py-3 text-left font-medium">
                        当前阶段
                      </th>
                      <th className="px-5 py-3 text-left font-medium">
                        距最近更新
                      </th>
                      <th className="px-5 py-3 text-left font-medium">
                        优先级
                      </th>
                      <th className="px-5 py-3 text-left font-medium">状态</th>
                      <th className="px-5 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {closureOverview.riskTasks.map((task) => (
                      <tr
                        key={task.id}
                        className="transition-colors hover:bg-muted/30"
                      >
                        <td className="px-5 py-4 font-mono text-xs text-foreground">
                          {task.id}
                        </td>
                        <td className="px-5 py-4 font-medium text-foreground">
                          {task.deviceName}
                        </td>
                        <td className="px-5 py-4 text-muted-foreground">
                          {task.maintenanceLevel}
                        </td>
                        <td className="px-5 py-4 text-muted-foreground">
                          {task.stage}
                        </td>
                        <td className="px-5 py-4 tabular-nums text-muted-foreground">
                          {task.lastUpdatedAge}
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                              task.priority === "高"
                                ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/25 dark:bg-red-950/25 dark:text-red-300"
                                : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/25 dark:bg-blue-950/25 dark:text-blue-300"
                            }`}
                          >
                            {task.priority}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                              task.status === "超过 3 天未更新"
                                ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/25 dark:bg-red-950/25 dark:text-red-300"
                                : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/25 dark:bg-blue-950/25 dark:text-blue-300"
                            }`}
                          >
                            {task.status}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (task.taskId)
                                router.push(`/tasks/${task.taskId}`);
                            }}
                          >
                            查看详情
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {closureOverview.riskTasks.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-5 py-10 text-center text-sm text-muted-foreground"
                        >
                          暂无重点待办与风险任务
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            {renderClosureOverview("normal")}

            <ClosureStageBarChart
              title="闭环阶段分布"
              subtitle="按照检修闭环流程查看任务分布，快速识别当前积压环节。"
              data={closureOverview.stageBars}
            />
          </div>
        )}
      </main>
    </div>
  );
}
