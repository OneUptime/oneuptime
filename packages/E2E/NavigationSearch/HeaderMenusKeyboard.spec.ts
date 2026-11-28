import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { boxesInOneFrame } from "../SuiteHelpers/Frames";
import { expectNoAxeViolations } from "../SuiteHelpers/Axe";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * THE HEADER'S HELP AND PROFILE MENUS, WITH THE KEYBOARD, IN A REAL
 * BROWSER (#7237), AND THE TOP BAR'S NAME (#7963).
 *
 * Help and the profile menu are menus (role="menu"), and follow WAI-ARIA's
 * menu button pattern: Enter, Space or Down on the button opens the menu
 * with the focus on its first row (Up: its last), Up and Down walk the rows
 * and go round, Home and End go to the ends, Escape closes it back onto its
 * button, Tab leaves it for the next control. The theme's Light, Dark and
 * System are menu item radios, which Left and Right walk the way the row is
 * drawn: on an Arabic page Light is at the right, and Left goes on to Dark.
 * Up and Down never turn round.
 *
 * And the bar along the top is one landmark, named "Main menu" in the
 * reader's language, at a laptop's width and on a phone with its menu open:
 * it had no name, and on a phone it was two landmarks.
 *
 * axe's rules hold the bar, and Help and the profile menu open, light and
 * dark, at both widths: a phone's bar with its menu open, and no Help
 * (SuiteHelpers/Axe, #10297).
 *
 * The fixture's ?header=true page (HeaderFixture.js) is the production
 * header and nav bar, in English or Arabic, light or dark. The widths are
 * set here, on the desktop project, as HeaderAtTabletWidths sets them.
 */

const PROJECT_PATH: string = "/dashboard/00000000-0000-4000-8000-000000000001";
const HEIGHT: number = 800;
const LAPTOP: number = 1280;
const PHONE: number = 390;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/navigation-search",
);
const LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Dashboard/src/Locales",
);

type Language = "en" | "ar";
type Theme = "light" | "dark";

interface MenuWords {
  help: string;
  profile: string;
  learn: Array<string>;
  profileRow: string;
  signOut: string;
  theme: string;
  light: string;
  dark: string;
  system: string;
  mainMenu: string;
}

type LocaleTree = { [key: string]: string | LocaleTree };

function wordsOf(language: Language): MenuWords {
  const locale: LocaleTree = JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as LocaleTree;
  const nested: (key: string) => string = (key: string): string => {
    let node: string | LocaleTree = locale;

    for (const segment of key.split(".")) {
      node = (node as LocaleTree)[segment] as string | LocaleTree;
    }

    expect(typeof node, `${language} ${key}`).toBe("string");
    return node as string;
  };
  const flat: (key: string) => string = (key: string): string => {
    expect(typeof locale[key], `${language} "${key}"`).toBe("string");
    return locale[key] as string;
  };

  return {
    help: nested("help.label"),
    profile: nested("userProfile.label"),
    learn: [
      nested("help.quickstart"),
      nested("help.howOneUptimeWorks"),
      nested("help.glossary"),
      nested("help.documentation"),
    ],
    profileRow: nested("userProfile.profile"),
    signOut: nested("userProfile.signOut"),
    theme: flat("Theme"),
    light: flat("Light"),
    dark: flat("Dark"),
    system: flat("System"),
    mainMenu: flat("Main menu"),
  };
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.skip(({ isMobile }: { isMobile: boolean }): boolean => {
  return isMobile;
});

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });
  page.on("console", (message: { type: () => string; text: () => string }) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "errors on the page").toEqual([]);
});

