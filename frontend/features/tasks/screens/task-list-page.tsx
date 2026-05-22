"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  fetchMaintenanceHistory,
  createMaintenanceTask,
  deleteMaintenanceTask,
  fetchHealth,
  normalizeMaintenanceLevelOption,
  postAgentAssist,
  type MaintenanceLevelOption,
  type MaintenanceTaskHistoryItem,
} from "@/features/tasks/api";
import { uploadMaintenanceAttachment } from "@/features/tickets/api";
import { getMaintenanceToken } from "@/features/auth/lib/token-store";
import {
  Search,
  Filter,
  Plus,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  MoreHorizontal,
  ExternalLink,
  Trash2,
  Calendar,
  Cpu,
  FileText,
  ImagePlus,
  FileUp,
  X,
} from "lucide-react";
import {
  DiagnosisTaskWorkbench,
  type DiagnosisMode,
} from "@/features/tasks/components/diagnosis-task-workbench";
import { Header } from "@/shared/components/brand/app-header";
import { formatDateTimeLocal, formatDurationBetween } from "@/shared/lib/utils";
import { generateMockAssetCode } from "@/features/tasks/lib/mock-asset-code";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Label } from "@/shared/components/ui/label";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

// 状态类型
type TaskStatus = "running" | "diagnosis_completed" | "completed" | "failed" | "pending";
type PageState = "normal" | "loading" | "empty" | "error";

type DiagnosePhase = "idle" | "running" | "result";

// 任务数据类型
interface Task {
  id: string;
  timeRange: string;
  symptom: string;
  progress: string;
  status: TaskStatus;
  duration: string;
  createdAt: string;
  maintenanceLevel: MaintenanceLevelOption;
}

const TASK_STATUS_META: Record<
  TaskStatus,
  {
    label: string;
    badgeClassName: string;
    cardColorClassName: string;
    icon: React.ElementType;
    animateIcon?: boolean;
  }
> = {
  running: {
    label: "进行中",
    badgeClassName: "bg-blue-500/10 border-blue-500/30 text-blue-400",
    cardColorClassName: "bg-blue-500/20 text-blue-400",
    icon: Loader2,
    animateIcon: true,
  },
  diagnosis_completed: {
    label: "诊断完成",
    badgeClassName: "bg-cyan-500/10 border-cyan-500/30 text-cyan-500 dark:text-cyan-300",
    cardColorClassName: "bg-cyan-500/20 text-cyan-500 dark:text-cyan-300",
    icon: CheckCircle2,
  },
  completed: {
    label: "已完成",
    badgeClassName: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
    cardColorClassName: "bg-emerald-500/20 text-emerald-400",
    icon: CheckCircle2,
  },
  failed: {
    label: "失败",
    badgeClassName: "bg-red-500/10 border-red-500/30 text-red-400",
    cardColorClassName: "bg-red-500/20 text-red-400",
    icon: XCircle,
  },
  pending: {
    label: "待处理",
    badgeClassName: "bg-amber-500/10 border-amber-500/30 text-amber-400",
    cardColorClassName: "bg-amber-500/20 text-amber-400",
    icon: Clock,
  },
};

// 根据任务历史记录推导适合列表展示的耗时文本。
function deriveTaskDuration(h: MaintenanceTaskHistoryItem) {
  if (h.run_started_at && h.run_finished_at) {
    return formatDurationBetween(h.run_started_at, h.run_finished_at) || "--";
  }
  if (h.run_started_at && String(h.status || "").toLowerCase() === "in_progress") {
    return formatDurationBetween(h.run_started_at, new Date().toISOString()) || "进行中";
  }
  return formatDurationBetween(h.created_at, h.updated_at) || "--";
}

// 将后端任务历史记录映射为前端列表展示模型。
function mapHistoryToTask(h: MaintenanceTaskHistoryItem): Task {
  const st = (h.status || "").toLowerCase();
  const workflowTotal = h.workflow_total > 0 ? h.workflow_total : 5;
  const workflowCompleted = Math.max(0, Math.min(h.workflow_completed ?? 0, workflowTotal));
  let status: TaskStatus = "pending";
  if (st === "in_progress") status = "running";
  else if (st === "completed") status = workflowCompleted >= workflowTotal ? "completed" : "diagnosis_completed";
  else if (st === "skipped" || st === "failed") status = "failed";
  const maintenanceLevel: MaintenanceLevelOption = normalizeMaintenanceLevelOption(h.maintenance_level);
  const c = formatDateTimeLocal(h.created_at);
  const u = formatDateTimeLocal(h.updated_at);
  const timeRange = u !== c && u !== "--" ? `${c} → ${u}` : c;
  const progress = `${workflowCompleted}/${workflowTotal}`;
  return {
    id: String(h.id),
    timeRange,
    symptom: h.title || h.equipment_type,
    progress,
    status,
    duration: deriveTaskDuration(h),
    createdAt: c,
    maintenanceLevel,
  };
}

