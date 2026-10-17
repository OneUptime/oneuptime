import { BrowserContext, expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Tables (ModelTable -> BaseModelTable -> Table) in real Chromium, against
 * the offline fixture (ModelTables/Fixture): the real Incidents list of the
 * maintainer's screenshot, Monitors, Status Pages, Teams, a list put in order
 * by dragging (Device Roles) and a gallery of every kind of column.
 *
 * The maintainer's ask: "How can we improve the UI of the model table so we
 * make it easier for people to understand and use, and make it cleaner and
 * more modern?" The screenshot: "Incident Number" broken over two lines in
 * bold black; "No labels attached." and "No owners." on every row; every
 * value a medium-weight grey; "10 days, 23 hours, 31 minutes" and long
 * resource names pushing the table past the card, its Actions column out of
 * sight; the filter chips in a box of their own.
 *
 * jsdom draws nothing, so what only a browser can show is measured here: a
 * header row of one line; rows of 48px whatever they hold; a long value cut
 * short with an ellipsis inside its column, whole under the pointer; a
 * row's name using the room a table that fits has, and giving way before
 * the rows scroll; the Actions column in sight when the rows scroll
 * sideways; a header row that sticks while a long page scrolls; a row that
 * opens its record on a click that is its own; the quiet dash; the phone's
 * cards; the dark theme; the loading rows; and the drag grip still moving a
 * row.
 */

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const INCIDENTS: string = `/dashboard/${PROJECT}/incidents`;
const MONITORS: string = `/dashboard/${PROJECT}/monitors`;
const STATUS_PAGES: string = `/dashboard/${PROJECT}/status-pages`;
const TEAMS: string = `/dashboard/${PROJECT}/settings/teams`;
const ROLES: string = `/dashboard/${PROJECT}/network-devices/settings/roles`;
const GALLERY: string = `/dashboard/${PROJECT}/tables`;

// What the Incidents list's Duration is measured against.
const NOW: Date = new Date("2026-10-16T05:35:00.000Z");

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/model-tables-ui",
);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FixtureRecord {
  listRequests: Array<{ tableName: string; limit: number }>;
  updates: Array<{ tableName: string; id: string; data: unknown }>;
  navigations: Array<string>;
  unmodelled: Array<string>;
}

/*
 * react-beautiful-dnd (the drag-ordered lists) warns about defaultProps on
 * memo components in React 18.3; it is not this page's doing.
 */
const KNOWN_LIBRARY_WARNINGS: Array<string> = [
  "Support for defaultProps will be removed from memo components",
];

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
  page.on("console", (message: { type: () => string; text: () => string }) => {
    if (
      message.type() === "error" &&
      !KNOWN_LIBRARY_WARNINGS.some((warning: string): boolean => {
        return message.text().includes(warning);
      })
    ) {
      errors.push(message.text());
    }
  });
  /*
   * An error event on the window that is no exception - "ResizeObserver
   * loop completed with undelivered notifications", which a table measured
   * inside the observer's call raised on every resize - reaches neither the
   * console nor pageerror: it is recorded here.
   */
  await page.addInitScript((): void => {
    const record: Array<string> = [];
    (window as unknown as { __windowErrors: Array<string> }).__windowErrors =
      record;
    window.addEventListener("error", (event: ErrorEvent) => {
      record.push(String(event.message));
    });
  });
  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
  expect(
    await page.evaluate((): Array<string> => {
      return (
        (window as unknown as { __windowErrors?: Array<string> })
          .__windowErrors || []
      );
    }),
  ).toEqual([]);
  // Every read the tables made is one the fixture answers as the API does.
  expect((await fixture(page)).unmodelled).toEqual([]);
});

async function fixture(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    return (window as unknown as { __fixture: FixtureRecord }).__fixture;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
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
}

function bodyRows(page: Page, tableId: string): Locator {
  return page.locator(`#${tableId}-body > tr`);
}

function header(page: Page): Locator {
  return page.locator("thead th");
}

async function box(locator: Locator): Promise<Box> {
  const found: Box | null = await locator.boundingBox();
  if (!found) {
    throw new Error("No box: the element is not drawn");
  }
  return found;
}

// Where the page is now, without its query string.
function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}

