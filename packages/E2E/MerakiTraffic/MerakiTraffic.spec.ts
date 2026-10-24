import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
  TestInfo,
} from "@playwright/test";
import fsSync from "fs";
import fs from "fs/promises";
import path from "path";

/*
 * The network's Traffic page with its Meraki side (issue #5140), in a real
 * browser: the real Network layout and Traffic page (NetworkTrafficView,
 * the Meraki view, Connect Meraki and the connections card) against the
 * offline fixture (Fixture/Fixture.js). Only the data boundary and the
 * signed-in user are synthetic.
 *
 * A Meraki estate's way in: connect the Meraki dashboard from the page that
 * has no traffic yet, see the first read fill it in by itself, read the
 * organization's uplinks, applications and clients, narrow to one network,
 * switch between flow records and Meraki - and see a refused key, a revoked
 * key and a large organization read in part say so. At a laptop's and a
 * phone's width, in the dark theme and in German.
 *
 * Every test puts up a network fence that aborts anything leaving the
 * fixture server, and fails on an uncaught page error, on a request the
 * fixture does not model and on any request the fence had to abort.
 */

// The fixture server's port, as the config and server.js read it.
const PORT: string = process.env["MERAKI_TRAFFIC_FIXTURE_PORT"] || "4514";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const TRAFFIC: string = `/dashboard/${PROJECT_ID}/network-devices/traffic`;
const API_KEY: string = "6bec40cf957de430a6f1f2baa056b99a4fac9ea0";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/meraki-traffic-ui",
);

