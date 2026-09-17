import OneUptimeDate from "Common/Types/Date";

/*
 * Every timestamp the Traces explorer draws - the histogram's x-axis ticks,
 * the tooltip that follows the cursor, the clock on a span row.
 *
 * These used to be three copies of `date.toLocaleTimeString([], { hour12:
 * false })` spread across the components below. That hardcodes a 24-hour clock
 * over the reader's own preference, and passes no `timeZone`, so the digits
 * came from the browser process rather than the zone set in User Settings -
 * leaving the chart disagreeing with the span table underneath it. Going
 * through OneUptimeDate is what makes both follow the reader; sharing one
 * module is what keeps them from drifting apart again.
 */

/** A bare clock reading for an x-axis tick, where the window says which day it is. */
export function formatTickTime(time: string): string {
  const date: Date = OneUptimeDate.fromString(time);
  if (isNaN(date.getTime())) {
    return time;
  }
  return OneUptimeDate.getLocalTimeString(date, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });
}

/** The bucket a tooltip is pointing at, dated because it can be any day in the window. */
export function formatTooltipLabel(label: string | undefined): string {
  if (!label) {
    return "";
  }
  const date: Date = OneUptimeDate.fromString(label);
  if (isNaN(date.getTime())) {
    return label;
  }
  return OneUptimeDate.getDateAsLocalShortDateTimeString(date, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });
}

/** The wall clock a span started at, to the second, for a row in the trace list. */
export function formatAbsoluteTime(time: Date): string {
  return OneUptimeDate.getLocalTimeString(time, {
    includeSeconds: true,
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });
}
