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
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

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
 * And the organization's devices that are no network device here (#5392's
 * follow-ups): the row's count of them, Add devices and its dialog, the ask
 * it sends, the row following the worker job to its end, an ask that went
 * wrong, nothing left to add, a member and a connection turned off - in
 * German and in the dark theme too.
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
  deviceAdds: Array<{ path: string; data: Record<string, unknown> }>;
  probeAsks: number;
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

// The Add devices a connection waits for gets on, as its worker job would.
async function progressDeviceAdd(
  page: Page,
  added: number,
  total: number,
): Promise<void> {
  await page.evaluate(
    ([addedSoFar, toAdd]: [number, number]): void => {
      (
        window as unknown as {
          __merakiTrafficFixture: {
            progressDeviceAdd: (added: number, total: number) => void;
          };
        }
      ).__merakiTrafficFixture.progressDeviceAdd(addedSoFar, toAdd);
    },
    [added, total] as [number, number],
  );
}

async function finishDeviceAdd(page: Page): Promise<void> {
  await page.evaluate((): void => {
    (
      window as unknown as {
        __merakiTrafficFixture: { finishDeviceAdd: () => void };
      }
    ).__merakiTrafficFixture.finishDeviceAdd();
  });
}

// The lines a connection's row says about adding its devices.
function deviceAddLine(page: Page, state: string): Locator {
  return page.locator(
    `[data-testid="meraki-connection-device-add"][data-state="${state}"]`,
  );
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
  await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    "Meraki reports what each network reached",
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

  await expectNoSidewaysScroll(page, { tolerance: 1 });
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
  await expectNoSidewaysScroll(page, { tolerance: 1 });
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

/*
 * ---------------------------------------------------------------------------
 * The uplinks, side by side (issue #5377)
 * ---------------------------------------------------------------------------
 */

test("the page's uplinks side by side: what each carried, and how each line held up", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=meraki");

  const rows: Locator = page.getByTestId("meraki-uplink-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("wan1");
  await expect(rows.nth(0)).toContainText("91%");
  await expect(rows.nth(0).getByTestId("meraki-uplink-row-latency")).toHaveText(
    "22\u00a0ms",
  );
  await expect(rows.nth(1).getByTestId("meraki-uplink-row-loss")).toHaveText(
    "0.6%",
  );
  // A standby line that carried nothing, and is still measured.
  await expect(rows.nth(2)).toContainText("cellular");
  await expect(rows.nth(2).getByTestId("meraki-uplink-row-latency")).toHaveText(
    "71\u00a0ms",
  );
  await expect(page.getByTestId("meraki-uplink-chart")).toBeVisible();

  await expectNoSidewaysScroll(page, { tolerance: 1 });
  await screenshot(
    page,
    testInfo,
    "uplinks",
    page.getByTestId("meraki-uplink-comparison"),
  );

  await page.getByTestId("meraki-uplink-chart-latency").click();
  await expect(page.getByTestId("meraki-uplink-chart-latency")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByTestId("meraki-uplink-chart").locator("text"),
  ).toContainText([/ms/]);
  await screenshot(
    page,
    testInfo,
    "uplinks-latency",
    page.getByTestId("meraki-uplink-comparison"),
  );
});

test("a click on an uplink narrows the whole page to it, and the others stay to compare it with", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=meraki");

  const total: string =
    (await page.getByTestId("traffic-tile-total-value").textContent()) || "";
  const rows: Locator = page.getByTestId("meraki-uplink-row");

  await rows.nth(1).click();

  await expect(page).toHaveURL(/mup=wan2/);
  await expect(page.getByTestId("meraki-filter-uplink")).toContainText(
    "Uplink wan2",
  );
  await expect(page.getByTestId("traffic-tile-total-value")).not.toHaveText(
    total,
  );
  // Not a false 0: Meraki counts flows per network.
  await expect(page.getByTestId("traffic-tile-flows-value")).toHaveText(
    "\u2014",
  );
  await expect(page.getByTestId("meraki-narrowed-note")).toBeVisible();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(rows.nth(0)).toHaveAttribute("aria-pressed", "false");

  const state: FixtureState = await fixture(page);
  expect(state.usageRequests[state.usageRequests.length - 1]!.filters).toEqual({
    interfaceName: "wan2",
  });
  await screenshot(page, testInfo, "one-uplink");

  // A link opens on the same uplink.
  await page.reload();
  await expect(page.getByTestId("meraki-filter-uplink")).toBeVisible({
    timeout: 60000,
  });

  await rows.nth(1).click();
  await expect(page.getByTestId("meraki-filter-uplink")).toHaveCount(0);
  await expect(page.getByTestId("traffic-tile-total-value")).toHaveText(total);
});

