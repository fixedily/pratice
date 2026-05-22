"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import {
  Flame,
  Layers,
  Cog,
  Zap,
  Train,
  FlaskConical,
  CircleCheck,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowUpRight,
} from "lucide-react";
import { SectionDividerCue } from "@/features/landing/components/section-divider-cue";
import { Reveal } from "@/shared/components/ui/reveal";
import { SectionBadge } from "@/shared/components/ui/section-badge";
import { ui } from "@/shared/theme/ui-tokens";
import { cn } from "@/shared/lib/utils";

type Scenario = {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  industry: string;
  title: string;
  description: string;
  tag: string;
  cluster: "流程工业" | "离散制造";
  subtitle: string;
  devices: string[];
  diagnoses: string[];
  dataTypes: string[];
  benefits: string[];
  caseHint: string;
};

const scenarios: Scenario[] = [
  {
    id: "startup",
    icon: Cog,
    industry: "摩托车发动机",
    title: "启动困难排查",
    description: "围绕启动困难、间歇异响等问题，召回维修手册与历史案例，生成检查步骤",
    tag: "演示主线",
    cluster: "离散制造",
    subtitle: "以摩托车发动机启动困难为入口，演示从问题输入到知识检索、作业指引和案例沉淀的完整链路。",
    devices: ["发动机总成", "点火系统", "起动电机", "气缸组件"],
    diagnoses: ["启动困难", "间歇异响", "点火异常", "压缩不足"],
    dataTypes: ["文字描述", "现场图片", "维修手册 PDF", "历史案例"],
    benefits: ["命中手册出处", "生成检查步骤", "保留检索快照", "支持结果回填"],
    caseHint: "演示问题：摩托车启动困难，排气管冒黑烟怎么修？系统返回手册出处和分步检查建议。",
  },
  {
    id: "spark-plug",
    icon: Zap,
    industry: "点火系统",
    title: "火花塞检查与更换",
    description: "从火花塞拆卸、积碳检查、间隙确认到安装复核，形成可执行作业步骤",
    tag: "高频",
    cluster: "离散制造",
    subtitle: "适合展示维修手册分段命中、步骤化作业指引和风险提醒。",
    devices: ["火花塞", "点火线圈", "高压线", "燃烧室"],
    diagnoses: ["积碳严重", "间隙异常", "点火弱", "启动失败"],
    dataTypes: ["手册片段", "故障图片", "SOP 步骤", "检修备注"],
    benefits: ["步骤可执行", "风险提醒明确", "结果可回填", "案例可复用"],
    caseHint: "命中《摩托车发动机维修手册》火花塞相关章节后，生成拆卸、检查和安装复核步骤。",
  },
  {
    id: "compression",
    icon: Layers,
    industry: "气缸组件",
    title: "压缩压力测量",
    description: "根据手册要求生成压缩压力测量步骤，记录测量结果并支持专家复核",
    tag: "典型",
    cluster: "离散制造",
    subtitle: "适合展示标准化工步、高危提醒和结构化结果回填。",
    devices: ["气缸头", "气门", "活塞环", "压力表"],
    diagnoses: ["压缩不足", "气门漏气", "活塞环磨损", "启动困难"],
    dataTypes: ["测量记录", "维修手册", "现场凭证", "专家备注"],
    benefits: ["测量口径统一", "凭证留痕", "专家可复核", "知识可沉淀"],
    caseHint: "检修员按步骤测量压缩压力，回填读数和现场图片后进入专家审核。",
  },
  {
    id: "starter",
    icon: Train,
    industry: "起动系统",
    title: "起动电机检修",
    description: "结合设备型号与故障描述，召回起动电机相关手册片段并生成排查流程",
    tag: "通用",
    cluster: "离散制造",
    subtitle: "适合展示设备型号过滤、知识出处和检修任务流转。",
    devices: ["起动电机", "继电器", "蓄电池", "线路连接"],
    diagnoses: ["无法起动", "电机无响应", "线路松动", "电压不足"],
    dataTypes: ["设备型号", "故障描述", "图片附件", "历史工单"],
    benefits: ["按型号过滤", "减少无关召回", "工单可追踪", "处理结果可复用"],
    caseHint: "输入设备型号后，系统优先召回对应起动电机检修片段，并生成检查顺序。",
  },
  {
    id: "abnormal-noise",
    icon: Flame,
    industry: "运行异响",
    title: "异响与润滑检查",
    description: "围绕运行异响、润滑不足等现象，生成检查建议并标注关键风险",
    tag: "风险",
    cluster: "离散制造",
    subtitle: "适合展示风险提醒、检索依据和人工修正入口。",
    devices: ["曲轴箱", "轴承", "润滑系统", "传动部件"],
    diagnoses: ["运行异响", "润滑不足", "轴承磨损", "温升异常"],
    dataTypes: ["现场描述", "巡检图片", "维修经验", "专家修订"],
    benefits: ["风险优先提示", "依据可回溯", "专家可修正", "后续可再检索"],
    caseHint: "系统生成初步排查步骤后，专家可修订结论并沉淀为新的案例。",
  },
  {
    id: "case-review",
    icon: FlaskConical,
    industry: "知识更新",
    title: "检修案例审核入库",
    description: "将处理结论、附件凭证和人工修正转为候选知识，审核通过后进入知识库",
    tag: "闭环",
    cluster: "离散制造",
    subtitle: "适合展示从工单结果到候选知识、专家审核和发布入库的后半段闭环。",
    devices: ["候选案例", "知识条目", "审核记录", "发布版本"],
    diagnoses: ["结果回填", "专家复核", "修订发布", "再次命中"],
    dataTypes: ["工单摘要", "处理说明", "现场附件", "审核意见"],
    benefits: ["案例沉淀", "审核可追踪", "发布可回滚", "知识持续更新"],
    caseHint: "结单后生成候选知识，专家审核通过后，后续相似问题可再次命中该案例。",
  },
];

