import {
  Bell,
  BookOpen,
  ClipboardList,
  FileCheck2,
  FileText,
  History,
  LayoutDashboard,
  Network,
  Settings,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { ROUTES } from "@/shared/lib/routes";

export type AppNavPermission = "knowledgeReview";

export type AppNavChild = {
  label: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
  excludePrefixes?: string[];
  permission?: AppNavPermission;
  activePath?: string;
  /** 占位模块：展示「即将上线」，不可点击跳转 */
  comingSoon?: boolean;
};

export type AppNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
  defaultOpen?: boolean;
  children?: AppNavChild[];
  /** 占位模块：展示「即将上线」，不可点击跳转 */
  comingSoon?: boolean;
};

export const appNavigation: AppNavItem[] = [
  {
    label: "检修总览",
    href: ROUTES.dashboard,
    icon: LayoutDashboard,
  },
  {
    label: "智能诊断",
    href: ROUTES.diagnosisCreate,
    icon: Wrench,
    defaultOpen: true,
    children: [
      { label: "诊断任务", href: ROUTES.diagnosisCreate, icon: Wrench },
      { label: "诊断记录", href: ROUTES.diagnosisHistory, icon: History },
    ],
  },
  {
    label: "检修工单",
    href: "/tickets",
    icon: ClipboardList,
    defaultOpen: true,
    children: [
      { label: "工单列表", href: "/tickets", icon: ClipboardList, exact: true },
    ],
  },
  {
    label: "监测告警",
    href: ROUTES.monitoringAlerts,
    icon: Bell,
    defaultOpen: false,
    comingSoon: true,
    children: [{ label: "故障告警", href: ROUTES.monitoringAlerts, icon: Bell, comingSoon: true }],
  },
  {
    label: "知识中心",
    href: "/knowledge",
    icon: BookOpen,
    defaultOpen: true,
    children: [
      { label: "知识文档", href: "/knowledge", icon: FileText, excludePrefixes: ["/knowledge/graph", ROUTES.knowledgeReview] },
      { label: "知识图谱", href: "/knowledge/graph", icon: Network },
      { label: "故障案例", href: "/cases", icon: BookOpen },
      { label: "知识审核", href: ROUTES.knowledgeReview, icon: FileCheck2, permission: "knowledgeReview" },
    ],
  },
  {
    label: "系统设置",
    href: ROUTES.settings,
    icon: Settings,
  },
];

export const defaultOpenSidebarGroups = appNavigation.reduce<Record<string, boolean>>((acc, item) => {
  if (item.children?.length) acc[item.href] = item.defaultOpen ?? true;
  return acc;
}, {});
