import type {
  KnowledgeReasoningChain,
  KnowledgeReasoningEntity,
  KnowledgeReasoningEvidenceChunk,
  KnowledgeReasoningRelation,
} from "@/shared/lib/http";
import { formatSymptomForDisplay } from "@/features/tasks/lib/symptom-display";

export type ReasoningEvidenceBadge = {
  chunkId: number;
  label: string;
  sourceTitle: string;
  sourceMeta: string;
  meta: string;
  scoreLabel: string;
};

export type ReasoningGraphNodeModel = {
  id: string;
  kind: "question" | "entity" | "target";
  title: string;
  subtitle: string;
  description?: string;
  confidenceLabel?: string;
  tags?: string[];
};

export type ReasoningGraphRelationModel = {
  graphId: string;
  relationId: number | null;
  relation: KnowledgeReasoningRelation | null;
  relationLabel: string;
  confidenceLabel: string;
  summary: string;
  targetNode: ReasoningGraphNodeModel;
  evidenceBadges: ReasoningEvidenceBadge[];
  chunkIds: number[];
  supportLabel: string;
  isFallback: boolean;
  procedureStep?: ReasoningProcedureStepHint | null;
};

export type ReasoningProcedureStepHint = {
  id: string;
  stepNo?: string | null;
  title: string;
  summary?: string | null;
  rawText?: string | null;
  actionLabel?: string | null;
  objectLabel?: string | null;
  headline?: string | null;
  detail?: string | null;
  sections?: Array<{
    label: string;
    items: string[];
  }>;
  meta?: string[];
};

type RelationSemanticProfile = {
  actionTexts: string[];
  objectTexts: string[];
  targetTexts: string[];
  actionFamilies: string[];
};

type ProcedureStepMatchCandidate = {
  relation: KnowledgeReasoningRelation;
  relationIndex: number;
  step: ReasoningProcedureStepHint;
  score: number;
  confidence: number;
  evidenceCount: number;
  stepOrder: number;
};

const DEFAULT_VISIBLE_RELATION_COUNT = 3;
const MIN_PROCEDURE_STEP_MATCH_SCORE = 9;
const ACTION_FAMILIES = [
  { canonical: "拆卸", variants: ["拆卸", "拆下", "取下", "取出", "拔下"] },
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
  { canonical: "处理", variants: ["处理"] },
  { canonical: "紧固", variants: ["紧固", "拧紧"] },
] as const;

const ENTITY_TYPE_LABELS: Record<string, string> = {
  equipment: "设备",
  equipment_model: "设备型号",
  component: "部件",
  symptom: "现象",
  fault_symptom: "现象",
  fault: "故障",
  cause: "原因",
  fault_cause: "原因",
  action: "动作",
  maintenance_action: "动作",
  procedure: "步骤",
  maintenance_procedure: "步骤",
  knowledge_chunk: "证据",
};

const ENTITY_TYPE_PRIORITY: Record<string, number> = {
  component: 0,
  equipment: 1,
  equipment_model: 2,
  symptom: 3,
  fault_symptom: 3,
  fault: 4,
  cause: 5,
  fault_cause: 5,
  procedure: 6,
  maintenance_procedure: 6,
  action: 7,
  maintenance_action: 7,
  knowledge_chunk: 8,
};

const RELATION_LABELS: Record<string, string> = {
  component_requires_action: "需要执行",
  component_related_to_component: "关联部件",
  action_targets_component: "作用于",
  equipment_has_component: "包含",
  symptom_indicates_fault: "指向故障",
  fault_has_symptom: "表现为",
  fault_caused_by: "由此导致",
  cause_leads_to_fault: "导致故障",
  procedure_for_component: "适用于",
  procedure_resolves_fault: "处理",
  knowledge_chunk_supports_claim: "支撑结论",
  related_to: "关联",
};

function formatPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "--";
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
}

function formatEntityKind(kind: string | null | undefined) {
  const normalized = String(kind || "").trim();
  return ENTITY_TYPE_LABELS[normalized] || normalized || "实体";
}

function getEntityTypePriority(kind: string | null | undefined) {
  const normalized = String(kind || "").trim();
  return ENTITY_TYPE_PRIORITY[normalized] ?? 99;
}

