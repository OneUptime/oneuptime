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
import MetricType from "Common/Models/DatabaseModels/MetricType";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import LogsQueueService from "./Queue/LogsQueueService";
import TracesQueueService from "./Queue/TracesQueueService";
import MetricsQueueService from "./Queue/MetricsQueueService";

export default class OtelIngestService {
  /**
   * Helper method to trigger garbage collection if available
   * This helps prevent memory leaks when processing large volumes of telemetry data
   */
  private static forceGarbageCollection(): void {
    try {
      if (global.gc) {
        global.gc();
      }
    } catch (error) {
      logger.error(error);
      logger.debug(
        "Garbage collection not triggered. Ensure Node.js is started with --expose-gc flag.",
      );
      // GC not available, ignore
    }
  }

  @CaptureSpan()
  public static getServiceNameFromAttributes(
    req: ExpressRequest,
    attributes: JSONArray,
  ): string {
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

    // if there's no service name, check header for x-oneuptime-service-name

    const serviceName: string = req.headers[
      "x-oneuptime-service-name"
    ] as string;

    if (serviceName) {
      return serviceName;
    }

    return "Unknown Service";
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

      // Return response immediately
      Response.sendEmptySuccessResponse(req, res);

      // Add to queue for asynchronous processing
      await LogsQueueService.addLogIngestJob(req as TelemetryRequest);

      return;
    } catch (err) {
      return next(err);
    }
  }

  @CaptureSpan()
  public static async processLogsFromQueue(req: ExpressRequest): Promise<void> {
    // This method is specifically for queue processing
    // It bypasses the response handling since the response was already sent
    await this.processLogsAsync(req);
  }

  @CaptureSpan()
  public static async processTracesFromQueue(
    req: ExpressRequest,
  ): Promise<void> {
    // This method is specifically for queue processing
    // It bypasses the response handling since the response was already sent
    await this.processTracesAsync(req);
  }

  @CaptureSpan()
  public static async processMetricsFromQueue(
    req: ExpressRequest,
  ): Promise<void> {
    // This method is specifically for queue processing
    // It bypasses the response handling since the response was already sent
    await this.processMetricsAsync(req);
  }

  @CaptureSpan()
  private static async processLogsAsync(req: ExpressRequest): Promise<void> {
    try {
      const resourceLogs: JSONArray = req.body["resourceLogs"] as JSONArray;

      if (!resourceLogs || !Array.isArray(resourceLogs)) {
        logger.error("Invalid resourceLogs format in request body");
        throw new BadRequestException("Invalid resourceLogs format");
      }

      const dbLogs: Array<Log> = [];
      const attributeKeySet: Set<string> = new Set<string>();
      const serviceDictionary: Dictionary<TelemetryServiceDataIngested> = {};

      for (const resourceLog of resourceLogs) {
        try {
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
              dataIngestedInGB: 0,
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

          const sizeInGb: number = JSONFunctions.getSizeOfJSONinGB(resourceLog);
          serviceDictionary[serviceName]!.dataIngestedInGB += sizeInGb;

          const scopeLogs: JSONArray = resourceLog["scopeLogs"] as JSONArray;

          if (!scopeLogs || !Array.isArray(scopeLogs)) {
            logger.warn("Invalid scopeLogs format, skipping resource log");
            continue;
          }

          for (const scopeLog of scopeLogs) {
            try {
              const logRecords: JSONArray = scopeLog["logRecords"] as JSONArray;

              if (!logRecords || !Array.isArray(logRecords)) {
                logger.warn("Invalid logRecords format, skipping scope log");
                continue;
              }

              for (const log of logRecords) {
                try {
                  const dbLog: Log = new Log();

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

                  dbLog.attributes = attributesObject;
                  Object.keys(dbLog.attributes).forEach((key: string) => {
                    return attributeKeySet.add(key);
                  });

                  dbLog.projectId = (req as TelemetryRequest).projectId;
                  dbLog.serviceId = serviceDictionary[serviceName]!.serviceId!;

                  // Set timeUnixNano to current time if not provided
                  if (log["timeUnixNano"]) {
                    try {
                      // Handle large timestamp values that might be strings to prevent precision loss
                      let timeUnixNano: number;
                      if (typeof log["timeUnixNano"] === "string") {
                        // Use parseFloat for string conversion to handle very large numbers more safely
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

                      dbLog.timeUnixNano = timeUnixNano;
                      dbLog.time = OneUptimeDate.fromUnixNano(timeUnixNano);
                    } catch (timeError) {
                      logger.warn(
                        `Error processing timestamp ${log["timeUnixNano"]}: ${timeError instanceof Error ? timeError.message : String(timeError)}, using current time`,
                      );
                      const currentTime: Date = OneUptimeDate.getCurrentDate();
                      dbLog.timeUnixNano =
                        OneUptimeDate.getCurrentDateAsUnixNano();
                      dbLog.time = currentTime;
                    }
                  } else {
                    const currentTime: Date = OneUptimeDate.getCurrentDate();
                    dbLog.timeUnixNano =
                      OneUptimeDate.getCurrentDateAsUnixNano();
                    dbLog.time = currentTime;
                  }

                  let logSeverityNumber: number =
                    (log["severityNumber"] as number) || 0;

                  if (typeof logSeverityNumber === "string") {
                    logSeverityNumber =
                      this.convertSeverityNumber(logSeverityNumber);
                  }

                  dbLog.severityNumber = logSeverityNumber;
                  dbLog.severityText = this.getSeverityText(logSeverityNumber);

                  // Handle log body safely
                  try {
                    const logBody: JSONObject = log["body"] as JSONObject;
                    if (
                      logBody &&
                      typeof logBody === "object" &&
                      logBody["stringValue"]
                    ) {
                      dbLog.body = logBody["stringValue"] as string;
                    } else if (typeof log["body"] === "string") {
                      dbLog.body = log["body"] as string;
                    } else {
                      dbLog.body = JSON.stringify(log["body"] || "");
                    }
                  } catch (bodyError) {
                    logger.warn(
                      `Error processing log body: ${bodyError instanceof Error ? bodyError.message : String(bodyError)}`,
                    );
                    dbLog.body = String(log["body"] || "");
                  }

                  // Handle trace and span IDs safely
                  try {
                    dbLog.traceId = Text.convertBase64ToHex(
                      log["traceId"] as string,
                    );
                  } catch {
                    dbLog.traceId = "";
                  }

                  try {
                    dbLog.spanId = Text.convertBase64ToHex(
                      log["spanId"] as string,
                    );
                  } catch {
                    dbLog.spanId = "";
                  }

                  dbLogs.push(dbLog);
                } catch (logError) {
                  logger.error("Error processing individual log record:");
                  logger.error(logError);
                  logger.error(`Log record data: ${JSON.stringify(log)}`);
                  // Continue processing other logs instead of failing the entire batch
                }
              }
            } catch (scopeError) {
              logger.error("Error processing scope log:");
              logger.error(scopeError);
              logger.error(`Scope log data: ${JSON.stringify(scopeLog)}`);
              // Continue processing other scope logs
            }
          }
        } catch (resourceError) {
          logger.error("Error processing resource log:");
          logger.error(resourceError);
          logger.error(`Resource log data: ${JSON.stringify(resourceLog)}`);
          // Continue processing other resource logs
        }
      }

      if (dbLogs.length === 0) {
        logger.warn("No valid logs were processed from the request");
        return;
      }

      await Promise.all([
        LogService.createMany({
          items: dbLogs,
          props: {
            isRoot: true,
          },
        }),
        TelemetryUtil.indexAttributes({
          attributes: Array.from(attributeKeySet),
          projectId: (req as TelemetryRequest).projectId,
          telemetryType: TelemetryType.Log,
        }),
        OTelIngestService.recordDataIngestedUsgaeBilling({
          services: serviceDictionary,
          projectId: (req as TelemetryRequest).projectId,
          productType: ProductType.Logs,
        }),
      ]);

      logger.debug(
        `Successfully processed ${dbLogs.length} logs for project: ${(req as TelemetryRequest).projectId}`,
      );

      // Memory cleanup: Clear large objects to help GC
      try {
        dbLogs.length = 0;
        attributeKeySet.clear();

        // Clear request body to free memory
        if (req.body) {
          req.body = null;
        }

        // Force garbage collection for large telemetry ingestion
        this.forceGarbageCollection();
      } catch (cleanupError) {
        logger.error("Error during memory cleanup:");
        logger.error(cleanupError);
      }
    } catch (error) {
      logger.error("Critical error in processLogsAsync:");
      logger.error(error);
      throw error; // Re-throw to ensure the job fails properly
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

  @CaptureSpan()
  public static async ingestMetrics(
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

      // Return response immediately
      Response.sendEmptySuccessResponse(req, res);

      // Add to queue for asynchronous processing
      await MetricsQueueService.addMetricIngestJob(req as TelemetryRequest);

      return;
    } catch (err) {
      return next(err);
    }
  }

  @CaptureSpan()
  private static async processMetricsAsync(req: ExpressRequest): Promise<void> {
    try {
      const resourceMetrics: JSONArray = req.body[
        "resourceMetrics"
      ] as JSONArray;

      if (!resourceMetrics || !Array.isArray(resourceMetrics)) {
        logger.error("Invalid resourceMetrics format in request body");
        throw new BadRequestException("Invalid resourceMetrics format");
      }

      const dbMetrics: Array<Metric> = [];
      const attributeKeySet: Set<string> = new Set<string>();
      const serviceDictionary: Dictionary<TelemetryServiceDataIngested> = {};

      // Metric name to serviceId map
      // example: "cpu.usage" -> [serviceId1, serviceId2]
      const metricNameServiceNameMap: Dictionary<MetricType> = {};

      for (const resourceMetric of resourceMetrics) {
        try {
          const serviceName: string = this.getServiceNameFromAttributes(
            req,
            ((resourceMetric["resource"] as JSONObject)?.[
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
              dataIngestedInGB: 0,
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
                ((resourceMetric["resource"] as JSONObject)?.[
                  "attributes"
                ] as JSONArray) || [],
              prefixKeysWithString: "resource",
            }),
          };

          const sizeInGb: number =
            JSONFunctions.getSizeOfJSONinGB(resourceMetric);
          serviceDictionary[serviceName]!.dataIngestedInGB += sizeInGb;

          const scopeMetrics: JSONArray = resourceMetric[
            "scopeMetrics"
          ] as JSONArray;

          if (!scopeMetrics || !Array.isArray(scopeMetrics)) {
            logger.warn(
              "Invalid scopeMetrics format, skipping resource metric",
            );
            continue;
          }

          for (const scopeMetric of scopeMetrics) {
            try {
              const metrics: JSONArray = scopeMetric["metrics"] as JSONArray;

              if (!metrics || !Array.isArray(metrics)) {
                logger.warn("Invalid metrics format, skipping scope metric");
                continue;
              }

              for (const metric of metrics) {
                try {
                  const dbMetric: Metric = new Metric();
                  dbMetric.projectId = (req as TelemetryRequest).projectId;
                  dbMetric.serviceId =
                    serviceDictionary[serviceName]!.serviceId!;
                  dbMetric.serviceType = ServiceType.OpenTelemetry;
                  dbMetric.name = (metric["name"] || "")
                    .toString()
                    .toLowerCase();
                  const metricDescription: string = metric[
                    "description"
                  ] as string;
                  const metricUnit: string = metric["unit"] as string;

                  if (dbMetric.name) {
                    // add this to metricNameServiceNameMap
                    if (!metricNameServiceNameMap[dbMetric.name]) {
                      metricNameServiceNameMap[dbMetric.name] =
                        new MetricType();
                      metricNameServiceNameMap[dbMetric.name]!.name =
                        dbMetric.name;
                      metricNameServiceNameMap[dbMetric.name]!.description =
                        metricDescription;
                      metricNameServiceNameMap[dbMetric.name]!.unit =
                        metricUnit;
                      metricNameServiceNameMap[
                        dbMetric.name
                      ]!.telemetryServices = [];
                    }

                    if (
                      metricNameServiceNameMap[
                        dbMetric.name
                      ]!.telemetryServices!.filter(
                        (service: TelemetryService) => {
                          return (
                            service.id?.toString() ===
                            serviceDictionary[
                              serviceName
                            ]!.serviceId!.toString()
                          );
                        },
                      ).length === 0
                    ) {
                      const telemetryService: TelemetryService =
                        new TelemetryService();
                      telemetryService.id =
                        serviceDictionary[serviceName]!.serviceId!;
                      metricNameServiceNameMap[
                        dbMetric.name
                      ]!.telemetryServices!.push(telemetryService);
                    }
                  }

                  const attributesObject: Dictionary<
                    AttributeType | Array<AttributeType>
                  > = {
                    ...resourceAttributes,
                    ...TelemetryUtil.getAttributes({
                      items: (metric["attributes"] as JSONArray) || [],
                      prefixKeysWithString: "metricAttributes",
                    }),
                  };

                  if (
                    scopeMetric["scope"] &&
                    Object.keys(scopeMetric["scope"]).length > 0
                  ) {
                    const scopeAttributes: JSONObject = scopeMetric[
                      "scope"
                    ] as JSONObject;
                    for (const key of Object.keys(scopeAttributes)) {
                      attributesObject[`scope.${key}`] = scopeAttributes[
                        key
                      ] as AttributeType;
                    }
                  }

                  dbMetric.attributes = attributesObject;

                  Object.keys(dbMetric.attributes).forEach((key: string) => {
                    return attributeKeySet.add(key);
                  });

                  const dataPoints: JSONArray = ((
                    metric["sum"] as JSONObject
                  )?.["dataPoints"] ||
                    (metric["gauge"] as JSONObject)?.["dataPoints"] ||
                    (metric["histogram"] as JSONObject)?.[
                      "dataPoints"
                    ]) as JSONArray;

                  if (dataPoints && Array.isArray(dataPoints)) {
                    for (const datapoint of dataPoints) {
                      try {
                        const metricPointType: MetricPointType = metric["sum"]
                          ? MetricPointType.Sum
                          : metric["gauge"]
                            ? MetricPointType.Gauge
                            : MetricPointType.Histogram;
                        const dbMetricPoint: Metric =
                          OTelIngestService.getMetricFromDatapoint({
                            dbMetric: dbMetric,
                            datapoint: datapoint,
                            aggregationTemporality:
                              ((metric["sum"] as JSONObject)?.[
                                "aggregationTemporality"
                              ] as OtelAggregationTemporality) ||
                              ((metric["gauge"] as JSONObject)?.[
                                "aggregationTemporality"
                              ] as OtelAggregationTemporality) ||
                              ((metric["histogram"] as JSONObject)?.[
                                "aggregationTemporality"
                              ] as OtelAggregationTemporality),
                            isMonotonic: ((metric["sum"] as JSONObject)?.[
                              "isMonotonic"
                            ] ||
                              (metric["gauge"] as JSONObject)?.[
                                "isMonotonic"
                              ] ||
                              (metric["histogram"] as JSONObject)?.[
                                "isMonotonic"
                              ]) as boolean,
                            telemetryServiceId:
                              serviceDictionary[serviceName]!.serviceId!,
                            telemetryServiceName: serviceName,
                          });

                        dbMetricPoint.metricPointType = metricPointType;
                        dbMetrics.push(dbMetricPoint);
                      } catch (datapointError) {
                        logger.warn(
                          `Error processing metric datapoint: ${datapointError instanceof Error ? datapointError.message : String(datapointError)}`,
                        );
                      }
                    }
                  } else {
                    logger.warn("Unknown metric type or missing dataPoints");
                    logger.warn(`Metric data: ${JSON.stringify(metric)}`);
                  }
                } catch (metricError) {
                  logger.error("Error processing individual metric:");
                  logger.error(metricError);
                  logger.error(`Metric data: ${JSON.stringify(metric)}`);
                  // Continue processing other metrics instead of failing the entire batch
                }
              }
            } catch (scopeError) {
              logger.error("Error processing scope metric:");
              logger.error(scopeError);
              logger.error(`Scope metric data: ${JSON.stringify(scopeMetric)}`);
              // Continue processing other scope metrics
            }
          }
        } catch (resourceError) {
          logger.error("Error processing resource metric:");
          logger.error(resourceError);
          logger.error(
            `Resource metric data: ${JSON.stringify(resourceMetric)}`,
          );
          // Continue processing other resource metrics
        }
      }

      if (dbMetrics.length === 0) {
        logger.warn("No valid metrics were processed from the request");
        return;
      }

      // Index metric name service name map asynchronously but ensure proper error handling
      TelemetryUtil.indexMetricNameServiceNameMap({
        metricNameServiceNameMap: metricNameServiceNameMap,
        projectId: (req as TelemetryRequest).projectId,
      }).catch((err: Error) => {
        logger.error("Error indexing metric name service name map");
        logger.error(err);
      });

      await Promise.all([
        MetricService.createMany({
          items: dbMetrics,
          props: {
            isRoot: true,
          },
        }),
        TelemetryUtil.indexAttributes({
          attributes: Array.from(attributeKeySet),
          projectId: (req as TelemetryRequest).projectId,
          telemetryType: TelemetryType.Metric,
        }),
        OTelIngestService.recordDataIngestedUsgaeBilling({
          services: serviceDictionary,
          projectId: (req as TelemetryRequest).projectId,
          productType: ProductType.Metrics,
        }),
      ]);

      logger.debug(
        `Successfully processed ${dbMetrics.length} metrics for project: ${(req as TelemetryRequest).projectId}`,
      );

      // Memory cleanup: Clear large objects to help GC
      try {
        dbMetrics.length = 0;
        attributeKeySet.clear();

        // Clear request body to free memory
        if (req.body) {
          req.body = null;
        }

        // Force garbage collection for large telemetry ingestion
        this.forceGarbageCollection();
      } catch (cleanupError) {
        logger.error("Error during memory cleanup:");
        logger.error(cleanupError);
      }
    } catch (error) {
      logger.error("Critical error in processMetricsAsync:");
      logger.error(error);
      throw error; // Re-throw to ensure the job fails properly
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

      // Return response immediately
      Response.sendEmptySuccessResponse(req, res);

      // Add to queue for asynchronous processing
      await TracesQueueService.addTraceIngestJob(req as TelemetryRequest);

      return;
    } catch (err) {
      return next(err);
    }
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
      const attributeKeySet: Set<string> = new Set<string>();
      const serviceDictionary: Dictionary<TelemetryServiceDataIngested> = {};

      for (const resourceSpan of resourceSpans) {
        try {
          // get service name from resourceSpan attributes
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
              dataIngestedInGB: 0,
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

          // size of req.body in bytes.
          const sizeInGb: number =
            JSONFunctions.getSizeOfJSONinGB(resourceSpan);
          serviceDictionary[serviceName]!.dataIngestedInGB += sizeInGb;

          const scopeSpans: JSONArray = resourceSpan["scopeSpans"] as JSONArray;

          if (!scopeSpans || !Array.isArray(scopeSpans)) {
            logger.warn("Invalid scopeSpans format, skipping resource span");
            continue;
          }

          for (const scopeSpan of scopeSpans) {
            try {
              const spans: JSONArray = scopeSpan["spans"] as JSONArray;

              if (!spans || !Array.isArray(spans)) {
                logger.warn("Invalid spans format, skipping scope span");
                continue;
              }

              for (const span of spans) {
                try {
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

                  dbSpan.attributes = attributesObject;

                  Object.keys(dbSpan.attributes).forEach((key: string) => {
                    return attributeKeySet.add(key);
                  });

                  dbSpan.projectId = (req as TelemetryRequest).projectId;
                  dbSpan.serviceId = serviceDictionary[serviceName]!.serviceId!;

                  // Handle span and trace IDs safely
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

                  // Handle timestamps with the same robust approach as logs
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
                    const currentNano =
                      OneUptimeDate.getCurrentDateAsUnixNano();
                    const currentTime = OneUptimeDate.getCurrentDate();
                    dbSpan.startTimeUnixNano = currentNano;
                    dbSpan.endTimeUnixNano = currentNano;
                    dbSpan.startTime = currentTime;
                    dbSpan.endTime = currentTime;
                    dbSpan.durationUnixNano = 0;
                  }

                  // Handle status safely
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

                  // add events safely
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

                  // add links safely
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

                  Object.keys(dbSpan.attributes || {}).forEach(
                    (key: string) => {
                      return attributeKeySet.add(key);
                    },
                  );

                  dbSpans.push(dbSpan);
                } catch (spanError) {
                  logger.error("Error processing individual span:");
                  logger.error(spanError);
                  logger.error(`Span data: ${JSON.stringify(span)}`);
                  // Continue processing other spans instead of failing the entire batch
                }
              }
            } catch (scopeError) {
              logger.error("Error processing scope span:");
              logger.error(scopeError);
              logger.error(`Scope span data: ${JSON.stringify(scopeSpan)}`);
              // Continue processing other scope spans
            }
          }
        } catch (resourceError) {
          logger.error("Error processing resource span:");
          logger.error(resourceError);
          logger.error(`Resource span data: ${JSON.stringify(resourceSpan)}`);
          // Continue processing other resource spans
        }
      }

      if (dbSpans.length === 0) {
        logger.warn("No valid spans were processed from the request");
        return;
      }

      await Promise.all([
        SpanService.createMany({
          items: dbSpans,
          props: {
            isRoot: true,
          },
        }),
        ExceptionInstanceService.createMany({
          items: dbExceptions,
          props: {
            isRoot: true,
          },
        }),
        TelemetryUtil.indexAttributes({
          attributes: Array.from(attributeKeySet),
          projectId: (req as TelemetryRequest).projectId,
          telemetryType: TelemetryType.Trace,
        }),
        OTelIngestService.recordDataIngestedUsgaeBilling({
          services: serviceDictionary,
          projectId: (req as TelemetryRequest).projectId,
          productType: ProductType.Traces,
        }),
      ]);

      logger.debug(
        `Successfully processed ${dbSpans.length} spans for project: ${(req as TelemetryRequest).projectId}`,
      );

      // Memory cleanup: Clear large objects to help GC
      try {
        dbSpans.length = 0;
        dbExceptions.length = 0;
        attributeKeySet.clear();

        // Clear request body to free memory
        if (req.body) {
          req.body = null;
        }

        // Force garbage collection for large telemetry ingestion
        this.forceGarbageCollection();
      } catch (cleanupError) {
        logger.error("Error during memory cleanup:");
        logger.error(cleanupError);
      }
    } catch (error) {
      logger.error("Critical error in processTracesAsync:");
      logger.error(error);
      throw error; // Re-throw to ensure the job fails properly
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
          // Handle event timestamp safely
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
              const exceptionAttributes: JSONObject = { ...eventAttributes };

              for (const keys of Object.keys(exceptionAttributes)) {
                // delete all keys that start with exception to avoid duplicate keys because we already saved it.
                if (keys.startsWith("exception.")) {
                  delete exceptionAttributes[keys];
                }
              }

              exception.attributes = exceptionAttributes;
              exception.fingerprint = ExceptionUtil.getFingerprint(exception);

              // add exception to dbExceptions
              dbExceptions.push(exception);

              // save exception status
              // Fix: Await the async operation to prevent memory leaks from unhandled promises
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
