import { expect, test, type Page, type Route } from "@playwright/test";

import type { MaintenanceSystemConfigItem } from "@/shared/lib/http";

function maintenanceEnvelope(data: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ success: true, data, business_code: null, message: null }),
  };
}

function buildModelConfigItems(): MaintenanceSystemConfigItem[] {
  return [
    { key: "model.provider", value: "zhipu", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "model.chat_model", value: "glm-4.5", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "model.vision_model", value: "glm-4.5v", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "model.embedding_model", value: "bge-m3:latest", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "model.reranker_model", value: "BAAI/bge-reranker-v2-m3", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "model.api_base", value: "https://open.bigmodel.cn/api/paas/v4", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "model.temperature", value: "0.1", value_type: "number", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "model.max_tokens", value: "4096", value_type: "number", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "model.api_key_status", value_type: "string", reload_policy: "hot", is_sensitive: true, updated_at: "2026-05-16 12:00:00", value_masked: "已托管" },
  ];
}

function buildAgentConfigItems(): MaintenanceSystemConfigItem[] {
  return [
    { key: "agent.pipeline.mode", value: "conditional", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.pipeline.default_order", value: "[\"perception\",\"diagnosis\",\"planning\",\"review\",\"knowledge\"]", value_type: "json", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.pipeline.fail_strategy", value: "degrade", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.pipeline.review_gate", value: "true", value_type: "boolean", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.pipeline.knowledge_writeback", value: "suggest_only", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.planning.trigger_rules", value: "[\"procedural_query\",\"maintenance_task_present\"]", value_type: "json", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.review.low_confidence_threshold", value: "0.72", value_type: "number", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.perception.enabled", value: "true", value_type: "boolean", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.perception.model_provider", value: "zhipu", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.perception.model_name", value: "glm-4.5v", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.perception.timeout_ms", value: "30000", value_type: "number", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.perception.max_retries", value: "0", value_type: "number", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.diagnosis.enabled", value: "true", value_type: "boolean", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.diagnosis.model_provider", value: "zhipu", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.diagnosis.model_name", value: "glm-4.5", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.diagnosis.timeout_ms", value: "45000", value_type: "number", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.diagnosis.max_retries", value: "1", value_type: "number", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.planning.enabled", value: "true", value_type: "boolean", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.planning.model_provider", value: "zhipu", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.planning.model_name", value: "glm-4.5-air", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.planning.timeout_ms", value: "25000", value_type: "number", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.planning.max_retries", value: "0", value_type: "number", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.review.enabled", value: "true", value_type: "boolean", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.review.model_provider", value: "zhipu", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.review.model_name", value: "glm-4.5-air", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.review.timeout_ms", value: "20000", value_type: "number", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.review.max_retries", value: "0", value_type: "number", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.knowledge.enabled", value: "true", value_type: "boolean", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.knowledge.model_provider", value: "zhipu", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.knowledge.model_name", value: "glm-4.5-air", value_type: "string", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.knowledge.timeout_ms", value: "15000", value_type: "number", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
    { key: "agent.knowledge.max_retries", value: "0", value_type: "number", reload_policy: "hot", is_sensitive: false, updated_at: "2026-05-16 12:00:00" },
  ];
}

async function mockSettingsShell(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("dachuang_maintenance_token", "test-admin-token");
  });

  await page.route("**/api/v1/maintenance/auth/me", async (route: Route) => {
    await route.fulfill(
      maintenanceEnvelope({ id: 1, username: "tc_admin", display_name: "管理员", roles: ["admin"] }),
    );
  });

  await page.route("**/api/v1/maintenance/notifications?*", async (route: Route) => {
    await route.fulfill(maintenanceEnvelope({ items: [], unread_count: 0 }));
  });

  await page.route("**/health", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "healthy", database: "connected" }),
    });
  });

  await page.route("**/api/v1/system/metrics", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ counters: [], durations: [] }),
    });
  });

  await page.route("**/api/v1/maintenance/health", async (route: Route) => {
    await route.fulfill(maintenanceEnvelope({ status: "连通正常" }));
  });

  await page.route("**/api/v1/maintenance/admin/settings-overview", async (route: Route) => {
    await route.fulfill(
      maintenanceEnvelope({
        knowledge_summary: {
          document_count: 0,
          import_job_count: 0,
          published_article_count: 0,
          retrieval_enabled_count: 0,
          last_updated_at: null,
        },
        rag_summary: {
          vector_store_backend: "pgvector",
          embedding_model: "bge-m3:latest",
          enable_reranker: true,
          reranker_model: "BAAI/bge-reranker-v2-m3",
          reranker_top_k: 20,
          enable_search_cache: true,
        },
        workflow_summary: {
          published_flow_template_count: 0,
          device_type_count: 0,
          default_stages: [],
        },
        agent_summary: {
          pipeline_mode: "conditional",
          default_order: ["perception", "diagnosis", "planning", "review", "knowledge"],
          fail_strategy: "degrade",
          review_gate: true,
          knowledge_writeback: "suggest_only",
          last_run_id: "agent-run-1",
          last_run_status: "completed",
          last_run_at: "2026-05-16T12:00:00Z",
          degradation_count: 1,
          agents: [
            { agent_name: "perception", enabled: true, model_provider: "zhipu", model_name: "glm-4.5v", timeout_ms: 30000, max_retries: 0, toolset: [], fallback_agent: null, last_status: "skipped", last_summary: "无图像输入，已跳过", last_run_at: "2026-05-16T12:00:00Z" },
            { agent_name: "diagnosis", enabled: true, model_provider: "zhipu", model_name: "glm-4.5", timeout_ms: 45000, max_retries: 1, toolset: [], fallback_agent: null, last_status: "completed", last_summary: "已生成诊断报告", last_run_at: "2026-05-16T12:00:05Z" },
            { agent_name: "planning", enabled: true, model_provider: "zhipu", model_name: "glm-4.5-air", timeout_ms: 25000, max_retries: 0, toolset: [], fallback_agent: null, last_status: "completed", last_summary: "已生成任务步骤", last_run_at: "2026-05-16T12:00:06Z" },
            { agent_name: "review", enabled: true, model_provider: "zhipu", model_name: "glm-4.5-air", timeout_ms: 20000, max_retries: 0, toolset: [], fallback_agent: null, last_status: "completed", last_summary: "已完成审核", last_run_at: "2026-05-16T12:00:07Z" },
            { agent_name: "knowledge", enabled: true, model_provider: "zhipu", model_name: "glm-4.5-air", timeout_ms: 15000, max_retries: 0, toolset: [], fallback_agent: null, last_status: "degraded", last_summary: "降级为建议模式", last_run_at: "2026-05-16T12:00:08Z" },
          ],
        },
        audit_summary: {
          recent_count: 0,
          latest_items: [],
        },
      }),
    );
  });
}

