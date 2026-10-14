import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";

/*
 * Issue #4707 in a real browser: a search that runs into the query time
 * limit, in the production Logs and Traces explorers on the offline fixture
 * (Fixture/Fixture.js), each inside its production layout.
 *
 * ClickHouse stops a read at 45 seconds, and the API answers it with a 504
 * that says so. A stopped search used to replace the whole Logs explorer
 * with "Server Error", and a stopped chart or count simply vanished. What a
 * reader gets now, and what this spec holds in a real browser:
 *
 *   - the message goes where the rows go, in the reader's words, never over
 *     the page: the search bar, the time range and the filters stay, so the
 *     search can be narrowed in place;
 *   - when the list, the chart and the counts all stopped there is ONE
 *     message and one Try again, and Try again runs the search again;
 *   - counts the server could not finish say "Not counted" on their facet,
 *     under one note, and keep their values pickable without a count;
 *   - a chart that stopped says so in its own card, with its own Try again;
 *   - at phone width the message fits the screen.
 *
 * The fixture's `timeLimit` names the reads that stop. A test that starts
 * stopped sets window.__chartTimeZoomTimeLimit before the page loads.
 */

const PORT: string = process.env["CHART_TIME_ZOOM_FIXTURE_PORT"] || "4233";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");

const LOGS_PATH: string = `/dashboard/${PROJECT_ID}/logs`;
const TRACES_PATH: string = `/dashboard/${PROJECT_ID}/traces`;

const SEARCH_TOOK_TOO_LONG: string = "This search took too long";
const SEARCH_ADVICE: string =
  "It was stopped before it finished. Try a shorter time range or more specific filters.";
const CHART_TOOK_TOO_LONG: string = "This chart took too long to load";
const COUNTS_TOOK_TOO_LONG: string = "Filter counts took too long";
const NOT_COUNTED: string = "Not counted";

const MESSAGE_TEST_ID: string = "telemetry-load-error";
const RETRY_TEST_ID: string = "telemetry-load-error-retry";
const STOPPED_FACET_TEST_ID: string = "facet-count-stopped";

interface TimeLimit {
  lists: boolean;
  histograms: boolean;
  facets: Array<string>;
}

interface RecordedRequest {
  seq: number;
  kind: string;
  modelName?: string | undefined;
  url?: string | undefined;
}

interface FixtureState {
  requests: Array<RecordedRequest>;
  unhandled: Array<Record<string, unknown>>;
  timeLimit: TimeLimit;
}

interface SpecWindow {
  __chartTimeZoomFixture: FixtureState;
  __chartTimeZoomTimeLimit?: Partial<TimeLimit> | undefined;
}

const NOTHING_STOPPED: TimeLimit = {
  lists: false,
  histograms: false,
  facets: [],
};

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

  const unhandled: Array<Record<string, unknown>> = await page
    .evaluate((): Array<Record<string, unknown>> => {
      const fixture: FixtureState | undefined = (
        window as unknown as Partial<SpecWindow>
      ).__chartTimeZoomFixture;
      return fixture
        ? (JSON.parse(JSON.stringify(fixture.unhandled)) as Array<
            Record<string, unknown>
          >)
        : [];
    })
    .catch((): Array<Record<string, unknown>> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

// Opens an explorer with `stopped` in force from its first read.
async function openExplorer(
  page: Page,
  path: string,
  stopped: Partial<TimeLimit>,
): Promise<void> {
  await page.addInitScript((limit: Partial<TimeLimit>) => {
    (window as unknown as SpecWindow).__chartTimeZoomTimeLimit = limit;
  }, stopped);
  // Every fixture value is a function of time; timers keep running.
  await page.clock.setFixedTime(NOW);
  await page.goto(path);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
}

// Lifts every stop: the next reads answer.
async function liftTimeLimit(page: Page): Promise<void> {
  await page.evaluate((nothing: TimeLimit) => {
    (window as unknown as SpecWindow).__chartTimeZoomFixture.timeLimit =
      nothing;
  }, NOTHING_STOPPED);
}

async function requests(page: Page): Promise<Array<RecordedRequest>> {
  return page.evaluate((): Array<RecordedRequest> => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as SpecWindow).__chartTimeZoomFixture.requests,
      ),
    ) as Array<RecordedRequest>;
  });
}

// How many times `path` (an API path, or a table's list) was asked for.
async function countRequests(
  page: Page,
  match: (request: RecordedRequest) => boolean,
): Promise<number> {
  return (await requests(page)).filter(match).length;
}

