import { ChatMessage, ToolDefinition } from "../Types";

/** Interface implemented by all chat completion clients. */
export interface LLMClient {
  createChatCompletion(data: {
    messages: Array<ChatMessage>;
    tools?: Array<ToolDefinition>;
  }): Promise<ChatMessage>;
}
