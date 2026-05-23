import { expect, test, type Page, type Route } from "@playwright/test";

function jsonResponse(data: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "http://127.0.0.1:3000",
      "access-control-allow-credentials": "true",
    },
    body: JSON.stringify(data),
  };
}

async function mockDashboardApis(
  page: Page,
  overview: unknown,
  caseTotal = 5,
  historyTasks?: unknown[],
) {
  await page.route("**/api/v1/workbench/overview**", async (route: Route) => {
    await route.fulfill(jsonResponse(overview));
  });

  await page.route("**/api/v1/system/metrics**", async (route: Route) => {
    await route.fulfill(jsonResponse({ counters: [], durations: [] }));
  });

  await page.route("**/health", async (route: Route) => {
    await route.fulfill(
      jsonResponse({ status: "healthy", database: "connected" }),
    );
  });

  await page.route("**/api/v1/cases?*", async (route: Route) => {
    const cases = Array.from({ length: caseTotal }, (_, index) => ({
      id: index + 1,
      title: `案例 ${index + 1}`,
      equipment_type: "燃油泵",
      status: index < 3 ? "pending_review" : "approved",
      symptom_description: "异常振动",
      updated_at: "2026-05-13T08:00:00",
    }));
    await route.fulfill(
      jsonResponse({
        total: caseTotal,
        cases,
      }),
    );
  });

  await page.route("**/api/v1/history**", async (route: Route) => {
    await route.fulfill(
      jsonResponse({
        total: historyTasks?.length ?? 0,
        tasks: historyTasks ?? [],
      }),
    );
  });
}

const populatedHistory = [
  {
    id: 1,
    title: "燃油泵巡检",
    equipment_type: "燃油泵",
    equipment_model: "FP-200",
    status: "pending",
    maintenance_level: "standard",
    workflow_total: 5,
    workflow_completed: 0,
    total_steps: 4,
    completed_steps: 1,
    created_at: "2026-05-07T08:30:00",
    updated_at: "2026-05-07T09:00:00",
  },
  {
    id: 2,
    title: "液压站排查",
    equipment_type: "液压站",
    equipment_model: "HY-10",
    status: "in_progress",
    maintenance_level: "standard",
    workflow_total: 5,
    workflow_completed: 2,
    total_steps: 5,
    completed_steps: 2,
    created_at: "2026-05-08T09:30:00",
    updated_at: "2026-05-08T10:00:00",
  },
  {
    id: 3,
    title: "控制柜复核",
    equipment_type: "控制柜",
    equipment_model: "CK-7",
    status: "completed",
    maintenance_level: "standard",
    workflow_total: 5,
    workflow_completed: 4,
    total_steps: 3,
    completed_steps: 2,
    created_at: "2026-05-09T10:30:00",
    updated_at: "2026-05-09T11:00:00",
  },
  {
    id: 4,
    title: "冷却泵核验",
    equipment_type: "冷却泵",
    equipment_model: "CP-18",
    status: "completed",
    maintenance_level: "urgent",
    workflow_total: 5,
    workflow_completed: 5,
    total_steps: 6,
    completed_steps: 4,
    created_at: "2026-05-10T08:00:00",
    updated_at: "2026-05-10T10:15:00",
  },
];

const allCompletedHistory = [
  {
    id: 11,
    title: "伺服电机收口",
    equipment_type: "伺服电机",
    equipment_model: "SM-21",
    status: "completed",
    maintenance_level: "urgent",
    workflow_total: 5,
    workflow_completed: 5,
    total_steps: 7,
    completed_steps: 7,
    created_at: "2026-05-13T08:40:00",
    updated_at: "2026-05-13T11:00:00",
  },
];

const todayOnlyHistory = [
  {
    id: 21,
    title: "今日触发闭环",
    equipment_type: "燃油泵",
    equipment_model: "FP-200",
    status: "completed",
    maintenance_level: "standard",
    workflow_total: 5,
    workflow_completed: 5,
    total_steps: 4,
    completed_steps: 4,
    created_at: "2026-05-23T09:00:00",
    updated_at: "2026-05-23T10:00:00",
  },
];

