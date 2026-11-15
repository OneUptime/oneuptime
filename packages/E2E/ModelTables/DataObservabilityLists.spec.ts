import { expect, Locator, Page, test } from "@playwright/test";
import { readFileSync } from "fs";
import fs from "fs/promises";
import path from "path";

/*
 * DATA OBSERVABILITY'S CHECKS AND RECONCILIATIONS LISTS, MEASURED IN
 * CHROMIUM AT 1280PX AND 1100PX (#7534, #8345).
 *
 * At 1280px beside the side menu the Checks list (in German) and the
 * Reconciliations list (in English and German) ran past their card, under
 * the sticky Run Now column: "Ungewöhnlich niedrig" read "Ungewöhnlich",
 * the Status badges "In Ste..." and "Drifte...". #8339 marked columns
 * foldable, so the shared table folds them when its rows do not fit
 * (Common/UI/Components/Table/TableFit): a check's Alert under its Status,
 * a reconciliation's Target under its Source and its Difference under its
 * Status, each named. Common/Tests/App/Dashboard/DataObservabilityListsAt1280
 * tests that in jsdom, with widths handed out; this suite measures what
 * Chromium draws: the real pages in the real Data Observability layout (its
 * side menu and breadcrumbs), in Inter, through the offline fixture.
 *
 * Measured here, the German Checks list at 1100px still ran 11px past its
 * card (769px in a 758px card), its folded alerts under the sticky column:
 * a folded value's name and its first word were one unbreakable word
 * ("WarnungUngewöhnlich"), and every row's button said "Jetzt ausführen".
 * The line breaks after the name now (TableFoldedValues), and the row's
 * button says the verb (rowButtonTitle "Run": "Ausführen").
 *
 * For each list, at 1280px and 1100px, in English and German:
 *
 *   - the list never scrolls sideways (its box's scrollWidth fits its
 *     clientWidth) and says so (data-overflowing="false");
 *   - drawn as rows, no cell - and nothing in one - runs under the sticky
 *     Run Now column; drawn as cards (a card narrower than 48rem whose rows
 *     do not fit, TableFit), every card is inside the list's box;
 *   - every Status badge, every alert and every difference is whole:
 *     nothing in it is cut short (scrollWidth <= clientWidth);
 *   - a folded column is named over its value, under the column it folds
 *     into.
 *
 * Screenshots: output/playwright/model-tables-ui/data-observability-*.
 */

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const CHECKS: string = `/dashboard/${PROJECT}/data-observability/checks`;
const RECONCILIATIONS: string = `/dashboard/${PROJECT}/data-observability/reconciliations`;
const CHECKS_TABLE: string = "data-observability-checks";
const RECONCILIATIONS_TABLE: string = "data-observability-reconciliations";

const NOW: Date = new Date("2026-10-16T05:35:00.000Z");

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/model-tables-ui",
);

// The Dashboard's words, as its locale files word them.
const LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Dashboard/src/Locales",
);

const KEYS: Array<string> = [
  "Alert",
  "Status",
  "Source",
  "Target",
  "Difference",
  "Unusually High",
  "Unusually Low",
  "No alert",
  "In Step",
  "Drifted",
  "Failed",
  "Run",
  "Run Now",
];

