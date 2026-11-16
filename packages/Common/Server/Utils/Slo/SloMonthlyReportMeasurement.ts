import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import {
  SloMonitorUptimeMonthlyFigures,
  SloMonthlyFigures,
  SloMonthlyReport,
  SloMonthlyReportPeriod,
  SloMonthlyReportUnavailableReason,
  SloReportMonth,
  buildSloMonthlyReport,
  buildUnavailableSloMonthlyReport,
  computeMonitorUptimeMonthlyFigures,
  getRequestMonthlyFigures,
  getSloMonthlyReportTimezone,
  getSloReportMonths,
  isValidSloTargetPercentage,
} from "../../../Utils/Slo/SloMonthlyReport";
import {
  getSloMetricQueryProblem,
  normalizeSloMetricQueryConfig,
} from "../../../Utils/Slo/SloMetricSli";
import {
  SloRequestCountingRange,
  SloRequestCounts,
  isEventSliType,
} from "../../../Utils/Slo/SloRequestSli";
import { MonitorTimelineSet } from "../../../Utils/Slo/SloUtil";
import {
  fetchPerMonitorTimelines,
  getDowntimeStatuses,
} from "./SloMonitorTimelines";
import SloRequestCounting from "./SloRequestCounting";

/*
 * An SLO's monthly report, measured when it is asked for
 * (Utils/Slo/SloMonthlyReport says what it holds):
 *
 *   - a Monitor Uptime SLO: its monitors' status timelines over the whole
 *     period, read once, then measured month by month as the evaluation
 *     worker measures a window - the SLO's monitors combined, and each
 *     monitor alone for the breakdown;
 *   - a request SLO: the request counts the worker keeps in SloHistory,
 *     summed month by month in one query, inside what its current counting
 *     covers - and a Metric SLO's event counts, which the worker keeps the
 *     same way.
 *
 * Read as OneUptime: the caller was already allowed to read the SLO. The
 * breakdown names only the monitors the caller may read (readMonitorNames);
 * the SLO's own figures count every monitor it has, as its Overview does.
 */

// The columns of the SLO the report reads.
export const SLO_MONTHLY_REPORT_SELECT: {
  _id: true;
  projectId: true;
  name: true;
  sliType: true;
  targetPercentage: true;
  timezone: true;
  multiMonitorMode: true;
  latencyThresholdInMilliseconds: true;
  metricQueryConfig: true;
  firstAccumulatedBucketStartAt: true;
  lastAccumulatedBucketEndAt: true;
  services: { _id: true };
  monitors: { _id: true };
  downtimeMonitorStatuses: { _id: true };
} = {
  _id: true,
  projectId: true,
  name: true,
  sliType: true,
  targetPercentage: true,
  timezone: true,
  multiMonitorMode: true,
  latencyThresholdInMilliseconds: true,
  // Whether a Metric SLO has a metric it can count at all.
  metricQueryConfig: true,
  firstAccumulatedBucketStartAt: true,
  lastAccumulatedBucketEndAt: true,
  services: { _id: true },
  monitors: { _id: true },
  downtimeMonitorStatuses: { _id: true },
};

/*
 * The names of the monitors the caller may read, by id. A monitor left out
 * is measured with the rest of the SLO but has no row of its own.
 */
export type SloMonitorNamesReader = (
  monitorIds: Array<ObjectID>,
) => Promise<Map<string, string>>;

type IdsOfFunction = (
  items: Array<{ id: ObjectID | null }> | undefined,
) => Array<ObjectID>;

const idsOf: IdsOfFunction = (
  items: Array<{ id: ObjectID | null }> | undefined,
): Array<ObjectID> => {
  return (items || [])
    .map((item: { id: ObjectID | null }): ObjectID | null => {
      return item.id || null;
    })
    .filter((id: ObjectID | null): id is ObjectID => {
      return Boolean(id);
    });
};

type ToDateFunction = (value: Date | string | undefined | null) => Date | null;

const toDate: ToDateFunction = (
  value: Date | string | undefined | null,
): Date | null => {
  if (!value) {
    return null;
  }

  const date: Date = OneUptimeDate.fromString(value);

  return Number.isFinite(date.getTime()) ? date : null;
};

