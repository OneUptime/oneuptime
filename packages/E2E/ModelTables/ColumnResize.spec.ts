import {
  Browser,
  BrowserContext,
  CDPSession,
  expect,
  Locator,
  Page,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * "I'm not able to resize columns, so I'm not able to drag and increase the
 * width of the columns or decrease the width of the columns. Can you please
 * implement that functionality as well? Please make the UI look great and
 * natural for people to understand. Please do this for all tables." - the
 * maintainer.
 *
 * Every table's columns can now be sized (Common/UI/Components/Table/
 * ColumnResize). jsdom lays nothing out, so what only a browser can show is
 * measured here, against the offline fixture (ModelTables/Fixture): the
 * real Incidents list, a list of 200 rows, and a table a page draws itself
 * (a monitor's network interfaces, ?table=handbuilt):
 *
 *   - an edge on each column's header, quiet until the pointer is over the
 *     header row, indigo under the pointer, with the resize cursor;
 *   - a drag makes the column wider or narrower, its values following, and
 *     the width is there on the next visit; never narrower than its header's
 *     words, or a date;
 *   - a double-click fits the column to its widest value; the keyboard moves
 *     the edge, and a screen reader hears its width;
 *   - Reset column widths in the card's ⋯, or beside the last column's name
 *     in a card with none;
 *   - a page that reads right to left drags the other way; a tablet's finger
 *     drags it; a phone draws cards, with nothing to size;
 *   - the dark theme's faint line; and on a list of 200 rows, only the
 *     edge's line follows the pointer until it is let go.
 *
 * Screenshots go to output/playwright/model-tables-ui (column-resize-*).
 */

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
// The fixture's signed-in member: widths are remembered per person.
const PERSON: string = "80000000-0000-4000-8000-000000000001";
const INCIDENTS: string = `/dashboard/${PROJECT}/incidents`;
const HAND_BUILT: string = `/dashboard/${PROJECT}/tables?table=handbuilt`;
// A page's own table whose last column (Rating) is drawn at its end.
const VITALS: string = `/dashboard/${PROJECT}/tables?table=vitals`;
const INCIDENTS_KEY: string = `TableColumnWidths.${PERSON}.incidents-table`;
const INTERFACES_KEY: string = `TableColumnWidths.${PERSON}.snmp-interfaces-table`;

// Where the Dashboard's and the Admin Dashboard's words are, per language.
const LOCALES: Array<string> = [
  path.resolve(__dirname, "../../App/FeatureSet/Dashboard/src/Locales"),
  path.resolve(__dirname, "../../App/FeatureSet/AdminDashboard/src/Locales"),
];

const NOW: Date = new Date("2026-10-16T05:35:00.000Z");

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/model-tables-ui",
);

// Tailwind's gray-300: the faint line on the light header band.
const FAINT_LINE_LIGHT: string = "rgb(209, 213, 219)";
const TRANSPARENT: string = "rgba(0, 0, 0, 0)";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `column-resize-${name}.png`),
    animations: "disabled",
  });
}

