import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * SEARCH AND HELP, IN A REAL BROWSER (#7038): the phone menu and Search
 * (Cmd/Ctrl+K) at a phone's 390px and a laptop's 1280px, light and dark, in
 * German (the longest words) and Persian (right to left).
 *
 * They were checked by jsdom suites only (DashboardPhoneMenuSearchAndHelp,
 * DashboardCommandPaletteFindsMore, CommandPaletteFallback, and the
 * suites of the lists' create forms and the project's people). Here the
 * fixture's ?header=true&palette=true page draws the production header and
 * nav bar with the Dashboard's Search mounted beside them, as App.tsx mounts
 * it (HeaderFixture.js), with production's CSS, fonts and themes:
 *
 *   - a phone's menu has Search at the top, which opens Search, and Help
 *     folded at the bottom, which opens How OneUptime works; a laptop's
 *     header has Help, and Cmd/Ctrl+K opens Search;
 *   - Search finds a Glossary term by its name in the reader's language and
 *     opens it on the Glossary page in a new tab, and offers Ask AI a
 *     question nothing answers;
 *   - Search offers a Project Admin Create Status Page, which opens its list
 *     with ?create=1 (#7035), and finds a teammate by name, under Users,
 *     with their email, opening their page (#7036) - and offers someone who
 *     reads services alone neither, nor asks for the people.
 *
 * Every panel and menu stays inside the window, nothing scrolls sideways,
 * the Persian page reads right to left, and the dark theme draws Search
 * dark. Screenshots are written to output/playwright/navigation-search.
 */

const PROJECT_PATH: string = "/dashboard/00000000-0000-4000-8000-000000000001";
const HEIGHT: number = 860;
const PHONE: number = 390;
const LAPTOP: number = 1280;
const ADA_ID: string = "00000000-0000-4000-8000-0000000000a1";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/navigation-search",
);
const LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Dashboard/src/Locales",
);

type Language = "de" | "fa";
type Theme = "light" | "dark";

interface PageWords {
  help: string;
  learn: Array<string>;
  howItWorks: string;
  users: string;
  createStatusPage: string;
  askAi: (question: string) => string;
  // A Glossary term's name, as the docs of this language write it.
  probe: string;
  // A question nothing answers, as a reader of this language asks it.
  question: string;
  // The words a reader of this language types for a status page.
  statusPage: string;
}

type LocaleTree = { [key: string]: string | LocaleTree };

const GLOSSARY_PROBE: Record<Language, string> = { de: "Sonde", fa: "پراب" };
const QUESTIONS: Record<Language, string> = {
  de: "Wie füge ich eine Telefonnummer hinzu?",
  fa: "چگونه شماره تلفن اضافه کنم؟",
};
const STATUS_PAGE_WORDS: Record<Language, string> = {
  de: "statusseite erstellen",
  fa: "ساخت صفحه وضعیت",
};

function wordsOf(language: Language): PageWords {
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
    learn: [
      nested("help.quickstart"),
      nested("help.howOneUptimeWorks"),
      nested("help.glossary"),
      nested("help.documentation"),
    ],
    howItWorks: nested("help.howOneUptimeWorks"),
    users: flat("Users"),
    createStatusPage: flat("Create Status Page"),
    askAi: (question: string): string => {
      return flat("Ask AI: {{question}}").replace("{{question}}", question);
    },
    probe: GLOSSARY_PROBE[language],
    question: QUESTIONS[language],
    statusPage: STATUS_PAGE_WORDS[language],
  };
}

interface Counted {
  requests: Array<string>;
  opened: Array<string>;
  askAiRequests: Array<{ prompt?: string; open?: boolean }>;
  memberSearches: Array<string>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

// The widths are set here, on the desktop project.
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
  // Nothing Search reads leaves the page, and nothing throws.
  expect(pageErrors.get(page) || [], "errors on the page").toEqual([]);
});

