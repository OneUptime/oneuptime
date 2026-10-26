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
 * The shared side menu, in a browser, around the real status page and SLO
 * view layouts (RulesMenuSection/Fixture), for the navigation follow-ups:
 *
 *  - the lit entry says it is the current page (aria-current), as the
 *    trail's last crumb does, where it used to be shown by colour only
 *    (#5037's line);
 *  - long translated titles and section headings are drawn whole, on a
 *    second line when they need one, instead of ending in an ellipsis:
 *    French "Règles de taux de consommation" (Burn Rate Rules), German
 *    "Benachrichtigungsprotokolle" (Notification Logs) (#5081, #5098);
 *  - the phone's menu button names the section and the page whole, and is
 *    named by the words it shows;
 *  - a menu taller than the window opens with the lit entry in sight
 *    inside it, the next entry peeking past it, without scrolling the page
 *    (#5250's line); an edge of the list with entries behind it fades out,
 *    so a reader sees the list goes on.
 *
 * jsdom lays nothing out, so the jest suites (SideMenuItem,
 * SideMenuCurrentEntry, SideMenuScroll in packages/Common) can only pin the
 * classes and the arithmetic; here the boxes are measured.
 */

const PORT: string = process.env["RULES_MENU_SECTION_FIXTURE_PORT"] || "4385";
const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000f1";
const STATUS_PAGE_ID: string = "20000000-0000-4000-8000-0000000000f2";
const SLO_ID: string = "30000000-0000-4000-8000-0000000000f3";

const STATUS_PAGE_PATH: string = `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}`;
const SLO_PATH: string = `/dashboard/${PROJECT_ID}/slos/${SLO_ID}`;
const BURN_RATE_RULES_PATH: string = `${SLO_PATH}/burn-rate-rules`;

// The test id SideMenuItem gives a row's title (its words, not its badge).
const ENTRY_TITLE: string = '[data-testid="side-menu-item-title"]';

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
    fullPage: false,
    animations: "disabled",
  });
}

// A page of the fixture, once the layout has drawn the record's name.
async function open(page: Page, address: string): Promise<void> {
  await page.goto(address);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    address.includes("/slos/") ? "Checkout availability" : "Acme Public Status",
    { timeout: 60000 },
  );
  // The Dashboard's font: titles are measured as they are drawn.
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
}

// The desktop menu, whatever the reader's language calls it.
function desktopMenu(page: Page): Locator {
  return page.locator("aside[role='navigation']");
}

// The list inside the desktop menu that scrolls when the menu is tall.
function desktopList(page: Page): Locator {
  return desktopMenu(page).locator("nav");
}

function entry(menu: Locator, href: string): Locator {
  return menu.locator(`a[href='${href}']`);
}

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
  height: number;
}

async function boxOf(target: Locator): Promise<Box> {
  return await target.evaluate((element: Element): Box => {
    const rect: DOMRect = element.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      height: rect.height,
    };
  });
}

/*
 * Whether an entry is in sight: inside its list's box, and inside the
 * window - the menu's card runs on below the window on a page not yet
 * scrolled.
 */
async function isInSight(
  page: Page,
  list: Locator,
  target: Locator,
): Promise<boolean> {
  const listBox: Box = await boxOf(list);
  const targetBox: Box = await boxOf(target);
  const windowHeight: number = await page.evaluate((): number => {
    return window.innerHeight;
  });

  return (
    targetBox.top >= Math.max(listBox.top, 0) &&
    targetBox.bottom <= Math.min(listBox.bottom, windowHeight)
  );
}

/*
 * Which edges of a list fade out because they hide entries: what the list
 * says (data-hidden-top / -bottom) and whether a mask is drawn at all.
 */
interface ListFades {
  top: string | null;
  bottom: string | null;
  isMasked: boolean;
}

