import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";

/*
 * Issue #4709 in a real browser: every load of the logs explorer - a
 * refresh, a shared link, an edited URL - read its log list twice, and the
 * second read put a page the URL restored back to page 1.
 *
 * The viewer's base-scope effect ran right after mount and rebuilt the list
 * query its initializer had just built, with the relative window resolved
 * again a few milliseconds later; the new query read the list a second time,
 * and the effect reset the page. A link that named a saved view (every
 * reload once a view is selected: the URL carries it) read the list once
 * for the link's bare scope and once more for the view, on page 1.
 *
 * Here the production Logs and Traces explorers run on the offline fixture
 * (Fixture/Fixture.js), which records every request in order. The browser
 * clock is installed at the fixture's moment and keeps ticking, as a real
 * page's does, so a rebuilt relative window is a later window.
 */

const PORT: string = process.env["CHART_TIME_ZOOM_FIXTURE_PORT"] || "4233";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const DAY: number = 24 * 60 * 60 * 1000;
// The logs explorer's page size on /logs, and the traces explorer's default.
const LOGS_PAGE_SIZE: number = 100;
const TRACES_PAGE_SIZE: number = 50;
const LOG_TABLE: string = "LogItemV3";
const SPAN_TABLE: string = "SpanItemV3";
// After the list has drawn: long enough for a second read to have gone out.
const SETTLE_MS: number = 1500;

interface RecordedWindow {
  column?: string | undefined;
  start: string | null;
  end: string | null;
}

interface RecordedRequest {
  seq: number;
  kind: string;
  modelName?: string | undefined;
  url?: string | undefined;
  query?: Record<string, unknown> | undefined;
  window?: RecordedWindow | null | undefined;
  skip?: number | undefined;
  limit?: number | undefined;
}

interface SpecWindow {
  __chartTimeZoomFixture: {
    requests: Array<RecordedRequest>;
    unhandled: Array<Record<string, unknown>>;
    dataset: { logSavedViewId: string };
    listGate: { mode: string; deliver: () => number };
  };
  __chartTimeZoomGates?: Record<
    string,
    { mode: string; tables: Array<string> }
  >;
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

  // The fixture's moment, and a clock that keeps ticking from it.
  await page.clock.install({ time: NOW });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const unhandled: Array<Record<string, unknown>> = await page
    .evaluate((): Array<Record<string, unknown>> => {
      const state: SpecWindow["__chartTimeZoomFixture"] | undefined = (
        window as unknown as Partial<SpecWindow>
      ).__chartTimeZoomFixture;
      return state
        ? (JSON.parse(JSON.stringify(state.unhandled)) as Array<
            Record<string, unknown>
          >)
        : [];
    })
    .catch((): Array<Record<string, unknown>> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function requests(page: Page): Promise<Array<RecordedRequest>> {
  return page.evaluate((): Array<RecordedRequest> => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as SpecWindow).__chartTimeZoomFixture.requests,
      ),
    ) as Array<RecordedRequest>;
  });
}

// Every read of `table`'s list since the page loaded, in order.
async function listReads(
  page: Page,
  table: string,
): Promise<Array<RecordedRequest>> {
  return (await requests(page)).filter((request: RecordedRequest): boolean => {
    return request.kind === "analytics.getList" && request.modelName === table;
  });
}

function windowLength(request: RecordedRequest): number {
  return (
    new Date(request.window!.end!).getTime() -
    new Date(request.window!.start!).getTime()
  );
}

function describeReads(reads: Array<RecordedRequest>): string {
  return reads
    .map((read: RecordedRequest): string => {
      return `#${read.seq} skip ${read.skip} ${read.window?.start} → ${read.window?.end}`;
    })
    .join("; ");
}

function pageParam(page: Page): string | null {
  return new URL(page.url()).searchParams.get("page");
}

async function openLogs(page: Page, search: string): Promise<void> {
  await page.goto(`/dashboard/${PROJECT_ID}/logs${search}`);
  await waitForLogsList(page);
}

async function waitForLogsList(page: Page): Promise<void> {
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(
    page.getByTestId("logs-pagination").getByTestId("pagination-summary"),
  ).toContainText("Showing", { timeout: 30000 });
  /*
   * A second read went out with the first, right after mount; give the page
   * time to send anything else it is going to.
   */
  await page.waitForTimeout(SETTLE_MS);
}

