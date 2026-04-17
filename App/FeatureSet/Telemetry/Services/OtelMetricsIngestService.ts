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
import {
  MetricPointType,
  ServiceType,
} from "Common/Models/AnalyticsModels/Metric";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import TelemetryUtil, {
  AttributeType,
} from "Common/Server/Utils/Telemetry/Telemetry";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Service from "Common/Models/DatabaseModels/Service";
import MetricsQueueService from "./Queue/MetricsQueueService";
import OtelIngestBaseService from "./OtelIngestBaseService";
import {
  ENABLE_METRIC_PIPELINE_RULES,
  TELEMETRY_METRIC_FLUSH_BATCH_SIZE,
} from "../Config";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "./MetricPipelineRuleService";
import OneUptimeDate from "Common/Types/Date";
import MetricService from "Common/Server/Services/MetricService";
import Text from "Common/Types/Text";

type MetricTimestamp = {
  nano: string;
  iso: string;
  db: string;
  date: Date;
};

export default class OtelMetricsIngestService extends OtelIngestBaseService {
  private static async flushMetricsBuffer(
    metrics: Array<JSONObject>,
    force: boolean = false,
  ): Promise<void> {
    while (
      metrics.length >= TELEMETRY_METRIC_FLUSH_BATCH_SIZE ||
      (force && metrics.length > 0)
    ) {
      const batchSize: number = Math.min(
        metrics.length,
        TELEMETRY_METRIC_FLUSH_BATCH_SIZE,
      );
      const batch: Array<JSONObject> = metrics.splice(0, batchSize);

      if (batch.length === 0) {
        continue;
      }

      await MetricService.insertJsonRows(batch);
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

      req.body = req.body?.toJSON ? req.body.toJSON() : req.body;

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
        logger.error(
          "Invalid resourceMetrics format in request body",
          getLogAttributesFromRequest(req as RequestLike),
        );
        throw new BadRequestException("Invalid resourceMetrics format");
      }

      const dbMetrics: Array<JSONObject> = [];
      const serviceDictionary: Dictionary<TelemetryServiceMetadata> = {};

      const metricNameServiceNameMap: Dictionary<MetricType> = {};
      let totalMetricsProcessed: number = 0;
      const projectId: ObjectID = (req as TelemetryRequest).projectId;

      // Load project + service-scoped pipeline rules once per batch (60s cached).
      let pipelineRules: MetricRulesForProject | null = null;
      if (ENABLE_METRIC_PIPELINE_RULES) {
        try {
          pipelineRules =
            await MetricPipelineRuleService.loadRules(projectId);
        } catch (err) {
          logger.warn(
            `Failed to load metric pipeline rules for project ${projectId.toString()}; skipping: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          pipelineRules = null;
        }
      }

      let resourceMetricCounter: number = 0;
      for (const resourceMetric of resourceMetrics) {
        try {
          if (resourceMetricCounter % 25 === 0) {
            await Promise.resolve();
          }
          resourceMetricCounter++;
          const resourceAttributes_raw: JSONArray =
            ((resourceMetric["resource"] as JSONObject)?.[
              "attributes"
            ] as JSONArray) || [];

          const serviceName: string = await this.getServiceNameFromAttributes(
            req,
            resourceAttributes_raw,
          );

          // Auto-discover Kubernetes cluster from resource attributes
          await this.autoDiscoverKubernetesCluster({
            projectId,
            attributes: resourceAttributes_raw,
          });

          // Auto-discover Docker host from resource attributes
          await this.autoDiscoverDockerHost({
            projectId,
            attributes: resourceAttributes_raw,
          });

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

          const serviceMetadata: TelemetryServiceMetadata =
            serviceDictionary[serviceName]!;

          const resourceAttributes: Dictionary<
            AttributeType | Array<AttributeType>
          > = {
            ...TelemetryUtil.getAttributesForServiceIdAndServiceName({
              serviceId: serviceMetadata.serviceId!,
              serviceName: serviceName,
            }),
            ...TelemetryUtil.getAttributes({
              items: resourceAttributes_raw,
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
                  const metricName: string = (metric["name"] || "")
                    .toString()
                    .toLowerCase();
                  const metricDescription: string = metric[
                    "description"
                  ] as string;
                  const metricUnit: string = metric["unit"] as string;

                  if (metricName) {
                    if (!metricNameServiceNameMap[metricName]) {
                      metricNameServiceNameMap[metricName] = new MetricType();
                      metricNameServiceNameMap[metricName]!.name = metricName;
                      metricNameServiceNameMap[metricName]!.description =
                        metricDescription;
                      metricNameServiceNameMap[metricName]!.unit = metricUnit;
                      metricNameServiceNameMap[metricName]!.services = [];
                    }

                    if (
                      metricNameServiceNameMap[metricName]!.services!.filter(
                        (service: Service) => {
                          return (
                            service.id?.toString() ===
                            serviceMetadata.serviceId!.toString()
                          );
                        },
                      ).length === 0
                    ) {
                      const newService: Service = new Service();
                      newService.id = serviceMetadata.serviceId!;
                      metricNameServiceNameMap[metricName]!.services!.push(
                        newService,
                      );
                    }
                  }

                  const metricAttributes: Dictionary<
                    AttributeType | Array<AttributeType>
                  > = {
                    ...resourceAttributes,
                    ...TelemetryUtil.getAttributes({
                      items: (metric["attributes"] as JSONArray) || [],
                      prefixKeysWithString: "",
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
                      metricAttributes[`scope.${key}`] = scopeAttributes[
                        key
                      ] as AttributeType;
                    }
                  }

                  const dataPoints: JSONArray = ((
                    metric["sum"] as JSONObject
                  )?.["dataPoints"] ||
                    (metric["gauge"] as JSONObject)?.["dataPoints"] ||
                    (metric["histogram"] as JSONObject)?.[
                      "dataPoints"
                    ]) as JSONArray;

                  if (dataPoints && Array.isArray(dataPoints)) {
                    const aggregationTemporality: OtelAggregationTemporality =
                      ((metric["sum"] as JSONObject)?.[
                        "aggregationTemporality"
                      ] as OtelAggregationTemporality) ||
                      ((metric["gauge"] as JSONObject)?.[
                        "aggregationTemporality"
                      ] as OtelAggregationTemporality) ||
                      ((metric["histogram"] as JSONObject)?.[
                        "aggregationTemporality"
                      ] as OtelAggregationTemporality);

                    const isMonotonic: boolean | undefined =
                      ((metric["sum"] as JSONObject)?.["isMonotonic"] as
                        | boolean
                        | undefined) ||
                      ((metric["gauge"] as JSONObject)?.["isMonotonic"] as
                        | boolean
                        | undefined) ||
                      ((metric["histogram"] as JSONObject)?.["isMonotonic"] as
                        | boolean
                        | undefined);

                    const metricPointType: MetricPointType = metric["sum"]
                      ? MetricPointType.Sum
                      : metric["gauge"]
                        ? MetricPointType.Gauge
                        : MetricPointType.Histogram;

                    for (const datapoint of dataPoints) {
                      try {
                        const metricRow: JSONObject = this.buildMetricRow({
                          datapoint: datapoint as JSONObject,
                          baseAttributes: metricAttributes,
                          projectId: projectId,
                          serviceId: serviceMetadata.serviceId!,
                          serviceName: serviceName,
                          metricName: metricName,
                          metricPointType: metricPointType,
                          aggregationTemporality: aggregationTemporality,
                          dataRententionInDays:
                            serviceMetadata.dataRententionInDays,
                          ...(typeof isMonotonic === "boolean"
                            ? { isMonotonic: isMonotonic }
                            : {}),
                        });

                        // Apply user-defined pipeline rules (filter/drop/
                        // rename/redact/sample) before buffering for insert.
                        // null from applyRules means the row was dropped.
                        const transformed: JSONObject | null =
                          ENABLE_METRIC_PIPELINE_RULES && pipelineRules
                            ? MetricPipelineRuleService.applyRules(
                                metricRow,
                                serviceMetadata.serviceId,
                                pipelineRules,
                              )
                            : metricRow;

                        if (transformed === null) {
                          continue;
                        }

                        dbMetrics.push(transformed);
                        totalMetricsProcessed++;

                        if (
                          dbMetrics.length >= TELEMETRY_METRIC_FLUSH_BATCH_SIZE
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
        projectId: projectId,
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
      logger.error(
        "Critical error in processMetricsAsync:",
        getLogAttributesFromRequest(req as RequestLike),
      );
      logger.error(error, getLogAttributesFromRequest(req as RequestLike));
      throw error;
    }
  }

  private static buildMetricRow(data: {
    datapoint: JSONObject;
    baseAttributes: Dictionary<AttributeType | Array<AttributeType>>;
    projectId: ObjectID;
    serviceId: ObjectID;
    serviceName: string;
    metricName: string;
    metricPointType: MetricPointType;
    aggregationTemporality?: OtelAggregationTemporality;
    isMonotonic?: boolean;
    dataRententionInDays: number;
  }): JSONObject {
    const ingestionDate: Date = OneUptimeDate.getCurrentDate();
    const ingestionTimestamp: string =
      OneUptimeDate.toClickhouseDateTime(ingestionDate);

    const timeFields: MetricTimestamp = this.safeParseUnixNano(
      data.datapoint["timeUnixNano"] as string | number | undefined,
      "metric datapoint timeUnixNano",
    );

    const startTimeRaw: string | number | undefined = data.datapoint[
      "startTimeUnixNano"
    ] as string | number | undefined;

    const startTimeFields: MetricTimestamp | null = startTimeRaw
      ? this.safeParseUnixNano(
          startTimeRaw,
          "metric datapoint startTimeUnixNano",
        )
      : null;

    const attributes: Dictionary<AttributeType | Array<AttributeType>> = {
      ...data.baseAttributes,
    };

    if (data.datapoint["attributes"]) {
      Object.assign(
        attributes,
        TelemetryUtil.getAttributes({
          items: (data.datapoint["attributes"] as JSONArray) || [],
          prefixKeysWithString: "",
        }),
      );
    }

    const attributeKeys: Array<string> =
      TelemetryUtil.getAttributeKeys(attributes);

    const valueFromInt: number | null = this.toNumberOrNull(
      data.datapoint["asInt"],
    );
    const valueFromDouble: number | null = this.toNumberOrNull(
      data.datapoint["asDouble"],
    );
    const count: number | null = this.toNumberOrNull(data.datapoint["count"]);
    const sum: number | null = this.toNumberOrNull(data.datapoint["sum"]);
    const min: number | null = this.toNumberOrNull(data.datapoint["min"]);
    const max: number | null = this.toNumberOrNull(data.datapoint["max"]);

    const bucketCounts: Array<number> = Array.isArray(
      data.datapoint["bucketCounts"],
    )
      ? (data.datapoint["bucketCounts"] as Array<number | string>).map(
          (entry: number | string) => {
            const parsed: number | null = this.toNumberOrNull(entry);
            return parsed === null ? 0 : parsed;
          },
        )
      : [];

    const explicitBoundsRaw: Array<number | string> | undefined = Array.isArray(
      data.datapoint["explicitBounds"],
    )
      ? (data.datapoint["explicitBounds"] as Array<number | string>)
      : undefined;

    const explicitBounds: Array<number> = explicitBoundsRaw
      ? explicitBoundsRaw
          .map((entry: number | string) => {
            return this.toNumberOrNull(entry);
          })
          .filter((entry: number | null): entry is number => {
            return entry !== null;
          })
      : [];

    // Extract exemplar trace/span IDs from the first exemplar that has a traceId
    const exemplarTraceAndSpanIds: {
      traceId: string | null;
      spanId: string | null;
    } = this.extractExemplarIds(data.datapoint["exemplars"] as JSONArray);

    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      ingestionDate,
      data.dataRententionInDays || 15,
    );

    const row: JSONObject = {
      _id: ObjectID.generate().toString(),
      createdAt: ingestionTimestamp,
      updatedAt: ingestionTimestamp,
      projectId: data.projectId.toString(),
      serviceId: data.serviceId.toString(),
      serviceType: ServiceType.OpenTelemetry,
      name: data.metricName,
      time: timeFields.db,
      timeUnixNano: timeFields.nano,
      metricPointType: data.metricPointType,
      aggregationTemporality: this.mapAggregationTemporality(
        data.aggregationTemporality,
      ),
      isMonotonic:
        data.isMonotonic === undefined ? null : Boolean(data.isMonotonic),
      attributes: attributes,
      attributeKeys: attributeKeys,
      value:
        valueFromInt !== null
          ? valueFromInt
          : valueFromDouble !== null
            ? valueFromDouble
            : sum,
      count: count,
      sum: sum,
      min: min,
      max: max,
      bucketCounts: bucketCounts,
      explicitBounds: explicitBounds,
      traceId: exemplarTraceAndSpanIds.traceId,
      spanId: exemplarTraceAndSpanIds.spanId,
      retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
    };

    if (startTimeFields) {
      row["startTime"] = startTimeFields.db;
      row["startTimeUnixNano"] = startTimeFields.nano;
    } else {
      row["startTime"] = null;
      row["startTimeUnixNano"] = null;
    }

    return row;
  }

  private static safeParseUnixNano(
    value: string | number | undefined,
    context: string,
  ): MetricTimestamp {
    let numericValue: number = OneUptimeDate.getCurrentDateAsUnixNano();

    if (value !== undefined && value !== null) {
      try {
        if (typeof value === "string") {
          const parsed: number = Number.parseFloat(value);
          if (isNaN(parsed)) {
            throw new Error(`Invalid timestamp string: ${value}`);
          }
          numericValue = parsed;
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

    const date: Date = OneUptimeDate.fromUnixNano(numericValue);
    const iso: string = OneUptimeDate.toString(date);
    const db: string = OneUptimeDate.toClickhouseDateTime(date);

    return {
      nano: Math.trunc(numericValue).toString(),
      iso: iso,
      db: db,
      date: date,
    };
  }

  private static toNumberOrNull(value: unknown): number | null {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "string") {
      const parsed: number = Number.parseFloat(value);
      /*
       * `Number.isFinite` is stricter than `!isNaN`: it rejects both NaN
       * and +/-Infinity. OTLP histograms routinely contain "+Inf" as the
       * trailing explicitBound value when the histogram has an unbounded
       * final bucket; `parseFloat("Infinity")` returns `Infinity`, which
       * `isNaN` would accept and which then fails to serialize into the
       * ClickHouse JSONEachRow format with:
       *   Cannot read array from text, expected comma or end of array,
       *   found 'e': (while reading the value of key explicitBounds)
       * dropping the entire metrics batch. Filter non-finite values here
       * so they are coerced to null and then dropped by the caller's
       * `.filter(entry !== null)` step.
       */
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private static mapAggregationTemporality(
    temporality?: OtelAggregationTemporality,
  ): string | null {
    if (!temporality) {
      return null;
    }

    if (temporality === OtelAggregationTemporality.Cumulative) {
      return "Cumulative";
    }

    if (temporality === OtelAggregationTemporality.Delta) {
      return "Delta";
    }

    return null;
  }

  /**
   * Extract trace and span IDs from OTLP exemplars.
   * Takes the first exemplar that has a traceId.
   * OTLP sends trace_id and span_id as base64-encoded bytes.
   */
  private static extractExemplarIds(exemplars: JSONArray | undefined): {
    traceId: string | null;
    spanId: string | null;
  } {
    if (!exemplars || !Array.isArray(exemplars) || exemplars.length === 0) {
      return { traceId: null, spanId: null };
    }

    for (const exemplar of exemplars) {
      const exemplarObj: JSONObject = exemplar as JSONObject;
      const rawTraceId: string | undefined = exemplarObj["traceId"] as
        | string
        | undefined;

      if (!rawTraceId) {
        continue;
      }

      const traceId: string = this.convertBase64ToHexSafe(rawTraceId);

      if (!traceId) {
        continue;
      }

      const rawSpanId: string | undefined = exemplarObj["spanId"] as
        | string
        | undefined;
      const spanId: string = rawSpanId
        ? this.convertBase64ToHexSafe(rawSpanId)
        : "";

      return {
        traceId: traceId || null,
        spanId: spanId || null,
      };
    }

    return { traceId: null, spanId: null };
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
}