export default class SloMonthlyReportMeasurement {
  public static async measure(data: {
    slo: ServiceLevelObjective;
    period: SloMonthlyReportPeriod;
    now: Date;
    readMonitorNames?: SloMonitorNamesReader | undefined;
  }): Promise<SloMonthlyReport> {
    const { slo, period, now } = data;

    // An SLO from before SLI types were chosen measures monitor uptime.
    const sliType: SliType = slo.sliType || SliType.MonitorUptime;
    const targetPercentage: number = Number(slo.targetPercentage);
    const timezone: string = getSloMonthlyReportTimezone(slo.timezone);

    const unavailable: (
      reason: SloMonthlyReportUnavailableReason,
    ) => SloMonthlyReport = (
      reason: SloMonthlyReportUnavailableReason,
    ): SloMonthlyReport => {
      return buildUnavailableSloMonthlyReport({
        sloId: slo.id!,
        sloName: slo.name,
        sliType: sliType,
        targetPercentage: targetPercentage,
        timezone: timezone,
        period: period,
        reason: reason,
        now: now,
      });
    };

    // A request SLO's requests, or a Metric SLO's events: counted steps.
    const isEventSlo: boolean = isEventSliType(sliType);
    const isMetricSlo: boolean = sliType === SliType.Metric;

    if (!isEventSlo && sliType !== SliType.MonitorUptime) {
      return unavailable(SloMonthlyReportUnavailableReason.NotMeasured);
    }

    if (isEventSlo) {
      if (idsOf(slo.services as Array<Service> | undefined).length === 0) {
        return unavailable(
          isMetricSlo
            ? SloMonthlyReportUnavailableReason.NoServicesForMetric
            : SloMonthlyReportUnavailableReason.NoServices,
        );
      }

      if (
        isMetricSlo &&
        getSloMetricQueryProblem(
          normalizeSloMetricQueryConfig(slo.metricQueryConfig),
        ) !== null
      ) {
        return unavailable(SloMonthlyReportUnavailableReason.NoMetric);
      }

      const threshold: number = Number(slo.latencyThresholdInMilliseconds);

      if (
        sliType === SliType.RequestLatency &&
        (!Number.isFinite(threshold) || threshold < 1)
      ) {
        return unavailable(
          SloMonthlyReportUnavailableReason.NoLatencyThreshold,
        );
      }
    } else if (idsOf(slo.monitors as Array<Monitor> | undefined).length === 0) {
      return unavailable(SloMonthlyReportUnavailableReason.NoMonitors);
    }

    if (!isValidSloTargetPercentage(targetPercentage)) {
      return unavailable(SloMonthlyReportUnavailableReason.TargetOutOfRange);
    }

    const months: Array<SloReportMonth> = getSloReportMonths({
      period: period,
      timezone: timezone,
      now: now,
    });

    const report: {
      figures: Array<SloMonthlyFigures>;
      monitors: Array<{
        monitorId: ObjectID;
        name: string;
        months: Array<SloMonthlyFigures>;
      }>;
    } = isEventSlo
      ? {
          figures: await SloMonthlyReportMeasurement.measureRequests({
            slo: slo,
            months: months,
          }),
          monitors: [],
        }
      : await SloMonthlyReportMeasurement.measureMonitors({
          slo: slo,
          months: months,
          now: now,
          readMonitorNames: data.readMonitorNames,
        });

    return buildSloMonthlyReport({
      sloId: slo.id!,
      sloName: slo.name,
      sliType: sliType,
      targetPercentage: targetPercentage,
      timezone: timezone,
      period: period,
      months: months,
      figures: report.figures,
      monitors: report.monitors,
      now: now,
    });
  }