test.describe("the logs explorer reads its list once per page load (#4709)", () => {
  test("a reload with a relative range and a page reads that page once, and the page stays", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const visit of ["link", "reload"]) {
      if (visit === "link") {
        await openLogs(page, "?range=Past%201%20Day&page=3");
      } else {
        await page.reload();
        await waitForLogsList(page);
      }

      const reads: Array<RecordedRequest> = await listReads(page, LOG_TABLE);

      expect(
        reads,
        `${visit}: one list read, not two (${describeReads(reads)})`,
      ).toHaveLength(1);
      expect(reads[0]!.skip, `${visit}: page 3`).toBe(2 * LOGS_PAGE_SIZE);
      expect(reads[0]!.limit).toBe(LOGS_PAGE_SIZE);
      expect(windowLength(reads[0]!), `${visit}: the past day`).toBe(DAY);

      // The page the link restored is the page on screen, and in the URL.
      await expect(
        page.getByTestId("logs-pagination").getByTestId("pagination-summary"),
      ).toContainText("Showing 201-300");
      expect(pageParam(page), `${visit}: ?page= kept`).toBe("3");
    }
  });

  test("a link with chips and a custom window reads it once, exactly", async ({
    page,
  }: {
    page: Page;
  }) => {
    const filters: string = encodeURIComponent(
      JSON.stringify([["severityText", ["Error"]]]),
    );
    await openLogs(
      page,
      `?range=Custom&start=2026-09-21T11%3A00%3A00.000Z&end=2026-09-21T11%3A30%3A00.000Z&filters=${filters}`,
    );

    const reads: Array<RecordedRequest> = await listReads(page, LOG_TABLE);

    expect(reads, describeReads(reads)).toHaveLength(1);
    expect(reads[0]!.window).toEqual({
      column: "time",
      start: "2026-09-21T11:00:00.000Z",
      end: "2026-09-21T11:30:00.000Z",
    });
    expect(reads[0]!.query!["severityText"]).toBe("Error");
    expect(new URL(page.url()).searchParams.get("filters")).toBe(
      JSON.stringify([["severityText", ["Error"]]]),
    );
  });

  test("an old link to a page past the end goes back to page 1 in one step", async ({
    page,
  }: {
    page: Page;
  }) => {
    const filters: string = encodeURIComponent(
      JSON.stringify([["severityText", ["Error"]]]),
    );
    // Half an hour of errors is one page; the link is to page 40.
    await openLogs(
      page,
      `?range=Custom&start=2026-09-21T11%3A00%3A00.000Z&end=2026-09-21T11%3A30%3A00.000Z&filters=${filters}&page=40`,
    );

    const reads: Array<RecordedRequest> = await listReads(page, LOG_TABLE);

    /*
     * Page 40, empty, then page 1 - not 39, 38, ... a read each, which
     * reading the list's lower-bound count as a total did.
     */
    expect(
      reads.map((read: RecordedRequest): number | undefined => {
        return read.skip;
      }),
      describeReads(reads),
    ).toEqual([39 * LOGS_PAGE_SIZE, 0]);
    expect(pageParam(page)).toBeNull();
  });

  test("a link that names a saved view reads the view once, on the link's page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`/dashboard/${PROJECT_ID}/logs`);
    await waitForLogsList(page);
    const savedViewId: string = await page.evaluate((): string => {
      return (window as unknown as SpecWindow).__chartTimeZoomFixture.dataset
        .logSavedViewId;
    });

    await openLogs(
      page,
      `?savedView=${savedViewId}&range=Past%201%20Day&page=2`,
    );

    const reads: Array<RecordedRequest> = await listReads(page, LOG_TABLE);

    /*
     * Before: the link's bare scope on page 2, then the view's query on
     * page 1. Now one read: the view's query, under the link's window, on
     * the link's page.
     */
    expect(reads, describeReads(reads)).toHaveLength(1);
    expect(reads[0]!.skip).toBe(LOGS_PAGE_SIZE);
    expect(reads[0]!.query!["severityText"]).toEqual({
      _type: "Includes",
      value: ["Error"],
    });
    expect(windowLength(reads[0]!)).toBe(DAY);
    expect(pageParam(page)).toBe("2");
    expect(new URL(page.url()).searchParams.get("savedView")).toBe(savedViewId);
    await expect(
      page.getByRole("button", { name: /^Checkout errors/ }).first(),
    ).toBeVisible();
  });

  test("turning live on reads up to now once; turning it off reads nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openLogs(page, "?range=Past%201%20Hour");
    expect(await listReads(page, LOG_TABLE)).toHaveLength(1);

    await page.getByRole("button", { name: "Live" }).click();
    await page.waitForTimeout(SETTLE_MS);

    const afterOn: Array<RecordedRequest> = await listReads(page, LOG_TABLE);
    expect(
      afterOn,
      `one read for turning live on (${describeReads(afterOn)})`,
    ).toHaveLength(2);
    // Up to now: a later window than the one the page loaded with.
    expect(new Date(afterOn[1]!.window!.end!).getTime()).toBeGreaterThan(
      new Date(afterOn[0]!.window!.end!).getTime(),
    );

    await page.getByRole("button", { name: "Live" }).click();
    await page.waitForTimeout(SETTLE_MS);

    expect(await listReads(page, LOG_TABLE)).toHaveLength(2);
  });
});

