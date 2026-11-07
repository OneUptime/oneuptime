import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import TimeRange from "Common/Types/Time/TimeRange";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import MonitorStepMetricQueries, {
  MetricMonitorStepSettings,
  MonitorStepMetricReads,
} from "Common/Utils/Monitor/MonitorStepMetricQueries";
import {
  MonitorMetricThreshold,
  MonitorMetricThresholdOutcome,
} from "Common/Utils/Monitor/MonitorStepMetricThresholds";
import MetricInvestigationTime from "../Components/Metrics/Investigation/MetricInvestigationTime";
import {
  MetricInvestigationThreshold,
  getRangeShowingInterval,
} from "../Components/Metrics/Investigation/MetricInvestigationThresholds";

/*
 * What a metric-backed monitor's own page charts (issue #5759): the metrics
 * the monitor checks - its queries with the filters it reads them with
 * (MonitorStepMetricQueries) - with the values its criteria alert at drawn
 * across them (MonitorStepMetricThresholds), and the moments its status
 * changed marked on them.
 *
 * Pure: the card, its tests and the page read it the same way.
 */

// Where the monitor page keeps its metric investigation in its URL.
export const MONITOR_METRIC_INVESTIGATION_URL_PREFIX: string = "metrics";

// Which criteria step the card charts, when it is not the first (1-based).
export const MONITOR_METRIC_STEP_URL_PARAM: string = "metricsStep";

/*
 * Each step's investigation keeps what the reader changed under names of
 * its own, so going to another step and back finds the first as it was
 * left. The first step's are the page's ("metricsTime"), as on a monitor
 * with one step.
 */
export function getMonitorMetricUrlParamPrefix(stepIndex: number): string {
  return stepIndex > 0
    ? `${MONITOR_METRIC_INVESTIGATION_URL_PREFIX}Step${stepIndex + 1}`
    : MONITOR_METRIC_INVESTIGATION_URL_PREFIX;
}

export interface MonitorMetricStep {
  // Where it sits among the monitor's steps, from 0.
  index: number;
  step: MonitorStep;
  reads: MonitorStepMetricReads;
}

// Whether the monitor's page charts its metrics: a metric-backed type.
export function hasMonitorMetrics(
  monitorType: MonitorType | undefined,
): boolean {
  return MonitorTypeHelper.isMetricBackedMonitor(monitorType);
}

/*
 * The monitor's steps that have metrics to chart: a query with its metric
 * picked. A step still being set up is skipped.
 */
export function getMonitorMetricSteps(input: {
  monitorType: MonitorType | undefined;
  monitorSteps: MonitorSteps | undefined | null;
}): Array<MonitorMetricStep> {
  if (!hasMonitorMetrics(input.monitorType)) {
    return [];
  }

  const steps: Array<MonitorStep> =
    input.monitorSteps?.data?.monitorStepsInstanceArray || [];

  const metricSteps: Array<MonitorMetricStep> = [];

  steps.forEach((step: MonitorStep, index: number): void => {
    const reads: MonitorStepMetricReads | null =
      MonitorStepMetricQueries.getReads({
        monitorType: input.monitorType,
        monitorStep: step,
      });

    const hasMetric: boolean = Boolean(
      reads?.queryConfigs.some((queryConfig: MetricQueryConfigData) => {
        return Boolean(
          queryConfig.metricQueryData?.filterData?.metricName?.toString(),
        );
      }),
    );

    if (reads && hasMetric) {
      metricSteps.push({ index, step, reads });
    }
  });

  return metricSteps;
}

/*
 * The step a link picked ("metricsStep=2"), by its place in the list the
 * card offers; the first for anything else.
 */
export function readMonitorMetricStepPosition(
  value: string | null | undefined,
  stepCount: number,
): number {
  const position: number = Number((value || "").trim());

  if (!Number.isInteger(position) || position < 1 || position > stepCount) {
    return 0;
  }

  return position - 1;
}

/*
 * The range a step's charts start from: the longest the time picker offers
 * whose points cover what the monitor reads at a time - a minute for a
 * check over up to three hours - so the metric reads as the monitor reads
 * it and every threshold line shows. A day when no range draws points of
 * that length.
 */
export function getMonitorMetricDefaultRange(
  reads: Pick<MonitorStepMetricReads, "rollingTime">,
): TimeRange {
  return (
    getRangeShowingInterval(
      MonitorStepMetricQueries.getEvaluationInterval({
        rollingTime: reads.rollingTime,
        // A window read whole is still a window of this length.
        aggregatesWholeWindow: false,
      }),
    ) || TimeRange.PAST_ONE_DAY
  );
}

// The colour a threshold is drawn in, by what crossing it does.
export const MONITOR_THRESHOLD_COLORS: Record<
  MonitorMetricThresholdOutcome,
  string
> = {
  [MonitorMetricThresholdOutcome.Incident]: "#ef4444", // red-500
  [MonitorMetricThresholdOutcome.Alert]: "#f59e0b", // amber-500
  [MonitorMetricThresholdOutcome.StatusChange]: "#f97316", // orange-500
};

