"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import Link from "next/link"
import { ArrowLeft, RefreshCw, Filter, Network, Sparkles } from "lucide-react"
import { Header } from "@/shared/components/brand/app-header"
import KnowledgeGraphG6Canvas from "@/features/knowledge/components/knowledge-graph-g6-canvas"
import { useAppTheme } from "@/shared/theme/app-theme"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs"
import {
  fetchKnowledgeGraph,
  fetchKnowledgeGraphStats,
  type GraphNode,
  type GraphEdge,
  type GraphStatsResponse,
} from "@/features/knowledge/api"
import {
  getDominantKind,
  getDominantRelation,
  getFilterSummary,
  getSelectionSummary,
} from "@/features/knowledge/screens/knowledge-graph-view-model"

const KIND_COLORS: Record<string, string> = {
  maintenance_case: "#f59e0b",
  knowledge_document: "#3b82f6",
  knowledge_chunk: "#14b8a6",
  maintenance_task: "#a855f7",
}

const KIND_LABELS: Record<string, string> = {
  maintenance_case: "检修案例",
  knowledge_document: "知识文档",
  knowledge_chunk: "知识分段",
  maintenance_task: "检修任务",
}

const RELATION_LABELS: Record<string, string> = {
  derived_from: "来源于",
  references: "引用",
  approved_into: "沉淀为",
  cites: "引用",
  corrected: "已修正",
  published_into: "发布为",
}

const ALL_KIND_COLORS: Record<string, string> = { ...KIND_COLORS }

type GraphNodeLevel = 0 | 1 | 2 | 3
type GraphMode = "business"

type VisualNode = GraphNode & {
  color: string
  degree: number
  level: GraphNodeLevel
  branchKey: string
  combo?: string
}

type VisualLink = {
  id: number
  source: string | VisualNode
  target: string | VisualNode
  relation_type: string
  notes: string | null
  created_at: string
  color: string
}

interface GraphData {
  nodes: VisualNode[]
  links: VisualLink[]
  combos: { id: string; label: string; color: string; kind: string; count: number }[]
}

type OverviewCard = {
  label: string
  value: string
  meta: string
  accent: string
}

type UnifiedGraphStats = {
  totalNodes: number
  totalEdges: number
  nodesByKind: Record<string, number>
  edgesByType: Record<string, number>
}

function getModeTitle() {
  return "检索证据图谱"
}

function getModeBadge() {
  return "证据溯源视角"
}

function getModeDescription() {
  return "展示答案来自哪些案例、工单、手册与知识分段，突出证据来源、引用链路与知识沉淀。"
}

function toUnifiedStats(stats: GraphStatsResponse | null): UnifiedGraphStats | null {
  if (!stats) return null
  const graphStats = stats
  return {
    totalNodes: graphStats.total_nodes,
    totalEdges: graphStats.total_edges,
    nodesByKind: graphStats.nodes_by_kind ?? {},
    edgesByType: graphStats.edges_by_type ?? {},
  }
}

function toBusinessGraphData(graph: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  return buildGraphData(graph.nodes, graph.edges)
}

function truncateLabel(value: string, maxChars: number) {
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value
}

function computeConnectedComponents(nodes: GraphNode[], adjacency: Map<string, Set<string>>) {
  const visited = new Set<string>()
  const components: string[][] = []
  for (const node of nodes) {
    if (visited.has(node.id)) continue
    const queue = [node.id]
    const component: string[] = []
    visited.add(node.id)
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) continue
      component.push(current)
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue
        visited.add(neighbor)
        queue.push(neighbor)
      }
    }
    components.push(component)
  }
  return components.sort((left, right) => right.length - left.length)
}

