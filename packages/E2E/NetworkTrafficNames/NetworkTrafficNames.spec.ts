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
 * Names instead of bare addresses on Network > Traffic (issue #5340), in a
 * real browser: the real Network layout, Traffic page and Address Names
 * page against the offline fixture (Fixture/Fixture.js). Only the data
 * boundary and the signed-in user are synthetic.
 *
 * An address the project knows is shown by its name first - a host's, a
 * device's, a cloud resource's, a Kubernetes node's or pod's, a name
 * someone gave it, its DNS name - with the address beside it, in the top
 * lists and both views of the conversations; a long name is cut to its
 * line and whole under the pointer. A page narrowed to one address says
 * who it is and offers the next step: Open host, Name this address,
 * Rename. Find takes a name. Network > Settings > Address Names lists the
 * names people give addresses and subnets. At a laptop's and a phone's
 * width, in the dark theme, in German and in Persian (where the addresses
 * still read left to right).
 *
 * Every test puts up a network fence that aborts anything leaving the
 * fixture server, and fails on an uncaught page error, on a request the
 * fixture does not model and on any request the fence had to abort.
 */

// The fixture server's port, as the config and server.js read it.
const PORT: string =
  process.env["NETWORK_TRAFFIC_NAMES_FIXTURE_PORT"] || "4547";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const TRAFFIC: string = `/dashboard/${PROJECT_ID}/network-devices/traffic`;
const ADDRESS_NAMES: string = `/dashboard/${PROJECT_ID}/network-devices/settings/address-names`;
const HOST_ID: string = "60000000-0000-4000-8000-000000000001";

// The first conversation, by its names and by its addresses.
const FIRST_CONVERSATION_NAMES: RegExp = /mumbai-fs01\s*→\s*Backup appliance/;
const FIRST_CONVERSATION_ADDRESSES: RegExp =
  /10\.18\.167\.35\s*→\s*10\.18\.167\.20/;
const PAYROLL_IN_ADDRESS_BAR: RegExp = /dst=158\.115\.141\.143/;
const DARK_THEME: RegExp = /dark/;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/network-traffic-names-ui",
);

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fsSync.readFileSync(
      path.resolve(
        __dirname,
        `../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
      ),
      "utf8",
    ),
  );
}

const GERMAN: Record<string, string> = locale("de");
const PERSIAN: Record<string, string> = locale("fa");

interface FixtureState {
  flowRequests: Array<{ filters?: Record<string, unknown> }>;
  findRequests: Array<{ query?: string }>;
  creates: Array<{ name: string; address: string }>;
  updates: Array<{ id: string; data: Record<string, unknown> }>;
  deletes: Array<string>;
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
  query: string = "",
  address: string = TRAFFIC,
): Promise<void> {
  await page.goto(`${address}${query ? `?${query}` : ""}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
}

async function openTraffic(page: Page, query: string = ""): Promise<void> {
  await open(page, query);
  await expect(page.getByTestId("traffic-body")).toBeVisible({
    timeout: 60000,
  });
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __networkTrafficNamesFixture: unknown })
          .__networkTrafficNamesFixture,
      ),
    ) as FixtureState;
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

function rowWith(page: Page, list: string, text: string): Locator {
  return rowsOf(page, list).filter({ hasText: text });
}

// A label's text is cut by the browser, not by the page: wider than its box.
async function isCutToItsLine(label: Locator): Promise<boolean> {
  return label.evaluate((element: Element): boolean => {
    return (element as HTMLElement).scrollWidth > element.clientWidth + 1;
  });
}

/*
 * ---------------------------------------------------------------------------
 * The lists, the conversations and the chips
 * ---------------------------------------------------------------------------
 */