export function Scenarios() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [panelVisible, setPanelVisible] = useState(false);
  const [panelScenario, setPanelScenario] = useState<Scenario | null>(null);

  const visibleScenarios = useMemo(() => scenarios, []);
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    align: "center",
    skipSnaps: false,
    watchDrag: false,
  });

  const selectedScenario = useMemo(
    () => visibleScenarios.find((s) => s.id === selectedId) ?? null,
    [selectedId, visibleScenarios],
  );

  useEffect(() => {
    if (selectedId && !visibleScenarios.some((s) => s.id === selectedId)) {
      setSelectedId(null);
    }
    if (focusIndex > visibleScenarios.length - 1) {
      setFocusIndex(Math.max(0, visibleScenarios.length - 1));
    }
  }, [focusIndex, selectedId, visibleScenarios]);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      const idx = emblaApi.selectedScrollSnap();
      setFocusIndex(idx);
      // 仅在已打开详情面板（selectedId !== null）时，滚动同步选中态
      if (selectedId !== null) {
        const next = visibleScenarios[idx];
        if (next) setSelectedId(next.id);
      }
    };
    emblaApi.on("select", onSelect);
    onSelect();
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi, selectedId, visibleScenarios]);

  useEffect(() => {
    if (!emblaApi || visibleScenarios.length <= 1) return;
    const timer = window.setInterval(() => {
      emblaApi.scrollNext();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [emblaApi, visibleScenarios.length]);

  useEffect(() => {
    if (!selectedScenario) {
      setPanelVisible(false);
      return;
    }
    if (!panelScenario) {
      setPanelScenario(selectedScenario);
      setPanelVisible(true);
      return;
    }
    setPanelVisible(false);
    const t = window.setTimeout(() => {
      setPanelScenario(selectedScenario);
      setPanelVisible(true);
    }, 120);
    return () => window.clearTimeout(t);
  }, [panelScenario, selectedScenario]);

  const canPrev = visibleScenarios.length > 1;
  const canNext = visibleScenarios.length > 1;

  const move = useCallback(
    (dir: -1 | 1) => {
      if (!emblaApi) return;
      if (dir === 1) emblaApi.scrollNext();
      else emblaApi.scrollPrev();
    },
    [emblaApi],
  );

  return (
    <section
      id="scenarios"
      className={`scroll-mt-24 ${ui.section}`}
      tabIndex={0}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement | null;
        if (
          !target?.closest?.("[data-scenario-card]") &&
          !target?.closest?.("[data-scenario-panel]") &&
          !target?.closest?.("[data-scenario-nav]")
        ) {
          setSelectedId(null);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          move(-1);
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          move(1);
        }
      }}
    >
      <div className={ui.container}>
        <Reveal>
          <SectionDividerCue
            badge={<SectionBadge className="mb-4">适用场景</SectionBadge>}
            title={<h2 className={`${ui.titleH2} mb-4`}>聚焦摩托车发动机检修演示场景</h2>}
            description={
              <p className={`${ui.subtitle} mx-auto max-w-2xl`}>
                用启动困难、火花塞检查、压缩压力测量和案例审核入库串起场景要求的完整演示主线
              </p>
            }
          />
        </Reveal>

        <Reveal delayMs={80}>
          <div className="relative">
          {/* 左右边缘渐隐 */}
          <div className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-16 bg-[linear-gradient(90deg,var(--bg-main)_0%,var(--bg-main)_38%,transparent_100%)] lg:w-24" />
          <div className="pointer-events-none absolute bottom-0 right-0 top-0 z-10 w-16 bg-[linear-gradient(270deg,var(--bg-main)_0%,var(--bg-main)_38%,transparent_100%)] lg:w-24" />
          {/* 左右箭头：滚动区域两侧中部 */}
          <button
            type="button"
            data-scenario-nav
            disabled={!canPrev}
            onClick={() => move(-1)}
            className="absolute left-1 top-1/2 z-20 hidden -translate-y-1/2 rounded-full border border-border bg-card/80 p-2 text-text-secondary shadow-[0_8px_18px_rgba(15,23,42,0.07)] transition-[transform,box-shadow,border-color,color] hover:-translate-y-[52%] enabled:hover:border-brand/20 enabled:hover:text-text-primary enabled:hover:shadow-[0_12px_24px_rgba(15,23,42,0.14)] disabled:opacity-40 lg:block"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            data-scenario-nav
            disabled={!canNext}
            onClick={() => move(1)}
            className="absolute right-1 top-1/2 z-20 hidden -translate-y-1/2 rounded-full border border-border bg-card/80 p-2 text-text-secondary shadow-[0_8px_18px_rgba(15,23,42,0.07)] transition-[transform,box-shadow,border-color,color] hover:-translate-y-[52%] enabled:hover:border-brand/20 enabled:hover:text-text-primary enabled:hover:shadow-[0_12px_24px_rgba(15,23,42,0.14)] disabled:opacity-40 lg:block"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div
            ref={emblaRef}
            className="overflow-hidden px-8 pb-2 pt-1 lg:px-16"
          >
            {/* Embla 推荐：用 padding 做间距，避免 gap + loop 造成测量抖动 */}
            <div className="flex items-stretch -ml-6 lg:-ml-8">
              {visibleScenarios.map((s, i) => {
                const Icon = s.icon;
                const isSelected = selectedScenario?.id === s.id;
                const isFocused = i === focusIndex;
                return (
                  <div
                    key={s.id}
                    data-scenario-index={i}
                    onClick={() => {
                      emblaApi?.scrollTo(i);
                      setSelectedId((prev) => (prev === s.id ? null : s.id));
                    }}
                    data-scenario-card
                    className="pl-6 lg:pl-8 shrink-0 basis-[300px] md:basis-[320px] lg:basis-[340px]"
                  >
                    {/* 外层 slide 固定宽度；内层 card 做 scale/阴影，避免 Embla loop 测量抖动与视觉重叠 */}
                    <div
                      className={cn(
                        "group relative h-[236px] w-full cursor-pointer overflow-hidden rounded-[18px] border border-border bg-card p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]",
                        "transition-[transform,opacity,border-color,box-shadow,background-color] duration-300",
                        isSelected
                          ? "z-20 scale-[1.018] border-brand/20 bg-[linear-gradient(135deg,rgba(24,182,99,0.06),rgba(24,182,99,0.015)_62%)] shadow-[0_12px_30px_rgba(0,0,0,0.2)]"
                          : isFocused
                            ? "z-10 scale-[1.008] border-brand/12 shadow-[0_10px_24px_rgba(0,0,0,0.14)]"
                            : "z-0 opacity-70 hover:border-brand/18 hover:opacity-85",
                      )}
                    >
              {/* 顶部渐变线 */}
              <div
                className={cn(
                  "pointer-events-none absolute inset-x-0 top-0 h-px transition-opacity duration-200",
                  isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                aria-hidden
                style={{ background: "linear-gradient(90deg, transparent, rgba(24,182,99,0.22), transparent)" }}
              />

              <div className="mb-4 flex items-start justify-between gap-3">
                <div
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-bg-elevated text-text-tertiary transition-colors",
                    isSelected
                      ? "border-brand/35 bg-brand/12 text-brand-dark"
                      : "group-hover:border-brand/30 group-hover:bg-brand/12 group-hover:text-brand-dark",
                  )}
                >
                  <Icon className="h-6 w-6" />
                </div>
                <span
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                    s.tag === "推荐"
                      ? "border-brand/35 bg-brand/10 text-brand-dark"
                      : "border-border bg-bg-elevated text-text-secondary",
                  )}
                >
                  {s.tag}
                </span>
              </div>

              <div className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-brand/70">{s.industry}</div>
              <h3 className={cn("mb-2 text-[20px] font-semibold tracking-[-0.02em]", isSelected || isFocused ? "text-text-primary" : "text-text-secondary")}>{s.title}</h3>
              <p className="line-clamp-2 text-[14px] leading-6 text-text-secondary">{s.description}</p>

              {isSelected && (
                <div className="mt-3 flex items-center justify-end gap-1 text-[12px] font-medium text-brand/90">
                  <CircleCheck className="h-3.5 w-3.5" />
                  <span>已选中</span>
                </div>
              )}
              <div className={cn("pointer-events-none absolute inset-x-4 bottom-0 h-[2px] bg-brand/0 transition-colors", isSelected && "bg-brand/45")} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          </div>
        </Reveal>

        <Reveal delayMs={120}>
          <div className="mt-3 flex items-center justify-center gap-1.5">
          {visibleScenarios.map((s, i) => (
            <button
              key={`dot-${s.id}`}
              type="button"
              onClick={() => {
                emblaApi?.scrollTo(i);
              }}
              className={cn(
                "h-1.5 rounded-full transition-all duration-200",
                i === focusIndex ? "w-5 bg-brand/80" : "w-1.5 bg-border-strong hover:bg-brand/40",
              )}
              aria-label={`切换到场景 ${i + 1}`}
            />
          ))}
          </div>
        </Reveal>

        <Reveal delayMs={140}>
          <div
            data-scenario-panel
            className={cn(
              "mt-6 overflow-hidden rounded-[22px] border border-border-strong bg-[linear-gradient(180deg,rgba(24,182,99,0.06),rgba(24,182,99,0.02)_38%,rgba(255,255,255,0)_100%)] p-5 shadow-[0_12px_32px_rgba(15,23,42,0.08)] transition-[max-height,opacity,padding,margin] duration-300",
              selectedId ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0 p-0 mt-0 border-transparent shadow-none",
            )}
          >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.1em] text-brand/70">
                {panelScenario?.industry ?? ""} / {panelScenario?.cluster ?? ""}
              </div>
              <h3 className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary">{panelScenario?.title ?? ""}</h3>
              <p className="mt-2 text-sm leading-7 text-text-secondary">{panelScenario?.subtitle ?? ""}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2" data-scenario-nav>
              <button
                type="button"
                disabled={!canPrev}
                onClick={() => move(-1)}
                className="rounded-full border border-border bg-card p-2 text-text-secondary transition-colors enabled:hover:border-brand/25 enabled:hover:text-text-primary disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={!canNext}
                onClick={() => move(1)}
                className="rounded-full border border-border bg-card p-2 text-text-secondary transition-colors enabled:hover:border-brand/25 enabled:hover:text-text-primary disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div
            className={cn(
              "grid gap-4 transition-[opacity,transform] duration-200 sm:grid-cols-2 lg:grid-cols-5",
              panelVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
            )}
          >
            <InfoCol title="相关对象" items={panelScenario?.devices ?? []} />
            <InfoCol title="检修问题" items={panelScenario?.diagnoses ?? []} />
            <InfoCol title="输入材料" items={panelScenario?.dataTypes ?? []} />
            <InfoCol title="演示价值" items={panelScenario?.benefits ?? []} />
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2 text-sm font-semibold text-text-primary">查看案例</div>
              <p className="mb-4 text-sm leading-6 text-text-secondary">{panelScenario?.caseHint ?? ""}</p>
              <div className="space-y-2">
                <button className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-medium text-[#04120b] transition-colors hover:bg-brand-dark">
                  查看案例
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
                <button className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-brand/25 hover:text-text-primary">
                  查看方案详情
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
          </div>
        </Reveal>

      </div>
    </section>
  );
}

function InfoCol({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 text-sm font-semibold text-text-primary">{title}</div>
      <ul className="space-y-2 text-sm text-text-secondary">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand/70" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
