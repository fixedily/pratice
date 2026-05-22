import { expect, test, type Page, type Route } from "@playwright/test";

async function mockTaskApis(page: Page) {
  await page.route("**/api/v1/history**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tasks: [
          {
            id: 101,
            title: "液压泵异常振动",
            status: "completed",
            equipment_type: "液压泵",
            fault_type: "异常振动",
            created_at: "2026-05-16T09:00:00",
            updated_at: "2026-05-16T09:05:00",
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
      }),
    });
  });

  await page.route("**/api/v1/tasks", async (route: Route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: 102, title: "新建诊断", status: "pending", steps: [] }),
      });
      return;
    }
    await route.fallback();
  });
}

test("诊断任务页面只呈现创建诊断流程", async ({ page }) => {
  await mockTaskApis(page);
  await page.goto("/tasks/new");

  await expect(page.getByRole("heading", { name: "诊断任务" })).toBeVisible();
  await expect(page.locator("#diagnosis-create").getByText("输入故障现象，快速发起诊断任务")).toBeVisible();
  await expect(page.getByRole("button", { name: /开始智能诊断|诊断中/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "诊断任务记录" })).toHaveCount(0);
});

test("诊断记录页面只呈现历史任务列表", async ({ page }) => {
  await mockTaskApis(page);
  await page.goto("/tasks/history");

  await expect(page.getByRole("heading", { name: "诊断记录" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "诊断任务记录" })).toHaveCount(0);
  await expect(page.getByText("液压泵异常振动").first()).toBeVisible();
  await expect(page.getByText("历史任务用于复盘与沉淀知识").first()).toBeVisible();
  await expect(page.getByText("多智能体协同流程")).toBeVisible();
  await expect(page.getByText("录入设备故障现象，系统将基于知识库")).toBeVisible();
});
