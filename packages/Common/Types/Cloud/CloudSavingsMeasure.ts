import { addUtcDays, startOfUtcDay, startOfUtcMonth } from "./CloudCost";
import { CLOUD_DAYS_IN_AVERAGE_MONTH } from "./CloudRightSizing";
import {
  CLOUD_SAVINGS_BASELINE_DAYS,
  CLOUD_SAVINGS_MEASURE_DAYS,
  CLOUD_SAVINGS_MEASURE_GIVE_UP_DAYS,
  CLOUD_SAVINGS_REALISED_MIN_SHARE,
  CloudSavingsMeasurement,
} from "./CloudSavingsAction";

/*
 * PROVED BY THE BILL (#11010): whether a change saved what was promised,
 * from what its cloud billed the resource before and after it.
 *
 *   - Before: the resource's cost a day over the CLOUD_SAVINGS_BASELINE_DAYS
 *     full UTC days before the day of the change.
 *   - After: its cost a day over the full days after the day of the
 *     change, up to two days ago - a cloud's bill for the last day or two
 *     still moves - once there are CLOUD_SAVINGS_MEASURE_DAYS of them. A
 *     day the account's costs were read but the resource has none cost it
 *     nothing: a deleted disk is billed nothing.
 *   - Realised when the cost a day fell by at least a quarter of what was
 *     promised, the fall made a month; not seen when it did not; and not
 *     measurable when the resource was never billed by name (its cloud
 *     does not, or AWS's costs per resource are off) or the account's
 *     costs stopped being read.
 *
 * Saved this month adds up, for each change the bill shows, its realised
 * saving a day over the days of this month it stood: realised, never
 * estimated. Pure, so the server and the Dashboard's tests read it alike.
 */

// A cloud's bill for the last days still moves: the after-window ends this long ago.
export const CLOUD_SAVINGS_SETTLED_AFTER_DAYS: number = 2;

export interface CloudSavingsMeasureWindows {
  beforeStart: Date;
  beforeEnd: Date;
  afterStart: Date;
  // Exclusive.
  afterEnd: Date;
  // Full days in the after-window, 0 while there are none yet.
  afterDays: number;
}

export function getCloudSavingsMeasureWindows(data: {
  appliedAt: Date;
  now: Date;
  // Undone: the after-window ends the day it was undone.
  undoneAt?: Date | undefined | null;
}): CloudSavingsMeasureWindows {
  const changeDay: Date = startOfUtcDay(data.appliedAt);
  const afterStart: Date = addUtcDays(changeDay, 1);
  const settled: Date = addUtcDays(
    startOfUtcDay(data.now),
    -CLOUD_SAVINGS_SETTLED_AFTER_DAYS + 1,
  );
  const undone: Date | null = data.undoneAt
    ? startOfUtcDay(new Date(data.undoneAt))
    : null;
  const afterEnd: Date =
    undone && undone.getTime() < settled.getTime() ? undone : settled;
  const afterDays: number = Math.max(
    0,
    Math.round((afterEnd.getTime() - afterStart.getTime()) / 86400000),
  );

  return {
    beforeStart: addUtcDays(changeDay, -CLOUD_SAVINGS_BASELINE_DAYS),
    beforeEnd: changeDay,
    afterStart,
    afterEnd: afterDays > 0 ? afterEnd : afterStart,
    afterDays,
  };
}

export interface CloudSavingsCostRead {
  // What the resource was billed before the change, and on how many days.
  beforeTotal: number;
  beforeDays: number;
  // What it was billed after, in the after-window.
  afterTotal: number;
  // Whether the account's costs were read up to the end of the after-window.
  isAccountReadThrough: boolean;
}

export interface CloudSavingsJudgement {
  measurement: CloudSavingsMeasurement;
  costBeforeDaily?: number | undefined;
  costAfterDaily?: number | undefined;
  realisedMonthlySavings?: number | undefined;
}

