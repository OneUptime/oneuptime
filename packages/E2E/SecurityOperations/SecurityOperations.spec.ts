import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
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
// The admin API key case OneUptime AI read as Likely Benign.
const API_KEY_CASE_PATH: string = `${PRODUCT}/cases/20000000-0000-4000-8000-000000000137`;
// The web shell case, whose suggested playbook's run on it failed.
const POWERSHELL_CASE_PATH: string = `${PRODUCT}/cases/20000000-0000-4000-8000-000000000138`;
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
  // The case AI card's other states (the fixture's TRIAGE_SCENARIOS).
  triage?:
    | "failed"
    | "provider"
    | "credits"
    | "limit"
    | "injection"
    | "retry"
    | "auto-off";
  // Turn on recommended that cannot do everything (the fixture's SETUP_SCENARIOS).
  setup?: "partly" | "fail";
  // "silent": the sources sent their last event three days ago.
  sources?: "silent";
  // One of the Overview's two reads fails the first time.
  fail?: "status" | "overview";
  // What the project's events say it sends: nothing this week, or a read that fails.
  data?: "none" | "fail";
  // The Dashboard's German or Japanese locale.
  lang?: "de" | "ja";
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
  if (options.triage) {
    params.set("triage", options.triage);
  }
  if (options.setup) {
    params.set("setup", options.setup);
  }
  if (options.sources) {
    params.set("sources", options.sources);
  }
  if (options.fail) {
    params.set("fail", options.fail);
  }
  if (options.data) {
    params.set("data", options.data);
  }
  if (options.lang) {
    params.set("lang", options.lang);
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

/*
 * Wait until nothing on the page is moving. A dialog grows in from 95% of its
 * size over 150ms, starting a frame after it mounts (Modal), and a box read on
 * the way sits a few pixels in from where it comes to rest - so two boxes read
 * one after the other were read at two sizes (CI, 2026-10-22: Draft with AI's
 * mark 3px off its label). At rest is no finite animation running for three
 * frames in a row; a spinner loops forever and is not waited for.
 */
async function pageAtRest(page: Page): Promise<void> {
  await page.evaluate(async (): Promise<void> => {
    const nextFrame: () => Promise<void> = (): Promise<void> => {
      return new Promise((resolve: () => void): void => {
        requestAnimationFrame((): void => {
          resolve();
        });
      });
    };
    let quietFrames: number = 0;
    while (quietFrames < 3) {
      await nextFrame();
      const moving: Array<Animation> = document
        .getAnimations()
        .filter((animation: Animation): boolean => {
          return (
            animation.playState === "running" &&
            animation.effect?.getTiming().iterations !== Infinity
          );
        });
      if (moving.length === 0) {
        quietFrames++;
        continue;
      }
      quietFrames = 0;
      await Promise.all(
        moving.map((animation: Animation): Promise<unknown> => {
          return animation.finished.catch((): undefined => {
            return undefined;
          });
        }),
      );
    }
  });
}

// Where a visible element comes to rest; failing the test when it is not drawn.
async function boxOf(locator: Locator): Promise<Box> {
  await expect(locator).toBeVisible();
  await pageAtRest(locator.page());
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

// The Overview's top: one card, its band, and the pipeline under it.
function topCard(page: Page): Locator {
  return page.getByTestId("security-overview-status");
}

function band(page: Page): Locator {
  return page.getByTestId("security-status-headline");
}

const STAGE_KEYS: ReadonlyArray<string> = [
  "sources",
  "detections",
  "cases",
  "playbooks",
];

// What Turn on recommended could not do: one line each, the name then why.
function problemRows(scope: Locator): Locator {
  return scope.getByTestId("security-turn-on-problem");
}

// The recommended rule the fixture's partly scenario leaves undone the first time.
const PARTLY_UNDONE_RULE: string = "Password spraying";

// A rule of the library, by its title.
function libraryRule(title: string): DetectionRuleLibraryEntry {
  const entry: DetectionRuleLibraryEntry | undefined =
    DETECTION_RULE_LIBRARY.find((candidate: DetectionRuleLibraryEntry) => {
      return candidate.title === title;
    });

  if (!entry) {
    throw new Error(`No library rule titled ${title}`);
  }

  return entry;
}

const BRUTE_FORCE_RULE: DetectionRuleLibraryEntry = libraryRule(
  "Brute force from one IP address",
);
const PASSWORD_SPRAYING_RULE: DetectionRuleLibraryEntry =
  libraryRule(PARTLY_UNDONE_RULE);
const CLOUDTRAIL_RULE: DetectionRuleLibraryEntry = libraryRule(
  "CloudTrail logging stopped",
);
const SHADOW_COPIES_RULE: DetectionRuleLibraryEntry = libraryRule(
  "Shadow copies deleted",
);
const PORT_SCAN_RULE: DetectionRuleLibraryEntry = libraryRule("Port scan");
const NETWORK_SWEEP_RULE: DetectionRuleLibraryEntry =
  libraryRule("Network sweep");
const SEQUENCE_LIBRARY_RULE: DetectionRuleLibraryEntry = libraryRule(
  "Failed sign-ins, then a success from the same address",
);

// The Rule Library's search box (in its header, folded until used).
const RULE_LIBRARY_SEARCH: string = "rule-library-search";

// The Rule Library's row of a rule, and all of its rows.
function libraryRow(page: Page, entry: { id: string }): Locator {
  return page.getByTestId(`rule-library-entry-${entry.id}`);
}

function libraryRows(page: Page): Locator {
  return page.locator('[data-testid^="rule-library-entry-"]');
}

// What the Rule Library asked the events for: one grouped count a read.
async function aggregateRequestsOf(page: Page): Promise<Array<unknown>> {
  return page.evaluate((): Array<unknown> => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __securityOperationsFixture: { aggregateRequests: Array<unknown> };
          }
        ).__securityOperationsFixture.aggregateRequests,
      ),
    ) as Array<unknown>;
  });
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

    // The band at the top of the card says it first, each count a link.
    await expect(band(page)).toHaveAttribute("data-kind", "needs-attention");
    await expect(
      band(page).getByRole("heading", { name: "Needs attention" }),
    ).toBeVisible();
    await expect(
      band(page).getByRole("link", { name: "2 open cases assigned to you" }),
    ).toBeVisible();
    await expect(
      band(page).getByRole("link", {
        name: "2 open cases nobody has picked up",
      }),
    ).toBeVisible();
    // One step: singular, not "1 playbook steps".
    await expect(
      band(page).getByRole("link", {
        name: "1 playbook step waiting for approval",
      }),
    ).toBeVisible();
    // Two critical cases are open: red, as Home keeps red for incidents.
    await expect(band(page)).toHaveAttribute("data-tone", "danger");

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
    // The step held for an approval reads under the playbooks too.
    await expect(stage(page, "playbooks")).toContainText("1 step to approve");
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
    // Set up, so no Get started; something waits, so not All quiet.
    await expect(gettingStarted(page)).toHaveCount(0);
    await expect(band(page)).not.toContainText("All quiet");

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

  test("a click that cannot do everything says what is missing and why, and Try again does only that", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { empty: true, setup: "partly" });
    await page.getByTestId("security-turn-on-recommended").click();

    // What could not be done, by the names the lists show, each with why.
    const problems: Locator = gettingStarted(page).getByTestId(
      "security-turn-on-problems",
    );
    await expect(problems).toBeVisible();
    await expect(problems).toHaveAttribute("role", "alert");
    await expect(problems).toContainText("Not everything could be turned on");
    await expect(problemRows(problems)).toHaveText([
      `${PARTLY_UNDONE_RULE} - Something went wrong while adding it.`,
      "Enrich New Cases - Something went wrong while adding it.",
    ]);
    await expect(problems).toContainText(
      "Everything else is on. Try again turns on only what is still missing.",
    );
    // No "Done", and no server sentence on its own.
    await expect(page.getByTestId("security-turned-on")).toHaveCount(0);
    await expect(problems).not.toContainText("Server Error");

    // Your logs and every other rule are on: the steps say so.
    await expect(gettingStarted(page)).toContainText("2 of 4 done");
    await expect(
      page.getByTestId("security-setup-step-detections"),
    ).toHaveAttribute("data-done", "true");
    await expect(
      page.getByTestId("security-setup-step-responses"),
    ).toHaveAttribute("data-done", "false");
    // The main button is Try again now, the test beside it.
    await expect(
      page.getByTestId("security-getting-started-actions").getByRole("button"),
    ).toHaveText(["Try again", "Send a test attack"]);
    await screenshot(page, "overview-turn-on-partly");

    // Try again does what is left, and nothing twice: exactly the recommended rules are on.
    await page.getByTestId("security-turn-on-try-again").click();
    await expect(page.getByTestId("security-turned-on")).toContainText(
      `Done. ${RECOMMENDED_RULES} detection rules are on, your logs are checked for security events and every new case is enriched.`,
    );
    await expect(problems).toHaveCount(0);
    await expect(gettingStarted(page)).toContainText("3 of 4 done");
    await expect(
      page.getByTestId("security-getting-started-actions").getByRole("button"),
    ).toHaveText(["Send a test attack"]);

    const turnOns: Array<string> = (await fixture(page)).apiRequests
      .map((request: { url: string }): string => {
        return new URL(request.url).pathname;
      })
      .filter((pathname: string): boolean => {
        return pathname.endsWith("/security-case/setup/turn-on-recommended");
      });
    expect(turnOns).toHaveLength(2);
  });

  test("a click that fails whole says so in the card, and Try again turns everything on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { empty: true, setup: "fail" });
    await page.getByTestId("security-turn-on-recommended").click();

    const problems: Locator = gettingStarted(page).getByTestId(
      "security-turn-on-problems",
    );
    await expect(problems).toContainText("Turn on recommended did not finish");
    // A server that could not be reached, in the product's words - never a gateway's.
    await expect(
      problems.getByTestId("security-turn-on-problems-error"),
    ).toHaveText("Something went wrong. Try again in a moment.");
    await expect(problems).not.toContainText("Error connecting to server");
    await expect(
      problems.getByTestId("security-turn-on-problems-note"),
    ).toHaveCount(0);
    await expect(gettingStarted(page)).toContainText("0 of 4 done");
    await expect(
      page.getByTestId("security-getting-started-actions").getByRole("button"),
    ).toHaveText(["Try again", "Send a test attack"]);
    await screenshot(page, "overview-turn-on-failed");

    await page.getByTestId("security-turn-on-try-again").click();
    await expect(page.getByTestId("security-turned-on")).toContainText(
      `Done. ${RECOMMENDED_RULES} detection rules are on`,
    );
    await expect(problems).toHaveCount(0);
    await expect(gettingStarted(page)).toContainText("3 of 4 done");
  });

  test("what a click could not do reads in the dark theme and on a phone, inside the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const layout of [
      {
        width: 1280,
        theme: "dark" as const,
        name: "overview-turn-on-partly-dark",
      },
      { width: 390, theme: undefined, name: "overview-turn-on-partly-phone" },
      {
        width: 390,
        theme: "dark" as const,
        name: "overview-turn-on-partly-phone-dark",
      },
    ]) {
      await open(page, OVERVIEW_PATH, {
        empty: true,
        setup: "partly",
        width: layout.width,
        theme: layout.theme,
      });
      await page.getByTestId("security-turn-on-recommended").click();

      const problems: Locator = gettingStarted(page).getByTestId(
        "security-turn-on-problems",
      );
      await expect(problemRows(problems)).toHaveCount(2);

      // Inside the card, nothing running off a phone's screen.
      const card: Box = await boxOf(gettingStarted(page));
      const box: Box = await boxOf(problems);
      expect(box.x).toBeGreaterThanOrEqual(card.x);
      expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
      expect(await overflowOf(problems)).toBeLessThanOrEqual(0);

      // The dark theme draws the box dark, never a light amber tile on slate.
      const background: string = await problems.evaluate(
        (element: Element): string => {
          return getComputedStyle(element).backgroundColor;
        },
      );
      if (layout.theme === "dark") {
        expect(background).not.toBe("rgb(255, 251, 235)");
      } else {
        expect(background).toBe("rgb(255, 251, 235)");
      }

      // On a phone Try again is on the first screen, above the box.
      const tryAgain: Box = await boxOf(
        page.getByTestId("security-turn-on-try-again"),
      );
      expect(tryAgain.y).toBeLessThan(box.y);
      if (layout.width === 390) {
        expect(tryAgain.y + tryAgain.height).toBeLessThan(844);
      }
      await screenshot(page, layout.name);
    }
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

    const quiet: Locator = band(page);
    await expect(quiet).toHaveAttribute("data-kind", "quiet");
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
    await expect(stage(page, "cases")).toContainText("All clear");
    await screenshot(page, "overview-all-quiet");

    await open(page, OVERVIEW_PATH, { quiet: true, theme: "dark" });
    await expect(quiet).toBeVisible();
    await screenshot(page, "overview-all-quiet-dark");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The Overview's top card
 * ---------------------------------------------------------------------------
 */