function countEntityRelationTouches(entityId: number, relations: KnowledgeReasoningRelation[]) {
  return relations.reduce((count, relation) => {
    if (relation.source_entity_id === entityId || relation.target_entity_id === entityId) {
      return count + 1;
    }
    return count;
  }, 0);
}

function rankReasoningEntities(
  entities: KnowledgeReasoningEntity[],
  relations: KnowledgeReasoningRelation[],
) {
  return entities
    .map((entity, index) => ({
      entity,
      index,
      typePriority: getEntityTypePriority(entity.entity_type),
      relationTouches: countEntityRelationTouches(entity.id, relations),
      matchScore: Number(entity.match_score ?? 0),
    }))
    .sort((left, right) => {
      if (left.typePriority !== right.typePriority) {
        return left.typePriority - right.typePriority;
      }
      if (left.relationTouches !== right.relationTouches) {
        return right.relationTouches - left.relationTouches;
      }
      if (left.matchScore !== right.matchScore) {
        return right.matchScore - left.matchScore;
      }
      return left.index - right.index;
    });
}

function buildSectionMeta(chunk: Pick<KnowledgeReasoningEvidenceChunk, "section_reference" | "page_reference">) {
  return [chunk.section_reference, chunk.page_reference].filter(Boolean).join(" / ") || "命中片段";
}

function humanizeRelationType(value: string) {
  const text = value.trim();
  if (!text) return "关联";
  return text
    .split("_")
    .filter(Boolean)
    .join(" ");
}

function inferTargetSubtitle(relationType: string | null | undefined) {
  const normalized = String(relationType || "").trim();
  if (!normalized) return "推理目标";
  if (normalized.includes("action") || normalized.includes("procedure")) return "动作建议";
  if (normalized.includes("fault")) return "故障指向";
  if (normalized.includes("cause")) return "原因线索";
  if (normalized.includes("component")) return "关联部件";
  return "推理目标";
}

function buildSupportLabel(badges: ReasoningEvidenceBadge[]) {
  if (!badges.length) return "暂无证据";
  if (badges.length === 1) return `证据 ${badges[0].label}`;
  return `证据 ${badges[0].label} +${badges.length - 1}`;
}

export function translateReasoningRelationLabel(relationType: string | null | undefined) {
  const normalized = String(relationType || "").trim();
  if (!normalized) return "关联";
  return RELATION_LABELS[normalized] || humanizeRelationType(normalized);
}

function isActionLikeRelationType(relationType: string | null | undefined) {
  const normalized = String(relationType || "").trim();
  return normalized.includes("action") || normalized.includes("procedure");
}

function normalizeProcedureText(value: string | null | undefined) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[：:，。,；;、（）()\[\]【】'"`~\-]/g, "")
    .trim();
}

function extractActionFamilies(text: string | null | undefined) {
  const normalized = normalizeProcedureText(text);
  return ACTION_FAMILIES.filter((family) => family.variants.some((variant) => normalized.includes(variant))).map(
    (family) => family.canonical,
  );
}

function uniqueProcedureTexts(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const normalizedValues: string[] = [];
  values.forEach((value) => {
    const normalized = normalizeProcedureText(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    normalizedValues.push(normalized);
  });
  return normalizedValues;
}

function extractActionFamiliesFromTexts(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.flatMap((value) => extractActionFamilies(value))));
}

function hasProcedureTextOverlap(left: string, right: string) {
  return left === right || left.includes(right) || right.includes(left);
}

function scoreProcedureTextSetMatch(
  candidates: string[],
  texts: string[],
  exactScore: number,
  overlapScore: number,
  genericOverlapScore: number,
) {
  let bestScore = 0;
  candidates.forEach((candidate) => {
    const genericCandidate = candidate.length <= 2;
    texts.forEach((text) => {
      if (text === candidate) {
        bestScore = Math.max(bestScore, exactScore);
        return;
      }
      if (hasProcedureTextOverlap(text, candidate)) {
        bestScore = Math.max(bestScore, genericCandidate ? genericOverlapScore : overlapScore);
      }
    });
  });
  return bestScore;
}

