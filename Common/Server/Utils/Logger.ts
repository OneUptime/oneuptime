import { LogLevel } from "../EnvironmentConfig";
import OneUptimeTelemetry, { TelemetryLogger } from "./Telemetry";
import TelemetryContext from "./Telemetry/TelemetryContext";
import { SeverityNumber } from "@opentelemetry/api-logs";
import Exception from "../../Types/Exception/Exception";
import { JSONObject } from "../../Types/JSON";
import ConfigLogLevel from "../Types/ConfigLogLevel";
import {
  REDACTED,
  isSensitiveLogKey,
  redactLogString,
  redactLogValue,
} from "./LogRedaction";

export type LogBody = string | JSONObject | Exception | Error | unknown;

export interface RecentLogEntry {
  time: string;
  level: string;
  message: string;
}

export interface LogAttributes {
  userId?: string | undefined;
  projectId?: string | undefined;
  requestId?: string | undefined;
  [key: string]: string | number | boolean | undefined;
}

export interface RequestLike {
  requestId?: string;
  tenantId?: { toString(): string };
  userAuthorization?: { userId?: { toString(): string } };
}

export function getLogAttributesFromRequest(
  req?: RequestLike | null,
): LogAttributes {
  if (!req) {
    return {};
  }

  try {
    const attributes: LogAttributes = {};

    if (req.requestId) {
      attributes.requestId = req.requestId;
    }

    if (req.tenantId) {
      attributes.projectId = req.tenantId.toString();
    }

    if (req.userAuthorization?.userId) {
      attributes.userId = req.userAuthorization.userId.toString();
    }

    return attributes;
  } catch {
    return {};
  }
}

export default class logger {
  /*
   * In-memory ring buffer of the most recent log lines this process emitted.
   * The app writes logs to stdout only (no on-disk file), so this is the one
   * way the master-admin support bundle / health dashboard can surface this
   * instance's own recent logs for debugging — there is no path to the
   * container's stdout or to other containers' logs from inside the process.
   */
  private static recentLogs: Array<RecentLogEntry> = [];
  private static readonly maxRecentLogs: number = 1000;
  private static readonly recentLogTrimSlack: number = 256;
  private static readonly maxRecentLogMessageLength: number = 4000;

  // `body` has already been through redactBody -- see the level methods.
  private static record(level: string, body: LogBody): void {
    try {
      const message: string = this.serializeRedactedBody(body);

      this.recentLogs.push({
        time: new Date().toISOString(),
        level: level,
        message:
          message.length > this.maxRecentLogMessageLength
            ? `${message.substring(0, this.maxRecentLogMessageLength)}… (truncated)`
            : message,
      });

      /*
       * Trim in batches rather than on every push so this stays O(1) amortised
       * on the logging hot path: only re-slice once we have grown past a soft
       * ceiling above the target size.
       */
      if (
        this.recentLogs.length >
        this.maxRecentLogs + this.recentLogTrimSlack
      ) {
        this.recentLogs = this.recentLogs.slice(-this.maxRecentLogs);
      }
    } catch {
      // Never let log capture break the app.
    }
  }

  // Newest-last snapshot of the recent-log ring buffer (optionally the last N).
  public static getRecentLogs(limit?: number): Array<RecentLogEntry> {
    if (!limit || limit >= this.recentLogs.length) {
      return [...this.recentLogs];
    }

    return this.recentLogs.slice(this.recentLogs.length - limit);
  }

  public static getLogLevel(): ConfigLogLevel {
    if (!LogLevel) {
      return ConfigLogLevel.INFO;
    }

    return LogLevel;
  }

  /*
   * Turns a body into a redacted copy, once, before it is handed to any sink.
   * Every level method calls this and then passes the RESULT to console, to
   * the recent-log buffer and to telemetry, so a log record is redacted a
   * single time no matter how many places it ends up in.
   *
   * Objects come back as plain redacted copies, so console keeps printing them
   * as objects rather than as a JSON string.
   *
   * Errors are special-cased: when nothing in the message or the stack needed
   * redacting -- the overwhelmingly common case -- the original Error is
   * returned untouched, so console still renders a real stack trace.
   */
  private static redactBody(body: LogBody): LogBody {
    try {
      if (typeof body === "string") {
        return redactLogString(body);
      }

      if (body instanceof Exception || body instanceof Error) {
        const originalStack: string = body.stack || "";
        const message: string = redactLogString(body.message);
        const stack: string = redactLogString(originalStack);

        if (message === body.message && stack === originalStack) {
          return body;
        }

        return stack || `${body.name}: ${message}`;
      }

      return redactLogValue(body) as LogBody;
    } catch {
      // Never pass on a body we could not prove was redacted.
      return REDACTED;
    }
  }

  // Serialization only. The body must already have been through redactBody.
  private static serializeRedactedBody(body: LogBody): string {
    try {
      if (typeof body === "string") {
        return body;
      } else if (body instanceof Exception || body instanceof Error) {
        return body.message;
      }

      /*
       * redactBody swept every string inside this copy already, so stringifying
       * it needs no second textual pass.
       */
      const serialized: string | undefined = JSON.stringify(body);

      return serialized === undefined ? "" : serialized;
    } catch {
      return REDACTED;
    }
  }

