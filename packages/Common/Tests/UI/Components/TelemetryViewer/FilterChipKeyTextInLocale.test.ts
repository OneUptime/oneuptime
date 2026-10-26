import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  EXCLUDED_CHIP_KEY_TEMPLATE,
  getFilterChipKeyText,
} from "../../../../UI/Components/TelemetryViewer/components/TelemetryActiveFilterChips";
import {
  Translator,
  createTranslator,
} from "../../../../UI/Utils/TranslateTemplate";

/*
 * An exclusion chip says it excludes in words, in the reader's language:
 * "Severity is not: Debug", "Schweregrad ist nicht: Debug". Every explorer
 * shares the chip (logs, traces, metrics, exceptions, Security Events), so
 * one sentence for all of them, with the field's name translated when it is
 * one of the product's own ("Severity") and as written when it is an
 * attribute (device.hostname). An include chip reads as the field's name.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function translatorFor(code: string): Translator {
  const locale: Record<string, unknown> = readLocale(code);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = locale[text];

    return typeof value === "string" ? value : undefined;
  }, code);
}

const LANGUAGES: ReadonlyArray<string> = [
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

describe("an exclusion chip's key", () => {
  test("reads the English sentence in English", () => {
    expect(getFilterChipKeyText("Severity", true, translatorFor("en"))).toBe(
      "Severity is not",
    );
    expect(getFilterChipKeyText("Severity", false, translatorFor("en"))).toBe(
      "Severity",
    );
  });

  test("is one German sentence, the field's name in German", () => {
    const german: Translator = translatorFor("de");

    expect(getFilterChipKeyText("Severity", true, german)).toBe(
      "Schweregrad ist nicht",
    );
    // A field's name the locale words is translated with the sentence.
    expect(getFilterChipKeyText("service", true, german)).toBe(
      "Dienst ist nicht",
    );
  });

  test("keeps an attribute's name as written, inside the sentence", () => {
    expect(
      getFilterChipKeyText("device.hostname", true, translatorFor("fr")),
    ).toBe("device.hostname n'est pas");
    expect(
      getFilterChipKeyText("device.hostname", true, translatorFor("ja")),
    ).toBe("device.hostname（除外）");
  });

  test("an include chip reads as the field's name, translated", () => {
    expect(getFilterChipKeyText("Severity", false, translatorFor("ru"))).toBe(
      readLocale("ru")["Severity"],
    );
    // Not a sentence: no "is not" for a chip that includes.
    expect(
      getFilterChipKeyText("Severity", false, translatorFor("de")),
    ).not.toContain("nicht");
  });

  test.each(LANGUAGES)(
    "is a sentence of %s, with the field in it",
    (code: string) => {
      const template: unknown = readLocale(code)[EXCLUDED_CHIP_KEY_TEMPLATE];

      expect(typeof template).toBe("string");
      expect(template).not.toBe(EXCLUDED_CHIP_KEY_TEMPLATE);
      expect(template as string).toContain("{{field}}");

      const text: string = getFilterChipKeyText(
        "device.hostname",
        true,
        translatorFor(code),
      );

      expect(text).toContain("device.hostname");
      expect(text).not.toMatch(/\bis not\b/);
    },
  );
});
