import {
  LlmCompletionEventNames,
  LlmCompletionIndexedMessageConventions,
  LlmCompletionJsonAttributeKeys,
  LlmErrorTypeAttributeKeys,
  LlmEvaluationExplanationAttributeKey,
  LlmEvaluationNameAttributeKey,
  LlmEvaluationResultEventName,
  LlmEvaluationScoreLabelAttributeKey,
  LlmEvaluationScoreValueAttributeKey,
  LlmFinishReasonAttributeKeys,
  LlmIndexedMessageConvention,
  LlmInferenceDetailsEventName,
  LlmPromptEventNames,
  LlmPromptIndexedMessageConventions,
  LlmPromptJsonAttributeKeys,
  LlmResponseToolCallsAttributeKeys,
  LlmSystemInstructionsAttributeKeys,
  LlmToolCallArgumentsAttributeKeys,
  LlmToolCallIdAttributeKeys,
  LlmToolCallResultAttributeKeys,
  LlmToolNameAttributeKeys,
} from "../../Types/Telemetry/LlmConventions";
import {
  LLM_REFUSAL_OPENING_LENGTH,
  LlmAnswerContentSummary,
  LlmEvaluationResult,
} from "../../Types/Telemetry/LlmAnswerIssue";

/*
 * ONE READER FOR WHAT AN AI CALL SAID.
 *
 * The prompt and the answer of an LLM call live in its span's attributes and
 * events, written in whichever shape the instrumentation chose:
 *
 *   - the current GenAI conventions: gen_ai.input.messages /
 *     gen_ai.output.messages / gen_ai.system_instructions, each a list of
 *     messages made of typed parts (text, tool_call, tool_call_response,
 *     reasoning, blob/file/uri), on the span or on the
 *     gen_ai.client.inference.operation.details event;
 *   - OpenLLMetry's indexed attributes (gen_ai.prompt.0.content,
 *     gen_ai.completion.0.tool_calls.0.name ...);
 *   - OpenInference's (llm.input_messages.0.message.content, input.value,
 *     output.value);
 *   - the Vercel AI SDK's ai.prompt.messages / ai.response.text /
 *     ai.response.toolCalls;
 *   - the deprecated per-role events (gen_ai.user.message, gen_ai.choice);
 *   - and inside any of them, the provider's own message shape - OpenAI
 *     (content parts, tool_calls, refusal), Anthropic (tool_use,
 *     tool_result, thinking blocks) or Gemini (parts with functionCall).
 *
 * Three readers need the same answer, so they share this module: the
 * conversation view (every message, in order), the AI / LLM span panel, and
 * the answer checks at ingest (only the answer - see readAnswer - so the
 * ingest path never parses a long prompt history).
 *
 * Never throws: telemetry is untrusted input, and a shape this module does
 * not know reads as "nothing recorded" rather than failing a render or an
 * ingest batch. Inline media is never copied out - a base64 image becomes a
 * one-line "image" part.
 */

export enum LlmMessagePartType {
  Text = "text",
  Reasoning = "reasoning",
  ToolCall = "tool_call",
  ToolResult = "tool_result",
  Media = "media",
  Refusal = "refusal",
  Other = "other",
}

export interface LlmMessagePart {
  type: LlmMessagePartType;
  // Text, reasoning, refusal, a tool result, or a description of the part.
  text: string;
  toolCallId?: string | undefined;
  toolName?: string | undefined;
  // A tool call's arguments, as written (pretty JSON when they were an object).
  arguments?: string | undefined;
  // image | audio | video | document | file, for a Media part.
  modality?: string | undefined;
  mimeType?: string | undefined;
  // A URI or a provider file id. Inline data is never kept.
  uri?: string | undefined;
}

export interface LlmMessage {
  // system | user | assistant | tool, or the instrumentation's own word.
  role: string;
  // The participant's name, when one was sent.
  name: string;
  parts: Array<LlmMessagePart>;
  finishReason: string;
}

export interface LlmToolRun {
  id: string;
  name: string;
  arguments: string;
  result: string;
}

export interface LlmCallContent {
  // The system prompt sent apart from the history; "" when none.
  systemInstructions: string;
  input: Array<LlmMessage>;
  output: Array<LlmMessage>;
  // Lower-cased finish reasons of every choice, deduplicated.
  finishReasons: Array<string>;
  // What a tool run (execute_tool span) was given and returned.
  tool: LlmToolRun | null;
  evaluations: Array<LlmEvaluationResult>;
  // error.type, "" when absent.
  errorType: string;
}

export interface LlmAnswerReading {
  output: Array<LlmMessage>;
  finishReasons: Array<string>;
  evaluations: Array<LlmEvaluationResult>;
  errorType: string;
  summary: LlmAnswerContentSummary;
}

export interface LlmMessageParserOptions {
  /*
   * Longest JSON string the parser will parse. Longer values are read as
   * text (an output) or skipped (a prompt history) - a megabyte of chat
   * history must not stall an ingest worker.
   */
  maxJsonLength?: number | undefined;
}

type Dictionary = Record<string, unknown>;

// The dashboard reads whole conversations; the ingest path only answers.
export const LLM_MESSAGE_MAX_JSON_LENGTH: number = 4 * 1024 * 1024;
export const LLM_ANSWER_MAX_JSON_LENGTH: number = 256 * 1024;

const MEDIA_PART_TYPES: ReadonlySet<string> = new Set<string>([
  "blob",
  "file",
  "uri",
  "image",
  "image_url",
  "input_image",
  "output_image",
  "audio",
  "input_audio",
  "output_audio",
  "video",
  "document",
  "input_file",
]);

/*
 * Attribute access over the two shapes a span's attributes arrive in: the
 * flat "a.b.c" dictionary ingest builds and the map the API returns, or a
 * nested object (rows written while attributes were a JSON column).
 */
class AttributeReader {
  private readonly flat: Map<string, unknown> = new Map<string, unknown>();

  public constructor(attributes: unknown) {
    if (attributes && typeof attributes === "object") {
      this.flatten(attributes as Dictionary, "");
    }
  }

  public get(key: string): unknown {
    return this.flat.get(key);
  }

  public first(keys: ReadonlyArray<string>): { key: string; value: unknown } {
    for (const key of keys) {
      const value: unknown = this.flat.get(key);

      if (!isBlank(value)) {
        return { key: key, value: value };
      }
    }

    return { key: "", value: undefined };
  }

