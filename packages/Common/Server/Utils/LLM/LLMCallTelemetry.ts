import { Attributes } from "@opentelemetry/api";
import { JSONObject } from "../../../Types/JSON";
import LlmType from "../../../Types/LLM/LlmType";
import LLMProviderHTTPException from "./LLMProviderHTTPException";
import {
  LLMCompletionResponse,
  LLMMessage,
  LLMToolCall,
  LLMUsage,
} from "./LLMService";

/*
 * ONEUPTIME'S OWN AI CALLS, AS ITS AI / LLM OBSERVABILITY READS THEM.
 *
 * Every model call OneUptime makes goes through AIService.executeWithLogging,
 * whose span these attributes mark as a GenAI call in the OpenTelemetry GenAI
 * semantic conventions. A deployment that sends its own telemetry to a
 * OneUptime project (OPENTELEMETRY_EXPORTER_OTLP_*) then sees its AI the way
 * a customer sees theirs: every call with its model, tokens, cost and why it
 * stopped, failed calls included, grouped into conversations - one per Ask AI
 * chat, one per AI run (an investigation and its summary calls, a code fix, a
 * runbook step) - and labelled with the OneUptime feature that made it.
 *
 * What a call SAID - the system prompt, the messages, the tool calls and
 * their results, the answer - is recorded only when the operator turns it on
 * with OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT, the switch
 * OpenTelemetry's GenAI instrumentations use and OneUptime's own docs tell
 * customers to set. It is off by default: prompts hold incident details, logs
 * and Ask AI conversations that are private to the person who asked, and an
 * upgrade must not start sending them anywhere on its own.
 *
 * Recorded content is bounded (LLM_CALL_CONTENT_LIMITS). An agent re-sends
 * its whole history on every call, one tool result can be megabytes of logs,
 * and OneUptime's OTLP endpoint takes 4 MB per export - one oversized span
 * would lose every span exported with it. The longest texts are cut first, so
 * questions and answers of ordinary length are always recorded whole.
 *
 * Pure: the caller sets the attributes on the span, and never lets this fail
 * an AI call.
 */

export const CAPTURE_MESSAGE_CONTENT_ENV_VAR: string =
  "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT";

/*
 * The values that turn recording on: "true" as OpenTelemetry's GenAI
 * instrumentations read it, and the newer content modes that record the
 * content somewhere. OneUptime records it on the span for each of them.
 * Anything else - unset, "false", "NO_CONTENT", a typo - leaves it off.
 */
const CAPTURE_MESSAGE_CONTENT_ON_VALUES: ReadonlySet<string> = new Set<string>([
  "true",
  "1",
  "yes",
  "on",
  "span_only",
  "span_and_event",
  "event_only",
]);

/*
 * Longest JSON, in characters, of each content attribute, and the shortest a
 * text is cut to before the oldest messages are left out instead. Together
 * at most about 450 KB a call, which stays under what ingest reads in full:
 * the conversation view reads a prompt of up to 4 MB, the newest question is
 * read for the conversation list from a prompt of up to 512 KB, and the
 * answer is checked for problems when it is under 256 KB.
 */
export const LLM_CALL_CONTENT_LIMITS: {
  systemInstructionsJsonLength: number;
  inputMessagesJsonLength: number;
  outputMessagesJsonLength: number;
  shortestCutTextLength: number;
} = {
  systemInstructionsJsonLength: 64 * 1024,
  inputMessagesJsonLength: 256 * 1024,
  outputMessagesJsonLength: 128 * 1024,
  shortestCutTextLength: 256,
};

// The GenAI conventions' message parts, as OneUptime's calls carry them.
export interface GenAiTextPart {
  type: "text";
  content: string;
}

export interface GenAiToolCallPart {
  type: "tool_call";
  id: string;
  name: string;
  // An object, or the JSON of one when it had to be cut.
  arguments: JSONObject | string;
}

export interface GenAiToolCallResponsePart {
  type: "tool_call_response";
  id: string;
  response: string;
}

export type GenAiPart =
  | GenAiTextPart
  | GenAiToolCallPart
  | GenAiToolCallResponsePart;

export interface GenAiMessage {
  role: string;
  parts: Array<GenAiPart>;
  // Output messages only: why the model stopped.
  finish_reason?: string | undefined;
}

export default class LLMCallTelemetry {
  /*
   * Whether the operator asked for prompts and answers to be recorded, read
   * from OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT.
   */
  public static isContentRecordingOn(
    env: NodeJS.ProcessEnv = process.env,
  ): boolean {
    const value: string | undefined = env[CAPTURE_MESSAGE_CONTENT_ENV_VAR];

    if (!value) {
      return false;
    }

    return CAPTURE_MESSAGE_CONTENT_ON_VALUES.has(value.trim().toLowerCase());
  }

