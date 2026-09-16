import { BASE_URL } from "../../Config";
import { Browser, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { createMonitor, MonitorTypeRecipe } from "./Helpers/Monitors";
import { JSONish, listItems } from "./Helpers/MonitorAlerting";

/*
 * SLOs (Service Level Objectives) end-to-end coverage for the dashboard
 * product area: products menu -> list -> four-step create wizard -> overview
 * -> attach a monitor -> burn rate rules, alerts and metrics -> edit the
 * details card -> save a Settings card -> monitor rules lock hand edits ->
 * archive and unarchive -> delete.
 *
 * One project and one monitor are created up front (serial mode + shared
 * page). The create wizard no longer asks for monitors, so the monitor is
 * attached afterwards on the SLO's own Monitors page — the flow a real user
 * follows. Each step is its own test so a failure points at exactly one
 * interaction instead of failing an opaque mega-test; serial mode means the
 * later steps are skipped once an earlier one breaks.
 *
 * Anti-flake notes:
 * - run-unique names (Faker.generateName() is a 10 char token), so a re-run
 *   never collides with rows left behind by a previous run
 * - nothing asserts an evaluated SLI / error-budget *number*: the evaluation
 *   worker runs on its own schedule and may not have touched a seconds-old
 *   SLO yet. The spec asserts the shape of each page (hero, chips, cards,
 *   chart-or-empty-state) rather than worker output.
 * - the two default burn rate rules are seeded by
 *   ServiceLevelObjectiveService.onCreateSuccess, which the create API awaits
 *   before responding, so the rules are guaranteed to exist by the time the
 *   create modal closes — no polling needed for them.
 *
 * To run locally against a full stack:
 *
 *   cd E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/Slo.spec.ts --project=chromium
 */
test.describe.configure({ mode: "serial" });

/*
 * A Manual monitor is the cheapest monitor to create (no criteria or interval)
 * and is enough for an SLO to reference — the SLO only needs monitors to
 * attach, it does not need them to have reported yet.
 */
const manualMonitorRecipe: MonitorTypeRecipe = {
  label: "Manual",
  cardValue: "Manual",
  hasInterval: false,
  skipsCriteria: true,
};

const uuidPattern: string =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/*
 * Every value of SloStatus, plus the pills the UI adds on top of it:
 * "Unknown" for an SLO the worker has not evaluated yet (the usual state for
 * a seconds-old SLO), "Disabled" for one that is switched off and "Archived"
 * for one that is retired. The pill shows one of these, never a number.
 */
const sloStatusRegex: RegExp =
  /Healthy|At Risk|Budget Exhausted|Misconfigured|Paused|Unknown|Disabled|Archived/;

// The empty state SloHistoryCharts renders when no SloHistory rows exist in range.
const noChartHistoryText: string = "No history in this range";

// The create wizard's steps, in order (SLO_FORM_STEPS).
const SLO_CREATE_STEPS: Array<string> = [
  "Basic Info",
  "Objective",
  "Period",
  "Labels",
];

// The SLO view side menu (Pages/Slo/View/SideMenu.tsx), in order.
const SLO_VIEW_TABS: Array<string> = [
  "Overview",
  "Monitors",
  "Monitor Rules",
  "Burn Rate Rules",
  "Metrics",
  "Alerts",
  "Incidents",
  "Feed",
  "Owners",
  "Settings",
  "Audit Logs",
  "Delete SLO",
];

type ProjectUrlFunction = (data: { projectId: string; path: string }) => string;

const projectUrl: ProjectUrlFunction = (data: {
  projectId: string;
  path: string;
}): string => {
  return URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${data.projectId}${data.path}`)
    .toString();
};

type ReadStepRailFunction = (form: Locator) => Promise<Array<string>>;

/*
 * The wizard's step rail in document order, so a test asserts the SEQUENCE
 * and not just which steps happen to exist. Steps render as plain list items
 * inside the progress nav — no role, no accessible name — so this reads the
 * list rather than looking them up by role.
 */
const readStepRail: ReadStepRailFunction = async (
  form: Locator,
): Promise<Array<string>> => {
  const titles: Array<string> = await form
    .locator('nav[aria-label="Progress"] li')
    .allInnerTexts();

  return titles
    .map((title: string): string => {
      return title.trim();
    })
    .filter((title: string): boolean => {
      return title.length > 0;
    });
};

interface SharedContext {
  page: Page;
  projectId: string;
  monitorName: string;
  sloName: string;
  sloDescription: string;
  sloId: string;
  monitorRuleName: string;
}

test.describe("SLOs", () => {
  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
    monitorName: "",
    sloName: "",
    sloDescription: "",
    sloId: "",
    monitorRuleName: "",
  };

  type SloUrlFunction = (path?: string) => string;

  // A page under this spec's SLO, e.g. sloUrl("/settings").
  const sloUrl: SloUrlFunction = (path?: string): string => {
    return projectUrl({
      projectId: ctx.projectId,
      path: `/slos/${ctx.sloId}${path || ""}`,
    });
  };

  type ReadSloArchiveStateFunction = () => Promise<JSONish>;

  /*
   * The persisted archive flags, read through the CRUD API. The UI assertions
   * around it prove what the user sees; this proves the row itself changed,
   * so a page that merely hid the SLO client-side could not pass.
   */
  const readSloArchiveState: ReadSloArchiveStateFunction =
    async (): Promise<JSONish> => {
      const rows: Array<JSONish> = await listItems({
        page: ctx.page,
        projectId: ctx.projectId,
        path: "/api/service-level-objective",
        query: { projectId: ctx.projectId, name: ctx.sloName },
        select: { _id: true, isArchived: true, archivedAt: true },
        limit: 2,
      });

      expect(rows, "exactly one SLO should carry this run's name").toHaveLength(
        1,
      );

      return rows[0]!;
    };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    ctx.page = await browser.newPage();
    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E SLO Project",
    });

    ctx.monitorName = `E2E SLO Monitor ${Faker.generateName().toString()}`;
    await createMonitor({
      page: ctx.page,
      projectId: ctx.projectId,
      monitorName: ctx.monitorName,
      recipe: manualMonitorRecipe,
    });

    ctx.sloName = `E2E SLO ${Faker.generateName().toString()}`;
    ctx.sloDescription = `Availability target created by Slo.spec.ts`;
    ctx.monitorRuleName = `E2E SLO Rule ${Faker.generateName().toString()}`;
  });

  test.afterAll(async () => {
    await ctx.page.close();
  });

  test("should reach the SLOs list page from the products menu", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    /*
     * The navbar shows the "Products" button only while no product is active
     * (otherwise it shows the active product's name), so start from the
     * project home page rather than from the monitor created in beforeAll.
     */
    const productsButton: Locator = page.getByRole("button", {
      name: "Products",
    });

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: projectUrl({ projectId: ctx.projectId, path: "/home" }),
      ready: productsButton,
    });

    await productsButton.click();

    const sloMenuOption: Locator = page
      .getByRole("option")
      .filter({ hasText: "SLOs" })
      .first();
    await expect(sloMenuOption).toBeVisible({ timeout: 30000 });
    await sloMenuOption.click();

    await page.waitForURL(new RegExp(`/dashboard/${ctx.projectId}/slos`), {
      timeout: 30000,
    });

    // The list page renders its ModelTable card and the create action.
    await expect(
      page.getByRole("button", { name: "Create Service Level Objective" }),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByText("Reliability targets measured from monitor uptime", {
        exact: false,
      }),
    ).toBeVisible({ timeout: 30000 });

    /*
     * Archived SLOs are filtered out of the list, so the side menu's Archived
     * entry is the only way back to one short of its URL.
     */
    await expect(
      page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Archived", exact: true }),
    ).toBeVisible({ timeout: 30000 });
  });

  test("should create an SLO through the four-step wizard and land on its overview", async () => {
    test.setTimeout(180000);
    const page: Page = ctx.page;

    const createButton: Locator = page.getByRole("button", {
      name: "Create Service Level Objective",
    });

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: projectUrl({ projectId: ctx.projectId, path: "/slos" }),
      ready: createButton,
    });

    await createButton.click();

    const modal: Locator = page.getByTestId("modal");
    await modal.waitFor({ state: "visible", timeout: 30000 });
    await expect(page.getByTestId("modal-title")).toContainText(
      "Service Level Objective",
    );

    // ModelTable names its create form after the model class.
    const form: Locator = page.locator("#create-ServiceLevelObjective-from");
    await form.waitFor({ state: "visible", timeout: 30000 });

    const submitButton: Locator = page.getByTestId(
      "modal-footer-submit-button",
    );
    const currentStep: Locator = form.locator('[aria-current="step"]');

    /*
     * Exactly four steps, in this order. There is no Monitors step any more:
     * monitors are attached on the SLO's Monitors page or by a monitor rule,
     * and how downtime is counted lives on Settings with server defaults.
     */
    await expect
      .poll(
        async (): Promise<Array<string>> => {
          return readStepRail(form);
        },
        { timeout: 30000 },
      )
      .toEqual(SLO_CREATE_STEPS);

    // Step 1 - Basic Info: name and description only.
    await expect(currentStep).toContainText("Basic Info");
    await expect(form.getByLabel("Name")).toBeVisible();
    await expect(form.getByLabel("Target (%)")).toHaveCount(0);
    await expect(
      form.getByRole("combobox", { name: /^Monitors\b/ }),
    ).toHaveCount(0);

    await form.getByLabel("Name").fill(ctx.sloName);
    await form.getByLabel("Description").fill(ctx.sloDescription);
    await expect(submitButton).toContainText("Next");
    await submitButton.click();

    /*
     * Step 2 - Objective: the target and the at-risk threshold that only
     * means something next to it. The window moved to its own step, so its
     * absence here catches a field assigned to the wrong step.
     */
    await expect(currentStep).toContainText("Objective");
    await expect(form.getByLabel("Target (%)")).toBeVisible();
    await expect(form.getByLabel("Window (Days)")).toHaveCount(0);
    // Seeded from SLO_CREATE_INITIAL_VALUES, the column's own default.
    await expect(form.getByLabel("At-Risk Threshold (%)")).toHaveValue("20");
    await form.getByLabel("Target (%)").fill("99.9");
    await submitButton.click();

    /*
     * Step 3 - Period: window type and its conditional fields. Timezone only
     * belongs to a calendar-month window, so a rolling window hides it.
     */
    await expect(currentStep).toContainText("Period");
    await expect(
      form.getByRole("combobox", { name: /^Window Type\b/ }),
    ).toBeVisible();
    await expect(
      form.getByRole("combobox", { name: /^Timezone\b/ }),
    ).toHaveCount(0);

    /*
     * Window (Days) is a free number field (the column accepts 1-366), and
     * it is prefilled with the default of 30 — set it explicitly anyway so
     * the assertions below are not asserting a default that could quietly
     * change.
     */
    const windowDaysInput: Locator = form.getByLabel("Window (Days)");
    await expect(windowDaysInput).toHaveValue("30");
    await windowDaysInput.fill("30");
    await submitButton.click();

    // Step 4 - Labels is the optional final step, so its button performs the create.
    await expect(currentStep).toContainText("Labels");
    await expect(
      form.getByRole("combobox", { name: "Labels (Optional)", exact: true }),
    ).toBeVisible();

    /*
     * The questions the wizard deliberately stopped asking. None of them may
     * come back on any step: each has a server default and a Settings card.
     */
    await expect(modal.getByText("Multi Monitor Mode")).toHaveCount(0);
    await expect(modal.getByText("Downtime Monitor Statuses")).toHaveCount(0);
    await expect(modal.getByText("Auto-Add Monitors With Labels")).toHaveCount(
      0,
    );

    await expect(submitButton).toContainText("Create Service Level Objective");
    await submitButton.click();
    await modal.waitFor({ state: "hidden", timeout: 90000 });

    /*
     * A new SLO measures nothing until it has monitors, so the list's
     * onCreateSuccess sends the user straight to the new SLO's overview
     * instead of leaving them to find the row.
     */
    const sloViewUrlRegex: RegExp = new RegExp(
      `/dashboard/${ctx.projectId}/slos/(${uuidPattern})/?(?:[?#].*)?$`,
      "i",
    );
    await page.waitForURL(sloViewUrlRegex, { timeout: 60000 });

    const sloIdMatch: RegExpMatchArray | null = page
      .url()
      .match(sloViewUrlRegex);
    expect(
      sloIdMatch,
      "creating an SLO should land on /slos/<id>",
    ).not.toBeNull();
    ctx.sloId = sloIdMatch![1]!;

    /*
     * The overview's hero describes what was just created: the target and
     * window chips, and a monitor count of zero. The headline is not pinned
     * to one string: it reads "Waiting for monitors" until the worker's first
     * pass, which may already have marked the monitor-less SLO Misconfigured.
     */
    const hero: Locator = page.getByTestId("slo-overview-hero");
    await expect(hero).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("slo-overview-headline")).toContainText(
      /Waiting for monitors|Cannot be evaluated/,
    );
    await expect(page.getByTestId("slo-overview-chip-target")).toContainText(
      "Target 99.9%",
    );
    await expect(page.getByTestId("slo-overview-chip-window")).toContainText(
      "Rolling 30 days",
    );
    await expect(page.getByTestId("slo-overview-chip-monitors")).toContainText(
      "No monitors",
    );

    /*
     * No monitors and no monitor rules: the overview offers both ways to
     * pick what the SLO measures instead of a wall of "not evaluated" tiles.
     */
    await expect(page.getByTestId("slo-overview-getting-started")).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByTestId("slo-kpi-strip")).toHaveCount(0);
  });

  test("should list the new SLO with its target and window, and open it from the row", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: projectUrl({ projectId: ctx.projectId, path: "/slos" }),
      ready: page.getByRole("button", {
        name: "Create Service Level Objective",
      }),
    });

    /*
     * The new row carries the name, the target and the window. Its status cell
     * renders a pill (a fresh SLO reads Unknown); the SLI / budget columns are
     * deliberately not asserted — they stay "—" until the evaluation worker
     * has run.
     */
    const sloRow: Locator = page
      .getByRole("row")
      .filter({ hasText: ctx.sloName });
    await expect(sloRow).toBeVisible({ timeout: 60000 });
    await expect(sloRow).toContainText("99.9%");
    await expect(sloRow).toContainText("30 days rolling");
    await expect(sloRow).toContainText(sloStatusRegex);

    await sloRow
      .getByRole("button", { name: "View Service Level Objective" })
      .click();

    await page.waitForURL(
      new RegExp(`/dashboard/${ctx.projectId}/slos/${ctx.sloId}/?$`, "i"),
      { timeout: 60000 },
    );
    await expect(page.getByTestId("slo-overview-hero")).toBeVisible({
      timeout: 60000,
    });
  });

  test("should show the overview's details card and every SLO tab", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    const detailsHeading: Locator = page.getByRole("heading", {
      name: "SLO Details",
    });

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: sloUrl(),
      ready: detailsHeading,
    });

    // The hero shows the description; the details card below edits it.
    await expect(page.getByTestId("slo-overview-hero")).toContainText(
      ctx.sloDescription,
      { timeout: 30000 },
    );
    await expect(
      page.getByRole("button", { name: "Edit Service Level Objective" }),
    ).toBeVisible({ timeout: 30000 });

    const sideMenu: Locator = page.getByRole("navigation", {
      name: "Main navigation",
    });
    for (const tabName of SLO_VIEW_TABS) {
      await expect(sideMenu.getByRole("link", { name: tabName })).toBeVisible({
        timeout: 30000,
      });
    }

    /*
     * Charts left the menu when its content became the Metrics page's
     * Error Budget History tab (the route itself still resolves for
     * bookmarks).
     */
    await expect(
      sideMenu.getByRole("link", { name: "Charts", exact: true }),
    ).toHaveCount(0);
  });

  test("should attach a monitor by hand on the Monitors page", async () => {
    test.setTimeout(180000);
    const page: Page = ctx.page;

    const addMonitorsButton: Locator = page.getByRole("button", {
      name: "Add Monitors",
      exact: true,
    });

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: sloUrl("/monitors"),
      ready: addMonitorsButton,
    });

    /*
     * Nothing attached and no monitor rule yet: the empty state says how to
     * attach monitors, and the "managed by rules" notice is absent.
     */
    await expect(
      page.getByText("No monitors attached. Add monitors by hand").first(),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("slo-monitors-managed-by-rules")).toHaveCount(
      0,
    );
    await expect(addMonitorsButton).toBeEnabled({ timeout: 30000 });

    await addMonitorsButton.click();

    const modal: Locator = page.getByTestId("modal");
    await modal.waitFor({ state: "visible", timeout: 30000 });
    await expect(page.getByTestId("modal-title")).toContainText("Add Monitors");

    /*
     * The add modal lists only the project's monitors that are not attached
     * yet, in a multi-select. Type the monitor's run-unique name and pick it
     * out of the results rather than relying on it being first.
     */
    const monitorsDropdown: Locator = modal.getByRole("combobox", {
      name: "Monitors",
      exact: true,
    });
    await monitorsDropdown.click();
    await monitorsDropdown.fill(ctx.monitorName);
    await page
      .getByRole("option", { name: ctx.monitorName })
      .first()
      .click({ timeout: 60000 });

    // The picked monitor becomes a removable chip — proof it was selected.
    await expect(
      modal.getByRole("button", { name: `Remove ${ctx.monitorName}` }),
    ).toBeVisible({ timeout: 30000 });

    /*
     * Move focus off the select so its menu cannot sit over the footer. The
     * modal title is inert, and Escape is avoided: the modal listens for it
     * too and would close the whole form.
     */
    await page.getByTestId("modal-title").click();

    const submitButton: Locator = modal.getByTestId(
      "modal-footer-submit-button",
    );
    await expect(submitButton).toContainText("Add Monitors");
    await submitButton.click();
    await modal.waitFor({ state: "hidden", timeout: 90000 });

    /*
     * The table lists exactly the SLO's monitors, with where each one came
     * from: this one was attached by hand, so it is Manual, not Rule.
     */
    const monitorRow: Locator = page
      .getByRole("row")
      .filter({ hasText: ctx.monitorName });
    await expect(monitorRow).toBeVisible({ timeout: 60000 });
    await expect(monitorRow).toContainText("Manual");
    await expect(
      page.getByText("1 monitor, all attached by hand").first(),
    ).toBeVisible({ timeout: 60000 });
  });

  test("should list the two burn rate rules seeded on create", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: sloUrl("/burn-rate-rules"),
      ready: page.getByRole("heading", { name: "Burn Rate Rules" }),
    });

    /*
     * Both canonical multi-window rules are created server-side by
     * ServiceLevelObjectiveService.onCreateSuccess, so seeing them here proves
     * that hook ran end-to-end. Their thresholds are derived from the window
     * (30 days -> 14.4x fast / 6x slow, the Google SRE workbook defaults) and
     * the "x" suffix is a unicode multiplication sign, so only the numbers are
     * asserted.
     */
    const fastBurnRow: Locator = page
      .getByRole("row")
      .filter({ hasText: "Fast burn" });
    await expect(fastBurnRow).toBeVisible({ timeout: 60000 });
    await expect(fastBurnRow).toContainText("14.4");
    await expect(fastBurnRow).toContainText(/60m\s*\/\s*5m/);
    await expect(fastBurnRow).toContainText("Enabled");

    const slowBurnRow: Locator = page
      .getByRole("row")
      .filter({ hasText: "Slow burn" });
    await expect(slowBurnRow).toBeVisible({ timeout: 30000 });
    await expect(slowBurnRow).toContainText(/360m\s*\/\s*30m/);
    await expect(slowBurnRow).toContainText("Enabled");

    /*
     * The seeded rules have no explicit suppression, so the table shows the
     * worker's own fallback (the long window) rather than a blank that would
     * read as "no suppression at all".
     */
    await expect(fastBurnRow).toContainText("Suppress 60m after resolve");
    await expect(slowBurnRow).toContainText("Suppress 360m after resolve");

    /*
     * lastAlertCreatedAt is null on a seeded rule, so both rules must say so
     * rather than rendering an empty cell that could be read as "firing".
     */
    await expect(fastBurnRow).toContainText("Never fired");
    await expect(slowBurnRow).toContainText("Never fired");

    // Neither seeded rule is attached to an on-call policy ("Alert: No escalation").
    await expect(fastBurnRow).toContainText("No escalation");
  });

  test("should render the alerts tab with no burn rate alerts yet", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    /*
     * The tab lists Alerts through their serviceLevelObjectives relation (a
     * burn rate alert names its SLO as an affected resource), so an SLO that
     * has never burnt budget must render the empty state rather than the
     * project's whole alert list — which is exactly what a broken query would
     * show.
     */
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: sloUrl("/alerts"),
      ready: page.getByRole("heading", { name: "Alerts" }),
    });

    await expect(
      page.getByText(/has not raised any alerts/i).first(),
    ).toBeVisible({ timeout: 60000 });
  });

  test("should render the metrics page and its error budget history tab", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    const historyTab: Locator = page.getByRole("tab", {
      name: "Error Budget History",
    });

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: sloUrl("/metrics"),
      ready: historyTab,
    });

    for (const tabName of [
      "SLO Metrics",
      "Error Budget History",
      "Incident Metrics",
      "Alert Metrics",
    ]) {
      await expect(page.getByRole("tab", { name: tabName })).toBeVisible({
        timeout: 30000,
      });
    }

    // The former Charts page body now lives on this tab.
    await historyTab.click();

    const sliCardHeading: Locator = page.getByRole("heading", {
      name: "SLI",
      exact: true,
    });

    /*
     * All three cards render inside a `!error` guard, so their presence is
     * also the assertion that the tab loaded without an API error.
     */
    await expect(sliCardHeading).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByRole("heading", { name: "Error Budget Remaining" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Burn Rate", exact: true }).first(),
    ).toBeVisible();

    /*
     * The range switcher is the shared RangeStartAndEndDateView, which renders
     * the currently selected range as its trigger. The default is Past 1 Month.
     */
    await expect(page.getByText("Past 1 Month").first()).toBeVisible({
      timeout: 30000,
    });

    /*
     * Either the chart or its empty state is acceptable: a seconds-old SLO
     * usually has no SloHistory rows yet, but the worker may have written the
     * first bucket already, in which case a real chart renders instead.
     * Asserting one specific outcome would flake on worker timing.
     */
    const emptyState: Locator = page.getByText(noChartHistoryText, {
      exact: false,
    });
    const renderedChart: Locator = page.locator(".recharts-surface");

    await expect
      .poll(
        async (): Promise<number> => {
          return (await emptyState.count()) + (await renderedChart.count());
        },
        {
          timeout: 60000,
          message:
            "the error budget history tab should render either a chart or the no-history empty state",
        },
      )
      .toBeGreaterThan(0);
  });

  test("should save an edit made from the overview details card", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    const editButton: Locator = page.getByRole("button", {
      name: "Edit Service Level Objective",
    });

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: sloUrl(),
      ready: editButton,
    });

    await editButton.click();

    const modal: Locator = page.getByTestId("modal");
    await modal.waitFor({ state: "visible", timeout: 30000 });

    const descriptionInput: Locator = modal.getByLabel("Description");
    // The edit form is prefilled from the saved model.
    await expect(descriptionInput).toHaveValue(ctx.sloDescription, {
      timeout: 60000,
    });
    await expect(modal.getByLabel("Name")).toHaveValue(ctx.sloName);

    /*
     * The details card is trimmed to what describes the SLO: name,
     * description and labels. What it measures is edited on Settings, so the
     * objective and period fields must not be offered here.
     */
    await expect(
      modal.getByRole("combobox", { name: /^Labels\b/ }),
    ).toBeVisible();
    await expect(modal.getByLabel("Target (%)")).toHaveCount(0);
    await expect(modal.getByLabel("Window (Days)")).toHaveCount(0);

    const updatedDescription: string = `Updated by Slo.spec.ts ${Faker.generateName().toString()}`;
    await descriptionInput.fill(updatedDescription);

    await page.getByTestId("modal-footer-submit-button").click();
    await modal.waitFor({ state: "hidden", timeout: 90000 });

    // The details card and the hero both re-read the saved model.
    await expect(page.getByTestId("slo-overview-hero")).toContainText(
      updatedDescription,
      { timeout: 60000 },
    );
    await expect(page.getByText(updatedDescription).first()).toBeVisible({
      timeout: 60000,
    });

    ctx.sloDescription = updatedDescription;
  });

  test("should change the target from the Settings page's Objective card", async () => {
    test.setTimeout(150000);
    const page: Page = ctx.page;

    const editObjectiveButton: Locator = page.getByRole("button", {
      name: "Edit Objective",
    });

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: sloUrl("/settings"),
      ready: editObjectiveButton,
    });

    /*
     * Settings owns how the SLO measures, including the downtime rules the
     * create wizard no longer asks about. A new SLO carries the server
     * default for them.
     */
    for (const cardTitle of [
      "Objective",
      "Compliance Period",
      "Downtime Calculation",
      "Evaluation",
      "Archive SLO",
    ]) {
      await expect(
        page.getByRole("heading", { name: cardTitle, exact: true }),
      ).toBeVisible({ timeout: 30000 });
    }

    const objectiveCard: Locator = page.locator("#slo-settings-objective");
    await expect(objectiveCard).toContainText("99.9%", { timeout: 60000 });
    await expect(page.locator("#slo-settings-period")).toContainText(
      "Rolling 30-day window",
      { timeout: 60000 },
    );
    await expect(page.locator("#slo-settings-downtime")).toContainText(
      "Any Monitor Down",
      { timeout: 60000 },
    );

    await editObjectiveButton.click();

    const modal: Locator = page.getByTestId("modal");
    await modal.waitFor({ state: "visible", timeout: 30000 });

    const targetInput: Locator = modal.getByLabel("Target (%)");
    await expect(targetInput).toHaveValue("99.9", { timeout: 60000 });
    // The period has a card of its own; this form edits the objective only.
    await expect(modal.getByLabel("Window (Days)")).toHaveCount(0);

    await targetInput.fill("99.95");
    await page.getByTestId("modal-footer-submit-button").click();
    await modal.waitFor({ state: "hidden", timeout: 90000 });

    /*
     * The card re-reads the saved row: the new target, and an error budget
     * recomputed from it over the same 30-day window.
     */
    await expect(objectiveCard).toContainText("99.95%", { timeout: 60000 });
    await expect(objectiveCard).toContainText("per 30-day window");

    // And the overview, which reads the same row, agrees.
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: sloUrl(),
      ready: page.getByTestId("slo-overview-hero"),
    });
    await expect(page.getByTestId("slo-overview-chip-target")).toContainText(
      "Target 99.95%",
      { timeout: 60000 },
    );
  });

  test("should create a monitor rule and lock hand-picked monitor adds while it is enabled", async () => {
    test.setTimeout(180000);
    const page: Page = ctx.page;

    const createRuleButton: Locator = page.getByRole("button", {
      name: "Create SLO Monitor Rule",
    });

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: sloUrl("/monitor-rules"),
      ready: createRuleButton,
    });

    await expect(
      page.getByText("No monitor rules on this SLO").first(),
    ).toBeVisible({ timeout: 60000 });

    await createRuleButton.click();

    const modal: Locator = page.getByTestId("modal");
    await modal.waitFor({ state: "visible", timeout: 30000 });

    const form: Locator = page.locator(
      "#create-ServiceLevelObjectiveMonitorRule-from",
    );
    await form.waitFor({ state: "visible", timeout: 30000 });

    const submitButton: Locator = page.getByTestId(
      "modal-footer-submit-button",
    );
    const currentStep: Locator = form.locator('[aria-current="step"]');

    await expect
      .poll(
        async (): Promise<Array<string>> => {
          return readStepRail(form);
        },
        { timeout: 30000 },
      )
      .toEqual(["Basic Info", "Match Criteria"]);

    // Step 1 - Basic Info. A rule is enabled by default.
    await expect(currentStep).toContainText("Basic Info");
    await form
      .getByPlaceholder("Every production API monitor")
      .fill(ctx.monitorRuleName);
    await expect(form.getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await submitButton.click();

    /*
     * Step 2 - Match Criteria. The rule model's legacy label / name /
     * description fields are replaced by the shared condition builder, which
     * starts empty. Add one condition and point it at the monitor's name.
     */
    await expect(currentStep).toContainText("Match Criteria");
    await expect(form.getByTestId("rule-criteria-builder")).toBeVisible({
      timeout: 30000,
    });
    await expect(form.getByTestId("rule-criteria-empty")).toBeVisible();

    await form
      .getByRole("button", { name: "Add condition", exact: true })
      .click();

    const criteriaDropdown: Locator = form.getByRole("combobox", {
      name: "Criteria for condition 1",
    });
    await criteriaDropdown.click();
    await page
      .getByRole("option", { name: "Monitor Name Pattern", exact: true })
      .click({ timeout: 30000 });

    // A pattern field defaults to "Matches pattern" (regex or * wildcard).
    const conditionRow: Locator = form.getByTestId("rule-criteria-row-0");
    await expect(conditionRow).toContainText("Matches pattern", {
      timeout: 30000,
    });

    /*
     * The monitor's run-unique name is a valid literal regex, so the rule
     * matches exactly the monitor already attached by hand. That monitor is
     * never adopted by the rule: it stays Manual.
     */
    await form
      .getByRole("textbox", { name: "Value for condition 1" })
      .fill(ctx.monitorName);

    await expect(submitButton).toContainText("Create SLO Monitor Rule");
    await submitButton.click();
    await modal.waitFor({ state: "hidden", timeout: 90000 });

    const ruleRow: Locator = page
      .getByRole("row")
      .filter({ hasText: ctx.monitorRuleName });
    await expect(ruleRow).toBeVisible({ timeout: 60000 });
    await expect(ruleRow).toContainText("Enabled");

    /*
     * While an enabled rule exists the rules own the SLO's monitor list: the
     * Monitors page says so and locks Add Monitors. The server guard refuses
     * the same write; the disabled button only keeps the page from offering
     * it.
     */
    const addMonitorsButton: Locator = page.getByRole("button", {
      name: "Add Monitors",
      exact: true,
    });

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: sloUrl("/monitors"),
      ready: page.getByTestId("slo-monitors-managed-by-rules"),
    });

    await expect(
      page.getByTestId("slo-monitors-managed-by-rules"),
    ).toContainText("This SLO's monitors are managed by its monitor rules");
    await expect(addMonitorsButton).toBeVisible({ timeout: 30000 });
    await expect(addMonitorsButton).toBeDisabled({ timeout: 30000 });

    // The hand-attached monitor is still listed, and still Manual.
    const monitorRow: Locator = page
      .getByRole("row")
      .filter({ hasText: ctx.monitorName });
    await expect(monitorRow).toBeVisible({ timeout: 60000 });
    await expect(monitorRow).toContainText("Manual");
  });

  test("should archive the SLO from Settings, list it as archived, and unarchive it", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;

    const archiveButton: Locator = page.getByRole("button", {
      name: "Archive",
      exact: true,
    });

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: sloUrl("/settings"),
      ready: archiveButton,
    });

    expect((await readSloArchiveState())["isArchived"]).toBe(false);

    await expect(archiveButton).toBeEnabled({ timeout: 30000 });
    await archiveButton.click();

    const modal: Locator = page.getByTestId("modal");
    await modal.waitFor({ state: "visible", timeout: 30000 });

    /*
     * The confirmation uses SLO copy, not the telemetry default ("keeps
     * collecting telemetry"): an archived SLO stops being evaluated.
     */
    await expect(page.getByTestId("confirm-modal-description")).toContainText(
      "stop being evaluated",
    );
    await modal.getByTestId("modal-footer-submit-button").click();

    // Archiving sends the user back to the list, where the SLO is now hidden.
    await page.waitForURL(new RegExp(`/dashboard/${ctx.projectId}/slos/?$`), {
      timeout: 60000,
    });
    await expect(
      page.getByRole("button", { name: "Create Service Level Objective" }),
    ).toBeVisible({ timeout: 60000 });

    /*
     * Wait for the table's empty state before asserting the row is gone, so a
     * still-loading table cannot make this pass vacuously. This project's
     * only SLO is the archived one.
     */
    await expect(page.getByText(/No SLOs yet/i).first()).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByText(ctx.sloName)).toHaveCount(0);

    const archivedState: JSONish = await readSloArchiveState();
    expect(archivedState["isArchived"]).toBe(true);
    expect(
      archivedState["archivedAt"],
      "the server stamps archivedAt on archive",
    ).toBeTruthy();

    // The Archived page, reached through the list's side menu, lists it.
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Archived", exact: true })
      .click();
    await page.waitForURL(
      new RegExp(`/dashboard/${ctx.projectId}/slos/archived/?$`),
      { timeout: 60000 },
    );
    await expect(
      page.getByRole("heading", { name: "Archived SLOs" }),
    ).toBeVisible({ timeout: 60000 });

    const archivedRow: Locator = page
      .getByRole("row")
      .filter({ hasText: ctx.sloName });
    await expect(archivedRow).toBeVisible({ timeout: 60000 });
    await expect(archivedRow).toContainText("99.95%");

    // An archived SLO stays reachable by URL, and its Settings page says so.
    const unarchiveButton: Locator = page.getByRole("button", {
      name: "Unarchive",
      exact: true,
    });

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: sloUrl("/settings"),
      ready: unarchiveButton,
    });

    const archivedBanner: Locator = page
      .getByTestId("slo-notice-banner")
      .filter({ hasText: "This SLO is archived" });
    await expect(archivedBanner).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByRole("heading", { name: "Unarchive SLO", exact: true }),
    ).toBeVisible({ timeout: 30000 });

    await unarchiveButton.click();
    await modal.waitFor({ state: "visible", timeout: 30000 });

    // Archive and enabled are separate flags, and the copy says so.
    await expect(page.getByTestId("confirm-modal-description")).toContainText(
      "stays disabled",
    );
    await modal.getByTestId("modal-footer-submit-button").click();
    await modal.waitFor({ state: "hidden", timeout: 90000 });

    // Unarchiving stays on Settings, flips the card back and clears the banner.
    await expect(archiveButton).toBeVisible({ timeout: 60000 });
    expect(page.url()).toContain(`/slos/${ctx.sloId}/settings`);
    await expect(archivedBanner).toHaveCount(0, { timeout: 60000 });

    expect((await readSloArchiveState())["isArchived"]).toBe(false);

    // And the SLO is back on the list.
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: projectUrl({ projectId: ctx.projectId, path: "/slos" }),
      ready: page.getByRole("button", {
        name: "Create Service Level Objective",
      }),
    });
    await expect(
      page.getByRole("row").filter({ hasText: ctx.sloName }),
    ).toBeVisible({ timeout: 60000 });
  });

  test("should delete the SLO and drop it from the list", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    const deleteButton: Locator = page.getByRole("button", {
      name: "Delete Service Level Objective",
    });

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: sloUrl("/delete"),
      ready: deleteButton,
    });

    await deleteButton.click();

    // The confirm modal repeats the button title, so submit by its test id.
    const modal: Locator = page.getByTestId("modal");
    await modal.waitFor({ state: "visible", timeout: 30000 });
    await page.getByTestId("modal-footer-submit-button").click();

    // Deleting navigates back to the list.
    await page.waitForURL(new RegExp(`/dashboard/${ctx.projectId}/slos/?$`), {
      timeout: 60000,
    });
    await expect(
      page.getByRole("button", { name: "Create Service Level Objective" }),
    ).toBeVisible({ timeout: 60000 });

    /*
     * Wait for the table to render its empty state before asserting the row is
     * gone, so a still-loading table cannot make this pass vacuously.
     */
    await expect(page.getByText(/No SLOs yet/i).first()).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByText(ctx.sloName)).toHaveCount(0);
  });
});
