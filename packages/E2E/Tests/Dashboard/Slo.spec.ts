import { BASE_URL } from "../../Config";
import { Browser, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import { getCardButton } from "../Helpers/CardButton";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { createMonitor, MonitorTypeRecipe } from "./Helpers/Monitors";
import { JSONish, listItems } from "./Helpers/MonitorAlerting";

/*
 * SLOs (Service Level Objectives) end-to-end coverage for the dashboard
 * product area: products menu -> list -> one-page create form -> overview
 * -> attach a monitor -> burn rate rules, alerts and metrics -> edit the
 * details card -> save a Settings card -> monitor rules lock hand edits ->
 * archive and unarchive -> delete.
 *
 * One project and one monitor are created up front (serial mode + shared
 * page). The create form does not ask for monitors, so the monitor is
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
 *   cd packages/E2E && HOST=localhost npx playwright test \
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

/*
 * A side-menu section's toggle, by its heading's text (the heading is drawn
 * in capitals by CSS). Rarely used sections start folded away in every menu:
 * Advanced on the SLO list (it holds Archived), and Configuration and
 * Management on an SLO's own page. Their rows are hidden, so getByRole does
 * not find them until the section is opened.
 */
type SectionLocatorFunction = (page: Page, title: string) => Locator;

const sideMenuSectionToggle: SectionLocatorFunction = (
  page: Page,
  title: string,
): Locator => {
  return page
    .getByRole("navigation", { name: "Main navigation" })
    .locator(`xpath=.//h6[normalize-space(.)='${title}']/ancestor::button[1]`);
};

type MenuLocatorFunction = (page: Page) => Locator;

const sideMenuAdvancedToggle: MenuLocatorFunction = (page: Page): Locator => {
  return sideMenuSectionToggle(page, "Advanced");
};

/*
 * The SLO list card's own Create button. The list is empty on a new project,
 * and again once this spec archives or deletes its only SLO, and an empty
 * list offers the same button again under its "No SLOs yet" message.
 */
type CreateSloButtonFunction = (page: Page) => Locator;

const createSloButton: CreateSloButtonFunction = (page: Page): Locator => {
  return getCardButton(page, "Create Service Level Objective");
};

type OpenSideMenuSectionFunction = (page: Page, title: string) => Promise<void>;

const openSideMenuSection: OpenSideMenuSectionFunction = async (
  page: Page,
  title: string,
): Promise<void> => {
  const toggle: Locator = sideMenuSectionToggle(page, title);

  await expect(toggle).toBeVisible({ timeout: 30000 });

  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }

  await expect(toggle).toHaveAttribute("aria-expanded", "true");
};

type OpenSideMenuAdvancedFunction = (page: Page) => Promise<void>;

const openSideMenuAdvanced: OpenSideMenuAdvancedFunction = async (
  page: Page,
): Promise<void> => {
  await openSideMenuSection(page, "Advanced");
};