async function fadesOf(list: Locator): Promise<ListFades> {
  return await list.evaluate((element: Element): ListFades => {
    const style: CSSStyleDeclaration = getComputedStyle(element);
    const mask: string =
      style.maskImage ||
      (style as unknown as { webkitMaskImage?: string }).webkitMaskImage ||
      "none";

    return {
      top: element.getAttribute("data-hidden-top"),
      bottom: element.getAttribute("data-hidden-bottom"),
      isMasked: mask !== "none" && mask.includes("gradient"),
    };
  });
}

/*
 * Every title and section heading the menu draws in sight that is cut
 * short: its text wider than its box, or ending in an ellipsis.
 */
async function cutShortInMenu(menu: Locator): Promise<Array<string>> {
  return await menu.evaluate((root: Element): Array<string> => {
    const cut: Array<string> = [];

    root
      .querySelectorAll('[data-testid="side-menu-item-title"], h6')
      .forEach((element: Element): void => {
        const style: CSSStyleDeclaration = getComputedStyle(element);

        if (
          style.visibility !== "visible" ||
          element.getBoundingClientRect().height === 0
        ) {
          return;
        }

        if (
          element.scrollWidth > element.clientWidth + 1 ||
          style.textOverflow === "ellipsis"
        ) {
          cut.push(
            `${element.textContent || ""}: ${element.scrollWidth}px in ${element.clientWidth}px`,
          );
        }
      });

    return cut;
  });
}

test.describe("which entry is the page you are on", () => {
  test("the lit entry says so to a screen reader, and is the only one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, BURN_RATE_RULES_PATH);
    const menu: Locator = desktopMenu(page);
    const current: Locator = menu.locator("[aria-current]");

    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(current).toHaveAttribute("href", BURN_RATE_RULES_PATH);
    await expect(current.locator(ENTRY_TITLE)).toHaveText("Burn Rate Rules");
    // The colour says the same: the lit row is that entry.
    await expect(menu.locator("a.bg-indigo-50")).toHaveCount(1);
    await expect(menu.locator("a.bg-indigo-50")).toHaveAttribute(
      "href",
      BURN_RATE_RULES_PATH,
    );

    // The trail's last crumb is the page too: text, not a link to itself.
    const crumb: Locator = page
      .getByRole("navigation", { name: "Breadcrumb" })
      .locator("[aria-current='page']");
    await expect(crumb).toHaveCount(1);
    await expect(crumb).toHaveText("Burn Rate Rules");
    expect(
      await crumb.evaluate((element: Element): string => {
        return element.tagName;
      }),
    ).toBe("SPAN");
  });

  test("moving to another page moves the mark: one current entry, on the new page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, BURN_RATE_RULES_PATH);
    const menu: Locator = desktopMenu(page);

    await entry(menu, `${SLO_PATH}/monitor-rules`).click();

    await expect(menu.locator("[aria-current]")).toHaveCount(1);
    await expect(menu.locator("[aria-current]")).toHaveAttribute(
      "href",
      `${SLO_PATH}/monitor-rules`,
    );
    await expect(entry(menu, BURN_RATE_RULES_PATH)).not.toHaveAttribute(
      "aria-current",
    );
  });
});

