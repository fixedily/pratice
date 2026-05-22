"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Save, Settings } from "lucide-react";
import { toast } from "sonner";

import { canAccessAdmin } from "@/features/auth/permissions";
import { cardClass, mutedPanelClass, pageText, SettingsSectionShell } from "@/features/settings/components/settings-ui";
import type { SettingsPanelProps } from "@/features/settings/components/panels/types";
import { getMaintenanceToken } from "@/features/auth/lib/token-store";
import {
  listMaintenanceSystemConfigs,
  patchMaintenanceSystemConfig,
  type MaintenanceSystemConfigItem,
} from "@/shared/lib/http";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/lib/utils";

type BasicFieldDef = {
  key: string;
  label: string;
  hint: string;
  multiline?: boolean;
};

const BASIC_FIELDS: BasicFieldDef[] = [
  { key: "platform.system_name", label: "系统名称", hint: "用于控制台页头、平台说明和运维导出抬头。" },
  { key: "platform.project_name", label: "企业 / 项目名称", hint: "用于当前部署实例的项目标识与交付口径。" },
  { key: "maintenance.default_device_type", label: "默认设备类型", hint: "新建工单、案例和知识条目时的默认设备分类。" },
  { key: "maintenance.default_level", label: "默认检修等级", hint: "智能诊断和工单流程的默认检修等级。" },
  { key: "platform.timezone", label: "时区", hint: "影响日志、审计和工单时间展示。建议保持 `Asia/Shanghai`。" },
  {
    key: "data.retention_policy",
    label: "数据保留策略",
    hint: "描述审计日志、工单、模型调用摘要等治理留存要求。",
    multiline: true,
  },
];

function buildValueMap(items: MaintenanceSystemConfigItem[]) {
  return Object.fromEntries(items.map((item) => [item.key, item.value ?? ""])) as Record<string, string>;
}

export function BasicSettingsPanel({ user, roleLabel, onRefreshOverview }: SettingsPanelProps) {
  const isAdmin = canAccessAdmin(user);
  const [items, setItems] = useState<MaintenanceSystemConfigItem[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [initialValues, setInitialValues] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadConfigs = useCallback(async () => {
    if (!isAdmin) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const payload = await listMaintenanceSystemConfigs(getMaintenanceToken());
      const nextItems = payload.items;
      const nextValues = buildValueMap(nextItems);
      setItems(nextItems);
      setFormValues(nextValues);
      setInitialValues(nextValues);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "基础设置加载失败");
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  const dirtyKeys = useMemo(
    () =>
      BASIC_FIELDS.filter((field) => (formValues[field.key] ?? "").trim() !== (initialValues[field.key] ?? "").trim()).map(
        (field) => field.key,
      ),
    [formValues, initialValues],
  );

  const handleChange = useCallback((key: string, value: string) => {
    setFormValues((current) => ({ ...current, [key]: value }));
  }, []);

  const handleReset = useCallback(() => {
    setFormValues(initialValues);
  }, [initialValues]);

  const handleSave = useCallback(async () => {
    if (!isAdmin) {
      toast.error("只有系统管理员可以修改基础设置");
      return;
    }
    if (dirtyKeys.length === 0) {
      toast.info("基础设置没有变更");
      return;
    }
    setIsSaving(true);
    try {
      const updatedMap = new Map(items.map((item) => [item.key, item] as const));
      for (const key of dirtyKeys) {
        const saved = await patchMaintenanceSystemConfig(getMaintenanceToken(), key, (formValues[key] ?? "").trim());
        updatedMap.set(saved.key, saved);
      }
      const nextItems = Array.from(updatedMap.values()).sort((a, b) => a.key.localeCompare(b.key));
      const nextValues = buildValueMap(nextItems);
      setItems(nextItems);
      setFormValues(nextValues);
      setInitialValues(nextValues);
      toast.success("基础设置已保存");
      onRefreshOverview();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "基础设置保存失败");
    } finally {
      setIsSaving(false);
    }
  }, [dirtyKeys, formValues, isAdmin, items, onRefreshOverview]);

  if (!isAdmin) {
    return (
      <SettingsSectionShell
        title="基础设置"
        description="定义平台名称、业务默认值和数据保留策略，使系统符合企业级检修平台的基础治理要求。"
        icon={Settings}
      >
        <div className={cn("p-5", mutedPanelClass)}>
          <div className={cn("text-sm font-semibold", pageText.title)}>当前角色无编辑权限</div>
          <div className={cn("mt-2 text-sm leading-6", pageText.tertiary)}>
            你当前以“{roleLabel}”访问设置中心。基础设置读写已接入后端 `system_configs`，仅系统管理员可以修改这组平台级配置。
          </div>
        </div>
      </SettingsSectionShell>
    );
  }

  return (
    <SettingsSectionShell
      title="基础设置"
      description="定义平台名称、业务默认值和数据保留策略，使系统符合企业级检修平台的基础治理要求。"
      icon={Settings}
      actions={
        <>
          <Button type="button" variant="outline" onClick={() => void loadConfigs()} disabled={isLoading || isSaving}>
            <RefreshCw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} />
            重新加载
          </Button>
          <Button type="button" variant="outline" onClick={handleReset} disabled={dirtyKeys.length === 0 || isLoading || isSaving}>
            重置更改
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={dirtyKeys.length === 0 || isLoading || isSaving}>
            <Save className="h-4 w-4" />
            保存设置
          </Button>
        </>
      }
    >
      <div className={cn("p-5", cardClass)}>
        {loadError ? (
          <div className="space-y-3">
            <div className={cn("text-sm font-semibold text-red-600 dark:text-red-300")}>基础设置加载失败</div>
            <div className={cn("text-sm", pageText.tertiary)}>{loadError}</div>
            <Button type="button" variant="outline" onClick={() => void loadConfigs()}>
              重试
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {BASIC_FIELDS.map((field) => {
              const currentValue = formValues[field.key] ?? "";
              const originalValue = initialValues[field.key] ?? "";
              const isDirty = currentValue.trim() !== originalValue.trim();
              const inputId = `basic-setting-${field.key.replace(/[^\w-]/g, "-")}`;
              return (
                <div
                  key={field.key}
                  className={cn(
                    "rounded-xl border px-4 py-4",
                    isDirty
                      ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-400/25 dark:bg-emerald-400/[0.08]"
                      : "border-slate-200/80 bg-white dark:border-white/[0.08] dark:bg-white/[0.03]",
                    field.multiline ? "md:col-span-2 xl:col-span-3" : "",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Label htmlFor={inputId} className={cn("text-sm font-semibold", pageText.title)}>
                        {field.label}
                      </Label>
                      <div className={cn("mt-1 text-xs leading-5", pageText.tertiary)}>{field.hint}</div>
                    </div>
                    {isDirty ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300">
                        已修改
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3">
                    {field.multiline ? (
                      <Textarea
                        id={inputId}
                        value={currentValue}
                        onChange={(event) => handleChange(field.key, event.target.value)}
                        rows={4}
                        disabled={isLoading || isSaving}
                      />
                    ) : (
                      <Input
                        id={inputId}
                        value={currentValue}
                        onChange={(event) => handleChange(field.key, event.target.value)}
                        disabled={isLoading || isSaving}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SettingsSectionShell>
  );
}
