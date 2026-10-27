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

// The fixture server's port: MONITOR_OVERVIEW_FIXTURE_PORT, as the config and server.js read it.
const PORT: string = process.env["MONITOR_OVERVIEW_FIXTURE_PORT"] || "4223";
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
const INCOMING_EMAIL_ADDRESS: string = `monitor-${secretKey("incoming-email")}@inbound.acme-commerce.example`;

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

interface RecordedUpdate {
  modelName: string;
  id: string;
  data: Record<string, unknown>;
}

// A create the fixture was sent: Create Monitor's, or a status event's.
interface RecordedCreate {
  modelName: string;
  formType: string;
  data: Record<string, unknown>;
}

interface FixtureState {
  now: string;
  scenario: Record<string, unknown>;
  getItemRequests: Array<RecordedModelRequest>;
  listRequests: Array<RecordedModelRequest>;
  countRequests: Array<RecordedModelRequest>;
  aggregateRequests: Array<RecordedAggregate>;
  apiRequests: Array<RecordedApiRequest>;
  updates: Array<RecordedUpdate>;
  creates: Array<RecordedCreate>;
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

/*
 * Where a card header keeps what the card offers (Edit, Test Monitor, the
 * probe picker, a link): at the header's right edge, and under the title
 * only when it does not fit beside it - never at the left, never centred.
 * "Why are edit buttons not on the right?" And the description stays right
 * under the title ("There's a lot of gap between the title of the card and
 * the description of the card"): beside the title the actions come before
 * it, which runs under both; on a line of their own they follow it.
 */
async function expectHeaderActionsOnTheRight(
  cardLocator: Locator,
  label: string,
  options?: { onTitleLine?: boolean | undefined } | undefined,
): Promise<void> {
  const header: Locator = cardLocator.getByTestId("card-header").first();
  const title: Box = await documentBox(
    header.getByTestId("card-details-heading"),
  );
  const actions: Box = await documentBox(
    header.getByTestId("card-header-actions"),
  );
  const headerBox: Box = await documentBox(header);
  const isOnTitleLine: boolean =
    actions.y < title.y + title.height && actions.y + actions.height > title.y;

  expect(
    Math.abs(headerBox.x + headerBox.width - (actions.x + actions.width)),
    `${label} ends at the header's right edge`,
  ).toBeLessThanOrEqual(1);

  if (isOnTitleLine) {
    expect(actions.x, `${label} sits right of the title`).toBeGreaterThan(
      title.x + 1,
    );
  } else {
    expect(
      actions.y,
      `${label} is under the title when it is not beside it`,
    ).toBeGreaterThanOrEqual(title.y + title.height - 1);
  }

  if (options?.onTitleLine !== undefined) {
    expect(isOnTitleLine, `${label} on the title's line`).toBe(
      options.onTitleLine,
    );
  }

  /*
   * The description stays right under the title: beside the title the
   * actions come before it (it runs under both, or beside them in the
   * default header); on a line of their own they follow it.
   */
  const description: Locator = header.getByTestId("card-description");
  if ((await description.count()) > 0 && (await description.isVisible())) {
    const descriptionBox: Box = await documentBox(description);

    if (isOnTitleLine) {
      expect(actions.y, `${label} is not under the description`).toBeLessThan(
        descriptionBox.y + 1,
      );
    } else {
      expect(
        descriptionBox.y - (title.y + title.height),
        `${label}'s description right under the title`,
      ).toBeLessThanOrEqual(7);
      expect(
        actions.y,
        `${label} follows the description on a line of its own`,
      ).toBeGreaterThanOrEqual(descriptionBox.y + descriptionBox.height - 1);
    }
  }
}

function hero(page: Page): Locator {
  return page.getByTestId("monitor-overview-hero");
}

// The hero's top right: when the data was read, Refresh and the ⋯.
function heroActions(page: Page): Locator {
  return hero(page).getByRole("group", { name: "Monitor actions" });
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
      "Linked Resources",
    ]);
    /*
     * What the monitor watches beyond its own configuration (the cluster,
     * hosts, databases or services behind it), on its own card under
     * Details. This monitor links nothing yet: the card says so in place
     * and offers Edit, rather than failing or hiding itself.
     */
    const linkedResources: Locator = card(sideColumn(page), "Linked Resources");
    await expect(
      linkedResources.getByTestId("affected-resources-empty"),
    ).toContainText("Not linked to anything yet.");
    await expect(
      linkedResources
        .getByTestId("card-header-actions")
        .getByRole("button", { name: "Edit" }),
    ).toBeEnabled();
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

  /*
   * "Can you also show created along the same lines as ID so it doesn't take
   * space up top." The Details card used to end with a Created row - a
   * label, a clock and the date - above the ID line. When the monitor was
   * created is on that line now, after the ID.
   */
  test("the Details card says when the monitor was created on its ID line, not in a row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);
    await expectSettled(page);

    const details: Locator = card(sideColumn(page), "Details");
    const labels: Array<string> = (
      await details.locator("label").allInnerTexts()
    )
      .map((text: string): string => {
        return text.trim();
      })
      .filter((text: string): boolean => {
        return text.length > 0;
      });

    expect(labels).toEqual(["Name", "Description", "Labels", "Monitor Type"]);

    const recordLine: Locator = details.getByTestId("detail-record-line");
    const idLine: Locator = recordLine.getByTestId("detail-id-line");
    const created: Locator = recordLine.getByTestId("detail-created-at");
    const createdValue: Locator = created.getByTestId(
      "detail-created-at-value",
    );

    await expect(idLine.getByTestId("detail-id-label")).toHaveText("ID");
    await expect(created.getByTestId("detail-created-at-label")).toHaveText(
      "Created",
    );
    await expect(createdValue).toHaveText("Mar 02 2026, 09:30 AM GMT");
    await expect(createdValue).toHaveAttribute(
      "datetime",
      "2026-03-02T09:30:00.000Z",
    );

    // After the ID on its line, or under it, whole, when the column is narrow.
    const lineBox: Box = await documentBox(recordLine);
    const idBox: Box = await documentBox(idLine);
    const createdBox: Box = await documentBox(created);
    if (idBox.width + createdBox.width + 16 <= lineBox.width) {
      expect(
        Math.abs(
          createdBox.y + createdBox.height / 2 - (idBox.y + idBox.height / 2),
        ),
        "Created sits level with the ID",
      ).toBeLessThanOrEqual(2);
      expect(createdBox.x, "after the ID").toBeGreaterThan(
        idBox.x + idBox.width,
      );
    } else {
      expect(createdBox.y, "under the ID, whole").toBeGreaterThanOrEqual(
        idBox.y + idBox.height - 1,
      );
    }
    await expectAbove(
      details.locator("label").last(),
      recordLine,
      "the line ends the card",
    );

    // The time to the second, on hover.
    await createdValue.hover();
    await expect(page.getByRole("tooltip")).toHaveText(
      "Mar 02 2026, 09:30:00 AM GMT",
    );
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

    /*
     * The ongoing Offline row heads the recent changes, marked Currently
     * Active beside its status as on the full status timeline, with a live
     * duration (the pinned clock holds it at 12 minutes). Only that row is
     * marked: the closed rows below it are not in effect.
     */
    const statusChanges: Locator = page.getByTestId(
      "monitor-status-change-row",
    );
    const ongoing: Locator = statusChanges.first();
    await expect(ongoing).toContainText("Offline");
    await expect(
      ongoing.getByTestId("currently-active-indicator"),
    ).toBeVisible();
    await expect(ongoing.getByTestId("currently-active-indicator")).toHaveText(
      "Currently Active",
    );
    await expect(ongoing).toContainText(
      "for 12 minutes · started 12 minutes ago",
    );
    await expect(
      statusChanges.getByTestId("currently-active-indicator"),
    ).toHaveCount(1);
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
    // Turned back on in place, not on a trip to Settings.
    await expect(
      hero(page).getByRole("button", { name: "Turn monitoring on" }),
    ).toBeEnabled();
    await expect(
      hero(page).getByRole("link", { name: "Open settings" }),
    ).toHaveCount(0);
    // A paused monitor promises no next check.
    await expect(page.getByTestId("monitor-overview-cadence")).toHaveCount(0);
  });

  test("disabled: Turn monitoring on turns it back on, in place", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { query: "state=disabled" });

    await expect(headline(page)).toHaveText("Monitoring is turned off");

    await hero(page)
      .getByRole("button", { name: "Turn monitoring on" })
      .click();

    // It writes the one column the Monitoring switch on Settings writes.
    await expect
      .poll(async (): Promise<Array<RecordedUpdate>> => {
        return (await fixture(page)).updates;
      })
      .toEqual([
        {
          modelName: "Monitor",
          id: monitorId("api"),
          data: { disableActiveMonitoring: false },
        },
      ]);

    // The page reads the monitor again: it is checked now.
    await expect(page.getByTestId("monitor-overview-badge")).not.toHaveText(
      "Disabled",
    );
    await expect(headline(page)).not.toHaveText("Monitoring is turned off");
    await expect(
      hero(page).getByRole("button", { name: "Turn monitoring on" }),
    ).toHaveCount(0);
  });

  test("disabled, for a viewer: Turn monitoring on is locked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { query: "state=disabled&role=viewer" });

    const button: Locator = hero(page).getByRole("button", {
      name: "Turn monitoring on",
    });
    await expect(button).toBeDisabled();
    expect((await fixture(page)).updates).toEqual([]);
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

  test("awaiting incoming-email as owner", async ({ page }: { page: Page }) => {
    await openReady(page, {
      type: "incoming-email",
      query: "state=awaiting",
    });

    await expect(headline(page)).toHaveText("Waiting for the first email");
    const setup: Locator = card(page, "Incoming Email Address");
    await expect(setup).toBeVisible();
    await expect(setup.getByText(INCOMING_EMAIL_ADDRESS)).toBeVisible();
    await expect(
      setup.getByRole("button", { name: "Copy email address", exact: true }),
    ).toBeVisible();
    await expect(
      setup.getByRole("link", { name: "How to verify the address" }),
    ).toHaveAttribute(
      "href",
      "/docs/monitor/incoming-email-monitor#verifying-the-address-with-the-sender",
    );

    // Nothing has arrived, so there is nothing to chart or summarise.
    await expect(statBar(page)).toHaveCount(0);
    await expect(card(page, "Uptime history")).toHaveCount(0);
    await expect(card(page, "Monitor Summary")).toHaveCount(0);
    await expectSettled(page);
    await screenshot(page, "monitor-overview-email-setup");
  });

  test("awaiting incoming-email as viewer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, {
      type: "incoming-email",
      query: "state=awaiting&role=viewer",
    });

    const setup: Locator = card(page, "Waiting for the first email");
    await expect(setup.getByTestId("monitor-setup-hidden")).toContainText(
      "Setup details are hidden",
    );
    await expect(setup).toContainText(
      "The email address contains this monitor's secret key, so only people who can edit monitors can see it.",
    );
    const html: string = await page.evaluate((): string => {
      return document.body.innerHTML;
    });
    expect(html).not.toContain(secretKey("incoming-email"));
  });

  test("incoming-email after data", async ({ page }: { page: Page }) => {
    await openReady(page, { type: "incoming-email" });

    await expect(page.getByTestId("monitor-overview-pulse")).toContainText(
      "Last email 2 hours ago",
    );
    const connection: Locator = card(sideColumn(page), "Inbound email address");
    await expect(connection.getByTestId("monitor-connection-value")).toHaveText(
      INCOMING_EMAIL_ADDRESS,
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
      "Linked Resources",
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
    /*
     * Nobody owns this one, and the hero says so rather than showing
     * nothing - with Add owners right there (the owners section below).
     */
    const owners: Locator = page.getByTestId("monitor-overview-fact-owners");
    await expect(owners).toContainText("No owners");
    await expect(
      owners.getByRole("button", { name: "Add owners" }),
    ).toHaveAttribute("aria-haspopup", "dialog");
    await expect(owners.getByRole("link")).toHaveCount(0);

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
    // Change status is behind the ⋯ beside Refresh, not under the text.
    await expect(
      hero(page).getByRole("link", { name: "Change status" }),
    ).toHaveCount(0);
    await expect(
      heroActions(page).getByRole("button", { name: "More actions" }),
    ).toBeVisible();
    expect(await factLabels(page)).toEqual(["Checks", "Owners"]);
    const guide: Locator = card(sideColumn(page), "Manual monitor");
    await expect(guide).toBeVisible();
    // The guide sends people to the ⋯ at the top, and the timeline keeps it.
    await expect(guide).toContainText(
      "Change the status from the menu (⋯) at the top of this page. The status timeline keeps every change.",
    );
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
 * Scheduled maintenance on the uptime strip (issue #5236)
 * ---------------------------------------------------------------------------
 */

// The database upgrade's window, 08:00 to 10:00 UTC two days ago.
const MAINTENANCE_WINDOW_TEXT: RegExp =
  /^Sep 19, (08:00|8:00 AM) – (10:00|10:00 AM) (UTC|GMT)$/;

// The seeded events' ids, by title (Fixture.js, ?maintenance=1).
async function maintenanceIds(page: Page): Promise<Record<string, string>> {
  return page.evaluate((): Record<string, string> => {
    return (
      window as unknown as {
        __monitorOverviewFixture: { maintenance: Record<string, string> };
      }
    ).__monitorOverviewFixture.maintenance;
  });
}

// The colour and height of a bar's maintenance band, or null for none.
async function bandOf(
  bar: Locator,
): Promise<{ color: string; height: string } | null> {
  return bar.evaluate(
    (element: Element): { color: string; height: string } | null => {
      const style: CSSStyleDeclaration = window.getComputedStyle(
        element,
        "::before",
      );

      if (!style.content || style.content === "none") {
        return null;
      }

      return { color: style.backgroundColor, height: style.height };
    },
  );
}

test.describe("scheduled maintenance on the uptime strip", () => {
  test("bands the days the monitor's maintenance touched, and keys the band", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { query: "maintenance=1" });
    await expectSettled(page);

    const bars: Locator = uptimeBars(page);
    await expect(bars).toHaveCount(90);

    // Sep 19 (two days ago) and today, Sep 21, the last bar.
    await expect(bars.nth(87)).toHaveAttribute("data-has-maintenance", "true");
    await expect(bars.nth(89)).toHaveAttribute("data-has-maintenance", "true");
    await expect(bars.nth(88)).toHaveAttribute("data-has-maintenance", "false");
    await expect(bars.nth(0)).toHaveAttribute("data-has-maintenance", "false");

    expect(await bandOf(bars.nth(87))).toEqual({
      color: "rgb(59, 130, 246)",
      height: "4px",
    });
    expect(await bandOf(bars.nth(88))).toBeNull();

    // The band is its own layer: the day keeps the colour its statuses give it.
    expect(await backgroundColor(bars.nth(87))).not.toBe("rgb(59, 130, 246)");

    await expect(bars.nth(87)).toHaveAttribute(
      "aria-label",
      /1 scheduled maintenance event$/,
    );

    await expect(
      card(page, "Uptime history").getByRole("list", { name: "Legend" }),
    ).toContainText("Scheduled maintenance");
    await expect(
      page.getByTestId("monitor-uptime-maintenance-unavailable"),
    ).toHaveCount(0);

    // Read once, for the subject monitor, by the project's states.
    expect(await listRequestsFor(page, /^ScheduledMaintenance$/)).toHaveLength(
      1,
    );
    expect(
      (await listRequestsFor(page, /^ScheduledMaintenanceState$/)).length,
    ).toBeGreaterThan(0);

    await screenshot(page, "monitor-overview-uptime-maintenance");
  });

  test("a day's tooltip and dialog name the event, and it opens its page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { query: "maintenance=1" });
    await expectSettled(page);

    const day: Locator = uptimeBars(page).nth(87);
    await day.hover();

    const tooltip: Locator = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("Scheduled maintenance");
    await expect(tooltip).toContainText("Database upgrade");
    await expect(tooltip).toContainText("Completed");

    await page.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();

    await day.click();

    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Scheduled maintenance" }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      "No incidents were reported on this day.",
    );
    // On the reader's clock: the browser runs in UTC, which moment names GMT.
    await expect(
      dialog.getByTestId("uptime-day-maintenance-window"),
    ).toHaveText(MAINTENANCE_WINDOW_TEXT);

    await screenshot(page, "monitor-overview-uptime-maintenance-day");

    const ids: Record<string, string> = await maintenanceIds(page);

    await dialog.getByRole("button", { name: /Database upgrade/ }).click();

    await expect(page).toHaveURL(
      new RegExp(
        `/dashboard/${PROJECT_ID}/scheduled-maintenance-events/${ids["Database upgrade"]}$`,
      ),
    );
  });

  test("a read that fails keeps the strip and says the markers are missing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { query: "maintenance=1&fail=maintenance" });
    await expectSettled(page);

    await expect(uptimeBars(page)).toHaveCount(90);
    await expect(
      page.getByTestId("monitor-uptime-maintenance-unavailable"),
    ).toHaveText("Maintenance markers are unavailable.");
    await expect(
      page.locator("[data-testid='uptime-bar'][data-has-maintenance='true']"),
    ).toHaveCount(0);
  });

  test("a role that cannot read maintenance gets the strip without markers, and asks for none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { query: "maintenance=1&role=monitor-viewer" });
    await expectSettled(page);

    await expect(uptimeBars(page)).toHaveCount(90);
    await expect(
      page.getByTestId("monitor-uptime-maintenance-unavailable"),
    ).toBeVisible();
    expect(await listRequestsFor(page, /^ScheduledMaintenance$/)).toHaveLength(
      0,
    );
  });

  test("a monitor without maintenance has no band and no key", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);
    await expectSettled(page);

    await expect(
      page.locator("[data-testid='uptime-bar'][data-has-maintenance='true']"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("monitor-uptime-legend-maintenance"),
    ).toHaveCount(0);
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
 * The hero's actions: Refresh, and a manual monitor's Change status
 *
 * "Please move the change status button near the refresh button, and it
 * should be hidden behind the more button (three dots). Can you please
 * improve the refresh button as well? Make it a lot nicer and easier for
 * people to understand."
 * ---------------------------------------------------------------------------
 */

const MANUAL_STATUS_ID: Record<"operational" | "degraded" | "offline", string> =
  {
    operational: uuid("83000000", 1),
    degraded: uuid("83000000", 2),
    offline: uuid("83000000", 3),
  };

// An id as a create's JSON carries it: a string, or an ObjectID's JSON.
function idOf(value: unknown): string {
  if (value && typeof value === "object" && "value" in value) {
    return String((value as { value: unknown }).value);
  }
  return String(value);
}

async function statusEventCreates(page: Page): Promise<Array<RecordedCreate>> {
  return (await fixture(page)).creates.filter(
    (create: RecordedCreate): boolean => {
      return create.modelName === "MonitorStatusTimeline";
    },
  );
}

function moreActionsButton(page: Page): Locator {
  return heroActions(page).getByRole("button", { name: "More actions" });
}

async function menuItemTexts(page: Page): Promise<Array<string>> {
  return (
    await page.getByRole("menu").getByRole("menuitem").allInnerTexts()
  ).map((text: string): string => {
    return text.trim();
  });
}

async function openManual(page: Page, query?: string): Promise<void> {
  await openReady(page, { type: "manual", query });
  await expectSettled(page);
}

test.describe("the hero's actions", () => {
  test("Refresh is an icon button that says what it does, beside when the data was read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);
    await expectSettled(page);

    const refresh: Locator = heroActions(page).getByRole("button", {
      name: "Refresh",
    });
    await expect(refresh).toBeVisible();
    // An icon, not a word: the tooltip and its name say what it is.
    await expect(refresh).toHaveText("");
    await expect(
      heroActions(page).getByTestId("monitor-overview-refreshed-at"),
    ).toHaveText(/^Refreshed at 12:00( PM)?$/);

    await refresh.hover();
    await expect(page.locator("[data-tippy-root]")).toContainText(
      "Refresh now. This page also refreshes every minute.",
    );

    // A monitor that checks itself has no ⋯.
    await expect(moreActionsButton(page)).toHaveCount(0);

    // Refresh reads the page again, and runs no check.
    const readsBefore: number = (await overviewMonitorReads(page)).length;
    await refresh.click();
    await expect
      .poll(async (): Promise<number> => {
        return (await overviewMonitorReads(page)).length;
      })
      .toBe(readsBefore + 1);
    await expect(refresh).toHaveAttribute("aria-disabled", "false");
    expect(await apiRequestsTo(page, "/monitor/test")).toHaveLength(0);
    expect(await apiRequestsTo(page, "/monitor/refresh-status/")).toHaveLength(
      1,
    );
    await screenshot(page, "monitor-overview-refresh-control");
  });

  test("Refresh and the ⋯ keep to the top right, on the badges' line, at every width", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openManual(page);

    for (const width of [1440, 1280, 1024, 768, 640, 390]) {
      await page.setViewportSize({ width, height: 900 });

      /*
       * Measured once the page has settled at the new width: below md the
       * side menu becomes the "Navigate to" menu, and a measure taken while
       * that was under way once found Refresh 82px below the badges at
       * 640px, with the screenshot a moment later showing it on their line.
       * A layout that is wrong at a width still fails, after the timeout.
       */
      await expect(async () => {
        const heroBox: Box = await documentBox(hero(page));
        const badge: Box = await documentBox(
          page.getByTestId("monitor-overview-badge"),
        );
        const refresh: Box = await documentBox(
          heroActions(page).getByRole("button", { name: "Refresh" }),
        );
        const more: Box = await documentBox(moreActionsButton(page));
        const title: Box = await documentBox(headline(page));

        // At the right edge of the hero, the ⋯ last, Refresh before it.
        expect(
          heroBox.x + heroBox.width - (more.x + more.width),
          `${width}px: the ⋯ at the hero's right edge`,
        ).toBeLessThanOrEqual(26);
        expect(
          refresh.x + refresh.width,
          `${width}px: Refresh before the ⋯`,
        ).toBeLessThanOrEqual(more.x);
        // On the badges' line, above the headline.
        expect(
          Math.abs(
            refresh.y + refresh.height / 2 - (badge.y + badge.height / 2),
          ),
          `${width}px: Refresh on the badges' line`,
        ).toBeLessThanOrEqual(6);
        expect(
          Math.abs(more.y - refresh.y),
          `${width}px: Refresh and the ⋯ side by side`,
        ).toBeLessThanOrEqual(1);
        expect(
          refresh.y + refresh.height,
          `${width}px: the actions above the headline`,
        ).toBeLessThanOrEqual(title.y + 4);
      }).toPass({ timeout: 10000 });

      /*
       * When the data was read: beside them from xl up, left out below,
       * where the hero's text needs the room (beside the side menu at
       * 1024px) or the hero is a tablet's or a phone's.
       */
      if (width >= 1280) {
        await expect(
          heroActions(page).getByTestId("monitor-overview-refreshed-at"),
        ).toBeVisible();
      } else {
        await expect(
          heroActions(page).getByTestId("monitor-overview-refreshed-at"),
        ).toBeHidden();
      }

      /*
       * So at 1024px the actions' column holds the buttons and the pulse
       * only, and the text keeps most of the row: with the time in that
       * column, it had less than half, and the explanation ran to five
       * lines beside an empty column.
       */
      if (width === 1024) {
        const layout: Box = await documentBox(
          page.getByTestId("monitor-overview-layout"),
        );
        const state: Box = await documentBox(
          page.getByTestId("monitor-overview-state-cell"),
        );
        expect(
          state.width / layout.width,
          "1024px: the text's share of the hero",
        ).toBeGreaterThanOrEqual(0.6);
      }

      await expectNoHorizontalOverflow(page);

      if (width === 1280 || width === 390) {
        await screenshot(page, `monitor-overview-hero-actions-${width}`, {
          fullPage: false,
        });
      }
    }
  });

  test("the pulse sits under the actions from lg, and after the text below it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);
    await expectSettled(page);

    const pulse: Locator = page.getByTestId("monitor-overview-pulse");

    await page.setViewportSize({ width: 1440, height: 900 });
    const wideRefresh: Box = await documentBox(
      heroActions(page).getByRole("button", { name: "Refresh" }),
    );
    const widePulse: Box = await documentBox(pulse);
    expect(widePulse.y).toBeGreaterThanOrEqual(
      wideRefresh.y + wideRefresh.height,
    );
    expect(
      Math.abs(
        widePulse.x + widePulse.width - (wideRefresh.x + wideRefresh.width),
      ),
    ).toBeLessThanOrEqual(80);

    await page.setViewportSize({ width: 768, height: 900 });
    const target: Box = await documentBox(
      page.getByTestId("monitor-overview-target"),
    );
    const narrowPulse: Box = await documentBox(pulse);
    expect(narrowPulse.y).toBeGreaterThanOrEqual(target.y + target.height);
    expect(Math.abs(narrowPulse.x - target.x)).toBeLessThanOrEqual(2);
  });

  test("the hero's call to action starts where its text does, a button or a link", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * Button carries a left margin meant for a dialog's footer (md:ml-3),
     * which set "Turn monitoring on" 12px in from the headline above it
     * from md up, while a link such as "Check probes" lined up.
     */
    const scenarios: Array<{
      query: string;
      role: "button" | "link";
      name: string;
    }> = [
      { query: "state=disabled", role: "button", name: "Turn monitoring on" },
      // Locked, the button sits in the span its tooltip needs.
      {
        query: "state=disabled&role=viewer",
        role: "button",
        name: "Turn monitoring on",
      },
      { query: "state=stale", role: "link", name: "Check probes" },
    ];

    for (const scenario of scenarios) {
      await openReady(page, { query: scenario.query });

      for (const width of [1440, 1024, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });

        const action: Box = await documentBox(
          page
            .getByTestId("monitor-overview-call-to-action")
            .getByRole(scenario.role, { name: scenario.name }),
        );
        const title: Box = await documentBox(headline(page));

        expect(
          Math.abs(action.x - title.x),
          `${scenario.query}, ${width}px: ${scenario.name} starts where the headline does`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  test("manual: a status picked from the ⋯ is recorded, and the hero shows it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openManual(page);

    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Operational",
    );

    await moreActionsButton(page).click();
    const menu: Locator = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("CHANGE STATUS TO");
    expect(await menuItemTexts(page)).toEqual(["Degraded", "Offline"]);

    // Each status in its own colour, as the status pickers draw it.
    const dots: Array<string> = await menu
      .getByTestId("more-menu-item-color")
      .locator(":scope > span")
      .evaluateAll((elements: Array<Element>): Array<string> => {
        return elements.map((element: Element): string => {
          return getComputedStyle(element).backgroundColor;
        });
      });
    expect(dots).toEqual(["rgb(245, 158, 11)", OFFLINE_RGB]);

    await screenshot(page, "monitor-overview-change-status-menu", {
      fullPage: false,
    });

    await menu.getByRole("menuitem", { name: "Offline" }).click();

    const dialog: Locator = page.getByTestId("modal");
    await expect(dialog.getByTestId("modal-title")).toHaveText(
      "Change status to Offline?",
    );
    await expect(dialog.getByTestId("confirm-modal-description")).toHaveText(
      "The monitor shows Offline from now on, here and on every status page that lists it.",
    );
    await screenshot(page, "monitor-overview-change-status-dialog", {
      fullPage: false,
    });

    await dialog.getByRole("button", { name: "Change status" }).click();
    await expect(dialog).toHaveCount(0);

    // The dialog is gone, so a screen reader is told in words.
    const announcement: Locator = heroActions(page)
      .getByRole("status")
      .and(page.getByTestId("monitor-overview-change-status-announcement"));
    await expect(announcement).toHaveText("Status changed to Offline.");
    // The focus is back on the ⋯ the change started from.
    await expect(moreActionsButton(page)).toBeFocused();

    const creates: Array<RecordedCreate> = await statusEventCreates(page);
    expect(creates).toHaveLength(1);
    expect(idOf(creates[0]!.data["monitorId"])).toBe(monitorId("manual"));
    expect(idOf(creates[0]!.data["monitorStatusId"])).toBe(
      MANUAL_STATUS_ID.offline,
    );
    // The server starts it at its own now.
    expect(creates[0]!.data["startsAt"]).toBeUndefined();

    // The page reads the monitor again and shows the new status.
    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Offline",
    );
    await expect(headline(page)).toHaveText(/^Offline/);
    await expect(page.getByTestId("monitor-overview-icon")).toHaveClass(
      /bg-red-50/,
    );

    // The menu now offers the status the monitor left.
    await moreActionsButton(page).click();
    expect(await menuItemTexts(page)).toEqual(["Operational", "Degraded"]);
    await page.keyboard.press("Escape");

    await screenshot(page, "monitor-overview-change-status-done", {
      fullPage: false,
    });
  });

  test("manual: Escape and Cancel change nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openManual(page);

    await moreActionsButton(page).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(moreActionsButton(page)).toBeFocused();

    await moreActionsButton(page).click();
    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: "Degraded" })
      .click();
    await page
      .getByTestId("modal")
      .getByRole("button", { name: "Cancel" })
      .click();
    await expect(page.getByTestId("modal")).toHaveCount(0);

    expect(await statusEventCreates(page)).toHaveLength(0);
    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Operational",
    );
  });

  test("manual: the keyboard alone opens the menu, picks a status and backs out", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openManual(page);

    await moreActionsButton(page).focus();
    await page.keyboard.press("Enter");

    const items: Locator = page.getByRole("menu").getByRole("menuitem");
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("modal-title")).toHaveText(
      "Change status to Offline?",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("modal")).toHaveCount(0);
    expect(await statusEventCreates(page)).toHaveLength(0);
  });

  test("manual, role=viewer: the statuses are locked, and say why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openManual(page, "role=viewer");

    await moreActionsButton(page).click();
    const offline: Locator = page
      .getByRole("menu")
      .getByRole("menuitem", { name: "Offline" });
    await expect(offline).toHaveAttribute("aria-disabled", "true");

    await offline.hover();
    await expect(page.locator("[data-tippy-root]")).toContainText(
      "You do not have permission to create this Monitor Status Event.",
    );

    await offline.click({ force: true });
    await expect(page.getByTestId("modal")).toHaveCount(0);
    expect(await statusEventCreates(page)).toHaveLength(0);
  });

  test("manual, fail=change-status: the dialog says why and stays open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openManual(page, "fail=change-status");

    await moreActionsButton(page).click();
    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: "Offline" })
      .click();
    await page
      .getByTestId("modal")
      .getByRole("button", { name: "Change status" })
      .click();

    await expect(page.getByTestId("modal-error")).toContainText(
      "The status could not be changed. The API is restarting.",
    );
    await expect(page.getByTestId("modal")).toBeVisible();
    await expect(page.getByTestId("monitor-overview-badge")).toHaveText(
      "Operational",
    );
  });

  test("manual, 390: the menu and the dialog fit the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openManual(page);

    await moreActionsButton(page).click();
    const menu: Box = await documentBox(page.getByRole("menu"));
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(390);
    await expectNoHorizontalOverflow(page);
    await screenshot(page, "monitor-overview-change-status-menu-390", {
      fullPage: false,
    });

    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: "Degraded" })
      .click();
    const dialog: Box = await documentBox(
      page.getByTestId("modal").getByTestId("modal-footer"),
    );
    expect(dialog.x).toBeGreaterThanOrEqual(0);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(390);
    await expectNoHorizontalOverflow(page);
    await screenshot(page, "monitor-overview-change-status-dialog-390", {
      fullPage: false,
    });
  });

  test("manual, dark theme: the buttons, the menu and the dialog are dark", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openManual(page, "theme=dark");

    for (const button of [
      heroActions(page).getByRole("button", { name: "Refresh" }),
      moreActionsButton(page),
    ]) {
      expect(await backgroundColor(button)).not.toBe(WHITE_RGB);
    }

    await moreActionsButton(page).click();
    expect(await backgroundColor(page.getByRole("menu"))).not.toBe(WHITE_RGB);
    expect(
      luminance(
        await textColor(
          page.getByRole("menu").getByRole("menuitem", { name: "Offline" }),
        ),
      ),
    ).toBeGreaterThan(0.3);
    await screenshot(page, "monitor-overview-change-status-dark", {
      fullPage: false,
    });

    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: "Offline" })
      .click();
    expect(await backgroundColor(page.getByTestId("modal"))).not.toBe(
      WHITE_RGB,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Monitoring Logs
 *
 * The one monitor sub-page the fixture renders for real. The incoming email
 * monitor's rows are shaped the way the server writes them: an email per
 * row, plus the worker's scheduled check, which carries a copy of the last
 * email.
 * ---------------------------------------------------------------------------
 */

async function openLogs(page: Page, type: MonitorTypeKey): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.goto(`${monitorPath(type)}/logs?type=${type}`);
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(card(page, "Monitor Logs")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("row-actions").first()).toBeVisible({
    timeout: 30000,
  });
}

