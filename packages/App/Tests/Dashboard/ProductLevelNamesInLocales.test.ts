import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { PRODUCT_LEVEL_PERMISSION_VALUES } from "Common/Types/Product/ProductLevels";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import { PRODUCT_LEVEL_NAMES } from "../../FeatureSet/Dashboard/src/Components/Permission/ProductLevelNames";
import { ROLE_NAMES } from "../../FeatureSet/Dashboard/src/Components/Permission/RoleCardSelectOptions";
import { PRODUCT_ACCESS_WORDS } from "../../FeatureSet/Dashboard/src/Components/Team/TeamProductAccessWords";

/*
 * THE PRODUCT LEVELS' NAMES, AND THE PRODUCT ACCESS CARD'S WORDS, IN EVERY
 * DASHBOARD LANGUAGE (#10289).
 *
 * A product's level ("Cloud Admin", "Network Viewer") is drawn where a
 * built-in role is: the team and API key permission tables, the Add
 * Permission picker, and the "You need one of these permissions" sentences,
 * which name a level as they name a role. Its name is a key of its own
 * (Components/Permission/ProductLevelNames), as a role's is (ROLE_NAMES),
 * so it is held the way the roles' names are (TranslationBacklogLocales):
 * one key for every level, named as Common/Types/Permission titles it;
 * worded in every language; and no two levels, nor a level and a role,
 * reading the same in one language - a Spanish team table that said
 * "Administrador" for both Cloud's and Network's admin would name two
 * grants alike.
 *
 * The Product Access card that gives the levels reads in every language
 * too: its title, its description, the levels' descriptions, the notes
 * under a product's name and its buttons.
 */

const DASHBOARD: string = path.resolve(__dirname, "../../FeatureSet/Dashboard");
const LOCALES: string = path.join(DASHBOARD, "src", "Locales");
const I18N: string = path.join(DASHBOARD, "i18n");

const LANGUAGES: ReadonlyArray<string> = [...DASHBOARD_LANGUAGES];

type Locale = Record<string, unknown>;

const localeCache: Map<string, Locale> = new Map<string, Locale>();

function readLocale(code: string): Locale {
  const cached: Locale | undefined = localeCache.get(code);

  if (cached) {
    return cached;
  }

  const locale: Locale = JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Locale;
  localeCache.set(code, locale);

  return locale;
}

function valueOf(code: string, key: string): string | undefined {
  const value: unknown = readLocale(code)[key];

  return typeof value === "string" ? value : undefined;
}

// What a language words as English does on purpose, every language's and its own.
function sameAsEnglishIn(code: string): Array<string> {
  const everyLanguage: Array<string> = JSON.parse(
    fs.readFileSync(path.join(I18N, "SameAsEnglish.json"), "utf8"),
  ) as Array<string>;
  const own: Array<string> =
    (
      JSON.parse(
        fs.readFileSync(path.join(I18N, "Progress", `${code}.json`), "utf8"),
      ) as { sameAsEnglish?: Array<string> }
    ).sameAsEnglish || [];

  return [...everyLanguage, ...own];
}

function untranslatedIn(
  code: string,
  words: ReadonlyArray<string>,
): Array<string> {
  const same: Array<string> = sameAsEnglishIn(code);

  return words.filter((word: string): boolean => {
    const value: string | undefined = valueOf(code, word);

    return !value || (value === word && !same.includes(word));
  });
}

const LEVEL_NAMES: Array<string> = Object.values(PRODUCT_LEVEL_NAMES).map(
  (name: string | undefined): string => {
    return name || "";
  },
);

describe("the product levels' names", () => {
  test("are a key for every level, named as Common/Types/Permission titles it", () => {
    const named: Array<string> = PRODUCT_LEVEL_PERMISSION_VALUES.map(
      (permission: Permission): string => {
        return PRODUCT_LEVEL_NAMES[permission] || "";
      },
    );

    expect(named).toEqual(
      PRODUCT_LEVEL_PERMISSION_VALUES.map((permission: Permission): string => {
        return PermissionHelper.getTitle(permission);
      }),
    );
    expect(Object.keys(PRODUCT_LEVEL_NAMES)).toHaveLength(
      PRODUCT_LEVEL_PERMISSION_VALUES.length,
    );
  });

  test("are each a key of English, reading as itself", () => {
    for (const name of LEVEL_NAMES) {
      expect({ name, english: valueOf("en", name) }).toEqual({
        name,
        english: name,
      });
    }
  });

  test("never take a built-in role's name", () => {
    const roleNames: Set<string> = new Set<string>(
      Object.values(ROLE_NAMES) as Array<string>,
    );

    expect(
      LEVEL_NAMES.filter((name: string): boolean => {
        return roleNames.has(name);
      }),
    ).toEqual([]);
  });

  test.each(LANGUAGES)("are all translated in %s", (code: string) => {
    expect(untranslatedIn(code, LEVEL_NAMES)).toEqual([]);
  });

  test.each(LANGUAGES)(
    "name every level and every built-in role apart in %s: no two read the same",
    (code: string) => {
      const byValue: Map<string, Array<string>> = new Map<
        string,
        Array<string>
      >();

      for (const name of [
        ...LEVEL_NAMES,
        ...(Object.values(ROLE_NAMES) as Array<string>),
      ]) {
        const value: string = valueOf(code, name) || name;
        byValue.set(value, [...(byValue.get(value) || []), name]);
      }

      const shared: Array<Array<string>> = Array.from(byValue.values()).filter(
        (names: Array<string>): boolean => {
          return names.length > 1;
        },
      );

      expect(shared).toEqual([]);
    },
  );
});

describe("the Product Access card's words", () => {
  test("are each a key of English, reading as itself", () => {
    for (const word of PRODUCT_ACCESS_WORDS) {
      expect({ word, english: valueOf("en", word) }).toEqual({
        word,
        english: word,
      });
    }
  });

  test.each(LANGUAGES)("are all translated in %s", (code: string) => {
    expect(untranslatedIn(code, PRODUCT_ACCESS_WORDS)).toEqual([]);
  });
});
