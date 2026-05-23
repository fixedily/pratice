import { expect, test, type Page, type Route } from "@playwright/test";

const taskId = 701;
const semanticTaskId = 702;
const fallbackTaskId = 703;

function jsonResponse(data: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "http://127.0.0.1:3000",
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "authorization,content-type",
    },
    body: JSON.stringify(data),
  };
}

async function mockShellApis(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("dachuang_maintenance_token", "task-detail-reasoning-token");
  });

  await page.route("**/api/v1/workbench/overview**", async (route: Route) => {
    await route.fulfill(
      jsonResponse({
        generated_at: "2026-05-17T10:00:00",
        stats: [],
        featured_queries: [],
        agent_capabilities: [],
        recommended_knowledge_count: 0,
        recommended_knowledge: [],
        recent_tasks: [],
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
        id: 11,
        username: "reasoning_tester",
        display_name: "推理测试员",
        roles: ["expert"],
      }),
    );
  });
}

async function mockTaskDetailApi(page: Page) {
  await page.route(`**/api/v1/tasks/${taskId}`, async (route: Route) => {
    await route.fulfill(
      jsonResponse({
        id: taskId,
        title: "火花塞积炭诊断",
        equipment_type: "摩托车发动机",
        equipment_model: "125cc",
        maintenance_level: "standard",
        fault_type: "火花塞积炭",
        symptom_description: "火花塞积炭导致点火困难",
        status: "completed",
        workflow_total: 5,
        workflow_completed: 5,
        total_steps: 0,
        completed_steps: 0,
        advice_card: null,
        created_at: "2026-05-17T09:00:00",
        updated_at: "2026-05-17T09:05:00",
        run_started_at: "2026-05-17T09:00:10",
        run_finished_at: "2026-05-17T09:05:00",
        diagnosis_report: "建议先拆卸火花塞并检查积炭，再复核点火线圈。",
        diagnosis_structured: {
          answer_mode: "diagnosis",
          most_likely_fault: "火花塞积炭",
          risk_level: "medium",
          confidence: 0.82,
          main_symptoms: ["点火困难", "冷启动失败"],
          preliminary_conclusion: "火花塞积炭与点火线圈状态需要联合排查。",
          next_steps: [
            {
              step_no: 1,
              title: "准备工具和清洁",
              summary: "确保火花塞孔及其周围没有灰尘，防止异物掉入气缸。",
              action: "清洁",
              object: "火花塞孔",
              headline: "清理周边灰尘",
              detail: "确保火花塞孔及其周围没有灰尘，防止异物掉入气缸。",
              sections: [
                {
                  label: "操作要点",
                  items: ["检查火花塞孔周围是否有灰尘或杂物", "使用压缩空气或清洁布清理火花塞孔周围区域"],
                },
              ],
              meta: ["参考依据：[C3]"],
              raw_text: "准备工具和清洁，确保火花塞孔及其周围没有灰尘，防止异物掉入气缸。",
            },
            {
              step_no: 2,
              title: "拔出高压帽",
              summary: "使用尖嘴钳小心拔出高压帽，避免损坏高压线或火花塞。",
              action: "检查",
              object: "点火线圈",
              headline: "测阻值并复核接线",
              detail: "同步测量点火线圈阻值，并复核高压线接线状态。",
              sections: [
                {
                  label: "操作要点",
                  items: ["用尖嘴钳夹住高压帽根部", "垂直向上拔出，避免左右摇晃"],
                },
              ],
              meta: ["参考依据：[C2]"],
              raw_text: "拔出高压帽，使用尖嘴钳小心拔出高压帽，避免损坏高压线或火花塞。",
            },
            {
              step_no: 3,
              title: "拆卸火花塞",
              summary: "使用火花塞专用套筒逆时针转动拆下火花塞。",
              action: "拆卸",
              object: "火花塞",
              headline: "专用套筒逆时针松脱",
              detail: "先清洁火花塞孔，再使用火花塞专用套筒逆时针转动拆下火花塞。",
              sections: [
                {
                  label: "操作要点",
                  items: ["选用合适尺寸的火花塞专用套筒", "逆时针转动火花塞将其拆下", "注意力度均匀，避免滑丝"],
                },
              ],
              meta: ["参考依据：[C2]", "依据：摩托车发动机维修手册 > 火花塞 > 1.1 拆卸火花塞"],
              raw_text: "拆卸火花塞，使用火花塞专用套筒逆时针转动拆下火花塞。",
            },
          ],
          root_causes: [
            {
              name: "火花塞积炭",
              confidence: 0.82,
              evidence: "火花塞通过 component_requires_action 指向拆卸检查。",
            },
          ],
          evidence_items: [],
          evidence_count: 2,
          top_similarity: 0.91,
          work_order_ready: false,
        },
        reasoning_chain: {
          question: "火花塞积炭导致点火困难时应该先检查什么？",
          matched_entities: [
            {
              id: 1,
              entity_type: "maintenance_action",
              canonical_name: "拆卸",
              match_score: 1,
            },
            {
              id: 4,
              entity_type: "component",
              canonical_name: "火花塞",
              match_score: 0.96,
            },
          ],
          expanded_relations: [
            {
              id: 1,
              relation_type: "component_requires_action",
              source_entity_id: 4,
              source_name: "火花塞",
              target_entity_id: 2,
              target_name: "拆卸检查",
              confidence: 0.72,
              evidence_chunk_ids: [1608, 1609],
            },
            {
              id: 2,
              relation_type: "component_related_to_component",
              source_entity_id: 4,
              source_name: "火花塞",
              target_entity_id: 7,
              target_name: "点火线圈",
              confidence: 0.64,
              evidence_chunk_ids: [1610],
            },
            {
              id: 3,
              relation_type: "component_requires_action",
              source_entity_id: 4,
              source_name: "火花塞",
              target_entity_id: 8,
              target_name: "更换",
              confidence: 0.61,
              evidence_chunk_ids: [1609],
            },
            {
              id: 4,
              relation_type: "component_requires_action",
              source_entity_id: 4,
              source_name: "火花塞",
              target_entity_id: 9,
              target_name: "拆卸",
              confidence: 0.58,
              evidence_chunk_ids: [],
            },
          ],
          evidence_chunks: [
            {
              chunk_id: 1608,
              title: "摩托车发动机维修手册",
              citation_label: "C3",
              section_reference: "1.1 拆卸火花塞",
              page_reference: "P2",
              excerpt: "拆卸火花塞前确保周围无灰尘，并检查积炭情况。",
              score: 0.91,
            },
            {
              chunk_id: 1609,
              title: "点火系统检查规范",
              citation_label: "C7",
              section_reference: "2.4 火花塞状态",
              page_reference: "P6",
              excerpt: "若火花塞积炭严重，应同步排查混合气与点火线圈状态。",
              score: 0.88,
            },
            {
              chunk_id: 1610,
              title: "点火系统检查规范",
              citation_label: "C8",
              section_reference: "3.1 点火线圈复核",
              page_reference: "P9",
              excerpt: "点火线圈阻值异常会放大火花塞积炭带来的点火困难。",
              score: 0.84,
            },
          ],
          selected_answer_claims: ["火花塞需要先拆卸检查，并关联复核点火线圈。"],
          warnings: ["点火高压风险提示：当前建议涉及点火线圈、高压帽或火花塞，拆检时需要防止高压残留和误启动。"],
          safety_warnings: [
            {
              code: "IGNITION_HIGH_VOLTAGE_RISK",
              level: "warning",
              title: "点火高压风险提示",
              message: "当前建议涉及点火线圈、高压帽或火花塞，拆检时需要防止高压残留和误启动。",
              source: "rule",
              matched_terms: ["火花塞", "点火线圈"],
              relation_ids: [1, 2],
              evidence_chunk_ids: [1608, 1610],
              recommendation: "确认已熄火断电，拔插高压帽时使用绝缘工具并避免拉扯高压线。",
            },
          ],
          confidence: 0.82,
        },
        source_refs: [
          {
            chunk_id: 1608,
            document_id: 31,
            title: "摩托车发动机维修手册",
            source_name: "维修手册",
            section_reference: "1.1 拆卸火花塞",
            section_path: "火花塞 > 拆卸 > 1.1 拆卸火花塞",
            page_reference: "P2",
            citation_label: "C3",
            source_modality: "text",
            excerpt: "拆卸火花塞前确保周围无灰尘，并检查积炭情况。",
            expanded_content: "拆卸火花塞前确保周围无灰尘，并检查积炭情况。若发现积炭，应同步记录点火状态并准备后续复核。",
            recommendation_reason: "语义检索 + 关键词匹配",
            retrieval_path: ["sql", "vector"],
            retrieval_score: 0.91,
            rerank_score: 0.91,
          },
          {
            chunk_id: 1610,
            document_id: 36,
            title: "点火系统检查规范",
            source_name: "点火规范",
            section_reference: "3.1 点火线圈复核",
            page_reference: "P9",
            step_anchor: "2",
            citation_label: "C8",
            source_modality: "text",
            excerpt: "点火线圈阻值异常会放大火花塞积炭带来的点火困难。",
            recommendation_reason: "语义图谱关联：火花塞关联点火线圈复核",
            graph_relation_type: "component_related_to_component",
            retrieval_path: ["graph_expand", "semantic_graph_evidence"],
            retrieval_score: 0.84,
            rerank_score: 0.84,
          },
        ],
        execution_timeline: [
          {
            id: "evt-1",
            type: "done",
            title: "诊断任务完成",
            description: "已完成知识检索与推理链整理。",
            time: "2026-05-17T09:05:00",
          },
        ],
        steps: [],
      }),
    );
  });
}

