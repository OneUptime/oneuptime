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
  LlmTeamAttributeKeys,
  LlmToolNameAttributeKeys,
  LlmTotalTokenAttributeKeys,
  LlmUserEmailAttributeKeys,
  LlmUserIdAttributeKeys,
} from "../../../Types/Telemetry/LlmConventions";
import { AttributeType } from "./Telemetry";
import {
  LlmCallKind,
  LlmCallKindUtil,
} from "../../../Types/Telemetry/LlmCallKind";
import {
  LlmAnswerIssue,
  LlmAnswerIssueUtil,
} from "../../../Types/Telemetry/LlmAnswerIssue";
import LlmMessageParser, {
  LlmAnswerReading,
  LlmMessage,
  LlmMessagePartType,
} from "../../../Utils/Telemetry/LlmMessageParser";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";

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
 * rendered by the LLM span panel in the dashboard. Two things are read off
 * it all the same:
 *
 *   - the ANSWER, to decide what went wrong with it (llmIssues - see
 *     LlmAnswerIssue). Only labels are stored, never the text, and only the
 *     answer is parsed (LlmMessageParser.readAnswer), so a long prompt
 *     history costs this path nothing;
 *   - the newest message the person sent, cut to a short preview
 *     (getUserMessagePreview) - read by the ingest pipeline AFTER the
 *     project's scrub rules and pipelines ran, so the preview carries their
 *     redactions, and conversations can be listed under and searched by
 *     what was asked.
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
  /*
   * WHO ran the call — the EMPLOYEE / internal actor, never the caller's own
   * downstream customer. See the block comment above
   * LlmUserIdAttributeKeys in Common/Types/Telemetry/LlmConventions.ts for
   * why that distinction is load-bearing rather than pedantic.
   *
   * "" when the instrumentation reports no identity, which is still the
   * common case for library-instrumented server code — only the coding-agent
   * CLIs and the gateways stamp identity by default.
   */
  llmUserId: string;
  llmUserEmail: string;
  // Team / cost centre the spend charges to (team.id, cost_center, ...).
  llmTeam: string;
  /*
   * What the call did (answer, agent, tool, embedding, retrieval, other) -
   * see LlmCallKind. "" for a span that is not an LLM span.
   */
  llmCallKind: string;
  // What went wrong with the answer - see LlmAnswerIssue. [] when nothing.
  llmIssues: Array<string>;
  /*
   * Whether the call failed by its own account (error.type, a finish reason
   * of "error") whatever its status says. Not a column: it lets ingest
   * re-decide "failed" when a pipeline remaps the span's status
   * (withFinalStatus).
   */
  llmFailedWithoutStatus: boolean;
}

/*
 * What ingest knows about a span besides its attributes, for the answer
 * checks: its status (a failed call), its events (choice events, evaluation
 * results) and the output token count as REPORTED (null when absent - an
 * absent count is not a zero).
 */
export interface LlmSpanContext {
  statusCode?: number | undefined;
  events?: Array<unknown> | undefined;
}

// Longest user-message preview stored on a span.
export const LLM_USER_MESSAGE_PREVIEW_LENGTH: number = 300;

type SpanAttributes = Dictionary<AttributeType | Array<AttributeType>>;

/*
 * The preview reads the prompt history, which can be long; a history above
 * this many characters of JSON is skipped rather than parsed on the ingest
 * path (the conversation view still reads it on demand).
 */