async function rowHeights(rows: Locator): Promise<Array<number>> {
  return await rows.evaluateAll((elements: Array<Element>): Array<number> => {
    return elements.map((element: Element): number => {
      return Math.round(element.getBoundingClientRect().height);
    });
  });
}

// WCAG contrast of two "rgb(r, g, b)" colours.
function contrast(foreground: string, background: string): number {
  const channels: (colour: string) => Array<number> = (
    colour: string,
  ): Array<number> => {
    return (colour.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  };
  const luminance: (colour: string) => number = (colour: string): number => {
    const [r, g, b] = channels(colour).map((value: number): number => {
      const channel: number = value / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const a: number = luminance(foreground);
  const b: number = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test.describe("the Incidents list of the screenshot", () => {
  test("its header row is one quiet line: 'Incident Number' no longer breaks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const titles: Array<string> = (await header(page).allInnerTexts()).map(
      (title: string): string => {
        return title.trim();
      },
    );

    expect(titles).toEqual(
      expect.arrayContaining([
        "Incident Number",
        "Title",
        "State",
        "Severity",
        "Resources Affected",
        "Declared",
        "Duration",
        "Labels",
        "Owners",
      ]),
    );

    const cells: Array<{
      height: number;
      fontSize: string;
      fontWeight: string;
      textTransform: string;
      lines: number;
    }> = await header(page).evaluateAll((elements: Array<Element>) => {
      return elements.map((element: Element) => {
        const style: CSSStyleDeclaration = getComputedStyle(element);
        /*
         * The column's name: an inline span, drawn in one box per line it
         * takes. The Actions column's is for a screen reader only.
         */
        const title: Element | null =
          element.querySelector("span:not(.sr-only)");
        return {
          height: element.getBoundingClientRect().height,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          textTransform: style.textTransform,
          lines: title ? title.getClientRects().length : 0,
        };
      });
    });

    for (const cell of cells) {
      // One line of 12px names on the band: 36px plus its two rules.
      expect(cell.height).toBeLessThanOrEqual(39);
      expect(cell.fontSize).toBe("12px");
      expect(cell.fontWeight).toBe("500");
      expect(cell.textTransform).toBe("none");
      expect(cell.lines).toBeLessThanOrEqual(1);
    }

    await screenshot(page, "incidents-1280");
  });

  test("a row's values read in the reading size on a 24px line; the number is the row's name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const firstRow: Locator = bodyRows(page, "incidents-table").first();
    const styles: Array<{
      fontSize: string;
      lineHeight: string;
      fontWeight: string;
      color: string;
    }> = await firstRow.locator("td").evaluateAll((cells: Array<Element>) => {
      return cells.map((cell: Element) => {
        const style: CSSStyleDeclaration = getComputedStyle(cell);
        return {
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          fontWeight: style.fontWeight,
          color: style.color,
        };
      });
    });

    // The select box, then the number: medium, in the reading colour.
    expect(styles[1]).toEqual(
      expect.objectContaining({
        fontSize: "14px",
        lineHeight: "24px",
        fontWeight: "500",
        color: "rgb(17, 24, 39)",
      }),
    );
    // The title and the rest: regular, gray-700.
    expect(styles[2]).toEqual(
      expect.objectContaining({
        fontSize: "14px",
        lineHeight: "24px",
        fontWeight: "400",
        color: "rgb(55, 65, 81)",
      }),
    );
  });

  test("an empty value is a quiet dash: no 'No labels attached.' or 'No owners.' on every row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const rows: Locator = bodyRows(page, "incidents-table");

    await expect(rows).toHaveCount(2);

    // The words are there for a screen reader only, never as a line of text.
    for (const words of ["No labels attached.", "No owners."]) {
      const found: Array<Locator> = await page.getByText(words).all();

      expect(found.length).toBe(2);

      for (const element of found) {
        await expect(element).toHaveClass("sr-only");
      }
    }

    for (const row of await rows.all()) {
      const dashes: Locator = row.getByTestId("table-empty-value");
      // Labels and Owners.
      await expect(dashes).toHaveCount(2);

      for (const dash of await dashes.all()) {
        await expect(dash.locator('[aria-hidden="true"]')).toHaveText("—");
        expect(
          await dash.evaluate((element: Element): string => {
            return getComputedStyle(element).color;
          }),
        ).toBe("rgb(156, 163, 175)");
      }
    }

    // A screen reader still hears the words.
    await expect(
      rows.first().getByTestId("table-empty-value").first().locator(".sr-only"),
    ).toHaveText("No labels attached.");
  });

  test("the Duration says its two largest units, and the whole duration under the pointer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const duration: Locator = bodyRows(page, "incidents-table")
      .first()
      .getByTestId("live-duration");

    await expect(duration).toHaveText("10 days, 23 hours");
    await expect(duration).toHaveAttribute(
      "title",
      "10 days, 23 hours, 31 minutes",
    );
  });

  test("the filter chips sit on the card, with no box of their own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const bar: Locator = page.getByTestId("facet-filter-bar");

    await expect(bar).toBeVisible();
    await expect(bar.getByTestId("filter-chip")).toHaveCount(6);

    const style: {
      borderTopWidth: string;
      boxShadow: string;
      backgroundColor: string;
    } = await bar.evaluate((element: Element) => {
      const computed: CSSStyleDeclaration = getComputedStyle(element);
      return {
        borderTopWidth: computed.borderTopWidth,
        boxShadow: computed.boxShadow,
        backgroundColor: computed.backgroundColor,
      };
    });

    expect(style.borderTopWidth).toBe("0px");
    expect(style.boxShadow).toBe("none");
    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  });
});

