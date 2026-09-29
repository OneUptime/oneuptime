import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";

/*
 * The bucket inspector ("Investigate this moment") and a double-click on a
 * chart with no zoom to reset, in a real browser, on the real Kubernetes
 * cluster Insights page (issue #4105; the fixture is ChartTimeZoom.spec's).
 *
 * With nothing to reset, a chart acts on a click at once, so the first
 * click of a double-click opens the inspector where the pointer is. Clamped
 * into the viewport near its right or bottom edge, the inspector covers the
 * pointer, and the rest of the double-click landed on it: the second press
 * selected the word under the pointer ("Pod" of "Pod CPU Utilization", the
 * window's first word, a row number), and its click pressed whatever button
 * was there - "Investigate this moment" opened the investigation drawer.
 * The inspector now ignores the rest of the click sequence that opened it,
 * and only its values can be selected.
 *
 * Each test aims the double-click so that its second half lands on one
 * part of the inspector: a first, single click opens the inspector where it
 * will open again (the clamp does not depend on the pointer there), the
 * part is measured, the inspector is closed, and the chart is scrolled
 * under that spot.
 */

const PORT: string = "4233";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "60000000-0000-4000-8000-000000000001";
const INSIGHTS_PATH: string = `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/insights`;
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");

const CHART_TITLE: string = "Pod CPU Utilization";
// The inspector's first row: its number, then the series' name.
const FIRST_SERIES_ROW: RegExp = /^1\.\s*Pod CPU$/;
// Shown by the investigation drawer "Investigate this moment" opens.
const DRAWER_TEXT: string = "The charts this investigation started from";

interface Point {
  x: number;
  y: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type PartFunction = (inspector: Locator) => Locator;

const pageErrors: WeakMap<Page, Array<string>> = new WeakMap<
  Page,
  Array<string>
>();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
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
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
});

// The recharts plot of the chart titled CHART_TITLE.
function chart(page: Page): Locator {
  return page
    .locator("[data-testid='chart-group-plot']")
    .locator("xpath=..")
    .filter({ has: page.locator(`[title="${CHART_TITLE}"]`) })
    .locator(".recharts-wrapper");
}

function inspector(page: Page): Locator {
  return page.getByRole("dialog", { name: /^Values at/ });
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();
  if (!box) {
    throw new Error("Expected the element to be on screen");
  }
  return box;
}

async function selectedText(page: Page): Promise<string> {
  return page.evaluate((): string => {
    return String(window.getSelection());
  });
}

async function openInsights(page: Page): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.goto(INSIGHTS_PATH);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(chart(page)).toBeVisible({ timeout: 30000 });
  // Let the charts settle before the first press.
  await page.waitForTimeout(500);
}

// Scrolls the page so the chart's plot is centred on viewport y.
async function scrollChartTo(page: Page, y: number): Promise<void> {
  await chart(page).evaluate((element: Element, targetY: number): void => {
    const rect: DOMRect = element.getBoundingClientRect();
    window.scrollBy(0, rect.top + rect.height / 2 - targetY);
  }, y);
  await page.waitForTimeout(200);
}

/*
 * The spot a double-click must be aimed at for its second half to land on
 * `part` of the inspector its first half opens, with the chart under it.
 * `insideX` places the spot across the part (0 = its left edge).
 */
async function aimAt(
  page: Page,
  part: PartFunction,
  insideX: number,
): Promise<Point> {
  const viewportHeight: number = page.viewportSize()!.height;

  // Low in the viewport, where the inspector is clamped over the pointer.
  await scrollChartTo(page, viewportHeight * 0.75);
  const plot: Box = await boxOf(chart(page));
  await page.mouse.click(plot.x + plot.width - 10, plot.y + plot.height / 2);
  await expect(inspector(page)).toBeVisible();

  const partBox: Box = await boxOf(part(inspector(page)));
  const spot: Point = {
    x: partBox.x + partBox.width * insideX,
    y: partBox.y + partBox.height / 2,
  };

  // A click of its own closes it, and the page is as it was.
  await inspector(page).getByRole("button", { name: "Close" }).click();
  await expect(inspector(page)).toHaveCount(0);

  await scrollChartTo(page, spot.y);
  const scrolledPlot: Box = await boxOf(chart(page));
  expect(spot.x, "the chart is under the spot").toBeGreaterThan(scrolledPlot.x);
  expect(spot.x).toBeLessThan(scrolledPlot.x + scrolledPlot.width);
  expect(spot.y).toBeGreaterThan(scrolledPlot.y);
  expect(spot.y).toBeLessThan(scrolledPlot.y + scrolledPlot.height);
  return spot;
}

async function doubleClickAt(page: Page, spot: Point): Promise<void> {
  await page.mouse.move(spot.x, spot.y);
  await page.waitForTimeout(100);
  await page.mouse.dblclick(spot.x, spot.y, { delay: 40 });
  await page.waitForTimeout(300);
}

