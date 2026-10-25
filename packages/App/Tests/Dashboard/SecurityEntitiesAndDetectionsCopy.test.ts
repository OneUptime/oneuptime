import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DEFAULT_ENTITY_WINDOW_IN_DAYS,
  ENTITIES_EMPTY_DESCRIPTION,
  ENTITIES_EMPTY_TITLE,
  ENTITY_WINDOW_LABEL,
  OPEN_IN_CORRELATE,
  RISKIEST_ENTITIES_DESCRIPTION,
  getEntityWindowOptionValue,
  readEntityWindowOption,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEntitiesCopy";
import {
  DETECTION_RULES_EMPTY_DESCRIPTION,
  DETECTION_RULES_EMPTY_TITLE,
  OPEN_RULE_LIBRARY,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityDetectionsCopy";
import { TRANSLATED_LOCALES } from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import { isSaidInLocale, readDashboardLocale } from "./SecurityLocaleSentences";

/*
 * Security Events > Entities ranks what the findings name over a window the
 * shared switch picks, and says what an entity is in its card; an empty
 * Detection Rules list leads to the Rule Library. These are the React-free
 * parts: the windows as the switch's values, and the words.
 */

const ENTITY_WINDOWS_IN_DAYS: Array<number> = [1, 7, 30];

describe("the Riskiest Entities window", () => {
  test("opens on a week", () => {
    expect(DEFAULT_ENTITY_WINDOW_IN_DAYS).toBe(7);
  });

  test("each window is the switch's value, and reads back as itself", () => {
    for (const windowInDays of ENTITY_WINDOWS_IN_DAYS) {
      const value: string = getEntityWindowOptionValue(windowInDays);

      expect(value).toBe(String(windowInDays));
      expect(readEntityWindowOption(value, ENTITY_WINDOWS_IN_DAYS)).toBe(
        windowInDays,
      );
    }
  });

  test("a window the switch does not offer reads as a week", () => {
    for (const value of ["", "2", "365", "seven", "-1", "7.5"]) {
      expect(readEntityWindowOption(value, ENTITY_WINDOWS_IN_DAYS)).toBe(7);
    }
  });

  test("the page offers the windows the docs name: a day, a week and a month", () => {
    const page: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../FeatureSet/Dashboard/src/Pages/SecurityEvents/Entities.tsx",
      ),
      "utf8",
    );

    expect(page).toContain(
      "export const ENTITY_WINDOWS_IN_DAYS: Array<number> = [1, 7, 30];",
    );
  });
});

describe("the words", () => {
  const SENTENCES: Array<string> = [
    ENTITY_WINDOW_LABEL,
    RISKIEST_ENTITIES_DESCRIPTION,
    ENTITIES_EMPTY_TITLE,
    ENTITIES_EMPTY_DESCRIPTION,
    OPEN_IN_CORRELATE,
    DETECTION_RULES_EMPTY_TITLE,
    DETECTION_RULES_EMPTY_DESCRIPTION,
    OPEN_RULE_LIBRARY,
  ];

  test("say what an entity is, and where an empty rules list goes", () => {
    expect(RISKIEST_ENTITIES_DESCRIPTION).toContain(
      "users, hosts, addresses and files",
    );
    expect(RISKIEST_ENTITIES_DESCRIPTION).toContain("Correlate");
    expect(DETECTION_RULES_EMPTY_DESCRIPTION).toContain("Rule Library");
    // A heading: no full stop.
    expect(DETECTION_RULES_EMPTY_TITLE.endsWith(".")).toBe(false);
  });

  test("are in every Dashboard locale, said in the language", () => {
    for (const locale of TRANSLATED_LOCALES) {
      const entries: Record<string, unknown> = readDashboardLocale(locale);

      for (const sentence of SENTENCES) {
        expect([locale, sentence, typeof entries[sentence]]).toEqual([
          locale,
          sentence,
          "string",
        ]);
      }

      // The page's new sentences; the rest were translated before.
      for (const sentence of [
        ENTITY_WINDOW_LABEL,
        RISKIEST_ENTITIES_DESCRIPTION,
        ENTITIES_EMPTY_DESCRIPTION,
        DETECTION_RULES_EMPTY_TITLE,
        DETECTION_RULES_EMPTY_DESCRIPTION,
        OPEN_RULE_LIBRARY,
      ]) {
        expect([
          locale,
          sentence,
          isSaidInLocale(locale, sentence, entries[sentence]),
        ]).toEqual([locale, sentence, true]);
      }
    }
  });
});
