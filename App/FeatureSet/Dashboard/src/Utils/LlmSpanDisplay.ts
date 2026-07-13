import { JSONObject } from "Common/Types/JSON";
import { SpanEvent } from "Common/Models/AnalyticsModels/Span";
import {
  LlmAgentNameAttributeKeys,
  LlmAttributeNamespacePrefixes,
  LlmCompletionEventNames,
  LlmCompletionIndexedMessageConventions,
  LlmCompletionJsonAttributeKeys,
  LlmCostAttributeKeys,
  LlmFinishReasonAttributeKeys,
  LlmInputTokenAttributeKeys,
  LlmMaxTokensAttributeKeys,
  LlmOperationAttributeKeys,
  LlmOutputTokenAttributeKeys,
  LlmPromptEventNames,
  LlmPromptIndexedMessageConventions,
  LlmPromptJsonAttributeKeys,
  LlmRequestModelAttributeKeys,
  LlmResponseModelAttributeKeys,
  LlmSystemAttributeKeys,
  LlmTemperatureAttributeKeys,
  LlmToolNameAttributeKeys,
  LlmTopPAttributeKeys,
  LlmTotalTokenAttributeKeys,
} from "Common/Types/Telemetry/LlmConventions";

/*
 * Frontend helper for rendering LLM / GenAI / agent spans in a first-class
 * panel. It mirrors the metric extraction done server-side at ingest
 * (Common/Server/Utils/Telemetry/LlmSpan.ts) but additionally reconstructs the
 * prompt / completion CONTENT for display. Content is intentionally left out of
 * the denormalized DB columns and lives in the span attributes/events map, so
 * this parsing happens at render time on whatever the API returned.
 *
 * The recognized attribute keys / event names / message conventions all come
 * from the shared Common/Types/Telemetry/LlmConventions module, which the
 * server extractor imports too — so the two cannot drift out of sync.
 */

export interface LlmMessage {
  role: string;
  content: string;
}

export interface LlmSpanDisplay {
  isLlmSpan: boolean;
  system: string;
  operation: string;
  requestModel: string;
  responseModel: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  hasCost: boolean;
  agentName: string;
  toolName: string;
  temperature: string;
  maxTokens: string;
  topP: string;
  finishReasons: string;
  promptMessages: Array<LlmMessage>;
  completionMessages: Array<LlmMessage>;
}

type FlatAttributes = Record<string, string>;

export default class LlmSpanDisplayUtil {
  /**
   * Build the display model for an LLM span. Returns isLlmSpan=false for
   * non-LLM spans so callers can render nothing.
   */
  public static parse(data: {
    attributes: JSONObject | undefined;
    events?: Array<SpanEvent> | undefined;
  }): LlmSpanDisplay {
    const flat: FlatAttributes = this.flatten(data.attributes);

    const display: LlmSpanDisplay = {
      isLlmSpan: false,
      system: this.firstString(flat, LlmSystemAttributeKeys),
      operation: this.firstString(flat, LlmOperationAttributeKeys),
      requestModel: this.firstString(flat, LlmRequestModelAttributeKeys),
      responseModel: this.firstString(flat, LlmResponseModelAttributeKeys),
      inputTokens: this.firstNumber(flat, LlmInputTokenAttributeKeys),
      outputTokens: this.firstNumber(flat, LlmOutputTokenAttributeKeys),
      totalTokens: this.firstNumber(flat, LlmTotalTokenAttributeKeys),
      cost: 0,
      hasCost: false,
      agentName: this.firstString(flat, LlmAgentNameAttributeKeys),
      toolName: this.firstString(flat, LlmToolNameAttributeKeys),
      temperature: this.firstString(flat, LlmTemperatureAttributeKeys),
      maxTokens: this.firstString(flat, LlmMaxTokensAttributeKeys),
      topP: this.firstString(flat, LlmTopPAttributeKeys),
      finishReasons: this.firstString(flat, LlmFinishReasonAttributeKeys),
      promptMessages: [],
      completionMessages: [],
    };

    if (!display.requestModel && display.responseModel) {
      display.requestModel = display.responseModel;
    }

    for (const key of LlmCostAttributeKeys) {
      if (flat[key] !== undefined && flat[key] !== "") {
        const parsed: number = Number(flat[key]);
        if (isFinite(parsed)) {
          display.cost = parsed;
          display.hasCost = true;
          break;
        }
      }
    }

    if (
      display.totalTokens === 0 &&
      (display.inputTokens > 0 || display.outputTokens > 0)
    ) {
      display.totalTokens = display.inputTokens + display.outputTokens;
    }

    display.promptMessages = this.extractPromptMessages(flat, data.events);
    display.completionMessages = this.extractCompletionMessages(
      flat,
      data.events,
    );

    display.isLlmSpan = this.detectIsLlm(flat, display);

    return display;
  }

