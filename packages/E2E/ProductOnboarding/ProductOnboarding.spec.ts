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
 * is something in the list, About beside the page's title opens the same
 * explanation in a dialog. On a laptop, beside the side menu at 1024 and
 * 768 pixels, on a phone, in German, and in Persian in the dark theme.
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
// The status page Create answers with (Fixture.js).
const NEW_STATUS_PAGE_ID: string = "30000000-0000-4000-8000-0000000000a9";

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

interface FixtureState {
  counts: Array<{ modelName: string; query: Record<string, unknown> }>;
  creates: Array<{ modelName: string; data: Record<string, unknown> }>;
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

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
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
 * A project in use: About
 * ---------------------------------------------------------------------------
 */

test("a project with monitors sees its list alone, and About beside the title explains Monitors in a dialog", async ({
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
  await expect(row.getByTestId("product-about-button")).toHaveText("About");
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
  // With no list above it, About says what the product is for.
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

  await screenshot(page, "monitors-about-1440");

  await page.getByTestId("modal-footer-close-button").click();
  await expect(aboutDialog(page)).toHaveCount(0);
});

test("a project with status pages sees its list alone, and About explains Status Pages", async ({
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

  // About fits the phone too.
  await page.goto(`${MONITORS}?monitors=1`);
  await expect(aboutButton(page)).toBeVisible({ timeout: 60000 });
  await aboutButton(page).click();
  await expect(aboutDialog(page)).toBeVisible();
  await expectNoSidewaysScroll(page, { message: "About at 390px" });
  await screenshot(page, "monitors-about-390");
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

test("in German: the explanation and About in the Dashboard's German", async ({
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
  await expect(aboutButton(page)).toHaveText(GERMAN["About"]!);
  await expectNoSidewaysScroll(page, { message: "Monitors in German" });

  await screenshot(page, "monitors-first-run-de");

  await aboutButton(page).click();
  await expect(page.getByTestId("modal-title")).toHaveText(GERMAN["Monitors"]!);
  await expect(
    aboutDialog(page).getByTestId("resource-showcase-description"),
  ).toHaveText(GERMAN[MONITORS_DESCRIPTION]!);
  await screenshot(page, "monitors-about-de");
});

test("in Persian, dark: right to left, About before the title's end, the explanation in Persian and readable", async ({
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
  await expect(aboutButton(page)).toHaveText(PERSIAN["About"]!);

  // Right to left, About follows the title: to its left.
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
