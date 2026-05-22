/**
 * 后端 API 客户端：统一读取 NEXT_PUBLIC_API_BASE_URL，供页面按钮与数据加载使用。
 */

import {
  clearMaintenanceToken,
  getMaintenanceToken,
  notifyMaintenanceAuthExpired,
  setMaintenanceToken,
} from "@/features/auth/lib/token-store";

export function getApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
  return raw.replace(/\/$/, "");
}

const MAINTENANCE_AUTH_EXPIRED_MESSAGE = "登录已失效，请重新登录";
const MAINTENANCE_NETWORK_ERROR_MESSAGE = "无法连接检修后端，请确认服务已启动且地址可访问";

export type MaintenanceLevelOption = "routine" | "standard" | "emergency";

export function normalizeMaintenanceLevelOption(
  value: string | null | undefined,
): MaintenanceLevelOption {
  const normalized = String(value || "standard").toLowerCase();
  if (normalized === "routine" || normalized === "emergency") {
    return normalized;
  }
  return "standard";
}

function normalizeMaintenanceNetworkError(error: unknown): Error {
  if (error instanceof Error) {
    const message = (error.message || "").trim();
    if (
      message === "Failed to fetch" ||
      message.includes("fetch failed") ||
      message.includes("NetworkError") ||
      message.includes("Load failed")
    ) {
      return new Error(MAINTENANCE_NETWORK_ERROR_MESSAGE);
    }
    return error;
  }
  return new Error(MAINTENANCE_NETWORK_ERROR_MESSAGE);
}

async function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${getApiBase()}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: HeadersInit = { ...init?.headers };
  const h = headers as Record<string, string>;
  if (init?.body && !(init.body instanceof FormData) && !h["Content-Type"]) {
    h["Content-Type"] = "application/json";
  }
  return fetch(url, { ...init, credentials: init?.credentials ?? "include", headers: h });
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await rawFetch(path, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.slice(0, 400) || String(res.status));
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function extractApiErrorMessage(
  json: Record<string, unknown>,
  fallbackText: string,
  status: number,
): string {
  const detail = json.detail;
  const nestedDetailMessage =
    detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string"
      ? detail.message
      : null;
  return (
    (typeof json.message === "string" ? json.message : null) ||
    nestedDetailMessage ||
    (typeof detail === "string" ? detail : null) ||
    fallbackText.slice(0, 200) ||
    String(status)
  );
}

let refreshTokenPromise: Promise<string | null> | null = null;

export async function refreshMaintenanceAccessToken(): Promise<string | null> {
  if (refreshTokenPromise) return refreshTokenPromise;
  refreshTokenPromise = (async () => {
    let res: Response;
    try {
      res = await rawFetch("/api/auth/refresh", { method: "POST" });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    } catch {
      return null;
    }
    const data = (json?.data ?? json) as Record<string, unknown>;
    const accessToken = typeof data.access_token === "string" ? data.access_token : null;
    if (!accessToken) return null;
    setMaintenanceToken(accessToken);
    return accessToken;
  })().finally(() => {
    refreshTokenPromise = null;
  });
  return refreshTokenPromise;
}

export async function maintenanceLogout(): Promise<void> {
  try {
    await rawFetch("/api/auth/logout", { method: "POST" });
  } finally {
    clearMaintenanceToken();
  }
}

function buildMaintenanceHeaders(init: RequestInit | undefined, token: string | null): Record<string, string> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function maintenanceRawFetch(
  path: string,
  init?: RequestInit,
  token?: string | null,
): Promise<Response> {
  const firstToken = token ?? getMaintenanceToken();
  let res = await rawFetch(path, {
    ...init,
    headers: buildMaintenanceHeaders(init, firstToken),
  });
  if (res.status !== 401) return res;

  const refreshedToken = await refreshMaintenanceAccessToken();
  if (!refreshedToken) return res;

  res = await rawFetch(path, {
    ...init,
    headers: buildMaintenanceHeaders(init, refreshedToken),
  });
  return res;
}

/** 知识库管理 API：携带检修域 JWT，供可见范围 ACL 使用 */
export async function knowledgeJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await maintenanceRawFetch(path, init);
  } catch (error) {
    throw normalizeMaintenanceNetworkError(error);
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  } catch {
    json = {};
  }
  if (!res.ok) {
    if (res.status === 401) {
      clearMaintenanceToken();
      notifyMaintenanceAuthExpired();
      throw new Error(MAINTENANCE_AUTH_EXPIRED_MESSAGE);
    }
    throw new Error(extractApiErrorMessage(json, text, res.status));
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** 检修域标准响应包：{ success, data, message } */
export async function maintenanceJson<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  let res: Response;
  try {
    res = await maintenanceRawFetch(path, init, token);
  } catch (error) {
    throw normalizeMaintenanceNetworkError(error);
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  } catch {
    json = {};
  }
  if (!res.ok) {
    if (res.status === 401) {
      clearMaintenanceToken();
      notifyMaintenanceAuthExpired();
      throw new Error(MAINTENANCE_AUTH_EXPIRED_MESSAGE);
    }
    const detail = json.detail;
    const nestedDetailMessage =
      detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string"
        ? detail.message
        : null;
    const msg =
      (typeof json.message === "string" ? json.message : null) ||
      nestedDetailMessage ||
      (typeof detail === "string" ? detail : null) ||
      text.slice(0, 200);
    throw new Error(msg || String(res.status));
  }
  if (json && json.success === false) {
    throw new Error(typeof json.message === "string" ? json.message : "业务请求失败");
  }
  return (json?.data !== undefined ? json.data : json) as T;
}

export function isMaintenanceAuthExpiredError(error: unknown): boolean {
  return error instanceof Error && error.message === MAINTENANCE_AUTH_EXPIRED_MESSAGE;
}

// —— 通用只读 ——

export async function fetchHealth() {
  return apiJson<{
    status: string;
    database: string;
    redis?: { status: string; backend: string; enabled: boolean; available: boolean };
  }>("/health");
}

export async function fetchSystemMetrics() {
  return apiJson<Record<string, unknown>>("/api/v1/system/metrics");
}

export async function fetchWorkbenchOverview() {
  return apiJson<WorkbenchOverview>("/api/v1/workbench/overview");
}

export async function fetchMaintenanceHistory(params?: { limit?: number; status?: string }) {
  const sp = new URLSearchParams();
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.status) sp.set("status", params.status);
  const q = sp.toString();
  return apiJson<MaintenanceTaskHistoryResponse>(`/api/v1/history${q ? `?${q}` : ""}`);
}

export async function fetchCasesList(params?: { limit?: number; status?: string }) {
  const sp = new URLSearchParams();
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.status) sp.set("status", params.status);
  const q = sp.toString();
  return maintenanceJson<MaintenanceCaseListResponse>(`/api/v1/cases${q ? `?${q}` : ""}`);
}

export async function fetchCaseDetail(caseId: number) {
  return maintenanceJson<MaintenanceCaseDetail>(`/api/v1/cases/${caseId}`);
}

export async function deleteMaintenanceCase(caseId: number): Promise<void> {
  await maintenanceJson<null>(`/api/v1/cases/${caseId}`, { method: "DELETE" });
}

