import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { sideMenuAtRest } from "../SuiteHelpers/SideMenuAtRest";

/*
 * "Create a new section for rules and have monitor rules there. The section
 * should be collapsed by default" (the maintainer).
 *
 * A status page's and an SLO's side menus in a browser, around their real
 * view layouts (RulesMenuSection/Fixture): a status page keeps its Monitor
 * Rules in a Rules section right below Resources, an SLO its Monitor Rules
 * and Burn Rate Rules in a Rules section right below Configuration, and both
 * sections start folded.
 *
 * jsdom applies no CSS, so the jest suites (StatusPageRulesMenu,
 * SloViewSideMenu and RulesMenuSections in packages/Common) can only read the
 * classes a folded section carries. Here a folded Rules section is checked to
 * be out of sight and out of the keyboard's way; to open from a click and
 * from the keyboard and lead to its pages; to open by itself on a page inside
 * it, one rule's own page included; to stay open while the pages change; to
 * open in the phone menu without closing it; and to read in German and in
 * dark mode. And, since Monitor Rules is now out of sight, an SLO's real
 * Monitors page, with nothing attached, offers a button to it.
 */

const PORT: string = process.env["RULES_MENU_SECTION_FIXTURE_PORT"] || "4385";
const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000f1";
const STATUS_PAGE_ID: string = "20000000-0000-4000-8000-0000000000f2";
const SLO_ID: string = "30000000-0000-4000-8000-0000000000f3";
// A rule's own page: the menu lists its rules page, not the rule.
const RULE_ID: string = "70000000-0000-4000-8000-0000000000fb";

const STATUS_PAGE_PATH: string = `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}`;
const SLO_PATH: string = `/dashboard/${PROJECT_ID}/slos/${SLO_ID}`;

const STATUS_PAGE_SECTIONS: ReadonlyArray<string> = [
  "Basic",
  "Resources",
  "Rules",
  "Subscribers",
  "Notification Logs",
  "Branding",
  "Security",
  "AI",
  "Developer",
  "Advanced",
];

const SLO_SECTIONS: ReadonlyArray<string> = [
  "Overview",
  "Activity",
  "Configuration",
  "Rules",
  "Developer",
  "Management",
];

// The class on <html> that the Dashboard's dark mode is drawn from.
const DARK_MODE_CLASS: RegExp = /(?:^|\s)dark(?:\s|$)/;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/rules-menu-section-ui",
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

  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const fixture: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __rulesMenuFixture?: { unhandled?: Array<unknown> };
        }
      ).__rulesMenuFixture;
      return JSON.parse(
        JSON.stringify(fixture?.unhandled || []),
      ) as Array<unknown>;
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "reads the fixture does not model").toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

/*
 * A page of the fixture, once the layout has drawn the record's name and
 * the menu is at rest (SuiteHelpers/SideMenuAtRest). While the fixture's
 * Tailwind folds the sections that start folded, on first paint, their
 * rows are still tab stops: a Tab from the folded Rules' title went to
 * Monitor Rules, not to the next section's title.
 */
async function open(page: Page, address: string): Promise<void> {
  await page.goto(address);
  // The first load parses a large bundle; the header names the record.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    address.includes("/slos/") ? "Checkout availability" : "Acme Public Status",
    { timeout: 60000 },
  );
  await sideMenuAtRest(page);
}