function normalizeCitationLabel(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}

function extractCitationLabelsFromTexts(values: Array<string | null | undefined>) {
  const labels = new Set<string>();
  values.forEach((value) => {
    const matches = String(value || "").match(/\bC\d+\b/gi) ?? [];
    matches.forEach((match) => {
      const normalized = normalizeCitationLabel(match);
      if (normalized) labels.add(normalized);
    });
  });
  return Array.from(labels);
}

function buildEvidenceLabelMap(evidenceChunks: KnowledgeReasoningEvidenceChunk[]) {
  const evidenceByLabel = new Map<string, KnowledgeReasoningEvidenceChunk>();
  evidenceChunks.forEach((chunk) => {
    const normalized = normalizeCitationLabel(chunk.citation_label);
    if (!normalized || evidenceByLabel.has(normalized)) return;
    evidenceByLabel.set(normalized, chunk);
  });
  return evidenceByLabel;
}

function isReadableProcedureObjectLabel(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (text.length > 18) return false;
  return !/(之前|之后|然后|确保|避免|防止|确认|注意|即可|再|并|将|把)/.test(text);
}

function chooseProcedureStepDisplayTitle(step: ReasoningProcedureStepHint) {
  const title = String(step.title || "").trim();
  const headline = String(step.headline || "").trim();
  if (title) return title;
  if (headline) return headline;
  return step.detail?.trim() || "按步骤执行";
}

function chooseProcedureStepDisplayDescription(step: ReasoningProcedureStepHint) {
  const title = String(step.title || "").trim();
  const headline = String(step.headline || "").trim();
  const summary = String(step.summary || "").trim();
  const detail = String(step.detail || "").trim();

  if (headline && headline !== title) return headline;
  if (summary && summary !== title && summary !== headline) return summary;
  if (detail && detail !== title && detail !== headline && detail !== summary) return detail;
  return undefined;
}

function buildRelationSemanticProfile(relation: KnowledgeReasoningRelation): RelationSemanticProfile {
  const relationType = String(relation.relation_type || "").trim();
  const sourceName = relation.source_name || "";
  const targetName = relation.target_name || "";

  let actionTexts: string[] = [];
  let objectTexts: string[] = [];
  let targetTexts: string[] = [];

  if (relationType === "component_requires_action") {
    actionTexts = [targetName];
    objectTexts = [sourceName];
    targetTexts = [targetName, sourceName];
  } else if (relationType === "action_targets_component") {
    actionTexts = [sourceName];
    objectTexts = [targetName];
    targetTexts = [sourceName, targetName];
  } else if (relationType === "procedure_for_component") {
    actionTexts = [sourceName];
    objectTexts = [targetName];
    targetTexts = [sourceName, targetName];
  } else if (relationType === "procedure_resolves_fault") {
    actionTexts = [sourceName];
    targetTexts = [sourceName, targetName];
  } else {
    const sourceFamilies = extractActionFamilies(sourceName);
    const targetFamilies = extractActionFamilies(targetName);
    if (sourceFamilies.length > 0 && targetFamilies.length === 0) {
      actionTexts = [sourceName];
      objectTexts = [targetName];
    } else if (targetFamilies.length > 0 && sourceFamilies.length === 0) {
      actionTexts = [targetName];
      objectTexts = [sourceName];
    } else {
      actionTexts = [sourceName, targetName];
      objectTexts = [sourceName, targetName];
    }
    targetTexts = [sourceName, targetName];
  }

  return {
    actionTexts: uniqueProcedureTexts([
      ...actionTexts,
      ...extractActionFamiliesFromTexts(actionTexts.length > 0 ? actionTexts : [sourceName, targetName]),
    ]),
    objectTexts: uniqueProcedureTexts(objectTexts),
    targetTexts: uniqueProcedureTexts(targetTexts),
    actionFamilies: extractActionFamiliesFromTexts(actionTexts.length > 0 ? actionTexts : [sourceName, targetName]),
  };
}

function buildStepActionFamilies(step: ReasoningProcedureStepHint) {
  return new Set<string>(
    extractActionFamiliesFromTexts([step.actionLabel, step.headline, step.title, step.summary, step.rawText, step.detail]),
  );
}

