import { expect, Locator, Page, Route, test, TestInfo } from "@playwright/test";

/*
 * A dashboard opened at one of its widgets (#10084), in a real browser, on
 * both surfaces - the dashboard inside OneUptime and its public link - with
 * only the data boundary answered from fixture data (Fixture). A link that
 * names a widget (?widget=<id>) - what a warning that names what reads a
 * metric links to (Drop This Metric, More Metrics' Remove), or Add to
 * Dashboard's Open Dashboard - opens the board as it always does, then:
 *
 *   - scrolls the widget into the window once the board is drawn, its middle
 *     in the window's middle, under the toolbar's sticky header;
 *   - outlines it with a ring in the product's indigo that follows its
 *     card's corners, held a moment, then faded and gone; held still for a
 *     reader who asks for less motion; the dark theme's lighter indigo;
 *   - gives it the keyboard's focus, so Tab goes on from it;
 *   - a widget the board no longer has opens the board at its top, untouched,
 *     and a note that goes by itself says why;
 *   - on a phone, the board stacked one widget under another, the same.
 *
 * Screenshots of a widget landed on are saved for review under
 * output/playwright/dashboard-time-range-ui.
 */

interface FixtureRecord {
  unexpected: Array<string>;
}

// The fixture's port, as its config and server read it.
const PORT: string = process.env["DASHBOARD_TIME_RANGE_FIXTURE_PORT"] || "4371";

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000d1";

// The wall screen's board (Fixture/Boards.js): the Metrics template, 24 rows tall.
const WALL: string = "db000000-0000-4000-8000-000000000001";

// A widget no board of the fixture has.
const GONE: string = "cc000000-0000-4000-8000-0000000000ff";

// Far down the board: well below the fold of a 900px window.
const TARGET_TITLE: string = "GC Duration Over Time";

const LANDED: string = "data-dashboard-widget-landed";
const MISSING_NOTE: string = "dashboard-linked-widget-missing";
const MISSING_WORDS: string =
  "The widget this link points to is no longer on this dashboard.";

const SCREENSHOTS: string = "../../output/playwright/dashboard-time-range-ui";

const appPath: (search?: string) => string = (search?: string): string => {
  return `/dashboard/${PROJECT_ID}/dashboards/${WALL}${search || ""}`;
};

const publicPath: (search?: string) => string = (search?: string): string => {
  return `/public-dashboard/${WALL}${search || ""}`;
};

const record: (page: Page) => Promise<FixtureRecord> = async (
  page: Page,
): Promise<FixtureRecord> => {
  return page.evaluate((): FixtureRecord => {
    // The fixture's record (DashboardTimeRange.spec.ts declares its whole shape).
    return (
      (window as unknown as { __dashboardTimeRangeFixture?: FixtureRecord })
        .__dashboardTimeRangeFixture || { unexpected: [] }
    );
  });
};

// A widget's box on the board, by the title its card draws.
const boxOf: (page: Page, title: string) => Locator = (
  page: Page,
  title: string,
): Locator => {
  return page.locator('[id^="dashboard-component-"]', { hasText: title });
};

// The id the board draws a widget under, read off its box.
const idOf: (box: Locator) => Promise<string> = async (
  box: Locator,
): Promise<string> => {
  const id: string = (await box.getAttribute("id")) || "";

  return id.slice("dashboard-component-".length);
};

// The board drawn: the widget to land on is on the page.
const openBoard: (page: Page, path: string) => Promise<Locator> = async (
  page: Page,
  path: string,
): Promise<Locator> => {
  await page.goto(path);

  const box: Locator = boxOf(page, TARGET_TITLE);

  await expect(box).toHaveCount(1, { timeout: 60000 });

  return box;
};

// Where a box is in the window, and how tall the window is.
interface InWindow {
  top: number;
  bottom: number;
  windowHeight: number;
  scrollY: number;
}

