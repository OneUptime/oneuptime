import ObjectID from "../../../../../../Types/ObjectID";
import OneUptimeDate from "../../../../../../Types/Date";
import SentinelInsightType from "../../../../../../Types/AI/SentinelInsightType";
import SentinelInsightSeverity from "../../../../../../Types/AI/SentinelInsightSeverity";
import Service from "../../../../../../Models/DatabaseModels/Service";
import LogAggregationService, {
  AnalyticsTopItem,
  HistogramBucket,
} from "../../../../../Services/LogAggregationService";
import ServiceService from "../../../../../Services/ServiceService";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../Types";

/*
 * ErrorLogSpike — the project's Error/Fatal log volume in the last hour
 * spiked well above its own average hourly rate over the prior 24 hours.
 *
 * Two-stage on purpose (cost): stage 1 is ONE project-wide severity
 * histogram, which ClickHouse serves from the proj_severity_histogram
 * projection because severityText and the minute bucket are the
 * projection's own keys. Only when stage 1 finds a spike does stage 2 run
 * the service-attribution query — a top-list grouped by primaryEntityId,
 * which falls back to a base-table scan but is bounded to the single spike
 * hour. Deterministic — no LLM anywhere in this detector.
 */

// The spike window, compared against the prior baseline window.
export const ERROR_LOG_SPIKE_RECENT_WINDOW_MINUTES: number = 60;

/*
 * Baseline: the 24 hours before the spike window, averaged per hour.
 * Self-baselining means chronically chatty projects don't alert on their
 * normal error volume.
 */
export const ERROR_LOG_SPIKE_BASELINE_WINDOW_HOURS: number = 24;

/*
 * Absolute floor: below 100 errors/hour a "3x spike" can be 20→100 raw
 * lines — routine flakiness, not an event worth a human's attention.
 */
export const ERROR_LOG_SPIKE_MIN_RECENT_COUNT: number = 100;

/*
 * Volume multiplier that counts as a spike. The baseline hourly average is
 * floored at 1 (see evaluateSpike) so a silent project's first errors
 * still register without producing infinite multipliers.
 */
export const ERROR_LOG_SPIKE_MIN_MULTIPLIER: number = 3;

// A >= 10x spike is a step change, not a fluctuation — escalate to High.
export const ERROR_LOG_SPIKE_HIGH_SEVERITY_MULTIPLIER: number = 10;

/*
 * Histogram bucket size. The projection is minute-grained, so any bucket
 * size is projection-served; 5 minutes keeps the recent/prior split error
 * bounded to one bucket (< 5 min of data) while returning only ~300 rows
 * for the whole 25h window.
 */
export const ERROR_LOG_SPIKE_HISTOGRAM_BUCKET_MINUTES: number = 5;

/*
 * At most this many per-service insights per spike. More than 3 services
 * spiking together is one platform event, not N service events — the
 * project-wide evidence block carries the full attribution list anyway.
 */
export const ERROR_LOG_SPIKE_MAX_ATTRIBUTED_SERVICES: number = 3;

// Severity levels that count as "errors" for this detector (OTel names).
export const ERROR_LOG_SEVERITIES: Array<string> = ["Error", "Fatal"];

/*
 * A ClickHouse DateTime rendered with no zone designator: "YYYY-MM-DD
 * hh:mm:ss" (the shape LogAggregationService.getHistogram reads out of the
 * `bucket` column), optionally "T"-separated and/or fractional. Anchored on
 * purpose — any string carrying a zone (…Z, …+05:30) must NOT match, because
 * parseBucketTime appends a Z to whatever matches and a double-designator
 * string parses to an Invalid Date (which splitHistogram would then skip,
 * zeroing the bucket).
 */
const ZONE_LESS_DATETIME_REGEX: RegExp =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

export interface ErrorLogSpikeDecision {
  isSpike: boolean;
  // recent count / max(baseline hourly average, 1).
  multiplier: number;
  severity: SentinelInsightSeverity;
  recentCount: number;
  // prior-window count / ERROR_LOG_SPIKE_BASELINE_WINDOW_HOURS (unfloored).
  baselineHourlyAverage: number;
}

export default class ErrorLogSpikeDetector implements InsightDetector {
  public insightType: SentinelInsightType = SentinelInsightType.ErrorLogSpike;

