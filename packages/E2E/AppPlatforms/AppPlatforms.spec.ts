import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { sideMenuAtRest } from "../SuiteHelpers/SideMenuAtRest";

/*
 * App Platforms, in a browser, against the offline fixture
 * (AppPlatforms/Fixture): the product the apps on managed app and container
 * platforms moved to out of Cloud. Cloud keeps its accounts and every
 * resource in them; the environments the apps run in - AWS ECS and Fargate,
 * Google Cloud Run, Azure Container Apps and App Service - are App
 * Platforms'. Both are rows of one table, told apart by their kind.
 *
 * Read the way a person reads them: the Overview's fleet strip and its
 * environments grouped by platform; an environment's page and every tab of
 * it, under App Platforms' trail and side menu; All Environments, Archived
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

interface Recorded {
  listRequests: Array<ListRequest>;
  countRequests: Array<ListRequest>;
  itemRequests: Array<{ modelName: string; id: string }>;
  apiRequests: Array<{ method: string; url: string }>;
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

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const widths: { page: number; window: number } = await page.evaluate(
    (): { page: number; window: number } => {
      return {
        page: document.documentElement.scrollWidth,
        window: window.innerWidth,
      };
    },
  );

  expect(widths.page).toBeLessThanOrEqual(widths.window);
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

    // The strip: six environments on three clouds, four reporting, three tasks.
    await expect(fleetTiles(page)).toHaveCount(4);
    const values: Array<string> = await fleetTiles(page).evaluateAll(
      (tiles: Array<Element>): Array<string> => {
        return tiles.map((tile: Element): string => {
          return (tile.querySelector(".text-2xl")?.textContent || "").trim();
        });
      },
    );
    expect(values).toEqual(["6", "4", "2", "3"]);
    await expect(
      page.getByTestId("cloud-fleet-summary-tile-sublabel").first(),
    ).toHaveText("2 AWS · 2 Azure · 2 Google Cloud");

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
    for (const size of [LAPTOP, TABLET, PHONE]) {
      await page.setViewportSize(size);
      await open(page, APP_PLATFORMS);

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

    await expect(
      page.getByText("See every cloud environment your apps run in").first(),
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
    const metricReads: Array<ListRequest> = (
      await recorded(page)
    ).listRequests.filter((request: ListRequest): boolean => {
      return request.modelName === "CloudResourceInstance";
    });
    expect(metricReads).toEqual([
      {
        modelName: "CloudResourceInstance",
        query: { cloudResourceId: CHECKOUT_ID },
      },
    ]);

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

    // The strip's words are the locale's, each title saying its language.
    const titles: Locator = fleetTiles(page).locator("span[lang='de']");
    await expect(titles).toHaveCount(4);
    await expect(titles.first()).toHaveText(GERMAN["Environments"]!);
    await expect(
      page.getByTestId("cloud-fleet-summary-tile-sublabel").nth(1),
    ).toHaveText("67 % der Umgebungen");
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
    await open(page, `${APP_PLATFORMS}?lang=fa`);

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
      page.getByTestId("cloud-fleet-summary-tile-sublabel").first(),
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
    expect(values).toEqual(["\u06f6", "\u06f4", "\u06f2", "\u06f3"]);
    const ecs: Locator = platformGroups(page).first();
    await expect(ecs.locator("bdi")).toHaveText("AWS");
    const provider: Box = await boxOf(ecs.locator("bdi"));
    const [count, countWord] = await wordLefts(ecs, ["۲", "محیط"]);
    // Read from the right: AWS, then its 2 (in Persian digits), then the word.
    expect(provider.x).toBeGreaterThan(count!);
    expect(count!).toBeGreaterThan(countWord!);
    await screenshot(page, "app-platforms-overview-1280-fa");

    await page.setViewportSize(PHONE);
    await open(page, `${CHECKOUT}?lang=fa`);
    await expect(pageHeading(page)).toContainText(
      PERSIAN["Cloud Environment"]!,
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, "app-platforms-environment-overview-390-fa");
  });
});
