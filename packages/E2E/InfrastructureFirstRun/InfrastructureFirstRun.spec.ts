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
 * A new project opens a list and sees what the list is (the empty table)
 * and what the product gives (the showcase under it, with the list's Add
 * button, which opens the setup guide). The empty table does not repeat the
 * button: it is in the card header and on the showcase. Cloud resources,
 * where nothing is added by hand, keeps its Connect tiles and folded guide.
 * When the agent reports, the page shows the first record and puts the
 * showcase away on its own: no reload. On a desktop, on a phone, in the dark
 * theme and in German.
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

/*
 * FIRST_RUN_GUIDE_DESCRIPTION: under the title of Cloud resources' folded
 * guide. Hosts and vCenters show their showcase instead, and no guide.
 */
const GUIDE_SENTENCE: string =
  "Follow the steps below. This list fills in on its own once data arrives.";

// The showcases' titles: HostShowcase.ts and VMwareVCenterShowcase.ts.
const HOSTS_SHOWCASE_TITLE: string =
  "Know what every server is doing, down to the process";
const VCENTERS_SHOWCASE_TITLE: string =
  "See every host, VM and datastore in vSphere";

// The fixture's answer to a count that fails (?failFirstCount=1).
const COUNT_FAILURE: string =
  "The server did not answer. Try again in a moment.";

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

// What an empty list shows under its table: the product, and its Add button.
function showcase(page: Page): Locator {
  return page.getByTestId("resource-showcase");
}

function showcaseTitle(page: Page): Locator {
  return showcase(page).getByRole("heading", { level: 2 });
}

function showcaseButton(page: Page): Locator {
  return showcase(page).getByTestId("resource-showcase-add-button");
}

// The filter chips over the list's table.
function chips(page: Page): Locator {
  return page.getByTestId("facet-filter-bar");
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

test("a new project's Hosts: the empty table says what the list is, the showcase under it what Hosts gives, and Add Host opens the one command", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, HOSTS);

  await expect(emptyTable(page)).toBeVisible();
  await expect(emptyTable(page)).toContainText("No hosts yet");
  await expect(emptyTable(page)).toContainText(
    "Hosts being monitored in this project. Add one with a single command on the host.",
  );

  // What Hosts gives, under the empty table. The guide waits behind Add Host.
  await expect(showcaseTitle(page)).toHaveText(HOSTS_SHOWCASE_TITLE);
  expect(await isBelow(emptyTable(page), showcase(page))).toBe(true);
  await expect(page.getByTestId("setup-guide")).toHaveCount(0);
  await expect(page.getByText(GUIDE_SENTENCE)).toHaveCount(0);

  /*
   * Typing a host in by hand connects nothing: the one command is the way
   * in, from Add Host in the header or on the showcase.
   */
  await expect(headerButton(page, "Add Host")).toBeVisible();
  await expect(headerButton(page, "Create Host")).toHaveCount(0);
  await expect(showcaseButton(page)).toHaveText("Add Host");
  await expect(emptyTableCreate(page)).toHaveCount(0);
  // Nothing to filter yet: no chips over the empty table.
  await expect(chips(page)).toHaveCount(0);

  await screenshot(page, "hosts-first-run");

  // The showcase's Add Host is the header's: the one command, in a dialog.
  await showcaseButton(page).click();
  const addHost: Locator = page.getByTestId("add-host-modal");
  await expect(addHost.getByTestId("setup-guide")).toBeVisible();
  await page
    .getByTestId("modal")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await expect(addHost).toHaveCount(0);
});

