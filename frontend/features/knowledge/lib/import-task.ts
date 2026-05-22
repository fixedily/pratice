import type { KnowledgeImportJob, KnowledgeImportStage } from "@/shared/lib/http";

export const IMPORT_STAGE_LABELS: Record<string, string> = {
  pending: "等待处理",
  uploading: "上传中",
  parsing: "文本解析中",
  ocr: "OCR识别中",
  chunking: "分段切片中",
  embedding: "向量化中",
  indexing: "索引写入中",
  reviewing: "待审核",
  completed: "入库完成",
  failed: "导入失败",
  processing: "文本解析中",
};

export const IMPORT_STAGE_PROGRESS: Record<string, number> = {
  pending: 0,
  uploading: 10,
  parsing: 25,
  ocr: 40,
  chunking: 55,
  embedding: 75,
  indexing: 90,
  reviewing: 95,
  completed: 100,
  failed: 0,
  processing: 25,
};

export type UploadBatchTask = {
  localKey: string;
  fileName: string;
  fileSize: number;
  jobId?: number;
  status: string;
  currentStage?: string;
  progress: number;
  errorMessage?: string;
  errorStage?: string;
  retryCount?: number;
};

export function normalizeImportStage(stage: string | null | undefined): string {
  const raw = (stage || "pending").trim().toLowerCase();
  return raw === "processing" ? "parsing" : raw;
}

export function importStageLabel(stage: string | null | undefined): string {
  return IMPORT_STAGE_LABELS[normalizeImportStage(stage)] ?? stage ?? "处理中";
}

export function importStageProgress(
  stage: string | null | undefined,
  progress?: number | null,
): number {
  if (typeof progress === "number" && progress > 0) {
    return Math.min(100, Math.max(0, progress));
  }
  return IMPORT_STAGE_PROGRESS[normalizeImportStage(stage)] ?? 0;
}

export function isTerminalImportStage(stage: string | null | undefined): boolean {
  const normalized = normalizeImportStage(stage);
  return normalized === "completed" || normalized === "failed";
}

export function isActiveImportStage(stage: string | null | undefined): boolean {
  return !isTerminalImportStage(stage);
}

export function jobToUploadBatchTask(
  job: KnowledgeImportJob,
  fallback?: Pick<UploadBatchTask, "localKey" | "fileName" | "fileSize">,
): UploadBatchTask {
  const stage = normalizeImportStage(job.current_stage || job.status);
  return {
    localKey: fallback?.localKey ?? `${job.file_name}:${job.file_size ?? 0}:${job.id}`,
    fileName: job.file_name || fallback?.fileName || job.source_name,
    fileSize: job.file_size ?? fallback?.fileSize ?? 0,
    jobId: job.id,
    status: normalizeImportStage(job.status),
    currentStage: stage,
    progress: importStageProgress(stage, job.progress),
    errorMessage: job.error_message ?? undefined,
    errorStage: job.error_stage ? normalizeImportStage(job.error_stage) : undefined,
    retryCount: job.retry_count ?? 0,
  };
}

export function mergeJobIntoTasks(
  tasks: UploadBatchTask[],
  jobs: KnowledgeImportJob[],
): UploadBatchTask[] {
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  return tasks.map((task) => {
    if (!task.jobId) return task;
    const job = jobById.get(task.jobId);
    if (!job) return task;
    return jobToUploadBatchTask(job, task);
  });
}

export function summarizeBatchTasks(tasks: UploadBatchTask[]) {
  const total = tasks.length;
  const completed = tasks.filter((t) => normalizeImportStage(t.status) === "completed").length;
  const failed = tasks.filter((t) => normalizeImportStage(t.status) === "failed").length;
  const active = tasks.filter((t) => isActiveImportStage(t.status)).length;
  return { total, completed, failed, active };
}
