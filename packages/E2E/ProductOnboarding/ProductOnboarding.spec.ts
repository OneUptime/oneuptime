import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import { cardBodyMisfits } from "../SuiteHelpers/CardBodyFit";
import { sideMenuAtRest } from "../SuiteHelpers/SideMenuAtRest";

/*
 * How a product explains itself (Components/ProductOnboarding, #6430), in a
 * real browser: the real Monitors and Status Pages layouts and lists against
 * the offline fixture (Fixture/Fixture.js). Only the data boundary and the
 * signed-in user are synthetic.
 *
 * A new project's list draws its empty table - "No monitors yet" and what
 * the list is for - and under it the product's explanation: its pitch, its
 * first steps in order, a drawn example of the page in use and its
 * documentation, with the list's own first step as its button (a page of
 * its own for Monitors, the table's create form for Status Pages). The
 * table does not repeat the button, and the explanation does not repeat
 * what the table says. Someone who may not create one reads it without the
 * button; a count that fails leaves the list as it always was. Once there
 * is something in the list, How it works beside the page's title opens the
 * same explanation in a dialog (About, in the code). On a laptop, beside
 * the side menu at 1024 and 768 pixels, on a phone, in German, and in
 * Persian in the dark theme.
 *
 * Data Observability's Overview, the page the issue was raised on: with no
 * database connected, the explanation with Connect a Database, and under
 * it the database the project's traces know of.
 *
 * And Data Observability in use (#6435): a busy project's Overview leads
 * with the one first step left, its counts, then what needs someone now,
 * worst first - each with what it means, who owns it, its open alert or
 * that nobody is told, and the page where it is put right - its menu in
 * sections with the rarely used ones folded, the first steps put away by
 * Dismiss, a project with nothing wrong, and an Overview that cannot be
 * read; at 1440, 1280, 1024 and 768 pixels beside the menu - its counts two
 * by two where four would squeeze their names - and on a phone, in German,
 * and in Persian in the dark theme.
 *
 * And every other product: the fixture's explanations page draws each
 * product's explanation as its How it works dialog does, so one page shows
 * every product's words, in English at a laptop's width and on a phone in
 * German and in Persian dark, each held inside its box.
 *
 * Every test puts up a network fence that aborts anything leaving the
 * fixture server, and fails on an uncaught page error, on a request the
 * fixture does not model and on any request the fence had to abort.
 */

// The fixture server's port, as the config and server.js read it.
const PORT: string = process.env["PRODUCT_ONBOARDING_FIXTURE_PORT"] || "4489";
const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000a1";
const MONITORS: string = `/dashboard/${PROJECT_ID}/monitors`;
const STATUS_PAGES: string = `/dashboard/${PROJECT_ID}/status-pages`;
const DATA_OBSERVABILITY_BASE: string = `/dashboard/${PROJECT_ID}/data-observability`;
const DATA_OBSERVABILITY: string = `${DATA_OBSERVABILITY_BASE}/overview`;
// The status page Create answers with (Fixture.js).
const NEW_STATUS_PAGE_ID: string = "30000000-0000-4000-8000-0000000000a9";

// What Data Observability in use (data=busy) holds, as Fixture.js's DATA names it.
interface BusyDataIds {
  warehouse: string;
  billingDb: string;
  orders: string;
  dailySessions: string;
  nightlyLoad: string;
  revenueProduct: string;
  nightlyLoadAlert: string;
  ordersEmailAlert: string;
}

const DATA: BusyDataIds = {
  warehouse: "70000000-0000-4000-8000-0000000000d2",
  billingDb: "70000000-0000-4000-8000-0000000000d3",
  orders: "71000000-0000-4000-8000-0000000000d1",
  dailySessions: "71000000-0000-4000-8000-0000000000d3",
  nightlyLoad: "72000000-0000-4000-8000-0000000000d1",
  revenueProduct: "75000000-0000-4000-8000-0000000000d1",
  nightlyLoadAlert: "76000000-0000-4000-8000-0000000000d1",
  ordersEmailAlert: "76000000-0000-4000-8000-0000000000d2",
};

// The eight most urgent things a busy project's Overview lists, worst first, as the server sends them.
const BUSY_ATTENTION_KINDS: Array<string> = [
  "Collection Failed",
  "Pipeline Failed",
  "Check Failing",
  "Reconciliation Drifted",
  "Data Product Late",
  "Table Late",
  "Table Late",
  "Check Could Not Run",
];

// Components/DataObservability: OverviewNeedsAttention and StoreAlertStatus.
const ATTENTION_OWNERS: string = "data-observability-attention-owners";
const STORE_ALERT_STATUS: string = "data-observability-store-alert-status";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/product-onboarding-ui",
);

// What Monitors says of itself (Showcases/EssentialsShowcases.ts).
const MONITORS_TITLE: string = "Know something is down before your users do";
const MONITORS_DESCRIPTION: string =
  "Monitors check your websites, APIs, servers and other resources on a schedule, and can open an incident or alert when a check fails.";
const MONITORS_STEPS: Array<string> = [
  "Create a monitor",
  "Choose what it checks and how often",
  "Get an incident or an alert when a check fails",
];
const STATUS_PAGES_TITLE: string = "Tell your customers what is going on";
/*
 * The button beside the title. Not "About", which most of the Dashboard's
 * languages already translate as "Regarding" (German "Betrifft").
 */
const HOW_IT_WORKS: string = "How it works";
// What a screen reader hears for an example (PRODUCT_EXAMPLE_DESCRIPTION).
const EXAMPLE_DESCRIPTION: string =
  "An example of what this page shows once it is in use.";

function locale(language: string): Record<string, string> {
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

// The Dashboard's German and Persian words, as the fixture draws them.
const GERMAN: Record<string, string> = locale("de");
const PERSIAN: Record<string, string> = locale("fa");

// A product the explanations page draws (Fixture.js, `products`).
interface FixtureProduct {
  product: string;
  // English translation keys: the product's name and its showcase's title.
  name: string;
  title: string;
}

interface FixtureState {
  counts: Array<{ modelName: string; query: Record<string, unknown> }>;
  creates: Array<{ modelName: string; data: Record<string, unknown> }>;
  // Each read of Data Observability's own routes, by its route.
  dataReads: Array<string>;
  unhandled: Array<Record<string, unknown>>;
  products: Array<FixtureProduct>;
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

  const hasFixture: boolean = await page
    .evaluate((): boolean => {
      return Boolean(
        (window as unknown as { __productOnboardingFixture?: unknown })
          .__productOnboardingFixture,
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
        (window as unknown as { __productOnboardingFixture: unknown })
          .__productOnboardingFixture,
      ),
    ) as FixtureState;
  });
}

// The empty table: "No X yet" and what the list is for.
function emptyTable(page: Page): Locator {
  return page.locator('[data-empty-state-kind="empty"]');
}

// The product's explanation on its own first page.
function showcase(page: Page): Locator {
  return page.getByTestId("product-showcase");
}

function startButton(scope: Page | Locator): Locator {
  return scope.getByTestId("resource-showcase-add-button");
}

function aboutButton(page: Page): Locator {
  return page.getByTestId("product-about-button");
}

function aboutDialog(page: Page): Locator {
  return page.getByTestId("product-about-dialog");
}

// The explanation's numbered first steps, as they read.
async function steps(scope: Locator): Promise<Array<string>> {
  return (
    await scope
      .getByTestId("resource-showcase-steps")
      .locator("li")
      .allInnerTexts()
  ).map((step: string): string => {
    // Each step's number is drawn beside it, hidden from screen readers.
    return step.replace(/^\d+\s*/, "").trim();
  });
}

// Whether `lower` is drawn below `upper` on the page.
async function isBelow(upper: Locator, lower: Locator): Promise<boolean> {
  const [top, bottom] = await boxesInOneFrame([upper, lower]);
  return Boolean(top && bottom && bottom.y >= top.y + top.height - 1);
}

/*
 * Whether `after` is drawn on `first`'s line, after it in the reading
 * direction: their boxes share a band of the page's height, and `after`
 * starts where `first` ends, to its right - or to its left, in Persian.
 */
async function isOnOneLine(first: Locator, after: Locator): Promise<boolean> {
  const [one, two] = await boxesInOneFrame([first, after]);
  if (!one || !two) {
    return false;
  }
  const isRightToLeft: boolean = await first.evaluate(
    (element: Element): boolean => {
      return getComputedStyle(element).direction === "rtl";
    },
  );
  const sharesTheLine: boolean =
    two.y < one.y + one.height && one.y < two.y + two.height;
  const comesAfter: boolean = isRightToLeft
    ? two.x + two.width <= one.x + 1
    : two.x >= one.x + one.width - 1;
  return sharesTheLine && comesAfter;
}

/*
 * A dialog grows in (Modal's 150ms transition): photographed or measured
 * any sooner, it is caught half drawn over the page.
 */
