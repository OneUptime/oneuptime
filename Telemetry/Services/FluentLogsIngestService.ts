import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import LogSeverity from "Common/Types/Log/LogSeverity";
import TelemetryUtil, {
  AttributeType,
} from "Common/Server/Utils/Telemetry/Telemetry";
import { JSONObject } from "Common/Types/JSON";
import Dictionary from "Common/Types/Dictionary";
import logger from "Common/Server/Utils/Logger";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import LogService from "Common/Server/Services/LogService";
import OtelIngestBaseService from "./OtelIngestBaseService";
import FluentLogsQueueService from "./Queue/FluentLogsQueueService";
import { TELEMETRY_LOG_FLUSH_BATCH_SIZE } from "../Config";

export default class FluentLogsIngestService extends OtelIngestBaseService {
  private static readonly DEFAULT_SERVICE_NAME: string = "Fluentd";

  // Fields to check for the log body (in priority order)
  private static readonly BODY_FIELDS: Array<string> = [
    "message",
    "log",
    "msg",
    "body",
    "text",
  ];

  // Fields to check for severity
  private static readonly SEVERITY_FIELDS: Array<string> = [
    "level",
    "severity",
    "loglevel",
    "log_level",
    "priority",
    "severityText",
    "severity_text",
  ];

  // Fields to check for trace ID
  private static readonly TRACE_ID_FIELDS: Array<string> = [
    "trace_id",
    "traceId",
    "traceid",
  ];

  // Fields to check for span ID
  private static readonly SPAN_ID_FIELDS: Array<string> = [
    "span_id",
    "spanId",
    "spanid",
  ];

  // Severity text to OTel severity mapping
  private static readonly SEVERITY_TEXT_MAP: Dictionary<{
    number: number;
    text: LogSeverity;
  }> = {
    trace: { number: 1, text: LogSeverity.Trace },
    debug: { number: 5, text: LogSeverity.Debug },
    info: { number: 9, text: LogSeverity.Information },
    information: { number: 9, text: LogSeverity.Information },
    informational: { number: 9, text: LogSeverity.Information },
    notice: { number: 9, text: LogSeverity.Information },
    warn: { number: 13, text: LogSeverity.Warning },
    warning: { number: 13, text: LogSeverity.Warning },
    error: { number: 17, text: LogSeverity.Error },
    err: { number: 17, text: LogSeverity.Error },
    critical: { number: 21, text: LogSeverity.Fatal },
    fatal: { number: 23, text: LogSeverity.Fatal },
    emergency: { number: 23, text: LogSeverity.Fatal },
    emerg: { number: 23, text: LogSeverity.Fatal },
  };

  // Fields that are extracted separately and should not be duplicated as attributes
  private static readonly EXCLUDED_ATTRIBUTE_FIELDS: Set<string> = new Set([
    "message",
    "log",
    "msg",
    "body",
    "text",
    "level",
    "severity",
    "loglevel",
    "log_level",
    "priority",
    "severityText",
    "severity_text",
    "trace_id",
    "traceId",
    "traceid",
    "span_id",
    "spanId",
    "spanid",
  ]);

