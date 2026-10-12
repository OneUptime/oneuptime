import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  LlmConversationView,
  buildLlmConversationListBody,
  fetchLlmAnswerStats,
  fetchLlmConversation,
  fetchLlmConversations,
  readLlmConversationView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationsApi";
import API from "../../../UI/Utils/API/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  LLM_ANSWER_STATS_ROUTE,
  LLM_CONVERSATIONS_ROUTE,
  LLM_CONVERSATION_PAGE_SIZE,
  LLM_CONVERSATION_ROUTE,
  LlmConversationKeyKind,
  LlmConversationListResponse,
  LlmConversationSort,
} from "../../../Types/Telemetry/LlmConversationApi";
import { LlmAnswerIssue } from "../../../Types/Telemetry/LlmAnswerIssue";
import { MonitorStepLlmMonitorUtil } from "../../../Types/Monitor/MonitorStepLlmMonitor";

/*
 * The Dashboard's half of /telemetry/llm/*. The pages are only as robust as
 * what these read back: a server mid-rollout, an older build behind a load
 * balancer or a proxy that rewrites a body must leave the page with
 * "nothing to show" - never a crash on `undefined.map`.
 */

type PostArguments = {
  url: { toString: () => string };
  data: JSONObject;
  headers: JSONObject;
};

let postSpy: ReturnType<typeof jest.spyOn>;

function respondWith(data: JSONObject): void {
  postSpy.mockImplementation(async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(200, data, {});
  });
}

function lastPost(): PostArguments {
  const calls: Array<Array<unknown>> = postSpy.mock.calls as Array<
    Array<unknown>
  >;

  return calls[calls.length - 1]![0] as PostArguments;
}

