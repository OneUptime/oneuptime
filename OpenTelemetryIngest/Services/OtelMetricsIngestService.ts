import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import OTelIngestService, {
  OtelAggregationTemporality,
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Metric, {
  MetricPointType,
  ServiceType,
} from "Common/Models/AnalyticsModels/Metric";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import TelemetryUtil, {
  AttributeType,
} from "Common/Server/Utils/Telemetry/Telemetry";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import MetricService from "Common/Server/Services/MetricService";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import MetricsQueueService from "./Queue/MetricsQueueService";
import OtelIngestBaseService from "./OtelIngestBaseService";
import { OPEN_TELEMETRY_INGEST_METRIC_FLUSH_BATCH_SIZE } from "../Config";

export default class OtelMetricsIngestService extends OtelIngestBaseService {
  private static async flushMetricsBuffer(
    metrics: Array<Metric>,
    force: boolean = false,
  ): Promise<void> {
    while (
      metrics.length >= OPEN_TELEMETRY_INGEST_METRIC_FLUSH_BATCH_SIZE ||
      (force && metrics.length > 0)
    ) {
      const batchSize: number = Math.min(
        metrics.length,
        OPEN_TELEMETRY_INGEST_METRIC_FLUSH_BATCH_SIZE,
      );
      const batch: Array<Metric> = metrics.splice(0, batchSize);

      if (batch.length === 0) {
        continue;
      }

      await MetricService.createMany({
        items: batch,
        props: {
          isRoot: true,
        },
      });
    }
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

      Response.sendEmptySuccessResponse(req, res);

      await MetricsQueueService.addMetricIngestJob(req as TelemetryRequest);

      return;
    } catch (err) {
      return next(err);
    }
  }

  @CaptureSpan()
  public static async processMetricsFromQueue(
    req: ExpressRequest,
  ): Promise<void> {
    await this.processMetricsAsync(req);
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
      const serviceDictionary: Dictionary<TelemetryServiceMetadata> = {};

      const metricNameServiceNameMap: Dictionary<MetricType> = {};
      let totalMetricsProcessed: number = 0;

      let resourceMetricCounter: number = 0;
      for (const resourceMetric of resourceMetrics) {
        try {
          if (resourceMetricCounter % 25 === 0) {
            await Promise.resolve();
          }
          resourceMetricCounter++;
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
          const scopeMetrics: JSONArray = resourceMetric[
            "scopeMetrics"
          ] as JSONArray;

          if (!scopeMetrics || !Array.isArray(scopeMetrics)) {
            logger.warn(
              "Invalid scopeMetrics format, skipping resource metric",
            );
            continue;
          }

          let scopeMetricCounter: number = 0;
          for (const scopeMetric of scopeMetrics) {
            try {
              if (scopeMetricCounter % 50 === 0) {
                await Promise.resolve();
              }
              scopeMetricCounter++;
              const metrics: JSONArray = scopeMetric["metrics"] as JSONArray;

              if (!metrics || !Array.isArray(metrics)) {
                logger.warn("Invalid metrics format, skipping scope metric");
                continue;
              }

              let metricCounter: number = 0;
              for (const metric of metrics) {
                try {
                  if (metricCounter % 100 === 0) {
                    await Promise.resolve();
                  }
                  metricCounter++;
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
                  dbMetric.attributeKeys =
                    TelemetryUtil.getAttributeKeys(attributesObject);

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
                        totalMetricsProcessed++;

                        if (
                          dbMetrics.length >=
                          OPEN_TELEMETRY_INGEST_METRIC_FLUSH_BATCH_SIZE
                        ) {
                          await this.flushMetricsBuffer(dbMetrics);
                        }
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
                }
              }
            } catch (scopeError) {
              logger.error("Error processing scope metric:");
              logger.error(scopeError);
              logger.error(`Scope metric data: ${JSON.stringify(scopeMetric)}`);
            }
          }
        } catch (resourceError) {
          logger.error("Error processing resource metric:");
          logger.error(resourceError);
          logger.error(
            `Resource metric data: ${JSON.stringify(resourceMetric)}`,
          );
        }
      }

      await this.flushMetricsBuffer(dbMetrics, true);

      if (totalMetricsProcessed === 0) {
        logger.warn("No valid metrics were processed from the request");
        return;
      }

      TelemetryUtil.indexMetricNameServiceNameMap({
        metricNameServiceNameMap: metricNameServiceNameMap,
        projectId: (req as TelemetryRequest).projectId,
      }).catch((err: Error) => {
        logger.error("Error indexing metric name service name map");
        logger.error(err);
      });

      logger.debug(
        `Successfully processed ${totalMetricsProcessed} metrics for project: ${(req as TelemetryRequest).projectId}`,
      );

      try {
        dbMetrics.length = 0;

        if (req.body) {
          req.body = null;
        }
      } catch (cleanupError) {
        logger.error("Error during memory cleanup:");
        logger.error(cleanupError);
      }
    } catch (error) {
      logger.error("Critical error in processMetricsAsync:");
      logger.error(error);
      throw error;
    }
  }
}
