/**
 * @timezone Pacific/Auckland
 */

import { describeDayUptimeGraphUtilInProcessTimezone } from "./DayUptimeGraphUtilTimezoneCases";

/*
 * As far east as the status page gets (UTC+12, +13 in the southern summer),
 * with DST changes in April and September. A UTC day starts at noon (NZST)
 * or 13:00 (NZDT) local, so on the pre-fix strip today's bar had no reading
 * for half of every local day.
 *
 * The regression cases (in DayUptimeGraphUtilTimezoneCases) fail on the
 * pre-fix strip, including on the mornings of both 2026 DST changes.
 */
describeDayUptimeGraphUtilInProcessTimezone({
  processTimezone: "Pacific/Auckland",
  timezoneOffsets: [
    { instant: "2026-01-15T12:00:00.000Z", getTimezoneOffset: -780 },
    { instant: "2026-07-15T12:00:00.000Z", getTimezoneOffset: -720 },
  ],
  localDateDiffers: [
    {
      instant: "2026-09-22T20:00:00.000Z",
      localDayLabel: "Sep 23, 2026",
      utcDayLabel: "Sep 22, 2026",
    },
    // 03:30 NZDT on the spring-forward date (a 23 hour local day).
    {
      instant: "2026-09-26T14:30:00.000Z",
      localDayLabel: "Sep 27, 2026",
      utcDayLabel: "Sep 26, 2026",
    },
    // The second 02:30 on the fall-back date (a 25 hour local day).
    {
      instant: "2026-04-04T14:30:00.000Z",
      localDayLabel: "Apr 05, 2026",
      utcDayLabel: "Apr 04, 2026",
    },
  ],
  utcBarLabels: [
    { date: "2026-09-23T00:00:00.000Z", expectedLabel: "Sep 23, 2026 (UTC)" },
    { date: "2026-01-15T00:00:00.000Z", expectedLabel: "Jan 15, 2026 (UTC)" },
  ],
});