beforeEach(() => {
  postSpy = jest.spyOn(API, "post");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("buildLlmConversationListBody", () => {
  const START: Date = new Date("2026-10-03T00:00:00.000Z");
  const END: Date = new Date("2026-10-10T00:00:00.000Z");

  test("the time range as ISO strings, and the page as limit and skip", () => {
    expect(
      buildLlmConversationListBody({
        startTime: START,
        endTime: END,
        sort: LlmConversationSort.MostExpensive,
        page: 3,
        includeSummary: true,
      }),
    ).toEqual({
      startTime: "2026-10-03T00:00:00.000Z",
      endTime: "2026-10-10T00:00:00.000Z",
      serviceIds: undefined,
      search: undefined,
      issue: undefined,
      sort: LlmConversationSort.MostExpensive,
      limit: LLM_CONVERSATION_PAGE_SIZE,
      skip: 3 * LLM_CONVERSATION_PAGE_SIZE,
      includeSummary: true,
    });
  });

  test("filters are sent only when they narrow anything", () => {
    const body: ReturnType<typeof buildLlmConversationListBody> =
      buildLlmConversationListBody({
        startTime: START,
        endTime: END,
        serviceIds: [],
        search: "   ",
        sort: LlmConversationSort.Newest,
        page: 0,
        includeSummary: false,
      });

    expect(body.serviceIds).toBeUndefined();
    expect(body.search).toBeUndefined();
    expect(body.skip).toBe(0);
  });

  test("an app, a trimmed search and a chip are sent", () => {
    const body: ReturnType<typeof buildLlmConversationListBody> =
      buildLlmConversationListBody({
        startTime: START,
        endTime: END,
        serviceIds: ["6f1e2d3c-4b5a-4968-8776-655443322110"],
        search: "  refund ",
        issue: LlmAnswerIssue.Refused,
        sort: LlmConversationSort.Newest,
        page: 0,
        includeSummary: false,
      });

    expect(body.serviceIds).toEqual(["6f1e2d3c-4b5a-4968-8776-655443322110"]);
    expect(body.search).toBe("refund");
    expect(body.issue).toBe(LlmAnswerIssue.Refused);
  });

  test("a negative page asks for the first", () => {
    expect(
      buildLlmConversationListBody({
        startTime: START,
        endTime: END,
        sort: LlmConversationSort.Newest,
        page: -2,
        includeSummary: false,
      }).skip,
    ).toBe(0);
  });
});

describe("readLlmConversationView", () => {
  const transcript: JSONObject = {
    steps: [{ id: "s1:0", type: "user", text: "Hi" }],
    instructions: "Be brief.",
    title: "Hi",
    startMs: 1,
    endMs: 2,
    callCount: 1,
    answerCount: 1,
    userMessageCount: 1,
    costUsd: 0.001,
    inputTokens: 10,
    outputTokens: 5,
    issueCounts: {},
    models: ["gpt-4o"],
    users: ["ada@example.com"],
    serviceIds: ["svc"],
    contentRecorded: true,
  };

  test("a whole answer is read as it is", () => {
    const view: LlmConversationView | null = readLlmConversationView({
      key: "c:chat-1",
      kind: LlmConversationKeyKind.Conversation,
      conversationId: "chat-1",
      truncated: true,
      transcript: transcript,
    });

    expect(view?.key).toBe("c:chat-1");
    expect(view?.kind).toBe(LlmConversationKeyKind.Conversation);
    expect(view?.conversationId).toBe("chat-1");
    expect(view?.truncated).toBe(true);
    expect(view?.transcript.steps).toHaveLength(1);
    expect(view?.transcript.models).toEqual(["gpt-4o"]);
    expect(view?.transcript.title).toBe("Hi");
  });

  test("a request is a request; anything else is a conversation", () => {
    expect(
      readLlmConversationView({ kind: "request", transcript: transcript })
        ?.kind,
    ).toBe(LlmConversationKeyKind.Request);
    expect(
      readLlmConversationView({ kind: "bogus", transcript: transcript })?.kind,
    ).toBe(LlmConversationKeyKind.Conversation);
  });

  test("only true is truncated", () => {
    expect(
      readLlmConversationView({ truncated: "yes", transcript: transcript })
        ?.truncated,
    ).toBe(false);
  });

  test("lists the page maps over are always lists", () => {
    const view: LlmConversationView | null = readLlmConversationView({
      transcript: {
        ...transcript,
        steps: "not a list",
        models: null,
        users: { 0: "a" },
        serviceIds: undefined,
      } as unknown as JSONObject,
    });

    expect(view?.transcript.steps).toEqual([]);
    expect(view?.transcript.models).toEqual([]);
    expect(view?.transcript.users).toEqual([]);
    expect(view?.transcript.serviceIds).toEqual([]);
  });

  test.each([
    [null],
    [undefined],
    ["a string"],
    [42],
    [[]],
    [{}],
    [{ transcript: null }],
    [{ transcript: [] }],
    [{ transcript: "steps" }],
  ])("%p is not a conversation", (value: unknown) => {
    expect(readLlmConversationView(value)).toBeNull();
  });

  test("missing strings read as empty", () => {
    const view: LlmConversationView | null = readLlmConversationView({
      key: 12,
      conversationId: null,
      transcript: transcript,
    } as unknown as JSONObject);

    expect(view?.key).toBe("");
    expect(view?.conversationId).toBe("");
  });
});

describe("fetchLlmConversations", () => {
  test("posts the list body to the conversations route and reads the answer", async () => {
    respondWith({
      summary: null,
      hasMore: true,
      conversations: [
        {
          key: "c:chat-1",
          kind: "conversation",
          conversationId: "chat-1",
          traceId: "",
          title: "Where is my order?",
          startedAt: "2026-10-10T09:00:00.000Z",
          endedAt: "2026-10-10T09:01:00.000Z",
          durationMs: "60000",
          callCount: "3",
          answerCount: 2,
          costUsd: 0.002,
          inputTokens: 100,
          outputTokens: 50,
          issueCounts: { refused: "1" },
          slowestAnswerMs: 2100,
          models: ["gpt-4o"],
          people: ["ada@example.com"],
          serviceIds: [],
          agents: [],
        },
      ],
    });

    const response: LlmConversationListResponse = await fetchLlmConversations({
      startTime: new Date("2026-10-03T00:00:00.000Z"),
      endTime: new Date("2026-10-10T00:00:00.000Z"),
      sort: LlmConversationSort.Newest,
      page: 1,
      includeSummary: false,
    });

    expect(lastPost().url.toString()).toContain(LLM_CONVERSATIONS_ROUTE);
    expect(lastPost().data["skip"]).toBe(LLM_CONVERSATION_PAGE_SIZE);
    expect(lastPost().data["sort"]).toBe(LlmConversationSort.Newest);
    expect(response.hasMore).toBe(true);
    expect(response.conversations).toHaveLength(1);
    // ClickHouse's 64-bit counters arrive as strings and are read as numbers.
    expect(response.conversations[0]?.callCount).toBe(3);
    expect(response.conversations[0]?.durationMs).toBe(60000);
    expect(response.conversations[0]?.issueCounts[LlmAnswerIssue.Refused]).toBe(
      1,
    );
    expect(response.conversations[0]?.issueCounts[LlmAnswerIssue.Failed]).toBe(
      0,
    );
  });

  test("an empty body is an empty list, not a crash", async () => {
    respondWith({});

    const response: LlmConversationListResponse = await fetchLlmConversations({
      startTime: new Date(),
      endTime: new Date(),
      sort: LlmConversationSort.Newest,
      page: 0,
      includeSummary: true,
    });

    expect(response.conversations).toEqual([]);
    expect(response.hasMore).toBe(false);
    expect(response.summary).toBeNull();
  });

  test("an error response is thrown for the page to show", async () => {
    postSpy.mockImplementation(async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(403, { error: "No access to traces." }, {});
    });

    await expect(
      fetchLlmConversations({
        startTime: new Date(),
        endTime: new Date(),
        sort: LlmConversationSort.Newest,
        page: 0,
        includeSummary: true,
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });
});

describe("fetchLlmConversation", () => {
  test("posts the key, and the list's hint when there is one", async () => {
    respondWith({ key: "c:chat-1", transcript: { steps: [] } });

    await fetchLlmConversation({
      key: "c:chat-1",
      startTime: "2026-10-10T09:00:00.000Z",
      endTime: "2026-10-10T09:01:00.000Z",
    });

    expect(lastPost().url.toString()).toContain(LLM_CONVERSATION_ROUTE);
    expect(lastPost().url.toString()).not.toContain(LLM_CONVERSATIONS_ROUTE);
    expect(lastPost().data).toEqual({
      key: "c:chat-1",
      startTime: "2026-10-10T09:00:00.000Z",
      endTime: "2026-10-10T09:01:00.000Z",
    });
  });

  test("without a hint, only the key", async () => {
    respondWith({ key: "c:chat-1", transcript: { steps: [] } });

    await fetchLlmConversation({ key: "c:chat-1" });

    expect(lastPost().data).toEqual({ key: "c:chat-1" });
  });

  test("an unreadable answer is null", async () => {
    respondWith({ key: "c:chat-1" });

    await expect(fetchLlmConversation({ key: "c:chat-1" })).resolves.toBeNull();
  });

  test("an error response is thrown", async () => {
    postSpy.mockImplementation(async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(500, { error: "Boom" }, {});
    });

    await expect(
      fetchLlmConversation({ key: "c:chat-1" }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });
});

describe("fetchLlmAnswerStats", () => {
  test("posts the monitor step, normalized, and reads the counts", async () => {
    respondWith({
      answerCount: "120",
      badAnswerCount: "9",
      badAnswerPercent: 7.5,
      startTime: "2026-10-10T08:45:00.000Z",
      endTime: "2026-10-10T09:00:00.000Z",
    });

    const step: ReturnType<typeof MonitorStepLlmMonitorUtil.getDefault> = {
      ...MonitorStepLlmMonitorUtil.getDefault(),
      telemetryServiceIds: [
        new ObjectID("6f1e2d3c-4b5a-4968-8776-655443322110"),
      ],
      issues: [LlmAnswerIssue.Refused],
      model: "  gpt-4o  ",
    };

    const stats: Awaited<ReturnType<typeof fetchLlmAnswerStats>> =
      await fetchLlmAnswerStats(step);

    expect(lastPost().url.toString()).toContain(LLM_ANSWER_STATS_ROUTE);
    expect(lastPost().data["issues"]).toEqual([LlmAnswerIssue.Refused]);
    expect(lastPost().data["model"]).toBe("gpt-4o");
    expect(lastPost().data["lastXSecondsOfCalls"]).toBe(900);
    expect(JSON.stringify(lastPost().data["telemetryServiceIds"])).toContain(
      "6f1e2d3c-4b5a-4968-8776-655443322110",
    );
    expect(stats).toEqual({
      answerCount: 120,
      badAnswerCount: 9,
      badAnswerPercent: 7.5,
      startTime: "2026-10-10T08:45:00.000Z",
      endTime: "2026-10-10T09:00:00.000Z",
    });
  });

  test("an error response is thrown", async () => {
    postSpy.mockImplementation(async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(403, { error: "No." }, {});
    });

    await expect(
      fetchLlmAnswerStats(MonitorStepLlmMonitorUtil.getDefault()),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });
});
