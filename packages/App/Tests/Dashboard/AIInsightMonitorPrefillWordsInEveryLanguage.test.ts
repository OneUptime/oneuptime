import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  LOCALES_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  LocaleProgress,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A MONITOR MADE FROM AN AI INSIGHT, AND WHY ONE CANNOT BE, IN EVERY
 * LANGUAGE (#7664).
 *
 * An insight's Create Monitor opens Monitor Create on the monitor
 * AIInsightMonitorPrefill builds: its name and description, its criteria
 * and what each means, and why the threshold is the number it is. When the
 * insight cannot become a monitor, the same module says why - on the
 * insight's Create Monitor button and on Monitor Create, in place of the
 * form. 48 of its 69 sentences were English in 15 of the Dashboard's 17
 * languages: an error-log spike's monitor and an exception's from end to
 * end, most of a metric drift's, and seven of the ten reasons a monitor
 * cannot be made (a latency regression, a cumulative counter, a
 * histogram...). Only Arabic and Persian worded them.
 *
 * The sentences are read the way the Dashboard's extraction reads them (npm
 * run i18n:extract). Every one of them reads in each language's own words,
 * with the English placeholders - unless it is listed below, with why that
 * language writes it as English does. A sentence added to the prefill later
 * is worded with it, or fails here.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

const PREFILL_FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Utils/AIInsightMonitorPrefill.ts";

/*
 * The sentences a language rightly writes as English does, and why. A
 * language is listed only while its words really are the English (the last
 * test checks), and its same-as-English list (i18n/Progress) records it too,
 * so npm run i18n:check counts it as worded.
 */
const SAME_AS_ENGLISH: Record<string, Record<string, string>> = {
  // An exception monitor's name: "TimeoutError in checkout".
  "{{exceptionType}} in {{serviceName}}": {
    de: 'German says "in" for where it was thrown, as English does',
    it: 'Italian says "in" for where it was thrown, as English does',
    nl: 'Dutch says "in" for where it was thrown, as English does',
  },
};

/*
 * Why an insight cannot become a monitor: each AI_INSIGHT_MONITOR_*_BLOCKER
 * the prefill declares, read from its source (the module reads `window` as
 * it loads, which a plain Node test has not got).
 */
const BLOCKER_DECLARATION: RegExp =
  /export const AI_INSIGHT_MONITOR_\w+_BLOCKER: string =\s*translationKey\(\s*"([^"]+)"/g;

const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;

type Locale = Record<string, unknown>;

function readLocale(language: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Locale;
}

const PREFILL_SOURCE: string = fs.readFileSync(
  path.join(REPOSITORY_ROOT, PREFILL_FILE),
  "utf8",
);

// Every key the prefill reads: each sentence, and a plural's "one" form.
function getPrefillKeys(): Array<string> {
  const keys: Array<string> = [];
  const entries: Array<ExtractedString> = scanSourceText(
    PREFILL_FILE,
    PREFILL_SOURCE,
    { kind: "ui" },
  ).strings as Array<ExtractedString>;

  for (const entry of entries) {
    if (entry.nestedPath) {
      continue;
    }

    for (const key of entry.pluralOne === undefined
      ? [entry.text]
      : [entry.text, `${entry.text}_one`]) {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    }
  }

  return keys;
}

const PREFILL_KEYS: Array<string> = getPrefillKeys();
const ENGLISH: Locale = readLocale("en");

function placeholdersOf(text: string): Array<string> {
  return Array.from(new Set(text.match(PLACEHOLDER) || [])).sort();
}

describe("an AI insight's monitor, in every language", () => {
  test("the prefill's sentences are read, every one of them an English key", () => {
    expect(PREFILL_KEYS.length).toBeGreaterThanOrEqual(69);
    expect(
      PREFILL_KEYS.filter((key: string): boolean => {
        return ENGLISH[key] !== key;
      }),
    ).toEqual([]);

    // Among them every reason an insight cannot become a monitor.
    const blockers: Array<string> = Array.from(
      PREFILL_SOURCE.matchAll(BLOCKER_DECLARATION),
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );

    expect(blockers.length).toBeGreaterThanOrEqual(10);
    expect(
      blockers.filter((blocker: string): boolean => {
        return !PREFILL_KEYS.includes(blocker);
      }),
    ).toEqual([]);

    // And the sentences kept in English are the prefill's own.
    expect(
      Object.keys(SAME_AS_ENGLISH).filter((key: string): boolean => {
        return !PREFILL_KEYS.includes(key);
      }),
    ).toEqual([]);
  });

  test.each([...TRANSLATED_LOCALES])(
    "%s words every sentence its own way",
    (language: string) => {
      const locale: Locale = readLocale(language);

      const inEnglish: Array<string> = PREFILL_KEYS.filter(
        (key: string): boolean => {
          const value: unknown = locale[key];

          if (typeof value !== "string" || value.trim() === "") {
            return true;
          }

          return value === key && !SAME_AS_ENGLISH[key]?.[language];
        },
      );

      expect({ language, inEnglish }).toEqual({ language, inEnglish: [] });
    },
  );

  test.each([...TRANSLATED_LOCALES])(
    "%s keeps every placeholder of every sentence",
    (language: string) => {
      const locale: Locale = readLocale(language);

      const lost: Array<string> = PREFILL_KEYS.filter(
        (key: string): boolean => {
          const value: unknown = locale[key];

          return (
            typeof value === "string" &&
            placeholdersOf(value).join(",") !== placeholdersOf(key).join(",")
          );
        },
      );

      expect({ language, lost }).toEqual({ language, lost: [] });
    },
  );

  test("each sentence kept in English is the English there, and recorded as such", () => {
    for (const [key, languages] of Object.entries(SAME_AS_ENGLISH)) {
      for (const language of Object.keys(languages)) {
        const progress: LocaleProgress | undefined =
          readLocaleProgress(language);

        expect({
          key,
          language,
          value: readLocale(language)[key],
          recorded: Boolean(progress?.sameAsEnglish.includes(key)),
        }).toEqual({ key, language, value: key, recorded: true });
      }
    }
  });
});
