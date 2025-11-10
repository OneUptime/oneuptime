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
import {
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
  TELEMETRY_EXCEPTION_FLUSH_BATCH_SIZE,
  TELEMETRY_TRACE_FLUSH_BATCH_SIZE,
} from "../Config";

type ParsedUnixNano = {
  unixNano: number;
  nano: string;
  iso: string;
  date: Date;
};

type ExceptionEventPayload = {
  projectId: ObjectID;
  serviceId: ObjectID;
  spanId: string;
  traceId: string;
  spanStatusCode: SpanStatus;
  spanName: string;
  message: string;
  stackTrace: string;
  exceptionType: string;
  escaped: boolean | null;
  attributes: JSONObject;
  time: ParsedUnixNano;
  fingerprint: string;
};

export default class OtelTracesIngestService extends OtelIngestBaseService {
  private static async flushSpansBuffer(
    spans: Array<JSONObject>,
    force: boolean = false,
  ): Promise<void> {
    while (
      spans.length >= TELEMETRY_TRACE_FLUSH_BATCH_SIZE ||
      (force && spans.length > 0)
    ) {
      const batchSize: number = Math.min(
        spans.length,
        TELEMETRY_TRACE_FLUSH_BATCH_SIZE,
      );
      const batch: Array<JSONObject> = spans.splice(0, batchSize);

      if (batch.length === 0) {
        continue;
      }

      await SpanService.insertJsonRows(batch);
    }
  }

  private static async flushExceptionsBuffer(
    exceptions: Array<JSONObject>,
    force: boolean = false,
  ): Promise<void> {
    while (
      exceptions.length >= TELEMETRY_EXCEPTION_FLUSH_BATCH_SIZE ||
      (force && exceptions.length > 0)
    ) {
      const batchSize: number = Math.min(
        exceptions.length,
        TELEMETRY_EXCEPTION_FLUSH_BATCH_SIZE,
      );
      const batch: Array<JSONObject> = exceptions.splice(0, batchSize);

      if (batch.length === 0) {
        continue;
      }

      await ExceptionInstanceService.insertJsonRows(batch);
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

      const dbSpans: Array<JSONObject> = [];
      const dbExceptions: Array<JSONObject> = [];
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

                  const spanAttributes: Dictionary<
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
                      spanAttributes[`scope.${key}`] = scopeAttributes[
                        key
                      ] as AttributeType;
                    }
                  }

                  const attributeKeys: Array<string> =
                    TelemetryUtil.getAttributeKeys(spanAttributes);

                  const projectId: ObjectID = (req as TelemetryRequest)
                    .projectId;
                  const serviceId: ObjectID =
                    serviceDictionary[serviceName]!.serviceId!;

                  const spanId: string = this.convertBase64ToHexSafe(
                    span["spanId"] as string | undefined,
                  );
                  const traceId: string = this.convertBase64ToHexSafe(
                    span["traceId"] as string | undefined,
                  );
                  const parentSpanId: string = this.convertBase64ToHexSafe(
                    span["parentSpanId"] as string | undefined,
                  );

                  const startTime: ParsedUnixNano = this.safeParseUnixNano(
                    (span as JSONObject)["startTimeUnixNano"] as
                      | string
                      | number
                      | undefined,
                    "span startTimeUnixNano",
                  );
                  const endTime: ParsedUnixNano = this.safeParseUnixNano(
                    (span as JSONObject)["endTimeUnixNano"] as
                      | string
                      | number
                      | undefined,
                    "span endTimeUnixNano",
                  );

                  const durationUnixNano: string = this.calculateDurationNano(
                    startTime,
                    endTime,
                  );

                  let statusCode: SpanStatus = SpanStatus.Unset;
                  let statusMessage: string = "";
                  try {
                    statusCode = this.getSpanStatusCode(
                      span["status"] as JSONObject,
                    );
                    statusMessage =
                      ((span["status"] as JSONObject)?.["message"] as string) ||
                      "";
                  } catch (statusError) {
                    logger.warn(
                      `Error processing span status: ${statusError instanceof Error ? statusError.message : String(statusError)}`,
                    );
                  }

                  const spanName: string = (span["name"] as string) || "";
                  const spanKind: SpanKind =
                    (span["kind"] as SpanKind) || SpanKind.Internal;
                  const traceState: string =
                    (span["traceState"] as string) || "";

                  let spanEvents: Array<JSONObject> = [];
                  try {
                    spanEvents = this.getSpanEvents(
                      span["events"] as JSONArray,
                      {
                        projectId: projectId,
                        serviceId: serviceId,
                        spanId: spanId,
                        traceId: traceId,
                        spanStatusCode: statusCode,
                        spanName: spanName,
                      },
                      dbExceptions,
                    );
                  } catch (eventsError) {
                    logger.warn(
                      `Error processing span events: ${eventsError instanceof Error ? eventsError.message : String(eventsError)}`,
                    );
                    spanEvents = [];
                  }