async function dialogAtRest(page: Page): Promise<void> {
  await page.waitForFunction((): boolean => {
    return document.getAnimations().every((animation: Animation): boolean => {
      // A number, or a CSS value in browsers that type it so: compared, not used.
      const endTime: unknown = animation.effect
        ? animation.effect.getComputedTiming().endTime
        : undefined;
      return animation.playState !== "running" || endTime === Infinity;
    });
  });
}

/*
 * The whole page, or - for a dialog, whose backdrop covers the window, not
 * the page under it - the window.
 */
async function screenshot(
  page: Page,
  name: string,
  options: { isDialog?: boolean } = {},
): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: !options.isDialog,
  });
}

/*
 * Data Observability's Overview in a scenario of the fixture's (data=busy,
 * healthy, connected or fail), once it has read the Overview: its state,
 * why it could not, or - with no database - the product's explanation. On a busy
 * project, once it has read who owns what too, so the page is measured as
 * it settles.
 */
async function openDataObservability(page: Page, query: string): Promise<void> {
  await page.goto(`${DATA_OBSERVABILITY}?${query}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(
    needsAttention(page)
      .or(page.getByTestId("refresh-button"))
      .or(showcase(page)),
  ).toBeVisible();
  if (query.includes("data=busy")) {
    await expect(page.getByTestId(ATTENTION_OWNERS).first()).toBeVisible();
  }
  // Every box is measured in the font it is drawn in.
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
}

function setupSteps(page: Page): Locator {
  return page.getByTestId("data-observability-setup-steps");
}

function needsAttention(page: Page): Locator {
  return page.getByTestId("data-observability-needs-attention");
}

function attentionItems(page: Page): Locator {
  return page.getByTestId("data-observability-attention-item");
}

// The items of one kind ("Table Late"), as the server names it.
function attentionItem(page: Page, kind: string): Locator {
  return page.locator(
    `[data-testid='data-observability-attention-item'][data-kind='${kind}']`,
  );
}

async function attentionKinds(page: Page): Promise<Array<string>> {
  return attentionItems(page).evaluateAll(
    (items: Array<Element>): Array<string> => {
      return items.map((item: Element): string => {
        return item.getAttribute("data-kind") || "";
      });
    },
  );
}

// What each item's pill says: "Collection Failed", "Late by 26 hours".
async function attentionPills(page: Page): Promise<Array<string | undefined>> {
  return attentionItems(page).evaluateAll(
    (items: Array<Element>): Array<string | undefined> => {
      return items.map((item: Element): string | undefined => {
        return (
          item.querySelector("span.rounded-full")?.textContent || ""
        ).trim();
      });
    },
  );
}

// Each first step, in order, and whether it is done.
async function stepStates(
  page: Page,
): Promise<Array<{ step: string; isDone: boolean }>> {
  return setupSteps(page)
    .locator("li[data-testid^='data-observability-setup-step-']")
    .evaluateAll(
      (items: Array<Element>): Array<{ step: string; isDone: boolean }> => {
        return items.map((item: Element): { step: string; isDone: boolean } => {
          return {
            step: (item.getAttribute("data-testid") || "").replace(
              "data-observability-setup-step-",
              "",
            ),
            isDone: item.getAttribute("data-done") === "true",
          };
        });
      },
    );
}

// The Overview's counts, by the name the bar gives itself in the reader's language.
function dataHealth(page: Page, name: string = "Data health"): Locator {
  return page.getByRole("group", { name, exact: true });
}

interface StatTile {
  label: string;
  value: string;
  description: string;
}

// Each tile of a bar: its name, its number and the line under it.
async function statTiles(bar: Locator): Promise<Array<StatTile>> {
  return bar.evaluate((element: Element): Array<StatTile> => {
    return Array.from(element.querySelectorAll(".uppercase")).map(
      (labelRow: Element): StatTile => {
        const tile: Element = labelRow.parentElement!;
        return {
          label: (labelRow.textContent || "").trim(),
          value: (tile.children[1]?.textContent || "").trim(),
          description: (tile.children[2]?.textContent || "").trim(),
        };
      },
    );
  });
}

// The tiles of a bar whose name runs onto a second line: "ÜBERWACHTE / TABELLEN".
async function wrappedTileLabels(bar: Locator): Promise<Array<string>> {
  return bar.evaluate((element: Element): Array<string> => {
    return Array.from(element.querySelectorAll(".uppercase > span"))
      .filter((label: Element): boolean => {
        const lineHeight: number = parseFloat(
          window.getComputedStyle(label).lineHeight,
        );
        return label.getBoundingClientRect().height > lineHeight * 1.5;
      })
      .map((label: Element): string => {
        return (label.textContent || "").trim();
      });
  });
}

// How many of a bar's tiles share its first row.
async function tilesPerRow(bar: Locator): Promise<number> {
  return bar.evaluate((element: Element): number => {
    const tops: Array<number> = Array.from(element.children).map(
      (tile: Element): number => {
        return Math.round(tile.getBoundingClientRect().top);
      },
    );
    return tops.filter((top: number): boolean => {
      return top === tops[0];
    }).length;
  });
}

// A database's row on the Overview's Databases card, by its name.
function databaseRow(card: Locator, name: string): Locator {
  return card.locator("li").filter({
    has: card.page().getByRole("link", { name, exact: true }),
  });
}

function storeAlertsAddress(dataStoreId: string): string {
  return `${DATA_OBSERVABILITY_BASE}/stores/${dataStoreId}/recommendations`;
}

function alertAddress(alertId: string): string {
  return `/dashboard/${PROJECT_ID}/alerts/${alertId}`;
}

// A translation with its values in: "{{count}} Stunden zu spät" for 26.
function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text: string, [key, value]: [string, string]): string => {
      return text.split(`{{${key}}}`).join(value);
    },
    template,
  );
}

// A side menu section's toggle, by its heading's text (CSS draws it in capitals).
function sectionToggle(menu: Locator, title: string): Locator {
  return menu.locator(
    `xpath=.//h6[normalize-space(.)='${title}']/ancestor::button[1]`,
  );
}

/*
 * On the Overview, every box of the first steps, the counts and each card
 * that runs outside it, and every box whose words run past its own edge
 * where nothing cuts them short on purpose (an ellipsis): a long German
 * word, a table's name with no space to break at, a Persian line. Drawings
 * and words only a screen reader hears are left out.
 */
async function overflowingOnTheOverview(page: Page): Promise<Array<string>> {
  return page.evaluate((): Array<string> => {
    const SPACES: RegExp = /\s+/g;
    const problems: Array<string> = [];
    const describe: (element: Element) => string = (
      element: Element,
    ): string => {
      const words: string = (element.textContent || "")
        .replace(SPACES, " ")
        .trim()
        .slice(0, 60);
      return `<${element.tagName.toLowerCase()}> "${words}"`;
    };
    const frames: Array<Element> = Array.from(
      document.querySelectorAll(
        "[data-testid='data-observability-setup-steps'], [role='group'][aria-label], [data-testid='card']",
      ),
    );

    for (const frameElement of frames) {
      const frame: DOMRect = frameElement.getBoundingClientRect();
      const name: string = describe(frameElement).slice(0, 40);

      for (const element of Array.from(frameElement.querySelectorAll("*"))) {
        if (element.closest("svg") || element.closest(".sr-only")) {
          continue;
        }

        const box: DOMRect = element.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) {
          continue;
        }

        if (box.left < frame.left - 1 || box.right > frame.right + 1) {
          problems.push(
            `${describe(element)} runs outside ${name} (${Math.round(box.left)} to ${Math.round(box.right)}, the box ${Math.round(frame.left)} to ${Math.round(frame.right)})`,
          );
          continue;
        }

        const style: CSSStyleDeclaration = window.getComputedStyle(element);
        if (style.display === "inline" || style.textOverflow === "ellipsis") {
          continue;
        }

        if (element.scrollWidth > element.clientWidth + 1) {
          problems.push(
            `${describe(element)} is ${element.scrollWidth - element.clientWidth}px wider than its box`,
          );
        }
      }
    }

    return problems;
  });
}

/*
 * A new project's Monitors list: the empty table, and under it the
 * explanation with Create Monitor.
 */
async function expectMonitorsExplained(page: Page): Promise<void> {
  await expect(emptyTable(page)).toBeVisible();
  await expect(showcase(page)).toBeVisible();
  await expect(showcase(page)).toHaveAttribute("data-product", "monitors");
  expect(await isBelow(emptyTable(page), showcase(page))).toBe(true);
}

/*
 * ---------------------------------------------------------------------------
 * A new project
 * ---------------------------------------------------------------------------
 */

