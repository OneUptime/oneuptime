import ObjectID from "../../../../../../Types/ObjectID";
import AIInsightType from "../../../../../../Types/AI/AIInsightType";
import IncludesAnyOfGroups from "../../../../../../Types/BaseDatabase/IncludesAnyOfGroups";
import { MetricInsightEvidence } from "../../../../../../Types/AI/AIInsightEvidence";
import MetricType from "../../../../../../Models/DatabaseModels/MetricType";
import Service from "../../../../../../Models/DatabaseModels/Service";
import MetricAggregationService, {
  MetricAttributeCardinalityRow,
  MetricSeriesKey,
  MetricShapeRow,
} from "../../../../../Services/MetricAggregationService";
import MetricTypeService from "../../../../../Services/MetricTypeService";
import ServiceService from "../../../../../Services/ServiceService";
import TraceAggregationService, {
  ServiceSpanHealthRow,
  TraceAnalyticsTableRow,
} from "../../../../../Services/TraceAggregationService";
import QueryHelper from "../../../../../Types/Database/QueryHelper";
import LlmConversationPrivacy from "../../../../LlmObservability/LlmConversationPrivacy";
import logger from "../../../../Logger";
import CaptureSpan from "../../../../Telemetry/CaptureSpan";
import { MarkdownText } from "../../../../../../Utils/Markdown/FeedMarkdown";
import {
  METRIC_INSIGHT_MAX_FINDINGS_PER_SERVICE,
  METRIC_INSIGHT_MAX_MISSING_METRICS_SERVICES,
  METRIC_INSIGHT_MAX_NAME_PATTERNS,
  METRIC_INSIGHT_MIN_ATTRIBUTE_VALUES,
  METRIC_INSIGHT_MIN_DATA_POINTS,
  METRIC_INSIGHT_MIN_NAME_VARIANTS,
  METRIC_INSIGHT_MIN_SERVICE_SPANS,
  METRIC_INSIGHT_TOP_OPERATIONS,
  METRIC_INSIGHT_TYPE_BY_KIND,
  METRIC_INSIGHT_VALUE_SAMPLE_SIZE,
  MetricCardinalityShape,
  MetricHighCardinalityReading,
  MetricHistogramBucketsReading,
  MetricInsightKind,
  MetricInsightWindow,
  MetricNamePatternReading,
  MetricServiceTraffic,
  MetricShapeReading,
  MetricVolumeReading,
  buildMetricInsightDetail,
  getMetricInsightFingerprint,
  getMetricInsightSeverity,
  getMetricInsightTitle,
  getMetricInsightWindow,
  hasMetricOverflow,
  pickExplodedNamePatterns,
  pickHistogramReading,
  pickMetricsToRead,
  pickServicesMissingMetrics,
  readHighCardinalityAttributes,
  readHistogramBuckets,
} from "../../../../../../Utils/Metrics/MetricInsight";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../Types";

/*
 * The Metrics product's AI section's detector (Types/AI/TelemetryAi):
 * high-cardinality metrics, histograms whose buckets do not fit their
 * values, and busy services that send no metrics (Utils/Metrics/
 * MetricInsight holds every gate). It feeds the lane's AI rules: OneUptime
 * AI looks into each finding and opens a pull request that improves the
 * metric, or adds the missing ones.
 *
 * One look a project an hour, for all three kinds at once, so the same reads
 * serve them:
 *
 *   1. every metric of the hour that ended last, from the hourly rollup the
 *      metric table keeps (MetricBaselineHourly): each one's data points by
 *      metric and primary entity, and the metric names with their ids
 *      collapsed - cheap whatever the project sends;
 *   2. the ten busiest of them that are the project's own services' - not
 *      a host's, a cluster's or a monitor's - read closely over that hour,
 *      by the metric table's own sort key: how many values each attribute
 *      their code sets took, and what their data points are (a histogram's
 *      buckets summed);
 *   3. the services that sent 1,000 or more spans in the hour and no data
 *      point of their own, which the metric catalog (MetricType) is asked
 *      whether they ever sent a metric - with their busiest operations.
 *
 * Each part is read on its own: one that fails finds nothing, says why in
 * the log, and leaves the others to find what they find. Missing metrics
 * are only looked for when the hour's metrics were read: without them,
 * every service would seem to send none.
 *
 * Deterministic: no LLM anywhere here. Read as root with the project scoped
 * explicitly, as every detector: the services whose telemetry holds a
 * company AI tool's private chats are left out (LlmConversationPrivacy),
 * since an insight is read by people who may not read those.
 *
 * The scanner runs one detector per insight type (InsightDetectors); the
 * three below share the look through the scan context they are handed, so it
 * runs once a tick, not three times.
 */