test("the bug this fixes: wan1 of a branch's appliance, without its wan2", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=meraki");

  await rowsOf(page, "meraki-top-networks").nth(1).click();

  // Its two WANs: the standby line carried nothing, so only the card lists it.
  const uplinks: Locator = rowsOf(page, "meraki-top-uplinks");
  await expect(uplinks).toHaveCount(2);
  await uplinks.first().click();

  await expect(page.getByTestId("meraki-filter-appliance")).toContainText(
    "LDS MX68",
  );
  await expect(page.getByTestId("meraki-filter-uplink")).toContainText("wan1");
  await expect(uplinks).toHaveCount(1);
  await expect(uplinks.first()).toHaveAttribute("aria-pressed", "true");

  const state: FixtureState = await fixture(page);
  expect(state.usageRequests[state.usageRequests.length - 1]!.filters).toEqual({
    controllerNetworkId: "L_646829496481105434",
    deviceSerial: "Q2PN-LDS0-0012",
    interfaceName: "wan1",
  });
  await screenshot(page, testInfo, "one-uplink-of-one-appliance");

  // A click on the row it is narrowed to widens it, back to the branch.
  await uplinks.first().click();
  await expect(page.getByTestId("meraki-filter-uplink")).toHaveCount(0);
  await expect(page.getByTestId("meraki-filter-appliance")).toHaveCount(0);
  await expect(page.getByTestId("meraki-filter-network")).toBeVisible();
  await expect(uplinks).toHaveCount(2);
});

test("the bug this fixes: the line stops where the reads did, and the average agrees with it", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, "state=meraki");

  await expect(page.getByTestId("meraki-read-up-to")).toContainText(
    "Read up to 5 minutes ago.",
  );

  const chart: Locator = page.getByTestId("traffic-over-time-chart");
  await expect(chart.locator("path.recharts-curve").first()).toBeVisible();

  // The drawn line ends well before the axis does.
  const gap: number = await chart.evaluate((element: Element): number => {
    const surface: DOMRect = element
      .querySelector("svg.recharts-surface")!
      .getBoundingClientRect();
    const right: number = Math.max(
      ...Array.from(element.querySelectorAll("path.recharts-curve")).map(
        (line: Element): number => {
          return line.getBoundingClientRect().right;
        },
      ),
    );

    return surface.right - right;
  });

  expect(gap).toBeGreaterThan(20);
});

