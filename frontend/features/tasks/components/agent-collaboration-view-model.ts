import type {
  AgentCritiqueItem,
  AgentCurrentPlanItem,
  AgentFinalResolution,
  AgentReplanItem,
  ApprovalTaskItem,
  MaintenanceTaskDetail,
} from "@/shared/lib/http";

type TimelineEvent = NonNullable<MaintenanceTaskDetail["execution_timeline"]>[number];

export type AgentCollaborationPlanItem = {
  key: string;
  label: string;
  iteration: number;
  status: "completed" | "running" | "attention" | "failed";
  helper: string;
};

export type AgentCollaborationCritique = {
  verdict: string;
  targetStage: string | null;
  summary: string;
  issues: string[];
  time: string;
};

export type AgentCollaborationReplan = {
  action: string;
  targetStage: string | null;
  reason: string;
  time: string;
};

export type AgentCollaborationDecision = {
  key: string;
  agent: string;
  status: AgentCollaborationPlanItem["status"];
  input: string;
  basis: string[];
  output: string;
  time: string;
};

export type AgentCollaborationHandoff = {
  key: string;
  from: string;
  to: string;
  summary: string;
  time: string;
};

export type AgentCollaborationModel = {
  activeAgentCount: number;
  handoffs: AgentCollaborationHandoff[];
  decisions: AgentCollaborationDecision[];
  revisionRounds: number;
  currentPlan: AgentCollaborationPlanItem[];
  critiques: AgentCollaborationCritique[];
  replans: AgentCollaborationReplan[];
  finalResolution: AgentFinalResolution | null;
  approvalTask: ApprovalTaskItem | null;
};

const STAGE_LABELS: Record<string, string> = {
  perception: "感知 Agent",
  diagnosis: "诊断 Agent",
  planning: "规划 Agent",
  review: "审核 Agent",
  knowledge: "知识库 Agent",
  system: "系统编排",
};

const AGENT_KEYWORDS: Array<{ key: keyof typeof STAGE_LABELS; terms: string[] }> = [
  { key: "perception", terms: ["感知", "图片", "图像", "ocr", "多模态"] },
  { key: "knowledge", terms: ["知识", "召回", "引用", "检索", "证据"] },
  { key: "diagnosis", terms: ["诊断", "报告", "结论", "rag"] },
  { key: "planning", terms: ["规划", "步骤", "工单", "任务预览", "执行动作"] },
  { key: "review", terms: ["审核", "复核", "风险", "审批", "授权"] },
  { key: "system", terms: ["sse", "连接", "流水线", "图执行", "收束"] },
];

function stageLabel(stageName: string | null | undefined) {
  const normalized = String(stageName || "").trim().toLowerCase();
  return STAGE_LABELS[normalized] || String(stageName || "").trim() || "未命名阶段";
}

function inferAgentLabelFromEvent(event: TimelineEvent) {
  const detailMap = parseDetail(event.detail);
  const explicitStage = detailMap.agent_name || detailMap.stage_name || detailMap.target_stage;
  if (explicitStage) return stageLabel(explicitStage);

  const searchable = `${event.title || ""} ${event.description || ""} ${event.type || ""}`.toLowerCase();
  const matched = AGENT_KEYWORDS.find((item) => item.terms.some((term) => searchable.includes(term.toLowerCase())));
  return matched ? stageLabel(matched.key) : "系统编排";
}

function parseDetail(detail: string | null | undefined) {
  return String(detail || "")
    .split(";")
    .map((item) => item.trim())
    .reduce<Record<string, string>>((acc, item) => {
      const [key, ...rest] = item.split("=");
      if (!key || rest.length === 0) return acc;
      acc[key.trim()] = rest.join("=").trim();
      return acc;
    }, {});
}