// The rows the hour's metrics are read in, busiest first.
export const METRIC_INSIGHT_MAX_VOLUME_ROWS: number = 5000;

// The services the hour's spans are read for, busiest first.
const MAX_SERVICES_READ: number = 200;

/*
 * The metrics of the hour whose primary entities are asked whether they are
 * the project's services: the busiest, enough to fill the close reads.
 */
const MAX_METRIC_ENTITIES_ASKED: number = 200;

export interface MetricServiceFacts {
  id: string;
  name: string;
  sdkLanguage: string;
}

function readId(id: unknown): string {
  return String(id || "")
    .trim()
    .toLowerCase();
}

function toKey(metric: MetricSeriesKey): string {
  return JSON.stringify([metric.metricName, readId(metric.serviceId)]);
}

export default class MetricProblemDetector {
  // One look per scan context: the three detectors share it.
  private static looks: WeakMap<
    InsightScanContext,
    Promise<Array<InsightCandidate>>
  > = new WeakMap<InsightScanContext, Promise<Array<InsightCandidate>>>();

  /*
   * The look's findings for this scan: run on the first detector's call,
   * handed to the others. Never rejects: a look that failed finds nothing,
   * and says why in the log.
   */
  public static look(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    let look: Promise<Array<InsightCandidate>> | undefined =
      MetricProblemDetector.looks.get(context);

    if (!look) {
      look = MetricProblemDetector.lookNow(context).catch(
        (error: unknown): Array<InsightCandidate> => {
          logger.error(
            `MetricProblemDetector: the look at project ${context.projectId.toString()}'s metrics failed: ${error}`,
          );
          return [];
        },
      );
      MetricProblemDetector.looks.set(context, look);
    }

    return look;
  }

  // The insight a finding becomes. Pure.
  public static buildCandidate(data: {
    serviceId: string;
    serviceName: string;
    evidence: MetricInsightEvidence;
  }): InsightCandidate {
    const kind: MetricInsightKind = data.evidence.kind as MetricInsightKind;

    return {
      insightType: METRIC_INSIGHT_TYPE_BY_KIND[kind],
      fingerprint: getMetricInsightFingerprint({
        kind,
        serviceId: data.serviceId,
        shape: data.evidence.shape as MetricCardinalityShape | undefined,
        metricName: data.evidence.metricName,
        namePattern: data.evidence.namePattern,
      }),
      title: getMetricInsightTitle({
        evidence: data.evidence,
        serviceName: data.serviceName,
      }),
      detailMarkdown: MetricProblemDetector.buildDetail({
        serviceName: data.serviceName,
        evidence: data.evidence,
      }).toString(),
      severity: getMetricInsightSeverity(data.evidence),
      serviceName: data.serviceName,
      telemetryServiceId: new ObjectID(data.serviceId),
      metricName: data.evidence.metricName,
      evidence: { metric: data.evidence },
    };
  }

  /*
   * The evidence as a person reads it on the insight
   * (Utils/Metrics/MetricInsight buildMetricInsightDetail, pure, so the
   * browser suite draws what the detector writes).
   */
  public static buildDetail(data: {
    serviceName: string;
    evidence: MetricInsightEvidence;
  }): MarkdownText {
    return buildMetricInsightDetail(data);
  }

