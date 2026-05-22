"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  fetchTaskDetail,
  fetchTaskExport,
  fetchHealth,
  createMaintenanceDevice,
  createWorkOrder,
  downloadJsonInBrowser,
  getApiBase,
  listMaintenanceDevices,
  normalizeMaintenanceLevelOption,
  retryMaintenanceTask,
  saveMaintenanceTaskExecutionTimeline,
  type MaintenanceDeviceItem,
  type MaintenanceTaskDetail,
} from "@/features/tasks/api";
import { createMaintenanceCase } from "@/shared/lib/http";
import { Header } from "@/shared/components/brand/app-header";
import { ReasoningSubgraphPanel } from "@/features/tasks/components/reasoning-subgraph-panel";
import type { ReasoningProcedureStepHint } from "@/features/tasks/components/reasoning-subgraph-view-model";
import { AgentCollaborationPanel } from "@/features/tasks/components/agent-collaboration-panel";
import { buildAgentCollaborationViewModel } from "@/features/tasks/components/agent-collaboration-view-model";
import { TaskEvidencePanel, type TaskEvidencePanelItem } from "@/features/tasks/components/task-evidence-panel";
import { formatSymptomForDisplay } from "@/features/tasks/lib/symptom-display";
import { ROUTES } from "@/shared/lib/routes";
import { getMaintenanceToken } from "@/features/auth/lib/token-store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { formatDateTimeLocal, formatDurationBetween } from "@/shared/lib/utils";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  FileCode,
  FileText,
  Loader2,
  Network,
  RefreshCw,
  Server,
  Share2,
  GitBranch,
  Wrench,
  XCircle,
} from "lucide-react";

type TaskStatus = "pending" | "running" | "diagnosis_completed" | "completed" | "failed";
type DisplayStatus = TaskStatus | "loading";
type EventType =
  | "connected"
  | "node_start"
  | "node_finish"
  | "report"
  | "error"
  | "done"
  | "agent_pipeline_completed"
  | "critique"
  | "revision_requested"
  | "replan"
  | "termination";

type TimelineEvent = {
  id: string;
  type: EventType;
  title: string;
  description: string;
  time: string;
  detail?: string | null;
};

// 判断任务详情中是否已经存在可用的诊断结果内容。
function hasResolvedDiagnosisPayload(detail: MaintenanceTaskDetail | null, persistedReport?: string | null) {
  if (!detail) return false;
  if ((persistedReport || "").trim()) return true;
  const structured = detail.diagnosis_structured;
  if (!structured) return false;
  return Boolean(
    (structured.preliminary_conclusion || "").trim() ||
      (structured.most_likely_fault || "").trim() ||
      (structured.next_steps || []).length > 0 ||
      (structured.root_causes || []).length > 0,
  );
}

function hasTerminalTaskTimeline(detail: MaintenanceTaskDetail | null) {
  return Boolean(
    detail?.execution_timeline?.some(
      (event) => event.type === "done" || event.type === "agent_pipeline_completed" || event.type === "termination",
    ),
  );
}

// 根据任务详情推断当前任务在页面上展示的运行状态。
function inferTaskRuntimeStatus(detail: MaintenanceTaskDetail | null, persistedReport?: string | null): TaskStatus {
  if (!detail) return "running";

  const rawStatus = String(detail.status || "").toLowerCase();
  if (rawStatus === "completed") return "completed";
  if (rawStatus === "skipped" || rawStatus === "failed") return "failed";
  if (rawStatus === "pending") return "pending";
  if (rawStatus === "in_progress" && (hasResolvedDiagnosisPayload(detail, persistedReport) || hasTerminalTaskTimeline(detail))) {
    return "diagnosis_completed";
  }
  return "running";
}

function hasPersistedDiagnosisReport(detail: MaintenanceTaskDetail | null): boolean {
  if (!detail) return false;
  return Boolean(detail.diagnosis_report?.trim());
}

type KnowledgeRef = NonNullable<MaintenanceTaskDetail["source_refs"]>[number];

type RootCauseCandidate = {
  title: string;
  confidence: number;
  evidence: string;
};

type DiagnosisWorkspaceTab = "fault" | "actions" | "evidence" | "reasoning" | "agent" | "timeline";
type StructuredDiagnosisStep = Extract<
  NonNullable<NonNullable<MaintenanceTaskDetail["diagnosis_structured"]>["next_steps"]>[number],
  {
    title: string;
  }
>;

type StructuredProcedureStep = {
  key: string;
  stepNo: string | null;
  title: string;
  summary: string;
  rawText: string;
  action?: string | null;
  object?: string | null;
  headline?: string | null;
  detail?: string | null;
  sections: Array<{
    label: string;
    items: string[];
  }>;
  meta: string[];
};

type ProcedureSemanticActionMatch = {
  canonical: string;
  variant: string;
  index: number;
};

const PROCEDURE_ACTION_FAMILIES = [
  { canonical: "拆卸", variants: ["拆卸", "拆下", "取下", "取出", "旋下"] },
  { canonical: "拔出", variants: ["拔出", "拔下"] },
  { canonical: "检查", variants: ["检查", "复核", "确认", "观察", "测量"] },
  { canonical: "更换", variants: ["更换", "替换"] },
  { canonical: "调整", variants: ["调整", "校准"] },
  { canonical: "安装", variants: ["安装", "装上", "复装"] },
  { canonical: "清洁", variants: ["清洁", "清理"] },
  { canonical: "润滑", variants: ["润滑"] },
  { canonical: "加注", variants: ["加注", "加入"] },
  { canonical: "排放", variants: ["排放", "放出"] },
  { canonical: "松开", variants: ["松开", "断开"] },
  { canonical: "紧固", variants: ["紧固", "拧紧"] },
] as const;

// 判断文本是否属于作业步骤规划相关标签。
function isPlanningLabel(text: string | null | undefined) {
  const normalized = (text || "").trim();
  if (!normalized) return false;
  return /作业步骤规划/.test(normalized);
}

// 判断给定值是否为结构化诊断步骤对象。
function isStructuredDiagnosisStep(value: unknown): value is StructuredDiagnosisStep {
  return Boolean(value && typeof value === "object" && "title" in value);
}

