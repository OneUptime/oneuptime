/** @timezone America/New_York */

import { describeClockChanges } from "./RangeStartAndEndDateTimeClockChangeCases";

/*
 * The time ranges on the New York wall clock (see
 * RangeStartAndEndDateTimeClockChangeCases), where the clocks change at 2am
 * local on the first Sunday of November and the second Sunday of March.
 */

describeClockChanges("America/New_York", [
  // Back an hour at 06:00 UTC.
  { now: "2026-11-01T12:00:00.000Z", calendarDayHours: 25 },
  // Forward an hour at 07:00 UTC.
  { now: "2027-03-14T12:00:00.000Z", calendarDayHours: 23 },
]);
