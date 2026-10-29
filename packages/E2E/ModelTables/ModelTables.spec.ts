import { BrowserContext, expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Tables (ModelTable -> BaseModelTable -> Table) in real Chromium, against
 * the offline fixture (ModelTables/Fixture): the real Incidents list of the
 * maintainer's screenshot, the Alerts list of another (each row's monitor
 * named once, in Affected Resources), Monitors, Status Pages, Teams, a list
 * put in order by dragging (Device Roles) and a gallery of every kind of
 * column.
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
const ALERTS: string = `/dashboard/${PROJECT}/alerts`;
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
  listRequests: Array<{
    tableName: string;
    limit: number;
    query: Record<string, unknown>;
  }>;
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
  await finishFirstPaintTransitions(page);
}

/*
 * The fixture's Tailwind is written in the page as elements appear
 * (tailwind.js), so an element whose classes carry a transition animates
 * into its styles on first paint: the table's search box (transition-all)
 * grows its padding in over 200 ms, and a box read meanwhile is short.
 * Boxes are read once every finite animation has run its course. The
 * product's stylesheet is built ahead of time, so nothing animates there on
 * first paint.
 */
async function finishFirstPaintTransitions(page: Page): Promise<void> {
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

/*
 * The buttons beside an opened search fold away over 300ms (their max-width
 * runs down to none): measured before that, the header has not settled.
 */
async function waitForFoldedButtons(page: Page): Promise<void> {
  const buttons: Locator = page
    .getByTestId("model-table-header-toolbar")
    .locator("> div")
    .last();

  await expect
    .poll(async (): Promise<number> => {
      return Math.round((await box(buttons)).width);
    })
    .toBe(0);
  // And a frame more, for whatever the fold moved.
  await page.waitForTimeout(100);
}

/*
 * The alpha of a computed colour: "rgba(r, g, b, a)", "color(srgb r g b / a)"
 * (a color-mix()), or 1 for one written without it.
 */
function alphaOf(colour: string): number {
  const slash: number = colour.indexOf("/");

  if (slash !== -1) {
    return Number.parseFloat(colour.slice(slash + 1));
  }

  if (colour.startsWith("rgba(")) {
    const parts: Array<string> = colour.slice(5, -1).split(",");
    return Number.parseFloat(parts[3] || "1");
  }

  return 1;
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
        "Affected Resources",
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

/*
 * The maintainer, on the alerts list: "why do we have a monitors column when
 * we have monitors in the affected resources anyway? You can remove them in
 * the UI". The screenshot: a Monitor column naming "oneuptime-test - High
 * Node Memory Utili..." beside Affected Resources naming the same monitor
 * again, then the cluster, on every row. The Monitor column is gone.
 */
test.describe("the Alerts list of the screenshot", () => {
  const ALERT_COLUMNS: Array<string> = [
    "Alert Number",
    "Title",
    "State",
    "Severity",
    "Affected Resources",
    "Created",
    "Duration",
    "Labels",
    "Owners",
  ];

  // The fixture's alerts, newest first, and the monitors they were raised on.
  const FIRST_MONITOR: string = "oneuptime-test - High Node Memory Utilization";
  const PENDING_MONITOR: string = "oneuptime-test - Pod Stuck in Pending";
  const ROW_MONITORS: Array<string> = [
    FIRST_MONITOR,
    "oneuptime-test - Pod CPU Saturating Containers",
    PENDING_MONITOR,
    "oneuptime-test - HPA Saturated at Max Replicas",
  ];
  const CLUSTER: string = "oneuptime-test";
  const PENDING_MONITOR_ID: string = "60000000-0000-4000-8000-000000000013";
  const FIRST_MONITOR_ID: string = "60000000-0000-4000-8000-000000000011";

  function rows(page: Page): Locator {
    return bodyRows(page, "alerts-table");
  }

  /*
   * The columns' names in the header row: not the select box's or the
   * Actions column's, which a screen reader alone hears.
   */
  async function columnTitles(page: Page): Promise<Array<string>> {
    return (await header(page).allInnerTexts())
      .map((title: string): string => {
        return title.trim();
      })
      .filter((title: string): boolean => {
        return (
          title.length > 0 && !["Select all items", "Actions"].includes(title)
        );
      });
  }

  // A row's cell under the column of that name.
  async function cell(
    page: Page,
    row: Locator,
    title: string,
  ): Promise<Locator> {
    const titles: Array<string> = (await header(page).allInnerTexts()).map(
      (text: string): string => {
        return text.trim();
      },
    );
    const index: number = titles.indexOf(title);

    expect(index).toBeGreaterThan(-1);

    return row.locator("> td").nth(index);
  }

  test("each row names its monitor once: no Monitor column, and Affected Resources lists the monitor first, then the cluster", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERTS);

    expect(await columnTitles(page)).toEqual(ALERT_COLUMNS);
    await expect(
      page.getByRole("columnheader", { name: "Monitor", exact: true }),
    ).toHaveCount(0);

    await expect(rows(page)).toHaveCount(6);

    for (const [index, monitorName] of ROW_MONITORS.entries()) {
      const row: Locator = rows(page).nth(index);
      const resources: Locator = (
        await cell(page, row, "Affected Resources")
      ).getByRole("link");

      await expect(resources).toHaveText([monitorName, CLUSTER]);
      // Once in the row, not twice side by side.
      await expect(row.getByText(monitorName, { exact: true })).toHaveCount(1);
    }

    // Each name beside its own type's icon: the monitor's, the cluster's.
    const firstRowLinks: Locator = (
      await cell(page, rows(page).first(), "Affected Resources")
    ).getByRole("link");

    for (const link of await firstRowLinks.all()) {
      await expect(link.locator("svg")).toHaveCount(1);
    }

    await screenshot(page, "alerts-1280");
  });

  test("a monitor named in Affected Resources opens the monitor", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERTS);

    await (await cell(page, rows(page).first(), "Affected Resources"))
      .getByRole("link", { name: FIRST_MONITOR })
      .click();

    await expect
      .poll((): string => {
        return pathOf(page);
      })
      .toBe(`/dashboard/${PROJECT}/monitors/${FIRST_MONITOR_ID}`);
    await expect(page.getByTestId("fixture-trail")).toHaveText("Monitor");
  });

  test("an alert with no monitor names what it is about; one linked to nothing shows the quiet dash", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERTS);

    // Created by hand, about a database.
    await expect(
      (await cell(page, rows(page).nth(4), "Affected Resources")).getByRole(
        "link",
      ),
    ).toHaveText(["ClickHouse default/oneuptime-clickhouse"]);

    const nothing: Locator = await cell(
      page,
      rows(page).nth(5),
      "Affected Resources",
    );

    await expect(nothing.getByRole("link")).toHaveCount(0);
    await expect(nothing.getByTestId("table-empty-value")).toHaveCount(1);
    await expect(nothing.locator(".sr-only")).toHaveText("No resources.");
  });

  /*
   * The column goes, the filter stays: picking a monitor is the Monitor
   * chip's job, and it asks for that monitor's alerts by monitorId.
   */
  test("the Monitor chip still narrows the list to a monitor's alerts", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERTS);

    const bar: Locator = page.getByTestId("facet-filter-bar");

    await bar.getByRole("button", { name: "Monitor", exact: true }).click();
    await page.getByRole("option", { name: PENDING_MONITOR }).click();
    // A click anywhere else puts the chip's list away.
    await page.getByTestId("fixture-trail").click();
    await expect(page.getByRole("listbox")).toHaveCount(0);

    await expect(rows(page)).toHaveCount(1);
    await expect(
      (await cell(page, rows(page).first(), "Affected Resources")).getByRole(
        "link",
      ),
    ).toHaveText([PENDING_MONITOR, CLUSTER]);

    const alertReads: Array<{ query: Record<string, unknown> }> = (
      await fixture(page)
    ).listRequests.filter((request: { tableName: string }): boolean => {
      return request.tableName === "Alert";
    });
    const lastRead: { query: Record<string, unknown> } = alertReads[
      alertReads.length - 1
    ] as { query: Record<string, unknown> };

    expect(JSON.stringify(lastRead.query["monitorId"])).toContain(
      PENDING_MONITOR_ID,
    );
    expect(
      (lastRead.query["monitorId"] as { _type?: string } | undefined)?._type,
    ).toBe("Includes");

    await screenshot(page, "alerts-filtered-by-monitor-1280");
  });

  test("on a phone, each card names its monitor once, under Affected Resources, with no Monitor line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERTS, 390, 900);

    const cards: Locator = page.locator("#alerts-table-body > div");

    await expect(cards).toHaveCount(6);

    const firstCard: Locator = cards.first();
    const fields: Array<string> = (
      await firstCard.locator("dt").allInnerTexts()
    ).map((name: string): string => {
      return name.trim();
    });

    expect(fields).toContain("Affected Resources");
    expect(fields).not.toContain("Monitor");
    await expect(
      firstCard.getByText(FIRST_MONITOR, { exact: true }),
    ).toHaveCount(1);

    expect(
      await page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      }),
    ).toBe(0);

    await screenshot(page, "alerts-390");
  });

  /*
   * How a resource's name is laid out where it is drawn: whether its box
   * holds all of it or ends it in "...", the lines its words take, where
   * each line starts, and where its icon ends.
   */
  interface NameLayout {
    text: string;
    isCutShort: boolean;
    endsInEllipsis: boolean;
    lineLefts: Array<number>;
    iconRight: number;
    itemRight: number;
  }

  async function nameLayout(link: Locator): Promise<NameLayout> {
    return await link.evaluate((element: Element): NameLayout => {
      const item: HTMLElement = element.parentElement as HTMLElement;
      const icon: Element | null = element.querySelector("svg");
      const walker: TreeWalker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
      );
      const lefts: Map<number, number> = new Map();
      let text: string = "";
      let node: Node | null = walker.nextNode();

      while (node) {
        if ((node.textContent || "").trim()) {
          text += (node.textContent || "").trim();
          const range: Range = document.createRange();
          range.selectNodeContents(node);
          // One line per distinct top: Chrome may split a line in parts.
          for (const rect of Array.from(range.getClientRects())) {
            const top: number = Math.round(rect.top);
            lefts.set(top, Math.min(lefts.get(top) ?? rect.left, rect.left));
          }
        }
        node = walker.nextNode();
      }

      return {
        text: text,
        isCutShort: item.scrollWidth > item.clientWidth,
        endsInEllipsis: getComputedStyle(item).textOverflow === "ellipsis",
        lineLefts: Array.from(lefts.keys())
          .sort((a: number, b: number): number => {
            return a - b;
          })
          .map((top: number): number => {
            return Math.round(lefts.get(top) as number);
          }),
        iconRight: icon ? Math.round(icon.getBoundingClientRect().right) : 0,
        itemRight: Math.round(item.getBoundingClientRect().right),
      };
    });
  }

  /*
   * The Monitor field a card had shown the whole name, wrapping. With the
   * column gone, the card names its monitor under Affected Resources only,
   * and that list cut it short - "oneuptime-test - High Node Memory
   * Utili..." - on a screen with no pointer to show the rest.
   */
  test("on a phone, a card names its monitor in full: the name runs onto a second line, which starts beside the icon", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERTS, 390, 900);

    const firstCard: Locator = page.locator("#alerts-table-body > div").first();
    const layout: NameLayout = await nameLayout(
      firstCard.getByRole("link", { name: FIRST_MONITOR }),
    );

    expect(layout.text).toBe(FIRST_MONITOR);
    expect(layout.isCutShort).toBe(false);
    expect(layout.endsInEllipsis).toBe(false);
    // Too long for one line on a phone: two lines, each beside the icon.
    expect(layout.lineLefts).toHaveLength(2);
    expect(
      Math.abs(layout.lineLefts[0]! - layout.lineLefts[1]!),
    ).toBeLessThanOrEqual(1);
    expect(layout.lineLefts[1]!).toBeGreaterThanOrEqual(layout.iconRight);

    // The cluster, short enough, keeps to one line.
    const cluster: NameLayout = await nameLayout(
      firstCard.getByRole("link", { name: CLUSTER, exact: true }),
    );

    expect(cluster.lineLefts).toHaveLength(1);
    expect(cluster.isCutShort).toBe(false);
  });

  test("on a phone, a monitor's name with nowhere to break breaks anyway, and nothing passes the screen's edge", async ({
    page,
  }: {
    page: Page;
  }) => {
    const LONG_MONITOR: string =
      "oneuptime-test - KubeNodeMemoryUtilizationHighOnGeneralPurposePoolNodesInEuWest1";

    await open(page, `${ALERTS}?data=long`, 390, 900);

    const layout: NameLayout = await nameLayout(
      page
        .locator("#alerts-table-body > div")
        .first()
        .getByRole("link", { name: LONG_MONITOR }),
    );

    expect(layout.text).toBe(LONG_MONITOR);
    expect(layout.isCutShort).toBe(false);
    expect(layout.lineLefts.length).toBeGreaterThanOrEqual(3);
    expect(layout.itemRight).toBeLessThanOrEqual(390);
    expect(
      await page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      }),
    ).toBe(0);

    await screenshot(page, "alerts-long-390");
  });

  test("on a laptop, a monitor's name cut short at its column's end shows in full under the pointer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERTS);

    const link: Locator = (
      await cell(page, rows(page).first(), "Affected Resources")
    ).getByRole("link", { name: FIRST_MONITOR });
    const layout: NameLayout = await nameLayout(link);

    // A row keeps each name to its one line, ending in "...".
    expect(layout.lineLefts).toHaveLength(1);
    expect(layout.isCutShort).toBe(true);
    expect(layout.endsInEllipsis).toBe(true);

    await link.hover();

    await expect(link.locator("xpath=..")).toHaveAttribute(
      "title",
      FIRST_MONITOR,
    );
  });

  /*
   * With the column gone, the Monitor chip is how a list of one monitor's
   * alerts is asked for. A chip said its whole value on one line that could
   * not shrink: on a phone, "Monitor · oneuptime-test - High Node Memory
   * Utilization" ran past the card's edge, and the page scrolled sideways.
   */
  test("on a phone, the Monitor chip with a monitor picked stays inside the card: its words end in '...', the whole of them under the pointer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERTS, 390, 900);

    const bar: Locator = page.getByTestId("facet-filter-bar");

    await bar.getByRole("button", { name: "Monitor", exact: true }).click();
    await page.getByRole("option", { name: FIRST_MONITOR }).click();
    await page.getByTestId("fixture-trail").click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(page.locator("#alerts-table-body > div")).toHaveCount(1);

    const chip: Locator = bar
      .getByTestId("filter-chip")
      .filter({ hasText: FIRST_MONITOR });
    const chipBox: Box = await box(chip);
    const barBox: Box = await box(bar);

    expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(
      barBox.x + barBox.width + 1,
    );
    expect(
      await page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      }),
    ).toBe(0);

    // Its words: the chip's name and the monitor, cut short at the bar's end.
    const words: Locator = chip.locator("span.truncate").first();
    const cut: { text: string; isCutShort: boolean; ellipsis: string } =
      await words.evaluate((element: Element) => {
        return {
          text: (element as HTMLElement).innerText,
          isCutShort: element.scrollWidth > element.clientWidth,
          ellipsis: getComputedStyle(element).textOverflow,
        };
      });

    expect(cut.text).toBe(`Monitor · ${FIRST_MONITOR}`);
    expect(cut.isCutShort).toBe(true);
    expect(cut.ellipsis).toBe("ellipsis");

    // The clear button keeps its place inside the pill.
    const clearBox: Box = await box(
      chip.getByRole("button", { name: "Clear Monitor filter" }),
    );

    expect(clearBox.x + clearBox.width).toBeLessThanOrEqual(
      chipBox.x + chipBox.width,
    );

    await words.hover();

    await expect(words).toHaveAttribute("title", `Monitor · ${FIRST_MONITOR}`);

    await screenshot(page, "alerts-filtered-by-monitor-390");
  });

  test("in the dark theme, the monitor's and the cluster's names read at WCAG AA", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${ALERTS}?theme=dark`);

    const resources: Locator = await cell(
      page,
      rows(page).first(),
      "Affected Resources",
    );

    for (const link of await resources.getByRole("link").all()) {
      const colours: { color: string; background: string } =
        await link.evaluate((element: Element) => {
          // The first box behind the name that paints a background.
          let behind: Element | null = element;
          let background: string = "rgba(0, 0, 0, 0)";
          while (behind) {
            background = getComputedStyle(behind).backgroundColor;
            if (background !== "rgba(0, 0, 0, 0)") {
              break;
            }
            behind = behind.parentElement;
          }
          return { color: getComputedStyle(element).color, background };
        });

      expect(
        contrast(colours.color, colours.background),
      ).toBeGreaterThanOrEqual(4.5);
    }

    await screenshot(page, "alerts-1280-dark");
  });
});

test.describe("rows are 48px whatever they hold", () => {
  test("text, pills, a label, avatars, a dash and the row's buttons all sit on the 24px line; more labels add a line each", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${MONITORS}?data=rich`);

    const rows: Locator = bodyRows(page, "Monitors-table");

    await expect(rows).toHaveCount(4);

    /*
     * 48px and the hairline under every row but the last; a row's labels
     * are listed one under another (OneUptime issue #5187), so each label
     * after the first adds its 24px line and the 4px between two: the
     * second row's two labels make it 28px taller, the last row's four 84.
     */
    expect(await rowHeights(rows)).toEqual([49, 49 + 28, 49, 48 + 3 * 28]);

    // The labels of a monitor with four: all four, one under another, in natural order.
    const ping: Locator = rows.nth(3);

    await expect(
      ping.getByTestId("table-labels").getByTestId("pill"),
    ).toHaveText(["Customer facing", "Database", "EU West", "Production"]);
    await expect(ping.getByTestId("table-labels-more")).toHaveCount(0);

    await screenshot(page, "monitors-rich-1280");
  });

  test("'N more labels' shows every label in the cell, in order, and 'Show less' folds them again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${MONITORS}?data=labels`);

    // "Assign loyalty card": five labels, handed over in a scrambled order.
    const assign: Locator = bodyRows(page, "Monitors-table").nth(3);
    const pills: Locator = assign
      .getByTestId("table-labels")
      .getByTestId("pill");

    await expect(pills).toHaveText([
      "1.Category=Application",
      "2.SubCategory=Website",
      "3.Item=Connectivity",
    ]);
    await expect(assign.getByTestId("table-labels-more")).toHaveText(
      "2 more labels",
    );

    await assign.getByTestId("table-labels-more").click();
    await expect(pills).toHaveText([
      "1.Category=Application",
      "2.SubCategory=Website",
      "3.Item=Connectivity",
      "4.Business System=Customer Mobile App",
      "10.Owner=Loyalty Platform Team",
    ]);

    // Opening the labels is the labels' click, not the row's.
    expect((await fixture(page)).navigations).toEqual([]);

    await assign.getByTestId("table-labels-less").click();
    await expect(pills).toHaveCount(3);
    await expect(assign.getByTestId("table-labels-more")).toBeVisible();
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

  test("a page's own text-sm value is on the row's 24px line, level with the words beside it; a pill keeps its own height", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${ROLES}?data=rich`, 1440);

    const row: Locator = page
      .locator("#network-device-roles-table-body > tr")
      .first();
    const cells: Locator = row.locator("td");

    /*
     * Device Roles draws its key as <span className="text-sm font-mono">:
     * text-sm's 20px line, set at the top of the row's 24px one, stood 2px
     * above the name beside it.
     */
    const key: Locator = cells.nth(3).locator("> div > span").first();
    await expect(key).toHaveText("router");

    const lines: { key: string; pill: string } = await row.evaluate(
      (element: Element): { key: string; pill: string } => {
        const tds: Array<Element> = Array.from(element.children);
        const keySpan: Element = tds[3]!.querySelector(
          ":scope > div > span",
        ) as Element;
        const pill: Element = tds[6]!.querySelector(
          ":scope > div > *",
        ) as Element;

        return {
          key: getComputedStyle(keySpan).lineHeight,
          pill: getComputedStyle(pill).lineHeight,
        };
      },
    );

    expect(lines.key).toBe("24px");
    // The Layer pill is laid out as a box of its own: its own line.
    expect(lines.pill).not.toBe("24px");

    // Its words sit level with the name's (fonts apart, within a pixel).
    const middleOf: (cell: Locator) => Promise<number> = async (
      cell: Locator,
    ): Promise<number> => {
      return await cell.evaluate((element: Element): number => {
        const range: Range = document.createRange();
        range.selectNodeContents(element);
        const rect: DOMRect | undefined = Array.from(range.getClientRects())
          .filter((candidate: DOMRect): boolean => {
            return candidate.width > 0;
          })
          .pop();

        return rect ? rect.top + rect.height / 2 : Number.NaN;
      });
    };

    const keyMiddle: number = await middleOf(key);
    const nameMiddle: number = await middleOf(cells.nth(2).locator("> div"));

    expect(Math.abs(keyMiddle - nameMiddle)).toBeLessThanOrEqual(1);
  });
});

/*
 * OneUptime issues #5187 and #5183: the Monitors list of a customer who
 * numbers their labels ("1.Category=...", "2.SubCategory=...",
 * "3.Item=...", "4.Business System=..."). Side by side on the row's one
 * line, the labels ran past the column's edge, cut off mid-word, in
 * whatever order the database joined them. Now each row's labels are
 * listed one under another, as Affected Resources lists a row's resources,
 * in natural order - numbered labels first, by their numbers - and none is
 * cut off: a label is as wide as its name, up to the 20rem a value takes,
 * and only a longer one ends in "...", its whole name under the pointer.
 * On a phone, where nothing points, a long label runs onto a next line.
 */
test.describe("a row's labels, one under another, in natural order", () => {
  type PillBox = {
    text: string;
    top: number;
    bottom: number;
    left: number;
    right: number;
    isCut: boolean;
    textOverflow: string;
  };

  // The pills of a row's (or a card's) labels, as drawn.
  async function pillBoxes(row: Locator): Promise<Array<PillBox>> {
    return await row
      .getByTestId("table-labels")
      .getByTestId("pill")
      .evaluateAll((pills: Array<Element>): Array<PillBox> => {
        return pills.map((pill: Element): PillBox => {
          const box: DOMRect = pill.getBoundingClientRect();
          const words: Element = pill.querySelector(
            "[data-testid='pill-text']",
          ) as Element;

          return {
            text: (pill.textContent || "").trim(),
            top: box.top,
            bottom: box.bottom,
            left: box.left,
            right: box.right,
            isCut: words.scrollWidth > words.clientWidth,
            textOverflow: getComputedStyle(words).textOverflow,
          };
        });
      });
  }

  for (const theme of ["light", "dark"]) {
    test(`the Monitors list of the issues, at 1280 in the ${theme} theme: each row's labels one under another, in order`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(
        page,
        `${MONITORS}?data=labels${theme === "dark" ? "&theme=dark" : ""}`,
      );

      const rows: Locator = bodyRows(page, "Monitors-table");

      await expect(rows).toHaveCount(6);

      const expected: Array<Array<string>> = [
        ["Claude"],
        [
          "1.Category=Application",
          "2.SubCategory=Website",
          "3.Item=Connectivity",
          "4.Business System=Customer Mobile App",
        ],
        [
          "3.Item=Connectivity",
          "4.Business System=Customer Mobile App",
          "5.Escalation=Loyalty Platform Engineering, Customer Mobile App Integrations",
        ],
        [
          "1.Category=Application",
          "2.SubCategory=Website",
          "3.Item=Connectivity",
        ],
        [
          "2.SubCategory=Website",
          "5.Escalation=Loyalty Platform Engineering, Customer Mobile App Integrations",
        ],
        [],
      ];

      for (let index: number = 0; index < expected.length; index++) {
        const row: Locator = rows.nth(index);
        const boxes: Array<PillBox> = await pillBoxes(row);

        expect(
          boxes.map((box: PillBox): string => {
            return box.text;
          }),
        ).toEqual(expected[index]);

        for (let place: number = 1; place < boxes.length; place++) {
          // Under the one before - on a line of its own, never beside it.
          expect(
            boxes[place]!.top - boxes[place - 1]!.bottom,
          ).toBeGreaterThanOrEqual(4);
          expect(Math.abs(boxes[place]!.left - boxes[0]!.left)).toBeLessThan(1);
        }
      }

      // A monitor without labels: the quiet dash.
      const labelsColumn: number = (
        await page.locator("thead th").allInnerTexts()
      ).findIndex((title: string): boolean => {
        return title.trim() === "Labels";
      });

      expect(labelsColumn).toBeGreaterThan(0);
      await expect(
        rows
          .nth(5)
          .locator("td")
          .nth(labelsColumn)
          .getByTestId("table-empty-value"),
      ).toHaveCount(1);

      await screenshot(page, `monitors-labels-1280-${theme}`);
    });
  }

  test("nothing is cut off: a label is as wide as its name, and only one longer than the column ends in '...', whole under the pointer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${MONITORS}?data=labels`);

    const rows: Locator = bodyRows(page, "Monitors-table");
    const column: { left: number; right: number } = await page
      .locator("thead th")
      .filter({ hasText: "Labels" })
      .evaluate((header: Element): { left: number; right: number } => {
        const box: DOMRect = header.getBoundingClientRect();
        return { left: box.left, right: box.right };
      });
    const longName: string =
      "5.Escalation=Loyalty Platform Engineering, Customer Mobile App Integrations";

    for (let index: number = 0; index < 5; index++) {
      for (const box of await pillBoxes(rows.nth(index))) {
        // Inside its column, never past its edge.
        expect(box.left).toBeGreaterThanOrEqual(column.left);
        expect(box.right).toBeLessThanOrEqual(column.right + 0.5);

        // The customer's longest: whole.
        if (box.text !== longName) {
          expect([box.text, box.isCut]).toEqual([box.text, false]);
        } else {
          // At the 20rem a value takes, ending in an ellipsis.
          expect(box.isCut).toBe(true);
          expect(box.textOverflow).toBe("ellipsis");
          expect(Math.round(box.right - box.left)).toBe(320);
        }
      }
    }

    // The longest of the issue's labels, whole, not at the cap.
    const business: PillBox = (await pillBoxes(rows.nth(1)))[3]!;
    expect(business.text).toBe("4.Business System=Customer Mobile App");
    expect(business.right - business.left).toBeLessThan(320);

    const cut: Locator = rows
      .nth(2)
      .getByTestId("table-labels")
      .getByTestId("pill-text")
      .filter({ hasText: "5.Escalation" });

    await cut.hover();
    await expect(cut).toHaveAttribute("title", longName);
  });

  test("the Labels facet offers the labels in the same order, numbered ones first", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${MONITORS}?data=labels`);

    await page
      .getByRole("button", { name: /^Labels/ })
      .first()
      .click();
    // Read once the labels have come.
    await expect(page.getByRole("option", { name: "Claude" })).toBeVisible();

    const options: Array<string> = (
      await page.getByRole("option").allInnerTexts()
    ).map((text: string): string => {
      return text.trim();
    });
    const labels: Array<string> = options.filter((text: string): boolean => {
      return [
        "1.Category=Application",
        "2.SubCategory=Website",
        "3.Item=Connectivity",
        "4.Business System=Customer Mobile App",
        "10.Owner=Loyalty Platform Team",
        "Claude",
        "Production",
      ].includes(text);
    });

    expect(labels).toEqual([
      "1.Category=Application",
      "2.SubCategory=Website",
      "3.Item=Connectivity",
      "4.Business System=Customer Mobile App",
      "10.Owner=Loyalty Platform Team",
      "Claude",
      "Production",
    ]);

    // Asked for by name: the server reads labels by name in natural order.
    const asked: Array<unknown> = (await fixture(page)).listRequests
      .filter((request: { tableName: string }): boolean => {
        return request.tableName === "Label";
      })
      .map((request: unknown): unknown => {
        return (request as { sort: unknown }).sort;
      });

    expect(asked).toContainEqual({ name: "ASC" });
  });

  for (const theme of ["light", "dark"]) {
    test(`on a phone in the ${theme} theme, a card lists them one under another and a long one runs onto a next line`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(
        page,
        `${GALLERY}?data=labels${theme === "dark" ? "&theme=dark" : ""}`,
        390,
        900,
      );

      // The gallery's third row: "Loyalty web service", three labels.
      const card: Locator = page.locator("#gallery-kinds-body > div").nth(2);
      const boxes: Array<PillBox> = await pillBoxes(card);

      expect(
        boxes.map((box: PillBox): string => {
          return box.text;
        }),
      ).toEqual([
        "3.Item=Connectivity",
        "4.Business System=Customer Mobile App",
        "5.Escalation=Loyalty Platform Engineering, Customer Mobile App Integrations",
      ]);

      for (let place: number = 1; place < boxes.length; place++) {
        expect(
          boxes[place]!.top - boxes[place - 1]!.bottom,
        ).toBeGreaterThanOrEqual(4);
      }

      // Nothing cut off, and nothing past the screen's edge.
      for (const box of boxes) {
        expect([box.text, box.isCut]).toEqual([box.text, false]);
        expect(box.right).toBeLessThanOrEqual(390);
      }

      // The long one takes two lines; the short ones one.
      const long: PillBox = boxes[2]!;
      expect(long.bottom - long.top).toBeGreaterThan(30);
      expect(boxes[0]!.bottom - boxes[0]!.top).toBeLessThan(26);

      await screenshot(page, `gallery-labels-390-${theme}`);
    });
  }

  /*
   * "2 more labels" was a padded grey button: 36px tall, a gap above it and
   * another under it, in a grey (gray-400) that read at 2.5:1. It is the
   * product's show-more link now, on a 24px line of its own - the line a
   * label takes - so a row of five labels folded is as tall as a row of
   * four.
   */
  type ListLine = { top: number; bottom: number; left: number };

  async function listLines(row: Locator): Promise<Array<ListLine>> {
    return await row
      .getByTestId("table-labels")
      .evaluate((list: Element): Array<ListLine> => {
        return Array.from(list.children).map((line: Element): ListLine => {
          const lineBox: DOMRect = line.getBoundingClientRect();
          return {
            top: lineBox.top,
            bottom: lineBox.bottom,
            left: lineBox.left,
          };
        });
      });
  }

  for (const theme of ["light", "dark"]) {
    test(`'N more labels' is a link on a line of its own under the labels, at WCAG AA in the ${theme} theme`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(
        page,
        `${MONITORS}?data=labels${theme === "dark" ? "&theme=dark" : ""}`,
      );

      const rows: Locator = bodyRows(page, "Monitors-table");
      const assign: Locator = rows.nth(3);
      const more: Locator = assign.getByTestId("table-labels-more");

      await expect(more).toHaveText("2 more labels");
      await expect(more).toHaveAttribute("aria-expanded", "false");

      // Three labels and the link: four 24px lines, 4px apart.
      const lines: Array<ListLine> = await listLines(assign);

      expect(lines).toHaveLength(4);

      for (let place: number = 0; place < lines.length; place++) {
        expect(Math.round(lines[place]!.bottom - lines[place]!.top)).toBe(24);

        if (place > 0) {
          expect(Math.round(lines[place]!.top - lines[place - 1]!.bottom)).toBe(
            4,
          );
        }
      }

      // Folded, five labels take the room of four (the row above has four).
      const heights: Array<number> = await rowHeights(rows);
      expect(heights[3]).toBe(heights[1]);

      // Its box starts where the labels do, its words just inside it.
      const firstPill: Box = await box(
        assign.getByTestId("table-labels").getByTestId("pill").first(),
      );
      const link: Box = await box(more);

      expect(Math.abs(link.x - firstPill.x)).toBeLessThan(1);
      expect(Math.round(link.height)).toBe(20);

      const look: {
        color: string;
        background: string;
        fontSize: string;
        fontWeight: string;
      } = await more.evaluate((element: Element) => {
        // The first box behind the words that paints a background.
        let behind: Element | null = element;
        let background: string = "rgba(0, 0, 0, 0)";
        while (behind) {
          background = getComputedStyle(behind).backgroundColor;
          if (background !== "rgba(0, 0, 0, 0)") {
            break;
          }
          behind = behind.parentElement;
        }
        const style: CSSStyleDeclaration = getComputedStyle(element);
        return {
          color: style.color,
          background,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
        };
      });

      expect(contrast(look.color, look.background)).toBeGreaterThanOrEqual(4.5);
      expect(look.fontSize).toBe("12px");
      expect(Number(look.fontWeight)).toBeGreaterThanOrEqual(500);

      await screenshot(page, `monitors-labels-more-1280-${theme}`);
    });
  }

  test("the keyboard opens and folds a row's labels and stays on the link, its ring whole inside the column", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${MONITORS}?data=labels`);

    const assign: Locator = bodyRows(page, "Monitors-table").nth(3);
    const pills: Locator = assign
      .getByTestId("table-labels")
      .getByTestId("pill");
    const more: Locator = assign.getByTestId("table-labels-more");

    // Tab to it, as a keyboard does (a focus by script draws no ring).
    for (let step: number = 0; step < 80; step++) {
      await page.keyboard.press("Tab");

      if (
        await more.evaluate((element: Element): boolean => {
          return element === document.activeElement;
        })
      ) {
        break;
      }
    }

    await expect(more).toBeFocused();

    /*
     * The ring is drawn inside the link's box, and the box inside the
     * column's clip: a ring outside it lost its left side at the edge.
     */
    const ring: { shadow: string; left: number; clipLeft: number } =
      await more.evaluate((element: Element) => {
        let clip: Element | null = element.parentElement;
        while (clip && getComputedStyle(clip).overflowX !== "clip") {
          clip = clip.parentElement;
        }
        return {
          shadow: getComputedStyle(element).boxShadow,
          left: element.getBoundingClientRect().left,
          clipLeft: clip ? clip.getBoundingClientRect().left : -1,
        };
      });

    expect(ring.shadow).toContain("inset");
    expect(ring.clipLeft).toBeGreaterThan(0);
    expect(ring.left).toBeGreaterThanOrEqual(ring.clipLeft - 0.5);

    await page.keyboard.press("Enter");

    // Open: every label, and the same link - still focused - folds them.
    await expect(pills).toHaveCount(5);
    const less: Locator = assign.getByTestId("table-labels-less");
    await expect(less).toBeFocused();
    await expect(less).toHaveText("Show less");
    await expect(less).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Enter");

    await expect(pills).toHaveCount(3);
    await expect(more).toBeFocused();
    await expect(more).toHaveAttribute("aria-expanded", "false");

    // The labels' own keys, never the row's: nothing opened.
    expect((await fixture(page)).navigations).toEqual([]);
  });

  test("on a phone, a card with five labels shows three and '2 more labels', which shows them all", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${GALLERY}?data=labels`, 390, 900);

    // The gallery's fourth row: "Assign loyalty card", five labels.
    const card: Locator = page.locator("#gallery-kinds-body > div").nth(3);
    const pills: Locator = card.getByTestId("table-labels").getByTestId("pill");
    const more: Locator = card.getByTestId("table-labels-more");

    await expect(pills).toHaveText([
      "1.Category=Application",
      "2.SubCategory=Website",
      "3.Item=Connectivity",
    ]);
    await expect(more).toHaveText("2 more labels");

    const lines: Array<ListLine> = await listLines(card);
    expect(lines).toHaveLength(4);
    expect(Math.round(lines[3]!.bottom - lines[3]!.top)).toBe(24);
    expect(Math.round(lines[3]!.top - lines[2]!.bottom)).toBe(4);

    await more.click();

    await expect(pills).toHaveText([
      "1.Category=Application",
      "2.SubCategory=Website",
      "3.Item=Connectivity",
      "4.Business System=Customer Mobile App",
      "10.Owner=Loyalty Platform Team",
    ]);
    await expect(card.getByTestId("table-labels-less")).toHaveText("Show less");

    // Nothing past the screen's edge, and the tap opened nothing else.
    const sideways: number = await page.evaluate((): number => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });
    expect(sideways).toBeLessThanOrEqual(0);
    expect((await fixture(page)).navigations).toEqual([]);

    await screenshot(page, "gallery-labels-open-390");
  });

  test("in German the fold reads '2 weitere Beschriftungen', in the words of the column's title", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${MONITORS}?data=labels&lang=de`);

    await expect(
      page.locator("thead th").filter({ hasText: "Beschriftungen" }),
    ).toHaveCount(1);
    await expect(
      bodyRows(page, "Monitors-table").nth(3).getByTestId("table-labels-more"),
    ).toHaveText("2 weitere Beschriftungen");
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

  /*
   * Its row's View is "View" now, not "View Status Page": 900px fits too,
   * and the rows scroll from below about 860px.
   */
  test("at 820px even 10rem does not fit: the rows scroll, and the name is back at its cap", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGES}?data=long`, 820);

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
      [820, "true", "false"],
      [1000, "false", "true"],
      [800, "true", "false"],
      [1280, "false", "true"],
    ] as Array<[number, string, string]>) {
      await page.setViewportSize({ width: width, height: 900 });
      await expect(scrollBox).toHaveAttribute("data-overflowing", overflowing);
      await expect(name).toHaveAttribute("data-fill", fill);
    }

    // A window's edge dragged across both, a few pixels a frame, and back.
    for (let width: number = 1280; width >= 800; width -= 7) {
      await page.setViewportSize({ width: width, height: 900 });
    }
    for (let width: number = 800; width <= 1280; width += 9) {
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

  test("a person - a picture beside a name over an email - keeps its cap and its lines; a long name ends in an ellipsis, whole under the pointer", async ({
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

    /*
     * The long name is still one line, and as tall as a short one. An
     * ellipsis splits a line's text into fragments of its own, so the
     * lines are counted by where their fragments sit, not how many there
     * are.
     */
    const nameLine: Locator = rows.nth(3).getByTestId("user-name-line");
    const nameLineTops: Array<number> = await nameLine.evaluate(
      (element: Element): Array<number> => {
        const range: Range = document.createRange();
        range.selectNodeContents(element);

        return Array.from(range.getClientRects())
          .filter((rect: DOMRect): boolean => {
            return rect.width > 0;
          })
          .map((rect: DOMRect): number => {
            return Math.round(rect.top);
          });
      },
    );
    expect(new Set(nameLineTops).size).toBe(1);

    const short: NameMeasure = await measureName(
      rows.nth(0).locator("td").nth(1).locator("> div"),
    );
    expect(Math.round(measure.height)).toBe(Math.round(short.height));

    /*
     * It used to be cut off mid-letter by the cell's clip, no sign there
     * was more: the name line ends in an ellipsis inside its cell now.
     */
    const cut: { textOverflow: string; isCut: boolean; right: number } =
      await nameLine.evaluate(
        (
          element: Element,
        ): { textOverflow: string; isCut: boolean; right: number } => {
          return {
            textOverflow: getComputedStyle(element).textOverflow,
            isCut: element.scrollWidth > element.clientWidth,
            right: element.getBoundingClientRect().right,
          };
        },
      );
    expect(cut.textOverflow).toBe("ellipsis");
    expect(cut.isCut).toBe(true);
    const cell: Box = await box(person);
    expect(cut.right).toBeLessThanOrEqual(cell.x + cell.width + 1);

    // The whole name - and the email under it - under the pointer.
    await person.hover();
    await expect(person).toHaveAttribute(
      "title",
      /^Maximiliana Alexandrina Featherstonehaugh-Cholmondeley of the Platform Reliability Guild\s+maximiliana@acme-commerce\.example$/,
    );

    // A short name is not cut, and gets no tooltip repeating it.
    const shortPerson: Locator = rows
      .nth(0)
      .locator("td")
      .nth(1)
      .locator("> div");
    await shortPerson.hover();
    await expect(shortPerson).not.toHaveAttribute("title", /.+/);

    await screenshot(page, "gallery-people-1280");
  });
});

/*
 * "Tables that run past their card": beside a side menu at 1280px a card is
 * about 938px wide, and table after table ran its rows under the sticky
 * Actions column for a header of two words or a name 30px too long. A table
 * now gives way before it scrolls - its header's names break between their
 * words, then its long values are cut short a little more, never below 8rem
 * - and scrolls as before only when that is not enough. The gallery's give
 * table (?table=give) is a list of hosts just too wide for such a card; the
 * Shell around it is 64px narrower than the window, so a 1002px window gives
 * the 938px of a card at 1280 beside a side menu.
 */
test.describe("a table gives way before its rows scroll", () => {
  const GIVE: string = `${GALLERY}?table=give`;

  interface GiveReading {
    overflowing: string | null;
    wrapsHeaders: boolean;
    gives: Array<string | null>;
    hostWidths: Array<number>;
    headerHeight: number;
    tableWidth: number;
    boxWidth: number;
  }

  async function readGive(page: Page): Promise<GiveReading> {
    return await page.evaluate((): GiveReading => {
      const box: Element = document.querySelector(
        '[data-testid="table-scroll"]',
      ) as Element;
      const table: HTMLTableElement = box.querySelector(
        "table",
      ) as HTMLTableElement;
      const hosts: Array<HTMLElement> = Array.from(
        document.querySelectorAll<HTMLElement>(
          "#gallery-give-body > tr > td:nth-child(3) > div",
        ),
      );

      return {
        overflowing: box.getAttribute("data-overflowing"),
        wrapsHeaders: table.getAttribute("data-wrap-headers") === "true",
        gives: hosts.map((host: HTMLElement): string | null => {
          return host.getAttribute("data-give");
        }),
        hostWidths: hosts.map((host: HTMLElement): number => {
          return Math.round(host.getBoundingClientRect().width);
        }),
        headerHeight: Math.round(
          (table.querySelector("thead tr") as Element).getBoundingClientRect()
            .height,
        ),
        tableWidth: Math.round(table.getBoundingClientRect().width),
        boxWidth: Math.round(box.getBoundingClientRect().width),
      };
    });
  }

  function giveRows(page: Page): Locator {
    return bodyRows(page, "gallery-give");
  }

  async function expectRowButtonsOnTheCard(page: Page): Promise<void> {
    const card: Box = await box(page.getByTestId("card").first());

    for (const view of await giveRows(page)
      .getByRole("button", { name: "View Monitor" })
      .all()) {
      const button: Box = await box(view);
      expect(button.x + button.width).toBeLessThanOrEqual(card.x + card.width);
    }
  }

  test("wide enough, it is drawn as it is: its header on one line, every value whole", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GIVE, 1280);
    await expect(giveRows(page)).toHaveCount(4);

    const reading: GiveReading = await readGive(page);

    expect(reading.overflowing).toBe("false");
    expect(reading.wrapsHeaders).toBe(false);
    expect(reading.gives).toEqual([null, null, null, null]);
    // One line of 12px names on the band, its two rules.
    expect(reading.headerHeight).toBeLessThanOrEqual(39);
  });

  test("a little too wide, its header's names break between their words - and nothing is cut short", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GIVE, 1120);
    await expect(giveRows(page)).toHaveCount(4);

    const reading: GiveReading = await readGive(page);

    expect(reading.overflowing).toBe("false");
    expect(reading.wrapsHeaders).toBe(true);
    expect(reading.gives).toEqual([null, null, null, null]);
    expect(reading.tableWidth).toBeLessThanOrEqual(reading.boxWidth);

    // "Poll Interval (Minutes)" over a 5: on two lines, never inside a word.
    const poll: Locator = header(page).filter({
      hasText: "Poll Interval (Minutes)",
    });
    const lines: Array<number> = await poll
      .locator("span")
      .first()
      .evaluate((element: Element): Array<number> => {
        const range: Range = document.createRange();
        range.selectNodeContents(element);
        return Array.from(range.getClientRects())
          .filter((rect: DOMRect): boolean => {
            return rect.width > 0;
          })
          .map((rect: DOMRect): number => {
            return Math.round(rect.top);
          });
      });
    expect(new Set(lines).size).toBeGreaterThan(1);
    expect(reading.headerHeight).toBeGreaterThan(39);

    await expectRowButtonsOnTheCard(page);
    await screenshot(page, "gallery-give-1120");
  });

  test("too wide for that - the card beside a side menu at 1280px - its long host names are cut short, never below 8rem, whole under the pointer; its date, count and status stay whole", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GIVE, 1002);
    await expect(giveRows(page)).toHaveCount(4);

    const reading: GiveReading = await readGive(page);

    expect(reading.overflowing).toBe("false");
    expect(reading.wrapsHeaders).toBe(true);
    expect(reading.gives).toEqual(["line", "line", "line", "line"]);
    expect(reading.tableWidth).toBeLessThanOrEqual(reading.boxWidth);

    for (const width of reading.hostWidths) {
      expect(width).toBeGreaterThanOrEqual(128);
      expect(width).toBeLessThan(320);
    }

    // One line of each host, cut short where its column ends.
    const host: Locator = giveRows(page)
      .nth(0)
      .locator("td")
      .nth(2)
      .locator("> div");
    const cut: { lineClamp: string; height: number; isCut: boolean } =
      await host.evaluate(
        (
          element: Element,
        ): { lineClamp: string; height: number; isCut: boolean } => {
          return {
            lineClamp: getComputedStyle(element).webkitLineClamp,
            height: Math.round(element.getBoundingClientRect().height),
            isCut: element.scrollHeight > element.clientHeight,
          };
        },
      );
    expect(cut).toEqual({ lineClamp: "1", height: 24, isCut: true });
    // Every row keeps its 48px.
    expect(new Set(await rowHeights(giveRows(page)))).toEqual(
      new Set([49, 48]),
    );

    await host.hover();
    await expect(host).toHaveAttribute(
      "title",
      "web-prod-03.eu-west-1.acme-commerce.internal",
    );

    // A date, a count and a status are never cut short.
    for (const column of [3, 4, 5]) {
      const value: Locator = giveRows(page)
        .nth(0)
        .locator("td")
        .nth(column)
        .locator("> div");
      await expect(value).not.toHaveAttribute("data-give", /.+/);
      expect(
        await value.evaluate((element: Element): boolean => {
          return element.scrollWidth <= element.clientWidth;
        }),
      ).toBe(true);
    }

    await expectRowButtonsOnTheCard(page);
    await expect(
      page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      }),
    ).resolves.toBe(0);
    await screenshot(page, "gallery-give-1002");
  });

  /*
   * A value cut short shows its first line to its column's end, the "..."
   * where the room runs out, as a value cut with an ellipsis does. Broken
   * only between words, "web-prod-03.eu-west-1.acme-commerce.internal"
   * ended at "web-prod-03.eu-west-..." with a third of its column empty,
   * and each host was cut at a different width.
   */
  test("a value cut short runs to its column's end: never short at a hyphen or a space", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GIVE, 1002);
    await expect(giveRows(page)).toHaveCount(4);

    const lines: Array<{ give: string | null; box: number; gap: number }> =
      await page.evaluate(
        (): Array<{ give: string | null; box: number; gap: number }> => {
          return Array.from(
            document.querySelectorAll<HTMLElement>(
              "#gallery-give-body > tr > td:nth-child(3) > div",
            ),
          ).map((host: HTMLElement) => {
            const range: Range = document.createRange();
            range.selectNodeContents(host);
            const parts: Array<DOMRect> = Array.from(
              range.getClientRects(),
            ).filter((rect: DOMRect): boolean => {
              return rect.width > 0;
            });
            // The first line: the parts that sit highest.
            const top: number = Math.min(
              ...parts.map((rect: DOMRect): number => {
                return Math.round(rect.top);
              }),
            );
            const right: number = Math.max(
              ...parts
                .filter((rect: DOMRect): boolean => {
                  return Math.round(rect.top) === top;
                })
                .map((rect: DOMRect): number => {
                  return rect.right;
                }),
            );
            const box: DOMRect = host.getBoundingClientRect();

            return {
              give: host.getAttribute("data-give"),
              box: Math.round(box.width),
              gap: Math.round(box.right - right),
            };
          });
        },
      );

    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line.give).toBe("line");
      // No more empty than an ellipsis is wide.
      expect(line.gap).toBeLessThanOrEqual(16);
    }
  });

  /*
   * A name no wider than the 10rem a name set free gives way to has
   * nothing to give: it is not set free, and its column is as wide as its
   * longest name - the room goes to the hosts beside it. "Checkout API"
   * stood in a 10rem column while the person on call beside it was cut
   * short to "ada@acme-co...".
   */
  test("short names keep their own width: not set free, their column no wider than the longest of them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GIVE, 1002);
    await expect(giveRows(page)).toHaveCount(4);

    const names: Array<{ fill: string | null; box: number; words: number }> =
      await page.evaluate(
        (): Array<{ fill: string | null; box: number; words: number }> => {
          return Array.from(
            document.querySelectorAll<HTMLElement>(
              "#gallery-give-body > tr > td:nth-child(2) > div",
            ),
          ).map((name: HTMLElement) => {
            const range: Range = document.createRange();
            range.selectNodeContents(name);

            return {
              fill: name.getAttribute("data-fill"),
              box: Math.round(name.getBoundingClientRect().width),
              words: Math.round(range.getBoundingClientRect().width),
            };
          });
        },
      );

    expect(names).toHaveLength(4);

    const longest: number = Math.max(
      ...names.map((name: { words: number }): number => {
        return name.words;
      }),
    );
    // "Billing Reconciler", the longest, is under the 10rem floor.
    expect(longest).toBeLessThan(160);

    for (const name of names) {
      expect(name.fill).toBe("false");
      expect(name.box).toBeLessThanOrEqual(longest + 1);
    }
  });

  test("too wide even so, it scrolls as it did: its header on one line, every value whole, its Actions in sight", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GIVE, 840);
    await expect(giveRows(page)).toHaveCount(4);

    const reading: GiveReading = await readGive(page);

    expect(reading.overflowing).toBe("true");
    expect(reading.wrapsHeaders).toBe(false);
    expect(reading.gives).toEqual([null, null, null, null]);
    expect(reading.headerHeight).toBeLessThanOrEqual(39);
    await expectRowButtonsOnTheCard(page);
  });

  test("a window made narrower and wider again goes through every reading and settles, with no error on the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GIVE, 1280);
    await expect(giveRows(page)).toHaveCount(4);

    const scrollBox: Locator = page.getByTestId("table-scroll");
    const table: Locator = scrollBox.locator("table");
    const firstHost: Locator = giveRows(page)
      .nth(0)
      .locator("td")
      .nth(2)
      .locator("> div");

    for (const [width, overflowing, wraps, give] of [
      [1002, "false", "true", "line"],
      [1280, "false", null, null],
      [840, "true", null, null],
      [1120, "false", "true", null],
      [1002, "false", "true", "line"],
    ] as Array<[number, string, string | null, string | null]>) {
      await page.setViewportSize({ width: width, height: 900 });
      await expect(scrollBox).toHaveAttribute("data-overflowing", overflowing);
      if (wraps) {
        await expect(table).toHaveAttribute("data-wrap-headers", wraps);
      } else {
        await expect(table).not.toHaveAttribute("data-wrap-headers", /.+/);
      }
      if (give) {
        await expect(firstHost).toHaveAttribute("data-give", give);
      } else {
        await expect(firstHost).not.toHaveAttribute("data-give", /.+/);
      }
    }

    // A window's edge dragged across all of them, and back.
    for (let width: number = 1280; width >= 820; width -= 11) {
      await page.setViewportSize({ width: width, height: 900 });
    }
    for (let width: number = 820; width <= 1002; width += 7) {
      await page.setViewportSize({ width: width, height: 900 });
    }
    await page.setViewportSize({ width: 1002, height: 900 });
    await expect(scrollBox).toHaveAttribute("data-overflowing", "false");
    await expect(firstHost).toHaveAttribute("data-give", "line");

    const settled: string = await table.evaluate((element: Element): string => {
      return element.outerHTML;
    });
    await page.waitForTimeout(300);
    expect(
      await table.evaluate((element: Element): string => {
        return element.outerHTML;
      }),
    ).toBe(settled);
  });
});

/*
 * A row's View says "View": the row names its record in its first column
 * and the list's title its kind, so "View Scheduled Maintenance Template"
 * on every row only took two columns' room. Its name still says what it
 * views, for a screen reader and for every spec that presses it.
 */
test.describe("a row's View", () => {
  test("says View on every row, and is named by what it views", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${INCIDENTS}?data=rich`);

    const views: Array<Locator> = await bodyRows(page, "incidents-table")
      .getByRole("button", { name: "View Incident", exact: true })
      .all();

    expect(views.length).toBe(5);
    for (const view of views) {
      await expect(view).toHaveText("View");
      await expect(view).toHaveAttribute("aria-label", "View Incident");
      // The row's button is narrow: its word and its padding.
      expect((await box(view)).width).toBeLessThan(70);
    }
  });

  /*
   * German's View is "Anzeigen", the verb its names use: the word a row
   * shows is in the name a voice command looks for (WCAG 2.5.3).
   */
  test("in German, 'Anzeigen' on the row, named 'Vorfall anzeigen'", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${INCIDENTS}?lang=de`);

    const view: Locator = bodyRows(page, "incidents-table")
      .first()
      .getByRole("button", { name: "Vorfall anzeigen", exact: true });

    await expect(view).toHaveText("Anzeigen");
    await expect(view).toHaveAttribute("aria-label", "Vorfall anzeigen");
  });
});

/*
 * A table drawn without a card has one hairline at its top, as a card
 * does: its frame's border, with the header band's top rule dropped under
 * it. The two drew a 2px top edge no card has.
 */
test.describe("a table drawn without a card", () => {
  test("has one hairline at its top: its frame's, the band's own rule dropped under it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${GALLERY}?table=plain`);

    const edge: { frame: string; band: string; gap: number } =
      await page.evaluate((): { frame: string; band: string; gap: number } => {
        const scroll: Element = document.querySelector(
          '[data-testid="table-scroll"]',
        ) as Element;
        const frame: Element = scroll.parentElement as Element;
        const band: Element = scroll.querySelector("thead th") as Element;

        return {
          frame: getComputedStyle(frame).borderTopWidth,
          band: getComputedStyle(band).borderTopWidth,
          gap: Math.round(
            band.getBoundingClientRect().top -
              frame.getBoundingClientRect().top,
          ),
        };
      });

    expect(edge).toEqual({ frame: "1px", band: "0px", gap: 1 });
    // The band keeps its rule under its names, over the rows.
    expect(
      await header(page)
        .first()
        .evaluate((element: Element): string => {
          return getComputedStyle(element).borderBottomWidth;
        }),
    ).toBe("1px");
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

    // Not sticky: relative only so its column's edge sits on it (ColumnResize).
    expect(position).toBe("relative");
  });

  test("a table that scrolled sideways and fits again - the window made wider - sticks its header again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGES}?data=long`, 820);

    const scrollBox: Locator = page.getByTestId("table-scroll");
    const nameHeader: Locator = page.getByRole("columnheader", {
      name: "Name",
    });
    const positionOf: (cell: Locator) => Promise<string> = async (
      cell: Locator,
    ): Promise<string> => {
      return await cell.evaluate((element: Element): string => {
        return getComputedStyle(element).position;
      });
    };

    await expect(scrollBox).toHaveAttribute("data-overflowing", "true");
    // Not sticky: relative only so its column's edge sits on it (ColumnResize).
    expect(await positionOf(nameHeader)).toBe("relative");

    await page.setViewportSize({ width: 1280, height: 900 });

    await expect(scrollBox).toHaveAttribute("data-overflowing", "false");
    // Its own box's sideways scroll, left from a moment ago, is not a box around it.
    await expect
      .poll(async (): Promise<string> => {
        return await positionOf(nameHeader);
      })
      .toBe("sticky");
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

  test("the cards, their rules and the footer reach the card's edges; their words start where the card's title does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${MONITORS}?data=rich`, 390, 900);

    const card: Box = await box(page.getByTestId("card").first());
    const title: Box = await box(
      page.getByTestId("card-details-heading").first(),
    );
    const cards: Locator = page.locator("#Monitors-table-body > div");

    await expect(cards).toHaveCount(4);

    // A card runs from the card's left border to its right one.
    const first: Box = await box(cards.first());
    expect(Math.round(first.x)).toBe(Math.round(card.x) + 1);
    expect(Math.round(first.x + first.width)).toBe(
      Math.round(card.x + card.width) - 1,
    );

    // Its words start where the card's title does - not 16px in.
    const name: Box = await box(cards.first().locator("dt").first());
    expect(Math.abs(name.x - title.x)).toBeLessThanOrEqual(1);

    // So does the footer's summary.
    const summary: Box = await box(page.getByTestId("pagination-summary"));
    expect(Math.abs(summary.x - title.x)).toBeLessThanOrEqual(1);

    // A ticked card's wash reaches the card's edges too.
    await cards.first().locator("input[type=checkbox]").check();
    await expect(cards.first()).toHaveClass(/bg-indigo-50/);
    const ticked: Box = await box(cards.first());
    expect(Math.round(ticked.width)).toBe(Math.round(card.width) - 2);

    expect(
      await page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      }),
    ).toBe(0);

    await screenshot(page, "monitors-rich-ticked-390");
  });

  test("the header's search fills its line; opened, it is the card's width, and nothing passes the screen's edge", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${MONITORS}?data=rich`, 390, 900);

    const title: Box = await box(
      page.getByTestId("card-details-heading").first(),
    );
    const card: Box = await box(page.getByTestId("card").first());
    // The card's text runs from its title's start to as far from its right edge.
    const textRight: number = card.x + card.width - (title.x - card.x);
    const slot: Locator = page.getByTestId("model-table-search-slot");

    // Folded: the "Search..." pill fills its line, not 176px at the right.
    let search: Box = await box(slot);
    expect(Math.abs(search.x - title.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(search.x + search.width - textRight)).toBeLessThanOrEqual(
      1,
    );

    // The buttons on the next line, at the right edge.
    const create: Box = await box(
      page.getByRole("button", { name: "Create Monitor" }),
    );
    expect(create.y).toBeGreaterThan(search.y + search.height - 1);
    expect(Math.round(create.height)).toBeLessThanOrEqual(42);

    // Opened: the card's width, the folded buttons clipped to nothing.
    await page.getByRole("button", { name: "Open search" }).click();
    await expect(
      page.getByPlaceholder("Search monitors by name, description…"),
    ).toBeFocused();
    await waitForFoldedButtons(page);

    search = await box(slot);
    expect(Math.abs(search.x - title.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(search.x + search.width - textRight)).toBeLessThanOrEqual(
      1,
    );
    expect(
      await page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      }),
    ).toBe(0);

    await screenshot(page, "monitors-search-open-390");
  });

  test("at 640px the search fills what the buttons leave on their line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${INCIDENTS}?data=rich`, 640, 900);

    const title: Box = await box(
      page.getByTestId("card-details-heading").first(),
    );
    const search: Box = await box(page.getByTestId("model-table-search-slot"));
    const declare: Box = await box(
      page.getByRole("button", { name: "Declare Incident" }),
    );

    expect(Math.abs(search.x - title.x)).toBeLessThanOrEqual(1);
    // On one line with the buttons, up to them.
    expect(
      Math.abs(search.y + search.height / 2 - (declare.y + declare.height / 2)),
    ).toBeLessThanOrEqual(1);
    expect(declare.x - (search.x + search.width)).toBeLessThanOrEqual(13);
  });
});

