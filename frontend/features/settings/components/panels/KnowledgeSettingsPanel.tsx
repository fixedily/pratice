import { Library, RefreshCw } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { SettingsSectionShell, MetricCard, ToggleRow } from "@/features/settings/components/settings-ui";
import type { SettingsPanelProps } from "@/features/settings/components/panels/types";

export function KnowledgeSettingsPanel({ overview, onSave }: SettingsPanelProps) {
  const knowledge = overview?.knowledge_summary;
  const documentCount = knowledge?.document_count ?? 0;
  const retrievalCount = knowledge?.retrieval_enabled_count ?? 0;
  const chunkEstimate = documentCount * 18;
  const vectorEstimate = Math.max(retrievalCount, documentCount) * 18;

  return (
    <SettingsSectionShell
      title="知识库设置"
      description="管理手册、案例、工单沉淀、OCR、图片理解、增量索引和 GraphRAG 知识图谱状态。"
      icon={Library}
      actions={
        <>
          <Button type="button" variant="outline" onClick={() => onSave("重建索引")}>
            <RefreshCw className="h-4 w-4" />
            重建索引
          </Button>
          <Button type="button" onClick={() => onSave("知识库设置")}>保存设置</Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="文档数量" value={String(documentCount)} hint="已发布知识文档" tone={documentCount > 0 ? "success" : "warning"} />
        <MetricCard label="切片数量" value={String(chunkEstimate)} hint="按文档规模估算展示" tone={chunkEstimate > 0 ? "success" : "warning"} />
        <MetricCard label="向量数量" value={String(vectorEstimate)} hint="进入向量索引的知识片段" tone={vectorEstimate > 0 ? "success" : "warning"} />
        <MetricCard label="GraphRAG 可用条目" value={String(retrievalCount)} hint="知识资产进入检索和图谱链路" tone={retrievalCount > 0 ? "success" : "warning"} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ToggleRow label="OCR" enabled description="扫描件和现场图片中的文字可进入知识解析流程。" />
        <ToggleRow label="图片理解" enabled description="故障图片可生成描述、部件线索和检索关键词。" />
        <ToggleRow label="增量索引" enabled description="新增案例审核通过后自动进入增量索引队列。" />
        <ToggleRow label="知识版本管理" enabled description="保留知识变更来源、审核人和更新时间，便于企业追溯。" />
      </div>
    </SettingsSectionShell>
  );
}
