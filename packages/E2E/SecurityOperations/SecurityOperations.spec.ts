import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
  isRecommendedDetectionRule,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import { RECOMMENDED_THREAT_INTEL_LISTS } from "Common/Types/SecurityEvent/ThreatIntelFeedType";
import { MITRE_TACTIC_TECHNIQUES } from "Common/Types/SecurityEvent/MitreAttack";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import fs from "fs/promises";
import path from "path";

/*
 * The Security Events SOC pages - the overview, the case queue's pages, a
 * case, entities, the rule library, ATT&CK coverage, playbooks, a playbook
 * and the runs - on the fixture's synthetic month (Fixture/Fixture.js), with
 * the side menu that holds them: nine sections, every page an entry of its
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
// Entities' old address: it opens Entity Risk, the one ranking of who is riskiest.
const ENTITIES_PATH: string = `${PRODUCT}/entities`;
const ENTITY_RISK_PATH: string = `${PRODUCT}/entity-risk`;
const RULE_LIBRARY_PATH: string = `${PRODUCT}/rule-library`;
const ATTACK_COVERAGE_PATH: string = `${PRODUCT}/attack-coverage`;
const PLAYBOOKS_PATH: string = `${PRODUCT}/playbooks`;
const CONTAIN_PLAYBOOK_PATH: string = `${PRODUCT}/playbooks/24000000-0000-4000-8000-000000000003`;
// The runs held for an approval keep the runs page's old address.
const RUNS_PATH: string = `${PRODUCT}/playbook-runs`;
const ALL_RUNS_PATH: string = `${PRODUCT}/playbook-runs/all`;
const PROTECTED_ENTITIES_PATH: string = `${PRODUCT}/protected-entities`;
const DETECTION_RULES_PATH: string = `${PRODUCT}/detection-rules`;
const THREAT_INTEL_PATH: string = `${PRODUCT}/threat-intel`;
// The known-bad domain case nobody has picked up, and OneUptime AI has not read.
const DOMAIN_CASE_PATH: string = `${PRODUCT}/cases/20000000-0000-4000-8000-000000000141`;
const AI_SETTINGS_PATH: string = `${PRODUCT}/ai/settings`;
// The project's case priorities and statuses, under Settings.
const CASE_PRIORITIES_PATH: string = `${PRODUCT}/settings/case-priorities`;
const CASE_STATUSES_PATH: string = `${PRODUCT}/settings/case-statuses`;
// The impossible travel case (?values=custom: in the retired Escalated).
const TRAVEL_CASE_PATH: string = `${PRODUCT}/cases/20000000-0000-4000-8000-000000000139`;
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
  // The project's case priorities by level and statuses by name.
  ids: {
    priorities: Record<string, string>;
    statuses: Record<string, string>;
  };
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
  // A month nothing happened in; "risk": one whose rules' alerts still scored entities.
  quiet?: boolean | "risk";
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
  // The Dashboard's German, Spanish, French, Italian, Portuguese, Dutch, Russian, Japanese or Persian locale.
  lang?: "de" | "es" | "fr" | "it" | "pt" | "nl" | "ru" | "ja" | "fa";
  // "custom": the project's own case statuses and priorities.
  values?: "custom";
  // Case numbers, comma separated, whose every change the server refuses.
  refuse?: string;
  // ATT&CK Coverage's address: the view, and the tactic it opens on.
  view?: "matrix";
  tactic?: string;
  // The Overview's ranked lists cut short (two rules, tactics, entities) or empty.
  ranked?: "short" | "none" | undefined;
  // "long": the SOC team goes by a long name.
  team?: "long";
  // The project's entity risk threshold (100 when left out).
  threshold?: number;
  // "fail": the overview could not read the riskiest entities.
  riskiest?: "fail";
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
    params.set("quiet", options.quiet === "risk" ? "risk" : "1");
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
  if (options.values) {
    params.set("values", options.values);
  }
  if (options.refuse) {
    params.set("refuse", options.refuse);
  }
  if (options.view) {
    params.set("view", options.view);
  }
  if (options.tactic) {
    params.set("tactic", options.tactic);
  }
  if (options.ranked) {
    params.set("ranked", options.ranked);
  }
  if (options.team) {
    params.set("team", options.team);
  }
  if (options.threshold !== undefined) {
    params.set("threshold", String(options.threshold));
  }
  if (options.riskiest) {
    params.set("riskiest", options.riskiest);
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
          anchor.querySelector('[data-testid="side-menu-item-title"]')
            ?.textContent ||
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

/*
 * The Rule Library's filter chips - the ones every list's filter row has
 * (FacetFilterBar, FilterChipDropdown) - by their place in the row.
 */
const CATEGORY_CHIP: string = "rule-library-category";
const DATA_CHIP: string = "rule-library-data";
const STATUS_CHIP: string = "rule-library-status";

// A chip's own button - not its clear x - which opens its list.
function chipButton(page: Page, chip: string): Locator {
  return page.getByTestId(chip).getByRole("button").first();
}

