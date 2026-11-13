import {
  Dialog,
  expect,
  Locator,
  Page,
  Route,
  test,
  TestInfo,
} from "@playwright/test";
import {
  DrawnBox,
  DrawnBoxes,
  drawnBoxAt,
  drawnPlacesOf,
  readDrawnBoxes,
  recordDrawnBoxes,
  waitForFrames,
} from "../SuiteHelpers/DrawnBoxes";

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
 *   - A board being edited is left at once while nothing changed; with a
 *     change unsaved, the side menu, Back and a reload ask first (#7173).
 *
 * Screenshots of the sorted widgets (light, dark, German, the settings and
 * a phone) are saved for review under output/playwright/dashboard-widget-sort-ui.
 */

interface FixtureList {
  table: string;
  sort: Record<string, unknown>;
  phase: string | null;
  limit: number;
  select?: Record<string, unknown> | undefined;
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
    __windowErrors?: Array<string> | undefined;
  }
}

// The fixture's port, as its config and server read it.
const PORT: string =
  process.env["DASHBOARD_WIDGET_SORT_FIXTURE_PORT"] || "4404";

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000e1";
const DASHBOARD_ID: string = "db000000-0000-4000-8000-0000000000e1";

// The fixture's widgets (Fixture/Boards.js).
const MONITORS_WIDGET: string = "c0000000-0000-4000-8000-0000000000e1";
const PODS_WIDGET: string = "c0000000-0000-4000-8000-0000000000e2";

const SCREENSHOTS: string = "../../output/playwright/dashboard-widget-sort-ui";

const APP_PATH: string = `/dashboard/${PROJECT_ID}/dashboards/${DASHBOARD_ID}`;
const PUBLIC_PATH: string = `/public-dashboard/${DASHBOARD_ID}`;
// The dashboard's Overview, a stand-in in the fixture (Fixture/AppFixture.js).
const OVERVIEW_PATH: string = `${APP_PATH}/overview`;

// What the board asks before it is left with unsaved changes (#7173).
const LEAVE_TITLE: string = "Leave without saving?";
const LEAVE_DESCRIPTION: string =
  "You have unsaved changes to this dashboard. If you leave now, they will be lost.";
// And what the toolbar's Cancel asks then, in the same voice.
const CANCEL_TITLE: string = "Discard unsaved changes?";
const CANCEL_DESCRIPTION: string =
  "You have unsaved changes to this dashboard. If you discard them, the dashboard goes back to how it was last saved.";

/*
 * The fixture's rows, in the orders the database answers them. legacy-api's
 * monitoring is off (its status frozen at Offline): it is listed, after every
 * monitor that is checked whichever way Status sorts. archived-cdn is
 * archived and never listed (Fixture/Boards.js monitors).
 */
const MONITORS_BY_NAME: Array<string> = [
  "api-gateway",
  "auth",
  "billing",
  "checkout",
  "legacy-api",
  "search",
];
const MONITORS_WORST_FIRST: Array<string> = [
  "auth",
  "billing",
  "checkout",
  "api-gateway",
  "search",
  "legacy-api",
];
const MONITORS_BEST_FIRST: Array<string> = [
  "api-gateway",
  "search",
  "checkout",
  "auth",
  "billing",
  "legacy-api",
];

/*
 * What each row's Status says, in the orders above: the project's own status
 * names as stored, and Disabled - the Monitors table's word, in the reader's
 * language - for the monitor whose monitoring is off.
 */
const STATUSES_BY_NAME: Array<string> = [
  "Operational",
  "Offline",
  "Offline",
  "Degraded",
  "Disabled",
  "Operational",
];
const STATUSES_WORST_FIRST: Array<string> = [
  "Offline",
  "Offline",
  "Degraded",
  "Operational",
  "Operational",
  "Disabled",
];
const STATUSES_BEST_FIRST: Array<string> = [
  "Operational",
  "Operational",
  "Degraded",
  "Offline",
  "Offline",
  "Disabled",
];

// The monitor list's Status column.
const STATUS_COLUMN: number = 1;

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
 * On a phone a dashboard's board shows its widgets one under another
 * (Common/Utils/Dashboard/DashboardBoardLayout), so a widget's table can sit
 * below the fold and the viewer scrolls to it. Playwright's own click cannot
 * reach a control there - the phone emulation scrolls the visual viewport,
 * and the check of what is under the pointer looks at the wrong place - so
 * on the phone the control is scrolled to, must be visible and enabled, and
 * gets the click a tap ends in (as the dashboard time range suite does); at
 * 1280 it is Playwright's real click.
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

/*
 * A window as wide as a laptop's, 1440px, for a test of what fits a widget
 * N units wide. The board fits its column beside the side menu now
 * (Common/Utils/Dashboard/DashboardBoardLayout, the #5284 follow-up): at
 * 1280 the column is 824px, so a unit is about 60px and a widget narrower
 * than the 70px units a list's default width was chosen on, when the board
 * was at least 1000px wide and the page scrolled sideways. At 1440 the board
 * is the square grid again, its units 70px or more, as they were at 1280.
 */
const atLaptopWidth: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
};

