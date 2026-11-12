import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * Help, How OneUptime works and the Glossary at a tablet's width (#7037),
 * in a real browser with production's CSS and fonts.
 *
 * The header drew Help and Search only from 1024px, and the phone's menu
 * that carries them (#6816) only below 768px, so from 768 to 1023px - a
 * tablet held upright, a laptop's window beside another - neither could be
 * reached. The header now draws them from 768px; Ask AI and Upgrade stay for
 * 1024px (Ask AI is one of Search's actions).
 *
 * The fixture's ?header=true page (HeaderFixture.js) is the top of every
 * Dashboard page: the production header and nav bar, in a project named
 * "Acme Commerce Production", in English, German (the longest words) or
 * Arabic (right to left), light or dark. Each test opens it once and walks
 * the widths by resizing the window, as someone turning a tablet would.
 */

const PROJECT_PATH: string = "/dashboard/00000000-0000-4000-8000-000000000001";
const PROJECT_NAME: string = "Acme Commerce Production";
const TABLET_WIDTHS: Array<number> = [768, 900, 1023];
const HEIGHT: number = 800;
// The header's row: Common's Header is h-16.
const HEADER_HEIGHT_IN_PX: number = 64;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/navigation-search",
);
const LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Dashboard/src/Locales",
);

type Language = "en" | "de" | "ar";

interface HeaderWords {
  help: string;
  search: string;
  askAi: string;
  bell: string;
  profile: string;
  learn: Array<string>;
  glossary: string;
  howItWorks: string;
}

type LocaleTree = { [key: string]: string | LocaleTree };

function wordsOf(language: Language): HeaderWords {
  const locale: LocaleTree = JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as LocaleTree;
  const text: (key: string) => string = (key: string): string => {
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
    help: text("help.label"),
    search: text("header.search"),
    askAi: flat("Ask AI"),
    bell: flat("View notifications"),
    profile: text("userProfile.label"),
    learn: [
      text("help.quickstart"),
      text("help.howOneUptimeWorks"),
      text("help.glossary"),
      text("help.documentation"),
    ],
    glossary: text("help.glossary"),
    howItWorks: text("help.howOneUptimeWorks"),
  };
}

const pageErrors: Map<Page, Array<string>> = new Map();

// The header's widths are set here, on the desktop project.
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
  // Nothing the header reads leaves the page, and nothing throws.
  expect(pageErrors.get(page) || [], "errors on the page").toEqual([]);
});

async function open(
  page: Page,
  width: number,
  options: { lang?: Language; theme?: "dark" } = {},
): Promise<void> {
  await page.setViewportSize({ width: width, height: HEIGHT });
  const query: string = [
    "header=true",
    options.lang ? `lang=${options.lang}` : "",
    options.theme ? `theme=${options.theme}` : "",
  ]
    .filter(Boolean)
    .join("&");
  await page.goto(`${PROJECT_PATH}/home?${query}`);
  await expect(page.getByTestId("dashboard-top-section")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function resize(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width: width, height: HEIGHT });
  // The nav bar reads the window's width on resize.
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        return window.innerWidth;
      });
    })
    .toBe(width);
}

function button(page: Page, name: string): Locator {
  return page
    .getByTestId("dashboard-top-section")
    .getByRole("button", { name: name, exact: true });
}

// Search's button: its name, then its keycaps.
function searchButton(page: Page, words: HeaderWords): Locator {
  return page
    .getByTestId("dashboard-top-section")
    .getByRole("button", { name: words.search })
    .first();
}

function helpMenu(page: Page): Locator {
  return page.getByTestId("help-learn");
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `header-${name}.png`),
    clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 480 },
    animations: "disabled",
  });
}

/*
 * The header's entries, in the order they are drawn from the start of the
 * line: one row, inside the window, none over another.
 */
