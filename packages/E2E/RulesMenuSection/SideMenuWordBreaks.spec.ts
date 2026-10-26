import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";

/*
 * Where a side menu's titles and section headings break, in Chromium and
 * in Firefox (RulesMenuSection/Fixture: the real status page and SLO
 * menus).
 *
 * Long titles wrap onto a second line rather than ending in an ellipsis,
 * and a word too long for any line of the menu - a German compound,
 * "Benachrichtigungsprotokolle" - is hyphenated in its language. Chrome
 * hyphenates only such a word, but Firefox and Safari hyphenate whatever
 * word ends a line: with every translated title hyphenated, Firefox drew
 * the maintainer's own example, French Burn Rate Rules, as "Règles de taux
 * de consom- / mation", and "Paramètres des abon- / nés", "JOURNAUX DE
 * NOTIFI- / CATION", where each word fits whole on the next line. Only a
 * title holding a word of 14 letters or more is hyphenated now, and only
 * inside such words (getMenuWordsBreakClassName in Common's
 * SideMenuEntryState). jsdom lays nothing out, so the jest suite can only
 * pin the classes: here every word is measured where it is drawn.
 */

const PORT: string = process.env["RULES_MENU_SECTION_FIXTURE_PORT"] || "4385";
const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000f1";
const STATUS_PAGE_PATH: string = `/dashboard/${PROJECT_ID}/status-pages/20000000-0000-4000-8000-0000000000f2`;
const SLO_PATH: string = `/dashboard/${PROJECT_ID}/slos/30000000-0000-4000-8000-0000000000f3`;

/*
 * The longest word always kept whole: one letter under
 * SIDE_MENU_HYPHENATED_WORD_LENGTH (Common's SideMenuEntryState).
 */
const LONGEST_WORD_KEPT_WHOLE: number = 13;

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
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
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
});

/*
 * A page of the fixture, once the layout has drawn the record's name, with
 * the page saying lang="en" as the Dashboard's always does: the menu's
 * translated words carry their own language.
 */
async function open(page: Page, address: string): Promise<void> {
  await page.goto(address);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    address.includes("/slos/") ? "Checkout availability" : "Acme Public Status",
    { timeout: 60000 },
  );
  await page.evaluate(async (): Promise<void> => {
    document.documentElement.lang = "en";
    await document.fonts.ready;
  });
}

function desktopMenu(page: Page): Locator {
  return page.locator("aside[role='navigation']");
}

interface BrokenWord {
  title: string;
  word: string;
  lines: number;
}

/*
 * The words of every title and section heading in sight that are drawn on
 * more than one line. A word is a run of letters between spaces and
 * hyphens: a compound breaking at its own hyphen ("Abonnenten- /
 * Einstellungen") breaks between two words, not inside one.
 */
async function wordsBrokenAcrossLines(
  menu: Locator,
): Promise<Array<BrokenWord>> {
  return await menu.evaluate((root: Element): Array<BrokenWord> => {
    const broken: Array<BrokenWord> = [];
    const titles: NodeListOf<Element> = root.querySelectorAll(
      '[data-testid="side-menu-item-title"], h6',
    );

    titles.forEach((title: Element): void => {
      const style: CSSStyleDeclaration = getComputedStyle(title);

      if (
        style.visibility !== "visible" ||
        title.getBoundingClientRect().height === 0
      ) {
        return;
      }

      const walker: TreeWalker = document.createTreeWalker(
        title,
        NodeFilter.SHOW_TEXT,
      );
      let node: Node | null = walker.nextNode();

      while (node) {
        const text: string = node.textContent || "";
        let start: number = 0;

        for (let index: number = 0; index <= text.length; index++) {
          const character: string | undefined = text[index];
          const endsWord: boolean =
            index === text.length || character === " " || character === "-";

          if (!endsWord) {
            continue;
          }

          if (index > start) {
            const range: Range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, index);
            const lineTops: Set<number> = new Set<number>(
              Array.from(range.getClientRects())
                .filter((rect: DOMRect): boolean => {
                  return rect.width > 0;
                })
                .map((rect: DOMRect): number => {
                  return Math.round(rect.top);
                }),
            );

            if (lineTops.size > 1) {
              broken.push({
                title: title.textContent || "",
                word: text.slice(start, index),
                lines: lineTops.size,
              });
            }
          }

          start = index + 1;
        }

        node = walker.nextNode();
      }
    });

    return broken;
  });
}