test("a new project's Monitors list says what monitors are for, then explains the product, its first step the list's Create Monitor", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, MONITORS);
  await expectMonitorsExplained(page);

  // The table says what the list is for, and does not repeat the button.
  await expect(emptyTable(page)).toContainText("No monitors yet");
  await expect(emptyTable(page)).toContainText(MONITORS_DESCRIPTION);
  await expect(page.getByTestId("empty-table-create-button")).toHaveCount(0);

  // The explanation: its pitch, without saying again what the table says.
  await expect(showcase(page).getByRole("heading", { level: 2 })).toHaveText(
    MONITORS_TITLE,
  );
  await expect(
    showcase(page).getByTestId("resource-showcase-description"),
  ).toHaveCount(0);
  await expect(showcase(page).getByText(MONITORS_DESCRIPTION)).toHaveCount(0);

  // Its first steps, numbered, in order.
  expect(await steps(showcase(page))).toEqual(MONITORS_STEPS);

  // An example of the page in use, read as one sentence.
  await expect(
    showcase(page).getByRole("img", { name: EXAMPLE_DESCRIPTION }),
  ).toBeVisible();

  // The documentation, in a tab of its own.
  const documentation: Locator = showcase(page).getByRole("link", {
    name: "Documentation",
  });
  await expect(documentation).toHaveAttribute(
    "href",
    "/docs/monitor/create-monitor",
  );
  await expect(documentation).toHaveAttribute("target", "_blank");

  // The project was asked once whether it has a monitor at all.
  expect(
    (await fixture(page)).counts.filter(
      (count: { modelName: string; query: Record<string, unknown> }) => {
        return (
          count.modelName === "Monitor" && Object.keys(count.query).length === 0
        );
      },
    ).length,
  ).toBeGreaterThanOrEqual(1);

  await screenshot(page, "monitors-first-run-1440");

  // The button starts its row, level with the steps (no dialog footer's margin).
  const [stepsBox, buttonBox]: Array<FrameBox> = await boxesInOneFrame([
    showcase(page).getByTestId("resource-showcase-steps"),
    startButton(showcase(page)),
  ]);
  expect(Math.abs(buttonBox!.x - stepsBox!.x)).toBeLessThanOrEqual(1);

  // The first step is the list's own: Create Monitor's page.
  await expect(startButton(showcase(page))).toHaveText("Create Monitor");
  await startButton(showcase(page)).click();
  await expect(page.getByTestId("stub-page")).toHaveText(`${MONITORS}/create`);
});

test("a new project's Status Pages list: the explanation's Create Status Page opens the table's own form, and the first status page opens on its own page", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, STATUS_PAGES);

  await expect(emptyTable(page)).toContainText("No status pages yet");
  await expect(page.getByTestId("empty-table-create-button")).toHaveCount(0);
  await expect(showcase(page)).toHaveAttribute("data-product", "status-pages");
  expect(await isBelow(emptyTable(page), showcase(page))).toBe(true);
  await expect(showcase(page).getByRole("heading", { level: 2 })).toHaveText(
    STATUS_PAGES_TITLE,
  );
  await expect(
    showcase(page).getByTestId("resource-showcase-description"),
  ).toHaveCount(0);
  await expect(
    showcase(page).getByRole("link", { name: "Documentation" }),
  ).toHaveAttribute("href", "/docs/status-pages/index");

  await screenshot(page, "status-pages-first-run-1440");

  await expect(startButton(showcase(page))).toHaveText("Create Status Page");
  await startButton(showcase(page)).click();

  // The same form the card header's Create opens.
  const dialog: Locator = page.getByRole("dialog");
  await expect(dialog.getByTestId("modal-title")).toHaveText(
    "Create New Status Page",
  );
  await dialog.getByRole("textbox").first().fill("Acme Status");
  await page.getByTestId("modal-footer-submit-button").click();

  await expect
    .poll(async (): Promise<number> => {
      return (await fixture(page)).creates.length;
    })
    .toBe(1);
  const created: { modelName: string; data: Record<string, unknown> } = (
    await fixture(page)
  ).creates[0]!;
  expect(created.modelName).toBe("StatusPage");
  expect(created.data["name"]).toBe("Acme Status");

  // A new status page opens on its Overview, as it always has.
  await expect(page.getByTestId("stub-page")).toHaveText(
    `${STATUS_PAGES}/${NEW_STATUS_PAGE_ID}`,
  );
});

test("a read-only member reads the explanation without its button, under the table's locked Create and the note that says why", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, MONITORS, "role=viewer");
  await expectMonitorsExplained(page);

  expect(await steps(showcase(page))).toEqual(MONITORS_STEPS);
  await expect(startButton(page)).toHaveCount(0);
  await expect(
    showcase(page).getByRole("link", { name: "Documentation" }),
  ).toBeVisible();

  // The table keeps its own button, locked, and says why in words a phone shows.
  await expect(page.getByTestId("empty-table-create-button")).toBeDisabled();
  await expect(page.getByTestId("table-empty-state-note")).toHaveText(
    "You don't have permission to create these. Ask a project admin for access.",
  );

  await screenshot(page, "monitors-first-run-viewer-1440");
});

test("a count that fails leaves the list as it always was: its own Create, no explanation", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, MONITORS, "counts=fail");

  await expect(page.getByTestId("empty-table-create-button")).toBeVisible();
  await expect(showcase(page)).toHaveCount(0);
});

/*
 * ---------------------------------------------------------------------------
 * A project in use: How it works
 * ---------------------------------------------------------------------------
 */

test("a project with monitors sees its list alone, and How it works beside the title explains Monitors in a dialog", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, MONITORS, "monitors=1");
  await expect(
    page.getByTestId("card").first().getByText("Storefront").first(),
  ).toBeVisible();
  await expect(showcase(page)).toHaveCount(0);

  // On the title's own line, after it.
  const row: Locator = page.getByTestId("page-title-row");
  const title: Locator = row.getByRole("heading", {
    level: 1,
    name: "Monitors",
  });
  await expect(row.getByTestId("product-about-button")).toHaveText(
    HOW_IT_WORKS,
  );
  const [titleBox, aboutBox]: Array<FrameBox> = await boxesInOneFrame([
    title,
    aboutButton(page),
  ]);
  expect(aboutBox!.x).toBeGreaterThanOrEqual(titleBox!.x + titleBox!.width);
  const aboutMiddle: number = aboutBox!.y + aboutBox!.height / 2;
  expect(aboutMiddle).toBeGreaterThan(titleBox!.y);
  expect(aboutMiddle).toBeLessThan(titleBox!.y + titleBox!.height);

  await aboutButton(page).click();

  const dialog: Locator = aboutDialog(page);
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("modal-title")).toHaveText("Monitors");
  await expect(dialog.getByRole("heading", { level: 2 })).toHaveText(
    MONITORS_TITLE,
  );
  // With no list above it, the dialog says what the product is for.
  await expect(dialog.getByTestId("resource-showcase-description")).toHaveText(
    MONITORS_DESCRIPTION,
  );
  expect(await steps(dialog)).toEqual(MONITORS_STEPS);
  await expect(
    dialog.getByRole("img", { name: EXAMPLE_DESCRIPTION }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Documentation" }),
  ).toHaveAttribute("href", "/docs/monitor/create-monitor");
  // An explanation, not a second way to create one.
  await expect(startButton(dialog)).toHaveCount(0);

  /*
   * The dialog is its frame: its title names the product, so no second
   * name over the pitch, and the pitch starts under the title rather than
   * a card's padding further in.
   */
  await dialogAtRest(page);
  await expect(dialog.getByTestId("resource-showcase-eyebrow")).toHaveCount(0);
  const [modalTitleBox, pitchBox]: Array<FrameBox> = await boxesInOneFrame([
    page.getByTestId("modal-title"),
    dialog.getByRole("heading", { level: 2 }),
  ]);
  expect(Math.abs(pitchBox!.x - modalTitleBox!.x)).toBeLessThanOrEqual(1);

  await screenshot(page, "monitors-about-1440", { isDialog: true });

  await page.getByTestId("modal-footer-close-button").click();
  await expect(aboutDialog(page)).toHaveCount(0);
});

test("a project with status pages sees its list alone, and How it works explains Status Pages", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, STATUS_PAGES, "statusPages=1");
  await expect(
    page.getByTestId("card").first().getByText("Acme Status").first(),
  ).toBeVisible();
  await expect(showcase(page)).toHaveCount(0);

  await aboutButton(page).click();
  await expect(page.getByTestId("modal-title")).toHaveText("Status Pages");
  await expect(aboutDialog(page).getByRole("heading", { level: 2 })).toHaveText(
    STATUS_PAGES_TITLE,
  );
});

/*
 * ---------------------------------------------------------------------------
 * The page the issue was raised on
 * ---------------------------------------------------------------------------
 */