function apiCalls(path: string): (request: RecordedRequest) => boolean {
  return (request: RecordedRequest): boolean => {
    return request.kind === "api" && Boolean(request.url?.endsWith(path));
  };
}

function listReads(modelName: string): (request: RecordedRequest) => boolean {
  return (request: RecordedRequest): boolean => {
    return (
      request.kind === "analytics.getList" && request.modelName === modelName
    );
  };
}

function messages(page: Page): Locator {
  return page.getByTestId(MESSAGE_TEST_ID);
}

function messageSaying(page: Page, title: string): Locator {
  return messages(page).filter({ hasText: title });
}

function logRows(page: Page): Locator {
  return page.locator("tbody tr[aria-selected]");
}

function spanRows(page: Page): Locator {
  return page.getByTestId("telemetry-viewer-list").locator("li");
}

/*
 * A facet section of the sidebar, by its title: the section around the
 * header button that folds it (the only buttons that control a section),
 * so a column header of the same name in the table is never taken for it.
 */
function facetSection(page: Page, title: string): Locator {
  return page
    .locator("button[aria-expanded][aria-controls]")
    .filter({ hasText: title })
    .first()
    .locator("xpath=../..");
}

/*
 * ---------------------------------------------------------------------------
 * Logs explorer
 * ---------------------------------------------------------------------------
 */

test.describe("Logs explorer: a search past the query time limit", () => {
  test("says it took too long where the rows go, once, with the search, the time range and the filters still there", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, LOGS_PATH, {
      lists: true,
      histograms: true,
      facets: ["severityText", "primaryEntityId"],
    });

    const message: Locator = messageSaying(page, SEARCH_TOOK_TOO_LONG);
    await expect(message).toBeVisible({ timeout: 30000 });
    await expect(message).toContainText(SEARCH_ADVICE);
    await expect(message.getByTestId(RETRY_TEST_ID)).toHaveText("Try again");

    // REGRESSION: never the whole page, never a bare "Server Error".
    await expect(page.getByText(/server error/i)).toHaveCount(0);
    await expect(
      page.getByPlaceholder(/Search logs/),
      "the search bar stays to narrow the search",
    ).toBeVisible();
    await expect(page.getByTestId("log-time-range-picker-button")).toHaveText(
      "Past 1 Hour",
    );
    await expect(page.getByRole("heading", { name: "Filters" })).toBeVisible();

    // One message for the whole search: the chart and the counts step aside.
    await expect(messages(page)).toHaveCount(1);
    await expect(page.getByText("Log Volume", { exact: true })).toHaveCount(0);
    await expect(page.getByText(COUNTS_TOOK_TOO_LONG)).toHaveCount(0);

    // Each stopped facet still says so, in two words.
    for (const title of ["Severity", "Service"]) {
      await expect(
        facetSection(page, title).getByTestId(STOPPED_FACET_TEST_ID),
      ).toHaveText(NOT_COUNTED);
    }

    // No rows from another search pass for this one's.
    await expect(logRows(page)).toHaveCount(0);
  });

  test("Try again runs the search again: the rows, the chart and the counts come back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, LOGS_PATH, {
      lists: true,
      histograms: true,
      facets: ["severityText", "primaryEntityId"],
    });

    const message: Locator = messageSaying(page, SEARCH_TOOK_TOO_LONG);
    await expect(message).toBeVisible({ timeout: 30000 });

    const lists: number = await countRequests(page, listReads("LogItemV3"));
    const charts: number = await countRequests(
      page,
      apiCalls("/telemetry/logs/histogram"),
    );
    const counts: number = await countRequests(
      page,
      apiCalls("/telemetry/logs/facets"),
    );

    await liftTimeLimit(page);
    await message.getByTestId(RETRY_TEST_ID).click();

    await expect(logRows(page).first()).toBeVisible({ timeout: 30000 });
    await expect(messages(page)).toHaveCount(0);
    await expect(page.getByText("Log Volume", { exact: true })).toBeVisible();
    await expect(page.getByTestId(STOPPED_FACET_TEST_ID)).toHaveCount(0);

    // One click ran each of the three reads once more.
    expect(await countRequests(page, listReads("LogItemV3"))).toBe(lists + 1);
    expect(
      await countRequests(page, apiCalls("/telemetry/logs/histogram")),
    ).toBe(charts + 1);
    expect(await countRequests(page, apiCalls("/telemetry/logs/facets"))).toBe(
      counts + 1,
    );
  });

  test("counts the server could not finish: one note, 'Not counted' on the facet, the values still pickable without a count", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, LOGS_PATH, {
      facets: ["severityText", "primaryEntityId"],
    });

    await expect(logRows(page).first()).toBeVisible({ timeout: 30000 });

    const note: Locator = messageSaying(page, COUNTS_TOOK_TOO_LONG);
    await expect(note).toBeVisible();
    await expect(note).toHaveAttribute("role", "status");
    await expect(note).toContainText(
      "Try a shorter time range or more specific filters.",
    );
    // The reason is said once, by the note.
    await expect(page.getByText(/took too long/)).toHaveCount(1);

    const service: Locator = facetSection(page, "Service");
    await expect(service.getByTestId(STOPPED_FACET_TEST_ID)).toHaveText(
      NOT_COUNTED,
    );
    await expect(service.getByText("checkout-api")).toBeVisible();
    // A dash where the count goes, never a 0 that is not true.
    await expect(service.getByTestId("facet-count-unknown")).toHaveCount(4);
    await expect(
      service.getByTestId("facet-count-unknown").first(),
    ).toContainText("—");

    // The rows and the chart are untouched.
    await expect(page.getByText("Log Volume", { exact: true })).toBeVisible();

    await liftTimeLimit(page);
    await note.getByTestId(RETRY_TEST_ID).click();

    await expect(page.getByTestId(STOPPED_FACET_TEST_ID)).toHaveCount(0);
    await expect(messages(page)).toHaveCount(0);
    await expect(service.getByTestId("facet-count-unknown")).toHaveCount(0);
  });

  test("a chart that took too long says so in its own card, and its Try again draws it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, LOGS_PATH, { histograms: true });

    await expect(logRows(page).first()).toBeVisible({ timeout: 30000 });

    const chartMessage: Locator = messageSaying(page, CHART_TOOK_TOO_LONG);
    await expect(chartMessage).toBeVisible();
    await expect(page.getByText("Log Volume", { exact: true })).toBeVisible();
    await expect(messages(page)).toHaveCount(1);

    await liftTimeLimit(page);
    await chartMessage.getByTestId(RETRY_TEST_ID).click();

    await expect(messages(page)).toHaveCount(0);
    await expect(page.locator(".recharts-wrapper")).toHaveCount(1, {
      timeout: 30000,
    });
  });

  test("at phone width the message fits the screen, and the page does not scroll sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openExplorer(page, LOGS_PATH, {
      lists: true,
      histograms: true,
      facets: ["severityText"],
    });

    const message: Locator = messageSaying(page, SEARCH_TOOK_TOO_LONG);
    await expect(message).toBeVisible({ timeout: 30000 });

    const box: { x: number; width: number } | null = await message
      .getByTestId(RETRY_TEST_ID)
      .boundingBox();
    expect(box, "Try again is on the screen").not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);

    const sideways: { scroll: number; client: number } = await page.evaluate(
      (): { scroll: number; client: number } => {
        return {
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        };
      },
    );
    expect(sideways.scroll).toBeLessThanOrEqual(sideways.client);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Traces explorer
 * ---------------------------------------------------------------------------
 */

