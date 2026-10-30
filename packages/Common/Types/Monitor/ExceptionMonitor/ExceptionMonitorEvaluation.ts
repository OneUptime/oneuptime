import { CheckOn, CriteriaFilter } from "../CriteriaFilter";
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

export interface ExceptionMonitorNeeds {
  newExceptions: boolean;
  regressedExceptions: boolean;
  baseline: boolean;
}

export function isExceptionMeasure(checkOn: unknown): checkOn is CheckOn {
  return EXCEPTION_MEASURES.includes(checkOn as CheckOn);
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
