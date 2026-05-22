"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  ChevronDown,
  HelpCircle,
  LogIn,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react"
import { toast } from "sonner"

import { useMaintenanceAuth } from "@/features/auth/maintenance-auth"
import { canAccessKnowledgeReview } from "@/features/auth/permissions"
import { clearMaintenanceToken, MAINTENANCE_AUTH_EXPIRED_EVENT } from "@/features/auth/lib/token-store"
import { fetchHealth, fetchMaintenanceHealth, getApiBase } from "@/features/dashboard/api"
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/components/ui/avatar"
import { Button } from "@/shared/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/shared/components/ui/sheet"
import { ThemeToggle } from "@/shared/components/ui/theme-toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip"
import { appNavigation, defaultOpenSidebarGroups, type AppNavItem } from "@/shared/components/brand/app-navigation"
import { NotificationMenu } from "@/shared/components/brand/notification-menu"
import { ROUTES } from "@/shared/lib/routes"
import { cn } from "@/shared/lib/utils"

const SIDEBAR_EXPANDED_WIDTH = "15rem"
const SIDEBAR_COLLAPSED_WIDTH = "4.5rem"

function normalizeHrefPath(href: string) {
  return href.split("#")[0]?.split("?")[0] || "/"
}

function isRouteActive(pathname: string | null, href: string, exact = false, excludePrefixes: string[] = [], activePath?: string) {
  if (!pathname) return false
  const targetPath = activePath || normalizeHrefPath(href)
  if (excludePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false
  if (exact) return pathname === targetPath
  return pathname === targetPath || pathname.startsWith(`${targetPath}/`)
}

function NavComingSoonBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border border-border/80 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground",
        className,
      )}
    >
      即将上线
    </span>
  )
}

