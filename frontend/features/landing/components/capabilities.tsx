"use client";

import { useMemo, useState } from "react";
import { SearchCheck, ListChecks, Network, FileCheck } from "lucide-react";
import type { ReactNode } from "react";
import { FeatureCard } from "@/shared/components/ui/feature-card";
import { Reveal } from "@/shared/components/ui/reveal";
import { SectionDividerCue } from "@/features/landing/components/section-divider-cue";
import { SectionBadge } from "@/shared/components/ui/section-badge";
import { ui } from "@/shared/theme/ui-tokens";

interface CapabilityItem {
  category: string;
  icon: ReactNode;
  title: string;
  description: string;
  points: string[];
  details: string;
  techStack: string[];
  scenarios: string[];
}

const capabilities: CapabilityItem[] = [
  {
    category: "检索层",
    icon: <SearchCheck className="h-6 w-6" />,
    title: "多模态检修知识检索",
    description: "围绕文字、图片与设备型号建立统一检索入口，快速召回维修手册、SOP 与历史案例片段",
    points: ["语义检索 + 关键词匹配", "图片 / 文本联合输入", "知识出处可追溯"],
    details: "检索结果优先返回可追溯知识片段，再进入作业指引生成，避免无依据长文回答。",
    techStack: ["RAG", "向量检索", "关键词匹配"],
    scenarios: ["摩托车启动困难", "火花塞检修", "压缩压力测量"],
  },
  {
    category: "引导层",
    icon: <ListChecks className="h-6 w-6" />,
    title: "标准化作业指引生成",
    description: "将检索结果嵌入标准检修流程，生成可执行工步、注意事项与风险提醒",
    points: ["步骤化操作指引", "风险提示与校验", "按设备类型加载流程模板"],
    details: "作业步骤基于命中的手册、SOP 和案例生成，并随工单状态进入执行与回填流程。",
    techStack: ["流程模板", "规则校验", "步骤预案"],
    scenarios: ["标准检修流程", "高危步骤提醒", "作业步骤确认"],
  },
  {
    category: "知识层",
    icon: <Network className="h-6 w-6" />,
    title: "案例回流与知识更新",
    description: "支持将检修案例、修订意见与处理结果回流知识库，形成可审核、可发布的知识条目",
    points: ["知识条目审核发布", "案例回填沉淀", "人工标注与修正"],
    details: "专家审核通过后，案例可转为新的知识条目，并在后续检索中被再次命中。",
    techStack: ["知识图谱", "案例审核", "知识更新"],
    scenarios: ["案例审核回流", "知识条目发布", "经验复用培训"],
  },
  {
    category: "工单层",
    icon: <FileCheck className="h-6 w-6" />,
    title: "工单闭环与审核发布",
    description: "从检索命中、步骤执行、结果回填到专家复核，形成完整的可追踪检修闭环",
    points: ["自动工单生成", "处理进度追踪", "审核后发布入库"],
    details: "工单承接检索结果与作业步骤，最终结果回写知识库形成可复用闭环资产。",
    techStack: ["工单编排", "状态机追踪", "知识沉淀"],
    scenarios: ["维修流程标准化", "多角色协同处理", "候选知识入库"],
  },
];

export function Capabilities() {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const helperCopy = useMemo(() => {
    const i = hoveredIndex ?? activeIndex ?? 0;
    const map = [
      "强调文字、图片与设备型号的统一检索入口，让检修依据召回更准、更快。",
      "强调步骤化作业引导与风险提醒，把检索结果转成可执行的检修动作。",
      "强调案例回流、专家审核与人工修正，让系统能持续积累和更新。",
      "强调工单闭环与审核发布，把每次检修都沉淀为可复用知识资产。",
    ];
    return map[i] ?? map[0]!;
  }, [activeIndex, hoveredIndex]);

  const focusIndex = hoveredIndex ?? activeIndex;

  return (
    <section
      id="capabilities"
      className="relative scroll-mt-24 overflow-hidden pb-20 pt-16 lg:pb-24"
      onMouseDown={(e) => {
        const target = e.target as HTMLElement | null;
        // 点击卡片以外区域：取消锁定（active）
        if (!target?.closest?.("[data-feature-card]")) {
          setActiveIndex(null);
        }
      }}
    >
      {/* 背景局部光域：跟随 hover/active */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 lg:opacity-100"
        aria-hidden
        style={{
          background: "none",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        aria-hidden
        style={{
          opacity: focusIndex === null ? 0 : 1,
          background:
            focusIndex === null
              ? "none"
              : `radial-gradient(520px circle at ${(focusIndex % 4) * 25 + 12.5}% 68%, rgba(25,227,125,0.14) 0%, transparent 70%)`,
        }}
      />
      <div className={`${ui.container} relative`}>
        <Reveal>
          <SectionDividerCue
            showTopLine={false}
            badge={<SectionBadge className="mb-4">核心能力</SectionBadge>}
            title={<h2 className={`${ui.titleH2} mb-4`}>围绕检修主线的四项能力</h2>}
            description={
              <p className={`${ui.subtitle} mx-auto max-w-2xl transition-opacity duration-300`}>
                {helperCopy}
              </p>
            }
          />
        </Reveal>

        <div className="grid auto-rows-fr gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {capabilities.map((capability, index) => (
            <Reveal key={index} delayMs={index * 100}>
              <div className="h-full">
                <FeatureCard
                  index={index}
                  active={activeIndex === index}
                  dimmed={focusIndex !== null && focusIndex !== index}
                  onActiveChange={() => {
                    setActiveIndex((prev) => (prev === index ? null : index));
                  }}
                  onHoverChange={(hovering) => setHoveredIndex(hovering ? index : null)}
                  className={index === 0 ? "h-full border-border-strong" : "h-full"}
                  {...capability}
                />
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