test("设置面板在知识库与 RAG 之间切换时保持稳定", async ({ page }) => {
  await mockSettingsShell(page);

  await page.goto("/settings?panel=knowledge");
  await expect(page).toHaveURL(/\/settings\?panel=knowledge$/);
  await expect(page.getByRole("heading", { name: "知识库设置" })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/settings\?panel=knowledge$/);

  const sidebar = page.locator("main aside").first();
  await sidebar.getByRole("link", { name: /RAG 检索设置/ }).click();
  await expect(page).toHaveURL(/\/settings\?panel=rag$/);
  await expect(page.getByRole("heading", { name: "RAG 检索设置" })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/settings\?panel=rag$/);

  await sidebar.getByRole("link", { name: /知识库设置/ }).click();
  await expect(page).toHaveURL(/\/settings\?panel=knowledge$/);
  await expect(page.getByRole("heading", { name: "知识库设置" })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/settings\?panel=knowledge$/);
});

test("设置面板从总览单击进入基础设置", async ({ page }) => {
  await mockSettingsShell(page);

  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings$/);

  const sidebar = page.locator("main aside").first();

  await sidebar.getByRole("link", { name: /基础设置/ }).click();
  await expect(page).toHaveURL(/\/settings\?panel=basic$/);
  await expect(page.getByRole("heading", { name: "基础设置" })).toBeVisible();
});

test("模型服务面板加载真实配置并仅提交变更项", async ({ page }) => {
  const patchedKeys: string[] = [];
  const patchedBodies: Array<{ key: string; value: string }> = [];
  let configItems = buildModelConfigItems();

  await mockSettingsShell(page);

  await page.route("**/api/v1/maintenance/admin/system-configs", async (route: Route) => {
    await route.fulfill(
      maintenanceEnvelope({
        items: configItems,
        total: configItems.length,
        page: 1,
        page_size: configItems.length,
      }),
    );
  });

  await page.route("**/api/v1/maintenance/admin/system-configs/**", async (route: Route) => {
    const key = decodeURIComponent(route.request().url().split("/").pop() ?? "");
    const body = JSON.parse(route.request().postData() ?? "{}") as { value?: string };
    patchedKeys.push(route.request().url());
    patchedBodies.push({ key, value: body.value ?? "" });

    configItems = configItems.map((item) =>
      item.key === key ? { ...item, value: body.value ?? "", updated_at: "2026-05-16 12:05:00" } : item,
    );

    const updatedItem = configItems.find((item) => item.key === key);
    await route.fulfill(maintenanceEnvelope(updatedItem));
  });

  await page.goto("/settings?panel=models");

  await expect(page.getByLabel("模型服务表单")).toBeVisible();
  await expect(page.getByLabel("对话模型")).toHaveValue("glm-4.5");

  await page.getByLabel("对话模型").fill("glm-4.5-air");
  await page.getByRole("button", { name: "保存设置" }).click();

  await expect.poll(() => patchedKeys.length).toBe(1);
  expect(patchedKeys[0]).toContain("/api/v1/maintenance/admin/system-configs/model.chat_model");
  expect(patchedBodies[0]).toEqual({ key: "model.chat_model", value: "glm-4.5-air" });

  await expect(page.getByLabel("对话模型")).toHaveValue("glm-4.5-air");
  await expect(page.getByRole("button", { name: "保存设置" })).toBeDisabled();
});

