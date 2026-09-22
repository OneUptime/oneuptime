/**
 * @timezone Asia/Tokyo
 */

import { describeDayUptimeGraphUtilInProcessTimezone } from "./DayUptimeGraphUtilTimezoneCases";

/*
 * A visitor EAST of UTC. A UTC day starts at 09:00 local, so from midnight
 * to 09:00 every local day, today's bar had no reading on the pre-fix strip
 * (the newest UTC bucket had started "yesterday" locally) and fell back to
 * the capped rows - the grey bar at the end of the strip.
 *
 * The regression cases (in DayUptimeGraphUtilTimezoneCases) fail on the
 * pre-fix strip: at 05:00 on Sep 23 local, the local "Sep 23" bar had no
 * reading at all.
 */
describeDayUptimeGraphUtilInProcessTimezone({
  processTimezone: "Asia/Tokyo",
  timezoneOffsets: [
    { instant: "2026-01-15T12:00:00.000Z", getTimezoneOffset: -540 },
    { instant: "2026-07-15T12:00:00.000Z", getTimezoneOffset: -540 },
  ],
  localDateDiffers: [
    {
      instant: "2026-09-22T20:00:00.000Z",
      localDayLabel: "Sep 23, 2026",
      utcDayLabel: "Sep 22, 2026",
    },
    {
      instant: "2026-03-28T23:30:00.000Z",
      localDayLabel: "Mar 29, 2026",
      utcDayLabel: "Mar 28, 2026",
    },
  ],
  utcBarLabels: [
    { date: "2026-09-23T00:00:00.000Z", expectedLabel: "Sep 23, 2026 (UTC)" },
    { date: "2026-01-15T00:00:00.000Z", expectedLabel: "Jan 15, 2026 (UTC)" },
  ],
});
