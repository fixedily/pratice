import { Activity } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { SettingsSectionShell, MetricCard, mutedPanelClass, pageText } from "@/features/settings/components/settings-ui";
import { evaluationMetrics } from "@/features/settings/mock/settingsMock";
import { cn } from "@/shared/lib/utils";
import type { SettingsPanelProps } from "@/features/settings/components/panels/types";

export function EvaluationMonitoringPanel({ onSave }: SettingsPanelProps) {
  return (
    <SettingsSectionShell
      title="评测与监控"
      description="用 CRUD_RAG、DomainRAG、Recall@5、MRR、NDCG、Faithfulness 等指标衡量检索与生成质量。"
      icon={Activity}
      actions={<Button type="button" onClick={() => onSave("评测与监控")}>保存设置</Button>}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {evaluationMetrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} value={metric.value} />
        ))}
      </div>
      <div className={cn("p-5", mutedPanelClass)}>
        <div className={cn("text-sm font-semibold", pageText.title)}>检索质量趋势</div>
        <div className="mt-4 grid h-28 grid-cols-12 items-end gap-2">
          {[42, 55, 49, 63, 68, 72, 66, 74, 79, 81, 78, 84].map((value, index) => (
            <div key={index} className="rounded-t-md bg-emerald-500/80" style={{ height: `${value}%` }} />
          ))}
        </div>
        <div className={cn("mt-3 text-xs", pageText.tertiary)}>最近评测时间：2026-05-16 09:30。趋势为前端占位展示，后续接入离线评测任务结果。</div>
      </div>
    </SettingsSectionShell>
  );
}
