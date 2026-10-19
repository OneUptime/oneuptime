import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * The Security Events SOC pages - the overview, the case queue, a case,
 * entities, the rule library, ATT&CK coverage, playbooks, a playbook and the
 * runs - on the fixture's synthetic month (Fixture/Fixture.js). What the
 * unit tests cannot see: that the pages fit beside the side menu at every
 * size, read right in both themes, agree with each other on the numbers,
 * and that approving a held playbook step runs the rest of it.
 *
 * Every test pins the clock and puts up a network fence that aborts anything
 * leaving the fixture server. afterEach fails a test on an uncaught page
 * error, on any request the fence had to abort, and on anything the fixture
 * does not model.
 */

const PORT: string = process.env["SECURITY_OPERATIONS_FIXTURE_PORT"] || "4234";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");

const PRODUCT: string = `/dashboard/${PROJECT_ID}/security-events`;
const OVERVIEW_PATH: string = `${PRODUCT}/overview`;
const CASES_PATH: string = `${PRODUCT}/cases`;
const SPRAY_CASE_PATH: string = `${PRODUCT}/cases/20000000-0000-4000-8000-000000000142`;
const ENTITIES_PATH: string = `${PRODUCT}/entities`;
const RULE_LIBRARY_PATH: string = `${PRODUCT}/rule-library`;
const ATTACK_COVERAGE_PATH: string = `${PRODUCT}/attack-coverage`;
const PLAYBOOKS_PATH: string = `${PRODUCT}/playbooks`;
const CONTAIN_PLAYBOOK_PATH: string = `${PRODUCT}/playbooks/24000000-0000-4000-8000-000000000003`;
const RUNS_PATH: string = `${PRODUCT}/playbook-runs`;

const WAITING_RUN_ID: string = "25000000-0000-4000-8000-000000000001";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/security-operations-ui",
);

interface FixtureState {
  apiRequests: Array<{ method: string; url: string; body: unknown }>;
  listRequests: Array<{ modelName: string; query: unknown }>;
  unhandled: Array<unknown>;
}

interface OpenOptions {
  width?: number;
  height?: number;
  theme?: "dark";
  empty?: boolean;
  quiet?: boolean;
  role?: "viewer";
}

test.use({ deviceScaleFactor: 2, actionTimeout: 15000 });

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing the page asks for may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    aborted.push(route.request().url());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const hasFixture: boolean = await page
    .evaluate((): boolean => {
      return Boolean(
        (window as unknown as { __securityOperationsFixture?: unknown })
          .__securityOperationsFixture,
      );
    })
    .catch((): boolean => {
      return false;
    });
  if (hasFixture) {
    expect(
      (await fixture(page)).unhandled,
      "requests the fixture does not model",
    ).toEqual([]);
  }
});

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

async function open(
  page: Page,
  pathname: string,
  options: OpenOptions = {},
): Promise<void> {
  await page.setViewportSize({
    width: options.width || 1440,
    height: options.height || 1000,
  });
  // The fixture's month of history is relative to NOW.
  await page.clock.setFixedTime(NOW);
  const params: URLSearchParams = new URLSearchParams();
  if (options.theme === "dark") {
    params.set("theme", "dark");
  }
  if (options.empty) {
    params.set("empty", "1");
  }
  if (options.quiet) {
    params.set("quiet", "1");
  }
  if (options.role) {
    params.set("role", options.role);
  }
  const query: string = params.toString();
  await page.goto(query ? `${pathname}?${query}` : pathname);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.load("600 14px Inter");
    await document.fonts.ready;
  });
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __securityOperationsFixture: FixtureState;
          }
        ).__securityOperationsFixture,
      ),
    ) as FixtureState;
  });
}

async function screenshot(
  page: Page,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: options.fullPage !== false,
    animations: "disabled",
  });
}

// How far the page, or an element, scrolls sideways.
async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

async function overflowOf(locator: Locator): Promise<number> {
  return locator.evaluate((element: Element): number => {
    return element.scrollWidth - element.clientWidth;
  });
}