async function open(
  page: Page,
  address: string,
  width: number = 1280,
  height: number = 900,
): Promise<void> {
  await page.setViewportSize({ width: width, height: height });
  await page.goto(address);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await expect(page.getByTestId("table-skeleton-loader")).toHaveCount(0);
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  /*
   * Every finite transition of the first paint has run (the fixture's
   * Tailwind is written as elements appear).
   */
  await page.evaluate(async (): Promise<void> => {
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

function edgeOf(page: Page, columnId: string): Locator {
  return page.locator(
    `[data-testid="table-column-resize-handle"][data-column-id="${columnId}"]`,
  );
}

function headerOf(page: Page, columnId: string): Locator {
  return page.locator(`thead th[data-column-id="${columnId}"]`);
}

async function box(locator: Locator): Promise<Box> {
  const found: Box | null = await locator.boundingBox();

  if (!found) {
    throw new Error("No box: the element is not drawn");
  }

  return found;
}

async function widthOf(locator: Locator): Promise<number> {
  return (await box(locator)).width;
}

// A pointer's drag of an edge, `by` pixels along the line, in steps.
async function drag(page: Page, edge: Locator, by: number): Promise<void> {
  const at: Box = await box(edge);
  const x: number = at.x + at.width / 2;
  const y: number = at.y + at.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();

  for (let step: number = 1; step <= 10; step++) {
    await page.mouse.move(x + (by * step) / 10, y);
  }

  await page.mouse.up();
}

async function storedWidths(
  page: Page,
  key: string,
): Promise<Record<string, number> | null> {
  return await page.evaluate((storageKey: string) => {
    const value: string | null = window.localStorage.getItem(storageKey);

    return value ? (JSON.parse(value) as Record<string, number>) : null;
  }, key);
}

// The width each body cell of a header cell's column is drawn at.
async function columnCellWidths(
  page: Page,
  columnId: string,
): Promise<Array<number>> {
  return await page.evaluate((id: string): Array<number> => {
    const header: HTMLTableCellElement | null = document.querySelector(
      `thead th[data-column-id="${id}"]`,
    );

    if (!header) {
      return [];
    }

    const table: HTMLTableElement = header.closest("table") as HTMLTableElement;

    return Array.from(table.tBodies[0]?.rows || [])
      .map((row: HTMLTableRowElement): number => {
        const cell: HTMLTableCellElement | undefined =
          row.cells[header.cellIndex];

        return cell ? cell.getBoundingClientRect().width : -1;
      })
      .filter((width: number): boolean => {
        return width >= 0;
      });
  }, columnId);
}

// Whether anything in a column's cells - its header's too - is cut off.
async function isAnyValueCut(page: Page, columnId: string): Promise<boolean> {
  return await page.evaluate((id: string): boolean => {
    const header: HTMLTableCellElement | null = document.querySelector(
      `thead th[data-column-id="${id}"]`,
    );

    if (!header) {
      return true;
    }

    const table: HTMLTableElement = header.closest("table") as HTMLTableElement;
    const cells: Array<HTMLElement> = [header];

    for (const row of Array.from(table.tBodies[0]?.rows || [])) {
      const cell: HTMLTableCellElement | undefined =
        row.cells[header.cellIndex];

      if (cell) {
        cells.push(cell);
      }
    }

    return cells.some((cell: HTMLElement): boolean => {
      return Array.from(cell.querySelectorAll("*"))
        .concat([cell])
        .some((element: Element): boolean => {
          const html: HTMLElement = element as HTMLElement;

          // An edge's own lines are not values, nor words for a screen reader.
          if (
            html.closest("[data-column-resize-handle]") ||
            html.classList.contains("sr-only")
          ) {
            return false;
          }

          return html.scrollWidth > html.clientWidth + 1;
        });
    });
  }, columnId);
}

test.describe("a column's edge in the header", () => {
  test("is on every column but the select box's and the row's actions, quiet until the pointer is over the header row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const edges: Array<string | null> = await page
      .locator('[data-testid="table-column-resize-handle"]')
      .evaluateAll((elements: Array<Element>) => {
        return elements.map((element: Element): string | null => {
          return element.getAttribute("data-column-id");
        });
      });

    expect(edges).toEqual([
      "incidentNumber",
      "title",
      "currentIncidentState",
      "incidentSeverity",
      "monitors",
      "declaredAt:declared",
      "declaredAt:duration",
      "labels",
      "_id",
    ]);

    const line: Locator = edgeOf(page, "title").locator("span").first();

    // No rule between the header's names at rest: one calm band.
    await page.mouse.move(5, 5);
    await expect(line).toHaveCSS("background-color", TRANSPARENT);
    await screenshot(page, "before");

    // The pointer over the header row: every edge shows as a faint line.
    await page.mouse.move(
      (await box(headerOf(page, "monitors"))).x + 40,
      (await box(headerOf(page, "monitors"))).y + 10,
    );
    await expect(line).toHaveCSS("background-color", FAINT_LINE_LIGHT);
    await screenshot(page, "header-hover");

    // Over an edge: the resize cursor, and the edge's line in indigo.
    const edge: Locator = edgeOf(page, "monitors");
    const at: Box = await box(edge);

    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await expect(edge).toHaveCSS("cursor", "col-resize");
    await expect(edge.locator("span").nth(1)).toHaveCSS("opacity", "1");
    await expect(edge).toHaveAttribute(
      "title",
      "Drag to resize. Double-click to fit.",
    );
    await expect(
      page.getByRole("separator", {
        name: "Resize the Affected Resources column",
      }),
    ).toHaveCount(1);
  });
});

test.describe("dragging an edge", () => {
  test("makes the column narrower and wider, its values following, and the width is there on the next visit", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const header: Locator = headerOf(page, "monitors");
    const before: number = await widthOf(header);

    await drag(page, edgeOf(page, "monitors"), -120);
    await screenshot(page, "after-narrower");

    const narrower: number = await widthOf(header);

    expect(Math.abs(narrower - (before - 120))).toBeLessThanOrEqual(2);

    // Every value in the column is drawn at the column's width.
    for (const width of await columnCellWidths(page, "monitors")) {
      expect(Math.abs(width - narrower)).toBeLessThanOrEqual(1);
    }

    await drag(page, edgeOf(page, "monitors"), 200);

    const wider: number = await widthOf(header);

    expect(Math.abs(wider - (narrower + 200))).toBeLessThanOrEqual(2);
    expect((await storedWidths(page, INCIDENTS_KEY))?.["monitors"]).toBe(
      Math.round(wider),
    );

    // The next visit draws it as it was left.
    await open(page, INCIDENTS);

    expect(Math.abs((await widthOf(header)) - wider)).toBeLessThanOrEqual(1);
  });

  test("never narrower than its header's words, nor a date", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    await drag(page, edgeOf(page, "declaredAt:declared"), -400);
    await drag(page, edgeOf(page, "incidentNumber"), -400);

    // The dates, "Incident Number" and the numbers under it are whole.
    expect(await isAnyValueCut(page, "declaredAt:declared")).toBe(false);
    expect(await isAnyValueCut(page, "incidentNumber")).toBe(false);
    await screenshot(page, "at-least");
  });

  test("the width kept is the width drawn, however far a column of names that do not wrap is narrowed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    /*
     * Affected Resources' names do not wrap: a table gave the column the
     * widest of them on one line whatever its header asked, so a width
     * kept was never drawn (454px drawn for 224 kept).
     */
    for (const by of [-60, -150, -600]) {
      await drag(page, edgeOf(page, "monitors"), by);

      const drawn: number = await widthOf(headerOf(page, "monitors"));

      expect(
        Math.abs(
          ((await storedWidths(page, INCIDENTS_KEY))?.["monitors"] || 0) -
            drawn,
        ),
      ).toBeLessThanOrEqual(1);
    }

    // Narrowed as far as it goes: 8rem of each name and the cell's padding.
    expect(
      Math.round(await widthOf(headerOf(page, "monitors"))),
    ).toBeLessThanOrEqual(128 + 48);
    expect(await isAnyValueCut(page, "monitors")).toBe(true);
  });

  test("a double-click fits the column to its widest value", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    await drag(page, edgeOf(page, "monitors"), -150);
    expect(await isAnyValueCut(page, "monitors")).toBe(true);

    await edgeOf(page, "monitors").dblclick();

    await expect
      .poll(async () => {
        return await isAnyValueCut(page, "monitors");
      })
      .toBe(false);
    expect((await storedWidths(page, INCIDENTS_KEY))?.["monitors"]).toBe(
      Math.round(await widthOf(headerOf(page, "monitors"))),
    );
  });

  test("the keyboard: the arrows move the edge 16px, 64 with Shift; Home and End; Delete gives it back; its width is announced", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const edge: Locator = edgeOf(page, "monitors");
    const header: Locator = headerOf(page, "monitors");
    const start: number = await widthOf(header);

    const valueNow: () => Promise<number> = async (): Promise<number> => {
      return Number(await edge.getAttribute("aria-valuenow"));
    };

    await edge.focus();
    await expect(edge).toBeFocused();
    await page.keyboard.press("ArrowRight");

    const stepped: number = await valueNow();

    expect(Math.abs(stepped - (start + 16))).toBeLessThanOrEqual(1);
    await expect(edge).toHaveAttribute(
      "aria-valuetext",
      `${stepped} pixels wide`,
    );
    expect(Math.abs((await widthOf(header)) - stepped)).toBeLessThanOrEqual(1);

    await page.keyboard.press("Shift+ArrowLeft");
    expect(await valueNow()).toBe(stepped - 64);

    await page.keyboard.press("Home");
    const least: number = Number(await edge.getAttribute("aria-valuemin"));

    expect(await valueNow()).toBe(least);
    expect(least).toBeLessThan(start);

    await page.keyboard.press("End");
    await expect
      .poll(async () => {
        return await isAnyValueCut(page, "monitors");
      })
      .toBe(false);

    await page.keyboard.press("Delete");
    await expect(header).not.toHaveAttribute("style", /width/);
    expect(await storedWidths(page, INCIDENTS_KEY)).toBeNull();
  });
});