test("Data Observability with no database: the explanation with Connect a Database, and the database the traces know of under it", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(DATA_OBSERVABILITY);
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(showcase(page)).toBeVisible();
  await expect(showcase(page)).toHaveAttribute(
    "data-product",
    "data-observability",
  );
  await expect(showcase(page).getByRole("heading", { level: 2 })).toHaveText(
    "Know when your data is late, wrong or changed",
  );
  // Nothing above it says what the product is for: the explanation does.
  await expect(
    showcase(page).getByTestId("resource-showcase-description"),
  ).toBeVisible();
  expect((await steps(showcase(page)))[0]).toBe("Connect a database");
  await expect(startButton(showcase(page))).toHaveText("Connect a Database");
  await expect(
    showcase(page).getByRole("link", { name: "Documentation" }),
  ).toHaveAttribute("href", "/docs/data-observability/index");

  // The database the traces know of, under the explanation.
  const suggestion: Locator = page.getByText("billing-db", { exact: true });
  await expect(suggestion).toBeVisible();
  expect(await isBelow(showcase(page), suggestion)).toBe(true);

  // How it works stays beside the title for later.
  await expect(aboutButton(page)).toHaveText(HOW_IT_WORKS);
  await expectNoSidewaysScroll(page, {
    message: "Data Observability at 1440px",
  });
  await screenshot(page, "data-observability-first-run-1440");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(showcase(page)).toBeVisible();
  await expectNoSidewaysScroll(page, {
    message: "Data Observability at 390px",
  });
  await screenshot(page, "data-observability-first-run-390");

  // Nothing is set up or wrong yet: no steps, no list of nothing.
  await expect(setupSteps(page)).toHaveCount(0);
  await expect(needsAttention(page)).toHaveCount(0);
  expect((await fixture(page)).dataReads).toContain(
    "/data-observability/stores/suggestions",
  );
});

/*
 * ---------------------------------------------------------------------------
 * Data Observability in use (#6435)
 * ---------------------------------------------------------------------------
 */

test("a busy project's Overview says what is wrong now: the step left to do, the counts, then what needs someone, worst first, with who owns it and whether anyone was told", async ({
  page,
}: {
  page: Page;
}) => {
  await openDataObservability(page, "data=busy");

  // The project has databases: its state, not the product's explanation.
  await expect(showcase(page)).toHaveCount(0);
  await expect(aboutButton(page)).toHaveText(HOW_IT_WORKS);

  // First, the one step left: turning on the warehouse's alerts.
  await expect(setupSteps(page).getByRole("heading", { level: 2 })).toHaveText(
    "Finish setting up Data Observability",
  );
  await expect(setupSteps(page)).toContainText(
    "These steps make sure the right people hear when a table breaks.",
  );
  // How many are done, in words and as a bar four fifths full.
  const progress: Locator = page.getByTestId(
    "data-observability-setup-progress",
  );
  await expect(progress).toHaveText("4 of 5 done");
  expect(
    await progress.evaluate((element: Element): number => {
      const track: DOMRect = element.lastElementChild!.getBoundingClientRect();
      const fill: DOMRect =
        element.lastElementChild!.firstElementChild!.getBoundingClientRect();
      return Math.round((fill.width / track.width) * 100);
    }),
  ).toBe(80);
  // Dismiss stays on the title's line, at its end.
  expect(
    await isOnOneLine(
      setupSteps(page).getByRole("heading", { level: 2 }),
      page.getByTestId("data-observability-setup-dismiss"),
    ),
  ).toBe(true);
  expect(await stepStates(page)).toEqual([
    { step: "connect", isDone: true },
    { step: "alerts", isDone: false },
    { step: "owners", isDone: true },
    { step: "checks", isDone: true },
    { step: "pipelines", isDone: true },
  ]);
  const alertsStep: Locator = page.getByTestId(
    "data-observability-setup-step-alerts",
  );
  await expect(alertsStep).toContainText("Turn on alerts");
  await expect(
    alertsStep.getByRole("link", { name: "Set Up Alerts" }),
  ).toHaveAttribute("href", storeAlertsAddress(DATA.warehouse));
  // A step done says so, with no way to do it again.
  await expect(
    page.getByTestId("data-observability-setup-step-connect").getByRole("link"),
  ).toHaveCount(0);

  // Then the counts, then what needs someone.
  expect(await isBelow(setupSteps(page), dataHealth(page))).toBe(true);
  expect(await isBelow(dataHealth(page), needsAttention(page))).toBe(true);
  expect(await statTiles(dataHealth(page))).toEqual([
    {
      label: "Tables Watched",
      value: "1,824",
      description: "In 3 connected databases.",
    },
    {
      label: "Needs Attention",
      value: "23",
      description: "Broken, late or drifting now.",
    },
    {
      label: "Late Tables",
      value: "9",
      description:
        "Tables that have gone well past their usual interval without a change.",
    },
    {
      label: "Failing Checks",
      value: "3",
      description: "Checks whose alert is open.",
    },
  ]);

  // The eight most urgent of twenty-three, in the server's order: what failed, then what is late.
  await expect(needsAttention(page)).toContainText("Needs Attention");
  await expect(needsAttention(page)).toContainText(
    "The 8 most urgent of 23, worst first: what failed, then what is late.",
  );
  expect(await attentionKinds(page)).toEqual(BUSY_ATTENTION_KINDS);
  expect(await attentionPills(page)).toEqual([
    // As the Databases card below names it: "Collection failed".
    "Collection Failed",
    "Run Failed",
    "Failing",
    "Drifted",
    "Late",
    // A late table says by how much.
    "Late by 26 hours",
    "Late by 3 hours",
    "Could Not Run",
  ]);

  // The database that could not be read: why, and its page. Nobody owns a database.
  const billing: Locator = attentionItem(page, "Collection Failed");
  await expect(billing).toContainText(
    "OneUptime could not read this database, so none of its tables is watched until it can.",
  );
  await expect(billing).toContainText(
    "Access denied for user 'oneuptime_reader'@'10.0.4.12'",
  );
  await expect(
    billing.getByRole("link", { name: "Open Database" }),
  ).toHaveAttribute(
    "href",
    `${DATA_OBSERVABILITY_BASE}/stores/${DATA.billingDb}`,
  );
  await expect(billing.getByTestId(ATTENTION_OWNERS)).toHaveCount(0);

  // The failed run: the error it gave, and its open alert, a link to it.
  const run: Locator = attentionItem(page, "Pipeline Failed");
  await expect(run).toContainText(
    'Task load_orders failed: relation "staging.orders" does not exist',
  );
  await expect(
    run.getByRole("link", { name: "Alert ALT-42 is open" }),
  ).toHaveAttribute("href", alertAddress(DATA.nightlyLoadAlert));
  await expect(
    run.getByRole("link", { name: "Open Pipeline" }),
  ).toHaveAttribute(
    "href",
    `${DATA_OBSERVABILITY_BASE}/pipelines/${DATA.nightlyLoad}`,
  );

  // The failing check: its table's owners, by name, and its table's Checks.
  const check: Locator = attentionItem(page, "Check Failing");
  await expect(check.getByTestId(ATTENTION_OWNERS)).toHaveText(
    /Owners\s*Ada Lovelace.*Grace Hopper.*Payments/,
  );
  await expect(
    check.getByRole("link", { name: "Alert ALT-41 is open" }),
  ).toHaveAttribute("href", alertAddress(DATA.ordersEmailAlert));
  await expect(
    check.getByRole("link", { name: "Open Checks" }),
  ).toHaveAttribute(
    "href",
    `${DATA_OBSERVABILITY_BASE}/tables/${DATA.orders}/checks`,
  );

  // The data product: its owning team, named - so no owner to add.
  const product: Locator = attentionItem(page, "Data Product Late");
  await expect(product.getByTestId(ATTENTION_OWNERS)).toHaveText(
    /Owners\s*Finance Analytics/,
  );
  await expect(product.getByRole("link", { name: "Add one" })).toHaveCount(0);
  await expect(
    product.getByRole("link", { name: "Open Data Product" }),
  ).toHaveAttribute(
    "href",
    `${DATA_OBSERVABILITY_BASE}/data-products/${DATA.revenueProduct}`,
  );

  // The late warehouse table: nobody owns it, and nobody is told - its database's alerts are off.
  const sessions: Locator = attentionItem(page, "Table Late").filter({
    hasText: "analytics.daily_sessions",
  });
  await expect(sessions.getByTestId(ATTENTION_OWNERS)).toContainText(
    "No owner",
  );
  await expect(sessions.getByRole("link", { name: "Add one" })).toHaveAttribute(
    "href",
    `${DATA_OBSERVABILITY_BASE}/tables/${DATA.dailySessions}/owners`,
  );
  await expect(sessions).toContainText("Nobody is told: its alerts are off");
  await expect(
    sessions.getByRole("link", { name: "Set Up Alerts" }),
  ).toHaveAttribute("href", storeAlertsAddress(DATA.warehouse));

  // The late table on a database whose alerts are on: its alert is open.
  const payments: Locator = attentionItem(page, "Table Late").filter({
    hasText: "public.payments",
  });
  await expect(payments.getByTestId(ATTENTION_OWNERS)).toHaveText(
    /Owners\s*Payments/,
  );
  await expect(
    payments.getByRole("link", { name: "Alert ALT-40 is open" }),
  ).toBeVisible();
  await expect(payments).not.toContainText("Nobody is told");

  // The check that could not run: its query's error.
  await expect(attentionItem(page, "Check Could Not Run")).toContainText(
    'column "customer_id" does not exist',
  );

  // Each database says how its last read went and whether its alerts are on.
  const databases: Locator = page
    .getByTestId("card")
    .filter({ has: page.getByRole("heading", { name: "Databases" }) });
  await expect(databaseRow(databases, "orders-db")).toContainText(
    "6 alerts on",
  );
  await expect(databaseRow(databases, "orders-db")).toContainText("184 tables");
  await expect(databaseRow(databases, "warehouse")).toContainText(
    "No alerts on",
  );
  await expect(databaseRow(databases, "billing-db")).toContainText(
    "Collection failed",
  );
  await expect(databaseRow(databases, "billing-db")).toContainText(
    "2 alerts on",
  );

  // What changed in the schemas.
  await expect(page.getByText("discount_code")).toBeVisible();

  // Read once each: the Overview, how well it does, and what it costs; no suggestions.
  const reads: Array<string> = (await fixture(page)).dataReads;
  expect(reads).toContain("/data-observability/overview");
  expect(reads).toContain("/data-observability/quality");
  expect(reads).toContain("/data-observability/watched-tables");
  expect(reads).not.toContain("/data-observability/stores/suggestions");

  expect(await overflowingOnTheOverview(page)).toEqual([]);
  await expectNoSidewaysScroll(page, {
    message: "a busy Data Observability Overview at 1440px",
  });
  await screenshot(page, "data-observability-busy-1440");

  // Set Up Alerts opens the warehouse's recommended alerts.
  await sessions.getByRole("link", { name: "Set Up Alerts" }).click();
  await expect(page.getByTestId("stub-page")).toHaveText(
    storeAlertsAddress(DATA.warehouse),
  );
});

