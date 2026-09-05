import {
  buildHttpMonitorSteps,
  buildUrl,
  createItem,
  getItem,
  getProjectDefaults,
  JSONish,
  newMonitorStepIds,
  ProjectDefaults,
  requestJson,
  toId,
} from "./Helpers/MonitorAlerting";
import { createMonitor } from "./Helpers/Monitors";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import {
  Browser,
  Locator,
  Page,
  TestInfo,
  expect,
  test,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

/*
 * Exercises the actual monitor editor, authenticated API, and persistence.
 * Each test gets a new monitor so a failure cannot contaminate a later case.
 * Existing monitors are disabled to keep this editor suite independent of
 * probe scheduling. The create case uses the full public creation wizard.
 */
test.describe.configure({ mode: "default" });

interface EditorContext {
  page: Page;
  projectId: string;
  monitorId: string;
  defaults: ProjectDefaults;
}

interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Unwrap the API's typed values without importing the database model graph.
const unwrap: (value: any) => any = (value: any): any => {
  if (Array.isArray(value)) {
    return value.map(unwrap);
  }
  if (value && typeof value === "object") {
    if (
      value["_type"] &&
      Object.prototype.hasOwnProperty.call(value, "value")
    ) {
      return unwrap(value["value"]);
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, child]: [string, unknown]) => {
        return [key, unwrap(child)];
      }),
    );
  }
  return value;
};

const getSteps: (ctx: EditorContext) => Promise<JSONish> = async (
  ctx: EditorContext,
): Promise<JSONish> => {
  const monitor: JSONish = await getItem({
    page: ctx.page,
    projectId: ctx.projectId,
    path: "/api/monitor",
    id: ctx.monitorId,
    select: { monitorSteps: true },
  });
  return unwrap(monitor["monitorSteps"]);
};

const firstStep: (steps: JSONish) => JSONish = (steps: JSONish): JSONish => {
  return steps["monitorStepsInstanceArray"][0];
};

const rules: (steps: JSONish) => Array<JSONish> = (
  steps: JSONish,
): Array<JSONish> => {
  return firstStep(steps)["monitorCriteria"]["monitorCriteriaInstanceArray"];
};

const editor: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("modal");
};

const destinationInput: (scope: Locator) => Locator = (
  scope: Locator,
): Locator => {
  return scope.getByRole("textbox", { name: /^(Website URL|API URL|URL)$/ });
};

const openEditor: (ctx: EditorContext) => Promise<void> = async (
  ctx: EditorContext,
): Promise<void> => {
  const url: string = buildUrl(
    `/dashboard/${ctx.projectId}/monitors/${ctx.monitorId}/criteria`,
  );
  const editButton: Locator = ctx.page.getByRole("button", {
    name: "Edit Monitoring Criteria",
  });
  if (ctx.page.url() !== url || !(await editButton.isVisible())) {
    await gotoProjectPage({
      page: ctx.page,
      projectId: ctx.projectId,
      url,
      ready: editButton,
    });
  }
  await editButton.click();
  await expect(
    editor(ctx.page).getByText("Alert rules", { exact: true }),
  ).toBeVisible({
    timeout: 60000,
  });
};

const saveEditor: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await editor(page).getByTestId("modal-footer-submit-button").click();
  await expect(editor(page)).toBeHidden({ timeout: 60000 });
};

const openRule: (page: Page, name: string) => Promise<void> = async (
  page: Page,
  name: string,
): Promise<void> => {
  await editor(page)
    .getByRole("button", { name: `Edit rule: ${name}`, exact: true })
    .click();
  await expect(
    editor(page).getByRole("textbox", { name: "Rule name", exact: true }),
  ).toHaveValue(name);
};

const choose: (
  page: Page,
  name: string,
  option: string,
  index?: number,
) => Promise<void> = async (
  page: Page,
  name: string,
  option: string,
  index: number = 0,
): Promise<void> => {
  await editor(page)
    .getByRole("combobox", { name, exact: true })
    .nth(index)
    .click();
  await page.getByRole("option", { name: option, exact: true }).click();
};

const scrollExpandedRuleToTop: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await editor(page)
    .getByTestId("monitor-rule-card")
    .filter({
      has: page.getByRole("textbox", { name: "Rule name", exact: true }),
    })
    .evaluate((element: HTMLElement) => {
      const content: HTMLElement | null = element.closest(
        '[data-testid="modal-content"]',
      );
      if (content) {
        content.scrollTop +=
          element.getBoundingClientRect().top -
          content.getBoundingClientRect().top -
          8;
      }
    });
};