function wordsOf(language: string): Record<string, string> {
  const locale: Record<string, string> = JSON.parse(
    readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
  const words: Record<string, string> = {};

  for (const key of KEYS) {
    words[key] = language !== "en" && locale[key] ? locale[key]! : key;
  }

  return words;
}

const WORDS: Record<string, Record<string, string>> = {
  en: wordsOf("en"),
  de: wordsOf("de"),
};

const WIDTHS: Array<number> = [1280, 1100];
const LANGUAGES: Array<string> = ["en", "de"];

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
  page.on("console", (message: { type: () => string; text: () => string }) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
  // Every read the pages made is one the fixture answers as the API does.
  expect(
    await page.evaluate((): Array<string> => {
      return (window as unknown as { __fixture: { unmodelled: Array<string> } })
        .__fixture.unmodelled;
    }),
  ).toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

/*
 * The fixture's Tailwind is written in the page as elements appear, so an
 * element whose classes carry a transition animates into its styles on
 * first paint: boxes are read once every finite animation has run.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
    await new Promise((resolve: (value: unknown) => void) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
    await Promise.all(
      document
        .getAnimations()
        .filter((animation: Animation): boolean => {
          return animation.effect?.getTiming().iterations !== Infinity;
        })
        .map((animation: Animation): Promise<unknown> => {
          return animation.finished.catch(() => {
            return undefined;
          });
        }),
    );
  });
}

async function open(
  page: Page,
  address: string,
  data: { width: number; language: string; rows: number; tableId: string },
): Promise<void> {
  await page.setViewportSize({ width: data.width, height: 900 });
  await page.goto(
    data.language === "en" ? address : `${address}?lang=${data.language}`,
  );
  await expect(page.getByTestId("table-skeleton-loader")).toHaveCount(0);
  // Its rows: a table's, or a narrow card's cards.
  await expect(page.locator(`#${data.tableId}-body > *`)).toHaveCount(
    data.rows,
  );
  await settle(page);
}

interface WholeValue {
  text: string;
  isWhole: boolean;
}

interface FoldedValue extends WholeValue {
  title: string;
}

interface ListReading {
  isCards: boolean;
  overflowing: string | null;
  scrollWidth: number;
  clientWidth: number;
  headers: Array<string>;
  // What reaches past the sticky column's start edge: a cell, or something in one.
  underTheStickyColumn: Array<string>;
  // Rows drawn with a sticky column.
  stickyRows: number;
  // Cards that reach past the list's box.
  cardsPastTheBox: Array<string>;
  badges: Array<WholeValue>;
  folded: Array<FoldedValue>;
  // The values of a column, by its header's name.
  columnValues: Record<string, Array<WholeValue>>;
}

/*
 * What the list draws, read in the page: its box, its header's names,
 * anything drawn past the sticky column's start edge, and every badge,
 * folded value and value of the named columns, whole or cut short.
 */
async function readList(
  page: Page,
  tableId: string,
  columns: Array<string> = [],
): Promise<ListReading> {
  return await page.evaluate(
    (args: { tableId: string; columns: Array<string> }): ListReading => {
      const body: HTMLElement = document.getElementById(
        `${args.tableId}-body`,
      ) as HTMLElement;
      const scrollBox: HTMLElement = body.closest(
        "[data-testid='table-scroll']",
      ) as HTMLElement;
      const table: HTMLTableElement | null = body.closest("table");

      // Whether an element and everything in it is drawn whole: nothing cut short.
      const isWhole: (element: Element) => boolean = (
        element: Element,
      ): boolean => {
        return [element, ...Array.from(element.querySelectorAll("*"))].every(
          (part: Element): boolean => {
            const html: HTMLElement = part as HTMLElement;

            return (
              html.clientWidth === 0 || html.scrollWidth <= html.clientWidth + 1
            );
          },
        );
      };

      const textOf: (element: Element) => string = (
        element: Element,
      ): string => {
        return (element.textContent || "")
          .replace(/[⁦-⁩]/g, "")
          .replace(/\s+/g, " ")
          .trim();
      };

      const headers: Array<string> = table
        ? Array.from(table.querySelectorAll("thead th")).map(textOf)
        : [];

      const underTheStickyColumn: Array<string> = [];
      let stickyRows: number = 0;

      for (const row of Array.from(body.querySelectorAll(":scope > tr"))) {
        const cells: Array<HTMLElement> = Array.from(
          row.querySelectorAll<HTMLElement>(":scope > td"),
        );
        const sticky: HTMLElement | undefined = cells.find(
          (cell: HTMLElement): boolean => {
            return getComputedStyle(cell).position === "sticky";
          },
        );

        if (!sticky) {
          continue;
        }

        stickyRows++;

        const stickyStart: number = sticky.getBoundingClientRect().left;

        for (const cell of cells) {
          if (cell === sticky) {
            continue;
          }

          for (const part of [
            cell,
            ...Array.from(cell.querySelectorAll("*")),
          ]) {
            const box: DOMRect = part.getBoundingClientRect();

            if (box.width > 0 && box.right > stickyStart + 0.5) {
              underTheStickyColumn.push(
                `${textOf(row).slice(0, 30)} | ${textOf(part).slice(0, 30)} (${Math.round(box.right - stickyStart)}px)`,
              );
              break;
            }
          }
        }
      }

      const boxRight: number = scrollBox.getBoundingClientRect().right;
      const cardsPastTheBox: Array<string> = table
        ? []
        : Array.from(body.children)
            .filter((card: Element): boolean => {
              return card.getBoundingClientRect().right > boxRight + 0.5;
            })
            .map(textOf);

      const badges: Array<WholeValue> = Array.from(
        body.querySelectorAll("[data-testid='pill']"),
      ).map((badge: Element): WholeValue => {
        return { text: textOf(badge), isWhole: isWhole(badge) };
      });

      const folded: Array<FoldedValue> = Array.from(
        body.querySelectorAll("[data-testid='table-folded-value']"),
      ).map((line: Element): FoldedValue => {
        const titleElement: Element | null = line.querySelector(
          "[data-testid='table-folded-title']",
        );
        const title: string = titleElement ? textOf(titleElement) : "";
        const value: Element = line.lastElementChild || line;

        return { title: title, text: textOf(value), isWhole: isWhole(value) };
      });

      const columnValues: Record<string, Array<WholeValue>> = {};

      for (const column of args.columns) {
        const index: number = headers.indexOf(column);

        if (index < 0) {
          continue;
        }

        columnValues[column] = Array.from(
          body.querySelectorAll(":scope > tr"),
        ).map((row: Element): WholeValue => {
          const cell: Element = row.querySelectorAll(":scope > td")[
            index
          ] as Element;

          return { text: textOf(cell), isWhole: isWhole(cell) };
        });
      }

      return {
        isCards: !table,
        overflowing: scrollBox.getAttribute("data-overflowing"),
        scrollWidth: scrollBox.scrollWidth,
        clientWidth: scrollBox.clientWidth,
        headers: headers,
        underTheStickyColumn: underTheStickyColumn,
        stickyRows: stickyRows,
        cardsPastTheBox: cardsPastTheBox,
        badges: badges,
        folded: folded,
        columnValues: columnValues,
      };
    },
    { tableId: tableId, columns: columns },
  );
}

function expectTheListFits(
  reading: ListReading,
  label: string,
  rows: number,
): void {
  // The list scrolls nothing sideways, and says so.
  expect({ label, scrolls: reading.scrollWidth > reading.clientWidth }).toEqual(
    { label, scrolls: false },
  );
  expect({ label, overflowing: reading.overflowing }).toEqual({
    label,
    overflowing: "false",
  });

  if (reading.isCards) {
    // Each row a card, inside the list's box.
    expect({ label, past: reading.cardsPastTheBox }).toEqual({
      label,
      past: [],
    });
  } else {
    // Every row has its sticky Run Now column, and nothing runs under it.
    expect({ label, stickyRows: reading.stickyRows }).toEqual({
      label,
      stickyRows: rows,
    });
    expect({ label, under: reading.underTheStickyColumn }).toEqual({
      label,
      under: [],
    });
  }

  // Every badge is whole.
  expect(reading.badges.length).toBeGreaterThan(0);

  for (const badge of reading.badges) {
    expect({ label, badge: badge.text, isWhole: badge.isWhole }).toEqual({
      label,
      badge: badge.text,
      isWhole: true,
    });
  }
}

// The row's button: the verb, named by its whole title.
async function expectRunOnEveryRowInsideTheCard(
  page: Page,
  tableId: string,
  language: string,
  rows: number,
): Promise<void> {
  const words: Record<string, string> = WORDS[language]!;
  const card: { x: number; width: number } | null = await page
    .getByTestId("card")
    .first()
    .boundingBox();
  const buttons: Array<Locator> = await page
    .locator(`#${tableId}-body`)
    .getByRole("button", { name: words["Run Now"]!, exact: true })
    .all();

  expect(buttons).toHaveLength(rows);

  for (const button of buttons) {
    await expect(button).toHaveText(words["Run"]!);

    const box: { x: number; width: number } | null = await button.boundingBox();

    expect(box!.x + box!.width).toBeLessThanOrEqual(card!.x + card!.width);
  }
}

test.describe("Data Observability's Checks list", () => {
  for (const width of WIDTHS) {
    for (const language of LANGUAGES) {
      test(`at ${width}px in ${language}: fits its card, nothing under Run Now, every alert and badge whole`, async ({
        page,
      }: {
        page: Page;
      }) => {
        const words: Record<string, string> = WORDS[language]!;

        await open(page, CHECKS, {
          width: width,
          language: language,
          rows: 4,
          tableId: CHECKS_TABLE,
        });

        const reading: ListReading = await readList(page, CHECKS_TABLE, [
          words["Alert"]!,
        ]);

        expectTheListFits(reading, `checks ${language} ${width}`, 4);

        // Each check's alert, whole: in its column, or folded under its Status, named.
        const alerts: Array<WholeValue> = reading.headers.includes(
          words["Alert"]!,
        )
          ? reading.columnValues[words["Alert"]!]!
          : reading.folded.filter((value: FoldedValue): boolean => {
              return value.title === words["Alert"];
            });

        expect(
          alerts.map((value: WholeValue): string => {
            return value.text;
          }),
        ).toEqual([
          words["Unusually High"],
          words["Unusually Low"],
          words["No alert"],
          words["Unusually High"],
        ]);

        for (const alert of alerts) {
          expect({ alert: alert.text, isWhole: alert.isWhole }).toEqual({
            alert: alert.text,
            isWhole: true,
          });
        }

        await expectRunOnEveryRowInsideTheCard(page, CHECKS_TABLE, language, 4);
        await screenshot(
          page,
          `data-observability-checks-${language}-${width}`,
        );
      });
    }
  }

  test("at 1280px in German, the Alert column folds under each check's Status, named, its words whole", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CHECKS, {
      width: 1280,
      language: "de",
      rows: 4,
      tableId: CHECKS_TABLE,
    });

    const reading: ListReading = await readList(page, CHECKS_TABLE);

    expect(WORDS["de"]!["Alert"]).toBe("Warnung");
    expect(reading.isCards).toBe(false);
    expect(reading.headers).not.toContain("Warnung");
    expect(
      reading.folded.map((value: FoldedValue): string => {
        return value.title;
      }),
    ).toEqual(["Warnung", "Warnung", "Warnung", "Warnung"]);
    // The words the issue saw cut short, whole.
    expect(
      reading.folded.find((value: FoldedValue): boolean => {
        return value.text === "Ungewöhnlich niedrig";
      })?.isWhole,
    ).toBe(true);
  });

  test("at 1280px in English, the list has the room: every column is drawn, nothing folded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CHECKS, {
      width: 1280,
      language: "en",
      rows: 4,
      tableId: CHECKS_TABLE,
    });

    const reading: ListReading = await readList(page, CHECKS_TABLE);

    expect(reading.headers).toEqual(
      expect.arrayContaining(["Name", "Last Value", "Status", "Alert"]),
    );
    expect(reading.folded).toEqual([]);
  });

  /*
   * The bug this suite found: a folded value's name and its first word were
   * one word ("WarnungUngewöhnlich"), so the line could not break between
   * them, and held the Status column wider than any of its words.
   */
  test("at 1100px in German, a folded alert breaks after its column's name rather than widen the Status column", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CHECKS, {
      width: 1100,
      language: "de",
      rows: 4,
      tableId: CHECKS_TABLE,
    });

    const lines: Array<{ title: number; value: number; fits: boolean }> =
      await page.evaluate((tableId: string) => {
        return Array.from(
          document.querySelectorAll(
            `#${tableId}-body [data-testid='table-folded-value']`,
          ),
        )
          .filter((line: Element): boolean => {
            return (line.textContent || "").includes("Ungewöhnlich");
          })
          .map((line: Element) => {
            const title: Element = line.querySelector(
              "[data-testid='table-folded-title']",
            ) as Element;
            const value: Element = line.lastElementChild as Element;
            const lineBox: DOMRect = line.getBoundingClientRect();
            const valueRects: Array<DOMRect> = Array.from(
              value.getClientRects(),
            );

            return {
              title: Math.round(title.getBoundingClientRect().top),
              value: Math.round(valueRects[0]!.top),
              fits: valueRects.every((rect: DOMRect): boolean => {
                return rect.right <= lineBox.right + 0.5;
              }),
            };
          });
      }, CHECKS_TABLE);

    expect(lines.length).toBe(3);

    for (const line of lines) {
      // Its words inside its line, on a line of their own under the name.
      expect(line.fits).toBe(true);
      expect(line.value).toBeGreaterThan(line.title);
    }
  });
});

