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
 * The first run of the infrastructure lists, in a real browser: the real
 * Host, VMware and Cloud layouts and list pages against the offline fixture
 * (Fixture/Fixture.js). Only the data boundary and the signed-in user are
 * synthetic.
 *
 * A new project opens a list and sees what the list is (the empty table),
 * what to do (the setup guide under it), and - where creating a row by hand
 * connects nothing - Create only in the card header. When the agent
 * reports, the page shows the first record and puts the guide away on its
 * own: no reload. On a desktop, on a phone, in the dark theme and in German.
 *
 * Every test puts up a network fence that aborts anything leaving the
 * fixture server, and fails on an uncaught page error, on a request the
 * fixture does not model and on any request the fence had to abort.
 */

// The fixture server's port, as the config and server.js read it.
const PORT: string =
  process.env["INFRASTRUCTURE_FIRST_RUN_FIXTURE_PORT"] || "4352";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const HOSTS: string = `/dashboard/${PROJECT_ID}/host`;
const VCENTERS: string = `/dashboard/${PROJECT_ID}/vmware`;
const CLOUD_RESOURCES: string = `/dashboard/${PROJECT_ID}/cloud/resources`;

// FIRST_RECORD_POLL_INTERVAL_MS: how often an empty list looks again.
const POLL_MS: number = 10_000;

const GUIDE_SENTENCE: string =
  "Follow the steps below. This list fills in on its own once data arrives.";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/infrastructure-first-run-ui",
);

type ArrivalKind = "host" | "vcenter" | "cloudResource";

interface FixtureState {
  scenario: Record<string, unknown>;
  countRequests: Array<{ modelName: string; query: unknown }>;
  listRequests: Array<{ modelName: string; query: unknown }>;
  apiRequests: Array<{ method: string; url: string }>;
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

