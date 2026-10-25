import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import { RangeStartAndEndDateTimeUtil } from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The day and week ranges on the days the clocks change, in the viewer's zone
 * (one file per zone, each with a @timezone docblock: TimezoneEnvironment sets
 * the process's TZ before the file runs - assigning process.env.TZ inside a
 * test does not reach Jest's worker).
 *
 * In a zone with daylight saving time a calendar day is 25 hours on the day
 * the clocks go back and 23 on the day they go forward. Past 1 Day was a
 * calendar day back from now, so in London on 2026-10-25 it read 25 hours
 * (the KubernetesEvents browser suite, which runs in Europe/London, failed on
 * it). Each case first shows a calendar day really is not 24 hours there at
 * that moment, so it cannot pass in a zone that did not take.
 */

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

export interface ClockChange {
  // A moment less than a day after the clocks changed.
  now: string;
  // How long the calendar day back from `now` is in the zone.
  calendarDayHours: number;
}

const RANGES: Array<[TimeRange, number]> = [
  [TimeRange.PAST_ONE_DAY, DAY],
  [TimeRange.PAST_TWO_DAYS, 2 * DAY],
  [TimeRange.PAST_ONE_WEEK, 7 * DAY],
  [TimeRange.PAST_TWO_WEEKS, 14 * DAY],
];

export const freezeNowAt: (now: string) => Date = (now: string): Date => {
  const date: Date = new Date(now);
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(date);
  return date;
};

export const describeClockChanges: (
  zone: string,
  changes: Array<ClockChange>,
) => void = (zone: string, changes: Array<ClockChange>): void => {
  describe(`the day and week ranges in ${zone}, on the days the clocks change`, () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test(`the file runs in ${zone}`, () => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
    });

    for (const change of changes) {
      test(`a calendar day back from ${change.now} is ${change.calendarDayHours} hours there`, () => {
        const now: Date = new Date(change.now);

        expect(
          (now.getTime() - OneUptimeDate.addRemoveDays(now, -1).getTime()) /
            HOUR,
        ).toBe(change.calendarDayHours);
      });

      for (const [range, width] of RANGES) {
        test(`${range} at ${change.now} ends now and is ${width / HOUR} hours long`, () => {
          const now: Date = freezeNowAt(change.now);

          const between: InBetween<Date> =
            RangeStartAndEndDateTimeUtil.getStartAndEndDate({ range });

          expect(between.endValue.getTime()).toBe(now.getTime());
          expect(
            between.endValue.getTime() - between.startValue.getTime(),
          ).toBe(width);
        });
      }
    }
  });
};
