import LogSeverity from "../Log/LogSeverity";

// Individual log entry for AI Agent Task logs
export interface AIAgentTaskLogEntry {
  severity: LogSeverity;
  logAt: Date;
  message: string;
}

// Type for the logs array
export type AIAgentTaskLogEntries = Array<AIAgentTaskLogEntry>;