test.describe("Data Observability's Reconciliations list", () => {
  for (const width of WIDTHS) {
    for (const language of LANGUAGES) {
      test(`at ${width}px in ${language}: fits its card, nothing under Run Now, every Status badge and difference whole`, async ({
        page,
      }: {
        page: Page;
      }) => {
        const words: Record<string, string> = WORDS[language]!;

        await open(page, RECONCILIATIONS, {
          width: width,
          language: language,
          rows: 3,
          tableId: RECONCILIATIONS_TABLE,
        });

        const reading: ListReading = await readList(
          page,
          RECONCILIATIONS_TABLE,
        );

        expectTheListFits(reading, `reconciliations ${language} ${width}`, 3);

        expect(
          reading.badges
            .map((badge: WholeValue): string => {
              return badge.text;
            })
            .sort(),
        ).toEqual([words["Drifted"], words["Failed"], words["In Step"]].sort());

        // A folded Target or Difference is named over its value; a difference is whole.
        for (const value of reading.folded) {
          expect([words["Target"], words["Difference"]]).toContain(value.title);

          if (value.title === words["Difference"]) {
            expect({ value: value.text, isWhole: value.isWhole }).toEqual({
              value: value.text,
              isWhole: true,
            });
          }
        }

        await expectRunOnEveryRowInsideTheCard(
          page,
          RECONCILIATIONS_TABLE,
          language,
          3,
        );
        await screenshot(
          page,
          `data-observability-reconciliations-${language}-${width}`,
        );
      });
    }
  }

  test("at 1280px, in English and German, Target folds under Source and Difference under Status, each named", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const language of LANGUAGES) {
      const words: Record<string, string> = WORDS[language]!;

      await open(page, RECONCILIATIONS, {
        width: 1280,
        language: language,
        rows: 3,
        tableId: RECONCILIATIONS_TABLE,
      });

      const reading: ListReading = await readList(page, RECONCILIATIONS_TABLE);

      expect({ language, isCards: reading.isCards }).toEqual({
        language,
        isCards: false,
      });
      expect(reading.headers).not.toContain(words["Target"]);
      expect(reading.headers).not.toContain(words["Difference"]);
      expect(
        reading.folded
          .filter((value: FoldedValue): boolean => {
            return value.title === words["Target"];
          })
          .map((value: FoldedValue): string => {
            return value.text;
          }),
      ).toEqual([
        expect.stringMatching(/^analytics_prod\.marts/),
        expect.stringMatching(/^analytics_prod\.marts/),
        expect.stringMatching(/^analytics_prod\.marts/),
      ]);
      // Two compared: their differences; the third could not be.
      expect(
        reading.folded.filter((value: FoldedValue): boolean => {
          return value.title === words["Difference"];
        }),
      ).toHaveLength(2);
    }
  });

  test("a side's error wraps under its badge rather than widen the Status column", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RECONCILIATIONS, {
      width: 1280,
      language: "en",
      rows: 3,
      tableId: RECONCILIATIONS_TABLE,
    });

    const message: Locator = page
      .locator(`#${RECONCILIATIONS_TABLE}-body`)
      .getByText(/amount_cents/);
    const lines: number = await message.evaluate((element: Element): number => {
      const range: Range = document.createRange();
      range.selectNodeContents(element);
      return new Set(
        Array.from(range.getClientRects())
          .filter((rect: DOMRect): boolean => {
            return rect.width > 0;
          })
          .map((rect: DOMRect): number => {
            return Math.round(rect.top);
          }),
      ).size;
    });

    expect(lines).toBeGreaterThan(1);
  });
});
