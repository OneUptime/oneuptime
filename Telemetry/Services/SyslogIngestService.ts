import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import LogSeverity from "Common/Types/Log/LogSeverity";
import TelemetryUtil, {
  AttributeType,
} from "Common/Server/Utils/Telemetry/Telemetry";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import LogService from "Common/Server/Services/LogService";
import logger from "Common/Server/Utils/Logger";
import OtelIngestBaseService from "./OtelIngestBaseService";
import SyslogQueueService from "./Queue/SyslogQueueService";
import { TELEMETRY_LOG_FLUSH_BATCH_SIZE } from "../Config";
import {
  ParsedSyslogMessage,
  ParsedSyslogStructuredData,
  parseSyslogMessage,
} from "../Utils/SyslogParser";

export default class SyslogIngestService extends OtelIngestBaseService {
  private static readonly SYSLOG_FACILITY_LABELS: Array<string> = [
    "kernel",
    "user",
    "mail",
    "system",
    "security",
    "syslogd",
    "line_printer",
    "network_news",
    "uucp",
    "clock",
    "security2",
    "ftp",
    "ntp",
    "log_audit",
    "log_alert",
    "clock2",
    "local0",
    "local1",
    "local2",
    "local3",
    "local4",
    "local5",
    "local6",
    "local7",
  ];

  private static readonly SYSLOG_SEVERITY_LABELS: Array<string> = [
    "emergency",
    "alert",
    "critical",
    "error",
    "warning",
    "notice",
    "informational",
    "debug",
  ];

  private static readonly DEFAULT_SERVICE_NAME: string = "Syslog";

  private static readonly SYSLOG_TO_OTEL_SEVERITY: Dictionary<{
    number: number;
    text: LogSeverity;
  }> = {
    "0": { number: 23, text: LogSeverity.Fatal },
    "1": { number: 23, text: LogSeverity.Fatal },
    "2": { number: 19, text: LogSeverity.Error },
    "3": { number: 19, text: LogSeverity.Error },
    "4": { number: 13, text: LogSeverity.Warning },
    "5": { number: 9, text: LogSeverity.Information },
    "6": { number: 9, text: LogSeverity.Information },
    "7": { number: 5, text: LogSeverity.Debug },
  };

  @CaptureSpan()
  public static async ingestSyslog(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!(req as TelemetryRequest).projectId) {
        throw new BadRequestException(
          "Invalid request - projectId not found in request.",
        );
      }

      const messages: Array<string> = this.normalizeMessages(req.body);

      if (messages.length === 0) {
        throw new BadRequestException("No syslog messages found in request.");
      }

      req.body = {
        messages,
      } satisfies JSONObject;

      Response.sendEmptySuccessResponse(req, res);

      await SyslogQueueService.addSyslogIngestJob(req as TelemetryRequest);