function parseIssues(value: string | null | undefined) {
  return String(value || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBool(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true";
}

function compactText(value: string | null | undefined, fallback: string) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized;
}

function detailBasis(detailMap: Record<string, string>) {
  return Object.entries(detailMap)
    .filter(([, value]) => String(value || "").trim())
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${value}`);
}

function approvalState(task: ApprovalTaskItem | null | undefined) {
  if (!task) return null;
  if (task.approval_state) return String(task.approval_state);
  if (task.status === "pending") return "pending";
  return task.resolution || task.status || null;
}

function normalizePlanStatus(value: string | null | undefined): AgentCollaborationPlanItem["status"] {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "completed") return "completed";
  if (normalized === "running" || normalized === "in_progress") return "running";
  if (normalized === "failed" || normalized === "degraded") return "failed";
  return "attention";
}

function buildPlanFromCurrentPlan(currentPlan: AgentCurrentPlanItem[] | undefined) {
  return (currentPlan || []).map((item, index) => ({
    key: `${item.stage_name}-${item.iteration}-${index}`,
    label: stageLabel(item.stage_name),
    iteration: Number(item.iteration || 1),
    status: normalizePlanStatus(item.status),
    helper: String(item.metadata?.title || item.reason || item.status || "已记录当前计划"),
  }));
}

function buildCritiquesFromPayload(critiques: AgentCritiqueItem[] | undefined) {
  return (critiques || []).map((item) => ({
    verdict: item.verdict,
    targetStage: item.target_stage || null,
    summary: item.summary,
    issues: item.issues || [],
    time: "",
  }));
}

function buildReplansFromPayload(replans: AgentReplanItem[] | undefined) {
  return (replans || []).map((item) => ({
    action: item.action,
    targetStage: item.target_stage || null,
    reason: item.reason,
    time: "",
  }));
}

function inferPlanLabel(event: TimelineEvent, detailMap: Record<string, string>) {
  if (event.type === "revision_requested") {
    return stageLabel(detailMap.target_stage || event.title.replace(/\s*需要修订\s*$/u, ""));
  }
  if (event.title?.trim()) return event.title.trim();
  return null;
}

function buildPlanFromTimeline(events: TimelineEvent[]) {
  const planItems: AgentCollaborationPlanItem[] = [];
  const iterationByLabel = new Map<string, number>();
  const openIndexByLabel = new Map<string, number>();

  const pushPlan = (
    label: string,
    status: AgentCollaborationPlanItem["status"],
    helper: string,
    iteration: number,
  ) => {
    const key = `${label}-${iteration}-${planItems.length}`;
    planItems.push({ key, label, iteration, status, helper });
    return planItems.length - 1;
  };

  for (const event of events) {
    const detailMap = parseDetail(event.detail);
    const label = inferPlanLabel(event, detailMap);
    if (!label) continue;

    if (event.type === "node_start") {
      const iteration = (iterationByLabel.get(label) || 0) + 1;
      iterationByLabel.set(label, iteration);
      const index = pushPlan(label, "running", event.description || "阶段执行中", iteration);
      openIndexByLabel.set(label, index);
      continue;
    }

    if (event.type === "node_finish") {
      const openIndex = openIndexByLabel.get(label);
      if (openIndex != null) {
        planItems[openIndex] = { ...planItems[openIndex], status: "completed", helper: event.description || "阶段已完成" };
        openIndexByLabel.delete(label);
      } else {
        const iteration = iterationByLabel.get(label) || 1;
        pushPlan(label, "completed", event.description || "阶段已完成", iteration);
      }
      continue;
    }

    if (event.type === "revision_requested") {
      const iteration = Number(detailMap.revision_round || (iterationByLabel.get(label) || 0) + 1);
      iterationByLabel.set(label, iteration);
      pushPlan(label, "attention", event.description || "等待修订", iteration);
      continue;
    }

    if (event.type === "error") {
      const iteration = iterationByLabel.get(label) || 1;
      pushPlan(label, "failed", event.description || "阶段执行失败", iteration);
    }
  }

  return planItems;
}

function buildCritiquesFromTimeline(events: TimelineEvent[]) {
  return events
    .filter((event) => event.type === "critique")
    .map((event) => {
      const detailMap = parseDetail(event.detail);
      return {
        verdict: detailMap.verdict || "unknown",
        targetStage: detailMap.target_stage || null,
        summary: event.description || event.title || "已生成审核意见",
        issues: parseIssues(detailMap.issues),
        time: event.time,
      };
    });
}

function buildReplansFromTimeline(events: TimelineEvent[]) {
  return events
    .filter((event) => event.type === "replan")
    .map((event) => {
      const detailMap = parseDetail(event.detail);
      return {
        action: detailMap.action || "unknown",
        targetStage: detailMap.target_stage || null,
        reason: event.description || detailMap.reason || "已完成重规划",
        time: event.time,
      };
    });
}

function buildFinalResolutionFromTimeline(events: TimelineEvent[]): AgentFinalResolution | null {
  const termination = [...events]
    .reverse()
    .find((event) => event.type === "termination" || event.type === "agent_approval_requested" || event.type === "agent_manual_review_required");
  if (!termination) return null;
  const detailMap = parseDetail(termination.detail);
  const approvalTaskId = Number(detailMap.approval_task_id);
  return {
    status: detailMap.status || "completed",
    reason: termination.description || "pipeline_completed",
    manual_review_required: parseBool(detailMap.manual_review_required),
    approval_task_id: Number.isFinite(approvalTaskId) ? approvalTaskId : null,
    approval_state: detailMap.approval_state || null,
    blocking_reason: termination.description || null,
  };
}

function buildHandoffsFromTimeline(events: TimelineEvent[]) {
  const handoffs: AgentCollaborationHandoff[] = [];
  let previousAgent: string | null = null;

  events.forEach((event, index) => {
    if (event.type === "connected") return;
    const currentAgent = inferAgentLabelFromEvent(event);
    if (!previousAgent) {
      previousAgent = currentAgent;
      return;
    }
    if (currentAgent === previousAgent) return;

    handoffs.push({
      key: `${previousAgent}-${currentAgent}-${index}`,
      from: previousAgent,
      to: currentAgent,
      summary: compactText(event.description || event.title, "接收上游阶段结果并继续处理。"),
      time: event.time,
    });
    previousAgent = currentAgent;
  });

  return handoffs;
}

function buildDecisionsFromTimeline(
  events: TimelineEvent[],
  detail: MaintenanceTaskDetail | null | undefined,
) {
  const decisions = new Map<string, AgentCollaborationDecision>();
  const sourceRefs = detail?.source_refs || [];
  const structured = detail?.diagnosis_structured;

  events.forEach((event, index) => {
    if (!["node_finish", "node_skip", "critique", "revision_requested", "replan", "termination", "agent_pipeline_completed", "report", "degradation"].includes(event.type)) {
      return;
    }
    const agent = inferAgentLabelFromEvent(event);
    const detailMap = parseDetail(event.detail);
    const existing = decisions.get(agent);
    const basis = [
      ...detailBasis(detailMap),
      ...(agent === "知识库 Agent" && sourceRefs.length > 0
        ? sourceRefs.slice(0, 2).map((ref) => `${ref.citation_label || "证据"}: ${ref.title || ref.source_name || "知识片段"}`)
        : []),
      ...(agent === "诊断 Agent" && structured?.most_likely_fault
        ? [`结论候选: ${structured.most_likely_fault}`]
        : []),
    ].filter(Boolean);

    decisions.set(agent, {
      key: existing?.key || `${agent}-${index}`,
      agent,
      status: normalizePlanStatus(event.type === "node_skip" ? "skipped" : event.type === "degradation" ? "degraded" : "completed"),
      input: existing?.input || (index === 0 ? "接收用户录入的故障现象、设备信息和附件上下文。" : "接收上游 Agent 的阶段产出。"),
      basis: Array.from(new Set([...(existing?.basis || []), ...basis])).slice(0, 5),
      output: compactText(event.description || event.title, "已形成阶段性结果。"),
      time: event.time || existing?.time || "",
    });
  });

  if (decisions.size === 0 && structured) {
    decisions.set("诊断 Agent", {
      key: "diagnosis-structured",
      agent: "诊断 Agent",
      status: "completed",
      input: "接收知识证据与任务上下文。",
      basis: [
        structured.most_likely_fault ? `结论候选: ${structured.most_likely_fault}` : "",
        structured.confidence != null ? `置信度: ${structured.confidence}%` : "",
      ].filter(Boolean),
      output: compactText(structured.preliminary_conclusion, "已生成结构化诊断结论。"),
      time: "",
    });
  }

  return Array.from(decisions.values());
}

export function buildAgentCollaborationViewModel(
  detail: MaintenanceTaskDetail | null | undefined,
  runtimeEvents: TimelineEvent[],
): AgentCollaborationModel {
  const persistedPlan = buildPlanFromCurrentPlan(detail?.current_plan);
  const persistedCritiques = buildCritiquesFromPayload(detail?.critiques);
  const persistedReplans = buildReplansFromPayload(detail?.replans);
  const approvalTask =
    detail?.approval_tasks?.find((task) => String(task.source_type || "") === "agent_review") ?? null;
  const taskApprovalState = approvalState(approvalTask);
  const finalResolution: AgentFinalResolution | null =
    detail?.final_resolution || buildFinalResolutionFromTimeline(runtimeEvents);
  const decisions = buildDecisionsFromTimeline(runtimeEvents, detail);
  const handoffs = buildHandoffsFromTimeline(runtimeEvents);
  const activeAgentCount = new Set([
    ...decisions.map((item) => item.agent),
    ...handoffs.flatMap((item) => [item.from, item.to]),
    ...persistedPlan.map((item) => item.label),
  ]).size;
  const mergedFinalResolution =
    finalResolution || approvalTask
      ? {
          ...(finalResolution || {
            status: "completed",
            reason: approvalTask?.reason || "agent_approval_requested",
          }),
          manual_review_required:
            finalResolution?.manual_review_required ?? Boolean(approvalTask && taskApprovalState !== "approved"),
          approval_task_id: finalResolution?.approval_task_id ?? approvalTask?.id ?? null,
          approval_state: finalResolution?.approval_state ?? taskApprovalState,
          approval_status: finalResolution?.approval_status ?? approvalTask?.status ?? null,
          approval_blocking: finalResolution?.approval_blocking ?? approvalTask?.blocking ?? false,
          blocking_reason: finalResolution?.blocking_reason ?? approvalTask?.reason ?? null,
        }
      : null;

  return {
    activeAgentCount,
    handoffs,
    decisions,
    revisionRounds:
      Number(detail?.revision_rounds) ||
      runtimeEvents.filter((event) => event.type === "revision_requested").length,
    currentPlan: persistedPlan.length > 0 ? persistedPlan : buildPlanFromTimeline(runtimeEvents),
    critiques: persistedCritiques.length > 0 ? persistedCritiques : buildCritiquesFromTimeline(runtimeEvents),
    replans: persistedReplans.length > 0 ? persistedReplans : buildReplansFromTimeline(runtimeEvents),
    finalResolution: mergedFinalResolution,
    approvalTask,
  };
}
