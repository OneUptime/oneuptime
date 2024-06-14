import TelemetryIngest, {
  TelemetryRequest,
} from "../Middleware/TelemetryIngest";
import OTelIngestService, {
  OtelAggregationTemporality,
} from "../Service/OTelIngest";
import OneUptimeDate from "Common/Types/Date";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import Text from "Common/Types/Text";
import LogService from "CommonServer/Services/LogService";
import MetricService from "CommonServer/Services/MetricService";
import SpanService from "CommonServer/Services/SpanService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "CommonServer/Utils/Express";
import logger from "CommonServer/Utils/Logger";
import Response from "CommonServer/Utils/Response";
import Log, { LogSeverity } from "Model/AnalyticsModels/Log";
import Metric, { MetricPointType } from "Model/AnalyticsModels/Metric";
import Span, { SpanKind, SpanStatus } from "Model/AnalyticsModels/Span";
import protobuf from "protobufjs";

// Load proto file for OTel

// Create a root namespace
const LogsProto: protobuf.Root = protobuf.loadSync(
  "/usr/src/app/ProtoFiles/OTel/v1/logs.proto",
);

const TracesProto: protobuf.Root = protobuf.loadSync(
  "/usr/src/app/ProtoFiles/OTel/v1/traces.proto",
);

const MetricsProto: protobuf.Root = protobuf.loadSync(
  "/usr/src/app/ProtoFiles/OTel/v1/metrics.proto",
);

// Lookup the message type
const LogsData: protobuf.Type = LogsProto.lookupType("LogsData");
const TracesData: protobuf.Type = TracesProto.lookupType("TracesData");
const MetricsData: protobuf.Type = MetricsProto.lookupType("MetricsData");

const router: ExpressRouter = Express.getRouter();

/**
 *
 *  Otel Middleware
 *
 */

class OpenTelemetryRequestMiddleware {
  public static async getProductType(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      let productType: ProductType;

      const isProtobuf: boolean = req.body instanceof Uint8Array;

      if (req.url.includes("/otlp/v1/traces")) {
        if (isProtobuf) {
          req.body = TracesData.decode(req.body);
        }
        productType = ProductType.Traces;
      } else if (req.url.includes("/otlp/v1/logs")) {
        if (isProtobuf) {
          req.body = LogsData.decode(req.body);
        }
        productType = ProductType.Logs;
      } else if (req.url.includes("/otlp/v1/metrics")) {
        if (isProtobuf) {
          req.body = MetricsData.decode(req.body);
        }
        productType = ProductType.Metrics;
      } else {
        throw new BadRequestException("Invalid URL: " + req.baseUrl);
      }

      (req as TelemetryRequest).productType = productType;
      next();
    } catch (err) {
      return next(err);
    }
  }
}

