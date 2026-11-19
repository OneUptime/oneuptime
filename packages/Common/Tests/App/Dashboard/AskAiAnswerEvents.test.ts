import {
  getAnswerRatedEvent,
  getDocsNotCoveredEvent,
  takeNewDocsNotCovered,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiAnswerEvents";
import AIChatMessageStatus from "../../../Types/AI/AIChatMessageStatus";
import {
  AIChatCitation,
  AIChatCitationTargetType,
} from "../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT ASK AI'S ANSWERS TELL ITS ANALYTICS (#7064): each rating with the
 * kind of answer it rated, and each answer that said "The docs do not
 * cover this." - once, only for an answer the person watched being
 * written, with the docs pages it read and never the question.
 */

const read: (page: string) => AIChatCitation = (
  page: string,
): AIChatCitation => {
  return {
    id: `C-${page}`,
    toolName: "read_docs",
    label: `Docs: ${page}`,
    queryArguments: { page },
    rowCount: 1,
    target: {
      type: AIChatCitationTargetType.DocsPage,
      params: { page, language: "en" },
    },
  };
};

const NOT_COVERED: string =
  "The docs do not cover this. I read SMS [C1] and Paging [C2].";

describe("ask_ai/answer_rated", () => {
  test("carries the rating and the kind of answer it rated", () => {
    expect(
      getAnswerRatedEvent({
        feedback: "down",
        message: { citations: [read("notifications/sms")] },
      }),
    ).toEqual({ rating: "down", kind: "docs" });
    expect(
      getAnswerRatedEvent({
        feedback: "up",
        message: {
          toolActions: [{ toolName: "set_up_paging" }],
        },
      }),
    ).toEqual({ rating: "up", kind: "setup" });
  });

  test("a rating cleared, or an answer it does not find, still says what it can", () => {
    expect(getAnswerRatedEvent({ feedback: null })).toEqual({
      rating: "cleared",
      kind: "none",
    });
  });
});

describe("ask_ai/docs_not_covered", () => {
  test("the docs page it read first, and how many it read", () => {
    expect(
      getDocsNotCoveredEvent([
        read("notifications/sms"),
        read("guides/paging"),
      ]),
    ).toEqual({ page: "notifications/sms", page_count: 2 });
    expect(getDocsNotCoveredEvent([])).toEqual({ page_count: 0 });
  });

  test("once, for an answer the person watched being written, the poll it is first brought finished", () => {
    const writing: Set<string> = new Set<string>();
    const counted: Set<string> = new Set<string>();
    const id: string = "answer-1";

    expect(
      takeNewDocsNotCovered({
        message: { id, status: AIChatMessageStatus.InProgress },
        writing,
        counted,
      }),
    ).toBeNull();

    const sent: JSONObject | null = takeNewDocsNotCovered({
      message: {
        id,
        status: AIChatMessageStatus.Completed,
        contentInMarkdown: NOT_COVERED,
        citations: [read("notifications/sms"), read("guides/paging")],
      },
      writing,
      counted,
    });

    expect(sent).toEqual({ page: "notifications/sms", page_count: 2 });

    // Every later poll brings the same answer: counted once.
    expect(
      takeNewDocsNotCovered({
        message: {
          id,
          status: AIChatMessageStatus.Completed,
          contentInMarkdown: NOT_COVERED,
        },
        writing,
        counted,
      }),
    ).toBeNull();
  });

  test("an answer already finished when first brought - an old conversation opened again - counts nothing", () => {
    expect(
      takeNewDocsNotCovered({
        message: {
          id: "old-answer",
          status: AIChatMessageStatus.Completed,
          contentInMarkdown: NOT_COVERED,
        },
        writing: new Set<string>(),
        counted: new Set<string>(),
      }),
    ).toBeNull();
  });

  test("an answer that answers, failed or was stopped counts nothing", () => {
    for (const message of [
      {
        status: AIChatMessageStatus.Completed,
        contentInMarkdown: "1. Open Notification Methods [C1].",
      },
      {
        status: AIChatMessageStatus.Error,
        contentInMarkdown: NOT_COVERED,
      },
      {
        status: AIChatMessageStatus.Cancelled,
        contentInMarkdown: NOT_COVERED,
      },
    ]) {
      const writing: Set<string> = new Set<string>(["answer"]);

      expect(
        takeNewDocsNotCovered({
          message: { id: "answer", ...message },
          writing,
          counted: new Set<string>(),
        }),
      ).toBeNull();
    }
  });

  test("in the language Ask AI answered in", () => {
    expect(
      takeNewDocsNotCovered({
        message: {
          id: "answer-de",
          status: AIChatMessageStatus.Completed,
          contentInMarkdown:
            "Die Dokumentation deckt das nicht ab. Ich habe SMS gelesen [C1].",
          citations: [read("notifications/sms")],
        },
        writing: new Set<string>(["answer-de"]),
        counted: new Set<string>(),
      }),
    ).toEqual({ page: "notifications/sms", page_count: 1 });
  });

  test("never carries the question or the answer", () => {
    const sent: JSONObject | null = takeNewDocsNotCovered({
      message: {
        id: "answer-2",
        status: AIChatMessageStatus.Completed,
        contentInMarkdown: `${NOT_COVERED} Ask your admin, maya@acme.example.`,
        citations: [read("notifications/sms")],
      },
      writing: new Set<string>(["answer-2"]),
      counted: new Set<string>(),
    });

    expect(Object.keys(sent || {}).sort()).toEqual(["page", "page_count"]);
    expect(JSON.stringify(sent)).not.toContain("maya");
    expect(JSON.stringify(sent)).not.toContain("cover");
  });
});

describe("the chat sends them", () => {
  test("useAiChat sends each event through these builders", () => {
    const chat: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/useAiChat.ts",
      ),
      "utf8",
    );

    expect(chat).toContain("ProductEventName.AskAiDocsNotCovered");
    expect(chat).toContain("takeNewDocsNotCovered({");
    expect(chat).toContain("getAnswerRatedEvent({");
  });
});