function logRows(page: Page): Locator {
  return card(page, "Monitor Logs")
    .locator("tbody tr")
    .filter({ has: page.getByTestId("row-actions") });
}

async function columnTitles(page: Page): Promise<Array<string>> {
  return (
    await card(page, "Monitor Logs").getByRole("columnheader").allInnerTexts()
  ).map((title: string): string => {
    return title.trim();
  });
}

// The n-th row's cell in the column headed `title`.
async function logCell(
  page: Page,
  row: number,
  title: string,
): Promise<Locator> {
  const column: number = (await columnTitles(page)).indexOf(title);
  expect(column, `a "${title}" column`).toBeGreaterThanOrEqual(0);
  return logRows(page).nth(row).locator("td").nth(column);
}

test.describe("monitoring logs", () => {
  test("names each row's email, and calls a scheduled check one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page, "incoming-email");

    const titles: Array<string> = await columnTitles(page);
    expect(titles.indexOf("Email")).toBeGreaterThan(
      titles.indexOf("Monitored At"),
    );
    expect(titles.indexOf("Evaluation Outcome")).toBeGreaterThan(
      titles.indexOf("Email"),
    );
    expect(titles).not.toContain("Probe");

    await expect(logRows(page)).toHaveCount(3);
    // Newest first: the check, then the email it copied, then the day before.
    await expect(await logCell(page, 0, "Email")).toHaveText("Scheduled check");
    const lastEmail: Locator = await logCell(page, 1, "Email");
    await expect(lastEmail).toContainText("Payroll run 2026-09-21 completed");
    await expect(lastEmail).toContainText(
      "notifications@payroll-provider.example",
    );
    await expect(await logCell(page, 2, "Email")).toContainText(
      "Payroll run 2026-09-20 completed",
    );
    await screenshot(page, "monitor-logs-email");
  });

  test("View Summary shows the email a row recorded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page, "incoming-email");

    await logRows(page).nth(2).getByText("View Summary").click();
    const modal: Locator = page.getByRole("dialog");
    await expect(modal.getByText("Monitoring Summary")).toBeVisible();
    await expect(
      modal.getByText(
        "No summary available. Looks like no email has been received yet.",
      ),
    ).toHaveCount(0);
    await expect(modal).toContainText("Payroll run 2026-09-20 completed");
    await expect(modal).toContainText("notifications@payroll-provider.example");
    await modal.getByText("Show More Details").click();
    await expect(
      modal.getByText(
        "The payroll run for Acme Commerce completed at 09:41 UTC.",
      ),
    ).toBeVisible();
    await screenshot(page, "monitor-logs-view-summary");
    await modal.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // A scheduled check shows the email it measured, and when it ran.
    await logRows(page).nth(0).getByText("View Summary").click();
    await expect(page.getByRole("dialog")).toContainText(
      "Payroll run 2026-09-21 completed",
    );
    await expect(page.getByRole("dialog")).toContainText(
      "Monitor Status Check At",
    );
  });

  /*
   * The Email column and the criteria name beside it are both prose. They
   * wrap rather than widen, so View Summary stays on the card on a laptop.
   */
  for (const width of [1280, 1440]) {
    test(`keeps View Summary on the card at ${width}px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openLogs(page, "incoming-email");

      const table: Locator = card(page, "Monitor Logs");
      /*
       * The table's own box. It scrolls (overflow-x-auto) only while its
       * rows are wider than the card, so it is found by its test id.
       */
      const scroller: Locator = table.getByTestId("table-scroll").last();
      const overflow: number = await scroller.evaluate(
        (element: Element): number => {
          return element.scrollWidth - element.clientWidth;
        },
      );
      expect(overflow, "the logs table scrolls sideways").toBeLessThanOrEqual(
        1,
      );

      const tableBox: Box = await documentBox(table);
      const rows: number = await logRows(page).count();
      for (let row: number = 0; row < rows; row++) {
        const button: Box = await documentBox(
          logRows(page).nth(row).getByText("View Summary"),
        );
        expect(
          button.x + button.width,
          "View Summary on the card",
        ).toBeLessThanOrEqual(tableBox.x + tableBox.width);
      }
      await screenshot(page, `monitor-logs-email-${width}`, {
        fullPage: false,
      });
    });
  }

  test("does not scroll sideways at 390px", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLogs(page, "incoming-email");

    await expect(
      page.getByText("Payroll run 2026-09-20 completed"),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await screenshot(page, "monitor-logs-email-mobile");
  });

  test("names the probe behind each check of a probe monitor", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page, "api");

    const titles: Array<string> = await columnTitles(page);
    expect(titles).toContain("Probe");
    expect(titles).not.toContain("Email");

    const probeNames: Array<string> = [];
    const rows: number = await logRows(page).count();
    for (let row: number = 0; row < rows; row++) {
      probeNames.push(
        ((await (await logCell(page, row, "Probe")).innerText()) || "").trim(),
      );
    }
    expect(probeNames.length).toBeGreaterThan(0);
    expect(probeNames).not.toContain("Unknown");
    expect(new Set(probeNames)).toEqual(
      new Set([
        "Frankfurt (eu-central-1)",
        "N. Virginia (us-east-1)",
        "Singapore (ap-southeast-1)",
      ]),
    );
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
    ["incoming-email", "state=awaiting"],
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

  /*
   * What a push monitor waiting for its first signal is for: the address,
   * URL or install command to paste somewhere else. Card hides its
   * description below md, and the email and server setup cards used to put
   * exactly that there, so a phone got a title over an empty card.
   */
  const PHONE_SETUP_SCENARIOS: Array<{
    type: MonitorTypeKey;
    cardTitle: string;
    detail: (setup: Locator) => Locator;
    text: string;
  }> = [
    {
      type: "incoming-email",
      cardTitle: "Incoming Email Address",
      detail: (setup: Locator): Locator => {
        return setup.getByText(INCOMING_EMAIL_ADDRESS);
      },
      text: INCOMING_EMAIL_ADDRESS,
    },
    {
      type: "server",
      cardTitle: "Set up your Server Monitor (Linux/Mac)",
      detail: (setup: Locator): Locator => {
        return setup.locator("pre code");
      },
      text: `--secret-key=${secretKey("server")}`,
    },
    {
      type: "incoming-request",
      cardTitle: "Send the first heartbeat",
      detail: (setup: Locator): Locator => {
        return setup.getByTestId("monitor-setup-heartbeat-url");
      },
      text: `${HEARTBEAT_HOST}/heartbeat/${secretKey("incoming-request")}`,
    },
  ];

  for (const scenario of PHONE_SETUP_SCENARIOS) {
    test(`${scenario.type} setup details stay on screen at 390px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openReady(page, { type: scenario.type, query: "state=awaiting" });
      await expectSettled(page);

      const setup: Locator = card(page, scenario.cardTitle);
      const detail: Locator = scenario.detail(setup).first();

      await expect(detail).toBeVisible();
      await expect(detail).toContainText(scenario.text);

      /*
       * Inside the phone's width: a long address wraps and a long command
       * scrolls within its own block, neither runs off the screen.
       */
      const box: Box = await documentBox(detail);
      expect(box.x, "setup detail starts on screen").toBeGreaterThanOrEqual(0);
      expect(
        box.x + box.width,
        "setup detail ends on screen",
      ).toBeLessThanOrEqual(391);
      await expectNoHorizontalOverflow(page);

      if (scenario.type === "incoming-email") {
        await expect(
          setup.getByRole("button", {
            name: "Copy email address",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          setup.getByRole("link", { name: "How to verify the address" }),
        ).toBeVisible();
        await screenshot(page, "monitor-overview-email-setup-mobile");
      }
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
     * under the title - at the card's right edge - rather than squeezing it
     * to a word or two.
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
    /*
     * The picker and Test Monitor are too wide to share the title's line,
     * so they sit on their own line - at the card's right edge, after the
     * description, which stays right under the title across the card.
     */
    expect(title.width).toBeGreaterThan(cardBox.width * 0.8);
    await expectHeaderActionsOnTheRight(summary, "the probe picker", {
      onTitleLine: false,
    });
    await expectAbove(
      summary.getByTestId("card-description"),
      summary.getByRole("combobox", { name: "Showing results from:" }),
      "the description above the picker",
    );
  });

  /*
   * "Why are edit buttons not on the right?" Every card on the overview -
   * Details' Edit, the summary's picker and Test Monitor, Probes' link, the
   * uptime figure - keeps what it offers at its header's right edge, on a
   * desktop and on a phone.
   */
  for (const type of [
    "api",
    "incoming-request",
    "manual",
  ] as Array<MonitorTypeKey>) {
    for (const width of [1440, 1280, 390]) {
      test(`a ${type} monitor keeps every card's actions at the right edge at ${width}px`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await openReady(page, { type });
        await expectSettled(page);

        const cards: Locator = page
          .getByTestId("card")
          .filter({ has: page.getByTestId("card-header-actions") })
          .filter({ has: page.getByTestId("card-details-heading") });
        const count: number = await cards.count();

        expect(count, "cards with actions").toBeGreaterThan(0);

        for (let index: number = 0; index < count; index++) {
          const each: Locator = cards.nth(index);
          const name: string = (
            await each.getByTestId("card-details-heading").first().innerText()
          ).trim();

          await expectHeaderActionsOnTheRight(each, `${name} at ${width}px`);
        }

        // The details card's Edit stays on its title's line, even at 1280px.
        if (width !== 390) {
          await expectHeaderActionsOnTheRight(
            card(sideColumn(page), "Details"),
            `Details' Edit at ${width}px`,
            { onTitleLine: true },
          );
        }
      });
    }
  }

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

/*
 * ---------------------------------------------------------------------------
 * Owners, added from the hero
 * ---------------------------------------------------------------------------
 * "If I click on add owners, I should be able to add owners from this page
 * directly instead of going to owners page." The hero's Add owners - beside
 * "No owners", or the circle after the owners' avatars - opens the Owners
 * page's own list right there: one click adds an owner, the list stays open
 * for the next, and the hero and the feed read again.
 */

// The project's people and teams the list offers (Fixture.js).
const JORDAN_ID: string = uuid("80000000", 3);
const PLATFORM_TEAM_ID: string = uuid("81000000", 2);

function ownersFact(page: Page): Locator {
  return page.getByTestId("monitor-overview-fact-owners");
}

function addOwnersList(page: Page): Locator {
  return page.getByRole("dialog", { name: "Add owners" });
}

// The names the list offers, in order: people first, then teams.
async function listedNames(list: Locator): Promise<Array<string>> {
  return list
    .getByTestId("people-search-option")
    .evaluateAll((options: Array<Element>): Array<string> => {
      return options.map((option: Element): string => {
        return (
          option.querySelector(":scope > .min-w-0 > div")?.textContent || ""
        ).trim();
      });
    });
}

async function ownerRowsWritten(
  page: Page,
  modelName: string,
): Promise<Array<RecordedCreate>> {
  return (await fixture(page)).creates.filter(
    (write: RecordedCreate): boolean => {
      return write.modelName === modelName;
    },
  );
}

test.describe("owners, added from the hero", () => {
  test("nobody owns it: Add owners opens the list right there, and one click adds an owner", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { type: "network-device" });

    const owners: Locator = ownersFact(page);
    const add: Locator = owners.getByRole("button", { name: "Add owners" });
    await expect(add).toHaveAttribute(
      "data-testid",
      "monitor-overview-add-owners",
    );
    await expect(add).toHaveAttribute("aria-expanded", "false");
    await add.click();

    /*
     * The Owners page's list, under the hero's Add: the project's people,
     * then its teams.
     */
    const list: Locator = addOwnersList(page);
    await expect(list).toBeVisible();
    await expect(add).toHaveAttribute("aria-expanded", "true");
    await expect(
      list.getByRole("combobox", { name: "Search people or teams..." }),
    ).toBeFocused();
    await expect
      .poll(async (): Promise<Array<string>> => {
        return listedNames(list);
      })
      .toEqual([
        "Jordan Patel",
        "Maya Chen",
        "Sam Rivera",
        "Checkout SRE",
        "Platform",
      ]);
    const control: Box = (await add.boundingBox())!;
    const popup: Box = (await list.boundingBox())!;
    expect(popup.y, "under Add owners").toBeGreaterThanOrEqual(
      control.y + control.height - 0.5,
    );
    await screenshot(page, "monitor-overview-owners-add-list", {
      fullPage: false,
    });

    const ownerReads: number = (
      await listRequestsFor(page, /^MonitorOwnerTeam$/)
    ).length;
    const feedReads: number = (await listRequestsFor(page, /^MonitorFeed$/))
      .length;
    await list.getByRole("option", { name: /Platform/ }).click();

    // Named at once: "No owners" gives way to the avatars, the list stays open.
    await expect(owners).not.toContainText("No owners");
    await expect(list.getByTestId("people-search-notice-done")).toHaveText(
      "Added Platform.",
    );
    await expect
      .poll(async (): Promise<Array<string>> => {
        return listedNames(list);
      })
      .not.toContain("Platform");
    // The list now belongs to the circle after the avatars, lit while open.
    const more: Locator = owners.getByRole("button", { name: "Add owners" });
    await expect(more).toHaveAttribute(
      "data-testid",
      "monitor-overview-add-more-owners",
    );
    await expect(more).toHaveAttribute("aria-expanded", "true");

    const written: Array<RecordedCreate> = await ownerRowsWritten(
      page,
      "MonitorOwnerTeam",
    );
    expect(written).toHaveLength(1);
    const row: string = JSON.stringify(written[0]?.data);
    expect(row).toContain(monitorId("network-device"));
    expect(row).toContain(PLATFORM_TEAM_ID);
    expect(row).not.toContain("isOwnerNotified");
    // The hero's owners and the feed read again.
    expect(
      (await listRequestsFor(page, /^MonitorOwnerTeam$/)).length,
    ).toBeGreaterThan(ownerReads);
    await expect
      .poll(async (): Promise<number> => {
        return (await listRequestsFor(page, /^MonitorFeed$/)).length;
      })
      .toBeGreaterThan(feedReads);

    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(more).toBeFocused();
    expect(new URL(page.url()).pathname).toBe(monitorPath("network-device"));
    await expect(page.getByTestId("stub-page")).toHaveCount(0);
  });

  test("owned: the circle after the avatars offers whoever does not own it yet", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page);

    const owners: Locator = ownersFact(page);
    const more: Locator = owners.getByRole("button", { name: "Add owners" });
    await expect(more).toHaveAttribute(
      "data-testid",
      "monitor-overview-add-more-owners",
    );
    await more.click();

    const list: Locator = addOwnersList(page);
    // Maya Chen, Sam Rivera and Checkout SRE own it already.
    await expect
      .poll(async (): Promise<Array<string>> => {
        return listedNames(list);
      })
      .toEqual(["Jordan Patel", "Platform"]);
    await list.getByRole("option", { name: /Jordan Patel/ }).click();

    await expect(
      owners.getByRole("img", { name: "Jordan Patel" }),
    ).toBeVisible();
    await expect
      .poll(async (): Promise<Array<string>> => {
        return listedNames(list);
      })
      .toEqual(["Platform"]);
    const written: Array<RecordedCreate> = await ownerRowsWritten(
      page,
      "MonitorOwnerUser",
    );
    expect(written).toHaveLength(1);
    expect(JSON.stringify(written[0]?.data)).toContain(JORDAN_ID);
    await screenshot(page, "monitor-overview-owners-added", {
      fullPage: false,
    });
  });

  test("fail=owner-add: a refused owner is said in the list, and nobody is named", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, {
      type: "network-device",
      query: "fail=owner-add",
    });

    const owners: Locator = ownersFact(page);
    await owners.getByRole("button", { name: "Add owners" }).click();
    const list: Locator = addOwnersList(page);
    await list.getByRole("option", { name: /Platform/ }).click();

    await expect(list.getByRole("alert")).toHaveText(
      "This team is already an owner of this monitor.",
    );
    await expect(owners).toContainText("No owners");
    await expect
      .poll(async (): Promise<Array<string>> => {
        return listedNames(list);
      })
      .toContain("Platform");
  });

  test("role=viewer: no Add owners, beside nobody or after the avatars", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, { type: "network-device", query: "role=viewer" });
    await expect(ownersFact(page)).toContainText("No owners");
    await expect(ownersFact(page).getByRole("button")).toHaveCount(0);

    await openReady(page, { query: "role=viewer" });
    await expect(
      ownersFact(page).getByRole("button", { name: "Add owners" }),
    ).toHaveCount(0);
  });

  for (const [width, theme] of [
    [390, "light"],
    [1280, "dark"],
  ] as Array<[number, string]>) {
    test(`the list opens whole under the hero's Add owners (${width}px, ${theme})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openReady(page, {
        type: "network-device",
        query: theme === "dark" ? "theme=dark" : "",
      });

      await ownersFact(page)
        .getByRole("button", { name: "Add owners" })
        .click();
      const list: Locator = addOwnersList(page);
      await expect(list).toBeVisible();
      await expect
        .poll(async (): Promise<boolean> => {
          const box: Box | null = await list.boundingBox();
          return Boolean(
            box &&
              box.x >= 0 &&
              box.y >= 0 &&
              box.x + box.width <= width + 0.5 &&
              box.y + box.height <= 900.5,
          );
        }, "the list is whole on screen")
        .toBe(true);
      if (theme === "dark") {
        expect(await backgroundColor(list)).not.toBe(WHITE_RGB);
      }
      await screenshot(
        page,
        `monitor-overview-owners-add-list-${width}-${theme}`,
        {
          fullPage: false,
        },
      );
    });
  }
});