// The table body's rows, by the case or playbook each one names.
async function rowTexts(page: Page): Promise<Array<string>> {
  return page.locator("table tbody tr").allInnerTexts();
}

function sideMenuLink(page: Page, title: string): Locator {
  return page.getByRole("link", { name: title, exact: false }).filter({
    hasText: title,
  });
}

// One stage of the Overview's pipeline: Sources, Detections, Security Cases, Playbooks.
function stage(page: Page, key: string): Locator {
  return page.getByTestId(`security-pipeline-${key}`);
}

function gettingStarted(page: Page): Locator {
  return page.getByTestId("security-getting-started");
}

// The tabs across the top of a page whose menu entry holds several.
function tabs(page: Page): Locator {
  return page.getByTestId("security-events-tabs");
}

/*
 * ---------------------------------------------------------------------------
 * Overview
 * ---------------------------------------------------------------------------
 */

test.describe("the overview", () => {
  test("says what needs someone now, each count in words that agree with it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH);

    await expect(
      page.getByRole("link", { name: "2 open cases assigned to you" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "2 open cases nobody has picked up" }),
    ).toBeVisible();
    // One step: singular, not "1 playbook steps".
    await expect(
      page.getByRole("link", { name: "1 playbook step waiting for approval" }),
    ).toBeVisible();

    await expect(page.getByText("2 critical · 2 high")).toBeVisible();
    await expect(page.getByText("37 cases closed in 30 days")).toBeVisible();

    // The same open cases the queue lists, by priority and by status.
    const openCases: Locator = page
      .getByTestId("card")
      .filter({ hasText: "The queue right now" });
    await expect(openCases).toContainText("Critical");
    await expect(openCases).toContainText("Investigating");

    await screenshot(page, "overview-desktop");
  });

  test("reads the server's own routes once each, and lists nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH);
    await expect(page.getByText("Riskiest Entities")).toBeVisible();

    const state: FixtureState = await fixture(page);
    const routes: Array<string> = state.apiRequests.map(
      (request: { url: string }): string => {
        return new URL(request.url).pathname.replace(/^.*\/api/, "");
      },
    );
    expect(routes.sort()).toEqual([
      "/security-case/overview",
      "/security-case/setup/status",
      "/security-case/top-entities",
    ]);
  });

  test("draws how Security works here across the top: each stage's figure, linked to its page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH);

    await expect(stage(page, "sources")).toContainText("2 sources");
    await expect(stage(page, "sources")).toContainText(
      "18,432 events in 24 hours",
    );
    await expect(stage(page, "detections")).toContainText("6 rules on");
    await expect(stage(page, "detections")).toContainText(
      "3 of 19 recommended",
    );
    await expect(stage(page, "cases")).toContainText("6 open cases");
    // What the open cases are, which the figures below no longer repeat.
    await expect(stage(page, "cases")).toContainText("2 critical · 2 high");
    await expect(stage(page, "playbooks")).toContainText("3 playbooks on");
    await expect(
      page
        .getByRole("group", { name: "Security operations figures" })
        .getByText("Open Cases", { exact: true }),
    ).toHaveCount(0);
    // At 1440 beside the side menu, every stage's figures sit on their lines.
    for (const key of ["sources", "detections", "cases", "playbooks"]) {
      const lines: number = await stage(page, key).evaluate(
        (element: Element): number => {
          const detail: Element | null =
            element.querySelector("a > div:last-child");
          if (!detail) {
            return 0;
          }
          const style: CSSStyleDeclaration = getComputedStyle(detail);
          return Math.round(
            detail.getBoundingClientRect().height /
              parseFloat(style.lineHeight),
          );
        },
      );
      expect(lines, `${key}'s line under its figure`).toBe(1);
    }
    // Set up, so no Get started; something waits, so no All quiet.
    await expect(gettingStarted(page)).toHaveCount(0);
    await expect(page.getByTestId("security-all-quiet")).toHaveCount(0);

    await stage(page, "detections").getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`${PRODUCT}/detection-rules$`));
    await expect(
      tabs(page).getByRole("link", { name: "Detection Rules" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(sideMenuLink(page, "Detections")).toHaveClass(/bg-indigo-50/);
  });

  test("dark theme", async ({ page }: { page: Page }) => {
    await open(page, OVERVIEW_PATH, { theme: "dark" });
    await expect(page.getByText("Riskiest Entities")).toBeVisible();
    await screenshot(page, "overview-dark");
  });

  test("a new project sets Security up in two clicks: everything recommended, then a test attack that opens a case", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { empty: true });

    await expect(
      gettingStarted(page).getByRole("heading", {
        name: "Set up Security in a minute",
      }),
    ).toBeVisible();
    await expect(gettingStarted(page)).toContainText("0 of 4 done");
    // The card alone tells the story; the pipeline would say it again, in amber.
    await expect(page.getByTestId("security-pipeline")).toHaveCount(0);
    // Its buttons sit under its sentence, the main one first.
    await expect(
      page.getByTestId("security-getting-started-actions").getByRole("button"),
    ).toHaveText(["Turn on recommended", "Send a test attack"]);
    // Nothing to chart yet, and no queue of zeros.
    await expect(page.getByText("Cases Opened")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "0 open cases assigned to you" }),
    ).toHaveCount(0);
    await screenshot(page, "overview-get-started");

    await page.getByTestId("security-turn-on-recommended").click();
    await expect(page.getByTestId("security-turned-on")).toContainText(
      "Done. 19 detection rules are on, your logs are checked for security events and every new case is enriched.",
    );
    await expect(gettingStarted(page)).toContainText("3 of 4 done");
    // Nothing left to turn on: the test attack is the next step, and the main button.
    await expect(
      page.getByTestId("security-getting-started-actions").getByRole("button"),
    ).toHaveText(["Send a test attack"]);

    await gettingStarted(page).getByTestId("security-run-setup-test").click();
    const result: Locator = page.getByTestId("security-setup-test-result");
    await expect(result).toContainText(
      "The test opened case CASE-150: a brute force attempt from one address.",
    );
    await expect(gettingStarted(page)).toContainText("4 of 4 done");
    await expect(
      gettingStarted(page).getByRole("heading", { name: "Security is set up" }),
    ).toBeVisible();
    // The case it opened is in the queue now, waiting for somebody.
    await expect(
      page.getByRole("link", { name: "1 open case nobody has picked up" }),
    ).toBeVisible();
    await screenshot(page, "overview-set-up");

    const routes: Array<string> = (await fixture(page)).apiRequests.map(
      (request: { url: string }): string => {
        return new URL(request.url).pathname.replace(/^.*\/api/, "");
      },
    );
    expect(
      routes.filter((route: string): boolean => {
        return (
          route.startsWith("/security-case/setup/turn-on") ||
          route === "/security-case/setup/test"
        );
      }),
    ).toEqual([
      "/security-case/setup/turn-on-recommended",
      "/security-case/setup/test",
    ]);

    await result.getByRole("link", { name: /Open the case/ }).click();
    await expect(page).toHaveURL(
      new RegExp(`${PRODUCT}/cases/20000000-0000-4000-8000-000000000150$`),
    );
    await expect(
      page
        .getByText("Brute force from one IP address from 203.0.113.77")
        .first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test("Done puts the finished card away and the pipeline takes its place; Dismiss puts it away for good", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { empty: true });
    await page.getByTestId("security-turn-on-recommended").click();
    await expect(page.getByTestId("security-turned-on")).toBeVisible();
    await gettingStarted(page).getByTestId("security-run-setup-test").click();
    await expect(
      gettingStarted(page).getByRole("heading", { name: "Security is set up" }),
    ).toBeVisible();

    await page.getByTestId("security-getting-started-done").click();
    await expect(gettingStarted(page)).toHaveCount(0);
    await expect(stage(page, "sources")).toContainText("1 source");
    await expect(stage(page, "detections")).toContainText("19 rules on");
    await expect(stage(page, "cases")).toContainText("1 open case");
    await expect(stage(page, "playbooks")).toContainText("1 playbook on");

    // A project that is not set up, whose people do not want the card.
    await open(page, OVERVIEW_PATH, { empty: true });
    await gettingStarted(page)
      .getByTestId("security-getting-started-dismiss")
      .click();
    await expect(gettingStarted(page)).toHaveCount(0);
    await expect(stage(page, "sources")).toHaveAttribute("data-ready", "false");
    await expect(stage(page, "sources")).toContainText("Not set up");
    await screenshot(page, "overview-dismissed");

    // Remembered in the browser: the next visit opens on the pipeline.
    await open(page, OVERVIEW_PATH, { empty: true });
    await expect(page.getByTestId("security-pipeline")).toBeVisible();
    await expect(gettingStarted(page)).toHaveCount(0);
  });

  test("a viewer is shown who can set Security up, not only grey buttons", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { empty: true, role: "viewer" });

    await expect(
      page.getByTestId("security-turn-on-recommended"),
    ).toBeDisabled();
    await expect(page.getByTestId("security-run-setup-test")).toBeDisabled();
    await expect(
      page.getByTestId("security-getting-started-locked"),
    ).toHaveText(
      "Ask a Project Owner, Project Admin or Security Admin to set Security up.",
    );
  });

  test("Get started in the dark theme and on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { empty: true, theme: "dark" });
    await expect(gettingStarted(page)).toBeVisible();
    await screenshot(page, "overview-get-started-dark");

    await open(page, OVERVIEW_PATH, { empty: true, width: 390 });
    await expect(gettingStarted(page)).toBeVisible();
    // The two buttons stack under the text, each the card's width.
    const turnOn: { width: number } | null = await page
      .getByTestId("security-turn-on-recommended")
      .boundingBox();
    const card: { width: number } | null =
      await gettingStarted(page).boundingBox();
    expect(turnOn!.width).toBeGreaterThan(card!.width * 0.75);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    // The main button is on the first screen of a phone, nothing above the card.
    const turnOnTop: { y: number } | null = await page
      .getByTestId("security-turn-on-recommended")
      .boundingBox();
    expect(turnOnTop!.y).toBeLessThan(844);
    await screenshot(page, "overview-get-started-phone");
  });

  test("a project set up and quiet says All quiet, offers the test attack, and charts nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { quiet: true });

    const quiet: Locator = page.getByTestId("security-all-quiet");
    await expect(
      quiet.getByRole("heading", { name: "All quiet" }),
    ).toBeVisible();
    await expect(quiet.getByTestId("security-run-setup-test")).toBeVisible();
    await expect(gettingStarted(page)).toHaveCount(0);
    await expect(page.getByText("Cases Opened")).toHaveCount(0);
    for (const key of ["sources", "detections", "cases", "playbooks"]) {
      await expect(stage(page, key)).toHaveAttribute("data-ready", "true");
    }
    await expect(stage(page, "cases")).toContainText("None open");
    await screenshot(page, "overview-all-quiet");

    await open(page, OVERVIEW_PATH, { quiet: true, theme: "dark" });
    await expect(quiet).toBeVisible();
    await screenshot(page, "overview-all-quiet-dark");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The case queue
 * ---------------------------------------------------------------------------
 */

test.describe("the case queue", () => {
  test("opens on the open cases, each with what raised it and what it is about", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASES_PATH);
    await expect(page.getByText("Showing 1-6 of 6 security cases")).toBeVisible(
      {
        timeout: 30000,
      },
    );

    const rows: Array<string> = await rowTexts(page);
    expect(rows).toHaveLength(6);
    const spray: string = rows.find((row: string): boolean => {
      return row.includes("CASE-142");
    }) as string;
    expect(spray).toContain("Password spray against Okta from 203.0.113.47");
    expect(spray).toContain("Detection Rule");
    expect(spray).toContain("3 detections");
    expect(spray).toContain("203.0.113.47");
    expect(spray).toContain("Critical");
    expect(spray).toContain("Investigating");
    expect(spray).toContain("Maya Chen");

    // Its entry in the side menu is the lit one.
    await expect(sideMenuLink(page, "Security Cases")).toHaveClass(
      /bg-indigo-50/,
    );
  });

  test("the views narrow the queue: unassigned, mine and closed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASES_PATH);
    await expect(page.getByText("Showing 1-6 of 6 security cases")).toBeVisible(
      {
        timeout: 30000,
      },
    );

    await page.getByTestId("security-case-view-unassigned").click();
    await expect(
      page.getByText("Showing 1-2 of 2 security cases"),
    ).toBeVisible();
    for (const row of await rowTexts(page)) {
      expect(row).toContain("Unassigned");
    }

    await page.getByTestId("security-case-view-mine").click();
    await expect(
      page.getByText("Showing 1-2 of 2 security cases"),
    ).toBeVisible();
    for (const row of await rowTexts(page)) {
      expect(row).toContain("Maya Chen");
    }

    await page.getByTestId("security-case-view-closed").click();
    await expect(
      page.getByText("Showing 1-10 of 37 security cases"),
    ).toBeVisible();
  });

  test("fits beside the side menu at 1440: every column in the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASES_PATH);
    await expect(page.getByText("Showing 1-6 of 6 security cases")).toBeVisible(
      {
        timeout: 30000,
      },
    );

    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    /*
     * The table's own box. It scrolls (overflow-x-auto) only while its rows
     * are wider than the card, so it is found by its test id.
     */
    const scroller: Locator = page
      .locator("table")
      .locator("xpath=ancestor::div[@data-testid='table-scroll'][1]");
    expect(
      await overflowOf(scroller),
      "table scrolls sideways",
    ).toBeLessThanOrEqual(1);
    await expect(
      page.getByRole("columnheader", { name: "Last Detection" }),
    ).toBeInViewport();

    await screenshot(page, "cases-desktop");
  });

  for (const layout of [
    { width: 1024, name: "cases-tablet" },
    { width: 390, name: "cases-mobile" },
  ]) {
    test(`${layout.width}: nothing runs off the page, and the header's controls stay in the card`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, CASES_PATH, { width: layout.width });
      await expect(page.getByText("CASE-142").first()).toBeVisible({
        timeout: 30000,
      });

      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

      const card: Locator = page
        .getByTestId("card")
        .filter({ hasText: "Security Cases" })
        .first();
      const cardBox: { x: number; width: number } | null =
        await card.boundingBox();
      const search: { x: number; width: number } | null = await page
        .getByRole("button", { name: "Open search" })
        .boundingBox();
      expect(cardBox).not.toBeNull();
      expect(search).not.toBeNull();
      expect(search!.x, "search starts inside the card").toBeGreaterThanOrEqual(
        cardBox!.x,
      );
      expect(
        search!.x + search!.width,
        "search ends inside the card",
      ).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 0.5);

      await screenshot(page, layout.name);
    });
  }
});