async function expectOneRowInsideTheWindow(
  page: Page,
  words: HeaderWords,
  isRightToLeft: boolean,
): Promise<Array<FrameBox>> {
  const width: number = page.viewportSize()!.width;
  const boxes: Array<FrameBox> = await boxesInOneFrame([
    page.getByTestId("header-logo"),
    page
      .getByTestId("dashboard-top-section")
      .getByRole("button", { name: PROJECT_NAME }),
    searchButton(page, words),
    button(page, words.bell),
    button(page, words.help),
    page
      .getByTestId("dashboard-top-section")
      .getByRole("button", { name: words.profile })
      .first(),
  ]);

  const ordered: Array<FrameBox> = isRightToLeft
    ? [...boxes].reverse()
    : [...boxes];

  for (let index: number = 0; index < ordered.length; index++) {
    const box: FrameBox = ordered[index]!;

    expect(box.x, `entry ${index} starts inside the window`).toBeGreaterThan(0);
    expect(box.x + box.width, `entry ${index} ends inside it`).toBeLessThan(
      width,
    );
    expect(box.y, `entry ${index} is on the header's row`).toBeGreaterThan(0);
    expect(
      box.y + box.height,
      `entry ${index} ends inside the header's row`,
    ).toBeLessThanOrEqual(HEADER_HEIGHT_IN_PX);

    if (index > 0) {
      const previous: FrameBox = ordered[index - 1]!;

      expect(
        box.x,
        `entry ${index} comes after entry ${index - 1}, not over it`,
      ).toBeGreaterThanOrEqual(previous.x + previous.width);
    }
  }

  await expectNoSidewaysScroll(page, { message: `at ${width}px` });

  return boxes;
}

