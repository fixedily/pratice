import { Activity, Network, ServerCog } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { SettingsSectionShell, MetricCard, cardClass, pageText, toneClass } from "@/features/settings/components/settings-ui";
import { deploymentChecks } from "@/features/settings/mock/settingsMock";
import { cn } from "@/shared/lib/utils";
import type { CheckState } from "@/features/settings/screens/settings-page";
import type { SettingsPanelProps } from "@/features/settings/components/panels/types";

function healthTone(state: CheckState) {
  if (state.tone === "success") return "success";
  if (state.tone === "danger") return "danger";
  if (state.tone === "warning") return "warning";
  return "neutral";
}

export function DeploymentOpsPanel({
  healthState,
  maintenanceState,
  readinessState,
  onRunHealthCheck,
  onRunMaintenanceCheck,
  onRunReadinessCheck,
}: SettingsPanelProps) {
  return (
    <SettingsSectionShell
      title="部署运维"
      description="围绕后端、数据库、向量库、文件存储、模型服务和国产化部署环境提供健康检查与验收视角。"
      icon={ServerCog}
      actions={
        <>
          <Button type="button" variant="outline" onClick={onRunHealthCheck}>
            <Activity className="h-4 w-4" />
            系统健康检查
          </Button>
          <Button type="button" variant="outline" onClick={onRunMaintenanceCheck}>
            <Network className="h-4 w-4" />
            检修域检查
          </Button>
          <Button type="button" onClick={onRunReadinessCheck}>
            <ServerCog className="h-4 w-4" />
            后端就绪检查
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="系统健康" value={healthState.label} hint={healthState.detail} tone={healthTone(healthState)} />
        <MetricCard label="检修域" value={maintenanceState.label} hint={maintenanceState.detail} tone={healthTone(maintenanceState)} />
        <MetricCard label="后端就绪" value={readinessState.label} hint={readinessState.detail} tone={healthTone(readinessState)} />
        <MetricCard label="国产化部署" value="目标 CPU 架构 / Linux" hint="场景目标环境验收项" tone="warning" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {deploymentChecks.map((item) => (
          <div key={item.label} className={cn("p-4", cardClass)}>
            <div className="flex items-center justify-between gap-3">
              <div className={cn("text-sm font-medium", pageText.secondary)}>{item.label}</div>
              <span className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", toneClass(item.tone))}>{item.value}</span>
            </div>
            <div className={cn("mt-2 text-xs", pageText.tertiary)}>{item.hint}</div>
          </div>
        ))}
      </div>
    </SettingsSectionShell>
  );
}
