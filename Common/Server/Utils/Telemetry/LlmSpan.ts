import Dictionary from "../../../Types/Dictionary";
import {
  LlmCostCatalogUtil,
  LlmModelPrice,
} from "../../../Types/Telemetry/LlmCostCatalog";
import {
  LlmAgentNameAttributeKeys,
  LlmAttributeNamespacePrefixes,
  LlmConversationIdAttributeKeys,
  LlmCostAttributeKeys,
  LlmInputTokenAttributeKeys,
  LlmOperationAttributeKeys,
  LlmOutputTokenAttributeKeys,
  LlmRequestModelAttributeKeys,
  LlmResponseModelAttributeKeys,
  LlmSystemAttributeKeys,
  LlmToolNameAttributeKeys,
  LlmTotalTokenAttributeKeys,
} from "../../../Types/Telemetry/LlmConventions";
import { AttributeType } from "./Telemetry";

/*
 * First-class detection of LLM / GenAI / AI-agent spans.
 *
 * OneUptime ingests OpenTelemetry spans generically. To make LLM and agent
 * telemetry a first-class signal (filterable lists, token/cost/latency
 * rollups) we denormalize a small set of values out of the span attributes at
 * ingest time. The set of recognized attribute keys lives in the shared
 * Common/Types/Telemetry/LlmConventions module so this server-side extractor
 * and the client-side display parser cannot drift out of sync.
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
  /*
   * Cost in USD. The SDK-reported cost (gen_ai.usage.cost) when present;
   * otherwise an estimate computed from token counts against the project's
   * custom price overrides and the built-in list-price catalog
   * (Common/Types/Telemetry/LlmCostCatalog.ts). 0 when none is available.
   */
  llmCost: number;
  // Agent / tool names for agent-framework spans.
  llmAgentName: string;
  llmToolName: string;
  // Conversation / session id grouping calls of one interaction (gen_ai.conversation.id).
  llmConversationId: string;
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
      llmConversationId: "",
    };
  }

  /**
   * Extract first-class LLM fields from a flattened span attribute dictionary.
   * Pure + side-effect free so it can be unit tested in isolation.
   *
   * `projectPriceOverrides` are the project's custom model prices (loaded by
   * the ingest pipeline); they take part in the cost fallback below with
   * longest-prefix-wins semantics against the built-in catalog.
   */
  public static extract(
    attributes: SpanAttributes,
    projectPriceOverrides?: Array<LlmModelPrice>,
  ): LlmSpanFields {
    const fields: LlmSpanFields = this.empty();

    if (!attributes || typeof attributes !== "object") {
      return fields;
    }

    const keys: Array<string> = Object.keys(attributes);

    if (keys.length === 0) {
      return fields;
    }

    fields.llmSystem = this.getString(attributes, LlmSystemAttributeKeys);

    fields.llmOperation = this.getString(attributes, LlmOperationAttributeKeys);

    fields.llmRequestModel = this.getString(
      attributes,
      LlmRequestModelAttributeKeys,
    );

    fields.llmResponseModel = this.getString(
      attributes,
      LlmResponseModelAttributeKeys,
    );

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
      this.getNumber(attributes, LlmInputTokenAttributeKeys),
    );

    fields.llmOutputTokens = Math.trunc(
      this.getNumber(attributes, LlmOutputTokenAttributeKeys),
    );

    fields.llmTotalTokens = Math.trunc(
      this.getNumber(attributes, LlmTotalTokenAttributeKeys),
    );

    // Derive total when only the parts were reported.
    if (
      fields.llmTotalTokens === 0 &&
      (fields.llmInputTokens > 0 || fields.llmOutputTokens > 0)
    ) {
      fields.llmTotalTokens = fields.llmInputTokens + fields.llmOutputTokens;
    }

    /*
     * Cost must distinguish "reported as 0" from "not reported at all": a
     * gateway fronting a free local model (or a fully-cached call) reports an
     * explicit cost of 0, and that 0 must win over any catalog estimate.
     */
    const reportedCost: number | null = this.getNumberOrNull(
      attributes,
      LlmCostAttributeKeys,
    );

    fields.llmCost = reportedCost ?? 0;

    fields.llmAgentName = this.getString(attributes, LlmAgentNameAttributeKeys);

    fields.llmToolName = this.getString(attributes, LlmToolNameAttributeKeys);

    fields.isLlmSpan = this.detectIsLlmSpan(keys, fields);

    /*
     * Conversation id is gated on isLlmSpan because one of its candidate keys
     * ("session.id") is the generic OTel key RUM browser spans carry — those
     * already denormalize it into the sessionId column, and stamping it here
     * too would duplicate it (and its bloom-filter index) across the
     * highest-volume span class for no reader.
     */
    if (fields.isLlmSpan) {
      fields.llmConversationId = this.getString(
        attributes,
        LlmConversationIdAttributeKeys,
      );
    }

    /*
     * Cost fallback: the SDK-reported cost always wins — including an
     * explicit 0 — but most instrumentations only report token counts. Price
     * those against the project's custom price overrides and the built-in
     * list-price catalog (longest prefix wins across both, project entries
     * beat built-ins on ties) so spend shows up in dashboards and cost
     * budgets without per-SDK pricing math. The response model is priced in
     * preference to the request model — it names what the provider actually
     * served (e.g. an alias like "gpt-4o" resolved to a dated snapshot).
     */
    if (fields.isLlmSpan && reportedCost === null) {
      const computedCost: number | null = LlmCostCatalogUtil.computeCostInUSD({
        model: fields.llmResponseModel || fields.llmRequestModel,
        inputTokens: fields.llmInputTokens,
        outputTokens: fields.llmOutputTokens,
        projectPriceOverrides: projectPriceOverrides,
      });

      if (computedCost !== null) {
        fields.llmCost = computedCost;
      }
    }

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
      return LlmAttributeNamespacePrefixes.some((prefix: string) => {
        return key.startsWith(prefix);
      });
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
    return this.getNumberOrNull(attributes, candidateKeys) ?? 0;
  }

  /**
   * Like getNumber but null when no candidate key carries a parseable number
   * — callers that must distinguish "reported as 0" from "absent" (cost) use
   * this directly.
   */
  private static getNumberOrNull(
    attributes: SpanAttributes,
    candidateKeys: Array<string>,
  ): number | null {
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

    return null;
  }
}
