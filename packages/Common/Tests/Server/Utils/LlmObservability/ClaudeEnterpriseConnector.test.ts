import { describe, expect, test } from "@jest/globals";
import ClaudeComplianceClient from "../../../../Server/Utils/LlmObservability/Connectors/ClaudeEnterprise/ClaudeComplianceClient";
import ClaudeEnterpriseConnector from "../../../../Server/Utils/LlmObservability/Connectors/ClaudeEnterprise/ClaudeEnterpriseConnector";
import {
  LlmChatFetchOptions,
  LlmChatFetchResult,
  LlmConnectionSettings,
} from "../../../../Server/Utils/LlmObservability/LlmConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import LlmConnectionProvider from "../../../../Types/LlmObservability/LlmConnectionProvider";
import {
  LlmChatPartType,
  LlmChatRole,
  LlmChatTurn,
} from "../../../../Types/LlmObservability/LlmConnectionRecords";
import {
  LlmConnectionFailureKind,
  LlmConnectionTestResult,
} from "../../../../Types/LlmObservability/LlmConnectionTest";
import {
  FakeProviderApi,
  FakeRoute,
  createFakeProviderApi,
  json,
  queryValues,
  sequence,
} from "./FakeProviderApi";

/*
 * The Claude Enterprise connection against a fake Compliance API: the
 * compliance key and what is refused (an admin key cannot read chats), the
 * chats walked by update time with an overlap, each chat's messages read and
 * paired into turns (questions since the last answer, tool use, files named
 * but never read), questions with no answer for an hour, deleted chats, the
 * read budget and where it resumes, and a test that never reads a message.
 */

const KEY: string = "sk-ant-api01-compliance-TESTKEY-0042";
const NOW: Date = new Date("2026-10-19T12:00:00Z");

const SETTINGS: LlmConnectionSettings = {
  provider: LlmConnectionProvider.ClaudeEnterprise,
  config: {},
  secrets: { complianceAccessKey: KEY },
};

function chat(
  id: string,
  updatedAt: string,
  extra: JSONObject = {},
): JSONObject {
  return {
    id,
    name: `Chat ${id}`,
    created_at: "2026-10-19T08:00:00Z",
    updated_at: updatedAt,
    deleted_at: null,
    href: `https://claude.ai/chat/${id}`,
    model: "claude-opus-5-5",
    organization_uuid: "org-uuid",
    project_id: null,
    user: { id: "user_01", email_address: "erin@example.com" },
    ...extra,
  };
}

function message(
  id: string,
  role: string,
  createdAt: string,
  content: Array<JSONObject>,
  extra: JSONObject = {},
): JSONObject {
  return { id, role, created_at: createdAt, content, ...extra };
}

const CHAT_A_MESSAGES: Array<JSONObject> = [
  message(
    "m1",
    "user",
    "2026-10-19T09:00:00Z",
    [{ type: "text", text: "Summarize our incident policy." }],
    {
      files: [
        {
          id: "claude_file_1",
          filename: "policy.pdf",
          mime_type: "application/pdf",
        },
      ],
    },
  ),
  message(
    "m2",
    "assistant",
    "2026-10-19T09:00:20Z",
    [
      {
        type: "tool_use",
        id: "tu_1",
        name: "web_search",
        input: { query: "incident policy" },
      },
      {
        type: "tool_result",
        tool_use_id: "tu_1",
        content: [{ type: "text", text: "3 results" }],
      },
      { type: "text", text: "Here is the summary." },
    ],
    {
      artifacts: [
        {
          id: "art_1",
          version_id: "v1",
          title: "Policy summary",
          artifact_type: "text/markdown",
        },
      ],
    },
  ),
  message("m3", "user", "2026-10-19T09:05:00Z", [
    { type: "text", text: "Shorter please." },
  ]),
  message("m4", "user", "2026-10-19T09:05:10Z", [
    { type: "text", text: "Bullet points." },
  ]),
  message("m5", "assistant", "2026-10-19T09:05:30Z", [
    { type: "text", text: "- one\n- two" },
  ]),
  // A question still waiting for its answer, asked 5 minutes ago.
  message("m6", "user", "2026-10-19T11:55:00Z", [
    { type: "text", text: "And for vendors?" },
  ]),
];

