import {
  FeedClock,
  formatFeedDay,
  formatFeedFullTime,
  formatFeedTime,
  getFeedDayKey,
  getFeedLocale,
  getFeedRelativeDay,
  getFeedZoneName,
} from "../Feed/FeedTime";
import {
  StatusTimelineTick,
  StatusTimelineTickUnit,
} from "./StatusTimelineLayout";
import moment from "moment-timezone";

/*
 * How a status timeline writes times: in the reader's zone (User Settings,
 * else the browser's) and language, the way the feeds write them
 * (Feed/FeedTime) - day headings with the full date, times of day on the
 * entries, the zone's name where it is needed. The words come from the
 * browser's Intl data, on the Gregorian calendar and in the language's own
 * digits (Persian's ۰-۹), so a timeline lines up with every other date and
 * count on the page.
 *
 * React-free.
 */
export type StatusTimelineClock = FeedClock;

const formatterCache: Map<string, Intl.DateTimeFormat | null> = new Map<
  string,
  Intl.DateTimeFormat | null
>();

const getFormat: (data: {
  clock: StatusTimelineClock;
  shape: string;
  options: Intl.DateTimeFormatOptions;
}) => Intl.DateTimeFormat | null = (data: {
  clock: StatusTimelineClock;
  shape: string;
  options: Intl.DateTimeFormatOptions;
}): Intl.DateTimeFormat | null => {
  const locale: string = getFeedLocale(data.clock.language);
  const key: string = `${locale}|${data.clock.timezone}|${data.shape}|${data.clock.use12HourClock ? 12 : 24}`;

  if (formatterCache.has(key)) {
    return formatterCache.get(key) || null;
  }

  let format: Intl.DateTimeFormat | null = null;

  try {
    format = new Intl.DateTimeFormat(locale, {
      ...data.options,
      timeZone: data.clock.timezone,
    });
  } catch {
    format = null;
  }

  formatterCache.set(key, format);
  return format;
};

const inZone: (date: Date, clock: StatusTimelineClock) => moment.Moment = (
  date: Date,
  clock: StatusTimelineClock,
): moment.Moment => {
  return moment(date).tz(clock.timezone);
};

// "Oct 9", "9. Okt.", "10月9日".
export const formatStatusTimelineShortDate: (
  date: Date,
  clock: StatusTimelineClock,
) => string = (date: Date, clock: StatusTimelineClock): string => {
  const format: Intl.DateTimeFormat | null = getFormat({
    clock: clock,
    shape: "short-date",
    options: { month: "short", day: "numeric" },
  });

  return format ? format.format(date) : inZone(date, clock).format("MMM D");
};

// "Oct 2026".
export const formatStatusTimelineMonth: (
  date: Date,
  clock: StatusTimelineClock,
) => string = (date: Date, clock: StatusTimelineClock): string => {
  const format: Intl.DateTimeFormat | null = getFormat({
    clock: clock,
    shape: "month",
    options: { month: "short", year: "numeric" },
  });

  return format ? format.format(date) : inZone(date, clock).format("MMM YYYY");
};

// "2026".
export const formatStatusTimelineYear: (
  date: Date,
  clock: StatusTimelineClock,
) => string = (date: Date, clock: StatusTimelineClock): string => {
  const format: Intl.DateTimeFormat | null = getFormat({
    clock: clock,
    shape: "year",
    options: { year: "numeric" },
  });

  return format ? format.format(date) : inZone(date, clock).format("YYYY");
};

// "07:26" or "7:26 AM": the time of day, as the feeds write it.
export const formatStatusTimelineTime: (
  date: Date,
  clock: StatusTimelineClock,
) => string = (date: Date, clock: StatusTimelineClock): string => {
  return formatFeedTime(date, clock);
};

