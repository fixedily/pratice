"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ArrowRight, ClipboardCheck, GitBranch, Wrench } from "lucide-react";
import Link from "next/link";

import { SectionBadge } from "@/shared/components/ui/section-badge";
import { ROUTES } from "@/shared/lib/routes";
import { ui } from "@/shared/theme/ui-tokens";
import { cn } from "@/shared/lib/utils";

type DemoStat = {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
};

type DemoFeature = {
  icon: ReactNode;
  title: string;
  description: string;
  status: string;
  panelTitle: string;
  workspaceKind: "diagnosis" | "graphrag" | "workorder";
  stats: DemoStat[];
};

/** 左侧视图卡片与右侧预览主内容区的统一尺寸 */
const VIEW_CARD_HEIGHT = "h-[132px]";
const STAT_CARD_HEIGHT = "h-[86px]";
const WORKBENCH_MAIN_HEIGHT = "h-[280px]";
const WORKBENCH_CHAIN_HEIGHT = "h-[84px]";
const WORKBENCH_LIST_ITEM_HEIGHT = "h-[54px]";
const WORKBENCH_CONTENT_HEIGHT = "h-[474px]";
const WORKBENCH_GRID_COLS = "grid-cols-2";

const features: DemoFeature[] = [
  {
    icon: <Wrench className="h-5 w-5" />,
    title: "检修知识检索",
    description: "对应知识检索入口：输入故障现象、设备型号、现场图片或日志，返回带出处的维修手册、SOP 与历史案例",
    status: "检索中",
    panelTitle: "知识检索 · 多模态问题输入与出处召回",
    workspaceKind: "diagnosis",
    stats: [
      { label: "检索任务", value: "128", sub: "演示任务记录" },
      { label: "引用知识", value: "23", sub: "手册 / 案例片段" },
      { label: "首屏耗时", value: "1.8s", sub: "本次检索", accent: true },
    ],
  },
  {
    icon: <GitBranch className="h-5 w-5" />,
    title: "知识图谱与证据链",
    description: "对应知识中心：从手册、案例和工单抽取实体关系，问答时展示可回溯的证据片段",
    status: "整理中",
    panelTitle: "知识中心 · 实体图谱与可追溯证据链",
    workspaceKind: "graphrag",
    stats: [
      { label: "实体节点", value: "5 类", sub: "故障 / 部件 / 原因" },
      { label: "关系候选", value: "146", sub: "待审核 18" },
      { label: "证据绑定", value: "100%", sub: "分段可追溯", accent: true },
    ],
  },
  {
    icon: <ClipboardCheck className="h-5 w-5" />,
    title: "作业闭环与案例沉淀",
    description: "对应工单详情：承接检索结果生成作业步骤，流转 S1-S10 状态，结果回填后转为候选检修案例",
    status: "闭环中",
    panelTitle: "工单管理 · S1-S10 流程追踪与案例回流",
    workspaceKind: "workorder",
    stats: [
      { label: "处理中工单", value: "21", sub: "今日快照" },
      { label: "待回填", value: "8", sub: "S8 结果回填" },
      { label: "闭环率", value: "90%", sub: "演示统计", accent: true },
    ],
  },
];

