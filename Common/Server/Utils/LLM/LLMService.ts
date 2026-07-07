import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import API from "../../../Utils/API";
import LlmType from "../../../Types/LLM/LlmType";
import BadDataException from "../../../Types/Exception/BadDataException";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

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
  tools?: Array<LLMToolDefinition> | undefined;
  llmProviderConfig: LLMProviderConfig;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMCompletionResponse {
  content: string;
  toolCalls?: Array<LLMToolCall> | undefined;
  stopReason?: "stop" | "tool_use" | undefined;
  usage: LLMUsage | undefined;
}

export interface LLMProviderConfig {
  llmType: LlmType;
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
}

export default class LLMService {
  @CaptureSpan()
  public static async getCompletion(
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    const config: LLMProviderConfig = request.llmProviderConfig;

    switch (config.llmType) {
      case LlmType.OpenAI:
      case LlmType.Groq:
      case LlmType.Mistral:
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

    return data;
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

    return {
      content: (message["content"] as string) || "",
      toolCalls: toolCalls,
      stopReason: toolCalls && toolCalls.length > 0 ? "tool_use" : "stop",
      usage: usage
        ? {
            promptTokens: usage["prompt_tokens"] as number,
            completionTokens: usage["completion_tokens"] as number,
            totalTokens: usage["total_tokens"] as number,
          }
        : undefined,
    };
  }

  @CaptureSpan()
  private static async getOpenAICompatibleCompletion(
    config: LLMProviderConfig,
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    if (!config.apiKey) {
      throw new BadDataException(`${config.llmType} API key is required`);
    }

    const defaultBaseUrls: Record<string, string> = {
      [LlmType.OpenAI]: "https://api.openai.com/v1",
      [LlmType.Groq]: "https://api.groq.com/openai/v1",
      [LlmType.Mistral]: "https://api.mistral.ai/v1",
    };

    const defaultModels: Record<string, string> = {
      [LlmType.OpenAI]: "gpt-4o",
      [LlmType.Groq]: "llama-3.3-70b-versatile",
      [LlmType.Mistral]: "mistral-large-latest",
    };

    const baseUrl: string =
      config.baseUrl ||
      defaultBaseUrls[config.llmType] ||
      "https://api.openai.com/v1";
    const modelName: string =
      config.modelName || defaultModels[config.llmType] || "gpt-4o";
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>({
        url: URL.fromString(`${baseUrl}/chat/completions`),
        data: this.buildOpenAIRequestBody(modelName, request),
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        options: {
          retries: 2,
          exponentialBackoff: true,
          timeout: 120000,
        },
      });

    const logAttributes: LogAttributes = {
      llmType: config.llmType,
      modelName: modelName,
    };

    if (response instanceof HTTPErrorResponse) {
      logger.error(`Error from ${config.llmType} API:`, logAttributes);
      logger.error(response, logAttributes);
      throw new BadDataException(
        `${config.llmType} API error: ${JSON.stringify(response.jsonData)}`,
      );
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

    const modelName: string = config.modelName || "gpt-4o";
    const requestUrl: string = LLMService.buildAzureOpenAIChatCompletionsUrl(
      config.baseUrl,
    );

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>({
        url: URL.fromString(requestUrl),
        data: this.buildOpenAIRequestBody(modelName, request),
        headers: {
          "api-key": config.apiKey,
          "Content-Type": "application/json",
        },
        options: {
          retries: 2,
          exponentialBackoff: true,
          timeout: 120000,
        },
      });

    const logAttributes: LogAttributes = {
      llmType: config.llmType,
      modelName: modelName,
    };

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error from Azure OpenAI API:", logAttributes);
      logger.error(response, logAttributes);
      throw new BadDataException(
        `Azure OpenAI API error: ${JSON.stringify(response.jsonData)}`,
      );
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
    const modelName: string = config.modelName || "claude-sonnet-4-20250514";

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

    if (systemMessage) {
      requestData["system"] = systemMessage;
    }

    if (request.tools && request.tools.length > 0) {
      requestData["tools"] = request.tools.map((tool: LLMToolDefinition) => {
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        };
      });
    }

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>({
        url: URL.fromString(`${baseUrl}/messages`),
        data: requestData,
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        options: {
          retries: 2,
          exponentialBackoff: true,
          timeout: 120000,
        },
      });

    const anthropicLogAttributes: LogAttributes = {
      llmType: config.llmType,
      modelName: modelName,
    };

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error from Anthropic API:", anthropicLogAttributes);
      logger.error(response, anthropicLogAttributes);
      throw new BadDataException(
        `Anthropic API error: ${JSON.stringify(response.jsonData)}`,
      );
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

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: jsonData["stop_reason"] === "tool_use" ? "tool_use" : "stop",
      usage: usage
        ? {
            promptTokens: usage["input_tokens"] as number,
            completionTokens: usage["output_tokens"] as number,
            totalTokens:
              ((usage["input_tokens"] as number) || 0) +
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

    const modelName: string = config.modelName || "llama2";

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

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>({
        url: URL.fromString(`${config.baseUrl}/api/chat`),
        data: requestData,
        headers: {
          "Content-Type": "application/json",
        },
        options: {
          retries: 2,
          exponentialBackoff: true,
          timeout: 300000, // 5 minutes for Ollama as it may be slower
        },
      });

    const ollamaLogAttributes: LogAttributes = {
      llmType: config.llmType,
      modelName: modelName,
    };

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error from Ollama API:", ollamaLogAttributes);
      logger.error(response, ollamaLogAttributes);
      throw new BadDataException(
        `Ollama API error: ${JSON.stringify(response.jsonData)}`,
      );
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

    return {
      content: (message["content"] as string) || "",
      toolCalls: toolCalls,
      stopReason: toolCalls && toolCalls.length > 0 ? "tool_use" : "stop",
      usage: undefined, // Ollama doesn't provide token usage in the same way
    };
  }
}