async function open(
  page: Page,
  width: number,
  options: { lang?: Language; theme?: Theme } = {},
): Promise<void> {
  await page.setViewportSize({ width: width, height: HEIGHT });
  const query: string = [
    "header=true",
    options.lang && options.lang !== "en" ? `lang=${options.lang}` : "",
    options.theme === "dark" ? "theme=dark" : "",
  ]
    .filter(Boolean)
    .join("&");
  await page.goto(`${PROJECT_PATH}/home?${query}`);
  await expect(page.getByTestId("dashboard-top-section")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

function headerButton(page: Page, name: string): Locator {
  return page
    .getByTestId("dashboard-top-section")
    .getByRole("button", { name: name, exact: true })
    .first();
}

/*
 * The profile button, named by its picture and its words: "User Profile"
 * is in its name, not all of it.
 */
function profileButton(page: Page, words: MenuWords): Locator {
  return page
    .getByTestId("dashboard-top-section")
    .getByRole("button", { name: words.profile })
    .first();
}

function menu(page: Page, name: string): Locator {
  return page.getByRole("menu", { name: name, exact: true });
}

// The accessible name of what has the focus: its label, else its words.
async function focusedName(page: Page): Promise<string> {
  return page.evaluate((): string => {
    const focused: Element | null = document.activeElement;

    return (
      focused?.getAttribute("aria-label") ||
      focused?.textContent ||
      ""
    ).trim();
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `header-menus-${name}.png`),
    clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 520 },
    animations: "disabled",
  });
}

// The open menu is inside the window, whichever side it opens from.
async function expectInsideTheWindow(page: Page, open: Locator): Promise<void> {
  const box: { x: number; width: number } | null = await open.boundingBox();
  const width: number = page.viewportSize()!.width;

  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
  await expectNoSidewaysScroll(page);
}

for (const theme of ["light", "dark"] as Array<Theme>) {
  test(`at ${LAPTOP}px (${theme}) Help opens from the keyboard on its first row, and the arrows, Home and End walk it`, async ({
    page,
  }: {
    page: Page;
  }) => {
    const words: MenuWords = wordsOf("en");
    await open(page, LAPTOP, { theme: theme });

    const help: Locator = headerButton(page, words.help);

    await expect(help).toHaveAttribute("aria-haspopup", "menu");
    await help.focus();
    await page.keyboard.press("Enter");

    const helpMenu: Locator = menu(page, words.help);

    await expect(helpMenu).toBeVisible();
    await expect(help).toHaveAttribute(
      "aria-controls",
      (await helpMenu.getAttribute("id"))!,
    );
    // Every row is a menu item, and the focus is on the first.
    await expect(
      helpMenu.getByRole("menuitem").filter({ hasText: words.learn[0]! }),
    ).toBeFocused();
    expect(await focusedName(page)).toBe(words.learn[0]);

    await page.keyboard.press("ArrowDown");
    expect(await focusedName(page)).toBe(words.learn[1]);
    await page.keyboard.press("End");
    const last: string = await focusedName(page);
    expect(last).not.toBe(words.learn[1]);
    await page.keyboard.press("ArrowDown");
    // Round from the last row to the first.
    expect(await focusedName(page)).toBe(words.learn[0]);
    await page.keyboard.press("ArrowUp");
    expect(await focusedName(page)).toBe(last);
    await page.keyboard.press("Home");
    expect(await focusedName(page)).toBe(words.learn[0]);

    await expectInsideTheWindow(page, helpMenu);
    await screenshot(page, `help-keyboard-${LAPTOP}-${theme}`);

    await page.keyboard.press("Escape");
    await expect(helpMenu).toHaveCount(0);
    await expect(help).toBeFocused();
    await expect(help).toHaveAttribute("aria-expanded", "false");

    // Up on the button opens it on its last row.
    await page.keyboard.press("ArrowUp");
    await expect(helpMenu).toBeVisible();
    expect(await focusedName(page)).toBe(last);
  });
}

