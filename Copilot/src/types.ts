import { JSONObject } from "Common/Types/JSON";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  name?: string | undefined;
  tool_call_id?: string | undefined;
  tool_calls?: Array<OpenAIToolCall> | undefined;
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JSONObject;
  };
}

export interface ToolExecutionResult {
  toolCallId: string;
  output: string;
}