test.describe("rows are 48px whatever they hold", () => {
  test("text, pills, labels, avatars, a dash and the row's buttons all sit on the 24px line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${MONITORS}?data=rich`);

    const rows: Locator = bodyRows(page, "Monitors-table");

    await expect(rows).toHaveCount(4);

    // 48px and the hairline under every row but the last.
    expect(await rowHeights(rows)).toEqual([49, 49, 49, 48]);

    // The labels of a monitor with four: two pills and "+2", on the line.
    const ping: Locator = rows.nth(3);

    await expect(
      ping.getByTestId("table-labels").getByTestId("pill"),
    ).toHaveCount(2);
    await expect(ping.getByTestId("table-labels-more")).toHaveText("+2");

    await screenshot(page, "monitors-rich-1280");
  });

  test("'+N' shows every label in the cell, and 'Show less' folds them again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${MONITORS}?data=rich`);

    const ping: Locator = bodyRows(page, "Monitors-table").nth(3);

    await ping.getByTestId("table-labels-more").click();
    await expect(
      ping.getByTestId("table-labels").getByTestId("pill"),
    ).toHaveCount(4);

    // Opening the labels is the labels' click, not the row's.
    expect((await fixture(page)).navigations).toEqual([]);

    await ping.getByTestId("table-labels-less").click();
    await expect(
      ping.getByTestId("table-labels").getByTestId("pill"),
    ).toHaveCount(2);
  });

  test("each part of a cell starts on the row's line, level with its neighbours", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${MONITORS}?data=rich`);

    const row: Locator = bodyRows(page, "Monitors-table").nth(1);
    const firstLineTops: Array<number> = await row
      .locator("td")
      .evaluateAll((cells: Array<Element>): Array<number> => {
        return cells.map((cell: Element): number => {
          const content: Element = cell.firstElementChild || cell;
          return Math.round(content.getBoundingClientRect().top);
        });
      });

    const top: number = firstLineTops[1]!;

    for (const value of firstLineTops) {
      // The 30px buttons are centred on the line: 3px above it.
      expect(Math.abs(value - top)).toBeLessThanOrEqual(3);
    }
  });
});

test.describe("a value too long for its column", () => {
  test("is cut short with an ellipsis inside its column, and shows in full under the pointer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${INCIDENTS}?data=long`);

    // The incident's title: a column after the row's name keeps its 20rem.
    const title: Locator = bodyRows(page, "incidents-table")
      .filter({ hasText: "Checkout requests time out" })
      .locator("td")
      .nth(2)
      .locator("> div");

    const measure: {
      width: number;
      scrollWidth: number;
      clientWidth: number;
      textOverflow: string;
    } = await title.evaluate((element: Element) => {
      const style: CSSStyleDeclaration = getComputedStyle(element);
      return {
        width: element.getBoundingClientRect().width,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        textOverflow: style.textOverflow,
      };
    });

    // Capped at 20rem, the rest of the title cut off with an ellipsis.
    expect(measure.width).toBeLessThanOrEqual(320);
    expect(measure.scrollWidth).toBeGreaterThan(measure.clientWidth);
    expect(measure.textOverflow).toBe("ellipsis");

    await title.hover();
    await expect(title).toHaveAttribute(
      "title",
      "Checkout requests time out for customers in every EU region while the payments gateway retries callbacks against the primary database",
    );

    await screenshot(page, "incidents-long-1280");
  });

  test("so the Status Pages list fits its card at 1280px, its View in sight - it ran 200px past it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGES}?data=long`);

    await expect(page.getByTestId("table-scroll")).toHaveAttribute(
      "data-overflowing",
      "false",
    );

    const card: Box = await box(page.getByTestId("card").first());

    for (const view of await page
      .getByRole("button", { name: "View Status Page" })
      .all()) {
      const button: Box = await box(view);
      expect(button.x + button.width).toBeLessThanOrEqual(card.x + card.width);
    }

    // And nothing reaches past the page.
    expect(
      await page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      }),
    ).toBe(0);
  });

  test("a resource's name in a list ends in an ellipsis, its icon beside it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${INCIDENTS}?data=long`, 1600);

    const resource: Locator = bodyRows(page, "incidents-table")
      .filter({ hasText: "Checkout requests time out" })
      .locator("td")
      .nth(5)
      .locator("div.truncate")
      .first();

    const measure: {
      textOverflow: string;
      scrollWidth: number;
      clientWidth: number;
      iconDisplay: string;
    } = await resource.evaluate((element: Element) => {
      return {
        textOverflow: getComputedStyle(element).textOverflow,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        iconDisplay: getComputedStyle(
          element.querySelector("span > div") as Element,
        ).display,
      };
    });

    expect(measure.textOverflow).toBe("ellipsis");
    expect(measure.scrollWidth).toBeGreaterThan(measure.clientWidth);
    expect(measure.iconDisplay).toBe("inline-block");
  });
});

