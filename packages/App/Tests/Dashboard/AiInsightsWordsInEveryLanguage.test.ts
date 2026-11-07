import {
  ExtractedString,
  scanSourceRoots,
  SourceRoot,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  LOCALES_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  LocaleProgress,
  readGlobalSameAsEnglish,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AI INSIGHTS IN THE READER'S LANGUAGE (#5715's follow-up: "AI Insights'
 * remaining English sentences ... translate them in 16 locales").
 *
 * Every AI Insights page - the incidents' and the alerts' (AI → Insights),
 * a cluster's and each resource's - is one page, AiActivityInsightsPage
 * over AiActivityInsightsView, with every sentence worded in
 * AiActivityInsightsData. Some forty of its sentences were English in every
 * language: the tone a finding is marked with ("Needs attention now"), how
 * a problem's fixes went ("3 fixes proposed · 2 applied"), what people
 * thought of its findings, the health notes, the trend's line and each
 * day's hover, "Open AI Logs", "See everything AI did in AI Logs", the
 * loading error, and the fix bar's own label for a screen reader. Every
 * string these pages draw (as `npm run i18n:extract` finds it) is worded
 * now in each of the sixteen languages besides English, as the toolchain
 * counts it (`npm run i18n:check`): a value of its own, or the same English
 * the language keeps on purpose (its same-as-English list: "Incident
 * #{{number}}" in Dutch and Swedish, "{{count}} problem" in Danish), or
 * text with no words, or a "one" form a language never reads.
 *
 * A sentence added to an AI Insights page later is translated with it, or
 * fails here.
 */

const AI_INSIGHTS_ROOTS: Array<SourceRoot> = [
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights",
    kind: "ui",
  },
  // The incidents' and the alerts' pages, and the words they bring.
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Components/IncidentAlertAi/IncidentAlertAiInsightsPage.tsx",
    kind: "ui",
  },
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Pages/Incidents/AI/Insights.tsx",
    kind: "ui",
  },
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Pages/Alerts/AI/Insights.tsx",
    kind: "ui",
  },
  // A resource's page and a cluster's.
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiInsightsPage.tsx",
    kind: "ui",
  },
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/AI/Insights.tsx",
    kind: "ui",
  },
  // The fix bars' legend and hover, which the Fixes section draws.
  {
    directory:
      "packages/Common/UI/Components/StackedProgressBar/StackedProgressBar.tsx",
    kind: "ui",
  },
];

// Languages whose plurals have no "one" form: their "_one" key is never read.
const LANGUAGES_WITHOUT_ONE: ReadonlyArray<string> = [
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
];

const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;
const LETTER: RegExp = /\p{L}/u;

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const ENGLISH: Record<string, unknown> = readLocale("en");
const GLOBAL_SAME_AS_ENGLISH: Set<string> = new Set<string>(
  readGlobalSameAsEnglish(),
);

interface InsightsKey {
  key: string;
  file: string;
}

// Every key the pages read: each text, and a plural's "one" form.
function getInsightsKeys(): Array<InsightsKey> {
  const keys: Map<string, string> = new Map<string, string>();

  for (const entry of scanSourceRoots(AI_INSIGHTS_ROOTS).strings) {
    if (entry.nestedPath) {
      continue;
    }

    const found: ExtractedString = entry;

    if (!keys.has(found.text)) {
      keys.set(found.text, found.file);
    }

    if (found.pluralOne !== undefined && !keys.has(`${found.text}_one`)) {
      keys.set(`${found.text}_one`, found.file);
    }
  }

  return Array.from(keys.entries()).map(
    ([key, file]: [string, string]): InsightsKey => {
      return { key, file };
    },
  );
}

const INSIGHTS_KEYS: Array<InsightsKey> = getInsightsKeys();

// Whether `language` words `key` its own way, as npm run i18n:check counts it.
function isWorded(data: {
  key: string;
  language: string;
  locale: Record<string, unknown>;
  sameAsEnglish: Set<string>;
}): boolean {
  const english: unknown = ENGLISH[data.key];
  const value: unknown = data.locale[data.key];

  if (typeof english !== "string" || typeof value !== "string") {
    return false;
  }

  if (!value.trim()) {
    return false;
  }

  if (value !== english) {
    return true;
  }

  if (
    data.key.endsWith("_one") &&
    LANGUAGES_WITHOUT_ONE.includes(data.language)
  ) {
    return true;
  }

  if (!LETTER.test(english.replace(PLACEHOLDER, ""))) {
    return true;
  }

  return GLOBAL_SAME_AS_ENGLISH.has(english) || data.sameAsEnglish.has(english);
}