async function mockSemanticTaskDetailApi(page: Page) {
  await page.route(`**/api/v1/tasks/${semanticTaskId}`, async (route: Route) => {
    await route.fulfill(
      jsonResponse({
        id: semanticTaskId,
        title: "火花塞与点火线圈联检",
        equipment_type: "摩托车发动机",
        equipment_model: "125cc",
        maintenance_level: "standard",
        fault_type: "点火困难",
        symptom_description: "点火困难时如何联检火花塞和点火线圈",
        status: "completed",
        workflow_total: 5,
        workflow_completed: 5,
        total_steps: 0,
        completed_steps: 0,
        advice_card: null,
        created_at: "2026-05-18T09:00:00",
        updated_at: "2026-05-18T09:05:00",
        run_started_at: "2026-05-18T09:00:10",
        run_finished_at: "2026-05-18T09:05:00",
        diagnosis_report: "建议同步复核点火线圈和火花塞状态。",
        diagnosis_structured: {
          answer_mode: "diagnosis",
          most_likely_fault: "点火线圈接线异常",
          risk_level: "medium",
          confidence: 0.79,
          main_symptoms: ["点火困难", "高压火弱"],
          preliminary_conclusion: "点火线圈阻值与火花塞状态都需要同步复核。",
          next_steps: [
            {
              step_no: 1,
              title: "拔出高压帽",
              summary: "拆开连接后测量阻值并复核点火线圈接线状态。",
              action: "检查",
              object: "点火线圈",
              headline: "测阻值并复核接线",
              detail: "拔出高压帽后，测量点火线圈阻值，并确认高压线接线没有松脱或氧化。",
              sections: [
                {
                  label: "操作要点",
                  items: ["拔出高压帽后观察接头氧化情况", "按规范测量一次线圈和二次线圈阻值"],
                },
              ],
              meta: ["参考依据：[C11]"],
              raw_text: "拔出高压帽后，测量点火线圈阻值，并确认高压线接线没有松脱或氧化。",
            },
            {
              step_no: 2,
              title: "拆卸火花塞",
              summary: "使用专用套筒逆时针转动拆下火花塞。",
              action: "拆卸",
              object: "火花塞",
              headline: "专用套筒逆时针松脱",
              detail: "选用合适尺寸的火花塞专用套筒，逆时针松脱并取下火花塞。",
              sections: [
                {
                  label: "操作要点",
                  items: ["拆卸前清理火花塞孔周围杂质", "逆时针匀速松脱，避免滑丝"],
                },
              ],
              meta: ["参考依据：[C12]"],
              raw_text: "使用专用套筒逆时针转动拆下火花塞。",
            },
          ],
          root_causes: [],
          evidence_items: [],
          evidence_count: 2,
          top_similarity: 0.9,
          work_order_ready: false,
        },
        reasoning_chain: {
          question: "点火困难时应如何复核点火线圈并拆卸火花塞？",
          matched_entities: [
            {
              id: 21,
              entity_type: "component",
              canonical_name: "点火线圈",
              match_score: 0.98,
            },
            {
              id: 22,
              entity_type: "component",
              canonical_name: "火花塞",
              match_score: 0.96,
            },
          ],
          expanded_relations: [
            {
              id: 11,
              relation_type: "action_targets_component",
              source_entity_id: 31,
              source_name: "检查",
              target_entity_id: 21,
              target_name: "点火线圈",
              confidence: 0.79,
              evidence_chunk_ids: [1701],
            },
            {
              id: 12,
              relation_type: "component_requires_action",
              source_entity_id: 22,
              source_name: "火花塞",
              target_entity_id: 32,
              target_name: "拆卸",
              confidence: 0.77,
              evidence_chunk_ids: [1702],
            },
          ],
          evidence_chunks: [
            {
              chunk_id: 1701,
              title: "点火系统检查规范",
              citation_label: "C11",
              section_reference: "3.1 点火线圈复核",
              page_reference: "P9",
              excerpt: "拔出高压帽后应测量点火线圈阻值，并复核接线是否牢靠。",
              score: 0.89,
            },
            {
              chunk_id: 1702,
              title: "摩托车发动机维修手册",
              citation_label: "C12",
              section_reference: "1.1 拆卸火花塞",
              page_reference: "P2",
              excerpt: "应使用火花塞专用套筒逆时针松脱火花塞，避免滑丝。",
              score: 0.87,
            },
          ],
          selected_answer_claims: ["应先复核点火线圈阻值与接线，再拆卸火花塞检查状态。"],
          warnings: [],
          confidence: 0.79,
        },
        source_refs: [],
        execution_timeline: [],
        steps: [],
      }),
    );
  });
}