test.describe("a row's name uses the room its row has", () => {
  const LONG_STATUS_PAGE: string =
    "Customer-Facing Status Page for EU-West Enterprise Customers, Partners and Resellers (Primary)";

  interface NameMeasure {
    fill: string | null;
    width: number;
    height: number;
    scrollHeight: number;
    clientHeight: number;
    lineClamp: string;
  }

  async function measureName(name: Locator): Promise<NameMeasure> {
    return await name.evaluate((element: Element): NameMeasure => {
      const style: CSSStyleDeclaration = getComputedStyle(element);
      return {
        fill: element.getAttribute("data-fill"),
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        lineClamp: style.webkitLineClamp,
      };
    });
  }

  function statusPageName(page: Page, row: number): Locator {
    return bodyRows(page, "status-page-table")
      .nth(row)
      .locator("td")
      .nth(1)
      .locator("> div");
  }

  test("in a table that fits, a long name runs past 20rem to its column's end, cut short after its first line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGES}?data=long`);

    await expect(page.getByTestId("table-scroll")).toHaveAttribute(
      "data-overflowing",
      "false",
    );

    const name: Locator = statusPageName(page, 2);
    const measure: NameMeasure = await measureName(name);

    expect(measure.fill).toBe("true");
    // Past the 20rem a name used to stop at...
    expect(measure.width).toBeGreaterThan(320);
    // ...and still one line of the row's 24px, the rest held back.
    expect(Math.round(measure.height)).toBe(24);
    expect(measure.lineClamp).toBe("1");
    expect(measure.scrollHeight).toBeGreaterThan(measure.clientHeight);

    // The column of prose beside it keeps its share: never under 10rem.
    const description: Box = await box(
      bodyRows(page, "status-page-table").nth(2).locator("td").nth(2),
    );
    expect(description.width).toBeGreaterThanOrEqual(160);

    // A short name's row is still 48px and its hairline, as before.
    expect((await rowHeights(bodyRows(page, "status-page-table")))[1]).toBe(49);

    await name.hover();
    await expect(name).toHaveAttribute("title", LONG_STATUS_PAGE);

    await screenshot(page, "status-pages-long-1280");
  });

  test("at 1000px it gives way, down to 10rem, so the table fits instead of scrolling", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGES}?data=long`, 1000);

    await expect(page.getByTestId("table-scroll")).toHaveAttribute(
      "data-overflowing",
      "false",
    );

    const measure: NameMeasure = await measureName(statusPageName(page, 2));

    expect(measure.fill).toBe("true");
    expect(measure.width).toBeLessThan(320);
    expect(measure.width).toBeGreaterThanOrEqual(160);
    expect(Math.round(measure.height)).toBe(24);

    // Every row's View is on the card: nothing scrolls out of sight.
    const card: Box = await box(page.getByTestId("card").first());

    for (const view of await page
      .getByRole("button", { name: "View Status Page" })
      .all()) {
      const button: Box = await box(view);
      expect(button.x + button.width).toBeLessThanOrEqual(card.x + card.width);
    }

    await screenshot(page, "status-pages-long-1000");
  });

  test("at 900px even 10rem does not fit: the rows scroll, and the name is back at its cap", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGES}?data=long`, 900);

    await expect(page.getByTestId("table-scroll")).toHaveAttribute(
      "data-overflowing",
      "true",
    );

    const name: Locator = statusPageName(page, 2);
    const measure: NameMeasure = await measureName(name);

    expect(measure.fill).toBe("false");
    expect(measure.width).toBeLessThanOrEqual(320);
    expect(Math.round(measure.height)).toBe(24);
    expect(
      await name.evaluate((element: Element): string => {
        return getComputedStyle(element).textOverflow;
      }),
    ).toBe("ellipsis");
  });

  test("a window made narrower and wider again moves between the two, and settles - with no error on the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGES}?data=long`, 1280);

    const scrollBox: Locator = page.getByTestId("table-scroll");
    const name: Locator = statusPageName(page, 2);

    for (const [width, overflowing, fill] of [
      [900, "true", "false"],
      [1000, "false", "true"],
      [880, "true", "false"],
      [1280, "false", "true"],
    ] as Array<[number, string, string]>) {
      await page.setViewportSize({ width: width, height: 900 });
      await expect(scrollBox).toHaveAttribute("data-overflowing", overflowing);
      await expect(name).toHaveAttribute("data-fill", fill);
    }

    // A window's edge dragged across both, a few pixels a frame, and back.
    for (let width: number = 1280; width >= 860; width -= 7) {
      await page.setViewportSize({ width: width, height: 900 });
    }
    for (let width: number = 860; width <= 1280; width += 9) {
      await page.setViewportSize({ width: width, height: 900 });
    }
    await expect(scrollBox).toHaveAttribute("data-overflowing", "false");
    await expect(name).toHaveAttribute("data-fill", "true");

    // Settled: a moment later nothing has flipped back.
    const before: string = await name.evaluate((element: Element): string => {
      return element.outerHTML;
    });
    await page.waitForTimeout(300);
    expect(
      await name.evaluate((element: Element): string => {
        return element.outerHTML;
      }),
    ).toBe(before);
  });

  test("a person - a picture beside a name over an email - keeps its cap and its lines", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${GALLERY}?table=people&data=long`);

    const rows: Locator = bodyRows(page, "gallery-people");

    await expect(rows).toHaveCount(4);

    const person: Locator = rows.nth(3).locator("td").nth(1).locator("> div");
    const measure: NameMeasure = await measureName(person);

    // Not a line of text: it would wrap inside itself if set free.
    expect(measure.fill).toBe("false");
    expect(measure.width).toBeLessThanOrEqual(320);

    // The long name is still one line, and as tall as a short one.
    const nameLines: number = await rows
      .nth(3)
      .getByText(/^Maximiliana Alexandrina/)
      .evaluate((element: Element): number => {
        return element.getClientRects().length;
      });
    expect(nameLines).toBe(1);

    const short: NameMeasure = await measureName(
      rows.nth(0).locator("td").nth(1).locator("> div"),
    );
    expect(Math.round(measure.height)).toBe(Math.round(short.height));

    await screenshot(page, "gallery-people-1280");
  });
});

test.describe("a table wider than its card", () => {
  test("scrolls sideways in its own box, its Actions column stuck at the card's edge", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${INCIDENTS}?data=rich`);

    const scroller: Locator = page.getByTestId("table-scroll");

    await expect(scroller).toHaveAttribute("data-overflowing", "true");

    const card: Box = await box(page.getByTestId("card").first());
    const views: Array<Locator> = await page
      .getByRole("button", { name: "View Incident" })
      .all();

    expect(views.length).toBe(5);

    for (const scrollLeft of [0, 300, 100000]) {
      await scroller.evaluate((element: Element, left: number): void => {
        element.scrollLeft = left;
      }, scrollLeft);

      for (const view of views) {
        const button: Box = await box(view);
        expect(button.x).toBeGreaterThan(card.x);
        expect(button.x + button.width).toBeLessThanOrEqual(
          card.x + card.width,
        );
      }
    }

    // Ruled off from the cells that pass under it.
    const actionsCell: Locator = bodyRows(page, "incidents-table")
      .first()
      .locator("td")
      .last();

    expect(
      await actionsCell.evaluate((element: Element) => {
        const style: CSSStyleDeclaration = getComputedStyle(element);
        return {
          position: style.position,
          borderLeftWidth: style.borderLeftWidth,
        };
      }),
    ).toEqual({ position: "sticky", borderLeftWidth: "1px" });

    // The page itself never scrolls sideways.
    expect(
      await page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      }),
    ).toBe(0);

    await scroller.evaluate((element: Element): void => {
      element.scrollLeft = 200;
    });
    await screenshot(page, "incidents-rich-scrolled-1280");
  });

  test("a row under the pointer lights up across the stuck column too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${INCIDENTS}?data=rich`);

    const row: Locator = bodyRows(page, "incidents-table").first();

    await row.getByText("Checkout latency above 2 seconds").hover();

    // gray-50, on the row and on its stuck Actions cell alike, once faded in.
    await expect
      .poll(async (): Promise<Array<string>> => {
        return await row.evaluate((element: Element): Array<string> => {
          return [
            getComputedStyle(element).backgroundColor,
            getComputedStyle(element.lastElementChild as Element)
              .backgroundColor,
          ];
        });
      })
      .toEqual(["rgb(249, 250, 251)", "rgb(249, 250, 251)"]);
  });
});