test.describe("Reset column widths", () => {
  test("is in the card's ⋯ while a column is sized, and gives every column back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const header: Locator = headerOf(page, "monitors");
    const before: number = await widthOf(header);

    await drag(page, edgeOf(page, "monitors"), -100);
    await page.getByRole("button", { name: "More options" }).first().click();

    const reset: Locator = page.getByRole("menuitem", {
      name: "Reset column widths",
    });

    await expect(reset).toBeVisible();
    await screenshot(page, "card-menu");
    await reset.click();

    expect(Math.abs((await widthOf(header)) - before)).toBeLessThanOrEqual(1);
    expect(await storedWidths(page, INCIDENTS_KEY)).toBeNull();
  });
});

test.describe("a table a page draws itself", () => {
  test("sizes its columns the same way, and keeps its reset beside its last column's name in a card with no ⋯", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, HAND_BUILT);

    const header: Locator = headerOf(page, "interface");
    const before: number = await widthOf(header);

    // The header's names line up with their values, not in the middle.
    const nameX: number = (await box(header.locator("span").first())).x;
    const valueX: number = (
      await box(page.locator("tbody tr").first().locator("td").first())
    ).x;

    expect(Math.abs(nameX - valueX)).toBeLessThanOrEqual(1);

    await expect(
      page.getByRole("button", { name: "Reset column widths" }),
    ).toHaveCount(0);

    await drag(page, edgeOf(page, "interface"), -200);

    expect(
      Math.abs((await widthOf(header)) - (before - 200)),
    ).toBeLessThanOrEqual(2);
    expect((await storedWidths(page, INTERFACES_KEY))?.["interface"]).toBe(
      Math.round(await widthOf(header)),
    );

    const reset: Locator = headerOf(page, "errors").getByRole("button", {
      name: "Reset column widths",
    });

    await expect(reset).toBeVisible();
    await screenshot(page, "hand-built");

    // Clear of the last column's edge: a press on it resets, not drags.
    const resetBox: Box = await box(reset);
    const lastEdge: Box = await box(edgeOf(page, "errors"));

    expect(resetBox.x + resetBox.width).toBeLessThanOrEqual(lastEdge.x);

    await reset.click();

    expect(Math.abs((await widthOf(header)) - before)).toBeLessThanOrEqual(1);
    expect(await storedWidths(page, INTERFACES_KEY)).toBeNull();
  });
});

