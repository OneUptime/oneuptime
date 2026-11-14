import { expect, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * THE PUBLIC STATUS PAGE'S RESOURCE GRID ON PHONES AND LAPTOPS, IN ENGLISH,
 * ARABIC AND PERSIAN (#7238), on the real status page - its own index.ejs,
 * Tailwind and reading-direction config, and its own app (see README.md).
 *
 * The fixture's Regions group is a grid of Service (API, Dashboard) by
 * Region (US, EU, Asia Pacific): a matrix that needs 580px. It scrolled
 * 248px sideways in the 332px a 390px phone leaves it. Now:
 *
 *   - It never scrolls sideways: at 390px it is a stack - each row a
 *     section headed by its value, each cell a tile with its column's name
 *     at its start and its status at its end, one tile to a line - and at
 *     768 and 1280 pixels, where its matrix fits, a matrix as before.
 *   - A grid whose matrix no laptop fits (grid=wide: six regions, 1,000px)
 *     is a stack there too, its tiles side by side, as many to a line as
 *     the box has room for - three at 1280, two at 768 - rather than a long
 *     list of lines with each status 700px from its name. Each tile is
 *     ruled off from the one before it, the first of a line from nothing.
 *   - In a matrix that is wider than its box (its words wider than its
 *     least width), the rows' values stay in view at the start of the line
 *     however far it scrolls, left to right in English and right to left in
 *     Arabic and Persian, ruled off on the side their cells are on.
 *   - The dark theme draws the stack on the dark card.
 *
 * Laptop-sized: each test sets its own window, so the phone project skips
 * them. Screenshots: output/playwright/status-page-theme-ui/grid-*.png.
 */

const PAGE: string = "/status-page/00000000-0000-4000-8000-000000000001";
const SCREENSHOTS: string = "../../output/playwright/status-page-theme-ui";

const ROWS: Array<string> = ["API", "Dashboard"];
const COLUMNS: Array<string> = ["US", "EU", "Asia Pacific"];
// The same group by six regions, with grid=wide.
const WIDE_COLUMNS: Array<string> = [
  "US East",
  "US West",
  "EU",
  "Asia Pacific",
  "South America",
  "Africa",
];

type LocaleTree = { [key: string]: string | LocaleTree };

// The status page's words for a key such as overview.someResourcesAre.
const wordsOf: (language: string, key: string) => string = (
  language: string,
  key: string,
): string => {
  const tree: LocaleTree = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        `../../App/FeatureSet/StatusPage/src/Locales/${language}.json`,
      ),
      "utf8",
    ),
  ) as LocaleTree;
  let node: string | LocaleTree | undefined = tree;

  for (const part of key.split(".")) {
    node = typeof node === "object" ? node[part] : undefined;
  }

  if (typeof node !== "string") {
    throw new Error(`${key} is not a text of the status page's ${language}`);
  }

  return node;
};

/*
 * The banner's words before the status, in the page's language: "Some
 * Resources are", "حالة بعض الموارد:", "برخی از منابع" (whose status
 * comes before its last word).
 */
const bannerWords: (language: string) => string = (
  language: string,
): string => {
  return wordsOf(language, "overview.someResourcesAre")
    .split("{{status}}")[0]!
    .trim();
};

interface Language {
  lang: string;
  dir: "ltr" | "rtl";
}

const LANGUAGES: Array<Language> = [
  { lang: "en", dir: "ltr" },
  { lang: "ar", dir: "rtl" },
  { lang: "fa", dir: "rtl" },
];

const openPage: (
  page: Page,
  data: { lang: string; width: number; theme?: string; grid?: string },
) => Promise<void> = async (
  page: Page,
  data: { lang: string; width: number; theme?: string; grid?: string },
): Promise<void> => {
  await page.setViewportSize({ width: data.width, height: 900 });
  const query: URLSearchParams = new URLSearchParams({
    theme: data.theme || "Light",
  });

  if (data.lang !== "en") {
    query.set("lang", data.lang);
  }

  if (data.grid) {
    query.set("grid", data.grid);
  }

  await page.goto(`${PAGE}?${query.toString()}`);
  await expect(page.getByTestId("status-page-overview")).toBeVisible();
  // The page's words are fetched once it reads its default language.
  await expect(page.locator("#overview-alert")).toContainText(
    bannerWords(data.lang),
  );
  await expect(page.getByTestId("status-page-grid")).toBeVisible();
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
};

/*
 * The grid as laid out, read in one frame: whether it is a stack, how far
 * its box scrolls, and where each row's value, each cell and each cell's
 * column name are.
 */