test("the Data Observability menu reads in the order a data engineer asks: the everyday pages, Quality, Usage, then Rules, Help and Advanced folded", async ({
  page,
}: {
  page: Page;
}) => {
  await openDataObservability(page, "data=busy");
  await sideMenuAtRest(page);
  const menu: Locator = page.locator(
    "aside[role='navigation'][aria-label='Main navigation']",
  );

  await expect(menu.locator("h6").first()).toBeVisible();
  expect(
    (await menu.locator("h6").allTextContents()).map(
      (title: string): string => {
        return title.trim();
      },
    ),
  ).toEqual([
    "Data Observability",
    "Quality",
    "Usage",
    "Rules",
    "Help",
    "Advanced",
  ]);

  for (const [title, isOpen] of [
    ["Data Observability", true],
    ["Quality", true],
    ["Usage", true],
    ["Rules", false],
    ["Help", false],
    ["Advanced", false],
  ] as Array<[string, boolean]>) {
    await expect(
      sectionToggle(menu, title),
      `${title} is ${isOpen ? "open" : "folded"}`,
    ).toHaveAttribute("aria-expanded", isOpen ? "true" : "false");
  }

  // The everyday pages and the rules the data keeps are in sight.
  for (const [name, address] of [
    ["Overview", "overview"],
    ["Tables", "tables"],
    ["Pipelines", "pipelines"],
    ["Checks", "checks"],
    ["Reconciliations", "reconciliations"],
    ["Data Products", "data-products"],
  ]) {
    await expect(
      menu.locator(`a[href='${DATA_OBSERVABILITY_BASE}/${address}']`),
      `${name} is in sight`,
    ).toBeVisible();
  }
  await expect(menu.locator(`a[href='${DATA_OBSERVABILITY}']`)).toHaveAttribute(
    "aria-current",
    "page",
  );

  // What most visits never need is folded away.
  for (const address of [
    "settings/owner-rules",
    "documentation",
    "tables/dropped",
  ]) {
    await expect(
      menu.locator(`a[href='${DATA_OBSERVABILITY_BASE}/${address}']`),
      `${address} is folded away`,
    ).toBeHidden();
  }

  // A folded section opens on its title.
  await sectionToggle(menu, "Rules").click();
  await expect(
    menu.locator(`a[href='${DATA_OBSERVABILITY_BASE}/settings/owner-rules']`),
  ).toBeVisible();
  await screenshot(page, "data-observability-menu-1440");
});

test("Dismiss puts the first steps away for this project, and they stay away after a reload", async ({
  page,
}: {
  page: Page;
}) => {
  await openDataObservability(page, "data=busy");
  await expect(setupSteps(page)).toBeVisible();

  await page.getByTestId("data-observability-setup-dismiss").click();
  await expect(setupSteps(page)).toHaveCount(0);
  // The rest of the page stays as it was.
  await expect(attentionItems(page)).toHaveCount(BUSY_ATTENTION_KINDS.length);

  await page.reload();
  await expect(needsAttention(page)).toBeVisible({ timeout: 60000 });
  await expect(attentionItems(page)).toHaveCount(BUSY_ATTENTION_KINDS.length);
  await expect(setupSteps(page)).toHaveCount(0);
});

test("a project with nothing wrong and everything set up: no steps, and the Overview says what it looked at and found well", async ({
  page,
}: {
  page: Page;
}) => {
  await openDataObservability(page, "data=healthy");

  await expect(needsAttention(page)).toContainText(
    "Nothing is broken or late right now.",
  );
  await expect(needsAttention(page)).toContainText(
    "Every database was read, no pipeline run failed, no check is failing, and every table is changing as often as it usually does.",
  );
  await expect(attentionItems(page)).toHaveCount(0);
  await expect(setupSteps(page)).toHaveCount(0);
  await expect(showcase(page)).toHaveCount(0);
  expect(
    (await statTiles(dataHealth(page))).map((tile: StatTile): string => {
      return `${tile.label}: ${tile.value}`;
    }),
  ).toEqual([
    "Tables Watched: 184",
    "Needs Attention: 0",
    "Late Tables: 0",
    "Failing Checks: 0",
  ]);
  await expect(page.getByTestId(STORE_ALERT_STATUS)).toHaveText("6 alerts on");

  await expectNoSidewaysScroll(page, {
    message: "a healthy Data Observability Overview",
  });
  await screenshot(page, "data-observability-healthy-1440");
});

test("a database just connected, not read yet: one step of five done, and the Overview says its first read is awaited - never that every database was read, never 0 tables", async ({
  page,
}: {
  page: Page;
}) => {
  await openDataObservability(page, "data=connected");

  await expect(
    page.getByTestId("data-observability-setup-progress"),
  ).toHaveText("1 of 5 done");
  expect(await stepStates(page)).toEqual([
    { step: "connect", isDone: true },
    { step: "alerts", isDone: false },
    { step: "owners", isDone: false },
    { step: "checks", isDone: false },
    { step: "pipelines", isDone: false },
  ]);

  await expect(needsAttention(page)).toContainText(
    "Nothing is broken or late right now.",
  );
  await expect(needsAttention(page)).toContainText(
    "A database just connected is read for the first time within a few minutes, and its tables are watched from then on.",
  );
  await expect(needsAttention(page)).not.toContainText(
    "Every database was read",
  );

  const databases: Locator = page
    .getByTestId("card")
    .filter({ has: page.getByRole("heading", { name: "Databases" }) });
  await expect(databaseRow(databases, "orders-db")).toContainText(
    "Waiting for first collection",
  );
  await expect(databaseRow(databases, "orders-db")).not.toContainText(
    "0 tables",
  );
  await expect(databaseRow(databases, "orders-db")).toContainText(
    "No alerts on",
  );

  expect(await overflowingOnTheOverview(page)).toEqual([]);
  await expectNoSidewaysScroll(page, {
    message: "a Data Observability Overview with a database just connected",
  });
  await screenshot(page, "data-observability-connected-1440");
});

test("an Overview that cannot be read says why, and Try again reads it again; it never offers to connect a first database", async ({
  page,
}: {
  page: Page;
}) => {
  await openDataObservability(page, "data=fail");

  const refresh: Locator = page.getByTestId("refresh-button");
  await expect(refresh).toBeVisible();
  /*
   * The server's answer says nothing ("Something went wrong. Please try
   * again."): the page says it could not be explained, and what to do next,
   * and offers Try again (#6836).
   */
  await expect(page.getByTestId("error-what-failed")).toHaveText(
    "This did not finish.",
  );
  await expect(page.getByTestId("error-why-and-next")).toHaveText(
    "The server ran into a problem it could not explain. Try again in a moment.",
  );
  await expect(
    page.getByText("Something went wrong. Please try again."),
  ).toHaveCount(0);
  await expect(refresh).toHaveText("Try again");
  await expect(showcase(page)).toHaveCount(0);
  await expect(needsAttention(page)).toHaveCount(0);
  await expect(setupSteps(page)).toHaveCount(0);
  await screenshot(page, "data-observability-read-failed-1440");

  const overviewReads: () => Promise<number> = async (): Promise<number> => {
    return (await fixture(page)).dataReads.filter((read: string): boolean => {
      return read === "/data-observability/overview";
    }).length;
  };
  const before: number = await overviewReads();
  expect(before).toBeGreaterThanOrEqual(1);

  await refresh.click();
  await expect.poll(overviewReads).toBe(before + 1);
  await expect(page.getByTestId("refresh-button")).toBeVisible();
  await expect(showcase(page)).toHaveCount(0);
});

