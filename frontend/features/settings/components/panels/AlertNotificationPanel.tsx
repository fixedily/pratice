import { BellRing } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { SettingsSectionShell, ToggleRow } from "@/features/settings/components/settings-ui";
import { alertToggles } from "@/features/settings/mock/settingsMock";
import type { SettingsPanelProps } from "@/features/settings/components/panels/types";

export function AlertNotificationPanel({ onSave }: SettingsPanelProps) {
  return (
    <SettingsSectionShell
      title="告警通知设置"
      description="统一管理站内、邮件、企业微信、工单超时、设备异常与诊断完成通知策略。"
      icon={BellRing}
      actions={<Button type="button" onClick={() => onSave("告警通知设置")}>保存设置</Button>}
    >
      <div className="grid gap-3 md:grid-cols-2">
        {alertToggles.map((item) => (
          <ToggleRow key={item.label} {...item} />
        ))}
      </div>
    </SettingsSectionShell>
  );
}
