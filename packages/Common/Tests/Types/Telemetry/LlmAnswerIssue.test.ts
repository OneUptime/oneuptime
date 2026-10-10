import { describe, expect, test } from "@jest/globals";
import {
  LLM_REFUSAL_OPENINGS,
  LlmAnswerContentSummary,
  LlmAnswerIssue,
  LlmAnswerIssueInfo,
  LlmAnswerIssueInput,
  LlmAnswerIssueUtil,
  LlmEvaluationResult,
} from "../../../Types/Telemetry/LlmAnswerIssue";
import { LlmCallKind } from "../../../Types/Telemetry/LlmCallKind";

/*
 * "Alert me when the AI answers badly" rests on these checks: every call is
 * judged once at ingest, the verdict is stored on the span, and the
 * conversation list, the replay and the AI / LLM monitor all read it. A
 * check that fires on a good answer pages someone for nothing; one that
 * misses a bad answer is a silent outage. Both directions are pinned.
 */

const RECORDED_TEXT: LlmAnswerContentSummary = {
  recorded: true,
  hasText: true,
  hasToolCall: false,
  hasMedia: false,
  hasRefusal: false,
  leadingText: "The weather in Paris is rainy.",
};

const NOT_RECORDED: LlmAnswerContentSummary = {
  recorded: false,
  hasText: false,
  hasToolCall: false,
  hasMedia: false,
  hasRefusal: false,
  leadingText: "",
};

function issues(input: Partial<LlmAnswerIssueInput>): Array<LlmAnswerIssue> {
  return LlmAnswerIssueUtil.getIssues({
    kind: LlmCallKind.Answer,
    statusIsError: false,
    errorType: "",
    finishReasons: ["stop"],
    outputTokens: 42,
    answer: RECORDED_TEXT,
    evaluations: [],
    ...input,
  });
}

function evaluation(
  label: string,
  name: string = "relevance",
): LlmEvaluationResult {
  return { name: name, label: label, score: null, explanation: "" };
}

describe("a good answer has no issues", () => {
  test("a stopped answer with text", () => {
    expect(issues({})).toEqual([]);
  });

  test("a tool request with no text is not empty", () => {
    expect(
      issues({
        finishReasons: ["tool_calls"],
        outputTokens: 0,
        answer: { ...RECORDED_TEXT, hasText: false, hasToolCall: true },
      }),
    ).toEqual([]);
  });

  test("a model asking for a tool is not empty even when the content was not recorded", () => {
    for (const reason of [
      "tool_calls",
      "tool_use",
      "function_call",
      "tool-calls",
    ]) {
      expect(
        issues({
          finishReasons: [reason],
          outputTokens: 0,
          answer: NOT_RECORDED,
        }),
      ).toEqual([]);
    }
  });

  test("an answer that only contains an image is not empty", () => {
    expect(
      issues({ answer: { ...RECORDED_TEXT, hasText: false, hasMedia: true } }),
    ).toEqual([]);
  });

  test("no finish reason and no token count proves nothing", () => {
    expect(
      issues({ finishReasons: [], outputTokens: null, answer: NOT_RECORDED }),
    ).toEqual([]);
  });
});

describe("failed", () => {
  test("a span with status Error", () => {
    expect(issues({ statusIsError: true })).toEqual([LlmAnswerIssue.Failed]);
  });

  test("an error.type on a span whose status was left unset", () => {
    expect(issues({ errorType: "rate_limit_exceeded" })).toEqual([
      LlmAnswerIssue.Failed,
    ]);
  });

  test("a finish reason of error (a stream that ended abnormally)", () => {
    expect(issues({ finishReasons: ["error"] })).toEqual([
      LlmAnswerIssue.Failed,
    ]);
  });

  test("a whitespace error type is no error", () => {
    expect(issues({ errorType: "   " })).toEqual([]);
  });

  test("a failed tool run, embedding or agent span is failed too", () => {
    for (const kind of [
      LlmCallKind.Tool,
      LlmCallKind.Embedding,
      LlmCallKind.Agent,
      LlmCallKind.Retrieval,
      LlmCallKind.Other,
    ]) {
      expect(issues({ kind: kind, statusIsError: true })).toEqual([
        LlmAnswerIssue.Failed,
      ]);
    }
  });

  test("a failed answer is never also called empty", () => {
    expect(
      issues({ statusIsError: true, outputTokens: 0, answer: NOT_RECORDED }),
    ).toEqual([LlmAnswerIssue.Failed]);
  });
});