async function mockFallbackTaskDetailApi(page: Page) {
  await page.route(`**/api/v1/tasks/${fallbackTaskId}`, async (route: Route) => {
    await route.fulfill(
      jsonResponse({
        id: fallbackTaskId,
        title: "火花塞拆卸准备",
        equipment_type: "摩托车发动机",
        equipment_model: "125cc",
        maintenance_level: "standard",
        fault_type: "火花塞拆卸",
        symptom_description: "如何拆卸火花塞",
        status: "completed",
        workflow_total: 5,
        workflow_completed: 5,
        total_steps: 0,
        completed_steps: 0,
        advice_card: null,
        created_at: "2026-05-19T09:00:00",
        updated_at: "2026-05-19T09:04:00",
        run_started_at: "2026-05-19T09:00:10",
        run_finished_at: "2026-05-19T09:04:00",
        diagnosis_report: "拆卸火花塞前需先清洁周边并拔出高压帽。",
        diagnosis_structured: {
          answer_mode: "diagnosis",
          most_likely_fault: "火花塞拆卸流程",
          risk_level: "low",
          confidence: 0.72,
          main_symptoms: ["拆卸操作确认"],
          preliminary_conclusion: "拆卸前准备、拔出高压帽和正式拆卸应按顺序执行。",
          next_steps: [
            {
              step_no: 1,
              title: "准备工具与清洁",
              summary: "确保工具齐全，并清洁火花塞孔周围，防止灰尘进入气缸。",
              action: "清洁",
              object: "火花塞孔周围",
              headline: "准备工具与清洁",
              detail: "确认火花塞专用套筒、尖嘴钳和清洁布齐全，并清洁火花塞孔周围。",
              sections: [],
              meta: ["依据[C3]"],
              raw_text: "确保工具齐全，并清洁火花塞孔周围，防止灰尘进入气缸。",
            },
            {
              step_no: 2,
              title: "拔出高压帽",
              summary: "使用尖嘴钳小心拔出高压帽，避免损坏导线。",
              action: "拔出",
              object: "高压帽",
              headline: "拔出高压帽",
              detail: "使用尖嘴钳夹住高压帽根部，垂直向上拔出高压帽。",
              sections: [],
              meta: ["依据[C2]"],
              raw_text: "使用尖嘴钳小心拔出高压帽，避免损坏导线。",
            },
            {
              step_no: 3,
              title: "拆卸火花塞",
              summary: "用火花塞专用套筒逆时针转动火花塞，将其拆下。",
              action: "拆卸",
              object: "火花塞",
              headline: "拆卸火花塞",
              detail: "使用火花塞专用套筒逆时针转动火花塞，将其拆下。",
              sections: [],
              meta: ["依据[C1]"],
              raw_text: "用火花塞专用套筒逆时针转动火花塞，将其拆下。",
            },
          ],
          root_causes: [],
          evidence_items: [],
          evidence_count: 3,
          top_similarity: 0.88,
          work_order_ready: false,
        },
        reasoning_chain: {
          question: "如何拆卸火花塞？",
          matched_entities: [
            {
              id: 41,
              entity_type: "component",
              canonical_name: "火花塞",
              match_score: 1,
            },
          ],
          expanded_relations: [
            {
              id: 21,
              relation_type: "component_requires_action",
              source_entity_id: 41,
              source_name: "火花塞",
              target_entity_id: 51,
              target_name: "拆卸",
              confidence: 0.72,
              evidence_chunk_ids: [],
            },
            {
              id: 22,
              relation_type: "component_requires_action",
              source_entity_id: 41,
              source_name: "火花塞",
              target_entity_id: 52,
              target_name: "拆卸",
              confidence: 0.69,
              evidence_chunk_ids: [],
            },
            {
              id: 23,
              relation_type: "component_requires_action",
              source_entity_id: 41,
              source_name: "火花塞",
              target_entity_id: 53,
              target_name: "拆卸",
              confidence: 0.68,
              evidence_chunk_ids: [1801],
            },
          ],
          evidence_chunks: [
            {
              chunk_id: 1801,
              title: "摩托车发动机维修手册",
              citation_label: "C1",
              section_reference: "1.1 拆卸火花塞",
              page_reference: "P2",
              excerpt: "用火花塞专用套筒逆时针转动火花塞，将其拆下。",
              score: 0.91,
            },
            {
              chunk_id: 1802,
              title: "摩托车发动机维修手册",
              citation_label: "C2",
              section_reference: "1.1 拆卸火花塞",
              page_reference: "P2",
              excerpt: "使用尖嘴钳小心拔出高压帽，避免损坏导线。",
              score: 0.89,
            },
            {
              chunk_id: 1803,
              title: "摩托车发动机维修手册",
              citation_label: "C3",
              section_reference: "1.1 拆卸火花塞",
              page_reference: "P2",
              excerpt: "拆卸火花塞前应清洁火花塞孔周围，防止灰尘进入气缸。",
              score: 0.87,
            },
          ],
          selected_answer_claims: ["拆卸火花塞前需先清洁周边并拔出高压帽。"],
          warnings: [],
          confidence: 0.72,
        },
        source_refs: [],
        execution_timeline: [],
        steps: [],
      }),
    );
  });
}