// What each placeholder of a sentence is called, in order of first use.
function placeholdersOf(text: string): Array<string> {
  return Array.from(new Set(text.match(PLACEHOLDER) || [])).sort();
}

describe("AI Insights' words in every language", () => {
  test("the pages draw words, every one of them in English", () => {
    // The scan finds the pages' words, and each is an en.json key.
    expect(INSIGHTS_KEYS.length).toBeGreaterThan(200);
    expect(
      INSIGHTS_KEYS.filter((entry: InsightsKey): boolean => {
        return typeof ENGLISH[entry.key] !== "string";
      }),
    ).toEqual([]);

    // The sentences this follow-up worded, among them.
    const keys: Set<string> = new Set<string>(
      INSIGHTS_KEYS.map((entry: InsightsKey): string => {
        return entry.key;
      }),
    );
    for (const key of [
      "Needs attention now",
      "{{count}} fixes proposed",
      "{{count}} fixes proposed_one",
      "{{count}} applied",
      "your team confirmed {{count}} findings",
      "{{count}} investigations failed or timed out in the last {{days}} days.",
      "{{count}} investigations in the last 7 days ({{lastWeek}} the 7 days before).",
      "{{date}}: {{investigations}} investigations, {{failed}} failed, {{fixes}} fixes",
      "Investigations per day",
      "Open AI Logs",
      "See everything AI did in AI Logs",
      "Anything older is on the AI Logs page.",
      "Could not load AI insights.",
      "Stacked progress bar",
    ]) {
      expect({ key, found: keys.has(key) }).toEqual({ key, found: true });
    }
  });

  /*
   * A fix bar segment's hover, "Dismissed: 2": a sentence of a label and a
   * count, so each language writes its colon its own way - French spaces
   * it, Chinese writes a full-width one - as the resource hero's
   * identifier line does. It has no word of its own, so the extractor
   * leaves it alone; every locale holds it all the same.
   */
  test("a fix bar segment's hover is a sentence each language writes its own way", () => {
    const key: string = "{{label}}: {{count}}";

    expect(ENGLISH[key]).toBe(key);
    for (const language of TRANSLATED_LOCALES) {
      const value: unknown = readLocale(language)[key];

      expect({ language, isText: typeof value === "string" }).toEqual({
        language,
        isText: true,
      });
      expect(placeholdersOf(value as string)).toEqual(placeholdersOf(key));
    }
    expect(readLocale("fr")[key]).toBe("{{label}} : {{count}}");
    expect(readLocale("zh-CN")[key]).toBe("{{label}}\uFF1A{{count}}");
    expect(readLocale("zh-TW")[key]).toBe("{{label}}\uFF1A{{count}}");
  });

  test.each(TRANSLATED_LOCALES)(
    "%s words every one of them",
    (language: string) => {
      const progress: LocaleProgress | undefined = readLocaleProgress(language);
      const sameAsEnglish: Set<string> = new Set<string>(
        progress ? progress.sameAsEnglish : [],
      );
      const locale: Record<string, unknown> = readLocale(language);

      const unworded: Array<string> = INSIGHTS_KEYS.filter(
        (entry: InsightsKey): boolean => {
          return !isWorded({
            key: entry.key,
            language,
            locale,
            sameAsEnglish,
          });
        },
      ).map((entry: InsightsKey): string => {
        return `${entry.key} (${path.basename(entry.file)})`;
      });

      expect(unworded).toEqual([]);
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s keeps every placeholder of every sentence",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);
      const lost: Array<string> = [];

      for (const entry of INSIGHTS_KEYS) {
        const english: unknown = ENGLISH[entry.key];
        const value: unknown = locale[entry.key];

        if (typeof english !== "string" || typeof value !== "string") {
          continue;
        }

        if (
          placeholdersOf(english).join(",") !== placeholdersOf(value).join(",")
        ) {
          lost.push(entry.key);
        }
      }

      expect(lost).toEqual([]);
    },
  );
});