describe("refused", () => {
  test.each([
    "content_filter",
    "CONTENT_FILTER",
    "content-filter",
    "refusal",
    "SAFETY",
    "PROHIBITED_CONTENT",
    "BLOCKLIST",
    "SPII",
    "RECITATION",
    "IMAGE_SAFETY",
    "guardrail_intervened",
    "content_filtered",
  ])("the provider's %s finish reason", (reason: string) => {
    expect(issues({ finishReasons: [reason] })).toContain(
      LlmAnswerIssue.Refused,
    );
  });

  test("a refusal part in the answer (OpenAI's refusal field)", () => {
    expect(
      issues({
        answer: { ...RECORDED_TEXT, hasText: false, hasRefusal: true },
      }),
    ).toEqual([LlmAnswerIssue.Refused]);
  });

  test.each([
    "I'm sorry, but I can't help with that request.",
    "I’m sorry, but I can’t share that.",
    "I am sorry, but I cannot provide medical advice.",
    "Sorry, but I can't do that.",
    "I can't help with that.",
    "I cannot assist with this.",
    "I'm unable to help with that.",
    "I must decline to answer.",
    "As an AI language model, I cannot browse the internet.",
    "  \n**I'm sorry, but I can't** continue.",
    '"I can\'t help with that."',
  ])("an answer opening with a stock refusal: %s", (text: string) => {
    expect(issues({ answer: { ...RECORDED_TEXT, leadingText: text } })).toEqual(
      [LlmAnswerIssue.Refused],
    );
  });

  test.each([
    "Sure! I can't wait to help. Here is the plan.",
    "Here is why I can't help with that is a common phrase: ...",
    "I'm sorry to hear that. Here is how to reset your password.",
    "I can help with that. First, open Settings.",
    "Unfortunately the API is down; retry in a minute.",
    "",
  ])("an answer that does not open with a refusal: %s", (text: string) => {
    expect(issues({ answer: { ...RECORDED_TEXT, leadingText: text } })).toEqual(
      [],
    );
  });

  test("a refusal is only an ANSWER's issue: a tool's output saying it is never one", () => {
    expect(
      issues({
        kind: LlmCallKind.Tool,
        finishReasons: ["content_filter"],
        answer: { ...RECORDED_TEXT, leadingText: "I can't help with that." },
      }),
    ).toEqual([]);
  });

  test("a refused answer with no text is refused, not empty", () => {
    expect(
      issues({
        finishReasons: ["content_filter"],
        outputTokens: 0,
        answer: { ...NOT_RECORDED },
      }),
    ).toEqual([LlmAnswerIssue.Refused]);
  });
});

describe("cut off", () => {
  test.each([
    "length",
    "max_tokens",
    "MAX_TOKENS",
    "max_output_tokens",
    "model_length",
    "model_context_window_exceeded",
  ])("the %s finish reason", (reason: string) => {
    expect(issues({ finishReasons: [reason] })).toEqual([
      LlmAnswerIssue.CutOff,
    ]);
  });

  test("any choice cut off marks the call", () => {
    expect(issues({ finishReasons: ["stop", "length"] })).toEqual([
      LlmAnswerIssue.CutOff,
    ]);
  });

  test("a reasoning model that spent every token thinking: cut off AND empty", () => {
    expect(
      issues({
        finishReasons: ["length"],
        outputTokens: 4096,
        answer: { ...RECORDED_TEXT, hasText: false, leadingText: "" },
      }),
    ).toEqual([LlmAnswerIssue.CutOff, LlmAnswerIssue.Empty]);
  });
});

describe("empty", () => {
  test("recorded content that holds nothing", () => {
    expect(
      issues({
        answer: {
          recorded: true,
          hasText: false,
          hasToolCall: false,
          hasMedia: false,
          hasRefusal: false,
          leadingText: "",
        },
      }),
    ).toEqual([LlmAnswerIssue.Empty]);
  });

  test("0 output tokens reported and no content recorded", () => {
    expect(issues({ outputTokens: 0, answer: NOT_RECORDED })).toEqual([
      LlmAnswerIssue.Empty,
    ]);
  });

  test("recorded text outranks a buggy 0 token count", () => {
    expect(issues({ outputTokens: 0, answer: RECORDED_TEXT })).toEqual([]);
  });

  test("an embedding has no answer to be empty", () => {
    expect(
      issues({
        kind: LlmCallKind.Embedding,
        outputTokens: 0,
        answer: NOT_RECORDED,
      }),
    ).toEqual([]);
  });
});

