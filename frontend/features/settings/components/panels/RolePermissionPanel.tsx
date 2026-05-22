import { ShieldCheck } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { SettingsSectionShell, cardClass, pageText } from "@/features/settings/components/settings-ui";
import { roleItems } from "@/features/settings/mock/settingsMock";
import { cn } from "@/shared/lib/utils";
import type { SettingsPanelProps } from "@/features/settings/components/panels/types";

export function RolePermissionPanel({ user, roleLabel, onSave }: SettingsPanelProps) {
  return (
    <SettingsSectionShell
      title="权限角色设置"
      description="面向企业组织分工配置角色边界，确保检修执行、专家审核、知识维护和系统管理职责分离。"
      icon={ShieldCheck}
      actions={<Button type="button" onClick={() => onSave("权限角色设置")}>保存设置</Button>}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {roleItems.map((item) => (
          <div key={item.role} className={cn("p-5", cardClass)}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className={cn("text-base font-semibold", pageText.title)}>{item.role}</div>
                <div className={cn("mt-2 text-sm leading-6", pageText.tertiary)}>{item.scope}</div>
              </div>
              <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:border-white/[0.10] dark:bg-white/[0.05] dark:text-slate-300">
                {item.users}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className={cn("p-5", cardClass)}>
        <div className={cn("text-sm font-semibold", pageText.title)}>当前账号权限</div>
        <div className={cn("mt-2 text-sm", pageText.tertiary)}>
          {user?.display_name || user?.username || "未登录"}：{roleLabel}，角色标识 {user?.roles?.join(" / ") || "无"}。
        </div>
      </div>
    </SettingsSectionShell>
  );
}
