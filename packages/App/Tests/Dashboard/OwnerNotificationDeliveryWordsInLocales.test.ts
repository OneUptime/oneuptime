import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ExtractedString,
  SKIPPED_SOURCE_FILES,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";

/*
 * THE OWNER NOTIFICATION DELIVERY TABLE'S WORDS, IN EVERY LANGUAGE.
 *
 * OwnerNotificationDelivery (Common/Models/DatabaseModels) is OneUptime's own
 * record of each owner a notification is to reach. Its Feed Status column
 * and its table description reached every locale file as English
 * placeholders: npm run i18n:extract reads every model's names and column
 * titles, which a model's pages, its workflow steps and its filters draw.
 * Arabic and Persian are translated through, so their guards failed while
 * the two read English; the others counted them as untranslated.
 *
 * Each is worded in every language now, and the extractor still finds the
 * model's words, so a column added later reaches the locales the same way.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const MODEL_FILE: string =
  "packages/Common/Models/DatabaseModels/OwnerNotificationDelivery.ts";

const FEED_STATUS: string = "Feed Status";

const TABLE_DESCRIPTION: string =
  "Internal record of each owner a record's owner notification is to reach, and whether it reached them.";

// The languages whose guards hold every key worded (ArabicLocaleGuards, DashboardWordsInPersian).
const TRANSLATED_THROUGH: Array<string> = ["ar", "fa"];

function modelWords(): Array<string> {
  return scanSourceText(
    MODEL_FILE,
    fs.readFileSync(path.join(REPOSITORY_ROOT, MODEL_FILE), "utf8"),
    { kind: "models" },
  ).strings.map((entry: ExtractedString): string => {
    return entry.text;
  });
}

describe("the Owner Notification Delivery table's words", () => {
  test("are the extractor's: the model is read, its feed status and description among its words", () => {
    expect(SKIPPED_SOURCE_FILES.has(MODEL_FILE)).toBe(false);
    expect(modelWords()).toEqual(
      expect.arrayContaining([
        "Owner Notification Delivery",
        "Owner Notification Deliveries",
        TABLE_DESCRIPTION,
        FEED_STATUS,
        "Attempted At",
      ]),
    );

    const english: Record<string, string> = readDashboardLocale("en");

    for (const word of modelWords()) {
      expect([word, english[word]]).toEqual([word, word]);
    }
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "in %s, its Feed Status column and its description are worded",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const word of [FEED_STATUS, TABLE_DESCRIPTION]) {
        expect([word, typeof locale[word]]).toEqual([word, "string"]);
        expect([word, locale[word]]).not.toEqual([word, word]);
        expect(locale[word]!.trim()).not.toBe("");
      }

      // A description is one sentence, with its full stop.
      expect(locale[TABLE_DESCRIPTION]).toMatch(/[.。।]$/);
    },
  );

  test.each(TRANSLATED_THROUGH)(
    "in %s, every word of the table is worded",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const word of modelWords()) {
        expect([word, locale[word]]).not.toEqual([word, word]);
      }
    },
  );

  test("each language names the feed as its locale names an incident's Feed", () => {
    const feedWord: Record<string, string> = {
      de: "Feed",
      fr: "fil d'activité",
      es: "feed",
      it: "feed",
      pt: "feed",
      nl: "Feed",
      da: "Feed",
      no: "Feed",
      sv: "Feed",
      ru: "ленты",
      ja: "フィード",
      ko: "피드",
      "zh-CN": "动态",
      "zh-TW": "動態",
      hi: "फ़ीड",
      fa: "فید",
      ar: "الموجز",
    };

    expect(Object.keys(feedWord).sort()).toEqual(
      [...DASHBOARD_LANGUAGES].sort(),
    );

    for (const [language, word] of Object.entries(feedWord)) {
      expect([
        language,
        readDashboardLocale(language)[FEED_STATUS]!.includes(word),
      ]).toEqual([language, true]);
    }
  });
});