  /*
   * Redacts and serializes in one step, for callers outside the level methods
   * that hold a raw body.
   */
  public static serializeLogBody(body: LogBody): string {
    return this.serializeRedactedBody(this.redactBody(body));
  }

  private static sanitizeAttributes(
    attributes?: LogAttributes,
  ): Record<string, string | number | boolean> | undefined {
    if (!attributes) {
      return undefined;
    }

    try {
      const sanitized: Record<string, string | number | boolean> = {};

      for (const key in attributes) {
        const value: string | number | boolean | undefined = attributes[key];

        if (value === undefined || value === null) {
          continue;
        }

        // Attributes are a log sink too, and they travel to telemetry verbatim.
        if (isSensitiveLogKey(key, value)) {
          sanitized[key] = REDACTED;
        } else if (typeof value === "string") {
          sanitized[key] = redactLogString(value);
        } else {
          sanitized[key] = value;
        }
      }

      return Object.keys(sanitized).length > 0 ? sanitized : undefined;
    } catch {
      return undefined;
    }
  }

  public static info(message: LogBody, attributes?: LogAttributes): void {
    const logLevel: ConfigLogLevel = this.getLogLevel();

    if (logLevel === ConfigLogLevel.DEBUG || logLevel === ConfigLogLevel.INFO) {
      const body: LogBody = this.redactBody(message);

      // eslint-disable-next-line no-console
      console.info(body);

      this.record("INFO", body);

      this.emitRedacted(body, SeverityNumber.INFO, attributes);
    }
  }

  public static error(message: LogBody, attributes?: LogAttributes): void {
    const logLevel: ConfigLogLevel = this.getLogLevel();

    if (
      logLevel === ConfigLogLevel.DEBUG ||
      logLevel === ConfigLogLevel.INFO ||
      logLevel === ConfigLogLevel.WARN ||
      logLevel === ConfigLogLevel.ERROR
    ) {
      const body: LogBody = this.redactBody(message);

      // eslint-disable-next-line no-console
      console.error(body);

      this.record("ERROR", body);

      this.emitRedacted(body, SeverityNumber.ERROR, attributes);
    }
  }

  public static warn(message: LogBody, attributes?: LogAttributes): void {
    const logLevel: ConfigLogLevel = this.getLogLevel();

    if (
      logLevel === ConfigLogLevel.DEBUG ||
      logLevel === ConfigLogLevel.INFO ||
      logLevel === ConfigLogLevel.WARN
    ) {
      const body: LogBody = this.redactBody(message);

      // eslint-disable-next-line no-console
      console.warn(body);

      this.record("WARN", body);

      this.emitRedacted(body, SeverityNumber.WARN, attributes);
    }
  }

  public static debug(message: LogBody, attributes?: LogAttributes): void {
    const logLevel: ConfigLogLevel = this.getLogLevel();

    if (logLevel === ConfigLogLevel.DEBUG) {
      const body: LogBody = this.redactBody(message);

      // eslint-disable-next-line no-console
      console.debug(body);

      this.record("DEBUG", body);

      this.emitRedacted(body, SeverityNumber.DEBUG, attributes);
    }
  }

  public static emit(data: {
    body: LogBody;
    severityNumber: SeverityNumber;
    attributes?: LogAttributes | undefined;
  }): void {
    this.emitRedacted(
      this.redactBody(data.body),
      data.severityNumber,
      data.attributes,
    );
  }

  // `body` must already have been through redactBody.
  private static emitRedacted(
    body: LogBody,
    severityNumber: SeverityNumber,
    attributes?: LogAttributes | undefined,
  ): void {
    try {
      const logger: TelemetryLogger | null = OneUptimeTelemetry.getLogger();

      if (logger === null) {
        return;
      }

      /*
       * Merge ambient TelemetryContext attributes (projectId, userId,
       * monitorId, requestId, ...) into every log record. Attributes passed
       * explicitly to the log call take precedence over the ambient context.
       */
      const mergedAttributes: LogAttributes = {
        ...TelemetryContext.getAttributes(),
        ...(attributes || {}),
      };

      const sanitizedAttributes:
        | Record<string, string | number | boolean>
        | undefined = this.sanitizeAttributes(mergedAttributes);

      logger.emit({
        body: this.serializeRedactedBody(body),
        severityNumber: severityNumber,
        ...(sanitizedAttributes ? { attributes: sanitizedAttributes } : {}),
      });
    } catch {
      // Never let logging errors propagate
    }
  }

  public static trace(message: LogBody, attributes?: LogAttributes): void {
    const logLevel: ConfigLogLevel = this.getLogLevel();

    if (logLevel === ConfigLogLevel.DEBUG) {
      const body: LogBody = this.redactBody(message);

      // eslint-disable-next-line no-console
      console.trace(body);

      this.record("TRACE", body);

      this.emitRedacted(body, SeverityNumber.DEBUG, attributes);
    }
  }
}
