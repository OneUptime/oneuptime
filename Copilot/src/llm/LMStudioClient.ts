import { fetch, Response } from "undici";
import { ChatMessage, ToolDefinition } from "../types";
import AgentLogger from "../utils/AgentLogger";

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
  apiKey?: string | undefined;
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
      AgentLogger.debug("Dispatching LLM request", {
        endpoint: this.options.endpoint,
        model: this.options.model,
        messageCount: data.messages.length,
        toolCount: data.tools?.length ?? 0,
        temperature: this.options.temperature,
      });
      const payload = {
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
        tools: data.tools,
      };
      AgentLogger.debug("LLM payload prepared", {
        messageRoles: data.messages.map((message) => {
          return message.role;
        }),
        toolNames: data.tools?.map((tool) => {
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

      const body = (await response.json()) as OpenAIChatCompletionResponse;
      AgentLogger.debug("LLM request succeeded", {
        tokenUsage: body.usage,
        choiceCount: body.choices?.length ?? 0,
      });

      if (!body.choices?.length) {
        throw new Error("LLM returned no choices");
      }

      const assistantMessage = body.choices[0]?.message;
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
      AgentLogger.debug("LLM request finalized");
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