test("who talks to whom: what each network reached, how, and how much - and what Meraki cannot say", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=meraki");

  const rows: Locator = rowsOf(page, "meraki-conversations");
  await expect(rows).toHaveCount(10);
  await expect(rows.first().getByTestId("meraki-conversation-from")).toHaveText(
    "Head Office",
  );
  await expect(rows.first().getByTestId("meraki-conversation-to")).toHaveText(
    "outlook.office365.com",
  );
  await expect(rows.first()).toContainText(
    "TCP port 443 · Microsoft 365 · Up to 180 clients",
  );
  await expect(rows.first()).toContainText(" flows");
  await expect(page.getByTestId("meraki-set-up-netflow")).toBeVisible();

  // The card is as tall as its rows: outside a grid, not as tall as the page.
  const card: Locator = page
    .getByTestId("meraki-conversations")
    .locator("xpath=ancestor::*[@data-testid='card'][1]");
  const height: number = await card.evaluate((element: Element): number => {
    return element.getBoundingClientRect().height;
  });
  const rowsHeight: number = await page
    .getByTestId("meraki-conversations")
    .evaluate((element: Element): number => {
      return element.scrollHeight;
    });

  expect(height).toBeLessThan(rowsHeight + 200);
  await expectNoSidewaysScroll(page, { tolerance: 1 });
  await screenshot(page, testInfo, "who-talks-to-whom", card);
});

test("the applications and destinations say their protocol and port", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, "state=meraki");

  await expect(rowsOf(page, "meraki-top-applications").nth(1)).toContainText(
    "UDP port 3478",
  );
  await expect(rowsOf(page, "meraki-top-destinations").nth(1)).toContainText(
    "Microsoft Teams · UDP port 3478",
  );
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
 * Adding the organization's devices
 * ---------------------------------------------------------------------------
 *
 * The devices Meraki knows that are no network device here: the row says
 * how many, Add devices asks which kinds (the network gear ticked, cameras
 * not; the sites and the probe folded under More fields, set to what most
 * people want), and the row follows the ask to its end by itself.
 */

const CONNECTION_PATH: string =
  "/api/network-controller-connection/30000000-0000-4000-8000-000000000001";