test.describe("the header row stays in sight", () => {
  test("on a long page it sticks to the top while the rows scroll under it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(
      page,
      `${MONITORS}?rows=30&all-monitors-table-view=${encodeURIComponent(
        JSON.stringify({ itemsOnPage: 50 }),
      )}`,
      1280,
      700,
    );

    await expect(bodyRows(page, "Monitors-table")).toHaveCount(34);
    await expect(page.getByTestId("table-scroll")).toHaveAttribute(
      "data-overflowing",
      "false",
    );

    await page.evaluate((): void => {
      window.scrollTo(0, 1200);
    });

    const name: Box = await box(
      page.getByRole("columnheader", { name: "Name" }),
    );

    expect(Math.round(name.y)).toBe(0);
    await expect(
      page.getByRole("columnheader", { name: "Name" }),
    ).toBeInViewport();

    await page.screenshot({
      path: path.join(SCREENSHOTS, "monitors-long-scrolled-synthetic.png"),
      animations: "disabled",
    });
  });

  test("a table whose rows scroll sideways keeps its header in place - it could not follow them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${INCIDENTS}?data=rich&rows=20`, 1280, 700);

    await expect(page.getByTestId("table-scroll")).toHaveAttribute(
      "data-overflowing",
      "true",
    );

    const position: string = await page
      .getByRole("columnheader", { name: "Title" })
      .evaluate((element: Element): string => {
        return getComputedStyle(element).position;
      });

    expect(position).toBe("static");
  });
});

