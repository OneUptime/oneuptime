import {
  expect,
  Page,
  Request,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";

/*
 * Watching OneUptime with OneUptime (#6834), in the browser, on the real
 * Home page with DashboardRecording mounted as App.tsx mounts it.
 *
 * Above all: a Dashboard without OneUptime Cloud's configuration - every
 * self-hosted one, which is every scenario of this fixture but
 * ?recording=cloud - asks nobody anything for recording: no request to a
 * replay endpoint or to OneUptime Cloud, no switch read, and not even the
 * recorder's own code, which is a file of its own (DashboardRecorder-*.js)
 * that only a consenting person on Cloud ever fetches.
 *
 * Every request is logged, and anything leaving the fixture server is
 * aborted and fails the test.
 */

const PORT: string = process.env["HOME_OVERVIEW_FIXTURE_PORT"] || "4224";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-13T12:00:00.000Z");
const HOME: string = `/dashboard/${PROJECT_ID}/home/`;
const SETUP_HEALTH: string = `/dashboard/${PROJECT_ID}/home/setup-health`;
// The recorder's code: a file of its own, split out of the bundle by import().
const RECORDER_CHUNK: RegExp = /\/dist\/DashboardRecorder-[^/]*\.js$/;

const requests: Map<Page, Array<string>> = new Map();
const aborted: Map<Page, Array<string>> = new Map();
const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const seen: Array<string> = [];
  const left: Array<string> = [];
  const errors: Array<string> = [];

  requests.set(page, seen);
  aborted.set(page, left);
  pageErrors.set(page, errors);

  page.on("request", (request: Request) => {
    seen.push(request.url());
  });
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());

    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }

    left.push(route.request().url());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(aborted.get(page) || [], "requests that left the fixture").toEqual([]);
});

const open: (page: Page, query?: string) => Promise<void> = async (
  page: Page,
  query?: string,
): Promise<void> => {
  await page.clock.setFixedTime(NOW);
  await page.goto(`${HOME}${query ? `?${query}` : ""}`);
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
};

const acceptAnalytics: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  // "Accept all" on the cookie banner, as OneUptime Cloud's site stores it.
  await page.addInitScript(() => {
    window.localStorage.setItem("cookiesAccepted", "true");
  });
};

const recordingRequests: (page: Page) => Array<string> = (
  page: Page,
): Array<string> => {
  return (requests.get(page) || []).filter((url: string): boolean => {
    return (
      url.includes("/telemetry/session-replay") ||
      url.includes("DashboardRecorder") ||
      url.includes("oneuptime.com")
    );
  });
};

const pageState: (page: Page) => Promise<{
  initGlobal: unknown;
  queue: unknown;
  scripts: number;
  switchReads: Array<string>;
}> = async (
  page: Page,
): Promise<{
  initGlobal: unknown;
  queue: unknown;
  scripts: number;
  switchReads: Array<string>;
}> => {
  return await page.evaluate(() => {
    const record: Record<string, unknown> = window as unknown as Record<
      string,
      unknown
    >;
    const fixtureState: { recordingSwitchReads?: Array<string> } =
      (record["__homeOverviewFixture"] as {
        recordingSwitchReads?: Array<string>;
      }) || {};

    return {
      initGlobal: record["__ONEUPTIME_SESSION_REPLAY__"] ?? null,
      queue: record["OneUptimeReplayQueue"] ?? null,
      scripts: document.querySelectorAll(
        "script[data-oneuptime-dashboard-recording]",
      ).length,
      switchReads: fixtureState.recordingSwitchReads || [],
    };
  });
};

test("a self-hosted Dashboard loads nothing and sends nothing for recording, on any page", async ({
  page,
}: {
  page: Page;
}) => {
  // Even a person who accepted analytics: without the configuration, nothing.
  await acceptAnalytics(page);
  await open(page);

  // Move around: Home, Setup health, back to Home.
  await page.goto(SETUP_HEALTH);
  await page.goBack();
  await expect(page.getByTestId("synthetic-banner")).toBeVisible();
  await page.waitForLoadState("networkidle");

  expect(recordingRequests(page)).toEqual([]);
  expect(await pageState(page)).toEqual({
    initGlobal: null,
    queue: null,
    scripts: 0,
    switchReads: [],
  });
});

test("on Cloud, a person who did not accept analytics is never recorded: nothing is fetched", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, "recording=cloud");
  await page.waitForLoadState("networkidle");

  expect(recordingRequests(page)).toEqual([]);
  expect((await pageState(page)).switchReads).toEqual([]);
});

test("on Cloud, with consent and both switches on, Home loads the recorder from the configured host, in a file of its own", async ({
  page,
}: {
  page: Page;
}) => {
  await acceptAnalytics(page);
  await open(page, "recording=cloud");

  await expect
    .poll(
      async (): Promise<boolean> => {
        return await page.evaluate((): boolean => {
          return Boolean(
            (window as unknown as Record<string, unknown>)[
              "__fixtureRecorderLoaderFetched"
            ],
          );
        });
      },
      { timeout: 30000 },
    )
    .toBe(true);

  const fetched: Array<string> = recordingRequests(page);

  // The recorder's code came as a file of its own, then the docs' loader.
  expect(
    fetched.some((url: string): boolean => {
      return RECORDER_CHUNK.test(url);
    }),
  ).toBe(true);
  expect(fetched).toContain(
    `http://127.0.0.1:${PORT}/telemetry/session-replay/v1/recorder.js`,
  );

  const state: {
    initGlobal: unknown;
    queue: unknown;
    scripts: number;
    switchReads: Array<string>;
  } = await pageState(page);

  expect(state.scripts).toBe(1);
  expect(state.switchReads).toEqual(["User"]);
  expect(state.initGlobal).toMatchObject({
    host: `http://127.0.0.1:${PORT}`,
    maskAllText: true,
    respectDoNotTrack: true,
    offlineStorage: false,
  });
  expect((state.queue as Array<Array<unknown>>)[0]).toEqual(["grantConsent"]);

  // The product's own words are marked for the recording; a record's are not.
  await expect(page.locator(".oneuptime-unmask").first()).toBeAttached();
});
