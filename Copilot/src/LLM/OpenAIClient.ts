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

  private mapMessagesToInput(
    messages: Array<ChatMessage>,
  ): Array<ResponsesMessage> {
    return messages.map((message: ChatMessage) => {
      return {
        role: this.mapRoleToResponsesRole(message.role),
        content: this.createContentBlocksForMessage(message),
      };
    });
  }

  private async executeWithRetries(
    payload: ResponsesRequestPayload,
  ): Promise<ChatMessage> {
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

  private mapResponsesToChatMessage(
    body: OpenAIResponsesAPIResponse,
  ): ChatMessage {
    const outputItems: Array<ResponsesOutputItem> = Array.isArray(body.output)
      ? (body.output as Array<ResponsesOutputItem>)
      : [];
    const textParts: Array<string> = [];
    const toolCalls: Array<OpenAIToolCall> = [];

    for (const item of outputItems) {
      if (!item || typeof item !== "object") {
        continue;
      }

      if (item.type === "message" || this.isMessageOutput(item)) {
        const messageItem: ResponsesOutputMessage =
          item as ResponsesOutputMessage;
        const { textParts: messageTextParts, toolCalls: messageToolCalls } =
          this.extractOutputContent(messageItem);
        if (messageTextParts.length) {
          textParts.push(...messageTextParts);
        }
        if (messageToolCalls.length) {
          toolCalls.push(...messageToolCalls);
        }
        continue;
      }

      if (this.isFunctionCallOutput(item)) {
        const mappedCall: OpenAIToolCall | null =
          this.mapFunctionCallOutput(item);
        if (mappedCall) {
          toolCalls.push(mappedCall);
        }
      }
    }

    if (!textParts.length) {
      const fallbackText: Array<string> = this.extractFallbackOutputText(body);
      if (fallbackText.length) {
        textParts.push(...fallbackText);
      }
    }

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
    const payload: ResponsesRequestPayload = {
      model: this.options.model,
      input: this.mapMessagesToInput(messages),
      ...(hasTools
        ? {
            tool_choice: "auto",
            tools: this.mapToolsToResponsesDefinitions(tools ?? []),
          }
        : {}),
    };

    return payload;
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

  private mapRoleToResponsesRole(
    role: ChatMessage["role"],
  ): ResponsesMessage["role"] {
    return (role === "tool" ? "user" : role) as ResponsesMessage["role"];
  }

  private createContentBlocksForMessage(
    message: ChatMessage,
  ): Array<ResponsesContentBlock> {
    if (message.role === "tool") {
      return [
        {
          type: "input_text",
          text: this.formatToolResult(message),
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

  private formatToolResult(message: ChatMessage): string {
    const prefix: string = message.tool_call_id
      ? `Tool ${message.tool_call_id} result:`
      : "Tool result:";
    return `${prefix}\n${message.content ?? ""}`.trimEnd();
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

  private createAbortTimeout(
    controller: AbortController,
  ): NodeJS.Timeout | null {
    if (!this.options.timeoutMs || this.options.timeoutMs <= 0) {
      return null;
    }

    return setTimeout(() => {
      controller.abort();
    }, this.options.timeoutMs);
  }

  private extractFallbackOutputText(
    body: OpenAIResponsesAPIResponse,
  ): Array<string> {
    if (!Array.isArray(body.output_text)) {
      return [];
    }

    return body.output_text.filter((chunk: unknown) => {
      return typeof chunk === "string" && chunk.length > 0;
    });
  }

  private mapFunctionCallOutput(
    item: ResponsesFunctionCallOutput,
  ): OpenAIToolCall | null {
    if (!item.name) {
      return null;
    }

    const args: string =
      typeof item.arguments === "string"
        ? item.arguments
        : JSON.stringify(item.arguments ?? {});
    const identifier: string =
      item.call_id ??
      item.id ??
      `function_call_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return {
      id: identifier,
      type: "function",
      function: {
        name: item.name,
        arguments: args,
      },
    };
  }

  private isMessageOutput(
    item: ResponsesOutputItem,
  ): item is ResponsesOutputMessage {
    if (!item || typeof item !== "object") {
      return false;
    }

    return Array.isArray((item as ResponsesOutputMessage).content);
  }

  private isFunctionCallOutput(
    item: ResponsesOutputItem,
  ): item is ResponsesFunctionCallOutput {
    if (!item || typeof item !== "object") {
      return false;
    }

    return (item as ResponsesFunctionCallOutput).type === "function_call";
  }

  private extractOutputContent(outputMessage: ResponsesOutputMessage): {
    textParts: Array<string>;
    toolCalls: Array<OpenAIToolCall>;
  } {
    const textParts: Array<string> = [];
    const toolCalls: Array<OpenAIToolCall> = [];
    const contentBlocks: Array<ResponsesContentBlock> = Array.isArray(
      outputMessage.content,
    )
      ? outputMessage.content
      : [];

    for (const block of contentBlocks) {
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

type ResponsesContentBlock = ResponsesTextBlock | ResponsesToolUseBlock;

interface ResponsesRequestPayload {
  model: string;
  input: Array<ResponsesMessage>;
  tool_choice?: "auto" | undefined;
  tools?: Array<ResponsesToolDefinition> | undefined;
}

interface ResponsesOutputMessage {
  type?: "message";
  role: "system" | "user" | "assistant";
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

interface ResponsesFunctionCallOutput {
  type: "function_call";
  id?: string;
  call_id?: string;
  name: string;
  arguments?: unknown;
  status?: string;
}

type ResponsesOutputItem =
  | ResponsesOutputMessage
  | ResponsesFunctionCallOutput
  | { type?: string; [key: string]: unknown };

interface OpenAIResponsesAPIResponse {
  output?: Array<ResponsesOutputItem>;
  output_text?: Array<string>;
}

interface ResponsesToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: ToolDefinition["function"]["parameters"];
}