  /*
   * Like first(), but a key whose value was an object reads back from the
   * dotted keys it was flattened into - ingest flattens a structured
   * attribute such as gen_ai.tool.call.arguments = {location: "Paris"} into
   * gen_ai.tool.call.arguments.location. Only for values that are objects
   * by nature (tool arguments and results): a prefix like gen_ai.prompt has
   * indexed keys below it that are messages, not an object.
   */
  public firstStructured(keys: ReadonlyArray<string>): unknown {
    for (const key of keys) {
      const value: unknown = this.flat.get(key);

      if (!isBlank(value)) {
        return value;
      }

      const rebuilt: Dictionary = {};
      let found: boolean = false;

      for (const subKey of this.keysWithPrefix(`${key}.`)) {
        found = true;
        const path: Array<string> = subKey.slice(key.length + 1).split(".");
        let cursor: Dictionary = rebuilt;

        for (let index: number = 0; index < path.length - 1; index++) {
          const segment: string = path[index] as string;
          const existing: Dictionary | null = asDictionary(cursor[segment]);

          if (existing) {
            cursor = existing;
          } else {
            const created: Dictionary = {};
            cursor[segment] = created;
            cursor = created;
          }
        }

        cursor[path[path.length - 1] as string] = this.flat.get(subKey);
      }

      if (found) {
        return rebuilt;
      }
    }

    return undefined;
  }

  public firstString(keys: ReadonlyArray<string>): string {
    const found: unknown = this.first(keys).value;

    return scalarToString(found).trim();
  }

  public keysWithPrefix(prefix: string): Array<string> {
    const keys: Array<string> = [];

    for (const key of this.flat.keys()) {
      if (key.startsWith(prefix)) {
        keys.push(key);
      }
    }

    return keys;
  }

  private flatten(object: Dictionary, prefix: string): void {
    for (const key of Object.keys(object)) {
      const value: unknown = object[key];
      const fullKey: string = prefix ? `${prefix}.${key}` : key;

      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        prefix.length < 512
      ) {
        this.flatten(value as Dictionary, fullKey);
        continue;
      }

      this.flat.set(fullKey, value);
    }
  }
}

// '"stop"' -> 'stop'. A loop, not a regular expression: values are untrusted.
function stripQuotes(value: string): string {
  let start: number = 0;
  let end: number = value.length;

  while (start < end && value[start] === '"') {
    start++;
  }

  while (end > start && value[end - 1] === '"') {
    end--;
  }

  return value.slice(start, end);
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return false;
}

function scalarToString(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

// Pretty JSON for an object, the text itself for a string.
function valueToText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function asDictionary(value: unknown): Dictionary | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Dictionary;
  }

  return null;
}

function readString(object: Dictionary, ...fields: Array<string>): string {
  for (const field of fields) {
    const value: unknown = object[field];

    if (typeof value === "string" && value.length > 0) {
      return value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }

  return "";
}

/*
 * Rebuild an object from keys some flattening joined with dots, below the
 * prefix the flattening stamped on them.
 *
 * A structured attribute (an array of key/value lists) is flattened by OTLP
 * ingest with the ATTRIBUTE's key in front of every nested key -
 * {"gen_ai.output.messages.role": "assistant",
 *  "gen_ai.output.messages.parts": [{"gen_ai.output.messages.parts.type": ...}]}
 * - and arrives that way again, as JSON text, through the attribute map.
 * Plain JSON (the common case: SDKs send these attributes as a JSON string)
 * has no such prefix and passes through unchanged.
 */
function unprefix(value: unknown, prefix: string, depth: number = 0): unknown {
  if (depth > 32) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((element: unknown): unknown => {
      return unprefix(element, prefix, depth + 1);
    });
  }

  const object: Dictionary | null = asDictionary(value);

  if (!object) {
    return value;
  }

  const dotted: string = `${prefix}.`;
  const rebuilt: Dictionary = {};

  for (const key of Object.keys(object)) {
    const wasPrefixed: boolean = key.startsWith(dotted);
    const field: string = wasPrefixed ? key.slice(dotted.length) : key;

    if (!field) {
      continue;
    }

    const child: unknown = unprefix(
      object[key],
      `${prefix}.${field}`,
      depth + 1,
    );

    /*
     * Only a key the flattening wrote is split back into objects
     * ("arguments.location" -> {arguments: {location: ...}}). A key that
     * arrived as written - plain JSON - keeps any dot it has.
     */
    const path: Array<string> = wasPrefixed ? field.split(".") : [field];
    let cursor: Dictionary = rebuilt;

    for (let index: number = 0; index < path.length - 1; index++) {
      const segment: string = path[index] as string;
      const existing: Dictionary | null = asDictionary(cursor[segment]);

      if (existing) {
        cursor = existing;
      } else {
        const created: Dictionary = {};
        cursor[segment] = created;
        cursor = created;
      }
    }

    cursor[path[path.length - 1] as string] = child;
  }

  return rebuilt;
}

/*
 * A value as structure when it is JSON (an array or an object, or the JSON
 * text of one), else as itself. Text longer than the limit is never parsed.
 */
function toStructured(
  value: unknown,
  attributeKey: string,
  maxJsonLength: number,
): unknown {
  if (typeof value === "string") {
    const trimmed: string = value.trim();

    if (
      trimmed.length <= maxJsonLength &&
      (trimmed.startsWith("[") || trimmed.startsWith("{"))
    ) {
      try {
        return unprefix(JSON.parse(trimmed), attributeKey);
      } catch {
        return value;
      }
    }

    return value;
  }

  if (value && typeof value === "object") {
    return unprefix(value, attributeKey);
  }

  return value;
}

function normalizeRole(role: string): string {
  const lower: string = role.trim().toLowerCase();

  switch (lower) {
    case "model":
    case "ai":
    case "bot":
    case "chatbot":
    case "assistant":
      return "assistant";
    case "human":
    case "user":
      return "user";
    case "developer":
    case "system":
      return "system";
    case "function":
    case "tool":
    case "ipython":
      return "tool";
    default:
      return lower;
  }
}

function mediaPart(
  type: string,
  object: Dictionary,
  modalityHint: string,
): LlmMessagePart {
  const imageUrl: Dictionary | null = asDictionary(object["image_url"]);
  const rawUri: string =
    readString(object, "uri", "url", "file_id", "fileUri", "file_uri") ||
    (imageUrl ? readString(imageUrl, "url") : "") ||
    (typeof object["image_url"] === "string"
      ? (object["image_url"] as string)
      : "");

  // An inline data: URI is the bytes themselves - keep only that it was one.
  const uri: string = rawUri.startsWith("data:") ? "" : rawUri;

  const mimeType: string = readString(
    object,
    "mime_type",
    "mimeType",
    "media_type",
  );

  let modality: string = readString(object, "modality") || modalityHint;

  if (!modality) {
    if (mimeType.startsWith("image/") || type.includes("image")) {
      modality = "image";
    } else if (mimeType.startsWith("audio/") || type.includes("audio")) {
      modality = "audio";
    } else if (mimeType.startsWith("video/")) {
      modality = "video";
    } else {
      modality = "file";
    }
  }

  return {
    type: LlmMessagePartType.Media,
    text: "",
    modality: modality,
    mimeType: mimeType || undefined,
    uri: uri || undefined,
  };
}

