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
 * Entity risk on the Security Operations fixture's synthetic month
 * (Fixture/EntityRiskFixture.js lays each entity's risk out with the
 * server's own arithmetic): Security Events > Entity Risk, an entity's page,
 * Settings > Risk Scoring, a case's Entities, a case Entity Risk opened and
 * a detection rule's Risk Points. What the unit tests cannot see: that the
 * pages are reached from the side menu and named in their trails, that
 * every level and the guide follow the project's own threshold, that Reset
 * Risk and the settings write what they say, and that each page fits the
 * screen at 1280 and 390 in both themes.
 *
 * Every test pins the clock and fences the network, as
 * SecurityOperations.spec.ts does: afterEach fails a test on an uncaught
 * page error, on any request that left the fixture server and on anything
 * the fixture does not model.
 */

const PORT: string = process.env["SECURITY_OPERATIONS_FIXTURE_PORT"] || "4234";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");

const PRODUCT: string = `/dashboard/${PROJECT_ID}/security-events`;
const ENTITY_RISK_PATH: string = `${PRODUCT}/entity-risk`;
const ENTITY_PATH: string = `${PRODUCT}/entity-risk/entity`;
const RISK_SCORING_PATH: string = `${PRODUCT}/settings/risk-scoring`;
const RULE_LIBRARY_PATH: string = `${PRODUCT}/rule-library`;
const DETECTION_RULES_PATH: string = `${PRODUCT}/detection-rules`;
const CASES_PATH: string = `${PRODUCT}/cases`;
const SPRAY_CASE_PATH: string = `${PRODUCT}/cases/20000000-0000-4000-8000-000000000142`;
// The case a.ng's risk opens with ?riskcase=1.
const RISK_CASE_PATH: string = `${PRODUCT}/cases/20000000-0000-4000-8000-000000000143`;

const SPRAY_IP: string = "203.0.113.47";
const CFO: string = "k.morgan@acme-commerce.example";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/security-operations-ui",
);

// The fixture's risk rows, riskiest first: what the list must show.
const LISTED_ENTITIES: ReadonlyArray<[string, number, string]> = [
  [CFO, 200, "Critical"],
  [SPRAY_IP, 125, "High"],
  ["fin-ws-112", 113, "High"],
  ["r.alvarez@acme-commerce.example", 75, "Medium"],
  ["198.51.100.23", 75, "Medium"],
  ["web-03", 50, "Medium"],
  ["a.ng@acme-commerce.example", 50, "Medium"],
  ["192.0.2.15", 50, "Medium"],
  ["j.wilson@acme-commerce.example", 25, "Low"],
];

interface FixtureState {
  listRequests: Array<{
    modelName: string;
    query: Record<string, unknown>;
    sort: Record<string, unknown>;
  }>;
  getItemRequests: Array<{ modelName: string; id: string }>;
  apiRequests: Array<{ method: string; url: string; body: unknown }>;
  creates: Array<{ modelName: string; data: Record<string, unknown> }>;
  updates: Array<{
    modelName: string;
    id: string;
    data: Record<string, unknown>;
  }>;
  deletes: Array<{ modelName: string; id: string }>;
  unhandled: Array<unknown>;
}