test.describe("a table a page draws itself, read closely", () => {
  test("an edge's line sits in the middle of the room between two columns' names, never against the next one's", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, HAND_BUILT);

    /*
     * The interfaces' header cells pad their end only (pr-4): the Interface
     * column ends where "Status" starts, and a line on that end was drawn
     * against the S, as if it were Status' left rule.
     */
    const header: Locator = headerOf(page, "interface");
    const line: Locator = edgeOf(page, "interface").locator("span").first();
    const headerBox: Box = await box(header);

    await page.mouse.move(headerBox.x + 20, headerBox.y + headerBox.height / 2);
    await expect(line).toHaveCSS("background-color", FAINT_LINE_LIGHT);

    const lineBox: Box = await box(line);
    const nextName: Box = await box(
      headerOf(page, "status").getByText("Status", { exact: true }),
    );

    // Half the column's 16px of end padding in from its end.
    expect(
      Math.round(headerBox.x + headerBox.width - (lineBox.x + lineBox.width)),
    ).toBe(8);
    expect(nextName.x - (lineBox.x + lineBox.width)).toBeGreaterThanOrEqual(7);
    await screenshot(page, "hand-built-lines");

    // The shared Table pads its names alike at both ends: its lines stay on the ends.
    await open(page, INCIDENTS);

    const title: Locator = headerOf(page, "title");
    const titleBox: Box = await box(title);

    await page.mouse.move(titleBox.x + 10, titleBox.y + titleBox.height / 2);

    const titleLine: Box = await box(
      edgeOf(page, "title").locator("span").first(),
    );

    expect(
      Math.abs(titleBox.x + titleBox.width - (titleLine.x + titleLine.width)),
    ).toBeLessThanOrEqual(1);
  });

  test("Reset column widths at the header row's end shows only while the header row is pointed at, or the keyboard is in it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, HAND_BUILT);
    await drag(page, edgeOf(page, "interface"), -200);

    const reset: Locator = headerOf(page, "errors").getByRole("button", {
      name: "Reset column widths",
    });

    // The pointer elsewhere: the header as calm as the product draws it.
    await page.mouse.move(5, 5);
    await expect(reset).toHaveCSS("opacity", "0");
    await screenshot(page, "hand-built-sized-at-rest");

    // Over the header row: there, with the columns' edges.
    const speed: Box = await box(headerOf(page, "speed"));

    await page.mouse.move(speed.x + 10, speed.y + speed.height / 2);
    await expect(reset).toHaveCSS("opacity", "1");

    // The keyboard in the header row: there too, a key before the last edge.
    await page.mouse.move(5, 5);
    await expect(reset).toHaveCSS("opacity", "0");
    await edgeOf(page, "errors").focus();
    await expect(reset).toHaveCSS("opacity", "1");
    await page.keyboard.press("Shift+Tab");
    await expect(reset).toBeFocused();
    await expect(reset).toHaveCSS("opacity", "1");
  });

  test("a last column drawn at its end, over numbers, keeps its name over its values: the reset goes before the name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, VITALS);

    const rating: Locator = headerOf(page, "rating");
    const ratingName: Locator = rating.getByText("Rating", { exact: true });
    const firstRating: Locator = page
      .locator("tbody tr")
      .first()
      .locator("td")
      .nth(2)
      .locator("span")
      .first();

    await drag(page, edgeOf(page, "route"), -200);

    const route: Box = await box(headerOf(page, "route"));

    await page.mouse.move(route.x + 10, route.y + route.height / 2);

    const reset: Locator = rating.getByRole("button", {
      name: "Reset column widths",
    });

    await expect(reset).toHaveCSS("opacity", "1");

    const name: Box = await box(ratingName);
    const value: Box = await box(firstRating);
    const resetBox: Box = await box(reset);

    expect(resetBox.x + resetBox.width).toBeLessThanOrEqual(name.x);
    // "Rating" ends where "Poor" under it ends, as it did before anything was sized.
    expect(
      Math.abs(name.x + name.width - (value.x + value.width)),
    ).toBeLessThanOrEqual(1);
    await screenshot(page, "end-aligned-reset");
  });

  test("a phone draws no edge on a page's own table either: it scrolls sideways under a finger", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, HAND_BUILT, 390, 844);

    const edges: Locator = page.locator(
      '[data-testid="table-column-resize-handle"]',
    );

    expect(await edges.count()).toBeGreaterThan(0);

    for (const edge of await edges.all()) {
      await expect(edge).toBeHidden();
    }
  });
});

