import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Renders the real trace detail page against the offline fixture
 * (Fixture/Fixture.js): the layout, header, waterfall, span panel, operations
 * view and related signals are production components; only the data boundary
 * is synthetic. Each test asserts what the page drew and, through
 * window.__traceFixture, what it asked the API for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const TRACES: Record<string, string> = {
  checkout: "4bf92f3577b34da6a3ce929d0e0e4736",
  worker: "6aa85538140714b4892cd8f500735c51",
  large: "9c1d2e3f4a5b6c7d8e9fa0b1c2d3e4f5",
  orphans: "0af7651916cd43dd8448eb211c80319c",
  empty: "00000000000000000000000000000001",
};

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/trace-detail-ui",
);

interface RecordedApiRequest {
  method: string;
  url: string;
  body: Record<string, unknown>;
}

interface RecordedListRequest {
  modelName: string;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  skip: number;
  limit: number;
}

interface FixtureSpan {
  spanId: string;
  parentSpanId: string;
  name: string;
  statusCode: number;
  serviceId: string;
}

interface FixtureState {
  traceId: string;
  spans: Array<FixtureSpan>;
  apiRequests: Array<RecordedApiRequest>;
  analyticsListRequests: Array<RecordedListRequest>;
  analyticsCountRequests: Array<{
    modelName: string;
    query: Record<string, unknown>;
  }>;
  modelListRequests: Array<{
    modelName: string;
    query: Record<string, unknown>;
  }>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
});

async function open(
  page: Page,
  trace: keyof typeof TRACES = "checkout",
  query: string = "",
): Promise<void> {
  const params: URLSearchParams = new URLSearchParams(query);
  if (trace !== "checkout") {
    params.set("trace", trace);
  }
  const search: string = params.toString();
  await page.goto(
    `/dashboard/${PROJECT_ID}/traces/view/${TRACES[trace]}${search ? `?${search}` : ""}`,
  );
}

async function openLoaded(
  page: Page,
  trace: keyof typeof TRACES = "checkout",
  query: string = "",
): Promise<void> {
  await open(page, trace, query);
  await expect(page.getByTestId("trace-header")).toBeVisible({
    timeout: 60000,
  });
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __traceFixture: FixtureState }).__traceFixture,
      ),
    ) as FixtureState;
  });
}

async function spanId(
  page: Page,
  name: string,
  occurrence: number = 0,
): Promise<string> {
  const state: FixtureState = await fixture(page);
  const matches: Array<FixtureSpan> = state.spans.filter(
    (span: FixtureSpan) => {
      return span.name === name;
    },
  );
  const match: FixtureSpan | undefined = matches[occurrence];
  if (!match) {
    throw new Error(`No span named ${name}`);
  }
  return match.spanId;
}

function row(page: Page, id: string): Locator {
  return page.locator(
    `[data-testid="trace-waterfall-row"][data-span-id="${id}"]`,
  );
}

function rows(page: Page): Locator {
  return page.getByTestId("trace-waterfall-row");
}

/*
 * Rows are virtualised, so the DOM holds only those in view; the tree reports
 * how many rows it shows in total.
 */
async function expectRowCount(page: Page, count: number): Promise<void> {
  await expect(page.getByTestId("trace-waterfall-body")).toHaveAttribute(
    "data-row-count",
    String(count),
  );
}

async function rowIds(page: Page): Promise<Array<string>> {
  return rows(page).evaluateAll((elements: Array<Element>) => {
    return elements.map((element: Element) => {
      return element.getAttribute("data-span-id") || "";
    });
  });
}

async function screenshot(
  page: Page,
  name: string,
  fullPage: boolean = true,
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage,
    animations: "disabled",
  });
}

