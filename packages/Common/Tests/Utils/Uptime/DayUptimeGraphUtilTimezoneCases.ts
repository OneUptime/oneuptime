import DayUptimeGraphUtil, {
  UptimeGraphDay,
} from "../../../Utils/Uptime/DayUptimeGraphUtil";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Shared cases for DayUptimeGraphUtil's day maths (getDays / formatDayLabel),
 * run once per PROCESS timezone by DayUptimeGraphUtilTimezone.<Zone>.test.ts
 * - each of which pins its zone with an @timezone docblock - and in part by
 * DayUptimeGraphUtil.test.ts, which runs in whatever zone the machine has.
 *
 * This file is not a test itself: jest's testRegex only picks up *.test.ts.
 *
 * The bug these guard (root cause 3 of the status.chainflip.io grey bars):
 * the status page's per-day readings are cut in UTC days, one cached payload
 * shared by every visitor, but the strip drew the VISITOR's local days and
 * paired each bar with whichever reading's start fell inside it. West of UTC
 * every bar showed the next UTC day's reading and, for most of the day,
 * today's bar had no reading at all; east of UTC today's bar had no reading
 * for the first hours of each local day. A bar with no reading fell back to
 * the capped timeline rows and could come out grey.
 *
 * The oracles below (UTC bucket starts, calendar-date keys) are computed with
 * plain epoch arithmetic and Intl rather than moment, so they do not share
 * code with the implementation they check.
 */

export const MS_IN_HOUR: number = 60 * 60 * 1000;
export const MS_IN_DAY: number = 24 * MS_IN_HOUR;

const MONTH_ABBREVIATIONS: Array<string> = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/*
 * Window ends the strip is checked at. Chosen so that, between them, every
 * process zone under test sees instants where its local date is AHEAD of the
 * UTC date, BEHIND it, equal to it, exactly on a UTC midnight, on the last
 * millisecond of a UTC day, and on either side of its own DST changes.
 */
export const PINNED_WINDOW_ENDS: Array<string> = [
  // New York: 22:00 on Sep 22 locally, Sep 23 in UTC.
  "2026-09-23T02:00:00.000Z",
  // Tokyo 05:00 / Kolkata 01:30 / Auckland 08:00 on Sep 23; Sep 22 in UTC.
  "2026-09-22T20:00:00.000Z",
  // London 00:30 BST on Sep 23; Sep 22 in UTC.
  "2026-09-22T23:30:00.000Z",
  // Midday in UTC: every zone under test agrees it is Sep 22.
  "2026-09-22T12:00:00.000Z",
  // Exactly a UTC midnight: the last server bucket is zero seconds long.
  "2026-09-23T00:00:00.000Z",
  // The last millisecond of a UTC day.
  "2026-09-22T23:59:59.999Z",
  // New York, around its spring-forward (07:00Z on Mar 8).
  "2026-03-08T06:30:00.000Z",
  "2026-03-09T03:00:00.000Z",
  // London, around its spring-forward (01:00Z on Mar 29).
  "2026-03-29T00:30:00.000Z",
  "2026-03-30T00:30:00.000Z",
  // London, the night of its fall-back (01:00Z on Oct 25).
  "2026-10-24T23:30:00.000Z",
  // New York, around its fall-back (06:00Z on Nov 1).
  "2026-11-01T05:30:00.000Z",
  "2026-11-02T03:30:00.000Z",
  // Auckland, around its fall-back (14:00Z on Apr 4) - 02:30 happens twice.
  "2026-04-04T13:30:00.000Z",
  "2026-04-04T14:30:00.000Z",
  // Auckland, just after its spring-forward (14:00Z on Sep 26).
  "2026-09-26T14:30:00.000Z",
];

/* One day, the status page's usual 60, and the 90 it is capped at. */
export const WINDOW_LENGTHS_IN_DAYS: Array<number> = [1, 60, 90];

export interface PinnedWindow {
  name: string;
  startDate: Date;
  endDate: Date;
}

/*
 * Every pinned end x every window length, with the start computed the way
 * the status page computes it (Overview.tsx: getSomeDaysAgoFromDate in the
 * process zone - so across a DST change the window is not a whole number of
 * 24-hour days, and the first bucket is clipped at an odd hour).
 */
