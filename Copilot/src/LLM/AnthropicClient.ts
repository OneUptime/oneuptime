import { JSONObject } from "Common/Types/JSON";
import { fetch, Response } from "undici";
import { ChatMessage, OpenAIToolCall, ToolDefinition } from "../Types";
import AgentLogger from "../Utils/AgentLogger";
import { LLMClient } from "./LLMClient";

const DEFAULT_ENDPOINT: string = "https://api.anthropic.com/v1/messages";
const DEFAULT_VERSION: string = "2023-06-01";
const DEFAULT_MAX_OUTPUT_TOKENS: number = 1024;
const DEFAULT_MAX_ATTEMPTS: number = 3;
const DEFAULT_RETRY_DELAY_MS: number = 2000;

type AnthropicRole = "user" | "assistant";

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: JSONObject }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: Array<{ type: "text"; text: string }>;
    };

interface AnthropicMessage {
  role: AnthropicRole;
  content: Array<AnthropicContentBlock>;
}

interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: JSONObject;
}

interface AnthropicChatCompletionRequest {
  model: string;
  temperature: number;
  max_tokens: number;
  messages: Array<AnthropicMessage>;
  system?: string;
  tools?: Array<AnthropicToolDefinition>;
  tool_choice?: "auto";
}

interface AnthropicResponseBody {
  content: Array<AnthropicContentBlock | { type: string; [key: string]: unknown }>;
}

export interface AnthropicClientOptions {
  apiKey: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  endpoint?: string;
  version?: string;
  maxOutputTokens?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}

/**
 * Native Anthropic Messages API client with tool-use support.
 */
export class AnthropicClient implements LLMClient {
  private readonly endpoint: string;
  private readonly version: string;
  private readonly maxTokens: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  public constructor(private readonly options: AnthropicClientOptions) {
    if (!options.apiKey) {
      throw new Error(
        "Anthropic API key is required when using the anthropic provider.",
      );
    }

    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.version = options.version ?? DEFAULT_VERSION;
    this.maxTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  public async createChatCompletion(data: {
    messages: Array<ChatMessage>;
    tools?: Array<ToolDefinition>;
  }): Promise<ChatMessage> {
    const payload: AnthropicChatCompletionRequest = this.buildPayload(data);
    return await this.executeWithRetries(payload);
  }

  private buildPayload(data: {
    messages: Array<ChatMessage>;
    tools?: Array<ToolDefinition>;
  }): AnthropicChatCompletionRequest {
    const { systemPrompt, messages } = this.mapMessages(data.messages);
    const toolMetadata:
      | {
          tools: Array<AnthropicToolDefinition>;
          tool_choice: "auto";
        }
      | undefined = data.tools?.length
      ? {
          tools: data.tools.map((tool: ToolDefinition) => {
            return {
              name: tool.function.name,
              description: tool.function.description,
              input_schema: tool.function.parameters,
            };
          }),
          tool_choice: "auto",
        }
      : undefined;

    const payload: AnthropicChatCompletionRequest = {
      model: this.options.model,
      temperature: this.options.temperature,
      max_tokens: this.maxTokens,
      messages,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(toolMetadata ?? {}),
    };

    return payload;
  }

  private async executeWithRetries(
    payload: AnthropicChatCompletionRequest,
  ): Promise<ChatMessage> {
    let attempt: number = 0;
    let lastError: unknown;

    while (attempt < this.maxAttempts) {
      attempt += 1;
      try {
        return await this.executeOnce(payload, attempt);
      } catch (error) {
        lastError = error;
        if (!this.isAbortError(error)) {
          throw error;
        }

        if (attempt >= this.maxAttempts) {
          throw this.createTimeoutError(error as Error);
        }

        const delayMs: number = this.retryDelayMs * attempt;
        AgentLogger.warn("Anthropic request timed out; retrying", {
          attempt,
          maxAttempts: this.maxAttempts,
          retryDelayMs: delayMs,
        });
        await this.delay(delayMs);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Anthropic request failed without a specific error.");
  }

  private async executeOnce(
    payload: AnthropicChatCompletionRequest,
    attempt: number,
  ): Promise<ChatMessage> {
    const controller: AbortController = new AbortController();
    const timeout: NodeJS.Timeout = setTimeout(() => {
      controller.abort();
    }, this.options.timeoutMs);

    try {
      AgentLogger.debug("Dispatching Anthropic request", {
        endpoint: this.endpoint,
        model: this.options.model,
        messageCount: payload.messages.length,
        toolCount: payload.tools?.length ?? 0,
        temperature: payload.temperature,
        attempt,
        maxAttempts: this.maxAttempts,
      });

      const response: Response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.options.apiKey,
          "anthropic-version": this.version,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody: string = await response.text();
        AgentLogger.error("Anthropic request failed", {
          status: response.status,
          bodyPreview: errorBody.slice(0, 500),
        });
        throw new Error(
          `Anthropic request failed (${response.status}): ${errorBody}`,
        );
      }

      const body: AnthropicResponseBody =
        (await response.json()) as AnthropicResponseBody;
      return this.mapResponseToChatMessage(body);
    } catch (error) {
      AgentLogger.error("Anthropic request error", error as Error);
      throw error;
    } finally {
      clearTimeout(timeout);
      AgentLogger.debug("Anthropic request finalized", {
        attempt,
        maxAttempts: this.maxAttempts,
      });
    }
  }

  private mapResponseToChatMessage(body: AnthropicResponseBody): ChatMessage {
    const textParts: Array<string> = [];
    const toolCalls: Array<OpenAIToolCall> = [];

    for (const block of body.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
        continue;
      }

      if (
        block.type === "tool_use" &&
        typeof block.id === "string" &&
        typeof block.name === "string"
      ) {
        const args: string = JSON.stringify(block.input ?? {});
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: args,
          },
        });
        continue;
      }