  /*
   * What is known before the model is asked: which model, for which feature
   * and conversation, with which limits - and, when recording is on, the
   * system prompt and the messages sent.
   */
  public static getRequestAttributes(data: {
    llmType: LlmType;
    modelName?: string | undefined;
    // The LlmLog feature label: "AI Incident Investigation", "Ask AI" ...
    feature?: string | undefined;
    conversationId?: string | undefined;
    maxTokens?: number | undefined;
    temperature?: number | undefined;
    messages: Array<LLMMessage>;
    recordContent: boolean;
  }): Attributes {
    const attributes: Attributes = {
      "gen_ai.operation.name": "chat",
      "gen_ai.system": data.llmType.toString(),
      "gen_ai.provider.name": data.llmType.toString(),
    };

    if (data.modelName) {
      attributes["gen_ai.request.model"] = data.modelName;
    }

    /*
     * The feature that made the call is the agent that made it: the
     * conversation view shows it next to every answer, and the AI / LLM
     * pages can filter and split spend by it.
     */
    if (data.feature) {
      attributes["gen_ai.agent.name"] = data.feature;
    }

    if (data.conversationId) {
      attributes["gen_ai.conversation.id"] = data.conversationId;
    }

    if (isFiniteNumber(data.maxTokens)) {
      attributes["gen_ai.request.max_tokens"] = data.maxTokens;
    }

    if (isFiniteNumber(data.temperature)) {
      attributes["gen_ai.request.temperature"] = data.temperature;
    }

    if (data.recordContent) {
      const { systemInstructions, inputMessages } = this.toInput(data.messages);

      if (systemInstructions.length > 0) {
        attributes["gen_ai.system_instructions"] = this.toBoundedPartsJson(
          systemInstructions,
          LLM_CALL_CONTENT_LIMITS.systemInstructionsJsonLength,
        );
      }

      attributes["gen_ai.input.messages"] = this.toBoundedMessagesJson(
        inputMessages,
        LLM_CALL_CONTENT_LIMITS.inputMessagesJsonLength,
      );
    }

    return attributes;
  }

  /*
   * What the model answered: tokens, cost, why it stopped - and, when
   * recording is on, the answer itself.
   */
  public static getResponseAttributes(data: {
    modelName?: string | undefined;
    response: Pick<
      LLMCompletionResponse,
      "content" | "toolCalls" | "stopReason"
    >;
    usage?: LLMUsage | undefined;
    costInUSDCents?: number | undefined;
    recordContent: boolean;
  }): Attributes {
    const attributes: Attributes = {};

    if (data.modelName) {
      attributes["gen_ai.response.model"] = data.modelName;
    }

    if (data.usage) {
      /*
       * As the conventions count them: the input count is every input token,
       * the cached ones included (LLMUsage.promptTokens), and the cache
       * counts say how many of them the provider's prompt cache served or
       * took - so OneUptime's AI / LLM observability prices them at the
       * provider's cache rates, not as fresh input.
       */
      attributes["gen_ai.usage.input_tokens"] = data.usage.promptTokens || 0;
      attributes["gen_ai.usage.output_tokens"] =
        data.usage.completionTokens || 0;
      attributes["gen_ai.usage.total_tokens"] = data.usage.totalTokens || 0;

      if (data.usage.cachedInputTokens) {
        attributes["gen_ai.usage.cache_read.input_tokens"] =
          data.usage.cachedInputTokens;
      }

      if (data.usage.cacheCreationTokens) {
        attributes["gen_ai.usage.cache_creation.input_tokens"] =
          data.usage.cacheCreationTokens;
      }
    }

    if (data.costInUSDCents) {
      attributes["gen_ai.usage.cost_usd"] = data.costInUSDCents / 100;
    }

    const finishReason: string = this.toFinishReason(data.response.stopReason);

    if (finishReason) {
      attributes["gen_ai.response.finish_reasons"] = [finishReason];
    }

    if (data.recordContent) {
      attributes["gen_ai.output.messages"] = this.toBoundedMessagesJson(
        this.toOutputMessages(data.response),
        LLM_CALL_CONTENT_LIMITS.outputMessagesJsonLength,
      );
    }

    return attributes;
  }

  /*
   * A call that failed: error.type names the failure without a word of what
   * the provider said (its message can echo the prompt), so it is set
   * whether or not content is recorded. The call then shows as failed even
   * when its span status is left alone - OneUptime does that for a provider
   * that refused a request, which is a configuration error, not a bug.
   */
  public static getFailureAttributes(error: unknown): Attributes {
    return { "error.type": this.getErrorType(error) };
  }

