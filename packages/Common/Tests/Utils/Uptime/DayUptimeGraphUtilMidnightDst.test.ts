import DayUptimeGraphUtil, {
  UptimeGraphDay,
} from "../../../Utils/Uptime/DayUptimeGraphUtil";
import moment from "moment-timezone";
import { describe, expect, test } from "@jest/globals";

/*
 * Zones that change their clocks AT midnight.
 *
 * On the day such a zone springs forward there is no 00:00 - the clock goes
 * from 23:59:59 straight to 01:00. The strip's zone path used to step whole
 * days from local midnight, and moment, asked for a midnight that does not
 * exist, keeps the old offset and lands on 23:00 of the PREVIOUS day. So that
 * previous day was drawn twice and the transition day not at all - a server
 * bucket for it would then have matched no bar.
 *
 * On the day such a zone falls back, the last hour repeats, and endOf("day")
 * is the FIRST 23:59:59.999: an hour of the day belonged to no bar.
 *
 * The status page only ever sends "UTC" today, so this was latent, but the
 * util takes any zone and its day grid has to be right for all of them.
 * These cases are process-timezone independent: every instant is explicit.
 */

const HOUR_MS: number = 60 * 60 * 1000;

interface MidnightDstCase {
  timezone: string;
  /* A window containing the transition. */
  startDate: string;
  endDate: string;
  /* The local date of the transition and how long that day is. */
  transitionDate: string;
  transitionDayHours: number;
}

const cases: Array<MidnightDstCase> = [
  {
    // Chile springs forward at 24:00 on the first Saturday of September.
    timezone: "America/Santiago",
    startDate: "2026-08-20T15:00:00.000Z",
    endDate: "2026-09-20T15:00:00.000Z",
    transitionDate: "2026-09-06",
    transitionDayHours: 23,
  },
  {
    // ...and falls back at 24:00 on the first Saturday of April.
    timezone: "America/Santiago",
    startDate: "2026-03-20T15:00:00.000Z",
    endDate: "2026-04-20T15:00:00.000Z",
    transitionDate: "2026-04-04",
    transitionDayHours: 25,
  },
  {
    timezone: "America/Havana",
    startDate: "2026-02-25T15:00:00.000Z",
    endDate: "2026-03-25T15:00:00.000Z",
    transitionDate: "2026-03-08",
    transitionDayHours: 23,
  },
  {
    timezone: "Asia/Beirut",
    startDate: "2026-03-15T10:00:00.000Z",
    endDate: "2026-04-15T10:00:00.000Z",
    transitionDate: "2026-03-29",
    transitionDayHours: 23,
  },
];

function localDate(date: Date, timezone: string): string {
  return moment(date).tz(timezone).format("YYYY-MM-DD");
}

describe("DayUptimeGraphUtil.getDays in zones that change their clocks at midnight", () => {
  for (const dstCase of cases) {
    test(`${dstCase.timezone} around ${dstCase.transitionDate}: one bar per calendar date, none repeated, none skipped`, () => {
      const days: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
        startDate: new Date(dstCase.startDate),
        endDate: new Date(dstCase.endDate),
        timezone: dstCase.timezone,
      });

      const dates: Array<string> = days.map((day: UptimeGraphDay) => {
        return localDate(day.startOfDay, dstCase.timezone);
      });

      // Every calendar date from the first to the last, once each.
      const expected: Array<string> = [];
      const cursor: moment.Moment = moment.tz(dates[0]!, "YYYY-MM-DD", "UTC");
      const last: moment.Moment = moment.tz(
        localDate(new Date(dstCase.endDate), dstCase.timezone),
        "YYYY-MM-DD",
        "UTC",
      );

      while (!cursor.isAfter(last)) {
        expected.push(cursor.format("YYYY-MM-DD"));
        cursor.add(1, "day");
      }

      expect(dates).toEqual(expected);
      expect(dates[0]).toBe(
        localDate(new Date(dstCase.startDate), dstCase.timezone),
      );
      expect(new Set(dates).size).toBe(dates.length);
      expect(dates).toContain(dstCase.transitionDate);
    });

    test(`${dstCase.timezone} around ${dstCase.transitionDate}: the bars tile time with no gap and no overlap`, () => {
      const days: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
        startDate: new Date(dstCase.startDate),
        endDate: new Date(dstCase.endDate),
        timezone: dstCase.timezone,
      });

      for (let i: number = 0; i + 1 < days.length; i++) {
        expect(days[i]!.endOfDay.getTime() + 1).toBe(
          days[i + 1]!.startOfDay.getTime(),
        );
      }

      for (const day of days) {
        expect(day.date.getTime()).toBe(day.startOfDay.getTime());
      }

      const transition: UptimeGraphDay | undefined = days.find(
        (day: UptimeGraphDay) => {
          return (
            localDate(day.startOfDay, dstCase.timezone) ===
            dstCase.transitionDate
          );
        },
      );

      expect(transition).toBeDefined();

      const lengthInHours: number =
        (transition!.endOfDay.getTime() +
          1 -
          transition!.startOfDay.getTime()) /
        HOUR_MS;

      expect(lengthInHours).toBe(dstCase.transitionDayHours);
    });
  }

  test("an ordinary UTC window is unchanged: consecutive UTC midnights ending at 23:59:59.999", () => {
    const days: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
      startDate: new Date("2026-07-24T08:49:59.288Z"),
      endDate: new Date("2026-09-22T08:49:59.288Z"),
      timezone: "UTC",
    });

    expect(days).toHaveLength(61);
    expect(days[0]!.startOfDay.toISOString()).toBe("2026-07-24T00:00:00.000Z");
    expect(days[0]!.endOfDay.toISOString()).toBe("2026-07-24T23:59:59.999Z");
    expect(days[60]!.startOfDay.toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(days[60]!.endOfDay.toISOString()).toBe("2026-09-22T23:59:59.999Z");
  });
});
