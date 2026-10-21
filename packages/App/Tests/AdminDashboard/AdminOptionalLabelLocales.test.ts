import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE ADMIN DASHBOARD MARKS AN OPTIONAL FIELD IN THE READER'S LANGUAGE.
 *
 * A form field that is not required has "(Optional)" after its title
 * (Common/UI/Components/Forms/Fields/FieldLabel), looked up by its English
 * text in the app's own locale. The Dashboard's locales had the entry and
 * the Admin Dashboard's did not, so every optional field of an Admin form -
 * Twilio SMS Phone Numbers and Twilio Secondary Phone Numbers under Settings
 * > Call and SMS > More fields, among others - read "(Optional)" in English
 * beside a translated title, in all 16 other languages. Each Admin locale
 * now words it as the same language's Dashboard locale does: the two
 * dashboards mark an optional field alike.
 */

const FEATURE_SET: string = path.join(__dirname, "..", "..", "FeatureSet");
const ADMIN_LOCALES: string = path.join(
  FEATURE_SET,
  "AdminDashboard",
  "src",
  "Locales",
);
const DASHBOARD_LOCALES: string = path.join(
  FEATURE_SET,
  "Dashboard",
  "src",
  "Locales",
);
const FIELD_LABEL: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
  "Components",
  "Forms",
  "Fields",
  "FieldLabel.tsx",
);

const OPTIONAL: string = "(Optional)";

const LANGUAGES: ReadonlyArray<string> = [
  "en",
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

// German writes the word as English does: "(Optional)".
const SAME_AS_ENGLISH: ReadonlyArray<string> = ["en", "de"];

function readLocale(folder: string, language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(folder, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

describe("the Admin Dashboard's (Optional)", () => {
  test("is the entry the field label looks up", () => {
    const source: string = fs.readFileSync(FIELD_LABEL, "utf8");

    expect(source).toContain(`translateString("${OPTIONAL}")`);
  });

  test("covers every language both dashboards are drawn in", () => {
    for (const folder of [ADMIN_LOCALES, DASHBOARD_LOCALES]) {
      expect(
        fs
          .readdirSync(folder)
          .filter((file: string): boolean => {
            return file.endsWith(".json");
          })
          .map((file: string): string => {
            return file.slice(0, -".json".length);
          })
          .sort(),
      ).toEqual([...LANGUAGES].sort());
    }
  });

  test.each(LANGUAGES)(
    "reads in %s as the Dashboard's does",
    (language: string) => {
      const admin: unknown = readLocale(ADMIN_LOCALES, language)[OPTIONAL];
      const dashboard: unknown = readLocale(DASHBOARD_LOCALES, language)[
        OPTIONAL
      ];

      expect({ language, admin }).toEqual({ language, admin: dashboard });
      expect(typeof admin).toBe("string");
      // Translated, unless the language writes it as English does.
      expect({
        language,
        inItsOwnWords: SAME_AS_ENGLISH.includes(language) || admin !== OPTIONAL,
      }).toEqual({ language, inItsOwnWords: true });
    },
  );
});
