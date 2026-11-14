import {
  ConsoleMessage,
  expect,
  Locator,
  Page,
  Route,
  test,
} from "@playwright/test";
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
/*
 * Sized by OneUptime from its own readings, no recommender speaking for
 * them: an Azure VM billed by name with half its size to spare, a cache
 * running hot, and an EC2 instance kept among the ways to spend less.
 */
const SHOP_WEB_1_ID: string = "82000000-0000-4000-8000-000000000005";
const BATCH_1_ID: string = "82000000-0000-4000-8000-000000000006";

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
  // A resource's readings, as its right-sizing reads them.
  metricRequests: Array<{
    aggregationType: string;
    interval: string | undefined;
    names: Array<string>;
    attributes: Record<string, string>;
  }>;
  aggregateRequests: Array<{
    modelName: string;
    interval: string | undefined;
    groupBy: Array<string>;
    // A breakdown by a tag's value: the key asked.
    groupByAttributeKeys: Array<string>;
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
/*
 * What React says in the console of markup HTML does not allow - a div in a
 * paragraph, which the browser splits - on any page the suite opens.
 */
const nestingWarnings: Map<Page, Array<string>> = new Map();

/*
 * CLOUD_SPEND_CLOCK=2026-03-01T00:30:00Z runs every test with the page's
 * clock started at that time (it then runs on as a clock does), so the
 * whole suite can be run at any hour of any day - the fixture's figures
 * are made up from the page's own now.
 */
const SUITE_CLOCK: string = process.env["CLOUD_SPEND_CLOCK"] || "";

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const outside: Array<string> = [];
  pageErrors.set(page, errors);
  outsideRequests.set(page, outside);

  if (SUITE_CLOCK) {
    const time: Date = new Date(SUITE_CLOCK);
    expect(Number.isNaN(time.getTime()), "CLOUD_SPEND_CLOCK is a time").toBe(
      false,
    );
    await page.clock.install({ time });
  }

  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });

  const nesting: Array<string> = [];
  nestingWarnings.set(page, nesting);
  page.on("console", (message: ConsoleMessage) => {
    if (
      message.type() === "error" &&
      message.text().includes("validateDOMNesting")
    ) {
      nesting.push(message.text().slice(0, 300));
    }
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
  expect(nestingWarnings.get(page) || [], "markup HTML does not allow").toEqual(
    [],
  );

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
  return page.getByRole("navigation", {
    name: new RegExp(`^(?:Breadcrumb|${persian("Breadcrumb")})$`),
  });
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

// The amount a sentence starts with: "$412.00 does not carry this tag." -> 412.
function leadingAmountOf(text: string): number {
  return amountOf(text.trim().split(" ")[0] || "");
}

/*
 * Where a link into one of App Platforms' lists goes, and the chips it
 * sets there: the list's facet state, under the URL parameter its facet
 * bar reads (`<table id>-facets`).
 */
async function chipLinkOf(
  link: Locator,
  tableId: string,
): Promise<{ path: string; facets: unknown }> {
  const href: string | null = await link.getAttribute("href");
  expect(href).toBeTruthy();
  const url: URL = new URL(href!, "http://127.0.0.1");
  const facets: string | null = url.searchParams.get(`${tableId}-facets`);

  return {
    path: url.pathname,
    facets: facets === null ? null : JSON.parse(facets),
  };
}

/*
 * The rows of "Where the money goes", as [name, amount] in their order: the
 * ranked rows, each with its amount - not the lines under them.
 */
async function breakdownRows(page: Page): Promise<Array<[string, string]>> {
  const card: Locator = page.getByTestId("cloud-cost-breakdown");
  await expect(card.getByTestId("cloud-cost-breakdown-loading")).toHaveCount(0);
  return await card
    .locator("ul > li:has(.tabular-nums)")
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
 * How a commitment kind's line is laid out, read from its boxes in one
 * frame: its name, what it covers and what of it is used side by side; its
 * name over the two figures, side by side; or one under another. The card
 * lays it out by the width its account's column has, not the window's.
 */
async function kindLineLayout(kind: Locator): Promise<string> {
  const [label, coverage, use] = await boxesInOneFrame([
    kind.locator(":scope > div").first(),
    kind.getByTestId("cloud-commitment-coverage"),
    kind.getByTestId("cloud-commitment-use"),
  ]);
  const onOneRow: (a: FrameBox, b: FrameBox) => boolean = (
    a: FrameBox,
    b: FrameBox,
  ): boolean => {
    return Math.abs(a.y - b.y) < 2;
  };
  const isUnder: (a: FrameBox, b: FrameBox) => boolean = (
    a: FrameBox,
    b: FrameBox,
  ): boolean => {
    return a.y >= b.y + b.height - 0.5;
  };

  if (onOneRow(label!, coverage!) && onOneRow(coverage!, use!)) {
    return "side by side";
  }

  if (onOneRow(coverage!, use!) && isUnder(coverage!, label!)) {
    return "name over two";
  }

  if (isUnder(coverage!, label!) && isUnder(use!, coverage!)) {
    return "one under another";
  }

  return `unlike any: ${JSON.stringify({ label, coverage, use })}`;
}

// What a breakdown by environment, app or tag says the rest came to, by kind.
async function breakdownRest(page: Page): Promise<Array<[string, string]>> {
  return await page
    .getByTestId("cloud-cost-breakdown-rest-line")
    .evaluateAll((lines: Array<Element>): Array<[string, string]> => {
      return lines.map((line: Element): [string, string] => {
        return [
          line.getAttribute("data-kind") || "",
          (line.textContent || "").trim(),
        ];
      });
    });
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

    /*
     * Ways to spend less: what the clouds' recommenders say, and
     * OneUptime's own right-sizing (one, its saving not known yet), the
     * largest first.
     */
    const savingsCard: Locator = page.getByTestId("cloud-savings-card");
    await expect(savingsCard).toHaveAttribute("data-state", "found");
    await expect(savingsCard).toContainText("Up to $1,279 a month");
    await expect(savingsCard).toContainText("8 recommendations");
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
     * live now. Each count opens its list with the Cloud Account chip set
     * to the account it counted (#6060), so the list holds what the card
     * counts and nothing needs saying about the rest.
     */
    const appPlatforms: Locator = page.getByTestId("cloud-app-platforms-card");
    await expect(
      appPlatforms.getByTestId("cloud-app-platforms-environments"),
    ).toHaveText("2 environments");
    expect(
      await chipLinkOf(
        appPlatforms.getByTestId("cloud-app-platforms-environments"),
        "cloud-resources-table",
      ),
    ).toEqual({
      path: `${DASHBOARD}/app-platforms/environments`,
      facets: {
        facetSelections: { cloudAccountId: ["123456789012"] },
        facetOperators: { cloudAccountId: "is" },
      },
    });
    await expect(
      appPlatforms.getByTestId("cloud-app-platforms-apps"),
    ).toHaveText("4 apps");
    expect(
      await chipLinkOf(
        appPlatforms.getByTestId("cloud-app-platforms-apps"),
        "app-platforms-apps-table",
      ),
    ).toEqual({
      path: `${DASHBOARD}/app-platforms/apps`,
      facets: {
        facetSelections: { cloudAccountId: ["123456789012"] },
        facetOperators: { cloudAccountId: "is" },
      },
    });
    await expect(
      appPlatforms.getByTestId("cloud-app-platforms-other-environments"),
    ).toHaveCount(0);

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
      "8 recommendations",
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
    await expect(toggle).toHaveText("Show 2 more");
    await toggle.click();
    expect(await breakdownRows(page)).toHaveLength(12);
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
     * the rest as not billed to one, with a line on how AWS names them,
     * and the AWS account whose costs per resource could not be read.
     */
    await dimension(page, "resourceId").click();
    rows = await breakdownRows(page);
    expect(rows[0]![0]).toBe("Not billed to a resource");
    expect(
      rows.map((row: [string, string]) => {
        return row[0];
      }),
    ).toEqual(expect.arrayContaining(["etl-runner-1", "acme-analytics-raw"]));
    // web-prod's connection reads no costs per resource: how AWS names them.
    await expect(
      page.getByTestId("cloud-cost-breakdown-resources-note"),
    ).toHaveText(
      "Azure and Google Cloud name the resource each cost is for. AWS does once Costs per resource is turned on in its connection's settings.",
    );
    const notRead: Locator = page.getByTestId(
      "cloud-cost-breakdown-resources-not-read-account",
    );
    await expect(notRead).toHaveCount(1);
    await expect(notRead).toContainText("data-lake · Not set up");
    /*
     * The read's own words on a line of their own, under the account and
     * its state, never run into them.
     */
    const notReadMessage: Locator = notRead.getByTestId(
      "cloud-cost-breakdown-resources-not-read-message",
    );
    await expect(notReadMessage).toContainText(
      "Resource-level data is not turned on for this account.",
    );
    await expect(notReadMessage).toHaveAttribute("dir", "auto");
    const [stateLine, messageLine] = await boxesInOneFrame([
      notRead.locator("p").first(),
      notReadMessage,
    ]);
    expect(messageLine!.y).toBeGreaterThanOrEqual(
      stateLine!.y + stateLine!.height - 0.5,
    );
    // Then the guide to turning it on, once.
    const resourcesGuide: Locator = page
      .getByTestId("cloud-cost-breakdown")
      .getByRole("link", { name: "Read the guide" });
    await expect(resourcesGuide).toHaveCount(1);
    const resourcesGuideUrl: URL = new URL(
      (await resourcesGuide.getAttribute("href")) || "",
    );
    expect(resourcesGuideUrl.pathname).toBe("/docs/telemetry/cloud-costs");
    expect(resourcesGuideUrl.hash).toBe("#costs-per-resource");

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

    // One account: no breakdown by account, and its card does not offer one.
    await expect(dimensions(page).getByRole("radio")).toHaveText([
      "Services",
      "Regions",
      "Resources",
      "Environments",
      "Apps",
      "Tags",
    ]);
    await expect(
      page.getByText(
        "What cost the most: by service, Region or resource, by App Platforms environment or app, or by tag.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "What cost the most: by service, Region, account or resource, by App Platforms environment or app, or by tag.",
        { exact: true },
      ),
    ).toHaveCount(0);

    /*
     * Its own commitments: the page is the account's, so the card names it
     * nowhere - its kinds come first, under its ways to spend less.
     */
    const commitment: Locator = page.getByTestId("cloud-commitment-account");
    await expect(commitment).toHaveCount(1);
    await expect(commitment).not.toContainText("web-prod");
    await expect(
      commitment.getByTestId("cloud-commitment-account-name"),
    ).toHaveCount(0);
    await expect(commitment.getByTestId("cloud-commitment-kind")).toHaveCount(
      2,
    );

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
    // Its commitments under them, as Savings shows them over every account.
    const [ownSavings, ownCommitments] = await boxesInOneFrame([
      page.locator("#cloud-account-savings-table-body"),
      page.getByTestId("cloud-commitments"),
    ]);
    expect(ownCommitments!.y).toBeGreaterThan(
      ownSavings!.y + ownSavings!.height - 0.5,
    );

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
    // The read has only just begun when the click returns, and the failure stands until it answers.
    await expect(breakdown.locator("ul > li").first()).toBeVisible();
    expect((await breakdownRows(page)).length).toBeGreaterThan(0);
  });

  test("an unusual day: data-lake's Athena yesterday, under the daily spend, linked to its account - and only on that account's Costs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, COSTS);

    const yesterday: string = await page.evaluate((): string => {
      const now: Date = new Date();
      return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
      )
        .toISOString()
        .slice(0, 10);
    });

    const unusual: Locator = page.getByTestId("cloud-unusual-days");
    await expect(unusual).toBeVisible();
    const days: Locator = unusual.getByTestId("cloud-unusual-day");
    // Every other day of every account is a usual one: their swing is small.
    await expect(days).toHaveCount(1);
    await expect(days.first()).toHaveAttribute("data-day", yesterday);
    await expect(days.first().getByTestId("cloud-unusual-day-what")).toHaveText(
      "Amazon Athena",
    );
    await expect(
      days.first().getByTestId("cloud-unusual-day-usual"),
    ).toContainText("times its usual $");
    expect(
      amountOf(
        (await days
          .first()
          .getByTestId("cloud-unusual-day-amount")
          .textContent()) || "",
      ),
    ).toBeGreaterThan(40);
    await expect(
      days.first().getByRole("link", { name: "data-lake" }),
    ).toHaveAttribute("href", `${CLOUD}/accounts/${DATA_LAKE_ID}/costs`);

    /*
     * The same day marked on the daily spend, above its bar: one chip, what
     * ran high and what it cost, and a click opens its account's Costs.
     */
    await expect(page.getByTestId("cloud-daily-spend")).toHaveAttribute(
      "data-unusual-days",
      yesterday,
    );
    await expect(page.getByTestId("cloud-daily-spend-chart")).toHaveAttribute(
      "data-marks",
      "1",
    );
    const chip: Locator = page
      .getByTestId("cloud-daily-spend-chart")
      .getByTestId("chart-annotation-chip");
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute("data-annotation-count", "1");
    expect(await chip.getAttribute("aria-label")).toContain(
      "Amazon Athena cost $",
    );

    // Read with the daily spend it explains, before where the money goes.
    const [daily, card, breakdown] = await boxesInOneFrame([
      page.getByTestId("cloud-daily-spend"),
      unusual,
      page.getByTestId("cloud-cost-breakdown"),
    ]);
    expect(card!.y).toBeGreaterThan(daily!.y + daily!.height - 0.5);
    expect(breakdown!.y).toBeGreaterThan(card!.y + card!.height - 0.5);
    await screenshot(page, "cloud-costs-1280-unusual-days");

    // Over every account, the mark is a button that opens its account's Costs.
    await expect(chip).toHaveAttribute("role", "button");
    await expect(chip).toHaveCSS("cursor", "pointer");
    await chip.click();
    await expect(page).toHaveURL(`${CLOUD}/accounts/${DATA_LAKE_ID}/costs`);

    // data-lake's own Costs: its day, naming no account.
    await open(page, `${CLOUD}/accounts/${DATA_LAKE_ID}/costs`);
    await expect(
      page.getByTestId("cloud-unusual-days").getByTestId("cloud-unusual-day"),
    ).toHaveCount(1);
    await expect(page.getByTestId("cloud-unusual-day-account")).toHaveCount(0);
    // Its mark too: one, on its own page, going nowhere else.
    await expect(page.getByTestId("cloud-daily-spend-chart")).toHaveAttribute(
      "data-marks",
      "1",
    );
    /*
     * A mark to hover or focus, not a button: the page is the day's
     * account's already, so it offers no pointer and no click.
     */
    const ownChip: Locator = page
      .getByTestId("cloud-daily-spend-chart")
      .getByTestId("chart-annotation-chip");
    await expect(ownChip).toHaveAttribute("role", "img");
    await expect(ownChip).toHaveCSS("cursor", "default");
    await ownChip.focus();
    await expect(page.getByTestId("chart-annotation-hover-card")).toContainText(
      "Amazon Athena cost $",
    );
    await expect(page).toHaveURL(`${CLOUD}/accounts/${DATA_LAKE_ID}/costs`);

    // web-prod had none: no card.
    await open(page, WEB_PROD_COSTS);
    expect(await dailyBars(page)).toEqual({ finished: 29, partlyReported: 1 });
    await expect(page.getByTestId("cloud-unusual-days")).toHaveCount(0);
    expect((await recorded(page)).unhandled).toEqual([]);
  });

  test("where the money goes by App Platforms environment, app and tag: each named and linked, the rest said under the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, COSTS);
    await expect(breakdownTotal(page)).toBeVisible();
    const total: number = amountOf(
      (await breakdownTotal(page).textContent()) || "",
    );

    /*
     * By environment: web-prod's two ECS environments, by what Amazon ECS
     * billed in each one's Region - never the environment of an account no
     * connection here reads - and what is in none under the list.
     */
    await dimension(page, "environment").click();
    await expect(page.getByTestId("cloud-cost-breakdown")).toHaveAttribute(
      "data-dimension",
      "environment",
    );
    let rows: Array<[string, string]> = await breakdownRows(page);
    expect(
      rows.map((row: [string, string]) => {
        return row[0];
      }),
    ).toEqual([
      "checkout · us-east-1 · 123456789012",
      "billing · eu-west-1 · 123456789012",
    ]);
    await expect(
      page
        .getByTestId("cloud-cost-breakdown")
        .getByRole("link", { name: /checkout · us-east-1/ }),
    ).toHaveAttribute(
      "href",
      `${DASHBOARD}/app-platforms/84000000-0000-4000-8000-000000000001`,
    );
    let rest: Array<[string, string]> = await breakdownRest(page);
    expect(
      rest.map((line: [string, string]) => {
        return line[0];
      }),
    ).toEqual(["not-in-environment"]);
    expect(rest[0]![1]).toContain("is not in an App Platforms environment.");
    // The shares and the rest are the period's spend, the same in all.
    const environments: number = rows.reduce(
      (sum: number, row: [string, string]): number => {
        return sum + amountOf(row[1]);
      },
      0,
    );
    expect(
      Math.abs(environments + leadingAmountOf(rest[0]![1]) - total),
    ).toBeLessThan(1.5);

    /*
     * By app: Amazon ECS bills its tasks, never one app - so no app is
     * billed on its own, and the environments' spend is said under it.
     */
    await dimension(page, "app").click();
    await expect(
      page.getByTestId("cloud-cost-breakdown").getByTestId("ranked-bars-empty"),
    ).toHaveText("No app is billed on its own in this period.");
    rest = await breakdownRest(page);
    expect(
      rest.map((line: [string, string]) => {
        return line[0];
      }),
    ).toEqual(["not-one-app", "not-in-environment"]);
    expect(Math.abs(leadingAmountOf(rest[0]![1]) - environments)).toBeLessThan(
      1.5,
    );
    await expect(page.getByTestId("cloud-cost-breakdown")).toContainText(
      "Amazon ECS bills its tasks and App Service its plans",
    );
    // An app's costs are read from the platforms' services alone.
    const byResource: Recorded["aggregateRequests"][number] | undefined = (
      await recorded(page)
    ).aggregateRequests
      .filter((request: Recorded["aggregateRequests"][number]): boolean => {
        return request.groupBy.includes("resourceId");
      })
      .pop();
    expect(byResource!.query["service"]).toEqual({
      includes: expect.arrayContaining([
        "Amazon Elastic Container Service",
        "Cloud Run",
      ]),
    });

    /*
     * By tag: the tags the accounts' costs carry, the costliest first -
     * team - each value its row, and the costs without it under the list.
     */
    await dimension(page, "tag").click();
    const picker: Locator = page.getByTestId("cloud-cost-breakdown-tag");
    await expect(picker).toBeVisible();
    await expect(picker).toContainText("Tag key");
    await expect(picker).toContainText("team");
    rows = await breakdownRows(page);
    expect(rows[0]![0]).toBe("web");
    expect(
      rows.map((row: [string, string]) => {
        return row[0];
      }),
    ).toEqual(
      expect.arrayContaining([
        "web",
        "data",
        "checkout",
        "platform",
        "billing",
      ]),
    );
    rest = await breakdownRest(page);
    expect(rest).toEqual([
      ["without-tag", expect.stringContaining("does not carry this tag.")],
    ]);
    let tagRequest: Recorded["aggregateRequests"][number] | undefined = (
      await recorded(page)
    ).aggregateRequests
      .filter((request: Recorded["aggregateRequests"][number]): boolean => {
        return request.groupByAttributeKeys.length > 0;
      })
      .pop();
    expect(tagRequest!.groupByAttributeKeys).toEqual(["team"]);
    expect(tagRequest!.query["currency"]).toBe("USD");

    // Another tag: its values, read again.
    await picker.getByRole("combobox").focus();
    await page.keyboard.press("ArrowDown");
    await page.getByRole("option", { name: "env", exact: true }).click();
    await expect(picker).toContainText("env");
    await expect
      .poll(async () => {
        return (await breakdownRows(page)).map((row: [string, string]) => {
          return row[0];
        });
      })
      .toEqual(["prod"]);
    tagRequest = (await recorded(page)).aggregateRequests
      .filter((request: Recorded["aggregateRequests"][number]): boolean => {
        return request.groupByAttributeKeys.length > 0;
      })
      .pop();
    expect(tagRequest!.groupByAttributeKeys).toEqual(["env"]);

    await expectNoSidewaysScroll(page);
    await screenshot(page, "cloud-costs-1280-by-tag");
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
 * At any hour of the UTC day
 * ---------------------------------------------------------------------------
 *
 * The costs are read twice a day and a cloud reports today late, so the
 * last read may have been made before midnight - on a month's first day,
 * in last month. The pages still agree: the month the Overview says it
 * cost is Costs' first tile and its breakdown's total, and an account's
 * month is its Costs' - just after midnight UTC as at noon.
 */
test.describe("at any hour of the UTC day", () => {
  for (const clock of [
    { name: "00:30 UTC on a month's first day", time: "2026-03-01T00:30:00Z" },
    { name: "12:00 UTC the same day", time: "2026-03-01T12:00:00Z" },
  ]) {
    test(`${clock.name}: the Overview's month is Costs' and its breakdown's, and an account's month its Costs'`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const time: Date = new Date(clock.time);
      // The suite's own clock (CLOUD_SPEND_CLOCK) is moved, not installed twice.
      if (SUITE_CLOCK) {
        await page.clock.setSystemTime(time);
      } else {
        await page.clock.install({ time });
      }

      await page.setViewportSize(LAPTOP);
      await open(page, CLOUD);
      // The page runs on the clock: the fixture made its figures from it.
      expect(
        await page.evaluate((): string => {
          return new Date().toISOString().slice(0, 13);
        }),
      ).toBe(clock.time.slice(0, 13));

      const overviewSpend: string = await tileValue(
        page,
        "cloud-overview-strip",
        "spend",
      );
      const accountSpend: string = (
        (await page
          .getByTestId("cloud-accounts-card-row")
          .filter({ hasText: "web-prod" })
          .getByTestId("cloud-accounts-card-spend")
          .locator(".tabular-nums")
          .textContent()) || ""
      ).trim();
      expect(amountOf(overviewSpend)).toBeGreaterThan(0);
      expect(amountOf(accountSpend)).toBeGreaterThan(0);

      await open(page, COSTS);
      expect(await tileValue(page, "cloud-costs-strip", "spend")).toBe(
        overviewSpend,
      );
      expect(await dailyBars(page)).toEqual({
        finished: 29,
        partlyReported: 1,
      });
      await expect(breakdownTotal(page)).toHaveText(`${overviewSpend} in all`);

      await open(page, WEB_PROD_COSTS);
      expect(await tileValue(page, "cloud-costs-strip", "spend")).toBe(
        accountSpend,
      );
      await expect(breakdownTotal(page)).toHaveText(`${accountSpend} in all`);
    });
  }
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
    // OneUptime's own right-sizing counts as a fourth, saving not known yet.
    expect(await tileValue(page, savings, "rightsize")).toBe("$881.26");
    await expect(tileSublabel(page, savings, "rightsize")).toHaveText(
      "4 recommendations",
    );
    expect(await tileValue(page, savings, "idle")).toBe("$44.10");
    expect(await tileValue(page, savings, "commitment")).toBe("$300.00");

    const rows: Locator = page.locator("#cloud-savings-table-body > tr");
    await expect(rows).toHaveCount(8);
    const amounts: Array<number> = (
      await page.getByTestId("cloud-saving-amount").allTextContents()
    ).map(amountOf);
    expect(amounts).toEqual([410.5, 300, 280.32, 190.44, 54.1, 36.8, 7.3]);

    /*
     * OneUptime's own right-sizing, last: what it changes, what its
     * readings were, and no amount until its cloud bills it by name.
     */
    const ours: Locator = rows.nth(7);
    await expect(ours.getByTestId("cloud-saving-change")).toHaveText(
      "m5.4xlarge → m5.xlarge",
    );
    await expect(ours.getByTestId("cloud-saving-evidence")).toHaveText(
      "OneUptime's readings: 95% of the time its CPU was at or under 8%, and never above 22%.",
    );
    await expect(ours.getByTestId("cloud-saving-amount-not-known")).toHaveText(
      "Not known yet",
    );
    await expect(ours.getByRole("link", { name: "batch-1" })).toHaveAttribute(
      "href",
      `${CLOUD}/${BATCH_1_ID}`,
    );
    // The clouds' own say what made them in their consoles: no line of it.
    await expect(rows.nth(0).getByTestId("cloud-saving-evidence")).toHaveCount(
      0,
    );

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

  test("each account's commitments: what they cover and what of them is used, each cloud's kinds on their own lines, and why one could not be read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, SAVINGS);

    const card: Locator = page.getByTestId("cloud-commitments");
    await expect(card).toBeVisible();
    const accounts: Locator = card.getByTestId("cloud-commitment-account");
    // Those with a commitment first, then what one could cover, then the unread.
    await expect(accounts).toHaveCount(4);
    await expect(accounts.nth(0)).toContainText("web-prod");
    await expect(accounts.nth(1)).toContainText("analytics");
    await expect(accounts.nth(2)).toContainText("eu-shop");
    await expect(accounts.nth(3)).toContainText("data-lake");

    // web-prod: its Savings Plans and its Reserved Instances, never added up.
    const web: Locator = accounts.nth(0);
    const kinds: Locator = web.getByTestId("cloud-commitment-kind");
    await expect(kinds).toHaveCount(2);
    await expect(kinds.nth(0)).toContainText("Savings Plans");
    await expect(
      kinds.nth(0).getByTestId("cloud-commitment-coverage"),
    ).toHaveText("Covers 64%");
    await expect(
      kinds.nth(0).getByTestId("cloud-commitment-coverage-detail"),
    ).toHaveText("$7,872 of $12,300");
    await expect(kinds.nth(0).getByTestId("cloud-commitment-use")).toHaveText(
      "97% utilized",
    );
    await expect(
      kinds.nth(0).getByTestId("cloud-commitment-use-detail"),
    ).toHaveText("$210.00 unused");
    await expect(kinds.nth(1)).toContainText("Reserved Instances");
    await expect(
      kinds.nth(1).getByTestId("cloud-commitment-coverage"),
    ).toHaveText("Covers all eligible spend");
    await expect(kinds.nth(1).getByTestId("cloud-commitment-use")).toHaveText(
      "Fully utilized",
    );
    await expect(
      web.getByTestId("cloud-commitment-account-name"),
    ).toHaveAttribute("href", WEB_PROD_COSTS);

    // Google Cloud's export says what a discount paid, not what went unused.
    await expect(accounts.nth(1)).toContainText("Committed use discounts");
    await expect(accounts.nth(1)).toContainText("Covers 30%");
    await expect(accounts.nth(1)).toContainText("Utilization not reported");

    // Azure, with none: what ran on demand that one would pay less for.
    await expect(accounts.nth(2)).toContainText("Savings plans");
    await expect(accounts.nth(2)).toContainText("No commitment");
    await expect(accounts.nth(2)).toContainText(
      "€950.00 ran at on-demand rates",
    );
    await expect(accounts.nth(2)).not.toContainText("Reservations");

    // data-lake's role may not read them: why, in its words, then what to do.
    await expect(accounts.nth(3)).toHaveAttribute("data-state", "not-allowed");
    await expect(accounts.nth(3)).toContainText("Needs permission");
    await expect(
      accounts.nth(3).getByTestId("cloud-commitment-message"),
    ).toContainText("Run the setup command again to allow it.");
    const step: Locator = accounts.nth(3).getByTestId("cloud-commitment-step");
    await expect(step).toContainText(
      "Run the connection's setup command again: it lets the connection read Savings Plans and Reserved Instances.",
    );
    const guide: URL = new URL(
      (await step
        .getByRole("link", { name: "Read the guide" })
        .getAttribute("href")) || "",
    );
    expect(guide.pathname).toBe("/docs/telemetry/cloud-costs");
    expect(guide.hash).toBe("#amazon-web-services");

    // Under the ways to spend less: what the page is for comes first.
    await expect(page.locator("#cloud-savings-table-body > tr")).toHaveCount(8);
    const [table, commitments] = await boxesInOneFrame([
      page.locator("#cloud-savings-table-body"),
      card,
    ]);
    expect(commitments!.y).toBeGreaterThan(table!.y + table!.height - 0.5);

    // A kind's name, what it covers and what of it is used, side by side.
    const firstKind: Locator = kinds.nth(0);
    await expect
      .poll(async () => {
        return await kindLineLayout(firstKind);
      })
      .toBe("side by side");
    await screenshot(page, "cloud-savings-1280-commitments");

    /*
     * Beside the side menu at 768 the card is half the window: the kind's
     * name over its two figures, which stay side by side.
     */
    await page.setViewportSize({ width: 768, height: 900 });
    await expect
      .poll(async () => {
        return await kindLineLayout(firstKind);
      })
      .toBe("name over two");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "cloud-savings-768-commitments");

    // A phone: one under another.
    await page.setViewportSize(PHONE);
    await expect
      .poll(async () => {
        return await kindLineLayout(firstKind);
      })
      .toBe("one under another");
    await expectNoSidewaysScroll(page);
    // What to do stays whole on a phone, where the cloud's words are cut.
    await expect(step).toBeVisible();
    await screenshot(page, "cloud-savings-390-commitments");
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
        // A day that costs far more than usual alerts too, unless turned off.
        alertOnAnomaly: true,
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

  /*
   * A resource no recommender of its cloud speaks for is sized from
   * OneUptime's own readings of its CPU and memory: its right-sizing beside
   * what it costs, side by side at a laptop's width and one under the other
   * on a phone.
   */
  test("a resource no recommender speaks for: its right-sizing from OneUptime's own readings, beside what it costs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${CLOUD}/${SHOP_WEB_1_ID}`);

    const sizing: Locator = page.getByTestId("cloud-right-sizing");
    await expect(sizing).toHaveAttribute("data-verdict", "overprovisioned");
    await expect(
      page.getByTestId("card").filter({ has: sizing }),
    ).toContainText("Right-sizing");
    await expect(sizing.getByTestId("cloud-right-sizing-verdict")).toHaveText(
      "Over-provisioned",
    );
    await expect(sizing.getByTestId("cloud-right-sizing-change")).toHaveText(
      "Standard_D8s_v5 → Standard_D4s_v5",
    );
    await expect(sizing.getByTestId("cloud-right-sizing-headline")).toHaveText(
      "A size half as big would do.",
    );
    // Its cloud bills it by name: what the change saves, in its currency.
    const saving: Locator = sizing.getByTestId("cloud-right-sizing-saving");
    await expect(saving).toHaveAttribute("data-known", "true");
    await expect(saving).toHaveAttribute("data-tone", "positive");
    await expect(saving).toContainText("Saves about");
    await expect(saving).toContainText(
      "a month, at its cost over the last 30 days.",
    );
    // Its amount stands out in green; the words around it stay quieter.
    const amount: Locator = saving.getByTestId(
      "cloud-right-sizing-saving-amount",
    );
    await expect(amount).toContainText("€");
    expect(
      await amount.evaluate((element: Element): string => {
        return getComputedStyle(element).fontWeight;
      }),
    ).toBe("600");
    expect(
      await saving.evaluate((element: Element): string => {
        return getComputedStyle(element).fontWeight;
      }),
    ).toBe("400");
    for (const [testId, value] of [
      ["cloud-right-sizing-cpu-p95", "12%"],
      ["cloud-right-sizing-cpu-max", "30%"],
      ["cloud-right-sizing-memory", "Not read"],
      ["cloud-right-sizing-days", "14"],
    ] as Array<[string, string]>) {
      await expect(sizing.getByTestId(testId).locator("dd")).toHaveText(value);
    }
    /*
     * Its readings now are its figures, said once: the one line under them
     * is what they would be at the new size.
     */
    const why: Locator = sizing.getByTestId("cloud-right-sizing-why");
    await expect(why.locator("p")).toHaveCount(1);
    await expect(why).toHaveText(
      "At Standard_D4s_v5, 95% of the time its CPU would be at or under 24%.",
    );
    // Azure reports the memory left: what to check before a smaller size.
    await expect(sizing.getByTestId("cloud-right-sizing-caveat")).toContainText(
      "Its cloud reports the memory left, not the share used.",
    );

    // Three reads of its readings, then its cost a day, in euros.
    const recordedReads: Recorded = await recorded(page);
    expect(
      recordedReads.metricRequests.map(
        (request: { aggregationType: string }) => {
          return request.aggregationType;
        },
      ),
    ).toEqual(["P95", "Max", "Count"]);
    for (const request of recordedReads.metricRequests) {
      expect(request.interval).toBe("Total");
      expect(Object.values(request.attributes)).toEqual([
        "/subscriptions/5f0c2d7e-9a41-4f3b-8c6e-1d2a3b4c5d6e/resourceGroups/shop/providers/Microsoft.Compute/virtualMachines/shop-web-1",
      ]);
    }
    const daily: Array<{ interval: string | undefined }> =
      recordedReads.aggregateRequests.filter(
        (request: { interval: string | undefined }) => {
          return request.interval === "Day";
        },
      );
    expect(daily).toHaveLength(1);
    expect(
      (daily[0] as unknown as { query: Record<string, unknown> }).query[
        "currency"
      ],
    ).toBe("EUR");

    // Side by side: What it costs first, its right-sizing beside it.
    const cost: Locator = page.getByTestId("cloud-resource-cost");
    const [costBox, sizingBox] = await boxesInOneFrame([cost, sizing]);
    expect(Math.abs(costBox!.y - sizingBox!.y)).toBeLessThan(2);
    expect(sizingBox!.x).toBeGreaterThan(costBox!.x + costBox!.width);
    await screenshot(page, "cloud-resource-right-sizing-1280");

    // On a phone: one under the other, nothing sideways.
    await page.setViewportSize(PHONE);
    const [phoneCost, phoneSizing] = await boxesInOneFrame([cost, sizing]);
    expect(phoneSizing!.y).toBeGreaterThanOrEqual(
      phoneCost!.y + phoneCost!.height,
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, "cloud-resource-right-sizing-390");
  });

  test("a resource running hot is under-provisioned: the size twice as big, its memory read too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${CLOUD}/${CACHE_ID}`);

    const sizing: Locator = page.getByTestId("cloud-right-sizing");
    await expect(sizing).toHaveAttribute("data-verdict", "underprovisioned");
    await expect(sizing.getByTestId("cloud-right-sizing-change")).toHaveText(
      "cache.r6g.large → cache.r6g.xlarge",
    );
    await expect(sizing.getByTestId("cloud-right-sizing-headline")).toHaveText(
      "A size twice as big would keep up.",
    );
    await expect(
      sizing.getByTestId("cloud-right-sizing-memory").locator("dd"),
    ).toHaveText("62%");
    // Not billed by name, and no saving to say: no line of it, no caveat.
    await expect(sizing.getByTestId("cloud-right-sizing-saving")).toHaveCount(
      0,
    );
    await expect(sizing.getByTestId("cloud-right-sizing-caveat")).toHaveCount(
      0,
    );
    // Its memory read too, under the name its cloud stores it with.
    expect(
      (await recorded(page)).metricRequests.map(
        (request: { names: Array<string> }) => {
          return request.names[0];
        },
      ),
    ).toEqual([
      "amazonaws.com/aws/elasticache/cpuutilization",
      "amazonaws.com/aws/elasticache/cpuutilization",
      "amazonaws.com/aws/elasticache/cpuutilization",
      "amazonaws.com/aws/elasticache/databasememoryusagepercentage",
    ]);
  });

  test("a resource read for three days so far: how far it has come, and nothing to change yet", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${CLOUD}/${SHOP_WEB_1_ID}`, "usage=learning");

    const sizing: Locator = page.getByTestId("cloud-right-sizing");
    await expect(sizing).toHaveAttribute("data-verdict", "not-enough-history");
    await expect(sizing.getByTestId("cloud-right-sizing-verdict")).toHaveText(
      "Not enough readings yet",
    );
    await expect(sizing.getByTestId("cloud-right-sizing-headline")).toHaveText(
      "Right-sizing needs 6 days of its CPU readings. It has 3 so far.",
    );
    // No size to change to, so no saving, figures, readings at it or caveat.
    for (const testId of [
      "cloud-right-sizing-change",
      "cloud-right-sizing-saving",
      "cloud-right-sizing-cpu-p95",
      "cloud-right-sizing-why",
      "cloud-right-sizing-caveat",
    ]) {
      await expect(sizing.getByTestId(testId)).toHaveCount(0);
    }
    // Beside what it costs, which it does not need: no cost a day is read.
    await expect(page.getByTestId("cloud-resource-cost")).toBeVisible();
    const daily: Array<{ interval: string | undefined }> = (
      await recorded(page)
    ).aggregateRequests.filter((request: { interval: string | undefined }) => {
      return request.interval === "Day";
    });
    expect(daily).toEqual([]);
    await screenshot(page, "cloud-resource-right-sizing-1280-learning");
  });

  test("a resource busy enough for its size: Right-sized, its figures, and nothing to change or check", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, `${CLOUD}/${SHOP_WEB_1_ID}`, "usage=fits");

      const sizing: Locator = page.getByTestId("cloud-right-sizing");
      await expect(sizing).toHaveAttribute("data-verdict", "right-sized");
      await expect(
        sizing.getByTestId("cloud-right-sizing-verdict"),
      ).toHaveAttribute("data-tone", "positive");
      await expect(
        sizing.getByTestId("cloud-right-sizing-headline"),
      ).toHaveText("Its size fits what it uses.");
      await expect(
        sizing.getByTestId("cloud-right-sizing-cpu-p95").locator("dd"),
      ).toHaveText("48%");
      await expect(
        sizing.getByTestId("cloud-right-sizing-cpu-max").locator("dd"),
      ).toHaveText("76%");
      for (const testId of [
        "cloud-right-sizing-change",
        "cloud-right-sizing-saving",
        "cloud-right-sizing-why",
        "cloud-right-sizing-caveat",
      ]) {
        await expect(sizing.getByTestId(testId)).toHaveCount(0);
      }
      await expectNoSidewaysScroll(page, {
        message: `a right-sized resource at ${width}`,
      });
      await screenshot(page, `cloud-resource-right-sizing-${width}-fits`);
    }
  });

  test("OneUptime's own right-sizing is said once: on its card, never again as a way to spend less", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${CLOUD}/${BATCH_1_ID}`);

    const sizing: Locator = page.getByTestId("cloud-right-sizing");
    await expect(sizing.getByTestId("cloud-right-sizing-change")).toHaveText(
      "m5.4xlarge → m5.xlarge",
    );
    await expect(sizing.getByTestId("cloud-right-sizing-headline")).toHaveText(
      "A size a quarter as big would do.",
    );
    await expect(sizing.getByTestId("cloud-right-sizing-saving")).toHaveText(
      "What it would save is not known yet: its cloud's bill does not name it.",
    );
    // AWS bills it under its service only, and its one row is OneUptime's.
    await expect(page.getByTestId("cloud-resource-cost")).toHaveCount(0);
    await expect(sizing.getByTestId("cloud-right-sizing-caveat")).toContainText(
      "CloudWatch reads an instance's memory only with its agent.",
    );
  });

  test("a resource its cloud's recommender speaks for: its word only, and its readings never read for a size", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${CLOUD}/${WEB_1_ID}`);

    await expect(page.getByTestId("cloud-resource-cost")).toContainText(
      "m5.2xlarge → m5.xlarge",
    );
    await expect(page.getByTestId("cloud-right-sizing")).toHaveCount(0);
    expect((await recorded(page)).metricRequests).toEqual([]);
  });

  for (const way of [
    { name: "de", query: "lang=de" },
    { name: "fa", query: "lang=fa" },
    { name: "dark", query: "theme=dark" },
  ]) {
    test(`${way.name}: a resource's right-sizing drawn whole at 1280 and 390, nothing sideways`, async ({
      page,
    }: {
      page: Page;
    }) => {
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await open(page, `${CLOUD}/${SHOP_WEB_1_ID}`, way.query);
        const sizing: Locator = page.getByTestId("cloud-right-sizing");
        await expect(sizing).toHaveAttribute("data-verdict", "overprovisioned");
        /*
         * The line reads the page's way and its arrow points on to the size
         * it would take (8654ea1ce45): "→", and on a page read from the
         * right "←", the size it has now at the line's right.
         */
        const isReadFromTheRight: boolean = way.name === "fa";
        const change: Locator = sizing.getByTestId("cloud-right-sizing-change");
        await expect(change).toHaveText(
          isReadFromTheRight
            ? "Standard_D8s_v5 ← Standard_D4s_v5"
            : "Standard_D8s_v5 → Standard_D4s_v5",
        );
        await expect(change).toHaveCSS(
          "direction",
          isReadFromTheRight ? "rtl" : "ltr",
        );
        /*
         * A size is its cloud's own name, set apart, read left to right on
         * every page.
         */
        const sizes: Locator = change.locator("bdi");
        await expect(sizes).toHaveText(["Standard_D8s_v5", "Standard_D4s_v5"]);
        for (const size of await sizes.all()) {
          await expect(size).toHaveCSS("direction", "ltr");
        }
        const [current, recommended] = await boxesInOneFrame([
          sizes.nth(0),
          sizes.nth(1),
        ]);
        expect(
          current!.x > recommended!.x,
          "the size it has now starts the line",
        ).toBe(isReadFromTheRight);

        if (way.name === "de") {
          await expect(
            sizing.getByTestId("cloud-right-sizing-headline"),
          ).toHaveText(german("A size half as big would do."));
          await expect(
            page.getByTestId("card").filter({ has: sizing }),
          ).toContainText(german("Right-sizing"));
        }

        if (way.name === "fa") {
          await expect(
            sizing.getByTestId("cloud-right-sizing-headline"),
          ).toHaveText(persian("A size half as big would do."));
          // Persian digits in its figures.
          await expect(
            sizing.getByTestId("cloud-right-sizing-days").locator("dd"),
          ).toHaveText("۱۴");
        }

        if (way.name === "dark") {
          expect(await surfaceLightnessOf(sizing)).toBeLessThan(0.3);
        }

        await expectNoSidewaysScroll(page, {
          message: `right-sizing at ${width}, ${way.name}`,
        });
        await screenshot(
          page,
          `cloud-resource-right-sizing-${width}-${way.name}`,
        );
      }
    });
  }

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