/*
 * The desktop menu, by the name it gives itself: "Main navigation", or what
 * the reader's language calls it (German: Hauptnavigation).
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

function link(menu: Locator, href: string): Locator {
  return menu.locator(`a[href='${href}']`);
}

// The element a section's toggle shows and hides.
async function sectionBody(menu: Locator, title: string): Promise<Locator> {
  const bodyId: string | null = await sectionToggle(menu, title).getAttribute(
    "aria-controls",
  );

  expect(bodyId, `the ${title} toggle names the body it controls`).toBeTruthy();

  return menu.locator(`[id="${bodyId}"]`);
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

// The stand-in page beside the menu names the page it stands for.
async function expectStandIn(page: Page, title: string): Promise<void> {
  await expect(
    page.getByTestId("fixture-page").getByRole("heading", { level: 2 }),
  ).toHaveText(title);
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

async function topOf(target: Locator): Promise<number> {
  const box: { y: number } | null = await target.boundingBox();

  expect(box, "the element is drawn").not.toBeNull();

  return box!.y;
}

test.describe("a status page's side menu", () => {
  test("on the Overview, Rules sits folded right below Resources, with Monitor Rules out of sight", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, STATUS_PAGE_PATH);
    const menu: Locator = desktopMenu(page);

    expect(await sectionTitles(menu)).toEqual(STATUS_PAGE_SECTIONS);
    await expectOpen(menu, "Basic");
    await expectOpen(menu, "Resources");
    await expectFolded(menu, "Rules");

    const resources: Locator = link(menu, `${STATUS_PAGE_PATH}/resources`);
    const monitorRules: Locator = link(
      menu,
      `${STATUS_PAGE_PATH}/monitor-rules`,
    );

    await expect(resources).toBeVisible();
    await expect(resources).toHaveText("Monitors");
    await expect(monitorRules).toHaveCount(1);
    await expect(monitorRules).toBeHidden();

    // Drawn between the resources entry and the Subscribers section.
    const rulesTop: number = await topOf(sectionToggle(menu, "Rules"));
    expect(rulesTop).toBeGreaterThan(await topOf(resources));
    expect(rulesTop).toBeLessThan(
      await topOf(sectionToggle(menu, "Subscribers")),
    );

    await screenshot(page, "status-page-overview");
  });

  test("a folded Rules is out of the keyboard's way: Tab goes from its title to the next section's", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, STATUS_PAGE_PATH);
    const menu: Locator = desktopMenu(page);

    await sectionToggle(menu, "Rules").focus();
    await page.keyboard.press("Tab");

    await expect(sectionToggle(menu, "Subscribers")).toBeFocused();
    await expect(
      link(menu, `${STATUS_PAGE_PATH}/monitor-rules`),
    ).not.toBeFocused();
  });

  test("Rules opens from a click, shows Monitor Rules with its icon, and folds again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, STATUS_PAGE_PATH);
    const menu: Locator = desktopMenu(page);
    const monitorRules: Locator = link(
      menu,
      `${STATUS_PAGE_PATH}/monitor-rules`,
    );

    await sectionToggle(menu, "Rules").click();

    await expectOpen(menu, "Rules");
    await expect(monitorRules).toBeVisible();
    await expect(monitorRules).toHaveText("Monitor Rules");
    await expect(monitorRules.locator("svg")).toHaveCount(1);
    await expect((await sectionBody(menu, "Rules")).locator("a")).toHaveCount(
      1,
    );
    // Opening it opens nothing else.
    await expectFolded(menu, "Subscribers");

    await screenshot(page, "status-page-rules-open");

    await sectionToggle(menu, "Rules").click();

    await expectFolded(menu, "Rules");
    await expect(monitorRules).toBeHidden();
  });

  test("Rules opens from the keyboard, and its row is the next stop on the way to Monitor Rules", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, STATUS_PAGE_PATH);
    const menu: Locator = desktopMenu(page);
    const toggle: Locator = sectionToggle(menu, "Rules");
    const monitorRules: Locator = link(
      menu,
      `${STATUS_PAGE_PATH}/monitor-rules`,
    );

    await toggle.focus();
    await page.keyboard.press("Enter");
    await expectOpen(menu, "Rules");

    await page.keyboard.press("Space");
    await expectFolded(menu, "Rules");

    await page.keyboard.press("Space");
    await expectOpen(menu, "Rules");

    await page.keyboard.press("Tab");
    await expect(monitorRules).toBeFocused();

    await page.keyboard.press("Enter");

    await expectPath(page, `${STATUS_PAGE_PATH}/monitor-rules`);
    await expectStandIn(page, "Monitor Rules");
    await expectOpen(menu, "Rules");
    expect(await isMarked(monitorRules)).toBe(true);
  });

  test("the Monitor Rules page opens Rules by itself, with its entry marked; one rule's own page does too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGE_PATH}/monitor-rules`);
    const menu: Locator = desktopMenu(page);
    const monitorRules: Locator = link(
      menu,
      `${STATUS_PAGE_PATH}/monitor-rules`,
    );

    await expectOpen(menu, "Rules");
    await expect(monitorRules).toBeVisible();
    expect(await isMarked(monitorRules)).toBe(true);
    // Nothing else folded opens with it.
    await expectFolded(menu, "Subscribers");
    await expectFolded(menu, "Advanced");

    await screenshot(page, "status-page-monitor-rules");

    await open(page, `${STATUS_PAGE_PATH}/monitor-rules/${RULE_ID}`);

    await expectStandIn(page, "One of the Monitor Rules");
    await expectOpen(menu, "Rules");
    await expect(monitorRules).toBeVisible();
    await expectFolded(menu, "Subscribers");
  });

  test("Rules stays open while the pages change, and is folded again on a fresh visit", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGE_PATH}/monitor-rules`);
    const menu: Locator = desktopMenu(page);
    const resources: Locator = link(menu, `${STATUS_PAGE_PATH}/resources`);
    const monitorRules: Locator = link(
      menu,
      `${STATUS_PAGE_PATH}/monitor-rules`,
    );

    await resources.click();

    await expectPath(page, `${STATUS_PAGE_PATH}/resources`);
    await expectStandIn(page, "Resources");
    await expectOpen(menu, "Rules");
    expect(await isMarked(resources)).toBe(true);
    expect(await isMarked(monitorRules)).toBe(false);

    await link(menu, STATUS_PAGE_PATH).click();

    await expectPath(page, STATUS_PAGE_PATH);
    await expectOpen(menu, "Rules");

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Acme Public Status",
      { timeout: 60000 },
    );

    await expectFolded(menu, "Rules");
    await expect(monitorRules).toBeHidden();
  });

  test("with monitor groups on, the resources entry reads Resources, and Rules still holds Monitor Rules", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGE_PATH}?groups=1`);
    const menu: Locator = desktopMenu(page);

    await expect(link(menu, `${STATUS_PAGE_PATH}/resources`)).toHaveText(
      "Resources",
    );
    await expectFolded(menu, "Rules");

    await sectionToggle(menu, "Rules").click();

    await expect(link(menu, `${STATUS_PAGE_PATH}/monitor-rules`)).toHaveText(
      "Monitor Rules",
    );
  });
});

test.describe("an SLO's side menu", () => {
  test("on the Overview, Configuration, Rules and Management are folded; Rules holds both rules pages", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SLO_PATH);
    const menu: Locator = desktopMenu(page);
    const monitors: Locator = link(menu, `${SLO_PATH}/monitors`);
    const monitorRules: Locator = link(menu, `${SLO_PATH}/monitor-rules`);
    const burnRateRules: Locator = link(menu, `${SLO_PATH}/burn-rate-rules`);

    expect(await sectionTitles(menu)).toEqual(SLO_SECTIONS);
    await expectOpen(menu, "Overview");
    await expectOpen(menu, "Activity");

    for (const title of ["Configuration", "Rules", "Developer", "Management"]) {
      await expectFolded(menu, title);
    }

    await expect(monitors).toBeHidden();
    await expect(monitorRules).toBeHidden();
    await expect(burnRateRules).toBeHidden();

    await screenshot(page, "slo-overview");

    await sectionToggle(menu, "Rules").click();

    await expectOpen(menu, "Rules");
    await expect(monitorRules).toBeVisible();
    await expect(burnRateRules).toBeVisible();
    expect(await topOf(monitorRules)).toBeLessThan(await topOf(burnRateRules));

    const body: Locator = await sectionBody(menu, "Rules");
    await expect(body.locator("a")).toHaveText([
      "Monitor Rules",
      "Burn Rate Rules",
    ]);

    // The monitors stay under Configuration, which is still folded.
    await expectFolded(menu, "Configuration");
    await expect(monitors).toBeHidden();

    await screenshot(page, "slo-overview-rules-open");
  });

  test("Burn Rate Rules opens Rules by itself and leaves Configuration folded; one monitor rule's page opens it too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${SLO_PATH}/burn-rate-rules`);
    const menu: Locator = desktopMenu(page);
    const burnRateRules: Locator = link(menu, `${SLO_PATH}/burn-rate-rules`);

    await expectOpen(menu, "Rules");
    expect(await isMarked(burnRateRules)).toBe(true);
    await expectFolded(menu, "Configuration");
    await expectFolded(menu, "Management");
    await expect(link(menu, `${SLO_PATH}/monitors`)).toBeHidden();

    await screenshot(page, "slo-burn-rate-rules");

    await open(page, `${SLO_PATH}/monitor-rules/${RULE_ID}`);

    await expectStandIn(page, "One of the Monitor Rules");
    await expectOpen(menu, "Rules");
    await expect(link(menu, `${SLO_PATH}/monitor-rules`)).toBeVisible();
    await expectFolded(menu, "Configuration");
  });

  /*
   * With Monitor Rules folded away under Rules, the real Monitors page of an
   * SLO with nothing attached is where people learn rules exist: its empty
   * list names two ways to attach monitors, and offers a button for each.
   */
  test("with nothing attached, the Monitors page's empty list offers Create a monitor rule, which opens Monitor Rules with Rules open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${SLO_PATH}/monitors`);
    const menu: Locator = desktopMenu(page);
    const monitorRules: Locator = link(menu, `${SLO_PATH}/monitor-rules`);
    const emptyList: Locator = page.getByTestId("table-empty-state");
    const addMonitors: Locator = emptyList.getByTestId(
      "empty-table-create-button",
    );
    const createRule: Locator = emptyList.getByTestId(
      "slo-monitors-create-monitor-rule",
    );

    // The page keeps its own section open; Rules stays folded.
    await expectOpen(menu, "Configuration");
    await expectFolded(menu, "Rules");
    await expect(monitorRules).toBeHidden();

    await expect(emptyList).toContainText("No monitors attached");
    await expect(emptyList).toContainText(
      "Add monitors by hand, or create a monitor rule",
    );
    await expect(addMonitors).toHaveText("Add Monitors");
    await expect(createRule).toHaveText("Create a monitor rule");
    await expect(createRule.locator("svg")).toHaveCount(1);
    await expect(page.getByTestId("slo-monitors-managed-by-rules")).toHaveCount(
      0,
    );

    // Side by side, Add Monitors first, and the next stop after it.
    expect(Math.round(await topOf(createRule))).toBe(
      Math.round(await topOf(addMonitors)),
    );
    await addMonitors.focus();
    await page.keyboard.press("Tab");
    await expect(createRule).toBeFocused();

    await screenshot(page, "slo-monitors-empty");

    await page.keyboard.press("Enter");

    await expectPath(page, `${SLO_PATH}/monitor-rules`);
    await expectStandIn(page, "Monitor Rules");
    await expectOpen(menu, "Rules");
    await expect(monitorRules).toBeVisible();
    expect(await isMarked(monitorRules)).toBe(true);
  });

  test("while monitor rules are enabled, the empty Monitors page links to them from its banner instead", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${SLO_PATH}/monitors?rules=2`);
    const menu: Locator = desktopMenu(page);
    const banner: Locator = page.getByTestId("slo-monitors-managed-by-rules");

    await expect(banner).toContainText("2 enabled monitor rules decide");
    await expect(page.getByTestId("table-empty-state")).toContainText(
      "No monitors match this SLO's enabled monitor rules yet",
    );
    await expect(
      page.getByTestId("slo-monitors-create-monitor-rule"),
    ).toHaveCount(0);

    await banner.getByRole("link", { name: "Manage Monitor Rules" }).click();

    await expectPath(page, `${SLO_PATH}/monitor-rules`);
    await expectOpen(menu, "Rules");
    expect(await isMarked(link(menu, `${SLO_PATH}/monitor-rules`))).toBe(true);
  });

  test("folded sections are out of the keyboard's way: Tab walks Configuration, Rules, Developer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, SLO_PATH);
    const menu: Locator = desktopMenu(page);

    await sectionToggle(menu, "Configuration").focus();
    await page.keyboard.press("Tab");
    await expect(sectionToggle(menu, "Rules")).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(sectionToggle(menu, "Developer")).toBeFocused();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a status page: Rules opens in the phone menu without closing it, and Monitor Rules leads to its page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, STATUS_PAGE_PATH);
    const toggle: Locator = page.getByTestId("mobile-sidemenu-toggle");

    await expect(desktopMenu(page)).toHaveCount(0);
    await expect(toggle).toBeVisible();

    await toggle.click();

    const menu: Locator = phoneMenu(page);
    await expect(menu).toBeVisible();
    await expectFolded(menu, "Rules");

    await sectionToggle(menu, "Rules").click();

    // A section's title opens it; it does not close the menu.
    await expect(menu).toBeVisible();
    await expectOpen(menu, "Rules");

    const monitorRules: Locator = link(
      menu,
      `${STATUS_PAGE_PATH}/monitor-rules`,
    );
    await monitorRules.scrollIntoViewIfNeeded();
    await expect(monitorRules).toBeVisible();

    await screenshot(page, "phone-status-page-rules-open");

    await monitorRules.click();

    await expectPath(page, `${STATUS_PAGE_PATH}/monitor-rules`);
    await expect(menu).toBeHidden();
    await expect(toggle).toContainText("Rules / Monitor Rules");
  });

  test("an SLO: on Burn Rate Rules, the phone menu names Rules / Burn Rate Rules, and opens on Rules", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${SLO_PATH}/burn-rate-rules`);
    const toggle: Locator = page.getByTestId("mobile-sidemenu-toggle");

    await expect(toggle).toContainText("Rules / Burn Rate Rules");

    await toggle.click();

    const menu: Locator = phoneMenu(page);
    await expectOpen(menu, "Rules");
    await expectFolded(menu, "Configuration");
  });
});