const GERMAN: Record<string, string> = JSON.parse(
  fsSync.readFileSync(
    path.resolve(
      __dirname,
      "../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
);

interface FixtureState {
  usageRequests: Array<{ filters?: Record<string, unknown> }>;
  flowRequests: Array<Record<string, unknown>>;
  tests: Array<{
    config: Record<string, unknown>;
    secrets: Record<string, unknown>;
  }>;
  readNows: Array<string>;
  creates: Array<{
    name: string;
    provider: string;
    config: Record<string, unknown>;
    secrets: string;
  }>;
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
  expect(
    (await fixture(page)).unhandled,
    "requests the fixture does not model",
  ).toEqual([]);
});

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`${TRAFFIC}?${query}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __merakiTrafficFixture: unknown })
          .__merakiTrafficFixture,
      ),
    ) as FixtureState;
  });
}

async function finishRead(page: Page): Promise<void> {
  await page.evaluate((): void => {
    (
      window as unknown as {
        __merakiTrafficFixture: { finishRead: () => void };
      }
    ).__merakiTrafficFixture.finishRead();
  });
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

// The dialog once its opening transition has finished, for a screenshot.
async function settledDialog(page: Page): Promise<void> {
  for (const part of [dialog(page), page.getByTestId("modal-backdrop")]) {
    await expect
      .poll((): Promise<string> => {
        return part.evaluate((element: Element): string => {
          return getComputedStyle(element).opacity;
        });
      })
      .toBe("1");
  }
}

async function screenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
  target?: Locator,
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  const file: string = path.join(
    SCREENSHOTS,
    `${testInfo.project.name}-${name}.png`,
  );

  if (target) {
    await target.screenshot({ path: file });
    return;
  }

  await page.screenshot({ path: file, fullPage: true });
}

// Whether the page scrolls sideways: it must not, at any width.
async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate((): boolean => {
    return (
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1
    );
  });
}

function rowsOf(page: Page, list: string): Locator {
  return page.getByTestId(list).getByTestId(`${list}-row`);
}

/*
 * The top of the chart's rate axis, in bits per second: what the chart
 * draws, not what the tiles say - a series the chart could not place draws
 * flat at zero under a 4 Mbps axis.
 */
async function chartAxisTop(page: Page): Promise<number> {
  const ticks: Array<string> = await page
    .getByTestId("traffic-over-time-chart")
    .locator("text")
    .allTextContents();
  const units: Record<string, number> = {
    bps: 1,
    Kbps: 1e3,
    Mbps: 1e6,
    Gbps: 1e9,
  };
  let top: number = 0;

  for (const tick of ticks) {
    const match: RegExpMatchArray | null = tick
      .replace(/,/g, "")
      .match(/^([\d.]+)\s*(bps|Kbps|Mbps|Gbps)$/);

    if (match) {
      top = Math.max(top, Number(match[1]) * (units[match[2]!] || 0));
    }
  }

  return top;
}

async function connectWithKey(page: Page): Promise<void> {
  await page.getByTestId("traffic-setup-connect-meraki").click();
  await expect(page.getByTestId("meraki-connect")).toBeVisible();
  await page.getByTestId("meraki-api-key").fill(API_KEY);
  await page.getByTestId("modal-footer-next-button").click();
}

/*
 * ---------------------------------------------------------------------------
 * Connecting
 * ---------------------------------------------------------------------------
 */

test("nothing sends traffic yet: connect Meraki from the page, and the first read fills it in", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=none");

  const offer: Locator = page.getByTestId("traffic-setup-meraki");
  await expect(offer).toContainText("Using Cisco Meraki?");
  await expect(page.getByTestId("traffic-source-switch")).toHaveCount(0);
  await screenshot(page, testInfo, "guide");

  await page.getByTestId("traffic-setup-connect-meraki").click();
  await settledDialog(page);
  await expect(page.getByTestId("meraki-api-key")).toHaveAttribute(
    "type",
    "password",
  );
  await screenshot(page, testInfo, "connect-key", dialog(page));

  await page.getByTestId("meraki-api-key").fill(API_KEY);
  await page.getByTestId("modal-footer-next-button").click();

  const result: Locator = page.getByTestId("meraki-test-result");
  await expect(result).toHaveAttribute("data-status", "pass");
  await expect(result).toContainText("Ready to read Acme Networks.");
  await expect(page.getByTestId("meraki-test-counts")).toContainText("4");
  await screenshot(page, testInfo, "connect-organization", dialog(page));

  await page.getByTestId("modal-footer-submit-button").click();
  await expect(page.getByTestId("meraki-connect")).toHaveCount(0);

  const state: FixtureState = await fixture(page);
  expect(state.tests[0]).toEqual({
    provider: "meraki",
    config: { region: "global" },
    secrets: { apiKey: API_KEY },
  });
  expect(state.creates).toHaveLength(1);
  expect(state.creates[0]!.provider).toBe("meraki");
  expect(state.creates[0]!.config).toMatchObject({
    region: "global",
    organizationId: "549236",
    organizationName: "Acme Networks",
    readIntervalInMinutes: 5,
  });
  expect(JSON.parse(state.creates[0]!.secrets)).toEqual({ apiKey: API_KEY });

  // The page waits for the first read - never "no traffic".
  await expect(page.getByTestId("meraki-waiting")).toContainText(
    "Waiting for the first read from Meraki.",
  );
  await expect(
    page
      .getByTestId("meraki-connection")
      .getByTestId("meraki-connection-status"),
  ).toContainText("Waiting for the first read");
  await screenshot(page, testInfo, "waiting");

  // The worker reads it; the page notices by itself.
  await finishRead(page);
  await expect(page.getByTestId("traffic-tile-total-value")).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByTestId("meraki-connection-line")).toHaveAttribute(
    "data-status",
    "healthy",
  );
  await screenshot(page, testInfo, "first-read");

  expect(await page.locator("body").innerText()).not.toContain(API_KEY);
  expect(await scrollsSideways(page)).toBe(false);
});

test("a key that reads several organizations: the one picked is counted, then connected", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, "state=none&verdict=several");
  await connectWithKey(page);

  const organizations: Locator = page.getByTestId(
    "meraki-connect-organization",
  );
  await expect(organizations).toHaveCount(2);
  await expect(page.getByTestId("modal-footer-submit-button")).toBeDisabled();

  await organizations.nth(1).check();
  await expect(page.getByTestId("meraki-test-result")).toContainText(
    "Ready to read Acme Networks (Labs).",
  );
  await page.getByTestId("modal-footer-submit-button").click();
  await expect(page.getByTestId("meraki-connect")).toHaveCount(0);

  const state: FixtureState = await fixture(page);
  expect(state.tests[1]!.config).toEqual({
    region: "global",
    organizationId: "777001",
  });
  expect(state.creates[0]!.config).toMatchObject({
    organizationId: "777001",
    organizationName: "Acme Networks (Labs)",
  });
});

test("a key Meraki refuses: why, what to do, Meraki's own answer - and no Connect", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=none&verdict=auth");
  await connectWithKey(page);

  const result: Locator = page.getByTestId("meraki-test-result");
  await expect(result).toHaveAttribute("data-status", "fail");
  await expect(result).toContainText("Meraki did not accept this API key.");
  await expect(page.getByTestId("meraki-test-details")).toContainText(
    "The Meraki dashboard (dashboard.meraki.com) did not accept this API key.",
  );
  await expect(page.getByTestId("meraki-test-try-again")).toBeVisible();
  await expect(page.getByTestId("modal-footer-submit-button")).toBeDisabled();
  await settledDialog(page);
  await screenshot(page, testInfo, "connect-refused", dialog(page));

  expect((await fixture(page)).creates).toEqual([]);
});

/*
 * ---------------------------------------------------------------------------
 * Reading
 * ---------------------------------------------------------------------------
 */

test("an organization's traffic: the numbers, the chart, the lists and how the connection is doing", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=meraki");

  await expect(page.getByTestId("meraki-traffic-body")).toBeVisible();
  await expect(
    page
      .getByTestId("traffic-source-switch")
      .getByTestId("traffic-source-meraki"),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("traffic-tile-total-value")).not.toHaveText(
    "0 B",
  );
  await expect(page.getByTestId("traffic-over-time-chart")).toBeVisible();
  // The chart draws the uplinks' ~90 Mbps, not a line at zero.
  await expect
    .poll(async (): Promise<number> => {
      return chartAxisTop(page);
    })
    .toBeGreaterThanOrEqual(50e6);
  await expect(rowsOf(page, "meraki-top-networks")).toHaveCount(4);
  await expect(rowsOf(page, "meraki-top-networks").first()).toContainText(
    "Head Office",
  );
  await expect(rowsOf(page, "meraki-top-applications").first()).toContainText(
    "Microsoft 365",
  );
  await expect(rowsOf(page, "meraki-top-clients").first()).toContainText(
    "Front desk kiosk",
  );
  await expect(rowsOf(page, "meraki-top-destinations").first()).toContainText(
    "outlook.office365.com",
  );
  await expect(page.getByTestId("meraki-conversations-note")).toContainText(
    "reports totals, not conversations",
  );
  await expect(page.getByTestId("meraki-connection-line")).toContainText(
    "Acme Networks",
  );
  await expect(page.getByTestId("meraki-connection-covered")).toContainText(
    "4 networks · 4 appliances · 4 API calls a read",
  );

  expect(await scrollsSideways(page)).toBe(false);
  await screenshot(page, testInfo, "organization");
});

test("the dark theme", async ({ page }: { page: Page }, testInfo: TestInfo) => {
  await open(page, "state=meraki&theme=dark");

  await expect(page.getByTestId("meraki-traffic-body")).toBeVisible();
  expect(
    await page.evaluate((): boolean => {
      return document.documentElement.classList.contains("dark");
    }),
  ).toBe(true);
  expect(await scrollsSideways(page)).toBe(false);
  await screenshot(page, testInfo, "organization-dark");
});

test("a click on a network narrows the page to it; its chip widens it again", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=meraki");

  await rowsOf(page, "meraki-top-networks").nth(1).click();

  const chip: Locator = page.getByTestId("meraki-filter-network");
  await expect(chip).toContainText("Branch 012 · Leeds");
  await expect(page).toHaveURL(/mnet=L_646829496481105434/);
  // One network: its uplinks are listed, not a list of one network.
  await expect(rowsOf(page, "meraki-top-uplinks")).toHaveCount(2);
  await expect(rowsOf(page, "meraki-top-uplinks").first()).toContainText(
    "LDS MX68",
  );
  const state: FixtureState = await fixture(page);
  expect(state.usageRequests[state.usageRequests.length - 1]!.filters).toEqual({
    controllerNetworkId: "L_646829496481105434",
  });
  await screenshot(page, testInfo, "one-network");

  await chip.getByRole("button").click();
  await expect(chip).toHaveCount(0);
  await expect(rowsOf(page, "meraki-top-networks")).toHaveCount(4);
});

test("a page with flow records too opens on them, and the switch moves between the two", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, "state=both");

  const flows: Locator = page
    .getByTestId("traffic-source-switch")
    .getByTestId("traffic-source-flows");
  const meraki: Locator = page
    .getByTestId("traffic-source-switch")
    .getByTestId("traffic-source-meraki");

  await expect(flows).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("traffic-body")).toBeVisible();

  await meraki.click();
  await expect(page.getByTestId("meraki-traffic-body")).toBeVisible();
  await expect(page).toHaveURL(/source=meraki/);

  await flows.click();
  await expect(page.getByTestId("traffic-body")).toBeVisible();
  await expect(page).toHaveURL(/source=flows/);
});

/*
 * ---------------------------------------------------------------------------
 * When a read does not work
 * ---------------------------------------------------------------------------
 */

test("a revoked key: the line over the traffic and the connection's row say why, and Read now reads again", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=failing");

  const line: Locator = page.getByTestId("meraki-connection-line");
  await expect(line).toHaveAttribute("data-status", "failing");
  await expect(line.getByTestId("meraki-connection-line-detail")).toContainText(
    "HTTP 401: Invalid API key",
  );

  const row: Locator = page.getByTestId("meraki-connection");
  await expect(row).toHaveAttribute("data-status", "failing");
  await expect(row.getByTestId("meraki-connection-error")).toContainText(
    "Invalid API key",
  );
  await screenshot(page, testInfo, "failing");

  await row.getByTestId("meraki-connection-read-now").click();
  await expect(row.getByTestId("meraki-connection-status")).toContainText(
    "Reading now…",
  );
  expect((await fixture(page)).readNows).toEqual([
    `/api/network-controller-connection/30000000-0000-4000-8000-000000000001/read-now`,
  ]);

  await finishRead(page);
  await expect(row).toHaveAttribute("data-status", "healthy", {
    timeout: 20000,
  });
});

test("a large organization read in part: what is still to come, and why", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=partial");

  const row: Locator = page.getByTestId("meraki-connection");
  await expect(row).toHaveAttribute("data-status", "partial");
  await expect(row.getByTestId("meraki-connection-covered")).toContainText(
    "1,240 networks · 1,180 appliances · 900 API calls a read",
  );
  const notes: Locator = row.getByTestId("meraki-connection-note");
  await expect(notes).toHaveCount(3);
  await expect(notes.nth(0)).toContainText(
    "Traffic analysis is off on 12 networks",
  );
  await expect(notes.nth(1)).toContainText(
    "The applications and clients of 810 networks wait for the next read",
  );
  await expect(notes.nth(2)).toContainText(
    "Meraki asked OneUptime to slow down",
  );
  await expect(page.getByTestId("meraki-connection-line")).toHaveAttribute(
    "data-status",
    "partial",
  );
  await screenshot(
    page,
    testInfo,
    "partial",
    page.getByTestId("meraki-connections"),
  );
});

/*
 * ---------------------------------------------------------------------------
 * In another language
 * ---------------------------------------------------------------------------
 */

test("in German", async ({ page }: { page: Page }, testInfo: TestInfo) => {
  await open(page, "state=meraki&lang=de");

  const note: string | undefined =
    GERMAN[
      "The Meraki dashboard API reports totals, not conversations: it never says who talked to whom. Turn on NetFlow on the MX appliances to see conversations as well."
    ];
  expect(note).toBeTruthy();
  await expect(page.getByTestId("meraki-conversations-note")).toContainText(
    note!,
  );
  await expect(
    page.getByText(
      "The Meraki dashboard API reports totals, not conversations",
    ),
  ).toHaveCount(0);
  // When it read is German too: vor 2 Minuten, not 2 minutes ago.
  await expect(page.getByTestId("meraki-connection-line")).toContainText(
    "vor 2 Minuten",
  );
  await expect(page.getByText(/minutes? ago/)).toHaveCount(0);
  expect(await scrollsSideways(page)).toBe(false);
  await screenshot(page, testInfo, "organization-de");
});