const populatedOverview = {
  generated_at: "2026-05-13T11:30:00",
  stats: [
    {
      key: "knowledge_documents",
      label: "知识文档",
      value: 18,
      accent: "blue",
    },
    { key: "knowledge_chunks", label: "知识分段", value: 42, accent: "green" },
    { key: "active_tasks", label: "进行中任务", value: 6, accent: "amber" },
    { key: "pending_cases", label: "待审核案例", value: 3, accent: "red" },
  ],
  featured_queries: [],
  agent_capabilities: [],
  recommended_knowledge_count: 0,
  recommended_knowledge: [],
  recent_tasks: [
    {
      id: 1,
      title: "燃油泵巡检",
      equipment_type: "燃油泵",
      equipment_model: "FP-200",
      status: "pending",
      maintenance_level: "standard",
      total_steps: 4,
      completed_steps: 1,
      created_at: "2026-05-07T08:30:00",
      updated_at: "2026-05-07T09:00:00",
      asset_code: "EQ-001",
      work_order_id: "WO-001",
    },
    {
      id: 2,
      title: "液压站排查",
      equipment_type: "液压站",
      equipment_model: "HY-10",
      status: "pending",
      maintenance_level: "standard",
      total_steps: 5,
      completed_steps: 2,
      created_at: "2026-05-08T09:30:00",
      updated_at: "2026-05-08T10:00:00",
      asset_code: "EQ-002",
      work_order_id: "WO-002",
    },
    {
      id: 3,
      title: "控制柜复核",
      equipment_type: "控制柜",
      equipment_model: "CK-7",
      status: "processing",
      maintenance_level: "standard",
      total_steps: 3,
      completed_steps: 2,
      created_at: "2026-05-09T10:30:00",
      updated_at: "2026-05-09T11:00:00",
      asset_code: "EQ-003",
      work_order_id: "WO-003",
    },
    {
      id: 4,
      title: "冷却泵核验",
      equipment_type: "冷却泵",
      equipment_model: "CP-18",
      status: "processing",
      maintenance_level: "urgent",
      total_steps: 6,
      completed_steps: 4,
      created_at: "2026-05-10T08:00:00",
      updated_at: "2026-05-10T10:15:00",
      asset_code: "EQ-004",
      work_order_id: "WO-004",
    },
    {
      id: 5,
      title: "传送带复检",
      equipment_type: "传送带",
      equipment_model: "CB-88",
      status: "resolved",
      maintenance_level: "standard",
      total_steps: 5,
      completed_steps: 5,
      created_at: "2026-05-11T07:45:00",
      updated_at: "2026-05-11T09:20:00",
      asset_code: "EQ-005",
      work_order_id: "WO-005",
    },
    {
      id: 6,
      title: "液位计回检",
      equipment_type: "液位计",
      equipment_model: "LV-5",
      status: "resolved",
      maintenance_level: "standard",
      total_steps: 4,
      completed_steps: 4,
      created_at: "2026-05-12T08:10:00",
      updated_at: "2026-05-12T09:35:00",
      asset_code: "EQ-006",
      work_order_id: "WO-006",
    },
    {
      id: 7,
      title: "伺服电机收口",
      equipment_type: "伺服电机",
      equipment_model: "SM-21",
      status: "resolved",
      maintenance_level: "urgent",
      total_steps: 7,
      completed_steps: 7,
      created_at: "2026-05-13T08:40:00",
      updated_at: "2026-05-13T11:00:00",
      asset_code: "EQ-007",
      work_order_id: "WO-007",
    },
  ],
  recent_cases: [
    {
      id: 91,
      title: "燃油泵异常振动案例",
      equipment_type: "燃油泵",
      status: "approved",
      updated_at: "2026-05-13T08:00:00",
    },
  ],
};

const todayOnlyOverview = {
  generated_at: "2026-05-23T11:30:00",
  stats: [
    { key: "active_tasks", label: "进行中任务", value: 1, accent: "green" },
  ],
  featured_queries: [],
  agent_capabilities: [],
  recommended_knowledge_count: 0,
  recommended_knowledge: [],
  recent_tasks: [
    {
      id: 21,
      title: "今日触发闭环",
      equipment_type: "燃油泵",
      equipment_model: "FP-200",
      status: "resolved",
      maintenance_level: "standard",
      total_steps: 4,
      completed_steps: 4,
      created_at: "2026-05-23T09:00:00",
      updated_at: "2026-05-23T10:00:00",
      asset_code: "EQ-021",
      work_order_id: "WO-021",
    },
  ],
  recent_cases: [],
};