test.describe("Reset column widths in every language", () => {
  test("reads on one line in a card's ⋯, in each of the Dashboard's and the Admin Dashboard's languages", async ({
    page,
  }: {
    page: Page;
  }) => {
    const labels: Array<{ language: string; label: string }> = [];

    for (const folder of LOCALES) {
      const files: Array<string> = (await fs.readdir(folder)).filter(
        (file: string): boolean => {
          return file.endsWith(".json");
        },
      );

      for (const file of files) {
        const words: Record<string, unknown> = JSON.parse(
          await fs.readFile(path.join(folder, file), "utf8"),
        ) as Record<string, unknown>;
        const label: unknown = words["Reset column widths"];

        if (typeof label === "string" && label) {
          labels.push({
            language: `${path.basename(path.dirname(folder))} ${file}`,
            label: label,
          });
        }
      }
    }

    // 17 languages, in both apps.
    expect(labels.length).toBeGreaterThanOrEqual(34);

    await open(page, INCIDENTS);
    await drag(page, edgeOf(page, "monitors"), -100);
    await page.getByRole("button", { name: "More options" }).first().click();

    const item: Locator = page.getByRole("menuitem", {
      name: "Reset column widths",
    });

    await expect(item).toBeVisible();

    // The item's words written in each language, its height read each time.
    const heights: Array<{ language: string; label: string; lines: number }> =
      await item.evaluate(
        (
          element: Element,
          list: Array<{ language: string; label: string }>,
        ): Array<{ language: string; label: string; lines: number }> => {
          const words: HTMLElement | undefined = Array.from(
            element.querySelectorAll("div"),
          ).find((candidate: HTMLDivElement): boolean => {
            return (
              candidate.childElementCount === 0 &&
              (candidate.textContent || "").trim() === "Reset column widths"
            );
          });

          if (!words) {
            return [];
          }

          const lineHeight: number = parseFloat(
            getComputedStyle(words).lineHeight,
          );

          return list.map(
            (entry: {
              language: string;
              label: string;
            }): { language: string; label: string; lines: number } => {
              words.textContent = entry.label;

              return {
                language: entry.language,
                label: entry.label,
                lines: Math.round(
                  words.getBoundingClientRect().height / lineHeight,
                ),
              };
            },
          );
        },
        labels,
      );

    expect(heights).toHaveLength(labels.length);

    for (const entry of heights) {
      expect([entry.language, entry.label, entry.lines]).toEqual([
        entry.language,
        entry.label,
        1,
      ]);
    }
  });
});