test("names first and the address under them, in the top lists and both views of the conversations", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await openTraffic(page);

  // A host, a name someone gave, a DNS name, a cloud resource, a pod.
  const host: Locator = rowWith(page, "traffic-top-sources", "mumbai-fs01");
  await expect(host.getByTestId("traffic-top-sources-row-label")).toHaveText(
    "mumbai-fs01",
  );
  await expect(
    host.getByTestId("traffic-top-sources-row-sublabel"),
  ).toContainText("10.18.167.35");
  await expect(
    host.getByTestId("traffic-top-sources-row-sublabel"),
  ).toContainText("Mumbai office");
  await expect(host.getByTestId("traffic-address-text")).toHaveCSS(
    "direction",
    "ltr",
  );

  await expect(
    rowWith(page, "traffic-top-destinations", "Payroll SaaS").getByTestId(
      "traffic-top-destinations-row-sublabel",
    ),
  ).toContainText("158.115.141.143");
  await expect(
    rowWith(page, "traffic-top-destinations", "orders-db-primary"),
  ).toHaveCount(1);
  await expect(
    rowWith(page, "traffic-top-sources", "checkout-api-7f9c6d-xkz2p"),
  ).toHaveCount(1);

  // An address nothing names, in a subnet someone named: the address, the subnet.
  const subnetOnly: Locator = rowWith(
    page,
    "traffic-top-sources",
    "10.18.167.36",
  );
  await expect(
    subnetOnly.getByTestId("traffic-top-sources-row-label"),
  ).toHaveText("10.18.167.36");
  await expect(
    subnetOnly.getByTestId("traffic-top-sources-row-sublabel"),
  ).toHaveText("Mumbai office");

  // An address nothing names at all: as it always was.
  const bare: Locator = rowWith(page, "traffic-top-sources", "10.242.167.221");
  await expect(bare.getByTestId("traffic-top-sources-row-sublabel")).toHaveCount(
    0,
  );

  const conversations: Locator = page.getByTestId("traffic-top-conversations");

  if (testInfo.project.name === "desktop") {
    // The diagram: a named end by its name, the address and bytes under it.
    const labels: Array<string> = await conversations
      .getByTestId("traffic-conversation-label")
      .allTextContents();
    expect(labels).toContain("mumbai-fs01");
    expect(labels).toContain("Backup appliance");
    await expect(
      conversations.getByTestId("traffic-conversation-label-address").first(),
    ).toContainText("10.18.167.35");
    await screenshot(page, testInfo, "conversations-diagram", conversations);

    await page.getByTestId("traffic-conversations-list").click();
  }

  // The list (the only view on a phone): names, the addresses under them.
  const first: Locator = conversations
    .getByTestId("traffic-conversation-row")
    .first();
  await expect(first.getByTestId("traffic-conversation-row-label")).toHaveText(
    FIRST_CONVERSATION_NAMES,
  );
  await expect(
    first.getByTestId("traffic-conversation-row-addresses"),
  ).toHaveText(FIRST_CONVERSATION_ADDRESSES);
  await screenshot(page, testInfo, "conversations-list", conversations);

  await screenshot(page, testInfo, "names");
  expect(await scrollsSideways(page)).toBe(false);
});

test("a project that knows no names: every address as it was", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await openTraffic(page, "names=none");

  const labels: Array<string> = await page
    .getByTestId("traffic-top-sources")
    .getByTestId("traffic-top-sources-row-label")
    .allTextContents();

  expect(labels[0]).toBe("10.18.167.35");
  await expect(page.getByText("mumbai-fs01")).toHaveCount(0);
  await expect(
    page
      .getByTestId("traffic-top-sources")
      .getByTestId("traffic-top-sources-row-sublabel"),
  ).toHaveCount(0);
  await screenshot(page, testInfo, "no-names");
});

test("long names are cut to their line, whole under the pointer, and nothing scrolls sideways", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await openTraffic(page, "names=long");

  const label: Locator = rowsOf(page, "traffic-top-sources")
    .first()
    .getByTestId("traffic-top-sources-row-label");
  await expect(label).toHaveAttribute(
    "title",
    "mumbai-fileserver-primary-replica-01.storage.corp.acme-networks.example (10.18.167.35)",
  );
  expect(await isCutToItsLine(label)).toBe(true);
  // The bytes and the share stay on the row, whatever the name's length.
  await expect(rowsOf(page, "traffic-top-sources").first()).toContainText(
    "12.5 MB",
  );

  await page.getByTestId("traffic-top-conversations").scrollIntoViewIfNeeded();
  await screenshot(page, testInfo, "long-names");
  expect(await scrollsSideways(page)).toBe(false);
});

test("a chip names the address the page is narrowed to, and a click on a named row narrows by its address", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await openTraffic(page);

  await rowWith(page, "traffic-top-destinations", "Payroll SaaS").click();

  const chip: Locator = page.getByTestId("traffic-filter-destination");
  await expect(chip).toContainText("Payroll SaaS");
  await expect(chip).toContainText("158.115.141.143");
  await expect(chip).toHaveAttribute(
    "title",
    "To Payroll SaaS (158.115.141.143)",
  );

  const state: FixtureState = await fixture(page);
  expect(state.flowRequests[state.flowRequests.length - 1]!.filters).toEqual({
    destinationIp: "158.115.141.143",
  });
  await expect(page).toHaveURL(PAYROLL_IN_ADDRESS_BAR);
  await screenshot(page, testInfo, "chip", page.getByTestId("traffic-filters"));
});