// 从诊断报告中提取指定标题对应的内容片段。
function extractReportSection(report: string | null | undefined, headings: string[]) {
  const text = (report || "").trim();
  if (!text) return "";

  const escaped = headings.map((heading) => heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?:${escaped.join("|")})\\s*([\\s\\S]*?)(?=\\n(?:■|\\*\\*)\\s*|$)`);
  const match = text.match(pattern);
  return match?.[1]?.trim() || "";
}

// 将报告分段内容清洗为条目列表。
function normalizeSectionItems(section: string) {
  return section
    .split("\n")
    .map((line) => line.replace(/^[\-•●■\d．。、)\s]+/, "").trim())
    .filter(Boolean);
}

// 去掉报告中的 Markdown 标题标记并返回纯文本。
function stripReportHeadingMarkdown(text: string | null | undefined) {
  return (text || "")
    .replace(/\*\*/g, "")
    .replace(/^■\s*/gm, "")
    .trim();
}

// 按中文语义切分报告语句，便于后续摘要和推断。
function splitReportSentences(text: string | null | undefined) {
  return stripReportHeadingMarkdown(text)
    .split(/[；;。]/)
    .map((item) => item.replace(/^[\-•●■\d．。、)\s]+/, "").trim())
    .filter(Boolean);
}

// 综合证据、结论与建议动作估算诊断置信度分数。
function deriveConfidenceScore(
  refs: KnowledgeRef[],
  reasonSection: string,
  conclusionSection: string,
  actionItems: string[],
) {
  const evidenceScore = Math.min(refs.length * 12, 36);
  const conclusionScore = conclusionSection ? 18 : 0;
  const reasonScore = reasonSection ? 18 : 0;
  const actionScore = Math.min(actionItems.length * 6, 24);
  return Math.max(35, Math.min(92, 28 + evidenceScore + conclusionScore + reasonScore + actionScore));
}

// 判断文本是否更像流程说明而不是故障结论。
function looksLikeProcessStatement(text: string) {
  return /(知识依据|步骤预案|风险提示|标准检修|执行准备|现场复核|先核对|可进入|建议先|已形成)/.test(text);
}

// 清洗并压缩故障标签文本，保留最核心描述。
function compactFaultLabel(text: string | null | undefined) {
  const cleaned = (text || "").replace(/^[\-•●■\d．。、)\s]+/, "").trim();
  if (!cleaned) return "";
  const first = cleaned.split(/[；;。]/)[0]?.trim() || cleaned;
  return first.replace(/^最可能故障[:：]\s*/, "").trim();
}

// 从结构化结果、候选根因和报告文本中推导可读的最可能故障。
function deriveReadableLikelyFault(
  structuredFault: string | null | undefined,
  rootCauseCandidates: RootCauseCandidate[],
  reasonSection: string,
  headline: string,
) {
  const normalizedStructured = compactFaultLabel(structuredFault);
  if (normalizedStructured && !looksLikeProcessStatement(normalizedStructured)) {
    return normalizedStructured;
  }
  const topCause = rootCauseCandidates.find((item) => {
    const title = compactFaultLabel(item.title);
    return title && !looksLikeProcessStatement(title);
  });
  if (topCause) return compactFaultLabel(topCause.title);
  const reasonLine = splitReportSentences(reasonSection).find((item) => !looksLikeProcessStatement(item));
  if (reasonLine) return compactFaultLabel(reasonLine);
  return compactFaultLabel(headline) || "待进一步定位";
}

// 基于原因段、结论段和知识引用构造根因候选列表。
function buildRootCauseCandidates(
  reasonSection: string,
  conclusionSection: string,
  refs: KnowledgeRef[],
  confidenceScore: number,
): RootCauseCandidate[] {
  const causeLines = [...splitReportSentences(reasonSection), ...splitReportSentences(conclusionSection)]
    .filter((item) => item.length >= 4)
    .slice(0, 4);

  return causeLines.map((line, index) => {
    const fallbackEvidence = refs[index]?.title || refs[index]?.source_name || "来源于当前知识命中与诊断结论";
    const excerptEvidence = refs[index]?.excerpt?.trim();
    return {
      title: line,
      confidence: Math.max(28, Math.min(95, confidenceScore - index * 14)),
      evidence: excerptEvidence || fallbackEvidence,
    };
  });
}

// 为知识引用推断适合界面展示的章节标签。
function getKnowledgeSectionLabel(ref: KnowledgeRef) {
  if (ref.section_path?.trim()) return ref.section_path.trim();
  if (ref.section_reference?.trim()) return ref.section_reference.trim();
  if (ref.page_reference?.trim()) return ref.page_reference.trim();
  const excerpt = ref.excerpt?.trim() || "";
  const matched = excerpt.match(/(?:章节|步骤|部件|页码|P\d+)[^，。；]*/);
  return matched?.[0] || "命中片段";
}

function getKnowledgeModalityMeta(ref: KnowledgeRef) {
  const modality = String(ref.source_modality || "").trim().toLowerCase();
  if (modality === "ocr") {
    return { label: "OCR 证据", helper: ref.image_caption?.trim() || ref.evidence_summary?.trim() || "图片文本已参与检索" };
  }
  if (modality === "vision" || modality === "image") {
    return { label: "图片证据", helper: ref.image_caption?.trim() || ref.evidence_summary?.trim() || "图片线索已参与检索" };
  }
  return { label: "文本证据", helper: ref.evidence_summary?.trim() || "来自手册或案例文本片段" };
}

function getKnowledgeRetrievalPath(ref: KnowledgeRef) {
  return Array.isArray(ref.retrieval_path)
    ? ref.retrieval_path.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function hasDirectRetrievalSignal(ref: KnowledgeRef) {
  const paths = getKnowledgeRetrievalPath(ref);
  return paths.some((item) =>
    ["sql", "bm25", "vector", "section_expand"].includes(item) || item.startsWith("query_profile:"),
  );
}

function hasGraphRecommendationSignal(ref: KnowledgeRef) {
  const paths = getKnowledgeRetrievalPath(ref);
  const reason = String(ref.recommendation_reason || "").trim();
  return Boolean(
    ref.graph_relation_type ||
      paths.some((item) => item === "graph_expand" || item === "semantic_graph_evidence") ||
      /图谱|关联/.test(reason),
  );
}

function resolveEvidenceGroup(ref: KnowledgeRef): TaskEvidencePanelItem["group"] {
  if (hasDirectRetrievalSignal(ref)) return "direct";
  if (hasGraphRecommendationSignal(ref)) return "related";
  return "direct";
}

function buildEvidenceBadges(ref: KnowledgeRef, modalityLabel: string) {
  const badges = [modalityLabel];
  const paths = getKnowledgeRetrievalPath(ref);

  if (paths.includes("sql") || paths.includes("bm25")) badges.push("关键词命中");
  if (paths.includes("vector")) badges.push("语义召回");
  if (paths.includes("section_expand")) badges.push("同章节展开");
  if (paths.includes("semantic_graph_evidence")) badges.push("图谱证据");
  if (paths.includes("graph_expand") || ref.graph_relation_type) badges.push("语义图谱关联");

  return [...new Set(badges)];
}

function normalizeRankingScoreToPercent(score: number) {
  if (!Number.isFinite(score) || score <= 0) return 0;
  return Math.max(1, Math.min(99, Math.round((1 - Math.exp(-score / 3.2)) * 100)));
}

function getEvidenceSimilarity(refs: KnowledgeRef[], confidenceScore: number, structuredTopSimilarity?: number | null) {
  const rerankScores = refs
    .map((ref) => Number(ref.rerank_score))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (rerankScores.length > 0) {
    return `重排相关度 ${normalizeRankingScoreToPercent(Math.max(...rerankScores))}%`;
  }
  const retrievalScores = refs
    .map((ref) => Number(ref.retrieval_score))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (retrievalScores.length > 0) {
    return `召回相关度 ${normalizeRankingScoreToPercent(Math.max(...retrievalScores))}%`;
  }
  if (structuredTopSimilarity) return `重排相关度 ${structuredTopSimilarity}%`;
  if (refs.length === 0) return "--";
  const top = Math.max(confidenceScore - 6, 40);
  return `重排相关度 ${top}%`;
}

function getEvidenceSortScore(ref: KnowledgeRef) {
  const rerankScore = Number(ref.rerank_score);
  if (Number.isFinite(rerankScore) && rerankScore > 0) return rerankScore;
  const retrievalScore = Number(ref.retrieval_score);
  if (Number.isFinite(retrievalScore) && retrievalScore > 0) return retrievalScore;
  return -1;
}

function formatEvidenceScore(ref: KnowledgeRef, fallbackScore: number) {
  const rerankScore = Number(ref.rerank_score);
  if (Number.isFinite(rerankScore)) {
    return { label: "重排相关度", value: `${normalizeRankingScoreToPercent(rerankScore)}%` };
  }
  const retrievalScore = Number(ref.retrieval_score);
  if (Number.isFinite(retrievalScore)) {
    return { label: "召回相关度", value: `${normalizeRankingScoreToPercent(retrievalScore)}%` };
  }
  return { label: "参考相关度", value: `${fallbackScore}%` };
}

// 将秒数格式化为中文时长文本。
function formatDurationFromSeconds(totalSeconds: number): string | null {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return null;
  const sec = Math.floor(totalSeconds);
  if (sec === 0) return "不足 1 秒";
  if (sec < 60) return `${sec} 秒`;
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes > 0 ? `${hours} 小时 ${remainMinutes} 分` : `${hours} 小时`;
}

// 根据时间线事件起止时间计算总耗时。
function formatTimelineDuration(eventList: TimelineEvent[]): string | null {
  if (eventList.length < 2) return null;
  const parseClock = (value: string) => {
    const directTimestamp = Date.parse(value);
    if (!Number.isNaN(directTimestamp)) return Math.floor(directTimestamp / 1000);

    const matched = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!matched) return null;
    const hour = Number(matched[1]);
    const minute = Number(matched[2]);
    const second = Number(matched[3] ?? "0");
    if (hour > 23 || minute > 59 || second > 59) return null;
    return hour * 3600 + minute * 60 + second;
  };

  const first = parseClock(eventList[0]?.time || "");
  const last = parseClock(eventList[eventList.length - 1]?.time || "");
  if (first == null || last == null) return null;
  const diff = last >= first ? last - first : last + 24 * 3600 - first;
  return formatDurationFromSeconds(diff);
}

// 根据时间线事件类型返回对应的界面样式。
function getTimelineEventVisual(type: EventType) {
  if (type === "done" || type === "report" || type === "termination") {
    return {
      badgeClass: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      bubbleClass: "border-emerald-500/20 bg-emerald-500/8",
    };
  }
  if (type === "critique" || type === "revision_requested" || type === "replan") {
    return {
      badgeClass: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      bubbleClass: "border-amber-500/20 bg-amber-500/8",
    };
  }
  if (type === "agent_pipeline_completed") {
    return {
      badgeClass: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      bubbleClass: "border-amber-500/20 bg-amber-500/8",
    };
  }
  if (type === "error") {
    return {
      badgeClass: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
      bubbleClass: "border-red-500/20 bg-red-500/8",
    };
  }
  if (type === "node_finish") {
    return {
      badgeClass: "border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
      bubbleClass: "border-indigo-500/20 bg-indigo-500/8",
    };
  }
  return {
    badgeClass: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    bubbleClass: "border-sky-500/20 bg-sky-500/8",
  };
}

// 解析时间线事件时间并转换为毫秒时间戳。
function parseTimelineEventTimeMs(value: string | null | undefined): number | null {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const timestamp = Date.parse(normalized);
  if (!Number.isNaN(timestamp)) return timestamp;
  const matched = normalized.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!matched) return null;
  const base = new Date();
  base.setHours(Number(matched[1]), Number(matched[2]), Number(matched[3] ?? "0"), 0);
  return base.getTime();
}

// 规范化步骤文本，便于后续去重和匹配。
function normalizeProcedureStepKey(text: string | null | undefined) {
  return (text || "").replace(/\s+/g, " ").replace(/[：:，。,；;]+$/g, "").trim();
}

// 清洗中文检修步骤文本中的多余空格和格式噪声。
function tidyChineseProcedureText(text: string | null | undefined) {
  return (text || "")
    .replace(/\s+/g, " ")
    .replace(/\s*([：:，。,；;、）])/g, "$1")
    .replace(/([（])\s*/g, "$1")
    .replace(/(拆下|取下|松开|打开|关闭|断开|拔下|敲平|排放|加注|检查|取出)\s+/g, "$1")
    .replace(/([\u4e00-\u9fff])\s+(?=\d)/g, "$1")
    .replace(/(\d)\s+(?=[\u4e00-\u9fff])/g, "$1")
    .trim();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimProcedureSemanticFragment(text: string | null | undefined) {
  return tidyChineseProcedureText(text)
    .replace(/^[，。；;、:：\s]+/, "")
    .replace(/[，。；;、:：\s]+$/g, "")
    .trim();
}

function trimProcedureStopClause(text: string) {
  return text
    .replace(/(避免|防止|确保|确认|以免|用于).*/g, "")
    .trim();
}

function findProcedureSemanticAction(texts: Array<string | null | undefined>): ProcedureSemanticActionMatch | null {
  let bestMatch: ProcedureSemanticActionMatch | null = null;

  for (const rawText of texts) {
    const text = tidyChineseProcedureText(rawText);
    if (!text) continue;

    for (const family of PROCEDURE_ACTION_FAMILIES) {
      for (const variant of family.variants) {
        const index = text.indexOf(variant);
        if (index < 0) continue;
        if (
          !bestMatch ||
          index < bestMatch.index ||
          (index === bestMatch.index && variant.length > bestMatch.variant.length)
        ) {
          bestMatch = { canonical: family.canonical, variant, index };
        }
      }
    }

  }

  return bestMatch;
}

function deriveProcedureSemanticEntityCandidate(
  text: string | null | undefined,
  actionMatch: ProcedureSemanticActionMatch | null,
) {
  const normalized = tidyChineseProcedureText(text).split(/[。；]/)[0]?.trim() || "";
  if (!normalized || !actionMatch) return "";

  const variants = Array.from(
    new Set(
      PROCEDURE_ACTION_FAMILIES.find((family) => family.canonical === actionMatch.canonical)?.variants ?? [
        actionMatch.variant,
        actionMatch.canonical,
      ],
    ),
  );

  for (const variant of variants) {
    const index = normalized.indexOf(variant);
    if (index < 0) continue;

    const trailing = normalized.slice(index + variant.length);
    const candidate = trimProcedureSemanticFragment(
      trimProcedureStopClause(
        trailing
          .replace(/^(并|再|将|把|对|于|向|往)+/, "")
          .replace(/^(?:小心|垂直|逐一|依次|缓慢|轻轻|逆时针转动|顺时针转动|逆时针|顺时针)+/, ""),
      )
        .split(/(?:并|然后|再|后|前|时)/)[0],
    );

    if (candidate.length >= 2) {
      return candidate;
    }
  }

  return "";
}

function deriveProcedureSemanticHeadline(
  step: StructuredProcedureStep,
  actionMatch: ProcedureSemanticActionMatch | null,
  objectLabel: string,
) {
  const candidates = [step.summary, step.rawText, step.title];

  for (const rawCandidate of candidates) {
    const candidate = tidyChineseProcedureText(rawCandidate).split(/[。；]/)[0]?.trim() || "";
    if (!candidate) continue;

    let headline = candidate.replace(/^使用/, "").replace(/^(请|先|再|将|把)/, "").trim();
    if (objectLabel) {
      headline = headline.replace(new RegExp(escapeRegExp(objectLabel), "g"), "").trim();
    }
    headline = trimProcedureSemanticFragment(trimProcedureStopClause(headline));
    if (!headline) continue;

    if (actionMatch && headline === actionMatch.canonical) continue;
    if (headline === step.title) continue;

    return headline;
  }

  return tidyChineseProcedureText(step.title) || "按步骤执行";
}

function buildProcedurePrimaryDetail(step: StructuredProcedureStep) {
  const summary = tidyChineseProcedureText(step.summary);
  if (summary && summary !== "按手册原文执行该步骤。") {
    return summary;
  }

  const rawText = tidyChineseProcedureText(step.rawText);
  if (rawText && rawText !== step.title) {
    return rawText;
  }

  return tidyChineseProcedureText(step.title);
}

function buildReasoningProcedureStepHint(step: StructuredProcedureStep, index: number): ReasoningProcedureStepHint {
  const normalizedAction = tidyChineseProcedureText(step.action);
  const actionMatch = normalizedAction
    ? findProcedureSemanticAction([normalizedAction]) ?? { canonical: normalizedAction, variant: normalizedAction, index: 0 }
    : findProcedureSemanticAction([step.title, step.summary, step.rawText]);
  const objectLabel =
    tidyChineseProcedureText(step.object) ||
    deriveProcedureSemanticEntityCandidate(step.title, actionMatch) ||
    deriveProcedureSemanticEntityCandidate(step.summary, actionMatch) ||
    deriveProcedureSemanticEntityCandidate(step.rawText, actionMatch);
  const headline = tidyChineseProcedureText(step.headline) || deriveProcedureSemanticHeadline(step, actionMatch, objectLabel);
  const detail = tidyChineseProcedureText(step.detail) || buildProcedurePrimaryDetail(step);

  return {
    id: `reasoning-step-${step.stepNo ?? index}`,
    stepNo: step.stepNo,
    title: step.title || `步骤 ${index + 1}`,
    summary: step.summary || "",
    rawText: step.rawText,
    actionLabel: normalizedAction || (actionMatch ? actionMatch.canonical : null),
    objectLabel: objectLabel || null,
    headline,
    detail,
    sections: step.sections,
    meta: step.meta,
  };
}

// 从较长的步骤文本中提取适合图谱节点展示的短标题。
function splitProcedureHeadline(text: string | null | undefined) {
  const normalized = tidyChineseProcedureText(text)
    .replace(/^步骤\s*\d+[:：]?\s*/i, "")
    .replace(/^\d+[.、]\s*/, "")
    .trim();
  if (!normalized) {
    return { title: "", remainder: "" };
  }

  const noticeParts = normalized.split(/注意[:：]/);
  const primaryText = noticeParts[0]?.trim() || normalized;
  const noticeText = noticeParts.slice(1).join(" ").trim();
  const matched = primaryText.match(/^([^，；。]+)[，；。]?\s*(.*)$/);
  const title = tidyChineseProcedureText(matched?.[1] || primaryText);
  const remainderParts = [matched?.[2] || "", noticeText ? `注意：${noticeText}` : ""]
    .map((item) => tidyChineseProcedureText(item))
    .filter(Boolean);

  return {
    title,
    remainder: remainderParts.join(" "),
  };
}

// 将步骤说明拆分为若干独立条目。
function splitProcedureItems(text: string | null | undefined) {
  const compact = (text || "").replace(/\s+/g, " ").trim();
  if (!compact) return [];
  if (compact.includes(" ")) {
    return compact
      .split(/\s+/)
      .map((item) => tidyChineseProcedureText(item))
      .filter(Boolean);
  }
  return [tidyChineseProcedureText(compact)];
}

// 将操作步骤按动作语义拆分为更细粒度条目。
function splitProcedureActionItems(text: string | null | undefined) {
  const compact = (text || "").replace(/\s+/g, " ").trim();
  if (!compact) return [];
  const parts = compact
    .split(/(?=取下|拆下|松开|断开|打开|关闭|拔下|取出)/)
    .map((item) => tidyChineseProcedureText(item))
    .filter(Boolean);
  return parts.length > 0 ? parts : [tidyChineseProcedureText(compact)];
}

// 对步骤列表按编号和内容进行去重。
function dedupeProcedureSteps(items: string[]) {
  const deduped: string[] = [];
  const stepIndexByNo = new Map<string, number>();
  const seen = new Set<string>();

  for (const rawItem of items) {
    const item = normalizeProcedureStepKey(rawItem);
    if (!item) continue;
    if (seen.has(item)) continue;

    const matched = item.match(/^(\d+)\.\s*(.*)$/);
    if (matched) {
      const stepNo = matched[1];
      const existingIndex = stepIndexByNo.get(stepNo);
      if (existingIndex != null) {
        if (item.length > deduped[existingIndex].length) {
          seen.delete(deduped[existingIndex]);
          deduped[existingIndex] = item;
          seen.add(item);
        }
        continue;
      }
      stepIndexByNo.set(stepNo, deduped.length);
    }

    deduped.push(item);
    seen.add(item);
  }

  return deduped;
}

// 将原始步骤文本解析为结构化的工序步骤对象。
function parseStructuredProcedureStep(rawItem: string, index: number): StructuredProcedureStep {
  const compact = normalizeProcedureStepKey(rawItem);
  const matched = compact.match(/^(\d+)\.\s*(.*)$/);
  const stepNo = matched?.[1] ?? null;
  const body = (matched?.[2] ?? compact).trim();

  const meta: string[] = [];
  let cleanedBody = body;

  const toolMatch = cleanedBody.match(/所需工具[:：]?\s*([^。；]+)$/);
  if (toolMatch) {
    meta.push(`所需工具：${toolMatch[1].trim()}`);
    cleanedBody = cleanedBody.slice(0, toolMatch.index).trim();
  }

  const torqueMatch = cleanedBody.match(/([^。；]*扭矩[:：]?\s*[^。；]+)/);
  if (torqueMatch) {
    meta.unshift(torqueMatch[1].trim());
    cleanedBody = cleanedBody.replace(torqueMatch[1], "").trim();
  }

  const headline = splitProcedureHeadline(cleanedBody);
  let title = headline.title || cleanedBody;
  let remainder = headline.remainder;

  const actionSplit = title.match(/^([^\s]+)\s+(.+)$/);
  if (actionSplit && actionSplit[1].length <= 12 && actionSplit[2].length >= 4) {
    title = actionSplit[1].trim();
    remainder = [actionSplit[2].trim(), remainder].filter(Boolean).join(" ");
  }

  const sections: Array<{ label: string; items: string[] }> = [];
  let summary = "";
  let mutableRemainder = remainder;

  const patternHandlers = [
    {
      pattern: /(依次松开以下部件的固定螺栓)[:：]\s*([\s\S]*?)(?=(具体操作顺序为)[:：]|$)/,
      split: splitProcedureItems,
    },
    {
      pattern: /(具体操作顺序为)[:：]\s*([\s\S]*?)(?=$)/,
      split: splitProcedureActionItems,
    },
    {
      pattern: /(依次取下)[:：]\s*([\s\S]*?)(?=$)/,
      split: splitProcedureItems,
    },
  ] as const;

  for (const handler of patternHandlers) {
    const matchSection = mutableRemainder.match(handler.pattern);
    if (!matchSection) continue;
    const label = tidyChineseProcedureText(matchSection[1]);
    const items = handler.split(matchSection[2]);
    if (items.length > 0) {
      sections.push({ label, items });
    }
    mutableRemainder = mutableRemainder.replace(matchSection[0], " ").trim();
  }

  summary = tidyChineseProcedureText(mutableRemainder)
    .replace(/\s*具体操作顺序为\s*$/g, "")
    .replace(/\s*依次取下\s*$/g, "")
    .trim();

  if (!summary && sections.length === 0) {
    summary = "按手册原文执行该步骤。";
  }

  return {
    key: `${stepNo ?? index}-${title}-${summary}`.trim(),
    stepNo,
    title: tidyChineseProcedureText(title) || `步骤 ${index + 1}`,
    summary,
    rawText: tidyChineseProcedureText(body) || tidyChineseProcedureText(compact),
    action: null,
    object: null,
    headline: null,
    detail: null,
    sections,
    meta,
  };
}

// 将结构化诊断步骤标准化为统一的工序步骤格式。
function normalizeStructuredProcedureStep(
  step: StructuredDiagnosisStep,
  index: number,
): StructuredProcedureStep {
  const stepNo = step.step_no != null ? String(step.step_no) : null;
  const headline = splitProcedureHeadline(step.title || step.raw_text || "");
  const title = headline.title || tidyChineseProcedureText(step.title) || `步骤 ${index + 1}`;
  const summary = tidyChineseProcedureText(step.summary || headline.remainder || "");
  const sections = Array.isArray(step.sections)
    ? step.sections
        .map((section) => ({
          label: tidyChineseProcedureText(section.label || ""),
          items: Array.isArray(section.items)
            ? section.items.map((item) => tidyChineseProcedureText(item)).filter(Boolean)
            : [],
        }))
        .filter((section) => section.label && section.items.length > 0)
    : [];
  const meta = Array.isArray(step.meta) ? step.meta.map((item) => item.trim()).filter(Boolean) : [];

  return {
    key: `${stepNo ?? index}-${title}-${summary}-${step.raw_text ?? ""}`.trim(),
    stepNo,
    title,
    summary,
    rawText: tidyChineseProcedureText(step.raw_text || `${step.title}${summary ? ` ${summary}` : ""}`),
    action: tidyChineseProcedureText(step.action),
    object: tidyChineseProcedureText(step.object),
    headline: tidyChineseProcedureText(step.headline),
    detail: tidyChineseProcedureText(step.detail),
    sections,
    meta,
  };
}

// 按步骤编号对结构化工序步骤进行排序。
function sortStructuredProcedureSteps(items: StructuredProcedureStep[]) {
  return [...items].sort((left, right) => {
    const leftStepNo = left.stepNo ? Number(left.stepNo) : Number.NaN;
    const rightStepNo = right.stepNo ? Number(right.stepNo) : Number.NaN;
    const leftHasStepNo = Number.isFinite(leftStepNo);
    const rightHasStepNo = Number.isFinite(rightStepNo);

    if (leftHasStepNo && rightHasStepNo && leftStepNo !== rightStepNo) {
      return leftStepNo - rightStepNo;
    }
    if (leftHasStepNo !== rightHasStepNo) {
      return leftHasStepNo ? -1 : 1;
    }
    return 0;
  });
}

const statusMeta = {
  loading: {
    label: "加载中",
    badgeClass: "border-slate-500/20 bg-slate-500/8 text-slate-600 dark:text-slate-300",
    panelClass: "border-slate-500/15 bg-slate-500/5",
    summary: "正在获取任务详情，请稍候。",
    icon: Loader2,
  },
  completed: {
    label: "诊断完成",
    badgeClass: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    panelClass: "border-emerald-500/20 bg-emerald-500/6",
    summary: "结论与建议已同步，可直接复核并导出。",
    icon: CheckCircle2,
  },
  diagnosis_completed: {
    label: "待收口",
    badgeClass: "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    panelClass: "border-amber-500/20 bg-amber-500/6",
    summary: "诊断结果已生成，但任务仍待规划、审核或人工确认后收口。",
    icon: Clock,
  },
  running: {
    label: "诊断中",
    badgeClass: "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-400",
    panelClass: "border-blue-500/20 bg-blue-500/6",
    summary: "协作诊断流已建立，结论和时间线会持续更新。",
    icon: Loader2,
  },
  pending: {
    label: "待处理",
    badgeClass: "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    panelClass: "border-amber-500/20 bg-amber-500/6",
    summary: "任务记录已创建，正在等待正式启动诊断流程。",
    icon: Clock,
  },
  failed: {
    label: "诊断失败",
    badgeClass: "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400",
    panelClass: "border-red-500/20 bg-red-500/6",
    summary: "当前流程中断，请检查最近错误事件后重新运行。",
    icon: XCircle,
  },
} as const;

// 渲染骨架屏占位块。
function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted/50 ${className ?? ""}`} />;
}

