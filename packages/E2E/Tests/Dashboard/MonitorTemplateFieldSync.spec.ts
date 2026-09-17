import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import {
  buildUrl,
  createItem,
  getItem,
  getProjectDefaults,
  JSONish,
  ProjectDefaults,
  requestJson,
  toId,
} from "./Helpers/MonitorAlerting";
import {
  APIResponse,
  Browser,
  Locator,
  Page,
  TestInfo,
  expect,
  test,
} from "@playwright/test";
import ObjectID from "Common/Types/ObjectID";
import URL from "Common/Types/API/URL";

test.describe.configure({ mode: "serial" });

function firstStep(steps: JSONish): JSONish {
  return steps["value"]["monitorStepsInstanceArray"][0]["value"];
}

function buildSteps(defaults: ProjectDefaults, name: string): JSONish {
  return {
    _type: "MonitorSteps",
    value: {
      defaultMonitorStatusId: defaults.operationalMonitorStatusId,
      monitorStepsInstanceArray: [
        {
          _type: "MonitorStep",
          value: {
            id: ObjectID.generate().toString(),
            monitorDestination: URL.fromString(
              `https://${name}.example.com`,
            ).toJSON(),
            requestType: "GET",
            requestHeaders: { "X-Environment": name },
            requestBody: "",
            requestTimeoutInMs: 5000,
            retryCount: 0,
            monitorCriteria: {
              _type: "MonitorCriteria",
              value: {
                monitorCriteriaInstanceArray: [
                  {
                    _type: "MonitorCriteriaInstance",
                    value: {
                      id: ObjectID.generate().toString(),
                      name: "Shared availability criteria",
                      description: `Criteria for ${name}`,
                      filterCondition: "All",
                      filters: [{ checkOn: "Is Online", filterType: "True" }],
                      createIncidents: false,
                      createAlerts: false,
                      changeMonitorStatus: false,
                      incidents: [],
                      alerts: [],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  };
}

function criteriaDescription(step: JSONish): string {
  return step["monitorCriteria"]["value"]["monitorCriteriaInstanceArray"][0][
    "value"
  ]["description"];
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const path: string = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test.describe("Monitor template field sync settings", () => {
  let page: Page;
  let projectId: string;
  let templateId: string;
  let templateSteps: JSONish;
  let defaults: ProjectDefaults;
  const monitorIds: Array<string> = [];

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    projectId = await registerAndCreateProject({
      page,
      projectNamePrefix: "Template Sync Settings",
      email: `template-sync-${Date.now()}@example.test`,
      preferredPlanName: "Growth",
    });
    defaults = await getProjectDefaults({ page, projectId });
    templateSteps = buildSteps(defaults, "template-default");
    firstStep(templateSteps)["requestTimeoutInMs"] = 17000;
    const template: JSONish = await createItem({
      page,
      projectId,
      path: "/api/monitor-template",
      item: {
        projectId,
        templateName: "API availability checks",
        templateDescription:
          "Shared criteria with independent destinations and headers",
        monitorType: "API",
        monitorSteps: templateSteps,
        monitoringInterval: "*/10 * * * *",
        minimumProbeAgreement: 1,
      },
    });
    templateId = toId(template["_id"]);
    for (const name of ["production-api", "staging-api"]) {
      const monitor: JSONish = await createItem({
        page,
        projectId,
        path: "/api/monitor",
        item: {
          projectId,
          name,
          monitorType: "API",
          monitorTemplateId: templateId,
          monitorSteps: buildSteps(defaults, name),
          monitoringInterval: "*/5 * * * *",
          minimumProbeAgreement: 1,
        },
      });
      monitorIds.push(toId(monitor["_id"]));
    }
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test("saves field exclusions in the editor and preserves different monitor values during bulk criteria sync", async () => {
    await page.goto(
      buildUrl(
        `/dashboard/${projectId}/monitors/settings/templates/${templateId}`,
      ),
    );
    await page
      .getByRole("button", { name: "Edit Criteria", exact: true })
      .click();
    const modal: Locator = page.getByTestId("modal");
    await expect(modal).toBeVisible();
    const destination: Locator = modal.getByRole("checkbox", {
      name: "Monitor destination Do not sync this field",
      exact: true,
    });
    const headers: Locator = modal.getByRole("checkbox", {
      name: "Request headers Do not sync this field",
      exact: true,
    });
    await destination.waitFor({ state: "visible", timeout: 60000 });
    await expect(destination).not.toBeChecked();
    await expect(headers).not.toBeChecked();
    await destination.check();
    await headers.check();
    await capture(page, test.info(), "template-field-sync-editor");
    await page.getByTestId("modal-footer-submit-button").click();
    await expect(modal).toBeHidden();
    await page.reload();
    await expect(
      page
        .getByText(
          /These fields keep each monitor's current values during sync: Monitor destination, Request headers/,
        )
        .first(),
    ).toBeVisible();

    const saved: JSONish = await getItem({
      page,
      projectId,
      path: "/api/monitor-template",
      id: templateId,
      select: { monitorSteps: true },
    });
    templateSteps = saved["monitorSteps"];
    expect(firstStep(templateSteps)["doNotSyncFields"]).toEqual([
      "monitorDestination",
      "requestHeaders",
    ]);
    // Selections survive reopening the editor, not just its local state.
    await page
      .getByRole("button", { name: "Edit Criteria", exact: true })
      .click();
    await expect(destination).toBeChecked({ timeout: 60000 });
    await expect(headers).toBeChecked();
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(modal).toBeHidden();

    await page
      .getByRole("button", {
        name: /^Sync Criteria to (?:2 )?Linked Monitors$/,
      })
      .click();
    const syncDialog: Locator = page.getByRole("dialog", {
      name: "Sync Criteria to Linked Monitors",
      exact: true,
    });
    await expect(syncDialog).toBeVisible();
    await expect(syncDialog).toContainText(
      "Monitor destination, Request headers",
    );
    await capture(page, test.info(), "template-field-sync-confirmation");
    await syncDialog.getByTestId("modal-footer-submit-button").click();
    await expect(syncDialog).toBeHidden();
    const resultDialog: Locator = page.getByRole("dialog", {
      name: "Done",
      exact: true,
    });
    await expect(resultDialog).toContainText("Synced criteria onto 2 monitors");
    await resultDialog.getByRole("button", { name: "OK", exact: true }).click();
    await capture(page, test.info(), "template-field-sync-summary");

    for (const [index, name] of ["production-api", "staging-api"].entries()) {
      const monitor: JSONish = await getItem({
        page,
        projectId,
        path: "/api/monitor",
        id: monitorIds[index]!,
        select: { monitorSteps: true, monitoringInterval: true },
      });
      const step: JSONish = firstStep(monitor["monitorSteps"]);
      expect(step["monitorDestination"]["value"]).toBe(
        URL.fromString(`https://${name}.example.com`).toString(),
      );
      expect(step["requestHeaders"]).toEqual({ "X-Environment": name });
      expect(step["requestTimeoutInMs"]).toBe(17000);
      expect(criteriaDescription(step)).toBe("Criteria for template-default");
      expect(monitor["monitoringInterval"]).toBe("*/5 * * * *");
    }
  });

  test("individual sync preserves empty headers and new monitors still receive template defaults", async () => {
    const monitor: JSONish = await getItem({
      page,
      projectId,
      path: "/api/monitor",
      id: monitorIds[0]!,
      select: { monitorSteps: true },
    });
    const steps: JSONish = monitor["monitorSteps"];
    firstStep(steps)["requestHeaders"] = {};
    await requestJson({
      page,
      projectId,
      method: "put",
      path: `/api/monitor/${monitorIds[0]}`,
      body: { data: { monitorSteps: steps } },
    });
    await requestJson({
      page,
      projectId,
      path: `/api/monitor-template/${templateId}/sync-to-monitor/${monitorIds[0]}`,
      body: {},
    });
    const synced: JSONish = await getItem({
      page,
      projectId,
      path: "/api/monitor",
      id: monitorIds[0]!,
      select: { monitorSteps: true, monitoringInterval: true },
    });
    expect(firstStep(synced["monitorSteps"])["requestHeaders"]).toEqual({});
    expect(
      firstStep(synced["monitorSteps"])["monitorDestination"]["value"],
    ).toBe(URL.fromString("https://production-api.example.com").toString());
    expect(synced["monitoringInterval"]).toBe("*/10 * * * *");

    await page
      .getByRole("button", {
        name: "Create Monitor from Template",
        exact: true,
      })
      .click();
    const createForm: Locator = page.locator("#create-monitor-form");
    await expect(createForm).toBeVisible({ timeout: 30000 });
    await createForm
      .getByPlaceholder("Monitor Name")
      .fill("New API from defaults");
    const nextOrCreate: Locator = page.getByTestId("Create Monitor");
    await nextOrCreate.click();
    await page
      .getByText("Monitor Criteria", { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 60000 });
    await expect(createForm.getByRole("textbox").first()).toHaveValue(
      URL.fromString("https://template-default.example.com").toString(),
    );
    await expect(
      createForm.getByPlaceholder("Header Name").first(),
    ).toHaveValue("X-Environment");
    await expect(
      createForm.getByPlaceholder("Header Value").first(),
    ).toHaveValue("template-default");
    await capture(page, test.info(), "new-monitor-template-defaults");
    await nextOrCreate.click();
    await expect(
      createForm.getByText("Monitoring Interval", { exact: true }),
    ).toBeVisible();
    await nextOrCreate.click();
    await expect(nextOrCreate).toHaveText("Create Monitor");
    await nextOrCreate.click();
    const monitorViewPattern: RegExp = new RegExp(
      `/dashboard/${projectId}/monitors/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:/|$)`,
      "i",
    );
    await expect(page).toHaveURL(monitorViewPattern, { timeout: 60000 });
    const createdMonitorId: string = page.url().match(monitorViewPattern)![1]!;
    const newMonitor: JSONish = await getItem({
      page,
      projectId,
      path: "/api/monitor",
      id: createdMonitorId,
      select: {
        monitorSteps: true,
        monitorTemplateId: true,
        monitoringInterval: true,
      },
    });
    expect(toId(newMonitor["monitorTemplateId"])).toBe(templateId);
    expect(newMonitor["monitoringInterval"]).toBe("*/10 * * * *");
    expect(
      firstStep(newMonitor["monitorSteps"])["monitorDestination"]["value"],
    ).toBe(URL.fromString("https://template-default.example.com").toString());
    expect(firstStep(newMonitor["monitorSteps"])["requestHeaders"]).toEqual({
      "X-Environment": "template-default",
    });
  });

  test("rejects unsupported fields through the API without changing the saved template", async () => {
    for (const field of ["monitorCriteria", "databaseMonitor.connection"]) {
      const invalidSteps: JSONish = JSON.parse(JSON.stringify(templateSteps));
      firstStep(invalidSteps)["doNotSyncFields"] = [field];
      const response: APIResponse = await page.request.put(
        buildUrl(`/api/monitor-template/${templateId}`),
        {
          headers: { tenantid: projectId, projectid: projectId },
          data: { data: { monitorSteps: invalidSteps } },
        },
      );
      expect(response.status()).toBe(400);
    }
    const saved: JSONish = await getItem({
      page,
      projectId,
      path: "/api/monitor-template",
      id: templateId,
      select: { monitorSteps: true },
    });
    expect(firstStep(saved["monitorSteps"])["doNotSyncFields"]).toEqual([
      "monitorDestination",
      "requestHeaders",
    ]);
  });

  test("unchecking an exclusion restores sync for that field only", async () => {
    await page.goto(
      buildUrl(
        `/dashboard/${projectId}/monitors/settings/templates/${templateId}`,
      ),
    );
    await page
      .getByRole("button", { name: "Edit Criteria", exact: true })
      .click();
    const modal: Locator = page.getByTestId("modal");
    await modal
      .getByRole("checkbox", {
        name: "Request headers Do not sync this field",
        exact: true,
      })
      .uncheck();
    await page.getByTestId("modal-footer-submit-button").click();
    await expect(modal).toBeHidden();
    await requestJson({
      page,
      projectId,
      path: `/api/monitor-template/${templateId}/sync-to-monitor/${monitorIds[0]}`,
      body: { fields: ["monitorSteps"] },
    });
    const synced: JSONish = await getItem({
      page,
      projectId,
      path: "/api/monitor",
      id: monitorIds[0]!,
      select: { monitorSteps: true },
    });
    expect(
      firstStep(synced["monitorSteps"])["monitorDestination"]["value"],
    ).toBe(URL.fromString("https://production-api.example.com").toString());
    expect(firstStep(synced["monitorSteps"])["requestHeaders"]).toEqual({
      "X-Environment": "template-default",
    });
  });
});
