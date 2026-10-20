import { createHash } from "crypto";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import {
  LlmChatMessage,
  LlmChatPart,
  LlmChatPartType,
  LlmChatRole,
  LlmChatTurn,
} from "../../../Types/LlmObservability/LlmConnectionRecords";
import {
  LLM_CONNECTION_ID_ATTRIBUTE,
  LLM_CONNECTION_NAME_ATTRIBUTE,
} from "../../../Types/LlmObservability/LlmProviderUsageMetrics";

/*
 * A COMPANY AI TOOL'S CHAT TURNS AS OPENTELEMETRY GENAI SPANS.
 *
 * Each turn - what a person said since the AI last answered, and its answer
 * - becomes one AI call in OTLP/JSON, exactly as an instrumented app would
 * send it: `chat <model>`, gen_ai.conversation.id for the chat, user.email
 * and user.id for the person, and the messages in gen_ai.input.messages /
 * gen_ai.output.messages in the GenAI conventions' parts shape. The payload
 * then goes through the same trace ingest as any app's spans (drop filters,
 * scrub rules, pipelines, answer checks, retention), so the Conversations,
 * Calls and Usage tabs read it like any other AI call.
 *
 * Ids are derived from the connection and the tool's own message ids, so a
 * turn read twice is the same span (LlmChatImporter skips the ones already
 * stored).
 *
 * With "Keep what was written" off, the messages, the chat's title and its
 * link are left out: the calls still say who asked, when, which model and in
 * which app.
 */

// Longest text kept for one part of a message, and for one call's messages.
export const LLM_CHAT_MAX_PART_LENGTH: number = 20_000;
export const LLM_CHAT_MAX_MESSAGES_LENGTH: number = 100_000;
const SHORTENED_MARKER: string = " … (shortened by OneUptime)";

export const LLM_CONVERSATION_TITLE_ATTRIBUTE: string =
  "oneuptime.llm.conversation.title";
export const LLM_CONVERSATION_URL_ATTRIBUTE: string =
  "oneuptime.llm.conversation.url";
export const LLM_CHAT_APP_ATTRIBUTE: string = "oneuptime.llm.app";

// The instrumentation scope the imported spans name.
export const LLM_CHAT_SCOPE_NAME: string = "oneuptime.llm.connection";

const SPAN_KIND_CLIENT: number = 3;
const STATUS_CODE_UNSET: number = 0;

// An id of zeros only, which OpenTelemetry treats as no id at all.
const ALL_ZEROS_REGEX: RegExp = /^0+$/;

export interface LlmChatSpanPayloadInput {
  turns: Array<LlmChatTurn>;
  connectionId: string;
  connectionName: string;
  serviceName: string;
  // gen_ai.provider.name of the tool: anthropic, microsoft.copilot.
  genAiProviderName: string;
  keepText: boolean;
}

export default class LlmChatSpanPayload {
  // A stable hex id of a given length from parts that name one thing.
  public static deriveId(parts: Array<string>, hexLength: number): string {
    const hex: string = createHash("sha256")
      .update(parts.join("\u0000"), "utf8")
      .digest("hex")
      .substring(0, hexLength);

    // An all-zero id is invalid in OpenTelemetry; never produce one.
    return ALL_ZEROS_REGEX.test(hex) ? `1${hex.substring(1)}` : hex;
  }

  public static spanIdOf(connectionId: string, turnId: string): string {
    return LlmChatSpanPayload.deriveId(["span", connectionId, turnId], 16);
  }

  public static traceIdOf(connectionId: string, turnId: string): string {
    return LlmChatSpanPayload.deriveId(["trace", connectionId, turnId], 32);
  }

  // Text held to a length, marked where it was cut.
  public static shorten(text: string, limit: number): string {
    if (text.length <= limit) {
      return text;
    }

    return (
      text.substring(0, Math.max(0, limit - SHORTENED_MARKER.length)) +
      SHORTENED_MARKER
    );
  }

  /*
   * A message in the GenAI conventions' parts shape:
   * { role, parts: [{ type: "text", content } | { type: "tool_call", id,
   * name } | { type: "tool_call_response", id, response }] }. A file is a
   * text part naming it: its content is never copied.
   */
  public static toConventionMessage(message: LlmChatMessage): JSONObject {
    const parts: JSONArray = message.parts.map(
      (part: LlmChatPart): JSONObject => {
        const text: string = LlmChatSpanPayload.shorten(
          part.text || "",
          LLM_CHAT_MAX_PART_LENGTH,
        );

        switch (part.type) {
          case LlmChatPartType.ToolCall:
            return {
              type: "tool_call",
              id: part.toolCallId || "",
              name: part.toolName || "tool",
              arguments: text,
            };
          case LlmChatPartType.ToolResult:
            return {
              type: "tool_call_response",
              id: part.toolCallId || "",
              response: text,
            };
          case LlmChatPartType.File:
            return { type: "text", content: `[file: ${text}]` };
          default:
            return { type: "text", content: text };
        }
      },
    );

    return {
      role: message.role === LlmChatRole.Assistant ? "assistant" : "user",
      parts: parts,
    };
  }