  // A high-cardinality metric's evidence, by an attribute. Pure.
  public static toAttributeEvidence(data: {
    metric: MetricVolumeReading;
    window: MetricInsightWindow;
    reading: MetricHighCardinalityReading;
    hasOverflow: boolean;
    unit?: string | undefined;
  }): MetricInsightEvidence {
    const evidence: MetricInsightEvidence = {
      serviceId: readId(data.metric.serviceId),
      kind: MetricInsightKind.HighCardinality,
      shape: MetricCardinalityShape.Attribute,
      windowStartTime: data.window.startTime.toISOString(),
      windowEndTime: data.window.endTime.toISOString(),
      metricName: data.metric.metricName,
      dataPointCount: data.metric.dataPointCount,
      attributeKey: data.reading.attribute.key,
      attributeValueCount: data.reading.attribute.valueCount,
      valueShape: data.reading.valueShape,
    };

    if (data.unit) {
      evidence.unit = data.unit;
    }

    if (data.reading.otherAttributes.length > 0) {
      evidence.otherAttributes = data.reading.otherAttributes;
    }

    if (data.hasOverflow) {
      evidence.hasOverflow = true;
    }

    return evidence;
  }

  // A histogram's evidence, when its buckets do not fit its values. Pure.
  public static toHistogramEvidence(data: {
    metric: MetricVolumeReading;
    window: MetricInsightWindow;
    shape: MetricShapeReading;
    reading: MetricHistogramBucketsReading;
    unit?: string | undefined;
  }): MetricInsightEvidence {
    const evidence: MetricInsightEvidence = {
      serviceId: readId(data.metric.serviceId),
      kind: MetricInsightKind.HistogramBuckets,
      windowStartTime: data.window.startTime.toISOString(),
      windowEndTime: data.window.endTime.toISOString(),
      metricName: data.metric.metricName,
      dataPointCount: data.metric.dataPointCount,
      bucketProblem: data.reading.problem,
      bucketShare: data.reading.share,
      valueCount: data.reading.valueCount,
      boundCount: data.reading.boundCount,
    };

    if (data.unit) {
      evidence.unit = data.unit;
    }

    if (data.reading.smallestBound !== undefined) {
      evidence.smallestBound = data.reading.smallestBound;
    }

    if (data.reading.largestBound !== undefined) {
      evidence.largestBound = data.reading.largestBound;
    }

    if (data.reading.hasDefaultBounds) {
      evidence.hasDefaultBounds = true;
    }

    if (
      data.shape.minValue !== null &&
      data.shape.maxValue !== null &&
      data.shape.maxValue >= data.shape.minValue
    ) {
      evidence.minValue = data.shape.minValue;
      evidence.maxValue = data.shape.maxValue;
    }

    return evidence;
  }

  // Metric names with ids in them: one finding per pattern. Pure.
  public static toNamePatternEvidence(data: {
    pattern: MetricNamePatternReading;
    window: MetricInsightWindow;
  }): MetricInsightEvidence {
    return {
      serviceId: readId(data.pattern.serviceId),
      kind: MetricInsightKind.HighCardinality,
      shape: MetricCardinalityShape.Name,
      windowStartTime: data.window.startTime.toISOString(),
      windowEndTime: data.window.endTime.toISOString(),
      namePattern: data.pattern.namePattern,
      nameCount: data.pattern.nameCount,
      dataPointCount: data.pattern.dataPointCount,
    };
  }

  // A busy service with no metrics. Pure.
  public static toMissingMetricsEvidence(data: {
    traffic: MetricServiceTraffic;
    window: MetricInsightWindow;
    operations: Array<TraceAnalyticsTableRow>;
    sdkLanguage?: string | undefined;
  }): MetricInsightEvidence {
    const evidence: MetricInsightEvidence = {
      serviceId: readId(data.traffic.serviceId),
      kind: MetricInsightKind.MissingMetrics,
      windowStartTime: data.window.startTime.toISOString(),
      windowEndTime: data.window.endTime.toISOString(),
      spanCount: data.traffic.spanCount,
      failedSpanCount: data.traffic.failedSpanCount,
    };

    const topOperations: Array<{ name: string; spanCount: number }> =
      data.operations
        .map((row: TraceAnalyticsTableRow) => {
          return {
            name: row.groupValues["name"] || "",
            spanCount: row.count,
          };
        })
        .filter((operation: { name: string; spanCount: number }): boolean => {
          return operation.name.length > 0;
        })
        .slice(0, METRIC_INSIGHT_TOP_OPERATIONS);

    if (topOperations.length > 0) {
      evidence.topOperations = topOperations;
    }

    if (data.sdkLanguage) {
      evidence.sdkLanguage = data.sdkLanguage;
    }

    return evidence;
  }

