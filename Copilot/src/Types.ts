import { JSONObject } from "Common/Types/JSON";

/** Allowed OpenAI chat roles encountered by the agent. */
export type ChatRole = "system" | "user" | "assistant" | "tool";

/** Serialized chat message exchanged between the agent and the LLM. */
export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  name?: string | undefined;
  tool_call_id?: string | undefined;
  tool_calls?: Array<OpenAIToolCall> | undefined;
}

/** Raw tool call instructions returned by the LLM. */
export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** Description of a tool exposed to the LLM via function calling. */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JSONObject;
  };
}

/** Wrapper used when reporting tool execution results back to the agent loop. */
export interface ToolExecutionResult {
  toolCallId: string;
  output: string;
}
