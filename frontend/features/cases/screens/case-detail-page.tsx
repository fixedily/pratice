"use client"

import { use, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Edit3,
  ExternalLink,
  FileText,
  Link2,
  MessageSquareWarning,
  ScanSearch,
  ShieldAlert,
  Tag,
  Wrench,
  XCircle,
} from "lucide-react"
import { fetchCaseDetail, reviewMaintenanceCase, addCaseCorrection, type MaintenanceCaseDetail } from "@/features/cases/api"
import { Header } from "@/shared/components/brand/app-header"
import { Button } from "@/shared/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"
import { formatDateTimeLocal } from "@/shared/lib/utils"

interface PageProps {
  params: Promise<{ caseId: string }>
}

type FaultLevel = "low" | "medium" | "urgent"
type VerifyStatus = "verified" | "pending" | "rejected"
type KnowledgeRef = MaintenanceCaseDetail["knowledge_refs"][number]
type PageLoadState = "loading" | "ready" | "error" | "invalid"

const faultLevelConfig: Record<FaultLevel, { label: string; className: string; accentClass: string }> = {
  low: {
    label: "例行",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/20",
    accentClass: "text-blue-400",
  },
  medium: {
    label: "标准",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    accentClass: "text-amber-400",
  },
  urgent: {
    label: "紧急",
    className: "bg-red-500/15 text-red-400 border-red-500/20",
    accentClass: "text-red-400",
  },
}

const verifyStatusConfig: Record<
  VerifyStatus,
  {
    label: string
    dotColor: string
    textColor: string
    bgColor: string
    borderColor: string
    bannerClass: string
    summary: string
  }
> = {
  verified: {
    label: "已验证",
    dotColor: "bg-emerald-400",
    textColor: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
    bannerClass: "border-emerald-500/35 bg-emerald-500/12 text-emerald-300",
    summary: "已审核通过，可作为知识案例继续复用。",
  },
  pending: {
    label: "待验证",
    dotColor: "bg-amber-400",
    textColor: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
    bannerClass: "border-amber-500/35 bg-amber-500/12 text-amber-300",
    summary: "等待专家核验案例内容、步骤和证据后发布。",
  },
  rejected: {
    label: "已驳回",
    dotColor: "bg-red-400",
    textColor: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
    bannerClass: "border-red-500/35 bg-red-500/12 text-red-300",
    summary: "该案例未进入知识库，请根据驳回意见修订后再提交。",
  },
}

const tocItems = [
  { id: "symptoms", label: "故障现象" },
  { id: "root-cause", label: "根因判断" },
  { id: "action-plan", label: "处理步骤" },
  { id: "evidence", label: "证据与出处" },
  { id: "audit", label: "修正与审核" },
]

const correctionTargetLabelMap: Record<string, string> = {
  model_output: "故障现象",
  summary: "根因判断",
  procedure: "处理步骤",
}

function mapPriorityToLevel(priority: string | null | undefined): FaultLevel {
  const normalized = String(priority || "").trim().toLowerCase()
  if (normalized === "urgent" || normalized === "high") return "urgent"
  if (normalized === "low" || normalized === "routine") return "low"
  return "medium"
}

function mapCaseStatus(status: string | null | undefined): VerifyStatus {
  const normalized = String(status || "").trim().toLowerCase()
  if (normalized === "approved") return "verified"
  if (normalized === "rejected") return "rejected"
  return "pending"
}

function textOrNone(value: string | null | undefined, fallback = "无") {
  const normalized = String(value || "").trim()
  return normalized || fallback
}

function splitLines(value: string | null | undefined) {
  return String(value || "")
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function SectionEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
      {message}
    </div>
  )
}

function SectionActionButton({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs text-muted-foreground" onClick={onClick}>
      <Edit3 className="h-3.5 w-3.5" />
      {label}
    </Button>
  )
}

function getKnowledgeRefTitle(ref: KnowledgeRef) {
  return textOrNone(ref.title || ref.source_name, "未命名文档")
}

function getKnowledgeRefSource(ref: KnowledgeRef) {
  return textOrNone(ref.source_name || ref.type, "知识来源")
}