test.describe("the header's search, opened on a wide screen", () => {
  test("stays level with the card's title: the buttons folded beside it keep to one line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${MONITORS}?data=rich`, 1280, 900);

    const header: Locator = page.getByTestId("card-header").first();
    const before: Box = await box(header);
    const title: Box = await box(
      page.getByTestId("card-details-heading").first(),
    );

    await page.getByRole("button", { name: "Open search" }).click();
    await expect(
      page.getByPlaceholder("Search monitors by name, description…"),
    ).toBeFocused();
    await waitForFoldedButtons(page);

    const search: Box = await box(page.getByTestId("model-table-search-slot"));

    /*
     * Squeezed to no width, "Create Monitor" broke over two lines and the
     * opened search dropped 10px below the title. The header's controls
     * are centred on the title (CardHeaders.spec.ts), so the opened search
     * is too.
     */
    expect(
      Math.abs(search.y + search.height / 2 - (title.y + title.height / 2)),
    ).toBeLessThanOrEqual(2);
    expect(Math.round((await box(header)).height)).toBe(
      Math.round(before.height),
    );

    // Tab from the opened search skips the buttons folded out of sight.
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Create Monitor" }),
    ).not.toBeFocused();
    expect(
      await page.evaluate((): boolean => {
        const focused: Element | null = document.activeElement;
        const toolbar: Element | null = document.querySelector(
          '[data-testid="model-table-header-toolbar"]',
        );

        return Boolean(
          focused &&
            toolbar &&
            toolbar.lastElementChild &&
            toolbar.lastElementChild.contains(focused),
        );
      }),
    ).toBe(false);
    expect(
      await page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      }),
    ).toBe(0);
  });
});