test("the first host to report shows in the table, and the showcase goes away, without a reload", async ({
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
  await expect(showcaseTitle(page)).toHaveText(HOSTS_SHOWCASE_TITLE);

  await arrive(page, "host");
  await page.clock.runFor(POLL_MS + 1);

  await expect(
    tableCard(page).getByText("web-01", { exact: true }).first(),
  ).toBeVisible();
  await expect(emptyTable(page)).toHaveCount(0);
  await expect(showcase(page)).toHaveCount(0);
  // With a host to filter, the chips are back.
  await expect(chips(page)).toBeVisible();
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

test("a project that has a host: no showcase, and the page does not keep looking", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, HOSTS, "hosts=1");

  await expect(
    tableCard(page).getByText("web-01", { exact: true }).first(),
  ).toBeVisible();
  await expect(showcase(page)).toHaveCount(0);
  await expect(emptyTable(page)).toHaveCount(0);
  await expect(chips(page)).toBeVisible();

  await page.clock.runFor(3 * POLL_MS);
  expect(await checks(page, "Host")).toBe(1);
});

test("a first count that failed says so, and its Refresh counts again", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(`${HOSTS}?failFirstCount=1`);
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });

  // The message and its Refresh share one block, so the words are matched within it.
  await expect(page.getByText(COUNT_FAILURE)).toBeVisible();
  await expect(emptyTable(page)).toHaveCount(0);
  await expect(showcase(page)).toHaveCount(0);
  expect(await checks(page, "Host")).toBe(1);

  const refresh: Locator = page.getByTestId("refresh-button");
  await expect(refresh).toBeVisible();
  await screenshot(page, "hosts-first-count-failed");
  await refresh.click();

  await expect(emptyTable(page)).toBeVisible();
  await expect(showcaseTitle(page)).toHaveText(HOSTS_SHOWCASE_TITLE);
  await expect(page.getByText(COUNT_FAILURE)).toHaveCount(0);
  expect(await checks(page, "Host")).toBe(2);
});

/*
 * ---------------------------------------------------------------------------
 * VMware and Cloud
 * ---------------------------------------------------------------------------
 */

test("vCenters: connecting one by hand is a way in, from Connect vCenter in the header and on the showcase - not in the empty table", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, VCENTERS);

  await expect(emptyTable(page)).toContainText("No vCenters yet");
  await expect(showcaseTitle(page)).toHaveText(VCENTERS_SHOWCASE_TITLE);
  expect(await isBelow(emptyTable(page), showcase(page))).toBe(true);
  await expect(page.getByTestId("setup-guide")).toHaveCount(0);
  await expect(page.getByText(GUIDE_SENTENCE)).toHaveCount(0);

  // In the card header and on the showcase, and not in the empty table.
  await expect(headerButton(page, "Connect vCenter")).toBeVisible();
  await expect(showcaseButton(page)).toHaveText("Connect vCenter");
  await expect(emptyTableCreate(page)).toHaveCount(0);

  await screenshot(page, "vcenters-first-run");

  // The showcase's button opens the table's own form, as the header's does.
  await showcaseButton(page).click();
  const form: Locator = page.getByTestId("modal");
  await expect(
    form.getByPlaceholder("https://vcsa.example.com", { exact: true }),
  ).toBeVisible();
  await form.getByTestId("modal-footer-close-button").click();
  await expect(page.getByTestId("modal")).toHaveCount(0);

  // The first vCenter an agent sends shows on its own, too.
  await arrive(page, "vcenter");
  await page.clock.runFor(POLL_MS + 1);
  await expect(
    tableCard(page).getByText("vcenter-lab", { exact: true }).first(),
  ).toBeVisible();
  await expect(showcase(page)).toHaveCount(0);
  await expect(emptyTableCreate(page)).toHaveCount(0);
});

test("Cloud resources: nothing to create, a cloud account one click away, and the first one discovered shows on its own", async ({
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

  /*
   * The way in leads: connect an AWS, Azure or Google Cloud account from
   * its tile (Cloud > Connect), no collector to run.
   */
  const callout: Locator = page.getByTestId("cloud-connect-callout");
  await expect(callout).toContainText("Connect a cloud account");
  for (const provider of ["aws", "azure", "gcp"]) {
    await expect(
      callout.getByTestId(`cloud-connection-tile-${provider}`),
    ).toBeEnabled();
  }

  // A collector of one's own is the other way, folded until asked for.
  const collectorWay: Locator = page.getByRole("button", {
    name: "Already run an OpenTelemetry Collector?",
  });
  await expect(collectorWay).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByText("Discover your cloud resources", { exact: true }),
  ).toBeHidden();
  await screenshot(page, "cloud-resources-first-run");

  await collectorWay.click();
  await expect(collectorWay).toHaveAttribute("aria-expanded", "true");
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
  // Once something is there, the list is the page: no way-in cards.
  await expect(page.getByTestId("cloud-connect-callout")).toHaveCount(0);
  await expect(collectorWay).toHaveCount(0);
});