  /*
   * ClickHouse serves DateTime columns as a zone-less wall clock in the
   * column's own zone — UTC in every OneUptime deployment. `new Date()` reads
   * that shape as the PROCESS's LOCAL time, so on a worker whose TZ is not UTC
   * every bucket silently slides by the UTC offset and the recent/prior
   * boundary below lands in the wrong place: positive offsets push the spike's
   * buckets into the baseline (suppressing every spike while inflating the
   * average it is compared against), negative offsets drag hours of baseline
   * into the "last 60 minutes" (fabricating spikes whose counts cannot even
   * reconcile with stage 2, which binds real Date params and queries the true
   * hour). Normalizing to an explicit UTC instant makes the split depend only
   * on the data, never on the worker's clock configuration.
   *
   * Zone-carrying strings are parsed verbatim — see ZONE_LESS_DATETIME_REGEX.
   * Anything else stays an Invalid Date so splitHistogram's isNaN guard still
   * skips it. Same idiom as the dashboard's EdgeDetailPanel.parseBucketStart.
   */
  public static parseBucketTime(time: string): Date {
    const trimmedTime: string = time.trim();

    if (ZONE_LESS_DATETIME_REGEX.test(trimmedTime)) {
      return new Date(`${trimmedTime.replace(" ", "T")}Z`);
    }

    return new Date(trimmedTime);
  }

  /*
   * Pure split of one histogram into the recent window and the prior
   * baseline window. A bucket belongs to "recent" when it STARTS at or
   * after the boundary; the boundary-straddling bucket therefore counts as
   * prior — a deliberate conservative bias (understates the spike by at
   * most one bucket of data rather than inflating it).
   */
  public static splitHistogram(
    buckets: Array<HistogramBucket>,
    recentWindowStart: Date,
  ): { recentCount: number; priorCount: number } {
    let recentCount: number = 0;
    let priorCount: number = 0;

    for (const bucket of buckets) {
      const bucketTime: Date = ErrorLogSpikeDetector.parseBucketTime(
        bucket.time,
      );
      if (isNaN(bucketTime.getTime())) {
        continue;
      }
      if (bucketTime.getTime() >= recentWindowStart.getTime()) {
        recentCount += bucket.count;
      } else {
        priorCount += bucket.count;
      }
    }

    return { recentCount, priorCount };
  }

  /*
   * Pure decision: recent-hour error count vs the prior 24h window count.
   * Spike ⇔ recent >= ERROR_LOG_SPIKE_MIN_RECENT_COUNT AND
   * recent >= ERROR_LOG_SPIKE_MIN_MULTIPLIER * max(prior/24, 1).
   */
  public static evaluateSpike(
    recentCount: number,
    priorWindowCount: number,
  ): ErrorLogSpikeDecision {
    const baselineHourlyAverage: number =
      priorWindowCount / ERROR_LOG_SPIKE_BASELINE_WINDOW_HOURS;
    const effectiveBaseline: number = Math.max(baselineHourlyAverage, 1);
    const multiplier: number = recentCount / effectiveBaseline;

    const isSpike: boolean =
      recentCount >= ERROR_LOG_SPIKE_MIN_RECENT_COUNT &&
      multiplier >= ERROR_LOG_SPIKE_MIN_MULTIPLIER;

    return {
      isSpike,
      multiplier,
      severity:
        multiplier >= ERROR_LOG_SPIKE_HIGH_SEVERITY_MULTIPLIER
          ? SentinelInsightSeverity.High
          : SentinelInsightSeverity.Medium,
      recentCount,
      baselineHourlyAverage,
    };
  }

  /*
   * Stable dedupe key: per attributed service, or "project" for the
   * unattributed project-wide spike.
   */
  public static buildFingerprint(serviceId: string | undefined): string {
    return `error-log-spike:${serviceId || "project"}`;
  }

