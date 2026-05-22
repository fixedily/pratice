import { Database } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { SettingsSectionShell, cardClass, pageText, toneClass } from "@/features/settings/components/settings-ui";
import { integrationItems } from "@/features/settings/mock/settingsMock";
import { cn } from "@/shared/lib/utils";
import type { SettingsPanelProps } from "@/features/settings/components/panels/types";

export function DataInterfacePanel({ onSave }: SettingsPanelProps) {
  return (
    <SettingsSectionShell
      title="数据源与接口"
      description="规划模型 API、知识库目录、设备台账、SCADA、MES、ERP、CMMS 等企业系统接口。"
      icon={Database}
      actions={<Button type="button" onClick={() => onSave("数据源与接口")}>保存设置</Button>}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {integrationItems.map((item) => (
          <div key={item.name} className={cn("p-5", cardClass)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={cn("text-base font-semibold", pageText.title)}>{item.name}</div>
                <div className={cn("mt-1 text-xs", pageText.tertiary)}>{item.category}</div>
                <div className={cn("mt-3 break-all font-mono text-xs", pageText.tertiary)}>{item.endpoint}</div>
              </div>
              <span className={cn("shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium", toneClass(item.tone))}>{item.status}</span>
            </div>
          </div>
        ))}
      </div>
    </SettingsSectionShell>
  );
}
