import { expect, Locator, Page, Route, test, TestInfo } from "@playwright/test";

/*
 * Click-to-sort on a dashboard's list and table widgets (issue #5082), in a
 * real browser, on both surfaces: the dashboard inside OneUptime (its real
 * view layout and Dashboard page) and the public dashboard (its own
 * index.ejs and app), with only the data boundary answered from fixture
 * data (DashboardWidgetSort/Fixture). See README.md.
 *
 *   - A header click sorts the whole list - the read asks the database for
 *     the order, and the rows drawn are the first of all of them - worst,
 *     newest, highest or A to Z first, then the other way, then back to the
 *     widget's own order.
 *   - The viewer's sort is kept in their browser for that widget on that
 *     dashboard: a reload keeps it.
 *   - An editor sets the order everyone sees with the widget's Sort
 *     setting, or a click on a header in its Live Preview, and Save Changes.
 *   - On a public dashboard the visitor's sort travels as widgetSort, and
 *     the server orders the list itself.
 *
 * Screenshots of the sorted widgets (light, dark, German, the settings and
 * a phone) are saved for review under output/playwright/dashboard-widget-sort-ui.
 */

interface FixtureList {
  table: string;
  sort: Record<string, unknown>;
  phase: string | null;
  limit: number;
}

interface FixtureRecord {
  lists?: Array<FixtureList> | undefined;
  traceTables?: Array<{ tableSort: Record<string, string> | null }> | undefined;
  saves?: Array<{ dashboardViewConfig: Record<string, unknown> }> | undefined;
  resourceLists?:
    | Array<{
        resource: string;
        componentId: string;
        widgetSort: string | null;
        phases: Array<string | null>;
      }>
    | undefined;
  unexpected: Array<string>;
}

declare global {
  interface Window {
    __dashboardWidgetSortFixture?: FixtureRecord | undefined;
  }
}

const PORT: string = "4404";

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000e1";
const DASHBOARD_ID: string = "db000000-0000-4000-8000-0000000000e1";

// The fixture's widgets (Fixture/Boards.js).
const MONITORS_WIDGET: string = "c0000000-0000-4000-8000-0000000000e1";
const PODS_WIDGET: string = "c0000000-0000-4000-8000-0000000000e2";

const SCREENSHOTS: string = "../../output/playwright/dashboard-widget-sort-ui";

const APP_PATH: string = `/dashboard/${PROJECT_ID}/dashboards/${DASHBOARD_ID}`;
const PUBLIC_PATH: string = `/public-dashboard/${DASHBOARD_ID}`;

// The fixture's rows, in the orders the database answers them.
const MONITORS_BY_NAME: Array<string> = [
  "api-gateway",
  "auth",
  "billing",
  "checkout",
  "search",
];
const MONITORS_WORST_FIRST: Array<string> = [
  "auth",
  "billing",
  "checkout",
  "api-gateway",
  "search",
];
const MONITORS_BEST_FIRST: Array<string> = [
  "api-gateway",
  "search",
  "checkout",
  "auth",
  "billing",
];

const PODS_BY_NAMESPACE: Array<string> = [
  "batch-7",
  "worker-3",
  "cache-1",
  "payments-0",
  "web-1",
  "web-2",
];
const PODS_WORST_FIRST: Array<string> = [
  "worker-3",
  "cache-1",
  "payments-0",
  "batch-7",
  "web-1",
  "web-2",
];

const pickKey: (componentId: string) => string = (
  componentId: string,
): string => {
  return `oneuptime-dashboard-widget-sort-${componentId}:${DASHBOARD_ID}`;
};

const record: (page: Page) => Promise<FixtureRecord> = async (
  page: Page,
): Promise<FixtureRecord> => {
  return page.evaluate((): FixtureRecord => {
    return window.__dashboardWidgetSortFixture || { unexpected: [] };
  });
};

const kept: (page: Page, key: string) => Promise<string | null> = async (
  page: Page,
  key: string,
): Promise<string | null> => {
  return page.evaluate((storageKey: string): string | null => {
    return window.localStorage.getItem(storageKey);
  }, key);
};

const shoot: (
  page: Page,
  testInfo: TestInfo,
  name: string,
  target?: Locator,
) => Promise<void> = async (
  page: Page,
  testInfo: TestInfo,
  name: string,
  target?: Locator,
): Promise<void> => {
  const path: string = `${SCREENSHOTS}/${testInfo.project.name}-${name}.png`;

  if (target) {
    await target.screenshot({ path });
    return;
  }

  await page.screenshot({ path, fullPage: true });
};