test.describe("a row opens its record", () => {
  test("on a click on its own words", async ({ page }: { page: Page }) => {
    await open(page, MONITORS);

    const row: Locator = bodyRows(page, "Monitors-table").filter({
      hasText: "Checkout API",
    });

    expect(
      await row.evaluate((element: Element): string => {
        return getComputedStyle(element).cursor;
      }),
    ).toBe("pointer");

    await row.getByText("API", { exact: true }).click();

    await expect
      .poll((): string => {
        return pathOf(page);
      })
      .toBe(`${MONITORS}/60000000-0000-4000-8000-000000000002`);
  });

  test("not on its select box, its ⋯ or a menu the ⋯ opens", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, MONITORS);

    const row: Locator = bodyRows(page, "Monitors-table").first();

    await row.getByRole("checkbox").check();
    await row.getByTestId("row-actions-more-button").click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");

    expect((await fixture(page)).navigations).toEqual([]);
    expect(pathOf(page)).toBe(MONITORS);
  });

  test("Cmd or Ctrl opens it in a new tab", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }) => {
    await open(page, MONITORS);

    const opened: Promise<Page> = context.waitForEvent("page");

    await bodyRows(page, "Monitors-table")
      .filter({ hasText: "Marketing Website" })
      .getByText("Website", { exact: true })
      .click({ modifiers: ["ControlOrMeta"] });

    const tab: Page = await opened;

    expect(tab.url()).toContain(
      `/monitors/60000000-0000-4000-8000-000000000003`,
    );
    await tab.close();
    // This page stays where it was.
    expect(pathOf(page)).toBe(MONITORS);
  });

  test("a link inside it goes where the link goes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    await bodyRows(page, "incidents-table")
      .first()
      .getByRole("link", { name: "INC-2" })
      .click();

    await expect
      .poll((): string => {
        return pathOf(page);
      })
      .toBe(`${INCIDENTS}/40000000-0000-4000-8000-000000000002`);
  });

  test("on a phone, a tap on its card", async ({ page }: { page: Page }) => {
    await open(page, MONITORS, 390, 900);

    await page
      .locator("#Monitors-table-body > div")
      .nth(1)
      .getByText("Checkout API")
      .click();

    await expect
      .poll((): string => {
        return pathOf(page);
      })
      .toBe(`${MONITORS}/60000000-0000-4000-8000-000000000002`);
  });
});

