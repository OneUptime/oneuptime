import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { CodeTaskListFilter } from "../../../Types/AI/CodeTask";
import { CodeTaskStage } from "../../../Types/AI/CodeTaskStage";
import { TransientAIFailureKind } from "../../../Types/AI/TransientAIFailure";
import {
  CODE_TASK_ATTEMPT,
  CODE_TASK_FAILED_AFTER_ATTEMPTS,
  CODE_TASK_LIST_FILTERS,
  CODE_TASK_RETRY_NOW,
  CODE_TASK_RETRYING_IN,
  CODE_TASK_RETRYING_NOW,
  CODE_TASK_STAGE_COPY,
  CODE_TASK_STAGE_UNKNOWN_LABEL,
  TRANSIENT_FAILURE_SENTENCES,
  getRetryReasonKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskStatusCopy";
import { STATUS_LABELS } from "../../../../App/FeatureSet/Dashboard/src/Components/AIInsights/InsightPresentation";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";

/*
 * Where a code task stands, in one word, wherever a page beside Code says
 * it (an insight's fix: "Task in progress" until there is a pull request,
 * "Task failed" when there will be none - never "Fix opened" before any
 * pull request), the filters a task list offers, and how a turn AI tries
 * again by itself says so. Complete for every stage, failure kind and
 * filter, and translated in every Dashboard locale.
 */

const LOCALES_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);
const SAME_AS_ENGLISH_FILE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/i18n/SameAsEnglish.json",
);
const PROGRESS_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/i18n/Progress",
);

const PLACEHOLDER: RegExp = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

type LocaleFile = Record<string, unknown>;

function readJson(file: string): LocaleFile {
  return JSON.parse(fs.readFileSync(file, "utf8")) as LocaleFile;
}

const ENGLISH: LocaleFile = readJson(path.join(LOCALES_DIRECTORY, "en.json"));
const GLOBAL_SAME: Set<string> = new Set<string>(
  JSON.parse(fs.readFileSync(SAME_AS_ENGLISH_FILE, "utf8")) as Array<string>,
);
const LOCALES: Array<string> = fs
  .readdirSync(LOCALES_DIRECTORY)
  .filter((name: string): boolean => {
    return name.endsWith(".json") && name !== "en.json";
  })
  .map((name: string): string => {
    return name.replace(".json", "");
  })
  .sort();

function placeholdersOf(text: string): Array<string> {
  return Array.from(text.matchAll(PLACEHOLDER))
    .map((match: RegExpMatchArray): string => {
      return match[1] || "";
    })
    .sort();
}

// Every sentence the module hands the pages, as English keys.
const SENTENCES: Array<string> = Array.from(
  new Set<string>([
    ...Object.values(CODE_TASK_STAGE_COPY).map(
      (copy: { label: string }): string => {
        return copy.label;
      },
    ),
    CODE_TASK_STAGE_UNKNOWN_LABEL,
    ...Object.values(TRANSIENT_FAILURE_SENTENCES),
    CODE_TASK_ATTEMPT,
    CODE_TASK_RETRYING_IN,
    CODE_TASK_RETRYING_NOW,
    CODE_TASK_RETRY_NOW,
    CODE_TASK_FAILED_AFTER_ATTEMPTS,
    ...CODE_TASK_LIST_FILTERS.map((entry: { label: string }): string => {
      return entry.label;
    }),
    // The task list's own words around its filters and its bulk Retry.
    "Filter tasks",
    "Search tasks",
    "No tasks match.",
    "Clear filters",
    "Retry selected",
    "Select all",
    "{{count}} selected",
    "Select {{name}}",
    "Trying {{count}} tasks again.",
    "Trying {{count}} tasks again._one",
    "{{count}} tasks could not be tried again: {{reason}}",
    "{{count}} tasks could not be tried again: {{reason}}_one",
    "{{count}} files changed",
    "{{count}} files changed_one",
    "worked {{duration}}",
    "{{duration}} so far",
    "OneUptime AI works on a fix for this insight in Code. Its pull request is always reviewed by a person — nothing merges by itself.",
  ]),
).sort();

