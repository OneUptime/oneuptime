import { expect, Locator, Page, Route, test, TestInfo } from "@playwright/test";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";

/*
 * A dashboard's default time range and auto-refresh, and each viewer's own
 * picks (issue #5080), in a real browser, on both surfaces: the dashboard
 * inside OneUptime (its real view layout and Dashboard page) and the public
 * dashboard (its own index.ejs and app), with only the data boundary
 * answered from fixture data (DashboardTimeRange/Fixture). See README.md.
 *
 *   - A dashboard opens on its saved defaults - every widget reads that
 *     window - or, saved before them, on the past hour with auto-refresh off.
 *   - A viewer's preset and interval are remembered for the dashboard in
 *     their browser and written into the address; "Default (...)", the first
 *     choice of each picker, goes back to the dashboard's own and forgets
 *     them. A link's ?range= / ?refresh= opens on its own values.
 *   - While editing, a row under the toolbar's buttons sets the defaults on
 *     purpose; Save Changes saves them, Discard Changes drops them, and a
 *     save never turns the interval the editor picked while viewing into
 *     the dashboard's.
 *
 * Screenshots of the toolbar, the pickers and the editing row are saved for
 * review under output/playwright/dashboard-time-range-ui.
 */

interface FixtureWindow {
  start: number | null;
  end: number | null;
  metricName: string;
}

interface FixtureSave {
  id: string;
  dashboardViewConfig: Record<string, unknown>;
}

interface FixtureRecord {
  aggregates: Array<FixtureWindow>;
  saves?: Array<FixtureSave> | undefined;
  unexpected: Array<string>;
}

declare global {
  interface Window {
    __dashboardTimeRangeFixture?: FixtureRecord | undefined;
  }
}

const PORT: string = "4371";

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000d1";