// "07:26:12" or "7:26:12 AM": the time of day to the second.
export const formatStatusTimelineTimeWithSeconds: (
  date: Date,
  clock: StatusTimelineClock,
) => string = (date: Date, clock: StatusTimelineClock): string => {
  const format: Intl.DateTimeFormat | null = getFormat({
    clock: clock,
    shape: "time-seconds",
    options: {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: clock.use12HourClock,
    },
  });

  return format
    ? format.format(date)
    : inZone(date, clock).format(
        clock.use12HourClock ? "h:mm:ss A" : "HH:mm:ss",
      );
};

// "Oct 9, 07:26": a time on a day the reader cannot tell from around it.
export const formatStatusTimelineShortDateTime: (
  date: Date,
  clock: StatusTimelineClock,
) => string = (date: Date, clock: StatusTimelineClock): string => {
  const format: Intl.DateTimeFormat | null = getFormat({
    clock: clock,
    shape: "short-date-time",
    options: {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: clock.use12HourClock,
    },
  });

  return format
    ? format.format(date)
    : inZone(date, clock).format(
        clock.use12HourClock ? "MMM D, h:mm A" : "MMM D, HH:mm",
      );
};

// "Oct 9, 07:26:12": the same, to the second.
export const formatStatusTimelineShortDateTimeWithSeconds: (
  date: Date,
  clock: StatusTimelineClock,
) => string = (date: Date, clock: StatusTimelineClock): string => {
  const format: Intl.DateTimeFormat | null = getFormat({
    clock: clock,
    shape: "short-date-time-seconds",
    options: {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: clock.use12HourClock,
    },
  });

  return format
    ? format.format(date)
    : inZone(date, clock).format(
        clock.use12HourClock ? "MMM D, h:mm:ss A" : "MMM D, HH:mm:ss",
      );
};

/*
 * "Friday, October 9, 2026, 7:26:12 AM BST": everything about an instant,
 * for a tooltip or a screen reader.
 */
export const formatStatusTimelineFullTime: (
  date: Date,
  clock: StatusTimelineClock,
) => string = (date: Date, clock: StatusTimelineClock): string => {
  return formatFeedFullTime(date, clock);
};

// The zone's name at that instant: "BST", "GMT+8".
export const getStatusTimelineZoneName: (
  date: Date,
  clock: StatusTimelineClock,
) => string = (date: Date, clock: StatusTimelineClock): string => {
  return getFeedZoneName(date, clock.timezone);
};

// Whether two instants are on one calendar day of the reader's zone.
export const isSameStatusTimelineDay: (
  a: Date,
  b: Date,
  clock: StatusTimelineClock,
) => boolean = (a: Date, b: Date, clock: StatusTimelineClock): boolean => {
  return getFeedDayKey(a, clock.timezone) === getFeedDayKey(b, clock.timezone);
};

/*
 * When an entry ended, written as briefly as it can be read: the time of
 * day when it ended on the day it began, else the day as well.
 */
export const formatStatusTimelineEnd: (data: {
  startsAt: Date;
  endsAt: Date;
  clock: StatusTimelineClock;
}) => string = (data: {
  startsAt: Date;
  endsAt: Date;
  clock: StatusTimelineClock;
}): string => {
  if (isSameStatusTimelineDay(data.startsAt, data.endsAt, data.clock)) {
    return formatStatusTimelineTime(data.endsAt, data.clock);
  }

  return formatStatusTimelineShortDateTime(data.endsAt, data.clock);
};

/*
 * When an entry began and ended, for the list, under the heading of the day
 * it began: "07:26 – 07:27", "17:11 – Oct 4, 05:18". When both ends fall in
 * one minute they read to the second ("07:26:12 – 07:26:50"), never
 * "07:26 – 07:26".
 */
export const formatStatusTimelineRange: (data: {
  startsAt: Date;
  endsAt: Date;
  clock: StatusTimelineClock;
}) => { start: string; end: string } = (data: {
  startsAt: Date;
  endsAt: Date;
  clock: StatusTimelineClock;
}): { start: string; end: string } => {
  const start: string = formatStatusTimelineTime(data.startsAt, data.clock);
  const end: string = formatStatusTimelineEnd(data);

  if (start === end) {
    return {
      start: formatStatusTimelineTimeWithSeconds(data.startsAt, data.clock),
      end: formatStatusTimelineTimeWithSeconds(data.endsAt, data.clock),
    };
  }

  return { start: start, end: end };
};

