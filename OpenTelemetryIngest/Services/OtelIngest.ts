import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import OTelIngestService, {
  OtelAggregationTemporality,
  TelemetryServiceDataIngested,
} from "Common/Server/Services/OpenTelemetryIngestService";
import OneUptimeDate from "Common/Types/Date";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import JSONFunctions from "Common/Types/JSONFunctions";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import Text from "Common/Types/Text";
import LogService from "Common/Server/Services/LogService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Log from "Common/Models/AnalyticsModels/Log";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import LogSeverity from "Common/Types/Log/LogSeverity";
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
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import logger from "Common/Server/Utils/Logger";
import Metric, {
  MetricPointType,
  ServiceType,
} from "Common/Models/AnalyticsModels/Metric";
import MetricService from "Common/Server/Services/MetricService";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";

export default class OtelIngestService {
  @CaptureSpan()
  public static getServiceNameFromAttributes(attributes: JSONArray): string {
    for (const attribute of attributes) {
      if (
        attribute["key"] === "service.name" &&
        attribute["value"] &&
        (attribute["value"] as JSONObject)["stringValue"]
      ) {
        if (
          typeof (attribute["value"] as JSONObject)["stringValue"] === "string"
        ) {
          return (attribute["value"] as JSONObject)["stringValue"] as string;
        }
      }
    }

    return "Unknown Service";
  }

  @CaptureSpan()
  public static async ingestLogs(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!(req as TelemetryRequest).projectId) {
        throw new BadRequestException(
          "Invalid request - projectId not found in request."
        );
      }

      req.body = req.body.toJSON ? req.body.toJSON() : req.body;

      const resourceLogs: JSONArray = req.body["resourceLogs"] as JSONArray;

      const dbLogs: Array<Log> = [];

      let attributeKeySet: Set<string> = new Set<string>();

      const serviceDictionary: Dictionary<TelemetryServiceDataIngested> = {};

