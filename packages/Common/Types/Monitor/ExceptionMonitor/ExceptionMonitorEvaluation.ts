import {
  ANOMALY_SIGMA_BY_SENSITIVITY,
  AnomalyDetectionMethod,
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  DEFAULT_ANOMALY_WINDOW_DAYS,
  MetricAnomalyDetectionOptions,
} from "../CriteriaFilter";
import MonitorCriteriaInstance from "../MonitorCriteriaInstance";
import MonitorStep from "../MonitorStep";

/*
 * WHAT AN EXCEPTIONS MONITOR CAN ALERT ON, BEYOND HOW MANY.
 *
 * Besides the number of matching occurrences in its window (Exception
 * Count), an Exceptions monitor can alert on:
 *
 *   - New Exceptions: matching exception groups first seen in the window -
 *     a bug nobody has seen before;
 *   - Regressed Exceptions: matching groups that came back in the window
 *     after they were resolved, and are still open - a fix that did not
 *     hold;
 *   - Exception Increase (in %): how far the window's count is above the
 *     usual one - the matching occurrences of the day before the window, per
 *     window of the same length - a spike.
 *
 * The count itself can also be judged against what is normal for the hour
 * of the week, learned from the monitor's own history: Exception Count with
 * an anomaly condition (ExceptionLearnedBaseline). That knows a service's
 * daily and weekly rhythm, where a fixed percent over yesterday does not.
 *
 * Shared by the worker that measures them (MonitorTelemetryMonitor), the
 * criteria that judge them (ExceptionMonitorCriteria) and the Dashboard's
 * rule editor. Pure.
 */

export const EXCEPTION_MEASURES: ReadonlyArray<CheckOn> = [
  CheckOn.ExceptionCount,
  CheckOn.NewExceptionCount,
  CheckOn.RegressedExceptionCount,
  CheckOn.ExceptionCountIncreasePercent,
];

// The day before the window: what "the usual" count is read from.
export const EXCEPTION_BASELINE_LOOKBACK_SECONDS: number = 24 * 60 * 60;

/*
 * How many earlier weeks a learned baseline needs before it may alert: the
 * same hour of the week seen more than once, so one odd week is not taken
 * for the service's rhythm. As the shortest baseline window, 14 days.
 */
export const EXCEPTION_BASELINE_MINIMUM_WEEKS: number = 2;

// The longest baseline window: twelve earlier weeks are read at most.
export const EXCEPTION_BASELINE_MAXIMUM_WINDOW_DAYS: number = 90;

/*
 * The fewest exceptions in a window that can read as unusually high. A
 * service that throws almost nothing has almost no range, and its second
 * exception of the month is statistically remarkable and no reason to wake
 * anyone: the first few of a quiet service do not alert, and a real burst
 * does.
 */
export const EXCEPTION_ANOMALY_MINIMUM_COUNT: Record<
  AnomalyDetectionSensitivity,
  number
> = {
  [AnomalyDetectionSensitivity.Low]: 20,
  [AnomalyDetectionSensitivity.Medium]: 10,
  [AnomalyDetectionSensitivity.High]: 5,
};

export interface ExceptionMonitorNeeds {
  newExceptions: boolean;
  regressedExceptions: boolean;
  baseline: boolean;
  /*
   * The baseline windows of the criteria that judge the count against the
   * learned baseline, each once, in days. Empty when none does.
   */
  learnedBaselineWindowDays: Array<number>;
}

// What an anomaly condition on the exception count judges with.
export interface ExceptionAnomalySettings {
  sensitivity: AnomalyDetectionSensitivity;
  sigmaCount: number;
  minimumCount: number;
  windowDays: number;
  method: AnomalyDetectionMethod;
  minSamples: number;
}

export function isExceptionMeasure(checkOn: unknown): checkOn is CheckOn {
  return EXCEPTION_MEASURES.includes(checkOn as CheckOn);
}

/*
 * Whether a filter judges the count against the learned baseline. Only the
 * count has one: a new, regressed or rising measure has no history here.
 */
export function isExceptionCountAnomaly(filter: CriteriaFilter): boolean {
  return (
    filter.checkOn === CheckOn.ExceptionCount &&
    CriteriaFilterUtil.isAnomalyFilterType(filter.filterType)
  );
}

/*
 * The settings of an anomaly condition, each as stored or its default. The
 * API and Terraform write these options as raw JSON, so a value that is not
 * a usable number reads as unset rather than failing the check.
 */
