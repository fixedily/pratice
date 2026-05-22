import { ClipboardCheck } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { SettingsSectionShell, ToggleRow, cardClass, pageText } from "@/features/settings/components/settings-ui";
import { workflowSteps } from "@/features/settings/mock/settingsMock";
import { cn } from "@/shared/lib/utils";
import type { SettingsPanelProps } from "@/features/settings/components/panels/types";

export function WorkOrderFlowPanel({ overview, onSave }: SettingsPanelProps) {
  const published = overview?.workflow_summary.published_flow_template_count ?? 0;
  return (
    <SettingsSectionShell
      title="工单流程设置"
      description="把异常告警到案例沉淀固化为标准闭环，支撑企业检修流程标准化和比赛演示完整性。"
      icon={ClipboardCheck}
      actions={<Button type="button" onClick={() => onSave("工单流程设置")}>保存设置</Button>}
    >
      <div className={cn("p-5", cardClass)}>
        <div className={cn("text-sm font-semibold", pageText.title)}>标准闭环流程</div>
        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {workflowSteps.map((step, index) => (
            <div key={step} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-4 text-center dark:border-emerald-400/20 dark:bg-emerald-400/10">
              <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white">{index + 1}</div>
              <div className={cn("mt-3 text-sm font-medium", pageText.title)}>{step}</div>
            </div>
          ))}
        </div>
        <div className={cn("mt-4 text-sm", pageText.tertiary)}>当前已发布流程模板：{published} 个。</div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ToggleRow label="专家复核节点" enabled description="关键诊断结论进入专家复核，降低错误维修风险。" />
        <ToggleRow label="安全确认节点" enabled description="高风险步骤必须完成安全确认后才可进入下一状态。" />
      </div>
    </SettingsSectionShell>
  );
}