describe("flagged", () => {
  test.each([
    "fail",
    "FAIL",
    "Failed",
    "incorrect",
    "not_relevant",
    "Not Relevant",
    "not-relevant",
    "irrelevant",
    "unhelpful",
    "thumbs_down",
    "Thumbs Down",
    "toxic",
    "hallucinated",
    "ungrounded",
    "blocked",
  ])("a %s evaluation", (label: string) => {
    expect(issues({ evaluations: [evaluation(label)] })).toEqual([
      LlmAnswerIssue.Flagged,
    ]);
  });

  test.each(["pass", "relevant", "correct", "true", "false", "", "4", "good"])(
    "a %s evaluation does not flag",
    (label: string) => {
      expect(issues({ evaluations: [evaluation(label)] })).toEqual([]);
    },
  );

  test("a score without a label never flags: scores have no agreed direction", () => {
    expect(
      issues({
        evaluations: [
          { name: "relevance", label: "", score: 0, explanation: "" },
        ],
      }),
    ).toEqual([]);
  });

  test("one failing evaluation among passing ones flags the answer", () => {
    expect(
      issues({
        evaluations: [
          evaluation("pass", "groundedness"),
          evaluation("fail", "relevance"),
        ],
      }),
    ).toEqual([LlmAnswerIssue.Flagged]);
  });

  test("an agent run can be flagged too", () => {
    expect(
      issues({ kind: LlmCallKind.Agent, evaluations: [evaluation("fail")] }),
    ).toEqual([LlmAnswerIssue.Flagged]);
  });
});

describe("several issues at once", () => {
  test("come back in the one display order", () => {
    expect(
      issues({
        errorType: "timeout",
        finishReasons: ["length", "content_filter"],
        evaluations: [evaluation("fail")],
      }),
    ).toEqual([
      LlmAnswerIssue.Failed,
      LlmAnswerIssue.Refused,
      LlmAnswerIssue.CutOff,
      LlmAnswerIssue.Flagged,
    ]);
  });
});

describe("LlmAnswerIssueUtil - values and copy", () => {
  test("the persisted values never change", () => {
    expect(Object.values(LlmAnswerIssue)).toEqual([
      "failed",
      "refused",
      "cut_off",
      "empty",
      "flagged",
    ]);
  });

  test("fromValues keeps known values once, in display order, and drops the rest", () => {
    expect(
      LlmAnswerIssueUtil.fromValues([
        "flagged",
        "bogus",
        "failed",
        " refused ",
        "flagged",
        7,
        null,
      ]),
    ).toEqual([
      LlmAnswerIssue.Failed,
      LlmAnswerIssue.Refused,
      LlmAnswerIssue.Flagged,
    ]);
    expect(LlmAnswerIssueUtil.fromValues("failed")).toEqual([]);
    expect(LlmAnswerIssueUtil.fromValues(undefined)).toEqual([]);
  });

  test("every issue has a title, a plural and a one-sentence description", () => {
    const all: Array<LlmAnswerIssueInfo> = LlmAnswerIssueUtil.getAllInfo();

    expect(
      all.map((info: LlmAnswerIssueInfo) => {
        return info.issue;
      }),
    ).toEqual(LlmAnswerIssueUtil.getAllIssues());

    for (const info of all) {
      expect(info.title.length).toBeGreaterThan(0);
      expect(info.pluralTitle.length).toBeGreaterThan(info.title.length - 1);
      expect(info.description.endsWith(".")).toBe(true);
      expect(LlmAnswerIssueUtil.getInfo(info.issue)).toBe(info);
    }
  });

  test("the finish reason helpers agree with the checks", () => {
    expect(LlmAnswerIssueUtil.isRefusalFinishReason(" SAFETY ")).toBe(true);
    expect(LlmAnswerIssueUtil.isRefusalFinishReason("stop")).toBe(false);
    expect(LlmAnswerIssueUtil.isCutOffFinishReason("MAX_TOKENS")).toBe(true);
    expect(LlmAnswerIssueUtil.isCutOffFinishReason("stop")).toBe(false);
    expect(LlmAnswerIssueUtil.isToolFinishReason("tool_calls")).toBe(true);
    expect(LlmAnswerIssueUtil.isToolFinishReason("length")).toBe(false);
  });

  test("refusal openings are lower case, so the comparison is exact", () => {
    for (const opening of LLM_REFUSAL_OPENINGS) {
      expect(opening).toBe(opening.toLowerCase());
      expect(opening.trim()).toBe(opening);
    }
  });

  test("the refusal check reads only the opening of a megabyte answer", () => {
    const longAnswer: string = `I'm sorry, but I can't. ${"x".repeat(3_000_000)}`;
    const started: number = Date.now();

    expect(LlmAnswerIssueUtil.opensWithRefusal(longAnswer)).toBe(true);
    expect(
      LlmAnswerIssueUtil.opensWithRefusal(`Sure. ${"x".repeat(3_000_000)}`),
    ).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
