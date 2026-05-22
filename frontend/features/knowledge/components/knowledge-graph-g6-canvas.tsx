"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CommonEvent, Graph as G6Graph, type GraphOptions, NodeEvent } from "@antv/g6"
import { Maximize2, Minimize2, ZoomIn, ZoomOut } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip"

type GraphMode = "business" | "semantic"

type CanvasNode = {
  id: string
  kind: string
  label: string
  color: string
  degree: number
  level: 0 | 1 | 2 | 3
  branchKey: string
  combo?: string
}

type CanvasLink = {
  id: number
  source: string | CanvasNode
  target: string | CanvasNode
  relation_type: string
  notes: string | null
  created_at: string
  color: string
}

type CanvasCombo = {
  id: string
  label: string
  color: string
  kind: string
  count: number
}

type CanvasGraphData = {
  nodes: CanvasNode[]
  links: CanvasLink[]
  combos: CanvasCombo[]
}

const COMPACT_TREE_ROOT_ID = "__compact_tree_root__"

type Props = {
  mode: GraphMode
  graphData: CanvasGraphData
  isDark: boolean
  selectedNodeId?: string | null
  selectedNeighborIds?: string[]
  kindLabels: Record<string, string>
  kindColors: Record<string, string>
  relationLabels: Record<string, string>
  onNodeClick: (nodeId: string) => void
  onBackgroundClick: () => void
}

