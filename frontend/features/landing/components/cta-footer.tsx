"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";

import { AppLogoLink } from "@/shared/components/brand/app-logo-link";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Reveal } from "@/shared/components/ui/reveal";
import { ROUTES, marketingEntryHref, marketingHashHref, protectedEntryHref } from "@/shared/lib/routes";
import { ui } from "@/shared/theme/ui-tokens";
import { cn } from "@/shared/lib/utils";

const ADVANCED_MODULE_MESSAGE = "当前为系统演示环境，该高级模块及企业级功能需联系管理员获取授权。";

type FooterLinkItem = {
  label: string;
  href?: string;
  action?: "team" | "locked";
};

export function CTA() {
  const pathname = usePathname();
  return (
    <section id="pricing" className="scroll-mt-24 py-24 lg:py-28">
      <div className={ui.container}>
        <Reveal>
          <div className={cn(ui.panelInteractive, "relative min-h-[280px] overflow-hidden rounded-[24px] px-8 py-12 text-center sm:px-10 lg:px-16 lg:py-14")}>
          {/* 网格纹理 */}
          <div className="cta-grid-bg pointer-events-none absolute inset-0 opacity-30" aria-hidden />
          {/* 中心径向光晕（更强） */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(520px_circle_at_center,rgba(24,182,99,0.18),transparent)]" aria-hidden />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(241,244,248,0.6)_0%,rgba(255,255,255,0)_50%,rgba(241,244,248,0.6)_100%)]" aria-hidden />
          {/* 顶部渐变线 */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            aria-hidden
            style={{ background: "linear-gradient(90deg, transparent 0%, rgba(24,182,99,0.35) 30%, rgba(24,182,99,0.55) 50%, rgba(24,182,99,0.35) 70%, transparent 100%)" }}
          />
          <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center justify-center">
            <div className="mb-9 text-center lg:mb-10">
              <h2 className={`${ui.titleH2} mb-5 lg:text-[40px]`}>进入设备检修闭环演示</h2>
              <p className={`${ui.subtitle} mx-auto max-w-2xl`}>
                直接查看多模态知识检索、步骤化作业指引、结果回填和案例审核入库如何在同一平台完成闭环。
              </p>
            </div>

            <div className="flex flex-col justify-center gap-3 sm:flex-row sm:gap-4">
              <Button
                variant="brand"
                size="marketingLg"
                className="gap-2 bg-brand text-[#04120b] shadow-[0_14px_36px_rgba(24,182,99,0.28)] hover:bg-brand-dark hover:shadow-[0_18px_40px_rgba(24,182,99,0.34)]"
                asChild
              >
                <Link href={protectedEntryHref(ROUTES.dashboard)}>
                  进入检修演示
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
              <Button variant="brandSecondary" size="marketingLg" className="gap-2 border-[#dde5ec] bg-card text-foreground hover:bg-bg-elevated" asChild>
                <Link href={marketingHashHref(pathname, "#metrics")}>查看演示验证</Link>
              </Button>
            </div>

            <p className="mt-7 text-sm leading-6 text-text-tertiary">推荐先看演示验证，再进入工作台体验完整检修链路</p>
          </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function Footer() {
  const pathname = usePathname();
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);

  const showAdvancedModuleMessage = () => {
    toast.info(ADVANCED_MODULE_MESSAGE);
  };

  return (
    <footer id="docs" className="scroll-mt-24 border-t border-white/[0.08] bg-[#070d14]">
      <div className={ui.container}>
        <div className="grid gap-10 py-14 lg:grid-cols-[minmax(260px,0.85fr)_minmax(520px,1.15fr)] lg:items-start lg:gap-16 xl:gap-24">
          <div className="max-w-[360px] space-y-3">
            <AppLogoLink href={marketingEntryHref(pathname)} />
            <p className="text-sm text-[#aab6c3]">面向设备检修场景的多模态知识检索与作业闭环平台</p>
            <p className="text-sm text-[#7a8695]">B/S 架构 · 可交互 Web · 多模态大模型 API</p>
            <p className="text-sm text-[#7a8695]">支持知识检索、作业指引、案例回流与审核入库</p>
          </div>
          <div className="grid gap-8 sm:grid-cols-3 lg:gap-10 xl:gap-14">
            <FooterColumn
              title="核心业务"
              links={[
                { label: "多模态检索", action: "locked" },
                { label: "知识图谱", action: "locked" },
                { label: "作业指引", action: "locked" },
                { label: "工单闭环", action: "locked" },
              ]}
              onTeamClick={() => setTeamDialogOpen(true)}
              onLockedClick={showAdvancedModuleMessage}
            />
            <FooterColumn
              title="开发者中心"
              links={[
                { label: "API 接口文档", action: "locked" },
                { label: "龙架构部署指南", href: "/docs/龙架构部署指南.pdf" },
                { label: "系统操作手册", href: "/docs/系统操作手册.pdf" },
              ]}
              onTeamClick={() => setTeamDialogOpen(true)}
              onLockedClick={showAdvancedModuleMessage}
            />
            <FooterColumn
              title="关于我们"
              links={[
                { label: "团队介绍", action: "team" },
                { label: "技术支持", action: "locked" },
              ]}
              onTeamClick={() => setTeamDialogOpen(true)}
              onLockedClick={showAdvancedModuleMessage}
            />
          </div>
        </div>

        <div className="border-t border-white/[0.08] py-5">
          <p className="text-xs text-[#7a8695]">© 2026 FaultDiag · 设备检修知识与作业助手</p>
        </div>
      </div>

      <Dialog open={teamDialogOpen} onOpenChange={setTeamDialogOpen}>
        <DialogContent className="border-white/[0.10] bg-[#0c1320] text-[#e7edf3] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>团队介绍</DialogTitle>
            <DialogDescription className="text-[#8fa1b7]">
              实验室信息展示区域预留中，后续可在此补充团队方向、成员构成、研究成果与联系方式。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-white/[0.08] bg-white/[0.03] p-4 text-sm leading-6 text-[#aab6c3]">
            <p>实验室名称、研究方向、项目成员与技术成果将在正式版本中展示。</p>
          </div>
        </DialogContent>
      </Dialog>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
  onTeamClick,
  onLockedClick,
}: {
  title: string;
  links: FooterLinkItem[];
  onTeamClick: () => void;
  onLockedClick: () => void;
}) {
  return (
    <div>
      <h4 className="mb-3 text-base font-semibold text-[#e7edf3]">{title}</h4>
      <div className="space-y-2">
        {links.map((link) => (
          <FooterLink key={link.label} item={link} onTeamClick={onTeamClick} onLockedClick={onLockedClick} />
        ))}
      </div>
    </div>
  );
}

function FooterLink({
  item,
  onTeamClick,
  onLockedClick,
}: {
  item: FooterLinkItem;
  onTeamClick: () => void;
  onLockedClick: () => void;
}) {
  const className = "block text-left text-sm text-[#7a8695] transition-colors hover:text-[#e7edf3]";

  if (item.href) {
    return (
      <a href={item.href} target="_blank" rel="noreferrer" className={className}>
        {item.label}
      </a>
    );
  }

  return (
    <button type="button" className={className} onClick={item.action === "team" ? onTeamClick : onLockedClick}>
      {item.label}
    </button>
  );
}
