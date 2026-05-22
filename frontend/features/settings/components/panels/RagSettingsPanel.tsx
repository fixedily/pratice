import { Network } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { MetricCard, SettingsSectionShell, ToggleRow } from "@/features/settings/components/settings-ui";
import { ragToggles } from "@/features/settings/mock/settingsMock";
import type { SettingsPanelProps } from "@/features/settings/components/panels/types";

export function RagSettingsPanel({ overview, onSave }: SettingsPanelProps) {
  const rag = overview?.rag_summary;
  return (
    <SettingsSectionShell
      title="RAG 检索设置"
      description="配置工业检修场景下的混合检索、查询增强、证据引用和无依据拒答策略。"
      icon={Network}
      actions={<Button type="button" onClick={() => onSave("RAG 检索设置")}>保存设置</Button>}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="检索模式" value="Hybrid + GraphRAG" hint="语义、关键词与实体图谱联合召回" tone="success" />
        <MetricCard label="Top K" value={String(rag?.reranker_top_k ?? 20)} hint="候选证据进入重排的数量" tone="success" />
        <MetricCard label="Rerank" value={rag?.enable_reranker ? "已启用" : "未启用"} hint={rag?.reranker_model || "待配置"} tone={rag?.enable_reranker ? "success" : "warning"} />
        <MetricCard label="检索缓存" value={rag?.enable_search_cache ? "已启用" : "未启用"} hint="降低重复检索延迟" tone={rag?.enable_search_cache ? "success" : "warning"} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {ragToggles.map((item) => (
          <ToggleRow key={item.label} {...item} />
        ))}
      </div>
    </SettingsSectionShell>
  );
}