// 渲染任务详情页的加载骨架屏。
function TaskDetailSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <div className="app-card p-5 space-y-4">
          <SkeletonBlock className="h-4 w-24" />
          <SkeletonBlock className="h-16" />
          <SkeletonBlock className="h-10" />
          <SkeletonBlock className="h-10" />
          <div className="space-y-3 pt-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-start gap-3">
                <SkeletonBlock className="h-6 w-6 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <SkeletonBlock className="h-3.5 w-28" />
                  <SkeletonBlock className="h-3 w-40" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
      <section className="space-y-4">
        <div className="app-card p-5 space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-border">
            <div className="space-y-2">
              <SkeletonBlock className="h-5 w-32" />
              <SkeletonBlock className="h-3.5 w-64" />
            </div>
            <SkeletonBlock className="h-6 w-20 rounded-full" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <SkeletonBlock key={i} className="h-[84px] rounded-xl" />
            ))}
          </div>
          <SkeletonBlock className="h-48 rounded-xl" />
        </div>
      </section>
    </div>
  );
}

// 渲染任务状态徽标。
function StatusBadge({ status }: { status: DisplayStatus }) {
  const meta = statusMeta[status];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${meta.badgeClass}`}>
      <Icon className={`h-4 w-4 ${status === "running" || status === "loading" ? "animate-spin" : ""}`} />
      {meta.label}
    </span>
  );
}

// 渲染任务概览区域中的单个信息项。
function OverviewItem({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Clock;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/35 p-3">
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <div className="inline-flex items-center gap-1.5 text-sm text-foreground">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span>{value}</span>
      </div>
    </div>
  );
}

// 渲染任务详情页面，并承载诊断结果与操作流程。
export default function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const backHref = useMemo(() => {
    const raw = searchParams.get("from")?.trim();
    if (raw && raw.startsWith("/")) return raw;
    return ROUTES.diagnosisHistory;
  }, [searchParams]);
  const numericTaskId = useMemo(() => (/^\d+$/.test(taskId) ? Number(taskId) : null), [taskId]);
  const streamRef = useRef<EventSource | null>(null);
  const eventsRef = useRef<TimelineEvent[]>([]);
  const ragConclusionRef = useRef<string | null>(null);
  const autoStartGuardRef = useRef(false);
  const runInitiatedRef = useRef(false);

  const [task, setTask] = useState<MaintenanceTaskDetail | null>(null);
  const [status, setStatus] = useState<TaskStatus>("pending");
  const [detailLoaded, setDetailLoaded] = useState(false);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [ragConclusion, setRagConclusion] = useState<string | null>(null);
  const [runStartedAtMs, setRunStartedAtMs] = useState<number | null>(null);
  const [runningNowMs, setRunningNowMs] = useState<number>(() => Date.now());
  const [streaming, setStreaming] = useState(false);
  const [createWorkOrderOpen, setCreateWorkOrderOpen] = useState(false);
  const [workOrderSubmitting, setWorkOrderSubmitting] = useState(false);
  const [workOrderError, setWorkOrderError] = useState<string | null>(null);
  const [matchedDevice, setMatchedDevice] = useState<MaintenanceDeviceItem | null>(null);
  const [matchingDevice, setMatchingDevice] = useState(false);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<DiagnosisWorkspaceTab>("fault");
  const [createCaseOpen, setCreateCaseOpen] = useState(false);
  const [caseSubmitting, setCaseSubmitting] = useState(false);
  const [caseError, setCaseError] = useState<string | null>(null);
  const hasPersistedDiagnosis = hasResolvedDiagnosisPayload(task, ragConclusionRef.current);
  const hasTerminalTimeline = hasTerminalTaskTimeline(task);
  const hasDiagnosisResultReady = status === "completed" || status === "diagnosis_completed";
  const shouldBackfillReport =
    task != null &&
    hasDiagnosisResultReady &&
    !ragConclusionRef.current?.trim() &&
    !task.diagnosis_structured?.preliminary_conclusion?.trim();
  const workOrderAssetCode = task?.asset_code || "";
  const workOrderDeviceType = task?.equipment_type || "";
  const workOrderDeviceModel = task?.equipment_model?.trim() || "";

  // 清理地址栏中的自动处理参数，避免重复触发流程。
  const clearProcessActionParam = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("action") !== "process") return;
    url.searchParams.delete("action");
    const nextQuery = url.searchParams.toString();
    const nextUrl = `${url.pathname}${nextQuery ? `?${nextQuery}` : ""}${url.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, []);

  // 关闭当前诊断事件流并同步重置流式状态。
  const closeStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
    setStreaming(false);
  }, []);

  // 向本地时间线追加一条事件，并在首次事件时记录开始时间。
  const appendEvent = useCallback((type: EventType, title: string, description: string, detail?: string | null) => {
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const evt = {
      id,
      type,
      title,
      description,
      time: new Date().toISOString(),
      detail,
    };
    const next = [...eventsRef.current, evt];
    eventsRef.current = next;
    setEvents(next);
    if (next.length === 1) {
      const firstEventTime = parseTimelineEventTimeMs(evt.time);
      if (firstEventTime != null) {
        setRunStartedAtMs(firstEventTime);
      }
    }
    return next;
  }, []);

  // 将后端任务详情同步到页面状态，并处理报告与时间线恢复逻辑。
  const syncTaskDetailState = useCallback((detail: MaintenanceTaskDetail) => {
    setTask(detail);
    const hasPersistedReport = hasPersistedDiagnosisReport(detail);
    const persistedReport =
      detail.diagnosis_report?.trim() ||
      detail.diagnosis_structured?.preliminary_conclusion?.trim() ||
      null;
    const rawStatus = String(detail.status || "").toLowerCase();
    const hasPersistedTimeline = Array.isArray(detail.execution_timeline) && detail.execution_timeline.length > 0;
    const shouldPreserveRuntimeTimeline =
      !hasPersistedTimeline &&
      rawStatus === "pending" &&
      (eventsRef.current.length > 0 || runInitiatedRef.current) &&
      !hasPersistedReport;
    setRagConclusion(persistedReport);
    ragConclusionRef.current = persistedReport;
    if (hasPersistedTimeline || hasPersistedReport || rawStatus === "in_progress" || rawStatus === "completed" || rawStatus === "failed" || rawStatus === "skipped") {
      runInitiatedRef.current = false;
    }
    if (hasPersistedTimeline) {
      const restored = detail.execution_timeline as TimelineEvent[];
      setEvents(restored);
      eventsRef.current = restored;
      setRunStartedAtMs(parseTimelineEventTimeMs(restored[0]?.time) ?? null);
    } else if (shouldPreserveRuntimeTimeline) {
      setEvents([...eventsRef.current]);
      setRunStartedAtMs(parseTimelineEventTimeMs(eventsRef.current[0]?.time) ?? null);
    } else {
      setEvents([]);
      eventsRef.current = [];
      setRunStartedAtMs(parseTimelineEventTimeMs(detail.run_started_at) ?? null);
    }
    const nextStatus = inferTaskRuntimeStatus(detail, persistedReport);
    setStatus(shouldPreserveRuntimeTimeline && nextStatus === "pending" ? "running" : nextStatus);
  }, []);

  // 拉取任务详情并刷新页面展示状态。
  const loadTaskDetail = useCallback(async () => {
    if (numericTaskId == null) return null;
    try {
      const detail = await fetchTaskDetail(numericTaskId);
      syncTaskDetailState(detail);
      return detail;
    } catch {
      setStatus("failed");
      return null;
    } finally {
      setDetailLoaded(true);
    }
  }, [numericTaskId, syncTaskDetailState]);

  // 建立诊断 SSE 流并持续接收阶段事件与报告内容。
  const startDiagnosisStream = useCallback(
    (sourceTask?: MaintenanceTaskDetail | null) => {
      if (numericTaskId == null) return;
      const currentTask = sourceTask ?? task;
      if (currentTask == null) return;

      closeStream();
      runInitiatedRef.current = true;
      setStreaming(true);
      setStatus("running");

      const query =
        formatSymptomForDisplay(currentTask.symptom_description) ||
        currentTask.fault_type ||
        currentTask.title ||
        "";
      const params = new URLSearchParams({
        maintenance_task_id: String(numericTaskId),
        query,
        equipment_type: currentTask.equipment_type || "",
        maintenance_level: currentTask.maintenance_level || "standard",
        model_provider: "openai",
      });
      if (currentTask.equipment_model) params.set("equipment_model", currentTask.equipment_model);
      if (currentTask.fault_type) params.set("fault_type", currentTask.fault_type);

      const source = new EventSource(`${getApiBase()}/api/v1/agents/assist/stream?${params.toString()}`);
      streamRef.current = source;

      source.addEventListener("connected", () => appendEvent("connected", "SSE 连接建立", "已连接协作诊断流"));
      source.addEventListener("stage_start", (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data) as { title?: string; message?: string };
          appendEvent("node_start", payload.title || "阶段开始", payload.message || "正在执行");
        } catch {
          appendEvent("node_start", "阶段开始", "正在执行");
        }
      });
      source.addEventListener("stage_finish", (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data) as { title?: string; summary?: string };
          appendEvent("node_finish", payload.title || "阶段完成", payload.summary || "执行完成");
        } catch {
          appendEvent("node_finish", "阶段完成", "执行完成");
        }
      });
      source.addEventListener("report", (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data) as { report?: string };
          const reportText = (payload.report || "").trim();
          appendEvent("report", "RAG 诊断报告生成", reportText || "已生成诊断摘要");
          if (reportText) {
            setRagConclusion(reportText);
            ragConclusionRef.current = reportText;
          }
        } catch {
          appendEvent("report", "诊断报告生成", "已生成诊断摘要");
        }
      });
      source.addEventListener("critique_created", (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data) as {
            verdict?: string;
            target_stage?: string;
            summary?: string;
            issues?: string[];
          };
          appendEvent(
            "critique",
            "审核意见生成",
            payload.summary || "已生成审核意见",
            `verdict=${payload.verdict || "unknown"}; target_stage=${payload.target_stage || ""}; issues=${(payload.issues || []).join(" | ")}`,
          );
        } catch {
          appendEvent("critique", "审核意见生成", "已生成审核意见");
        }
      });
      source.addEventListener("revision_requested", (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data) as {
            target_stage?: string;
            revision_round?: number;
            reason?: string;
            issues?: string[];
          };
          appendEvent(
            "revision_requested",
            `${payload.target_stage || "diagnosis"} 需要修订`,
            payload.reason || "已请求回跑修订",
            `target_stage=${payload.target_stage || ""}; revision_round=${payload.revision_round || 0}; issues=${(payload.issues || []).join(" | ")}`,
          );
        } catch {
          appendEvent("revision_requested", "诊断需要修订", "已请求回跑修订");
        }
      });
      source.addEventListener("replan_applied", (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data) as {
            action?: string;
            target_stage?: string;
            reason?: string;
          };
          appendEvent(
            "replan",
            "重规划决策已应用",
            payload.reason || "已完成阶段重规划",
            `action=${payload.action || ""}; target_stage=${payload.target_stage || ""}`,
          );
        } catch {
          appendEvent("replan", "重规划决策已应用", "已完成阶段重规划");
        }
      });
      source.addEventListener("termination_decided", (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data) as {
            status?: string;
            reason?: string;
            manual_review_required?: boolean;
          };
          appendEvent(
            "termination",
            "图执行已收束",
            payload.reason || "执行已结束",
            `status=${payload.status || "completed"}; manual_review_required=${String(Boolean(payload.manual_review_required))}`,
          );
        } catch {
          appendEvent("termination", "图执行已收束", "执行已结束");
        }
      });
      source.addEventListener("stream_error", (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data) as { error?: string };
          appendEvent("error", "诊断失败", payload.error || "流式执行失败");
        } catch {
          appendEvent("error", "诊断失败", "流式执行失败");
        }
        runInitiatedRef.current = false;
        setStatus("failed");
        closeStream();
      });
      source.addEventListener("done", () => {
        closeStream();
        void loadTaskDetail();
      });
      source.onerror = () => {
        runInitiatedRef.current = false;
        closeStream();
      };
    },
    [appendEvent, closeStream, loadTaskDetail, numericTaskId, task],
  );

  useEffect(() => {
    if (searchParams.get("action") !== "process") return;
    const t = window.setTimeout(() => {
      document.getElementById("task-handle-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchParams]);

  useEffect(() => {
    if (numericTaskId == null) return;
    void (async () => {
      const detail = await loadTaskDetail();
      if (detail == null || autoStartGuardRef.current) return;
      const hasTimeline = Array.isArray(detail.execution_timeline) && detail.execution_timeline.length > 0;
      const hasPersistedReport = hasPersistedDiagnosisReport(detail);
      const rawStatus = String(detail.status || "").toLowerCase();
      const hasProcessAction = searchParams.get("action") === "process";
      const shouldAutoStartInitialRun =
        hasProcessAction &&
        !hasTimeline &&
        !hasPersistedReport &&
        rawStatus === "pending" &&
        !streaming;
      if (shouldAutoStartInitialRun) {
        autoStartGuardRef.current = true;
        startDiagnosisStream(detail);
        clearProcessActionParam();
        return;
      }
      if (
        hasProcessAction &&
        (hasTimeline || hasPersistedReport || rawStatus === "in_progress" || rawStatus === "completed")
      ) {
        clearProcessActionParam();
      }
    })();
  }, [clearProcessActionParam, loadTaskDetail, numericTaskId, searchParams, startDiagnosisStream, streaming]);

  useEffect(() => () => closeStream(), [closeStream]);

  const loadTaskDetailRef = useRef(loadTaskDetail);
  useEffect(() => { loadTaskDetailRef.current = loadTaskDetail; });

  useEffect(() => {
    if (numericTaskId == null) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void loadTaskDetailRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [numericTaskId]);

  useEffect(() => {
    if (numericTaskId == null || streaming) return;
    if (hasPersistedDiagnosis && !shouldBackfillReport) return;
    if (hasTerminalTimeline && !shouldBackfillReport) return;
    const rawStatus = String(task?.status || "").toLowerCase();
    const shouldPoll = rawStatus === "pending" || rawStatus === "in_progress" || status === "running";
    if (!shouldPoll) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void loadTaskDetail();
    };
    tick();
    const id = window.setInterval(tick, 4000);
    return () => window.clearInterval(id);
  }, [
    hasPersistedDiagnosis,
    hasTerminalTimeline,
    loadTaskDetail,
    numericTaskId,
    shouldBackfillReport,
    status,
    streaming,
    task?.status,
  ]);

  useEffect(() => {
    if (status !== "running" || runStartedAtMs == null) return;
    setRunningNowMs(Date.now());
    const id = window.setInterval(() => setRunningNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status, runStartedAtMs]);

  useEffect(() => {
    if (!createWorkOrderOpen) return;
    let cancelled = false;
    setWorkOrderError(null);
    setMatchedDevice(null);
    setMatchingDevice(true);
    const token = getMaintenanceToken();
    if (!token) {
      setWorkOrderError("当前未检测到检修域登录状态，无法生成工单。");
      setMatchingDevice(false);
      return;
    }
    if (!workOrderAssetCode) {
      setWorkOrderError("当前任务缺少设备编号，无法自动关联检修设备。");
      setMatchingDevice(false);
      return;
    }
    void (async () => {
      try {
        const deviceList = await listMaintenanceDevices(token, 1);
        if (cancelled) return;
        const exact = deviceList.items.find((item) => item.asset_code === workOrderAssetCode) ?? null;
        if (exact) {
          if (cancelled) return;
          setMatchedDevice(exact);
          return;
        }
        const createdDevice = await createMaintenanceDevice(token, {
          device_type: workOrderDeviceType || "未分类设备",
          model: workOrderDeviceModel || "AUTO-GENERATED",
          asset_code: workOrderAssetCode,
          location: "智能诊断自动建档",
        });
        if (cancelled) return;
        setMatchedDevice(createdDevice);
      } catch (e) {
        if (cancelled) return;
        setWorkOrderError(e instanceof Error ? e.message : "加载检修设备失败");
      } finally {
        if (cancelled) return;
        setMatchingDevice(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [createWorkOrderOpen, workOrderAssetCode, workOrderDeviceType, workOrderDeviceModel]);

  // 重置当前任务状态并重新发起一次诊断流程。
  const retry = () => {
    if (numericTaskId == null) return;
    closeStream();
    void (async () => {
      try {
        let resetTask: MaintenanceTaskDetail;
        try {
          resetTask = await retryMaintenanceTask(numericTaskId);
        } catch (e) {
          const message = e instanceof Error ? e.message : "";
          if (!message.includes("Not Found")) {
            throw e;
          }
          await saveMaintenanceTaskExecutionTimeline(numericTaskId, [], null);
          resetTask = await fetchTaskDetail(numericTaskId);
        }
        syncTaskDetailState(resetTask);
        setRunStartedAtMs(Date.now());
        toast.success("已重置诊断状态，正在重新运行");
        startDiagnosisStream(resetTask);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "重新运行失败");
      }
    })();
  };

  // 导出当前任务的诊断结果数据。
  const exportReport = () => {
    void (async () => {
      if (numericTaskId == null) return;
      try {
        const payload = await fetchTaskExport(numericTaskId);
        const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
        downloadJsonInBrowser(`检修任务-${numericTaskId}-导出-${stamp}.json`, payload);
        toast.success("导出成功，文件已开始下载");
      } catch {
        toast.error("导出失败，请稍后重试");
      }
    })();
  };

  // 基于当前诊断任务创建关联检修工单。
  const createLinkedWorkOrder = () => {
    if (!task) return;
    const token = getMaintenanceToken();
    if (!token) {
      setWorkOrderError("当前未检测到检修域登录状态，无法生成工单。");
      return;
    }
    if (!matchedDevice) {
      setWorkOrderError("当前任务尚未匹配到检修设备，无法生成工单。");
      return;
    }
    setWorkOrderSubmitting(true);
    setWorkOrderError(null);
    void (async () => {
      try {
        const createdWorkOrder = await createWorkOrder(token, {
          device_id: matchedDevice.id,
          maintenance_level: normalizeMaintenanceLevelOption(task.maintenance_level),
          source_task_id: numericTaskId ?? undefined,
        });
        const workOrderId = Number(createdWorkOrder?.id);
        setCreateWorkOrderOpen(false);
        if (Number.isFinite(workOrderId) && workOrderId > 0) {
          setTask((prev) => (prev ? { ...prev, linked_work_order_id: workOrderId } : prev));
          await loadTaskDetail();
          toast.success(`已生成检修工单 #${workOrderId}`);
          router.push(`/tickets/${workOrderId}`);
        } else {
          toast.success("已基于当前诊断任务生成检修工单");
        }
      } catch (e) {
        setWorkOrderError(e instanceof Error ? e.message : "生成工单失败");
      } finally {
        setWorkOrderSubmitting(false);
      }
    })();
  };

  const deviceLabel = task
    ? `${task.equipment_type}${task.equipment_model ? ` ${task.equipment_model}` : ""}`
    : "设备";

  // 将当前诊断结果沉淀为知识案例。
  const createLinkedCase = () => {
    if (!task || numericTaskId == null) return;
    const structured = task.diagnosis_structured;
    const title = structured?.most_likely_fault
      ? `${task.equipment_type} — ${structured.most_likely_fault}`
      : formatSymptomForDisplay(task.symptom_description) || task.title || `任务 #${numericTaskId} 案例`;
    const processingSteps = (structured?.next_steps ?? [])
      .map((s) => (typeof s === "string" ? s : s.title ?? ""))
      .filter(Boolean);
    const payload = {
      title,
      equipment_type: task.equipment_type || "",
      symptom_description: formatSymptomForDisplay(task.symptom_description) || headline,
      processing_steps: processingSteps.length > 0 ? processingSteps : undefined,
      resolution_summary: structured?.preliminary_conclusion || stripReportHeadingMarkdown(extractReportSection(ragConclusion, ["■ 诊断结论", "诊断结论", "结论"])) || undefined,
      equipment_model: task.equipment_model || undefined,
      fault_type: structured?.most_likely_fault || undefined,
      work_order_id: task.linked_work_order_id != null ? String(task.linked_work_order_id) : undefined,
      task_id: numericTaskId,
      knowledge_refs: task.source_refs ?? [],
    };
    setCaseError(null);
    setCaseSubmitting(true);
    void (async () => {
      try {
        const created = await createMaintenanceCase(payload);
        setCreateCaseOpen(false);
        toast.success("案例已沉淀，等待审核后将进入知识库");
        setTask((prev) => (prev ? { ...prev, linked_case_id: created.id } : prev));
      } catch (e) {
        setCaseError(e instanceof Error ? e.message : "沉淀案例失败");
      } finally {
        setCaseSubmitting(false);
      }
    })();
  };

  const headline = useMemo(() => {
    const raw = task?.symptom_description || task?.title || "正在同步任务信息";
    return formatSymptomForDisplay(raw) || raw;
  }, [task?.symptom_description, task?.title]);
  const timelineDuration = useMemo(() => formatTimelineDuration(events), [events]);
  const runningDuration =
    status === "running" && runStartedAtMs != null
      ? formatDurationFromSeconds(Math.max(0, Math.floor((runningNowMs - runStartedAtMs) / 1000)))
      : null;
  const duration =
    status === "running"
      ? runningDuration || "进行中"
      : timelineDuration && timelineDuration !== "不足 1 秒"
        ? timelineDuration
        : (task && hasDiagnosisResultReady
          ? formatDurationBetween(task.run_started_at || task.created_at, task.run_finished_at || task.updated_at)
          : null) ||
          "--";
  const latestReportEvent = [...events].reverse().find((event) => event.type === "report");
  const latestErrorEvent = [...events].reverse().find((event) => event.type === "error");
  const citedRefs = useMemo(() => task?.source_refs ?? [], [task?.source_refs]);
  const conclusionSection = stripReportHeadingMarkdown(
    extractReportSection(ragConclusion, ["■ 诊断结论", "诊断结论", "结论"]),
  );
  const reasonSection = stripReportHeadingMarkdown(
    extractReportSection(ragConclusion, ["■ 原因判断", "原因判断"]),
  );
  const knowledgeSection = stripReportHeadingMarkdown(
    extractReportSection(ragConclusion, ["■ 知识依据", "知识依据"]),
  );
  const llmActionSection = stripReportHeadingMarkdown(
    extractReportSection(ragConclusion, ["■ 建议措施", "建议措施", "■ 下一步建议", "下一步建议"]),
  );
  const llmKnowledgeItems = normalizeSectionItems(knowledgeSection);
  const llmActionItems = normalizeSectionItems(llmActionSection);
  const sourceRefPreview = useMemo(
    () =>
      [...citedRefs]
        .sort((left, right) => {
          const scoreGap = getEvidenceSortScore(right) - getEvidenceSortScore(left);
          if (scoreGap !== 0) return scoreGap;
          return String(left.title || "").localeCompare(String(right.title || ""), "zh-CN");
        }),
    [citedRefs],
  );
  const ragFallbackText =
    citedRefs.length > 0
      ? `系统已结合 ${citedRefs.length} 条检修资料完成本轮诊断，请继续核对现场现象并决定是否生成工单。`
      : "当前诊断信息仍不充分，建议补充设备型号、故障现象或现场图片后重新触发诊断。";
  const structuredDiagnosis = task?.diagnosis_structured ?? null;
  const isProceduralAnswer = structuredDiagnosis?.answer_mode === "procedure";

  const conclusionText =
    !detailLoaded
      ? "正在加载任务详情与诊断结果。"
      : hasDiagnosisResultReady
      ? structuredDiagnosis?.preliminary_conclusion || conclusionSection || ragConclusion || latestReportEvent?.description || ragFallbackText
      : status === "failed"
        ? latestErrorEvent?.description || "协作诊断流中断，建议检查输入信息或重新运行。"
        : structuredDiagnosis?.preliminary_conclusion || conclusionSection || ragConclusion || latestReportEvent?.description || "协作诊断已接入实时流，系统正在整理诊断结论与后续执行步骤。";

  const displayStatus: DisplayStatus = detailLoaded ? status : "loading";
  const statusSummaryMeta = statusMeta[displayStatus];
  const confidenceScore = structuredDiagnosis?.confidence ?? deriveConfidenceScore(citedRefs, reasonSection, conclusionSection, llmActionItems);
  const rootCauseCandidates = structuredDiagnosis?.root_causes?.length
    ? structuredDiagnosis.root_causes.map((item) => ({
        title: item.name,
        confidence: item.confidence,
      evidence: item.evidence,
      }))
    : buildRootCauseCandidates(reasonSection, conclusionSection, citedRefs, confidenceScore);
  const evidenceCount = structuredDiagnosis?.evidence_count ?? citedRefs.length;
  const evidenceSimilarity = getEvidenceSimilarity(citedRefs, confidenceScore, structuredDiagnosis?.top_similarity);
  const rawBackendNextSteps = structuredDiagnosis?.next_steps ?? [];
  const backendStructuredNextSteps = rawBackendNextSteps.filter(isStructuredDiagnosisStep);
  const backendLegacyNextSteps = rawBackendNextSteps.filter((item): item is string => typeof item === "string");
  const hasStructuredBackendSteps = backendStructuredNextSteps.length > 0;
  const normalizedBackendProcedureSteps = hasStructuredBackendSteps
    ? backendStructuredNextSteps.map((item, index) => normalizeStructuredProcedureStep(item, index))
    : [];
  const recommendedSteps = hasStructuredBackendSteps
    ? backendStructuredNextSteps
        .map((item) => tidyChineseProcedureText(item.raw_text || item.title || item.summary || ""))
        .filter(Boolean)
    : dedupeProcedureSteps(backendLegacyNextSteps.length > 0 ? backendLegacyNextSteps : llmActionItems);
  const structuredProcedureSteps = isProceduralAnswer
    ? sortStructuredProcedureSteps(
        hasStructuredBackendSteps
          ? normalizedBackendProcedureSteps
          : recommendedSteps.map((item, index) => parseStructuredProcedureStep(item, index)),
      )
    : [];
  const reasoningProcedureSteps = (
    hasStructuredBackendSteps
      ? sortStructuredProcedureSteps(normalizedBackendProcedureSteps)
      : recommendedSteps.map((item, index) => parseStructuredProcedureStep(item, index))
  ).map((item, index) => buildReasoningProcedureStepHint(item, index));
  const displayedRecommendedSteps = isProceduralAnswer
    ? structuredProcedureSteps.map((item) => `${item.stepNo ? `${item.stepNo}. ` : ""}${item.title}${item.summary ? ` ${item.summary}` : ""}`.trim())
    : hasStructuredBackendSteps
      ? backendStructuredNextSteps.map((item) => tidyChineseProcedureText(item.raw_text || item.title || item.summary || "")).filter(Boolean)
      : recommendedSteps;
  const mostLikelyFault = deriveReadableLikelyFault(
    structuredDiagnosis?.most_likely_fault,
    rootCauseCandidates,
    reasonSection,
    headline,
  );
  const createdAtText = formatDateTimeLocal(task?.created_at);
  const updatedAtText = formatDateTimeLocal(task?.updated_at);
  const visibleTimelineEvents = useMemo(
    () => events.filter((event) => !isPlanningLabel(event.title) && !isPlanningLabel(event.description)),
    [events],
  );
  const collaborationModel = useMemo(
    () => buildAgentCollaborationViewModel(task, events),
    [events, task],
  );
  const structuredEvidenceItems = structuredDiagnosis?.evidence_items ?? [];
  const reasoningChain = task?.reasoning_chain ?? null;
  const reasoningGraphCount =
    (reasoningChain?.matched_entities?.length ?? 0) +
    (reasoningChain?.expanded_relations?.length ?? 0) +
    (reasoningChain?.evidence_chunks?.length ?? 0);
  const keyEvidenceItems: TaskEvidencePanelItem[] = sourceRefPreview.length > 0
    ? sourceRefPreview.map((ref, index) => {
        const modalityMeta = getKnowledgeModalityMeta(ref);
        const excerpt = ref.excerpt?.trim() || llmKnowledgeItems[index] || "当前引用仅返回来源信息，暂无可展示摘录。";
        return {
          id: `${ref.document_id ?? "doc"}-${ref.chunk_id ?? index}`,
          title: ref.title || `知识条目 ${index + 1}`,
          section: getKnowledgeSectionLabel(ref),
          helper: modalityMeta.helper,
          excerpt,
          detailExcerpt: ref.expanded_content?.trim() || excerpt,
          score: formatEvidenceScore(ref, Math.max(40, confidenceScore - index * 8)),
          badges: buildEvidenceBadges(ref, modalityMeta.label),
          group: resolveEvidenceGroup(ref),
          recommendationReason: ref.recommendation_reason?.trim() || modalityMeta.helper,
          sourceName: ref.source_name || ref.title,
          citationLabel: ref.citation_label,
          rawRef: ref,
        };
      })
    : structuredEvidenceItems.map((item, index) => ({
        id: `structured-evidence-${index}`,
        title: item.document_title,
        section: item.section || "命中片段",
        helper: "来自结构化诊断证据摘要",
        excerpt: item.excerpt || "当前引用仅返回来源信息，暂无可展示摘录。",
        detailExcerpt: item.excerpt || "当前引用仅返回来源信息，暂无可展示摘录。",
        score: {
          label: item.relevance_score ? "重排相关度" : "参考相关度",
          value: item.relevance_score ? `${item.relevance_score}%` : `${Math.max(40, confidenceScore - index * 8)}%`,
        },
        badges: ["文本证据"],
        group: "direct",
        recommendationReason: "来自结构化诊断证据摘要",
        sourceName: item.source_name || item.document_title,
        citationLabel: null,
      }));
  const getStepEvidenceItems = (index: number) => {
    if (keyEvidenceItems.length === 0) return [];
    const primary = keyEvidenceItems[Math.min(index, keyEvidenceItems.length - 1)];
    const fallback = keyEvidenceItems[0];
    return [primary, fallback]
      .filter(Boolean)
      .filter((item, itemIndex, list) => list.findIndex((candidate) => candidate.id === item.id) === itemIndex)
      .slice(0, 2);
  };
  const hasImageEvidence = citedRefs.some((ref) => ["ocr", "vision", "image"].includes(String(ref.source_modality || "").toLowerCase()));
  const evidenceStatusNote =
    evidenceCount === 0
      ? "当前未命中稳定证据，建议补充更具体的故障描述、设备型号或更清晰图片。"
      : hasImageEvidence
        ? "本次诊断已启用图片/OCR侧证据，并与文本知识片段联合引用。"
        : "当前仅返回文本侧证据；若现场图片信息关键，建议补充更清晰图片后重新诊断。";
  const workflowStages = useMemo(
    () => {
      const fallbackStages = [
        {
          key: "task_created",
          title: "任务创建",
          done: true,
          active: false,
          helper: "已接收故障描述、设备信息与输入上下文",
        },
        {
          key: "knowledge_retrieval",
          title: "知识检索",
          done: keyEvidenceItems.length > 0 || events.length > 0,
          active: status === "running" && keyEvidenceItems.length === 0,
          helper: keyEvidenceItems.length > 0 ? `已命中 ${keyEvidenceItems.length} 条核心证据` : "正在召回知识依据",
        },
        {
          key: "workflow_actions",
          title: "链路完成步骤输出",
          done: displayedRecommendedSteps.length > 0,
          active: status === "running" && displayedRecommendedSteps.length === 0,
          helper:
            displayedRecommendedSteps.length > 0
              ? `已整理 ${displayedRecommendedSteps.length} 条链路完成步骤`
              : "等待诊断结果生成链路完成步骤",
        },
        {
          key: "work_order",
          title: "生成工单",
          done: task?.linked_work_order_id != null,
          active: status === "completed" && task?.linked_work_order_id == null,
          helper: task?.linked_work_order_id != null
            ? `工单 #${task.linked_work_order_id} 已生成`
            : status === "completed"
              ? "诊断已结束，可进入工单生成"
              : status === "diagnosis_completed"
                ? "诊断结果已生成，待流程收口后再生成工单"
                : "需先完成诊断后再生成工单",
        },
        {
          key: "knowledge_case",
          title: "沉淀案例",
          done: task?.linked_case_id != null,
          active: task?.linked_work_order_id != null && task?.linked_case_id == null,
          helper: task?.linked_case_id != null
            ? `案例 #${task.linked_case_id} 已沉淀`
            : "工单闭环后可继续沉淀为知识案例",
        },
      ];
      const backendStages = task?.workflow_stages;
      if (!backendStages || backendStages.length === 0) {
        return fallbackStages;
      }
      return backendStages.map((stage) => {
        if (stage.key === "work_order") {
          return {
            ...stage,
            helper: stage.done && task?.linked_work_order_id != null
              ? `工单 #${task.linked_work_order_id} 已生成`
              : stage.helper,
          };
        }
        if (stage.key === "knowledge_case") {
          return {
            ...stage,
            helper: stage.done && task?.linked_case_id != null
              ? `案例 #${task.linked_case_id} 已沉淀`
              : stage.helper,
          };
        }
        return stage;
      });
    },
    [displayedRecommendedSteps.length, events.length, keyEvidenceItems.length, status, task?.linked_case_id, task?.linked_work_order_id, task?.workflow_stages],
  );
  const workflowTotalCount =
    task?.workflow_total && task.workflow_total > 0
      ? task.workflow_total
      : workflowStages.length;

  const workflowDoneCount =
    typeof task?.workflow_completed === "number"
      ? Math.max(0, Math.min(task.workflow_completed, workflowTotalCount))
      : workflowStages.filter((item) => item.done).length;
  const workspaceTabs: Array<{
    key: DiagnosisWorkspaceTab;
    label: string;
    helper: string;
    badge?: string;
    icon: typeof FileCode;
  }> = [
    {
      key: "fault",
      label: isProceduralAnswer ? "操作主题" : "最可能故障",
      helper: isProceduralAnswer ? "当前查询的操作对象" : "当前优先排查对象",
      icon: FileCode,
    },
    {
      key: "actions",
      label: isProceduralAnswer ? "操作步骤" : "建议动作",
      helper: isProceduralAnswer ? "按手册证据整理的步骤" : "建议先执行的动作",
      badge: `${displayedRecommendedSteps.length}`,
      icon: Wrench,
    },
    {
      key: "evidence",
      label: "关键证据来源",
      helper: "当前诊断引用的核心证据",
      badge: `${keyEvidenceItems.length}`,
      icon: Server,
    },
    {
      key: "reasoning",
      label: "推理子图",
      helper: "问题、实体、关系与证据路径",
      badge: `${reasoningGraphCount}`,
      icon: Network,
    },
    {
      key: "agent",
      label: "Agent 协作子图",
      helper: "修订、重规划与最终收束",
      badge: `${collaborationModel.revisionRounds}`,
      icon: GitBranch,
    },
    {
      key: "timeline",
      label: "诊断时间线",
      helper: "系统进展摘要与阶段记录",
      badge: `${visibleTimelineEvents.length}`,
      icon: Clock,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="app-main space-y-6 pb-10">
        <section className="app-page-head">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href={backHref}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Link>
                  <span className="app-chip-muted">任务 #{taskId}</span>
                  <StatusBadge status={displayStatus} />
                </div>
                <div className="mt-4 space-y-1.5">
                  <h1 className="text-2xl font-semibold text-foreground">{deviceLabel}</h1>
                  <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{headline}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="app-btn-secondary px-3 py-1.5"
                  onClick={() => {
                    void (async () => {
                      try {
                        await navigator.clipboard.writeText(window.location.href);
                        await fetchHealth();
                        toast.success("复制链接成功");
                      } catch {
                        toast.error("复制链接失败，请检查浏览器权限");
                      }
                    })();
                  }}
                >
                  <Share2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="app-btn-secondary px-3 py-1.5 disabled:opacity-40"
                  disabled={status !== "completed"}
                  onClick={exportReport}
                >
                  <Download className="h-4 w-4" />
                </button>
                <button className="app-btn-primary px-3 py-1.5" onClick={retry} disabled={status === "running"}>
                  <RefreshCw className={`h-4 w-4 ${status === "running" ? "animate-spin" : ""}`} />
                  {status === "pending" ? "开始运行" : "重新运行"}
                </button>
                <button
                  type="button"
                  className="app-btn-secondary px-3 py-1.5 disabled:opacity-40"
                  disabled={status !== "completed" || task?.linked_work_order_id != null}
                  onClick={() => setCreateWorkOrderOpen(true)}
                  title={
                    task?.linked_work_order_id != null
                      ? `工单 #${task.linked_work_order_id} 已生成，如删除工单后可重新生成`
                      : status !== "completed"
                        ? "需先完成诊断后再生成工单"
                        : "基于当前诊断结果生成检修工单"
                  }
                >
                  生成工单
                </button>
                <button
                  type="button"
                  className="app-btn-secondary px-3 py-1.5 disabled:opacity-40"
                  disabled={task?.linked_work_order_id == null || task?.linked_case_id != null}
                  onClick={() => setCreateCaseOpen(true)}
                  title={
                    task?.linked_case_id != null
                      ? `案例 #${task.linked_case_id} 已沉淀`
                      : task?.linked_work_order_id == null
                        ? "需先生成工单后才能沉淀案例"
                        : "将本次诊断结果沉淀为知识案例"
                  }
                >
                  <BookOpen className="h-4 w-4" />
                  {task?.linked_case_id != null ? "已沉淀" : "沉淀案例"}
                </button>
              </div>
            </div>

            <div className={`rounded-xl border p-4 ${statusSummaryMeta.panelClass}`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{statusSummaryMeta.label}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{statusSummaryMeta.summary}</p>
                  <div className="mt-4">
                    <div className="rounded-lg border border-emerald-500/15 bg-background/45 p-3">
                      <div className="text-xs text-muted-foreground">{isProceduralAnswer ? "操作主题" : "最可能故障"}</div>
                      <div className="mt-1 text-sm font-medium leading-6 text-foreground">{mostLikelyFault}</div>
                    </div>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:max-w-[520px]">
                  <OverviewItem label="创建时间" value={createdAtText} icon={Clock} />
                  <OverviewItem label="更新时间" value={updatedAtText} icon={Clock} />
                  <OverviewItem label="建议动作数" value={`${displayedRecommendedSteps.length} 条`} icon={Wrench} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {!detailLoaded ? <TaskDetailSkeleton /> : <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <section className="app-card p-5">
              <div className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-foreground">
                <FileText className="h-4 w-4 text-muted-foreground" />
                任务概览
              </div>
              <div className="grid gap-3">
                <div className="rounded-lg border border-border bg-muted/35 p-3">
                  <div className="mb-1 text-xs text-muted-foreground">任务摘要</div>
                  <div className="text-sm leading-6 text-foreground">{headline}</div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <OverviewItem
                    label="链路环节完成数"
                    value={`${workflowDoneCount}/${workflowTotalCount}`}
                    icon={Cpu}
                  />
                  <OverviewItem label="诊断耗时" value={duration} icon={Clock} />
                </div>
                <div className="rounded-lg border border-border bg-background/70 p-3">
                  <div className="mb-2 text-xs text-muted-foreground">页面链路环节</div>
                  <div className="space-y-2">
                    {workflowStages.map((item, index) => (
                      <div key={item.title} className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium ${
                            item.done
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : item.active
                                ? "border-[#5e6ad2]/30 bg-[#5e6ad2]/10 text-[#5e6ad2]"
                                : "border-border bg-muted/40 text-muted-foreground"
                          }`}
                        >
                          {index + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">{item.title}</div>
                          <div className="text-xs leading-5 text-muted-foreground">{item.helper}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </aside>

          <section className="space-y-4">
            <div id="task-handle-panel" className="app-card p-5">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-4 border-b border-border pb-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="inline-flex items-center gap-2 text-base font-semibold text-foreground">
                          <FileCode className="h-4 w-4 text-muted-foreground" />
                          诊断工作区
                        </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {isProceduralAnswer
                          ? "在同一张卡片内切换查看操作主题、操作步骤、关键证据来源、协作子图和诊断时间线。"
                          : "在同一张卡片内切换查看最可能故障、建议动作、关键证据来源、协作子图和诊断时间线。"}
                      </p>
                    </div>
                    <span className="app-chip-muted">
                      {status === "running" ? "诊断执行中" : status === "completed" ? "诊断已完成" : status === "diagnosis_completed" ? "待收口" : "待重新运行"}
                    </span>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                    {workspaceTabs.map((tab) => {
                      const Icon = tab.icon;
                      const active = activeWorkspaceTab === tab.key;
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setActiveWorkspaceTab(tab.key)}
                          className={`flex min-h-[84px] flex-col items-start justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                            active
                              ? "border-emerald-500/25 bg-emerald-500/8 shadow-sm"
                              : "border-border bg-background/70 hover:bg-muted/35"
                          }`}
                        >
                          <div className="flex w-full items-center justify-between gap-3">
                            <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card">
                              <Icon className={`h-4 w-4 ${active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`} />
                            </div>
                            {tab.badge ? <span className="app-chip-muted">{tab.badge}</span> : null}
                          </div>
                          <div className="mt-3">
                            <div className="text-sm font-medium text-foreground">{tab.label}</div>
                            <div className="mt-1 text-xs leading-5 text-muted-foreground">{tab.helper}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {activeWorkspaceTab === "fault" ? (
                  <div>
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="inline-flex items-center gap-2 text-base font-semibold text-foreground">
                          <FileCode className="h-4 w-4 text-muted-foreground" />
                          {isProceduralAnswer ? "操作主题" : "最可能故障"}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {isProceduralAnswer ? "这里展示当前问题对应的操作对象与整理说明。" : "这里只展示当前最优先排查的故障项或对象。"}
                        </p>
                      </div>
                    </div>

                    <div className={`rounded-xl border p-5 ${statusSummaryMeta.panelClass}`}>
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                          {status === "running" ? (
                            <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
                          ) : status === "completed" ? (
                            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                          ) : status === "diagnosis_completed" ? (
                            <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                          ) : (
                            <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="rounded-lg border border-border/70 bg-background/50 p-4">
                            <div className="text-xs font-medium text-muted-foreground">{isProceduralAnswer ? "操作主题" : "最可能故障"}</div>
                            <div className="mt-2 text-base font-semibold leading-7 text-foreground">{mostLikelyFault}</div>
                            <div className="mt-3 text-sm leading-7 text-muted-foreground">{conclusionText}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activeWorkspaceTab === "actions" ? (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/6 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-semibold text-foreground">{isProceduralAnswer ? "操作步骤" : "建议动作"}</div>
                      <span className="text-xs text-muted-foreground">
                        {isProceduralAnswer
                          ? `按证据整理的推荐顺序，共 ${displayedRecommendedSteps.length} 步`
                          : `建议先执行的动作，共 ${displayedRecommendedSteps.length} 条`}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {displayedRecommendedSteps.length > 0 ? (
                        isProceduralAnswer ? structuredProcedureSteps.map((item, index) => {
                          const stepEvidenceItems = getStepEvidenceItems(index);
                          return (
                          <div
                            key={item.key}
                            className="rounded-lg border border-emerald-500/10 bg-background/55 px-4 py-4"
                          >
                            <div className="flex items-start gap-3">
                              <div className="flex h-7 min-w-7 items-center justify-center rounded-full bg-emerald-500/12 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                                {item.stepNo ?? index + 1}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold leading-6 text-foreground">{item.title}</div>
                                {item.summary ? (
                                  <div className="mt-1 text-sm leading-6 text-muted-foreground">{item.summary}</div>
                                ) : null}
                                {item.sections.length > 0 ? (
                                  <div className="mt-3 space-y-3">
                                    {item.sections.map((section, sectionIndex) => (
                                      <div key={`${item.key}-section-${sectionIndex}-${section.label || "section"}`}>
                                        <div className="text-xs font-medium text-muted-foreground">{section.label}：</div>
                                        <ul className="mt-2 space-y-1.5 pl-5 text-sm leading-6 text-foreground/90">
                                          {section.items.map((sectionItem, sectionItemIndex) => (
                                            <li
                                              key={`${item.key}-section-${sectionIndex}-item-${sectionItemIndex}-${sectionItem || "item"}`}
                                              className="list-disc"
                                            >
                                              {sectionItem}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                                {item.meta.length > 0 ? (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {item.meta.map((metaItem, metaIndex) => (
                                      <span
                                        key={`${item.key}-meta-${metaIndex}-${metaItem || "meta"}`}
                                        className="rounded-md border border-border bg-muted/35 px-2.5 py-1 text-xs text-foreground/85"
                                      >
                                        {metaItem}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                                {stepEvidenceItems.length > 0 ? (
                                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                    <span className="font-medium text-foreground/80">依据</span>
                                    {stepEvidenceItems.map((evidence) => (
                                      <span key={`${item.key}-${evidence.id}`} className="rounded-md border border-border bg-muted/35 px-2.5 py-1">
                                        {evidence.title} · {evidence.section}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          );
                        }) : displayedRecommendedSteps.map((item, index) => {
                          const stepEvidenceItems = getStepEvidenceItems(index);
                          return (
                          <div key={`${item}-${index}`} className="flex flex-col gap-2 rounded-lg border border-emerald-500/10 bg-background/45 px-3 py-3 text-sm text-foreground">
                            <div className="flex items-start gap-2">
                              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                              <span className="leading-6">{item}</span>
                            </div>
                            {stepEvidenceItems.length > 0 ? (
                              <div className="flex flex-wrap gap-2 pl-3 text-xs text-muted-foreground">
                                <span className="font-medium text-foreground/80">依据</span>
                                {stepEvidenceItems.map((evidence) => (
                                  <span key={`${item}-${index}-${evidence.id}`} className="rounded-md border border-border bg-muted/35 px-2.5 py-1">
                                    {evidence.title} · {evidence.section}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          );
                        })
                      ) : (
                        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
                          {isProceduralAnswer ? "当前尚未整理出可执行的操作步骤。" : "当前尚未生成可执行的建议动作。"}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {activeWorkspaceTab === "evidence" ? (
                  <div className="rounded-xl border border-border bg-background/70 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-semibold text-foreground">关键证据来源</div>
                      <span className="text-xs text-muted-foreground">当前诊断引用的核心证据</span>
                    </div>
                    <TaskEvidencePanel
                      items={keyEvidenceItems}
                      evidenceCount={evidenceCount}
                      evidenceSimilarity={evidenceSimilarity}
                      evidenceStatusNote={evidenceStatusNote}
                      reasoningChain={reasoningChain}
                    />
                  </div>
                ) : null}

                {activeWorkspaceTab === "reasoning" ? (
                  <ReasoningSubgraphPanel reasoningChain={reasoningChain} procedureSteps={reasoningProcedureSteps} />
                ) : null}

                {activeWorkspaceTab === "agent" ? (
                  <AgentCollaborationPanel model={collaborationModel} />
                ) : null}

                {activeWorkspaceTab === "timeline" ? (
                  <div className="rounded-xl border border-border bg-background/70 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-semibold text-foreground">诊断时间线</div>
                      <span className="text-xs text-muted-foreground">系统进展摘要与阶段记录</span>
                    </div>
                    {visibleTimelineEvents.length > 0 ? (
                      <div className="space-y-3 rounded-2xl border border-border bg-muted/15 p-4 sm:p-5">
                        {visibleTimelineEvents.map((event, index) => (
                          <div
                            key={event.id || `${event.type}-${index}`}
                            className="flex items-start gap-3"
                          >
                            <div className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-semibold shadow-sm ${getTimelineEventVisual(event.type).badgeClass}`}>
                              {index + 1}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex items-center gap-2 pl-1">
                                <span className="text-xs font-medium text-foreground">诊断引擎</span>
                                <span className="text-[11px] text-muted-foreground">{formatDateTimeLocal(event.time)}</span>
                              </div>
                              <div className={`relative rounded-2xl border px-4 py-3 shadow-sm ${getTimelineEventVisual(event.type).bubbleClass}`}>
                                <div className="absolute left-[-7px] top-4 h-3.5 w-3.5 rotate-45 border-b border-l border-inherit bg-inherit" />
                                <div className="text-sm font-semibold leading-6 text-foreground">{event.title || "阶段更新"}</div>
                                <div className="mt-1 text-sm leading-7 text-muted-foreground">
                                  {event.description || "系统已记录该阶段执行情况。"}
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  <span className="app-chip-muted">阶段 {index + 1}</span>
                                  <span className="rounded-full border border-border bg-background/80 px-2 py-0.5">
                                    {event.type}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
                        当前暂无可展示的诊断时间线。
                      </div>
                    )}
                  </div>
                ) : null}

              </div>
            </div>
          </section>
        </div>}
      </main>

      <Dialog open={createWorkOrderOpen} onOpenChange={setCreateWorkOrderOpen}>
        <DialogContent className="max-w-md border-border bg-popover text-popover-foreground">
          <DialogHeader>
            <DialogTitle>基于诊断生成工单</DialogTitle>
            <DialogDescription>
              检修工单需在智能诊断完成后生成，系统会按当前任务的设备编号与检修等级建立工单。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/25 p-3 text-sm">
              <div className="text-xs text-muted-foreground">当前任务</div>
              <div className="mt-1 font-medium text-foreground">{headline}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                设备编号：{task?.asset_code || "未提供"} · 检修等级：{task?.maintenance_level || "standard"}
              </div>
            </div>
            <div
              className={`min-h-[100px] rounded-lg px-4 py-4 text-sm transition-colors ${
                matchedDevice
                  ? "border border-border bg-muted/25"
                  : workOrderError
                    ? "border border-dashed border-red-300/60 bg-red-50/70 text-red-500"
                    : "border border-dashed border-border bg-muted/20 text-muted-foreground"
              }`}
            >
              {matchedDevice ? (
                <>
                  <div className="text-xs text-muted-foreground">已匹配检修设备</div>
                  <div className="mt-1 font-medium text-foreground">
                    #{matchedDevice.id} · {matchedDevice.asset_code || "无编号"} · {matchedDevice.device_type}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    型号：{matchedDevice.model || "未提供"}{matchedDevice.location ? ` · 位置：${matchedDevice.location}` : ""}
                  </div>
                </>
              ) : workOrderError ? (
                <div className="flex min-h-[68px] items-center">
                  检修设备匹配失败，请先确认检修后端可用且当前登录状态有效。
                </div>
              ) : (
                <div className="flex min-h-[68px] items-center">正在匹配检修设备...</div>
              )}
            </div>
            <div className="min-h-[20px] text-sm text-red-400">
              {workOrderError || ""}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="border-border" onClick={() => setCreateWorkOrderOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              className="bg-[#5e6ad2] text-white hover:bg-[#6b77db]"
              disabled={workOrderSubmitting || matchingDevice || !matchedDevice}
              onClick={createLinkedWorkOrder}
            >
              {workOrderSubmitting ? "生成中…" : "确认生成工单"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createCaseOpen} onOpenChange={setCreateCaseOpen}>
        <DialogContent className="max-w-md border-border bg-popover text-popover-foreground">
          <DialogHeader>
            <DialogTitle>沉淀为知识案例</DialogTitle>
            <DialogDescription>
              将本次诊断结果提交为案例，经审核后将自动录入知识库供后续诊断引用。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/25 p-3 text-sm">
              <div className="text-xs text-muted-foreground">案例标题（预览）</div>
              <div className="mt-1 font-medium text-foreground">
                {task?.diagnosis_structured?.most_likely_fault
                  ? `${task.equipment_type} — ${task.diagnosis_structured.most_likely_fault}`
                  : formatSymptomForDisplay(task?.symptom_description) || task?.title || `任务 #${numericTaskId} 案例`}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/25 p-3 text-sm">
              <div className="text-xs text-muted-foreground">关联信息</div>
              <div className="mt-1 text-foreground">
                设备：{task?.equipment_type}{task?.equipment_model ? ` ${task.equipment_model}` : ""}
              </div>
              {task?.linked_work_order_id != null && (
                <div className="mt-1 text-xs text-muted-foreground">关联工单 #{task.linked_work_order_id}</div>
              )}
            </div>
            {caseError ? (
              <div className="text-sm text-red-400">{caseError}</div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="border-border" onClick={() => setCreateCaseOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              className="bg-[#5e6ad2] text-white hover:bg-[#6b77db]"
              disabled={caseSubmitting}
              onClick={createLinkedCase}
            >
              {caseSubmitting ? "提交中…" : "确认沉淀"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
