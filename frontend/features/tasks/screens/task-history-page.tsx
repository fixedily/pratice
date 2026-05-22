"use client";

import { Header } from "@/shared/components/brand/app-header";
import { DiagnosisHistoryPanel } from "@/features/tasks/components/diagnosis-history-panel";

export default function TaskHistoryPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="app-main space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">诊断记录</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            历史任务用于复盘与沉淀知识，完成诊断后可继续生成工单和知识案例。
          </p>
        </div>
        <DiagnosisHistoryPanel />
      </main>
    </div>
  );
}