export function getPinnedWindows(): Array<PinnedWindow> {
  const windows: Array<PinnedWindow> = [];

  for (const end of PINNED_WINDOW_ENDS) {
    for (const lengthInDays of WINDOW_LENGTHS_IN_DAYS) {
      const endDate: Date = new Date(end);

      windows.push({
        name: `${lengthInDays} day(s) ending ${end}`,
        startDate: OneUptimeDate.getSomeDaysAgoFromDate(endDate, lengthInDays),
        endDate: endDate,
      });
    }
  }

  return windows;
}

/* "Sep 23, 2026" - the UTC calendar date of an instant, in the label format. */
export function formatUtcDayLabel(date: Date): string {
  const month: string = MONTH_ABBREVIATIONS[date.getUTCMonth()] || "";
  const day: string = date.getUTCDate().toString().padStart(2, "0");

  return `${month} ${day}, ${date.getUTCFullYear()}`;
}

export function getUtcMidnight(date: Date): Date {
  return new Date(Math.floor(date.getTime() / MS_IN_DAY) * MS_IN_DAY);
}

function getPart(parts: Array<Intl.DateTimeFormatPart>, type: string): string {
  const part: Intl.DateTimeFormatPart | undefined = parts.find(
    (candidate: Intl.DateTimeFormatPart) => {
      return candidate.type === type;
    },
  );

  return part ? part.value : "";
}

/* "2026-03-08" - the calendar date of an instant in an IANA zone, via Intl. */
export function getDateKeyInTimezone(date: Date, timezone: string): string {
  const parts: Array<Intl.DateTimeFormatPart> = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).formatToParts(date);

  return `${getPart(parts, "year")}-${getPart(parts, "month")}-${getPart(
    parts,
    "day",
  )}`;
}

/*
 * The zone's UTC offset at an instant in minutes, east positive (the sign
 * moment's utcOffset() uses; Date#getTimezoneOffset is the negation).
 */
export function getOffsetInMinutes(date: Date, timezone: string): number {
  const parts: Array<Intl.DateTimeFormatPart> = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    },
  ).formatToParts(date);

  const wallClockAsUtc: number = Date.UTC(
    Number(getPart(parts, "year")),
    Number(getPart(parts, "month")) - 1,
    Number(getPart(parts, "day")),
    // Some ICU builds render midnight as hour 24 under hour12: false.
    Number(getPart(parts, "hour")) % 24,
    Number(getPart(parts, "minute")),
    Number(getPart(parts, "second")),
  );

  const instantToTheSecond: number = Math.floor(date.getTime() / 1000) * 1000;

  return Math.round((wallClockAsUtc - instantToTheSecond) / (60 * 1000));
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + days * MS_IN_DAY)
    .toISOString()
    .slice(0, 10);
}

export function getCalendarDaysBetweenDateKeys(
  fromDateKey: string,
  toDateKey: string,
): number {
  return Math.round(
    (Date.parse(`${toDateKey}T00:00:00.000Z`) -
      Date.parse(`${fromDateKey}T00:00:00.000Z`)) /
      MS_IN_DAY,
  );
}

/*
 * The bucket starts getDailyUptimeAggregate returns for a UTC-bucketed
 * window - its `buckets` CTE: one bucket per UTC day from the day holding
 * the window start to the day holding the window end, each starting at
 * GREATEST(day start, window start). So: a first bucket clipped to the
 * window start, then UTC midnights.
 */
export function getUtcServerBucketStarts(
  windowStart: Date,
  windowEnd: Date,
): Array<Date> {
  const bucketStarts: Array<Date> = [];

  const firstDay: number = getUtcMidnight(windowStart).getTime();
  const lastDay: number = getUtcMidnight(windowEnd).getTime();

  for (let day: number = firstDay; day <= lastDay; day += MS_IN_DAY) {
    bucketStarts.push(new Date(Math.max(day, windowStart.getTime())));
  }

  return bucketStarts;
}

export function doesBarContain(day: UptimeGraphDay, instant: Date): boolean {
  return (
    instant.getTime() >= day.startOfDay.getTime() &&
    instant.getTime() <= day.endOfDay.getTime()
  );
}

