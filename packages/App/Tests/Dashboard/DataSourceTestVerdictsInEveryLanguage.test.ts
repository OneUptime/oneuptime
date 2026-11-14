import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";

/*
 * THE DATA SOURCE TEST'S OWN VERDICTS, IN EVERY LANGUAGE (#7586).
 *
 * Testing a data source - a row's Test under Dashboards > Settings > Data
 * Sources, or the Test on a data source's own page - shows what the server
 * says about the connection. When its answer carries no message, the test
 * gives its own verdict: "Connection successful." or "Connection failed."
 * (Common/UI/Utils/TestDataSource). Both were English in 11 of the
 * Dashboard's 17 languages - Italian, Portuguese, Dutch, Danish, Norwegian,
 * Swedish, Russian, Korean, both Chinese and Hindi: the progress baselines
 * let a key wait for its translation, and no test asked for these two.
 *
 * The test's words are read the way the Dashboard's extraction reads them
 * (npm run i18n:extract), so a verdict the test gains is held here too: each
 * is a key of the Dashboard's English, and every language words it its own
 * way, never in English.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

const TEST_FILE: string = "packages/Common/UI/Utils/TestDataSource.ts";

const LOCALES: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard/src/Locales",
);

// The verdicts the test gives when the server's answer says nothing.
const OWN_VERDICTS: ReadonlyArray<string> = [
  "Connection successful.",
  "Connection failed.",
];

type Locale = Record<string, unknown>;

function readLocale(code: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Locale;
}

// What the extraction reads in the test's file, each text once.
const TEXTS: Array<string> = Array.from(
  new Set<string>(
    (
      scanSourceText(
        TEST_FILE,
        fs.readFileSync(path.join(REPOSITORY_ROOT, TEST_FILE), "utf8"),
        { kind: "ui" },
      ).strings as Array<ExtractedString>
    ).map((entry: ExtractedString): string => {
      return entry.text;
    }),
  ),
);

describe("the Data Source test's own verdicts, in the Dashboard's languages", () => {
  test("are what the extraction reads in the test", () => {
    expect(TEXTS).toEqual(expect.arrayContaining([...OWN_VERDICTS]));
  });

  test("each is a key of the Dashboard's English", () => {
    const english: Locale = readLocale("en");

    for (const text of TEXTS) {
      expect({ text, english: english[text] }).toEqual({
        text,
        english: text,
      });
    }
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words each of them its own way, not in English",
    (code: string) => {
      const words: Locale = readLocale(code);

      for (const text of TEXTS) {
        const worded: unknown = words[text];

        expect({
          text,
          worded:
            typeof worded === "string" &&
            worded.trim() !== "" &&
            worded !== text,
        }).toEqual({ text, worded: true });
      }
    },
  );
});
