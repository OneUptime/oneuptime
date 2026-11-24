import GlobalConfigService from "../../Services/GlobalConfigService";
import MetricService from "../../Services/MetricService";
import logger from "../Logger";
import CaptureSpan from "./CaptureSpan";
import TelemetryUtil from "./Telemetry";
import TelemetryIngestAttributionCounter, {
  TELEMETRY_USAGE_COUNTER_TTL_SECONDS,
  TELEMETRY_USAGE_BUCKET_MINUTES,
  TelemetryUsageCounterEntry,
} from "./TelemetryIngestAttributionCounter";
import TelemetryIngestAttributionSettings from "./TelemetryIngestAttributionSettings";
import {
  AggregationTemporality,
  MetricPointType,
} from "../../../Models/AnalyticsModels/Metric";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import Service from "../../../Models/DatabaseModels/Service";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import TelemetryUsageMetricType from "../../../Types/Telemetry/TelemetryUsageMetricType";
import TelemetryUsageMetricTypeUtil, {
  TELEMETRY_USAGE_METRIC_PROJECT_ID_ATTRIBUTE,
  TELEMETRY_USAGE_METRIC_RESOURCE_ID_ATTRIBUTE,
  TELEMETRY_USAGE_METRIC_RESOURCE_NAME_ATTRIBUTE,
  TELEMETRY_USAGE_METRIC_RESOURCE_TYPE_ATTRIBUTE,
  TELEMETRY_USAGE_METRIC_SIGNAL_ATTRIBUTE,
} from "../../../Utils/Telemetry/TelemetryUsageMetricType";

/*
 * The telemetry usage sweep, every five minutes (the worker job
 * TelemetryUsage:PublishTelemetryUsageMetrics, issue #6355): each finished
 * five-minute bucket of the usage counters the telemetry worker keeps
 * (TelemetryIngestAttribution) becomes `oneuptime.telemetry.usage.bytes`
 * points, one per project, signal and resource, written straight into the
 * project's metrics - so usage can be charted next to every other metric,
 * and a Metrics monitor can alert within minutes when a service sends more.
 *
 * Only for the projects that publish their usage as metrics
 * (Project.publishTelemetryUsageMetrics); a project that turned it off since
 * its batches were counted has its counts dropped, not written.
 *
 * What a point means:
 *
 *   - Each is one resource's bytes of one signal in the five minutes it
 *     starts at: a Sum point, Delta, so a chart's buckets add up to what was
 *     sent in them. Nothing is written for a resource that sent nothing.
 *   - It is keyed to its resource (primaryEntityId, primaryEntityType), so
 *     whoever may read that resource's telemetry reads it - a role limited
 *     to some labels, or to what its team owns, reads only theirs - and it
 *     charts on the resource's page. The unattributed bucket is the
 *     project's (ServiceType.Unknown), as its other telemetry is.
 *   - It is never counted as usage nor billed, nor against any budget: it is
 *     written past ingest, and left out of usage by name
 *     (TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES).
 *
 * It reads only the buckets of the last hour that still hold counts - each
 * is forgotten once written - and only the projects that counted anything
 * in them, never the project table.
 */

// Projects per page: one read, one insert and one forget each.
export const TELEMETRY_USAGE_SWEEP_PAGE_SIZE: number = 500;

export const TELEMETRY_USAGE_SWEEP_MAX_CONSECUTIVE_FAILED_PAGES: number = 3;

// As the budget series: GlobalConfig.monitorMetricRetentionInDays.
const DEFAULT_RETENTION_DAYS: number = 30;

export type TelemetryUsageSweepStopReason =
  | "done"
  | "counters-unavailable"
  | "too-many-failed-pages"
  | "deadline"
  | "lock-lost";

export interface TelemetryUsageSweepOptions {
  shouldContinue?: (() => boolean) | undefined;
  deadline?: Date | undefined;
  now?: Date | undefined;
}