test.describe("other readers", () => {
  test("a page that reads right to left (Persian): the edge is at the column's left end, and dragging left widens it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${INCIDENTS}?lang=fa`);

    const header: Locator = headerOf(page, "monitors");
    const edge: Locator = edgeOf(page, "monitors");
    const headerBox: Box = await box(header);
    const edgeBox: Box = await box(edge);

    expect(edgeBox.x - headerBox.x).toBeLessThanOrEqual(1);
    await expect(edge).toHaveAttribute("aria-label", /^تغییر عرض ستون /);

    const before: number = headerBox.width;

    await drag(page, edge, -100);

    expect(
      Math.abs((await widthOf(header)) - (before + 100)),
    ).toBeLessThanOrEqual(2);
    await screenshot(page, "persian");
  });

  test("German at 1024px: the edge is named in German, and a drag sizes the column", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${INCIDENTS}?lang=de`, 1024);

    /*
     * Severity: at 1024px the rows scroll sideways, and the Actions column
     * stuck at the card's edge covers Affected Resources' end until they do.
     */
    const edge: Locator = edgeOf(page, "incidentSeverity");

    await expect(edge).toHaveAttribute(
      "title",
      "Zum Ändern der Breite ziehen. Zum Anpassen an den Inhalt doppelklicken.",
    );

    const header: Locator = headerOf(page, "incidentSeverity");
    const before: number = await widthOf(header);

    await drag(page, edge, 80);

    expect(
      Math.abs((await widthOf(header)) - (before + 80)),
    ).toBeLessThanOrEqual(2);
    await screenshot(page, "german-1024");
  });

  test("a phone draws the rows as cards: there is nothing to size", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(INCIDENTS);
    await expect(page.getByText("INC-1").first()).toBeVisible();

    await expect(
      page.locator('[data-testid="table-column-resize-handle"]'),
    ).toHaveCount(0);
  });

  test("the dark theme: the faint line is the dark theme's border, the edge under the pointer indigo", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${INCIDENTS}?theme=dark`);

    const darkBorder: string = await page.evaluate((): string => {
      const probe: HTMLElement = document.createElement("div");

      probe.style.backgroundColor = "var(--ou-border-default)";
      document.body.appendChild(probe);

      const color: string = getComputedStyle(probe).backgroundColor;

      probe.remove();

      return color;
    });

    expect(darkBorder).not.toBe(TRANSPARENT);
    expect(darkBorder).not.toBe(FAINT_LINE_LIGHT);

    await page.mouse.move(
      (await box(headerOf(page, "monitors"))).x + 40,
      (await box(headerOf(page, "monitors"))).y + 10,
    );
    await expect(edgeOf(page, "title").locator("span").first()).toHaveCSS(
      "background-color",
      darkBorder,
    );

    await drag(page, edgeOf(page, "monitors"), -80);
    await page.mouse.move(
      (await box(headerOf(page, "monitors"))).x + 40,
      (await box(headerOf(page, "monitors"))).y + 10,
    );
    await screenshot(page, "dark");
  });
});

