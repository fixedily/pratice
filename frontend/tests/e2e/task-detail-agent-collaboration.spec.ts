import { expect, test, type Page, type Route } from "@playwright/test";

const taskId = 702;

function jsonResponse(data: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
    },
    body: JSON.stringify(data),
  };
}

async function mockShellApis(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("dachuang_maintenance_token", "task-detail-agent-token");
  });

  await page.route("**/api/v1/workbench/overview**", async (route: Route) => {
    await route.fulfill(jsonResponse({
      generated_at: "2026-05-17T10:00:00",
      stats: [],
      featured_queries: [],
      agent_capabilities: [],
      recommended_knowledge_count: 0,
      recommended_knowledge: [],
      recent_tasks: [],
      recent_cases: [],
    }));
  });
  await page.route("**/api/v1/system/metrics**", async (route: Route) => {
    await route.fulfill(jsonResponse({ counters: [], durations: [] }));
  });
  await page.route("**/health", async (route: Route) => {
    await route.fulfill(jsonResponse({ status: "healthy", database: "connected" }));
  });
  await page.route("**/api/v1/history**", async (route: Route) => {
    await route.fulfill(jsonResponse({ total: 0, tasks: [] }));
  });
  await page.route("**/api/v1/cases?*", async (route: Route) => {
    await route.fulfill(jsonResponse({ total: 0, cases: [] }));
  });
  await page.route("**/api/v1/maintenance/work-orders?*", async (route: Route) => {
    await route.fulfill(jsonResponse({ items: [], total: 0, page: 1, page_size: 20 }));
  });
  await page.route("**/api/v1/maintenance/notifications?*", async (route: Route) => {
    await route.fulfill(jsonResponse({ items: [], unread_count: 0 }));
  });
  await page.route("**/api/v1/maintenance/auth/me", async (route: Route) => {
    await route.fulfill(jsonResponse({
      id: 12,
      username: "agent_tester",
      display_name: "协作测试员",
      roles: ["expert"],
    }));
  });
}

async function mockTaskDetailApi(page: Page) {
  await page.route(`**/api/v1/tasks/${taskId}`, async (route: Route) => {
    await route.fulfill(jsonResponse({
      id: taskId,
      title: "压缩机振动诊断",
      equipment_type: "压缩机",
      equipment_model: "XJ-220",
      maintenance_level: "standard",
      fault_type: "轴承润滑不足",
      symptom_description: "压缩机振动且温升",
      status: "completed",
      workflow_total: 5,
      workflow_completed: 5,
      total_steps: 0,
      completed_steps: 0,
      advice_card: null,
      created_at: "2026-05-17T09:00:00",
      updated_at: "2026-05-17T09:08:00",
      run_started_at: "2026-05-17T09:00:10",
      run_finished_at: "2026-05-17T09:08:00",
      diagnosis_report: "已补充证据后的诊断报告。",
      diagnosis_structured: {
        answer_mode: "diagnosis",
        most_likely_fault: "轴承润滑不足",
        risk_level: "中风险",
        confidence: 86,
        main_symptoms: ["振动", "温升"],
        preliminary_conclusion: "已补充证据后的诊断结论。",
        next_steps: ["检查润滑回路", "复核轴承温升"],
        root_causes: [],
        evidence_items: [],
        evidence_count: 2,
        top_similarity: 84,
        work_order_ready: true,
      },
      reasoning_chain: null,
      source_refs: [],
      execution_timeline: [
        {
          id: "evt-1",
          type: "node_start",
          title: "诊断 Agent",
          description: "开始生成初版诊断。",
          time: "2026-05-17T09:00:10",
        },
        {
          id: "evt-2",
          type: "node_finish",
          title: "诊断 Agent",
          description: "已生成第一版诊断。",
          time: "2026-05-17T09:01:40",
        },
        {
          id: "evt-3",
          type: "critique",
          title: "审核意见生成",
          description: "证据不足，需补充引用。",
          detail: "verdict=revise; target_stage=diagnosis; issues=缺少稳定证据引用 | 缺少工具校验",
          time: "2026-05-17T09:01:45",
        },
        {
          id: "evt-4",
          type: "replan",
          title: "重规划决策已应用",
          description: "已根据审核意见回跑诊断阶段。",
          detail: "action=rerun_stage; target_stage=diagnosis",
          time: "2026-05-17T09:01:46",
        },
        {
          id: "evt-5",
          type: "revision_requested",
          title: "diagnosis 需要修订",
          description: "证据不足，需补充引用。",
          detail: "target_stage=diagnosis; revision_round=1; issues=缺少稳定证据引用 | 缺少工具校验",
          time: "2026-05-17T09:01:47",
        },
        {
          id: "evt-6",
          type: "node_start",
          title: "诊断 Agent",
          description: "开始生成修订版诊断。",
          time: "2026-05-17T09:01:50",
        },
        {
          id: "evt-7",
          type: "node_finish",
          title: "诊断 Agent",
          description: "修订版诊断已完成。",
          time: "2026-05-17T09:03:20",
        },
        {
          id: "evt-8",
          type: "termination",
          title: "图执行已收束",
          description: "revision_completed",
          detail: "status=completed; manual_review_required=False",
          time: "2026-05-17T09:03:30",
        },
      ],
      steps: [],
    }));
  });
}

test("task detail shows the agent collaboration subgraph from timeline events", async ({ page }) => {
  await mockShellApis(page);
  await mockTaskDetailApi(page);

  await page.goto(`/tasks/${taskId}`);
  await page.getByRole("button", { name: /Agent 协作子图/ }).click();

  await expect(page.getByText("当前执行路径")).toBeVisible();
  await expect(page.getByText("证据不足，需补充引用。").first()).toBeVisible();
  await expect(page.getByText("回跑阶段")).toBeVisible();
  await expect(page.getByText("最终状态：已完成")).toBeVisible();
  await expect(page.getByText("缺少稳定证据引用")).toBeVisible();
});