describe("a task's stage in words is complete", () => {
  test("every stage has a label, a badge and a dot; only the moving ones pulse", () => {
    for (const stage of Object.values(CodeTaskStage)) {
      const copy: (typeof CODE_TASK_STAGE_COPY)[CodeTaskStage] =
        CODE_TASK_STAGE_COPY[stage];

      expect(copy.label).toBeTruthy();
      expect(copy.badgeClassName).toMatch(/bg-\S+ text-\S+ ring-\S+/);
      expect(copy.dotClassName).toMatch(/^bg-/);
    }

    expect(
      Object.values(CodeTaskStage).filter((stage: CodeTaskStage): boolean => {
        return CODE_TASK_STAGE_COPY[stage].isLive;
      }),
    ).toEqual([CodeTaskStage.Working, CodeTaskStage.Retrying]);
  });

  test("every stage reads as itself: no two say the same", () => {
    const labels: Array<string> = Object.values(CODE_TASK_STAGE_COPY).map(
      (copy: { label: string }): string => {
        return copy.label;
      },
    );

    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain(CODE_TASK_STAGE_UNKNOWN_LABEL);
  });

  test("an insight with a fix task says it has one, never that a fix was opened", () => {
    expect(STATUS_LABELS[AIInsightStatus.FixOpened]).toBe("Fix task");
    expect(CODE_TASK_STAGE_UNKNOWN_LABEL).toBe("Fix task");
    expect(
      Object.values(CODE_TASK_STAGE_COPY).map((copy: { label: string }) => {
        return copy.label;
      }),
    ).not.toContain("Fix Opened");
  });

  test("every failure AI tries again by itself has a sentence; else the reason as reported", () => {
    for (const kind of Object.values(TransientAIFailureKind)) {
      expect(TRANSIENT_FAILURE_SENTENCES[kind]).toMatch(/\.$/);
    }

    expect(
      getRetryReasonKey({
        attempt: 2,
        maxAttempts: 3,
        kind: TransientAIFailureKind.RateLimited,
        reason: "429",
      }),
    ).toBe("The AI model provider was busy (rate limited).");
    expect(
      getRetryReasonKey({ attempt: 2, maxAttempts: 3, reason: "Overloaded" }),
    ).toBe("Overloaded");
    expect(getRetryReasonKey({ attempt: 2, maxAttempts: 3 })).toBe("");
    expect(getRetryReasonKey(undefined)).toBe("");
  });

  test("a list offers every filter once, every task first", () => {
    expect(
      CODE_TASK_LIST_FILTERS.map((entry: { filter: CodeTaskListFilter }) => {
        return entry.filter;
      }),
    ).toEqual([
      CodeTaskListFilter.All,
      CodeTaskListFilter.InProgress,
      CodeTaskListFilter.WaitingForYou,
      CodeTaskListFilter.PullRequestOpen,
      CodeTaskListFilter.Failed,
      CodeTaskListFilter.Done,
    ]);
    expect([...Object.values(CodeTaskListFilter)].sort()).toEqual(
      CODE_TASK_LIST_FILTERS.map((entry: { filter: CodeTaskListFilter }) => {
        return entry.filter;
      }).sort(),
    );
  });
});

describe("a task's stage in words is translated", () => {
  test("every sentence is an English key", () => {
    for (const sentence of SENTENCES) {
      const english: unknown = ENGLISH[sentence];

      expect({ sentence, english: typeof english }).toEqual({
        sentence,
        english: "string",
      });

      if (!sentence.endsWith("_one")) {
        expect(english).toBe(sentence);
      }
    }
  });

  test.each(LOCALES)(
    "%s words every sentence, keeping its placeholders",
    (locale: string) => {
      const translations: LocaleFile = readJson(
        path.join(LOCALES_DIRECTORY, `${locale}.json`),
      );
      const progress: LocaleFile = readJson(
        path.join(PROGRESS_DIRECTORY, `${locale}.json`),
      );
      const localSame: Set<string> = new Set<string>(
        (progress["sameAsEnglish"] as Array<string> | undefined) || [],
      );

      /*
       * A language with no "one" form (Japanese, Korean, Chinese) never
       * shows a "_one" sentence: it may stay English (Locales/README).
       */
      const hasOneForm: boolean = new Intl.PluralRules(locale)
        .resolvedOptions()
        .pluralCategories.includes("one");

      const untranslated: Array<string> = SENTENCES.filter(
        (sentence: string): boolean => {
          return (
            (hasOneForm || !sentence.endsWith("_one")) &&
            translations[sentence] === ENGLISH[sentence] &&
            !GLOBAL_SAME.has(sentence) &&
            !localSame.has(sentence)
          );
        },
      );
      expect(untranslated).toEqual([]);

      for (const sentence of SENTENCES) {
        expect({
          sentence,
          placeholders: placeholdersOf(translations[sentence] as string),
        }).toEqual({
          sentence,
          placeholders: placeholdersOf(ENGLISH[sentence] as string),
        });
      }
    },
  );
});
