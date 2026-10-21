import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import path from "path";

/*
 * Issue #4708 in a real browser: what the Logs and Traces explorers ask the
 * server while a key is typed into their search bar, in the production
 * explorers on the offline fixture (Fixture/Fixture.js).
 *
 * The value picker behind `@key:` used to ask for a key's values whenever
 * the last word looked like `@key:` - so typing a key over the search help's
 * `@http.status_code:500` asked for every prefix of it (17 lookups for
 * `exception.message`, each a scan of a day of logs), a key the project does
 * not have was asked about, and every key asked about again when it came
 * back. What the page does now, and this spec counts:
 *
 *   - a key is asked about once the reader stops typing, once, for the whole
 *     key, with the time range on screen;
 *   - a key the project does not have is never asked about;
 *   - a key asked about before is not asked about again;
 *   - a lookup that runs out of time says so in the dropdown, with Try
 *     again beside its hint (near the words, not at the far end of a wide
 *     dropdown), and Try again asks again - from the mouse, or from the
 *     keyboard with the down arrow and Enter, the focus never leaving the
 *     search box;
 *   - a lookup that finds no values says so, instead of the dropdown
 *     vanishing after its loading line;
 *   - at phone width that message fits the screen.
 *
 * The fixture records every API call the page makes (its `requests`); its
 * `timeLimit.attributeValues` makes the value lookups answer as the API
 * answers a read ClickHouse stopped (504), its `noAttributeValues` as the
 * API answers a key the rows of the range do not carry (no values), and its
 * `valuesGate` holds their answers until the spec delivers them.
 */

const PORT: string = process.env["CHART_TIME_ZOOM_FIXTURE_PORT"] || "4233";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;

const LOGS_PATH: string = `/dashboard/${PROJECT_ID}/logs`;
const TRACES_PATH: string = `/dashboard/${PROJECT_ID}/traces`;

const LOG_VALUES: string = "/telemetry/logs/get-attribute-values";
const LOG_KEYS: string = "/telemetry/logs/get-attributes";
const TRACE_VALUES: string = "/telemetry/traces/get-attribute-values";

const ERROR_TEST_ID: string = "attribute-values-load-error";
const RETRY_TEST_ID: string = "attribute-values-retry";
const EMPTY_TEST_ID: string = "attribute-values-empty";
const KEY_IN_SENTENCE_TEST_ID: string = "attribute-key-in-sentence";
const SUGGESTIONS_TEST_ID: string = "search-suggestions";
const LOADING_TEST_ID: string = "search-suggestions-loading";

// The fixture's services, the values of `resource.service.name`.
const SERVICE_NAMES: Array<string> = [
  "checkout-api",
  "payments-worker",
  "search-api",
  "storefront-web",
];

// A person typing: faster than the picker's pause (400 ms) between keys.
const KEYSTROKE_DELAY_MS: number = 90;

// Long enough for a pause to have passed and its lookup to have answered.
const SETTLE_MS: number = 1500;

// Where the screenshots go, beside the other fixture specs' (gitignored).
const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/chart-time-zoom-ui",
);

const SEARCH_LOGS: RegExp = /Search logs/;
const SEARCH_TRACES: RegExp = /Search traces/;

interface RecordedRequest {
  seq: number;
  kind: string;
  url?: string | undefined;
  body?: Record<string, unknown> | undefined;
}

interface FixtureGate {
  mode: string;
  pending: Array<unknown>;
  deliver: () => number;
}

interface FixtureState {
  requests: Array<RecordedRequest>;
  unhandled: Array<Record<string, unknown>>;
  timeLimit: { attributeValues?: boolean | undefined };
  noAttributeValues: boolean;
  valuesGate: FixtureGate;
}

