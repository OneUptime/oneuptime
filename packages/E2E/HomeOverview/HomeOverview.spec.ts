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
 * Renders the real dashboard Home (Pages/Home/Layout and Home, with every
 * card they mount) against the offline fixture (Fixture/Fixture.js). Only
 * the data boundary and the signed-in user are synthetic. Every test pins
 * the browser clock to the fixture's NOW and puts up a network fence that
 * aborts anything leaving the fixture server, and fails on an uncaught page
 * error, on a request the fixture does not model and on any request the
 * fence had to abort.
 */

// The fixture server's port: HOME_OVERVIEW_FIXTURE_PORT, as the config and server.js read it.
const PORT: string = process.env["HOME_OVERVIEW_FIXTURE_PORT"] || "4224";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-13T12:00:00.000Z");
const HOME: string = `/dashboard/${PROJECT_ID}/home/`;

function uuid(prefix: string, suffix: number): string {
  return `${prefix}-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/home-overview-ui",
);

interface RecordedRequest {
  modelName: string;
  query?: Record<string, unknown>;
  select?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  limit?: number;
}

interface FixtureState {
  now: string;
  scenario: Record<string, unknown>;
  listRequests: Array<RecordedRequest>;
  countRequests: Array<RecordedRequest>;
  apiRequests: Array<{ method: string; url: string }>;
  paletteToggles: number;
  unhandled: Array<Record<string, unknown>>;
}

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

  // Nothing may leave the fixture server.
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
        (window as unknown as { __homeOverviewFixture?: unknown })
          .__homeOverviewFixture,
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

async function open(page: Page, query: string = ""): Promise<void> {
  // Every fixture date is relative to NOW; timers keep running.
  await page.clock.setFixedTime(NOW);
  await page.goto(`${HOME}${query ? `?${query}` : ""}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
}

async function openReady(page: Page, query: string = ""): Promise<void> {
  await open(page, query);
  await expect(page.getByTestId("home-health-headline")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("home-overview-stats")).toBeVisible();
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __homeOverviewFixture: FixtureState })
          .__homeOverviewFixture,
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