test("dashboard shows closure overview charts in populated state", async ({
  page,
}) => {
  await mockDashboardApis(page, populatedOverview, 5, populatedHistory);

  await page.goto("/dashboard");

  await expect(
    page.getByRole("heading", { name: "检修闭环总览" }),
  ).toBeVisible();
  await expect(page.getByTestId("closure-overview-shell")).toBeVisible();
  await expect(page.getByTestId("closure-overview-side-panel")).toBeVisible();
  await expect(page.getByTestId("closure-kpi-未闭环异常")).toContainText("4");
  await expect(page.getByTestId("closure-kpi-超时任务")).toContainText("4");
  await expect(page.getByTestId("closure-kpi-高优先级任务")).toContainText("1");
  await expect(page.getByTestId("closure-kpi-主要堵点")).toContainText(
    "案例沉淀",
  );
  await expect(page.getByTestId("closure-kpi-闭环率")).toContainText("25%");
  await expect(page.getByTestId("closure-overview-side-panel")).toContainText(
    "闭环推进状态",
  );
  await expect(
    page.getByTestId("closure-overview-side-panel"),
  ).not.toContainText("闭环运营提示");
  await expect(page.getByTestId("status-donut-panel")).toBeVisible();
  await expect(page.getByTestId("closure-stage-panel")).toBeVisible();
  await expect(page.getByTestId("status-donut-panel")).toContainText(
    "闭环推进状态",
  );
  await expect(page.getByTestId("closure-stage-panel")).toContainText(
    "闭环阶段分布",
  );
  await expect(page.getByText("异常处理趋势")).toBeVisible();
  await expect(page.getByText("闭环推进状态")).toBeVisible();
  await expect(page.getByText("闭环阶段分布")).toBeVisible();
  await expect(
    page.getByTestId("status-donut-body").getByText("诊断中"),
  ).toBeVisible();
  await expect(page.getByTestId("status-donut-panel")).toBeVisible();
  await expect(page.getByTestId("status-donut-body")).toBeVisible();
  await expect(page.getByTestId("closure-trend-panel")).toBeVisible();
  await expect(page.getByTestId("closure-trend-header")).toContainText(
    "异常处理趋势",
  );
  await expect(page.getByTestId("closure-trend-summary")).toBeVisible();
  await expect(
    page.getByTestId("closure-trend-summary-item-闭环率"),
  ).toContainText("闭环率");
  await expect(
    page.getByTestId("closure-trend-summary-item-主要堵点"),
  ).toContainText("主要堵点");
  await expect(
    page.getByTestId("closure-trend-summary-item-已形成工单"),
  ).toContainText("已形成工单");
  await expect(page.getByText(/近 7 日闭环率为 25%/)).toBeVisible();
  await expect(page.getByTestId("closure-trend-plot")).toBeVisible();
  await expect(page.getByTestId("closure-trend-chart")).toBeVisible();
  await expect(page.getByTestId("closure-trend-axis")).toHaveAttribute(
    "data-compact",
    "false",
  );
  await expect(
    page.locator(
      "[data-testid='closure-trend-axis'] [data-label-visible='true']",
    ),
  ).toHaveCount(7);
  await expect(page.getByTestId("closure-stage-panel")).toBeVisible();
  await expect(page.getByTestId("closure-stage-chart")).toBeVisible();
  await expect(page.getByTestId("closure-stage-values")).toBeVisible();
  await expect(page.getByTestId("closure-stage-chart")).toContainText(
    "问题诊断",
  );
  await expect(page.getByTestId("closure-stage-value-告警触发")).toContainText(
    "4",
  );
  await expect(page.getByTestId("closure-stage-value-问题诊断")).toContainText(
    "4",
  );
  await expect(page.getByTestId("closure-stage-value-生成工单")).toContainText(
    "0",
  );
  await expect(page.getByTestId("closure-stage-value-工单处理")).toContainText(
    "2",
  );
  await expect(page.getByTestId("closure-stage-value-案例沉淀")).toContainText(
    "8",
  );
  await expect(page.getByText("重点待办与风险任务")).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "检修等级" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "距最近更新" }),
  ).toBeVisible();
  await expect(page.getByText("标准").first()).toBeVisible();
  await expect(page.getByText("超过 3 天未更新").first()).toBeVisible();
  await expect(page.getByText("燃油泵巡检")).toBeVisible();
  await expect(page.getByText("液压站排查")).toBeVisible();
  await expect(page.getByText("冷却泵核验")).toBeVisible();
  const riskTaskPanel = page.getByTestId("closure-risk-tasks-panel");
  await expect(riskTaskPanel.getByText("案例沉淀")).toHaveCount(0);
  await expect(riskTaskPanel.getByText("执行处理")).toHaveCount(0);
  await expect(riskTaskPanel.getByText("积压")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("异常峰值");
  await expect(page.locator("body")).not.toContainText("积压节点");
  await expect(page.locator("body")).not.toContainText("当前异常");
  await expect(page.locator("body")).not.toContainText("峰值");
  await expect(page.locator("body")).not.toContainText("基线");
  expect(
    await page.evaluate(() => {
      const riskPanel = document.querySelector(
        '[data-testid="closure-risk-tasks-panel"]',
      );
      const trendPanel = document.querySelector(
        '[data-testid="closure-trend-panel"]',
      );
      if (!riskPanel || !trendPanel) return false;
      return Boolean(
        riskPanel.compareDocumentPosition(trendPanel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }),
  ).toBe(true);

  await page.getByRole("button", { name: "今日" }).click();
  await expect(page.getByTestId("closure-trend-axis")).toContainText("08:00");
  await expect(page.getByTestId("closure-trend-axis")).toContainText("23:00");
  await expect(page.getByTestId("closure-stage-value-告警触发")).toContainText(
    "0",
  );
  await expect(page.getByTestId("closure-stage-value-问题诊断")).toContainText(
    "0",
  );
  await expect(page.getByText("燃油泵巡检")).toBeHidden();
  await page.getByRole("button", { name: "近 30 日" }).click();
  await expect(
    page.getByTestId("closure-trend-chart").locator(".recharts-bar-rectangle"),
  ).toHaveCount(30);
  await expect(page.getByTestId("closure-trend-axis")).toContainText("04/14");
  await page.getByRole("button", { name: "近 7 日" }).click();
  await expect(
    page.getByTestId("closure-trend-chart").locator(".recharts-bar-rectangle"),
  ).toHaveCount(7);
  await expect(page.getByTestId("closure-trend-axis")).toContainText("05/07");
  await expect(page.getByTestId("closure-stage-value-告警触发")).toContainText(
    "4",
  );
  await expect(page.getByText("燃油泵巡检")).toBeVisible();
});

test("dashboard keeps closure overview shell in empty state", async ({
  page,
}) => {
  await mockDashboardApis(
    page,
    {
      generated_at: "2026-05-13T11:30:00",
      stats: [],
      featured_queries: [],
      agent_capabilities: [],
      recommended_knowledge_count: 0,
      recommended_knowledge: [],
      recent_tasks: [],
      recent_cases: [],
    },
    0,
    [],
  );

  await page.goto("/dashboard");

  await expect(
    page.getByRole("heading", { name: "检修闭环总览" }),
  ).toBeVisible();
  await expect(page.getByTestId("closure-overview-shell")).toBeVisible();
  await expect(page.getByTestId("closure-trend-panel")).toBeVisible();
  await expect(
    page.getByTestId("closure-trend-summary-item-闭环率"),
  ).toContainText("0%");
  await expect(
    page.getByTestId("closure-trend-summary-item-主要堵点"),
  ).toContainText("暂无数据");
  await expect(
    page.getByTestId("closure-trend-summary-item-已形成工单"),
  ).toContainText("0");
  await expect(page.locator("body")).not.toContainText("异常峰值");
  await expect(page.locator("body")).not.toContainText("积压节点");
  await expect(page.locator("body")).not.toContainText("当前异常");
  await expect(page.getByTestId("status-donut-panel")).toBeVisible();
  await expect(page.getByTestId("closure-stage-panel")).toBeVisible();
  await expect(page.getByTestId("status-donut-track")).toBeVisible();
  await expect(page.getByTestId("closure-stage-chart")).toContainText(
    "案例沉淀",
  );
  await expect(page.getByTestId("closure-stage-value-案例沉淀")).toContainText(
    "0",
  );
});

test("dashboard mobile header stays compact and trend labels are reduced", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();

  await mockDashboardApis(page, populatedOverview, 5, populatedHistory);

  await page.goto("/dashboard");

  await expect(
    page.getByRole("heading", { name: "检修闭环总览" }),
  ).toBeVisible();
  await expect(page.getByTestId("closure-overview-shell")).toHaveAttribute(
    "data-mobile-stack",
    "true",
  );
  await expect(page.getByText("前往登录")).toBeHidden();
  await expect(page.getByTestId("closure-trend-summary")).toBeVisible();
  await expect(page.getByTestId("closure-trend-axis")).toHaveAttribute(
    "data-compact",
    "true",
  );
  await expect(page.getByTestId("status-donut-body")).toHaveAttribute(
    "data-mobile-layout",
    "stacked",
  );
  await expect(page.getByTestId("closure-stage-values")).toBeVisible();
  await expect(
    page.locator(
      "[data-testid='closure-trend-axis'] [data-label-visible='true']",
    ),
  ).toHaveCount(4);
  await expect(
    page.locator(
      "[data-testid='closure-trend-axis'] [data-label-visible='false']",
    ),
  ).toHaveCount(3);

  await context.close();
});