test("Cloud resources: a cloud's tile on the empty list opens that cloud's form on Cloud > Connect", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, CLOUD_RESOURCES);

  await page
    .getByTestId("cloud-connect-callout")
    .getByTestId("cloud-connection-tile-azure")
    .click();

  // The fixture draws addresses it does not model as their path.
  await expect(page.getByTestId("stub-page")).toHaveText(
    `/dashboard/${PROJECT_ID}/cloud/connect?cloud=azure`,
  );
});

/*
 * ---------------------------------------------------------------------------
 * All vCenters' columns
 * ---------------------------------------------------------------------------
 *
 * "We dont need to show these column in vmware: Can you please remove them
 * from the default view": Collected By and Agent Version start hidden, and
 * Customize Columns (the card's More options, then Columns) turns either
 * back on - on a laptop's table and on a phone's cards.
 */

const VCENTER_COLUMNS: Array<string> = [
  "Name",
  "Status",
  "Last Seen",
  "Labels",
  "Owners",
];

const VCENTER_COLUMNS_SWITCHED_ON: Array<string> = [
  "Name",
  "Status",
  "Collected By",
  "Agent Version",
  "Last Seen",
  "Labels",
  "Owners",
];

// The table's column headers, less the select-all box and the actions cell.
async function columnHeaders(page: Page): Promise<Array<string>> {
  return tableCard(page)
    .locator("thead th")
    .evaluateAll((cells: Array<Element>): Array<string> => {
      return cells
        .filter((cell: Element): boolean => {
          return cell.querySelector('input[type="checkbox"]') === null;
        })
        .map((cell: Element): string => {
          return (cell.textContent || "").trim();
        })
        .filter((text: string): boolean => {
          return text.length > 0 && text !== "Actions";
        });
    });
}

// A vCenter's card on a phone, and the names of the fields it shows.
function phoneCard(page: Page, name: string): Locator {
  return tableCard(page).locator("dl").filter({ hasText: name });
}

async function cardFields(card: Locator): Promise<Array<string>> {
  return card
    .locator("dt")
    .evaluateAll((terms: Array<Element>): Array<string> => {
      return terms.map((term: Element): string => {
        return (term.textContent || "").trim();
      });
    });
}

// Customize Columns: the card header's More options, then Columns.
async function openColumnPicker(
  page: Page,
  names: { moreOptions: string; columns: string } = {
    moreOptions: "More options",
    columns: "Columns",
  },
): Promise<Locator> {
  await tableCard(page)
    .getByTestId("card-header-actions")
    .getByRole("button", { name: names.moreOptions })
    .click();
  await page
    .getByRole("menuitem", { name: names.columns, exact: true })
    .click();
  const picker: Locator = page.getByTestId("column-customization-modal");
  await expect(picker).toBeVisible();
  // Settled: the dialog fades in, and is measured and shot once it has.
  await expect(page.getByTestId("modal")).toHaveCSS("opacity", "1");
  return picker;
}

interface ColumnListGeometry {
  rows: number;
  clientHeight: number;
  scrollHeight: number;
  // From the top of the list's inside: where its last row ends.
  lastRowBottom: number;
  firstRowTop: number;
  // A row with the rule under it.
  rowPitch: number;
  // The height the list may grow to, inside its border.
  innerMaxHeight: number;
}

