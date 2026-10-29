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
 * And the UI review's next steps: each connection's one button (Read now,
 * Turn on, Update API key - a new key tested before it is saved), Review
 * from a line over the traffic to the connection, an empty range after the
 * reads stopped, Meraki offered at the foot of a page that shows its flows,
 * a device's and a site's own pages, and a member, who sees no buttons and
 * is told why.
 *
 * Every test puts up a network fence that aborts anything leaving the
 * fixture server, and fails on an uncaught page error, on a request the
 * fixture does not model and on any request the fence had to abort.
 */

// The fixture server's port, as the config and server.js read it.
const PORT: string = process.env["MERAKI_TRAFFIC_FIXTURE_PORT"] || "4514";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const TRAFFIC: string = `/dashboard/${PROJECT_ID}/network-devices/traffic`;
// The Head Office MX's own Traffic page, and the Branches site's.
const DEVICE_TRAFFIC: string = `/dashboard/${PROJECT_ID}/network-devices/40000000-0000-4000-8000-000000000001/traffic`;
const SITE_TRAFFIC: string = `/dashboard/${PROJECT_ID}/network-sites/view/50000000-0000-4000-8000-000000000001/traffic`;
const API_KEY: string = "6bec40cf957de430a6f1f2baa056b99a4fac9ea0";
const NEW_KEY: string = "fedcba9876543210fedcba9876543210fedcba98";

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
    connectionId?: string;
    config: Record<string, unknown>;
    secrets: Record<string, unknown>;
  }>;
  readNows: Array<string>;
  updates: Array<{ id: string; data: Record<string, unknown> }>;
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