test.describe("on a phone", () => {
  test("each row is a card of names over values, nothing past the screen's edge", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${INCIDENTS}?data=rich`, 390, 900);

    const cards: Locator = page.locator("#incidents-table-body > div");

    await expect(cards).toHaveCount(5);
    await expect(cards.first().locator("dt").first()).toHaveText(
      "Incident Number",
    );
    expect(
      await cards
        .first()
        .locator("dd")
        .first()
        .evaluate((element: Element): string => {
          return getComputedStyle(element).fontWeight;
        }),
    ).toBe("500");

    expect(
      await page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      }),
    ).toBe(0);

    await screenshot(page, "incidents-rich-390");
  });

  test("a field with nothing to say is left out, even one a page's own element draws empty", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${GALLERY}?data=rich`, 390, 900);

    const cards: Locator = page.locator("#gallery-kinds-body > div");

    await expect(cards).toHaveCount(4);

    // The names of the fields each card shows, as a reader sees them.
    const shownFields: Array<Array<string>> = await cards.evaluateAll(
      (elements: Array<Element>): Array<Array<string>> => {
        return elements.map((card: Element): Array<string> => {
          return Array.from(card.querySelectorAll("dt"))
            .filter((term: Element): boolean => {
              return (term as HTMLElement).offsetParent !== null;
            })
            .map((term: Element): string => {
              return (term.textContent || "").trim();
            });
        });
      },
    );

    /*
     * No card shows a field that is only a dash: Labels (LabelsElement)
     * with none, a Description never written.
     */
    for (const fields of shownFields) {
      expect(fields).toContain("Name");
    }
    expect(shownFields[0]).not.toContain("Labels");
    expect(shownFields[1]).not.toContain("Description");
    expect(shownFields[1]).not.toContain("Labels");
    // A monitor with labels shows them.
    expect(
      shownFields.some((fields: Array<string>) => {
        return fields.includes("Labels");
      }),
    ).toBe(true);

    // And nothing in a card that is shown is a lone dash.
    expect(
      await cards.evaluateAll((elements: Array<Element>): number => {
        return elements.reduce((count: number, card: Element): number => {
          return (
            count +
            Array.from(card.querySelectorAll("dd")).filter(
              (value: Element): boolean => {
                return (
                  (value as HTMLElement).offsetParent !== null &&
                  value.children.length === 1 &&
                  value.firstElementChild?.getAttribute("data-testid") ===
                    "table-empty-value"
                );
              },
            ).length
          );
        }, 0);
      }),
    ).toBe(0);

    await screenshot(page, "gallery-kinds-rich-390");
  });
});

