import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import { sideMenuAtRest } from "../SuiteHelpers/SideMenuAtRest";

/*
 * App Platforms, in a browser, against the offline fixture
 * (AppPlatforms/Fixture): the product the apps on managed app and container
 * platforms moved to out of Cloud. Cloud keeps its accounts and every
 * resource in them; the environments the apps run in - AWS ECS and Fargate,
 * Google Cloud Run, Azure Container Apps and App Service - are App
 * Platforms'. Both are rows of one table, told apart by their kind.
 *
 * Read the way a person reads them: the Overview's fleet strip, its recent
 * deploys and its environments grouped by platform; All Apps, an
 * environment's Apps and one app's page - its revisions and deploys, its
 * instances, logs and traces, and the monitors recommended for it, which
 * Set up alerts opens and makes in one step; an environment's page and
 * every tab of it, under App Platforms' trail and side menu; All
 * Environments, Archived
 * and the rules, which list environments and never a cloud resource, and
 * show a rule made before the split with a pill that says why; the old Cloud
 * addresses of an environment, which open it here, and the App Platforms
 * address of a cloud resource, which opens it in Cloud. At a laptop's width
 * and a phone's, light and dark, in German and in Persian (right to left).
 * The fixture records every read, so each test also checks nothing it does
 * not model was asked for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;
const APP_PLATFORMS: string = `${DASHBOARD}/app-platforms`;
const CLOUD: string = `${DASHBOARD}/cloud`;

const CHECKOUT_ID: string = "71000000-0000-4000-8000-000000000001";
const CHECKOUT: string = `${APP_PLATFORMS}/${CHECKOUT_ID}`;
const CHECKOUT_NAME: string = "checkout · us-east-1 · 4109-2277-8841";

// checkout's app, its page, and the service its telemetry is under.
const CHECKOUT_APP_ID: string = "75000000-0000-4000-8000-000000000001";
const CHECKOUT_APP: string = `${CHECKOUT}/apps/${CHECKOUT_APP_ID}`;
const CHECKOUT_SERVICE_ID: string = "77000000-0000-4000-8000-000000000001";

// reports, on Container Apps: rolled back 40 minutes ago, v12abc to v11def.
const REPORTS_ID: string = "71000000-0000-4000-8000-000000000005";
const REPORTS_APP: string = `${APP_PLATFORMS}/${REPORTS_ID}/apps/75000000-0000-4000-8000-000000000006`;

// A chart's marker of reports' rollback, by its accessible name.
const ROLLBACK_MARKER: RegExp = /^Rolled back to revision v11def at /;

// The six apps, as All Apps sorts them (by name).
const APP_NAMES: Array<string> = [
  "api",
  "billing-api",
  "checkout-api",
  "inventory",
  "reports",
  "worker",
];

// A resource of a connected cloud account: Cloud's, never listed here.
const RESOURCE_ID: string = "72000000-0000-4000-8000-000000000001";
const RESOURCE_NAME: string = "vm-prod-01";

// The six environments, as All Environments sorts them (by creation).
const ENVIRONMENT_NAMES: Array<string> = [
  CHECKOUT_NAME,
  "billing · eu-west-1 · 4109-2277-8841",
  "api · europe-west1 · acme-prod",
  "worker · us-central1 · acme-prod",
  "reports · westeurope · core-prod-sub",
  "web · eastus · core-prod-sub",
];

const LAPTOP: { width: number; height: number } = { width: 1280, height: 900 };
const PHONE: { width: number; height: number } = { width: 390, height: 844 };

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/app-platforms-ui",
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

interface ListRequest {
  modelName: string;
  query: Record<string, unknown>;
}

interface AnalyticsRequest {
  groupBy: Array<string>;
  filters: Record<string, string>;
  entryOnly: boolean;
}

// A monitor an app's Recommendations tab made, as the fixture kept it.
interface CreatedMonitor {
  modelName: string;
  name: string;
  monitorType: string;
  scope: Record<string, string> | null;
  metricName: string | null;
  spanStatuses: Array<number> | null;
  serviceIds: Array<string>;
  cloudResourceIds: Array<string>;
}

interface Recorded {
  listRequests: Array<ListRequest>;
  analyticsRequests: Array<AnalyticsRequest>;
  countRequests: Array<ListRequest>;
  itemRequests: Array<{ modelName: string; id: string }>;
  apiRequests: Array<{ method: string; url: string }>;
  creates: Array<CreatedMonitor>;
  unhandled: Array<Record<string, unknown>>;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
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
          window as unknown as { __appPlatformsFixture?: Recorded }
        ).__appPlatformsFixture;
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
    return (window as unknown as { __appPlatformsFixture: Recorded })
      .__appPlatformsFixture;
  });
}

/*
 * A list's address with its Cloud Account chip set, as Cloud's Overview
 * links it (AppPlatformsListRoutes): the list's facet state under the URL
 * parameter its facet bar reads. "is", unless the chip was turned round.
 */
function accountChipQuery(
  tableId: string,
  accountIds: Array<string>,
  operator: "is" | "is_not" = "is",
): string {
  return `${tableId}-facets=${encodeURIComponent(
    JSON.stringify({
      facetSelections: { cloudAccountId: accountIds },
      facetOperators: { cloudAccountId: operator },
    }),
  )}`;
}

/*
 * Where each of a text's pieces starts on the screen, from the left: the
 * order a reader sees them in, whatever order they are written in.
 */
async function leftEdgesOf(
  locator: Locator,
  pieces: Array<string>,
): Promise<Array<number>> {
  return await locator.evaluate(
    (element: Element, wanted: Array<string>): Array<number> => {
      const text: Node = element.firstChild!;
      const written: string = text.textContent || "";
      const range: Range = document.createRange();

      return wanted.map((piece: string): number => {
        const at: number = written.indexOf(piece);
        range.setStart(text, at);
        range.setEnd(text, at + piece.length);
        return range.getBoundingClientRect().left;
      });
    },
    pieces,
  );
}

/*
 * A page of the fixture, once its heading is drawn in the Dashboard's font
 * and its side menu is at rest.
 */
async function open(page: Page, address: string): Promise<void> {
  await page.goto(address);
  await expect(pageHeading(page)).not.toBeEmpty({ timeout: 60000 });
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await sideMenuAtRest(page);
}

/*
 * The page's own heading. An environment's Overview has a second h1, the
 * hero's name; the page's heading comes first.
 */
function pageHeading(page: Page): Locator {
  return page.getByRole("heading", { level: 1 }).first();
}

// The trail: its label is the reader's word for it (Navigationspfad in German).
function trail(page: Page): Locator {
  return page.getByRole("navigation", {
    name: new RegExp(
      `^(?:Breadcrumb|${GERMAN["Breadcrumb"]}|${PERSIAN["Breadcrumb"]})$`,
    ),
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

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

/*
 * Where each word starts on screen, left to right, inside an element: the
 * order a line is drawn in, which a right-to-left page can scramble.
 */
async function wordLefts(
  locator: Locator,
  words: Array<string>,
): Promise<Array<number>> {
  return await locator.evaluate(
    (element: Element, wanted: Array<string>): Array<number> => {
      return wanted.map((word: string): number => {
        const walker: TreeWalker = document.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT,
        );
        let node: Node | null = walker.nextNode();
        while (node) {
          const index: number = (node.textContent || "").indexOf(word);
          if (index >= 0) {
            const range: Range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + word.length);
            return range.getBoundingClientRect().left;
          }
          node = walker.nextNode();
        }
        return Number.NaN;
      });
    },
    words,
  );
}

// Whether an element's text is cut: wider than the box it is drawn in.
async function isCut(locator: Locator): Promise<boolean> {
  return await locator.evaluate((element: Element): boolean => {
    return element.scrollWidth > element.clientWidth + 0.5;
  });
}

// How light a surface is drawn, 0 (black) to 1 (white).
async function lightnessOf(locator: Locator): Promise<number> {
  return await locator.evaluate((element: Element): number => {
    const match: RegExpMatchArray | null =
      getComputedStyle(element).backgroundColor.match(/\d+(\.\d+)?/g);
    if (!match) {
      return 1;
    }
    const [red, green, blue] = match.map(Number) as [number, number, number];
    return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  });
}

function fleetTiles(page: Page): Locator {
  return page.getByTestId("cloud-fleet-summary-tile");
}

const TABLET: { width: number; height: number } = { width: 768, height: 900 };

// How many lines an element's text takes: one box per line it runs over.
async function lineCountOf(locator: Locator): Promise<number> {
  return await locator.evaluate((element: Element): number => {
    const range: Range = document.createRange();
    range.selectNodeContents(element);
    const tops: Set<number> = new Set<number>();
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width > 0) {
        tops.add(Math.round(rect.top));
      }
    }
    return tops.size;
  });
}

/*
 * Where an environment's state is drawn, against its name: "end" when it
 * ends the row (its right edge on the row's), "under" when it starts its
 * own line where the name starts, "hidden" when it is read out only.
 */
async function environmentStatePlaces(page: Page): Promise<Array<string>> {
  return await page
    .getByTestId("app-platforms-environment")
    .evaluateAll((rows: Array<Element>): Array<string> => {
      return rows.map((row: Element): string => {
        const status: Element = row.querySelector(
          "[data-testid='app-platforms-environment-status']",
        )!;
        const name: Element = row.querySelector("a")!;
        const statusBox: DOMRect = status.getBoundingClientRect();
        const nameBox: DOMRect = name.getBoundingClientRect();
        const rowBox: DOMRect = row.getBoundingClientRect();

        if (statusBox.width <= 1 && statusBox.height <= 1) {
          return "hidden";
        }
        if (
          Math.abs(statusBox.right - rowBox.right) <= 1 &&
          Math.abs(statusBox.top - nameBox.top) <= 4
        ) {
          return "end";
        }
        if (
          statusBox.top >= nameBox.bottom - 1 &&
          Math.abs(statusBox.left - nameBox.left) <= 1
        ) {
          return "under";
        }
        return `elsewhere ${JSON.stringify([statusBox, nameBox, rowBox])}`;
      });
    });
}