function truncateLabel(value: string, maxChars: number) {
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "")
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized
  const num = Number.parseInt(value, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function buildLayout(mode: GraphMode) {
  return mode === "semantic"
    ? ({
        type: "combo-combined",
        center: [0, 0],
        comboPadding: 48,
        nodeSpacing: 28,
        preventOverlap: true,
        outerLayout: {
          type: "d3-force",
          manyBody: { strength: -320 },
          link: { distance: 220 },
        },
        innerLayout: { type: "concentric", preventOverlap: true, nodeSize: 28, spacing: 24 },
      } as any)
    : ({
        type: "compact-box",
        direction: "LR",
        getId: (datum: any) => datum.id,
        getWidth: (datum: any) => {
          const label = String(datum?.data?.label ?? datum?.id ?? "")
          if (datum?.id === COMPACT_TREE_ROOT_ID) return 1
          return Math.min(230, Math.max(96, label.length * 8 + 56))
        },
        getHeight: (datum: any) => {
          if (datum?.id === COMPACT_TREE_ROOT_ID) return 1
          const level = Number(datum?.data?.level ?? 2)
          return level <= 1 ? 50 : 38
        },
        getHGap: (datum: any) => {
          if (datum?.id === COMPACT_TREE_ROOT_ID) return 80
          const level = Number(datum?.data?.level ?? 2)
          return level <= 1 ? 96 : 84
        },
        getVGap: (datum: any) => {
          if (datum?.id === COMPACT_TREE_ROOT_ID) return 42
          const kind = String(datum?.data?.kind ?? "")
          return kind === "knowledge_chunk" ? 34 : 44
        },
        getSubTreeSep: () => 42,
      } as any)
}

function getZoomRange(mode: GraphMode): [number, number] {
  return [0.25, 2]
}

function getNodeSizeByDegree(node: CanvasNode, maxDegree: number) {
  const kindSize: Record<string, number> = {
    maintenance_case: 34,
    knowledge_document: 26,
    knowledge_chunk: 20,
    maintenance_task: 30,
  }
  const baseSize = kindSize[node.kind] ?? 22
  if (maxDegree <= 0) return baseSize
  const minSize = baseSize
  const maxSize = baseSize + 16
  const normalized = Math.min(node.degree / maxDegree, 1)
  const boosted = Math.sqrt(normalized)
  const levelBias = node.level === 0 ? 8 : node.level === 1 ? 4 : 0
  return Math.round(minSize + boosted * (maxSize - minSize) + levelBias)
}

function getUniqueNodes(nodes: CanvasNode[]) {
  const seen = new Set<string>()
  const uniqueNodes: CanvasNode[] = []

  for (const node of nodes) {
    if (seen.has(node.id)) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[KnowledgeGraphG6Canvas] duplicate node id ignored: ${node.id}`)
      }
      continue
    }
    seen.add(node.id)
    uniqueNodes.push(node)
  }

  return uniqueNodes
}

function buildCompactTreeLinks(nodes: CanvasNode[], links: CanvasLink[]) {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const orderedLinks = [...links].sort((left, right) => {
    const leftSource = typeof left.source === "object" ? left.source.id : left.source
    const leftTarget = typeof left.target === "object" ? left.target.id : left.target
    const rightSource = typeof right.source === "object" ? right.source.id : right.source
    const rightTarget = typeof right.target === "object" ? right.target.id : right.target
    const leftSourceLevel = nodeById.get(leftSource)?.level ?? 3
    const leftTargetLevel = nodeById.get(leftTarget)?.level ?? 3
    const rightSourceLevel = nodeById.get(rightSource)?.level ?? 3
    const rightTargetLevel = nodeById.get(rightTarget)?.level ?? 3
    const leftScore = Math.abs(leftTargetLevel - leftSourceLevel)
    const rightScore = Math.abs(rightTargetLevel - rightSourceLevel)
    return rightScore - leftScore
  })
  const parentByTarget = new Set<string>()
  const treeLinks: CanvasLink[] = []

  for (const link of orderedLinks) {
    const rawSourceId = typeof link.source === "object" ? link.source.id : link.source
    const rawTargetId = typeof link.target === "object" ? link.target.id : link.target
    if (!nodeIds.has(rawSourceId) || !nodeIds.has(rawTargetId) || rawSourceId === rawTargetId) continue

    const sourceLevel = nodeById.get(rawSourceId)?.level ?? 3
    const targetLevel = nodeById.get(rawTargetId)?.level ?? 3
    const sourceId = sourceLevel <= targetLevel ? rawSourceId : rawTargetId
    const targetId = sourceLevel <= targetLevel ? rawTargetId : rawSourceId
    if (parentByTarget.has(targetId)) continue

    parentByTarget.add(targetId)
    treeLinks.push({ ...link, source: sourceId, target: targetId })
  }

  const rootIds = nodes.map((node) => node.id).filter((id) => !parentByTarget.has(id))
  rootIds.forEach((rootId, index) => {
    treeLinks.push({
      id: -index - 1,
      source: COMPACT_TREE_ROOT_ID,
      target: rootId,
      relation_type: "tree_root",
      notes: null,
      created_at: "",
      color: "#94a3b8",
    })
  })

  return treeLinks
}

function buildOptions({
  mode,
  graphData,
  isDark,
  selectedNodeId,
  selectedNeighborIds,
  kindLabels,
  relationLabels,
}: Omit<Props, "onNodeClick" | "onBackgroundClick">): GraphOptions {
  const neighborSet = new Set(selectedNeighborIds ?? [])
  const uniqueNodes = getUniqueNodes(graphData.nodes)
  const uniqueNodeIds = new Set(uniqueNodes.map((node) => node.id))
  const validLinks = graphData.links.filter((link) => {
    const sourceId = typeof link.source === "object" ? link.source.id : link.source
    const targetId = typeof link.target === "object" ? link.target.id : link.target
    return uniqueNodeIds.has(sourceId) && uniqueNodeIds.has(targetId)
  })
  const renderSourceNodes =
    mode === "business"
      ? [
          {
            id: COMPACT_TREE_ROOT_ID,
            kind: "virtual_root",
            label: "",
            color: "rgba(0,0,0,0)",
            degree: 0,
            level: 0,
            branchKey: COMPACT_TREE_ROOT_ID,
          } satisfies CanvasNode,
          ...uniqueNodes,
        ]
      : uniqueNodes
  const maxDegree = uniqueNodes.reduce((currentMax, node) => Math.max(currentMax, node.degree), 0)
  const nodeSizes = new Map(renderSourceNodes.map((node) => [node.id, getNodeSizeByDegree(node, maxDegree)]))
  const layoutLinks = mode === "business" ? buildCompactTreeLinks(uniqueNodes, validLinks) : validLinks
  const nodes = renderSourceNodes.map((node) => {
    const isVirtualRoot = node.id === COMPACT_TREE_ROOT_ID
    const isSelected = selectedNodeId === node.id
    const isNeighbor = neighborSet.has(node.id)
    const isDimmed = Boolean(selectedNodeId && !isSelected && !isNeighbor)
    const nodeSize = nodeSizes.get(node.id) ?? 18
    const showLabel = isVirtualRoot ? false : selectedNodeId ? isSelected || isNeighbor : true

    return {
      id: node.id,
      combo: isVirtualRoot ? undefined : node.combo,
      type: "circle",
      data: {
        label: node.label,
        kindLabel: kindLabels[node.kind] || node.kind,
        relationWeight: node.degree,
        level: node.level,
        kind: node.kind,
      },
      style: {
        size: isVirtualRoot ? 1 : nodeSize,
        fill: isVirtualRoot
          ? "rgba(0,0,0,0)"
          : isDimmed
            ? isDark
              ? "rgba(148,163,184,0.2)"
              : "rgba(255,255,255,0.75)"
            : node.color,
        stroke: isVirtualRoot
          ? "rgba(0,0,0,0)"
          : isSelected
            ? node.color
            : isDark
              ? "rgba(255,255,255,0.16)"
              : "rgba(15,23,42,0.08)",
        lineWidth: isVirtualRoot ? 0 : isSelected ? 2.6 : node.level === 0 ? 1.5 : 1,
        opacity: isVirtualRoot ? 0 : undefined,
        pointerEvents: isVirtualRoot ? "none" : undefined,
        shadowColor: isSelected ? node.color : undefined,
        shadowBlur: isSelected ? 16 : 0,
        label: showLabel,
        labelText: truncateLabel(node.label, mode === "business" ? 18 : node.level === 0 ? 11 : node.level === 1 ? 8 : 6),
        labelFill:
          node.level === 0
            ? isDark
              ? "#ffffff"
              : "rgba(15,23,42,0.96)"
            : isDark
              ? "rgba(248,250,252,0.96)"
              : "rgba(15,23,42,0.92)",
        labelFontSize: node.level === 0 ? 13 : 11,
        labelPlacement: mode === "business" ? "right" : "bottom",
        labelOffsetX: mode === "business" ? 10 + Math.round(nodeSize / 8) : undefined,
        labelOffsetY: mode === "business" ? 0 : 10 + Math.round(nodeSize / 8),
        labelBackground: showLabel,
        labelBackgroundFill: isDimmed
          ? isDark
            ? "rgba(15,23,42,0.42)"
            : "rgba(255,255,255,0.92)"
          : isDark
            ? "rgba(15,23,42,0.3)"
            : "rgba(255,255,255,0.98)",
        labelBackgroundRadius: 8,
        labelPadding: [5, 8],
      } as any,
    }
  }) as any[]

  const edges = layoutLinks.map((link) => {
    const sourceId = typeof link.source === "object" ? link.source.id : link.source
    const targetId = typeof link.target === "object" ? link.target.id : link.target
    const isVirtualRootEdge = sourceId === COMPACT_TREE_ROOT_ID
    const isActive = Boolean(selectedNodeId && (sourceId === selectedNodeId || targetId === selectedNodeId))
    const isDimmed = Boolean(selectedNodeId && !isActive)

    return {
      id: String(link.id),
      source: sourceId,
      target: targetId,
      data: {
        relationLabel: relationLabels[link.relation_type] || link.relation_type,
      },
      style: {
        stroke: isVirtualRootEdge
          ? "rgba(0,0,0,0)"
          : isDimmed
            ? isDark
              ? "rgba(148,163,184,0.18)"
              : "rgba(100,116,139,0.22)"
            : hexToRgba(link.color, 0.62),
        lineWidth: isVirtualRootEdge ? 0 : isActive ? 2.8 : mode === "semantic" ? 1.35 : 1.2,
        endArrow: isVirtualRootEdge ? false : true,
        endArrowSize: 5,
        opacity: isVirtualRootEdge ? 0 : isDimmed ? 0.1 : isActive ? 0.9 : 0.4,
        pointerEvents: isVirtualRootEdge ? "none" : undefined,
        labelText: isActive ? (relationLabels[link.relation_type] || link.relation_type) : "",
        labelFontSize: 10,
        labelFill: isDark ? "rgba(226,232,240,0.9)" : "rgba(30,41,59,0.78)",
        labelBackground: isActive,
        labelBackgroundFill: isDark ? "rgba(15,23,42,0.8)" : "rgba(255,255,255,0.92)",
        labelBackgroundRadius: 4,
        labelPadding: [2, 5],
        curveOffset: mode === "business" ? 10 : 18,
        radius: mode === "business" ? 10 : 0,
      } as any,
    }
  }) as any[]

  const combos = graphData.combos.map((combo) => ({
    id: combo.id,
    data: {
      label: combo.label,
    },
    type: "rect",
    style: {
      collapsed: false,
      pointerEvents: "none",
      labelText: "",
      labelPlacement: "top",
      labelFill: isDark ? "rgba(226,232,240,0.95)" : "rgba(30,41,59,0.88)",
      labelFontSize: 12,
      labelBackground: false,
      labelBackgroundFill: isDark ? "rgba(15,23,42,0.7)" : "rgba(255,255,255,0.92)",
      labelBackgroundRadius: 8,
      labelPadding: [4, 8],
      fill: "rgba(0,0,0,0)",
      stroke: "rgba(0,0,0,0)",
      lineWidth: 0,
      radius: 16,
    } as any,
  })) as any[]

  return {
    autoFit: "view",
    zoomRange: getZoomRange(mode),
    padding: mode === "business" ? [28, 72, 28, 96] : [32, 56, 32, 56],
    data: { nodes, edges, combos } as any,
    animation: false,
    layout: buildLayout(mode),
    edge: {
      type: "cubic-vertical",
      style: {
        endArrow: true,
        endArrowSize: 5,
        opacity: 0.4,
      },
      state: {
        active: {
          halo: true,
          haloStrokeOpacity: 0.18,
          lineWidth: 2.8,
          opacity: 0.9,
          strokeOpacity: 0.95,
        },
        inactive: {
          labelOpacity: 0.1,
          opacity: 0.1,
          strokeOpacity: 0.1,
        },
      },
    },
    node: {
      style: { cursor: "pointer" },
      state: {
        active: {
          halo: true,
          haloLineWidth: 10,
          haloStrokeOpacity: 0.18,
          labelFontWeight: 600,
          strokeOpacity: 1,
        },
        inactive: {
          fillOpacity: 0.1,
          labelFillOpacity: 0.1,
          strokeOpacity: 0.1,
        },
      },
    },
    combo: { type: "rect" } as any,
    plugins: [
      {
        type: "tooltip",
        trigger: "hover",
        enable: (event: any) => event?.targetType === "node",
        position: "top-right",
        offset: [12, 12],
        enterable: false,
        onOpenChange: () => {},
        getContent: (event: any) => {
          const nodeId = event?.target?.id
          if (nodeId === COMPACT_TREE_ROOT_ID) return ""
          const node = uniqueNodes.find((item) => item.id === nodeId)
          if (!node) return ""
          const kindLabel = kindLabels[node.kind] || node.kind
          const fullLabel = node.label.replace(/[&<>"']/g, (char) => {
            const entities: Record<string, string> = {
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            }
            return entities[char] || char
          })
          return `
            <div style="max-width:280px;padding:10px 12px;border-radius:8px;background:${isDark ? "rgba(15,23,42,0.96)" : "rgba(255,255,255,0.98)"};box-shadow:0 12px 32px rgba(15,23,42,0.16);border:1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.12)"};">
              <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:${isDark ? "rgba(226,232,240,0.72)" : "rgba(71,85,105,0.9)"};">
                <span style="width:9px;height:9px;border-radius:999px;background:${node.color};display:inline-block;"></span>
                ${kindLabel}
              </div>
              <div style="margin-top:6px;font-size:13px;line-height:1.55;color:${isDark ? "#f8fafc" : "#0f172a"};word-break:break-word;">${fullLabel}</div>
              <div style="margin-top:8px;font-size:11px;color:${isDark ? "rgba(148,163,184,0.9)" : "rgba(100,116,139,0.9)"};">连接数 ${node.degree} · 层级 ${node.level}</div>
            </div>
          `
        },
      },
    ] as any,
    behaviors: [
      { type: "drag-canvas" },
      { type: "zoom-canvas", sensitivity: 1.08 },
      { type: "collapse-expand", enable: false },
      { type: "auto-adapt-label" },
      { type: "hover-activate", degree: 1, direction: "both", state: "active", inactiveState: "inactive", animation: false },
    ] as any,
  }
}

export default function KnowledgeGraphG6Canvas(props: Props) {
  const { onNodeClick, onBackgroundClick } = props
  const graphRef = useRef<G6Graph | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const onNodeClickRef = useRef(onNodeClick)
  const onBackgroundClickRef = useRef(onBackgroundClick)
  const isDisposedRef = useRef(false)
  const hasRenderedRef = useRef(false)
  const latestOptionsRef = useRef<GraphOptions | null>(null)
  const initialRenderPromiseRef = useRef<Promise<void> | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  onNodeClickRef.current = onNodeClick
  onBackgroundClickRef.current = onBackgroundClick

  const options = useMemo(
    () => buildOptions(props),
    [
      props.mode,
      props.graphData,
      props.isDark,
      props.selectedNodeId,
      props.selectedNeighborIds,
      props.kindLabels,
      props.relationLabels,
    ],
  )
  latestOptionsRef.current = options

  const refreshViewport = useCallback((shouldFitView = false) => {
    const graph = graphRef.current
    const container = containerRef.current
    if (!graph || !container || graph.destroyed || isDisposedRef.current || !hasRenderedRef.current) return
    const width = Math.max(container.clientWidth, 1)
    const height = Math.max(container.clientHeight, 1)
    graph.resize(width, height)
    if (shouldFitView) {
      void graph.fitView().catch(() => {
        /* silent */
      })
    }
  }, [])

  const syncGraphWithLatestOptions = useCallback(() => {
    const graph = graphRef.current
    const latestOptions = latestOptionsRef.current
    if (!graph || !latestOptions || graph.destroyed || isDisposedRef.current || !hasRenderedRef.current) return
    graph.setOptions(latestOptions)
    graph.setData((latestOptions as any).data)
    void graph.draw().catch(() => {
      /* silent */
    })
  }, [])

  const handleFullscreenToggle = useCallback(() => {
    const shell = shellRef.current
    if (!shell) return
    if (document.fullscreenElement === shell) {
      void document.exitFullscreen().catch(() => {
        /* silent */
      })
      return
    }
    void shell.requestFullscreen().catch(() => {
      /* silent */
    })
  }, [])

  const handleZoomIn = useCallback(() => {
    const graph = graphRef.current
    if (!graph || graph.destroyed) return
    void graph.zoomBy(1.2).catch(() => {
      /* silent */
    })
  }, [])

  const handleZoomOut = useCallback(() => {
    const graph = graphRef.current
    if (!graph || graph.destroyed) return
    void graph.zoomBy(0.8).catch(() => {
      /* silent */
    })
  }, [])

  useEffect(() => {
    isDisposedRef.current = false
    hasRenderedRef.current = false
    const graph = new G6Graph({
      container: containerRef.current!,
      ...options,
    } as GraphOptions)
    graphRef.current = graph

    graph.on(NodeEvent.CLICK, (event: any) => {
      const nodeId = event?.target?.id
      if (nodeId) onNodeClickRef.current(nodeId)
    })
    graph.on(CommonEvent.CLICK, (event: any) => {
      if (event?.targetType === "canvas") onBackgroundClickRef.current()
    })

    const renderPromise = graph
      .render()
      .then(() => {
        if (!isDisposedRef.current) {
          hasRenderedRef.current = true
          syncGraphWithLatestOptions()
        }
      })
      .catch(() => {
        /* silent */
      })
    initialRenderPromiseRef.current = renderPromise

    return () => {
      isDisposedRef.current = true
      hasRenderedRef.current = false
      const safeDestroy = () => {
        if (!graph.destroyed) graph.destroy()
      }
      if (initialRenderPromiseRef.current) {
        void initialRenderPromiseRef.current.finally(safeDestroy)
      } else {
        safeDestroy()
      }
      graphRef.current = undefined
      initialRenderPromiseRef.current = null
    }
  }, [syncGraphWithLatestOptions])

  useEffect(() => {
    syncGraphWithLatestOptions()
  }, [options, syncGraphWithLatestOptions])

  useEffect(() => {
    const updateFullscreenState = () => {
      const fullscreen = document.fullscreenElement === shellRef.current
      setIsFullscreen(fullscreen)
      requestAnimationFrame(() => {
        refreshViewport(true)
      })
    }
    document.addEventListener("fullscreenchange", updateFullscreenState)
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState)
    }
  }, [refreshViewport])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      refreshViewport(false)
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
    }
  }, [refreshViewport])

  return (
    <div
      ref={shellRef}
      className="relative h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#edf4fb_100%)] fullscreen:h-screen fullscreen:w-screen dark:bg-[linear-gradient(180deg,#08111f_0%,#0f1b2d_100%)]"
    >
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute right-4 top-4 z-10 rounded-md border border-slate-200/80 bg-white/88 px-3 py-2 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-slate-950/78">
        <div className="grid gap-2 text-sm">
          {Object.entries(props.kindLabels).map(([key, label]) => (
            <div key={key} className="flex items-center gap-2 whitespace-nowrap text-slate-700 dark:text-slate-200">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: props.kindColors[key] || "#64748b" }}
              />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex flex-col gap-2">
        {[
          {
            key: "fullscreen",
            label: isFullscreen ? "退出全屏" : "全屏观看",
            icon: isFullscreen ? Minimize2 : Maximize2,
            onClick: handleFullscreenToggle,
          },
          { key: "zoom-in", label: "放大", icon: ZoomIn, onClick: handleZoomIn },
          { key: "zoom-out", label: "缩小", icon: ZoomOut, onClick: handleZoomOut },
        ].map((item) => {
          const Icon = item.icon
          return (
            <Tooltip key={item.key}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={item.onClick}
                  className="pointer-events-auto inline-flex h-12 w-12 items-center justify-center rounded-md border border-slate-200/90 bg-white/92 text-slate-700 shadow-sm backdrop-blur-sm transition-colors hover:bg-slate-50 hover:text-slate-950 dark:border-white/10 dark:bg-slate-950/88 dark:text-slate-100 dark:hover:bg-slate-900"
                  aria-label={item.label}
                >
                  <Icon className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