function deriveNodeHierarchy(componentNodeIds: string[], adjacency: Map<string, Set<string>>, degree: Map<string, number>) {
  const levels = new Map<string, GraphNodeLevel>()
  const branchKeys = new Map<string, string>()
  const sortedNodes = [...componentNodeIds].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))
  const centerId = sortedNodes[0] ?? componentNodeIds[0]
  const centerNeighbors = [...(adjacency.get(centerId) ?? new Set<string>())].sort(
    (a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0),
  )

  levels.set(centerId, 0)
  branchKeys.set(centerId, centerId)
  centerNeighbors.forEach((nodeId) => {
    levels.set(nodeId, 1)
    branchKeys.set(nodeId, nodeId)
  })

  const queue = [...centerNeighbors]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    const currentLevel = levels.get(current) ?? 1
    if (currentLevel >= 3) continue
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!componentNodeIds.includes(neighbor) || levels.has(neighbor)) continue
      const nextLevel = Math.min(3, currentLevel + 1) as GraphNodeLevel
      levels.set(neighbor, nextLevel)
      branchKeys.set(neighbor, branchKeys.get(current) ?? current)
      queue.push(neighbor)
    }
  }

  for (const nodeId of componentNodeIds) {
    if (!levels.has(nodeId)) {
      levels.set(nodeId, componentNodeIds.length <= 2 ? 1 : 3)
      branchKeys.set(nodeId, centerNeighbors[0] ?? centerId)
    }
  }
  return { levels, branchKeys, centerId }
}

function buildGraphData(nodes: GraphNode[], edges: GraphEdge[]): GraphData {
  if (nodes.length === 0) {
    return { nodes: [], links: [], combos: [] }
  }

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const adjacency = new Map<string, Set<string>>()
  const degree = new Map<string, number>()
  for (const node of nodes) {
    adjacency.set(node.id, new Set())
    degree.set(node.id, 0)
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.add(edge.target)
    adjacency.get(edge.target)?.add(edge.source)
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }

  const components = computeConnectedComponents(nodes, adjacency)
  const hierarchyById = new Map<string, { level: GraphNodeLevel; branchKey: string }>()
  components.forEach((componentNodeIds) => {
    const hierarchy = deriveNodeHierarchy(componentNodeIds, adjacency, degree)
    componentNodeIds.forEach((nodeId) => {
      hierarchyById.set(nodeId, {
        level: hierarchy.levels.get(nodeId) ?? 3,
        branchKey: hierarchy.branchKeys.get(nodeId) ?? hierarchy.centerId,
      })
    })
  })

  const comboCounts = new Map<string, number>()
  const visualNodes = nodes.map((node) => {
    const hierarchy = hierarchyById.get(node.id)
    const combo = `kind:${node.kind}`
    comboCounts.set(combo, (comboCounts.get(combo) ?? 0) + 1)
    return {
      ...node,
      color: ALL_KIND_COLORS[node.kind] || "#64748b",
      degree: degree.get(node.id) ?? 0,
      level: hierarchy?.level ?? 3,
      branchKey: hierarchy?.branchKey ?? node.id,
      combo,
    }
  })
  const nodeById = new Map(visualNodes.map((node) => [node.id, node]))
  const visualLinks = edges.map((edge) => {
    const sourceNode = nodeById.get(edge.source)
    const targetNode = nodeById.get(edge.target)
    const branchKey =
      sourceNode?.level === 0 ? targetNode?.branchKey : sourceNode?.branchKey || targetNode?.branchKey || edge.source
    const branchNode = nodeById.get(branchKey ?? edge.source)
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      relation_type: edge.relation_type,
      notes: edge.notes,
      created_at: edge.created_at,
      color: branchNode?.color || sourceNode?.color || "#94a3b8",
    }
  })

  const combos = Array.from(comboCounts.entries()).map(([comboId, count]) => {
    const kind = comboId.replace("kind:", "")
    return {
      id: comboId,
      label: truncateLabel((KIND_LABELS[kind] || kind) as string, 16),
      color: ALL_KIND_COLORS[kind] || "#64748b",
      kind,
      count,
    }
  })

  return { nodes: visualNodes, links: visualLinks, combos }
}

