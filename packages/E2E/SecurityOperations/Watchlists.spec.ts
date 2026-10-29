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
 * Watchlists on the Security Operations fixture's synthetic month
 * (Fixture/WatchlistsFixture.js lays the lists out and answers Import
 * Values): Security Events > Detections > Watchlists, the common lists to
 * start with, Create Watchlist, a list's page with its rule snippet and its
 * values, Import Values, a list that follows a threat intel feed, and the
 * line under a rule's YAML that names the lists it reads. What the unit
 * tests cannot see: that the pages are reached from the side menu and their
 * rows, that the forms and the dialog send what they say, that each answer
 * reads on the page, and that each page fits a laptop's width and a
 * phone's.
 *
 * Every test pins the clock and fences the network, as
 * SecurityOperations.spec.ts does: afterEach fails a test on an uncaught
 * page error, on any request that left the fixture server and on anything
 * the fixture does not model.
 */

const PORT: string = process.env["SECURITY_OPERATIONS_FIXTURE_PORT"] || "4234";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");

const PRODUCT: string = `/dashboard/${PROJECT_ID}/security-events`;
const WATCHLISTS_PATH: string = `${PRODUCT}/watchlists`;
const DETECTION_RULES_PATH: string = `${PRODUCT}/detection-rules`;
const THREAT_INTEL_PATH: string = `${PRODUCT}/threat-intel`;

// The fixture's lists (WatchlistsFixture.js).
const VIP_USERS_ID: string = "2f000000-0000-4000-8000-000000000001";
const C2_ADDRESSES_ID: string = "2f000000-0000-4000-8000-000000000003";
const VIP_USERS_PATH: string = `${WATCHLISTS_PATH}/${VIP_USERS_ID}`;
const C2_ADDRESSES_PATH: string = `${WATCHLISTS_PATH}/${C2_ADDRESSES_ID}`;

const READING_RULE: string = "VIP sign-in from outside the office";
const FEODO_LIST: string = "Feodo Tracker botnet C2 servers";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/security-operations-ui",
);

interface FixtureState {
  listRequests: Array<{
    modelName: string;
    query: Record<string, unknown>;
  }>;
  apiRequests: Array<{
    method: string;
    url: string;
    body: Record<string, unknown> | null;
  }>;
  creates: Array<{ modelName: string; data: Record<string, unknown> }>;
  deletes: Array<{ modelName: string; id: string }>;
  unhandled: Array<unknown>;
}

interface OpenOptions {
  width?: number;
  height?: number;
  theme?: "dark" | undefined;
  role?: "viewer";
  lang?: "de" | "fa" | "ja";
  empty?: boolean;
}