interface SpecWindow {
  __chartTimeZoomFixture: FixtureState;
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

async function openExplorer(page: Page, path: string): Promise<void> {
  // Every fixture value is a function of time; timers keep running.
  await page.clock.setFixedTime(NOW);
  await page.goto(path);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
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

// The bodies of the calls the page made to `path`.
async function callsTo(
  page: Page,
  path: string,
): Promise<Array<Record<string, unknown>>> {
  return (await requests(page))
    .filter((request: RecordedRequest): boolean => {
      return request.kind === "api" && Boolean(request.url?.endsWith(path));
    })
    .map((request: RecordedRequest): Record<string, unknown> => {
      return request.body || {};
    });
}

async function keysAskedFor(page: Page, path: string): Promise<Array<string>> {
  return (await callsTo(page, path)).map(
    (body: Record<string, unknown>): string => {
      return String(body["attributeKey"]);
    },
  );
}

async function setValuesStopped(page: Page, stopped: boolean): Promise<void> {
  await page.evaluate((isStopped: boolean) => {
    (window as unknown as SpecWindow).__chartTimeZoomFixture.timeLimit = {
      ...(window as unknown as SpecWindow).__chartTimeZoomFixture.timeLimit,
      attributeValues: isStopped,
    };
  }, stopped);
}

async function setNoValues(page: Page, hasNone: boolean): Promise<void> {
  await page.evaluate((none: boolean) => {
    (window as unknown as SpecWindow).__chartTimeZoomFixture.noAttributeValues =
      none;
  }, hasNone);
}

// The search box, once the explorer has its attribute keys.
async function searchBox(
  page: Page,
  placeholder: RegExp,
  keysPath: string,
): Promise<Locator> {
  const box: Locator = page.getByPlaceholder(placeholder);
  await expect(box).toBeVisible({ timeout: 30000 });

  await expect
    .poll(
      async (): Promise<number> => {
        return (await callsTo(page, keysPath)).length;
      },
      { timeout: 30000 },
    )
    .toBe(1);

  await box.click();
  return box;
}

// A value the search box's dropdown offers (never a facet row of the same name).
function dropdownOption(page: Page, value: string): Locator {
  return page
    .getByTestId(SUGGESTIONS_TEST_ID)
    .locator("button")
    .filter({ hasText: value });
}

/*
 * ---------------------------------------------------------------------------
 * Logs explorer
 * ---------------------------------------------------------------------------
 */

test.describe("Logs explorer: the @key: value picker", () => {
  test("typing a key asks for its values once, after the reader pauses, for the range on screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, LOGS_PATH);
    const box: Locator = await searchBox(page, SEARCH_LOGS, LOG_KEYS);

    await box.pressSequentially("@resource.service.name:", {
      delay: KEYSTROKE_DELAY_MS,
    });

    for (const name of SERVICE_NAMES) {
      await expect(dropdownOption(page, name)).toBeVisible({
        timeout: 15000,
      });
    }

    await page.waitForTimeout(SETTLE_MS);

    // REGRESSION: one lookup, for the whole key - not one per letter typed.
    const lookups: Array<Record<string, unknown>> = await callsTo(
      page,
      LOG_VALUES,
    );

    expect(lookups).toHaveLength(1);
    expect(lookups[0]!["attributeKey"]).toBe("resource.service.name");

    // The range on screen: the explorer's default, the past hour.
    const start: number = new Date(String(lookups[0]!["startTime"])).getTime();
    const end: number = new Date(String(lookups[0]!["endTime"])).getTime();
    expect(end - start).toBe(HOUR);
    expect(end).toBe(NOW.getTime());

    await page.screenshot({
      path: path.join(SCREENSHOTS, "value-suggestions-logs-synthetic.png"),
    });

    // Typing the value narrows the list in place, asking nothing more.
    await box.pressSequentially("pay", { delay: KEYSTROKE_DELAY_MS });
    await expect(dropdownOption(page, "payments-worker")).toBeVisible();
    await expect(dropdownOption(page, "checkout-api")).toHaveCount(0);
    await page.waitForTimeout(SETTLE_MS);
    expect(await callsTo(page, LOG_VALUES)).toHaveLength(1);
  });

  test("typing a key over the search help's example asks only for the key stopped on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, LOGS_PATH);
    const box: Locator = await searchBox(page, SEARCH_LOGS, LOG_KEYS);

    // `@<key>:500` with the key typed between the @ and the colon.
    await box.fill("@:500");
    await box.press("Home");
    await box.press("ArrowRight");
    await box.pressSequentially("resource.host.name", {
      delay: KEYSTROKE_DELAY_MS,
    });
    await expect(box).toHaveValue("@resource.host.name:500");

    await page.waitForTimeout(SETTLE_MS);

    // Before: one lookup for every prefix, r, re, res, ... - eighteen.
    expect(await keysAskedFor(page, LOG_VALUES)).toEqual([
      "resource.host.name",
    ]);
  });

  test("a key the project does not have is never asked about", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, LOGS_PATH);
    const box: Locator = await searchBox(page, SEARCH_LOGS, LOG_KEYS);

    await box.pressSequentially("@resource.servce.name:", {
      delay: KEYSTROKE_DELAY_MS,
    });
    await page.waitForTimeout(SETTLE_MS);

    expect(await callsTo(page, LOG_VALUES)).toHaveLength(0);
    await expect(page.getByText("Loading values for")).toHaveCount(0);
  });

  test("a key asked about before is not asked about again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, LOGS_PATH);
    const box: Locator = await searchBox(page, SEARCH_LOGS, LOG_KEYS);

    await box.pressSequentially("@resource.service.name:", {
      delay: KEYSTROKE_DELAY_MS,
    });
    await expect(dropdownOption(page, "search-api")).toBeVisible({
      timeout: 15000,
    });

    await box.fill("");
    await box.pressSequentially("@resource.host.name:", {
      delay: KEYSTROKE_DELAY_MS,
    });
    await page.waitForTimeout(SETTLE_MS);

    await box.fill("");
    await box.pressSequentially("@resource.service.name:", {
      delay: KEYSTROKE_DELAY_MS,
    });

    // At once, from the answer already here.
    await expect(dropdownOption(page, "search-api")).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);

    expect(await keysAskedFor(page, LOG_VALUES)).toEqual([
      "resource.service.name",
      "resource.host.name",
    ]);
  });

  test("a lookup that runs out of time says so, and Try again asks again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, LOGS_PATH);
    const box: Locator = await searchBox(page, SEARCH_LOGS, LOG_KEYS);

    await setValuesStopped(page, true);
    await box.pressSequentially("@resource.service.name:", {
      delay: KEYSTROKE_DELAY_MS,
    });

    const error: Locator = page.getByTestId(ERROR_TEST_ID);
    await expect(error).toBeVisible({ timeout: 15000 });
    await expect(error).toContainText(
      "Values for resource.service.name took too long to load.",
    );
    await expect(error).toContainText(
      "You can still type a value and press Enter.",
    );
    // Not the search's own message: nothing else on the page changed.
    await expect(page.getByTestId("telemetry-load-error")).toHaveCount(0);
    await expect(page.getByText("Loading values for")).toHaveCount(0);

    await page.screenshot({
      path: path.join(SCREENSHOTS, "value-suggestions-stopped-synthetic.png"),
    });

    await setValuesStopped(page, false);
    await page.getByTestId(RETRY_TEST_ID).click();

    for (const name of SERVICE_NAMES) {
      await expect(dropdownOption(page, name)).toBeVisible({
        timeout: 15000,
      });
    }
    await expect(error).toHaveCount(0);
    // The box kept the focus: the reader goes on typing.
    await expect(box).toBeFocused();

    expect(await keysAskedFor(page, LOG_VALUES)).toEqual([
      "resource.service.name",
      "resource.service.name",
    ]);
  });

  test("Try again sits beside the hint, under the words, not at the far end of the dropdown", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, LOGS_PATH);
    const box: Locator = await searchBox(page, SEARCH_LOGS, LOG_KEYS);

    await setValuesStopped(page, true);
    await box.pressSequentially("@resource.service.name:", {
      delay: KEYSTROKE_DELAY_MS,
    });

    const error: Locator = page.getByTestId(ERROR_TEST_ID);
    await expect(error).toBeVisible({ timeout: 15000 });

    // The key is drawn as typed, in monospace, as the search box draws it.
    const key: Locator = error.getByTestId(KEY_IN_SENTENCE_TEST_ID);
    await expect(key).toHaveText("resource.service.name");
    const keyFont: string = await key.evaluate((element: Element): string => {
      return window.getComputedStyle(element).fontFamily;
    });
    expect(keyFont.toLowerCase()).toContain("mono");

    const dropdownBox: { x: number; width: number } | null = await page
      .getByTestId(SUGGESTIONS_TEST_ID)
      .boundingBox();
    const sentenceBox: { x: number; y: number; height: number } | null =
      await error.locator("p").first().boundingBox();
    const retryBox: { x: number; y: number } | null = await page
      .getByTestId(RETRY_TEST_ID)
      .boundingBox();

    expect(dropdownBox).not.toBeNull();
    expect(sentenceBox).not.toBeNull();
    expect(retryBox).not.toBeNull();

    // The dropdown is as wide as the search box: well over 1,000 px here.
    expect(dropdownBox!.width).toBeGreaterThan(1000);
    // Try again is under the sentence, within its first half - not at the end.
    expect(retryBox!.y).toBeGreaterThanOrEqual(
      sentenceBox!.y + sentenceBox!.height - 1,
    );
    expect(retryBox!.x - dropdownBox!.x).toBeLessThan(dropdownBox!.width / 2);
  });

  test("while a lookup is out the line says whose values are loading, and its words stay put when it turns into the could-not-load row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, LOGS_PATH);
    const box: Locator = await searchBox(page, SEARCH_LOGS, LOG_KEYS);

    // Hold the lookup's answer until the loading line has been looked at.
    await page.evaluate(() => {
      (window as unknown as SpecWindow).__chartTimeZoomFixture.valuesGate.mode =
        "manual";
    });
    await box.pressSequentially("@resource.service.name:", {
      delay: KEYSTROKE_DELAY_MS,
    });

    await expect
      .poll(
        async (): Promise<number> => {
          return page.evaluate((): number => {
            return (window as unknown as SpecWindow).__chartTimeZoomFixture
              .valuesGate.pending.length;
          });
        },
        { timeout: 15000 },
      )
      .toBe(1);

    const loading: Locator = page.getByTestId(LOADING_TEST_ID);
    await expect(loading).toHaveText(
      "Loading values for resource.service.name...",
    );
    await expect(loading.getByTestId(KEY_IN_SENTENCE_TEST_ID)).toHaveText(
      "resource.service.name",
    );
    const loadingWords: { x: number } | null = await loading
      .locator("span")
      .first()
      .boundingBox();

    await page.screenshot({
      path: path.join(SCREENSHOTS, "value-suggestions-loading-synthetic.png"),
    });

    // The held lookup ran out of time.
    await setValuesStopped(page, true);
    await page.evaluate((): number => {
      return (
        window as unknown as SpecWindow
      ).__chartTimeZoomFixture.valuesGate.deliver();
    });

    const error: Locator = page.getByTestId(ERROR_TEST_ID);
    await expect(error).toBeVisible({ timeout: 15000 });
    await expect(loading).toHaveCount(0);
    const errorWords: { x: number } | null = await error
      .locator("p")
      .first()
      .boundingBox();

    expect(loadingWords).not.toBeNull();
    expect(errorWords).not.toBeNull();
    // The sentence starts where the loading line's did: nothing jumps.
    expect(Math.abs(errorWords!.x - loadingWords!.x)).toBeLessThanOrEqual(1);
  });

  test("Try again from the keyboard: the down arrow selects it and Enter asks again, the focus staying in the box", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, LOGS_PATH);
    const box: Locator = await searchBox(page, SEARCH_LOGS, LOG_KEYS);

    await setValuesStopped(page, true);
    await box.pressSequentially("@resource.service.name:", {
      delay: KEYSTROKE_DELAY_MS,
    });

    const retry: Locator = page.getByTestId(RETRY_TEST_ID);
    await expect(retry).toBeVisible({ timeout: 15000 });
    await expect(retry).toHaveAttribute("data-selected", "false");

    await box.press("ArrowDown");
    await expect(retry).toHaveAttribute("data-selected", "true");
    await expect(box).toBeFocused();

    await page.screenshot({
      path: path.join(
        SCREENSHOTS,
        "value-suggestions-retry-selected-synthetic.png",
      ),
    });

    await setValuesStopped(page, false);
    await box.press("Enter");

    for (const name of SERVICE_NAMES) {
      await expect(dropdownOption(page, name)).toBeVisible({
        timeout: 15000,
      });
    }
    await expect(box).toBeFocused();
    // Enter asked again; it made no chip of the empty value and ran no search.
    await expect(box).toHaveValue("@resource.service.name:");
    expect(await keysAskedFor(page, LOG_VALUES)).toEqual([
      "resource.service.name",
      "resource.service.name",
    ]);
  });

  test("a lookup that finds no values says so, until a value of one's own is typed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, LOGS_PATH);
    const box: Locator = await searchBox(page, SEARCH_LOGS, LOG_KEYS);

    await setNoValues(page, true);
    await box.pressSequentially("@resource.service.name:", {
      delay: KEYSTROKE_DELAY_MS,
    });

    const empty: Locator = page.getByTestId(EMPTY_TEST_ID);
    await expect(empty).toBeVisible({ timeout: 15000 });
    await expect(empty).toContainText(
      "No values to suggest for resource.service.name in this time range.",
    );
    await expect(empty).toContainText(
      "You can still type a value and press Enter.",
    );
    // Nothing failed: no error, nothing to try again, no loading line.
    await expect(page.getByTestId(ERROR_TEST_ID)).toHaveCount(0);
    await expect(page.getByTestId(RETRY_TEST_ID)).toHaveCount(0);
    await expect(page.getByText("Loading values for")).toHaveCount(0);

    await page.screenshot({
      path: path.join(SCREENSHOTS, "value-suggestions-empty-synthetic.png"),
    });

    // A value of one's own: the line steps aside, nothing more is asked.
    await box.pressSequentially("canary", { delay: KEYSTROKE_DELAY_MS });
    await expect(empty).toHaveCount(0);
    await page.waitForTimeout(SETTLE_MS);
    expect(await keysAskedFor(page, LOG_VALUES)).toEqual([
      "resource.service.name",
    ]);
  });

  test("at phone width the could-not-load message fits the screen and widens nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openExplorer(page, `${LOGS_PATH}?theme=dark`);
    const box: Locator = await searchBox(page, SEARCH_LOGS, LOG_KEYS);

    /*
     * How wide the page is before the dropdown opens: the log table's own
     * columns are wider than a phone, which is not this dropdown's doing.
     */
    const pageWidth: () => Promise<number> = (): Promise<number> => {
      return page.evaluate((): number => {
        return document.documentElement.scrollWidth;
      });
    };
    const widthBefore: number = await pageWidth();

    await setValuesStopped(page, true);
    await box.pressSequentially("@resource.service.name:", {
      delay: KEYSTROKE_DELAY_MS,
    });

    const error: Locator = page.getByTestId(ERROR_TEST_ID);
    await expect(error).toBeVisible({ timeout: 15000 });

    const errorBox: { x: number; width: number } | null =
      await error.boundingBox();
    const retryBox: { x: number; width: number } | null = await page
      .getByTestId(RETRY_TEST_ID)
      .boundingBox();

    expect(errorBox).not.toBeNull();
    expect(errorBox!.x).toBeGreaterThanOrEqual(0);
    expect(errorBox!.x + errorBox!.width).toBeLessThanOrEqual(390);
    expect(retryBox!.x + retryBox!.width).toBeLessThanOrEqual(390);

    // The message wraps inside the dropdown: the page grows no wider.
    expect(await pageWidth()).toBeLessThanOrEqual(widthBefore);

    await page.screenshot({
      path: path.join(
        SCREENSHOTS,
        "value-suggestions-stopped-phone-dark-synthetic.png",
      ),
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * Traces explorer (the shared search bar of the other explorers)
 * ---------------------------------------------------------------------------
 */

test.describe("Traces explorer: the @key: value picker", () => {
  test("typing a key asks once, for the whole key; a key asked about before is not asked again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, TRACES_PATH);
    const box: Locator = await searchBox(
      page,
      SEARCH_TRACES,
      "/telemetry/traces/get-attributes",
    );

    await box.pressSequentially("@http.route:", { delay: KEYSTROKE_DELAY_MS });
    await expect(dropdownOption(page, "/api/checkout")).toBeVisible({
      timeout: 15000,
    });

    await box.fill("");
    await box.pressSequentially("@http.route:", { delay: KEYSTROKE_DELAY_MS });
    await expect(dropdownOption(page, "/api/checkout")).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);

    const lookups: Array<Record<string, unknown>> = await callsTo(
      page,
      TRACE_VALUES,
    );

    expect(
      lookups.map((body: Record<string, unknown>): unknown => {
        return body["attributeKey"];
      }),
    ).toEqual(["http.route"]);
    expect(
      new Date(String(lookups[0]!["endTime"])).getTime() -
        new Date(String(lookups[0]!["startTime"])).getTime(),
    ).toBe(HOUR);
  });

  test("a lookup that runs out of time says so; the keyboard's Try again asks again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, TRACES_PATH);
    const box: Locator = await searchBox(
      page,
      SEARCH_TRACES,
      "/telemetry/traces/get-attributes",
    );

    await setValuesStopped(page, true);
    await box.pressSequentially("@http.route:", { delay: KEYSTROKE_DELAY_MS });

    const error: Locator = page.getByTestId(ERROR_TEST_ID);
    await expect(error).toBeVisible({ timeout: 15000 });
    await expect(error).toContainText(
      "Values for http.route took too long to load.",
    );

    await setValuesStopped(page, false);
    await box.press("ArrowDown");
    await box.press("Enter");

    await expect(dropdownOption(page, "/api/checkout")).toBeVisible({
      timeout: 15000,
    });
    await expect(error).toHaveCount(0);
    await expect(box).toBeFocused();
    expect(await keysAskedFor(page, TRACE_VALUES)).toEqual([
      "http.route",
      "http.route",
    ]);
  });

  test("a lookup that finds no values says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, TRACES_PATH);
    const box: Locator = await searchBox(
      page,
      SEARCH_TRACES,
      "/telemetry/traces/get-attributes",
    );

    await setNoValues(page, true);
    await box.pressSequentially("@http.route:", { delay: KEYSTROKE_DELAY_MS });

    await expect(page.getByTestId(EMPTY_TEST_ID)).toContainText(
      "No values to suggest for http.route in this time range.",
      { timeout: 15000 },
    );
  });

  test("typing a key over another asks only for the key stopped on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openExplorer(page, TRACES_PATH);
    const box: Locator = await searchBox(
      page,
      SEARCH_TRACES,
      "/telemetry/traces/get-attributes",
    );

    await box.fill("@:500");
    await box.press("Home");
    await box.press("ArrowRight");
    await box.pressSequentially("http.method", { delay: KEYSTROKE_DELAY_MS });
    await page.waitForTimeout(SETTLE_MS);

    expect(await keysAskedFor(page, TRACE_VALUES)).toEqual(["http.method"]);
  });
});
