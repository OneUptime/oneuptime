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
 * Renders the real monitor overview page (Pages/Monitor/View/Layout and
 * Index, with every card they mount) against the offline fixture
 * (Fixture/Fixture.js). Only the data boundary and the signed-in user are
 * synthetic. Every test pins the browser clock to the fixture's NOW and puts
 * up a network fence that aborts anything leaving the fixture server, and
 * fails on an uncaught page error, on a request the fixture does not model
 * and on any request the fence had to abort.
 */

const PORT: string = "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");

function uuid(prefix: string, suffix: number): string {
  return `${prefix}-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}

type MonitorTypeKey =
  | "api"
  | "website"
  | "ssl"
  | "incoming-request"
  | "incoming-email"
  | "server"
  | "kubernetes"
  | "network-device"
  | "manual";

const MONITOR_NUMBER: Record<MonitorTypeKey, number> = {
  api: 1,
  website: 2,
  ssl: 3,
  "incoming-request": 4,
  "incoming-email": 5,
  server: 6,
  kubernetes: 7,
  "network-device": 8,
  manual: 9,
};

const MONITOR_NAME: Record<MonitorTypeKey, string> = {
  api: "Checkout API",
  website: "Storefront",
  ssl: "Storefront TLS certificate",
  "incoming-request": "Nightly billing export",
  "incoming-email": "Payroll run confirmation",
  server: "orders-db primary host",
  kubernetes: "Production cluster (eu-west-1)",
  "network-device": "Core switch sw-core-01",
  manual: "Payment provider",
};

function monitorId(type: MonitorTypeKey): string {
  return uuid("70000000", MONITOR_NUMBER[type]);
}

function secretKey(type: MonitorTypeKey): string {
  return uuid("86000000", MONITOR_NUMBER[type]);
}

const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;

function monitorPath(type: MonitorTypeKey): string {
  return `${DASHBOARD}/monitors/${monitorId(type)}`;
}

const OPEN_INCIDENT_ID: string = uuid("20000000", 1042);
const OPEN_ALERT_ID: string = uuid("30000000", 311);
const NETWORK_DEVICE_ID: string = uuid("85000000", 1);

const HEARTBEAT_HOST: string = "https://oneuptime.acme-commerce.example";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/monitor-overview-ui",
);

// Computed colours the assertions compare against.
const OPERATIONAL_RGB: string = "rgb(16, 185, 129)";
const OFFLINE_RGB: string = "rgb(239, 68, 68)";
const NO_DATA_RGB: string = "rgb(156, 163, 175)";
const WHITE_RGB: string = "rgb(255, 255, 255)";

interface RecordedApiRequest {
  method: string;
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, unknown>;
}

interface RecordedModelRequest {
  modelName: string;
  id?: string;
  query?: Record<string, unknown>;
  select?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  skip?: number;
  limit?: number;
  analytics?: boolean;
}

interface RecordedAggregate {
  modelName: string;
  name: string;
}

interface UnhandledRequest {
  kind: string;
  modelName?: string;
  method?: string;
  url?: string;
}

interface FixtureState {
  now: string;
  scenario: Record<string, unknown>;
  getItemRequests: Array<RecordedModelRequest>;
  listRequests: Array<RecordedModelRequest>;
  countRequests: Array<RecordedModelRequest>;
  aggregateRequests: Array<RecordedAggregate>;
  apiRequests: Array<RecordedApiRequest>;
  unhandled: Array<UnhandledRequest>;
}

interface LabelledValue {
  label: string;
  value: string;
}

interface StatCell {
  label: string;
  value: string;
  description?: string;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OpenOptions {
  type?: MonitorTypeKey | undefined;
  query?: string | undefined;
  /*
   * "fixed" pins Date to NOW and keeps timers real; "installed" fakes the
   * timers too, so a test can fast-forward through the page's poll.
   */
  clock?: "fixed" | "installed" | undefined;
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
        (window as unknown as { __monitorOverviewFixture?: unknown })
          .__monitorOverviewFixture,
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

async function open(page: Page, options: OpenOptions = {}): Promise<void> {
  const type: MonitorTypeKey = options.type || "api";
  if (options.clock === "installed") {
    await page.clock.install({ time: NOW });
  } else {
    // Every fixture date is relative to NOW; timers keep running.
    await page.clock.setFixedTime(NOW);
  }
  const query: string = [`type=${type}`, options.query || ""]
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join("&");
  await page.goto(`${monitorPath(type)}?${query}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
}

async function openReady(page: Page, options: OpenOptions = {}): Promise<void> {
  await open(page, options);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `Monitor - ${MONITOR_NAME[options.type || "api"]}`,
    { timeout: 30000 },
  );
  await expect(hero(page)).toBeVisible({ timeout: 30000 });
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __monitorOverviewFixture: FixtureState })
          .__monitorOverviewFixture,
      ),
    ) as FixtureState;
  });
}

async function apiRequestsTo(
  page: Page,
  route: string,
): Promise<Array<RecordedApiRequest>> {
  return (await fixture(page)).apiRequests.filter(
    (request: RecordedApiRequest): boolean => {
      return request.url.includes(route);
    },
  );
}

async function listRequestsFor(
  page: Page,
  modelName: RegExp,
): Promise<Array<RecordedModelRequest>> {
  return (await fixture(page)).listRequests.filter(
    (request: RecordedModelRequest): boolean => {
      return modelName.test(request.modelName);
    },
  );
}

