import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * The Runbooks side menu, after AI Access went.
 *
 * "Remove AI Access" from Runbooks > Runners: hosts and Kubernetes clusters
 * have AI agents of their own now, and the runbook credentials AI Access
 * held are gone. The Runners had a folded section of their own while AI
 * Access stood beside them; with one row left, the Runners entry sits in
 * the menu's first section, with the runbooks and their executions.
 *
 * In a browser, around the real Runbooks route group (RunbooksMenu/
 * Fixture: Routes/RunbookRoutes and Routes/SettingsRoutes mounted at their
 * real addresses): the menu's sections and entries as they are drawn at a
 * laptop's 1280 pixels and a phone's 390; no AI Access anywhere; the Runners
 * entry leading to its page, marked there; the old AI Access address, and
 * the older Project Settings one, opening the Runners in one hop that Back
 * does not bounce through; the keyboard's way through the menu; German and
 * dark mode. The jest suites (RunnerNavigation and RunbookRunnerRoutes in
 * packages/Common, RunnersLiveUnderRunbooks in packages/App) read the
 * menu's and the routes' code; this draws them.
 */

const PORT: string = process.env["RUNBOOKS_MENU_FIXTURE_PORT"] || "4388";
const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000e1";

const RUNBOOKS: string = `/dashboard/${PROJECT_ID}/runbooks`;
const EXECUTIONS: string = `${RUNBOOKS}/executions`;
const RUNNERS: string = `${RUNBOOKS}/runners`;
const GLOBAL_VARIABLES: string = `${RUNBOOKS}/settings/variables`;
const OWNER_RULES: string = `${RUNBOOKS}/settings/owner-rules`;
const LABEL_RULES: string = `${RUNBOOKS}/settings/label-rules`;
// The pages' old addresses: AI Access, and Runner Credentials before it.
const AI_ACCESS: string = `${RUNBOOKS}/runner-credentials`;
const RUNNER_CREDENTIALS: string = `/dashboard/${PROJECT_ID}/settings/runner-credentials`;

// The menu's sections, in order: no Runners section any more.
const SECTIONS: ReadonlyArray<string> = ["Runbooks", "Settings", "Developer"];

const LAPTOP: { width: number; height: number } = { width: 1280, height: 900 };
const PHONE: { width: number; height: number } = { width: 390, height: 844 };

// The Dashboard's German words, as the fixture draws them with ?lang=de.
const GERMAN_RUNNERS: string = "Runbook-Agents";
const GERMAN_AI_ACCESS: string = "KI-Zugriff";

// The class on <html> that the Dashboard's dark mode is drawn from.
const DARK_MODE_CLASS: RegExp = /(?:^|\s)dark(?:\s|$)/;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/runbooks-menu-ui",
);

const pageErrors: Map<Page, Array<string>> = new Map();
const leftTheFixture: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  leftTheFixture.set(page, aborted);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
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
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    leftTheFixture.get(page) || [],
    "requests that left the fixture server",
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

// A page of the fixture, once the Runbooks layout has drawn its header.
async function open(
  page: Page,
  address: string,
  viewport: { width: number; height: number } = LAPTOP,
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto(address);
  // The first load parses a large bundle; the header names the product.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Runbooks",
    { timeout: 60000 },
  );
}

/*
 * The laptop menu, by the name it gives itself: "Main navigation", or what
 * the reader's language calls it.
 */
function desktopMenu(page: Page, name: string = "Main navigation"): Locator {
  return page.locator(`aside[role='navigation'][aria-label='${name}']`);
}

function phoneMenu(page: Page): Locator {
  return page.locator("div[role='navigation'][aria-label='Main navigation']");
}

// A section's toggle, by its heading's text (CSS draws it in capitals).
function sectionToggle(menu: Locator, title: string): Locator {
  return menu.locator(
    `xpath=.//h6[normalize-space(.)='${title}']/ancestor::button[1]`,
  );
}

// The element a section's toggle shows and hides.
async function sectionBody(menu: Locator, title: string): Promise<Locator> {
  const bodyId: string | null = await sectionToggle(menu, title).getAttribute(
    "aria-controls",
  );

  expect(bodyId, `the ${title} toggle names the body it controls`).toBeTruthy();

  return menu.locator(`[id="${bodyId}"]`);
}

function link(scope: Locator, href: string): Locator {
  return scope.locator(`a[href='${href}']`);
}

async function sectionTitles(menu: Locator): Promise<Array<string>> {
  // allTextContents does not wait: the menu is drawn first.
  await expect(menu.locator("h6").first()).toBeVisible();

  return (await menu.locator("h6").allTextContents()).map(
    (title: string): string => {
      return title.trim();
    },
  );
}