async function open(
  page: Page,
  query: string,
  address: string = TRAFFIC,
): Promise<void> {
  await page.goto(`${address}?${query}`);
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

test("a key Meraki refuses: the dashboard that refused it, what to do, Change API key - and no Connect", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=none&verdict=auth");
  await connectWithKey(page);

  const result: Locator = page.getByTestId("meraki-test-result");
  await expect(result).toHaveAttribute("data-status", "fail");
  // The dashboard that refused it, by name: Meraki's own answer would say no more.
  await expect(result).toContainText(
    "The Meraki dashboard at dashboard.meraki.com did not accept this API key.",
  );
  await expect(page.getByTestId("meraki-test-details")).toHaveCount(0);
  // The same key would fail again: the way on is another key.
  await expect(page.getByTestId("meraki-test-try-again")).toHaveCount(0);
  await expect(page.getByTestId("modal-footer-submit-button")).toBeDisabled();
  await settledDialog(page);
  await screenshot(page, testInfo, "connect-refused", dialog(page));

  // Change API key: back on the key, selected, to paste over.
  await page.getByTestId("meraki-test-change-key").click();
  const key: Locator = page.getByTestId("meraki-api-key");
  await expect(key).toBeFocused();
  expect(
    await key.evaluate((input: Element): number => {
      const field: HTMLInputElement = input as HTMLInputElement;
      return (field.selectionEnd || 0) - (field.selectionStart || 0);
    }),
  ).toBe(API_KEY.length);

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
  await expect(page.getByTestId("meraki-connection-covered")).toHaveText(
    "Every 5 minutes · 4 networks · 4 appliances · 4 API calls a read",
  );
  await expect(
    page.getByTestId("meraki-connection-status").getByTestId("pill"),
  ).toHaveText("Working");
  // A named client: its address, maker and network - its MAC is not needed.
  await expect(rowsOf(page, "meraki-top-clients").first()).toContainText(
    "10.10.20.15 · Dell · Head Office",
  );
  await expect(rowsOf(page, "meraki-top-clients").first()).not.toContainText(
    "00:1b:63:84:45:e6",
  );
  // A host name is text; addresses are in the monospace font.
  expect(
    await rowsOf(page, "meraki-top-destinations")
      .first()
      .getByText("outlook.office365.com")
      .evaluate((element: Element): string => {
        return getComputedStyle(element).fontFamily;
      }),
  ).not.toContain("monospace");
  // Lists side by side end level: no hole under the shorter one.
  const heights: Array<number> = await Promise.all(
    ["meraki-top-networks", "meraki-top-applications"].map(
      (list: string): Promise<number> => {
        return page
          .getByTestId(list)
          .locator("xpath=ancestor::*[@data-testid='card'][1]")
          .evaluate((card: Element): number => {
            return Math.round(card.getBoundingClientRect().height);
          });
      },
    ),
  );
  if (testInfo.project.name === "desktop") {
    expect(heights[0]).toBe(heights[1]);
  }

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
  // ... and no row says which network: every one would say the same.
  await expect(rowsOf(page, "meraki-top-uplinks").first()).not.toContainText(
    "Branch 012",
  );
  await expect(rowsOf(page, "meraki-top-clients").first()).not.toContainText(
    "Branch 012",
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

test("a revoked key: Review from the line to the row, Update API key with a key tested first, and the row recovers by itself", async ({
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
  // The reads stopped two hours ago: the past hour says so, not "30 days".
  await expect(page.getByTestId("meraki-no-data")).toContainText(
    "The newest traffic is from 2 hours ago.",
  );

  const row: Locator = page.getByTestId("meraki-connection");
  await expect(row).toHaveAttribute("data-status", "failing");
  await expect(row.getByTestId("meraki-connection-error")).toContainText(
    "Invalid API key",
  );
  await screenshot(page, testInfo, "failing");

  // Review: to the connection, where it is fixed.
  await line.getByTestId("meraki-connection-line-review").click();
  await expect(page).toHaveURL(/#traffic-meraki-connections$/);
  await expect(row).toBeInViewport();

  // Reading again would fail again: the row's one button is the key.
  await expect(row.getByTestId("meraki-connection-read-now")).toHaveCount(0);
  await row.getByTestId("meraki-connection-update-key").click();
  await expect(page.getByTestId("meraki-edit")).toBeVisible();
  await expect(page.getByTestId("meraki-edit-key")).toBeFocused();
  await settledDialog(page);
  await screenshot(page, testInfo, "update-key", dialog(page));

  await page.getByTestId("meraki-edit-key").fill(NEW_KEY);
  await page.getByTestId("modal-footer-submit-button").click();
  await expect(page.getByTestId("meraki-edit")).toHaveCount(0);

  const state: FixtureState = await fixture(page);
  // Tested against the connection's own organization before it was saved.
  expect(state.tests).toEqual([
    {
      connectionId: "30000000-0000-4000-8000-000000000001",
      secrets: { apiKey: NEW_KEY },
    },
  ]);
  expect(state.updates).toHaveLength(1);
  expect(JSON.parse(String(state.updates[0]!.data["secrets"]))).toEqual({
    apiKey: NEW_KEY,
  });

  // Saved, it is read within a minute: the row and the page show it by themselves.
  await finishRead(page);
  await expect(row).toHaveAttribute("data-status", "healthy", {
    timeout: 20000,
  });
  await expect(page.getByTestId("traffic-tile-total-value")).toBeVisible({
    timeout: 20000,
  });
  expect(await page.locator("body").innerText()).not.toContain(NEW_KEY);
});

test("a new key Meraki refuses is not saved: the dialog names the dashboard and keeps the key", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, "state=failing&verdict=auth");

  await page
    .getByTestId("meraki-connection")
    .getByTestId("meraki-connection-update-key")
    .click();
  await page.getByTestId("meraki-edit-key").fill(NEW_KEY);
  await page.getByTestId("modal-footer-submit-button").click();

  const result: Locator = page
    .getByTestId("meraki-edit")
    .getByTestId("meraki-test-result");
  await expect(result).toHaveAttribute("data-status", "fail");
  await expect(result).toContainText(
    "The Meraki dashboard at dashboard.meraki.com did not accept this API key.",
  );
  await expect(page.getByTestId("meraki-edit-key")).toHaveValue(NEW_KEY);
  expect((await fixture(page)).updates).toEqual([]);
});

test("Read now reads again, says so, and the row shows the read by itself", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, "state=meraki");

  const row: Locator = page.getByTestId("meraki-connection");
  await row.getByTestId("meraki-connection-read-now").click();
  await expect(row.getByTestId("meraki-connection-status")).toContainText(
    "Reading now…",
  );
  expect((await fixture(page)).readNows).toEqual([
    `/api/network-controller-connection/30000000-0000-4000-8000-000000000001/read-now`,
  ]);

  await finishRead(page);
  await expect(row.getByTestId("meraki-connection-status")).toHaveText(
    "Working",
    { timeout: 20000 },
  );
});

test("a connection that is off offers Turn on - never a Read now Meraki would refuse", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=off");

  const row: Locator = page.getByTestId("meraki-connection");
  await expect(row).toHaveAttribute("data-status", "off");
  await expect(row.getByTestId("meraki-connection-read-now")).toHaveCount(0);
  await screenshot(
    page,
    testInfo,
    "off",
    page.getByTestId("meraki-connections"),
  );

  await row.getByTestId("meraki-connection-turn-on").click();
  await expect
    .poll(async (): Promise<Array<Record<string, unknown>>> => {
      return (await fixture(page)).updates.map(
        (update: { data: Record<string, unknown> }) => {
          return update.data;
        },
      );
    })
    .toEqual([{ isEnabled: true }]);

  // Turned on, it is read within a minute: the row shows it by itself.
  await finishRead(page);
  await expect(row).toHaveAttribute("data-status", "healthy", {
    timeout: 20000,
  });
});