/*
 * ---------------------------------------------------------------------------
 * One address: who it is, and what to do next
 * ---------------------------------------------------------------------------
 */

test("narrowed to a host: its name, Host, the address to copy, its office, and Open host", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await openTraffic(page, "host=10.18.167.35");

  const card: Locator = page.getByTestId("traffic-address-card");
  await expect(card.getByTestId("traffic-address-card-name")).toHaveText(
    "mumbai-fs01",
  );
  await expect(card.getByTestId("traffic-address-card-source")).toHaveText(
    "Host",
  );
  await expect(card.getByTestId("traffic-address-card-subnet")).toHaveText(
    "In Mumbai office",
  );
  await expect(
    card.getByRole("button", { name: "Copy the address" }),
  ).toBeVisible();
  await expect(card.getByTestId("traffic-address-card-name-button")).toHaveCount(
    0,
  );
  await screenshot(page, testInfo, "card-host", card);

  await card.getByTestId("traffic-address-card-open").click();
  await expect(page.getByTestId("stub-page")).toContainText(
    `/dashboard/${PROJECT_ID}/host/${HOST_ID}`,
  );
});

test("Name this address: the address filled in, saved, and the page calls it by its new name", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await openTraffic(page, "host=10.242.167.221");

  const card: Locator = page.getByTestId("traffic-address-card");
  await expect(card.getByTestId("traffic-address-card-source")).toHaveText(
    "No name yet",
  );
  await screenshot(page, testInfo, "card-no-name", card);

  await card.getByTestId("traffic-address-card-name-button").click();
  await settledDialog(page);
  await expect(dialog(page)).toContainText("Name this address");
  await expect(dialog(page).getByPlaceholder("10.18.167.0/24")).toHaveValue(
    "10.242.167.221",
  );
  await screenshot(page, testInfo, "name-dialog", dialog(page));

  await dialog(page).getByPlaceholder("Payroll SaaS").fill("Lab printer");
  await page.getByTestId("modal-footer-submit-button").click();
  await expect(dialog(page)).toHaveCount(0);

  await expect(card.getByTestId("traffic-address-card-name")).toHaveText(
    "Lab printer",
  );
  await expect(card.getByTestId("traffic-address-card-source")).toHaveText(
    "Address name",
  );
  await expect(page.getByTestId("traffic-filter-host")).toContainText(
    "Lab printer",
  );
  expect((await fixture(page)).creates).toEqual([
    { name: "Lab printer", address: "10.242.167.221" },
  ]);
  await screenshot(page, testInfo, "card-named", card);
});

test("an address that already has a name is not named twice: the server's answer is said in the dialog", async ({
  page,
}: {
  page: Page;
}) => {
  await openTraffic(page, "host=10.242.167.221");

  await page.getByTestId("traffic-address-card-name-button").click();
  await settledDialog(page);
  await dialog(page).getByPlaceholder("Payroll SaaS").fill("Backups");
  // Widened to an address another row names.
  await dialog(page).getByPlaceholder("10.18.167.0/24").fill("10.18.167.20");
  await page.getByTestId("modal-footer-submit-button").click();

  await expect(dialog(page)).toContainText(
    "10.18.167.20 already has a name: Backup appliance. Change that one instead.",
  );
});

test("Rename: a name someone gave is changed in place", async ({
  page,
}: {
  page: Page;
}) => {
  await openTraffic(page, "dst=158.115.141.143");

  const card: Locator = page.getByTestId("traffic-address-card");
  await expect(card.getByTestId("traffic-address-card-source")).toHaveText(
    "Address name",
  );

  await card.getByTestId("traffic-address-card-name-button").click();
  await settledDialog(page);
  await expect(dialog(page)).toContainText("Rename this address");
  const name: Locator = dialog(page).getByPlaceholder("Payroll SaaS");
  await expect(name).toHaveValue("Payroll SaaS");
  await name.fill("Payroll (Northwind)");
  await page.getByTestId("modal-footer-submit-button").click();
  await expect(dialog(page)).toHaveCount(0);

  await expect(card.getByTestId("traffic-address-card-name")).toHaveText(
    "Payroll (Northwind)",
  );
  const state: FixtureState = await fixture(page);
  expect(state.updates).toHaveLength(1);
  expect(state.updates[0]!.id).toBe("90000000-0000-4000-8000-000000000002");
  expect(state.creates).toEqual([]);
});