async function hasNoSidewaysScroll(page: Page): Promise<void> {
  const widths: { scroll: number; client: number } = await page.evaluate(
    (): { scroll: number; client: number } => {
      return {
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      };
    },
  );
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

function stat(page: Page, key: string): Locator {
  return page.getByTestId(`home-stat-${key}`);
}

function statStatus(page: Page, key: string): Locator {
  return page.getByTestId(`home-stat-${key}-status`);
}

interface StripCell {
  key: string;
  cellTop: number;
  numberTop: number;
  statusTop: number;
  clipped: boolean;
}

/*
 * Where each cell of the strip draws its number and status, and whether any
 * of its text is cut off ("...") or reaches past the cell.
 */
async function stripCells(page: Page): Promise<Array<StripCell>> {
  return page
    .locator('[data-testid^="home-stat-"][data-tone]')
    .evaluateAll((tiles: Array<Element>): Array<StripCell> => {
      const top: (element: Element | null) => number = (
        element: Element | null,
      ): number => {
        return Math.round(element?.getBoundingClientRect().top ?? -1);
      };
      const isClipped: (element: Element | null) => boolean = (
        element: Element | null,
      ): boolean => {
        return Boolean(element && element.scrollWidth > element.clientWidth);
      };

      return tiles.map((tile: Element): StripCell => {
        const key: string = (tile.getAttribute("data-testid") || "")
          .replace("home-stat-", "")
          .replace("-tile", "");
        const cell: Element | null = tile.closest("a");
        const status: Element | null = tile.querySelector(
          `[data-testid="home-stat-${key}-status"]`,
        );

        return {
          key,
          cellTop: top(cell),
          numberTop: top(
            tile.querySelector(`[data-testid="home-stat-${key}"]`),
          ),
          statusTop: top(status),
          clipped:
            isClipped(cell) ||
            isClipped(tile) ||
            isClipped(tile.firstElementChild) ||
            isClipped(status?.querySelector("span") || null),
        };
      });
    });
}

async function attentionGroups(page: Page): Promise<Array<string>> {
  return page
    .locator('[data-testid^="home-attention-group-"]')
    .evaluateAll((elements: Array<Element>): Array<string> => {
      // Declared here: this function runs in the page, not in the spec.
      const groupTestId: RegExp = /^home-attention-group-[a-z]+$/;

      return elements
        .map((element: Element): string => {
          return element.getAttribute("data-testid") || "";
        })
        .filter((testId: string): boolean => {
          return groupTestId.test(testId);
        })
        .map((testId: string): string => {
          return testId.replace("home-attention-group-", "");
        });
    });
}

/*
 * ---------------------------------------------------------------------------
 * A busy project
 * ---------------------------------------------------------------------------
 */

test.describe("a busy project", () => {
  test("leads with the open incidents, in red, over the five numbers", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);

    await expect(page.getByTestId("home-project-health")).toHaveAttribute(
      "data-health",
      "incidents",
    );
    await expect(page.getByTestId("home-health-headline")).toHaveText(
      "2 active incidents",
    );
    await expect(page.getByTestId("home-health-summary")).toHaveText(
      "Your users are affected. Open an incident to see who is responding and to post updates.",
    );
    await expect(page.getByTestId("home-health-updated")).toHaveText(
      "Updated just now",
    );

    await expect(stat(page, "active-incidents")).toHaveText("2");
    await expect(stat(page, "active-alerts")).toHaveText("3");
    // The archived Offline monitor is not counted.
    await expect(stat(page, "not-operational-monitors")).toHaveText("2");
    await expect(stat(page, "ongoing-maintenance")).toHaveText("1");
    // The disabled and the archived SLO are not counted.
    await expect(stat(page, "slos-needing-attention")).toHaveText("2");

    await expect(statStatus(page, "active-incidents")).toHaveText(
      "Needs attention",
    );
    await expect(statStatus(page, "ongoing-maintenance")).toHaveText(
      "In progress",
    );
    await expect(statStatus(page, "slos-needing-attention")).toHaveText(
      "Budget burning",
    );

    await screenshot(page, "home-busy");
  });

  test("names what is open, most urgent kind first, each row opening its record", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);

    expect(await attentionGroups(page)).toEqual([
      "incidents",
      "alerts",
      "monitors",
      "slos",
      "maintenance",
    ]);
    // 2 incidents + 3 alerts + 2 monitors + 2 SLOs; maintenance is planned.
    await expect(page.getByTestId("home-attention-total")).toHaveText("9 open");

    const incident: Locator = page
      .getByTestId("home-attention-row-incidents")
      .first();
    await expect(incident).toContainText("Checkout API returning 503 errors");
    await expect(incident).toContainText("INC-1042 · SEV-1");
    await expect(incident).toContainText("12 minutes ago");
    await expect(incident).toContainText("Investigating");

    await expect(
      page.getByTestId("home-attention-row-monitors").first(),
    ).toContainText("Checkout API");
    await expect(
      page.getByTestId("home-attention-row-slos").first(),
    ).toContainText("No error budget left");
    await expect(
      page.getByTestId("home-attention-row-maintenance").first(),
    ).toContainText("Ends in 40 minutes");

    await incident.click();
    await expect(page.getByTestId("stub-page")).toHaveText(
      `/dashboard/${PROJECT_ID}/incidents/${uuid("20000000", 1042)}`,
    );
  });

  test("the strip's cells open Home's own lists, which have the side menu the overview leaves out", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);

    // The overview draws every list itself, so its cards take the full width.
    const menuSections: Locator = page.locator("h6");
    await expect(menuSections).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Overview" })).toHaveCount(0);

    await stat(page, "active-incidents").click();

    await expect(page).toHaveURL(
      new RegExp(`/dashboard/${PROJECT_ID}/home/active-incidents$`),
    );
    await expect(page.getByTestId("stub-page")).toHaveAttribute(
      "data-page",
      "HOME_ACTIVE_INCIDENTS",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Active Incidents",
    );
    await expect(menuSections).toHaveText([
      "Home",
      "Incidents",
      "Alerts",
      "Monitors",
      "Scheduled Events",
    ]);

    // Overview leads back, and the overview is again without the menu.
    await page.getByRole("link", { name: "Overview" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/${PROJECT_ID}/home/?$`),
    );
    await expect(page.getByTestId("home-project-health")).toBeVisible();
    await expect(menuSections).toHaveCount(0);
  });

  test("lists what the project is made of, and what is coming up", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);

    const resources: Locator = page.getByTestId("home-project-resources");
    await expect(page.getByTestId("home-resource-monitors-count")).toHaveText(
      "11",
    );
    await expect(
      page.getByTestId("home-resource-status-pages-count"),
    ).toHaveText("2");
    await expect(
      page.getByTestId("home-resource-on-call-policies-count"),
    ).toHaveText("3");
    await expect(page.getByTestId("home-resource-slos-count")).toHaveText("4");
    await expect(page.getByTestId("home-resource-services-count")).toHaveText(
      "8",
    );
    await expect(page.getByTestId("home-resource-dashboards-count")).toHaveText(
      "4",
    );
    await expect(page.getByTestId("home-resource-workflows-set-up")).toHaveText(
      "Set up",
    );
    await expect(resources).toBeVisible();

    const upcoming: Locator = page.getByTestId("home-upcoming-row");
    await expect(upcoming).toHaveCount(3);
    await expect(upcoming.nth(0)).toContainText("Kubernetes 1.31 upgrade");
    await expect(upcoming.nth(0)).toContainText("Starts in 2 days");
    await expect(upcoming.nth(1)).toContainText("CDN provider migration");
    await expect(upcoming.nth(2)).toContainText(
      "Payments provider maintenance window",
    );
  });

  test("two columns at 1440px: the open work beside the project's resources", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);

    const attention: { x: number; width: number; y: number } = (await page
      .getByTestId("home-needs-attention")
      .boundingBox())!;
    const resources: { x: number; width: number; y: number } = (await page
      .getByTestId("home-project-resources")
      .boundingBox())!;

    expect(resources.x).toBeGreaterThan(attention.x + attention.width - 1);
    expect(Math.abs(resources.y - attention.y)).toBeLessThan(2);
    // Two thirds and one third.
    expect(attention.width).toBeGreaterThan(resources.width * 1.7);
    await hasNoSidewaysScroll(page);
  });

  test("Explore opens on Essentials and walks the categories", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);

    const tabs: Locator = page.getByTestId("home-explore-tab");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await expect(tabs.first()).toContainText("Essentials");
    await expect(
      page
        .getByTestId("home-explore-panel")
        .getByTestId("home-explore-product"),
    ).toHaveCount(7);

    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("home-explore-panel")).toContainText("Logs");

    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(2)).toBeFocused();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Find and start
 * ---------------------------------------------------------------------------
 */

test.describe("search and the create actions", () => {
  test("the search box opens the command palette, by mouse and by keyboard", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);

    await page.getByTestId("home-search").click();
    expect((await fixture(page)).paletteToggles).toBe(1);

    await page.getByTestId("home-search").focus();
    await page.keyboard.press("Enter");
    expect((await fixture(page)).paletteToggles).toBe(2);
  });

  test("Declare Incident is one click, the rest one Create menu", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);

    await expect(
      page.getByTestId("home-quick-action-declare-incident"),
    ).toBeVisible();

    await page.getByRole("button", { name: "Create" }).click();
    const items: Locator = page.getByRole("menuitem");
    await expect(items).toHaveText([
      "Create Monitor",
      "Schedule Maintenance",
      "Create Announcement",
    ]);

    await items.first().click();
    await expect(page.getByTestId("stub-page")).toHaveText(
      `/dashboard/${PROJECT_ID}/monitors/create`,
    );
  });

  test("a viewer gets search and no create actions", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, "role=viewer");

    await expect(page.getByTestId("home-search")).toBeVisible();
    await expect(page.getByTestId("home-quick-actions")).toHaveCount(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The other verdicts
 * ---------------------------------------------------------------------------
 */

test.describe("the verdicts", () => {
  test("healthy: all systems operational, and nothing needs your attention", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, "scenario=healthy");

    await expect(page.getByTestId("home-project-health")).toHaveAttribute(
      "data-health",
      "operational",
    );
    await expect(page.getByTestId("home-health-headline")).toHaveText(
      "All systems operational",
    );
    await expect(page.getByTestId("home-health-summary")).toHaveText(
      "11 monitors are operational, and there are no open incidents or alerts.",
    );
    await expect(page.getByTestId("home-attention-empty")).toHaveAttribute(
      "data-state",
      "all-clear",
    );
    await expect(page.getByTestId("home-upcoming-row")).toHaveCount(1);

    await screenshot(page, "home-healthy");
  });

  test("needs attention: alerts, a degraded monitor and an SLO at risk", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, "scenario=attention");

    await expect(page.getByTestId("home-project-health")).toHaveAttribute(
      "data-health",
      "needs-attention",
    );
    await expect(page.getByTestId("home-health-headline")).toHaveText(
      "4 issues need attention",
    );
    expect(await attentionGroups(page)).toEqual(["alerts", "monitors", "slos"]);
  });

  test("maintenance in progress, and nothing wrong", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, "scenario=maintenance");

    await expect(page.getByTestId("home-health-headline")).toHaveText(
      "1 maintenance event in progress",
    );
    expect(await attentionGroups(page)).toEqual(["maintenance"]);
    await expect(page.getByTestId("home-attention-total")).toHaveCount(0);
  });

  test("a new project: nothing monitored yet, the checklist under it, everything to set up", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, "scenario=new");

    await expect(page.getByTestId("home-project-health")).toHaveAttribute(
      "data-health",
      "not-set-up",
    );
    await expect(page.getByTestId("home-health-headline")).toHaveText(
      "Nothing is being monitored yet",
    );
    await expect(statStatus(page, "not-operational-monitors")).toHaveText(
      "No monitors yet",
    );
    await expect(page.getByTestId("getting-started")).toBeVisible();
    await expect(page.getByTestId("home-attention-empty")).toHaveAttribute(
      "data-state",
      "nothing-monitored",
    );
    for (const key of [
      "monitors",
      "status-pages",
      "on-call-policies",
      "slos",
      "services",
      "dashboards",
      "workflows",
    ]) {
      await expect(
        page.getByTestId(`home-resource-${key}-set-up`),
      ).toBeVisible();
    }
    // Nothing is scheduled: no maintenance card at all.
    await expect(page.getByTestId("home-upcoming-maintenance")).toHaveCount(0);

    const health: { y: number } = (await page
      .getByTestId("home-project-health")
      .boundingBox())!;
    const checklist: { y: number } = (await page
      .getByTestId("getting-started")
      .boundingBox())!;
    expect(checklist.y).toBeGreaterThan(health.y);

    await screenshot(page, "home-new-project");
  });

  test("more open than a group shows: five rows and View all with the total", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, "scenario=many");

    await expect(page.getByTestId("home-health-headline")).toHaveText(
      "9 active incidents",
    );
    await expect(page.getByTestId("home-attention-row-incidents")).toHaveCount(
      5,
    );
    await expect(
      page.getByTestId("home-attention-group-incidents-view-all"),
    ).toHaveText("View all 9");
  });
});

/*
 * ---------------------------------------------------------------------------
 * A newcomer's first steps
 * ---------------------------------------------------------------------------
 *
 * The first thing someone new asks of a monitoring product: when it breaks,
 * will I be told? The checklist's on-call step answers it - an incident or
 * alert nobody owns is emailed to the project's owners until a policy pages
 * someone - on a phone as on a desktop, and in the reader's language.
 */

const NEWCOMER_STEPS: Array<string> = [
  "create-monitor",
  "create-status-page",
  "invite-team",
  "create-on-call-policy",
];

const ON_CALL_STEP_TITLE: string = "Set up an on-call policy";

const ON_CALL_STEP_SENTENCE: string =
  "Page the right person when an incident or alert opens. Until then, the project's owners get an email.";

async function checklistSteps(page: Page): Promise<Array<string>> {
  return page
    .getByTestId("getting-started")
    .locator('[data-testid^="getting-started-task-"]')
    .evaluateAll((elements: Array<Element>): Array<string> => {
      return elements.map((element: Element): string => {
        return (element.getAttribute("data-testid") || "").replace(
          "getting-started-task-",
          "",
        );
      });
    });
}

test.describe("a newcomer's first steps", () => {
  for (const width of [1280, 390]) {
    test(`at ${width}px: four steps, and the on-call step says who is told until there is a policy`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({
        width: width,
        height: width === 390 ? 844 : 900,
      });
      await openReady(page, "scenario=new");

      await expect(page.getByTestId("getting-started")).toBeVisible();
      expect(await checklistSteps(page)).toEqual(NEWCOMER_STEPS);

      const onCall: Locator = page.getByTestId(
        "getting-started-task-create-on-call-policy",
      );

      await expect(onCall).toContainText(ON_CALL_STEP_TITLE);
      await expect(onCall).toContainText(ON_CALL_STEP_SENTENCE);

      // The sentence is drawn whole: nothing in the tile is cut off.
      const clipped: boolean = await onCall.evaluate(
        (tile: Element): boolean => {
          return Array.from(tile.querySelectorAll("span")).some(
            (span: Element): boolean => {
              return span.scrollWidth > span.clientWidth + 1;
            },
          );
        },
      );
      expect(clipped).toBe(false);

      await hasNoSidewaysScroll(page);

      if (width === 390) {
        // One column: every step's tile starts at the same left edge.
        const lefts: Array<number> = await page
          .getByTestId("getting-started")
          .locator('[data-testid^="getting-started-task-"]')
          .evaluateAll((elements: Array<Element>): Array<number> => {
            return elements.map((element: Element): number => {
              return Math.round(element.getBoundingClientRect().left);
            });
          });

        expect(new Set(lefts).size).toBe(1);
      }

      await screenshot(page, `home-newcomer-${width}`);
    });
  }

  test("German: the on-call step says who is told in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, "scenario=new&lang=de");

    const onCall: Locator = page.getByTestId(
      "getting-started-task-create-on-call-policy",
    );

    await expect(onCall).toContainText("Bereitschaftsrichtlinie einrichten");
    await expect(onCall).toContainText(
      "Bis dahin erhalten die Projekteigentümer eine E-Mail.",
    );
    await expect(onCall).not.toContainText(ON_CALL_STEP_SENTENCE);

    await screenshot(page, "home-newcomer-de");
  });

  test("dark: the checklist's tiles keep their text readable", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, "scenario=new&theme=dark");

    const onCall: Locator = page.getByTestId(
      "getting-started-task-create-on-call-policy",
    );

    await expect(onCall).toContainText(ON_CALL_STEP_SENTENCE);

    const colors: { text: string; surface: string } = await onCall.evaluate(
      (tile: Element): { text: string; surface: string } => {
        const sentence: Element = tile.querySelectorAll("span span")[1]!;

        return {
          text: getComputedStyle(sentence).color,
          surface: getComputedStyle(tile).backgroundColor,
        };
      },
    );

    // Light text on a dark tile, never the light theme's grey on white.
    expect(colors.text).not.toBe(colors.surface);
    expect(colors.surface).not.toBe("rgb(255, 255, 255)");

    await screenshot(page, "home-newcomer-dark");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Failures and refresh
 * ---------------------------------------------------------------------------
 */

test.describe("failures and Refresh", () => {
  test("the batch failing: the card says so, never a strip of zeros", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "fail=overview");

    await expect(page.getByTestId("home-project-health")).toHaveAttribute(
      "data-health",
      "error",
    );
    await expect(page.getByTestId("home-health-error")).toHaveText(
      "Incidents could not be read. The API is restarting.",
    );
    await expect(page.getByTestId("home-overview-stats")).toHaveCount(0);

    // The list says it failed, and points at the button the card above has.
    const unavailable: Locator = page.getByTestId("home-attention-unavailable");
    await expect(unavailable).toBeVisible();
    await expect(
      unavailable.getByTestId("home-attention-unavailable-state-title"),
    ).toHaveText("Couldn't load this list");
    await expect(
      unavailable.getByTestId("home-attention-unavailable-state-description"),
    ).toHaveText("Use Try again above to load it.");
    await expect(page.getByTestId("home-health-try-again")).toBeVisible();
    await expect(page.getByTestId("home-health-refresh")).toHaveCount(0);
  });

  test("Try again loads it once the API answers", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "fail=overview-once");

    await expect(page.getByTestId("home-health-try-again")).toBeVisible();
    await page.getByTestId("home-health-try-again").click();

    await expect(page.getByTestId("home-health-headline")).toHaveText(
      "2 active incidents",
    );
  });

  test("a resource count the role may not read loses its row, not the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, "fail=resources");

    await expect(page.getByTestId("home-resource-services-count")).toHaveText(
      "8",
    );
    await expect(page.getByTestId("home-resource-status-pages")).toHaveCount(0);
  });

  test("the upcoming list failing: the card is left out", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, "fail=upcoming");

    await expect(page.getByTestId("home-project-resources")).toBeVisible();
    await expect(page.getByTestId("home-upcoming-maintenance")).toHaveCount(0);
  });

  test("Refresh reads again and keeps the page on screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);

    const before: FixtureState = await fixture(page);
    const incidentLists: (state: FixtureState) => number = (
      state: FixtureState,
    ): number => {
      return state.listRequests.filter((request: RecordedRequest): boolean => {
        return request.modelName === "Incident";
      }).length;
    };

    await page.getByTestId("home-health-refresh").click();

    await expect
      .poll(async (): Promise<number> => {
        return incidentLists(await fixture(page));
      })
      .toBe(incidentLists(before) + 1);
    await expect(page.getByTestId("home-health-headline")).toHaveText(
      "2 active incidents",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * The requests
 * ---------------------------------------------------------------------------
 */

test.describe("the requests", () => {
  test("one list per open kind, five rows each, and the two totals", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);
    await expect(page.getByTestId("home-upcoming-row")).toHaveCount(3);

    const state: FixtureState = await fixture(page);
    const lists: Array<RecordedRequest> = state.listRequests.filter(
      (request: RecordedRequest): boolean => {
        return [
          "Incident",
          "Alert",
          "Monitor",
          "ServiceLevelObjective",
          "ScheduledMaintenance",
        ].includes(request.modelName);
      },
    );

    // Incident, Alert, Monitor, SLO and the in-progress maintenance: five.
    expect(
      lists.filter((request: RecordedRequest): boolean => {
        return request.limit === 5;
      }),
    ).toHaveLength(5);
    // And the upcoming maintenance card's own read: three, soonest first.
    const upcoming: Array<RecordedRequest> = lists.filter(
      (request: RecordedRequest): boolean => {
        return request.limit === 3;
      },
    );
    expect(upcoming).toHaveLength(1);
    // SortOrder.Ascending, as the request serializes it.
    expect(upcoming[0]!.sort).toEqual({ startsAt: "ASC" });

    for (const name of ["Monitor", "ServiceLevelObjective"]) {
      const totals: Array<RecordedRequest> = state.countRequests.filter(
        (request: RecordedRequest): boolean => {
          return (
            request.modelName === name &&
            Object.keys(request.query || {})
              .sort()
              .join(",") === "isArchived,projectId"
          );
        },
      );
      expect({ name, totals: totals.length }).toEqual({ name, totals: 1 });
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * Screens and themes
 * ---------------------------------------------------------------------------
 */

test.describe("screens and themes", () => {
  test("390px: one column, nothing wider than the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(page);

    await hasNoSidewaysScroll(page);
    await expect(page.getByTestId("home-search")).toBeVisible();

    const search: { width: number } = (await page
      .getByTestId("home-search")
      .boundingBox())!;
    expect(search.width).toBeGreaterThan(300);

    await screenshot(page, "home-mobile-top", { fullPage: false });
    await screenshot(page, "home-mobile");
  });

  test("768px: one column, the strip two to a row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openReady(page);

    await hasNoSidewaysScroll(page);

    const first: { y: number } = (await stat(
      page,
      "active-incidents",
    ).boundingBox())!;
    const second: { y: number } = (await stat(
      page,
      "active-alerts",
    ).boundingBox())!;
    const third: { y: number } = (await stat(
      page,
      "not-operational-monitors",
    ).boundingBox())!;

    expect(Math.abs(first.y - second.y)).toBeLessThan(2);
    expect(third.y).toBeGreaterThan(first.y + 10);

    await screenshot(page, "home-tablet");
  });

  test("German: the page reads in German, relative times included", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, "lang=de");

    // The words come from de.json, the times from Intl in German.
    await expect(page.getByTestId("home-health-headline")).toHaveText(
      "2 aktive Vorfälle",
    );
    await expect(page.getByTestId("home-health-updated")).not.toHaveText(
      "Updated just now",
    );
    await expect(
      page.getByTestId("home-attention-row-incidents").first(),
    ).toContainText("vor 12 Minuten");
    await expect(
      page.getByTestId("home-attention-row-maintenance").first(),
    ).toContainText("in 40 Minuten");
    await expect(page.getByTestId("home-search")).not.toContainText(
      "Search monitors",
    );
    for (const english of [
      "Needs attention",
      "Your project",
      "Upcoming maintenance",
      "Explore OneUptime",
    ]) {
      await expect(page.locator("body")).not.toContainText(english);
    }

    await screenshot(page, "home-busy-de");
  });

  test("German: long labels wrap whole, and the numbers still line up", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * "Erfordert Aufmerksamkeit" and "Nicht betriebsbereite Monitore" take two
     * lines where the English takes one. They wrap rather than end in "...",
     * and the cells beside them keep their numbers and statuses on the same
     * line, at every width.
     */
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await openReady(page, "lang=de");
      await hasNoSidewaysScroll(page);

      const cells: Array<StripCell> = await stripCells(page);
      expect(cells).toHaveLength(5);

      const firstInRow: Map<number, StripCell> = new Map();
      const outOfLine: Array<string> = [];

      for (const cell of cells) {
        const first: StripCell = firstInRow.get(cell.cellTop) || cell;
        firstInRow.set(cell.cellTop, first);

        if (
          cell.numberTop !== first.numberTop ||
          cell.statusTop !== first.statusTop
        ) {
          outOfLine.push(cell.key);
        }
      }

      expect({ width, outOfLine }).toEqual({ width, outOfLine: [] });
      expect({
        width,
        clipped: cells
          .filter((cell: StripCell): boolean => {
            return cell.clipped;
          })
          .map((cell: StripCell): string => {
            return cell.key;
          }),
      }).toEqual({ width, clipped: [] });
    }
  });

  test("a word longer than its cell breaks inside the cell", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(page);

    // A compound longer than the cell is wide, as a translation can have.
    await page
      .getByTestId("home-stat-not-operational-monitors-tile")
      .evaluate((tile: Element): void => {
        tile.firstElementChild!.textContent =
          "Bereitschaftsrichtlinienverwaltungsübersicht";
      });

    const clipped: Array<string> = (await stripCells(page))
      .filter((cell: StripCell): boolean => {
        return cell.clipped;
      })
      .map((cell: StripCell): string => {
        return cell.key;
      });

    expect(clipped).toEqual([]);
    await hasNoSidewaysScroll(page);
  });

  test("dark: every card on a dark surface", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, "theme=dark");

    const backgrounds: Array<string> = await page.evaluate(
      (): Array<string> => {
        return [
          "home-project-health",
          "home-needs-attention",
          "home-project-resources",
          "home-explore-products",
        ].map((testId: string): string => {
          const element: Element | null = document.querySelector(
            `[data-testid="${testId}"] .bg-white, [data-testid="${testId}"].bg-white`,
          );
          return element ? getComputedStyle(element).backgroundColor : "none";
        });
      },
    );

    for (const background of backgrounds) {
      expect(background).not.toBe("rgb(255, 255, 255)");
    }

    await screenshot(page, "home-dark");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The row under the health card
 * ---------------------------------------------------------------------------
 *
 * "We have quite a bit of empty space between cards." From xl up, Needs
 * attention shares a row with Your project and Upcoming maintenance, and
 * whichever side was shorter ended early, leaving bare page under it - the
 * all-clear of a healthy project above all. The row now ends on one line:
 * the last card in each column runs to the row's bottom. A list keeps its
 * rows at the top of its card; a state with nothing to list sits in its
 * middle. Below xl the cards stack, each as tall as what it holds.
 */

interface PageBox {
  top: number;
  bottom: number;
  left: number;
  height: number;
}

interface RowBoxes {
  // Each card's frame - what the reader sees as the card.
  attention: PageBox;
  side: Array<{ testId: string; frame: PageBox }>;
  explore: PageBox;
}

// Home after every card has read what it reads.
async function openSettled(page: Page, query: string): Promise<void> {
  await open(page, query);
  await expect(page.getByTestId("home-project-health")).not.toHaveAttribute(
    "data-health",
    "loading",
    { timeout: 30000 },
  );
  // Skeletons: the health card's, the strip's, the list's and the cards'.
  await expect(page.locator('[data-testid$="-loading"]')).toHaveCount(0);
}

async function rowBoxes(page: Page): Promise<RowBoxes> {
  return page.evaluate((): RowBoxes => {
    const boxOf: (element: Element) => PageBox = (
      element: Element,
    ): PageBox => {
      const rect: DOMRect = element.getBoundingClientRect();
      return {
        top: Math.round(rect.top + window.scrollY),
        bottom: Math.round(rect.bottom + window.scrollY),
        left: Math.round(rect.left),
        height: Math.round(rect.height),
      };
    };
    const frameOf: (wrapper: Element) => Element = (
      wrapper: Element,
    ): Element => {
      return wrapper.querySelector(':scope > [data-testid="card"] > div')!;
    };
    const side: Element = document.querySelector(
      '[data-testid="home-overview-row-side"]',
    )!;

    return {
      attention: boxOf(
        frameOf(
          document.querySelector('[data-testid="home-needs-attention"]')!,
        ),
      ),
      side: Array.from(side.children).map(
        (wrapper: Element): { testId: string; frame: PageBox } => {
          return {
            testId: wrapper.getAttribute("data-testid") || "",
            frame: boxOf(frameOf(wrapper)),
          };
        },
      ),
      explore: boxOf(
        frameOf(
          document.querySelector('[data-testid="home-explore-products"]')!,
        ),
      ),
    };
  });
}

test.describe("the row under the health card", () => {
  const SCENARIOS: Array<[string, string, Array<string>]> = [
    [
      "all clear beside Your project alone (nothing scheduled)",
      "scenario=quiet",
      ["home-project-resources"],
    ],
    [
      "all clear beside Your project and a window coming up",
      "scenario=healthy",
      ["home-project-resources", "home-upcoming-maintenance"],
    ],
    [
      "one maintenance row beside the side column",
      "scenario=maintenance",
      ["home-project-resources", "home-upcoming-maintenance"],
    ],
    [
      "alerts, a monitor and an SLO open",
      "scenario=attention",
      ["home-project-resources", "home-upcoming-maintenance"],
    ],
    [
      "a busy project: the open work is the taller side",
      "scenario=busy",
      ["home-project-resources", "home-upcoming-maintenance"],
    ],
    [
      "more open than a group shows",
      "scenario=many",
      ["home-project-resources", "home-upcoming-maintenance"],
    ],
    [
      "more open, and nothing coming up: Your project is the last card",
      "scenario=many&fail=upcoming",
      ["home-project-resources"],
    ],
    [
      "a new project: where problems will show, beside everything to set up",
      "scenario=new",
      ["home-project-resources"],
    ],
    [
      "the batch failing",
      "fail=overview",
      ["home-project-resources", "home-upcoming-maintenance"],
    ],
    [
      "in German",
      "lang=de",
      ["home-project-resources", "home-upcoming-maintenance"],
    ],
    [
      "in the dark theme",
      "scenario=quiet&theme=dark",
      ["home-project-resources"],
    ],
  ];

  for (const width of [1440, 1280]) {
    for (const [label, query, sideCards] of SCENARIOS) {
      test(`at ${width}px, ${label}: both sides end on one line, with Explore right under it`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await page.setViewportSize({ width, height: 1000 });
        await openSettled(page, query);

        const boxes: RowBoxes = await rowBoxes(page);
        const lastSide: PageBox = boxes.side[boxes.side.length - 1]!.frame;

        expect(
          boxes.side.map((card: { testId: string }): string => {
            return card.testId;
          }),
        ).toEqual(sideCards);
        // Side by side, their tops level.
        expect(boxes.side[0]!.frame.left).toBeGreaterThan(
          boxes.attention.left + 100,
        );
        expect(Math.abs(boxes.side[0]!.frame.top - boxes.attention.top)).toBe(
          0,
        );
        // ...and their bottoms: no bare page under either side.
        expect({
          width,
          query,
          gap: lastSide.bottom - boxes.attention.bottom,
        }).toEqual({ width, query, gap: 0 });
        // The cards of the side column stack with the row's gap between them.
        for (let index: number = 1; index < boxes.side.length; index++) {
          expect(
            boxes.side[index]!.frame.top - boxes.side[index - 1]!.frame.bottom,
          ).toBe(20);
        }
        // The next card follows the row at the page's own gap.
        expect(boxes.explore.top - boxes.attention.bottom).toBe(20);
        await hasNoSidewaysScroll(page);
      });
    }
  }

  test("all clear sits in the middle of its card, as the product's all-clear state", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettled(page, "scenario=quiet");

    const empty: Locator = page.getByTestId("home-attention-empty");
    const state: Locator = empty.getByTestId("home-attention-empty-state");

    await expect(empty).toHaveAttribute("data-state", "all-clear");
    await expect(state).toHaveAttribute("data-empty-state-kind", "all-clear");
    await expect(
      state.getByTestId("home-attention-empty-state-title"),
    ).toHaveText("Nothing needs your attention");

    const room: { y: number; height: number; x: number; width: number } =
      (await empty.boundingBox())!;
    const content: { y: number; height: number; x: number; width: number } =
      (await state.boundingBox())!;
    const boxes: RowBoxes = await rowBoxes(page);

    // The room is what the card has under its header, to its bottom edge.
    expect(Math.round(room.y + room.height)).toBe(boxes.attention.bottom - 1);
    expect(room.height).toBeGreaterThan(content.height + 100);
    // The state is in its middle, up and down and across.
    expect(
      Math.abs(room.y + room.height / 2 - (content.y + content.height / 2)),
    ).toBeLessThan(2);
    expect(
      Math.abs(room.x + room.width / 2 - (content.x + content.width / 2)),
    ).toBeLessThan(2);

    await screenshot(page, "home-quiet");
  });

  test("a new project's 'Problems will show up here' and a failed list sit in the middle too", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [query, testId] of [
      ["scenario=new", "home-attention-empty"],
      ["fail=overview", "home-attention-unavailable"],
    ]) {
      await openSettled(page, query!);

      const room: { y: number; height: number } = (await page
        .getByTestId(testId!)
        .boundingBox())!;
      const content: { y: number; height: number } = (await page
        .getByTestId(`${testId}-state`)
        .boundingBox())!;

      expect({
        query,
        offCentre:
          Math.abs(
            room.y + room.height / 2 - (content.y + content.height / 2),
          ) < 2,
      }).toEqual({ query, offCentre: true });
      expect(room.height).toBeGreaterThan(content.height + 100);
    }
  });

  test("a short list keeps its rows at the top, with the room under them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettled(page, "scenario=maintenance");

    const groups: { y: number; height: number } = (await page
      .getByTestId("home-attention-groups")
      .boundingBox())!;
    const header: { y: number; height: number } = (await page
      .getByTestId("home-needs-attention")
      .getByTestId("card-header")
      .boundingBox())!;
    const boxes: RowBoxes = await rowBoxes(page);

    // Right under the header...
    expect(groups.y - (header.y + header.height)).toBeLessThan(20);
    // ...with the rest of the card's height under the last row.
    expect(boxes.attention.bottom - (groups.y + groups.height)).toBeGreaterThan(
      200,
    );
    await expect(
      page.getByTestId("home-attention-row-maintenance"),
    ).toHaveCount(1);
  });

  /*
   * Side by side with their tops level, Needs attention's and Your
   * project's headers are equally tall wherever Your project's description
   * fits on one line, and the dividers under them read as one line across
   * the row. Needs attention used to start its list 4px further down.
   */
  test("the dividers under the headers of Needs attention and Your project run on one line", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1440, 1920]) {
      for (const query of [
        "scenario=quiet",
        "scenario=busy",
        "scenario=new",
        "fail=overview",
      ]) {
        await page.setViewportSize({ width, height: 1000 });
        await openSettled(page, query);

        const lines: Record<string, { header: number; divider: number }> =
          await page.evaluate(
            (): Record<string, { header: number; divider: number }> => {
              const result: Record<
                string,
                { header: number; divider: number }
              > = {};

              for (const testId of [
                "home-needs-attention",
                "home-project-resources",
              ]) {
                const padding: Element = document.querySelector(
                  `[data-testid="${testId}"] > [data-testid="card"] > div > div`,
                )!;
                const header: Element = padding.querySelector(
                  '[data-testid="card-header"]',
                )!;
                // The first box in the body draws the divider (border-top).
                const divider: Element =
                  padding.lastElementChild!.firstElementChild!;

                result[testId] = {
                  header: Math.round(header.getBoundingClientRect().bottom),
                  divider: Math.round(divider.getBoundingClientRect().top),
                };
              }

              return result;
            },
          );

        expect({ width, query, lines }).toEqual({
          width,
          query,
          lines: {
            "home-needs-attention": lines["home-project-resources"],
            "home-project-resources": lines["home-project-resources"],
          },
        });
      }
    }
  });

  test("the taller open work: the side column's last card runs down to its end, Your project keeps its rows' height", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettled(page, "scenario=many");

    const boxes: RowBoxes = await rowBoxes(page);
    const [resources, upcoming] = boxes.side;

    // Your project is as tall as with nothing beside it.
    await page.setViewportSize({ width: 1024, height: 1000 });
    const stacked: RowBoxes = await rowBoxes(page);

    expect(resources!.frame.height).toBe(stacked.side[0]!.frame.height);
    // Upcoming maintenance takes the rest of the row.
    expect(upcoming!.frame.bottom).toBe(boxes.attention.bottom);
    expect(upcoming!.frame.height).toBeGreaterThan(
      stacked.side[1]!.frame.height + 100,
    );
  });

  test("below xl the cards stack, each as tall as what it holds", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1024, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await openSettled(page, "scenario=quiet");

      const boxes: RowBoxes = await rowBoxes(page);
      const resources: PageBox = boxes.side[0]!.frame;

      // One under the other, in the page's order.
      expect({ width, left: resources.left }).toEqual({
        width,
        left: boxes.attention.left,
      });
      expect(resources.top - boxes.attention.bottom).toBe(20);
      // The all-clear is as tall as it is, not as Your project.
      expect({
        width,
        shorter: boxes.attention.height < resources.height,
      }).toEqual({ width, shorter: true });
      expect(boxes.explore.top - resources.bottom).toBe(20);
      await hasNoSidewaysScroll(page);
    }

    await screenshot(page, "home-quiet-mobile");
  });

  test("dark: the all-clear card beside Your project", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettled(page, "scenario=quiet&theme=dark");

    const background: string = await page
      .getByTestId("home-needs-attention")
      .getByTestId("card")
      .locator(":scope > div")
      .evaluate((frame: Element): string => {
        return getComputedStyle(frame).backgroundColor;
      });

    expect(background).not.toBe("rgb(255, 255, 255)");
    await screenshot(page, "home-quiet-dark");
  });
});