  /*
   * A short, fixed name for a failure: the provider's HTTP status when it
   * answered with one ("429"), else the error's class ("TimeoutException"),
   * else "_OTHER" as the conventions say.
   */
  public static getErrorType(error: unknown): string {
    try {
      if (error instanceof LLMProviderHTTPException) {
        return String(error.statusCode);
      }

      if (error instanceof Error) {
        const constructorName: string = error.constructor?.name || "";

        if (constructorName && constructorName !== "Error") {
          return constructorName;
        }

        if (error.name && error.name !== "Error") {
          return error.name;
        }
      }
    } catch {
      // A thrown value with throwing getters names nothing.
    }

    return "_OTHER";
  }

  // The conventions' finish reasons for LLMService's stop reasons.
  public static toFinishReason(
    stopReason: LLMCompletionResponse["stopReason"],
  ): string {
    switch (stopReason) {
      case "stop":
        return "stop";
      case "tool_use":
        return "tool_call";
      case "length":
        return "length";
      default:
        return "";
    }
  }

  /*
   * The messages sent, as the conventions record them: the system messages
   * the conversation starts with are the system instructions, the rest are
   * the input messages - an assistant turn with its tool calls, a tool's
   * result under the id of the call it answers. A message with nothing in it
   * is left out.
   */
  public static toInput(messages: Array<LLMMessage>): {
    systemInstructions: Array<GenAiTextPart>;
    inputMessages: Array<GenAiMessage>;
  } {
    const systemInstructions: Array<GenAiTextPart> = [];
    let index: number = 0;

    while (index < messages.length && messages[index]!.role === "system") {
      const content: string = messages[index]!.content || "";

      if (content) {
        systemInstructions.push({ type: "text", content: content });
      }

      index++;
    }

    const inputMessages: Array<GenAiMessage> = [];

    for (const message of messages.slice(index)) {
      const converted: GenAiMessage = this.toMessage(message);

      if (converted.parts.length > 0) {
        inputMessages.push(converted);
      }
    }

    return { systemInstructions, inputMessages };
  }

  /*
   * The answer, as one assistant message: its text and the tools it asked
   * for. An answer with neither is recorded with no parts, which is what
   * marks it empty.
   */
  public static toOutputMessages(
    response: Pick<
      LLMCompletionResponse,
      "content" | "toolCalls" | "stopReason"
    >,
  ): Array<GenAiMessage> {
    const message: GenAiMessage = {
      role: "assistant",
      parts: this.toAssistantParts(response.content, response.toolCalls),
    };

    const finishReason: string = this.toFinishReason(response.stopReason);

    if (finishReason) {
      message.finish_reason = finishReason;
    }

    return [message];
  }

  // Messages as JSON of at most `maxJsonLength` characters (toBoundedJson).
  public static toBoundedMessagesJson(
    messages: Array<GenAiMessage>,
    maxJsonLength: number,
  ): string {
    return this.toBoundedJson({
      items: messages,
      maxJsonLength: maxJsonLength,
      cut: cutMessage,
      textLength: messageTextLength,
    });
  }

  // Message parts as JSON of at most `maxJsonLength` characters.
  public static toBoundedPartsJson(
    parts: Array<GenAiPart>,
    maxJsonLength: number,
  ): string {
    return this.toBoundedJson({
      items: parts,
      maxJsonLength: maxJsonLength,
      cut: cutPart,
      textLength: partTextLength,
    });
  }

