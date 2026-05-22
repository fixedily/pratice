"use client";

import { Header } from "@/shared/components/brand/app-header";
import { DiagnosisCreatePanel } from "@/features/tasks/components/diagnosis-create-panel";

export default function TaskCreatePage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="app-main space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">诊断任务</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            录入设备故障现象，系统将基于知识库与多智能体协同流程生成诊断建议。
          </p>
        </div>
        <DiagnosisCreatePanel />
      </main>
    </div>
  );
}