function getStepSortValue(step: ReasoningProcedureStepHint | null | undefined) {
  const raw = String(step?.stepNo || "").trim();
  if (!raw) return Number.MAX_SAFE_INTEGER;
  const numeric = Number.parseInt(raw, 10);
  return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}

function buildProcedureStepLabel(step: ReasoningProcedureStepHint) {
  const normalizedStepNo = String(step.stepNo || "").trim();
  return normalizedStepNo ? `操作步骤 ${normalizedStepNo}` : "操作步骤";
}

function relationTouchesProcedureObject(relation: KnowledgeReasoningRelation, step: ReasoningProcedureStepHint) {
  const stepObjectTexts = uniqueProcedureTexts([step.objectLabel]);
  if (stepObjectTexts.length === 0) return false;
  const relationTexts = uniqueProcedureTexts([relation.source_name, relation.target_name]);
  return stepObjectTexts.some((stepObjectText) =>
    relationTexts.some((relationText) => hasProcedureTextOverlap(stepObjectText, relationText)),
  );
}

function scoreProcedureStepMatch(
  relation: KnowledgeReasoningRelation,
  step: ReasoningProcedureStepHint,
) {
  const profile = buildRelationSemanticProfile(relation);
  const stepActionTexts = uniqueProcedureTexts([step.actionLabel, step.headline, step.title, step.summary, step.rawText]);
  const stepObjectTexts = uniqueProcedureTexts([step.objectLabel, step.headline, step.detail, step.title, step.summary, step.rawText]);
  const stepTargetTexts = uniqueProcedureTexts([step.headline, step.title, step.detail, step.summary, step.rawText]);
  if (
    profile.actionTexts.length === 0 &&
    profile.objectTexts.length === 0 &&
    profile.targetTexts.length === 0
  ) {
    return 0;
  }
  if (stepActionTexts.length === 0 && stepObjectTexts.length === 0 && stepTargetTexts.length === 0) {
    return 0;
  }

  let score = 0;
  const stepFamilies = buildStepActionFamilies(step);
  if (profile.actionFamilies.length > 0 && stepFamilies.size > 0) {
    const overlappingFamilies = profile.actionFamilies.filter((family) => stepFamilies.has(family));
    if (overlappingFamilies.length === 0) return 0;
    score += overlappingFamilies.length * 12;
  }

  score += scoreProcedureTextSetMatch(profile.actionTexts, stepActionTexts, 16, 9, 3);
  score += scoreProcedureTextSetMatch(profile.objectTexts, stepObjectTexts, 18, 10, 4);
  score += scoreProcedureTextSetMatch(profile.targetTexts, stepTargetTexts, 14, 8, 2);
  score += scoreProcedureTextSetMatch(profile.actionTexts, stepTargetTexts, 8, 5, 2);
  score += scoreProcedureTextSetMatch(profile.objectTexts, stepTargetTexts, 8, 4, 1);
  score += Math.min(relation.evidence_chunk_ids?.length ?? 0, 3) * 2;

  return score;
}

function buildProcedureStepMap(
  relations: KnowledgeReasoningRelation[],
  procedureSteps: ReasoningProcedureStepHint[],
) {
  const stepMap = new Map<number, ReasoningProcedureStepHint>();
  if (procedureSteps.length === 0) return stepMap;

  const actionRelations = relations.filter((relation) => isActionLikeRelationType(relation.relation_type));
  const candidates: ProcedureStepMatchCandidate[] = [];

  for (const [relationIndex, relation] of actionRelations.entries()) {
    if (relation.id == null) continue;
    for (const step of procedureSteps) {
      const score = scoreProcedureStepMatch(relation, step);
      if (score < MIN_PROCEDURE_STEP_MATCH_SCORE) continue;
      candidates.push({
        relation,
        relationIndex,
        step,
        score,
        confidence: Number(relation.confidence ?? 0),
        evidenceCount: relation.evidence_chunk_ids?.length ?? 0,
        stepOrder: getStepSortValue(step),
      });
    }
  }

  const usedStepIds = new Set<string>();

  candidates
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      if (left.evidenceCount !== right.evidenceCount) return right.evidenceCount - left.evidenceCount;
      if (left.confidence !== right.confidence) return right.confidence - left.confidence;
      if (left.stepOrder !== right.stepOrder) return left.stepOrder - right.stepOrder;
      return left.relationIndex - right.relationIndex;
    })
    .forEach((candidate) => {
      const relationId = candidate.relation.id;
      if (stepMap.has(relationId)) return;
      if (usedStepIds.has(candidate.step.id)) return;

      if (relationId != null) {
        stepMap.set(relationId, candidate.step);
        usedStepIds.add(candidate.step.id);
      }
    });

  return stepMap;
}

