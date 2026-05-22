"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, RefreshCw, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { canAccessAdmin } from "@/features/auth/permissions";
import { getMaintenanceToken } from "@/features/auth/lib/token-store";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";
import {
  SettingsSectionShell,
  cardClass,
  mutedPanelClass,
  pageText,
  toneClass,
} from "@/features/settings/components/settings-ui";
import type { SettingsPanelProps } from "@/features/settings/components/panels/types";
import {
  listMaintenanceSystemConfigs,
  patchMaintenanceSystemConfig,
  type MaintenanceSystemConfigItem,
} from "@/shared/lib/http";
import { cn } from "@/shared/lib/utils";

type AgentStageName = "perception" | "diagnosis" | "planning" | "review" | "knowledge";

type StageFormState = {
  enabled: boolean;
  modelProvider: string;
  modelName: string;
  timeoutMs: string;
  maxRetries: string;
};

type AgentFormState = {
  pipelineMode: string;
  defaultOrderText: string;
  failStrategy: string;
  reviewGate: boolean;
  knowledgeWriteback: string;
  planningTriggerRulesText: string;
  reviewLowConfidenceThreshold: string;
  stages: Record<AgentStageName, StageFormState>;
};

type FormErrors = Partial<Record<string, string>>;

const STAGE_ORDER: AgentStageName[] = ["perception", "diagnosis", "planning", "review", "knowledge"];

const STAGE_META: Record<
  AgentStageName,
  { title: string; description: string }
> = {
  perception: {
    title: "感知 Agent",
    description: "解析故障文本、图片和现场上下文，决定是否需要多模态链路。",
  },
  diagnosis: {
    title: "诊断 Agent",
    description: "执行知识召回、诊断推理与最终报告整合。",
  },
  planning: {
    title: "规划 Agent",
    description: "把诊断结果收束为可执行步骤、案例线索和工单草稿。",
  },
  review: {
    title: "审核 Agent",
    description: "检查安全前置条件、低置信度情形和人工授权门槛。",
  },
  knowledge: {
    title: "知识沉淀 Agent",
    description: "形成案例沉淀建议，并决定是否进入知识回写链路。",
  },
};

const PROVIDER_OPTIONS = [
  { value: "zhipu", label: "智谱 Zhipu" },
  { value: "openai", label: "OpenAI" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "dashscope", label: "DashScope / Qwen" },
  { value: "ollama", label: "Ollama" },
];

const PIPELINE_MODE_OPTIONS = [
  { value: "conditional", label: "Conditional" },
  { value: "full", label: "Full" },
  { value: "minimal", label: "Minimal" },
];

const FAIL_STRATEGY_OPTIONS = [
  { value: "degrade", label: "Degrade" },
  { value: "fail_fast", label: "Fail Fast" },
];

const KNOWLEDGE_WRITEBACK_OPTIONS = [
  { value: "suggest_only", label: "仅建议" },
  { value: "auto", label: "自动回写" },
  { value: "off", label: "关闭" },
];

const EMPTY_STAGE = (agentName: AgentStageName): StageFormState => ({
  enabled: true,
  modelProvider: "zhipu",
  modelName: "glm-4.5",
  timeoutMs: "45000",
  maxRetries: agentName === "diagnosis" ? "1" : "0",
});

const DEFAULT_FORM_STATE: AgentFormState = {
  pipelineMode: "conditional",
  defaultOrderText: STAGE_ORDER.join(", "),
  failStrategy: "degrade",
  reviewGate: true,
  knowledgeWriteback: "suggest_only",
  planningTriggerRulesText: "procedural_query, maintenance_task_present, high_risk_followup",
  reviewLowConfidenceThreshold: "0.72",
  stages: {
    perception: EMPTY_STAGE("perception"),
    diagnosis: EMPTY_STAGE("diagnosis"),
    planning: EMPTY_STAGE("planning"),
    review: EMPTY_STAGE("review"),
    knowledge: EMPTY_STAGE("knowledge"),
  },
};

function sortItems(items: MaintenanceSystemConfigItem[]) {
  return [...items].sort((a, b) => a.key.localeCompare(b.key));
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null) return fallback;
  return String(value).trim().toLowerCase() === "true";
}