test.describe("the traces explorer reads its list once per page load", () => {
  test("a reload with a relative range and a page reads that page once, and the page stays", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const visit of ["link", "reload"]) {
      if (visit === "link") {
        await page.goto(
          `/dashboard/${PROJECT_ID}/traces?range=Past%201%20Day&page=2`,
        );
      } else {
        await page.reload();
      }
      await expect(page.getByTestId("synthetic-banner")).toBeVisible({
        timeout: 60000,
      });
      await expect
        .poll(
          async (): Promise<number> => {
            return (await listReads(page, SPAN_TABLE)).length;
          },
          { message: `${visit}: the span list was read`, timeout: 30000 },
        )
        .toBeGreaterThan(0);
      await page.waitForTimeout(SETTLE_MS);

      const reads: Array<RecordedRequest> = await listReads(page, SPAN_TABLE);

      expect(reads, `${visit}: ${describeReads(reads)}`).toHaveLength(1);
      expect(reads[0]!.skip).toBe(TRACES_PAGE_SIZE);
      expect(windowLength(reads[0]!)).toBe(DAY);
      expect(pageParam(page)).toBe("2");
    }
  });
});

// Every recorded request of `kind` on `model` since the page loaded.
async function readsOf(
  page: Page,
  kind: string,
  model: string,
): Promise<Array<RecordedRequest>> {
  return (await requests(page)).filter((request: RecordedRequest): boolean => {
    return request.kind === kind && request.modelName === model;
  });
}

// Every POST to an API path ending in `path` since the page loaded.
async function postsTo(
  page: Page,
  path: string,
): Promise<Array<RecordedRequest>> {
  return (await requests(page)).filter((request: RecordedRequest): boolean => {
    return (
      request.kind === "api" &&
      new URL(request.url || "http://unknown/").pathname.endsWith(path)
    );
  });
}

test.describe("the exceptions explorer reads its list, chart and facets once per page load (#4709)", () => {
  test("a link and a reload with a relative range: one list, one chart, one facet read, one round of class counts", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const visit of ["link", "reload"]) {
      if (visit === "link") {
        await page.goto(
          `/dashboard/${PROJECT_ID}/exceptions/unresolved?range=Past%201%20Day`,
        );
      } else {
        await page.reload();
      }
      await expect(page.getByTestId("synthetic-banner")).toBeVisible({
        timeout: 60000,
      });
      await expect(
        page.getByText(
          "context deadline exceeded calling payments-worker /charge",
        ),
      ).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(SETTLE_MS);

      const lists: Array<RecordedRequest> = await readsOf(
        page,
        "getList",
        "TelemetryException",
      );
      /*
       * Before: everything twice, when the service list landed a moment
       * after the first reads and rebuilt the same query.
       */
      expect(lists, `${visit}: ${describeReads(lists)}`).toHaveLength(1);
      expect(windowLength(lists[0]!)).toBe(DAY);
      expect(
        await postsTo(page, "/telemetry/exceptions/histogram"),
        `${visit}: one chart read`,
      ).toHaveLength(1);
      expect(
        await postsTo(page, "/telemetry/exceptions/facets"),
        `${visit}: one facet read`,
      ).toHaveLength(1);
      /*
       * One count per error class for the Error Class facet, and the
       * Unresolved tab's badge: six, not eleven.
       */
      expect(
        await readsOf(page, "count", "TelemetryException"),
        `${visit}: class counts once`,
      ).toHaveLength(6);
    }
  });
});