function buildStepEvidenceBadges(
  step: ReasoningProcedureStepHint | null | undefined,
  evidenceByLabel: Map<string, KnowledgeReasoningEvidenceChunk>,
) {
  if (!step) return [];
  return extractCitationLabelsFromTexts(step.meta ?? [])
    .map((label) => evidenceByLabel.get(label))
    .filter((chunk): chunk is KnowledgeReasoningEvidenceChunk => Boolean(chunk))
    .map(buildEvidenceBadge);
}

function mergeEvidenceBadges(primary: ReasoningEvidenceBadge[], secondary: ReasoningEvidenceBadge[]) {
  const merged = new Map<number, ReasoningEvidenceBadge>();
  [...primary, ...secondary].forEach((badge) => {
    if (!merged.has(badge.chunkId)) {
      merged.set(badge.chunkId, badge);
    }
  });
  return Array.from(merged.values());
}

function buildFallbackStepEvidenceBadges(
  step: ReasoningProcedureStepHint,
  relations: KnowledgeReasoningRelation[],
  relationEvidenceBadgeMap: Map<number, ReasoningEvidenceBadge[]>,
  evidenceByLabel: Map<string, KnowledgeReasoningEvidenceChunk>,
) {
  const directStepEvidence = buildStepEvidenceBadges(step, evidenceByLabel);
  const semanticEvidence = relations
    .map((relation, index) => ({
      relation,
      index,
      score: scoreProcedureStepMatch(relation, step),
      objectMatched: relationTouchesProcedureObject(relation, step),
      confidence: Number(relation.confidence ?? 0),
      badges: relation.id != null ? relationEvidenceBadgeMap.get(relation.id) ?? [] : [],
    }))
    .filter((item) => item.badges.length > 0 && item.score >= MIN_PROCEDURE_STEP_MATCH_SCORE)
    .sort((left, right) => {
      if (left.objectMatched !== right.objectMatched) return left.objectMatched ? -1 : 1;
      if (left.score !== right.score) return right.score - left.score;
      if (left.badges.length !== right.badges.length) return right.badges.length - left.badges.length;
      if (left.confidence !== right.confidence) return right.confidence - left.confidence;
      return left.index - right.index;
    })[0]?.badges;

  return mergeEvidenceBadges(directStepEvidence, semanticEvidence ?? []);
}

function buildEvidenceBadge(chunk: KnowledgeReasoningEvidenceChunk): ReasoningEvidenceBadge {
  return {
    chunkId: chunk.chunk_id,
    label: chunk.citation_label || `C${chunk.chunk_id}`,
    sourceTitle: chunk.title || "命中文档",
    sourceMeta: buildSectionMeta(chunk),
    meta: buildSectionMeta(chunk),
    scoreLabel: formatPercent(chunk.score),
  };
}

function buildSummaryText(params: {
  question: string;
  primaryEntity: KnowledgeReasoningEntity | null;
  relationCount: number;
  evidenceCount: number;
  claims: string[];
  degraded: boolean;
}) {
  const { question, primaryEntity, relationCount, evidenceCount, claims, degraded } = params;
  if (claims.length > 0) return claims[0];
  if (primaryEntity && relationCount > 0) {
    return `围绕“${primaryEntity.canonical_name}”整理出 ${relationCount} 条推理关系，并关联 ${evidenceCount} 条证据片段。`;
  }
  if (primaryEntity && degraded) {
    return `问题“${question}”已命中实体“${primaryEntity.canonical_name}”，当前只有证据命中，尚未形成完整关系结论。`;
  }
  if (primaryEntity) {
    return `问题“${question}”已命中实体“${primaryEntity.canonical_name}”，但暂未返回可解释关系。`;
  }
  if (evidenceCount > 0) {
    return `问题“${question}”当前仅返回 ${evidenceCount} 条证据片段。`;
  }
  return "当前任务尚未返回可视化推理链。";
}

