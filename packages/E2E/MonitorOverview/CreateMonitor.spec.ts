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
 * CREATE MONITOR, IN A REAL BROWSER.
 *
 * The maintainer: "When I create a new monitor, this UI is extremely
 * confusing to use. Can you please improve it and make it more user friendly
 * and simpler to use." The form asked for a name before what to monitor,
 * then showed a full-width grid of eight large type cards under "32 to choose
 * from" and eight category headings with counts; its criteria step opened
 * every default criteria across about six thousand pixels, with a red
 * "Monitor Destination is required." before anything was typed.
 *
 * The production Create page (Pages/Monitor/Create), the production Tailwind
 * build and Theme.css, against the offline fixture (Fixture/Fixture.js).
 * jsdom applies no CSS and lays nothing out, so what only a browser can show
 * is checked here: what fits on screen, what sits beside what, what the
 * keyboard reaches, what a folded criteria hides, and dark mode.
 *
 * The same guards as MonitorOverview.spec.ts: a network fence, no uncaught
 * page errors, and no request the fixture does not model.
 */

// The fixture server's port: MONITOR_OVERVIEW_FIXTURE_PORT, as the config and server.js read it.
const PORT: string = process.env["MONITOR_OVERVIEW_FIXTURE_PORT"] || "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const CREATE_PATH: string = `/dashboard/${PROJECT_ID}/monitors/create`;
// Fixture.js answers the create with this id; its page is a stub.
const CREATED_MONITOR_ID: string = "70000000-0000-4000-8000-000000000100";
// The fixture's first probe, "Frankfurt (eu-central-1)".
const FRANKFURT_PROBE_ID: string = "73000000-0000-4000-8000-000000000001";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/monitor-overview-ui",
);

const COMMON_TYPES: Array<string> = [
  "Website",
  "API",
  "Ping",
  "Port",
  "SSL Certificate",
  "Incoming Request",
];

const WHITE_RGB: string = "rgb(255, 255, 255)";