/*
 * Holds the fixture's ModelAPI.getList answers for `tables` from the first
 * request of the next page load: an explorer reads its saved views and its
 * service list as it mounts, before a spec can reach the page.
 */
async function holdOnLoad(page: Page, tables: Array<string>): Promise<void> {
  await page.addInitScript((heldTables: Array<string>) => {
    (window as unknown as SpecWindow).__chartTimeZoomGates = {
      listGate: { mode: "manual", tables: heldTables },
    };
  }, tables);
}

// Lets every held answer through, and every later one at once.
async function release(page: Page): Promise<void> {
  await page.evaluate((): void => {
    const gate: SpecWindow["__chartTimeZoomFixture"]["listGate"] = (
      window as unknown as SpecWindow
    ).__chartTimeZoomFixture.listGate;
    gate.mode = "immediate";
    gate.deliver();
  });
}

test.describe("while an explorer waits to know what it shows, every part of it says it is loading (#4709)", () => {
  /*
   * The wait is one small read and normally over in a moment; held here so
   * the moment can be looked at. Nothing may say "no logs" or "no values"
   * for a read that has not been sent, and nothing may show rows the
   * explorer is about to replace.
   */
  test("logs: a link that names a saved view, while the saved views load", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`/dashboard/${PROJECT_ID}/logs`);
    await waitForLogsList(page);
    const savedViewId: string = await page.evaluate((): string => {
      return (window as unknown as SpecWindow).__chartTimeZoomFixture.dataset
        .logSavedViewId;
    });

    await holdOnLoad(page, ["LogSavedView"]);
    await page.goto(
      `/dashboard/${PROJECT_ID}/logs?savedView=${savedViewId}&range=Past%201%20Day&page=2`,
    );
    await expect(page.getByTestId("synthetic-banner")).toBeVisible({
      timeout: 60000,
    });

    const footer: Locator = page
      .getByTestId("logs-pagination")
      .getByTestId("pagination-summary");
    await expect(footer).toHaveText("Loading...", { timeout: 30000 });
    // The list's own loader, in the room its rows will take.
    const list: Locator = page.getByTestId("logs-table");
    await expect(list.getByTestId("component-loader")).toBeVisible();
    expect((await list.boundingBox())!.height).toBeGreaterThanOrEqual(192);
    await expect(page.getByText("No logs found")).toHaveCount(0);
    await page.waitForTimeout(SETTLE_MS);
    expect(await listReads(page, LOG_TABLE)).toHaveLength(0);
    await expect(footer).toHaveText("Loading...");

    await release(page);

    await expect(footer).toContainText("Showing 101-", { timeout: 30000 });
    await page.waitForTimeout(SETTLE_MS);
    const reads: Array<RecordedRequest> = await listReads(page, LOG_TABLE);
    expect(reads, describeReads(reads)).toHaveLength(1);
    expect(reads[0]!.skip).toBe(LOGS_PAGE_SIZE);
    await expect(
      page.getByRole("button", { name: /^Checkout errors/ }).first(),
    ).toBeVisible();
  });

  test("exceptions: a `@service:` link, while the service names load", async ({
    page,
  }: {
    page: Page;
  }) => {
    await holdOnLoad(page, ["Service"]);
    await page.goto(
      `/dashboard/${PROJECT_ID}/exceptions/unresolved?range=Past%201%20Day&search=${encodeURIComponent(
        "@service:checkout-api",
      )}`,
    );
    await expect(page.getByTestId("synthetic-banner")).toBeVisible({
      timeout: 60000,
    });

    const footer: Locator = page
      .getByTestId("telemetry-pagination")
      .getByTestId("pagination-summary");
    await expect(footer).toHaveText("Loading...", { timeout: 30000 });
    // The sidebar's loader alone, not "No values" under every facet.
    await expect(
      page.getByTestId("telemetry-facet-sidebar-loader"),
    ).toBeVisible();
    await expect(page.getByText("No values in this time range")).toHaveCount(0);
    await expect(page.getByText("No exceptions found")).toHaveCount(0);
    await page.waitForTimeout(SETTLE_MS);
    expect(await readsOf(page, "getList", "TelemetryException")).toHaveLength(
      0,
    );
    await expect(footer).toHaveText("Loading...");

    await release(page);

    // One read, with the token resolved: checkout-api's two groups only.
    await expect(
      page.getByText(
        "context deadline exceeded calling payments-worker /charge",
      ),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByText("Cannot read properties of undefined (reading 'items')"),
    ).toBeVisible();
    await expect(page.getByText("no such index [products-v7]")).toHaveCount(0);
    await page.waitForTimeout(SETTLE_MS);
    expect(await readsOf(page, "getList", "TelemetryException")).toHaveLength(
      1,
    );
    await expect(
      page.getByTestId("telemetry-facet-sidebar-loader"),
    ).toHaveCount(0);
  });

  test("metrics: a `service:` link, while the service names load", async ({
    page,
  }: {
    page: Page;
  }) => {
    await holdOnLoad(page, ["Service"]);
    await page.goto(
      `/dashboard/${PROJECT_ID}/metrics?range=Past%201%20Hour&search=${encodeURIComponent(
        "service:checkout-api",
      )}`,
    );
    await expect(page.getByTestId("synthetic-banner")).toBeVisible({
      timeout: 60000,
    });

    const footer: Locator = page
      .getByTestId("telemetry-pagination")
      .getByTestId("pagination-summary");
    await expect(footer).toHaveText("Loading...", { timeout: 30000 });
    await expect(page.getByText("No metrics found")).toHaveCount(0);
    await page.waitForTimeout(SETTLE_MS);
    expect(await readsOf(page, "getList", "MetricType")).toHaveLength(0);
    await expect(footer).toHaveText("Loading...");

    await release(page);

    /*
     * One read, with the token applied. No metric series in the fixture
     * names a service, so the answer is empty - and only now says so.
     */
    await expect(page.getByText("No metrics found")).toBeVisible({
      timeout: 30000,
    });
    await expect(footer).toHaveText("No metrics");
    await page.waitForTimeout(SETTLE_MS);
    expect(await readsOf(page, "getList", "MetricType")).toHaveLength(1);
  });
});