function routes(
  overrides: Partial<Record<string, FakeRoute["respond"]>> = {},
): Array<FakeRoute> {
  return [
    {
      path: "/v1/compliance/apps/chats",
      respond:
        overrides["chats"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json({
            data: [
              chat("claude_chat_A", "2026-10-19T11:55:00Z"),
              chat("claude_chat_B", "2026-10-19T11:56:00Z", {
                deleted_at: "2026-10-19T11:56:00Z",
                name: "",
              }),
            ],
            has_more: false,
            first_id: "c1",
            last_id: "c2",
          });
        }),
    },
    {
      path: "/v1/compliance/apps/chats/claude_chat_A/messages",
      respond:
        overrides["messagesA"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json({
            ...chat("claude_chat_A", "2026-10-19T11:55:00Z"),
            chat_messages: CHAT_A_MESSAGES,
            has_more: false,
            first_id: "x",
            last_id: "y",
          });
        }),
    },
  ];
}

function options(
  overrides: Partial<LlmChatFetchOptions> = {},
  api?: FakeProviderApi,
): LlmChatFetchOptions {
  return {
    transport: (api || createFakeProviderApi(routes())).transport,
    now: (): Date => {
      return NOW;
    },
    state: {},
    backfillStart: new Date("2026-10-12T12:00:00Z"),
    windowEnd: new Date("2026-10-19T11:55:00Z"),
    maxRequests: 400,
    maxDurationMs: 60000,
    ...overrides,
  };
}

describe("ClaudeComplianceClient", () => {
  test.each([
    { name: "an admin key", key: "sk-ant-admin01-abc", words: "admin key" },
    { name: "an OpenAI key", key: "sk-proj-abc", words: "sk-ant-api01-" },
    { name: "no key", key: "", words: "required" },
  ])("$name is refused", ({ key, words }: { key: string; words: string }) => {
    expect(() => {
      return ClaudeComplianceClient.validateKey(key);
    }).toThrow(BadDataException);
    expect(() => {
      return ClaudeComplianceClient.validateKey(key);
    }).toThrow(words);
  });

  test("chats are listed by update time, oldest first, with the key in x-api-key", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());
    const client: ClaudeComplianceClient = new ClaudeComplianceClient({
      complianceAccessKey: KEY,
      transport: api.transport,
    });

    await client.listChats({
      updatedSince: new Date("2026-10-19T00:00:00Z"),
      afterId: "cursor_1",
    });

    const request: DataSourceHttpRequest = api.requests[0]!;
    expect(new URL(request.url).host).toBe("api.anthropic.com");
    expect(request.headers?.["x-api-key"]).toBe(KEY);
    expect(request.headers?.["anthropic-version"]).toBe("2023-06-01");
    expect(queryValues(request, "order_by")).toEqual(["updated_at"]);
    expect(queryValues(request, "updated_at.gte")).toEqual([
      "2026-10-19T00:00:00.000Z",
    ]);
    expect(queryValues(request, "after_id")).toEqual(["cursor_1"]);
    expect(queryValues(request, "limit")).toEqual(["100"]);
    expect(request.url).not.toContain(KEY);
  });

  test("a long chat's messages are paged with after_id", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        messagesA: sequence([
          json({
            chat_messages: [CHAT_A_MESSAGES[0]],
            has_more: true,
            last_id: "p1",
          }),
          json({
            chat_messages: [CHAT_A_MESSAGES[1]],
            has_more: false,
            last_id: "p2",
          }),
        ]),
      }),
    );
    const client: ClaudeComplianceClient = new ClaudeComplianceClient({
      complianceAccessKey: KEY,
      transport: api.transport,
    });

    const read: { messages: Array<JSONObject>; complete: boolean } =
      await client.listChatMessages("claude_chat_A");

    expect(read.complete).toBe(true);
    expect(read.messages).toHaveLength(2);
    expect(queryValues(api.requests[1]!, "after_id")).toEqual(["p1"]);
    expect(queryValues(api.requests[0]!, "order")).toEqual(["asc"]);
  });
});

