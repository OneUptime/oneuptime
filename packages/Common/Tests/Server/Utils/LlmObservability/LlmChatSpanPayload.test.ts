import { describe, expect, test } from "@jest/globals";
import LlmChatSpanPayload, {
  LLM_CHAT_APP_ATTRIBUTE,
  LLM_CHAT_MAX_MESSAGES_LENGTH,
  LLM_CHAT_MAX_PART_LENGTH,
  LLM_CHAT_SCOPE_NAME,
  LLM_CONVERSATION_TITLE_ATTRIBUTE,
  LLM_CONVERSATION_URL_ATTRIBUTE,
  LlmChatSpanPayloadInput,
} from "../../../../Server/Utils/LlmObservability/LlmChatSpanPayload";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  LlmChatMessage,
  LlmChatPartType,
  LlmChatRole,
  LlmChatTurn,
} from "../../../../Types/LlmObservability/LlmConnectionRecords";
import {
  LLM_CONNECTION_ID_ATTRIBUTE,
  LLM_CONNECTION_NAME_ATTRIBUTE,
} from "../../../../Types/LlmObservability/LlmProviderUsageMetrics";

/*
 * A company AI tool's turns as OpenTelemetry GenAI spans: the ids derived
 * from the connection and the tool's own ids (so a turn read twice is one
 * span), the GenAI attributes a conversation view reads, the messages in
 * the conventions' parts shape held to a size, and nothing anyone wrote
 * when the connection keeps no text.
 */

const CONNECTION_ID: string = "33333333-3333-4333-8333-333333333333";

function message(
  role: LlmChatRole,
  text: string,
  id: string = "m",
): LlmChatMessage {
  return {
    id,
    role,
    createdAt: new Date("2026-10-19T09:00:00Z"),
    parts: [{ type: LlmChatPartType.Text, text }],
  };
}

const TURN: LlmChatTurn = {
  turnId: "msg_answer_1",
  conversationId: "chat_1",
  conversationTitle: "Incident policy",
  personEmail: "erin@example.com",
  personId: "user_01",
  personName: "Erin",
  model: "claude-opus-5-5",
  app: "",
  startedAt: new Date("2026-10-19T09:00:00.250Z"),
  endedAt: new Date("2026-10-19T09:00:20.750Z"),
  question: [message(LlmChatRole.User, "Summarize our incident policy.", "q1")],
  answer: [
    {
      id: "a1",
      role: LlmChatRole.Assistant,
      createdAt: new Date("2026-10-19T09:00:20.750Z"),
      parts: [
        {
          type: LlmChatPartType.ToolCall,
          text: '{"query":"policy"}',
          toolCallId: "tu_1",
          toolName: "web_search",
        },
        {
          type: LlmChatPartType.ToolResult,
          text: "3 results",
          toolCallId: "tu_1",
        },
        { type: LlmChatPartType.Text, text: "Here is the summary." },
        { type: LlmChatPartType.File, text: "policy.pdf" },
      ],
    },
  ],
  url: "https://claude.ai/chat/chat_1",
};

function input(
  overrides: Partial<LlmChatSpanPayloadInput> = {},
): LlmChatSpanPayloadInput {
  return {
    turns: [TURN],
    connectionId: CONNECTION_ID,
    connectionName: "Claude at Acme",
    serviceName: "Claude Enterprise",
    genAiProviderName: "anthropic",
    keepText: true,
    ...overrides,
  };
}

function attributesOf(span: JSONObject): Record<string, string> {
  const result: Record<string, string> = {};

  for (const attribute of span["attributes"] as JSONArray) {
    const entry: JSONObject = attribute as JSONObject;
    result[entry["key"] as string] = (entry["value"] as JSONObject)[
      "stringValue"
    ] as string;
  }

  return result;
}

