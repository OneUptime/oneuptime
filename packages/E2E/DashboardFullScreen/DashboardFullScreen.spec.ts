import {
  BrowserContext,
  expect,
  Locator,
  Page,
  Route,
  test,
  TestInfo,
} from "@playwright/test";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * A dashboard shown full screen (issue #10409) in a real browser: the real
 * Dashboards routes inside the real master page, with only the data
 * boundary answered from fixture data (DashboardFullScreen/Fixture). See
 * README.md.
 *
 * The customer's ask: open a dashboard in a new tab, from the Dashboards
 * list too, showing only the dashboard - no side menu, no navigation - on
 * the whole screen, with everything still working (editing, adding and
 * removing widgets, filters, the time range, auto-refresh), and an easy
 * way back. So:
 *
 *   - Full Screen on the toolbar shows the dashboard alone over the whole
 *     window, and asks the browser for its own full screen too; Exit Full
 *     Screen, the browser's own Escape, and Escape where the browser has no
 *     full screen, bring the page back;
 *   - the address names it (?view=full-screen): the address alone opens it,
 *     and there Fill the Screen asks the browser for its full screen;
 *   - Open in New Tab, on the toolbar's ⋯ menu and on each row's ⋯ menu of
 *     the Dashboards list, opens it full screen in a tab of its own;
 *   - editing, a widget added and one removed, the time range, auto-refresh
 *     and a variable all work full screen, and a Viewer is a Viewer there;
 *   - the page behind is out of reach, the app's own layers and notes are
 *     not;
 *   - a phone's width, the dark theme, German and Persian.
 *
 * Screenshots are saved for review under
 * output/playwright/dashboard-full-screen-ui.
 */

interface FixtureRecord {
  dashboardReads: Array<{ id: string; at: number }>;
  dashboardLists: number;
  aggregates: Array<{
    metricName: string;
    start: number | null;
    end: number | null;
    at: number;
  }>;
  saves: Array<{
    id: string;
    dashboardViewConfig: { components: Array<{ componentType: string }> };
    at: number;
  }>;
  unexpected: Array<string>;
}

declare global {
  interface Window {
    __dashboardFullScreenFixture?: { record: FixtureRecord } | undefined;
  }
}

const PORT: string =
  process.env["DASHBOARD_FULL_SCREEN_FIXTURE_PORT"] || "4877";

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000f1";
const DASHBOARDS_PATH: string = `/dashboard/${PROJECT_ID}/dashboards`;

const dashboardId: (value: number) => string = (value: number): string => {
  return `db000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

// Fixture/Boards.js.
const OVERVIEW: { id: string; name: string } = {
  id: dashboardId(1),
  name: "Production overview",
};
const CLUSTERS: { id: string; name: string } = {
  id: dashboardId(2),
  name: "Kubernetes clusters",
};
const NOTES: { id: string; name: string } = {
  id: dashboardId(3),
  name: "Team notes",
};

const SCREENSHOTS: string = "../../output/playwright/dashboard-full-screen-ui";

const DAY: number = 24 * 60 * 60 * 1000;

const dashboardPath: (id: string) => string = (id: string): string => {
  return `${DASHBOARDS_PATH}/${id}`;
};

// ---- reading the page --------------------------------------------------------

const record: (page: Page) => Promise<FixtureRecord> = async (
  page: Page,
): Promise<FixtureRecord> => {
  return page.evaluate((): FixtureRecord => {
    return JSON.parse(
      JSON.stringify(window.__dashboardFullScreenFixture!.record),
    ) as FixtureRecord;
  });
};

const view: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("dashboard-view");
};

const fullScreenButton: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("dashboard-full-screen");
};

const exitButton: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("dashboard-exit-full-screen");
};

const fillButton: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("dashboard-fill-screen");
};

// The toolbar's ⋯ menu: the last button of the row's last box, in view mode.
const moreButton: (page: Page) => Locator = (page: Page): Locator => {
  return page
    .getByTestId("dashboard-toolbar-screen")
    .getByRole("button")
    .last();
};

const appHeader: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("fixture-app-header");
};

// The Metrics template's `service` variable, its picker in the toolbar ("Service: All").
const serviceVariable: (page: Page) => Locator = (page: Page): Locator => {
  return view(page).getByRole("button", { name: /^Service:/ });
};

const atDesktopOnly: () => void = (): void => {
  test.skip(
    test.info().project.name !== "chromium",
    "a desktop flow; the phone runs its own",
  );
};

const atPhoneOnly: () => void = (): void => {
  test.skip(test.info().project.name !== "mobile-chromium", "a phone's flow");
};

/*
 * A press: a click at a desktop's width; on a phone, where a control can sit
 * below the fold of the board's own scroll, scrolled into view and pressed
 * as a tap does.
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
 * A screenshot for review, once what the board draws is drawn: a chart
 * without its line says nothing about the page around it.
 */
const shoot: (
  page: Page,
  testInfo: TestInfo,
  name: string,
) => Promise<void> = async (
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> => {
  const lines: Locator = page.locator(
    '[data-testid="dashboard-view"] .recharts-curve',
  );

  if ((await page.getByTestId("dashboard-view").count()) > 0) {
    await expect
      .poll(async (): Promise<number> => {
        return lines.count();
      })
      .toBeGreaterThan(0)
      .catch((): void => {
        // A board with no chart (no widget yet): nothing to wait for.
      });
  }

  await page.screenshot({
    path: `${SCREENSHOTS}/${testInfo.project.name}-${name}.png`,
  });
};

// The dashboard's page, its board drawn: its title widget says its name.
const openDashboard: (
  page: Page,
  dashboard: { id: string; name: string },
  query?: string,
) => Promise<void> = async (
  page: Page,
  dashboard: { id: string; name: string },
  query: string = "",
): Promise<void> => {
  await page.goto(`${dashboardPath(dashboard.id)}${query}`);
  await expectBoardOf(page, dashboard);
};

const expectBoardOf: (
  page: Page,
  dashboard: { id: string; name: string },
) => Promise<void> = async (
  page: Page,
  dashboard: { id: string; name: string },
): Promise<void> => {
  await expect(view(page)).toBeVisible();
  await expect(
    view(page).getByText(dashboard.name, { exact: true }).last(),
  ).toBeVisible();
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
};

const expectFullScreen: (
  page: Page,
  isFullScreen: boolean,
) => Promise<void> = async (
  page: Page,
  isFullScreen: boolean,
): Promise<void> => {
  await expect(view(page)).toHaveAttribute(
    "data-full-screen",
    isFullScreen ? "true" : "false",
  );
};

// The address's query, as a person reads it.
const searchOf: (page: Page) => URLSearchParams = (
  page: Page,
): URLSearchParams => {
  return new URL(page.url()).searchParams;
};

const expectAddressFullScreen: (
  page: Page,
  isFullScreen: boolean,
) => Promise<void> = async (
  page: Page,
  isFullScreen: boolean,
): Promise<void> => {
  await expect
    .poll((): string | null => {
      return searchOf(page).get("view");
    })
    .toBe(isFullScreen ? "full-screen" : null);
};

// The view covers the window, edge to edge.
const expectCoversWindow: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  const size: { width: number; height: number } = page.viewportSize()!;

  await expect
    .poll(async (): Promise<Array<number>> => {
      const box: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null = await view(page).boundingBox();

      return box ? [box.x, box.y, box.width, box.height].map(Math.round) : [];
    })
    .toEqual([0, 0, size.width, size.height]);
};

// Whether an element of the page is inert: out of reach of Tab, a click and a screen reader.
const isInert: (locator: Locator) => Promise<boolean> = async (
  locator: Locator,
): Promise<boolean> => {
  return locator.evaluate((element: Element): boolean => {
    return Boolean(element.closest("[inert]"));
  });
};

// What is drawn at a point of an element: the dashboard's view, or the element itself.
const isCoveredByTheView: (
  page: Page,
  locator: Locator,
) => Promise<boolean> = async (
  page: Page,
  locator: Locator,
): Promise<boolean> => {
  const box: { x: number; y: number; width: number; height: number } | null =
    await locator.boundingBox();

  expect(box).not.toBeNull();

  return page.evaluate(
    (point: { x: number; y: number }): boolean => {
      const element: Element | null = document.elementFromPoint(
        point.x,
        point.y,
      );

      return Boolean(element?.closest('[data-testid="dashboard-view"]'));
    },
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
  );
};

// The element the browser shows full screen: <html>, or none.
const browserFullScreenElement: (page: Page) => Promise<string | null> = async (
  page: Page,
): Promise<string | null> => {
  return page.evaluate((): string | null => {
    return document.fullscreenElement
      ? document.fullscreenElement.tagName.toLowerCase()
      : null;
  });
};

// A browser with no full screen of its own: a phone that keeps it for videos.
const withoutBrowserFullScreen: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.addInitScript((): void => {
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(Document.prototype, "fullscreenEnabled", {
      configurable: true,
      get: (): boolean => {
        return false;
      },
    });
  });
};

const menuItem: (page: Page, name: string) => Locator = (
  page: Page,
  name: string,
): Locator => {
  return page.getByRole("menuitem", { name: name, exact: true });
};

const openMoreMenu: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await press(moreButton(page));
  await expect(page.getByRole("menu")).toBeVisible();
};

// ---- every test ----------------------------------------------------------------

const pageErrors: WeakMap<Page, Array<string>> = new WeakMap();
const openedPages: WeakMap<Page, Array<Page>> = new WeakMap();

function watch(page: Page): void {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);

  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
}

// Nothing the pages ask for leaves the fixture, and no script error is thrown.
test.beforeEach(
  async ({ page, context }: { page: Page; context: BrowserContext }) => {
    watch(page);
    openedPages.set(page, []);

    context.on("page", (opened: Page) => {
      watch(opened);
      openedPages.get(page)?.push(opened);
    });

    await context.route("**/*", async (route: Route) => {
      const url: URL = new URL(route.request().url());

      if (url.hostname === "127.0.0.1" && url.port === PORT) {
        await route.continue();
        return;
      }

      await route.abort();
    });
  },
);

test.afterEach(async ({ page }: { page: Page }) => {
  for (const each of [page, ...(openedPages.get(page) || [])]) {
    const unexpected: Array<string> = await record(each)
      .then((fixture: FixtureRecord): Array<string> => {
        return fixture.unexpected;
      })
      .catch((): Array<string> => {
        return [];
      });

    // Every read the pages made is one the fixture models.
    expect(unexpected).toEqual([]);
    expect(pageErrors.get(each) || []).toEqual([]);
  }
});

// ---- going full screen, and back ---------------------------------------------

test.describe("full screen from the dashboard", () => {
  test("Full Screen shows the dashboard alone over the whole window, its toolbar and widgets working, and asks the browser for its full screen", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openDashboard(page, OVERVIEW);

    await expect(appHeader(page)).toBeVisible();
    await expectFullScreen(page, false);
    await expect(fullScreenButton(page)).toHaveAccessibleName("Full Screen");
    await shoot(page, testInfo, "page");

    await press(fullScreenButton(page));

    await expectFullScreen(page, true);
    await expectCoversWindow(page);
    await expectAddressFullScreen(page, true);
    // The browser's own full screen, asked from the press: the whole page.
    await expect
      .poll(() => {
        return browserFullScreenElement(page);
      })
      .toBe("html");

    // Nothing of OneUptime around it: its header is under the view, out of reach.
    expect(await isCoveredByTheView(page, appHeader(page))).toBe(true);
    expect(await isInert(appHeader(page))).toBe(true);

    // Its toolbar and its board: the name, the time range, auto-refresh, the variable.
    await expect(view(page).getByText("Past 1 Day")).toBeVisible();
    await expect(view(page).getByTitle("Auto-refresh settings")).toBeVisible();
    await expect(serviceVariable(page)).toBeVisible();
    await expect(exitButton(page)).toBeVisible();
    await expect(exitButton(page)).toContainText("Esc");
    // As full as it gets: nothing more to fill.
    await expect(fillButton(page)).toHaveCount(0);

    await shoot(page, testInfo, "full-screen");
  });

  test("Exit Full Screen brings the page back, out of the browser's full screen too", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openDashboard(page, OVERVIEW);
    await press(fullScreenButton(page));
    await expectFullScreen(page, true);

    await press(exitButton(page));

    await expectFullScreen(page, false);
    await expectAddressFullScreen(page, false);
    await expect
      .poll(() => {
        return browserFullScreenElement(page);
      })
      .toBe(null);
    await expect(appHeader(page)).toBeVisible();
    expect(await isInert(appHeader(page))).toBe(false);
    // The focus is on the control that goes full screen again.
    await expect(fullScreenButton(page)).toBeFocused();
  });

  test("the browser's own Escape, which leaves its full screen, brings the page back too: one press in, one Escape out", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openDashboard(page, OVERVIEW);
    await press(fullScreenButton(page));
    await expect
      .poll(() => {
        return browserFullScreenElement(page);
      })
      .toBe("html");

    // The browser leaving its full screen by itself, as its Escape does.
    await page.evaluate(async (): Promise<void> => {
      await document.exitFullscreen();
    });

    await expectFullScreen(page, false);
    await expectAddressFullScreen(page, false);
    await expect(appHeader(page)).toBeVisible();
  });

  test("where the browser has no full screen of its own, Full Screen fills the window, and Escape brings the page back", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await withoutBrowserFullScreen(page);
    await openDashboard(page, OVERVIEW);

    await press(fullScreenButton(page));

    await expectFullScreen(page, true);
    await expectCoversWindow(page);
    // Nothing to offer: the browser has none.
    await expect(fillButton(page)).toHaveCount(0);

    await page.keyboard.press("Escape");

    await expectFullScreen(page, false);
    await expectAddressFullScreen(page, false);
  });

  test("Full Screen in the ⋯ menu does the same, and the menu offers Open in New Tab", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openDashboard(page, OVERVIEW);
    await openMoreMenu(page);

    await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText([
      "Edit Dashboard",
      "Share",
      "Full Screen",
      "Open in New Tab",
    ]);

    await press(menuItem(page, "Full Screen"));

    await expectFullScreen(page, true);

    // Full screen, the menu offers the way back with its words.
    await openMoreMenu(page);
    await expect(menuItem(page, "Exit Full Screen")).toBeVisible();
    await press(menuItem(page, "Exit Full Screen"));

    await expectFullScreen(page, false);
  });

  test("an open menu takes the first Escape, and the next one leaves full screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await withoutBrowserFullScreen(page);
    await openDashboard(page, OVERVIEW);
    await press(fullScreenButton(page));
    await openMoreMenu(page);

    await page.keyboard.press("Escape");

    await expect(page.getByRole("menu")).toHaveCount(0);
    await expectFullScreen(page, true);

    await page.keyboard.press("Escape");

    await expectFullScreen(page, false);
  });
});

test.describe("full screen from its address", () => {
  test("the address alone opens the dashboard full screen, and there Fill the Screen asks the browser for its own", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openDashboard(page, OVERVIEW, "?view=full-screen");

    await expectFullScreen(page, true);
    await expectCoversWindow(page);
    expect(await isInert(appHeader(page))).toBe(true);
    // A new tab is never put in the browser's full screen by itself.
    expect(await browserFullScreenElement(page)).toBe(null);
    await expect(fillButton(page)).toBeVisible();
    await expect(fillButton(page)).toHaveAccessibleName("Fill the Screen");
    await shoot(page, testInfo, "full-screen-from-its-address");

    await press(fillButton(page));

    await expect
      .poll(() => {
        return browserFullScreenElement(page);
      })
      .toBe("html");
    await expect(fillButton(page)).toHaveCount(0);

    // The browser's Escape leaves its own full screen only: the dashboard stays full screen.
    await page.evaluate(async (): Promise<void> => {
      await document.exitFullscreen();
    });

    await expectFullScreen(page, true);
    await expect(fillButton(page)).toBeVisible();

    await press(exitButton(page));

    await expectFullScreen(page, false);
    await expectAddressFullScreen(page, false);
    await expect(appHeader(page)).toBeVisible();
  });

  test("a reload keeps it full screen", async ({ page }: { page: Page }) => {
    atDesktopOnly();
    await openDashboard(page, OVERVIEW);
    await press(fullScreenButton(page));
    await expectAddressFullScreen(page, true);

    await page.reload();
    await expectBoardOf(page, OVERVIEW);

    await expectFullScreen(page, true);
  });
});

test.describe("Open in New Tab", () => {
  test("from the toolbar's ⋯ menu: this dashboard full screen in a tab of its own, on the range this tab shows", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openDashboard(page, OVERVIEW, "?range=7d");
    await openMoreMenu(page);

    const opened: Promise<Page> = context.waitForEvent("page");

    await press(menuItem(page, "Open in New Tab"));

    const tab: Page = await opened;
    await tab.waitForLoadState();
    await expectBoardOf(tab, OVERVIEW);

    expect(new URL(tab.url()).pathname).toBe(dashboardPath(OVERVIEW.id));
    expect(searchOf(tab).get("view")).toBe("full-screen");
    expect(searchOf(tab).get("range")).toBe("7d");
    await expectFullScreen(tab, true);
    await expectCoversWindow(tab);
    await expect(
      tab.getByTestId("dashboard-view").getByText("Past 1 Week"),
    ).toBeVisible();

    // This tab stays as it was.
    await expectFullScreen(page, false);
    await expectAddressFullScreen(page, false);

    await shoot(tab, testInfo, "new-tab");

    // The way back, in that tab: the dashboard's page with OneUptime around it.
    await tab.getByTestId("dashboard-exit-full-screen").click();
    await expect(tab.getByTestId("dashboard-view")).toHaveAttribute(
      "data-full-screen",
      "false",
    );
    await expect(tab.getByTestId("fixture-app-header")).toBeVisible();
  });

  test("from a row's ⋯ menu on the Dashboards list: that dashboard full screen in a tab of its own", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }, testInfo: TestInfo) => {
    await page.goto(DASHBOARDS_PATH);

    const row: Locator = page
      .locator("#dashboard-table-body > tr, #dashboard-table-body > div")
      .filter({ hasText: CLUSTERS.name });

    await expect(row).toBeVisible();
    await press(row.getByTestId("row-actions-more-button"));

    const menu: Locator = page.getByRole("menu");

    await expect(menu).toBeVisible();
    // First in the menu, with its icon.
    await expect(menu.getByRole("menuitem").first()).toHaveText(
      "Open in New Tab",
    );
    await expect(menu.getByRole("menuitem").first().locator("svg")).toHaveCount(
      1,
    );
    // Opened: faded in all the way, for the screenshot.
    await expect
      .poll(async (): Promise<boolean> => {
        return menu.evaluate((element: Element): boolean => {
          for (
            let node: Element | null = element;
            node;
            node = node.parentElement
          ) {
            if (getComputedStyle(node).opacity !== "1") {
              return false;
            }
          }

          return true;
        });
      })
      .toBe(true);
    await shoot(page, testInfo, "list-row-menu");

    const opened: Promise<Page> = context.waitForEvent("page");

    await press(menuItem(page, "Open in New Tab"));

    const tab: Page = await opened;
    await tab.waitForLoadState();
    await expectBoardOf(tab, CLUSTERS);

    expect(new URL(tab.url()).pathname).toBe(dashboardPath(CLUSTERS.id));
    expect(searchOf(tab).get("view")).toBe("full-screen");
    await expectFullScreen(tab, true);
    await expectCoversWindow(tab);

    // The list stays where it was.
    expect(new URL(page.url()).pathname).toBe(DASHBOARDS_PATH);
  });
});

// ---- everything still works full screen ----------------------------------------

test.describe("full screen, everything still works", () => {
  test("editing: a widget added and one removed, saved, with Exit Full Screen there all along", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await withoutBrowserFullScreen(page);
    await openDashboard(page, OVERVIEW, "?view=full-screen");

    // Nothing saved yet.
    expect((await record(page)).saves).toEqual([]);

    await openMoreMenu(page);
    await press(menuItem(page, "Edit Dashboard"));

    await expect(
      view(page).getByText("Editing", { exact: true }),
    ).toBeVisible();
    await expect(exitButton(page)).toBeVisible();
    await shoot(page, testInfo, "full-screen-editing");

    // Add a Text widget: the catalog and its settings open over the dashboard.
    await press(page.getByTitle("Add Widget").first());
    await press(page.getByTestId("widget-card-Text"));

    const settings: Locator = page.getByTestId("modal");

    await press(settings.getByRole("button", { name: "Done" }));
    await expect(settings).toHaveCount(0);
    await expect(
      view(page).getByText("Hello, World!", { exact: true }),
    ).toBeVisible();
    await expect(
      view(page).getByText("Unsaved changes", { exact: true }),
    ).toBeVisible();
    // The new widget, scrolled to inside the view, which scrolls by itself.
    await shoot(page, testInfo, "full-screen-widget-added");

    /*
     * Remove it again from its settings - opened by a click on it, where
     * the editing layer over the widget takes the click - with Delete
     * Widget, confirmed.
     */
    await view(page)
      .getByText("Hello, World!", { exact: true })
      .click({ force: true });
    await expect(page.getByTestId("modal")).toBeVisible();
    await press(page.getByRole("button", { name: "Delete Widget" }).first());
    await press(
      page
        .getByRole("dialog", { name: "Delete Widget?" })
        .getByTestId("modal-footer-submit-button"),
    );
    await expect(
      view(page).getByText("Hello, World!", { exact: true }),
    ).toHaveCount(0);

    // And add one to keep.
    await press(page.getByTitle("Add Widget").first());
    await press(page.getByTestId("widget-card-Text"));
    await press(
      page.getByTestId("modal").getByRole("button", { name: "Done" }),
    );

    await press(page.getByRole("button", { name: "Save Changes" }));

    await expect
      .poll(async () => {
        return (await record(page)).saves.length;
      })
      .toBe(1);

    const saved: FixtureRecord = await record(page);
    const texts: number = saved.saves[0]!.dashboardViewConfig.components.filter(
      (component: { componentType: string }): boolean => {
        return component.componentType === "Text";
      },
    ).length;

    // The template's title and section texts, and the one kept.
    expect(texts).toBeGreaterThanOrEqual(2);
    await expectFullScreen(page, true);
    // Saved, as a save says it anywhere: a note in the corner, over the view.
    await expect(page.getByTestId("toast-region")).toContainText(
      "Changes saved",
    );
    expect(await isInert(page.getByTestId("toast-region"))).toBe(false);
  });

  test("editing on the page, Full Screen sits beside the editing actions, and the edit comes along, unsaved work and all", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await withoutBrowserFullScreen(page);
    await openDashboard(page, OVERVIEW);
    await openMoreMenu(page);
    await press(menuItem(page, "Edit Dashboard"));

    await expect(
      page.getByRole("button", { name: "Save Changes" }),
    ).toBeVisible();
    await expect(fullScreenButton(page)).toBeVisible();
    await shoot(page, testInfo, "page-editing");

    await press(page.getByTitle("Add Widget").first());
    await press(page.getByTestId("widget-card-Text"));
    await press(
      page.getByTestId("modal").getByRole("button", { name: "Done" }),
    );
    await expect(
      view(page).getByText("Unsaved changes", { exact: true }),
    ).toBeVisible();

    const readsBefore: number = (await record(page)).dashboardReads.length;

    await press(fullScreenButton(page));

    await expectFullScreen(page, true);
    await expect(
      view(page).getByText("Unsaved changes", { exact: true }),
    ).toBeVisible();
    await expect(
      view(page).getByText("Hello, World!", { exact: true }),
    ).toBeVisible();
    // Nothing was read again, nothing was saved: the same board, drawn over the page.
    expect((await record(page)).dashboardReads.length).toBe(readsBefore);
    expect((await record(page)).saves).toEqual([]);

    await press(exitButton(page));

    await expectFullScreen(page, false);
    await expect(
      view(page).getByText("Unsaved changes", { exact: true }),
    ).toBeVisible();
  });

  test("the time range, auto-refresh and a variable work full screen, and go in the address beside the view", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await withoutBrowserFullScreen(page);
    await openDashboard(page, OVERVIEW, "?view=full-screen");

    // The time range: Past 1 Week, applied at once and read by every widget.
    await press(view(page).getByText("Past 1 Day"));

    const pickedAt: number = Date.now();

    await press(page.getByRole("radio", { name: "Past 1 Week" }));

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(view(page).getByText("Past 1 Week")).toBeVisible();
    await expect
      .poll(async (): Promise<boolean> => {
        return (await record(page)).aggregates.some(
          (read: { start: number | null; end: number | null; at: number }) => {
            return (
              read.at >= pickedAt &&
              read.start !== null &&
              read.end !== null &&
              Math.abs(read.end - read.start - 7 * DAY) < 60 * 60 * 1000
            );
          },
        );
      })
      .toBe(true);
    expect(searchOf(page).get("range")).toBe("7d");
    expect(searchOf(page).get("view")).toBe("full-screen");

    // Auto-refresh: every 5 seconds, the widgets read again.
    await press(view(page).getByTitle("Auto-refresh settings"));
    await press(
      page
        .getByRole("menu", { name: "Auto-refresh settings" })
        .getByRole("menuitemradio", { name: /5\s?s$/ }),
    );

    const refreshPickedAt: number = Date.now();

    await expect(
      page.getByTestId("dashboard-auto-refresh-countdown"),
    ).toBeVisible();
    await expect
      .poll(
        async (): Promise<number> => {
          return (await record(page)).aggregates.filter(
            (read: { at: number }) => {
              return read.at >= refreshPickedAt + 4000;
            },
          ).length;
        },
        { timeout: 20000 },
      )
      .toBeGreaterThan(0);
    expect(searchOf(page).get("refresh")).toBe("5s");

    // The variable: the toolbar's service picker narrows the board.
    await press(serviceVariable(page));
    await press(page.getByRole("checkbox", { name: "payments", exact: true }));

    await expect
      .poll(() => {
        return searchOf(page).get("var-service");
      })
      .toBe("payments");
    await expectFullScreen(page, true);
    expect(searchOf(page).get("view")).toBe("full-screen");
  });

  test("a Viewer is a Viewer full screen: Edit Dashboard is locked, and full screen is theirs as anyone's", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openDashboard(page, OVERVIEW, "?role=viewer");
    await press(fullScreenButton(page));
    await expectFullScreen(page, true);

    await openMoreMenu(page);

    await expect(menuItem(page, "Edit Dashboard")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    // Pressed anyway, the locked item does nothing.
    await menuItem(page, "Edit Dashboard").click({ force: true });
    await expect(
      page.getByRole("button", { name: "Save Changes" }),
    ).toHaveCount(0);
    await expect(exitButton(page)).toBeVisible();
  });

  test("the page behind is out of reach, and Ask AI's pill and the notes are not", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openDashboard(page, OVERVIEW);
    await press(fullScreenButton(page));
    await expectFullScreen(page, true);

    expect(await isInert(appHeader(page))).toBe(true);
    expect(await isInert(page.getByTestId("fixture-app-nav"))).toBe(true);
    expect(await isInert(page.getByTestId("fixture-app-footer"))).toBe(true);
    expect(await isInert(page.getByTestId("fixture-app-layer"))).toBe(false);
    expect(await isInert(page.getByTestId("toast-region"))).toBe(false);
    expect(await isInert(view(page))).toBe(false);

    // Tab goes through the dashboard, never onto the page behind it.
    for (let tabPress: number = 0; tabPress < 12; tabPress++) {
      await page.keyboard.press("Tab");

      const behind: boolean = await page.evaluate((): boolean => {
        const active: Element | null = document.activeElement;

        return Boolean(
          active &&
            active.closest(
              '[data-testid="fixture-app-header"], [data-testid="fixture-app-nav"], [data-testid="fixture-app-footer"]',
            ),
        );
      });

      expect(behind).toBe(false);
    }
  });

  test("a dashboard with no widget yet, full screen, still offers its editor Add Widget", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await withoutBrowserFullScreen(page);
    await page.goto(`${dashboardPath(NOTES.id)}?view=full-screen`);

    await expectFullScreen(page, true);
    await expect(
      view(page).getByText("Team notes", { exact: true }),
    ).toBeVisible();
    await expect(
      view(page).getByRole("button", { name: "Add Widget" }),
    ).toBeVisible();
  });
});

// ---- looks ------------------------------------------------------------------------

test.describe("how it looks", () => {
  test("in the dark theme, full screen and editing", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await withoutBrowserFullScreen(page);
    await openDashboard(page, OVERVIEW, "?theme=dark&view=full-screen");

    await expectFullScreen(page, true);

    // The view is the dark theme's background, never a white sheet.
    const background: string = await view(page).evaluate(
      (element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      },
    );

    expect(background).not.toBe("rgb(255, 255, 255)");
    expect(background).not.toBe("rgb(248, 249, 251)");
    await shoot(page, testInfo, "full-screen-dark");

    await openMoreMenu(page);
    await press(menuItem(page, "Edit Dashboard"));
    await expect(
      page.getByRole("button", { name: "Save Changes" }),
    ).toBeVisible();
    await shoot(page, testInfo, "full-screen-editing-dark");
  });

  test("in German, its way back in German", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await withoutBrowserFullScreen(page);
    await openDashboard(page, OVERVIEW, "?lang=de");

    await expect(fullScreenButton(page)).toHaveAccessibleName("Vollbild");

    await press(fullScreenButton(page));

    await expectFullScreen(page, true);
    await expect(exitButton(page)).toHaveAccessibleName(/Vollbild beenden/);
    await expectNoSidewaysScroll(page);
    await shoot(page, testInfo, "full-screen-de");
  });

  test("in Persian, laid out right to left, the way back at the row's end", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await withoutBrowserFullScreen(page);
    await openDashboard(page, OVERVIEW, "?lang=fa&view=full-screen");

    await expectFullScreen(page, true);
    await expectCoversWindow(page);
    await expect(exitButton(page)).toHaveAccessibleName(/خروج از تمام‌صفحه/);

    // The row's end is its left on a page read right to left.
    const [exitBox, nameBox]: Array<FrameBox> = await boxesInOneFrame([
      exitButton(page),
      view(page).locator("h2").first(),
    ]);

    expect(exitBox!.x).toBeLessThan(nameBox!.x);
    await expectNoSidewaysScroll(page);
    await shoot(page, testInfo, "full-screen-fa");
  });
});

// ---- a phone ------------------------------------------------------------------------

test.describe("on a phone", () => {
  test("full screen fills the window, nothing runs sideways, and the way back is a button with its name", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atPhoneOnly();
    await withoutBrowserFullScreen(page);
    await openDashboard(page, OVERVIEW);
    await shoot(page, testInfo, "page");

    await press(fullScreenButton(page));

    await expectFullScreen(page, true);
    await expectCoversWindow(page);
    await expectNoSidewaysScroll(page);
    // Its words are read out; on a phone the button is a square round its icon.
    await expect(exitButton(page)).toHaveAccessibleName(/Exit Full Screen/);
    await expect(exitButton(page)).toBeVisible();

    // The view scrolls by itself, and nothing in it runs past its sides.
    const overflow: number = await view(page).evaluate(
      (element: Element): number => {
        return element.scrollWidth - element.clientWidth;
      },
    );

    expect(overflow).toBeLessThanOrEqual(0);
    await shoot(page, testInfo, "full-screen");

    await press(exitButton(page));

    await expectFullScreen(page, false);
    await expect(appHeader(page)).toBeVisible();
  });

  test("full screen, the toolbar's controls and its ⋯ menu are on the screen, and editing works", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atPhoneOnly();
    await withoutBrowserFullScreen(page);
    await openDashboard(page, OVERVIEW, "?view=full-screen");

    const size: { width: number; height: number } = page.viewportSize()!;

    for (const control of [
      exitButton(page),
      moreButton(page),
      view(page).getByTitle("Auto-refresh settings"),
    ]) {
      const box: { x: number; width: number } | null =
        await control.boundingBox();

      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
    }

    await openMoreMenu(page);
    await expect(menuItem(page, "Open in New Tab")).toBeVisible();
    await press(menuItem(page, "Edit Dashboard"));

    await expect(
      page.getByRole("button", { name: "Save Changes" }),
    ).toBeVisible();
    await expect(exitButton(page)).toBeVisible();
    await expectNoSidewaysScroll(page);
    await shoot(page, testInfo, "full-screen-editing");
  });

  test("Open in New Tab from a row's ⋯ menu opens the dashboard full screen", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }) => {
    atPhoneOnly();
    await page.goto(DASHBOARDS_PATH);

    const card: Locator = page
      .locator("#dashboard-table-body > tr, #dashboard-table-body > div")
      .filter({ hasText: OVERVIEW.name });

    await expect(card).toBeVisible();
    await press(card.getByTestId("row-actions-more-button"));

    const opened: Promise<Page> = context.waitForEvent("page");

    await press(menuItem(page, "Open in New Tab"));

    const tab: Page = await opened;
    await tab.waitForLoadState();
    await expectBoardOf(tab, OVERVIEW);
    await expectFullScreen(tab, true);
  });
});
