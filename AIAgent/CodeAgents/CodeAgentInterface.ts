import LlmType from "Common/Types/LLM/LlmType";
import TaskLogger from "../Utils/TaskLogger";

// Configuration for the LLM provider
export interface CodeAgentLLMConfig {
  llmType: LlmType;
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
}

// The task to be executed by the code agent
export interface CodeAgentTask {
  workingDirectory: string;
  prompt: string;
  context?: string;
  timeoutMs?: number;
  servicePath?: string; // Path within the repo where the service code lives
}

// Result from the code agent execution
export interface CodeAgentResult {
  success: boolean;
  filesModified: Array<string>;
  summary: string;
  logs: Array<string>;
  error?: string;
  exitCode?: number;
}

// Progress event from the code agent
export interface CodeAgentProgressEvent {
  type: "stdout" | "stderr" | "status";
  message: string;
  timestamp: Date;
}

// Callback type for progress events
export type CodeAgentProgressCallback = (
  event: CodeAgentProgressEvent,
) => void | Promise<void>;

// Abstract interface for code agents
// This allows us to support multiple agents (OpenCode, Goose, Claude Code, etc.)
export interface CodeAgent {
  // Name of the agent (e.g., "OpenCode", "Goose", "ClaudeCode")
  readonly name: string;

  // Initialize the agent with LLM configuration
  initialize(
    config: CodeAgentLLMConfig,
    logger?: TaskLogger,
  ): Promise<void>;

  // Execute a task and return the result
  executeTask(task: CodeAgentTask): Promise<CodeAgentResult>;

  // Set a callback for progress events (streaming output)
  onProgress(callback: CodeAgentProgressCallback): void;

  // Check if the agent is available on the system
  isAvailable(): Promise<boolean>;

  // Abort the current task execution
  abort(): Promise<void>;

  // Clean up any resources used by the agent
  cleanup(): Promise<void>;
}

// Enum for supported code agent types
export enum CodeAgentType {
  OpenCode = "OpenCode",
  // Future agents:
  // Goose = "Goose",
  // ClaudeCode = "ClaudeCode",
  // Aider = "Aider",
}

// Helper function to get display name for agent type
export function getCodeAgentDisplayName(type: CodeAgentType): string {
  switch (type) {
    case CodeAgentType.OpenCode:
      return "OpenCode AI";
    default:
      return type;
  }
}

// Helper function to check if an agent type is valid
export function isValidCodeAgentType(type: string): type is CodeAgentType {
  return Object.values(CodeAgentType).includes(type as CodeAgentType);
}