test("模型服务面板使用未保存草稿执行连接测试", async ({ page }) => {
  let capturedBody: Record<string, unknown> | null = null;
  const configItems = buildModelConfigItems();

  await mockSettingsShell(page);

  await page.route("**/api/v1/maintenance/admin/system-configs", async (route: Route) => {
    await route.fulfill(
      maintenanceEnvelope({
        items: configItems,
        total: configItems.length,
        page: 1,
        page_size: configItems.length,
      }),
    );
  });

  await page.route("**/api/v1/maintenance/admin/checks/model-connectivity", async (route: Route) => {
    capturedBody = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill(
      maintenanceEnvelope({
        overall_status: "success",
        provider: "zhipu",
        api_base: "https://draft.example.com/v1",
        credential_status: "已托管",
        tested_at: "2026-05-16 12:30:00",
        results: {
          chat: { status: "success", detail: "chat 连通成功", tested_model: "glm-4.5-air", timestamp: "2026-05-16 12:30:00" },
          vision: { status: "success", detail: "vision 连通成功", tested_model: "glm-4.5v", timestamp: "2026-05-16 12:30:00" },
          embedding: { status: "success", detail: "embedding 连通成功", tested_model: "bge-m3:latest", timestamp: "2026-05-16 12:30:00" },
          reranker: { status: "success", detail: "reranker 连通成功", tested_model: "BAAI/bge-reranker-v2-m3", timestamp: "2026-05-16 12:30:00" },
        },
      }),
    );
  });

  await page.goto("/settings?panel=models");
  await page.getByLabel("对话模型").fill("glm-4.5-air");
  await page.getByLabel("API Base").fill("https://draft.example.com/v1");
  await page.getByLabel("max_tokens").fill("3072");
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/v1/maintenance/admin/checks/model-connectivity"),
  );
  await page.getByRole("button", { name: "测试连接" }).click();
  await responsePromise;

  expect(capturedBody).toMatchObject({
    chat_model: "glm-4.5-air",
    api_base: "https://draft.example.com/v1",
    max_tokens: 3072,
  });

  const resultCard = page.getByLabel("模型服务测试结果");
  await expect(resultCard).toBeVisible();
  await expect(resultCard).toContainText("最近测试");
  await expect(resultCard).toContainText("https://draft.example.com/v1");
  await expect(resultCard).toContainText("chat 连通成功");
  await expect(resultCard).toContainText("glm-4.5-air");
});

test("智能体设置面板加载真实配置并仅提交变更项", async ({ page }) => {
  const patchedBodies: Array<{ key: string; value: string }> = [];
  let configItems = buildAgentConfigItems();

  await mockSettingsShell(page);

  await page.route("**/api/v1/maintenance/admin/system-configs", async (route: Route) => {
    await route.fulfill(
      maintenanceEnvelope({
        items: configItems,
        total: configItems.length,
        page: 1,
        page_size: configItems.length,
      }),
    );
  });

  await page.route("**/api/v1/maintenance/admin/system-configs/**", async (route: Route) => {
    const key = decodeURIComponent(route.request().url().split("/").pop() ?? "");
    const body = JSON.parse(route.request().postData() ?? "{}") as { value?: string };
    patchedBodies.push({ key, value: body.value ?? "" });

    configItems = configItems.map((item) =>
      item.key === key ? { ...item, value: body.value ?? "", updated_at: "2026-05-16 12:05:00" } : item,
    );
    const updatedItem = configItems.find((item) => item.key === key);
    await route.fulfill(maintenanceEnvelope(updatedItem));
  });

  await page.goto("/settings?panel=agents");

  await expect(page.getByRole("heading", { name: "智能体设置" })).toBeVisible();
  await expect(page.getByLabel("智能体设置表单")).toBeVisible();
  await expect(page.getByLabel("诊断 Agent模型")).toHaveValue("glm-4.5");

  await page.getByLabel("诊断 Agent模型").fill("glm-4.5-air");
  await page.getByLabel("低置信度阈值").fill("0.68");
  await page.getByRole("button", { name: "保存设置" }).click();

  await expect.poll(() => patchedBodies.length).toBe(2);
  expect(patchedBodies).toEqual(
    expect.arrayContaining([
      { key: "agent.diagnosis.model_name", value: "glm-4.5-air" },
      { key: "agent.review.low_confidence_threshold", value: "0.68" },
    ]),
  );

  await expect(page.getByRole("button", { name: "保存设置" })).toBeDisabled();
  await expect(page.getByText("降级处理次数")).toBeVisible();
});
