import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import OneUptimeDate from "Common/Types/Date";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Text from "Common/Types/Text";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import LogSeverity from "Common/Types/Log/LogSeverity";
import TelemetryUtil, {
  AttributeType,
} from "Common/Server/Utils/Telemetry/Telemetry";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import LogsQueueService from "./Queue/LogsQueueService";
import OtelIngestBaseService from "./OtelIngestBaseService";
import { OPEN_TELEMETRY_INGEST_LOG_FLUSH_BATCH_SIZE } from "../Config";
import LogService from "Common/Server/Services/LogService";

export default class OtelLogsIngestService extends OtelIngestBaseService {
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

  @CaptureSpan()
  public static async ingestLogs(
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

      req.body = req.body.toJSON ? req.body.toJSON() : req.body;

      Response.sendEmptySuccessResponse(req, res);

      await LogsQueueService.addLogIngestJob(req as TelemetryRequest);

      return;
    } catch (err) {
      return next(err);
    }
  }

  @CaptureSpan()
  public static async processLogsFromQueue(req: ExpressRequest): Promise<void> {
    await this.processLogsAsync(req);
  }

  @CaptureSpan()
  private static async processLogsAsync(req: ExpressRequest): Promise<void> {
    try {
      const resourceLogs: JSONArray = req.body["resourceLogs"] as JSONArray;

      if (!resourceLogs || !Array.isArray(resourceLogs)) {
        logger.error("Invalid resourceLogs format in request body");
        throw new BadRequestException("Invalid resourceLogs format");
      }

      const dbLogs: Array<JSONObject> = [];
      const serviceDictionary: Dictionary<TelemetryServiceMetadata> = {};
      let totalLogsProcessed: number = 0;

      let resourceLogCounter: number = 0;
      for (const resourceLog of resourceLogs) {
        try {
          if (resourceLogCounter % 50 === 0) {
            await Promise.resolve();
          }
          resourceLogCounter++;
          const serviceName: string = this.getServiceNameFromAttributes(
            req,
            ((resourceLog["resource"] as JSONObject)?.[
              "attributes"
            ] as JSONArray) || [],
          );

          if (!serviceDictionary[serviceName]) {
            const service: {
              serviceId: ObjectID;
              dataRententionInDays: number;
            } = await OTelIngestService.telemetryServiceFromName({
              serviceName: serviceName,
              projectId: (req as TelemetryRequest).projectId,
            });

            serviceDictionary[serviceName] = {
              serviceName: serviceName,
              serviceId: service.serviceId,
              dataRententionInDays: service.dataRententionInDays,
            };
          }

          const resourceAttributes: Dictionary<
            AttributeType | Array<AttributeType>
          > = {
            ...TelemetryUtil.getAttributesForServiceIdAndServiceName({
              serviceId: serviceDictionary[serviceName]!.serviceId!,
              serviceName: serviceName,
            }),
            ...TelemetryUtil.getAttributes({
              items:
                ((resourceLog["resource"] as JSONObject)?.[
                  "attributes"
                ] as JSONArray) || [],
              prefixKeysWithString: "resource",
            }),
          };
          const scopeLogs: JSONArray = resourceLog["scopeLogs"] as JSONArray;

          if (!scopeLogs || !Array.isArray(scopeLogs)) {
            logger.warn("Invalid scopeLogs format, skipping resource log");
            continue;
          }

          let scopeLogCounter: number = 0;
          for (const scopeLog of scopeLogs) {
            try {
              if (scopeLogCounter % 100 === 0) {
                await Promise.resolve();
              }
              scopeLogCounter++;
              const logRecords: JSONArray = scopeLog["logRecords"] as JSONArray;

              if (!logRecords || !Array.isArray(logRecords)) {
                logger.warn("Invalid logRecords format, skipping scope log");
                continue;
              }

              let logRecordCounter: number = 0;
              for (const log of logRecords) {
                try {
                  if (logRecordCounter % 500 === 0) {
                    await Promise.resolve();
                  }
                  logRecordCounter++;

                  const attributesObject: Dictionary<
                    AttributeType | Array<AttributeType>
                  > = {
                    ...resourceAttributes,
                    ...TelemetryUtil.getAttributes({
                      items: (log["attributes"] as JSONArray) || [],
                      prefixKeysWithString: "logAttributes",
                    }),
                  };

                  if (
                    scopeLog["scope"] &&
                    Object.keys(scopeLog["scope"]).length > 0
                  ) {
                    const scopeAttributes: JSONObject = scopeLog[
                      "scope"
                    ] as JSONObject;
                    for (const key of Object.keys(scopeAttributes)) {
                      attributesObject[`scope.${key}`] = scopeAttributes[
                        key
                      ] as AttributeType;
                    }
                  }

                  const attributeKeys: Array<string> =
                    TelemetryUtil.getAttributeKeys(attributesObject);

                  const projectId: ObjectID = (req as TelemetryRequest)
                    .projectId;
                  const serviceId: ObjectID =
                    serviceDictionary[serviceName]!.serviceId!;

                  let timeUnixNanoNumeric: number =
                    OneUptimeDate.getCurrentDateAsUnixNano();
                  let timeIsoString: string = OneUptimeDate.toString(
                    OneUptimeDate.getCurrentDate(),
                  );

                  if (log["timeUnixNano"]) {
                    try {
                      let timeUnixNano: number;
                      if (typeof log["timeUnixNano"] === "string") {
                        timeUnixNano = parseFloat(log["timeUnixNano"]);
                        if (isNaN(timeUnixNano)) {
                          throw new Error(
                            `Invalid timestamp string: ${log["timeUnixNano"]}`,
                          );
                        }
                      } else {
                        timeUnixNano =
                          (log["timeUnixNano"] as number) ||
                          OneUptimeDate.getCurrentDateAsUnixNano();
                      }

                      timeUnixNanoNumeric = timeUnixNano;
                      timeIsoString = OneUptimeDate.toString(
                        OneUptimeDate.fromUnixNano(timeUnixNano),
                      );
                    } catch (timeError) {
                      logger.warn(
                        `Error processing timestamp ${log["timeUnixNano"]}: ${timeError instanceof Error ? timeError.message : String(timeError)}, using current time`,
                      );
                      const currentTime: Date = OneUptimeDate.getCurrentDate();
                      timeUnixNanoNumeric =
                        OneUptimeDate.getCurrentDateAsUnixNano();
                      timeIsoString = OneUptimeDate.toString(currentTime);
                    }
                  } else {
                    const currentTime: Date = OneUptimeDate.getCurrentDate();
                    timeUnixNanoNumeric =
                      OneUptimeDate.getCurrentDateAsUnixNano();
                    timeIsoString = OneUptimeDate.toString(currentTime);
                  }

                  let logSeverityNumber: number =
                    (log["severityNumber"] as number) || 0;

                  if (typeof logSeverityNumber === "string") {
                    logSeverityNumber =
                      this.convertSeverityNumber(logSeverityNumber);
                  }

                  const severityText: LogSeverity =
                    this.getSeverityText(logSeverityNumber);

                  let body: string = "";
                  try {
                    const logBody: JSONObject = log["body"] as JSONObject;
                    if (
                      logBody &&
                      typeof logBody === "object" &&
                      logBody["stringValue"]
                    ) {
                      body = logBody["stringValue"] as string;
                    } else if (typeof log["body"] === "string") {
                      body = log["body"] as string;
                    } else {
                      body = JSON.stringify(log["body"] || "");
                    }
                  } catch (bodyError) {
                    logger.warn(
                      `Error processing log body: ${bodyError instanceof Error ? bodyError.message : String(bodyError)}`,
                    );
                    body = String(log["body"] || "");
                  }

                  let traceId: string = "";
                  try {
                    traceId = Text.convertBase64ToHex(log["traceId"] as string);
                  } catch {
                    traceId = "";
                  }

                  let spanId: string = "";
                  try {
                    spanId = Text.convertBase64ToHex(log["spanId"] as string);
                  } catch {
                    spanId = "";
                  }

                  const ingestionDate: Date = OneUptimeDate.getCurrentDate();
                  const timestampIso: string =
                    OneUptimeDate.toString(ingestionDate);

                  const logRow: JSONObject = {
                    _id: ObjectID.generate().toString(),
                    createdAt: timestampIso,
                    updatedAt: timestampIso,
                    projectId: projectId.toString(),
                    serviceId: serviceId.toString(),
                    time: timeIsoString,
                    timeUnixNano: Math.trunc(timeUnixNanoNumeric).toString(),
                    severityNumber: logSeverityNumber,
                    severityText: severityText,
                    attributes: attributesObject,
                    attributeKeys: attributeKeys,
                    traceId: traceId,
                    spanId: spanId,
                    body: body,
                  };

                  dbLogs.push(logRow);
                  totalLogsProcessed++;

                  if (
                    dbLogs.length >= OPEN_TELEMETRY_INGEST_LOG_FLUSH_BATCH_SIZE
                  ) {
                    await this.flushLogsBuffer(dbLogs);
                  }
                } catch (logError) {
                  logger.error("Error processing individual log record:");
                  logger.error(logError);
                  logger.error(`Log record data: ${JSON.stringify(log)}`);
                }
              }
            } catch (scopeError) {
              logger.error("Error processing scope log:");
              logger.error(scopeError);
              logger.error(`Scope log data: ${JSON.stringify(scopeLog)}`);
            }
          }
        } catch (resourceError) {
          logger.error("Error processing resource log:");
          logger.error(resourceError);
          logger.error(`Resource log data: ${JSON.stringify(resourceLog)}`);
        }
      }

      await this.flushLogsBuffer(dbLogs, true);

      if (totalLogsProcessed === 0) {
        logger.warn("No valid logs were processed from the request");
        return;
      }

      logger.debug(
        `Successfully processed ${totalLogsProcessed} logs for project: ${(req as TelemetryRequest).projectId}`,
      );

      try {
        dbLogs.length = 0;

        if (req.body) {
          req.body = null;
        }
      } catch (cleanupError) {
        logger.error("Error during memory cleanup:");
        logger.error(cleanupError);
      }
    } catch (error) {
      logger.error("Critical error in processLogsAsync:");
      logger.error(error);
      throw error;
    }
  }

  private static convertSeverityNumber(severityNumber: string): number {
    switch (severityNumber) {
      case "SEVERITY_NUMBER_TRACE":
        return 1;
      case "SEVERITY_NUMBER_DEBUG":
        return 5;
      case "SEVERITY_NUMBER_INFO":
        return 9;
      case "SEVERITY_NUMBER_WARN":
        return 13;
      case "SEVERITY_NUMBER_ERROR":
        return 17;
      case "SEVERITY_NUMBER_FATAL":
        return 21;
      default:
        return parseInt(severityNumber);
    }
  }

  private static getSeverityText(severityNumber: number): LogSeverity {
    if (severityNumber >= 1 && severityNumber <= 4) {
      return LogSeverity.Trace;
    } else if (severityNumber >= 5 && severityNumber <= 8) {
      return LogSeverity.Debug;
    } else if (severityNumber >= 9 && severityNumber <= 12) {
      return LogSeverity.Information;
    } else if (severityNumber >= 13 && severityNumber <= 16) {
      return LogSeverity.Warning;
    } else if (severityNumber >= 17 && severityNumber <= 20) {
      return LogSeverity.Error;
    } else if (severityNumber >= 21 && severityNumber <= 24) {
      return LogSeverity.Fatal;
    }
    return LogSeverity.Unspecified;
  }
}