test("a connection that stopped reading: Review, and the newest traffic's time - never 'Meraki keeps 30 days'", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=stale");

  const line: Locator = page.getByTestId("meraki-connection-line");
  await expect(line).toHaveAttribute("data-status", "stale");
  await expect(line).toContainText(
    "Last read 3 hours ago: the traffic below stops there.",
  );
  await expect(line.getByTestId("meraki-connection-line-review")).toBeVisible();
  const empty: Locator = page.getByTestId("meraki-no-data");
  await expect(empty).toContainText(
    "The newest traffic is from 3 hours ago. Pick a longer time range to see it.",
  );
  await expect(empty).not.toContainText("30 days");
  await expect(
    page.getByTestId("meraki-connection-status").getByTestId("pill"),
  ).toHaveText("Not read lately");
  await screenshot(page, testInfo, "stale");
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
  // Amber for what to act on; grey for what OneUptime handles by itself.
  expect(
    await notes.evaluateAll((elements: Array<Element>): Array<string> => {
      return elements.map((element: Element): string => {
        return element.getAttribute("data-tone") || "";
      });
    }),
  ).toEqual(["act", "info", "info"]);
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
 * Each read also lists the organization's devices: the connection's row
 * counts them, and says how many network devices here it fills in the
 * model, serial number and firmware of. A read from before reads counted
 * them says nothing of devices (the first test of the page).
 */
test("the organization's devices: counted on the connection's row, and the network devices here it fills in", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=meraki&devices=counted");

  const row: Locator = page.getByTestId("meraki-connection");
  await expect(row.getByTestId("meraki-connection-covered")).toHaveText(
    "Every 5 minutes · 4 networks · 6 devices · 4 appliances · 4 API calls a read",
  );
  const notes: Locator = row.getByTestId("meraki-connection-note");
  await expect(notes).toHaveCount(1);
  await expect(notes).toHaveText(
    "Fills in the model, serial number and firmware of 5 network devices.",
  );
  // Grey: OneUptime did it by itself, nothing to act on.
  await expect(notes).toHaveAttribute("data-tone", "info");
  await screenshot(
    page,
    testInfo,
    "devices",
    page.getByTestId("meraki-connections"),
  );

  // One of them, said as one.
  await open(page, "state=meraki&devices=one");
  await expect(
    page.getByTestId("meraki-connection").getByTestId("meraki-connection-note"),
  ).toHaveText(
    "Fills in the model, serial number and firmware of 1 network device.",
  );

  // In German.
  await open(page, "state=meraki&devices=counted&lang=de");
  await expect(
    page.getByTestId("meraki-connection").getByTestId("meraki-connection-note"),
  ).toHaveText(
    "Ergänzt Modell, Seriennummer und Firmware von 5 Netzwerkgeräten.",
  );
  // The card says what the connections read: traffic, and device details.
  await expect(
    page
      .getByTestId("meraki-connections")
      .locator("xpath=ancestor::div[@data-testid='card'][1]"),
  ).toContainText(
    "Die Meraki-Organisationen, deren Datenverkehr und Geräteangaben OneUptime über die Meraki-Dashboard-API liest.",
  );
  await screenshot(
    page,
    testInfo,
    "devices-de",
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

test("in German, the flow side's card says whose traffic it is in German too", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, "state=flows&lang=de");

  const description: string | undefined =
    GERMAN[
      "Where your network's traffic goes, from the flow records your devices export."
    ];
  expect(description).toBeTruthy();
  // The card's description (a phone draws the card without it, so: attached).
  await expect(page.getByText(description!)).toBeAttached();
  await expect(
    page.getByText("from the flow records your devices export"),
  ).toHaveCount(0);
});

/*
 * ---------------------------------------------------------------------------
 * Where else Meraki shows
 * ---------------------------------------------------------------------------
 */

test("a network with flow records and no connection offers Meraki in one line at its foot", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=flows");

  await expect(page.getByTestId("traffic-body")).toBeVisible();
  await expect(page.getByTestId("traffic-source-switch")).toHaveCount(0);
  const offer: Locator = page.getByTestId("meraki-offer");
  await expect(offer).toHaveText("Using Cisco Meraki? Connect Meraki");
  await screenshot(page, testInfo, "flows-offer", offer);

  await offer.getByTestId("meraki-offer-connect").click();
  await expect(page.getByTestId("meraki-connect")).toBeVisible();
});

