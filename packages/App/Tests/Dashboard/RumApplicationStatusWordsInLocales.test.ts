import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  RUM_APPLICATION_NO_RECENT_TRAFFIC_LABEL,
  RUM_APPLICATION_RECEIVING_DATA_LABEL,
  RUM_APPLICATION_WAITING_FOR_DATA_LABEL,
} from "Common/Types/Rum/RumApplicationStatus";
import { RUM_APPLICATION_IDLE_COPY } from "../../FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionGuides";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";

/*
 * A RUM APPLICATION'S STATUS SAYS ALL ITS WORDS IN THE READER'S LANGUAGE
 * (issue #6191).
 *
 * The pill it replaced - "Connected" / "Disconnected" - was worded in all
 * sixteen languages, so a new word left English would have been a step
 * back for every one of them. Every word the status, its tooltips, the
 * Overview's idle and waiting card and the setup guide's renamed topic draw
 * is a key of the English locale and worded in every language; and a
 * sentence that names a status names it as that language's pill says it.
 */

const DASHBOARD: string = path.resolve(__dirname, "../../FeatureSet/Dashboard");
const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

const LANGUAGES: ReadonlyArray<string> = [...DASHBOARD_LANGUAGES];

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

// What the status module marks as words, as the extractor reads it.
const STATUS_FILE: string = path.join(
  REPOSITORY_ROOT,
  "packages/Common/Types/Rum/RumApplicationStatus.ts",
);

const STATUS_WORDS: Array<string> = (
  scanSourceText(
    path.relative(REPOSITORY_ROOT, STATUS_FILE),
    fs.readFileSync(STATUS_FILE, "utf8"),
    { kind: "keys" },
  ).strings as Array<ExtractedString>
).map((entry: ExtractedString): string => {
  return entry.text;
});

const RUM_WAIT_STEP: string =
  "Open your app so it sends its first data, then refresh this page. The application switches to Receiving data.";

const SETUP_GUIDE_TOPIC: string =
  'Status shows "No recent traffic" while people use the app';

const EVERY_WORD: Array<string> = [
  ...STATUS_WORDS,
  RUM_APPLICATION_IDLE_COPY.title,
  RUM_APPLICATION_IDLE_COPY.description,
  RUM_APPLICATION_IDLE_COPY.checksLabel,
  RUM_APPLICATION_IDLE_COPY.waitingDescription,
  RUM_WAIT_STEP,
  SETUP_GUIDE_TOPIC,
];

// A status word left in English, new or old, inside a translation.
const ENGLISH_STATUS_WORD: RegExp =
  /Receiving data|No recent traffic|Waiting for data|Disconnected|Connected/;

function placeholdersOf(text: string): Array<string> {
  return (text.match(/\{\{\w+\}\}/g) || []).sort();
}

describe("a RUM application's status words", () => {
  test("the status module marks its three labels and three tooltips", () => {
    expect(STATUS_WORDS).toHaveLength(6);
    for (const label of [
      RUM_APPLICATION_RECEIVING_DATA_LABEL,
      RUM_APPLICATION_NO_RECENT_TRAFFIC_LABEL,
      RUM_APPLICATION_WAITING_FOR_DATA_LABEL,
    ]) {
      expect(STATUS_WORDS).toContain(label);
    }
  });

  test("are every one a key of the English locale", () => {
    for (const text of EVERY_WORD) {
      expect({ text, key: ENGLISH[text] }).toEqual({ text, key: text });
    }
  });

  test("the guide and the page draw the words these keys hold", () => {
    const guides: string = fs.readFileSync(
      path.join(
        DASHBOARD,
        "src/Components/ResourceConnection/ResourceConnectionGuides.ts",
      ),
      "utf8",
    );
    const setupGuide: string = fs.readFileSync(
      path.join(DASHBOARD, "src/Components/Rum/RumSetupGuide.ts"),
      "utf8",
    );

    expect(guides).toContain(RUM_WAIT_STEP);
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
      const receiving: string = String(
        words[RUM_APPLICATION_RECEIVING_DATA_LABEL],
      );
      const noRecentTraffic: string = String(
        words[RUM_APPLICATION_NO_RECENT_TRAFFIC_LABEL],
      );

      expect(String(words[RUM_WAIT_STEP])).toContain(receiving);
      expect(String(words[SETUP_GUIDE_TOPIC])).toContain(noRecentTraffic);
    },
  );

  test.each(LANGUAGES)(
    "%s gives the three statuses three different words",
    (language: string) => {
      const words: Locale = localeOf(language);
      const labels: Array<string> = [
        RUM_APPLICATION_RECEIVING_DATA_LABEL,
        RUM_APPLICATION_NO_RECENT_TRAFFIC_LABEL,
        RUM_APPLICATION_WAITING_FOR_DATA_LABEL,
      ].map((label: string): string => {
        return String(words[label]);
      });

      expect(new Set(labels).size).toBe(3);
      // None of them is the old "Disconnected" in that language.
      expect(labels).not.toContain(String(words["Disconnected"]));
      expect(labels).not.toContain(String(words["Connected"]));
    },
  );
});
