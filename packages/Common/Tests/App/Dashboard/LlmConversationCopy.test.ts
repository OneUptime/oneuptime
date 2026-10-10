import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  LLM_ACTIVITY_LABELS,
  LLM_CALL_KIND_TITLES,
  LLM_CONVERSATION_SORT_OPTIONS,
  LLM_HEALTHY_DOT_CLASS_NAME,
  LLM_ISSUE_STYLES,
  LlmSortOption,
  getLlmSortLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationCopy";
import {
  LlmAnswerIssue,
  LlmAnswerIssueUtil,
} from "../../../Types/Telemetry/LlmAnswerIssue";
import { LlmCallKind, LlmCallKindUtil } from "../../../Types/Telemetry/LlmCallKind";
import { LlmConversationSort } from "../../../Types/Telemetry/LlmConversationApi";

/*
 * The words the AI pages use for what went wrong with an answer and what a
 * call did. The English is kept twice: in Common (the server writes it into
 * alert descriptions and the monitor summary) and here, wrapped for the
 * Dashboard's translation extractor. If the two drift, an alert says
 * "Cut-off" while the chip that filters for it says "Truncated" - so they
 * are held to the same words, and every word to a translation in every
 * language the Dashboard ships.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);
const PROGRESS_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/i18n/Progress",
);
const GLOBAL_SAME_AS_ENGLISH: Array<string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/i18n/SameAsEnglish.json",
    ),
    "utf8",
  ),
) as Array<string>;

const LOCALES: Array<string> = [
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

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

const ENGLISH: Record<string, unknown> = readJson(path.join(LOCALES_DIR, "en.json"));

// The words a reader sees, as they are written in the tables.
function allWords(): Array<string> {
  const words: Array<string> = [];

  for (const style of Object.values(LLM_ISSUE_STYLES)) {
    words.push(style.title, style.description);
  }

  words.push(...Object.values(LLM_CALL_KIND_TITLES));
  words.push(...Object.values(LLM_ACTIVITY_LABELS));
  words.push(
    ...LLM_CONVERSATION_SORT_OPTIONS.map((option: LlmSortOption): string => {
      return option.label;
    }),
  );

  return words;
}

describe("the answer problems' words", () => {
  test("every problem has a style", () => {
    expect(Object.keys(LLM_ISSUE_STYLES).sort()).toEqual(
      LlmAnswerIssueUtil.getAllIssues().sort(),
    );
  });

  test("the chip's word is the word Common writes", () => {
    for (const issue of LlmAnswerIssueUtil.getAllIssues()) {
      expect({ issue, title: LLM_ISSUE_STYLES[issue].title }).toEqual({
        issue,
        title: LlmAnswerIssueUtil.getInfo(issue).title,
      });
    }
  });

  test("the tooltip's sentence is the sentence Common writes", () => {
    for (const issue of LlmAnswerIssueUtil.getAllIssues()) {
      expect(LLM_ISSUE_STYLES[issue].description).toBe(
        LlmAnswerIssueUtil.getInfo(issue).description,
      );
    }
  });

  test("a count reads naturally in the singular and the plural", () => {
    for (const issue of LlmAnswerIssueUtil.getAllIssues()) {
      const label: { one: string; other: string } =
        LLM_ISSUE_STYLES[issue].countLabel;

      expect(label.one).toMatch(/^\{\{count\}\} \S/);
      expect(label.other).toMatch(/^\{\{count\}\} \S/);
      expect(label.one).not.toBe(label.other);
    }

    expect(LLM_ISSUE_STYLES[LlmAnswerIssue.Refused].countLabel).toEqual({
      one: "{{count}} refusal",
      other: "{{count}} refusals",
    });
  });

  test("each problem has its own colour and icon, and healthy its own dot", () => {
    const dots: Array<string> = Object.values(LLM_ISSUE_STYLES).map(
      (style: { dotClassName: string }): string => {
        return style.dotClassName;
      },
    );
    const icons: Array<string> = Object.values(LLM_ISSUE_STYLES).map(
      (style: { icon: string }): string => {
        return style.icon;
      },
    );

    expect(new Set(dots).size).toBe(dots.length);
    expect(new Set(icons).size).toBe(icons.length);
    expect(dots).not.toContain(LLM_HEALTHY_DOT_CLASS_NAME);
    // A failure reads as red, wherever it is drawn.
    expect(LLM_ISSUE_STYLES[LlmAnswerIssue.Failed].dotClassName).toBe("bg-red-500");
    expect(LLM_ISSUE_STYLES[LlmAnswerIssue.Failed].badgeClassName).toContain(
      "text-red-700",
    );
  });
});

describe("the call kinds' words", () => {
  test("every kind has a title and an activity line", () => {
    for (const kind of Object.values(LlmCallKind)) {
      expect(LLM_CALL_KIND_TITLES[kind]).toBeTruthy();
      expect(LLM_ACTIVITY_LABELS[kind]).toBeTruthy();
    }
  });

  test("the title is the title Common writes", () => {
    for (const kind of Object.values(LlmCallKind)) {
      expect({ kind, title: LLM_CALL_KIND_TITLES[kind] }).toEqual({
        kind,
        title: LlmCallKindUtil.getTitle(kind),
      });
    }
  });
});

describe("the sort options", () => {
  test("every sort the server knows is offered once, newest first", () => {
    expect(
      LLM_CONVERSATION_SORT_OPTIONS.map((option: LlmSortOption): string => {
        return option.sort;
      }),
    ).toEqual([
      LlmConversationSort.Newest,
      LlmConversationSort.Oldest,
      LlmConversationSort.MostExpensive,
      LlmConversationSort.Slowest,
      LlmConversationSort.MostCalls,
    ]);
    expect(
      LLM_CONVERSATION_SORT_OPTIONS.map((option: LlmSortOption): string => {
        return option.sort;
      }).sort(),
    ).toEqual(Object.values(LlmConversationSort).sort());
  });

  test("a sort's label, and newest first for anything else", () => {
    expect(getLlmSortLabel(LlmConversationSort.Slowest)).toBe("Slowest answers");
    expect(getLlmSortLabel("cheapest" as LlmConversationSort)).toBe("Newest first");
  });
});

describe("the words in every language", () => {
  test("every word is a key the Dashboard ships", () => {
    for (const word of allWords()) {
      expect({ word, inEnglish: typeof ENGLISH[word] === "string" }).toEqual({
        word,
        inEnglish: true,
      });
    }
  });

  test.each(LOCALES)("%s has its own words for every one", (locale: string) => {
    const translations: Record<string, unknown> = readJson(
      path.join(LOCALES_DIR, `${locale}.json`),
    );
    const progress: Record<string, unknown> = readJson(
      path.join(PROGRESS_DIR, `${locale}.json`),
    );
    const sameAsEnglish: Set<string> = new Set<string>([
      ...GLOBAL_SAME_AS_ENGLISH,
      ...((progress["sameAsEnglish"] as Array<string> | undefined) || []),
    ]);
    const untranslated: Array<string> = [];

    for (const word of allWords()) {
      const value: unknown = translations[word];

      if (typeof value !== "string" || !value.trim()) {
        untranslated.push(`${word}: missing`);
      } else if (value === word && !sameAsEnglish.has(word)) {
        untranslated.push(word);
      }
    }

    expect(untranslated).toEqual([]);
  });
});