export function Header() {
  const router = useRouter()
  const pathname = usePathname()
  const { isLoggedIn, user } = useMaintenanceAuth()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(defaultOpenSidebarGroups)

  const navigation = useMemo(() => {
    return appNavigation
      .map((item) => ({
        ...item,
        children: item.children?.filter((child) => {
          if (child.permission === "knowledgeReview") return canAccessKnowledgeReview(user)
          return true
        }),
      }))
      .filter((item) => !item.children || item.children.length > 0)
  }, [user])

  const roleLabel = useMemo(() => {
    const roles = user?.roles ?? []
    if (roles.includes("admin")) return "管理员"
    if (roles.includes("expert")) return "专家"
    if (roles.includes("safety")) return "审批员"
    if (roles.includes("worker")) return "检修员"
    return "访客"
  }, [user])

  useEffect(() => {
    document.body.classList.add("fd-app-shell")
    document.body.style.setProperty("--fd-sidebar-offset", sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH)
    return () => {
      document.body.classList.remove("fd-app-shell")
      document.body.style.removeProperty("--fd-sidebar-offset")
    }
  }, [sidebarCollapsed])

  useEffect(() => {
    const handleExpired = () => {}
    window.addEventListener(MAINTENANCE_AUTH_EXPIRED_EVENT, handleExpired as EventListener)
    return () => {
      window.removeEventListener(MAINTENANCE_AUTH_EXPIRED_EVENT, handleExpired as EventListener)
    }
  }, [])

  const handleLogout = () => {
    clearMaintenanceToken()
    toast.success("已退出登录")
    router.push(ROUTES.login)
    router.refresh()
  }

  const handleNavigate = (href: string) => {
    setMobileNavOpen(false)
    router.push(href)
  }

  const toggleGroup = (href: string) => {
    setOpenGroups((current) => ({ ...current, [href]: !(current[href] ?? true) }))
  }

  return (
    <>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden h-dvh overflow-hidden border-r border-border/80 bg-card/95 shadow-[10px_0_30px_rgba(15,23,42,0.06)] backdrop-blur md:flex md:flex-col",
          "transition-[width] duration-200 ease-out",
          sidebarCollapsed ? "w-[4.5rem]" : "w-[15rem]",
        )}
      >
        <SidebarBrand collapsed={sidebarCollapsed} />
        <nav className="fd-sidebar-scroll flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
          {navigation.map((item) => (
            <SidebarNavItem
              key={item.href}
              item={item}
              pathname={pathname}
              collapsed={sidebarCollapsed}
              groupOpen={openGroups[item.href] ?? true}
              onToggleGroup={() => toggleGroup(item.href)}
              onNavigate={handleNavigate}
              onCloseNav={() => setMobileNavOpen(false)}
            />
          ))}
        </nav>
        <div className="shrink-0 border-t border-border/80 p-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className={cn("w-full justify-start gap-2", sidebarCollapsed && "justify-center px-0")}
                onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
                aria-label={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
              >
                {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                <span className={cn("text-sm", sidebarCollapsed && "sr-only")}>{sidebarCollapsed ? "展开" : "折叠"}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}</TooltipContent>
          </Tooltip>
        </div>
      </aside>

      <header className="fixed left-0 right-0 top-0 z-30 border-b border-border/70 bg-background/92 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85 md:left-[var(--fd-sidebar-offset)]">
        <div className="flex h-16 items-center justify-between gap-3 px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="md:hidden" aria-label="打开菜单">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex h-dvh w-[18rem] flex-col overflow-hidden border-border bg-card p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>应用导航</SheetTitle>
                </SheetHeader>
                <SidebarBrand collapsed={false} mobile />
                <nav className="fd-sidebar-scroll flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
                  {navigation.map((item) => (
                    <SidebarNavItem
                      key={item.href}
                      item={item}
                      pathname={pathname}
                      collapsed={false}
                      groupOpen={openGroups[item.href] ?? true}
                      onToggleGroup={() => toggleGroup(item.href)}
                      onNavigate={handleNavigate}
                      onCloseNav={() => setMobileNavOpen(false)}
                    />
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">FaultDiag 控制台</div>
              <div className="hidden truncate text-xs text-muted-foreground sm:block">检修闭环 · 智能诊断 · 知识沉淀</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle variant="icon" />

            <div className="hidden sm:block">
              <NotificationMenu />
            </div>

            <HelpMenu />

            <div className="hidden h-5 w-px bg-border sm:block" />

            {isLoggedIn ? (
              <UserMenu roleLabel={roleLabel} userName={user?.display_name || user?.username || roleLabel} onLogout={handleLogout} />
            ) : (
              <Button type="button" variant="ghost" className="h-8 gap-2 px-3" onClick={() => router.push(ROUTES.login)}>
                <LogIn className="h-4 w-4" />
                <span className="hidden text-sm sm:inline">前往登录</span>
              </Button>
            )}
          </div>
        </div>
      </header>
    </>
  )
}

function SidebarBrand({ collapsed, mobile = false }: { collapsed: boolean; mobile?: boolean }) {
  return (
    <Link
      href={ROUTES.marketingHome}
      className={cn(
        "flex h-16 items-center gap-3 border-b border-border/80 px-4 transition-colors hover:bg-accent/40",
        collapsed && !mobile && "justify-center px-0",
      )}
      title="返回产品官网"
    >
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand/25 bg-brand/12 text-sm font-bold text-brand-dark">
        FD
      </span>
      <span className={cn("min-w-0", collapsed && !mobile && "sr-only")}>
        <span className="block truncate text-lg font-semibold leading-tight text-foreground">FaultDiag</span>
        <span className="block truncate text-xs text-muted-foreground">多模态智能检修</span>
      </span>
    </Link>
  )
}

function SidebarNavItem({
  item,
  pathname,
  collapsed,
  groupOpen,
  onToggleGroup,
  onNavigate,
  onCloseNav,
}: {
  item: AppNavItem
  pathname: string | null
  collapsed: boolean
  groupOpen: boolean
  onToggleGroup: () => void
  onNavigate: (href: string) => void
  onCloseNav: () => void
}) {
  const Icon = item.icon
  const childActive =
    item.children?.some(
      (child) =>
        !child.comingSoon &&
        isRouteActive(pathname, child.href, child.exact, child.excludePrefixes, child.activePath),
    ) ?? false
  const active =
    !item.comingSoon && (isRouteActive(pathname, item.href, item.exact) || childActive)
  const hasChildren = Boolean(item.children?.length)
  const expanded = hasChildren && groupOpen && !collapsed

  if (hasChildren && !collapsed) {
    return (
      <div>
        <div
          className={cn(
            "flex h-10 w-full items-center rounded-lg text-sm font-medium transition-colors",
            item.comingSoon
              ? "cursor-default text-muted-foreground/80"
              : active
                ? "bg-brand text-primary-foreground shadow-[0_10px_24px_rgba(24,195,126,0.22)]"
                : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
          )}
        >
          {item.comingSoon ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 px-3" aria-disabled="true" title="监测告警模块即将上线">
              <Icon className="h-4 w-4 shrink-0 opacity-60" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <NavComingSoonBadge />
            </div>
          ) : (
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 px-3 text-left" onClick={() => onNavigate(item.href)}>
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          )}
          <button
            type="button"
            className="mr-2 rounded p-1 text-current/80 hover:bg-black/5"
            onClick={onToggleGroup}
            aria-label={groupOpen ? `收起${item.label}` : `展开${item.label}`}
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>

        {expanded ? (
          <div className="ml-5 mt-1 flex flex-col gap-1 border-l border-border pl-3">
            {item.children?.map((child) => {
              const ChildIcon = child.icon
              const subActive =
                !child.comingSoon &&
                isRouteActive(pathname, child.href, child.exact, child.excludePrefixes, child.activePath)
              if (child.comingSoon) {
                return (
                  <div
                    key={child.href}
                    className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground/70"
                    aria-disabled="true"
                    title="故障告警模块即将上线"
                  >
                    <ChildIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate">{child.label}</span>
                    <NavComingSoonBadge />
                  </div>
                )
              }
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  className={cn(
                    "flex h-8 items-center gap-2 rounded-md px-2 text-left text-xs transition-colors",
                    subActive ? "bg-brand/12 text-brand-dark" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                  onClick={onCloseNav}
                >
                  <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{child.label}</span>
                </Link>
              )
            })}
          </div>
        ) : null}
      </div>
    )
  }

  const button = (
    <button
      type="button"
      disabled={item.comingSoon}
      className={cn(
        "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors",
        item.comingSoon
          ? "cursor-not-allowed text-muted-foreground/70 opacity-80"
          : active
            ? "bg-brand text-primary-foreground shadow-[0_10px_24px_rgba(24,195,126,0.22)]"
            : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
      onClick={() => {
        if (!item.comingSoon) onNavigate(item.href)
      }}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className={cn("min-w-0 flex-1 truncate", collapsed && "sr-only")}>{item.label}</span>
      {item.comingSoon && !collapsed ? <NavComingSoonBadge /> : null}
    </button>
  )

  return (
    <div>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right">{item.comingSoon ? `${item.label}（即将上线）` : item.label}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
    </div>
  )
}

function HelpMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="hidden h-8 w-8 sm:inline-flex" aria-label="帮助">
          <HelpCircle className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 border-border bg-popover text-popover-foreground">
        <div className="px-2 py-1.5">
          <div className="text-xs font-medium text-foreground">当前页帮助</div>
          <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
            先在智能诊断中创建任务，再进入任务详情查看证据、步骤，并继续生成工单或沉淀案例。
          </div>
        </div>
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem asChild>
          <Link href={ROUTES.marketingHome} className="cursor-pointer">
            返回产品官网
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem onClick={() => window.open(`${getApiBase()}/docs`, "_blank", "noopener,noreferrer")}>接口文档</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void fetchHealth()}>系统健康检查</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void fetchMaintenanceHealth()}>检修域连通检查</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu({ roleLabel, userName, onLogout }: { roleLabel: string; userName: string; onLogout: () => void }) {
  const router = useRouter()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-8 gap-2 px-2 hover:bg-accent">
          <Avatar className="h-6 w-6">
            <AvatarImage src="/placeholder-user.jpg" />
            <AvatarFallback className="bg-[#5e6ad2] text-xs text-white">{userName.slice(0, 1)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-28 truncate text-sm text-foreground lg:inline-block">{userName}</span>
          <ChevronDown className="hidden h-3 w-3 text-foreground/70 sm:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 border-border bg-popover text-popover-foreground">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">{roleLabel}</div>
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem onClick={() => router.push(ROUTES.settings)}>系统设置</DropdownMenuItem>
        <DropdownMenuItem onClick={onLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