/*
 * Parts from one element of a content/parts list, in any provider's shape.
 * A string element is text; an unknown object keeps its JSON so nothing a
 * customer sent silently disappears.
 */
function partsFromElement(element: unknown): Array<LlmMessagePart> {
  if (typeof element === "string") {
    return element.length > 0
      ? [{ type: LlmMessagePartType.Text, text: element }]
      : [];
  }

  const object: Dictionary | null = asDictionary(element);

  if (!object) {
    return [];
  }

  const type: string = readString(object, "type").toLowerCase();

  // Gemini parts carry no type, only the field that says what they are.
  if (!type) {
    if (typeof object["text"] === "string") {
      return [
        {
          type:
            object["thought"] === true
              ? LlmMessagePartType.Reasoning
              : LlmMessagePartType.Text,
          text: object["text"] as string,
        },
      ];
    }

    const functionCall: Dictionary | null = asDictionary(
      object["functionCall"] || object["function_call"],
    );

    if (functionCall) {
      return [
        {
          type: LlmMessagePartType.ToolCall,
          text: "",
          toolCallId: readString(functionCall, "id") || undefined,
          toolName: readString(functionCall, "name"),
          arguments: valueToText(
            functionCall["args"] ?? functionCall["arguments"],
          ),
        },
      ];
    }

    const functionResponse: Dictionary | null = asDictionary(
      object["functionResponse"] || object["function_response"],
    );

    if (functionResponse) {
      return [
        {
          type: LlmMessagePartType.ToolResult,
          text: valueToText(functionResponse["response"]),
          toolCallId: readString(functionResponse, "id") || undefined,
          toolName: readString(functionResponse, "name") || undefined,
        },
      ];
    }

    if (object["inlineData"] || object["inline_data"] || object["fileData"]) {
      const data: Dictionary =
        asDictionary(object["inlineData"]) ||
        asDictionary(object["inline_data"]) ||
        asDictionary(object["fileData"]) ||
        {};
      return [mediaPart("blob", data, "")];
    }

    if (typeof object["content"] === "string") {
      return [{ type: LlmMessagePartType.Text, text: object["content"] }];
    }

    return [];
  }

  switch (type) {
    case "text":
    case "input_text":
    case "output_text":
      return [
        {
          type: LlmMessagePartType.Text,
          text: readString(object, "content", "text"),
        },
      ];
    case "reasoning":
    case "thinking":
      return [
        {
          type: LlmMessagePartType.Reasoning,
          text: readString(object, "content", "thinking", "text"),
        },
      ];
    case "redacted_thinking":
      return [{ type: LlmMessagePartType.Reasoning, text: "" }];
    case "refusal":
      return [
        {
          type: LlmMessagePartType.Refusal,
          text: readString(object, "refusal", "content", "text"),
        },
      ];
    case "tool_call":
    case "tool_use":
    case "function_call":
    case "server_tool_call":
    case "tool-call": {
      const fn: Dictionary | null = asDictionary(object["function"]);
      const argumentsValue: unknown =
        object["arguments"] ??
        object["input"] ??
        object["args"] ??
        object["server_tool_call"] ??
        fn?.["arguments"];
      return [
        {
          type: LlmMessagePartType.ToolCall,
          text: "",
          toolCallId:
            readString(object, "id", "call_id", "toolCallId") || undefined,
          toolName:
            readString(object, "name", "toolName") ||
            (fn ? readString(fn, "name") : ""),
          arguments: valueToText(argumentsValue),
        },
      ];
    }
    case "tool_call_response":
    case "tool_result":
    case "function_call_output":
    case "server_tool_call_response":
    case "tool-result": {
      const response: unknown =
        object["response"] ??
        object["content"] ??
        object["output"] ??
        object["result"] ??
        object["server_tool_call_response"];
      return [
        {
          type: LlmMessagePartType.ToolResult,
          text: Array.isArray(response)
            ? contentToText(response)
            : valueToText(response),
          toolCallId:
            readString(object, "id", "tool_use_id", "call_id", "toolCallId") ||
            undefined,
          toolName: readString(object, "name", "toolName") || undefined,
        },
      ];
    }
    case "compaction":
      return [
        {
          type: LlmMessagePartType.Other,
          text: readString(object, "content"),
        },
      ];
    default:
      if (MEDIA_PART_TYPES.has(type)) {
        return [mediaPart(type, object, "")];
      }

      return [
        {
          type: LlmMessagePartType.Other,
          text: valueToText(object),
        },
      ];
  }
}

// The text of a content value that may be a string or a list of parts.
function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .flatMap((element: unknown): Array<LlmMessagePart> => {
        return partsFromElement(element);
      })
      .filter((part: LlmMessagePart): boolean => {
        return part.type === LlmMessagePartType.Text;
      })
      .map((part: LlmMessagePart): string => {
        return part.text;
      })
      .join("\n");
  }

  return valueToText(content);
}

/*
 * A message's content value: a string (possibly the JSON text of a parts
 * list, as OpenLLMetry writes multimodal prompts), a parts list, or an
 * object.
 */
function partsFromContent(
  content: unknown,
  maxJsonLength: number,
): Array<LlmMessagePart> {
  if (content === undefined || content === null) {
    return [];
  }

  if (typeof content === "string") {
    const trimmed: string = content.trim();

    if (trimmed.startsWith("[") && trimmed.length <= maxJsonLength) {
      try {
        const parsed: unknown = JSON.parse(trimmed);

        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.every((element: unknown): boolean => {
            const object: Dictionary | null = asDictionary(element);
            return Boolean(object && typeof object["type"] === "string");
          })
        ) {
          return parsed.flatMap((element: unknown): Array<LlmMessagePart> => {
            return partsFromElement(element);
          });
        }
      } catch {
        // Not JSON after all: it is the text.
      }
    }

    return content.length > 0
      ? [{ type: LlmMessagePartType.Text, text: content }]
      : [];
  }

  if (Array.isArray(content)) {
    return content.flatMap((element: unknown): Array<LlmMessagePart> => {
      return partsFromElement(element);
    });
  }

  const object: Dictionary | null = asDictionary(content);

  if (object) {
    // A single part object, or an object to show as JSON.
    const parts: Array<LlmMessagePart> = partsFromElement(object);
    return parts.length > 0
      ? parts
      : [{ type: LlmMessagePartType.Text, text: valueToText(object) }];
  }

  return [{ type: LlmMessagePartType.Text, text: scalarToString(content) }];
}