/*
 * A press on a control of the dashboard, as the viewer makes it.
 *
 * A dashboard's board is 1000px wide (DashboardView's page, and the public
 * page's board in its own frame, DashboardViewLayout), so on a phone part
 * of the board sits past the screen's edge and the viewer scrolls to it. Playwright's own click cannot reach a control
 * there - the phone emulation scrolls the visual viewport, and the check
 * of what is under the pointer looks at the wrong place - so on the phone
 * the control is scrolled to, must be visible and enabled, and gets the
 * click a tap ends in (as the dashboard time range suite does); at 1280 it
 * is Playwright's real click.
 */
const press: (control: Locator) => Promise<void> = async (
  control: Locator,
): Promise<void> => {
  if (!test.info().project.use.isMobile) {
    await control.click();
    return;
  }

  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await control.dispatchEvent("click");
};

const atDesktopOnly: () => void = (): void => {
  test.skip(
    Boolean(test.info().project.use.isMobile),
    "The same at any width: covered at 1280.",
  );
};

// A widget's table, by a header only it has.
const tableWith: (page: Page, columnKey: string) => Locator = (
  page: Page,
  columnKey: string,
): Locator => {
  return page
    .locator("table")
    .filter({ has: page.getByTestId(`dashboard-widget-sort-${columnKey}`) });
};

const monitorsTable: (page: Page) => Locator = (page: Page): Locator => {
  return tableWith(page, "status");
};

const podsTable: (page: Page) => Locator = (page: Page): Locator => {
  return tableWith(page, "phase");
};

const header: (table: Locator, columnKey: string) => Locator = (
  table: Locator,
  columnKey: string,
): Locator => {
  return table.getByTestId(`dashboard-widget-sort-${columnKey}`);
};

// The cell text of one column of a table's rows, in the order drawn.
const columnOf: (
  table: Locator,
  index: number,
) => Promise<Array<string>> = async (
  table: Locator,
  index: number,
): Promise<Array<string>> => {
  return table
    .locator("tbody tr")
    .evaluateAll((rows: Array<Element>, cellIndex: number): Array<string> => {
      return rows.map((row: Element): string => {
        const cells: Array<Element> = Array.from(row.querySelectorAll("td"));
        return (cells[cellIndex]?.textContent || "").trim();
      });
    }, index);
};

const expectRows: (
  table: Locator,
  rows: Array<string>,
  index?: number,
) => Promise<void> = async (
  table: Locator,
  rows: Array<string>,
  index: number = 0,
): Promise<void> => {
  await expect
    .poll(
      async (): Promise<Array<string>> => {
        return columnOf(table, index);
      },
      { timeout: 20000 },
    )
    .toEqual(rows);
};

// The latest read of a table, once one has come since `from`.
const lastListOf: (
  page: Page,
  table: string,
  from: number,
) => Promise<FixtureList> = async (
  page: Page,
  table: string,
  from: number,
): Promise<FixtureList> => {
  let found: FixtureList | undefined;

  await expect
    .poll(
      async (): Promise<boolean> => {
        const lists: Array<FixtureList> = ((await record(page)).lists || [])
          .slice(from)
          .filter((list: FixtureList): boolean => {
            return list.table === table;
          });
        found = lists[lists.length - 1];
        return Boolean(found);
      },
      { timeout: 20000 },
    )
    .toBe(true);

  return found as FixtureList;
};

const listCount: (page: Page) => Promise<number> = async (
  page: Page,
): Promise<number> => {
  return ((await record(page)).lists || []).length;
};

const openApp: (page: Page, search?: string) => Promise<void> = async (
  page: Page,
  search?: string,
): Promise<void> => {
  await page.goto(`${APP_PATH}${search || ""}`);
  await expect(monitorsTable(page)).toBeVisible({ timeout: 60000 });
  await expect(monitorsTable(page).locator("tbody tr").first()).toBeVisible();
};

const openPublic: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.goto(PUBLIC_PATH);
  await expect(monitorsTable(page)).toBeVisible({ timeout: 60000 });
  await expect(monitorsTable(page).locator("tbody tr").first()).toBeVisible();
};