      return;
    } catch (error) {
      return next(error);
    }
  }

  @CaptureSpan()
  public static async processSyslogFromQueue(
    req: ExpressRequest,
  ): Promise<void> {
    await this.processSyslogAsync(req);
  }

  @CaptureSpan()
  private static async processSyslogAsync(req: ExpressRequest): Promise<void> {
    try {
      const projectId: ObjectID = (req as TelemetryRequest).projectId;
      const messages: Array<string> = this.extractMessagesFromRequest(req.body);

      if (messages.length === 0) {
        logger.warn("Syslog ingest: no messages to process.");
        return;
      }

      const dbLogs: Array<JSONObject> = [];
      const serviceCache: Dictionary<TelemetryServiceMetadata> = {};
      let processed: number = 0;

      let messageCounter: number = 0;

      for (const rawMessage of messages) {
        try {
          if (messageCounter % 500 === 0) {
            await Promise.resolve();
          }

          messageCounter++;

          const parsed: ParsedSyslogMessage | null =
            parseSyslogMessage(rawMessage);

          if (!parsed) {
            logger.warn(
              `Syslog ingest: unable to parse message: ${rawMessage}`,
            );
            continue;
          }

          const serviceName: string = this.resolveServiceName(req, parsed);

          if (!serviceCache[serviceName]) {
            const metadata: {
              serviceId: ObjectID;
              dataRententionInDays: number;
            } = await OTelIngestService.telemetryServiceFromName({
              serviceName,
              projectId,
            });

            serviceCache[serviceName] = {
              serviceName,
              serviceId: metadata.serviceId,
              dataRententionInDays: metadata.dataRententionInDays,
            } satisfies TelemetryServiceMetadata;
          }

          const serviceMetadata: TelemetryServiceMetadata =
            serviceCache[serviceName]!;

          const severityInfo: { number: number; text: LogSeverity } =
            this.mapSeverity(parsed.severity);

          const timestamp: Date =
            parsed.timestamp || OneUptimeDate.getCurrentDate();
          const ingestionDate: Date = OneUptimeDate.getCurrentDate();

          const attributes: Dictionary<AttributeType | Array<AttributeType>> =
            this.buildAttributes({
              parsed,
              serviceId: serviceMetadata.serviceId,
              serviceName,
            });

          const logRow: JSONObject = {
            _id: ObjectID.generate().toString(),
            createdAt: OneUptimeDate.toClickhouseDateTime(ingestionDate),
            updatedAt: OneUptimeDate.toClickhouseDateTime(ingestionDate),
            projectId: projectId.toString(),
            serviceId: serviceMetadata.serviceId.toString(),
            time: OneUptimeDate.toClickhouseDateTime(timestamp),
            timeUnixNano: Math.trunc(
              OneUptimeDate.toUnixNano(timestamp),
            ).toString(),
            severityNumber: severityInfo.number,
            severityText: severityInfo.text,
            attributes,
            attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
            traceId: "",
            spanId: "",
            body: parsed.message,
          } satisfies JSONObject;

          dbLogs.push(logRow);
          processed++;

          if (dbLogs.length >= TELEMETRY_LOG_FLUSH_BATCH_SIZE) {
            await this.flushLogsBuffer(dbLogs);
          }
        } catch (processingError) {
          logger.error("Syslog ingest: error processing message");
          logger.error(processingError);
          logger.error(`Syslog message: ${rawMessage}`);
        }
      }

      await this.flushLogsBuffer(dbLogs, true);

      if (processed === 0) {
        logger.warn("Syslog ingest: no valid messages processed");
      } else {
        logger.debug(
          `Syslog ingest: processed ${processed} messages for project ${projectId.toString()}`,
        );
      }

      dbLogs.length = 0;

      try {
        if (req.body) {
          req.body = null;
        }
      } catch (cleanupError) {
        logger.error("Syslog ingest: error during memory cleanup");
        logger.error(cleanupError);
      }
    } catch (error) {
      logger.error("Syslog ingest: critical error");
      logger.error(error);
      throw error;
    }
  }

  private static resolveServiceName(
    req: ExpressRequest,
    parsed: ParsedSyslogMessage,
  ): string {
    const headerServiceName: string = this.getServiceNameFromHeaders(req, "");

    if (headerServiceName) {
      return headerServiceName;
    }

    if (parsed.appName && parsed.appName.trim()) {
      return parsed.appName.trim();
    }

    if (parsed.hostname && parsed.hostname.trim()) {
      return parsed.hostname.trim();
    }

    return SyslogIngestService.DEFAULT_SERVICE_NAME;
  }

  private static buildAttributes(data: {
    parsed: ParsedSyslogMessage;
    serviceId: ObjectID;
    serviceName: string;
  }): Dictionary<AttributeType | Array<AttributeType>> {
    const { parsed } = data;

    const attributes: Dictionary<AttributeType | Array<AttributeType>> = {
      ...TelemetryUtil.getAttributesForServiceIdAndServiceName({
        serviceId: data.serviceId,
        serviceName: data.serviceName,
      }),
      "syslog.raw": parsed.raw,
    };

    if (parsed.hostname) {
      attributes["syslog.hostname"] = parsed.hostname;
    }

    if (parsed.appName) {
      attributes["syslog.appName"] = parsed.appName;
    }

    if (parsed.procId) {
      attributes["syslog.processId"] = parsed.procId;
    }

    if (parsed.msgId) {
      attributes["syslog.messageId"] = parsed.msgId;
    }

    if (parsed.version !== undefined) {
      attributes["syslog.version"] = parsed.version;
    }

    if (parsed.priority !== undefined) {
      attributes["syslog.priority"] = parsed.priority;
    }

    if (parsed.severity !== undefined) {
      attributes["syslog.severity.code"] = parsed.severity;
      attributes["syslog.severity.name"] = this.getSeverityLabel(
        parsed.severity,
      );
    }

    if (parsed.facility !== undefined) {
      attributes["syslog.facility.code"] = parsed.facility;
      attributes["syslog.facility.name"] = this.getFacilityLabel(
        parsed.facility,
      );
    }

    if (parsed.structuredDataRaw) {
      attributes["syslog.structured.raw"] = parsed.structuredDataRaw;
    }

    if (parsed.structuredData) {
      this.appendStructuredDataAttributes(attributes, parsed.structuredData);
    }

    return attributes;
  }

  private static appendStructuredDataAttributes(
    attributes: Dictionary<AttributeType | Array<AttributeType>>,
    structuredData: ParsedSyslogStructuredData,
  ): void {
    for (const [sdId, params] of Object.entries(structuredData)) {
      for (const [key, value] of Object.entries(params)) {
        const attributeKey: string = `syslog.structured.${this.sanitizeAttributeKey(sdId)}.${this.sanitizeAttributeKey(key)}`;
        attributes[attributeKey] = value;
      }
    }
  }

  private static getSeverityLabel(severity: number): string {
    if (
      severity >= 0 &&
      severity < SyslogIngestService.SYSLOG_SEVERITY_LABELS.length
    ) {
      return SyslogIngestService.SYSLOG_SEVERITY_LABELS[severity]!;
    }

    return "unknown";
  }

  private static getFacilityLabel(facility: number): string {
    if (
      facility >= 0 &&
      facility < SyslogIngestService.SYSLOG_FACILITY_LABELS.length
    ) {
      return SyslogIngestService.SYSLOG_FACILITY_LABELS[facility]!;
    }

    return "unknown";
  }

  private static mapSeverity(severity?: number | undefined): {
    number: number;
    text: LogSeverity;
  } {
    if (severity === undefined || severity === null) {
      return { number: 0, text: LogSeverity.Unspecified };
    }

    const key: string = severity.toString();

    if (this.SYSLOG_TO_OTEL_SEVERITY[key]) {
      return this.SYSLOG_TO_OTEL_SEVERITY[key]!;
    }

    return { number: 0, text: LogSeverity.Unspecified };
  }

  private static async flushLogsBuffer(
    logs: Array<JSONObject>,
    force: boolean = false,
  ): Promise<void> {
    while (
      logs.length >= TELEMETRY_LOG_FLUSH_BATCH_SIZE ||
      (force && logs.length > 0)
    ) {
      const batchSize: number = Math.min(
        logs.length,
        TELEMETRY_LOG_FLUSH_BATCH_SIZE,
      );

      const batch: Array<JSONObject> = logs.splice(0, batchSize);

      if (batch.length === 0) {
        continue;
      }

      await LogService.insertJsonRows(batch);
    }
  }

  private static extractMessagesFromRequest(body: unknown): Array<string> {
    if (!body || typeof body !== "object") {
      return [];
    }

    const payload: JSONObject = body as JSONObject;
    const messages: unknown = payload["messages"];

    if (Array.isArray(messages)) {
      return messages
        .map((item: unknown) => {
          if (typeof item === "string") {
            return item;
          }

          if (item === null || item === undefined) {
            return "";
          }

          return String(item);
        })
        .filter((item: string | undefined): item is string => {
          return Boolean(item && item.trim());
        });
    }

    if (typeof messages === "string") {
      return this.normalizeMessages(messages);
    }

    return [];
  }

  private static normalizeMessages(payload: unknown): Array<string> {
    if (!payload) {
      return [];
    }

    if (typeof payload === "string") {
      return payload
        .split(/\r?\n/)
        .map((line: string) => {
          return line.trim();
        })
        .filter((line: string) => {
          return line.length > 0;
        });
    }

    if (Buffer.isBuffer(payload)) {
      return this.normalizeMessages(payload.toString("utf-8"));
    }

    if (Array.isArray(payload)) {
      const results: Array<string> = [];
      for (const item of payload) {
        results.push(...this.normalizeMessages(item));
      }
      return results;
    }

    if (typeof payload === "object") {
      const obj: JSONObject = payload as JSONObject;

      if (Array.isArray(obj["messages"])) {
        return this.normalizeMessages(obj["messages"]);
      }

      if (typeof obj["message"] === "string") {
        return this.normalizeMessages(obj["message"]);
      }

      if (Array.isArray(obj["syslog"])) {
        return this.normalizeMessages(obj["syslog"]);
      }

      if (typeof obj["syslog"] === "string") {
        return this.normalizeMessages(obj["syslog"]);
      }
    }

    return [];
  }

  private static sanitizeAttributeKey(value: string): string {
    return value.replace(/[^A-Za-z0-9_.-]/g, "_");
  }
}