async function openReasoningTab(
  page: Page,
  options?: { taskId?: number; mockTaskDetail?: (page: Page) => Promise<void> },
) {
  await mockShellApis(page);
  await (options?.mockTaskDetail ?? mockTaskDetailApi)(page);
  await page.goto(`/tasks/${options?.taskId ?? taskId}`);
  await page.getByRole("button", { name: /推理子图/ }).click();
}

async function openEvidenceTab(
  page: Page,
  options?: { taskId?: number; mockTaskDetail?: (page: Page) => Promise<void> },
) {
  await mockShellApis(page);
  await (options?.mockTaskDetail ?? mockTaskDetailApi)(page);
  await page.goto(`/tasks/${options?.taskId ?? taskId}`);
  await page.getByRole("button", { name: /关键证据来源/ }).click();
}

test("task detail shows the redesigned reasoning path with attached evidence inspector", async ({ page }) => {
  await openReasoningTab(page);

  await expect(page.getByText("主推理子图")).toBeVisible();
  await expect(page.getByTestId("reasoning-graph-canvas")).toBeVisible();
  await expect(page.getByTestId("reasoning-evidence-inspector")).toHaveCount(0);
  await expect(page.getByText("火花塞需要先拆卸检查，并关联复核点火线圈。")).toBeVisible();
  await expect(page.getByTestId("reasoning-graph-question")).toContainText("火花塞积炭导致点火困难时应该先检查什么");
  await expect(page.getByTestId("reasoning-graph-entity")).toContainText("火花塞");
  await expect(page.getByTestId("reasoning-graph-target-fallback-step-reasoning-step-1")).toContainText("准备工具和清洁");
  await expect(page.getByTestId("reasoning-graph-target-fallback-step-reasoning-step-1")).toContainText("来源 C3");
  await expect(page.getByTestId("reasoning-graph-target-fallback-step-reasoning-step-2")).toContainText("拔出高压帽");
  await expect(page.getByTestId("reasoning-graph-target-fallback-step-reasoning-step-2")).toContainText("来源 C8");
  await expect(page.getByTestId("reasoning-graph-target-relation-1")).toContainText("拆卸火花塞");
  await expect(page.getByTestId("reasoning-graph-target-relation-1")).toContainText("对象 火花塞");
  await expect(page.getByTestId("reasoning-graph-target-relation-1")).toContainText("来源 C3");
  await expect(page.getByTestId("reasoning-graph-target-relation-3")).toHaveCount(0);
  await expect(page.getByTestId("reasoning-graph-target-relation-4")).toHaveCount(0);
  await expect(page.getByText("拆卸火花塞前确保周围无灰尘，并检查积炭情况。")).toHaveCount(0);
  await expect(page.getByText("结论依据")).toHaveCount(0);
  await expect(page.getByTestId("reasoning-safety-warnings")).toBeVisible();
  await expect(page.getByTestId("reasoning-safety-warnings")).toContainText("点火高压风险提示");
  await expect(page.getByTestId("reasoning-safety-warnings")).toContainText("确认已熄火断电");

  await page.getByTestId("reasoning-graph-entity").click();

  await expect(page.getByTestId("reasoning-evidence-inspector")).toHaveCount(0);

  await page.getByTestId("reasoning-graph-target-relation-1").click();

  await expect(page.getByTestId("reasoning-evidence-inspector")).toBeVisible();
  await expect(page.getByTestId("reasoning-procedure-detail")).toContainText("操作步骤 3");
  await expect(page.getByTestId("reasoning-procedure-detail")).toContainText("先清洁火花塞孔，再使用火花塞专用套筒逆时针转动拆下火花塞。");
  await expect(page.getByTestId("reasoning-procedure-detail")).toContainText("操作要点");
  await expect(page.getByTestId("reasoning-procedure-detail")).toContainText("逆时针转动火花塞将其拆下");
  await expect(page.getByText("拆卸火花塞前确保周围无灰尘，并检查积炭情况。")).toBeVisible();
  await expect(page.getByRole("button", { name: /C7/ })).toBeVisible();

  await page.getByRole("button", { name: /C7/ }).click();

  await expect(page.getByText("若火花塞积炭严重，应同步排查混合气与点火线圈状态。")).toBeVisible();
  await expect(page.getByText("拆卸火花塞前确保周围无灰尘，并检查积炭情况。")).toHaveCount(0);

  await page.getByTestId("reasoning-graph-question").click();

  await expect(page.getByTestId("reasoning-evidence-inspector")).toHaveCount(0);
});

