import {
  Browser,
  BrowserContext,
  expect,
  Locator,
  Page,
  Route,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * STATUS PAGE > RESOURCES' GRID, AT REAL WIDTHS (#7239, #7430).
 *
 * A status page group in grid view is edited as the matrix it renders as:
 * one column per Region, one row per Service, the monitors in each cell
 * (Common/UI/Components/StatusPage/ResourceGrid.tsx, its classes in
 * ResourceGridLayout.ts). Where the grid's box is narrower than its matrix
 * needs - 6rem and 13rem a column, a container query on the grid's own box
 * (#7087) - it is drawn as a stack: each row a box under its value, its
 * cells tiles of at least 17rem, as many to a line as fit (#7430).
 *
 * jsdom (Common/Tests/UI/Components/StatusPage/ResourceGridNarrow.test.tsx,
 * ResourceGridTailwind.test.ts) pins the classes and the CSS the Dashboard's
 * Tailwind writes for them. It lays nothing out: a Tailwind that stopped
 * writing a container variant, a Resources card padded differently, or a
 * chip whose name lost its room would pass there. Here the real Resources
 * screen is drawn in Chromium, over the journeys' fixture (?seed=status-
 * page-grid: "Regions", Service by three Regions with long monitor names
 * and two resources off the grid, and "Regions worldwide", by six), and
 * measured:
 *
 *   - at 390, 768, 1024, 1280, 1440 and 1920 pixels, nothing scrolls
 *     sideways, neither the grid's box nor the page;
 *   - the three-column grid is a stack up to 1280 and a matrix from 1440,
 *     each cell naming its column only in the stack;
 *   - the stack's tiles share a line where they fit: one in a phone's box,
 *     two beside the side menu at 1280 and 1440, four at 1920 for six
 *     regions;
 *   - a chip's name keeps at least 140px while its Edit and ⋯ wait, which
 *     sit inside the chip once hovered; where nothing can hover they are
 *     drawn, in their own room;
 *   - in Arabic, read right to left, the tiles run from the right and the
 *     line of a resource off the grid keeps both its axes, the second on a
 *     line of its own on a phone;
 *   - and every look, English and Arabic, light and dark, at 390 and 1280,
 *     is kept as a picture: grid-<language>-<theme>-<width>.png.
 */

const PORT: string =
  process.env["STATUS_PAGE_TELEMETRY_GUIDED_SETUPS_FIXTURE_PORT"] || "4866";
const ORIGIN: string = `http://127.0.0.1:${PORT}`;
const PROJECT: string = "10000000-0000-4000-8000-000000006831";
// ?seed=status-page-grid's status page (Journeys/Fixture/NewProject.js).
const GRID_PAGE: string = "66000000-0000-4000-8000-000000007239";
const RESOURCES: string = `/dashboard/${PROJECT}/status-pages/${GRID_PAGE}/resources`;
const NOW: Date = new Date("2026-11-11T10:00:00.000Z");
// Where the Dashboard keeps the reader's language (DashboardLanguage.ts).
const LANGUAGE_KEY: string = "oneuptimeLang";
const SHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/status-page-telemetry-guided-setups-ui",
);

// The two grid groups (Journeys/Fixture/NewProject.js' GRID_GROUPS).
const THREE_REGIONS: string = "Regions";
const SIX_REGIONS: string = "Regions worldwide";

// Below this the screen shows its group list or one group, not both.
const BESIDE_THE_LIST_FROM_IN_PX: number = 1024;

type Language = "en" | "ar";
type Theme = "light" | "dark";

interface Look {
  lang: Language;
  theme: Theme;
  width: number;
}

const pageErrors: Array<string> = [];
const leftTheMachine: Array<string> = [];

// Nothing the product throws, and nothing that leaves this machine.
async function guard(page: Page): Promise<void> {
  page.on("pageerror", (error: Error) => {
    pageErrors.push(error.message);
  });
  await page.route(
    (url: URL) => {
      return url.origin !== ORIGIN;
    },
    async (route: Route) => {
      leftTheMachine.push(route.request().url());
      await route.abort();
    },
  );
  await page.clock.setFixedTime(NOW);
}

test.beforeEach(async ({ page }: { page: Page }) => {
  pageErrors.length = 0;
  leftTheMachine.length = 0;
  await guard(page);
});

test.afterEach(() => {
  expect(pageErrors, "the product threw").toEqual([]);
  expect(leftTheMachine, "a request left this machine").toEqual([]);
});

// The grid of the group open on the screen.
function gridOf(page: Page): Locator {
  return page.getByTestId("status-page-resource-grid");
}

/*
 * The status page's Resources screen, in this look, with this group open:
 * from the group list on a phone or a tablet, where the screen shows one or
 * the other, and beside it from 1024px.
 */
async function openResources(
  page: Page,
  look: Look,
  group: string = THREE_REGIONS,
): Promise<void> {
  await page.setViewportSize({ width: look.width, height: 900 });
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // A page that cannot keep it draws English, and the checks say so.
      }
    },
    { key: LANGUAGE_KEY, value: look.lang },
  );
  await page.goto(
    `${ORIGIN}${RESOURCES}?seed=status-page-grid&theme=${look.theme}`,
  );

  const html: Locator = page.locator("html");

  await expect(html).toHaveAttribute("dir", look.lang === "ar" ? "rtl" : "ltr");

  if (look.theme === "dark") {
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  } else {
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
  }

  // The first group opens by itself beside the list; on a phone, a tap opens it.
  if (look.width < BESIDE_THE_LIST_FROM_IN_PX || group !== THREE_REGIONS) {
    await page
      .getByTestId("status-page-resource-navigator-row")
      .filter({
        has: page.getByTestId("status-page-resource-navigator-name").filter({
          hasText: new RegExp(`^${group}$`),
        }),
      })
      .getByTestId("status-page-resource-navigator-select")
      .click();
  }

  await expect(gridOf(page)).toBeVisible();
  await expect(
    gridOf(page).getByTestId("status-page-resource-grid-cell-item").first(),
  ).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