function buildQuestionNode(question: string): ReasoningGraphNodeModel {
  return {
    id: "question",
    kind: "question",
    title: question,
    subtitle: "问题",
  };
}

function buildEntityNode(entity: KnowledgeReasoningEntity): ReasoningGraphNodeModel {
  return {
    id: `entity-${entity.id}`,
    kind: "entity",
    title: entity.canonical_name,
    subtitle: formatEntityKind(entity.entity_type),
    confidenceLabel: formatPercent(entity.match_score),
  };
}

function buildRelationGraphModel(
  relation: KnowledgeReasoningRelation,
  evidenceBadges: ReasoningEvidenceBadge[],
  mappedStep?: ReasoningProcedureStepHint | null,
): ReasoningGraphRelationModel {
  const relationLabel = mappedStep?.actionLabel?.trim() || translateReasoningRelationLabel(relation.relation_type);
  const targetTitle = mappedStep ? chooseProcedureStepDisplayTitle(mappedStep) : relation.target_name;
  const objectLabel = isReadableProcedureObjectLabel(mappedStep?.objectLabel) ? mappedStep?.objectLabel?.trim() : relation.source_name;
  return {
    graphId: `relation-${relation.id}`,
    relationId: relation.id,
    relation,
    relationLabel,
    confidenceLabel: formatPercent(relation.confidence),
    summary: `${relation.source_name} ${relationLabel} ${targetTitle}`,
    targetNode: {
      id: `target-${relation.id}`,
      kind: "target",
      title: targetTitle,
      subtitle: mappedStep ? buildProcedureStepLabel(mappedStep) : inferTargetSubtitle(relation.relation_type),
      description: mappedStep ? chooseProcedureStepDisplayDescription(mappedStep) : undefined,
      confidenceLabel: formatPercent(relation.confidence),
      tags: mappedStep && objectLabel ? [`对象 ${objectLabel}`] : [],
    },
    evidenceBadges,
    chunkIds: evidenceBadges.map((item) => item.chunkId),
    supportLabel: buildSupportLabel(evidenceBadges),
    isFallback: false,
    procedureStep: mappedStep ?? null,
  };
}

function buildProcedureFallbackGraphModel(
  primaryEntity: KnowledgeReasoningEntity | null,
  step: ReasoningProcedureStepHint,
  evidenceBadges: ReasoningEvidenceBadge[],
): ReasoningGraphRelationModel {
  const objectLabel = isReadableProcedureObjectLabel(step.objectLabel) ? step.objectLabel?.trim() : primaryEntity?.canonical_name || null;
  return {
    graphId: `fallback-step-${step.id}`,
    relationId: null,
    relation: null,
    relationLabel: step.actionLabel?.trim() || "步骤补全",
    confidenceLabel: "",
    summary: `${primaryEntity?.canonical_name || "当前对象"} ${step.actionLabel?.trim() || "执行"} ${step.title}`,
    targetNode: {
      id: `target-fallback-step-${step.id}`,
      kind: "target",
      title: chooseProcedureStepDisplayTitle(step),
      subtitle: buildProcedureStepLabel(step),
      description: chooseProcedureStepDisplayDescription(step),
      tags: objectLabel ? [`对象 ${objectLabel}`] : [],
    },
    evidenceBadges,
    chunkIds: evidenceBadges.map((item) => item.chunkId),
    supportLabel: buildSupportLabel(evidenceBadges),
    isFallback: true,
    procedureStep: step,
  };
}