interface CellLayout {
  label: string;
  labelShown: boolean;
  // The label's and the status's distance from the tile's start and end.
  labelFromStart: number;
  statusFromEnd: number | null;
  // The same, from the grid box's start and end: what a reader sees.
  labelFromBoxStart: number;
  statusFromBoxEnd: number | null;
  // The tile itself: where it starts in the box, how wide, and its rule.
  fromBoxStart: number;
  width: number;
  startRule: string;
  top: number;
}

interface RowLayout {
  heading: string;
  headingBottom: number;
  // Where the row's value starts, from the grid box's start.
  headingTextFromBoxStart: number;
  cells: Array<CellLayout>;
}

interface GridLayout {
  direction: string;
  isStack: boolean;
  headShown: boolean;
  scrollerWidth: number;
  sideways: number;
  rows: Array<RowLayout>;
}

const gridLayoutOf: (page: Page) => Promise<GridLayout> = async (
  page: Page,
): Promise<GridLayout> => {
  return page
    .getByTestId("status-page-grid")
    .evaluate((grid: Element): GridLayout => {
      const table: HTMLTableElement = grid.querySelector("table")!;
      const scroller: HTMLElement = table.parentElement!;
      const direction: string = getComputedStyle(grid).direction;
      const isRightToLeft: boolean = direction === "rtl";

      const fromStart: (inner: DOMRect, outer: DOMRect) => number = (
        inner: DOMRect,
        outer: DOMRect,
      ): number => {
        return isRightToLeft
          ? outer.right - inner.right
          : inner.left - outer.left;
      };

      const fromEnd: (inner: DOMRect, outer: DOMRect) => number = (
        inner: DOMRect,
        outer: DOMRect,
      ): number => {
        return isRightToLeft
          ? inner.left - outer.left
          : outer.right - inner.right;
      };

      const box: DOMRect = scroller.getBoundingClientRect();

      const rows: Array<RowLayout> = Array.from(
        table.querySelectorAll("tbody > tr"),
      ).map((row: Element): RowLayout => {
        const heading: HTMLElement = row.querySelector("th")!;
        // The row's value, as drawn (IsolatedText's bdi).
        const headingText: Element = heading.firstElementChild || heading;

        return {
          heading: (heading.textContent || "").trim(),
          headingBottom: heading.getBoundingClientRect().bottom,
          headingTextFromBoxStart: fromStart(
            headingText.getBoundingClientRect(),
            box,
          ),
          cells: Array.from(row.querySelectorAll("td")).map(
            (cell: Element): CellLayout => {
              const cellBox: DOMRect = cell.getBoundingClientRect();
              const label: HTMLElement = cell.querySelector(
                "[data-testid='status-page-grid-cell-label']",
              )!;
              const status: HTMLElement | null = cell.querySelector(
                "[data-testid='status-page-grid-cell-status']",
              );

              return {
                label: (label.textContent || "").trim(),
                labelShown: label.getClientRects().length > 0,
                labelFromStart: fromStart(
                  label.getBoundingClientRect(),
                  cellBox,
                ),
                statusFromEnd: status
                  ? fromEnd(status.getBoundingClientRect(), cellBox)
                  : null,
                labelFromBoxStart: fromStart(
                  label.getBoundingClientRect(),
                  box,
                ),
                statusFromBoxEnd: status
                  ? fromEnd(status.getBoundingClientRect(), box)
                  : null,
                fromBoxStart: fromStart(cellBox, box),
                width: cellBox.width,
                startRule: getComputedStyle(cell).getPropertyValue(
                  "border-inline-start-width",
                ),
                top: cellBox.top,
              };
            },
          ),
        };
      });

      return {
        direction: direction,
        isStack: getComputedStyle(table).display === "block",
        headShown:
          getComputedStyle(table.querySelector("thead")!).display !== "none",
        scrollerWidth: scroller.clientWidth,
        sideways: scroller.scrollWidth - scroller.clientWidth,
        rows: rows,
      };
    });
};

const shoot: (page: Page, name: string) => Promise<void> = async (
  page: Page,
  name: string,
): Promise<void> => {
  await page
    .getByTestId("status-page-grid")
    .screenshot({ path: `${SCREENSHOTS}/grid-${name}.png` });
};

// Each test sets its own window; the phone project would run them twice.
test.skip(({ isMobile }: { isMobile: boolean }): boolean => {
  return isMobile;
}, "Each test sets its own window.");

test.afterEach(async ({ page }: { page: Page }) => {
  const unexpected: Array<string> = await page
    .evaluate((): Array<string> => {
      return (
        (
          window as unknown as {
            __statusPageThemeFixture?: { unexpected: Array<string> };
          }
        ).__statusPageThemeFixture?.unexpected || []
      );
    })
    .catch((): Array<string> => {
      return [];
    });

  expect(unexpected).toEqual([]);
});

