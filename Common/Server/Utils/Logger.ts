import { LogLevel } from "../EnvironmentConfig";
import OneUptimeTelemetry, { TelemetryLogger } from "./Telemetry";
import { SeverityNumber } from "@opentelemetry/api-logs";
import Exception from "../../Types/Exception/Exception";
import { JSONObject } from "../../Types/JSON";
import ConfigLogLevel from "../Types/ConfigLogLevel";

export type LogBody = string | JSONObject | Exception | Error | unknown;

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
  public static getLogLevel(): ConfigLogLevel {
    if (!LogLevel) {
      return ConfigLogLevel.INFO;
    }

    return LogLevel;
  }

  public static serializeLogBody(body: LogBody): string {
    if (typeof body === "string") {
      return body;
    } else if (body instanceof Exception || body instanceof Error) {
      return body.message;
    }
    return JSON.stringify(body);
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

        if (value !== undefined && value !== null) {
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
      // eslint-disable-next-line no-console
      console.info(message);

      this.emit({
        body: message,
        severityNumber: SeverityNumber.INFO,
        attributes,
      });
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
      // eslint-disable-next-line no-console
      console.error(message);

      this.emit({
        body: message,
        severityNumber: SeverityNumber.ERROR,
        attributes,
      });
    }
  }

  public static warn(message: LogBody, attributes?: LogAttributes): void {
    const logLevel: ConfigLogLevel = this.getLogLevel();

    if (
      logLevel === ConfigLogLevel.DEBUG ||
      logLevel === ConfigLogLevel.INFO ||
      logLevel === ConfigLogLevel.WARN
    ) {
      // eslint-disable-next-line no-console
      console.warn(message);

      this.emit({
        body: message,
        severityNumber: SeverityNumber.WARN,
        attributes,
      });
    }
  }

  public static debug(message: LogBody, attributes?: LogAttributes): void {
    const logLevel: ConfigLogLevel = this.getLogLevel();

    if (logLevel === ConfigLogLevel.DEBUG) {
      // eslint-disable-next-line no-console
      console.debug(message);

      this.emit({
        body: message,
        severityNumber: SeverityNumber.DEBUG,
        attributes,
      });
    }
  }

  public static emit(data: {
    body: LogBody;
    severityNumber: SeverityNumber;
    attributes?: LogAttributes | undefined;
  }): void {
    try {
      const logger: TelemetryLogger | null = OneUptimeTelemetry.getLogger();

      if (logger === null) {
        return;
      }

      const sanitizedAttributes: Record<string, string | number | boolean> | undefined =
        this.sanitizeAttributes(data.attributes);

      logger.emit({
        body: this.serializeLogBody(data.body),
        severityNumber: data.severityNumber,
        ...(sanitizedAttributes ? { attributes: sanitizedAttributes } : {}),
      });
    } catch {
      // Never let logging errors propagate
    }
  }

  public static trace(message: LogBody, attributes?: LogAttributes): void {
    const logLevel: ConfigLogLevel = this.getLogLevel();

    if (logLevel === ConfigLogLevel.DEBUG) {
      // eslint-disable-next-line no-console
      console.trace(message);

      this.emit({
        body: message,
        severityNumber: SeverityNumber.DEBUG,
        attributes,
      });
    }
  }
}