describe("ClaudeEnterpriseConnector turns", () => {
  test("each answer is a turn with the questions asked since the last one", () => {
    const turns: Array<LlmChatTurn> = ClaudeEnterpriseConnector.buildTurns({
      chat: chat("claude_chat_A", "2026-10-19T11:55:00Z"),
      messages: CHAT_A_MESSAGES,
      now: NOW,
    });

    // m6 has waited 5 minutes for its answer: not a turn yet.
    expect(
      turns.map((turn: LlmChatTurn) => {
        return turn.turnId;
      }),
    ).toEqual(["m2", "m5"]);

    expect(turns[0]).toMatchObject({
      conversationId: "claude_chat_A",
      conversationTitle: "Chat claude_chat_A",
      personEmail: "erin@example.com",
      personId: "user_01",
      model: "claude-opus-5-5",
      url: "https://claude.ai/chat/claude_chat_A",
      startedAt: new Date("2026-10-19T09:00:00Z"),
      endedAt: new Date("2026-10-19T09:00:20Z"),
    });
    expect(
      turns[1]!.question.map((question: { id: string }) => {
        return question.id;
      }),
    ).toEqual(["m3", "m4"]);

    // Files and artifacts are named, never read.
    expect(turns[0]!.question[0]!.parts).toEqual([
      { type: LlmChatPartType.Text, text: "Summarize our incident policy." },
      { type: LlmChatPartType.File, text: "policy.pdf" },
    ]);
    expect(turns[0]!.answer[0]!.role).toBe(LlmChatRole.Assistant);
    expect(turns[0]!.answer[0]!.parts).toEqual([
      {
        type: LlmChatPartType.ToolCall,
        text: '{"query":"incident policy"}',
        toolCallId: "tu_1",
        toolName: "web_search",
      },
      {
        type: LlmChatPartType.ToolResult,
        text: "3 results",
        toolCallId: "tu_1",
      },
      { type: LlmChatPartType.Text, text: "Here is the summary." },
      { type: LlmChatPartType.File, text: "Policy summary" },
    ]);
  });

  test("a question with no answer for an hour is a turn of its own", () => {
    const turns: Array<LlmChatTurn> = ClaudeEnterpriseConnector.buildTurns({
      chat: chat("claude_chat_A", "2026-10-19T11:55:00Z"),
      messages: CHAT_A_MESSAGES,
      now: new Date("2026-10-19T13:00:00Z"),
    });

    expect(
      turns.map((turn: LlmChatTurn) => {
        return turn.turnId;
      }),
    ).toEqual(["m2", "m5", "m6"]);
    expect(turns[2]!.answer).toEqual([]);
  });

  test("messages that are not a user's or the assistant's, or have no time, are left out", () => {
    expect(
      ClaudeEnterpriseConnector.readMessage(
        message("x", "system", "2026-10-19T09:00:00Z", []),
      ),
    ).toBeNull();
    expect(
      ClaudeEnterpriseConnector.readMessage(message("x", "user", "never", [])),
    ).toBeNull();
    expect(ClaudeEnterpriseConnector.readMessage({ role: "user" })).toBeNull();
  });
});