/** 与后端 `MaintenanceCaseCreate` 对齐；须至少填写「处理步骤」或「处理结果总结」之一 */
export interface MaintenanceCaseCreatePayload {
  title: string;
  equipment_type: string;
  symptom_description: string;
  processing_steps?: string[];
  resolution_summary?: string | null;
  equipment_model?: string | null;
  fault_type?: string | null;
  work_order_id?: string | null;
  asset_code?: string | null;
  report_source?: string | null;
  priority?: "low" | "medium" | "high" | "urgent" | null;
  task_id?: number | null;
  attachment_name?: string | null;
  attachment_url?: string | null;
  knowledge_refs?: unknown[];
}

export async function createMaintenanceCase(body: MaintenanceCaseCreatePayload) {
  return maintenanceJson<MaintenanceCaseDetail>(`/api/v1/cases`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchTaskDetail(taskId: number) {
  return apiJson<MaintenanceTaskDetail>(`/api/v1/tasks/${taskId}`);
}

export async function fetchTaskExport(taskId: number) {
  return apiJson<MaintenanceTaskExportPayload>(`/api/v1/export/${taskId}`);
}

export async function retryMaintenanceTask(taskId: number) {
  return apiJson<MaintenanceTaskDetail>(`/api/v1/tasks/${taskId}/retry`, {
    method: "POST",
  });
}

export async function saveMaintenanceTaskExecutionTimeline(
  taskId: number,
  events: Array<{ id: string; type: string; title: string; description: string; time: string }>,
  diagnosis_report?: string | null,
): Promise<void> {
  const res = await rawFetch(`/api/v1/tasks/${taskId}/execution-timeline`, {
    method: "PATCH",
    body: JSON.stringify({ events, diagnosis_report: diagnosis_report ?? null }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.slice(0, 200) || String(res.status));
  }
}

/** 在浏览器中触发 JSON 文件下载（供「导出记录」等入口使用） */
export function downloadJsonInBrowser(filename: string, data: unknown) {
  if (typeof window === "undefined") return;
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.click();
  URL.revokeObjectURL(url);
}

export async function createMaintenanceTask(body: Record<string, unknown>) {
  return apiJson<MaintenanceTaskDetail>("/api/v1/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteMaintenanceTask(taskId: number): Promise<void> {
  const res = await rawFetch(`/api/v1/tasks/${taskId}`, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.slice(0, 200) || String(res.status));
  }
}

/** Agent 协作同步接口返回（前端仅强类型消费常用字段） */
export interface AgentGraphTraceEvent {
  event_type: string;
  stage_name: string;
  status?: string | null;
  summary: string;
  iteration?: number | null;
  payload?: Record<string, unknown>;
  verdict?: string | null;
  target_stage?: string | null;
  issues?: string[];
  action?: string | null;
  reason?: string | null;
}

export interface AgentCritiqueItem {
  stage_name: string;
  verdict: string;
  target_stage?: string | null;
  summary: string;
  issues: string[];
}

export interface AgentReplanItem {
  action: string;
  target_stage?: string | null;
  reason: string;
}

export interface AgentCurrentPlanItem {
  stage_name: string;
  iteration: number;
  reason: string;
  status: string;
  metadata?: Record<string, unknown>;
}

export interface AgentFinalResolution {
  status: string;
  reason: string;
  manual_review_required?: boolean;
}

export interface AgentAssistResponse {
  run_id: string;
  status: string;
  summary: string;
  diagnosis_report?: string | null;
  diagnosis_structured?: {
    answer_mode?: "diagnosis" | "procedure";
    most_likely_fault: string;
    risk_level: string;
    confidence: number;
    main_symptoms: string[];
    preliminary_conclusion: string;
    next_steps: Array<
      | string
        | {
          step_no?: number | null;
          title: string;
          summary?: string;
          sections?: Array<{
            label: string;
            items: string[];
          }>;
          meta?: string[];
          raw_text?: string | null;
          action?: string | null;
          object?: string | null;
          headline?: string | null;
          detail?: string | null;
        }
    >;
    root_causes: Array<{ name: string; confidence: number; evidence: string }>;
    evidence_items: Array<{
      document_title: string;
      section?: string | null;
      excerpt?: string | null;
      source_name?: string | null;
      relevance_score?: number | null;
    }>;
    evidence_count: number;
    top_similarity?: number | null;
    work_order_ready: boolean;
  } | null;
  effective_query?: string | null;
  effective_keywords?: string[];
  image_analysis?: {
    summary: string;
    keywords: string[];
    source: string;
    warning?: string | null;
  } | null;
  grounded?: boolean;
  coverage_warnings?: string[];
  knowledge_results?: Array<{
    chunk_id: number;
    document_id: number;
    title: string;
    source_name: string;
    excerpt: string;
    section_reference?: string | null;
    section_path?: string | null;
    page_reference?: string | null;
    source_modality?: string | null;
    ocr_text?: string | null;
    image_caption?: string | null;
    evidence_summary?: string | null;
  }>;
  graph_trace?: AgentGraphTraceEvent[];
  critiques?: AgentCritiqueItem[];
  replans?: AgentReplanItem[];
  current_plan?: AgentCurrentPlanItem[];
  revision_rounds?: number;
  termination_reason?: string | null;
  final_resolution?: AgentFinalResolution | null;
}

export interface KnowledgeReasoningEntity {
  id: number;
  entity_type: string;
  canonical_name: string;
  match_type?: string | null;
  match_score?: number | null;
}

export interface KnowledgeReasoningRelation {
  id: number;
  relation_type: string;
  source_entity_id: number;
  source_name: string;
  target_entity_id: number;
  target_name: string;
  confidence?: number | null;
  evidence_chunk_ids: number[];
}

export interface KnowledgeReasoningEvidenceChunk {
  chunk_id: number;
  document_id: number;
  title: string;
  source_name: string;
  citation_label?: string | null;
  section_reference?: string | null;
  page_reference?: string | null;
  excerpt: string;
  score?: number | null;
}

export interface KnowledgeReasoningChain {
  question?: string | null;
  matched_entities: KnowledgeReasoningEntity[];
  expanded_relations: KnowledgeReasoningRelation[];
  evidence_chunks: KnowledgeReasoningEvidenceChunk[];
  selected_answer_claims: string[];
  confidence: number;
  warnings: string[];
  explanation_text?: string | null;
}

export async function postAgentAssist(body: Record<string, unknown>) {
  return apiJson<AgentAssistResponse>("/api/v1/agents/assist", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchKnowledgeBases(limit = 50) {
  return knowledgeJson<KnowledgeBaseListResponse>(`/api/v1/knowledge/bases?limit=${limit}`);
}

export async function fetchKnowledgeBaseDetail(baseId: number) {
  return knowledgeJson<KnowledgeBaseSummary>(`/api/v1/knowledge/bases/${baseId}`);
}

export async function createKnowledgeBase(payload: KnowledgeBaseCreatePayload) {
  return knowledgeJson<KnowledgeBaseSummary>("/api/v1/knowledge/bases", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateKnowledgeBase(
  baseId: number,
  payload: KnowledgeBaseUpdatePayload,
) {
  return knowledgeJson<KnowledgeBaseSummary>(`/api/v1/knowledge/bases/${baseId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function fetchKnowledgeCategories(knowledgeBaseId: number) {
  return knowledgeJson<KnowledgeCategoryListResponse>(
    `/api/v1/knowledge/categories?knowledge_base_id=${knowledgeBaseId}`,
  );
}

export async function fetchKnowledgeImports(
  limit = 8,
  knowledgeBaseId?: number,
) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (knowledgeBaseId != null && Number.isFinite(knowledgeBaseId)) {
    query.set("knowledge_base_id", String(knowledgeBaseId));
  }
  return knowledgeJson<KnowledgeImportListResponse>(
    `/api/v1/knowledge/imports?${query.toString()}`,
  );
}

export async function fetchKnowledgeDocuments(limit = 20, knowledgeBaseId?: number) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (knowledgeBaseId != null && Number.isFinite(knowledgeBaseId)) {
    query.set("knowledge_base_id", String(knowledgeBaseId));
  }
  return knowledgeJson<KnowledgeDocumentListResponse>(
    `/api/v1/knowledge/documents?${query.toString()}`,
  );
}

export async function fetchKnowledgeDocumentDetail(documentId: number) {
  return knowledgeJson<KnowledgeDocumentDetail>(`/api/v1/knowledge/documents/${documentId}`);
}

export async function fetchKnowledgeDocumentChunks(
  documentId: number,
  limit = 8,
  focusChunkId?: number,
) {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const query = new URLSearchParams({ limit: String(safeLimit) });
  if (focusChunkId != null && Number.isFinite(focusChunkId)) {
    query.set("focus_chunk_id", String(focusChunkId));
  }
  return knowledgeJson<KnowledgeChunkPreviewResponse>(
    `/api/v1/knowledge/documents/${documentId}/chunks?${query.toString()}`,
  );
}

export async function deleteKnowledgeDocument(documentId: number) {
  return knowledgeJson<{ success: boolean; message: string }>(
    `/api/v1/knowledge/documents/${documentId}`,
    {
      method: "DELETE",
    },
  );
}

export async function deleteKnowledgeImportJob(jobId: number) {
  return knowledgeJson<{ success: boolean; message: string }>(
    `/api/v1/knowledge/imports/${jobId}`,
    {
      method: "DELETE",
    },
  );
}

export interface KnowledgeBaseSummary {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  type?: string;
  visibility?: string;
  owner_id?: number | null;
  document_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface KnowledgeBaseListResponse {
  total: number;
  bases: KnowledgeBaseSummary[];
}

export interface KnowledgeBaseCreatePayload {
  name: string;
  description?: string;
  type?: string;
  visibility?: string;
}

export interface KnowledgeBaseUpdatePayload {
  name?: string;
  description?: string;
  type?: string;
  visibility?: string;
}

export interface KnowledgeCategoryStat {
  id: string;
  name: string;
  count: number;
}

export interface KnowledgeCategoryListResponse {
  knowledge_base_id: number;
  total: number;
  categories: KnowledgeCategoryStat[];
}

export interface KnowledgeImportUploadPayload {
  file: File;
  knowledge_base_id: number;
  equipment_type: string;
  title?: string;
  equipment_model?: string;
  fault_type?: string;
  section_reference?: string;
  source_type?: string;
  replace_existing?: boolean;
  batch_id?: string;
}

export async function importKnowledgeDocument(payload: KnowledgeImportUploadPayload) {
  const form = new FormData();
  form.append("file", payload.file);
  form.append("knowledge_base_id", String(payload.knowledge_base_id));
  form.append("equipment_type", payload.equipment_type);
  if (payload.title) form.append("title", payload.title);
  if (payload.equipment_model) form.append("equipment_model", payload.equipment_model);
  if (payload.fault_type) form.append("fault_type", payload.fault_type);
  if (payload.section_reference) form.append("section_reference", payload.section_reference);
  form.append("source_type", payload.source_type ?? "manual");
  form.append("replace_existing", String(Boolean(payload.replace_existing)));
  if (payload.batch_id) form.append("batch_id", payload.batch_id);
  return knowledgeJson<KnowledgeImportJob>("/api/v1/knowledge/imports", {
    method: "POST",
    body: form,
  });
}

export async function fetchKnowledgeImportJob(jobId: number) {
  return knowledgeJson<KnowledgeImportJob>(`/api/v1/knowledge/imports/${jobId}`);
}

export async function fetchKnowledgeImportJobsByBatch(batchId: string, limit = 50) {
  return knowledgeJson<KnowledgeImportListResponse>(
    `/api/v1/knowledge/imports?batch_id=${encodeURIComponent(batchId)}&limit=${limit}`,
  );
}

export async function retryKnowledgeImportJob(jobId: number) {
  return knowledgeJson<KnowledgeImportJob>(`/api/v1/knowledge/imports/${jobId}/retry`, {
    method: "POST",
  });
}

export type MaintenanceCaptcha = {
  captchaId: string;
  image: string;
  expiresIn?: number;
};

/** 获取图形验证码 */
export async function maintenanceFetchCaptcha(): Promise<MaintenanceCaptcha> {
  const res = await rawFetch("/api/auth/captcha");
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(json?.message || text.slice(0, 200) || String(res.status));
  }
  const data = json?.data ?? json;
  if (!data?.captchaId || !data?.image) {
    throw new Error("验证码响应不完整");
  }
  return data as MaintenanceCaptcha;
}

export class MaintenanceAuthError extends Error {
  businessCode?: string;
  retryAfterSeconds?: number;

  constructor(message: string, businessCode?: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "MaintenanceAuthError";
    this.businessCode = businessCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** 登录：返回 data 中的 access_token */
export async function maintenanceLogin(
  account: string,
  password: string,
  captcha: { captchaId: string; captchaCode: string },
  rememberMe = false,
) {
  const res = await rawFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      account,
      password,
      captcha_id: captcha.captchaId,
      captcha_code: captcha.captchaCode,
      remember_me: rememberMe,
    }),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message = (typeof json?.message === "string" ? json.message : null) || text.slice(0, 200) || String(res.status);
    const businessCode = typeof json?.business_code === "string" ? json.business_code : undefined;
    const retryRaw = json?.data?.retry_after_seconds;
    const retryAfterSeconds = typeof retryRaw === "number" ? retryRaw : undefined;
    if (businessCode === "ACCOUNT_LOCKED") {
      throw new MaintenanceAuthError(message, businessCode, retryAfterSeconds ?? 60);
    }
    throw new Error(message);
  }
  const data = json?.data ?? json;
  if (!data?.access_token) throw new Error("登录响应缺少 access_token");
  return data as {
    access_token: string;
    token_type: string;
    expires_in?: number;
    refresh_expires_in?: number;
    user: MaintenanceUser;
  };
}

export type MaintenanceRequestedRole = "inspector" | "maintainer" | "engineer";

export interface MaintenanceRegisterPayload {
  username: string;
  real_name: string;
  phone?: string;
  email?: string;
  department: string;
  requested_role: MaintenanceRequestedRole;
  password: string;
  confirm_password: string;
  email_code?: string;
}

export async function maintenanceRegister(
  payload: MaintenanceRegisterPayload,
  captcha: { captchaId: string; captchaCode: string },
) {
  const res = await rawFetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      captcha_id: captcha.captchaId,
      captcha_code: captcha.captchaCode,
    }),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(json?.message || text.slice(0, 200) || String(res.status));
  }
  return (json?.data ?? json) as {
    id: number;
    username: string;
    display_name: string;
    status: "pending" | "active" | "disabled" | "locked";
    roles: MaintenanceRole[];
  };
}

export interface MaintenancePasswordResetRequestPayload {
  account: string;
}

export async function maintenanceRequestPasswordReset(
  payload: MaintenancePasswordResetRequestPayload,
  captcha: { captchaId: string; captchaCode: string },
) {
  const res = await rawFetch("/api/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      captcha_id: captcha.captchaId,
      captcha_code: captcha.captchaCode,
    }),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(json?.message || text.slice(0, 200) || String(res.status));
  }
  return (json?.data ?? json) as {
    message: string;
    masked_email?: string;
    need_admin_reset?: boolean;
    expires_in?: number;
  };
}

export const maintenanceForgotPassword = maintenanceRequestPasswordReset;

export async function maintenanceConfirmPasswordReset(body: {
  account: string;
  email_code: string;
  new_password: string;
  confirm_password: string;
}) {
  const res = await rawFetch("/api/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(json?.message || text.slice(0, 200) || String(res.status));
  }
  return (json?.data ?? json) as { message: string };
}

export async function maintenanceSendEmailCode(body: {
  email: string;
  scene: "register" | "reset_password" | "bind_email";
  captchaId?: string;
  captchaCode?: string;
}) {
  const res = await rawFetch("/api/auth/email-code/send", {
    method: "POST",
    body: JSON.stringify({
      email: body.email,
      scene: body.scene,
      captcha_id: body.captchaId,
      captcha_code: body.captchaCode,
    }),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const retryRaw = json?.data?.retry_after_seconds;
    const error = new MaintenanceAuthError(
      json?.message || text.slice(0, 200) || String(res.status),
      json?.business_code,
      typeof retryRaw === "number" ? retryRaw : undefined,
    );
    throw error;
  }
  return (json?.data ?? json) as { expires_in: number };
}

export async function maintenanceSendSmsCode(body: {
  phone: string;
  scene: "register" | "reset_password" | "bind_phone";
  captchaId?: string;
  captchaCode?: string;
}) {
  const res = await rawFetch("/api/auth/sms-code/send", {
    method: "POST",
    body: JSON.stringify({
      phone: body.phone,
      scene: body.scene,
      captcha_id: body.captchaId,
      captcha_code: body.captchaCode,
    }),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(json?.message || text.slice(0, 200) || String(res.status));
  }
  return (json?.data ?? json) as { expires_in: number };
}

export type MaintenanceRole =
  | "worker"
  | "expert"
  | "safety"
  | "admin"
  | "inspector"
  | "maintainer"
  | "engineer";

export interface MaintenanceUser {
  id: number;
  username: string;
  display_name: string;
  real_name?: string | null;
  status?: "pending" | "active" | "disabled" | "locked";
  roles: MaintenanceRole[];
}

export type WorkOrderAssignee = MaintenanceUser;

export interface MaintenanceNotificationItem {
  id: number;
  kind: string;
  title: string;
  detail: string;
  link_url?: string | null;
  read: boolean;
  created_at: string;
  updated_at: string;
}

export async function fetchMaintenanceMe(token: string | null) {
  return maintenanceJson<MaintenanceUser>("/api/v1/maintenance/auth/me", {}, token);
}

export async function listMaintenanceNotifications(token: string | null, limit = 20) {
  return maintenanceJson<{ items: MaintenanceNotificationItem[]; unread_count: number }>(
    `/api/v1/maintenance/notifications?limit=${limit}`,
    {},
    token,
  );
}

export async function markMaintenanceNotificationRead(token: string | null, notificationId: number) {
  return maintenanceJson<MaintenanceNotificationItem>(
    `/api/v1/maintenance/notifications/${notificationId}/read`,
    { method: "PATCH" },
    token,
  );
}

export async function markAllMaintenanceNotificationsRead(token: string | null) {
  return maintenanceJson<{ success: boolean }>(
    "/api/v1/maintenance/notifications/read-all",
    { method: "POST" },
    token,
  );
}

export async function listWorkOrders(
  token: string | null,
  page = 1,
  status?: string,
  options?: {
    assignmentRole?: "worker" | "expert" | "safety";
    assignmentState?: "assigned" | "unassigned" | "mine";
  },
) {
  const sp = new URLSearchParams({ page: String(page), page_size: "50" });
  if (status) sp.set("status", status);
  if (options?.assignmentRole) sp.set("assignment_role", options.assignmentRole);
  if (options?.assignmentState) sp.set("assignment_state", options.assignmentState);
  return maintenanceJson<WorkOrderListPayload>(`/api/v1/maintenance/work-orders?${sp.toString()}`, {}, token);
}

export interface MaintenanceWorkOrderCreatePayload {
  device_id: number;
  maintenance_level?: MaintenanceLevelOption;
  source_task_id?: number;
}

export async function createWorkOrder(
  token: string | null,
  body: MaintenanceWorkOrderCreatePayload,
) {
  return maintenanceJson<{ id: number; [key: string]: unknown }>(
    "/api/v1/maintenance/work-orders",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    token,
  );
}

export interface WorkOrderDetailPayload extends WorkOrderItem {
  step_progress_json?: Record<string, unknown> | null;
  source_task?: {
    task_id: number;
    title?: string | null;
    diagnosis_report?: string | null;
    advice_card?: string | null;
    status?: string | null;
  } | null;
  device?: {
    id: number;
    asset_code?: string | null;
    model?: string | null;
    device_type?: string | null;
  };
  flow_template?: {
    id: number;
    name: string;
    steps_json: unknown;
  };
}

export interface WorkOrderEventItem {
  id: number;
  from_status?: string | null;
  to_status: string;
  event_type: string;
  payload?: Record<string, unknown> | null;
  actor_user_id?: number | null;
  created_at: string;
}

export interface WorkOrderMessageItem {
  id: number;
  role: string;
  content: string;
  retrieval_snapshot_id?: number | null;
  attachment_ids?: number[] | null;
  created_at: string;
}

export async function fetchWorkOrderDetail(token: string | null, workOrderId: number) {
  return maintenanceJson<WorkOrderDetailPayload>(`/api/v1/maintenance/work-orders/${workOrderId}`, {}, token);
}

export async function fetchWorkOrderAssignmentCandidates(
  token: string | null,
  role?: "worker" | "expert" | "safety",
) {
  const sp = new URLSearchParams();
  if (role) sp.set("role", role);
  return maintenanceJson<{ items: WorkOrderAssignee[] }>(
    `/api/v1/maintenance/work-orders/assignment-candidates${sp.toString() ? `?${sp.toString()}` : ""}`,
    {},
    token,
  );
}

export interface WorkOrderAssignmentUpdatePayload {
  assigned_worker_user_id?: number | null;
  assigned_expert_user_id?: number | null;
  assigned_safety_user_id?: number | null;
  current_owner_user_id?: number | null;
}

export async function updateWorkOrderAssignment(
  token: string | null,
  workOrderId: number,
  body: WorkOrderAssignmentUpdatePayload,
) {
  return maintenanceJson<WorkOrderDetailPayload>(
    `/api/v1/maintenance/work-orders/${workOrderId}/assignment`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
    token,
  );
}

export async function fetchWorkOrderEvents(token: string | null, workOrderId: number) {
  return maintenanceJson<{ items: WorkOrderEventItem[]; total: number; page: number; page_size: number }>(
    `/api/v1/maintenance/work-orders/${workOrderId}/events`,
    {},
    token,
  );
}

export async function fetchWorkOrderMessages(token: string | null, workOrderId: number, page = 1, pageSize = 50) {
  const sp = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  return maintenanceJson<{ items: WorkOrderMessageItem[]; total: number; page: number; page_size: number }>(
    `/api/v1/maintenance/work-orders/${workOrderId}/messages?${sp.toString()}`,
    {},
    token,
  );
}

export async function postWorkOrderMessage(
  token: string | null,
  workOrderId: number,
  body: { content: string; attachment_ids?: number[] },
) {
  return maintenanceJson<{ id: number; created_at: string }>(
    `/api/v1/maintenance/work-orders/${workOrderId}/messages`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    token,
  );
}

export async function enterWorkOrderMaintenance(token: string | null, workOrderId: number) {
  return maintenanceJson<Record<string, unknown>>(
    `/api/v1/maintenance/work-orders/${workOrderId}/actions/enter-maintenance`,
    { method: "POST" },
    token,
  );
}

export async function acceptWorkOrder(token: string | null, workOrderId: number) {
  return maintenanceJson<Record<string, unknown>>(
    `/api/v1/maintenance/work-orders/${workOrderId}/actions/accept`,
    { method: "POST" },
    token,
  );
}

export async function completeWorkOrderMaintenance(token: string | null, workOrderId: number) {
  return maintenanceJson<Record<string, unknown>>(
    `/api/v1/maintenance/work-orders/${workOrderId}/actions/complete-maintenance`,
    { method: "POST" },
    token,
  );
}

export async function acceptWorkOrderFillReview(token: string | null, workOrderId: number) {
  return maintenanceJson<Record<string, unknown>>(
    `/api/v1/maintenance/work-orders/${workOrderId}/actions/accept-fill-review`,
    { method: "POST" },
    token,
  );
}

export async function suspendWorkOrder(token: string | null, workOrderId: number, reason: string) {
  return maintenanceJson<Record<string, unknown>>(
    `/api/v1/maintenance/work-orders/${workOrderId}/actions/suspend`,
    { method: "POST", body: JSON.stringify({ reason }) },
    token,
  );
}

export async function resumeWorkOrder(token: string | null, workOrderId: number) {
  return maintenanceJson<Record<string, unknown>>(
    `/api/v1/maintenance/work-orders/${workOrderId}/actions/resume`,
    { method: "POST" },
    token,
  );
}

export interface WorkOrderEscalationPayload {
  escalation_note: string;
  related_message_id?: number | null;
  attachment_ids?: number[] | null;
}

export async function createWorkOrderEscalation(
  token: string | null,
  workOrderId: number,
  body: WorkOrderEscalationPayload,
) {
  return maintenanceJson<Record<string, unknown>>(
    `/api/v1/maintenance/work-orders/${workOrderId}/escalations`,
    { method: "POST", body: JSON.stringify(body) },
    token,
  );
}

export interface MaintenanceAttachmentUploadPayload {
  file: File;
  biz_type: string;
  work_order_id?: number | null;
}

export interface MaintenanceAttachmentItem {
  id: number;
  work_order_id?: number | null;
  biz_type: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  created_at?: string | null;
}

export async function uploadMaintenanceAttachment(
  token: string | null,
  payload: MaintenanceAttachmentUploadPayload,
) {
  const form = new FormData();
  form.append("file", payload.file);
  form.append("biz_type", payload.biz_type);
  if (payload.work_order_id != null) {
    form.append("work_order_id", String(payload.work_order_id));
  }
  return maintenanceJson<MaintenanceAttachmentItem>(
    "/api/v1/maintenance/attachments",
    {
      method: "POST",
      body: form,
    },
    token,
  );
}

export interface WorkOrderFillingPayload {
  resolution_status: "resolved" | "unresolved";
  closure_code: "NORMAL" | "PART_REPLACED" | "ADJUSTED" | "OTHER" | "UNRESOLVED";
  attachment_ids: number[];
  detail_notes?: string | null;
  post_unresolved_action?: "REOPEN_ESCALATION" | "RETRY_RETRIEVAL" | "CLOSE_UNRESOLVED" | null;
  unresolved_reason_code?: "EQUIPMENT_LIMIT" | "INFO_INSUFFICIENT" | "EXPERT_REQUIRED" | "USER_ABORT" | "OTHER" | null;
}

export async function submitWorkOrderFilling(
  token: string | null,
  workOrderId: number,
  body: WorkOrderFillingPayload,
) {
  return maintenanceJson<{ work_order: Record<string, unknown>; filling_id: number }>(
    `/api/v1/maintenance/work-orders/${workOrderId}/fillings`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    token,
  );
}

export async function confirmWorkOrderStep(
  token: string | null,
  workOrderId: number,
  body: { step_no: number; mark_done: true; note?: string },
) {
  return maintenanceJson<Record<string, unknown>>(
    `/api/v1/maintenance/work-orders/${workOrderId}/steps/confirm`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    token,
  );
}

export async function runWorkOrderRetrieval(
  token: string | null,
  workOrderId: number,
  body: { query_text?: string; maintenance_level?: string | null; attachment_ids?: number[] },
) {
  return maintenanceJson<{
    retrieval_snapshot_id: number;
    message_id: number;
    suggested_reply: string;
    grounded?: boolean;
    coverage_warnings?: string[];
    citations: Array<{
      citation_label: string;
      chunk_id: number;
      source_document: string;
      section_reference?: string | null;
      page_reference?: string | null;
      excerpt?: string | null;
    }>;
    work_order: WorkOrderItem;
  }>(
    `/api/v1/maintenance/work-orders/${workOrderId}/retrieval`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    token,
  );
}

export async function deleteWorkOrder(token: string | null, workOrderId: number): Promise<void> {
  let res: Response;
  try {
    res = await maintenanceRawFetch(
      `/api/v1/maintenance/work-orders/${workOrderId}`,
      { method: "DELETE" },
      token,
    );
  } catch (error) {
    throw normalizeMaintenanceNetworkError(error);
  }
  if (!res.ok) {
    if (res.status === 401) {
      clearMaintenanceToken();
      notifyMaintenanceAuthExpired();
      throw new Error(MAINTENANCE_AUTH_EXPIRED_MESSAGE);
    }
    const text = await res.text();
    let message = text.slice(0, 200);
    try {
      const json = text ? JSON.parse(text) : {};
      message =
        json?.message ||
        json?.detail?.message ||
        (typeof json?.detail === "string" ? json.detail : null) ||
        message;
    } catch {}
    throw new Error(message || String(res.status));
  }
}

export interface MaintenanceDeviceItem {
  id: number;
  device_type: string;
  model: string;
  asset_code: string;
  location?: string | null;
}

export async function listMaintenanceDevices(token: string | null, page = 1) {
  const sp = new URLSearchParams({ page: String(page), page_size: "50" });
  return maintenanceJson<{ items: MaintenanceDeviceItem[]; total: number; page: number; page_size: number }>(
    `/api/v1/maintenance/devices?${sp.toString()}`,
    {},
    token,
  );
}

export interface MaintenanceDeviceCreatePayload {
  device_type: string;
  model: string;
  asset_code?: string | null;
  location?: string | null;
  responsibility_expert_user_id?: number | null;
}

export async function createMaintenanceDevice(
  token: string | null,
  body: MaintenanceDeviceCreatePayload,
) {
  return maintenanceJson<MaintenanceDeviceItem>(
    "/api/v1/maintenance/devices",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    token,
  );
}

export async function fetchMaintenanceHealth() {
  return maintenanceJson<Record<string, unknown>>("/api/v1/maintenance/health", {}, null);
}

export interface MaintenanceSystemConfigItem {
  key: string;
  value_type: string;
  reload_policy: string;
  is_sensitive: boolean;
  updated_at: string;
  value?: string;
  value_masked?: string;
}

export async function listMaintenanceSystemConfigs(token: string | null) {
  return maintenanceJson<{ items: MaintenanceSystemConfigItem[]; total: number; page: number; page_size: number }>(
    "/api/v1/maintenance/admin/system-configs",
    {},
    token,
  );
}

export async function patchMaintenanceSystemConfig(token: string | null, key: string, value: string) {
  return maintenanceJson<MaintenanceSystemConfigItem>(
    `/api/v1/maintenance/admin/system-configs/${encodeURIComponent(key)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ value }),
    },
    token,
  );
}

export interface MaintenanceModelConnectivityDraft {
  provider: string;
  chat_model: string;
  vision_model: string;
  embedding_model: string;
  reranker_model: string;
  api_base: string;
  temperature: number;
  max_tokens: number;
}

export interface MaintenanceModelConnectivityLane {
  status: "success" | "failure";
  detail: string;
  tested_model: string;
  timestamp: string;
}

export interface MaintenanceModelConnectivityResult {
  overall_status: "success" | "failure";
  provider: string;
  api_base: string;
  credential_status: string;
  tested_at: string;
  results: {
    chat: MaintenanceModelConnectivityLane;
    vision: MaintenanceModelConnectivityLane;
    embedding: MaintenanceModelConnectivityLane;
    reranker: MaintenanceModelConnectivityLane;
  };
}

export async function runMaintenanceModelConnectivityCheck(
  token: string | null,
  body: MaintenanceModelConnectivityDraft,
) {
  return maintenanceJson<MaintenanceModelConnectivityResult>(
    "/api/v1/maintenance/admin/checks/model-connectivity",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    token,
  );
}

export interface SettingsOverviewResponse {
  knowledge_summary: {
    document_count: number;
    import_job_count: number;
    published_article_count: number;
    retrieval_enabled_count: number;
    last_updated_at: string | null;
  };
  rag_summary: {
    vector_store_backend: string;
    embedding_model: string;
    enable_reranker: boolean;
    reranker_model: string;
    reranker_top_k: number;
    enable_search_cache: boolean;
  };
  workflow_summary: {
    published_flow_template_count: number;
    device_type_count: number;
    default_stages: string[];
  };
  agent_summary?: {
    pipeline_mode: string;
    default_order: string[];
    fail_strategy: string;
    review_gate: boolean;
    knowledge_writeback: string;
    last_run_id: string | null;
    last_run_status: string | null;
    last_run_at: string | null;
    degradation_count: number;
    agents: Array<{
      agent_name: string;
      enabled: boolean;
      model_provider: string;
      model_name: string;
      timeout_ms: number;
      max_retries: number;
      toolset: string[];
      fallback_agent: string | null;
      last_status: string | null;
      last_summary: string | null;
      last_run_at: string | null;
    }>;
  } | null;
  audit_summary: {
    recent_count: number;
    latest_items: Array<{
      id: number;
      action: string;
      resource_type: string;
      resource_id: string;
      actor_user_id: number | null;
      created_at: string;
    }>;
  };
}

export async function fetchMaintenanceSettingsOverview(token: string | null) {
  return maintenanceJson<SettingsOverviewResponse>("/api/v1/maintenance/admin/settings-overview", {}, token);
}

/** 顶栏图标等：轻量确认后端可达 */
export async function pingBackendReadiness() {
  await apiJson<{
    status: string;
    database: string;
    redis?: { status: string; backend: string; enabled: boolean; available: boolean };
  }>("/ready");
}

// —— 类型（仅前端消费字段） ——

export interface WorkbenchOverview {
  generated_at: string;
  stats: { key: string; label: string; value: number; accent: string }[];
  featured_queries: string[];
  agent_capabilities: string[];
  recommended_knowledge_count: number;
  recommended_knowledge: WorkbenchRecommendedKnowledge[];
  recent_tasks: WorkbenchTaskSummary[];
  recent_cases: WorkbenchCaseSummary[];
}

export interface WorkbenchRecommendedKnowledge {
  chunk_id: number | null;
  document_id: number | null;
  title: string;
  source_name: string | null;
  section_reference: string | null;
  page_reference: string | null;
  excerpt: string | null;
}

export interface WorkbenchTaskSummary {
  id: number;
  title: string;
  work_order_id: string | null;
  asset_code: string | null;
  equipment_type: string;
  equipment_model: string | null;
  maintenance_level: string;
  status: string;
  total_steps: number;
  completed_steps: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface WorkbenchCaseSummary {
  id: number;
  title: string;
  status: string;
  equipment_type: string;
  updated_at: string | null;
}

export interface MaintenanceTaskHistoryResponse {
  total: number;
  tasks: MaintenanceTaskHistoryItem[];
}

export interface MaintenanceTaskHistoryItem {
  id: number;
  title: string;
  equipment_type: string;
  equipment_model: string | null;
  status: string;
  maintenance_level: string;
  workflow_total: number;
  workflow_completed: number;
  total_steps: number;
  completed_steps: number;
  created_at: string | null;
  updated_at: string | null;
  run_started_at?: string | null;
  run_finished_at?: string | null;
}

export interface MaintenanceTaskDetail {
  id: number;
  title: string;
  work_order_id?: string | null;
  asset_code?: string | null;
  report_source?: string | null;
  priority?: string | null;
  equipment_type: string;
  equipment_model: string | null;
  maintenance_level: string;
  fault_type: string | null;
  symptom_description: string | null;
  status: string;
  execution_timeline?: Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    time: string;
    detail?: string | null;
  }>;
  workflow_stages?: Array<{
    key: string;
    title: string;
    done: boolean;
    active: boolean;
    helper: string;
  }>;
  workflow_total: number;
  workflow_completed: number;
  total_steps: number;
  completed_steps: number;
  advice_card: string | null;
  diagnosis_report?: string | null;
  diagnosis_structured?: {
    answer_mode?: "diagnosis" | "procedure";
    most_likely_fault: string;
    risk_level: string;
    confidence: number;
    main_symptoms: string[];
    preliminary_conclusion: string;
    next_steps: Array<
      | string
        | {
          step_no?: number | null;
          title: string;
          summary?: string;
          sections?: Array<{
            label: string;
            items: string[];
          }>;
          meta?: string[];
          raw_text?: string | null;
          action?: string | null;
          object?: string | null;
          headline?: string | null;
          detail?: string | null;
        }
    >;
    root_causes: Array<{ name: string; confidence: number; evidence: string }>;
    evidence_items: Array<{
      document_title: string;
      section?: string | null;
      excerpt?: string | null;
      source_name?: string | null;
      relevance_score?: number | null;
    }>;
    evidence_count: number;
    top_similarity?: number | null;
    work_order_ready: boolean;
  } | null;
  reasoning_chain?: KnowledgeReasoningChain | null;
  source_refs?: Array<{
    chunk_id: number;
    document_id: number;
    title: string;
    source_name: string;
    source_type?: string | null;
    equipment_type?: string;
    equipment_model?: string | null;
    fault_type?: string | null;
    section_reference?: string;
    section_path?: string;
    step_anchor?: string;
    page_reference?: string;
    image_anchor?: string;
    citation_label?: string;
    source_modality?: string | null;
    ocr_text?: string | null;
    image_caption?: string | null;
    evidence_summary?: string | null;
    expanded_content?: string | null;
    recommendation_reason?: string | null;
    graph_relation_type?: string | null;
    excerpt?: string;
    score?: number | null;
    retrieval_score?: number | null;
    rerank_score?: number | null;
    retrieval_path?: string[];
  }>;
  created_at: string | null;
  updated_at: string | null;
  run_started_at?: string | null;
  run_finished_at?: string | null;
  linked_work_order_id?: number | null;
  linked_case_id?: number | null;
  graph_trace?: AgentGraphTraceEvent[];
  critiques?: AgentCritiqueItem[];
  replans?: AgentReplanItem[];
  current_plan?: AgentCurrentPlanItem[];
  revision_rounds?: number;
  termination_reason?: string | null;
  final_resolution?: AgentFinalResolution | null;
  steps: Array<{
    id: number;
    step_order?: number;
    title: string;
    status: string;
    instruction?: string;
    confirmation_text?: string | null;
    risk_warning?: string | null;
    caution?: string | null;
    required_tools?: string[];
    required_materials?: string[];
    estimated_minutes?: number | null;
    started_at?: string | null;
    completed_at?: string | null;
    runtime_events?: Array<{
      id: string;
      type: string;
      title: string;
      description: string;
      time: string;
    }>;
    knowledge_refs?: Array<{
      chunk_id?: number;
      document_id?: number;
      title?: string;
      excerpt?: string;
    }>;
  }>;
}

export interface MaintenanceTaskExportPayload {
  task: MaintenanceTaskDetail;
  exported_at: string;
  export_summary: string;
}

export interface MaintenanceCaseListResponse {
  total: number;
  cases: MaintenanceCaseListItem[];
}

export interface MaintenanceCaseListItem {
  id: number;
  title: string;
  equipment_type: string;
  equipment_model?: string | null;
  fault_type?: string | null;
  report_source?: string | null;
  priority?: string | null;
  status: string;
  symptom_description: string;
  updated_at: string | null;
}

export interface MaintenanceCaseDetail {
  id: number;
  title: string;
  equipment_type: string;
  equipment_model: string | null;
  fault_type?: string | null;
  symptom_description: string;
  processing_steps: string[];
  resolution_summary: string | null;
  status: string;
  priority?: string | null;
  report_source?: string | null;
  work_order_id?: string | null;
  reviewer_name?: string | null;
  review_note?: string | null;
  reviewed_at?: string | null;
  knowledge_refs: Array<{ chunk_id?: number; document_id?: number; title?: string; source_name?: string; excerpt?: string; type?: string; id?: string | number }>;
  corrections?: Array<{
    id: number;
    correction_target: string;
    original_content: string | null;
    corrected_content: string;
    note: string | null;
    status: string;
    created_at: string;
  }>;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function reviewMaintenanceCase(
  caseId: number,
  body: { action: "approve" | "reject"; review_note?: string },
) {
  return maintenanceJson<MaintenanceCaseDetail>(`/api/v1/cases/${caseId}/review`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function addCaseCorrection(
  caseId: number,
  body: { correction_target: string; original_content?: string; corrected_content: string; note?: string },
) {
  return maintenanceJson<MaintenanceCaseDetail>(`/api/v1/cases/${caseId}/corrections`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface GraphNode {
  id: string;
  kind: string;
  label: string;
  properties: Record<string, unknown>;
}
export interface GraphEdge {
  id: number;
  source: string;
  target: string;
  relation_type: string;
  notes: string | null;
  created_at: string;
}
export interface GraphResponse { nodes: GraphNode[]; edges: GraphEdge[] }
export interface GraphStatsResponse {
  total_nodes: number;
  total_edges: number;
  nodes_by_kind: Record<string, number>;
  edges_by_type: Record<string, number>;
}

export interface SemanticGraphEntity {
  id: number;
  entity_type: string;
  canonical_name: string;
  display_name?: string | null;
  description?: string | null;
  status: string;
  source_type?: string | null;
  confidence?: number | null;
  attributes: Record<string, unknown>;
  primary_chunk_id?: number | null;
  primary_document_id?: number | null;
}

export interface SemanticGraphRelation {
  id: number;
  source_entity_id: number;
  target_entity_id: number;
  relation_type: string;
  directional: boolean;
  weight?: number | null;
  confidence?: number | null;
  status: string;
  source_type?: string | null;
  evidence_summary?: string | null;
  notes?: string | null;
  attributes: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SemanticGraphRelationEvidence {
  id: number;
  relation_id: number;
  chunk_id?: number | null;
  document_id?: number | null;
  excerpt?: string | null;
  page_reference?: string | null;
  section_reference?: string | null;
  evidence_type?: string | null;
  confidence?: number | null;
  created_at: string;
}

export interface SemanticGraphResponse {
  entities: SemanticGraphEntity[];
  relations: SemanticGraphRelation[];
}

export interface SemanticGraphRelationDetail {
  relation: SemanticGraphRelation;
  evidence: SemanticGraphRelationEvidence[];
}

export interface SemanticGraphStatsResponse {
  total_entities: number;
  total_relations: number;
  entities_by_type: Record<string, number>;
  relations_by_type: Record<string, number>;
  relations_by_status: Record<string, number>;
}

export interface SemanticGraphQualityStatsResponse {
  duplicate_entity_groups: number;
  pending_entity_candidates: number;
  pending_relation_candidates: number;
  relations_without_evidence: number;
  relations_without_evidence_or_review: number;
  low_confidence_relations: number;
}

export interface SemanticEntitySearchItem {
  entity: SemanticGraphEntity;
  relation_count: number;
}

export interface SemanticEntitySearchResponse {
  total: number;
  items: SemanticEntitySearchItem[];
}

export interface SemanticDuplicateEntityCandidate {
  entity: SemanticGraphEntity;
  duplicate_entity: SemanticGraphEntity;
  score: number;
  matched_on: string;
}

export interface SemanticDuplicateEntityRecommendationResponse {
  total: number;
  items: SemanticDuplicateEntityCandidate[];
}

export interface SemanticExtractionCandidate {
  id: number;
  job_id: number;
  candidate_type: "entity" | "relation" | string;
  payload: Record<string, unknown>;
  normalized_payload: Record<string, unknown>;
  confidence?: number | null;
  status: string;
  review_note?: string | null;
  chunk_id?: number | null;
  document_id?: number | null;
  created_at: string;
  updated_at: string;
}

export interface SemanticExtractionCandidateListResponse {
  total: number;
  items: SemanticExtractionCandidate[];
}

export async function fetchKnowledgeGraph(params?: { relation_type?: string; kind?: string; limit?: number }) {
  const sp = new URLSearchParams();
  if (params?.relation_type) sp.set("relation_type", params.relation_type);
  if (params?.kind) sp.set("kind", params.kind);
  if (params?.limit) sp.set("limit", String(params.limit));
  const q = sp.toString();
  return apiJson<GraphResponse>(`/api/v1/knowledge/graph${q ? `?${q}` : ""}`);
}

export async function fetchKnowledgeGraphStats() {
  return apiJson<GraphStatsResponse>("/api/v1/knowledge/graph/stats");
}

export async function fetchSemanticKnowledgeGraph(params?: {
  relation_type?: string;
  entity_type?: string;
  status?: string;
  limit?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.relation_type) sp.set("relation_type", params.relation_type);
  if (params?.entity_type) sp.set("entity_type", params.entity_type);
  if (params?.status) sp.set("status", params.status);
  if (params?.limit) sp.set("limit", String(params.limit));
  const q = sp.toString();
  return knowledgeJson<SemanticGraphResponse>(`/api/v1/knowledge/semantic-graph${q ? `?${q}` : ""}`);
}

export async function searchSemanticKnowledgeEntities(params?: {
  query?: string;
  entity_type?: string;
  status?: string;
  limit?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.query) sp.set("query", params.query);
  if (params?.entity_type) sp.set("entity_type", params.entity_type);
  if (params?.status) sp.set("status", params.status);
  if (params?.limit) sp.set("limit", String(params.limit));
  const q = sp.toString();
  return knowledgeJson<SemanticEntitySearchResponse>(`/api/v1/knowledge/semantic-graph/entities${q ? `?${q}` : ""}`);
}

export async function fetchSemanticKnowledgeNeighbors(params: {
  entity_id: number;
  depth?: number;
  relation_type?: string;
  status?: string;
}) {
  const sp = new URLSearchParams();
  sp.set("entity_id", String(params.entity_id));
  if (params.depth) sp.set("depth", String(params.depth));
  if (params.relation_type) sp.set("relation_type", params.relation_type);
  if (params.status) sp.set("status", params.status);
  return knowledgeJson<SemanticGraphResponse>(`/api/v1/knowledge/semantic-graph/neighbors?${sp.toString()}`);
}

export async function fetchSemanticKnowledgeRelationDetail(relationId: number) {
  return knowledgeJson<SemanticGraphRelationDetail>(`/api/v1/knowledge/semantic-graph/relations/${relationId}`);
}

export async function fetchSemanticKnowledgeGraphStats() {
  return knowledgeJson<SemanticGraphStatsResponse>("/api/v1/knowledge/semantic-graph/stats");
}

export async function fetchSemanticKnowledgeQualityStats() {
  return knowledgeJson<SemanticGraphQualityStatsResponse>("/api/v1/knowledge/semantic-graph/quality-stats");
}

export async function fetchSemanticExtractionCandidates(params?: {
  candidate_type?: string;
  status?: string;
  job_id?: number;
  limit?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.candidate_type) sp.set("candidate_type", params.candidate_type);
  if (params?.status) sp.set("status", params.status);
  if (params?.job_id) sp.set("job_id", String(params.job_id));
  if (params?.limit) sp.set("limit", String(params.limit));
  const q = sp.toString();
  return knowledgeJson<SemanticExtractionCandidateListResponse>(
    `/api/v1/knowledge/semantic-graph/extraction-candidates${q ? `?${q}` : ""}`,
  );
}

export async function reviewSemanticExtractionCandidate(
  candidateId: number,
  body: { action: "approve" | "reject"; review_note?: string },
) {
  return knowledgeJson<SemanticExtractionCandidate>(
    `/api/v1/knowledge/semantic-graph/extraction-candidates/${candidateId}/reviews`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export async function fetchSemanticDuplicateRecommendations(params?: {
  entity_type?: string;
  min_score?: number;
  limit?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.entity_type) sp.set("entity_type", params.entity_type);
  if (params?.min_score != null) sp.set("min_score", String(params.min_score));
  if (params?.limit) sp.set("limit", String(params.limit));
  const q = sp.toString();
  return knowledgeJson<SemanticDuplicateEntityRecommendationResponse>(
    `/api/v1/knowledge/semantic-graph/entities/duplicate-recommendations${q ? `?${q}` : ""}`,
  );
}

export interface KnowledgeDocumentListResponse {
  total: number;
  documents: KnowledgeDocumentListItem[];
}


export interface KnowledgeDocumentListItem {
  id: number;
  knowledge_base_id: number;
  document_type?: string;
  title: string;
  source_name: string;
  source_type: string;
  equipment_type: string;
  equipment_model?: string | null;
  fault_type?: string | null;
  status: string;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeDocumentDetail extends KnowledgeDocumentListItem {
  section_reference?: string | null;
  page_reference?: string | null;
  content_excerpt?: string | null;
}

export interface KnowledgeChunkPreview {
  chunk_id: number;
  chunk_index: number;
  heading?: string | null;
  content: string;
  page_reference?: string | null;
  section_reference?: string | null;
  section_path?: string | null;
  step_anchor?: string | null;
  image_anchor?: string | null;
}

export interface KnowledgeChunkPreviewResponse {
  document_id: number;
  total: number;
  chunks: KnowledgeChunkPreview[];
}

export type KnowledgeImportStage =
  | "pending"
  | "uploading"
  | "parsing"
  | "ocr"
  | "chunking"
  | "embedding"
  | "indexing"
  | "reviewing"
  | "completed"
  | "failed";

export interface KnowledgeImportJob {
  id: number;
  knowledge_base_id: number;
  batch_id?: string | null;
  import_type: string;
  processing_note?: string | null;
  title?: string | null;
  file_name: string;
  source_name: string;
  file_type?: string | null;
  file_size?: number | null;
  file_hash?: string | null;
  source_type: string;
  equipment_type: string;
  equipment_model?: string | null;
  fault_type?: string | null;
  section_reference?: string | null;
  replace_existing: boolean;
  status: KnowledgeImportStage | string;
  current_stage?: KnowledgeImportStage | string | null;
  progress?: number;
  page_count?: number | null;
  chunk_count?: number | null;
  document_id?: number | null;
  preview_excerpt?: string | null;
  error_message?: string | null;
  error_stage?: KnowledgeImportStage | string | null;
  retry_count?: number;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
}

export interface KnowledgeImportListResponse {
  total: number;
  jobs: KnowledgeImportJob[];
}

export interface WorkOrderListPayload {
  items: WorkOrderItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface WorkOrderItem {
  id: number;
  device_id: number;
  status: string;
  maintenance_level: string;
  current_step_no?: number | null;
  source_task_id?: number | null;
  sla_hours?: number | null;
  sla_deadline?: string | null;
  is_overdue?: boolean;
  is_suspended?: boolean;
  suspended_reason?: string | null;
  suspended_at?: string | null;
  assignees: {
    worker: WorkOrderAssignee | null;
    expert: WorkOrderAssignee | null;
    safety: WorkOrderAssignee | null;
  };
  current_owner: WorkOrderAssignee | null;
  created_at: string;
  updated_at: string;
}