interface OpenOptions {
  width?: number;
  height?: number;
  theme?: "dark" | undefined;
  empty?: boolean;
  role?: "viewer";
  // "off": the project opens no case from risk.
  riskcases?: "off";
  // The project's risk threshold.
  threshold?: number;
  // a.ng's risk opened CASE-143.
  riskcase?: boolean;
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

// An entity's page, as a row or a case's entity links to it.
function entityPath(value: string, type?: string): string {
  const query: URLSearchParams = new URLSearchParams({ value });
  if (type) {
    query.set("type", type);
  }
  return `${ENTITY_PATH}?${query.toString()}`;
}

async function open(
  page: Page,
  target: string,
  options: OpenOptions = {},
): Promise<void> {
  await page.setViewportSize({
    width: options.width || 1440,
    height: options.height || 1000,
  });
  await page.clock.setFixedTime(NOW);
  const url: URL = new URL(target, `http://127.0.0.1:${PORT}`);
  if (options.theme === "dark") {
    url.searchParams.set("theme", "dark");
  }
  if (options.empty) {
    url.searchParams.set("empty", "1");
  }
  if (options.role) {
    url.searchParams.set("role", options.role);
  }
  if (options.riskcases) {
    url.searchParams.set("riskcases", options.riskcases);
  }
  if (options.threshold !== undefined) {
    url.searchParams.set("threshold", String(options.threshold));
  }
  if (options.riskcase) {
    url.searchParams.set("riskcase", "1");
  }
  await page.goto(`${url.pathname}${url.search}`);
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

function sideMenu(page: Page): Locator {
  return page.locator('aside[role="navigation"]');
}

function menuEntry(page: Page, title: string): Locator {
  return sideMenu(page).getByRole("link", { name: title, exact: true });
}

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

function pathnameOf(page: Page): string {
  return new URL(page.url()).pathname;
}

function queryOf(page: Page, name: string): string | null {
  return new URL(page.url()).searchParams.get(name);
}

// A card of the page, by its title.
function cardTitled(page: Page, title: string): Locator {
  return page.getByTestId("card").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

function dialog(page: Page): Locator {
  return page.getByRole("dialog");
}

// The Entity Risk list's rows.
function riskRows(page: Page): Locator {
  return cardTitled(page, "Entity Risk").locator("table tbody tr");
}

function riskRow(page: Page, value: string): Locator {
  return riskRows(page).filter({ hasText: value });
}

// The score a row or a page shows, as a number.
async function scoreOf(scope: Locator): Promise<number> {
  const text: string = await scope
    .getByTestId("entity-risk-score")
    .locator("span")
    .first()
    .innerText();
  return Number(text.replace(/[^0-9]/g, ""));
}

function entityHeader(page: Page): Locator {
  return page.getByTestId("entity-risk-header");
}

// The sources table of an entity's page, by the source each row names.
function sourceRows(page: Page): Locator {
  return page.getByTestId("entity-risk-sources").locator("table tbody tr");
}

/*
 * ---------------------------------------------------------------------------
 * Security Events > Entity Risk
 * ---------------------------------------------------------------------------
 */

test.describe("Entity Risk", () => {
  test("lists every entity with risk, the riskiest first: its level, how much it matters, what found it and when", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ENTITY_RISK_PATH);
    await expect(riskRow(page, CFO)).toBeVisible({ timeout: 30000 });

    // An entry of its own under Events, lit, and named in the trail.
    expect(await litEntries(page)).toEqual(["Entity Risk"]);
    await expect(menuSection(page, "Events")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Events",
      "Entity Risk",
    ]);

    // Every entity with risk now, and the quiet one (score 0) left out.
    await expect(riskRows(page)).toHaveCount(LISTED_ENTITIES.length);
    await expect(riskRow(page, "old-laptop-9")).toHaveCount(0);
    await expect(
      page.getByText(`Showing 1-${LISTED_ENTITIES.length} of`),
    ).toBeVisible();

    // The riskiest first, each at the level its score reads as against 100.
    const scores: Array<number> = [];
    for (const row of await riskRows(page).all()) {
      scores.push(await scoreOf(row));
    }
    expect(scores).toEqual(
      LISTED_ENTITIES.map(([, score]: [string, number, string]): number => {
        return score;
      }),
    );
    for (const [value, score, level] of LISTED_ENTITIES) {
      const row: Locator = riskRow(page, value);
      expect(await scoreOf(row), value).toBe(score);
      await expect(row.getByTestId("entity-risk-level"), value).toHaveText(
        level,
      );
    }

    /*
     * The CFO's row: Extreme criticality beside the kind, its three sources
     * by the one that adds most, and when it was last found.
     */
    const cfo: Locator = riskRow(page, CFO);
    await expect(cfo).toContainText("User");
    await expect(cfo.getByTestId("entity-risk-criticality")).toHaveText(
      "Extreme (×2)",
    );
    await expect(cfo).toContainText("3 sources");
    await expect(cfo).toContainText("MFA push fatigue and 2 more");
    await expect(cfo).toContainText("15 minutes ago");
    // The meter fills against twice the threshold, where Critical starts.
    await expect(cfo.getByRole("meter")).toHaveAttribute(
      "aria-valuenow",
      "200",
    );
    await expect(cfo.getByRole("meter")).toHaveAttribute(
      "aria-valuemax",
      "200",
    );

    // The scanner the project marked Low: 100 of findings counts 50.
    await expect(
      riskRow(page, "192.0.2.15").getByTestId("entity-risk-criticality"),
    ).toHaveText("Low (×0.5)");
    await expect(
      riskRow(page, SPRAY_IP).getByTestId("entity-risk-criticality"),
    ).toHaveCount(0);

    // ATT&CK waits in Customize Columns: the row reads in five columns.
    expect(
      (
        await cardTitled(page, "Entity Risk")
          .locator("table thead th")
          .allInnerTexts()
      )
        .map((header: string): string => {
          return header.trim();
        })
        .filter((header: string): boolean => {
          // The select-all box and the row actions say nothing about a row.
          return !["", "Select all items", "Actions"].includes(header);
        }),
    ).toEqual(["Entity", "Risk", "Found By", "Last Risk"]);

    // One read: every row with risk, the riskiest first.
    const reads: FixtureState["listRequests"] = (
      await fixture(page)
    ).listRequests.filter(
      (request: FixtureState["listRequests"][number]): boolean => {
        return request.modelName === "SecurityEntityRisk";
      },
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(reads[0]!.query["riskScore"]).toEqual({
      _type: "GreaterThan",
      value: 0,
    });
    expect(reads[0]!.sort).toEqual({ riskScore: "DESC" });

    // How the score is counted, for the project's threshold.
    await expect(page.getByText("How entity risk works")).toBeVisible();
    for (const range of ["1 to 49", "50 to 99", "100 to 199", "200 or more"]) {
      await expect(page.getByText(range, { exact: true })).toBeVisible();
    }
    // Risk opens cases here: nothing says otherwise.
    await expect(page.getByTestId("entity-risk-cases-off")).toHaveCount(0);

    await screenshot(page, "entity-risk-desktop");

    const scroller: Locator = cardTitled(page, "Entity Risk")
      .locator("table")
      .first()
      .locator("xpath=ancestor::div[@data-testid='table-scroll'][1]");
    expect(await overflowOf(scroller), "the list scrolls sideways").toBe(0);
  });

  test("a row opens its entity's page, and the menu keeps Entity Risk lit there", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ENTITY_RISK_PATH);
    await riskRow(page, SPRAY_IP)
      .getByRole("button", { name: "View", exact: true })
      .click();

    await expect(entityHeader(page)).toContainText(SPRAY_IP, {
      timeout: 30000,
    });
    expect(pathnameOf(page)).toBe(ENTITY_PATH);
    expect(queryOf(page, "value")).toBe(SPRAY_IP);
    expect(queryOf(page, "type")).toBe("IP Address");
    expect(await litEntries(page)).toEqual(["Entity Risk"]);
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Events",
      "Entity Risk",
      "Entity",
    ]);