function buildOverviewCards(
  stats: UnifiedGraphStats | null,
  filterSummary: string,
  dominantRelation: { key: string; count: number },
  dominantKind: { key: string; count: number },
  relationLabels: Record<string, string>,
  kindLabels: Record<string, string>,
): OverviewCard[] {
  return [
    {
      label: "节点总数",
      value: String(stats?.totalNodes ?? 0),
      meta: filterSummary,
      accent:
        "border-sky-200/80 bg-sky-50 text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-200",
    },
    {
      label: "关系总数",
      value: String(stats?.totalEdges ?? 0),
      meta: "覆盖案例、文档、工单与知识分段",
      accent:
        "border-amber-200/80 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200",
    },
      {
        label: "热点关系",
        value: String(dominantRelation.count),
        meta:
          dominantRelation.count > 0
          ? `当前最高频关系：${relationLabels[dominantRelation.key] ?? dominantRelation.key} (${dominantRelation.key})`
          : "等待关系沉淀",
        accent:
          "border-emerald-200/80 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200",
      },
    {
      label: "活跃类型",
      value: String(dominantKind.count),
        meta:
          dominantKind.count > 0
          ? `当前最活跃类型：${kindLabels[dominantKind.key] ?? dominantKind.key}`
          : "等待知识沉淀",
      accent:
        "border-violet-200/80 bg-violet-50 text-violet-800 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-200",
    },
  ]
}

