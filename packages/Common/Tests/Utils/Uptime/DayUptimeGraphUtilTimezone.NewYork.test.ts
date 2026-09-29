/**
 * @timezone America/New_York
 */

import { describeDayUptimeGraphUtilInProcessTimezone } from "./DayUptimeGraphUtilTimezoneCases";

/*
 * A visitor WEST of UTC - where the grey bars on status.chainflip.io were
 * worst. The status page's readings are UTC days, and a UTC day starts at
 * 20:00 (EDT) the previous local evening. Drawn on local days, every bar was
 * painted from the NEXT UTC day's reading, and from 00:00 to 20:00 local
 * today's bar had no reading at all and fell back to the capped rows.
 *
 * The regression cases (in DayUptimeGraphUtilTimezoneCases) fail on the
 * pre-fix strip: at 22:00 on Sep 22 local, the local "Sep 22" bar held the
 * Sep 23 UTC reading, so no bar was labelled with the day it showed.
 */
describeDayUptimeGraphUtilInProcessTimezone({
  processTimezone: "America/New_York",
  timezoneOffsets: [
    { instant: "2026-01-15T12:00:00.000Z", getTimezoneOffset: 300 },
    { instant: "2026-07-15T12:00:00.000Z", getTimezoneOffset: 240 },
  ],
  localDateDiffers: [
    {
      instant: "2026-09-23T02:00:00.000Z",
      localDayLabel: "Sep 22, 2026",
      utcDayLabel: "Sep 23, 2026",
    },
    // The evening of the spring-forward: the window crosses Mar 8.
    {
      instant: "2026-03-09T03:00:00.000Z",
      localDayLabel: "Mar 08, 2026",
      utcDayLabel: "Mar 09, 2026",
    },
    // The evening of the fall-back: the window crosses Nov 1.
    {
      instant: "2026-11-02T03:30:00.000Z",
      localDayLabel: "Nov 01, 2026",
      utcDayLabel: "Nov 02, 2026",
    },
  ],
  utcBarLabels: [
    // EDT (-4) and EST (-5) both differ from UTC, so both are marked.
    { date: "2026-09-23T00:00:00.000Z", expectedLabel: "Sep 23, 2026 (UTC)" },
    { date: "2026-01-15T00:00:00.000Z", expectedLabel: "Jan 15, 2026 (UTC)" },
  ],
});
