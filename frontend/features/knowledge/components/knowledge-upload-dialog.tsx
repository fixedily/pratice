"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchKnowledgeImportJobsByBatch,
  importKnowledgeDocument,
  retryKnowledgeImportJob,
} from "@/features/knowledge/api";
import {
  importStageLabel,
  importStageProgress,
  isActiveImportStage,
  normalizeImportStage,
  jobToUploadBatchTask,
  mergeJobIntoTasks,
  summarizeBatchTasks,
  type UploadBatchTask,
} from "@/features/knowledge/lib/import-task";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Progress } from "@/shared/components/ui/progress";
import { FileText, Loader2, RefreshCw, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";

type KnowledgeUploadType = "manual" | "case" | "sop" | "expert";

const KNOWLEDGE_UPLOAD_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.markdown,.json,.jsonl,.ndjson";
const KNOWLEDGE_UPLOAD_FORMAT_HINT =
  "支持 PDF、PNG、JPG、WEBP、TXT、MD、JSON、JSONL，可多选。";

function mergeUploadFiles(existing: File[], incoming: FileList | File[]): File[] {
  const merged = new Map<string, File>();
  for (const file of existing) {
    merged.set(`${file.name}:${file.size}`, file);
  }
  for (const file of Array.from(incoming)) {
    merged.set(`${file.name}:${file.size}`, file);
  }
  return Array.from(merged.values());
}

function formatUploadFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function createBatchId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `batch-${Date.now()}`;
}

type KnowledgeUploadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knowledgeBaseId: number;
  knowledgeBaseName?: string;
  onJobsFinished?: () => void;
};