test.describe("long titles are drawn whole", () => {
  test("French: Règles de taux de consommation takes two lines inside the menu, its icon and rail on them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${BURN_RATE_RULES_PATH}?lang=fr`);
    const menu: Locator = desktopMenu(page);
    const row: Locator = entry(menu, BURN_RATE_RULES_PATH);
    const title: Locator = row.locator(ENTRY_TITLE);

    await expect(title).toHaveText("Règles de taux de consommation");

    const layout: {
      scrollWidth: number;
      clientWidth: number;
      lineHeight: number;
      textOverflow: string;
    } = await title.evaluate(
      (
        element: Element,
      ): {
        scrollWidth: number;
        clientWidth: number;
        lineHeight: number;
        textOverflow: string;
      } => {
        const style: CSSStyleDeclaration = getComputedStyle(element);
        return {
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          lineHeight: parseFloat(style.lineHeight),
          textOverflow: style.textOverflow,
        };
      },
    );
    const titleBox: Box = await boxOf(title);
    const menuBox: Box = await boxOf(menu);
    const iconBox: Box = await boxOf(row.locator("svg").first());
    const railBox: Box = await boxOf(row.locator("div.absolute").first());

    expect(layout.textOverflow).not.toBe("ellipsis");
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    // Two lines, not one cut short.
    expect(titleBox.height).toBeGreaterThanOrEqual(2 * layout.lineHeight - 1);
    expect(titleBox.right).toBeLessThanOrEqual(menuBox.right);
    // The icon sits on the first line.
    expect(iconBox.top).toBeGreaterThanOrEqual(titleBox.top - 1);
    expect(iconBox.bottom).toBeLessThanOrEqual(
      titleBox.top + layout.lineHeight + 1,
    );
    // The lit row's rail runs down both lines.
    expect(railBox.height).toBeGreaterThan(layout.lineHeight);

    await screenshot(page, "french-burn-rate-rules-two-lines");
  });

  test("German: the Notification Logs heading, Benachrichtigungsprotokolle, is drawn whole inside its button", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGE_PATH}/notification-logs?lang=de`);
    const menu: Locator = desktopMenu(page);
    const heading: Locator = menu.locator("h6", {
      hasText: "Benachrichtigungsprotokolle",
    });
    const button: Locator = heading.locator("xpath=ancestor::button[1]");

    await expect(heading).toHaveCount(1);
    await expect(button).toHaveAttribute("aria-expanded", "true");

    /*
     * Too long for one line: it is hyphenated in German rather than cut
     * where the line ends. The Dashboard's page says lang="en" whatever the
     * reader's language, so the heading and the entry under it say they
     * are German themselves.
     */
    await page.evaluate((): void => {
      document.documentElement.lang = "en";
    });
    const lit: Locator = entry(menu, `${STATUS_PAGE_PATH}/notification-logs`);
    for (const words of [heading, lit.locator(ENTRY_TITLE)]) {
      await expect(words).toHaveAttribute("lang", "de");
      expect(
        await words.evaluate((element: Element): string => {
          return getComputedStyle(element).hyphens;
        }),
      ).toBe("auto");
    }

    const headingBox: Box = await boxOf(heading);
    const buttonBox: Box = await boxOf(button);
    const chevronBox: Box = await boxOf(button.locator("svg").last());

    expect(
      await heading.evaluate((element: Element): boolean => {
        return element.scrollWidth <= element.clientWidth + 1;
      }),
    ).toBe(true);
    expect(headingBox.right).toBeLessThanOrEqual(chevronBox.left);
    expect(chevronBox.right).toBeLessThanOrEqual(buttonBox.right);
    // The chevron stays level with the heading's first line.
    expect(chevronBox.top).toBeLessThan(headingBox.top + 16);

    await screenshot(page, "german-notification-logs-heading");

    // English words carry no language of their own: they are the page's.
    await open(page, `${STATUS_PAGE_PATH}/notification-logs`);
    expect(await desktopMenu(page).locator("[lang]").count()).toBe(0);
  });

  for (const lang of ["en", "de", "fr", "fa"]) {
    test(`${lang}: no title or heading in sight is cut short, in either menu, beside a page at 1280, 1024 and 768 pixels`, async ({
      page,
    }: {
      page: Page;
    }) => {
      for (const address of [
        `${STATUS_PAGE_PATH}/notification-logs`,
        `${STATUS_PAGE_PATH}/settings`,
        BURN_RATE_RULES_PATH,
      ]) {
        await page.setViewportSize({ width: 1280, height: 1100 });
        await open(page, `${address}?lang=${lang}`);

        for (const width of [1280, 1024, 768]) {
          await page.setViewportSize({ width, height: 1100 });
          // The menu narrows from 256 to 224 pixels below 1024.
          await page.waitForTimeout(100);

          expect({
            address,
            width,
            cut: await cutShortInMenu(desktopMenu(page)),
          }).toEqual({ address, width, cut: [] });
        }
      }
    });
  }
});

test.describe("the lit entry is in sight in a menu taller than the window", () => {
  test.use({ viewport: { width: 1280, height: 560 } });

  test("a page low in the menu opens with its entry in sight inside the menu, and the page itself unscrolled", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGE_PATH}/delete`);
    const list: Locator = desktopList(page);
    const lit: Locator = entry(desktopMenu(page), `${STATUS_PAGE_PATH}/delete`);

    await expect(lit).toHaveAttribute("aria-current", "page");

    // The menu is taller than the window: its list scrolls inside it.
    expect(
      await list.evaluate((element: Element): boolean => {
        return element.scrollHeight > element.clientHeight;
      }),
    ).toBe(true);

    await expect
      .poll(() => {
        return isInSight(page, list, lit);
      })
      .toBe(true);
    expect(
      await list.evaluate((element: Element): number => {
        return element.scrollTop;
      }),
    ).toBeGreaterThan(0);
    // Only the menu's list moved.
    expect(
      await page.evaluate((): number => {
        return window.scrollY;
      }),
    ).toBe(0);

    /*
     * The entries above, scrolled out of sight, are faded in at the top
     * edge; nothing is below the last entry, so the foot stays sharp.
     */
    await expect
      .poll(() => {
        return fadesOf(list);
      })
      .toEqual({ top: "true", bottom: "false", isMasked: true });

    await screenshot(page, "short-window-delete-in-sight");
  });

  /*
   * Brought in flush against the list's foot, the lit entry read as the
   * menu's last: nothing past it in view, nothing to say the list went on.
   * It comes in with the next entry in sight past it, and both edges of
   * the list fade out over the entries they hide.
   */
  test("a page in the middle of a long menu opens with the next entry in sight past its own, and both edges fading", async ({
    page,
  }: {
    page: Page;
  }) => {
    const address: string = `${STATUS_PAGE_PATH}/microsoft-teams-subscribers`;
    await open(page, address);
    const menu: Locator = desktopMenu(page);
    const list: Locator = desktopList(page);
    const lit: Locator = entry(menu, address);
    const next: Locator = entry(
      menu,
      `${STATUS_PAGE_PATH}/webhook-subscribers`,
    );

    await expect(lit).toHaveAttribute("aria-current", "page");
    await expect
      .poll(() => {
        return isInSight(page, list, lit);
      })
      .toBe(true);
    expect(await isInSight(page, list, next)).toBe(true);

    // Clear of the foot's 1.5rem fade, with a row's room to spare.
    const listBox: Box = await boxOf(list);
    const litBox: Box = await boxOf(lit);
    expect(litBox.bottom).toBeLessThanOrEqual(listBox.bottom - 24);

    await expect
      .poll(() => {
        return fadesOf(list);
      })
      .toEqual({ top: "true", bottom: "true", isMasked: true });

    // Scrolled back to its top, the list fades out only at its foot.
    await list.evaluate((element: Element): void => {
      element.scrollTop = 0;
    });
    await expect
      .poll(() => {
        return fadesOf(list);
      })
      .toEqual({ top: "false", bottom: "true", isMasked: true });

    await screenshot(page, "short-window-teams-next-entry-in-sight");
  });

  test("a menu that fits the window does not fade at all", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 1100 });
    await open(page, BURN_RATE_RULES_PATH);

    await expect
      .poll(() => {
        return fadesOf(desktopList(page));
      })
      .toEqual({ top: "false", bottom: "false", isMasked: false });
  });

  /*
   * The card is as tall as the window under the app's header once it sticks
   * there; on a page not yet scrolled it starts under the trail and the
   * title, and used to run on below the window, the end of its list out of
   * reach of its own scroll. It now ends above the window's bottom edge, and
   * grows into the room the page gives it as the page scrolls.
   */
  test("the menu's card ends above the window's bottom, and grows as the page scrolls", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, STATUS_PAGE_PATH);
    const card: Locator = desktopMenu(page).locator("div.sticky > div");
    const windowHeight: number = 560;

    const before: Box = await boxOf(card);
    expect(before.bottom).toBeLessThanOrEqual(windowHeight - 24 + 1);
    expect(before.bottom).toBeGreaterThan(windowHeight - 24 - 2);

    // A page long enough to scroll, as most are: the content beside the menu.
    await page.evaluate((): void => {
      const filler: HTMLDivElement = document.createElement("div");
      filler.style.height = "2000px";
      document
        .querySelector("[data-testid='fixture-page']")!
        .parentElement!.appendChild(filler);
    });
    await page.mouse.wheel(0, 400);
    await expect
      .poll(async (): Promise<number> => {
        return Math.round((await boxOf(card)).top);
      })
      .toBe(24);

    const after: Box = await boxOf(card);
    expect(after.height).toBeGreaterThan(before.height);
    expect(after.bottom).toBeLessThanOrEqual(windowHeight - 24 + 1);
  });

  test("a page at the top of the menu leaves the list where it starts", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, STATUS_PAGE_PATH);

    // Two frames after the page opened, nothing has moved.
    await page.waitForTimeout(200);
    expect(
      await desktopList(page).evaluate((element: Element): number => {
        return element.scrollTop;
      }),
    ).toBe(0);
  });

  test("following a link in the page to a page low in the menu brings its entry into sight", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, STATUS_PAGE_PATH);
    const list: Locator = desktopList(page);

    // The app moves to another page without the menu being clicked.
    await page.evaluate((address: string): void => {
      window.history.pushState({}, "", address);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, `${STATUS_PAGE_PATH}/audit-logs`);

    const lit: Locator = entry(
      desktopMenu(page),
      `${STATUS_PAGE_PATH}/audit-logs`,
    );
    await expect(lit).toHaveAttribute("aria-current", "page");
    await expect
      .poll(() => {
        return isInSight(page, list, lit);
      })
      .toBe(true);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the menu's button names the section and the page whole, on two lines, by the words it shows", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGE_PATH}/microsoft-teams-subscribers?lang=de`);
    const toggle: Locator = page.getByTestId("mobile-sidemenu-toggle");
    const summary: Locator = toggle.locator("h3");

    await expect(summary).toHaveText("Abonnenten / Microsoft Teams-Abonnenten");
    // Named by its words, not a label of its own.
    expect(await toggle.getAttribute("aria-label")).toBeNull();
    await expect(
      page.getByRole("button", {
        name: "Navigieren zu Abonnenten / Microsoft Teams-Abonnenten",
      }),
    ).toBeVisible();

    const layout: { cut: boolean; lines: number } = await summary.evaluate(
      (element: Element): { cut: boolean; lines: number } => {
        const lineHeight: number = parseFloat(
          getComputedStyle(element).lineHeight,
        );
        return {
          cut: element.scrollWidth > element.clientWidth + 1,
          lines: Math.round(
            element.getBoundingClientRect().height / lineHeight,
          ),
        };
      },
    );

    expect(layout.cut).toBe(false);
    expect(layout.lines).toBe(2);
    // Each part keeps together: the page's name starts the second line.
    const pageName: Box = await boxOf(summary.locator("span").last());
    const sectionName: Box = await boxOf(summary.locator("span").first());
    expect(pageName.top).toBeGreaterThan(sectionName.top);

    await screenshot(page, "phone-german-summary-two-lines");
  });

  test("opening the menu brings the lit entry into sight in its list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 640 });
    await open(page, `${STATUS_PAGE_PATH}/delete`);
    const toggle: Locator = page.getByTestId("mobile-sidemenu-toggle");

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const panelId: string | null = await toggle.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const panel: Locator = page.locator(`[id="${panelId}"]`);
    const list: Locator = panel.locator("nav");
    const lit: Locator = entry(panel, `${STATUS_PAGE_PATH}/delete`);

    await expect(lit).toHaveAttribute("aria-current", "page");
    await expect
      .poll(() => {
        return isInSight(page, list, lit);
      })
      .toBe(true);

    // The phone's list fades out over the entries scrolled above it too.
    await expect
      .poll(() => {
        return fadesOf(list);
      })
      .toEqual({ top: "true", bottom: "false", isMasked: true });

    await screenshot(page, "phone-menu-delete-in-sight");
  });
});