describe("LlmChatSpanPayload ids", () => {
  test("a turn's ids are the same on every read, and OpenTelemetry-shaped", () => {
    const spanId: string = LlmChatSpanPayload.spanIdOf(CONNECTION_ID, "msg_1");
    const traceId: string = LlmChatSpanPayload.traceIdOf(
      CONNECTION_ID,
      "msg_1",
    );

    expect(spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(LlmChatSpanPayload.spanIdOf(CONNECTION_ID, "msg_1")).toBe(spanId);
    expect(LlmChatSpanPayload.traceIdOf(CONNECTION_ID, "msg_1")).toBe(traceId);
  });

  test("the same message id under another connection is another span", () => {
    expect(LlmChatSpanPayload.spanIdOf(CONNECTION_ID, "msg_1")).not.toBe(
      LlmChatSpanPayload.spanIdOf(
        "44444444-4444-4444-8444-444444444444",
        "msg_1",
      ),
    );
    expect(LlmChatSpanPayload.spanIdOf(CONNECTION_ID, "msg_1")).not.toBe(
      LlmChatSpanPayload.spanIdOf(CONNECTION_ID, "msg_2"),
    );
  });

  test("parts are kept apart, so moving a separator never collides", () => {
    expect(LlmChatSpanPayload.deriveId(["a", "bc"], 16)).not.toBe(
      LlmChatSpanPayload.deriveId(["ab", "c"], 16),
    );
  });
});

describe("LlmChatSpanPayload text", () => {
  test("text is held to a length and marked where it was cut", () => {
    expect(LlmChatSpanPayload.shorten("short", 10)).toBe("short");

    const cut: string = LlmChatSpanPayload.shorten("x".repeat(100), 50);
    expect(cut).toHaveLength(50);
    expect(cut.endsWith("(shortened by OneUptime)")).toBe(true);
  });

  test("messages are in the GenAI conventions' parts shape; a file is named, never copied", () => {
    expect(LlmChatSpanPayload.toConventionMessage(TURN.answer[0]!)).toEqual({
      role: "assistant",
      parts: [
        {
          type: "tool_call",
          id: "tu_1",
          name: "web_search",
          arguments: '{"query":"policy"}',
        },
        { type: "tool_call_response", id: "tu_1", response: "3 results" },
        { type: "text", content: "Here is the summary." },
        { type: "text", content: "[file: policy.pdf]" },
      ],
    });
  });

  test("a call's messages are held to their limit, cutting the longest parts", () => {
    const long: Array<LlmChatMessage> = [1, 2, 3, 4, 5, 6, 7, 8].map(
      (index: number) => {
        return message(
          LlmChatRole.User,
          `${index}`.repeat(LLM_CHAT_MAX_PART_LENGTH + 5000),
        );
      },
    );

    const json: string = LlmChatSpanPayload.messagesJson(long);

    expect(json.length).toBeLessThanOrEqual(LLM_CHAT_MAX_MESSAGES_LENGTH);
    const parsed: Array<JSONObject> = JSON.parse(json) as Array<JSONObject>;
    expect(parsed).toHaveLength(8);
    expect(JSON.stringify(parsed[7])).toContain("shortened by OneUptime");
  });

  test("messages too many to keep at all say so instead", () => {
    const many: Array<LlmChatMessage> = Array.from(
      { length: 2000 },
      (_: unknown, index: number) => {
        return message(LlmChatRole.User, `question ${index} `.repeat(30));
      },
    );

    const parsed: Array<JSONObject> = JSON.parse(
      LlmChatSpanPayload.messagesJson(many),
    ) as Array<JSONObject>;

    expect(parsed).toEqual([
      {
        role: "user",
        parts: [{ type: "text", content: "2000 messages too long to keep." }],
      },
    ]);
  });
});

describe("LlmChatSpanPayload spans", () => {
  test("a turn is one GenAI chat call of the person, in its conversation", () => {
    const span: JSONObject = LlmChatSpanPayload.buildSpan({
      turn: TURN,
      input: input(),
    });

    expect(span).toMatchObject({
      traceId: LlmChatSpanPayload.traceIdOf(CONNECTION_ID, "msg_answer_1"),
      spanId: LlmChatSpanPayload.spanIdOf(CONNECTION_ID, "msg_answer_1"),
      name: "chat claude-opus-5-5",
      kind: 3,
      startTimeUnixNano: "1792400400250000000",
      endTimeUnixNano: "1792400420750000000",
      status: { code: 0 },
    });

    const attributes: Record<string, string> = attributesOf(span);
    expect(attributes).toMatchObject({
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": "anthropic",
      "gen_ai.request.model": "claude-opus-5-5",
      "gen_ai.response.model": "claude-opus-5-5",
      "gen_ai.conversation.id": "chat_1",
      "user.email": "erin@example.com",
      "user.id": "user_01",
      [LLM_CONNECTION_ID_ATTRIBUTE]: CONNECTION_ID,
      [LLM_CONNECTION_NAME_ATTRIBUTE]: "Claude at Acme",
      [LLM_CONVERSATION_TITLE_ATTRIBUTE]: "Incident policy",
      [LLM_CONVERSATION_URL_ATTRIBUTE]: "https://claude.ai/chat/chat_1",
    });
    expect(JSON.parse(attributes["gen_ai.input.messages"]!)).toEqual([
      {
        role: "user",
        parts: [{ type: "text", content: "Summarize our incident policy." }],
      },
    ]);
    expect(JSON.parse(attributes["gen_ai.output.messages"]!)).toHaveLength(1);
    // Claude Enterprise names no app.
    expect(attributes[LLM_CHAT_APP_ATTRIBUTE]).toBeUndefined();
  });

  test("with text off, the call says who, when, which model and app - and nothing anyone wrote", () => {
    const span: JSONObject = LlmChatSpanPayload.buildSpan({
      turn: { ...TURN, app: "Word" },
      input: input({ keepText: false }),
    });
    const attributes: Record<string, string> = attributesOf(span);

    for (const key of [
      "gen_ai.input.messages",
      "gen_ai.output.messages",
      LLM_CONVERSATION_TITLE_ATTRIBUTE,
      LLM_CONVERSATION_URL_ATTRIBUTE,
    ]) {
      expect(attributes[key]).toBeUndefined();
    }

    expect(attributes["user.email"]).toBe("erin@example.com");
    expect(attributes[LLM_CHAT_APP_ATTRIBUTE]).toBe("Word");

    const everything: string = JSON.stringify(span);
    for (const words of [
      "incident policy",
      "summary",
      "policy.pdf",
      "3 results",
    ]) {
      expect(everything.toLowerCase()).not.toContain(words);
    }
  });

  test("a question with no answer yet has input messages only; an end before the start is held at the start", () => {
    const span: JSONObject = LlmChatSpanPayload.buildSpan({
      turn: { ...TURN, answer: [], endedAt: new Date("2026-10-19T08:00:00Z") },
      input: input(),
    });

    expect(attributesOf(span)["gen_ai.output.messages"]).toBeUndefined();
    expect(span["endTimeUnixNano"]).toBe(span["startTimeUnixNano"]);
  });

  test("a turn with no model is named after the connection", () => {
    const span: JSONObject = LlmChatSpanPayload.buildSpan({
      turn: { ...TURN, model: "" },
      input: input(),
    });

    expect(span["name"]).toBe("chat Claude at Acme");
  });

  test("the export is one resource of the connection's service and one scope", () => {
    const payload: JSONObject = LlmChatSpanPayload.build(
      input({ turns: [TURN, { ...TURN, turnId: "msg_answer_2" }] }),
    );

    const resourceSpans: Array<JSONObject> = payload[
      "resourceSpans"
    ] as Array<JSONObject>;
    expect(resourceSpans).toHaveLength(1);
    expect(resourceSpans[0]!["resource"]).toEqual({
      attributes: [
        { key: "service.name", value: { stringValue: "Claude Enterprise" } },
      ],
    });

    const scopeSpans: Array<JSONObject> = resourceSpans[0]![
      "scopeSpans"
    ] as Array<JSONObject>;
    expect(scopeSpans[0]!["scope"]).toEqual({ name: LLM_CHAT_SCOPE_NAME });
    expect(scopeSpans[0]!["spans"] as JSONArray).toHaveLength(2);
  });
});