// Picks a value from a chip's list, as a reader does: open it, click the value.
async function pickChip(
  page: Page,
  chip: string,
  option: string,
): Promise<void> {
  await chipButton(page, chip).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

// How far the page is scrolled.
async function scrollTopOf(page: Page): Promise<number> {
  return page.evaluate((): number => {
    return window.scrollY;
  });
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
    // The riskiest come with the overview's answer: no read of their own.
    await expect(
      page.getByTestId("security-overview-riskiest-entities"),
    ).toContainText("k.morgan@acme-commerce.example");

    const state: FixtureState = await fixture(page);
    const routes: Array<string> = state.apiRequests.map(
      (request: { url: string }): string => {
        return new URL(request.url).pathname.replace(/^.*\/api/, "");
      },
    );
    expect(routes.sort()).toEqual([
      "/security-case/overview",
      "/security-case/setup/status",
    ]);
    expect(
      state.listRequests.filter((request: { modelName: string }): boolean => {
        return request.modelName === "SecurityEntityRisk";
      }),
    ).toEqual([]);
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
        "Approvals",
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
 * The Overview's rows of cards
 * ---------------------------------------------------------------------------
 *
 * "Gap between cards dont look nice. Please fix it." - the maintainer, of the
 * Overview at a laptop's width: the whole queue beside four verdicts and two
 * tactics, then two rules beside seven entities, with bare page under every
 * shorter card. The rows are CardGrids now (Common/UI/Components/Card), the
 * ranked lists sharing rows with lists of their size, the most urgent first.
 * These measure the real boxes at the widths people use, beside the side menu
 * and on a phone, with long lists, short ones (?ranked=short) and none
 * (?ranked=none), light and dark: every card's frame reaches its row's
 * bottom, every row reaches the grid's edges, and the only space between
 * cards is the grid's own 20px gap.
 */
test.describe("the overview's rows of cards", () => {
  interface CardRowSpec {
    testId: string;
    titles: Array<string>;
    // Cards across at each window width.
    columnsAt: Record<number, number>;
  }

  const ROWS: Array<CardRowSpec> = [
    {
      testId: "security-overview-charts",
      titles: ["Cases Opened", "Detections"],
      columnsAt: { 1440: 2, 1280: 2, 1024: 1, 768: 1, 390: 1 },
    },
    {
      testId: "security-overview-now",
      titles: ["Open Cases", "Riskiest Entities"],
      columnsAt: { 1440: 2, 1280: 2, 1024: 1, 768: 1, 390: 1 },
    },
    {
      testId: "security-overview-lately",
      titles: ["Top Detections", "MITRE ATT&CK Tactics", "Verdicts"],
      columnsAt: { 1440: 3, 1280: 3, 1024: 2, 768: 1, 390: 1 },
    },
  ];

  const WIDTHS: Array<number> = [1440, 1280, 1024, 768, 390];
  const GRID_GAP_IN_PX: number = 20;

  interface CellBox {
    title: string;
    top: number;
    left: number;
    right: number;
    bottom: number;
    // Where the card's own frame - its border - ends.
    frameBottom: number;
  }

  interface GridBoxes {
    left: number;
    right: number;
    top: number;
    bottom: number;
    cells: Array<CellBox>;
  }

  async function gridBoxes(page: Page, testId: string): Promise<GridBoxes> {
    return page
      .getByTestId(testId)
      .evaluate((container: Element): GridBoxes => {
        const grid: Element = container.firstElementChild as Element;
        const box: DOMRect = grid.getBoundingClientRect();

        return {
          left: box.left,
          right: box.right,
          top: box.top + window.scrollY,
          bottom: box.bottom + window.scrollY,
          cells: Array.from(grid.children).map((cell: Element): CellBox => {
            const cellBox: DOMRect = cell.getBoundingClientRect();
            const frame: Element = cell.querySelector(
              '[data-testid="card"] > div',
            ) as Element;

            return {
              title: (
                cell.querySelector('[data-testid="card-details-heading"]')
                  ?.textContent || ""
              ).trim(),
              top: cellBox.top + window.scrollY,
              left: cellBox.left,
              right: cellBox.right,
              bottom: cellBox.bottom + window.scrollY,
              frameBottom:
                frame.getBoundingClientRect().bottom + window.scrollY,
            };
          }),
        };
      });
  }

  // The cells by the line they sit on, top to bottom.
  function linesOf(cells: Array<CellBox>): Array<Array<CellBox>> {
    const lines: Array<Array<CellBox>> = [];

    for (const cell of cells) {
      const line: Array<CellBox> | undefined = lines.find(
        (candidate: Array<CellBox>): boolean => {
          return Math.abs(candidate[0]!.top - cell.top) <= 1;
        },
      );

      if (line) {
        line.push(cell);
      } else {
        lines.push([cell]);
      }
    }

    return lines;
  }

  // Waits for the entities, read after the overview, so the rows are whole.
  async function openRows(page: Page, options: OpenOptions): Promise<void> {
    await open(page, OVERVIEW_PATH, options);
    await expect(
      cardTitled(page, "Riskiest Entities").getByText(
        options.ranked === "none"
          ? "No user, host or address has any risk yet."
          : "k.morgan@acme-commerce.example",
      ),
    ).toBeVisible();
    await pageAtRest(page);
  }

  for (const width of WIDTHS) {
    test(`at ${width}px every row ends on one line, the grid's 20px between its cards and nothing beside or under them - long lists, short and none, light and dark`, async ({
      page,
    }: {
      page: Page;
    }) => {
      for (const ranked of [undefined, "short", "none"] as const) {
        for (const theme of [undefined, "dark"] as const) {
          await openRows(page, { width, theme, ranked });

          const label: string = `${width}px, ${ranked || "long"} lists, ${
            theme || "light"
          }`;
          let previousBottom: number | null = null;

          for (const row of ROWS) {
            const grid: GridBoxes = await gridBoxes(page, row.testId);
            const lines: Array<Array<CellBox>> = linesOf(grid.cells);
            const across: number = row.columnsAt[width]!;

            // The cards in reading order, as many across as the room allows.
            expect([
              label,
              grid.cells.map((cell: CellBox) => {
                return cell.title;
              }),
            ]).toEqual([label, row.titles]);
            expect([label, row.testId, lines[0]!.length]).toEqual([
              label,
              row.testId,
              Math.min(across, row.titles.length),
            ]);

            lines.forEach((line: Array<CellBox>, index: number) => {
              const bottom: number = Math.max(
                ...line.map((cell: CellBox): number => {
                  return cell.bottom;
                }),
              );

              for (const cell of line) {
                // The frame runs to the row's bottom: no page under it.
                expect([
                  label,
                  cell.title,
                  Math.round(bottom - cell.frameBottom),
                ]).toEqual([label, cell.title, 0]);
              }

              // The row runs from the grid's left edge to its right: no empty slot.
              expect([
                label,
                row.testId,
                Math.round(line[0]!.left - grid.left),
                Math.round(grid.right - line[line.length - 1]!.right),
              ]).toEqual([label, row.testId, 0, 0]);

              // Side by side, the grid's own gap and no more.
              for (let next: number = 1; next < line.length; next++) {
                expect([
                  label,
                  line[next]!.title,
                  Math.round(line[next]!.left - line[next - 1]!.right),
                ]).toEqual([label, line[next]!.title, GRID_GAP_IN_PX]);
              }

              // One above the other, the same gap.
              if (index > 0) {
                const above: number = Math.max(
                  ...lines[index - 1]!.map((cell: CellBox): number => {
                    return cell.bottom;
                  }),
                );
                expect([
                  label,
                  row.testId,
                  Math.round(line[0]!.top - above),
                ]).toEqual([label, row.testId, GRID_GAP_IN_PX]);
              }
            });

            // And between one row of cards and the next, the page's gap: the same.
            if (previousBottom !== null) {
              expect([
                label,
                row.testId,
                Math.round(grid.top - previousBottom),
              ]).toEqual([label, row.testId, GRID_GAP_IN_PX]);
            }
            previousBottom = grid.bottom;
          }

          expect([label, await pageOverflow(page)]).toEqual([label, 0]);
        }
      }

      await openRows(page, { width });
      await screenshot(page, `overview-rows-${width}`);
    });
  }

  test("a short list's card is as tall as the list beside it, its rows at the top, and a list with nothing says so in the middle of its card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRows(page, { width: 1280, ranked: "short" });

    const entities: Locator = cardTitled(page, "Riskiest Entities");
    const queue: Locator = cardTitled(page, "Open Cases");
    const entitiesBox: Box = await boxOf(entities);
    const queueBox: Box = await boxOf(queue);

    // Two entities beside the whole queue: one height, on one line.
    expect(Math.round(entitiesBox.height)).toBe(Math.round(queueBox.height));
    expect(Math.round(entitiesBox.y)).toBe(Math.round(queueBox.y));
    // Its rows start under its header, as the queue's do: the room is under them.
    const firstEntity: Box = await boxOf(
      entities.getByText("k.morgan@acme-commerce.example"),
    );
    const firstPriority: Box = await boxOf(queue.getByText("Critical").first());
    expect(Math.abs(firstEntity.y - firstPriority.y)).toBeLessThanOrEqual(30);
    await screenshot(page, "overview-rows-short-1280");

    await openRows(page, { width: 1280, ranked: "none" });

    for (const [title, sentence] of [
      ["Riskiest Entities", "No user, host or address has any risk yet."],
      ["Top Detections", "Nothing was detected in the last 14 days."],
      [
        "MITRE ATT&CK Tactics",
        "No case in the last 30 days is mapped to an ATT&CK tactic.",
      ],
    ]) {
      const card: Locator = cardTitled(page, title!);
      const cardBox: Box = await boxOf(card);
      const heading: Box = await boxOf(card.getByTestId("card-header"));
      const words: Box = await boxOf(card.getByText(sentence!));
      // The middle of the room under the header, give or take a line.
      const room: number =
        (heading.y + heading.height + cardBox.y + cardBox.height) / 2;
      expect([
        title,
        Math.abs(words.y + words.height / 2 - room) <= 24,
        // Centred across it too.
        Math.abs(words.x + words.width / 2 - (cardBox.x + cardBox.width / 2)) <=
          2,
      ]).toEqual([title, true, true]);
    }
    await screenshot(page, "overview-rows-none-1280");
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
    /*
     * When the last detection fired is in each case's line, not a column of
     * its own: the column waits in Customize Columns.
     */
    await expect(
      page.getByRole("columnheader", { name: "Last Detection" }),
    ).toHaveCount(0);
    await expect(
      page
        .locator("table tbody tr")
        .filter({ hasText: "CASE-142" })
        .getByTestId("security-case-row-detections"),
    ).toHaveText("3 detections, the last 9 minutes ago");

    await screenshot(page, "cases-desktop");
  });

  /*
   * The case lists ran past their card at a 1280 laptop in the longest
   * languages - German by 95px, Russian by 173 - the last values under the
   * sticky View and ⋯. The time each list is sorted by is in each case's
   * line now, and every list fits. The fixture is 64px narrower than
   * production: 1344 here is a 1280 laptop.
   */
  test("every case list fits its card at a 1280 laptop in German, French, Dutch and Russian", async ({
    page,
  }: {
    page: Page;
  }) => {
    const lists: Array<[string, string]> = [
      ["open", CASES_PATH],
      ["closed", CLOSED_CASES_PATH],
      ["all", ALL_CASES_PATH],
    ];

    for (const lang of ["de", "fr", "nl", "ru"] as Array<
      NonNullable<OpenOptions["lang"]>
    >) {
      for (const [name, pathname] of lists) {
        await open(page, pathname, { width: 1344, lang });
        await expect(page.locator("table tbody tr").first()).toBeVisible({
          timeout: 30000,
        });
        const scroller: Locator = page
          .locator("table")
          .locator("xpath=ancestor::div[@data-testid='table-scroll'][1]");

        expect(
          await overflowOf(scroller),
          `${lang} ${name}: the table scrolls sideways`,
        ).toBeLessThanOrEqual(1);
        expect(await pageOverflow(page), `${lang} ${name}`).toBeLessThanOrEqual(
          1,
        );
      }
    }

    // German opens a case as a case is opened, the whole phrase.
    await open(page, CASES_PATH, { width: 1344, lang: "de" });
    await expect(
      page.getByRole("button", { name: "Sicherheitsfall eröffnen" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByRole("button", { name: "Öffnen Sicherheitsfall" }),
    ).toHaveCount(0);
    await screenshot(page, "cases-1280-de", { fullPage: false });
  });

  /*
   * Beside the side menu a case's line broke inside its time - "vor 5 /
   * Stunden" - and OneUptime AI's read stood wherever the sentence above
   * it happened to end. The time's words are joined by no-break spaces,
   * and the read has a line of its own, at the cell's edge, on every row.
   */
  test("in German at a 1280 laptop, a case's line keeps its time whole and the AI's read starts its own line", async ({
    page,
  }: {
    page: Page;
  }) => {
    const NBSP: string = String.fromCharCode(0xa0);

    await open(page, CASES_PATH, { width: 1344, lang: "de" });
    const apiKey: Locator = page
      .locator("table tbody tr")
      .filter({ hasText: "CASE-137" });

    await expect(
      apiKey.getByTestId("security-case-row-detections"),
    ).toBeVisible({ timeout: 30000 });
    expect(
      await apiKey
        .getByTestId("security-case-row-detections")
        .evaluate((element: Element): string => {
          return element.textContent || "";
        }),
    ).toBe(`1 Erkennung, vor${NBSP}5${NBSP}Stunden`);

    for (const caseNumber of ["CASE-142", "CASE-137"]) {
      const row: Locator = page
        .locator("table tbody tr")
        .filter({ hasText: caseNumber });
      const line: Box = await boxOf(
        row.getByTestId("security-case-row-source-line"),
      );
      const read: Box = await boxOf(
        row.getByTestId("security-case-row-ai-verdict"),
      );
      const title: Box = await boxOf(
        row.getByTestId("security-case-row-number"),
      );

      // Under the whole line, starting where the case's title does.
      expect(read.y, caseNumber).toBeGreaterThanOrEqual(
        line.y + line.height - 1,
      );
      expect(Math.abs(read.x - title.x), caseNumber).toBeLessThanOrEqual(1);
    }
  });

  /*
   * A team named "Security Operations Center - Tier 2 Escalations (EMEA)"
   * was drawn whole in the Assignee and Team columns, and ran every list
   * past its card at 1280, under the sticky View and ⋯ - in English as in
   * German. Its name ends in "..." where its column does.
   */
  test("a team with a long name never runs a case list past its card at a 1280 laptop", async ({
    page,
  }: {
    page: Page;
  }) => {
    const LONG_TEAM_NAME: string =
      "Security Operations Center - Tier 2 Escalations (EMEA)";
    // The Assignee column in English, the Team column in German.
    const lists: Array<[string, string, "en" | "de"]> = [
      ["open", CASES_PATH, "en"],
      ["unassigned", UNASSIGNED_CASES_PATH, "de"],
    ];

    for (const [name, pathname, lang] of lists) {
      await open(page, pathname, {
        width: 1344,
        team: "long",
        ...(lang === "de" ? { lang: lang } : {}),
      });
      const team: Locator = page.getByTestId("security-case-row-team").first();

      await expect(team).toBeVisible({ timeout: 30000 });

      const scroller: Locator = page
        .locator("table")
        .locator("xpath=ancestor::div[@data-testid='table-scroll'][1]");

      expect(
        await overflowOf(scroller),
        `${lang} ${name}: the table scrolls sideways`,
      ).toBeLessThanOrEqual(1);
      expect(await pageOverflow(page), `${lang} ${name}`).toBeLessThanOrEqual(
        1,
      );

      // Cut at its own end, an ellipsis where its column ends.
      expect(
        await team
          .locator("bdi")
          .evaluate(
            (
              element: Element,
            ): { isCut: boolean; overflow: string; text: string } => {
              return {
                isCut: element.scrollWidth > element.clientWidth,
                overflow: window.getComputedStyle(element).textOverflow,
                text: element.textContent || "",
              };
            },
          ),
        `${lang} ${name}`,
      ).toEqual({ isCut: true, overflow: "ellipsis", text: LONG_TEAM_NAME });
    }

    await screenshot(page, "cases-long-team-1280-de", { fullPage: false });
  });

  test("Closed Cases says in each case's line when it closed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CLOSED_CASES_PATH);
    await expect(
      page.getByTestId("security-case-row-detections").first(),
    ).toContainText(", closed ", { timeout: 30000 });
    await expect(
      page.getByRole("columnheader", { name: "Closed", exact: true }),
    ).toHaveCount(0);
  });

  /*
   * A case's title is what a rule or a person wrote, set apart from the
   * page (IsolatedText): on a Persian page an English title ran into its
   * number, "CASE-142Password spray". The number starts its line on the
   * right, where a Persian reader begins, and the title follows it to the
   * left, a gap between them.
   */
  test("in Persian, each case's number starts its line on the right, its title after it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASES_PATH, { width: 1344, lang: "fa" });
    await expect(page.locator("table tbody tr").first()).toBeVisible({
      timeout: 30000,
    });
    expect(
      await page.evaluate((): string => {
        return document.documentElement.dir;
      }),
    ).toBe("rtl");

    const numbers: Locator = page.getByTestId("security-case-row-number");
    expect(await numbers.count()).toBeGreaterThan(1);

    for (const number of await numbers.all()) {
      const layout: {
        name: string;
        titleTag: string;
        numberLeft: number;
        titleLeft: number;
        titleRight: number;
      } = await number.evaluate((element: Element) => {
        const title: Element | null = element.nextElementSibling;
        // The title's first line: where it meets the number.
        const firstLine: DOMRect | undefined = title
          ? title.getClientRects()[0]
          : undefined;

        return {
          name: element.textContent || "",
          titleTag: title ? title.tagName : "",
          numberLeft: element.getBoundingClientRect().left,
          titleLeft: firstLine ? firstLine.left : 0,
          titleRight: firstLine ? firstLine.right : 0,
        };
      });

      expect(layout.titleTag, layout.name).toBe("BDI");
      expect(
        layout.numberLeft - layout.titleRight,
        `${layout.name}: a gap between the number and its title`,
      ).toBeGreaterThanOrEqual(4);
      expect(
        layout.numberLeft - layout.titleRight,
        `${layout.name}: the title right after the number`,
      ).toBeLessThanOrEqual(10);
      expect(layout.titleLeft, layout.name).toBeLessThan(layout.numberLeft);
    }

    await screenshot(page, "cases-fa-1280", { fullPage: false });
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
 * A case: its own side menu, and a page for each of its parts
 * ---------------------------------------------------------------------------
 */

const SPRAY_CASE_ID: string = "20000000-0000-4000-8000-000000000142";

/*
 * A case's pages, as its side menu lists them: the section, the entry, the
 * address under the case's own (its Overview is the case's address), and
 * something only that page draws.
 */
interface CasePage {
  section: string;
  title: string;
  segment: string;
  text: string;
  slug: string;
  // What says the page is drawn, where its text alone would not.
  ready?: ((page: Page) => Locator) | undefined;
}

const CASE_PAGES: ReadonlyArray<CasePage> = [
  {
    section: "Overview",
    title: "Overview",
    segment: "",
    text: "Time to Contain",
    slug: "overview",
  },
  {
    section: "Overview",
    title: "Timeline",
    segment: "/timeline",
    text: "took the case.",
    slug: "timeline",
  },
  {
    section: "Investigation",
    title: "Story",
    segment: "/story",
    text: "events like this",
    slug: "story",
  },
  {
    section: "Investigation",
    title: "Detections",
    segment: "/detections",
    text: "31 times",
    slug: "detections",
  },
  {
    section: "Investigation",
    title: "Entities",
    segment: "/entities",
    text: "a.ng@acme-commerce.example",
    slug: "entities",
  },
  {
    section: "Investigation",
    title: "Connected Signals",
    segment: "/connected-signals",
    text: "Named by k.morgan@acme-commerce.example, their email.",
    slug: "connected-signals",
  },
  {
    section: "Investigation",
    title: "Playbooks",
    segment: "/playbook-runs",
    text: "Started on its own: Case Opened",
    slug: "playbook-runs",
  },
  {
    section: "Notes",
    title: "Private Notes",
    segment: "/notes",
    text: "Approving the suspend.",
    slug: "notes",
  },
  {
    section: "Advanced",
    title: "Audit Logs",
    segment: "/audit-logs",
    text: "Case Audit Logs",
    slug: "audit-logs",
  },
  {
    section: "Advanced",
    title: "Delete Case",
    segment: "/delete",
    text: "To keep the record, close it with a verdict instead.",
    slug: "delete",
    // A card's description waits for a wider screen; its title is always there.
    ready: (page: Page): Locator => {
      return cardTitled(page, "Delete Case");
    },
  },
];

function casePagePath(casePage: CasePage): string {
  return `${SPRAY_CASE_PATH}${casePage.segment}`;
}

function caseHeader(page: Page): Locator {
  return page.getByTestId("security-case-header");
}

// The case's header has its actions: every one this case offers, and the ⋯.
async function expectCaseActions(page: Page): Promise<void> {
  for (const action of ["Run Playbook", "Declare Incident", "Close Case"]) {
    await expect(
      caseHeader(page).getByRole("button", { name: action, exact: true }),
    ).toBeVisible();
  }
  await expect(
    caseHeader(page).getByTestId("security-case-more"),
  ).toBeVisible();
}

// The number drawn beside a menu entry, or "" when there is none.
async function menuCount(page: Page, title: string): Promise<string> {
  const badge: Locator = menuEntry(page, title).locator("span.rounded-full");

  if ((await badge.count()) === 0) {
    return "";
  }

  return ((await badge.first().textContent()) || "").trim();
}

async function waitForCasePage(page: Page, casePage: CasePage): Promise<void> {
  const ready: Locator = casePage.ready
    ? casePage.ready(page)
    : page.getByText(casePage.text, { exact: false }).first();

  await expect(ready).toBeVisible({ timeout: 30000 });
}

/*
 * Working cases from the queue: each row's ⋯ and Bulk Actions offer Assign
 * to Me, Assign to Someone Else, Change Status and Change Priority, by the
 * rules the case's own page follows, and the list shows a change at once.
 */
async function openRowMenu(page: Page, caseNumber: string): Promise<Locator> {
  // The nearest box around the case's number holding a ⋯: a row, or a phone's card.
  const row: Locator = page
    .getByText(caseNumber, { exact: true })
    .first()
    .locator(
      "xpath=ancestor::*[.//*[@data-testid='row-actions-more-button']][1]",
    );

  await row.getByTestId("row-actions-more-button").first().click();
  const menu: Locator = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/*
 * A menu item's label as the browser laid it out: its words, line by line.
 * The menu is a fixed 14rem, so "Assign to Someone Else" takes two lines,
 * and they are balanced - "Assign to" over "Someone Else".
 */
async function labelLines(item: Locator): Promise<Array<string>> {
  return item
    .locator(".font-medium")
    .first()
    .evaluate((label: Element): Array<string> => {
      const lines: Array<{ top: number; words: Array<string> }> = [];
      const text: Node | null = label.firstChild;
      const content: string = text?.textContent || "";
      let start: number = 0;

      for (const word of content.split(" ")) {
        const range: Range = document.createRange();
        range.setStart(text!, start);
        range.setEnd(text!, start + word.length);
        const top: number = Math.round(range.getBoundingClientRect().top);
        const line: { top: number; words: Array<string> } | undefined =
          lines.find((candidate: { top: number }): boolean => {
            return Math.abs(candidate.top - top) < 4;
          });

        if (line) {
          line.words.push(word);
        } else {
          lines.push({ top: top, words: [word] });
        }

        start += word.length + 1;
      }

      return lines.map((line: { words: Array<string> }): string => {
        return line.words.join(" ");
      });
    });
}

async function menuItemTitles(menu: Locator): Promise<Array<string>> {
  return (await menu.getByRole("menuitem").allInnerTexts()).map(
    (title: string): string => {
      return title.replace(/\s+/g, " ").trim();
    },
  );
}

/*
 * A menu's runs, top to bottom: its items' titles, a new run after each gap
 * between kinds of action (an empty role="none" element: ActionMenuGroup).
 */
async function menuRuns(menu: Locator): Promise<Array<Array<string>>> {
  return await menu.evaluate((element: Element): Array<Array<string>> => {
    const runs: Array<Array<string>> = [[]];

    for (const item of Array.from(
      element.querySelectorAll('[role="menuitem"], [role="none"]'),
    )) {
      if (item.getAttribute("role") === "none") {
        runs.push([]);
      } else {
        runs[runs.length - 1]!.push(
          (item.textContent || "").replace(/\s+/g, " ").trim(),
        );
      }
    }

    return runs;
  });
}

async function selectCase(page: Page, caseNumber: string): Promise<void> {
  await page
    .getByText(caseNumber, { exact: true })
    .first()
    .locator("xpath=ancestor::*[.//input[@type='checkbox']][1]")
    .locator("input[type=checkbox]")
    .first()
    .check();
}

// The one person or team the assign dialog's picker takes.
async function pickAssignee(page: Page, name: string): Promise<void> {
  await page
    .getByRole("dialog")
    .first()
    .getByRole("button", { name: "Choose someone or a team" })
    .click();
  const search: Locator = page.getByRole("dialog", {
    name: "Choose someone or a team",
  });
  await search
    .getByRole("option", { name: new RegExp(escapeRegExp(name)) })
    .first()
    .click();
}

// A dialog's dropdown, opened and an option picked by its name.
async function chooseOption(page: Page, name: string): Promise<void> {
  const dialog: Locator = page.getByRole("dialog").first();
  await dialog.locator(".ou-select__control").first().click();
  await page.locator(".ou-select__option", { hasText: name }).first().click();
}

async function updatesOf(
  page: Page,
): Promise<
  Array<{ id: string; data: Record<string, unknown>; refused?: boolean }>
> {
  return page.evaluate(
    (): Array<{
      id: string;
      data: Record<string, unknown>;
      refused?: boolean;
    }> => {
      return JSON.parse(
        JSON.stringify(
          (
            window as unknown as {
              __securityOperationsFixture: {
                updates: Array<{
                  modelName: string;
                  id: string;
                  data: Record<string, unknown>;
                  refused?: boolean;
                }>;
              };
            }
          ).__securityOperationsFixture.updates.filter(
            (update: { modelName: string }): boolean => {
              return update.modelName === "SecurityCase";
            },
          ),
        ),
      );
    },
  );
}

const CASE_ID: (number: number) => string = (number: number): string => {
  return `20000000-0000-4000-8000-000000000${number}`;
};
const MAYA_ID: string = "80000000-0000-4000-8000-000000000001";
const DIEGO_ID: string = "80000000-0000-4000-8000-000000000002";
const PRIYA_ID: string = "80000000-0000-4000-8000-000000000003";
const SOC_TEAM_ID: string = "81000000-0000-4000-8000-000000000001";
const REFUSAL: string =
  "You do not have permission to update this Security Case. Your role reaches only cases labelled for your team.";

test.describe("working cases from the queue", () => {
  test("each row's ⋯ offers the moves its case takes - View its one button, Delete last", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASES_PATH, { width: 1344 });
    await expect(page.getByText("CASE-141").first()).toBeVisible({
      timeout: 30000,
    });

    // Nobody's case: every move.
    const menu: Locator = await openRowMenu(page, "CASE-141");
    expect(await menuItemTitles(menu)).toEqual([
      "Assign to Me",
      "Assign to Someone Else",
      "Change Status",
      "Change Priority",
      "Delete",
    ]);
    // In runs, as an incident's ⋯ reads: its people, its status and priority, Delete.
    expect(await menuRuns(menu)).toEqual([
      ["Assign to Me", "Assign to Someone Else"],
      ["Change Status", "Change Priority"],
      ["Delete"],
    ]);
    await fs.mkdir(SCREENSHOTS, { recursive: true });
    await menu.screenshot({
      path: path.join(SCREENSHOTS, "case-row-menu-1344-light.png"),
      animations: "disabled",
    });
    // The one label longer than the menu is wide wraps evenly, no word left alone.
    expect(
      await labelLines(
        menu.getByRole("menuitem", { name: "Assign to Someone Else" }),
      ),
    ).toEqual(["Assign to", "Someone Else"]);
    expect(
      await labelLines(menu.getByRole("menuitem", { name: "Change Priority" })),
    ).toEqual(["Change Priority"]);

    /*
     * In either reading direction the 10px gap sits between an item's icon
     * and its label - in Persian the icon is on the right, and the gap with
     * it, not on the menu's edge.
     */
    const iconGap: () => Promise<number> = (): Promise<number> => {
      return menu
        .getByRole("menuitem", { name: "Assign to Me" })
        .evaluate((item: Element): number => {
          const icon: DOMRect = item
            .querySelector("svg")!
            .getBoundingClientRect();
          const label: DOMRect = item
            .querySelector(".font-medium")!
            .getBoundingClientRect();

          return document.documentElement.dir === "rtl"
            ? icon.left - label.right
            : label.left - icon.right;
        });
    };
    expect(await iconGap()).toBeCloseTo(10, 0);
    await page.evaluate((): void => {
      document.documentElement.dir = "rtl";
    });
    expect(await iconGap()).toBeCloseTo(10, 0);
    await page.evaluate((): void => {
      document.documentElement.dir = "";
    });
    await page.keyboard.press("Escape");

    // Maya's own: she hands it on, but never takes it again.
    expect(await menuItemTitles(await openRowMenu(page, "CASE-142"))).toEqual([
      "Assign to Someone Else",
      "Change Status",
      "Change Priority",
      "Delete",
    ]);
    await page.keyboard.press("Escape");

    // A closed case: nobody takes it; Change Status reopens it.
    await open(page, CLOSED_CASES_PATH, { width: 1344 });
    await expect(page.getByText("CASE-136").first()).toBeVisible({
      timeout: 30000,
    });
    expect(await menuItemTitles(await openRowMenu(page, "CASE-136"))).toEqual([
      "Change Status",
      "Change Priority",
      "Delete",
    ]);
  });

  test("Assign to Me takes a case off Unassigned and onto Assigned to Me, and the menu counts it at once", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, UNASSIGNED_CASES_PATH, { width: 1344 });
    await expect(page.getByText("CASE-141").first()).toBeVisible({
      timeout: 30000,
    });
    await expect
      .poll(() => {
        return menuCount(page, "Assigned to Me");
      })
      .toBe("2");

    await (await openRowMenu(page, "CASE-141"))
      .getByRole("menuitem", { name: "Assign to Me" })
      .click();

    // Off the list of cases nobody has, and counted as Maya's.
    await expect(page.getByText("CASE-141", { exact: true })).toHaveCount(0);
    await expect(page.getByText("CASE-138").first()).toBeVisible();
    await expect
      .poll(() => {
        return menuCount(page, "Assigned to Me");
      })
      .toBe("3");
    expect(await updatesOf(page)).toEqual([
      {
        modelName: "SecurityCase",
        id: CASE_ID(141),
        data: { assignedToUserId: MAYA_ID },
      },
    ]);
  });

  test("Assign to Someone Else: one person or one team in one picker - a team takes the case into its queue", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASES_PATH, { width: 1344 });
    await expect(page.getByText("CASE-142").first()).toBeVisible({
      timeout: 30000,
    });

    await (await openRowMenu(page, "CASE-142"))
      .getByRole("menuitem", { name: "Assign to Someone Else" })
      .click();
    const dialog: Locator = page.getByRole("dialog").first();
    await expect(dialog).toContainText(
      "Pick a person to work CASE-142, or a team to pick it up.",
    );
    // The field is named, nothing more: the sentence over it says what a team pick does.
    await expect(dialog.getByTestId("modal-content")).toHaveText(
      "Person or Team Choose someone or a team",
      { useInnerText: true, timeout: 5000 },
    );

    // People first, then teams, in one list.
    await dialog
      .getByRole("button", { name: "Choose someone or a team" })
      .click();
    const search: Locator = page.getByRole("dialog", {
      name: "Choose someone or a team",
    });
    await expect(search.getByText("People", { exact: true })).toBeVisible();
    await expect(search.getByText("Teams", { exact: true })).toBeVisible();
    await search.getByRole("option", { name: /SOC Tier 2/ }).click();
    await dialog.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The row says whose queue it is in now, and it is no longer Maya's.
    const row: Locator = page.locator("tbody tr", { hasText: "CASE-142" });
    await expect(row).toContainText("SOC Tier 2");
    await expect(row).not.toContainText("Maya");
    await expect
      .poll(() => {
        return menuCount(page, "Assigned to Me");
      })
      .toBe("1");
    expect(await updatesOf(page)).toEqual([
      {
        modelName: "SecurityCase",
        id: CASE_ID(142),
        data: { assignedToTeamId: SOC_TEAM_ID, assignedToUserId: null },
      },
    ]);

    // A person picked works the case.
    await (await openRowMenu(page, "CASE-141"))
      .getByRole("menuitem", { name: "Assign to Someone Else" })
      .click();
    await pickAssignee(page, "Diego Alvarez");
    await page
      .getByRole("dialog")
      .first()
      .getByRole("button", { name: "Assign", exact: true })
      .click();
    // A second change in the same moment is read back too.
    await expect(
      page.locator("tbody tr", { hasText: "CASE-141" }),
    ).toContainText("Diego");
    expect((await updatesOf(page))[1]).toEqual({
      modelName: "SecurityCase",
      id: CASE_ID(141),
      data: { assignedToUserId: DIEGO_ID },
    });
  });

  test("Change Status to a closing status asks what Close Case asks, and the case leaves the open list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASES_PATH, { width: 1344 });
    await expect(page.getByText("CASE-137").first()).toBeVisible({
      timeout: 30000,
    });

    await (await openRowMenu(page, "CASE-137"))
      .getByRole("menuitem", { name: "Change Status" })
      .click();
    const dialog: Locator = page.getByRole("dialog").first();
    await expect(dialog).toContainText("Pick the new status for CASE-137.");

    // Its own status is listed, Current, and not picked again.
    await dialog.locator(".ou-select__control").first().click();
    const current: Locator = page.getByRole("option", { name: /Current/ });
    await expect(current).toHaveCount(1);
    await expect(current).toContainText("New");
    await expect(current).toHaveAttribute("aria-disabled", "true");
    /*
     * First in the list, it takes the focus the menu gives its first option -
     * drawn as a quiet grey row, not the indigo of the next pick.
     */
    await expect(current).toHaveClass(/ou-select__option--is-focused/);
    await expect(current).toHaveCSS("background-color", "rgb(243, 244, 246)");
    await expect(
      page.getByRole("option", { name: "Investigating", exact: true }),
    ).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.getByRole("option", { name: "Closed", exact: true }).click();

    // OneUptime AI read it as Likely Benign: the verdict starts there.
    await expect(dialog).toContainText(
      "OneUptime AI read this case as Likely Benign. Pick what you found.",
    );
    await expect(
      dialog.getByRole("radio", { name: /Benign Positive/ }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(dialog).toContainText("Closing Note");
    await dialog.getByRole("radio", { name: /False Positive/ }).click();
    await dialog
      .getByRole("button", { name: "Close Case", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await expect(page.getByText("CASE-137", { exact: true })).toHaveCount(0);
    await expect
      .poll(() => {
        return menuCount(page, "Open Cases");
      })
      .toBe("5");
    const updates: Array<{ id: string; data: Record<string, unknown> }> =
      await updatesOf(page);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe(CASE_ID(137));
    expect(updates[0]!.data).toMatchObject({ verdict: "False Positive" });

    // Closed Cases lists it, by the verdict it closed with.
    await menuEntry(page, "Closed Cases").click();
    await expect(
      page.locator("tbody tr", { hasText: "CASE-137" }),
    ).toContainText("False Positive", { timeout: 30000 });
  });

  test("Change Priority from a row: the project's priorities, the case's own Current, and the row shows the new one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASES_PATH, { width: 1344 });
    await expect(page.getByText("CASE-141").first()).toBeVisible({
      timeout: 30000,
    });
    const row: Locator = page.locator("tbody tr", { hasText: "CASE-141" });
    await expect(row).toContainText("High");

    await (await openRowMenu(page, "CASE-141"))
      .getByRole("menuitem", { name: "Change Priority" })
      .click();
    const dialog: Locator = page.getByRole("dialog").first();
    await expect(dialog).toContainText("Pick the new priority for CASE-141.");
    await chooseOption(page, "Critical");
    await dialog
      .getByRole("button", { name: "Change Priority", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await expect(row).toContainText("Critical");
    await expect(row).not.toContainText("High");
  });

  test("Bulk Actions: Assign to Someone Else for the cases selected, naming the one the server refused, and why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASES_PATH, { width: 1344, refuse: "138" });
    await expect(page.getByText("CASE-138").first()).toBeVisible({
      timeout: 30000,
    });

    for (const caseNumber of ["CASE-142", "CASE-141", "CASE-138"]) {
      await selectCase(page, caseNumber);
    }
    await page.getByText("Bulk Actions", { exact: true }).click();
    const bulk: Locator = page.getByRole("menu");
    expect((await menuItemTitles(bulk)).slice(0, 4)).toEqual([
      "Assign to Me",
      "Assign to Someone Else",
      "Change Status",
      "Change Priority",
    ]);
    await bulk
      .getByRole("menuitem", { name: "Assign to Someone Else" })
      .click();
    await expect(page.getByRole("dialog").first()).toContainText(
      "Pick a person to work the 3 selected cases, or a team to pick them up.",
    );
    await pickAssignee(page, "Priya Nair");
    await page
      .getByRole("dialog")
      .first()
      .getByRole("button", { name: "Assign", exact: true })
      .click();

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "2 Security Cases assigned",
      { timeout: 30000 },
    );
    await expect(page.getByTestId("bulk-action-failed-count")).toHaveText(
      "1 Security Case not assigned",
    );
    const refused: Locator = page.getByTestId("bulk-action-failed-items");
    await expect(refused).toContainText("CASE-138");
    await expect(refused).toContainText(REFUSAL);
    expect(
      (await updatesOf(page)).map(
        (update: { id: string; refused?: boolean }): [string, boolean] => {
          return [update.id, Boolean(update.refused)];
        },
      ),
    ).toEqual([
      [CASE_ID(142), false],
      [CASE_ID(141), false],
      [CASE_ID(138), true],
    ]);
    await screenshot(page, "cases-bulk-assign-result");

    await page.getByTestId("modal-footer-submit-button").click();
    await expect(
      page.locator("tbody tr", { hasText: "CASE-141" }),
    ).toContainText("Priya");
  });

  test("a row's Assign to Me the server refuses says why, naming the case, in a dialog over the whole list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASES_PATH, { width: 1344, refuse: "138" });
    await expect(page.getByText("CASE-138").first()).toBeVisible({
      timeout: 30000,
    });

    await (await openRowMenu(page, "CASE-138"))
      .getByRole("menuitem", { name: "Assign to Me" })
      .click();

    const notice: Locator = page.getByRole("dialog");
    await expect(notice).toHaveCount(1);
    await expect(
      notice.getByRole("heading", { name: "Could not assign CASE-138" }),
    ).toBeVisible();
    await expect(notice).toContainText(REFUSAL);
    await pageAtRest(page);

    /*
     * Over every row: the action cells stuck to the table's right edge -
     * the next rows' View and ⋯ - lie under the dialog's backdrop, which a
     * dialog drawn inside the row's own cell did not cover.
     */
    const laterRow: Locator = page.locator("tbody tr", { hasText: "CASE-137" });
    const viewBox: Box = await boxOf(
      laterRow.getByRole("button", { name: "View" }),
    );
    // On the screen, where a person would see it through the backdrop.
    expect(viewBox.y + viewBox.height).toBeLessThan(1000);
    const isViewOnTop: boolean = await page.evaluate(
      (point: { x: number; y: number }): boolean => {
        const element: Element | null = document.elementFromPoint(
          point.x,
          point.y,
        );

        return Boolean(element?.closest("tbody"));
      },
      { x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 },
    );
    expect(isViewOnTop, "a later row's View drawn over the dialog").toBe(false);

    await notice.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Tried once, refused, and the row still says whose queue it is in.
    expect(await updatesOf(page)).toEqual([
      {
        modelName: "SecurityCase",
        id: CASE_ID(138),
        data: { assignedToUserId: MAYA_ID },
        refused: true,
      },
    ]);
    await expect(
      page.locator("tbody tr", { hasText: "CASE-138" }),
    ).toContainText("SOC Tier 2");
  });

  test("a Security Viewer sees every move locked, in a row's ⋯ and in Bulk Actions, each saying what it takes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASES_PATH, { width: 1344, role: "viewer" });
    await expect(page.getByText("CASE-141").first()).toBeVisible({
      timeout: 30000,
    });

    const menu: Locator = await openRowMenu(page, "CASE-141");
    for (const title of [
      "Assign to Me",
      "Assign to Someone Else",
      "Change Status",
      "Change Priority",
    ]) {
      await expect(menu.getByRole("menuitem", { name: title })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
    await menu.getByRole("menuitem", { name: "Change Status" }).hover();
    await expect(page.getByRole("tooltip")).toContainText(
      "You do not have permission",
    );
    // Pressed anyway, it opens nothing: a locked item does nothing.
    await menu
      .getByRole("menuitem", { name: "Change Status" })
      .click({ force: true });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await selectCase(page, "CASE-141");
    await page.getByText("Bulk Actions", { exact: true }).click();
    const bulk: Locator = page.getByRole("menu");
    await expect(
      bulk.getByRole("menuitem", { name: "Assign to Someone Else" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(await updatesOf(page)).toEqual([]);
  });

  /*
   * Edit Case asks what Open Security Case asks, in the same words, in the
   * reader's language. Its fields drew their columns' descriptions, written
   * for the API and in English on every page: "ID of the person working
   * the case." under Assign To.
   */
  test("Edit Case asks in the reader's words, as Open Security Case does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH, { width: 1344, lang: "de" });
    await expect(caseHeader(page)).toBeVisible({ timeout: 30000 });

    await caseHeader(page).getByTestId("security-case-more").click();
    await page.getByTestId("security-case-edit").click();
    const dialog: Locator = page.getByRole("dialog").first();

    await expect(dialog).toContainText(
      "Worum es im Fall geht, in einer Zeile.",
      { timeout: 30000 },
    );
    await expect(dialog).toContainText(
      "Was diesen Fall ausgelöst hat und worauf Sie zuerst schauen sollten.",
    );
    await expect(dialog).not.toContainText("What the case is about");

    await dialog.getByRole("button", { name: "Weiter", exact: true }).click();
    await expect(dialog).toContainText("Die Person, die den Fall bearbeitet.");
    await expect(dialog).toContainText("Das Team, zu dem der Fall gehört.");
    await expect(dialog).toContainText(
      "Beschriftungen, nach denen Sie Fälle filtern und auswerten.",
    );
    await expect(dialog).not.toContainText("ID of");
  });

  test("a case's own header hands it on and moves its status from any of its pages", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${DOMAIN_CASE_PATH}/timeline`, { width: 1344 });
    await expect(caseHeader(page)).toBeVisible({ timeout: 30000 });

    await caseHeader(page).getByTestId("security-case-more").click();
    await page.getByTestId("security-case-assign-to-someone-else").click();
    await expect(page.getByRole("dialog").first()).toContainText(
      "Pick a person to work CASE-141, or a team to pick it up.",
    );
    await pickAssignee(page, "Priya Nair");
    await page
      .getByRole("dialog")
      .first()
      .getByRole("button", { name: "Assign", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await caseHeader(page).getByTestId("security-case-more").click();
    await page.getByTestId("security-case-change-status").click();
    await chooseOption(page, "Contained");
    await page
      .getByRole("dialog")
      .first()
      .getByRole("button", { name: "Change Status", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(caseHeader(page)).toContainText("Contained");

    expect(await updatesOf(page)).toEqual([
      {
        modelName: "SecurityCase",
        id: CASE_ID(141),
        data: { assignedToUserId: PRIYA_ID },
      },
      {
        modelName: "SecurityCase",
        id: CASE_ID(141),
        data: {
          securityCaseStatusId: (await fixture(page)).ids.statuses["Contained"],
        },
      },
    ]);

    // The Overview says who has it now.
    await menuEntry(page, "Overview").click();
    await expect(caseHeader(page)).toContainText("Priya Nair", {
      timeout: 30000,
    });
  });

  test("the row's ⋯, the assign dialog and the bulk bar, at 1280 and on a phone, in both themes", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [width, height, size] of [
      [1344, 1000, "1280"],
      [390, 844, "390"],
    ] as Array<[number, number, string]>) {
      for (const theme of [undefined, "dark"] as Array<"dark" | undefined>) {
        const name: string = `${size}-${theme || "light"}`;

        await open(page, CASES_PATH, { width, height, theme });
        await expect(page.getByText("CASE-141").first()).toBeVisible({
          timeout: 30000,
        });

        // The row's ⋯: whole, on the screen, its items each on a line.
        const menu: Locator = await openRowMenu(page, "CASE-141");
        const menuBox: Box = await boxOf(menu);
        expect(menuBox.x, `row menu at ${name}`).toBeGreaterThanOrEqual(0);
        expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
        expect(
          await pageOverflow(page),
          `row menu at ${name}`,
        ).toBeLessThanOrEqual(1);
        await screenshot(page, `cases-row-menu-${name}`, { fullPage: false });

        // Assign to Someone Else: the dialog inside the screen.
        await menu
          .getByRole("menuitem", { name: "Assign to Someone Else" })
          .click();
        const dialog: Locator = page.getByRole("dialog").first();
        const dialogBox: Box = await boxOf(dialog);
        expect(dialogBox.x).toBeGreaterThanOrEqual(0);
        expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(width);
        await screenshot(page, `cases-assign-dialog-${name}`, {
          fullPage: false,
        });
        await dialog
          .getByRole("button", { name: "Choose someone or a team" })
          .click();
        await expect(
          page.getByRole("dialog", { name: "Choose someone or a team" }),
        ).toBeVisible();
        await pageAtRest(page);
        await screenshot(page, `cases-assign-picker-${name}`, {
          fullPage: false,
        });
        // Put the search away, then the dialog.
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("dialog", { name: "Choose someone or a team" }),
        ).toHaveCount(0);
        if ((await page.getByRole("dialog").count()) > 0) {
          await page
            .getByRole("dialog")
            .first()
            .getByRole("button", { name: "Cancel" })
            .click();
        }
        await expect(page.getByRole("dialog")).toHaveCount(0);

        // The bulk bar, its menu open.
        await selectCase(page, "CASE-141");
        await selectCase(page, "CASE-138");
        await page.getByText("Bulk Actions", { exact: true }).click();
        const bulk: Locator = page.getByRole("menu");
        const bulkBox: Box = await boxOf(bulk);
        expect(bulkBox.x).toBeGreaterThanOrEqual(0);
        expect(bulkBox.x + bulkBox.width).toBeLessThanOrEqual(width);
        expect(
          await pageOverflow(page),
          `bulk bar at ${name}`,
        ).toBeLessThanOrEqual(1);
        await screenshot(page, `cases-bulk-actions-${name}`, {
          fullPage: false,
        });
      }
    }
  });
});

test.describe("a case", () => {
  test("opens on its Overview, under a side menu of its own, its header in full", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH);
    await expect(
      caseHeader(page).getByRole("heading", {
        level: 1,
        name: "Password spray against Okta from 203.0.113.47",
      }),
    ).toBeVisible({ timeout: 30000 });

    // The case's menu: an incident's sections, where a case has pages for them.
    expect(
      (await sideMenu(page).locator("h6").allInnerTexts()).map(
        (title: string): string => {
          return title.trim().toLowerCase();
        },
      ),
    ).toEqual(["overview", "investigation", "notes", "advanced"]);
    expect(await litEntries(page)).toEqual(["Overview"]);
    await expect(menuSection(page, "Advanced")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Security Cases",
      "CASE-142",
    ]);

    // The header in full: what it is, where it stands, who has it, its moves.
    await expect(caseHeader(page)).toHaveAttribute("data-layout", "full");
    await expectCaseActions(page);
    for (const step of ["New", "Investigating", "Contained", "Closed"]) {
      await expect(
        page
          .getByTestId("security-case-status-steps")
          .getByText(step, { exact: true }),
      ).toBeVisible();
    }
    await expect(caseHeader(page).getByText("Assignee")).toBeVisible();

    // The figures, OneUptime AI's read, and the ATT&CK tactics.
    const figures: Locator = page.getByRole("group", { name: "Case figures" });
    await expect(figures).toContainText("Detections");
    await expect(figures).toContainText("Open For");
    await expect(figures).toContainText("Time to Acknowledge");
    await expect(figures).toContainText("Time to Contain");
    await expect(page.getByTestId("security-case-ai-card")).toBeVisible();
    await expect(page.getByText("TA0006 Credential Access")).toBeVisible();

    // The case's other parts are pages of their own, not on its Overview.
    for (const text of [
      "31 times",
      "took the case.",
      "Approving the suspend.",
    ]) {
      await expect(page.getByText(text, { exact: false })).toHaveCount(0);
    }

    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "case-desktop");
  });

  test("each part of the case is a page of its own: its entry lit, its address under the case's, its trail, the header on top", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH);
    await waitForCasePage(page, CASE_PAGES[0]!);

    for (const casePage of CASE_PAGES.slice(1)) {
      if (
        casePage.section === "Advanced" &&
        (await menuSection(page, "Advanced").getAttribute("aria-expanded")) ===
          "false"
      ) {
        await menuSection(page, "Advanced").click();
      }

      await menuEntry(page, casePage.title).click();
      await expect
        .poll(() => {
          return pathnameOf(page);
        })
        .toBe(casePagePath(casePage));
      await waitForCasePage(page, casePage);

      expect([casePage.title, await litEntries(page)]).toEqual([
        casePage.title,
        [casePage.title],
      ]);
      expect(await breadcrumbs(page)).toEqual([
        "Project",
        "Security Events",
        "Security Cases",
        "CASE-142",
        casePage.title,
      ]);

      // The header, compact, with every action the Overview has.
      await expect(caseHeader(page)).toHaveAttribute("data-layout", "compact");
      await expectCaseActions(page);
      await expect(page.getByTestId("security-case-status-steps")).toHaveCount(
        0,
      );
    }

    // Read once, for every page: no page read the case again.
    expect(
      (await fixture(page)).listRequests.length,
      "pages listed what they show",
    ).toBeGreaterThan(0);
    const caseReads: number = (
      (await fixture(page)) as unknown as {
        getItemRequests: Array<{ modelName: string; id: string }>;
      }
    ).getItemRequests.filter(
      (request: { modelName: string; id: string }): boolean => {
        return (
          request.modelName === "SecurityCase" && request.id === SPRAY_CASE_ID
        );
      },
    ).length;
    expect(caseReads).toBe(1);

    // The case's crumb opens its Overview.
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "CASE-142", exact: true })
      .click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(SPRAY_CASE_PATH);
    await expect(caseHeader(page)).toHaveAttribute("data-layout", "full");
  });

  test("the Security Cases crumb goes back to the open cases", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${SPRAY_CASE_PATH}/entities`);
    await waitForCasePage(page, CASE_PAGES[4]!);

    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Security Cases", exact: true })
      .click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(CASES_PATH);
  });

  test("the Detections page: what fired, how often, on what, and the event that last set it off", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${SPRAY_CASE_PATH}/detections`, { width: 1344 });
    await expect(page.getByText("Okta password spray").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("31 times")).toBeVisible();
    await expect(
      page.getByText("Showing 1-3 of 3 security detections"),
    ).toBeVisible();

    const detectionsTable: Locator = page
      .locator("table")
      .first()
      .locator("xpath=ancestor::div[@data-testid='table-scroll'][1]");
    expect(
      await overflowOf(detectionsTable),
      "detections table scrolls sideways",
    ).toBeLessThanOrEqual(1);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  });

  test("the Entities page: each entity the case is about, with its week across every security event", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${SPRAY_CASE_PATH}/entities`, { width: 1344 });
    const table: Locator = page.getByTestId("security-case-entities-table");
    await expect(table).toBeVisible({ timeout: 30000 });

    expect(
      (await table.locator("thead th").allInnerTexts()).map(
        (header: string): string => {
          return header.trim().toLowerCase();
        },
      ),
    ).toEqual([
      "entity",
      "type",
      "events",
      "findings",
      "worst severity",
      "last seen",
      // Its risk (Security Events > Entity Risk), where the table has room.
      "risk",
    ]);

    const address: Locator = table
      .getByTestId("security-case-entity-row")
      .filter({ hasText: "203.0.113.47" });
    await expect(address.getByTestId("security-case-entity-events")).toHaveText(
      "475",
    );
    await expect(address).toContainText("IP Address");
    await expect(
      address.getByTestId("security-case-entity-severity"),
    ).toContainText("High");

    // Each entity opens in Correlate.
    await address.getByRole("link", { name: "203.0.113.47" }).click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(`${PRODUCT}/correlate`);

    /*
     * On a phone: two columns, the type and when under the value and the
     * worst severity under the count - all of it inside the card, nothing
     * left to scroll to sideways.
     */
    await open(page, `${SPRAY_CASE_PATH}/entities`, {
      width: 390,
      height: 844,
    });
    await expect(table).toBeVisible({ timeout: 30000 });
    expect(
      (await table.locator("thead th:visible").allInnerTexts()).map(
        (header: string): string => {
          return header.trim().toLowerCase();
        },
      ),
    ).toEqual(["entity", "events"]);

    const phoneAddress: Locator = table
      .getByTestId("security-case-entity-row")
      .filter({ hasText: "203.0.113.47" });
    await expect(
      phoneAddress.getByText("IP Address · last seen", { exact: false }),
    ).toBeVisible();
    await expect(
      phoneAddress.getByTestId("security-case-entity-severity-under-count"),
    ).toHaveText("High");
    await expect(
      phoneAddress.getByTestId("security-case-entity-severity"),
    ).toBeHidden();

    // The table fits the card: its scroller has nothing to scroll.
    expect(
      await table.evaluate((element: HTMLElement): number => {
        const scroller: HTMLElement = element.parentElement as HTMLElement;

        return scroller.scrollWidth - scroller.clientWidth;
      }),
    ).toBeLessThanOrEqual(1);
    // A long value wraps whole inside its chip rather than cut short.
    const longValue: Locator = table.getByText(
      "k.morgan@acme-commerce.example",
      { exact: true },
    );
    expect(
      await longValue.evaluate((element: HTMLElement): number => {
        return element.scrollWidth - element.clientWidth;
      }),
    ).toBeLessThanOrEqual(1);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  });

  /*
   * A case no playbook has run on says so the way Approvals and Playbook
   * Runs do: the product's empty state, in the reader's language, with no
   * card description saying it a second time. It was a line of grey
   * English under that description.
   */
  test("the case's Playbooks page before any run: the product's empty state, in German too, whole on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    const views: Array<[number, OpenOptions["lang"] | undefined, string]> = [
      [1440, undefined, "No playbook has run on this case yet"],
      [390, undefined, "No playbook has run on this case yet"],
      [1440, "de", "Für diesen Fall ist noch kein Playbook gelaufen"],
    ];

    for (const [width, lang, title] of views) {
      await open(
        page,
        `${TRAVEL_CASE_PATH}/playbook-runs`,
        lang ? { width, lang } : { width },
      );

      await expect(
        page.getByTestId("security-case-playbook-runs-empty"),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByTestId("security-case-playbook-runs-empty-title"),
      ).toHaveText(title);
      await expect(
        cardTitled(page, "Playbooks").getByTestId("card-description"),
      ).toHaveCount(0);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    }

    await screenshot(page, "case-playbooks-empty-de", { fullPage: false });
  });

  test("the case's Playbooks page: the held run with Approve and Reject, and its count beside the entry", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${SPRAY_CASE_PATH}/playbook-runs`);
    const held: Locator = page
      .getByTestId("security-playbook-run-card")
      .filter({ hasText: "Contain Compromised Okta Users" });
    await expect(held).toContainText("Waiting for Approval", {
      timeout: 30000,
    });
    await expect(held.getByRole("button", { name: "Approve" })).toBeEnabled();
    await expect(held.getByRole("button", { name: "Reject" })).toBeEnabled();

    // One run of this case waits: counted beside Playbooks, on any page of it.
    await expect
      .poll(() => {
        return menuCount(page, "Playbooks");
      })
      .toBe("1");
    await menuEntry(page, "Timeline").click();
    await waitForCasePage(page, CASE_PAGES[1]!);
    await expect
      .poll(() => {
        return menuCount(page, "Playbooks");
      })
      .toBe("1");

    // Run Playbook is the header's: the card has no second one.
    await menuEntry(page, "Playbooks").click();
    await expect(held).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Run Playbook", exact: true }),
    ).toHaveCount(1);
  });

  /*
   * A case's runs fold to a line each, as on Playbook Runs - a playbook run
   * at every new detection gives a busy case a run a detection - but its
   * newest opens, with any run waiting for approval.
   */
  test("the case's Playbooks folds its older runs to a line, the newest open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${SPRAY_CASE_PATH}/playbook-runs`);
    const cards: Locator = page.getByTestId("security-playbook-run-card");
    await expect(cards).toHaveCount(2, { timeout: 30000 });

    const held: Locator = cards.filter({
      hasText: "Contain Compromised Okta Users",
    });
    const enrich: Locator = cards.filter({ hasText: "Enrich New Cases" });

    // The newest, and waiting for approval: open on its steps.
    await expect(
      held.getByTestId("security-playbook-run-steps-toggle"),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(held).toContainText("Suspend the user in Okta");

    // The older one: a line of how far it got, its steps a click away.
    await expect(
      enrich.getByTestId("security-playbook-run-summary"),
    ).toHaveText("3 of 3 steps done");
    const toggle: Locator = enrich.getByTestId(
      "security-playbook-run-steps-toggle",
    );
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(enrich).not.toContainText("Added the triage checklist");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(enrich).toContainText(
      "Added the triage checklist to the case.",
    );
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

    await screenshot(page, "case-playbooks-folded", { fullPage: false });
  });

  test("approving the held step runs the rest of the playbook, and the count beside the entry goes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${SPRAY_CASE_PATH}/playbook-runs`);
    const held: Locator = page
      .getByTestId("security-playbook-run-card")
      .filter({ hasText: "Contain Compromised Okta Users" });
    await expect(held).toContainText("Waiting for Approval", {
      timeout: 30000,
    });
    await expect
      .poll(() => {
        return menuCount(page, "Playbooks");
      })
      .toBe("1");

    await held.getByRole("button", { name: "Approve" }).click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toContainText("Approve Step");
    await dialog
      .getByPlaceholder("Why you decided this way.")
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

    // Nothing waits on this case any more.
    await expect
      .poll(() => {
        return menuCount(page, "Playbooks");
      })
      .toBe("");
  });

  test("the Timeline page: everything that happened to the case, with who did it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${SPRAY_CASE_PATH}/timeline`);
    await expect(page.getByText("took the case.")).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page
        .getByTestId("feed-entry")
        .filter({ hasText: "Okta success after failures joined the case" }),
    ).toBeVisible();
  });

  /*
   * A case's Impact, on its Overview, as the server answers it from the
   * records Connected Signals lists (Fixture/CaseContextFixture.js): the
   * known-bad domain case names build-runner-07, which is on the service map,
   * reports a public address and is shown on a status page.
   */
  test("its Overview says what the case puts at risk: what it names and how far that reaches, reachable from the internet on evidence only, who owns it and what last changed there", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DOMAIN_CASE_PATH);
    const impact: Locator = cardTitled(page, "Impact");
    const summary: Locator = impact.getByTestId("security-case-impact-summary");
    await expect(summary).toBeVisible({ timeout: 30000 });

    // The figures first: whether it is exposed, what it names, calls and is called by, what watches it.
    await expect(summary.getByRole("listitem")).toHaveText([
      "Reachable from the internet",
      "Names 1 record",
      "Calls 2 others",
      "Called by 1",
      "1 monitor",
      "1 status page",
    ]);
    // Reachable on evidence: the public address the runner reports.
    await expect(impact).toContainText(
      "build-runner-07 has a public address, 198.51.100.23.",
    );
    await expect(
      impact.getByTestId("security-case-impact-owners"),
    ).toContainText("Platform Engineering");
    // The release before the attack, not the fix after it.
    const lastChange: Locator = impact.getByTestId(
      "security-case-impact-last-change",
    );
    await expect(lastChange).toContainText(
      "Deployed runner image 2026.10.2 on build-runner-07, 2 days ago: before the first detection",
    );
    await expect(lastChange).toContainText("Version 2026.10.2");

    // Record by record, behind a button.
    await expect(
      impact.getByTestId("security-case-impact-details"),
    ).toHaveCount(0);
    await impact
      .getByRole("button", { name: "Show what is at risk", exact: true })
      .click();
    const runner: Locator = impact.getByTestId("security-case-impact-record");
    await expect(runner).toHaveCount(1);
    await expect(
      runner.getByRole("link", { name: "build-runner-07", exact: true }),
    ).toBeVisible();
    const fact: (label: string) => Locator = (label: string): Locator => {
      return runner
        .locator("dt")
        .filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`) })
        .locator("xpath=following-sibling::dd[1]");
    };
    await expect(fact("Calls")).toHaveText("artifact-registry, github.com");
    await expect(fact("Called by")).toHaveText("ci-scheduler");
    await expect(fact("Watched by")).toContainText("build-runner-07 heartbeat");
    await expect(fact("Status pages")).toHaveText("Engineering Tools");
    expect(
      (await fixture(page)).apiRequests
        .filter((request: { url: string }): boolean => {
          return request.url.endsWith("/security-case-context/impact");
        })
        .map((request: { body: unknown }): unknown => {
          return request.body;
        }),
    ).toContainEqual({ caseId: CASE_ID(141) });
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "case-impact-desktop");

    // On a phone in the dark, the records read inside the card.
    await open(page, DOMAIN_CASE_PATH, {
      width: 390,
      height: 844,
      theme: "dark",
    });
    await impact
      .getByRole("button", { name: "Show what is at risk", exact: true })
      .click({ timeout: 30000 });
    await expect(runner).toBeVisible();
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "case-impact-390-dark");

    /*
     * The spray names only Kai Morgan, and nothing OneUptime holds shows the
     * case's address reached the app: not known, never a guess.
     */
    await open(page, SPRAY_CASE_PATH);
    await expect(summary.getByRole("listitem")).toHaveText(
      ["Not known to be reachable from the internet", "Names 1 record"],
      { timeout: 30000 },
    );
    await expect(impact).toContainText(
      "Nothing OneUptime holds shows it is: no request from a public address reached the app, and no record reports a public address.",
    );
  });

  /*
   * A case's Story, as the server tells it (Fixture/CaseContextFixture.js):
   * the spray's detections, its 412 failed sign-ins and the success among
   * them told as one run, the device enrolled after it, its playbook runs,
   * notes and milestones - on one time axis, oldest first.
   */
  test("the Story page tells what happened, in order: the detections, the events behind them as runs, what was done and what the team wrote", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${SPRAY_CASE_PATH}/story`);
    const story: Locator = page.getByTestId("security-case-story");
    const items: Locator = story.getByTestId("security-case-story-item");
    await expect(items.first()).toBeVisible({ timeout: 30000 });
    const kinds: () => Promise<Array<string | null>> = (): Promise<
      Array<string | null>
    > => {
      return items.evaluateAll(
        (elements: Array<Element>): Array<string | null> => {
          return elements.map((element: Element): string | null => {
            return element.getAttribute("data-kind");
          });
        },
      );
    };

    expect(await kinds()).toEqual([
      "Events",
      "Detection",
      "CaseOpened",
      "PlaybookRun",
      "Detection",
      "Milestone",
      "Detection",
      "PlaybookRun",
      "Note",
      "Events",
      "Note",
    ]);
    await expect(items).toContainText([
      "user.session.start FAILURE: INVALID_CREDENTIALS for j.wilson@acme-commerce.example from 203.0.113.47",
      "Okta password spray",
      "Case opened",
      "Enrich New Cases",
      "Known-bad address 203.0.113.47 (Tor exit node)",
      "Case acknowledged",
      "Okta sign-in success after a spray",
      "Contain Compromised Okta Users",
      "Spray started 09:02 UTC.",
      "user.mfa.factor.activate: Okta Verify enrolled for k.morgan@acme-commerce.example from 203.0.113.47",
      "Approving the suspend.",
    ]);
    // A run of alike events is one line, with how many; a detection, how often it fired.
    await expect(items.nth(0)).toContainText("413 events like this");
    await expect(items.nth(1)).toContainText("Fired 31 times");
    await expect(items.nth(7)).toContainText("Waiting for Approval");
    await expect(items.nth(8)).toContainText("Written by Maya Chen");
    // Nothing was cut, refused or failed, so nothing is said above it.
    await expect(story.getByTestId("security-case-story-notes")).toHaveCount(0);
    await screenshot(page, "case-story-desktop");
    expect(
      (await fixture(page)).apiRequests
        .filter((request: { url: string }): boolean => {
          return request.url.endsWith("/security-case-context/story");
        })
        .map((request: { body: unknown }): unknown => {
          return request.body;
        }),
    ).toContainEqual({ caseId: SPRAY_CASE_ID });

    // Narrowed to the attack, or to the response; a part with nothing in it is not offered.
    await story.getByTestId("security-case-story-filter-Attack").click();
    await expect
      .poll(kinds)
      .toEqual(["Events", "Detection", "Detection", "Detection", "Events"]);
    await story.getByTestId("security-case-story-filter-Response").click();
    await expect
      .poll(kinds)
      .toEqual([
        "CaseOpened",
        "PlaybookRun",
        "Milestone",
        "PlaybookRun",
        "Note",
        "Note",
      ]);
    await expect(
      story.getByTestId("security-case-story-filter-Changes"),
    ).toHaveCount(0);

    // A detection opens the case's Detections page.
    await story.getByTestId("security-case-story-filter-All").click();
    await items
      .nth(1)
      .getByTestId("security-case-story-link-detections")
      .click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(`${SPRAY_CASE_PATH}/detections`);
    await expect(page.getByText("31 times")).toBeVisible({ timeout: 30000 });
  });

  test("the Private Notes page: what the team wrote, and the composer for more", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${SPRAY_CASE_PATH}/notes`);
    await expect(
      page.getByText("Approving the suspend.", { exact: false }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("notes-header")).toContainText(
      "Private notes",
    );
  });

  test("Audit Logs and Delete Case wait under Advanced; Delete Case asks before it deletes anything", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH);
    await expect(menuSection(page, "Advanced")).toHaveAttribute(
      "aria-expanded",
      "false",
      { timeout: 30000 },
    );
    await expect(menuEntry(page, "Audit Logs")).toBeHidden();

    await menuSection(page, "Advanced").click();
    await menuEntry(page, "Audit Logs").click();
    await expect(page.getByText("Case Audit Logs")).toBeVisible({
      timeout: 30000,
    });

    await menuEntry(page, "Delete Case").click();
    const card: Locator = cardTitled(page, "Delete Case");
    await expect(card).toContainText(
      "CASE-142 and its detections, notes, timeline and playbook runs are deleted for good.",
    );
    await card
      .getByRole("button", { name: "Delete Case", exact: true })
      .click();

    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toContainText(
      "To keep the record, close it with a verdict instead.",
    );
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      (
        (await fixture(page)) as unknown as {
          deletes: Array<unknown>;
        }
      ).deletes,
    ).toEqual([]);
  });

  test("a Security Viewer reads every page of the case, and is shown why it cannot change one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${SPRAY_CASE_PATH}/playbook-runs`, { role: "viewer" });
    const held: Locator = page
      .getByTestId("security-playbook-run-card")
      .filter({ hasText: "Contain Compromised Okta Users" });
    await expect(held).toContainText("Waiting for Approval", {
      timeout: 30000,
    });
    await expect(held.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect(held.getByRole("button", { name: "Reject" })).toBeDisabled();

    // The header's changes are locked, each saying why on hover.
    await expect(page.getByTestId("security-case-close")).toBeDisabled();
    await page.getByTestId("security-case-close-disabled-wrapper").hover();
    await expect(page.getByRole("tooltip")).toContainText(
      "You do not have permission",
    );
    // Run Playbook too: a viewer may read the runs, not start one.
    await expect(page.getByTestId("security-case-run-playbook")).toBeDisabled();
    await expect(
      page.getByTestId("security-case-run-playbook-disabled-wrapper"),
    ).toBeVisible();

    // Delete Case is locked too.
    await open(page, `${SPRAY_CASE_PATH}/delete`, { role: "viewer" });
    const card: Locator = cardTitled(page, "Delete Case");
    await expect(
      card.getByRole("button", { name: "Delete Case", exact: true }),
    ).toBeDisabled({ timeout: 30000 });
  });

  test("a case that is not there says so, and Open Cases goes back to the queue", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(
      page,
      `${PRODUCT}/cases/20000000-0000-4000-8000-000000000999/detections`,
    );
    const state: Locator = page.getByTestId("security-case-not-found");
    await expect(state).toBeVisible({ timeout: 30000 });
    await expect(state).toContainText("This case could not be found");
    await expect(caseHeader(page)).toHaveCount(0);
    await screenshot(page, "case-not-found", { fullPage: false });

    await state.getByRole("button", { name: "Open Cases" }).click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(CASES_PATH);
  });

  test("the header at a laptop's width: the pills and the actions on the first row, the actions at the right, the title under both across the header", async ({
    page,
  }: {
    page: Page;
  }) => {
    // CASE-141 is nobody's: the most buttons a case shows, Assign to Me among them.
    for (const pathname of [
      `${SPRAY_CASE_PATH}/detections`,
      SPRAY_CASE_PATH,
      `${DOMAIN_CASE_PATH}/entities`,
    ]) {
      await open(page, pathname, { width: 1344 });
      await expect(caseHeader(page)).toBeVisible({ timeout: 30000 });
      await pageAtRest(page);

      const header: Box = await boxOf(caseHeader(page));
      const actions: Box = await boxOf(
        page.getByTestId("security-case-actions"),
      );
      const titleLocator: Locator = page.getByTestId("security-case-title");
      const title: Box = await boxOf(titleLocator);
      const chips: Box = await boxOf(
        titleLocator.locator("xpath=preceding-sibling::div[1]"),
      );
      const buttons: Array<Box> = [];

      for (const button of await page
        .getByTestId("security-case-actions")
        .getByRole("button")
        .all()) {
        buttons.push(await boxOf(button));
      }

      // The actions on the first row, beside the pills and level with them.
      expect(actions.y + actions.height, pathname).toBeLessThanOrEqual(
        title.y + 1,
      );
      expect(
        Math.abs(chips.y + chips.height / 2 - (actions.y + actions.height / 2)),
        pathname,
      ).toBeLessThanOrEqual(2);
      // Every button on that one row, the ⋯ last.
      expect(
        new Set(
          buttons.map((box: Box): number => {
            return Math.round(box.y);
          }),
        ).size,
        pathname,
      ).toBe(1);
      // At the header's right edge, inside it.
      expect(
        header.x + header.width - (actions.x + actions.width),
        pathname,
      ).toBeLessThan(32);
      // The title under both, from the pills' left edge to the actions' right one.
      expect(Math.abs(title.x - chips.x), pathname).toBeLessThanOrEqual(1);
      expect(
        Math.abs(title.x + title.width - (actions.x + actions.width)),
        pathname,
      ).toBeLessThanOrEqual(1);
      expect(await overflowOf(caseHeader(page)), pathname).toBeLessThanOrEqual(
        1,
      );
    }
  });

  test("the header beside the side menu at a smaller laptop's width: the title right after the pills, the buttons under it at the right on one row, the ⋯ in the corner", async ({
    page,
  }: {
    page: Page;
  }) => {
    // 1024 in production: the side menu leaves the header 684px.
    await open(page, `${DOMAIN_CASE_PATH}/entities`, { width: 1088 });
    await expect(caseHeader(page)).toBeVisible({ timeout: 30000 });
    await pageAtRest(page);

    const header: Box = await boxOf(caseHeader(page));
    const actions: Box = await boxOf(page.getByTestId("security-case-actions"));
    const titleLocator: Locator = page.getByTestId("security-case-title");
    const title: Box = await boxOf(titleLocator);
    const chips: Box = await boxOf(
      titleLocator.locator("xpath=preceding-sibling::div[1]"),
    );
    const more: Box = await boxOf(page.getByTestId("security-case-more"));
    const buttons: Array<Box> = [];

    for (const action of [
      "Assign to Me",
      "Run Playbook",
      "Declare Incident",
      "Close Case",
    ]) {
      buttons.push(
        await boxOf(
          caseHeader(page).getByRole("button", { name: action, exact: true }),
        ),
      );
    }

    // The buttons under the title, at the right, all four on one row.
    expect(actions.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
    expect(header.x + header.width - (actions.x + actions.width)).toBeLessThan(
      32,
    );
    expect(
      new Set(
        buttons.map((box: Box): number => {
          return Math.round(box.y);
        }),
      ).size,
    ).toBe(1);
    // The ⋯ in the header's top-right corner, level with the pills - not alone on a row.
    expect(header.x + header.width - (more.x + more.width)).toBeLessThan(28);
    expect(
      Math.abs(more.y + more.height / 2 - (chips.y + chips.height / 2)),
    ).toBeLessThanOrEqual(4);
    expect(more.y + more.height).toBeLessThan(title.y + title.height);
    expect(await overflowOf(caseHeader(page))).toBeLessThanOrEqual(1);
  });

  test("the status steps and the figures follow the width they have beside the side menu, every word whole, at a laptop's, a small laptop's, a tablet's and a phone's width", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * Production's 1280, 1024 and 768 (the fixture's own frame is 64px
     * narrower) and a phone. Four steps in one row at 768 broke
     * "Investigating" into "Investi" and "gating", and four figures in one
     * row at 1024 wrapped "TIME TO ACKNOWLEDGE" and pushed two of the
     * figures a line down.
     */
    for (const width of [1344, 1088, 832, 390]) {
      await open(page, SPRAY_CASE_PATH, { width });
      const steps: Locator = page.getByTestId("security-case-status-steps");
      await expect(steps).toBeVisible({ timeout: 30000 });
      await pageAtRest(page);

      const figures: Locator = page.getByRole("group", {
        name: "Case figures",
      });
      const stepBoxes: Array<Box> = [];
      const figureBoxes: Array<Box> = [];

      for (const step of await steps.getByRole("listitem").all()) {
        stepBoxes.push(await boxOf(step));
      }
      for (const figure of await figures.locator(":scope > div").all()) {
        figureBoxes.push(await boxOf(figure));
      }

      // No word of a step's name or a figure's label split across two lines.
      const brokenWords: Array<string> = await page.evaluate(
        (): Array<string> => {
          const broken: Array<string> = [];
          const names: Array<Element> = [
            ...Array.from(
              document.querySelectorAll(
                "[data-testid='security-case-status-steps'] button span:last-child",
              ),
            ),
            ...Array.from(
              document.querySelectorAll(
                "[role='group'][aria-label='Case figures'] > div > div:first-child > span",
              ),
            ),
          ];

          for (const name of names) {
            const text: Text | null = name.firstChild as Text | null;
            const content: string = text?.textContent || "";
            let start: number = 0;

            for (const word of content.split(" ")) {
              if (text && word.length > 0) {
                const range: Range = document.createRange();
                range.setStart(text, start);
                range.setEnd(text, start + word.length);
                const lines: Set<number> = new Set(
                  Array.from(range.getClientRects()).map(
                    (rect: DOMRect): number => {
                      return Math.round(rect.top);
                    },
                  ),
                );
                if (lines.size > 1) {
                  broken.push(word);
                }
              }
              start += word.length + 1;
            }
          }

          return broken;
        },
      );

      expect(brokenWords, `words split across lines at ${width}`).toEqual([]);

      const rowsOf: (boxes: Array<Box>) => number = (
        boxes: Array<Box>,
      ): number => {
        return new Set(
          boxes.map((box: Box): number => {
            return Math.round(box.y);
          }),
        ).size;
      };

      if (width === 1344) {
        // Room for each: the four steps in one row, and the four figures.
        expect(rowsOf(stepBoxes)).toBe(1);
        expect(rowsOf(figureBoxes)).toBe(1);
      }

      if (width === 1088) {
        // Four figures in two rows of two, every label on one line.
        expect(rowsOf(figureBoxes)).toBe(2);
      }

      if (width === 832) {
        // A tablet's 440px of steps: two rows of two.
        expect(rowsOf(stepBoxes)).toBe(2);
        expect(rowsOf(figureBoxes)).toBe(2);
      }

      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    }
  });

  test("the header on a phone: the buttons fill their rows, the ⋯ in the top corner, nothing cut short", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of [undefined, "dark"] as const) {
      await open(page, `${SPRAY_CASE_PATH}/detections`, {
        width: 390,
        height: 844,
        theme,
      });
      await expect(caseHeader(page)).toBeVisible({ timeout: 30000 });
      await pageAtRest(page);

      const header: Box = await boxOf(caseHeader(page));
      const more: Box = await boxOf(page.getByTestId("security-case-more"));
      const title: Box = await boxOf(page.getByTestId("security-case-title"));
      const buttons: Array<Box> = [];

      for (const action of ["Run Playbook", "Declare Incident", "Close Case"]) {
        const button: Locator = caseHeader(page).getByRole("button", {
          name: action,
          exact: true,
        });

        buttons.push(await boxOf(button));
        expect(
          await overflowOf(button.locator("span.truncate")),
          `${action} is cut short`,
        ).toBeLessThanOrEqual(1);
      }

      // The ⋯ in the header's top-right corner, above the title - not on a row of its own.
      expect(header.x + header.width - (more.x + more.width)).toBeLessThan(28);
      expect(more.y - header.y).toBeLessThan(24);
      expect(more.y + more.height).toBeLessThan(title.y + title.height);

      // The buttons under the title, each row of them filling the header's width.
      const actions: Box = await boxOf(
        page.getByTestId("security-case-actions"),
      );
      const rows: Map<number, Array<Box>> = new Map();
      for (const box of buttons) {
        expect(box.y).toBeGreaterThan(title.y);
        rows.set(Math.round(box.y), [
          ...(rows.get(Math.round(box.y)) || []),
          box,
        ]);
      }
      for (const row of rows.values()) {
        const left: number = Math.min(
          ...row.map((box: Box): number => {
            return box.x;
          }),
        );
        const right: number = Math.max(
          ...row.map((box: Box): number => {
            return box.x + box.width;
          }),
        );
        expect(Math.abs(left - actions.x)).toBeLessThanOrEqual(1);
        expect(
          Math.abs(right - (actions.x + actions.width)),
        ).toBeLessThanOrEqual(1);
      }

      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
      await screenshot(page, `case-header-390-${theme || "light"}`, {
        fullPage: false,
      });
    }
  });

  test("on a phone, the case's menu names the section and the page, and moves between its pages", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${SPRAY_CASE_PATH}/detections`, {
      width: 390,
      height: 844,
    });
    const toggle: Locator = page.getByTestId("mobile-sidemenu-toggle");
    await expect(toggle).toContainText("Investigation / Detections", {
      timeout: 30000,
    });

    await toggle.click();
    const menu: Locator = page.getByRole("navigation", {
      name: "Main navigation",
    });
    for (const title of ["Overview", "Timeline", "Entities", "Private Notes"]) {
      await expect(
        menu.getByRole("link", { name: title, exact: true }),
      ).toBeVisible();
    }
    await screenshot(page, "case-side-menu-mobile", { fullPage: false });

    await menu.getByRole("link", { name: "Entities", exact: true }).click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(`${SPRAY_CASE_PATH}/entities`);
    await expect(toggle).toContainText("Investigation / Entities");
  });

  /*
   * Every page opened straight from its address, at a laptop's width and a
   * phone's: in the dark theme at the laptop's width, and on the phone for
   * the pages whose own content changes there (the Overview's figures, the
   * Entities table's columns) - the header's phone layout in the dark is
   * the header's own test, above. Kept to these, so the suite stays inside
   * its CI group's time.
   */
  const CASE_PAGE_SHOTS: ReadonlyArray<[number, "dark" | undefined]> = [
    [1344, undefined],
    [1344, "dark"],
    [390, undefined],
  ];
  const CASE_PAGES_DARK_ON_A_PHONE: ReadonlyArray<string> = [
    "Overview",
    "Entities",
  ];

  test("a link straight to any of its pages opens that page, its entry lit; at 1280 and 390, in both themes, nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const casePage of CASE_PAGES) {
      const shots: Array<[number, "dark" | undefined]> = [
        ...CASE_PAGE_SHOTS,
        ...(CASE_PAGES_DARK_ON_A_PHONE.includes(casePage.title)
          ? ([[390, "dark"]] as Array<[number, "dark" | undefined]>)
          : []),
      ];

      for (const [width, theme] of shots) {
        await open(page, casePagePath(casePage), {
          width,
          height: width === 390 ? 844 : 1000,
          theme,
        });
        await waitForCasePage(page, casePage);

        if (width === 1344 && !theme) {
          // Its own entry lit, and its section open, the Overview's too.
          expect([casePage.title, await litEntries(page)]).toEqual([
            casePage.title,
            [casePage.title],
          ]);
          await expect(
            menuSection(page, casePage.section),
            `${casePage.title}'s section`,
          ).toHaveAttribute("aria-expanded", "true");
        }

        expect(
          await pageOverflow(page),
          `${casePage.title} at ${width} ${theme || "light"}`,
        ).toBeLessThanOrEqual(1);
        await screenshot(
          page,
          `case-${casePage.slug}-${width === 390 ? 390 : 1280}-${theme || "light"}`,
        );
      }
    }
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
    // The list's own names: playbooks, not the model's "security playbooks".
    await expect(page.getByText("Showing 1-4 of 4 playbooks")).toBeVisible({
      timeout: 30000,
    });

    const rows: Array<string> = await rowTexts(page);
    const contain: string = rows.find((row: string): boolean => {
      return row.includes("Contain Compromised Okta Users");
    }) as string;
    expect(contain).toContain("4 steps");
    expect(contain).toContain("Enabled");
    expect(contain).toContain("Case Opened");
    expect(contain).toContain("Critical and up");

    // The list leads the page: no card of templates above it.
    await expect(page.getByTestId("security-playbook-templates")).toHaveCount(
      0,
    );

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

  test("Create from Template lists the templates, the ones the project has Added with View", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PLAYBOOKS_PATH);
    await expect(page.getByText("Showing 1-4 of 4 playbooks")).toBeVisible({
      timeout: 30000,
    });

    await cardTitled(page, "Playbooks")
      .getByRole("button", { name: "More options" })
      .click();
    await page.getByRole("menuitem", { name: "Create from Template" }).click();

    const dialog: Locator = page.getByTestId("modal");
    await expect(dialog).toBeVisible();
    // The project has a playbook of every template: each says Added, none offers a copy.
    for (const key of ["enrich", "known-bad", "imported-alerts"]) {
      await expect(
        dialog.getByTestId(`security-playbook-template-added-${key}`),
      ).toHaveText("Added");
      await expect(
        dialog.getByTestId(`security-playbook-template-${key}`),
      ).toHaveCount(0);
    }
    await pageAtRest(page);
    // The tiles fill the dialog, not a column in its middle.
    const dialogBox: Box = await boxOf(dialog);
    const pickerBox: Box = await boxOf(
      dialog.getByTestId("security-playbook-templates"),
    );
    expect(pickerBox.x - dialogBox.x).toBeLessThanOrEqual(48);
    expect(
      dialogBox.x + dialogBox.width - (pickerBox.x + pickerBox.width),
    ).toBeLessThanOrEqual(48);
    // A tile acts at once: the dialog closes, there is nothing to cancel.
    await expect(dialog.getByTestId("modal-footer-close-button")).toHaveText(
      "Close",
    );
    await screenshot(page, "playbooks-templates-dialog");

    await dialog
      .getByTestId("security-playbook-template-view-known-bad")
      .click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(`${PLAYBOOKS_PATH}/24000000-0000-4000-8000-000000000002`);
  });

  test("a template becomes a working playbook in one click, built as Turn on recommended builds Enrich New Cases", async ({
    page,
  }: {
    page: Page;
  }) => {
    // A project with no playbook: the templates are its empty list.
    await open(page, PLAYBOOKS_PATH, { empty: true });
    await expect(page.getByTestId("security-playbook-templates")).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByRole("heading", { name: "Start from a template" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("security-playbook-create-blank"),
    ).toBeVisible();
    await screenshot(page, "playbooks-empty");
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
    await open(page, PLAYBOOKS_PATH, { setup: "partly", empty: true });
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

    // The trail and the tab name the playbook, not "View Playbook".
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Playbooks",
      "Contain Compromised Okta Users",
    ]);
    expect(await page.title()).toContain("Contain Compromised Okta Users");

    // Its runs fold to a line: the one waiting for approval opens.
    const runs: Locator = page.getByTestId("security-playbook-run-card");
    await expect(runs).toHaveCount(2);
    await expect(
      runs.first().getByTestId("security-playbook-run-steps-toggle"),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(
      runs.nth(1).getByTestId("security-playbook-run-steps-toggle"),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(
      runs.nth(1).getByTestId("security-playbook-run-summary"),
    ).toHaveText("4 of 4 steps done");
    // Every run here is this playbook's: each is named by its case, not the playbook again.
    await expect(runs.first().getByRole("link").first()).toHaveText(
      "CASE-142 Password spray against Okta from 203.0.113.47",
    );
    await expect(runs.nth(1).getByRole("link").first()).toHaveText(
      "CASE-140 CrowdStrike: credential dumping on fin-ws-112",
    );
    for (const run of await runs.all()) {
      await expect(run).not.toContainText("Contain Compromised Okta Users");
    }

    await screenshot(page, "playbook-desktop");
  });

  /*
   * A step's dialog was titled "Edit Step 4", joined from English pieces,
   * over "Add a note: Write a note on the case: ..." - on every page. It is
   * named by the step's place and what it does, as a run lists its steps,
   * in the reader's language.
   */
  test("a step's dialog is named by its place and what it does, in the reader's language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CONTAIN_PLAYBOOK_PATH, { width: 1344, lang: "de" });
    const step: Locator = page.getByTestId("security-playbook-step-3");

    await expect(step).toBeVisible({ timeout: 30000 });
    await step.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: "Schritt bearbeiten" }).click();

    await expect(page.getByTestId("modal-title")).toHaveText(
      "Schritt 4 bearbeiten: Notiz hinzufügen",
    );
    const dialog: Locator = page.getByRole("dialog").first();

    await expect(dialog).toContainText(
      "Eine Notiz zum Fall schreiben: eine Checkliste",
    );
    await expect(dialog).not.toContainText("Edit Step");
    await expect(dialog).not.toContainText("Write a note on the case");
  });

  test("Approvals, at the runs page's old address, lists the run held for a decision", async ({
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
      page.getByRole("heading", { name: "Approvals", exact: true }),
    ).toBeVisible();
    expect(await litEntries(page)).toEqual(["Approvals"]);
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Playbooks",
      "Approvals",
    ]);
    // The views that sat on the card are gone: each is a page.
    await expect(
      page.locator('[data-testid^="security-playbook-runs-view-"]'),
    ).toHaveCount(0);
    await expect(page.locator("button[aria-pressed]")).toHaveCount(0);
    // With a run listed, the card says what the page holds.
    await expect(
      cardTitled(page, "Approvals").getByTestId("card-description"),
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

    // Each run is a line; the one waiting for approval opens, the rest fold.
    await expect(
      page.locator(
        '[data-testid="security-playbook-run-steps-toggle"][aria-expanded="true"]',
      ),
    ).toHaveCount(1);
    const failed: Locator = page
      .getByTestId("security-playbook-run-card")
      .filter({ hasText: "Failed" });
    await expect(
      failed.getByTestId("security-playbook-run-summary"),
    ).toHaveText("Stopped at step 2: Look up entity activity");
    await expect(failed).not.toContainText(
      "The events store did not answer within 30 seconds.",
    );

    // Show steps opens the failed run on its reason.
    await failed.getByTestId("security-playbook-run-steps-toggle").click();
    await expect(failed).toContainText(
      "The events store did not answer within 30 seconds.",
    );
    expect(await litEntries(page)).toEqual(["Playbook Runs"]);

    await screenshot(page, "playbook-runs-desktop");
  });

  test("a run's buttons keep its title's line at a laptop's width, at the card's right, and drop under its words on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    // The fixture is 64px narrower than production: 1344 here is a 1280 laptop.
    for (const pathname of [RUNS_PATH, ALL_RUNS_PATH]) {
      await open(page, pathname, { width: 1344 });
      const held: Locator = page
        .getByTestId("security-playbook-run-card")
        .filter({ hasText: "Waiting for Approval" });
      await expect(held).toHaveCount(1, { timeout: 30000 });

      const card: Box = await boxOf(held);
      const title: Box = await boxOf(
        held.getByText("Contain Compromised Okta Users", { exact: true }),
      );
      const approve: Box = await boxOf(
        held.getByRole("button", { name: "Approve" }),
      );
      const reject: Box = await boxOf(
        held.getByRole("button", { name: "Reject" }),
      );

      // On the title's line - not a row of their own under an empty band.
      expect(approve.y, pathname).toBeLessThan(title.y + title.height);
      expect(title.y, pathname).toBeLessThan(approve.y + approve.height);
      expect(Math.abs(reject.y - approve.y)).toBeLessThanOrEqual(1);
      expect(reject.x + reject.width).toBeLessThanOrEqual(approve.x);
      // At the card's right edge.
      expect(card.x + card.width - (approve.x + approve.width)).toBeLessThan(
        24,
      );
    }

    // A running run's Cancel Run keeps the same place.
    const running: Locator = page
      .getByTestId("security-playbook-run-card")
      .filter({ hasText: "Running" });
    const runningTitle: Box = await boxOf(
      running.getByText("Escalate Known-Bad Indicators", { exact: true }),
    );
    const cancel: Box = await boxOf(
      running.getByRole("button", { name: "Cancel Run" }),
    );
    expect(cancel.y).toBeLessThan(runningTitle.y + runningTitle.height);
    expect(
      (await boxOf(running)).x +
        (await boxOf(running)).width -
        (cancel.x + cancel.width),
    ).toBeLessThan(24);

    // A phone: the words keep the width, the buttons drop under them, still at the right.
    await open(page, RUNS_PATH, { width: 390, height: 844 });
    const heldOnPhone: Locator = page.getByTestId("security-playbook-run-card");
    await expect(heldOnPhone).toHaveCount(1, { timeout: 30000 });
    const phoneCard: Box = await boxOf(heldOnPhone);
    const phoneSummary: Box = await boxOf(
      heldOnPhone.getByTestId("security-playbook-run-summary"),
    );
    const phoneApprove: Box = await boxOf(
      heldOnPhone.getByRole("button", { name: "Approve" }),
    );
    expect(phoneApprove.y).toBeGreaterThanOrEqual(
      phoneSummary.y + phoneSummary.height,
    );
    expect(
      phoneCard.x + phoneCard.width - (phoneApprove.x + phoneApprove.width),
    ).toBeLessThan(24);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
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

  test("with nothing held, Approvals says all is clear; with no run, Playbook Runs points at the playbooks", async ({
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
      cardTitled(page, "Approvals").getByTestId("card-description"),
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
  test("ATT&CK Coverage opens on the tactics: how much of each is covered, what the Rule Library adds, and each one's techniques", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ATTACK_COVERAGE_PATH, { width: 1344 });
    await expect(page.getByText("2 / 227")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("1 / 15")).toBeVisible();

    // A row per tactic, in the order an attack moves through them.
    await expect(page.locator('[data-testid^="attack-tactic-TA"]')).toHaveCount(
      15,
    );
    const credentialAccess: Locator = page.getByTestId("attack-tactic-TA0006");
    await expect(credentialAccess).toContainText(
      "Steal account names and passwords.",
    );
    await expect(
      credentialAccess.getByTestId("attack-tactic-covered"),
    ).toHaveText(`2 of ${(MITRE_TACTIC_TECHNIQUES["TA0006"] || []).length}`);
    // No tactic is open, and nothing scrolls sideways: the matrix waits behind its switch.
    await expect(page.getByTestId("attack-tactic-techniques")).toHaveCount(0);
    await expect(page.getByTestId("attack-coverage-matrix")).toHaveCount(0);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

    // The next step: what the Rule Library covers that the rules do not.
    const gap: Locator = page.getByTestId("attack-coverage-gap");
    await expect(gap).toContainText(
      /The Rule Library covers \d+ techniques your rules do not\./,
    );
    await screenshot(page, "attack-coverage-desktop");

    // A tactic opens on its techniques, the covered first.
    await credentialAccess.getByRole("button").first().click();
    const techniques: Locator = credentialAccess.getByTestId(
      "attack-tactic-techniques",
    );
    await expect(techniques).toBeVisible();
    await expect(techniques.locator("[data-coverage]").first()).toHaveAttribute(
      "data-coverage",
      "covered",
    );
    await expect(
      techniques.getByTestId("attack-technique-T1110"),
    ).toHaveAttribute("data-coverage", "covered");
    // Its tiles sit under a heading per state, with how many: the legend's words, right above them.
    const groups: Locator = techniques.getByRole("group");
    await expect(groups).toHaveCount(3);
    await expect(groups.first()).toHaveAttribute(
      "data-testid",
      "attack-coverage-group-covered",
    );
    await expect(
      techniques.getByText("Available in the Rule Library", { exact: true }),
    ).toBeVisible();
    const firstHeading: Box = await boxOf(
      techniques.getByText("Covered by an enabled rule", { exact: true }),
    );
    const firstTile: Box = await boxOf(
      techniques.getByTestId("attack-technique-T1110"),
    );
    expect(firstHeading.y + firstHeading.height).toBeLessThanOrEqual(
      firstTile.y,
    );
    // A tile says what its count counts.
    await expect(
      techniques
        .getByTestId("attack-technique-T1110")
        .getByTestId("attack-technique-rule-count"),
    ).toHaveText(/^\d+ rules?$/);
    // By tactic there is no legend at the card's foot: the headings say it.
    await expect(page.getByTestId("attack-coverage-legend")).toHaveCount(0);
    await screenshot(page, "attack-coverage-tactic-open");

    // The gap's link opens the Rule Library on the rules not added.
    await gap.getByRole("link").click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(RULE_LIBRARY_PATH);
    expect(new URL(page.url()).searchParams.get("status")).toBe("not-added");
    await expect(libraryRow(page, CLOUDTRAIL_RULE)).toBeVisible({
      timeout: 30000,
    });
    // The recommended brute force rule is the project's: not listed.
    await expect(libraryRow(page, BRUTE_FORCE_RULE)).toHaveCount(0);
  });

  test("ATT&CK Coverage's matrix is one switch away, scrolls in its card, and the address keeps it; the page fits a phone and the dark theme", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ATTACK_COVERAGE_PATH);
    await expect(page.getByText("2 / 227")).toBeVisible({ timeout: 30000 });

    await page
      .getByTestId("attack-coverage-view")
      .getByRole("radio", { name: "Matrix" })
      .click();
    await expect
      .poll(() => {
        return new URL(page.url()).searchParams.get("view");
      })
      .toBe("matrix");

    const technique: Locator = page
      .getByTestId("attack-technique-T1110")
      .first();
    await expect(technique).toBeVisible();
    // The matrix's cells are keyed under it.
    await expect(page.getByTestId("attack-coverage-legend")).toBeVisible();

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
    await screenshot(page, "attack-coverage-matrix");

    // A reload keeps the matrix.
    await page.reload();
    await expect(page.getByTestId("attack-coverage-matrix")).toBeVisible({
      timeout: 60000,
    });

    // A phone opens on the tactics, a tactic's techniques one to a line, nothing sideways.
    await open(page, ATTACK_COVERAGE_PATH, {
      width: 390,
      height: 844,
      tactic: "TA0006",
    });
    await expect(
      page
        .getByTestId("attack-tactic-TA0006")
        .getByTestId("attack-tactic-techniques"),
    ).toBeVisible({ timeout: 30000 });
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "attack-coverage-phone");

    await open(page, ATTACK_COVERAGE_PATH, {
      width: 1280,
      theme: "dark",
      tactic: "TA0006",
    });
    await expect(
      page
        .getByTestId("attack-tactic-TA0006")
        .getByTestId("attack-tactic-techniques"),
    ).toBeVisible({ timeout: 30000 });
    await screenshot(page, "attack-coverage-dark");
  });

  /*
   * The library shows every rule on one page: its table has no footer to
   * page with (disablePagination). The empty footer used to pull itself into
   * the card's bottom padding, so the last rule ended on the card's bottom
   * edge - its square white corners over the card's rounded ones, and over
   * its bottom border (#5246). The card keeps its padding now, with its
   * border and its corners, in both themes.
   */
  test("the rule library's last rule ends inside its card: the card keeps its padding, bottom border and rounded corners", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of [undefined, "dark"] as Array<OpenOptions["theme"]>) {
      await open(page, RULE_LIBRARY_PATH, { width: 1344, theme });
      const last: Locator = libraryRows(page).last();
      await expect(last).toBeVisible({ timeout: 30000 });

      // The card is the page's last: its foot is in the window at the page's end.
      await page.evaluate((): void => {
        window.scrollTo(0, document.documentElement.scrollHeight);
      });

      const card: Locator = page
        .getByTestId("card")
        .filter({ has: libraryRows(page).first() });
      const cardBox: Box = await boxOf(card);
      const lastBox: Box = await boxOf(last);
      const gap: number =
        cardBox.y + cardBox.height - (lastBox.y + lastBox.height);

      // The card's 24px of padding, and its 1px border.
      expect(gap, `${theme || "light"}: under the last rule`).toBeGreaterThan(
        23,
      );
      expect(gap).toBeLessThan(27);

      // Nothing of the footer is drawn: no band, no pull into the padding.
      const footer: Locator = card.getByTestId("table-footer");
      expect(
        await footer.evaluate((element: Element): number => {
          return element.getBoundingClientRect().height;
        }),
      ).toBe(0);
      await expect(footer).toHaveCSS("margin-bottom", "0px");

      /*
       * What is drawn just inside the card's bottom corner, and in the
       * middle of its bottom padding, is the card - not a row's cell.
       */
      for (const [x, y] of [
        [cardBox.x + 8, cardBox.y + cardBox.height - 8],
        [cardBox.x + cardBox.width - 8, cardBox.y + cardBox.height - 8],
        [cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height - 6],
      ] as Array<[number, number]>) {
        const drawn: string = await page.evaluate(
          ({ pointX, pointY }: { pointX: number; pointY: number }): string => {
            // A bounding box is where it is in the window, as this reads.
            const element: Element | null = document.elementFromPoint(
              pointX,
              pointY,
            );

            if (!element) {
              return "nothing";
            }

            return element.closest("tr") ? "row" : "card";
          },
          { pointX: x, pointY: y },
        );
        expect(drawn, `${theme || "light"} at ${x},${y}`).toBe("card");
      }
    }
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

  /*
   * Beside the side menu at 768px the card is 478px wide, and Rule, Data,
   * Severity and Add needed 566px: Add ran under the sticky last column
   * until about 860px, and in German at 900px, where Data is as wide as
   * Anmeldeereignisse. Below lg the severity and the events go under the
   * rule's name, as on a phone's card: a row is the rule and its Add.
   */
  for (const [width, lang] of [
    [768, ""],
    [820, ""],
    [900, "de"],
    [1023, ""],
  ] as Array<[number, "" | "de"]>) {
    test(`at ${width}px${lang ? ` in German` : ""}, beside the side menu, the rows fit the card: the severity and the events under the rule's name, Add in sight`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, RULE_LIBRARY_PATH, {
        width,
        height: 900,
        ...(lang ? { lang } : {}),
      });
      const brute: Locator = libraryRow(page, BRUTE_FORCE_RULE);
      await expect(brute).toBeVisible({ timeout: 30000 });

      // No Data or Severity column: both under the name.
      await expect(
        brute.getByTestId(`rule-library-severity-${BRUTE_FORCE_RULE.id}`),
      ).toHaveCount(0);
      await expect(
        brute.getByTestId(`rule-library-data-${BRUTE_FORCE_RULE.id}`),
      ).toHaveCount(0);
      const facts: Locator = brute
        .getByTestId(`rule-library-rule-${BRUTE_FORCE_RULE.id}`)
        .getByTestId(`rule-library-card-facts-${BRUTE_FORCE_RULE.id}`);
      await expect(facts).toContainText(lang === "de" ? "Hoch" : "High");
      await expect(facts).toContainText(
        lang === "de" ? "Anmeldeereignisse" : "Sign-in events",
      );
      await expect(
        facts.getByTestId(`rule-library-data-status-${BRUTE_FORCE_RULE.id}`),
      ).toHaveText(lang === "de" ? "Empfangen" : "Receiving");
      await expect(page.locator("thead th")).toHaveCount(2);

      // Add is on the row, in the card.
      await expect(page.getByTestId("table-scroll").first()).toHaveAttribute(
        "data-overflowing",
        "false",
      );
      const card: Box = await boxOf(
        cardTitled(page, lang === "de" ? "Regelbibliothek" : "Rule Library"),
      );
      const add: Box = await boxOf(
        libraryRow(page, CLOUDTRAIL_RULE).getByTestId(
          `rule-library-add-${CLOUDTRAIL_RULE.id}`,
        ),
      );
      expect(add.x + add.width).toBeLessThanOrEqual(card.x + card.width);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

      await screenshot(page, `rule-library-${width}${lang ? `-${lang}` : ""}`, {
        fullPage: false,
      });
    });
  }

  test("from 1024px the data and the severity are columns of their own again, and not under the name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RULE_LIBRARY_PATH, { width: 1024, height: 900 });
    const brute: Locator = libraryRow(page, BRUTE_FORCE_RULE);
    await expect(brute).toBeVisible({ timeout: 30000 });

    await expect(
      brute.getByTestId(`rule-library-severity-${BRUTE_FORCE_RULE.id}`),
    ).toHaveText("High");
    await expect(
      brute.getByTestId(`rule-library-card-facts-${BRUTE_FORCE_RULE.id}`),
    ).toHaveCount(0);
    await expect(page.locator("thead th")).toHaveCount(4);
    await expect(page.getByTestId("table-scroll").first()).toHaveAttribute(
      "data-overflowing",
      "false",
    );
  });

  test("the rule library narrows in the row of chips every list has - Rule category, Data and Status - with how many rules are in sight", async ({
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
      await expect(filters).toHaveAttribute("role", "group");
      await expect(chipButton(page, CATEGORY_CHIP)).toHaveText("Rule category");
      await expect(chipButton(page, DATA_CHIP)).toHaveText("Data");
      await expect(chipButton(page, STATUS_CHIP)).toHaveText("Status");

      // The chips: one height, each whole inside the card.
      const card: Box = await boxOf(cardTitled(page, "Rule Library"));
      const chips: Array<Box> = [];
      for (const chip of [CATEGORY_CHIP, DATA_CHIP, STATUS_CHIP]) {
        chips.push(
          await boxOf(page.getByTestId(chip).getByTestId("filter-chip")),
        );
      }
      for (const box of chips) {
        expect(Math.abs(box.height - chips[0]!.height)).toBeLessThanOrEqual(1);
        expect(box.x).toBeGreaterThanOrEqual(card.x);
        expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
      }

      if (width >= 1024) {
        // One line, in order, and how many rules after them.
        for (const box of chips) {
          expect(Math.abs(box.y - chips[0]!.y)).toBeLessThanOrEqual(1);
        }
        expect(chips[1]!.x).toBeGreaterThan(chips[0]!.x + chips[0]!.width);
        expect(chips[2]!.x).toBeGreaterThan(chips[1]!.x + chips[1]!.width);
        const count: Box = await boxOf(page.getByTestId("rule-library-count"));
        expect(count.x).toBeGreaterThan(chips[2]!.x + chips[2]!.width);
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

      // A category narrows the rows to its own, says so on its chip, and how many.
      await pickChip(page, CATEGORY_CHIP, "Kubernetes");
      await expect(libraryRows(page)).toHaveCount(4);
      await expect(page.getByTestId("rule-library-count")).toHaveText(
        "4 rules",
      );
      await expect(chipButton(page, CATEGORY_CHIP)).toHaveText(
        "Rule category · Kubernetes",
      );
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
      await screenshot(
        page,
        `rule-library-filtered-${width}-${theme || "light"}`,
        { fullPage: false },
      );

      // And the way back.
      await page.getByTestId("facet-filter-bar-clear-all").click();
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
    // The data the project sends: Okta, Defender XDR's processes, Kubernetes audit logs.
    await pickChip(page, DATA_CHIP, "Receiving");
    await expect(libraryRow(page, BRUTE_FORCE_RULE)).toBeVisible();
    await expect(libraryRow(page, CLOUDTRAIL_RULE)).toHaveCount(0);
    for (const status of await page
      .locator('[data-testid^="rule-library-data-status-"]')
      .all()) {
      await expect(status).toHaveText("Receiving");
    }

    // ... that it lacks: the rules it has not added yet.
    await pickChip(page, STATUS_CHIP, "Not added");
    await expect(
      page.locator('[data-testid^="rule-library-added-"]'),
    ).toHaveCount(0);
    await expect(libraryRows(page).first()).toBeVisible();

    await page.getByTestId("facet-filter-bar-clear-all").click();

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
    await pickChip(page, CATEGORY_CHIP, "Cloud");
    await pickChip(page, STATUS_CHIP, "Not added");

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
    await expect(chipButton(page, CATEGORY_CHIP)).toHaveText(
      "Rule category · Cloud",
    );
    await expect(libraryRow(page, CLOUDTRAIL_RULE)).toBeVisible();
    await expect(libraryRow(page, BRUTE_FORCE_RULE)).toHaveCount(0);

    // ATT&CK Coverage: a technique's rules in the library, one click away.
    await open(page, ATTACK_COVERAGE_PATH, { width: 1280, tactic: "TA0006" });
    await expect(page.getByText("2 / 227")).toBeVisible({ timeout: 30000 });
    await page.getByTestId("attack-technique-T1110").first().click();
    await page.getByRole("link", { name: "Open the Rule Library" }).click();
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

    /*
     * A narrowed list: the main add says it adds the matching rules, just
     * those - the library's Network rules the project does not have yet:
     * neither the one added from its row nor a recommended one.
     */
    const matching: Array<DetectionRuleLibraryEntry> =
      DETECTION_RULE_LIBRARY.filter(
        (entry: DetectionRuleLibraryEntry): boolean => {
          return (
            entry.category === DetectionRuleLibraryCategory.Network &&
            entry.id !== PORT_SCAN_RULE.id &&
            !isRecommendedDetectionRule(entry)
          );
        },
      );
    expect(matching).toContain(NETWORK_SWEEP_RULE);
    const isOne: boolean = matching.length === 1;
    await pickChip(page, CATEGORY_CHIP, "Network");
    await page
      .getByTestId("rule-library-toolbar")
      .getByRole("button", {
        name: `Add ${matching.length} Matching Rule${isOne ? "" : "s"}`,
      })
      .click();
    await expect(
      page.getByTestId("modal").getByTestId("modal-title"),
    ).toHaveText(`Add ${matching.length} rule${isOne ? "" : "s"}?`);
    await page
      .getByTestId("modal")
      .getByRole("button", { name: isOne ? "Add Rule" : "Add Rules" })
      .click();
    for (const entry of matching) {
      await expect(
        page.getByTestId(`rule-library-added-${entry.id}`),
        entry.title,
      ).toBeVisible();
    }
    // Every rule the library added is the record Turn on recommended adds: on, opening cases.
    const created: Array<{ modelName: string; data: Record<string, unknown> }> =
      (await fixture(page)).creates.filter(
        (item: { modelName: string }): boolean => {
          return item.modelName === "DetectionRule";
        },
      );
    expect(created).toHaveLength(RECOMMENDED_RULES + 1 + matching.length);
    for (const item of created) {
      expect(item.data["isEnabled"]).toBe(true);
      expect(item.data["shouldCreateCase"]).toBe(true);
    }
  });

  test("asking before it adds several rules leaves the page where it was, behind the dialog and after it", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1280, 390]) {
      await open(page, RULE_LIBRARY_PATH, { width, height: 900, empty: true });
      await expect(libraryRow(page, BRUTE_FORCE_RULE)).toBeVisible({
        timeout: 30000,
      });
      expect(await scrollTopOf(page)).toBe(0);

      /*
       * The first dialog a page opens took its focus before its overlay
       * was styled, and that focus scrolled the page down to where the
       * panel was drawn for that moment: 4,500px down the list.
       */
      await page
        .getByTestId("rule-library-toolbar")
        .getByRole("button", {
          name: `Add ${RECOMMENDED_RULES} Recommended Rules`,
        })
        .click();
      await expect(page.getByTestId("modal")).toBeVisible();
      await expect(
        page.getByTestId("modal").getByRole("button", { name: "Add Rules" }),
      ).toBeFocused();
      expect(await scrollTopOf(page), `at ${width}`).toBe(0);

      // Each rule it lists has the events it reads under its name.
      const name: Box = await boxOf(
        page.getByTestId(`rule-library-add-name-${BRUTE_FORCE_RULE.id}`),
      );
      const reads: Box = await boxOf(
        page.getByTestId(`rule-library-add-data-${BRUTE_FORCE_RULE.id}`),
      );
      expect(reads.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
      expect(Math.abs(reads.x - name.x)).toBeLessThanOrEqual(1);

      await page
        .getByTestId("modal")
        .getByRole("button", { name: "Cancel" })
        .click();
      await expect(page.getByTestId("modal")).toHaveCount(0);
      expect(await scrollTopOf(page), `at ${width}`).toBe(0);
    }
  });

  test("a search keeps the header's adds beside it, on the title's line: the ⋯ adds the rules it finds", async ({
    page,
  }: {
    page: Page;
  }) => {
    // The fixture's frame is 64px narrower than production's: 1344 here is production's 1280.
    await open(page, RULE_LIBRARY_PATH, { width: 1344 });
    await expect(libraryRow(page, BRUTE_FORCE_RULE)).toBeVisible({
      timeout: 30000,
    });
    const title: Box = await boxOf(
      cardTitled(page, "Rule Library").getByRole("heading", {
        name: "Rule Library",
        exact: true,
      }),
    );

    await page.keyboard.press("/");
    await page.keyboard.type("okta");
    await expect(libraryRows(page)).toHaveCount(10);

    // Not folded away behind the opened search, and still beside the title.
    const main: Locator = page
      .getByTestId("rule-library-toolbar")
      .getByRole("button", {
        name: `Add ${RECOMMENDED_RULES - RECOMMENDED_RULES_ON} Recommended Rules`,
      });
    await expect(main).toBeVisible();
    await page.waitForTimeout(400);
    const mainBox: Box = await boxOf(main);
    expect(
      Math.abs(mainBox.y + mainBox.height / 2 - (title.y + title.height / 2)),
    ).toBeLessThanOrEqual(4);

    // Four of the ten are the project's already: the ⋯ adds the other six.
    await page.getByTestId("rule-library-more").click();
    await page.getByRole("menuitem", { name: "Add 6 Matching Rules" }).click();
    await expect(
      page.getByTestId("modal").getByTestId("modal-title"),
    ).toHaveText("Add 6 rules?");
    await page
      .getByTestId("modal")
      .getByRole("button", { name: "Add Rules" })
      .click();
    await expect(
      page.locator('[data-testid^="rule-library-added-"]'),
    ).toHaveCount(10);
    await expect(page.getByTestId(RULE_LIBRARY_SEARCH)).toHaveValue("okta");
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
    // A Data chip would narrow nothing: it is not offered.
    await expect(page.getByTestId(DATA_CHIP)).toHaveCount(0);
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
    await expect(page.getByTestId(DATA_CHIP)).toHaveCount(0);
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
    // The recommended rules the project does not have yet, in each language's words.
    const toAdd: number = RECOMMENDED_RULES - RECOMMENDED_RULES_ON;
    const addGerman: string = `${toAdd} empfohlene Regeln hinzufügen`;
    const addJapanese: string = `おすすめのルールを ${toAdd} 件追加`;
    /*
     * The fixture's frame is 64px narrower than production's (its page's
     * padding): 1088 here is production's 1024 beside the side menu.
     */
    for (const [lang, width, recommended, receiving, category] of [
      ["de", 1280, addGerman, "Empfangen", "Regelkategorie"],
      ["de", 1088, addGerman, "Empfangen", "Regelkategorie"],
      ["de", 1024, addGerman, "Empfangen", "Regelkategorie"],
      ["de", 390, addGerman, "Empfangen", "Regelkategorie"],
      ["ja", 1280, addJapanese, "受信中", "ルールのカテゴリ"],
      ["ja", 390, addJapanese, "受信中", "ルールのカテゴリ"],
    ] as Array<["de" | "ja", number, string, string, string]>) {
      await open(page, RULE_LIBRARY_PATH, { width, height: 900, lang });
      await expect(libraryRow(page, BRUTE_FORCE_RULE)).toBeVisible({
        timeout: 30000,
      });
      // The filter chips speak the language too.
      await expect(chipButton(page, CATEGORY_CHIP)).toHaveText(category);
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

  test("the side menu is nine sections of pages; the ones set up once are folded", async ({
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
      "settings",
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
      ["Settings", "false"],
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
      "Entity Risk",
      "Correlate",
      "Playbooks",
      "Approvals",
      "Playbook Runs",
    ]) {
      await expect(menuEntry(page, title)).toBeVisible();
    }
    // Folded: there, one click away, but not one more row on every visit.
    for (const title of [
      "Rule Library",
      "Settings",
      "Setup Guide",
      "Case Priorities",
      "Case Statuses",
    ]) {
      await expect(menuEntry(page, title)).toBeHidden();
    }
    await expect(menuEntry(page, "Monitors")).toHaveCount(0);

    // What waits for someone is counted beside the page that lists it.
    await expect(menuEntry(page, "Open Cases")).toContainText("6");
    await expect(menuEntry(page, "Assigned to Me")).toContainText("2");
    await expect(menuEntry(page, "Approvals")).toContainText("1");

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

  /*
   * An entry shares its row with its count. Beside the 224px menu a tablet
   * has (768 to 1023px), "Waiting for Approval" was cut to "Waiting for
   * Appr…" - and in German, French and Italian at every width - and so were
   * Assigned to Me's Dutch and Japanese names, and a case's Playbook Runs in
   * ten languages (six of them at every width). The page is Approvals now,
   * those two are Mijn zaken and 自分の担当, and a case's entry is
   * Playbooks: every entry that carries a count - the three of Security
   * Events' menu and the one of a case's - keeps its whole name, in English
   * and in the languages whose names ran longest, beside a tablet's menu and
   * a laptop's.
   *
   * So does every other entry a visit sees: the sections that start open
   * (Overview, Security Cases, Events, Playbooks, and a case's own).
   * Playbook Runs, under Approvals, was cut beside a tablet's menu in
   * German, Spanish, French, Italian and Portuguese, and filled its row to
   * the pixel in Dutch; it reads as each language's own word for runs
   * (Ausführungen, Ejecuciones, Exécutions, Esecuzioni, Execuções,
   * Uitvoeringen) under Playbooks. A folded section's entries show on their
   * own pages.
   */
  test("every entry in sight keeps its whole name, beside its count too, beside a tablet's menu and in the longest languages", async ({
    page,
  }: {
    page: Page;
  }) => {
    const views: Array<[number, OpenOptions["lang"] | undefined]> = [
      [800, undefined],
      [1023, undefined],
      [1440, undefined],
      [800, "de"],
      [1440, "de"],
      [800, "fr"],
      [1440, "fr"],
      [800, "it"],
      [800, "nl"],
      [800, "es"],
      [800, "pt"],
      [800, "ja"],
      [800, "fa"],
    ];

    // Each counted entry, by the page whose menu draws it, its address and its count.
    const counted: Array<[string, string, string]> = [
      [OVERVIEW_PATH, CASES_PATH, "6"],
      [OVERVIEW_PATH, MY_CASES_PATH, "2"],
      [OVERVIEW_PATH, RUNS_PATH, "1"],
      [SPRAY_CASE_PATH, `${SPRAY_CASE_PATH}/playbook-runs`, "1"],
    ];
    const cutShort: Array<string> = [];

    for (const [width, lang] of views) {
      for (const menuPage of [OVERVIEW_PATH, SPRAY_CASE_PATH]) {
        await open(page, menuPage, lang ? { width, lang } : { width });

        for (const [onPage, pathname, count] of counted) {
          if (onPage !== menuPage) {
            continue;
          }

          const entry: Locator = sideMenu(page).locator(
            `a[href="${pathname!}"]`,
          );
          await expect(entry).toContainText(count!, { timeout: 30000 });

          const title: Locator = entry
            .getByTestId("side-menu-item-title")
            .first();
          const cutBy: number = await title.evaluate(
            (element: Element): number => {
              return element.scrollWidth - element.clientWidth;
            },
          );

          if (cutBy > 0) {
            cutShort.push(
              `${(await title.textContent()) || ""} (${lang || "en"}, ${width}px): ${cutBy}px`,
            );
          }
        }

        // Every entry in sight: a folded section's are hidden.
        const cutInSight: Array<string> = await sideMenu(page)
          .locator('a [data-testid="side-menu-item-title"]')
          .evaluateAll((titles: Array<Element>): Array<string> => {
            return titles
              .filter((title: Element): boolean => {
                return (
                  getComputedStyle(title).visibility === "visible" &&
                  title.scrollWidth > title.clientWidth
                );
              })
              .map((title: Element): string => {
                return `${title.textContent || ""}: ${title.scrollWidth - title.clientWidth}px`;
              });
          });
        for (const title of cutInSight) {
          cutShort.push(`${title} (${lang || "en"}, ${width}px, in sight)`);
        }
      }
    }

    expect(cutShort).toEqual([]);

    await open(page, OVERVIEW_PATH, { width: 800, lang: "de" });
    await expect(
      sideMenu(page).locator(`a[href="${RUNS_PATH}"]`),
    ).toContainText("Genehmigungen", { timeout: 30000 });
    await expect(
      sideMenu(page).locator(`a[href="${ALL_RUNS_PATH}"]`),
    ).toHaveText("Ausführungen");
    await screenshot(page, "side-menu-tablet-de", { fullPage: false });
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

  /*
   * Entities ranked values by how many findings named them, beside Entity
   * Risk's scores: two lists that said "riskiest". It folded into Entity
   * Risk, which ranks by risk score, and its Look Up an Entity moved under
   * Entity Risk's list. A bookmark of the old page lands there.
   */
  test("the old Entities address opens Entity Risk, whose lookup sits under its list and opens any value in Correlate", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ENTITIES_PATH, { width: 1344 });
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(ENTITY_RISK_PATH);
    await expect(
      cardTitled(page, "Entity Risk").locator("table tbody tr").first(),
    ).toContainText("k.morgan@acme-commerce.example", { timeout: 30000 });
    // Entity Risk lit, and no Entities entry left in the menu.
    expect(await litEntries(page)).toEqual(["Entity Risk"]);
    await expect(menuEntry(page, "Entities")).toHaveCount(0);

    // The riskiest lead the page, the lookup under them.
    const ranking: Box = await boxOf(cardTitled(page, "Entity Risk"));
    const lookup: Box = await boxOf(cardTitled(page, "Look Up an Entity"));
    expect(ranking.y).toBeLessThan(lookup.y);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    // Look Up sits beside its box, at the box's own height.
    const box: Box = await boxOf(
      page.getByRole("textbox", { name: "Look Up an Entity" }),
    );
    const lookUp: Box = await boxOf(
      page.getByRole("button", { name: "Look Up", exact: true }),
    );
    expect(Math.abs(box.height - lookUp.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - lookUp.y)).toBeLessThanOrEqual(1);

    // Any value, a domain too, over 30 days of events.
    await page
      .getByRole("textbox", { name: "Look Up an Entity" })
      .fill("update-sync.bad-cdn.example");
    await page.getByRole("button", { name: "Look Up", exact: true }).click();
    const result: Locator = page.getByTestId("security-entity-lookup-result");
    await expect(result).toContainText("update-sync.bad-cdn.example");
    await expect(result).toContainText("4 findings");
    /*
     * Open in Correlate at the result's end, centred on what it sits beside:
     * it wrapped under the counts, a dialog footer's margin setting it 12px
     * in from the value it is about.
     */
    const resultBox: Box = await boxOf(result);
    const factsBox: Box = await boxOf(
      result.getByTestId("security-entity-lookup-facts"),
    );
    const correlateBox: Box = await boxOf(
      result.getByRole("button", { name: "Open in Correlate" }),
    );
    expect(
      Math.abs(
        resultBox.x + resultBox.width - (correlateBox.x + correlateBox.width),
      ),
    ).toBeLessThanOrEqual(17);
    expect(correlateBox.x).toBeGreaterThan(factsBox.x + factsBox.width);
    expect(
      Math.abs(
        correlateBox.y +
          correlateBox.height / 2 -
          (resultBox.y + resultBox.height / 2),
      ),
    ).toBeLessThanOrEqual(2);
    expect(
      (await fixture(page)).apiRequests.filter(
        (request: { url: string; body: unknown }): boolean => {
          return (
            new URL(request.url).pathname.endsWith(
              "/security-case/entity-activity",
            ) && JSON.stringify(request.body).includes('"hours":720')
          );
        },
      ),
    ).toHaveLength(1);
    await screenshot(page, "entity-risk-lookup-desktop");

    // Open in Correlate takes the value there, over the same 30 days.
    await result.getByRole("button", { name: "Open in Correlate" }).click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(`${PRODUCT}/correlate`);
    expect(new URL(page.url()).searchParams.get("observable")).toBe(
      "update-sync.bad-cdn.example",
    );
    expect(new URL(page.url()).searchParams.get("hours")).toBe("720");

    // A value no event names: said not seen, no counts of nothing, nothing to correlate.
    await open(page, ENTITY_RISK_PATH, { width: 1344 });
    await page
      .getByRole("textbox", { name: "Look Up an Entity" })
      .fill("never-seen-01.example", { timeout: 30000 });
    await page.getByRole("button", { name: "Look Up", exact: true }).click();
    const unseen: Locator = page.getByTestId("security-entity-lookup-result");
    await expect(unseen.getByTestId("security-entity-lookup-facts")).toHaveText(
      "Not seen in the last 30 days.",
    );
    await expect(unseen).not.toContainText("0 events");
    await expect(
      unseen.getByRole("button", { name: "Open in Correlate" }),
    ).toHaveCount(0);
    await screenshot(page, "entity-risk-lookup-not-seen");

    // On a phone: the lookup under the list's cards, nothing sideways.
    await open(page, ENTITY_RISK_PATH, { width: 390, height: 844 });
    await expect(
      page.getByRole("textbox", { name: "Look Up an Entity" }),
    ).toBeVisible({ timeout: 30000 });
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    // Under the value and its counts, as wide as the result's room.
    await page
      .getByRole("textbox", { name: "Look Up an Entity" })
      .fill("fin-ws-112");
    await page.getByRole("button", { name: "Look Up", exact: true }).click();
    const phoneResult: Locator = page.getByTestId(
      "security-entity-lookup-result",
    );
    const phoneFacts: Box = await boxOf(
      phoneResult.getByTestId("security-entity-lookup-facts"),
    );
    const phoneCorrelate: Box = await boxOf(
      phoneResult.getByRole("button", { name: "Open in Correlate" }),
    );
    expect(phoneCorrelate.y).toBeGreaterThan(phoneFacts.y + phoneFacts.height);
    expect(Math.abs(phoneCorrelate.x - phoneFacts.x)).toBeLessThanOrEqual(1);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "entity-risk-lookup-phone");
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

    // A project with rules opens on them: the how-it-works card is its title row.
    await expect(page.getByTestId("how-it-works-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByTestId("how-it-works-step")).toHaveCount(0);
    // A rule's button is Edit; Create Monitor, set up once, waits in its menu.
    const sequence: Locator = rowNamed(page, SEQUENCE_RULE);
    await expect(
      sequence.getByTestId("row-actions").getByRole("button", { name: "Edit" }),
    ).toBeVisible();
    await sequence.getByTestId("row-actions-more-button").click();
    await expect(
      page.getByRole("menuitem", { name: "Create Monitor" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "detection-rules-desktop", { fullPage: false });
  });

  test("Detection Rules fits a laptop's width: no row scrolls sideways, and Last Match says how long ago", async ({
    page,
  }: {
    page: Page;
  }) => {
    // The fixture is 64px narrower than production: 1344 here is a 1280 laptop.
    await open(page, DETECTION_RULES_PATH, { width: 1344 });
    await expect(rowNamed(page, SEQUENCE_RULE)).toBeVisible({
      timeout: 30000,
    });

    const headers: Array<string> = (
      await page.locator("table thead th").allTextContents()
    )
      .map((text: string): string => {
        return text.trim();
      })
      .filter(Boolean);
    expect(headers.join(" | ")).toContain("Last Match");
    // Whether a rule runs, its Status says: Last Evaluated waits in Customize Columns.
    expect(headers.join(" | ")).not.toContain("Last Evaluated");
    await expect(page.getByTestId("table-scroll").first()).toHaveAttribute(
      "data-overflowing",
      "false",
    );

    const matched: Locator = rowNamed(page, SEQUENCE_RULE).getByTestId(
      "relative-time-cell",
    );
    await expect(matched).toHaveText("4 hours ago");
    await expect(matched).toHaveAttribute("title", /2026/);
    await expect(
      rowNamed(page, FIRST_SEEN_RULE).getByTestId("relative-time-cell"),
    ).toHaveText("Never");
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
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
   * is one line, whole on hover; where a feed's indicators come from sits
   * under its name, not in a column of its own (#5246).
   */
  test("the feeds table shows what most people read: each row its name over its source, and one line beside them", async ({
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
      "Status",
      "Last Polled",
      "Last Match",
      "Last Poll Summary",
    ]) {
      expect(headers.join(" | ")).toContain(shown);
    }
    for (const hidden of [
      "Source",
      "Interval (Minutes)",
      "Last Error",
      "Last Evaluated",
      "Last Match Error",
    ]) {
      expect(headers).not.toContain(hidden);
    }

    // The source under the name, smaller and quieter: one cell.
    const misp: Locator = feeds
      .locator("tbody tr")
      .filter({ hasText: "Corporate MISP" });
    const source: Locator = misp.getByTestId("threat-intel-feed-source-cell");
    await expect(source).toHaveText("TAXII collection");
    const nameBox: Box = await boxOf(misp.getByTestId("security-list-name"));
    const sourceBox: Box = await boxOf(source);
    expect(sourceBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 1);
    expect(Math.abs(sourceBox.x - nameBox.x)).toBeLessThanOrEqual(1);
    expect(
      await source.evaluate((element: Element): string => {
        return window.getComputedStyle(element).fontSize;
      }),
    ).toBe("12px");

    // When it last polled and last matched, as how long ago.
    await expect(misp.getByTestId("relative-time-cell").first()).toHaveText(
      /ago$/,
    );

    /*
     * A row is its name over its source: every other value is one line
     * beside them, what a poll did cut short and whole on hover.
     */
    for (const row of await feeds.locator("tbody tr").all()) {
      const box: Box = await boxOf(row);
      expect(box.height).toBeLessThanOrEqual(100);
    }
    const summary: Locator = misp
      .locator("td")
      .nth(5)
      .locator("[data-table-value]");
    await expect(summary).toContainText("Fetched");
    expect((await boxOf(summary)).height).toBeLessThanOrEqual(26);

    // Every feed's button is Edit; a TAXII feed's Update Credentials and Create Monitor wait in its menu.
    await expect(
      misp.getByTestId("row-actions").getByRole("button", { name: "Edit" }),
    ).toBeVisible();
    await misp.getByTestId("row-actions-more-button").click();
    await expect(
      page.getByRole("menuitem", { name: "Update Credentials" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Create Monitor" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  /*
   * Threat Intel's two tables ran past their cards at a 1280 laptop
   * (#5246): the feeds' Last Match and Last Poll Summary under the row's
   * buttons, the indicators' Confidence and Valid Until out of sight. The
   * times read as how long ago, a feed's source sits under its name, and
   * both fit - in English and in every language whose words are not the
   * longest (Dutch's feeds and Russian's still give way only so far). The
   * fixture is 64px narrower than production: 1344 here is a 1280 laptop.
   */
  test("Threat Intel's feeds and indicators fit their cards at a 1280 laptop, nothing sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const lang of [
      undefined,
      "de",
      "fr",
      "es",
      "it",
      "pt",
      "ja",
      "fa",
    ] as Array<OpenOptions["lang"]>) {
      await open(page, THREAT_INTEL_PATH, {
        width: 1344,
        ...(lang ? { lang } : {}),
      });
      const scrollers: Locator = page.getByTestId("table-scroll");
      await expect(scrollers).toHaveCount(2, { timeout: 30000 });
      await expect(rowNamed(page, "Corporate MISP").first()).toBeVisible({
        timeout: 30000,
      });
      await expect(rowNamed(page, "update-check.example").first()).toBeVisible({
        timeout: 30000,
      });

      for (const scroller of await scrollers.all()) {
        await expect(scroller, `${lang || "en"}`).toHaveAttribute(
          "data-overflowing",
          "false",
        );
        expect(
          await overflowOf(scroller),
          `${lang || "en"}: a table scrolls sideways`,
        ).toBeLessThanOrEqual(1);
      }
      expect(await pageOverflow(page), `${lang || "en"}`).toBeLessThanOrEqual(
        1,
      );
    }

    // English, as a laptop shows it: Valid Until says how far off.
    await open(page, THREAT_INTEL_PATH, { width: 1344 });
    const indicators: Locator = cardTitled(page, "Indicators");
    await expect(
      rowNamed(page, "update-check.example")
        .first()
        .getByTestId("relative-time-cell"),
    ).toHaveText(/^in /, { timeout: 30000 });
    await screenshot(page, "threat-intel-fits-1280", { fullPage: true });
    expect(await overflowOf(indicators.getByTestId("table-scroll"))).toBe(0);
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

    // The card leads the case's Overview, under its figures, above ATT&CK.
    const cardBox: Box = await boxOf(card);
    const figures: Box = await boxOf(
      page.getByRole("group", { name: "Case figures" }),
    );
    const attack: Box = await boxOf(page.getByText("MITRE ATT&CK").first());
    expect(figures.y).toBeLessThan(cardBox.y);
    expect(cardBox.y).toBeLessThan(attack.y);

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
    const critical: string = (await fixture(page)).ids.priorities[
      "Critical"
    ] as string;
    await expect
      .poll(async (): Promise<unknown> => {
        const value: unknown = (
          (await fixture(page)) as unknown as {
            updates: Array<{
              modelName: string;
              data: Record<string, unknown>;
            }>;
          }
        ).updates.find(
          (update: { modelName: string; data: Record<string, unknown> }) => {
            return (
              update.modelName === "SecurityCase" &&
              "securityCasePriorityId" in update.data
            );
          },
        )?.data["securityCasePriorityId"];
        return value === undefined ? undefined : String(value);
      })
      .toBe(critical);

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
    await expect(page.getByText("Time to Contain")).toBeVisible({
      timeout: 30000,
    });
    await expect(aiCard(page)).toHaveCount(0);
    // The ATT&CK tactics still follow the figures.
    await expect(page.getByText("TA0006 Credential Access")).toBeVisible();
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
    await open(page, `${SPRAY_CASE_PATH}/timeline`, { width: 1280 });
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

/*
 * ---------------------------------------------------------------------------
 * The project's case priorities and statuses: Security Events > Settings,
 * and the case pages that read them
 * ---------------------------------------------------------------------------
 */
test.describe("the project's case priorities and statuses", () => {
  // The project's own (?values=custom): Triage, a retired Escalated, Eradicating, Closed - Duplicate.
  const CUSTOM_STATUSES: Array<string> = [
    "New",
    "Triage",
    "Investigating",
    "Contained",
    "Eradicating",
    "Closed",
    "Closed - Duplicate",
  ];

  // The names the settings table shows, top to bottom, without the Built-in tag.
  async function valueNames(page: Page): Promise<Array<string>> {
    return page
      .getByTestId("state-settings-name")
      .evaluateAll((cells: Array<Element>): Array<string> => {
        return cells.map((cell: Element): string => {
          return (cell.firstElementChild?.textContent || "").trim();
        });
      });
  }

  // A column of the settings table, row by row ("" where a row has no cell of it).
  async function cellTexts(page: Page, testId: string): Promise<Array<string>> {
    return page
      .locator("table")
      .first()
      .locator("tbody tr")
      .evaluateAll((rows: Array<Element>, id: string): Array<string> => {
        return rows.map((row: Element): string => {
          return (
            row.querySelector(`[data-testid="${id}"]`)?.textContent || ""
          ).trim();
        });
      }, testId);
  }

  // Which rows carry the Built-in tag, top to bottom.
  async function builtInRows(page: Page): Promise<Array<boolean>> {
    return page
      .locator("table")
      .first()
      .locator("tbody tr")
      .evaluateAll((rows: Array<Element>): Array<boolean> => {
        return rows.map((row: Element): boolean => {
          return Boolean(
            row.querySelector('[data-testid="state-settings-built-in"]'),
          );
        });
      });
  }

  function statusSteps(page: Page): Locator {
    return page.getByTestId("security-case-status-steps");
  }

  // The case's status steps, by name, in order.
  async function stepNames(page: Page): Promise<Array<string>> {
    return statusSteps(page)
      .locator("button")
      .evaluateAll((buttons: Array<Element>): Array<string> => {
        return buttons.map((button: Element): string => {
          return (button.lastElementChild?.textContent || "").trim();
        });
      });
  }

  // The steps whose name is cut short, or that run past the page's edge.
  async function cutSteps(page: Page): Promise<Array<string>> {
    return statusSteps(page)
      .locator("button")
      .evaluateAll((buttons: Array<Element>): Array<string> => {
        const right: number = document.documentElement.clientWidth;
        return buttons
          .filter((button: Element): boolean => {
            const name: Element | null = button.lastElementChild;
            return (
              !name ||
              name.scrollWidth > name.clientWidth + 1 ||
              button.getBoundingClientRect().right > right + 1
            );
          })
          .map((button: Element): string => {
            return (button.textContent || "").trim();
          });
      });
  }

  test("Settings holds the project's case statuses: in order, what a case in each counts as, the built-in ones tagged, the retired one folded away", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASE_STATUSES_PATH, { values: "custom", width: 1280 });
    await expect(page.getByTestId("state-settings-name").first()).toBeVisible({
      timeout: 30000,
    });

    // Settings opens on its page, its entry lit, and the trail names it.
    await expect(menuSection(page, "Settings")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(await litEntries(page)).toEqual(["Case Statuses"]);
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Settings",
      "Case Statuses",
    ]);

    expect(await valueNames(page)).toEqual(CUSTOM_STATUSES);
    // Where a status sits is what a case in it counts as.
    expect(await cellTexts(page, "state-settings-counts-as")).toEqual([
      "Not acknowledged",
      "Not acknowledged",
      "Acknowledged",
      "Contained",
      "Contained",
      "Closed",
      "Closed",
    ]);
    // The four OneUptime reads the meaning of are built in; the project's own are not.
    expect(await builtInRows(page)).toEqual([
      true,
      false,
      true,
      true,
      false,
      true,
      false,
    ]);

    // Escalated, retired, waits in the folded section under the table.
    const archived: Locator = page.getByTestId("archived-values-section");
    await expect(archived).toContainText("Archived Case Statuses");
    await expect(page.locator("table").first()).not.toContainText("Escalated");

    // The page names one value as its title does: Create Case Status, case statuses.
    await expect(page.getByTestId("card-button").first()).toHaveText(
      "Create Case Status",
    );
    await expect(page.locator("body")).toContainText(
      "Showing 1-7 of 7 case statuses",
    );

    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "case-statuses-1280-light");
  });

  test("Settings holds the project's case priorities: most urgent first, the detection severity each opens cases at, the built-in ones tagged", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASE_PRIORITIES_PATH, { values: "custom", width: 1280 });
    await expect(page.getByTestId("state-settings-name").first()).toBeVisible({
      timeout: 30000,
    });
    expect(await litEntries(page)).toEqual(["Case Priorities"]);
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Settings",
      "Case Priorities",
    ]);

    // The project's own Emergency above the five a detection opens a case at.
    expect(await valueNames(page)).toEqual([
      "Emergency",
      "Critical",
      "High",
      "Medium",
      "Low",
      "Informational",
    ]);
    expect(await cellTexts(page, "state-settings-built-in-column")).toEqual([
      "None",
      "Critical",
      "High",
      "Medium or unknown",
      "Low",
      "Informational",
    ]);
    // The column says what it holds; a priority of the project's own has none, drawn muted.
    await expect(page.locator("table").first().locator("thead")).toContainText(
      "Detection severity",
    );
    const noneCell: Locator = page
      .getByTestId("state-settings-built-in-column")
      .first();
    const criticalCell: Locator = page
      .getByTestId("state-settings-built-in-column")
      .nth(1);
    expect(
      await noneCell.evaluate((cell: Element): string => {
        return getComputedStyle(cell).color;
      }),
    ).not.toBe(
      await criticalCell.evaluate((cell: Element): string => {
        return getComputedStyle(cell).color;
      }),
    );
    // The page names one value as its title does: Create Case Priority.
    await expect(page.getByTestId("card-button").first()).toHaveText(
      "Create Case Priority",
    );
    expect(await builtInRows(page)).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
    // Nothing is archived: no folded section.
    await expect(page.getByTestId("archived-values-section")).toHaveCount(0);

    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "case-priorities-1280-light");
  });

  test("a new project's are the built-in ones, every one tagged", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASE_STATUSES_PATH, { width: 1280 });
    await expect(page.getByTestId("state-settings-name").first()).toBeVisible({
      timeout: 30000,
    });
    expect(await valueNames(page)).toEqual([
      "New",
      "Investigating",
      "Contained",
      "Closed",
    ]);
    expect(await builtInRows(page)).toEqual([true, true, true, true]);
    await expect(page.getByTestId("archived-values-section")).toHaveCount(0);

    await open(page, CASE_PRIORITIES_PATH, { width: 1280 });
    await expect(page.getByTestId("state-settings-name").first()).toBeVisible({
      timeout: 30000,
    });
    expect(await valueNames(page)).toEqual([
      "Critical",
      "High",
      "Medium",
      "Low",
      "Informational",
    ]);
    expect(await builtInRows(page)).toEqual([true, true, true, true, true]);
  });

  test("both pages read in the reader's language: their own words, and the descriptions a new project's values start with", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASE_STATUSES_PATH, { width: 1280, lang: "de" });
    await expect(page.getByTestId("state-settings-name").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByTestId("card-button").first()).toHaveText(
      "Fallstatus erstellen",
    );
    // The built-in statuses' descriptions are OneUptime's words, so they are German too.
    expect(await cellTexts(page, "state-settings-description")).toEqual([
      "Noch hat sich niemand den Fall angesehen.",
      "Jemand findet heraus, was passiert ist.",
      "Die Bedrohung kann keinen Schaden mehr anrichten; die Bereinigung steht noch aus.",
      "Erledigt, mit einer Bewertung, was es war.",
    ]);

    await open(page, CASE_PRIORITIES_PATH, {
      width: 1280,
      lang: "de",
      values: "custom",
    });
    await expect(page.getByTestId("state-settings-name").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByTestId("card-button").first()).toHaveText(
      "Fallpriorität erstellen",
    );
    await expect(page.locator("table").first().locator("thead")).toContainText(
      "Schweregrad der Erkennung",
    );
    // Low reads Niedrig, the word every German Dashboard page draws for it.
    expect(await cellTexts(page, "state-settings-built-in-column")).toEqual([
      "Keine",
      "Kritisch",
      "Hoch",
      "Mittel oder unbekannt",
      "Niedrig",
      "Hinweise",
    ]);
  });

  test("both pages read in both themes, on a laptop and a phone, every name whole and nothing scrolling sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [pathname, name, first] of [
      [CASE_STATUSES_PATH, "case-statuses", "Closed - Duplicate"],
      [CASE_PRIORITIES_PATH, "case-priorities", "Emergency"],
    ] as Array<[string, string, string]>) {
      for (const [width, theme] of [
        [1280, "dark"],
        [390, undefined],
        [390, "dark"],
      ] as Array<[number, "dark" | undefined]>) {
        await open(page, pathname, {
          values: "custom",
          width,
          height: width === 390 ? 844 : 1000,
          theme,
        });
        await expect(
          page.getByText(first, { exact: true }).first(),
        ).toBeVisible({ timeout: 30000 });
        expect(
          await pageOverflow(page),
          `${name} at ${width} ${theme || "light"}`,
        ).toBeLessThanOrEqual(1);
        // Each name on screen, none cut short.
        const cut: Array<string> = await page
          .getByTestId("state-settings-name")
          .evaluateAll((cells: Array<Element>): Array<string> => {
            const right: number = document.documentElement.clientWidth;
            return cells
              .filter((cell: Element): boolean => {
                const pill: Element | null = cell.firstElementChild;
                return (
                  !pill ||
                  pill.scrollWidth > pill.clientWidth + 1 ||
                  cell.getBoundingClientRect().right > right + 1
                );
              })
              .map((cell: Element): string => {
                return (cell.textContent || "").trim();
              });
          });
        expect(cut, `${name} at ${width}`).toEqual([]);
        await screenshot(page, `${name}-${width}-${theme || "light"}`);
      }
    }
  });

  test("a case's status steps are the project's statuses, the retired one left out, each whole at every size and in both themes", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [width, theme] of [
      [1280, undefined],
      [1280, "dark"],
      [390, undefined],
      [390, "dark"],
    ] as Array<[number, "dark" | undefined]>) {
      await open(page, SPRAY_CASE_PATH, {
        values: "custom",
        width,
        height: width === 390 ? 844 : 1000,
        theme,
      });
      await expect(statusSteps(page)).toBeVisible({ timeout: 30000 });

      expect(await stepNames(page)).toEqual(CUSTOM_STATUSES);
      // The spray case is past containment, in the project's own Eradicating.
      await expect(
        statusSteps(page).locator('[aria-current="step"]'),
      ).toContainText("Eradicating");
      expect(await cutSteps(page), `steps at ${width}`).toEqual([]);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

      await statusSteps(page).scrollIntoViewIfNeeded();
      await screenshot(
        page,
        `case-status-steps-custom-${width}-${theme || "light"}`,
        { fullPage: false },
      );
    }

    // A new project's four, for comparison.
    await open(page, SPRAY_CASE_PATH, { width: 390, height: 844 });
    await expect(statusSteps(page)).toBeVisible({ timeout: 30000 });
    expect(await stepNames(page)).toEqual([
      "New",
      "Investigating",
      "Contained",
      "Closed",
    ]);
  });

  test("a case still in a retired status keeps it, in its place among the steps", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, TRAVEL_CASE_PATH, { values: "custom", width: 1280 });
    await expect(statusSteps(page)).toBeVisible({ timeout: 30000 });

    expect(await stepNames(page)).toEqual([
      "New",
      "Triage",
      "Investigating",
      "Escalated",
      "Contained",
      "Eradicating",
      "Closed",
      "Closed - Duplicate",
    ]);
    await expect(
      statusSteps(page).locator('[aria-current="step"]'),
    ).toContainText("Escalated");
    expect(await cutSteps(page)).toEqual([]);
  });

  test("moving a case into the project's own closing status asks for the verdict first, and keeps that status", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SPRAY_CASE_PATH, { values: "custom", width: 1280 });
    await expect(statusSteps(page)).toBeVisible({ timeout: 30000 });

    await statusSteps(page)
      .locator("button")
      .filter({ hasText: "Closed - Duplicate" })
      .click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toContainText("Close Case");
    // Where the case goes comes first, before OneUptime AI's read of it.
    await expect(dialog).toContainText(
      "The case moves to Closed - Duplicate. OneUptime AI read this case as Likely Malicious. Pick what you found.",
    );
    await dialog
      .getByRole("button", { name: "Close Case", exact: true })
      .click();

    const duplicate: string = (await fixture(page)).ids.statuses[
      "Closed - Duplicate"
    ] as string;
    await expect
      .poll(async (): Promise<unknown> => {
        const update: { data: Record<string, unknown> } | undefined = (
          (await fixture(page)) as unknown as {
            updates: Array<{
              modelName: string;
              data: Record<string, unknown>;
            }>;
          }
        ).updates.find(
          (each: { modelName: string; data: Record<string, unknown> }) => {
            return (
              each.modelName === "SecurityCase" &&
              "securityCaseStatusId" in each.data
            );
          },
        );
        return update
          ? [
              String(update.data["securityCaseStatusId"]),
              update.data["verdict"],
            ]
          : undefined;
      })
      .toEqual([duplicate, expect.any(String)]);
  });

  test("the queue and the overview name the cases' statuses as the project does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CASES_PATH, { values: "custom", width: 1280 });
    const spray: Locator = page
      .locator("table tbody tr")
      .filter({ hasText: "CASE-142" });
    await expect(spray).toContainText("Eradicating", { timeout: 30000 });
    await expect(
      page.locator("table tbody tr").filter({ hasText: "CASE-138" }),
    ).toContainText("Triage");
    await expect(
      page.locator("table tbody tr").filter({ hasText: "CASE-139" }),
    ).toContainText("Escalated");

    // The overview's open cases by where each stands: the project's own among them.
    await open(page, OVERVIEW_PATH, { values: "custom", width: 1280 });
    await expect(page.getByText("Riskiest Entities")).toBeVisible({
      timeout: 30000,
    });
    for (const status of ["Eradicating", "Triage", "Escalated"]) {
      await expect(
        page.getByText(status, { exact: true }).first(),
      ).toBeVisible();
    }
    await screenshot(page, "overview-custom-statuses");
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
    ["case", SPRAY_CASE_PATH, "Time to Contain"],
    ["entity risk", ENTITY_RISK_PATH, "k.morgan@acme-commerce.example"],
    ["detection rules", DETECTION_RULES_PATH, SEQUENCE_RULE],
    ["rule library", RULE_LIBRARY_PATH, "Brute force from one IP address"],
    ["threat intel", THREAT_INTEL_PATH, "Corporate MISP"],
    ["attack coverage", ATTACK_COVERAGE_PATH, "2 / 227"],
    ["playbooks", PLAYBOOKS_PATH, "Enrich New Cases"],
    ["playbook", CONTAIN_PLAYBOOK_PATH, "Latest Runs"],
    ["runs", RUNS_PATH, "CASE-142"],
    ["all runs", ALL_RUNS_PATH, "Stopped at step 2"],
    [
      "protected entities",
      PROTECTED_ENTITIES_PATH,
      "breakglass@acme-commerce.example",
    ],
    ["ai settings", AI_SETTINGS_PATH, "Triage new cases"],
    ["case priorities", CASE_PRIORITIES_PATH, "Informational"],
    ["case statuses", CASE_STATUSES_PATH, "Investigating"],
  ];

  /*
   * A case's pages the widest things are on, at the widths where the side
   * menu leaves them least room; every page of a case is read at 1280 and
   * 390 with the case's own tests (a case, above).
   */
  const CASE_PAGES_BESIDE_THE_MENU: ReadonlyArray<[string, string, string]> = [
    ["case detections", `${SPRAY_CASE_PATH}/detections`, "31 times"],
    [
      "case entities",
      `${SPRAY_CASE_PATH}/entities`,
      "a.ng@acme-commerce.example",
    ],
    [
      "case connected signals",
      `${PRODUCT}/cases/20000000-0000-4000-8000-000000000141/connected-signals`,
      "Named build-runner-07, the name it reports.",
    ],
    [
      "case playbook runs",
      `${SPRAY_CASE_PATH}/playbook-runs`,
      "Started on its own: Case Opened",
    ],
  ];

  for (const width of [1280, 1024, 768, 390]) {
    test(`at ${width}, no page scrolls sideways`, async ({
      page,
    }: {
      page: Page;
    }) => {
      for (const [name, pathname, text] of [
        ...PAGES,
        ...(width === 1024 || width === 768 ? CASE_PAGES_BESIDE_THE_MENU : []),
      ]) {
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

/*
 * ---------------------------------------------------------------------------
 * Riskiest Entities: the top of Entity Risk
 * ---------------------------------------------------------------------------
 *
 * The Overview's Riskiest Entities ranked values by how many findings named
 * them, beside Entity Risk's scores - two lists that said "riskiest" and
 * disagreed: the address a password spray came from led the Overview, while
 * the CFO's account three different rules flagged led Entity Risk. The card
 * is the top of Entity Risk's list now, in its order, by its scores, read
 * with the overview: each entity opens its own page, and the rest of the
 * list is a click away.
 */
test.describe("the Overview's Riskiest Entities", () => {
  /*
   * The fixture's risk rows, riskiest first: Entity Risk's own order. Each
   * is its value, its score, its kind (under the value, as Entity Risk's
   * list has it) and its level (the pill beside the score, as Entity
   * Risk's Risk column has it).
   */
  const RISKIEST: ReadonlyArray<[string, string, string, string]> = [
    ["k.morgan@acme-commerce.example", "200", "User", "Critical"],
    ["203.0.113.47", "125", "IP Address", "High"],
    ["fin-ws-112", "113", "Host", "High"],
    ["r.alvarez@acme-commerce.example", "75", "User", "Medium"],
    ["198.51.100.23", "75", "IP Address", "Medium"],
    ["web-03", "50", "Host", "Medium"],
    ["a.ng@acme-commerce.example", "50", "User", "Medium"],
    ["192.0.2.15", "50", "IP Address", "Medium"],
  ];

  // A value with a letter written left to right (an account, a host).
  const LATIN_LETTER: RegExp = /[a-z]/i;

  function riskiestCard(page: Page): Locator {
    return cardTitled(page, "Riskiest Entities");
  }

  async function rowsOf(
    page: Page,
  ): Promise<Array<[string, string, string, string]>> {
    return riskiestCard(page)
      .getByRole("listitem")
      .evaluateAll(
        (items: Array<Element>): Array<[string, string, string, string]> => {
          return items.map(
            (item: Element): [string, string, string, string] => {
              return [
                (item.querySelector("a")?.textContent || "").trim(),
                (item.querySelector(".tabular-nums")?.textContent || "").trim(),
                (
                  item.querySelector('[class*="text-[11px]"]')?.textContent ||
                  ""
                ).trim(),
                (
                  item.querySelector('[data-testid="entity-risk-level"]')
                    ?.textContent || ""
                ).trim(),
              ];
            },
          );
        },
      );
  }

  test("ranks as Entity Risk does: the same entities, the same order, the same scores and levels", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { width: 1280 });
    await expect(riskiestCard(page)).toContainText(
      "as Entity Risk ranks them",
      { timeout: 30000 },
    );

    expect(await rowsOf(page)).toEqual(RISKIEST);
    // Eight of the nine with risk: the ninth is a click away.
    const all: Locator = riskiestCard(page).getByTestId(
      "security-overview-riskiest-entities-all",
    );
    await expect(all).toHaveText("View all 9 entities");
    // No count of findings is left on the card.
    await expect(riskiestCard(page)).not.toContainText("worst");
    // Each bar has the threshold marked halfway, as Entity Risk's meter has.
    await expect(
      riskiestCard(page).getByTestId("ranked-bar-threshold"),
    ).toHaveCount(RISKIEST.length);
    await screenshot(page, "overview-riskiest-entities");

    // The rest of the list: Entity Risk, its first rows the card's.
    await all.click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(ENTITY_RISK_PATH);
    const rows: Locator = cardTitled(page, "Entity Risk").locator(
      "table tbody tr",
    );
    await expect(rows.first()).toContainText(RISKIEST[0]![0], {
      timeout: 30000,
    });
    for (const [index, [value]] of RISKIEST.entries()) {
      await expect(rows.nth(index)).toContainText(value);
    }
  });

  test("an entity opens its own page, with its kind", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { width: 1280 });
    await riskiestCard(page)
      .getByRole("link", { name: "203.0.113.47" })
      .click({ timeout: 30000 });

    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(`${ENTITY_RISK_PATH}/entity`);
    expect(new URL(page.url()).searchParams.get("value")).toBe("203.0.113.47");
    expect(new URL(page.url()).searchParams.get("type")).toBe("IP Address");
    await expect(page.getByTestId("entity-risk-header")).toContainText(
      "203.0.113.47",
      { timeout: 30000 },
    );
    expect(await litEntries(page)).toEqual(["Entity Risk"]);
  });

  test("levels follow the project's own threshold", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { width: 1280, threshold: 250 });
    await expect(riskiestCard(page)).toContainText(
      "k.morgan@acme-commerce.example",
      { timeout: 30000 },
    );

    expect(
      (await rowsOf(page))
        .slice(0, 3)
        .map((row: [string, string, string, string]): string => {
          return row[3];
        }),
    ).toEqual(["Medium", "Medium", "Low"]);
  });

  /*
   * A row opens its entity from anywhere on it - its kind, its score, its
   * bar - not from its value's few letters alone; and every row's score
   * ends its line, whatever its level's word, as every list's count does.
   */
  test("the whole row opens the entity, and every score ends its line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { width: 1280 });
    const rows: Locator = riskiestCard(page).getByRole("listitem");
    await expect(rows.first()).toContainText(RISKIEST[0]![0], {
      timeout: 30000,
    });

    const scoreEnds: Array<number> = [];
    for (const row of await rows.all()) {
      const score: Box = await boxOf(row.locator(".tabular-nums"));
      scoreEnds.push(Math.round(score.x + score.width));
    }
    expect(new Set(scoreEnds).size).toBe(1);
    // The level's pill before the score, on its line.
    const first: Locator = rows.first();
    const pill: Box = await boxOf(first.getByTestId("entity-risk-level"));
    const score: Box = await boxOf(first.locator(".tabular-nums"));
    expect(pill.x + pill.width).toBeLessThanOrEqual(score.x);

    /*
     * Its kind, its score and its bar are the row's link, as its value is:
     * what is under the pointer there is the link.
     */
    const hostRow: Locator = rows.nth(2);
    await hostRow.scrollIntoViewIfNeeded();
    expect(
      await hostRow.evaluate((row: Element): Array<string> => {
        const link: Element = row.querySelector("a") as Element;
        const parts: Array<Element> = [
          row.querySelector('[class*="text-[11px]"]') as Element,
          row.querySelector(".tabular-nums") as Element,
          row.querySelector('[data-testid="ranked-bar-fill"]') as Element,
        ];

        return parts.map((part: Element): string => {
          const box: DOMRect = part.getBoundingClientRect();
          const under: Element | null = document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          );

          return under === link || link.contains(under) ? "link" : "not";
        });
      }),
    ).toEqual(["link", "link", "link"]);

    // A click on the bar of fin-ws-112's row - not its value - opens its page.
    const bar: Box = await boxOf(
      hostRow.getByTestId("ranked-bar-fill").locator(".."),
    );
    await page.mouse.click(bar.x + bar.width * 0.8, bar.y + bar.height / 2);
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(`${ENTITY_RISK_PATH}/entity`);
    expect(new URL(page.url()).searchParams.get("value")).toBe("fin-ws-112");
  });

  /*
   * Rules that raise alerts rather than cases still add risk: a month with
   * no case and no detection can have entities on Entity Risk's list. The
   * Overview shows them, alone - the figures, the charts and the other
   * lists would each say they had nothing - as wide as its row.
   */
  test("a month whose only news is risk shows Riskiest Entities alone, under All quiet", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { width: 1280, quiet: "risk" });
    await expect(riskiestCard(page)).toContainText(RISKIEST[0]![0], {
      timeout: 30000,
    });
    await expect(
      band(page).getByRole("heading", { name: "All quiet" }),
    ).toBeVisible();

    for (const title of [
      "Open Cases",
      "Cases Opened",
      "Detections",
      "Top Detections",
      "MITRE ATT&CK Tactics",
      "Verdicts",
    ]) {
      await expect(cardTitled(page, title)).toHaveCount(0);
    }
    await expect(
      page.getByRole("group", { name: "Security operations figures" }),
    ).toHaveCount(0);
    // Alone in its row, so as wide as it: as wide as the card above.
    const card: Box = await boxOf(riskiestCard(page));
    const status: Box = await boxOf(
      page.getByTestId("security-overview-status"),
    );
    expect(Math.abs(card.width - status.width)).toBeLessThanOrEqual(1);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "overview-riskiest-entities-risk-only");
  });

  test("when the card shows every entity Entity Risk lists, its way on is Entity Risk itself", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { width: 1280, ranked: "short" });
    const way: Locator = riskiestCard(page).getByTestId(
      "security-overview-riskiest-entities-all",
    );
    await expect(way).toHaveText("Open Entity Risk", { timeout: 30000 });
    await expect(riskiestCard(page).getByRole("listitem")).toHaveCount(2);

    await way.click();
    await expect
      .poll(() => {
        return pathnameOf(page);
      })
      .toBe(ENTITY_RISK_PATH);
  });

  test("risk that could not be read says so, with Try again, and the rest of the Overview is drawn", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, OVERVIEW_PATH, { width: 1280, riskiest: "fail" });
    const failed: Locator = riskiestCard(page).getByTestId(
      "security-overview-riskiest-entities-error",
    );

    await expect(failed).toContainText(
      "We could not load the riskiest entities.",
      { timeout: 30000 },
    );
    await expect(riskiestCard(page)).not.toContainText(
      "No user, host or address has any risk yet.",
    );
    await expect(cardTitled(page, "Open Cases")).toContainText("Critical");
    await expect(
      failed.getByTestId("security-overview-riskiest-entities-try-again"),
    ).toBeEnabled();
    await screenshot(page, "overview-riskiest-entities-failed");
  });

  test("dark, and on a phone", async ({ page }: { page: Page }) => {
    await open(page, OVERVIEW_PATH, { width: 1280, theme: "dark" });
    await expect(riskiestCard(page)).toContainText(
      "k.morgan@acme-commerce.example",
      { timeout: 30000 },
    );
    await screenshot(page, "overview-riskiest-entities-dark");

    await open(page, OVERVIEW_PATH, { width: 390, height: 844 });
    await expect(riskiestCard(page)).toContainText(
      "k.morgan@acme-commerce.example",
      { timeout: 30000 },
    );
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    // A long value is cut short to its line, never wider than the card.
    const card: Box = await boxOf(riskiestCard(page));
    for (const link of await riskiestCard(page).getByRole("link").all()) {
      const linkBox: Box = await boxOf(link);
      expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(
        card.x + card.width,
      );
    }
    await screenshot(page, "overview-riskiest-entities-phone");
  });

  /*
   * An entity's value is something someone's systems wrote: on a Persian
   * page (#5312) it reads the way it is written, in an isolate. The isolate
   * is as wide as the value, so a short one ("web-03") starts where its
   * line does, as a long one does - a block as wide as the kind and level
   * under it set it off the line's start - and a long one is cut short at
   * its own end, where it stops reading, never at its start.
   */
  for (const width of [1280, 390]) {
    test(`in Persian at ${width}, each value reads as written from where its line starts, a long one cut at its own end`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, OVERVIEW_PATH, {
        width,
        height: width === 390 ? 844 : 1000,
        lang: "fa",
      });
      const list: Locator = page.getByTestId(
        "security-overview-riskiest-entities",
      );
      await expect(list).toContainText("k.morgan@acme-commerce.example", {
        timeout: 30000,
      });
      expect(
        await page.evaluate((): string => {
          return document.documentElement.dir;
        }),
      ).toBe("rtl");

      const values: Array<{
        text: string;
        tag: string;
        dir: string;
        direction: string;
        startGap: number;
        isCut: boolean;
        textOverflow: string;
        scrollLeft: number;
      }> = await list.getByRole("listitem").evaluateAll(
        (
          items: Array<Element>,
        ): Array<{
          text: string;
          tag: string;
          dir: string;
          direction: string;
          startGap: number;
          isCut: boolean;
          textOverflow: string;
          scrollLeft: number;
        }> => {
          return items.map((item: Element) => {
            const value: HTMLElement = item.querySelector(
              "a bdi",
            ) as HTMLElement;
            const line: HTMLElement = value.parentElement as HTMLElement;
            const style: CSSStyleDeclaration = getComputedStyle(value);

            return {
              text: value.textContent || "",
              tag: value.tagName,
              dir: value.getAttribute("dir") || "",
              direction: style.direction,
              // A right-to-left line starts at its right edge.
              startGap: Math.abs(
                line.getBoundingClientRect().right -
                  value.getBoundingClientRect().right,
              ),
              isCut: value.scrollWidth > value.clientWidth + 1,
              textOverflow: style.textOverflow,
              scrollLeft: value.scrollLeft,
            };
          });
        },
      );

      expect(
        values.map((value: { text: string }): string => {
          return value.text;
        }),
      ).toEqual(
        RISKIEST.map((row: [string, string, string, string]): string => {
          return row[0];
        }),
      );

      for (const value of values) {
        expect([value.text, value.tag]).toEqual([value.text, "BDI"]);
        /*
         * Letters written left to right: the value reads so, on any page.
         * An address has no letters: it is left to the isolate's own
         * reading (IsolatedText), never forced either way.
         */
        if (LATIN_LETTER.test(value.text)) {
          expect([value.text, value.dir, value.direction]).toEqual([
            value.text,
            "ltr",
            "ltr",
          ]);
        } else {
          expect([value.text, value.dir]).toEqual([value.text, ""]);
        }
        expect([value.text, value.startGap <= 1]).toEqual([value.text, true]);
        // Cut with an ellipsis, from its first character on: at its own end.
        expect([value.text, value.textOverflow, value.scrollLeft]).toEqual([
          value.text,
          "ellipsis",
          0,
        ]);
      }

      // On a phone, the longest are cut short; at 1280, every value is whole.
      const cut: Array<string> = values
        .filter((value: { isCut: boolean }): boolean => {
          return value.isCut;
        })
        .map((value: { text: string }): string => {
          return value.text;
        });
      if (width === 390) {
        expect(cut).toContain("k.morgan@acme-commerce.example");
        expect(cut).not.toContain("web-03");
      } else {
        expect(cut).toEqual([]);
      }
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
      await screenshot(page, `overview-riskiest-entities-fa-${width}`);
    });
  }
});