  @CaptureSpan()
  public static async ingestFluentLogs(
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

      req.body = req.body?.toJSON ? req.body.toJSON() : req.body;

      const entries: Array<JSONObject> = this.normalizeLogEntries(req.body);

      if (entries.length === 0) {
        throw new BadRequestException(
          "No fluent log entries found in request.",
        );
      }

      req.body = {
        entries,
      } satisfies JSONObject;

      Response.sendEmptySuccessResponse(req, res);

      await FluentLogsQueueService.addFluentLogIngestJob(
        req as TelemetryRequest,
      );

      return;
    } catch (error) {
      return next(error);
    }
  }

  @CaptureSpan()
  public static async processFluentLogsFromQueue(
    req: ExpressRequest,
  ): Promise<void> {
    await this.processFluentLogsAsync(req);
  }

  @CaptureSpan()
  private static async processFluentLogsAsync(
    req: ExpressRequest,
  ): Promise<void> {
    try {
      const projectId: ObjectID = (req as TelemetryRequest).projectId;
      const entries: Array<JSONObject> =
        this.extractEntriesFromRequest(req.body);

      if (entries.length === 0) {
        logger.warn("Fluent logs ingest: no entries to process.");
        return;
      }

      const serviceName: string = this.getServiceNameFromHeaders(
        req,
        this.DEFAULT_SERVICE_NAME,
      );

      const metadata: {
        serviceId: ObjectID;
        dataRententionInDays: number;
      } = await OTelIngestService.telemetryServiceFromName({
        serviceName,
        projectId,
      });

      const serviceMetadata: TelemetryServiceMetadata = {
        serviceName,
        serviceId: metadata.serviceId,
        dataRententionInDays: metadata.dataRententionInDays,
      } satisfies TelemetryServiceMetadata;

      const baseAttributes: Dictionary<AttributeType | Array<AttributeType>> =
        TelemetryUtil.getAttributesForServiceIdAndServiceName({
          serviceId: serviceMetadata.serviceId,
          serviceName,
        });

      const dbLogs: Array<JSONObject> = [];
      let processed: number = 0;

      for (const entry of entries) {
        try {
          const ingestionDate: Date = OneUptimeDate.getCurrentDate();
          const ingestionDateTime: string =
            OneUptimeDate.toClickhouseDateTime(ingestionDate);
          const timeUnixNano: string = Math.trunc(
            OneUptimeDate.toUnixNano(ingestionDate),
          ).toString();

          const body: string = this.extractBodyFromEntry(entry);
          const severityInfo: { number: number; text: LogSeverity } =
            this.extractSeverityFromEntry(entry);
          const traceId: string =
            this.extractStringField(entry, this.TRACE_ID_FIELDS) || "";
          const spanId: string =
            this.extractStringField(entry, this.SPAN_ID_FIELDS) || "";

          const entryAttributes: Dictionary<
            AttributeType | Array<AttributeType>
          > = this.buildFluentAttributes(entry);

          const attributes: Dictionary<
            AttributeType | Array<AttributeType>
          > = {
            ...baseAttributes,
            ...entryAttributes,
          };

          const logRow: JSONObject = {
            _id: ObjectID.generate().toString(),
            createdAt: ingestionDateTime,
            updatedAt: ingestionDateTime,
            projectId: projectId.toString(),
            serviceId: serviceMetadata.serviceId.toString(),
            time: ingestionDateTime,
            timeUnixNano,
            severityNumber: severityInfo.number,
            severityText: severityInfo.text,
            attributes,
            attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
            traceId,
            spanId,
            body,
          } satisfies JSONObject;

          dbLogs.push(logRow);
          processed++;

          if (dbLogs.length >= TELEMETRY_LOG_FLUSH_BATCH_SIZE) {
            await this.flushLogsBuffer(dbLogs);
          }
        } catch (processingError) {
          logger.error("Fluent logs ingest: error processing entry");
          logger.error(processingError);
        }
      }

      await this.flushLogsBuffer(dbLogs, true);

      if (processed === 0) {
        logger.warn("Fluent logs ingest: no valid entries processed");
      } else {
        logger.debug(
          `Fluent logs ingest: processed ${processed} entries for project ${projectId.toString()}`,
        );
      }

      dbLogs.length = 0;

      try {
        if (req.body) {
          req.body = null;
        }
      } catch (cleanupError) {
        logger.error("Fluent logs ingest: error during memory cleanup");
        logger.error(cleanupError);
      }
    } catch (error) {
      logger.error("Fluent logs ingest: critical error");
      logger.error(error);
      throw error;
    }
  }

  private static extractEntriesFromRequest(
    body: unknown,
  ): Array<JSONObject> {
    if (!body || typeof body !== "object") {
      return [];
    }

    const payload: JSONObject = body as JSONObject;
    const entries: unknown = payload["entries"];

    if (!entries) {
      return [];
    }

    if (Array.isArray(entries)) {
      return entries
        .map((item: unknown) => {
          if (item === null || item === undefined) {
            return undefined;
          }

          if (typeof item === "object" && !Array.isArray(item)) {
            return item as JSONObject;
          }

          if (typeof item === "string") {
            return { message: item } as JSONObject;
          }

          return { message: String(item) } as JSONObject;
        })
        .filter(
          (item: JSONObject | undefined): item is JSONObject => {
            return item !== undefined;
          },
        );
    }

    return this.normalizeLogEntries(entries);
  }

  private static normalizeLogEntries(payload: unknown): Array<JSONObject> {
    if (payload === undefined || payload === null) {
      return [];
    }

    if (typeof payload === "string") {
      const trimmed: string = payload.trim();

      if (!trimmed) {
        return [];
      }

      if (trimmed.includes("\n")) {
        return trimmed
          .split(/\r?\n/)
          .map((line: string) => {
            return line.trim();
          })
          .filter((line: string) => {
            return line.length > 0;
          })
          .map((line: string) => {
            return { message: line } as JSONObject;
          });
      }

      return [{ message: trimmed } as JSONObject];
    }

    if (Buffer.isBuffer(payload)) {
      return this.normalizeLogEntries(payload.toString("utf-8"));
    }

    if (Array.isArray(payload)) {
      const results: Array<JSONObject> = [];

      for (const item of payload) {
        results.push(...this.normalizeLogEntries(item));
      }

      return results;
    }

    if (typeof payload === "object") {
      const obj: JSONObject = payload as JSONObject;

      // Unwrap container fields
      if (obj["json"] !== undefined) {
        return this.normalizeLogEntries(obj["json"]);
      }

      if (obj["entries"] !== undefined) {
        return this.normalizeLogEntries(obj["entries"]);
      }

      // This object IS a log entry - preserve it with all its fields
      return [obj];
    }

    return [{ message: String(payload) } as JSONObject];
  }

  private static extractBodyFromEntry(entry: JSONObject): string {
    for (const field of this.BODY_FIELDS) {
      const value: unknown = entry[field];

      if (value !== undefined && value !== null) {
        if (typeof value === "string") {
          return value;
        }

        try {
          return JSON.stringify(value);
        } catch {
          continue;
        }
      }
    }

    // Fallback: stringify the entire entry
    try {
      return JSON.stringify(entry);
    } catch {
      return "";
    }
  }

  private static extractSeverityFromEntry(entry: JSONObject): {
    number: number;
    text: LogSeverity;
  } {
    const severityValue: string | undefined = this.extractStringField(
      entry,
      this.SEVERITY_FIELDS,
    );

    if (!severityValue) {
      return { number: 0, text: LogSeverity.Unspecified };
    }

    const normalized: string = severityValue.toLowerCase().trim();
    const mapped: { number: number; text: LogSeverity } | undefined =
      this.SEVERITY_TEXT_MAP[normalized];

    if (mapped) {
      return mapped;
    }

    return { number: 0, text: LogSeverity.Unspecified };
  }

  private static extractStringField(
    entry: JSONObject,
    fields: Array<string>,
  ): string | undefined {
    for (const field of fields) {
      const value: unknown = entry[field];

      if (value !== undefined && value !== null) {
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }

        if (typeof value === "number") {
          return value.toString();
        }
      }
    }

    return undefined;
  }

  private static buildFluentAttributes(
    entry: JSONObject,
  ): Dictionary<AttributeType | Array<AttributeType>> {
    const attributes: Dictionary<AttributeType | Array<AttributeType>> = {};

    for (const [key, value] of Object.entries(entry)) {
      if (this.EXCLUDED_ATTRIBUTE_FIELDS.has(key)) {
        continue;
      }

      if (value === null || value === undefined) {
        continue;
      }

      const attributeKey: string = `fluentd.${key}`;

      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        attributes[attributeKey] = value;
      } else if (Array.isArray(value)) {
        try {
          attributes[attributeKey] = JSON.stringify(value);
        } catch {
          // skip
        }
      } else if (typeof value === "object") {
        const nested: Dictionary<AttributeType | Array<AttributeType>> =
          this.flattenToAttributes(value as JSONObject, attributeKey);
        Object.assign(attributes, nested);
      }
    }

    return attributes;
  }

  private static flattenToAttributes(
    obj: JSONObject,
    prefix: string,
  ): Dictionary<AttributeType | Array<AttributeType>> {
    const result: Dictionary<AttributeType | Array<AttributeType>> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        continue;
      }

      const fullKey: string = `${prefix}.${key}`;

      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        result[fullKey] = value;
      } else if (Array.isArray(value)) {
        try {
          result[fullKey] = JSON.stringify(value);
        } catch {
          // skip
        }
      } else if (typeof value === "object") {
        Object.assign(
          result,
          this.flattenToAttributes(value as JSONObject, fullKey),
        );
      }
    }

    return result;
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
}