  public async detect(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    const recentWindowStart: Date = OneUptimeDate.addRemoveMinutes(
      context.now,
      -1 * ERROR_LOG_SPIKE_RECENT_WINDOW_MINUTES,
    );
    const baselineWindowStart: Date = OneUptimeDate.addRemoveHours(
      recentWindowStart,
      -1 * ERROR_LOG_SPIKE_BASELINE_WINDOW_HOURS,
    );

    /*
     * Stage 1 — projection-fast project-wide severity histogram over the
     * whole 25h (baseline + spike) range. severityTexts stays on the
     * projection; adding any service/entity filter here would silently
     * force a base-table scan (LogAggregationService.appendCommonFilters).
     */
    const buckets: Array<HistogramBucket> =
      await LogAggregationService.getHistogram({
        projectId: context.projectId,
        startTime: baselineWindowStart,
        endTime: context.now,
        bucketSizeInMinutes: ERROR_LOG_SPIKE_HISTOGRAM_BUCKET_MINUTES,
        severityTexts: ERROR_LOG_SEVERITIES,
      });

    const { recentCount, priorCount } = ErrorLogSpikeDetector.splitHistogram(
      buckets,
      recentWindowStart,
    );

    const decision: ErrorLogSpikeDecision = ErrorLogSpikeDetector.evaluateSpike(
      recentCount,
      priorCount,
    );

    if (!decision.isSpike) {
      return [];
    }

    /*
     * Stage 2 — service attribution, only now that a spike exists. This
     * top-list groups by primaryEntityId, which rejects the projection and
     * scans the base table — acceptable because the scan is bounded to the
     * single spike hour.
     */
    const topItems: Array<AnalyticsTopItem> =
      await LogAggregationService.getAnalyticsTopList({
        projectId: context.projectId,
        startTime: recentWindowStart,
        endTime: context.now,
        bucketSizeInMinutes: ERROR_LOG_SPIKE_RECENT_WINDOW_MINUTES,
        chartType: "toplist",
        groupBy: ["primaryEntityId"],
        aggregation: "count",
        severityTexts: ERROR_LOG_SEVERITIES,
        limit: ERROR_LOG_SPIKE_MAX_ATTRIBUTED_SERVICES,
      });

    /*
     * Resolve entity ids to Service names. Non-Service entities (hosts,
     * clusters) resolve to null and keep their raw id as the label — the
     * evidence must stand alone even when attribution is imperfect.
     */
    const topServices: Array<{
      serviceId: string;
      serviceName: string;
      isService: boolean;
      count: number;
    }> = [];

    for (const item of topItems) {
      const service: Service | null = await ServiceService.findOneById({
        id: new ObjectID(item.value),
        select: { name: true },
        props: { isRoot: true },
      });
      topServices.push({
        serviceId: item.value,
        serviceName: service?.name || item.value,
        isService: Boolean(service?.name),
        count: item.count,
      });
    }

    const detailLines: Array<string> = [
      "**Error-log spike detected**",
      "",
      `- Error/Fatal logs in the last ${ERROR_LOG_SPIKE_RECENT_WINDOW_MINUTES} minutes: ${decision.recentCount}`,
      `- Baseline: ${decision.baselineHourlyAverage.toFixed(2)}/hour over the prior ${ERROR_LOG_SPIKE_BASELINE_WINDOW_HOURS}h (${priorCount} total)`,
      `- Spike multiplier: ${decision.multiplier.toFixed(1)}x`,
    ];
    if (topServices.length > 0) {
      detailLines.push("", "Top contributing services in the spike window:");
      for (const top of topServices) {
        detailLines.push(`- ${top.serviceName}: ${top.count} error logs`);
      }
    }
    const detailMarkdown: string = detailLines.join("\n");

    const evidenceTopServices: Array<{ serviceName: string; count: number }> =
      topServices.map(
        (top: {
          serviceId: string;
          serviceName: string;
          isService: boolean;
          count: number;
        }): { serviceName: string; count: number } => {
          return { serviceName: top.serviceName, count: top.count };
        },
      );

    /*
     * One insight per top contributing service so each can be routed and
     * triaged in its own context; when attribution found nothing, a single
     * project-wide insight still surfaces the event.
     */
    if (topServices.length === 0) {
      return [
        {
          insightType: SentinelInsightType.ErrorLogSpike,
          fingerprint: ErrorLogSpikeDetector.buildFingerprint(undefined),
          title: `Error-log spike: ${decision.multiplier.toFixed(1)}x normal volume across the project`,
          detailMarkdown,
          severity: decision.severity,
          evidence: {
            logSpike: {
              recentErrorCount: decision.recentCount,
              baselineHourlyAverage: decision.baselineHourlyAverage,
              spikeMultiplier: decision.multiplier,
              windowMinutes: ERROR_LOG_SPIKE_RECENT_WINDOW_MINUTES,
              topServices: evidenceTopServices,
            },
          },
        },
      ];
    }

    return topServices.map(
      (top: {
        serviceId: string;
        serviceName: string;
        isService: boolean;
        count: number;
      }): InsightCandidate => {
        return {
          insightType: SentinelInsightType.ErrorLogSpike,
          fingerprint: ErrorLogSpikeDetector.buildFingerprint(top.serviceId),
          title: `Error-log spike: ${decision.multiplier.toFixed(1)}x normal volume in ${top.serviceName}`,
          detailMarkdown,
          severity: decision.severity,
          serviceName: top.serviceName,
          telemetryServiceId: top.isService
            ? new ObjectID(top.serviceId)
            : undefined,
          evidence: {
            logSpike: {
              recentErrorCount: decision.recentCount,
              baselineHourlyAverage: decision.baselineHourlyAverage,
              spikeMultiplier: decision.multiplier,
              windowMinutes: ERROR_LOG_SPIKE_RECENT_WINDOW_MINUTES,
              topServices: evidenceTopServices,
            },
          },
        };
      },
    );
  }
}