export function getIndexesOfBarsContaining(
  days: Array<UptimeGraphDay>,
  instant: Date,
): Array<number> {
  const indexes: Array<number> = [];

  for (let index: number = 0; index < days.length; index++) {
    if (doesBarContain(days[index]!, instant)) {
      indexes.push(index);
    }
  }

  return indexes;
}

/*
 * The reading DayUptimeGraph paints each bar from: the FIRST reading whose
 * start falls within the bar's [startOfDay, endOfDay]. Undefined means the
 * bar has no reading and falls back to the (capped) timeline rows.
 */
export function pairBarsWithBucketsLikeDayUptimeGraph(
  days: Array<UptimeGraphDay>,
  bucketStarts: Array<Date>,
): Array<Date | undefined> {
  return days.map((day: UptimeGraphDay) => {
    return bucketStarts.find((bucketStart: Date) => {
      return doesBarContain(day, bucketStart);
    });
  });
}

/*
 * The strip's days exactly as DayUptimeGraph computed them before the fix,
 * copied from the pre-fix component: count from
 * getNumberOfDaysBetweenDatesInclusive, day i = getSomeDaysAfterDate(start, i),
 * bounds from the LOCAL start / end of that day. getDays without a (valid)
 * timezone must reproduce it exactly - the dashboard's monitor page depends
 * on that.
 */
export function getDaysTheOldWay(
  startDate: Date,
  endDate: Date,
): Array<UptimeGraphDay> {
  const days: Array<UptimeGraphDay> = [];

  const count: number = OneUptimeDate.getNumberOfDaysBetweenDatesInclusive(
    startDate,
    endDate,
  );

  for (let dayNumber: number = 0; dayNumber < count; dayNumber++) {
    const todaysDay: Date = OneUptimeDate.getSomeDaysAfterDate(
      startDate,
      dayNumber,
    );

    days.push({
      date: todaysDay,
      startOfDay: OneUptimeDate.getStartOfDay(todaysDay),
      endOfDay: OneUptimeDate.getEndOfDay(todaysDay),
    });
  }

  return days;
}

/* One comparable line per bar, so a mismatch reports the index that broke. */
export function describeDays(days: Array<UptimeGraphDay>): Array<string> {
  return days.map((day: UptimeGraphDay, index: number) => {
    return `#${index} date=${day.date.toISOString()} start=${day.startOfDay.toISOString()} end=${day.endOfDay.toISOString()}`;
  });
}

export function expectSameDays(
  actual: Array<UptimeGraphDay>,
  expected: Array<UptimeGraphDay>,
): void {
  expect(actual).toHaveLength(expected.length);
  expect(describeDays(actual)).toEqual(describeDays(expected));
}

/*
 * Everything a UTC strip must satisfy for a window, checked against the
 * server's bucket starts for that window. On the pre-fix strip (local days)
 * this fails in every zone whose offset is not zero - see
 * expectLocalStripToMisplaceTodaysReading for the failure it had.
 */
