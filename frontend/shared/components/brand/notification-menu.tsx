"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, AlertTriangle, CheckCircle2, FileSearch } from "lucide-react";
import { toast } from "sonner";
import { getMaintenanceToken } from "@/features/auth/lib/token-store";
import {
  isMaintenanceAuthExpiredError,
  listMaintenanceNotifications,
  markAllMaintenanceNotificationsRead,
  markMaintenanceNotificationRead,
  type MaintenanceNotificationItem,
} from "@/shared/lib/http";
import { useMaintenanceAuth } from "@/features/auth/maintenance-auth";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";

type NotificationKind = "work_order_sla" | "task_completed" | "case_pending_review";

const KIND_CONFIG: Record<NotificationKind, { icon: React.ElementType; iconClass: string; badge: string }> = {
  work_order_sla: { icon: AlertTriangle, iconClass: "text-red-500", badge: "bg-red-500" },
  task_completed: { icon: CheckCircle2, iconClass: "text-green-500", badge: "bg-green-500" },
  case_pending_review: { icon: FileSearch, iconClass: "text-blue-500", badge: "bg-blue-500" },
};

function getKindConfig(kind: string) {
  return KIND_CONFIG[kind as NotificationKind] ?? { icon: Bell, iconClass: "text-muted-foreground", badge: "bg-[#ef4444]" };
}

function roleEmptyHint(roles: string[]): string {
  if (roles.includes("admin")) return "暂无待处理通知";
  if (roles.includes("expert")) return "暂无待审核案例或诊断通知";
  if (roles.includes("safety")) return "暂无工单 SLA 预警";
  return "暂无新通知";
}

export function NotificationMenu() {
  const router = useRouter();
  const { roles } = useMaintenanceAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<MaintenanceNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submittingAll, setSubmittingAll] = useState(false);

  const previewNotifications = useMemo(() => notifications.slice(0, 6), [notifications]);

  const loadNotifications = useCallback(async ({ showLoading = false }: { showLoading?: boolean } = {}) => {
    const token = getMaintenanceToken();
    if (!token) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    if (showLoading) setLoading(true);
    try {
      const payload = await listMaintenanceNotifications(token, 12);
      setNotifications(payload.items);
      setUnreadCount(payload.unread_count);
    } catch (error) {
      if (isMaintenanceAuthExpiredError(error)) return;
      if (showLoading) {
        toast.error(error instanceof Error ? error.message : "加载通知失败");
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => {
      void loadNotifications();
    }, 30000);
    return () => {
      window.clearInterval(timer);
    };
  }, [loadNotifications]);

  useEffect(() => {
    if (!open) return;
    void loadNotifications({ showLoading: true });
  }, [loadNotifications, open]);

  const handleOpenNotification = async (item: MaintenanceNotificationItem) => {
    const token = getMaintenanceToken();
    if (item.link_url) {
      setOpen(false);
      router.push(item.link_url);
    }
    if (!token || item.read) return;
    try {
      const updated = await markMaintenanceNotificationRead(token, item.id);
      setNotifications((current) => current.map((entry) => (entry.id === item.id ? updated : entry)));
      setUnreadCount((current) => Math.max(0, current - 1));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新通知状态失败");
    }
  };

  const handleMarkAllRead = async () => {
    const token = getMaintenanceToken();
    if (!token || unreadCount === 0) return;
    setSubmittingAll(true);
    try {
      await markAllMaintenanceNotificationsRead(token);
      setNotifications((current) => current.map((item) => ({ ...item, read: true })));
      setUnreadCount(0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "全部已读失败");
    } finally {
      setSubmittingAll(false);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={unreadCount > 0 ? `通知中心，${unreadCount} 条未读` : "通知中心"}
          className="relative h-8 w-8 text-foreground/80 hover:bg-accent hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 ? (
            <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-[#ef4444]" />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 border-border bg-popover p-1 text-popover-foreground">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-xs text-muted-foreground">通知中心</span>
          <span className="text-[11px] text-muted-foreground">{unreadCount > 0 ? `${unreadCount} 条未读` : "已全部处理"}</span>
        </div>
        {loading ? (
          <div className="px-2 py-5 text-center text-xs text-muted-foreground">正在加载通知...</div>
        ) : notifications.length === 0 ? (
          <div className="px-2 py-5 text-center text-xs text-muted-foreground">{roleEmptyHint(roles)}</div>
        ) : (
          <>
            {previewNotifications.map((item) => {
              const cfg = getKindConfig(item.kind);
              const Icon = cfg.icon;
              return (
                <DropdownMenuItem
                  key={item.id}
                  className="flex items-start gap-2 rounded-md px-2 py-2 text-foreground focus:bg-accent focus:text-accent-foreground"
                  onClick={() => void handleOpenNotification(item)}
                >
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cfg.iconClass}`} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-sm">{item.title}</span>
                      {!item.read ? <span className={`h-2 w-2 shrink-0 rounded-full ${cfg.badge}`} /> : null}
                    </div>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{item.detail}</span>
                  </div>
                </DropdownMenuItem>
              );
            })}
            {notifications.length > previewNotifications.length ? (
              <div className="px-2 py-2 text-[11px] text-muted-foreground">
                仅展示最近 {previewNotifications.length} 条通知，其余通知请进入对应页面查看。
              </div>
            ) : null}
          </>
        )}
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem
          className="text-center text-xs text-muted-foreground focus:bg-accent"
          onClick={() => {
            setOpen(false);
            router.push("/dashboard");
          }}
        >
          查看工作台
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-center text-xs text-muted-foreground focus:bg-accent"
          onClick={() => void handleMarkAllRead()}
          disabled={submittingAll || unreadCount === 0}
        >
          全部标为已读
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
