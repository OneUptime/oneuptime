import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Headers from "../../../Types/API/Headers";
import URL from "../../../Types/API/URL";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import API, { RequestOptions } from "../../../Utils/API";
import LlmType from "../../../Types/LLM/LlmType";
import APIException from "../../../Types/Exception/ApiException";
import BadDataException from "../../../Types/Exception/BadDataException";
import EgressGuardException, {
  EgressFailureReason,
} from "../../../Types/Exception/EgressGuardException";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DataSourceEgressGuard, { PinnedAgents } from "../DataSource/EgressGuard";

export interface LLMToolDefinition {
  name: string;
  description: string;
  // JSON Schema for the tool's arguments.
  inputSchema: JSONObject;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: JSONObject;
  /*
   * Set when the provider returned malformed argument JSON that could not be
   * parsed. Callers must NOT execute the tool with the empty arguments —
   * surface the error to the model so it can retry.
   */
  argumentsParseError?: string | undefined;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  // Set on assistant messages that requested tool calls.
  toolCalls?: Array<LLMToolCall> | undefined;
  // Set on tool messages: which tool call this result answers.
  toolCallId?: string | undefined;
}

export interface LLMCompletionRequest {
  messages: Array<LLMMessage>;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  additionalParams?: JSONObject | undefined;
  tools?: Array<LLMToolDefinition> | undefined;
  /** Per-attempt HTTP timeout. Callers may lower the provider default. */
  requestTimeoutInMs?: number | undefined;
  /** Number of retries after the initial request. */
  requestRetries?: number | undefined;
  /**
   * Wall-clock budget for the whole retry ladder. Defaults to
   * getRetryDeadlineInMs — raise it for a caller that can afford to wait
   * longer than an interactive chat turn.
   */
  requestRetryDeadlineInMs?: number | undefined;
  /** Re-apply caller-owned request fields after provider-level overrides. */
  protectRequestParameters?: boolean | undefined;
  /**
   * When false, provider HTTP error bodies are neither logged nor included in
   * the exception captured by telemetry. Use this for requests whose provider
   * may echo private prompt content in an error response.
   */
  includeProviderErrorDetails?: boolean | undefined;
  llmProviderConfig: LLMProviderConfig;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /*
   * Prompt-caching breakdown, when the provider reports it. cachedInputTokens
   * are input tokens served from cache (billed at a large discount);
   * cacheCreationTokens are input tokens written to the cache on this call.
   */
  cachedInputTokens?: number | undefined;
  cacheCreationTokens?: number | undefined;
}

export interface LLMCompletionResponse {
  content: string;
  toolCalls?: Array<LLMToolCall> | undefined;
  /*
   * "length" means the provider cut generation off at the output-token cap —
   * the content is incomplete and must not be presented as a finished answer.
   * Every wire branch maps its provider-specific truncation signal here
   * (OpenAI-style finish_reason "length", Anthropic stop_reason "max_tokens",
   * Ollama done_reason "length").
   */
  stopReason?: "stop" | "tool_use" | "length" | undefined;
  usage: LLMUsage | undefined;
}

export interface LLMProviderConfig {
  llmType: LlmType;
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
  /*
   * A global provider no project owns (LlmProviderService.
   * isUnownedGlobalProvider): its Base URL was set by the operator or a master
   * admin, never by a project member. Such a provider may reach private
   * addresses even where the deployment refuses them to project-owned
   * providers — see buildGuardedRequestOptions. Set it from the stored
   * provider row only, never from anything a request carries.
   */
  isGlobalProvider?: boolean | undefined;
}

/**
 * Which spelling of the output-token cap an OpenAI-style endpoint accepts.
 *
 *  - Default: send the legacy `max_tokens` unless additionalParams opted into
 *    `max_completion_tokens`. This is the historical behavior.
 *  - MaxCompletionTokens: the model rejects `max_tokens` (reasoning models).
 *  - MaxTokens: the model rejects `max_completion_tokens` (older models and
 *    Azure API versions before 2024-08-01-preview).
 */
enum TokenLimitParam {
  Default = "Default",
  MaxCompletionTokens = "MaxCompletionTokens",
  MaxTokens = "MaxTokens",
}

/**
 * Per-endpoint compatibility adjustments for the OpenAI chat-completions wire
 * format. Model families disagree about which generation parameters they
 * accept, so a request may need reshaping before a given deployment takes it.
 */
interface OpenAIRequestAdaptation {
  tokenLimitParam: TokenLimitParam;
  /** Generation params this model rejects outright, so we omit them. */
  unsupportedParams: Set<string>;
}

/*
 * Structural fields of an Ollama /api/chat request. additionalParams is
 * operator-supplied tuning, so it must never be able to replace the
 * conversation, silence the tool belt, or flip the request to streaming —
 * the same fail-closed posture PROTECTED_ADDITIONAL_PARAMETER_ALLOWLIST
 * applies on the OpenAI wire.
 */
const OLLAMA_RESERVED_REQUEST_KEYS: Set<string> = new Set([
  "model",
  "messages",
  "tools",
  "stream",
]);

/*
 * Why the egress guard refused a provider URL, in words that do not name the
 * host. Unreachable stays a single sentence: the guard uses it for both a
 * failed lookup and a refused address, so they cannot be told apart.
 */
const EGRESS_REFUSAL_DESCRIPTIONS: Record<EgressFailureReason, string> = {
  [EgressFailureReason.InvalidTarget]:
    "the LLM provider base URL is not a valid http or https URL",
  [EgressFailureReason.AddressBlocked]:
    "the LLM provider base URL points to an address OneUptime is not allowed to connect to",
  [EgressFailureReason.ResolutionFailed]:
    "the LLM provider's host name could not be resolved",
  [EgressFailureReason.Unreachable]: "the LLM provider could not be reached",
};

/*
 * What Ollama says when a chat does not fit in the model's context window.
 *
 * Ollama fits a chat into the window (`num_ctx`) by dropping its oldest
 * messages, with the system prompt put back in front, until the rest fits.
 * The question is among the first to go, and a model whose chat template
 * requires one (Qwen 3.8 and later) rejects what is left with "no user query
 * found in messages", which reads as though OneUptime sent no question at
 * all. When not even the newest message fits, Ollama says so itself.
 */
const NO_USER_QUERY_ERROR_PATTERN: RegExp = /no user query found in messages/i;
const PROMPT_LONGER_THAN_CONTEXT_ERROR_PATTERN: RegExp =
  /prompt is longer than the context length/i;

export default class LLMService {
  /*
   * How many times a provider call is attempted before it is reported as a
   * failure. The provider hop is the flakiest one in the product — hosted
   * endpoints rate limit, self-hosted ones fall behind their own queue, and a
   * cold model can miss the per-attempt timeout while the next attempt sails
   * through — and every one of those used to surface as a dead chat turn
   * after three tries.
   *
   * This is a count of ATTEMPTS; API takes a count of retries, which is one
   * fewer.
   */
  public static readonly DEFAULT_REQUEST_ATTEMPTS: number = 10;

  /*
   * Ten doublings would put the last wait seventeen minutes out. Capped at
   * eight seconds the whole ladder (2, 4, 8, 8, ...) costs about a minute of
   * sleep before jitter, which is the point: ride out a provider blip without
   * turning one chat turn into a coffee break.
   */
  public static readonly MAX_BACKOFF_IN_MS: number = 8 * 1000;

  /*
   * Ten attempts is the right answer for failures that fail FAST — a 429, a
   * refused connection, a 502 from a load balancer. Ten TIMEOUTS are a
   * different story: at the 120s default that is twenty minutes, against a
   * ChatAgentRunner budget of five for an entire turn, so the ladder gets a
   * wall clock of its own.
   */
  private static readonly DEFAULT_RETRY_DEADLINE_IN_MS: number = 5 * 60 * 1000;

  /*
   * The floor keeps the deadline from ever costing a provider attempts it had
   * before this budget existed: three full-timeout attempts is what the old
   * two-retry policy allowed, and a slow provider (Ollama at 300s) still gets
   * exactly that.
   */
  private static readonly MIN_FULL_TIMEOUT_ATTEMPTS_WITHIN_DEADLINE: number = 3;