      AgentLogger.debug("Unhandled Anthropic content block", { block });
    }

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: textParts.length ? textParts.join("\n") : null,
    };

    if (toolCalls.length) {
      assistantMessage.tool_calls = toolCalls;
    }

    return assistantMessage;
  }

  private mapMessages(messages: Array<ChatMessage>): {
    systemPrompt?: string;
    messages: Array<AnthropicMessage>;
  } {
    const systemParts: Array<string> = [];
    const anthropicMessages: Array<AnthropicMessage> = [];

    for (const message of messages) {
      if (message.role === "system") {
        if (message.content) {
          systemParts.push(message.content);
        }
        continue;
      }

      if (message.role === "tool") {
        anthropicMessages.push(this.toToolResultMessage(message));
        continue;
      }

      anthropicMessages.push(this.toStandardMessage(message));
    }

    const result: { systemPrompt?: string; messages: Array<AnthropicMessage> } = {
      messages: anthropicMessages,
    };

    if (systemParts.length) {
      result.systemPrompt = systemParts.join("\n\n");
    }

    return result;
  }

  private toStandardMessage(message: ChatMessage): AnthropicMessage {
    const role: AnthropicRole = message.role === "assistant" ? "assistant" : "user";
    const contentBlocks: Array<AnthropicContentBlock> = [];

    if (message.content) {
      contentBlocks.push({ type: "text", text: message.content });
    }

    for (const block of this.toToolUseBlocks(message.tool_calls)) {
      contentBlocks.push(block);
    }

    if (!contentBlocks.length) {
      contentBlocks.push({ type: "text", text: "" });
    }

    return { role, content: contentBlocks };
  }

  private toToolResultMessage(message: ChatMessage): AnthropicMessage {
    const toolCallId: string = message.tool_call_id ?? "tool_result";
    const text: string = message.content ?? "";
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolCallId,
          content: [{ type: "text", text }],
        },
      ],
    };
  }

  private toToolUseBlocks(
    calls: Array<OpenAIToolCall> | undefined,
  ): Array<AnthropicContentBlock> {
    if (!calls?.length) {
      return [];
    }

    return calls.map((call: OpenAIToolCall) => {
      return {
        type: "tool_use",
        id: call.id,
        name: call.function.name,
        input: this.safeParseArguments(call.function.arguments),
      };
    });
  }

  private safeParseArguments(raw: string): JSONObject {
    if (!raw) {
      return {};
    }

    try {
      return JSON.parse(raw) as JSONObject;
    } catch (error) {
      AgentLogger.warn("Failed to parse tool arguments; defaulting to {}", {
        raw,
        error,
      });
      return {};
    }
  }

  private isAbortError(error: unknown): boolean {
    if (!error) {
      return false;
    }

    if (error instanceof Error && error.name === "AbortError") {
      return true;
    }

    if (typeof DOMException !== "undefined" && error instanceof DOMException) {
      return error.name === "AbortError";
    }

    return false;
  }

  private async delay(durationMs: number): Promise<void> {
    if (durationMs <= 0) {
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, durationMs);
    });
  }

  private createTimeoutError(originalError: Error): Error {
    const message: string = `Anthropic request timed out after ${this.options.timeoutMs} ms while calling ${this.endpoint}.`;
    return new Error(`${message} Original error: ${originalError.message}`);
  }
}
