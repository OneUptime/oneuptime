import { GeneratedKeyFieldText } from "../../../../UI/Components/Forms/Fields/GeneratedKeyField";
import { MEASUREMENT_KEY_INVALID_MESSAGE } from "../../../../Types/Measurement/MeasurementKey";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The words a key made from the name draws itself ("Made from the name",
 * "Edit", "Make it from the name") and the message under a key someone
 * typed that the server would refuse, in every dashboard language.
 *
 * The dashboard looks every string up in its locale files by its English
 * text, and a string with no entry silently stays English. This holds every
 * one of them to all seventeen files, and the component to drawing no text
 * that skips the lookup.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const COMPONENT_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "UI",
  "Components",
  "Forms",
  "Fields",
  "GeneratedKeyField.tsx",
);

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

type ReadLocaleFunction = (locale: string) => Record<string, string>;

const readLocale: ReadLocaleFunction = (
  locale: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  );
};

const ENGLISH: Record<string, string> = readLocale("en");

const STRINGS: Array<string> = [
  ...Object.values(GeneratedKeyFieldText),
  MEASUREMENT_KEY_INVALID_MESSAGE,
];

// "Edit" was translated long before this field used it.
const NEW_STRINGS: Array<string> = STRINGS.filter((text: string) => {
  return text !== GeneratedKeyFieldText.edit;
});

describe("a key made from the name, in every dashboard language", () => {
  test("the strings are the field's own, so the checks below are not vacuous", () => {
    expect(STRINGS).toEqual(
      expect.arrayContaining([
        "Edit",
        "Made from the name",
        "Make it from the name",
        "Use lowercase letters (a-z), numbers and hyphens, starting with a letter or a number, at most 50 characters.",
      ]),
    );
  });

  test("there are seventeen locale files", () => {
    const files: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string) => {
        return file.endsWith(".json");
      });

    expect(files.sort()).toEqual(
      ["en", ...OTHER_LOCALES]
        .map((locale: string) => {
          return `${locale}.json`;
        })
        .sort(),
    );
  });

  test("English maps every string to itself", () => {
    for (const text of STRINGS) {
      expect({ text, english: ENGLISH[text] }).toEqual({ text, english: text });
    }
  });

  test.each(OTHER_LOCALES)("%s translates every string", (locale: string) => {
    const translations: Record<string, string> = readLocale(locale);

    for (const text of STRINGS) {
      const translated: string | undefined = translations[text];

      expect({ locale, text, has: typeof translated === "string" }).toEqual({
        locale,
        text,
        has: true,
      });
      expect((translated || "").trim().length).toBeGreaterThan(0);
    }

    for (const text of NEW_STRINGS) {
      // Translated, not copied across.
      expect({ locale, text, same: translations[text] === text }).toEqual({
        locale,
        text,
        same: false,
      });
    }
  });

  test("the message keeps its a-z and its fifty in every language", () => {
    for (const locale of OTHER_LOCALES) {
      const translated: string = readLocale(locale)[
        MEASUREMENT_KEY_INVALID_MESSAGE
      ]!;

      expect({ locale, az: translated.includes("a-z") }).toEqual({
        locale,
        az: true,
      });
      expect({
        locale,
        fifty: /50|۵۰/.test(translated),
      }).toEqual({ locale, fifty: true });
    }
  });

  test("the field draws its words through the translation lookup, never as bare text", () => {
    const code: string = fs
      .readFileSync(COMPONENT_PATH, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

    for (const text of Object.values(GeneratedKeyFieldText)) {
      // Defined once, in GeneratedKeyFieldText; never written into the JSX.
      expect({
        text,
        occurrences: code.split(`"${text}"`).length - 1,
      }).toEqual({ text, occurrences: 1 });
      expect(code.includes(`>${text}<`)).toBe(false);
    }

    for (const key of Object.keys(GeneratedKeyFieldText)) {
      expect(code).toContain(`translate(GeneratedKeyFieldText.${key})`);
    }
  });
});