async function open(
  page: Page,
  options: {
    width: number;
    lang: Language;
    theme: Theme;
    as?: "admin" | "reader";
  },
): Promise<void> {
  await page.setViewportSize({ width: options.width, height: HEIGHT });
  const query: string = [
    "header=true",
    "palette=true",
    `lang=${options.lang}`,
    options.theme === "dark" ? "theme=dark" : "",
    options.as ? `as=${options.as}` : "",
  ]
    .filter(Boolean)
    .join("&");
  await page.goto(`${PROJECT_PATH}/home?${query}`);
  await expect(page.getByTestId("dashboard-top-section")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  // The page reads as its language: Persian right to left.
  await expect(page.locator("html")).toHaveAttribute("lang", options.lang);
  await expect(page.locator("html")).toHaveAttribute(
    "dir",
    options.lang === "fa" ? "rtl" : "ltr",
  );
}

async function counted(page: Page): Promise<Counted> {
  return page.evaluate(() => {
    return (window as unknown as { __headerFixture: Counted }).__headerFixture;
  });
}

function palette(page: Page): Locator {
  return page.getByTestId("command-palette");
}

function input(page: Page): Locator {
  return page.getByTestId("command-palette-input");
}

function option(page: Page, id: string): Locator {
  return page.getByTestId(`command-palette-option-${id}`);
}

/*
 * Search, opened as the reader would at this width: the phone menu's Search
 * at the top of the menu, or the keys on a laptop.
 */
async function openSearch(page: Page, width: number): Promise<void> {
  if (width < 768) {
    await page.getByTestId("mobile-nav-toggle").click();
    const search: Locator = page.getByTestId("navbar-mobile-search");
    await expect(search).toBeVisible();
    await search.click();
  } else {
    await page.keyboard.press("ControlOrMeta+k");
  }

  // The dialog's root holds the fixed panel and has no box of its own.
  await expect(page.getByTestId("command-palette-panel")).toBeVisible();
  await expect(input(page)).toBeFocused();
}

async function search(page: Page, text: string): Promise<void> {
  await input(page).fill(text);
}

// The panel inside the window, and nothing on the page scrolling sideways.
async function expectSearchInsideTheWindow(
  page: Page,
  width: number,
): Promise<void> {
  const [panel]: Array<FrameBox> = await boxesInOneFrame([
    page.getByTestId("command-palette-panel"),
  ]);

  expect(panel!.x, "Search starts inside the window").toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width, "Search ends inside it").toBeLessThanOrEqual(
    width,
  );
  await expectNoSidewaysScroll(page, { message: `Search at ${width}px` });
}

// Each row of a result list inside the panel, its words not cut off it.
async function expectRowInsidePanel(row: Locator, page: Page): Promise<void> {
  const [panel, box]: Array<FrameBox> = await boxesInOneFrame([
    page.getByTestId("command-palette-panel"),
    row,
  ]);

  expect(box!.x).toBeGreaterThanOrEqual(panel!.x - 1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(panel!.x + panel!.width + 1);
}

// A dark page draws Search dark: its panel is no white card.
async function expectThemeOfSearch(page: Page, theme: Theme): Promise<void> {
  const background: string = await page
    .getByTestId("command-palette-panel")
    .evaluate((element: Element): string => {
      return getComputedStyle(element).backgroundColor;
    });
  const channels: Array<number> = (background.match(/\d+(\.\d+)?/g) || [])
    .slice(0, 3)
    .map(Number);
  const brightness: number =
    channels.reduce((sum: number, value: number): number => {
      return sum + value;
    }, 0) / Math.max(1, channels.length);

  if (theme === "dark") {
    expect(brightness, `dark Search, drawn ${background}`).toBeLessThan(80);
  } else {
    expect(brightness, `light Search, drawn ${background}`).toBeGreaterThan(
      200,
    );
  }
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `palette-${name}.png`),
    animations: "disabled",
  });
}

const COMBINATIONS: Array<{ lang: Language; theme: Theme; width: number }> = [];

for (const lang of ["de", "fa"] as Array<Language>) {
  for (const theme of ["light", "dark"] as Array<Theme>) {
    for (const width of [PHONE, LAPTOP]) {
      COMBINATIONS.push({ lang, theme, width });
    }
  }
}

function nameOf(combination: {
  lang: Language;
  theme: Theme;
  width: number;
}): string {
  return `${combination.lang} ${combination.theme} ${combination.width}px`;
}