test(`at ${LAPTOP}px Tab leaves an open menu for the next control, and the menu closes`, async ({
  page,
}: {
  page: Page;
}) => {
  const words: MenuWords = wordsOf("en");
  await open(page, LAPTOP);

  const help: Locator = headerButton(page, words.help);
  const profile: Locator = profileButton(page, words);

  await help.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");

  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(profile).toBeFocused();

  // Shift+Tab leaves it backwards: the focus is out of the closed menu.
  await help.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Tab");

  await expect(page.getByRole("menu")).toHaveCount(0);
  const isBeforeOrOnHelp: boolean = await help.evaluate(
    (button: Element): boolean => {
      const focused: Element | null = document.activeElement;

      return Boolean(
        focused &&
          (focused === button ||
            focused.compareDocumentPosition(button) &
              Node.DOCUMENT_POSITION_FOLLOWING),
      );
    },
  );
  expect(isBeforeOrOnHelp).toBe(true);
});

test(`at ${LAPTOP}px Enter on a page's row opens it in a new tab, and the focus is back on Help`, async ({
  page,
}: {
  page: Page;
}) => {
  const words: MenuWords = wordsOf("en");
  await open(page, LAPTOP);

  const help: Locator = headerButton(page, words.help);

  await help.focus();
  await page.keyboard.press("Enter");

  const quickstart: Locator = menu(page, words.help).getByRole("menuitem", {
    name: words.learn[0]!,
  });

  // A page's row is still a link to its page, in a new tab.
  await expect(quickstart).toHaveAttribute("target", "_blank");
  expect(new URL((await quickstart.getAttribute("href"))!).pathname).toBe(
    "/docs/en/introduction/quickstart",
  );
  await expect(quickstart).toBeFocused();

  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.keyboard.press("Enter"),
  ]);

  await popup.close();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(help).toBeFocused();
});