export function ProductDemo() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const activeFeature = features[activeIndex] ?? features[0];

  useEffect(() => {
    if (isPaused || features.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % features.length);
    }, 5200);
    return () => window.clearInterval(timer);
  }, [isPaused]);

  return (
    <section id="overview" className={`scroll-mt-24 ${ui.section}`}>
      <div className={ui.container}>
        <div className={ui.sectionHeader}>
          <SectionBadge className="mb-4">产品演示</SectionBadge>
          <h2 className={`${ui.titleH2} mb-4`}>一条主线，全程可追溯</h2>
          <p className={`${ui.subtitle} mx-auto max-w-2xl`}>
            从检修问题输入、知识证据召回，到作业步骤生成、结果回填和案例沉淀，页面展示与当前项目主线保持一致
          </p>
        </div>

        <div
          className="grid items-start gap-5 lg:grid-cols-[360px_1fr] lg:gap-9"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          <div className="space-y-3">
            {features.map((feature, i) => {
              const selected = activeIndex === i;
              return (
                <button
                  key={feature.title}
                  type="button"
                  onClick={() => {
                    setActiveIndex(i);
                    setIsPaused(false);
                  }}
                  aria-pressed={selected}
                  className={cn(
                    "group flex w-full flex-col rounded-[16px] border border-border bg-card p-4 text-left shadow-[0_8px_24px_rgba(15,23,42,0.04)] transition-all duration-250",
                    VIEW_CARD_HEIGHT,
                    "hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-[0_12px_30px_rgba(0,0,0,0.24)]",
                    selected
                      ? "border-brand/55 bg-[linear-gradient(135deg,rgba(24,182,99,0.18),rgba(24,182,99,0.04)_62%)] shadow-[0_14px_34px_rgba(0,0,0,0.26)]"
                      : "hover:bg-[linear-gradient(135deg,rgba(24,182,99,0.08),rgba(24,182,99,0.02)_60%)]",
                  )}
                >
                  <div className="mb-3 flex items-center gap-3">
                    <div
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-bg-elevated text-text-tertiary transition-colors",
                        selected
                          ? "border-brand/45 bg-brand/16 text-brand-dark"
                          : "group-hover:border-brand/30 group-hover:bg-brand/12 group-hover:text-brand-dark",
                      )}
                    >
                      {feature.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[15px] font-semibold text-text-primary">{feature.title}</h3>
                      <div className="mt-1 text-[11px] text-text-tertiary">
                        {feature.workspaceKind === "diagnosis"
                          ? "知识检索"
                          : feature.workspaceKind === "graphrag"
                            ? "知识中心"
                            : "工单管理"}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "rounded-full border border-border bg-bg-elevated px-2 py-0.5 text-[10px] font-medium text-text-tertiary transition-colors",
                        selected
                          ? "border-brand/35 bg-brand/12 text-brand-dark"
                          : "group-hover:border-brand/25 group-hover:bg-brand/10 group-hover:text-brand-dark",
                      )}
                    >
                      {feature.status}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-[13px] leading-6 text-text-secondary">{feature.description}</p>
                </button>
              );
            })}

            <Link
              href={ROUTES.dashboard}
              className="mt-2 flex items-center gap-2 text-sm font-medium text-brand transition-colors hover:text-brand-light"
            >
              查看完整功能
              <ArrowRight className="h-4 w-4" />
            </Link>
            <div className="mt-3 flex items-center gap-1.5 pl-0.5">
              {features.map((feature, i) => (
                <button
                  key={feature.title}
                  type="button"
                  aria-label={`切换到${feature.title}`}
                  onClick={() => {
                    setActiveIndex(i);
                    setIsPaused(false);
                  }}
                  className={cn(
                    "h-1.5 rounded-full bg-border transition-all",
                    activeIndex === i ? "w-6 bg-brand" : "w-2.5 hover:bg-brand/60",
                  )}
                />
              ))}
            </div>
          </div>

          <div className="relative min-w-0">
            <div className="rounded-[20px] border border-border bg-card p-3 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
              <div className="relative overflow-hidden rounded-[16px] border border-[rgba(24,182,99,0.2)] bg-[#0b1018] p-3.5 shadow-[0_14px_32px_rgba(2,6,23,0.28)]">
                <div className="mb-3.5 flex items-center gap-2 border-b border-white/[0.06] pb-3">
                  <div className="flex gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/90" />
                    <div className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]/90" />
                    <div className="h-2.5 w-2.5 rounded-full bg-[#28ca42]/90" />
                  </div>
                  <div className="flex-1 text-center text-[11px] text-[#c4ccda]">{activeFeature.panelTitle}</div>
                </div>

                <div
                  key={activeFeature.workspaceKind}
                  className={cn("flex flex-col gap-3 opacity-100 transition-opacity duration-300", WORKBENCH_CONTENT_HEIGHT)}
                >
                  <StatsRow stats={activeFeature.stats} />
                  {activeFeature.workspaceKind === "diagnosis" ? <DiagnosisWorkbench /> : null}
                  {activeFeature.workspaceKind === "graphrag" ? <GraphRagWorkbench /> : null}
                  {activeFeature.workspaceKind === "workorder" ? <WorkOrderWorkbench /> : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatsRow({ stats }: { stats: DemoStat[] }) {
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={cn(
            "min-w-0 rounded-lg border p-3",
            STAT_CARD_HEIGHT,
            stat.accent
              ? "border-[rgba(24,195,126,0.3)] bg-[rgba(24,195,126,0.08)]"
              : "border-white/[0.06] bg-white/[0.02]",
          )}
        >
          <div className="truncate text-[10px] text-[#9ca8ba]">{stat.label}</div>
          <div
            className={cn(
              "truncate text-[28px] font-semibold tabular-nums leading-[1.15] tracking-tight lg:text-[32px]",
              stat.accent ? "text-brand-light" : "text-[#e8edf7]",
            )}
          >
            {stat.value}
          </div>
          <div className={cn("mt-1 truncate text-[10px] tabular-nums", stat.accent ? "text-brand/70" : "text-[#8a95a8]")}>
            {stat.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkbenchPanel({
  title,
  hint,
  accent,
  children,
}: {
  title: string;
  hint: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        WORKBENCH_MAIN_HEIGHT,
        "flex min-w-0 flex-col overflow-hidden rounded-lg border p-3",
        accent
          ? "border-[rgba(24,195,126,0.22)] bg-[linear-gradient(180deg,rgba(24,195,126,0.08),rgba(255,255,255,0.02))] shadow-[0_0_0_1px_rgba(24,195,126,0.06)]"
          : "border-white/[0.06] bg-white/[0.02]",
      )}
    >
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-[#c8d0de]">{title}</span>
        <span className="shrink-0 text-[10px] text-[#7f8ba1]">{hint}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-hidden">{children}</div>
    </div>
  );
}

function WorkbenchChain({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: string; accent?: boolean }[];
}) {
  return (
    <div className={cn("shrink-0 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3", WORKBENCH_CHAIN_HEIGHT)}>
      <div className="mb-2 text-[11px] leading-tight text-[#c8d0de]">{title}</div>
      <div className="grid grid-cols-5 gap-1.5 text-center">
        {items.map((item) => (
          <div key={item.label} className="rounded-md border border-white/[0.04] bg-black/20 px-1.5 py-2">
            <div className={cn("text-[10px] leading-tight", item.accent ? "text-brand" : "text-[#8a95a8]")}>{item.label}</div>
            <div className={cn("text-[11px] font-semibold leading-tight", item.accent ? "text-brand-light" : "text-[#dbe3f2]")}>
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiagnosisWorkbench() {
  const inputs = [
    { label: "检修问题", value: "摩托车发动机启动困难，伴随间歇异响" },
    { label: "设备信息", value: "摩托车发动机 / 点火与起动系统 / 维修手册已导入" },
    { label: "作业指引草案", value: "疑似点火系统异常，建议先检查火花塞再测压缩压力" },
  ];
  const references = [
    { title: "摩托车发动机维修手册 #M-042", detail: "火花塞拆卸、检查与安装步骤", score: "0.91" },
    { title: "历史案例 CASE-018", detail: "启动困难与点火异常排查记录", score: "0.87" },
    { title: "SOP-07", detail: "断电确认与现场复核流程", score: "0.82" },
  ];

  return (
    <>
      <div className={cn("grid gap-2.5", WORKBENCH_GRID_COLS)}>
        <WorkbenchPanel title="多模态检索输入" hint="提交后进入知识检索结果页" accent>
          {inputs.map((input, index) => (
            <div
              key={input.label}
              className={cn(
                "flex min-w-0 flex-col justify-center overflow-hidden rounded-md border px-3 py-2",
                WORKBENCH_LIST_ITEM_HEIGHT,
                index === 2 ? "border-brand/20 bg-brand/10" : "border-white/[0.05] bg-black/20",
              )}
            >
              <div className={cn("truncate text-[10px]", index === 2 ? "text-brand" : "text-[#7f8ba1]")}>{input.label}</div>
              <div className="truncate text-[12px] text-[#e7edf8]">{input.value}</div>
            </div>
          ))}
        </WorkbenchPanel>

        <WorkbenchPanel title="引用知识" hint="可追溯依据">
          {references.map((item) => (
            <div
              key={item.title}
              className={cn(
                "flex min-w-0 flex-col justify-center overflow-hidden rounded border border-white/[0.04] bg-black/20 px-2.5 py-2",
                WORKBENCH_LIST_ITEM_HEIGHT,
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                  <span className="truncate text-[11px] font-medium text-[#e7edf8]">{item.title}</span>
                </div>
                <span className="shrink-0 text-[10px] text-brand">{item.score}</span>
              </div>
              <div className="truncate pl-3.5 text-[10px] text-[#8290a6]">{item.detail}</div>
            </div>
          ))}
        </WorkbenchPanel>
      </div>

      <WorkbenchChain
        title="任务链路"
        items={[
          { label: "输入", value: "S1" },
          { label: "检索", value: "S2" },
          { label: "指引", value: "S3", accent: true },
          { label: "工单", value: "S4" },
          { label: "沉淀", value: "S10" },
        ]}
      />
    </>
  );
}

function GraphRagWorkbench() {
  const entities = [
    { id: "故障现象", title: "启动困难", status: "命中输入", accent: true },
    { id: "部件", title: "火花塞 / 起动电机", status: "图谱扩展", accent: false },
    { id: "维修动作", title: "火花塞检查 / 压缩压力测量", status: "证据支持", accent: false },
  ];
  const evidence = [
    { title: "维修手册分段 #42", meta: "文档证据", detail: "火花塞拆卸与检查步骤", tone: "text-brand" },
    { title: "历史案例 CASE-018", meta: "案例证据", detail: "同型号发动机曾出现相似现象", tone: "text-[#f6c343]" },
    { title: "人工确认记录", meta: "审核通过", detail: "实体关系已由专家确认", tone: "text-[#8a95a8]" },
  ];

  return (
    <>
      <div className={cn("grid gap-2.5", WORKBENCH_GRID_COLS)}>
        <WorkbenchPanel title="推理子图" hint="实体识别 + 图谱扩展 + 向量补充" accent>
          {entities.map((node) => (
            <div
              key={node.id}
              className={cn(
                "flex min-w-0 flex-col justify-center overflow-hidden rounded-md border px-3 py-2",
                WORKBENCH_LIST_ITEM_HEIGHT,
                node.accent ? "border-brand/25 bg-brand/10" : "border-white/[0.04] bg-black/20",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[10px] text-[#8a95a8]">{node.id}</span>
                <span className={cn("shrink-0 text-[10px]", node.accent ? "text-brand" : "text-[#7f8ba1]")}>{node.status}</span>
              </div>
              <div className="truncate text-[12px] font-medium text-[#e7edf8]">{node.title}</div>
            </div>
          ))}
        </WorkbenchPanel>

        <WorkbenchPanel title="证据绑定" hint="结论可回溯">
          {evidence.map((item) => (
            <div
              key={item.title}
              className={cn(
                "flex min-w-0 flex-col justify-center overflow-hidden rounded border border-white/[0.04] bg-black/20 px-3 py-2",
                WORKBENCH_LIST_ITEM_HEIGHT,
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-medium text-[#e7edf8]">{item.title}</span>
                <span className={cn("shrink-0 text-[10px]", item.tone)}>{item.meta}</span>
              </div>
              <div className="truncate text-[10px] text-[#8290a6]">{item.detail}</div>
            </div>
          ))}
        </WorkbenchPanel>
      </div>

      <WorkbenchChain
        title="证据链路"
        items={[
          { label: "识别", value: "实体" },
          { label: "扩展", value: "关系" },
          { label: "补充", value: "向量", accent: true },
          { label: "证据", value: "分段" },
          { label: "回答", value: "可溯" },
        ]}
      />
    </>
  );
}

function WorkOrderWorkbench() {
  const statusRows = [
    { title: "S5 维修接单", note: "检修员已确认接单", value: "06" },
    { title: "S7 执行处理", note: "现场步骤逐项确认", value: "09" },
    { title: "S8 结果回填", note: "等待附件与处理说明", value: "08", accent: true },
  ];
  const records = [
    { code: "WO-2026-018", detail: "摩托车发动机检修工单", status: "执行中" },
    { code: "验收确认", detail: "专家复核处理结果与附件", status: "S9" },
    { code: "案例沉淀", detail: "转为检修案例并进入审核", status: "S10" },
  ];

  return (
    <>
      <div className={cn("grid gap-2.5", WORKBENCH_GRID_COLS)}>
        <WorkbenchPanel title="S1-S10 状态流转" hint="检索结果承接为现场工单" accent>
          {statusRows.map((row) => (
            <div
              key={row.title}
              className={cn(
                "flex min-w-0 flex-col justify-center overflow-hidden rounded-md border px-3 py-2",
                WORKBENCH_LIST_ITEM_HEIGHT,
                row.accent ? "border-brand/25 bg-brand/10" : "border-white/[0.04] bg-black/20",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] text-[#c8d0de]">{row.title}</span>
                <span className={cn("shrink-0 text-[16px] font-semibold tabular-nums leading-none", row.accent ? "text-brand-light" : "text-[#e7edf8]")}>
                  {row.value}
                </span>
              </div>
              <div className="truncate text-[10px] text-[#7f8ba1]">{row.note}</div>
            </div>
          ))}
        </WorkbenchPanel>

        <WorkbenchPanel title="回填与沉淀" hint="工单完成后回写知识库">
          {records.map((record, idx) => (
            <div
              key={record.code}
              className={cn(
                "flex min-w-0 flex-col justify-center overflow-hidden rounded border border-white/[0.04] bg-black/20 px-3 py-2",
                WORKBENCH_LIST_ITEM_HEIGHT,
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-medium text-[#e7edf8]">{record.code}</span>
                <span className={cn("shrink-0 text-[10px]", idx === 0 || idx === 2 ? "text-brand" : "text-[#7f8ba1]")}>{record.status}</span>
              </div>
              <div className="truncate text-[10px] text-[#8290a6]">{record.detail}</div>
            </div>
          ))}
        </WorkbenchPanel>
      </div>

      <WorkbenchChain
        title="闭环链路"
        items={[
          { label: "创建", value: "S1" },
          { label: "接单", value: "S5" },
          { label: "处理", value: "S7", accent: true },
          { label: "回填", value: "S8" },
          { label: "沉淀", value: "S10" },
        ]}
      />
    </>
  );
}

