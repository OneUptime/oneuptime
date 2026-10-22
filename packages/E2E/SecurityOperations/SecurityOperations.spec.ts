import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import {
  DETECTION_RULE_LIBRARY,
  getRecommendedDetectionRules,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import { RECOMMENDED_THREAT_INTEL_LISTS } from "Common/Types/SecurityEvent/ThreatIntelFeedType";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import fs from "fs/promises";
import path from "path";

/*
 * The Security Events SOC pages - the overview, the case queue's pages, a
 * case, entities, the rule library, ATT&CK coverage, playbooks, a playbook
 * and the runs - on the fixture's synthetic month (Fixture/Fixture.js), with
 * the side menu that holds them: eight sections, every page an entry of its
 * own (the tabs and views that used to sit along the tops of pages are
 * pages now). What the unit tests cannot see: that the pages fit beside the
 * side menu at every size, read right in both themes, agree with each other
 * on the numbers, that every page is reached from the menu and named the
 * same in its breadcrumbs, that approving a held playbook step runs the
 * rest of it, and that OneUptime AI's triage reads on the case, re-runs
 * what it cites and walks a new triage through to its read.
 *
 * Every test pins the clock and puts up a network fence that aborts anything
 * leaving the fixture server. afterEach fails a test on an uncaught page
 * error, on any request the fence had to abort, and on anything the fixture
 * does not model.
 */

const PORT: string = process.env["SECURITY_OPERATIONS_FIXTURE_PORT"] || "4234";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");
/*
 * The Rule Library's recommended rules, which the fixture's API counts and
 * turns on from the same catalog. The fixture's project has three of them.
 */
const RECOMMENDED_RULES: number = getRecommendedDetectionRules().length;
const RECOMMENDED_RULES_ON: number = 3;

const PRODUCT: string = `/dashboard/${PROJECT_ID}/security-events`;
const OVERVIEW_PATH: string = `${PRODUCT}/overview`;
// The case queue's pages: the open cases keep the queue's old address.
const CASES_PATH: string = `${PRODUCT}/cases`;
const MY_CASES_PATH: string = `${PRODUCT}/cases/assigned-to-me`;
const UNASSIGNED_CASES_PATH: string = `${PRODUCT}/cases/unassigned`;
const CLOSED_CASES_PATH: string = `${PRODUCT}/cases/closed`;
const ALL_CASES_PATH: string = `${PRODUCT}/cases/all`;
const SPRAY_CASE_PATH: string = `${PRODUCT}/cases/20000000-0000-4000-8000-000000000142`;
const ENTITIES_PATH: string = `${PRODUCT}/entities`;
const RULE_LIBRARY_PATH: string = `${PRODUCT}/rule-library`;
const ATTACK_COVERAGE_PATH: string = `${PRODUCT}/attack-coverage`;
const PLAYBOOKS_PATH: string = `${PRODUCT}/playbooks`;
const CONTAIN_PLAYBOOK_PATH: string = `${PRODUCT}/playbooks/24000000-0000-4000-8000-000000000003`;
// The runs held for an approval keep the runs page's old address.
const RUNS_PATH: string = `${PRODUCT}/playbook-runs`;
const ALL_RUNS_PATH: string = `${PRODUCT}/playbook-runs/all`;
const DETECTION_RULES_PATH: string = `${PRODUCT}/detection-rules`;
const THREAT_INTEL_PATH: string = `${PRODUCT}/threat-intel`;
// The known-bad domain case nobody has picked up, and OneUptime AI has not read.
const DOMAIN_CASE_PATH: string = `${PRODUCT}/cases/20000000-0000-4000-8000-000000000141`;
const AI_SETTINGS_PATH: string = `${PRODUCT}/ai/settings`;
// The spray case's triage run, whose cited checks re-run.
const SPRAY_TRIAGE_RUN_ID: string = "29000000-0000-4000-8000-000000000142";

// The fixture's two correlation rules, beside its six library rules.
const SEQUENCE_RULE: string = "Spray, then a success";
const FIRST_SEEN_RULE: string = "Admin console from a new address";

// What a single rule counts by, which a correlation says in its YAML instead.
const COUNTING_FIELDS: ReadonlyArray<RegExp> = [
  /^Group By Field/,
  /^Distinct Count Field/,
  /^Match Count Threshold/,
];

const SINGLE_RULE_YAML: string = `title: Failed sign-in burst
level: high
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
`;

const CORRELATION_RULE_YAML: string = `title: Brute force, then a success
level: high
correlation:
  type: temporal_ordered
  rules:
    - failed_burst
    - succeeded
  group-by:
    - principalIp
  timespan: 15m
---
title: Ten failed sign-ins
name: failed_burst
correlation:
  type: event_count
  rules:
    - failed
  group-by:
    - principalIp
  timespan: 15m
  condition:
    gte: 10
---
title: Failed sign-in
name: failed
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
---
title: Successful sign-in
name: succeeded
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection
`;

const WAITING_RUN_ID: string = "25000000-0000-4000-8000-000000000001";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/security-operations-ui",
);

interface FixtureState {
  apiRequests: Array<{ method: string; url: string; body: unknown }>;
  listRequests: Array<{ modelName: string; query: unknown }>;
  creates: Array<{ modelName: string; data: Record<string, unknown> }>;
  unhandled: Array<unknown>;
}

