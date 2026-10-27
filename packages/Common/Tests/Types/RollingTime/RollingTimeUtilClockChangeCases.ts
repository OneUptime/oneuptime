import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * Every rolling time's window around the days the clocks change, in the zone
 * the process runs in (one file per zone, each with a @timezone docblock:
 * TimezoneEnvironment sets the process's TZ before the file runs - assigning
 * process.env.TZ inside a test does not reach Jest's worker).
 *
 * In a zone with daylight saving time, N calendar days back from a moment
 * shortly after its clocks changed is an hour more or less than N days. The
 * day ranges were calendar days back, so in London on 2026-10-27 Past 3 Days
 * read 73 hours, which the aggregate query buckets by the hour instead of
 * every 30 minutes (the Metrics monitor docs suite failed on it), and
 * getWindowInMs, which steps back from 1970-01-01, read Past 90 and 180 Days
 * an hour long in New York, whose clocks went back on 1969-10-26. Each case
 * first shows its calendar days really are not whole days there, so it
 * cannot pass in a zone that did not take.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

// A rolling time's name: "Past 3 Days", "Past 1 Hour".
const ROLLING_TIME_NAME: RegExp = /^Past (\d+) (Minute|Hour|Day)s?$/;

export interface ClockChange {
  // A moment shortly after the clocks changed.
  now: string;
  // A number of calendar days back from `now`...
  days: number;
  // ...and how many hours that is in the zone.
  calendarHours: number;
}

// How long a rolling time's name says its window is: Past 3 Days is 3 days.
const lengthOf: (rollingTime: RollingTime) => number = (
  rollingTime: RollingTime,
): number => {
  const units: Record<string, number> = {
    Minute: MINUTE,
    Hour: HOUR,
    Day: DAY,
  };
  const match: RegExpExecArray | null = ROLLING_TIME_NAME.exec(rollingTime);

  if (!match) {
    throw new Error(
      `"${rollingTime}" is not Past N Minutes, Hours or Days: give it a length here`,
    );
  }

  return Number(match[1]) * (units[match[2] as string] as number);
};

export const describeClockChanges: (
  zone: string,
  changes: Array<ClockChange>,
) => void = (zone: string, changes: Array<ClockChange>): void => {
  describe(`every rolling time in ${zone}, around the days the clocks change`, () => {
    test(`the file runs in ${zone}`, () => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
    });

    for (const change of changes) {
      test(`${change.days} calendar days back from ${change.now} is ${change.calendarHours} hours there`, () => {
        const now: Date = new Date(change.now);

        expect(
          (now.getTime() -
            OneUptimeDate.addRemoveDays(now, -change.days).getTime()) /
            HOUR,
        ).toBe(change.calendarHours);
      });

      for (const rollingTime of Object.values(RollingTime)) {
        test(`${rollingTime} up to ${change.now} is as long as its name says`, () => {
          const end: Date = new Date(change.now);

          const window: InBetween<Date> =
            RollingTimeUtil.convertToStartAndEndDate(rollingTime, end);

          expect(window.endValue.getTime()).toBe(end.getTime());
          expect(window.endValue.getTime() - window.startValue.getTime()).toBe(
            lengthOf(rollingTime),
          );
        });
      }
    }

    for (const rollingTime of Object.values(RollingTime)) {
      test(`getWindowInMs reads ${rollingTime} as long as its name says`, () => {
        expect(RollingTimeUtil.getWindowInMs(rollingTime)).toBe(
          lengthOf(rollingTime),
        );
      });
    }
  });
};
