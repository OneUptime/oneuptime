import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AI_ACTION_LINES,
  AI_ACTION_TITLES,
  AIActionWords,
  aiActionList,
  aiActionResourceByName,
  aiActionSentence,
  describeAIActionWords,
} from "../../../../Types/AI/AIActionWords";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "../../../../Types/AI/AIChatTypes";
import { toolActionsToMarkdown } from "../../../../UI/Utils/AIChatExport/ChatWidgetMarkdown";

/*
 * AN EXPORTED CONVERSATION SAYS EACH ACTION IN THE ENGLISH IT STORES.
 *
 * An AI action keeps its card's title and line twice: as sentences
 * (`words`), which the Dashboard says in the reader's language, and in
 * English (`title`, `description`). The conversation's Markdown and PDF
 * exports are English throughout - the PDF's fonts draw Latin letters only
 * - so they print the stored English, exactly as before the sentences
 * existed: never a template, never a sentence's JSON.
 */

const WORDS: AIActionWords = {
  title: aiActionSentence(AI_ACTION_TITLES.createIncident, {
    title: "Checkout down",
  }),
  description: [
    aiActionSentence(AI_ACTION_LINES.linkedTo, {
      resources: aiActionList([
        aiActionResourceByName({ noun: "host", name: "test01" }),
        aiActionResourceByName({ noun: "Kubernetes cluster", name: "prod" }),
      ]),
    }),
  ],
};

function storedAction(): AIChatToolAction {
  const english: { title: string; description?: string | undefined } =
    describeAIActionWords(WORDS);

  return {
    id: "call-1",
    toolName: "create_incident",
    title: english.title,
    ...(english.description ? { description: english.description } : {}),
    words: WORDS,
    arguments: { title: "Checkout down", severityName: "SEV2" },
    isMutation: true,
    requiresApproval: true,
    status: AIChatToolActionStatus.Executed,
  };
}

describe("the Markdown export", () => {
  test("prints an action's English title and line, as the server wrote them", () => {
    const markdown: string = toolActionsToMarkdown([storedAction()]);

    expect(markdown).toContain(
      "- **Executed** — Create incident: Checkout down",
    );
    expect(markdown).toContain(
      '  - Linked to host "test01", Kubernetes cluster "prod".',
    );
  });

  test("never a template or a sentence's JSON", () => {
    const markdown: string = toolActionsToMarkdown([storedAction()]);

    expect(markdown).not.toContain("{{");
    expect(markdown).not.toContain("template");
    expect(markdown).not.toContain("namedArguments");
  });

  test("an action saved before its words exports as it always did", () => {
    const saved: AIChatToolAction = storedAction();
    delete saved.words;

    expect(toolActionsToMarkdown([saved])).toBe(
      toolActionsToMarkdown([storedAction()]),
    );
  });
});

describe("both exports read the stored English", () => {
  const EXPORTS: Array<[string, string]> = [
    [
      "the Markdown export",
      "../../../../UI/Utils/AIChatExport/ChatWidgetMarkdown.ts",
    ],
    [
      "the PDF export",
      "../../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Export/ConversationPdf.ts",
    ],
  ];

  test.each(EXPORTS)(
    "%s prints action.title and action.description, never action.words",
    (_name: string, file: string) => {
      const source: string = fs.readFileSync(
        path.resolve(__dirname, file),
        "utf8",
      );

      expect(source).toContain("action.title");
      expect(source).toContain("action.description");
      expect(source).not.toContain("action.words");
      expect(source).not.toContain(".words");
    },
  );
});
