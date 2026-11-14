import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * The Dashboard's header on a phone (#7236), in a real browser with
 * production's CSS and fonts.
 *
 * On a 390px phone the header drew OneUptime's 120px wordmark and left the
 * project picker - its one entry that gives way - 17px for the project's
 * name: "A." for "Acme Commerce Production" (2px in Arabic at 375px), so
 * someone with several projects could not tell which one they were in.
 * Below 640px the logo is now OneUptime's mark, and the picker spends its
 * room on the name: at 320, 375 and 390px, in English, German and Arabic,
 * light and dark, the name shows at least its first word, on one 64px row
 * with the logo, the bell and the profile button, all inside the window.
 * The picker's list opens 20rem wide (as wide as the phone allows on a
 * phone), inside the window, with the whole name and Create New Project on
 * one line: on a phone, and on a tablet and a wide screen too, where the
 * list was as narrow as the picker and cut both. From 640px the header
 * itself is as it was. The list is a listbox named in the reader's
 * language, with an id of its own for each row, and its search box names
 * the row the arrow keys are on (#7487).
 *
 * The fixture's ?header=true page (HeaderFixture.js) is the top of every
 * Dashboard page: the production header and nav bar, in a project named
 * "Acme Commerce Production".
 */

const PROJECT_PATH: string = "/dashboard/00000000-0000-4000-8000-000000000001";
const PROJECT_NAME: string = "Acme Commerce Production";
const FIRST_WORD: string = "Acme";
const PHONE_WIDTHS: Array<number> = [390, 375, 320];
const HEIGHT: number = 760;
// The header's row: Common's Header is h-16.
const HEADER_HEIGHT_IN_PX: number = 64;
// Tailwind's sm, where the header is as it was.
const SMALL_SCREEN_ENDS_AT: number = 640;

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
  bell: string;
  profile: string;
  createProject: string;
  // The picker's list and its search box, as a screen reader names them.
  projects: string;
  searchProjects: string;
}

type LocaleTree = { [key: string]: string | LocaleTree };

function wordsOf(language: Language): HeaderWords {
  const locale: LocaleTree = JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as LocaleTree;

  return {
    bell: locale["View notifications"] as string,
    profile: (locale["userProfile"] as LocaleTree)["label"] as string,
    createProject: locale["Create New Project"] as string,
    projects: locale["Projects"] as string,
    searchProjects: locale["Search Projects"] as string,
  };
}

interface ShownName {
  // The name's box, as wide as the picker leaves it.
  shown: number;
  // The whole name's width, and its first word's.
  full: number;
  firstWord: number;
  ellipsis: number;
}

const pageErrors: Map<Page, Array<string>> = new Map();

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
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        return window.innerWidth;
      });
    })
    .toBe(width);
}

function picker(page: Page): Locator {
  return page
    .getByTestId("dashboard-top-section")
    .getByRole("button", { name: PROJECT_NAME });
}

function headerButton(page: Page, name: string): Locator {
  return page
    .getByTestId("dashboard-top-section")
    .getByRole("button", { name: name, exact: true })
    .first();
}

// The profile button: named by its label, then the person's name.
function profileButton(page: Page, words: HeaderWords): Locator {
  return page
    .getByTestId("dashboard-top-section")
    .getByRole("button", { name: words.profile })
    .first();
}

function logoImage(page: Page): Locator {
  return page.getByTestId("header-logo").locator("img");
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `header-phone-${name}.png`),
    clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 400 },
    animations: "disabled",
  });
}

/*
 * How much of the project's name the picker shows: its box, against the
 * widths of the whole name, of its first word and of the ellipsis the
 * browser draws where it cuts the name, all in the name's own font.
 */
async function shownName(page: Page): Promise<ShownName> {
  return picker(page)
    .locator("span.truncate")
    .evaluate((name: Element, firstWord: string): ShownName => {
      const text: Node = name.firstChild!;
      const range: Range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, firstWord.length);

      const canvas: HTMLCanvasElement = document.createElement("canvas");
      const context: CanvasRenderingContext2D = canvas.getContext("2d")!;
      context.font = window.getComputedStyle(name).font;

      return {
        shown: (name as HTMLElement).clientWidth,
        full: (name as HTMLElement).scrollWidth,
        firstWord: range.getBoundingClientRect().width,
        ellipsis: context.measureText("…").width,
      };
    }, FIRST_WORD);
}