  /*
   * The page's timers run on a clock the test moves on: a check every
   * POLL_MS is seen without waiting for it.
   */
  await page.clock.install();
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
        (window as unknown as { __infrastructureFirstRunFixture?: unknown })
          .__infrastructureFirstRunFixture,
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

async function open(
  page: Page,
  address: string,
  query: string = "",
): Promise<void> {
  await page.goto(`${address}${query ? `?${query}` : ""}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByTestId("card").first()).toBeVisible();
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __infrastructureFirstRunFixture: unknown })
          .__infrastructureFirstRunFixture,
      ),
    ) as FixtureState;
  });
}

// How many times the page has counted this list (the first count included).
async function checks(page: Page, modelName: string): Promise<number> {
  return (await fixture(page)).countRequests.filter(
    (request: { modelName: string }): boolean => {
      return request.modelName === modelName;
    },
  ).length;
}

// The agent reports: from now on the project has its first record.
async function arrive(page: Page, kind: ArrivalKind): Promise<void> {
  await page.evaluate((what: string): void => {
    (
      window as unknown as {
        __infrastructureFirstRunFixture: { arrive: (kind: string) => void };
      }
    ).__infrastructureFirstRunFixture.arrive(what);
  }, kind);
}

// The empty table: "No X yet" and what the list is for.
function emptyTable(page: Page): Locator {
  return page.locator('[data-empty-state-kind="empty"]');
}

// The card the list's table is drawn in: the first on the page.
function tableCard(page: Page): Locator {
  return page.getByTestId("card").first();
}

function headerButton(page: Page, name: string): Locator {
  return tableCard(page)
    .getByTestId("card-header-actions")
    .getByRole("button", { name, exact: true });
}

function emptyTableCreate(page: Page): Locator {
  return page.getByTestId("empty-table-create-button");
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: false,
  });
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

// Whether `lower` is drawn below `upper` on the page.
async function isBelow(upper: Locator, lower: Locator): Promise<boolean> {
  const top: { y: number; height: number } | null = await upper.boundingBox();
  const bottom: { y: number } | null = await lower.boundingBox();
  return Boolean(top && bottom && bottom.y >= top.y + top.height - 1);
}

/*
 * ---------------------------------------------------------------------------
 * Hosts
 * ---------------------------------------------------------------------------
 */

test("a new project's Hosts: the empty table says what the list is, the guide under it what to do, and Create stays in the header", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, HOSTS);

  await expect(emptyTable(page)).toBeVisible();
  await expect(emptyTable(page)).toContainText("No hosts yet");
  await expect(emptyTable(page)).toContainText(
    "Hosts being monitored in this project. A host shows up here once its OpenTelemetry Collector sends data.",
  );

  const guideTitle: Locator = page.getByText(
    "Getting Started with Host Monitoring",
    { exact: true },
  );
  const guideSentence: Locator = page.getByText(GUIDE_SENTENCE, {
    exact: true,
  });
  await expect(guideTitle).toBeVisible();
  await expect(guideSentence).toBeVisible();
  expect(await isBelow(emptyTable(page), guideTitle)).toBe(true);

  // Creating a host by hand connects nothing: the guide is the way in.
  await expect(headerButton(page, "Create Host")).toBeVisible();
  await expect(emptyTableCreate(page)).toHaveCount(0);

  await screenshot(page, "hosts-first-run");
});

test("the first host to report shows in the table, and the guide goes away, without a reload", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, HOSTS);
  await expect(emptyTable(page)).toBeVisible();
  // Gone if the page reloads.
  await page.evaluate((): void => {
    (window as unknown as { __sameLoad: boolean }).__sameLoad = true;
  });
  expect(await checks(page, "Host")).toBe(1);

  // A look that still finds none changes nothing.
  await page.clock.runFor(POLL_MS + 1);
  await expect
    .poll((): Promise<number> => {
      return checks(page, "Host");
    })
    .toBe(2);
  await expect(emptyTable(page)).toBeVisible();
  await expect(page.getByText(GUIDE_SENTENCE)).toBeVisible();

  await arrive(page, "host");
  await page.clock.runFor(POLL_MS + 1);

  await expect(
    tableCard(page).getByText("web-01", { exact: true }).first(),
  ).toBeVisible();
  await expect(emptyTable(page)).toHaveCount(0);
  await expect(
    page.getByText("Getting Started with Host Monitoring"),
  ).toHaveCount(0);
  await expect(page.getByText(GUIDE_SENTENCE)).toHaveCount(0);
  expect(
    await page.evaluate((): boolean => {
      return Boolean(
        (window as unknown as { __sameLoad?: boolean }).__sameLoad,
      );
    }),
  ).toBe(true);
  expect(new URL(page.url()).pathname).toBe(HOSTS);

  // The watch is over: no more looks.
  const looks: number = await checks(page, "Host");
  await page.clock.runFor(3 * POLL_MS);
  expect(await checks(page, "Host")).toBe(looks);

  await screenshot(page, "hosts-first-host-arrived");
});

test("a project that has a host: no guide, and the page does not keep looking", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, HOSTS, "hosts=1");

  await expect(
    tableCard(page).getByText("web-01", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText(GUIDE_SENTENCE)).toHaveCount(0);
  await expect(emptyTable(page)).toHaveCount(0);

  await page.clock.runFor(3 * POLL_MS);
  expect(await checks(page, "Host")).toBe(1);
});

/*
 * ---------------------------------------------------------------------------
 * VMware and Cloud
 * ---------------------------------------------------------------------------
 */

test("vCenters: connecting one by hand is a way in, so the empty table keeps Connect vCenter", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, VCENTERS);

  await expect(emptyTable(page)).toContainText("No vCenters yet");
  await expect(headerButton(page, "Connect vCenter")).toBeVisible();
  await expect(emptyTableCreate(page)).toBeVisible();
  await expect(emptyTableCreate(page)).toHaveText("Connect vCenter");
  await expect(
    page.getByText("Getting Started with VMware Monitoring", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(GUIDE_SENTENCE, { exact: true })).toBeVisible();

  await screenshot(page, "vcenters-first-run");

  // The first vCenter an agent sends shows on its own, too.
  await arrive(page, "vcenter");
  await page.clock.runFor(POLL_MS + 1);
  await expect(
    tableCard(page).getByText("vcenter-lab", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText(GUIDE_SENTENCE)).toHaveCount(0);
  await expect(emptyTableCreate(page)).toHaveCount(0);
});

test("Cloud resources: nothing to create, and the first one discovered shows on its own", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, CLOUD_RESOURCES);

  await expect(emptyTable(page)).toContainText(
    "No cloud resources discovered yet",
  );
  await expect(
    tableCard(page)
      .getByTestId("card-header-actions")
      .getByRole("button", { name: /^Create / }),
  ).toHaveCount(0);
  await expect(emptyTableCreate(page)).toHaveCount(0);
  await expect(
    page.getByText("Discover your cloud resources", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(GUIDE_SENTENCE, { exact: true })).toBeVisible();

  // Only resources are counted: the environments list is a list of its own.
  const counted: Array<{ modelName: string; query: unknown }> = (
    await fixture(page)
  ).countRequests.filter((request: { modelName: string }): boolean => {
    return request.modelName === "CloudResource";
  });
  expect(counted).toEqual([
    { modelName: "CloudResource", query: { cloudResourceKind: "resource" } },
  ]);

  await arrive(page, "cloudResource");
  await page.clock.runFor(POLL_MS + 1);
  await expect(
    tableCard(page).getByText("orders-db", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText(GUIDE_SENTENCE)).toHaveCount(0);
});

/*
 * ---------------------------------------------------------------------------
 * On a phone, in the dark, in German
 * ---------------------------------------------------------------------------
 */

test("on a phone the first run fits, with the guide under the empty table", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, HOSTS);

  await expect(emptyTable(page)).toBeVisible();
  await expect(emptyTableCreate(page)).toHaveCount(0);
  await expect(page.getByText(GUIDE_SENTENCE)).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await screenshot(page, "hosts-first-run-phone");

  await page.goto(VCENTERS);
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(emptyTableCreate(page)).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await screenshot(page, "vcenters-first-run-phone");
});

test("in the dark theme", async ({ page }: { page: Page }) => {
  await open(page, HOSTS, "theme=dark");

  await expect(emptyTable(page)).toBeVisible();
  await expect(page.getByText(GUIDE_SENTENCE)).toBeVisible();
  await screenshot(page, "hosts-first-run-dark");
});

test("in German, the guide's sentence and the list's description are translated", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, HOSTS, "lang=de");

  await expect(emptyTable(page)).toBeVisible();
  await expect(
    page.getByText(
      "Folge den Schritten unten. Diese Liste füllt sich von selbst, sobald Daten eintreffen.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(emptyTable(page)).toContainText(
    "Hosts, die in diesem Projekt überwacht werden. Ein Host erscheint hier, sobald sein OpenTelemetry Collector Daten sendet.",
  );
  await expect(page.getByText(GUIDE_SENTENCE)).toHaveCount(0);
  await screenshot(page, "hosts-first-run-de");
});