test("the devices Meraki knows that are not here: offered on the row, added in one go, and the row follows it to the end", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=meraki&unadded=many");

  // 8 switches and 12 access points: the 3 cameras are not offered.
  const offer: Locator = deviceAddLine(page, "not-added");
  await expect(offer).toContainText(
    "20 Meraki devices are not network devices here yet.",
  );
  await expect(offer).toHaveAttribute("data-tone", "info");
  await screenshot(
    page,
    testInfo,
    "add-devices-offer",
    page.getByTestId("meraki-connections"),
  );

  await offer.getByTestId("meraki-connection-add-devices").click();
  await settledDialog(page);
  await expect(dialog(page)).toContainText("Add Meraki devices");
  await expect(dialog(page)).toContainText(
    "Adds the devices of Acme Networks that are not here yet, at their management addresses. Meraki fills in their model, serial number and firmware.",
  );

  // The kinds with a device to add, each with how many; cameras not ticked.
  const kinds: Locator = page.getByTestId("meraki-add-devices-kind");
  await expect(kinds).toHaveCount(3);
  expect(
    await kinds.evaluateAll((elements: Array<Element>): Array<string> => {
      return elements.map((element: Element): string => {
        return element.getAttribute("data-kind") || "";
      });
    }),
  ).toEqual(["switch", "wireless", "camera"]);
  await expect(kinds.nth(0)).toContainText("SwitchesMS");
  await expect(page.getByTestId("meraki-add-devices-kind-count")).toHaveText([
    "8",
    "12",
    "3",
  ]);
  await expect(
    page.getByTestId("meraki-add-devices-kind-switch"),
  ).toBeChecked();
  await expect(
    page.getByTestId("meraki-add-devices-kind-wireless"),
  ).toBeChecked();
  await expect(
    page.getByTestId("meraki-add-devices-kind-camera"),
  ).not.toBeChecked();

  // What is not added, and why - the appliances Meraki lists no address for.
  const notAdded: Locator = page.getByTestId(
    "meraki-add-devices-not-added-line",
  );
  await expect(notAdded).toHaveCount(3);
  await expect(notAdded.nth(0)).toHaveAttribute(
    "data-reason",
    "without-address",
  );
  await expect(notAdded.nth(0)).toHaveText(
    "4 have no address in Meraki (a security appliance lists none). Add one by hand at the address your probe reaches it at, and Meraki fills in the rest.",
  );
  await expect(notAdded.nth(1)).toHaveText(
    "1 has an address, MAC address or serial number another network device here already has.",
  );
  await expect(notAdded.nth(2)).toHaveText(
    "1 is archived here, so it is not added again.",
  );

  // The sites and the probe, folded, with what they are set to.
  const fold: Locator = page.getByTestId("meraki-add-devices-more");
  await expect(fold).toContainText("Named after their networks");
  await expect(fold).toContainText("Leeds office probe");
  const submit: Locator = page.getByTestId("modal-footer-submit-button");
  await expect(submit).toHaveText("Add 20 devices");
  await expect(submit).toBeEnabled();
  await screenshot(page, testInfo, "add-devices-dialog", dialog(page));

  // The cameras too, then not.
  await page.getByTestId("meraki-add-devices-kind-camera").check();
  await expect(submit).toHaveText("Add 23 devices");
  await page.getByTestId("meraki-add-devices-kind-camera").uncheck();
  await expect(submit).toHaveText("Add 20 devices");

  await submit.click();
  await expect(page.getByTestId("meraki-add-devices")).toHaveCount(0);

  const state: FixtureState = await fixture(page);
  expect(state.deviceAdds).toEqual([
    {
      path: `${CONNECTION_PATH}/add-devices`,
      data: {
        productTypes: ["switch", "wireless"],
        groupBySite: true,
        probeId: "60000000-0000-4000-8000-000000000001",
      },
    },
  ]);
  expect(state.probeAsks).toBeGreaterThan(0);

  // The row says so at once, and follows the worker job by itself.
  const adding: Locator = deviceAddLine(page, "adding");
  await expect(adding).toHaveText("Adding devices from Meraki…");
  await expect(adding).toHaveAttribute("role", "status");
  await expect(offer).toHaveCount(0);
  await expect(page.getByTestId("meraki-connection-add-devices")).toHaveCount(
    0,
  );

  await progressDeviceAdd(page, 7, 20);
  await expect(adding).toHaveText(
    "Adding devices from Meraki: 7 of 20 so far.",
  );
  await screenshot(
    page,
    testInfo,
    "add-devices-progress",
    page.getByTestId("meraki-connections"),
  );

  const usageBefore: number = (await fixture(page)).usageRequests.length;
  await finishDeviceAdd(page);
  await expect(deviceAddLine(page, "added")).toHaveText(
    /^Added 20 network devices from Meraki \d+ seconds? ago\.$/,
  );
  await expect(deviceAddLine(page, "added")).toHaveAttribute(
    "data-tone",
    "done",
  );
  await expect(deviceAddLine(page, "sites-added")).toHaveText(
    "Added 2 sites for their Meraki networks.",
  );
  await expect(adding).toHaveCount(0);
  // What the last read counted is from before: not offered again.
  await expect(deviceAddLine(page, "not-added")).toHaveCount(0);
  // The devices are on the page by then: it reads its traffic again.
  await expect
    .poll(async (): Promise<number> => {
      return (await fixture(page)).usageRequests.length;
    })
    .toBeGreaterThan(usageBefore);
  await expectNoSidewaysScroll(page, { tolerance: 1 });
  await screenshot(
    page,
    testInfo,
    "add-devices-added",
    page.getByTestId("meraki-connections"),
  );
});