function platformGroups(page: Page): Locator {
  return page.getByTestId("app-platforms-platform");
}

/*
 * ---------------------------------------------------------------------------
 * The Overview
 * ---------------------------------------------------------------------------
 */
test.describe("the Overview", () => {
  test("counts the environments, then groups them by platform, and never lists a cloud resource", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, APP_PLATFORMS);

    await expect(pageHeading(page)).toHaveText("App Platforms");
    expect(await trailOf(page)).toEqual(["Project", "App Platforms"]);
    await expect(litEntry(page)).toHaveCount(1);
    await expect(litEntry(page)).toHaveAttribute("href", APP_PLATFORMS);
    await expect(litEntry(page)).toHaveText("Overview");

    /*
     * The strip: six apps, two of them quiet; six environments, one of them
     * disconnected - the one that never reported waits, as its platform's
     * card says, and is not called disconnected; two deploys in the last
     * day; seven live tasks.
     */
    await expect(fleetTiles(page)).toHaveCount(4);
    const values: Array<string> = await fleetTiles(page).evaluateAll(
      (tiles: Array<Element>): Array<string> => {
        return tiles.map((tile: Element): string => {
          return (tile.querySelector(".text-2xl")?.textContent || "").trim();
        });
      },
    );
    expect(values).toEqual(["6", "6", "2", "7"]);
    await expect(
      page.getByTestId("cloud-fleet-summary-tile-sublabel"),
    ).toHaveText([
      "2 not reporting",
      "1 environment disconnected",
      "in the last 24 hours",
      "seen in the last 15 min",
    ]);

    /*
     * Recent deploys: every deploy, the newest first, from what to what -
     * not the first revision an app reported, which is no deploy. Where it
     * runs reads as All Apps says it: "cluster production".
     */
    const deploys: Locator = page.getByTestId("recent-deploy");
    await expect(deploys).toHaveCount(4);
    await expect(deploys.nth(0)).toContainText("checkout-api");
    await expect(deploys.nth(0)).toContainText("42 → 43");
    await expect(deploys.nth(0)).toContainText("AWS ECS · cluster production");
    await expect(deploys.nth(1)).toContainText("api");
    await expect(deploys.nth(1)).toContainText("00041-abc → 00042-xyz");
    await expect(deploys.nth(2)).toContainText("reports");
    await expect(deploys.nth(2)).toContainText("v11def → v12abc");
    await expect(deploys.nth(3)).toContainText("41 → 42");

    // Four in a row, the breakdown whole: wrapped, never cut.
    const tileTops: Set<number> = new Set(
      await fleetTiles(page).evaluateAll(
        (tiles: Array<Element>): Array<number> => {
          return tiles.map((tile: Element): number => {
            return Math.round(tile.getBoundingClientRect().top);
          });
        },
      ),
    );
    expect(tileTops.size).toBe(1);
    for (const line of await page
      .getByTestId("cloud-fleet-summary-tile-sublabel")
      .all()) {
      expect(await isCut(line)).toBe(false);
    }

    // Busiest platform first; each lists its environments, the quiet ones said so.
    await expect(platformGroups(page)).toHaveCount(4);
    expect(
      await platformGroups(page).evaluateAll(
        (groups: Array<Element>): Array<string | null> => {
          return groups.map((group: Element): string | null => {
            return group.getAttribute("data-platform");
          });
        },
      ),
    ).toEqual([
      "aws_ecs",
      "gcp_cloud_run",
      "azure_container_apps",
      "azure_app_service",
    ]);
    const ecs: Locator = platformGroups(page).first();
    await expect(ecs).toContainText("AWS ECS / Fargate");
    await expect(ecs.getByTestId("app-platforms-platform-status")).toHaveText(
      "1 environment disconnected",
    );
    await expect(
      page
        .getByTestId("app-platforms-environment")
        .filter({ hasText: "billing" })
        .getByTestId("app-platforms-environment-status"),
    ).toHaveText("Last seen 3 hours ago");
    await expect(
      page
        .getByTestId("app-platforms-environment")
        .filter({ hasText: "web · eastus" })
        .getByTestId("app-platforms-environment-status"),
    ).toHaveText("Waiting for its first data");
    await expect(page.getByTestId("app-platforms-environment")).toHaveCount(6);

    // The cloud account's resource is Cloud's.
    await expect(page.getByText(RESOURCE_NAME)).toHaveCount(0);
    const environmentReads: Array<ListRequest> = (
      await recorded(page)
    ).listRequests.filter((request: ListRequest): boolean => {
      return request.modelName === "CloudResource";
    });
    expect(environmentReads.length).toBeGreaterThan(0);
    for (const request of environmentReads) {
      expect(request.query["cloudResourceKind"]).toBe("environment");
    }

    await screenshot(page, "app-platforms-overview-1280");
  });

  test("an environment's row opens its page in App Platforms", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, APP_PLATFORMS);

    await page.getByRole("link", { name: CHECKOUT_NAME }).click();

    await expect(page).toHaveURL(CHECKOUT);
    await expect(pageHeading(page)).toHaveText(
      `Cloud Environment - ${CHECKOUT_NAME}`,
    );
    await sideMenuAtRest(page);
    expect(await trailOf(page)).toEqual([
      "Project",
      "App Platforms",
      CHECKOUT_NAME,
    ]);
    // The trail leads back to the product.
    await expect(
      trail(page).getByRole("link", { name: "App Platforms" }),
    ).toHaveAttribute("href", APP_PLATFORMS);
    await expect(litEntry(page)).toHaveAttribute("href", CHECKOUT);
  });

  test("on a phone: the strip's titles stay clear of its icons, and nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await open(page, APP_PLATFORMS);
    await expect(fleetTiles(page)).toHaveCount(4);

    // Two to a row.
    const tops: Array<number> = await fleetTiles(page).evaluateAll(
      (tiles: Array<Element>): Array<number> => {
        return tiles.map((tile: Element): number => {
          return Math.round(tile.getBoundingClientRect().top);
        });
      },
    );
    expect(new Set(tops).size).toBe(2);

    /*
     * A tile is too narrow for the title, its (i) and the icon: the icon,
     * which only decorates, makes way, and nothing runs out of its tile.
     */
    for (const tile of await fleetTiles(page).all()) {
      await expect(
        tile.getByTestId("cloud-fleet-summary-tile-icon"),
      ).toBeHidden();
      const tileBox: Box = await boxOf(tile);
      for (const part of [
        tile.locator("span").first(),
        tile.getByRole("button"),
        tile.getByTestId("cloud-fleet-summary-tile-sublabel"),
      ]) {
        const box: Box = await boxOf(part);
        expect(box.x).toBeGreaterThanOrEqual(tileBox.x - 0.5);
        expect(box.x + box.width).toBeLessThanOrEqual(
          tileBox.x + tileBox.width + 0.5,
        );
      }
    }

    await expectNoSidewaysScroll(page);
    await screenshot(page, "app-platforms-overview-390");

    // The side menu is behind its button, which names the page.
    const toggle: Locator = page.getByTestId("mobile-sidemenu-toggle");
    await expect(toggle).toContainText("App Platforms");
    await expect(toggle).toContainText("Overview");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel: Locator = page.locator(
      `[id="${await toggle.getAttribute("aria-controls")}"]`,
    );
    await expect(
      panel.getByRole("link", { name: "All Environments" }),
    ).toBeVisible();
    await expect(panel.locator("[aria-current='page']")).toHaveText("Overview");
    await sideMenuAtRest(page);
    await screenshot(page, "app-platforms-overview-390-menu");
  });

  /*
   * The healthy rows stay quiet - their dot says it, and the word is read
   * out only - so the rows that need a look are the ones with words. Laid
   * out by the room the card gives each platform: at a laptop's width an
   * environment's state ends its row, in one column down the card; beside
   * the side menu at 768 and on a phone it goes under the name, the same
   * way on every row - never beside one name and under the next.
   */
  test("only the rows that need a look say so, at the end of the row or under the name, the same on every row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, APP_PLATFORMS);
    await expect(page.getByTestId("app-platforms-environment")).toHaveCount(6);

    const states: Array<string> = await page
      .getByTestId("app-platforms-environment")
      .evaluateAll((rows: Array<Element>): Array<string> => {
        return rows.map((row: Element): string => {
          return row.getAttribute("data-state") || "";
        });
      });
    expect(states.sort()).toEqual([
      "connected",
      "connected",
      "connected",
      "connected",
      "quiet",
      "waiting",
    ]);

    const atLaptop: Array<string> = await environmentStatePlaces(page);
    expect(
      atLaptop.filter((place: string) => {
        return place === "hidden";
      }),
    ).toHaveLength(4);
    expect(
      atLaptop.filter((place: string) => {
        return place === "end";
      }),
    ).toHaveLength(2);

    for (const size of [TABLET, PHONE]) {
      await page.setViewportSize(size);
      await expect
        .poll(async (): Promise<Array<string>> => {
          return (await environmentStatePlaces(page)).filter(
            (place: string): boolean => {
              return place !== "hidden";
            },
          );
        })
        .toEqual(["under", "under"]);
    }

    // The dot is the colour of the words beside it.
    const quiet: Locator = page
      .getByTestId("app-platforms-environment")
      .filter({ hasText: "billing" });
    const dotColour: string = await quiet
      .getByTestId("app-platforms-environment-dot")
      .evaluate((dot: Element): string => {
        return getComputedStyle(dot).backgroundColor;
      });
    const wordsColour: string = await quiet
      .getByTestId("app-platforms-environment-status")
      .evaluate((words: Element): string => {
        return getComputedStyle(words).color;
      });
    // Both amber: red well above blue.
    for (const colour of [dotColour, wordsColour]) {
      const [red, , blue] = (colour.match(/\d+/g) || []).map(Number) as [
        number,
        number,
        number,
      ];
      expect(red - blue).toBeGreaterThan(100);
    }

    await screenshot(page, "app-platforms-overview-390-rows");
  });

  test("on a phone, a platform keeps its name on one line: its state goes under it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await open(page, APP_PLATFORMS);
    await expect(platformGroups(page)).toHaveCount(4);

    for (const group of await platformGroups(page).all()) {
      const title: Locator = group.locator(".font-semibold").first();
      expect(await lineCountOf(title)).toBe(1);
      const titleBox: Box = await boxOf(title);
      const stateBox: Box = await boxOf(
        group.getByTestId("app-platforms-platform-status"),
      );
      expect(stateBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
      expect(Math.abs(stateBox.x - titleBox.x)).toBeLessThanOrEqual(1);
    }

    // At a laptop's width the state is back beside the name.
    await page.setViewportSize(LAPTOP);
    const ecs: Locator = platformGroups(page).first();
    await expect
      .poll(async (): Promise<boolean> => {
        const titleBox: Box = await boxOf(
          ecs.locator(".font-semibold").first(),
        );
        const stateBox: Box = await boxOf(
          ecs.getByTestId("app-platforms-platform-status"),
        );
        return stateBox.y < titleBox.y + titleBox.height;
      })
      .toBe(true);
  });

  test("the providers' breakdown wraps between providers, never inside one", async ({
    page,
  }: {
    page: Page;
  }) => {
    // With every environment connected, the line says which clouds they are on.
    for (const size of [LAPTOP, TABLET, PHONE]) {
      await page.setViewportSize(size);
      await open(page, `${APP_PLATFORMS}?state=connected`);

      const parts: Locator = page.getByTestId(
        "cloud-fleet-summary-tile-sublabel-part",
      );
      await expect(parts).toHaveText(["2 AWS", "2 Azure", "2 Google Cloud"]);
      for (const part of await parts.all()) {
        expect(await lineCountOf(part)).toBe(1);
      }
    }
  });

  test("dark: the strip, the platforms and the menu are drawn on dark surfaces, at both widths", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${APP_PLATFORMS}?theme=dark`);

    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(await lightnessOf(fleetTiles(page).first())).toBeLessThan(0.3);
    expect(await lightnessOf(desktopMenu(page))).toBeLessThan(0.3);
    expect(await lightnessOf(page.locator("body"))).toBeLessThan(0.3);
    await screenshot(page, "app-platforms-overview-1280-dark");

    await page.setViewportSize(PHONE);
    await expect(page.getByTestId("mobile-sidemenu-toggle")).toBeVisible();
    expect(await lightnessOf(fleetTiles(page).first())).toBeLessThan(0.3);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "app-platforms-overview-390-dark");
  });

  test("with no environment yet, it shows how to start, and no strip", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${APP_PLATFORMS}?state=empty`);

    // What the product shows: every app and its deploys.
    await expect(
      page.getByText("See every app your cloud platforms run").first(),
    ).toBeVisible();
    await expect(
      page.getByText("Deploys and rollbacks", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("cloud-fleet-summary")).toHaveCount(0);
    await expect(platformGroups(page)).toHaveCount(0);
    await screenshot(page, "app-platforms-overview-empty-1280");

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "app-platforms-overview-empty-390");
  });
});

