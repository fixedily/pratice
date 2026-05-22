"use client";

import { TaskListPageContent } from "@/features/tasks/screens/task-list-page";

export function DiagnosisCreatePanel() {
  return (
    <section className="space-y-6">
      <TaskListPageContent mode="create" />
    </section>
  );
}
