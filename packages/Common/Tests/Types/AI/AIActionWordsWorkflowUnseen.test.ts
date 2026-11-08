import { describe, expect, test } from "@jest/globals";
import {
  AI_ACTION_LINES,
  AI_ACTION_SENTENCES,
  AIActionSentence,
  aiActionSentence,
  describeAIActionSentence,
  getAIActionSentenceDirection,
  getAIActionSentenceLanguage,
  isKnownAIActionSentence,
} from "../../../Types/AI/AIActionWords";
import { createTranslator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * ISSUE #6291: THE CARD'S NEW LINES, IN EVERY READER'S LANGUAGE.
 *
 * A change Ask AI wrote from an older read of a workflow says on its card
 * what it would undo that was saved since ("This change undoes what was
 * saved after Ask AI read the workflow: Send Message to Slack."), or that
 * Ask AI never read the steps. Both are sentences of the module: each
 * Dashboard language words them whole, and the step names go in as data,
 * as the card writes them, never translated.
 */

const STEPS: string = "Send Message to Slack, Log";

const UNDOES: AIActionSentence = aiActionSentence(
  AI_ACTION_LINES.workflowUndoesSavedSince,
  { steps: STEPS },
);

const NOT_READ: AIActionSentence = aiActionSentence(
  AI_ACTION_LINES.workflowNotRead,
);

describe("the English the model, the exports and older readers get", () => {
  test("is the sentence as the card says it", () => {
    expect(describeAIActionSentence(UNDOES)).toBe(
      "This change undoes what was saved after Ask AI read the workflow: Send Message to Slack, Log.",
    );
    expect(describeAIActionSentence(NOT_READ)).toBe(
      "Ask AI wrote this change without reading the workflow's steps, so it may remove or change steps it has not seen.",
    );
  });

  test("both are sentences of the module, which the Dashboard trusts", () => {
    expect(AI_ACTION_SENTENCES).toContain(
      AI_ACTION_LINES.workflowUndoesSavedSince,
    );
    expect(AI_ACTION_SENTENCES).toContain(AI_ACTION_LINES.workflowNotRead);
    expect(isKnownAIActionSentence(UNDOES)).toBe(true);
    expect(isKnownAIActionSentence(NOT_READ)).toBe(true);
  });

  test("English holds both as themselves", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    expect(english[AI_ACTION_LINES.workflowUndoesSavedSince]).toBe(
      AI_ACTION_LINES.workflowUndoesSavedSince,
    );
    expect(english[AI_ACTION_LINES.workflowNotRead]).toBe(
      AI_ACTION_LINES.workflowNotRead,
    );
  });
});

describe.each(DASHBOARD_LANGUAGES)("%s", (language: string) => {
  test("words the line naming what the change undoes, with its placeholder, and the steps as written", () => {
    expect(
      isWordedInDashboardLocale(
        AI_ACTION_LINES.workflowUndoesSavedSince,
        language,
      ),
    ).toBe(true);
    expect(
      placeholdersOf(
        readDashboardLocale(language)[
          AI_ACTION_LINES.workflowUndoesSavedSince
        ]!,
      ),
    ).toEqual(["{{steps}}"]);

    const drawn: string = describeAIActionSentence(
      UNDOES,
      dashboardTranslator(language),
    );

    expect(drawn).toContain(STEPS);
    expect(drawn).not.toContain("This change undoes");
    expect(drawn).not.toContain("{{");
    expect(getAIActionSentenceLanguage(UNDOES, dashboardTranslator(language))).toBe(
      language,
    );
  });

  test("words the line saying Ask AI never read the steps", () => {
    expect(
      isWordedInDashboardLocale(AI_ACTION_LINES.workflowNotRead, language),
    ).toBe(true);
    expect(
      placeholdersOf(
        readDashboardLocale(language)[AI_ACTION_LINES.workflowNotRead]!,
      ),
    ).toEqual([]);
    expect(
      describeAIActionSentence(NOT_READ, dashboardTranslator(language)),
    ).not.toContain("without reading");
  });
});

describe("right to left, and a language not worded yet", () => {
  test("Persian reads right to left, the English step names set apart", () => {
    const persian: ReturnType<typeof dashboardTranslator> =
      dashboardTranslator("fa");

    expect(getAIActionSentenceDirection(UNDOES, persian)).toBe("rtl");
    expect(getAIActionSentenceDirection(NOT_READ, persian)).toBe("rtl");

    const drawn: string = describeAIActionSentence(UNDOES, persian, {
      setsValuesApart: true,
    });
    expect(drawn).toContain(isolated(STEPS));
    expect(withoutIsolateMarks(drawn)).toBe(
      describeAIActionSentence(UNDOES, persian),
    );
  });

  test("a language that has not worded it reads the whole sentence in English, never half of it", () => {
    const none: ReturnType<typeof createTranslator> = createTranslator(
      (): string | undefined => {
        return undefined;
      },
      "xx",
    );

    expect(describeAIActionSentence(UNDOES, none)).toBe(
      describeAIActionSentence(UNDOES),
    );
    expect(getAIActionSentenceLanguage(UNDOES, none)).toBe("en");
  });
});