interface OpenOptions {
  width?: number;
  height?: number;
  // Light unless "dark"; undefined reads as light, for loops over both.
  theme?: "dark" | undefined;
  empty?: boolean;
  quiet?: boolean;
  role?: "viewer";
  // "all": the project reads every free list already.
  lists?: "all";
  // "off": the project's Enable AI is off.
  ai?: "off";
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
  if (options.lists) {
    params.set("lists", options.lists);
  }
  if (options.ai) {
    params.set("ai", options.ai);
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

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Where a visible element is drawn; failing the test when it is not drawn.
async function boxOf(locator: Locator): Promise<Box> {
  await expect(locator).toBeVisible();
  const box: Box | null = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
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

// The side menu, as a desktop draws it beside the page.
function sideMenu(page: Page): Locator {
  return page.locator('aside[role="navigation"]');
}

// An entry of the side menu, by the page it names (its count is not part of the name).
function menuEntry(page: Page, title: string): Locator {
  return sideMenu(page).getByRole("link", { name: title, exact: true });
}

// A section of the side menu, by its title: the button that folds it.
function menuSection(page: Page, title: string): Locator {
  return sideMenu(page).getByRole("button", { name: title, exact: true });
}

// The entries of the menu marked as the page you are on.
async function litEntries(page: Page): Promise<Array<string>> {
  return sideMenu(page)
    .locator("a.bg-indigo-50")
    .evaluateAll((anchors: Array<Element>): Array<string> => {
      return anchors.map((anchor: Element): string => {
        return (
          anchor.querySelector("span.truncate")?.textContent ||
          anchor.textContent ||
          ""
        ).trim();
      });
    });
}

// The trail above the page, crumb by crumb.
async function breadcrumbs(page: Page): Promise<Array<string>> {
  return (
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("listitem")
      .allInnerTexts()
  ).map((crumb: string): string => {
    return crumb.trim();
  });
}

// The pathname the page is on, without the scenario's query.
function pathnameOf(page: Page): string {
  return new URL(page.url()).pathname;
}

// One stage of the Overview's pipeline: Sources, Detections, Security Cases, Playbooks.
function stage(page: Page, key: string): Locator {
  return page.getByTestId(`security-pipeline-${key}`);
}

function gettingStarted(page: Page): Locator {
  return page.getByTestId("security-getting-started");
}

// The card of a page, by its title.
function cardTitled(page: Page, title: string): Locator {
  return page.getByTestId("card").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
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
    // The six library rules and the team's two correlations.
    await expect(stage(page, "detections")).toContainText("8 rules on");
    await expect(stage(page, "detections")).toContainText(
      `${RECOMMENDED_RULES_ON} of ${RECOMMENDED_RULES} recommended`,
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
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(DETECTION_RULES_PATH);
    // Its folded section opened by itself, on the entry of the page.
    await expect(menuSection(page, "Detections")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(await litEntries(page)).toEqual(["Detection Rules"]);
  });

  test("each count opens the page that lists exactly what it counts", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [count, pathname, entry, proof] of [
      [
        "2 open cases assigned to you",
        MY_CASES_PATH,
        "Assigned to Me",
        "Showing 1-2 of 2 security cases",
      ],
      [
        "2 open cases nobody has picked up",
        UNASSIGNED_CASES_PATH,
        "Unassigned",
        "Showing 1-2 of 2 security cases",
      ],
      [
        "1 playbook step waiting for approval",
        RUNS_PATH,
        "Waiting for Approval",
        "Contain Compromised Okta Users",
      ],
    ]) {
      await open(page, OVERVIEW_PATH);
      await page.getByRole("link", { name: count! }).click();
      await expect
        .poll(() => {
          return pathnameOf(page);
        })
        .toBe(pathname);
      await expect(page.getByText(proof!).first()).toBeVisible({
        timeout: 30000,
      });
      expect(await litEntries(page)).toEqual([entry]);
    }
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
      `Done. ${RECOMMENDED_RULES} detection rules are on, your logs are checked for security events and every new case is enriched.`,
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
    await expect(stage(page, "detections")).toContainText(
      `${RECOMMENDED_RULES} rules on`,
    );
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

    // Its page is Open Cases, lit in the menu, named so in its trail.
    await expect(
      page.getByRole("heading", { name: "Open Cases", exact: true }),
    ).toBeVisible();
    expect(await litEntries(page)).toEqual(["Open Cases"]);
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Security Cases",
      "Open Cases",
    ]);
    // No row of views above the list: each is a page of its own.
    await expect(
      page.locator('[data-testid^="security-case-view-"]'),
    ).toHaveCount(0);
    await expect(page.locator("button[aria-pressed]")).toHaveCount(0);
  });

  test("each case page lists what its name says, from the side menu", async ({
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

    /*
     * Unassigned: the open cases nobody is on. No Assignee column saying
     * Unassigned on every row: Team names the team a case was handed to.
     */
    await menuEntry(page, "Unassigned").click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(UNASSIGNED_CASES_PATH);
    await expect(
      page.getByText("Showing 1-2 of 2 security cases"),
    ).toBeVisible();
    const unassigned: Array<string> = await rowTexts(page);
    expect(unassigned).toHaveLength(2);
    for (const row of unassigned) {
      expect(row).not.toContain("Unassigned");
    }
    expect(
      unassigned.find((row: string): boolean => {
        return row.includes("CASE-138");
      }),
    ).toContain("SOC Tier 2");
    await expect(
      page.getByRole("columnheader", { name: "Team" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Assignee" }),
    ).toHaveCount(0);
    expect(await litEntries(page)).toEqual(["Unassigned"]);

    // Assigned to Me: Maya's open cases, with no Assignee column saying so.
    await menuEntry(page, "Assigned to Me").click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(MY_CASES_PATH);
    await expect(
      page.getByText("Showing 1-2 of 2 security cases"),
    ).toBeVisible();
    /*
     * Unassigned held two cases too, so its footer reads the same: wait for
     * this page's own rows, not for a footer the last page already showed.
     */
    await expect
      .poll(async (): Promise<string> => {
        return (await rowTexts(page)).join(" ");
      })
      .toContain("CASE-142");
    await expect(
      page.getByRole("columnheader", { name: "Assignee" }),
    ).toHaveCount(0);
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Security Cases",
      "Assigned to Me",
    ]);

    // Closed Cases: by verdict and when each closed, the latest first.
    await menuEntry(page, "Closed Cases").click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(CLOSED_CASES_PATH);
    await expect(
      page.getByText("Showing 1-10 of 37 security cases"),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Verdict" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Status" }),
    ).toHaveCount(0);
    // Nothing is opened from the record of what was decided.
    await expect(
      page.getByRole("button", { name: "Open Security Case" }),
    ).toHaveCount(0);

    // All Cases: every case, open and closed.
    await menuEntry(page, "All Cases").click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(ALL_CASES_PATH);
    await expect(
      page.getByText("Showing 1-10 of 43 security cases"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open Security Case" }).first(),
    ).toBeVisible();
  });

  test("the case pages in both themes, at 1280 and on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [name, pathname, text] of [
      ["cases-open", CASES_PATH, "CASE-142"],
      ["cases-assigned-to-me", MY_CASES_PATH, "CASE-142"],
      ["cases-unassigned", UNASSIGNED_CASES_PATH, "CASE-141"],
      ["cases-closed", CLOSED_CASES_PATH, "Benign Positive"],
      ["cases-all", ALL_CASES_PATH, "CASE-142"],
    ] as Array<[string, string, string]>) {
      for (const theme of [undefined, "dark"] as Array<"dark" | undefined>) {
        await open(page, pathname, { width: 1280, theme });
        await expect(page.getByText(text).first()).toBeVisible({
          timeout: 30000,
        });
        expect(await pageOverflow(page), `${name} at 1280`).toBeLessThanOrEqual(
          1,
        );
        await screenshot(page, `${name}-1280-${theme || "light"}`);
      }

      await open(page, pathname, { width: 390, height: 844 });
      await expect(page.getByText(text).first()).toBeVisible({
        timeout: 30000,
      });
      expect(await pageOverflow(page), `${name} at 390`).toBeLessThanOrEqual(1);
      await screenshot(page, `${name}-390-light`);
    }
  });

  test("at 1280, each list's title, search and buttons share one line, the description under them", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [pathname, title, text] of [
      [CASES_PATH, "Open Cases", "CASE-142"],
      [CLOSED_CASES_PATH, "Closed Cases", "Benign Positive"],
      [ALL_CASES_PATH, "All Cases", "CASE-142"],
      [PLAYBOOKS_PATH, "Playbooks", "Contain Compromised Okta Users"],
    ] as Array<[string, string, string]>) {
      await open(page, pathname, { width: 1280 });
      await expect(page.getByText(text).first()).toBeVisible({
        timeout: 30000,
      });

      const header: Locator = cardTitled(page, title).getByTestId(
        "card-header",
      );
      // The table's own header, as every table in the product has.
      await expect(header).toHaveAttribute("data-header-layout", "toolbar");

      const titleBox: Box = await boxOf(
        header.getByTestId("card-header-title-block"),
      );
      const actionsBox: Box = await boxOf(
        header.getByTestId("card-header-actions"),
      );
      const descriptionBox: Box = await boxOf(
        header.getByTestId("card-description"),
      );

      // Beside the title, not on a line of their own under it.
      expect(
        actionsBox.y,
        `${title}: controls on the title's line`,
      ).toBeLessThan(titleBox.y + titleBox.height);
      expect(
        actionsBox.x,
        `${title}: controls right of the title`,
      ).toBeGreaterThanOrEqual(titleBox.x + titleBox.width - 1);
      // The description under both, across the card.
      expect(
        descriptionBox.y,
        `${title}: description under the controls`,
      ).toBeGreaterThanOrEqual(actionsBox.y + actionsBox.height - 1);
    }
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

      const card: Locator = cardTitled(page, "Open Cases");
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

  test("Waiting for Approval, at the runs page's old address, lists the run held for a decision", async ({
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
    await expect(
      page.getByRole("heading", { name: "Waiting for Approval", exact: true }),
    ).toBeVisible();
    expect(await litEntries(page)).toEqual(["Waiting for Approval"]);
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Playbooks",
      "Waiting for Approval",
    ]);
    // The views that sat on the card are gone: each is a page.
    await expect(
      page.locator('[data-testid^="security-playbook-runs-view-"]'),
    ).toHaveCount(0);
    await expect(page.locator("button[aria-pressed]")).toHaveCount(0);
    // With a run listed, the card says what the page holds.
    await expect(
      cardTitled(page, "Waiting for Approval").getByTestId("card-description"),
    ).toContainText("Runs held before a step that needs approval.");

    await screenshot(page, "playbook-runs-waiting-desktop");
  });

  test("Playbook Runs lists every run, newest first, failures with their reason", async ({
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

    await menuEntry(page, "Playbook Runs").click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(ALL_RUNS_PATH);
    await expect(page.getByTestId("security-playbook-run-card")).toHaveCount(5);
    await expect(
      page.getByTestId("security-playbook-run-card").filter({
        hasText: "Failed",
      }),
    ).toContainText("The events store did not answer within 30 seconds.");
    expect(await litEntries(page)).toEqual(["Playbook Runs"]);

    await screenshot(page, "playbook-runs-desktop");
  });

  test("the runs pages in both themes, and on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [name, pathname] of [
      ["playbook-runs-waiting", RUNS_PATH],
      ["playbook-runs-all", ALL_RUNS_PATH],
    ] as Array<[string, string]>) {
      await open(page, pathname, { width: 1280, theme: "dark" });
      await expect(
        page.getByTestId("security-playbook-run-card").first(),
      ).toBeVisible({ timeout: 30000 });
      await screenshot(page, `${name}-1280-dark`);

      await open(page, pathname, { width: 390, height: 844 });
      await expect(
        page.getByTestId("security-playbook-run-card").first(),
      ).toBeVisible({ timeout: 30000 });
      expect(await pageOverflow(page), `${name} at 390`).toBeLessThanOrEqual(1);
      await screenshot(page, `${name}-390-light`);
    }
  });

  test("with nothing held, Waiting for Approval says all is clear; with no run, Playbook Runs points at the playbooks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RUNS_PATH, { quiet: true });
    const waiting: Locator = page.getByTestId("security-playbook-runs-empty");
    await expect(waiting).toBeVisible({ timeout: 30000 });
    await expect(waiting).toHaveAttribute("data-empty-state-kind", "all-clear");
    await expect(waiting).toContainText("No step is waiting for approval");
    // The empty state says what the page is for; the card does not say it again.
    await expect(
      cardTitled(page, "Waiting for Approval").getByTestId("card-description"),
    ).toHaveCount(0);

    await open(page, ALL_RUNS_PATH, { quiet: true });
    const none: Locator = page.getByTestId("security-playbook-runs-empty");
    await expect(none).toBeVisible({ timeout: 30000 });
    await expect(none).toContainText("No playbook has run yet");
    await expect(
      cardTitled(page, "Playbook Runs").getByTestId("card-description"),
    ).toHaveCount(0);
    await screenshot(page, "playbook-runs-empty");

    await page.getByTestId("security-playbook-runs-view-playbooks").click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(PLAYBOOKS_PATH);
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

    /*
     * The two buttons share the title's line and the description runs under
     * them, the card's whole width: beside them it stood four lines tall in
     * English, five in German.
     */
    const header: Locator = page
      .getByTestId("card")
      .filter({
        has: page.getByRole("heading", { name: "Rule Library", exact: true }),
      })
      .getByTestId("card-header");
    await expect(header).toHaveAttribute("data-header-layout", "toolbar");
    const headerBox: Box = await boxOf(header);
    const actionsBox: Box = await boxOf(
      header.getByTestId("card-header-actions"),
    );
    const descriptionBox: Box = await boxOf(
      header.getByTestId("card-description"),
    );
    expect(descriptionBox.y).toBeGreaterThanOrEqual(
      actionsBox.y + actionsBox.height,
    );
    expect(descriptionBox.width).toBeGreaterThan(headerBox.width * 0.9);
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
    ).toHaveCount(RECOMMENDED_RULES);

    await page.getByTestId("rule-library-category").selectOption("recommended");
    await expect(
      page.locator('[data-testid^="rule-library-entry-"]'),
    ).toHaveCount(RECOMMENDED_RULES);

    await page
      .getByRole("button", {
        name: `Add ${RECOMMENDED_RULES - RECOMMENDED_RULES_ON} Recommended Rules`,
      })
      .click();
    // Every recommended rule is the project's now: the three it had and the rest.
    await expect(page.getByText("Added", { exact: true })).toHaveCount(
      RECOMMENDED_RULES,
    );
    await expect(
      page.getByRole("button", { name: /Recommended Rules?$/ }),
    ).toHaveCount(0);
  });

  test("the rule library narrows by one select beside its search, which a phone puts under it", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [width, theme] of [
      [1280, undefined],
      [1280, "dark"],
      [390, undefined],
    ] as Array<[number, "dark" | undefined]>) {
      await open(page, RULE_LIBRARY_PATH, { width, height: 900, theme });
      await expect(page.getByText("Added").first()).toBeVisible({
        timeout: 30000,
      });

      const filters: Locator = page.getByTestId("rule-library-filters");
      const search: Box = await boxOf(filters.getByPlaceholder("Search rules"));
      const select: Locator = filters.getByRole("combobox", {
        name: "Rule categories",
      });
      const selectBox: Box = await boxOf(select);

      // No row of buttons across the card to read as tabs.
      await expect(filters.getByRole("button")).toHaveCount(0);
      await expect(select).toHaveValue("");

      if (width === 1280) {
        // Beside the search, the same height, on its line.
        expect(selectBox.x).toBeGreaterThan(search.x + search.width);
        expect(Math.abs(selectBox.y - search.y)).toBeLessThanOrEqual(2);
        expect(Math.abs(selectBox.height - search.height)).toBeLessThanOrEqual(
          2,
        );
      } else {
        // Under it, as wide as it.
        expect(selectBox.y).toBeGreaterThanOrEqual(search.y + search.height);
        expect(Math.abs(selectBox.width - search.width)).toBeLessThanOrEqual(1);
      }

      // A category narrows the cards to its own rules.
      const cards: Locator = page.locator(
        '[data-testid^="rule-library-entry-"]',
      );
      const everyRule: number = await cards.count();
      await select.selectOption("Kubernetes");
      await expect(select).toHaveValue("Kubernetes");
      await expect
        .poll(async (): Promise<number> => {
          return cards.count();
        })
        .toBeLessThan(everyRule);
      expect(await cards.count()).toBeGreaterThan(0);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
      await screenshot(
        page,
        `rule-library-category-${width}-${theme || "light"}`,
        { fullPage: false },
      );
    }
  });

  test("Detections is a section of pages, each its own address, its entry lit on each, no row of tabs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_LIBRARY_PATH);
    await expect(page.getByText("Added").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByTestId("security-events-tabs")).toHaveCount(0);
    await expect(menuSection(page, "Detections")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(await litEntries(page)).toEqual(["Rule Library"]);
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Detections",
      "Rule Library",
    ]);

    await menuEntry(page, "ATT&CK Coverage").click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(ATTACK_COVERAGE_PATH);
    await expect(page.getByText("2 / 227")).toBeVisible({ timeout: 30000 });
    expect(await litEntries(page)).toEqual(["ATT&CK Coverage"]);

    // The section's crumb opens its first page.
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Detections" })
      .click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(DETECTION_RULES_PATH);
  });

  test("the side menu is eight sections of pages; the ones set up once are folded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH);
    await expect(page.getByText("Riskiest Entities")).toBeVisible({
      timeout: 30000,
    });

    const sections: Array<string> = (
      await sideMenu(page).locator("h6").allInnerTexts()
    ).map((title: string): string => {
      return title.trim().toLowerCase();
    });
    expect(sections).toEqual([
      "overview",
      "security cases",
      "events",
      "detections",
      "playbooks",
      "ai",
      "workspace",
      "connections",
    ]);

    for (const [section, expanded] of [
      ["Overview", "true"],
      ["Security Cases", "true"],
      ["Events", "true"],
      ["Detections", "false"],
      ["Playbooks", "true"],
      ["AI", "false"],
      ["Workspace", "false"],
      ["Connections", "false"],
    ]) {
      await expect(menuSection(page, section!)).toHaveAttribute(
        "aria-expanded",
        expanded!,
      );
    }

    for (const title of [
      "Overview",
      "Open Cases",
      "Assigned to Me",
      "Unassigned",
      "Closed Cases",
      "All Cases",
      "Events",
      "Entities",
      "Correlate",
      "Playbooks",
      "Waiting for Approval",
      "Playbook Runs",
    ]) {
      await expect(menuEntry(page, title)).toBeVisible();
    }
    // Folded: there, one click away, but not one more row on every visit.
    for (const title of ["Rule Library", "Settings", "Setup Guide"]) {
      await expect(menuEntry(page, title)).toBeHidden();
    }
    await expect(menuEntry(page, "Monitors")).toHaveCount(0);

    // What waits for someone is counted beside the page that lists it.
    await expect(menuEntry(page, "Open Cases")).toContainText("6");
    await expect(menuEntry(page, "Assigned to Me")).toContainText("2");
    await expect(menuEntry(page, "Waiting for Approval")).toContainText("1");

    await screenshot(page, "side-menu-desktop", { fullPage: false });

    await menuSection(page, "Detections").click();
    await expect(menuEntry(page, "Rule Library")).toBeVisible();

    /*
     * Workspace lists the chat workspaces the project has connected - Slack
     * here - and nothing for the one it has not.
     */
    await menuSection(page, "Workspace").click();
    await expect(menuEntry(page, "Slack")).toBeVisible();
    await expect(menuEntry(page, "Microsoft Teams")).toHaveCount(0);
    await expect(menuEntry(page, "Connect Slack or Teams")).toHaveCount(0);

    await open(page, OVERVIEW_PATH, { theme: "dark", width: 1280 });
    await expect(page.getByText("Riskiest Entities")).toBeVisible({
      timeout: 30000,
    });
    await screenshot(page, "side-menu-dark", { fullPage: false });
  });

  test("on a phone, the menu names the section and the page, and opens on its sections", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CLOSED_CASES_PATH, { width: 390, height: 844 });
    const toggle: Locator = page.getByTestId("mobile-sidemenu-toggle");
    await expect(toggle).toContainText("Security Cases / Closed Cases", {
      timeout: 30000,
    });

    await toggle.click();
    const menu: Locator = page.getByRole("navigation", {
      name: "Main navigation",
    });
    await expect(menu.getByRole("link", { name: "Open Cases" })).toBeVisible();
    await screenshot(page, "side-menu-mobile", { fullPage: false });

    await menu.getByRole("link", { name: "Open Cases" }).click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(CASES_PATH);
    await expect(toggle).toContainText("Security Cases / Open Cases");
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