  private static detectIsLlm(
    flat: FlatAttributes,
    display: LlmSpanDisplay,
  ): boolean {
    if (
      display.system ||
      display.operation ||
      display.requestModel ||
      display.responseModel ||
      display.agentName ||
      display.toolName ||
      display.totalTokens > 0 ||
      display.promptMessages.length > 0 ||
      display.completionMessages.length > 0
    ) {
      return true;
    }

    return Object.keys(flat).some((key: string) => {
      return LlmAttributeNamespacePrefixes.some((prefix: string) => {
        return key.startsWith(prefix);
      });
    });
  }

  private static extractPromptMessages(
    flat: FlatAttributes,
    events: Array<SpanEvent> | undefined,
  ): Array<LlmMessage> {
    // Indexed prompt conventions (OpenLLMetry, then OpenInference).
    for (const convention of LlmPromptIndexedMessageConventions) {
      const messages: Array<LlmMessage> = this.collectIndexed(
        flat,
        convention.prefix,
        convention.contentSuffix,
        convention.roleSuffix,
      );
      if (messages.length > 0) {
        return messages;
      }
    }

    // JSON-encoded message arrays.
    const jsonMessages: Array<LlmMessage> = this.parseMessagesJson(
      this.firstDefined(flat, LlmPromptJsonAttributeKeys),
    );
    if (jsonMessages.length > 0) {
      return jsonMessages;
    }

    // Content events (system/user/tool messages).
    return this.collectEventMessages(events, LlmPromptEventNames);
  }

  private static extractCompletionMessages(
    flat: FlatAttributes,
    events: Array<SpanEvent> | undefined,
  ): Array<LlmMessage> {
    // Indexed completion conventions (OpenLLMetry, then OpenInference).
    for (const convention of LlmCompletionIndexedMessageConventions) {
      const messages: Array<LlmMessage> = this.collectIndexed(
        flat,
        convention.prefix,
        convention.contentSuffix,
        convention.roleSuffix,
      );
      if (messages.length > 0) {
        return messages;
      }
    }

    // JSON-encoded message arrays.
    const jsonMessages: Array<LlmMessage> = this.parseMessagesJson(
      this.firstDefined(flat, LlmCompletionJsonAttributeKeys),
    );
    if (jsonMessages.length > 0) {
      return jsonMessages;
    }

    return this.collectEventMessages(events, LlmCompletionEventNames);
  }

  // Collect `${prefix}.${i}.${contentSuffix}` / `${prefix}.${i}.${roleSuffix}`.
  private static collectIndexed(
    flat: FlatAttributes,
    prefix: string,
    contentSuffix: string,
    roleSuffix: string,
  ): Array<LlmMessage> {
    const byIndex: Map<number, LlmMessage> = new Map();

    for (const key of Object.keys(flat)) {
      if (!key.startsWith(`${prefix}.`)) {
        continue;
      }
      const rest: string = key.substring(prefix.length + 1);
      const dotIndex: number = rest.indexOf(".");
      if (dotIndex < 0) {
        continue;
      }
      const indexPart: string = rest.substring(0, dotIndex);
      const index: number = Number(indexPart);
      if (!Number.isInteger(index)) {
        continue;
      }
      const suffix: string = rest.substring(dotIndex + 1);
      const existing: LlmMessage = byIndex.get(index) || {
        role: "",
        content: "",
      };
      if (suffix === contentSuffix) {
        existing.content = flat[key] || "";
      } else if (suffix === roleSuffix) {
        existing.role = flat[key] || "";
      }
      byIndex.set(index, existing);
    }

    return Array.from(byIndex.entries())
      .sort((a: [number, LlmMessage], b: [number, LlmMessage]): number => {
        return a[0] - b[0];
      })
      .map((entry: [number, LlmMessage]): LlmMessage => {
        return entry[1];
      })
      .filter((message: LlmMessage): boolean => {
        return Boolean(message.content || message.role);
      });
  }