test("dashboard donut renders a full ring for 100 percent completion", async ({
  page,
}) => {
  await mockDashboardApis(page, populatedOverview, 5, allCompletedHistory);

  await page.goto("/dashboard");

  const donut = page.getByTestId("status-donut-chart");
  await expect(donut).toBeVisible();
  await expect(donut.locator("svg")).toBeVisible();
  await expect(
    page.getByTestId("status-donut-body").getByText("诊断中"),
  ).toBeVisible();
  await expect(
    page.locator("[data-testid='status-donut-center']"),
  ).toContainText("100%");
  const centerFit = await page.evaluate(() => {
    const rate = document.querySelector('[data-testid="status-donut-rate-value"]');
    const track = document.querySelector('[data-testid="status-donut-track"]');
    if (!(rate instanceof HTMLElement) || !(track instanceof SVGElement)) {
      return { fits: false, textWidth: 0, innerDiameter: 0 };
    }
    const rateBox = rate.getBoundingClientRect();
    const trackBox = track.getBoundingClientRect();
    const innerDiameter = (trackBox.width / 128) * 74;
    return {
      fits: rateBox.width <= innerDiameter,
      textWidth: rateBox.width,
      innerDiameter,
    };
  });
  expect(centerFit.fits, JSON.stringify(centerFit)).toBe(true);
});