for (const theme of ["light", "dark"] as Array<Theme>) {
  test(`at ${PHONE}px (${theme}) the profile menu walks Profile, the theme's choices and Sign Out, and Enter picks a theme`, async ({
    page,
  }: {
    page: Page;
  }) => {
    const words: MenuWords = wordsOf("en");
    await open(page, PHONE, { theme: theme });

    const profile: Locator = profileButton(page, words);

    await profile.focus();
    await page.keyboard.press("ArrowDown");

    const profileMenu: Locator = menu(page, words.profile);

    await expect(profileMenu).toBeVisible();
    expect(await focusedName(page)).toBe(words.profileRow);

    const walked: Array<string> = [];

    for (let step: number = 0; step < 4; step++) {
      await page.keyboard.press("ArrowDown");
      walked.push(await focusedName(page));
    }

    expect(walked).toEqual([
      words.light,
      words.dark,
      words.system,
      words.signOut,
    ]);

    await expect(
      profileMenu.getByRole("group", { name: words.theme }),
    ).toBeVisible();
    await expectInsideTheWindow(page, profileMenu);
    await screenshot(page, `profile-keyboard-${PHONE}-${theme}`);

    // Back to Light, Right to Dark, Enter: the page turns dark, the menu stays.
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    expect(await focusedName(page)).toBe(words.light);
    await page.keyboard.press("ArrowRight");
    expect(await focusedName(page)).toBe(words.dark);
    await page.keyboard.press("Enter");

    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(
      profileMenu.getByRole("menuitemradio", { name: words.dark }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(profileMenu).toBeVisible();
    expect(await focusedName(page)).toBe(words.dark);

    // Light again with Space, so the next test starts where it should.
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press(" ");
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);

    await page.keyboard.press("Escape");
    await expect(profileMenu).toHaveCount(0);
    await expect(profile).toBeFocused();
  });
}

for (const width of [LAPTOP, PHONE]) {
  test(`in Arabic at ${width}px Up and Down keep their way, Left goes on along the theme, and the menu opens inside the window`, async ({
    page,
  }: {
    page: Page;
  }) => {
    const words: MenuWords = wordsOf("ar");
    await open(page, width, { lang: "ar" });

    expect(await page.locator("html").getAttribute("dir")).toBe("rtl");

    const profile: Locator = profileButton(page, words);

    await profile.focus();
    await page.keyboard.press("Enter");

    const profileMenu: Locator = menu(page, words.profile);

    await expect(profileMenu).toBeVisible();
    expect(await focusedName(page)).toBe(words.profileRow);

    // Down still goes down, to the theme's first choice.
    await page.keyboard.press("ArrowDown");
    expect(await focusedName(page)).toBe(words.light);

    // Drawn from the right: Light is right of Dark, and Left goes on to it.
    const [lightBox, darkBox] = await boxesInOneFrame([
      profileMenu.getByRole("menuitemradio", { name: words.light }),
      profileMenu.getByRole("menuitemradio", { name: words.dark }),
    ]);

    expect(lightBox!.x).toBeGreaterThan(darkBox!.x);

    await page.keyboard.press("ArrowLeft");
    expect(await focusedName(page)).toBe(words.dark);
    await page.keyboard.press("ArrowRight");
    expect(await focusedName(page)).toBe(words.light);
    await page.keyboard.press("ArrowUp");
    expect(await focusedName(page)).toBe(words.profileRow);

    await expectInsideTheWindow(page, profileMenu);
    await screenshot(page, `profile-keyboard-${width}-ar`);

    await page.keyboard.press("Escape");
    await expect(profile).toBeFocused();
  });
}

for (const language of ["en", "ar"] as Array<Language>) {
  test(`the top bar is one landmark named for the main menu (${language}), at ${LAPTOP}px and on a ${PHONE}px phone with its menu open`, async ({
    page,
  }: {
    page: Page;
  }) => {
    const words: MenuWords = wordsOf(language);
    await open(page, LAPTOP, { lang: language });

    const top: Locator = page.getByTestId("dashboard-top-section");

    await expect(
      top.getByRole("navigation", { name: words.mainMenu, exact: true }),
    ).toHaveCount(1);
    // No landmark in the top without a name.
    expect(
      await top
        .getByRole("navigation")
        .evaluateAll((landmarks: Array<Element>): Array<string> => {
          return landmarks.map((landmark: Element): string => {
            return landmark.getAttribute("aria-label") || "";
          });
        }),
    ).toEqual([words.mainMenu]);

    await open(page, PHONE, { lang: language });
    await page.getByTestId("mobile-nav-toggle").click();
    await expect(page.getByTestId("mobile-nav-menu")).toBeVisible();

    expect(
      await page
        .getByTestId("dashboard-top-section")
        .getByRole("navigation")
        .evaluateAll((landmarks: Array<Element>): Array<string> => {
          return landmarks.map((landmark: Element): string => {
            return landmark.getAttribute("aria-label") || "";
          });
        }),
    ).toEqual([words.mainMenu]);
    await expectNoSidewaysScroll(page);
  });
}

for (const width of [LAPTOP, PHONE]) {
  for (const theme of ["light", "dark"] as Array<Theme>) {
    test(`at ${width}px (${theme}) axe finds no broken rule in the top bar, Help or the profile menu`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const words: MenuWords = wordsOf("en");
      await open(page, width, { theme: theme });

      if (width === PHONE) {
        await page.getByTestId("mobile-nav-toggle").click();
        await expect(page.getByTestId("mobile-nav-menu")).toBeVisible();
      }

      await expectNoAxeViolations(page, {
        include: ['[data-testid="dashboard-top-section"]'],
        message: `the top bar at ${width}px (${theme})`,
      });

      if (width === PHONE) {
        await page.getByTestId("mobile-nav-toggle").click();
        await expect(page.getByTestId("mobile-nav-menu")).toBeHidden();
      }

      // A phone's bar draws no Help button.
      const menus: Array<[Locator, string]> = [
        [profileButton(page, words), words.profile],
      ];

      if (width === LAPTOP) {
        menus.unshift([headerButton(page, words.help), words.help]);
      }

      for (const [button, name] of menus) {
        await button.click();
        await expect(menu(page, name)).toBeVisible();
        await expectNoAxeViolations(page, {
          include: ['[role="menu"]'],
          message: `${name}'s menu at ${width}px (${theme})`,
        });
        await page.keyboard.press("Escape");
        await expect(menu(page, name)).toHaveCount(0);
      }
    });
  }
}
