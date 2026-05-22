"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BrainCircuit, FlaskConical, RefreshCw, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { canAccessAdmin } from "@/features/auth/permissions";
import { getMaintenanceToken } from "@/features/auth/lib/token-store";
import {
  cardClass,
  mutedPanelClass,
  pageText,
  SettingsSectionShell,
  toneClass,
} from "@/features/settings/components/settings-ui";
import type { SettingsPanelProps } from "@/features/settings/components/panels/types";
import {
  listMaintenanceSystemConfigs,
  patchMaintenanceSystemConfig,
  runMaintenanceModelConnectivityCheck,
  type MaintenanceModelConnectivityResult,
  type MaintenanceSystemConfigItem,
} from "@/shared/lib/http";
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
import { cn } from "@/shared/lib/utils";

type ModelFieldKey =
  | "model.provider"
  | "model.chat_model"
  | "model.vision_model"
  | "model.embedding_model"
  | "model.reranker_model"
  | "model.api_base"
  | "model.temperature"
  | "model.max_tokens";

type ModelFormValues = Record<ModelFieldKey, string>;

type ModelFieldDef = {
  key: ModelFieldKey;
  label: string;
  hint: string;
  inputMode?: "decimal" | "numeric";
};

const DEFAULT_FORM_VALUES: ModelFormValues = {
  "model.provider": "zhipu",
  "model.chat_model": "",
  "model.vision_model": "",
  "model.embedding_model": "",
  "model.reranker_model": "",
  "model.api_base": "",
  "model.temperature": "0.1",
  "model.max_tokens": "4096",
};

const MODEL_FIELDS: ModelFieldDef[] = [
  { key: "model.provider", label: "供应商", hint: "选择当前控制面板默认使用的模型供应商。" },
  { key: "model.chat_model", label: "对话模型", hint: "用于对话与诊断主链路。" },
  { key: "model.vision_model", label: "视觉模型", hint: "用于图片理解、OCR 和多模态分析。" },
  { key: "model.embedding_model", label: "Embedding 模型", hint: "用于向量化和检索。" },
  { key: "model.reranker_model", label: "Rerank 模型", hint: "用于召回结果精排。" },
  { key: "model.api_base", label: "API Base", hint: "OpenAI-compatible 网关地址。" },
  { key: "model.temperature", label: "temperature", hint: "建议保留在 0 到 2 之间。", inputMode: "decimal" },
  { key: "model.max_tokens", label: "max_tokens", hint: "建议使用正整数。", inputMode: "numeric" },
];

const PROVIDER_OPTIONS = [
  { value: "zhipu", label: "智谱 Zhipu" },
  { value: "openai", label: "OpenAI" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "dashscope", label: "DashScope / Qwen" },
  { value: "ollama", label: "Ollama" },
];

const CONNECTIVITY_LANES = [
  { key: "chat", label: "对话链路" },
  { key: "vision", label: "视觉链路" },
  { key: "embedding", label: "Embedding 链路" },
  { key: "reranker", label: "Rerank 链路" },
] as const;

function buildValueMap(items: MaintenanceSystemConfigItem[]): ModelFormValues {
  const values = { ...DEFAULT_FORM_VALUES };
  for (const field of MODEL_FIELDS) {
    values[field.key] = items.find((item) => item.key === field.key)?.value ?? values[field.key];
  }
  return values;
}

function sortItems(items: MaintenanceSystemConfigItem[]) {
  return [...items].sort((a, b) => a.key.localeCompare(b.key));
}

function validateDraft(values: ModelFormValues) {
  const errors: Partial<Record<ModelFieldKey, string>> = {};
  if (!values["model.api_base"].trim()) {
    errors["model.api_base"] = "API Base 不能为空";
  }
  const temperature = Number(values["model.temperature"]);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    errors["model.temperature"] = "temperature 需在 0 到 2 之间";
  }
  const maxTokens = Number(values["model.max_tokens"]);
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    errors["model.max_tokens"] = "max_tokens 必须是正整数";
  }
  return errors;
}