// A monitor's thresholds as an investigation draws them.
export function toMetricInvestigationThresholds(
  thresholds: Array<MonitorMetricThreshold>,
): Array<MetricInvestigationThreshold> {
  return thresholds.map(
    (threshold: MonitorMetricThreshold): MetricInvestigationThreshold => {
      return {
        metricVariable: threshold.metricVariable,
        value: threshold.value,
        unit: threshold.unit,
        name: threshold.criteriaName,
        filterType: threshold.filterType,
        isForecast: threshold.isForecast,
        color: MONITOR_THRESHOLD_COLORS[threshold.outcome],
        shade: threshold.breachSide || undefined,
        onlyAtInterval: threshold.onlyAtInterval,
      };
    },
  );
}

// One change of the monitor's status: when it moved into which status.
export interface MonitorStatusChange {
  date: Date;
  // As the project named the status; "" when it is no longer known.
  statusName: string;
  // The status's colour; "" when it is no longer known.
  color: string;
}

// What a status change is called when its status is no longer known.
export const STATUS_CHANGED_LABEL: string = translationKey("Status changed");

// Under every status change's label, telling it from other marks.
export const STATUS_CHANGE_SUBTITLE: string = translationKey("Monitor status");

// A status change's colour when its status has none.
export const STATUS_CHANGE_COLOR: string = "#64748b"; // slate-500

// One row of the monitor's status timeline, as it is read.
export interface MonitorStatusTimelineRow {
  startsAt?: Date | string | undefined;
  monitorStatus?:
    | {
        name?: string | undefined;
        color?: { toString: () => string } | string | undefined;
      }
    | undefined;
}

// The rows of the monitor's status timeline the charts mark, in time order.
export function getMonitorStatusChanges(input: {
  rows: Array<MonitorStatusTimelineRow>;
  window: InBetween<Date> | null | undefined;
}): Array<MonitorStatusChange> {
  const window: InBetween<Date> | null = MetricInvestigationTime.toUsableWindow(
    input.window,
  );

  if (!window) {
    return [];
  }

  const startMs: number = window.startValue.getTime();
  const endMs: number = window.endValue.getTime();

  return input.rows
    .map((row: MonitorStatusTimelineRow): MonitorStatusChange | null => {
      const dateMs: number = row.startsAt
        ? new Date(row.startsAt as Date).getTime()
        : Number.NaN;

      if (!Number.isFinite(dateMs) || dateMs < startMs || dateMs > endMs) {
        return null;
      }

      return {
        date: new Date(dateMs),
        statusName: (row.monitorStatus?.name || "").trim(),
        color: row.monitorStatus?.color
          ? row.monitorStatus.color.toString()
          : "",
      };
    })
    .filter(
      (change: MonitorStatusChange | null): change is MonitorStatusChange => {
        return change !== null;
      },
    )
    .sort((first: MonitorStatusChange, second: MonitorStatusChange): number => {
      return first.date.getTime() - second.date.getTime();
    });
}

/*
 * The name of the resource an infrastructure step watches, as it names it:
 * its host, cluster, cloud, vCenter, array or fleet. "" for a Metrics step,
 * or one that names none.
 */
export function getMonitorResourceName(
  settings: MetricMonitorStepSettings | null | undefined,
): string {
  if (!settings) {
    return "";
  }

  const record: Record<string, unknown> = settings as unknown as Record<
    string,
    unknown
  >;

  for (const field of [
    "hostIdentifier",
    "clusterIdentifier",
    "cloudIdentifier",
    "vcenterIdentifier",
    "arrayIdentifier",
    "fleetIdentifier",
  ]) {
    const value: unknown = record[field];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

/*
 * What to check when a monitor's charts come back with nothing, in
 * English: whether its data still arrives, and whether its filters match
 * what does. A sentence naming the resource when the step names one.
 */
export interface MonitorMetricEmptyHint {
  // The template, with {{resource}} where the resource's name goes.
  arrival: string;
  // The same without a name.
  arrivalWithoutResource: string;
  filters: string;
}

export const MONITOR_METRIC_EMPTY_TITLE: string = translationKey(
  "No data for these metrics in this time range.",
);

export function getMonitorMetricEmptyHint(
  monitorType: MonitorType | undefined,
): MonitorMetricEmptyHint {
  if (MonitorTypeHelper.isInfrastructureMonitor(monitorType)) {
    return {
      arrival: translationKey(
        "Check that the agent reporting on {{resource}} is running and sending metrics.",
      ),
      arrivalWithoutResource: translationKey(
        "Check that the agent this monitor reads is running and sending metrics.",
      ),
      filters: translationKey(
        "Check that this monitor's metrics and filters match what the agent sends.",
      ),
    };
  }

  return {
    arrival: translationKey(
      "Check that these metrics are still being sent to OneUptime.",
    ),
    arrivalWithoutResource: translationKey(
      "Check that these metrics are still being sent to OneUptime.",
    ),
    filters: translationKey(
      "Check that this monitor's filters match the attributes the metrics are sent with.",
    ),
  };
}
