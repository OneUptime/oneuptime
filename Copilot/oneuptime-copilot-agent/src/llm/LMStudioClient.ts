import logger from "Common/Server/Utils/Logger";
import { fetch, Response } from "undici";
import { ChatMessage, ToolDefinition } from "../types";

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

export interface LMStudioClientOptions {
  endpoint: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  apiKey?: string;
}

export class LMStudioClient {
  public constructor(private readonly options: LMStudioClientOptions) {}

  public async createChatCompletion(data: {
    messages: Array<ChatMessage>;
    tools?: Array<ToolDefinition>;
  }): Promise<ChatMessage> {
    const controller: AbortController = new AbortController();
    const timeout: NodeJS.Timeout = setTimeout(() => {
      controller.abort();
    }, this.options.timeoutMs);

    try {
      const payload = {
        model: this.options.model,
        messages: data.messages.map((message: ChatMessage) => {
          return {
            role: message.role,
            content: message.content,
            name: message.name,
            tool_call_id: message.tool_call_id,
            tool_calls: message.tool_calls,
          } satisfies SerializableMessage;
        }),
        temperature: this.options.temperature,
        tool_choice: "auto",
        tools: data.tools,
      };

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
        throw new Error(
          `LLM request failed (${response.status}): ${errorBody}`,
        );
      }

      const body = (await response.json()) as OpenAIChatCompletionResponse;

      if (!body.choices?.length) {
        throw new Error("LLM returned no choices");
      }

      const assistantMessage = body.choices[0]?.message;
      if (!assistantMessage) {
        throw new Error("LLM response missing assistant message");
      }

      return {
        role: "assistant",
        content: this.normalizeContent(assistantMessage.content),
        tool_calls: assistantMessage.tool_calls,
      };
    } catch (error) {
      logger.error("LLM request failed");
      logger.error(error);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeContent(content: unknown): string | null {
    if (typeof content === "string" || content === null) {
      return content;
    }

    if (!content) {
      return null;
    }

    if (Array.isArray(content)) {
      return content
        .map((item: any) => {
          if (typeof item === "string") {
            return item;
          }
          if (item && typeof item.text === "string") {
            return item.text;
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
}
