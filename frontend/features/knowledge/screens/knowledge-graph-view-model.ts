type GraphStatsLike =
  | {
      total_nodes: number
      total_edges: number
      nodes_by_kind: Record<string, number>
      edges_by_type: Record<string, number>
    }
  | {
      total_entities: number
      total_relations: number
      entities_by_type: Record<string, number>
      relations_by_type: Record<string, number>
    }

type DominantMetric = {
  key: string
  count: number
}

function getTopEntry(source: Record<string, number>): DominantMetric {
  const [key, count] =
    Object.entries(source).sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1]
      }
      return left[0].localeCompare(right[0])
    })[0] ?? ["unknown", 0]

  return { key, count }
}

export function getDominantKind(stats: GraphStatsLike | null): DominantMetric {
  if (!stats) {
    return { key: "unknown", count: 0 }
  }

  const source = "nodes_by_kind" in stats ? stats.nodes_by_kind : stats.entities_by_type
  return getTopEntry(source ?? {})
}

export function getDominantRelation(stats: GraphStatsLike | null): DominantMetric {
  if (!stats) {
    return { key: "unknown", count: 0 }
  }

  const source = "edges_by_type" in stats ? stats.edges_by_type : stats.relations_by_type
  return getTopEntry(source ?? {})
}

export function getFilterSummary(kindLabel?: string | null, relationLabel?: string | null) {
  return `${kindLabel || "全部类型"} / ${relationLabel || "全部关系"}`
}

type SelectionSummaryInput = {
  label?: string | null
  kindLabel?: string | null
  degree?: number | null
  levelLabel?: string | null
}

type SelectionSummary = {
  title: string
  description: string
  meta: string
}

export function getSelectionSummary(input?: SelectionSummaryInput | null): SelectionSummary {
  if (!input?.label) {
    return {
      title: "等待选择节点",
      description: "点击节点后查看与其他知识对象的连接关系",
      meta: "右侧会联动展示关系清单，便于讲解案例、任务与知识文档的沉淀链路。",
    }
  }

  const details = [input.kindLabel, input.levelLabel, typeof input.degree === "number" ? `${input.degree} 条连接` : null]
    .filter(Boolean)
    .join(" · ")

  return {
    title: input.label,
    description: "已聚焦该节点的一跳连接和属性信息",
    meta: details || "已选中节点",
  }
}