test("a viewer reads the names and is offered nothing to change", async ({
  page,
}: {
  page: Page;
}) => {
  await openTraffic(page, "role=viewer");

  await expect(
    rowWith(page, "traffic-top-sources", "mumbai-fs01"),
  ).toHaveCount(1);

  // Narrowed to an address with no name: who it is, and no button.
  await rowWith(page, "traffic-top-sources", "10.242.167.221").click();
  const card: Locator = page.getByTestId("traffic-address-card");
  await expect(card.getByTestId("traffic-address-card-source")).toHaveText(
    "No name yet",
  );
  await expect(card.getByTestId("traffic-address-card-name-button")).toHaveCount(
    0,
  );
});

/*
 * ---------------------------------------------------------------------------
 * Find
 * ---------------------------------------------------------------------------
 */

test("find by a name: several found are listed to pick from; one found narrows the page; none is said", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await openTraffic(page);

  const box: Locator = page.getByLabel("Find a name or an IP address");

  await box.fill("corp");
  await box.press("Enter");
  const matches: Locator = page.getByTestId("traffic-find-address-matches");
  await expect(matches).toBeVisible();
  await expect(matches.getByTestId("traffic-find-address-match")).toHaveCount(
    2,
  );
  await expect(
    matches.getByTestId("traffic-find-address-match").first(),
  ).toContainText("mum-print-02.corp.acme.example");
  await screenshot(page, testInfo, "find-matches");

  await page.keyboard.press("Escape");
  await expect(matches).toHaveCount(0);

  await box.fill("corp");
  await box.press("Enter");
  await matches
    .getByTestId("traffic-find-address-match")
    .filter({ hasText: "lds-ws-0457" })
    .click();
  await expect(page.getByTestId("traffic-filter-host")).toContainText(
    "lds-ws-0457.corp.acme.example",
  );

  await page.getByTestId("traffic-filters-clear").click();
  await box.fill("build-runner");
  await box.press("Enter");
  await expect(page.getByTestId("traffic-filter-host")).toContainText(
    "build-runner-03",
  );
  await expect(page.getByTestId("traffic-address-card")).toContainText(
    "Open host",
  );

  await page.getByTestId("traffic-filters-clear").click();
  await box.fill("nothing-by-this-name");
  await box.press("Enter");
  await expect(page.getByTestId("traffic-find-address-error")).toContainText(
    "nothing-by-this-name",
  );

  const state: FixtureState = await fixture(page);
  expect(
    state.findRequests.map((request: { query?: string }) => {
      return request.query;
    }),
  ).toEqual(["corp", "corp", "build-runner", "nothing-by-this-name"]);
});

test("an address typed narrows the page at once, never searched for by name", async ({
  page,
}: {
  page: Page;
}) => {
  await openTraffic(page);

  const box: Locator = page.getByLabel("Find a name or an IP address");
  await box.fill("10.18.167.35");
  await box.press("Enter");

  await expect(page.getByTestId("traffic-filter-host")).toContainText(
    "mumbai-fs01",
  );
  expect((await fixture(page)).findRequests).toEqual([]);
});

test("a search that fails says why, and the page stays as it was", async ({
  page,
}: {
  page: Page;
}) => {
  await openTraffic(page, "fail=find");

  const box: Locator = page.getByLabel("Find a name or an IP address");
  await box.fill("payroll");
  await box.press("Enter");

  await expect(page.getByTestId("traffic-find-address-error")).toContainText(
    "Searching names failed. Try again in a moment.",
  );
  await expect(page.getByTestId("traffic-filters-clear")).toHaveCount(0);
});

/*
 * ---------------------------------------------------------------------------
 * Network > Settings > Address Names
 * ---------------------------------------------------------------------------
 */