test.describe("the public status page's resource grid (#7238)", () => {
  for (const language of LANGUAGES) {
    test(`${language.lang}, a 390px phone: a stack, each cell a tile naming its column, one to a line, and nothing scrolls sideways`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openPage(page, { lang: language.lang, width: 390 });

      // Laid out once Tailwind has written the grid's classes.
      await expect
        .poll(async (): Promise<boolean> => {
          return (await gridLayoutOf(page)).isStack;
        })
        .toBe(true);

      const layout: GridLayout = await gridLayoutOf(page);

      expect(layout.direction).toBe(language.dir);
      expect(layout.headShown).toBe(false);
      expect(layout.sideways).toBe(0);
      expect(
        layout.rows.map((row: RowLayout): string => {
          return row.heading;
        }),
      ).toEqual(ROWS);

      for (const row of layout.rows) {
        expect(
          row.cells.map((cell: CellLayout): string => {
            return cell.label;
          }),
        ).toEqual(COLUMNS);

        // The row's value starts where its cells' names do.
        expect(Math.abs(row.headingTextFromBoxStart - 16)).toBeLessThanOrEqual(
          0.5,
        );

        let lineTop: number = row.headingBottom - 1;

        for (const cell of row.cells) {
          // Under its row's value, one tile to a line, each under the last.
          expect(cell.labelShown).toBe(true);
          expect(cell.top).toBeGreaterThan(lineTop);
          lineTop = cell.top;
          /*
           * As wide as the box, and one pixel more at its start: its start
           * rule, which divides it from a tile beside it, is beyond the
           * box's edge, so the card's own edge is not drawn twice.
           */
          expect(Math.abs(cell.fromBoxStart + 1)).toBeLessThanOrEqual(0.5);
          expect(
            Math.abs(cell.width - (layout.scrollerWidth + 1)),
          ).toBeLessThanOrEqual(0.5);
          expect(cell.startRule).toBe("1px");
          // Its column's name at the line's start, its status at its end.
          expect(Math.abs(cell.labelFromBoxStart - 16)).toBeLessThanOrEqual(
            0.5,
          );

          if (cell.statusFromBoxEnd !== null) {
            expect(Math.abs(cell.statusFromBoxEnd - 16)).toBeLessThanOrEqual(1);
          }
        }
      }

      await expectNoSidewaysScroll(page);
      await shoot(page, `${language.lang}-390-light`);
    });

    for (const width of [768, 1280]) {
      test(`${language.lang}, ${width}px: the matrix it has room for, with its column headings, and nothing scrolls sideways`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await openPage(page, { lang: language.lang, width: width });

        await expect
          .poll(async (): Promise<boolean> => {
            return (await gridLayoutOf(page)).headShown;
          })
          .toBe(true);

        const layout: GridLayout = await gridLayoutOf(page);

        expect(layout.direction).toBe(language.dir);
        expect(layout.isStack).toBe(false);
        // Room for its matrix: 10rem and 8.75rem a column.
        expect(layout.scrollerWidth).toBeGreaterThan(580);
        expect(layout.sideways).toBe(0);

        for (const row of layout.rows) {
          for (const cell of row.cells) {
            // The column heading names it; the cell does not.
            expect(cell.labelShown).toBe(false);
          }
        }

        for (const column of COLUMNS) {
          await expect(
            page
              .getByTestId("status-page-grid")
              .getByRole("columnheader", { name: column, exact: true }),
          ).toBeVisible();
        }

        await expectNoSidewaysScroll(page);

        if (width === 1280 && language.lang !== "fa") {
          await shoot(page, `${language.lang}-1280-light`);
        }
      });
    }

    /*
     * A matrix whose words are wider than its least width still scrolls in
     * its card. Its columns are widened here to 20rem (a long status name
     * or value would do the same), so the 934px a laptop leaves it holds
     * 1120px of matrix.
     */
    test(`${language.lang}: a matrix wider than its box keeps each row's value in view at the start of the line, however far it scrolls`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openPage(page, { lang: language.lang, width: 1280 });
      await page.addStyleTag({
        content:
          "[data-testid='status-page-grid'] thead tr:last-child th:not(:first-child) { min-width: 20rem; }",
      });

      await expect
        .poll(async (): Promise<number> => {
          return (await gridLayoutOf(page)).sideways;
        })
        .toBeGreaterThan(100);

      interface HeadingPlace {
        // How much of each row's value, and of the rows' axis name, is in the box.
        shown: Array<number>;
        widths: Array<number>;
        // Its distance from the box's start.
        fromStart: Array<number>;
        // Which side its rule is on, and how it is aligned.
        borderLeft: string;
        borderRight: string;
        textAlign: string;
        scrolled: number;
        // Whether each one's ground is solid, so nothing shows through it.
        opaque: Array<boolean>;
      }

      const placeOfHeadings: (toEnd: boolean) => Promise<HeadingPlace> = async (
        toEnd: boolean,
      ): Promise<HeadingPlace> => {
        return page
          .getByTestId("status-page-grid")
          .evaluate(
            async (grid: Element, toTheEnd: boolean): Promise<HeadingPlace> => {
              const table: HTMLTableElement = grid.querySelector("table")!;
              const scroller: HTMLElement = table.parentElement!;
              const isRightToLeft: boolean =
                getComputedStyle(scroller).direction === "rtl";
              const reach: number = scroller.scrollWidth - scroller.clientWidth;

              // The end of the line: the right in English, the left in Arabic.
              scroller.scrollLeft = toTheEnd
                ? isRightToLeft
                  ? -reach
                  : reach
                : 0;

              await new Promise<void>((resolve: () => void): void => {
                requestAnimationFrame((): void => {
                  resolve();
                });
              });

              const box: DOMRect = scroller.getBoundingClientRect();
              const headings: Array<HTMLElement> = [
                table.querySelector("thead tr:last-child th") as HTMLElement,
                ...(Array.from(
                  table.querySelectorAll("tbody th"),
                ) as Array<HTMLElement>),
              ];
              const firstRowValue: CSSStyleDeclaration = getComputedStyle(
                headings[1]!,
              );

              return {
                shown: headings.map((heading: HTMLElement): number => {
                  const rect: DOMRect = heading.getBoundingClientRect();

                  return Math.max(
                    0,
                    Math.min(rect.right, box.right) -
                      Math.max(rect.left, box.left),
                  );
                }),
                widths: headings.map((heading: HTMLElement): number => {
                  return heading.getBoundingClientRect().width;
                }),
                fromStart: headings.map((heading: HTMLElement): number => {
                  const rect: DOMRect = heading.getBoundingClientRect();

                  return isRightToLeft
                    ? box.right - rect.right
                    : rect.left - box.left;
                }),
                borderLeft: firstRowValue.borderLeftWidth,
                borderRight: firstRowValue.borderRightWidth,
                textAlign: firstRowValue.textAlign,
                scrolled: Math.abs(scroller.scrollLeft),
                opaque: headings.map((heading: HTMLElement): boolean => {
                  const ground: string =
                    getComputedStyle(heading).backgroundColor;
                  const parts: Array<string> = ground
                    .slice(ground.indexOf("(") + 1, ground.lastIndexOf(")"))
                    .split(",");

                  return (
                    ground.startsWith("rgb") &&
                    (parts.length === 3 || Number(parts[3]) === 1)
                  );
                }),
              };
            },
            toEnd,
          );
      };

      for (const toEnd of [false, true]) {
        const place: HeadingPlace = await placeOfHeadings(toEnd);

        if (toEnd) {
          expect(place.scrolled).toBeGreaterThan(100);
        }

        place.shown.forEach((shown: number, index: number) => {
          // Whole, and at the start of the box.
          expect(Math.abs(shown - place.widths[index]!)).toBeLessThanOrEqual(1);
          expect(Math.abs(place.fromStart[index]!)).toBeLessThanOrEqual(1);
        });

        // Ruled off on the side its cells are on, and read from the line's start.
        expect(
          language.dir === "rtl"
            ? [place.borderLeft, place.borderRight]
            : [place.borderRight, place.borderLeft],
        ).toEqual(["1px", "0px"]);
        expect(place.textAlign).toBe("start");
        // Nothing scrolled under them shows through.
        expect(place.opaque).toEqual(
          place.shown.map((): boolean => {
            return true;
          }),
        );
      }

      if (language.lang !== "fa") {
        await shoot(page, `${language.lang}-1280-scrolled-to-end`);
      }
    });
  }

  /*
   * Six regions need 1,000px of matrix, more than the 934px the page's
   * widest column leaves a grid: a stack on every screen. Its tiles share
   * a line - as many as the box has room for, 16rem each - so a laptop
   * reads two lines of three under each row's value, not six lines with
   * each status 700px from its name.
   */
  const WIDE_CASES: Array<{
    lang: string;
    width: number;
    tilesPerLine: number;
  }> = [
    { lang: "en", width: 1280, tilesPerLine: 3 },
    { lang: "ar", width: 1280, tilesPerLine: 3 },
    { lang: "fa", width: 1280, tilesPerLine: 3 },
    { lang: "en", width: 768, tilesPerLine: 2 },
    { lang: "ar", width: 768, tilesPerLine: 2 },
  ];

  for (const wide of WIDE_CASES) {
    test(`${wide.lang}, ${wide.width}px, six columns no matrix fits: a stack of tiles, ${wide.tilesPerLine} to a line from the line's start, each ruled off from the one before it, and nothing scrolls sideways`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openPage(page, {
        lang: wide.lang,
        width: wide.width,
        grid: "wide",
      });

      await expect
        .poll(async (): Promise<boolean> => {
          return (await gridLayoutOf(page)).isStack;
        })
        .toBe(true);

      const layout: GridLayout = await gridLayoutOf(page);
      const tiles: number = wide.tilesPerLine;
      // Equal tiles across the box and the pixel before it (its first rule).
      const tileWidth: number = (layout.scrollerWidth + 1) / tiles;

      expect(layout.direction).toBe(wide.lang === "en" ? "ltr" : "rtl");
      expect(layout.headShown).toBe(false);
      expect(layout.sideways).toBe(0);
      // Room for this many tiles of 16rem, and not for one more.
      expect(layout.scrollerWidth + 1).toBeGreaterThanOrEqual(tiles * 256);
      expect(layout.scrollerWidth + 1).toBeLessThan((tiles + 1) * 256);
      expect(
        layout.rows.map((row: RowLayout): string => {
          return row.heading;
        }),
      ).toEqual(ROWS);

      for (const row of layout.rows) {
        expect(
          row.cells.map((cell: CellLayout): string => {
            return cell.label;
          }),
        ).toEqual(WIDE_COLUMNS);
        // The row's value starts where the first tile's name does.
        expect(Math.abs(row.headingTextFromBoxStart - 16)).toBeLessThanOrEqual(
          0.5,
        );
        expect(row.cells[0]!.top).toBeGreaterThanOrEqual(row.headingBottom - 1);

        row.cells.forEach((cell: CellLayout, index: number) => {
          const place: number = index % tiles;
          const lineStart: CellLayout = row.cells[index - place]!;

          // Its line's tiles side by side, in order from the line's start.
          expect(cell.labelShown).toBe(true);
          expect(Math.abs(cell.top - lineStart.top)).toBeLessThanOrEqual(0.5);
          expect(
            Math.abs(cell.fromBoxStart - (place * tileWidth - 1)),
          ).toBeLessThanOrEqual(1);
          expect(Math.abs(cell.width - tileWidth)).toBeLessThanOrEqual(1);

          if (index >= tiles) {
            // A line under the line before it.
            expect(cell.top).toBeGreaterThan(row.cells[index - tiles]!.top);
          }

          // Ruled off from the tile before it; the first's rule is clipped.
          expect(cell.startRule).toBe("1px");
          // Its column's name at the tile's start, its status at its end.
          expect(Math.abs(cell.labelFromStart - 17)).toBeLessThanOrEqual(0.5);

          if (cell.statusFromEnd !== null) {
            expect(Math.abs(cell.statusFromEnd - 16)).toBeLessThanOrEqual(1);
          }
        });
      }

      await expectNoSidewaysScroll(page);

      if (wide.lang !== "fa") {
        await shoot(page, `wide-${wide.lang}-${wide.width}-light`);
      }
    });
  }

  for (const lang of ["en", "ar"]) {
    for (const width of [390, 1280]) {
      test(`${lang}, ${width}px, the dark theme: the grid is drawn on the dark card, with nothing white in it`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await page.emulateMedia({ colorScheme: "dark" });
        await openPage(page, { lang: lang, width: width, theme: "Dark" });

        await expect
          .poll(async (): Promise<boolean> => {
            return (await gridLayoutOf(page)).isStack;
          })
          .toBe(width === 390);

        const whiteBoxes: Array<string> = await page
          .getByTestId("status-page-grid")
          .evaluate((grid: Element): Array<string> => {
            return [grid, ...Array.from(grid.querySelectorAll("*"))]
              .filter((element: Element): boolean => {
                return (
                  getComputedStyle(element).backgroundColor ===
                  "rgb(255, 255, 255)"
                );
              })
              .map((element: Element): string => {
                return `${element.tagName} ${(element.textContent || "").trim().slice(0, 20)}`;
              });
          });

        expect(whiteBoxes).toEqual([]);
        await expectNoSidewaysScroll(page);
        await shoot(page, `${lang}-${width}-dark`);
      });
    }
  }
});