interface GridFacts {
  // The grid's box, and how wide what it holds is.
  boxWidth: number;
  scrollWidth: number;
  clientWidth: number;
  // A stack: each row a grid of tiles, each cell naming its column.
  isStack: boolean;
  areCellLabelsDrawn: boolean;
  areColumnHeadingsDrawn: boolean;
  // Each row's tiles, line by line: [2, 1] is two on its first line, one on its second.
  tilesPerLine: Array<Array<number>>;
}

async function gridFacts(page: Page): Promise<GridFacts> {
  return await gridOf(page).evaluate((grid: Element): GridFacts => {
    const scroller: Element = grid.firstElementChild as Element;
    const rows: Array<Element> = Array.from(
      grid.querySelectorAll("tbody > tr"),
    );
    const labels: Array<Element> = Array.from(
      grid.querySelectorAll(
        "[data-testid='status-page-resource-grid-cell-label']",
      ),
    );
    const head: Element | null = grid.querySelector("thead");

    return {
      boxWidth: Math.round(grid.getBoundingClientRect().width),
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
      isStack: rows.every((row: Element): boolean => {
        return getComputedStyle(row).display === "grid";
      }),
      areCellLabelsDrawn: labels.every((label: Element): boolean => {
        return getComputedStyle(label).display !== "none";
      }),
      areColumnHeadingsDrawn: Boolean(
        head && getComputedStyle(head).display !== "none",
      ),
      tilesPerLine: rows.map((row: Element): Array<number> => {
        const lines: Map<number, number> = new Map<number, number>();

        for (const cell of Array.from(row.querySelectorAll(":scope > td"))) {
          const top: number = Math.round(cell.getBoundingClientRect().top);
          lines.set(top, (lines.get(top) || 0) + 1);
        }

        return Array.from(lines.entries())
          .sort((first: [number, number], second: [number, number]) => {
            return first[0] - second[0];
          })
          .map((line: [number, number]): number => {
            return line[1];
          });
      }),
    };
  });
}

// The room the names of the grid's chips have, the narrowest first.
async function nameWidths(page: Page): Promise<Array<number>> {
  return await gridOf(page)
    .getByTestId("status-page-resource-grid-name")
    .evaluateAll((names: Array<Element>): Array<number> => {
      return names
        .map((name: Element): number => {
          return Math.floor(name.getBoundingClientRect().width);
        })
        .sort((first: number, second: number) => {
          return first - second;
        });
    });
}

// The grid's box and the page, both held to their width.
async function expectNothingScrollsSideways(
  page: Page,
  moment: string,
): Promise<void> {
  const facts: GridFacts = await gridFacts(page);

  expect(
    facts.scrollWidth,
    `${moment}: the grid's box scrolls sideways`,
  ).toBeLessThanOrEqual(facts.clientWidth);
  await expectNoSidewaysScroll(page, { message: moment });
}

/*
 * The three-column grid: a stack while its box is narrower than its 45rem
 * matrix - which every width up to 1280 leaves it, beside the side menu -
 * and its matrix from 1440. Tiles in the stack: one to a line in the boxes
 * of a phone, a tablet and a 1024px window, two beside the side menu of a
 * 1280px window.
 */