// What is under the spot now: the part the second click landed on.
async function textUnder(page: Page, spot: Point): Promise<string> {
  return page.evaluate((point: Point): string => {
    const element: Element | null = document.elementFromPoint(point.x, point.y);
    return (element?.textContent || "").trim();
  }, spot);
}

test.describe("Kubernetes cluster insights: a double-click on an unzoomed chart", () => {
  test("whose second click lands on Investigate this moment opens no drawer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openInsights(page);
    const spot: Point = await aimAt(
      page,
      (card: Locator): Locator => {
        return card.getByRole("button", { name: "Investigate this moment" });
      },
      0.5,
    );

    await doubleClickAt(page, spot);

    await expect(page.getByText(DRAWER_TEXT)).toHaveCount(0);
    await expect(inspector(page)).toBeVisible();
    expect(await textUnder(page, spot)).toBe("Investigate this moment");
    expect(await selectedText(page)).toBe("");
  });

  test("whose second click lands on Close leaves the inspector open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openInsights(page);
    const spot: Point = await aimAt(
      page,
      (card: Locator): Locator => {
        return card.getByRole("button", { name: "Close" });
      },
      0.5,
    );

    await doubleClickAt(page, spot);

    await expect(inspector(page)).toBeVisible();
    expect(await textUnder(page, spot)).toBe("Close");
    expect(await selectedText(page)).toBe("");
  });

  test("whose second press lands on the chart's title selects no word of it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openInsights(page);
    const spot: Point = await aimAt(
      page,
      (card: Locator): Locator => {
        return card.getByText(CHART_TITLE, { exact: true });
      },
      0.05,
    );

    await doubleClickAt(page, spot);

    await expect(inspector(page)).toBeVisible();
    expect(await textUnder(page, spot)).toBe(CHART_TITLE);
    expect(await selectedText(page)).toBe("");
  });

  test("whose second press lands on the bucket's window selects no word of it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openInsights(page);
    const spot: Point = await aimAt(
      page,
      (card: Locator): Locator => {
        return card.locator("p").nth(1);
      },
      0.05,
    );

    await doubleClickAt(page, spot);

    await expect(inspector(page)).toBeVisible();
    expect(await textUnder(page, spot)).toMatch(/GMT/);
    expect(await selectedText(page)).toBe("");
  });

  test("whose second press lands on a series selects no word of it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openInsights(page);
    const spot: Point = await aimAt(
      page,
      (card: Locator): Locator => {
        return card.getByText(FIRST_SERIES_ROW);
      },
      0.1,
    );

    await doubleClickAt(page, spot);

    await expect(inspector(page)).toBeVisible();
    expect(await textUnder(page, spot)).toMatch(/Pod CPU/);
    expect(await selectedText(page)).toBe("");
  });

  test("mid-page, where the inspector opens at the pointer, the second press selects nothing either", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openInsights(page);
    const viewportHeight: number = page.viewportSize()!.height;
    await scrollChartTo(page, viewportHeight * 0.4);
    const plot: Box = await boxOf(chart(page));
    const spot: Point = {
      x: plot.x + plot.width * 0.5,
      y: plot.y + plot.height * 0.3,
    };

    await doubleClickAt(page, spot);

    expect(await selectedText(page)).toBe("");
    await expect(page.getByText(DRAWER_TEXT)).toHaveCount(0);
  });
});

test.describe("Kubernetes cluster insights: the inspector, used on purpose", () => {
  test("a double-click of its own on a series still selects a word of it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openInsights(page);
    await scrollChartTo(page, page.viewportSize()!.height * 0.4);
    const plot: Box = await boxOf(chart(page));
    await page.mouse.click(
      plot.x + plot.width * 0.5,
      plot.y + plot.height * 0.2,
    );
    await expect(inspector(page)).toBeVisible();

    const name: Locator = inspector(page).getByText(FIRST_SERIES_ROW);
    await expect(name).toBeVisible();
    // The series' own name, past the row number.
    const word: Box = await name.evaluate((span: Element): Box => {
      const text: Node = Array.from(span.childNodes).find((node: Node) => {
        return node.nodeType === 3 && (node.textContent || "").trim() !== "";
      })!;
      const range: Range = document.createRange();
      range.selectNodeContents(text);
      const rect: DOMRect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    await page.mouse.dblclick(word.x + 4, word.y + word.height / 2, {
      delay: 40,
    });

    expect(await selectedText(page)).toBe("Pod");
  });

  test("one click on Investigate this moment opens the drawer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openInsights(page);
    await scrollChartTo(page, page.viewportSize()!.height * 0.4);
    const plot: Box = await boxOf(chart(page));
    await page.mouse.click(
      plot.x + plot.width * 0.5,
      plot.y + plot.height * 0.2,
    );
    await expect(inspector(page)).toBeVisible();

    await inspector(page)
      .getByRole("button", { name: "Investigate this moment" })
      .click();

    await expect(page.getByText(DRAWER_TEXT)).toBeVisible();
  });
});
