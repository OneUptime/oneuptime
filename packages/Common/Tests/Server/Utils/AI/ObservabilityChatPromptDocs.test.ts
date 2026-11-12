import { describe, expect, test } from "@jest/globals";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import AIChatPageContextType from "../../../../Types/AI/AIChatPageContext";
import {
  buildObservabilityChatSystemPrompt,
  DOCS_ANSWER_NOT_COVERED,
  ObservabilityChatSurface,
  ONEUPTIME_QUESTIONS_SECTION,
} from "../../../../Server/Utils/AI/Chat/ObservabilityChatPrompt";
import {
  FIND_DASHBOARD_PAGE_TOOL_NAME,
  READ_DOCS_TOOL_NAME,
  SEARCH_DOCS_TOOL_NAME,
} from "../../../../Server/Utils/AI/Toolbox/DocsTools";
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";

/*
 * THE SECOND KIND OF ANSWER (issue #6828). Ask AI was told to answer only
 * from the project's data, so "how do I...?" was refused. The prompt now
 * describes both kinds of question and lets the model pick its tools:
 * data questions keep their rules word for word, and questions about
 * OneUptime itself are answered from the docs - cited, in steps, ending at
 * the page, and "the docs do not cover this" rather than a guess.
 */

const NOW: Date = new Date("2026-11-12T10:00:00.000Z");

const promptFor: (data?: {
  permissionMode?: AIChatPermissionMode;
  surface?: ObservabilityChatSurface;
  chatApp?: boolean;
}) => string = (data?: {
  permissionMode?: AIChatPermissionMode;
  surface?: ObservabilityChatSurface;
  chatApp?: boolean;
}): string => {
  return buildObservabilityChatSystemPrompt({
    currentTime: NOW,
    permissionMode: data?.permissionMode || AIChatPermissionMode.ReadOnly,
    surface: data?.surface,
    ...(data?.chatApp
      ? {
          chatApp: {
            name: "Slack",
            incidentCommand: "/oneuptime incident",
            pageCommand: "/oneuptime page",
            askAiUrl: "https://oneuptime.example/dashboard",
          },
        }
      : {}),
  });
};

describe("Ask AI's prompt: questions about OneUptime itself", () => {
  test("keeps the data rule for the project's data, word for word", () => {
    expect(promptFor()).toContain(
      '1. Answer ONLY from tool results. If the tools did not return the data needed to answer, say "I could not determine that from the available data" and state exactly which queries you ran and what came back empty. Never pad, never guess.',
    );
  });

  test("sends a question about how OneUptime works to the docs, never to memory", () => {
    const prompt: string = promptFor();
    expect(prompt).toContain(
      "A question about how OneUptime itself works is answered from the docs tools' results the same way",
    );
    expect(prompt).toContain("never from memory");
    expect(prompt).toContain(
      "You also answer questions about how OneUptime itself works",
    );
  });

  test("is in every prompt: each mode, the Dashboard, a chat app and an autonomous run", () => {
    for (const permissionMode of [
      AIChatPermissionMode.ReadOnly,
      AIChatPermissionMode.AskForApproval,
      AIChatPermissionMode.AutoRun,
    ]) {
      expect(promptFor({ permissionMode })).toContain(
        ONEUPTIME_QUESTIONS_SECTION,
      );
    }
    expect(promptFor({ chatApp: true })).toContain(ONEUPTIME_QUESTIONS_SECTION);
    expect(
      promptFor({ surface: ObservabilityChatSurface.AutonomousRun }),
    ).toContain(ONEUPTIME_QUESTIONS_SECTION);
  });

  test("names the docs tools by the names the toolbox gives them", () => {
    for (const name of [
      SEARCH_DOCS_TOOL_NAME,
      READ_DOCS_TOOL_NAME,
      FIND_DASHBOARD_PAGE_TOOL_NAME,
    ]) {
      expect(ONEUPTIME_QUESTIONS_SECTION).toContain(name);
      expect(AIToolbox.getToolByName(name)).toBeDefined();
    }
  });

  test("asks for a citation for every claim, and never one of a search", () => {
    expect(ONEUPTIME_QUESTIONS_SECTION).toContain(
      `Cite the ${READ_DOCS_TOOL_NAME} result [C#] after every claim taken from it`,
    );
    expect(ONEUPTIME_QUESTIONS_SECTION).toContain(
      `A ${SEARCH_DOCS_TOOL_NAME} result is not evidence`,
    );
  });

  test('says "the docs do not cover this" rather than guess', () => {
    expect(DOCS_ANSWER_NOT_COVERED).toBe("The docs do not cover this.");
    expect(ONEUPTIME_QUESTIONS_SECTION).toContain(
      `answer "${DOCS_ANSWER_NOT_COVERED}"`,
    );
    expect(ONEUPTIME_QUESTIONS_SECTION).toContain(
      "Never fill the gap from memory",
    );
  });

  test("answers a how-do-I in steps, and ends at the page by its citation, never an address", () => {
    expect(ONEUPTIME_QUESTIONS_SECTION).toContain("short numbered steps");
    expect(ONEUPTIME_QUESTIONS_SECTION).toContain(
      `call ${FIND_DASHBOARD_PAGE_TOOL_NAME}`,
    );
    expect(ONEUPTIME_QUESTIONS_SECTION).toContain(
      "never write an address of the Dashboard or of the docs yourself",
    );
  });

  test("reads the docs in the person's language, and answers in it", () => {
    expect(ONEUPTIME_QUESTIONS_SECTION).toContain(
      "Pass language: the code of the language the person writes in",
    );
    expect(ONEUPTIME_QUESTIONS_SECTION).toContain(
      "you still answer in the person's language",
    );
  });

  test("mixes the two for a question that needs both", () => {
    expect(ONEUPTIME_QUESTIONS_SECTION).toContain(
      "why did nobody get paged for INC-12?",
    );
  });

  test("leaves the page context's rule as it was: the page is not evidence", () => {
    const prompt: string = buildObservabilityChatSystemPrompt({
      currentTime: NOW,
      permissionMode: AIChatPermissionMode.ReadOnly,
      pageContext: {
        type: AIChatPageContextType.Incident,
        entityId: "11111111-1111-1111-1111-111111111111",
      },
    });
    expect(prompt).toContain(
      "every factual claim still comes from tool results with citations",
    );
  });
});