test.describe("Traces explorer: a search past the query time limit", () => {
  test("says it took too long where the spans go, keeps the search and the filters, and Try again brings the spans", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, TRACES_PATH, {
      lists: true,
      histograms: true,
      facets: ["statusCode"],
    });

    const message: Locator = messageSaying(page, SEARCH_TOOK_TOO_LONG);
    await expect(message).toBeVisible({ timeout: 30000 });
    await expect(message).toContainText(SEARCH_ADVICE);
    await expect(page.getByText(/server error/i)).toHaveCount(0);

    await expect(page.getByTestId("telemetry-viewer-search")).toBeVisible();
    await expect(
      page.getByTestId("telemetry-time-range-picker-button"),
    ).toHaveText("Past 1 Hour");
    await expect(messages(page)).toHaveCount(1);
    await expect(
      facetSection(page, "Status").getByTestId(STOPPED_FACET_TEST_ID),
    ).toHaveText(NOT_COUNTED);
    await expect(spanRows(page)).toHaveCount(0);

    await liftTimeLimit(page);
    await message.getByTestId(RETRY_TEST_ID).click();

    await expect(spanRows(page).first()).toBeVisible({ timeout: 30000 });
    await expect(messages(page)).toHaveCount(0);
    await expect(page.getByTestId(STOPPED_FACET_TEST_ID)).toHaveCount(0);
  });
});