      for (const resourceLog of resourceLogs) {
        // get service name from resourceLog attributes

        const serviceName: string = this.getServiceNameFromAttributes(
          ((resourceLog["resource"] as JSONObject)?.[
            "attributes"
          ] as JSONArray) || []
        );

        logger.debug(`Service Name: ${serviceName}`);

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
            dataIngestedInGB: 0,
          };
        }

        let resourceAttributes: Dictionary<
          AttributeType | Array<AttributeType>
        > = TelemetryUtil.getAttributesForServiceIdAndServiceName({
          serviceId: serviceDictionary[serviceName]!.serviceId!,
          serviceName: serviceName,
        });

        if (
          resourceLog["resource"] &&
          (resourceLog["resource"] as JSONObject)["attributes"] &&
          ((resourceLog["resource"] as JSONObject)["attributes"] as JSONArray)
            .length > 0
        ) {
          resourceAttributes = {
            ...TelemetryUtil.getAttributes({
              items: (resourceLog["resource"] as JSONObject)[
                "attributes"
              ] as JSONArray,
              prefixKeysWithString: "resource",
            }),
          };
        }

        // size of req.body in bytes.
        const sizeInGb: number = JSONFunctions.getSizeOfJSONinGB(resourceLog);
        serviceDictionary[serviceName]!.dataIngestedInGB += sizeInGb;

        const scopeLogs: JSONArray = resourceLog["scopeLogs"] as JSONArray;

        for (const scopeLog of scopeLogs) {
          const logRecords: JSONArray = scopeLog["logRecords"] as JSONArray;

          for (const log of logRecords) {
            const dbLog: Log = new Log();

            /*
                              Example:
      
                              {
                                  "timeUnixNano":"1698069643739368000",
                                  "severityNumber":"SEVERITY_NUMBER_INFO",
                                  "severityText":"Information",
                                  "body":{
                                      "stringValue":"Application is shutting down..."
                                  },
                                  "traceId":"",
                                  "spanId":"",
                                  "observedTimeUnixNano":"1698069643739368000"
                              }
                              */

            //attributes

            let attributesObject: Dictionary<
              AttributeType | Array<AttributeType>
            > = {
              ...resourceAttributes,
            };

            if (
              scopeLog["scope"] &&
              Object.keys(scopeLog["scope"]).length > 0
            ) {
              // flatten the scope attributes
              const scopeAttributes: JSONObject = scopeLog[
                "scope"
              ] as JSONObject;
              for (const key of Object.keys(scopeAttributes)) {
                attributesObject[`scope.${key}`] = scopeAttributes[
                  key
                ] as AttributeType;
              }
            }

            dbLog.attributes = {
              ...attributesObject,
              ...TelemetryUtil.getAttributes({
                items: [],
                prefixKeysWithString: "logAttributes",
              }),
            };

            attributeKeySet = new Set<string>([
              ...attributeKeySet,
              ...Object.keys(dbLog.attributes),
            ]);

            dbLog.projectId = (req as TelemetryRequest).projectId;
            dbLog.serviceId = serviceDictionary[serviceName]!.serviceId!;

            dbLog.timeUnixNano = log["timeUnixNano"] as number;
            dbLog.time = OneUptimeDate.fromUnixNano(
              log["timeUnixNano"] as number
            );

            let logSeverityNumber: number =
              (log["severityNumber"] as number) || 0; // 0 is Unspecified by default.

            if (typeof logSeverityNumber === "string") {
              if (logSeverityNumber === "SEVERITY_NUMBER_TRACE") {
                logSeverityNumber = 1;
              } else if (logSeverityNumber === "SEVERITY_NUMBER_DEBUG") {
                logSeverityNumber = 5;
              } else if (logSeverityNumber === "SEVERITY_NUMBER_INFO") {
                logSeverityNumber = 9;
              } else if (logSeverityNumber === "SEVERITY_NUMBER_WARN") {
                logSeverityNumber = 13;
              } else if (logSeverityNumber === "SEVERITY_NUMBER_ERROR") {
                logSeverityNumber = 17;
              } else if (logSeverityNumber === "SEVERITY_NUMBER_FATAL") {
                logSeverityNumber = 21;
              } else {
                logSeverityNumber = parseInt(logSeverityNumber);
              }
            }

            dbLog.severityNumber = logSeverityNumber;

            let logSeverity: LogSeverity = LogSeverity.Unspecified;

            // these numbers are from the opentelemetry/api-logs package
            if (logSeverityNumber < 0 || logSeverityNumber > 24) {
              logSeverity = LogSeverity.Unspecified;
              logSeverityNumber = 0;
            } else if (logSeverityNumber >= 1 && logSeverityNumber <= 4) {
              logSeverity = LogSeverity.Trace;
            } else if (logSeverityNumber >= 5 && logSeverityNumber <= 8) {
              logSeverity = LogSeverity.Debug;
            } else if (logSeverityNumber >= 9 && logSeverityNumber <= 12) {
              logSeverity = LogSeverity.Information;
            } else if (logSeverityNumber >= 13 && logSeverityNumber <= 16) {
              logSeverity = LogSeverity.Warning;
            } else if (logSeverityNumber >= 17 && logSeverityNumber <= 20) {
              logSeverity = LogSeverity.Error;
            } else if (logSeverityNumber >= 21 && logSeverityNumber <= 24) {
              logSeverity = LogSeverity.Fatal;
            }

            dbLog.severityText = logSeverity;

            const logBody: JSONObject = log["body"] as JSONObject;

            dbLog.body = logBody["stringValue"] as string;

            dbLog.traceId = Text.convertBase64ToHex(log["traceId"] as string);
            dbLog.spanId = Text.convertBase64ToHex(log["spanId"] as string);

            logger.debug(`Log: ${JSON.stringify(dbLog, null, 2)}`);

            dbLogs.push(dbLog);
          }
        }
      }

      await LogService.createMany({
        items: dbLogs,
        props: {
          isRoot: true,
        },
      });

      logger.debug(`Attribute Key Set: ${JSON.stringify(attributeKeySet, null, 2)}`);

      await TelemetryUtil.indexAttributes({
        attributes: Object.keys(attributeKeySet),
        projectId: (req as TelemetryRequest).projectId,
        telemetryType: TelemetryType.Log,
      });

      await OTelIngestService.recordDataIngestedUsgaeBilling({
        services: serviceDictionary,
        projectId: (req as TelemetryRequest).projectId,
        productType: ProductType.Logs,
      });

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  }

  @CaptureSpan()
  public static async ingestMetrics(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!(req as TelemetryRequest).projectId) {
        throw new BadRequestException(
          "Invalid request - projectId not found in request."
        );
      }

      req.body = req.body.toJSON ? req.body.toJSON() : req.body;

      const resourceMetrics: JSONArray = req.body[
        "resourceMetrics"
      ] as JSONArray;

      const dbMetrics: Array<Metric> = new Array<Metric>();

      let attributeKeySet: Set<string> = new Set<string>();

      const serviceDictionary: Dictionary<TelemetryServiceDataIngested> = {};

      for (const resourceMetric of resourceMetrics) {
        // get service name from resourceMetric attributes

        const serviceName: string = this.getServiceNameFromAttributes(
          ((resourceMetric["resource"] as JSONObject)?.[
            "attributes"
          ] as JSONArray) || []
        );

        logger.debug(`Service Name: ${serviceName}`);

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
            dataIngestedInGB: 0,
          };
        }

        let resourceAttributes: Dictionary<
          AttributeType | Array<AttributeType>
        > = TelemetryUtil.getAttributesForServiceIdAndServiceName({
          serviceId: serviceDictionary[serviceName]!.serviceId!,
          serviceName: serviceName,
        });

        if (
          resourceMetric["resource"] &&
          (resourceMetric["resource"] as JSONObject)["attributes"] &&
          ((resourceMetric["resource"] as JSONObject)["attributes"] as JSONArray)
            .length > 0
        ) {
          resourceAttributes = {
            ...TelemetryUtil.getAttributes({
              items: (resourceMetric["resource"] as JSONObject)[
                "attributes"
              ] as JSONArray,
              prefixKeysWithString: "resource",
            }),
          };
        }

        // size of req.body in bytes.
        const sizeInGb: number =
          JSONFunctions.getSizeOfJSONinGB(resourceMetric);

        serviceDictionary[serviceName]!.dataIngestedInGB += sizeInGb;

        const scopeMetrics: JSONArray = resourceMetric[
          "scopeMetrics"
        ] as JSONArray;

        for (const scopeMetric of scopeMetrics) {
          const metrics: JSONArray = scopeMetric["metrics"] as JSONArray;

          for (const metric of metrics) {
            const metricName: string = metric["name"] as string;
            const metricDescription: string = metric["description"] as string;

            const metricUnit: string = metric["unit"] as string;

            const dbMetric: Metric = new Metric();

            dbMetric.projectId = (req as TelemetryRequest).projectId;
            dbMetric.serviceId = serviceDictionary[serviceName]!.serviceId!;

            dbMetric.serviceType = ServiceType.OpenTelemetry; // OpenTelemetry

            dbMetric.name = metricName;
            dbMetric.description = metricDescription;

            if (metricUnit) {
              dbMetric.unit = metricUnit;
            }

            let attributesObject: Dictionary<
              AttributeType | Array<AttributeType>
            > = {
              ...resourceAttributes,
            };

            if (
              scopeMetric["scope"] &&
              Object.keys(scopeMetric["scope"]).length > 0
            ) {
              // flatten the scope attributes
              const scopeAttributes: JSONObject = scopeMetric[
                "scope"
              ] as JSONObject;
              for (const key of Object.keys(scopeAttributes)) {
                attributesObject[`scope.${key}`] = scopeAttributes[
                  key
                ] as AttributeType;
              }
            }

            dbMetric.attributes = {
              ...attributesObject,
              ...TelemetryUtil.getAttributes({
                items: [],
                prefixKeysWithString: "metricAttributes",
              }),
            };

            attributeKeySet = new Set<string>([
              ...attributeKeySet,
              ...Object.keys(dbMetric.attributes),
            ]);

            if (
              metric["sum"] &&
              (metric["sum"] as JSONObject)["dataPoints"] &&
              ((metric["sum"] as JSONObject)["dataPoints"] as JSONArray)
                .length > 0
            ) {
              for (const datapoint of (metric["sum"] as JSONObject)[
                "dataPoints"
              ] as JSONArray) {
                const sumMetric: Metric =
                  OTelIngestService.getMetricFromDatapoint({
                    dbMetric: dbMetric,
                    datapoint: datapoint,
                    aggregationTemporality: (metric["sum"] as JSONObject)[
                      "aggregationTemporality"
                    ] as OtelAggregationTemporality,
                    isMonotonic: (metric["sum"] as JSONObject)[
                      "isMonotonic"
                    ] as boolean | undefined,
                    telemetryServiceId:
                      serviceDictionary[serviceName]!.serviceId!,
                    telemetryServiceName: serviceName,
                  });

                sumMetric.metricPointType = MetricPointType.Sum;


                dbMetrics.push(sumMetric);
              }
            } else if (
              metric["gauge"] &&
              (metric["gauge"] as JSONObject)["dataPoints"] &&
              ((metric["gauge"] as JSONObject)["dataPoints"] as JSONArray)
                .length > 0
            ) {
              for (const datapoint of (metric["gauge"] as JSONObject)[
                "dataPoints"
              ] as JSONArray) {
                const guageMetric: Metric =
                  OTelIngestService.getMetricFromDatapoint({
                    dbMetric: dbMetric,
                    datapoint: datapoint,
                    aggregationTemporality: (metric["gauge"] as JSONObject)[
                      "aggregationTemporality"
                    ] as OtelAggregationTemporality,
                    isMonotonic: (metric["gauge"] as JSONObject)[
                      "isMonotonic"
                    ] as boolean | undefined,
                    telemetryServiceId:
                      serviceDictionary[serviceName]!.serviceId!,
                    telemetryServiceName: serviceName,
                  });

                guageMetric.metricPointType = MetricPointType.Gauge;

                dbMetrics.push(guageMetric);
              }
            } else if (
              metric["histogram"] &&
              (metric["histogram"] as JSONObject)["dataPoints"] &&
              ((metric["histogram"] as JSONObject)["dataPoints"] as JSONArray)
                .length > 0
            ) {
              for (const datapoint of (metric["histogram"] as JSONObject)[
                "dataPoints"
              ] as JSONArray) {
                const histogramMetric: Metric =
                  OTelIngestService.getMetricFromDatapoint({
                    dbMetric: dbMetric,
                    datapoint: datapoint,
                    aggregationTemporality: (metric["histogram"] as JSONObject)[
                      "aggregationTemporality"
                    ] as OtelAggregationTemporality,
                    isMonotonic: (metric["histogram"] as JSONObject)[
                      "isMonotonic"
                    ] as boolean | undefined,
                    telemetryServiceId:
                      serviceDictionary[serviceName]!.serviceId!,
                    telemetryServiceName: serviceName,
                  });

                histogramMetric.metricPointType = MetricPointType.Histogram;

                dbMetrics.push(histogramMetric);
              }
            } else {
              logger.warn("Unknown metric type");
              logger.warn(metric);
            }
          }
        }
      }

      await MetricService.createMany({
        items: dbMetrics,
        props: {
          isRoot: true,
        },
      });

      await TelemetryUtil.indexAttributes({
        attributes: Object.keys(attributeKeySet),
        projectId: (req as TelemetryRequest).projectId,
        telemetryType: TelemetryType.Metric,
      });

      await OTelIngestService.recordDataIngestedUsgaeBilling({
        services: serviceDictionary,
        projectId: (req as TelemetryRequest).projectId,
        productType: ProductType.Metrics,
      });

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  }

  @CaptureSpan()
  public static async ingestTraces(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!(req as TelemetryRequest).projectId) {
        throw new BadRequestException(
          "Invalid request - projectId not found in request."
        );
      }

      req.body = req.body.toJSON ? req.body.toJSON() : req.body;

      const resourceSpans: JSONArray = req.body["resourceSpans"] as JSONArray;

      const dbSpans: Array<Span> = [];
      const dbExceptions: Array<ExceptionInstance> = [];

      let attributeKeySet: Set<string> = new Set<string>();

      const serviceDictionary: Dictionary<TelemetryServiceDataIngested> = {};

      for (const resourceSpan of resourceSpans) {
        // get service name from resourceSpan attributes

        const serviceName: string = this.getServiceNameFromAttributes(
          ((resourceSpan["resource"] as JSONObject)?.[
            "attributes"
          ] as JSONArray) || []
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
            dataIngestedInGB: 0,
          };
        }

        let resourceAttributes: Dictionary<
          AttributeType | Array<AttributeType>
        > = TelemetryUtil.getAttributesForServiceIdAndServiceName({
          serviceId: serviceDictionary[serviceName]!.serviceId!,
          serviceName: serviceName,
        });

        if (
          resourceSpan["resource"] &&
          (resourceSpan["resource"] as JSONObject)["attributes"] &&
          ((resourceSpan["resource"] as JSONObject)["attributes"] as JSONArray)
            .length > 0
        ) {
          resourceAttributes = {
            ...TelemetryUtil.getAttributes({
              items: (resourceSpan["resource"] as JSONObject)[
                "attributes"
              ] as JSONArray,
              prefixKeysWithString: "resource",
            }),
          };
        }

        // size of req.body in bytes.
        const sizeInGb: number = JSONFunctions.getSizeOfJSONinGB(resourceSpan);
        serviceDictionary[serviceName]!.dataIngestedInGB += sizeInGb;

        const scopeSpans: JSONArray = resourceSpan["scopeSpans"] as JSONArray;

        for (const scopeSpan of scopeSpans) {
          const spans: JSONArray = scopeSpan["spans"] as JSONArray;

          for (const span of spans) {
            const dbSpan: Span = new Span();

            let attributesObject: Dictionary<
              AttributeType | Array<AttributeType>
            > = {
              ...resourceAttributes,
            };

            if (
              scopeSpan["scope"] &&
              Object.keys(scopeSpan["scope"]).length > 0
            ) {
              // flatten the scope attributes
              const scopeAttributes: JSONObject = scopeSpan[
                "scope"
              ] as JSONObject;
              for (const key of Object.keys(scopeAttributes)) {
                attributesObject[`scope.${key}`] = scopeAttributes[
                  key
                ] as AttributeType;
              }
            }

            dbSpan.attributes = {
              ...attributesObject,
              ...TelemetryUtil.getAttributes({
                items: span["attributes"] as JSONArray,
                prefixKeysWithString: "spanAttributes",
              }),
            };

            attributeKeySet = new Set<string>([
              ...attributeKeySet,
              ...Object.keys(dbSpan.attributes),
            ]);

            dbSpan.projectId = (req as TelemetryRequest).projectId;
            dbSpan.serviceId = serviceDictionary[serviceName]!.serviceId!;

            dbSpan.spanId = Text.convertBase64ToHex(span["spanId"] as string);
            dbSpan.traceId = Text.convertBase64ToHex(span["traceId"] as string);
            dbSpan.parentSpanId = Text.convertBase64ToHex(
              span["parentSpanId"] as string
            );
            dbSpan.startTimeUnixNano = span["startTimeUnixNano"] as number;
            dbSpan.endTimeUnixNano = span["endTimeUnixNano"] as number;

            let spanStatusCode: SpanStatus = SpanStatus.Unset;

            if (
              span["status"] &&
              (span["status"] as JSONObject)?.["code"] &&
              typeof (span["status"] as JSONObject)?.["code"] === "number"
            ) {
              spanStatusCode = (span["status"] as JSONObject)?.[
                "code"
              ] as number;
            }

            if (
              span["status"] &&
              (span["status"] as JSONObject)?.["code"] &&
              typeof (span["status"] as JSONObject)?.["code"] === "string"
            ) {
              if (
                (span["status"] as JSONObject)?.["code"] === "STATUS_CODE_UNSET"
              ) {
                spanStatusCode = SpanStatus.Unset;
              } else if (
                (span["status"] as JSONObject)?.["code"] === "STATUS_CODE_OK"
              ) {
                spanStatusCode = SpanStatus.Ok;
              } else if (
                (span["status"] as JSONObject)?.["code"] === "STATUS_CODE_ERROR"
              ) {
                spanStatusCode = SpanStatus.Error;
              }
            }

            dbSpan.statusCode = spanStatusCode;

            dbSpan.statusMessage = (span["status"] as JSONObject)?.[
              "message"
            ] as string;

            dbSpan.startTime = OneUptimeDate.fromUnixNano(
              span["startTimeUnixNano"] as number
            );

            dbSpan.endTime = OneUptimeDate.fromUnixNano(
              span["endTimeUnixNano"] as number
            );

            dbSpan.durationUnixNano =
              (span["endTimeUnixNano"] as number) -
              (span["startTimeUnixNano"] as number);

            dbSpan.name = span["name"] as string;
            dbSpan.kind = (span["kind"] as SpanKind) || SpanKind.Internal;

            // add events

            if (span["events"] && span["events"] instanceof Array) {
              dbSpan.events = [];

              for (const event of span["events"] as JSONArray) {
                const eventTimeUnixNano: number = event[
                  "timeUnixNano"
                ] as number;
                const eventTime: Date =
                  OneUptimeDate.fromUnixNano(eventTimeUnixNano);

                const eventAttributes: JSONObject = TelemetryUtil.getAttributes(
                  {
                    items: event["attributes"] as JSONArray,
                    prefixKeysWithString: "",
                  }
                );

                dbSpan.events.push({
                  time: eventTime,
                  timeUnixNano: eventTimeUnixNano,
                  name: event["name"] as string,
                  attributes: eventAttributes,
                });

                if (event["name"] === SpanEventType.Exception) {
                  // add exception object.
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
                  const exceptionAttributes: JSONObject = {
                    ...eventAttributes,
                  };

                  for (const keys of Object.keys(exceptionAttributes)) {
                    // delete all keys that start with exception to avoid duplicate keys because we already saved it.
                    if (keys.startsWith("exception.")) {
                      delete exceptionAttributes[keys];
                    }
                  }

                  exception.attributes = exceptionAttributes;
                  exception.fingerprint =
                    ExceptionUtil.getFingerprint(exception);

                  // add exception to dbExceptions
                  dbExceptions.push(exception);

                  // save exception status
                  // maybe this can be improved instead of doing a lot of db calls.
                  await ExceptionUtil.saveOrUpdateTelemetryException(exception);
                }
              }
            }

            // add links

            if (span["links"] && span["links"] instanceof Array) {
              dbSpan.links = [];

              for (const link of span["links"] as JSONArray) {
                dbSpan.links.push({
                  traceId: Text.convertBase64ToHex(link["traceId"] as string),
                  spanId: Text.convertBase64ToHex(link["spanId"] as string),
                  attributes: TelemetryUtil.getAttributes({
                    items: link["attributes"] as JSONArray,
                    prefixKeysWithString
                      : "",
                  }),
                });
              }
            }


            attributeKeySet = new Set<string>([
              ...attributeKeySet,
              ...Object.keys(dbSpan.attributes || {}),
            ]);

            dbSpans.push(dbSpan);
          }
        }
      }

      await SpanService.createMany({
        items: dbSpans,
        props: {
          isRoot: true,
        },
      });

      await ExceptionInstanceService.createMany({
        items: dbExceptions,
        props: {
          isRoot: true,
        },
      });

      await TelemetryUtil.indexAttributes({
        attributes: Object.keys(attributeKeySet),
        projectId: (req as TelemetryRequest).projectId,
        telemetryType: TelemetryType.Trace,
      });

      await OTelIngestService.recordDataIngestedUsgaeBilling({
        services: serviceDictionary,
        projectId: (req as TelemetryRequest).projectId,
        productType: ProductType.Traces,
      });

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  }
}