const capture: (
  page: Page,
  testInfo: TestInfo,
  name: string,
) => Promise<void> = async (
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> => {
  const directory: string = path.resolve(
    process.cwd(),
    "../output/playwright/monitor-editor",
  );
  await mkdir(directory, { recursive: true });
  const screenshotPath: string = path.join(
    directory,
    `${name}-${testInfo.project.name}.png`,
  );
  if (name === "edit-rule") {
    await scrollExpandedRuleToTop(page);
  }
  await page.screenshot({
    path: screenshotPath,
    fullPage: false,
    animations: "disabled",
  });
  await testInfo.attach(name, {
    path: screenshotPath,
    contentType: "image/png",
  });
};

test.describe("Simple monitor editor", () => {
  const ctx: EditorContext = {
    page: undefined as unknown as Page,
    projectId: "",
    monitorId: "",
    defaults: {
      operationalMonitorStatusId: "",
      offlineMonitorStatusId: "",
      incidentSeverityId: "",
      resolvedIncidentStateId: "",
    },
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    ctx.page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "Monitor Editor Tests",
      preferredPlanName: "Growth",
    });
    ctx.defaults = await getProjectDefaults(ctx);
  });

  test.beforeEach(async () => {
    await ctx.page.setViewportSize({ width: 1440, height: 900 });
    const monitorSteps: JSONish = buildHttpMonitorSteps({
      ids: newMonitorStepIds(),
      defaults: ctx.defaults,
      destinationUrl: buildUrl("/api/status"),
      monitorName: "Checkout API",
      onCallPolicyIds: [],
      requestType: "POST",
      requestBody: '{"healthCheck":true,"region":"eu"}',
      requestHeaders: {
        "Content-Type": "application/json",
        "X-Monitor-Check": "editor-regression",
      },
    });
    const step: JSONish =
      monitorSteps["value"]["monitorStepsInstanceArray"][0]["value"];
    step["requestTimeoutInMs"] = 17000;
    step["retryCount"] = 0;
    step["doNotFollowRedirects"] = true;
    step["allowSelfSignedCertificates"] = true;
    const firstRule: JSONish =
      step["monitorCriteria"]["value"]["monitorCriteriaInstanceArray"][0][
        "value"
      ];
    firstRule["name"] = "Service unavailable";
    firstRule["incidents"][0]["remediationNotes"] =
      "Check the upstream service before restarting.";
    firstRule["incidents"][0]["showIncidentOnStatusPage"] = false;
    firstRule["incidents"][0]["isPrivate"] = true;
    step["monitorCriteria"]["value"]["monitorCriteriaInstanceArray"][1][
      "value"
    ]["name"] = "Service healthy";
    const monitor: JSONish = await createItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/monitor",
      item: {
        name: "Checkout API",
        projectId: ctx.projectId,
        monitorType: "API",
        monitoringInterval: "*/5 * * * *",
        disableActiveMonitoring: true,
        monitorSteps,
      },
    });
    ctx.monitorId = toId(monitor["_id"]);
    expect(ctx.monitorId).not.toEqual("");
  });

  test.afterAll(async () => {
    await ctx.page?.close();
  });

  test("creates a website with a target and working default rules", async ({
    browser: _browser,
  }: { browser: Browser }, testInfo: TestInfo) => {
    const target: string = buildUrl("/api/status");
    const monitorId: string = await createMonitor({
      page: ctx.page,
      projectId: ctx.projectId,
      monitorName: "Customer website",
      recipe: {
        label: "Website",
        cardValue: "Website",
        hasInterval: true,
        fillCriteria: async ({ page }: { page: Page }) => {
          const form: Locator = page.locator("#create-monitor-form");
          await expect(
            form.getByText("What to monitor", { exact: true }),
          ).toBeVisible();
          await expect(
            form.getByRole("textbox", { name: "Rule name", exact: true }),
          ).toHaveCount(0);
          await expect(
            form.getByRole("button", { name: /^Edit rule:/ }),
          ).toHaveCount(2);
          await destinationInput(form).fill(target);
          await capture(page, testInfo, "create-monitor");
        },
      },
    });
    const saved: JSONish = await getSteps({ ...ctx, monitorId });
    expect(firstStep(saved)["monitorDestination"]).toEqual(target);
    expect(rules(saved)).toHaveLength(2);
    expect(
      rules(saved).every((rule: JSONish) => {
        return rule["filters"].length > 0;
      }),
    ).toBe(true);
    expect(saved["defaultMonitorStatusId"]).toEqual(
      ctx.defaults.operationalMonitorStatusId,
    );
    await requestJson({
      page: ctx.page,
      projectId: ctx.projectId,
      path: `/api/monitor/${monitorId}`,
      method: "put",
      body: { data: { disableActiveMonitoring: true } },
    });
    await openEditor({ ...ctx, monitorId });
    await expect(destinationInput(editor(ctx.page))).toHaveValue(target);
    await expect(
      editor(ctx.page).getByRole("button", { name: /^Edit rule:/ }),
    ).toHaveCount(2);
    await editor(ctx.page).getByTestId("modal-footer-close-button").click();
  });

  test("saves target and rule name without changing advanced settings or stable rule IDs", async ({
    browser: _browser,
  }: { browser: Browser }, testInfo: TestInfo) => {
    const baseline: JSONish = await getSteps(ctx);
    await openEditor(ctx);
    await capture(ctx.page, testInfo, "monitor-editor-overview");
    const advancedSettings: Locator = editor(ctx.page).getByRole("button", {
      name: "Advanced request settings",
      exact: true,
    });
    const requestTimeout: Locator = editor(ctx.page).getByLabel(
      "Request timeout (seconds)",
      { exact: true },
    );
    await expect(requestTimeout).not.toBeVisible();
    await advancedSettings.focus();
    await ctx.page.keyboard.press("Enter");
    await expect(advancedSettings).toHaveAttribute("aria-expanded", "true");
    await expect(requestTimeout).toBeVisible();
    await expect(requestTimeout).toHaveValue("17");
    await advancedSettings.focus();
    await ctx.page.keyboard.press("Space");
    await expect(advancedSettings).toHaveAttribute("aria-expanded", "false");
    await expect(requestTimeout).not.toBeVisible();
    await ctx.page.keyboard.press("Tab");
    await expect(
      editor(ctx.page).getByRole("button", {
        name: "Drag to reorder rule: Service unavailable",
        exact: true,
      }),
    ).toBeFocused();
    await expect(
      editor(ctx.page).getByRole("textbox", { name: "Rule name", exact: true }),
    ).toHaveCount(0);
    await openRule(ctx.page, "Service unavailable");
    await editor(ctx.page)
      .getByRole("textbox", { name: "Rule name", exact: true })
      .fill("Checkout is unavailable");
    const newTarget: string = `${buildUrl("/api/status")}?source=monitor-editor`;
    await destinationInput(editor(ctx.page)).fill(newTarget);
    await editor(ctx.page)
      .getByRole("textbox", { name: "Rule name", exact: true })
      .scrollIntoViewIfNeeded();
    await capture(ctx.page, testInfo, "edit-rule");
    await saveEditor(ctx.page);
    firstStep(baseline)["monitorDestination"] = newTarget;
    rules(baseline)[0]!["name"] = "Checkout is unavailable";
    expect(await getSteps(ctx)).toEqual(baseline);
    await ctx.page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      ctx.page.getByRole("button", { name: "Edit Monitoring Criteria" }),
    ).toBeVisible({ timeout: 60000 });
    await openEditor(ctx);
    await expect(destinationInput(editor(ctx.page))).toHaveValue(newTarget);
    await openRule(ctx.page, "Checkout is unavailable");
    await expect(
      editor(ctx.page).getByRole("textbox", {
        name: "Incident title",
        exact: true,
      }),
    ).toHaveValue("Checkout API is offline");
    await editor(ctx.page).getByTestId("modal-footer-close-button").click();
  });

  test("cancel discards changed target, rule text, actions, and new conditions", async () => {
    const baseline: JSONish = await getSteps(ctx);
    await openEditor(ctx);
    await destinationInput(editor(ctx.page)).fill(
      "https://example.com/unsaved",
    );
    await openRule(ctx.page, "Service unavailable");
    await editor(ctx.page)
      .getByRole("textbox", { name: "Rule name", exact: true })
      .fill("Unsaved rule");
    await editor(ctx.page)
      .getByRole("switch", { name: "Declare an incident", exact: true })
      .click();
    await editor(ctx.page)
      .getByRole("button", { name: "Add condition", exact: true })
      .click();
    await editor(ctx.page).getByTestId("modal-footer-close-button").click();
    expect(await getSteps(ctx)).toEqual(baseline);
    /*
     * Reopen without navigation so a mutated copy cached in the page cannot
     * hide behind a fresh server read triggered by a full page reload.
     */
    await ctx.page
      .getByRole("button", { name: "Edit Monitoring Criteria", exact: true })
      .click();
    await expect(
      editor(ctx.page).getByText("Alert rules", { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await expect(destinationInput(editor(ctx.page))).toHaveValue(
      firstStep(baseline)["monitorDestination"],
    );
    await expect(
      editor(ctx.page).getByRole("button", {
        name: "Edit rule: Service unavailable",
        exact: true,
      }),
    ).toBeVisible();
    await openRule(ctx.page, "Service unavailable");
    await expect(
      editor(ctx.page).getByRole("combobox", { name: "Check", exact: true }),
    ).toHaveCount(2);
    await expect(
      editor(ctx.page).getByRole("switch", {
        name: "Declare an incident",
        exact: true,
      }),
    ).toBeChecked();
    await editor(ctx.page).getByTestId("modal-footer-close-button").click();
  });

  test("adds and removes conditions while preserving the remaining comparison", async () => {
    const baseline: JSONish = await getSteps(ctx);
    await openEditor(ctx);
    await openRule(ctx.page, "Service healthy");
    await editor(ctx.page)
      .getByRole("button", { name: "Add condition", exact: true })
      .click();
    await expect(
      editor(ctx.page).getByRole("combobox", { name: "Check", exact: true }),
    ).toHaveCount(3);
    await choose(ctx.page, "Check", "Response Status Code", 2);
    await choose(ctx.page, "Condition", "Equal To", 2);
    await editor(ctx.page)
      .getByRole("textbox", { name: "Value", exact: true })
      .last()
      .fill("204");
    await editor(ctx.page)
      .getByRole("button", { name: "Remove condition 1", exact: true })
      .click();
    await editor(ctx.page)
      .getByRole("button", { name: "Remove condition 1", exact: true })
      .click();
    await expect(
      editor(ctx.page).getByRole("combobox", { name: "Check", exact: true }),
    ).toHaveCount(1);
    await expect(
      editor(ctx.page).getByRole("textbox", { name: "Value", exact: true }),
    ).toHaveValue("204");
    await expect(
      editor(ctx.page).getByRole("button", {
        name: "Remove condition 1",
        exact: true,
      }),
    ).toBeDisabled();
    await saveEditor(ctx.page);
    const saved: JSONish = await getSteps(ctx);
    expect(rules(saved)[0]).toEqual(rules(baseline)[0]);
    expect(rules(saved)[1]!["filters"]).toEqual([
      {
        checkOn: "Response Status Code",
        filterType: "Equal To",
        value: "204",
        evaluateOverTime: false,
      },
    ]);
    await openEditor(ctx);
    await openRule(ctx.page, "Service healthy");
    await expect(
      editor(ctx.page).getByRole("textbox", { name: "Value", exact: true }),
    ).toHaveValue("204");
    await editor(ctx.page).getByTestId("modal-footer-close-button").click();
  });

  test("changes all-versus-any matching without resetting conditions or actions", async () => {
    const baseline: JSONish = await getSteps(ctx);
    await openEditor(ctx);
    await openRule(ctx.page, "Service unavailable");
    const group: Locator = editor(ctx.page).getByRole("radiogroup", {
      name: "Match conditions",
      exact: true,
    });
    await expect(
      group.getByRole("radio", { name: "Any condition matches", exact: true }),
    ).toBeChecked();
    await group
      .getByRole("radio", { name: "All conditions match", exact: true })
      .check();
    await saveEditor(ctx.page);
    rules(baseline)[0]!["filterCondition"] = "All";
    expect(await getSteps(ctx)).toEqual(baseline);
    await openEditor(ctx);
    await openRule(ctx.page, "Service unavailable");
    await expect(
      editor(ctx.page).getByRole("radio", {
        name: "All conditions match",
        exact: true,
      }),
    ).toBeChecked();
    await editor(ctx.page).getByTestId("modal-footer-close-button").click();
  });

  test("adds a valid rule, changes evaluation priority, and persists the fallback status", async () => {
    const baseline: JSONish = await getSteps(ctx);
    await openEditor(ctx);
    await expect(
      editor(ctx.page).getByRole("button", {
        name: "Move rule up: Service unavailable",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      editor(ctx.page).getByRole("button", {
        name: "Move rule down: Service healthy",
        exact: true,
      }),
    ).toBeDisabled();
    await editor(ctx.page)
      .getByRole("button", { name: "Add rule", exact: true })
      .click();
    await expect(
      editor(ctx.page).getByRole("textbox", { name: "Rule name", exact: true }),
    ).toHaveValue("New rule");
    await editor(ctx.page)
      .getByRole("textbox", { name: "Rule name", exact: true })
      .fill("Custom response");
    await editor(ctx.page)
      .getByRole("button", {
        name: "Move rule up: Custom response",
        exact: true,
      })
      .click();
    await editor(ctx.page)
      .getByRole("button", {
        name: "Move rule up: Custom response",
        exact: true,
      })
      .click();
    await choose(ctx.page, "Default status", "Offline");
    await saveEditor(ctx.page);
    const saved: JSONish = await getSteps(ctx);
    expect(
      rules(saved).map((rule: JSONish) => {
        return rule["name"];
      }),
    ).toEqual(["Custom response", "Service unavailable", "Service healthy"]);
    expect(rules(saved).slice(1)).toEqual(rules(baseline));
    expect(rules(saved)[0]!["filters"].length).toBeGreaterThan(0);
    expect(saved["defaultMonitorStatusId"]).toEqual(
      ctx.defaults.offlineMonitorStatusId,
    );
    await openEditor(ctx);
    await expect(
      editor(ctx.page).getByRole("button", {
        name: "Move rule up: Custom response",
        exact: true,
      }),
    ).toBeDisabled();
    await editor(ctx.page).getByTestId("modal-footer-close-button").click();
  });

  test("disabled rules and incident action toggles retain their configured details", async () => {
    const baseline: JSONish = await getSteps(ctx);
    await openEditor(ctx);
    await openRule(ctx.page, "Service unavailable");
    const incidentToggle: Locator = editor(ctx.page).getByRole("switch", {
      name: "Declare an incident",
      exact: true,
    });
    await incidentToggle.click();
    await expect(
      editor(ctx.page).getByRole("textbox", {
        name: "Incident title",
        exact: true,
      }),
    ).toHaveCount(0);
    await incidentToggle.click();
    await expect(
      editor(ctx.page).getByRole("textbox", {
        name: "Incident title",
        exact: true,
      }),
    ).toHaveValue("Checkout API is offline");
    await editor(ctx.page)
      .getByText("Advanced rule settings", { exact: true })
      .click();
    await editor(ctx.page)
      .getByRole("switch", { name: "Enable this rule", exact: true })
      .click();
    await saveEditor(ctx.page);
    rules(baseline)[0]!["isEnabled"] = false;
    expect(await getSteps(ctx)).toEqual(baseline);
    await openEditor(ctx);
    await openRule(ctx.page, "Service unavailable");
    await editor(ctx.page)
      .getByText("Advanced rule settings", { exact: true })
      .click();
    await expect(
      editor(ctx.page).getByRole("switch", {
        name: "Enable this rule",
        exact: true,
      }),
    ).not.toBeChecked();
    await editor(ctx.page).getByTestId("modal-footer-close-button").click();
  });

  test("deletes only the selected rule and keeps one rule available", async () => {
    const baseline: JSONish = await getSteps(ctx);
    await openEditor(ctx);
    await openRule(ctx.page, "Service healthy");
    await editor(ctx.page)
      .getByRole("button", { name: "Delete rule", exact: true })
      .click();
    await expect(
      editor(ctx.page).getByRole("button", {
        name: "Edit rule: Service healthy",
        exact: true,
      }),
    ).toHaveCount(0);
    await saveEditor(ctx.page);
    expect(rules(await getSteps(ctx))).toEqual([rules(baseline)[0]]);
    await openEditor(ctx);
    await openRule(ctx.page, "Service unavailable");
    await editor(ctx.page)
      .getByRole("button", { name: "Delete rule", exact: true })
      .click();
    await expect(
      ctx.page.getByRole("heading", { name: "Keep one rule", exact: true }),
    ).toBeVisible();
    await ctx.page.getByRole("button", { name: "Got it", exact: true }).click();
    await saveEditor(ctx.page);
    expect(rules(await getSteps(ctx))).toEqual([rules(baseline)[0]]);
  });

  test("clearing a saved URL blocks save without silently retaining the old destination", async () => {
    const baseline: JSONish = await getSteps(ctx);
    await openEditor(ctx);
    await destinationInput(editor(ctx.page)).fill("");
    await editor(ctx.page).getByTestId("modal-footer-submit-button").click();
    await expect(editor(ctx.page)).toBeVisible();
    await expect(destinationInput(editor(ctx.page))).toHaveValue("");
    await expect(
      editor(ctx.page)
        .getByText(/required/i)
        .last(),
    ).toBeVisible();
    expect(await getSteps(ctx)).toEqual(baseline);
    await destinationInput(editor(ctx.page)).fill(
      firstStep(baseline)["monitorDestination"],
    );
    await saveEditor(ctx.page);
    expect(await getSteps(ctx)).toEqual(baseline);
  });

  test("keeps setup and rule decisions readable at a normal laptop viewport", async () => {
    await openEditor(ctx);
    const modalBounds: ElementBounds | null = await editor(
      ctx.page,
    ).boundingBox();
    expect(modalBounds).not.toBeNull();
    expect(modalBounds!.y).toBeGreaterThanOrEqual(0);
    expect(modalBounds!.y + modalBounds!.height).toBeLessThanOrEqual(900);
    const outerOverflow: number = await editor(ctx.page).evaluate(
      (element: HTMLElement) => {
        const outer: HTMLElement = element.parentElement!.parentElement!;
        return outer.scrollHeight - outer.clientHeight;
      },
    );
    expect(outerOverflow).toBeLessThanOrEqual(1);
    await expect(destinationInput(editor(ctx.page))).toBeInViewport({
      ratio: 1,
    });
    const fallback: Locator = editor(ctx.page)
      .locator(".ou-select__control")
      .filter({
        has: ctx.page.getByRole("combobox", {
          name: "Default status",
          exact: true,
        }),
      });
    await fallback.scrollIntoViewIfNeeded();
    await expect(fallback).toBeInViewport({ ratio: 1 });
    const fallbackBounds: ElementBounds | null = await fallback.boundingBox();
    const contentBounds: ElementBounds | null = await editor(ctx.page)
      .getByTestId("modal-content")
      .boundingBox();
    expect(fallbackBounds).not.toBeNull();
    expect(contentBounds).not.toBeNull();
    expect(fallbackBounds!.y + fallbackBounds!.height).toBeLessThanOrEqual(
      contentBounds!.y + contentBounds!.height,
    );
    await expect(
      editor(ctx.page).getByTestId("modal-footer-submit-button"),
    ).toBeInViewport({ ratio: 1 });
    await openRule(ctx.page, "Service unavailable");
    await scrollExpandedRuleToTop(ctx.page);
    await expect(
      editor(ctx.page).getByRole("heading", { name: "When", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    const then: Locator = editor(ctx.page).getByRole("heading", {
      name: "Then",
      exact: true,
    });
    await expect(then).toBeInViewport({ ratio: 1 });
    const thenBounds: ElementBounds | null = await then.boundingBox();
    const whenBounds: ElementBounds | null = await editor(ctx.page)
      .getByRole("heading", { name: "When", exact: true })
      .boundingBox();
    const saveBounds: ElementBounds | null = await editor(ctx.page)
      .getByTestId("modal-footer-submit-button")
      .boundingBox();
    expect(thenBounds).not.toBeNull();
    expect(whenBounds).not.toBeNull();
    expect(saveBounds).not.toBeNull();
    expect(thenBounds!.y + thenBounds!.height).toBeLessThan(saveBounds!.y);
    expect(Math.abs(thenBounds!.y - whenBounds!.y)).toBeLessThan(2);
    expect(thenBounds!.x).toBeGreaterThan(whenBounds!.x + whenBounds!.width);
    await editor(ctx.page).getByTestId("modal-footer-close-button").click();
  });

  test("reselecting the current check and condition preserves the complete saved rule", async () => {
    const baseline: JSONish = await getSteps(ctx);
    await openEditor(ctx);
    await openRule(ctx.page, "Service unavailable");
    const condition: Locator = editor(ctx.page).getByRole("group", {
      name: "Condition 2",
      exact: true,
    });
    const value: Locator = condition.getByRole("textbox", {
      name: "Value",
      exact: true,
    });
    await expect(value).toHaveValue("200");
    await choose(ctx.page, "Check", "Response Status Code", 1);
    await expect(value).toHaveValue("200");
    await expect(
      condition.locator(".ou-select__single-value").last(),
    ).toHaveText("Not Equal To");
    await choose(ctx.page, "Condition", "Not Equal To", 1);
    await expect(value).toHaveValue("200");
    await saveEditor(ctx.page);
    expect(await getSteps(ctx)).toEqual(baseline);
  });

  test("required dropdown choices cannot be cleared by keyboard or a clear button", async () => {
    const baseline: JSONish = await getSteps(ctx);
    await openEditor(ctx);
    const assertRequiredChoice: (name: string) => Promise<void> = async (
      name: string,
    ): Promise<void> => {
      const control: Locator = editor(ctx.page)
        .locator(".ou-select__control")
        .filter({ has: ctx.page.getByRole("combobox", { name, exact: true }) })
        .first();
      const selected: Locator = control.locator(".ou-select__single-value");
      const original: string = await selected.innerText();
      await expect(control.locator(".ou-select__clear-indicator")).toHaveCount(
        0,
      );
      await control.getByRole("combobox", { name, exact: true }).focus();
      await ctx.page.keyboard.press("Backspace");
      await expect(selected).toHaveText(original);
    };
    await assertRequiredChoice("Request method");
    await assertRequiredChoice("Default status");
    await openRule(ctx.page, "Service unavailable");
    for (const name of [
      "Check",
      "Condition",
      "Change monitor status to",
      "Incident severity",
    ]) {
      await assertRequiredChoice(name);
    }
    await saveEditor(ctx.page);
    expect(await getSteps(ctx)).toEqual(baseline);
  });

  test("action titles and help toggle their switches without losing incident details", async () => {
    const baseline: JSONish = await getSteps(ctx);
    await openEditor(ctx);
    await openRule(ctx.page, "Service unavailable");
    const alert: Locator = editor(ctx.page).getByRole("switch", {
      name: "Create an alert",
      exact: true,
    });
    await expect(alert).not.toBeChecked();
    await editor(ctx.page)
      .getByText("Create an alert", { exact: true })
      .click();
    await expect(alert).toBeChecked();
    await expect(
      editor(ctx.page).getByRole("textbox", {
        name: "Alert title",
        exact: true,
      }),
    ).toBeVisible();
    await editor(ctx.page)
      .getByText("Notify your team about a problem.", { exact: true })
      .click();
    await expect(alert).not.toBeChecked();
    const incident: Locator = editor(ctx.page).getByRole("switch", {
      name: "Declare an incident",
      exact: true,
    });
    await editor(ctx.page)
      .getByText("Declare an incident", { exact: true })
      .click();
    await expect(incident).not.toBeChecked();
    await editor(ctx.page)
      .getByText("Declare an incident", { exact: true })
      .click();
    await expect(incident).toBeChecked();
    await expect(
      editor(ctx.page).getByRole("textbox", {
        name: "Incident title",
        exact: true,
      }),
    ).toHaveValue("Checkout API is offline");
    await editor(ctx.page).getByTestId("modal-footer-close-button").click();
    expect(await getSteps(ctx)).toEqual(baseline);
  });

  test("keeps the editor and save controls usable on a narrow screen", async ({
    browser: _browser,
  }: { browser: Browser }, testInfo: TestInfo) => {
    const baseline: JSONish = await getSteps(ctx);
    await ctx.page.setViewportSize({ width: 390, height: 844 });
    await openEditor(ctx);
    await openRule(ctx.page, "Service unavailable");
    await editor(ctx.page)
      .getByRole("textbox", { name: "Rule name", exact: true })
      .fill("Mobile rule edit");
    for (const panel of [
      editor(ctx.page),
      editor(ctx.page).getByTestId("modal-content"),
    ]) {
      const bounds: { viewport: number; scroll: number } = await panel.evaluate(
        (element: HTMLElement) => {
          return { viewport: element.clientWidth, scroll: element.scrollWidth };
        },
      );
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.viewport + 1);
    }
    const condition: Locator = editor(ctx.page).getByRole("group", {
      name: "Condition 2",
      exact: true,
    });
    await condition.evaluate((element: HTMLElement) => {
      const content: HTMLElement | null = element.closest(
        '[data-testid="modal-content"]',
      );
      if (content) {
        content.scrollTop +=
          element.getBoundingClientRect().top -
          content.getBoundingClientRect().top -
          16;
      }
    });
    const check: Locator = condition.locator(".ou-select__control").filter({
      has: ctx.page.getByRole("combobox", { name: "Check", exact: true }),
    });
    const comparison: Locator = condition
      .locator(".ou-select__control")
      .filter({
        has: ctx.page.getByRole("combobox", { name: "Condition", exact: true }),
      });
    const checkBounds: ElementBounds | null = await check.boundingBox();
    const comparisonBounds: ElementBounds | null =
      await comparison.boundingBox();
    const valueBounds: ElementBounds | null = await condition
      .getByRole("textbox", {
        name: "Value",
        exact: true,
      })
      .boundingBox();
    expect(checkBounds).not.toBeNull();
    expect(comparisonBounds).not.toBeNull();
    expect(valueBounds).not.toBeNull();
    expect(checkBounds!.width).toBeGreaterThan(220);
    expect(comparisonBounds!.width).toBeGreaterThan(220);
    expect(valueBounds!.width).toBeGreaterThan(220);
    expect(comparisonBounds!.y).toBeGreaterThan(
      checkBounds!.y + checkBounds!.height,
    );
    expect(valueBounds!.y).toBeGreaterThan(
      comparisonBounds!.y + comparisonBounds!.height,
    );
    expect(Math.abs(valueBounds!.x - comparisonBounds!.x)).toBeLessThan(2);
    for (const control of [check, comparison]) {
      const clipped: boolean = await control
        .locator(".ou-select__single-value")
        .evaluate((element: HTMLElement) => {
          return element.scrollWidth > element.clientWidth + 1;
        });
      expect(clipped).toBe(false);
    }
    await condition
      .getByRole("combobox", { name: "Condition", exact: true })
      .click();
    const menu: Locator = ctx.page.getByRole("listbox");
    await expect(menu).toBeVisible();
    const menuBounds: ElementBounds | null = await menu.boundingBox();
    expect(menuBounds).not.toBeNull();
    expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
    expect(menuBounds!.width).toBeGreaterThan(220);
    expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(390);
    expect(menuBounds!.y).toBeGreaterThanOrEqual(0);
    expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(844);
    await capture(ctx.page, testInfo, "mobile-condition-menu");
    await ctx.page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    const save: Locator = editor(ctx.page).getByTestId(
      "modal-footer-submit-button",
    );
    await expect(save).toBeInViewport();
    await capture(ctx.page, testInfo, "mobile-rule-editor");
    await saveEditor(ctx.page);
    rules(baseline)[0]!["name"] = "Mobile rule edit";
    expect(await getSteps(ctx)).toEqual(baseline);
  });

  test("long comparison choices remain fully readable on a narrow screen", async ({
    browser: _browser,
  }: { browser: Browser }, testInfo: TestInfo) => {
    const baseline: JSONish = await getSteps(ctx);
    await ctx.page.setViewportSize({ width: 390, height: 844 });
    await openEditor(ctx);
    await openRule(ctx.page, "Service unavailable");
    await choose(ctx.page, "Condition", "Greater Than Or Equal To", 1);
    const condition: Locator = editor(ctx.page).getByRole("group", {
      name: "Condition 2",
      exact: true,
    });
    const comparison: Locator = condition
      .locator(".ou-select__control")
      .filter({
        has: ctx.page.getByRole("combobox", { name: "Condition", exact: true }),
      });
    const selected: Locator = comparison.locator(".ou-select__single-value");
    await expect(selected).toHaveText("Greater Than Or Equal To");
    const clipped: boolean = await selected.evaluate((element: HTMLElement) => {
      return element.scrollWidth > element.clientWidth + 1;
    });
    expect(clipped).toBe(false);
    const whenBounds: ElementBounds | null = await editor(ctx.page)
      .getByRole("region", { name: "When", exact: true })
      .boundingBox();
    const thenBounds: ElementBounds | null = await editor(ctx.page)
      .getByRole("region", { name: "Then", exact: true })
      .boundingBox();
    expect(whenBounds).not.toBeNull();
    expect(thenBounds).not.toBeNull();
    expect(thenBounds!.y).toBeGreaterThanOrEqual(
      whenBounds!.y + whenBounds!.height,
    );
    await capture(ctx.page, testInfo, "mobile-long-comparison");
    await editor(ctx.page).getByTestId("modal-footer-close-button").click();
    expect(await getSteps(ctx)).toEqual(baseline);
  });
});