test("an Add devices that went wrong says so on the row: devices it could not add, a failed one, and one that stopped", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  // 18 of 20 added a minute ago; two could not be, each saying why.
  await open(page, "state=meraki&unadded=many&adding=done");

  await expect(deviceAddLine(page, "added")).toHaveText(
    "Added 18 network devices from Meraki 1 minute ago.",
  );
  await expect(deviceAddLine(page, "sites-added")).toHaveText(
    "Added 2 sites for their Meraki networks.",
  );
  const failed: Locator = deviceAddLine(page, "failed-devices");
  await expect(failed).toHaveAttribute("data-tone", "act");
  await expect(failed).toContainText("2 devices could not be added:");
  await expect(
    failed.getByTestId("meraki-connection-device-add-failures").locator("li"),
  ).toHaveText([
    "LDS-MS120-02: Another network device has this name.",
    "BRS-MR36-05: Your plan allows 250 network devices.",
  ]);
  // The read's count is from before the devices were added: not offered.
  await expect(deviceAddLine(page, "not-added")).toHaveCount(0);
  await expectNoSidewaysScroll(page, { tolerance: 1 });
  await screenshot(
    page,
    testInfo,
    "add-devices-failures",
    page.getByTestId("meraki-connections"),
  );

  // Meraki refused the key: the reason, in red.
  await open(page, "state=meraki&adding=failed");
  const refused: Locator = deviceAddLine(page, "add-failed");
  await expect(refused).toHaveText(
    "Devices could not be added from Meraki: Meraki answered the organization's devices with HTTP 401: Invalid API key",
  );
  await expect(refused).toHaveAttribute("data-tone", "error");

  // Its worker went quiet: the row says so, and offers Add devices again.
  await open(page, "state=meraki&unadded=many&adding=stopped");
  const stopped: Locator = deviceAddLine(page, "add-stopped");
  await expect(stopped).toContainText(
    "Adding devices from Meraki stopped before it finished. Add devices again to carry on.",
  );
  await expect(
    stopped.getByTestId("meraki-connection-add-devices"),
  ).toBeVisible();
  // What it added before its worker went quiet is said above it.
  await expect(deviceAddLine(page, "added")).toHaveText(
    /^Added 9 network devices from Meraki \d+ minutes ago\.$/,
  );
  await expect(deviceAddLine(page, "not-added")).toHaveCount(0);
  await expect(deviceAddLine(page, "adding")).toHaveCount(0);
});

test("Add devices from the row's menu: nothing left to add, and a read from before reads counted devices", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  // Only the appliances are not here, and Meraki lists no address for them.
  await open(page, "state=meraki&unadded=none");
  await expect(page.getByTestId("meraki-connection-device-add")).toHaveCount(0);
  await page.getByTestId("meraki-connection-more").click();
  await page.getByRole("menuitem", { name: "Add devices" }).click();
  await settledDialog(page);
  await expect(page.getByTestId("meraki-add-devices-nothing")).toHaveText(
    "Every Meraki device that can be added is a network device here already.",
  );
  await expect(
    page.getByTestId("meraki-add-devices-not-added-line"),
  ).toHaveText([
    "4 have no address in Meraki (a security appliance lists none). Add one by hand at the address your probe reaches it at, and Meraki fills in the rest.",
  ]);
  await expect(page.getByTestId("meraki-add-devices-more")).toHaveCount(0);
  await expect(page.getByTestId("modal-footer-submit-button")).toBeDisabled();
  await screenshot(page, testInfo, "add-devices-nothing", dialog(page));

  /*
   * A read from before reads counted the devices: every kind, the network
   * gear ticked - and with two probes of its own, the project's devices get
   * none unless one is picked.
   */
  await open(page, "state=meraki&probes=two");
  await expect(page.getByTestId("meraki-connection-device-add")).toHaveCount(0);
  await page.getByTestId("meraki-connection-more").click();
  await page.getByRole("menuitem", { name: "Add devices" }).click();
  await settledDialog(page);
  await expect(page.getByTestId("meraki-add-devices-kind")).toHaveCount(7);
  await expect(page.getByTestId("meraki-add-devices-kind-count")).toHaveCount(
    0,
  );
  await expect(
    page.getByTestId("meraki-add-devices-kind-camera"),
  ).not.toBeChecked();
  await expect(
    page.getByTestId("meraki-add-devices-kind-switch"),
  ).toBeChecked();
  await expect(page.getByTestId("meraki-add-devices-uncounted")).toHaveText(
    "The connection counts its devices at its next read, within a few minutes. Adding them now adds every device of the kinds picked that is not here yet.",
  );
  await expect(page.getByTestId("meraki-add-devices-more")).toContainText(
    "No probe",
  );
  const submit: Locator = page.getByTestId("modal-footer-submit-button");
  await expect(submit).toHaveText("Add devices");

  // Unticked, the site rules place each device; and no probe is sent.
  const fold: Locator = page.getByTestId("meraki-add-devices-more");
  await fold.getByTestId("folded-section-header").click();
  await expect(fold).toHaveAttribute("data-collapsed", "false");
  await page.getByTestId("meraki-add-devices-sites").uncheck();
  await screenshot(page, testInfo, "add-devices-uncounted", dialog(page));
  // Folded again, its line says what the sites are set to now.
  await fold.getByTestId("folded-section-header").click();
  await expect(fold).toHaveAttribute("data-collapsed", "true");
  await expect(fold.getByTestId("folded-section-item").first()).toContainText(
    "Off",
  );
  await submit.click();
  await expect(page.getByTestId("meraki-add-devices")).toHaveCount(0);
  expect((await fixture(page)).deviceAdds).toEqual([
    {
      path: `${CONNECTION_PATH}/add-devices`,
      data: {
        productTypes: [
          "switch",
          "wireless",
          "appliance",
          "cellularGateway",
          "wirelessController",
          "campusGateway",
        ],
        groupBySite: false,
      },
    },
  ]);
  await expect(deviceAddLine(page, "adding")).toHaveText(
    "Adding devices from Meraki…",
  );
});