    // The trail leads back to the list.
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Entity Risk", exact: true })
      .click();
    await expect.poll(() => pathnameOf(page)).toBe(ENTITY_RISK_PATH);

    // On a phone, the menu's button names where you are.
    await open(page, entityPath(SPRAY_IP, "IP Address"), {
      width: 390,
      height: 844,
    });
    await expect(page.getByTestId("mobile-sidemenu-toggle")).toContainText(
      "Events / Entity Risk",
      { timeout: 30000 },
    );
  });

  test("every level and the guide follow the project's own threshold", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ENTITY_RISK_PATH, { threshold: 50 });
    await expect(riskRow(page, CFO)).toBeVisible({ timeout: 30000 });

    // At 50: High from 50, Critical from 100, Medium from 25.
    for (const [value, level] of [
      [CFO, "Critical"],
      [SPRAY_IP, "Critical"],
      ["web-03", "High"],
      ["j.wilson@acme-commerce.example", "Medium"],
    ]) {
      await expect(
        riskRow(page, value!).getByTestId("entity-risk-level"),
        value,
      ).toHaveText(level!);
    }
    for (const range of ["1 to 24", "25 to 49", "50 to 99", "100 or more"]) {
      await expect(page.getByText(range, { exact: true })).toBeVisible();
    }
    await expect(page.getByText(/case reaches 50,/).first()).toBeVisible();

    // The entity's page reads the same threshold.
    await open(page, entityPath(SPRAY_IP), { threshold: 50 });
    await expect(
      entityHeader(page).getByTestId("entity-risk-level"),
    ).toHaveText("Critical", { timeout: 30000 });
    await expect(entityHeader(page)).toContainText("A case opens at 50");
  });

  test("a project whose risk opens no case says so above the list, with the way to Risk Scoring", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ENTITY_RISK_PATH, { riskcases: "off" });
    const note: Locator = page.getByTestId("entity-risk-cases-off");
    await expect(note).toBeVisible({ timeout: 30000 });
    await expect(note).toContainText(
      "Entities that reach the threshold open no case",
    );
    await expect(note).toContainText("Risk is scored either way.");
    // Risk is still listed.
    await expect(riskRow(page, CFO)).toBeVisible();
    await screenshot(page, "entity-risk-cases-off", { fullPage: false });

    await note.getByRole("button", { name: "Open Risk Scoring" }).click();
    await expect.poll(() => pathnameOf(page)).toBe(RISK_SCORING_PATH);
    await expect(page.getByTestId("security-risk-cases")).toHaveAttribute(
      "aria-checked",
      "false",
      { timeout: 30000 },
    );
  });

  test("a new project's list says what fills it, and opens the Rule Library", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ENTITY_RISK_PATH, { empty: true });
    await expect(
      page.getByText("No user, host or address has any risk yet"),
    ).toBeVisible({ timeout: 30000 });
    await expect(riskRows(page)).toHaveCount(0);
    // A new project opens cases from risk: no note about it.
    await expect(page.getByTestId("entity-risk-cases-off")).toHaveCount(0);
    await screenshot(page, "entity-risk-empty", { fullPage: false });

    await page.getByRole("button", { name: "Open the Rule Library" }).click();
    await expect.poll(() => pathnameOf(page)).toBe(RULE_LIBRARY_PATH);
  });
});