for (const width of [1280, 1024, 768, 390]) {
  test(`a busy Overview at ${width}px${width < 1280 && width > 390 ? " beside the side menu" : ""}: every item, its owners and its links inside their card, nothing scrolling sideways`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await openDataObservability(page, "data=busy");
    await expect(setupSteps(page)).toBeVisible();

    expect(await attentionKinds(page)).toEqual(BUSY_ATTENTION_KINDS);
    expect(await overflowingOnTheOverview(page)).toEqual([]);
    /*
     * What each card holds starts under its title's first letter, with
     * the card's own padding alone around it, as on every product's cards
     * (#6555): Needs Attention, Recent Schema Changes, Databases.
     */
    await expect(needsAttention(page).getByTestId("card")).toHaveCount(1);
    await expect
      .poll(async (): Promise<Array<string>> => {
        return cardBodyMisfits(page.getByTestId("card"));
      }, `the Overview's cards at ${width}px`)
      .toEqual([]);
    // Dismiss keeps to the end of the title's line, on a phone too.
    expect(
      await isOnOneLine(
        setupSteps(page).getByRole("heading", { level: 2 }),
        page.getByTestId("data-observability-setup-dismiss"),
      ),
    ).toBe(true);
    /*
     * Beside the side menu, the four counts go two by two rather than
     * squeezing each name onto two lines: laid out by the bar's own width.
     */
    expect(await wrappedTileLabels(dataHealth(page))).toEqual([]);
    expect(await tilesPerRow(dataHealth(page))).toBe(
      width >= 1280 ? 4 : width >= 768 ? 2 : 1,
    );
    await expectNoSidewaysScroll(page, {
      message: `a busy Data Observability Overview at ${width}px`,
    });
    await screenshot(page, `data-observability-busy-${width}`);
  });
}

test("in German: the steps, the counts and what needs someone in the Dashboard's German, every word inside its box", async ({
  page,
}: {
  page: Page;
}) => {
  await openDataObservability(page, "data=busy&lang=de");

  await expect(setupSteps(page).getByRole("heading", { level: 2 })).toHaveText(
    GERMAN["Finish setting up Data Observability"]!,
  );
  await expect(setupSteps(page)).toContainText(
    GERMAN["These steps make sure the right people hear when a table breaks."]!,
  );
  await expect(
    page.getByTestId("data-observability-setup-progress"),
  ).toHaveText(
    fill(GERMAN["{{done}} of {{total}} done"]!, { done: "4", total: "5" }),
  );
  await expect(page.getByTestId("data-observability-setup-dismiss")).toHaveText(
    GERMAN["Dismiss"]!,
  );

  // Every tile's name, number and line in German: 1.824, not 1,824.
  expect(await statTiles(dataHealth(page, GERMAN["Data health"]!))).toEqual([
    {
      label: GERMAN["Tables Watched"]!,
      value: "1.824",
      description: fill(GERMAN["In {{count}} connected databases."]!, {
        count: "3",
      }),
    },
    {
      label: GERMAN["Needs Attention"]!,
      value: "23",
      description: GERMAN["Broken, late or drifting now."]!,
    },
    {
      label: GERMAN["Late Tables"]!,
      value: "9",
      description:
        GERMAN[
          "Tables that have gone well past their usual interval without a change."
        ]!,
    },
    {
      label: GERMAN["Failing Checks"]!,
      value: "3",
      description: GERMAN["Checks whose alert is open."]!,
    },
  ]);
  // "Überwachte Tabellen", "Fehlerhafte Prüfungen": each name on one line.
  expect(
    await wrappedTileLabels(dataHealth(page, GERMAN["Data health"]!)),
  ).toEqual([]);

  await expect(needsAttention(page)).toContainText(GERMAN["Needs Attention"]!);
  await expect(needsAttention(page)).toContainText(
    fill(
      GERMAN[
        "The {{shown}} most urgent of {{count}}, worst first: what failed, then what is late."
      ]!,
      { shown: "8", count: "23" },
    ),
  );
  expect(await attentionPills(page)).toEqual([
    GERMAN["Collection Failed"],
    GERMAN["Run Failed"],
    GERMAN["Failing"],
    GERMAN["Drifted"],
    GERMAN["Late"],
    fill(GERMAN["Late by {{count}} hours"]!, { count: "26" }),
    fill(GERMAN["Late by {{count}} hours"]!, { count: "3" }),
    GERMAN["Could Not Run"],
  ]);
  const sessions: Locator = attentionItem(page, "Table Late").filter({
    hasText: "analytics.daily_sessions",
  });
  await expect(sessions).toContainText(
    GERMAN["Nobody is told: its alerts are off"]!,
  );
  await expect(sessions).toContainText(GERMAN["No owner"]!);
  await expect(
    attentionItem(page, "Pipeline Failed").getByRole("link", {
      name: fill(GERMAN["Alert {{number}} is open"]!, { number: "ALT-42" }),
    }),
  ).toBeVisible();
  // The time each started, in German too: "vor 3 Stunden".
  await expect(attentionItem(page, "Pipeline Failed")).toContainText("vor");

  expect(await overflowingOnTheOverview(page)).toEqual([]);
  await expectNoSidewaysScroll(page, {
    message: "a busy Data Observability Overview in German",
  });
  await screenshot(page, "data-observability-busy-de");

  // On a phone too, where German's long words wrap inside their boxes.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(needsAttention(page)).toBeVisible();
  expect(await overflowingOnTheOverview(page)).toEqual([]);
  await expectNoSidewaysScroll(page, {
    message: "a busy Data Observability Overview in German at 390px",
  });
  await screenshot(page, "data-observability-busy-de-390");
});

test("in Persian, dark: right to left, what needs someone in Persian with its facts set off by bullets, names read left to right, and readable on the dark card", async ({
  page,
}: {
  page: Page;
}) => {
  await openDataObservability(page, "data=busy&lang=fa&theme=dark");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect(setupSteps(page).getByRole("heading", { level: 2 })).toHaveText(
    PERSIAN["Finish setting up Data Observability"]!,
  );
  // Dismiss at the end of the title's line: its left, right to left.
  await expect(page.getByTestId("data-observability-setup-dismiss")).toHaveText(
    PERSIAN["Dismiss"]!,
  );
  expect(
    await isOnOneLine(
      setupSteps(page).getByRole("heading", { level: 2 }),
      page.getByTestId("data-observability-setup-dismiss"),
    ),
  ).toBe(true);
  await expect(needsAttention(page)).toContainText(PERSIAN["Needs Attention"]!);

  const pills: Array<string | undefined> = await attentionPills(page);
  expect(pills.slice(0, 5)).toEqual([
    PERSIAN["Collection Failed"],
    PERSIAN["Run Failed"],
    PERSIAN["Failing"],
    PERSIAN["Drifted"],
    PERSIAN["Late"],
  ]);
  // "Late by 26 hours", in Persian and its own digits.
  const lateBy: Array<string> = PERSIAN["Late by {{count}} hours"]!.split(
    "{{count}}",
  ).map((part: string): string => {
    return part.trim();
  });
  for (const part of lateBy.filter(Boolean)) {
    expect(pills[5]).toContain(part);
  }

  /*
   * A fact is set off from the next by a bullet, as Persian writes it, not
   * a middle dot; the table's name reads left to right in its isolate.
   */
  const sessions: Locator = attentionItem(page, "Table Late").filter({
    hasText: "analytics.daily_sessions",
  });
  await expect(sessions).toContainText(
    PERSIAN["Nobody is told: its alerts are off"]!,
  );
  const sessionsText: string = await sessions.innerText();
  expect(sessionsText).toContain("•");
  expect(sessionsText).not.toContain("·");
  await expect(
    sessions.locator("bdi, [dir='ltr'], [dir='auto']").filter({
      hasText: "analytics.daily_sessions",
    }),
  ).not.toHaveCount(0);

  // The card's title reads light on the dark card.
  const color: string = await setupSteps(page)
    .getByRole("heading", { level: 2 })
    .evaluate((element: Element): string => {
      return window.getComputedStyle(element).color;
    });
  const channels: Array<number> = (color.match(/\d+/g) || [])
    .slice(0, 3)
    .map(Number);
  expect(Math.min(...channels)).toBeGreaterThan(180);

  expect(await overflowingOnTheOverview(page)).toEqual([]);
  // Right to left, what each card holds starts under its title's first letter, at its right (#6555).
  await expect
    .poll(async (): Promise<Array<string>> => {
      return cardBodyMisfits(page.getByTestId("card"));
    }, "the Overview's cards in Persian")
    .toEqual([]);
  await expectNoSidewaysScroll(page, {
    message: "a busy Data Observability Overview in Persian",
  });
  await screenshot(page, "data-observability-busy-fa-dark");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(needsAttention(page)).toBeVisible();
  expect(await overflowingOnTheOverview(page)).toEqual([]);
  await expect
    .poll(async (): Promise<Array<string>> => {
      return cardBodyMisfits(page.getByTestId("card"));
    }, "the Overview's cards in Persian at 390px")
    .toEqual([]);
  await expectNoSidewaysScroll(page, {
    message: "a busy Data Observability Overview in Persian at 390px",
  });
  await screenshot(page, "data-observability-busy-fa-dark-390");
});

