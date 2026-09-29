import XAxisPrecision from "Common/UI/Components/Charts/Types/XAxis/XAxisPrecision";

/*
 * The steps of the chart library's time axis that have a fixed width, with
 * that width, finest first.
 *
 * XAxisUtil walks a time axis one step at a time and files each point under
 * the step its time floors to. A page whose points are server-side buckets
 * has to put them on a step that matches the bucket size, or several buckets
 * share a slot (and get averaged) while others land on no slot at all (and
 * get dropped). These are the widths such a page picks from.
 *
 * A day and coarser are left out on purpose: those steps follow the calendar
 * in the viewer's timezone (a month is 28 to 31 days), so no bucket size
 * maps onto them. The hour-based steps are walked on the viewer's wall
 * clock too, so the one step a daylight-saving change falls in is an hour
 * longer or shorter than listed; every other step is exactly this wide.
 */

export interface ChartGridStep {
  precision: XAxisPrecision;
  seconds: number;
}

export const FIXED_WIDTH_CHART_GRID_STEPS: ReadonlyArray<ChartGridStep> = [
  { precision: XAxisPrecision.EVERY_SECOND, seconds: 1 },
  { precision: XAxisPrecision.EVERY_FIVE_SECONDS, seconds: 5 },
  { precision: XAxisPrecision.EVERY_TEN_SECONDS, seconds: 10 },
  { precision: XAxisPrecision.EVERY_THIRTY_SECONDS, seconds: 30 },
  { precision: XAxisPrecision.EVERY_MINUTE, seconds: 60 },
  { precision: XAxisPrecision.EVERY_FIVE_MINUTES, seconds: 5 * 60 },
  { precision: XAxisPrecision.EVERY_TEN_MINUTES, seconds: 10 * 60 },
  { precision: XAxisPrecision.EVERY_FIFTEEN_MINUTES, seconds: 15 * 60 },
  { precision: XAxisPrecision.EVERY_THIRTY_MINUTES, seconds: 30 * 60 },
  { precision: XAxisPrecision.EVERY_HOUR, seconds: 60 * 60 },
  { precision: XAxisPrecision.EVERY_TWO_HOURS, seconds: 2 * 60 * 60 },
  { precision: XAxisPrecision.EVERY_THREE_HOURS, seconds: 3 * 60 * 60 },
  { precision: XAxisPrecision.EVERY_SIX_HOURS, seconds: 6 * 60 * 60 },
  { precision: XAxisPrecision.EVERY_TWELVE_HOURS, seconds: 12 * 60 * 60 },
];

/**
 * How many seconds one step of this precision spans, or undefined for a
 * step of a day or coarser (see FIXED_WIDTH_CHART_GRID_STEPS).
 */
export const getChartGridStepSeconds: (
  precision: XAxisPrecision,
) => number | undefined = (precision: XAxisPrecision): number | undefined => {
  const step: ChartGridStep | undefined = FIXED_WIDTH_CHART_GRID_STEPS.find(
    (candidate: ChartGridStep): boolean => {
      return candidate.precision === precision;
    },
  );
  return step ? step.seconds : undefined;
};

/**
 * The coarsest step no wider than `seconds`, or undefined when even one
 * second is too wide.
 *
 * On that step, points `seconds` apart always floor to different slots, so
 * no two buckets are averaged into one; any finer step would only add empty
 * slots between them. Buckets wider than the widest step (twelve hours) get
 * the widest step.
 */
export const getCoarsestChartGridStepWithin: (
  seconds: number,
) => XAxisPrecision | undefined = (
  seconds: number,
): XAxisPrecision | undefined => {
  let coarsest: XAxisPrecision | undefined = undefined;
  for (const step of FIXED_WIDTH_CHART_GRID_STEPS) {
    if (step.seconds > seconds) {
      break;
    }
    coarsest = step.precision;
  }
  return coarsest;
};