/*
 * ---------------------------------------------------------------------------
 * An environment's pages
 * ---------------------------------------------------------------------------
 */
test.describe("an environment's pages", () => {
  test("its Overview is the environment's own: its live instances, requests, errors and latency", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, CHECKOUT);

    const tiles: Locator = page.getByTestId("resource-overview-tiles");
    // Three tasks at 30, 36 and 42% CPU; 256, 512 and 768 MiB.
    await expect(tiles).toContainText("36.0%");
    await expect(tiles).toContainText("1.5 GiB");
    // Its spans: some 1,300 requests, a few errored, a p95 of 122 ms.
    await expect(tiles).toContainText("1.3k");
    await expect(tiles).toContainText("122 ms");
    await expect(tiles).toContainText("1.5%");
    await expect(page.getByText("checkout/3a2b3c4d5e6f7")).toBeVisible();

    // The telemetry it reads is scoped to its platform, account and region.
    const instanceReads: Array<ListRequest> = (
      await recorded(page)
    ).listRequests.filter((request: ListRequest): boolean => {
      return request.modelName === "CloudResourceInstance";
    });
    expect(
      instanceReads.filter((request: ListRequest): boolean => {
        return request.query["cloudResourceId"] !== undefined;
      }),
    ).toEqual([
      {
        modelName: "CloudResourceInstance",
        query: { cloudResourceId: CHECKOUT_ID },
      },
    ]);

    /*
     * Its apps, the quiet one first, each with what it runs; their live
     * tasks read by app, and their deploys marked on both charts.
     */
    const apps: Locator = page.getByTestId("environment-app");
    await expect(apps).toHaveCount(2);
    await expect(apps.nth(0)).toContainText("inventory");
    await expect(apps.nth(0)).toContainText("Last seen 2 hours ago");
    await expect(apps.nth(1)).toContainText("checkout-api");
    await expect(apps.nth(1)).toContainText("Revision 43 · 3 instances");
    await expect(apps.nth(1)).toContainText("1.5% errors");
    await expect(apps.nth(1).getByRole("link")).toHaveAttribute(
      "href",
      CHECKOUT_APP,
    );
    expect(
      instanceReads.filter((request: ListRequest): boolean => {
        return request.query["cloudAppId"] !== undefined;
      }),
    ).toHaveLength(1);
    await expect(page.getByTestId("chart-annotation-marker")).toHaveCount(2);

    await screenshot(page, "app-platforms-environment-overview-1280");

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "app-platforms-environment-overview-390");
  });

  const TABS: Array<{ path: string; entry: string; crumb: string }> = [
    { path: "documentation", entry: "Documentation", crumb: "Documentation" },
    { path: "metrics", entry: "Metrics", crumb: "Metrics" },
    { path: "logs", entry: "Logs", crumb: "Logs" },
    { path: "traces", entry: "Traces", crumb: "Traces" },
    { path: "instances", entry: "Instances", crumb: "Instances" },
    { path: "feed", entry: "Feed", crumb: "Feed" },
    { path: "incidents", entry: "Incidents", crumb: "Incidents" },
    { path: "alerts", entry: "Alerts", crumb: "Alerts" },
    { path: "settings", entry: "Settings", crumb: "Settings" },
    { path: "owners", entry: "Owners", crumb: "Owners" },
    {
      path: "delete",
      entry: "Delete Environment",
      crumb: "Delete Environment",
    },
  ];

  test("every tab stays in App Platforms: its trail, its lit entry, the environment's heading", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.slow();
    await page.setViewportSize(LAPTOP);

    for (const tab of TABS) {
      await open(page, `${CHECKOUT}/${tab.path}`);

      await expect(page).toHaveURL(new RegExp(`${CHECKOUT}/${tab.path}`));
      await expect(pageHeading(page)).toHaveText(
        `Cloud Environment - ${CHECKOUT_NAME}`,
      );
      expect(await trailOf(page), tab.path).toEqual([
        "Project",
        "App Platforms",
        CHECKOUT_NAME,
        tab.crumb,
      ]);
      await expect(litEntry(page), tab.path).toHaveText(tab.entry);
      await expect(litEntry(page), tab.path).toHaveAttribute(
        "href",
        `${CHECKOUT}/${tab.path}`,
      );
    }
  });

  /*
   * Its Documentation is the platform's setup guide in the reader's
   * language (#6060): the picker's lines, the steps and their tabs are the
   * reader's words, and the commands and configurations stay as typed.
   */
  test("its Documentation guide reads in German, and in Persian right to left on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    const sentences: Array<string> = [
      "Tasks on Amazon Elastic Container Service, on Fargate or EC2 launch types.",
      "An ECS cluster, and a task definition you can revise",
      "Pick a Server key, or create one — the commands below update to use it.",
    ];

    await page.setViewportSize(LAPTOP);
    await open(page, `${CHECKOUT}/documentation?lang=de`);
    const guide: Locator = page.getByTestId("setup-guide");
    for (const english of sentences) {
      await expect(guide).toContainText(GERMAN[english]!);
      await expect(guide).not.toContainText(english);
    }
    await expect(guide.getByRole("tab")).toContainText([
      GERMAN["Sidecar collector"]!,
      "SDK direct",
    ]);
    // A command stays as it is typed.
    await expect(guide).toContainText("aws secretsmanager create-secret");
    await screenshot(page, "app-platforms-environment-documentation-de-1280");

    /*
     * The task definition's steps name more of the console's English labels
     * than German words: a list in the reader's language reads its way.
     */
    await expect(
      guide.getByTestId("setup-guide-step-3").locator("ol").first(),
    ).toHaveCSS("direction", "ltr");

    await page.setViewportSize(PHONE);
    await open(page, `${CHECKOUT}/documentation?lang=fa`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    for (const english of sentences) {
      await expect(page.getByTestId("setup-guide")).toContainText(
        PERSIAN[english]!,
      );
    }
    /*
     * Every block reads right to left (the UI review of #6149): the steps
     * through the AWS console name more English labels than Persian
     * words, and laid out by their letters they read left to right, their
     * numbers on the wrong side.
     */
    const consoleSteps: Locator = page
      .getByTestId("setup-guide-step-3")
      .locator("ol")
      .first();
    await expect(consoleSteps).toHaveCSS("direction", "rtl");
    expect(
      await consoleSteps
        .locator(":scope > li")
        .evaluateAll((items: Array<Element>): Array<string> => {
          return items.map((item: Element): string => {
            return getComputedStyle(item).direction;
          });
        }),
    ).not.toContain("ltr");
    await expect(
      page.getByTestId("setup-guide-step-3").locator("h3 + p"),
    ).toHaveCSS("direction", "rtl");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "app-platforms-environment-documentation-fa-390");
  });

  test("its Logs and Traces are scoped to its platform, account and region", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);

    for (const tab of ["logs", "traces"]) {
      await open(page, `${CHECKOUT}/${tab}`);
      const main: Locator = page.locator("main, body").first();
      await expect(main).toContainText("Platform:");
      await expect(main).toContainText("aws_ecs");
      await expect(main).toContainText("4109-2277-8841");
      await expect(main).toContainText("us-east-1");
    }

    await screenshot(page, "app-platforms-environment-traces-1280");
  });

  test("Instances lists its running tasks, counted as instances", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${CHECKOUT}/instances`);

    await expect(page.getByText("Showing 1-3 of 3 instances")).toBeVisible();
    await expect(page.getByText(/cloud resource instances/i)).toHaveCount(0);
    for (const number of [1, 2, 3]) {
      await expect(
        page.getByText(`checkout/${number}a2b3c4d5e6f7`),
      ).toBeVisible();
    }
    await screenshot(page, "app-platforms-environment-instances-1280");
  });

  test("Delete Environment deletes a cloud environment, and names it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${CHECKOUT}/delete`);

    await expect(
      page.getByRole("heading", { name: "Delete Cloud Environment" }),
    ).toBeVisible();
    await expect(page.getByText(/cloud resource/i)).toHaveCount(0);
    await expect(page.getByTestId("model-delete-card-message")).toContainText(
      `Permanently delete ${CHECKOUT_NAME}.`,
    );

    await page
      .getByRole("button", { name: "Delete Cloud Environment" })
      .click();
    const dialog: Locator = page.getByRole("dialog", {
      name: "Delete Cloud Environment",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      `Are you sure you want to delete ${CHECKOUT_NAME}?`,
    );
    await screenshot(page, "app-platforms-environment-delete-dialog-1280");

    // Nothing is deleted: the dialog closes on Cancel.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect(
      (await recorded(page)).apiRequests.filter(
        (request: { method: string }): boolean => {
          return request.method === "DELETE";
        },
      ),
    ).toEqual([]);
  });

  test("Settings names it an environment, and its archive card says what archiving does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${CHECKOUT}/settings`);

    await expect(
      page.getByRole("heading", { name: "Environment Details" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Archive cloud environment" }),
    ).toBeVisible();
    await screenshot(page, "app-platforms-environment-settings-1280");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Apps and their deploys
 * ---------------------------------------------------------------------------
 */
test.describe("apps and their deploys", () => {
  test("All Apps lists every app with its state, its revision and its last hour, the quiet ones said so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${APP_PLATFORMS}/apps`);

    expect(await trailOf(page)).toEqual(["Project", "App Platforms", "Apps"]);
    await expect(litEntry(page)).toHaveText("All Apps");

    const rows: Locator = page.locator("table tbody tr");
    await expect(rows).toHaveCount(APP_NAMES.length);
    for (const [index, name] of APP_NAMES.entries()) {
      await expect(rows.nth(index)).toContainText(name);
    }
    await expect(page.locator("table thead th")).toHaveText([
      "App",
      "Status",
      "Revision",
      "Last hour",
      "Actions",
    ]);

    // checkout-api: where it runs, three live tasks, revision 43, its hour.
    const checkout: Locator = rows.filter({ hasText: "checkout-api" });
    await expect(checkout).toContainText(
      "AWS ECS · us-east-1 · cluster production",
    );
    await expect(checkout).toContainText("Running");
    await expect(checkout).toContainText("3 instances");
    await expect(checkout).toContainText("43");
    await expect(checkout).toContainText("Deployed 25 minutes ago");
    await expect(checkout).toContainText("1.5% errors");
    await expect(checkout).toContainText("1.3k requests · p95 122 ms");
    // A Cloud Run revision without its service's name; a quiet app says when.
    await expect(rows.filter({ hasText: "api" }).first()).toContainText(
      "00042-xyz",
    );
    await expect(rows.filter({ hasText: "inventory" })).toContainText(
      "Not reporting",
    );
    await expect(rows.filter({ hasText: "inventory" })).toContainText(
      "Last seen 2 hours ago",
    );

    /*
     * Only the unarchived environments' apps, and their numbers in one
     * grouped read of entry spans for each environment and naming.
     */
    const reads: Recorded = await recorded(page);
    const appReads: Array<ListRequest> = reads.listRequests.filter(
      (request: ListRequest): boolean => {
        return request.modelName === "CloudApp";
      },
    );
    expect(appReads).toHaveLength(1);
    expect(
      (appReads[0]!.query["cloudResourceId"] as { includes: Array<string> })
        .includes,
    ).toHaveLength(6);
    expect(reads.analyticsRequests).toHaveLength(5);
    for (const request of reads.analyticsRequests) {
      expect(request.entryOnly).toBe(true);
      expect(request.filters["resource.cloud.platform"]).toBeTruthy();
    }
    await screenshot(page, "app-platforms-apps-1280");

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "app-platforms-apps-390");
  });

  test("an app's row opens its page, under its environment, with Apps lit", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${APP_PLATFORMS}/apps`);

    await page.getByRole("link", { name: "checkout-api", exact: true }).click();

    await expect(page).toHaveURL(CHECKOUT_APP);
    await expect(page.getByTestId("cloud-app-name")).toHaveText("checkout-api");
    await sideMenuAtRest(page);
    expect(await trailOf(page)).toEqual([
      "Project",
      "App Platforms",
      CHECKOUT_NAME,
      "Apps",
      "View App",
    ]);
    // The environment's Apps holds the app's page: lit, and said so.
    await expect(desktopMenu(page).locator("[aria-current='true']")).toHaveText(
      "Apps",
    );
  });

  test("an app's page says who it is, where it runs, what it runs now and how it is doing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, CHECKOUT_APP);

    const header: Locator = page.getByTestId("cloud-app-header");
    await expect(page.getByTestId("cloud-app-header-state")).toHaveText(
      "Running",
    );
    await expect(header).toContainText("3 instances");
    await expect(
      header.getByRole("link", {
        name: "AWS ECS / Fargate · us-east-1 · cluster production",
      }),
    ).toHaveAttribute("href", CHECKOUT);
    await expect(page.getByTestId("cloud-app-header-revision")).toHaveText(
      "Revision 43 · Deployed 25 minutes ago · Replaced 42",
    );
    /*
     * Alerts that work out of the box: its own recommended monitors, on its
     * Recommendations tab - a button of the page, not a link to its
     * service's, which another app of the image can share.
     */
    await expect(
      header.getByRole("button", { name: "Set up alerts" }),
    ).toBeVisible();
    await expect(
      header.getByRole("link", { name: "Set up alerts" }),
    ).toHaveCount(0);
    await expect(
      header.getByRole("link", { name: "checkout-api" }),
    ).toHaveAttribute("href", `${DASHBOARD}/service/${CHECKOUT_SERVICE_ID}`);

    await expect(page.getByRole("tab")).toHaveText([
      "Overview",
      "Revisions3",
      "Instances",
      "Logs",
      "Traces",
      "Recommendations",
    ]);

    // Its numbers, its live tasks, and the revisions they run right now.
    const tiles: Locator = page.getByTestId("cloud-app-tiles");
    await expect(tiles).toContainText("1.3k");
    await expect(tiles).toContainText("122 ms");
    await expect(tiles).toContainText("36.0%");
    await expect(tiles).toContainText("1.5 GiB");
    /*
     * Each revision its live tasks run, named as the Revisions tab names it:
     * 43 Current on two, 42 still Running on one - and, two at once, what
     * that means.
     */
    await expect(page.getByTestId("cloud-app-running-revision")).toHaveText([
      "43Current2 instances",
      "42Running1 instance",
    ]);
    await expect(page.getByTestId("cloud-app-running-now-split")).toContainText(
      "a deploy in progress, or traffic split between them",
    );
    // The deploy 25 minutes ago, marked on both charts.
    await expect(page.getByTestId("chart-annotation-marker")).toHaveCount(2);
    /*
     * Details names each attribute as the chips do, its key beside it, and
     * the revision under the attribute it is read from.
     */
    const details: Locator = page.getByTestId("cloud-app-detail-row");
    await expect(details.getByTestId("cloud-app-detail-label")).toHaveText([
      "App",
      "Cluster",
      "Task definition revision",
      "Image",
      "First Seen",
    ]);
    await expect(details.getByTestId("cloud-app-detail-attribute")).toHaveText([
      "aws.ecs.task.family",
      "aws.ecs.cluster.arn",
      "aws.ecs.task.revision",
    ]);
    await expect(details.nth(2).locator("dd")).toHaveText("43");
    await screenshot(page, "app-platforms-app-overview-1280");

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "app-platforms-app-overview-390");
  });

  /*
   * Set up alerts opens the app's own recommended monitors - its requests
   * failing, bursting, stopping and slowing - and each one it makes reads
   * the app's spans or request durations by the filter its Traces tab
   * reads them by, never by a service, and is linked to its environment.
   */
  test("Set up alerts opens its Recommendations, and makes its five monitors for it in one step", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, CHECKOUT_APP);

    await page
      .getByTestId("cloud-app-header")
      .getByRole("button", { name: "Set up alerts" })
      .click();

    const recommendationsTab: Locator = page.getByRole("tab", {
      name: "Recommendations",
    });
    await expect(recommendationsTab).toHaveAttribute("aria-selected", "true");
    await expect(recommendationsTab).toBeFocused();

    const panel: Locator = page.getByRole("tabpanel");
    await expect(panel).toContainText(
      "Monitors OneUptime recommends for this app, from the requests its OpenTelemetry reports.",
    );
    await expect(panel).toContainText("0 of 5 recommended monitors created");
    for (const name of [
      "Failed Operations",
      "Error Burst",
      "Traffic Stopped",
      "High Request Latency (p95)",
      "Severe Request Latency (p99)",
    ]) {
      await expect(panel.getByText(name, { exact: true })).toBeVisible();
    }

    // Its own row and its environment's, read with the person's rights.
    const items: Array<{ modelName: string; id: string }> = (
      await recorded(page)
    ).itemRequests;
    expect(
      items.filter((item: { modelName: string; id: string }): boolean => {
        return item.modelName === "CloudApp";
      }).length,
    ).toBe(2);
    await screenshot(page, "app-platforms-app-recommendations-1280");

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "app-platforms-app-recommendations-390");

    /*
     * Beside the side menu at a tablet's width the six tabs wrap rather
     * than run past the page: the row scrolled it sideways from 768px.
     */
    await page.setViewportSize(TABLET);
    await expectNoSidewaysScroll(page);
    await expect(recommendationsTab).toBeVisible();
    await screenshot(page, "app-platforms-app-recommendations-768");
    await page.setViewportSize(LAPTOP);

    // Every section's Select all - errors, throughput, latency - then one Create.
    const selectAll: Locator = panel.getByRole("button", {
      name: /^Select all \d+$/,
    });
    await expect(selectAll).toHaveCount(3);
    for (let section: number = 0; section < 3; section++) {
      await selectAll.first().click();
    }
    await expect(selectAll).toHaveCount(0);
    await panel
      .getByRole("button", { name: "Create 5 Selected Monitors" })
      .first()
      .click();
    await page.getByRole("button", { name: "Create Monitors" }).last().click();

    // A clean run closes its panel, and the tab reads what covers each again.
    await expect(panel).toContainText("5 of 5 recommended monitors created");

    const filter: Record<string, string> = {
      "resource.cloud.platform": "aws_ecs",
      "resource.cloud.account.id": "4109-2277-8841",
      "resource.cloud.region": "us-east-1",
      "resource.aws.ecs.cluster.arn":
        "arn:aws:ecs:us-east-1:4109-2277-8841:cluster/production",
      "resource.aws.ecs.task.family": "checkout-api",
    };
    const creates: Array<CreatedMonitor> = (await recorded(page)).creates;
    expect(
      creates
        .map((created: CreatedMonitor): string => {
          return `${created.name} (${created.monitorType})`;
        })
        .sort(),
    ).toEqual([
      "checkout-api - Error Burst (Traces)",
      "checkout-api - Failed Operations (Traces)",
      "checkout-api - High Request Latency (p95) (Metrics)",
      "checkout-api - Severe Request Latency (p99) (Metrics)",
      "checkout-api - Traffic Stopped (Traces)",
    ]);
    for (const created of creates) {
      expect(created.scope, created.name).toEqual(filter);
      expect(created.serviceIds, created.name).toEqual([]);
      expect(created.cloudResourceIds, created.name).toEqual([CHECKOUT_ID]);
    }
    expect(
      creates
        .filter((created: CreatedMonitor): boolean => {
          return created.monitorType === "Metrics";
        })
        .map((created: CreatedMonitor): string | null => {
          return created.metricName;
        }),
    ).toEqual(["http.server.request.duration", "http.server.request.duration"]);
    await screenshot(page, "app-platforms-app-recommendations-created-1280");
  });

  test("Revisions lists every revision newest first: the one it runs, the one still draining, the one retired", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${CHECKOUT_APP}?tab=Revisions`);

    await expect(page.getByRole("tab", { name: /Revisions/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const rows: Locator = page.locator("table tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("43");
    await expect(rows.nth(0)).toContainText("Replaced 42");
    await expect(rows.nth(0)).toContainText("Current");
    await expect(rows.nth(0)).toContainText("2 instances");
    await expect(rows.nth(0)).toContainText("820");
    await expect(rows.nth(0)).toContainText("2.2%");
    await expect(rows.nth(0)).toContainText("131 ms");
    await expect(rows.nth(1)).toContainText("Running");
    await expect(rows.nth(1)).toContainText("1 instance");
    await expect(rows.nth(1)).toContainText("0.2%");
    await expect(rows.nth(2)).toContainText("First revision seen");
    await expect(rows.nth(2)).toContainText("Retired");

    // One read for every revision's numbers, grouped by the app's revision.
    const reads: Array<AnalyticsRequest> = (await recorded(page))
      .analyticsRequests;
    expect(reads).toEqual([
      {
        groupBy: ["resource.aws.ecs.task.revision"],
        filters: {
          "resource.cloud.platform": "aws_ecs",
          "resource.cloud.account.id": "4109-2277-8841",
          "resource.cloud.region": "us-east-1",
          "resource.aws.ecs.cluster.arn":
            "arn:aws:ecs:us-east-1:4109-2277-8841:cluster/production",
          "resource.aws.ecs.task.family": "checkout-api",
        },
        entryOnly: true,
      },
    ]);
    await screenshot(page, "app-platforms-app-revisions-1280");

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "app-platforms-app-revisions-390");
  });

  test("its Instances, Logs and Traces are the app's own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${CHECKOUT_APP}?tab=Instances`);

    // Its three tasks, each with the revision it runs; no App column.
    const rows: Locator = page.locator("table tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(page.locator("table thead th")).toHaveText([
      "Instance",
      "Revision",
      "Status",
      "CPU",
      "Memory",
      "Last Seen",
    ]);
    await expect(rows.nth(2)).toContainText("checkout/3a2b3c4d5e6f7");
    await expect(rows.nth(2)).toContainText("42");
    const instanceReads: Array<ListRequest> = (
      await recorded(page)
    ).listRequests.filter((request: ListRequest): boolean => {
      return (
        request.modelName === "CloudResourceInstance" &&
        request.query["cloudResourceId"] !== undefined
      );
    });
    expect(instanceReads).toEqual([
      {
        modelName: "CloudResourceInstance",
        query: { cloudResourceId: CHECKOUT_ID, cloudAppId: CHECKOUT_APP_ID },
      },
    ]);

    // Logs and traces carry the environment's attributes and the app's own.
    for (const tab of ["Logs", "Traces"]) {
      await open(page, `${CHECKOUT_APP}?tab=${tab}`);
      const panel: Locator = page.getByRole("tabpanel");
      await expect(panel).toContainText("Platform:");
      await expect(panel).toContainText("us-east-1");
      await expect(panel).toContainText("Cluster:");
      await expect(panel).toContainText("production");
      await expect(panel).toContainText("App:");
      await expect(panel).toContainText("checkout-api");
    }
    await screenshot(page, "app-platforms-app-traces-1280");
  });

  test("an environment's Apps lists its own apps, and stays in its menu", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${CHECKOUT}/apps`);

    expect(await trailOf(page)).toEqual([
      "Project",
      "App Platforms",
      CHECKOUT_NAME,
      "Apps",
    ]);
    await expect(litEntry(page)).toHaveText("Apps");
    const rows: Locator = page.locator("table tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("checkout-api");
    await expect(rows.nth(1)).toContainText("inventory");
    // The menu groups what runs here: its apps and its instances.
    await expect(
      desktopMenu(page).getByRole("link", { name: "Instances" }),
    ).toHaveAttribute("href", `${CHECKOUT}/instances`);
    await screenshot(page, "app-platforms-environment-apps-1280");
  });

  /*
   * A revision the app went back to was not deployed then: the header said
   * "Deployed 40 minutes ago" for reports' rollback (#5511's UI review).
   */
  test("a rolled-back app says so in its header, on its charts and on its Revisions row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, REPORTS_APP);

    const revision: Locator = page.getByTestId("cloud-app-header-revision");
    await expect(revision).toHaveText(
      "Revision v11def · Rolled back 40 minutes ago · Replaced v12abc",
    );
    await expect(revision).toHaveAttribute("data-change", "rolled-back");
    // In amber, as its marker is on the charts.
    await expect(revision.getByTestId("cloud-app-fact-rolled-back")).toHaveCSS(
      "color",
      "rgb(180, 83, 9)",
    );
    /*
     * On both charts: a mark to hover or focus, not a button, as a lone
     * mark that opens nothing is.
     */
    await expect(page.getByRole("img", { name: ROLLBACK_MARKER })).toHaveCount(
      2,
    );
    await expect(
      page.getByRole("button", { name: ROLLBACK_MARKER }),
    ).toHaveCount(0);
    await screenshot(page, "app-platforms-app-rolled-back-1280");

    await open(page, `${REPORTS_APP}?tab=Revisions`);
    const rows: Locator = page.locator("table tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("v12abc");
    await expect(rows.nth(0)).toContainText("Retired");
    await expect(rows.nth(1)).toContainText("v11def");
    await expect(rows.nth(1)).toContainText("Current");
    await expect(
      rows.nth(1).getByTestId("cloud-app-revision-rolled-back"),
    ).toHaveText("Rolled back 40 minutes ago");
    await expect(
      rows.nth(0).getByTestId("cloud-app-revision-rolled-back"),
    ).toHaveCount(0);
    await screenshot(page, "app-platforms-app-rolled-back-revisions-1280");
  });

  /*
   * The facts under an app's name used to be squeezed beside its controls
   * to a word a line - "us-" over "east-1", "Revision 43 ·" over "Deployed
   * 25 minutes ago ·" - beside the side menu at 1024 and in German at 1280.
   * Now each fact is whole on its line, a dot shows only between two facts
   * on one line, and at 1024 the controls move under the name.
   */
  test("an app's header keeps its facts whole, and no dot hangs at a line's end", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [address, width] of [
      [CHECKOUT_APP, 1024],
      [`${CHECKOUT_APP}?lang=de`, 1280],
      [CHECKOUT_APP, 390],
      [`${CHECKOUT_APP}?lang=fa`, 390],
    ] as Array<[string, number]>) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, address);

      const header: Locator = page.getByTestId("cloud-app-header");
      const lines: Array<{
        line: string;
        fact: string;
        lines: number;
        top: number;
        previousTop: number | null;
        dotShown: boolean;
      }> = await header.evaluate(
        (
          element: Element,
        ): Array<{
          line: string;
          fact: string;
          lines: number;
          top: number;
          previousTop: number | null;
          dotShown: boolean;
        }> => {
          const result: Array<{
            line: string;
            fact: string;
            lines: number;
            top: number;
            previousTop: number | null;
            dotShown: boolean;
          }> = [];
          const rows: Array<Element> = Array.from(
            element.querySelectorAll(
              "[data-testid='cloud-app-header-where-facts'] > div, [data-testid='cloud-app-header-revision-facts'] > div",
            ),
          );
          for (const row of rows) {
            const clip: DOMRect = row.parentElement!.getBoundingClientRect();
            const facts: Array<Element> = Array.from(row.children);
            let previousTop: number | null = null;
            for (const fact of facts) {
              const text: Element = fact.querySelector("bdi")!;
              const range: Range = document.createRange();
              range.selectNodeContents(text);
              const tops: Set<number> = new Set<number>();
              for (const rect of Array.from(range.getClientRects())) {
                if (rect.width > 0) {
                  tops.add(Math.round(rect.top));
                }
              }
              const top: number = Math.min(...Array.from(tops));
              const dot: Element | null = fact.querySelector(
                "[data-testid='cloud-app-fact-separator']",
              );
              let dotShown: boolean = false;
              if (dot) {
                const box: DOMRect = dot.getBoundingClientRect();
                const middle: number = box.left + box.width / 2;
                dotShown = middle > clip.left && middle < clip.right;
              }
              result.push({
                line: row.parentElement!.getAttribute("data-testid") || "",
                fact: text.textContent || "",
                lines: tops.size,
                top,
                previousTop,
                dotShown,
              });
              previousTop = top;
            }
          }
          return result;
        },
      );

      expect(lines.length).toBeGreaterThanOrEqual(5);
      for (const line of lines) {
        // Each fact whole: "us-east-1", "Deployed 25 minutes ago".
        expect(line.lines, `${line.fact} at ${width}`).toBe(1);
        if (line.previousTop === null) {
          continue;
        }
        // A dot only between two facts on one line; none starting a line.
        expect(line.dotShown, `the dot before ${line.fact}`).toBe(
          line.top === line.previousTop,
        );
      }

      if (width === 1024) {
        /*
         * Beside the side menu the controls give way: the revision, when it
         * was deployed and what it replaced keep one line.
         */
        const revisionTops: Set<number> = new Set(
          lines
            .filter((fact: { line: string }): boolean => {
              return fact.line === "cloud-app-header-revision-facts";
            })
            .map((fact: { top: number }): number => {
              return fact.top;
            }),
        );
        expect(revisionTops.size).toBe(1);
      }
      await expectNoSidewaysScroll(page);
    }
  });

  /*
   * The lines an app's deploy and rollback write into its environment's
   * feed, as the server writes them: each says what replaced what, the
   * revision as the app's page says it, and links to the app.
   */
  test("an environment's feed says each deploy and rollback of its apps, linking to the app", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${CHECKOUT}/feed`);

    await expect(
      page.getByText("replaced", { exact: false }).first(),
    ).toContainText(
      "Deployed production/checkout-api: revision 43 replaced 42.",
    );
    await expect(
      page
        .getByTestId("feed-entry-body")
        .getByRole("link", { name: "production/checkout-api", exact: true }),
    ).toHaveAttribute("href", CHECKOUT_APP);
    await screenshot(page, "app-platforms-environment-feed-1280");

    await page.setViewportSize(PHONE);
    await open(page, `${APP_PLATFORMS}/${REPORTS_ID}/feed`);
    await expect(
      page.getByText("stopped reporting", { exact: false }).first(),
    ).toContainText(
      "Rolled back reports to revision v11def: revision v12abc stopped reporting.",
    );
    await expect(
      page
        .getByTestId("feed-entry-body")
        .getByRole("link", { name: "reports", exact: true }),
    ).toHaveAttribute("href", REPORTS_APP);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "app-platforms-environment-feed-390");
  });

  test("a recent deploy opens its app's Revisions", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, APP_PLATFORMS);

    await page
      .getByTestId("recent-deploy")
      .first()
      .getByRole("link", { name: "checkout-api" })
      .click();

    await expect(page).toHaveURL(`${CHECKOUT_APP}?tab=Revisions`);
    await expect(page.getByRole("tab", { name: /Revisions/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("table tbody tr")).toHaveCount(3);
  });

  test("dark: All Apps and an app's page are drawn on dark surfaces", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [address, name] of [
      [`${APP_PLATFORMS}/apps`, "app-platforms-apps-1280-dark"],
      [CHECKOUT_APP, "app-platforms-app-overview-1280-dark"],
    ] as Array<[string, string]>) {
      await page.setViewportSize(LAPTOP);
      await open(
        page,
        `${address}${address.includes("?") ? "&" : "?"}theme=dark`,
      );
      await expect(page.locator("html")).toHaveClass(/dark/);
      expect(await lightnessOf(page.locator("body"))).toBeLessThan(0.3);
      const surface: Locator = address.includes("/apps/")
        ? page.getByTestId("cloud-app-header")
        : page.locator("table").first();
      expect(await lightnessOf(surface)).toBeLessThan(0.3);
      await screenshot(page, name);
    }
  });

  test("German: All Apps and an app's page in the Dashboard's German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${APP_PLATFORMS}/apps?lang=de`);

    await expect(litEntry(page)).toHaveText(GERMAN["All Apps"]!);
    const checkout: Locator = page
      .locator("table tbody tr")
      .filter({ hasText: "checkout-api" });
    await expect(checkout).toContainText(GERMAN["Running"]!);
    await expect(
      page.locator("table tbody tr").filter({ hasText: "inventory" }),
    ).toContainText(GERMAN["Not reporting"]!);
    await screenshot(page, "app-platforms-apps-1280-de");

    await open(page, `${CHECKOUT_APP}?lang=de`);
    await expect(page.getByRole("tab").first()).toHaveText(GERMAN["Overview"]!);
    await expect(
      page.getByRole("tab", { name: new RegExp(GERMAN["Revisions"]!) }),
    ).toBeVisible();
    await expect(page.getByTestId("cloud-app-header")).toContainText(
      GERMAN["Set up alerts"]!,
    );
    await screenshot(page, "app-platforms-app-overview-1280-de");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The lists
 * ---------------------------------------------------------------------------
 */
test.describe("the Developer pages", () => {
  /*
   * One table holds App Platforms' environments and Cloud's resources:
   * App Platforms' Terraform page imports its environments only, so
   * following both products' pages never gives one row two resources.
   */
  test("Terraform imports the environments, never a cloud resource", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${APP_PLATFORMS}/environments/developer/terraform`);

    await expect(
      page.getByText("Bring in the cloud environments you already have"),
    ).toBeVisible();
    await expect(
      page.getByText("71000000-0000-4000-8000-000000000001").first(),
    ).toBeVisible();
    await expect(page.getByText(RESOURCE_ID)).toHaveCount(0);

    const imports: Array<ListRequest> = (
      await recorded(page)
    ).listRequests.filter((request: ListRequest): boolean => {
      return request.modelName === "CloudResource";
    });
    expect(imports.length).toBeGreaterThan(0);
    for (const request of imports) {
      expect(request.query).toMatchObject({ cloudResourceKind: "environment" });
    }
    await screenshot(page, "app-platforms-developer-terraform-1280");
  });
});

test.describe("All Environments and Archived", () => {
  test("All Environments lists the six environments, counted as cloud environments", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${APP_PLATFORMS}/environments`);

    for (const name of ENVIRONMENT_NAMES) {
      await expect(
        page.getByRole("link", { name: name }).first(),
      ).toBeVisible();
    }
    await expect(page.getByText(RESOURCE_NAME)).toHaveCount(0);
    await expect(
      page.getByText("Showing 1-6 of 6 cloud environments"),
    ).toBeVisible();

    /*
     * A row says where it runs once - its name holds the account and the
     * region, and no second line repeats them - and Last Seen stays in view
     * at a laptop's width, the labels and owners folded under the name.
     */
    const checkoutRow: Locator = page
      .locator("table tbody tr")
      .filter({ hasText: CHECKOUT_NAME });
    expect(
      ((await checkoutRow.textContent()) || "").split("4109-2277-8841").length,
    ).toBe(2);
    const lastSeen: Box = await boxOf(
      page.locator("table thead th").filter({ hasText: "Last Seen" }),
    );
    expect(lastSeen.x + lastSeen.width).toBeLessThanOrEqual(LAPTOP.width);
    await expect(
      page.locator("table tbody tr").filter({ hasText: "web · eastus" }),
    ).toContainText("Waiting");
    expect(await trailOf(page)).toEqual([
      "Project",
      "App Platforms",
      "Environments",
    ]);
    await expect(litEntry(page)).toHaveText("All Environments");

    const listReads: Array<ListRequest> = (
      await recorded(page)
    ).listRequests.filter((request: ListRequest): boolean => {
      return request.modelName === "CloudResource";
    });
    expect(listReads.length).toBeGreaterThan(0);
    for (const request of listReads) {
      expect(request.query).toMatchObject({
        isArchived: false,
        cloudResourceKind: "environment",
      });
    }

    await screenshot(page, "app-platforms-environments-1280");

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "app-platforms-environments-390");
  });

  /*
   * Cloud's Overview counts the environments and apps in the accounts it
   * reads, and each count opens its list with the Cloud Account chip set
   * to those accounts (#6060): the list arrives holding just them, the chip
   * drawn set, and clearing it lists everything again.
   */
  test("a list opened with the Cloud Account chip set holds that account's environments, and All Apps their apps", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(
      page,
      `${APP_PLATFORMS}/environments?${accountChipQuery("cloud-resources-table", ["4109-2277-8841"])}`,
    );

    await expect(
      page.getByText("Showing 1-2 of 2 cloud environments"),
    ).toBeVisible();
    for (const name of ENVIRONMENT_NAMES.slice(0, 2)) {
      await expect(
        page.getByRole("link", { name: name }).first(),
      ).toBeVisible();
    }
    for (const name of ENVIRONMENT_NAMES.slice(2)) {
      await expect(page.getByRole("link", { name: name })).toHaveCount(0);
    }
    const chip: Locator = page
      .getByTestId("facet-filter-bar")
      .getByRole("button", { name: /^Cloud Account · / });
    await expect(chip).toContainText("4109-2277-8841");
    const environmentReads: Array<ListRequest> = (
      await recorded(page)
    ).listRequests.filter((request: ListRequest): boolean => {
      return (
        request.modelName === "CloudResource" &&
        request.query["cloudAccountId"] !== undefined
      );
    });
    expect(environmentReads.length).toBeGreaterThan(0);
    expect(
      JSON.stringify(
        environmentReads[environmentReads.length - 1]!.query["cloudAccountId"],
      ),
    ).toContain("4109-2277-8841");
    await screenshot(page, "app-platforms-environments-account-chip-1280");

    // Clear the chip: every environment again.
    await page
      .getByTestId("facet-filter-bar")
      .getByRole("button", { name: /^Clear Cloud Account/ })
      .click();
    await expect(
      page.getByText("Showing 1-6 of 6 cloud environments"),
    ).toBeVisible();

    // The chip offers each account the environments are in, once, under its cloud.
    await page
      .getByTestId("facet-filter-bar")
      .getByRole("button", { name: /^Cloud Account$/ })
      .click();
    const offered: Locator = page.getByRole("listbox").getByRole("option");
    await expect(offered).toHaveText([
      /4109-2277-8841/,
      /core-prod-sub/,
      /acme-prod/,
    ]);
    await expect(page.getByRole("listbox")).toContainText("AWS");
    await expect(page.getByRole("listbox")).toContainText("Azure");
    await expect(page.getByRole("listbox")).toContainText("Google Cloud");
    await screenshot(page, "app-platforms-environments-account-chip-open-1280");
    await page.mouse.click(5, 5);

    // All Apps, as Cloud's count of apps opens it: the apps of those two environments.
    await open(
      page,
      `${APP_PLATFORMS}/apps?${accountChipQuery("app-platforms-apps-table", ["4109-2277-8841"])}`,
    );
    const rows: Locator = page.locator("table tbody tr");
    await expect(rows).toHaveCount(3);
    for (const [index, name] of [
      "billing-api",
      "checkout-api",
      "inventory",
    ].entries()) {
      await expect(rows.nth(index)).toContainText(name);
    }
    await expect(
      page
        .getByTestId("facet-filter-bar")
        .getByRole("button", { name: /^Cloud Account · / }),
    ).toContainText("4109-2277-8841");
    await screenshot(page, "app-platforms-apps-account-chip-1280");
  });

  /*
   * The UI review of #6149: turned round, the chip keeps every other
   * account's environments - and on All Apps their apps - and it says so in
   * the reader's words. In Persian an account id after the chip's Persian
   * name read with its digit groups the wrong way round ("8841-2277-4109"):
   * it is set apart from the name now, and reads whole.
   */
  test("the Cloud Account chip turned to 'is not', in English, German and Persian", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(
      page,
      `${APP_PLATFORMS}/environments?${accountChipQuery("cloud-resources-table", ["4109-2277-8841"], "is_not")}`,
    );

    await expect(
      page.getByText("Showing 1-4 of 4 cloud environments"),
    ).toBeVisible();
    for (const name of ENVIRONMENT_NAMES.slice(2)) {
      await expect(
        page.getByRole("link", { name: name }).first(),
      ).toBeVisible();
    }
    for (const name of ENVIRONMENT_NAMES.slice(0, 2)) {
      await expect(page.getByRole("link", { name: name })).toHaveCount(0);
    }
    await expect(
      page
        .getByTestId("facet-filter-bar")
        .getByRole("button", { name: "Cloud Account · not 4109-2277-8841" }),
    ).toBeVisible();

    // All Apps: the apps of every other account's environments.
    await open(
      page,
      `${APP_PLATFORMS}/apps?${accountChipQuery("app-platforms-apps-table", ["4109-2277-8841"], "is_not")}`,
    );
    const rows: Locator = page.locator("table tbody tr");
    await expect(rows).toHaveCount(3);
    for (const [index, name] of ["api", "reports", "worker"].entries()) {
      await expect(rows.nth(index)).toContainText(name);
    }

    // In German, every word of the chip: its value and its popover.
    await open(
      page,
      `${APP_PLATFORMS}/environments?${accountChipQuery("cloud-resources-table", ["4109-2277-8841"], "is_not")}&lang=de`,
    );
    const germanChip: Locator = page
      .getByTestId("facet-filter-bar")
      .getByRole("button", {
        name: `${GERMAN["Cloud Account"]} · nicht 4109-2277-8841`,
      });
    await expect(germanChip).toBeVisible();
    await germanChip.click();
    await expect(page.getByRole("dialog").getByRole("textbox")).toHaveAttribute(
      "placeholder",
      `${GERMAN["Cloud Account"]} suchen...`,
    );
    await page.keyboard.press("Escape");

    // In Persian, the account id reads whole after the chip's Persian name.
    await open(
      page,
      `${APP_PLATFORMS}/environments?${accountChipQuery("cloud-resources-table", ["4109-2277-8841"])}&lang=fa`,
    );
    const value: Locator = page
      .getByTestId("facet-filter-bar")
      .getByTestId("filter-chip-value");
    await expect(value).toHaveText("4109-2277-8841");
    const [first, middle, last] = await leftEdgesOf(value, [
      "4109",
      "2277",
      "8841",
    ]);
    expect(first!).toBeLessThan(middle!);
    expect(middle!).toBeLessThan(last!);
    await screenshot(page, "app-platforms-environments-account-chip-fa-1280");

    /*
     * On a phone, read right to left, the chip's popover opens towards the
     * left from the chip's right edge: All Apps' reached past the screen's
     * left edge and the page scrolled sideways. It keeps the page's 16px
     * margin now.
     */
    await page.setViewportSize(PHONE);
    await open(page, `${APP_PLATFORMS}/apps?lang=fa`);
    await page.getByTestId("facet-filter-bar-toggle").click();
    await page
      .getByTestId("facet-filter-bar")
      .getByRole("button", { name: PERSIAN["Cloud Account"]! })
      .click();
    const popover: Locator = page.getByRole("dialog");
    await expect(popover.getByRole("textbox")).toBeVisible();
    // At rest: a dialog grows in.
    await expect
      .poll(async (): Promise<number> => {
        return await popover.evaluate((element: Element): number => {
          return element.getAnimations({ subtree: true }).length;
        });
      })
      .toBe(0);
    const box: Box = await boxOf(popover);
    expect(box.x).toBeGreaterThanOrEqual(16 - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width - 16 + 0.5);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "app-platforms-apps-account-chip-open-fa-390");
  });

  test("Archived lists archived environments, and has none yet", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${APP_PLATFORMS}/archived`);

    await expect(
      page.getByText("No archived cloud environments").first(),
    ).toBeVisible();
    await expect(litEntry(page)).toHaveText("Archived");
    expect(await trailOf(page)).toEqual([
      "Project",
      "App Platforms",
      "Archived",
    ]);
    await screenshot(page, "app-platforms-archived-1280");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The rules
 * ---------------------------------------------------------------------------
 */
test.describe("the rules", () => {
  test("Owner Rules lists the environments' rules and those for both, with a pill that says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${APP_PLATFORMS}/settings/owner-rules`);

    await expect(
      page.getByRole("button", { name: "Create Cloud Environment Owner Rule" }),
    ).toBeVisible();
    await expect(page.getByText("Payments team owns checkout")).toBeVisible();
    await expect(page.getByText("Production owners")).toBeVisible();
    // Cloud's own rule is Cloud's.
    await expect(page.getByText("Platform team owns VMs")).toHaveCount(0);
    await expect(
      page.getByText("Showing 1-2 of 2 cloud environment owner rules"),
    ).toBeVisible();

    // Only the rule made before the split wears the pill.
    const pills: Locator = page.getByText("Also in Cloud", { exact: true });
    await expect(pills).toHaveCount(1);
    await pills.hover();
    await expect(page.getByRole("tooltip").last()).toContainText(
      "Made before Cloud and App Platforms were split",
    );

    expect(await trailOf(page)).toEqual([
      "Project",
      "App Platforms",
      "Owner Rules",
    ]);
    await expect(litEntry(page)).toHaveText("Owner Rules");

    const ruleReads: Array<ListRequest> = (
      await recorded(page)
    ).listRequests.filter((request: ListRequest): boolean => {
      return request.modelName === "CloudResourceOwnerRule";
    });
    expect(ruleReads.length).toBeGreaterThan(0);
    for (const request of ruleReads) {
      expect(request.query["cloudResourceKind"]).toEqual({
        equalToOrNull: "environment",
      });
    }

    await screenshot(page, "app-platforms-owner-rules-1280");
  });

  /*
   * The rule model is Cloud's (Cloud Resource Owner Rule); App Platforms'
   * pages say what its rules are for everywhere a rule is read, changed or
   * run - and a rule made before the split says, on its own page too, that
   * it applies in Cloud as well, and runs over both products' rows.
   */
  test("a rule's own page names it, its records and its run as App Platforms does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(
      page,
      `${APP_PLATFORMS}/settings/owner-rules/74000000-0000-4000-8000-000000000003`,
    );

    await expect(
      page.getByRole("button", { name: "Edit Cloud Environment Owner Rule" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete Cloud Environment Owner Rule" }),
    ).toBeVisible();
    await expect(page.getByText("Cloud Resource Owner Rule")).toHaveCount(0);
    await expect(page.getByTestId("cloud-rule-also-applies-in")).toHaveText(
      "Also in Cloud",
    );
    await expect(
      page.getByText(
        "This rule runs only when a cloud resource or environment is created. Run it now for the cloud resources and environments that already exist.",
      ),
    ).toBeVisible();
    await screenshot(page, "app-platforms-owner-rule-both-1280");

    // A rule of App Platforms' own: no pill, and it runs over environments.
    await open(
      page,
      `${APP_PLATFORMS}/settings/owner-rules/74000000-0000-4000-8000-000000000001`,
    );
    await expect(page.getByTestId("cloud-rule-also-applies-in")).toHaveCount(0);
    await expect(
      page.getByText(
        "This rule runs only when a cloud environment is created. Run it now for the cloud environments that already exist.",
      ),
    ).toBeVisible();

    // Its edit form asks about environments.
    await page
      .getByRole("button", { name: "Edit Cloud Environment Owner Rule" })
      .click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toContainText("Edit Cloud Environment Owner Rule");
    await expect(dialog.getByText("All cloud environments")).toBeVisible();
    await expect(
      dialog.getByText("Only cloud environments that match conditions"),
    ).toBeVisible();
    await expect(dialog.getByText("All cloud resources")).toHaveCount(0);
    await screenshot(page, "app-platforms-owner-rule-edit-1280");
  });

  test("Label Rules likewise: its own and the one for both", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${APP_PLATFORMS}/settings/label-rules`);

    await expect(
      page.getByRole("button", { name: "Create Cloud Environment Label Rule" }),
    ).toBeVisible();
    await expect(page.getByText("Label EU environments")).toBeVisible();
    await expect(page.getByText("Label every production row")).toBeVisible();
    await expect(page.getByText("Also in Cloud", { exact: true })).toHaveCount(
      1,
    );
    await expect(
      page.getByText("Showing 1-2 of 2 cloud environment label rules"),
    ).toBeVisible();
    await screenshot(page, "app-platforms-label-rules-1280");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Addresses from before the split
 * ---------------------------------------------------------------------------
 */
test.describe("addresses from before the split", () => {
  test("an environment's old Cloud address opens it in App Platforms, and Back does not bounce", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, APP_PLATFORMS);

    await open(page, `${CLOUD}/${CHECKOUT_ID}/settings`);
    await expect(page).toHaveURL(`${CHECKOUT}/settings`);
    expect(await trailOf(page)).toEqual([
      "Project",
      "App Platforms",
      CHECKOUT_NAME,
      "Settings",
    ]);
    await expect(litEntry(page)).toHaveText("Settings");

    // The old address was replaced, not stacked: Back leaves the environment.
    await page.goBack();
    await expect(page).toHaveURL(APP_PLATFORMS);

    // The view's root too.
    await open(page, `${CLOUD}/${CHECKOUT_ID}`);
    await expect(page).toHaveURL(CHECKOUT);
    await expect(pageHeading(page)).toHaveText(
      `Cloud Environment - ${CHECKOUT_NAME}`,
    );
  });

  test("a cloud resource's App Platforms address opens it in Cloud", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${APP_PLATFORMS}/${RESOURCE_ID}/metrics`);

    await expect(page).toHaveURL(`${CLOUD}/${RESOURCE_ID}/metrics`);
    await expect(pageHeading(page)).toHaveText(
      `Cloud Resource - ${RESOURCE_NAME}`,
    );
    expect(await trailOf(page)).toEqual([
      "Project",
      "Cloud",
      RESOURCE_NAME,
      "Metrics",
    ]);
    // Cloud's own menu: a resource has no Instances, and is deleted as one.
    const resource: string = `${CLOUD}/${RESOURCE_ID}`;
    await expect(
      desktopMenu(page).locator(`a[href='${resource}/delete']`),
    ).toHaveText("Delete Resource");
    await expect(
      desktopMenu(page).locator(`a[href='${resource}/instances']`),
    ).toHaveCount(0);
    await expect(litEntry(page)).toHaveAttribute("href", `${resource}/metrics`);
  });
});