export default function CaseDetailPage({ params }: PageProps) {
  const { caseId } = use(params)
  const [activeSection, setActiveSection] = useState("symptoms")
  const [copiedSteps, setCopiedSteps] = useState(false)
  const [remoteCase, setRemoteCase] = useState<MaintenanceCaseDetail | null>(null)
  const [pageLoadState, setPageLoadState] = useState<PageLoadState>("loading")
  const [reviewBusy, setReviewBusy] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectNote, setRejectNote] = useState("")
  const [correctionOpen, setCorrectionOpen] = useState(false)
  const [correctionBusy, setCorrectionBusy] = useState(false)
  const [correctionTarget, setCorrectionTarget] = useState("")
  const [correctionOriginal, setCorrectionOriginal] = useState("")
  const [correctionContent, setCorrectionContent] = useState("")
  const [correctionNote, setCorrectionNote] = useState("")

  const numericCaseId = useMemo(() => {
    const match = caseId.match(/(\d+)/)
    return match ? Number(match[1]) : NaN
  }, [caseId])

  useEffect(() => {
    if (!Number.isFinite(numericCaseId)) {
      setPageLoadState("invalid")
      return
    }
    setPageLoadState("loading")
    void (async () => {
      try {
        const detail = await fetchCaseDetail(numericCaseId)
        setRemoteCase(detail)
        setPageLoadState("ready")
      } catch {
        setRemoteCase(null)
        setPageLoadState("error")
        toast.error("案例详情加载失败")
      }
    })()
  }, [numericCaseId])

  const levelConfig = faultLevelConfig[mapPriorityToLevel(remoteCase?.priority)]
  const statusConfig = verifyStatusConfig[mapCaseStatus(remoteCase?.status)]

  const summaryText = textOrNone(remoteCase?.symptom_description, "暂无故障现象描述。")
  const rootCauseLines = splitLines(remoteCase?.resolution_summary)
  const processingSteps = (remoteCase?.processing_steps || []).filter((item) => item.trim())
  const knowledgeRefs = remoteCase?.knowledge_refs || []
  const correctionRecords = remoteCase?.corrections || []
  const reviewNote = textOrNone(remoteCase?.review_note, "")

  const overviewItems = [
    { label: "设备类型", value: textOrNone(remoteCase?.equipment_type) },
    { label: "设备型号", value: textOrNone(remoteCase?.equipment_model) },
    { label: "故障类型", value: textOrNone(remoteCase?.fault_type) },
    { label: "来源工单", value: textOrNone(remoteCase?.work_order_id) },
    { label: "更新时间", value: textOrNone(formatDateTimeLocal(remoteCase?.updated_at || null)) },
    { label: "审核人", value: textOrNone(remoteCase?.reviewer_name) },
    { label: "审核时间", value: textOrNone(formatDateTimeLocal(remoteCase?.reviewed_at || null)) },
    { label: "关联文档", value: `${knowledgeRefs.length} 条` },
    { label: "修正记录", value: `${correctionRecords.length} 条` },
  ]

  const summaryStats = [
    { label: "审核状态", value: statusConfig.label },
    { label: "故障等级", value: levelConfig.label },
    { label: "设备", value: textOrNone(remoteCase?.equipment_type) },
    { label: "型号", value: textOrNone(remoteCase?.equipment_model) },
    { label: "来源工单", value: textOrNone(remoteCase?.work_order_id) },
    { label: "关联知识", value: `${knowledgeRefs.length} 条` },
    { label: "修正记录", value: `${correctionRecords.length} 条` },
  ]

  useEffect(() => {
    const handleScroll = () => {
      const sections = tocItems.map((item) => document.getElementById(item.id))
      const scrollPosition = window.scrollY + 140
      for (let index = sections.length - 1; index >= 0; index -= 1) {
        const section = sections[index]
        if (section && section.offsetTop <= scrollPosition) {
          setActiveSection(tocItems[index].id)
          break
        }
      }
    }

    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  const handleApprove = async () => {
    if (!Number.isFinite(numericCaseId)) return
    setReviewBusy(true)
    try {
      const updated = await reviewMaintenanceCase(numericCaseId, { action: "approve" })
      setRemoteCase(updated)
      toast.success("案例已通过审核，已沉淀为知识文档")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "审核失败")
    } finally {
      setReviewBusy(false)
    }
  }

  const handleReject = async () => {
    if (!Number.isFinite(numericCaseId)) return
    setReviewBusy(true)
    try {
      const updated = await reviewMaintenanceCase(numericCaseId, {
        action: "reject",
        review_note: rejectNote,
      })
      setRemoteCase(updated)
      setRejectOpen(false)
      setRejectNote("")
      toast.success("案例已驳回")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "驳回失败")
    } finally {
      setReviewBusy(false)
    }
  }

  const openCorrection = (target: string, original: string) => {
    setCorrectionTarget(target)
    setCorrectionOriginal(original || "无")
    setCorrectionContent("")
    setCorrectionNote("")
    setCorrectionOpen(true)
  }

  const submitCorrection = async () => {
    if (!Number.isFinite(numericCaseId) || !correctionContent.trim() || correctionBusy) return
    setCorrectionBusy(true)
    try {
      const updated = await addCaseCorrection(numericCaseId, {
        correction_target: correctionTarget,
        original_content: correctionOriginal === "无" ? "" : correctionOriginal,
        corrected_content: correctionContent,
        note: correctionNote || undefined,
      })
      setRemoteCase(updated)
      setCorrectionOpen(false)
      toast.success("修正已提交")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交失败")
    } finally {
      setCorrectionBusy(false)
    }
  }

  const copyActionSteps = () => {
    void (async () => {
      const text = processingSteps.length > 0
        ? processingSteps.map((item, index) => `${index + 1}. ${item}`).join("\n")
        : "无"
      try {
        await navigator.clipboard.writeText(text)
        toast.success("处理步骤已复制")
        setCopiedSteps(true)
        setTimeout(() => setCopiedSteps(false), 2000)
      } catch {
        toast.error("当前环境不支持复制，请手动复制处理步骤")
      }
    })()
  }

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }

  if (pageLoadState === "invalid") {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="app-main app-main-wide">
          <div className="app-card flex min-h-[320px] flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="text-lg font-medium text-foreground">案例编号无效</div>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              当前链接中的案例编号无法识别，请返回案例库重新选择。
            </p>
            <Button asChild variant="outline">
              <Link href="/cases">返回案例库</Link>
            </Button>
          </div>
        </main>
      </div>
    )
  }

  if (pageLoadState === "error") {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="app-main app-main-wide">
          <div className="app-card flex min-h-[320px] flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="text-lg font-medium text-foreground">案例详情加载失败</div>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              可能是网络异常，或该案例已不存在。请稍后重试，或返回案例库重新进入。
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button type="button" onClick={() => {
                setPageLoadState("loading")
                setRemoteCase(null)
                if (Number.isFinite(numericCaseId)) {
                  void (async () => {
                    try {
                      const detail = await fetchCaseDetail(numericCaseId)
                      setRemoteCase(detail)
                      setPageLoadState("ready")
                    } catch {
                      setPageLoadState("error")
                      toast.error("案例详情加载失败")
                    }
                  })()
                }
              }}>
                重试
              </Button>
              <Button asChild variant="outline">
                <Link href="/cases">返回案例库</Link>
              </Button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  if (pageLoadState === "loading" || !remoteCase) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="app-main app-main-wide">
          <div className="app-card flex min-h-[320px] items-center justify-center p-8 text-sm text-muted-foreground">
            正在加载案例审阅信息...
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="app-main app-main-wide space-y-6">
        <section className="app-page-head">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <Link
                    href="/cases"
                    className="inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span>返回案例库</span>
                  </Link>
                  <span className="text-muted-foreground">/</span>
                  <span className="font-mono text-foreground/85">{caseId}</span>
                  <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${statusConfig.borderColor} ${statusConfig.bgColor}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${statusConfig.dotColor}`} />
                    <span className={statusConfig.textColor}>{statusConfig.label}</span>
                  </span>
                  <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${levelConfig.className}`}>
                    {levelConfig.label}
                  </span>
                </div>

                <h1 className="mb-2 text-2xl font-semibold text-foreground sm:text-3xl">
                  {textOrNone(remoteCase.title)}
                </h1>
                <p className="max-w-4xl text-sm leading-7 text-muted-foreground">
                  {summaryText}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {mapCaseStatus(remoteCase.status) === "pending" ? (
                  <>
                    <Button type="button" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500" onClick={handleApprove} disabled={reviewBusy}>
                      <Check className="h-4 w-4" />
                      通过审核
                    </Button>
                    <Button type="button" variant="outline" className="gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300" onClick={() => setRejectOpen(true)} disabled={reviewBusy}>
                      <XCircle className="h-4 w-4" />
                      驳回
                    </Button>
                  </>
                ) : mapCaseStatus(remoteCase.status) === "verified" ? (
                  <div className="inline-flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    已沉淀为知识文档
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                    <ShieldAlert className="h-4 w-4" />
                    已驳回，待修订后重提
                  </div>
                )}
              </div>
            </div>

            <div className={`rounded-xl border px-4 py-3 ${statusConfig.bannerClass}`}>
              <div className="flex items-start gap-3">
                {mapCaseStatus(remoteCase.status) === "rejected" ? (
                  <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" />
                ) : mapCaseStatus(remoteCase.status) === "verified" ? (
                  <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <ScanSearch className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <div className="space-y-1">
                  <div className="text-sm font-medium">{statusConfig.summary}</div>
                  {mapCaseStatus(remoteCase.status) === "rejected" && reviewNote ? (
                    <div className="text-xs leading-6 text-red-200">
                      驳回意见：{reviewNote}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {overviewItems.map((item) => (
                <div key={item.label} className="app-subpanel px-4 py-3">
                  <div className="mb-1 text-xs text-muted-foreground">{item.label}</div>
                  <div className="text-sm text-foreground">{item.value}</div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden">
              {tocItems.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  variant={activeSection === item.id ? "default" : "outline"}
                  size="sm"
                  className="shrink-0"
                  onClick={() => scrollToSection(item.id)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <div className="sticky top-20 space-y-4">
              <div className="app-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Activity className={`h-4 w-4 ${levelConfig.accentClass}`} />
                  <div className="text-sm font-medium text-foreground">审阅摘要</div>
                </div>
                <div className="space-y-3">
                  {summaryStats.map((item) => (
                    <div key={item.label} className="flex items-start justify-between gap-4 text-sm">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="text-right text-foreground">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="app-card p-4">
                <div className="mb-3 text-sm font-medium text-foreground">区块导航</div>
                <nav className="space-y-1">
                  {tocItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => scrollToSection(item.id)}
                      className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                        activeSection === item.id
                          ? "bg-[#5e6ad2]/10 text-[#c7ccff]"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </nav>
              </div>
            </div>
          </aside>

          <main className="min-w-0 space-y-6 pb-24">
            <section id="symptoms" className="app-card scroll-mt-24 p-6">
              <div className="mb-4 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-400" />
                <div className="text-lg font-semibold text-foreground">故障现象</div>
                <div className="ml-auto">
                  <SectionActionButton label="修正" onClick={() => openCorrection("model_output", remoteCase.symptom_description || "")} />
                </div>
              </div>

              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-5">
                <div className="mb-2 text-xs uppercase tracking-wide text-amber-300/80">现场描述</div>
                <p className="text-sm leading-7 text-foreground/90">{summaryText}</p>
              </div>
            </section>

            <section id="root-cause" className="app-card scroll-mt-24 p-6">
              <div className="mb-4 flex items-center gap-3">
                <FileText className="h-5 w-5 text-emerald-400" />
                <div className="text-lg font-semibold text-foreground">根因判断</div>
                <div className="ml-auto">
                  <SectionActionButton label="修正" onClick={() => openCorrection("summary", remoteCase.resolution_summary || "")} />
                </div>
              </div>

              {rootCauseLines.length > 0 ? (
                <div className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-5">
                  {rootCauseLines.map((line, index) => (
                    <div key={`${line}-${index}`} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                      <p className="text-sm leading-7 text-foreground">{line}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <SectionEmpty message="尚未形成根因总结，请结合证据与处理记录补充判断。" />
              )}
            </section>

            <section id="action-plan" className="app-card scroll-mt-24 p-6">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Wrench className="h-5 w-5 text-blue-400" />
                  <div className="text-lg font-semibold text-foreground">处理步骤</div>
                  <SectionActionButton label="修正" onClick={() => openCorrection("procedure", processingSteps.join("\n"))} />
                </div>
                <Button type="button" variant="outline" className="gap-2 self-start" onClick={copyActionSteps}>
                  {copiedSteps ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  {copiedSteps ? "已复制" : "复制处理步骤"}
                </Button>
              </div>

              {processingSteps.length > 0 ? (
                <div className="space-y-4">
                  {processingSteps.map((item, index) => (
                    <div key={`${item}-${index}`} className="flex gap-4 rounded-xl border border-border bg-muted/20 p-4">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#5e6ad2]/15 text-sm font-semibold text-[#c7ccff]">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">步骤 {index + 1}</div>
                        <p className="text-sm leading-7 text-foreground/90">{item}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <SectionEmpty message="当前案例未记录处理步骤，请补充后再提交审核。" />
              )}
            </section>

            <section id="evidence" className="app-card scroll-mt-24 p-6">
              <div className="mb-4 flex items-center gap-3">
                <Link2 className="h-5 w-5 text-indigo-400" />
                <div className="text-lg font-semibold text-foreground">证据与出处</div>
              </div>

              {knowledgeRefs.length > 0 ? (
                <div className="space-y-3">
                  {knowledgeRefs.map((ref, index) => {
                    const title = getKnowledgeRefTitle(ref)
                    const source = getKnowledgeRefSource(ref)
                    const excerpt = textOrNone(ref.excerpt, "暂无引用摘录。")
                    const hasLink = typeof ref.document_id === "number"
                    return hasLink ? (
                      <Link
                        key={`${ref.document_id}-${index}`}
                        href={`/knowledge/${ref.document_id}`}
                        className="group block rounded-xl border border-border bg-muted/20 p-4 transition-colors hover:bg-muted/35"
                      >
                        <div className="mb-2 flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm font-medium text-foreground group-hover:text-[#c7ccff]">{title}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{source}</div>
                          </div>
                          <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-[#c7ccff]" />
                        </div>
                        <p className="text-sm leading-6 text-foreground/80">{excerpt}</p>
                      </Link>
                    ) : (
                      <div key={`${title}-${index}`} className="rounded-xl border border-border bg-muted/20 p-4">
                        <div className="mb-2 flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm font-medium text-foreground">{title}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{source}</div>
                          </div>
                          <span className="text-xs text-muted-foreground">无跳转</span>
                        </div>
                        <p className="text-sm leading-6 text-foreground/80">{excerpt}</p>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <SectionEmpty message="当前案例暂无关联知识引用，可在审核前补充相关手册或案例出处。" />
              )}
            </section>

            <section id="audit" className="app-card scroll-mt-24 p-6">
              <div className="mb-4 flex items-center gap-3">
                <BookOpen className="h-5 w-5 text-violet-400" />
                <div className="text-lg font-semibold text-foreground">修正与审核记录</div>
              </div>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <div className="space-y-3">
                  <div className="text-sm font-medium text-foreground">修正记录</div>
                  {correctionRecords.length > 0 ? (
                    correctionRecords.map((item) => (
                      <div key={item.id} className="rounded-xl border border-border bg-muted/20 p-4">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className="inline-flex items-center rounded-md border border-border bg-background/60 px-2 py-1 text-xs text-muted-foreground">
                            {correctionTargetLabelMap[item.correction_target] || item.correction_target}
                          </span>
                          <span className="text-xs text-muted-foreground">{textOrNone(formatDateTimeLocal(item.created_at))}</span>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <div className="mb-1 text-xs text-muted-foreground">修正后内容</div>
                            <div className="text-sm leading-6 text-foreground">{textOrNone(item.corrected_content)}</div>
                          </div>
                          {item.note ? (
                            <div>
                              <div className="mb-1 text-xs text-muted-foreground">备注</div>
                              <div className="text-sm leading-6 text-foreground/85">{item.note}</div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <SectionEmpty message="当前还没有修正记录。" />
                  )}
                </div>

                <div className="space-y-3">
                  <div className="text-sm font-medium text-foreground">审核信息</div>
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="space-y-3 text-sm">
                      <div className="flex items-start justify-between gap-4">
                        <span className="text-muted-foreground">审核状态</span>
                        <span className={statusConfig.textColor}>{statusConfig.label}</span>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <span className="text-muted-foreground">审核人</span>
                        <span className="text-right text-foreground">{textOrNone(remoteCase.reviewer_name)}</span>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <span className="text-muted-foreground">审核时间</span>
                        <span className="text-right text-foreground">{textOrNone(formatDateTimeLocal(remoteCase.reviewed_at || null))}</span>
                      </div>
                    </div>
                  </div>

                  {reviewNote ? (
                    <div className="rounded-xl border border-border bg-muted/20 p-4">
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                        <MessageSquareWarning className="h-4 w-4 text-amber-400" />
                        审核意见
                      </div>
                      <p className="text-sm leading-6 text-foreground/85">{reviewNote}</p>
                    </div>
                  ) : (
                    <SectionEmpty message="当前暂无审核意见记录。" />
                  )}

                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      案例附加信息
                    </div>
                    <div className="space-y-3 text-sm">
                      <div className="flex items-start justify-between gap-4">
                        <span className="text-muted-foreground">报修来源</span>
                        <span className="text-right text-foreground">{textOrNone(remoteCase.report_source)}</span>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <span className="text-muted-foreground">故障类型</span>
                        <span className="text-right text-foreground">{textOrNone(remoteCase.fault_type)}</span>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <span className="text-muted-foreground">设备型号</span>
                        <span className="text-right text-foreground">{textOrNone(remoteCase.equipment_model)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md border-border bg-popover text-popover-foreground">
          <DialogHeader>
            <DialogTitle>驳回案例</DialogTitle>
          </DialogHeader>
          <p className="text-sm leading-6 text-muted-foreground">
            填写驳回意见后，该案例不会进入知识库。请明确指出需补充的证据、步骤或判断问题。
          </p>
          <textarea
            className="h-28 w-full resize-none rounded-lg border border-input bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground"
            placeholder="请填写驳回理由..."
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
          />
          <div className="mt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setRejectOpen(false)}>取消</Button>
            <Button type="button" className="bg-red-600 text-white hover:bg-red-500" onClick={handleReject} disabled={reviewBusy || !rejectNote.trim()}>
              确认驳回
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={correctionOpen} onOpenChange={setCorrectionOpen}>
        <DialogContent className="max-w-lg border-border bg-popover text-popover-foreground">
          <DialogHeader>
            <DialogTitle>修正内容</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              修正目标：{correctionTargetLabelMap[correctionTarget] || correctionTarget}
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">原始内容</label>
              <textarea className="h-24 w-full resize-none rounded-lg border border-input bg-muted/35 p-3 text-sm text-muted-foreground" readOnly value={correctionOriginal} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">修正后内容</label>
              <textarea className="h-24 w-full resize-none rounded-lg border border-input bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground" placeholder="请输入修正后的内容..." value={correctionContent} onChange={(e) => setCorrectionContent(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">备注（可选）</label>
              <input className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" placeholder="补充修正原因..." value={correctionNote} onChange={(e) => setCorrectionNote(e.target.value)} />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setCorrectionOpen(false)} disabled={correctionBusy}>取消</Button>
            <Button type="button" onClick={submitCorrection} disabled={correctionBusy || !correctionContent.trim()}>
              {correctionBusy ? "提交中..." : "提交修正"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