test("a page with flow records too: Who talks to whom offers the page's own conversations", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, "state=both&source=meraki");

  const note: Locator = page.getByTestId("meraki-conversations-note");
  await expect(note).toContainText(
    "The Meraki dashboard API reports totals, not conversations. This page's flow records have them.",
  );
  await expect(page.getByTestId("meraki-set-up-netflow")).toHaveCount(0);

  await page.getByTestId("meraki-show-conversations").click();
  await expect(page.getByTestId("traffic-top-conversations")).toBeVisible();
  await expect(page).toHaveURL(/source=flows/);
});

test("a device's page: its MX's uplinks, applications and clients - nothing to narrow, nothing said twice", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=meraki", DEVICE_TRAFFIC);

  await expect(page.getByTestId("meraki-traffic-body")).toBeVisible();
  await expect(page.getByTestId("traffic-tile-total-value")).not.toHaveText(
    "0 B",
  );
  // One appliance: its uplinks, never a list of networks to narrow to.
  await expect(page.getByTestId("meraki-top-networks")).toHaveCount(0);
  const uplinks: Locator = rowsOf(page, "meraki-top-uplinks");
  await expect(uplinks).toHaveCount(2);
  await expect(uplinks.first()).toContainText("wan1");
  // The page is the appliance's: no row names it, or its network.
  await expect(uplinks.first()).not.toContainText("HQ MX250");
  await expect(uplinks.first()).not.toContainText("Head Office");
  await expect(uplinks.first().getByRole("button")).toHaveCount(0);
  await expect(page.getByTestId("meraki-connection-line")).toContainText(
    "Acme Networks",
  );
  // The connections are listed on the network's page only.
  await expect(page.getByTestId("meraki-connections")).toHaveCount(0);

  const requests: FixtureState["usageRequests"] = (await fixture(page))
    .usageRequests;
  expect(
    (requests[requests.length - 1] as Record<string, unknown>)[
      "networkDeviceId"
    ],
  ).toBe("40000000-0000-4000-8000-000000000001");
  expect(await scrollsSideways(page)).toBe(false);
  await screenshot(page, testInfo, "device");
});