// Which image the browser drew: the small screen's <source>, or the logo itself.
async function drawnLogo(page: Page): Promise<"mark" | "logo" | "neither"> {
  return logoImage(page).evaluate(
    (image: HTMLImageElement): "mark" | "logo" | "neither" => {
      const source: HTMLSourceElement | null =
        image.parentElement?.querySelector("source") || null;

      if (source && image.currentSrc === source.srcset) {
        return "mark";
      }

      return image.currentSrc === image.src ? "logo" : "neither";
    },
  );
}

/*
 * The header's entries in the order they are drawn from the start of the
 * line (the right in Arabic): the logo, the picker, the bell, the profile
 * button. One 64px row, inside the window, none over another, the profile
 * button at the line's end.
 */
async function expectOneRowInsideTheWindow(
  page: Page,
  words: HeaderWords,
  isRightToLeft: boolean,
): Promise<Array<FrameBox>> {
  const width: number = page.viewportSize()!.width;
  const boxes: Array<FrameBox> = await boxesInOneFrame([
    page.getByTestId("header-logo"),
    picker(page),
    headerButton(page, words.bell),
    profileButton(page, words),
  ]);

  // In reading order: mirrored on a page that reads right to left.
  const inReadingOrder: Array<FrameBox> = boxes.map(
    (box: FrameBox): FrameBox => {
      return isRightToLeft ? { ...box, x: width - box.x - box.width } : box;
    },
  );

  for (let index: number = 0; index < inReadingOrder.length; index++) {
    const box: FrameBox = inReadingOrder[index]!;

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
      const previous: FrameBox = inReadingOrder[index - 1]!;

      expect(
        box.x,
        `entry ${index} comes after entry ${index - 1}, not over it`,
      ).toBeGreaterThanOrEqual(previous.x + previous.width);
    }
  }

  // The bell and the profile button keep their place at the line's end.
  const profile: FrameBox = inReadingOrder[3]!;
  expect(width - (profile.x + profile.width)).toBeLessThanOrEqual(24);

  const header: FrameBox = (
    await boxesInOneFrame([page.getByTestId("dashboard-top-section")])
  )[0]!;
  expect(header.height).toBeGreaterThanOrEqual(HEADER_HEIGHT_IN_PX);

  await expectNoSidewaysScroll(page, { message: `at ${width}px` });

  return boxes;
}

const CASES: Array<{
  lang: Language;
  theme?: "dark";
  label: string;
}> = [
  { lang: "en", label: "in English, light" },
  { lang: "de", theme: "dark", label: "in German, dark" },
  { lang: "ar", label: "in Arabic, right to left" },
];