test.describe("header", () => {
  test("summarises the trace and draws the service breakdown", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);

    await expect(page.getByTestId("trace-title")).toHaveText(
      "POST /api/v1/checkout",
    );
    await expect(page.getByTestId("trace-status")).toHaveText("6 errors");
    await expect(page.getByTestId("trace-stat-duration")).toContainText(
      "1.28 s",
    );
    await expect(page.getByTestId("trace-stat-spans")).toContainText("36");
    await expect(page.getByTestId("trace-stat-services")).toContainText("5");
    await expect(page.getByTestId("trace-stat-errors")).toContainText(
      "17% of spans",
    );
    await expect(page.getByTestId("trace-stat-depth")).toContainText("6");
    await expect(page.getByTestId("trace-id")).toHaveText("4bf92f35…0e4736");
    await expect(page.getByTestId("trace-header")).toContainText("api-gateway");
    await expect(page.getByTestId("trace-header")).toContainText("Server");

    const chips: Locator = page.getByTestId("trace-service-chip");
    await expect(chips).toHaveCount(5);
    await expect(chips.nth(0)).toContainText("payment-service");
    await expect(chips.nth(0)).toContainText("46%");
    await expect(chips.nth(1)).toContainText("inventory-service");
    await expect(chips.nth(1)).toContainText("2 errors");

    await screenshot(page, "overview");
  });

  test("reads the spans, services and signal counts it needs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);
    await expect(page.getByTestId("trace-signal-tab-exceptions")).toContainText(
      "1",
    );

    const state: FixtureState = await fixture(page);
    const spanRead: RecordedListRequest = state.analyticsListRequests.find(
      (request: RecordedListRequest) => {
        return (
          request.query["traceId"] === TRACES["checkout"] &&
          !request.query["spanId"] &&
          "startTimeUnixNano" in request.sort
        );
      },
    )!;
    expect(spanRead.query).toEqual({ traceId: TRACES["checkout"] });
    expect(spanRead.sort).toEqual({ startTimeUnixNano: "ASC" });
    expect(spanRead.skip).toBe(0);
    expect(spanRead.limit).toBe(500);
    expect(
      state.modelListRequests.some(
        (request: { query: Record<string, unknown> }) => {
          return request.query["projectId"] !== undefined;
        },
      ),
    ).toBe(true);
    expect(state.analyticsCountRequests[0]!.query).toMatchObject({
      traceId: TRACES["checkout"],
    });
    expect(
      state.apiRequests.some((request: RecordedApiRequest) => {
        return (
          request.url.includes("/telemetry/profiles/trace-presence") &&
          request.body["traceId"] === TRACES["checkout"]
        );
      }),
    ).toBe(true);
  });

  test("a service chip filters the waterfall to that service", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);

    await page
      .getByTestId("trace-service-chip")
      .filter({ hasText: "notification-service" })
      .click();

    await expect(page.getByTestId("trace-filter-summary")).toContainText(
      "2 spans of 36 match",
    );
    await expect(rows(page)).toHaveCount(6);
    await expect(
      rows(page).filter({ hasText: "SendConfirmationEmail" }),
    ).toHaveCount(1);
    await expect(
      page
        .getByTestId("trace-service-chip")
        .filter({ hasText: "notification-service" }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Show all services" }).click();
    await expect(page.getByTestId("trace-filter-summary")).toHaveCount(0);
  });

  test("the error count opens the errors-only view", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);

    await page.getByTestId("trace-stat-errors").getByRole("button").click();

    await expect(page.getByTestId("trace-errors-only")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("trace-filter-summary")).toContainText(
      "6 spans of 36 match",
    );
    await expect(
      page.locator('[data-testid="trace-waterfall-row"]:not([data-context])'),
    ).toHaveCount(6);
  });
});