const dashboardId: (value: number) => string = (value: number): string => {
  return `db000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

// The fixture's dashboards (Fixture/Boards.js).
const DASHBOARDS: Record<"wall" | "plain" | "weekly" | "empty", string> = {
  // Past 1 Day, refreshing every minute.
  wall: dashboardId(1),
  // Saved before the defaults: the past hour, auto-refresh off.
  plain: dashboardId(2),
  // Past 1 Week, auto-refresh off.
  weekly: dashboardId(3),
  // A new dashboard with no widget yet.
  empty: dashboardId(4),
};

type DashboardKey = keyof typeof DASHBOARDS;

/*
 * The metrics one look at the fixture's board reads: its values, gauges and
 * charts (the product's Metrics Dashboard template). A metric two widgets
 * read over the same window may be asked for once (Metrics.ts coalesces
 * identical reads), so the board is counted by its metrics, not its reads.
 */
const BOARD_METRICS: number = 11;

const SCREENSHOTS: string = "../../output/playwright/dashboard-time-range-ui";

const HOUR: number = 60 * 60 * 1000;

// The editing row and the auto-refresh menu's choice (DashboardDefaultsCopy).
const DEFAULTS_BAR: string = "dashboard-defaults-bar";
const DEFAULT_TIME_RANGE_PICKER: string = "dashboard-default-time-range";
const DEFAULT_AUTO_REFRESH_PICKER: string = "dashboard-default-auto-refresh";
const AUTO_REFRESH_DEFAULT_CHOICE: string = "dashboard-auto-refresh-default";

// The public dashboard's auto-refresh menu (DashboardToolbarCopy).
const PUBLIC_AUTO_REFRESH_MENU: string = "public-dashboard-auto-refresh";
const PUBLIC_AUTO_REFRESH_DEFAULT_CHOICE: string =
  "public-dashboard-auto-refresh-default";

const TICK: string = String.fromCharCode(0x2713);

const appPath: (key: DashboardKey, search?: string) => string = (
  key: DashboardKey,
  search?: string,
): string => {
  return `/dashboard/${PROJECT_ID}/dashboards/${DASHBOARDS[key]}${search || ""}`;
};

const publicPath: (key: DashboardKey, search?: string) => string = (
  key: DashboardKey,
  search?: string,
): string => {
  return `/public-dashboard/${DASHBOARDS[key]}${search || ""}`;
};

const timeRangeKey: (key: DashboardKey) => string = (
  key: DashboardKey,
): string => {
  return `oneuptime-dashboard-time-range:${DASHBOARDS[key]}`;
};

const autoRefreshKey: (key: DashboardKey) => string = (
  key: DashboardKey,
): string => {
  return `oneuptime-dashboard-auto-refresh:${DASHBOARDS[key]}`;
};

const record: (page: Page) => Promise<FixtureRecord> = async (
  page: Page,
): Promise<FixtureRecord> => {
  return page.evaluate((): FixtureRecord => {
    return (
      window.__dashboardTimeRangeFixture || { aggregates: [], unexpected: [] }
    );
  });
};

const savesOf: (page: Page) => Promise<Array<FixtureSave>> = async (
  page: Page,
): Promise<Array<FixtureSave>> => {
  return (await record(page)).saves || [];
};

const kept: (page: Page, key: string) => Promise<string | null> = async (
  page: Page,
  key: string,
): Promise<string | null> => {
  return page.evaluate((storageKey: string): string | null => {
    return window.localStorage.getItem(storageKey);
  }, key);
};

const linkParameter: (page: Page, name: string) => string | null = (
  page: Page,
  name: string,
): string | null => {
  return new URL(page.url()).searchParams.get(name);
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
    fullPage: true,
  });
};

/*
 * A press on a control of the dashboard's toolbar, as the viewer makes it.
 *
 * The dashboard in the app is 1000px wide (DashboardView: minWidth), so on
 * a phone its toolbar sits past the screen's right edge and the viewer
 * scrolls to it; the public dashboard's toolbar fits the screen, and only
 * its board scrolls, in its own frame (DashboardViewLayout). Playwright's
 * own click cannot reach a control the viewer scrolls to - in the phone
 * emulation the browser scrolls the visual viewport, and the check of what
 * is under the pointer looks at the wrong place - so on the phone the
 * control is scrolled to, must be visible and enabled, and gets the click
 * a tap ends in (as the public dashboard theme suite does); at 1280 it is
 * Playwright's real click.
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

/*
 * The phone (390px) runs what a phone changes: reaching the toolbar past
 * the screen's edge, the pickers, menus and editing row at its width, and
 * the picks they make. What the same logic decides at any width - links,
 * saves, Discard, languages - runs at 1280 alone.
 */
const atDesktopOnly: () => void = (): void => {
  test.skip(
    Boolean(test.info().project.use.isMobile),
    "The same at any width: covered at 1280.",
  );
};

const aggregateCount: (page: Page) => Promise<number> = async (
  page: Page,
): Promise<number> => {
  return (await record(page)).aggregates.length;
};

/*
 * Every window the widgets asked for since `from` (an index into the
 * fixture's record) once the whole board has read again - every one of its
 * metrics, and no read still coming - as hours.
 */
const windowsSince: (
  page: Page,
  from: number,
) => Promise<Array<number>> = async (
  page: Page,
  from: number,
): Promise<Array<number>> => {
  await expect
    .poll(
      async (): Promise<number> => {
        const names: Set<string> = new Set(
          (await record(page)).aggregates
            .slice(from)
            .map((window: FixtureWindow): string => {
              return window.metricName;
            }),
        );

        return names.size;
      },
      { timeout: 30000 },
    )
    .toBeGreaterThanOrEqual(BOARD_METRICS);

  let lastCount: number = -1;

  await expect
    .poll(
      async (): Promise<boolean> => {
        const count: number = await aggregateCount(page);
        const isSettled: boolean = count === lastCount;

        lastCount = count;

        return isSettled;
      },
      { intervals: [500], timeout: 30000 },
    )
    .toBe(true);

  return (await record(page)).aggregates
    .slice(from)
    .map((window: FixtureWindow): number => {
      return (
        Math.round((((window.end || 0) - (window.start || 0)) / HOUR) * 10) / 10
      );
    });
};

// The whole board read `hours` hours, and nothing else, since `from`.
const expectWidgetsRead: (
  page: Page,
  from: number,
  hours: number,
) => Promise<void> = async (
  page: Page,
  from: number,
  hours: number,
): Promise<void> => {
  const spans: Array<number> = await windowsSince(page, from);

  expect(
    spans.filter((span: number): boolean => {
      return span !== hours;
    }),
  ).toEqual([]);
};

// The toolbar's time range button, by the range it names.
const rangeButton: (page: Page, label: string) => Locator = (
  page: Page,
  label: string,
): Locator => {
  return page.getByRole("button", { name: label, exact: true });
};

const openRangePicker: (page: Page, label: string) => Promise<Locator> = async (
  page: Page,
  label: string,
): Promise<Locator> => {
  await press(rangeButton(page, label));

  const rail: Locator = page.getByRole("radiogroup");

  await expect(rail).toBeVisible();

  return rail;
};

const openApp: (
  page: Page,
  key: DashboardKey,
  label: string,
  search?: string,
) => Promise<void> = async (
  page: Page,
  key: DashboardKey,
  label: string,
  search?: string,
): Promise<void> => {
  await page.goto(appPath(key, search));
  await expect(rangeButton(page, label)).toBeVisible({ timeout: 60000 });
};

const openPublic: (
  page: Page,
  key: DashboardKey,
  label: string,
  search?: string,
) => Promise<void> = async (
  page: Page,
  key: DashboardKey,
  label: string,
  search?: string,
): Promise<void> => {
  await page.goto(publicPath(key, search));
  await expect(rangeButton(page, label)).toBeVisible({ timeout: 60000 });
};

// The dashboard's auto-refresh button (its icon or countdown, and a label).
const appAutoRefresh: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTitle("Auto-refresh settings");
};

/*
 * What the button says: "Auto-refresh: Off", or the interval beside the
 * countdown while one is on.
 */
const expectAppAutoRefreshShows: (
  page: Page,
  label: string,
) => Promise<void> = async (page: Page, label: string): Promise<void> => {
  await expect(appAutoRefresh(page).locator("span").last()).toHaveText(label);
};

const publicAutoRefresh: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId(PUBLIC_AUTO_REFRESH_MENU);
};

/*
 * The toolbar's menu words in Persian: the Dashboard draws them translated
 * (since #5287), so its button and item are found by them.
 */
const PERSIAN_EDIT_WORDS: { options: string; edit: string } = {
  options: "گزینه‌های بیشتر داشبورد",
  edit: "ویرایش داشبورد",
};

// The toolbar's "More dashboard options" menu, then its "Edit Dashboard".
const enterEditMode: (
  page: Page,
  words?: { options: string; edit: string },
) => Promise<void> = async (
  page: Page,
  words?: { options: string; edit: string },
): Promise<void> => {
  await press(
    page.getByRole("button", {
      name: words?.options || "More dashboard options",
    }),
  );
  await press(
    page.getByRole("menuitem", { name: words?.edit || "Edit Dashboard" }),
  );
  await expect(page.getByTestId(DEFAULTS_BAR)).toBeVisible();
};

const pickDefault: (
  page: Page,
  picker: string,
  value: string,
) => Promise<void> = async (
  page: Page,
  picker: string,
  value: string,
): Promise<void> => {
  await press(page.getByTestId(picker));
  await press(
    page.getByTestId(`${picker}-${value.toLowerCase().split(" ").join("-")}`),
  );
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

test.describe("the dashboard inside OneUptime", () => {
  test("opens on its saved default time range and auto-refresh, and every widget reads that window", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openApp(page, "wall", "Past 1 Day");

    await expectWidgetsRead(page, 0, 24);
    await expectAppAutoRefreshShows(page, "1m");
    // On the defaults, the address names neither.
    expect(linkParameter(page, "range")).toBeNull();
    expect(linkParameter(page, "refresh")).toBeNull();

    await shoot(page, testInfo, "app-toolbar-defaults");
  });

  test("a dashboard saved before the defaults opens on the past hour, with auto-refresh off", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await openApp(page, "plain", "Past 1 Hour");

    await expectWidgetsRead(page, 0, 1);
    await expectAppAutoRefreshShows(page, "Auto-refresh: Off");
  });

  test("a viewer's range is remembered across a reload and a fresh visit, and Default goes back", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openApp(page, "wall", "Past 1 Day");
    await expectWidgetsRead(page, 0, 24);

    let rail: Locator = await openRangePicker(page, "Past 1 Day");

    // The dashboard's own range first, chosen while the viewer is on it.
    await expect(rail.getByRole("radio").first()).toHaveText(
      "Default (Past 1 Day)",
    );
    await expect(
      rail.getByRole("radio", { name: "Default (Past 1 Day)" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      rail.getByRole("radio", { name: "Past 1 Day", exact: true }),
    ).toHaveAttribute("aria-checked", "false");
    await shoot(page, testInfo, "app-time-range-default");

    let from: number = await aggregateCount(page);

    await press(rail.getByRole("radio", { name: "Past 2 Days", exact: true }));

    await expect(rangeButton(page, "Past 2 Days")).toBeVisible();
    await expectWidgetsRead(page, from, 48);
    expect(linkParameter(page, "range")).toBe("2d");
    expect(await kept(page, timeRangeKey("wall"))).toBe("Past 2 Days");

    // A reload keeps it, and so does a visit that names no range.
    await page.reload();
    await expect(rangeButton(page, "Past 2 Days")).toBeVisible({
      timeout: 60000,
    });
    await openApp(page, "wall", "Past 2 Days");
    await expectWidgetsRead(page, 0, 48);
    expect(linkParameter(page, "range")).toBe("2d");

    rail = await openRangePicker(page, "Past 2 Days");

    await expect(
      rail.getByRole("radio", { name: "Past 2 Days", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      rail.getByRole("radio", { name: "Default (Past 1 Day)" }),
    ).toHaveAttribute("aria-checked", "false");

    from = await aggregateCount(page);
    await press(rail.getByRole("radio", { name: "Default (Past 1 Day)" }));

    await expect(rangeButton(page, "Past 1 Day")).toBeVisible();
    await expectWidgetsRead(page, from, 24);
    expect(linkParameter(page, "range")).toBeNull();
    expect(await kept(page, timeRangeKey("wall"))).toBeNull();
  });

  test("the auto-refresh menu offers the dashboard's own interval first; a pick is remembered, and Default forgets it", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openApp(page, "wall", "Past 1 Day");

    await press(appAutoRefresh(page));

    await expect(page.getByTestId(AUTO_REFRESH_DEFAULT_CHOICE)).toHaveText(
      `${TICK}Default (1m)`,
    );
    await shoot(page, testInfo, "app-auto-refresh-menu");

    await press(page.getByRole("menuitemradio", { name: "Refresh every 30s" }));

    await expectAppAutoRefreshShows(page, "30s");
    expect(linkParameter(page, "refresh")).toBe("30s");
    expect(await kept(page, autoRefreshKey("wall"))).toBe("30s");

    await openApp(page, "wall", "Past 1 Day");
    await expectAppAutoRefreshShows(page, "30s");

    // Now the viewer's own interval has the tick, and Default none.
    await press(appAutoRefresh(page));
    await expect(page.getByTestId(AUTO_REFRESH_DEFAULT_CHOICE)).toHaveText(
      "Default (1m)",
    );
    await expect(
      page.getByRole("menuitemradio", { name: "Refresh every 30s" }),
    ).toContainText(TICK);
    await press(page.getByTestId(AUTO_REFRESH_DEFAULT_CHOICE));

    await expectAppAutoRefreshShows(page, "1m");
    expect(linkParameter(page, "refresh")).toBeNull();
    expect(await kept(page, autoRefreshKey("wall"))).toBeNull();
  });

  test("a link's ?range= and ?refresh= open the dashboard on them, without becoming the viewer's own", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await openApp(page, "wall", "Past 1 Week", "?range=7d&refresh=5m");

    await expectWidgetsRead(page, 0, 168);
    await expectAppAutoRefreshShows(page, "5m");
    expect(await kept(page, timeRangeKey("wall"))).toBeNull();
    expect(await kept(page, autoRefreshKey("wall"))).toBeNull();

    // Default takes the link's range out of the address, and only that.
    const rail: Locator = await openRangePicker(page, "Past 1 Week");
    await press(rail.getByRole("radio", { name: "Default (Past 1 Day)" }));

    await expect(rangeButton(page, "Past 1 Day")).toBeVisible();
    expect(linkParameter(page, "range")).toBeNull();
    expect(linkParameter(page, "refresh")).toBe("5m");
  });

  test("a member who may not edit still has their own picks remembered", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await openApp(page, "weekly", "Past 1 Week", "?role=viewer");
    await expectWidgetsRead(page, 0, 168);

    const rail: Locator = await openRangePicker(page, "Past 1 Week");
    await press(rail.getByRole("radio", { name: "Past 1 Day", exact: true }));
    await expect(rangeButton(page, "Past 1 Day")).toBeVisible();

    await openApp(page, "weekly", "Past 1 Day", "?role=viewer");
    expect(await kept(page, timeRangeKey("weekly"))).toBe("Past 1 Day");
    expect(await savesOf(page)).toHaveLength(0);
  });

  test("an editor sets the defaults on purpose; Save Changes saves them and the dashboard opens on them", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openApp(page, "plain", "Past 1 Hour");
    await expectWidgetsRead(page, 0, 1);
    await enterEditMode(page);

    const row: Locator = page.getByTestId(DEFAULTS_BAR);

    await expect(row).toContainText("Default time range");
    await expect(row).toContainText("Default auto-refresh");
    await expect(page.getByTestId(DEFAULT_TIME_RANGE_PICKER)).toContainText(
      "Past 1 Hour",
    );
    await expect(page.getByTestId(DEFAULT_AUTO_REFRESH_PICKER)).toContainText(
      "Off",
    );
    await shoot(page, testInfo, "app-editing-row");

    await press(page.getByTestId(DEFAULT_TIME_RANGE_PICKER));
    await expect(
      page.getByTestId(`${DEFAULT_TIME_RANGE_PICKER}-menu`),
    ).toBeVisible();
    await shoot(page, testInfo, "app-editing-row-time-range-menu");
    await press(page.getByTestId(`${DEFAULT_TIME_RANGE_PICKER}-past-1-week`));

    await pickDefault(page, DEFAULT_AUTO_REFRESH_PICKER, "5m");

    await expect(page.getByTestId(DEFAULT_TIME_RANGE_PICKER)).toContainText(
      "Past 1 Week",
    );
    await expect(page.getByTestId(DEFAULT_AUTO_REFRESH_PICKER)).toContainText(
      "5m",
    );

    const from: number = await aggregateCount(page);

    await press(page.getByRole("button", { name: "Save Changes" }));

    await expect(page.getByTestId(DEFAULTS_BAR)).toHaveCount(0);

    const saves: Array<FixtureSave> = await savesOf(page);

    expect(saves).toHaveLength(1);
    expect(saves[0]?.dashboardViewConfig["timeRange"]).toBe("Past 1 Week");
    expect(saves[0]?.dashboardViewConfig["refreshInterval"]).toBe("5m");

    // The editor sees the new defaults at once.
    await expect(rangeButton(page, "Past 1 Week")).toBeVisible();
    await expectWidgetsRead(page, from, 168);
    await expectAppAutoRefreshShows(page, "5m");

    /*
     * And every visit opens on them, as a member who never picked anything
     * would: they are the dashboard's, not the editor's own.
     */
    await openApp(page, "plain", "Past 1 Week");
    await expectAppAutoRefreshShows(page, "5m");
    expect(await kept(page, timeRangeKey("plain"))).toBeNull();
    expect(await kept(page, autoRefreshKey("plain"))).toBeNull();
  });

  test("Save Changes after the editor turned refresh off while viewing keeps the dashboard's interval", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await openApp(page, "wall", "Past 1 Day");

    await press(appAutoRefresh(page));
    await press(page.getByRole("menuitemradio", { name: "Auto-refresh Off" }));
    await expectAppAutoRefreshShows(page, "Auto-refresh: Off");

    await enterEditMode(page);
    await press(page.getByRole("button", { name: "Save Changes" }));
    await expect(page.getByTestId(DEFAULTS_BAR)).toHaveCount(0);

    const saves: Array<FixtureSave> = await savesOf(page);

    expect(saves).toHaveLength(1);
    // Every viewer still opens refreshing every minute.
    expect(saves[0]?.dashboardViewConfig["refreshInterval"]).toBe("1m");
    expect(saves[0]?.dashboardViewConfig["timeRange"]).toBe("Past 1 Day");
    // And the editor's own Off stays theirs.
    await expectAppAutoRefreshShows(page, "Auto-refresh: Off");
  });

  test("Discard Changes throws changed defaults away", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await openApp(page, "wall", "Past 1 Day");
    await enterEditMode(page);
    await pickDefault(page, DEFAULT_TIME_RANGE_PICKER, "Past 3 Months");

    await expect(page.getByTestId(DEFAULT_TIME_RANGE_PICKER)).toContainText(
      "Past 3 Months",
    );

    await press(page.getByRole("button", { name: "Cancel" }));
    await press(page.getByRole("button", { name: "Discard Changes" }));
    await expect(page.getByTestId(DEFAULTS_BAR)).toHaveCount(0);

    expect(await savesOf(page)).toHaveLength(0);
    await expect(rangeButton(page, "Past 1 Day")).toBeVisible();

    await enterEditMode(page);
    await expect(page.getByTestId(DEFAULT_TIME_RANGE_PICKER)).toContainText(
      "Past 1 Day",
    );
  });

  test("the editing row in the dark theme", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openApp(page, "weekly", "Past 1 Week", "?theme=dark");
    await enterEditMode(page);
    await press(page.getByTestId(DEFAULT_AUTO_REFRESH_PICKER));
    await expect(
      page.getByTestId(`${DEFAULT_AUTO_REFRESH_PICKER}-menu`),
    ).toBeVisible();

    await shoot(page, testInfo, "app-editing-row-dark");
  });

  test("the pickers and the editing row in German and Persian", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();

    await openApp(page, "wall", "Letzter Tag", "?lang=de");

    const rail: Locator = await openRangePicker(page, "Letzter Tag");

    await expect(rail.getByRole("radio").first()).toHaveText(
      "Standard (Letzter Tag)",
    );
    await shoot(page, testInfo, "app-time-range-default-de");
    await page.keyboard.press("Escape");
    await expect(rail).toHaveCount(0);

    await enterEditMode(page, {
      options: "Weitere Dashboard-Optionen",
      edit: "Dashboard bearbeiten",
    });
    await expect(page.getByTestId(DEFAULTS_BAR)).toContainText(
      "Standardzeitraum",
    );
    await shoot(page, testInfo, "app-editing-row-de");

    // Right to left.
    await page.goto(appPath("wall", "?lang=fa"));
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await enterEditMode(page, PERSIAN_EDIT_WORDS);
    await expect(page.getByTestId(DEFAULTS_BAR)).toContainText(
      "بازه زمانی پیش‌فرض",
    );
    await shoot(page, testInfo, "app-editing-row-fa");
  });

  /*
   * The UI review's polish (issue #5080): what a person sees and reaches in
   * the picker, the menus and the editing row, measured in the browser.
   */
  test("the time range picker shows every range and Custom range at once, nothing scrolled out of sight", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openApp(page, "wall", "Past 1 Day");

    const rail: Locator = await openRangePicker(page, "Past 1 Day");

    // Default (Past 1 Day), the twelve ranges and Custom range.
    await expect(rail.getByRole("radio")).toHaveCount(14);

    // The rail never scrolls inside itself, so nothing hides below a fold.
    expect(
      await rail.evaluate((element: HTMLElement): number => {
        return element.scrollHeight - element.clientHeight;
      }),
    ).toBeLessThanOrEqual(1);

    if (!test.info().project.use.isMobile) {
      // Every choice is on the screen as the dialog opens, Custom range last.
      for (const radio of await rail.getByRole("radio").all()) {
        await expect(radio).toBeInViewport();
      }
    }

    await shoot(page, testInfo, "app-time-range-all-ranges");
  });

  test("a custom range's From and To sit one above the other, inside the dialog", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();

    await openApp(page, "wall", "Past 1 Day");

    const rail: Locator = await openRangePicker(page, "Past 1 Day");

    await press(rail.getByRole("radio", { name: "Custom range" }));

    const dialog: Locator = page.getByRole("dialog");
    const fields: Array<Locator> = await dialog
      .locator('input[type="datetime-local"]')
      .all();

    expect(fields).toHaveLength(2);

    // In one frame: the dialog grows in as it opens (Modal, from 95%).
    const [dialogBox, fromBox, toBox] = (await boxesInOneFrame([
      dialog,
      fields[0]!,
      fields[1]!,
    ])) as [FrameBox, FrameBox, FrameBox];

    // Side by side, the second ran past the dialog's edge.
    expect(fromBox.x + fromBox.width).toBeLessThanOrEqual(
      dialogBox.x + dialogBox.width,
    );
    expect(toBox.x + toBox.width).toBeLessThanOrEqual(
      dialogBox.x + dialogBox.width,
    );
    expect(toBox.y).toBeGreaterThanOrEqual(fromBox.y + fromBox.height);

    await shoot(page, testInfo, "app-time-range-custom");
  });

  test("the editing row's menus show every choice, each on one line, in German too", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();

    await openApp(page, "wall", "Letzter Tag", "?lang=de");
    await enterEditMode(page, {
      options: "Weitere Dashboard-Optionen",
      edit: "Dashboard bearbeiten",
    });

    for (const picker of [
      DEFAULT_TIME_RANGE_PICKER,
      DEFAULT_AUTO_REFRESH_PICKER,
    ]) {
      await press(page.getByTestId(picker));

      const menu: Locator = page.getByTestId(`${picker}-menu`);
      const choices: Array<Locator> = await menu
        .getByRole("menuitemradio")
        .all();

      await expect(menu).toBeVisible();
      // Nothing scrolled out of sight inside the menu.
      expect(
        await menu.evaluate((element: HTMLElement): number => {
          return element.scrollHeight - element.clientHeight;
        }),
      ).toBeLessThanOrEqual(1);

      // One line each: every choice as tall as the first.
      const heights: Array<number> = [];

      for (const choice of choices) {
        await expect(choice).toBeInViewport();
        heights.push(Math.round((await choice.boundingBox())!.height));
      }

      expect(new Set(heights).size).toBe(1);

      if (picker === DEFAULT_AUTO_REFRESH_PICKER) {
        // German throughout: no English "Refresh every" left among them.
        await expect(menu).not.toContainText("Refresh every");
        await expect(menu).toContainText("Alle 5s aktualisieren");
        await shoot(page, testInfo, "app-editing-row-menu-de");
      }

      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
    }
  });

  test("the editing row answers the keyboard, and picking a longer range does not move the board", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    // Past 1 Day and 1m: short enough for the line to have fitted beside them.
    await openApp(page, "wall", "Past 1 Day");
    await enterEditMode(page);

    const toolbarCard: Locator = page
      .getByTestId(DEFAULTS_BAR)
      .locator("xpath=..");
    const button: Locator = page.getByTestId(DEFAULT_TIME_RANGE_PICKER);
    const heightBefore: number = (await toolbarCard.boundingBox())!.height;

    // Enter opens the menu on the choice in use.
    await button.focus();
    await page.keyboard.press("Enter");

    const menu: Locator = page.getByTestId(`${DEFAULT_TIME_RANGE_PICKER}-menu`);

    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("menuitemradio", { name: "Past 1 Day" }),
    ).toBeFocused();

    // End, then Enter: the longest range, and the focus back on the button.
    await page.keyboard.press("End");
    await expect(
      menu.getByRole("menuitemradio", { name: "Past 3 Months" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(menu).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toContainText("Past 3 Months");

    /*
     * The line on what the defaults do is always under the pickers: beside
     * them it fitted for some values and not others, and a longer one moved
     * the whole board down a line.
     */
    expect((await toolbarCard.boundingBox())!.height).toBe(heightBefore);

    // Escape closes a menu back on its button.
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test("an empty dashboard's editing toolbar has no defaults row: its one step is to add a widget", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await page.goto(appPath("empty"));
    await press(page.getByRole("button", { name: "More dashboard options" }));
    await press(page.getByRole("menuitem", { name: "Edit Dashboard" }));

    await expect(page.getByTitle("Add Widget").first()).toBeVisible();
    await expect(page.getByTitle("Save Changes")).toBeVisible();
    await expect(page.getByTestId(DEFAULTS_BAR)).toHaveCount(0);
  });

  test("in Persian, the defaults menu opens under its button and the picker's rule sits between its panes", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await page.goto(appPath("wall", "?lang=fa"));
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await enterEditMode(page, PERSIAN_EDIT_WORDS);

    const button: Locator = page.getByTestId(DEFAULT_TIME_RANGE_PICKER);

    await press(button);

    const menu: Locator = page.getByTestId(`${DEFAULT_TIME_RANGE_PICKER}-menu`);
    // In one frame: the menu has only just opened.
    const [buttonBox, menuBox] = (await boxesInOneFrame([button, menu])) as [
      FrameBox,
      FrameBox,
    ];

    // Hung from the button's start - its right edge, right to left.
    expect(
      Math.abs(menuBox.x + menuBox.width - (buttonBox.x + buttonBox.width)),
    ).toBeLessThanOrEqual(1);

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    // The time range picker, in view mode: its button reads Persian (#5287).
    await openApp(page, "wall", "۱ روز گذشته", "?lang=fa");

    const rail: Locator = await openRangePicker(page, "۱ روز گذشته");
    const preview: Locator = rail.locator("xpath=following-sibling::*[1]");
    // In one frame: the picker has only just opened.
    const [railBox, previewBox] = (await boxesInOneFrame([rail, preview])) as [
      FrameBox,
      FrameBox,
    ];

    // Right to left: the rail on the right, the preview on its left...
    expect(railBox.x).toBeGreaterThanOrEqual(previewBox.x + previewBox.width);
    // ...and the rule between them, on the preview's right edge.
    expect(
      await preview.evaluate((element: HTMLElement): string => {
        return window.getComputedStyle(element).borderRightWidth;
      }),
    ).toBe("1px");
    expect(
      await preview.evaluate((element: HTMLElement): string => {
        return window.getComputedStyle(element).borderLeftWidth;
      }),
    ).toBe("0px");
  });
});

test.describe("the public dashboard", () => {
  test("opens on the dashboard's saved defaults, and every widget reads that window", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openPublic(page, "wall", "Past 1 Day");

    await expectWidgetsRead(page, 0, 24);
    await expect(publicAutoRefresh(page)).toHaveText("1m");
    await expect(publicAutoRefresh(page)).toHaveAccessibleName(
      "Auto-refresh settings",
    );

    await shoot(page, testInfo, "public-toolbar-defaults");
  });

  test("a visitor's picks are remembered, and Default goes back to the dashboard's own", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openPublic(page, "wall", "Past 1 Day");
    await expectWidgetsRead(page, 0, 24);

    await press(publicAutoRefresh(page));

    const defaultChoice: Locator = page.getByTestId(
      PUBLIC_AUTO_REFRESH_DEFAULT_CHOICE,
    );

    await expect(defaultChoice).toHaveText("Default (1m)");
    await expect(defaultChoice).toHaveAttribute("aria-checked", "true");
    await shoot(page, testInfo, "public-auto-refresh-menu");

    await press(page.getByRole("menuitemradio", { name: "Off", exact: true }));
    await expect(publicAutoRefresh(page)).toHaveText("");

    const rail: Locator = await openRangePicker(page, "Past 1 Day");
    await shoot(page, testInfo, "public-time-range-default");

    let from: number = await aggregateCount(page);

    await press(rail.getByRole("radio", { name: "Past 1 Week", exact: true }));
    await expectWidgetsRead(page, from, 168);

    // A fresh visit opens on the visitor's own.
    await openPublic(page, "wall", "Past 1 Week");
    await expect(publicAutoRefresh(page)).toHaveText("");
    expect(await kept(page, timeRangeKey("wall"))).toBe("Past 1 Week");
    expect(await kept(page, autoRefreshKey("wall"))).toBe("off");
    await expectWidgetsRead(page, 0, 168);

    // Default, in both pickers.
    await press(publicAutoRefresh(page));
    await expect(defaultChoice).toHaveAttribute("aria-checked", "false");
    await press(defaultChoice);
    await expect(publicAutoRefresh(page)).toHaveText("1m");

    from = await aggregateCount(page);

    const again: Locator = await openRangePicker(page, "Past 1 Week");
    await press(again.getByRole("radio", { name: "Default (Past 1 Day)" }));

    await expectWidgetsRead(page, from, 24);
    expect(await kept(page, timeRangeKey("wall"))).toBeNull();
    expect(await kept(page, autoRefreshKey("wall"))).toBeNull();
    expect(linkParameter(page, "range")).toBeNull();
    expect(linkParameter(page, "refresh")).toBeNull();
  });

  test("a wall screen's link opens on its own range and interval", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await openPublic(page, "plain", "Past 1 Day", "?range=24h&refresh=1m");

    await expectWidgetsRead(page, 0, 24);
    await expect(publicAutoRefresh(page)).toHaveText("1m");
    expect(await kept(page, timeRangeKey("plain"))).toBeNull();
    expect(await kept(page, autoRefreshKey("plain"))).toBeNull();
  });

  test("a dashboard saved before the defaults opens on the past hour", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await openPublic(page, "plain", "Past 1 Hour");

    await expectWidgetsRead(page, 0, 1);
    await expect(publicAutoRefresh(page)).toHaveText("");
  });
});