/*
 * When an entry began and ended, read on its own - for a screen reader on
 * the band, where no day heading says which day it was: "Oct 9, 07:26 -
 * 07:27", "Sep 15, 17:11 - Oct 4, 05:18". When both ends fall in one minute
 * they read to the second ("Oct 9, 07:26:01 - 07:26:39"), never "07:26 -
 * 07:26".
 */
export const formatStatusTimelineDateRange: (data: {
  startsAt: Date;
  endsAt: Date;
  clock: StatusTimelineClock;
}) => { start: string; end: string } = (data: {
  startsAt: Date;
  endsAt: Date;
  clock: StatusTimelineClock;
}): { start: string; end: string } => {
  const end: string = formatStatusTimelineEnd(data);

  if (formatStatusTimelineTime(data.startsAt, data.clock) === end) {
    return {
      start: formatStatusTimelineShortDateTimeWithSeconds(
        data.startsAt,
        data.clock,
      ),
      end: formatStatusTimelineTimeWithSeconds(data.endsAt, data.clock),
    };
  }

  return {
    start: formatStatusTimelineShortDateTime(data.startsAt, data.clock),
    end: end,
  };
};

// A tick's label: the hour, or the day, the month or the year it marks.
export const formatStatusTimelineTickLabel: (
  tick: StatusTimelineTick,
  clock: StatusTimelineClock,
) => string = (
  tick: StatusTimelineTick,
  clock: StatusTimelineClock,
): string => {
  switch (tick.unit) {
    case StatusTimelineTickUnit.Minute:
    case StatusTimelineTickUnit.Hour:
      return tick.isDayStart
        ? formatStatusTimelineShortDate(tick.at, clock)
        : formatStatusTimelineTime(tick.at, clock);
    case StatusTimelineTickUnit.Day:
    case StatusTimelineTickUnit.Week:
      return formatStatusTimelineShortDate(tick.at, clock);
    case StatusTimelineTickUnit.Month:
      return formatStatusTimelineMonth(tick.at, clock);
    case StatusTimelineTickUnit.Year:
      return formatStatusTimelineYear(tick.at, clock);
  }

  return formatStatusTimelineShortDate(tick.at, clock);
};

/*
 * The window as a range, for a screen reader and the band's name: "Sep 14,
 * 09:23 to Oct 14, 09:23". The words around the two ends are the caller's
 * sentence.
 */
export const formatStatusTimelineWindowEnds: (data: {
  start: Date;
  end: Date;
  clock: StatusTimelineClock;
}) => { start: string; end: string } = (data: {
  start: Date;
  end: Date;
  clock: StatusTimelineClock;
}): { start: string; end: string } => {
  return {
    start: formatStatusTimelineShortDateTime(data.start, data.clock),
    end: formatStatusTimelineShortDateTime(data.end, data.clock),
  };
};

export interface StatusTimelineDayHeading {
  // "2026-10-09", in the reader's zone.
  dayKey: string;
  // "Friday, October 9, 2026".
  label: string;
  // "Today" or "Yesterday", else undefined.
  relativeLabel?: string | undefined;
  // The zone the day's times are in: "BST".
  zoneName: string;
}

// A day of the list, headed as the feeds head their days.
export const getStatusTimelineDayHeading: (
  date: Date,
  clock: StatusTimelineClock,
) => StatusTimelineDayHeading = (
  date: Date,
  clock: StatusTimelineClock,
): StatusTimelineDayHeading => {
  return {
    dayKey: getFeedDayKey(date, clock.timezone),
    label: formatFeedDay(date, clock),
    relativeLabel: getFeedRelativeDay(date, clock),
    zoneName: getFeedZoneName(date, clock.timezone),
  };
};
