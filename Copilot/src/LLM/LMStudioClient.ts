import { fetch, Response } from "undici";
import { ChatMessage, ToolDefinition } from "../Types";
import { LLMClient } from "./LLMClient";
import AgentLogger from "../Utils/AgentLogger";

const DEFAULT_MAX_ATTEMPTS: number = 3;
const DEFAULT_RETRY_DELAY_MS: number = 2000;

/**
 * Chat message payload in the minimal form accepted by the LM Studio API.
 */
type SerializableMessage = Omit<ChatMessage, "tool_calls"> & {
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

/**
 * Wire format expected by LM Studio's OpenAI-compatible chat completions API.
 */
interface ChatCompletionRequestPayload {
  model: string;
  messages: Array<SerializableMessage>;
  temperature: number;
  tool_choice: "auto";
  tools?: Array<ToolDefinition>;
}

/**
 * Subset of the OpenAI chat completions response returned by LM Studio.
 */
interface OpenAIChatCompletionResponse {
  choices: Array<{
    index: number;
    finish_reason: string;
    message: {
      role: "assistant";
      content: unknown;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Options controlling how the local LM Studio endpoint is contacted.
 */
export interface LMStudioClientOptions {
  endpoint: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  apiKey?: string | undefined;
  maxAttempts?: number;
  retryDelayMs?: number;
}

/**
 * Thin wrapper around fetch that speaks LM Studio's OpenAI-compatible API.
 */
export class LMStudioClient implements LLMClient {
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  /**
   * Persists the endpoint configuration for future chat completion requests.
   */
  public constructor(private readonly options: LMStudioClientOptions) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  /**
   * Submits the provided chat history plus tool metadata and returns the
   * assistant's reply (with optional tool calls).
   */
  public async createChatCompletion(data: {
    messages: Array<ChatMessage>;
    tools?: Array<ToolDefinition>;
  }): Promise<ChatMessage> {
    let attempt: number = 0;
    let lastError: unknown;

    while (attempt < this.maxAttempts) {
      attempt += 1;
      try {
        return await this.executeChatCompletionAttempt(data, attempt);
      } catch (error) {
        lastError = error;
        if (!this.isAbortError(error)) {
          throw error;
        }

        if (attempt >= this.maxAttempts) {
          throw this.createTimeoutError(error as Error);
        }

        const delayMs: number = this.retryDelayMs * attempt;
        AgentLogger.warn("LLM request timed out; retrying", {
          attempt,
          maxAttempts: this.maxAttempts,
          retryDelayMs: delayMs,
        });
        await this.delay(delayMs);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("LLM request failed without a specific error.");
  }

  private async executeChatCompletionAttempt(
    data: {
      messages: Array<ChatMessage>;
      tools?: Array<ToolDefinition>;
    },
    attempt: number,
  ): Promise<ChatMessage> {
    const controller: AbortController = new AbortController();
    const timeout: NodeJS.Timeout = setTimeout(() => {
      controller.abort();
    }, this.options.timeoutMs);

    try {
      AgentLogger.debug("Dispatching LLM request", {
        endpoint: this.options.endpoint,
        model: this.options.model,
        messageCount: data.messages.length,
        toolCount: data.tools?.length ?? 0,
        temperature: this.options.temperature,
        attempt,
        maxAttempts: this.maxAttempts,
      });
      const payload: ChatCompletionRequestPayload = {
        model: this.options.model,
        messages: data.messages.map((message: ChatMessage) => {
          const serialized: SerializableMessage = {
            role: message.role,
            content: message.content,
          };

          if (message.name !== undefined) {
            serialized.name = message.name;
          }

          if (message.tool_call_id !== undefined) {
            serialized.tool_call_id = message.tool_call_id;
          }

          if (message.tool_calls !== undefined) {
            serialized.tool_calls = message.tool_calls;
          }

          return serialized;
        }),
        temperature: this.options.temperature,
        tool_choice: "auto",
        ...(data.tools !== undefined ? { tools: data.tools } : {}),
      };
      AgentLogger.debug("LLM payload prepared", {
        messageRoles: data.messages.map((message: ChatMessage) => {
          return message.role;
        }),
        toolNames: data.tools?.map((tool: ToolDefinition) => {
          return tool.function.name;
        }),
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (this.options.apiKey) {
        headers["Authorization"] = `Bearer ${this.options.apiKey}`;
      }

      const response: Response = await fetch(this.options.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody: string = await response.text();
        AgentLogger.error("LLM request failed", {
          status: response.status,
          bodyPreview: errorBody.slice(0, 500),
        });
        throw new Error(
          `LLM request failed (${response.status}): ${errorBody}`,
        );
      }

      const body: OpenAIChatCompletionResponse =
        (await response.json()) as OpenAIChatCompletionResponse;
      AgentLogger.debug("LLM request succeeded", {
        tokenUsage: body.usage,
        choiceCount: body.choices?.length ?? 0,
      });

      if (!body.choices?.length) {
        throw new Error("LLM returned no choices");
      }

      const assistantMessage:
        | OpenAIChatCompletionResponse["choices"][number]["message"]
        | undefined = body.choices[0]?.message;
      if (!assistantMessage) {
        throw new Error("LLM response missing assistant message");
      }

      const assistantResponse: ChatMessage = {
        role: "assistant",
        content: this.normalizeContent(assistantMessage.content),
      };

      if (assistantMessage.tool_calls !== undefined) {
        assistantResponse.tool_calls = assistantMessage.tool_calls;
      }

      return assistantResponse;
    } catch (error) {
      AgentLogger.error("LLM request error", error as Error);
      throw error;
    } finally {
      clearTimeout(timeout);
      AgentLogger.debug("LLM request finalized", {
        attempt,
        maxAttempts: this.maxAttempts,
      });
    }
  }

  /**
   * Normalizes the flexible OpenAI `content` format into a simple string the
   * rest of the agent expects.
   */
  private normalizeContent(content: unknown): string | null {
    if (typeof content === "string" || content === null) {
      return content;
    }

    if (!content) {
      return null;
    }

    if (Array.isArray(content)) {
      return content
        .map((item: unknown) => {
          if (typeof item === "string") {
            return item;
          }
          if (
            typeof item === "object" &&
            item !== null &&
            "text" in item &&
            typeof (item as { text?: unknown }).text === "string"
          ) {
            return (item as { text: string }).text;
          }
          return JSON.stringify(item);
        })
        .join("\n");
    }

    if (typeof content === "object") {
      return JSON.stringify(content);
    }

    return String(content);
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
    const message: string = `LLM request timed out after ${this.options.timeoutMs} ms while calling ${this.options.endpoint}. Increase the --timeout flag or ensure the endpoint is reachable.`;
    return new Error(`${message} Original error: ${originalError.message}`);
  }
}