describe("ClaudeEnterpriseConnector reads", () => {
  test("the first read starts at the backfill; chats are read and deleted ones counted", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    const result: LlmChatFetchResult =
      await new ClaudeEnterpriseConnector().fetchChats(
        SETTINGS,
        options({}, api),
      );

    expect(queryValues(api.requests[0]!, "updated_at.gte")).toEqual([
      "2026-10-12T12:00:00.000Z",
    ]);
    expect(
      result.turns.map((turn: LlmChatTurn) => {
        return turn.turnId;
      }),
    ).toEqual(["m2", "m5"]);
    expect(result.deletedConversationIds).toEqual(["claude_chat_B"]);
    // A deleted chat's messages are not asked for.
    expect(
      api.requestsTo("/v1/compliance/apps/chats/claude_chat_B/messages"),
    ).toHaveLength(0);
    expect(result.complete).toBe(true);
    // The cursor is the newest update read.
    expect(result.nextState.cursor).toBe("2026-10-19T11:56:00Z");
  });

  test("a later read starts ten minutes before the cursor", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    await new ClaudeEnterpriseConnector().fetchChats(
      SETTINGS,
      options({ state: { cursor: "2026-10-19T11:00:00Z" } }, api),
    );

    expect(queryValues(api.requests[0]!, "updated_at.gte")).toEqual([
      "2026-10-19T10:50:00.000Z",
    ]);
  });

  test("pages of chats are followed with after_id", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        chats: sequence([
          json({
            data: [chat("claude_chat_A", "2026-10-19T11:00:00Z")],
            has_more: true,
            last_id: "next",
          }),
          json({ data: [], has_more: false, last_id: null }),
        ]),
      }),
    );

    await new ClaudeEnterpriseConnector().fetchChats(
      SETTINGS,
      options({}, api),
    );

    const listReads: Array<DataSourceHttpRequest> = api.requestsTo(
      "/v1/compliance/apps/chats",
    );
    expect(listReads).toHaveLength(2);
    expect(queryValues(listReads[1]!, "after_id")).toEqual(["next"]);
  });

  test("a read that reaches its request budget stops, and resumes from the last chat it finished", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        chats: (): ReturnType<FakeRoute["respond"]> => {
          return json({
            data: [
              chat("claude_chat_A", "2026-10-19T10:00:00Z"),
              chat("claude_chat_C", "2026-10-19T11:00:00Z"),
            ],
            has_more: false,
          });
        },
      }),
    );

    const result: LlmChatFetchResult =
      await new ClaudeEnterpriseConnector().fetchChats(
        SETTINGS,
        // The chats list is one request, chat A's messages a second.
        options({ maxRequests: 2 }, api),
      );

    expect(result.complete).toBe(false);
    expect(result.nextState.cursor).toBe("2026-10-19T10:00:00Z");
    expect(
      api.requestsTo("/v1/compliance/apps/chats/claude_chat_C/messages"),
    ).toHaveLength(0);
  });

  test("a key without the user data scope fails as a permission problem", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        chats: (): ReturnType<FakeRoute["respond"]> => {
          return json(
            {
              error: {
                type: "permission_error",
                message:
                  "Missing required scopes. Got: ['read:compliance_activities']",
              },
            },
            403,
          );
        },
      }),
    );

    const result: LlmConnectionTestResult =
      await new ClaudeEnterpriseConnector().testConnection(SETTINGS, {
        transport: api.transport,
        now: (): Date => {
          return NOW;
        },
      });

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(LlmConnectionFailureKind.Permission);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  test("the test counts chats and people, and reads no message", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    const result: LlmConnectionTestResult =
      await new ClaudeEnterpriseConnector().testConnection(SETTINGS, {
        transport: api.transport,
        now: (): Date => {
          return NOW;
        },
      });

    expect(result.status).toBe("pass");
    expect(result.counts).toEqual({ days: 7, conversations: 2, people: 1 });
    expect(api.requests).toHaveLength(1);
    expect(queryValues(api.requests[0]!, "updated_at.gte")).toEqual([
      "2026-10-12T12:00:00.000Z",
    ]);
  });
});
