import { expect, test } from "@playwright/test";

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

test("知识图谱工作台展示态势带、图谱区和分析侧栏", async ({ page }) => {
  await page.route("**/api/v1/knowledge/graph/stats", async (route) => {
    await route.fulfill(
      jsonResponse({
        total_nodes: 24,
        total_edges: 38,
        nodes_by_kind: {
          maintenance_case: 6,
          knowledge_document: 8,
          knowledge_chunk: 7,
          maintenance_task: 3,
        },
        edges_by_type: {
          approved_into: 12,
          references: 10,
          derived_from: 8,
          corrected: 8,
        },
      }),
    );
  });

  await page.route("**/api/v1/knowledge/graph?*", async (route) => {
    await route.fulfill(
      jsonResponse({
        nodes: [
          { id: "case-1", label: "燃油泵异常振动案例", kind: "maintenance_case", properties: {} },
          { id: "doc-1", label: "燃油泵检修规范", kind: "knowledge_document", properties: {} },
          { id: "chunk-1", label: "振动诊断片段", kind: "knowledge_chunk", properties: {} },
          { id: "task-1", label: "泵站巡检任务", kind: "maintenance_task", properties: {} },
        ],
        edges: [
          {
            id: 1,
            source: "case-1",
            target: "doc-1",
            relation_type: "approved_into",
            notes: null,
            created_at: "2026-05-13T10:00:00",
          },
          {
            id: 2,
            source: "doc-1",
            target: "chunk-1",
            relation_type: "references",
            notes: null,
            created_at: "2026-05-13T10:00:00",
          },
          {
            id: 3,
            source: "task-1",
            target: "case-1",
            relation_type: "derived_from",
            notes: null,
            created_at: "2026-05-13T10:00:00",
          },
        ],
      }),
    );
  });

  await page.goto("/knowledge/graph");

  const overviewBand = page.getByLabel("图谱态势带");

  await expect(page.getByText("知识图谱工作台")).toBeVisible();
  await expect(overviewBand.getByText("节点总数").first()).toBeVisible();
  await expect(overviewBand.getByText("关系总数").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "图谱统计" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "节点详情" })).toBeVisible();
  await expect(overviewBand.getByText("24")).toBeVisible();
  await expect(overviewBand.getByText("38")).toBeVisible();
  await expect(overviewBand.getByText("热点关系").first()).toBeVisible();
  await expect(overviewBand.getByText("approved_into")).toBeVisible();
  await expect(overviewBand.getByText("活跃类型").first()).toBeVisible();
  await expect(overviewBand.getByText("知识文档")).toBeVisible();
  await expect(page.getByText("连接方式")).toBeVisible();
  await expect(page.getByText("点击节点后查看与其他知识对象的连接关系")).toBeVisible();
  await expect(page.getByText("层级说明")).toBeVisible();
});

test("知识图谱工作台在空数据时保留完整骨架", async ({ page }) => {
  await page.route("**/api/v1/knowledge/graph/stats", async (route) => {
    await route.fulfill(
      jsonResponse({
        total_nodes: 0,
        total_edges: 0,
        nodes_by_kind: {},
        edges_by_type: {},
      }),
    );
  });

  await page.route("**/api/v1/knowledge/graph?*", async (route) => {
    await route.fulfill(jsonResponse({ nodes: [], edges: [] }));
  });

  await page.goto("/knowledge/graph");

  await expect(page.getByText("知识图谱工作台")).toBeVisible();
  await expect(page.getByText("暂无图谱数据")).toBeVisible();
  await expect(page.getByText("可先通过审核案例或创建检修任务生成关系网络")).toBeVisible();
  await expect(page.getByLabel("图谱态势带")).toBeVisible();
  await expect(page.getByLabel("图谱分析侧栏")).toBeVisible();
});
