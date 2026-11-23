import { describe, expect, test } from "@jest/globals";
import {
  AIChatCitation,
  AIChatCitationTargetType,
} from "../../../Types/AI/AIChatTypes";
import {
  AskAiAnswerKind,
  DOCS_NOT_COVERED_SENTENCE,
  DOCS_NOT_COVERED_SENTENCES,
  getAskAiAnswerKind,
  getAskAiAnswerKindOf,
  getDocsNotCoveredSentence,
  getDocsPagesRead,
  isDocsNotCoveredAnswer,
} from "../../../Types/AI/AskAiAnswers";
import { SUPPORTED_DASHBOARD_LANGUAGE_CODES } from "../../../Types/Dashboard/DashboardLanguage";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../Types/Docs/DocsLanguage";

/*
 * WHAT KIND OF ANSWER ASK AI GAVE, AND WHEN THE DOCS LET IT DOWN (#7064).
 * A rating says which kind of answer it rated, read from the tools the
 * answer ran - never from the question - and "The docs do not cover
 * this." is known in every language Ask AI answers in, so each docs gap
 * is counted whatever the person wrote in.
 */

const citation: (data: {
  toolName: string;
  page?: string | undefined;
}) => AIChatCitation = (data: {
  toolName: string;
  page?: string | undefined;
}): AIChatCitation => {
  return {
    id: `C-${data.toolName}-${data.page || ""}`,
    toolName: data.toolName,
    label: data.toolName,
    queryArguments: {},
    rowCount: 1,
    ...(data.page
      ? {
          target: {
            type: AIChatCitationTargetType.DocsPage,
            params: { page: data.page, language: "en" },
          },
        }
      : {}),
  };
};

describe("the kind of an answer", () => {
  test.each<[string, Array<string>, Array<string>, AskAiAnswerKind]>([
    [
      "read only the docs",
      ["search_docs", "read_docs"],
      [],
      AskAiAnswerKind.Docs,
    ],
    ["found only a page", ["find_dashboard_page"], [], AskAiAnswerKind.Docs],
    [
      "read only data",
      ["query_incidents", "search_logs"],
      [],
      AskAiAnswerKind.Data,
    ],
    [
      "read both",
      ["query_incidents", "read_docs", "find_dashboard_page"],
      [],
      AskAiAnswerKind.DocsAndData,
    ],
    [
      "proposed a setup plan",
      ["read_docs", "query_monitors"],
      ["set_up_website_monitoring", "set_up_paging"],
      AskAiAnswerKind.Setup,
    ],
    [
      "proposed another action",
      [],
      ["acknowledge_incident"],
      AskAiAnswerKind.Data,
    ],
    ["ran nothing", [], [], AskAiAnswerKind.None],
    ["ran a tool with no name", ["", ""], [], AskAiAnswerKind.None],
  ])(
    "%s",
    (
      _name: string,
      tools: Array<string>,
      actions: Array<string>,
      kind: AskAiAnswerKind,
    ) => {
      expect(
        getAskAiAnswerKind({ toolNames: tools, actionNames: actions }),
      ).toBe(kind);
    },
  );

  test("an answer's kind is read from its citations and the actions it proposed", () => {
    expect(
      getAskAiAnswerKindOf({
        citations: [citation({ toolName: "read_docs", page: "a/b" })],
        toolActions: [{ toolName: "publish_status_page" }],
      }),
    ).toBe(AskAiAnswerKind.Setup);
    expect(
      getAskAiAnswerKindOf({
        citations: [citation({ toolName: "read_docs", page: "a/b" })],
      }),
    ).toBe(AskAiAnswerKind.Docs);
    expect(getAskAiAnswerKindOf({})).toBe(AskAiAnswerKind.None);
  });
});

describe("the docs pages an answer read", () => {
  test("each page its docs citations opened, once, in the order read", () => {
    expect(
      getDocsPagesRead([
        citation({ toolName: "search_docs" }),
        citation({ toolName: "read_docs", page: "notifications/sms" }),
        citation({ toolName: "query_incidents" }),
        citation({ toolName: "read_docs", page: "guides/paging" }),
        citation({ toolName: "read_docs", page: "notifications/sms" }),
      ]),
    ).toEqual(["notifications/sms", "guides/paging"]);
    expect(getDocsPagesRead(undefined)).toEqual([]);
  });
});

describe('"The docs do not cover this."', () => {
  test("is known in every language the Dashboard and the docs are read in", () => {
    for (const language of [
      ...SUPPORTED_DASHBOARD_LANGUAGE_CODES,
      ...SUPPORTED_DOCS_LANGUAGE_CODES,
    ]) {
      expect({
        language,
        has: Boolean(DOCS_NOT_COVERED_SENTENCES[language]),
      }).toEqual({ language, has: true });
    }

    expect(DOCS_NOT_COVERED_SENTENCES["en"]).toBe(DOCS_NOT_COVERED_SENTENCE);
    expect(
      new Set<string>(Object.values(DOCS_NOT_COVERED_SENTENCES)).size,
    ).toBe(Object.keys(DOCS_NOT_COVERED_SENTENCES).length);
  });

  test("a language with none reads it in English", () => {
    expect(getDocsNotCoveredSentence("de")).toBe(
      "Die Dokumentation deckt das nicht ab.",
    );
    expect(getDocsNotCoveredSentence("xx")).toBe(DOCS_NOT_COVERED_SENTENCE);
    expect(getDocsNotCoveredSentence(undefined)).toBe(
      DOCS_NOT_COVERED_SENTENCE,
    );
  });

  test.each(Object.entries(DOCS_NOT_COVERED_SENTENCES))(
    "an answer that says it in %s is one the docs did not cover",
    (_language: string, sentence: string) => {
      expect(
        isDocsNotCoveredAnswer(
          `${sentence} I read Notification Methods [C2] and Paging [C3].`,
        ),
      ).toBe(true);
    },
  );

  test("whatever its case, spacing or last stop", () => {
    expect(isDocsNotCoveredAnswer("the docs  do not cover this")).toBe(true);
    expect(isDocsNotCoveredAnswer("**The docs do not cover this.**")).toBe(
      true,
    );
    // Persian written with or without its zero-width non-joiner.
    expect(isDocsNotCoveredAnswer("مستندات این موضوع را پوشش نمیدهد.")).toBe(
      true,
    );
  });

  test("an answer that answers is not one", () => {
    for (const answer of [
      "1. Open Notification Methods [C2].\n2. Add your number.",
      "The docs cover this on Notification Methods [C2].",
      "",
      undefined,
    ]) {
      expect(isDocsNotCoveredAnswer(answer)).toBe(false);
    }
  });
});