const THREE_REGIONS_AT: Array<{
  width: number;
  isStack: boolean;
  tilesPerLine?: Array<Array<number>> | undefined;
}> = [
  {
    width: 390,
    isStack: true,
    tilesPerLine: [
      [1, 1, 1],
      [1, 1, 1],
    ],
  },
  {
    width: 768,
    isStack: true,
    tilesPerLine: [
      [1, 1, 1],
      [1, 1, 1],
    ],
  },
  {
    width: 1024,
    isStack: true,
    tilesPerLine: [
      [1, 1, 1],
      [1, 1, 1],
    ],
  },
  {
    width: 1280,
    isStack: true,
    tilesPerLine: [
      [2, 1],
      [2, 1],
    ],
  },
  { width: 1440, isStack: false },
  { width: 1920, isStack: false },
];

for (const expected of THREE_REGIONS_AT) {
  test(`a three-region grid at ${expected.width}px: nothing scrolls sideways, and it is a ${expected.isStack ? "stack of tiles" : "matrix"}`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await openResources(page, {
      lang: "en",
      theme: "light",
      width: expected.width,
    });

    await expectNothingScrollsSideways(page, `${expected.width}px`);

    const facts: GridFacts = await gridFacts(page);

    expect(facts.isStack).toBe(expected.isStack);
    // Each cell names its column in the stack, and the column headings do in the matrix.
    expect(facts.areCellLabelsDrawn).toBe(expected.isStack);
    expect(facts.areColumnHeadingsDrawn).toBe(!expected.isStack);

    if (expected.tilesPerLine) {
      expect(facts.tilesPerLine).toEqual(expected.tilesPerLine);
    }

    // A chip's name keeps its room while its Edit and ⋯ wait.
    expect((await nameWidths(page))[0]).toBeGreaterThanOrEqual(140);
  });
}

/*
 * #7430: six regions are a stack at every laptop's width - 1,014px of
 * matrix - and its tiles share a line: two beside the side menu of a 1280
 * and a 1440px window, four at 1920. Each cell used to be a line as wide
 * as the box, twelve tall lines for the grid's two rows.
 */
for (const expected of [
  {
    width: 1280,
    tilesPerLine: [
      [2, 2, 2],
      [2, 2, 2],
    ],
  },
  {
    width: 1440,
    tilesPerLine: [
      [2, 2, 2],
      [2, 2, 2],
    ],
  },
  {
    width: 1920,
    tilesPerLine: [
      [4, 2],
      [4, 2],
    ],
  },
]) {
  test(`a six-region grid at ${expected.width}px: tiles side by side, nothing scrolling sideways`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await openResources(
      page,
      { lang: "en", theme: "light", width: expected.width },
      SIX_REGIONS,
    );

    await expectNothingScrollsSideways(
      page,
      `six regions, ${expected.width}px`,
    );

    const facts: GridFacts = await gridFacts(page);

    expect(facts.isStack).toBe(true);
    expect(facts.areCellLabelsDrawn).toBe(true);
    expect(facts.tilesPerLine).toEqual(expected.tilesPerLine);
    expect((await nameWidths(page))[0]).toBeGreaterThanOrEqual(140);
  });
}

test("hovered, a chip's Edit and ⋯ are drawn inside it, and its name gives way to them", async ({
  page,
}: {
  page: Page;
}) => {
  for (const width of [1440, 1280]) {
    await openResources(page, { lang: "en", theme: "light", width });

    const chip: Locator = gridOf(page)
      .getByTestId("status-page-resource-grid-cell-item")
      .first();
    const actions: Locator = chip.getByTestId(
      "status-page-resource-grid-actions",
    );

    // Waiting: out of the chip's row, and not seen.
    await expect(actions).toHaveCSS("opacity", "0");
    await expect(actions).toHaveCSS("position", "absolute");

    await chip.hover();

    await expect(actions).toHaveCSS("opacity", "1");
    await expect(actions).toHaveCSS("position", "static");

    const chipBox: { x: number; width: number } = (await chip.boundingBox())!;
    const actionsBox: { x: number; width: number } =
      (await actions.boundingBox())!;

    expect(actionsBox.x).toBeGreaterThanOrEqual(chipBox.x);
    expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(
      chipBox.x + chipBox.width,
    );
    await expect(
      chip.getByTestId("status-page-resource-grid-edit"),
    ).toBeVisible();
    await expect(
      chip.getByTestId("status-page-resource-grid-more"),
    ).toBeVisible();

    // The name gives way to them, ending in "...", and is still drawn.
    const name: { width: number } = (await chip
      .getByTestId("status-page-resource-grid-name")
      .boundingBox())!;

    expect(name.width).toBeGreaterThan(0);
    expect(name.width).toBeLessThan(chipBox.width - actionsBox.width);
  }
});