test.describe("waterfall", () => {
  test("draws the span tree with a readable time axis", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);

    await expectRowCount(page, 36);
    const ids: Array<string> = await rowIds(page);
    await expect(page.getByTestId("trace-axis-tick")).toHaveText([
      "0",
      "0.25 s",
      "0.5 s",
      "0.75 s",
      "1 s",
      "1.25 s",
    ]);
    await expect(row(page, ids[0]!)).toHaveAttribute("aria-level", "1");
    await expect(row(page, ids[0]!)).toContainText("1.28 s");
    await expect(
      rows(page).filter({ hasText: "SELECT products WHERE id = $1" }),
    ).toHaveCount(12);

    const update: string = await spanId(page, "UPDATE stock");
    await expect(row(page, update)).toHaveAttribute("aria-level", "6");
    await expect(
      row(page, update).getByTestId("trace-waterfall-bar"),
    ).toHaveAttribute("data-error", "true");
    await expect(row(page, update)).toContainText("208 ms");
  });

  test("collapses and expands spans", async ({ page }: { page: Page }) => {
    await openLoaded(page);
    const validate: string = await spanId(page, "OrderService.validateCart");

    await row(page, validate).getByTestId("trace-row-toggle").click();
    await expectRowCount(page, 23);
    await expect(row(page, validate)).toContainText("+13");
    await expect(row(page, validate)).toHaveAttribute("aria-expanded", "false");

    await row(page, validate).getByTestId("trace-row-toggle").click();
    await expectRowCount(page, 36);

    await page.getByTestId("trace-collapse-all").click();
    await expectRowCount(page, 4);
    await page.getByTestId("trace-expand-all").click();
    await expectRowCount(page, 36);
  });

  test("the keyboard walks the tree", async ({ page }: { page: Page }) => {
    await openLoaded(page);
    const ids: Array<string> = await rowIds(page);
    const tree: Locator = page.getByRole("tree");

    await tree.focus();
    await page.keyboard.press("ArrowDown");
    await expect(row(page, ids[0]!)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(row(page, ids[1]!)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("span-panel-title")).toHaveText(
      "auth.verifyToken",
    );

    await page.keyboard.press("ArrowLeft");
    await expect(row(page, ids[1]!)).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("ArrowLeft");
    await expect(row(page, ids[0]!)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    const last: string = await spanId(page, "render response");
    await expect(row(page, last)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("trace-span-panel")).toHaveCount(0);
  });

  test("dragging across the overview zooms the time axis", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);

    const track: Locator = page.getByTestId("trace-minimap").getByRole("img");
    const box: { x: number; y: number; width: number; height: number } =
      (await track.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, {
      steps: 6,
    });
    await page.mouse.up();

    await expect(page.getByTestId("trace-reset-zoom")).toBeVisible();
    await expect(page.getByTestId("trace-minimap-window")).toBeVisible();
    await expect(page.getByTestId("trace-axis-tick").first()).not.toHaveText(
      "0",
    );
    await screenshot(page, "zoomed", false);

    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.getByTestId("trace-reset-zoom").click();
    await expect(page.getByTestId("trace-reset-zoom")).toHaveCount(0);
    await expect(page.getByTestId("trace-axis-tick").first()).toHaveText("0");

    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(page.getByTestId("trace-reset-zoom")).toBeVisible();
  });

  test("the span name column can be resized", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);
    const separator: Locator = page.getByRole("separator", {
      name: "Resize the span name column",
    });
    const box: { x: number; y: number; width: number; height: number } =
      (await separator.boundingBox())!;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();

    const value: number = Number(await separator.getAttribute("aria-valuenow"));
    expect(value).toBeGreaterThan(45);
  });

  test("critical path outlines the spans that set the duration", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);

    await page.getByTestId("trace-critical-path").click();

    await expect(page.getByTestId("trace-critical-path-summary")).toContainText(
      "Critical path:",
    );
    const stripe: string = await spanId(
      page,
      "POST api.stripe.com /v1/payment_intents",
    );
    const auth: string = await spanId(page, "auth.verifyToken");
    await expect(
      row(page, stripe).getByTestId("trace-waterfall-bar"),
    ).toHaveAttribute("style", /rgba\(17, 24, 39, 0\.7\)/);
    await expect(row(page, auth).locator(".opacity-30")).toHaveCount(1);
    await screenshot(page, "critical-path", false);
  });

  test("other views keep working: flame graph and service map", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);

    await page.getByTestId("trace-view-flamegraph").click();
    await expect(page.locator(".flame-graph")).toBeVisible();
    await page.locator(".flame-graph [title^='FraudCheck.score']").click();
    await expect(page.getByTestId("span-panel-title")).toHaveText(
      "FraudCheck.score",
    );

    await page.getByTestId("trace-view-servicemap").click();
    await expect(page.locator(".react-flow")).toBeVisible();
    await expect(page.getByTestId("trace-critical-path")).toHaveCount(0);
  });
});