const inWindow: (box: Locator) => Promise<InWindow> = async (
  box: Locator,
): Promise<InWindow> => {
  return box.evaluate((element: Element): InWindow => {
    const rect: DOMRect = element.getBoundingClientRect();

    return {
      top: rect.top,
      bottom: rect.bottom,
      windowHeight: window.innerHeight,
      scrollY: window.scrollY,
    };
  });
};

// The box's ring as the browser draws it.
interface Ring {
  style: string;
  color: string;
  width: string;
  offset: string;
  radius: string;
  animation: string;
}

const ringOf: (box: Locator) => Promise<Ring> = async (
  box: Locator,
): Promise<Ring> => {
  return box.evaluate((element: Element): Ring => {
    const style: CSSStyleDeclaration = window.getComputedStyle(element);

    return {
      style: style.outlineStyle,
      color: style.outlineColor,
      width: style.outlineWidth,
      offset: style.outlineOffset,
      radius: style.borderTopLeftRadius,
      animation: style.animationName,
    };
  });
};

const shoot: (
  page: Page,
  testInfo: TestInfo,
  name: string,
) => Promise<void> = async (
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> => {
  await page.screenshot({
    path: `${SCREENSHOTS}/${testInfo.project.name}-${name}.png`,
  });
};

const atDesktopOnly: () => void = (): void => {
  test.skip(
    Boolean(test.info().project.use.isMobile),
    "The same at any width: covered at 1280.",
  );
};

// Nothing the pages ask for leaves the fixture, and nothing on them throws.
let pageErrors: Array<string> = [];

test.beforeEach(async ({ page }: { page: Page }) => {
  pageErrors = [];
  page.on("pageerror", (error: Error) => {
    pageErrors.push(error.message);
  });
  await page.route("**/*", async (route: Route) => {
    const url: URL = new URL(route.request().url());

    if (url.hostname === "127.0.0.1" && url.port === PORT) {
      await route.continue();
      return;
    }

    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  const unexpected: Array<string> = await record(page)
    .then((fixture: FixtureRecord): Array<string> => {
      return fixture.unexpected;
    })
    .catch((): Array<string> => {
      return [];
    });

  expect(unexpected).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test.describe("the dashboard inside OneUptime, opened at a widget", () => {
  test("scrolls the widget into the middle of the window, rings it for a moment and gives it the focus", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    // Opened without the link, the board starts at its top, the widget out of sight.
    const before: InWindow = await inWindow(await openBoard(page, appPath()));

    expect(before.scrollY).toBe(0);
    expect(before.top).toBeGreaterThan(before.windowHeight);

    const id: string = await idOf(boxOf(page, TARGET_TITLE));
    const box: Locator = await openBoard(page, appPath(`?widget=${id}`));

    // In the window, about its middle, nothing of it under the sticky header.
    await expect
      .poll(
        async (): Promise<boolean> => {
          const place: InWindow = await inWindow(box);
          const middle: number = (place.top + place.bottom) / 2;

          return (
            place.scrollY > 0 &&
            place.top >= 0 &&
            place.bottom <= place.windowHeight &&
            Math.abs(middle - place.windowHeight / 2) < place.windowHeight / 4
          );
        },
        { timeout: 15000 },
      )
      .toBe(true);

    // Ringed: indigo, round its card, outside it, inside the board's gap.
    await expect(box).toHaveAttribute(LANDED, "true");

    const ring: Ring = await ringOf(box);

    expect(ring.style).toBe("solid");
    expect(ring.width).toBe("3px");
    expect(ring.offset).toBe("2px");
    expect(ring.radius).toBe("12px");
    expect(ring.animation).toBe("ou-dashboard-widget-landed");

    // The keyboard's focus is on it: Tab goes on from the widget.
    await expect
      .poll(async (): Promise<string> => {
        return page.evaluate((): string => {
          return document.activeElement?.id || "";
        });
      })
      .toBe(`dashboard-component-${id}`);

    await shoot(page, testInfo, "widget-link-landed");

    /*
     * A moment later the mark is gone, and the board stays where it is.
     * Opened with no click before it, the widget's focus is a keyboard's
     * (:focus-visible), so its focus ring - the same ring - stays while it
     * holds the focus; Tab goes on from it, and the ring goes with it.
     */
    await expect(box).not.toHaveAttribute(LANDED, "true", { timeout: 10000 });
    expect((await ringOf(box)).animation).toBe("none");
    expect((await inWindow(box)).scrollY).toBeGreaterThan(0);

    await page.keyboard.press("Tab");

    await expect
      .poll(async (): Promise<string> => {
        return page.evaluate((): string => {
          return (
            document.activeElement?.id || document.activeElement?.tagName || ""
          );
        });
      })
      .not.toBe(`dashboard-component-${id}`);
    expect((await ringOf(box)).style).toBe("none");
    expect(await box.getAttribute("tabindex")).toBeNull();
    // The link stays as it was opened: a reload opens it at the widget again.
    expect(new URL(page.url()).searchParams.get("widget")).toBe(id);
  });

  test("for a reader who asks for less motion, the ring is held still until it goes", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await page.emulateMedia({ reducedMotion: "reduce" });

    const id: string = await idOf(await openBoard(page, appPath()));

    expect(id).not.toBe("");

    const box: Locator = await openBoard(page, appPath(`?widget=${id}`));

    await expect(box).toHaveAttribute(LANDED, "true");

    const ring: Ring = await ringOf(box);

    expect(ring.animation).toBe("none");
    expect(ring.style).toBe("solid");
    // The product's indigo, at full strength: no fade.
    expect(ring.color).toBe("rgb(99, 102, 241)");

    await page.waitForTimeout(1500);
    expect((await ringOf(box)).color).toBe("rgb(99, 102, 241)");
  });

  test("in the dark theme, the ring is the dark theme's lighter indigo", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await page.emulateMedia({ reducedMotion: "reduce" });

    const id: string = await idOf(
      await openBoard(page, appPath("?theme=dark")),
    );
    const box: Locator = await openBoard(
      page,
      appPath(`?theme=dark&widget=${id}`),
    );

    await expect(box).toHaveAttribute(LANDED, "true");
    expect((await ringOf(box)).color).toBe("rgb(129, 140, 248)");

    await shoot(page, testInfo, "widget-link-landed-dark");
  });

  test("a widget the board no longer has opens the board at its top, and a note says why", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();

    const box: Locator = await openBoard(page, appPath(`?widget=${GONE}`));
    const note: Locator = page.getByTestId(MISSING_NOTE);

    await expect(note).toBeVisible();
    await expect(note).toContainText(MISSING_WORDS);
    // Read out politely, as every note is.
    await expect(page.getByRole("status")).toContainText(MISSING_WORDS);

    expect((await inWindow(box)).scrollY).toBe(0);
    await expect(page.locator(`[${LANDED}]`)).toHaveCount(0);

    await shoot(page, testInfo, "widget-link-missing");

    // It goes by itself.
    await expect(note).toHaveCount(0, { timeout: 15000 });
  });
});

test.describe("the public dashboard, opened at a widget", () => {
  test("scrolls the widget into view and rings it, as the dashboard inside OneUptime does", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    const id: string = await idOf(await openBoard(page, publicPath()));
    const box: Locator = await openBoard(page, publicPath(`?widget=${id}`));

    await expect
      .poll(
        async (): Promise<boolean> => {
          const place: InWindow = await inWindow(box);

          return (
            place.scrollY > 0 &&
            place.top >= 0 &&
            place.bottom <= place.windowHeight
          );
        },
        { timeout: 15000 },
      )
      .toBe(true);
    await expect(box).toHaveAttribute(LANDED, "true");

    await shoot(page, testInfo, "public-widget-link-landed");
  });

  test("a widget it no longer has opens it at its top, and a note says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    const box: Locator = await openBoard(page, publicPath(`?widget=${GONE}`));

    await expect(page.getByTestId(MISSING_NOTE)).toContainText(MISSING_WORDS);
    expect((await inWindow(box)).scrollY).toBe(0);
    await expect(page.locator(`[${LANDED}]`)).toHaveCount(0);
  });
});