/*
 * ---------------------------------------------------------------------------
 * Widths, languages, themes
 * ---------------------------------------------------------------------------
 */

test("on a phone: the explanation stacks under the empty table, its example under its steps, and nothing scrolls sideways", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, MONITORS);
  await expectMonitorsExplained(page);

  const stepList: Locator = showcase(page).getByTestId(
    "resource-showcase-steps",
  );
  const example: Locator = showcase(page).getByRole("img", {
    name: EXAMPLE_DESCRIPTION,
  });
  expect(await isBelow(stepList, example)).toBe(true);
  await expectNoSidewaysScroll(page, { message: "Monitors at 390px" });

  await screenshot(page, "monitors-first-run-390");

  // The dialog fits the phone too.
  await page.goto(`${MONITORS}?monitors=1`);
  await expect(aboutButton(page)).toBeVisible({ timeout: 60000 });
  await aboutButton(page).click();
  await expect(aboutDialog(page)).toBeVisible();
  await dialogAtRest(page);
  await expectNoSidewaysScroll(page, { message: "How it works at 390px" });
  await screenshot(page, "monitors-about-390", { isDialog: true });
});

for (const width of [1024, 768]) {
  test(`at ${width}px beside the side menu: the explanation fits, its example beside or under its pitch`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await open(page, STATUS_PAGES);
    await expect(showcase(page)).toBeVisible();

    const [card, example]: Array<FrameBox> = await boxesInOneFrame([
      showcase(page),
      showcase(page).getByRole("img", { name: EXAMPLE_DESCRIPTION }),
    ]);
    // Inside its card, whichever way it is laid out.
    expect(example!.x).toBeGreaterThanOrEqual(card!.x);
    expect(example!.x + example!.width).toBeLessThanOrEqual(
      card!.x + card!.width + 1,
    );
    await expectNoSidewaysScroll(page, {
      message: `Status Pages at ${width}px`,
    });

    await screenshot(page, `status-pages-first-run-${width}`);
  });
}

test("in German: the explanation and How it works in the Dashboard's German", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, MONITORS, "lang=de");
  await expectMonitorsExplained(page);

  await expect(showcase(page).getByRole("heading", { level: 2 })).toHaveText(
    GERMAN[MONITORS_TITLE]!,
  );
  expect(await steps(showcase(page))).toEqual(
    MONITORS_STEPS.map((step: string): string => {
      return GERMAN[step]!;
    }),
  );
  await expect(aboutButton(page)).toHaveText(GERMAN[HOW_IT_WORKS]!);
  await expectNoSidewaysScroll(page, { message: "Monitors in German" });

  await screenshot(page, "monitors-first-run-de");

  await aboutButton(page).click();
  await expect(page.getByTestId("modal-title")).toHaveText(GERMAN["Monitors"]!);
  await expect(
    aboutDialog(page).getByTestId("resource-showcase-description"),
  ).toHaveText(GERMAN[MONITORS_DESCRIPTION]!);
  await dialogAtRest(page);
  await screenshot(page, "monitors-about-de", { isDialog: true });
});

test("in Persian, dark: right to left, How it works before the title's end, the explanation in Persian and readable", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, MONITORS, "lang=fa&theme=dark");
  await expectMonitorsExplained(page);

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect(showcase(page).getByRole("heading", { level: 2 })).toHaveText(
    PERSIAN[MONITORS_TITLE]!,
  );
  await expect(aboutButton(page)).toHaveText(PERSIAN[HOW_IT_WORKS]!);

  // Right to left, How it works follows the title: to its left.
  const [titleBox, aboutBox]: Array<FrameBox> = await boxesInOneFrame([
    page.getByTestId("page-title-row").getByRole("heading", { level: 1 }),
    aboutButton(page),
  ]);
  expect(aboutBox!.x + aboutBox!.width).toBeLessThanOrEqual(titleBox!.x);

  // The button starts its row at the right, level with the steps.
  const [stepsBox, buttonBox]: Array<FrameBox> = await boxesInOneFrame([
    showcase(page).getByTestId("resource-showcase-steps"),
    startButton(showcase(page)),
  ]);
  expect(
    Math.abs(buttonBox!.x + buttonBox!.width - (stepsBox!.x + stepsBox!.width)),
  ).toBeLessThanOrEqual(1);

  // The heading reads light on the dark card.
  const color: string = await showcase(page)
    .getByRole("heading", { level: 2 })
    .evaluate((element: Element): string => {
      return window.getComputedStyle(element).color;
    });
  const channels: Array<number> = (color.match(/\d+/g) || [])
    .slice(0, 3)
    .map(Number);
  expect(Math.min(...channels)).toBeGreaterThan(180);

  await expectNoSidewaysScroll(page, { message: "Monitors in Persian" });
  await screenshot(page, "monitors-first-run-fa-dark");
});

/*
 * ---------------------------------------------------------------------------
 * Every product, as its dialog draws it
 * ---------------------------------------------------------------------------
 */

const EXPLANATIONS: string = `/dashboard/${PROJECT_ID}/product-explanations`;

/*
 * A screenshot of each product's explanation, when asked:
 * PRODUCT_ONBOARDING_EXPLANATION_SHOTS=1 CI=1 npm run
 * test-product-onboarding-ui -- -g "every product". One a product in each
 * of the three tests, so a run in CI leaves them out.
 */
const SHOOTS_EVERY_EXPLANATION: boolean =
  process.env["PRODUCT_ONBOARDING_EXPLANATION_SHOTS"] === "1";

// A few products the registry must hold, one of each kind of first page.
const PRODUCTS_OF_EVERY_KIND: Array<string> = [
  // A list whose first step is a page of its own.
  "monitors",
  // A list whose first step is its table's create form.
  "status-pages",
  // A telemetry explorer.
  "logs",
  // A page with get-started steps of its own.
  "network",
  // A resource, which keeps the showcase its empty list draws.
  "kubernetes",
  // The page the issue was raised on.
  "data-observability",
];

// What the page draws of one product's explanation.
interface DrawnExplanation {
  product: string;
  name: string;
  title: string;
  // The example's label, as a screen reader hears it.
  example: string;
  docsHref: string;
  steps: number;
  highlights: number;
}