export default function KnowledgeGraphPage() {
  const { resolvedTheme } = useAppTheme()
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [], combos: [] })
  const [stats, setStats] = useState<GraphStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<VisualNode | null>(null)
  const [filterKind, setFilterKind] = useState<string>("")
  const [filterRelation, setFilterRelation] = useState<string>("")
  const [sidebarTab, setSidebarTab] = useState<"stats" | "detail">("stats")
  const graphMode: GraphMode = "business"

  const loadGraph = useCallback(async () => {
    setLoading(true)
    try {
      const [graph, s] = await Promise.all([
        fetchKnowledgeGraph({
          kind: filterKind || undefined,
          relation_type: filterRelation || undefined,
          limit: 300,
        }),
        fetchKnowledgeGraphStats(),
      ])
      const data = toBusinessGraphData(graph as { nodes: GraphNode[]; edges: GraphEdge[] })
      setStats(s)
      setGraphData(data)
      setSelectedNode((current) => {
        if (!current) return null
        return data.nodes.find((node) => node.id === current.id) ?? null
      })
    } catch {
      /* silent */
    } finally {
      setLoading(false)
    }
  }, [filterKind, filterRelation])

  useEffect(() => {
    void loadGraph()
  }, [loadGraph])

  const selectedNodeId = selectedNode?.id ?? null
  const labelMaps = useMemo(
    () => ({
      kindLabels: KIND_LABELS,
      relationLabels: RELATION_LABELS,
      kindColors: KIND_COLORS,
    }),
    [],
  )
  const normalizedStats = useMemo(() => toUnifiedStats(stats), [stats])
  const dominantKind = useMemo(() => getDominantKind(stats), [stats])
  const dominantRelation = useMemo(() => getDominantRelation(stats), [stats])
  const selectedKindLabel = filterKind ? (labelMaps.kindLabels[filterKind] ?? filterKind) : "全部类型"
  const selectedRelationLabel = filterRelation
    ? (labelMaps.relationLabels[filterRelation] ?? filterRelation)
    : "全部关系"
  const filterSummary = getFilterSummary(selectedKindLabel, selectedRelationLabel)
  const isDark = resolvedTheme === "dark"
  const selectedLevelLabel = selectedNode
    ? selectedNode.level === 0
      ? "证据核心"
      : selectedNode.level === 1
        ? "一级证据分支"
        : "证据节点"
    : null
  const selectionSummary = getSelectionSummary(
    selectedNode
      ? {
          label: selectedNode.label,
          kindLabel: labelMaps.kindLabels[selectedNode.kind] || selectedNode.kind,
          degree: selectedNode.degree,
          levelLabel: selectedLevelLabel,
        }
      : null,
  )
  const overviewCards = buildOverviewCards(
    normalizedStats,
    filterSummary,
    dominantRelation,
    dominantKind,
    labelMaps.relationLabels,
    labelMaps.kindLabels,
  )

  const selectedRelations = useMemo(() => {
    if (!selectedNodeId) return []
    return graphData.links
      .filter((link) => {
        const sourceId = typeof link.source === "object" ? link.source.id : link.source
        const targetId = typeof link.target === "object" ? link.target.id : link.target
        return sourceId === selectedNodeId || targetId === selectedNodeId
      })
      .map((link) => {
        const sourceId = typeof link.source === "object" ? link.source.id : link.source
        const targetId = typeof link.target === "object" ? link.target.id : link.target
        const neighborId = sourceId === selectedNodeId ? targetId : sourceId
        const neighbor = graphData.nodes.find((node) => node.id === neighborId)
        return {
          id: link.id,
          neighborId,
          relationType: labelMaps.relationLabels[link.relation_type] || link.relation_type,
          neighborLabel: neighbor?.label || neighborId,
          neighborKind: neighbor ? labelMaps.kindLabels[neighbor.kind] || neighbor.kind : "关联节点",
          color: neighbor?.color || link.color,
        }
      })
  }, [graphData, selectedNodeId, labelMaps.kindLabels, labelMaps.relationLabels])
  const selectedNeighborIds = useMemo(() => {
    return new Set(selectedRelations.map((item) => item.neighborId))
  }, [selectedRelations])
  const selectedNeighborIdsArray = useMemo(() => Array.from(selectedNeighborIds), [selectedNeighborIds])
  const handleNodeSelection = useCallback(
    (nodeId: string) => {
      const node = graphData.nodes.find((item) => item.id === nodeId)
      if (!node) return
      setSelectedNode(node)
      setSidebarTab("detail")
    },
    [graphData.nodes],
  )

  const graphHasData = graphData.nodes.length > 0
  const canvasStateTitle = loading ? "正在构建知识关系视图" : "暂无图谱数据"
  const canvasStateDescription = loading
    ? "正在同步节点、关系和热点统计，请稍候。"
    : "可先通过审核案例或创建检修任务生成关系网络。"

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="app-main app-main-wide">
        <section className="mb-4 flex flex-col gap-4 border-b border-border/80 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-4">
            <Link
              href="/knowledge"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              返回知识库
            </Link>
            <div>
                <div className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">
                  <Network className="h-3.5 w-3.5" />
                  {getModeBadge()}
                </div>
              <h1 className="mt-2 text-2xl font-semibold text-foreground">知识图谱工作台</h1>
              <div className="mt-2 text-lg font-medium text-foreground">{getModeTitle()}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {getModeDescription()}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={filterKind || "all"} onValueChange={(value) => setFilterKind(value === "all" ? "" : value)}>
                <SelectTrigger className="h-8 min-w-[136px] bg-background">
                  <SelectValue placeholder="全部类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部类型</SelectItem>
                  {Object.entries(labelMaps.kindLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filterRelation || "all"}
                onValueChange={(value) => setFilterRelation(value === "all" ? "" : value)}
              >
                <SelectTrigger className="h-8 min-w-[136px] bg-background">
                  <SelectValue placeholder="全部关系" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部关系</SelectItem>
                  {Object.entries(labelMaps.relationLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <button
              onClick={() => void loadGraph()}
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              刷新
            </button>
          </div>
        </section>

        <section aria-label="图谱态势带" className="mb-4 rounded-md border border-border bg-background">
          <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
            {overviewCards.map((card) => (
              <div
                key={card.label}
                className="flex min-h-[84px] items-center gap-3 px-4 py-3"
              >
                <span className={`inline-flex shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium ${card.accent}`}>
                  {card.label}
                </span>
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-foreground">{card.value}</div>
                  <div className="text-xs text-muted-foreground">{card.meta}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_360px]">
          <section className="relative overflow-hidden rounded-md border border-border bg-[linear-gradient(180deg,#f8fbff_0%,#edf4fb_100%)] dark:bg-[linear-gradient(180deg,#08111f_0%,#0f1b2d_100%)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_48%)] dark:bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),transparent_48%)]" />
            <div className="relative flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-5 py-4 dark:border-white/8">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-sky-700/80 dark:text-sky-200/70">Graph canvas</div>
                <div className="mt-1 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <Sparkles className="h-3.5 w-3.5 text-sky-600 dark:text-cyan-300" />
                  沿案例、文档、工单与知识分段拖拽查看证据链路，单击节点后查看右侧来源分析
                </div>
              </div>
              <div className="rounded-md border border-slate-200/80 bg-white/75 px-3 py-1 text-xs text-slate-700 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/8 dark:text-slate-200">
                {filterSummary}
              </div>
            </div>

            <div className="relative h-[640px] w-full xl:h-[700px]">
              {graphHasData ? (
                <KnowledgeGraphG6Canvas
                  mode={graphMode}
                  graphData={graphData}
                  isDark={isDark}
                  selectedNodeId={selectedNodeId}
                    selectedNeighborIds={selectedNeighborIdsArray}
                    kindLabels={labelMaps.kindLabels}
                    kindColors={labelMaps.kindColors}
                    relationLabels={labelMaps.relationLabels}
                    onNodeClick={handleNodeSelection}
                    onBackgroundClick={() => {
                      setSelectedNode(null)
                    }}
                  />
              ) : (
                <div className="flex h-full items-center justify-center px-8">
                  <div className="w-full max-w-md rounded-md border border-slate-200/80 bg-white/80 p-8 text-center shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md border border-sky-300/50 bg-sky-100/80 text-sky-700 dark:border-cyan-400/20 dark:bg-cyan-400/10 dark:text-cyan-200">
                      {loading ? (
                        <RefreshCw className="h-6 w-6 animate-spin" />
                      ) : (
                        <Network className="h-6 w-6" />
                      )}
                    </div>
                    <div className="mt-5 text-base font-medium text-slate-900 dark:text-white">{canvasStateTitle}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{canvasStateDescription}</p>
                    <div className="mt-5 inline-flex items-center gap-2 rounded-md border border-slate-200/80 bg-slate-50/90 px-3 py-1.5 text-xs text-slate-600 dark:border-white/10 dark:bg-white/8 dark:text-slate-300">
                      <span className="h-2 w-2 rounded-full bg-sky-500 dark:bg-cyan-300" />
                      {loading ? "工作台正在同步最新知识态势" : "工作台骨架已保留，可继续查看右侧分析说明"}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          <aside aria-label="图谱分析侧栏" className="min-h-0 xl:h-[780px]">
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-background">
              <div className="shrink-0 flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <h3 className="text-sm font-medium text-foreground">图谱分析侧栏</h3>
                <span className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] text-sky-800 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-200">
                  {getModeBadge()}
                </span>
              </div>

              <Tabs value={sidebarTab} onValueChange={(value) => setSidebarTab(value as "stats" | "detail")} className="flex min-h-0 flex-1 flex-col p-4">
                <TabsList className="grid h-10 w-full shrink-0 grid-cols-2">
                  <TabsTrigger value="stats">统计</TabsTrigger>
                  <TabsTrigger value="detail">详情</TabsTrigger>
                </TabsList>

                <TabsContent value="stats" className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                  <div>
                    <h4 className="text-sm font-medium text-foreground">图谱统计</h4>
                    <p className="mt-1 text-xs text-muted-foreground">按节点类型与当前筛选范围汇总画布数据。</p>
                  </div>
                  {stats ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-md border border-sky-200 bg-sky-50 p-3 dark:border-sky-500/20 dark:bg-sky-500/10">
                          <div className="text-xs text-sky-800 dark:text-sky-200">节点总数</div>
                          <div className="mt-1 text-2xl font-semibold text-foreground">{normalizedStats?.totalNodes ?? 0}</div>
                        </div>
                        <div className="rounded-md border border-violet-200 bg-violet-50 p-3 dark:border-violet-500/20 dark:bg-violet-500/10">
                          <div className="text-xs text-violet-800 dark:text-violet-200">关系总数</div>
                          <div className="mt-1 text-2xl font-semibold text-foreground">{normalizedStats?.totalEdges ?? 0}</div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {Object.entries(normalizedStats?.nodesByKind ?? {}).map(([key, value]) => (
                          <div key={key} className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
                            <span className="flex items-center gap-2 text-muted-foreground">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: labelMaps.kindColors[key] || "#64748b" }} />
                              {labelMaps.kindLabels[key] || key}
                            </span>
                            <span className="font-medium text-foreground">{value}</span>
                          </div>
                        ))}
                      </div>

                      <div className="rounded-md border border-border bg-muted/15 px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">筛选范围</div>
                        <div className="mt-2 text-sm font-medium text-foreground">{filterSummary}</div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          当前画布优先展示证据链路，右侧用于解释节点来源、关联结构与引用上下文。
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-md border border-dashed border-border bg-background/70 px-4 py-4 text-sm text-muted-foreground">
                      正在同步图谱统计，当前工作台骨架和分析说明保持可用。
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="detail" className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                  <div>
                    <h4 className="text-sm font-medium text-foreground">节点详情</h4>
                    <p className="mt-1 text-xs text-muted-foreground">单击画布节点后查看其类型、层级与相邻关系。</p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/15 p-4">
                    <div className="text-base font-medium text-foreground">{selectionSummary.title}</div>
                    <div className="mt-1 text-sm leading-6 text-muted-foreground">{selectionSummary.description}</div>
                    <div className="mt-3 text-xs text-muted-foreground">{selectionSummary.meta}</div>
                  </div>

                  {selectedNode ? (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-3 rounded-md border border-border bg-background px-3 py-2">
                        <div className="text-xs text-muted-foreground">节点类型</div>
                        <div className="mt-1 flex items-center gap-2 font-medium text-foreground">
                          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedNode.color }} />
                          {labelMaps.kindLabels[selectedNode.kind] || selectedNode.kind}
                        </div>
                      </div>
                      <div className="rounded-md border border-border bg-background px-3 py-2">
                        <div className="text-xs text-muted-foreground">连接数</div>
                        <div className="mt-1 font-medium text-foreground">{selectedNode.degree}</div>
                      </div>
                      <div className="col-span-2 rounded-md border border-border bg-background px-3 py-2">
                        <div className="text-xs text-muted-foreground">层级</div>
                        <div className="mt-1 font-medium text-foreground">{selectedLevelLabel}</div>
                      </div>
                    </div>
                  ) : null}

                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">连接方式</div>
                      {selectedRelations.length > 0 ? (
                        selectedRelations.slice(0, 8).map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="block w-full rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/40"
                          >
                            <div className="flex items-center gap-2 text-foreground">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                              <span className="font-medium">{item.neighborLabel}</span>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {item.neighborKind} · {item.relationType}
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="rounded-md border border-dashed border-border bg-background px-3 py-3 text-sm text-muted-foreground">
                          选中节点后，这里会列出相邻对象与关系类型。
                        </div>
                      )}
                    </div>

                    {selectedNode && Object.entries(selectedNode.properties).length > 0 ? (
                      <div className="space-y-2">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">节点属性</div>
                        {Object.entries(selectedNode.properties).map(([key, value]) => (
                          <div key={key} className="rounded-md border border-border bg-background px-3 py-2">
                            <div className="text-xs text-muted-foreground">{key}</div>
                            <div className="mt-1 break-words text-sm text-foreground">{String(value)}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                </TabsContent>

              </Tabs>
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}