test("task detail groups evidence into direct hits and related recommendations with a detail sheet", async ({ page }) => {
  await openEvidenceTab(page);

  await expect(page.getByTestId("task-evidence-group-direct")).toBeVisible();
  await expect(page.getByTestId("task-evidence-group-direct")).toContainText("直接命中");
  await expect(page.getByTestId("task-evidence-group-direct")).toContainText("关键词命中");
  await expect(page.getByTestId("task-evidence-group-related")).toBeVisible();
  await expect(page.getByTestId("task-evidence-group-related")).toContainText("关联推荐");
  await expect(page.getByTestId("task-evidence-group-related")).toContainText("语义图谱关联");
  await expect(page.getByTestId("task-evidence-card-36-1610")).toContainText("点火系统检查规范");

  await page.getByTestId("task-evidence-open-36-1610").click();

  await expect(page.getByTestId("task-evidence-detail-sheet")).toBeVisible();
  await expect(page.getByTestId("task-evidence-detail-sheet")).toContainText("为什么推荐");
  await expect(page.getByTestId("task-evidence-detail-sheet")).toContainText("火花塞关联部件点火线圈");
  await expect(page.getByTestId("task-evidence-detail-sheet")).toContainText("定位到原文");
  await expect(page.getByTestId("task-evidence-detail-sheet")).toContainText("步骤 2");
});