router.post(
  "/otlp/v1/traces",
  OpenTelemetryRequestMiddleware.getProductType,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (
        !(req as TelemetryRequest).projectId ||
        !(req as TelemetryRequest).serviceId
      ) {
        throw new BadRequestException(
          "Invalid request - projectId or serviceId not found in request.",
        );
      }

      const traceData: JSONObject = req.body.toJSON
        ? req.body.toJSON()
        : req.body;
      const resourceSpans: JSONArray = traceData["resourceSpans"] as JSONArray;

      const dbSpans: Array<Span> = [];

      for (const resourceSpan of resourceSpans) {
        const scopeSpans: JSONArray = resourceSpan["scopeSpans"] as JSONArray;

        for (const scopeSpan of scopeSpans) {
          const spans: JSONArray = scopeSpan["spans"] as JSONArray;

          for (const span of spans) {
            const dbSpan: Span = new Span();

            // attrbibutes
            const attributesObject: JSONObject = {};

            if (
              resourceSpan["resource"] &&
              (resourceSpan["resource"] as JSONObject)["attributes"] &&
              (
                (resourceSpan["resource"] as JSONObject)[
                  "attributes"
                ] as JSONArray
              ).length > 0
            ) {
              attributesObject["resource"] = OTelIngestService.getAttributes(
                (resourceSpan["resource"] as JSONObject)[
                  "attributes"
                ] as JSONArray,
              );
            }

            // scope attributes

            if (
              scopeSpan["scope"] &&
              Object.keys(scopeSpan["scope"]).length > 0
            ) {
              attributesObject["scope"] = scopeSpan["scope"] as JSONObject;
            }

            dbSpan.attributes = {
              ...attributesObject,
              ...OTelIngestService.getAttributes(
                span["attributes"] as JSONArray,
              ),
            };

            dbSpan.projectId = (req as TelemetryRequest).projectId;
            dbSpan.serviceId = (req as TelemetryRequest).serviceId;

            dbSpan.spanId = Text.convertBase64ToHex(span["spanId"] as string);
            dbSpan.traceId = Text.convertBase64ToHex(span["traceId"] as string);
            dbSpan.parentSpanId = Text.convertBase64ToHex(
              span["parentSpanId"] as string,
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
              span["startTimeUnixNano"] as number,
            );

            dbSpan.endTime = OneUptimeDate.fromUnixNano(
              span["endTimeUnixNano"] as number,
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

                dbSpan.events.push({
                  time: eventTime,
                  timeUnixNano: eventTimeUnixNano,
                  name: event["name"] as string,
                  attributes: OTelIngestService.getAttributes(
                    event["attributes"] as JSONArray,
                  ),
                });
              }
            }

            // add links

            if (span["links"] && span["links"] instanceof Array) {
              dbSpan.links = [];

              for (const link of span["links"] as JSONArray) {
                dbSpan.links.push({
                  traceId: Text.convertBase64ToHex(link["traceId"] as string),
                  spanId: Text.convertBase64ToHex(link["spanId"] as string),
                  attributes: OTelIngestService.getAttributes(
                    link["attributes"] as JSONArray,
                  ),
                });
              }
            }

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

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/otlp/v1/metrics",
  OpenTelemetryRequestMiddleware.getProductType,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (
        !(req as TelemetryRequest).projectId ||
        !(req as TelemetryRequest).serviceId
      ) {
        throw new BadRequestException(
          "Invalid request - projectId or serviceId not found in request.",
        );
      }

      req.body = req.body.toJSON ? req.body.toJSON() : req.body;

      const resourceMetrics: JSONArray = req.body[
        "resourceMetrics"
      ] as JSONArray;

      const dbMetrics: Array<Metric> = new Array<Metric>();

      for (const resourceMetric of resourceMetrics) {
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
            dbMetric.serviceId = (req as TelemetryRequest).serviceId;

            dbMetric.name = metricName;
            dbMetric.description = metricDescription;

            if (metricUnit) {
              dbMetric.unit = metricUnit;
            }

            let attributesObject: JSONObject = {};

            if (
              metric["attributes"] &&
              metric["attributes"] instanceof Array &&
              metric["attributes"].length > 0
            ) {
              attributesObject = {
                ...OTelIngestService.getAttributes(
                  metric["attributes"] as JSONArray,
                ),
              };
            }

            if (
              resourceMetric["resource"] &&
              (resourceMetric["resource"] as JSONObject)["attributes"] &&
              ((resourceMetric["resource"] as JSONObject)[
                "attributes"
              ] as JSONArray) instanceof Array &&
              (
                (resourceMetric["resource"] as JSONObject)[
                  "attributes"
                ] as JSONArray
              ).length > 0
            ) {
              attributesObject = {
                ...attributesObject,
                resource: OTelIngestService.getAttributes(
                  (resourceMetric["resource"] as JSONObject)[
                    "attributes"
                  ] as JSONArray,
                ),
              };
            }

            if (
              scopeMetric["scope"] &&
              Object.keys(scopeMetric["scope"]).length > 0
            ) {
              attributesObject = {
                ...attributesObject,
                scope: (scopeMetric["scope"] as JSONObject) || {},
              };
            }

            // add attributes
            dbMetric.attributes = attributesObject;

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

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/otlp/v1/logs",
  OpenTelemetryRequestMiddleware.getProductType,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (
        !(req as TelemetryRequest).projectId ||
        !(req as TelemetryRequest).serviceId
      ) {
        throw new BadRequestException(
          "Invalid request - projectId or serviceId not found in request.",
        );
      }

      req.body = req.body.toJSON ? req.body.toJSON() : req.body;

      const resourceLogs: JSONArray = req.body["resourceLogs"] as JSONArray;

      const dbLogs: Array<Log> = [];

      for (const resourceLog of resourceLogs) {
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

            let attributesObject: JSONObject = {};

            if (
              resourceLog["resource"] &&
              (resourceLog["resource"] as JSONObject)["attributes"] &&
              (
                (resourceLog["resource"] as JSONObject)[
                  "attributes"
                ] as JSONArray
              ).length > 0
            ) {
              attributesObject = {
                ...attributesObject,
                resource: OTelIngestService.getAttributes(
                  (resourceLog["resource"] as JSONObject)[
                    "attributes"
                  ] as JSONArray,
                ),
              };
            }

            if (
              scopeLog["scope"] &&
              Object.keys(scopeLog["scope"]).length > 0
            ) {
              attributesObject = {
                ...attributesObject,
                scope: (scopeLog["scope"] as JSONObject) || {},
              };
            }

            dbLog.attributes = {
              ...attributesObject,
              ...OTelIngestService.getAttributes(
                log["attributes"] as JSONArray,
              ),
            };

            dbLog.projectId = (req as TelemetryRequest).projectId;
            dbLog.serviceId = (req as TelemetryRequest).serviceId;

            dbLog.timeUnixNano = log["timeUnixNano"] as number;
            dbLog.time = OneUptimeDate.fromUnixNano(
              log["timeUnixNano"] as number,
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

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