  /*
   * The ranges a request SLO's months are summed over: each month, inside
   * what the current counting covers. Steps outside it may hold counts of
   * something the SLO no longer counts, or none at all yet - a month
   * outside it is an empty range, which reads as no data.
   */
  public static getRequestRanges(data: {
    months: Array<SloReportMonth>;
    firstAccumulatedBucketStartAt: Date | null;
    lastAccumulatedBucketEndAt: Date | null;
  }): Array<SloRequestCountingRange> {
    return data.months.map((month: SloReportMonth): SloRequestCountingRange => {
      if (
        !data.firstAccumulatedBucketStartAt ||
        !data.lastAccumulatedBucketEndAt
      ) {
        return { from: month.startDate, to: month.startDate };
      }

      return {
        from: new Date(
          Math.max(
            month.startDate.getTime(),
            data.firstAccumulatedBucketStartAt.getTime(),
          ),
        ),
        to: new Date(
          Math.min(
            month.endDate.getTime(),
            data.lastAccumulatedBucketEndAt.getTime(),
          ),
        ),
      };
    });
  }

  private static async measureRequests(data: {
    slo: ServiceLevelObjective;
    months: Array<SloReportMonth>;
  }): Promise<Array<SloMonthlyFigures>> {
    const counts: Array<SloRequestCounts> =
      await SloRequestCounting.readRangeSums({
        projectId: data.slo.projectId!,
        sloId: data.slo.id!,
        ranges: SloMonthlyReportMeasurement.getRequestRanges({
          months: data.months,
          firstAccumulatedBucketStartAt: toDate(
            data.slo.firstAccumulatedBucketStartAt,
          ),
          lastAccumulatedBucketEndAt: toDate(
            data.slo.lastAccumulatedBucketEndAt,
          ),
        }),
      });

    return counts.map(getRequestMonthlyFigures);
  }

  private static async measureMonitors(data: {
    slo: ServiceLevelObjective;
    months: Array<SloReportMonth>;
    now: Date;
    readMonitorNames?: SloMonitorNamesReader | undefined;
  }): Promise<{
    figures: Array<SloMonthlyFigures>;
    monitors: Array<{
      monitorId: ObjectID;
      name: string;
      months: Array<SloMonthlyFigures>;
    }>;
  }> {
    const firstMonth: SloReportMonth | undefined = data.months[0];
    const lastMonth: SloReportMonth | undefined =
      data.months[data.months.length - 1];

    // A year that has not started yet: nothing to read.
    if (!firstMonth || !lastMonth) {
      return { figures: [], monitors: [] };
    }

    const monitorIds: Array<ObjectID> = idsOf(
      data.slo.monitors as Array<Monitor> | undefined,
    );

    const perMonitorTimelines: Array<MonitorTimelineSet> =
      await fetchPerMonitorTimelines({
        projectId: data.slo.projectId!,
        monitorIds: monitorIds,
        windowStart: firstMonth.startDate,
        windowEnd: new Date(
          Math.min(lastMonth.endDate.getTime(), data.now.getTime()),
        ),
      });

    const downtimeStatuses: Array<MonitorStatus> = await getDowntimeStatuses({
      projectId: data.slo.projectId!,
      configuredStatusIds: idsOf(
        data.slo.downtimeMonitorStatuses as Array<MonitorStatus> | undefined,
      ),
    });

    const figures: SloMonitorUptimeMonthlyFigures =
      computeMonitorUptimeMonthlyFigures({
        perMonitorTimelines: perMonitorTimelines,
        downtimeStatuses: downtimeStatuses,
        mode: data.slo.multiMonitorMode || SloMultiMonitorMode.AnyDown,
        months: data.months,
      });

    const names: Map<string, string> = data.readMonitorNames
      ? await data.readMonitorNames(monitorIds)
      : new Map<string, string>();

    return {
      figures: figures.months,
      monitors: figures.monitors
        .filter(
          (monitor: {
            monitorId: ObjectID;
            months: Array<SloMonthlyFigures>;
          }): boolean => {
            return names.has(monitor.monitorId.toString());
          },
        )
        .map(
          (monitor: {
            monitorId: ObjectID;
            months: Array<SloMonthlyFigures>;
          }): {
            monitorId: ObjectID;
            name: string;
            months: Array<SloMonthlyFigures>;
          } => {
            return {
              monitorId: monitor.monitorId,
              name: names.get(monitor.monitorId.toString()) || "",
              months: monitor.months,
            };
          },
        ),
    };
  }
}
