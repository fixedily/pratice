"use client";

import Link from "next/link";
import { Bell } from "lucide-react";

import { Header } from "@/shared/components/brand/app-header";
import { ROUTES } from "@/shared/lib/routes";

export default function MonitoringAlertsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="app-main app-main-wide">
        <div className="app-card p-6">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-muted/30 text-muted-foreground">
              <Bell className="h-5 w-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-foreground">故障告警</h1>
                <span className="rounded-full border border-border/80 bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  即将上线
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                监测告警模块正在建设中。上线后将支持设备告警汇聚、分级处置与检修闭环联动，当前请先在检修总览查看相关指标。
              </p>
            </div>
          </div>
          <div className="mt-6">
            <Link href={ROUTES.dashboard} className="app-btn-secondary">
              返回检修总览
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
