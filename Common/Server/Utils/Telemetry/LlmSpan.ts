import Dictionary from "../../../Types/Dictionary";
import { AttributeType } from "./Telemetry";

/*
 * First-class detection of LLM / GenAI / AI-agent spans.
 *
 * OneUptime ingests OpenTelemetry spans generically. To make LLM and agent
 * telemetry a first-class signal (filterable lists, token/cost/latency
 * rollups) we denormalize a small set of values out of the span attributes at
 * ingest time. We recognize the OpenTelemetry GenAI semantic conventions
 * (gen_ai.*) as primary, with cheap fallbacks for the two dominant
 * instrumentation libraries:
 *   - OpenLLMetry / Traceloop  (gen_ai.* + traceloop.*)
 *   - OpenInference / Arize    (llm.* + openinference.span.kind)
 *
 * Prompt/completion CONTENT is intentionally NOT denormalized here — it stays
 * in the span's attributes/events map (already captured + scrubbed) and is
 * rendered by the LLM span panel in the dashboard.
 */

export interface LlmSpanFields {
  // True when this span looks like an LLM / GenAI / agent operation.
  isLlmSpan: boolean;
  // Provider / system, e.g. "openai", "anthropic", "aws.bedrock".
  llmSystem: string;
  // Operation, e.g. "chat", "embeddings", "execute_tool", "invoke_agent".
  llmOperation: string;
  // Model requested by the caller.
  llmRequestModel: string;
  // Model the provider actually served (often the resolved/pinned model).
  llmResponseModel: string;
  // Token usage. 0 when the instrumentation did not report it.
  llmInputTokens: number;
  llmOutputTokens: number;
  llmTotalTokens: number;
  // Cost in USD. Only populated when the SDK reports it (no built-in pricing).
  llmCost: number;
  // Agent / tool names for agent-framework spans.
  llmAgentName: string;
  llmToolName: string;
}

type SpanAttributes = Dictionary<AttributeType | Array<AttributeType>>;

export default class LlmSpanUtil {
  /**
   * Return the empty/default LLM field set (non-LLM span).
   */
  public static empty(): LlmSpanFields {
    return {
      isLlmSpan: false,
      llmSystem: "",
      llmOperation: "",
      llmRequestModel: "",
      llmResponseModel: "",
      llmInputTokens: 0,
      llmOutputTokens: 0,
      llmTotalTokens: 0,
      llmCost: 0,
      llmAgentName: "",
      llmToolName: "",
    };
  }

  /**
   * Extract first-class LLM fields from a flattened span attribute dictionary.
   * Pure + side-effect free so it can be unit tested in isolation.
   */
  public static extract(attributes: SpanAttributes): LlmSpanFields {
    const fields: LlmSpanFields = this.empty();

    if (!attributes || typeof attributes !== "object") {
      return fields;
    }

    const keys: Array<string> = Object.keys(attributes);

    if (keys.length === 0) {
      return fields;
    }

    fields.llmSystem = this.getString(attributes, [
      "gen_ai.system",
      "gen_ai.provider.name",
      "llm.system",
      "llm.provider",
    ]);

    fields.llmOperation = this.getString(attributes, [
      "gen_ai.operation.name",
      "llm.request.type",
      "openinference.span.kind",
    ]);

    fields.llmRequestModel = this.getString(attributes, [
      "gen_ai.request.model",
      "llm.model_name",
      "llm.request.model",
    ]);

    fields.llmResponseModel = this.getString(attributes, [
      "gen_ai.response.model",
      "llm.response.model",
    ]);

    // Fall back to the response model when no request model was reported.
    if (!fields.llmRequestModel && fields.llmResponseModel) {
      fields.llmRequestModel = fields.llmResponseModel;
    }

    /*
     * Token columns are ClickHouse Int32 — truncate any fractional value a
     * malformed SDK might report, otherwise the JSONEachRow insert would
     * reject the row and fail the whole span batch.
     */
    fields.llmInputTokens = Math.trunc(
      this.getNumber(attributes, [
        "gen_ai.usage.input_tokens",
        "gen_ai.usage.prompt_tokens",
        "llm.token_count.prompt",
        "llm.usage.prompt_tokens",
      ]),
    );

    fields.llmOutputTokens = Math.trunc(
      this.getNumber(attributes, [
        "gen_ai.usage.output_tokens",
        "gen_ai.usage.completion_tokens",
        "llm.token_count.completion",
        "llm.usage.completion_tokens",
      ]),
    );

    fields.llmTotalTokens = Math.trunc(
      this.getNumber(attributes, [
        "gen_ai.usage.total_tokens",
        "llm.token_count.total",
        "llm.usage.total_tokens",
      ]),
    );

    // Derive total when only the parts were reported.
    if (
      fields.llmTotalTokens === 0 &&
      (fields.llmInputTokens > 0 || fields.llmOutputTokens > 0)
    ) {
      fields.llmTotalTokens = fields.llmInputTokens + fields.llmOutputTokens;
    }

    fields.llmCost = this.getNumber(attributes, [
      "gen_ai.usage.cost",
      "gen_ai.usage.cost_usd",
      "gen_ai.usage.total_cost",
      "llm.usage.total_cost",
    ]);

    fields.llmAgentName = this.getString(attributes, [
      "gen_ai.agent.name",
      "agent.name",
    ]);

    fields.llmToolName = this.getString(attributes, [
      "gen_ai.tool.name",
      "tool.name",
    ]);

    fields.isLlmSpan = this.detectIsLlmSpan(keys, fields);

    return fields;
  }

  private static detectIsLlmSpan(
    keys: Array<string>,
    fields: LlmSpanFields,
  ): boolean {
    if (
      fields.llmSystem ||
      fields.llmOperation ||
      fields.llmRequestModel ||
      fields.llmResponseModel ||
      fields.llmAgentName ||
      fields.llmToolName ||
      fields.llmTotalTokens > 0
    ) {
      return true;
    }

    // Last-resort: any GenAI/LLM-namespaced attribute at all.
    return keys.some((key: string) => {
      return (
        key.startsWith("gen_ai.") ||
        key.startsWith("llm.") ||
        key.startsWith("traceloop.")
      );
    });
  }

  private static getString(
    attributes: SpanAttributes,
    candidateKeys: Array<string>,
  ): string {
    for (const key of candidateKeys) {
      const value: AttributeType | Array<AttributeType> | undefined =
        attributes[key];

      if (value === undefined || value === null) {
        continue;
      }

      if (Array.isArray(value)) {
        continue;
      }

      const stringValue: string = String(value).trim();

      if (stringValue) {
        return stringValue;
      }
    }

    return "";
  }

  private static getNumber(
    attributes: SpanAttributes,
    candidateKeys: Array<string>,
  ): number {
    for (const key of candidateKeys) {
      const value: AttributeType | Array<AttributeType> | undefined =
        attributes[key];

      if (value === undefined || value === null || Array.isArray(value)) {
        continue;
      }

      if (typeof value === "number" && isFinite(value)) {
        return value;
      }

      if (typeof value === "string" && value.trim() !== "") {
        const parsed: number = Number(value);

        if (isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return 0;
  }
}