export interface TelemetryUsageSweepSummary {
  stopReason: TelemetryUsageSweepStopReason;
  bucketsRead: number;
  projectsScanned: number;
  pagesFailed: number;
  rowsWritten: number;
}

export default class TelemetryUsageMetrics {
  /*
   * The finished buckets a sweep at `now` reads, oldest first: every bucket
   * the counters may still hold, up to the one before the current.
   */
  public static getFinishedBucketIds(now: Date): Array<string> {
    const current: number = Number(
      TelemetryIngestAttributionCounter.getUsageBucketId(now.getTime()),
    );
    const kept: number = Math.floor(
      TELEMETRY_USAGE_COUNTER_TTL_SECONDS /
        (TELEMETRY_USAGE_BUCKET_MINUTES * 60),
    );
    const buckets: Array<string> = [];

    for (let back: number = kept; back >= 1; back--) {
      buckets.push(String(current - back));
    }

    return buckets;
  }

  /*
   * The rows one project's bucket becomes. Pure, so the series' shape is
   * testable without a sweep around it.
   */
  public static buildRows(data: {
    projectId: string;
    entries: Array<TelemetryUsageCounterEntry>;
    bucketStart: Date;
    retentionDate: Date;
  }): Array<JSONObject> {
    const rows: Array<JSONObject> = [];
    const time: string = OneUptimeDate.toClickhouseDateTime(data.bucketStart);
    const timeUnixNano: string = OneUptimeDate.toUnixNano(
      data.bucketStart,
    ).toString();
    const createdAt: string = OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.getCurrentDate(),
    );

    for (const entry of data.entries) {
      if (!Number.isFinite(entry.bytes) || entry.bytes <= 0) {
        continue;
      }

      const isUnattributed: boolean =
        !ObjectID.isValidUUID(entry.resourceId) ||
        entry.resourceId === data.projectId;
      const primaryEntityId: string = isUnattributed
        ? data.projectId
        : entry.resourceId;
      const primaryEntityType: string = isUnattributed
        ? ServiceType.Unknown
        : entry.resourceType || ServiceType.Unknown;

      const attributes: JSONObject = {
        [TELEMETRY_USAGE_METRIC_PROJECT_ID_ATTRIBUTE]: data.projectId,
        [TELEMETRY_USAGE_METRIC_SIGNAL_ATTRIBUTE]: entry.signalSlug,
        [TELEMETRY_USAGE_METRIC_RESOURCE_TYPE_ATTRIBUTE]: primaryEntityType,
        [TELEMETRY_USAGE_METRIC_RESOURCE_ID_ATTRIBUTE]: primaryEntityId,
      };

      if (entry.resourceName.trim()) {
        attributes[TELEMETRY_USAGE_METRIC_RESOURCE_NAME_ATTRIBUTE] =
          entry.resourceName;
      }

      // A service's own stamps, so its filters find these as its metrics.
      if (primaryEntityType === ServiceType.OpenTelemetry) {
        Object.assign(
          attributes,
          TelemetryUtil.getAttributesForServiceIdAndServiceName({
            serviceId: new ObjectID(primaryEntityId),
            serviceName: entry.resourceName,
          }),
        );
      }

      rows.push({
        _id: ObjectID.generateTimeOrdered().toString(),
        createdAt: createdAt,
        projectId: data.projectId,
        primaryEntityId: primaryEntityId,
        primaryEntityType: primaryEntityType,
        name: TelemetryUsageMetricType.UsageBytes,
        aggregationTemporality: AggregationTemporality.Delta,
        // The bytes of one interval: a Sum, each point its own.
        metricPointType: MetricPointType.Sum,
        time: time,
        startTime: time,
        timeUnixNano: timeUnixNano,
        startTimeUnixNano: timeUnixNano,
        attributes: attributes,
        attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
        isMonotonic: true,
        count: null,
        sum: null,
        min: null,
        max: null,
        bucketCounts: [],
        explicitBounds: [],
        value: entry.bytes,
        retentionDate: OneUptimeDate.toClickhouseDateTime(data.retentionDate),
      } as JSONObject);
    }

