import GracefulShutdown, {
  ShutdownPriority,
} from "Common/Server/Utils/GracefulShutdown";
import logger from "Common/Server/Utils/Logger";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import MetricService from "Common/Server/Services/MetricService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import {
  AggregationTemporality,
  MetricPointType,
} from "Common/Models/AnalyticsModels/Metric";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { resolveTelemetryRetentionInDays } from "Common/Types/Telemetry/TelemetryRetentionConfig";
import {
  PRODUCT_ANALYTICS_DERIVED_METRICS,
  PRODUCT_ANALYTICS_DERIVED_METRIC_INTERVAL_MS,
  PRODUCT_ANALYTICS_DEVICE_TYPE_ATTRIBUTE,
  PRODUCT_ANALYTICS_EVENT_NAME_ATTRIBUTE,
  ProductAnalyticsDerivedMetric,
  ProductAnalyticsEventKind,
  ProductAnalyticsParsedEvent,
  getProductAnalyticsDerivedMetricDescription,
} from "Common/Types/Rum/ProductAnalyticsEvents";
import { ProductAnalyticsEventsJobData } from "../Services/Queue/TelemetryQueueService";

/*
 * The per-minute series product analytics events feed into the metric store
 * (issue #6444, part two): track() events by event.name, sessions started
 * and pages viewed by device.type, under the RUM application. They are what
 * lets an application's own events be charted in the Metrics explorer, put
 * on a dashboard and alerted on with a Metrics monitor, with nothing new on
 * either side.
 *
 * Counted in memory by each worker process for the minute an event happened
 * in, and written once the minute is over (plus a few seconds for late
 * batches), so a busy application costs one point per name per minute per
 * worker, not one per event. Each point is a Delta Sum: points of the same
 * minute from two workers add up, and a monitor or chart that sums them
 * reads the minute's count. An event that arrives after its minute was
 * written starts a new point for that minute, which sums the same.
 *
 * What a crash loses is at most the minute in hand - the events themselves
 * are in RumProductAnalyticsEventV1 either way, and the Events page reads
 * them there. A graceful shutdown writes everything first.
 */

export interface ProductAnalyticsDerivedBucket {
  projectId: string;
  rumApplicationId: string;
  metric: ProductAnalyticsDerivedMetric;
  attributeKey: string;
  attributeValue: string;
  minuteStartMs: number;
  count: number;
}

/* How long after its minute ends a bucket waits for late batches. */
export const PRODUCT_ANALYTICS_DERIVED_GRACE_MS: number = 5000;

/* How often the buckets are looked at. */
const FLUSH_INTERVAL_MS: number = 15000;

/*
 * Buckets held at once before they are written early, so a flood of event
 * names cannot grow a worker's memory without bound.
 */
export const PRODUCT_ANALYTICS_DERIVED_MAX_BUCKETS: number = 20000;

/* The value a bucket carries when the session reported no device type. */
const UNKNOWN_DEVICE_TYPE: string = "unknown";

export default class ProductAnalyticsDerivedMetrics {
  private static buckets: Map<string, ProductAnalyticsDerivedBucket> = new Map<
    string,
    ProductAnalyticsDerivedBucket
  >();

  private static timer: ReturnType<typeof setInterval> | null = null;
  private static shutdownRegistered: boolean = false;
  private static flushing: Promise<void> | null = null;

  /* (project, name) pairs this process has put in the metric catalog. */
  private static registered: Set<string> = new Set<string>();