// The board laid out as the square grid: its widgets' area 950px or wider.
const expectSquareGrid: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  const board: Locator = page.getByTestId("dashboard-board");

  await expect(board).toHaveAttribute("data-arrangement", "grid");
  // Less the board's 8px padding on each side.
  expect(
    await board.evaluate((element: Element): number => {
      return element.clientWidth - 16;
    }),
  ).toBeGreaterThanOrEqual(950);
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

    /*
     * The database ordered the whole list: the monitors that are checked
     * first, then by priority, highest first.
     */
    expect((await lastListOf(page, "Monitor", from)).sort).toEqual({
      disableActiveMonitoring: "ASC",
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
    // Best first, and the monitor nobody checks still last.
    expect((await lastListOf(page, "Monitor", from)).sort).toEqual({
      disableActiveMonitoring: "ASC",
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

  /*
   * A monitor whose monitoring is off is not checked: its status is only what
   * its last check saw (#6476, #6477). The list keeps it - it is still one of
   * the project's monitors - but its row says Disabled, in gray, and it never
   * sorts ahead of a monitor that is checked. An archived monitor is in no
   * monitor list.
   */
  test("a monitor whose monitoring is off says Disabled and comes after every checked one; an archived one is never listed", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openApp(page);

    const table: Locator = monitorsTable(page);
    const rowOf: (name: string) => Locator = (name: string): Locator => {
      return table.locator("tbody tr").filter({
        has: page.getByRole("link", { name, exact: true }),
      });
    };
    const dotOf: (name: string) => Locator = (name: string): Locator => {
      return rowOf(name)
        .getByTestId("monitor-list-status")
        .locator("span")
        .first();
    };

    // By name, with the others - its row saying Disabled, not Offline.
    await expectRows(table, MONITORS_BY_NAME);
    await expectRows(table, STATUSES_BY_NAME, STATUS_COLUMN);
    await expect(dotOf("legacy-api")).toHaveCSS(
      "background-color",
      "rgb(107, 114, 128)",
    );
    await expect(dotOf("auth")).toHaveCSS(
      "background-color",
      "rgb(239, 68, 68)",
    );

    /*
     * The read asked for the column that says so, and for no archived
     * monitor: archived-cdn, second by name, is in no row.
     */
    const read: FixtureList = await lastListOf(page, "Monitor", 0);
    expect(read.select).toEqual(
      expect.objectContaining({ disableActiveMonitoring: true }),
    );
    expect(await columnOf(table, 0)).not.toContain("archived-cdn");

    // Worst first, it is last: nobody checks it, so it is no live problem.
    await press(header(table, "status"));
    await expectRows(table, MONITORS_WORST_FIRST);
    await expectRows(table, STATUSES_WORST_FIRST, STATUS_COLUMN);

    await shoot(page, testInfo, "monitoring-off-last", table);

    // Best first, it is last as well: no status of its own to rank.
    await press(header(table, "status"));
    await expectRows(table, MONITORS_BEST_FIRST);
    await expectRows(table, STATUSES_BEST_FIRST, STATUS_COLUMN);
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
   * ending in "...", down to 6rem (DashboardResourceListBase). Units 70px
   * wide (atLaptopWidth): beside the side menu at 1280 they are 60px, and
   * the list scrolls its last column inside its widget there.
   */
  test("at 6 units, an incident list with a long title fits its widget: the title ends in ... and the sort's arrow is in sight", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await atLaptopWidth(page);
    await openApp(page, "?titles=long");
    await expectSquareGrid(page);

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
     * The rows fit the widget: nothing scrolls sideways. Read once, the
     * moment the title shows: the widget is drawn at its size from its
     * first frame ("each widget is drawn once, at its own size", below).
     * When the board drew its widgets small first and grew them, a busy
     * runner (14.0.94's gate) read 433 pixels of rows in a 426-pixel box
     * here, mid-growth, where the list fits at 438 in 438.
     */
    const fit: Fit = await readFit();
    expect(fit.scrollWidth - fit.boxWidth).toBeLessThanOrEqual(1);

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
    // Disabled in German; the project's own statuses as the project named them.
    await expectRows(
      monitorsTable(page),
      [...STATUSES_WORST_FIRST.slice(0, -1), "Deaktiviert"],
      STATUS_COLUMN,
    );
    await expect(header(monitorsTable(page), "name")).toHaveAttribute(
      "title",
      "Sortieren: A bis Z",
    );
    await shoot(page, testInfo, "german", monitorsTable(page));
  });
});

/*
 * A monitor list drawn as a honeycomb (?view=honeycomb, #6966): a tile per
 * monitor, which says what it is only in the tooltip under the pointer.
 * legacy-api, whose monitoring is off, is the gray tile, and the honeycomb
 * has no legend: the tooltip is the one place that says gray is Disabled.
 *
 * The tooltip is position:fixed, at the tile's place in the window. A
 * widget's card is overflow-hidden and transformed, which makes a fixed
 * layer inside it fixed to the card - so the tooltip is drawn outside the
 * card: on the body, or on the board while the board is in full screen
 * (the browser draws nothing else then).
 */
test.describe("a honeycomb tile's tooltip", () => {
  // Gray500, the color of a monitor whose monitoring is off.
  const GRAY: string = "rgb(107, 114, 128)";

  interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }

  // Where the tooltip is drawn, and what of it can be seen.
  interface TooltipPlace {
    parent: "body" | "full-screen element" | "elsewhere";
    box: Box;
    window: { width: number; height: number };
    // The tooltip's center and four corners, each drawn on top of the page.
    pointsOnTop: number;
    background: string;
  }

  const tiles: (page: Page) => Locator = (page: Page): Locator => {
    return page.getByTestId("dashboard-honeycomb-tile");
  };

  const tooltip: (page: Page) => Locator = (page: Page): Locator => {
    return page.getByTestId("dashboard-honeycomb-tooltip");
  };

  const openHoneycomb: (page: Page, search?: string) => Promise<void> = async (
    page: Page,
    search?: string,
  ): Promise<void> => {
    await page.goto(`${APP_PATH}?view=honeycomb${search || ""}`);
    // A tile for every monitor listed; archived-cdn is not.
    await expect(tiles(page)).toHaveCount(MONITORS_BY_NAME.length, {
      timeout: 60000,
    });
  };

  // The one gray tile: legacy-api's.
  const grayTile: (page: Page) => Promise<Locator> = async (
    page: Page,
  ): Promise<Locator> => {
    const colors: Array<string> = await tiles(page).evaluateAll(
      (elements: Array<Element>): Array<string> => {
        return elements.map((element: Element): string => {
          return window.getComputedStyle(element).backgroundColor;
        });
      },
    );

    expect(
      colors.filter((color: string): boolean => {
        return color === GRAY;
      }),
    ).toHaveLength(1);

    return tiles(page).nth(colors.indexOf(GRAY));
  };

  const boxOf: (locator: Locator) => Promise<Box> = async (
    locator: Locator,
  ): Promise<Box> => {
    return locator.evaluate((element: Element): Box => {
      const rect: DOMRect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    });
  };

  /*
   * The tooltip lets the pointer through (pointer-events: none), so the
   * check of what is drawn on top of it lets it take the pointer for the
   * moment of the check.
   */
  const placeOf: (page: Page) => Promise<TooltipPlace> = async (
    page: Page,
  ): Promise<TooltipPlace> => {
    return tooltip(page).evaluate((element: HTMLElement): TooltipPlace => {
      const rect: DOMRect = element.getBoundingClientRect();
      const inset: number = 4;
      const points: Array<[number, number]> = [
        [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2],
        [rect.left + inset, rect.top + inset],
        [rect.right - inset, rect.top + inset],
        [rect.left + inset, rect.bottom - inset],
        [rect.right - inset, rect.bottom - inset],
      ];

      element.style.pointerEvents = "auto";
      const pointsOnTop: number = points.filter(
        ([x, y]: [number, number]): boolean => {
          const hit: Element | null = document.elementFromPoint(x, y);
          return Boolean(hit && element.contains(hit));
        },
      ).length;
      element.style.pointerEvents = "";

      const parent: HTMLElement | null = element.parentElement;

      return {
        parent:
          parent === document.body
            ? "body"
            : parent && parent === document.fullscreenElement
              ? "full-screen element"
              : "elsewhere",
        box: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
        window: { width: window.innerWidth, height: window.innerHeight },
        pointsOnTop,
        background: window.getComputedStyle(element).backgroundColor,
      };
    });
  };

  /*
   * The pointer on a tile. On a phone the board shows one widget under
   * another, so the tile is scrolled to first.
   */
  const pointAt: (tile: Locator) => Promise<void> = async (
    tile: Locator,
  ): Promise<void> => {
    await tile.scrollIntoViewIfNeeded();
    await tile.hover();
  };

  /*
   * All of the tooltip in the window, on top of everything, beside its tile
   * (above it, or below when there is no room above) and over it from side
   * to side, as far as the window's 8px margins let it be.
   */
  const expectBesideItsTile: (place: TooltipPlace, tile: Box) => void = (
    place: TooltipPlace,
    tile: Box,
  ): void => {
    expect(place.box.left).toBeGreaterThanOrEqual(0);
    expect(place.box.top).toBeGreaterThanOrEqual(0);
    expect(place.box.right).toBeLessThanOrEqual(place.window.width);
    expect(place.box.bottom).toBeLessThanOrEqual(place.window.height);
    expect(place.pointsOnTop).toBe(5);

    const isAbove: boolean = place.box.bottom <= tile.top + 1;
    const gap: number = isAbove
      ? tile.top - place.box.bottom
      : place.box.top - tile.bottom;

    /*
     * 8px from the tile, as it is placed. It measures its own height once,
     * when it opens, so a line that settles after that can move its far
     * edge by a pixel or two - never by the card's distance from the window.
     */
    expect(gap).toBeGreaterThanOrEqual(-1);
    expect(gap).toBeLessThanOrEqual(16);
    expect(place.box.left).toBeLessThan(tile.right);
    expect(place.box.right).toBeGreaterThan(tile.left);
  };

  test("a gray tile says it is Disabled, in a tooltip on the page beside it that nothing covers, gone when the pointer leaves", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openHoneycomb(page);

    const tile: Locator = await grayTile(page);
    await pointAt(tile);

    await expect(tooltip(page)).toHaveCount(1);
    await expect(tooltip(page)).toBeVisible();
    await expect(tooltip(page)).toContainText("legacy-api");
    await expect(tooltip(page)).toContainText("Disabled");
    await expect(tooltip(page)).toContainText("Click to open");
    // The keyboard's words are for a tile reached with Tab (#7347).
    await expect(tooltip(page)).not.toContainText("Press Enter to open");

    const place: TooltipPlace = await placeOf(page);
    expect(place.parent).toBe("body");
    expectBesideItsTile(place, await boxOf(tile));

    await shoot(page, testInfo, "honeycomb-tooltip", undefined);

    // Off the board, and the tooltip goes with the pointer.
    await page.mouse.move(1, 1);
    await expect(tooltip(page)).toHaveCount(0);
  });

  test("a checked tile's tooltip says its status, the one tooltip on the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openHoneycomb(page);

    const gray: Locator = await grayTile(page);
    await pointAt(gray);
    await expect(tooltip(page)).toContainText("Disabled");

    // auth is Offline: red, and checked.
    const colors: Array<string> = await tiles(page).evaluateAll(
      (elements: Array<Element>): Array<string> => {
        return elements.map((element: Element): string => {
          return window.getComputedStyle(element).backgroundColor;
        });
      },
    );
    const red: Locator = tiles(page).nth(colors.indexOf("rgb(239, 68, 68)"));

    await pointAt(red);
    await expect(tooltip(page)).toHaveCount(1);
    await expect(tooltip(page)).toContainText("Offline");
    await expect(tooltip(page)).not.toContainText("Disabled");
    expectBesideItsTile(await placeOf(page), await boxOf(red));
  });

  // At 1280 and in a phone's window, as the light theme's test above.
  test("in the dark theme the tooltip is drawn dark, on the page beside its tile", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openHoneycomb(page, "&theme=dark");
    const tile: Locator = await grayTile(page);
    await pointAt(tile);

    await expect(tooltip(page)).toHaveCount(1);
    await expect(tooltip(page)).toContainText("Disabled");
    const dark: TooltipPlace = await placeOf(page);
    expect(dark.parent).toBe("body");
    expect(dark.background).not.toBe("rgb(255, 255, 255)");
    expectBesideItsTile(dark, await boxOf(tile));
    await shoot(page, testInfo, "honeycomb-tooltip-dark", undefined);
  });

  test("in German the tooltip says Deaktiviert", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();

    await openHoneycomb(page, "&lang=de");
    const tile: Locator = await grayTile(page);
    await pointAt(tile);

    await expect(tooltip(page)).toContainText("Deaktiviert");
    await expect(tooltip(page)).toContainText("Zum Öffnen klicken");
    await expect(tooltip(page)).not.toContainText("Disabled");
    expectBesideItsTile(await placeOf(page), await boxOf(tile));
    await shoot(page, testInfo, "honeycomb-tooltip-german", undefined);
  });

  /*
   * A tile reached from the keyboard says what it is, as one under the
   * pointer does, and shows where the focus is: a ring round the hexagon
   * the tile is clipped to (the clip cuts away any outline drawn on the
   * tile itself), in the theme's focus color. Escape puts the tooltip away
   * and leaves the focus, and the ring, where they are.
   */
  test("a tile reached with Tab is ringed and says it is Disabled, and Escape puts its tooltip away", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openHoneycomb(page);

    const gray: Locator = await grayTile(page);
    const colors: Array<string> = await tiles(page).evaluateAll(
      (elements: Array<Element>): Array<string> => {
        return elements.map((element: Element): string => {
          return window.getComputedStyle(element).backgroundColor;
        });
      },
    );
    const grayIndex: number = colors.indexOf(GRAY);

    /*
     * From the tile beside it, with the key a keyboard reader presses:
     * Tab from the one before, or Shift+Tab from the one after.
     */
    const from: number = grayIndex > 0 ? grayIndex - 1 : grayIndex + 1;
    await tiles(page).nth(from).focus();
    await page.keyboard.press(grayIndex > 0 ? "Tab" : "Shift+Tab");

    await expect(gray).toBeFocused();
    await expect(tooltip(page)).toHaveCount(1);
    await expect(tooltip(page)).toContainText("legacy-api");
    await expect(tooltip(page)).toContainText("Disabled");
    // Reached with the keyboard, it says how the keyboard opens it (#7347).
    await expect(tooltip(page)).toContainText("Press Enter to open");
    await expect(tooltip(page)).not.toContainText("Click to open");
    expectBesideItsTile(await placeOf(page), await boxOf(gray));

    // A button named for its monitor, which its open tooltip describes.
    await expect(gray).toHaveAttribute("role", "button");
    await expect(gray).toHaveAttribute("aria-label", "legacy-api");
    const tooltipId: string | null = await tooltip(page).getAttribute("id");
    expect(tooltipId).toBeTruthy();
    await expect(gray).toHaveAttribute("aria-describedby", tooltipId!);

    // The ring: round the tile on every side, in the light theme's focus color.
    const ring: Locator = page.getByTestId("dashboard-honeycomb-focus-ring");
    await expect(ring).toHaveCount(1);
    await expect(ring).toBeVisible();
    const tileBox: Box = await boxOf(gray);
    const ringPlace: { box: Box; stroke: string; strokeWidth: string } =
      await ring.evaluate(
        (
          element: Element,
        ): { box: Box; stroke: string; strokeWidth: string } => {
          const polygon: Element = element.querySelector("polygon")!;
          const rect: DOMRect = polygon.getBoundingClientRect();
          const style: CSSStyleDeclaration = window.getComputedStyle(polygon);
          return {
            box: {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
            },
            stroke: style.stroke,
            strokeWidth: style.strokeWidth,
          };
        },
      );
    expect(ringPlace.box.left).toBeLessThan(tileBox.left - 1);
    expect(ringPlace.box.right).toBeGreaterThan(tileBox.right + 1);
    expect(ringPlace.box.top).toBeLessThan(tileBox.top - 1);
    expect(ringPlace.box.bottom).toBeGreaterThan(tileBox.bottom + 1);
    expect(ringPlace.stroke).toBe("rgb(79, 70, 229)");
    expect(ringPlace.strokeWidth).toBe("2px");

    await shoot(page, testInfo, "honeycomb-keyboard", undefined);

    await page.keyboard.press("Escape");
    await expect(tooltip(page)).toHaveCount(0);
    await expect(gray).toBeFocused();
    await expect(ring).toBeVisible();

    // Moving on: the next tile's tooltip, and the ring goes with the focus.
    await page.keyboard.press(grayIndex > 0 ? "Shift+Tab" : "Tab");
    await expect(tiles(page).nth(from)).toBeFocused();
    await expect(tooltip(page)).toHaveCount(1);
    await expect(tooltip(page)).not.toContainText("legacy-api");
    await expect(tooltip(page)).toContainText("Press Enter to open");
    await expect(ring).toHaveCount(1);
  });

  test("in full screen the tooltip is drawn on the board, and leaving full screen takes it away", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openHoneycomb(page);

    await press(page.getByRole("button", { name: "More dashboard options" }));
    await press(page.getByRole("menuitem", { name: "Full Screen" }));
    await expect
      .poll(async (): Promise<boolean> => {
        return page.evaluate((): boolean => {
          return document.fullscreenElement !== null;
        });
      })
      .toBe(true);

    const tile: Locator = await grayTile(page);
    await pointAt(tile);

    await expect(tooltip(page)).toBeVisible();
    await expect(tooltip(page)).toContainText("Disabled");
    const place: TooltipPlace = await placeOf(page);
    expect(place.parent).toBe("full-screen element");
    expectBesideItsTile(place, await boxOf(tile));
    await shoot(page, testInfo, "honeycomb-tooltip-full-screen", undefined);

    /*
     * Out of full screen the board moves back into the page, and the
     * tooltip it opened in full screen is gone.
     */
    await page.evaluate(async (): Promise<void> => {
      await document.exitFullscreen();
    });
    await expect(tooltip(page)).toHaveCount(0);

    // The next tooltip is on the page's body again.
    await page.mouse.move(1, 1);
    await pointAt(tile);
    await expect(tooltip(page)).toBeVisible();
    expect((await placeOf(page)).parent).toBe("body");
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

  /*
   * The table's scroll box, and the height of each of its rows: read once,
   * as soon as its rows show. Its widget is drawn at its size from its first
   * frame ("each widget is drawn once, at its own size", below); when the
   * board drew its widgets small first, master's run of 10-30 read 174
   * pixels of rows in a 153-pixel box here, and 14.0.95's gate 542 in 483,
   * mid-growth.
   */
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

  // Its 6 and 8 units 70px wide or more, as a list's widths were chosen on.
  test("the security events list draws one line per event, at its narrowest too", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await atLaptopWidth(page);
    await openNarrow(page);
    await expectSquareGrid(page);

    const tables: Locator = page.locator("table").filter({
      has: page.getByTestId("dashboard-widget-sort-severity"),
    });
    await expect(tables).toHaveCount(2);

    for (const index of [0, 1]) {
      await expect(tables.nth(index).locator("tbody tr")).toHaveCount(4);
    }

    // Both lists, read once their rows are in.
    const boxes: Array<TableBox> = [
      await measure(tables.nth(0)),
      await measure(tables.nth(1)),
    ];

    // At its default width, the list fits its widget.
    const widest: TableBox = boxes.reduce(
      (wider: TableBox, box: TableBox): TableBox => {
        return box.boxWidth > wider.boxWidth ? box : wider;
      },
    );
    expect(widest.scrollWidth).toBeLessThanOrEqual(widest.boxWidth + 1);

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

// ---- leaving a board being edited (#7173) ----------------------------------

// An entry of the dashboard's side menu, by its name.
const sideMenuLink: (page: Page, name: string) => Locator = (
  page: Page,
  name: string,
): Locator => {
  return page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name, exact: true });
};