// The toolbar's "More dashboard options" menu, then its "Edit Dashboard".
const enterEditMode: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await press(page.getByRole("button", { name: "More dashboard options" }));
  await press(page.getByRole("menuitem", { name: "Edit Dashboard" }));
  await expect(page.getByTitle("Save Changes")).toBeVisible();
};

/*
 * A click on a widget while editing, which opens its settings: on its
 * title, where the editing layer over the widget takes the click (a header
 * there is not reachable: editing moves and opens widgets).
 */
const selectWidget: (page: Page, title: string) => Promise<void> = async (
  page: Page,
  title: string,
): Promise<void> => {
  await page.getByText(title, { exact: true }).first().click({ force: true });
  await expect(page.getByTestId("modal")).toBeVisible();
};

// Nothing the pages ask for leaves the fixture.
test.beforeEach(async ({ page }: { page: Page }) => {
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

  // Every request the pages made is one the fixture models.
  expect(unexpected).toEqual([]);
});

test.describe("a list on the dashboard inside OneUptime", () => {
  test("opens in its own order, every column a header that sorts, the one the rows are in marked", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openApp(page);

    const table: Locator = monitorsTable(page);

    await expectRows(table, MONITORS_BY_NAME);
    await expect(header(table, "name").locator("xpath=..")).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await expect(header(table, "status").locator("xpath=..")).toHaveAttribute(
      "aria-sort",
      "none",
    );
    await expect(header(table, "name")).toHaveAttribute(
      "title",
      "Sorted: A to Z",
    );
    await expect(header(table, "status")).toHaveAttribute(
      "title",
      "Sort: Worst first",
    );
    await expect(table.getByTestId("dashboard-widget-sort-arrow")).toHaveCount(
      1,
    );

    await shoot(page, testInfo, "board", undefined);
  });

  test("Status sorts the whole list worst first, then best first, then back to by name", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openApp(page);

    const table: Locator = monitorsTable(page);
    let from: number = await listCount(page);

    await press(header(table, "status"));
    await expectRows(table, MONITORS_WORST_FIRST);

    // The database ordered the whole list: by priority, highest first.
    expect((await lastListOf(page, "Monitor", from)).sort).toEqual({
      currentMonitorStatus: { priority: { direction: "DESC", nulls: "LAST" } },
      name: "ASC",
    });
    await expect(header(table, "status").locator("xpath=..")).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    await expect(header(table, "status")).toHaveAttribute(
      "title",
      "Sorted: Worst first",
    );
    expect(await kept(page, pickKey(MONITORS_WIDGET))).toBe("status:desc");

    await shoot(page, testInfo, "monitors-worst-first", table);

    from = await listCount(page);
    await press(header(table, "status"));
    await expectRows(table, MONITORS_BEST_FIRST);
    expect((await lastListOf(page, "Monitor", from)).sort).toEqual({
      currentMonitorStatus: { priority: "ASC" },
      name: "ASC",
    });
    expect(await kept(page, pickKey(MONITORS_WIDGET))).toBe("status:asc");

    await press(header(table, "status"));
    await expectRows(table, MONITORS_BY_NAME);
    expect(await kept(page, pickKey(MONITORS_WIDGET))).toBeNull();
    await expect(header(table, "name").locator("xpath=..")).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });

  test("a reload keeps the viewer's sort, and only for that widget", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openApp(page);

    await press(header(monitorsTable(page), "status"));
    await expectRows(monitorsTable(page), MONITORS_WORST_FIRST);

    await page.reload();
    await expect(monitorsTable(page)).toBeVisible({ timeout: 60000 });
    await expectRows(monitorsTable(page), MONITORS_WORST_FIRST);
    await expectRows(podsTable(page), PODS_BY_NAMESPACE);
  });

  test("a pod list reads its phases rank by rank, worst first", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openApp(page);

    const table: Locator = podsTable(page);

    await expectRows(table, PODS_BY_NAMESPACE);

    const from: number = await listCount(page);

    await press(header(table, "phase"));
    await expectRows(table, PODS_WORST_FIRST);

    const phases: Array<string | null> = ((await record(page)).lists || [])
      .slice(from)
      .filter((list: FixtureList): boolean => {
        return list.table === "KubernetesResource";
      })
      .map((list: FixtureList): string | null => {
        return list.phase;
      });

    expect(phases).toEqual([
      "Failed",
      "Unknown",
      "Pending",
      "Running+Succeeded",
      "other",
      "none",
    ]);
  });

  /*
   * At 6 units a list whose titles are long - an incident's, a host's name,
   * a container's image - drew each on one line, whole, and ran past its
   * widget: the rows scrolled sideways, and the default sort's arrow, on
   * the last column (Declared), was out of sight. A title gives way now,
   * ending in "...", down to 6rem (DashboardResourceListBase).
   */
  test("at 6 units, an incident list with a long title fits its widget: the title ends in ... and the sort's arrow is in sight", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openApp(page, "?titles=long");

    const incidents: Locator = tableWith(page, "declared");
    const title: Locator = incidents
      .locator("tbody td")
      .filter({ hasText: "Elevated 5xx on the public API gateway" })
      .first();
    await expect(title).toBeVisible();

    type Fit = {
      boxWidth: number;
      scrollWidth: number;
      box: { left: number; right: number };
    };
    const readFit: () => Promise<Fit> = (): Promise<Fit> => {
      return incidents.evaluate((element: Element): Fit => {
        const box: HTMLElement = element.parentElement as HTMLElement;
        const rect: DOMRect = box.getBoundingClientRect();

        return {
          boxWidth: box.clientWidth,
          scrollWidth: box.scrollWidth,
          box: { left: rect.left, right: rect.right },
        };
      });
    };

    /*
     * The rows fit the widget: nothing scrolls sideways - once the list has
     * laid itself out. Read the moment its title first shows, a busy runner
     * (14.0.94's gate) found 433 pixels of rows in a 426-pixel box, a
     * scrollbar there for a moment, where the list settles at 438 in 438;
     * so this asks until it settles, and keeps the box it settled in.
     */
    let fit: Fit = await readFit();
    await expect
      .poll(
        async (): Promise<number> => {
          fit = await readFit();
          return fit.scrollWidth - fit.boxWidth;
        },
        { timeout: 10000 },
      )
      .toBeLessThanOrEqual(1);

    // The title is cut short on its line, and keeps 6rem of its words.
    const cut: { width: number; isCut: boolean; lines: number } =
      await title.evaluate(
        (cell: Element): { width: number; isCut: boolean; lines: number } => {
          const style: CSSStyleDeclaration = getComputedStyle(cell);
          const range: Range = document.createRange();
          range.selectNodeContents(cell);
          const tops: Set<number> = new Set(
            Array.from(range.getClientRects())
              .filter((rect: DOMRect): boolean => {
                return rect.width > 0;
              })
              .map((rect: DOMRect): number => {
                return Math.round(rect.top);
              }),
          );

          return {
            width: cell.getBoundingClientRect().width,
            isCut:
              style.textOverflow === "ellipsis" &&
              cell.scrollWidth > cell.clientWidth,
            lines: tops.size,
          };
        },
      );
    expect(cut.isCut).toBe(true);
    expect(cut.lines).toBe(1);
    expect(cut.width).toBeGreaterThanOrEqual(96);

    // The default order's arrow, on Declared, inside the widget.
    const arrow: Locator = header(incidents, "declared").getByTestId(
      "dashboard-widget-sort-arrow",
    );
    await expect(arrow).toBeVisible();
    const arrowBox: { x: number; width: number } = (await arrow.boundingBox())!;
    expect(arrowBox.x).toBeGreaterThanOrEqual(fit.box.left);
    expect(arrowBox.x + arrowBox.width).toBeLessThanOrEqual(fit.box.right);

    await shoot(page, testInfo, "incidents-long-title", undefined);
  });

  test("an incident list sorts by the project's severity order, and a security events list by severity in ClickHouse", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openApp(page);

    const incidents: Locator = tableWith(page, "declared");

    await expectRows(incidents, [
      "Slow search",
      "Checkout errors",
      "Login failures",
      "Old certificate warning",
    ]);

    let from: number = await listCount(page);

    await press(header(incidents, "severity"));
    await expectRows(incidents, [
      "Checkout errors",
      "Login failures",
      "Slow search",
      "Old certificate warning",
    ]);
    expect((await lastListOf(page, "Incident", from)).sort).toEqual({
      incidentSeverity: { order: "ASC" },
      createdAt: "DESC",
    });

    const security: Locator = tableWith(page, "class");

    await expectRows(
      security,
      [
        "Config file read",
        "Brute force detected",
        "Port scan blocked",
        "Failed login for root",
      ],
      3,
    );

    from = await listCount(page);
    await press(header(security, "severity"));
    await expectRows(
      security,
      [
        "Brute force detected",
        "Failed login for root",
        "Port scan blocked",
        "Config file read",
      ],
      3,
    );
    expect((await lastListOf(page, "SecurityEvent", from)).sort).toEqual({
      severityId: "DESC",
      time: "DESC",
    });

    await shoot(page, testInfo, "incidents-and-security-events", undefined);
  });

  test("a trace table asks the server to rank its groups by the column, and a metric table sorts its rows", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openApp(page);

    const traces: Locator = tableWith(page, "errorCount");

    // Busiest first, as it always ranked them.
    await expectRows(
      traces,
      ["GET /cart", "GET /search", "POST /login", "POST /pay"],
      1,
    );

    await press(header(traces, "errorCount"));
    await expectRows(
      traces,
      ["POST /pay", "POST /login", "GET /cart", "GET /search"],
      1,
    );

    const traceTables: Array<{ tableSort: Record<string, string> | null }> =
      (await record(page)).traceTables || [];
    expect(traceTables[traceTables.length - 1]?.tableSort).toEqual({
      column: "errorCount",
      direction: "desc",
    });

    const metrics: Locator = tableWith(page, "col:requests");

    await expectRows(metrics, ["auth", "billing", "checkout", "search"]);
    await press(header(metrics, "col:requests"));
    await expectRows(metrics, ["billing", "checkout", "auth", "search"]);

    await shoot(page, testInfo, "trace-and-metric-tables", undefined);
  });

  test("the headers read in the dark theme and in German", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();

    await openApp(page, "?theme=dark");
    await press(header(monitorsTable(page), "status"));
    await expectRows(monitorsTable(page), MONITORS_WORST_FIRST);
    await shoot(page, testInfo, "dark", undefined);

    await openApp(page, "?lang=de");
    await expect(header(monitorsTable(page), "status")).toHaveAttribute(
      "title",
      "Sortiert: Schlechteste zuerst",
    );
    await expect(header(monitorsTable(page), "name")).toHaveAttribute(
      "title",
      "Sortieren: A bis Z",
    );
    await shoot(page, testInfo, "german", monitorsTable(page));
  });
});