/*
 * ---------------------------------------------------------------------------
 * Detection rules and threat intel
 * ---------------------------------------------------------------------------
 */
test.describe("detection rules and threat intel", () => {
  // A detection rule's or a feed's row, by the name it shows.
  function rowNamed(page: Page, name: string): Locator {
    return page.locator("table tbody tr").filter({ hasText: name });
  }

  function dialog(page: Page): Locator {
    return page.getByRole("dialog");
  }

  async function openFreeLists(
    page: Page,
    options: OpenOptions = {},
  ): Promise<Locator> {
    await open(page, THREAT_INTEL_PATH, options);
    const lists: Locator = page.getByTestId("threat-intel-recommended-lists");
    // The tiles wait for the project's feeds before they offer Add.
    await expect(lists).toHaveAttribute("data-loaded", "true", {
      timeout: 30000,
    });
    return lists;
  }

  test("Detection Rules names each rule's kind: one event, a sequence, a first-seen rule", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH);
    await expect(rowNamed(page, SEQUENCE_RULE)).toBeVisible({
      timeout: 30000,
    });

    await expect(
      rowNamed(page, SEQUENCE_RULE).getByTestId("detection-rule-type"),
    ).toHaveText("Sequence");
    await expect(
      rowNamed(page, FIRST_SEEN_RULE).getByTestId("detection-rule-type"),
    ).toHaveText("First seen");
    await expect(
      rowNamed(page, DETECTION_RULE_LIBRARY[0]!.title).getByTestId(
        "detection-rule-type",
      ),
    ).toHaveText("Single event");
    // Every rule's row names its kind.
    await expect(page.getByTestId("detection-rule-type")).toHaveCount(
      await page.locator("table tbody tr").count(),
    );
    // Hovering a kind says what it means.
    await expect(
      rowNamed(page, SEQUENCE_RULE).getByTestId("detection-rule-type"),
    ).toHaveAttribute("title", /match in order/);

    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "detection-rules-desktop", { fullPage: false });
  });

  test("a correlation pasted into the form is said in a sentence, and the single rule's counting fields leave", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH);
    await expect(rowNamed(page, SEQUENCE_RULE)).toBeVisible({
      timeout: 30000,
    });

    // A single rule counts by the form's fields, under More fields.
    await page
      .getByRole("button", { name: "Create Detection Rule", exact: true })
      .click();
    await expect(dialog(page)).toBeVisible();
    await dialog(page)
      .getByRole("textbox", { name: /^Sigma Rule \(YAML\)/ })
      .fill(SINGLE_RULE_YAML);
    await expect(
      dialog(page).getByTestId("detection-rule-summary"),
    ).toHaveCount(0);
    await dialog(page)
      .getByRole("button", { name: "Next", exact: true })
      .click();
    await expect(dialog(page).locator("[aria-current='step']")).toHaveText(
      "On Match",
    );
    await dialog(page)
      .getByRole("button", { name: /More fields/ })
      .click();
    for (const field of COUNTING_FIELDS) {
      await expect(dialog(page).getByText(field).first()).toBeVisible();
    }
    await dialog(page)
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // A correlation says how it counts in its YAML, and the form says what it looks for.
    await page
      .getByRole("button", { name: "Create Detection Rule", exact: true })
      .click();
    await dialog(page)
      .getByRole("textbox", { name: /^Sigma Rule \(YAML\)/ })
      .fill(CORRELATION_RULE_YAML);
    const summary: Locator = dialog(page).getByTestId("detection-rule-summary");
    await expect(summary).toContainText("Sequence");
    await expect(summary).toContainText(
      "Ten failed sign-ins → Successful sign-in happen in this order for the same principalIp within 15 minutes.",
    );
    // The rules it reads stand apart by their titles, the field as a column name.
    await expect(summary.getByTestId("detection-rule-summary-rule")).toHaveText(
      ["Ten failed sign-ins", "Successful sign-in"],
    );
    const field: Locator = summary.getByTestId("detection-rule-summary-field");
    await expect(field).toHaveText(["principalIp"]);
    expect(
      await field.evaluate((element: Element): string => {
        return getComputedStyle(element).fontFamily;
      }),
    ).toContain("monospace");
    // The rule is named after the correlation's own title.
    await expect(
      dialog(page).getByRole("textbox", { name: /^Name/ }),
    ).toHaveValue("Brute force, then a success");
    await screenshot(page, "detection-rule-correlation-form-desktop", {
      fullPage: false,
    });

    await dialog(page)
      .getByRole("button", { name: "Next", exact: true })
      .click();
    await expect(dialog(page).locator("[aria-current='step']")).toHaveText(
      "On Match",
    );
    await dialog(page)
      .getByRole("button", { name: /More fields/ })
      .click();
    await expect(
      dialog(page)
        .getByText(/^Evaluation Interval \(Minutes\)/)
        .first(),
    ).toBeVisible();
    for (const field of COUNTING_FIELDS) {
      await expect(dialog(page).getByText(field)).toHaveCount(0);
    }
    await dialog(page)
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    expect((await fixture(page)).creates).toEqual([]);
  });

  test("Free Lists offer each free blocklist with its publisher, schedule and terms; one the project reads says Added", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFreeLists(page);

    for (const list of RECOMMENDED_THREAT_INTEL_LISTS) {
      const tile: Locator = page.getByTestId(`threat-intel-list-${list.id}`);
      // Who publishes it, how often it is read and its terms: one line under its name.
      const about: Locator = page.getByTestId(
        `threat-intel-list-about-${list.id}`,
      );
      await expect(tile).toContainText(list.title);
      await expect(about).toContainText(list.provider);
      await expect(tile).not.toContainText("Confidence");
      const terms: Locator = about.getByRole("link", { name: /Terms/ });
      await expect(terms).toHaveAttribute("target", "_blank");
      expect(new URL((await terms.getAttribute("href")) || "").href).toBe(
        new URL(list.termsUrl).href,
      );
    }
    await expect(
      page.getByTestId("threat-intel-list-feodo-tracker"),
    ).toContainText("Read every hour");
    await expect(
      page.getByTestId("threat-intel-list-emerging-threats-compromised"),
    ).toContainText("Read every day");

    // The project reads Feodo Tracker already: Added, and no Add List.
    await expect(
      page.getByTestId("threat-intel-list-added-feodo-tracker"),
    ).toBeVisible();
    await expect(
      page.getByTestId("threat-intel-list-add-feodo-tracker"),
    ).toHaveCount(0);

    // Three tiles a row beside the side menu, none wider than the card.
    const tiles: Array<Box> = [];
    for (const list of RECOMMENDED_THREAT_INTEL_LISTS) {
      tiles.push(await boxOf(page.getByTestId(`threat-intel-list-${list.id}`)));
    }
    expect(
      new Set(
        tiles.map((tile: Box): number => {
          return Math.round(tile.y);
        }),
      ).size,
    ).toBe(1);

    /*
     * Every tile ends alike: Added and Add List on one line across the row,
     * whichever a tile says (Added once sat beside the terms while Add List
     * dropped a line below them).
     */
    const ends: Array<number> = [];
    for (const list of RECOMMENDED_THREAT_INTEL_LISTS) {
      const action: Locator = page
        .getByTestId(`threat-intel-list-added-${list.id}`)
        .or(page.getByTestId(`threat-intel-list-add-${list.id}`));
      const box: Box = await boxOf(action);
      ends.push(box.y + box.height / 2);
    }
    expect(Math.max(...ends) - Math.min(...ends)).toBeLessThanOrEqual(2);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "threat-intel-desktop", { fullPage: false });
  });

  test("Add List adds the list as a feed in one click, and the feeds table lists it with its source", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFreeLists(page);
    const list: (typeof RECOMMENDED_THREAT_INTEL_LISTS)[number] =
      RECOMMENDED_THREAT_INTEL_LISTS.find(
        (item: (typeof RECOMMENDED_THREAT_INTEL_LISTS)[number]): boolean => {
          return item.id === "emerging-threats-compromised";
        },
      )!;

    await page.getByTestId(`threat-intel-list-add-${list.id}`).click();
    await expect(
      page.getByTestId(`threat-intel-list-added-${list.id}`),
    ).toBeVisible();

    const created: Array<{ modelName: string; data: Record<string, unknown> }> =
      (await fixture(page)).creates.filter(
        (create: { modelName: string }): boolean => {
          return create.modelName === "ThreatIntelFeed";
        },
      );
    expect(created).toHaveLength(1);
    expect(created[0]!.data).toMatchObject({
      name: list.title,
      feedType: "list",
      listUrl: list.url,
      indicatorConfidence: list.indicatorConfidence,
      pollIntervalInMinutes: list.pollIntervalInMinutes,
      isEnabled: true,
      shouldCreateCase: true,
      shouldCreateAlert: list.raisesAlerts,
      shouldCreateIncident: false,
    });

    // The table reads the feeds again: the new list, named by its source.
    const feeds: Locator = cardTitled(page, "Threat Intel Feeds");
    await expect(rowNamed(page, list.title)).toBeVisible();
    await expect(
      rowNamed(page, list.title).getByTestId("threat-intel-feed-source-cell"),
    ).toHaveText("List of indicators");
    await expect(
      rowNamed(page, "Corporate MISP").getByTestId(
        "threat-intel-feed-source-cell",
      ),
    ).toHaveText("TAXII collection");
    await expect(feeds.locator("tbody tr")).toHaveCount(3);

    // The indicators the feeds hold, under them.
    await expect(cardTitled(page, "Indicators")).toContainText(
      "update-check.example",
    );
  });

  test("with every free list a feed already, Free Lists is gone and the feeds lead the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, THREAT_INTEL_PATH, { lists: "all" });
    const feeds: Locator = cardTitled(page, "Threat Intel Feeds");
    await expect(feeds.locator("tbody tr")).toHaveCount(
      RECOMMENDED_THREAT_INTEL_LISTS.length + 1,
      { timeout: 30000 },
    );
    // The card read the feeds, found nothing left to offer, and drew nothing.
    await expect
      .poll(async (): Promise<number> => {
        return (await fixture(page)).listRequests.filter(
          (request: { modelName: string }): boolean => {
            return request.modelName === "ThreatIntelFeed";
          },
        ).length;
      })
      .toBeGreaterThanOrEqual(2);
    await expect(
      page.getByTestId("threat-intel-recommended-lists"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Free Lists", exact: true }),
    ).toHaveCount(0);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  });

  /*
   * Ten columns stood every feed's row five lines tall. The interval, Last
   * Evaluated and the two messages wait in Customize Columns (the Status
   * and View Error say when there is something to read); what a poll did
   * is one line, whole on hover.
   */
  test("the feeds table shows what most people read, each healthy row one line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFreeLists(page);
    const feeds: Locator = cardTitled(page, "Threat Intel Feeds");
    await expect(
      feeds.locator("tbody tr").filter({ hasText: "Corporate MISP" }),
    ).toBeVisible();

    const headers: Array<string> = (
      await feeds.locator("thead th").allTextContents()
    )
      .map((text: string): string => {
        return text.trim();
      })
      .filter(Boolean);
    for (const shown of [
      "Name",
      "Source",
      "Status",
      "Last Polled",
      "Last Match",
      "Last Poll Summary",
    ]) {
      expect(headers.join(" | ")).toContain(shown);
    }
    for (const hidden of [
      "Interval (Minutes)",
      "Last Error",
      "Last Evaluated",
      "Last Match Error",
    ]) {
      expect(headers.join(" | ")).not.toContain(hidden);
    }

    // A healthy feed's row is one line: what its poll did, cut short, whole on hover.
    for (const row of await feeds.locator("tbody tr").all()) {
      const box: Box = await boxOf(row);
      expect(box.height).toBeLessThanOrEqual(64);
    }
  });

  test("a Security Viewer reads the lists but cannot add one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFreeLists(page, { role: "viewer" });
    await expect(
      page.getByTestId("threat-intel-list-add-tor-exit-nodes"),
    ).toBeDisabled();
    await expect(
      page.getByTestId("threat-intel-list-added-feodo-tracker"),
    ).toBeVisible();
  });

  test("a new feed asks where its indicators come from first, then only that source's settings", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFreeLists(page);

    const SOURCES: ReadonlyArray<{
      title: string;
      step: string;
      settings: Array<RegExp>;
      folded?: Array<string>;
    }> = [
      {
        title: "List of indicators",
        step: "List",
        settings: [/^List URL/],
        // How sure the list is, empty for Medium: folded.
        folded: ["Confidence"],
      },
      {
        title: "TAXII collection",
        step: "TAXII Server",
        settings: [/^TAXII API Root URL/, /^Collection ID/],
      },
      {
        title: "Google SecOps",
        step: "Google SecOps",
        settings: [/^Google SecOps Connection/],
      },
    ];

    for (const source of SOURCES) {
      await page
        .getByRole("button", { name: "Create Threat Intel Feed", exact: true })
        .click();
      await expect(dialog(page).locator("[aria-current='step']")).toHaveText(
        "Source",
      );
      await expect(dialog(page).getByRole("radio")).toHaveCount(SOURCES.length);
      if (source.title === SOURCES[0]!.title) {
        await screenshot(page, "threat-intel-feed-source-desktop", {
          fullPage: false,
        });
      }

      await dialog(page)
        .getByRole("radio", { name: source.title, exact: true })
        .click();
      await dialog(page)
        .getByRole("textbox", { name: /^Name/ })
        .fill("Partner blocklist");
      await dialog(page)
        .getByRole("button", { name: "Next", exact: true })
        .click();
      await expect(dialog(page).locator("[aria-current='step']")).toHaveText(
        source.step,
      );

      // That source's settings, and none of another's.
      for (const other of SOURCES) {
        for (const setting of other.settings) {
          if (other.title === source.title) {
            await expect(dialog(page).getByText(setting).first()).toBeVisible();
          } else {
            await expect(dialog(page).getByText(setting)).toHaveCount(0);
          }
        }
      }
      if (source.folded) {
        const more: Locator = dialog(page).getByRole("button", {
          name: /More fields/,
        });
        await expect(more).toBeVisible();
        for (const title of source.folded) {
          await expect(
            dialog(page).getByText(title, { exact: true }).first(),
          ).toBeVisible();
          await expect(
            dialog(page).getByRole("spinbutton", {
              name: new RegExp(`^${escapeRegExp(title)}`),
            }),
          ).toHaveCount(0);
        }
        await more.click();
        for (const title of source.folded) {
          await expect(
            dialog(page).getByRole("spinbutton", {
              name: new RegExp(`^${escapeRegExp(title)}`),
            }),
          ).toBeVisible();
        }
      }
      if (source.title === "Google SecOps") {
        // No Google SecOps connection yet: the step says where to make one.
        await expect(
          dialog(page).getByRole("link", { name: /Connect Google SecOps/ }),
        ).toBeVisible();
      }

      await dialog(page)
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }

    expect((await fixture(page)).creates).toEqual([]);
  });

  test("both pages in the dark theme, and on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    const PAGES: ReadonlyArray<[string, string, string]> = [
      ["detection-rules", DETECTION_RULES_PATH, SEQUENCE_RULE],
      ["threat-intel", THREAT_INTEL_PATH, "Corporate MISP"],
    ];

    for (const [name, pathname, text] of PAGES) {
      await open(page, pathname, { theme: "dark" });
      await expect(page.getByText(text).first()).toBeVisible({
        timeout: 30000,
      });
      await screenshot(page, `${name}-dark`, { fullPage: false });

      await open(page, pathname, { width: 390 });
      await expect(page.getByText(text).first()).toBeVisible({
        timeout: 30000,
      });
      expect(await pageOverflow(page), `${name} at 390`).toBeLessThanOrEqual(1);
      await screenshot(page, `${name}-phone`);
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * OneUptime AI on the Security pages
 * ---------------------------------------------------------------------------
 *
 * The case's one AI card (SecurityCaseAiCard), on the fixture's triages: the
 * spray case read Likely Malicious with a cited report, and CASE-141 not
 * read yet, which Triage with AI walks through - queued, two checks, done.
 * The read in the case lists, Draft with AI under the Sigma rule, the AI
 * settings page's one switch, and nothing of it with the project's AI off.
 */
test.describe("OneUptime AI on the Security pages", () => {
  function aiCard(page: Page): Locator {
    return page.getByTestId("security-case-ai-card");
  }

  test("a triaged case leads with OneUptime AI's read: the verdict, the playbook it suggests, a cited report", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH);
    const card: Locator = aiCard(page);
    const triaged: Locator = card.getByTestId("security-case-ai-triaged");

    await expect(triaged).toBeVisible({ timeout: 30000 });
    await expect(card).toContainText("Likely Malicious");
    await expect(card).toContainText(
      "The evidence points at malicious or unauthorized activity.",
    );
    // The case is Critical already, so there is no priority to set.
    await expect(card.getByTestId("security-case-ai-set-priority")).toHaveCount(
      0,
    );
    await expect(
      card.getByTestId("security-case-ai-suggested-playbook"),
    ).toContainText("Contain Compromised Okta Users");
    await expect(
      card.getByTestId("security-case-ai-run-playbook"),
    ).toBeEnabled();
    // The report, as the people reading it see it.
    await expect(card).toContainText(
      "This is a password spray that most likely succeeded.",
    );
    await expect(
      card.getByTestId("security-case-ai-triaged-when"),
    ).toBeVisible();

    // The card comes first, above the detections.
    const cardBox: Box = await boxOf(card);
    const detections: Box = await boxOf(
      page.getByText("Okta password spray").first(),
    );
    expect(cardBox.y).toBeLessThan(detections.y);

    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "case-ai-desktop");
  });

  test("a citation opens the check behind it, re-run on the case's own route over the time the triage read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH);
    const card: Locator = aiCard(page);

    await expect(card.getByTestId("security-case-ai-triaged")).toBeVisible({
      timeout: 30000,
    });

    // [C1] is cited in the summary and again under Evidence.
    await card
      .getByRole("button", { name: /^Citation C1/ })
      .first()
      .click();

    await expect(
      card.getByTestId("investigation-details-toggle"),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(
      card.getByText(
        "11:51:02  user.session.start SUCCESS k.morgan@acme-commerce.example",
        { exact: false },
      ),
    ).toBeVisible({ timeout: 15000 });

    const evidence: Array<{ url: string; body: unknown }> = (
      await fixture(page)
    ).apiRequests.filter((request: { url: string }): boolean => {
      return request.url.endsWith("/ai-triage/evidence");
    });
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.url).toContain(
      "/security-case/20000000-0000-4000-8000-000000000142/ai-triage/evidence",
    );
    expect(evidence[0]!.body).toEqual({
      runId: SPRAY_TRIAGE_RUN_ID,
      citationId: "C1",
    });

    await screenshot(page, "case-ai-evidence-desktop");
  });

  test("Run playbook opens the run dialog on the playbook OneUptime AI suggested", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH);
    const card: Locator = aiCard(page);

    await card.getByTestId("security-case-ai-run-playbook").click({
      timeout: 30000,
    });
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Contain Compromised Okta Users");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Nothing ran: a person starts the playbook.
    expect((await fixture(page)).creates).toEqual([]);
  });

  test("Triage with AI on a case nobody has read: each check as it runs, then the read, and Set priority", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DOMAIN_CASE_PATH);
    const card: Locator = aiCard(page);

    await expect(card.getByTestId("security-case-ai-not-triaged")).toBeVisible({
      timeout: 30000,
    });
    await expect(card).toContainText("Not triaged yet");
    await screenshot(page, "case-ai-not-triaged-desktop", { fullPage: false });

    await card.getByTestId("security-case-ai-triage-button").click();

    await expect(card.getByTestId("security-case-ai-triaging")).toBeVisible();
    await expect(card.getByTestId("security-case-ai-steps")).toContainText(
      "Checked threat intel",
      { timeout: 15000 },
    );
    await screenshot(page, "case-ai-triaging-desktop", { fullPage: false });

    // Done: the read the runner wrote on the case, which the page read again.
    await expect(card.getByTestId("security-case-ai-triaged")).toBeVisible({
      timeout: 30000,
    });
    await expect(card).toContainText("Likely Malicious");
    await expect(
      card.getByTestId("security-case-ai-suggested-playbook"),
    ).toContainText("Escalate Known-Bad Indicators");

    // The case is High; OneUptime AI suggests Critical. One click sets it.
    await card.getByTestId("security-case-ai-set-priority").click();
    await expect
      .poll(async (): Promise<unknown> => {
        return (
          (await fixture(page)) as unknown as {
            updates: Array<{
              modelName: string;
              data: Record<string, unknown>;
            }>;
          }
        ).updates.find(
          (update: { modelName: string; data: Record<string, unknown> }) => {
            return (
              update.modelName === "SecurityCase" && "priority" in update.data
            );
          },
        )?.data["priority"];
      })
      .toBe("Critical");

    const asked: Array<string> = (await fixture(page)).apiRequests
      .map((request: { url: string }): string => {
        return new URL(request.url).pathname;
      })
      .filter((pathname: string): boolean => {
        return pathname.includes("/ai-triage");
      });
    expect(asked).toContain(
      "/api/security-case/20000000-0000-4000-8000-000000000141/ai-triage/start",
    );
    await screenshot(page, "case-ai-triaged-desktop", { fullPage: false });
  });

  test("the case lists show each case's read beside its title", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASES_PATH);
    const spray: Locator = page
      .locator("table tbody tr")
      .filter({ hasText: "CASE-142" });

    await expect(spray.getByTestId("security-case-row-ai-verdict")).toHaveText(
      "Likely Malicious",
      { timeout: 30000 },
    );
    await expect(
      page
        .locator("table tbody tr")
        .filter({ hasText: "CASE-137" })
        .getByTestId("security-case-row-ai-verdict"),
    ).toHaveText("Likely Benign");
    // Not read yet: no pill.
    await expect(
      page
        .locator("table tbody tr")
        .filter({ hasText: "CASE-141" })
        .getByTestId("security-case-row-ai-verdict"),
    ).toHaveCount(0);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "cases-ai-desktop", { fullPage: false });
  });

  test("Draft with AI writes a Sigma rule into the form from a sentence, and the rule is named after it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH);
    await page
      .getByRole("button", { name: "Create Detection Rule", exact: true })
      .click({ timeout: 30000 });
    const dialog: Locator = page.getByRole("dialog");

    await dialog.getByTestId("detection-rule-ai-draft-open").click();
    await dialog
      .getByRole("textbox", { name: "What should this rule catch?" })
      .fill("Ten failed sign-ins from one IP address within five minutes");
    await screenshot(page, "detection-rule-ai-draft-desktop", {
      fullPage: false,
    });
    await dialog.getByTestId("detection-rule-ai-draft-submit").click();

    await expect(dialog.getByTestId("detection-rule-ai-draft-done")).toHaveText(
      "OneUptime AI wrote this rule. Read it before you save.",
    );
    await expect(
      dialog.getByRole("textbox", { name: /^Sigma Rule \(YAML\)/ }),
    ).toHaveValue(
      /^title: Ten failed sign-ins from one address in five minutes/,
    );
    await expect(dialog.getByRole("textbox", { name: /^Name/ })).toHaveValue(
      "Ten failed sign-ins from one address in five minutes",
    );
    await expect(dialog.getByTestId("detection-rule-summary")).toContainText(
      "principalIp",
    );
    await expect(dialog.getByTestId("detection-rule-ai-draft-open")).toHaveText(
      "Redraft with AI",
    );

    const drafts: Array<{ url: string; body: unknown }> = (
      await fixture(page)
    ).apiRequests.filter((request: { url: string }): boolean => {
      return request.url.endsWith("/detection-rule/draft-with-ai");
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.body).toEqual({
      description:
        "Ten failed sign-ins from one IP address within five minutes",
    });
    // Nothing is saved by drafting.
    expect((await fixture(page)).creates).toEqual([]);
    await screenshot(page, "detection-rule-ai-drafted-desktop", {
      fullPage: false,
    });
  });

  test("Security Events → AI → Settings is one switch, Triage new cases, that saves as it flips", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, AI_SETTINGS_PATH);
    const toggle: Locator = page.getByTestId(
      "ai-switch-enableAutomaticSecurityCaseTriage",
    );

    await expect(toggle).toHaveAttribute("aria-checked", "true", {
      timeout: 30000,
    });
    await expect(
      page.getByText("Triage new cases", { exact: true }),
    ).toBeVisible();
    expect(await litEntries(page)).toEqual(["Settings"]);
    await expect(menuSection(page, "AI")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await screenshot(page, "ai-settings-desktop", { fullPage: false });

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(async (): Promise<unknown> => {
        return (
          (await fixture(page)) as unknown as {
            updates: Array<{
              modelName: string;
              data: Record<string, unknown>;
            }>;
          }
        ).updates.map(
          (update: { modelName: string; data: Record<string, unknown> }) => {
            return [update.modelName, update.data];
          },
        );
      })
      .toEqual([["Project", { enableAutomaticSecurityCaseTriage: false }]]);

    for (const theme of ["dark", undefined] as const) {
      await open(page, AI_SETTINGS_PATH, {
        theme,
        width: theme ? 1280 : 390,
        height: theme ? 1000 : 844,
      });
      await expect(
        page.getByTestId("ai-switch-enableAutomaticSecurityCaseTriage"),
      ).toBeVisible({ timeout: 30000 });
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
      await screenshot(page, theme ? "ai-settings-dark" : "ai-settings-phone");
    }
  });

  test("the AI card in the dark theme and on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH, { theme: "dark", width: 1280 });
    await expect(
      aiCard(page).getByTestId("security-case-ai-triaged"),
    ).toBeVisible({ timeout: 30000 });
    await screenshot(page, "case-ai-dark", { fullPage: false });

    await open(page, SPRAY_CASE_PATH, { width: 390, height: 844 });
    await expect(
      aiCard(page).getByTestId("security-case-ai-triaged"),
    ).toBeVisible({ timeout: 30000 });
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    expect(await overflowOf(aiCard(page))).toBeLessThanOrEqual(1);
    // The suggested playbook is named in full, beside or above Run playbook.
    const playbookName: Locator = aiCard(page)
      .getByTestId("security-case-ai-suggested-playbook")
      .getByText("Contain Compromised Okta Users", { exact: true });
    await expect(playbookName).toBeVisible();
    expect(
      await overflowOf(playbookName),
      "the suggested playbook's name is cut short",
    ).toBeLessThanOrEqual(1);
    await screenshot(page, "case-ai-phone");

    await open(page, SPRAY_CASE_PATH, {
      theme: "dark",
      width: 390,
      height: 844,
    });
    await expect(
      aiCard(page).getByTestId("security-case-ai-triaged"),
    ).toBeVisible({ timeout: 30000 });
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "case-ai-phone-dark");
  });

  test("with the project's AI off, none of it is drawn and nothing asks", async ({
    page,
  }: {
    page: Page;
  }) => {
    // What a page asked OneUptime AI for: nothing, with AI off.
    async function askedAi(): Promise<Array<string>> {
      return (await fixture(page)).apiRequests
        .map((request: { url: string }): string => {
          return request.url;
        })
        .filter((url: string): boolean => {
          return url.includes("/ai-triage") || url.includes("/draft-with-ai");
        });
    }

    await open(page, SPRAY_CASE_PATH, { ai: "off" });
    await expect(page.getByText("475 events")).toBeVisible({ timeout: 30000 });
    await expect(aiCard(page)).toHaveCount(0);
    expect(await askedAi()).toEqual([]);

    await open(page, CASES_PATH, { ai: "off" });
    await expect(
      page.locator("table tbody tr").filter({ hasText: "CASE-142" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("security-case-row-ai-verdict")).toHaveCount(
      0,
    );

    await open(page, DETECTION_RULES_PATH, { ai: "off" });
    await page
      .getByRole("button", { name: "Create Detection Rule", exact: true })
      .click({ timeout: 30000 });
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByTestId("detection-rule-ai-draft-open")).toHaveCount(
      0,
    );
    expect(await askedAi()).toEqual([]);

    // The settings page says AI is off, with Enable AI's own switch.
    await open(page, AI_SETTINGS_PATH, { ai: "off" });
    await expect(page.getByTestId("project-ai-off-notice")).toBeVisible({
      timeout: 30000,
    });
    await screenshot(page, "ai-settings-ai-off-desktop", { fullPage: false });
  });
});