function toolCallsFromList(list: unknown): Array<LlmMessagePart> {
  if (!Array.isArray(list)) {
    return [];
  }

  const parts: Array<LlmMessagePart> = [];

  for (const element of list) {
    const object: Dictionary | null = asDictionary(element);

    if (!object) {
      continue;
    }

    const fn: Dictionary | null = asDictionary(object["function"]);

    parts.push({
      type: LlmMessagePartType.ToolCall,
      text: "",
      toolCallId:
        readString(object, "id", "toolCallId", "tool_call_id") || undefined,
      toolName:
        (fn ? readString(fn, "name") : "") ||
        readString(object, "name", "toolName"),
      arguments: valueToText(
        fn?.["arguments"] ??
          object["arguments"] ??
          object["args"] ??
          object["input"],
      ),
    });
  }

  return parts;
}

export default class LlmMessageParser {
  /*
   * One message object in any provider's shape, or null when it carries
   * nothing to show.
   */
  public static normalizeMessage(
    raw: unknown,
    options?: LlmMessageParserOptions,
  ): LlmMessage | null {
    const maxJsonLength: number =
      options?.maxJsonLength ?? LLM_MESSAGE_MAX_JSON_LENGTH;

    if (typeof raw === "string") {
      return raw.length > 0
        ? {
            role: "",
            name: "",
            parts: [{ type: LlmMessagePartType.Text, text: raw }],
            finishReason: "",
          }
        : null;
    }

    const object: Dictionary | null = asDictionary(raw);

    if (!object) {
      return null;
    }

    const role: string = normalizeRole(
      readString(object, "role", "author", "speaker"),
    );

    let parts: Array<LlmMessagePart> = [];

    if (Array.isArray(object["parts"])) {
      parts = (object["parts"] as Array<unknown>).flatMap(
        (element: unknown): Array<LlmMessagePart> => {
          return partsFromElement(element);
        },
      );
    }

    if (object["content"] !== undefined && object["content"] !== null) {
      parts = parts.concat(partsFromContent(object["content"], maxJsonLength));
    } else if (typeof object["text"] === "string" && parts.length === 0) {
      parts.push({ type: LlmMessagePartType.Text, text: object["text"] });
    }

    // OpenAI chat: tool_calls / the legacy function_call / a refusal field.
    parts = parts.concat(toolCallsFromList(object["tool_calls"]));
    parts = parts.concat(toolCallsFromList(object["toolCalls"]));

    const functionCall: Dictionary | null = asDictionary(
      object["function_call"],
    );

    if (functionCall) {
      parts = parts.concat(toolCallsFromList([{ function: functionCall }]));
    }

    if (typeof object["refusal"] === "string" && object["refusal"]) {
      parts.push({
        type: LlmMessagePartType.Refusal,
        text: object["refusal"] as string,
      });
    }

    // A tool message answers a call: its text IS the tool's result.
    const toolCallId: string = readString(
      object,
      "tool_call_id",
      "toolCallId",
      "id",
    );

    if (role === "tool") {
      parts = parts.map((part: LlmMessagePart): LlmMessagePart => {
        if (part.type !== LlmMessagePartType.Text) {
          return part;
        }

        return {
          type: LlmMessagePartType.ToolResult,
          text: part.text,
          toolCallId: toolCallId || undefined,
          toolName: readString(object, "name") || undefined,
        };
      });
    }

    parts = parts.filter((part: LlmMessagePart): boolean => {
      return (
        part.type !== LlmMessagePartType.Text || part.text.trim().length > 0
      );
    });

    const finishReason: string = readString(
      object,
      "finish_reason",
      "finishReason",
      "stop_reason",
    ).toLowerCase();

    if (parts.length === 0 && !role && !finishReason) {
      return null;
    }

    return {
      role: role,
      name: role === "tool" ? "" : readString(object, "name"),
      parts: parts,
      finishReason: finishReason,
    };
  }