test("task detail keeps the reasoning subgraph usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReasoningTab(page);

  await expect(page.getByTestId("reasoning-graph-mobile")).toBeVisible();
  await expect(page.getByTestId("reasoning-evidence-inspector")).toHaveCount(0);
  await expect(page.getByTestId("reasoning-graph-target-mobile-fallback-step-reasoning-step-1")).toContainText("准备工具和清洁");
  await expect(page.getByTestId("reasoning-graph-target-mobile-fallback-step-reasoning-step-2")).toContainText("拔出高压帽");
  await expect(page.getByTestId("reasoning-graph-target-mobile-relation-1")).toContainText("拆卸火花塞");
  await expect(page.getByTestId("reasoning-graph-target-mobile-relation-1")).toContainText("来源 C3");
  await expect(page.getByTestId("reasoning-graph-target-mobile-relation-3")).toHaveCount(0);

  await page.getByTestId("reasoning-graph-target-mobile-fallback-step-reasoning-step-2").click();

  await expect(page.getByTestId("reasoning-evidence-inspector")).toBeVisible();
  await expect(page.getByText("点火线圈阻值异常会放大火花塞积炭带来的点火困难。")).toBeVisible();
});

test("task detail matches action relations to procedure steps through semantic fields", async ({ page }) => {
  await openReasoningTab(page, { taskId: semanticTaskId, mockTaskDetail: mockSemanticTaskDetailApi });

  await expect(page.getByTestId("reasoning-graph-relation-relation-11")).toContainText("检查");
  await expect(page.getByTestId("reasoning-graph-target-relation-11")).toContainText("测阻值并复核接线");
  await expect(page.getByTestId("reasoning-graph-target-relation-11")).toContainText("操作步骤 1");
  await expect(page.getByTestId("reasoning-graph-target-relation-11")).toContainText("对象 点火线圈");
  await expect(page.getByTestId("reasoning-graph-target-relation-12")).toContainText("专用套筒逆时针松脱");
  await expect(page.getByTestId("reasoning-graph-target-relation-12")).toContainText("对象 火花塞");

  await page.getByTestId("reasoning-graph-target-relation-11").click();

  await expect(page.getByTestId("reasoning-procedure-detail")).toContainText("操作步骤 1");
  await expect(page.getByTestId("reasoning-procedure-detail")).toContainText(
    "拔出高压帽后，测量点火线圈阻值，并确认高压线接线没有松脱或氧化。",
  );
  await expect(page.getByText("拔出高压帽后应测量点火线圈阻值，并复核接线是否牢靠。")).toBeVisible();
});