function round(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/*
 * What the bill says of a change, from its windows and the costs read in
 * them, and what was promised a month.
 */
export function judgeCloudSavings(data: {
  windows: CloudSavingsMeasureWindows;
  costs: CloudSavingsCostRead;
  promisedMonthly: number;
  appliedAt: Date;
  now: Date;
}): CloudSavingsJudgement {
  const ageInDays: number =
    (data.now.getTime() - data.appliedAt.getTime()) / 86400000;

  // Never billed by name before the change: nothing to compare with.
  if (data.costs.beforeDays === 0 || data.costs.beforeTotal <= 0) {
    return { measurement: CloudSavingsMeasurement.CannotMeasure };
  }

  const costBeforeDaily: number =
    data.costs.beforeTotal / data.costs.beforeDays;

  if (
    data.windows.afterDays < CLOUD_SAVINGS_MEASURE_DAYS ||
    !data.costs.isAccountReadThrough
  ) {
    return ageInDays > CLOUD_SAVINGS_MEASURE_GIVE_UP_DAYS
      ? {
          measurement: CloudSavingsMeasurement.CannotMeasure,
          costBeforeDaily: round(costBeforeDaily),
        }
      : {
          measurement: CloudSavingsMeasurement.Measuring,
          costBeforeDaily: round(costBeforeDaily),
        };
  }

  const costAfterDaily: number =
    Math.max(0, data.costs.afterTotal) / data.windows.afterDays;
  const realisedMonthly: number = Math.max(
    0,
    (costBeforeDaily - costAfterDaily) * CLOUD_DAYS_IN_AVERAGE_MONTH,
  );
  const promised: number = Math.max(0, Number(data.promisedMonthly) || 0);
  const isSeen: boolean =
    realisedMonthly > 0 &&
    (promised === 0 ||
      realisedMonthly >= promised * CLOUD_SAVINGS_REALISED_MIN_SHARE);

  return {
    measurement: isSeen
      ? CloudSavingsMeasurement.Realised
      : CloudSavingsMeasurement.NotSeen,
    costBeforeDaily: round(costBeforeDaily),
    costAfterDaily: round(costAfterDaily),
    realisedMonthlySavings: round(realisedMonthly),
  };
}

/*
 * What a change the bill shows saved this month so far: its realised
 * saving a day over the days of this month after the day it was made, up
 * to today or the day it was undone.
 */
export function getCloudSavingsRealisedThisMonth(data: {
  realisedMonthlySavings: number;
  appliedAt: Date;
  undoneAt?: Date | undefined | null;
  now: Date;
}): number {
  const monthStart: Date = startOfUtcMonth(data.now);
  const from: Date = new Date(
    Math.max(
      addUtcDays(startOfUtcDay(data.appliedAt), 1).getTime(),
      monthStart.getTime(),
    ),
  );
  const to: Date = data.undoneAt
    ? new Date(
        Math.min(
          startOfUtcDay(new Date(data.undoneAt)).getTime(),
          startOfUtcDay(data.now).getTime(),
        ),
      )
    : startOfUtcDay(data.now);
  const days: number = Math.max(
    0,
    Math.round((to.getTime() - from.getTime()) / 86400000),
  );

  return round(
    (Math.max(0, data.realisedMonthlySavings) / CLOUD_DAYS_IN_AVERAGE_MONTH) *
      days,
  );
}

/*
 * The hours an off-hours stop counts this month: the part of it since the
 * 1st, ended or still standing.
 */
export function getCloudSavingsScheduledHoursThisMonth(data: {
  appliedAt: Date;
  endedAt?: Date | undefined | null;
  now: Date;
}): number {
  const monthStart: Date = startOfUtcMonth(data.now);
  const from: number = Math.max(
    new Date(data.appliedAt).getTime(),
    monthStart.getTime(),
  );
  const to: number = data.endedAt
    ? Math.min(new Date(data.endedAt).getTime(), data.now.getTime())
    : data.now.getTime();

  return Math.max(0, Math.round(((to - from) / 3600000) * 100) / 100);
}