  /*
   * A list of messages from any container: a messages array, a single
   * message, an OpenAI response ({choices: [{message}]}), an Anthropic
   * response ({content, stop_reason}), an object holding a messages list
   * (OpenInference's input.value), or plain text (read as one message with
   * the role given).
   */
  public static normalizeMessages(
    raw: unknown,
    defaultRole: string,
    options?: LlmMessageParserOptions,
  ): Array<LlmMessage> {
    if (raw === undefined || raw === null) {
      return [];
    }

    if (typeof raw === "string") {
      return raw.trim().length > 0
        ? [
            {
              role: defaultRole,
              name: "",
              parts: [{ type: LlmMessagePartType.Text, text: raw }],
              finishReason: "",
            },
          ]
        : [];
    }

    if (Array.isArray(raw)) {
      const messages: Array<LlmMessage> = [];

      for (const element of raw) {
        const message: LlmMessage | null = LlmMessageParser.normalizeMessage(
          element,
          options,
        );

        if (message) {
          messages.push(
            message.role ? message : { ...message, role: defaultRole },
          );
        }
      }

      return messages;
    }

    const object: Dictionary | null = asDictionary(raw);

    if (!object) {
      return [];
    }

    if (Array.isArray(object["messages"])) {
      return LlmMessageParser.normalizeMessages(
        object["messages"],
        defaultRole,
        options,
      );
    }

    if (Array.isArray(object["choices"])) {
      const messages: Array<LlmMessage> = [];

      for (const choice of object["choices"] as Array<unknown>) {
        const choiceObject: Dictionary | null = asDictionary(choice);

        if (!choiceObject) {
          continue;
        }

        const message: LlmMessage | null = LlmMessageParser.normalizeMessage(
          choiceObject["message"] ??
            choiceObject["delta"] ??
            (typeof choiceObject["text"] === "string"
              ? { role: "assistant", content: choiceObject["text"] }
              : undefined),
          options,
        );

        if (message) {
          messages.push({
            ...message,
            role: message.role || defaultRole,
            finishReason:
              message.finishReason ||
              readString(choiceObject, "finish_reason").toLowerCase(),
          });
        }
      }

      return messages;
    }

    // A Gemini response: {candidates: [{content: {role, parts}, finishReason}]}.
    if (Array.isArray(object["candidates"])) {
      const messages: Array<LlmMessage> = [];

      for (const candidate of object["candidates"] as Array<unknown>) {
        const candidateObject: Dictionary | null = asDictionary(candidate);

        if (!candidateObject) {
          continue;
        }

        const message: LlmMessage | null = LlmMessageParser.normalizeMessage(
          candidateObject["content"],
          options,
        );

        if (message) {
          messages.push({
            ...message,
            role: message.role || defaultRole,
            finishReason:
              message.finishReason ||
              readString(candidateObject, "finishReason").toLowerCase(),
          });
        }
      }

      return messages;
    }

    /*
     * An OpenAI Responses API response: {output: [message | function_call |
     * reasoning items]}. Messages are messages; any other item is a part of
     * the assistant's answer.
     */
    if (Array.isArray(object["output"])) {
      /*
       * Its items are ONE answer (reasoning, text, tool calls), not
       * alternative choices, so they become one message.
       */
      const parts: Array<LlmMessagePart> = [];

      for (const item of object["output"] as Array<unknown>) {
        const itemObject: Dictionary | null = asDictionary(item);

        if (itemObject && typeof itemObject["role"] === "string") {
          const message: LlmMessage | null = LlmMessageParser.normalizeMessage(
            itemObject,
            options,
          );

          if (message) {
            parts.push(...message.parts);
          }

          continue;
        }

        if (itemObject && readString(itemObject, "type") === "reasoning") {
          const summary: unknown = itemObject["summary"];
          parts.push({
            type: LlmMessagePartType.Reasoning,
            text: Array.isArray(summary)
              ? contentToText(summary)
              : valueToText(summary),
          });
          continue;
        }

        parts.push(...partsFromElement(item));
      }

      return parts.length > 0
        ? [
            {
              role: defaultRole,
              name: "",
              parts: parts,
              finishReason: "",
            },
          ]
        : [];
    }

    // An Anthropic response, or any single message.
    if (
      object["role"] !== undefined ||
      object["content"] !== undefined ||
      object["parts"] !== undefined ||
      object["tool_calls"] !== undefined
    ) {
      const message: LlmMessage | null = LlmMessageParser.normalizeMessage(
        object,
        options,
      );

      return message ? [{ ...message, role: message.role || defaultRole }] : [];
    }

    // A chain's input or output object: the first field that holds text.
    for (const field of [
      "output",
      "answer",
      "response",
      "result",
      "text",
      "input",
      "question",
      "query",
      "prompt",
    ]) {
      const value: unknown = object[field];

      if (typeof value === "string" && value.trim().length > 0) {
        return [
          {
            role: defaultRole,
            name: "",
            parts: [{ type: LlmMessagePartType.Text, text: value }],
            finishReason: "",
          },
        ];
      }
    }

    const text: string = valueToText(object);

    return text && text !== "{}"
      ? [
          {
            role: defaultRole,
            name: "",
            parts: [{ type: LlmMessagePartType.Text, text: text }],
            finishReason: "",
          },
        ]
      : [];
  }

  /*
   * Everything the call said. Used by the conversation view and the span
   * panel; the ingest path uses readAnswer, which never reads the prompt.
   */
  public static readCallContent(data: {
    attributes: unknown;
    events?: unknown;
    options?: LlmMessageParserOptions | undefined;
  }): LlmCallContent {
    const maxJsonLength: number =
      data.options?.maxJsonLength ?? LLM_MESSAGE_MAX_JSON_LENGTH;
    const reader: AttributeReader = new AttributeReader(data.attributes);
    const events: Array<Dictionary> = LlmMessageParser.readEvents(data.events);
    const detailsEvent: AttributeReader | null =
      LlmMessageParser.findDetailsEvent(events);

    const answer: LlmAnswerReading = LlmMessageParser.readAnswerFromReaders({
      reader: reader,
      detailsEvent: detailsEvent,
      events: events,
      maxJsonLength: maxJsonLength,
    });

    return {
      systemInstructions: LlmMessageParser.readSystemInstructions(
        reader,
        detailsEvent,
        maxJsonLength,
      ),
      input: LlmMessageParser.readInput(
        reader,
        detailsEvent,
        events,
        maxJsonLength,
      ),
      output: answer.output,
      finishReasons: answer.finishReasons,
      tool: LlmMessageParser.readToolRun(reader),
      evaluations: answer.evaluations,
      errorType: answer.errorType,
    };
  }

  /*
   * Only what the answer checks need: the answer, the finish reasons, the
   * evaluations and the error type. Parses JSON up to
   * LLM_ANSWER_MAX_JSON_LENGTH; an answer longer than that is certainly not
   * empty, and is summarized as text without being parsed.
   */
  public static readAnswer(data: {
    attributes: unknown;
    events?: unknown;
  }): LlmAnswerReading {
    const reader: AttributeReader = new AttributeReader(data.attributes);
    const events: Array<Dictionary> = LlmMessageParser.readEvents(data.events);

    return LlmMessageParser.readAnswerFromReaders({
      reader: reader,
      detailsEvent: LlmMessageParser.findDetailsEvent(events),
      events: events,
      maxJsonLength: LLM_ANSWER_MAX_JSON_LENGTH,
    });
  }

  // The joined text parts of a message ("" when it has none).
  public static getText(message: LlmMessage): string {
    return message.parts
      .filter((part: LlmMessagePart): boolean => {
        return (
          part.type === LlmMessagePartType.Text ||
          part.type === LlmMessagePartType.Refusal
        );
      })
      .map((part: LlmMessagePart): string => {
        return part.text;
      })
      .join("\n\n")
      .trim();
  }

  /*
   * Every part of a message as plain text, for places that show one string
   * (the span panel's message blocks, previews).
   */
  public static toDisplayText(message: LlmMessage): string {
    const lines: Array<string> = [];

    for (const part of message.parts) {
      switch (part.type) {
        case LlmMessagePartType.Text:
        case LlmMessagePartType.Refusal:
        case LlmMessagePartType.Other:
          if (part.text) {
            lines.push(part.text);
          }
          break;
        case LlmMessagePartType.Reasoning:
          if (part.text) {
            lines.push(`(thinking) ${part.text}`);
          }
          break;
        case LlmMessagePartType.ToolCall:
          lines.push(
            `→ ${part.toolName || "tool"}(${(part.arguments || "").trim()})`,
          );
          break;
        case LlmMessagePartType.ToolResult:
          lines.push(
            `← ${part.toolName ? `${part.toolName}: ` : ""}${part.text}`,
          );
          break;
        case LlmMessagePartType.Media:
          lines.push(
            `[${part.modality || "file"}${part.uri ? `: ${part.uri}` : ""}]`,
          );
          break;
      }
    }

    return lines.join("\n\n").trim();
  }

