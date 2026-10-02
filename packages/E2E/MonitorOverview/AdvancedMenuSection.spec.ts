import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";

/*
 * "Please always collapse the advanced section by default. Please do this for
 * entire project. Leaving it open by default causes decision paralysis for
 * users."
 *
 * The monitor's side menu, in a real browser: the production Layout and
 * SideMenu, the production Tailwind build and Theme.css, against the offline
 * fixture (Fixture/Fixture.js). jsdom applies no CSS, so what only a browser
 * can show is checked here: that a folded Advanced section's rows are hidden
 * from sight AND from the keyboard (visibility: hidden, not just a zero
 * height and no opacity), and that they come back when it is opened.
 *
 * The same guards as MonitorOverview.spec.ts: a network fence, no uncaught
 * page errors, and no request the fixture does not model.
 */

const PORT: string = "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
// The fixture's API monitor, "Checkout API".
const MONITOR_PATH: string = `/dashboard/${PROJECT_ID}/monitors/70000000-0000-4000-8000-000000000001`;

// Pages/Monitor/View/SideMenu.tsx: the Advanced section, in order.
const ADVANCED_PAGES: ReadonlyArray<{ title: string; path: string }> = [
  { title: "Owners", path: "/owners" },
  { title: "Custom Fields", path: "/custom-fields" },
  { title: "Settings", path: "/settings" },
  { title: "Audit Logs", path: "/audit-logs" },
  { title: "Delete Monitor", path: "/delete" },
];

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    aborted.push(route.request().url());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const state: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __monitorOverviewFixture?: { unhandled?: Array<unknown> };
        }
      ).__monitorOverviewFixture;
      return JSON.parse(
        JSON.stringify(state?.unhandled || []),
      ) as Array<unknown>;
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function openMonitor(page: Page, path: string = ""): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.goto(`${MONITOR_PATH}${path}?type=api`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Monitor - Checkout API",
    { timeout: 30000 },
  );
}

function desktopMenu(page: Page): Locator {
  return page.locator("aside[role='navigation'][aria-label='Main navigation']");
}

function phoneMenu(page: Page): Locator {
  return page.locator("div[role='navigation'][aria-label='Main navigation']");
}

/*
 * The section's toggle, by its heading's text. The heading is drawn in
 * capitals by CSS, so it is matched on its text, not on what is shown.
 */
function advancedToggle(menu: Locator): Locator {
  return menu.locator(
    "xpath=.//h6[normalize-space(.)='Advanced']/ancestor::button[1]",
  );
}

function advancedLink(menu: Locator, path: string): Locator {
  return menu.locator(`a[href='${MONITOR_PATH}${path}']`);
}

// Whether keyboard focus is inside the element the Advanced toggle controls.
async function focusIsInsideAdvanced(
  page: Page,
  menu: Locator,
): Promise<boolean> {
  const bodyId: string | null =
    await advancedToggle(menu).getAttribute("aria-controls");

  expect(bodyId, "the Advanced toggle names the body it controls").toBeTruthy();

  return page.evaluate((id: string): boolean => {
    const body: HTMLElement | null = document.getElementById(id);
    return Boolean(body && body.contains(document.activeElement));
  }, bodyId!);
}

test.describe("the monitor menu's Advanced section", () => {
  test("starts folded away on the overview, with its rows out of sight", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);
    const menu: Locator = desktopMenu(page);

    await expect(advancedToggle(menu)).toBeVisible();
    await expect(advancedToggle(menu)).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    for (const advancedPage of ADVANCED_PAGES) {
      await expect(advancedLink(menu, advancedPage.path)).toHaveCount(1);
      await expect(advancedLink(menu, advancedPage.path)).toBeHidden();
    }

    // The everyday pages are all still there.
    await expect(
      menu.getByRole("link", { name: "Overview", exact: true }),
    ).toBeVisible();
    await expect(
      menu.getByRole("link", { name: "Monitoring Logs", exact: true }),
    ).toBeVisible();
  });

  test("opens on a click, shows its rows, and folds away again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);
    const menu: Locator = desktopMenu(page);

    await advancedToggle(menu).click();

    await expect(advancedToggle(menu)).toHaveAttribute("aria-expanded", "true");
    for (const advancedPage of ADVANCED_PAGES) {
      await expect(
        menu.getByRole("link", { name: advancedPage.title, exact: true }),
      ).toBeVisible();
    }

    await advancedToggle(menu).click();

    await expect(advancedToggle(menu)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(advancedLink(menu, "/delete")).toBeHidden();
  });

  /*
   * The reason a fold is visibility: hidden and not only max-height: 0 and
   * opacity: 0. With only those, every folded link was still a tab stop.
   */
  test("the keyboard skips its rows while folded and walks them once open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);
    const menu: Locator = desktopMenu(page);

    await advancedToggle(menu).focus();
    await page.keyboard.press("Tab");

    expect(await focusIsInsideAdvanced(page, menu)).toBe(false);

    // Back to the toggle, and open it from the keyboard.
    await advancedToggle(menu).focus();
    await page.keyboard.press("Enter");
    await expect(advancedToggle(menu)).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Tab");

    expect(await focusIsInsideAdvanced(page, menu)).toBe(true);
    await expect(advancedLink(menu, "/owners")).toBeFocused();
  });

  test("stays folded on Monitoring Logs, which is in Activity", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);
    const menu: Locator = desktopMenu(page);

    await menu
      .getByRole("link", { name: "Monitoring Logs", exact: true })
      .click();

    await expect(page).toHaveURL(new RegExp(`${MONITOR_PATH}/logs`));
    await expect(advancedToggle(menu)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(advancedLink(menu, "/settings")).toBeHidden();
  });

  // Opened by the user, it is not folded away under them on the next page.
  test("stays open on the next page once the user opened it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);
    const menu: Locator = desktopMenu(page);

    await advancedToggle(menu).click();
    await expect(advancedToggle(menu)).toHaveAttribute("aria-expanded", "true");

    await menu
      .getByRole("link", { name: "Monitoring Logs", exact: true })
      .click();

    await expect(page).toHaveURL(new RegExp(`${MONITOR_PATH}/logs`));
    await expect(advancedToggle(menu)).toHaveAttribute("aria-expanded", "true");
    await expect(
      menu.getByRole("link", { name: "Delete Monitor", exact: true }),
    ).toBeVisible();
  });

  /*
   * On a phone the menu is a panel that closes when a page is picked. A tap
   * on a section's header used to close it as well, so a folded section could
   * never be opened there and its pages were out of reach.
   */
  test("starts folded in the phone menu, and opens there without closing the menu", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openMonitor(page);

    const menuButton: Locator = page.getByTestId("mobile-sidemenu-toggle");
    await menuButton.click();
    const menu: Locator = phoneMenu(page);
    await expect(menu).toBeVisible();

    await expect(advancedToggle(menu)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(advancedLink(menu, "/delete")).toBeHidden();

    await advancedToggle(menu).click();

    await expect(menu).toBeVisible();
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    await expect(advancedToggle(menu)).toHaveAttribute("aria-expanded", "true");
    await expect(
      menu.getByRole("link", { name: "Delete Monitor", exact: true }),
    ).toBeVisible();

    // Picking a page still closes the menu.
    await menu
      .getByRole("link", { name: "Monitoring Logs", exact: true })
      .click();

    await expect(page).toHaveURL(new RegExp(`${MONITOR_PATH}/logs`));
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toHaveCount(0);
  });
});
