import type {
  AgentCritiqueItem,
  AgentCurrentPlanItem,
  AgentFinalResolution,
  AgentReplanItem,
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

export type AgentCollaborationModel = {
  revisionRounds: number;
  currentPlan: AgentCollaborationPlanItem[];
  critiques: AgentCollaborationCritique[];
  replans: AgentCollaborationReplan[];
  finalResolution: AgentFinalResolution | null;
};

const STAGE_LABELS: Record<string, string> = {
  perception: "感知 Agent",
  diagnosis: "诊断 Agent",
  planning: "规划 Agent",
  review: "审核 Agent",
  knowledge: "知识库 Agent",
};

function stageLabel(stageName: string | null | undefined) {
  const normalized = String(stageName || "").trim().toLowerCase();
  return STAGE_LABELS[normalized] || String(stageName || "").trim() || "未命名阶段";
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

function buildFinalResolutionFromTimeline(events: TimelineEvent[]) {
  const termination = [...events].reverse().find((event) => event.type === "termination");
  if (!termination) return null;
  const detailMap = parseDetail(termination.detail);
  return {
    status: detailMap.status || "completed",
    reason: termination.description || "pipeline_completed",
    manual_review_required: parseBool(detailMap.manual_review_required),
  };
}

export function buildAgentCollaborationViewModel(
  detail: MaintenanceTaskDetail | null | undefined,
  runtimeEvents: TimelineEvent[],
): AgentCollaborationModel {
  const persistedPlan = buildPlanFromCurrentPlan(detail?.current_plan);
  const persistedCritiques = buildCritiquesFromPayload(detail?.critiques);
  const persistedReplans = buildReplansFromPayload(detail?.replans);
  const finalResolution = detail?.final_resolution || buildFinalResolutionFromTimeline(runtimeEvents);

  return {
    revisionRounds:
      Number(detail?.revision_rounds) ||
      runtimeEvents.filter((event) => event.type === "revision_requested").length,
    currentPlan: persistedPlan.length > 0 ? persistedPlan : buildPlanFromTimeline(runtimeEvents),
    critiques: persistedCritiques.length > 0 ? persistedCritiques : buildCritiquesFromTimeline(runtimeEvents),
    replans: persistedReplans.length > 0 ? persistedReplans : buildReplansFromTimeline(runtimeEvents),
    finalResolution,
  };
}