export function ModelServicePanel({ user, roleLabel, onRefreshOverview }: SettingsPanelProps) {
  const isAdmin = canAccessAdmin(user);
  const [items, setItems] = useState<MaintenanceSystemConfigItem[]>([]);
  const [formValues, setFormValues] = useState<ModelFormValues>(DEFAULT_FORM_VALUES);
  const [initialValues, setInitialValues] = useState<ModelFormValues>(DEFAULT_FORM_VALUES);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ModelFieldKey, string>>>({});
  const [testResult, setTestResult] = useState<MaintenanceModelConnectivityResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadConfigs = useCallback(async () => {
    if (!isAdmin) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const payload = await listMaintenanceSystemConfigs(getMaintenanceToken());
      const nextItems = sortItems(payload.items);
      const nextValues = buildValueMap(nextItems);
      setItems(nextItems);
      setFormValues(nextValues);
      setInitialValues(nextValues);
      setFieldErrors({});
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "模型服务加载失败");
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  const dirtyKeys = useMemo(
    () =>
      MODEL_FIELDS.filter((field) => (formValues[field.key] ?? "").trim() !== (initialValues[field.key] ?? "").trim()).map(
        (field) => field.key,
      ),
    [formValues, initialValues],
  );

  const handleChange = useCallback((key: ModelFieldKey, value: string) => {
    setFormValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setFormValues(initialValues);
    setFieldErrors({});
  }, [initialValues]);

  const handleSave = useCallback(async () => {
    if (!isAdmin) {
      toast.error("只有系统管理员可以修改模型服务");
      return;
    }
    const nextErrors = validateDraft(formValues);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error("请先修正模型服务表单");
      return;
    }
    if (dirtyKeys.length === 0) {
      toast.info("模型服务没有变更");
      return;
    }

    setIsSaving(true);
    try {
      const token = getMaintenanceToken();
      const updatedMap = new Map(items.map((item) => [item.key, item] as const));
      for (const key of dirtyKeys) {
        const saved = await patchMaintenanceSystemConfig(token, key, formValues[key].trim());
        updatedMap.set(saved.key, saved);
      }

      let nextItems = sortItems(Array.from(updatedMap.values()));
      if (dirtyKeys.includes("model.provider")) {
        const refreshed = await listMaintenanceSystemConfigs(token);
        nextItems = sortItems(refreshed.items);
      }

      const nextValues = buildValueMap(nextItems);
      setItems(nextItems);
      setFormValues(nextValues);
      setInitialValues(nextValues);
      toast.success("模型服务已保存");
      onRefreshOverview();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模型服务保存失败");
    } finally {
      setIsSaving(false);
    }
  }, [dirtyKeys, formValues, isAdmin, items, onRefreshOverview]);

  const handleTest = useCallback(async () => {
    if (!isAdmin) {
      toast.error("只有系统管理员可以执行模型连接测试");
      return;
    }
    const nextErrors = validateDraft(formValues);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error("请先修正模型服务表单");
      return;
    }

    setIsTesting(true);
    try {
      const result = await runMaintenanceModelConnectivityCheck(getMaintenanceToken(), {
        provider: formValues["model.provider"].trim(),
        chat_model: formValues["model.chat_model"].trim(),
        vision_model: formValues["model.vision_model"].trim(),
        embedding_model: formValues["model.embedding_model"].trim(),
        reranker_model: formValues["model.reranker_model"].trim(),
        api_base: formValues["model.api_base"].trim(),
        temperature: Number(formValues["model.temperature"]),
        max_tokens: Number(formValues["model.max_tokens"]),
      });
      setTestResult(result);
      toast.success("模型连通性测试完成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模型连通性测试失败");
    } finally {
      setIsTesting(false);
    }
  }, [formValues, isAdmin]);

  if (!isAdmin) {
    return (
      <SettingsSectionShell
        title="模型服务"
        description="统一管理对话、视觉、Embedding 和 Rerank 服务，支持本地部署与云端 API 两种企业接入方式。"
        icon={BrainCircuit}
      >
        <div className={cn("p-5", mutedPanelClass)}>
          <div className={cn("text-sm font-semibold", pageText.title)}>当前角色无编辑权限</div>
          <div className={cn("mt-2 text-sm leading-6", pageText.tertiary)}>
            你当前以“{roleLabel}”访问设置中心。模型服务配置和连通性测试涉及平台级能力与凭证托管，仅系统管理员可以查看和修改。
          </div>
        </div>
      </SettingsSectionShell>
    );
  }

  return (
    <SettingsSectionShell
      title="模型服务"
      description="统一管理对话、视觉、Embedding 和 Rerank 服务，支持本地部署与云端 API 两种企业接入方式。"
      icon={BrainCircuit}
      actions={
        <>
          <Button type="button" variant="outline" onClick={() => void loadConfigs()} disabled={isLoading || isSaving || isTesting}>
            <RefreshCw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} />
            重新加载
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleReset}
            disabled={dirtyKeys.length === 0 || isLoading || isSaving || isTesting}
          >
            <RotateCcw className="h-4 w-4" />
            重置更改
          </Button>
          <Button type="button" variant="outline" onClick={() => void handleTest()} disabled={isLoading || isSaving || isTesting}>
            <FlaskConical className={cn("h-4 w-4", isTesting ? "animate-spin" : "")} />
            测试连接
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={dirtyKeys.length === 0 || isLoading || isSaving || isTesting}>
            <Save className="h-4 w-4" />
            保存设置
          </Button>
        </>
      }
    >
      <div className={cn("p-5", cardClass)} aria-label="模型服务表单" role="form">
        {loadError ? (
          <div className="space-y-3">
            <div className={cn("text-sm font-semibold text-red-600 dark:text-red-300")}>模型服务加载失败</div>
            <div className={cn("text-sm", pageText.tertiary)}>{loadError}</div>
            <Button type="button" variant="outline" onClick={() => void loadConfigs()}>
              重试
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {MODEL_FIELDS.map((field) => {
              const currentValue = formValues[field.key] ?? "";
              const originalValue = initialValues[field.key] ?? "";
              const isDirty = currentValue.trim() !== originalValue.trim();
              const hasError = Boolean(fieldErrors[field.key]);
              const inputId = `model-setting-${field.key.replace(/[^\w-]/g, "-")}`;
              const hintId = `${inputId}-hint`;
              const errorId = `${inputId}-error`;
              const describedBy = hasError ? `${hintId} ${errorId}` : hintId;

              return (
                <div
                  key={field.key}
                  className={cn(
                    "rounded-xl border px-4 py-4",
                    hasError
                      ? "border-red-200 bg-red-50/70 dark:border-red-400/25 dark:bg-red-400/[0.08]"
                      : isDirty
                        ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-400/25 dark:bg-emerald-400/[0.08]"
                        : "border-slate-200/80 bg-white dark:border-white/[0.08] dark:bg-white/[0.03]",
                    field.key === "model.api_base" ? "md:col-span-2 xl:col-span-3" : "",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Label htmlFor={inputId} className={cn("text-sm font-semibold", pageText.title)}>
                        {field.label}
                      </Label>
                      <div id={hintId} className={cn("mt-1 text-xs leading-5", pageText.tertiary)}>
                        {field.hint}
                      </div>
                    </div>
                    {isDirty ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300">
                        已修改
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3">
                    {field.key === "model.provider" ? (
                      <Select value={currentValue} onValueChange={(value) => handleChange(field.key, value)} disabled={isLoading || isSaving || isTesting}>
                        <SelectTrigger
                          id={inputId}
                          aria-label={field.label}
                          aria-describedby={describedBy}
                          aria-invalid={hasError}
                          className="w-full"
                        >
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
                    ) : (
                      <Input
                        id={inputId}
                        aria-label={field.label}
                        aria-describedby={describedBy}
                        aria-invalid={hasError}
                        inputMode={field.inputMode}
                        value={currentValue}
                        onChange={(event) => handleChange(field.key, event.target.value)}
                        disabled={isLoading || isSaving || isTesting}
                      />
                    )}
                  </div>

                  {fieldErrors[field.key] ? (
                    <div id={errorId} className="mt-2 text-xs text-red-600 dark:text-red-300">
                      {fieldErrors[field.key]}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {testResult ? (
        <div className={cn("p-5", cardClass)} aria-label="模型服务测试结果">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className={cn("text-sm font-semibold", pageText.title)}>最近测试</div>
              <div className={cn("mt-1 text-xs", pageText.tertiary)}>
                {testResult.provider} / {testResult.api_base} / {testResult.tested_at}
              </div>
            </div>
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium",
                testResult.overall_status === "success" ? toneClass("success") : toneClass("danger"),
              )}
            >
              {testResult.overall_status === "success" ? "通过" : "失败"}
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {CONNECTIVITY_LANES.map((lane) => {
              const laneResult = testResult.results[lane.key];
              return (
                <div key={lane.key} className={cn("rounded-xl border px-4 py-3", mutedPanelClass)}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className={cn("text-sm font-semibold", pageText.title)}>{lane.label}</div>
                      <div className={cn("mt-1 text-xs", pageText.tertiary)}>
                        {lane.key} / {laneResult.tested_model}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs font-medium",
                        laneResult.status === "success" ? toneClass("success") : toneClass("danger"),
                      )}
                    >
                      {laneResult.status === "success" ? "正常" : "异常"}
                    </span>
                  </div>
                  <div className={cn("mt-3 text-sm", pageText.secondary)}>{laneResult.detail}</div>
                  <div className={cn("mt-2 text-xs", pageText.tertiary)}>{laneResult.timestamp}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </SettingsSectionShell>
  );
}