  public static summarizeAnswer(
    output: Array<LlmMessage>,
    recorded: boolean,
  ): LlmAnswerContentSummary {
    let hasText: boolean = false;
    let hasToolCall: boolean = false;
    let hasMedia: boolean = false;
    let hasRefusal: boolean = false;
    let leadingText: string = "";

    for (const message of output) {
      for (const part of message.parts) {
        if (part.type === LlmMessagePartType.Text && part.text.trim()) {
          hasText = true;

          if (!leadingText) {
            leadingText = part.text
              .trimStart()
              .slice(0, LLM_REFUSAL_OPENING_LENGTH);
          }
        }

        if (part.type === LlmMessagePartType.ToolCall) {
          hasToolCall = true;
        }

        if (part.type === LlmMessagePartType.Media) {
          hasMedia = true;
        }

        if (part.type === LlmMessagePartType.Refusal) {
          hasRefusal = true;
        }
      }
    }

    return {
      recorded: recorded,
      hasText: hasText,
      hasToolCall: hasToolCall,
      hasMedia: hasMedia,
      hasRefusal: hasRefusal,
      leadingText: leadingText,
    };
  }

  private static readEvents(events: unknown): Array<Dictionary> {
    if (!Array.isArray(events)) {
      return [];
    }

    return events.filter((event: unknown): event is Dictionary => {
      return Boolean(asDictionary(event));
    });
  }

  private static eventName(event: Dictionary): string {
    return readString(event, "name");
  }

  private static eventAttributes(event: Dictionary): AttributeReader {
    return new AttributeReader(asDictionary(event["attributes"]) || {});
  }

  private static findDetailsEvent(
    events: Array<Dictionary>,
  ): AttributeReader | null {
    for (const event of events) {
      if (LlmMessageParser.eventName(event) === LlmInferenceDetailsEventName) {
        return LlmMessageParser.eventAttributes(event);
      }
    }

    return null;
  }

  private static readAnswerFromReaders(data: {
    reader: AttributeReader;
    detailsEvent: AttributeReader | null;
    events: Array<Dictionary>;
    maxJsonLength: number;
  }): LlmAnswerReading {
    const { reader, detailsEvent, events, maxJsonLength } = data;

    let output: Array<LlmMessage> = [];
    let recorded: boolean = false;
    let oversizedText: string | null = null;

    // 1. The JSON message list (current conventions first), on the span.
    const jsonOutput: { key: string; value: unknown } = reader.first(
      LlmCompletionJsonAttributeKeys,
    );

    if (jsonOutput.key) {
      recorded = true;

      if (
        typeof jsonOutput.value === "string" &&
        jsonOutput.value.length > maxJsonLength
      ) {
        oversizedText = jsonOutput.value;
      } else {
        output = LlmMessageParser.normalizeMessages(
          toStructured(jsonOutput.value, jsonOutput.key, maxJsonLength),
          "assistant",
          { maxJsonLength: maxJsonLength },
        );
      }
    }

    // 2. ... or on the inference details event.
    if (!recorded && detailsEvent) {
      const eventOutput: unknown = detailsEvent.get("gen_ai.output.messages");

      if (!isBlank(eventOutput)) {
        recorded = true;
        output = LlmMessageParser.normalizeMessages(
          toStructured(eventOutput, "gen_ai.output.messages", maxJsonLength),
          "assistant",
          { maxJsonLength: maxJsonLength },
        );
      }
    }

    // 3. Indexed attributes (OpenLLMetry, OpenInference).
    if (!recorded) {
      for (const convention of LlmCompletionIndexedMessageConventions) {
        const messages: Array<LlmMessage> | null = LlmMessageParser.readIndexed(
          reader,
          convention,
          maxJsonLength,
        );

        if (messages) {
          recorded = true;
          output = messages.map((message: LlmMessage): LlmMessage => {
            return { ...message, role: message.role || "assistant" };
          });
          break;
        }
      }
    }

    // 4. The deprecated choice event.
    if (!recorded) {
      const choiceMessages: Array<LlmMessage> = [];

      for (const event of events) {
        if (
          !LlmCompletionEventNames.includes(LlmMessageParser.eventName(event))
        ) {
          continue;
        }

        recorded = true;
        const message: LlmMessage | null = LlmMessageParser.messageFromEvent(
          LlmMessageParser.eventAttributes(event),
          "assistant",
          maxJsonLength,
        );

        if (message) {
          choiceMessages.push(message);
        }
      }

      output = choiceMessages;
    }

    // The Vercel AI SDK keeps its tool calls apart from its text.
    const vercelToolCalls: { key: string; value: unknown } = reader.first(
      LlmResponseToolCallsAttributeKeys,
    );

    if (vercelToolCalls.key) {
      recorded = true;
      const toolCallParts: Array<LlmMessagePart> = toolCallsFromList(
        toStructured(vercelToolCalls.value, vercelToolCalls.key, maxJsonLength),
      );

      if (toolCallParts.length > 0) {
        if (output.length === 0) {
          output.push({
            role: "assistant",
            name: "",
            parts: [],
            finishReason: "",
          });
        }

        output[0] = {
          ...(output[0] as LlmMessage),
          parts: [...(output[0] as LlmMessage).parts, ...toolCallParts],
        };
      }
    }

    const finishReasons: Array<string> = LlmMessageParser.readFinishReasons(
      reader,
      output,
      detailsEvent,
    );

    const summary: LlmAnswerContentSummary = oversizedText
      ? {
          recorded: true,
          hasText: true,
          hasToolCall: false,
          hasMedia: false,
          hasRefusal: false,
          // The opening of a JSON list is not the answer's opening.
          leadingText: oversizedText.trimStart().startsWith("[")
            ? ""
            : oversizedText.trimStart().slice(0, LLM_REFUSAL_OPENING_LENGTH),
        }
      : LlmMessageParser.summarizeAnswer(output, recorded);

    return {
      output: output,
      finishReasons: finishReasons,
      evaluations: LlmMessageParser.readEvaluations(events),
      errorType:
        reader.firstString(LlmErrorTypeAttributeKeys) ||
        (detailsEvent
          ? detailsEvent.firstString(LlmErrorTypeAttributeKeys)
          : ""),
      summary: summary,
    };
  }

