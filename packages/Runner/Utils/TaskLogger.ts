import { ONEUPTIME_BASE_URL } from "../Config";
import RunnerAPIRequest from "./RunnerAPIRequest";
import URL from "Common/Types/API/URL";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import SecretRedactor from "./SecretRedactor";

/*
 * How long a line waits before it is sent: long enough that the lines a
 * step writes together (a tool call, the note after it) go together, short
 * enough that the step reaches the task's page as it happens - the server
 * announces every line to the pages open on the run (CodeTaskLive). Lines
 * used to wait for a five-second timer.
 */
export const DEFAULT_LOG_SEND_DELAY_MS: number = 250;

/*
 * The lines of one task, sent one at a time and in the order they were
 * written, whichever of the task's loggers wrote them: the server numbers
 * a run's lines as they arrive, so two sent at once could swap places.
 */
export interface TaskLogSendQueue {
  tail: Promise<void>;
}

export interface TaskLoggerOptions {
  taskId: string;
  context?: string;
  // Lines that are sent at once, without waiting, when this many wait.
  batchSize?: number;
  /*
   * The longest a written line waits before it is sent
   * (DEFAULT_LOG_SEND_DELAY_MS). An error line is sent at once.
   */
  flushIntervalMs?: number;
  // A child logger's: its parent's queue (createChildLogger).
  sendQueue?: TaskLogSendQueue | undefined;
}

interface LogEntry {
  severity: LogSeverity;
  message: string;
  timestamp: Date;
  /*
   * Optional verbatim tool detail. The message is the one-line narration
   * ("read src/Index.ts"); this is the full arguments and output behind it,
   * which the server stores on the run's transcript (AIRunEvent.contentPayload)
   * for the Logs page. Server-side ACLs decide who may read it back — see
   * AIRunEventContentPayload.
   */
  toolName?: string | undefined;
  toolArguments?: JSONObject | undefined;
  toolResult?: string | undefined;
}

export default class TaskLogger {
  private taskId: string;
  private context: string | undefined;
  private logBuffer: Array<LogEntry> = [];
  private batchSize: number;
  private flushIntervalMs: number;
  /*
   * Set while lines wait to be sent, and only then: a logger with nothing
   * to send keeps no timer, so one that is never disposed wakes nothing.
   */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private sendQueue: TaskLogSendQueue;
  private createLogUrl: URL | null = null;

  public constructor(options: TaskLoggerOptions) {
    this.taskId = options.taskId;
    this.context = options.context;
    this.batchSize = options.batchSize || 10;
    this.flushIntervalMs = options.flushIntervalMs || DEFAULT_LOG_SEND_DELAY_MS;
    this.sendQueue = options.sendQueue || { tail: Promise.resolve() };
  }

  private getCreateLogUrl(): URL {
    if (!this.createLogUrl) {
      this.createLogUrl = URL.fromString(
        ONEUPTIME_BASE_URL.toString(),
      ).addRoute("/api/ai-agent-task-log/create-log");
    }
    return this.createLogUrl;
  }

  // Sends what waits once the line just written has waited flushIntervalMs.
  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;

      this.flush().catch((err: Error) => {
        logger.error(`Error flushing logs: ${err.message}`);
      });
    }, this.flushIntervalMs);
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
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

  private addToBuffer(
    severity: LogSeverity,
    message: string,
    toolDetail?: {
      toolName: string;
      toolArguments?: JSONObject | undefined;
      toolResult?: string | undefined;
    },
  ): void {
    /*
     * Redact at the boundary, once, for everything.
     *
     * Everything added here is persisted server-side and rendered on the
     * run's Logs page: the narration, the verbatim tool arguments, and the
     * verbatim tool output the model saw. That output includes whatever a
     * model-composed shell command printed, and callers pass raw git error
     * messages straight through. Scrubbing here means no future caller can
     * forget to — and the redacted copy is the only one that leaves the
     * process.
     */
    const entry: LogEntry = {
      severity,
      message: SecretRedactor.redact(message),
      timestamp: OneUptimeDate.getCurrentDate(),
      ...(toolDetail
        ? {
            toolName: toolDetail.toolName,
            toolArguments: SecretRedactor.redactJSON(toolDetail.toolArguments),
            toolResult:
              toolDetail.toolResult === undefined
                ? undefined
                : SecretRedactor.redact(toolDetail.toolResult),
          }
        : {}),
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
      return;
    }

    // Otherwise in a moment, with whatever else is written meanwhile.
    this.scheduleFlush();
  }

  private async sendLogToServer(entry: LogEntry): Promise<boolean> {
    try {
      const result: HTTPResponse<JSONObject> = await API.post({
        url: this.getCreateLogUrl(),
        data: {
          ...RunnerAPIRequest.getDefaultRequestBody(),
          taskId: this.taskId,
          severity: entry.severity,
          message: entry.message,
          ...(entry.toolName ? { toolName: entry.toolName } : {}),
          ...(entry.toolArguments
            ? { toolArguments: entry.toolArguments }
            : {}),
          ...(entry.toolResult !== undefined
            ? { toolResult: entry.toolResult }
            : {}),
        },
        options: RunnerAPIRequest.getDefaultRequestOptions(),
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

  /*
   * Narrate one tool call AND ship the verbatim detail behind it: the
   * arguments as executed and the full output the model saw. The one-line
   * message is what the activity feed renders; the detail is what the Logs
   * page shows when you need to know why the model did what it did next.
   */
  public async toolCall(data: {
    toolName: string;
    message: string;
    toolArguments?: JSONObject | undefined;
    toolResult?: string | undefined;
  }): Promise<void> {
    this.addToBuffer(LogSeverity.Information, data.message, {
      toolName: data.toolName,
      toolArguments: data.toolArguments,
      toolResult: data.toolResult,
    });
  }

  // Log output from external processes (e.g. the code agent's tool runs)
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

  /*
   * Sends every line waiting, after the task's lines already on their way:
   * resolves once these are sent (or refused).
   */
  public async flush(): Promise<void> {
    this.stopFlushTimer();

    if (this.logBuffer.length === 0) {
      // Nothing of this logger's waits; what is on its way finishes first.
      await this.sendQueue.tail;
      return;
    }

    // Get all entries and clear buffer
    const entries: Array<LogEntry> = [...this.logBuffer];
    this.logBuffer = [];

    const sending: Promise<void> = this.sendQueue.tail.then(
      async (): Promise<void> => {
        // Send each log entry separately to preserve individual log lines
        for (const entry of entries) {
          await this.sendLogToServer({
            ...entry,
            message: this.formatMessage(
              entry.severity,
              entry.message,
              entry.timestamp,
            ),
          });
        }
      },
    );

    // The next lines wait for these, whether or not they were taken.
    this.sendQueue.tail = sending.catch((): void => {
      // sendLogToServer logs its own failures.
    });

    await sending;
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
      // One queue for the task: the child's lines take their turn with the parent's.
      sendQueue: this.sendQueue,
    });
  }
}
