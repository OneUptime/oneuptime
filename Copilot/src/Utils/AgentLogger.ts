import fs from "node:fs";
import path from "node:path";
import logger, { LogBody } from "Common/Server/Utils/Logger";

/** Supported log levels for the agent-maintained file logs. */
export type AgentLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/**
 * Extends the shared logger by optionally mirroring output to a persistent file
 * for auditing agent activity.
 */
export class AgentLogger {
  private static logStream: fs.WriteStream | null = null;
  private static logFilePath: string | null = null;
  private static exitHandlersRegistered: boolean = false;
  private static fileWriteFailed: boolean = false;

  /** Enables/disables file logging depending on whether a path is provided. */
  public static async configure(options: {
    logFilePath?: string | undefined;
  }): Promise<void> {
    const targetPath: string | undefined = options.logFilePath?.trim()
      ? path.resolve(options.logFilePath)
      : undefined;

    if (!targetPath) {
      await this.closeStream();
      this.logFilePath = null;
      logger.debug("File logging disabled");
      return;
    }

    if (this.logFilePath === targetPath && this.logStream) {
      return;
    }

    await this.closeStream();
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

    // Remove existing debug file to start fresh for each command run
    try {
      await fs.promises.unlink(targetPath);
    } catch {
      // File doesn't exist, ignore
    }

    this.logStream = fs.createWriteStream(targetPath, { flags: "w" });
    this.logFilePath = targetPath;
    this.fileWriteFailed = false;
    this.registerExitHandlers();
    this.info(`File logging enabled at ${targetPath}`);
  }

  /** Writes a debug entry to the console logger and file stream. */
  public static debug(message: LogBody, meta?: unknown): void {
    logger.debug(message);
    this.writeToFile("DEBUG", message, meta);
  }

  /** Writes an informational entry to the console logger and file stream. */
  public static info(message: LogBody, meta?: unknown): void {
    logger.info(message);
    this.writeToFile("INFO", message, meta);
  }

  /** Writes a warning entry to the console logger and file stream. */
  public static warn(message: LogBody, meta?: unknown): void {
    logger.warn(message);
    this.writeToFile("WARN", message, meta);
  }

  /** Writes an error entry to the console logger and file stream. */
  public static error(message: LogBody, meta?: unknown): void {
    logger.error(message);
    this.writeToFile("ERROR", message, meta);
  }

  /** Closes the file stream if one is currently open. */
  private static async closeStream(): Promise<void> {
    if (!this.logStream) {
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      this.logStream?.end(resolve);
    });

    this.logStream = null;
    logger.debug("File logging stream closed");
  }

  /**
   * Serializes a log entry and safely writes it to the currently configured
   * file stream.
   */
  private static writeToFile(
    level: AgentLogLevel,
    message: LogBody,
    meta?: unknown,
  ): void {
    if (!this.logStream) {
      return;
    }

    const timestamp: string = new Date().toISOString();
    const serializedMessage: string = logger.serializeLogBody(message);
    const serializedMeta: string | null = this.serializeMeta(meta);
    const line: string = serializedMeta
      ? `${timestamp} [${level}] ${serializedMessage} ${serializedMeta}`
      : `${timestamp} [${level}] ${serializedMessage}`;

    try {
      this.logStream.write(line + "\n");
    } catch (error) {
      if (!this.fileWriteFailed) {
        this.fileWriteFailed = true;
        logger.error(
          `Failed to write logs to ${this.logFilePath ?? "<unknown>"}: ${(error as Error).message}`,
        );
      }
    }
  }

  /** Converts metadata into a string representation for log lines. */
  private static serializeMeta(meta?: unknown): string | null {
    if (meta === undefined || meta === null) {
      return null;
    }

    if (typeof meta === "string") {
      return meta;
    }

    try {
      return JSON.stringify(meta);
    } catch (error) {
      return `"<unserializable meta: ${(error as Error).message}>"`;
    }
  }

  /** Installs once-only handlers to flush file logs during process exit. */
  private static registerExitHandlers(): void {
    if (this.exitHandlersRegistered) {
      return;
    }

    const cleanup: () => void = () => {
      void this.closeStream();
    };

    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
    this.exitHandlersRegistered = true;
  }
}

export default AgentLogger;
