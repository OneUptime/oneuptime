import { BASE_URL } from "../../Config";
import { Browser, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { createMonitor, MonitorTypeRecipe } from "./Helpers/Monitors";

/*
 * SLOs (Service Level Objectives) end-to-end coverage for the dashboard
 * product area: products menu -> list -> create -> view (hero, charts, burn
 * rate rules) -> edit -> delete.
 *
 * One project and one monitor are created up front (serial mode + shared page)
 * because an SLO cannot be created without at least one monitor to measure.
 * Each step is its own test so a failure points at exactly one interaction
 * instead of failing an opaque mega-test; serial mode means the later steps
 * are skipped once an earlier one breaks.
 *
 * Anti-flake notes:
 * - run-unique names (Faker.generateName() is a 10 char token), so a re-run
 *   never collides with rows left behind by a previous run
 * - nothing asserts an evaluated SLI / error-budget *number*: the evaluation
 *   worker runs on its own schedule and may not have touched a seconds-old
 *   SLO yet. The spec asserts the shape of the page (hero, status pill,
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
 * A Manual monitor is the cheapest monitor to create (single wizard step, no
 * criteria and no interval) and is enough for an SLO to reference — the SLO
 * only needs monitors to attach, it does not need them to have reported yet.
 */
const manualMonitorRecipe: MonitorTypeRecipe = {
  label: "Manual",
  cardValue: "Manual",
  hasInterval: false,
  singleStep: true,
};

const uuidPattern: string =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/*
 * Every value of SloStatus, plus the two pills the UI adds on top of it:
 * "Unknown" for an SLO the worker has not evaluated yet (the usual state
 * for a seconds-old SLO) and "Disabled" for one that is switched off.
 * The pill shows one of these, never a number.
 */
const sloStatusRegex: RegExp =
  /Healthy|At Risk|Budget Exhausted|Misconfigured|Paused|Unknown|Disabled/;

// The empty state SloCharts renders when no SloHistory rows exist in range.
const noChartHistoryText: string = "No history in this range";

type ProjectUrlFunction = (data: { projectId: string; path: string }) => string;

const projectUrl: ProjectUrlFunction = (data: {
  projectId: string;
  path: string;
}): string => {
  return URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${data.projectId}${data.path}`)
    .toString();
};

interface SharedContext {
  page: Page;
  projectId: string;
  monitorName: string;
  sloName: string;
  sloDescription: string;
  sloId: string;
}

test.describe("SLOs", () => {
  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
    monitorName: "",
    sloName: "",
    sloDescription: "",
    sloId: "",
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
  });

  test("should create an SLO with a target, window and monitor attached", async () => {
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

    /*
     * Monitors is an EntityDropdown (server-side typeahead), so type the
     * monitor's run-unique name and pick it out of the results rather than
     * relying on it being on the first page of options.
     *
     * `exact` is load-bearing: accessible-name matching is a substring match
     * by default, and the form gained "Auto-Add Monitors With Labels" — the
     * label rule that keeps this list in step with a label — directly below
     * this field. Without it the locator matches both comboboxes and fails
     * on strict mode rather than picking the one meant here.
     */
    const monitorsDropdown: Locator = form.getByRole("combobox", {
      name: "Monitors",
      exact: true,
    });
    await monitorsDropdown.click();
    await monitorsDropdown.fill(ctx.monitorName);
    await page
      .getByRole("option", { name: ctx.monitorName })
      .first()
      .click({ timeout: 60000 });

    // The picked monitor becomes a removable chip — proof it was attached.
    await expect(
      page.getByRole("button", { name: `Remove ${ctx.monitorName}` }),
    ).toBeVisible({ timeout: 30000 });

    /*
     * A multi-select popover stays open after a pick, and it is positioned
     * `fixed`, so it can end up on top of the fields below it or of the
     * modal's submit button — which would make those clicks time out on the
     * hit-target check. Only a mousedown outside the dropdown closes it, and
     * it is dispatched rather than clicked so this does not itself depend on
     * where the popover happened to be laid out. Escape is avoided: the modal
     * listens for it too and would close the whole form.
     */
    await page.getByTestId("modal-title").dispatchEvent("mousedown");
    await expect(page.getByTestId("entity-dropdown-menu")).toHaveCount(0);

    await form.getByLabel("Name").fill(ctx.sloName);
    await form.getByLabel("Description").fill(ctx.sloDescription);
    await form.getByLabel("Target (%)").fill("99.9");

    /*
     * Window (Days) is a free number field (the column accepts 1-366), and
     * it is prefilled with the model default of 30 — set it explicitly
     * anyway so the row assertion below is not asserting a default that
     * could quietly change.
     */
    await form.getByLabel("Window (Days)").fill("30");

    await page.getByTestId("modal-footer-submit-button").click();
    await modal.waitFor({ state: "hidden", timeout: 90000 });

    /*
     * The new row carries the name, the target and the window. Its status cell
     * renders a pill with one of the SloStatus values (a fresh SLO defaults to
     * Healthy); the SLI / budget columns are deliberately not asserted — they
     * stay "—" until the evaluation worker has run.
     */
    const sloRow: Locator = page
      .getByRole("row")
      .filter({ hasText: ctx.sloName });
    await expect(sloRow).toBeVisible({ timeout: 60000 });
    await expect(sloRow).toContainText("99.9%");
    await expect(sloRow).toContainText("30 days rolling");
    await expect(sloRow).toContainText(sloStatusRegex);
  });

  test("should open the SLO and show the error budget hero, details and tabs", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    const sloRow: Locator = page
      .getByRole("row")
      .filter({ hasText: ctx.sloName });
    await sloRow
      .getByRole("button", { name: "View Service Level Objective" })
      .click();

    const sloViewUrlRegex: RegExp = new RegExp(
      `/dashboard/${ctx.projectId}/slos/${uuidPattern}`,
      "i",
    );
    await page.waitForURL(sloViewUrlRegex, { timeout: 60000 });

    const sloIdMatch: RegExpMatchArray | null = page
      .url()
      .match(new RegExp(`/slos/(${uuidPattern})`, "i"));
    expect(
      sloIdMatch,
      "the view action should land on /slos/<id>",
    ).not.toBeNull();
    ctx.sloId = sloIdMatch![1]!;

    // Error budget hero: SLI vs target, budget, burn rate, status, evaluation.
    const hero: Locator = page.getByTestId("slo-error-budget-hero");
    await expect(hero).toBeVisible({ timeout: 60000 });
    await expect(hero).toContainText("Current SLI");
    await expect(hero).toContainText("Target 99.9%");
    await expect(hero).toContainText("Error Budget Remaining");
    await expect(hero).toContainText("Burn Rate");
    await expect(hero).toContainText(sloStatusRegex);

    // The details card renders the saved configuration.
    await expect(
      page.getByRole("heading", { name: "SLO Details" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(ctx.sloDescription).first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText(ctx.monitorName).first()).toBeVisible({
      timeout: 30000,
    });

    // Side menu tabs for the SLO.
    const sideMenu: Locator = page.getByRole("navigation", {
      name: "Main navigation",
    });
    for (const tabName of [
      "Overview",
      "Charts",
      "Burn Rate Rules",
      "Alerts",
      "Audit Logs",
      "Owners",
      "Delete SLO",
    ]) {
      await expect(sideMenu.getByRole("link", { name: tabName })).toBeVisible({
        timeout: 30000,
      });
    }
  });

  test("should list the two burn rate rules seeded on create", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: projectUrl({
        projectId: ctx.projectId,
        path: `/slos/${ctx.sloId}/burn-rate-rules`,
      }),
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

    // Neither seeded rule is attached to an on-call policy.
    await expect(fastBurnRow).toContainText("No escalation");
  });

  test("should render the alerts tab with no burn rate alerts yet", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    /*
     * The tab queries Alerts by the fingerprint the worker stamps
     * (`slo:<sloId>:burn-rule:<ruleId>`), so an SLO that has never burnt
     * budget must render the empty state rather than the project's whole
     * alert list — which is exactly what a broken query would show.
     */
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: projectUrl({
        projectId: ctx.projectId,
        path: `/slos/${ctx.sloId}/alerts`,
      }),
      ready: page.getByRole("heading", { name: "Alerts" }),
    });

    await expect(
      page.getByText(/has not raised any alerts/i).first(),
    ).toBeVisible({ timeout: 60000 });
  });

  test("should render the charts tab", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    const sliCardHeading: Locator = page.getByRole("heading", {
      name: "SLI",
      exact: true,
    });

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: projectUrl({
        projectId: ctx.projectId,
        path: `/slos/${ctx.sloId}/charts`,
      }),
      ready: sliCardHeading,
    });

    /*
     * All three cards render inside a `!error` guard, so their presence is
     * also the assertion that the page loaded without an API error.
     */
    await expect(sliCardHeading).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Error Budget Remaining" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Burn Rate", exact: true }),
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
     * usually has no SloHistory rows yet ("No history yet — the SLO is
     * evaluated every few minutes."), but the worker may have written the
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
            "the charts tab should render either a chart or the no-history empty state",
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
      url: projectUrl({
        projectId: ctx.projectId,
        path: `/slos/${ctx.sloId}`,
      }),
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

    const updatedDescription: string = `Updated by Slo.spec.ts ${Faker.generateName().toString()}`;
    await descriptionInput.fill(updatedDescription);
    await modal.getByLabel("Target (%)").fill("99.95");

    await page.getByTestId("modal-footer-submit-button").click();
    await modal.waitFor({ state: "hidden", timeout: 90000 });

    // The details card and the hero both re-read the saved model.
    await expect(page.getByText(updatedDescription).first()).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByText("99.95%").first()).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByTestId("slo-error-budget-hero")).toContainText(
      "Target 99.95%",
      { timeout: 60000 },
    );

    ctx.sloDescription = updatedDescription;
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
      url: projectUrl({
        projectId: ctx.projectId,
        path: `/slos/${ctx.sloId}/delete`,
      }),
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