/*
 * ---------------------------------------------------------------------------
 * A case
 * ---------------------------------------------------------------------------
 */

test.describe("a case", () => {
  test("has everything to work it: header, detections, runs, timeline, entities and notes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH);
    await expect(
      page.getByText("Password spray against Okta from 203.0.113.47").first(),
    ).toBeVisible({ timeout: 30000 });

    for (const action of ["Run Playbook", "Declare Incident", "Close Case"]) {
      await expect(
        page.getByRole("button", { name: action }).first(),
      ).toBeVisible();
    }
    for (const step of ["New", "Investigating", "Contained", "Closed"]) {
      await expect(page.getByText(step, { exact: true }).first()).toBeVisible();
    }

    // Detections: what fired, and what it was about.
    await expect(page.getByText("Okta password spray").first()).toBeVisible();
    await expect(page.getByText("31 times")).toBeVisible();
    await expect(
      page.getByText("Showing 1-3 of 3 security detections"),
    ).toBeVisible();

    // The held run, its steps and the decision it waits for.
    const held: Locator = page
      .getByTestId("security-playbook-run-card")
      .filter({ hasText: "Contain Compromised Okta Users" });
    await expect(held).toContainText("Waiting for Approval");
    await expect(held.getByRole("button", { name: "Approve" })).toBeEnabled();
    await expect(held.getByRole("button", { name: "Reject" })).toBeEnabled();

    // Timeline, entities, ATT&CK and notes.
    await expect(page.getByText("took the case.")).toBeVisible();
    await expect(page.getByText("475 events")).toBeVisible();
    await expect(page.getByText("TA0006 Credential Access")).toBeVisible();
    await expect(
      page.getByText("Approving the suspend.", { exact: false }),
    ).toBeVisible();

    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    const detectionsTable: Locator = page
      .locator("table")
      .first()
      .locator("xpath=ancestor::div[@data-testid='table-scroll'][1]");
    expect(
      await overflowOf(detectionsTable),
      "detections table scrolls sideways",
    ).toBeLessThanOrEqual(1);

    await screenshot(page, "case-desktop");
  });

  test("approving the held step runs the rest of the playbook", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH);
    const held: Locator = page
      .getByTestId("security-playbook-run-card")
      .filter({ hasText: "Contain Compromised Okta Users" });
    await expect(held).toContainText("Waiting for Approval", {
      timeout: 30000,
    });

    await held.getByRole("button", { name: "Approve" }).click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toContainText("Approve Step");
    await dialog
      .getByPlaceholder("Optional. Why you decided this way.")
      .fill("Confirmed with her manager.");
    await dialog.getByRole("button", { name: "Approve" }).click();

    await expect(held).toContainText("Succeeded", { timeout: 30000 });
    await expect(held).toContainText(
      "Suspended k.morgan@acme-commerce.example in Okta.",
    );
    await expect(held).not.toContainText("Waiting for Approval");

    const decided: Array<{ url: string; body: unknown }> = (
      await fixture(page)
    ).apiRequests.filter((request: { url: string }): boolean => {
      return request.url.includes("/security-playbook-run/");
    });
    expect(decided).toHaveLength(1);
    expect(decided[0]!.url).toContain(
      `/security-playbook-run/${WAITING_RUN_ID}/approve`,
    );
    expect(decided[0]!.body).toEqual({
      comment: "Confirmed with her manager.",
    });
  });

  test("a Security Viewer sees the held step, and why it cannot decide it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH, { role: "viewer" });
    const held: Locator = page
      .getByTestId("security-playbook-run-card")
      .filter({ hasText: "Contain Compromised Okta Users" });
    await expect(held).toContainText("Waiting for Approval", {
      timeout: 30000,
    });
    await expect(held.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect(held.getByRole("button", { name: "Reject" })).toBeDisabled();
  });

  test("dark theme, and a narrow screen", async ({ page }: { page: Page }) => {
    await open(page, SPRAY_CASE_PATH, { theme: "dark" });
    await expect(page.getByText("475 events")).toBeVisible({ timeout: 30000 });
    await screenshot(page, "case-dark");

    await open(page, SPRAY_CASE_PATH, { width: 390, height: 844 });
    await expect(page.getByText("475 events")).toBeVisible({ timeout: 30000 });
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "case-mobile");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Playbooks and their runs
 * ---------------------------------------------------------------------------
 */

test.describe("playbooks", () => {
  test("lists each playbook with its steps, status and trigger, in the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PLAYBOOKS_PATH);
    await expect(
      page.getByText("Showing 1-4 of 4 security playbooks"),
    ).toBeVisible({ timeout: 30000 });

    const rows: Array<string> = await rowTexts(page);
    const contain: string = rows.find((row: string): boolean => {
      return row.includes("Contain Compromised Okta Users");
    }) as string;
    expect(contain).toContain("4 steps");
    expect(contain).toContain("Enabled");
    expect(contain).toContain("Case Opened");
    expect(contain).toContain("Critical and up");

    // Three templates to start from.
    await expect(
      page.getByTestId("security-playbook-template-enrich"),
    ).toBeVisible();

    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    const scroller: Locator = page
      .locator("table")
      .locator("xpath=ancestor::div[@data-testid='table-scroll'][1]");
    expect(
      await overflowOf(scroller),
      "table scrolls sideways",
    ).toBeLessThanOrEqual(1);

    await screenshot(page, "playbooks-desktop");
  });

  test("a playbook's page: when it runs, its steps and its latest runs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CONTAIN_PLAYBOOK_PATH);
    await expect(page.getByTestId("security-playbook-step-0")).toBeVisible({
      timeout: 30000,
    });

    // The settings read in full, not squeezed into a sliver of their column.
    const name: Locator = page
      .getByText(
        "Suspends the case's users in Okta and ends their sessions, after an analyst approves.",
      )
      .first();
    await expect(name).toBeVisible();
    const box: { height: number } | null = await name.boundingBox();
    expect(box!.height, "the description on one line").toBeLessThan(30);

    await expect(page.getByTestId("security-playbook-step-1")).toContainText(
      "Needs approval",
    );
    await expect(page.getByTestId("security-playbook-step-3")).toContainText(
      "Add a note",
    );
    await expect(page.getByText("Latest Runs")).toBeVisible();

    await screenshot(page, "playbook-desktop");
  });

  test("the runs page opens on the runs waiting for approval", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RUNS_PATH);
    await expect(page.getByTestId("security-playbook-run-card")).toHaveCount(
      1,
      {
        timeout: 30000,
      },
    );
    await expect(page.getByTestId("security-playbook-run-card")).toContainText(
      "CASE-142",
    );

    await page.getByTestId("security-playbook-runs-view-all").click();
    await expect(page.getByTestId("security-playbook-run-card")).toHaveCount(5);
    await expect(
      page.getByTestId("security-playbook-run-card").filter({
        hasText: "Failed",
      }),
    ).toContainText("The events store did not answer within 30 seconds.");

    await screenshot(page, "playbook-runs-desktop");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Detections: the rule library and ATT&CK coverage; entities
 * ---------------------------------------------------------------------------
 */

test.describe("detections", () => {
  test("ATT&CK coverage counts what the enabled rules cover, and the matrix scrolls in its card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ATTACK_COVERAGE_PATH);
    await expect(page.getByText("2 / 227")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("1 / 15")).toBeVisible();

    const technique: Locator = page
      .getByTestId("attack-technique-T1110")
      .first();
    await expect(technique).toBeVisible();

    // The matrix is taller and wider than its card: it scrolls inside it.
    const matrix: Locator = technique.locator(
      "xpath=ancestor::div[contains(@class,'overflow-auto')][1]",
    );
    const sizes: { scrollHeight: number; clientHeight: number } =
      await matrix.evaluate((element: Element) => {
        return {
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        };
      });
    expect(sizes.scrollHeight).toBeGreaterThan(sizes.clientHeight);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

    await screenshot(page, "attack-coverage-desktop");
  });

  test("the rule library marks the rules the project already has", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_LIBRARY_PATH);
    await expect(page.getByText("Added").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("Added", { exact: true })).toHaveCount(6);
    await screenshot(page, "rule-library-desktop", { fullPage: false });
  });

  test("the rule library marks the recommended rules and adds the missing ones in one click", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_LIBRARY_PATH);
    await expect(page.getByText("Added").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.locator('[data-testid^="rule-library-recommended-"]'),
    ).toHaveCount(19);

    await page.getByTestId("rule-library-category-recommended").click();
    await expect(
      page.locator('[data-testid^="rule-library-entry-"]'),
    ).toHaveCount(19);

    await page
      .getByRole("button", { name: "Add 16 Recommended Rules" })
      .click();
    // All nineteen are the project's now: the three it had and sixteen more.
    await expect(page.getByText("Added", { exact: true })).toHaveCount(19);
    await expect(
      page.getByRole("button", { name: /Recommended Rules?$/ }),
    ).toHaveCount(0);
  });

  test("the pages behind Detections are tabs, each its own address, with the menu entry lit on every one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_LIBRARY_PATH);
    await expect(tabs(page)).toBeVisible({ timeout: 30000 });
    await expect(tabs(page).getByRole("link")).toHaveText([
      "Detection Rules",
      "Rule Library",
      "Threat Intel",
      "ATT&CK Coverage",
    ]);
    await expect(
      tabs(page).getByRole("link", { name: "Rule Library" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(sideMenuLink(page, "Detections")).toHaveClass(/bg-indigo-50/);

    await tabs(page).getByRole("link", { name: "ATT&CK Coverage" }).click();
    await expect(page).toHaveURL(new RegExp(`${ATTACK_COVERAGE_PATH}$`));
    await expect(page.getByText("2 / 227")).toBeVisible({ timeout: 30000 });
    await expect(sideMenuLink(page, "Detections")).toHaveClass(/bg-indigo-50/);

    // On a phone the row scrolls inside itself, never the page.
    await open(page, RULE_LIBRARY_PATH, { width: 390 });
    await expect(tabs(page)).toBeVisible({ timeout: 30000 });
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  });

  test("the side menu is six entries, no sections", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH);
    for (const title of [
      "Overview",
      "Security Cases",
      "Events",
      "Detections",
      "Playbooks",
      "Connections",
    ]) {
      await expect(sideMenuLink(page, title).first()).toBeVisible();
    }
    for (const retired of [
      "Correlate",
      "Rule Library",
      "Monitors",
      "Setup Guide",
    ]) {
      await expect(sideMenuLink(page, retired)).toHaveCount(0);
    }
    await screenshot(page, "side-menu-desktop", { fullPage: false });
  });

  test("entities ranks what the findings name most", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ENTITIES_PATH);
    await expect(page.getByText("203.0.113.47").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByText("k.morgan@acme-commerce.example").first(),
    ).toBeVisible();
    await screenshot(page, "entities-desktop");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Every page at every size
 * ---------------------------------------------------------------------------
 */

