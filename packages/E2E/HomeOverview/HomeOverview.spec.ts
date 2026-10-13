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

async function attentionGroups(page: Page): Promise<Array<string>> {
  return page
    .locator('[data-testid^="home-attention-group-"]')
    .evaluateAll((elements: Array<Element>): Array<string> => {
      return elements
        .map((element: Element): string => {
          return element.getAttribute("data-testid") || "";
        })
        .filter((testId: string): boolean => {
          return /^home-attention-group-[a-z]+$/.test(testId);
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
    await expect(page.getByTestId("home-attention-total")).toHaveText(
      "9 open",
    );

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

  test("the strip's cells open Home's own lists, beside its side menu", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);

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
    await expect(
      page.getByTestId("home-resource-dashboards-count"),
    ).toHaveText("4");
    await expect(
      page.getByTestId("home-resource-workflows-set-up"),
    ).toHaveText("Set up");
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
      page.getByTestId("home-explore-panel").getByTestId("home-explore-product"),
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
      await expect(page.getByTestId(`home-resource-${key}-set-up`)).toBeVisible();
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
    await expect(page.getByTestId("home-attention-unavailable")).toBeVisible();
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
    await expect(page.getByTestId("home-resource-status-pages")).toHaveCount(
      0,
    );
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
    expect(upcoming[0]!.sort).toEqual({ startsAt: "Ascending" });

    for (const name of ["Monitor", "ServiceLevelObjective"]) {
      const totals: Array<RecordedRequest> = state.countRequests.filter(
        (request: RecordedRequest): boolean => {
          return (
            request.modelName === name &&
            Object.keys(request.query || {}).sort().join(",") ===
              "isArchived,projectId"
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

  test("dark: every card on a dark surface", async ({ page }: { page: Page }) => {
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