// The picker's list of columns, measured as drawn.
async function columnListGeometry(
  picker: Locator,
): Promise<ColumnListGeometry> {
  return picker
    .getByTestId("column-customization-list")
    .evaluate((list: Element): ColumnListGeometry => {
      const style: CSSStyleDeclaration = getComputedStyle(list);
      const borderTop: number = parseFloat(style.borderTopWidth) || 0;
      const borderBottom: number = parseFloat(style.borderBottomWidth) || 0;
      const insideTop: number = list.getBoundingClientRect().top + borderTop;
      const rows: Array<DOMRect> = Array.from(
        list.querySelectorAll("[data-rbd-draggable-id]"),
      ).map((row: Element): DOMRect => {
        return row.getBoundingClientRect();
      });
      const first: DOMRect = rows[0] as DOMRect;
      const second: DOMRect = rows[1] as DOMRect;
      const last: DOMRect = rows[rows.length - 1] as DOMRect;

      return {
        rows: rows.length,
        clientHeight: list.clientHeight,
        scrollHeight: list.scrollHeight,
        lastRowBottom: last.bottom - insideTop,
        firstRowTop: first.top - insideTop,
        rowPitch: second.top - first.top,
        innerMaxHeight: parseFloat(style.maxHeight) - borderTop - borderBottom,
      };
    });
}

/*
 * The list used to stop at exactly six rows, so Owners - the seventh - sat
 * below its edge with nothing to say it was there. Now all seven show, and
 * the height the list stops at falls in the middle of a row: a longer list
 * shows half of its next row, which says it scrolls.
 */
async function expectEveryColumnInView(picker: Locator): Promise<void> {
  const geometry: ColumnListGeometry = await columnListGeometry(picker);

  expect(geometry.rows).toBe(7);
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
  expect(geometry.lastRowBottom).toBeLessThanOrEqual(
    geometry.clientHeight + 0.5,
  );

  const rowsInView: number =
    (geometry.innerMaxHeight - geometry.firstRowTop) / geometry.rowPitch;
  const cut: number = rowsInView - Math.floor(rowsInView);

  expect(rowsInView).toBeGreaterThan(7);
  expect(cut).toBeGreaterThan(0.3);
  expect(cut).toBeLessThan(0.7);
}

async function switchOnBothColumns(page: Page): Promise<void> {
  const picker: Locator = await openColumnPicker(page);
  await picker.getByTestId("column-toggle-collectionMethod").check();
  await picker.getByTestId("column-toggle-agentVersion").check();
  await page.getByTestId("modal-footer-submit-button").click();
  await expect(page.getByTestId("column-customization-modal")).toHaveCount(0);
}

test("All vCenters opens on Name, Status, Last Seen, Labels and Owners; Collected By and Agent Version wait in Customize Columns", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, VCENTERS, "vcenters=1");

  await expect(
    tableCard(page).getByText("vcenter-prod", { exact: true }).first(),
  ).toBeVisible();
  expect(await columnHeaders(page)).toEqual(VCENTER_COLUMNS);
  // Neither column's cells are drawn: no probe, no agent, no version.
  await expect(tableCard(page).getByText("Probe: Lab Probe")).toHaveCount(0);
  await expect(
    tableCard(page).getByText("VMware Agent", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("agent-version-outdated")).toHaveCount(0);
  expect(await scrollsSideways(page)).toBe(false);
  await screenshot(page, "vcenters-default-columns");

  // Both are offered, switched off, beside the columns that are on.
  const picker: Locator = await openColumnPicker(page);
  await expect(picker.getByText("Collected By", { exact: true })).toBeVisible();
  await expect(
    picker.getByText("Agent Version", { exact: true }),
  ).toBeVisible();
  await expect(
    picker.getByTestId("column-toggle-collectionMethod"),
  ).not.toBeChecked();
  await expect(
    picker.getByTestId("column-toggle-agentVersion"),
  ).not.toBeChecked();
  await expect(picker.getByTestId("column-toggle-name")).toBeChecked();
  await expect(picker.getByTestId("column-toggle-lastSeenAt")).toBeChecked();
  await expect(picker.getByTestId("column-customization-count")).toHaveText(
    "5 of 7 columns shown",
  );
  await expectEveryColumnInView(picker);
  await screenshot(page, "vcenters-column-picker");
  await page.getByTestId("modal-footer-close-button").click();
  await expect(picker).toHaveCount(0);

  // Switched on, they show after Status, saying what they always said.
  await switchOnBothColumns(page);
  await expect
    .poll((): Promise<Array<string>> => {
      return columnHeaders(page);
    })
    .toEqual(VCENTER_COLUMNS_SWITCHED_ON);
  await expect(
    tableCard(page).getByText("Probe: Lab Probe", { exact: true }),
  ).toBeVisible();
  await expect(
    tableCard(page).getByText("VMware Agent", { exact: true }),
  ).toBeVisible();
  // The outdated agent keeps its upgrade sign.
  await expect(page.getByTestId("agent-version-outdated")).toContainText(
    "0.100.0",
  );
  await screenshot(page, "vcenters-columns-switched-on");

  // The viewer's choice outlives a reload.
  await page.reload();
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect
    .poll((): Promise<Array<string>> => {
      return columnHeaders(page);
    })
    .toEqual(VCENTER_COLUMNS_SWITCHED_ON);

  // Reset to default puts the list back to its five columns.
  await openColumnPicker(page);
  await page.getByTestId("column-customization-reset").click();
  await expect
    .poll((): Promise<Array<string>> => {
      return columnHeaders(page);
    })
    .toEqual(VCENTER_COLUMNS);
});