/*
 * A sortable header takes no more room than the plain one it replaced: its
 * words wrap as before, and its arrow and hint hang in the cell's padding.
 * So a table that fitted its widget still fits it (#5122's UI review), and
 * the security events list keeps one line per event.
 */
test.describe("the headers take no more room than plain ones", () => {
  interface TableBox {
    boxWidth: number;
    scrollWidth: number;
    rowHeights: Array<number>;
  }

  // The table's scroll box, and the height of each of its rows.
  const measure: (table: Locator) => Promise<TableBox> = async (
    table: Locator,
  ): Promise<TableBox> => {
    return table.evaluate((element: Element): TableBox => {
      const box: HTMLElement = element.parentElement as HTMLElement;

      return {
        boxWidth: box.clientWidth,
        scrollWidth: box.scrollWidth,
        rowHeights: Array.from(element.querySelectorAll("tbody tr")).map(
          (row: Element): number => {
            return row.getBoundingClientRect().height;
          },
        ),
      };
    });
  };

  // A header's words: the one element in it a screen reader reads.
  const wordsOf: (button: Locator) => Locator = (button: Locator): Locator => {
    return button.locator("span:not([aria-hidden])");
  };

  const openNarrow: (page: Page) => Promise<void> = async (
    page: Page,
  ): Promise<void> => {
    await page.goto(`${APP_PATH}?board=narrow`);
    await expect(tableWith(page, "col:requests")).toBeVisible({
      timeout: 60000,
    });
    await expect(
      tableWith(page, "col:requests").locator("tbody tr").first(),
    ).toBeVisible();
  };

  test("a long header wraps rather than widening a narrow table", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openNarrow(page);

    const table: Locator = tableWith(page, "col:requests");

    // "Requests per minute" takes two lines in a 4-unit widget...
    const words: Locator = wordsOf(header(table, "col:requests"));
    await expect(words).toHaveText("Requests per minute");
    expect((await words.boundingBox())!.height).toBeGreaterThanOrEqual(28);

    // ...so the table fits its widget, as it did before headers sorted.
    const box: TableBox = await measure(table);
    expect(box.scrollWidth).toBeLessThanOrEqual(box.boxWidth + 1);

    await shoot(page, testInfo, "narrow-metric-table", table);
  });

  test("a column aligned right hangs its arrow before its words, inside its own cell", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openNarrow(page);

    const table: Locator = tableWith(page, "col:requests");
    const button: Locator = header(table, "col:requests");

    // Its hint, under the pointer, and then its arrow: before the words.
    await button.hover();

    const hint: Locator = button.locator("svg");
    await expect(hint).toHaveCSS("opacity", "1");

    await press(button);
    await expect(button.locator("xpath=..")).toHaveAttribute(
      "aria-sort",
      "descending",
    );

    // The arrow as drawn: its strokes, not the icon's empty margin.
    const arrow: Locator = button
      .getByTestId("dashboard-widget-sort-arrow")
      .locator("path")
      .first();
    const arrowBox: { x: number; width: number } = (await arrow.boundingBox())!;
    const wordsBox: { x: number } = (await wordsOf(button).boundingBox())!;
    const cellBox: { x: number; width: number } = (await button
      .locator("xpath=..")
      .boundingBox())!;

    // Before the words, and inside the cell (to within half a stroke).
    expect(arrowBox.x + arrowBox.width).toBeLessThanOrEqual(wordsBox.x);
    expect(arrowBox.x).toBeGreaterThanOrEqual(cellBox.x - 0.5);

    // The last column's arrow never draws past the table's edge.
    const box: TableBox = await measure(table);
    expect(box.scrollWidth).toBeLessThanOrEqual(box.boxWidth + 1);
  });

  test("the security events list draws one line per event, at its narrowest too", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openNarrow(page);

    const tables: Locator = page.locator("table").filter({
      has: page.getByTestId("dashboard-widget-sort-severity"),
    });
    await expect(tables).toHaveCount(2);

    for (const index of [0, 1]) {
      await expect(tables.nth(index).locator("tbody tr")).toHaveCount(4);
    }

    const measureBoth: () => Promise<Array<TableBox>> = async (): Promise<
      Array<TableBox>
    > => {
      return [await measure(tables.nth(0)), await measure(tables.nth(1))];
    };

    /*
     * At its default width, the list fits its widget - once the dashboard
     * has given its widgets their widths. Read the moment its rows first
     * showed, a busy runner (14.0.95's gate) found 542 pixels of rows in a
     * 483-pixel box, where its failure screenshot shows the list fitting; so
     * this asks until it settles, as the long-title list's test does, and
     * the rows below are those of the boxes it settled in.
     */
    let boxes: Array<TableBox> = await measureBoth();
    await expect
      .poll(
        async (): Promise<number> => {
          boxes = await measureBoth();
          const widest: TableBox = boxes.reduce(
            (wider: TableBox, box: TableBox): TableBox => {
              return box.boxWidth > wider.boxWidth ? box : wider;
            },
          );
          return widest.scrollWidth - widest.boxWidth;
        },
        { timeout: 10000 },
      )
      .toBeLessThanOrEqual(1);

    // One line of the list's text and its padding: never two.
    for (const box of boxes) {
      for (const height of box.rowHeights) {
        expect(height).toBeLessThan(36);
      }
    }

    await shoot(page, testInfo, "security-events-one-line", undefined);
  });
});