  private static readSystemInstructions(
    reader: AttributeReader,
    detailsEvent: AttributeReader | null,
    maxJsonLength: number,
  ): string {
    let found: { key: string; value: unknown } = reader.first(
      LlmSystemInstructionsAttributeKeys,
    );

    if (!found.key && detailsEvent) {
      found = detailsEvent.first(LlmSystemInstructionsAttributeKeys);
    }

    if (!found.key) {
      return "";
    }

    const structured: unknown = toStructured(
      found.value,
      found.key,
      maxJsonLength,
    );

    if (typeof structured === "string") {
      return structured.trim();
    }

    return partsFromContent(structured, maxJsonLength)
      .filter((part: LlmMessagePart): boolean => {
        return part.type === LlmMessagePartType.Text;
      })
      .map((part: LlmMessagePart): string => {
        return part.text;
      })
      .join("\n\n")
      .trim();
  }

  private static readInput(
    reader: AttributeReader,
    detailsEvent: AttributeReader | null,
    events: Array<Dictionary>,
    maxJsonLength: number,
  ): Array<LlmMessage> {
    const jsonInput: { key: string; value: unknown } = reader.first(
      LlmPromptJsonAttributeKeys,
    );

    if (jsonInput.key) {
      if (
        typeof jsonInput.value === "string" &&
        jsonInput.value.length > maxJsonLength
      ) {
        return [];
      }

      return LlmMessageParser.normalizeMessages(
        toStructured(jsonInput.value, jsonInput.key, maxJsonLength),
        "user",
        { maxJsonLength: maxJsonLength },
      );
    }

    if (detailsEvent) {
      const eventInput: unknown = detailsEvent.get("gen_ai.input.messages");

      if (!isBlank(eventInput)) {
        return LlmMessageParser.normalizeMessages(
          toStructured(eventInput, "gen_ai.input.messages", maxJsonLength),
          "user",
          { maxJsonLength: maxJsonLength },
        );
      }
    }

    for (const convention of LlmPromptIndexedMessageConventions) {
      const messages: Array<LlmMessage> | null = LlmMessageParser.readIndexed(
        reader,
        convention,
        maxJsonLength,
      );

      if (messages) {
        return messages.map((message: LlmMessage): LlmMessage => {
          return { ...message, role: message.role || "user" };
        });
      }
    }

    const eventMessages: Array<LlmMessage> = [];

    for (const event of events) {
      const name: string = LlmMessageParser.eventName(event);

      if (!LlmPromptEventNames.includes(name)) {
        continue;
      }

      // gen_ai.user.message -> user, gen_ai.tool.message -> tool ...
      const roleFromName: string = normalizeRole(
        name.replace("gen_ai.", "").replace(".message", ""),
      );

      const message: LlmMessage | null = LlmMessageParser.messageFromEvent(
        LlmMessageParser.eventAttributes(event),
        roleFromName,
        maxJsonLength,
      );

      if (message) {
        eventMessages.push(message);
      }
    }

    return eventMessages;
  }

  private static messageFromEvent(
    attributes: AttributeReader,
    defaultRole: string,
    maxJsonLength: number,
  ): LlmMessage | null {
    // gen_ai.choice nests the answer under "message".
    const nested: Dictionary = {};

    for (const key of attributes.keysWithPrefix("message.")) {
      nested[key.slice("message.".length)] = attributes.get(key);
    }

    const source: Dictionary =
      Object.keys(nested).length > 0
        ? (unprefix(nested, "message") as Dictionary)
        : {};

    for (const field of [
      "content",
      "role",
      "tool_calls",
      "id",
      "tool_call_id",
      "name",
      "refusal",
    ]) {
      const value: unknown = attributes.get(field);

      if (value !== undefined && source[field] === undefined) {
        source[field] = toStructured(value, field, maxJsonLength);
      }
    }

    if (typeof source["content"] === "string") {
      source["content"] = toStructured(
        source["content"],
        "content",
        maxJsonLength,
      );
    }

    const message: LlmMessage | null = LlmMessageParser.normalizeMessage(
      {
        ...source,
        role: readString(source, "role") || defaultRole,
      },
      { maxJsonLength: maxJsonLength },
    );

    if (!message) {
      return null;
    }

    const finishReason: string =
      message.finishReason ||
      scalarToString(attributes.get("finish_reason")).toLowerCase();

    return { ...message, finishReason: finishReason };
  }

  /*
   * `${prefix}.<i>.<field...>` messages, or null when the span has none
   * under this prefix.
   */
  private static readIndexed(
    reader: AttributeReader,
    convention: LlmIndexedMessageConvention,
    maxJsonLength: number,
  ): Array<LlmMessage> | null {
    const prefix: string = `${convention.prefix}.`;
    const bags: Map<number, Map<string, unknown>> = new Map<
      number,
      Map<string, unknown>
    >();

    for (const key of reader.keysWithPrefix(prefix)) {
      const rest: string = key.slice(prefix.length);
      const dot: number = rest.indexOf(".");

      if (dot <= 0) {
        continue;
      }

      const indexText: string = rest.slice(0, dot);
      const index: number = Number(indexText);

      if (
        !Number.isInteger(index) ||
        index < 0 ||
        indexText !== String(index)
      ) {
        continue;
      }

      const bag: Map<string, unknown> =
        bags.get(index) || new Map<string, unknown>();
      bag.set(rest.slice(dot + 1), reader.get(key));
      bags.set(index, bag);
    }

    if (bags.size === 0) {
      return null;
    }

    const messages: Array<LlmMessage> = [];

    for (const index of Array.from(bags.keys()).sort(
      (left: number, right: number): number => {
        return left - right;
      },
    )) {
      const bag: Map<string, unknown> = bags.get(index) as Map<string, unknown>;
      const message: LlmMessage | null =
        convention.style === "openinference"
          ? LlmMessageParser.openInferenceMessage(
              bag,
              convention,
              maxJsonLength,
            )
          : LlmMessageParser.openLlmetryMessage(bag, convention, maxJsonLength);

      if (message) {
        messages.push(message);
      }
    }

    return messages;
  }

  private static subIndexed(
    bag: Map<string, unknown>,
    prefix: string,
  ): Map<number, Map<string, unknown>> {
    const result: Map<number, Map<string, unknown>> = new Map<
      number,
      Map<string, unknown>
    >();

    for (const [key, value] of bag.entries()) {
      if (!key.startsWith(prefix)) {
        continue;
      }

      const rest: string = key.slice(prefix.length);
      const dot: number = rest.indexOf(".");

      if (dot <= 0) {
        continue;
      }

      const index: number = Number(rest.slice(0, dot));

      if (!Number.isInteger(index) || index < 0) {
        continue;
      }

      const inner: Map<string, unknown> =
        result.get(index) || new Map<string, unknown>();
      inner.set(rest.slice(dot + 1), value);
      result.set(index, inner);
    }

    return result;
  }

