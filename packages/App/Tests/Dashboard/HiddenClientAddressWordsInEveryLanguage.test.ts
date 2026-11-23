import { describe, expect, test } from "@jest/globals";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import { Translator } from "Common/Types/Translator";
import * as Copy from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/HiddenClientAddressCopy";

/*
 * THE WORDS FOR AN ADDRESS A SCRUB RULE HID (#10397), IN EVERY LANGUAGE
 * THE DASHBOARD SHIPS - read from its locale files as they ship.
 *
 * Every sentence that stands where an attacker's address would be - an
 * event's Principal IP, What happened next, a campaign's row, a case's
 * Response Plan and the Overview's line about the rule that does it - is
 * worded in each language, with its {{rule}} kept, so a German, Japanese or
 * Arabic reader never meets English there. The rule's name goes in as it
 * was saved.
 */

const SENTENCES: ReadonlyArray<string> = Object.values(Copy).filter(
  (value: unknown): value is string => {
    return typeof value === "string";
  },
);

describe("the words for an address a scrub rule hid", () => {
  test("are each an English key the Dashboard's locales hold", () => {
    // Target IP's filter is the thirteenth (#10419).
    expect(SENTENCES).toHaveLength(13);
    expect(SENTENCES).toContain(Copy.FILTER_BY_HIDDEN_TARGET_ADDRESS);

    const english: Record<string, string> = readDashboardLocale("en");

    for (const sentence of SENTENCES) {
      expect({ sentence, english: english[sentence] }).toEqual({
        sentence,
        english: sentence,
      });
    }
  });

  test("are worded in every language, each keeping its placeholders", () => {
    const unworded: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const sentence of SENTENCES) {
        if (!isWordedInDashboardLocale(sentence, language)) {
          unworded.push(`${language}: ${sentence}`);
          continue;
        }

        expect({
          language,
          sentence,
          placeholders: placeholdersOf(words[sentence] || ""),
        }).toEqual({
          language,
          sentence,
          placeholders: placeholdersOf(sentence),
        });
      }
    }

    expect(unworded).toEqual([]);
  });

  test("put the rule's name in as it was saved, wherever each language's grammar puts it", () => {
    const english: Translator = dashboardTranslator("en");

    for (const language of DASHBOARD_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);

      for (const sentence of [
        Copy.HIDDEN_BY_THE_SCRUB_RULE,
        Copy.SCRUB_RULE_REDACTS_THEM,
        Copy.SCRUB_RULE_MASKS_THEM,
        Copy.ADDRESS_HIDDEN_FROM_CASE_BY_RULE,
      ]) {
        const values: { rule: string } = { rule: "Scrub IP addresses" };
        const drawn: string = translator.translateTemplate(sentence, values);

        expect({
          language,
          sentence,
          named: drawn.includes("Scrub IP addresses"),
          english: drawn === english.translateTemplate(sentence, values),
        }).toEqual({ language, sentence, named: true, english: false });
      }
    }
  });

  test("tell the logs from the traces in every language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      expect({
        language,
        same:
          words[Copy.LOG_ADDRESSES_SCRUBBED] ===
          words[Copy.TRACE_ADDRESSES_SCRUBBED],
      }).toEqual({ language, same: false });
      expect({
        language,
        same:
          words[Copy.SCRUB_RULE_REDACTS_THEM] ===
          words[Copy.SCRUB_RULE_MASKS_THEM],
      }).toEqual({ language, same: false });
    }
  });

  test("tell a hidden source's filter from a hidden destination's in every language (#10419)", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      expect({
        language,
        same:
          words[Copy.FILTER_BY_HIDDEN_ADDRESS] ===
          words[Copy.FILTER_BY_HIDDEN_TARGET_ADDRESS],
      }).toEqual({ language, same: false });
    }
  });
});
