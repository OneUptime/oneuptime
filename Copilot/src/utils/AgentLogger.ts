import fs from "node:fs";
import path from "node:path";
import logger, { LogBody } from "Common/Server/Utils/Logger";

export type AgentLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export class AgentLogger {
  private static logStream: fs.WriteStream | null = null;
  private static logFilePath: string | null = null;
  private static exitHandlersRegistered: boolean = false;
  private static fileWriteFailed: boolean = false;

  public static async configure(options: { logFilePath?: string | undefined }): Promise<void> {
    const targetPath: string | undefined = options.logFilePath?.trim()
      ? path.resolve(options.logFilePath)
      : undefined;

    if (!targetPath) {
      await this.closeStream();
      this.logFilePath = null;
      return;
    }

    if (this.logFilePath === targetPath && this.logStream) {
      return;
    }

    await this.closeStream();
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    this.logStream = fs.createWriteStream(targetPath, { flags: "a" });
    this.logFilePath = targetPath;
    this.fileWriteFailed = false;
    this.registerExitHandlers();
    this.info(`File logging enabled at ${targetPath}`);
  }

  public static debug(message: LogBody, meta?: unknown): void {
    logger.debug(message);
    this.writeToFile("DEBUG", message, meta);
  }

  public static info(message: LogBody, meta?: unknown): void {
    logger.info(message);
    this.writeToFile("INFO", message, meta);
  }

  public static warn(message: LogBody, meta?: unknown): void {
    logger.warn(message);
    this.writeToFile("WARN", message, meta);
  }

  public static error(message: LogBody, meta?: unknown): void {
    logger.error(message);
    this.writeToFile("ERROR", message, meta);
  }

  private static async closeStream(): Promise<void> {
    if (!this.logStream) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.logStream?.end(resolve);
    });

    this.logStream = null;
  }

  private static writeToFile(level: AgentLogLevel, message: LogBody, meta?: unknown): void {
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

  private static registerExitHandlers(): void {
    if (this.exitHandlersRegistered) {
      return;
    }

    const cleanup = (): void => {
      void this.closeStream();
    };

    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
    this.exitHandlersRegistered = true;
  }
}

export default AgentLogger;