test.describe("search and filters", () => {
  test("search keeps matches in context, marks them and steps through them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);
    const search: Locator = page.getByTestId("trace-search");

    await search.fill("stock");
    await expect(page.getByTestId("trace-search-count")).toHaveText(
      "4 matches",
    );
    await expect(page.locator("mark", { hasText: /stock/i })).toHaveCount(4);

    await search.press("Enter");
    await expect(page.getByTestId("trace-search-count")).toHaveText("1 of 4");
    await expect(page.getByTestId("span-panel-title")).toHaveText(
      "SELECT stock FOR UPDATE",
    );
    await screenshot(page, "search", false);

    await page.getByRole("button", { name: "Next match" }).click();
    await expect(page.getByTestId("trace-search-count")).toHaveText("2 of 4");
    await page.getByRole("button", { name: "Previous match" }).click();
    await page.getByRole("button", { name: "Previous match" }).click();
    await expect(page.getByTestId("trace-search-count")).toHaveText("4 of 4");

    await search.press("Escape");
    await expectRowCount(page, 36);
  });

  test("search matches span ids and service names", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);
    const update: string = await spanId(page, "UPDATE stock", 1);

    await page.getByTestId("trace-search").fill(update.slice(0, 10));
    await expect(page.getByTestId("trace-search-count")).toHaveText("1 match");

    await page.getByTestId("trace-search").fill("notification");
    await expect(page.getByTestId("trace-search-count")).toHaveText(
      "2 matches",
    );
  });

  test("pressing / focuses the search", async ({ page }: { page: Page }) => {
    await openLoaded(page);

    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("/");

    await expect(page.getByTestId("trace-search")).toBeFocused();
    await expect(page.getByTestId("trace-search")).toHaveValue("");
  });

  test("filters stack and clear together", async ({ page }: { page: Page }) => {
    await openLoaded(page);

    await page.getByTestId("trace-errors-only").click();
    await page.getByTestId("trace-search").fill("reserve");
    await expect(page.getByTestId("trace-filter-summary")).toContainText(
      "2 spans of 36 match",
    );

    await page.getByTestId("trace-clear-filters").click();
    await expect(page.getByTestId("trace-search")).toHaveValue("");
    await expect(page.getByTestId("trace-errors-only")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expectRowCount(page, 36);
  });
});