/*
 * ---------------------------------------------------------------------------
 * An entity's page
 * ---------------------------------------------------------------------------
 */

test.describe("an entity's page", () => {
  test("its score worked out, what adds to it, its month, its activity and the cases about it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, entityPath(SPRAY_IP, "IP Address"));
    const header: Locator = entityHeader(page);
    await expect(header).toContainText(SPRAY_IP, { timeout: 30000 });
    await expect(header).toContainText("IP Address");
    expect(await scoreOf(header)).toBe(125);
    await expect(header.getByTestId("entity-risk-level")).toHaveText("High");
    await expect(header).toContainText("A case opens at 100");
    await expect(header).toContainText("3 sources");
    await expect(header).toContainText(
      "Counting since 2 days ago, last finding 9 minutes ago",
    );
    await expect(header).toContainText(
      "Its risk last opened or joined a case 41 minutes ago",
    );
    // No criticality: nothing weighs it.
    await expect(header.getByTestId("entity-risk-criticality")).toHaveCount(0);
    await expect(header).not.toContainText("from its sources ×");

    // Each source once, the most first, with what it added and how often.
    await expect(sourceRows(page)).toHaveCount(3);
    const sources: Array<string> = await sourceRows(page).allInnerTexts();
    expect(sources[0]).toContain("Password spraying");
    expect(sources[0]).toContain("Detection Rule");
    expect(sources[0]).toContain("50");
    expect(sources[0]).toContain("14");
    expect(sources[0]).toContain("9 minutes ago");
    expect(sources[0]).toContain("TA0006 Credential Access");
    expect(sources[1]).toContain("Spray, then a success");
    expect(sources[2]).toContain("Corporate MISP");
    expect(sources[2]).toContain("Threat Intel");
    expect(sources[2]).toContain("25");
    expect(sources[2]).toContain("31");

    // Its month, by day, and the cases about it.
    await expect(page.getByTestId("entity-risk-history")).toBeVisible();
    await expect(cardTitled(page, "Risk Over the Last 30 Days")).toBeVisible();
    const cases: Locator = page.getByTestId("entity-risk-cases");
    await expect(cases).toContainText("CASE-142", { timeout: 30000 });
    await expect(cases).toContainText(
      `Password spray against Okta from ${SPRAY_IP}`,
    );

    // Its week across every security event.
    const activity: Locator = page.getByTestId("entity-risk-activity");
    await expect(activity).toContainText("475");
    await expect(activity).toContainText("36");

    // Read once: its row by its key, and its activity for the week.
    const state: FixtureState = await fixture(page);
    expect(
      state.listRequests.filter(
        (request: FixtureState["listRequests"][number]): boolean => {
          return request.modelName === "SecurityEntityRisk";
        },
      ),
    ).toEqual([
      expect.objectContaining({
        query: expect.objectContaining({ entityKey: SPRAY_IP }),
      }),
    ]);
    expect(
      state.apiRequests.filter(
        (request: FixtureState["apiRequests"][number]): boolean => {
          return request.url.endsWith("/security-case/entity-activity");
        },
      ),
    ).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({ values: [SPRAY_IP], hours: 168 }),
      }),
    ]);

    await screenshot(page, "entity-risk-entity-desktop");

    // A case about it opens on its page.
    await cases.getByRole("button", { name: "View", exact: true }).click();
    await expect.poll(() => pathnameOf(page)).toBe(SPRAY_CASE_PATH);
  });

  test("how much an entity matters weighs its score: Extreme counts its findings twice", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, entityPath(CFO, "User"));
    const header: Locator = entityHeader(page);
    await expect(header).toContainText(CFO, { timeout: 30000 });
    expect(await scoreOf(header)).toBe(200);
    await expect(header.getByTestId("entity-risk-level")).toHaveText(
      "Critical",
    );
    await expect(header.getByTestId("entity-risk-criticality")).toHaveText(
      "Extreme (×2)",
    );
    await expect(header).toContainText("100 from its sources × 2 = 200");
    // Each source still says what it added before the weight.
    await expect(sourceRows(page)).toHaveCount(3);
    const sources: Array<string> = await sourceRows(page).allInnerTexts();
    expect(sources[0]).toContain("MFA push fatigue");
    expect(sources[0]).toContain("50");

    // A Low one counts half: the scanner's 100 is 50, and opens no case.
    await open(page, entityPath("192.0.2.15", "IP Address"));
    await expect(entityHeader(page)).toContainText(
      "100 from its sources × 0.5 = 50",
      { timeout: 30000 },
    );
    await expect(
      entityHeader(page).getByTestId("entity-risk-level"),
    ).toHaveText("Medium");
    await expect(entityHeader(page)).not.toContainText(
      "Its risk last opened or joined a case",
    );
  });

  test("Open in Correlate and Search Its Events open on the entity", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, entityPath(SPRAY_IP, "IP Address"));
    await expect(entityHeader(page)).toContainText(SPRAY_IP, {
      timeout: 30000,
    });

    await entityHeader(page)
      .getByRole("button", { name: "Open in Correlate" })
      .click();
    await expect.poll(() => pathnameOf(page)).toBe(`${PRODUCT}/correlate`);
    expect(queryOf(page, "observable")).toBe(SPRAY_IP);

    await open(page, entityPath(SPRAY_IP, "IP Address"));
    await entityHeader(page)
      .getByRole("button", { name: "Search Its Events" })
      .click();
    await expect.poll(() => pathnameOf(page)).toBe(PRODUCT);
    // Its events of the week its risk is counted over.
    expect(queryOf(page, "search")).toBe(`observable:${SPRAY_IP}`);
    expect(queryOf(page, "range")).toBe("Custom");
    expect(queryOf(page, "end")).toBe(NOW.toISOString());
    expect(queryOf(page, "start")).toBe(
      new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    );
  });

  test("Reset Risk asks first, then clears the risk, and the list no longer names the entity", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, entityPath("web-03", "Host"));
    const header: Locator = entityHeader(page);
    await expect(header).toContainText("web-03", { timeout: 30000 });
    expect(await scoreOf(header)).toBe(50);

    await page.getByTestId("entity-risk-reset").click();
    await expect(dialog(page)).toContainText("Reset this entity's risk?");
    await expect(dialog(page)).toContainText("Its cases are not changed.");
    // Asking deletes nothing.
    expect((await fixture(page)).deletes).toEqual([]);
    await screenshot(page, "entity-risk-reset-confirm", { fullPage: false });

    await dialog(page)
      .getByRole("button", { name: "Reset Risk", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(async () => {
        return (await fixture(page)).deletes;
      })
      .toEqual([
        {
          modelName: "SecurityEntityRisk",
          id: "2d000000-0000-4000-8000-000000000006",
        },
      ]);

    // Read again: no risk, no sources, no button to reset nothing.
    await expect(header).toContainText(
      "Nothing found about it counts toward risk in the last 7 days.",
    );
    await expect(page.getByTestId("entity-risk-reset")).toHaveCount(0);
    await expect(page.getByTestId("entity-risk-sources")).toHaveCount(0);
    // Its activity and its cases are still there.
    await expect(page.getByTestId("entity-risk-cases")).toContainText(
      "CASE-138",
    );

    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Entity Risk", exact: true })
      .click();
    await expect(riskRow(page, CFO)).toBeVisible({ timeout: 30000 });
    await expect(riskRow(page, "web-03")).toHaveCount(0);
    await expect(riskRows(page)).toHaveCount(LISTED_ENTITIES.length - 1);
  });

  test("a Security Viewer reads an entity's risk; Reset Risk is locked and says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, entityPath(SPRAY_IP, "IP Address"), { role: "viewer" });
    await expect(entityHeader(page)).toContainText(SPRAY_IP, {
      timeout: 30000,
    });
    expect(await scoreOf(entityHeader(page))).toBe(125);
    await expect(sourceRows(page)).toHaveCount(3);

    const reset: Locator = page.getByTestId("entity-risk-reset");
    await expect(reset).toBeDisabled();
    await page.getByTestId("entity-risk-reset-disabled-wrapper").hover();
    await expect(page.getByRole("tooltip")).toContainText(/permission/i);
    await page.getByTestId("entity-risk-reset-disabled-wrapper").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await fixture(page)).deletes).toEqual([]);
  });

  test("an entity whose sources went quiet keeps its month; one nothing scored keeps its activity; no value asks which", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Quiet for over a week: no score, no sources - and the risk it had.
    await open(page, entityPath("old-laptop-9", "Host"));
    const header: Locator = entityHeader(page);
    await expect(header).toContainText(
      "Nothing found about it counts toward risk in the last 7 days.",
      { timeout: 30000 },
    );
    await expect(header).toContainText("Host");
    await expect(page.getByTestId("entity-risk-sources")).toHaveCount(0);
    await expect(page.getByTestId("entity-risk-history")).toBeVisible();
    await expect(page.getByTestId("entity-risk-reset")).toHaveCount(0);
    await expect(page.getByTestId("entity-risk-cases")).toContainText(
      "No case has been opened about it",
    );

    // Nothing scored it: its kind from the link, its activity all the same.
    await open(page, entityPath("build-runner-07", "Host"));
    await expect(entityHeader(page)).toContainText("build-runner-07", {
      timeout: 30000,
    });
    await expect(entityHeader(page)).toContainText("Host");
    await expect(page.getByTestId("entity-risk-history")).toHaveCount(0);
    await expect(page.getByTestId("entity-risk-activity")).toContainText("59");

    // A link that names no entity says which it needs.
    await open(page, ENTITY_PATH);
    await expect(page.getByTestId("entity-risk-not-named")).toContainText(
      "Which entity? This page opens on a user, a host or an address",
      { timeout: 30000 },
    );
    await expect(page.getByTestId("entity-risk-not-named")).toContainText(
      "Open one from Entity Risk, or from the entities of a case.",
    );
    expect((await fixture(page)).listRequests).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ modelName: "SecurityEntityRisk" }),
      ]),
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Settings > Risk Scoring
 * ---------------------------------------------------------------------------
 */