test.describe("the metrics explorer reads its list and each sparkline once per page load (#4709)", () => {
  test("a link and a reload: one list read, one aggregate per row", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const visit of ["link", "reload"]) {
      if (visit === "link") {
        await page.goto(
          `/dashboard/${PROJECT_ID}/metrics?range=Past%201%20Hour`,
        );
      } else {
        await page.reload();
      }
      await expect(page.getByTestId("synthetic-banner")).toBeVisible({
        timeout: 60000,
      });
      await expect(page.getByText("k8s.node.cpu.utilization")).toBeVisible({
        timeout: 30000,
      });
      await page.waitForTimeout(SETTLE_MS);

      const lists: Array<RecordedRequest> = await readsOf(
        page,
        "getList",
        "MetricType",
      );
      expect(lists, `${visit}: one list read`).toHaveLength(1);

      /*
       * Every row's sparkline is one aggregate of its metric. Before: the
       * list was read again when the service list landed, and every row
       * aggregated again, a window a few milliseconds later.
       */
      const aggregated: Map<string, number> = new Map();
      for (const read of await readsOf(page, "aggregate", "MetricItemV3")) {
        const name: string = String(
          (read as RecordedRequest & { metricName?: string }).metricName,
        );
        aggregated.set(name, (aggregated.get(name) || 0) + 1);
      }
      expect(aggregated.size, `${visit}: every row drew`).toBeGreaterThan(0);
      for (const [name, times] of aggregated.entries()) {
        expect(times, `${visit}: ${name} aggregated once`).toBe(1);
      }
    }
  });
});
