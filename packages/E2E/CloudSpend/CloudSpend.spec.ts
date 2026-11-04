import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import { sideMenuAtRest } from "../SuiteHelpers/SideMenuAtRest";

/*
 * Cloud's Overview and its Spend pages, in a browser, against the offline
 * fixture (CloudSpend/Fixture): Cloud opens on an Overview of every
 * connected account - what needs attention, what the month costs, the ways
 * to spend less, the accounts and the apps in them - and Costs, Savings and
 * Budgets say what the clouds cost, how to spend less and when a month
 * costs too much. The figures are made up day by day for five accounts on
 * three clouds, and every page works them out as the server does, so the
 * pages are held to each other: the month's spend on the Overview is the
 * one Costs starts with, the one its breakdown adds up to, and the one the
 * budget over every account has spent.
 *
 * Read the way a person reads them, at a laptop's width and a phone's,
 * light and dark, in German and in Persian (right to left), with a new
 * project, a busy one, costs not read yet, and reads that fail. The fixture
 * records every read, so each test also checks nothing it does not model
 * was asked for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;
const CLOUD: string = `${DASHBOARD}/cloud`;
const COSTS: string = `${CLOUD}/costs`;
const SAVINGS: string = `${CLOUD}/savings`;
const BUDGETS: string = `${CLOUD}/budgets`;

// The five accounts, the most costly first (USD), then the others by name.
const WEB_PROD_ID: string = "81000000-0000-4000-8000-000000000001";
const DATA_LAKE_ID: string = "81000000-0000-4000-8000-000000000002";
const ANALYTICS_ID: string = "81000000-0000-4000-8000-000000000003";
const CORE_PROD_ID: string = "81000000-0000-4000-8000-000000000004";
const EU_SHOP_ID: string = "81000000-0000-4000-8000-000000000005";
const WEB_PROD_COSTS: string = `${CLOUD}/accounts/${WEB_PROD_ID}/costs`;

// The resources whose last read found something, the most urgent first.
const WEB_1_ID: string = "82000000-0000-4000-8000-000000000001";
const ORDERS_DB_ID: string = "82000000-0000-4000-8000-000000000002";
const CACHE_ID: string = "82000000-0000-4000-8000-000000000003";
// A Compute Engine instance its billing export names: well, with a cost.
const ETL_RUNNER_ID: string = "82000000-0000-4000-8000-000000000004";

const LAPTOP: { width: number; height: number } = { width: 1280, height: 900 };
const PHONE: { width: number; height: number } = { width: 390, height: 844 };

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/cloud-spend-ui",
);

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        `../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
}

// The Dashboard's own words, as the fixture draws them with ?lang=de|fa.
const GERMAN: Record<string, string> = readLocale("de");
const PERSIAN: Record<string, string> = readLocale("fa");

function german(english: string): string {
  const word: string | undefined = GERMAN[english];
  expect(word, `German for "${english}"`).toBeTruthy();
  return word!;
}

function persian(english: string): string {
  const word: string | undefined = PERSIAN[english];
  expect(word, `Persian for "${english}"`).toBeTruthy();
  return word!;
}

interface Recorded {
  listRequests: Array<{ modelName: string; query: Record<string, unknown> }>;
  countRequests: Array<{ modelName: string; query: Record<string, unknown> }>;
  aggregateRequests: Array<{
    modelName: string;
    interval: string | undefined;
    groupBy: Array<string>;
    query: Record<string, unknown>;
  }>;
  creates: Array<{ modelName: string; data: Record<string, unknown> }>;
  updates: Array<{
    modelName: string;
    id: string;
    data: Record<string, unknown>;
  }>;
  unhandled: Array<Record<string, unknown>>;
}

const pageErrors: Map<Page, Array<string>> = new Map();
const outsideRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const outside: Array<string> = [];
  pageErrors.set(page, errors);
  outsideRequests.set(page, outside);

  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });

  // Nothing may leave the fixture: no CDN, no telemetry, no real API.
  await page.route("**/*", async (route: Route) => {
    const url: URL = new URL(route.request().url());

    if (url.hostname === "127.0.0.1") {
      await route.continue();
      return;
    }

    outside.push(url.toString());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
  expect(outsideRequests.get(page) || []).toEqual([]);

  if (!page.isClosed()) {
    const unhandled: Array<Record<string, unknown>> = await page.evaluate(
      (): Array<Record<string, unknown>> => {
        const fixture: Recorded | undefined = (
          window as unknown as { __cloudSpendFixture?: Recorded }
        ).__cloudSpendFixture;
        return fixture ? fixture.unhandled : [];
      },
    );

    // Every read the page made is one the fixture answers as the server does.
    expect(unhandled, "reads the fixture does not model").toEqual([]);
  }
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fsPromises.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function recorded(page: Page): Promise<Recorded> {
  return await page.evaluate((): Recorded => {
    return (window as unknown as { __cloudSpendFixture: Recorded })
      .__cloudSpendFixture;
  });
}

function withQuery(address: string, query: string): string {
  if (!query) {
    return address;
  }
  return `${address}${address.includes("?") ? "&" : "?"}${query}`;
}

/*
 * A page of the fixture, once its heading is drawn in the Dashboard's font
 * and its side menu is at rest.
 */
async function open(
  page: Page,
  address: string,
  query: string = "",
): Promise<void> {
  await page.goto(withQuery(address, query));
  await expect(pageHeading(page)).not.toBeEmpty({ timeout: 60000 });
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await sideMenuAtRest(page);
}

function pageHeading(page: Page): Locator {
  return page.getByRole("heading", { level: 1 }).first();
}

// The trail: its label is the same in every language.
function trail(page: Page): Locator {
  return page.getByRole("navigation", { name: "Breadcrumb" });
}

async function trailOf(page: Page): Promise<Array<string>> {
  return await trail(page)
    .locator("ol > li")
    .evaluateAll((items: Array<Element>): Array<string> => {
      return items
        .map((item: Element): string => {
          return (item.textContent || "").trim();
        })
        .filter((text: string): boolean => {
          return text.length > 0;
        });
    });
}

// The desktop menu, whatever the reader's language calls it.
function desktopMenu(page: Page): Locator {
  return page.locator("aside[role='navigation']");
}

function litEntry(page: Page): Locator {
  return desktopMenu(page).locator("[aria-current='page']");
}

// A strip of tiles, by the strip's test id.
function strip(page: Page, testId: string): Locator {
  return page.getByTestId(testId);
}

function tileOf(page: Page, stripId: string, key: string): Locator {
  return strip(page, stripId).locator(
    `[data-testid='cloud-stat-tile'][data-key='${key}']`,
  );
}

async function tileValue(
  page: Page,
  stripId: string,
  key: string,
): Promise<string> {
  const value: Locator = tileOf(page, stripId, key).getByTestId(
    "cloud-stat-tile-value",
  );
  await expect(value).toBeVisible();
  return ((await value.textContent()) || "").trim();
}

function tileSublabel(page: Page, stripId: string, key: string): Locator {
  return tileOf(page, stripId, key).getByTestId("cloud-stat-tile-sublabel");
}

// The link a tile is drawn in, when it leads somewhere.
function tileLink(page: Page, stripId: string, key: string): Locator {
  return strip(page, stripId)
    .getByTestId("cloud-stat-tile-link")
    .filter({ has: page.locator(`[data-key='${key}']`) });
}