// The overview's own read of the Monitor row (Layout and header read less).
async function overviewMonitorReads(
  page: Page,
): Promise<Array<RecordedModelRequest>> {
  return (await fixture(page)).getItemRequests.filter(
    (request: RecordedModelRequest): boolean => {
      return (
        request.modelName === "Monitor" &&
        Boolean(request.select?.["currentMonitorStatusId"])
      );
    },
  );
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

// A bounding box in document coordinates (independent of scroll).
async function documentBox(locator: Locator): Promise<Box> {
  return locator.evaluate((element: Element): Box => {
    const rect: DOMRect = element.getBoundingClientRect();
    return {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
  });
}

async function expectAbove(
  upper: Locator,
  lower: Locator,
  message: string,
): Promise<void> {
  const upperBox: Box = await documentBox(upper);
  const lowerBox: Box = await documentBox(lower);
  expect(upperBox.y + upperBox.height, message).toBeLessThanOrEqual(
    lowerBox.y + 1,
  );
}

function hero(page: Page): Locator {
  return page.getByTestId("monitor-overview-hero");
}

function headline(page: Page): Locator {
  return page.getByTestId("monitor-overview-headline");
}

function statBar(page: Page): Locator {
  return page.getByRole("group", { name: "Uptime and open work", exact: true });
}

/*
 * A card by its heading. The `has` locator is built from the page root:
 * Playwright resolves it relative to each candidate card, so a locator
 * chained from `scope` would never match.
 */
function card(scope: Page | Locator, heading: string | RegExp): Locator {
  const root: Page =
    "page" in scope && typeof scope.page === "function"
      ? (scope as Locator).page()
      : (scope as Page);
  return scope.getByTestId("card").filter({
    has: root.getByRole("heading", {
      level: 2,
      name: heading,
      exact: typeof heading === "string",
    }),
  });
}

function overviewGrid(page: Page): Locator {
  return page.locator("div.grid.items-start.xl\\:grid-cols-3").first();
}

function mainColumn(page: Page): Locator {
  return overviewGrid(page).locator(":scope > div").nth(0);
}

function sideColumn(page: Page): Locator {
  return overviewGrid(page).locator(":scope > div").nth(1);
}

function uptimeBars(page: Page): Locator {
  return page.getByTestId("uptime-bar");
}

// Headings of the column's own cards, top to bottom.
async function cardTitles(column: Locator): Promise<Array<string>> {
  return (
    await column
      .locator(":scope > [data-testid='card']")
      .getByTestId("card-details-heading")
      .allInnerTexts()
  ).map((text: string): string => {
    return text.trim();
  });
}

async function definitionPairs(scope: Locator): Promise<Array<LabelledValue>> {
  return scope
    .locator("dl > div")
    .evaluateAll((rows: Array<Element>): Array<LabelledValue> => {
      return rows.map((row: Element): LabelledValue => {
        return {
          label: (row.querySelector("dt")?.textContent || "").trim(),
          value: (row.querySelector("dd")?.textContent || "").trim(),
        };
      });
    });
}

async function factLabels(page: Page): Promise<Array<string>> {
  return (await definitionPairs(hero(page))).map(
    (pair: LabelledValue): string => {
      return pair.label;
    },
  );
}

async function factValue(page: Page, label: string): Promise<string> {
  const pair: LabelledValue | undefined = (
    await definitionPairs(hero(page))
  ).find((item: LabelledValue): boolean => {
    return item.label === label;
  });
  return pair ? pair.value : "";
}

async function statCells(page: Page): Promise<Array<StatCell>> {
  return statBar(page)
    .locator(":scope > div")
    .evaluateAll((cells: Array<Element>): Array<StatCell> => {
      return cells.map((cell: Element): StatCell => {
        const parts: Array<string> = Array.from(cell.children).map(
          (child: Element): string => {
            return (child.textContent || "").trim();
          },
        );
        const result: StatCell = {
          label: parts[0] || "",
          value: parts[1] || "",
        };
        if (parts[2]) {
          result.description = parts[2];
        }
        return result;
      });
    });
}

async function backgroundColor(locator: Locator): Promise<string> {
  return locator.evaluate((element: Element): string => {
    return getComputedStyle(element).backgroundColor;
  });
}

async function textColor(locator: Locator): Promise<string> {
  return locator.evaluate((element: Element): string => {
    return getComputedStyle(element).color;
  });
}

// Relative luminance of an "rgb(r, g, b)" colour, 0 (black) to 1 (white).
function luminance(rgb: string): number {
  const channels: Array<number> = (rgb.match(/\d+(\.\d+)?/g) || [])
    .slice(0, 3)
    .map((value: string): number => {
      const channel: number = Number(value) / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
  return (
    0.2126 * (channels[0] || 0) +
    0.7152 * (channels[1] || 0) +
    0.0722 * (channels[2] || 0)
  );
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

const MIN_PLOT_HEIGHT: number = 150;

/*
 * The Response time chart keeps a readable height at every width. Both the
 * plot box and the chart drawn in it are measured: the tallest SVG, so a
 * legend icon never stands in for the chart.
 */
async function expectResponseTimePlotHeight(page: Page): Promise<void> {
  const plot: Locator = card(page, "Response time").getByTestId(
    "chart-group-plot",
  );
  await expect(plot).toHaveCount(1);
  expect(
    (await documentBox(plot)).height,
    "response-time plot height",
  ).toBeGreaterThanOrEqual(MIN_PLOT_HEIGHT);
  await expect
    .poll(
      async (): Promise<number> => {
        return plot.evaluate((element: Element): number => {
          return Math.max(
            0,
            ...Array.from(element.querySelectorAll("svg")).map(
              (svg: Element): number => {
                return svg.getBoundingClientRect().height;
              },
            ),
          );
        });
      },
      { message: "response-time chart height" },
    )
    .toBeGreaterThanOrEqual(MIN_PLOT_HEIGHT);
}

/*
 * Waits until every card that loads on its own has its data, so assertions
 * and screenshots never catch a loader.
 */
async function expectSettled(page: Page): Promise<void> {
  await expect(page.getByTestId("monitor-uptime-skeleton")).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(
    page.locator("[role='status'][aria-label^='Loading']"),
  ).toHaveCount(0, { timeout: 30000 });
  await expect(
    page.locator(
      "[data-testid='monitor-open-incident-count'].animate-pulse, [data-testid='monitor-open-alert-count'].animate-pulse",
    ),
  ).toHaveCount(0, { timeout: 30000 });
  const activity: Locator = card(page, "Recent activity");
  if ((await activity.getByTestId("monitor-activity-hidden").count()) === 0) {
    await expect(activity).toContainText("was created by", { timeout: 30000 });
  }
  const responseTime: Locator = card(page, "Response time");
  if (
    (await responseTime.count()) > 0 &&
    (await responseTime
      .getByTestId("monitor-response-time-fallback")
      .count()) === 0
  ) {
    // A monitor whose probes stopped has no response times for the day.
    await expect(responseTime).toContainText(/\d+ series|No data available/, {
      timeout: 30000,
    });
  }
}

/*
 * Records whether the first-load skeleton is ever mounted again, so a test
 * can prove a refresh happened in place (or that a monitor change did not).
 */
async function watchForSkeleton(page: Page): Promise<void> {
  await page.evaluate((): void => {
    const target: { __skeletonSeen?: boolean } = window as unknown as {
      __skeletonSeen?: boolean;
    };
    target.__skeletonSeen = false;
    new MutationObserver((): void => {
      if (
        document.querySelector("[data-testid='event-overview-skeleton-hero']")
      ) {
        target.__skeletonSeen = true;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

async function skeletonWasSeen(page: Page): Promise<boolean> {
  return page.evaluate((): boolean => {
    return Boolean(
      (window as unknown as { __skeletonSeen?: boolean }).__skeletonSeen,
    );
  });
}

/*
 * ---------------------------------------------------------------------------
 * Probe checks
 * ---------------------------------------------------------------------------
 */

test.describe("probe checks", () => {
  test("api operational desktop", async ({ page }: { page: Page }) => {
    await openReady(page);
    await expectSettled(page);

    await expect(headline(page)).toHaveText(/^Operational for 3 days, 4 hours/);
    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Operational",
    );
    await expect(page.getByTestId("monitor-overview-target-value")).toHaveText(
      "GET https://api.acme-commerce.example/v1/checkout/health",
    );

    // Facts: latest result, probes and owners, in that order.
    expect(await factLabels(page)).toEqual([
      "Latest result",
      "Probes",
      "Owners",
    ]);
    expect(await factValue(page, "Latest result")).toBe(
      "Up · 182 ms · HTTP 200from Frankfurt (eu-central-1)",
    );
    expect(await factValue(page, "Probes")).toBe("3 of 3 reporting");

    // The pulse: when it was last checked and when it checks next.
    await expect(page.getByTestId("monitor-overview-pulse")).toContainText(
      "Last checked",
    );
    await expect(page.getByTestId("monitor-overview-cadence")).toHaveText(
      "Every 5 minutes · next in 4 minutes",
    );

    // Four stat cells, in order, from the server's uptime summary.
    expect(await statCells(page)).toEqual([
      {
        label: "Uptime · 24 hours",
        value: "100%",
        description: "No downtime",
      },
      { label: "Uptime · 7 days", value: "99.652%", description: "Down 35m" },
      {
        label: "Uptime · 30 days",
        value: "99.703%",
        description: "Down 2h 8m",
      },
      {
        label: "Open now",
        value: "Nothing open",
        description: "No unresolved incidents or alerts",
      },
    ]);

    // Exactly 90 day bars, and the 90-day figure is the sum of them.
    await expect(uptimeBars(page)).toHaveCount(90);
    await expect(page.getByTestId("monitor-uptime-90d")).toHaveText(
      "99.728% over 90 days",
    );

    expect(await cardTitles(mainColumn(page))).toEqual([
      "Uptime history",
      "Response time",
      "Monitor Summary",
      "Recent activity",
    ]);
    expect(await cardTitles(sideColumn(page))).toEqual([
      "Open incidents & alerts",
      "Recent status changes",
      "Probes",
      "Details",
    ]);
    await expectResponseTimePlotHeight(page);

    await expect(
      page.getByRole("combobox", { name: "Showing results from:" }),
    ).toBeVisible();

    // The status dot is painted in the status's own colour.
    expect(
      await backgroundColor(page.getByTestId("monitor-overview-status-dot")),
    ).toBe(OPERATIONAL_RGB);

    // The removed pieces stay removed.
    await expect(page.getByText("Current Status", { exact: true })).toHaveCount(
      0,
    );
    await screenshot(page, "monitor-overview-desktop");
  });

  test("offline with open work", async ({ page }: { page: Page }) => {
    await openReady(page, { query: "state=offline" });
    await expectSettled(page);

    await expect(page.getByTestId("monitor-overview-icon")).toHaveClass(
      /bg-red-50/,
    );
    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Offline",
    );
    expect(
      await backgroundColor(page.getByTestId("monitor-overview-status-dot")),
    ).toBe(OFFLINE_RGB);
    await expect(headline(page)).toHaveText("Offline for 12 minutes");

    const latest: string = await factValue(page, "Latest result");
    expect(latest.startsWith("Down · 94 ms · HTTP 503")).toBe(true);
    expect(latest).toContain(
      "HTTP 503 Service Unavailable: upstream connect error before headers.",
    );

    const openNow: Locator = page.locator("#monitor-open-now");
    await expect(page.getByTestId("monitor-open-now-value")).toHaveText(
      "1 incident · 1 alert",
    );
    await expect(
      openNow.getByRole("link", { name: "1 incident" }),
    ).toHaveAttribute("href", `${monitorPath("api")}/incidents`);
    await expect(
      openNow.getByRole("link", { name: "1 alert" }),
    ).toHaveAttribute("href", `${monitorPath("api")}/alerts`);

    const openWork: Locator = card(page, "Open incidents & alerts");
    await expect(
      openWork.getByTestId("monitor-open-incident-count"),
    ).toHaveText("1");
    await expect(openWork.getByTestId("monitor-open-alert-count")).toHaveText(
      "1",
    );
    const rows: Locator = openWork.getByTestId("monitor-open-work-row");
    await expect(rows).toHaveCount(2);
    // Newest first: the incident was declared a minute after the alert.
    await expect(rows.nth(0)).toContainText("Checkout API is returning 503s");
    // The severity is in the text, not only in the dot's colour and title.
    await expect(rows.nth(0)).toContainText("Incident · SEV-1 · Created");
    await expect(
      rows.nth(0).getByRole("link", { name: "Checkout API is returning 503s" }),
    ).toHaveAttribute("href", `${DASHBOARD}/incidents/${OPEN_INCIDENT_ID}`);
    await expect(rows.nth(1)).toContainText("Alert · Critical · Acknowledged");
    await expect(
      rows
        .nth(1)
        .getByRole("link", { name: "Checkout API health check failing" }),
    ).toHaveAttribute("href", `${DASHBOARD}/alerts/${OPEN_ALERT_ID}`);

    // Every probe reports the failure.
    await expect(
      card(page, "Probes").getByTestId("monitor-probe-health"),
    ).toHaveText(["Down", "Down", "Down"]);

    // The ongoing Offline row heads the recent changes.
    await expect(
      page.getByTestId("monitor-status-change-row").first(),
    ).toContainText("Offline");
    await expect(
      page.getByTestId("monitor-status-change-row").first(),
    ).toContainText("ongoing, 12 minutes");
    await screenshot(page, "monitor-overview-offline");
  });

  test("new monitor (history=new)", async ({ page }: { page: Page }) => {
    await openReady(page, { query: "history=new" });
    await expectSettled(page);

    const bars: Locator = uptimeBars(page);
    await expect(bars).toHaveCount(90);
    // Jun 24 (bar 0) to Sep 8 (bar 76) are before the monitor existed.
    expect(await backgroundColor(bars.nth(0))).toBe(NO_DATA_RGB);
    expect(await backgroundColor(bars.nth(76))).toBe(NO_DATA_RGB);
    // Sep 9, the day it was created, was measured; so is today.
    expect(await backgroundColor(bars.nth(77))).not.toBe(NO_DATA_RGB);
    expect(await backgroundColor(bars.nth(89))).not.toBe(NO_DATA_RGB);

    const cells: Array<StatCell> = await statCells(page);
    // Twelve days old: a full week is measured, a month is not.
    expect(cells[1]?.description || "").not.toContain("measured over");
    expect(cells[2]?.description || "").toContain("measured over 12d");

    const footnote: Locator = page.getByTestId("monitor-uptime-footnote");
    await expect(footnote).toContainText("This monitor was created");
    await expect(footnote).toContainText("earlier days have no data.");
    await expect(
      card(page, "Uptime history").getByRole("list", { name: "Legend" }),
    ).toContainText("No data");
    await screenshot(page, "monitor-overview-new-monitor");
  });

  test("probes-off", async ({ page }: { page: Page }) => {
    await openReady(page, { query: "state=probes-off" });
    await expectSettled(page);

    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Probes Not Enabled",
    );
    await expect(headline(page)).toHaveText(
      "Every probe is turned off for this monitor",
    );
    await expect(page.getByTestId("monitor-overview-explanation")).toHaveText(
      "3 probes are attached but switched off, so nothing is checking this resource.",
    );
    // The hero owns the state: no red banner repeats it.
    await expect(
      page.getByText("Probes Not Enabled", { exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByText(/not being monitored because all probes/),
    ).toHaveCount(0);

    // The picker still says the probe it shows is switched off.
    await expect(
      card(page, "Monitor Summary")
        .getByText(/\(disabled\)/)
        .first(),
    ).toBeVisible();
    await expect(
      card(page, "Probes").getByTestId("monitor-probe-health"),
    ).toHaveText([
      "Turned off for this monitor",
      "Turned off for this monitor",
      "Turned off for this monitor",
    ]);
  });

  test("disabled with no probes enabled", async ({ page }: { page: Page }) => {
    await openReady(page, { query: "state=disabled,probes-off" });

    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Disabled",
    );
    await expect(
      page.getByTestId("monitor-overview-secondary-badge"),
    ).toHaveText(["Probes Not Enabled"]);
    await expect(headline(page)).toHaveText("Monitoring is turned off");
    await expect(page.getByTestId("monitor-overview-last-known")).toHaveText(
      "Last recorded status: Operational",
    );
    await expect(
      hero(page).getByRole("link", { name: "Open settings" }),
    ).toHaveAttribute("href", `${monitorPath("api")}/settings`);
    // A paused monitor promises no next check.
    await expect(page.getByTestId("monitor-overview-cadence")).toHaveCount(0);
  });

  test("maintenance", async ({ page }: { page: Page }) => {
    await openReady(page, { query: "state=maintenance" });
    await expectSettled(page);

    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Paused",
    );
    await expect(headline(page)).toHaveText(
      "Monitoring is paused for scheduled maintenance",
    );
    await expect(page.getByTestId("monitor-overview-explanation")).toHaveText(
      "Checks resume automatically when the maintenance event ends.",
    );
    const cells: Array<StatCell> = await statCells(page);
    for (const cell of cells.slice(0, 3)) {
      expect(cell.description || "", cell.label).toContain(
        "includes paused time",
      );
    }
    /*
     * The last results are 25 minutes old, but no probe is meant to check
     * while monitoring is paused: none is Late, each keeps its last
     * verdict, and the Probes fact says so instead of a red "0 of 3".
     */
    await expect(
      card(page, "Probes").getByTestId("monitor-probe-health"),
    ).toHaveText(["Up · 182 ms", "Up · 243 ms", "Up · 311 ms"]);
    expect(await factValue(page, "Probes")).toBe("3 enabledChecks paused");
    await expect(
      page.getByTestId("monitor-overview-fact-probes").locator("dd"),
    ).toHaveClass(/text-gray-900/);
    await screenshot(page, "monitor-overview-paused");
  });

  test("a disabled monitor's probes keep their last verdict", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { query: "state=disabled" });
    await expectSettled(page);

    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Disabled",
    );
    // Six hours without a check is the pause, not six hours of late probes.
    await expect(
      card(page, "Probes").getByTestId("monitor-probe-health"),
    ).toHaveText(["Up · 182 ms", "Up · 243 ms", "Up · 311 ms"]);
    await expect(page.getByText("Late", { exact: true })).toHaveCount(0);
    expect(await factValue(page, "Probes")).toBe("3 enabledChecks paused");
  });

  test("stale", async ({ page }: { page: Page }) => {
    await openReady(page, { query: "state=stale" });

    await expect(
      page.getByTestId("monitor-overview-secondary-badge"),
    ).toHaveText(["Checks overdue"]);
    /*
     * Counted from the check that never came: the first run of the
     * five-minute schedule after the 11:22 result, at 11:25.
     */
    await expect(page.getByTestId("monitor-overview-overdue")).toHaveText(
      "Overdue by 35m",
    );
    await expect(page.getByTestId("monitor-overview-explanation")).toHaveText(
      "No result for 38m, but this monitor checks every 5 minutes. A probe may be overloaded or offline.",
    );
    // A late check cannot vouch for a good status.
    const icon: Locator = page.getByTestId("monitor-overview-icon");
    await expect(icon).not.toHaveClass(/bg-emerald-50/);
    await expect(icon).toHaveClass(/bg-amber-50/);
    await expect(
      card(page, "Probes").getByTestId("monitor-probe-health"),
    ).toHaveText(["Late", "Late", "Late"]);
  });

  test("degraded", async ({ page }: { page: Page }) => {
    await openReady(page, { query: "state=degraded" });

    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Degraded",
    );
    await expect(headline(page)).toHaveText("Degraded for 25 minutes");
    await expect(page.getByTestId("monitor-overview-icon")).toHaveClass(
      /bg-amber-50/,
    );
    expect(await factValue(page, "Latest result")).toContain(
      "Up · 2410 ms · HTTP 200",
    );
  });

  test("disconnected probes", async ({ page }: { page: Page }) => {
    await openReady(page, { query: "state=disconnected" });

    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Probes Disconnected",
    );
    await expect(headline(page)).toHaveText(
      "Every probe checking this monitor is disconnected",
    );
    await expect(
      hero(page).getByRole("link", { name: "Check probes" }),
    ).toHaveAttribute("href", `${monitorPath("api")}/probes`);
    await expect(
      card(page, "Probes").getByTestId("monitor-probe-health"),
    ).toHaveText(["Disconnected", "Disconnected", "Disconnected"]);
  });

  test("one disconnected probe out of three", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { query: "state=one-disconnected" });
    await expectSettled(page);

    /*
     * Singapore went offline three days ago and its next check stayed
     * there. Frankfurt and N. Virginia still check on time, so the monitor
     * is not overdue: the lost probe shows on the Probes fact and card.
     */
    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Operational",
    );
    await expect(headline(page)).toHaveText(/^Operational for 3 days, 4 hours/);
    await expect(
      page.getByTestId("monitor-overview-secondary-badge"),
    ).toHaveCount(0);
    await expect(page.getByTestId("monitor-overview-overdue")).toHaveCount(0);
    await expect(page.getByText("Checks overdue")).toHaveCount(0);
    await expect(page.getByTestId("monitor-overview-icon")).toHaveClass(
      /bg-emerald-50/,
    );
    // The next check comes from the probes that are checking.
    await expect(page.getByTestId("monitor-overview-cadence")).toHaveText(
      "Every 5 minutes · next in 4 minutes",
    );

    expect(await factValue(page, "Probes")).toBe(
      "2 of 3 reporting1 disconnected",
    );
    await expect(
      page.getByTestId("monitor-overview-fact-probes").locator("dd"),
    ).toHaveClass(/text-amber-700/);
    const probes: Locator = card(page, "Probes");
    await expect(probes.getByTestId("monitor-probe-health")).toHaveText([
      "Disconnected",
      "Up · 182 ms",
      "Up · 243 ms",
    ]);
    // Only connected probes take part in the agreement rule.
    await expect(probes.getByTestId("monitor-probe-agreement")).toHaveText(
      "A status change needs both connected probes to agree.",
    );
    await screenshot(page, "monitor-overview-one-disconnected");
  });

  test("no probes attached", async ({ page }: { page: Page }) => {
    await openReady(page, { query: "state=no-probes" });

    await expect(headline(page)).toHaveText(
      "No probes are attached to this monitor",
    );
    await expect(
      hero(page).getByRole("link", { name: "Add a probe" }),
    ).toHaveAttribute("href", `${monitorPath("api")}/probes`);
    await expect(card(page, "Probes")).toContainText("No probes attached.");
    expect(await factValue(page, "Probes")).toBe("None enabled");
  });

  test("awaiting the first check", async ({ page }: { page: Page }) => {
    await openReady(page, { query: "state=awaiting" });

    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Waiting for data",
    );
    await expect(headline(page)).toHaveText("Waiting for the first check");
    await expect(page.getByTestId("monitor-overview-explanation")).toHaveText(
      "3 probes check this every 5 minutes. The first result usually arrives within a few minutes.",
    );
    // Bars for a monitor that never reported would all say "No data".
    await expect(statBar(page)).toHaveCount(0);
    await expect(card(page, "Uptime history")).toHaveCount(0);
    await expect(card(page, "Response time")).toHaveCount(0);
  });

  test("an SSL certificate monitor shows when the certificate expires", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { type: "ssl" });

    expect(await factLabels(page)).toEqual([
      "Latest result",
      "Certificate expires",
      "Probes",
      "Owners",
    ]);
    const expiry: Locator = page
      .getByTestId("monitor-overview-fact-certificate-expiry")
      .locator("dd");
    await expect(expiry).toContainText("in 23 days");
    // Within a month: a warning, not yet danger.
    await expect(expiry).toHaveClass(/text-amber-700/);
  });

  test("a day bar opens that day with its incident", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);
    await expectSettled(page);

    // Aug 29 is bar 66: 75 minutes Offline and the incident it raised.
    const bar: Locator = uptimeBars(page).nth(66);
    expect(await backgroundColor(bar)).toBe(OFFLINE_RGB);
    await bar.click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Offline");
    await expect(dialog).toContainText("Checkout API is down");
  });

  test("a flapping monitor's bars and uptime show every outage", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { query: "history=flapping" });
    await expectSettled(page);

    const colors: Array<string> = await uptimeBars(page).evaluateAll(
      (bars: Array<Element>): Array<string> => {
        return bars.map((bar: Element): string => {
          return getComputedStyle(bar).backgroundColor;
        });
      },
    );
    expect(colors).toHaveLength(90);
    // An outage every 6h40m: most of the strip is red, none of it is grey.
    expect(
      colors.filter((color: string): boolean => {
        return color === OFFLINE_RGB;
      }).length,
    ).toBeGreaterThan(60);
    expect(colors).not.toContain(NO_DATA_RGB);
    const ninetyDays: string =
      (await page.getByTestId("monitor-uptime-90d").textContent()) || "";
    expect(Number.parseFloat(ninetyDays)).toBeLessThan(99);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Other monitor families
 * ---------------------------------------------------------------------------
 */

