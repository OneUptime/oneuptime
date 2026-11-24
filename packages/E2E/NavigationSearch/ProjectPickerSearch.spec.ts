import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { boxesInOneFrame } from "../SuiteHelpers/Frames";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * The header's project list, searched in a real browser with production's
 * CSS and fonts.
 *
 * Its search box kept a project only when its name started with what was
 * typed: "kube" did not find "OneUptime Kubernetes", "acme" did not find
 * "Sample: Acme Shop", and a search that found nothing left Create New
 * Project as the list's only row. A name is now matched as Search
 * (Cmd/Ctrl+K) matches a page's (Common's ProjectSearch): by any word, best
 * match first, with the part it matched marked as Search marks it; a search
 * that finds nothing says so, inside the list, in the light theme and the
 * dark, and on a phone a long one wraps inside the list. The project the
 * person is in is marked with a dot after its name, announced as the
 * current one, and the keyboard starts on it (#8050).
 *
 * The fixture's ?header=true&projects=many page (HeaderFixture.js) is the
 * top of a Dashboard page in "Acme Commerce Production", with six more
 * projects in its picker: the names of a real list, two of them "Test
 * Project\".
 */

const PROJECT_PATH: string = "/dashboard/00000000-0000-4000-8000-000000000001";
const PROJECT_NAME: string = "Acme Commerce Production";
const KUBERNETES_PATH: string =
  "/dashboard/00000000-0000-4000-8000-000000000011";
const HEIGHT: number = 760;

// Tailwind's yellow-100: the ground Search (Cmd/Ctrl+K) marks a match with.
const YELLOW_100: string = "rgb(254, 249, 195)";

// WCAG's least contrast for text of this size.
const LEAST_TEXT_CONTRAST: number = 4.5;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/navigation-search",
);

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

interface OpenList {
  menu: Locator;
  search: Locator;
}

interface ListOptions {
  theme?: "dark";
  // A reading language of the fixture: "fa" reads right to left.
  lang?: "fa";
}

// The page at a width, with the picker's list open from a click.
async function openList(
  page: Page,
  width: number,
  options: ListOptions = {},
): Promise<OpenList> {
  await page.setViewportSize({ width: width, height: HEIGHT });
  await page.goto(
    `${PROJECT_PATH}/home?header=true&projects=many${
      options.theme ? `&theme=${options.theme}` : ""
    }${options.lang ? `&lang=${options.lang}` : ""}`,
  );
  await expect(page.getByTestId("dashboard-top-section")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await picker(page, PROJECT_NAME).click();

  const menu: Locator = page.getByTestId("project-picker-menu");
  // Its English name, or the list's one search box in another language.
  const search: Locator = options.lang
    ? menu.getByRole("combobox")
    : menu.getByRole("combobox", {
        name: "Search Projects",
        exact: true,
      });
  await expect(search).toBeVisible();

  return { menu: menu, search: search };
}

function picker(page: Page, name: string): Locator {
  return page
    .getByTestId("dashboard-top-section")
    .getByRole("button", { name: name });
}

function rows(menu: Locator): Locator {
  return menu.getByRole("listbox").getByRole("option");
}

// How wide a name's words are drawn, whatever marks are in them.
async function nameWidth(name: Locator): Promise<number> {
  return name.evaluate((element: Element): number => {
    const range: Range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().width;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `project-search-${name}.png`),
    clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 480 },
    animations: "disabled",
  });
}

/*
 * How far apart an element's text colour and the ground it is drawn on
 * are, as WCAG measures it: the colour of its text against the first
 * ancestor that paints a ground. A mark drawn by its own ground (a dot) is
 * measured by that ground, against its nearest painted ancestor's.
 */
async function textContrast(
  element: Locator,
  options: { paintedByItsGround?: boolean } = {},
): Promise<number> {
  return element.evaluate(
    (node: Element, paintedByItsGround: boolean): number => {
      const channels: (color: string) => Array<number> = (
        color: string,
      ): Array<number> => {
        return (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      };

      const luminance: (color: string) => number = (color: string): number => {
        const [red, green, blue] = channels(color).map(
          (channel: number): number => {
            const value: number = channel / 255;
            return value <= 0.03928
              ? value / 12.92
              : Math.pow((value + 0.055) / 1.055, 2.4);
          },
        );
        return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
      };

      let ground: Element | null = paintedByItsGround
        ? node.parentElement
        : node;
      let groundColor: string = "rgba(0, 0, 0, 0)";

      while (ground) {
        const color: string = window.getComputedStyle(ground).backgroundColor;

        if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
          groundColor = color;
          break;
        }

        ground = ground.parentElement;
      }

      const text: number = luminance(
        paintedByItsGround
          ? window.getComputedStyle(node).backgroundColor
          : window.getComputedStyle(node).color,
      );
      const back: number = luminance(groundColor);

      return (Math.max(text, back) + 0.05) / (Math.min(text, back) + 0.05);
    },
    Boolean(options.paintedByItsGround),
  );
}