const PAGES: Array<{ lang: string; address: string }> = [
  // Règles de taux de consommation: the maintainer's French Burn Rate Rules.
  { lang: "fr", address: `${SLO_PATH}/burn-rate-rules` },
  // Abonnés au webhook, Paramètres des abonnés, Journaux de notification.
  { lang: "fr", address: `${STATUS_PAGE_PATH}/microsoft-teams-subscribers` },
  // Microsoft Teams-Abonnenten, Abonnenten-Einstellungen.
  { lang: "de", address: `${STATUS_PAGE_PATH}/microsoft-teams-subscribers` },
  // Benachrichtigungsprotokolle, as a heading and as an entry.
  { lang: "de", address: `${STATUS_PAGE_PATH}/notification-logs` },
  { lang: "en", address: `${STATUS_PAGE_PATH}/microsoft-teams-subscribers` },
];

test.describe("where a side menu's words break", () => {
  for (const { lang, address } of PAGES) {
    test(`${lang} ${address.split("/").pop()}: a word that fits a line of its own is never broken, at 1280, 1024 and 768 pixels`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 1280, height: 1100 });
      await open(page, `${address}?lang=${lang}`);

      for (const width of [1280, 1024, 768]) {
        await page.setViewportSize({ width, height: 1100 });
        // The menu narrows from 256 to 224 pixels below 1024.
        await page.waitForTimeout(150);

        const broken: Array<BrokenWord> = await wordsBrokenAcrossLines(
          desktopMenu(page),
        );

        expect({
          width,
          broken: broken.filter((word: BrokenWord): boolean => {
            return Array.from(word.word).length <= LONGEST_WORD_KEPT_WHOLE;
          }),
        }).toEqual({ width, broken: [] });
      }
    });
  }

  test("only a word too long for a line may be hyphenated, in its own language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${STATUS_PAGE_PATH}/notification-logs?lang=de`);
    const menu: Locator = desktopMenu(page);

    const hyphens: Array<{ text: string; hyphens: string; lang: string }> =
      await menu.evaluate(
        (
          root: Element,
        ): Array<{ text: string; hyphens: string; lang: string }> => {
          return Array.from(
            root.querySelectorAll('[data-testid="side-menu-item-title"], h6'),
          )
            .filter((element: Element): boolean => {
              return getComputedStyle(element).visibility === "visible";
            })
            .map((element: Element) => {
              return {
                text: element.textContent || "",
                hyphens: getComputedStyle(element).hyphens,
                lang: element.getAttribute("lang") || "",
              };
            });
        },
      );

    // Benachrichtigungsprotokolle, as the section's heading and its entry.
    const long: Array<{ text: string; hyphens: string; lang: string }> =
      hyphens.filter((title: { text: string }): boolean => {
        return title.text === "Benachrichtigungsprotokolle";
      });
    expect(long).toHaveLength(2);
    for (const title of long) {
      expect(title).toEqual({
        text: "Benachrichtigungsprotokolle",
        hyphens: "auto",
        lang: "de",
      });
    }

    // Every other title is German too, and never hyphenated.
    const others: Array<{ text: string; hyphens: string; lang: string }> =
      hyphens.filter((title: { text: string }): boolean => {
        return title.text !== "Benachrichtigungsprotokolle";
      });
    expect(others.length).toBeGreaterThan(5);
    expect(
      others.filter((title: { hyphens: string }): boolean => {
        return title.hyphens === "auto";
      }),
    ).toEqual([]);
  });
});