test("a member is told how many devices are not here, without the button; a connection that is off offers nothing", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, "state=meraki&unadded=many&role=member");
  await expect(deviceAddLine(page, "not-added")).toHaveText(
    "20 Meraki devices are not network devices here yet.",
  );
  await expect(page.getByTestId("meraki-connection-add-devices")).toHaveCount(
    0,
  );

  // Turned off, it adds nothing: nothing is offered, on the row or its menu.
  await open(page, "state=off&unadded=many");
  await expect(page.getByTestId("meraki-connection")).toHaveAttribute(
    "data-status",
    "off",
  );
  await expect(page.getByTestId("meraki-connection-device-add")).toHaveCount(0);
  await page.getByTestId("meraki-connection-more").click();
  await expect(page.getByRole("menuitem", { name: "Turn on" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Add devices" })).toHaveCount(
    0,
  );
});

test("adding devices, in German", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=meraki&unadded=many&lang=de");

  const offer: Locator = deviceAddLine(page, "not-added");
  await expect(offer).toContainText(
    "20 Meraki-Geräte sind hier noch keine Netzwerkgeräte.",
  );
  await expect(offer.getByTestId("meraki-connection-add-devices")).toHaveText(
    GERMAN["Add devices"]!,
  );

  await offer.getByTestId("meraki-connection-add-devices").click();
  await settledDialog(page);
  await expect(dialog(page)).toContainText(GERMAN["Add Meraki devices"]!);
  await expect(dialog(page)).toContainText(GERMAN["Devices to add"]!);
  await expect(page.getByTestId("modal-footer-submit-button")).toHaveText(
    "20 Geräte hinzufügen",
  );
  await expect(dialog(page)).not.toContainText("Add Meraki devices");
  await expectNoSidewaysScroll(page, { tolerance: 1 });
  await screenshot(page, testInfo, "add-devices-dialog-de", dialog(page));
});