  private static collectEventMessages(
    events: Array<SpanEvent> | undefined,
    eventNames: Array<string>,
  ): Array<LlmMessage> {
    if (!events || events.length === 0) {
      return [];
    }

    const messages: Array<LlmMessage> = [];

    for (const event of events) {
      if (!event || !eventNames.includes(event.name)) {
        continue;
      }
      const attrs: JSONObject = (event.attributes as JSONObject) || {};
      const role: string =
        attrs["role"]?.toString() ||
        (event.name === "gen_ai.choice" ? "assistant" : event.name);
      let content: string = attrs["content"]?.toString() || "";

      if (!content && attrs["message"]) {
        content = this.stringifyMaybeJson(attrs["message"]);
      }

      if (content || role) {
        messages.push({ role: role, content: content });
      }
    }

    return messages;
  }

  private static parseMessagesJson(
    value: string | undefined,
  ): Array<LlmMessage> {
    if (!value || typeof value !== "string") {
      return [];
    }

    const trimmed: string = value.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(trimmed);
      const list: Array<unknown> = Array.isArray(parsed) ? parsed : [parsed];
      const messages: Array<LlmMessage> = [];

      for (const item of list) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const obj: Record<string, unknown> = item as Record<string, unknown>;
        const role: string = obj["role"] ? String(obj["role"]) : "";
        const content: string = this.stringifyMaybeJson(obj["content"]);
        if (role || content) {
          messages.push({ role: role, content: content });
        }
      }

      return messages;
    } catch {
      return [];
    }
  }

  private static stringifyMaybeJson(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "string") {
      return value;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  // Flatten possibly-nested attributes into dotted string key/value pairs.
  private static flatten(
    obj: JSONObject | undefined,
    prefix: string = "",
    out: FlatAttributes = {},
  ): FlatAttributes {
    if (!obj) {
      return out;
    }
    for (const key of Object.keys(obj)) {
      const value: unknown = (obj as Record<string, unknown>)[key];
      const full: string = prefix ? `${prefix}.${key}` : key;
      if (value === null || value === undefined) {
        continue;
      }
      if (typeof value === "object" && !Array.isArray(value)) {
        this.flatten(value as JSONObject, full, out);
      } else {
        out[full] = Array.isArray(value)
          ? value
              .map((entry: unknown): string => {
                return String(entry);
              })
              .join(", ")
          : String(value);
      }
    }
    return out;
  }

  // First non-empty value among the candidate keys (mirrors `a || b || c`).
  private static firstDefined(
    flat: FlatAttributes,
    keys: Array<string>,
  ): string | undefined {
    for (const key of keys) {
      const value: string | undefined = flat[key];
      if (value !== undefined && value !== "") {
        return value;
      }
    }
    return undefined;
  }

  private static firstString(
    flat: FlatAttributes,
    keys: Array<string>,
  ): string {
    for (const key of keys) {
      const value: string | undefined = flat[key];
      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ""
      ) {
        return String(value).trim();
      }
    }
    return "";
  }

  private static firstNumber(
    flat: FlatAttributes,
    keys: Array<string>,
  ): number {
    for (const key of keys) {
      const value: string | undefined = flat[key];
      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ""
      ) {
        const parsed: number = Number(value);
        if (isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return 0;
  }
}