test.describe("every page fits the screen", () => {
  const PAGES: ReadonlyArray<[string, string, string]> = [
    ["overview", OVERVIEW_PATH, "Riskiest Entities"],
    ["get started", `${OVERVIEW_PATH}?empty=1`, "Set up Security in a minute"],
    ["all quiet", `${OVERVIEW_PATH}?quiet=1`, "All quiet"],
    ["cases", CASES_PATH, "CASE-142"],
    ["assigned to me", MY_CASES_PATH, "CASE-142"],
    ["unassigned", UNASSIGNED_CASES_PATH, "CASE-141"],
    ["closed cases", CLOSED_CASES_PATH, "Benign Positive"],
    ["all cases", ALL_CASES_PATH, "CASE-142"],
    ["case", SPRAY_CASE_PATH, "475 events"],
    ["entities", ENTITIES_PATH, "203.0.113.47"],
    ["detection rules", DETECTION_RULES_PATH, SEQUENCE_RULE],
    ["rule library", RULE_LIBRARY_PATH, "Added"],
    ["threat intel", THREAT_INTEL_PATH, "Corporate MISP"],
    ["attack coverage", ATTACK_COVERAGE_PATH, "2 / 227"],
    ["playbooks", PLAYBOOKS_PATH, "Enrich New Cases"],
    ["playbook", CONTAIN_PLAYBOOK_PATH, "Latest Runs"],
    ["runs", RUNS_PATH, "CASE-142"],
    ["all runs", ALL_RUNS_PATH, "The events store did not answer"],
    ["ai settings", AI_SETTINGS_PATH, "Triage new cases"],
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