test.describe("the header on a phone", () => {
  // The widths are set here, on the desktop project; the phone's own is below.
  test.skip(({ isMobile }: { isMobile: boolean }): boolean => {
    return isMobile;
  });

  for (const header of CASES) {
    test(`${header.label}: at 390, 375 and 320px the project's name shows at least its first word, on one row with the mark, the bell and the profile button`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const words: HeaderWords = wordsOf(header.lang);
      const isRightToLeft: boolean = header.lang === "ar";
      const options: { lang: Language; theme?: "dark" } = { lang: header.lang };

      if (header.theme) {
        options.theme = header.theme;
      }

      await open(page, PHONE_WIDTHS[0]!, options);

      if (isRightToLeft) {
        await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      }

      if (header.theme === "dark") {
        await expect(page.locator("html")).toHaveClass(/dark/);
      }

      for (const width of PHONE_WIDTHS) {
        await resize(page, width);

        const boxes: Array<FrameBox> = await expectOneRowInsideTheWindow(
          page,
          words,
          isRightToLeft,
        );

        const name: ShownName = await shownName(page);
        expect(
          name.shown,
          `at ${width}px the name shows "${FIRST_WORD}" and its ellipsis (${JSON.stringify(name)})`,
        ).toBeGreaterThanOrEqual(name.firstWord + name.ellipsis);
        expect(name.full).toBeGreaterThan(name.shown);

        // The mark, not the 120px wordmark.
        await expect
          .poll(async () => {
            return drawnLogo(page);
          })
          .toBe("mark");
        expect(boxes[0]!.width, "the logo's link").toBeLessThanOrEqual(56);

        // Nothing but the picker's own arrows beside the name: no folder icon.
        await expect(picker(page).locator("svg").first()).toBeHidden();

        await screenshot(
          page,
          `${header.lang}-${header.theme || "light"}-${width}`,
        );
      }
    });
  }

  test("from 640px the wordmark is back and the picker as it was; at 639px the mark", async ({
    page,
  }: {
    page: Page;
  }) => {
    const words: HeaderWords = wordsOf("en");
    await open(page, SMALL_SCREEN_ENDS_AT - 1);

    await expect
      .poll(async () => {
        return drawnLogo(page);
      })
      .toBe("mark");

    for (const width of [SMALL_SCREEN_ENDS_AT, 768, 1280]) {
      await resize(page, width);
      await expect
        .poll(async () => {
          return drawnLogo(page);
        })
        .toBe("logo");

      const [logo, project] = await boxesInOneFrame([
        logoImage(page),
        picker(page),
      ]);
      // The 5:1 wordmark at 32px, and the picker's folder icon.
      expect(logo!.width).toBeGreaterThan(120);
      expect(logo!.height).toBe(32);
      await expect(picker(page).locator("svg").first()).toBeVisible();
      expect(project!.width).toBeGreaterThan(150);
    }

    await resize(page, 768);
    await expectNoSidewaysScroll(page, { message: "at 768px" });
    expect(words.bell).toBe("View notifications");
  });

  for (const [lang, width] of [
    ["en", 320],
    ["en", 390],
    ["ar", 375],
    // A tablet, where the picker is squeezed beside Search and Help.
    ["de", 768],
    ["ar", 768],
    ["en", 1280],
  ] as Array<[Language, number]>) {
    test(`in ${lang} at ${width}px the picker's list opens 20rem wide or as wide as the phone allows, inside the window, with the whole name`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const words: HeaderWords = wordsOf(lang);
      await open(page, width, { lang: lang });

      await picker(page).click();

      const menu: Locator = page.getByTestId("project-picker-menu");
      await expect(menu).toBeVisible();

      const [list] = await boxesInOneFrame([menu]);
      expect(list!.x).toBeGreaterThanOrEqual(15.5);
      expect(list!.x + list!.width).toBeLessThanOrEqual(width - 15.5);
      expect(list!.width).toBeGreaterThanOrEqual(Math.min(320, width - 32) - 1);

      // The project's whole name, and Create New Project on one line.
      const item: Locator = menu
        .getByRole("option")
        .filter({ hasText: PROJECT_NAME })
        .locator("span.truncate");
      const cut: boolean = await item.evaluate((name: Element): boolean => {
        return (
          (name as HTMLElement).scrollWidth > (name as HTMLElement).clientWidth
        );
      });
      expect(cut, "the name in the list is cut short").toBe(false);

      const createLines: number = await menu
        .getByText(words.createProject, { exact: true })
        .evaluate((label: Element): number => {
          return label.getClientRects().length;
        });
      expect(createLines).toBe(1);

      await expectNoSidewaysScroll(page, { message: `list at ${width}px` });
      await screenshot(page, `list-${lang}-${width}`);

      /*
       * The list a screen reader meets (#7487): a listbox named in the
       * reader's language, a row with an id of its own for the project and
       * one for Create New Project (both were listbox-option-0), and the
       * search box named by its label, naming the row the arrow keys are on.
       */
      const listbox: Locator = menu.getByRole("listbox", {
        name: words.projects,
        exact: true,
      });
      await expect(listbox).toBeVisible();
      const rowIds: Array<string> = await listbox
        .getByRole("option")
        .evaluateAll((rows: Array<Element>): Array<string> => {
          return rows.map((row: Element): string => {
            return row.id;
          });
        });
      expect(rowIds).toHaveLength(2);
      expect(new Set(rowIds).size).toBe(2);
      expect(rowIds).not.toContain("listbox-option-0");
      expect(rowIds).not.toContain("");

      const search: Locator = menu.getByRole("combobox", {
        name: words.searchProjects,
        exact: true,
      });
      await search.focus();
      await expect(search).toHaveAttribute("aria-activedescendant", rowIds[0]!);
      await search.press("ArrowDown");
      await expect(search).toHaveAttribute("aria-activedescendant", rowIds[1]!);
      await expect(
        listbox.getByRole("option", { selected: true }),
      ).toHaveAttribute("id", rowIds[1]!);
    });
  }

  test("in the dark theme the row the keyboard is on stands out from the rest, Create New Project too, and Shift+Tab puts the list away", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * The keyboard's row takes Search's cursor ground, and Create New
     * Project a stronger edge as well as a deeper ground: the dark theme
     * gives bg-indigo-50 and bg-indigo-100 the one wash (Theme.css), so a
     * ground alone did not tell the row Enter opens from the row at rest.
     */
    const TRANSPARENT: string = "rgba(0, 0, 0, 0)";
    const words: HeaderWords = wordsOf("en");
    await open(page, 1280, { theme: "dark" });

    // Enter on the picker: the list opens with the focus in its search box.
    await picker(page).focus();
    await page.keyboard.press("Enter");

    const menu: Locator = page.getByTestId("project-picker-menu");
    const search: Locator = menu.getByRole("combobox", {
      name: words.searchProjects,
      exact: true,
    });
    await expect(search).toBeFocused();

    const projectRow: Locator = menu
      .getByRole("option")
      .filter({ hasText: PROJECT_NAME });
    const createRow: Locator = menu
      .getByRole("option")
      .filter({ hasText: words.createProject });
    /*
     * A row's colour once its transitions have run (the rows ease their
     * ground and edge in over 150ms).
     */
    const settled: (row: Locator, property: string) => Promise<string> = (
      row: Locator,
      property: string,
    ): Promise<string> => {
      return row.evaluate(async (element: Element, name: string) => {
        await Promise.all(
          element.getAnimations().map((animation: Animation) => {
            return animation.finished;
          }),
        );
        return window.getComputedStyle(element).getPropertyValue(name);
      }, property);
    };
    const panelGround: string = await settled(menu, "background-color");

    // The project's row is the keyboard's: a ground of its own on the list.
    await expect(projectRow).toHaveAttribute("aria-selected", "true");
    const activeGround: string = await settled(projectRow, "background-color");
    expect(activeGround).not.toBe(TRANSPARENT);
    expect(activeGround).not.toBe(panelGround);
    const restingEdge: string = await settled(createRow, "border-top-color");

    await search.press("ArrowDown");
    await expect(createRow).toHaveAttribute("aria-selected", "true");
    // The project's row is back on the list's ground; Create's edge changes.
    await expect
      .poll(() => {
        return settled(projectRow, "background-color");
      })
      .toBe(TRANSPARENT);
    await expect
      .poll(() => {
        return settled(createRow, "border-top-color");
      })
      .not.toBe(restingEdge);

    /*
     * Shift+Tab moves the focus back to the picker, as anywhere, and the
     * list goes away behind it rather than cover the page.
     */
    await search.press("Shift+Tab");
    await expect(picker(page)).toBeFocused();
    await expect(menu).toBeHidden();
  });
});

test.describe("the header on a phone's own screen", () => {
  test.skip(({ isMobile }: { isMobile: boolean }): boolean => {
    return !isMobile;
  });

  test("on the phone project's device the name shows at least its first word beside the mark", async ({
    page,
  }: {
    page: Page;
  }) => {
    const words: HeaderWords = wordsOf("en");
    await page.goto(`${PROJECT_PATH}/home?header=true`);
    await expect(page.getByTestId("dashboard-top-section")).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    await expectOneRowInsideTheWindow(page, words, false);
    await expect
      .poll(async () => {
        return drawnLogo(page);
      })
      .toBe("mark");

    const name: ShownName = await shownName(page);
    expect(name.shown).toBeGreaterThanOrEqual(name.firstWord + name.ellipsis);
  });
});