test.describe("at a desktop's width", () => {
  // Drawn at 1280px, on the desktop project; a phone has its own test below.
  test.skip(({ isMobile }: { isMobile: boolean }): boolean => {
    return isMobile;
  });

  test("a word from the middle of a name finds it, marked as Search marks a match, and Enter opens it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const { menu, search }: OpenList = await openList(page, 1280);

    const name: Locator = rows(menu)
      .filter({ hasText: "OneUptime Kubernetes" })
      .locator('[dir="auto"]');
    const unmarkedWidth: number = await nameWidth(name);

    await search.fill("kube");

    await expect(rows(menu)).toHaveText([
      "OneUptime Kubernetes",
      "Create New Project",
    ]);

    const mark: Locator = rows(menu).first().locator("mark");
    await expect(mark).toHaveText("Kube");
    await expect(mark).toBeVisible();
    await expect(mark).toHaveCSS("background-color", YELLOW_100);

    /*
     * The mark takes no room of its own: the name is as wide marked as it
     * was, rather than "Kube rnetes", a padded mark's gap splitting the word.
     */
    expect(Math.abs((await nameWidth(name)) - unmarkedWidth)).toBeLessThan(0.5);

    // The best match is the row Enter opens.
    await expect(search).toHaveAttribute(
      "aria-activedescendant",
      (await rows(menu).first().getAttribute("id"))!,
    );
    await screenshot(page, "kube");

    await search.press("Enter");

    await expect(page.getByTestId("current-route")).toHaveText(KUBERNETES_PATH);
    await expect(menu).toBeHidden();
    await expect(picker(page, "OneUptime Kubernetes")).toBeVisible();
  });

  test("the best match comes first: test lists both Test Project\\ before Project test, and acme finds Sample: Acme Shop", async ({
    page,
  }: {
    page: Page;
  }) => {
    const { menu, search }: OpenList = await openList(page, 1280);

    await search.fill("test");
    await expect(rows(menu)).toHaveText([
      "Test Project\\",
      "Test Project\\",
      "Project test",
      "Create New Project",
    ]);

    await search.fill("acme");
    await expect(rows(menu)).toHaveText([
      PROJECT_NAME,
      "Sample: Acme Shop",
      "Create New Project",
    ]);
    await expect(rows(menu).nth(1).locator("mark")).toHaveText("Acme");

    // Cleared, every project is listed again, in the list's order, unmarked.
    await search.fill("");
    await expect(rows(menu)).toHaveCount(8);
    await expect(menu.locator("mark")).toHaveCount(0);
  });

  /*
   * The open project (#8050): a dot after its name, its row announced as
   * the current one, and the keyboard starting on it rather than on the
   * list's first row. In the light theme and the dark, and in Persian,
   * where "after its name" is to its left.
   */
  for (const [label, options] of [
    ["in the light theme", {}],
    ["in the dark theme", { theme: "dark" }],
    ["in Persian, right to left", { lang: "fa" }],
  ] as Array<[string, ListOptions]>) {
    test(`${label}, the open project is marked after its name, announced as current, and the keyboard starts on it`, async ({
      page,
    }: {
      page: Page;
    }) => {
      // Open a project that is not the list's first.
      const { menu, search }: OpenList = await openList(page, 1280, options);
      await rows(menu).filter({ hasText: "OneUptime Kubernetes" }).click();
      await expect(page.getByTestId("current-route")).toHaveText(
        KUBERNETES_PATH,
      );
      await expect(menu).toBeHidden();

      await picker(page, "OneUptime Kubernetes").click();
      await expect(search).toBeVisible();

      const open: Locator = rows(menu).filter({
        hasText: "OneUptime Kubernetes",
      });
      const mark: Locator = open.getByTestId("project-picker-open-project");

      await expect(open).toHaveAttribute("aria-current", "true");
      await expect(menu.locator('[aria-current="true"]')).toHaveCount(1);
      await expect(mark).toBeVisible();
      await expect(
        rows(menu)
          .filter({ hasText: PROJECT_NAME })
          .getByTestId("project-picker-open-project"),
      ).toHaveCount(0);

      // After the name as the row reads it, and inside the row.
      const [row, name, dot] = await boxesInOneFrame([
        open,
        open.locator('[dir="auto"]'),
        mark,
      ]);

      if (options.lang === "fa") {
        expect(dot!.x + dot!.width).toBeLessThanOrEqual(name!.x + 0.5);
      } else {
        expect(dot!.x).toBeGreaterThanOrEqual(name!.x + name!.width - 0.5);
      }

      expect(dot!.x).toBeGreaterThanOrEqual(row!.x);
      expect(dot!.x + dot!.width).toBeLessThanOrEqual(
        row!.x + row!.width + 0.5,
      );

      // A dot, seen on the list's ground: WCAG's 3:1 for a mark that means something.
      expect(dot!.width).toBeGreaterThanOrEqual(5.5);
      expect(
        await textContrast(mark, { paintedByItsGround: true }),
      ).toBeGreaterThanOrEqual(3);

      // The keyboard starts on it, not on the first row, and moves on from it.
      const ids: Array<string | null> = await rows(menu).evaluateAll(
        (elements: Array<Element>): Array<string | null> => {
          return elements.map((element: Element): string | null => {
            return element.getAttribute("id");
          });
        },
      );
      const openId: string = (await open.getAttribute("id"))!;

      expect(ids.indexOf(openId)).toBeGreaterThan(0);
      await expect(search).toHaveAttribute("aria-activedescendant", openId);

      await search.press("ArrowDown");
      await expect(search).toHaveAttribute(
        "aria-activedescendant",
        ids[ids.indexOf(openId) + 1]!,
      );

      await screenshot(
        page,
        `open-project-${options.lang || options.theme || "light"}`,
      );
    });
  }

  for (const theme of ["light", "dark"] as Array<"light" | "dark">) {
    test(`in the ${theme} theme, a search that finds nothing says so inside the list, legibly, and offers no Create New Project`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const { menu, search }: OpenList = await openList(
        page,
        1280,
        theme === "dark" ? { theme: "dark" } : {},
      );

      await search.fill("zzz");

      const noMatches: Locator = menu.getByTestId("project-picker-no-matches");
      await expect(noMatches).toHaveText("No matches for “zzz”");
      await expect(noMatches).toBeVisible();
      await expect(rows(menu)).toHaveCount(0);
      await expect(menu.getByText("Create New Project")).toHaveCount(0);

      // Inside the list's box, under the search box.
      const [list, message, box] = await boxesInOneFrame([
        menu,
        noMatches,
        search,
      ]);
      expect(message!.x).toBeGreaterThanOrEqual(list!.x);
      expect(message!.x + message!.width).toBeLessThanOrEqual(
        list!.x + list!.width + 0.5,
      );
      expect(message!.y).toBeGreaterThanOrEqual(box!.y + box!.height);
      expect(message!.y + message!.height).toBeLessThanOrEqual(
        list!.y + list!.height + 0.5,
      );

      expect(await textContrast(noMatches)).toBeGreaterThanOrEqual(
        LEAST_TEXT_CONTRAST,
      );

      await screenshot(page, `nothing-${theme}`);
    });
  }
});