test("task detail fills unmatched procedure steps with cited fallback nodes", async ({ page }) => {
  await openReasoningTab(page, { taskId: fallbackTaskId, mockTaskDetail: mockFallbackTaskDetailApi });

  await expect(page.getByTestId("reasoning-graph-target-fallback-step-reasoning-step-1")).toContainText("准备工具与清洁");
  await expect(page.getByTestId("reasoning-graph-target-fallback-step-reasoning-step-1")).toContainText("证据 C3");
  await expect(page.getByTestId("reasoning-graph-target-fallback-step-reasoning-step-2")).toContainText("拔出高压帽");
  await expect(page.getByTestId("reasoning-graph-target-fallback-step-reasoning-step-2")).toContainText("证据 C2");
  await expect(page.getByTestId("reasoning-graph-target-relation-23")).toContainText("拆卸火花塞");
  await expect(page.getByTestId("reasoning-graph-target-relation-23")).toContainText("证据 C1");
  await expect(page.getByTestId("reasoning-graph-target-relation-21")).toHaveCount(0);
  await expect(page.getByTestId("reasoning-graph-target-relation-22")).toHaveCount(0);

  await page.getByTestId("reasoning-graph-target-fallback-step-reasoning-step-1").click();

  await expect(page.getByText("拆卸火花塞前应清洁火花塞孔周围，防止灰尘进入气缸。")).toBeVisible();
});

