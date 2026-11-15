import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ADMIN_DASHBOARD_DIRECTORY,
  ADMIN_DASHBOARD_ENGLISH,
  ADMIN_DASHBOARD_PROGRESS_DIRECTORY,
  readAdminDashboardLocale,
  readAdminDashboardSameAsEnglish,
} from "Common/Tests/Helpers/AdminDashboardLocales";
import { ADMIN_DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import {
  getPluralOneFormKeys,
  RuntimeLocaleTree,
  usesPluralOneForm,
} from "Common/UI/esbuild-locales";

/*
 * THE ADMIN DASHBOARD WORDS A PLURAL'S ONE FORM WHEREVER IT WORDS THE
 * GENERAL FORM (#8068).
 *
 * A plural's "_one" form that reads exactly as English's is English left in
 * the locale (isEnglishPlaceholder, Common/Types/Translator): the sentence is
 * read in English, in English's form for the count. So a language that words
 * "{{count}} monitors" as "{{count}} monitores" and leaves "{{count}}
 * monitor" for one says English's "0 monitors" at 0 - Portuguese counts 0 as
 * one. Unless the language words its one form as English does on purpose,
 * and says so: its same-as-English list (AdminDashboard/i18n/Progress/
 * <code>.json) names the form, and the build ships a mark beside it that
 * the lookup reads as the language's own (esbuild.config.js, Common/UI/
 * esbuild-locales.js).
 *
 * The Dashboard holds its locales to the same rule (Tests/Dashboard/
 * DashboardLocalesGuard, "a plural's one form").
 */

const english: RuntimeLocaleTree = readAdminDashboardLocale(
  ADMIN_DASHBOARD_ENGLISH,
);
const ONE_SUFFIX: string = "_one";
const LETTER: RegExp = /\p{L}/u;

// A text with no letters of its own reads the same in every language.
const hasNoLetters: (text: string) => boolean = (text: string): boolean => {
  return !LETTER.test(text.replace(/\{\{[^{}]*\}\}/g, ""));
};

const readsOneForm: Array<string> = ADMIN_DASHBOARD_LANGUAGES.filter(
  (code: string): boolean => {
    return usesPluralOneForm(code);
  },
);

const oneKeys: Array<string> = getPluralOneFormKeys(english);

/*
 * The one forms `locale` leaves English beside a worded general form, as the
 * list `kept` vouches for its forms.
 */
const oneFormsLeftInEnglish: (
  locale: RuntimeLocaleTree,
  kept: ReadonlyArray<string>,
) => Array<string> = (
  locale: RuntimeLocaleTree,
  kept: ReadonlyArray<string>,
): Array<string> => {
  const isWorded: (value: unknown, englishText: string) => boolean = (
    value: unknown,
    englishText: string,
  ): boolean => {
    return (
      typeof value === "string" &&
      (value !== englishText ||
        hasNoLetters(englishText) ||
        kept.includes(englishText))
    );
  };

  return oneKeys.filter((oneKey: string): boolean => {
    const base: string = oneKey.slice(0, -ONE_SUFFIX.length);
    const general: unknown = locale[base];
    const one: unknown = locale[oneKey];

    if (!isWorded(general, english[base] as string)) {
      return false;
    }

    // Worded alike for every count: the form is the language's own.
    if (one === general) {
      return false;
    }

    return !isWorded(one, english[oneKey] as string);
  });
};

describe("a plural's one form in the Admin Dashboard", () => {
  test("the plurals and the languages that read one forms are there", () => {
    expect(oneKeys.length).toBeGreaterThan(50);
    expect(oneKeys).toEqual(
      expect.arrayContaining([
        "{{count}} monitors_one",
        "{{count}} people_one",
        "{{count}} projects_one",
        "{{count}} products_one",
        "{{count}} minutes_one",
      ]),
    );
    expect(readsOneForm).toEqual(
      expect.arrayContaining(["de", "fr", "pt", "nl", "da", "ru", "hi", "fa"]),
    );
    expect(readsOneForm).not.toContain("ja");
    expect(readsOneForm).not.toContain("zh-CN");
  });

  test.each(readsOneForm)(
    "%s words its one form wherever it words the general form",
    (code: string) => {
      expect({
        locale: code,
        leftInEnglish: oneFormsLeftInEnglish(
          readAdminDashboardLocale(code),
          readAdminDashboardSameAsEnglish(code),
        ),
      }).toEqual({ locale: code, leftInEnglish: [] });
    },
  );

  /*
   * The guard sees what #8068 found: without its list, each language names
   * the forms it words as English does - so a form dropped from a list
   * fails above, by its language and key.
   */
  test("without the lists, the guard names the ten forms #8068 found", () => {
    const found: Array<string> = [];

    for (const code of readsOneForm) {
      for (const key of oneFormsLeftInEnglish(
        readAdminDashboardLocale(code),
        [],
      )) {
        found.push(`${code} ${key}`);
      }
    }

    expect(found.sort()).toEqual(
      [
        "da {{count}} monitors_one",
        "da {{count}} people_one",
        "es {{count}} monitors_one",
        "nl {{count}} products_one",
        "nl {{count}} projects_one",
        "no {{count}} monitors_one",
        "no {{count}} people_one",
        "pt {{count}} monitors_one",
        "sv {{count}} monitors_one",
        "sv {{count}} people_one",
      ].sort(),
    );
  });

  // A one form put back in English beside its worded general form is named.
  test("a one form left in English is named", () => {
    const portuguese: RuntimeLocaleTree = {
      ...readAdminDashboardLocale("pt"),
      "{{count}} people_one": "{{count}} person",
    };

    expect(
      oneFormsLeftInEnglish(portuguese, readAdminDashboardSameAsEnglish("pt")),
    ).toEqual(["{{count}} people_one"]);
  });
});

/*
 * The lists: one file per language that reads a one form, holding the English
 * of the one forms the language words as English does - each still worded
 * so in its file, so a list vouches for nothing it no longer needs to.
 */
describe("the Admin Dashboard's same-as-English lists", () => {
  const files: Array<string> = fs
    .readdirSync(ADMIN_DASHBOARD_PROGRESS_DIRECTORY)
    .sort();

  test("each list is a language's that reads a one form", () => {
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      expect([file, file.endsWith(".json")]).toEqual([file, true]);

      const code: string = file.slice(0, -".json".length);

      expect([code, readsOneForm.includes(code)]).toEqual([code, true]);
    }
  });

  test.each(
    fs
      .readdirSync(ADMIN_DASHBOARD_PROGRESS_DIRECTORY)
      .sort()
      .map((file: string): string => {
        return file.slice(0, -".json".length);
      }),
  )(
    "%s's list is sorted, has no repeats, and names one forms its file words as English does",
    (code: string) => {
      const text: string = fs.readFileSync(
        path.join(ADMIN_DASHBOARD_PROGRESS_DIRECTORY, `${code}.json`),
        "utf8",
      );
      const parsed: { sameAsEnglish?: unknown } = JSON.parse(text) as {
        sameAsEnglish?: unknown;
      };

      expect(Object.keys(parsed)).toEqual(["sameAsEnglish"]);
      expect(Array.isArray(parsed.sameAsEnglish)).toBe(true);

      const list: Array<string> = parsed.sameAsEnglish as Array<string>;

      expect(list.length).toBeGreaterThan(0);
      expect(
        list.every((entry: unknown): boolean => {
          return typeof entry === "string";
        }),
      ).toBe(true);
      expect(list).toEqual([...list].sort());
      expect(new Set(list).size).toBe(list.length);

      const locale: RuntimeLocaleTree = readAdminDashboardLocale(code);
      const vouchesForNothing: Array<string> = list.filter(
        (entry: string): boolean => {
          return !oneKeys.some((oneKey: string): boolean => {
            return english[oneKey] === entry && locale[oneKey] === entry;
          });
        },
      );

      expect({ locale: code, vouchesForNothing: vouchesForNothing }).toEqual({
        locale: code,
        vouchesForNothing: [],
      });
    },
  );
});

