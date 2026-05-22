import { expect, test, type Page, type Route } from "@playwright/test";

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
    window.sessionStorage.setItem("dachuang_maintenance_token", "sidebar-navigation-token");
  });

  await page.route("**/api/v1/workbench/overview**", async (route: Route) => {
    await route.fulfill(
      jsonResponse({
        generated_at: "2026-05-16T10:00:00",
        stats: [{ key: "active_tasks", label: "进行中任务", value: 1, accent: "amber" }],
        featured_queries: [],
        agent_capabilities: [],
        recommended_knowledge_count: 0,
        recommended_knowledge: [],
        recent_tasks: [
          {
            id: 1,
            title: "燃油泵巡检",
            equipment_type: "燃油泵",
            status: "pending",
            maintenance_level: "standard",
            total_steps: 4,
            completed_steps: 1,
            created_at: "2026-05-15T08:00:00",
            updated_at: "2026-05-15T09:00:00",
          },
        ],
        recent_cases: [],
      }),
    );
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
    await route.fulfill(
      jsonResponse({
        id: 1,
        username: "expert_01",
        display_name: "设备专家",
        roles: ["expert"],
      }),
    );
  });
}

test("desktop sidebar renders approved navigation modules", async ({ page }) => {
  await mockShellApis(page);
  await page.goto("/dashboard");

  await expect(page.getByRole("button", { name: "检修总览" })).toBeVisible();
  await expect(page.getByRole("button", { name: "智能诊断", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "诊断任务" })).toBeVisible();
  await expect(page.getByRole("link", { name: "诊断记录" })).toBeVisible();
  await expect(page.getByRole("button", { name: "检修工单", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "工单列表" })).toBeVisible();
  await expect(page.getByRole("link", { name: "重点待办" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "监测告警", exact: true })).toBeVisible();
  await expect(page.getByText("即将上线").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "故障告警" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "知识中心", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "知识文档" })).toBeVisible();
  await expect(page.getByRole("link", { name: "知识图谱" })).toBeVisible();
  await expect(page.getByRole("link", { name: "故障案例" })).toBeVisible();
  await expect(page.getByRole("link", { name: "知识审核" })).toBeVisible();
  await expect(page.getByRole("button", { name: "系统设置" })).toBeVisible();

  await expect(page.getByText("知识案例库")).toHaveCount(0);
});

test("sidebar child links route to real modules", async ({ page }) => {
  await mockShellApis(page);
  await page.goto("/dashboard");

  await expect(page.getByRole("link", { name: "诊断任务" })).toHaveAttribute("href", "/tasks/new");
  await expect(page.getByRole("link", { name: "诊断记录" })).toHaveAttribute("href", "/tasks/history");
  await expect(page.getByRole("link", { name: "重点待办" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "故障告警" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "知识审核" })).toHaveAttribute("href", "/knowledge/review");
});

test("monitoring alerts route shows coming soon instead of dashboard redirect", async ({ page }) => {
  await mockShellApis(page);
  await page.goto("/monitoring/alerts");

  await expect(page).toHaveURL(/\/monitoring\/alerts$/);
  await expect(page.getByRole("heading", { name: "故障告警" })).toBeVisible();
  await expect(page.getByText("即将上线")).toBeVisible();
  await expect(page.getByRole("heading", { name: "检修总览" })).toHaveCount(0);
});

test("mobile sidebar renders grouped navigation inside the sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShellApis(page);

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "打开菜单" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "智能诊断", exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "诊断任务" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "知识中心", exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "故障案例" })).toBeVisible();

  await dialog.getByRole("link", { name: "故障案例" }).click();
  await expect(page).toHaveURL(/\/cases$/);
});
