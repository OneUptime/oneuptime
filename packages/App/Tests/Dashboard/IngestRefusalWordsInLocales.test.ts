import {
  ExtractedString,
  HardcodedString,
  SourceScanResult,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import TelemetryIngestionKeyRefusal from "Common/Models/DatabaseModels/TelemetryIngestionKeyRefusal";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT WAS REFUSED, IN EVERY LANGUAGE (issue #6378).
 *
 * Why telemetry was refused, what puts it right, where it was refused and
 * how many: the RUM setup check, its empty charts, the key picker and the
 * key's own Refused Telemetry card say it where nothing else explains a
 * silent app. A reader on a German or a Persian Dashboard meets those words
 * when something is wrong, so each one is a key of the English locale,
 * worded in all sixteen other languages with its placeholders intact, and
 * the components draw no word of their own outside a lookup. (The setup
 * check's own words are RumSetupDiagnosticsWordsInLocales.test.ts.)
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

const SAME_AS_ENGLISH: ReadonlyArray<string> = readJson(
  path.join(DASHBOARD, "i18n/SameAsEnglish.json"),
) as Array<string>;

function sameAsEnglishIn(language: string): ReadonlyArray<string> {
  const progress: { sameAsEnglish?: Array<string> } = readJson(
    path.join(DASHBOARD, `i18n/Progress/${language}.json`),
  ) as { sameAsEnglish?: Array<string> };

  return [...SAME_AS_ENGLISH, ...(progress.sameAsEnglish || [])];
}

// The refusal words, the card that lists them and the key picker.
const SOURCE_FILES: ReadonlyArray<string> = [
  "src/Components/Telemetry/IngestRefusalWords.ts",
  "src/Components/Telemetry/IngestRefusalFacts.ts",
  "src/Components/Telemetry/IngestRefusalRoutes.ts",
  "src/Components/Telemetry/IngestionKeyRefusalsCard.tsx",
  "src/Components/Telemetry/IngestionKeySelector.tsx",
].map((file: string): string => {
  return path.join(DASHBOARD, file);
});

const SCANS: Array<{ file: string; result: SourceScanResult }> =
  SOURCE_FILES.map((file: string) => {
    return {
      file,
      result: scanSourceText(
        path.relative(REPOSITORY_ROOT, file),
        fs.readFileSync(file, "utf8"),
        { kind: "ui" },
      ),
    };
  });

interface Word {
  key: string;
  english: string;
}

const WORDS: Array<Word> = [];

for (const { result } of SCANS) {
  for (const entry of result.strings as Array<ExtractedString>) {
    WORDS.push({ key: entry.text, english: entry.text });

    if (entry.pluralOne) {
      WORDS.push({ key: `${entry.text}_one`, english: entry.pluralOne });
    }
  }
}

// The table's own names, as the API and its column pickers list them.
const REFUSAL_MODEL: TelemetryIngestionKeyRefusal =
  new TelemetryIngestionKeyRefusal();

for (const text of [
  REFUSAL_MODEL.singularName,
  REFUSAL_MODEL.pluralName,
  REFUSAL_MODEL.tableDescription,
  ...[
    "telemetryIngestionKeyId",
    "reason",
    "surface",
    "refusedCount",
    "firstRefusedAt",
    "lastRefusedAt",
  ].map((column: string): string | undefined => {
    return REFUSAL_MODEL.getTableColumnMetadata(column).title;
  }),
]) {
  if (text) {
    WORDS.push({ key: text, english: text });
  }
}

function placeholdersOf(text: string): Array<string> {
  return (text.match(/\{\{\w+\}\}/g) || []).sort();
}

function uniqueKeys(): Array<string> {
  return Array.from(
    new Set(
      WORDS.map((word: Word): string => {
        return word.key;
      }),
    ),
  );
}

describe("the refusal words", () => {
  test("the scan finds the reasons, the fixes, the counts and the card", () => {
    const keys: Array<string> = uniqueKeys();

    for (const sentence of [
      'The key "{{key}}" is turned off, so everything sent with it is refused.',
      "This project has no payment method, so its telemetry is refused.",
      "Pick another key",
      "Add a payment method",
      "{{count}} requests refused since {{date}}, the latest {{time}}.",
      "{{count}} requests refused since {{date}}, the latest {{time}}._one",
      "One request refused {{time}}.",
      "Refused Telemetry",
      "Nothing sent with this key was refused in the past 30 days.",
      "Other endpoints",
      "{{name}} (expired)",
      "{{name}} (turned off)",
      "Telemetry Ingestion Key Refusal",
      "Last Refused At",
    ]) {
      expect({ sentence, found: keys.includes(sentence) }).toEqual({
        sentence,
        found: true,
      });
    }
  });

  test("the components draw no word outside a lookup", () => {
    const hardcoded: Array<{ file: string; text: string }> = [];

    for (const { file, result } of SCANS) {
      for (const entry of result.hardcoded as Array<HardcodedString>) {
        hardcoded.push({
          file: path.relative(REPOSITORY_ROOT, file),
          text: entry.text,
        });
      }
    }

    expect(hardcoded).toEqual([]);
  });

  test("every one is a key of the English locale, holding its English", () => {
    for (const word of WORDS) {
      expect({ key: word.key, english: ENGLISH[word.key] }).toEqual({
        key: word.key,
        english: word.english,
      });
    }
  });

  test.each(LANGUAGES)("%s words every one of them", (language: string) => {
    const words: Locale = localeOf(language);
    const sameAsEnglish: ReadonlyArray<string> = sameAsEnglishIn(language);
    const english: Array<string> = WORDS.filter((word: Word): boolean => {
      const worded: unknown = words[word.key];

      if (typeof worded !== "string" || !worded.trim()) {
        return true;
      }

      return worded === word.english && !sameAsEnglish.includes(word.key);
    }).map((word: Word): string => {
      return word.key;
    });

    expect({ language, english }).toEqual({ language, english: [] });
  });

  test.each(LANGUAGES)(
    "%s keeps every placeholder as written",
    (language: string) => {
      const words: Locale = localeOf(language);

      for (const word of WORDS) {
        expect({
          language,
          key: word.key,
          placeholders: placeholdersOf(String(words[word.key])),
        }).toEqual({
          language,
          key: word.key,
          placeholders: placeholdersOf(word.english),
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s tells every reason apart, and every fix",
    (language: string) => {
      const words: Locale = localeOf(language);
      const reasons: Array<string> = WORDS.filter((word: Word): boolean => {
        return (
          word.english.endsWith("refused.") || word.english.includes("{{key}}")
        );
      }).map((word: Word): string => {
        return String(words[word.key]);
      });
      const fixes: Array<string> = [
        "Pick another key",
        "Open the key",
        "See budgets",
        "Add a payment method",
      ].map((key: string): string => {
        return String(words[key]);
      });

      expect(reasons.length).toBeGreaterThanOrEqual(8);
      expect(new Set(reasons).size).toBe(reasons.length);
      expect(new Set(fixes).size).toBe(fixes.length);
    },
  );
});