function parseString(value: string | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function parseList(value: string | undefined, fallback: string[]) {
  const text = value?.trim();
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {}
  return text
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeList(text: string) {
  const values = text
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return JSON.stringify(values);
}

function formatList(values: string[]) {
  return values.join(", ");
}

function formatTimestamp(value?: string | null) {
  if (!value) return "暂无";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(parsed));
}

function normalizeRuntimeTone(
  status: string | null | undefined,
): "success" | "warning" | "danger" | "neutral" {
  if (!status) return "neutral";
  if (status === "completed" || status === "ready") return "success";
  if (status === "skipped" || status === "degraded" || status === "review_required") return "warning";
  if (status === "failed" || status === "error") return "danger";
  return "neutral";
}

function buildFormState(items: MaintenanceSystemConfigItem[]): AgentFormState {
  const valueMap = new Map(items.map((item) => [item.key, item.value ?? ""] as const));
  const nextStages = { ...DEFAULT_FORM_STATE.stages };

  for (const stage of STAGE_ORDER) {
    nextStages[stage] = {
      enabled: parseBoolean(valueMap.get(`agent.${stage}.enabled`), DEFAULT_FORM_STATE.stages[stage].enabled),
      modelProvider: parseString(valueMap.get(`agent.${stage}.model_provider`), DEFAULT_FORM_STATE.stages[stage].modelProvider),
      modelName: parseString(valueMap.get(`agent.${stage}.model_name`), DEFAULT_FORM_STATE.stages[stage].modelName),
      timeoutMs: parseString(valueMap.get(`agent.${stage}.timeout_ms`), DEFAULT_FORM_STATE.stages[stage].timeoutMs),
      maxRetries: parseString(valueMap.get(`agent.${stage}.max_retries`), DEFAULT_FORM_STATE.stages[stage].maxRetries),
    };
  }

  return {
    pipelineMode: parseString(valueMap.get("agent.pipeline.mode"), DEFAULT_FORM_STATE.pipelineMode),
    defaultOrderText: formatList(parseList(valueMap.get("agent.pipeline.default_order"), STAGE_ORDER)),
    failStrategy: parseString(valueMap.get("agent.pipeline.fail_strategy"), DEFAULT_FORM_STATE.failStrategy),
    reviewGate: parseBoolean(valueMap.get("agent.pipeline.review_gate"), DEFAULT_FORM_STATE.reviewGate),
    knowledgeWriteback: parseString(valueMap.get("agent.pipeline.knowledge_writeback"), DEFAULT_FORM_STATE.knowledgeWriteback),
    planningTriggerRulesText: formatList(
      parseList(
        valueMap.get("agent.planning.trigger_rules"),
        DEFAULT_FORM_STATE.planningTriggerRulesText.split(", ").map((item) => item.trim()),
      ),
    ),
    reviewLowConfidenceThreshold: parseString(
      valueMap.get("agent.review.low_confidence_threshold"),
      DEFAULT_FORM_STATE.reviewLowConfidenceThreshold,
    ),
    stages: nextStages,
  };
}

function serializeFormState(values: AgentFormState): Record<string, string> {
  const payload: Record<string, string> = {
    "agent.pipeline.mode": values.pipelineMode.trim(),
    "agent.pipeline.default_order": serializeList(values.defaultOrderText),
    "agent.pipeline.fail_strategy": values.failStrategy.trim(),
    "agent.pipeline.review_gate": String(values.reviewGate),
    "agent.pipeline.knowledge_writeback": values.knowledgeWriteback.trim(),
    "agent.planning.trigger_rules": serializeList(values.planningTriggerRulesText),
    "agent.review.low_confidence_threshold": values.reviewLowConfidenceThreshold.trim(),
  };

  for (const stage of STAGE_ORDER) {
    payload[`agent.${stage}.enabled`] = String(values.stages[stage].enabled);
    payload[`agent.${stage}.model_provider`] = values.stages[stage].modelProvider.trim();
    payload[`agent.${stage}.model_name`] = values.stages[stage].modelName.trim();
    payload[`agent.${stage}.timeout_ms`] = values.stages[stage].timeoutMs.trim();
    payload[`agent.${stage}.max_retries`] = values.stages[stage].maxRetries.trim();
  }

  return payload;
}

function validateForm(values: AgentFormState): FormErrors {
  const errors: FormErrors = {};
  const order = parseList(values.defaultOrderText, []);
  if (order.length === 0) {
    errors.defaultOrderText = "默认执行顺序不能为空";
  } else if (order.some((item) => !STAGE_ORDER.includes(item as AgentStageName))) {
    errors.defaultOrderText = "默认执行顺序仅支持 perception, diagnosis, planning, review, knowledge";
  } else if (new Set(order).size !== order.length) {
    errors.defaultOrderText = "默认执行顺序中不能出现重复阶段";
  }

  const threshold = Number(values.reviewLowConfidenceThreshold);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    errors.reviewLowConfidenceThreshold = "低置信度阈值需在 0 到 1 之间";
  }

  for (const stage of STAGE_ORDER) {
    const timeout = Number(values.stages[stage].timeoutMs);
    if (!Number.isInteger(timeout) || timeout <= 0) {
      errors[`stage.${stage}.timeoutMs`] = "超时需为正整数";
    }
    const retries = Number(values.stages[stage].maxRetries);
    if (!Number.isInteger(retries) || retries < 0) {
      errors[`stage.${stage}.maxRetries`] = "重试次数需为非负整数";
    }
    if (!values.stages[stage].modelName.trim()) {
      errors[`stage.${stage}.modelName`] = "模型名称不能为空";
    }
  }

  return errors;
}