  /*
   * Which series an event counts in, and under which attribute; null for
   * none (never, today: every kind has one).
   */
  public static bucketOf(data: {
    job: ProductAnalyticsEventsJobData;
    event: ProductAnalyticsParsedEvent;
  }): Omit<ProductAnalyticsDerivedBucket, "count"> | null {
    const minuteStartMs: number =
      Math.floor(
        data.event.time / PRODUCT_ANALYTICS_DERIVED_METRIC_INTERVAL_MS,
      ) * PRODUCT_ANALYTICS_DERIVED_METRIC_INTERVAL_MS;
    const deviceType: string =
      data.job.context.deviceType || UNKNOWN_DEVICE_TYPE;

    const base: {
      projectId: string;
      rumApplicationId: string;
      minuteStartMs: number;
    } = {
      projectId: data.job.projectId,
      rumApplicationId: data.job.rumApplicationId,
      minuteStartMs: minuteStartMs,
    };

    switch (data.event.kind) {
      case ProductAnalyticsEventKind.Custom:
        return {
          ...base,
          metric: ProductAnalyticsDerivedMetric.Events,
          attributeKey: PRODUCT_ANALYTICS_EVENT_NAME_ATTRIBUTE,
          attributeValue: data.event.name,
        };
      case ProductAnalyticsEventKind.Session:
        return {
          ...base,
          metric: ProductAnalyticsDerivedMetric.Sessions,
          attributeKey: PRODUCT_ANALYTICS_DEVICE_TYPE_ATTRIBUTE,
          attributeValue: deviceType,
        };
      case ProductAnalyticsEventKind.Page:
        return {
          ...base,
          metric: ProductAnalyticsDerivedMetric.PageViews,
          attributeKey: PRODUCT_ANALYTICS_DEVICE_TYPE_ATTRIBUTE,
          attributeValue: deviceType,
        };
      default:
        return null;
    }
  }

  public static countEvents(job: ProductAnalyticsEventsJobData): void {
    for (const event of job.events) {
      const bucket: Omit<ProductAnalyticsDerivedBucket, "count"> | null =
        this.bucketOf({ job: job, event: event });

      if (!bucket) {
        continue;
      }

      const key: string = JSON.stringify([
        bucket.projectId,
        bucket.rumApplicationId,
        bucket.metric,
        bucket.minuteStartMs,
        bucket.attributeKey,
        bucket.attributeValue,
      ]);

      const existing: ProductAnalyticsDerivedBucket | undefined =
        this.buckets.get(key);

      if (existing) {
        existing.count += 1;
      } else {
        this.buckets.set(key, { ...bucket, count: 1 });
      }
    }

    this.ensureTimer();

    if (this.buckets.size >= PRODUCT_ANALYTICS_DERIVED_MAX_BUCKETS) {
      void this.flush({ everything: true });
    }
  }

  /*
   * Take the buckets whose minute (and grace) is over - or every bucket -
   * out of memory.
   */
  public static takeDue(data: {
    nowMs: number;
    everything: boolean;
  }): Array<ProductAnalyticsDerivedBucket> {
    const due: Array<ProductAnalyticsDerivedBucket> = [];

    for (const [key, bucket] of this.buckets) {
      const endsAt: number =
        bucket.minuteStartMs +
        PRODUCT_ANALYTICS_DERIVED_METRIC_INTERVAL_MS +
        PRODUCT_ANALYTICS_DERIVED_GRACE_MS;

      if (data.everything || endsAt <= data.nowMs) {
        due.push(bucket);
        this.buckets.delete(key);
      }
    }

    return due;
  }

  /* One Delta Sum point per bucket, at its minute. */
  public static buildRows(data: {
    buckets: Array<ProductAnalyticsDerivedBucket>;
    retentionInDaysByApplication: Map<string, number>;
    writtenAt: Date;
  }): Array<JSONObject> {
    return data.buckets.map(
      (bucket: ProductAnalyticsDerivedBucket): JSONObject => {
        const start: Date = new Date(bucket.minuteStartMs);
        const timestamp: string = OneUptimeDate.toClickhouseDateTime(start);
        const attributes: JSONObject = {
          [bucket.attributeKey]: bucket.attributeValue,
        };
        const retentionInDays: number =
          data.retentionInDaysByApplication.get(bucket.rumApplicationId) || 30;

        return {
          _id: ObjectID.generateTimeOrdered().toString(),
          createdAt: OneUptimeDate.toClickhouseDateTime(data.writtenAt),
          projectId: bucket.projectId,
          primaryEntityId: bucket.rumApplicationId,
          primaryEntityType: ServiceType.RealUserMonitor,
          name: bucket.metric,
          aggregationTemporality: AggregationTemporality.Delta,
          metricPointType: MetricPointType.Sum,
          time: timestamp,
          startTime: timestamp,
          timeUnixNano: OneUptimeDate.toUnixNano(start).toString(),
          startTimeUnixNano: OneUptimeDate.toUnixNano(start).toString(),
          attributes: attributes,
          attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
          isMonotonic: true,
          count: null,
          sum: null,
          min: null,
          max: null,
          bucketCounts: [],
          explicitBounds: [],
          value: bucket.count,
          retentionDate: OneUptimeDate.toClickhouseDateTime(
            OneUptimeDate.addRemoveDays(start, retentionInDays),
          ),
        } as JSONObject;
      },
    );
  }

