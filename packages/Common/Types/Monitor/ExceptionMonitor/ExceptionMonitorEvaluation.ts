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
 *     window of the same length - a spike;
 *   - Sessions With Exceptions (in %): the share of the window's sessions a
 *     matching exception happened in, and Sessions, how many there were -
 *     the distinct session.id of the spans of the monitor's services. With
 *     a crash's filters, a mobile app's crash rate (#9716): crashed
 *     sessions over sessions, which Android vitals judges a rate of, where
 *     the count alone grows with the app's audience.
 *   - Installs With Exceptions (in %): the share of the window's installs a
 *     matching exception happened on, and Installs, how many there were -
 *     the distinct install (app.installation.id, else device.id:
 *     MobileAppTelemetry) of the spans of the monitor's services (#9924).
 *     Over a day it is the rate Android vitals calls user-perceived and the
 *     Play Console shows: the share of the day's users a crash reached,
 *     where one person's crash loop counts once.
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
  CheckOn.SessionsWithExceptionsPercent,
  CheckOn.SessionCount,
  CheckOn.InstallsWithExceptionsPercent,
  CheckOn.InstallCount,
];

// The measures read from the window's sessions.
export const EXCEPTION_SESSION_MEASURES: ReadonlyArray<CheckOn> = [
  CheckOn.SessionsWithExceptionsPercent,
  CheckOn.SessionCount,
];

// The measures read from the window's installs (#9924).
export const EXCEPTION_INSTALL_MEASURES: ReadonlyArray<CheckOn> = [
  CheckOn.InstallsWithExceptionsPercent,
  CheckOn.InstallCount,
];

// The shares: typed with their fraction ("1.09"), and judged with it.
export const EXCEPTION_SHARE_MEASURES: ReadonlyArray<CheckOn> = [
  CheckOn.SessionsWithExceptionsPercent,
  CheckOn.InstallsWithExceptionsPercent,
];

/*
 * What the monitor form's single rule can alert on: every measure but the
 * sessions and installs alone, which say how much the app was used rather
 * than anything about its exceptions - the criteria editor offers them, as
 * the fewest sessions or installs a share is judged on.
 */
export const EXCEPTION_RULE_MEASURES: ReadonlyArray<CheckOn> =
  EXCEPTION_MEASURES.filter((checkOn: CheckOn): boolean => {
    return checkOn !== CheckOn.SessionCount && checkOn !== CheckOn.InstallCount;
  });

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
  // The window's sessions, and those a matching exception happened in.
  sessions: boolean;
  // The window's installs, and those a matching exception happened on.
  installs: boolean;
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
    sessions: false,
    installs: false,
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

      if (EXCEPTION_SESSION_MEASURES.includes(filter.checkOn)) {
        needs.sessions = true;
      }

      if (EXCEPTION_INSTALL_MEASURES.includes(filter.checkOn)) {
        needs.installs = true;
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

/*
 * The share of the window's sessions a matching exception happened in, in
 * percent to two decimals, or null without a session to take a share of:
 * an app whose spans name no session.id, or a window nothing was used in,
 * says nothing about its crash rate rather than 0%. Never above 100%: an
 * iOS crash arrives in the session after the one it ended, which may have
 * sent no span in the window.
 */
export function getSessionsWithExceptionsPercent(data: {
  sessionsWithExceptions: number;
  sessions: number;
}): number | null {
  return getShareWithExceptionsPercent({
    affected: data.sessionsWithExceptions,
    total: data.sessions,
  });
}

/*
 * The share of the window's installs a matching exception happened on, in
 * percent to two decimals, or null without an install to take a share of:
 * an app whose resources name no install, or a window nothing ran in, says
 * nothing about its crash rate rather than 0% (#9924). Never above 100%: a
 * crash's install may have sent no span in the window, as an iOS crash
 * reported on a later day does.
 */
export function getInstallsWithExceptionsPercent(data: {
  installsWithExceptions: number;
  installs: number;
}): number | null {
  return getShareWithExceptionsPercent({
    affected: data.installsWithExceptions,
    total: data.installs,
  });
}

function getShareWithExceptionsPercent(data: {
  affected: number;
  total: number;
}): number | null {
  const total: number = Math.max(0, data.total || 0);

  if (total <= 0) {
    return null;
  }

  const affected: number = Math.min(Math.max(0, data.affected || 0), total);

  return Math.round((affected / total) * 10000) / 100;
}