test("task detail switches to the compact reasoning graph before desktop width becomes cramped", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await openReasoningTab(page);

  await expect(page.getByTestId("reasoning-graph-mobile")).toBeVisible();
  await expect(page.getByTestId("reasoning-graph-canvas")).toBeHidden();
  await expect(page.getByTestId("reasoning-graph-target-mobile-relation-1")).toContainText("专用套筒逆时针松脱");
});

test("task detail spreads the desktop reasoning graph across wide canvases", async ({ page }) => {
  await page.setViewportSize({ width: 1720, height: 900 });
  await openReasoningTab(page);

  const canvas = page.getByTestId("reasoning-graph-canvas");
  const scrollContainer = page.getByTestId("reasoning-graph-desktop-scroll");
  const entity = page.getByTestId("reasoning-graph-entity");
  const relation = page.getByTestId("reasoning-graph-relation-relation-1");
  const target = page.getByTestId("reasoning-graph-target-relation-1");

  await expect(canvas).toBeVisible();

  const [canvasBox, scrollBox, entityBox, relationBox, targetBox] = await Promise.all([
    canvas.boundingBox(),
    scrollContainer.boundingBox(),
    entity.boundingBox(),
    relation.boundingBox(),
    target.boundingBox(),
  ]);

  expect(canvasBox).not.toBeNull();
  expect(scrollBox).not.toBeNull();
  expect(entityBox).not.toBeNull();
  expect(relationBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  expect((canvasBox?.width ?? 0) >= (scrollBox?.width ?? 0) * 0.72).toBeTruthy();
  expect((relationBox?.x ?? 0) > (entityBox?.x ?? 0) + (entityBox?.width ?? 0) + 56).toBeTruthy();
  expect((targetBox?.x ?? 0) > (relationBox?.x ?? 0) + (relationBox?.width ?? 0) + 96).toBeTruthy();
  expect((targetBox?.x ?? 0) > (canvasBox?.x ?? 0) + (canvasBox?.width ?? 0) * 0.52).toBeTruthy();
  expect((targetBox?.x ?? 0) + (targetBox?.width ?? 0) < (canvasBox?.x ?? 0) + (canvasBox?.width ?? 0) - 16).toBeTruthy();
});