  /*
   * A part of the look that may fail on its own: logged, and nothing found
   * by it - the other parts still find what they find. Null says it failed,
   * which the parts that depend on it read as "unknown", never as "none".
   */
  private static async readPart<T>(
    context: InsightScanContext,
    part: string,
    read: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      logger.error(
        `MetricProblemDetector: ${part} of project ${context.projectId.toString()} could not be read - continuing without it: ${error}`,
      );
      return null;
    }
  }

  @CaptureSpan()
  private static async lookNow(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    const projectId: ObjectID = context.projectId;
    const window: MetricInsightWindow = getMetricInsightWindow(context.now);

    const excludedServiceIds: Set<string> = new Set<string>(
      (await LlmConversationPrivacy.getRestrictedServiceIds(projectId)).map(
        readId,
      ),
    );

    const [volumes, patterns, traffic]: [
      Array<MetricVolumeReading> | null,
      Array<MetricNamePatternReading> | null,
      Array<ServiceSpanHealthRow> | null,
    ] = await Promise.all([
      MetricProblemDetector.readPart(context, "the hour's metrics", () => {
        return MetricAggregationService.getHourlyMetricVolumes({
          projectId,
          hourStart: window.startTime,
          limit: METRIC_INSIGHT_MAX_VOLUME_ROWS,
        });
      }),
      MetricProblemDetector.readPart(
        context,
        "the hour's metric names",
        () => {
          return MetricAggregationService.getMetricNamePatterns({
            projectId,
            hourStart: window.startTime,
            minNameCount: METRIC_INSIGHT_MIN_NAME_VARIANTS,
            limit: METRIC_INSIGHT_MAX_NAME_PATTERNS,
          });
        },
      ),
      MetricProblemDetector.readPart(context, "the hour's spans", () => {
        return TraceAggregationService.getServiceSpanHealth({
          projectId,
          startTime: window.startTime,
          endTime: window.endTime,
          limit: MAX_SERVICES_READ,
        });
      }),
    ]);

    // Only the project's services: a host's or a monitor's id is none.
    const askedIds: Set<string> = new Set<string>();

    for (const volume of (volumes || [])
      .filter((reading: MetricVolumeReading): boolean => {
        return reading.dataPointCount >= METRIC_INSIGHT_MIN_DATA_POINTS;
      })
      .slice(0, MAX_METRIC_ENTITIES_ASKED)) {
      askedIds.add(readId(volume.serviceId));
    }

    for (const pattern of patterns || []) {
      askedIds.add(readId(pattern.serviceId));
    }

    for (const row of traffic || []) {
      if (row.spanCount >= METRIC_INSIGHT_MIN_SERVICE_SPANS) {
        askedIds.add(readId(row.primaryEntityId));
      }
    }

    askedIds.delete("");

    if (askedIds.size === 0) {
      return [];
    }

    const services: Map<string, MetricServiceFacts> =
      await MetricProblemDetector.readServices({
        projectId,
        serviceIds: Array.from(askedIds),
      });
    const serviceIds: Set<string> = new Set<string>(services.keys());

    const candidates: Array<InsightCandidate> = [];
    const findingsByService: Map<string, number> = new Map<string, number>();

    const keep: (evidence: MetricInsightEvidence) => void = (
      evidence: MetricInsightEvidence,
    ): void => {
      const serviceId: string = readId(evidence.serviceId);
      const found: number = findingsByService.get(serviceId) || 0;
      const service: MetricServiceFacts | undefined = services.get(serviceId);

      if (!service || found >= METRIC_INSIGHT_MAX_FINDINGS_PER_SERVICE) {
        return;
      }

      findingsByService.set(serviceId, found + 1);
      candidates.push(
        MetricProblemDetector.buildCandidate({
          serviceId,
          serviceName: service.name || "this service",
          evidence,
        }),
      );
    };

    // The busiest metrics, read closely: by an attribute, then by buckets.
    for (const evidence of await MetricProblemDetector.readMetrics({
      context,
      window,
      metrics: pickMetricsToRead({
        readings: volumes || [],
        serviceIds,
        excludedServiceIds,
      }),
    })) {
      keep(evidence);
    }

    // Metric names with ids in them.
    for (const pattern of pickExplodedNamePatterns({
      readings: patterns || [],
      serviceIds,
      excludedServiceIds,
    })) {
      keep(MetricProblemDetector.toNamePatternEvidence({ pattern, window }));
    }

    // Busy services with no metrics - only once the hour's metrics were read.
    if (volumes && traffic) {
      for (const evidence of await MetricProblemDetector.readMissingMetrics({
        context,
        window,
        services,
        traffic: pickServicesMissingMetrics({
          traffic: traffic.map(
            (row: ServiceSpanHealthRow): MetricServiceTraffic => {
              return {
                serviceId: row.primaryEntityId,
                spanCount: row.spanCount,
                failedSpanCount: row.failedSpanCount,
              };
            },
          ),
          serviceIds,
          servicesWithMetrics: new Set<string>([
            ...volumes.map((reading: MetricVolumeReading): string => {
              return readId(reading.serviceId);
            }),
            ...(patterns || []).map(
              (reading: MetricNamePatternReading): string => {
                return readId(reading.serviceId);
              },
            ),
          ]),
          excludedServiceIds,
        }),
      })) {
        keep(evidence);
      }
    }

    return candidates;
  }

  // The services among these ids, with what a finding says about each.
  @CaptureSpan()
  public static async readServices(data: {
    projectId: ObjectID;
    serviceIds: Array<string>;
  }): Promise<Map<string, MetricServiceFacts>> {
    const services: Map<string, MetricServiceFacts> = new Map<
      string,
      MetricServiceFacts
    >();
    const ids: Array<string> = Array.from(
      new Set(data.serviceIds.map(readId).filter(Boolean)),
    ).filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    });

    if (ids.length === 0) {
      return services;
    }

    const rows: Array<Service> = await ServiceService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(ids),
      },
      select: { _id: true, name: true, telemetrySdkLanguage: true },
      limit: ids.length,
      skip: 0,
      props: { isRoot: true },
    });

    for (const row of rows) {
      const id: string = readId(row.id?.toString() || row._id);

      if (id) {
        services.set(id, {
          id,
          name: row.name || "",
          sdkLanguage: (row.telemetrySdkLanguage || "").trim(),
        });
      }
    }

    return services;
  }

  // The units the metric catalog records for these metrics, by name.
  private static async readUnits(data: {
    projectId: ObjectID;
    metricNames: Array<string>;
  }): Promise<Map<string, string>> {
    const units: Map<string, string> = new Map<string, string>();
    const names: Array<string> = Array.from(new Set(data.metricNames)).filter(
      Boolean,
    );

    if (names.length === 0) {
      return units;
    }

    try {
      const rows: Array<MetricType> = await MetricTypeService.findBy({
        query: {
          projectId: data.projectId,
          name: QueryHelper.any(names),
        },
        select: { name: true, unit: true },
        limit: names.length,
        skip: 0,
        props: { isRoot: true },
      });

      for (const row of rows) {
        const unit: string = (row.unit || "").trim();

        if (row.name && unit) {
          units.set(row.name, unit);
        }
      }
    } catch (error) {
      logger.debug(
        `MetricProblemDetector: the units of project ${data.projectId.toString()}'s metrics could not be read; their findings name none: ${error}`,
      );
    }

    return units;
  }

  /*
   * The busiest metrics read closely: each is at most one finding - its
   * attribute that took too many values first (it costs the most, and past
   * the SDK's limit its numbers are wrong), else its buckets.
   */
  private static async readMetrics(data: {
    context: InsightScanContext;
    window: MetricInsightWindow;
    metrics: Array<MetricVolumeReading>;
  }): Promise<Array<MetricInsightEvidence>> {
    if (data.metrics.length === 0) {
      return [];
    }

    const projectId: ObjectID = data.context.projectId;
    const keys: Array<MetricSeriesKey> = data.metrics.map(
      (metric: MetricVolumeReading): MetricSeriesKey => {
        return { metricName: metric.metricName, serviceId: metric.serviceId };
      },
    );

    const [shapes, attributes]: [
      Array<MetricShapeRow> | null,
      Array<MetricAttributeCardinalityRow> | null,
    ] = await Promise.all([
      MetricProblemDetector.readPart(data.context, "its busiest metrics", () => {
        return MetricAggregationService.getMetricShapes({
          projectId,
          startTime: data.window.startTime,
          endTime: data.window.endTime,
          metrics: keys,
        });
      }),
      MetricProblemDetector.readPart(
        data.context,
        "its busiest metrics' attributes",
        () => {
          return MetricAggregationService.getMetricAttributeCardinality({
            projectId,
            startTime: data.window.startTime,
            endTime: data.window.endTime,
            metrics: keys,
            minValueCount: METRIC_INSIGHT_MIN_ATTRIBUTE_VALUES,
            sampleSize: METRIC_INSIGHT_VALUE_SAMPLE_SIZE,
          });
        },
      ),
    ]);

    const shapesByMetric: Map<string, Array<MetricShapeRow>> = new Map<
      string,
      Array<MetricShapeRow>
    >();

    for (const shape of shapes || []) {
      const key: string = toKey(shape);
      shapesByMetric.set(key, [...(shapesByMetric.get(key) || []), shape]);
    }

    const attributesByMetric: Map<
      string,
      Array<MetricAttributeCardinalityRow>
    > = new Map<string, Array<MetricAttributeCardinalityRow>>();

    for (const attribute of attributes || []) {
      const key: string = toKey(attribute);
      attributesByMetric.set(key, [
        ...(attributesByMetric.get(key) || []),
        attribute,
      ]);
    }

    const found: Array<{
      metric: MetricVolumeReading;
      highCardinality: MetricHighCardinalityReading | null;
      histogram: {
        shape: MetricShapeReading;
        reading: MetricHistogramBucketsReading;
      } | null;
      hasOverflow: boolean;
    }> = [];

    for (const metric of data.metrics) {
      const key: string = toKey(metric);
      const metricShapes: Array<MetricShapeRow> =
        shapesByMetric.get(key) || [];
      const highCardinality: MetricHighCardinalityReading | null =
        readHighCardinalityAttributes(attributesByMetric.get(key) || []);
      const histogramShape: MetricShapeReading | null =
        pickHistogramReading(metricShapes);
      const histogramReading: MetricHistogramBucketsReading | null =
        histogramShape ? readHistogramBuckets(histogramShape) : null;

      if (!highCardinality && !histogramReading) {
        continue;
      }

      found.push({
        metric,
        highCardinality,
        histogram:
          histogramShape && histogramReading
            ? { shape: histogramShape, reading: histogramReading }
            : null,
        hasOverflow: hasMetricOverflow(metricShapes),
      });
    }

    if (found.length === 0) {
      return [];
    }

    const units: Map<string, string> = await MetricProblemDetector.readUnits({
      projectId,
      metricNames: found.map((item: { metric: MetricVolumeReading }) => {
        return item.metric.metricName;
      }),
    });

    return found.map(
      (item: {
        metric: MetricVolumeReading;
        highCardinality: MetricHighCardinalityReading | null;
        histogram: {
          shape: MetricShapeReading;
          reading: MetricHistogramBucketsReading;
        } | null;
        hasOverflow: boolean;
      }): MetricInsightEvidence => {
        const unit: string | undefined = units.get(item.metric.metricName);

        if (item.highCardinality) {
          return MetricProblemDetector.toAttributeEvidence({
            metric: item.metric,
            window: data.window,
            reading: item.highCardinality,
            hasOverflow: item.hasOverflow,
            unit,
          });
        }

        return MetricProblemDetector.toHistogramEvidence({
          metric: item.metric,
          window: data.window,
          shape: item.histogram!.shape,
          reading: item.histogram!.reading,
          unit,
        });
      },
    );
  }

  /*
   * Whether the metric catalog records a metric from the service: a service
   * that sent metrics before and sends none now lost them some other way -
   * not a pull request's to add. Null when the catalog could not say.
   */
  private static async hasEverSentMetric(data: {
    projectId: ObjectID;
    serviceId: string;
  }): Promise<boolean | null> {
    try {
      const rows: Array<MetricType> = await MetricTypeService.findBy({
        query: {
          projectId: data.projectId,
          services: new IncludesAnyOfGroups([[data.serviceId]]),
        } as never,
        select: { _id: true },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      });

      return rows.length > 0;
    } catch (error) {
      logger.error(
        `MetricProblemDetector: the metric catalog of project ${data.projectId.toString()} could not say whether service ${data.serviceId} sent metrics; it is not filed as missing them: ${error}`,
      );
      return null;
    }
  }

  // The busy services that never sent a metric, with their busiest operations.
  private static async readMissingMetrics(data: {
    context: InsightScanContext;
    window: MetricInsightWindow;
    services: Map<string, MetricServiceFacts>;
    traffic: Array<MetricServiceTraffic>;
  }): Promise<Array<MetricInsightEvidence>> {
    const projectId: ObjectID = data.context.projectId;
    const found: Array<MetricInsightEvidence> = [];

    for (const traffic of data.traffic) {
      if (found.length >= METRIC_INSIGHT_MAX_MISSING_METRICS_SERVICES) {
        break;
      }

      // Unknown is not "never": only a catalog that answers "none" files it.
      if (
        (await MetricProblemDetector.hasEverSentMetric({
          projectId,
          serviceId: traffic.serviceId,
        })) !== false
      ) {
        continue;
      }

      const operations: Array<TraceAnalyticsTableRow> =
        (await MetricProblemDetector.readPart(
          data.context,
          `service ${traffic.serviceId}'s busiest operations`,
          () => {
            return TraceAggregationService.getAnalyticsTable({
              projectId,
              startTime: data.window.startTime,
              endTime: data.window.endTime,
              bucketSizeInMinutes: 60,
              chartType: "table",
              metric: "count",
              groupBy: ["name"],
              serviceIds: [new ObjectID(traffic.serviceId)],
              limit: METRIC_INSIGHT_TOP_OPERATIONS,
              tableSort: { column: "count", direction: "desc" },
            });
          },
        )) || [];

      found.push(
        MetricProblemDetector.toMissingMetricsEvidence({
          traffic,
          window: data.window,
          operations,
          sdkLanguage: data.services.get(traffic.serviceId)?.sdkLanguage,
        }),
      );
    }

    return found;
  }
}

/*
 * The scanner's detectors for the Metrics lane, one per insight type: each
 * hands back its own kind of the shared look's findings.
 */
abstract class MetricProblemKindDetector implements InsightDetector {
  public abstract insightType: AIInsightType;

  public async detect(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    return (await MetricProblemDetector.look(context)).filter(
      (candidate: InsightCandidate): boolean => {
        return candidate.insightType === this.insightType;
      },
    );
  }
}

export class MetricHighCardinalityDetector extends MetricProblemKindDetector {
  public insightType: AIInsightType = AIInsightType.MetricHighCardinality;
}

export class MetricHistogramBucketsDetector extends MetricProblemKindDetector {
  public insightType: AIInsightType = AIInsightType.MetricHistogramBuckets;
}

export class MetricMissingMetricsDetector extends MetricProblemKindDetector {
  public insightType: AIInsightType = AIInsightType.MetricMissingMetrics;
}