// The fixture's stand-in for every page but the board: it says its address.
const elsewhere: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("fixture-elsewhere");
};

const leaveDialog: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByRole("dialog", { name: LEAVE_TITLE });
};

// The board's own text widget, as Add Widget adds it.
const addedTextWidget: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByText("Hello, World!", { exact: true });
};

// Add Widget, Text, then Done on the new widget's settings.
const addTextWidget: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await press(page.getByTitle("Add Widget").first());
  await press(page.getByTestId("widget-card-Text"));

  const settings: Locator = page.getByTestId("modal");

  await press(settings.getByRole("button", { name: "Done" }));
  await expect(settings).toHaveCount(0);
  await expect(addedTextWidget(page)).toBeVisible();
};

/*
 * The browser's own questions before the page unloads, as a reload or a
 * closed tab asks them: the kind of each one the page raises, answered as
 * `answer.now` says - Stay keeps the page, Leave lets it go.
 */
interface BrowserAnswer {
  now: "stay" | "leave";
}

const recordBrowserQuestions: (
  page: Page,
  answer: BrowserAnswer,
) => Array<string> = (page: Page, answer: BrowserAnswer): Array<string> => {
  const raised: Array<string> = [];

  page.on("dialog", async (dialog: Dialog): Promise<void> => {
    raised.push(dialog.type());

    if (answer.now === "stay") {
      await dialog.dismiss();
      return;
    }

    await dialog.accept();
  });

  return raised;
};