export function expectUtcStripToPairWithServerBuckets(
  window: PinnedWindow,
): Array<UptimeGraphDay> {
  const days: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
    startDate: window.startDate,
    endDate: window.endDate,
    timezone: "UTC",
  });

  const bucketStarts: Array<Date> = getUtcServerBucketStarts(
    window.startDate,
    window.endDate,
  );

  const expectedCount: number =
    (getUtcMidnight(window.endDate).getTime() -
      getUtcMidnight(window.startDate).getTime()) /
      MS_IN_DAY +
    1;

  expect(days).toHaveLength(expectedCount);
  expect(bucketStarts).toHaveLength(expectedCount);

  // Every bar starts on a UTC midnight...
  expect(
    days.map((day: UptimeGraphDay) => {
      return day.startOfDay.getTime() % MS_IN_DAY;
    }),
  ).toEqual(
    days.map(() => {
      return 0;
    }),
  );

  /*
   * ...and they are the UTC midnights of the server's buckets, in order:
   * consecutive, no gap, no duplicate.
   */
  expect(
    days.map((day: UptimeGraphDay) => {
      return day.startOfDay.toISOString();
    }),
  ).toEqual(
    bucketStarts.map((bucketStart: Date) => {
      return getUtcMidnight(bucketStart).toISOString();
    }),
  );

  expect(
    new Set(
      days.map((day: UptimeGraphDay) => {
        return day.startOfDay.getTime();
      }),
    ).size,
  ).toBe(days.length);

  for (let index: number = 0; index < days.length; index++) {
    const day: UptimeGraphDay = days[index]!;

    // A UTC day is always 24 hours; the bar is labelled by its start.
    expect(day.date.getTime()).toBe(day.startOfDay.getTime());
    expect(day.endOfDay.getTime()).toBe(
      day.startOfDay.getTime() + MS_IN_DAY - 1,
    );

    if (index > 0) {
      expect(day.startOfDay.getTime()).toBe(
        days[index - 1]!.endOfDay.getTime() + 1,
      );
    }
  }

  /*
   * The strip covers the window: its first bar holds the window start and
   * its last bar - today - holds the window end.
   */
  expect(doesBarContain(days[0]!, window.startDate)).toBe(true);
  expect(doesBarContain(days[days.length - 1]!, window.endDate)).toBe(true);
  expect(formatUtcDayLabel(days[days.length - 1]!.date)).toBe(
    formatUtcDayLabel(window.endDate),
  );

  /*
   * Every server bucket - including the first, clipped one - lands in
   * exactly one bar, and bucket i in bar i.
   */
  expect(
    bucketStarts.map((bucketStart: Date) => {
      return getIndexesOfBarsContaining(days, bucketStart);
    }),
  ).toEqual(
    bucketStarts.map((_bucketStart: Date, index: number) => {
      return [index];
    }),
  );

  // So DayUptimeGraph paints every bar from its own day's reading.
  expect(
    pairBarsWithBucketsLikeDayUptimeGraph(days, bucketStarts).map(
      (paired: Date | undefined) => {
        return paired ? paired.toISOString() : "no reading";
      },
    ),
  ).toEqual(
    bucketStarts.map((bucketStart: Date) => {
      return bucketStart.toISOString();
    }),
  );

  /*
   * And each bar is labelled with the UTC date of the reading it shows,
   * whether or not the viewer's zone needs the "(UTC)" marker.
   */
  for (let index: number = 0; index < days.length; index++) {
    const expectedDate: string = formatUtcDayLabel(bucketStarts[index]!);

    expect([expectedDate, `${expectedDate} (UTC)`]).toContain(
      DayUptimeGraphUtil.formatDayLabel({
        date: days[index]!.date,
        timezone: "UTC",
      }),
    );
  }

  return days;
}

/*
 * One bar per calendar date of `timezone`, each bar exactly that date's
 * span. Checked with Intl, so a strip that skips or repeats a date around a
 * DST change - or that silently uses the process zone instead - fails.
 */
export function expectOneBarPerCalendarDate(data: {
  days: Array<UptimeGraphDay>;
  timezone: string;
  startDate: Date;
  endDate: Date;
}): void {
  const firstDateKey: string = getDateKeyInTimezone(
    data.startDate,
    data.timezone,
  );
  const lastDateKey: string = getDateKeyInTimezone(data.endDate, data.timezone);

  const expectedDateKeys: Array<string> = [];
  const lastOffset: number = getCalendarDaysBetweenDateKeys(
    firstDateKey,
    lastDateKey,
  );

  for (let offset: number = 0; offset <= lastOffset; offset++) {
    expectedDateKeys.push(addDaysToDateKey(firstDateKey, offset));
  }

  // One bar per date: none skipped, none repeated, in order.
  expect(
    data.days.map((day: UptimeGraphDay) => {
      return getDateKeyInTimezone(day.startOfDay, data.timezone);
    }),
  ).toEqual(expectedDateKeys);

  for (let index: number = 0; index < data.days.length; index++) {
    const day: UptimeGraphDay = data.days[index]!;
    const dateKey: string = expectedDateKeys[index]!;

    expect(day.date.getTime()).toBe(day.startOfDay.getTime());

    // startOfDay is the FIRST instant of the date and endOfDay the last.
    expect(
      getDateKeyInTimezone(
        new Date(day.startOfDay.getTime() - 1),
        data.timezone,
      ),
    ).toBe(addDaysToDateKey(dateKey, -1));
    expect(getDateKeyInTimezone(day.endOfDay, data.timezone)).toBe(dateKey);
    expect(
      getDateKeyInTimezone(new Date(day.endOfDay.getTime() + 1), data.timezone),
    ).toBe(addDaysToDateKey(dateKey, 1));

    // Contiguous: the next bar starts the millisecond this one ends.
    if (index > 0) {
      expect(day.startOfDay.getTime()).toBe(
        data.days[index - 1]!.endOfDay.getTime() + 1,
      );
    }
  }
}