// 渲染检修等级标签。
function MaintenanceLevelTag({ level }: { level: MaintenanceLevelOption }) {
  const meta = {
    emergency: {
      label: "紧急",
      className: "border-red-500/30 bg-red-500/10 text-red-500 dark:text-red-400",
    },
    standard: {
      label: "标准",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    },
    routine: {
      label: "例行",
      className: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
    },
  } as const;

  const current = meta[level];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${current.className}`}>
      {current.label}
    </span>
  );
}

// 状态标签组件
// 渲染任务状态标签。
function StatusTag({ status }: { status: TaskStatus }) {
  const { badgeClassName, label, icon: Icon, animateIcon } = TASK_STATUS_META[status];

  return (
    <span className={`app-badge ${badgeClassName}`}>
      <Icon className={`w-3 h-3 ${animateIcon ? "animate-spin" : ""}`} />
      {label}
    </span>
  );
}

// 统计卡片组件
// 渲染任务统计卡片。
function StatCard({
  label,
  value,
  icon: Icon,
  color,
  active,
  onClick,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`app-kpi-card flex w-full items-center gap-3 px-4 py-3 text-left transition-all duration-200 ${
        active ? "border-[#5e6ad2]/35 bg-[#5e6ad2]/8" : "hover:bg-muted/75"
      }`}
    >
      <div
        className={`flex items-center justify-center w-9 h-9 rounded-lg ${color}`}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <div className="text-xl font-semibold text-foreground">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </button>
  );
}

// 骨架行组件
// 渲染任务表格的骨架行。
function SkeletonRow() {
  return (
    <tr className="border-b border-border">
      {[...Array(7)].map((_, i) => (
        <td key={i} className="px-4 py-4">
          <div
            className={`app-skeleton h-4 ${
              i === 2 ? "w-32" : i === 6 ? "w-16" : "w-20"
            }`}
          />
        </td>
      ))}
    </tr>
  );
}

// 空状态组件
// 渲染任务列表的空状态内容。
function EmptyState({
  onCreate,
  filtered = false,
}: {
  onCreate?: () => void;
  filtered?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="app-empty-icon mb-4 h-16 w-16 rounded-full">
        <FileText className="w-7 h-7" />
      </div>
      <h3 className="mb-2 text-lg font-medium text-foreground">
        {filtered ? "当前筛选下暂无任务" : "暂无诊断任务"}
      </h3>
      <p className="mb-6 max-w-sm text-center text-sm text-muted-foreground">
        {filtered
          ? "请切换任务状态卡片或调整搜索关键词后再查看结果。"
          : "创建首个诊断任务，开始分析传感器数据并生成诊断报告"}
      </p>
      {!filtered ? (
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#5e6ad2] hover:bg-[#7170ff] text-white text-sm font-medium rounded-md transition-colors"
        >
          <Plus className="w-4 h-4" />
          创建首个诊断任务
        </button>
      ) : null}
    </div>
  );
}

// 错误状态组件
// 渲染任务列表的错误状态提示。
function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg">
      <div className="flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-red-400" />
        <div>
          <p className="text-sm font-medium text-red-400">数据加载失败</p>
          <p className="text-xs text-red-400/70">
            无法获取任务列表，请检查网络连接后重试
          </p>
        </div>
      </div>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-medium rounded-md transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        重试
      </button>
    </div>
  );
}

// 任务行操作菜单
// 渲染单条任务的操作菜单。
function TaskRowActions({
  taskId,
  onDelete,
}: {
  taskId: string;
  onDelete: (taskId: string) => Promise<void>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="任务操作"
      >
        <MoreHorizontal className="w-4 h-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-40 border-border bg-popover"
      >
        <DropdownMenuItem
          className="text-foreground focus:bg-accent focus:text-accent-foreground"
          asChild
        >
          <Link href={`/tasks/${taskId}`} className="flex items-center gap-2">
            <ExternalLink className="w-3.5 h-3.5" />
            查看详情
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-red-400 focus:bg-red-500/10 focus:text-red-300"
          onSelect={() => {
            void onDelete(taskId);
          }}
        >
          <Trash2 className="w-3.5 h-3.5" />
          删除任务
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// 分页组件
// 渲染任务列表分页器。
function Pagination({
  currentPage,
  totalPages,
  totalCount,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3">
      <div className="text-sm text-muted-foreground">
        共 {totalCount} 条记录，第 {currentPage} / {totalPages} 页
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        {[...Array(Math.min(totalPages, 5))].map((_, i) => {
          const page = i + 1;
          return (
            <button
              key={page}
              onClick={() => onPageChange(page)}
              className={`w-8 h-8 rounded-md text-sm font-medium transition-colors ${
                currentPage === page
                  ? "bg-[#5e6ad2] text-white"
                  : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {page}
            </button>
          );
        })}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export type TaskListMode = "all" | "create" | "history";