test.use({ deviceScaleFactor: 2, actionTimeout: 15000 });

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

  // Nothing the page asks for may leave the fixture server.
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

  const hasFixture: boolean = await page
    .evaluate((): boolean => {
      return Boolean(
        (window as unknown as { __securityOperationsFixture?: unknown })
          .__securityOperationsFixture,
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
  target: string,
  options: OpenOptions = {},
): Promise<void> {
  await page.setViewportSize({
    width: options.width || 1440,
    height: options.height || 1000,
  });
  await page.clock.setFixedTime(NOW);
  const url: URL = new URL(target, `http://127.0.0.1:${PORT}`);
  if (options.theme === "dark") {
    url.searchParams.set("theme", "dark");
  }
  if (options.role) {
    url.searchParams.set("role", options.role);
  }
  if (options.lang) {
    url.searchParams.set("lang", options.lang);
  }
  if (options.empty) {
    url.searchParams.set("empty", "1");
  }
  await page.goto(`${url.pathname}${url.search}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.load("600 14px Inter");
    await document.fonts.ready;
  });
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __securityOperationsFixture: FixtureState;
          }
        ).__securityOperationsFixture,
      ),
    ) as FixtureState;
  });
}

async function screenshot(
  page: Page,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: options.fullPage !== false,
    animations: "disabled",
  });
}

// How far the page scrolls sideways.
async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

function sideMenu(page: Page): Locator {
  return page.locator('aside[role="navigation"]');
}

// The entries of the menu marked as the page you are on.
async function litEntries(page: Page): Promise<Array<string>> {
  return sideMenu(page)
    .locator("a.bg-indigo-50")
    .evaluateAll((anchors: Array<Element>): Array<string> => {
      return anchors.map((anchor: Element): string => {
        return (
          anchor.querySelector('[data-testid="side-menu-item-title"]')
            ?.textContent ||
          anchor.textContent ||
          ""
        ).trim();
      });
    });
}

async function breadcrumbs(page: Page): Promise<Array<string>> {
  return (
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("listitem")
      .allInnerTexts()
  ).map((crumb: string): string => {
    return crumb.trim();
  });
}

function dialog(page: Page): Locator {
  return page.getByRole("dialog");
}

// A table row by a text it holds (a list's name, a value).
function rowWith(page: Page, text: string): Locator {
  return page.locator("table tbody tr").filter({
    has: page.getByText(text, { exact: true }),
  });
}

// The column titles of the table on screen, without its checkbox and actions.
async function columnTitles(page: Page): Promise<Array<string>> {
  return (await page.locator("table thead th").allTextContents())
    .map((text: string): string => {
      return text.trim();
    })
    .filter((text: string): boolean => {
      return Boolean(text) && text !== "Select all items" && text !== "Actions";
    });
}

async function createsOf(
  page: Page,
  modelName: string,
): Promise<Array<Record<string, unknown>>> {
  return (await fixture(page)).creates
    .filter((create: { modelName: string }): boolean => {
      return create.modelName === modelName;
    })
    .map((create: { data: Record<string, unknown> }) => {
      return create.data;
    });
}

async function importRequests(
  page: Page,
): Promise<Array<Record<string, unknown>>> {
  return (await fixture(page)).apiRequests
    .filter((request: { method: string; url: string }): boolean => {
      return (
        request.method === "POST" &&
        new URL(request.url).pathname.endsWith("/security-watchlist/import")
      );
    })
    .map((request: { body: Record<string, unknown> | null }) => {
      return request.body || {};
    });
}

// A card on the page, by its title.
function cardTitled(page: Page, title: string): Locator {
  return page.getByTestId("card").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

/*
 * Import Values: the Values card shows one main button - Add Value - and
 * keeps Import Values in its ⋯, as every table card does.
 */
async function openImport(page: Page): Promise<void> {
  await cardTitled(page, "Values")
    .getByRole("button", { name: "More options", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Import Values" }).click();
  await expect(page.getByTestId("watchlist-import-modal")).toBeVisible();
}

// A dialog's dropdown, opened and an option picked by its name.
async function chooseOption(page: Page, name: string): Promise<void> {
  await dialog(page).locator(".ou-select__control").first().click();
  await page.locator(".ou-select__option", { hasText: name }).first().click();
}

/*
 * ---------------------------------------------------------------------------
 * Security Events > Detections > Watchlists
 * ---------------------------------------------------------------------------
 */
test.describe("Watchlists", () => {
  test("lists the lists under Detections: each name as rules write it, what it holds, its values and the rules that read it", async ({
    page,
  }: {
    page: Page;
  }) => {
    // The fixture is 64px narrower than production: 1344 here is a 1280 laptop.
    await open(page, WATCHLISTS_PATH, { width: 1344 });
    await expect(rowWith(page, "vip_users")).toBeVisible({ timeout: 30000 });

    expect(await litEntries(page)).toEqual(["Watchlists"]);
    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Detections",
      "Watchlists",
    ]);
    expect(await columnTitles(page)).toEqual([
      "Watchlist",
      "Holds",
      "Values",
      "Read By",
    ]);

    // By name, as rules write it.
    await expect(page.locator("table tbody tr")).toHaveCount(4);
    const names: Array<string> = await page
      .getByTestId("watchlist-name-cell")
      .locator("bdi.font-mono")
      .allTextContents();
    expect(names).toEqual([
      "admin_addresses",
      "c2_addresses",
      "lab_hosts",
      "vip_users",
    ]);

    const vip: Locator = rowWith(page, "vip_users");
    await expect(vip.getByTestId("watchlist-name-cell")).toContainText(
      "Executives and their assistants.",
    );
    await expect(vip.getByTestId("watchlist-holds-cell")).toHaveText("Users");
    await expect(vip.getByTestId("watchlist-values-cell")).toHaveText(
      "3 values",
    );
    await expect(vip.getByTestId("watchlist-read-by-cell")).toHaveText(
      READING_RULE,
    );

    const addresses: Locator = rowWith(page, "admin_addresses");
    await expect(addresses.getByTestId("watchlist-holds-cell")).toHaveText(
      "IP addresses",
    );
    await expect(addresses.getByTestId("watchlist-read-by-cell")).toHaveText(
      READING_RULE,
    );

    // A list that follows a feed names it; one with no values says so.
    await expect(
      rowWith(page, "c2_addresses").getByTestId("watchlist-values-cell"),
    ).toHaveText(`Follows ${FEODO_LIST}`);
    await expect(
      rowWith(page, "c2_addresses").getByTestId("watchlist-read-by-cell"),
    ).toHaveText("No rule reads it yet");
    await expect(
      rowWith(page, "lab_hosts").getByTestId("watchlist-values-cell"),
    ).toHaveText("No values yet");

    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "watchlists-desktop", { fullPage: false });
  });

  test("offers the common lists the project does not have, and Add creates one, empty and kept by hand", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, WATCHLISTS_PATH);
    const starters: Locator = page.getByTestId("watchlist-starters");
    await expect(starters).toBeVisible({ timeout: 30000 });

    // The project keeps vip_users and admin_addresses: two are left to offer.
    await expect(
      starters.locator('[data-testid^="watchlist-starter-"]').filter({
        has: page.locator("p"),
      }),
    ).toHaveCount(2);
    await expect(starters).toContainText("Critical hosts");
    await expect(starters).toContainText("Known-bad file hashes");
    await expect(starters).not.toContainText("VIP users");

    await starters.getByTestId("watchlist-starter-add-critical-hosts").click();
    await expect(
      starters.getByTestId("watchlist-starter-added-critical-hosts"),
    ).toHaveText("Added");

    const [created] = await createsOf(page, "SecurityWatchlist");
    expect(created).toMatchObject({
      name: "critical_hosts",
      entityType: "Host",
      source: "Values",
      description:
        "Servers that must never be compromised: domain controllers, payment and database servers.",
    });

    // The list reads it at once.
    await expect(rowWith(page, "critical_hosts")).toBeVisible();
    await expect(
      rowWith(page, "critical_hosts").getByTestId("watchlist-values-cell"),
    ).toHaveText("No values yet");
  });

  test("Create Watchlist asks for a name and what it holds, and opens the new list, ready for its values", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, WATCHLISTS_PATH);
    await expect(rowWith(page, "vip_users")).toBeVisible({ timeout: 30000 });

    await page
      .getByRole("button", { name: "Create Watchlist", exact: true })
      .first()
      .click();
    await expect(dialog(page)).toBeVisible();

    // A name that is not one rules can write is refused under its field.
    await dialog(page).getByTestId("watchlist-name").fill("bad domains");
    await chooseOption(page, "Domains");
    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toContainText(
      "Use letters, digits and underscores, starting with a letter, such as vip_users.",
    );
    expect(await createsOf(page, "SecurityWatchlist")).toEqual([]);

    await dialog(page).getByTestId("watchlist-name").fill("bad_domains");
    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toHaveCount(0);

    const [created] = await createsOf(page, "SecurityWatchlist");
    expect(created).toMatchObject({
      name: "bad_domains",
      entityType: "Domain",
      source: "Values",
    });

    // Its page, named in the trail, with no values yet and the way to add them.
    await expect
      .poll(async () => {
        return breadcrumbs(page);
      })
      .toEqual([
        "Project",
        "Security Events",
        "Detections",
        "Watchlists",
        "bad_domains",
      ]);
    expect(await litEntries(page)).toEqual(["Watchlists"]);
    await expect(page.getByText("No values on this list yet")).toBeVisible();
    await expect(page.getByTestId("watchlist-rule-snippet")).toContainText(
      "observables|expand: '%bad_domains%'",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * A watchlist's page
 * ---------------------------------------------------------------------------
 */
test.describe("a watchlist's page", () => {
  test("its settings, the selection that reads it with the rule that does, and its values with why each is there", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, VIP_USERS_PATH, { width: 1344 });
    await expect(
      page.getByText("alice.wong@acme-commerce.example"),
    ).toBeVisible({ timeout: 30000 });

    expect(await breadcrumbs(page)).toEqual([
      "Project",
      "Security Events",
      "Detections",
      "Watchlists",
      "vip_users",
    ]);
    expect(await litEntries(page)).toEqual(["Watchlists"]);

    const about: Locator = cardTitled(page, "About This List");
    await expect(about).toContainText("vip_users");
    await expect(about).toContainText("Users");
    await expect(about).toContainText("Values you keep");
    await expect(about).toContainText("3 values");

    const snippet: Locator = page.getByTestId("watchlist-rule-snippet");
    await expect(snippet).toContainText("principalUser|expand: '%vip_users%'");
    await expect(page.getByTestId("watchlist-read-by")).toHaveText(
      `Read by: ${READING_RULE} · Open Detection Rules`,
    );

    // The values, each with its note and who added it.
    await expect(page.locator("table tbody tr")).toHaveCount(3);
    const ceo: Locator = rowWith(page, "alice.wong@acme-commerce.example");
    await expect(ceo).toContainText("CEO");
    await expect(ceo).toContainText("Maya Chen");
    await expect(
      rowWith(page, "finance-admin-*@acme-commerce.example"),
    ).toContainText("The finance team's admin accounts.");

    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "watchlist-desktop", { fullPage: true });

    // Open Detection Rules goes to the rules.
    await page.getByRole("link", { name: "Open Detection Rules" }).click();
    await expect
      .poll(() => {
        return new URL(page.url()).pathname;
      })
      .toBe(DETECTION_RULES_PATH);
  });

  test("Add Value refuses a value the list cannot hold, and adds one it can", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, VIP_USERS_PATH);
    await expect(
      page.getByText("alice.wong@acme-commerce.example"),
    ).toBeVisible({ timeout: 30000 });

    await page
      .getByRole("button", { name: "Add Value", exact: true })
      .first()
      .click();
    await expect(dialog(page)).toBeVisible();

    await dialog(page).getByTestId("watchlist-value").fill("*");
    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toContainText(
      "A value of only * would match everything.",
    );
    expect(await createsOf(page, "SecurityWatchlistItem")).toEqual([]);

    await dialog(page)
      .getByTestId("watchlist-value")
      .fill("carla.mendes@acme-commerce.example");
    await dialog(page).getByTestId("watchlist-note").fill("Head of treasury");
    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toHaveCount(0);

    const [created] = await createsOf(page, "SecurityWatchlistItem");
    expect(created).toMatchObject({
      value: "carla.mendes@acme-commerce.example",
      note: "Head of treasury",
    });
    // On this list, however the form serialized the id.
    expect(JSON.stringify(created!["securityWatchlistId"])).toContain(
      VIP_USERS_ID,
    );

    await expect(page.locator("table tbody tr")).toHaveCount(4);
    // The list's count follows.
    await expect(cardTitled(page, "About This List")).toContainText("4 values");
  });

  test("Import Values shows what it is about to do, sends one request, and says what it did", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, VIP_USERS_PATH);
    await expect(
      page.getByText("alice.wong@acme-commerce.example"),
    ).toBeVisible({ timeout: 30000 });

    await openImport(page);

    // The paste box spans the dialog, in the type values are written in.
    const box: { width: number } | null = await page
      .getByTestId("watchlist-import-text")
      .boundingBox();
    const content: { width: number } | null = await page
      .getByTestId("watchlist-import-modal")
      .boundingBox();
    expect(box!.width).toBeGreaterThan(content!.width * 0.9);
    await expect(page.getByTestId("watchlist-import-text")).toHaveCSS(
      "font-family",
      /mono/i,
    );

    await page
      .getByTestId("watchlist-import-text")
      .fill(
        [
          "value,note",
          "ALICE.WONG@acme-commerce.example, CEO",
          "dana.lee@acme-commerce.example, Chief of staff",
          "dana.lee@acme-commerce.example",
          "*",
        ].join("\n"),
      );

    await expect(page.getByTestId("watchlist-import-preview")).toContainText(
      "2 values to import · 1 repeated line skipped · 1 line left out",
    );
    await expect(page.getByTestId("watchlist-import-problems")).toHaveText(
      "Line 5: * - A value of only * would match everything.",
    );
    await expect(page.getByTestId("modal-footer-submit-button")).toHaveText(
      "Import 2 Values",
    );
    await screenshot(page, "watchlist-import-desktop", { fullPage: false });

    await page.getByTestId("modal-footer-submit-button").click();

    const summary: Locator = page.getByTestId("watchlist-import-summary");
    await expect(summary).toBeVisible();
    await expect(summary.getByRole("listitem")).toHaveText([
      "1 value added",
      "1 was already on the list",
      "The list now holds 4 values.",
    ]);
    // Done is the only way out of a finished import: no Cancel beside it.
    await expect(page.getByTestId("modal-footer-close-button")).toHaveCount(0);
    await expect(page.getByTestId("modal-footer-submit-button")).toHaveText(
      "Done",
    );

    const [request] = await importRequests(page);
    expect(request).toMatchObject({
      securityWatchlistId: VIP_USERS_ID,
      mode: "add",
    });
    expect(String(request!["text"])).toContain(
      "dana.lee@acme-commerce.example",
    );

    await page.getByTestId("modal-footer-submit-button").click();
    await expect(summary).toHaveCount(0);
    await expect(rowWith(page, "dana.lee@acme-commerce.example")).toContainText(
      "Chief of staff",
    );
    await expect(page.locator("table tbody tr")).toHaveCount(4);
  });

  test("Replace the list leaves only what the import holds", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, VIP_USERS_PATH);
    await expect(
      page.getByText("alice.wong@acme-commerce.example"),
    ).toBeVisible({ timeout: 30000 });

    await openImport(page);
    await page
      .getByTestId("watchlist-import-text")
      .fill("alice.wong@acme-commerce.example\nerin.cho@acme-commerce.example");
    await page.getByText("Replace the list", { exact: true }).click();
    await page.getByTestId("modal-footer-submit-button").click();

    await expect(
      page.getByTestId("watchlist-import-summary").getByRole("listitem"),
    ).toHaveText([
      "1 value added",
      "2 values removed",
      "1 was already on the list",
      "The list now holds 2 values.",
    ]);

    const [request] = await importRequests(page);
    expect(request!["mode"]).toBe("replace");

    await page.getByTestId("modal-footer-submit-button").click();
    await expect(page.locator("table tbody tr")).toHaveCount(2);
    await expect(page.getByText("ben.ortiz@acme-commerce.example")).toHaveCount(
      0,
    );
  });

  test("a list that follows a threat intel feed shows the feed's values, never a table of its own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, C2_ADDRESSES_PATH);
    const feed: Locator = page.getByTestId("watchlist-feed-values");
    await expect(feed).toBeVisible({ timeout: 30000 });

    await expect(feed).toContainText(
      `This list follows ${FEODO_LIST}: the feed's active indicators of the list's kind are its values, kept up to date as the feed is read.`,
    );
    await expect(cardTitled(page, "Values")).toHaveCount(1);
    await expect(cardTitled(page, "Values").locator("table")).toHaveCount(0);
    await expect(
      cardTitled(page, "Values").getByRole("button", {
        name: "More options",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.getByTestId("watchlist-rule-snippet")).toContainText(
      "principalIp|expand: '%c2_addresses%'",
    );

    await screenshot(page, "watchlist-feed-desktop", { fullPage: false });

    await feed.getByText("Open Threat Intel", { exact: true }).click();
    await expect
      .poll(() => {
        return new URL(page.url()).pathname;
      })
      .toBe(THREAT_INTEL_PATH);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The line under a rule's YAML
 * ---------------------------------------------------------------------------
 */
test.describe("the line under a rule's YAML", () => {
  test("names the lists the rule reads with their values, and one the project does not have in red", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, DETECTION_RULES_PATH);
    await expect(page.getByText(READING_RULE, { exact: true })).toBeVisible({
      timeout: 30000,
    });

    await page
      .locator("table tbody tr")
      .filter({ hasText: READING_RULE })
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await expect(dialog(page)).toBeVisible();

    const line: Locator = dialog(page).getByTestId("detection-rule-watchlists");
    await expect(line).toBeVisible({ timeout: 30000 });
    await expect(line).toContainText("Reads watchlists");

    const lists: Locator = line.getByTestId("detection-rule-watchlist");
    await expect(lists).toHaveCount(2);
    await expect(lists.nth(0)).toContainText("vip_users");
    await expect(lists.nth(0)).toContainText("3 values");
    await expect(lists.nth(1)).toContainText("admin_addresses");
    await expect(lists.nth(0).getByRole("link")).toHaveAttribute(
      "href",
      VIP_USERS_PATH,
    );

    // A name the project has no list of, as it is typed.
    await dialog(page)
      .getByRole("textbox", { name: /^Sigma Rule \(YAML\)/ })
      .fill(
        "title: VIP sign-in\ndetection:\n  selection:\n    principalUser|expand: '%vip_users%'\n  admins:\n    principalUser|expand: '%board_members%'\n  condition: selection or admins\n",
      );

    const missing: Locator = line.locator('[data-missing="true"]');
    await expect(missing).toHaveCount(1);
    await expect(missing).toContainText("No watchlist named board_members");
    await expect(missing.getByRole("link")).toHaveText(
      "Create it in Watchlists",
    );

    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "watchlist-rule-line-desktop", { fullPage: false });
  });
});

/*
 * ---------------------------------------------------------------------------
 * Widths, roles, languages
 * ---------------------------------------------------------------------------
 */
test.describe("Watchlists on every screen", () => {
  test("fits a phone: the list and a list's page scroll only down", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, WATCHLISTS_PATH, { width: 390, height: 844 });
    await expect(page.getByText("vip_users").first()).toBeVisible({
      timeout: 30000,
    });
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "watchlists-phone", { fullPage: false });

    await open(page, VIP_USERS_PATH, { width: 390, height: 844 });
    await expect(
      page.getByText("alice.wong@acme-commerce.example").first(),
    ).toBeVisible({ timeout: 30000 });
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "watchlist-phone", { fullPage: false });
  });

  test("a new project starts with the common lists and an empty table", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, WATCHLISTS_PATH, { empty: true });
    const starters: Locator = page.getByTestId("watchlist-starters");
    await expect(starters).toBeVisible({ timeout: 30000 });
    await expect(starters).toContainText("VIP users");
    await expect(starters).toContainText("Critical hosts");
    await expect(starters).toContainText("Known-bad file hashes");
    await expect(starters).toContainText("Allowed admin addresses");
    await expect(page.getByText("No watchlists yet")).toBeVisible();

    await screenshot(page, "watchlists-empty-desktop", { fullPage: false });
  });

  test("a Security Viewer reads the lists and changes none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, WATCHLISTS_PATH, { role: "viewer" });
    await expect(rowWith(page, "vip_users")).toBeVisible({ timeout: 30000 });

    // The starters' Add is there, locked.
    await expect(
      page.getByTestId("watchlist-starter-add-critical-hosts"),
    ).toBeDisabled();

    await open(page, VIP_USERS_PATH, { role: "viewer" });
    await expect(
      page.getByText("alice.wong@acme-commerce.example"),
    ).toBeVisible({ timeout: 30000 });

    /*
     * Add Value and Import Values are there, locked, as every gated button
     * is: they say which permission they take, rather than vanish.
     */
    await expect(
      page.getByRole("button", { name: "Add Value", exact: true }),
    ).toBeDisabled();
    await cardTitled(page, "Values")
      .getByRole("button", { name: "More options", exact: true })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "Import Values" }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("watchlist-import-modal")).toHaveCount(0);
  });

  test("reads in the reader's language, and right to left in Persian", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, WATCHLISTS_PATH, { lang: "de" });
    await expect(rowWith(page, "vip_users")).toBeVisible({ timeout: 30000 });
    expect(await litEntries(page)).toEqual(["Beobachtungslisten"]);
    await expect(
      rowWith(page, "vip_users").getByTestId("watchlist-values-cell"),
    ).toHaveText("3 Werte");
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "watchlists-de", { fullPage: false });

    await open(page, VIP_USERS_PATH, { lang: "fa" });
    await expect(
      page.getByText("alice.wong@acme-commerce.example"),
    ).toBeVisible({ timeout: 30000 });
    // A name as rules write it reads left to right on a right-to-left page.
    await expect(page.getByTestId("watchlist-rule-snippet")).toHaveAttribute(
      "dir",
      "ltr",
    );

    // svc-* keeps its order inside a Persian sentence: s, then *, left to right.
    const isInOrder: boolean | null = await cardTitled(page, "مقدارها")
      .getByTestId("card-description")
      .evaluate((element: Element): boolean | null => {
        const walker: TreeWalker = document.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT,
        );

        for (
          let node: Node | null = walker.nextNode();
          node;
          node = walker.nextNode()
        ) {
          const text: string = node.textContent || "";
          const at: number = text.indexOf("svc-*");

          if (at < 0) {
            continue;
          }

          const range: Range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + 1);
          const first: number = range.getBoundingClientRect().left;
          range.setStart(node, at + 4);
          range.setEnd(node, at + 5);
          const star: number = range.getBoundingClientRect().left;

          return first < star;
        }

        return null;
      });
    expect(isInOrder).toBe(true);

    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "watchlist-fa", { fullPage: false });
  });
});
