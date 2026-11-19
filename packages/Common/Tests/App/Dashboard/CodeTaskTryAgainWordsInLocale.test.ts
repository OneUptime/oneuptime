import { describe, expect, test } from "@jest/globals";
import {
  CODE_TASK_ASKED_AGAIN,
  CODE_TASK_TRY_AGAIN_REFUSAL_KEYS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskCopy";
import {
  CODE_TASK_RETRY_REASONS_ON_ROWS,
  CODE_TASK_ROW_NOT_TRIED_AGAIN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskList";
import { CODE_TASK_JUMP_TO_NEWEST } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskJumpToNewest";
import {
  CODE_TASK_SHOW_EARLIER_TURNS,
  CODE_TASK_TURNS_NOT_SHOWN_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskTurnsNotShown";
import { CODE_TASK_TRY_AGAIN_REFUSALS } from "../../../Types/AI/CodeTaskTryAgain";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE WORDS OF A LONG TASK'S PAGE AND OF TRY AGAIN, IN EVERY DASHBOARD
 * LANGUAGE (#7128, #7129, #6508, #6509): Show earlier turns, Jump to
 * newest, who asked a fix again, why Retry selected left a task out - and
 * every sentence the server refuses Try again with, word for word as the
 * server writes it (Types/AI/CodeTaskTryAgain), which the page looks up in
 * the reader's language wherever it says one (ErrorInSentence).
 */

const ENGLISH: Record<string, string> = readDashboardLocale("en");

const SENTENCES: Array<string> = [
  CODE_TASK_SHOW_EARLIER_TURNS,
  CODE_TASK_JUMP_TO_NEWEST,
  CODE_TASK_ASKED_AGAIN,
  CODE_TASK_ROW_NOT_TRIED_AGAIN,
  ...CODE_TASK_TRY_AGAIN_REFUSAL_KEYS,
];

describe("the refusals the page words are the server's, word for word", () => {
  test("every refusal of Try again, and nothing else", () => {
    expect([...CODE_TASK_TRY_AGAIN_REFUSAL_KEYS].sort()).toEqual(
      [...CODE_TASK_TRY_AGAIN_REFUSALS].sort(),
    );
  });

  test("English holds each sentence as itself", () => {
    for (const sentence of SENTENCES) {
      expect({ sentence, english: ENGLISH[sentence] }).toEqual({
        sentence,
        english: sentence,
      });
    }

    expect(ENGLISH[`${CODE_TASK_RETRY_REASONS_ON_ROWS.other}_one`]).toBe(
      CODE_TASK_RETRY_REASONS_ON_ROWS.one,
    );
  });
});

describe.each([...DASHBOARD_LANGUAGES])("in %s", (language: string) => {
  const words: Record<string, string> = readDashboardLocale(language);

  test("each sentence is the language's own, with the values it names", () => {
    for (const sentence of SENTENCES) {
      expect({
        sentence,
        worded: isWordedInDashboardLocale(sentence, language),
      }).toEqual({ sentence, worded: true });
      expect({
        sentence,
        values: placeholdersOf(words[sentence]!),
      }).toEqual({ sentence, values: placeholdersOf(sentence) });
    }
  });

  test("why Retry selected left tasks out reads with a count the reader's way, at every count", () => {
    const translator: Translator = dashboardTranslator(language);

    for (const key of [
      CODE_TASK_RETRY_REASONS_ON_ROWS.other,
      `${CODE_TASK_RETRY_REASONS_ON_ROWS.other}_one`,
    ]) {
      expect(placeholdersOf(words[key]!)).toEqual(["{{count}}"]);
    }

    for (const count of [1, 2, 5, 21, 50]) {
      const sentence: string = translator.translatePlural(
        CODE_TASK_RETRY_REASONS_ON_ROWS,
        count,
      );

      expect(sentence).not.toContain("{{");
      expect(sentence).not.toContain("could not be tried again");
    }
  });

  test("the line above the turns not shown still says how many, beside its button", () => {
    const translator: Translator = dashboardTranslator(language);

    expect(
      translator.translatePlural(CODE_TASK_TURNS_NOT_SHOWN_COPY, 51),
    ).not.toContain("earlier turns");
    expect(translator.translateText(CODE_TASK_SHOW_EARLIER_TURNS)).not.toBe(
      CODE_TASK_SHOW_EARLIER_TURNS,
    );
  });
});