/* How long each bar is, in hours. */
export function getBarLengthsInHours(
  days: Array<UptimeGraphDay>,
): Array<number> {
  return days.map((day: UptimeGraphDay) => {
    return (day.endOfDay.getTime() + 1 - day.startOfDay.getTime()) / MS_IN_HOUR;
  });
}

/*
 * Named bars around each 2026 DST change, pinned to exact instants. Because
 * the expected instants are absolute, the same expectations hold in every
 * process zone - the zone path must not lean on the process's own clock.
 */
interface DstTransitionCase {
  name: string;
  timezone: string;
  startDate: string;
  endDate: string;
  expectedStartsOfDay: Array<string>;
  expectedLengthsInHours: Array<number>;
}

const DST_TRANSITION_CASES: Array<DstTransitionCase> = [
  {
    name: "London's spring-forward (Mar 29 2026) is one 23 hour bar",
    timezone: "Europe/London",
    startDate: "2026-03-27T12:00:00.000Z",
    endDate: "2026-03-31T12:00:00.000Z",
    expectedStartsOfDay: [
      "2026-03-27T00:00:00.000Z",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      "2026-03-29T23:00:00.000Z",
      "2026-03-30T23:00:00.000Z",
    ],
    expectedLengthsInHours: [24, 24, 23, 24, 24],
  },
  {
    name: "London's fall-back (Oct 25 2026) is one 25 hour bar",
    timezone: "Europe/London",
    startDate: "2026-10-23T12:00:00.000Z",
    endDate: "2026-10-27T12:00:00.000Z",
    expectedStartsOfDay: [
      "2026-10-22T23:00:00.000Z",
      "2026-10-23T23:00:00.000Z",
      "2026-10-24T23:00:00.000Z",
      "2026-10-26T00:00:00.000Z",
      "2026-10-27T00:00:00.000Z",
    ],
    expectedLengthsInHours: [24, 24, 25, 24, 24],
  },
  {
    name: "New York's spring-forward (Mar 8 2026) is one 23 hour bar",
    timezone: "America/New_York",
    startDate: "2026-03-06T12:00:00.000Z",
    endDate: "2026-03-10T12:00:00.000Z",
    expectedStartsOfDay: [
      "2026-03-06T05:00:00.000Z",
      "2026-03-07T05:00:00.000Z",
      "2026-03-08T05:00:00.000Z",
      "2026-03-09T04:00:00.000Z",
      "2026-03-10T04:00:00.000Z",
    ],
    expectedLengthsInHours: [24, 24, 23, 24, 24],
  },
  {
    name: "New York's fall-back (Nov 1 2026) is one 25 hour bar",
    timezone: "America/New_York",
    startDate: "2026-10-30T12:00:00.000Z",
    endDate: "2026-11-03T12:00:00.000Z",
    expectedStartsOfDay: [
      "2026-10-30T04:00:00.000Z",
      "2026-10-31T04:00:00.000Z",
      "2026-11-01T04:00:00.000Z",
      "2026-11-02T05:00:00.000Z",
      "2026-11-03T05:00:00.000Z",
    ],
    expectedLengthsInHours: [24, 24, 25, 24, 24],
  },
  {
    /*
     * A half-hour zone: its days start at 18:30Z. The window end is 01:30 on
     * Sep 23 in Kolkata while it is still Sep 22 in UTC.
     */
    name: "Kolkata's days start at 18:30 UTC",
    timezone: "Asia/Kolkata",
    startDate: "2026-09-20T12:00:00.000Z",
    endDate: "2026-09-22T20:00:00.000Z",
    expectedStartsOfDay: [
      "2026-09-19T18:30:00.000Z",
      "2026-09-20T18:30:00.000Z",
      "2026-09-21T18:30:00.000Z",
      "2026-09-22T18:30:00.000Z",
    ],
    expectedLengthsInHours: [24, 24, 24, 24],
  },
];

