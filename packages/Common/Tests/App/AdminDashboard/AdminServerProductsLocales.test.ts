import {
  PRESET_DESCRIPTIONS,
  ServerProductsCopy,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Products/ServerProductsCopy";
import {
  PRODUCT_CATEGORIES,
  ProductCategory,
  getProductTitle,
} from "../../../Types/Product/ProductCatalog";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  PRESET_TITLES,
  SERVER_PRODUCTS_PRESETS,
  SWITCHABLE_PRODUCTS,
} from "../../../Types/Product/ServerProducts";
import { PluralTemplate } from "../../../Types/Translator";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ADMIN DASHBOARD > SETTINGS > PRODUCTS IN EVERY LANGUAGE (#6815).
 *
 * Every sentence the page draws, every preset, every product it lists and
 * every category it groups them under is a key of each of the Admin
 * Dashboard's locales, translated (not left in English, but for names a
 * language writes as English does), with its {{placeholders}} kept - so the
 * page reads in the admin's language from its first line to its last.
 */

const LOCALES_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIRECTORY)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  })
  .sort();

const read: (language: string) => Record<string, unknown> = (
  language: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
};

const isPlural: (value: unknown) => value is PluralTemplate = (
  value: unknown,
): value is PluralTemplate => {
  return (
    typeof value === "object" &&
    value !== null &&
    "one" in (value as Record<string, unknown>) &&
    "other" in (value as Record<string, unknown>)
  );
};

// Each key the page looks up, with the English it stands for.
const SENTENCES: Array<{ key: string; english: string }> = [];

for (const value of Object.values(ServerProductsCopy)) {
  if (isPlural(value)) {
    SENTENCES.push({ key: value.other, english: value.other });
    SENTENCES.push({ key: `${value.other}_one`, english: value.one });
  } else {
    SENTENCES.push({ key: value, english: value });
  }
}

for (const preset of SERVER_PRODUCTS_PRESETS) {
  SENTENCES.push({
    key: PRESET_TITLES[preset],
    english: PRESET_TITLES[preset],
  });
  SENTENCES.push({
    key: PRESET_DESCRIPTIONS[preset],
    english: PRESET_DESCRIPTIONS[preset],
  });
}

// The products and categories the page lists, by their English names.
const NAMES: Array<string> = [
  ...SWITCHABLE_PRODUCTS.map((product: ProductKey): string => {
    return getProductTitle(product);
  }),
  ...PRODUCT_CATEGORIES.filter((category: ProductCategory): boolean => {
    return category.title !== "Settings";
  }).map((category: ProductCategory): string => {
    return category.title;
  }),
];

const placeholders: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return Array.from(text.matchAll(/\{\{\s*(\w+)\s*\}\}/g))
    .map((match: RegExpMatchArray): string => {
      return match[1] as string;
    })
    .sort();
};

describe("Settings > Products in every language", () => {
  test("every Admin Dashboard language is checked", () => {
    expect(LANGUAGES).toContain("en");
    expect(LANGUAGES.length).toBe(18);
  });

  test.each(LANGUAGES)(
    "%s has every sentence of the page, with its placeholders",
    (language: string) => {
      const locale: Record<string, unknown> = read(language);

      for (const sentence of SENTENCES) {
        const value: unknown = locale[sentence.key];

        expect({
          key: sentence.key,
          isText: typeof value === "string",
        }).toEqual({ key: sentence.key, isText: true });
        expect({
          key: sentence.key,
          placeholders: placeholders(value as string),
        }).toEqual({
          key: sentence.key,
          placeholders: placeholders(sentence.english),
        });

        if (language === "en") {
          expect(value).toBe(sentence.english);
        }
      }
    },
  );

  test.each(
    LANGUAGES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "%s translates the page's sentences, not leaving them in English",
    (language: string) => {
      const locale: Record<string, unknown> = read(language);
      const untranslated: Array<string> = SENTENCES.filter(
        (sentence: { key: string; english: string }): boolean => {
          // A word some languages write as English does ("Everything" in none).
          return (
            sentence.english.split(" ").length > 2 &&
            locale[sentence.key] === sentence.english
          );
        },
      ).map((sentence: { key: string }): string => {
        return sentence.key;
      });

      expect(untranslated).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "%s names every product and category the page lists",
    (language: string) => {
      const locale: Record<string, unknown> = read(language);

      for (const name of NAMES) {
        expect({ name, value: typeof locale[name] }).toEqual({
          name,
          value: "string",
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s has the side menu entry and the trail's word",
    (language: string) => {
      const locale: Record<string, unknown> = read(language);
      const sideMenu: Record<string, unknown> = locale["sideMenu"] as Record<
        string,
        unknown
      >;
      const breadcrumbs: Record<string, unknown> = locale[
        "breadcrumbs"
      ] as Record<string, unknown>;

      expect(typeof sideMenu["settingsProducts"]).toBe("string");
      expect(typeof breadcrumbs["products"]).toBe("string");
      expect(sideMenu["settingsProducts"]).toBe(breadcrumbs["products"]);

      if (language === "en") {
        expect(sideMenu["settingsProducts"]).toBe("Products");
      }
    },
  );
});
