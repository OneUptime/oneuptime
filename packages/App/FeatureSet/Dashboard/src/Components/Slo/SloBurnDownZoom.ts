import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  getSloIdealBurnPoints,
  SloIdealBurnPoint,
} from "Common/Utils/Slo/SloProjection";

/*
 * The pure half of drag-to-zoom on the SLO overview's budget burn-down card
 * (issue #4105). The card's window is not a page range anyone picked: it is
 * the SLO's current compliance window, re-resolved on every evaluation, so
 * the card keeps a zoom of its own over it. React-free, so App's node suites
 * can run it for real.
 */

type ToEpochMsFunction = (value: Date) => number;

// NaN for anything that is not a date, whatever shape it arrived in.
const toEpochMs: ToEpochMsFunction = (value: Date): number => {
  try {
    return OneUptimeDate.fromString(value).getTime();
  } catch {
    return Number.NaN;
  }
};

export interface SloBurnDownZoomSelection {
  /** One edge of the window dragged out on the chart. */
  startTime: Date;
  /** The other edge; a right-to-left drag hands them over reversed. */
  endTime: Date;
  /** Start of the compliance window the chart is drawn over. */
  complianceWindowStart: Date;
  /** The current time: no history exists past it. */
  now: Date;
}

/**
 * The window a drag on the burn-down chart zooms the card to, or null when
 * the drag covers no time that can hold history.
 *
 * - A calendar month is drawn through to its reset, so part of the axis is
 *   still in the future. The zoom stops at "now": a window over the rest of
 *   the month would only ever be empty.
 * - The first bucket can start a little before the compliance window does;
 *   the zoom starts where the window does, like the axis it was dragged on.
 */
export const getSloBurnDownZoomRange: (
  selection: SloBurnDownZoomSelection,
) => RangeStartAndEndDateTime | null = (
  selection: SloBurnDownZoomSelection,
): RangeStartAndEndDateTime | null => {
  const firstMs: number = toEpochMs(selection.startTime);
  const secondMs: number = toEpochMs(selection.endTime);
  const windowStartMs: number = toEpochMs(selection.complianceWindowStart);
  const nowMs: number = toEpochMs(selection.now);

  if (
    !Number.isFinite(firstMs) ||
    !Number.isFinite(secondMs) ||
    !Number.isFinite(windowStartMs) ||
    !Number.isFinite(nowMs)
  ) {
    return null;
  }

  const startMs: number = Math.max(Math.min(firstMs, secondMs), windowStartMs);
  const endMs: number = Math.min(Math.max(firstMs, secondMs), nowMs);

  if (endMs <= startMs) {
    return null;
  }

  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(new Date(startMs), new Date(endMs)),
  };
};

export interface SloIdealBurnWindowInput {
  /** Start of the calendar month: the budget is full here. */
  budgetStartDate: Date;
  /** The month's reset: an even burn empties the budget exactly here. */
  budgetResetDate: Date;
  /** The part of the month the chart shows: the whole month, or a zoom. */
  windowStartDate: Date;
  windowEndDate: Date;
  /** The chart's bucket size, so the line fills every slot. */
  stepSeconds: number;
}

/**
 * The even-burn line of a calendar month, over just the part of the month
 * the chart shows.
 *
 * Zoomed into a few hours of the month, the line must still be the MONTH's
 * line - at 70% ten days in, not starting again from 100% at the left edge
 * of the zoom - so each point's value is read off the whole month, while
 * the points themselves are laid out at the zoomed chart's own step (a
 * month of five-minute points would be thinned out to one every few hours).
 * Unzoomed, the result is exactly getSloIdealBurnPoints over the month.
 */
export const getSloIdealBurnPointsInWindow: (
  input: SloIdealBurnWindowInput,
) => Array<SloIdealBurnPoint> = (
  input: SloIdealBurnWindowInput,
): Array<SloIdealBurnPoint> => {
  const budgetStartMs: number = toEpochMs(input.budgetStartDate);
  const budgetResetMs: number = toEpochMs(input.budgetResetDate);
  const budgetSpanMs: number = budgetResetMs - budgetStartMs;

  if (!Number.isFinite(budgetSpanMs) || budgetSpanMs <= 0) {
    return [];
  }

  // The line exists only inside the month.
  const startMs: number = Math.max(
    toEpochMs(input.windowStartDate),
    budgetStartMs,
  );
  const endMs: number = Math.min(toEpochMs(input.windowEndDate), budgetResetMs);

  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  ) {
    return [];
  }

  return getSloIdealBurnPoints({
    startDate: new Date(startMs),
    endDate: new Date(endMs),
    stepSeconds: input.stepSeconds,
  }).map((point: SloIdealBurnPoint): SloIdealBurnPoint => {
    return {
      x: point.x,
      y: 100 * (1 - (point.x.getTime() - budgetStartMs) / budgetSpanMs),
    };
  });
};