test.describe("the overview's top card", () => {
  // Where a box comes to rest, for each of the pipeline's four cells.
  async function cellBoxes(page: Page): Promise<Array<Box>> {
    const boxes: Array<Box> = [];
    for (const key of STAGE_KEYS) {
      boxes.push(await boxOf(stage(page, key)));
    }
    return boxes;
  }

  test("one card in both themes, at a laptop's width and a phone's: the band, then four cells on one hairline grid, nothing running off the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const layout of [
      { width: 1280, theme: undefined, name: "overview-top-1280" },
      { width: 1280, theme: "dark" as const, name: "overview-top-1280-dark" },
      { width: 390, theme: undefined, name: "overview-top-390" },
      { width: 390, theme: "dark" as const, name: "overview-top-390-dark" },
    ]) {
      await open(page, OVERVIEW_PATH, {
        width: layout.width,
        theme: layout.theme,
      });
      await expect(topCard(page)).toBeVisible();

      // The band first, the pipeline under it, inside one card.
      expect(
        await topCard(page).evaluate((element: Element): Array<string> => {
          return Array.from(element.children).map((child: Element) => {
            return child.getAttribute("data-testid") || "";
          });
        }),
      ).toEqual(["security-status-headline", "security-pipeline"]);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
      expect(await overflowOf(topCard(page))).toBeLessThanOrEqual(0);

      const card: Box = await boxOf(topCard(page));
      const cells: Array<Box> = await cellBoxes(page);
      for (const cell of cells) {
        expect(cell.x).toBeGreaterThanOrEqual(card.x - 0.5);
        expect(cell.x + cell.width).toBeLessThanOrEqual(
          card.x + card.width + 0.5,
        );
      }
      const figures: Array<Box> = [];
      for (const key of STAGE_KEYS) {
        figures.push(
          await boxOf(page.getByTestId(`security-pipeline-${key}-figure`)),
        );
      }
      const arrows: Locator = page.getByTestId("security-pipeline-arrow");
      await expect(arrows).toHaveCount(3);

      if (layout.width === 1280) {
        // One row: the cells share their top, and their figures one line.
        for (const index of [1, 2, 3]) {
          expect(Math.abs(cells[index]!.y - cells[0]!.y)).toBeLessThanOrEqual(
            1,
          );
          expect(
            Math.abs(figures[index]!.y - figures[0]!.y),
          ).toBeLessThanOrEqual(1);
        }
        /*
         * Each thing waiting for someone is one line beside the side menu,
         * its chevron right after its words: the link never takes less
         * width than its words need.
         */
        for (const key of ["mine", "unassigned", "approvals"]) {
          const link: Box = await boxOf(
            page.getByTestId(`security-attention-${key}`).getByRole("link"),
          );
          expect(link.height, `${key} on one line`).toBeLessThanOrEqual(21);
        }
        // A chevron sits on each line between two cells, centred on it.
        for (const index of [0, 1, 2]) {
          const arrow: Box = await boxOf(arrows.nth(index));
          const line: number = cells[index]!.x + cells[index]!.width;
          expect(
            Math.abs(arrow.x + arrow.width / 2 - line),
          ).toBeLessThanOrEqual(1.5);
          expect(arrow.y).toBeGreaterThan(cells[index]!.y);
          expect(arrow.y + arrow.height).toBeLessThan(
            cells[index]!.y + cells[index]!.height,
          );
        }
      } else {
        // Two by two on a phone, and no chevron pointing at the next row.
        expect(Math.abs(cells[1]!.y - cells[0]!.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(cells[3]!.y - cells[2]!.y)).toBeLessThanOrEqual(1);
        expect(cells[2]!.y).toBeGreaterThan(cells[0]!.y + cells[0]!.height - 1);
        for (const index of [0, 1, 2]) {
          await expect(arrows.nth(index)).toBeHidden();
        }
      }
      await screenshot(page, layout.name);
    }
  });

  test("All quiet: the test attack sits at the band's right edge - beside its words on a laptop, under them on a tablet and a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1280, 768, 390]) {
      await open(page, OVERVIEW_PATH, { quiet: true, width });

      const heading: Box = await boxOf(
        band(page).getByRole("heading", { name: "All quiet" }),
      );
      const summary: Box = await boxOf(
        band(page).getByTestId("security-status-summary"),
      );
      const button: Box = await boxOf(
        band(page).getByTestId("security-run-setup-test"),
      );
      const area: Box = await boxOf(band(page));

      // The band pads as the cells do: 20px from sm up, 16px on a phone.
      const padding: number = width < 640 ? 16 : 20;
      // At the band's right edge, as a card keeps its actions, in both layouts.
      expect(
        Math.abs(button.x + button.width - (area.x + area.width - padding)),
      ).toBeLessThanOrEqual(1.5);
      if (width === 1280) {
        expect(button.x).toBeGreaterThan(summary.x + summary.width);
        // Beside the words, not on a line of its own.
        expect(button.y).toBeLessThan(summary.y + summary.height);
      } else {
        expect(button.y).toBeGreaterThan(summary.y + summary.height);
        // Its own width, not a bar across the band.
        expect(button.width).toBeLessThan(area.width * 0.75);
      }
      if (width === 768) {
        /*
         * Beside the side menu the band is too narrow for words and button
         * side by side: the words keep the band's width, not a narrow
         * column five lines deep beside the button.
         */
        expect(summary.width).toBeGreaterThan(area.width * 0.6);
        expect(summary.height).toBeLessThanOrEqual(3 * 20 + 1);
      }
      expect(heading.y).toBeLessThan(summary.y);
    }
  });

  test("the band's disc lines up with the cells' names, and the figures' below", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { width: 1280 });

    const disc: Box = await boxOf(
      band(page).getByTestId("security-status-disc"),
    );
    const sourcesName: Box = await boxOf(
      stage(page, "sources").getByText("Sources", { exact: true }),
    );
    const card: Box = await boxOf(topCard(page));

    // Inside the card's 1px border, 20px in: the cells' own padding.
    const contentStart: number = card.x + 1 + 20;
    expect(Math.abs(disc.x - contentStart)).toBeLessThanOrEqual(0.5);
    // The cell's name follows its 14px icon and a 6px gap.
    expect(
      Math.abs(sourcesName.x - (contentStart + 14 + 6)),
    ).toBeLessThanOrEqual(0.5);
    // The figures' card below starts its names on the same line.
    const firstFigure: Box = await boxOf(
      page
        .getByRole("group", { name: "Security operations figures" })
        .getByText("Mean Time to Acknowledge", { exact: true }),
    );
    expect(Math.abs(firstFigure.x - sourcesName.x)).toBeLessThanOrEqual(1);
  });

  test("a project nothing watches says so, never All quiet, and Set up Security brings Get started back for good", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { empty: true });
    await gettingStarted(page)
      .getByTestId("security-getting-started-dismiss")
      .click();

    await expect(band(page)).toHaveAttribute("data-kind", "not-set-up");
    await expect(
      band(page).getByRole("heading", {
        name: "Nothing is being watched for threats yet",
      }),
    ).toBeVisible();
    await expect(band(page)).not.toContainText("All quiet");
    await expect(band(page).getByTestId("security-run-setup-test")).toHaveCount(
      0,
    );
    // Each part not set up says what to do, in grey, never an amber card.
    for (const [key, words] of [
      ["sources", "Connect a source"],
      ["detections", "Turn on rules"],
      ["playbooks", "Add a playbook"],
    ]) {
      await expect(stage(page, key!)).toContainText("Not set up");
      await expect(stage(page, key!)).toContainText(words!);
      expect(
        await page
          .getByTestId(`security-pipeline-${key}-figure`)
          .evaluate((element: Element): string => {
            return getComputedStyle(element).color;
          }),
      ).toBe("rgb(107, 114, 128)");
    }
    await screenshot(page, "overview-not-watched");

    // No rule on: the Detections cell opens the library, where rules are added.
    await stage(page, "detections").getByRole("link").click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(RULE_LIBRARY_PATH);

    // The dismissal is remembered: the next visit opens on the card's band.
    await open(page, OVERVIEW_PATH, { empty: true });
    await expect(band(page)).toHaveAttribute("data-kind", "not-set-up");
    await band(page).getByTestId("security-status-set-up").click();
    await expect(gettingStarted(page)).toBeVisible();
    await expect(topCard(page)).toHaveCount(0);

    // Remembered no more: the visit after opens on Get started too.
    await open(page, OVERVIEW_PATH, { empty: true });
    await expect(gettingStarted(page)).toBeVisible();
  });

  test("sources that went silent: All quiet says when the last event came, and the Sources cell says it in amber", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of [undefined, "dark" as const]) {
      await open(page, OVERVIEW_PATH, {
        quiet: true,
        sources: "silent",
        theme,
        width: 1280,
      });

      await expect(band(page)).toHaveAttribute("data-kind", "quiet");
      await expect(
        band(page).getByTestId("security-status-summary"),
      ).toHaveText(
        "No open case and nothing waiting for an approval, but the last security event arrived 3 days ago.",
      );
      await expect(stage(page, "sources")).toContainText(
        "Last event 3 days ago",
      );
      await expect(stage(page, "sources")).toHaveAttribute(
        "data-tone",
        "warning",
      );
      const colour: string = await page
        .getByTestId("security-pipeline-sources-status")
        .evaluate((element: Element): string => {
          return getComputedStyle(element).color;
        });
      // amber-700 in the light theme, the dark theme's lighter amber there.
      expect(colour).toBe(
        theme === "dark" ? "rgb(252, 211, 77)" : "rgb(180, 83, 9)",
      );
      await screenshot(
        page,
        theme === "dark"
          ? "overview-sources-silent-dark"
          : "overview-sources-silent",
      );
    }
  });

  test("the set-up figures cannot be read: the pipeline's place says so, and Try again brings the pipeline", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { fail: "status", width: 1280 });

    const failed: Locator = page.getByTestId("security-pipeline-error");
    await expect(failed).toHaveText(
      /We could not load how Security is set up\./,
    );
    await expect(failed).not.toContainText("Server Error");
    await expect(page.getByTestId("security-pipeline")).toHaveCount(0);
    // The band still says what needs someone: the overview answered.
    await expect(band(page)).toHaveAttribute("data-kind", "needs-attention");
    await screenshot(page, "overview-status-failed");

    await failed.getByTestId("security-pipeline-try-again").click();
    await expect(page.getByTestId("security-pipeline")).toBeVisible();
    await expect(failed).toHaveCount(0);

    const reads: number = (await fixture(page)).apiRequests.filter(
      (request: { url: string }): boolean => {
        return new URL(request.url).pathname.endsWith(
          "/security-case/setup/status",
        );
      },
    ).length;
    expect(reads).toBe(2);
  });

  test("the overview cannot be read: the page says so in the product's words, and Try again loads it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { fail: "overview", width: 1280 });

    const failed: Locator = page.getByTestId("security-overview-error");
    await expect(failed).toContainText(
      "We could not load the Security overview",
    );
    await expect(
      page.getByTestId("security-overview-error-message"),
    ).toHaveText("Something went wrong. Try again in a moment.");
    await expect(failed).not.toContainText("Server Error");
    await screenshot(page, "overview-failed");

    await page.getByTestId("security-overview-try-again").click();
    await expect(topCard(page)).toBeVisible();
    await expect(failed).toHaveCount(0);
    await expect(page.getByText("Riskiest Entities")).toBeVisible();
  });

  test("a test attack from the quiet band opens a case: the band turns to Needs attention and keeps the line to the case", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { quiet: true, width: 1280 });
    await band(page).getByTestId("security-run-setup-test").click();

    await expect(band(page)).toHaveAttribute("data-kind", "needs-attention");
    await expect(
      band(page).getByTestId("security-setup-test-result"),
    ).toContainText("The test opened case CASE-150");
    await expect(
      band(page).getByRole("link", {
        name: "1 open case nobody has picked up",
      }),
    ).toBeVisible();
    await expect(stage(page, "cases")).toContainText("1 open case");
    await screenshot(page, "overview-test-attack-from-band");
  });

  test("each cell opens its part's page", async ({ page }: { page: Page }) => {
    for (const [key, pathname] of [
      ["sources", `${PRODUCT}/connections`],
      ["cases", CASES_PATH],
      ["playbooks", PLAYBOOKS_PATH],
    ]) {
      await open(page, OVERVIEW_PATH, { width: 1280 });
      await stage(page, key!).getByRole("link").click();
      await expect
        .poll(() => {
          return pathnameOf(page);
        })
        .toBe(pathname);
    }
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

  test("a template becomes a working playbook in one click, built as Turn on recommended builds Enrich New Cases", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PLAYBOOKS_PATH);
    await page.getByTestId("security-playbook-template-known-bad").click();

    // It opens on the new playbook's page.
    await expect(page).toHaveURL(
      new RegExp(`${escapeRegExp(PLAYBOOKS_PATH)}/[0-9a-f-]{36}$`),
    );

    const created: Array<{ modelName: string; data: Record<string, unknown> }> =
      (await fixture(page)).creates.filter(
        (create: { modelName: string }): boolean => {
          return create.modelName === "SecurityPlaybook";
        },
      );
    expect(created).toHaveLength(1);
    expect(created[0]!.data).toMatchObject({
      name: "Escalate Known-Bad Indicators",
      isEnabled: true,
      trigger: "Detection Added",
    });
    expect((created[0]!.data["steps"] as Array<unknown>).length).toBe(3);
  });

  test("a template that cannot be added says why in the amber box, and picking it again adds it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PLAYBOOKS_PATH, { setup: "partly" });
    await page.getByTestId("security-playbook-template-known-bad").click();

    // Why, in the product's words - never the server's sentence centred in grey.
    const problems: Locator = page.getByTestId(
      "security-playbook-template-problems",
    );
    await expect(problems).toHaveAttribute("role", "alert");
    await expect(
      problems.getByTestId("security-turn-on-problems-title"),
    ).toHaveText("The playbook could not be added");
    await expect(problemRows(problems)).toHaveText([
      "Escalate Known-Bad Indicators - Your role cannot add it.",
    ]);
    await expect(problems).not.toContainText("You do not have permission");
    await expect(problems).toBeInViewport();
    // Nothing was added, so the page stays where it is.
    expect(new URL(page.url()).pathname).toBe(PLAYBOOKS_PATH);
    await screenshot(page, "playbook-template-failed");

    await page.getByTestId("security-playbook-template-known-bad").click();
    await expect(page).toHaveURL(
      new RegExp(`${escapeRegExp(PLAYBOOKS_PATH)}/[0-9a-f-]{36}$`),
    );
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

  test("the rule library is a list to scan: what each rule finds, its ATT&CK tags, the events it reads and whether they arrive, its severity, and Add or Added", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_LIBRARY_PATH, { width: 1280 });
    await expect(libraryRow(page, BRUTE_FORCE_RULE)).toBeVisible({
      timeout: 30000,
    });

    // One row a rule, every rule in sight at once.
    await expect(libraryRows(page)).toHaveCount(DETECTION_RULE_LIBRARY.length);
    await expect(page.getByTestId("rule-library-count")).toHaveText(
      `${DETECTION_RULE_LIBRARY.length} rules`,
    );

    /*
     * The six library rules, and the one the team renamed "Legacy VPN brute
     * force" and turned off: its YAML carries the library rule's id, so it
     * is that rule, added, and Off - the library never offers to add it a
     * second time.
     */
    await expect(
      page.locator('[data-testid^="rule-library-added-"]'),
    ).toHaveCount(7);
    await expect(
      page.getByTestId(`rule-library-off-${DETECTION_RULE_LIBRARY[6]!.id}`),
    ).toHaveText("Off");
    await expect(
      page.locator('[data-testid^="rule-library-off-"]'),
    ).toHaveCount(1);

    const brute: Locator = libraryRow(page, BRUTE_FORCE_RULE);
    await expect(
      brute.getByTestId(`rule-library-attack-${BRUTE_FORCE_RULE.id}`),
    ).toHaveText("Credential Access · T1110.001");
    await expect(
      brute.getByTestId(`rule-library-data-${BRUTE_FORCE_RULE.id}`),
    ).toContainText("Sign-in events");
    await expect(
      brute.getByTestId(`rule-library-data-status-${BRUTE_FORCE_RULE.id}`),
    ).toHaveText("Receiving");
    await expect(
      brute.getByTestId(`rule-library-severity-${BRUTE_FORCE_RULE.id}`),
    ).toHaveText("High");
    // The fixture's project sends no CloudTrail: that rule would find nothing.
    await expect(
      libraryRow(page, CLOUDTRAIL_RULE).getByTestId(
        `rule-library-data-status-${CLOUDTRAIL_RULE.id}`,
      ),
    ).toHaveText("Not receiving");
    await expect(
      libraryRow(page, CLOUDTRAIL_RULE).getByTestId(
        `rule-library-add-${CLOUDTRAIL_RULE.id}`,
      ),
    ).toBeVisible();

    // The ATT&CK tags are a row's quiet facts, not red chips that read as errors.
    const attackColor: string = await brute
      .getByTestId(`rule-library-attack-${BRUTE_FORCE_RULE.id}`)
      .evaluate((element: Element): string => {
        return getComputedStyle(element).color;
      });
    expect(attackColor).toBe("rgb(107, 114, 128)");

    // Add and Added sit on the name's line, the same height on every row.
    for (const [rule, end] of [
      [BRUTE_FORCE_RULE, `rule-library-added-${BRUTE_FORCE_RULE.id}`],
      [CLOUDTRAIL_RULE, `rule-library-add-${CLOUDTRAIL_RULE.id}`],
    ] as Array<[{ id: string }, string]>) {
      const name: Box = await boxOf(
        page.getByTestId(`rule-library-name-${rule.id}`),
      );
      const endBox: Box = await boxOf(page.getByTestId(end));
      expect(
        Math.abs(endBox.y + endBox.height / 2 - (name.y + 12)),
      ).toBeLessThanOrEqual(4);
    }

    // The header as every table's: the title, then the search, the main add and the ⋯.
    const header: Locator = cardTitled(page, "Rule Library").getByTestId(
      "card-header",
    );
    await expect(header).toHaveAttribute("data-header-layout", "toolbar");
    await expect(
      page.getByTestId("rule-library-toolbar").getByRole("button", {
        name: `Add ${RECOMMENDED_RULES - RECOMMENDED_RULES_ON} Recommended Rules`,
      }),
    ).toBeVisible();
    await expect(page.getByTestId("rule-library-more")).toBeVisible();

    // The rows fit the card beside the side menu: nothing scrolls sideways.
    await expect(page.getByTestId("table-scroll").first()).toHaveAttribute(
      "data-overflowing",
      "false",
    );
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "rule-library-desktop", { fullPage: false });
  });

  test("the rule library narrows by category, data and status in three selects beside each other, which a phone stacks", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [width, theme] of [
      [1280, undefined],
      [1280, "dark"],
      [1024, undefined],
      [390, undefined],
      [390, "dark"],
    ] as Array<[number, "dark" | undefined]>) {
      await open(page, RULE_LIBRARY_PATH, { width, height: 900, theme });
      await expect(libraryRow(page, BRUTE_FORCE_RULE)).toBeVisible({
        timeout: 30000,
      });

      const filters: Locator = page.getByTestId("rule-library-filters");
      const category: Box = await boxOf(
        filters.getByRole("combobox", { name: "Rule categories" }),
      );
      const data: Box = await boxOf(
        filters.getByRole("combobox", { name: "Data the rules read" }),
      );
      const status: Box = await boxOf(
        filters.getByRole("combobox", { name: "Rule status" }),
      );

      // No row of buttons across the card to read as tabs.
      await expect(filters.getByRole("button")).toHaveCount(0);

      if (width === 1024) {
        /*
         * Beside the side menu the three may take two lines (the fixture's
         * page is 64px narrower than production's): one height, never on
         * top of each other.
         */
        expect(Math.abs(data.height - category.height)).toBeLessThanOrEqual(1);
        expect(Math.abs(status.height - category.height)).toBeLessThanOrEqual(
          1,
        );
        expect(
          status.y >= data.y + data.height || status.x >= data.x + data.width,
        ).toBe(true);
      } else if (width > 1024) {
        // One line, side by side, one height.
        expect(data.x).toBeGreaterThan(category.x + category.width);
        expect(status.x).toBeGreaterThan(data.x + data.width);
        expect(Math.abs(data.y - category.y)).toBeLessThanOrEqual(2);
        expect(Math.abs(status.y - category.y)).toBeLessThanOrEqual(2);
        expect(Math.abs(data.height - category.height)).toBeLessThanOrEqual(1);
      } else {
        // One under the other, each the card's width, so no word is cut short.
        expect(data.y).toBeGreaterThanOrEqual(category.y + category.height);
        expect(status.y).toBeGreaterThanOrEqual(data.y + data.height);
        expect(Math.abs(data.width - category.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(status.width - category.width)).toBeLessThanOrEqual(1);
      }

      if (width >= 1024) {
        /*
         * Every column fits the card beside the side menu, the longest rule
         * names and data kinds wrapping: nothing scrolls sideways, so the
         * Add column never sits over the severity.
         */
        await expect(page.getByTestId("table-scroll").first()).toHaveAttribute(
          "data-overflowing",
          "false",
        );
      }

      // A category narrows the rows to its own, and says how many.
      await filters
        .getByRole("combobox", { name: "Rule categories" })
        .selectOption("Kubernetes");
      await expect(libraryRows(page)).toHaveCount(4);
      await expect(page.getByTestId("rule-library-count")).toHaveText(
        "4 rules",
      );
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
      await screenshot(
        page,
        `rule-library-filtered-${width}-${theme || "light"}`,
        { fullPage: false },
      );

      // And the way back.
      await page.getByTestId("rule-library-clear-filters").click();
      await expect(libraryRows(page)).toHaveCount(
        DETECTION_RULE_LIBRARY.length,
      );
    }
  });

  test("the rule library's data and status filters, and a search over ATT&CK and severity", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_LIBRARY_PATH, { width: 1280 });
    await expect(libraryRow(page, BRUTE_FORCE_RULE)).toBeVisible({
      timeout: 30000,
    });
    const filters: Locator = page.getByTestId("rule-library-filters");

    // The data the project sends: Okta, Defender XDR's processes, Kubernetes audit logs.
    await filters
      .getByRole("combobox", { name: "Data the rules read" })
      .selectOption("received");
    await expect(libraryRow(page, BRUTE_FORCE_RULE)).toBeVisible();
    await expect(libraryRow(page, CLOUDTRAIL_RULE)).toHaveCount(0);
    for (const status of await page
      .locator('[data-testid^="rule-library-data-status-"]')
      .all()) {
      await expect(status).toHaveText("Receiving");
    }

    // ... that it lacks: the rules it has not added yet.
    await filters
      .getByRole("combobox", { name: "Rule status" })
      .selectOption("not-added");
    await expect(
      page.locator('[data-testid^="rule-library-added-"]'),
    ).toHaveCount(0);
    await expect(libraryRows(page).first()).toBeVisible();

    await page.getByTestId("rule-library-clear-filters").click();

    /*
     * The search finds a technique by its id, and the rules of its
     * sub-techniques. "/" opens the search, as every table's does.
     */
    await page.keyboard.press("/");
    await expect(page.getByTestId(RULE_LIBRARY_SEARCH)).toBeFocused();
    await page.keyboard.type("T1110");
    await expect(libraryRow(page, BRUTE_FORCE_RULE)).toBeVisible();
    await expect(libraryRow(page, CLOUDTRAIL_RULE)).toHaveCount(0);
    await page.getByTestId(RULE_LIBRARY_SEARCH).fill("critical");
    await expect(libraryRow(page, SHADOW_COPIES_RULE)).toBeVisible();
    await expect(libraryRow(page, BRUTE_FORCE_RULE)).toHaveCount(0);

    // A search that finds nothing says so, with the way back.
    await page.getByTestId(RULE_LIBRARY_SEARCH).fill("mainframe");
    await expect(page.getByTestId("rule-library-no-match")).toContainText(
      "No rule matches your search or filters",
    );
    await page
      .getByTestId("rule-library-no-match")
      .getByRole("button", { name: "Clear Search" })
      .click();
    await expect(libraryRows(page)).toHaveCount(DETECTION_RULE_LIBRARY.length);
  });

  test("a filtered library lives in the page's address: a reload keeps it, and ATT&CK Coverage opens it on a technique", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_LIBRARY_PATH, { width: 1280 });
    await expect(libraryRow(page, BRUTE_FORCE_RULE)).toBeVisible({
      timeout: 30000,
    });
    const filters: Locator = page.getByTestId("rule-library-filters");
    await filters
      .getByRole("combobox", { name: "Rule categories" })
      .selectOption("Cloud");
    await filters
      .getByRole("combobox", { name: "Rule status" })
      .selectOption("not-added");

    await expect
      .poll(() => {
        return new URL(page.url()).searchParams.get("category");
      })
      .toBe("Cloud");
    expect(new URL(page.url()).searchParams.get("status")).toBe("not-added");

    await page.reload();
    await expect(page.getByTestId("synthetic-banner")).toBeVisible({
      timeout: 60000,
    });
    await expect(
      page
        .getByTestId("rule-library-filters")
        .getByRole("combobox", { name: "Rule categories" }),
    ).toHaveValue("Cloud");
    await expect(libraryRow(page, CLOUDTRAIL_RULE)).toBeVisible();
    await expect(libraryRow(page, BRUTE_FORCE_RULE)).toHaveCount(0);

    // ATT&CK Coverage: a technique's rules in the library, one click away.
    await open(page, ATTACK_COVERAGE_PATH, { width: 1280 });
    await expect(page.getByText("2 / 227")).toBeVisible({ timeout: 30000 });
    await page.getByTestId("attack-technique-T1110").first().click();
    await page.getByRole("link", { name: "Open the rule library" }).click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(RULE_LIBRARY_PATH);
    await expect(page.getByTestId(RULE_LIBRARY_SEARCH)).toHaveValue("T1110");
    await expect(libraryRow(page, SEQUENCE_LIBRARY_RULE)).toBeVisible();
    await expect(libraryRow(page, CLOUDTRAIL_RULE)).toHaveCount(0);
  });

  test("a rule's details open beside the list: the events it reads and how to send them, how it runs, its ATT&CK tags and its Sigma rule", async ({
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
      await expect(libraryRow(page, CLOUDTRAIL_RULE)).toBeVisible({
        timeout: 30000,
      });
      await page.getByTestId(`rule-library-name-${CLOUDTRAIL_RULE.id}`).click();

      const panel: Locator = page.getByTestId("rule-library-details");
      await expect(page.getByTestId("side-over-title")).toHaveText(
        CLOUDTRAIL_RULE.title,
      );
      await expect(
        panel.getByTestId("rule-library-details-data-status"),
      ).toHaveText("Not receiving");
      await expect(
        panel.getByTestId("rule-library-details-how-to-send"),
      ).toContainText(
        "Send CloudTrail to OneUptime as logs and find security events in your logs.",
      );
      await expect(
        panel.getByTestId("rule-library-details-runs"),
      ).toContainText("Runs every");
      await expect(
        panel.getByTestId("rule-library-details-attack"),
      ).toContainText("Defense Impairment");
      await expect(
        panel.getByTestId("rule-library-details-sigma").locator("code"),
      ).toContainText(`id: ${CLOUDTRAIL_RULE.id}`);
      await expect(
        page.getByTestId("side-over-footer").getByRole("button", {
          name: "Add Rule",
        }),
      ).toBeVisible();
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
      await screenshot(
        page,
        `rule-library-details-${width}-${theme || "light"}`,
        {
          fullPage: false,
        },
      );
    }

    // How to send them leads to Connections.
    await page.getByTestId("rule-library-details-send-link").click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(`${PRODUCT}/connections`);
  });

  test("adding: a row's Add, the recommended rules after a dialog that names them, and the matching rules from the header", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_LIBRARY_PATH, { width: 1280, empty: true });
    await expect(libraryRow(page, BRUTE_FORCE_RULE)).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.locator('[data-testid^="rule-library-added-"]'),
    ).toHaveCount(0);

    // One row's Add: the row says Added at once.
    await page.getByTestId(`rule-library-add-${PORT_SCAN_RULE.id}`).click();
    await expect(
      page.getByTestId(`rule-library-added-${PORT_SCAN_RULE.id}`),
    ).toBeVisible();

    // The recommended rules: a dialog names every one before anything is added.
    await page
      .getByTestId("rule-library-toolbar")
      .getByRole("button", {
        name: `Add ${RECOMMENDED_RULES} Recommended Rules`,
      })
      .click();
    const dialog: Locator = page.getByTestId("modal");
    await expect(dialog.getByTestId("modal-title")).toHaveText(
      `Add ${RECOMMENDED_RULES} recommended rules?`,
    );
    await expect(
      dialog.locator('[data-testid^="rule-library-add-item-"]'),
    ).toHaveCount(RECOMMENDED_RULES);
    await expect(
      page.locator('[data-testid^="rule-library-added-"]'),
    ).toHaveCount(1);
    await screenshot(page, "rule-library-add-recommended-dialog", {
      fullPage: false,
    });
    await dialog.getByRole("button", { name: "Add Rules" }).click();
    await expect(
      page.locator('[data-testid^="rule-library-added-"]'),
    ).toHaveCount(RECOMMENDED_RULES + 1);
    await expect(
      page
        .getByTestId("rule-library-toolbar")
        .getByRole("button", { name: /Recommended Rules?$/ }),
    ).toHaveCount(0);

    // A narrowed list: the main add says it adds the matching rules, just those.
    await page
      .getByTestId("rule-library-filters")
      .getByRole("combobox", { name: "Rule categories" })
      .selectOption("Network");
    await page
      .getByTestId("rule-library-toolbar")
      .getByRole("button", { name: "Add 1 Matching Rule" })
      .click();
    await expect(
      page.getByTestId("modal").getByTestId("modal-title"),
    ).toHaveText("Add 1 rule?");
    await page
      .getByTestId("modal")
      .getByRole("button", { name: "Add Rule" })
      .click();
    await expect(
      page.getByTestId(`rule-library-added-${NETWORK_SWEEP_RULE.id}`),
    ).toBeVisible();
    // Every rule the library added is the record Turn on recommended adds: on, opening cases.
    const created: Array<{ modelName: string; data: Record<string, unknown> }> =
      (await fixture(page)).creates.filter(
        (item: { modelName: string }): boolean => {
          return item.modelName === "DetectionRule";
        },
      );
    expect(created).toHaveLength(RECOMMENDED_RULES + 2);
    for (const item of created) {
      expect(item.data["isEnabled"]).toBe(true);
      expect(item.data["shouldCreateCase"]).toBe(true);
    }
  });

  test("an Add that cannot add says why on its row; the recommended adds that cannot add one say so above the rules, in view, and the button offers the one left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_LIBRARY_PATH, {
      width: 1280,
      empty: true,
      setup: "partly",
    });
    const spraying: Locator = libraryRow(page, PASSWORD_SPRAYING_RULE);
    await expect(spraying).toBeVisible({ timeout: 30000 });

    await spraying
      .getByTestId(`rule-library-add-${PASSWORD_SPRAYING_RULE.id}`)
      .click();

    // Said where the reader clicked - the one alert - and not above the rules.
    const why: Locator = spraying.getByTestId(
      `rule-library-problem-${PASSWORD_SPRAYING_RULE.id}`,
    );
    await expect(why).toHaveText("Something went wrong while adding it.");
    await expect(why).toHaveAttribute("role", "alert");
    await expect(why).toBeInViewport();
    await expect(page.getByTestId("rule-library-problems")).toHaveCount(0);
    await expect(
      spraying.getByTestId(`rule-library-add-${PASSWORD_SPRAYING_RULE.id}`),
    ).toBeVisible();
    await screenshot(page, "rule-library-add-failed", { fullPage: false });
    await spraying
      .getByTestId(`rule-library-add-${PASSWORD_SPRAYING_RULE.id}`)
      .click();
    await expect(
      spraying.getByTestId(`rule-library-added-${PASSWORD_SPRAYING_RULE.id}`),
    ).toBeVisible();
    await expect(why).toHaveCount(0);
  });

  test("the recommended adds that cannot add one name it above the rules, in view, say the others were added, and the button offers the one left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_LIBRARY_PATH, {
      width: 1280,
      empty: true,
      setup: "partly",
    });
    await expect(libraryRow(page, BRUTE_FORCE_RULE)).toBeVisible({
      timeout: 30000,
    });
    await page
      .getByTestId("rule-library-toolbar")
      .getByRole("button", {
        name: `Add ${RECOMMENDED_RULES} Recommended Rules`,
      })
      .click();
    await page
      .getByTestId("modal")
      .getByRole("button", { name: "Add Rules" })
      .click();

    const problems: Locator = page.getByTestId("rule-library-problems");
    await expect(
      problems.getByTestId("security-turn-on-problems-title"),
    ).toHaveText("1 rule could not be added");
    await expect(problemRows(problems)).toHaveText([
      `${PARTLY_UNDONE_RULE} - Something went wrong while adding it.`,
    ]);
    await expect(
      problems.getByTestId("security-turn-on-problems-note"),
    ).toHaveText("The others were added.");
    // Wherever the confirmation left the page, the box is brought into view.
    await expect(problems).toBeInViewport();
    await expect(
      libraryRow(page, PASSWORD_SPRAYING_RULE).getByTestId(
        `rule-library-problem-${PASSWORD_SPRAYING_RULE.id}`,
      ),
    ).toHaveText("Something went wrong while adding it.");
    await screenshot(page, "rule-library-add-all-failed", { fullPage: false });

    await page
      .getByTestId("rule-library-toolbar")
      .getByRole("button", { name: "Add 1 Recommended Rule" })
      .click();
    await expect(
      page.getByTestId("modal").getByTestId("modal-title"),
    ).toHaveText("Add 1 recommended rule?");
    await page
      .getByTestId("modal")
      .getByRole("button", { name: "Add Rule" })
      .click();
    await expect(
      page
        .getByTestId("rule-library-toolbar")
        .getByRole("button", { name: /Recommended Rules?$/ }),
    ).toHaveCount(0);
    await expect(problems).toHaveCount(0);
  });

  test("a new project is told once that nothing arrives; events that cannot be read say so, with Try again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_LIBRARY_PATH, { width: 1280, empty: true });
    await expect(libraryRow(page, BRUTE_FORCE_RULE)).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByTestId("rule-library-nothing-sent")).toContainText(
      "No security events arrived in the last 7 days, so no rule has anything to read yet.",
    );
    await expect(
      page.locator('[data-testid^="rule-library-data-status-"]'),
    ).toHaveCount(0);
    await expect(
      page
        .getByTestId("rule-library-filters")
        .getByRole("combobox", { name: "Data the rules read" }),
    ).toBeDisabled();
    await screenshot(page, "rule-library-new-project", { fullPage: false });

    await open(page, RULE_LIBRARY_PATH, { width: 1280, data: "fail" });
    await expect(libraryRow(page, BRUTE_FORCE_RULE)).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByTestId("rule-library-data-unknown")).toContainText(
      "Could not check which events this project sends.",
    );
    await expect(
      page.locator('[data-testid^="rule-library-data-status-"]'),
    ).toHaveCount(0);
    await page.getByTestId("rule-library-data-retry").click();
    // The fixture's read fails every time: asked again, it says so again.
    await expect
      .poll(async (): Promise<number> => {
        return (await aggregateRequestsOf(page)).length;
      })
      .toBe(2);
    await expect(page.getByTestId("rule-library-data-unknown")).toBeVisible();
  });

  test("the rule library in German and Japanese: every word of its own translated and whole, the rows fitting beside the side menu, Add always in sight", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * The fixture's frame is 64px narrower than production's (its page's
     * padding): 1088 here is production's 1024 beside the side menu.
     */
    for (const [lang, width, recommended, receiving] of [
      ["de", 1280, "17 empfohlene Regeln hinzufügen", "Empfangen"],
      ["de", 1088, "17 empfohlene Regeln hinzufügen", "Empfangen"],
      ["de", 1024, "17 empfohlene Regeln hinzufügen", "Empfangen"],
      ["de", 390, "17 empfohlene Regeln hinzufügen", "Empfangen"],
      ["ja", 1280, "おすすめのルールを 17 件追加", "受信中"],
      ["ja", 390, "おすすめのルールを 17 件追加", "受信中"],
    ] as Array<["de" | "ja", number, string, string]>) {
      await open(page, RULE_LIBRARY_PATH, { width, height: 900, lang });
      await expect(libraryRow(page, BRUTE_FORCE_RULE)).toBeVisible({
        timeout: 30000,
      });
      await expect(
        page
          .getByTestId("rule-library-toolbar")
          .getByRole("button", { name: recommended }),
      ).toBeVisible();
      await expect(
        page.getByTestId(`rule-library-data-status-${BRUTE_FORCE_RULE.id}`),
      ).toHaveText(receiving);
      expect(
        await pageOverflow(page),
        `${lang} at ${width}`,
      ).toBeLessThanOrEqual(1);
      if (width >= 1088) {
        /*
         * The longer words wrap in their columns, and the rule's gives way
         * down to 12rem: nothing scrolls sideways.
         */
        await expect(
          page.getByTestId("table-scroll").first(),
          `${lang} at ${width}`,
        ).toHaveAttribute("data-overflowing", "false");
      }
      if (lang === "de" && width > 390) {
        /*
         * A word stays whole: the Data column is never narrower than its
         * longest, so Anmeldeereignisse is not cut into Anmeldeereignis
         * and se.
         */
        const dataKind: Locator = page
          .getByTestId(`rule-library-data-${BRUTE_FORCE_RULE.id}`)
          .locator("span")
          .first();
        await expect(dataKind).toHaveText("Anmeldeereignisse");
        expect(
          await dataKind.evaluate((element: Element): number => {
            const range: Range = document.createRange();
            range.selectNodeContents(element);
            return range.getClientRects().length;
          }),
          `the lines of ${lang} at ${width}`,
        ).toBe(1);

        /*
         * Beside the side menu, in the fixture's narrower frame, German's
         * longer words may scroll the rows sideways (production's frame,
         * 64px wider, fits them): Add, or Added, stays at the card's edge
         * in sight.
         */
        await expect(
          page.getByTestId(`rule-library-added-${BRUTE_FORCE_RULE.id}`),
        ).toBeInViewport({ ratio: 1 });
      }
      await screenshot(page, `rule-library-${lang}-${width}`, {
        fullPage: false,
      });
    }
  });

  test("Detections is a section of pages, each its own address, its entry lit on each, no row of tabs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_LIBRARY_PATH);
    await expect(libraryRow(page, BRUTE_FORCE_RULE)).toBeVisible({
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
    /*
     * That playbook's run on the case waits for an approval already: the
     * card says so where Run playbook would be, rather than start a second
     * run asking for the same approval.
     */
    await expect(
      card.getByTestId("security-case-ai-suggested-playbook-run"),
    ).toHaveText("Waiting for Approval");
    await expect(card.getByTestId("security-case-ai-run-playbook")).toHaveCount(
      0,
    );
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
    // The web shell: OneUptime AI suggests Enrich New Cases, whose run failed.
    await open(page, POWERSHELL_CASE_PATH);
    const card: Locator = aiCard(page);

    await expect(
      card.getByTestId("security-case-ai-suggested-playbook"),
    ).toContainText("Enrich New Cases", { timeout: 30000 });
    // A finished run leaves Run playbook one click away.
    await expect(
      card.getByTestId("security-case-ai-suggested-playbook-run"),
    ).toHaveCount(0);
    await card.getByTestId("security-case-ai-run-playbook").click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Enrich New Cases");
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
    // Its run on this case is going already: said, rather than run twice.
    await expect(
      card.getByTestId("security-case-ai-suggested-playbook-run"),
    ).toHaveText("Running");

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
    // The suggested playbook is named in full, beside or above its run's status.
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

/*
 * ---------------------------------------------------------------------------
 * OneUptime AI: what the case's card says when a triage cannot run, stopped,
 * or read text written to steer it (the fixture's ?triage= scenarios)
 * ---------------------------------------------------------------------------
 */
test.describe("OneUptime AI when a triage cannot run, or was steered", () => {
  function aiCard(page: Page): Locator {
    return page.getByTestId("security-case-ai-card");
  }

  /*
   * Every button in the card starts on the content's left edge: Button
   * carries md:ml-3 for dialog footers, which pushed the first button of a
   * row 12px in from the text above it.
   */
  async function expectOnTheContentEdge(
    page: Page,
    button: Locator,
  ): Promise<void> {
    const content: Box = await boxOf(
      aiCard(page).locator("[data-testid='card-header-title-block']").first(),
    );
    const drawn: Box = await boxOf(button);
    expect(Math.abs(drawn.x - content.x)).toBeLessThanOrEqual(1);
  }

  test("the card's buttons sit on the content's edge, in light and dark", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of [undefined, "dark"] as const) {
      await open(page, SPRAY_CASE_PATH, { theme, width: 1280 });
      await expect(
        aiCard(page).getByTestId("security-case-ai-triaged"),
      ).toBeVisible({ timeout: 30000 });
      await expectOnTheContentEdge(
        page,
        aiCard(page).getByTestId("security-case-ai-ask"),
      );
    }

    await open(page, DOMAIN_CASE_PATH, { width: 1280 });
    await expect(
      aiCard(page).getByTestId("security-case-ai-not-triaged"),
    ).toBeVisible({ timeout: 30000 });
    await expectOnTheContentEdge(
      page,
      aiCard(page).getByTestId("security-case-ai-triage-button"),
    );
  });

  test("a project that cannot triage now says why in place of Triage again, and where to fix it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH, { triage: "limit", width: 1280 });
    const card: Locator = aiCard(page);
    const reason: Locator = card.getByTestId("security-case-ai-reason");

    await expect(card.getByTestId("security-case-ai-triaged")).toBeVisible({
      timeout: 30000,
    });
    await expect(reason).toContainText(
      "The project reached its daily AI limit. OneUptime AI starts again at midnight UTC.",
    );
    await expect(reason.getByRole("link")).toHaveText(
      "Go to Project Settings → AI → AI Features",
    );
    // No Triage again that could not start; asking about the read still works.
    await expect(
      card.getByTestId("security-case-ai-triage-button"),
    ).toHaveCount(0);
    await expect(card.getByTestId("security-case-ai-ask")).toBeEnabled();
    await screenshot(page, "case-ai-limit-desktop", { fullPage: false });

    await open(page, SPRAY_CASE_PATH, {
      triage: "limit",
      width: 390,
      height: 844,
    });
    await expect(card.getByTestId("security-case-ai-reason")).toBeVisible({
      timeout: 30000,
    });
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    expect(await overflowOf(card)).toBeLessThanOrEqual(1);
  });

  test("with no LLM provider, the fix goes to who may set one up; a Security Viewer is told who can", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DOMAIN_CASE_PATH, { triage: "provider", width: 1280 });
    const card: Locator = aiCard(page);
    const reason: Locator = card.getByTestId("security-case-ai-reason");

    await expect(reason).toContainText(
      "OneUptime AI has no LLM provider to use in this project.",
      { timeout: 30000 },
    );
    await expect(reason.getByRole("link")).toHaveText("Set up an LLM provider");
    await expect(
      card.getByTestId("security-case-ai-triage-button"),
    ).toHaveCount(0);
    await screenshot(page, "case-ai-provider-desktop", { fullPage: false });

    await open(page, DOMAIN_CASE_PATH, {
      triage: "provider",
      role: "viewer",
      width: 1280,
    });
    await expect(
      card.getByTestId("security-case-ai-reason-who-can"),
    ).toHaveText("A project administrator can review these settings.", {
      timeout: 30000,
    });
    await expect(
      card.getByTestId("security-case-ai-reason").getByRole("link"),
    ).toHaveCount(0);
  });

  test("out of AI credits: Add AI credits for an owner, who can for a Security Viewer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DOMAIN_CASE_PATH, { triage: "credits", width: 1280 });
    const card: Locator = aiCard(page);

    await expect(card.getByTestId("security-case-ai-reason")).toContainText(
      "The project is out of AI credits.",
      { timeout: 30000 },
    );
    await expect(
      card.getByTestId("security-case-ai-reason").getByRole("link"),
    ).toHaveText("Add AI credits");

    await open(page, DOMAIN_CASE_PATH, {
      triage: "credits",
      role: "viewer",
      width: 1280,
    });
    await expect(
      card.getByTestId("security-case-ai-reason-who-can"),
    ).toHaveText(
      "A project owner or someone with Manage Billing can add AI credits.",
      { timeout: 30000 },
    );
  });

  test("a triage that stopped says why, and Try again reads the case", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DOMAIN_CASE_PATH, { triage: "failed", width: 1280 });
    const card: Locator = aiCard(page);

    await expect(card.getByTestId("security-case-ai-failed")).toBeVisible({
      timeout: 30000,
    });
    await expect(card).toContainText("The triage did not finish");
    // Why it stopped, as the run recorded it.
    await expect(
      card.getByTestId("security-case-ai-failed-notice"),
    ).toContainText("The LLM provider did not answer in time.");
    const tryAgain: Locator = card.getByTestId(
      "security-case-ai-triage-button",
    );
    await expect(tryAgain).toHaveText("Try again");
    await expectOnTheContentEdge(page, tryAgain);
    await screenshot(page, "case-ai-failed-desktop", { fullPage: false });

    await tryAgain.click();
    await expect(card.getByTestId("security-case-ai-triaged")).toBeVisible({
      timeout: 30000,
    });
    await expect(card).toContainText("Likely Malicious");
  });

  test("text written to steer an AI is said first, once, and the read keeps no suggestion", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, API_KEY_CASE_PATH, { triage: "injection", width: 1280 });
    const card: Locator = aiCard(page);
    const notice: Locator = card.getByTestId(
      "security-case-ai-prompt-injection",
    );

    await expect(notice).toBeVisible({ timeout: 30000 });
    await expect(notice).toContainText(
      "Text in this case reads like instructions to an AI",
    );
    await expect(notice).toContainText(
      "OneUptime AI treated it as data and leaves the call to you.",
    );
    await expect(card).toContainText("Inconclusive");
    // The runner's own heads-up is left out of the report the card draws.
    await expect(card).not.toContainText("Heads up:");
    await expect(
      card.getByText(/reads like instructions to an AI/),
    ).toHaveCount(1);
    // The notice comes before the report.
    expect((await boxOf(notice)).y).toBeLessThan(
      (await boxOf(card.getByText("Summary", { exact: true }))).y,
    );
    // Nothing the steered answer suggested is offered.
    await expect(
      card.getByTestId("security-case-ai-suggested-priority"),
    ).toHaveCount(0);
    await screenshot(page, "case-ai-injection-desktop", { fullPage: false });

    await open(page, API_KEY_CASE_PATH, {
      triage: "injection",
      theme: "dark",
      width: 390,
      height: 844,
    });
    await expect(
      card.getByTestId("security-case-ai-prompt-injection"),
    ).toBeVisible({ timeout: 30000 });
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "case-ai-injection-phone-dark");
  });

  test("a later triage that stopped keeps the read before it, and says so under the read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH, { triage: "retry", width: 1280 });
    const card: Locator = aiCard(page);
    const notice: Locator = card.getByTestId(
      "security-case-ai-last-run-failed",
    );

    await expect(notice).toContainText(
      "The latest triage did not finish. This is the one before it.",
      { timeout: 30000 },
    );
    // Why it stopped, as the run recorded it - as a failed triage says it.
    await expect(
      notice.getByTestId("security-case-ai-last-run-failed-why"),
    ).toHaveText("The LLM provider did not answer in time.");
    await expect(card).toContainText("Likely Malicious");
    await expect(card.getByTestId("security-case-ai-triage-button")).toHaveText(
      "Triage again",
    );
  });

  test("a Security Viewer is told who can triage, and offered nothing it cannot press", async ({
    page,
  }: {
    page: Page;
  }) => {
    // A case nobody has read: Triage with AI greyed, who can beside it.
    await open(page, DOMAIN_CASE_PATH, {
      triage: "auto-off",
      role: "viewer",
      width: 1280,
    });
    const card: Locator = aiCard(page);

    await expect(
      card.getByTestId("security-case-ai-triage-button"),
    ).toBeDisabled({ timeout: 30000 });
    await expect(
      card.getByTestId("security-case-ai-who-can-triage"),
    ).toHaveText("Someone who can edit this case can start a triage.");
    // Where the switch is, is for who may triage.
    await expect(
      card.getByTestId("security-case-ai-automatic-off"),
    ).toHaveCount(0);

    /*
     * A triaged case whose suggested priority an owner could set (Low over
     * its Medium): the read and Ask, no Triage again or Set priority.
     */
    await open(page, API_KEY_CASE_PATH, { role: "viewer", width: 1280 });
    await expect(card.getByTestId("security-case-ai-triaged")).toBeVisible({
      timeout: 30000,
    });
    await expect(
      card.getByTestId("security-case-ai-suggested-priority"),
    ).toBeVisible();
    await expect(card.getByTestId("security-case-ai-ask")).toBeEnabled();
    await expect(
      card.getByTestId("security-case-ai-triage-button"),
    ).toHaveCount(0);
    await expect(card.getByTestId("security-case-ai-set-priority")).toHaveCount(
      0,
    );
    await expect(
      card.getByTestId("security-case-ai-who-can-triage"),
    ).toHaveCount(0);
    await screenshot(page, "case-ai-viewer-desktop", { fullPage: false });
  });

  test("with new cases not triaged on their own, the card says where to turn it on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DOMAIN_CASE_PATH, { triage: "auto-off", width: 1280 });
    const note: Locator = aiCard(page).getByTestId(
      "security-case-ai-automatic-off",
    );

    await expect(note).toContainText(
      "New cases are not triaged automatically.",
      { timeout: 30000 },
    );
    await note.getByRole("link").click();
    await expect
      .poll((): string => {
        return new URL(page.url()).pathname;
      })
      .toBe(AI_SETTINGS_PATH);
    await expect(
      page.getByTestId("ai-switch-enableAutomaticSecurityCaseTriage"),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("Close Case names OneUptime AI's read over the verdict it starts on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, API_KEY_CASE_PATH, { width: 1280 });
    await expect(
      aiCard(page).getByTestId("security-case-ai-triaged"),
    ).toBeVisible({ timeout: 30000 });
    await page.getByTestId("security-case-close").click();

    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toContainText(
      "OneUptime AI read this case as Likely Benign. Pick what you found.",
    );
    // The closing note says what it is for once; its label says Optional.
    await expect(dialog).toContainText(
      "What was found and what was done, for whoever reads this case next.",
    );
    await expect(dialog).not.toContainText("Optional. What was found");
    await screenshot(page, "case-close-ai-read-desktop", { fullPage: false });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

    // With AI off, nothing of it: the dialog starts on True Positive.
    await open(page, API_KEY_CASE_PATH, { ai: "off", width: 1280 });
    await expect(page.getByTestId("security-case-close")).toBeVisible({
      timeout: 30000,
    });
    await page.getByTestId("security-case-close").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).not.toContainText("OneUptime AI");
  });

  test("the timeline has the triage, with its report behind Show details", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH, { width: 1280 });
    const entry: Locator = page
      .getByTestId("feed-entry")
      .filter({ hasText: "OneUptime AI triaged this case: Likely Malicious." });

    await expect(entry).toBeVisible({ timeout: 30000 });
    await expect(entry).toContainText(
      "It suggests priority Critical and a playbook.",
    );
    // The report itself waits behind the entry's details.
    await expect(entry).not.toContainText(
      "This is a password spray that most likely succeeded.",
    );
    await entry.getByTestId("feed-entry-details-toggle").click();
    await expect(entry).toContainText(
      "This is a password spray that most likely succeeded.",
    );
  });

  test("Draft with AI's box has one action and an x beside its question", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH, { width: 1280 });
    await page
      .getByRole("button", { name: "Create Detection Rule", exact: true })
      .click({ timeout: 30000 });
    const dialog: Locator = page.getByRole("dialog");
    const draft: Locator = dialog.getByTestId("detection-rule-ai-draft");

    // The quiet button's mark sits on the field's edge, under its label.
    const openButton: Locator = dialog.getByTestId(
      "detection-rule-ai-draft-open",
    );
    const label: Box = await boxOf(
      dialog.getByText("Sigma Rule (YAML)", { exact: true }),
    );
    const mark: Box = await boxOf(openButton.locator("svg").first());
    expect(Math.abs(mark.x - label.x)).toBeLessThanOrEqual(2);

    await openButton.click();
    await expect(draft.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    const close: Locator = draft.getByRole("button", {
      name: "Close Draft with AI",
    });
    await expect(close).toBeVisible();
    const submit: Locator = draft.getByTestId("detection-rule-ai-draft-submit");
    // Draft rule starts on the box's left edge.
    expect(
      Math.abs(
        (await boxOf(submit)).x - (await boxOf(draft.getByRole("textbox"))).x,
      ),
    ).toBeLessThanOrEqual(1);

    await close.click();
    await expect(
      dialog.getByTestId("detection-rule-ai-draft-description"),
    ).toHaveCount(0);
    await expect(dialog.getByTestId("detection-rule-ai-draft-open")).toHaveText(
      "Draft with AI",
    );
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
    ["rule library", RULE_LIBRARY_PATH, "Brute force from one IP address"],
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