test.describe("the order everyone sees", () => {
  test("the Sort setting saves the widget's own order, which Save Changes keeps", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await page.goto(APP_PATH);
    await expect(monitorsTable(page)).toBeVisible({ timeout: 60000 });
    await page.evaluate((): void => {
      window.sessionStorage.clear();
      window.localStorage.clear();
    });
    await openApp(page);

    await enterEditMode(page);
    await selectWidget(page, "Monitors");

    const modal: Locator = page.getByTestId("modal");
    const setting: Locator = modal.getByTestId("dashboard-widget-sort-setting");

    await expect(setting).toBeVisible();
    await expect(setting).toContainText("Default (Name: A to Z)");

    await setting.getByRole("combobox").click();
    await page.getByRole("option", { name: "Status: Worst first" }).click();
    await expect(setting).toContainText("Status: Worst first");

    // The live preview draws the new order at once.
    await expectRows(
      modal.locator("table").filter({
        has: page.getByTestId("dashboard-widget-sort-status"),
      }),
      MONITORS_WORST_FIRST,
    );

    await shoot(page, testInfo, "sort-setting", modal);

    await press(modal.getByRole("button", { name: "Done" }));
    await expect(modal).toHaveCount(0);
    await press(page.getByRole("button", { name: "Save Changes" }));

    await expect
      .poll(async (): Promise<number> => {
        return ((await record(page)).saves || []).length;
      })
      .toBe(1);

    const saved: Record<string, unknown> = ((await record(page)).saves ||
      [])[0]!.dashboardViewConfig;
    const savedMonitors: Record<string, unknown> | undefined = (
      saved["components"] as Array<Record<string, unknown>>
    ).find((component: Record<string, unknown>): boolean => {
      return JSON.stringify(component["componentId"]).includes(MONITORS_WIDGET);
    });

    expect(
      (savedMonitors?.["arguments"] as Record<string, unknown>)["sort"],
    ).toBe("status:desc");

    // Everyone opens it worst first, with no pick of their own.
    await page.reload();
    await expect(monitorsTable(page)).toBeVisible({ timeout: 60000 });
    await expectRows(monitorsTable(page), MONITORS_WORST_FIRST);
    expect(await kept(page, pickKey(MONITORS_WIDGET))).toBeNull();
    await expect(
      header(monitorsTable(page), "status").locator("xpath=.."),
    ).toHaveAttribute("aria-sort", "descending");
  });

  test("a click on a header in the Live Preview sets the Sort setting", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await page.goto(APP_PATH);
    await expect(monitorsTable(page)).toBeVisible({ timeout: 60000 });
    await page.evaluate((): void => {
      window.sessionStorage.clear();
      window.localStorage.clear();
    });
    await openApp(page);

    await enterEditMode(page);
    await selectWidget(page, "Pods");

    const modal: Locator = page.getByTestId("modal");
    const preview: Locator = modal.locator("table").filter({
      has: page.getByTestId("dashboard-widget-sort-phase"),
    });
    const setting: Locator = modal.getByTestId("dashboard-widget-sort-setting");

    await expect(setting).toContainText("Default (Namespace: A to Z)");

    await preview.getByTestId("dashboard-widget-sort-phase").click();

    await expect(setting).toContainText("Phase: Worst first");
    await expectRows(preview, PODS_WORST_FIRST);

    // The preview is the widget as everyone will see it: no viewer pick.
    expect(await kept(page, pickKey(PODS_WIDGET))).toBeNull();
  });
});

