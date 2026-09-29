import OneUptimeDate from "Common/Types/Date";

/*
 * The forward window that every coverage statement on the schedule page reasons
 * over: the gap banner above the rotation layers, the Final schedule summary at
 * the bottom, and the user-override fetch that feeds it.
 *
 * Defined once, here, because those three MUST agree — a banner and a gap list
 * computed over different spans would contradict each other on the same screen.
 *
 * Three months is long enough for a monthly rotation to complete a full cycle,
 * so a gap caused by hand-off timing surfaces instead of hiding just past the
 * window's edge.
 */
export const COVERAGE_WINDOW_MONTHS: number = 3;

/*
 * Calendar months rather than a fixed day count, so the window a user is told
 * about ("the next 3 months") is the window actually evaluated, regardless of
 * which months it spans.
 */
export function getCoverageWindowEnd(now: Date): Date {
  return OneUptimeDate.addRemoveMonths(now, COVERAGE_WINDOW_MONTHS);
}