// What is not a digit or a decimal point, in an English amount.
const NOT_AN_AMOUNT: RegExp = /[^0-9.]/g;
// The numbers in a CSS colour, "rgb(16, 185, 129)".
const COLOUR_PARTS: RegExp = /\d+(\.\d+)?/g;
// An amount in dollars as the Dashboard writes it in English.
const ENGLISH_DOLLARS: RegExp = /^\$[\d,]+(\.\d\d)?$/;
// An amount in dollars as German writes it: "1.415 $", "869,41 $".
const GERMAN_DOLLARS: RegExp = /^[\d.]+(,\d\d)?\s\$$/;
// How the month compares with last month by now, or that it is the first days.
const MONTH_AGAINST_LAST: RegExp =
  /^(\d+% (more|less) than last month by now|The same as last month by now|So far this month)$/;

// "$1,415" -> 1415, "$869.41" -> 869.41: an amount as a number.
function amountOf(text: string): number {
  return Number(text.replace(NOT_AN_AMOUNT, ""));
}

// The rows of "Where the money goes", as [name, amount] in their order.
async function breakdownRows(page: Page): Promise<Array<[string, string]>> {
  const card: Locator = page.getByTestId("cloud-cost-breakdown");
  await expect(card.getByTestId("cloud-cost-breakdown-loading")).toHaveCount(0);
  return await card
    .locator("ul > li")
    .evaluateAll((rows: Array<Element>): Array<[string, string]> => {
      return rows.map((row: Element): [string, string] => {
        const name: Element | null = row.querySelector(".truncate");
        const amount: Element | null = row.querySelector(".tabular-nums");
        return [
          (name?.textContent || "").trim(),
          (amount?.textContent || "").trim(),
        ];
      });
    });
}

function breakdownTotal(page: Page): Locator {
  return page.getByTestId("cloud-cost-breakdown-total");
}

/*
 * The daily chart's drawn bars: a finished day's, and the lighter one of a
 * day its cloud is still reporting. The two are stacked series, and each
 * day is in one of them only: the other's bar that day has no height.
 */
async function dailyBars(
  page: Page,
): Promise<{ finished: number; partlyReported: number }> {
  const chart: Locator = page.getByTestId("cloud-daily-spend-chart");
  await expect(chart.locator(".recharts-bar")).toHaveCount(2);
  const drawn: Array<number> = await chart
    .locator(".recharts-bar")
    .evaluateAll((layers: Array<Element>): Array<number> => {
      return layers.map((layer: Element): number => {
        return Array.from(
          layer.querySelectorAll(".recharts-bar-rectangle path"),
        ).filter((bar: Element): boolean => {
          return bar.getBoundingClientRect().height > 0;
        }).length;
      });
    });
  return { finished: drawn[0] || 0, partlyReported: drawn[1] || 0 };
}

// The breakdown's choices: by what, and over which period.
function dimensions(page: Page): Locator {
  return page.getByRole("radiogroup", { name: "Break down by" });
}

function periods(page: Page): Locator {
  return page.getByRole("radiogroup", { name: "Period" });
}

function dimension(page: Page, value: string): Locator {
  return page.getByTestId(`cloud-cost-breakdown-dimension-${value}`);
}

function period(page: Page, value: string): Locator {
  return page.getByTestId(`cloud-cost-breakdown-period-${value}`);
}

// A list's row: its table row, or on a phone its card.
function tableRow(page: Page, tableId: string, text: string): Locator {
  return page
    .locator(`#${tableId}-body > tr, #${tableId}-body > div`)
    .filter({ hasText: text });
}

/*
 * How light the surface an element is drawn on is, 0 (black) to 1 (white):
 * its own background, or that of the nearest element under it that has one.
 */
async function surfaceLightnessOf(locator: Locator): Promise<number> {
  return await locator.evaluate(
    (element: Element, colourParts: string): number => {
      let node: Element | null = element;
      while (node) {
        const parts: Array<number> = (
          getComputedStyle(node).backgroundColor.match(
            new RegExp(colourParts, "g"),
          ) || []
        ).map(Number);
        // rgba(0, 0, 0, 0) is no surface: look under it.
        if (parts.length >= 3 && (parts.length < 4 || parts[3]! > 0)) {
          const [red, green, blue] = parts as [number, number, number];
          return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
        }
        node = node.parentElement;
      }
      return 1;
    },
    COLOUR_PARTS.source,
  );
}

/*
 * ---------------------------------------------------------------------------
 * The Overview
 * ---------------------------------------------------------------------------
 */