// 渲染任务列表页内容，并承载诊断发起、列表筛选和删除流程。
export function TaskListPageContent({ mode = "all" }: { mode?: TaskListMode }) {
  const showCreatePanel = mode !== "history";
  const showHistoryPanel = mode !== "create";
  const showHistoryCreateShortcut = mode === "all";
  const isHistoryMode = mode === "history";
  const router = useRouter();
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const logInputRef = useRef<HTMLInputElement | null>(null);
  const recordInputRef = useRef<HTMLInputElement | null>(null);
  const [pageState, setPageState] = useState<PageState>("normal");
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [listTasks, setListTasks] = useState<Task[]>([]);

  const [diagSymptom, setDiagSymptom] = useState("");
  const [diagEquipmentType, setDiagEquipmentType] = useState("");
  const [diagAssetCode, setDiagAssetCode] = useState("");
  const [diagLevel, setDiagLevel] = useState<MaintenanceLevelOption>("standard");
  const [diagRegion, setDiagRegion] = useState("");
  const [diagMode, setDiagMode] = useState<DiagnosisMode>("multi_agent");
  const [diagAutoWorkOrder, setDiagAutoWorkOrder] = useState(true);
  const [diagSubmitting, setDiagSubmitting] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [diagImageFile, setDiagImageFile] = useState<File | null>(null);
  const [diagLogFile, setDiagLogFile] = useState<File | null>(null);
  const [diagRecordFile, setDiagRecordFile] = useState<File | null>(null);
  const [diagPhase, setDiagPhase] = useState<DiagnosePhase>("idle");
  const [diagProgressHasAttachment, setDiagProgressHasAttachment] = useState(false);

  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [createTaskSubmitting, setCreateTaskSubmitting] = useState(false);
  const [createTaskError, setCreateTaskError] = useState<string | null>(null);
  const [equipmentType, setEquipmentType] = useState("");
  const [equipmentModel, setEquipmentModel] = useState("");
  const [assetCode, setAssetCode] = useState("");
  const [maintenanceLevel, setMaintenanceLevel] =
    useState<MaintenanceLevelOption>("standard");
  const [symptomDescription, setSymptomDescription] = useState("");

  /** 与筛选器同步，供列表刷新与轮询复用 */
  const [apiStatusFilter, setApiStatusFilter] = useState<string | undefined>(
    undefined,
  );

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 拉取任务列表并同步页面状态。
  const loadTasks = useCallback(async () => {
    try {
      const r = await fetchMaintenanceHistory({
        limit: 50,
      });
      setListTasks(r.tasks.map(mapHistoryToTask));
      setPageState(r.tasks.length ? "normal" : "empty");
    } catch {
      setPageState("error");
    }
  }, []);

  useEffect(() => {
    if (!showHistoryPanel) return;
    void loadTasks();
  }, [loadTasks, showHistoryPanel]);

  useEffect(() => {
    if (!createTaskOpen) return;
    setCreateTaskError(null);
    setEquipmentType("");
    setEquipmentModel("");
    setAssetCode("");
    setMaintenanceLevel("standard");
    setSymptomDescription("");
  }, [createTaskOpen]);

  // 以文本形式读取上传文件内容。
  const readFileAsText = useCallback((file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(new Error(`读取文件「${file.name}」失败`));
      reader.readAsText(file, "utf-8");
    });
  }, []);

  // 以 Data URL 形式读取上传文件内容。
  const readFileAsDataUrl = useCallback((file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(new Error(`读取文件「${file.name}」失败`));
      reader.readAsDataURL(file);
    });
  }, []);

  // 处理诊断图片文件选择并校验文件类型。
  const handleDiagImagePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setDiagError("请选择有效图片文件");
      event.target.value = "";
      return;
    }
    setDiagImageFile(file);
    setDiagError(null);
  };

  // 处理诊断日志文件选择。
  const handleDiagLogPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    setDiagLogFile(file);
    setDiagError(null);
  };

  const handleDiagRecordPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    setDiagRecordFile(file);
    setDiagError(null);
  };

  // 校验表单并创建新的诊断任务。
  const submitCreateTask = () => {
    const et = equipmentType.trim();
    const sym = symptomDescription.trim();
    if (!et) {
      setCreateTaskError("请填写设备类型");
      return;
    }
    if (!sym) {
      setCreateTaskError("请填写故障现象或观察说明（创建任务必填）");
      return;
    }
    setCreateTaskError(null);
    void (async () => {
      setCreateTaskSubmitting(true);
      try {
        await createMaintenanceTask({
          equipment_type: et,
          equipment_model: equipmentModel.trim() || undefined,
          asset_code: assetCode.trim() || undefined,
          maintenance_level: maintenanceLevel,
          symptom_description: sym,
          source_chunk_ids: [],
        });
        setCreateTaskOpen(false);
        await loadTasks();
        setPageState("normal");
      } catch (e) {
        setCreateTaskError(
          e instanceof Error ? e.message : "创建失败，请稍后重试",
        );
      } finally {
        setCreateTaskSubmitting(false);
      }
    })();
  };

  // 发起智能诊断流程，并在需要时携带日志或图片附件。
  const runSmartDiagnose = useCallback(() => {
    const sym = diagSymptom.trim()
    const et = diagEquipmentType.trim()
    const normalizedAssetCode = diagAssetCode.trim() || generateMockAssetCode()
    if (!sym) {
      setDiagError("请填写故障现象或观察说明")
      return
    }
    if (!et) {
      setDiagError("请填写设备类型")
      return
    }
    setDiagError(null)
    if (!diagAssetCode.trim()) {
      setDiagAssetCode(normalizedAssetCode)
    }
    void (async () => {
      setDiagSubmitting(true)
      setDiagPhase("running")
      const hasAttachment = Boolean(diagImageFile || diagLogFile || diagRecordFile);
      setDiagProgressHasAttachment(hasAttachment);
      try {
        let composedSymptom = sym;
        if (diagRegion.trim()) {
          composedSymptom = `${composedSymptom}\n\n[所属区域：${diagRegion.trim()}]`;
        }
        let sourceChunkIds: number[] = [];

        if (hasAttachment) {
          let imageBase64: string | undefined;
          let imageMimeType: string | undefined;
          let imageFilename: string | undefined;
          let attachmentIds: number[] = [];
          if (diagLogFile) {
            const rawLog = await readFileAsText(diagLogFile);
            const compactLog = rawLog.replace(/\r/g, "").trim();
            if (compactLog) {
              composedSymptom = `${composedSymptom}\n\n[现场日志：${diagLogFile.name}]\n${compactLog.slice(0, 4000)}`;
            }
          }
          if (diagRecordFile) {
            const isTextLike =
              diagRecordFile.type.startsWith("text/") ||
              /\.(txt|csv|log)$/i.test(diagRecordFile.name);
            if (isTextLike) {
              try {
                const rawRecord = await readFileAsText(diagRecordFile);
                const compactRecord = rawRecord.replace(/\r/g, "").trim();
                if (compactRecord) {
                  composedSymptom = `${composedSymptom}\n\n[维修记录：${diagRecordFile.name}]\n${compactRecord.slice(0, 4000)}`;
                }
              } catch {
                composedSymptom = `${composedSymptom}\n\n[维修记录附件：${diagRecordFile.name}]`;
              }
            } else {
              composedSymptom = `${composedSymptom}\n\n[维修记录附件：${diagRecordFile.name}]`;
            }
          }
          if (diagImageFile) {
            const token = getMaintenanceToken();
            if (token) {
              try {
                const uploaded = await uploadMaintenanceAttachment(token, {
                  file: diagImageFile,
                  biz_type: "diagnosis_image",
                });
                attachmentIds = [uploaded.id];
                imageFilename = diagImageFile.name;
              } catch {
                const dataUrl = await readFileAsDataUrl(diagImageFile);
                imageBase64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
                imageMimeType = diagImageFile.type || "image/png";
                imageFilename = diagImageFile.name;
              }
            } else {
              const dataUrl = await readFileAsDataUrl(diagImageFile);
              imageBase64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
              imageMimeType = diagImageFile.type || "image/png";
              imageFilename = diagImageFile.name;
            }
          }
          const assistResult = await postAgentAssist({
            query: composedSymptom,
            equipment_type: et,
            asset_code: normalizedAssetCode,
            maintenance_level: diagLevel,
            limit: 5,
            selected_chunk_ids: [],
            attachment_ids: attachmentIds,
            image_base64: imageBase64,
            image_mime_type: imageMimeType,
            image_filename: imageFilename,
          });
          if (assistResult.effective_query?.trim()) {
            composedSymptom = assistResult.effective_query.trim();
          }
          sourceChunkIds = (assistResult.knowledge_results ?? [])
            .map((item) => Number(item.chunk_id))
            .filter((item) => Number.isFinite(item) && item > 0);
        }

        const created = await createMaintenanceTask({
          equipment_type: et,
          asset_code: normalizedAssetCode,
          maintenance_level: diagLevel,
          symptom_description: composedSymptom,
          source_chunk_ids: sourceChunkIds,
        })
        router.push(`/tasks/${created.id}?action=process`)
        return
      } catch (e) {
        setDiagError(e instanceof Error ? e.message : "诊断失败，请稍后重试")
        setDiagPhase("idle")
      } finally {
        setDiagSubmitting(false)
      }
    })()
  }, [
    diagAssetCode,
    diagAutoWorkOrder,
    diagEquipmentType,
    diagImageFile,
    diagLevel,
    diagLogFile,
    diagMode,
    diagRecordFile,
    diagRegion,
    diagSymptom,
    readFileAsDataUrl,
    readFileAsText,
    router,
  ])

  // 打开删除确认弹窗并记录当前待删除任务。
  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      const id = Number(taskId);
      if (!Number.isFinite(id)) return;
      setDeleteTargetId(taskId);
      setDeleteError(null);
      setDeleteDialogOpen(true);
    },
    [loadTasks],
  );

  // 执行任务删除并在成功后刷新列表。
  const confirmDelete = useCallback(async () => {
    if (!deleteTargetId) return;
    const id = Number(deleteTargetId);
    if (!Number.isFinite(id)) return;
    setDeleteSubmitting(true);
    setDeleteError(null);
    try {
      await deleteMaintenanceTask(id);
      setDeleteDialogOpen(false);
      setDeleteTargetId(null);
      await loadTasks();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "删除任务失败，请稍后重试");
    } finally {
      setDeleteSubmitting(false);
    }
  }, [deleteTargetId, loadTasks]);

  /** 存在待处理或进行中任务时定时拉取，便于状态同步到最新结果 */
  const hasActiveInList = useMemo(
    () => showHistoryPanel && listTasks.some((t) => t.status === "running" || t.status === "pending"),
    [listTasks, showHistoryPanel],
  );

  useEffect(() => {
    if (!hasActiveInList || pageState === "error") return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void loadTasks();
    };
    const id = window.setInterval(tick, 4000);
    return () => window.clearInterval(id);
  }, [hasActiveInList, loadTasks, pageState]);

  const displayTasks = useMemo(() => {
    const base = listTasks;
    return base.filter((task) => {
      if (apiStatusFilter === "in_progress" && task.status !== "running") return false;
      if (apiStatusFilter === "pending" && task.status !== "pending" && task.status !== "running") return false;
      if (apiStatusFilter === "completed" && task.status !== "completed") return false;
      if (apiStatusFilter === "diagnosis_completed" && task.status !== "diagnosis_completed") return false;
      if (apiStatusFilter === "skipped" && task.status !== "failed") return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        task.id.toLowerCase().includes(q) ||
        task.symptom.toLowerCase().includes(q)
      );
    });
  }, [apiStatusFilter, listTasks, searchQuery]);

  const stats = useMemo(() => {
    const src = listTasks;
    return {
      today: src.length,
      running: src.filter((t) => t.status === "running" || t.status === "pending").length,
      diagnosisCompleted: src.filter((t) => t.status === "diagnosis_completed").length,
      completed: src.filter((t) => t.status === "completed").length,
      failed: src.filter((t) => t.status === "failed").length,
    };
  }, [listTasks]);

  const totalPages = Math.max(1, Math.ceil(displayTasks.length / 10) || 1);
  const pagedTasks = useMemo(() => {
    const start = (currentPage - 1) * 10;
    return displayTasks.slice(start, start + 10);
  }, [displayTasks, currentPage]);
  const runningDiagMessage = useMemo(() => {
    if (diagProgressHasAttachment) {
      return {
        title: "多智能体正在分析附件与故障信息…",
        description: "感知、检索、诊断、规划与审核智能体依次处理输入，完成后进入任务详情页。",
      };
    }
    return {
      title: "多智能体正在协同诊断…",
      description: "系统正在整理故障录入信息，并准备进入诊断详情页展示完整结果。",
    };
  }, [diagProgressHasAttachment]);

  return (
    <>
      {showCreatePanel ? (
        <div className="mb-8">
          <DiagnosisTaskWorkbench
            diagSymptom={diagSymptom}
            onSymptomChange={setDiagSymptom}
            diagEquipmentType={diagEquipmentType}
            onEquipmentTypeChange={setDiagEquipmentType}
            diagAssetCode={diagAssetCode}
            onAssetCodeChange={setDiagAssetCode}
            diagRegion={diagRegion}
            onRegionChange={setDiagRegion}
            diagLevel={diagLevel}
            onLevelChange={setDiagLevel}
            diagMode={diagMode}
            onModeChange={setDiagMode}
            diagAutoWorkOrder={diagAutoWorkOrder}
            onAutoWorkOrderChange={setDiagAutoWorkOrder}
            diagImageFile={diagImageFile}
            diagLogFile={diagLogFile}
            diagRecordFile={diagRecordFile}
            onClearImage={() => {
              setDiagImageFile(null);
              if (imageInputRef.current) imageInputRef.current.value = "";
            }}
            onClearLog={() => {
              setDiagLogFile(null);
              if (logInputRef.current) logInputRef.current.value = "";
            }}
            onClearRecord={() => {
              setDiagRecordFile(null);
              if (recordInputRef.current) recordInputRef.current.value = "";
            }}
            imageInputRef={imageInputRef}
            logInputRef={logInputRef}
            recordInputRef={recordInputRef}
            onImagePick={handleDiagImagePick}
            onLogPick={handleDiagLogPick}
            onRecordPick={handleDiagRecordPick}
            diagSubmitting={diagSubmitting}
            diagError={diagError}
            diagPhase={diagPhase}
            runningTitle={runningDiagMessage.title}
            runningDescription={runningDiagMessage.description}
            onSubmit={runSmartDiagnose}
          />
        </div>
      ) : null}

      {showHistoryPanel ? (
        <>
        {/* 操作栏 */}
        <div
          id="diagnosis-records"
          className={
            isHistoryMode
              ? "mb-6 max-w-md"
              : "mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
          }
        >
          {!isHistoryMode ? (
            <div>
              <h2 className="text-base font-semibold text-foreground">诊断任务记录</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                历史任务用于复盘与沉淀知识，完成诊断后可在详情页继续生成工单和知识案例
              </p>
            </div>
          ) : null}
          <div
            className={
              isHistoryMode ? "relative w-full" : "flex flex-wrap items-center gap-3"
            }
          >
            <div className={isHistoryMode ? "relative w-full" : "relative flex-1 sm:flex-none"}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="搜索任务编号、故障现象或设备关键词..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={
                  isHistoryMode
                    ? "app-input w-full py-2 pl-9 pr-4"
                    : "app-input w-full py-2 pl-9 pr-4 sm:w-64"
                }
              />
            </div>
            {showHistoryCreateShortcut ? (
              <button
                type="button"
                className="app-btn-secondary whitespace-nowrap"
                onClick={() => setCreateTaskOpen(true)}
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">新建诊断任务</span>
              </button>
            ) : null}
          </div>
        </div>

        {/* 统计指标条 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StatCard
            label="全部任务"
            value={stats.today}
            icon={Calendar}
            color="bg-[#5e6ad2]/20 text-[#7170ff]"
            active={!apiStatusFilter}
            onClick={() => {
              setApiStatusFilter(undefined);
              setCurrentPage(1);
            }}
          />
          <StatCard
            label={TASK_STATUS_META.pending.label}
            value={stats.running}
            icon={TASK_STATUS_META.pending.icon}
            color={TASK_STATUS_META.pending.cardColorClassName}
            active={apiStatusFilter === "in_progress" || apiStatusFilter === "pending"}
            onClick={() => {
              setApiStatusFilter("pending");
              setCurrentPage(1);
            }}
          />
          <StatCard
            label={TASK_STATUS_META.diagnosis_completed.label}
            value={stats.diagnosisCompleted}
            icon={TASK_STATUS_META.diagnosis_completed.icon}
            color={TASK_STATUS_META.diagnosis_completed.cardColorClassName}
            active={apiStatusFilter === "diagnosis_completed"}
            onClick={() => {
              setApiStatusFilter("diagnosis_completed");
              setCurrentPage(1);
            }}
          />
          <StatCard
            label={TASK_STATUS_META.completed.label}
            value={stats.completed}
            icon={TASK_STATUS_META.completed.icon}
            color={TASK_STATUS_META.completed.cardColorClassName}
            active={apiStatusFilter === "completed"}
            onClick={() => {
              setApiStatusFilter("completed");
              setCurrentPage(1);
            }}
          />
        </div>

        {/* 错误状态 */}
        {pageState === "error" && (
          <div className="mb-6">
            <ErrorState
              onRetry={() => {
                void loadTasks();
                setPageState("normal");
              }}
            />
          </div>
        )}

        {/* 任务表格 */}
        <div className="app-card overflow-visible">
          {pageState === "empty" ? (
            <EmptyState onCreate={showHistoryCreateShortcut ? () => setCreateTaskOpen(true) : undefined} />
          ) : pageState !== "loading" && displayTasks.length === 0 ? (
            <EmptyState filtered />
          ) : (
            <>
              {/* 桌面端表格 */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="app-table-head border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                        任务ID
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                        创建 / 更新
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                        故障描述
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                        链路环节完成数
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                        状态
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                        紧急程度
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                        耗时
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageState === "loading" ? (
                      [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
                    ) : (
                      pagedTasks.map((task) => (
                        <tr
                          key={task.id}
                          className="app-table-row cursor-pointer group"
                          onClick={() =>
                            (window.location.href = `/tasks/${task.id}`)
                          }
                        >
                          <td className="px-4 py-4">
                            <span className="text-sm font-mono text-[#7170ff]">
                              {task.id}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <span className="text-sm text-foreground">
                              {task.timeRange}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <span className="text-sm text-foreground">
                              {task.symptom}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <span className="app-chip-muted gap-1.5 rounded px-2 py-0.5">
                              <Cpu className="w-3 h-3" />
                              {task.progress}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <StatusTag status={task.status} />
                          </td>
                          <td className="px-4 py-4">
                            <MaintenanceLevelTag level={task.maintenanceLevel} />
                          </td>
                          <td className="px-4 py-4">
                            <span className="text-sm text-muted-foreground">
                              {task.duration}
                            </span>
                          </td>
                          <td
                            className="px-4 py-4 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <TaskRowActions taskId={task.id} onDelete={handleDeleteTask} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* 移动端卡片列表 */}
              <div className="divide-y divide-border lg:hidden">
                {pageState === "loading"
                  ? [...Array(3)].map((_, i) => (
                      <div key={i} className="p-4 space-y-3">
                        <div className="flex justify-between">
                          <div className="app-skeleton h-4 w-28" />
                          <div className="app-skeleton h-6 w-16 rounded-full" />
                        </div>
                        <div className="app-skeleton h-4 w-full" />
                        <div className="flex justify-between">
                          <div className="app-skeleton h-3 w-24" />
                          <div className="app-skeleton h-3 w-16" />
                        </div>
                      </div>
                    ))
                  : pagedTasks.map((task) => (
                      <Link
                        key={task.id}
                        href={`/tasks/${task.id}`}
                        className="block p-4 transition-colors hover:bg-muted/45"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono text-[#7170ff]">
                              {task.id}
                            </span>
                            <MaintenanceLevelTag level={task.maintenanceLevel} />
                          </div>
                          <StatusTag status={task.status} />
                        </div>
                        <p className="mb-2 text-sm text-foreground">
                          {task.symptom}
                        </p>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {task.timeRange}
                          </span>
                          <span className="flex items-center gap-1">
                            <Cpu className="w-3 h-3" />
                            {task.progress}
                          </span>
                        </div>
                      </Link>
                    ))}
              </div>

              {/* 分页 */}
              {pageState !== "loading" && (
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalCount={displayTasks.length}
                  onPageChange={setCurrentPage}
                />
              )}
            </>
          )}
        </div>
        </>
      ) : null}

      {showHistoryCreateShortcut ? (
      <Dialog open={createTaskOpen} onOpenChange={setCreateTaskOpen}>
        <DialogContent
          showCloseButton
          className="max-w-md border-border bg-popover text-popover-foreground sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle>创建诊断任务</DialogTitle>
            <DialogDescription>
              填写设备与现象后提交，系统将创建检修任务并刷新列表。
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submitCreateTask();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="tasks-eq-type" className="text-foreground">
                设备类型 <span className="text-red-400">*</span>
              </Label>
              <Input
                id="tasks-eq-type"
                name="equipment_type"
                placeholder="例如：离心泵、数控机床主轴"
                value={equipmentType}
                onChange={(e) => setEquipmentType(e.target.value)}
                className="app-input"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tasks-eq-model" className="text-foreground">
                设备型号
              </Label>
              <Input
                id="tasks-eq-model"
                name="equipment_model"
                placeholder="选填，如 DM-1000"
                value={equipmentModel}
                onChange={(e) => setEquipmentModel(e.target.value)}
                className="app-input"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tasks-asset-code" className="text-foreground">
                设备编号
              </Label>
              <Input
                id="tasks-asset-code"
                name="asset_code"
                placeholder="选填，资产编码或现场编号"
                value={assetCode}
                onChange={(e) => setAssetCode(e.target.value)}
                className="app-input"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tasks-maint-level" className="text-foreground">
                检修等级
              </Label>
              <Select
                value={maintenanceLevel}
                onValueChange={(v) =>
                  setMaintenanceLevel(v as MaintenanceLevelOption)
                }
              >
                <SelectTrigger
                  id="tasks-maint-level"
                  className="h-9 w-full border-input bg-background text-foreground [&_svg]:text-muted-foreground"
                >
                  <SelectValue placeholder="选择检修等级" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="z-[200] border-border bg-popover text-popover-foreground shadow-xl"
                >
                  <SelectItem
                    value="routine"
                    className="cursor-pointer text-foreground focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  >
                    例行 (routine)
                  </SelectItem>
                  <SelectItem
                    value="standard"
                    className="cursor-pointer text-foreground focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  >
                    标准 (standard)
                  </SelectItem>
                  <SelectItem
                    value="emergency"
                    className="cursor-pointer text-foreground focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  >
                    紧急 (emergency)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tasks-symptom" className="text-foreground">
                故障现象 / 观察说明 <span className="text-red-400">*</span>
              </Label>
              <Textarea
                id="tasks-symptom"
                name="symptom_description"
                placeholder="例如：振动异常、温升过快、或需建立基线的接入说明"
                value={symptomDescription}
                onChange={(e) => setSymptomDescription(e.target.value)}
                rows={3}
                className="app-textarea min-h-[88px]"
              />
            </div>
            {createTaskError ? (
              <p className="text-sm text-red-400" role="alert">
                {createTaskError}
              </p>
            ) : null}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                className="border-border bg-transparent text-foreground hover:bg-muted"
                onClick={() => setCreateTaskOpen(false)}
                disabled={createTaskSubmitting}
              >
                取消
              </Button>
              <Button
                type="submit"
                className="bg-[#5e6ad2] text-white hover:bg-[#6b77db]"
                disabled={createTaskSubmitting}
              >
                {createTaskSubmitting ? "提交中…" : "确认创建"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      ) : null}

      {showHistoryPanel ? (
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(v) => {
          if (deleteSubmitting) return;
          setDeleteDialogOpen(v);
          if (!v) {
            setDeleteTargetId(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="max-w-md border-border bg-popover text-popover-foreground">
          <DialogHeader>
            <DialogTitle>确认删除任务</DialogTitle>
            <DialogDescription>
              {deleteTargetId ? (
                <>
                  你将删除任务 <span className="font-mono text-foreground">#{deleteTargetId}</span>。
                  该操作会同步删除后端数据，且不可撤销。
                </>
              ) : (
                "该操作会同步删除后端数据，且不可撤销。"
              )}
            </DialogDescription>
          </DialogHeader>

          {deleteError ? (
            <p className="text-sm text-red-400" role="alert">
              {deleteError}
            </p>
          ) : null}

          <DialogFooter className="gap-3 sm:gap-3">
            <Button
              type="button"
              variant="outline"
              className="border-border bg-transparent text-foreground hover:bg-muted"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleteSubmitting}
            >
              取消
            </Button>
            <Button
              type="button"
              className="bg-red-500 text-white hover:bg-red-600"
              onClick={() => void confirmDelete()}
              disabled={deleteSubmitting}
            >
              {deleteSubmitting ? "删除中…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      ) : null}
    </>
  );
}

// 主页面组件
// 渲染兼容的任务列表页，并承载诊断发起与历史记录。
export default function TasksPage({ mode = "all" }: { mode?: TaskListMode }) {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="app-main">
        <TaskListPageContent mode={mode} />
      </main>
    </div>
  );
}