                  let spanLinks: Array<JSONObject> = [];
                  try {
                    spanLinks = this.getSpanLinks(span["links"] as JSONArray);
                  } catch (linksError) {
                    logger.warn(
                      `Error processing span links: ${linksError instanceof Error ? linksError.message : String(linksError)}`,
                    );
                    spanLinks = [];
                  }

                  const spanRow: JSONObject = this.buildSpanRow({
                    projectId: projectId,
                    serviceId: serviceId,
                    attributes: spanAttributes,
                    attributeKeys: attributeKeys,
                    traceId: traceId,
                    spanId: spanId,
                    parentSpanId: parentSpanId,
                    traceState: traceState,
                    statusCode: statusCode,
                    statusMessage: statusMessage,
                    name: spanName,
                    kind: spanKind,
                    startTime: startTime,
                    endTime: endTime,
                    durationUnixNano: durationUnixNano,
                    events: spanEvents,
                    links: spanLinks,
                  });

                  dbSpans.push(spanRow);
                  totalSpansProcessed++;

                  if (dbSpans.length >= TELEMETRY_TRACE_FLUSH_BATCH_SIZE) {
                    await this.flushSpansBuffer(dbSpans);
                  }

                  if (
                    dbExceptions.length >= TELEMETRY_EXCEPTION_FLUSH_BATCH_SIZE
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
    spanContext: {
      projectId: ObjectID;
      serviceId: ObjectID;
      spanId: string;
      traceId: string;
      spanStatusCode: SpanStatus;
      spanName: string;
    },
    dbExceptions: Array<JSONObject>,
  ): Array<JSONObject> {
    const spanEvents: Array<JSONObject> = [];

    if (events && Array.isArray(events)) {
      for (const event of events) {
        try {
          const eventObject: JSONObject = event as JSONObject;
          const parsedTime: ParsedUnixNano = this.safeParseUnixNano(
            eventObject["timeUnixNano"] as string | number | undefined,
            "span event timeUnixNano",
          );

          const eventAttributes: JSONObject = TelemetryUtil.getAttributes({
            items: (eventObject["attributes"] as JSONArray) || [],
            prefixKeysWithString: "",
          });

          const eventName: string = (eventObject["name"] as string) || "";

          spanEvents.push({
            time: parsedTime.iso,
            timeUnixNano: parsedTime.nano,
            name: eventName,
            attributes: eventAttributes,
          });

          if (eventName === SpanEventType.Exception) {
            try {
              const message: string =
                (eventAttributes["exception.message"] as string) || "";
              const stackTrace: string =
                (eventAttributes["exception.stacktrace"] as string) || "";
              const exceptionType: string =
                (eventAttributes["exception.type"] as string) || "";

              const escapedParsed: boolean | null = this.toBoolean(
                eventAttributes["exception.escaped"],
              );
              const escaped: boolean | null =
                escapedParsed === null ? false : escapedParsed;

              const exceptionAttributes: JSONObject = { ...eventAttributes };
              for (const key of Object.keys(exceptionAttributes)) {
                if (key.startsWith("exception.")) {
                  delete exceptionAttributes[key];
                }
              }

              const fingerprint: string = ExceptionUtil.getFingerprint({
                projectId: spanContext.projectId,
                serviceId: spanContext.serviceId,
                message: message,
                stackTrace: stackTrace,
                exceptionType: exceptionType,
              });

              const exceptionData: ExceptionEventPayload = {
                projectId: spanContext.projectId,
                serviceId: spanContext.serviceId,
                spanId: spanContext.spanId,
                traceId: spanContext.traceId,
                spanStatusCode: spanContext.spanStatusCode,
                spanName: spanContext.spanName,
                message: message,
                stackTrace: stackTrace,
                exceptionType: exceptionType,
                escaped: escaped,
                attributes: exceptionAttributes,
                time: parsedTime,
                fingerprint: fingerprint,
              };

              dbExceptions.push(this.buildExceptionRow(exceptionData));

              ExceptionUtil.saveOrUpdateTelemetryException({
                fingerprint: fingerprint,
                projectId: spanContext.projectId,
                serviceId: spanContext.serviceId,
                ...(exceptionType
                  ? {
                      exceptionType: exceptionType,
                    }
                  : {}),
                ...(message
                  ? {
                      message: message,
                    }
                  : {}),
                ...(stackTrace
                  ? {
                      stackTrace: stackTrace,
                    }
                  : {}),
              }).catch((err: Error) => {
                logger.error("Error saving/updating telemetry exception:");
                logger.error(err);
              });
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

  private static getSpanLinks(links: JSONArray): Array<JSONObject> {
    const spanLinks: Array<JSONObject> = [];

    if (links && Array.isArray(links)) {
      for (const link of links) {
        try {
          const linkObject: JSONObject = link as JSONObject;
          spanLinks.push({
            traceId: this.convertBase64ToHexSafe(
              linkObject["traceId"] as string | undefined,
            ),
            spanId: this.convertBase64ToHexSafe(
              linkObject["spanId"] as string | undefined,
            ),
            attributes: TelemetryUtil.getAttributes({
              items: (linkObject["attributes"] as JSONArray) || [],
              prefixKeysWithString: "",
            }),
          });
        } catch (linkError) {
          logger.warn(
            `Error processing span link: ${linkError instanceof Error ? linkError.message : String(linkError)}`,
          );
        }
      }
    }

    return spanLinks;
  }

  private static buildSpanRow(data: {
    projectId: ObjectID;
    serviceId: ObjectID;
    attributes: Dictionary<AttributeType | Array<AttributeType>>;
    attributeKeys: Array<string>;
    traceId: string;
    spanId: string;
    parentSpanId: string;
    traceState: string;
    statusCode: SpanStatus;
    statusMessage: string;
    name: string;
    kind: SpanKind;
    startTime: ParsedUnixNano;
    endTime: ParsedUnixNano;
    durationUnixNano: string;
    events: Array<JSONObject>;
    links: Array<JSONObject>;
  }): JSONObject {
    const ingestionDate: Date = OneUptimeDate.getCurrentDate();
    const ingestionTimestamp: string =
      OneUptimeDate.toClickhouseDateTime(ingestionDate);

    return {
      _id: ObjectID.generate().toString(),
      createdAt: ingestionTimestamp,
      updatedAt: ingestionTimestamp,
      projectId: data.projectId.toString(),
      serviceId: data.serviceId.toString(),
      startTime: OneUptimeDate.toClickhouseDateTime(data.startTime.date),
      endTime: OneUptimeDate.toClickhouseDateTime(data.endTime.date),
      startTimeUnixNano: data.startTime.nano,
      endTimeUnixNano: data.endTime.nano,
      durationUnixNano: data.durationUnixNano,
      traceId: data.traceId,
      spanId: data.spanId,
      parentSpanId: data.parentSpanId,
      traceState: data.traceState || "",
      attributes: data.attributes,
      attributeKeys: data.attributeKeys,
      statusCode: Number(data.statusCode),
      statusMessage: data.statusMessage || "",
      name: data.name,
      kind: data.kind,
      events: data.events,
      links: data.links,
    };
  }

  private static buildExceptionRow(data: ExceptionEventPayload): JSONObject {
    const ingestionDate: Date = OneUptimeDate.getCurrentDate();
    const ingestionTimestamp: string =
      OneUptimeDate.toClickhouseDateTime(ingestionDate);

    return {
      _id: ObjectID.generate().toString(),
      createdAt: ingestionTimestamp,
      updatedAt: ingestionTimestamp,
      projectId: data.projectId.toString(),
      serviceId: data.serviceId.toString(),
      time: OneUptimeDate.toClickhouseDateTime(data.time.date),
      timeUnixNano: data.time.nano,
      exceptionType: data.exceptionType || "",
      stackTrace: data.stackTrace || "",
      message: data.message || "",
      spanStatusCode: Number(data.spanStatusCode),
      escaped:
        data.escaped === null || data.escaped === undefined
          ? null
          : Boolean(data.escaped),
      traceId: data.traceId || "",
      spanId: data.spanId || "",
      fingerprint: data.fingerprint,
      spanName: data.spanName || "",
      attributes: data.attributes || {},
    };
  }

  private static safeParseUnixNano(
    value: string | number | undefined,
    context: string,
  ): ParsedUnixNano {
    let numericValue: number = OneUptimeDate.getCurrentDateAsUnixNano();

    if (value !== undefined && value !== null) {
      try {
        if (typeof value === "string") {
          const parsed: number = Number.parseFloat(value);
          if (!Number.isNaN(parsed)) {
            numericValue = parsed;
          } else {
            throw new Error(`Invalid timestamp string: ${value}`);
          }
        } else if (typeof value === "number") {
          if (!Number.isFinite(value)) {
            throw new Error(`Invalid timestamp number: ${value}`);
          }
          numericValue = value;
        }
      } catch (error) {
        logger.warn(
          `Error processing ${context}: ${error instanceof Error ? error.message : String(error)}, using current time`,
        );
        numericValue = OneUptimeDate.getCurrentDateAsUnixNano();
      }
    }

    numericValue = Math.trunc(numericValue);
    const date: Date = OneUptimeDate.fromUnixNano(numericValue);
    const iso: string = OneUptimeDate.toString(date);

    return {
      unixNano: numericValue,
      nano: numericValue.toString(),
      iso: iso,
      date: date,
    };
  }

  private static calculateDurationNano(
    start: ParsedUnixNano,
    end: ParsedUnixNano,
  ): string {
    const duration: number = Math.max(
      0,
      Math.trunc(end.unixNano - start.unixNano),
    );
    return duration.toString();
  }

  private static convertBase64ToHexSafe(value: string | undefined): string {
    if (!value) {
      return "";
    }

    try {
      return Text.convertBase64ToHex(value);
    } catch {
      return "";
    }
  }

  private static toBoolean(value: unknown): boolean | null {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalized: string = value.trim().toLowerCase();
      if (normalized === "true") {
        return true;
      }
      if (normalized === "false") {
        return false;
      }
    }

    return null;
  }
}