export function KnowledgeUploadDialog({
  open,
  onOpenChange,
  knowledgeBaseId,
  knowledgeBaseName,
  onJobsFinished,
}: KnowledgeUploadDialogProps) {
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [batchTasks, setBatchTasks] = useState<UploadBatchTask[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [uploadEquipmentType, setUploadEquipmentType] = useState("");
  const [uploadKnowledgeType, setUploadKnowledgeType] =
    useState<KnowledgeUploadType>("manual");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadReplaceExisting, setUploadReplaceExisting] = useState(true);
  const [uploadSubmitting, setUploadSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<number | null>(null);

  const batchSummary = useMemo(() => summarizeBatchTasks(batchTasks), [batchTasks]);
  const hasStartedBatch = batchTasks.length > 0;
  const showTaskList = hasStartedBatch;

  const resetUploadForm = useCallback(() => {
    setUploadFiles([]);
    setBatchTasks([]);
    setBatchId(null);
    setUploadProgress(null);
    setUploadEquipmentType("");
    setUploadKnowledgeType("manual");
    setUploadTitle("");
    setUploadReplaceExisting(true);
  }, []);

  const handleUploadFileChange = useCallback((incoming: FileList | null) => {
    if (!incoming?.length) return;
    setUploadFiles((prev) => mergeUploadFiles(prev, incoming));
  }, []);

  const removeUploadFile = useCallback((target: File) => {
    setUploadFiles((prev) =>
      prev.filter(
        (file) => file.name !== target.name || file.size !== target.size,
      ),
    );
  }, []);

  const refreshBatchTasks = useCallback(async (activeBatchId: string) => {
    try {
      const payload = await fetchKnowledgeImportJobsByBatch(activeBatchId, 50);
      setBatchTasks((prev) => mergeJobIntoTasks(prev, payload.jobs));
      return payload.jobs;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (!open || !batchId) return;
    const hasActive = batchTasks.some((task) => isActiveImportStage(task.status));
    if (!hasActive) return;

    const timer = window.setInterval(() => {
      void refreshBatchTasks(batchId).then((jobs) => {
        const stillActive = jobs.some((job) =>
          isActiveImportStage(job.status),
        );
        if (!stillActive) {
          onJobsFinished?.();
        }
      });
    }, 2000);

    return () => window.clearInterval(timer);
  }, [batchId, batchTasks, onJobsFinished, open, refreshBatchTasks]);

  const submitKnowledgeUpload = useCallback(() => {
    if (!knowledgeBaseId || knowledgeBaseId < 1) {
      toast.error("请先选择或创建知识库");
      return;
    }
    if (!uploadFiles.length) {
      toast.error("请先选择上传文件");
      return;
    }
    if (!uploadEquipmentType.trim()) {
      toast.error("请填写设备类型");
      return;
    }

    void (async () => {
      const nextBatchId = batchId ?? createBatchId();
      setBatchId(nextBatchId);
      setUploadSubmitting(true);
      setUploadProgress({ current: 0, total: uploadFiles.length });

      const createdTasks: UploadBatchTask[] = [];

      for (let index = 0; index < uploadFiles.length; index += 1) {
        const file = uploadFiles[index];
        setUploadProgress({ current: index + 1, total: uploadFiles.length });
        const localKey = `${file.name}:${file.size}`;
        try {
          const job = await importKnowledgeDocument({
            file,
            knowledge_base_id: knowledgeBaseId,
            equipment_type: uploadEquipmentType.trim(),
            title:
              uploadFiles.length === 1
                ? uploadTitle.trim() || undefined
                : undefined,
            source_type: uploadKnowledgeType,
            replace_existing: uploadReplaceExisting,
            batch_id: nextBatchId,
          });
          createdTasks.push(jobToUploadBatchTask(job, { localKey, fileName: file.name, fileSize: file.size }));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "创建导入任务失败";
          createdTasks.push({
            localKey,
            fileName: file.name,
            fileSize: file.size,
            status: "failed",
            currentStage: "failed",
            progress: 0,
            errorMessage: message,
          });
        }
      }

      setBatchTasks(createdTasks);
      setUploadFiles([]);
      setUploadSubmitting(false);
      setUploadProgress(null);

      const summary = summarizeBatchTasks(createdTasks);
      if (summary.failed === summary.total) {
        toast.error(createdTasks[0]?.errorMessage ?? "导入任务创建失败");
        return;
      }

      toast.success("导入任务已创建，正在后台解析入库");
      if (summary.failed > 0) {
        toast.warning(`${summary.failed} 个文件未能创建导入任务，请查看失败原因`);
      }
      void refreshBatchTasks(nextBatchId);
      onJobsFinished?.();
    })();
  }, [
    batchId,
    onJobsFinished,
    refreshBatchTasks,
    uploadEquipmentType,
    uploadFiles,
    uploadKnowledgeType,
    uploadReplaceExisting,
    uploadTitle,
    knowledgeBaseId,
  ]);

  const handleRetry = useCallback(
    async (task: UploadBatchTask) => {
      if (!task.jobId || !batchId) return;
      setRetryingJobId(task.jobId);
      try {
        const job = await retryKnowledgeImportJob(task.jobId);
        setBatchTasks((prev) =>
          prev.map((item) =>
            item.jobId === task.jobId ? jobToUploadBatchTask(job, item) : item,
          ),
        );
        toast.success("已重新提交导入任务");
        void refreshBatchTasks(batchId);
        onJobsFinished?.();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "重试失败");
      } finally {
        setRetryingJobId(null);
      }
    },
    [batchId, onJobsFinished, refreshBatchTasks],
  );

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && uploadSubmitting) return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      const hasActive = batchTasks.some((task) => isActiveImportStage(task.status));
      if (!hasActive) {
        resetUploadForm();
      }
    }
  };

  const closeHint = useMemo(() => {
    if (!showTaskList || batchSummary.total === 0) return null;
    if (batchSummary.active > 0) {
      return "导入任务已在后台执行，可关闭弹窗后在列表中查看进度。";
    }
    if (batchSummary.failed > 0) {
      return "部分文档导入失败，可查看原因后重试。";
    }
    if (batchSummary.completed === batchSummary.total) {
      return "全部文档已入库完成。";
    }
    return null;
  }, [batchSummary, showTaskList]);

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="left-auto right-0 top-0 h-screen w-full max-w-xl translate-x-0 translate-y-0 rounded-none border-y-0 border-r-0 border-l border-border bg-popover p-0 text-popover-foreground data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right">
        <div className="flex h-full flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6">
            <DialogHeader>
              <DialogTitle>知识文档上传</DialogTitle>
              <DialogDescription>
                上传设备手册、SOP、检修规范和现场图片，系统将自动解析并建立索引。
                {knowledgeBaseName ? (
                  <span className="mt-1 block text-foreground/80">
                    目标知识库：{knowledgeBaseName}
                  </span>
                ) : null}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 space-y-4">
              {!showTaskList ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      document.getElementById("knowledge-upload-input")?.click()
                    }
                    disabled={uploadSubmitting}
                    className="w-full rounded-lg border border-dashed border-border bg-muted px-4 py-6 text-left transition-colors hover:bg-muted/80 disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2 text-foreground">
                      <UploadCloud className="h-4 w-4" />
                      <span className="text-sm">
                        拖拽文件到此处，或点击选择（支持多选）
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {KNOWLEDGE_UPLOAD_FORMAT_HINT}
                    </p>
                  </button>
                  <input
                    id="knowledge-upload-input"
                    type="file"
                    multiple
                    accept={KNOWLEDGE_UPLOAD_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      handleUploadFileChange(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  {uploadFiles.length > 0 ? (
                    <div className="rounded-lg border border-border bg-card">
                      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
                        <span>已选择 {uploadFiles.length} 个文件</span>
                        <button
                          type="button"
                          className="text-foreground transition-colors hover:text-red-400"
                          onClick={() => setUploadFiles([])}
                          disabled={uploadSubmitting}
                        >
                          清空
                        </button>
                      </div>
                      <ul className="max-h-40 divide-y divide-border overflow-y-auto">
                        {uploadFiles.map((file) => (
                          <li
                            key={`${file.name}:${file.size}`}
                            className="flex items-center gap-2 px-3 py-2 text-sm"
                          >
                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-foreground">{file.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatUploadFileSize(file.size)}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              onClick={() => removeUploadFile(file)}
                              disabled={uploadSubmitting}
                              aria-label={`移除 ${file.name}`}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label className="text-foreground">设备类型 *</Label>
                      <Input
                        value={uploadEquipmentType}
                        onChange={(e) => setUploadEquipmentType(e.target.value)}
                        placeholder="如：摩托车发动机"
                        className="app-input"
                        disabled={uploadSubmitting}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-foreground">知识类型 *</Label>
                      <Select
                        value={uploadKnowledgeType}
                        onValueChange={(value) =>
                          setUploadKnowledgeType(value as KnowledgeUploadType)
                        }
                        disabled={uploadSubmitting}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="知识类型" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manual">设备手册</SelectItem>
                          <SelectItem value="sop">SOP流程</SelectItem>
                          <SelectItem value="case">故障案例</SelectItem>
                          <SelectItem value="expert">专家经验</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label className="text-foreground">文档标题</Label>
                    <Input
                      value={uploadTitle}
                      onChange={(e) => setUploadTitle(e.target.value)}
                      placeholder={
                        uploadFiles.length > 1
                          ? "多文件时将使用各文件名"
                          : "默认使用文件名"
                      }
                      disabled={uploadFiles.length > 1 || uploadSubmitting}
                      className="app-input"
                    />
                  </div>

                  <label className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-3">
                    <Checkbox
                      checked={uploadReplaceExisting}
                      onCheckedChange={(checked) =>
                        setUploadReplaceExisting(Boolean(checked))
                      }
                      disabled={uploadSubmitting}
                      className="mt-0.5"
                    />
                    <div className="space-y-1">
                      <div className="text-sm text-foreground">同名文档覆盖导入</div>
                      <p className="text-xs text-muted-foreground">
                        勾选后，当同一知识库下设备类型、知识类型与标题均相同时，将删除旧文档及其分段/向量索引后重新导入。
                      </p>
                    </div>
                  </label>
                </>
              ) : null}

              {showTaskList ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-foreground">导入任务列表</h3>
                    {batchId ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => void refreshBatchTasks(batchId)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        刷新
                      </button>
                    ) : null}
                  </div>
                  <ul className="space-y-2">
                    {batchTasks.map((task) => {
                      const stage = task.currentStage || task.status;
                      const normalized = normalizeImportStage(stage);
                      const failed = normalized === "failed";
                      const completed = normalized === "completed";
                      return (
                        <li
                          key={task.localKey}
                          className="rounded-lg border border-border bg-card px-3 py-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">
                                {task.fileName}
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {importStageLabel(stage)}
                                {task.jobId ? ` · #${task.jobId}` : ""}
                              </p>
                            </div>
                            {failed && task.jobId ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 shrink-0 px-2 text-xs"
                                disabled={retryingJobId === task.jobId}
                                onClick={() => void handleRetry(task)}
                              >
                                {retryingJobId === task.jobId ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  "重试"
                                )}
                              </Button>
                            ) : null}
                          </div>
                          <Progress
                            className="mt-2 h-1.5"
                            value={importStageProgress(stage, task.progress)}
                          />
                          {task.errorMessage ? (
                            <p className="mt-2 text-xs text-red-500">{task.errorMessage}</p>
                          ) : null}
                          {completed ? (
                            <p className="mt-2 text-xs text-emerald-600">入库完成</p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  {closeHint ? (
                    <p
                      className={`text-xs ${
                        closeHint.includes("失败")
                          ? "text-amber-600"
                          : closeHint.includes("完成")
                            ? "text-emerald-600"
                            : "text-muted-foreground"
                      }`}
                    >
                      {closeHint}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground">
                  上传后流程：创建导入任务 → 文本解析/OCR → 分段切片 → 向量化 →
                  索引写入 → 入库完成
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="border-border bg-transparent text-foreground hover:bg-muted hover:text-foreground"
              onClick={() => handleDialogOpenChange(false)}
              disabled={uploadSubmitting}
            >
              {showTaskList && batchSummary.active > 0 ? "关闭（后台继续）" : "取消"}
            </Button>
            {!showTaskList ? (
              <Button
                type="button"
                className="bg-[#5e6ad2] text-white hover:bg-[#6b77db]"
                disabled={
                  uploadSubmitting ||
                  !uploadFiles.length ||
                  !knowledgeBaseId ||
                  knowledgeBaseId < 1
                }
                onClick={submitKnowledgeUpload}
              >
                {uploadSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {uploadProgress
                      ? `提交任务 (${uploadProgress.current}/${uploadProgress.total})...`
                      : "提交任务..."}
                  </>
                ) : uploadFiles.length > 1 ? (
                  `开始上传 (${uploadFiles.length})`
                ) : (
                  "开始上传"
                )}
              </Button>
            ) : batchSummary.active > 0 ? (
              <Button
                type="button"
                variant="outline"
                disabled
                className="border-border"
              >
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                后台处理中
              </Button>
            ) : (
              <Button
                type="button"
                className="bg-[#5e6ad2] text-white hover:bg-[#6b77db]"
                onClick={() => {
                  resetUploadForm();
                  onOpenChange(false);
                }}
              >
                完成
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