test.describe("Search and Help, on a phone and a laptop", () => {
  for (const combination of COMBINATIONS) {
    test(`${nameOf(combination)}: Help opens How OneUptime works`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const words: PageWords = wordsOf(combination.lang);
      await open(page, combination);

      if (combination.width < 768) {
        // The phone's menu: Search at the top, Help folded at the bottom.
        await page.getByTestId("mobile-nav-toggle").click();
        const searchRow: Locator = page.getByTestId("navbar-mobile-search");
        const help: Locator = page.getByTestId("navbar-mobile-help");
        await expect(searchRow).toBeVisible();
        await expect(help).toBeVisible();

        const [searchBox, helpBox]: Array<FrameBox> = await boxesInOneFrame([
          searchRow,
          help,
        ]);
        expect(searchBox!.y, "Search tops the menu").toBeLessThan(helpBox!.y);

        await expect(page.getByTestId("navbar-mobile-help-learn")).toHaveCount(
          0,
        );
        await help.getByRole("button", { name: words.help }).click();
        const learn: Locator = page.getByTestId("navbar-mobile-help-learn");
        await expect(learn.locator("a, button")).toHaveText(words.learn);
        await expectNoSidewaysScroll(page, {
          message: `the phone menu in ${combination.lang}`,
        });
        await screenshot(
          page,
          `phone-menu-help-${combination.lang}-${combination.theme}`,
        );

        await learn.getByText(words.howItWorks).click();
      } else {
        // A laptop's header has Help, and its menu the same entries.
        await page
          .getByTestId("dashboard-top-section")
          .getByRole("button", { name: words.help, exact: true })
          .click();
        const learn: Locator = page.getByTestId("help-learn");
        await expect(learn.locator("a, button")).toHaveText(words.learn);
        await learn.getByText(words.howItWorks).click();
      }

      const dialog: Locator = page.getByTestId("how-oneuptime-works-dialog");
      await expect(dialog).toBeVisible();
      await expectNoSidewaysScroll(page, {
        message: `How OneUptime works at ${combination.width}px`,
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    });

    test(`${nameOf(combination)}: Search finds a Glossary term, and offers Ask AI a question nothing answers`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const words: PageWords = wordsOf(combination.lang);
      await open(page, combination);
      await openSearch(page, combination.width);
      await expectThemeOfSearch(page, combination.theme);

      // A term of the Glossary, by its name in the reader's language.
      await search(page, words.probe);
      const term: Locator = option(page, "glossary-term-probe");
      await expect(term).toBeVisible();
      await expect(term).toContainText(words.probe);
      await expectRowInsidePanel(term, page);
      await expectSearchInsideTheWindow(page, combination.width);
      await screenshot(
        page,
        `glossary-${combination.lang}-${combination.theme}-${combination.width}`,
      );

      await term.click();
      await expect(palette(page)).toHaveCount(0);
      await expect
        .poll(async () => {
          return (await counted(page)).opened;
        })
        .toEqual([
          expect.stringMatching(
            new RegExp(
              `/docs/${combination.lang}/introduction/glossary#probe$`,
            ),
          ),
        ]);

      // A question nothing answers is offered to Ask AI, unsent.
      await openSearch(page, combination.width);
      await search(page, words.question);
      const ask: Locator = option(page, "fallback-ask-ai-question");
      await expect(ask).toBeVisible();
      await expect(ask).toContainText(words.askAi(words.question));
      await expectRowInsidePanel(ask, page);
      await expectSearchInsideTheWindow(page, combination.width);
      await screenshot(
        page,
        `ask-ai-${combination.lang}-${combination.theme}-${combination.width}`,
      );

      await page.keyboard.press("Enter");
      await expect(palette(page)).toHaveCount(0);
      await expect
        .poll(async () => {
          return (await counted(page)).askAiRequests;
        })
        .toEqual([{ prompt: words.question, open: true }]);
    });

    test(`${nameOf(combination)}: Search opens Create Status Page's form, and finds a teammate under Users`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const words: PageWords = wordsOf(combination.lang);
      await open(page, { ...combination, as: "admin" });
      await openSearch(page, combination.width);

      // A teammate, by part of their name, with their email under it.
      await search(page, "ada");
      const section: Locator = page.getByTestId(
        "command-palette-section-members",
      );
      await expect(section).toBeVisible();
      await expect(section).toContainText(words.users);
      const teammate: Locator = option(page, `members-members-${ADA_ID}`);
      await expect(teammate).toContainText("Ada Lovelace");
      await expect(teammate).toContainText("ada@acme.test");
      await expectRowInsidePanel(teammate, page);
      await expectSearchInsideTheWindow(page, combination.width);
      await screenshot(
        page,
        `people-${combination.lang}-${combination.theme}-${combination.width}`,
      );

      await teammate.click();
      await expect(page.getByTestId("current-route")).toHaveText(
        `${PROJECT_PATH}/users/${ADA_ID}`,
      );

      // Create Status Page, by the words of the reader's language.
      await openSearch(page, combination.width);
      await search(page, words.statusPage);
      const create: Locator = option(page, "action-create-status-page");
      await expect(create).toBeVisible();
      await expect(create).toContainText(words.createStatusPage);
      await expectRowInsidePanel(create, page);
      await screenshot(
        page,
        `create-${combination.lang}-${combination.theme}-${combination.width}`,
      );

      await create.click();
      await expect(page.getByTestId("current-route")).toHaveText(
        `${PROJECT_PATH}/status-pages`,
      );
      await expect(page.getByTestId("current-search")).toHaveText("?create=1");
    });
  }
});

test.describe("Search for someone who may do neither", () => {
  for (const lang of ["de", "fa"] as Array<Language>) {
    test(`${lang}: someone who reads services alone is offered no Create Status Page, and nobody is searched for`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const words: PageWords = wordsOf(lang);
      await open(page, {
        width: LAPTOP,
        lang: lang,
        theme: "light",
        as: "reader",
      });
      await openSearch(page, LAPTOP);

      /*
       * In English, which Search reads in every language: the list itself
       * is found by it, as anyone may open the list - and its form is not
       * offered.
       */
      await search(page, "create status page");
      await expect(
        option(page, "page-dashboard-projectid-status-pages"),
      ).toBeVisible();
      await expect(option(page, "action-create-status-page")).toHaveCount(0);

      await search(page, words.statusPage);
      await expect(option(page, "action-create-status-page")).toHaveCount(0);

      await search(page, "ada");
      await expect(
        page.getByTestId("command-palette-section-members"),
      ).toHaveCount(0);
      /*
       * Never asked: the round of record searches for "ada" went out (the
       * docs were asked), without the people.
       */
      await expect
        .poll(async () => {
          return (await counted(page)).requests.some(
            (request: string): boolean => {
              return request.includes("/search/") && request.includes("q=ada");
            },
          );
        })
        .toBe(true);
      expect((await counted(page)).memberSearches).toEqual([]);
    });
  }
});
