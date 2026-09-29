/**
 * @timezone Asia/Kolkata
 */

import { describeDayUptimeGraphUtilInProcessTimezone } from "./DayUptimeGraphUtilTimezoneCases";

/*
 * A half-hour zone (UTC+05:30). Local days start at 18:30Z, so nothing that
 * assumes whole-hour offsets can line a local day up with a UTC one. A UTC
 * day starts at 05:30 local, and on the pre-fix strip today's bar had no
 * reading from local midnight until then.
 *
 * The regression cases (in DayUptimeGraphUtilTimezoneCases) fail on the
 * pre-fix strip - including at 18:30Z exactly, the first instant of the
 * local day.
 */
describeDayUptimeGraphUtilInProcessTimezone({
  processTimezone: "Asia/Kolkata",
  timezoneOffsets: [
    { instant: "2026-01-15T12:00:00.000Z", getTimezoneOffset: -330 },
    { instant: "2026-07-15T12:00:00.000Z", getTimezoneOffset: -330 },
  ],
  localDateDiffers: [
    {
      instant: "2026-09-22T20:00:00.000Z",
      localDayLabel: "Sep 23, 2026",
      utcDayLabel: "Sep 22, 2026",
    },
    // Local midnight exactly.
    {
      instant: "2026-09-22T18:30:00.000Z",
      localDayLabel: "Sep 23, 2026",
      utcDayLabel: "Sep 22, 2026",
    },
  ],
  utcBarLabels: [
    { date: "2026-09-23T00:00:00.000Z", expectedLabel: "Sep 23, 2026 (UTC)" },
    { date: "2026-01-15T00:00:00.000Z", expectedLabel: "Jan 15, 2026 (UTC)" },
  ],
});