    return rows;
  }

  /*
   * One sweep over the finished buckets that still hold counts. Never
   * throws: every failure ends in the summary and the logs, and the next
   * tick picks up what is left (a bucket is kept for an hour).
   */
  @CaptureSpan()
  public static async publishAll(
    options: TelemetryUsageSweepOptions,
  ): Promise<TelemetryUsageSweepSummary> {
    const now: Date = options.now || OneUptimeDate.getCurrentDate();
    const summary: TelemetryUsageSweepSummary = {
      stopReason: "done",
      bucketsRead: 0,
      projectsScanned: 0,
      pagesFailed: 0,
      rowsWritten: 0,
    };

    let retentionDate: Date | null = null;
    let publishing: Set<string> | null = null;
    const registered: Set<string> = new Set<string>();
    let consecutiveFailedPages: number = 0;

    for (const bucketId of this.getFinishedBucketIds(now)) {
      const projects: Array<string> | null =
        await TelemetryIngestAttributionCounter.listUsageProjects(bucketId);

      if (projects === null) {
        summary.stopReason = "counters-unavailable";
        break;
      }

      if (projects.length === 0) {
        continue;
      }

      summary.bucketsRead++;

      if (!retentionDate) {
        retentionDate = OneUptimeDate.addRemoveDurationInDays(
          now,
          await this.getRetentionDays(),
        );
      }

      if (!publishing) {
        publishing =
          await TelemetryIngestAttributionSettings.getUsageMetricProjects();
      }

      for (
        let start: number = 0;
        start < projects.length;
        start += TELEMETRY_USAGE_SWEEP_PAGE_SIZE
      ) {
        if (options.shouldContinue && !options.shouldContinue()) {
          summary.stopReason = "lock-lost";
          return this.finish(summary);
        }

        if (
          options.deadline &&
          OneUptimeDate.getCurrentDate().getTime() >= options.deadline.getTime()
        ) {
          summary.stopReason = "deadline";
          return this.finish(summary);
        }

        const page: Array<string> = projects.slice(
          start,
          start + TELEMETRY_USAGE_SWEEP_PAGE_SIZE,
        );

        summary.projectsScanned += page.length;

        try {
          const written: number | null = await this.publishPage({
            bucketId: bucketId,
            projectIds: page,
            publishing: publishing,
            retentionDate: retentionDate,
            registered: registered,
          });

          if (written === null) {
            summary.stopReason = "counters-unavailable";
            return this.finish(summary);
          }

          summary.rowsWritten += written;
          consecutiveFailedPages = 0;
        } catch (err) {
          summary.pagesFailed++;
          consecutiveFailedPages++;
          logger.error(
            `TelemetryUsageMetrics: could not publish ${page.length} project(s)' usage of bucket ${bucketId}; the next sweep tries again.`,
          );
          logger.error(err);

          if (
            consecutiveFailedPages >=
            TELEMETRY_USAGE_SWEEP_MAX_CONSECUTIVE_FAILED_PAGES
          ) {
            summary.stopReason = "too-many-failed-pages";
            return this.finish(summary);
          }
        }
      }
    }

    return this.finish(summary);
  }

  private static finish(
    summary: TelemetryUsageSweepSummary,
  ): TelemetryUsageSweepSummary {
    logger.debug(
      `TelemetryUsageMetrics: ${summary.stopReason} - ${summary.bucketsRead} bucket(s), ${summary.projectsScanned} project(s), ${summary.rowsWritten} row(s).`,
    );

    return summary;
  }

  /*
   * One page of a bucket's projects: read, written, forgotten. null when the
   * counters could not be read (nothing is written then, or forgotten).
   */
  @CaptureSpan()
  private static async publishPage(data: {
    bucketId: string;
    projectIds: Array<string>;
    publishing: Set<string>;
    retentionDate: Date;
    registered: Set<string>;
  }): Promise<number | null> {
    const usage: Map<string, Array<TelemetryUsageCounterEntry>> | null =
      await TelemetryIngestAttributionCounter.readUsage(
        data.bucketId,
        data.projectIds,
      );

    if (usage === null) {
      return null;
    }

    const bucketStart: Date =
      TelemetryIngestAttributionCounter.getUsageBucketStart(data.bucketId);
    const rows: Array<JSONObject> = [];
    const servicesByProject: Map<string, Set<string>> = new Map();

    for (const [projectId, entries] of usage) {
      // Turned off since it was counted: its counts are dropped.
      if (!data.publishing.has(projectId)) {
        continue;
      }

      const projectRows: Array<JSONObject> = this.buildRows({
        projectId: projectId,
        entries: entries,
        bucketStart: bucketStart,
        retentionDate: data.retentionDate,
      });

      rows.push(...projectRows);

      const services: Set<string> =
        servicesByProject.get(projectId) || new Set<string>();

      for (const row of projectRows) {
        if (row["primaryEntityType"] === ServiceType.OpenTelemetry) {
          services.add(row["primaryEntityId"] as string);
        }
      }

      if (projectRows.length > 0) {
        servicesByProject.set(projectId, services);
      }
    }

    if (rows.length > 0) {
      await MetricService.insertJsonRows(rows);
      await this.registerMetricNames({
        servicesByProject: servicesByProject,
        registered: data.registered,
      });
    }

    await TelemetryIngestAttributionCounter.deleteUsage(
      data.bucketId,
      data.projectIds,
    );

    return rows.length;
  }

  /*
   * Put the name in each project's metric catalog, with its services, so
   * the metric picker and the Metrics monitor builder offer it with its
   * unit, and a service's page lists it. Once per project per sweep; a
   * failure only delays the name.
   */
  private static async registerMetricNames(data: {
    servicesByProject: Map<string, Set<string>>;
    registered: Set<string>;
  }): Promise<void> {
    for (const [projectId, serviceIds] of data.servicesByProject) {
      if (data.registered.has(projectId)) {
        continue;
      }

      const metricNameServiceNameMap: Dictionary<MetricType> = {};

      for (const name of TelemetryUsageMetricTypeUtil.getAll()) {
        const metricType: MetricType = new MetricType();
        metricType.name = name;
        metricType.description =
          TelemetryUsageMetricTypeUtil.getDescription(name);
        metricType.unit = TelemetryUsageMetricTypeUtil.getUnit(name);
        metricType.services = Array.from(serviceIds).map(
          (serviceId: string): Service => {
            const service: Service = new Service();
            service.id = new ObjectID(serviceId);
            return service;
          },
        );
        metricNameServiceNameMap[name] = metricType;
      }

      try {
        await TelemetryUtil.indexMetricNameServiceNameMap({
          projectId: new ObjectID(projectId),
          metricNameServiceNameMap: metricNameServiceNameMap,
        });

        data.registered.add(projectId);
      } catch (err) {
        logger.error(
          `TelemetryUsageMetrics: could not register the usage metric name for project ${projectId}.`,
        );
        logger.error(err);
      }
    }
  }

  private static async getRetentionDays(): Promise<number> {
    try {
      const globalConfig: GlobalConfig | null =
        await GlobalConfigService.findOneById({
          id: ObjectID.getZeroObjectID(),
          select: { monitorMetricRetentionInDays: true },
          props: { isRoot: true },
        });

      const retentionInDays: unknown =
        globalConfig?.monitorMetricRetentionInDays;

      if (
        typeof retentionInDays === "number" &&
        Number.isFinite(retentionInDays) &&
        retentionInDays > 0
      ) {
        return retentionInDays;
      }
    } catch (err) {
      logger.error(
        "TelemetryUsageMetrics: could not read the monitor metric retention; using the default.",
      );
      logger.error(err);
    }

    return DEFAULT_RETENTION_DAYS;
  }
}
