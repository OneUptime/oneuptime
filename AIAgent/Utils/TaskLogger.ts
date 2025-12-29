import { ONEUPTIME_URL } from "../Config";
import AIAgentAPIRequest from "./AIAgentAPIRequest";
import URL from "Common/Types/API/URL";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";

export interface TaskLoggerOptions {
  taskId: string;
  context?: string;
  batchSize?: number;
  flushIntervalMs?: number;
}

interface LogEntry {
  severity: LogSeverity;
  message: string;
  timestamp: Date;
}

export default class TaskLogger {
  private taskId: string;
  private context: string | undefined;
  private logBuffer: Array<LogEntry> = [];
  private batchSize: number;
  private flushIntervalMs: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private createLogUrl: URL | null = null;

  public constructor(options: TaskLoggerOptions) {
    this.taskId = options.taskId;
    this.context = options.context;
    this.batchSize = options.batchSize || 10;
    this.flushIntervalMs = options.flushIntervalMs || 5000; // 5 seconds default

    // Start periodic flush timer
    this.startFlushTimer();
  }

  private getCreateLogUrl(): URL {
    if (!this.createLogUrl) {
      this.createLogUrl = URL.fromString(ONEUPTIME_URL.toString()).addRoute(
        "/api/ai-agent-task-log/create-log",
      );
    }
    return this.createLogUrl;
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch((err: Error) => {
        logger.error(`Error flushing logs: ${err.message}`);
      });
    }, this.flushIntervalMs);
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private formatMessage(
    severity: LogSeverity,
    message: string,
    timestamp: Date,
  ): string {
    const timestampStr: string = OneUptimeDate.toDateTimeLocalString(timestamp);
    const severityStr: string = severity.toUpperCase().padEnd(7);
    const contextStr: string = this.context ? `[${this.context}] ` : "";

    return `[${timestampStr}] [${severityStr}] ${contextStr}${message}`;
  }

  private addToBuffer(severity: LogSeverity, message: string): void {
    const entry: LogEntry = {
      severity,
      message,
      timestamp: OneUptimeDate.getCurrentDate(),
    };

    this.logBuffer.push(entry);

    // Also log locally for debugging
    logger.debug(
      `[Task ${this.taskId}] ${this.formatMessage(entry.severity, entry.message, entry.timestamp)}`,
    );

    // Auto-flush if buffer is full
    if (this.logBuffer.length >= this.batchSize) {
      this.flush().catch((err: Error) => {
        logger.error(`Error auto-flushing logs: ${err.message}`);
      });
    }
  }

  private async sendLogToServer(
    severity: LogSeverity,
    message: string,
  ): Promise<boolean> {
    try {
      const result: HTTPResponse<JSONObject> = await API.post({
        url: this.getCreateLogUrl(),
        data: {
          ...AIAgentAPIRequest.getDefaultRequestBody(),
          taskId: this.taskId,
          severity: severity,
          message: message,
        },
      });

      if (!result.isSuccess()) {
        logger.error(`Failed to send log for task ${this.taskId}`);
        return false;
      }

      return true;
    } catch (error) {
      logger.error(`Error sending log for task ${this.taskId}:`);
      logger.error(error);
      return false;
    }
  }

  // Public logging methods
  public async debug(message: string): Promise<void> {
    this.addToBuffer(LogSeverity.Debug, message);
  }

  public async info(message: string): Promise<void> {
    this.addToBuffer(LogSeverity.Information, message);
  }

  public async warning(message: string): Promise<void> {
    this.addToBuffer(LogSeverity.Warning, message);
  }

  public async error(message: string): Promise<void> {
    this.addToBuffer(LogSeverity.Error, message);
    // Immediately flush on errors
    await this.flush();
  }

  public async trace(message: string): Promise<void> {
    this.addToBuffer(LogSeverity.Trace, message);
  }

  // Log output from external processes like OpenCode
  public async logProcessOutput(
    processName: string,
    output: string,
  ): Promise<void> {
    const lines: Array<string> = output.split("\n").filter((line: string) => {
      return line.trim().length > 0;
    });

    for (const line of lines) {
      this.addToBuffer(LogSeverity.Information, `[${processName}] ${line}`);
    }
  }

  // Log a code block (useful for stack traces, code snippets, etc.)
  public async logCodeBlock(
    title: string,
    code: string,
    severity: LogSeverity = LogSeverity.Information,
  ): Promise<void> {
    const formattedCode: string = `${title}:\n\`\`\`\n${code}\n\`\`\``;
    this.addToBuffer(severity, formattedCode);
  }

  // Flush all buffered logs to the server
  public async flush(): Promise<void> {
    if (this.logBuffer.length === 0) {
      return;
    }

    // Get all entries and clear buffer
    const entries: Array<LogEntry> = [...this.logBuffer];
    this.logBuffer = [];

    // Send each log entry separately to preserve individual log lines
    for (const entry of entries) {
      const formattedMessage: string = this.formatMessage(
        entry.severity,
        entry.message,
        entry.timestamp,
      );
      await this.sendLogToServer(entry.severity, formattedMessage);
    }
  }

  // Cleanup method - call when task is done
  public async dispose(): Promise<void> {
    this.stopFlushTimer();
    await this.flush();
  }

  // Helper methods for common log patterns
  public async logStepStart(stepName: string): Promise<void> {
    await this.info(`Starting: ${stepName}`);
  }

  public async logStepComplete(stepName: string): Promise<void> {
    await this.info(`Completed: ${stepName}`);
  }

  public async logStepFailed(stepName: string, error: string): Promise<void> {
    await this.error(`Failed: ${stepName} - ${error}`);
  }

  // Create a child logger with additional context
  public createChildLogger(childContext: string): TaskLogger {
    const fullContext: string = this.context
      ? `${this.context}:${childContext}`
      : childContext;

    return new TaskLogger({
      taskId: this.taskId,
      context: fullContext,
      batchSize: this.batchSize,
      flushIntervalMs: this.flushIntervalMs,
    });
  }
}