  /*
   * A list of messages as the attribute's JSON text, held to
   * LLM_CHAT_MAX_MESSAGES_LENGTH: when it is longer, the longest parts are
   * cut further until it fits.
   */
  public static messagesJson(messages: Array<LlmChatMessage>): string {
    let partLimit: number = LLM_CHAT_MAX_PART_LENGTH;

    for (let attempt: number = 0; attempt < 8; attempt++) {
      const json: string = LlmChatSpanPayload.messagesJsonWithin(
        messages,
        partLimit,
      );

      if (json.length <= LLM_CHAT_MAX_MESSAGES_LENGTH) {
        return json;
      }

      partLimit = Math.max(200, Math.floor(partLimit / 2));
    }

    return JSON.stringify([
      {
        role:
          messages[0]?.role === LlmChatRole.Assistant ? "assistant" : "user",
        parts: [
          {
            type: "text",
            content: `${messages.length} messages too long to keep.`,
          },
        ],
      },
    ]);
  }

  // The messages as JSON text, each part cut to `partLimit` characters.
  private static messagesJsonWithin(
    messages: Array<LlmChatMessage>,
    partLimit: number,
  ): string {
    return JSON.stringify(
      messages.map((message: LlmChatMessage): JSONObject => {
        return LlmChatSpanPayload.toConventionMessage({
          ...message,
          parts: message.parts.map((part: LlmChatPart): LlmChatPart => {
            return {
              ...part,
              text: LlmChatSpanPayload.shorten(part.text || "", partLimit),
            };
          }),
        });
      }),
    );
  }

  private static stringAttribute(key: string, value: string): JSONObject {
    return { key, value: { stringValue: value } };
  }

  private static toUnixNano(date: Date): string {
    return `${BigInt(date.getTime()) * BigInt(1_000_000)}`;
  }

  public static buildSpan(data: {
    turn: LlmChatTurn;
    input: LlmChatSpanPayloadInput;
  }): JSONObject {
    const turn: LlmChatTurn = data.turn;
    const model: string = turn.model || data.input.connectionName;
    const attributes: JSONArray = [
      LlmChatSpanPayload.stringAttribute("gen_ai.operation.name", "chat"),
      LlmChatSpanPayload.stringAttribute(
        "gen_ai.provider.name",
        data.input.genAiProviderName,
      ),
      LlmChatSpanPayload.stringAttribute("gen_ai.request.model", model),
      LlmChatSpanPayload.stringAttribute("gen_ai.response.model", model),
      LlmChatSpanPayload.stringAttribute(
        "gen_ai.conversation.id",
        turn.conversationId,
      ),
      LlmChatSpanPayload.stringAttribute(
        LLM_CONNECTION_ID_ATTRIBUTE,
        data.input.connectionId,
      ),
      LlmChatSpanPayload.stringAttribute(
        LLM_CONNECTION_NAME_ATTRIBUTE,
        data.input.connectionName,
      ),
    ];

    if (turn.personEmail) {
      attributes.push(
        LlmChatSpanPayload.stringAttribute("user.email", turn.personEmail),
      );
    }

    if (turn.personId) {
      attributes.push(
        LlmChatSpanPayload.stringAttribute("user.id", turn.personId),
      );
    }

    if (turn.app) {
      attributes.push(
        LlmChatSpanPayload.stringAttribute(LLM_CHAT_APP_ATTRIBUTE, turn.app),
      );
    }

    if (data.input.keepText) {
      if (turn.question.length > 0) {
        attributes.push(
          LlmChatSpanPayload.stringAttribute(
            "gen_ai.input.messages",
            LlmChatSpanPayload.messagesJson(turn.question),
          ),
        );
      }

      if (turn.answer.length > 0) {
        attributes.push(
          LlmChatSpanPayload.stringAttribute(
            "gen_ai.output.messages",
            LlmChatSpanPayload.messagesJson(turn.answer),
          ),
        );
      }

      if (turn.conversationTitle) {
        attributes.push(
          LlmChatSpanPayload.stringAttribute(
            LLM_CONVERSATION_TITLE_ATTRIBUTE,
            LlmChatSpanPayload.shorten(turn.conversationTitle, 500),
          ),
        );
      }

      if (turn.url) {
        attributes.push(
          LlmChatSpanPayload.stringAttribute(
            LLM_CONVERSATION_URL_ATTRIBUTE,
            turn.url,
          ),
        );
      }
    }

    const start: Date = turn.startedAt;
    const end: Date =
      turn.endedAt.getTime() >= start.getTime() ? turn.endedAt : start;

    return {
      traceId: LlmChatSpanPayload.traceIdOf(
        data.input.connectionId,
        turn.turnId,
      ),
      spanId: LlmChatSpanPayload.spanIdOf(data.input.connectionId, turn.turnId),
      name: `chat ${model}`,
      kind: SPAN_KIND_CLIENT,
      startTimeUnixNano: LlmChatSpanPayload.toUnixNano(start),
      endTimeUnixNano: LlmChatSpanPayload.toUnixNano(end),
      attributes: attributes,
      status: { code: STATUS_CODE_UNSET },
    };
  }

  // The OTLP/JSON trace export request of these turns: one resource, one scope.
  public static build(input: LlmChatSpanPayloadInput): JSONObject {
    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              LlmChatSpanPayload.stringAttribute(
                "service.name",
                input.serviceName,
              ),
            ],
          },
          scopeSpans: [
            {
              scope: { name: LLM_CHAT_SCOPE_NAME },
              spans: input.turns.map((turn: LlmChatTurn): JSONObject => {
                return LlmChatSpanPayload.buildSpan({ turn, input });
              }),
            },
          ],
        },
      ],
    };
  }
}
