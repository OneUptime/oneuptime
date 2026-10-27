/** @timezone America/New_York */

import { describeClockChanges } from "./RollingTimeUtilClockChangeCases";

/*
 * The rolling times on the New York wall clock (see
 * RollingTimeUtilClockChangeCases), where the clocks change at 2am local on
 * the first Sunday of November and the second Sunday of March - and went
 * back on 1969-10-26, inside the windows getWindowInMs steps back from
 * 1970-01-01.
 */

describeClockChanges("America/New_York", [
  // Back an hour at 06:00 UTC.
  { now: "2026-11-01T12:00:00.000Z", days: 1, calendarHours: 25 },
  // Forward an hour at 07:00 UTC.
  { now: "2027-03-14T12:00:00.000Z", days: 1, calendarHours: 23 },
  // Where getWindowInMs measures from.
  { now: "1970-01-01T00:00:00.000Z", days: 180, calendarHours: 180 * 24 + 1 },
]);