test("dashboard keeps today-only closure trend on today's bucket", async ({
  page,
}) => {
  await mockDashboardApis(page, todayOnlyOverview, 0, todayOnlyHistory);

  await page.goto("/dashboard");

  await expect(page.getByText(/近 7 日闭环率为 100%/)).toBeVisible();
  await expect(page.getByTestId("closure-trend-axis")).toContainText("05/23");

  const barGroups = page
    .getByTestId("closure-trend-chart")
    .locator(".recharts-bar-rectangle");
  await expect(barGroups).toHaveCount(7);
  await expect(
    page
      .getByTestId("closure-trend-chart")
      .locator(".recharts-bar-rectangle .recharts-rectangle"),
  ).toHaveCount(1);

  await page.getByRole("button", { name: "今日" }).click();
  const todayBarGroups = page
    .getByTestId("closure-trend-chart")
    .locator(".recharts-bar-rectangle");
  await expect(todayBarGroups).toHaveCount(24);
  await expect(page.getByTestId("closure-trend-axis")).toContainText("00:00");
  await expect(page.getByTestId("closure-trend-axis")).toContainText("08:00");
  await expect(page.getByTestId("closure-trend-axis")).toContainText("23:00");
  await expect(page.getByTestId("closure-trend-axis")).not.toContainText(
    "03:59",
  );
});
