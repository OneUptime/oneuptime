/**
 * MCP Logger - A logger specifically designed for MCP servers
 * All logs are directed to stderr to avoid interfering with the JSON-RPC protocol on stdout
 */

import { LogLevel } from "Common/Server/EnvironmentConfig";
import ConfigLogLevel from "Common/Server/Types/ConfigLogLevel";
import { JSONObject } from "Common/Types/JSON";
import Exception from "Common/Types/Exception/Exception";
import {
  REDACTED,
  redactLogString,
  redactLogValue,
} from "Common/Server/Utils/LogRedaction";

export type LogBody = string | JSONObject | Exception | Error | unknown;

export default class MCPLogger {
  public static getLogLevel(): ConfigLogLevel {
    if (!LogLevel) {
      return ConfigLogLevel.INFO;
    }

    return LogLevel;
  }

  /*
   * stderr is a log sink like any other, so this mirrors
   * Common/Server/Utils/Logger: every body is redacted before it is written.
   */
  public static serializeLogBody(body: LogBody): string {
    try {
      if (typeof body === "string") {
        return redactLogString(body);
      } else if (body instanceof Exception || body instanceof Error) {
        return redactLogString(body.message);
      }

      const serialized: string | undefined = JSON.stringify(
        redactLogValue(body),
      );

      return serialized === undefined ? "" : serialized;
    } catch {
      return REDACTED;
    }
  }

  public static info(message: LogBody): void {
    const logLevel: ConfigLogLevel = this.getLogLevel();

    if (logLevel === ConfigLogLevel.DEBUG || logLevel === ConfigLogLevel.INFO) {
      // Use stderr instead of stdout for MCP compatibility
      process.stderr.write(`[INFO] ${this.serializeLogBody(message)}\n`);
    }
  }

  public static error(message: LogBody): void {
    const logLevel: ConfigLogLevel = this.getLogLevel();

    if (
      logLevel === ConfigLogLevel.DEBUG ||
      logLevel === ConfigLogLevel.INFO ||
      logLevel === ConfigLogLevel.WARN ||
      logLevel === ConfigLogLevel.ERROR
    ) {
      // Use stderr for error messages
      process.stderr.write(`[ERROR] ${this.serializeLogBody(message)}\n`);
    }
  }

  public static warn(message: LogBody): void {
    const logLevel: ConfigLogLevel = this.getLogLevel();

    if (
      logLevel === ConfigLogLevel.DEBUG ||
      logLevel === ConfigLogLevel.INFO ||
      logLevel === ConfigLogLevel.WARN
    ) {
      // Use stderr for warning messages
      process.stderr.write(`[WARN] ${this.serializeLogBody(message)}\n`);
    }
  }

  public static debug(message: LogBody): void {
    const logLevel: ConfigLogLevel = this.getLogLevel();

    if (logLevel === ConfigLogLevel.DEBUG) {
      // Use stderr for debug messages
      process.stderr.write(`[DEBUG] ${this.serializeLogBody(message)}\n`);
    }
  }

  public static trace(message: LogBody): void {
    const logLevel: ConfigLogLevel = this.getLogLevel();

    if (logLevel === ConfigLogLevel.DEBUG) {
      // Use stderr for trace messages
      process.stderr.write(`[TRACE] ${this.serializeLogBody(message)}\n`);
    }
  }
}