/*
 * 90-day windows (the longest the status page draws) that cross a DST
 * change: exactly one bar is 23 or 25 hours - the transition date - and all
 * the others are 24.
 */
interface DstNinetyDayCase {
  timezone: string;
  endDate: string;
  transitionDateKey: string;
  transitionLengthInHours: number;
}

const DST_NINETY_DAY_CASES: Array<DstNinetyDayCase> = [
  {
    timezone: "Europe/London",
    endDate: "2026-04-15T12:00:00.000Z",
    transitionDateKey: "2026-03-29",
    transitionLengthInHours: 23,
  },
  {
    timezone: "Europe/London",
    endDate: "2026-11-15T12:00:00.000Z",
    transitionDateKey: "2026-10-25",
    transitionLengthInHours: 25,
  },
  {
    timezone: "America/New_York",
    endDate: "2026-04-15T12:00:00.000Z",
    transitionDateKey: "2026-03-08",
    transitionLengthInHours: 23,
  },
  {
    timezone: "America/New_York",
    endDate: "2026-11-15T12:00:00.000Z",
    transitionDateKey: "2026-11-01",
    transitionLengthInHours: 25,
  },
];

/*
 * The zone path of getDays across DST changes. Called from every process
 * zone's file: the answers are absolute instants, so they must not move
 * with the zone the process happens to run in.
 */
export function describeZoneStripAcrossDst(processDescription: string): void {
  describe(`DayUptimeGraphUtil.getDays in a DST zone (${processDescription})`, () => {
    for (const transitionCase of DST_TRANSITION_CASES) {
      test(transitionCase.name, () => {
        const startDate: Date = new Date(transitionCase.startDate);
        const endDate: Date = new Date(transitionCase.endDate);

        const days: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
          startDate: startDate,
          endDate: endDate,
          timezone: transitionCase.timezone,
        });

        expect(
          days.map((day: UptimeGraphDay) => {
            return day.startOfDay.toISOString();
          }),
        ).toEqual(transitionCase.expectedStartsOfDay);

        expect(getBarLengthsInHours(days)).toEqual(
          transitionCase.expectedLengthsInHours,
        );

        expectOneBarPerCalendarDate({
          days: days,
          timezone: transitionCase.timezone,
          startDate: startDate,
          endDate: endDate,
        });
      });
    }

    for (const ninetyDayCase of DST_NINETY_DAY_CASES) {
      test(`a 90 day ${ninetyDayCase.timezone} window ending ${ninetyDayCase.endDate} has one bar per date and one ${ninetyDayCase.transitionLengthInHours} hour day`, () => {
        const endDate: Date = new Date(ninetyDayCase.endDate);
        const startDate: Date = new Date(endDate.getTime() - 90 * MS_IN_DAY);

        const days: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
          startDate: startDate,
          endDate: endDate,
          timezone: ninetyDayCase.timezone,
        });

        /*
         * Ninety 24-hour days back from midday lands mid-morning or
         * mid-afternoon of the date 90 calendar days earlier: 91 bars.
         */
        expect(days).toHaveLength(91);

        expectOneBarPerCalendarDate({
          days: days,
          timezone: ninetyDayCase.timezone,
          startDate: startDate,
          endDate: endDate,
        });

        const lengths: Array<number> = getBarLengthsInHours(days);

        const oddDays: Array<string> = [];

        for (let index: number = 0; index < days.length; index++) {
          if (lengths[index] !== 24) {
            oddDays.push(
              `${getDateKeyInTimezone(days[index]!.startOfDay, ninetyDayCase.timezone)}=${lengths[index]}h`,
            );
          }
        }

        expect(oddDays).toEqual([
          `${ninetyDayCase.transitionDateKey}=${ninetyDayCase.transitionLengthInHours}h`,
        ]);

        // The bars tile the window's dates exactly.
        expect(
          lengths.reduce((total: number, length: number) => {
            return total + length;
          }, 0),
        ).toBe(
          (days[days.length - 1]!.endOfDay.getTime() +
            1 -
            days[0]!.startOfDay.getTime()) /
            MS_IN_HOUR,
        );
      });
    }
  });
}