test.describe("the Overview", () => {
  test("opens Cloud: the accounts, their resources, what needs attention and what the month costs, each a click from its page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, CLOUD);

    await expect(pageHeading(page)).toHaveText("Cloud");
    expect(await trailOf(page)).toEqual(["Project", "Cloud", "Overview"]);
    await expect(litEntry(page)).toHaveCount(1);
    await expect(litEntry(page)).toHaveAttribute("href", CLOUD);
    await expect(litEntry(page)).toHaveText("Overview");

    /*
     * The strip: five accounts, every one read; 493 resources in them;
     * three that need attention, one of them unhealthy; and the month so
     * far - each a link to its list.
     */
    const overview: string = "cloud-overview-strip";
    await expect(
      strip(page, overview).getByTestId("cloud-stat-tile"),
    ).toHaveCount(4);
    expect(await tileValue(page, overview, "accounts")).toBe("5");
    await expect(tileSublabel(page, overview, "accounts")).toHaveText(
      "All reading",
    );
    expect(await tileValue(page, overview, "resources")).toBe("493");
    expect(await tileValue(page, overview, "attention")).toBe("3");
    await expect(tileSublabel(page, overview, "attention")).toHaveText(
      "1 unhealthy",
    );
    const spend: string = await tileValue(page, overview, "spend");
    expect(spend).toMatch(ENGLISH_DOLLARS);
    // Over the same full days as last month: never "less" for a half-read day.
    await expect(tileSublabel(page, overview, "spend")).toHaveText(
      MONTH_AGAINST_LAST,
    );
    await expect(tileLink(page, overview, "accounts")).toHaveAttribute(
      "href",
      `${CLOUD}/accounts`,
    );
    await expect(tileLink(page, overview, "resources")).toHaveAttribute(
      "href",
      `${CLOUD}/resources`,
    );
    await expect(tileLink(page, overview, "spend")).toHaveAttribute(
      "href",
      COSTS,
    );

    /*
     * Needs attention: every account's resources whose key metrics show
     * something wrong, the most urgent first, each with why and a step to
     * its page.
     */
    const attention: Locator = page.getByTestId("cloud-overview-attention");
    await expect(
      attention.getByTestId("cloud-overview-attention-item"),
    ).toHaveCount(3);
    await expect(
      attention.getByTestId("cloud-overview-attention-name"),
    ).toHaveText(["web-1", "orders-db", "sessions-cache"]);
    await expect(
      attention.getByTestId("cloud-overview-attention-summary"),
    ).toContainText("1 critical");
    await expect(
      attention.getByTestId("cloud-overview-attention-summary"),
    ).toContainText("2 to look at");
    const items: Locator = attention.getByTestId(
      "cloud-overview-attention-item",
    );
    await expect(items.nth(0)).toContainText("Failing its status checks");
    await expect(items.nth(1)).toContainText("92% full");
    await expect(items.nth(1)).toContainText("CPU at 97%");
    await expect(items.nth(2)).toContainText("CPU at 99%");
    for (const [index, id] of [WEB_1_ID, ORDERS_DB_ID, CACHE_ID].entries()) {
      await expect(items.nth(index).locator("a").first()).toHaveAttribute(
        "href",
        `${CLOUD}/${id}`,
      );
    }

    /*
     * Spend: the month so far - the strip's figure - where it is heading
     * and last month; the services that cost the most this month.
     */
    const spendCard: Locator = page.getByTestId("cloud-spend-card");
    await expect(spendCard).toHaveAttribute("data-state", "read");
    await expect(spendCard).toContainText(spend);
    const services: Locator = spendCard
      .getByTestId("cloud-spend-services")
      .locator("li");
    await expect(services).toHaveCount(5);
    await expect(services.nth(0)).toContainText(
      "Amazon Elastic Compute Cloud - Compute",
    );
    await expect(services.nth(1)).toContainText(
      "Amazon Simple Storage Service",
    );
    await expect(services.nth(2)).toContainText(
      "Amazon Relational Database Service",
    );
    await expect(
      page.getByRole("link", { name: "View costs" }),
    ).toHaveAttribute("href", COSTS);

    // Ways to spend less: what the clouds' recommenders say, the largest first.
    const savingsCard: Locator = page.getByTestId("cloud-savings-card");
    await expect(savingsCard).toHaveAttribute("data-state", "found");
    await expect(savingsCard).toContainText("Up to $1,279 a month");
    await expect(savingsCard).toContainText("7 recommendations");
    const topSavings: Locator = savingsCard.getByTestId(
      "cloud-savings-top-row",
    );
    await expect(topSavings).toHaveCount(3);
    await expect(topSavings.nth(0)).toContainText("Rightsize");
    await expect(topSavings.nth(0)).toContainText("orders-db");
    await expect(topSavings.nth(0)).toContainText("$410.50");
    await expect(topSavings.nth(1)).toContainText("Purchase Savings Plans");
    await expect(topSavings.nth(1)).toContainText("$300.00");
    await expect(topSavings.nth(2)).toContainText("web-1");
    await expect(topSavings.nth(2)).toContainText("$280.32");
    await expect(
      page.getByRole("link", { name: "View all savings" }),
    ).toHaveAttribute("href", SAVINGS);

    /*
     * Accounts: the most costly first, in the currency most of them are
     * billed in; one that may not read its costs says so; one billed in
     * euros shows its own.
     */
    const accounts: Locator = page.getByTestId("cloud-accounts-card-row");
    await expect(accounts).toHaveCount(5);
    const names: Array<string> = await accounts.evaluateAll(
      (rows: Array<Element>): Array<string> => {
        return rows.map((row: Element): string => {
          return (row.querySelector("a")?.textContent || "").trim();
        });
      },
    );
    expect(names).toEqual([
      "web-prod",
      "data-lake",
      "analytics",
      "core-prod",
      "eu-shop",
    ]);
    const amounts: Array<number> = [];
    for (const index of [0, 1, 2]) {
      amounts.push(
        amountOf(
          (await accounts
            .nth(index)
            .getByTestId("cloud-accounts-card-spend")
            .textContent()) || "",
        ),
      );
    }
    expect(amounts[0]!).toBeGreaterThan(amounts[1]!);
    expect(amounts[1]!).toBeGreaterThan(amounts[2]!);
    await expect(
      accounts.nth(3).getByTestId("cloud-accounts-card-spend"),
    ).toHaveText("Needs permission");
    await expect(
      accounts.nth(4).getByTestId("cloud-accounts-card-spend"),
    ).toContainText("€");
    for (const [index, id] of [
      WEB_PROD_ID,
      DATA_LAKE_ID,
      ANALYTICS_ID,
      CORE_PROD_ID,
      EU_SHOP_ID,
    ].entries()) {
      await expect(accounts.nth(index).locator("a").first()).toHaveAttribute(
        "href",
        `${CLOUD}/accounts/${id}`,
      );
    }

    /*
     * App Platforms: the environments in these accounts - not the one of
     * an account no connection here reads - and their apps, where they
     * live now.
     */
    const appPlatforms: Locator = page.getByTestId("cloud-app-platforms-card");
    await expect(
      appPlatforms.getByTestId("cloud-app-platforms-environments"),
    ).toHaveText("2 environments");
    await expect(
      appPlatforms.getByTestId("cloud-app-platforms-environments"),
    ).toHaveAttribute("href", `${DASHBOARD}/app-platforms/environments`);
    await expect(
      appPlatforms.getByTestId("cloud-app-platforms-apps"),
    ).toHaveText("4 apps");
    await expect(
      appPlatforms.getByTestId("cloud-app-platforms-apps"),
    ).toHaveAttribute("href", `${DASHBOARD}/app-platforms/apps`);
    // Those lists hold every environment: the one Cloud does not read is said.
    await expect(
      appPlatforms.getByTestId("cloud-app-platforms-other-environments"),
    ).toHaveText(
      "App Platforms also lists 1 environment, with its apps, from an account not connected to Cloud.",
    );

    /*
     * Needs attention reads only the resources a read found something
     * wrong with, of Cloud's own kind - never an App Platforms environment.
     */
    const attentionReads: Array<Record<string, unknown>> = (
      await recorded(page)
    ).listRequests
      .filter((request: { modelName: string }): boolean => {
        return request.modelName === "CloudResource";
      })
      .map((request: { query: Record<string, unknown> }) => {
        return request.query;
      })
      .filter((query: Record<string, unknown>): boolean => {
        return query["cloudResourceKind"] === "resource";
      });
    expect(attentionReads).toHaveLength(1);
    expect(attentionReads[0]!["healthSeverity"]).toEqual({ notNull: true });
    expect(attentionReads[0]!["isArchived"]).toBe(false);

    await screenshot(page, "cloud-overview-1280");
  });

  test("on a phone: the tiles two by two, each account's spend under its name, and nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await open(page, CLOUD);

    const tiles: Locator = strip(page, "cloud-overview-strip").getByTestId(
      "cloud-stat-tile",
    );
    await expect(tiles).toHaveCount(4);
    const tileBoxes: Array<FrameBox> = await boxesInOneFrame([
      tiles.nth(0),
      tiles.nth(1),
      tiles.nth(2),
      tiles.nth(3),
    ]);
    expect(Math.round(tileBoxes[0]!.y)).toBe(Math.round(tileBoxes[1]!.y));
    expect(tileBoxes[2]!.y).toBeGreaterThan(tileBoxes[0]!.y);
    expect(Math.round(tileBoxes[2]!.y)).toBe(Math.round(tileBoxes[3]!.y));

    // An account's spend goes under its name, where the name starts.
    const first: Locator = page.getByTestId("cloud-accounts-card-row").first();
    const [nameBox, spendBox] = await boxesInOneFrame([
      first.locator("a").first(),
      first.getByTestId("cloud-accounts-card-spend"),
    ]);
    expect(spendBox!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height);
    expect(Math.abs(spendBox!.x - nameBox!.x)).toBeLessThanOrEqual(1);

    // Spend and Ways to spend less one under the other.
    const [spendCard, savingsCard] = await boxesInOneFrame([
      page.getByTestId("cloud-spend-card"),
      page.getByTestId("cloud-savings-card"),
    ]);
    expect(savingsCard!.y).toBeGreaterThan(spendCard!.y + spendCard!.height);

    await expectNoSidewaysScroll(page);

    // The side menu is behind its button, which names the page.
    const toggle: Locator = page.getByTestId("mobile-sidemenu-toggle");
    await expect(toggle).toContainText("Overview");
    await screenshot(page, "cloud-overview-390");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel: Locator = page.getByRole("navigation", {
      name: "Main navigation",
    });
    await expect(panel.getByRole("link", { name: "Costs" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Savings" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Budgets" })).toBeVisible();
    await expect(panel.locator("[aria-current='page']")).toHaveText("Overview");
  });

  test("dark: the page and its cards are drawn dark, and the money keeps its colour", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, CLOUD, "theme=dark");

    expect(await surfaceLightnessOf(page.locator("body"))).toBeLessThan(0.15);
    for (const testId of [
      "cloud-spend-card",
      "cloud-savings-card",
      "cloud-accounts-card",
      "cloud-overview-attention",
    ]) {
      expect(
        await surfaceLightnessOf(page.getByTestId(testId)),
        testId,
      ).toBeLessThan(0.25);
    }
    for (const tile of await strip(page, "cloud-overview-strip")
      .getByTestId("cloud-stat-tile")
      .all()) {
      expect(await surfaceLightnessOf(tile)).toBeLessThan(0.25);
    }

    // The savings figure stays green on the dark card: green well over red.
    const colour: string = await page
      .getByTestId("cloud-savings-card")
      .locator(".text-emerald-700, .text-emerald-600")
      .first()
      .evaluate((element: Element): string => {
        return getComputedStyle(element).color;
      });
    const [red, green] = (colour.match(COLOUR_PARTS) || []).map(Number) as [
      number,
      number,
    ];
    expect(green - red).toBeGreaterThan(60);

    await screenshot(page, "cloud-overview-1280-dark");
  });

  test("in German: the Dashboard's German words, the money as Germans write it, nothing cut", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, CLOUD, "lang=de");

    expect(await trailOf(page)).toEqual([
      german("Project"),
      german("Cloud"),
      german("Overview"),
    ]);
    await expect(litEntry(page)).toHaveText(german("Overview"));
    await expect(
      desktopMenu(page).getByRole("link", { name: german("Costs") }),
    ).toHaveAttribute("href", COSTS);
    await expect(
      desktopMenu(page).getByRole("link", { name: german("Savings") }),
    ).toHaveAttribute("href", SAVINGS);
    await expect(
      desktopMenu(page).getByRole("link", { name: german("Budgets") }),
    ).toHaveAttribute("href", BUDGETS);
    await expect(page.getByTestId("cloud-spend-card")).toContainText(
      german("So far this month"),
    );

    // German money: the dollar sign after, a point between thousands.
    const spend: string = await tileValue(
      page,
      "cloud-overview-strip",
      "spend",
    );
    expect(spend).toMatch(GERMAN_DOLLARS);
    await expect(page.getByTestId("cloud-savings-card")).toContainText(
      "1.279 $",
    );

    /*
     * #5646's review: a long word that fits a line of its own moves there
     * whole - "ERFORDERT / AUFMERKSAMKEIT", never "AUFMERK- / SAMKEIT" -
     * each (i) is on its title's last line, never on a line of its own,
     * and the four values start on one line however many lines a title
     * takes.
     */
    const attention: Locator = tileOf(
      page,
      "cloud-overview-strip",
      "attention",
    );
    const longWord: Locator = attention
      .getByTestId("cloud-stat-tile-title")
      .locator("span.inline-block");
    await expect(longWord).toHaveText(german("Needs attention").split(" ")[1]!);
    const [wordBox, titleBox] = await boxesInOneFrame([
      longWord,
      attention.getByTestId("cloud-stat-tile-title"),
    ]);
    // One line: the word whole, no hyphen.
    expect(wordBox!.height).toBeLessThanOrEqual(17);
    expect(wordBox!.y + wordBox!.height).toBeGreaterThanOrEqual(
      titleBox!.y + titleBox!.height - 17,
    );
    for (const key of ["accounts", "resources", "attention", "spend"]) {
      const title: Locator = tileOf(
        page,
        "cloud-overview-strip",
        key,
      ).getByTestId("cloud-stat-tile-title");
      const [info, words] = await boxesInOneFrame([
        title.getByRole("button"),
        title,
      ]);
      // The (i) sits on the title's last line.
      expect(info!.y, key).toBeGreaterThanOrEqual(
        words!.y + words!.height - 17,
      );
    }
    const values: Array<FrameBox> = await boxesInOneFrame(
      ["accounts", "resources", "attention", "spend"].map(
        (key: string): Locator => {
          return tileOf(page, "cloud-overview-strip", key).getByTestId(
            "cloud-stat-tile-value",
          );
        },
      ),
    );
    for (const value of values) {
      expect(Math.round(value.y)).toBe(Math.round(values[0]!.y));
    }

    // What a way to spend less asks, in German.
    await expect(
      page.getByTestId("cloud-savings-top-row").first(),
    ).toContainText(german("Rightsize"));

    // Long German titles wrap inside their tiles; none runs out of it.
    for (const tile of await strip(page, "cloud-overview-strip")
      .getByTestId("cloud-stat-tile")
      .all()) {
      const fits: boolean = await tile.evaluate((element: Element): boolean => {
        const box: DOMRect = element.getBoundingClientRect();
        return Array.from(element.querySelectorAll("span, div")).every(
          (part: Element): boolean => {
            const inner: DOMRect = part.getBoundingClientRect();
            return (
              inner.width === 0 ||
              (inner.left >= box.left - 0.5 && inner.right <= box.right + 0.5)
            );
          },
        );
      });
      expect(fits).toBe(true);
    }

    await expectNoSidewaysScroll(page);
    await screenshot(page, "cloud-overview-1280-de");
  });

  test("in Persian: right to left, Persian digits, and an English service name keeps its start", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await open(page, CLOUD, "lang=fa");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(await trailOf(page)).toEqual([
      persian("Project"),
      persian("Cloud"),
      persian("Overview"),
    ]);
    expect(await tileValue(page, "cloud-overview-strip", "accounts")).toBe("۵");

    /*
     * The costliest service is wider than a phone's row: cut at its end,
     * in its own direction, it still says "Amazon" - never "…n Elastic".
     */
    const name: Locator = page
      .getByTestId("cloud-spend-services")
      .locator(".truncate")
      .first();
    await expect(name).toContainText("Amazon Elastic Compute Cloud");
    const reading: { direction: string; startVisible: boolean } =
      await name.evaluate(
        (element: Element): { direction: string; startVisible: boolean } => {
          const box: DOMRect = element.getBoundingClientRect();
          const walker: TreeWalker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
          );
          const node: Node | null = walker.nextNode();
          const range: Range = document.createRange();
          range.setStart(node!, 0);
          range.setEnd(node!, "Amazon".length);
          const word: DOMRect = range.getBoundingClientRect();
          return {
            direction: getComputedStyle(element).direction,
            startVisible:
              word.left >= box.left - 0.5 && word.right <= box.right + 0.5,
          };
        },
      );
    expect(reading).toEqual({ direction: "ltr", startVisible: true });

    await expectNoSidewaysScroll(page);
    await screenshot(page, "cloud-overview-390-fa");
  });

  test("a project with no cloud account sees what Cloud gives, and the one step to connect one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, CLOUD, "state=empty");

    const connect: Locator = page.getByRole("button", {
      name: "Connect a cloud account",
    });
    await expect(connect).toBeVisible();
    await expect(connect).toBeEnabled();
    await expect(page.getByTestId("cloud-overview-strip")).toHaveCount(0);
    await expect(page.getByTestId("cloud-spend-card")).toHaveCount(0);
    await screenshot(page, "cloud-overview-1280-empty");

    // The Spend pages lead there too, rather than saying nothing costs anything.
    await desktopMenu(page).getByRole("link", { name: "Costs" }).click();
    await expect(page).toHaveURL(COSTS);
    await expect(page.getByTestId("cloud-costs-strip")).toHaveCount(0);
    await expect(page.getByTestId("cloud-connect-callout")).toBeVisible();
    await expectNoSidewaysScroll(page);
  });

  test("a read of the accounts that fails says so, and Refresh reads them again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto(withQuery(CLOUD, "fail=accounts"));

    await expect(
      page.getByText("The server took too long to answer. Try again."),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("cloud-overview-strip")).toHaveCount(0);
    await screenshot(page, "cloud-overview-1280-failed");

    await page.getByTestId("refresh-button").click();
    await expect(
      strip(page, "cloud-overview-strip").getByTestId("cloud-stat-tile"),
    ).toHaveCount(4);
    expect(await tileValue(page, "cloud-overview-strip", "accounts")).toBe("5");
  });

  test("before any cost is read, nothing reads as costing nothing: each says it is not read yet", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, CLOUD, "state=unread");

    expect(await tileValue(page, "cloud-overview-strip", "spend")).toBe("—");
    await expect(
      tileSublabel(page, "cloud-overview-strip", "spend"),
    ).toHaveText("Costs not read yet");
    await expect(page.getByTestId("cloud-spend-card")).toHaveAttribute(
      "data-state",
      "not-read",
    );
    await expect(page.getByTestId("cloud-savings-card")).not.toHaveAttribute(
      "data-state",
      "found",
    );
    await expect(page.getByTestId("cloud-savings-card")).not.toContainText(
      "$0.00",
    );
    /*
     * An account its connection reads whose costs are not read yet says so
     * at its row's end: never an empty end, which reads as costing nothing.
     */
    const accountEnd: (name: string) => Locator = (name: string): Locator => {
      return page
        .getByTestId("cloud-accounts-card-row")
        .filter({ hasText: name })
        .getByTestId("cloud-accounts-card-spend");
    };
    await expect(accountEnd("data-lake")).toHaveText("Costs not read yet");
    await expect(accountEnd("eu-shop")).toHaveText("Costs not read yet");
    await expect(accountEnd("core-prod")).toHaveText("Needs permission");
    await screenshot(page, "cloud-overview-1280-unread");

    // Costs says what each cloud of the accounts needs, with its guide.
    await desktopMenu(page).getByRole("link", { name: "Costs" }).click();
    const notRead: Locator = page.getByTestId("cloud-costs-not-read");
    await expect(notRead).toBeVisible();
    const steps: Locator = notRead.getByTestId("cloud-cost-setup-step");
    await expect(steps).toHaveCount(3);
    await expect(notRead).toContainText("Cost Explorer");
    await expect(notRead).toContainText("BigQuery");
    for (const [index, anchor] of [
      "amazon-web-services",
      "microsoft-azure",
      "google-cloud",
    ].entries()) {
      const href: string =
        (await steps.nth(index).locator("a").first().getAttribute("href")) ||
        "";
      const url: URL = new URL(href);
      expect(url.pathname).toBe("/docs/telemetry/cloud-costs");
      expect(url.hash).toBe(`#${anchor}`);
    }

    // Each account not read is named, with why.
    const gaps: Locator = page.getByTestId("cloud-cost-gap");
    await expect(gaps.filter({ hasText: "web-prod" })).toHaveAttribute(
      "data-reason",
      "not-set-up",
    );
    await expect(gaps.filter({ hasText: "core-prod" })).toHaveAttribute(
      "data-reason",
      "not-allowed",
    );
    await expect(gaps.filter({ hasText: "data-lake" })).toHaveAttribute(
      "data-reason",
      "waiting",
    );
    await screenshot(page, "cloud-costs-1280-unread");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Costs
 * ---------------------------------------------------------------------------
 */