test.describe("every page fits the screen", () => {
  const PAGES: ReadonlyArray<[string, string, string]> = [
    ["overview", OVERVIEW_PATH, "Riskiest Entities"],
    ["get started", `${OVERVIEW_PATH}?empty=1`, "Set up Security in a minute"],
    ["all quiet", `${OVERVIEW_PATH}?quiet=1`, "All quiet"],
    ["cases", CASES_PATH, "CASE-142"],
    ["case", SPRAY_CASE_PATH, "475 events"],
    ["entities", ENTITIES_PATH, "203.0.113.47"],
    ["rule library", RULE_LIBRARY_PATH, "Added"],
    ["attack coverage", ATTACK_COVERAGE_PATH, "2 / 227"],
    ["playbooks", PLAYBOOKS_PATH, "Enrich New Cases"],
    ["playbook", CONTAIN_PLAYBOOK_PATH, "Latest Runs"],
    ["runs", RUNS_PATH, "CASE-142"],
  ];

  for (const width of [1280, 1024, 768, 390]) {
    test(`at ${width}, no page scrolls sideways`, async ({
      page,
    }: {
      page: Page;
    }) => {
      for (const [name, pathname, text] of PAGES) {
        await open(page, pathname, { width });
        await expect(page.getByText(text).first(), name).toBeVisible({
          timeout: 30000,
        });
        expect(
          await pageOverflow(page),
          `${name} at ${width}`,
        ).toBeLessThanOrEqual(1);
      }
    });
  }
});