export interface LocalDateDiffersCase {
  // A window end at which this zone's calendar date is not the UTC date.
  instant: string;
  // The local date the pre-fix strip labelled today's bar with.
  localDayLabel: string;
  // The UTC date today's bar is now, and the reading it must show.
  utcDayLabel: string;
}

export interface UtcBarLabelCase {
  // A UTC midnight - the date a UTC bar is labelled by.
  date: string;
  // formatDayLabel({ date, timezone: "UTC" }) read from this process zone.
  expectedLabel: string;
}

export interface ProcessTimezoneConfig {
  // The zone the file's @timezone docblock asks for.
  processTimezone: string;
  /*
   * What Date#getTimezoneOffset() must return at these instants. Proves the
   * docblock took effect: without it every case below would silently run in
   * the machine's own zone and prove nothing about this one.
   */
  timezoneOffsets: Array<{ instant: string; getTimezoneOffset: number }>;
  localDateDiffers: Array<LocalDateDiffersCase>;
  utcBarLabels: Array<UtcBarLabelCase>;
}

/*
 * The cases every per-process-zone file runs. The file supplies the
 * zone-specific facts; the shared cases do the rest.
 */
export function describeDayUptimeGraphUtilInProcessTimezone(
  config: ProcessTimezoneConfig,
): void {
  const title: string = `a ${config.processTimezone} process`;

  describe(`DayUptimeGraphUtil in ${title}`, () => {
    afterEach(() => {
      OneUptimeDate.setUserTimezone(null);
    });

    test("the process really is running in the zone the docblock asked for", () => {
      for (const check of config.timezoneOffsets) {
        expect(new Date(check.instant).getTimezoneOffset()).toBe(
          check.getTimezoneOffset,
        );

        /*
         * The viewer zone formatDayLabel compares against is the same zone
         * (it may come back under a legacy alias, e.g. Asia/Calcutta).
         */
        const viewerTimezone: string = OneUptimeDate.getCurrentTimezone();

        expect(DayUptimeGraphUtil.isValidTimezone(viewerTimezone)).toBe(true);
        /*
         * `0 - x` rather than `-x`: -0 is not 0 to toBe (Object.is), and
         * London's winter offset is 0.
         */
        expect(
          getOffsetInMinutes(new Date(check.instant), viewerTimezone),
        ).toBe(0 - check.getTimezoneOffset);
      }
    });

    describe("getDays without a timezone is exactly the old local-day strip", () => {
      /*
       * The dashboard's monitor page passes no timezone (its buckets are
       * requested in the browser's zone) and must draw exactly what it drew
       * before - including across this zone's DST changes, which several
       * pinned windows cross.
       */
      for (const window of getPinnedWindows()) {
        test(window.name, () => {
          const oldDays: Array<UptimeGraphDay> = getDaysTheOldWay(
            window.startDate,
            window.endDate,
          );

          expectSameDays(
            DayUptimeGraphUtil.getDays({
              startDate: window.startDate,
              endDate: window.endDate,
            }),
            oldDays,
          );

          // An unusable zone is treated as no zone at all, not as UTC.
          for (const invalid of [undefined, "", "   ", "Not/AZone"]) {
            expectSameDays(
              DayUptimeGraphUtil.getDays({
                startDate: window.startDate,
                endDate: window.endDate,
                timezone: invalid,
              }),
              oldDays,
            );
          }
        });
      }
    });

    describe("getDays with timezone UTC pairs every bar with exactly one server bucket", () => {
      for (const window of getPinnedWindows()) {
        test(window.name, () => {
          expectUtcStripToPairWithServerBuckets(window);
        });
      }
    });

    describe("when the local date is not the UTC date", () => {
      for (const localCase of config.localDateDiffers) {
        const endDate: Date = new Date(localCase.instant);
        const startDate: Date = OneUptimeDate.getSomeDaysAgoFromDate(
          endDate,
          60,
        );

        const bucketStarts: Array<Date> = getUtcServerBucketStarts(
          startDate,
          endDate,
        );

        const todaysReading: Date = getUtcMidnight(endDate);

        test(`at ${localCase.instant} today's bar is the UTC day ${localCase.utcDayLabel} and shows today's reading`, () => {
          /*
           * Precondition: this really is an instant where the viewer's own
           * calendar says a different date from UTC's.
           */
          expect(
            OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              endDate,
              true,
            ),
          ).toBe(localCase.localDayLabel);
          expect(formatUtcDayLabel(endDate)).toBe(localCase.utcDayLabel);
          expect(localCase.localDayLabel).not.toBe(localCase.utcDayLabel);

          const days: Array<UptimeGraphDay> =
            expectUtcStripToPairWithServerBuckets({
              name: localCase.instant,
              startDate: startDate,
              endDate: endDate,
            });

          const today: UptimeGraphDay = days[days.length - 1]!;

          expect(today.startOfDay.toISOString()).toBe(
            todaysReading.toISOString(),
          );
          expect(formatUtcDayLabel(today.date)).toBe(localCase.utcDayLabel);
          expect(
            pairBarsWithBucketsLikeDayUptimeGraph(days, bucketStarts)[
              days.length - 1
            ]?.toISOString(),
          ).toBe(todaysReading.toISOString());

          /*
           * The label says it is the UTC date, so it does not read as a
           * mistake next to the viewer's own calendar.
           */
          expect(
            DayUptimeGraphUtil.formatDayLabel({
              date: today.date,
              timezone: "UTC",
            }),
          ).toBe(`${localCase.utcDayLabel} (UTC)`);
        });

        /*
         * The failure itself. Before the fix DayUptimeGraph drew exactly
         * getDaysTheOldWay (local days) against these UTC buckets. Today's
         * bar then either had no reading at all - east of UTC in the first
         * hours of the local day, west of UTC for most of it - or was
         * painted from a reading for a different date than the one it was
         * labelled with. The previous test fails on that strip.
         */
        test(`at ${localCase.instant} the pre-fix local strip misplaced today's reading`, () => {
          const oldDays: Array<UptimeGraphDay> = getDaysTheOldWay(
            startDate,
            endDate,
          );

          const oldToday: UptimeGraphDay = oldDays[oldDays.length - 1]!;
          const oldTodaysReading: Date | undefined =
            pairBarsWithBucketsLikeDayUptimeGraph(oldDays, bucketStarts)[
              oldDays.length - 1
            ];

          const oldTodayLabel: string =
            OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              oldToday.date,
              true,
            );

          expect(oldTodayLabel).toBe(localCase.localDayLabel);

          const showedTheRightReading: boolean = Boolean(
            oldTodaysReading &&
              formatUtcDayLabel(oldTodaysReading) === oldTodayLabel,
          );

          expect(showedTheRightReading).toBe(false);
        });
      }
    });

    describe("formatDayLabel", () => {
      for (const labelCase of config.utcBarLabels) {
        test(`a UTC bar for ${labelCase.date} reads "${labelCase.expectedLabel}" here`, () => {
          const date: Date = new Date(labelCase.date);

          expect(
            DayUptimeGraphUtil.formatDayLabel({
              date: date,
              timezone: "UTC",
            }),
          ).toBe(labelCase.expectedLabel);

          // The date part is always the UTC calendar date.
          expect(
            labelCase.expectedLabel.startsWith(formatUtcDayLabel(date)),
          ).toBe(true);
        });
      }

      test("a viewer who picked UTC in their settings gets no marker", () => {
        OneUptimeDate.setUserTimezone(Timezone.UTC);

        for (const labelCase of config.utcBarLabels) {
          const date: Date = new Date(labelCase.date);

          expect(
            DayUptimeGraphUtil.formatDayLabel({
              date: date,
              timezone: "UTC",
            }),
          ).toBe(formatUtcDayLabel(date));
        }
      });

      test("without a timezone the label is the long-standing local one", () => {
        for (const instant of [
          ...PINNED_WINDOW_ENDS,
          ...config.utcBarLabels.map((labelCase: UtcBarLabelCase) => {
            return labelCase.date;
          }),
        ]) {
          const date: Date = new Date(instant);

          const expected: string =
            OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date, true);

          expect(DayUptimeGraphUtil.formatDayLabel({ date: date })).toBe(
            expected,
          );
          expect(
            DayUptimeGraphUtil.formatDayLabel({
              date: date,
              timezone: "Not/AZone",
            }),
          ).toBe(expected);
        }
      });
    });
  });

  describeZoneStripAcrossDst(title);
}