function buildFallbackRelationGraphModel(
  primaryEntity: KnowledgeReasoningEntity,
  evidenceChunks: KnowledgeReasoningEvidenceChunk[],
): ReasoningGraphRelationModel {
  const evidenceBadges = evidenceChunks.map(buildEvidenceBadge);
  const topChunk = evidenceChunks[0];
  return {
    graphId: "fallback-evidence",
    relationId: null,
    relation: null,
    relationLabel: "证据命中",
    confidenceLabel: formatPercent(topChunk?.score),
    summary: `${primaryEntity.canonical_name} 命中证据，但尚未形成关系结论`,
    targetNode: {
      id: "target-fallback",
      kind: "target",
      title: "未形成关系结论",
      subtitle: `命中 ${evidenceChunks.length} 条证据`,
      confidenceLabel: formatPercent(topChunk?.score),
      tags: [],
    },
    evidenceBadges,
    chunkIds: evidenceBadges.map((item) => item.chunkId),
    supportLabel: buildSupportLabel(evidenceBadges),
    isFallback: true,
    procedureStep: null,
  };
}

function sortRelationsForDisplay(
  relations: KnowledgeReasoningRelation[],
  procedureStepMap: Map<number, ReasoningProcedureStepHint>,
) {
  return relations
    .map((relation, index) => ({
      relation,
      index,
      mappedStep: procedureStepMap.get(relation.id) ?? null,
    }))
    .sort((left, right) => {
      const leftMapped = Boolean(left.mappedStep);
      const rightMapped = Boolean(right.mappedStep);
      if (leftMapped !== rightMapped) return leftMapped ? -1 : 1;
      if (leftMapped && rightMapped) {
        const leftStepOrder = getStepSortValue(left.mappedStep);
        const rightStepOrder = getStepSortValue(right.mappedStep);
        if (leftStepOrder !== rightStepOrder) {
          return leftStepOrder - rightStepOrder;
        }
      }
      const leftActionLike = isActionLikeRelationType(left.relation.relation_type);
      const rightActionLike = isActionLikeRelationType(right.relation.relation_type);
      if (leftActionLike !== rightActionLike) return leftActionLike ? -1 : 1;
      const confidenceGap = Number(right.relation.confidence ?? 0) - Number(left.relation.confidence ?? 0);
      if (confidenceGap !== 0) return confidenceGap;
      return left.index - right.index;
    })
    .map((item) => item.relation);
}

function sortRelationModelsForDisplay(models: ReasoningGraphRelationModel[]) {
  return [...models].sort((left, right) => {
    const leftStepOrder = getStepSortValue(left.procedureStep);
    const rightStepOrder = getStepSortValue(right.procedureStep);
    const leftHasStep = Boolean(left.procedureStep);
    const rightHasStep = Boolean(right.procedureStep);
    if (leftHasStep !== rightHasStep) return leftHasStep ? -1 : 1;
    if (leftHasStep && rightHasStep && leftStepOrder !== rightStepOrder) {
      return leftStepOrder - rightStepOrder;
    }
    if (left.isFallback !== right.isFallback) return left.isFallback ? 1 : -1;
    const leftConfidence = left.relation ? Number(left.relation.confidence ?? 0) : -1;
    const rightConfidence = right.relation ? Number(right.relation.confidence ?? 0) : -1;
    if (leftConfidence !== rightConfidence) return rightConfidence - leftConfidence;
    return left.graphId.localeCompare(right.graphId);
  });
}