  private static openLlmetryMessage(
    bag: Map<string, unknown>,
    convention: LlmIndexedMessageConvention,
    maxJsonLength: number,
  ): LlmMessage | null {
    const toolCalls: Array<Dictionary> = [];
    const calls: Map<
      number,
      Map<string, unknown>
    > = LlmMessageParser.subIndexed(bag, "tool_calls.");

    for (const index of Array.from(calls.keys()).sort(
      (left: number, right: number): number => {
        return left - right;
      },
    )) {
      const call: Map<string, unknown> = calls.get(index) as Map<
        string,
        unknown
      >;
      toolCalls.push({
        id: scalarToString(call.get("id")),
        name: scalarToString(call.get("name")),
        arguments: call.get("arguments"),
      });
    }

    return LlmMessageParser.normalizeMessage(
      {
        role: scalarToString(bag.get(convention.roleSuffix)),
        content: bag.get(convention.contentSuffix),
        tool_calls: toolCalls,
        tool_call_id: scalarToString(bag.get("tool_call_id")),
        refusal: bag.get("refusal"),
        finish_reason: scalarToString(bag.get("finish_reason")),
      },
      { maxJsonLength: maxJsonLength },
    );
  }

  private static openInferenceMessage(
    bag: Map<string, unknown>,
    convention: LlmIndexedMessageConvention,
    maxJsonLength: number,
  ): LlmMessage | null {
    const content: Array<unknown> = [];
    const text: unknown = bag.get(convention.contentSuffix);

    if (text !== undefined) {
      content.push(text);
    }

    const contents: Map<
      number,
      Map<string, unknown>
    > = LlmMessageParser.subIndexed(bag, "message.contents.");

    for (const index of Array.from(contents.keys()).sort(
      (left: number, right: number): number => {
        return left - right;
      },
    )) {
      const part: Map<string, unknown> = contents.get(index) as Map<
        string,
        unknown
      >;
      const partType: string = scalarToString(
        part.get("message_content.type"),
      ).toLowerCase();

      if (partType === "image") {
        content.push({
          type: "image",
          url: scalarToString(part.get("message_content.image.image.url")),
        });
      } else {
        content.push({
          type: "text",
          text: scalarToString(part.get("message_content.text")),
        });
      }
    }

    const toolCalls: Array<Dictionary> = [];
    const calls: Map<
      number,
      Map<string, unknown>
    > = LlmMessageParser.subIndexed(bag, "message.tool_calls.");

    for (const index of Array.from(calls.keys()).sort(
      (left: number, right: number): number => {
        return left - right;
      },
    )) {
      const call: Map<string, unknown> = calls.get(index) as Map<
        string,
        unknown
      >;
      toolCalls.push({
        id: scalarToString(call.get("tool_call.id")),
        name: scalarToString(call.get("tool_call.function.name")),
        arguments: call.get("tool_call.function.arguments"),
      });
    }

    const contentValue: unknown =
      content.length === 1 && typeof content[0] === "string"
        ? content[0]
        : content.length > 0
          ? content
          : undefined;

    return LlmMessageParser.normalizeMessage(
      {
        role: scalarToString(bag.get(convention.roleSuffix)),
        name: scalarToString(bag.get("message.name")),
        content: contentValue,
        tool_calls: toolCalls,
        tool_call_id: scalarToString(bag.get("message.tool_call_id")),
      },
      { maxJsonLength: maxJsonLength },
    );
  }

  private static readFinishReasons(
    reader: AttributeReader,
    output: Array<LlmMessage>,
    detailsEvent: AttributeReader | null,
  ): Array<string> {
    const reasons: Array<string> = [];

    const add: (value: unknown) => void = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const element of value) {
          add(element);
        }
        return;
      }

      const text: string = scalarToString(value).trim();

      if (!text) {
        return;
      }

      // A list stored as JSON text ('["stop"]') or joined with commas.
      if (text.startsWith("[")) {
        try {
          const parsed: unknown = JSON.parse(text);

          if (Array.isArray(parsed)) {
            add(parsed);
            return;
          }
        } catch {
          // Fall through to the text itself.
        }
      }

      for (const piece of text.split(",")) {
        const reason: string = stripQuotes(piece.trim()).toLowerCase();

        if (reason && !reasons.includes(reason)) {
          reasons.push(reason);
        }
      }
    };

    for (const key of LlmFinishReasonAttributeKeys) {
      add(reader.get(key));
    }

    if (detailsEvent) {
      add(detailsEvent.get("gen_ai.response.finish_reasons"));
    }

    for (const message of output) {
      add(message.finishReason);
    }

    return reasons;
  }

  private static readToolRun(reader: AttributeReader): LlmToolRun | null {
    const name: string = reader.firstString(LlmToolNameAttributeKeys);
    const id: string = reader.firstString(LlmToolCallIdAttributeKeys);
    const argumentsValue: unknown = reader.firstStructured(
      LlmToolCallArgumentsAttributeKeys,
    );
    const resultValue: unknown = reader.firstStructured(
      LlmToolCallResultAttributeKeys,
    );

    if (!name && !id) {
      return null;
    }

    return {
      id: id,
      name: name,
      arguments: valueToText(argumentsValue),
      result: valueToText(resultValue),
    };
  }

  public static readEvaluations(events: unknown): Array<LlmEvaluationResult> {
    const evaluations: Array<LlmEvaluationResult> = [];

    for (const event of LlmMessageParser.readEvents(events)) {
      if (LlmMessageParser.eventName(event) !== LlmEvaluationResultEventName) {
        continue;
      }

      const attributes: AttributeReader =
        LlmMessageParser.eventAttributes(event);
      const scoreText: string = scalarToString(
        attributes.get(LlmEvaluationScoreValueAttributeKey),
      ).trim();
      const score: number = Number(scoreText);

      evaluations.push({
        name: scalarToString(
          attributes.get(LlmEvaluationNameAttributeKey),
        ).trim(),
        label: scalarToString(
          attributes.get(LlmEvaluationScoreLabelAttributeKey),
        ).trim(),
        score: scoreText && Number.isFinite(score) ? score : null,
        explanation: scalarToString(
          attributes.get(LlmEvaluationExplanationAttributeKey),
        ).trim(),
      });
    }

    return evaluations;
  }
}