async function openExplanations(
  page: Page,
  query: string = "",
): Promise<Array<FixtureProduct>> {
  await page.goto(`${EXPLANATIONS}${query ? `?${query}` : ""}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  const products: Array<FixtureProduct> = (await fixture(page)).products;
  await expect(page.getByTestId("product-explanation")).toHaveCount(
    products.length,
  );
  // Every box is read in the font it is drawn in.
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });

  return products;
}

async function drawnExplanations(page: Page): Promise<Array<DrawnExplanation>> {
  return page.evaluate((): Array<DrawnExplanation> => {
    return Array.from(
      document.querySelectorAll('[data-testid="product-explanation"]'),
    ).map((section: Element): DrawnExplanation => {
      const text: (selector: string) => string = (selector: string): string => {
        return (section.querySelector(selector)?.textContent || "").trim();
      };

      return {
        product: section.getAttribute("data-product") || "",
        name: text('[data-testid="product-explanation-name"]'),
        title: text("h2"),
        example:
          section
            .querySelector('[data-testid="resource-showcase-preview"]')
            ?.getAttribute("aria-label") || "",
        docsHref:
          section
            .querySelector('[data-testid="resource-showcase-docs-link"]')
            ?.getAttribute("href") || "",
        steps: section.querySelectorAll(
          '[data-testid="resource-showcase-steps"] li',
        ).length,
        highlights: section.querySelectorAll(
          '[data-testid="resource-showcase-highlights"] li',
        ).length,
      };
    });
  });
}

/*
 * Every box of an explanation that runs outside it, and every box whose
 * words run past its own edge where nothing cuts them short on purpose
 * (an ellipsis): a long German word, a Persian line that does not wrap.
 * The example's chart is a drawing, not words, and is left out.
 */
async function overflowingBoxes(page: Page): Promise<Array<string>> {
  return page.evaluate((): Array<string> => {
    const SPACES: RegExp = /\s+/g;
    const problems: Array<string> = [];
    const describe: (element: Element) => string = (
      element: Element,
    ): string => {
      const words: string = (element.textContent || "")
        .replace(SPACES, " ")
        .trim()
        .slice(0, 60);
      return `<${element.tagName.toLowerCase()}> "${words}"`;
    };

    for (const section of Array.from(
      document.querySelectorAll('[data-testid="product-explanation"]'),
    )) {
      const product: string = section.getAttribute("data-product") || "";
      const frame: DOMRect = section.getBoundingClientRect();

      for (const element of Array.from(section.querySelectorAll("*"))) {
        if (element.closest("svg")) {
          continue;
        }

        const box: DOMRect = element.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) {
          continue;
        }

        if (box.left < frame.left - 1 || box.right > frame.right + 1) {
          problems.push(
            `${product}: ${describe(element)} runs outside its explanation (${Math.round(box.left)} to ${Math.round(box.right)}, the box ${Math.round(frame.left)} to ${Math.round(frame.right)})`,
          );
          continue;
        }

        const style: CSSStyleDeclaration = window.getComputedStyle(element);
        if (style.display === "inline" || style.textOverflow === "ellipsis") {
          continue;
        }

        if (element.scrollWidth > element.clientWidth + 1) {
          problems.push(
            `${product}: ${describe(element)} is ${element.scrollWidth - element.clientWidth}px wider than its box`,
          );
        }
      }
    }

    return problems;
  });
}

/*
 * The example's figures, written the reader's way (#6535): "1,284" in
 * English, "1.284" in German, "۱٬۲۸۴" in Persian, and a unit in the
 * language's own words ("۱۸۴ میلی‌ثانیه"). A figure is never cut short, and
 * one that takes a second line - a unit a language writes long, under its
 * number - is listed: English and German keep every figure on one line.
 * Each product's figures, by its explanation.
 */
interface DrawnStatValues {
  values: Record<string, Array<string>>;
  cut: Array<string>;
  wrapped: Array<string>;
}

async function drawnStatValues(page: Page): Promise<DrawnStatValues> {
  return page.evaluate((): DrawnStatValues => {
    const values: Record<string, Array<string>> = {};
    const cut: Array<string> = [];
    const wrapped: Array<string> = [];

    for (const section of Array.from(
      document.querySelectorAll('[data-testid="product-explanation"]'),
    )) {
      const product: string = section.getAttribute("data-product") || "";

      for (const value of Array.from(
        section.querySelectorAll(
          '[data-testid="resource-showcase-stat-value"]',
        ),
      )) {
        const text: string = (value.textContent || "").trim();

        (values[product] = values[product] || []).push(text);
        if (value.scrollWidth > value.clientWidth + 1) {
          cut.push(
            `${product}: "${text}" is cut, ${value.scrollWidth}px in ${value.clientWidth}px`,
          );
        }

        const lineHeight: number = parseFloat(
          window.getComputedStyle(value).lineHeight,
        );
        if (value.getBoundingClientRect().height > lineHeight * 1.5) {
          wrapped.push(`${product}: "${text}"`);
        }
      }
    }

    return { values, cut, wrapped };
  });
}

async function shootEveryExplanation(page: Page, name: string): Promise<void> {
  if (!SHOOTS_EVERY_EXPLANATION) {
    return;
  }

  fs.mkdirSync(path.join(SCREENSHOTS, "explanations"), { recursive: true });
  const sections: Array<Locator> = await page
    .getByTestId("product-explanation")
    .all();
  for (const section of sections) {
    const product: string = (await section.getAttribute("data-product")) || "";
    await section.screenshot({
      path: path.join(
        SCREENSHOTS,
        "explanations",
        `${product}-${name}-synthetic.png`,
      ),
    });
  }
}

test("every product explains itself the same way: its name, its pitch, its first steps or setup facts, an example and its documentation, inside its box at a laptop's width", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const products: Array<FixtureProduct> = await openExplanations(page);

  // The registry is the products menu (ProductOnboardingRegistry): one of each kind is in it.
  const keys: Array<string> = products.map((entry: FixtureProduct): string => {
    return entry.product;
  });
  for (const product of PRODUCTS_OF_EVERY_KIND) {
    expect(keys, `the explanations page draws ${product}`).toContain(product);
  }
  expect(new Set(keys).size).toBe(keys.length);

  const drawn: Array<DrawnExplanation> = await drawnExplanations(page);
  expect(
    drawn.map((explanation: DrawnExplanation): string => {
      return explanation.product;
    }),
  ).toEqual(keys);

  for (const explanation of drawn) {
    const entry: FixtureProduct = products.find(
      (candidate: FixtureProduct): boolean => {
        return candidate.product === explanation.product;
      },
    )!;
    // In English, as the registry words it.
    expect(explanation.name, explanation.product).toBe(entry.name);
    expect(explanation.title, explanation.product).toBe(entry.title);
    // An example, labelled as one for a screen reader.
    expect(explanation.example, explanation.product).not.toBe("");
    // Its documentation: a page of the docs.
    expect(
      explanation.docsHref.startsWith("/docs/"),
      `${explanation.product} links ${explanation.docsHref}`,
    ).toBe(true);
    /*
     * A product's two to four first steps, or a resource's three facts
     * about setup: never both, never neither.
     */
    expect(
      {
        product: explanation.product,
        stepsOrFacts:
          (explanation.steps >= 2 && explanation.steps <= 4) !==
          explanation.highlights > 0,
      },
      `${explanation.product}: ${explanation.steps} steps, ${explanation.highlights} facts`,
    ).toEqual({ product: explanation.product, stepsOrFacts: true });
  }

  expect(await overflowingBoxes(page)).toEqual([]);
  // Four figures to an example, each whole: Status Pages' subscribers "1,284".
  const figures: DrawnStatValues = await drawnStatValues(page);
  expect(figures.values["status-pages"]).toContain("1,284");
  expect(figures.cut).toEqual([]);
  expect(figures.wrapped).toEqual([]);
  await expectNoSidewaysScroll(page, {
    message: "every product's explanation at 1280px",
  });
  await shootEveryExplanation(page, "1280");
});

/*
 * A figure is longer in some languages than in English: "1,82 Mio." for
 * "1.82M", "۱۸۴ میلی‌ثانیه" for "184 ms". At a laptop's width an example's
 * four tiles stand in one row, the narrowest they are drawn. A unit is
 * drawn smaller than its number, as a value widget draws it, so every
 * figure keeps to one line, and is never cut.
 */
for (const reader of [
  { language: "German", lang: "de", subscribers: "1.284" },
  { language: "Persian", lang: "fa", subscribers: "۱٬۲۸۴" },
]) {
  test(`every product's example in ${reader.language} at a laptop's width: its figures written the ${reader.language} way, none cut short`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openExplanations(page, `lang=${reader.lang}`);

    const figures: DrawnStatValues = await drawnStatValues(page);

    expect(figures.values["status-pages"]).toContain(reader.subscribers);
    expect(
      Object.values(figures.values).flat().length,
      "every example draws its figures",
    ).toBeGreaterThan(100);
    expect(figures.cut).toEqual([]);
    expect(figures.wrapped).toEqual([]);
    await shootEveryExplanation(page, `1280-${reader.lang}`);
  });
}

for (const reader of [
  { language: "German", lang: "de", words: GERMAN, theme: "light" },
  { language: "Persian", lang: "fa", words: PERSIAN, theme: "dark" },
]) {
  test(`every product on a phone in ${reader.language}${reader.theme === "dark" ? ", dark" : ""}: its name and pitch in the Dashboard's ${reader.language}, every word inside its box`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const products: Array<FixtureProduct> = await openExplanations(
      page,
      `lang=${reader.lang}${reader.theme === "dark" ? "&theme=dark" : ""}`,
    );

    const drawn: Array<DrawnExplanation> = await drawnExplanations(page);
    expect(
      drawn.map((explanation: DrawnExplanation): Record<string, string> => {
        return {
          product: explanation.product,
          name: explanation.name,
          title: explanation.title,
        };
      }),
    ).toEqual(
      products.map((entry: FixtureProduct): Record<string, string> => {
        return {
          product: entry.product,
          // A word the language keeps as English (a product's own name) is its key.
          name: reader.words[entry.name] || entry.name,
          title: reader.words[entry.title] || entry.title,
        };
      }),
    );

    if (reader.lang === "fa") {
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);

      // Every pitch reads light on its dark box.
      const darkTitles: Array<string> = await page.evaluate(
        (): Array<string> => {
          const CHANNELS: RegExp = /\d+/g;
          return Array.from(
            document.querySelectorAll('[data-testid="product-explanation"]'),
          )
            .filter((section: Element): boolean => {
              const heading: Element | null = section.querySelector("h2");
              const channels: Array<number> = (
                window.getComputedStyle(heading!).color.match(CHANNELS) || []
              )
                .slice(0, 3)
                .map(Number);
              return Math.min(...channels) <= 180;
            })
            .map((section: Element): string => {
              return section.getAttribute("data-product") || "";
            });
        },
      );
      expect(darkTitles).toEqual([]);
    }

    expect(await overflowingBoxes(page)).toEqual([]);
    const figures: DrawnStatValues = await drawnStatValues(page);
    expect(figures.cut).toEqual([]);
    if (reader.lang === "de") {
      expect(figures.wrapped).toEqual([]);
    }
    await expectNoSidewaysScroll(page, {
      message: `every product's explanation in ${reader.language} at 390px`,
    });
    await shootEveryExplanation(page, `390-${reader.lang}-${reader.theme}`);
  });
}