interface RecordedCreate {
  modelName: string;
  data: Record<string, unknown>;
  miscDataProps: Record<string, unknown> | null;
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

  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const state: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __monitorOverviewFixture?: { unhandled?: Array<unknown> };
        }
      ).__monitorOverviewFixture;
      return JSON.parse(
        JSON.stringify(state?.unhandled || []),
      ) as Array<unknown>;
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function openCreate(page: Page, query: string = ""): Promise<Locator> {
  await page.clock.setFixedTime(NOW);
  await page.goto(`${CREATE_PATH}${query}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });

  const form: Locator = page.locator("#create-monitor-form");
  await expect(form).toBeVisible({ timeout: 60000 });

  // The picker: its common rows, or the summary of a type a link chose.
  await expect(
    page
      .locator(
        "[data-testid='card-select-common'], [data-testid='card-select-summary']",
      )
      .first(),
  ).toBeVisible({ timeout: 30000 });

  return form;
}

async function shownTypes(page: Page): Promise<Array<string>> {
  return page
    .getByRole("radio")
    .evaluateAll((elements: Array<Element>): Array<string> => {
      return elements.map((element: Element): string => {
        return element.getAttribute("data-card-select-value") || "";
      });
    });
}

/*
 * How many types the picker offers: its radios once More monitor types is
 * open. The search summary counts against all of them, so a new monitor type
 * changes this number without changing this file.
 */
async function offeredTypeCount(page: Page): Promise<number> {
  await openCreate(page);
  await page.getByTestId("card-select-more").click();
  await expect(page.getByTestId("card-select-more")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  return (await shownTypes(page)).length;
}

function option(page: Page, value: string): Locator {
  return page.getByTestId(`card-select-option-${value}`);
}

function summary(page: Page): Locator {
  return page.getByTestId("card-select-summary");
}

function nameInput(form: Locator): Locator {
  return form.locator("input[placeholder='Monitor Name']");
}

async function createsRecorded(page: Page): Promise<Array<RecordedCreate>> {
  return page.evaluate((): Array<RecordedCreate> => {
    const state: { creates?: Array<RecordedCreate> } | undefined = (
      window as unknown as {
        __monitorOverviewFixture?: { creates?: Array<RecordedCreate> };
      }
    ).__monitorOverviewFixture;
    return JSON.parse(
      JSON.stringify(state?.creates || []),
    ) as Array<RecordedCreate>;
  });
}

async function boxOf(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box: { x: number; y: number; width: number; height: number } | null =
    await locator.boundingBox();

  expect(box, "the element is laid out").not.toBeNull();

  return box!;
}

test.describe("Create Monitor's first step", () => {
  test("opens on what to monitor: six common types, two to a line, no headings or counts", async ({
    page,
  }: {
    page: Page;
  }) => {
    const form: Locator = await openCreate(page);

    expect(await shownTypes(page)).toEqual(COMMON_TYPES);

    // Two compact rows to a line on a desktop.
    const website: { x: number; y: number } = await boxOf(
      option(page, "Website"),
    );
    const api: { x: number; y: number } = await boxOf(option(page, "API"));
    const ping: { x: number; y: number } = await boxOf(option(page, "Ping"));

    expect(Math.abs(website.y - api.y)).toBeLessThan(2);
    expect(api.x).toBeGreaterThan(website.x);
    expect(ping.y).toBeGreaterThan(website.y);
    expect(Math.abs(ping.x - website.x)).toBeLessThan(2);

    await expect(page.getByTestId("card-select-more")).toHaveText(
      "More monitor types",
    );
    await expect(form).not.toContainText("to choose from");
    await expect(form).not.toContainText("Basic Monitoring");
    await expect(form).not.toContainText("Infrastructure");

    // What to monitor first, then the name.
    const name: { y: number } = await boxOf(nameInput(form));
    expect(name.y).toBeGreaterThan(ping.y);

    // The description folds under More fields with the labels.
    const moreFields: Locator = form.getByRole("button", {
      name: "More fields",
      exact: true,
    });
    await expect(moreFields).toHaveAttribute("aria-expanded", "false");
    await expect(
      form.getByPlaceholder("Description", { exact: true }),
    ).toBeHidden();

    await screenshot(page, "create-monitor-first-step");
  });

  test("the whole first step, Next included, is on screen without scrolling", async ({
    page,
  }: {
    page: Page;
  }) => {
    const form: Locator = await openCreate(page);

    await expect(
      form.getByRole("button", { name: "Next", exact: true }),
    ).toBeInViewport();
  });

  test("fits a phone: one row a line, nothing wider than the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCreate(page);

    const website: { x: number; y: number } = await boxOf(
      option(page, "Website"),
    );
    const api: { x: number; y: number } = await boxOf(option(page, "API"));

    expect(Math.abs(api.x - website.x)).toBeLessThan(2);
    expect(api.y).toBeGreaterThan(website.y);

    const overflow: number = await page.evaluate((): number => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });
    expect(overflow).toBeLessThanOrEqual(0);

    await screenshot(page, "create-monitor-phone");
  });

  test("More monitor types shows every other type under a plain heading, focus on the first new one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);

    await page.getByTestId("card-select-more").click();

    // It stays, open (issue #5364: it used to go once pressed).
    await expect(page.getByTestId("card-select-more")).toBeVisible();
    await expect(page.getByTestId("card-select-more")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(option(page, "IP")).toBeFocused();

    const moreOptions: Locator = page.getByTestId("card-select-more-options");
    for (const heading of ["Infrastructure", "Telemetry", "Other"]) {
      await expect(
        moreOptions.getByText(heading, { exact: true }),
      ).toBeVisible();
    }

    // Every type the picker offers, each once.
    const shown: Array<string> = await shownTypes(page);
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown).toContain("Kubernetes");
    expect(shown).toContain("Manual");
    expect(shown.slice(0, COMMON_TYPES.length)).toEqual(COMMON_TYPES);

    await screenshot(page, "create-monitor-more-types");
  });

  test("by keyboard: search, Enter, then Change and Escape keep the choice", async ({
    page,
  }: {
    page: Page;
  }) => {
    const total: number = await offeredTypeCount(page);
    await openCreate(page);

    await page.getByTestId("card-select-search").click();
    await page.keyboard.type("k8s");
    await expect(page.getByTestId("card-select-search-summary")).toHaveText(
      `Showing 1 of ${total}`,
    );
    await page.keyboard.press("Enter");

    await expect(summary(page)).toHaveAttribute(
      "data-card-select-value",
      "Kubernetes",
    );
    await expect(page.getByTestId("card-select-change")).toBeFocused();

    // Change from the keyboard: the search box takes focus.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("card-select-search")).toBeFocused();
    await expect(option(page, "Kubernetes")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Escape: the choice made stays.
    await page.keyboard.press("Escape");
    await expect(summary(page)).toHaveAttribute(
      "data-card-select-value",
      "Kubernetes",
    );
    await expect(page.getByTestId("card-select-change")).toBeFocused();
  });

  test("the rows are one tab stop, arrows walk them, Space picks, and Tab goes on to the name", async ({
    page,
  }: {
    page: Page;
  }) => {
    const form: Locator = await openCreate(page);

    await page.getByTestId("card-select-search").focus();
    await page.keyboard.press("Tab");
    await expect(option(page, "Website")).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(option(page, "API")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(option(page, "Ping")).toBeFocused();

    await page.keyboard.press(" ");
    await expect(summary(page)).toHaveAttribute(
      "data-card-select-value",
      "Ping",
    );
    await expect(page.getByTestId("card-select-change")).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(nameInput(form)).toBeFocused();
  });

  test("a picked type shrinks to one line, and the name moves up to meet it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const form: Locator = await openCreate(page);

    const before: number = (await boxOf(nameInput(form))).y;

    await option(page, "Website").click();

    await expect(summary(page)).toBeVisible();
    await expect(summary(page)).toContainText("Website");
    await expect(page.getByTestId("card-select-change")).toHaveText("Change");

    const after: number = (await boxOf(nameInput(form))).y;
    expect(before - after).toBeGreaterThan(100);

    await screenshot(page, "create-monitor-picked");
  });

  test("a link that names a type opens on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page, "?monitorType=Ping");

    await expect(summary(page)).toHaveAttribute(
      "data-card-select-value",
      "Ping",
    );
    expect(await shownTypes(page)).toEqual([]);
  });

  test("dark mode: the rows and the summary sit on dark surfaces", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page, "?theme=dark");

    const rowBackground: string = await option(page, "Website").evaluate(
      (element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      },
    );
    expect(rowBackground).not.toBe(WHITE_RGB);

    await option(page, "API").click();

    const summaryColors: { background: string; title: string } = await summary(
      page,
    ).evaluate((element: Element): { background: string; title: string } => {
      const title: Element | null = element.querySelector(
        "[data-testid='card-select-summary-title']",
      );
      return {
        background: getComputedStyle(element).backgroundColor,
        title: title ? getComputedStyle(title).color : "",
      };
    });
    expect(summaryColors.background).not.toBe(WHITE_RGB);
    expect(summaryColors.title).not.toBe("rgb(17, 24, 39)");

    await screenshot(page, "create-monitor-dark");
  });
});

/*
 * MORE MONITOR TYPES FOLDS AGAIN (issue #5364).
 *
 * "More monitor types" went once pressed - its aria-expanded written as
 * false - so the rest of the catalog stayed open until the page was
 * reloaded, and Change on a type it holds opened the whole catalog with no
 * More at all. It is a disclosure now: it stays where it is, its chevron
 * turns up, aria-expanded follows it, a second press folds the rest away
 * with focus kept on it, and Change opens the rest when the type is one of
 * them. What jsdom cannot show is checked here: the chevron as drawn, the
 * page settling back to the six rows, the keyboard's real tab order, a
 * phone's width, the dark theme, German and Persian, and the monitor
 * template form's dialog, which draws the same picker.
 */

function more(page: Page): Locator {
  return page.getByTestId("card-select-more");
}

// The More chevron's turn as drawn, in degrees (0 down, 180 up), once at rest.
async function chevronTurn(page: Page): Promise<number> {
  return page
    .getByTestId("card-select-more-chevron")
    .evaluate((element: Element): number => {
      const transform: string = getComputedStyle(element).transform;
      const matrix: DOMMatrix = new DOMMatrix(
        transform === "none" ? undefined : transform,
      );
      return Math.round(
        Math.abs((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI),
      );
    });
}

async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

// Waits until no finite animation or transition is running.
async function atRest(page: Page): Promise<void> {
  await page.waitForFunction((): boolean => {
    return document.getAnimations().every((animation: Animation): boolean => {
      return (
        animation.playState !== "running" ||
        animation.effect?.getTiming().iterations === Infinity
      );
    });
  });
}

test.describe("More monitor types folds the rest away again", () => {
  test("pressed again, it folds the rest away: aria-expanded, the chevron, focus, and the form back where it was", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const form: Locator = await openCreate(page);

    const nameBefore: number = (await boxOf(nameInput(form))).y;

    await expect(more(page)).toHaveAttribute("aria-expanded", "false");
    await expect
      .poll(() => {
        return chevronTurn(page);
      })
      .toBe(0);

    await more(page).click();

    await expect(more(page)).toHaveAttribute("aria-expanded", "true");
    await expect(more(page)).toHaveText("More monitor types");
    await expect
      .poll(() => {
        return chevronTurn(page);
      })
      .toBe(180);
    await expect(option(page, "IP")).toBeFocused();
    await expect(option(page, "Kubernetes")).toBeVisible();
    expect((await boxOf(nameInput(form))).y).toBeGreaterThan(nameBefore + 400);

    await atRest(page);
    await screenshot(page, "create-monitor-more-open");

    await more(page).click();

    await expect(more(page)).toHaveAttribute("aria-expanded", "false");
    await expect(more(page)).toBeFocused();
    await expect
      .poll(() => {
        return chevronTurn(page);
      })
      .toBe(0);
    expect(await shownTypes(page)).toEqual(COMMON_TYPES);
    await expect(page.getByTestId("card-select-more-options")).toHaveCount(0);
    await expect(form).not.toContainText("Infrastructure");
    // Nothing else moved: the name is back where it was.
    expect(
      Math.abs((await boxOf(nameInput(form))).y - nameBefore),
    ).toBeLessThan(2);

    // And it opens again, as often as it is pressed.
    await more(page).click();
    await expect(option(page, "Kubernetes")).toBeVisible();

    await atRest(page);
    await screenshot(page, "create-monitor-more-folded-again");
  });

  test("by keyboard: Enter opens it, Shift+Tab is back on More, Space folds it and focus stays", async ({
    page,
  }: {
    page: Page;
  }) => {
    const form: Locator = await openCreate(page);

    // The rows are one tab stop, then More.
    await page.getByTestId("card-select-search").focus();
    await page.keyboard.press("Tab");
    await expect(option(page, "Website")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(more(page)).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(more(page)).toHaveAttribute("aria-expanded", "true");
    await expect(option(page, "IP")).toBeFocused();

    // Arrows walk on through what it brought.
    await page.keyboard.press("ArrowRight");
    await expect(option(page, "Domain")).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(more(page)).toBeFocused();

    await page.keyboard.press(" ");
    await expect(more(page)).toHaveAttribute("aria-expanded", "false");
    await expect(more(page)).toBeFocused();
    expect(await shownTypes(page)).toEqual(COMMON_TYPES);

    // On to the name, past the rows More folded away.
    await page.keyboard.press("Tab");
    await expect(nameInput(form)).toBeFocused();
  });

  test("a type among the rest picked, then Change: the rest open on it, More folds it, Escape keeps it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page, "?monitorType=Kubernetes");

    await expect(summary(page)).toHaveAttribute(
      "data-card-select-value",
      "Kubernetes",
    );

    await page.getByTestId("card-select-change").click();

    await expect(more(page)).toHaveAttribute("aria-expanded", "true");
    await expect(option(page, "Kubernetes")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByTestId("card-select-search")).toBeFocused();

    await more(page).click();

    await expect(more(page)).toHaveAttribute("aria-expanded", "false");
    expect(await shownTypes(page)).toEqual(COMMON_TYPES);
    await expect(more(page)).toBeFocused();

    /*
     * No row on screen is checked, though Kubernetes is still the choice:
     * More's line names it after a dot, as the More fields line under it
     * names what it holds - on the same line, More's name its words alone.
     */
    const selection: Locator = page.getByTestId("card-select-more-selection");
    await expect(selection).toHaveText("Selected: Kubernetes");
    await expect(more(page)).toHaveAccessibleName("More monitor types");
    await expect(more(page)).toHaveAccessibleDescription(
      "Selected: Kubernetes",
    );
    // On the words' line: their middles level.
    const title: { y: number; height: number } = await boxOf(
      page.getByTestId("card-select-more-title"),
    );
    const named: { y: number; height: number } = await boxOf(selection);
    expect(
      Math.abs(named.y + named.height / 2 - (title.y + title.height / 2)),
    ).toBeLessThan(2);

    await atRest(page);
    await screenshot(page, "create-monitor-more-folded-selection");

    await page.keyboard.press("Escape");

    await expect(summary(page)).toHaveAttribute(
      "data-card-select-value",
      "Kubernetes",
    );
    await expect(page.getByTestId("card-select-change")).toBeFocused();
  });

  test("More's line and the More fields line under it are one style: the same indigo, weight and size, chevrons in line with the rows", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openCreate(page);

    const styleOf: (locator: Locator) => Promise<Array<string>> = (
      locator: Locator,
    ): Promise<Array<string>> => {
      return locator.evaluate((element: Element): Array<string> => {
        const style: CSSStyleDeclaration = getComputedStyle(element);
        return [style.color, style.fontWeight, style.fontSize];
      });
    };

    const moreTitle: Locator = page.getByTestId("card-select-more-title");
    const fieldsTitle: Locator = page
      .getByTestId("folded-section-title")
      .first();

    expect(await styleOf(moreTitle)).toEqual(await styleOf(fieldsTitle));

    // Both chevrons start where the rows do (to the pixel, give or take one).
    const rows: { x: number } = await boxOf(
      page.getByTestId("card-select-common"),
    );
    const moreChevron: { x: number } = await boxOf(
      page.getByTestId("card-select-more-chevron"),
    );
    const fieldsChevron: { x: number } = await boxOf(
      page.getByTestId("folded-section-chevron").first(),
    );
    expect(Math.abs(moreChevron.x - rows.x)).toBeLessThan(2);
    expect(Math.abs(fieldsChevron.x - rows.x)).toBeLessThan(2);

    // Under the pointer, its words underline, as a link's do.
    await more(page).hover();
    await expect
      .poll(() => {
        return moreTitle.evaluate((element: Element): string => {
          return getComputedStyle(element).textDecorationLine;
        });
      })
      .toBe("underline");
  });

  test("on a phone, in German, the choice it folds away wraps under its words, whole", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCreate(page, "?monitorType=Custom%20JavaScript%20Code&lang=de");

    await page.getByTestId("card-select-change").click();
    await expect(more(page)).toHaveAttribute("aria-expanded", "true");
    await more(page).click();
    await expect(more(page)).toHaveAttribute("aria-expanded", "false");

    const selection: Locator = page.getByTestId("card-select-more-selection");
    await expect(selection).toHaveText("Ausgewählt: Custom JavaScript Code");
    await expect(page.getByTestId("card-select-more-title")).toHaveText(
      "Weitere Monitortypen",
    );

    // On a line of its own, under the words: one line tall, never cut in two.
    const title: { x: number; y: number; height: number } = await boxOf(
      page.getByTestId("card-select-more-title"),
    );
    const named: { x: number; y: number; height: number } =
      await boxOf(selection);
    const lineHeight: number = await more(page).evaluate(
      (element: Element): number => {
        return parseFloat(getComputedStyle(element).lineHeight);
      },
    );
    expect(named.y).toBeGreaterThan(title.y + title.height - 2);
    expect(Math.abs(named.x - title.x)).toBeLessThan(2);
    expect(named.height).toBeLessThanOrEqual(lineHeight + 1);
    await expect
      .poll(() => {
        return sidewaysOverflow(page);
      })
      .toBeLessThanOrEqual(0);

    await atRest(page);
    await screenshot(page, "create-monitor-more-folded-selection-de-phone");
  });

  test("a search hides More, and clearing it brings More back as it was left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page);

    await more(page).click();
    await page.getByTestId("card-select-search").fill("k8s");

    await expect(more(page)).toHaveCount(0);
    expect(await shownTypes(page)).toEqual(["Kubernetes"]);

    await page.getByTestId("card-select-search-clear").click();

    await expect(more(page)).toHaveAttribute("aria-expanded", "true");
    await expect(option(page, "Kubernetes")).toBeVisible();

    await more(page).click();
    expect(await shownTypes(page)).toEqual(COMMON_TYPES);
  });

  test("on a phone: it opens and folds with nothing wider than the screen, and stays in sight", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCreate(page);

    await more(page).click();
    await expect(more(page)).toHaveAttribute("aria-expanded", "true");
    await expect
      .poll(() => {
        return sidewaysOverflow(page);
      })
      .toBeLessThanOrEqual(0);

    // One type a line, as the common rows are.
    const ip: { x: number; y: number } = await boxOf(option(page, "IP"));
    const domain: { x: number; y: number } = await boxOf(
      option(page, "Domain"),
    );
    expect(Math.abs(ip.x - domain.x)).toBeLessThan(2);
    expect(domain.y).toBeGreaterThan(ip.y);

    await atRest(page);
    await screenshot(page, "create-monitor-more-open-phone");

    await more(page).click();

    await expect(more(page)).toHaveAttribute("aria-expanded", "false");
    await expect(more(page)).toBeInViewport();
    await expect
      .poll(() => {
        return sidewaysOverflow(page);
      })
      .toBeLessThanOrEqual(0);
    expect(await shownTypes(page)).toEqual(COMMON_TYPES);
  });

  test("dark mode: More reads on the dark surface, open and folded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page, "?theme=dark");

    const colorOf: () => Promise<string> = (): Promise<string> => {
      return page
        .getByTestId("card-select-more-title")
        .evaluate((element: Element): string => {
          return getComputedStyle(element).color;
        });
    };

    // Not the light theme's indigo-600, which is too dark to read there.
    expect(await colorOf()).not.toBe("rgb(79, 70, 229)");

    await more(page).click();
    await page.mouse.move(0, 0);
    await expect(more(page)).toHaveAttribute("aria-expanded", "true");
    expect(await colorOf()).not.toBe("rgb(79, 70, 229)");

    const headingColor: string = await page
      .getByTestId("card-select-more-options")
      .getByText("Infrastructure", { exact: true })
      .evaluate((element: Element): string => {
        return getComputedStyle(element).color;
      });
    expect(headingColor).not.toBe("rgb(107, 114, 128)");

    await atRest(page);
    await screenshot(page, "create-monitor-more-open-dark");
  });

  test("in German: Weitere Monitortypen opens and folds the rest", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openCreate(page, "?lang=de");

    await expect(more(page)).toHaveText("Weitere Monitortypen");

    await more(page).click();
    await expect(more(page)).toHaveAttribute("aria-expanded", "true");
    await expect(option(page, "Kubernetes")).toBeVisible();

    await atRest(page);
    await screenshot(page, "create-monitor-more-open-de");

    await more(page).click();
    await expect(more(page)).toHaveAttribute("aria-expanded", "false");
    expect(await shownTypes(page)).toEqual(COMMON_TYPES);
  });

  test("in Persian: More sits at the line's start, its chevron points down and up as in English, and fits a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCreate(page, "?lang=fa");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(more(page)).toHaveText("انواع دیگر مانیتور");

    /*
     * The start of a right-to-left line is its right edge: the chevron is
     * there, in line with the rows' edge (the button reaches a little past
     * it, for room inside its focus ring).
     */
    const chevron: { x: number; width: number } = await boxOf(
      page.getByTestId("card-select-more-chevron"),
    );
    const rows: { x: number; width: number } = await boxOf(
      page.getByTestId("card-select-common"),
    );
    expect(
      Math.abs(chevron.x + chevron.width - (rows.x + rows.width)),
    ).toBeLessThan(2);

    // A chevron that points down or up is not mirrored.
    const scale: string = await page
      .getByTestId("card-select-more-chevron")
      .evaluate((element: Element): string => {
        return getComputedStyle(element).scale;
      });
    expect(scale === "none" || scale === "1").toBe(true);

    await more(page).click();
    await expect(more(page)).toHaveAttribute("aria-expanded", "true");
    await expect
      .poll(() => {
        return chevronTurn(page);
      })
      .toBe(180);
    await expect
      .poll(() => {
        return sidewaysOverflow(page);
      })
      .toBeLessThanOrEqual(0);

    await atRest(page);
    await screenshot(page, "create-monitor-more-open-fa-phone");

    await more(page).click();
    await expect(more(page)).toHaveAttribute("aria-expanded", "false");
    await expect
      .poll(() => {
        return chevronTurn(page);
      })
      .toBe(0);
  });
});

/*
 * The monitor template form (Settings > Monitor Templates, Create) draws the
 * same picker on its Monitor Defaults step, in a dialog: More folds there
 * too, and Escape after Change keeps the type picked without closing it.
 */
test.describe("A monitor template's More monitor types", () => {
  const TEMPLATES_PATH: string = `/dashboard/${PROJECT_ID}/monitors/settings/templates`;

  async function openTemplateDefaults(page: Page): Promise<Locator> {
    await page.clock.setFixedTime(NOW);
    await page.goto(TEMPLATES_PATH);
    await expect(page.getByTestId("synthetic-banner")).toBeVisible({
      timeout: 60000,
    });

    await page
      .getByRole("button", { name: "Create Monitor Template" })
      .first()
      .click();

    const dialog: Locator = page.getByTestId("modal");
    await expect(dialog).toBeVisible({ timeout: 30000 });

    await dialog
      .getByPlaceholder("Production API Health")
      .fill("Checkout API health");
    await dialog.getByRole("button", { name: "Next", exact: true }).click();

    await expect(dialog.getByTestId("card-select-common")).toBeVisible({
      timeout: 30000,
    });
    await atRest(page);

    return dialog;
  }

  test("More opens the rest in the dialog and folds it again, focus kept", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const dialog: Locator = await openTemplateDefaults(page);

    const toggle: Locator = dialog.getByTestId("card-select-more");

    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(dialog.getByTestId("card-select-option-IP")).toBeFocused();
    await expect(
      dialog.getByTestId("card-select-option-Kubernetes"),
    ).toBeVisible();

    await atRest(page);
    await screenshot(page, "monitor-template-more-open");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    await expect(dialog.getByTestId("card-select-more-options")).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });

  test("a type among the rest, then Change: More open, folds it, and Escape keeps the type and the dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openTemplateDefaults(page);

    await dialog.getByTestId("card-select-more").click();
    await dialog.getByTestId("card-select-option-Kubernetes").click();
    await expect(dialog.getByTestId("card-select-summary")).toHaveAttribute(
      "data-card-select-value",
      "Kubernetes",
    );

    await dialog.getByTestId("card-select-change").click();
    await expect(dialog.getByTestId("card-select-more")).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await dialog.getByTestId("card-select-more").click();
    await expect(dialog.getByTestId("card-select-more")).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    // The template's type is out of sight, so More's line names it.
    await expect(dialog.getByTestId("card-select-more-selection")).toHaveText(
      "Selected: Kubernetes",
    );

    await atRest(page);
    await screenshot(page, "monitor-template-more-folded-selection");

    await page.keyboard.press("Escape");

    await expect(dialog.getByTestId("card-select-summary")).toHaveAttribute(
      "data-card-select-value",
      "Kubernetes",
    );
    await expect(dialog).toBeVisible();
  });

  test("on a phone, in the dialog: it opens and folds with nothing wider than the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const dialog: Locator = await openTemplateDefaults(page);

    const toggle: Locator = dialog.getByTestId("card-select-more");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect
      .poll(() => {
        return sidewaysOverflow(page);
      })
      .toBeLessThanOrEqual(0);

    await atRest(page);
    await screenshot(page, "monitor-template-more-open-phone");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeInViewport();
  });
});

test.describe("Create Monitor, start to finish", () => {
  test("a website monitor: folded default criteria, no early error, then Create Monitor", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    const form: Locator = await openCreate(page);

    await option(page, "Website").click();
    await nameInput(form).fill("Storefront checkout");
    await form.getByRole("button", { name: "Next", exact: true }).click();

    // The criteria step: what to check first, the criteria folded below.
    await expect(
      form.getByText("Monitor Criteria", { exact: true }).first(),
    ).toBeVisible({ timeout: 60000 });
    const headers: Locator = page.getByTestId("monitor-criteria-header");
    await expect(headers).toHaveCount(2, { timeout: 30000 });

    for (const toggle of await headers.locator("button[aria-expanded]").all()) {
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    }

    // Folded criteria are out of sight - and out of the keyboard's reach.
    const bodies: Locator = page.getByTestId("monitor-criteria-body");
    for (const body of await bodies.all()) {
      await expect(body).toBeHidden();
    }
    const focusable: boolean = await page
      .getByTestId("monitor-criteria-body")
      .first()
      .evaluate((body: Element): boolean => {
        const field: HTMLElement | null = body.querySelector("input");
        field?.focus();
        return Boolean(field) && document.activeElement === field;
      });
    expect(focusable).toBe(false);

    // ...and they do not stretch the page with blank space below the form.
    const blankBelow: number = await page.evaluate((): number => {
      const formElement: HTMLElement | null = document.getElementById(
        "create-monitor-form",
      );
      const bottom: number = formElement
        ? formElement.getBoundingClientRect().bottom + window.scrollY
        : 0;
      return document.documentElement.scrollHeight - bottom;
    });
    expect(blankBelow).toBeLessThan(300);

    // No error before anything is typed.
    await expect(
      form.getByText("Monitor Destination is required."),
    ).toHaveCount(0);

    // The address field says what to type, with an example in the box.
    const url: Locator = form.getByPlaceholder("https://example.com", {
      exact: true,
    });
    await expect(url).toBeVisible();
    await expect(
      form.getByText("The page to check, like https://example.com."),
    ).toBeVisible();

    await screenshot(page, "create-monitor-criteria");

    // Next with no address: now the step says what is missing, by Next.
    await form.getByRole("button", { name: "Next", exact: true }).click();
    const missing: Locator = form.getByText("Monitor Destination is required.");
    await expect(missing).toBeVisible();
    await expect(missing).toBeInViewport();

    await url.fill("https://storefront.acme-commerce.example");
    await form.getByRole("button", { name: "Next", exact: true }).click();

    // Probes & Interval: the default interval, and one probe picked.
    await expect(
      form.getByText("Every 5 Minutes", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      form.getByText(
        "How often to check. Every 5 minutes suits most monitors.",
      ),
    ).toBeVisible();
    await page.getByRole("combobox", { name: /^Probes/ }).click();
    await page
      .getByRole("option", { name: "Frankfurt (eu-central-1)", exact: true })
      .click();
    await page.keyboard.press("Escape");

    await page.getByTestId("Create Monitor").click();

    await expect(page).toHaveURL(
      `/dashboard/${PROJECT_ID}/monitors/${CREATED_MONITOR_ID}`,
      { timeout: 30000 },
    );
    await expect(page.getByTestId("stub-page")).toHaveAttribute(
      "data-page",
      "created-monitor",
    );

    const creates: Array<RecordedCreate> = await createsRecorded(page);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.modelName).toBe("Monitor");
    expect(creates[0]!.data["monitorType"]).toBe("Website");
    expect(creates[0]!.data["name"]).toBe("Storefront checkout");
    expect(creates[0]!.data["monitoringInterval"]).toBe("*/5 * * * *");
    expect(JSON.stringify(creates[0]!.data["monitorSteps"])).toContain(
      "storefront.acme-commerce.example",
    );
    expect(creates[0]!.miscDataProps?.["probes"]).toEqual([FRANKFURT_PROBE_ID]);
  });

  test("a manual monitor: one step, Create Monitor right there, no interval", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(120000);

    const form: Locator = await openCreate(page);

    await page.getByTestId("card-select-more").click();
    await option(page, "Manual").click();
    await nameInput(form).fill("Payment provider status");

    await expect(
      form.getByRole("button", { name: "Next", exact: true }),
    ).toHaveCount(0);

    await page.getByTestId("Create Monitor").click();

    await expect(page).toHaveURL(
      `/dashboard/${PROJECT_ID}/monitors/${CREATED_MONITOR_ID}`,
      { timeout: 30000 },
    );

    const creates: Array<RecordedCreate> = await createsRecorded(page);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.data["monitorType"]).toBe("Manual");
    expect(creates[0]!.data["name"]).toBe("Payment provider status");
    expect(creates[0]!.data["monitoringInterval"]).toBeUndefined();
  });
});

/*
 * QUICK SETUP'S ALERT TEMPLATES, ON AN INFRASTRUCTURE MONITOR.
 *
 * Kubernetes (and nine other infrastructure types) start their criteria
 * step on Quick Setup: pick a template, and it fills in the metric, the
 * thresholds and the criteria. The list carried every template's whole
 * description - up to 509 characters of metric names and formulas,
 * seventeen cards one under the other (eighteen since #5421). Now each template is one compact
 * row (name, severity, one line saying when it fires), two to a line on a
 * wide screen. Once one is picked the list folds into it, the way the type
 * picker on step one does: its row with Change, its full description
 * behind Show more, and its Time Range right under it - where the list's
 * seventeen rows used to put them a screen away from the row clicked.
 */
test.describe("Quick Setup's alert templates", () => {
  const KUBERNETES_TEMPLATE_COUNT: number = 18;
  const ETCD_DESCRIPTION_START: string =
    "Requires the agent's control-plane scrape";

  async function openKubernetesQuickSetup(
    page: Page,
    query: string = "",
  ): Promise<Locator> {
    const form: Locator = await openCreate(
      page,
      `?monitorType=Kubernetes${query ? `&${query}` : ""}`,
    );

    await nameInput(form).fill("Production cluster health");
    await form.getByRole("button", { name: "Next", exact: true }).click();

    const templates: Locator = page.getByRole("radiogroup", {
      name: "Alert templates",
    });
    await expect(templates).toBeVisible({ timeout: 60000 });

    return form;
  }

  test("one row per template, two to a line, and no long description on the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(120000);

    await openKubernetesQuickSetup(page);

    const rows: Locator = page
      .getByRole("radiogroup", { name: "Alert templates" })
      .getByRole("radio");
    await expect(rows).toHaveCount(KUBERNETES_TEMPLATE_COUNT);

    // Under the picker's headings, in its order.
    await expect(
      page.getByTestId("alert-template-picker").getByRole("heading"),
    ).toHaveText([
      "Availability",
      "Workload",
      "Node",
      "Control Plane",
      "Storage",
      "Scheduling",
    ]);

    /*
     * Two to a line: the first two Workload templates share a top (#5421's
     * Cluster Stopped Reporting has the Availability group to itself).
     */
    const workloadRows: Locator = page
      .getByTestId("alert-template-group-Workload")
      .getByRole("radio");
    const first: { x: number; y: number; width: number; height: number } =
      await boxOf(workloadRows.nth(0));
    const second: { x: number; y: number; width: number; height: number } =
      await boxOf(workloadRows.nth(1));
    expect(Math.abs(first.y - second.y)).toBeLessThan(2);
    expect(second.x).toBeGreaterThan(first.x + first.width - 2);

    // Compact: a name line and a summary of one or two short lines.
    for (const row of await rows.all()) {
      expect((await boxOf(row)).height).toBeLessThan(90);
    }

    // Each says in one line when it fires; the formula stays off the list.
    await expect(
      page.getByTestId("alert-template-summary-k8s-high-cpu"),
    ).toHaveText("A node uses more than 90% of its allocatable CPU.");
    await expect(
      page.getByText(ETCD_DESCRIPTION_START, { exact: false }),
    ).toHaveCount(0);
    await expect(
      page.getByText("k8s.node.cpu.usage", { exact: false }),
    ).toHaveCount(0);

    // Nothing is picked yet, and the list is one tab stop.
    for (const row of await rows.all()) {
      await expect(row).toHaveAttribute("aria-checked", "false");
    }
    await expect(rows.nth(0)).toHaveAttribute("tabindex", "0");
    await expect(rows.nth(1)).toHaveAttribute("tabindex", "-1");

    await screenshot(page, "create-monitor-alert-templates");
  });

  test("a picked template folds the list: the template, Change, its Time Range, and the criteria it made, all in one screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(150000);

    const form: Locator = await openKubernetesQuickSetup(page);

    // The cluster the monitor watches.
    await form
      .locator(".ou-select__control", { hasText: "Select a cluster..." })
      .click();
    await page
      .locator(".ou-select__option", {
        hasText: "Production cluster (eu-west-1)",
      })
      .click();

    // A row from the middle of the list: eight rows are under it.
    await page.getByTestId("alert-template-k8s-etcd-no-leader").click();

    // The list folded into the template.
    await expect(
      page.getByRole("radiogroup", { name: "Alert templates" }),
    ).toHaveCount(0);
    const picked: Locator = page.getByTestId("alert-template-picked");
    await expect(picked).toBeVisible();
    await expect(picked.getByTestId("alert-template-picked-name")).toHaveText(
      "etcd No Leader",
    );
    await expect(
      picked.getByTestId("alert-template-picked-summary"),
    ).toHaveText(
      "etcd has no leader. Needs control plane metrics, so not on EKS, GKE or AKS.",
    );
    await expect(page.getByTestId("alert-template-change")).toBeFocused();

    // Its full description is one press away, not on screen by default.
    await expect(page.getByText(ETCD_DESCRIPTION_START)).toHaveCount(0);
    await picked.getByRole("button", { name: "Show more" }).click();
    await expect(
      picked.getByTestId("alert-template-description"),
    ).toContainText(ETCD_DESCRIPTION_START);

    // Its Time Range right under it, and the criteria it made right after.
    const timeRange: Locator = page.getByTestId("alert-template-configuration");
    await expect(timeRange.getByText("Time Range")).toBeVisible();
    await expect(
      timeRange.getByText("How far back each check looks."),
    ).toBeVisible();
    const pickedBox: { y: number; height: number } = await boxOf(picked);
    const timeRangeBox: { y: number; height: number } = await boxOf(timeRange);
    expect(timeRangeBox.y - (pickedBox.y + pickedBox.height)).toBeLessThan(40);

    const criteria: Locator = page
      .getByTestId("monitor-criteria-header")
      .first();
    await expect(criteria).toContainText("etcd No Leader");
    // Everything a pick changed fits one screen under the cluster picker.
    expect((await boxOf(criteria)).y - pickedBox.y).toBeLessThan(600);

    await screenshot(page, "create-monitor-alert-template-picked");

    await page.getByTestId("Create Monitor").click();
    await expect(page).toHaveURL(
      `/dashboard/${PROJECT_ID}/monitors/${CREATED_MONITOR_ID}`,
      { timeout: 30000 },
    );

    const creates: Array<RecordedCreate> = await createsRecorded(page);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.data["monitorType"]).toBe("Kubernetes");

    const steps: string = JSON.stringify(creates[0]!.data["monitorSteps"]);
    expect(steps).toContain("prod-eu-west-1");
    expect(steps).toContain("etcd No Leader");
  });

  test("Change opens the list again on the picked row; picking it again, or Escape, keeps the criteria as edited", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(150000);

    await openKubernetesQuickSetup(page);

    await page.getByTestId("alert-template-k8s-high-cpu").click();
    const criteriaName: Locator = page
      .getByTestId("monitor-criteria-header")
      .first();
    await expect(criteriaName).toContainText("High CPU");

    // Change what the template made: its incident's title.
    await criteriaName.locator("button[aria-expanded]").first().click();
    const incidentTitle: Locator = page
      .getByTestId("monitor-criteria-body")
      .first()
      .getByPlaceholder("e.g., {{monitorName}} is down")
      .first();
    await expect(incidentTitle).toHaveValue(/High CPU/);
    await incidentTitle.fill("CPU is pegged on a node");

    await page.getByTestId("alert-template-change").click();

    // The list, on the picked row: checked, focused, scrolled to.
    const highCpu: Locator = page.getByTestId("alert-template-k8s-high-cpu");
    await expect(highCpu).toHaveAttribute("aria-checked", "true");
    await expect(highCpu).toBeFocused();
    await expect(highCpu).toBeInViewport();
    await expect(page.getByTestId("alert-template-configuration")).toHaveCount(
      0,
    );

    // The same template again: folded, and the template is not applied anew.
    await highCpu.click();
    await expect(page.getByTestId("alert-template-picked")).toHaveAttribute(
      "data-alert-template-id",
      "k8s-high-cpu",
    );
    await expect(incidentTitle).toHaveValue("CPU is pegged on a node");

    // Escape after Change keeps it too.
    await page.getByTestId("alert-template-change").click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("alert-template-picked")).toHaveAttribute(
      "data-alert-template-id",
      "k8s-high-cpu",
    );
    await expect(page.getByTestId("alert-template-change")).toBeFocused();
    await expect(incidentTitle).toHaveValue("CPU is pegged on a node");

    // Another template is a new pick: folded into it, its criteria in.
    await page.getByTestId("alert-template-change").click();
    await page.getByTestId("alert-template-k8s-node-not-ready").click();
    await expect(page.getByTestId("alert-template-picked-name")).toHaveText(
      "Node Not Ready",
    );
    await expect(criteriaName).toContainText("Node Not Ready");
  });

  test("fits a phone: one row a line, and the folded template uses the screen's width", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 390, height: 844 });

    await openKubernetesQuickSetup(page);

    const rows: Locator = page
      .getByRole("radiogroup", { name: "Alert templates" })
      .getByRole("radio");
    const first: { x: number; y: number; width: number } = await boxOf(
      rows.nth(0),
    );
    const second: { x: number; y: number } = await boxOf(rows.nth(1));
    expect(second.y).toBeGreaterThan(first.y);

    for (const row of await rows.all()) {
      const box: { x: number; width: number } = await boxOf(row);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }

    await rows.nth(2).click();

    const picked: { x: number; y: number; width: number; height: number } =
      await boxOf(page.getByTestId("alert-template-picked"));
    const summaryLine: { width: number } = await boxOf(
      page.getByTestId("alert-template-picked-summary"),
    );
    const change: { x: number; y: number } = await boxOf(
      page.getByTestId("alert-template-change"),
    );
    const timeRange: { x: number; width: number } = await boxOf(
      page.getByTestId("alert-template-configuration"),
    );

    expect(picked.x + picked.width).toBeLessThanOrEqual(390);
    expect(timeRange.x + timeRange.width).toBeLessThanOrEqual(390);
    // On a phone Change goes under the words, which keep the frame's width.
    expect(change.y).toBeGreaterThan(picked.y + 40);
    expect(summaryLine.width).toBeGreaterThan(picked.width - 40);
    expect(
      await page.evaluate((): boolean => {
        return (
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1
        );
      }),
    ).toBe(false);

    await screenshot(page, "create-monitor-alert-templates-phone");
  });

  test("dark mode: the rows, the folded template and its Change sit on dark surfaces", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(120000);

    await openKubernetesQuickSetup(page, "theme=dark");

    const row: Locator = page.getByTestId("alert-template-k8s-high-cpu");
    expect(
      await row.evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      }),
    ).not.toBe(WHITE_RGB);

    await row.click();

    for (const element of [
      page.getByTestId("alert-template-picked"),
      page.getByTestId("alert-template-change"),
    ]) {
      expect(
        await element.evaluate((node: Element): string => {
          return getComputedStyle(node).backgroundColor;
        }),
      ).not.toBe(WHITE_RGB);
    }

    // The name reads light on the dark frame.
    expect(
      await page
        .getByTestId("alert-template-picked-name")
        .evaluate((node: Element): string => {
          return getComputedStyle(node).color;
        }),
    ).not.toBe("rgb(17, 24, 39)");

    await screenshot(page, "create-monitor-alert-templates-dark");
  });
});

/*
 * PLAINER FIELDS ON THE CRITERIA STEP.
 *
 * The maintainer, on a switch whose help explained two modes: "Shouldnt this
 * be two buttons ... to make it easier for people to understand whats going
 * on", with the simpler mode the default, and shorter descriptions
 * everywhere. On Create Monitor:
 *
 *   - SQL Server's sign-in is an Authentication choice of two, Username and
 *     password first, each saying in one line what it means; Windows
 *     Integrated Authentication takes the username and password away (it was
 *     a switch, "Use Windows Integrated Authentication", whose help said the
 *     fields it left on screen were ignored);
 *   - a Synthetic monitor starts on Chromium at Desktop, and asks for at
 *     least one browser before it goes on (an empty list ran nothing, and
 *     never failed);
 *   - Retries on Failure says what it is in one line; its full rule, which
 *     ran to five lines under the field, waits in the (i) by its title.
 */
test.describe("Create Monitor's plainer fields", () => {
  async function goToProbesAndCreate(page: Page, form: Locator): Promise<void> {
    await form.getByRole("button", { name: "Next", exact: true }).click();

    const probes: Locator = page.getByRole("combobox", { name: /^Probes/ });
    await expect(probes).toBeVisible({ timeout: 30000 });
    await probes.click();
    await page
      .getByRole("option", { name: "Frankfurt (eu-central-1)", exact: true })
      .click();
    await page.keyboard.press("Escape");

    await page.getByTestId("Create Monitor").click();

    await expect(page).toHaveURL(
      `/dashboard/${PROJECT_ID}/monitors/${CREATED_MONITOR_ID}`,
      { timeout: 30000 },
    );
  }

  /*
   * The step list beside the form is as wide as its titles. Only a step not
   * reached yet kept its title on one line, so on the last step "Probes &
   * Interval" and "Monitor Info" wrapped and the form beside them moved, and
   * a two-step form wrapped "Monitor Info" from the start.
   */
  async function stepList(page: Page): Promise<{
    width: number;
    titleHeights: Array<number>;
  }> {
    const list: Locator = page.getByRole("navigation", { name: "Progress" });
    await expect(list).toBeVisible({ timeout: 30000 });

    const titleHeights: Array<number> = [];
    for (const step of await list.getByRole("listitem").all()) {
      titleHeights.push((await boxOf(step)).height);
    }

    return { width: (await boxOf(list)).width, titleHeights: titleHeights };
  }

  test("the step list keeps every title on one line, and its width, on every step", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    /*
     * 1280px, a common laptop width: the list is squeezed by the form beside
     * it, and on the last step "Probes & Interval" wrapped.
     */
    await page.setViewportSize({ width: 1280, height: 1000 });

    const form: Locator = await openCreate(page, "?monitorType=Website");
    await nameInput(form).fill("Storefront");
    await form.getByRole("button", { name: "Next", exact: true }).click();
    await expect(
      form.getByPlaceholder("https://example.com", { exact: true }),
    ).toBeVisible({ timeout: 60000 });

    const onCriteria: { width: number; titleHeights: Array<number> } =
      await stepList(page);
    expect(onCriteria.titleHeights).toHaveLength(3);

    await form
      .getByPlaceholder("https://example.com", { exact: true })
      .fill("https://storefront.acme-commerce.example");
    await form.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("combobox", { name: /^Probes/ })).toBeVisible({
      timeout: 30000,
    });

    const onLastStep: { width: number; titleHeights: Array<number> } =
      await stepList(page);

    // One line each (a two-line title is about 40px tall).
    for (const height of [
      ...onCriteria.titleHeights,
      ...onLastStep.titleHeights,
    ]) {
      expect(height).toBeLessThan(28);
    }
    // The list, and so the form beside it, did not move.
    expect(Math.abs(onLastStep.width - onCriteria.width)).toBeLessThan(1);
  });

  test("a two-step form keeps Monitor Info on one line", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(120000);

    const form: Locator = await openCreate(
      page,
      "?monitorType=Incoming%20Request",
    );
    await nameInput(form).fill("Nightly billing export");
    await form.getByRole("button", { name: "Next", exact: true }).click();

    const list: { width: number; titleHeights: Array<number> } =
      await stepList(page);
    expect(list.titleHeights).toHaveLength(2);
    for (const height of list.titleHeights) {
      expect(height).toBeLessThan(28);
    }
  });

  test("SQL Server asks how to sign in: two plain choices, and Windows Integrated Authentication drops the username and password", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    const form: Locator = await openCreate(page, "?monitorType=SQL%20Query");

    await nameInput(form).fill("Orders database");
    await form.getByRole("button", { name: "Next", exact: true }).click();

    const authentication: Locator = page.getByRole("radiogroup", {
      name: /^Authentication/,
    });

    // PostgreSQL first: nothing to choose, a username and a password.
    await expect(form.getByText("Database Type", { exact: true })).toBeVisible({
      timeout: 60000,
    });
    await expect(authentication).toHaveCount(0);

    /*
     * Host and Port share a line, their boxes level: neither has a line of
     * help (one under Host alone pushed its box below Port's), and the port
     * takes a quarter of the line.
     */
    const hostBox: { x: number; y: number; width: number; height: number } =
      await boxOf(form.getByPlaceholder("db.internal", { exact: true }));
    const portBox: { x: number; y: number; width: number; height: number } =
      await boxOf(form.getByPlaceholder("5432", { exact: true }));
    expect(Math.abs(hostBox.y - portBox.y)).toBeLessThan(1);
    expect(portBox.x).toBeGreaterThan(hostBox.x + hostBox.width);
    expect(portBox.width).toBeLessThan(hostBox.width / 2);

    const databaseType: Locator = form
      .locator("div")
      .filter({ has: page.getByText("Database Type", { exact: true }) })
      .filter({ has: page.getByRole("combobox") })
      .last();
    await databaseType.getByRole("combobox").click();
    await page
      .getByRole("option", { name: "Microsoft SQL Server", exact: true })
      .click();

    await expect(authentication).toBeVisible();

    const usernameAndPassword: Locator = authentication.getByRole("radio", {
      name: "Username and password",
      exact: true,
    });
    const windows: Locator = authentication.getByRole("radio", {
      name: "Windows Integrated Authentication",
      exact: true,
    });
    await expect(usernameAndPassword).toBeChecked();
    await expect(windows).not.toBeChecked();
    await expect(usernameAndPassword).toHaveAccessibleDescription(
      "Sign in with a SQL Server login.",
    );
    await expect(windows).toHaveAccessibleDescription(
      "Sign in as the account the probe runs as. No password needed.",
    );

    // Each option's line sits under its label, and its radio on the label's line.
    const label: { x: number; y: number; width: number; height: number } =
      await boxOf(
        authentication.getByText("Windows Integrated Authentication", {
          exact: true,
        }),
      );
    const line: { x: number; y: number } = await boxOf(
      authentication.getByText(
        "Sign in as the account the probe runs as. No password needed.",
        { exact: true },
      ),
    );
    const radio: { x: number; y: number; width: number; height: number } =
      await boxOf(windows);
    expect(line.y).toBeGreaterThan(label.y);
    expect(Math.abs(line.x - label.x)).toBeLessThan(2);
    expect(
      Math.abs(radio.y + radio.height / 2 - (label.y + label.height / 2)),
    ).toBeLessThan(4);
    expect(radio.x + radio.width).toBeLessThan(label.x);

    const username: Locator = form.getByPlaceholder("readonly_user", {
      exact: true,
    });
    const password: Locator = form.getByPlaceholder(
      "{{monitorSecrets.dbPassword}}",
      { exact: true },
    );
    await expect(username).toBeVisible();
    await expect(password).toBeVisible();

    await windows.check();

    await expect(windows).toBeChecked();
    await expect(usernameAndPassword).not.toBeChecked();
    await expect(username).toHaveCount(0);
    await expect(password).toHaveCount(0);

    await screenshot(page, "create-monitor-sql-server-authentication");

    await form
      .getByPlaceholder("db.internal", { exact: true })
      .fill("sql.acme-commerce.internal");
    await form.getByPlaceholder("orders", { exact: true }).fill("orders");
    await form
      .getByPlaceholder(
        "SELECT COUNT(*) FROM orders WHERE status = 'CANCELLED'",
        { exact: true },
      )
      .fill("SELECT COUNT(*) FROM orders");

    await goToProbesAndCreate(page, form);

    const creates: Array<RecordedCreate> = await createsRecorded(page);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.data["monitorType"]).toBe("SQL Query");
    const steps: string = JSON.stringify(creates[0]!.data["monitorSteps"]);
    expect(steps).toContain('"databaseType":"Microsoft SQL Server"');
    expect(steps).toContain('"useWindowsIntegratedAuthentication":true');
  });

  test("a synthetic monitor starts on Chromium at Desktop, and asks for a browser before it goes on", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    const form: Locator = await openCreate(
      page,
      "?monitorType=Synthetic%20Monitor",
    );

    await nameInput(form).fill("Checkout journey");
    await form.getByRole("button", { name: "Next", exact: true }).click();

    const chromium: Locator = form.getByRole("checkbox", {
      name: "Chromium",
      exact: true,
    });
    await expect(chromium).toBeVisible({ timeout: 60000 });
    await expect(chromium).toBeChecked();
    await expect(
      form.getByRole("checkbox", { name: "Firefox", exact: true }),
    ).not.toBeChecked();
    await expect(
      form.getByRole("checkbox", { name: "Desktop", exact: true }),
    ).toBeChecked();
    for (const size of ["Mobile", "Tablet"]) {
      await expect(
        form.getByRole("checkbox", { name: size, exact: true }),
      ).not.toBeChecked();
    }
    await expect(
      form.getByText("The browsers to run the script in.", { exact: true }),
    ).toBeVisible();

    await screenshot(page, "create-monitor-synthetic-defaults");

    await form
      .getByTestId("code-editor-input")
      .fill(
        "await page.goto('https://storefront.acme-commerce.example');\nreturn { data: {} };",
      );

    // No browser: the step says so, by Next, and goes nowhere.
    await chromium.uncheck();
    await form.getByRole("button", { name: "Next", exact: true }).click();
    const noBrowser: Locator = form.getByText(
      "Pick at least one browser to run the script in.",
    );
    await expect(noBrowser).toBeVisible();
    await expect(noBrowser).toBeInViewport();
    await expect(page.getByRole("combobox", { name: /^Probes/ })).toHaveCount(
      0,
    );

    await chromium.check();
    await goToProbesAndCreate(page, form);

    const creates: Array<RecordedCreate> = await createsRecorded(page);
    expect(creates).toHaveLength(1);
    const steps: string = JSON.stringify(creates[0]!.data["monitorSteps"]);
    expect(steps).toContain('"browserTypes":["Chromium"]');
    expect(steps).toContain('"screenSizeTypes":["Desktop"]');
  });

  test("Retries on Failure says what it is in one line, and its rule waits in the (i), inside the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(120000);

    const form: Locator = await openCreate(page, "?monitorType=Website");

    await nameInput(form).fill("Storefront");
    await form.getByRole("button", { name: "Next", exact: true }).click();

    const moreFields: Locator = page.getByTestId("monitor-step-more-fields");
    await expect(moreFields).toBeVisible({ timeout: 60000 });
    await moreFields.getByTestId("folded-section-header").click();

    await expect(
      moreFields.getByText(
        "How many times to try again before the check fails. Up to 3.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      moreFields.getByText(
        "How long to wait for each attempt, up to 60 seconds.",
        { exact: true },
      ),
    ).toBeVisible();
    // The rule is not under the field any more.
    await expect(moreFields.getByText(/0 means one attempt/)).toHaveCount(0);

    const about: Locator = moreFields.getByRole("button", {
      name: "About Retries on Failure",
      exact: true,
    });
    await about.focus();

    const tooltip: Locator = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(
      "How many times to retry after a failed attempt: 0 means one attempt, 2 means up to 3.",
    );
    await expect(tooltip).toContainText(
      "Invalid or blocked targets, oversized responses, and too many redirects are not retried.",
    );

    // The long rule wraps inside the window instead of running off it.
    const box: { x: number; width: number } = await boxOf(tooltip);
    const viewport: { width: number; height: number } | null =
      page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport!.width);
    expect(box.width).toBeLessThan(600);

    await screenshot(page, "create-monitor-retries-tooltip");
  });

  /*
   * "Can we make this more subtle, this needs to be done across the
   * project for more fields. Takes up too much real estate right now." -
   * the maintainer, on the More fields card. The monitor form draws its own
   * More fields (a fold titled More fields, not a field of a form's list),
   * and it is the same quiet line as every form's.
   */
  test("the request settings' More fields is the same quiet line as every form's", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(120000);

    const form: Locator = await openCreate(page, "?monitorType=Website");

    await nameInput(form).fill("Storefront");
    await form.getByRole("button", { name: "Next", exact: true }).click();

    const moreFields: Locator = page.getByTestId("monitor-step-more-fields");
    await expect(moreFields).toBeVisible({ timeout: 60000 });
    await expect(moreFields).toHaveAttribute("data-variant", "line");

    /*
     * In the Monitor Target card, under the URL: no card of its own any
     * more, so drawn after the card it would open its fields loose between
     * two cards.
     */
    // The card nearest the title: the page's own card holds this one too.
    const target: Locator = page
      .getByText("Monitor Target", { exact: true })
      .locator("xpath=ancestor::*[@data-testid='card'][1]");
    await expect(target).toHaveCount(1);
    await expect(target.getByTestId("monitor-step-more-fields")).toHaveCount(1);

    const url: { y: number } | null = await target
      .getByPlaceholder("https://example.com")
      .boundingBox();
    const line: { y: number } | null = await moreFields.boundingBox();
    expect(line!.y).toBeGreaterThan(url!.y);

    const header: Locator = moreFields.getByTestId("folded-section-header");
    await expect(header).toHaveAttribute("aria-expanded", "false");
    await expect(header).toHaveAccessibleName("More fields");
    // What it holds, after its title.
    await expect(header).toContainText(/^More fields\s*·\s*\S/);

    // A line or two of text, never the card it was; no frame, no tile.
    const folded: { height: number } | null = await moreFields.boundingBox();
    expect(folded!.height).toBeLessThanOrEqual(56);

    const frame: () => Promise<string> = async (): Promise<string> => {
      return await moreFields.evaluate((element: Element) => {
        return getComputedStyle(element).borderTopWidth;
      });
    };

    expect(await frame()).toBe("0px");
    await expect(moreFields.getByTestId("folded-section-icon")).toHaveCount(0);

    await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "true");
    await expect(
      moreFields.getByText(
        "How many times to try again before the check fails. Up to 3.",
        { exact: true },
      ),
    ).toBeVisible();
    // Open, still no box: its fields follow the line.
    expect(await frame()).toBe("0px");

    await screenshot(page, "create-monitor-more-fields-line");
  });
});

/*
 * THE PLAN'S LIMIT ON ACTIVE MONITORS, ON CREATE MONITOR.
 *
 * The support report: a project bought from a reseller with a plan of 500
 * active monitors had 2,881. The server now refuses every new active
 * monitor at the limit (Common/Server/Utils/Billing/ActiveMonitorLimit);
 * the page says so above the form before anything is filled in
 * (Components/Monitor/ActiveMonitorLimitNotice), from
 * GET /monitor/active-monitor-limit (?monitorLimit= in the fixture), on a
 * billed install (?billing=true): a self-hosted one has no plans and asks
 * nothing. The form stays: a Manual monitor never counts, and one can still
 * be made from it. On the Free plan (?plan=free) the notice comes first,
 * above the pricing card, which fills a phone's screen.
 */
test.describe("Create Monitor at the plan's monitor limit", () => {
  function notice(page: Page): Locator {
    return page.getByTestId("active-monitor-limit-notice");
  }

  async function limitRequests(page: Page): Promise<number> {
    return page.evaluate((): number => {
      const state:
        | { apiRequests?: Array<{ method: string; url: string }> }
        | undefined = (
        window as unknown as {
          __monitorOverviewFixture?: {
            apiRequests?: Array<{ method: string; url: string }>;
          };
        }
      ).__monitorOverviewFixture;

      return (state?.apiRequests || []).filter(
        (request: { method: string; url: string }): boolean => {
          return (
            request.method === "GET" &&
            new URL(request.url).pathname ===
              "/api/monitor/active-monitor-limit"
          );
        },
      ).length;
    });
  }

  test("a project with no limit sees nothing above the form, and asks once", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page, "?billing=true");

    await expect
      .poll(() => {
        return limitRequests(page);
      })
      .toBe(1);
    await expect(notice(page)).toHaveCount(0);
  });

  test("a self-hosted install has no plans: nothing is asked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page, "?monitorLimit=over");

    await expect(option(page, "Website")).toBeVisible();
    expect(await limitRequests(page)).toBe(0);
    await expect(notice(page)).toHaveCount(0);
  });

  test("under the limit, nothing", async ({ page }: { page: Page }) => {
    await openCreate(page, "?billing=true&monitorLimit=under");

    await expect
      .poll(() => {
        return limitRequests(page);
      })
      .toBe(1);
    await expect(notice(page)).toHaveCount(0);
  });

  test("at a plan's own limit: above the form, which limit, how many, what to do and what counts, with the plan a click away", async ({
    page,
  }: {
    page: Page;
  }) => {
    const form: Locator = await openCreate(
      page,
      "?billing=true&monitorLimit=at",
    );

    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toContainText(
      "You've reached your plan's monitor limit",
    );
    await expect(notice(page)).toContainText(
      "Your plan includes 500 active monitors, and this project has 500.",
    );
    await expect(notice(page)).toContainText(
      "To add more, delete monitors you no longer need or change your plan.",
    );
    await expect(notice(page)).toContainText(
      "Manual monitors don't count towards the limit, so you can still add them. Monitors that are turned off or archived do count.",
    );
    await expect(notice(page)).not.toContainText("keep running");

    const viewPlan: Locator = notice(page).getByRole("link", {
      name: "View plan",
    });
    await expect(viewPlan).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/settings/billing`,
    );

    // Above the form, which stays: a Manual monitor never counts.
    const noticeBox: { y: number; height: number } = await boxOf(notice(page));
    const formBox: { y: number } = await boxOf(form);
    expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(formBox.y);
    await expect(option(page, "Website")).toBeVisible();

    await screenshot(page, "create-monitor-limit-at");
  });

  // The support report's project: 2,881 active monitors on a plan of 500.
  test("past a plan's own limit: its monitors keep running, and when it can add again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page, "?billing=true&monitorLimit=over");

    await expect(notice(page)).toContainText(
      "You're over your plan's monitor limit",
    );
    await expect(notice(page)).toContainText(
      "Your plan includes 500 active monitors, and this project has 2,881.",
    );
    await expect(notice(page)).toContainText(
      "All of them keep running, but no more can be added until the project has fewer than 500.",
    );

    await screenshot(page, "create-monitor-limit-over");
  });

  test("at the Free plan's limit: first on the page, above the pricing card, and upgrade", async ({
    page,
  }: {
    page: Page;
  }) => {
    const form: Locator = await openCreate(
      page,
      "?billing=true&plan=free&monitorLimit=free-at",
    );

    await expect(notice(page)).toContainText(
      "You've reached the Free plan's monitor limit",
    );
    // Each active monitor on the Free plan is paid as you go: it allows them.
    await expect(notice(page)).toContainText(
      "The Free plan allows up to 10 active monitors, and this project has 10.",
    );
    await expect(notice(page)).toContainText("Upgrade your plan to add more.");
    await expect(
      notice(page).getByRole("link", { name: "View plans" }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/settings/billing`);

    // The notice, then the Free plan's pricing card, then the form.
    const pricing: Locator = page.getByTestId("monitor-pay-as-you-go-card");
    await expect(pricing).toBeVisible();
    const noticeBox: { y: number; height: number } = await boxOf(notice(page));
    const pricingBox: { y: number; height: number } = await boxOf(pricing);
    const formBox: { y: number } = await boxOf(form);
    expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(pricingBox.y);
    expect(pricingBox.y + pricingBox.height).toBeLessThanOrEqual(formBox.y);

    await screenshot(page, "create-monitor-limit-free");
  });

  test("on a phone, on the Free plan, the notice is on the first screen, not under the prices", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCreate(page, "?billing=true&plan=free&monitorLimit=free-at");

    await expect(notice(page)).toBeVisible();
    await expect(page.getByTestId("monitor-pay-as-you-go-card")).toBeVisible();

    await page.evaluate((): void => {
      window.scrollTo(0, 0);
    });

    const box: { y: number; height: number } = await boxOf(notice(page));
    expect(box.y + box.height).toBeLessThanOrEqual(844);
  });

  test("at the limit, a Manual monitor - which never counts - is still made from the same form", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(120000);

    const form: Locator = await openCreate(
      page,
      "?billing=true&monitorLimit=at",
    );

    await expect(notice(page)).toContainText("so you can still add them");

    await page.getByTestId("card-select-more").click();
    await option(page, "Manual").click();
    await nameInput(form).fill("Payment provider status");
    await page.getByTestId("Create Monitor").click();

    await expect(page).toHaveURL(
      `/dashboard/${PROJECT_ID}/monitors/${CREATED_MONITOR_ID}`,
      { timeout: 30000 },
    );

    const creates: Array<RecordedCreate> = await createsRecorded(page);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.data["monitorType"]).toBe("Manual");
  });

  test("a limit that cannot be read draws nothing, and the form works", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page, "?billing=true&monitorLimit=fail");

    await expect
      .poll(() => {
        return limitRequests(page);
      })
      .toBe(1);
    await expect(notice(page)).toHaveCount(0);
    await expect(option(page, "Website")).toBeVisible();
  });

  test("fits a phone: the notice wraps inside the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCreate(page, "?billing=true&monitorLimit=over");

    await expect(notice(page)).toBeVisible();

    const overflow: number = await page.evaluate((): number => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });
    expect(overflow).toBeLessThanOrEqual(0);

    const box: { x: number; width: number } = await boxOf(notice(page));
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);

    await screenshot(page, "create-monitor-limit-phone");
  });

  test("dark mode: the notice sits on a dark surface", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCreate(page, "?theme=dark&billing=true&monitorLimit=over");

    await expect(notice(page)).toBeVisible();

    const background: string = await notice(page).evaluate(
      (element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      },
    );
    expect(background).not.toBe(WHITE_RGB);

    await screenshot(page, "create-monitor-limit-dark");
  });
});
