import DocsAIReader from "../../../FeatureSet/Docs/Utils/AIDocsReader";
import {
  AskAiEvalCase,
  getHowDoICases,
} from "../../../scripts/ask-ai-eval-cases";
import AIDocsLibrary from "Common/Server/Utils/AI/Docs/AIDocsLibrary";
import {
  AskAiGrade,
  gradeHowDoITurn,
} from "Common/Server/Utils/AI/Eval/AskAi/AskAiEvalGrades";
import {
  AskAiEvalProjectKind,
  getAskAiEvalProject,
} from "Common/Server/Utils/AI/Eval/AskAi/AskAiEvalProject";
import AskAiEvalTurnRunner, {
  AskAiEvalTurn,
} from "Common/Server/Utils/AI/Eval/AskAi/AskAiEvalTurn";
import {
  ObservabilityAssistantModelCall,
  ObservabilityAssistantModelReply,
} from "Common/Server/Utils/AI/Chat/ObservabilityAssistant";
import { JSONObject } from "Common/Types/JSON";
import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import path from "path";

/*
 * A how-do-I question through the eval's turn (#7066), offline: a model
 * that searches the docs, reads the page, finds the Dashboard page and
 * answers citing them. The docs tools run for real over this repository's
 * docs, as a live run reads them, so the citations the grade reads are the
 * ones Ask AI makes: the docs page it read, and the Go to button's page.
 */

// The docs as this checkout has them, as the eval's command points them.
jest.mock("../../../FeatureSet/Docs/Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path") as typeof path;
  const root: string = nodePath.resolve(__dirname, "../../../FeatureSet/Docs");

  return {
    ContentPath: nodePath.join(root, "Content"),
    StaticPath: nodePath.join(root, "Static"),
    ViewsPath: nodePath.join(root, "Views"),
  };
});

function scripted(
  replies: Array<Partial<ObservabilityAssistantModelReply>>,
): (
  call: ObservabilityAssistantModelCall,
) => Promise<ObservabilityAssistantModelReply> {
  let index: number = 0;

  return async (): Promise<ObservabilityAssistantModelReply> => {
    const reply: Partial<ObservabilityAssistantModelReply> = replies[
      index++
    ] || { content: "Done." };

    return { content: "", tokenCount: 10, ...reply };
  };
}

function callOf(
  name: string,
  args: JSONObject,
): Partial<ObservabilityAssistantModelReply> {
  return {
    stopReason: "tool_use",
    toolCalls: [{ id: `call-${name}`, name, arguments: args }],
  };
}

const TEXT_WHEN_DOWN: AskAiEvalCase = getHowDoICases()[0]!;

beforeAll(() => {
  AIDocsLibrary.setReader(new DocsAIReader());
});

describe("a how-do-I question through the eval's turn", () => {
  test("cites the page it read and offers the page it found, and the grade reads both", async () => {
    expect(TEXT_WHEN_DOWN.asked).toBe(
      "How do I get a text when my site is down?",
    );

    const turn: AskAiEvalTurn = await AskAiEvalTurnRunner.ask({
      question: TEXT_WHEN_DOWN.asked,
      project: getAskAiEvalProject(AskAiEvalProjectKind.PagesNobody),
      language: "en",
      callModel: scripted([
        callOf("search_docs", {
          query: "SMS notification when a monitor is down",
        }),
        callOf("read_docs", { page: "notifications/notification-methods" }),
        callOf("find_dashboard_page", { query: "Notification Methods" }),
        {
          content:
            "1. Add your phone number and verify it [C1][C2].\n\nOpen Notification Methods [C3]",
        },
      ]),
    });

    expect(turn.error).toBeUndefined();
    expect(
      turn.calls.map((call: { name: string }) => {
        return call.name;
      }),
    ).toEqual(["search_docs", "read_docs", "find_dashboard_page"]);

    const grade: AskAiGrade = gradeHowDoITurn(TEXT_WHEN_DOWN.howDoI!, turn);

    expect(grade).toEqual({ passed: true, reasons: [] });
  });

  test("an answer that cites nothing fails, with why", async () => {
    const turn: AskAiEvalTurn = await AskAiEvalTurnRunner.ask({
      question: TEXT_WHEN_DOWN.asked,
      project: getAskAiEvalProject(AskAiEvalProjectKind.PagesNobody),
      language: "en",
      callModel: scripted([
        { content: "Go to your settings and add a phone." },
      ]),
    });

    expect(gradeHowDoITurn(TEXT_WHEN_DOWN.howDoI!, turn).reasons).toEqual([
      "Cited no page that answers it (notifications/notification-methods or guides/paging); cited no docs page.",
      "Offered no Go to Phone Numbers for SMS Notifications button; offered none.",
    ]);
  });
});