test.describe("the dark theme", () => {
  test("the header band, its names and a row's values read at WCAG AA", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${MONITORS}?data=rich&theme=dark`);

    const headerCell: Locator = page.getByRole("columnheader", {
      name: "Monitor Type",
    });
    const headerColours: { color: string; background: string } =
      await headerCell.evaluate((element: Element) => {
        const style: CSSStyleDeclaration = getComputedStyle(element);
        return { color: style.color, background: style.backgroundColor };
      });

    expect(
      contrast(headerColours.color, headerColours.background),
    ).toBeGreaterThanOrEqual(4.5);

    const valueCell: Locator = bodyRows(page, "Monitors-table")
      .first()
      .locator("td")
      .nth(2);
    const valueColours: { color: string; background: string } =
      await valueCell.evaluate((element: Element) => {
        return {
          color: getComputedStyle(element).color,
          background: getComputedStyle(element.parentElement as Element)
            .backgroundColor,
        };
      });

    expect(
      contrast(valueColours.color, valueColours.background),
    ).toBeGreaterThanOrEqual(4.5);

    await screenshot(page, "monitors-rich-1280-dark");
  });

  test("the rules between rows are the theme's subtle border", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${MONITORS}?theme=dark`);

    const rule: string = await bodyRows(page, "Monitors-table")
      .first()
      .locator("td")
      .first()
      .evaluate((element: Element): string => {
        return getComputedStyle(element).borderBottomColor;
      });

    // --ou-border-subtle: #334155.
    expect(rule).toBe("rgb(51, 65, 85)");
  });
});

test.describe("while the first page loads", () => {
  test("the rows keep their shape and the header its height", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${TEAMS}?delay=1500`);

    const skeleton: Locator = page.getByTestId("table-skeleton-loader");

    await expect(skeleton).toBeVisible();

    const loadingHeights: Array<number> = await rowHeights(
      skeleton.locator("tr"),
    );

    for (const height of loadingHeights.slice(0, -1)) {
      expect(height).toBe(49);
    }

    await expect(skeleton).toHaveCount(0);
    expect(await rowHeights(bodyRows(page, "teams-table"))).toEqual([
      49, 49, 49, 48,
    ]);
  });
});

test.describe("a list put in order by dragging", () => {
  test("its grips are on the rows' line, and the keyboard still moves a row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ROLES);

    const rows: Locator = bodyRows(page, "network-device-roles-table");

    await expect(rows).toHaveCount(5);
    expect(await rowHeights(rows)).toEqual([49, 49, 49, 49, 48]);

    const grip: Locator = rows.first().getByTestId("drag-handle");

    await grip.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");

    await expect
      .poll(async (): Promise<number> => {
        return (await fixture(page)).updates.length;
      })
      .toBe(1);

    expect((await fixture(page)).updates[0]).toEqual(
      expect.objectContaining({ tableName: "NetworkDeviceRole" }),
    );

    await screenshot(page, "device-roles-1280");
  });
});

test.describe("the gallery", () => {
  test("every kind of column, in both themes and on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [query, width, name] of [
      ["", 1280, "gallery-kinds-1280"],
      ["?theme=dark", 1280, "gallery-kinds-1280-dark"],
      ["?table=wide&data=rich", 1280, "gallery-wide-1280"],
      ["?table=plain", 1280, "gallery-plain-1280"],
      ["", 390, "gallery-kinds-390"],
    ] as Array<[string, number, string]>) {
      await open(page, `${GALLERY}${query}`, width);
      await screenshot(page, name);
    }
  });

  test("Yes is a tick; No, and a value never set, are the quiet dash", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GALLERY);

    const rows: Locator = bodyRows(page, "gallery-kinds");

    await expect(rows.nth(2).getByTestId("table-boolean-yes")).toBeVisible();
    await expect(
      rows.nth(0).locator("td").nth(6).getByTestId("table-empty-value"),
    ).toBeVisible();
    // An empty description.
    await expect(
      rows.nth(1).locator("td").nth(2).getByTestId("table-empty-value"),
    ).toBeVisible();
  });
});
