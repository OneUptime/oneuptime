import {
  ExtractedString,
  SOURCE_ROOTS,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_LABEL,
  SERVERLESS_FUNCTION_RECEIVING_DATA_LABEL,
  SERVERLESS_FUNCTION_WAITING_FOR_DATA_LABEL,
} from "Common/Types/Serverless/ServerlessFunctionStatus";
import {
  SERVICE_NO_RECENT_DATA_LABEL,
  SERVICE_RECEIVING_DATA_LABEL,
  SERVICE_WAITING_FOR_DATA_LABEL,
} from "Common/Types/Service/ServiceTelemetryStatus";
import { RUM_APPLICATION_NO_RECENT_TRAFFIC_LABEL } from "Common/Types/Rum/RumApplicationStatus";
import { SERVERLESS_FUNCTION_IDLE_COPY } from "../../FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionGuides";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A SERVERLESS FUNCTION'S AND A SERVICE'S STATUS SAY ALL THEIR WORDS IN THE
 * READER'S LANGUAGE (issues #6269, #6270).
 *
 * The pills they replaced - "Connected" / "Disconnected" - were worded in
 * all sixteen languages, so a new word left English would have been a step
 * back for every one of them. Every word the two statuses, their tooltips,
 * a function's idle and waiting card, its wait step and the setup guide's
 * renamed topic draw is a key of the English locale and worded in every
 * language; and a sentence that names a status names it as that
 * language's pill says it.
 */

const DASHBOARD: string = path.resolve(__dirname, "../../FeatureSet/Dashboard");
const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

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

type Locale = Record<string, unknown>;

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function localeOf(language: string): Locale {
  return readJson(
    path.join(DASHBOARD, `src/Locales/${language}.json`),
  ) as Locale;
}

const ENGLISH: Locale = localeOf("en");

const FUNCTION_STATUS_FILE: string =
  "packages/Common/Types/Serverless/ServerlessFunctionStatus.ts";
const SERVICE_STATUS_FILE: string =
  "packages/Common/Types/Service/ServiceTelemetryStatus.ts";

// What a status module marks as words, as the extractor reads it.
function markedWordsOf(file: string): Array<string> {
  return (
    scanSourceText(
      file,
      fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
      { kind: "keys" },
    ).strings as Array<ExtractedString>
  ).map((entry: ExtractedString): string => {
    return entry.text;
  });
}

const FUNCTION_STATUS_WORDS: Array<string> =
  markedWordsOf(FUNCTION_STATUS_FILE);
const SERVICE_STATUS_WORDS: Array<string> = markedWordsOf(SERVICE_STATUS_FILE);

const FUNCTION_WAIT_STEP: string =
  "Data is sent when the function runs. Invoke it once, then refresh this page after a few minutes. The function switches to Receiving data once its first data arrives.";

const SETUP_GUIDE_TOPIC: string =
  'Status shows "No recent invocations" while the function runs';

const EVERY_WORD: Array<string> = [
  ...FUNCTION_STATUS_WORDS,
  ...SERVICE_STATUS_WORDS,
  SERVERLESS_FUNCTION_IDLE_COPY.title,
  SERVERLESS_FUNCTION_IDLE_COPY.description,
  SERVERLESS_FUNCTION_IDLE_COPY.checksLabel,
  SERVERLESS_FUNCTION_IDLE_COPY.waitingDescription,
  FUNCTION_WAIT_STEP,
  SETUP_GUIDE_TOPIC,
];

// A status word left in English, new or old, inside a translation.
const ENGLISH_STATUS_WORD: RegExp =
  /Receiving data|No recent invocations|No recent data|No recent traffic|Waiting for data|Disconnected|Connected/;

function placeholdersOf(text: string): Array<string> {
  return (text.match(/\{\{\w+\}\}/g) || []).sort();
}