/*
 * ---------------------------------------------------------------------------
 * In German and in Persian
 * ---------------------------------------------------------------------------
 */
test.describe("in the reader's language", () => {
  test("German: the menu, the trail, the strip and the rules", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${APP_PLATFORMS}?lang=de`);

    await expect(pageHeading(page)).toHaveText(GERMAN["App Platforms"]!);
    expect(await trailOf(page)).toEqual([
      GERMAN["Project"],
      GERMAN["App Platforms"],
    ]);
    await expect(litEntry(page)).toHaveText(GERMAN["Overview"]!);
    await expect(
      desktopMenu(page).getByRole("link", {
        name: GERMAN["All Environments"]!,
      }),
    ).toBeVisible();

    /*
     * The strip's words are the locale's, each title saying its language -
     * but Apps, which reads the same in German.
     */
    const titles: Locator = fleetTiles(page).locator("span[lang='de']");
    await expect(titles).toHaveCount(3);
    await expect(titles.first()).toHaveText(GERMAN["Environments"]!);
    await expect(
      page.getByTestId("cloud-fleet-summary-tile-sublabel"),
    ).toHaveText([
      "2 melden nicht",
      "1 Umgebung getrennt",
      "in den letzten 24 Stunden",
      "in den letzten 15 Min. gesehen",
    ]);
    await expect(
      page.getByRole("heading", { name: GERMAN["Recent deploys"]! }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("app-platforms-environment")
        .filter({ hasText: "billing" })
        .getByTestId("app-platforms-environment-status"),
    ).toHaveText("Zuletzt gesehen vor 3 Stunden");
    await screenshot(page, "app-platforms-overview-1280-de");

    await open(page, `${APP_PLATFORMS}/settings/owner-rules?lang=de`);
    await expect(
      page.getByText(GERMAN["Cloud Environment Owner Rules"]!).first(),
    ).toBeVisible();
    await expect(
      page.getByText(GERMAN["Also in Cloud"]!, { exact: true }),
    ).toHaveCount(1);
    await screenshot(page, "app-platforms-owner-rules-1280-de");
  });

  test("Persian: right to left, the menu on the right, and nothing sideways on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${APP_PLATFORMS}?lang=fa&state=connected`);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(pageHeading(page)).toHaveText(PERSIAN["App Platforms"]!);
    expect(await trailOf(page)).toEqual([
      PERSIAN["Project"],
      PERSIAN["App Platforms"],
    ]);
    await expect(litEntry(page)).toHaveText(PERSIAN["Overview"]!);

    // The menu reads first, so it sits on the right of the strip.
    const menuBox: Box = await boxOf(desktopMenu(page));
    const stripBox: Box = await boxOf(page.getByTestId("cloud-fleet-summary"));
    expect(menuBox.x).toBeGreaterThan(stripBox.x + stripBox.width - 0.5);

    /*
     * Names in Latin letters keep their order inside a Persian line: the
     * providers' breakdown reads 2 AWS · 2 Azure · 2 Google Cloud, left to
     * right, and a platform's line starts (on the right) with its provider,
     * the count of its environments after it.
     */
    const breakdown: Array<number> = await wordLefts(
      page.getByTestId("cloud-fleet-summary-tile-sublabel").nth(1),
      /*
       * The first 2 - a Persian two, as every number on the page is
       * written - is AWS's count: drawn before it, not after it.
       */
      ["\u06f2", "AWS"],
    );
    expect(breakdown[0]!).toBeLessThan(breakdown[1]!);
    /*
     * The providers read in order, AWS, Azure, Google Cloud: left to right
     * on a line, and a line that wraps goes on under the one before - each
     * provider whole on its line.
     */
    const parts: Array<{ text: string; top: number; left: number }> = await page
      .getByTestId("cloud-fleet-summary-tile-sublabel-part")
      .evaluateAll(
        (
          elements: Array<Element>,
        ): Array<{ text: string; top: number; left: number }> => {
          return elements.map(
            (element: Element): { text: string; top: number; left: number } => {
              const box: DOMRect = element.getBoundingClientRect();
              return {
                text: element.textContent || "",
                top: Math.round(box.top),
                left: box.left,
              };
            },
          );
        },
      );
    expect(
      parts.map((part: { text: string }): string => {
        return part.text.replace(/^\S+ /, "");
      }),
    ).toEqual(["AWS", "Azure", "Google Cloud"]);
    for (let index: number = 1; index < parts.length; index++) {
      const before: { top: number; left: number } = parts[index - 1]!;
      const part: { top: number; left: number } = parts[index]!;
      if (part.top === before.top) {
        expect(part.left).toBeGreaterThan(before.left);
      } else {
        expect(part.top).toBeGreaterThan(before.top);
      }
    }
    // The strip's numbers in the reader's digits, as the platforms' counts.
    const values: Array<string> = await fleetTiles(page).evaluateAll(
      (tiles: Array<Element>): Array<string> => {
        return tiles.map((tile: Element): string => {
          return (tile.querySelector(".text-2xl")?.textContent || "").trim();
        });
      },
    );
    expect(values).toEqual(["\u06f6", "\u06f6", "\u06f2", "\u06f7"]);
    const ecs: Locator = platformGroups(page).first();
    await expect(ecs.locator("bdi")).toHaveText("AWS");
    const provider: Box = await boxOf(ecs.locator("bdi"));
    const [count, countWord] = await wordLefts(ecs, ["۲", "محیط"]);
    // Read from the right: AWS, then its 2 (in Persian digits), then the word.
    expect(provider.x).toBeGreaterThan(count!);
    expect(count!).toBeGreaterThan(countWord!);
    await screenshot(page, "app-platforms-overview-1280-fa");

    /*
     * #6149's review: the environment's name is set apart in its Persian
     * heading (an isolate of its own), so its digits and dashes keep their
     * order - left to right inside the heading read right to left - and
     * the heading's Persian title stands at its start, on the right.
     */
    await open(page, `${CHECKOUT}?lang=fa`);
    const environmentName: Locator = pageHeading(page).getByTestId(
      "page-record-title-name",
    );
    await expect(environmentName).toHaveText(CHECKOUT_NAME);
    expect(
      await environmentName.evaluate((element: Element): string => {
        return element.tagName;
      }),
    ).toBe("BDI");
    await expect(environmentName).toHaveCSS("direction", "ltr");
    const [first, second, third] = await wordLefts(environmentName, [
      "4109",
      "2277",
      "8841",
    ]);
    expect(first!).toBeLessThan(second!);
    expect(second!).toBeLessThan(third!);
    const [titleLeft, nameEndLeft] = await wordLefts(pageHeading(page), [
      PERSIAN["Cloud Environment"]!,
      "8841",
    ]);
    expect(titleLeft!).toBeGreaterThan(nameEndLeft!);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "app-platforms-environment-heading-1280-fa");

    await page.setViewportSize(PHONE);
    await open(page, `${CHECKOUT}?lang=fa`);
    await expect(pageHeading(page)).toContainText(
      PERSIAN["Cloud Environment"]!,
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, "app-platforms-environment-overview-390-fa");

    // An app's page, right to left: its name, its state, nothing sideways.
    await open(page, `${CHECKOUT_APP}?lang=fa`);
    await expect(page.getByTestId("cloud-app-name")).toHaveText("checkout-api");
    await expect(page.getByTestId("cloud-app-header-state")).toHaveText(
      PERSIAN["Running"]!,
    );
    await expect(
      page.getByRole("tab", { name: PERSIAN["Revisions"]! }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "app-platforms-app-overview-390-fa");
  });
});