test.describe("span panel", () => {
  test("shows timing, status, identity and attributes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);
    const update: string = await spanId(page, "UPDATE stock");

    await row(page, update).click();

    const panel: Locator = page.getByTestId("trace-span-panel");
    await expect(panel.getByTestId("span-panel-title")).toHaveText(
      "UPDATE stock",
    );
    await expect(panel.getByTestId("span-panel-status")).toHaveText("Error");
    await expect(panel.getByTestId("span-panel-status-message")).toHaveText(
      "serialization failure",
    );
    await expect(panel.getByTestId("span-panel-timing")).toContainText(
      "208 ms",
    );
    await expect(panel.getByTestId("span-panel-timing")).toContainText(
      "+183 ms",
    );
    await expect(panel.getByTestId("span-panel-id")).toHaveText(update);
    await expect(panel.getByTestId("span-attributes")).toContainText(
      "db.statement",
    );
    await expect(panel.getByTestId("span-attributes")).toContainText(
      "UPDATE stock SET quantity",
    );
    await expect(panel.getByTestId("span-panel-tab-attributes")).toContainText(
      "3",
    );
    await screenshot(page, "span-panel", false);

    const state: FixtureState = await fixture(page);
    expect(
      state.analyticsListRequests.some((request: RecordedListRequest) => {
        return (
          request.query["spanId"] === update &&
          request.query["traceId"] === TRACES["checkout"]
        );
      }),
    ).toBe(true);

    await panel.getByTestId("span-panel-parent").click();
    await expect(panel.getByTestId("span-panel-title")).toHaveText(
      "POST /reserve",
    );
    await panel.getByTestId("span-panel-close").click();
    await expect(page.getByTestId("trace-span-panel")).toHaveCount(0);
  });

  test("events, logs and exceptions load in their tabs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);
    const reserve: string = await spanId(page, "POST /reserve");

    await row(page, reserve).click();
    const panel: Locator = page.getByTestId("trace-span-panel");

    await expect(panel).toContainText("1 exception");
    await panel.getByTestId("span-panel-tab-events").click();
    await expect(panel.getByTestId("span-events")).toContainText(
      "Exception: Could not reserve 3 units of SKU-4821: stock version changed",
    );
    await expect(panel.getByTestId("span-events")).toContainText("+305 ms");

    await panel.getByTestId("span-panel-tab-logs").click();
    await expect(panel.getByTestId("span-logs")).toContainText(
      "POST /reserve failed: stock version changed",
    );

    await panel.getByTestId("span-panel-tab-exceptions").click();
    await expect(panel.getByTestId("span-exceptions")).toContainText(
      "InventoryReservationError",
    );
    await expect(
      panel
        .getByTestId("span-exceptions")
        .getByRole("link", { name: "View exception" }),
    ).toHaveAttribute("href", /9f86d081884c7d659a2feaa0c55ad015/);
  });

  test("attribute search links to the traces list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);
    const stripe: string = await spanId(
      page,
      "POST api.stripe.com /v1/payment_intents",
    );

    await row(page, stripe).click();
    const attribute: Locator = page
      .getByTestId("span-attributes")
      .locator("div", { hasText: "peer.service" })
      .last();
    await attribute.hover();
    await attribute.getByTitle("Find traces with this attribute value").click();

    await expect(page.getByTestId("traces-list-page")).toBeVisible();
    expect(decodeURIComponent(page.url())).toContain(
      "search=@peer.service:stripe",
    );
  });

  test("zoom to span frames it on the time axis", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);
    const redis: string = await spanId(page, "redis GET session:*");

    await row(page, redis).click();
    await page.getByTestId("span-panel-zoom").click();

    await expect(page.getByTestId("trace-reset-zoom")).toBeVisible();
    // redis GET runs from +5 ms for 2.4 ms: the axis now counts in fractions of a millisecond.
    await expect(page.getByTestId("trace-axis-tick").first()).toHaveText(
      /^\d+(\.\d+)? ms$/,
    );
    await expect(page.getByTestId("trace-axis-tick").first()).not.toHaveText(
      "0",
    );
  });

  test("a span that failed to load says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page, "checkout", "fail=span-detail");
    const auth: string = await spanId(page, "auth.verifyToken");

    await row(page, auth).click();

    await expect(
      page.getByTestId("trace-span-panel").getByRole("alert"),
    ).toHaveText("Could not load this span.");
  });

  test("a span with profile samples gets a Profile tab", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page, "checkout", "profile=samples");
    const charge: string = await spanId(page, "POST /charge");

    await row(page, charge).click();
    await page.getByTestId("span-panel-tab-profile").click();

    await expect(page.getByTestId("span-panel-tab-profile")).toContainText(
      "842",
    );
    await expect(page.getByTestId("trace-span-panel")).toContainText(
      "PaymentService.charge",
    );
  });

  test("a link to a span opens it", async ({ page }: { page: Page }) => {
    await openLoaded(page);
    const confirmation: string = await spanId(page, "SendConfirmationEmail");

    await openLoaded(page, "checkout", `spanId=${confirmation}`);

    await expect(row(page, confirmation)).toHaveAttribute(
      "data-linked",
      "true",
    );
    await expect(row(page, confirmation)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // The last rows sit below the waterfall's fold, so the body scrolled to it.
    expect(
      await page
        .getByTestId("trace-waterfall-body")
        .evaluate((element: Element) => {
          return element.scrollTop;
        }),
    ).toBeGreaterThan(0);
    await expect(page.getByTestId("span-panel-title")).toHaveText(
      "SendConfirmationEmail",
    );
  });
});