/*
 * A phone or a tablet, where nothing can hover (hover: none, pointer:
 * coarse): a chip's Edit and ⋯ are always drawn, in their own room, at a
 * finger's size, as a list's row draws them.
 */
test("where nothing can hover, a chip's Edit and ⋯ are always drawn, in their own room", async ({
  browser,
}: {
  browser: Browser;
}) => {
  const context: BrowserContext = await browser.newContext({
    hasTouch: true,
  });
  const page: Page = await context.newPage();

  await guard(page);

  try {
    for (const width of [390, 1280]) {
      await openResources(page, { lang: "en", theme: "light", width });

      expect(
        await page.evaluate(() => {
          return window.matchMedia("(hover: none)").matches;
        }),
      ).toBe(true);

      const chips: Locator = gridOf(page).getByTestId(
        "status-page-resource-grid-cell-item",
      );

      for (const index of [0, 1]) {
        const actions: Locator = chips
          .nth(index)
          .getByTestId("status-page-resource-grid-actions");

        await expect(actions).toHaveCSS("opacity", "1");
        await expect(actions).toHaveCSS("position", "static");
        await expect(
          chips.nth(index).getByTestId("status-page-resource-grid-edit"),
        ).toBeVisible();
      }

      // Beside a finger's buttons, the narrowest name still reads.
      expect((await nameWidths(page))[0]).toBeGreaterThanOrEqual(120);
      await expectNothingScrollsSideways(page, `no hover, ${width}px`);
    }
  } finally {
    await context.close();
  }
});

/*
 * In Arabic, read right to left: the tiles run from the right, and the
 * line of a resource off the grid keeps both its axes, each read the way it
 * is written; on a phone the second takes a line of its own (#7087).
 */
test("in Arabic, the tiles run from the right, and a resource off the grid keeps both its axes", async ({
  page,
}: {
  page: Page;
}) => {
  await openResources(page, { lang: "ar", theme: "light", width: 1280 });
  await expectNothingScrollsSideways(page, "Arabic, 1280px");

  const facts: GridFacts = await gridFacts(page);

  expect(facts.isStack).toBe(true);
  expect(facts.tilesPerLine).toEqual([
    [2, 1],
    [2, 1],
  ]);

  // The first cell of a row is its line's rightmost tile.
  const firstRow: Locator = gridOf(page).locator("tbody > tr").first();
  const cells: Locator = firstRow.locator(":scope > td");
  const first: { x: number } = (await cells.nth(0).boundingBox())!;
  const second: { x: number } = (await cells.nth(1).boundingBox())!;

  expect(first.x).toBeGreaterThan(second.x);

  await openResources(page, { lang: "ar", theme: "light", width: 390 });
  await expectNothingScrollsSideways(page, "Arabic, 390px");

  const lines: Locator = page.getByTestId(
    "status-page-resource-grid-orphan-axes",
  );

  await expect(lines).toHaveCount(2);

  // "Service: Search · Region: Asia Pacific": both axes, the second under the first.
  const longest: Locator = lines.filter({ hasText: "Asia Pacific" });
  const axes: Locator = longest.getByTestId(
    "status-page-resource-grid-orphan-axis",
  );

  await expect(axes).toHaveCount(2);
  await expect(axes.nth(0)).toContainText("Service");
  await expect(axes.nth(0)).toContainText("Search");
  await expect(axes.nth(1)).toContainText("Region");
  await expect(axes.nth(1)).toContainText("Asia Pacific");

  const rowAxis: { y: number } = (await axes.nth(0).boundingBox())!;
  const columnAxis: { y: number } = (await axes.nth(1).boundingBox())!;

  expect(columnAxis.y).toBeGreaterThan(rowAxis.y);

  // Neither is cut short.
  for (const index of [0, 1]) {
    expect(
      await axes.nth(index).evaluate((axis: Element): boolean => {
        return axis.scrollWidth <= axis.clientWidth;
      }),
    ).toBe(true);
  }
});

/*
 * Every look, as a picture: English and Arabic, light and dark, at a
 * phone's width and a laptop's - the grid fitting its window in each.
 */
for (const lang of ["en", "ar"] as Array<Language>) {
  for (const theme of ["light", "dark"] as Array<Theme>) {
    for (const width of [390, 1280]) {
      test(`the grid, ${lang}-${theme}-${width}: drawn, fitting its window`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await openResources(page, { lang, theme, width });
        await expectNothingScrollsSideways(page, `${lang}-${theme}-${width}`);
        await page.evaluate(() => {
          window.scrollTo({ top: 0, left: 0, behavior: "instant" });
        });
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({
          path: path.join(SHOTS, `grid-${lang}-${theme}-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
      });
    }
  }
}