test.describe("Help at a tablet's width", () => {
  test("from 768 to 1023px the header draws Help and Search, and Help opens How OneUptime works and the Glossary", async ({
    page,
  }: {
    page: Page;
  }) => {
    const words: HeaderWords = wordsOf("en");
    await open(page, TABLET_WIDTHS[0]!);

    for (const width of TABLET_WIDTHS) {
      await resize(page, width);

      await expect(button(page, words.help)).toBeVisible();
      await expect(searchButton(page, words)).toBeVisible();
      await expect(
        page.getByRole("button", { name: words.askAi }),
      ).toBeHidden();
      // No phone menu at this width: the header is where Help is.
      await expect(page.getByTestId("mobile-nav-toggle")).toHaveCount(0);
      await expectOneRowInsideTheWindow(page, words, false);

      await button(page, words.help).click();
      await expect(helpMenu(page).locator("a, button")).toHaveText(words.learn);
      const glossary: Locator = helpMenu(page).getByRole("link", {
        name: words.glossary,
      });
      await expect(glossary).toHaveAttribute("target", "_blank");
      expect(new URL((await glossary.getAttribute("href"))!).pathname).toBe(
        "/docs/en/introduction/glossary",
      );

      const menu: FrameBox = (
        await boxesInOneFrame([page.getByRole("menu")])
      )[0]!;
      expect(menu.x).toBeGreaterThanOrEqual(0);
      expect(menu.x + menu.width).toBeLessThanOrEqual(width);
      await screenshot(page, `help-${width}`);

      await helpMenu(page).getByText(words.howItWorks).click();
      await expect(
        page.getByTestId("how-oneuptime-works-dialog"),
      ).toBeVisible();
      await expect(helpMenu(page)).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("how-oneuptime-works-dialog")).toHaveCount(
        0,
      );
    }
  });

  test("at a tablet's width Search opens Search, and Help's and the profile's menus are each named by their own button and put away with Escape", async ({
    page,
  }: {
    page: Page;
  }) => {
    const words: HeaderWords = wordsOf("en");
    await open(page, 900);

    await searchButton(page, words).click();

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return (
            window as unknown as {
              __headerFixture: { paletteToggles: number };
            }
          ).__headerFixture.paletteToggles;
        });
      })
      .toBe(1);

    /*
     * Help and the profile button used to share one id, and every menu was
     * labelled by it: the profile menu read as Help's to a screen reader.
     */
    const ids: Array<string> = await page
      .locator("[id]")
      .evaluateAll((elements: Array<Element>): Array<string> => {
        return elements.map((element: Element): string => {
          return element.id;
        });
      });
    expect(new Set(ids).size, "no id twice on the page").toBe(ids.length);

    const profile: Locator = page
      .getByTestId("dashboard-top-section")
      .getByRole("button", { name: words.profile })
      .first();

    for (const [opener, name] of [
      [button(page, words.help), words.help],
      [profile, words.profile],
    ] as Array<[Locator, string]>) {
      // Opened with the keyboard: Enter on the button, Tab into the menu.
      await opener.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menu", { name: name })).toBeVisible();
      await expect(page.getByRole("menu")).toHaveCount(1);
      await expect(opener).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Tab");
      await expect(page.getByRole("menu").locator(":focus")).toHaveCount(1);

      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(opener).toHaveAttribute("aria-expanded", "false");
    }
  });

  test("at 1024px the desktop rail is as it was: Search, Ask AI, the bell, Help, the picture", async ({
    page,
  }: {
    page: Page;
  }) => {
    const words: HeaderWords = wordsOf("en");
    await open(page, 1024);

    const boxes: Array<FrameBox> = await boxesInOneFrame([
      searchButton(page, words),
      page.getByRole("button", { name: words.askAi }).first(),
      button(page, words.bell),
      button(page, words.help),
      page.getByRole("button", { name: words.profile }).first(),
    ]);

    for (let index: number = 1; index < boxes.length; index++) {
      expect(boxes[index]!.x).toBeGreaterThan(
        boxes[index - 1]!.x + boxes[index - 1]!.width,
      );
    }
    await expectOneRowInsideTheWindow(page, words, false);
  });

  test("at 767px the phone's menu carries Help, and the header leaves it out", async ({
    page,
  }: {
    page: Page;
  }) => {
    const words: HeaderWords = wordsOf("en");
    await open(page, 767);

    await expect(button(page, words.help)).toBeHidden();
    await expect(searchButton(page, words)).toBeHidden();

    await page.getByTestId("mobile-nav-toggle").click();
    await expect(page.getByTestId("navbar-mobile-search")).toBeVisible();
    await page
      .getByTestId("navbar-mobile-help")
      .getByRole("button", { name: words.help })
      .click();
    await expect(
      page.getByTestId("navbar-mobile-help-learn").locator("a, button"),
    ).toHaveText(words.learn);

    // Widened past 767, the phone's menu goes and the header's Help comes.
    await resize(page, 768);
    await expect(page.getByTestId("mobile-nav-toggle")).toHaveCount(0);
    await expect(button(page, words.help)).toBeVisible();
  });

  test("in German at 768px the header fits on one row with the project's name in sight, and Help's entries read in full", async ({
    page,
  }: {
    page: Page;
  }) => {
    const words: HeaderWords = wordsOf("de");
    expect(words.help).toBe("Hilfe");
    await open(page, 768, { lang: "de" });

    for (const width of TABLET_WIDTHS) {
      await resize(page, width);
      const boxes: Array<FrameBox> = await expectOneRowInsideTheWindow(
        page,
        words,
        false,
      );
      // The project picker gives way, but its name still reads.
      expect(boxes[1]!.width).toBeGreaterThanOrEqual(160);
    }

    await resize(page, 768);
    await button(page, words.help).click();
    await expect(helpMenu(page).locator("a, button")).toHaveText(words.learn);

    // "So funktioniert OneUptime" is wider than the menu's old 16rem.
    const cut: Array<string> = await page
      .getByRole("menu")
      .locator("span.truncate")
      .evaluateAll((titles: Array<Element>): Array<string> => {
        return titles
          .filter((title: Element): boolean => {
            return title.scrollWidth > title.clientWidth;
          })
          .map((title: Element): string => {
            return title.textContent || "";
          });
      });
    expect(cut).toEqual([]);
    await expect(
      helpMenu(page).getByRole("link", { name: words.glossary }),
    ).toHaveAttribute("href", /\/docs\/de\/introduction\/glossary$/);
    await screenshot(page, "help-de-768");
  });

  test("in Arabic the header reads right to left at 768 and 900px, and Help opens inside the window", async ({
    page,
  }: {
    page: Page;
  }) => {
    const words: HeaderWords = wordsOf("ar");
    await open(page, 768, { lang: "ar" });

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    for (const width of [768, 900]) {
      await resize(page, width);
      await expectOneRowInsideTheWindow(page, words, true);

      await button(page, words.help).click();
      await expect(helpMenu(page).locator("a, button")).toHaveText(words.learn);
      // A screen reader names the menu after its button, in Arabic.
      await expect(page.getByRole("menu", { name: words.help })).toBeVisible();
      const menu: FrameBox = (
        await boxesInOneFrame([page.getByRole("menu")])
      )[0]!;
      expect(menu.x).toBeGreaterThanOrEqual(0);
      expect(menu.x + menu.width).toBeLessThanOrEqual(width);
      await screenshot(page, `help-ar-${width}`);
      await button(page, words.help).click();
      await expect(helpMenu(page)).toHaveCount(0);
    }
  });

  test("in the dark at 900px, Help and its menu are drawn dark", async ({
    page,
  }: {
    page: Page;
  }) => {
    const words: HeaderWords = wordsOf("en");
    await open(page, 900, { theme: "dark" });

    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await button(page, words.help).click();

    const background: string = await page
      .getByRole("menu")
      .evaluate((menu: Element): string => {
        return getComputedStyle(menu).backgroundColor;
      });
    expect(background).not.toBe("rgb(255, 255, 255)");
    await screenshot(page, "help-dark-900");
  });
});