export function buildReasoningSubgraphViewModel(
  reasoningChain: KnowledgeReasoningChain | null | undefined,
  procedureSteps: ReasoningProcedureStepHint[] = [],
) {
  const rawQuestion = reasoningChain?.question?.trim() || "当前诊断问题";
  const question = formatSymptomForDisplay(rawQuestion) || rawQuestion;
  const entities = reasoningChain?.matched_entities ?? [];
  const relations = reasoningChain?.expanded_relations ?? [];
  const evidenceChunks = reasoningChain?.evidence_chunks ?? [];
  const claims = reasoningChain?.selected_answer_claims ?? [];
  const warnings = reasoningChain?.warnings ?? [];
  const confidenceLabel = formatPercent(reasoningChain?.confidence);
  const evidenceByChunkId = new Map<number, KnowledgeReasoningEvidenceChunk>();
  evidenceChunks.forEach((chunk) => {
    evidenceByChunkId.set(chunk.chunk_id, chunk);
  });
  const evidenceByLabel = buildEvidenceLabelMap(evidenceChunks);
  const rankedEntities = rankReasoningEntities(entities, relations);

  const questionNode = buildQuestionNode(question);
  const primaryEntity = rankedEntities[0]?.entity ?? null;
  const primaryEntityNode = primaryEntity ? buildEntityNode(primaryEntity) : null;
  const procedureStepMap = buildProcedureStepMap(relations, procedureSteps);
  const shouldFilterActionRelations = procedureSteps.length > 0;
  const additionalEntities = rankedEntities.slice(1).map(({ entity }) => ({
    id: `entity-${entity.id}`,
    title: entity.canonical_name,
    subtitle: formatEntityKind(entity.entity_type),
    confidenceLabel: formatPercent(entity.match_score),
  }));

  const sortedRelations = sortRelationsForDisplay(relations, procedureStepMap);
  const filteredRelations = shouldFilterActionRelations
    ? sortedRelations.filter(
        (relation) =>
          !isActionLikeRelationType(relation.relation_type) || (relation.id != null && procedureStepMap.has(relation.id)),
      )
    : sortedRelations;

  const relationEvidenceBadgeMap = new Map<number, ReasoningEvidenceBadge[]>();
  relations.forEach((relation) => {
    if (relation.id == null) return;
    relationEvidenceBadgeMap.set(
      relation.id,
      (relation.evidence_chunk_ids ?? [])
        .map((chunkId) => evidenceByChunkId.get(chunkId))
        .filter((chunk): chunk is KnowledgeReasoningEvidenceChunk => Boolean(chunk))
        .map(buildEvidenceBadge),
    );
  });

  const relationModels = filteredRelations.map((relation) => {
    const relationEvidenceBadges = relation.id != null ? relationEvidenceBadgeMap.get(relation.id) ?? [] : [];
    const mappedStep = procedureStepMap.get(relation.id) ?? null;
    const stepEvidenceBadges = buildStepEvidenceBadges(mappedStep, evidenceByLabel);
    return buildRelationGraphModel(relation, mergeEvidenceBadges(relationEvidenceBadges, stepEvidenceBadges), mappedStep);
  });
  const matchedStepIds = new Set(relationModels.map((item) => item.procedureStep?.id).filter((item): item is string => Boolean(item)));
  const fallbackStepModels = procedureSteps
    .filter((step) => !matchedStepIds.has(step.id))
    .map((step) =>
      buildProcedureFallbackGraphModel(
        primaryEntity,
        step,
        buildFallbackStepEvidenceBadges(step, relations, relationEvidenceBadgeMap, evidenceByLabel),
      ),
    );
  const sortedRelationModels = sortRelationModelsForDisplay([...relationModels, ...fallbackStepModels]);

  const isDegradedNoRelationFlow = relations.length === 0 && Boolean(primaryEntity) && evidenceChunks.length > 0;
  const visibleRelations = (
    isDegradedNoRelationFlow && primaryEntity
      ? [buildFallbackRelationGraphModel(primaryEntity, evidenceChunks)]
      : sortedRelationModels.slice(0, DEFAULT_VISIBLE_RELATION_COUNT)
  );
  const overflowRelations = isDegradedNoRelationFlow
    ? []
    : sortedRelationModels.slice(DEFAULT_VISIBLE_RELATION_COUNT);

  const summaryText = buildSummaryText({
    question,
    primaryEntity,
    relationCount: relations.length,
    evidenceCount: evidenceChunks.length,
    claims,
    degraded: isDegradedNoRelationFlow,
  });

  return {
    question,
    questionNode,
    primaryEntity,
    primaryEntityNode,
    additionalEntities,
    visibleRelations,
    overflowRelations,
    evidenceChunks,
    evidenceByChunkId,
    summaryText,
    confidenceLabel,
    warnings,
    claims,
    hasData: entities.length > 0 || relations.length > 0 || evidenceChunks.length > 0,
    isDegradedNoRelationFlow,
    defaultRelationId: null as string | null,
    defaultChunkId: null as number | null,
  };
}
