import { describe, expect, test } from "@jest/globals";
import {
  LLM_CONVERSATION_MAX_FILTER_LENGTH,
  LlmConversationKey,
  LlmConversationKeyKind,
  LlmConversationKeyUtil,
  LlmConversationListResponse,
  LlmConversationSort,
  emptyIssueCounts,
  readConversationIssueFilter,
  readConversationListResponse,
  readConversationSort,
  readConversationSummary,
  readFilterText,
  readIssueCounts,
  readNumber,
  readOptionalNumber,
} from "../../../Types/Telemetry/LlmConversationApi";
import { LlmAnswerIssue } from "../../../Types/Telemetry/LlmAnswerIssue";

/*
 * The conversation key travels in a URL and in request bodies; the list and
 * summary arrive as untyped JSON. Both are read as untrusted input.
 */

describe("LlmConversationKeyUtil", () => {
  test("a conversation id and a trace id round-trip", () => {
    const keys: Array<LlmConversationKey> = [
      {
        kind: LlmConversationKeyKind.Conversation,
        value: "conv_5j66UpCpwteGg4YSxUnt7lPY",
      },
      {
        kind: LlmConversationKeyKind.Conversation,
        value: "a/b?c#d e%f:ünïcode",
      },
      {
        kind: LlmConversationKeyKind.Request,
        value: "0af7651916cd43dd8448eb211c80319c",
      },
    ];

    for (const key of keys) {
      expect(
        LlmConversationKeyUtil.decode(LlmConversationKeyUtil.encode(key)),
      ).toEqual(key);
      expect(
        LlmConversationKeyUtil.fromPathSegment(
          LlmConversationKeyUtil.toPathSegment(key),
        ),
      ).toEqual(key);
    }
  });

  test("a path segment never holds a slash, a question mark or a hash", () => {
    const segment: string = LlmConversationKeyUtil.toPathSegment({
      kind: LlmConversationKeyKind.Conversation,
      value: "a/b?c#d",
    });

    expect(segment).not.toMatch(/[/?#]/);
  });

  test("trace ids are read case-insensitively and must be 32 hex characters", () => {
    expect(
      LlmConversationKeyUtil.decode("t:0AF7651916CD43DD8448EB211C80319C"),
    ).toEqual({
      kind: LlmConversationKeyKind.Request,
      value: "0af7651916cd43dd8448eb211c80319c",
    });
    expect(LlmConversationKeyUtil.decode("t:0af76519")).toBeNull();
    expect(
      LlmConversationKeyUtil.decode("t:zzf7651916cd43dd8448eb211c80319c"),
    ).toBeNull();
  });

  test.each([
    [""],
    ["c:"],
    ["x:abc"],
    ["conv-without-prefix"],
    [`c:${"x".repeat(2000)}`],
    [42],
    [null],
    [undefined],
    [{ kind: "conversation" }],
  ])("%p is not a key", (raw: unknown) => {
    expect(LlmConversationKeyUtil.decode(raw)).toBeNull();
  });

  test("a malformed URL escape is not a key", () => {
    expect(LlmConversationKeyUtil.fromPathSegment("c%3A%E0%A4%A")).toBeNull();
    expect(LlmConversationKeyUtil.fromPathSegment("")).toBeNull();
    expect(LlmConversationKeyUtil.fromPathSegment(undefined)).toBeNull();
  });
});

describe("number readers", () => {
  test("64-bit counters arrive as strings", () => {
    expect(readNumber("12")).toBe(12);
    expect(readNumber(3.5)).toBe(3.5);
    expect(readNumber("nope")).toBe(0);
    expect(readNumber(null)).toBe(0);
    expect(readNumber(Number.POSITIVE_INFINITY)).toBe(0);
  });

  test("an optional number distinguishes none from zero", () => {
    expect(readOptionalNumber("0")).toBe(0);
    expect(readOptionalNumber(null)).toBeNull();
    expect(readOptionalNumber("")).toBeNull();
    expect(readOptionalNumber("x")).toBeNull();
  });
});

describe("request readers", () => {
  test("a sort is one of the known sorts, else newest", () => {
    expect(readConversationSort(LlmConversationSort.Slowest)).toBe(
      LlmConversationSort.Slowest,
    );
    expect(readConversationSort("loudest")).toBe(LlmConversationSort.Newest);
    expect(readConversationSort(undefined)).toBe(LlmConversationSort.Newest);
  });

  test("an issue filter is any, a known issue, or none", () => {
    expect(readConversationIssueFilter("any")).toBe("any");
    expect(readConversationIssueFilter("cut_off")).toBe(LlmAnswerIssue.CutOff);
    expect(readConversationIssueFilter("CUT_OFF")).toBeUndefined();
    expect(readConversationIssueFilter(["refused"])).toBeUndefined();
    expect(readConversationIssueFilter(undefined)).toBeUndefined();
  });

  test("filter text is trimmed, bounded, and blank reads as none", () => {
    expect(readFilterText("  hello  ")).toBe("hello");
    expect(readFilterText("   ")).toBeUndefined();
    expect(readFilterText(5)).toBeUndefined();
    expect(readFilterText("y".repeat(999))?.length).toBe(
      LLM_CONVERSATION_MAX_FILTER_LENGTH,
    );
  });
});

describe("response readers", () => {
  test("issue counts keep every issue, at least 0", () => {
    expect(readIssueCounts({ refused: "2", flagged: -3, bogus: 9 })).toEqual({
      ...emptyIssueCounts(),
      refused: 2,
      flagged: 0,
    });
    expect(readIssueCounts("x")).toEqual(emptyIssueCounts());
  });

  test("a summary that is not an object reads as none", () => {
    expect(readConversationSummary(null)).toBeNull();
    expect(readConversationSummary([1])).toBeNull();
    expect(readConversationSummary({ conversationCount: "4" })).toMatchObject({
      conversationCount: 4,
      medianAnswerMs: null,
    });
  });

  test("a list response keeps valid rows and drops the rest", () => {
    const response: LlmConversationListResponse = readConversationListResponse({
      summary: { conversationCount: 2 },
      conversations: [
        { key: "c:one", title: "Hi", callCount: "3", models: ["gpt-4o", 1] },
        { key: "not-a-key" },
        null,
        "x",
        { key: "t:0af7651916cd43dd8448eb211c80319c" },
      ],
      hasMore: "true",
    });

    expect(
      response.conversations.map((row: { key: string }) => {
        return row.key;
      }),
    ).toEqual(["c:one", "t:0af7651916cd43dd8448eb211c80319c"]);
    expect(response.conversations[0]?.callCount).toBe(3);
    expect(response.conversations[0]?.models).toEqual(["gpt-4o"]);
    expect(response.conversations[1]?.kind).toBe(
      LlmConversationKeyKind.Request,
    );
    // Only a real true means there is more.
    expect(response.hasMore).toBe(false);
    expect(response.summary?.conversationCount).toBe(2);
  });

  test("anything else reads as an empty list", () => {
    expect(readConversationListResponse(undefined)).toEqual({
      summary: null,
      conversations: [],
      hasMore: false,
    });
  });
});