test.describe("on a tablet", () => {
  test("every edge shows, a fingertip wide, and a finger drags it", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    // The project's address, which a context of the test's own does not take on.
    const baseURL: string | undefined = test.info().project.use.baseURL;
    const context: BrowserContext = await browser.newContext({
      viewport: { width: 1024, height: 768 },
      hasTouch: true,
      isMobile: true,
      timezoneId: "Europe/London",
      locale: "en-US",
      ...(baseURL ? { baseURL: baseURL } : {}),
    });
    const page: Page = await context.newPage();
    const errors: Array<string> = [];

    page.on("pageerror", (error: Error) => {
      errors.push(String(error));
    });
    await page.clock.setFixedTime(NOW);
    await page.goto(INCIDENTS);
    await expect(page.locator("table tbody tr").first()).toBeVisible();

    // Severity's: Affected Resources' end is under the stuck Actions column.
    const edge: Locator = edgeOf(page, "incidentSeverity");

    // No pointer to hover with: each edge is drawn, and takes 24px.
    await expect(edge.locator("span").first()).toHaveCSS(
      "background-color",
      FAINT_LINE_LIGHT,
    );
    expect(Math.round(await widthOf(edge))).toBe(24);

    const header: Locator = headerOf(page, "incidentSeverity");
    const before: number = await widthOf(header);
    const at: Box = await box(edge);
    const touch: CDPSession = await context.newCDPSession(page);
    const x: number = Math.round(at.x + at.width / 2);
    const y: number = Math.round(at.y + at.height / 2);

    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: x, y: y }],
    });

    for (let step: number = 1; step <= 10; step++) {
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + step * 9, y: y }],
      });
    }

    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });

    await expect
      .poll(async () => {
        return Math.round((await widthOf(header)) - before);
      })
      .toBeGreaterThanOrEqual(88);
    expect(Math.round((await widthOf(header)) - before)).toBeLessThanOrEqual(
      92,
    );
    await screenshot(page, "tablet");
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("a list of 200 rows", () => {
  test("only the edge's line follows the pointer down the rows; the column takes its width when it is let go", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.addInitScript((): void => {
      window.localStorage.setItem(
        "BaseModelTablePageSize.incidents-table",
        "200",
      );
    });
    await open(page, `${INCIDENTS}?rows=200`);
    await expect(page.locator("table tbody tr")).toHaveCount(200);

    const header: Locator = headerOf(page, "monitors");
    const edge: Locator = edgeOf(page, "monitors");
    const before: number = await widthOf(header);
    const at: Box = await box(edge);
    const x: number = at.x + at.width / 2;
    const y: number = at.y + at.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();

    for (let step: number = 1; step <= 10; step++) {
      await page.mouse.move(x - step * 10, y);
    }

    // Mid-drag: the guide runs down the rows to the window's foot, the column as it was.
    const guide: Locator = edge.getByTestId("table-column-resize-guide");

    await expect(guide).toBeVisible();

    const guideBox: Box = await box(guide);

    expect(guideBox.height).toBeGreaterThan(500);
    expect(Math.abs(guideBox.y + guideBox.height - 900)).toBeLessThanOrEqual(2);
    expect(Math.abs((await widthOf(header)) - before)).toBeLessThanOrEqual(1);
    await screenshot(page, "long-list-dragging");

    await page.mouse.up();

    await expect(guide).toBeHidden();
    expect(
      Math.abs((await widthOf(header)) - (before - 100)),
    ).toBeLessThanOrEqual(2);
  });
});