const LLM_USER_MESSAGE_PREVIEW_JSON_LIMIT: number = 512 * 1024;

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
      llmUserId: "",
      llmUserEmail: "",
      llmTeam: "",
      llmCallKind: "",
      llmIssues: [],
      llmFailedWithoutStatus: false,
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
    context?: LlmSpanContext,
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

      /*
       * Identity is gated on isLlmSpan for exactly the reason the
       * conversation id above is. "user.id", "user.email" and "team.id" are
       * GENERIC OTel general-semconv keys — RUM browser spans and ordinary
       * backend HTTP spans routinely carry them, and those are the
       * highest-volume span classes there are. Stamping them onto every such
       * span would copy the value (and pay for its skip index) across the
       * whole fleet to serve a reader that only ever asks "which employee
       * spent what on LLM calls". The LLM spans are the only rows that
       * question reads, so they are the only rows that carry the columns.
       *
       * The keys that carry the caller's DOWNSTREAM CUSTOMER rather than the
       * employee (gen_ai.user, llm.user,
       * litellm.metadata.user_api_key_end_user_id) are deliberately absent
       * from these lists — see LlmEndUserAttributeKeys. Reading one of them
       * here would silently misattribute internal chargeback.
       */
      fields.llmUserId = this.getString(attributes, LlmUserIdAttributeKeys);

      fields.llmUserEmail = this.getString(
        attributes,
        LlmUserEmailAttributeKeys,
      );

      fields.llmTeam = this.getString(attributes, LlmTeamAttributeKeys);
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

    if (fields.isLlmSpan) {
      const kind: LlmCallKind = LlmCallKindUtil.getKind({
        operation: fields.llmOperation,
        model: fields.llmRequestModel || fields.llmResponseModel,
        toolName: fields.llmToolName,
        agentName: fields.llmAgentName,
      });

      fields.llmCallKind = kind;
      fields.llmIssues = this.getIssues({
        attributes: attributes,
        kind: kind,
        context: context,
      });

      /*
       * The same checks with the status left out say whether the call
       * failed on its own account - what withFinalStatus keeps when a
       * pipeline remaps the status.
       */
      fields.llmFailedWithoutStatus =
        context?.statusCode === SpanStatus.Error
          ? this.getIssues({
              attributes: attributes,
              kind: kind,
              context: { ...context, statusCode: SpanStatus.Unset },
            }).includes(LlmAnswerIssue.Failed)
          : fields.llmIssues.includes(LlmAnswerIssue.Failed);
    }

    return fields;
  }

  /*
   * The answer issues of a call stored with `statusCode`: "failed" when that
   * status is Error or the call failed on its own account, never otherwise.
   * A project's StatusRemapper pipeline runs after extract(), so a span it
   * turns from Error to Ok stops counting as a failed call, and one it turns
   * to Error starts to - the same as its exception rows.
   */
  public static withFinalStatus(data: {
    issues: Array<string>;
    failedWithoutStatus: boolean;
    statusCode: number | undefined;
  }): Array<string> {
    const failed: boolean =
      data.statusCode === SpanStatus.Error || data.failedWithoutStatus;
    const others: Array<string> = data.issues.filter(
      (issue: string): boolean => {
        return issue !== LlmAnswerIssue.Failed;
      },
    );

    return LlmAnswerIssueUtil.fromValues(
      failed ? [LlmAnswerIssue.Failed, ...others] : others,
    );
  }

  /*
   * What went wrong with the call's answer. Never throws: a span whose
   * content this cannot read is judged on its status and finish reasons
   * alone, and an unreadable span is not worth failing a batch over.
   */
  public static getIssues(data: {
    attributes: SpanAttributes;
    kind: LlmCallKind;
    context?: LlmSpanContext | undefined;
  }): Array<LlmAnswerIssue> {
    let answer: LlmAnswerReading;

    try {
      answer = LlmMessageParser.readAnswer({
        attributes: data.attributes,
        events: data.context?.events,
      });
    } catch {
      answer = {
        output: [],
        finishReasons: [],
        evaluations: [],
        errorType: "",
        summary: {
          recorded: false,
          hasText: false,
          hasToolCall: false,
          hasMedia: false,
          hasRefusal: false,
          leadingText: "",
        },
      };
    }

    return LlmAnswerIssueUtil.getIssues({
      kind: data.kind,
      statusIsError: data.context?.statusCode === SpanStatus.Error,
      errorType: answer.errorType,
      finishReasons: answer.finishReasons,
      outputTokens: this.getNumberOrNull(
        data.attributes,
        LlmOutputTokenAttributeKeys,
      ),
      answer: answer.summary,
      evaluations: answer.evaluations,
    });
  }

  /*
   * The newest message the person sent in this call, cut to
   * LLM_USER_MESSAGE_PREVIEW_LENGTH: what the conversation list shows as a
   * conversation's title and searches. Call it on the attributes the span is
   * STORED with (after scrub rules and pipelines), so a redaction in the
   * prompt is a redaction in the preview. "" when the prompt was not
   * recorded or holds no text from the person.
   */
  public static getUserMessagePreview(data: {
    attributes: unknown;
    events?: unknown;
  }): string {
    try {
      const input: Array<LlmMessage> = LlmMessageParser.readCallContent({
        attributes: data.attributes,
        events: data.events,
        options: { maxJsonLength: LLM_USER_MESSAGE_PREVIEW_JSON_LIMIT },
      }).input;

      for (let index: number = input.length - 1; index >= 0; index--) {
        const message: LlmMessage = input[index] as LlmMessage;

        if (message.role !== "user") {
          continue;
        }

        const text: string = message.parts
          .filter((part: { type: LlmMessagePartType; text: string }) => {
            return part.type === LlmMessagePartType.Text;
          })
          .map((part: { text: string }) => {
            return part.text;
          })
          .join(" ");

        const preview: string = this.toPreview(text);

        if (preview) {
          return preview;
        }
      }
    } catch {
      // An unreadable prompt has no preview.
    }

    return "";
  }

  // Whitespace collapsed, cut on a character boundary.
  public static toPreview(text: string): string {
    let preview: string = "";
    let lastWasSpace: boolean = true;

    for (const character of text) {
      if (preview.length >= LLM_USER_MESSAGE_PREVIEW_LENGTH) {
        break;
      }

      const isSpace: boolean =
        character === " " ||
        character === "\n" ||
        character === "\t" ||
        character === "\r";

      if (isSpace) {
        if (!lastWasSpace) {
          preview += " ";
        }
        lastWasSpace = true;
        continue;
      }

      preview += character;
      lastWasSpace = false;
    }

    return preview.trim();
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