test.describe("other monitor families", () => {
  test("awaiting incoming-request as owner", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, {
      type: "incoming-request",
      query: "state=awaiting",
    });

    await expect(headline(page)).toHaveText("Waiting for the first heartbeat");
    const setup: Locator = card(page, "Send the first heartbeat");
    await expect(setup).toBeVisible();
    const url: string = `${HEARTBEAT_HOST}/heartbeat/${secretKey("incoming-request")}`;
    await expect(setup.getByTestId("monitor-setup-heartbeat-url")).toHaveText(
      url,
    );
    await expect(
      setup.getByRole("button", { name: "Copy", exact: true }),
    ).toBeVisible();
    await expect(setup).toContainText(`curl -X POST "${url}"`);
    await expect(
      setup.getByRole("link", { name: "Full setup instructions" }),
    ).toHaveAttribute(
      "href",
      `${monitorPath("incoming-request")}/documentation`,
    );

    // Nothing has arrived, so there is nothing to chart or summarise.
    await expect(statBar(page)).toHaveCount(0);
    await expect(card(page, "Uptime history")).toHaveCount(0);
    await expect(card(page, "Monitor Summary")).toHaveCount(0);
    await expect(card(page, "Heartbeat URL")).toHaveCount(0);
    await expectSettled(page);
    await screenshot(page, "monitor-overview-heartbeat-setup");
  });

  test("awaiting incoming-request as viewer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, {
      type: "incoming-request",
      query: "state=awaiting&role=viewer",
    });

    const setup: Locator = card(page, "Waiting for the first heartbeat");
    await expect(setup.getByTestId("monitor-setup-hidden")).toContainText(
      "Setup details are hidden",
    );
    await expect(setup).toContainText(
      "The heartbeat URL contains this monitor's secret key, so only people who can edit monitors can see it.",
    );
    // The key was never asked for, so it cannot be anywhere in the page.
    const html: string = await page.evaluate((): string => {
      return document.body.innerHTML;
    });
    expect(html).not.toContain(secretKey("incoming-request"));
    for (const read of await overviewMonitorReads(page)) {
      expect(Object.keys(read.select || {})).not.toContain(
        "incomingRequestSecretKey",
      );
    }
  });

  test("incoming-request after data", async ({ page }: { page: Page }) => {
    await openReady(page, { type: "incoming-request" });
    await expectSettled(page);

    expect(await factLabels(page)).toEqual([
      "Missing-request window",
      "Last missing-request check",
      "Owners",
    ]);
    expect(await factValue(page, "Missing-request window")).toBe(
      "30 minutesFrom this monitor's criteria",
    );
    await expect(page.getByTestId("monitor-overview-pulse")).toContainText(
      "Last request 7 minutes ago",
    );

    const connection: Locator = card(sideColumn(page), "Heartbeat URL");
    await expect(connection).toBeVisible();
    await expect(connection.getByTestId("monitor-connection-value")).toHaveText(
      `${HEARTBEAT_HOST}/heartbeat/${secretKey("incoming-request")}`,
    );
    await expect(connection.getByTestId("monitor-connection-meta")).toHaveText(
      "Last request 7 minutes ago · POST",
    );
    // Once data arrives the setup card gives way to history and summary.
    await expect(card(page, "Send the first heartbeat")).toHaveCount(0);
    await expect(card(page, "Uptime history")).toBeVisible();
    await expect(card(page, "Monitor Summary")).toBeVisible();
  });

  test("incoming-email after data", async ({ page }: { page: Page }) => {
    await openReady(page, { type: "incoming-email" });

    await expect(page.getByTestId("monitor-overview-pulse")).toContainText(
      "Last email 2 hours ago",
    );
    const connection: Locator = card(sideColumn(page), "Inbound email address");
    await expect(connection.getByTestId("monitor-connection-value")).toHaveText(
      `monitor-${secretKey("incoming-email")}@inbound.acme-commerce.example`,
    );
    expect(await factLabels(page)).toEqual([
      "Missing-email window",
      "Last missing-email check",
      "Owners",
    ]);
  });

  test("server awaiting", async ({ page }: { page: Page }) => {
    await openReady(page, { type: "server", query: "state=awaiting" });

    await expect(headline(page)).toHaveText("Waiting for the agent to report");
    await expect(
      card(page, "Set up your Server Monitor (Linux/Mac)"),
    ).toBeVisible();
    await expect(
      card(page, "Set up your Server Monitor (Windows)"),
    ).toBeVisible();
    await expect(card(page, "Monitor Summary")).toHaveCount(0);
    await expect(statBar(page)).toHaveCount(0);
    await expect(card(page, "Server agent")).toHaveCount(0);
  });

  test("server after data", async ({ page }: { page: Page }) => {
    await openReady(page, { type: "server" });

    expect(await factLabels(page)).toEqual(["Host", "CPU", "Memory", "Owners"]);
    expect(await factValue(page, "Host")).toBe(
      "orders-db-01.eu-west-1.acme.internal",
    );
    expect(await factValue(page, "CPU")).toBe("37%");
    expect(await factValue(page, "Memory")).toBe("62%");
    const connection: Locator = card(sideColumn(page), "Server agent");
    await expect(connection.getByTestId("monitor-connection-value")).toHaveText(
      "orders-db-01.eu-west-1.acme.internal",
    );
    await expect(card(page, "Monitor Summary")).toBeVisible();
  });

  test("kubernetes", async ({ page }: { page: Page }) => {
    await openReady(page, { type: "kubernetes" });
    await expectSettled(page);

    expect(await factLabels(page)).toEqual(["Evaluates", "Criteria", "Owners"]);
    expect(await factValue(page, "Evaluates")).toBe("Every minute");
    expect(await factValue(page, "Criteria")).toBe("2 steps");
    await expect(
      hero(page).getByRole("link", { name: "2 steps" }),
    ).toHaveAttribute("href", `${monitorPath("kubernetes")}/criteria`);
    await expect(page.getByTestId("monitor-overview-pulse")).toContainText(
      "Last evaluated",
    );
    await expect(card(page, "Probes")).toHaveCount(0);
    await expect(card(page, "Response time")).toHaveCount(0);
    expect(await cardTitles(sideColumn(page))).toEqual([
      "Open incidents & alerts",
      "Recent status changes",
      "Details",
    ]);
  });

  test("kubernetes whose evaluations stopped landing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { type: "kubernetes", query: "state=stale" });
    await expectSettled(page);

    /*
     * The worker stamped the monitor 40 seconds ago, but it stamps when it
     * queues an evaluation. The newest evaluation in the log is 14 minutes
     * old, and that is what the page goes by.
     */
    await expect(
      page.getByTestId("monitor-overview-secondary-badge"),
    ).toHaveText(["Checks overdue"]);
    await expect(page.getByTestId("monitor-overview-explanation")).toHaveText(
      "No evaluation for 14m, but this monitor is evaluated every minute.",
    );
    await expect(page.getByTestId("monitor-overview-pulse")).toContainText(
      "Last evaluated 14 minutes ago",
    );
  });

  test("network-device", async ({ page }: { page: Page }) => {
    await openReady(page, { type: "network-device" });

    expect(await factLabels(page)).toEqual(["Device", "Evaluated", "Owners"]);
    await expect(
      hero(page).getByRole("link", { name: "View device" }),
    ).toHaveAttribute(
      "href",
      `${DASHBOARD}/network-devices/${NETWORK_DEVICE_ID}`,
    );
    expect(await factValue(page, "Evaluated")).toBe(
      "On every poll and matching trap",
    );
    // Nobody owns this one, and the hero says so rather than showing nothing.
    const owners: Locator = page.getByTestId("monitor-overview-fact-owners");
    await expect(owners).toContainText("No owners");
    await expect(
      owners.getByRole("link", { name: "Add owners" }),
    ).toHaveAttribute("href", `${monitorPath("network-device")}/owners`);

    await hero(page).getByRole("link", { name: "View device" }).click();
    await expect(page.getByTestId("stub-page")).toHaveAttribute(
      "data-page",
      "NETWORK_DEVICE_VIEW",
    );
  });

  test("manual", async ({ page }: { page: Page }) => {
    await openReady(page, { type: "manual" });
    await expectSettled(page);

    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Operational",
    );
    await expect(
      page.getByTestId("monitor-overview-secondary-badge"),
    ).toHaveText(["Manual"]);
    await expect(page.getByTestId("monitor-overview-pulse")).toHaveText(
      /No automated checks/,
    );
    expect(await factLabels(page)).toEqual(["Checks", "Owners"]);
    const guide: Locator = card(sideColumn(page), "Manual monitor");
    await expect(guide).toBeVisible();
    await expect(
      guide.getByRole("link", { name: "Open status timeline" }),
    ).toHaveAttribute("href", `${monitorPath("manual")}/status-timeline`);
    await expect(card(page, "Monitor Summary")).toHaveCount(0);
    // Nothing evaluates a manual monitor, so there is no log to read.
    expect(await listRequestsFor(page, /^MonitorLog/)).toHaveLength(0);
    await screenshot(page, "monitor-overview-manual");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Roles
 * ---------------------------------------------------------------------------
 */

test.describe("roles", () => {
  test("role=monitor-viewer", async ({ page }: { page: Page }) => {
    await openReady(page, { query: "role=monitor-viewer" });
    await expectSettled(page);

    await expect(headline(page)).toHaveText(/^Operational for/);
    // Unknown is not zero: both sides read "—".
    await expect(page.getByTestId("monitor-open-now-value")).toHaveText(
      "— incidents · — alerts",
    );
    const openNow: StatCell | undefined = (await statCells(page))[3];
    expect(openNow?.description).toBe("Incidents and alerts hidden: no access");
    await expect(
      card(page, "Open incidents & alerts").getByTestId(
        "monitor-open-work-no-access",
      ),
    ).toBeVisible();

    const fallback: Locator = page.getByTestId(
      "monitor-response-time-fallback",
    );
    await expect(fallback).toContainText(
      "Response-time history needs permission to read telemetry.",
    );
    await expect(fallback).toContainText(
      "Latest: 243 ms median across 3 probes (182–311 ms)",
    );

    const state: FixtureState = await fixture(page);
    expect(
      state.listRequests.filter((request: RecordedModelRequest): boolean => {
        return ["Incident", "Alert"].includes(request.modelName);
      }),
      "incident and alert reads",
    ).toEqual([]);
    expect(state.aggregateRequests, "metric reads").toEqual([]);
  });

  test("role=viewer sees everything but the secret keys", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { query: "role=viewer" });
    await expectSettled(page);

    await expect(uptimeBars(page)).toHaveCount(90);
    await expect(page.getByTestId("monitor-open-now-value")).toHaveCount(0);
    expect((await statCells(page))[3]?.value).toBe("Nothing open");
    await expect(card(page, "Response time")).toContainText("3 series");
    for (const read of await overviewMonitorReads(page)) {
      expect(Object.keys(read.select || {})).not.toContain(
        "serverMonitorSecretKey",
      );
    }
  });

  test("role=read-project-monitor", async ({ page }: { page: Page }) => {
    await openReady(page, { query: "role=read-project-monitor" });

    // Without the timeline rows nothing vouches for how long it has held.
    await expect(headline(page)).toHaveText("Operational");
    await expect(headline(page)).not.toContainText(" for ");

    await expect
      .poll(async (): Promise<Array<string>> => {
        return (await statCells(page))
          .slice(0, 3)
          .map((cell: StatCell): string => {
            return `${cell.value}|${cell.description || ""}`;
          });
      })
      .toEqual([
        "—|No access to status history",
        "—|No access to status history",
        "—|No access to status history",
      ]);
    const history: Locator = card(page, "Uptime history");
    await expect(history.getByTestId("monitor-uptime-forbidden")).toContainText(
      "Uptime history is hidden",
    );
    await expect(uptimeBars(page)).toHaveCount(0);
    await expect(
      card(page, "Recent activity").getByTestId("monitor-activity-hidden"),
    ).toBeVisible();
    expect(await factValue(page, "Latest result")).toBe("Unavailable");

    const state: FixtureState = await fixture(page);
    expect(
      state.listRequests.filter((request: RecordedModelRequest): boolean => {
        return [
          "MonitorProbe",
          "MonitorStatusTimeline",
          "MonitorFeed",
        ].includes(request.modelName);
      }),
      "reads the role cannot make",
    ).toEqual([]);
    expect(await apiRequestsTo(page, "/monitor/uptime-summary/")).toHaveLength(
      0,
    );
    await screenshot(page, "monitor-overview-read-only");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Failures
 * ---------------------------------------------------------------------------
 */

test.describe("failures", () => {
  test("fail=uptime-summary then retry", async ({ page }: { page: Page }) => {
    await openReady(page, { query: "fail=uptime-summary" });

    const history: Locator = card(page, "Uptime history");
    const error: Locator = history.getByTestId("monitor-uptime-error");
    await expect(error).toContainText("Couldn't load uptime history");
    await expect(error).toContainText(
      "The uptime history could not be computed.",
    );
    expect((await statCells(page))[0]).toEqual({
      label: "Uptime · 24 hours",
      value: "—",
      description: "Uptime is unavailable",
    });

    await history.getByRole("button", { name: "Try again" }).click();
    await expect(uptimeBars(page)).toHaveCount(90);
    await expect(error).toHaveCount(0);
    expect((await statCells(page))[0]?.value).toBe("100%");
    expect(await apiRequestsTo(page, "/monitor/uptime-summary/")).toHaveLength(
      2,
    );
  });

  test("fail=monitor", async ({ page }: { page: Page }) => {
    await open(page, { query: "fail=monitor" });

    // The layout and header still load; only the overview's read failed.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Monitor - Checkout API",
    );
    await expect(
      page.getByText("The monitor could not be read. The API is restarting."),
    ).toBeVisible();
    await expect(hero(page)).toHaveCount(0);

    await page.getByTestId("refresh-button").click();
    await expect(hero(page)).toBeVisible();
    await expect(headline(page)).toHaveText(/^Operational for/);
    expect(await overviewMonitorReads(page)).toHaveLength(2);
    // Retrying the page does not repeat the one-off status repair.
    expect(await apiRequestsTo(page, "/monitor/refresh-status/")).toHaveLength(
      1,
    );
  });

  test("fail=refresh-status", async ({ page }: { page: Page }) => {
    await openReady(page, { query: "fail=refresh-status" });
    await expectSettled(page);

    await expect(headline(page)).toHaveText(/^Operational for/);
    await expect(
      page.getByTestId("monitor-overview-refresh-error"),
    ).toHaveCount(0);
    expect(await apiRequestsTo(page, "/monitor/refresh-status/")).toHaveLength(
      1,
    );
  });

  test("fail=probes keeps the page and says the probes are unknown", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { query: "fail=probes" });

    await expect(card(page, "Probes")).toContainText(
      "Couldn't load probes. Probe results could not be read.",
    );
    await expect(card(page, "Monitor Summary")).toContainText(
      "Probe results are unavailable.",
    );
    expect(await factValue(page, "Probes")).toBe("Unavailable");
    await expect(page.getByTestId("monitor-overview-pulse")).toContainText(
      "Last checked: unavailable",
    );
    // Unknown probes are never "no probes".
    await expect(page.getByText("No probes attached.")).toHaveCount(0);
  });

  test("fail=incidents shows the alerts it could read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { query: "state=offline&fail=incidents" });
    await expectSettled(page);

    await expect(page.getByTestId("monitor-open-now-value")).toHaveText(
      "— incidents · 1 alert",
    );
    expect((await statCells(page))[3]?.description).toBe(
      "Couldn't load open incidents",
    );
    await expect(page.getByTestId("monitor-open-work-footer")).toContainText(
      "Couldn't load incidents. Incidents could not be read.",
    );
    await expect(page.getByTestId("monitor-uptime-footnote")).toContainText(
      "Incident markers are unavailable.",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Refresh, polling and navigation
 * ---------------------------------------------------------------------------
 */

test.describe("refresh and polling", () => {
  test("refresh in place", async ({ page }: { page: Page }) => {
    await openReady(page);
    await expectSettled(page);

    const readsBefore: number = (await overviewMonitorReads(page)).length;
    await watchForSkeleton(page);
    await page.getByTestId("monitor-overview-refresh").click();

    await expect
      .poll(async (): Promise<number> => {
        return (await overviewMonitorReads(page)).length;
      })
      .toBeGreaterThan(readsBefore);
    // A manual refresh reloads the uptime history too.
    await expect
      .poll(async (): Promise<number> => {
        return (await apiRequestsTo(page, "/monitor/uptime-summary/")).length;
      })
      .toBe(2);
    await expect(page.getByTestId("monitor-overview-refresh")).toBeEnabled();

    expect(await skeletonWasSeen(page)).toBe(false);
    await expect(uptimeBars(page)).toHaveCount(90);
    expect(await apiRequestsTo(page, "/monitor/refresh-status/")).toHaveLength(
      1,
    );
    // The manual refresh reads the probes with their results.
    const probeReads: Array<RecordedModelRequest> = await listRequestsFor(
      page,
      /^MonitorProbe$/,
    );
    expect(
      Object.keys(probeReads[probeReads.length - 1]?.select || {}),
    ).toContain("lastMonitoringLog");
  });

  test("polling", async ({ page }: { page: Page }) => {
    await openReady(page, { clock: "installed" });
    await expectSettled(page);

    const monitorReads: number = (await overviewMonitorReads(page)).length;
    const probeReads: number = (await listRequestsFor(page, /^MonitorProbe$/))
      .length;
    const timelineReads: number = (
      await listRequestsFor(page, /^MonitorStatusTimeline$/)
    ).length;
    expect(await apiRequestsTo(page, "/monitor/uptime-summary/")).toHaveLength(
      1,
    );

    await page.clock.fastForward(60000);
    await expect
      .poll(async (): Promise<number> => {
        return (await overviewMonitorReads(page)).length;
      })
      .toBe(monitorReads + 1);
    await expect
      .poll(async (): Promise<number> => {
        return (await listRequestsFor(page, /^MonitorStatusTimeline$/)).length;
      })
      .toBe(timelineReads + 1);
    const probeRequests: Array<RecordedModelRequest> = await listRequestsFor(
      page,
      /^MonitorProbe$/,
    );
    expect(probeRequests).toHaveLength(probeReads + 1);
    // Polls read the probes LIGHT: no results, so no screenshots either.
    expect(
      Object.keys(probeRequests[probeRequests.length - 1]?.select || {}),
    ).not.toContain("lastMonitoringLog");
    expect(await apiRequestsTo(page, "/monitor/uptime-summary/")).toHaveLength(
      1,
    );

    // Four more polls: the fifth reloads the uptime history.
    for (let poll: number = 2; poll <= 5; poll++) {
      await page.clock.fastForward(60000);
      await expect
        .poll(async (): Promise<number> => {
          return (await overviewMonitorReads(page)).length;
        })
        .toBe(monitorReads + poll);
    }
    await expect
      .poll(async (): Promise<number> => {
        return (await apiRequestsTo(page, "/monitor/uptime-summary/")).length;
      })
      .toBe(2);
    // Nothing ever asked for the full probe rows again.
    for (const request of (await listRequestsFor(page, /^MonitorProbe$/)).slice(
      probeReads,
    )) {
      expect(Object.keys(request.select || {})).not.toContain(
        "lastMonitoringLog",
      );
    }
    expect(await apiRequestsTo(page, "/monitor/refresh-status/")).toHaveLength(
      1,
    );
  });

  test("recorded requests", async ({ page }: { page: Page }) => {
    await openReady(page);
    await expectSettled(page);

    // Both custom routes carry the tenant header.
    for (const route of [
      "/monitor/refresh-status/",
      "/monitor/uptime-summary/",
    ]) {
      const requests: Array<RecordedApiRequest> = await apiRequestsTo(
        page,
        route,
      );
      expect(requests, route).toHaveLength(1);
      expect(requests[0]?.headers["tenantid"], route).toBe(PROJECT_ID);
      expect(requests[0]?.url, route).toContain(monitorId("api"));
    }
    const summaryUrl: URL = new URL(
      (await apiRequestsTo(page, "/monitor/uptime-summary/"))[0]!.url,
    );
    expect(summaryUrl.searchParams.get("timezone")).toBe("UTC");

    // The monitor's own probe rows, not every probe in the project.
    const probeRead: RecordedModelRequest | undefined = (
      await listRequestsFor(page, /^MonitorProbe$/)
    )[0];
    expect(Object.keys(probeRead?.query || {})).toEqual(["monitorId"]);
    expect(JSON.stringify(probeRead?.query)).toContain(monitorId("api"));
    expect(probeRead?.sort).toEqual({ createdAt: "DESC" });
    expect(Object.keys(probeRead?.select || {})).toContain("lastMonitoringLog");
    expect(await listRequestsFor(page, /^Probe$/)).toHaveLength(0);

    // The newest five status rows.
    const timelineRead: RecordedModelRequest | undefined = (
      await listRequestsFor(page, /^MonitorStatusTimeline$/)
    )[0];
    expect(timelineRead?.limit).toBe(5);
    expect(timelineRead?.sort).toEqual({ startsAt: "DESC" });
    expect(Object.keys(timelineRead?.query || {}).sort()).toEqual([
      "monitorId",
      "projectId",
    ]);
    // The statuses come with the uptime summary; the table is not read.
    expect(await listRequestsFor(page, /^MonitorStatus$/)).toHaveLength(0);

    // One evaluation log read, sized for two results per enabled probe.
    const logReads: Array<RecordedModelRequest> = await listRequestsFor(
      page,
      /^MonitorLog/,
    );
    expect(logReads).toHaveLength(1);
    expect(logReads[0]?.analytics).toBe(true);
    expect(logReads[0]?.limit).toBe(6);
    expect(logReads[0]?.select).toEqual({ time: true, logBody: true });

    // Open work filters on unresolved states; each list is read once.
    const openIncidentReads: Array<RecordedModelRequest> = (
      await listRequestsFor(page, /^Incident$/)
    ).filter((request: RecordedModelRequest): boolean => {
      return Boolean(request.query?.["currentIncidentStateId"]);
    });
    expect(openIncidentReads).toHaveLength(1);
    expect(openIncidentReads[0]?.limit).toBe(5);
    const openAlertReads: Array<RecordedModelRequest> = (
      await listRequestsFor(page, /^Alert$/)
    ).filter((request: RecordedModelRequest): boolean => {
      return Boolean(request.query?.["currentAlertStateId"]);
    });
    expect(openAlertReads).toHaveLength(1);
    expect(JSON.stringify(openAlertReads[0]?.query)).toContain(
      monitorId("api"),
    );
  });

  test("moving to another monitor via a fixture link", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { query: "state=offline&nav=1" });
    await expectSettled(page);
    await expect(page.getByTestId("monitor-open-now-value")).toHaveText(
      "1 incident · 1 alert",
    );

    await watchForSkeleton(page);
    await page.getByTestId("fixture-link-website").click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Monitor - Storefront",
    );
    await expect(headline(page)).toHaveText(/^Operational for/);
    expect(new URL(page.url()).pathname).toBe(monitorPath("website"));
    expect(await skeletonWasSeen(page)).toBe(true);
    await expectSettled(page);

    // Nothing of the Checkout API is left on the page.
    await expect(page.getByTestId("monitor-overview-target-value")).toHaveText(
      "https://shop.acme-commerce.example/",
    );
    await expect(page.getByText("Checkout API is returning 503s")).toHaveCount(
      0,
    );
    await expect(page.getByText(/api\.acme-commerce\.example/)).toHaveCount(0);
    expect((await statCells(page))[3]?.value).toBe("Nothing open");
    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Operational",
    );
    // The new monitor gets its own one-off status repair.
    expect(
      (await apiRequestsTo(page, "/monitor/refresh-status/")).map(
        (request: RecordedApiRequest): string => {
          return request.url.split("/").pop() || "";
        },
      ),
    ).toEqual([monitorId("api"), monitorId("website")]);
  });

  test("a hero call to action lands on the monitor's sub-page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { query: "state=stale" });
    await hero(page).getByRole("link", { name: "Check probes" }).click();
    await expect(page.getByTestId("stub-page")).toHaveAttribute(
      "data-page",
      "MONITOR_VIEW_PROBES",
    );
    expect(new URL(page.url()).pathname).toBe(`${monitorPath("api")}/probes`);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Responsive and theme
 * ---------------------------------------------------------------------------
 */

test.describe("responsive", () => {
  test("responsive 390", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(page);
    await expectSettled(page);

    await expectNoHorizontalOverflow(page);

    // The strip scrolls inside its card and starts at today.
    const strip: Locator = page.getByTestId("monitor-uptime-strip");
    const scroll: { scrollWidth: number; clientWidth: number; left: number } =
      await strip.evaluate(
        (
          element: Element,
        ): { scrollWidth: number; clientWidth: number; left: number } => {
          return {
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            left: element.scrollLeft,
          };
        },
      );
    expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
    expect(scroll.left).toBeGreaterThanOrEqual(
      scroll.scrollWidth - scroll.clientWidth - 2,
    );
    /*
     * The date labels scroll with the bars: "Today" sits under today's bar
     * and the first day under the first bar, which is out of view to the
     * left, never under whatever bar the strip starts on.
     */
    const startLabel: Locator = strip.getByText("Jun 24", { exact: true });
    const todayLabel: Locator = strip.getByText("Today", { exact: true });
    await expect(startLabel, "first-day label inside the strip").toHaveCount(1);
    await expect(todayLabel, "today label inside the strip").toHaveCount(1);
    const firstBar: Box = await documentBox(uptimeBars(page).first());
    const lastBar: Box = await documentBox(uptimeBars(page).last());
    const startBox: Box = await documentBox(startLabel);
    const todayBox: Box = await documentBox(todayLabel);
    expect(Math.abs(startBox.x - firstBar.x)).toBeLessThanOrEqual(2);
    expect(
      Math.abs(todayBox.x + todayBox.width - (lastBar.x + lastBar.width)),
    ).toBeLessThanOrEqual(2);
    // Scrolls the page to the strip; the strip itself stays at today.
    await strip.scrollIntoViewIfNeeded();
    await expect(todayLabel).toBeInViewport();
    await expect(startLabel).not.toBeInViewport();

    // Facts stack into one column.
    const facts: Locator = page
      .getByTestId("monitor-overview-facts")
      .locator(":scope > div");
    const firstFact: Box = await documentBox(facts.nth(0));
    const secondFact: Box = await documentBox(facts.nth(1));
    expect(secondFact.y).toBeGreaterThanOrEqual(firstFact.y + firstFact.height);
    expect(Math.abs(secondFact.x - firstFact.x)).toBeLessThanOrEqual(1);

    // So does the stat bar.
    const cells: Locator = statBar(page).locator(":scope > div");
    const firstCell: Box = await documentBox(cells.nth(0));
    const secondCell: Box = await documentBox(cells.nth(1));
    expect(secondCell.y).toBeGreaterThanOrEqual(firstCell.y + firstCell.height);
    await expectResponseTimePlotHeight(page);

    // The icon tile is hidden on a phone.
    await expect(page.getByTestId("monitor-overview-icon")).toBeHidden();
    await screenshot(page, "monitor-overview-mobile");
    // The first screen a phone shows: the hero and the stat bar.
    await page.evaluate((): void => {
      window.scrollTo(0, 0);
    });
    await screenshot(page, "monitor-overview-mobile-top", { fullPage: false });
  });

  const PHONE_SCENARIOS: Array<[MonitorTypeKey, string]> = [
    ["website", ""],
    ["ssl", ""],
    ["incoming-request", ""],
    ["incoming-request", "state=awaiting"],
    ["incoming-email", ""],
    ["server", ""],
    ["server", "state=awaiting"],
    ["kubernetes", ""],
    ["network-device", ""],
    ["manual", ""],
  ];

  for (const [type, query] of PHONE_SCENARIOS) {
    test(`${type}${query ? ` (${query})` : ""} does not scroll sideways at 390px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openReady(page, { type, query });
      await expectSettled(page);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("responsive 768", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openReady(page);
    await expectSettled(page);

    await expectNoHorizontalOverflow(page);

    // The stat bar is 2 x 2.
    const cells: Locator = statBar(page).locator(":scope > div");
    const boxes: Array<Box> = [];
    for (let index: number = 0; index < 4; index++) {
      boxes.push(await documentBox(cells.nth(index)));
    }
    expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThanOrEqual(1);
    expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x);
    expect(boxes[2]!.y).toBeGreaterThanOrEqual(boxes[0]!.y + boxes[0]!.height);
    expect(Math.abs(boxes[2]!.x - boxes[0]!.x)).toBeLessThanOrEqual(1);

    // One column: the side cards follow the feed.
    await expectAbove(
      card(page, "Recent activity"),
      card(page, "Open incidents & alerts"),
      "side cards below the feed",
    );

    /*
     * Cards with a row of controls keep their titles whole: the controls sit
     * under the title rather than squeezing it to a word or two.
     */
    for (const heading of ["Response time", "Monitor Summary"]) {
      const withControls: Locator = card(page, heading);
      const title: Box = await documentBox(
        withControls.getByTestId("card-details-heading").first(),
      );
      const cardBox: Box = await documentBox(withControls);
      expect(title.width, `${heading} title width`).toBeGreaterThan(
        cardBox.width * 0.8,
      );
    }
    await expectResponseTimePlotHeight(page);
    await screenshot(page, "monitor-overview-tablet");
  });

  test("responsive 1280", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReady(page);
    await expectSettled(page);

    await expectNoHorizontalOverflow(page);
    const main: Box = await documentBox(mainColumn(page));
    const side: Box = await documentBox(sideColumn(page));
    // Two thirds and one third, side by side.
    expect(side.x).toBeGreaterThanOrEqual(main.x + main.width);
    expect(Math.abs(side.y - main.y)).toBeLessThanOrEqual(1);
    expect(main.width / side.width).toBeGreaterThan(1.7);
    expect(main.width / side.width).toBeLessThan(2.3);

    const history: Box = await documentBox(card(page, "Uptime history"));
    const openWork: Box = await documentBox(
      card(page, "Open incidents & alerts"),
    );
    expect(openWork.x).toBeGreaterThanOrEqual(history.x + history.width);
    // Side-card titles are not squeezed.
    const title: Box = await documentBox(
      card(page, "Open incidents & alerts").getByRole("heading", { level: 2 }),
    );
    expect(title.width).toBeGreaterThan(120);
  });

  test("the summary card's title keeps the column's width", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);
    await expectSettled(page);

    const summary: Locator = card(page, "Monitor Summary");
    const title: Box = await documentBox(
      summary.getByTestId("card-details-heading"),
    );
    const cardBox: Box = await documentBox(summary);
    // The picker and Test Monitor sit on their own row under it.
    expect(title.width).toBeGreaterThan(cardBox.width * 0.8);
    await expectAbove(
      summary.getByTestId("card-description"),
      summary.getByRole("combobox", { name: "Showing results from:" }),
      "picker under the description",
    );
  });

  test("dark theme", async ({ page }: { page: Page }) => {
    await openReady(page, { query: "theme=dark" });
    await expectSettled(page);

    expect(await backgroundColor(hero(page))).not.toBe(WHITE_RGB);
    expect(luminance(await textColor(headline(page)))).toBeGreaterThan(0.6);
    // Every card surface follows the theme, not just the hero.
    const surfaces: Array<string> = await page
      .locator("[data-testid='card'] > div")
      .evaluateAll((elements: Array<Element>): Array<string> => {
        return elements.map((element: Element): string => {
          return getComputedStyle(element).backgroundColor;
        });
      });
    expect(surfaces.length).toBeGreaterThan(4);
    expect(surfaces).not.toContain(WHITE_RGB);
    expect(
      await backgroundColor(statBar(page).locator(":scope > div").first()),
    ).not.toBe(WHITE_RGB);
    await screenshot(page, "monitor-overview-dark");
  });
});