test("adding devices, in the dark theme", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=meraki&unadded=many&adding=done&theme=dark");

  await expect(deviceAddLine(page, "failed-devices")).toBeVisible();
  await screenshot(
    page,
    testInfo,
    "add-devices-failures-dark",
    page.getByTestId("meraki-connections"),
  );

  await open(page, "state=meraki&unadded=many&theme=dark");
  await deviceAddLine(page, "not-added")
    .getByTestId("meraki-connection-add-devices")
    .click();
  await settledDialog(page);
  await screenshot(page, testInfo, "add-devices-dialog-dark", dialog(page));
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
      "Meraki reports what each network reached, never which client talked to it. Turn on NetFlow on the MX appliances to see every conversation, address to address, with its packets."
    ];
  expect(note).toBeTruthy();
  await expect(page.getByTestId("meraki-conversations-note")).toContainText(
    note!,
  );
  await expect(
    page.getByText("Meraki reports what each network reached"),
  ).toHaveCount(0);
  // The uplinks' card reads in German too: its heading and its rows' words.
  const uplinks: string | undefined = GERMAN["WAN uplinks"];
  expect(uplinks).toBeTruthy();
  expect(uplinks).not.toBe("WAN uplinks");
  await expect(page.getByText(uplinks!, { exact: true })).toBeVisible();
  // When it read is German too: vor 2 Minuten, not 2 minutes ago.
  await expect(page.getByTestId("meraki-connection-line")).toContainText(
    "vor 2 Minuten",
  );
  await expect(page.getByText(/minutes? ago/)).toHaveCount(0);
  await expectNoSidewaysScroll(page, { tolerance: 1 });
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
    "Meraki reports what each network reached, never which client talked to it. This page's flow records have every conversation, address to address, with its packets.",
  );
  await expect(page.getByTestId("meraki-set-up-netflow")).toHaveCount(0);

  await page.getByTestId("meraki-show-conversations").click();
  await expect(page.getByTestId("traffic-top-conversations")).toBeVisible();
  await expect(page).toHaveURL(/source=flows/);
});

test("a device's page: its MX's uplinks, applications and clients - nothing said twice, and one uplink a click away", async ({
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
  await uplinks.nth(1).click();
  await expect(page.getByTestId("meraki-filter-uplink")).toContainText("wan2");
  await expect(uplinks).toHaveCount(1);
  // The page is the appliance's: the name alone narrows it.
  const narrowed: FixtureState["usageRequests"] = (await fixture(page))
    .usageRequests;
  expect(narrowed[narrowed.length - 1]!.filters).toEqual({
    interfaceName: "wan2",
  });
  await page.getByTestId("meraki-filter-uplink").getByRole("button").click();
  await expect(uplinks).toHaveCount(2);
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
  await expectNoSidewaysScroll(page, { tolerance: 1 });
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

/*
 * A device's page has no connections of its own: Review on its line opens
 * the network's Traffic page on its Meraki side, at the connections - the
 * card is brought into view under the page's header, whatever the traffic
 * above it draws.
 */
test("Review on a device's page opens the network's Meraki side at the connections, in view", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "state=failing", DEVICE_TRAFFIC);

  const line: Locator = page.getByTestId("meraki-connection-line");
  await expect(line).toHaveAttribute("data-status", "failing");
  const review: Locator = line.getByRole("link", { name: "Review" });
  await expect(review).toHaveAttribute(
    "href",
    `${TRAFFIC}?source=meraki#traffic-meraki-connections`,
  );

  await review.click();
  await expect(page).toHaveURL(
    /\/dashboard\/10000000-0000-4000-8000-000000000001\/network-devices\/traffic\?source=meraki#traffic-meraki-connections$/,
  );
  const connections: Locator = page.getByTestId("meraki-connections");
  await expect(connections).toBeVisible();
  await expect(connections).toBeInViewport();
  // Landed on: the card takes the focus, so the keyboard starts there.
  await expect(page.locator("#traffic-meraki-connections")).toBeFocused();
  await expect(page.getByTestId("meraki-connection")).toHaveAttribute(
    "data-status",
    "failing",
  );
  await screenshot(page, testInfo, "device-review-lands");
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
  await expectNoSidewaysScroll(page, { tolerance: 1 });
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
