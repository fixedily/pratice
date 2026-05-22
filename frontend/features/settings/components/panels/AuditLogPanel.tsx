import { ScrollText } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { SettingsSectionShell, cardClass, pageText } from "@/features/settings/components/settings-ui";
import { logItems } from "@/features/settings/mock/settingsMock";
import { cn } from "@/shared/lib/utils";
import type { SettingsPanelProps } from "@/features/settings/components/panels/types";

export function AuditLogPanel({ overview, onSave }: SettingsPanelProps) {
  const latest = overview?.audit_summary.latest_items ?? [];
  return (
    <SettingsSectionShell
      title="日志审计"
      description="追踪登录、操作、模型调用、知识库更新、工单流转和系统异常，满足企业责任追溯要求。"
      icon={ScrollText}
      actions={<Button type="button" onClick={() => onSave("日志审计")}>导出审计摘要</Button>}
    >
      <div className={cn("overflow-hidden", cardClass)}>
        <div className="grid grid-cols-[1fr_1.1fr_1.6fr_1fr] gap-3 border-b border-slate-200/80 px-4 py-3 text-xs font-medium text-slate-500 dark:border-white/[0.08] dark:text-slate-400">
          <span>类型</span>
          <span>主体</span>
          <span>动作</span>
          <span>时间</span>
        </div>
        {logItems.map((item) => (
          <div key={`${item.type}-${item.time}`} className="grid grid-cols-[1fr_1.1fr_1.6fr_1fr] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-0 dark:border-white/[0.05]">
            <span className={pageText.primary}>{item.type}</span>
            <span className={pageText.tertiary}>{item.actor}</span>
            <span className={pageText.primary}>{item.action}</span>
            <span className={pageText.tertiary}>{item.time}</span>
          </div>
        ))}
      </div>
      {latest.length > 0 ? (
        <div className={cn("p-5", cardClass)}>
          <div className={cn("text-sm font-semibold", pageText.title)}>来自后端的最近审计记录</div>
          <div className="mt-3 space-y-2">
            {latest.map((item) => (
              <div key={item.id} className={cn("text-sm", pageText.tertiary)}>
                {item.created_at} · {item.action} · {item.resource_type} #{item.resource_id}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </SettingsSectionShell>
  );
}