// A reload the page starts, after the call returns: it never waits on one.
const startReload: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.evaluate((): void => {
    window.setTimeout((): void => {
      window.location.reload();
    }, 0);
  });
};

test.describe("leaving a dashboard being edited (#7173)", () => {
  test("a board opened for editing and not changed is left at once; with a new widget, leaving asks first, by the side menu and by Back", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    // Opened from its Overview, so Back has a page of the app to go to.
    await page.goto(OVERVIEW_PATH);
    await expect(elsewhere(page)).toHaveText(OVERVIEW_PATH, {
      timeout: 60000,
    });
    await press(sideMenuLink(page, "Dashboard"));
    await expect(monitorsTable(page)).toBeVisible({ timeout: 60000 });
    await expect(monitorsTable(page).locator("tbody tr").first()).toBeVisible();

    // Nothing changed: the toolbar's Cancel stops editing without a question.
    await enterEditMode(page);
    await press(page.getByTitle("Cancel", { exact: true }));
    await expect(page.getByTitle("Save Changes")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Nothing changed: the side menu leaves at once.
    await enterEditMode(page);
    await press(sideMenuLink(page, "Overview"));
    await expect(elsewhere(page)).toHaveText(OVERVIEW_PATH);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await press(sideMenuLink(page, "Dashboard"));
    await expect(monitorsTable(page).locator("tbody tr").first()).toBeVisible();
    await enterEditMode(page);
    await addTextWidget(page);

    // A new widget, unsaved: the side menu asks, in the toolbar's Cancel words.
    await press(sideMenuLink(page, "Overview"));

    const dialog: Locator = leaveDialog(page);

    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(LEAVE_DESCRIPTION);
    await expect(
      dialog.getByRole("button", { name: "Keep Editing" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Discard Changes" }),
    ).toBeVisible();
    await expect(page).toHaveURL(APP_PATH);
    await expect(elsewhere(page)).toHaveCount(0);
    await shoot(page, testInfo, "leave-unsaved-dialog", dialog);

    // Keep Editing: the board as it was, still being edited.
    await press(dialog.getByRole("button", { name: "Keep Editing" }));
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTitle("Save Changes")).toBeVisible();
    await expect(addedTextWidget(page)).toBeVisible();
    await expect(page).toHaveURL(APP_PATH);

    // The toolbar's Cancel asks in the same voice; Keep Editing stays.
    await press(page.getByTitle("Cancel", { exact: true }));

    const cancelDialog: Locator = page.getByRole("dialog", {
      name: CANCEL_TITLE,
    });

    await expect(cancelDialog).toBeVisible();
    await expect(cancelDialog).toContainText(CANCEL_DESCRIPTION);
    await shoot(page, testInfo, "cancel-unsaved-dialog", cancelDialog);
    await press(cancelDialog.getByRole("button", { name: "Keep Editing" }));
    await expect(cancelDialog).toHaveCount(0);
    await expect(page.getByTitle("Save Changes")).toBeVisible();
    await expect(addedTextWidget(page)).toBeVisible();

    // The browser's Back asks too, and the board stays where it is.
    await page.evaluate((): void => {
      window.history.back();
    });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(APP_PATH);
    await expect(elsewhere(page)).toHaveCount(0);
    await press(dialog.getByRole("button", { name: "Keep Editing" }));
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(APP_PATH);
    await expect(addedTextWidget(page)).toBeVisible();

    // Back again, and Discard Changes: the page before, nothing saved.
    await page.evaluate((): void => {
      window.history.back();
    });
    await press(dialog.getByRole("button", { name: "Discard Changes" }));
    await expect(elsewhere(page)).toHaveText(OVERVIEW_PATH);
    await expect(page).toHaveURL(OVERVIEW_PATH);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await record(page)).saves || []).toEqual([]);
  });

  test("a reload asks the browser's question while a change is unsaved, and after Save Changes nothing asks", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openApp(page);
    await enterEditMode(page);
    await addTextWidget(page);

    const answer: BrowserAnswer = { now: "stay" };
    const raised: Array<string> = recordBrowserQuestions(page, answer);

    // The browser asks; staying keeps the board as it was being edited.
    await startReload(page);
    await expect
      .poll((): Array<string> => {
        return raised;
      })
      .toEqual(["beforeunload"]);
    await expect(page.getByTitle("Save Changes")).toBeVisible();
    await expect(addedTextWidget(page)).toBeVisible();

    await press(page.getByRole("button", { name: "Save Changes" }));
    await expect
      .poll(async (): Promise<number> => {
        return ((await record(page)).saves || []).length;
      })
      .toBe(1);
    await expect(page.getByTitle("Save Changes")).toHaveCount(0);

    /*
     * Saved: a reload asks nothing, and opens the board as saved. Were it to
     * ask, Leave lets the reload go on, and the question is counted.
     */
    answer.now = "leave";
    await page.reload();
    await expect(monitorsTable(page)).toBeVisible({ timeout: 60000 });
    await expect(addedTextWidget(page)).toBeVisible();
    expect(raised).toEqual(["beforeunload"]);

    // And the side menu leaves at once.
    await press(sideMenuLink(page, "Overview"));
    await expect(elsewhere(page)).toHaveText(OVERVIEW_PATH);
    await expect(page.getByRole("dialog")).toHaveCount(0);
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

    /*
     * The public page lists what the board lists: no archived monitor, and
     * the one whose monitoring is off saying Disabled, last when sorted.
     */
    await expectRows(table, MONITORS_BY_NAME);
    await expectRows(table, STATUSES_BY_NAME, STATUS_COLUMN);

    await press(header(table, "status"));
    await expectRows(table, MONITORS_WORST_FIRST);
    await expectRows(table, STATUSES_WORST_FIRST, STATUS_COLUMN);

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

/*
 * Each widget is drawn once, at its own size (14.0.95's gate). The board
 * drew every widget a few pixels across first - laid out for a board of no
 * width, before it had measured its own - and their measured size came in
 * through their transition: on every load each widget grew from a sliver to
 * its size over a quarter of a second, with its rows already in it, and the
 * checks above that read a widget's table as its rows showed read it
 * mid-growth on busy runners. The board's own width never changed.
 *
 * Every frame the page draws is recorded from its first
 * (SuiteHelpers/DrawnBoxes): each widget, and the board, must be drawn at
 * one size and in one place in all of them - from the first frame it is
 * drawn in to a quarter of a second after the rows are in - with no
 * animation running on it. And the empty board is never drawn: the
 * dashboard inside OneUptime opened on "No widgets yet" and Add Widget, for
 * the frame before it began to read its board.
 */
test.describe("each widget is drawn once, at its own size", () => {
  const BLANK_BOARD: string = "dashboard-blank-canvas";

  // The widgets' boxes, the board's own and the empty board's; each widget's rows.
  const DRAWN: { selector: string; contentSelector: string } = {
    selector: `[id^="dashboard-component-"], [data-testid="dashboard-board"], [data-testid="${BLANK_BOARD}"]`,
    contentSelector: "tbody tr",
  };

  /*
   * An error event on the window that is no exception - "ResizeObserver
   * loop completed with undelivered notifications" - reaches neither the
   * console nor pageerror (ModelTables.spec.ts): recorded from the page's
   * first script. The board raised it on a wide window's first frame and
   * on every resize while it laid its widgets out inside its observer's
   * call, where the side menu's observer of the page's body shared the
   * frame.
   */
  const recordWindowErrors: (page: Page) => Promise<void> = async (
    page: Page,
  ): Promise<void> => {
    await page.addInitScript((): void => {
      const errors: Array<string> = [];

      window.__windowErrors = errors;
      window.addEventListener("error", (event: ErrorEvent): void => {
        errors.push(String(event.message));
      });
    });
  };

  const windowErrors: (page: Page) => Promise<Array<string>> = async (
    page: Page,
  ): Promise<Array<string>> => {
    return page.evaluate((): Array<string> => {
      return window.__windowErrors || [];
    });
  };

  const openRecorded: (page: Page, path: string) => Promise<void> = async (
    page: Page,
    path: string,
  ): Promise<void> => {
    await recordDrawnBoxes(page, DRAWN);
    await recordWindowErrors(page);
    await page.goto(path);
    await expect(
      page.getByTestId("dashboard-board").locator("tbody tr").first(),
    ).toBeVisible({ timeout: 60000 });
  };

  const expectEachDrawnOnce: (page: Page) => Promise<void> = async (
    page: Page,
  ): Promise<void> => {
    /*
     * A quarter of a second of frames more - some 15 at 60 a second; the
     * growth lasted 220 ms - so whatever still moves is drawn and recorded.
     */
    await waitForFrames(page, 30);

    const drawn: DrawnBoxes = await readDrawnBoxes(page);
    const widgets: Array<string> = Object.keys(drawn).filter(
      (key: string): boolean => {
        return key.startsWith("dashboard-component-");
      },
    );

    expect(widgets.length).toBeGreaterThan(1);
    expect(Object.keys(drawn)).toContain("dashboard-board");

    // Its rows were in, in some widget, before the record was read.
    expect(
      widgets.some((key: string): boolean => {
        return drawn[key]!.some((box: DrawnBox): boolean => {
          return box.content > 0;
        });
      }),
    ).toBe(true);

    /*
     * Soft, so a failure names everything that moved, the empty board and
     * each widget, not only the first.
     */
    expect
      .soft(
        drawn[BLANK_BOARD],
        "the empty board, drawn while a board with widgets opened",
      )
      .toBeUndefined();

    expect
      .soft(await windowErrors(page), "error events on the window")
      .toEqual([]);

    for (const key of Object.keys(drawn)) {
      if (key === BLANK_BOARD) {
        continue;
      }

      const boxes: Array<DrawnBox> = drawn[key]!;

      expect
        .soft(
          drawnPlacesOf(boxes),
          `${key}: every size and place it was drawn at, in the order drawn`,
        )
        .toHaveLength(1);
      expect
        .soft(
          Math.max(
            ...boxes.map((box: DrawnBox): number => {
              return box.animations;
            }),
          ),
          `${key}: animations that ran on it`,
        )
        .toBe(0);
    }
  };

  test("at 1280 beside the side menu, every widget is drawn at its size from its first frame", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openRecorded(page, APP_PATH);
    await expectEachDrawnOnce(page);
  });

  test("the narrow widgets too, where a list read mid-growth ran past its box", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openRecorded(page, `${APP_PATH}?board=narrow`);
    await expectEachDrawnOnce(page);
  });

  test("at 1440, where the grid's units are square and its rows grow with the board", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await atLaptopWidth(page);
    await openRecorded(page, `${APP_PATH}?board=narrow`);
    await expectSquareGrid(page);
    await expectEachDrawnOnce(page);
  });

  test("in a wide window, where the grid's rows grow with the board", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await page.setViewportSize({ width: 1600, height: 900 });
    await openRecorded(page, APP_PATH);
    await expectSquareGrid(page);
    await expectEachDrawnOnce(page);
  });

  test("on a public dashboard", async ({ page }: { page: Page }) => {
    atDesktopOnly();
    await openRecorded(page, PUBLIC_PATH);
    await expectEachDrawnOnce(page);
  });

  /*
   * The frames in which the widgets do not end where the board's grid
   * does: a widget drawn at a width the board no longer has (past its
   * edge) or does not have yet (short of it). Each element is read where
   * it was in that frame (drawnBoxAt); the fixture's board has widgets as
   * wide as the grid, and each widget's place is inside the grid, which
   * starts and ends 8px inside the board.
   */
  const framesOffTheGrid: (drawn: DrawnBoxes) => Array<string> = (
    drawn: DrawnBoxes,
  ): Array<string> => {
    const board: Array<DrawnBox> = drawn["dashboard-board"] || [];
    const widgets: Array<Array<DrawnBox>> = Object.keys(drawn)
      .filter((key: string): boolean => {
        return key.startsWith("dashboard-component-");
      })
      .map((key: string): Array<DrawnBox> => {
        return drawn[key]!;
      });
    const frames: Array<number> = Array.from(
      new Set<number>(
        [board, ...widgets].flat().map((box: DrawnBox): number => {
          return box.frame;
        }),
      ),
    ).sort((a: number, b: number): number => {
      return a - b;
    });
    const off: Array<string> = [];

    for (const frame of frames) {
      const boardBox: DrawnBox | null = drawnBoxAt(board, frame);
      const ends: Array<number> = [];

      for (const boxes of widgets) {
        const box: DrawnBox | null = drawnBoxAt(boxes, frame);

        if (box) {
          ends.push(box.x + box.width);
        }
      }

      if (!boardBox || ends.length < widgets.length) {
        continue;
      }

      const gridEnd: number = boardBox.width - 16;
      const widgetsEnd: number = Math.max(...ends);

      if (Math.abs(widgetsEnd - gridEnd) > 1) {
        off.push(
          `frame ${frame}: the widgets end at ${Math.round(widgetsEnd)}px, the grid at ${Math.round(gridEnd)}px`,
        );
      }
    }

    return off;
  };

  test("a window resized while viewing: in every frame the widgets end where the board's grid does, and the page raises no error", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openRecorded(page, APP_PATH);
    await waitForFrames(page, 10);

    /*
     * Narrower, wider, under the side menu's breakpoint and back over it:
     * the side menu comes and goes a moment after the window is resized,
     * and the board's width with it.
     */
    for (const width of [1100, 1440, 760, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await waitForFrames(page, 30);
    }

    const drawn: DrawnBoxes = await readDrawnBoxes(page);

    // The board was drawn at each of those widths.
    expect(drawnPlacesOf(drawn["dashboard-board"]!).length).toBeGreaterThan(4);
    expect(framesOffTheGrid(drawn)).toEqual([]);
    expect(await windowErrors(page)).toEqual([]);
  });

  test("on a phone, one widget under another", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(
      !test.info().project.use.isMobile,
      "A phone's board: at 1280 above.",
    );
    await openRecorded(page, APP_PATH);
    await expect(page.getByTestId("dashboard-board")).toHaveAttribute(
      "data-arrangement",
      "stacked",
    );
    await expectEachDrawnOnce(page);
  });
});