test.describe("the header's controls are one height", () => {
  /*
   * The "/" key hint stood on the 15px line its 10px text inherited - 21px
   * with its padding and border - and made every table's search 39px tall
   * beside its 38px buttons. It keeps a 12px line now, and the search takes
   * the buttons' padding: 38px from md up, 42px on a phone. The x that
   * empties it, which comes with the first letter typed, hangs over its
   * line: it grew the search to 40px (44px on a phone) and moved the
   * card's description down 2px under the reader's typing.
   */
  for (const size of [
    { width: 1280, height: 38 },
    { width: 390, height: 42 },
  ]) {
    test(`at ${size.width}px the search, the main button and the ⋯ are ${size.height}px tall, the search folded and opened`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `${MONITORS}?data=rich`, size.width, 900);

      const toolbar: Locator = page.getByTestId("model-table-header-toolbar");
      const slot: Locator = page.getByTestId("model-table-search-slot");
      const heightOf: (locator: Locator) => Promise<number> = async (
        locator: Locator,
      ): Promise<number> => {
        return Math.round((await box(locator)).height);
      };

      expect(await heightOf(slot)).toBe(size.height);
      expect(
        await heightOf(page.getByRole("button", { name: "Create Monitor" })),
      ).toBe(size.height);
      expect(
        await heightOf(toolbar.getByRole("button", { name: "More options" })),
      ).toBe(size.height);

      await page.getByRole("button", { name: "Open search" }).click();
      await expect(
        page.getByPlaceholder("Search monitors by name, description…"),
      ).toBeFocused();

      expect(await heightOf(slot)).toBe(size.height);

      const description: Locator = page
        .getByTestId("card-header")
        .first()
        .getByTestId("card-description");
      const descriptionTop: number | null =
        size.width >= 768 ? (await box(description)).y : null;

      await page.keyboard.type("checkout");
      await expect(
        page.getByRole("button", { name: "Clear search", exact: true }),
      ).toBeVisible();

      expect(await heightOf(slot)).toBe(size.height);

      // The card's description (hidden on a phone) stays where it was.
      if (descriptionTop !== null) {
        expect((await box(description)).y).toBe(descriptionTop);
      }
    });
  }
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

  test("a ticked row's Actions cell, stuck at the card's edge, is opaque: the cells scrolling under it do not show through", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${INCIDENTS}?data=rich&theme=dark`);

    await expect(page.getByTestId("table-scroll")).toHaveAttribute(
      "data-overflowing",
      "true",
    );

    const rows: Locator = bodyRows(page, "incidents-table");

    await rows.first().locator("input[type=checkbox]").check();
    await expect(rows.first()).toHaveAttribute("data-selected", "true");

    const backgroundOf: (row: Locator) => Promise<{
      row: string;
      actions: string;
    }> = async (row: Locator): Promise<{ row: string; actions: string }> => {
      return await row.evaluate(
        (element: Element): { row: string; actions: string } => {
          return {
            row: getComputedStyle(element).backgroundColor,
            actions: getComputedStyle(element.lastElementChild as Element)
              .backgroundColor,
          };
        },
      );
    };

    const ticked: { row: string; actions: string } = await backgroundOf(
      rows.first(),
    );
    const plain: { row: string; actions: string } = await backgroundOf(
      rows.nth(1),
    );

    // The stuck cell takes its row's ground, and that ground has no alpha.
    expect(ticked.actions).toBe(ticked.row);
    expect(alphaOf(ticked.actions)).toBe(1);
    // And it is still the ticked wash, not the plain row's ground.
    expect(ticked.actions).not.toBe(plain.actions);

    await screenshot(page, "incidents-rich-ticked-1280-dark");
  });

  test("on a phone a ticked card shows its wash", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${MONITORS}?data=rich&theme=dark`, 390, 900);

    const cards: Locator = page.locator("#Monitors-table-body > div");

    await cards.first().locator("input[type=checkbox]").check();

    const backgrounds: Array<string> = await cards.evaluateAll(
      (elements: Array<Element>): Array<string> => {
        return elements.map((element: Element): string => {
          return getComputedStyle(element).backgroundColor;
        });
      },
    );

    // The white's dark ground, painted with !important, hid it.
    expect(backgrounds[0]).not.toBe(backgrounds[1]);
    expect(backgrounds[1]).toBe(backgrounds[2]);
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

