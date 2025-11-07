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
import { OPEN_TELEMETRY_INGEST_LOG_FLUSH_BATCH_SIZE } from "../Config";

export default class FluentLogsIngestService extends OtelIngestBaseService {
  private static readonly DEFAULT_SERVICE_NAME: string = "Fluentd";

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

      const entries: Array<string> = this.normalizeLogEntries(req.body);

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
      const entries: Array<string> = this.extractEntriesFromRequest(req.body);

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

      const baseAttributes: Dictionary<
        AttributeType | Array<AttributeType>
      > = TelemetryUtil.getAttributesForServiceIdAndServiceName({
        serviceId: serviceMetadata.serviceId,
        serviceName,
      });

      const baseAttributeKeys: Array<string> =
        TelemetryUtil.getAttributeKeys(baseAttributes);

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

          const attributes: Dictionary<AttributeType | Array<AttributeType>> = {
            ...baseAttributes,
          };

          const logRow: JSONObject = {
            _id: ObjectID.generate().toString(),
            createdAt: ingestionDateTime,
            updatedAt: ingestionDateTime,
            projectId: projectId.toString(),
            serviceId: serviceMetadata.serviceId.toString(),
            time: ingestionDateTime,
            timeUnixNano,
            severityNumber: 0,
            severityText: LogSeverity.Unspecified,
            attributes,
            attributeKeys: [...baseAttributeKeys],
            traceId: "",
            spanId: "",
            body: entry,
          } satisfies JSONObject;

          dbLogs.push(logRow);
          processed++;

          if (
            dbLogs.length >= OPEN_TELEMETRY_INGEST_LOG_FLUSH_BATCH_SIZE
          ) {
            await this.flushLogsBuffer(dbLogs);
          }
        } catch (processingError) {
          logger.error("Fluent logs ingest: error processing entry");
          logger.error(processingError);
          logger.error(`Fluent log entry: ${entry}`);
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

  private static extractEntriesFromRequest(body: unknown): Array<string> {
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
          if (typeof item === "string") {
            return item;
          }

          if (item === null || item === undefined) {
            return undefined;
          }

          if (typeof item === "object") {
            try {
              return JSON.stringify(item);
            } catch {
              return undefined;
            }
          }

          return String(item);
        })
        .filter((item: string | undefined): item is string => {
          return Boolean(item && item.length > 0);
        });
    }

    return this.normalizeLogEntries(entries);
  }

  private static normalizeLogEntries(payload: unknown): Array<string> {
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
          });
      }

      return [trimmed];
    }

    if (Buffer.isBuffer(payload)) {
      return this.normalizeLogEntries(payload.toString("utf-8"));
    }

    if (Array.isArray(payload)) {
      const results: Array<string> = [];

      for (const item of payload) {
        results.push(...this.normalizeLogEntries(item));
      }

      return results;
    }

    if (typeof payload === "object") {
      const obj: JSONObject = payload as JSONObject;

      if (obj["json"] !== undefined) {
        return this.normalizeLogEntries(obj["json"]);
      }

      if (obj["entries"] !== undefined) {
        return this.normalizeLogEntries(obj["entries"]);
      }

      if (obj["message"] !== undefined) {
        return this.normalizeLogEntries(obj["message"]);
      }

      if (obj["log"] !== undefined) {
        return this.normalizeLogEntries(obj["log"]);
      }

      try {
        return [JSON.stringify(obj)];
      } catch {
        return [];
      }
    }

    return [String(payload)];
  }

  private static async flushLogsBuffer(
    logs: Array<JSONObject>,
    force: boolean = false,
  ): Promise<void> {
    while (
      logs.length >= OPEN_TELEMETRY_INGEST_LOG_FLUSH_BATCH_SIZE ||
      (force && logs.length > 0)
    ) {
      const batchSize: number = Math.min(
        logs.length,
        OPEN_TELEMETRY_INGEST_LOG_FLUSH_BATCH_SIZE,
      );

      const batch: Array<JSONObject> = logs.splice(0, batchSize);

      if (batch.length === 0) {
        continue;
      }

      await LogService.insertJsonRows(batch);
    }
  }
}