test.describe("a list on a public dashboard", () => {
  test("a visitor's sort travels as widgetSort, the server orders the list, and a reload keeps it", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openPublic(page);

    const table: Locator = monitorsTable(page);

    await expectRows(table, MONITORS_BY_NAME);

    await press(header(table, "status"));
    await expectRows(table, MONITORS_WORST_FIRST);

    const lists: Array<{
      resource: string;
      componentId: string;
      widgetSort: string | null;
    }> = (await record(page)).resourceLists || [];
    const lastMonitors:
      | { resource: string; componentId: string; widgetSort: string | null }
      | undefined = lists
      .filter((list: { resource: string }): boolean => {
        return list.resource === "monitor";
      })
      .pop();

    expect(lastMonitors?.componentId).toBe(MONITORS_WIDGET);
    expect(lastMonitors?.widgetSort).toBe("status:desc");
    expect(await kept(page, pickKey(MONITORS_WIDGET))).toBe("status:desc");

    await shoot(page, testInfo, "public-worst-first", undefined);

    await page.reload();
    await expect(monitorsTable(page)).toBeVisible({ timeout: 60000 });
    await expectRows(monitorsTable(page), MONITORS_WORST_FIRST);
  });

  test("the server reads a pod list's phases rank by rank for the visitor", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openPublic(page);

    await press(header(podsTable(page), "phase"));
    await expectRows(podsTable(page), PODS_WORST_FIRST);

    const lists: Array<{
      resource: string;
      widgetSort: string | null;
      phases: Array<string | null>;
    }> = (await record(page)).resourceLists || [];
    const lastPods:
      | {
          resource: string;
          widgetSort: string | null;
          phases: Array<string | null>;
        }
      | undefined = lists
      .filter((list: { resource: string }): boolean => {
        return list.resource === "kubernetes-resource";
      })
      .pop();

    expect(lastPods?.widgetSort).toBe("phase:desc");
    expect(lastPods?.phases).toEqual([
      "Failed",
      "Unknown",
      "Pending",
      "Running+Succeeded",
      "other",
      "none",
    ]);
  });
});