  public static async flush(data: { everything: boolean }): Promise<void> {
    if (this.flushing) {
      await this.flushing;
    }

    const due: Array<ProductAnalyticsDerivedBucket> = this.takeDue({
      nowMs: Date.now(),
      everything: data.everything,
    });

    if (due.length === 0) {
      return;
    }

    this.flushing = this.write(due).finally((): void => {
      this.flushing = null;
    });

    await this.flushing;
  }

  private static async write(
    buckets: Array<ProductAnalyticsDerivedBucket>,
  ): Promise<void> {
    try {
      const retentionInDaysByApplication: Map<string, number> = new Map<
        string,
        number
      >();

      for (const bucket of buckets) {
        if (retentionInDaysByApplication.has(bucket.rumApplicationId)) {
          continue;
        }

        const metadata: TelemetryServiceMetadata =
          await OTelIngestService.buildResourceMetadataForNonService({
            serviceName: "RUM Application",
            resourceId: new ObjectID(bucket.rumApplicationId),
            primaryEntityType: ServiceType.RealUserMonitor,
            projectId: new ObjectID(bucket.projectId),
          });

        retentionInDaysByApplication.set(
          bucket.rumApplicationId,
          resolveTelemetryRetentionInDays({
            pillar: "metrics",
            serviceConfig: metadata.serviceRetentionConfig,
            serviceRetentionInDays: metadata.serviceRetentionInDays,
            projectConfig: metadata.projectRetentionConfig,
            projectRetentionInDays: metadata.projectRetentionInDays,
          }),
        );
      }

      await MetricService.insertJsonRows(
        this.buildRows({
          buckets: buckets,
          retentionInDaysByApplication: retentionInDaysByApplication,
          writtenAt: new Date(),
        }),
      );

      await this.register(buckets);
    } catch (err) {
      logger.error(
        `ProductAnalyticsDerivedMetrics: could not write ${buckets.length} per-minute event counts.`,
      );
      logger.error(err);
    }
  }

  /* Put the three names in each project's metric catalog, once a process. */
  private static async register(
    buckets: Array<ProductAnalyticsDerivedBucket>,
  ): Promise<void> {
    const projectIds: Set<string> = new Set<string>(
      buckets.map((bucket: ProductAnalyticsDerivedBucket): string => {
        return bucket.projectId;
      }),
    );

    for (const projectId of projectIds) {
      if (this.registered.has(projectId)) {
        continue;
      }

      const map: Dictionary<MetricType> = {};

      for (const metric of PRODUCT_ANALYTICS_DERIVED_METRICS) {
        const metricType: MetricType = new MetricType();
        metricType.name = metric;
        metricType.description =
          getProductAnalyticsDerivedMetricDescription(metric);
        metricType.unit = "";
        map[metric] = metricType;
      }

      try {
        await TelemetryUtil.indexMetricNameServiceNameMap({
          projectId: new ObjectID(projectId),
          metricNameServiceNameMap: map,
        });

        this.registered.add(projectId);
      } catch (err) {
        logger.error(
          `ProductAnalyticsDerivedMetrics: could not register the event count metrics for project ${projectId}.`,
        );
        logger.error(err);
      }
    }
  }

  private static ensureTimer(): void {
    if (!this.timer) {
      this.timer = setInterval((): void => {
        void this.flush({ everything: false });
      }, FLUSH_INTERVAL_MS);

      /* Never the reason a process stays up. */
      if (typeof this.timer.unref === "function") {
        this.timer.unref();
      }
    }

    if (!this.shutdownRegistered) {
      this.shutdownRegistered = true;

      GracefulShutdown.registerHandler(
        "ProductAnalyticsDerivedMetrics",
        ShutdownPriority.Workers,
        async (): Promise<void> => {
          await this.flush({ everything: true });
        },
      );
    }
  }

  /* Tests: forget every bucket, timer and registration. */
  public static resetForTests(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.buckets.clear();
    this.registered.clear();
    this.flushing = null;
  }

  public static getBucketCountForTests(): number {
    return this.buckets.size;
  }
}