  /*
   * Provider-level parameters allowed on protected, unattended completions.
   * This is deliberately a generation-only allowlist: capability fields such
   * as tools, web_search_options, data_sources, modalities, audio, or future
   * agent extensions must fail closed instead of silently widening egress or
   * output behavior.
   */
  private static readonly PROTECTED_ADDITIONAL_PARAMETER_ALLOWLIST: Set<string> =
    new Set([
      "frequency_penalty",
      "length_penalty",
      "logit_bias",
      "logprobs",
      "max_completion_tokens",
      "min_p",
      "min_tokens",
      "presence_penalty",
      "random_seed",
      "reasoning_effort",
      "repetition_penalty",
      "response_format",
      "safe_prompt",
      "seed",
      "stop",
      "top_k",
      "top_logprobs",
      "top_p",
      "verbosity",
    ]);

  /*
   * Generation params that reasoning models (o-series, gpt-5) reject outright.
   * When a provider names one of these in an error, we drop it and retry
   * rather than failing the whole completion. Only params that merely tune
   * sampling are droppable — never anything that changes what the model is
   * asked to do.
   */
  private static readonly DROPPABLE_UNSUPPORTED_PARAMETERS: Set<string> =
    new Set([
      "frequency_penalty",
      "logit_bias",
      "logprobs",
      "presence_penalty",
      "temperature",
      "top_logprobs",
      "top_p",
    ]);

  /*
   * Reasoning models require `max_completion_tokens` and reject the legacy
   * `max_tokens`. Detecting them by name lets the first request succeed
   * instead of burning a round trip on a rejected one.
   *
   * On Azure this is only a hint: the `model` field there is the *deployment*
   * name, which the operator chooses freely ("dumbo_o3", "prod-fast"), so it
   * may not resemble the underlying model at all. A wrong guess in either
   * direction is corrected by the error-driven retry in
   * postOpenAIChatCompletion, which is what actually makes this correct.
   */
  private static readonly REASONING_MODEL_NAME_REGEX: RegExp =
    /^(?:o\d+(?:[-_.]|$)|gpt-?5|codex-mini)/i;

  /*
   * Backstop only. A provider names one offending parameter per response, so
   * the worst legitimate chain is both token spellings plus one drop for each
   * droppable param. The loop already terminates on its own — every rule
   * refuses to re-suggest a fix it has applied — so this just stops a
   * misbehaving endpoint from looping forever. Sizing it below the reachable
   * chain would fail requests the next attempt would have fixed.
   */
  private static readonly MAX_REQUEST_ADAPTATION_ATTEMPTS: number =
    2 + LLMService.DROPPABLE_UNSUPPORTED_PARAMETERS.size;

  /*
   * Remembers what a given endpoint actually accepted, so only the first
   * completion per provider pays for the discovery. A rejected request still
   * costs a full prompt upload and round trip per adaptation — re-learning
   * that on every call would be expensive on hot paths like the AI agent
   * loop.
   *
   * Keyed by provider + base URL + model, so editing any of them re-probes.
   * Entries also expire: what a deployment accepts is not fixed forever — the
   * operator can repoint a deployment at a different model, upgrade the Azure
   * api-version, or change reasoning_effort (gpt-5.1 accepts temperature when
   * it is "none"). Without expiry we would keep dropping a parameter the model
   * has since started accepting.
   */
  private static readonly requestAdaptationCache: Map<
    string,
    { adaptation: OpenAIRequestAdaptation; learnedAt: number }
  > = new Map();

  private static readonly MAX_ADAPTATION_CACHE_ENTRIES: number = 500;

  private static readonly ADAPTATION_CACHE_TTL_IN_MS: number = 60 * 60 * 1000;

  private static getAdaptationCacheKey(
    config: LLMProviderConfig,
    modelName: string,
  ): string {
    return `${config.llmType}|${config.baseUrl || ""}|${modelName}`;
  }

  private static getInitialRequestAdaptation(
    config: LLMProviderConfig,
    modelName: string,
  ): OpenAIRequestAdaptation {
    const key: string = this.getAdaptationCacheKey(config, modelName);
    const cached:
      | { adaptation: OpenAIRequestAdaptation; learnedAt: number }
      | undefined = this.requestAdaptationCache.get(key);

    if (cached) {
      if (Date.now() - cached.learnedAt < this.ADAPTATION_CACHE_TTL_IN_MS) {
        return {
          tokenLimitParam: cached.adaptation.tokenLimitParam,
          unsupportedParams: new Set(cached.adaptation.unsupportedParams),
        };
      }

      this.requestAdaptationCache.delete(key);
    }

    return {
      tokenLimitParam: this.REASONING_MODEL_NAME_REGEX.test(modelName)
        ? TokenLimitParam.MaxCompletionTokens
        : TokenLimitParam.Default,
      unsupportedParams: new Set(),
    };
  }

  private static cacheRequestAdaptation(
    config: LLMProviderConfig,
    modelName: string,
    adaptation: OpenAIRequestAdaptation,
  ): void {
    const key: string = this.getAdaptationCacheKey(config, modelName);

    // Bound the cache; Map iterates in insertion order, so this drops the oldest.
    if (
      !this.requestAdaptationCache.has(key) &&
      this.requestAdaptationCache.size >= this.MAX_ADAPTATION_CACHE_ENTRIES
    ) {
      const oldestKey: string | undefined = this.requestAdaptationCache
        .keys()
        .next().value;

      if (oldestKey !== undefined) {
        this.requestAdaptationCache.delete(oldestKey);
      }
    }

    this.requestAdaptationCache.set(key, {
      adaptation: {
        tokenLimitParam: adaptation.tokenLimitParam,
        unsupportedParams: new Set(adaptation.unsupportedParams),
      },
      learnedAt: Date.now(),
    });
  }

  /**
   * Test seam: provider compatibility is remembered process-wide, so tests
   * must be able to start from a clean slate.
   */
  public static clearRequestAdaptationCache(): void {
    this.requestAdaptationCache.clear();
  }

  @CaptureSpan()
  public static async getCompletion(
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    const config: LLMProviderConfig = request.llmProviderConfig;

    switch (config.llmType) {
      case LlmType.OpenAI:
      case LlmType.Groq:
      case LlmType.Mistral:
      case LlmType.OpenAICompatible:
        return await this.getOpenAICompatibleCompletion(config, request);
      case LlmType.AzureOpenAI:
        return await this.getAzureOpenAICompletion(config, request);
      case LlmType.Anthropic:
        return await this.getAnthropicCompletion(config, request);
      case LlmType.Ollama:
        return await this.getOllamaCompletion(config, request);
      default:
        throw new BadDataException(`Unsupported LLM type: ${config.llmType}`);
    }
  }

  /*
   * OpenAI-compatible wire format (OpenAI, Groq, Mistral, Azure OpenAI).
   */