// The SLO view menu's sections that start folded on its overview.
const SLO_VIEW_FOLDED_SECTIONS: Array<string> = ["Configuration", "Management"];

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
    await expect(createSloButton(page)).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByText("Reliability targets measured from monitor uptime", {
        exact: false,
      }),
    ).toBeVisible({ timeout: 30000 });

    /*
     * Archived SLOs are filtered out of the list, so the side menu's Archived
     * entry is the only way back to one short of its URL. It waits in the
     * Advanced section, folded away until that is opened.
     */
    const archivedLink: Locator = page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Archived", exact: true });
    const advancedToggle: Locator = sideMenuAdvancedToggle(page);

    await expect(advancedToggle).toHaveAttribute("aria-expanded", "false", {
      timeout: 30000,
    });
    await expect(archivedLink).toBeHidden();

    await advancedToggle.click();

    await expect(advancedToggle).toHaveAttribute("aria-expanded", "true");
    await expect(archivedLink).toBeVisible({ timeout: 30000 });
  });

  test("should create an SLO from one short form and land on its overview", async () => {
    test.setTimeout(180000);
    const page: Page = ctx.page;

    const createButton: Locator = createSloButton(page);

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

    /*
     * One page of three rows: the name, the target and the folded More
     * fields section. There is no step list and no Next - the target was the only
     * thing without a default, and it comes prefilled - so the one button
     * creates. No Monitors field either: monitors are attached on the SLO's
     * Monitors page or by a monitor rule.
     */
    await expect(form.getByLabel("Name", { exact: true })).toBeVisible();
    await expect(form.locator('nav[aria-label="Progress"]')).toHaveCount(0);
    await expect(page.getByTestId("modal-footer-next-button")).toHaveCount(0);
    await expect(submitButton).toContainText("Create Service Level Objective");
    // The suggested target, there to see and change.
    await expect(form.getByLabel("Target (%)")).toHaveValue("99.9");
    await expect(
      form.getByRole("combobox", { name: /^Monitors\b/ }),
    ).toHaveCount(0);

    /*
     * More fields is folded, names what it holds, and says what its
     * defaults do instead of hiding them: the window the target is measured
     * over, and when it warns.
     */
    const advancedHeader: Locator = form.getByRole("button", {
      name: "More fields",
      exact: true,
    });
    const labelsInput: Locator = form.getByRole("combobox", {
      name: "Labels (Optional)",
      exact: true,
    });
    /*
     * An optional field's label ends in "(Optional)", so the description is
     * named in full, as the labels are: "Description" alone, exact, matches
     * nothing.
     */
    const descriptionInput: Locator = form.getByRole("textbox", {
      name: "Description (Optional)",
      exact: true,
    });
    const atRiskInput: Locator = form.getByLabel("At-Risk Threshold (%)");
    await expect(advancedHeader).toHaveAttribute("aria-expanded", "false");
    await expect(form.getByTestId("collapsible-section-summary")).toHaveText(
      "Measured over a rolling 30-day window, and At Risk when less than 20% of the error budget is left.",
    );
    // What is inside, by name, on the folded header.
    await expect(form.getByTestId("folded-section-contents")).toContainText(
      "Description",
    );
    await expect(labelsInput).toBeHidden();
    await expect(descriptionInput).toBeHidden();
    await expect(atRiskInput).toBeHidden();

    await form.getByLabel("Name", { exact: true }).fill(ctx.sloName);

    /*
     * Opened, it holds the description, the at-risk threshold, the window
     * and the labels, at the column defaults. Timezone only belongs to a
     * calendar-month window, so a rolling window hides it.
     */
    await advancedHeader.click();
    await expect(advancedHeader).toHaveAttribute("aria-expanded", "true");
    await expect(labelsInput).toBeVisible();
    await expect(atRiskInput).toHaveValue("20");
    await expect(
      form.getByRole("combobox", { name: /^Window Type\b/ }),
    ).toBeVisible();
    await expect(
      form.getByRole("combobox", { name: /^Timezone\b/ }),
    ).toHaveCount(0);

    /*
     * Window (Days) is a free number field (the column accepts 1-366),
     * prefilled with the default of 30. The overview's window chip below
     * checks what was saved.
     */
    await expect(form.getByLabel("Window (Days)")).toHaveValue("30");
    await descriptionInput.fill(ctx.sloDescription);

    /*
     * The questions the form deliberately does not ask. None of them may
     * come back: each has a server default and a Settings card.
     */
    await expect(modal.getByText("Multi Monitor Mode")).toHaveCount(0);
    await expect(modal.getByText("Downtime Monitor Statuses")).toHaveCount(0);
    await expect(modal.getByText("Auto-Add Monitors With Labels")).toHaveCount(
      0,
    );

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
      "99.9%",
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
    /*
     * The Configuration and Monitors cards are gone from the overview. Card
     * titles are <h2>; the side menu's own "Configuration" section is an <h6>
     * and must not count.
     */
    await expect(
      page.getByRole("heading", {
        name: "Configuration",
        exact: true,
        level: 2,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Monitors", exact: true, level: 2 }),
    ).toHaveCount(0);
  });

  test("should list the new SLO with its target and window, and open it from the row", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: projectUrl({ projectId: ctx.projectId, path: "/slos" }),
      ready: createSloButton(page),
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

    /*
     * Configuration and Management are folded down to their titles on the
     * overview, like every rarely used section: their pages are hidden until
     * the section is opened.
     */
    for (const section of SLO_VIEW_FOLDED_SECTIONS) {
      await expect(sideMenuSectionToggle(page, section)).toHaveAttribute(
        "aria-expanded",
        "false",
        { timeout: 30000 },
      );
    }
    const burnRateRulesRow: Locator = sideMenu.locator(
      "a[href$='/burn-rate-rules']",
    );
    await expect(burnRateRulesRow).toHaveCount(1);
    await expect(burnRateRulesRow).toBeHidden();

    for (const section of SLO_VIEW_FOLDED_SECTIONS) {
      await openSideMenuSection(page, section);
    }

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

    /*
     * The Monitors card's own button: with nothing attached the list is
     * empty, and offers the same button again under its message.
     */
    const addMonitorsButton: Locator = getCardButton(page, "Add Monitors");

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
    /*
     * The page's two sentences are the empty state's title and its
     * description, two lines apart.
     */
    await expect(
      page.getByText("No monitors attached", { exact: true }).first(),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("Add monitors by hand").first()).toBeVisible();
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

  test("should keep configured SLO overviews focused on health and activity", async () => {
    test.setTimeout(120000);
    const page: Page = ctx.page;

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: sloUrl(),
      ready: page.getByTestId("slo-kpi-strip"),
    });

    await expect(page.getByTestId("slo-overview-chip-monitors")).toContainText(
      "1 monitor",
    );
    await expect(page.getByTestId("slo-overview-getting-started")).toHaveCount(
      0,
    );
    // Card titles only (<h2>); the side menu's section headings are <h6>.
    await expect(
      page.getByRole("heading", {
        name: "Configuration",
        exact: true,
        level: 2,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Monitors", exact: true, level: 2 }),
    ).toHaveCount(0);
    await expect(page.getByTestId("slo-configuration-summary")).toHaveCount(0);
    await expect(
      page.getByRole("list", { name: "Monitors measured by this SLO" }),
    ).toHaveCount(0);

    /*
     * The monitors and settings live in the side menu instead, under
     * Configuration and Management, which start folded on the overview.
     */
    const sideMenu: Locator = page.getByRole("navigation", {
      name: "Main navigation",
    });
    for (const section of SLO_VIEW_FOLDED_SECTIONS) {
      await openSideMenuSection(page, section);
    }
    for (const tabName of ["Monitors", "Settings"]) {
      await expect(sideMenu.getByRole("link", { name: tabName })).toBeVisible();
    }
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
    /*
     * The card's title, exactly: the empty state's own heading ("This SLO
     * has not raised any alerts") has the word in it too.
     */
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: sloUrl("/alerts"),
      ready: page.getByRole("heading", { name: "Alerts", exact: true }),
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
     * description and labels (folded under More fields, as on the
     * create form). What it measures is edited on Settings, so the objective and
     * period fields must not be offered here.
     */
    const labelsInput: Locator = modal.getByRole("combobox", {
      name: /^Labels\b/,
    });
    await expect(labelsInput).toBeHidden();
    await modal
      .getByRole("button", { name: "More fields", exact: true })
      .click();
    await expect(labelsInput).toBeVisible();
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
     * create form does not ask about. A new SLO carries the server default
     * for them.
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
      "99.95%",
      { timeout: 60000 },
    );
  });

  test("should create a monitor rule and lock hand-picked monitor adds while it is enabled", async () => {
    test.setTimeout(180000);
    const page: Page = ctx.page;

    /*
     * The Monitor Rules card's own Create button: the SLO has no rule yet,
     * and an empty list offers the same button again under its message.
     */
    const createRuleButton: Locator = getCardButton(
      page,
      "Create SLO Monitor Rule",
    );

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

    /*
     * Step 1 - Basic Info. A rule starts enabled, so the create form does not
     * ask: the Enabled switch is on the rule's edit form only. The row below
     * says Enabled once it is saved.
     */
    await expect(currentStep).toContainText("Basic Info");
    await form
      .getByPlaceholder("Every production API monitor")
      .fill(ctx.monitorRuleName);
    await expect(form.getByRole("switch")).toHaveCount(0);
    // Create SLO Monitor Rule is on the last step only: a plain Next here.
    await expect(submitButton).toHaveCount(0);
    await page.getByTestId("modal-footer-next-button").click();

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
      .getByRole("option", { name: "Monitor Name", exact: true })
      .click({ timeout: 30000 });

    /*
     * A new text condition starts on "Contains" - patterns are one operator
     * away - and stores into the monitorNamePattern column all the same.
     */
    const conditionRow: Locator = form.getByTestId("rule-criteria-row-0");
    await expect(conditionRow).toContainText("Contains", {
      timeout: 30000,
    });

    /*
     * The monitor's name is unique to this run, so containing it matches
     * exactly the monitor already attached by hand. That monitor is never
     * adopted by the rule: it stays Manual.
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
    const addMonitorsButton: Locator = getCardButton(page, "Add Monitors");

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
    await expect(createSloButton(page)).toBeVisible({ timeout: 60000 });

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

    /*
     * The Archived page, reached through the list's side menu, lists it. Its
     * entry waits in the menu's Advanced section, folded away until opened.
     */
    await openSideMenuAdvanced(page);
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
      ready: createSloButton(page),
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
    await expect(createSloButton(page)).toBeVisible({ timeout: 60000 });

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