test.describe("Costs", () => {
  test("the month so far, where it is heading, each of the last 30 days and where the money goes - the Overview's figures", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, CLOUD);
    const overviewSpend: string = await tileValue(
      page,
      "cloud-overview-strip",
      "spend",
    );

    // From the Overview's Spend card, as a person goes.
    await page.getByRole("link", { name: "View costs" }).click();
    await expect(page).toHaveURL(COSTS);
    await sideMenuAtRest(page);
    expect(await trailOf(page)).toEqual(["Project", "Cloud", "Costs"]);
    await expect(litEntry(page)).toHaveText("Costs");

    const costs: string = "cloud-costs-strip";
    await expect(strip(page, costs).getByTestId("cloud-stat-tile")).toHaveCount(
      4,
    );
    expect(await tileValue(page, costs, "spend")).toBe(overviewSpend);
    await expect(tileSublabel(page, costs, "projected")).toHaveText(
      "At the last week's pace",
    );
    const projected: number = amountOf(
      await tileValue(page, costs, "projected"),
    );
    expect(projected).toBeGreaterThanOrEqual(amountOf(overviewSpend));
    const lastMonth: string = await tileValue(page, costs, "last-month");
    expect(await tileValue(page, costs, "savings")).toBe("$1,279");
    await expect(tileSublabel(page, costs, "savings")).toHaveText(
      "7 recommendations",
    );
    await expect(tileLink(page, costs, "savings")).toHaveAttribute(
      "href",
      SAVINGS,
    );

    /*
     * Daily spend: a bar for each of the last 30 days - the newest, which
     * its cloud is still reporting, lighter and named in the legend.
     */
    expect(await dailyBars(page)).toEqual({ finished: 29, partlyReported: 1 });
    await expect(
      page
        .getByTestId("cloud-daily-spend-chart")
        .locator(".recharts-legend-wrapper"),
    ).toContainText("Still being reported");

    /*
     * Where the money goes, this month by service: the month so far in
     * all - the strip's figure - the costliest first, ten shown.
     */
    await expect(dimension(page, "service")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(period(page, "this-month")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(breakdownTotal(page)).toHaveText(`${overviewSpend} in all`);
    let rows: Array<[string, string]> = await breakdownRows(page);
    expect(rows).toHaveLength(10);
    expect(
      rows.slice(0, 3).map((row: [string, string]) => {
        return row[0];
      }),
    ).toEqual([
      "Amazon Elastic Compute Cloud - Compute",
      "Amazon Simple Storage Service",
      "Amazon Relational Database Service",
    ]);
    const sorted: Array<number> = rows.map((row: [string, string]) => {
      return amountOf(row[1]);
    });
    expect(sorted).toEqual(
      [...sorted].sort((a: number, b: number) => {
        return b - a;
      }),
    );
    const toggle: Locator = page.getByTestId("cloud-cost-breakdown-toggle");
    await expect(toggle).toHaveText("Show 1 more");
    await toggle.click();
    expect(await breakdownRows(page)).toHaveLength(11);
    await expect(toggle).toHaveText("Show less");

    // Last month: its total is the strip's last month, in full.
    await period(page, "last-month").click();
    await expect(breakdownTotal(page)).toHaveText(`${lastMonth} in all`);

    // By Region: a cost with no Region (CloudFront's) says so.
    await period(page, "this-month").click();
    await dimension(page, "region").click();
    rows = await breakdownRows(page);
    expect(
      rows.map((row: [string, string]) => {
        return row[0];
      }),
    ).toEqual([
      "us-east-1",
      "us-west-2",
      "europe-west1",
      "No Region",
      "eu-west-1",
    ]);

    // By account: the three billed in dollars, each a link to its Costs.
    await dimension(page, "cloudAccountId").click();
    rows = await breakdownRows(page);
    expect(
      rows.map((row: [string, string]) => {
        return row[0];
      }),
    ).toEqual(["web-prod", "data-lake", "analytics"]);
    await expect(
      page
        .getByTestId("cloud-cost-breakdown")
        .getByRole("link", { name: "web-prod" }),
    ).toHaveAttribute("href", WEB_PROD_COSTS);

    /*
     * By resource: what a billing export names - Google Cloud's here - and
     * the rest as not billed to one, with a line on why AWS names none.
     */
    await dimension(page, "resourceId").click();
    rows = await breakdownRows(page);
    expect(rows[0]![0]).toBe("Not billed to a resource");
    expect(
      rows.map((row: [string, string]) => {
        return row[0];
      }),
    ).toEqual(expect.arrayContaining(["etl-runner-1", "acme-analytics-raw"]));
    await expect(page.getByTestId("cloud-cost-breakdown")).toContainText(
      "AWS Cost Explorer says the service and Region only.",
    );

    /*
     * The accounts left out of these figures, with why: one may not read
     * its costs (the cloud's own words, and what to do), one is billed in
     * euros - read, so the card says left out, not "not read".
     */
    await expect(
      page
        .getByTestId("card")
        .filter({ has: page.getByTestId("cloud-costs-gaps") }),
    ).toContainText("Accounts left out");
    const gaps: Locator = page
      .getByTestId("cloud-costs-gaps")
      .getByTestId("cloud-cost-gap");
    await expect(gaps).toHaveCount(2);
    await expect(gaps.nth(0)).toHaveAttribute("data-reason", "not-allowed");
    await expect(gaps.nth(0)).toContainText("core-prod");
    await expect(gaps.nth(0)).toContainText("Needs permission");
    await expect(
      gaps.nth(0).getByTestId("cloud-cost-gap-message"),
    ).toContainText("Microsoft.CostManagement/query/action");
    await expect(gaps.nth(0)).toContainText("Cost Management Reader");
    const guide: URL = new URL(
      (await gaps
        .nth(0)
        .getByRole("link", { name: "Read the guide" })
        .getAttribute("href")) || "",
    );
    expect(guide.pathname).toBe("/docs/telemetry/cloud-costs");
    expect(guide.hash).toBe("#microsoft-azure");
    await expect(gaps.nth(1)).toHaveAttribute("data-reason", "currency");
    await expect(gaps.nth(1)).toContainText("eu-shop");
    await expect(gaps.nth(1)).toContainText("Billed in EUR");

    // Every sum asked for is in dollars, of the dollar accounts only.
    for (const request of (await recorded(page)).aggregateRequests) {
      expect(request.modelName).toBe("CloudCostV1");
      expect(request.query["currency"]).toBe("USD");
    }

    await screenshot(page, "cloud-costs-1280");
  });

  test("an account's Costs: its own month, its own days, its services and its own ways to spend less", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, CLOUD);
    const accountSpend: string = (
      (await page
        .getByTestId("cloud-accounts-card-row")
        .filter({ hasText: "web-prod" })
        .getByTestId("cloud-accounts-card-spend")
        .locator(".tabular-nums")
        .textContent()) || ""
    ).trim();

    await open(page, WEB_PROD_COSTS);
    await expect(pageHeading(page)).toHaveText("Cloud Account - web-prod");
    expect(await trailOf(page)).toEqual([
      "Project",
      "Cloud",
      "Accounts",
      "web-prod",
      "Costs",
    ]);
    await expect(litEntry(page)).toHaveText("Costs");

    expect(await tileValue(page, "cloud-costs-strip", "spend")).toBe(
      accountSpend,
    );
    expect(await tileValue(page, "cloud-costs-strip", "savings")).toBe(
      "$1,028",
    );
    expect(await dailyBars(page)).toEqual({ finished: 29, partlyReported: 1 });
    await expect(breakdownTotal(page)).toHaveText(`${accountSpend} in all`);

    // One account: no breakdown by account.
    await expect(dimensions(page).getByRole("radio")).toHaveText([
      "Services",
      "Regions",
      "Resources",
    ]);

    // Only this account's costs are summed.
    for (const request of (await recorded(page)).aggregateRequests) {
      expect(request.query["cloudAccountId"]).toBe(WEB_PROD_ID);
    }

    // Its own ways to spend less, without its name on every row.
    const savings: Locator = page.locator(
      "#cloud-account-savings-table-body > tr",
    );
    await expect(savings).toHaveCount(4);
    await expect(
      page.locator("#cloud-account-savings-table").getByText("Account", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(savings.nth(0)).toContainText("$410.50");
    await expect(savings.nth(3)).toContainText("$36.80");

    await expectNoSidewaysScroll(page);
    await screenshot(page, "cloud-account-costs-1280");
  });

  test("a costs card whose read fails says so in its own place, and Refresh reads it again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, COSTS, "fail=costs");

    // The strip comes from the accounts: it stands while the cards fail.
    await expect(
      strip(page, "cloud-costs-strip").getByTestId("cloud-stat-tile"),
    ).toHaveCount(4);
    const daily: Locator = page.getByTestId("cloud-daily-spend");
    const breakdown: Locator = page.getByTestId("cloud-cost-breakdown");
    await expect(daily).toContainText(
      "The server took too long to answer. Try again.",
    );
    await expect(breakdown).toContainText(
      "The server took too long to answer. Try again.",
    );
    await screenshot(page, "cloud-costs-1280-failed");

    await daily.getByTestId("refresh-button").click();
    expect(await dailyBars(page)).toEqual({ finished: 29, partlyReported: 1 });
    await breakdown.getByTestId("refresh-button").click();
    expect((await breakdownRows(page)).length).toBeGreaterThan(0);
  });

  test("on a phone: the tiles two by two, the choices wrap, the chart fits, nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await open(page, COSTS);

    expect(await dailyBars(page)).toEqual({ finished: 29, partlyReported: 1 });
    const [chart, card] = await boxesInOneFrame([
      page.getByTestId("cloud-daily-spend-chart"),
      page.getByTestId("cloud-daily-spend"),
    ]);
    expect(chart!.x + chart!.width).toBeLessThanOrEqual(
      card!.x + card!.width + 0.5,
    );
    const [byWhat, overWhen, breakdown] = await boxesInOneFrame([
      dimensions(page),
      periods(page),
      page.getByTestId("cloud-cost-breakdown"),
    ]);
    // The periods go under the dimensions rather than past the card.
    expect(overWhen!.y).toBeGreaterThanOrEqual(
      byWhat!.y + byWhat!.height - 0.5,
    );
    for (const choices of [byWhat!, overWhen!]) {
      expect(choices.x + choices.width).toBeLessThanOrEqual(
        breakdown!.x + breakdown!.width + 0.5,
      );
    }

    await expectNoSidewaysScroll(page);
    await screenshot(page, "cloud-costs-390");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Savings
 * ---------------------------------------------------------------------------
 */
test.describe("Savings", () => {
  test("every way to spend less, the largest first, by way, each a click from its resource and its account", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, SAVINGS);
    expect(await trailOf(page)).toEqual(["Project", "Cloud", "Savings"]);
    await expect(litEntry(page)).toHaveText("Savings");

    // What could be saved a month, and in what way.
    const savings: string = "cloud-savings-strip";
    expect(await tileValue(page, savings, "savings")).toBe("$1,279");
    expect(await tileValue(page, savings, "rightsize")).toBe("$881.26");
    await expect(tileSublabel(page, savings, "rightsize")).toHaveText(
      "3 recommendations",
    );
    expect(await tileValue(page, savings, "idle")).toBe("$44.10");
    expect(await tileValue(page, savings, "commitment")).toBe("$300.00");

    const rows: Locator = page.locator("#cloud-savings-table-body > tr");
    await expect(rows).toHaveCount(7);
    const amounts: Array<number> = (
      await page.getByTestId("cloud-saving-amount").allTextContents()
    ).map(amountOf);
    expect(amounts).toEqual([410.5, 300, 280.32, 190.44, 54.1, 36.8, 7.3]);

    /*
     * A row: what to do and what it changes, to which resource (its page),
     * what it saves, in which account. The kind is the strip's, and the
     * Kind filter's: no column of it says the action's word again.
     */
    await expect(page.getByRole("columnheader", { name: "Kind" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("columnheader", { name: "Monthly Savings" }),
    ).toBeVisible();
    const first: Locator = rows.nth(0);
    await expect(first).toContainText("Rightsize");
    await expect(first.getByTestId("cloud-saving-change")).toHaveText(
      "db.r6g.2xlarge → db.r6g.xlarge",
    );
    await expect(
      first.getByRole("link", { name: "orders-db" }),
    ).toHaveAttribute("href", `${CLOUD}/${ORDERS_DB_ID}`);
    await expect(first).toContainText("RDS DB instance · us-east-1");
    await expect(first).toContainText("db.r6g.2xlarge → db.r6g.xlarge");
    await expect(first.getByRole("link", { name: "web-prod" })).toHaveAttribute(
      "href",
      WEB_PROD_COSTS,
    );
    // One without a resource OneUptime lists names it, unlinked.
    await expect(rows.nth(4)).toContainText("vol-0lake7");
    await expect(
      rows.nth(4).getByRole("link", { name: "vol-0lake7" }),
    ).toHaveCount(0);

    await screenshot(page, "cloud-savings-1280");

    // On a phone: each a card, nothing sideways.
    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "cloud-savings-390");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Budgets
 * ---------------------------------------------------------------------------
 */
test.describe("Budgets", () => {
  test("each budget: the month against it, where it is heading and how it is doing - the Overview's spend for every account", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, CLOUD);
    const overviewSpend: string = await tileValue(
      page,
      "cloud-overview-strip",
      "spend",
    );

    await desktopMenu(page).getByRole("link", { name: "Budgets" }).click();
    await expect(page).toHaveURL(BUDGETS);
    await sideMenuAtRest(page);
    expect(await trailOf(page)).toEqual(["Project", "Cloud", "Budgets"]);
    await expect(litEntry(page)).toHaveText("Budgets");

    const rows: Locator = page.locator("#cloud-budgets-table-body > tr");
    await expect(rows).toHaveCount(4);
    await expect(page.getByTestId("cloud-budget-status")).toHaveText([
      "Passed 80%",
      "On course to pass",
      "Within budget",
      "Paused",
    ]);
    expect(
      await page
        .getByTestId("cloud-budget-status")
        .evaluateAll((pills: Array<Element>): Array<string | null> => {
          return pills.map((pill: Element): string | null => {
            return pill.getAttribute("data-tone");
          });
        }),
    ).toEqual(["warning", "warning", "positive", "neutral"]);

    // Every account's budget has spent the month so far the Overview shows.
    const production: Locator = tableRow(
      page,
      "cloud-budgets-table",
      "Production",
    );
    await expect(production.getByTestId("cloud-budget-month")).toContainText(
      `${overviewSpend} of $`,
    );
    await expect(production).toContainText("All accounts");

    // One account's leads to that account's Costs.
    await expect(
      tableRow(page, "cloud-budgets-table", "Analytics").getByRole("link", {
        name: "analytics",
      }),
    ).toHaveAttribute("href", `${CLOUD}/accounts/${ANALYTICS_ID}/costs`);
    await expect(
      tableRow(page, "cloud-budgets-table", "Data platform").getByTestId(
        "cloud-budget-month",
      ),
    ).toContainText("On course for $");

    // A paused budget is not checked: nothing said of where its month is heading.
    const sandbox: Locator = tableRow(page, "cloud-budgets-table", "Sandbox");
    await expect(sandbox.getByTestId("cloud-budget-month")).not.toContainText(
      "On course for",
    );

    await screenshot(page, "cloud-budgets-1280");
  });

  test("a budget is made in two steps, in dollars, alerting at 80% and 100% unless told otherwise", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, BUDGETS);
    await expect(page.locator("#cloud-budgets-table-body > tr")).toHaveCount(4);

    await page.getByRole("button", { name: "Create Cloud Budget" }).click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // The first step: what it is and what a month may cost.
    await dialog.getByLabel("Name", { exact: true }).fill("Staging");
    await dialog.getByLabel("Monthly Amount", { exact: true }).fill("2500");
    // The currency waits under More fields, which says what it holds.
    await expect(dialog.getByTestId("folded-section-header")).toContainText(
      "Currency: USD",
    );
    await expect(
      dialog.getByRole("textbox", { name: "Currency", exact: true }),
    ).toBeHidden();
    await screenshot(page, "cloud-budgets-1280-create-1");
    await dialog.getByRole("button", { name: "Next", exact: true }).click();

    // The second: when it alerts - 80% and 100% already there.
    const alertAt: Locator = dialog.getByLabel("Alert At", { exact: true });
    await expect(alertAt).toHaveValue("80,100");
    await screenshot(page, "cloud-budgets-1280-create-2");

    /*
     * What is not a list of percents is said before the budget is saved -
     * not taken as 80% and 100% without a word.
     */
    await alertAt.fill("eighty, 100");
    await dialog.getByTestId("modal-footer-submit-button").click();
    await expect(dialog).toContainText(
      "Write each as a percent of the budget from 1 to 1000, such as 80, 100.",
    );
    expect((await recorded(page)).creates).toHaveLength(0);
    await alertAt.fill("80,100");
    await dialog.getByTestId("modal-footer-submit-button").click();
    await expect(dialog).toBeHidden();

    /*
     * Over every account, in the currency most accounts are billed in. It
     * is on: the form leaves the switch to its column's default, which is.
     */
    const creates: Recorded["creates"] = (await recorded(page)).creates;
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({
      modelName: "CloudBudget",
      data: {
        name: "Staging",
        monthlyAmount: 2500,
        currency: "USD",
        cloudAccountId: "",
        alertThresholds: "80,100",
        alertOnProjection: true,
        description: "",
      },
    });
    expect(creates[0]!.data["isEnabled"]).not.toBe(false);

    // Read again, it waits for its first check.
    const staging: Locator = tableRow(page, "cloud-budgets-table", "Staging");
    await expect(staging.getByTestId("cloud-budget-status")).toHaveText(
      "Not checked yet",
    );
    // Nothing spent yet, of the amount as it was set.
    await expect(staging.getByTestId("cloud-budget-month")).toContainText(
      "$0 of $2,500",
    );
  });

  test("Disable asks first, saying what a disabled budget does not do; the budget then reads Paused", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, BUDGETS);

    const production: Locator = tableRow(
      page,
      "cloud-budgets-table",
      "Production",
    );
    await production.getByTestId("row-actions-more-button").click();
    const menu: Locator = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Disable", exact: true }).click();

    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog.getByTestId("row-switch-name")).toHaveText(
      "Production",
    );
    await expect(dialog.getByTestId("row-switch-consequence")).toHaveText(
      "A disabled budget is not checked, so it raises no alerts until it is enabled again.",
    );
    await screenshot(page, "cloud-budgets-1280-disable");
    await dialog.getByTestId("modal-footer-submit-button").click();
    await expect(dialog).toBeHidden();

    expect((await recorded(page)).updates).toEqual([
      {
        modelName: "CloudBudget",
        id: "86000000-0000-4000-8000-000000000001",
        data: { isEnabled: false },
      },
    ]);
    await expect(production.getByTestId("cloud-budget-status")).toHaveText(
      "Paused",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * A resource's page and an account's Overview
 * ---------------------------------------------------------------------------
 */
test.describe("a resource's page and an account's Overview", () => {
  /*
   * What needs someone first, right under the hero and before any number -
   * as a host's and a cluster's Overview lead with theirs - then its
   * numbers, then what it costs and how it could cost less, then its
   * Details.
   */
  test("a resource's page leads with what needs attention, then its numbers and its ways to spend less, before its Details", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${CLOUD}/${ORDERS_DB_ID}`);

    const attention: Locator = page.getByTestId("cloud-resource-attention");
    await expect(attention).toContainText("This resource");
    await expect(attention).toContainText("92% full");
    await expect(attention).toContainText("CPU at 97%");

    // AWS bills it under its service and Region only: no figure of its own.
    const cost: Locator = page.getByTestId("cloud-resource-cost");
    await expect(cost).toHaveAttribute("data-state", "savings-only");
    const costCard: Locator = page.getByTestId("card").filter({ has: cost });
    await expect(costCard).toContainText("Ways to spend less");
    await expect(costCard).not.toContainText("What it costs");
    await expect(cost).toContainText("db.r6g.2xlarge → db.r6g.xlarge");

    const [hero, why, tiles, savings, details] = await boxesInOneFrame([
      page.getByTestId("resource-overview-title-block"),
      attention,
      page.getByTestId("resource-overview-tiles"),
      cost,
      page.getByTestId("resource-overview-details"),
    ]);
    expect(why!.y).toBeGreaterThan(hero!.y);
    expect(tiles!.y).toBeGreaterThan(why!.y + why!.height);
    expect(savings!.y).toBeGreaterThan(tiles!.y + tiles!.height);
    expect(details!.y).toBeGreaterThan(savings!.y + savings!.height);
    await screenshot(page, "cloud-resource-1280");

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "cloud-resource-390");
  });

  test("a resource its cloud bills by name says what it cost this month and in the last 30 days", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${CLOUD}/${ETL_RUNNER_ID}`);

    // Well: nothing needs attention, so no card says so.
    await expect(page.getByTestId("resource-overview-tiles")).toContainText(
      "41%",
    );
    await expect(page.getByTestId("cloud-resource-attention")).toHaveCount(0);

    const cost: Locator = page.getByTestId("cloud-resource-cost");
    await expect(cost).toHaveAttribute("data-state", "costs");
    await expect(page.getByTestId("card").filter({ has: cost })).toContainText(
      "What it costs",
    );
    const figure: (testId: string) => Promise<string> = async (
      testId: string,
    ): Promise<string> => {
      return (
        (await cost.getByTestId(testId).locator("dd").textContent()) || ""
      ).trim();
    };
    const month: string = await figure("cloud-resource-cost-month");
    const lastThirtyDays: string = await figure("cloud-resource-cost-30-days");
    expect(month).toMatch(ENGLISH_DOLLARS);
    expect(lastThirtyDays).toMatch(ENGLISH_DOLLARS);
    // Thirty days of it cost more than the month's first days.
    expect(amountOf(lastThirtyDays)).toBeGreaterThan(amountOf(month));
    await expect(cost).toContainText("n2-standard-16 → n2-standard-8");
  });

  test("an account's Overview leads with what needs attention, and its month's spend is a click from its Costs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${CLOUD}/accounts/${WEB_PROD_ID}`);

    const attention: Locator = page.getByTestId("cloud-account-attention");
    await expect(attention).toContainText("web-1");

    const [hero, why, tiles, details] = await boxesInOneFrame([
      page.getByTestId("resource-overview-title-block"),
      attention,
      page.getByTestId("resource-overview-tiles"),
      page.getByTestId("resource-overview-details"),
    ]);
    expect(why!.y).toBeGreaterThan(hero!.y);
    expect(tiles!.y).toBeGreaterThan(why!.y + why!.height);
    expect(details!.y).toBeGreaterThan(tiles!.y + tiles!.height);

    // The month so far, as the Cloud Overview's row for it says, and the way to its Costs.
    const spend: Locator = page
      .getByTestId("resource-overview-tiles")
      .locator("> *")
      .filter({ hasText: "Spend this month" });
    await expect(spend).toContainText("So far this month");
    const tileFigure: string = (
      (await spend.locator(".text-2xl").textContent()) || ""
    ).trim();
    expect(tileFigure).toMatch(ENGLISH_DOLLARS);
    await spend.getByRole("link").click();
    await expect(page).toHaveURL(WEB_PROD_COSTS);
    expect(await tileValue(page, "cloud-costs-strip", "spend")).toBe(
      tileFigure,
    );

    // One whose costs it may not read says why, never $0.
    await open(page, `${CLOUD}/accounts/${CORE_PROD_ID}`);
    const blocked: Locator = page
      .getByTestId("resource-overview-tiles")
      .locator("> *")
      .filter({ hasText: "Spend this month" });
    await expect(blocked).toContainText("Needs permission");
    await expect(blocked).not.toContainText("$0");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Every page, every way it is read
 * ---------------------------------------------------------------------------
 */
const PAGES: Array<{ name: string; address: string }> = [
  { name: "overview", address: CLOUD },
  { name: "costs", address: COSTS },
  { name: "savings", address: SAVINGS },
  { name: "budgets", address: BUDGETS },
  { name: "account-costs", address: WEB_PROD_COSTS },
];

const WAYS: Array<{ name: string; query: string; widths: Array<number> }> = [
  { name: "light", query: "", widths: [1280, 390] },
  { name: "dark", query: "theme=dark", widths: [1280, 390] },
  { name: "de", query: "lang=de", widths: [1280, 390] },
  { name: "fa", query: "lang=fa", widths: [1280, 390] },
  { name: "fa-dark", query: "lang=fa&theme=dark", widths: [390] },
];

test.describe("every page, every way", () => {
  for (const way of WAYS) {
    test(`${way.name}: every page drawn whole at ${way.widths.join(" and ")}, nothing sideways`, async ({
      page,
    }: {
      page: Page;
    }) => {
      test.setTimeout(240000);

      for (const entry of PAGES) {
        for (const width of way.widths) {
          await page.setViewportSize({ width: width, height: 900 });
          await open(page, entry.address, way.query);
          // The page's main cards are there before it is read.
          await expect(
            page
              .getByTestId("cloud-stat-tile")
              .or(
                page.locator(
                  "#cloud-budgets-table-body > tr, #cloud-budgets-table-body > div",
                ),
              )
              .first(),
          ).toBeVisible();
          await expectNoSidewaysScroll(page, {
            message: `${entry.name} at ${width}, ${way.name}`,
          });
          await screenshot(page, `walk-${entry.name}-${width}-${way.name}`);
        }
      }
    });
  }
});