test.describe("on a phone", () => {
  // A phone's touch and its width: the mobile project only.
  test.skip(({ isMobile }: { isMobile: boolean }): boolean => {
    return !isMobile;
  });

  test("a long search that finds nothing wraps inside the list, and the page does not scroll sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    const width: number = 375;
    const { menu, search }: OpenList = await openList(page, width);

    await search.fill("a project name that nobody has ever given to anything");

    const noMatches: Locator = menu.getByTestId("project-picker-no-matches");
    await expect(noMatches).toBeVisible();

    const [list, message] = await boxesInOneFrame([menu, noMatches]);
    expect(message!.x).toBeGreaterThanOrEqual(list!.x);
    expect(message!.x + message!.width).toBeLessThanOrEqual(
      list!.x + list!.width + 0.5,
    );
    expect(list!.x + list!.width).toBeLessThanOrEqual(width);

    await expectNoSidewaysScroll(page, { message: "no matches at 375px" });
    await screenshot(page, "nothing-phone");
  });

  // The open project's dot (#8050) stays on screen beside a long name.
  test("the open project is marked inside the list, and the page does not scroll sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    const width: number = 375;
    const { menu }: OpenList = await openList(page, width);

    const open: Locator = rows(menu).filter({ hasText: PROJECT_NAME });
    const mark: Locator = open.getByTestId("project-picker-open-project");

    await expect(open).toHaveAttribute("aria-current", "true");
    await expect(mark).toBeVisible();

    const [list, dot] = await boxesInOneFrame([menu, mark]);
    expect(dot!.x).toBeGreaterThanOrEqual(list!.x);
    expect(dot!.x + dot!.width).toBeLessThanOrEqual(
      list!.x + list!.width + 0.5,
    );
    expect(list!.x + list!.width).toBeLessThanOrEqual(width);

    await expectNoSidewaysScroll(page, {
      message: "the open project's mark at 375px",
    });
    await screenshot(page, "open-project-phone");
  });
});
