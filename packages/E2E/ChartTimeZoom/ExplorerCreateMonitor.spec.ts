import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";

/*
 * CREATE MONITOR FROM WHERE THE DATA IS.
 *
 * The maintainer, on telemetry monitors: "Setting up monitors like log
 * traces, metrics, exceptions, etc., is stupidly difficult and very
 * complicated to understand and use." So the logs and trace explorers
 * offer Create monitor in their toolbars: a monitor of that type watching
 * what the view shows (TelemetryMonitorLink), handed to Create Monitor in
 * its address.
 *
 * Here the production explorers run on the offline fixture
 * (Fixture/Fixture.js), and what is pinned is what a reader meets: the
 * button in the toolbar, where it leads and with what, and a toolbar that
 * stays usable with one more button in it - the Traces search kept at
 * least 16rem wide beside its buttons, which wrap under it past that
 * (in a 1024px window the search was 8px wide).
 */

const PORT: string = process.env["CHART_TIME_ZOOM_FIXTURE_PORT"] || "4233";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");

const TRACES_PATH: string = `/dashboard/${PROJECT_ID}/traces`;
const LOGS_PATH: string = `/dashboard/${PROJECT_ID}/logs`;
const CREATE_PATH: string = `/dashboard/${PROJECT_ID}/monitors/create`;

// The search's least width from md up: 16rem.
const SEARCH_MIN_WIDTH_IN_PX: number = 256;

interface SpecWindow {
  __chartTimeZoomFixture: {
    unhandled: Array<Record<string, unknown>>;
    dataset: {
      services: Array<{ id: string; name: string }>;
      logSavedViewId: string;
    };
  };
}

interface LinkQuery {
  serviceIds?: Array<string>;
  severityTexts?: Array<string>;
  spanStatuses?: Array<number>;
  messageContains?: string;
  spanName?: string;
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

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
}

async function dataset(
  page: Page,
): Promise<SpecWindow["__chartTimeZoomFixture"]["dataset"]> {
  return page.evaluate((): SpecWindow["__chartTimeZoomFixture"]["dataset"] => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as SpecWindow).__chartTimeZoomFixture.dataset,
      ),
    ) as SpecWindow["__chartTimeZoomFixture"]["dataset"];
  });
}

// A facet section of the sidebar, by its title.
function facetSection(page: Page, title: string): Locator {
  return page
    .locator("button[aria-expanded][aria-controls]")
    .filter({ hasText: title })
    .first()
    .locator("xpath=../..");
}

// Where a Create monitor led: the page, the type and what it watches.
function createLink(url: string): {
  pathname: string;
  monitorType: string | null;
  query: LinkQuery;
} {
  const parsed: URL = new URL(url);
  const query: string | null = parsed.searchParams.get("telemetryQuery");

  return {
    pathname: parsed.pathname,
    monitorType: parsed.searchParams.get("monitorType"),
    query: query ? (JSON.parse(query) as LinkQuery) : {},
  };
}

async function boxOf(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box: { x: number; y: number; width: number; height: number } | null =
    await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

test.describe("Create monitor from the logs explorer", () => {
  test("sits in the toolbar, and leads to a Logs monitor watching the view's service and severity", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(120000);

    await open(page, LOGS_PATH);
    const { logSavedViewId, services } = await dataset(page);

    // The saved view "Checkout errors": checkout-api's errors.
    await open(
      page,
      `${LOGS_PATH}?savedView=${logSavedViewId}&range=Past%201%20Day`,
    );

    const button: Locator = page.getByTestId("logs-create-monitor");
    await expect(button).toBeVisible({ timeout: 60000 });
    await expect(button).toHaveText("Create monitor");

    await button.click();
    await page.waitForURL(
      (url: URL): boolean => {
        return url.pathname === CREATE_PATH;
      },
      { timeout: 30000 },
    );

    const link: ReturnType<typeof createLink> = createLink(page.url());
    expect(link.pathname).toBe(CREATE_PATH);
    expect(link.monitorType).toBe("Logs");
    expect(link.query.severityTexts).toEqual(["Error"]);
    expect(link.query.serviceIds).toEqual([services[0]!.id]);
  });

  test("on a phone the button stays on the screen, in the toolbar's own rows", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(120000);

    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, LOGS_PATH);

    const button: Locator = page.getByTestId("logs-create-monitor");
    await expect(button).toBeVisible({ timeout: 60000 });

    const box: { x: number; width: number } = await boxOf(button);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  });
});

test.describe("Create monitor from the trace explorer", () => {
  test("leads to a Traces monitor watching the view's service and status", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(120000);

    await open(page, TRACES_PATH);
    const { services } = await dataset(page);
    const checkout: { id: string; name: string } = services[0]!;

    await facetSection(page, "Service")
      .getByRole("checkbox", { name: checkout.name, exact: true })
      .click();
    await facetSection(page, "Status")
      .getByRole("checkbox", { name: "Error", exact: true })
      .click();

    const button: Locator = page.getByTestId("traces-create-monitor");
    await expect(button).toHaveText("Create monitor");
    await button.click();

    await page.waitForURL(
      (url: URL): boolean => {
        return url.pathname === CREATE_PATH;
      },
      { timeout: 30000 },
    );

    const link: ReturnType<typeof createLink> = createLink(page.url());
    expect(link.monitorType).toBe("Traces");
    expect(link.query.serviceIds).toEqual([checkout.id]);
    // OpenTelemetry's Error status: 2.
    expect(link.query.spanStatuses).toEqual([2]);
  });

  test("its search keeps 16rem beside the buttons; past that the buttons wrap under it", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, TRACES_PATH);

      const search: Locator = page.getByTestId("telemetry-viewer-search");
      const button: Locator = page.getByTestId("traces-create-monitor");
      await expect(button).toBeVisible({ timeout: 60000 });

      const searchBox: { x: number; y: number; width: number } =
        await boxOf(search);
      const buttonBox: { x: number; y: number; width: number } =
        await boxOf(button);

      expect(
        searchBox.width,
        `the search at ${width}px`,
      ).toBeGreaterThanOrEqual(SEARCH_MIN_WIDTH_IN_PX - 1);

      // Never painted over: the button is beside or under the search.
      const besideOrUnder: boolean =
        buttonBox.x >= searchBox.x + searchBox.width - 1 ||
        buttonBox.y > searchBox.y + 10;
      expect(besideOrUnder, `the button at ${width}px`).toBe(true);
    }
  });
});
