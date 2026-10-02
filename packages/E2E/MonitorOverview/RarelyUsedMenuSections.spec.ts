import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";

/*
 * "We need to make the UI very simple to understand and use, and one of the
 * ways to do that is collapsing things in the side menu that are not used
 * frequently ... Can you please do this for every side menu across the
 * project." (the maintainer)
 *
 * Advanced was the first section to fold away by default (see
 * AdvancedMenuSection.spec.ts). Every rarely used kind of section now folds
 * the same way, by its title: on a monitor's page that adds Configuration
 * (Criteria, Dependencies, Interval, Probes) and Developer. This checks, in a
 * real browser against the offline fixture, what jsdom cannot: that a section
 * folded by its title is out of sight AND out of the keyboard's way, that it
 * opens from a click and from the keyboard, that its pages are reachable once
 * it is open, and that it opens in the phone menu without closing it.
 *
 * The same guards as MonitorOverview.spec.ts: a network fence, no uncaught
 * page errors, and no request the fixture does not model.
 */

const PORT: string = "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
// The fixture's API monitor, "Checkout API".
const MONITOR_PATH: string = `/dashboard/${PROJECT_ID}/monitors/70000000-0000-4000-8000-000000000001`;

// Pages/Monitor/View/SideMenu.tsx: the Configuration section of an API monitor, in order.
const CONFIGURATION_PAGES: ReadonlyArray<{ title: string; path: string }> = [
  { title: "Criteria", path: "/criteria" },
  { title: "Dependencies", path: "/dependencies" },
  { title: "Interval", path: "/interval" },
  { title: "Probes", path: "/probes" },
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

async function openMonitor(page: Page): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.goto(`${MONITOR_PATH}?type=api`);
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
 * A section's toggle, by its heading's text. The heading is drawn in
 * capitals by CSS, so it is matched on its text, not on what is shown.
 */
function sectionToggle(menu: Locator, title: string): Locator {
  return menu.locator(
    `xpath=.//h6[normalize-space(.)='${title}']/ancestor::button[1]`,
  );
}

function configurationLink(menu: Locator, path: string): Locator {
  return menu.locator(`a[href='${MONITOR_PATH}${path}']`);
}

// Whether keyboard focus is inside the element a section's toggle controls.
async function focusIsInside(
  page: Page,
  menu: Locator,
  title: string,
): Promise<boolean> {
  const bodyId: string | null = await sectionToggle(menu, title).getAttribute(
    "aria-controls",
  );

  expect(bodyId, `the ${title} toggle names the body it controls`).toBeTruthy();

  return page.evaluate((id: string): boolean => {
    const body: HTMLElement | null = document.getElementById(id);
    return Boolean(body && body.contains(document.activeElement));
  }, bodyId!);
}

test.describe("a monitor's menu folds its rarely used sections by their titles", () => {
  test("Configuration and Developer start folded on the overview; Overview and Activity stay open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);
    const menu: Locator = desktopMenu(page);

    for (const title of ["Overview", "Activity"]) {
      await expect(sectionToggle(menu, title)).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    }

    for (const title of ["Configuration", "Developer", "Advanced"]) {
      await expect(sectionToggle(menu, title)).toBeVisible();
      await expect(sectionToggle(menu, title)).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    }

    for (const configurationPage of CONFIGURATION_PAGES) {
      await expect(configurationLink(menu, configurationPage.path)).toHaveCount(
        1,
      );
      await expect(
        configurationLink(menu, configurationPage.path),
      ).toBeHidden();
    }

    // The everyday pages are all still on screen.
    await expect(
      menu.getByRole("link", { name: "Monitoring Logs", exact: true }),
    ).toBeVisible();
    await expect(
      menu.getByRole("link", { name: "Incidents", exact: true }),
    ).toBeVisible();
  });

  test("Configuration opens on a click, shows its pages, and folds away again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);
    const menu: Locator = desktopMenu(page);
    const toggle: Locator = sectionToggle(menu, "Configuration");

    await toggle.click();

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (const configurationPage of CONFIGURATION_PAGES) {
      await expect(
        menu.getByRole("link", { name: configurationPage.title, exact: true }),
      ).toBeVisible();
    }

    await toggle.click();

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(configurationLink(menu, "/criteria")).toBeHidden();
  });

  test("once opened, its pages are a click away", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);
    const menu: Locator = desktopMenu(page);

    await sectionToggle(menu, "Configuration").click();
    await menu.getByRole("link", { name: "Criteria", exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`${MONITOR_PATH}/criteria`));
    await expect(page.getByTestId("stub-page")).toHaveAttribute(
      "data-page",
      "MONITOR_VIEW_CRITERIA",
    );
  });

  test("the keyboard skips its rows while folded and walks them once open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMonitor(page);
    const menu: Locator = desktopMenu(page);
    const toggle: Locator = sectionToggle(menu, "Configuration");

    await toggle.focus();
    await page.keyboard.press("Tab");

    expect(await focusIsInside(page, menu, "Configuration")).toBe(false);

    // Back to the toggle, and open it from the keyboard.
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Tab");

    expect(await focusIsInside(page, menu, "Configuration")).toBe(true);
    await expect(configurationLink(menu, "/criteria")).toBeFocused();
  });

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

    const toggle: Locator = sectionToggle(menu, "Configuration");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(configurationLink(menu, "/criteria")).toBeHidden();

    await toggle.click();

    await expect(menu).toBeVisible();
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      menu.getByRole("link", { name: "Criteria", exact: true }),
    ).toBeVisible();
  });
});
