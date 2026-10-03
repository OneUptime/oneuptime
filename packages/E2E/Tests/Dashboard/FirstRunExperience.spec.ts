import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import {
  clickCreateUntilMonitorView,
  clickNext,
  createMonitor,
  fillDestination,
  selectMonitorLabels,
  selectMonitorTypeCard,
  waitForCriteriaStepReady,
} from "./Helpers/Monitors";
import { JSONish, getItem } from "./Helpers/MonitorAlerting";
import { Browser, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * What a brand-new owner meets on the way to a first monitor, in a real
 * browser against a real stack:
 *
 *  - Home does not claim monitors or SLOs are fine when there are none: the
 *    tiles say "No monitors yet" / "No SLOs yet", and the monitors tile opens
 *    the Monitors list, whose empty state carries the Create Monitor button.
 *  - Menus say "Not Operational", never "Inoperational".
 *  - Getting Started's "Invite your team" lands where Invite User is.
 *  - An empty core list shows a real empty state - "No X yet", what the
 *    list is for, and its Create button - in place of the old grey sentence
 *    and "Refresh?" link; a search that matched nothing says so, offers to
 *    clear it, and does not offer to create anything.
 *  - A Website monitor created without touching "Monitoring Interval" is
 *    saved on every five minutes; an Incoming Request monitor, which has no
 *    interval step, is saved with no interval at all.
 *
 * One project for the whole file, in order: the empty-project checks have to
 * run before the monitors that end the project's emptiness are created.
 */

test.describe.configure({ mode: "serial" });

const projectUrl: (projectId: string, path: string) => string = (
  projectId: string,
  path: string,
): string => {
  return URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${projectId}${path}`)
    .toString();
};

const exactPath: (projectId: string, path: string) => RegExp = (
  projectId: string,
  path: string,
): RegExp => {
  return new RegExp(`/dashboard/${projectId}${path}/?(?:\\?.*)?$`);
};

test.describe("First run: a brand-new project", () => {
  let page: Page;
  let projectId: string;
  const websiteMonitorName: string = `First run website ${Date.now()}`;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    /*
     * On a billing install, Growth: the Free plan cannot even read on-call
     * schedules (OnCallDutyPolicySchedule's read needs Growth), so their
     * empty list would be an upgrade notice instead.
     */
    projectId = await registerAndCreateProject({
      page,
      projectNamePrefix: "First Run",
      preferredPlanName: IS_BILLING_ENABLED ? "Growth" : undefined,
    });
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test("Home says what is not set up yet, instead of all clear", async () => {
    test.setTimeout(180000);

    await gotoProjectPage({
      page,
      projectId,
      url: projectUrl(projectId, "/home"),
      ready: page.getByTestId("home-stat-not-operational-monitors-status"),
    });

    await expect(
      page.getByTestId("home-stat-not-operational-monitors-status"),
    ).toHaveText("No monitors yet", { timeout: 30000 });
    await expect(
      page.getByTestId("home-stat-slos-needing-attention-status"),
    ).toHaveText("No SLOs yet");

    // Nothing is open, so these still read as before.
    await expect(
      page.getByTestId("home-stat-active-incidents-status"),
    ).toHaveText("All clear");
    await expect(page.getByTestId("home-stat-active-alerts-status")).toHaveText(
      "All clear",
    );

    const tiles: Locator = page.getByTestId("home-overview-stats");
    await expect(tiles).toContainText("Not operational monitors");
    await expect(tiles).not.toContainText("All operational");
    await expect(tiles).not.toContainText("Budgets healthy");

    const menu: Locator = page
      .locator('[aria-label="Main navigation"]')
      .first();
    await expect(menu).toContainText("Not Operational");
    await expect(menu).not.toContainText("Inoperational");
  });

  test("the empty monitors tile opens the Monitors list, and its button opens the form", async () => {
    test.setTimeout(180000);

    await gotoProjectPage({
      page,
      projectId,
      url: projectUrl(projectId, "/home"),
      ready: page.getByTestId("home-stat-not-operational-monitors-status"),
    });
    await expect(
      page.getByTestId("home-stat-not-operational-monitors-status"),
    ).toHaveText("No monitors yet", { timeout: 30000 });

    await page.getByTestId("home-stat-not-operational-monitors-status").click();
    await expect(page).toHaveURL(exactPath(projectId, "/monitors"), {
      timeout: 30000,
    });

    const create: Locator = page.getByTestId("empty-table-create-button");
    await expect(create).toHaveText("Create Monitor", { timeout: 30000 });
    await create.click();
    await expect(page).toHaveURL(exactPath(projectId, "/monitors/create"), {
      timeout: 30000,
    });
  });

  test("Getting Started's 'Invite your team' lands where Invite User is", async () => {
    test.setTimeout(180000);

    await gotoProjectPage({
      page,
      projectId,
      url: projectUrl(projectId, "/home"),
      ready: page.getByTestId("getting-started-task-invite-team"),
    });

    await page.getByTestId("getting-started-task-invite-team").click();

    await expect(page).toHaveURL(exactPath(projectId, "/users"), {
      timeout: 30000,
    });
    await expect(page.getByRole("button", { name: "Invite User" })).toBeVisible(
      { timeout: 30000 },
    );
  });

  test("the empty Monitors list says No monitors yet, with Create Monitor instead of Refresh", async () => {
    test.setTimeout(180000);

    await gotoProjectPage({
      page,
      projectId,
      url: projectUrl(projectId, "/monitors"),
      ready: page.getByTestId("empty-table-create-button"),
    });

    // The table draws its empty state in a block of its own, under the header.
    const emptyState: Locator = page.locator('[data-testid$="-no-items"]');
    await expect(emptyState).toBeVisible();
    await expect(
      emptyState.getByRole("heading", { name: "No monitors yet", exact: true }),
    ).toBeVisible();
    // What the list is for, said in the empty state rather than twice.
    await expect(
      emptyState.getByTestId("table-empty-state-description"),
    ).toContainText("Monitors check your websites");

    const create: Locator = page.getByTestId("empty-table-create-button");
    await expect(create).toHaveText("Create Monitor");
    // The Refresh link read like a failed load; the button takes its place.
    await expect(page.getByTestId("refresh-button")).toHaveCount(0);

    const menu: Locator = page
      .locator('[aria-label="Main navigation"]')
      .first();
    await expect(menu).toContainText("Not Operational");
    await expect(menu).not.toContainText("Inoperational");

    await create.click();
    await expect(page).toHaveURL(exactPath(projectId, "/monitors/create"), {
      timeout: 30000,
    });
  });

  test("the empty On-Call Schedules list offers Create On-Call Schedule", async () => {
    test.setTimeout(180000);

    await gotoProjectPage({
      page,
      projectId,
      url: projectUrl(projectId, "/on-call-duty/schedules"),
      ready: page.getByTestId("empty-table-create-button"),
    });

    const emptyState: Locator = page.locator('[data-testid$="-no-items"]');
    await expect(emptyState).toBeVisible();
    await expect(
      emptyState.getByRole("heading", {
        name: "No on-call schedules yet",
        exact: true,
      }),
    ).toBeVisible();

    const create: Locator = page.getByTestId("empty-table-create-button");
    // Named for the page, not for its table (On-Call Duty Policy Schedule).
    await expect(create).toHaveText("Create On-Call Schedule");
    await expect(page.getByTestId("refresh-button")).toHaveCount(0);

    // The same create form the header button opens.
    await create.click();
    const modal: Locator = page.getByTestId("modal");
    await expect(modal).toBeVisible({ timeout: 30000 });
    await expect(modal).toContainText("Create New On-Call Schedule");
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0, { timeout: 15000 });
  });

  test("a Website monitor made without touching the interval checks every five minutes", async () => {
    test.setTimeout(240000);

    await gotoProjectPage({
      page,
      projectId,
      url: projectUrl(projectId, "/monitors/create"),
      ready: page.locator("#create-monitor-form"),
    });

    await page
      .locator("#create-monitor-form input[placeholder='Monitor Name']")
      .fill(websiteMonitorName);
    await selectMonitorTypeCard({ page, cardValue: "Website" });
    await clickNext({ page });

    await waitForCriteriaStepReady({ page });
    await fillDestination({ page, value: "https://example.com" });
    /*
     * Every step after the criteria is optional - the monitor could be
     * created from here - so Next walks on to look at the interval.
     */
    await expect(page.getByTestId("Create Monitor")).toHaveText(
      "Create Monitor",
    );
    await clickNext({ page });

    // The step opens on the default: nothing to choose.
    const interval: Locator = page.getByRole("combobox", {
      name: "Monitoring Interval",
    });
    await interval.waitFor({ state: "visible", timeout: 30000 });
    await expect(
      page.locator("#create-monitor-form").getByText("Every 5 Minutes", {
        exact: true,
      }),
    ).toBeVisible();

    await clickNext({ page });
    await selectMonitorLabels({ page });
    await clickCreateUntilMonitorView({ page, projectId });

    const monitorId: string =
      page.url().match(/\/monitors\/([0-9a-f-]{36})/i)?.[1] || "";
    expect(monitorId).not.toBe("");

    const monitor: JSONish = await getItem({
      page,
      projectId,
      path: "/api/monitor",
      id: monitorId,
      select: { monitoringInterval: true, monitorType: true },
    });

    expect(monitor["monitorType"]).toBe("Website");
    expect(monitor["monitoringInterval"]).toBe("*/5 * * * *");
  });

  test("an Incoming Request monitor, which has no interval step, is saved with no interval", async () => {
    test.setTimeout(240000);

    const monitorId: string = await createMonitor({
      page,
      projectId,
      monitorName: `First run heartbeat ${Date.now()}`,
      recipe: {
        label: "Incoming Request",
        cardValue: "Incoming Request",
        hasInterval: false,
      },
    });

    expect(monitorId).not.toBe("");

    const monitor: JSONish = await getItem({
      page,
      projectId,
      path: "/api/monitor",
      id: monitorId,
      select: { monitoringInterval: true, monitorType: true },
    });

    expect(monitor["monitorType"]).toBe("Incoming Request");
    // Absent or null: never the Website default it did not ask for.
    expect(monitor["monitoringInterval"] ?? null).toBeNull();
  });

  test("with a monitor, the tile reads normally again", async () => {
    test.setTimeout(180000);

    await gotoProjectPage({
      page,
      projectId,
      url: projectUrl(projectId, "/home"),
      ready: page.getByTestId("home-stat-not-operational-monitors-status"),
    });

    await expect(
      page.getByTestId("home-stat-not-operational-monitors-status"),
    ).not.toHaveText("No monitors yet", { timeout: 30000 });
    // The SLO tile is untouched by monitors.
    await expect(
      page.getByTestId("home-stat-slos-needing-attention-status"),
    ).toHaveText("No SLOs yet");
  });

  test("a search that matches nothing says so, and offers nothing to create", async () => {
    test.setTimeout(180000);

    await gotoProjectPage({
      page,
      projectId,
      url: projectUrl(projectId, "/monitors"),
      ready: page.getByText(websiteMonitorName).first(),
    });

    await page.getByRole("button", { name: "Open search" }).first().click();
    await page.keyboard.type("zz-no-monitor-is-called-this");

    const emptyState: Locator = page.locator('[data-testid$="-no-items"]');
    await expect(emptyState).toContainText(
      "No monitors match your search or filters",
      { timeout: 30000 },
    );
    await expect(page.getByTestId("empty-table-create-button")).toHaveCount(0);

    // The way back: one click empties the search and the monitor is there.
    const clear: Locator = emptyState.getByTestId(
      "empty-table-clear-filters-button",
    );
    await expect(clear).toHaveText("Clear Search");
    await clear.click();
    await expect(page.getByText(websiteMonitorName).first()).toBeVisible({
      timeout: 30000,
    });
  });
});