test("Address Names: the list, a subnet added, and its name beside every address in it", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await open(page, "", ADDRESS_NAMES);

  // A table at a laptop's width, a list of cards at a phone's.
  await expect(page.getByText("Backup appliance").first()).toBeVisible();
  await expect(page.getByText("10.18.167.0/24").first()).toBeVisible();
  await expect(
    page.getByPlaceholder("Search by name, address or subnet"),
  ).toBeVisible();
  await screenshot(page, testInfo, "address-names");

  await page.getByRole("button", { name: "Create Address Name" }).click();
  await settledDialog(page);
  await dialog(page).getByPlaceholder("Payroll SaaS").fill("Build farm");
  await dialog(page).getByPlaceholder("10.18.167.0/24").fill("10.16.1.77/24");
  await screenshot(page, testInfo, "address-names-create", dialog(page));
  await page.getByTestId("modal-footer-submit-button").click();
  await expect(dialog(page)).toHaveCount(0);

  // Kept the one way a subnet is written.
  expect((await fixture(page)).creates).toEqual([
    { name: "Build farm", address: "10.16.1.77/24" },
  ]);
  await expect(page.getByText("10.16.1.0/24").first()).toBeVisible();

  // Back to Traffic in the same page (a reload would forget the new name).
  await page.evaluate((address: string): void => {
    window.history.pushState({}, "", address);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, TRAFFIC);
  await expect(page.getByTestId("traffic-body")).toBeVisible({
    timeout: 60000,
  });
  await expect(
    rowWith(page, "traffic-top-destinations", "build-runner-03").getByTestId(
      "traffic-top-destinations-row-sublabel",
    ),
  ).toContainText("Build farm");
});

test("Address Names refuses what is not an address or a subnet, before anything is sent", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, "", ADDRESS_NAMES);

  await page.getByRole("button", { name: "Create Address Name" }).click();
  await settledDialog(page);
  await dialog(page).getByPlaceholder("Payroll SaaS").fill("Printer");
  await dialog(page).getByPlaceholder("10.18.167.0/24").fill("printer-1");
  await page.getByTestId("modal-footer-submit-button").click();

  await expect(dialog(page)).toContainText(
    "Enter one IP address, like 10.0.0.5, or a subnet, like 10.18.167.0/24.",
  );
  expect((await fixture(page)).creates).toEqual([]);
});

/*
 * ---------------------------------------------------------------------------
 * Theme and languages
 * ---------------------------------------------------------------------------
 */

test("the dark theme", async ({ page }: { page: Page }, testInfo: TestInfo) => {
  await openTraffic(page, "theme=dark&host=10.18.167.31");

  await expect(page.locator("html")).toHaveClass(DARK_THEME);
  await expect(page.getByTestId("traffic-address-card")).toBeVisible();
  await screenshot(page, testInfo, "dark");
});

test("in German", async ({ page }: { page: Page }, testInfo: TestInfo) => {
  await openTraffic(page, "lang=de&host=10.18.167.31");

  const card: Locator = page.getByTestId("traffic-address-card");
  await expect(card.getByTestId("traffic-address-card-source")).toHaveText(
    GERMAN["DNS name"]!,
  );
  await expect(card.getByTestId("traffic-address-card-name-button")).toHaveText(
    GERMAN["Name this address"]!,
  );
  await expect(page.getByLabel(GERMAN["Find a name or an IP address"]!)).toBeVisible();
  expect(GERMAN["Name this address"]).not.toBe("Name this address");
  await screenshot(page, testInfo, "german");
  expect(await scrollsSideways(page)).toBe(false);
});

test("in Persian: the page reads right to left, the addresses and the diagram's flow left to right", async ({
  page,
}: {
  page: Page;
}, testInfo: TestInfo) => {
  await openTraffic(page, "lang=fa");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  // A name written in Persian reads right to left; its address left to right.
  const payroll: Locator = rowWith(
    page,
    "traffic-top-destinations",
    "حقوق و دستمزد",
  );
  await expect(payroll.getByTestId("traffic-address-text")).toHaveCSS(
    "direction",
    "ltr",
  );
  await expect(
    payroll.getByTestId("traffic-top-destinations-row-label").locator("bdi"),
  ).toHaveAttribute("dir", "rtl");

  if (testInfo.project.name === "desktop") {
    // Senders stay on the left under "Sent by", whatever the page's direction.
    const diagram: Locator = page.getByTestId("traffic-conversation-diagram");
    await expect(diagram).toHaveAttribute("dir", "ltr");
    await expect(diagram).toContainText(PERSIAN["Sent by"]!);
  }

  await screenshot(page, testInfo, "persian");
  expect(await scrollsSideways(page)).toBe(false);
});