export function getExceptionAnomalySettings(
  options: MetricAnomalyDetectionOptions | undefined,
): ExceptionAnomalySettings {
  const sensitivity: AnomalyDetectionSensitivity = Object.values(
    AnomalyDetectionSensitivity,
  ).includes(options?.sensitivity as AnomalyDetectionSensitivity)
    ? (options!.sensitivity as AnomalyDetectionSensitivity)
    : AnomalyDetectionSensitivity.Medium;

  const sigmaCount: number = Number(options?.sigmaCount);
  const minimumCount: number = Number(options?.minimumCount);
  const windowDays: number = Number(options?.windowDays);
  const minSamples: number = Number(options?.minSamples);

  return {
    sensitivity,
    sigmaCount:
      Number.isFinite(sigmaCount) && sigmaCount > 0
        ? sigmaCount
        : ANOMALY_SIGMA_BY_SENSITIVITY[sensitivity],
    minimumCount:
      options?.minimumCount !== undefined &&
      options.minimumCount !== null &&
      Number.isFinite(minimumCount) &&
      minimumCount >= 0
        ? minimumCount
        : EXCEPTION_ANOMALY_MINIMUM_COUNT[sensitivity],
    windowDays: Math.min(
      Math.max(
        Number.isFinite(windowDays) && windowDays > 0
          ? windowDays
          : DEFAULT_ANOMALY_WINDOW_DAYS,
        EXCEPTION_BASELINE_MINIMUM_WEEKS * 7,
      ),
      EXCEPTION_BASELINE_MAXIMUM_WINDOW_DAYS,
    ),
    method:
      options?.method === AnomalyDetectionMethod.MedianMad
        ? AnomalyDetectionMethod.MedianMad
        : AnomalyDetectionMethod.MeanStddev,
    minSamples: Number.isFinite(minSamples) && minSamples > 0 ? minSamples : 1,
  };
}

/*
 * What the monitor's criteria ask for beyond the count, so the worker reads
 * nothing it will not judge: a plain Exception Count monitor costs what it
 * always did.
 */
export function getExceptionMonitorNeeds(
  monitorStep: MonitorStep | undefined,
): ExceptionMonitorNeeds {
  const needs: ExceptionMonitorNeeds = {
    newExceptions: false,
    regressedExceptions: false,
    baseline: false,
    learnedBaselineWindowDays: [],
  };

  const instances: Array<MonitorCriteriaInstance> =
    monitorStep?.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray ||
    [];

  for (const instance of instances) {
    for (const filter of (instance.data?.filters ||
      []) as Array<CriteriaFilter>) {
      if (filter.checkOn === CheckOn.NewExceptionCount) {
        needs.newExceptions = true;
      }

      if (filter.checkOn === CheckOn.RegressedExceptionCount) {
        needs.regressedExceptions = true;
      }

      if (filter.checkOn === CheckOn.ExceptionCountIncreasePercent) {
        needs.baseline = true;
      }

      if (isExceptionCountAnomaly(filter)) {
        const windowDays: number = getExceptionAnomalySettings(
          filter.metricMonitorOptions?.anomalyDetection,
        ).windowDays;

        if (!needs.learnedBaselineWindowDays.includes(windowDays)) {
          needs.learnedBaselineWindowDays.push(windowDays);
        }
      }
    }
  }

  return needs;
}

/*
 * The usual count for a window of `windowSeconds`: the occurrences of the
 * lookback before it, spread evenly over windows of that length.
 */
export function getUsualExceptionCount(data: {
  previousCount: number;
  windowSeconds: number;
  lookbackSeconds?: number | undefined;
}): number {
  const lookback: number =
    data.lookbackSeconds && data.lookbackSeconds > 0
      ? data.lookbackSeconds
      : EXCEPTION_BASELINE_LOOKBACK_SECONDS;
  const previous: number = Math.max(0, data.previousCount || 0);
  const window: number = Math.max(1, data.windowSeconds || 0);

  return (previous * window) / lookback;
}

/*
 * How far the count is above the usual one, in percent, never below 0. The
 * usual count is taken as at least one occurrence, so a service that was
 * quiet and now throws ten reads 900% - ten times the least it could have
 * been - rather than an infinite jump, and an unchanged or lower count
 * reads 0.
 */
export function getExceptionIncreasePercent(data: {
  currentCount: number;
  usualCount: number;
}): number {
  const usual: number = Math.max(1, data.usualCount || 0);
  const current: number = Math.max(0, data.currentCount || 0);

  if (current <= usual) {
    return 0;
  }

  return Math.round(((current - usual) / usual) * 100);
}