test.describe("operations", () => {
  test("rolls spans up by operation and flags the N+1", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);

    await page.getByTestId("trace-view-operations").click();

    const table: Locator = page.getByTestId("trace-operations");
    await expect(
      table.getByTestId("trace-operation-row").first(),
    ).toContainText("POST api.stripe.com /v1/payment_intents");
    const selects: Locator = table
      .getByTestId("trace-operation-row")
      .filter({ hasText: "SELECT products" });
    await expect(selects).toContainText("×12 from one parent");
    await expect(table.getByTestId("trace-operation-repeated")).toHaveCount(1);
    await screenshot(page, "operations", false);

    await table.getByRole("button", { name: "Calls" }).click();
    await expect(
      table.getByTestId("trace-operation-row").first(),
    ).toContainText("SELECT products");

    await selects.click();
    await expect(page.getByTestId("trace-waterfall")).toBeVisible();
    await expect(page.getByTestId("trace-search")).toHaveValue(
      "SELECT products WHERE id = $1",
    );
    await expect(page.getByTestId("trace-search-count")).toContainText("of 12");
    await expect(page.getByTestId("span-panel-title")).toHaveText(
      "SELECT products WHERE id = $1",
    );
  });
});

test.describe("large and unusual traces", () => {
  test("a 501-span trace loads the first 500, then the last one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page, "worker");

    await expect(page.getByTestId("trace-title")).toHaveText(
      "worker.job Telemetry/ProcessTelemetry",
    );
    await expect(page.getByTestId("trace-status")).toHaveText("No errors");
    await expect(page.getByTestId("trace-errors-only")).toBeDisabled();
    await expect(page.getByTestId("trace-load-more")).toContainText(
      "Showing 500 of 501 spans",
    );
    await expect(page.getByTestId("trace-stat-spans")).toContainText("of 501");
    await screenshot(page, "worker-trace", false);

    await page.getByTestId("trace-load-next").click();
    await expect(page.getByTestId("trace-load-more")).toHaveCount(0);
    await expect(page.getByTestId("trace-stat-spans")).toHaveText(/501$/);

    const state: FixtureState = await fixture(page);
    const reads: Array<RecordedListRequest> =
      state.analyticsListRequests.filter((request: RecordedListRequest) => {
        return (
          request.query["traceId"] === TRACES["worker"] &&
          !request.query["spanId"]
        );
      });
    expect(
      reads.map((request: RecordedListRequest) => {
        return [request.skip, request.limit];
      }),
    ).toEqual([
      [0, 500],
      [500, 1],
    ]);
  });

  test("a 1,250-span trace stays virtualised and loads the rest in one go", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page, "large");

    await expect(page.getByTestId("trace-load-more")).toContainText(
      "Showing 500 of 1,250 spans",
    );
    await page.getByTestId("trace-load-all").click();
    await expect(page.getByTestId("trace-load-more")).toHaveCount(0);
    await expect(page.getByTestId("trace-stat-spans")).toContainText("1,250");

    expect(await rows(page).count()).toBeLessThan(80);

    const body: Locator = page.getByTestId("trace-waterfall-body");
    await body.evaluate((element: Element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      rows(page).filter({ hasText: "cache.warm shard-36" }),
    ).toHaveCount(1);
    await screenshot(page, "large-trace", false);

    const state: FixtureState = await fixture(page);
    const reads: Array<RecordedListRequest> =
      state.analyticsListRequests.filter((request: RecordedListRequest) => {
        return (
          request.query["traceId"] === TRACES["large"] &&
          !request.query["spanId"]
        );
      });
    expect(
      reads.map((request: RecordedListRequest) => {
        return [request.skip, request.limit];
      }),
    ).toEqual([
      [0, 500],
      [500, 750],
    ]);
  });

  test("spans whose parent never arrived are shown and explained", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page, "orphans");

    await expect(page.getByTestId("trace-orphans")).toHaveText(
      "1 span missing a parent",
    );
    const lost: string = await spanId(page, "late span from a lost parent");
    await expect(row(page, lost)).toHaveAttribute("aria-level", "1");

    await row(page, lost).click();
    await expect(page.getByTestId("trace-span-panel")).toContainText(
      "Missing (ffffffff…)",
    );
  });

  test("a trace with no spans shows an empty state and its related signals", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "empty");

    await expect(page.getByTestId("trace-empty")).toContainText(
      "No spans found for this trace",
    );
    await expect(page.getByTestId("trace-signals")).toBeVisible();
    await expect(page.getByTestId("trace-waterfall")).toHaveCount(0);
  });

  test("a failed span read shows the error and retries", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "checkout", "fail=spans");

    await expect(page.getByTestId("trace-error")).toContainText(
      "The trace store is unavailable.",
    );
    await page.getByTestId("refresh-button").click();
    await expect(page.getByTestId("trace-error")).toContainText(
      "The trace store is unavailable.",
    );
    const state: FixtureState = await fixture(page);
    expect(
      state.analyticsListRequests.filter((request: RecordedListRequest) => {
        return request.query["traceId"] === TRACES["checkout"];
      }).length,
    ).toBeGreaterThanOrEqual(2);
  });

  test("shows a skeleton while the spans are on their way", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "checkout", "hold=spans");

    await expect(page.getByTestId("trace-loading")).toBeVisible({
      timeout: 60000,
    });
    await page.evaluate(() => {
      (
        window as unknown as { __traceFixture: { releaseSpans: () => void } }
      ).__traceFixture.releaseSpans();
    });
    await expect(page.getByTestId("trace-header")).toBeVisible();
    await expect(page.getByTestId("trace-loading")).toHaveCount(0);
  });
});