test("on a phone, a vCenter's card shows neither until Customize Columns switches them on", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, VCENTERS, "vcenters=1");

  const agentCard: Locator = phoneCard(page, "vcenter-prod");
  await expect(agentCard).toBeVisible();
  expect(await cardFields(agentCard)).toEqual(["Name", "Status", "Last Seen"]);
  await expect(page.getByTestId("agent-version-outdated")).toHaveCount(0);
  expect(await scrollsSideways(page)).toBe(false);
  await screenshot(page, "vcenters-default-columns-phone");

  // The phone's sheet lists all seven columns too.
  const picker: Locator = await openColumnPicker(page);
  await expectEveryColumnInView(picker);
  await screenshot(page, "vcenters-column-picker-phone");
  await page.getByTestId("modal-footer-close-button").click();
  await expect(picker).toHaveCount(0);

  await switchOnBothColumns(page);

  await expect
    .poll((): Promise<Array<string>> => {
      return cardFields(agentCard);
    })
    .toEqual(["Name", "Status", "Collected By", "Agent Version", "Last Seen"]);
  await expect(
    agentCard.getByText("VMware Agent", { exact: true }),
  ).toBeVisible();
  await expect(agentCard.getByTestId("agent-version-outdated")).toContainText(
    "0.100.0",
  );
  // A vCenter a probe collects has no agent version: no field over nothing.
  const probeCard: Locator = phoneCard(page, "vcenter-lab");
  await expect(
    probeCard.getByText("Probe: Lab Probe", { exact: true }),
  ).toBeVisible();
  expect(await cardFields(probeCard)).toEqual([
    "Name",
    "Status",
    "Collected By",
    "Last Seen",
  ]);
  expect(await scrollsSideways(page)).toBe(false);
  await screenshot(page, "vcenters-columns-switched-on-phone");
});

/*
 * The way back to the two columns, in German: the menu item, the dialog's
 * count line (English until now) and its search, which only matched the
 * English titles - "Agent-Version" found nothing in a list that showed it.
 */