  /*
   * The JSON of `items`, at most `maxJsonLength` characters long. When the
   * whole of it is longer, every text longer than one common length is cut
   * to it - the longest length that fits - so the longest texts lose the
   * most and the short ones nothing. When even cutting every text to
   * LLM_CALL_CONTENT_LIMITS.shortestCutTextLength is too long (a history of
   * thousands of messages), the oldest items are left out instead: the calls
   * before this one recorded them.
   */
  public static toBoundedJson<T>(data: {
    items: Array<T>;
    maxJsonLength: number;
    cut: (item: T, maxTextLength: number) => T;
    textLength: (item: T) => number;
  }): string {
    const whole: string = JSON.stringify(data.items);

    if (whole.length <= data.maxJsonLength) {
      return whole;
    }

    const cutTo: (maxTextLength: number) => Array<T> = (
      maxTextLength: number,
    ): Array<T> => {
      return data.items.map((item: T): T => {
        return data.cut(item, maxTextLength);
      });
    };

    const fits: (maxTextLength: number) => boolean = (
      maxTextLength: number,
    ): boolean => {
      return JSON.stringify(cutTo(maxTextLength)).length <= data.maxJsonLength;
    };

    let shortest: number = LLM_CALL_CONTENT_LIMITS.shortestCutTextLength;

    if (fits(shortest)) {
      /*
       * Cutting to `shortest` fits and cutting to `longest` does not: no
       * text longer than the budget itself can be kept whole, and at the
       * length of the longest text nothing would be cut at all.
       */
      let longestText: number = 0;

      for (const item of data.items) {
        longestText = Math.max(longestText, data.textLength(item));
      }

      let longest: number = Math.min(data.maxJsonLength, longestText);

      while (longest - shortest > 1) {
        const middle: number = Math.floor((shortest + longest) / 2);

        if (fits(middle)) {
          shortest = middle;
        } else {
          longest = middle;
        }
      }

      return JSON.stringify(cutTo(shortest));
    }

    const cutItems: Array<T> = cutTo(shortest);
    // "[" and "]", and a comma before every item but the first.
    let length: number = 2;
    let first: number = cutItems.length;

    while (first > 0) {
      const itemLength: number =
        JSON.stringify(cutItems[first - 1]).length +
        (first < cutItems.length ? 1 : 0);

      if (length + itemLength > data.maxJsonLength) {
        break;
      }

      length += itemLength;
      first--;
    }

    return JSON.stringify(cutItems.slice(first));
  }

  private static toMessage(message: LLMMessage): GenAiMessage {
    switch (message.role) {
      case "assistant":
        return {
          role: "assistant",
          parts: this.toAssistantParts(message.content, message.toolCalls),
        };
      case "tool":
        return {
          role: "tool",
          parts: [
            {
              type: "tool_call_response",
              id: message.toolCallId || "",
              response: message.content || "",
            },
          ],
        };
      default:
        return {
          role: message.role,
          parts: message.content
            ? [{ type: "text", content: message.content }]
            : [],
        };
    }
  }

  private static toAssistantParts(
    content: string | undefined,
    toolCalls: Array<LLMToolCall> | undefined,
  ): Array<GenAiPart> {
    const parts: Array<GenAiPart> = [];

    if (content) {
      parts.push({ type: "text", content: content });
    }

    for (const toolCall of toolCalls || []) {
      parts.push({
        type: "tool_call",
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments || {},
      });
    }

    return parts;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && isFinite(value);
}

/*
 * `text` cut to `maxLength` characters, saying how many were left out. Never
 * splits a character that takes two UTF-16 units (an emoji): half of one is
 * not text.
 */
export function cutText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  let end: number = Math.max(0, maxLength);
  const lastUnit: number = text.charCodeAt(end - 1);

  if (end > 0 && lastUnit >= 0xd800 && lastUnit <= 0xdbff) {
    end--;
  }

  return `${text.slice(0, end)}… [${text.length - end} more characters not recorded]`;
}

function toolCallArgumentsJson(part: GenAiToolCallPart): string {
  return typeof part.arguments === "string"
    ? part.arguments
    : JSON.stringify(part.arguments);
}

function partTextLength(part: GenAiPart): number {
  switch (part.type) {
    case "text":
      return part.content.length;
    case "tool_call_response":
      return part.response.length;
    case "tool_call":
      return toolCallArgumentsJson(part).length;
  }
}

function messageTextLength(message: GenAiMessage): number {
  let longest: number = 0;

  for (const part of message.parts) {
    longest = Math.max(longest, partTextLength(part));
  }

  return longest;
}

function cutPart<T extends GenAiPart>(part: T, maxTextLength: number): T {
  switch (part.type) {
    case "text":
      return {
        ...part,
        content: cutText((part as GenAiTextPart).content, maxTextLength),
      };
    case "tool_call_response":
      return {
        ...part,
        response: cutText(
          (part as GenAiToolCallResponsePart).response,
          maxTextLength,
        ),
      };
    case "tool_call": {
      const json: string = toolCallArgumentsJson(part as GenAiToolCallPart);

      // Arguments that fit stay an object; longer ones are their JSON, cut.
      return json.length <= maxTextLength
        ? part
        : { ...part, arguments: cutText(json, maxTextLength) };
    }
    default:
      return part;
  }
}

function cutMessage(
  message: GenAiMessage,
  maxTextLength: number,
): GenAiMessage {
  return {
    ...message,
    parts: message.parts.map((part: GenAiPart): GenAiPart => {
      return cutPart(part, maxTextLength);
    }),
  };
}