// The entries of a section, in order, as their address and their words.
async function entries(
  body: Locator,
): Promise<Array<{ href: string; text: string }>> {
  return await body.locator("a").evaluateAll(
    (
      anchors: Array<Element>,
    ): Array<{
      href: string;
      text: string;
    }> => {
      return anchors.map((anchor: Element): { href: string; text: string } => {
        return {
          href: anchor.getAttribute("href") || "",
          text: (anchor.textContent || "").trim(),
        };
      });
    },
  );
}

// Whether a menu entry is drawn as the page you are on.
async function isMarked(entry: Locator): Promise<boolean> {
  return await entry.evaluate((element: Element): boolean => {
    return element.classList.contains("bg-indigo-50");
  });
}

async function expectFolded(menu: Locator, title: string): Promise<void> {
  await expect(sectionToggle(menu, title)).toHaveAttribute(
    "aria-expanded",
    "false",
  );
}

async function expectOpen(menu: Locator, title: string): Promise<void> {
  await expect(sectionToggle(menu, title)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
}

// The page's address, without the fixture's query string.
async function expectPath(page: Page, pathname: string): Promise<void> {
  await expect
    .poll((): string => {
      return new URL(page.url()).pathname;
    })
    .toBe(pathname);
}

// How far the page runs past the screen's right edge, in pixels.
async function overflow(page: Page): Promise<number> {
  return await page.evaluate((): number => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
}

// What the menu says nowhere: the page that is gone, by name and by address.
async function expectNoAiAccess(
  scope: Locator,
  name: string = "AI Access",
): Promise<void> {
  await expect(scope.locator(`a[href*='runner-credentials']`)).toHaveCount(0);
  await expect(scope).not.toContainText(name);
}

test.describe("at a laptop's 1280 pixels", () => {
  test("the first section lists Runbooks, Executions and Runners, open; Settings is folded; there is no Runners section and no AI Access", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RUNBOOKS);
    const menu: Locator = desktopMenu(page);

    expect(await sectionTitles(menu)).toEqual(SECTIONS);
    await expectOpen(menu, "Runbooks");
    await expectFolded(menu, "Settings");

    expect(await entries(await sectionBody(menu, "Runbooks"))).toEqual([
      { href: RUNBOOKS, text: "Runbooks" },
      { href: EXECUTIONS, text: "Executions" },
      { href: RUNNERS, text: "Runners" },
    ]);

    const runners: Locator = link(menu, RUNNERS);

    await expect(runners).toBeVisible();
    await expect(runners.locator("svg")).toHaveCount(1);
    // Drawn right below Executions, above the Settings section.
    const runnersBox: { y: number; height: number } | null =
      await runners.boundingBox();
    const executionsBox: { y: number } | null = await link(
      menu,
      EXECUTIONS,
    ).boundingBox();
    const settingsBox: { y: number } | null = await sectionToggle(
      menu,
      "Settings",
    ).boundingBox();

    expect(runnersBox!.y).toBeGreaterThan(executionsBox!.y);
    expect(settingsBox!.y).toBeGreaterThanOrEqual(
      runnersBox!.y + runnersBox!.height,
    );

    // Settings holds the variables and the rules, out of sight while folded.
    const settings: Locator = await sectionBody(menu, "Settings");

    expect(await entries(settings)).toEqual([
      { href: GLOBAL_VARIABLES, text: "Global Variables" },
      { href: OWNER_RULES, text: "Owner Rules" },
      { href: LABEL_RULES, text: "Label Rules" },
    ]);
    await expect(link(menu, GLOBAL_VARIABLES)).toBeHidden();

    await expectNoAiAccess(menu);
    expect(await isMarked(link(menu, RUNBOOKS))).toBe(true);
    expect(await isMarked(runners)).toBe(false);

    await screenshot(page, "laptop-runbooks");
  });

  test("Runners leads to its page, marked there, under the Runbooks breadcrumb", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RUNBOOKS);
    const menu: Locator = desktopMenu(page);

    await link(menu, RUNNERS).click();

    await expectPath(page, RUNNERS);
    expect(await isMarked(link(menu, RUNNERS))).toBe(true);
    expect(await isMarked(link(menu, RUNBOOKS))).toBe(false);

    const breadcrumb: Locator = page.getByRole("navigation", {
      name: "Breadcrumb",
    });

    await expect(breadcrumb).toContainText("Runbooks");
    await expect(breadcrumb).toContainText("Runners");
    await expect(breadcrumb).not.toContainText("AI Access");

    // The real Runners page, beside the menu: the project's own Runners.
    await expect(
      page.getByTestId("card-details-heading").filter({ hasText: /Runners$/ }),
    ).not.toHaveCount(0);

    // The section stays as it was: the Runners are no fold to open.
    await expectOpen(menu, "Runbooks");
    await expectFolded(menu, "Settings");
    await expectNoAiAccess(menu);

    await screenshot(page, "laptop-runners");
  });

  test("AI Access's old address opens the Runners in one hop, keeping its query, and Back does not bounce through it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RUNBOOKS);
    await page.goto(`${AI_ACCESS}?from=bookmark`);

    await expectPath(page, RUNNERS);
    expect(new URL(page.url()).searchParams.get("from")).toBe("bookmark");

    const menu: Locator = desktopMenu(page);

    await expect(link(menu, RUNNERS)).toBeVisible();
    expect(await isMarked(link(menu, RUNNERS))).toBe(true);
    await expectNoAiAccess(menu);
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).not.toContainText("AI Access");

    // The old entry was replaced in the history: Back is the page before it.
    await page.goBack();
    await expectPath(page, RUNBOOKS);
  });

  test("Project Settings' Runner Credentials, the page's oldest address, opens the Runners too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto(RUNNER_CREDENTIALS);

    await expectPath(page, RUNNERS);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Runbooks",
      { timeout: 60000 },
    );
    expect(await isMarked(link(desktopMenu(page), RUNNERS))).toBe(true);
  });

  test("the keyboard goes from Executions to Runners to the Settings section, with no fold in between", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RUNBOOKS);
    const menu: Locator = desktopMenu(page);

    await link(menu, EXECUTIONS).focus();
    await page.keyboard.press("Tab");
    await expect(link(menu, RUNNERS)).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(sectionToggle(menu, "Settings")).toBeFocused();

    // Enter on Runners opens its page.
    await page.keyboard.press("Shift+Tab");
    await expect(link(menu, RUNNERS)).toBeFocused();
    await page.keyboard.press("Enter");
    await expectPath(page, RUNNERS);
  });

  test("in German the entry is the Runners' German name, and AI Access is in no language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${RUNNERS}?lang=de`);
    const menu: Locator = desktopMenu(page, "Hauptnavigation");

    await expect(link(menu, RUNNERS)).toHaveText(GERMAN_RUNNERS);
    expect(await isMarked(link(menu, RUNNERS))).toBe(true);
    await expectNoAiAccess(menu, GERMAN_AI_ACCESS);
    await expect(menu).not.toContainText("AI Access");

    await screenshot(page, "laptop-runners-german");
  });

  test("in dark mode the Runners entry reads against the menu", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${RUNNERS}?theme=dark`);

    expect(
      await page.evaluate((): string => {
        return document.documentElement.className;
      }),
    ).toMatch(DARK_MODE_CLASS);

    const menu: Locator = desktopMenu(page);

    await expect(link(menu, RUNNERS)).toBeVisible();
    await expectNoAiAccess(menu);

    await screenshot(page, "laptop-runners-dark");
  });
});

test.describe("at a phone's 390 pixels", () => {
  test("the menu opens to Runbooks, Executions and Runners, with no AI Access, and nothing runs off the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RUNBOOKS, PHONE);

    expect(await overflow(page)).toBeLessThanOrEqual(0);

    const toggle: Locator = page.getByTestId("mobile-sidemenu-toggle");

    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText("Runbooks");
    await expect(desktopMenu(page)).toBeHidden();

    await toggle.click();

    const menu: Locator = phoneMenu(page);

    await expect(menu).toBeVisible();
    expect(await sectionTitles(menu)).toEqual(SECTIONS);
    await expectOpen(menu, "Runbooks");
    await expectFolded(menu, "Settings");
    expect(await entries(await sectionBody(menu, "Runbooks"))).toEqual([
      { href: RUNBOOKS, text: "Runbooks" },
      { href: EXECUTIONS, text: "Executions" },
      { href: RUNNERS, text: "Runners" },
    ]);
    await expect(link(menu, RUNNERS)).toBeVisible();
    await expectNoAiAccess(menu);

    // The open menu stays inside the screen too.
    const box: { x: number; width: number } | null = await menu.boundingBox();

    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width);
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    await screenshot(page, "phone-menu-open");
  });

  test("Runners leads to its page, and the menu's summary names it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RUNBOOKS, PHONE);

    await page.getByTestId("mobile-sidemenu-toggle").click();
    await link(phoneMenu(page), RUNNERS).click();

    await expectPath(page, RUNNERS);
    await expect(page.getByTestId("mobile-sidemenu-toggle")).toContainText(
      "Runners",
    );
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    await screenshot(page, "phone-runners");
  });

  test("AI Access's old address opens the Runners on a phone too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto(AI_ACCESS);

    await expectPath(page, RUNNERS);
    await expect(page.getByTestId("mobile-sidemenu-toggle")).toContainText(
      "Runners",
      { timeout: 60000 },
    );
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});
