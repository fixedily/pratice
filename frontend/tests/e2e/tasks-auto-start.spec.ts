import { expect, test } from "@playwright/test";

const taskId = 501;

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

test("开始检修后会跳转详情页并自动进入诊断流", async ({ page }) => {
  let detailPhase: "pending" | "completed" = "pending";

  await page.route("**/api/v1/history**", async (route) => {
    await route.fulfill(
      jsonResponse({
        tasks: [],
      }),
    );
  });

  await page.route("**/api/v1/tasks", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill(
      jsonResponse({
        id: taskId,
        title: "压缩机异常振动诊断",
        equipment_type: "压缩机",
        equipment_model: null,
        asset_code: "CMP-102",
        maintenance_level: "standard",
        symptom_description: "压缩机 ERR-102 报警，伴随异常振动和温升",
        status: "pending",
        workflow_completed: 1,
        workflow_total: 5,
        completed_steps: 0,
        total_steps: 0,
        created_at: "2026-05-11T08:00:00",
        updated_at: "2026-05-11T08:00:00",
        run_started_at: null,
        run_finished_at: null,
        diagnosis_report: null,
        diagnosis_structured: null,
        source_refs: [],
        execution_timeline: [],
        steps: [],
      }),
    );
  });

  await page.route(`**/api/v1/tasks/${taskId}`, async (route) => {
    const detail =
      detailPhase === "pending"
        ? {
            id: taskId,
            title: "压缩机异常振动诊断",
            equipment_type: "压缩机",
            equipment_model: null,
            asset_code: "CMP-102",
            maintenance_level: "standard",
            symptom_description: "压缩机 ERR-102 报警，伴随异常振动和温升",
            status: "pending",
            workflow_completed: 1,
            workflow_total: 5,
            completed_steps: 0,
            total_steps: 0,
            created_at: "2026-05-11T08:00:00",
            updated_at: "2026-05-11T08:00:00",
            run_started_at: null,
            run_finished_at: null,
            diagnosis_report: null,
            diagnosis_structured: null,
            source_refs: [],
            execution_timeline: [],
            steps: [],
          }
        : {
            id: taskId,
            title: "压缩机异常振动诊断",
            equipment_type: "压缩机",
            equipment_model: null,
            asset_code: "CMP-102",
            maintenance_level: "standard",
            symptom_description: "压缩机 ERR-102 报警，伴随异常振动和温升",
            status: "completed",
            workflow_completed: 3,
            workflow_total: 5,
            completed_steps: 0,
            total_steps: 0,
            created_at: "2026-05-11T08:00:00",
            updated_at: "2026-05-11T08:02:00",
            run_started_at: "2026-05-11T08:00:05",
            run_finished_at: "2026-05-11T08:02:00",
            diagnosis_report: "建议先检查联轴器松动与轴承温升，随后复核润滑回路。",
            diagnosis_structured: {
              answer_mode: "diagnosis",
              most_likely_fault: "联轴器松动或轴承润滑不足",
              risk_level: "medium",
              confidence: 0.82,
              main_symptoms: ["ERR-102 报警", "异常振动", "温升"],
              preliminary_conclusion: "振动与温升更接近联轴器松动和润滑异常的组合征兆。",
              next_steps: [
                "检查联轴器紧固状态",
                "复核轴承润滑回路",
              ],
              root_causes: [
                {
                  name: "联轴器松动",
                  confidence: 0.82,
                  evidence: "振动与温升同步出现",
                },
              ],
              evidence_items: [],
              evidence_count: 0,
              work_order_ready: false,
            },
            source_refs: [],
            execution_timeline: [
              {
                id: "evt-1",
                type: "connected",
                title: "SSE 连接建立",
                description: "已连接协作诊断流",
                time: "2026-05-11T08:00:05",
              },
              {
                id: "evt-2",
                type: "node_start",
                title: "知识检索",
                description: "正在检索相关知识",
                time: "2026-05-11T08:00:15",
              },
              {
                id: "evt-3",
                type: "report",
                title: "RAG 诊断报告生成",
                description: "建议先检查联轴器松动与轴承温升，随后复核润滑回路。",
                time: "2026-05-11T08:01:30",
              },
              {
                id: "evt-4",
                type: "done",
                title: "诊断任务完成",
                description: "已结束并回写任务状态",
                time: "2026-05-11T08:02:00",
              },
            ],
            steps: [],
          };

    await route.fulfill(jsonResponse(detail));
  });

  await page.route("**/api/v1/agents/assist/stream**", async (route) => {
    detailPhase = "completed";
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
      body: [
        'event: connected\ndata: {"status":"stream_started"}\n\n',
        'event: stage_start\ndata: {"title":"知识检索","message":"正在检索相关知识"}\n\n',
        'event: stage_finish\ndata: {"title":"知识检索","summary":"已命中候选知识"}\n\n',
        'event: report\ndata: {"report":"建议先检查联轴器松动与轴承温升，随后复核润滑回路。"}\n\n',
        'event: done\ndata: {"status":"stream_finished"}\n\n',
      ].join(""),
    });
  });

  await page.goto("/tasks");

  await page.getByPlaceholder("描述故障现象、报警代码、发生工况与已做检查").fill("压缩机 ERR-102 报警，伴随异常振动和温升");
  await page.getByPlaceholder("如：离心泵、压缩机").fill("压缩机");
  await page.getByPlaceholder("留空将自动生成").fill("CMP-102");

  await page.getByRole("button", { name: "开始智能诊断" }).click();

  await page.waitForURL(new RegExp(`/tasks/${taskId}`));
  await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}`));

  await expect(page.getByText("链路环节完成数")).toBeVisible();
  await expect(page.getByText("3/5")).toBeVisible();
  await expect(page.getByText("诊断已完成")).toBeVisible();
  await page.getByRole("button", { name: /诊断时间线/ }).click();
  await expect(page.getByText("诊断任务完成")).toBeVisible();
  await expect(page.getByText("待重新运行")).toHaveCount(0);
});

test("首次进入带 action=process 的详情页时不会停在待处理", async ({ page }) => {
  const pendingTaskId = 602;
  let streamRequestCount = 0;

  await page.route(`**/api/v1/tasks/${pendingTaskId}`, async (route) => {
    await route.fulfill(
      jsonResponse({
        id: pendingTaskId,
        title: "泵站异响诊断",
        equipment_type: "泵站",
        equipment_model: null,
        asset_code: "PMP-301",
        maintenance_level: "standard",
        symptom_description: "泵站启动后出现异响，伴随轻微抖动",
        status: "pending",
        workflow_completed: 1,
        workflow_total: 5,
        completed_steps: 0,
        total_steps: 0,
        created_at: "2026-05-11T09:00:00",
        updated_at: "2026-05-11T09:00:00",
        run_started_at: null,
        run_finished_at: null,
        diagnosis_report: null,
        diagnosis_structured: null,
        source_refs: [],
        execution_timeline: [],
        steps: [],
      }),
    );
  });

  await page.route("**/api/v1/agents/assist/stream**", async (route) => {
    streamRequestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
      body: [
        'event: connected\ndata: {"status":"stream_started"}\n\n',
        'event: stage_start\ndata: {"title":"知识检索","message":"正在检索相关知识"}\n\n',
      ].join(""),
    });
  });

  await page.goto(`/tasks/${pendingTaskId}?action=process`);

  await expect.poll(() => streamRequestCount).toBe(1);
  await expect(page).not.toHaveURL(/action=process/);
  await expect(page.getByText("诊断执行中")).toBeVisible();
  await expect(page.getByText("待重新运行")).toHaveCount(0);
  await page.getByRole("button", { name: /诊断时间线/ }).click();
  await expect(page.getByText("SSE 连接建立")).toBeVisible();
});

test("流式完成后以后端 in_progress 状态为准，不会本地显示为诊断完成", async ({ page }) => {
  const gatedTaskId = 703;
  let detailPhase: "pending" | "gated" = "pending";

  await page.route(`**/api/v1/tasks/${gatedTaskId}`, async (route) => {
    const detail =
      detailPhase === "pending"
        ? {
            id: gatedTaskId,
            title: "风机轴承异响诊断",
            equipment_type: "风机",
            equipment_model: null,
            asset_code: "FAN-703",
            maintenance_level: "standard",
            symptom_description: "风机轴承出现异响，伴随轻微温升",
            status: "pending",
            workflow_completed: 1,
            workflow_total: 5,
            completed_steps: 0,
            total_steps: 0,
            created_at: "2026-05-11T10:00:00",
            updated_at: "2026-05-11T10:00:00",
            run_started_at: null,
            run_finished_at: null,
            diagnosis_report: null,
            diagnosis_structured: null,
            source_refs: [],
            execution_timeline: [],
            steps: [],
          }
        : {
            id: gatedTaskId,
            title: "风机轴承异响诊断",
            equipment_type: "风机",
            equipment_model: null,
            asset_code: "FAN-703",
            maintenance_level: "standard",
            symptom_description: "风机轴承出现异响，伴随轻微温升",
            status: "in_progress",
            workflow_completed: 3,
            workflow_total: 5,
            completed_steps: 0,
            total_steps: 0,
            created_at: "2026-05-11T10:00:00",
            updated_at: "2026-05-11T10:02:00",
            run_started_at: "2026-05-11T10:00:05",
            run_finished_at: "2026-05-11T10:02:00",
            diagnosis_report: "建议先检查轴承润滑和联轴器对中情况。",
            diagnosis_structured: {
              answer_mode: "diagnosis",
              most_likely_fault: "轴承润滑不足",
              risk_level: "medium",
              confidence: 0.74,
              main_symptoms: ["轴承异响", "轻微温升"],
              preliminary_conclusion: "现有证据支持先排查润滑不足，但仍需后续规划或审核确认。",
              next_steps: ["检查轴承润滑状态", "复核联轴器对中情况"],
              root_causes: [
                {
                  name: "轴承润滑不足",
                  confidence: 0.74,
                  evidence: "异响与温升同时出现",
                },
              ],
              evidence_items: [],
              evidence_count: 0,
              work_order_ready: false,
            },
            source_refs: [],
            execution_timeline: [
              {
                id: "evt-1",
                type: "connected",
                title: "SSE 连接建立",
                description: "已连接协作诊断流",
                time: "2026-05-11T10:00:05",
              },
              {
                id: "evt-2",
                type: "report",
                title: "RAG 诊断报告生成",
                description: "建议先检查轴承润滑和联轴器对中情况。",
                time: "2026-05-11T10:01:20",
              },
              {
                id: "evt-3",
                type: "agent_pipeline_completed",
                title: "Agent 流水线完成",
                description: "planning.status=skipped; review.status=degraded",
                time: "2026-05-11T10:01:50",
              },
              {
                id: "evt-4",
                type: "done",
                title: "诊断任务完成",
                description: "已结束并回写任务状态",
                time: "2026-05-11T10:02:00",
              },
            ],
            steps: [],
          };

    await route.fulfill(jsonResponse(detail));
  });

  await page.route("**/api/v1/agents/assist/stream**", async (route) => {
    detailPhase = "gated";
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
      body: [
        'event: connected\ndata: {"status":"stream_started"}\n\n',
        'event: report\ndata: {"report":"建议先检查轴承润滑和联轴器对中情况。"}\n\n',
        'event: done\ndata: {"status":"stream_finished"}\n\n',
      ].join(""),
    });
  });

  await page.goto(`/tasks/${gatedTaskId}?action=process`);

  await expect(page.getByText("待收口").first()).toBeVisible();
  await expect(page.getByText("诊断结果已生成，但任务仍待规划、审核或人工确认后收口。")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成工单" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /重新运行/ })).toBeEnabled();
  await page.getByRole("button", { name: /诊断时间线/ }).click();
  await expect(page.getByText("Agent 流水线完成")).toBeVisible();
  await expect(page.getByText("planning.status=skipped; review.status=degraded")).toBeVisible();
  await expect(page.getByText("诊断已完成")).toHaveCount(0);
});

test("兜底生成的 preliminary_conclusion 不会拦截首次自动启动", async ({ page }) => {
  const fallbackTaskId = 603;
  let streamRequestCount = 0;

  await page.route(`**/api/v1/tasks/${fallbackTaskId}`, async (route) => {
    await route.fulfill(
      jsonResponse({
        id: fallbackTaskId,
        title: "凸轮轴拆装查询",
        equipment_type: "摩托车",
        equipment_model: null,
        asset_code: "MOTO-204",
        maintenance_level: "standard",
        symptom_description: "安装凸轮轴",
        status: "pending",
        workflow_completed: 1,
        workflow_total: 5,
        completed_steps: 0,
        total_steps: 0,
        created_at: "2026-05-11T09:00:00",
        updated_at: "2026-05-11T09:00:00",
        run_started_at: null,
        run_finished_at: null,
        diagnosis_report: null,
        diagnosis_structured: {
          answer_mode: "procedure",
          most_likely_fault: "安装凸轮轴",
          risk_level: "低风险",
          confidence: 61,
          main_symptoms: [],
          preliminary_conclusion: "该问题属于操作步骤查询。以下根据当前命中的手册片段整理“安装凸轮轴”的推荐顺序。",
          next_steps: [],
          root_causes: [],
          evidence_items: [],
          evidence_count: 0,
          work_order_ready: false,
        },
        source_refs: [],
        execution_timeline: [],
        steps: [],
      }),
    );
  });

  await page.route("**/api/v1/agents/assist/stream**", async (route) => {
    streamRequestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
      body: [
        'event: connected\ndata: {"status":"stream_started"}\n\n',
        'event: stage_start\ndata: {"title":"知识检索","message":"正在检索相关知识"}\n\n',
      ].join(""),
    });
  });

  await page.goto(`/tasks/${fallbackTaskId}?action=process`);

  await expect.poll(() => streamRequestCount).toBe(1);
  await expect(page).not.toHaveURL(/action=process/);
  await expect(page.getByText("诊断执行中")).toBeVisible();
  await expect(page.getByText("待重新运行")).toHaveCount(0);
});
