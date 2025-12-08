import { fetch, Response } from "undici";
import { LMStudioClient, LMStudioClientOptions } from "./LMStudioClient";
import { ChatMessage, OpenAIToolCall, ToolDefinition } from "../Types";
import { LLMClient } from "./LLMClient";
import AgentLogger from "../Utils/AgentLogger";
import { requiresOpenAIResponsesEndpoint } from "../Utils/OpenAIModel";

export interface OpenAIClientOptions
  extends Omit<LMStudioClientOptions, "endpoint"> {
  endpoint?: string;
}

const CHAT_ENDPOINT: string = "https://api.openai.com/v1/chat/completions";
const RESPONSES_ENDPOINT: string = "https://api.openai.com/v1/responses";
const DEFAULT_MAX_ATTEMPTS: number = 3;
const DEFAULT_RETRY_DELAY_MS: number = 2000;

/**
 * Unified OpenAI client that routes to either the Chat Completions API or the
 * Responses API depending on the selected model.
 */
export class OpenAIClient implements LLMClient {
  private readonly chatClient: LMStudioClient;
  private readonly responsesEndpoint: string;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  public constructor(private readonly options: OpenAIClientOptions) {
    if (!options.apiKey) {
      throw new Error("OpenAI API key is required for the OpenAI provider.");
    }

    const chatEndpoint: string = options.endpoint ?? CHAT_ENDPOINT;
    this.responsesEndpoint = options.endpoint ?? RESPONSES_ENDPOINT;
    this.chatClient = new LMStudioClient({
      ...options,
      endpoint: chatEndpoint,
    });
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  public async createChatCompletion(data: {
    messages: Array<ChatMessage>;
    tools?: Array<ToolDefinition>;
  }): Promise<ChatMessage> {
    if (requiresOpenAIResponsesEndpoint(this.options.model)) {
      return await this.createResponsesCompletion(data);
    }

    return await this.chatClient.createChatCompletion(data);
  }

  private async createResponsesCompletion(data: {
    messages: Array<ChatMessage>;
    tools?: Array<ToolDefinition>;
  }): Promise<ChatMessage> {
    const payload: ResponsesRequestPayload = this.buildResponsesPayload(
      data.messages,
      data.tools,
    );
    return await this.executeWithRetries(payload);
  }

  private mapMessagesToInput(messages: Array<ChatMessage>): Array<ResponsesMessage> {
    return messages.map((message: ChatMessage) => ({
      role: this.mapRoleToResponsesRole(message.role),
      content: this.createContentBlocksForMessage(message),
    }));
  }

  private async executeWithRetries(payload: ResponsesRequestPayload): Promise<ChatMessage> {
    let lastError: unknown;

    for (let attempt: number = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.executeResponsesRequest(payload, attempt);
      } catch (error) {
        lastError = error;
        if (!this.isAbortError(error)) {
          throw error;
        }

        if (attempt === this.maxAttempts) {
          throw this.createTimeoutError(error as Error);
        }

        await this.performRetryDelay(attempt);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("OpenAI Responses request failed without a specific error.");
  }

  private async executeResponsesRequest(
    payload: ResponsesRequestPayload,
    attempt: number,
  ): Promise<ChatMessage> {
    const controller: AbortController = new AbortController();
    const timeout: NodeJS.Timeout | null = this.createAbortTimeout(controller);

    try {
      AgentLogger.debug("Dispatching OpenAI Responses request", {
        endpoint: this.responsesEndpoint,
        model: this.options.model,
        messageCount: payload.input.length,
        toolCount: payload.tools?.length ?? 0,
        temperature: payload.temperature,
        attempt,
        maxAttempts: this.maxAttempts,
      });

      const response: Response = await fetch(this.responsesEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody: string = await response.text();
        AgentLogger.error("OpenAI Responses request failed", {
          status: response.status,
          bodyPreview: errorBody.slice(0, 500),
        });
        throw new Error(
          `OpenAI Responses request failed (${response.status}): ${errorBody}`,
        );
      }

      const body: OpenAIResponsesAPIResponse =
        (await response.json()) as OpenAIResponsesAPIResponse;
      return this.mapResponsesToChatMessage(body);
    } catch (error) {
      AgentLogger.error("OpenAI Responses request error", error as Error);
      throw error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      AgentLogger.debug("OpenAI Responses request finalized", {
        attempt,
        maxAttempts: this.maxAttempts,
      });
    }
  }

  private mapResponsesToChatMessage(body: OpenAIResponsesAPIResponse): ChatMessage {
    const outputMessage: ResponsesOutputMessage = this.extractOutputMessage(body);
    const { textParts, toolCalls } = this.extractOutputContent(outputMessage);

    const message: ChatMessage = {
      role: "assistant",
      content: textParts.length ? textParts.join("\n") : null,
    };

    if (toolCalls.length) {
      message.tool_calls = toolCalls;
    }

    return message;
  }

  private buildResponsesPayload(
    messages: Array<ChatMessage>,
    tools?: Array<ToolDefinition>,
  ): ResponsesRequestPayload {
    const hasTools: boolean = Boolean(tools?.length);
    return {
      model: this.options.model,
      input: this.mapMessagesToInput(messages),
      temperature: this.options.temperature,
      ...(hasTools
        ? {
            tool_choice: "auto",
            tools: this.mapToolsToResponsesDefinitions(tools ?? []),
          }
        : {}),
    };
  }

  private mapToolsToResponsesDefinitions(
    tools: Array<ToolDefinition>,
  ): Array<ResponsesToolDefinition> {
    return tools.map((tool: ToolDefinition) => {
      return {
        type: tool.type,
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      };
    });
  }

  private mapRoleToResponsesRole(role: ChatMessage["role"]): ResponsesMessage["role"] {
    return (role === "tool" ? "user" : role) as ResponsesMessage["role"];
  }

  private createContentBlocksForMessage(message: ChatMessage): Array<ResponsesContentBlock> {
    if (message.role === "tool") {
      return [
        {
          type: "tool_result",
          tool_call_id: message.tool_call_id ?? "tool_call",
          output: message.content ?? "",
        },
      ];
    }

    if (message.content !== null) {
      return [
        {
          type: message.role === "assistant" ? "output_text" : "input_text",
          text: message.content,
        },
      ];
    }

    return [
      {
        type: message.role === "assistant" ? "output_text" : "input_text",
        text: "",
      },
    ];
  }

  private async performRetryDelay(attempt: number): Promise<void> {
    const delayMs: number = this.retryDelayMs * attempt;
    AgentLogger.warn("OpenAI Responses request timed out; retrying", {
      attempt,
      maxAttempts: this.maxAttempts,
      retryDelayMs: delayMs,
    });
    await this.delay(delayMs);
  }

  private createAbortTimeout(controller: AbortController): NodeJS.Timeout | null {
    if (!this.options.timeoutMs || this.options.timeoutMs <= 0) {
      return null;
    }

    return setTimeout(() => {
      controller.abort();
    }, this.options.timeoutMs);
  }

  private extractOutputMessage(
    body: OpenAIResponsesAPIResponse,
  ): ResponsesOutputMessage {
    const outputMessage: ResponsesOutputMessage | undefined = body.output?.[0];
    if (!outputMessage) {
      throw new Error("OpenAI Responses API returned no output message");
    }

    return outputMessage;
  }

  private extractOutputContent(
    outputMessage: ResponsesOutputMessage,
  ): {
    textParts: Array<string>;
    toolCalls: Array<OpenAIToolCall>;
  } {
    const textParts: Array<string> = [];
    const toolCalls: Array<OpenAIToolCall> = [];

    for (const block of outputMessage.content) {
      if (block.type === "output_text") {
        textParts.push(block.text ?? "");
        continue;
      }

      if (block.type === "tool_use") {
        toolCalls.push(this.mapToolUseBlock(block));
      }
    }

    if (outputMessage.tool_calls?.length) {
      toolCalls.push(...outputMessage.tool_calls);
    }

    return { textParts, toolCalls };
  }

  private mapToolUseBlock(block: ResponsesToolUseBlock): OpenAIToolCall {
    return {
      id: block.id,
      type: "function",
      function: {
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
      },
    };
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
    const message: string = `OpenAI Responses request timed out after ${this.options.timeoutMs} ms while calling ${this.responsesEndpoint}.`;
    return new Error(`${message} Original error: ${originalError.message}`);
  }
}

interface ResponsesContentBlockBase {
  type: string;
}

interface ResponsesTextBlock extends ResponsesContentBlockBase {
  type: "input_text" | "output_text";
  text: string;
}

interface ResponsesToolResultBlock extends ResponsesContentBlockBase {
  type: "tool_result";
  tool_call_id: string;
  output: string;
}

interface ResponsesToolUseBlock extends ResponsesContentBlockBase {
  type: "tool_use";
  id: string;
  name: string;
  input?: unknown;
}

interface ResponsesMessage {
  role: "system" | "user" | "assistant";
  content: Array<ResponsesContentBlock>;
}

type ResponsesContentBlock =
  | ResponsesTextBlock
  | ResponsesToolResultBlock
  | ResponsesToolUseBlock;

interface ResponsesRequestPayload {
  model: string;
  input: Array<ResponsesMessage>;
  temperature: number;
  tool_choice?: "auto" | undefined;
  tools?: Array<ResponsesToolDefinition> | undefined;
}

interface ResponsesOutputMessage {
  role: "assistant";
  content: Array<ResponsesContentBlock>;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface OpenAIResponsesAPIResponse {
  output?: Array<ResponsesOutputMessage>;
}

interface ResponsesToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: ToolDefinition["function"]["parameters"];
}
