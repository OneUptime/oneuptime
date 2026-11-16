import { expect, Locator, Page, Response, test } from "@playwright/test";
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
 * This reads those lines in every script the page loads, entry and chunks,
 * wherever its fixture serves them (/dist/, or /app/ for the Dashboard
 * widget fixtures), so it sees a locale wherever the build put it. A
 * chunk's name would not do: a page's translated docs are "de-<hash>.js"
 * chunks too.
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
  // The bytes of every script the page loaded.
  scriptBytes: () => Promise<number>;
  /*
   * The bytes of every script but the chunks that hold `language`'s locale
   * alone: what the fixture itself weighs on a page drawn in it.
   */
  scriptBytesBesideLocale: (language: string) => Promise<number>;
}

interface ScriptRead {
  languages: Array<string>;
  bytes: number;
}

function sumOfBytes(reads: Array<ScriptRead>): number {
  return reads.reduce((sum: number, read: ScriptRead): number => {
    return sum + read.bytes;
  }, 0);
}

// Starts reading every script the page loads, from now on.
export function watchDashboardLocales(page: Page): LocaleWatch {
  const reads: Array<Promise<ScriptRead>> = [];

  page.on("response", (response: Response): void => {
    if (response.request().resourceType() !== "script") {
      return;
    }

    reads.push(
      response.text().then(
        (script: string): ScriptRead => {
          return {
            languages: dashboardLocalesIn(script).filter(
              (language: string): boolean => {
                return language !== "en";
              },
            ),
            bytes: script.length,
          };
        },
        (): ScriptRead => {
          // A page that navigated away before the body came read nothing.
          return { languages: [], bytes: 0 };
        },
      ),
    );
  });

  return {
    languages: async (): Promise<Array<string>> => {
      return (await Promise.all(reads)).flatMap(
        (read: ScriptRead): Array<string> => {
          return read.languages;
        },
      );
    },
    scriptBytes: async (): Promise<number> => {
      return sumOfBytes(await Promise.all(reads));
    },
    scriptBytesBesideLocale: async (language: string): Promise<number> => {
      return sumOfBytes(
        (await Promise.all(reads)).filter((read: ScriptRead): boolean => {
          return !(
            read.languages.length > 0 &&
            read.languages.every((held: string): boolean => {
              return held === language;
            })
          );
        }),
      );
    },
  };
}

/*
 * What a fixture's scripts may weigh on a page, its language's own chunk
 * aside: 5 to 30 MB of the Dashboard's components once no locale but
 * English is in them (AiInsights' are 29 MB). A locale's whole words would
 * add 6 to 10 MB each, and the check of which locales a page loaded catches
 * those first; this is the ceiling past which a fixture has grown by more
 * than its pages. A locale's chunk is not counted: it is the 5 to 9 MB of
 * words the page is drawn in. (Through the JSON loader an unminified one
 * was 17 to 28 MB, until #8650 shipped it as one default export, written in
 * UTF-8.)
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
 * an English page none, and its scripts, that locale's chunk aside, stay
 * inside the budget.
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
    await watch.scriptBytesBesideLocale(language),
    `the scripts a page in "${language}" loaded, its locale's chunk aside, in bytes`,
  ).toBeLessThan(LOCALE_FREE_PAGE_BUDGET_BYTES);
}

export interface PageLanguagesBlock {
  // The languages the fixture draws besides English, each by its ?lang= code.
  languages: Array<string>;
  // A page of the fixture in a language: its ?lang=, or none for English.
  address: (language: string) => string;
  /*
   * What shows once the page is drawn: the page's first element, unless
   * given. A fixture draws only once its language has loaded.
   */
  ready?: ((page: Page, language: string) => Locator) | undefined;
}

/*
 * A suite's block of checks that each page loads its own language alone,
 * English and every language the fixture draws, in each of the suite's
 * projects. (Skipped from inside a test, a phone project's run would leave
 * the page blank for the suite's own afterEach, which reads the page.)
 */
export function describePageLanguages(block: PageLanguagesBlock): void {
  test.describe("the page's language, loaded as the Dashboard loads it", () => {
    for (const language of ["en", ...block.languages]) {
      test(`a page in ${language} loads its own locale and no other`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await expectPageLoadsOnlyItsLanguage(
          page,
          {
            address: block.address,
            ready:
              block.ready ||
              ((shown: Page): Locator => {
                return shown.locator("#root > *").first();
              }),
          },
          language,
        );
      });
    }
  });
}