  private static toOpenAIMessages(
    messages: Array<LLMMessage>,
  ): Array<JSONObject> {
    return messages.map((msg: LLMMessage) => {
      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length) {
        return {
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((toolCall: LLMToolCall) => {
            return {
              id: toolCall.id,
              type: "function",
              function: {
                name: toolCall.name,
                arguments: JSON.stringify(toolCall.arguments),
              },
            };
          }),
        };
      }

      if (msg.role === "tool") {
        return {
          role: "tool",
          tool_call_id: msg.toolCallId || "",
          content: msg.content,
        };
      }

      return {
        role: msg.role,
        content: msg.content,
      };
    });
  }

  private static toOpenAITools(
    tools: Array<LLMToolDefinition>,
  ): Array<JSONObject> {
    return tools.map((tool: LLMToolDefinition) => {
      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      };
    });
  }

  private static getProtectedAdditionalParameters(
    additionalParams: JSONObject,
  ): JSONObject {
    const protectedParams: JSONObject = {};

    for (const key of Object.keys(additionalParams)) {
      if (this.PROTECTED_ADDITIONAL_PARAMETER_ALLOWLIST.has(key)) {
        protectedParams[key] = additionalParams[key]!;
      }
    }

    return protectedParams;
  }

  private static parseOpenAIToolCalls(
    message: JSONObject,
  ): Array<LLMToolCall> | undefined {
    const rawToolCalls: JSONArray | undefined = message["tool_calls"] as
      | JSONArray
      | undefined;

    if (!rawToolCalls || rawToolCalls.length === 0) {
      return undefined;
    }

    return rawToolCalls.map((rawToolCall: JSONObject, index: number) => {
      const fn: JSONObject = (rawToolCall["function"] as JSONObject) || {};
      const parsed: { arguments: JSONObject; error?: string | undefined } =
        this.parseToolCallArguments((fn["arguments"] as string) || "{}");

      return {
        id: (rawToolCall["id"] as string) || `tool_call_${index}`,
        name: (fn["name"] as string) || "",
        arguments: parsed.arguments,
        argumentsParseError: parsed.error,
      };
    });
  }

  /*
   * Models sometimes emit slightly malformed argument JSON (trailing commas,
   * single quotes). Try strict JSON first, then tolerant JSON5, and report a
   * parse error instead of silently executing with empty arguments.
   */
  private static parseToolCallArguments(rawArguments: string): {
    arguments: JSONObject;
    error?: string | undefined;
  } {
    try {
      return { arguments: JSON.parse(rawArguments) };
    } catch {
      // fall through to tolerant parsing
    }

    try {
      const parsed: JSONObject | unknown = JSONFunctions.parse(rawArguments);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { arguments: parsed as JSONObject };
      }
      return {
        arguments: {},
        error: "Tool arguments were not a JSON object.",
      };
    } catch {
      return {
        arguments: {},
        error: "Tool arguments were malformed JSON and could not be parsed.",
      };
    }
  }

  private static buildOpenAIRequestBody(
    modelName: string,
    request: LLMCompletionRequest,
    adaptation: OpenAIRequestAdaptation,
  ): JSONObject {
    const data: JSONObject = {
      model: modelName,
      messages: this.toOpenAIMessages(request.messages),
      temperature: request.temperature ?? 0.7,
    };

    if (request.maxTokens) {
      data["max_tokens"] = request.maxTokens;
    }

    if (request.tools && request.tools.length > 0) {
      data["tools"] = this.toOpenAITools(request.tools);
    }

    /*
     * Provider-configured tuning overrides defaults unless the caller protects
     * its request. Protected callers retain only generation-safe tuning fields
     * so provider-native tools and future capability fields fail closed.
     */
    if (request.additionalParams) {
      Object.assign(
        data,
        request.protectRequestParameters
          ? this.getProtectedAdditionalParameters(request.additionalParams)
          : request.additionalParams,
      );
    }

    if (request.protectRequestParameters) {
      const usesMaxCompletionTokens: boolean =
        data["max_completion_tokens"] !== undefined;

      data["model"] = modelName;
      data["messages"] = this.toOpenAIMessages(request.messages);
      data["temperature"] = request.temperature ?? 0.7;
      data["stream"] = false;
      data["n"] = 1;

      if (request.maxTokens) {
        if (usesMaxCompletionTokens) {
          data["max_completion_tokens"] = request.maxTokens;
          delete data["max_tokens"];
        } else {
          data["max_tokens"] = request.maxTokens;
          delete data["max_completion_tokens"];
        }
      }

      if (request.tools && request.tools.length > 0) {
        data["tools"] = this.toOpenAITools(request.tools);
      } else {
        delete data["tools"];
        delete data["tool_choice"];
        delete data["functions"];
        delete data["function_call"];
        delete data["parallel_tool_calls"];
      }

      // Legacy compatible APIs may accept this fan-out control separately.
      delete data["best_of"];
    }

    /*
     * OpenAI's newer model families (gpt-5, o1, o3, ...) reject the legacy
     * `max_tokens` parameter and require `max_completion_tokens` instead; the
     * two are mutually exclusive. When a provider opts into
     * `max_completion_tokens` via additionalParams, drop the default
     * `max_tokens` so the request is accepted. Legacy OpenAI-compatible
     * backends (Ollama, vLLM, LocalAI, ...) keep receiving `max_tokens`.
     */
    if (
      data["max_completion_tokens"] !== undefined &&
      data["max_tokens"] !== undefined
    ) {
      delete data["max_tokens"];
    }

    /*
     * Applied last so it overrides every other source: this is what the
     * endpoint has actually told us (or the model name strongly implies) it
     * will accept, and a request it rejects is worth nothing.
     */
    this.applyRequestAdaptation(data, adaptation);

    return data;
  }

  private static applyRequestAdaptation(
    data: JSONObject,
    adaptation: OpenAIRequestAdaptation,
  ): void {
    if (adaptation.tokenLimitParam === TokenLimitParam.MaxCompletionTokens) {
      const tokenLimit: unknown =
        data["max_tokens"] ?? data["max_completion_tokens"];

      delete data["max_tokens"];

      if (tokenLimit !== undefined) {
        data["max_completion_tokens"] = tokenLimit as number;
      }
    } else if (adaptation.tokenLimitParam === TokenLimitParam.MaxTokens) {
      const tokenLimit: unknown =
        data["max_completion_tokens"] ?? data["max_tokens"];

      delete data["max_completion_tokens"];

      if (tokenLimit !== undefined) {
        data["max_tokens"] = tokenLimit as number;
      }
    }

    for (const unsupportedParam of adaptation.unsupportedParams) {
      delete data[unsupportedParam];
    }
  }

  /**
   * Work out how to reshape a request that the provider rejected on
   * parameter-compatibility grounds. Returns undefined when the error is
   * something else (bad key, unknown model, rate limit) or when we have
   * already applied the only remedy we have — the caller then surfaces the
   * provider's error as-is.
   */
  private static getRequestAdaptationForError(
    response: HTTPErrorResponse,
    adaptation: OpenAIRequestAdaptation,
    attemptedTokenLimitParams: Set<TokenLimitParam>,
  ): OpenAIRequestAdaptation | undefined {
    const error: JSONObject | undefined = (response.data as JSONObject)?.[
      "error"
    ] as JSONObject | undefined;

    if (!error) {
      return undefined;
    }

    const param: string = (error["param"] as string) || "";
    const code: string = (error["code"] as string) || "";
    const message: string = (error["message"] as string) || "";

    /*
     * "Unsupported parameter: 'max_tokens' is not supported with this model.
     * Use 'max_completion_tokens' instead." — every o-series and gpt-5 model.
     *
     * The code/message check matters: a too-large or wrong-type value is also
     * reported with param "max_tokens", and renaming the parameter would not
     * fix it. It would only replace the provider's real complaint with a
     * confusing one about a parameter the caller never set.
     */
    if (
      param === "max_tokens" &&
      (code === "unsupported_parameter" ||
        message.includes("max_completion_tokens")) &&
      !attemptedTokenLimitParams.has(TokenLimitParam.MaxCompletionTokens)
    ) {
      return {
        ...adaptation,
        tokenLimitParam: TokenLimitParam.MaxCompletionTokens,
      };
    }

    /*
     * The reverse: older models and Azure API versions before
     * 2024-08-01-preview reject max_completion_tokens. This one reports param
     * and code as null, so the message is the only signal. Matching
     * "argument" rather than "argument supplied" also catches the plural the
     * endpoint uses when more than one parameter is unrecognized.
     *
     * Both spellings are tried at most once each. A deployment that rejects
     * both (a reasoning model behind an API version too old to know the new
     * parameter) has no working request, so we stop and let the provider's
     * own error explain it rather than flip-flopping until the attempt cap.
     */
    if (
      (message.includes("Unrecognized request argument") ||
        (param === "max_completion_tokens" &&
          code === "unsupported_parameter")) &&
      message.includes("max_completion_tokens") &&
      !attemptedTokenLimitParams.has(TokenLimitParam.MaxTokens)
    ) {
      return {
        ...adaptation,
        tokenLimitParam: TokenLimitParam.MaxTokens,
      };
    }

    /*
     * Reasoning models reject temperature, top_p and the penalty/logprob
     * params. Both codes appear in the wild for these:
     * unsupported_parameter ("is not supported with this model") and
     * unsupported_value ("does not support 0 with this model").
     */
    if (
      (code === "unsupported_parameter" || code === "unsupported_value") &&
      this.DROPPABLE_UNSUPPORTED_PARAMETERS.has(param) &&
      !adaptation.unsupportedParams.has(param)
    ) {
      return {
        ...adaptation,
        unsupportedParams: new Set(adaptation.unsupportedParams).add(param),
      };
    }

    return undefined;
  }

  /**
   * The retry policy every provider call runs under.
   *
   * Ten attempts, backed off and jittered, and deliberately spent only on
   * failures a repeat could fix: a provider that rejects the request itself —
   * bad key, unknown model, malformed body — answers the same way every time,
   * and burning the ladder on it only hides the error the operator has to see.
   */
  private static buildRequestPolicy(data: {
    request: LLMCompletionRequest;
    defaultTimeoutInMs: number;
  }): RequestOptions {
    const timeoutInMs: number =
      data.request.requestTimeoutInMs ?? data.defaultTimeoutInMs;

    return {
      retries: data.request.requestRetries ?? this.DEFAULT_REQUEST_ATTEMPTS - 1,
      exponentialBackoff: true,
      maxBackoffInMs: this.MAX_BACKOFF_IN_MS,
      retryOnlyOnRetryableErrors: true,
      totalTimeoutInMs: this.getRetryDeadlineInMs(data.request, timeoutInMs),
      timeout: timeoutInMs,
    };
  }

  private static getRetryDeadlineInMs(
    request: LLMCompletionRequest,
    timeoutInMs: number,
  ): number {
    if (request.requestRetryDeadlineInMs !== undefined) {
      return request.requestRetryDeadlineInMs;
    }

    return Math.max(
      this.DEFAULT_RETRY_DEADLINE_IN_MS,
      timeoutInMs * this.MIN_FULL_TIMEOUT_ATTEMPTS_WITHIN_DEADLINE,
    );
  }

  /*
   * Request options for a call to a tenant-configured LLM endpoint.
   *
   * LlmProvider.baseUrl is writable by any project member while reading the
   * apiKey is Owner/Admin-only, so an unguarded request lets a member repoint
   * a provider at a host they control and collect the decrypted key out of the
   * auth header — and, because provider error bodies are reflected back
   * through the LLM provider API, use the same lever as a blind-free read
   * primitive against the internal network.
   *
   * The address the guard checked is pinned into the socket, and redirects are
   * refused: pinning covers only the validated host, so a 3xx would walk
   * around it. Private ranges stay reachable on self-hosted installs, because
   * a self-hosted Ollama on 10.x is the documented deployment.
   *
   * A global provider no project owns reaches private ranges everywhere, even
   * where billing or DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES refuses them to
   * project-owned providers. That refusal stops a project member from aiming
   * the server at the internal network; a global provider's Base URL is set
   * by the operator or a master admin instead. It is what lets the Helm
   * chart's bundled vLLM, which sits at a ClusterIP, serve a billing-enabled
   * install. Everything else holds for it too: loopback, link-local and the
   * other always-refused ranges stay refused, the address is pinned, and
   * redirects are refused.
   */
  private static async buildGuardedRequestOptions(data: {
    providerName: string;
    requestUrl: string;
    isGlobalProvider: boolean | undefined;
    options: RequestOptions;
    logAttributes: LogAttributes;
  }): Promise<RequestOptions> {
    let pinnedAgents: PinnedAgents;

    try {
      pinnedAgents = await DataSourceEgressGuard.assertUrlAllowedAndPin(
        data.requestUrl,
        {
          targetLabel: "LLM provider",
          // Otherwise the deployment's policy decides.
          ...(data.isGlobalProvider === true
            ? { blockPrivateAddresses: false }
            : {}),
        },
      );
    } catch (error) {
      // The guard's refusal names the host it refused.
      throw this.toAddressFreeProviderError({
        providerName: data.providerName,
        error: error,
        logAttributes: data.logAttributes,
      });
    }

    return {
      ...data.options,
      doNotFollowRedirects: true,
      httpAgent: pinnedAgents.httpAgent,
      httpsAgent: pinnedAgents.httpsAgent,
    };
  }

  /*
   * POST to a provider. A request that gets no response at all is thrown by
   * API as "Request failed to <url>. <reason>", so it is rethrown without the
   * address; a provider that answers with an error status is returned as an
   * HTTPErrorResponse, as before.
   */
  private static async postToProvider(data: {
    providerName: string;
    requestUrl: string;
    body: JSONObject;
    headers: Headers;
    options: RequestOptions;
    logAttributes: LogAttributes;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    try {
      return await API.post<JSONObject>({
        url: URL.fromString(data.requestUrl),
        data: data.body,
        headers: data.headers,
        options: data.options,
      });
    } catch (error) {
      throw this.toAddressFreeProviderError({
        providerName: data.providerName,
        error: error,
        timeoutInMs: data.options.timeout,
        logAttributes: data.logAttributes,
      });
    }
  }

  /**
   * POST an OpenAI-style chat completion, reshaping and retrying when the
   * endpoint rejects a generation parameter it does not support.
   *
   * This is error-driven rather than model-driven on purpose. Azure sends the
   * deployment name in `model`, and operators name deployments whatever they
   * like, so there is no reliable way to know up front whether a deployment is
   * a reasoning model. The provider itself is the only authority, and it names
   * the offending parameter in the 400 — one parameter per response, hence the
   * loop.
   */
  private static async postOpenAIChatCompletion(data: {
    providerName: string;
    requestUrl: string;
    headers: Headers;
    config: LLMProviderConfig;
    modelName: string;
    request: LLMCompletionRequest;
    logAttributes: LogAttributes;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    let adaptation: OpenAIRequestAdaptation = this.getInitialRequestAdaptation(
      data.config,
      data.modelName,
    );

    /*
     * Which spellings have actually gone out on the wire. Read off the built
     * body rather than the adaptation, because TokenLimitParam.Default is a
     * sentinel meaning "whatever the body already carried" — recording it
     * would mark neither spelling as tried and let the loop resend a
     * byte-identical request.
     */
    const attemptedTokenLimitParams: Set<TokenLimitParam> = new Set();

    /*
     * Validated once, before the first request: the adaptation loop below
     * re-posts to the same URL, so re-resolving per attempt would only add
     * DNS round trips (and a rebind window between them).
     */
    const requestOptions: RequestOptions =
      await this.buildGuardedRequestOptions({
        providerName: data.providerName,
        requestUrl: data.requestUrl,
        isGlobalProvider: data.config.isGlobalProvider,
        options: this.buildRequestPolicy({
          request: data.request,
          defaultTimeoutInMs: 120000,
        }),
        logAttributes: data.logAttributes,
      });

    const post: () => Promise<
      HTTPResponse<JSONObject> | HTTPErrorResponse
    > = (): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const body: JSONObject = this.buildOpenAIRequestBody(
        data.modelName,
        data.request,
        adaptation,
      );

      if (body["max_completion_tokens"] !== undefined) {
        attemptedTokenLimitParams.add(TokenLimitParam.MaxCompletionTokens);
      } else if (body["max_tokens"] !== undefined) {
        attemptedTokenLimitParams.add(TokenLimitParam.MaxTokens);
      }

      return this.postToProvider({
        providerName: data.providerName,
        requestUrl: data.requestUrl,
        body: body,
        headers: data.headers,
        options: requestOptions,
        logAttributes: data.logAttributes,
      });
    };

    let response: HTTPResponse<JSONObject> | HTTPErrorResponse = await post();

    for (
      let attempt: number = 0;
      attempt < this.MAX_REQUEST_ADAPTATION_ATTEMPTS &&
      response instanceof HTTPErrorResponse;
      attempt++
    ) {
      const nextAdaptation: OpenAIRequestAdaptation | undefined =
        this.getRequestAdaptationForError(
          response,
          adaptation,
          attemptedTokenLimitParams,
        );

      if (!nextAdaptation) {
        return response;
      }

      adaptation = nextAdaptation;

      logger.debug(
        `${data.config.llmType} rejected a generation parameter for model ${data.modelName}. Retrying with a request adapted to what the model accepts.`,
      );

      response = await post();
    }

    if (!(response instanceof HTTPErrorResponse)) {
      this.cacheRequestAdaptation(data.config, data.modelName, adaptation);
    }

    return response;
  }

  private static parseOpenAIResponse(
    jsonData: JSONObject,
    providerName: string,
  ): LLMCompletionResponse {
    const choices: Array<JSONObject> = jsonData["choices"] as Array<JSONObject>;

    if (!choices || choices.length === 0) {
      throw new BadDataException(`No response from ${providerName}`);
    }

    const message: JSONObject = choices[0]!["message"] as JSONObject;
    const usage: JSONObject = jsonData["usage"] as JSONObject;
    const toolCalls: Array<LLMToolCall> | undefined =
      this.parseOpenAIToolCalls(message);

    /*
     * finish_reason "length" means the model hit the output-token cap, so the
     * content (or a trailing tool call) is truncated. It takes precedence over
     * the tool-call heuristic: executing a cut-off tool call or presenting a
     * cut-off answer as complete would be wrong either way. Otherwise the
     * presence of tool calls decides — some OpenAI-compatible servers report
     * finish_reason "stop" even when they emitted tool calls.
     */
    const finishReason: string = (choices[0]!["finish_reason"] as string) || "";

    let stopReason: "stop" | "tool_use" | "length" = "stop";

    if (finishReason === "length") {
      stopReason = "length";
    } else if (toolCalls && toolCalls.length > 0) {
      stopReason = "tool_use";
    }

    /*
     * OpenAI (and Azure OpenAI) automatically cache a stable prompt prefix
     * once it is long enough and report the cache hit under
     * prompt_tokens_details.cached_tokens — surface it for cost visibility.
     */
    const cachedTokens: number | undefined = usage
      ? ((usage["prompt_tokens_details"] as JSONObject | undefined)?.[
          "cached_tokens"
        ] as number | undefined)
      : undefined;

    return {
      content: (message["content"] as string) || "",
      toolCalls: toolCalls,
      stopReason: stopReason,
      usage: usage
        ? {
            promptTokens: usage["prompt_tokens"] as number,
            completionTokens: usage["completion_tokens"] as number,
            totalTokens: usage["total_tokens"] as number,
            cachedInputTokens: cachedTokens || undefined,
          }
        : undefined,
    };
  }

  /*
   * How the error for a request that did not fit in the model's context
   * window begins. It is stable so the investigation queue can recognize it:
   * re-running an investigation sends it into the same window again.
   */
  public static readonly CONTEXT_WINDOW_OVERFLOW_ERROR: string =
    "the request is larger than the model's context window";

  /*
   * The num_ctx that error suggests: what Ollama recommends for agents, and
   * enough for most investigations. Their fixed part alone (system prompt
   * and tool definitions) is over 10,000 tokens.
   */
  public static readonly RECOMMENDED_OLLAMA_NUM_CTX: number = 65536;

  /**
   * Handle provider HTTP failures before the decorated provider method
   * rejects. Sanitizing here is important: @CaptureSpan records the exception,
   * so redacting it only in AIService would be too late for logs and traces.
   */
  private static throwProviderHTTPError(data: {
    providerName: string;
    llmType: LlmType;
    request: LLMCompletionRequest;
    response: HTTPErrorResponse;
    logAttributes: LogAttributes;
  }): never {
    logger.error(`Error from ${data.providerName} API:`, data.logAttributes);

    /*
     * Built from our own words and the provider's fixed phrases only, so it
     * can be shown even where the provider's error body cannot.
     */
    const contextWindowOverflowError: string | undefined =
      this.describeContextWindowOverflow(data);

    if (data.request.includeProviderErrorDetails !== false) {
      logger.error(data.response, data.logAttributes);
      throw new BadDataException(
        contextWindowOverflowError ??
          `${data.providerName} API error: ${JSON.stringify(
            data.response.jsonData,
          )}`,
      );
    }

    throw new BadDataException(
      contextWindowOverflowError ??
        `${data.providerName} API request failed. Review the provider configuration and try again.`,
    );
  }

  /*
   * The error for a request the model server refused because it did not fit
   * in the model's context window, naming the setting that fixes it — or
   * undefined when that is not what the server said.
   *
   * "No user query found" only means that when the request had a question to
   * lose; for a request that never had one, the server's own words are right.
   */
  private static describeContextWindowOverflow(data: {
    providerName: string;
    llmType: LlmType;
    request: LLMCompletionRequest;
    response: HTTPErrorResponse;
  }): string | undefined {
    /*
     * Ollama's native API sends {"error": "..."} and its OpenAI-compatible
     * API {"error": {"message": "..."}}; HTTPErrorResponse reads both.
     */
    const providerError: string = data.response.message;
    const isOllama: boolean = data.llmType === LlmType.Ollama;

    let symptom: string;

    if (
      NO_USER_QUERY_ERROR_PATTERN.test(providerError) &&
      this.hasUserQuery(data.request.messages)
    ) {
      symptom = `, so ${
        isOllama ? "Ollama" : "the server"
      } dropped the oldest messages, the question among them, and the model rejected the rest ("no user query found in messages")`;
    } else if (PROMPT_LONGER_THAN_CONTEXT_ERROR_PATTERN.test(providerError)) {
      symptom = ` ("the prompt is longer than the context length currently available to the model")`;
    } else {
      return undefined;
    }

    if (!isOllama) {
      // Ollama's OpenAI-compatible API has no field for num_ctx.
      return `${data.providerName} API error: ${this.CONTEXT_WINDOW_OVERFLOW_ERROR}${symptom}. If Ollama serves this model, set OLLAMA_CONTEXT_LENGTH on the Ollama server (its OpenAI-compatible API ignores num_ctx), or switch this provider to Ollama and set num_ctx in its Additional Parameters.`;
    }

    const options: unknown = data.request.additionalParams?.["options"];
    const configuredNumCtx: unknown =
      options && typeof options === "object" && !Array.isArray(options)
        ? (options as JSONObject)["num_ctx"]
        : undefined;

    let target: string = `to ${this.RECOMMENDED_OLLAMA_NUM_CTX} or more`;

    if (typeof configuredNumCtx === "number") {
      target =
        configuredNumCtx >= this.RECOMMENDED_OLLAMA_NUM_CTX
          ? `above ${configuredNumCtx}`
          : `${target} (it is ${configuredNumCtx} now)`;
    }

    return `${data.providerName} API error: ${this.CONTEXT_WINDOW_OVERFLOW_ERROR}${symptom}. Raise the context window: set "num_ctx" under "options" in this LLM provider's Additional Parameters ${target}, or set OLLAMA_CONTEXT_LENGTH on the Ollama server.`;
  }

  /*
   * Whether a conversation has a question by the rule Qwen's chat template
   * applies: a user message that is not just a wrapped tool result.
   */
  private static hasUserQuery(messages: Array<LLMMessage>): boolean {
    return messages.some((message: LLMMessage) => {
      if (message.role !== "user") {
        return false;
      }

      const content: string = (message.content || "").trim();

      return !(
        content.startsWith("<tool_response>") &&
        content.endsWith("</tool_response>")
      );
    });
  }

  /*
   * The error for a provider that could not be reached, rebuilt so that it
   * never names the provider's address.
   *
   * API reports a request that got no response as "Request failed to <url>.
   * <reason>", and the egress guard names the host it refused. Those messages
   * end up in LlmLog, chat replies and the investigation panel, which every
   * project member can read, and for the global provider that exposes an LLM
   * server tenants were never given. So the message says what went wrong but
   * not where, and the operator gets the original in the server log.
   *
   * The exception type (and the guard's reason) is kept, so status codes and
   * retry classification are unchanged. The original error is not attached:
   * an AxiosError carries the URL and the request headers, credentials
   * included.
   */
  private static toAddressFreeProviderError(data: {
    providerName: string;
    error: unknown;
    timeoutInMs?: number | undefined;
    logAttributes: LogAttributes;
  }): Error {
    logger.error(
      `${data.providerName} API request failed before the provider responded: ${
        data.error instanceof Error ? data.error.message : String(data.error)
      }`,
      data.logAttributes,
    );

    if (data.error instanceof EgressGuardException) {
      return new EgressGuardException(
        `${data.providerName} API request failed: ${
          EGRESS_REFUSAL_DESCRIPTIONS[data.error.reason]
        }.`,
        data.error.reason,
      );
    }

    return new APIException(
      `${data.providerName} API request failed: ${this.describeTransportFailure(
        data.error,
        data.timeoutInMs,
      )}.`,
    );
  }

  private static describeTransportFailure(
    error: unknown,
    timeoutInMs: number | undefined,
  ): string {
    // API wraps the transport error, and its code is what says what happened.
    const cause: unknown =
      error instanceof APIException && error.error ? error.error : error;
    const rawCode: unknown =
      cause && typeof cause === "object"
        ? (cause as { code?: unknown }).code
        : undefined;
    const code: string = typeof rawCode === "string" ? rawCode : "";
    const message: string = (
      cause instanceof Error ? cause.message : String(cause)
    ).toLowerCase();

    // axios' own per-attempt timeout: "timeout of 120000ms exceeded".
    if (code === "ECONNABORTED" || message.includes("timeout of")) {
      if (!timeoutInMs) {
        return "the LLM provider did not respond in time";
      }

      const seconds: number = Math.round(timeoutInMs / 1000);

      return `the LLM provider did not respond within ${
        seconds >= 1
          ? `${seconds} second${seconds === 1 ? "" : "s"}`
          : `${timeoutInMs} ms`
      }`;
    }

    if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
      return "the connection to the LLM provider timed out";
    }

    if (code === "ECONNREFUSED") {
      return "the LLM provider refused the connection";
    }

    if (
      code === "ECONNRESET" ||
      code === "EPIPE" ||
      message.includes("socket hang up")
    ) {
      return "the LLM provider closed the connection before responding";
    }

    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return "the LLM provider's host name could not be resolved";
    }

    if (
      code === "EHOSTUNREACH" ||
      code === "ENETUNREACH" ||
      code === "EADDRNOTAVAIL"
    ) {
      return "the LLM provider could not be reached over the network";
    }

    // Certificate and handshake failures, e.g. CERT_HAS_EXPIRED.
    const tlsFailureCodeRegex: RegExp =
      /^(CERT_|ERR_TLS_|ERR_SSL_|EPROTO$)|SELF_SIGNED|UNABLE_TO_/;

    if (tlsFailureCodeRegex.test(code)) {
      return "a secure connection to the LLM provider could not be established";
    }

    return "the LLM provider could not be reached";
  }

  /*
   * Build the chat completions URL for an OpenAI-compatible server from the
   * configured base URL. Users enter the base URL in a few different ways, and
   * we normalize all of them onto the right endpoint instead of 404-ing:
   *
   *   - Already a full endpoint (".../chat/completions") -> used as-is.
   *   - Includes a path (".../v1", ".../openai/v1") -> append "/chat/completions".
   *   - Bare server root ("http://host:8000") -> append "/v1/chat/completions",
   *     since vLLM, LocalAI and similar servers expose the OpenAI-compatible API
   *     under /v1 by default. This is the most common self-hosted setup and the
   *     easiest one for users to get wrong (omitting /v1 returns FastAPI's
   *     {"detail":"Not Found"}).
   *
   * The endpoint segment is only ever appended to the PATH portion: any
   * ?query or #fragment on the base URL is split off first and re-attached
   * afterwards (otherwise "/chat/completions" would land inside the query or
   * fragment). Trailing slashes are stripped so we never emit
   * ".../v1//chat/completions", and the URL scheme is lower-cased because URL
   * schemes are case-insensitive but downstream URL parsing only recognizes
   * lowercase http/https.
   */
  private static buildOpenAICompatibleChatCompletionsUrl(
    baseUrl: string,
  ): string {
    const raw: string = baseUrl.trim();

    // Split off #fragment, then ?query, so we can operate on the path alone.
    const fragmentIndex: number = raw.indexOf("#");
    const fragment: string =
      fragmentIndex >= 0 ? raw.substring(fragmentIndex) : "";
    const withoutFragment: string =
      fragmentIndex >= 0 ? raw.substring(0, fragmentIndex) : raw;

    const queryIndex: number = withoutFragment.indexOf("?");
    const query: string =
      queryIndex >= 0 ? withoutFragment.substring(queryIndex) : "";

    let base: string =
      queryIndex >= 0
        ? withoutFragment.substring(0, queryIndex)
        : withoutFragment;

    /*
     * Lower-case the scheme (e.g. "HTTP://" -> "http://") and strip trailing
     * slashes.
     */
    const schemeRegex: RegExp = /^[a-z][a-z0-9+.-]*:\/\//i;
    base = base
      .replace(schemeRegex, (scheme: string) => {
        return scheme.toLowerCase();
      })
      .replace(/\/+$/, "");

    let path: string;
    const fullEndpointRegex: RegExp = /\/chat\/completions$/i;
    const hasPathAfterHostRegex: RegExp = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/.+/i;

    if (fullEndpointRegex.test(base)) {
      // The user already pointed us at the full endpoint.
      path = base;
    } else if (hasPathAfterHostRegex.test(base)) {
      /*
       * The base URL carries a path after the host[:port] (e.g.
       * "http://host:8000/v1" or ".../openai/v1") — trust it and only append
       * the endpoint.
       */
      path = `${base}/chat/completions`;
    } else {
      /*
       * Bare server root ("http://host:8000") — add the conventional /v1
       * prefix that OpenAI-compatible servers (vLLM, LocalAI, ...) use.
       */
      path = `${base}/v1/chat/completions`;
    }

    return `${path}${query}${fragment}`;
  }

  @CaptureSpan()
  private static async getOpenAICompatibleCompletion(
    config: LLMProviderConfig,
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    /*
     * Generic OpenAI-compatible servers (vLLM, LocalAI, etc.) are usually
     * self-hosted, frequently keyless, and have no canonical endpoint or
     * default model — so the API key is optional but the base URL and model
     * name must be provided. The hosted providers (OpenAI, Groq, Mistral)
     * keep requiring a key and fall back to sensible defaults.
     */
    const isGenericOpenAICompatible: boolean =
      config.llmType === LlmType.OpenAICompatible;

    if (!isGenericOpenAICompatible && !config.apiKey) {
      throw new BadDataException(`${config.llmType} API key is required`);
    }

    if (isGenericOpenAICompatible && !config.baseUrl) {
      throw new BadDataException(
        "Base URL is required for OpenAI-compatible providers (e.g. http://your-vllm-server:8000/v1)",
      );
    }

    if (isGenericOpenAICompatible && !config.modelName) {
      throw new BadDataException(
        "Model Name is required for OpenAI-compatible providers. It must match a model your server exposes.",
      );
    }

    const defaultBaseUrls: Record<string, string> = {
      [LlmType.OpenAI]: "https://api.openai.com/v1",
      [LlmType.Groq]: "https://api.groq.com/openai/v1",
      [LlmType.Mistral]: "https://api.mistral.ai/v1",
    };

    /*
     * gpt-5.1 is a reasoning model: REASONING_MODEL_NAME_REGEX matches it, so
     * the first request already goes out with max_completion_tokens instead
     * of the legacy max_tokens, and any sampling params it rejects are
     * dropped by the error-driven retry.
     */
    const defaultModels: Record<string, string> = {
      [LlmType.OpenAI]: "gpt-5.1",
      [LlmType.Groq]: "llama-3.3-70b-versatile",
      [LlmType.Mistral]: "mistral-large-latest",
    };

    const baseUrl: string =
      config.baseUrl ||
      defaultBaseUrls[config.llmType] ||
      "https://api.openai.com/v1";
    const modelName: string =
      config.modelName || defaultModels[config.llmType] || "gpt-5.1";
    const logAttributes: LogAttributes = {
      llmType: config.llmType,
      modelName: modelName,
    };

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await this.postOpenAIChatCompletion({
        providerName: config.llmType.toString(),
        requestUrl: this.buildOpenAICompatibleChatCompletionsUrl(baseUrl),
        headers: {
          "Content-Type": "application/json",
          /*
           * Only send Authorization when a key is configured — a keyless
           * server (e.g. vLLM started without --api-key) rejects an empty
           * bearer token.
           */
          ...(config.apiKey
            ? { Authorization: `Bearer ${config.apiKey}` }
            : {}),
        },
        config: config,
        modelName: modelName,
        request: request,
        logAttributes: logAttributes,
      });

    if (response instanceof HTTPErrorResponse) {
      this.throwProviderHTTPError({
        providerName: config.llmType.toString(),
        llmType: config.llmType,
        request,
        response,
        logAttributes,
      });
    }

    return this.parseOpenAIResponse(
      response.jsonData as JSONObject,
      config.llmType,
    );
  }

  /*
   * Default Azure OpenAI API version. Users can override by including
   * ?api-version=... in their configured base URL.
   */
  private static readonly AZURE_OPENAI_DEFAULT_API_VERSION: string =
    "2024-10-21";

  private static buildAzureOpenAIChatCompletionsUrl(baseUrl: string): string {
    const trimmed: string = baseUrl.replace(/\/+$/, "");
    const queryIndex: number = trimmed.indexOf("?");
    const pathPart: string =
      queryIndex >= 0 ? trimmed.substring(0, queryIndex) : trimmed;
    const queryPart: string =
      queryIndex >= 0 ? trimmed.substring(queryIndex + 1) : "";

    const params: URLSearchParams = new URLSearchParams(queryPart);
    if (!params.has("api-version")) {
      params.set("api-version", LLMService.AZURE_OPENAI_DEFAULT_API_VERSION);
    }

    return `${pathPart}/chat/completions?${params.toString()}`;
  }

  @CaptureSpan()
  private static async getAzureOpenAICompletion(
    config: LLMProviderConfig,
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    if (!config.apiKey) {
      throw new BadDataException("Azure OpenAI API key is required");
    }

    if (!config.baseUrl) {
      throw new BadDataException(
        "Azure OpenAI Base URL is required (e.g. https://<resource>.openai.azure.com/openai/deployments/<deployment>)",
      );
    }

    /*
     * On Azure the model field is the DEPLOYMENT NAME the operator chose —
     * not a model id. Keep the long-standing "gpt-4o" guess for tenants who
     * left it blank: existing deployments named after the old default keep
     * working, and Azure deployment names cannot contain dots, so a
     * "gpt-5.1"-style id would never match a real deployment. The
     * error-driven parameter adaptation corrects token-param mismatches
     * either way.
     */
    const modelName: string = config.modelName || "gpt-4o";
    const requestUrl: string = LLMService.buildAzureOpenAIChatCompletionsUrl(
      config.baseUrl,
    );
    const logAttributes: LogAttributes = {
      llmType: config.llmType,
      modelName: modelName,
    };

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await this.postOpenAIChatCompletion({
        providerName: "Azure OpenAI",
        requestUrl: requestUrl,
        headers: {
          "api-key": config.apiKey,
          "Content-Type": "application/json",
        },
        config: config,
        modelName: modelName,
        request: request,
        logAttributes: logAttributes,
      });

    if (response instanceof HTTPErrorResponse) {
      this.throwProviderHTTPError({
        providerName: "Azure OpenAI",
        llmType: config.llmType,
        request,
        response,
        logAttributes,
      });
    }

    return this.parseOpenAIResponse(
      response.jsonData as JSONObject,
      "Azure OpenAI",
    );
  }

  /*
   * Anthropic wire format. System message is hoisted, tool results ride in
   * user messages as tool_result blocks, and max_tokens is required by the
   * API.
   */

  private static readonly ANTHROPIC_DEFAULT_MAX_TOKENS: number = 4096;

  private static toAnthropicMessages(
    messages: Array<LLMMessage>,
  ): Array<JSONObject> {
    const anthropicMessages: Array<JSONObject> = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        continue; // hoisted separately
      }

      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length) {
        const contentBlocks: Array<JSONObject> = [];

        if (msg.content) {
          contentBlocks.push({ type: "text", text: msg.content });
        }

        for (const toolCall of msg.toolCalls) {
          contentBlocks.push({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.arguments,
          });
        }

        anthropicMessages.push({ role: "assistant", content: contentBlocks });
        continue;
      }

      if (msg.role === "tool") {
        const toolResultBlock: JSONObject = {
          type: "tool_result",
          tool_use_id: msg.toolCallId || "",
          content: msg.content,
        };

        /*
         * Tool results must be user messages. Merge consecutive tool
         * results into one user message so roles keep alternating.
         */
        const lastMessage: JSONObject | undefined =
          anthropicMessages[anthropicMessages.length - 1];

        if (
          lastMessage &&
          lastMessage["role"] === "user" &&
          Array.isArray(lastMessage["content"])
        ) {
          (lastMessage["content"] as Array<JSONObject>).push(toolResultBlock);
        } else {
          anthropicMessages.push({
            role: "user",
            content: [toolResultBlock],
          });
        }
        continue;
      }

      /*
       * Anthropic requires strictly alternating user/assistant turns and
       * returns a 400 on two consecutive same-role messages. The agent loop
       * can legitimately emit back-to-back user turns (e.g. a tool_result
       * user message immediately followed by the "budget exhausted, answer
       * now" nudge), so coalesce a run of same-role messages into one instead
       * of failing the whole request.
       */
      const previousMessage: JSONObject | undefined =
        anthropicMessages[anthropicMessages.length - 1];

      if (previousMessage && previousMessage["role"] === msg.role) {
        if (typeof previousMessage["content"] === "string") {
          previousMessage["content"] =
            `${previousMessage["content"] as string}\n\n${msg.content}`;
          continue;
        }
        if (Array.isArray(previousMessage["content"])) {
          (previousMessage["content"] as Array<JSONObject>).push({
            type: "text",
            text: msg.content,
          });
          continue;
        }
      }

      anthropicMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    return anthropicMessages;
  }

  @CaptureSpan()
  private static async getAnthropicCompletion(
    config: LLMProviderConfig,
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    if (!config.apiKey) {
      throw new BadDataException("Anthropic API key is required");
    }

    const baseUrl: string = config.baseUrl || "https://api.anthropic.com/v1";
    /*
     * Current Sonnet alias. The dated claude-sonnet-4-20250514 ID this used to
     * default to is deprecated and retires in June 2026.
     */
    const modelName: string = config.modelName || "claude-sonnet-5";

    let systemMessage: string = "";

    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemMessage = msg.content;
      }
    }

    const requestData: JSONObject = {
      model: modelName,
      messages: this.toAnthropicMessages(request.messages),
      temperature: request.temperature ?? 0.7,
      // Anthropic requires max_tokens on every request.
      max_tokens: request.maxTokens || LLMService.ANTHROPIC_DEFAULT_MAX_TOKENS,
    };

    /*
     * Prompt caching. The system prompt and tool definitions are the large,
     * stable prefix re-sent on every turn of the agent loop, so caching them is
     * the biggest single cost + latency lever (cached input is billed at ~10%).
     * An ephemeral cache_control breakpoint on the system block and on the LAST
     * tool caches the whole system + tools prefix. cache_control is GA under
     * anthropic-version 2023-06-01, so no beta header is required.
     */
    if (systemMessage) {
      requestData["system"] = [
        {
          type: "text",
          text: systemMessage,
          cache_control: { type: "ephemeral" },
        },
      ];
    }

    if (request.tools && request.tools.length > 0) {
      const anthropicTools: Array<JSONObject> = request.tools.map(
        (tool: LLMToolDefinition) => {
          return {
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
          };
        },
      );

      // A breakpoint on the last tool caches the entire tools block before it.
      const lastTool: JSONObject | undefined =
        anthropicTools[anthropicTools.length - 1];
      if (lastTool) {
        lastTool["cache_control"] = { type: "ephemeral" };
      }

      requestData["tools"] = anthropicTools;
    }

    const anthropicRequestUrl: string = `${baseUrl}/messages`;
    const anthropicLogAttributes: LogAttributes = {
      llmType: config.llmType,
      modelName: modelName,
    };

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await this.postToProvider({
        providerName: "Anthropic",
        requestUrl: anthropicRequestUrl,
        body: requestData,
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        options: await this.buildGuardedRequestOptions({
          providerName: "Anthropic",
          requestUrl: anthropicRequestUrl,
          isGlobalProvider: config.isGlobalProvider,
          options: this.buildRequestPolicy({
            request: request,
            defaultTimeoutInMs: 120000,
          }),
          logAttributes: anthropicLogAttributes,
        }),
        logAttributes: anthropicLogAttributes,
      });

    if (response instanceof HTTPErrorResponse) {
      this.throwProviderHTTPError({
        providerName: "Anthropic",
        llmType: config.llmType,
        request,
        response,
        logAttributes: anthropicLogAttributes,
      });
    }

    const jsonData: JSONObject = response.jsonData as JSONObject;
    const content: Array<JSONObject> = jsonData["content"] as Array<JSONObject>;

    if (!content || content.length === 0) {
      throw new BadDataException("No response from Anthropic");
    }

    const textContent: string = content
      .filter((block: JSONObject) => {
        return block["type"] === "text";
      })
      .map((block: JSONObject) => {
        return block["text"] as string;
      })
      .join("");

    const toolCalls: Array<LLMToolCall> = content
      .filter((block: JSONObject) => {
        return block["type"] === "tool_use";
      })
      .map((block: JSONObject) => {
        return {
          id: (block["id"] as string) || "",
          name: (block["name"] as string) || "",
          arguments: (block["input"] as JSONObject) || {},
        };
      });

    if (!textContent && toolCalls.length === 0) {
      throw new BadDataException("No text content in Anthropic response");
    }

    const usage: JSONObject = jsonData["usage"] as JSONObject;

    /*
     * Anthropic reports truncation as stop_reason "max_tokens" — surface it as
     * "length" so callers never present a cut-off answer as complete.
     */
    const anthropicStopReason: string =
      (jsonData["stop_reason"] as string) || "";

    let stopReason: "stop" | "tool_use" | "length" = "stop";

    if (anthropicStopReason === "tool_use") {
      stopReason = "tool_use";
    } else if (anthropicStopReason === "max_tokens") {
      stopReason = "length";
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: stopReason,
      usage: usage
        ? {
            promptTokens: (usage["input_tokens"] as number) || 0,
            completionTokens: (usage["output_tokens"] as number) || 0,
            /*
             * Anthropic reports cache-read and cache-creation input tokens
             * separately from input_tokens. Surface them and fold them into
             * totalTokens so the logged total reflects the full billable input.
             */
            cachedInputTokens:
              (usage["cache_read_input_tokens"] as number) || undefined,
            cacheCreationTokens:
              (usage["cache_creation_input_tokens"] as number) || undefined,
            totalTokens:
              ((usage["input_tokens"] as number) || 0) +
              ((usage["cache_read_input_tokens"] as number) || 0) +
              ((usage["cache_creation_input_tokens"] as number) || 0) +
              ((usage["output_tokens"] as number) || 0),
          }
        : undefined,
    };
  }

  /*
   * Ollama native /api/chat. Deliberately NOT routed through the
   * OpenAI-compatible branch: Ollama deployments are keyless by design and
   * the OpenAI branch requires an API key.
   */
  @CaptureSpan()
  private static async getOllamaCompletion(
    config: LLMProviderConfig,
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    if (!config.baseUrl) {
      throw new BadDataException("Ollama base URL is required");
    }

    // llama2 predates tool calling entirely; llama3.1 is the oldest sane default.
    const modelName: string = config.modelName || "llama3.1";

    const requestData: JSONObject = {
      model: modelName,
      messages: request.messages.map((msg: LLMMessage) => {
        if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length) {
          return {
            role: "assistant",
            content: msg.content || "",
            tool_calls: msg.toolCalls.map((toolCall: LLMToolCall) => {
              return {
                function: {
                  name: toolCall.name,
                  arguments: toolCall.arguments,
                },
              };
            }),
          };
        }

        return {
          role: msg.role,
          content: msg.content,
        };
      }),
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        ...(request.maxTokens ? { num_predict: request.maxTokens } : {}),
      },
    };

    if (request.tools && request.tools.length > 0) {
      requestData["tools"] = this.toOpenAITools(request.tools);
    }

    /*
     * Provider-configured tuning. The model column and the settings UI both
     * promise additionalParams is sent to the provider, but only the
     * OpenAI-wire branch honoured it — so on Ollama the operator had no lever
     * at all, and in particular no way to raise `num_ctx`. That matters here
     * more than on any hosted provider: Ollama silently truncates anything
     * past the server's default context (2048/4096 on common builds), and the
     * chat agent's tool belt alone is several thousand tokens. A truncated
     * request loses the tool definitions with no error, and the model then
     * answers that it has no tool for the question.
     *
     * Ollama nests generation settings under `options`, so an `options`
     * object in additionalParams is merged INTO the defaults above rather
     * than replacing them; every other key is applied at the top level.
     */
    if (request.additionalParams) {
      const additionalOptions: JSONObject | undefined = request
        .additionalParams["options"] as JSONObject | undefined;

      for (const key of Object.keys(request.additionalParams)) {
        if (key === "options" || OLLAMA_RESERVED_REQUEST_KEYS.has(key)) {
          continue;
        }

        if (
          request.protectRequestParameters &&
          !this.PROTECTED_ADDITIONAL_PARAMETER_ALLOWLIST.has(key)
        ) {
          continue;
        }

        requestData[key] = request.additionalParams[key];
      }

      if (
        additionalOptions &&
        typeof additionalOptions === "object" &&
        !Array.isArray(additionalOptions)
      ) {
        Object.assign(requestData["options"] as JSONObject, additionalOptions);

        /*
         * Ollama's generation knobs live inside `options`, so merging it is
         * how an operator raises num_ctx — but it is also how they would
         * overwrite the caller's own temperature and output cap. A protected
         * caller owns those two, exactly as it does on the OpenAI wire (where
         * the protected branch re-asserts temperature and max_tokens after
         * the merge), so re-assert them here rather than filtering the merge
         * and losing the tuning the operator legitimately configured.
         */
        if (request.protectRequestParameters) {
          const protectedOptions: JSONObject = requestData[
            "options"
          ] as JSONObject;

          protectedOptions["temperature"] = request.temperature ?? 0.7;

          if (request.maxTokens) {
            protectedOptions["num_predict"] = request.maxTokens;
          }
        }
      }
    }

    const ollamaRequestUrl: string = `${config.baseUrl}/api/chat`;
    const ollamaLogAttributes: LogAttributes = {
      llmType: config.llmType,
      modelName: modelName,
    };

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await this.postToProvider({
        providerName: "Ollama",
        requestUrl: ollamaRequestUrl,
        body: requestData,
        headers: {
          "Content-Type": "application/json",
        },
        options: await this.buildGuardedRequestOptions({
          providerName: "Ollama",
          requestUrl: ollamaRequestUrl,
          isGlobalProvider: config.isGlobalProvider,
          options: this.buildRequestPolicy({
            request: request,
            defaultTimeoutInMs: 300000, // Ollama may be slower
          }),
          logAttributes: ollamaLogAttributes,
        }),
        logAttributes: ollamaLogAttributes,
      });

    if (response instanceof HTTPErrorResponse) {
      this.throwProviderHTTPError({
        providerName: "Ollama",
        llmType: config.llmType,
        request,
        response,
        logAttributes: ollamaLogAttributes,
      });
    }

    const jsonData: JSONObject = response.jsonData as JSONObject;
    const message: JSONObject = jsonData["message"] as JSONObject;

    if (!message) {
      throw new BadDataException("No response from Ollama");
    }

    const rawToolCalls: JSONArray | undefined = message["tool_calls"] as
      | JSONArray
      | undefined;

    let toolCalls: Array<LLMToolCall> | undefined = undefined;

    if (rawToolCalls && rawToolCalls.length > 0) {
      toolCalls = rawToolCalls.map((rawToolCall: JSONObject, index: number) => {
        const fn: JSONObject = (rawToolCall["function"] as JSONObject) || {};

        let parsedArguments: JSONObject = {};
        let parseError: string | undefined = undefined;
        const rawArguments: unknown = fn["arguments"];

        if (typeof rawArguments === "string") {
          const parsed: { arguments: JSONObject; error?: string | undefined } =
            this.parseToolCallArguments(rawArguments);
          parsedArguments = parsed.arguments;
          parseError = parsed.error;
        } else if (rawArguments && typeof rawArguments === "object") {
          parsedArguments = rawArguments as JSONObject;
        }

        // Ollama does not return tool-call ids; synthesize stable ones.
        return {
          id: `tool_call_${index}`,
          name: (fn["name"] as string) || "",
          arguments: parsedArguments,
          argumentsParseError: parseError,
        };
      });
    }

    /*
     * Ollama reports token counts on the final /api/chat response as
     * prompt_eval_count (input) and eval_count (output). Populate usage from
     * them so LlmLog, the AI dashboards and (costed self-hosted Ollama)
     * billing are not silently blind to token spend.
     */
    const ollamaPromptTokens: number =
      (jsonData["prompt_eval_count"] as number) || 0;
    const ollamaCompletionTokens: number =
      (jsonData["eval_count"] as number) || 0;

    /*
     * Ollama reports why generation ended in done_reason on the final
     * /api/chat response: "length" when num_predict cut the output off
     * ("limit" is accepted too for wire-compat variants). Truncation takes
     * precedence over the tool-call heuristic — a cut-off tool call must not
     * be executed.
     */
    const doneReason: string = (jsonData["done_reason"] as string) || "";

    let stopReason: "stop" | "tool_use" | "length" = "stop";

    if (doneReason === "length" || doneReason === "limit") {
      stopReason = "length";
    } else if (toolCalls && toolCalls.length > 0) {
      stopReason = "tool_use";
    }

    return {
      content: (message["content"] as string) || "",
      toolCalls: toolCalls,
      stopReason: stopReason,
      usage:
        ollamaPromptTokens || ollamaCompletionTokens
          ? {
              promptTokens: ollamaPromptTokens,
              completionTokens: ollamaCompletionTokens,
              totalTokens: ollamaPromptTokens + ollamaCompletionTokens,
            }
          : undefined,
    };
  }
}