test.describe("in German and in dark mode", () => {
  test("German: the section is Regeln, folded on the Overview by its English title, and holding Monitor-Regeln", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGE_PATH}?lang=de`);
    const menu: Locator = desktopMenu(page, "Hauptnavigation");

    expect(await sectionTitles(menu)).toContain("Regeln");
    await expectFolded(menu, "Regeln");

    await sectionToggle(menu, "Regeln").click();

    await expect(link(menu, `${STATUS_PAGE_PATH}/monitor-rules`)).toHaveText(
      "Monitor-Regeln",
    );

    await open(page, `${SLO_PATH}?lang=de`);

    await expectFolded(menu, "Regeln");
    await sectionToggle(menu, "Regeln").click();
    await expect((await sectionBody(menu, "Regeln")).locator("a")).toHaveText([
      "Monitor-Regeln",
      "Burn-Rate-Regeln",
    ]);
  });

  test("dark mode: the Rules section and its marked entry read against the menu", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGE_PATH}/monitor-rules?theme=dark`);
    const menu: Locator = desktopMenu(page);

    await expect(page.locator("html")).toHaveClass(DARK_MODE_CLASS);
    await expectOpen(menu, "Rules");

    // The heading's ink is not the menu's paper.
    const colours: { heading: string; paper: string } = await menu.evaluate(
      (aside: Element): { heading: string; paper: string } => {
        const heading: Element | undefined = Array.from(
          aside.querySelectorAll("h6"),
        ).find((candidate: Element): boolean => {
          return candidate.textContent?.trim() === "Rules";
        });
        const card: Element | null =
          aside.querySelector("div.sticky > div") || aside;

        return {
          heading: heading ? getComputedStyle(heading).color : "",
          paper: getComputedStyle(card).backgroundColor,
        };
      },
    );

    expect(colours.heading).not.toBe("");
    expect(colours.heading).not.toBe(colours.paper);

    await screenshot(page, "dark-status-page-monitor-rules");

    await open(page, `${SLO_PATH}/burn-rate-rules?theme=dark`);
    await expectOpen(menu, "Rules");

    await screenshot(page, "dark-slo-burn-rate-rules");
  });
});