/*
 * Issue #5341: incidents and alerts can be about a network device, so the
 * device's own menu lists them under Activity, after the pages of every
 * visit. A project with no open state counts nothing - not a request is
 * sent for a badge that could only say zero (the fence above fails on a
 * request the fixture does not model).
 */
test("a device's menu lists its incidents and alerts under Activity, each on the device's own page", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=meraki", DEVICE_TRAFFIC);

  // A phone folds the menu behind its Go to button: open it first.
  if (testInfo.project.name === "phone") {
    await page.getByTestId("mobile-sidemenu-toggle").click();
  }

  const device: string = `/dashboard/${PROJECT_ID}/network-devices/40000000-0000-4000-8000-000000000001`;
  // A side menu section is its h6 title and the links under it.
  const activity: Locator = page.locator("div.mb-2", {
    has: page.locator("h6", { hasText: /^Activity$/ }),
  });

  await expect(
    activity.getByRole("link", { name: "Incidents" }),
  ).toHaveAttribute("href", `${device}/incidents`);
  await expect(activity.getByRole("link", { name: "Alerts" })).toHaveAttribute(
    "href",
    `${device}/alerts`,
  );

  // After the device's pages, before what is folded under More.
  const sections: Array<string> = (
    await page.locator("h6").allTextContents()
  ).map((title: string): string => {
    return title.trim();
  });
  expect(sections.indexOf("Activity")).toBeGreaterThan(
    sections.indexOf("Device"),
  );
  expect(sections.indexOf("Activity")).toBeLessThan(sections.indexOf("More"));
  expect(sections.indexOf("Device")).toBeGreaterThan(-1);

  // No open state in this project: no badge, and no count asked for.
  await expect(activity.locator("span.tabular-nums")).toHaveCount(0);

  await screenshot(page, testInfo, "device-menu-activity", activity);
});

test("a site's page: its networks, one click from narrowing to one", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=meraki", SITE_TRAFFIC);

  const networks: Locator = rowsOf(page, "meraki-top-networks");
  await expect(networks).toHaveCount(2);
  await expect(networks.first()).toContainText("Branch 012 · Leeds");
  await expect(networks.nth(1)).toContainText("Branch 047 · Bristol");
  expect(await scrollsSideways(page)).toBe(false);
  await screenshot(page, testInfo, "site");

  await networks.nth(1).click();
  await expect(page.getByTestId("meraki-filter-network")).toContainText(
    "Branch 047 · Bristol",
  );
  await expect(rowsOf(page, "meraki-top-uplinks").first()).toContainText(
    "BRS MX68",
  );
});

test("a member sees the connections without buttons, and why - and the guide's offer without one", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=meraki&role=member");

  await expect(page.getByTestId("meraki-connection")).toBeVisible();
  await expect(page.getByTestId("meraki-connection-read-now")).toHaveCount(0);
  await expect(page.getByTestId("meraki-connection-more")).toHaveCount(0);
  await expect(page.getByTestId("meraki-connect-another")).toHaveCount(0);
  const locked: Locator = page.getByTestId("meraki-connections-locked");
  await expect(locked).toContainText(
    "You do not have permission to update this Meraki connection.",
  );
  await screenshot(
    page,
    testInfo,
    "member",
    page.getByTestId("meraki-connections"),
  );

  await open(page, "state=none&role=member");
  await expect(page.getByTestId("traffic-setup-meraki")).toBeVisible();
  await expect(page.getByTestId("traffic-setup-connect-meraki")).toHaveCount(0);
  await expect(page.getByTestId("traffic-setup-meraki-locked")).toContainText(
    "You do not have permission to create this Meraki connection.",
  );
});