test.describe("Risk Scoring", () => {
  test("whether risk opens cases, at what risk, and how much each entity matters", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RISK_SCORING_PATH);
    const toggle: Locator = page.getByTestId("security-risk-cases");
    await expect(toggle).toHaveAttribute("aria-checked", "true", {
      timeout: 30000,
    });

    // Under Settings, opened by itself on its own page.
    expect(await litEntries(page)).toEqual(["Risk Scoring"]);
    await expect(menuSection(page, "Settings")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Settings",
      "Risk Scoring",
    ]);

    await expect(page.getByTestId("security-risk-threshold")).toContainText(
      "Open a Case At",
    );
    await expect(page.getByTestId("security-risk-threshold")).toContainText(
      "100",
    );

    // The list, by value: a value written out or a pattern, each weighed.
    const criticality: Locator = cardTitled(page, "Entity Criticality");
    await expect(criticality.locator("table tbody tr")).toHaveCount(4);
    const rows: Array<string> = await criticality
      .locator("table tbody tr")
      .allInnerTexts();
    expect(rows[0]).toContain("192.0.2.15");
    expect(rows[0]).toContain("Low (×0.5)");
    expect(rows[1]).toContain("dc-*");
    expect(rows[1]).toContain("Extreme (×2)");
    expect(rows[2]).toContain("fin-ws-*");
    expect(rows[2]).toContain("High (×1.5)");
    expect(rows[3]).toContain(CFO);
    await expect(
      criticality.getByRole("button", { name: "Add Entity", exact: true }),
    ).toBeVisible();
    await screenshot(page, "risk-scoring-desktop");

    // The switch saves as it flips.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(async () => {
        return (await fixture(page)).updates.map(
          (update: FixtureState["updates"][number]) => {
            return [update.modelName, update.data];
          },
        );
      })
      .toEqual([["Project", { enableSecurityRiskCases: false }]]);
    await expect(page.getByTestId("security-risk-cases-card")).toContainText(
      "Risk is still scored and listed under Entity Risk. No case opens from it.",
    );
  });

  test("the threshold is a whole number from 10 to 10000, and saves", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RISK_SCORING_PATH);
    const card: Locator = page.getByTestId("security-risk-threshold");
    await expect(card).toContainText("100", { timeout: 30000 });

    await card.getByRole("button", { name: "Edit", exact: true }).click();
    const field: Locator = dialog(page).getByRole("spinbutton", {
      name: /^Open a Case At/,
    });
    await expect(field).toBeVisible();

    // Out of range, or not whole: refused in the form, in the product's words.
    await field.fill("5");
    await dialog(page)
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
    await expect(dialog(page)).toContainText(
      "The risk threshold is a whole number from 10 to 10000.",
    );

    await field.fill("12.5");
    await dialog(page)
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
    await expect(dialog(page)).toContainText(
      "The risk threshold is a whole number from 10 to 10000.",
    );
    expect((await fixture(page)).updates).toEqual([]);

    await field.fill("150");
    await dialog(page)
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(async () => {
        return (await fixture(page)).updates.map(
          (update: FixtureState["updates"][number]) => {
            return [update.modelName, update.data["securityRiskCaseThreshold"]];
          },
        );
      })
      .toEqual([["Project", 150]]);
    await expect(card).toContainText("150");
  });

  test("Add Entity marks a value or a pattern as mattering more or less", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RISK_SCORING_PATH);
    const criticality: Locator = cardTitled(page, "Entity Criticality");
    await expect(criticality.locator("table tbody tr")).toHaveCount(4, {
      timeout: 30000,
    });

    await criticality
      .getByRole("button", { name: "Add Entity", exact: true })
      .click();
    await expect(dialog(page)).toBeVisible();
    await dialog(page)
      .getByRole("textbox", { name: /^Value/ })
      .fill("svc-backup-*");
    await screenshot(page, "risk-scoring-add-entity", { fullPage: false });
    await dialog(page)
      .getByRole("button", { name: /^(Add|Create|Save)/ })
      .last()
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const creates: FixtureState["creates"] = (await fixture(page)).creates;
    expect(
      creates.map((create: FixtureState["creates"][number]) => {
        return create.modelName;
      }),
    ).toEqual(["SecurityEntityCriticality"]);
    // High unless said otherwise: the form starts there.
    expect(creates[0]!.data).toEqual(
      expect.objectContaining({ value: "svc-backup-*", criticality: "High" }),
    );
    await expect(criticality.locator("table tbody tr")).toHaveCount(5);
  });

  test("a Security Viewer reads Risk Scoring and changes nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RISK_SCORING_PATH, { role: "viewer" });
    await expect(
      cardTitled(page, "Entity Criticality").locator("table tbody tr"),
    ).toHaveCount(4, { timeout: 30000 });
    const toggle: Locator = page.getByTestId("security-risk-cases");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click({ force: true });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    expect((await fixture(page)).updates).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Entity risk on a case, and on a detection rule
 * ---------------------------------------------------------------------------
 */

test.describe("entity risk on a case", () => {
  test("a case's entities show each one's risk, linked to its page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${SPRAY_CASE_PATH}/entities`, { width: 1344 });
    const table: Locator = page.getByTestId("security-case-entities-table");
    await expect(table).toBeVisible({ timeout: 30000 });
    const row = (value: string): Locator => {
      return table
        .getByTestId("security-case-entity-row")
        .filter({ hasText: value });
    };

    // Wide enough: a Risk column of its own.
    const column = (value: string): Locator => {
      return row(value).getByTestId("security-case-entity-risk-column");
    };
    await expect(column(SPRAY_IP)).toContainText("125", { timeout: 30000 });
    await expect(column(SPRAY_IP)).toContainText("High");
    await expect(column(CFO)).toContainText("200");
    await expect(column(CFO)).toContainText("Critical");
    await expect(column("a.ng@acme-commerce.example")).toContainText("50");
    // A domain carries no risk.
    await expect(column("acme-commerce.okta.example")).toHaveText("-");
    // Read once, by the risk entities' keys.
    const reads: FixtureState["listRequests"] = (
      await fixture(page)
    ).listRequests.filter(
      (request: FixtureState["listRequests"][number]): boolean => {
        return request.modelName === "SecurityEntityRisk";
      },
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]!.query["entityKey"]).toEqual({
      _type: "Includes",
      value: [
        SPRAY_IP,
        "j.wilson@acme-commerce.example",
        "a.ng@acme-commerce.example",
        CFO,
      ],
    });

    await column(SPRAY_IP).getByRole("link").click();
    await expect.poll(() => pathnameOf(page)).toBe(ENTITY_PATH);
    expect(queryOf(page, "value")).toBe(SPRAY_IP);
    expect(queryOf(page, "type")).toBe("IP Address");
    await expect(entityHeader(page)).toContainText("125", { timeout: 30000 });

    /*
     * Beside the case's side menu on a laptop, and on a phone: the risk goes
     * under the value, named, and the columns keep their one line.
     */
    for (const width of [1280, 390]) {
      await open(page, `${SPRAY_CASE_PATH}/entities`, {
        width,
        height: width === 390 ? 844 : 1000,
      });
      await expect(table).toBeVisible({ timeout: 30000 });
      const under: Locator = row(SPRAY_IP).getByTestId(
        "security-case-entity-risk-under-value",
      );
      await expect(under).toBeVisible();
      await expect(under).toHaveText(/Risk\s*125\s*High/);
      await expect(
        row(SPRAY_IP).getByTestId("security-case-entity-risk-column"),
      ).toBeHidden();
      expect(await pageOverflow(page), `at ${width}`).toBeLessThanOrEqual(1);
    }
  });

  test("a case Entity Risk opened says why: every source, the score and the threshold", async ({
    page,
  }: {
    page: Page;
  }) => {
    // The queue: Entity Risk opened it.
    await open(page, CASES_PATH, { riskcase: true });
    const queueRow: Locator = page
      .locator("table tbody tr")
      .filter({ hasText: "CASE-143" });
    await expect(queueRow).toBeVisible({ timeout: 30000 });
    await expect(queueRow).toContainText(
      "High risk — a.ng@acme-commerce.example",
    );
    await expect(queueRow).toContainText("Entity Risk");

    // The case: what reached the threshold, and each source behind it.
    await open(page, RISK_CASE_PATH, { riskcase: true });
    await expect(
      page.getByText("High risk — a.ng@acme-commerce.example").first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page
        .getByText(
          /reached 100, High: the project opens a case at 100\. 3 sources found it in the last 7 days:/,
        )
        .first(),
    ).toBeVisible();
    for (const source of [
      "MFA push rejected or reported",
      "Account locked out",
      "Repeated failed sign-ins for one account",
    ]) {
      await expect(
        page.getByText(source, { exact: true }).first(),
      ).toBeVisible();
    }
    await expect(page.getByText("Opened by").first()).toBeVisible();
    await screenshot(page, "entity-risk-case-overview");

    // Its one detection: Entity Risk, at the project's risk threshold.
    await open(page, `${RISK_CASE_PATH}/detections`, { riskcase: true });
    await expect(
      page.getByText("Showing 1 of 1 security detection"),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Risk threshold").first()).toBeVisible();

    // Its entity's page lists it among the cases about it.
    await open(page, entityPath("a.ng@acme-commerce.example", "User"), {
      riskcase: true,
    });
    await expect(page.getByTestId("entity-risk-cases")).toContainText(
      "CASE-143",
      { timeout: 30000 },
    );
    expect(await scoreOf(entityHeader(page))).toBe(100);
    await expect(entityHeader(page)).toContainText(
      "Its risk last opened or joined a case 20 minutes ago",
    );
  });

  test("a detection rule's Risk Points wait under More fields, in its On Match step", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH);
    await page
      .getByRole("button", { name: "Create Detection Rule", exact: true })
      .click({ timeout: 30000 });
    await expect(dialog(page)).toBeVisible();
    await dialog(page)
      .getByRole("textbox", { name: /^Sigma Rule \(YAML\)/ })
      .fill(
        "title: Failed sign-in burst\nlevel: high\ndetection:\n  selection:\n    className: Authentication\n    statusName: Failure\n  condition: selection\n",
      );
    await dialog(page)
      .getByRole("button", { name: "Next", exact: true })
      .click();
    await expect(dialog(page).locator("[aria-current='step']")).toHaveText(
      "On Match",
    );
    const points: Locator = dialog(page).getByRole("spinbutton", {
      name: /^Risk Points/,
    });
    await expect(points).toHaveCount(0);
    await dialog(page)
      .getByRole("button", { name: /More fields/ })
      .click();
    await expect(points).toBeVisible();
    await expect(points).toHaveAttribute("placeholder", "By the rule's level");
    await expect(dialog(page)).toContainText(
      "Empty: by its level - Low 10, Medium 25, High 50, Critical 75.",
    );

    await points.fill("150");
    await dialog(page)
      .getByRole("button", { name: /^(Create|Save)/ })
      .last()
      .click();
    await expect(dialog(page)).toContainText(
      "Risk Points should not be more than 100.",
    );
    expect((await fixture(page)).creates).toEqual([]);
    await dialog(page)
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Every page fits
 * ---------------------------------------------------------------------------
 */

test.describe("the Entity Risk pages fit the screen", () => {
  const PAGES: ReadonlyArray<[string, string, (page: Page) => Locator]> = [
    [
      "entity-risk",
      ENTITY_RISK_PATH,
      (page: Page): Locator => {
        return page.getByText(CFO).first();
      },
    ],
    [
      "entity-risk-entity",
      entityPath(CFO, "User"),
      (page: Page): Locator => {
        return page.getByTestId("entity-risk-sources");
      },
    ],
    [
      "risk-scoring",
      RISK_SCORING_PATH,
      (page: Page): Locator => {
        return page.getByText("dc-*").first();
      },
    ],
  ];

  for (const width of [1280, 1024, 768, 390]) {
    test(`at ${width}, no page scrolls sideways${
      width === 1280 || width === 390 ? ", in both themes" : ""
    }`, async ({ page }: { page: Page }) => {
      const themes: ReadonlyArray<"dark" | undefined> =
        width === 1280 || width === 390 ? [undefined, "dark"] : [undefined];
      for (const theme of themes) {
        for (const [name, pathname, ready] of PAGES) {
          await open(page, pathname, {
            width,
            height: width === 390 ? 844 : 1000,
            theme,
          });
          await expect(ready(page), `${name} at ${width}`).toBeVisible({
            timeout: 30000,
          });
          expect(
            await pageOverflow(page),
            `${name} at ${width} ${theme || "light"}`,
          ).toBeLessThanOrEqual(1);
          if (width === 1280 || width === 390) {
            await screenshot(
              page,
              `${name}-${width === 390 ? "phone" : "laptop"}${
                theme ? "-dark" : ""
              }`,
            );
          }
        }
      }
    });
  }
});