test.describe("actions and related signals", () => {
  test("fix performance with AI links to the task it created", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);

    await page.getByTestId("trace-fix-performance").click();

    await expect(page.getByText("Performance fix task created")).toBeVisible();
    await expect(page.getByTestId("trace-fix-performance")).toBeDisabled();
    const state: FixtureState = await fixture(page);
    expect(
      state.apiRequests.find((request: RecordedApiRequest) => {
        return request.url.includes(
          "/ai-investigation/create-performance-fix-task",
        );
      })!.body,
    ).toEqual({ traceId: TRACES["checkout"] });

    await page.getByRole("link", { name: "View task progress" }).click();
    await expect(page.getByTestId("ai-task-page")).toContainText(
      "70000000-0000-4000-8000-000000000009",
    );
  });

  test("a refused performance fix explains why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page, "checkout", "fail=perf-fix");

    await page.getByTestId("trace-fix-performance").click();

    await expect(
      page.getByText("Could not create the performance fix task"),
    ).toBeVisible();
    await expect(
      page.getByText(
        "No deterministic performance pattern was found in this trace.",
      ),
    ).toBeVisible();
  });

  test("related signals: logs, exceptions, metrics and profile", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page, "checkout", "profile=samples");
    const signals: Locator = page.getByTestId("trace-signals");

    await expect(signals).toContainText(
      "POST /api/v1/checkout failed: upstream checkout-service returned 502",
    );

    await signals.getByTestId("trace-signal-tab-metrics").click();
    await expect(signals.getByTestId("trace-metrics")).toContainText(
      "http.server.duration",
    );
    await expect(signals.getByTestId("trace-signal-tab-metrics")).toContainText(
      "2",
    );

    await signals.getByTestId("trace-signal-tab-profile").click();
    await expect(signals.getByTestId("trace-profile")).toContainText(
      "842 profile samples",
    );

    await signals.getByTestId("trace-signal-tab-exceptions").click();
    await expect(signals).toContainText("Exceptions for this Trace");
    await screenshot(page, "related-signals", false);
  });

  test("metrics that fail to load show an error", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page, "checkout", "fail=metrics");

    await page.getByTestId("trace-signal-tab-metrics").click();

    await expect(page.getByTestId("trace-metrics")).toContainText(
      "Metrics are unavailable.",
    );
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the page fits the screen and the span panel opens as a sheet", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLoaded(page);

    const overflow: number = await page.evaluate(() => {
      return document.documentElement.scrollWidth - window.innerWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
    await screenshot(page, "phone", false);

    const update: string = await spanId(page, "UPDATE stock");
    await row(page, update).click();
    const panel: Locator = page.getByTestId("trace-span-panel");
    await expect(panel).toBeVisible();
    const box: { x: number; y: number; width: number; height: number } =
      (await panel.boundingBox())!;
    expect(box.width).toBeGreaterThan(380);
    await screenshot(page, "phone-span", false);

    await page.getByTestId("span-panel-close").click();
    await expect(panel).toHaveCount(0);
  });
});