describe("a serverless function's and a service's status words", () => {
  test("each status module marks its three labels and three tooltips, and is read as a keys root", () => {
    expect(FUNCTION_STATUS_WORDS).toHaveLength(6);
    expect(SERVICE_STATUS_WORDS).toHaveLength(6);
    for (const label of [
      SERVERLESS_FUNCTION_RECEIVING_DATA_LABEL,
      SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_LABEL,
      SERVERLESS_FUNCTION_WAITING_FOR_DATA_LABEL,
    ]) {
      expect(FUNCTION_STATUS_WORDS).toContain(label);
    }
    for (const label of [
      SERVICE_RECEIVING_DATA_LABEL,
      SERVICE_NO_RECENT_DATA_LABEL,
      SERVICE_WAITING_FOR_DATA_LABEL,
    ]) {
      expect(SERVICE_STATUS_WORDS).toContain(label);
    }
    for (const file of [FUNCTION_STATUS_FILE, SERVICE_STATUS_FILE]) {
      expect(SOURCE_ROOTS).toContainEqual({ directory: file, kind: "keys" });
    }
  });

  test("are every one a key of the English locale", () => {
    for (const text of EVERY_WORD) {
      expect({ text, key: ENGLISH[text] }).toEqual({ text, key: text });
    }
  });

  test("the guide and the setup guide draw the words these keys hold", () => {
    const guides: string = fs.readFileSync(
      path.join(
        DASHBOARD,
        "src/Components/ResourceConnection/ResourceConnectionGuides.ts",
      ),
      "utf8",
    );
    const setupGuide: string = fs.readFileSync(
      path.join(DASHBOARD, "src/Components/Serverless/ServerlessSetupGuide.ts"),
      "utf8",
    );

    expect(guides).toContain(FUNCTION_WAIT_STEP);
    expect(setupGuide).toContain(`title: '${SETUP_GUIDE_TOPIC}'`);
  });

  test.each(LANGUAGES)("%s words every one of them", (language: string) => {
    const words: Locale = localeOf(language);
    const english: Array<string> = EVERY_WORD.filter(
      (text: string): boolean => {
        return typeof words[text] !== "string" || words[text] === text;
      },
    );

    expect({ language, english }).toEqual({ language, english: [] });
  });

  test.each(LANGUAGES)(
    "%s keeps every placeholder, and puts no stray English status word in",
    (language: string) => {
      const words: Locale = localeOf(language);

      for (const text of EVERY_WORD) {
        const worded: string = String(words[text]);

        expect({
          language,
          text,
          placeholders: placeholdersOf(worded),
        }).toEqual({ language, text, placeholders: placeholdersOf(text) });
        expect({
          language,
          text,
          english: ENGLISH_STATUS_WORD.test(worded),
        }).toEqual({ language, text, english: false });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s names a status in a sentence as its own pill says it",
    (language: string) => {
      const words: Locale = localeOf(language);

      expect(String(words[FUNCTION_WAIT_STEP])).toContain(
        String(words[SERVERLESS_FUNCTION_RECEIVING_DATA_LABEL]),
      );
      expect(String(words[SETUP_GUIDE_TOPIC])).toContain(
        String(words[SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_LABEL]),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s gives each resource's three statuses three different words, none the old ones",
    (language: string) => {
      const words: Locale = localeOf(language);

      for (const labels of [
        [
          SERVERLESS_FUNCTION_RECEIVING_DATA_LABEL,
          SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_LABEL,
          SERVERLESS_FUNCTION_WAITING_FOR_DATA_LABEL,
        ],
        [
          SERVICE_RECEIVING_DATA_LABEL,
          SERVICE_NO_RECENT_DATA_LABEL,
          SERVICE_WAITING_FOR_DATA_LABEL,
        ],
      ]) {
        const worded: Array<string> = labels.map((label: string): string => {
          return String(words[label]);
        });

        expect(new Set(worded).size).toBe(3);
        expect(worded).not.toContain(String(words["Disconnected"]));
        expect(worded).not.toContain(String(words["Connected"]));
      }
    },
  );

  /*
   * The quiet states mean different things - nothing invoked a function,
   * nobody used an application, a service may be idle or stopped - so each
   * language says them differently too.
   */
  test.each(LANGUAGES)(
    "%s words the three quiet states three ways",
    (language: string) => {
      const words: Locale = localeOf(language);

      expect(
        new Set([
          String(words[SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_LABEL]),
          String(words[SERVICE_NO_RECENT_DATA_LABEL]),
          String(words[RUM_APPLICATION_NO_RECENT_TRAFFIC_LABEL]),
        ]).size,
      ).toBe(3);
    },
  );
});