/*
 * The build reads the lists: the Admin Dashboard's esbuild.config.js hands
 * them to the locales plugin, pointed at the directory Utils/i18n.ts
 * bundles every locale from, and ships each locale whole.
 */
describe("the Admin Dashboard's build marks the forms its lists name", () => {
  const collapse: (text: string) => string = (text: string): string => {
    return text.replace(/\s+/g, " ");
  };

  test("esbuild.config.js passes the lists to the locales plugin", () => {
    const config: string = collapse(
      fs.readFileSync(
        path.join(ADMIN_DASHBOARD_DIRECTORY, "esbuild.config.js"),
        "utf8",
      ),
    );

    expect(config).toContain('require("Common/UI/esbuild-locales")');
    expect(config).toMatch(
      /additionalPlugins: \[ createRuntimeLocalesPlugin\(\{ localesDirectory: path\.join\(__dirname, "src", "Locales"\), fallbackLanguage: "en", progressDirectory: path\.join\(__dirname, "i18n", "Progress"\), shipsWholeLocales: true, \}\), \]/,
    );
    expect(fs.existsSync(ADMIN_DASHBOARD_PROGRESS_DIRECTORY)).toBe(true);
  });

  test("Utils/i18n.ts bundles every locale from the directory the plugin reads", () => {
    const i18n: string = fs.readFileSync(
      path.join(ADMIN_DASHBOARD_DIRECTORY, "src", "Utils", "i18n.ts"),
      "utf8",
    );

    for (const code of [
      ADMIN_DASHBOARD_ENGLISH,
      ...ADMIN_DASHBOARD_LANGUAGES,
    ]) {
      expect([code, i18n.includes(`from "../Locales/${code}.json";`)]).toEqual([
        code,
        true,
      ]);
    }
  });
});
