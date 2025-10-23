import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import OneUptimeDate from "Common/Types/Date";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import TelemetryUtil, {
  AttributeType,
} from "Common/Server/Utils/Telemetry/Telemetry";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Span, {
  SpanEventType,
  SpanKind,
  SpanStatus,
} from "Common/Models/AnalyticsModels/Span";
import ExceptionUtil from "../Utils/Exception";
import logger from "Common/Server/Utils/Logger";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import Text from "Common/Types/Text";
import TracesQueueService from "./Queue/TracesQueueService";
import OtelIngestBaseService from "./OtelIngestBaseService";
import {
  OPEN_TELEMETRY_INGEST_EXCEPTION_FLUSH_BATCH_SIZE,
  OPEN_TELEMETRY_INGEST_TRACE_FLUSH_BATCH_SIZE,
} from "../Config";

export default class OtelTracesIngestService extends OtelIngestBaseService {
  private static async flushSpansBuffer(
    spans: Array<Span>,
    force: boolean = false,
  ): Promise<void> {
    while (
      spans.length >= OPEN_TELEMETRY_INGEST_TRACE_FLUSH_BATCH_SIZE ||
      (force && spans.length > 0)
    ) {
      const batchSize: number = Math.min(
        spans.length,
        OPEN_TELEMETRY_INGEST_TRACE_FLUSH_BATCH_SIZE,
      );
      const batch: Array<Span> = spans.splice(0, batchSize);

      if (batch.length === 0) {
        continue;
      }

      await SpanService.createMany({
        items: batch,
        props: {
          isRoot: true,
        },
      });
    }
  }

  private static async flushExceptionsBuffer(
    exceptions: Array<ExceptionInstance>,
    force: boolean = false,
  ): Promise<void> {
    while (
      exceptions.length >= OPEN_TELEMETRY_INGEST_EXCEPTION_FLUSH_BATCH_SIZE ||
      (force && exceptions.length > 0)
    ) {
      const batchSize: number = Math.min(
        exceptions.length,
        OPEN_TELEMETRY_INGEST_EXCEPTION_FLUSH_BATCH_SIZE,
      );
      const batch: Array<ExceptionInstance> = exceptions.splice(0, batchSize);

      if (batch.length === 0) {
        continue;
      }

      await ExceptionInstanceService.createMany({
        items: batch,
        props: {
          isRoot: true,
        },
      });
    }
  }