test("in German, Customize Columns reads German and its search finds the columns by their German names", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, VCENTERS, "vcenters=1&lang=de");

  await expect(
    tableCard(page).getByText("vcenter-prod", { exact: true }).first(),
  ).toBeVisible();
  const germanHeaders: () => Promise<Array<string>> = async (): Promise<
    Array<string>
  > => {
    return (await columnHeaders(page)).filter((text: string): boolean => {
      return text !== "Aktionen";
    });
  };
  expect(await germanHeaders()).toEqual([
    "Name",
    "Status",
    "Zuletzt gesehen",
    "Beschriftungen",
    "Eigentümer",
  ]);

  const picker: Locator = await openColumnPicker(page, {
    moreOptions: "Weitere Optionen",
    columns: "Spalten",
  });
  await expect(page.getByRole("dialog")).toContainText("Spalten anpassen");
  await expect(picker.getByTestId("column-customization-count")).toHaveText(
    "5 von 7 Spalten angezeigt",
  );
  await expect(
    picker.getByTestId("column-toggle-collectionMethod"),
  ).not.toBeChecked();
  await expect(
    picker.getByTestId("column-toggle-agentVersion"),
  ).not.toBeChecked();
  await expect(picker.getByText("Erfasst von", { exact: true })).toBeVisible();
  await expect(
    picker.getByText("Agent-Version", { exact: true }),
  ).toBeVisible();

  // Typed as the row reads.
  await picker.getByTestId("column-customization-search").fill("agent-version");
  await expect(picker.getByTestId("column-toggle-agentVersion")).toBeVisible();
  await expect(picker.getByTestId("column-toggle-name")).toHaveCount(0);
  await expect(picker.getByTestId("column-customization-hint")).toHaveText(
    "Leeren Sie die Suche, um Spalten neu anzuordnen.",
  );
  await screenshot(page, "vcenters-column-picker-de-search");
  await picker.getByTestId("column-toggle-agentVersion").check();

  await picker.getByTestId("column-customization-search").fill("Erfasst");
  await picker.getByTestId("column-toggle-collectionMethod").check();
  await page.getByTestId("modal-footer-submit-button").click();
  await expect(picker).toHaveCount(0);

  await expect
    .poll((): Promise<Array<string>> => {
      return germanHeaders();
    })
    .toEqual([
      "Name",
      "Status",
      "Erfasst von",
      "Agent-Version",
      "Zuletzt gesehen",
      "Beschriftungen",
      "Eigentümer",
    ]);
  await expect(
    tableCard(page).getByText("Sonde: Lab Probe", { exact: true }),
  ).toBeVisible();
  await expect(
    tableCard(page).getByText("VMware-Agent", { exact: true }),
  ).toBeVisible();
});

/*
 * ---------------------------------------------------------------------------
 * On a phone, in the dark, in German
 * ---------------------------------------------------------------------------
 */

test("on a phone the first run fits, with the showcase under the empty table", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, HOSTS);

  await expect(emptyTable(page)).toBeVisible();
  await expect(emptyTableCreate(page)).toHaveCount(0);
  await expect(showcaseTitle(page)).toHaveText(HOSTS_SHOWCASE_TITLE);
  await expect(showcaseButton(page)).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await screenshot(page, "hosts-first-run-phone");

  await page.goto(VCENTERS);
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(showcaseButton(page)).toHaveText("Connect vCenter");
  await expect(emptyTableCreate(page)).toHaveCount(0);
  expect(await scrollsSideways(page)).toBe(false);
  await screenshot(page, "vcenters-first-run-phone");
});

test("in the dark theme", async ({ page }: { page: Page }) => {
  await open(page, HOSTS, "theme=dark");

  await expect(emptyTable(page)).toBeVisible();
  await expect(showcaseTitle(page)).toHaveText(HOSTS_SHOWCASE_TITLE);
  await screenshot(page, "hosts-first-run-dark");
});

test("in German, the list's description and Add Host on the showcase are translated", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, HOSTS, "lang=de");

  await expect(emptyTable(page)).toBeVisible();
  await expect(emptyTable(page)).toContainText(
    "Hosts, die in diesem Projekt überwacht werden. Fügen Sie einen mit einem einzigen Befehl auf dem Host hinzu.",
  );
  /*
   * The showcase's button reads as the header's. Its own words are new and
   * not translated yet, so they are not checked here.
   */
  await expect(headerButton(page, "Host hinzufügen")).toBeVisible();
  await expect(showcaseButton(page)).toHaveText("Host hinzufügen");
  await screenshot(page, "hosts-first-run-de");
});