/*
 * A member whose teams grant nothing on a list (?role=none: only what every
 * member holds). A list with row actions keeps its Actions column for a
 * locked Edit or Delete, and that column alone used to count as something to
 * show: the member got the card's frame with rows of nothing but a checkbox
 * and a ⋯ - on a real server, "Couldn't load incidents" over every role and
 * permission that may read them - under filter chips and a search box.
 */
test.describe("a member who may read none of a list", () => {
  test("is told so, and the one permission to ask for - not shown rows of nothing but a ⋯, filter chips or a search box", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${INCIDENTS}?role=none`);

    const state: Locator = page.getByTestId("incidents-table-no-access");

    await expect(state).toBeVisible();
    await expect(state).toContainText("You don't have access to this list");
    await expect(state).toContainText(
      "You need this permission: Read Incident. Ask a project admin for access.",
    );
    await expect(state).not.toContainText("Project Owner");

    await expect(bodyRows(page, "incidents-table")).toHaveCount(0);
    await expect(page.locator("table")).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    // Nothing to narrow or search in a list they cannot read.
    await expect(page.getByTestId("facet-filter-bar")).toHaveCount(0);
    await expect(page.getByTestId("filter-chip")).toHaveCount(0);
    await expect(page.getByTestId("model-table-search-slot")).toHaveCount(0);

    await screenshot(page, "no-access-incidents-1280");
  });

  test("on a phone, in German and dark, the state fits the screen in German words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${MONITORS}?role=none&lang=de&theme=dark`, 390, 800);

    const state: Locator = page.getByTestId("Monitors-table-no-access");

    await expect(state).toBeVisible();
    await expect(state).toContainText(
      "Sie haben keinen Zugriff auf diese Liste",
    );
    await expect(state).toContainText(
      "Sie benötigen diese Berechtigung: Read Monitor. Bitten Sie einen Projektadministrator um Zugriff.",
    );
    await expect(bodyRows(page, "Monitors-table")).toHaveCount(0);

    const drawn: Box = await box(state);

    expect(drawn.x).toBeGreaterThanOrEqual(0);
    expect(drawn.x + drawn.width).toBeLessThanOrEqual(390);
    expect(
      await page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      }),
    ).toBe(0);

    await screenshot(page, "no-access-monitors-390-de-dark");
  });
});