export function AgentSettingsPanel({ overview, user, roleLabel, onRefreshOverview }: SettingsPanelProps) {
  const isAdmin = canAccessAdmin(user);
  const [items, setItems] = useState<MaintenanceSystemConfigItem[]>([]);
  const [formValues, setFormValues] = useState<AgentFormState>(DEFAULT_FORM_STATE);
  const [initialValues, setInitialValues] = useState<AgentFormState>(DEFAULT_FORM_STATE);
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const runtimeMap = useMemo(
    () => new Map((overview?.agent_summary?.agents ?? []).map((item) => [item.agent_name, item] as const)),
    [overview?.agent_summary?.agents],
  );

  const loadConfigs = useCallback(async () => {
    if (!isAdmin) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const payload = await listMaintenanceSystemConfigs(getMaintenanceToken());
      const nextItems = sortItems(payload.items.filter((item) => item.key.startsWith("agent.")));
      const nextValues = buildFormState(nextItems);
      setItems(nextItems);
      setFormValues(nextValues);
      setInitialValues(nextValues);
      setFieldErrors({});
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "智能体设置加载失败");
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  const dirtyEntries = useMemo(() => {
    const current = serializeFormState(formValues);
    const initial = serializeFormState(initialValues);
    return Object.entries(current).filter(([key, value]) => value !== initial[key]);
  }, [formValues, initialValues]);

  const handleReset = useCallback(() => {
    setFormValues(initialValues);
    setFieldErrors({});
  }, [initialValues]);

  const handleStageChange = useCallback(
    <K extends keyof StageFormState>(stage: AgentStageName, key: K, value: StageFormState[K]) => {
      setFormValues((current) => ({
        ...current,
        stages: {
          ...current.stages,
          [stage]: {
            ...current.stages[stage],
            [key]: value,
          },
        },
      }));
      setFieldErrors((current) => {
        const next = { ...current };
        delete next[`stage.${stage}.${String(key)}`];
        return next;
      });
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!isAdmin) {
      toast.error("只有系统管理员可以修改智能体设置");
      return;
    }
    const nextErrors = validateForm(formValues);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error("请先修正智能体设置表单");
      return;
    }
    if (dirtyEntries.length === 0) {
      toast.info("智能体设置没有变更");
      return;
    }

    setIsSaving(true);
    try {
      const token = getMaintenanceToken();
      const serialized = serializeFormState(formValues);
      const updatedMap = new Map(items.map((item) => [item.key, item] as const));
      for (const [key] of dirtyEntries) {
        const saved = await patchMaintenanceSystemConfig(token, key, serialized[key]);
        updatedMap.set(saved.key, saved);
      }
      const nextItems = sortItems(Array.from(updatedMap.values()));
      const nextValues = buildFormState(nextItems);
      setItems(nextItems);
      setFormValues(nextValues);
      setInitialValues(nextValues);
      toast.success("智能体设置已保存");
      onRefreshOverview();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "智能体设置保存失败");
    } finally {
      setIsSaving(false);
    }
  }, [dirtyEntries, formValues, isAdmin, items, onRefreshOverview]);

  if (!isAdmin) {
    return (
      <SettingsSectionShell
        title="智能体设置"
        description="按工业检修闭环拆分感知、诊断、规划、审核和知识沉淀阶段，使诊断过程可编排、可审计。"
        icon={Bot}
      >
        <div className={cn("p-5", mutedPanelClass)}>
          <div className={cn("text-sm font-semibold", pageText.title)}>当前角色无编辑权限</div>
          <div className={cn("mt-2 text-sm leading-6", pageText.tertiary)}>
            你当前以“{roleLabel}”访问设置中心。智能体编排涉及平台级执行策略和高风险动作门槛，仅系统管理员可以查看和修改。
          </div>
        </div>
      </SettingsSectionShell>
    );
  }

  return (
    <SettingsSectionShell
      title="智能体设置"
      description="按工业检修闭环拆分感知、诊断、规划、审核和知识沉淀阶段，使诊断过程可编排、可审计。"
      icon={Bot}
      actions={
        <>
          <Button type="button" variant="outline" onClick={() => void loadConfigs()} disabled={isLoading || isSaving}>
            <RefreshCw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} />
            重新加载
          </Button>
          <Button type="button" variant="outline" onClick={handleReset} disabled={dirtyEntries.length === 0 || isLoading || isSaving}>
            <RotateCcw className="h-4 w-4" />
            重置更改
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={dirtyEntries.length === 0 || isLoading || isSaving}>
            <Save className="h-4 w-4" />
            保存设置
          </Button>
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-4">
        <div className={cn("p-4 xl:col-span-1", cardClass)}>
          <div className={cn("text-xs font-medium", pageText.tertiary)}>运行模式</div>
          <div className={cn("mt-2 text-lg font-semibold", pageText.title)}>
            {overview?.agent_summary?.pipeline_mode ?? formValues.pipelineMode}
          </div>
          <div className={cn("mt-2 text-xs leading-5", pageText.tertiary)}>
            顺序：{overview?.agent_summary?.default_order?.join(" → ") || parseList(formValues.defaultOrderText, []).join(" → ")}
          </div>
        </div>
        <div className={cn("p-4 xl:col-span-1", cardClass)}>
          <div className={cn("text-xs font-medium", pageText.tertiary)}>最近一次运行</div>
          <div className="mt-2 flex items-center gap-2">
            <div className={cn("text-lg font-semibold", pageText.title)}>
              {overview?.agent_summary?.last_run_status ?? "暂无"}
            </div>
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium",
                toneClass(normalizeRuntimeTone(overview?.agent_summary?.last_run_status)),
              )}
            >
              {overview?.agent_summary?.last_run_id ? "已记录" : "未运行"}
            </span>
          </div>
          <div className={cn("mt-2 text-xs leading-5", pageText.tertiary)}>
            {formatTimestamp(overview?.agent_summary?.last_run_at)}
          </div>
        </div>
        <div className={cn("p-4 xl:col-span-1", cardClass)}>
          <div className={cn("text-xs font-medium", pageText.tertiary)}>降级处理次数</div>
          <div className={cn("mt-2 text-lg font-semibold", pageText.title)}>
            {overview?.agent_summary?.degradation_count ?? 0}
          </div>
          <div className={cn("mt-2 text-xs leading-5", pageText.tertiary)}>统计最近一次 Agent 协作中的非阻断降级轨迹。</div>
        </div>
        <div className={cn("p-4 xl:col-span-1", cardClass)}>
          <div className={cn("text-xs font-medium", pageText.tertiary)}>Review Gate</div>
          <div className={cn("mt-2 text-lg font-semibold", pageText.title)}>
            {(overview?.agent_summary?.review_gate ?? formValues.reviewGate) ? "启用" : "关闭"}
          </div>
          <div className={cn("mt-2 text-xs leading-5", pageText.tertiary)}>
            低置信度或高风险路径是否必须经过 review / 人工授权。
          </div>
        </div>
      </div>

      {loadError ? (
        <div className={cn("p-5", cardClass)}>
          <div className={cn("text-sm font-semibold text-red-600 dark:text-red-300")}>智能体设置加载失败</div>
          <div className={cn("mt-2 text-sm", pageText.tertiary)}>{loadError}</div>
          <Button type="button" variant="outline" onClick={() => void loadConfigs()} className="mt-4">
            重试
          </Button>
        </div>
      ) : (
        <>
          <div className={cn("p-5", cardClass)} aria-label="智能体设置表单" role="form">
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <div className={cn("text-sm font-semibold", pageText.title)}>执行编排</div>
                  <div className={cn("mt-1 text-xs leading-5", pageText.tertiary)}>
                    控制是否走条件编排、默认顺序、失败策略，以及知识回写开关。
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className={cn("text-sm font-semibold", pageText.title)}>Pipeline Mode</Label>
                    <Select
                      value={formValues.pipelineMode}
                      onValueChange={(value) => setFormValues((current) => ({ ...current, pipelineMode: value }))}
                      disabled={isLoading || isSaving}
                    >
                      <SelectTrigger aria-label="Pipeline Mode">
                        <SelectValue placeholder="选择模式" />
                      </SelectTrigger>
                      <SelectContent>
                        {PIPELINE_MODE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className={cn("text-sm font-semibold", pageText.title)}>Fail Strategy</Label>
                    <Select
                      value={formValues.failStrategy}
                      onValueChange={(value) => setFormValues((current) => ({ ...current, failStrategy: value }))}
                      disabled={isLoading || isSaving}
                    >
                      <SelectTrigger aria-label="Fail Strategy">
                        <SelectValue placeholder="选择失败策略" />
                      </SelectTrigger>
                      <SelectContent>
                        {FAIL_STRATEGY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="agent-default-order" className={cn("text-sm font-semibold", pageText.title)}>
                      默认执行顺序
                    </Label>
                    <Input
                      id="agent-default-order"
                      aria-label="默认执行顺序"
                      value={formValues.defaultOrderText}
                      onChange={(event) => {
                        setFormValues((current) => ({ ...current, defaultOrderText: event.target.value }));
                        setFieldErrors((current) => {
                          const next = { ...current };
                          delete next.defaultOrderText;
                          return next;
                        });
                      }}
                      disabled={isLoading || isSaving}
                    />
                    <div className={cn("text-xs leading-5", pageText.tertiary)}>
                      使用逗号分隔，例如 `perception, diagnosis, planning, review, knowledge`。
                    </div>
                    {fieldErrors.defaultOrderText ? (
                      <div className="text-xs text-red-600 dark:text-red-300">{fieldErrors.defaultOrderText}</div>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label className={cn("text-sm font-semibold", pageText.title)}>知识回写</Label>
                    <Select
                      value={formValues.knowledgeWriteback}
                      onValueChange={(value) => setFormValues((current) => ({ ...current, knowledgeWriteback: value }))}
                      disabled={isLoading || isSaving}
                    >
                      <SelectTrigger aria-label="知识回写">
                        <SelectValue placeholder="选择回写策略" />
                      </SelectTrigger>
                      <SelectContent>
                        {KNOWLEDGE_WRITEBACK_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
                    <div className="pr-4">
                      <div className={cn("text-sm font-semibold", pageText.title)}>启用 Review Gate</div>
                      <div className={cn("mt-1 text-xs leading-5", pageText.tertiary)}>
                        高风险与低置信度结果必须经过 review 才能收口。
                      </div>
                    </div>
                    <Switch
                      aria-label="启用 Review Gate"
                      checked={formValues.reviewGate}
                      onCheckedChange={(checked) => setFormValues((current) => ({ ...current, reviewGate: checked }))}
                      disabled={isLoading || isSaving}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <div className={cn("text-sm font-semibold", pageText.title)}>规划与审核门槛</div>
                  <div className={cn("mt-1 text-xs leading-5", pageText.tertiary)}>
                    决定 planning 何时强制参与，以及 review 在何种置信度下进入拦截。
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="agent-planning-trigger-rules" className={cn("text-sm font-semibold", pageText.title)}>
                      规划触发规则
                    </Label>
                    <Input
                      id="agent-planning-trigger-rules"
                      aria-label="规划触发规则"
                      value={formValues.planningTriggerRulesText}
                      onChange={(event) => setFormValues((current) => ({ ...current, planningTriggerRulesText: event.target.value }))}
                      disabled={isLoading || isSaving}
                    />
                    <div className={cn("text-xs leading-5", pageText.tertiary)}>
                      推荐保留 `procedural_query, maintenance_task_present, high_risk_followup`。
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="agent-review-low-confidence-threshold" className={cn("text-sm font-semibold", pageText.title)}>
                      低置信度阈值
                    </Label>
                    <Input
                      id="agent-review-low-confidence-threshold"
                      aria-label="低置信度阈值"
                      inputMode="decimal"
                      value={formValues.reviewLowConfidenceThreshold}
                      onChange={(event) => {
                        setFormValues((current) => ({ ...current, reviewLowConfidenceThreshold: event.target.value }));
                        setFieldErrors((current) => {
                          const next = { ...current };
                          delete next.reviewLowConfidenceThreshold;
                          return next;
                        });
                      }}
                      disabled={isLoading || isSaving}
                    />
                    <div className={cn("text-xs leading-5", pageText.tertiary)}>
                      当前值越低，越容易进入 review 审核与人工确认。
                    </div>
                    {fieldErrors.reviewLowConfidenceThreshold ? (
                      <div className="text-xs text-red-600 dark:text-red-300">{fieldErrors.reviewLowConfidenceThreshold}</div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {STAGE_ORDER.map((stage) => {
              const meta = STAGE_META[stage];
              const runtime = runtimeMap.get(stage);
              const stageState = formValues.stages[stage];

              return (
                <div key={stage} className={cn("p-5", cardClass)}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className={cn("text-base font-semibold", pageText.title)}>{meta.title}</div>
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs font-medium",
                            toneClass(normalizeRuntimeTone(runtime?.last_status)),
                          )}
                        >
                          {runtime?.last_status ?? (stageState.enabled ? "enabled" : "disabled")}
                        </span>
                      </div>
                      <div className={cn("mt-2 text-sm leading-6", pageText.tertiary)}>{meta.description}</div>
                      {runtime?.last_summary ? (
                        <div className={cn("mt-2 text-xs leading-5", pageText.secondary)}>
                          最近摘要：{runtime.last_summary}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <Label htmlFor={`agent-enabled-${stage}`} className={cn("text-xs font-medium", pageText.tertiary)}>
                        启用
                      </Label>
                      <Switch
                        aria-label={`${meta.title}启用`}
                        id={`agent-enabled-${stage}`}
                        checked={stageState.enabled}
                        onCheckedChange={(checked) => handleStageChange(stage, "enabled", checked)}
                        disabled={isLoading || isSaving}
                      />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label className={cn("text-sm font-semibold", pageText.title)}>供应商</Label>
                      <Select
                        value={stageState.modelProvider}
                        onValueChange={(value) => handleStageChange(stage, "modelProvider", value)}
                        disabled={isLoading || isSaving}
                      >
                        <SelectTrigger aria-label={`${meta.title}供应商`}>
                          <SelectValue placeholder="选择供应商" />
                        </SelectTrigger>
                        <SelectContent>
                          {PROVIDER_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`agent-model-${stage}`} className={cn("text-sm font-semibold", pageText.title)}>
                        模型名称
                      </Label>
                      <Input
                        id={`agent-model-${stage}`}
                        aria-label={`${meta.title}模型`}
                        value={stageState.modelName}
                        onChange={(event) => handleStageChange(stage, "modelName", event.target.value)}
                        disabled={isLoading || isSaving}
                      />
                      {fieldErrors[`stage.${stage}.modelName`] ? (
                        <div className="text-xs text-red-600 dark:text-red-300">{fieldErrors[`stage.${stage}.modelName`]}</div>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`agent-timeout-${stage}`} className={cn("text-sm font-semibold", pageText.title)}>
                        超时(ms)
                      </Label>
                      <Input
                        id={`agent-timeout-${stage}`}
                        aria-label={`${meta.title}超时(ms)`}
                        inputMode="numeric"
                        value={stageState.timeoutMs}
                        onChange={(event) => handleStageChange(stage, "timeoutMs", event.target.value)}
                        disabled={isLoading || isSaving}
                      />
                      {fieldErrors[`stage.${stage}.timeoutMs`] ? (
                        <div className="text-xs text-red-600 dark:text-red-300">{fieldErrors[`stage.${stage}.timeoutMs`]}</div>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`agent-retries-${stage}`} className={cn("text-sm font-semibold", pageText.title)}>
                        重试次数
                      </Label>
                      <Input
                        id={`agent-retries-${stage}`}
                        aria-label={`${meta.title}重试次数`}
                        inputMode="numeric"
                        value={stageState.maxRetries}
                        onChange={(event) => handleStageChange(stage, "maxRetries", event.target.value)}
                        disabled={isLoading || isSaving}
                      />
                      {fieldErrors[`stage.${stage}.maxRetries`] ? (
                        <div className="text-xs text-red-600 dark:text-red-300">{fieldErrors[`stage.${stage}.maxRetries`]}</div>
                      ) : null}
                    </div>
                  </div>

                  <div className={cn("mt-4 text-xs leading-5", pageText.tertiary)}>
                    最近执行时间：{formatTimestamp(runtime?.last_run_at ?? overview?.agent_summary?.last_run_at)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </SettingsSectionShell>
  );
}
