import { AIChatWidgetData } from "./AIChatTypes";
import OneUptimeDate from "../Date";
import Timezone from "../Timezone";
import TimezoneAlias from "../TimezoneAlias";

/*
 * AN ASK AI CHART'S DAYS ARE THE DAYS IT WAS CUT IN (issue #8206).
 *
 * A chat chart is a snapshot: its points are stored with the answer and
 * drawn later, on the calendar of whoever reads it. Its day buckets were
 * cut in the asker's zone (#7922), or in UTC for a run with no reader -
 * Slack, Microsoft Teams, an autonomous investigation's evidence. Read in
 * another zone, each bucket's start is an instant of another day there: a
 * day a responder asked for in New York starts at 05:00 UTC, which is
 * 21:00 the evening before in Los Angeles, so every total was drawn under
 * the day before; in New York, each UTC day of an investigation's chart
 * was drawn under the day before too.
 *
 * So a chart records the zone its buckets were cut in
 * (AIChatWidgetData.bucketTimezone), and each bucket is drawn at the start
 * of the same calendar day on the reader's calendar - the day it counted -
 * with a line that says whose days they are. Where the zones agree, or
 * agree on every bucket (UTC read in London in winter), nothing moves and
 * nothing is said. A chart saved before, with no zone, is drawn as it was.
 */

/*
 * The zone a chart's calendar buckets were cut in, in its current name; or
 * undefined for a chart of finer buckets, one saved before the zone was
 * kept, or one whose zone is not a listed one.
 */
export function getChartBucketTimezone(
  data: AIChatWidgetData | undefined,
): Timezone | undefined {
  const value: unknown = data?.bucketTimezone;

  if (!TimezoneAlias.isListedName(value)) {
    return undefined;
  }

  return TimezoneAlias.getCanonicalTimezone(value);
}

/*
 * Where a bucket that starts at `date` is drawn: at the start of the same
 * calendar day - the same wall clock - on the reader's calendar
 * (OneUptimeDate.getCurrentTimezone()), so it sits under the day it
 * counted. Without a zone, where it is.
 */
export function toReaderCalendarDate(
  date: Date,
  bucketTimezone: Timezone | undefined,
): Date {
  if (!bucketTimezone) {
    return date;
  }

  return OneUptimeDate.getLocalDateFromWallClockInTimezone(
    date,
    bucketTimezone,
  );
}

/*
 * Whether drawing these buckets on the reader's calendar moves any of
 * them: the chart is on another zone's days, and says so.
 */
export function isDrawnOnAnotherCalendar(
  dates: ReadonlyArray<Date>,
  bucketTimezone: Timezone | undefined,
): boolean {
  if (!bucketTimezone) {
    return false;
  }

  return dates.some((date: Date): boolean => {
    return (
      toReaderCalendarDate(date, bucketTimezone).getTime() !== date.getTime()
    );
  });
}
