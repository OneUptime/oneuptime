import { expect, Locator, Page, Response } from "@playwright/test";
import fs from "fs";
import path from "path";

/*
 * Which of the Dashboard's locales a fixture's page loaded (#8366).
 *
 * A fixture builds its locales as the Dashboard ships them
 * (SuiteHelpers/FixtureLocalesBuild.js) and loads only the language its
 * page is drawn in (SuiteHelpers/FixtureLocales.js): English in its entry,
 * each other language a chunk of its own. A fixture that imported German
 * and Persian whole put 13 MB of them into its entry, and every page of
 * every test loaded both.
 *
 * The fixtures are built unminified, so esbuild heads each module it
 * bundles with its path: "// ../../App/FeatureSet/Dashboard/src/Locales/de.json".
 * This reads those lines in every script the page loads from /dist/, entry
 * and chunks, so it sees a locale wherever the build put it. A chunk's name
 * would not do: a page's translated docs are "de-<hash>.js" chunks too.
 */

const LOCALE_MODULE_LINE: RegExp =
  /^\/\/ [^\n]*FeatureSet\/Dashboard\/src\/Locales\/([A-Za-z-]+)\.json$/gm;

// The Dashboard locales a script holds, in the order the build put them.
export function dashboardLocalesIn(script: string): Array<string> {
  return Array.from(script.matchAll(LOCALE_MODULE_LINE)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

export interface LocaleWatch {
  /*
   * The Dashboard locales the page's scripts held, English aside, in the
   * order loaded, once every script seen so far has been read.
   */
  languages: () => Promise<Array<string>>;
  // The bytes of every script the page loaded from /dist/.
  scriptBytes: () => Promise<number>;
}

// Starts reading every script the page loads from /dist/, from now on.
export function watchDashboardLocales(page: Page): LocaleWatch {
  const reads: Array<Promise<{ languages: Array<string>; bytes: number }>> = [];

  page.on("response", (response: Response): void => {
    const pathname: string = new URL(response.url()).pathname;

    if (!pathname.startsWith("/dist/") || !pathname.endsWith(".js")) {
      return;
    }

    reads.push(
      response.text().then(
        (script: string): { languages: Array<string>; bytes: number } => {
          return {
            languages: dashboardLocalesIn(script).filter(
              (language: string): boolean => {
                return language !== "en";
              },
            ),
            bytes: script.length,
          };
        },
        (): { languages: Array<string>; bytes: number } => {
          // A page that navigated away before the body came read nothing.
          return { languages: [], bytes: 0 };
        },
      ),
    );
  });

  return {
    languages: async (): Promise<Array<string>> => {
      return (await Promise.all(reads)).flatMap(
        (read: { languages: Array<string> }): Array<string> => {
          return read.languages;
        },
      );
    },
    scriptBytes: async (): Promise<number> => {
      return (await Promise.all(reads)).reduce(
        (sum: number, read: { bytes: number }): number => {
          return sum + read.bytes;
        },
        0,
      );
    },
  };
}

/*
 * What every page of a fixture's scripts may weigh, at most, once it loads
 * no locale it is not drawn in: a fixture's entry is 10 to 25 MB of the
 * Dashboard's components, and a locale chunk 4 to 7 MB more.
 */
export const LOCALE_FREE_PAGE_BUDGET_BYTES: number = 40 * 1024 * 1024;

const DASHBOARD_LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Dashboard/src/Locales",
);

const readLocales: Map<string, Record<string, unknown>> = new Map();

/*
 * The Dashboard's words for `english` in `language`, as its locale file has
 * them: what a page drawn in that language shows, once its locale loaded.
 */
export function dashboardWord(language: string, english: string): string {
  if (language === "en") {
    return english;
  }

  if (!readLocales.has(language)) {
    readLocales.set(
      language,
      JSON.parse(
        fs.readFileSync(
          path.join(DASHBOARD_LOCALES, `${language}.json`),
          "utf8",
        ),
      ) as Record<string, unknown>,
    );
  }

  const words: unknown = readLocales.get(language)![english];

  return typeof words === "string" && words ? words : english;
}

export interface PageLanguageCheck {
  // The page's address in a language: the fixture's ?lang=, or none for English.
  address: (language: string) => string;
  // What shows once the page is drawn, in that language's words.
  ready: (page: Page, language: string) => Locator;
}

/*
 * The page drawn in `language` loads that language's locale and no other,
 * an English page none, and its scripts stay inside the budget.
 */
export async function expectPageLoadsOnlyItsLanguage(
  page: Page,
  check: PageLanguageCheck,
  language: string,
): Promise<void> {
  const watch: LocaleWatch = watchDashboardLocales(page);

  await page.goto(check.address(language));
  await expect(check.ready(page, language)).toBeVisible({ timeout: 60000 });

  expect(
    await watch.languages(),
    `the Dashboard locales a page in "${language}" loaded`,
  ).toEqual(language === "en" ? [] : [language]);
  expect(
    await watch.scriptBytes(),
    `the scripts a page in "${language}" loaded, in bytes`,
  ).toBeLessThan(LOCALE_FREE_PAGE_BUDGET_BYTES);
}
