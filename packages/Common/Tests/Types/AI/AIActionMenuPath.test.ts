import { describe, expect, test } from "@jest/globals";
import {
  AIActionMenuPath,
  AIActionSentence,
  aiActionMenuPath,
  aiActionSentence,
  describeAIActionMenuPath,
  describeAIActionSentence,
  isAIActionMenuPath,
  isKnownAIActionSentence,
} from "../../../Types/AI/AIActionWords";
import { AI_TOOL_CITATIONS } from "../../../Types/AI/AIReadTableWords";
import { createTranslator, Translator } from "../../../Types/Translator";

/*
 * A DASHBOARD PAGE'S PLACE AND NAME, IN THE SENTENCE'S LANGUAGE (#8831).
 *
 * Ask AI's chip for a page it sends someone to read "Page: {{path}}", the
 * path an English string inside a translated sentence: "Seite: User
 * Settings > Alerts & Notifications > Notification Methods". The path is a
 * value of its own now, the page's place and name by the keys the
 * Dashboard's menus look them up by, each said in the sentence's language.
 * English - the label the model reads and the exports print - reads each
 * as the Dashboard draws it.
 */

const NOTIFICATION_METHODS: Array<string> = [
  "User Settings",
  "Alerts & Notifications",
  "Notification Methods",
];

// A German Dashboard's words for this suite.
const GERMAN: Record<string, string> = {
  "Page: {{path}}": "Seite: {{path}}",
  "User Settings": "Benutzereinstellungen",
  "Alerts & Notifications": "Warnungen und Benachrichtigungen",
  "Notification Methods": "Benachrichtigungsmethoden",
  Logs: "Logs",
  "Insights (explorer analytics)": "Einblicke",
};

const german: Translator = createTranslator((text: string) => {
  return GERMAN[text];
}, "de");

const pageSentence: (path: Array<string>) => AIActionSentence = (
  path: Array<string>,
): AIActionSentence => {
  return aiActionSentence(AI_TOOL_CITATIONS.dashboardPage, {
    path: aiActionMenuPath(path),
  });
};

describe("aiActionMenuPath", () => {
  test("holds the names it is given, as a copy", () => {
    const names: Array<string> = [...NOTIFICATION_METHODS];
    const value: AIActionMenuPath = aiActionMenuPath(names);

    names.push("More");

    expect(value).toEqual({ menuPath: NOTIFICATION_METHODS });
    expect(isAIActionMenuPath(value)).toBe(true);
    expect(isAIActionMenuPath({ menuPath: "Logs" })).toBe(false);
    expect(isAIActionMenuPath("Logs > Insights")).toBe(false);
  });
});

describe("describeAIActionMenuPath", () => {
  test("reads in English as the Dashboard draws each name, a key that names its meaning as its word", () => {
    expect(describeAIActionMenuPath(aiActionMenuPath(NOTIFICATION_METHODS))).toBe(
      "User Settings > Alerts & Notifications > Notification Methods",
    );
    expect(
      describeAIActionMenuPath(
        aiActionMenuPath(["Logs", "Insights (explorer analytics)"]),
      ),
    ).toBe("Logs > Insights");
  });

  test("says each name in the translator's language, and a name it has no wording of in English", () => {
    expect(
      describeAIActionMenuPath(aiActionMenuPath(NOTIFICATION_METHODS), german),
    ).toBe(
      "Benutzereinstellungen > Warnungen und Benachrichtigungen > Benachrichtigungsmethoden",
    );
    expect(
      describeAIActionMenuPath(
        aiActionMenuPath(["Logs", "Insights (explorer analytics)", "Kubernetes"]),
        german,
      ),
    ).toBe("Logs > Einblicke > Kubernetes");
  });
});

describe("a sentence with a page's place and name", () => {
  test("is one of the module's, so the Dashboard words it", () => {
    expect(isKnownAIActionSentence(pageSentence(NOTIFICATION_METHODS))).toBe(
      true,
    );
  });

  test("reads in English as the label the model reads, the same as the string it was before", () => {
    expect(describeAIActionSentence(pageSentence(NOTIFICATION_METHODS))).toBe(
      "Page: User Settings > Alerts & Notifications > Notification Methods",
    );
    expect(
      describeAIActionSentence(
        aiActionSentence(AI_TOOL_CITATIONS.dashboardPage, {
          path: NOTIFICATION_METHODS.join(" > "),
        }),
      ),
    ).toBe(describeAIActionSentence(pageSentence(NOTIFICATION_METHODS)));
    expect(
      describeAIActionSentence(
        pageSentence(["Logs", "Insights (explorer analytics)"]),
      ),
    ).toBe("Page: Logs > Insights");
  });

  test("reads wholly in German, the path's names with the sentence", () => {
    expect(
      describeAIActionSentence(pageSentence(NOTIFICATION_METHODS), german),
    ).toBe(
      "Seite: Benutzereinstellungen > Warnungen und Benachrichtigungen > Benachrichtigungsmethoden",
    );
  });

  test("reads wholly in English where the language has no wording of the sentence, its names too", () => {
    const partly: Translator = createTranslator((text: string) => {
      return text === "Notification Methods"
        ? "Benachrichtigungsmethoden"
        : undefined;
    }, "de");

    expect(
      describeAIActionSentence(pageSentence(NOTIFICATION_METHODS), partly),
    ).toBe(
      "Page: User Settings > Alerts & Notifications > Notification Methods",
    );
  });

  test("a saved chip whose path is a string reads that string as it was written", () => {
    expect(
      describeAIActionSentence(
        aiActionSentence(AI_TOOL_CITATIONS.dashboardPage, {
          path: "User Settings > Notification Methods",
        }),
        german,
      ),
    ).toBe("Seite: User Settings > Notification Methods");
  });

  test.each<[string, unknown]>([
    ["no names", { menuPath: [] }],
    ["a name that is no text", { menuPath: ["Logs", 4] }],
    ["an empty name", { menuPath: ["Logs", "  "] }],
    ["a name too long", { menuPath: ["x".repeat(201)] }],
    [
      "too many names",
      { menuPath: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] },
    ],
    ["names that are no list", { menuPath: "Logs > Insights" }],
  ])(
    "with %s is not the module's, and reads as the label it stores",
    (_case: string, path: unknown) => {
      expect(
        isKnownAIActionSentence({
          template: AI_TOOL_CITATIONS.dashboardPage,
          values: { path },
        }),
      ).toBe(false);
    },
  );

  test("eight names of up to 200 letters are the most it holds", () => {
    expect(
      isKnownAIActionSentence(
        pageSentence(["a", "b", "c", "d", "e", "f", "g", "x".repeat(200)]),
      ),
    ).toBe(true);
  });
});
