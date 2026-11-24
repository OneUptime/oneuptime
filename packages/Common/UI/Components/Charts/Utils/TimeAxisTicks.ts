import { XAxis } from "../Types/XAxis/XAxis";
import XAxisPrecision from "../Types/XAxis/XAxisPrecision";
import XAxisUtil from "./XAxis";

/*
 * WHICH OF A TIME AXIS'S LABELS A CHART DRAWS (issue #7126).
 *
 * A time axis has a slot for every bucket, and recharts draws only as many
 * of their labels as fit. It used to space them evenly from the first slot
 * ("equidistantPreserveStart") on every axis, so the last label fell
 * wherever the step landed: 30 days labelled every 4th day end on day 29,
 * and today - the right-hand end of the chart - had no date under it. The
 * reader had to count to know where the window ends.
 *
 * An axis of days, weeks, months or years labels both its ends
 * ("preserveStartEnd"): the first and the last slot always, and the slots
 * between at a step that keeps them apart, the one before the last left out
 * when it would run into it. An axis of clock times keeps the even spacing
 * it had: its last slot is the bucket still filling up, at whatever minute
 * the window ends, and a label there ("10:57" after "10:50") reads as noise.
 */
export type TimeAxisTickInterval =
  | "preserveStartEnd"
  | "equidistantPreserveStart";

// A slot of a day or longer: an axis whose labels name days.
const CALENDAR_PRECISIONS: ReadonlyArray<XAxisPrecision> = [
  XAxisPrecision.EVERY_DAY,
  XAxisPrecision.EVERY_TWO_DAYS,
  XAxisPrecision.EVERY_WEEK,
  XAxisPrecision.EVERY_TWO_WEEKS,
  XAxisPrecision.EVERY_MONTH,
  XAxisPrecision.EVERY_TWO_MONTHS,
  XAxisPrecision.EVERY_THREE_MONTHS,
  XAxisPrecision.EVERY_SIX_MONTHS,
  XAxisPrecision.EVERY_YEAR,
];

export function isCalendarPrecision(precision: XAxisPrecision): boolean {
  return CALENDAR_PRECISIONS.includes(precision);
}

/**
 * The tick interval a chart hands recharts' time axis for `xAxis`: both
 * ends labelled for an axis of days or longer, the even spacing from the
 * first slot for every other axis (see the module comment).
 */
export function getTimeAxisTickInterval(xAxis: XAxis): TimeAxisTickInterval {
  let precision: XAxisPrecision;

  try {
    precision = XAxisUtil.getPrecision({
      xAxisMin: xAxis.options.min,
      xAxisMax: xAxis.options.max,
      precision: xAxis.options.precision,
    });
  } catch {
    // An axis with no dates to step: it keeps the spacing it always had.
    return "equidistantPreserveStart";
  }

  return isCalendarPrecision(precision)
    ? "preserveStartEnd"
    : "equidistantPreserveStart";
}