  @CaptureSpan()
  public static async ingestTraces(
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

      await TracesQueueService.addTraceIngestJob(req as TelemetryRequest);

      return;
    } catch (err) {
      return next(err);
    }
  }

  @CaptureSpan()
  public static async processTracesFromQueue(
    req: ExpressRequest,
  ): Promise<void> {
    await this.processTracesAsync(req);
  }

  @CaptureSpan()
  private static async processTracesAsync(req: ExpressRequest): Promise<void> {
    try {
      const resourceSpans: JSONArray = req.body["resourceSpans"] as JSONArray;

      if (!resourceSpans || !Array.isArray(resourceSpans)) {
        logger.error("Invalid resourceSpans format in request body");
        throw new BadRequestException("Invalid resourceSpans format");
      }

      const dbSpans: Array<Span> = [];
      const dbExceptions: Array<ExceptionInstance> = [];
      const serviceDictionary: Dictionary<TelemetryServiceMetadata> = {};
      let totalSpansProcessed: number = 0;

      let resourceSpanCounter: number = 0;
      for (const resourceSpan of resourceSpans) {
        try {
          if (resourceSpanCounter % 25 === 0) {
            await Promise.resolve();
          }
          resourceSpanCounter++;
          const serviceName: string = this.getServiceNameFromAttributes(
            req,
            ((resourceSpan["resource"] as JSONObject)?.[
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
                ((resourceSpan["resource"] as JSONObject)?.[
                  "attributes"
                ] as JSONArray) || [],
              prefixKeysWithString: "resource",
            }),
          };

          const scopeSpans: JSONArray = resourceSpan["scopeSpans"] as JSONArray;

          if (!scopeSpans || !Array.isArray(scopeSpans)) {
            logger.warn("Invalid scopeSpans format, skipping resource span");
            continue;
          }

          let scopeSpanCounter: number = 0;
          for (const scopeSpan of scopeSpans) {
            try {
              if (scopeSpanCounter % 50 === 0) {
                await Promise.resolve();
              }
              scopeSpanCounter++;
              const spans: JSONArray = scopeSpan["spans"] as JSONArray;

              if (!spans || !Array.isArray(spans)) {
                logger.warn("Invalid spans format, skipping scope span");
                continue;
              }

              let spanCounter: number = 0;
              for (const span of spans) {
                try {
                  if (spanCounter % 200 === 0) {
                    await Promise.resolve();
                  }
                  spanCounter++;
                  const dbSpan: Span = new Span();

                  const attributesObject: Dictionary<
                    AttributeType | Array<AttributeType>
                  > = {
                    ...resourceAttributes,
                    ...TelemetryUtil.getAttributes({
                      items: (span["attributes"] as JSONArray) || [],
                      prefixKeysWithString: "spanAttributes",
                    }),
                  };

                  if (
                    scopeSpan["scope"] &&
                    Object.keys(scopeSpan["scope"]).length > 0
                  ) {
                    const scopeAttributes: JSONObject = scopeSpan[
                      "scope"
                    ] as JSONObject;
                    for (const key of Object.keys(scopeAttributes)) {
                      attributesObject[`scope.${key}`] = scopeAttributes[
                        key
                      ] as AttributeType;
                    }
                  }

                  dbSpan.attributes = attributesObject;
                  dbSpan.attributeKeys =
                    TelemetryUtil.getAttributeKeys(attributesObject);

                  dbSpan.projectId = (req as TelemetryRequest).projectId;
                  dbSpan.serviceId = serviceDictionary[serviceName]!.serviceId!;

                  try {
                    dbSpan.spanId = Text.convertBase64ToHex(
                      span["spanId"] as string,
                    );
                  } catch {
                    dbSpan.spanId = "";
                  }

                  try {
                    dbSpan.traceId = Text.convertBase64ToHex(
                      span["traceId"] as string,
                    );
                  } catch {
                    dbSpan.traceId = "";
                  }

                  try {
                    dbSpan.parentSpanId = Text.convertBase64ToHex(
                      span["parentSpanId"] as string,
                    );
                  } catch {
                    dbSpan.parentSpanId = "";
                  }

                  try {
                    let startTimeUnixNano: number;
                    if (typeof span["startTimeUnixNano"] === "string") {
                      startTimeUnixNano = parseFloat(span["startTimeUnixNano"]);
                      if (isNaN(startTimeUnixNano)) {
                        throw new Error(
                          `Invalid start timestamp string: ${span["startTimeUnixNano"]}`,
                        );
                      }
                    } else {
                      startTimeUnixNano =
                        (span["startTimeUnixNano"] as number) ||
                        OneUptimeDate.getCurrentDateAsUnixNano();
                    }

                    let endTimeUnixNano: number;
                    if (typeof span["endTimeUnixNano"] === "string") {
                      endTimeUnixNano = parseFloat(span["endTimeUnixNano"]);
                      if (isNaN(endTimeUnixNano)) {
                        throw new Error(
                          `Invalid end timestamp string: ${span["endTimeUnixNano"]}`,
                        );
                      }
                    } else {
                      endTimeUnixNano =
                        (span["endTimeUnixNano"] as number) ||
                        OneUptimeDate.getCurrentDateAsUnixNano();
                    }

                    dbSpan.startTimeUnixNano = startTimeUnixNano;
                    dbSpan.endTimeUnixNano = endTimeUnixNano;

                    dbSpan.startTime =
                      OneUptimeDate.fromUnixNano(startTimeUnixNano);
                    dbSpan.endTime =
                      OneUptimeDate.fromUnixNano(endTimeUnixNano);

                    dbSpan.durationUnixNano =
                      endTimeUnixNano - startTimeUnixNano;
                  } catch (timeError) {
                    logger.warn(
                      `Error processing span timestamps: ${timeError instanceof Error ? timeError.message : String(timeError)}, using current time`,
                    );
                    const currentNano: number =
                      OneUptimeDate.getCurrentDateAsUnixNano();
                    const currentTime: Date = OneUptimeDate.getCurrentDate();
                    dbSpan.startTimeUnixNano = currentNano;
                    dbSpan.endTimeUnixNano = currentNano;
                    dbSpan.startTime = currentTime;
                    dbSpan.endTime = currentTime;
                    dbSpan.durationUnixNano = 0;
                  }

                  try {
                    dbSpan.statusCode = this.getSpanStatusCode(
                      span["status"] as JSONObject,
                    );
                    dbSpan.statusMessage = (span["status"] as JSONObject)?.[
                      "message"
                    ] as string;
                  } catch {
                    dbSpan.statusCode = SpanStatus.Unset;
                    dbSpan.statusMessage = "";
                  }

                  dbSpan.name = (span["name"] as string) || "";
                  dbSpan.kind = (span["kind"] as SpanKind) || SpanKind.Internal;

                  try {
                    dbSpan.events = this.getSpanEvents(
                      span["events"] as JSONArray,
                      dbSpan,
                      dbExceptions,
                    );
                  } catch (eventsError) {
                    logger.warn(
                      `Error processing span events: ${eventsError instanceof Error ? eventsError.message : String(eventsError)}`,
                    );
                    dbSpan.events = [];
                  }

                  try {
                    dbSpan.links = this.getSpanLinks(
                      span["links"] as JSONArray,
                    );
                  } catch (linksError) {
                    logger.warn(
                      `Error processing span links: ${linksError instanceof Error ? linksError.message : String(linksError)}`,
                    );
                    dbSpan.links = [];
                  }

                  dbSpans.push(dbSpan);
                  totalSpansProcessed++;

                  if (
                    dbSpans.length >=
                    OPEN_TELEMETRY_INGEST_TRACE_FLUSH_BATCH_SIZE
                  ) {
                    await this.flushSpansBuffer(dbSpans);
                  }

                  if (
                    dbExceptions.length >=
                    OPEN_TELEMETRY_INGEST_EXCEPTION_FLUSH_BATCH_SIZE
                  ) {
                    await this.flushExceptionsBuffer(dbExceptions);
                  }
                } catch (spanError) {
                  logger.error("Error processing individual span:");
                  logger.error(spanError);
                  logger.error(`Span data: ${JSON.stringify(span)}`);
                }
              }
            } catch (scopeError) {
              logger.error("Error processing scope span:");
              logger.error(scopeError);
              logger.error(`Scope span data: ${JSON.stringify(scopeSpan)}`);
            }
          }
        } catch (resourceError) {
          logger.error("Error processing resource span:");
          logger.error(resourceError);
          logger.error(`Resource span data: ${JSON.stringify(resourceSpan)}`);
        }
      }

      await Promise.all([
        this.flushSpansBuffer(dbSpans, true),
        this.flushExceptionsBuffer(dbExceptions, true),
      ]);

      if (totalSpansProcessed === 0) {
        logger.warn("No valid spans were processed from the request");
        return;
      }

      logger.debug(
        `Successfully processed ${totalSpansProcessed} spans for project: ${(req as TelemetryRequest).projectId}`,
      );

      try {
        dbSpans.length = 0;
        dbExceptions.length = 0;
        if (req.body) {
          req.body = null;
        }
      } catch (cleanupError) {
        logger.error("Error during memory cleanup:");
        logger.error(cleanupError);
      }
    } catch (error) {
      logger.error("Critical error in processTracesAsync:");
      logger.error(error);
      throw error;
    }
  }

  private static getSpanStatusCode(status: JSONObject): SpanStatus {
    let spanStatusCode: SpanStatus = SpanStatus.Unset;

    if (status?.["code"] && typeof status["code"] === "number") {
      spanStatusCode = status["code"] as number;
    } else if (status?.["code"] && typeof status["code"] === "string") {
      if (status["code"] === "STATUS_CODE_UNSET") {
        spanStatusCode = SpanStatus.Unset;
      } else if (status["code"] === "STATUS_CODE_OK") {
        spanStatusCode = SpanStatus.Ok;
      } else if (status["code"] === "STATUS_CODE_ERROR") {
        spanStatusCode = SpanStatus.Error;
      }
    }

    return spanStatusCode;
  }

  private static getSpanEvents(
    events: JSONArray,
    dbSpan: Span,
    dbExceptions: Array<ExceptionInstance>,
  ): Array<any> {
    const spanEvents: Array<any> = [];

    if (events && events instanceof Array) {
      for (const event of events) {
        try {
          let eventTimeUnixNano: number;
          if (typeof event["timeUnixNano"] === "string") {
            eventTimeUnixNano = parseFloat(event["timeUnixNano"]);
            if (isNaN(eventTimeUnixNano)) {
              eventTimeUnixNano = OneUptimeDate.getCurrentDateAsUnixNano();
            }
          } else {
            eventTimeUnixNano =
              (event["timeUnixNano"] as number) ||
              OneUptimeDate.getCurrentDateAsUnixNano();
          }

          const eventTime: Date = OneUptimeDate.fromUnixNano(eventTimeUnixNano);

          const eventAttributes: JSONObject = TelemetryUtil.getAttributes({
            items: (event["attributes"] as JSONArray) || [],
            prefixKeysWithString: "",
          });

          spanEvents.push({
            time: eventTime,
            timeUnixNano: eventTimeUnixNano,
            name: (event["name"] as string) || "",
            attributes: eventAttributes,
          });

          if (event["name"] === SpanEventType.Exception) {
            try {
              const exception: ExceptionInstance = new ExceptionInstance();
              exception.projectId = dbSpan.projectId;
              exception.serviceId = dbSpan.serviceId;
              exception.spanId = dbSpan.spanId;
              exception.traceId = dbSpan.traceId;
              exception.time = eventTime;
              exception.timeUnixNano = eventTimeUnixNano;
              exception.spanStatusCode = dbSpan.statusCode;
              exception.spanName = dbSpan.name;
              exception.message =
                (eventAttributes["exception.message"] as string) || "";
              exception.stackTrace =
                (eventAttributes["exception.stacktrace"] as string) || "";
              exception.exceptionType =
                (eventAttributes["exception.type"] as string) || "";
              exception.escaped =
                (eventAttributes["exception.escaped"] as boolean) || false;
              const exceptionAttributes: JSONObject = { ...eventAttributes };

              for (const keys of Object.keys(exceptionAttributes)) {
                if (keys.startsWith("exception.")) {
                  delete exceptionAttributes[keys];
                }
              }

              exception.attributes = exceptionAttributes;
              exception.fingerprint = ExceptionUtil.getFingerprint(exception);

              dbExceptions.push(exception);

              ExceptionUtil.saveOrUpdateTelemetryException(exception).catch(
                (err: Error) => {
                  logger.error("Error saving/updating telemetry exception:");
                  logger.error(err);
                },
              );
            } catch (exceptionError) {
              logger.warn(
                `Error processing span exception event: ${exceptionError instanceof Error ? exceptionError.message : String(exceptionError)}`,
              );
            }
          }
        } catch (eventError) {
          logger.warn(
            `Error processing span event: ${eventError instanceof Error ? eventError.message : String(eventError)}`,
          );
        }
      }
    }

    return spanEvents;
  }

  private static getSpanLinks(links: JSONArray): Array<any> {
    const spanLinks: Array<any> = [];

    if (links && links instanceof Array) {
      for (const link of links) {
        spanLinks.push({
          traceId: Text.convertBase64ToHex(link["traceId"] as string),
          spanId: Text.convertBase64ToHex(link["spanId"] as string),
          attributes: TelemetryUtil.getAttributes({
            items: link["attributes"] as JSONArray,
            prefixKeysWithString: "",
          }),
        });
      }
    }

    return spanLinks;
  }
}
