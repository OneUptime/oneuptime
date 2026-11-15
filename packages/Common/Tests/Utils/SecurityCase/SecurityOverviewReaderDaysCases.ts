import { formatDayLabel } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/DayLabels";
import Timezone from "../../../Types/Timezone";
import TimezoneAlias from "../../../Types/TimezoneAlias";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import {
  CalendarDay,
  DayCount,
  OverviewCaseRow,
  OverviewDetectionRow,
  SecurityOverviewMetrics,
  calendarDaysBetween,
  computeSecurityOverviewMetrics,
  dayInTimezone,
  daysBetween,
  findCalendarDay,
  utcDay,
} from "../../../Utils/SecurityCase/SecurityOverviewMetrics";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
} from "../../Helpers/SecurityCaseValues";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * THE SECURITY OVERVIEW'S DAY BARS COUNT THE READER'S DAYS (issue #7925).
 *
 * The cases-opened and detections bars were cut on UTC days: in New York a
 * case opened at 20:00 on 4 November counted on the 5 November bar, and the
 * same day read differently there and on every other day chart, which has
 * put each day's total under the reader's own day since issue #7277. The
 * overview now walks the days of the zone the page asks in, counts each
 * case and detection on the day it happened there, and names each bar by
 * that day's date (formatDayLabel reads the date as it is written).
 *
 * The day an instant falls on is worked out here on the platform's own
 * clock (Intl), and the instants days start at are Python zoneinfo's, not
 * the code under test's. The cases run with the process in several zones
 * (the @timezone docblock of each file that calls this), which must not
 * move a single bar.
 */

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

// The date an instant falls on in `timezone`, as the platform's clock has it.
function platformDay(ms: number, timezone: string): string {
  const parts: Array<Intl.DateTimeFormatPart> = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).formatToParts(new Date(ms));
  const part: (type: string) => string = (type: string): string => {
    return parts.find((item: Intl.DateTimeFormatPart): boolean => {
      return item.type === type;
    })!.value;
  };

  return `${part("year")}-${part("month")}-${part("day")}`;
}

// The calendar date after a YYYY-MM-DD one.
function nextDate(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + DAY)
    .toISOString()
    .slice(0, 10);
}

// Every calendar date from `from` to `to`, both included.
function datesFrom(from: string, to: string): Array<string> {
  const dates: Array<string> = [from];

  while (dates[dates.length - 1]! < to) {
    dates.push(nextDate(dates[dates.length - 1]!));
  }

  return dates;
}

function caseAt(createdAt: string): OverviewCaseRow {
  return {
    createdAt: new Date(createdAt),
    priorityId: undefined,
    statusId: undefined,
  };
}

function detectionAt(firstSeenAt: string): OverviewDetectionRow {
  return {
    firstSeenAt: new Date(firstSeenAt),
    source: SecurityDetectionSource.DetectionRule,
    ruleName: "Impossible travel",
  };
}

function overviewOf(data: {
  now: string;
  windowDays: number;
  detectionWindowDays?: number | undefined;
  cases?: Array<string> | undefined;
  detections?: Array<string> | undefined;
  timezone?: Timezone | undefined;
}): SecurityOverviewMetrics {
  const now: Date = new Date(data.now);

  return computeSecurityOverviewMetrics({
    priorities: buildDefaultTestPriorities(),
    statuses: buildDefaultTestStatuses(),
    openCases: [],
    casesInWindow: (data.cases || []).map(caseAt),
    detectionsInWindow: (data.detections || []).map(detectionAt),
    windowStart: new Date(now.getTime() - data.windowDays * DAY),
    detectionWindowStart: new Date(
      now.getTime() - (data.detectionWindowDays || data.windowDays) * DAY,
    ),
    now: now,
    timezone: data.timezone,
  });
}

// The bars with something on them, as { day: total }.
function countedDays(days: Array<DayCount>): Record<string, number> {
  const counted: Record<string, number> = {};

  for (const day of days) {
    if (day.total > 0) {
      counted[day.day] = day.total;
    }
  }

  return counted;
}

function dayNames(days: Array<DayCount>): Array<string> {
  return days.map((day: DayCount): string => {
    return day.day;
  });
}

// A reader's zone, and instants around its days' edges and clock changes.
interface ReaderCase {
  name: string;
  timezone: Timezone;
  // Each instant, and the reader's day it falls on.
  instants: Array<[string, string]>;
  // The window the bars walk: from `now` back `windowDays`.
  now: string;
  windowDays: number;
}

const READERS: ReadonlyArray<ReaderCase> = [
  {
    name: "New York, over the November change",
    timezone: Timezone.AmericaNew_York,
    instants: [
      // The issue's case: 01:00 UTC on the 5th is 20:00 on the 4th there.
      ["2026-11-05T01:00:00.000Z", "2026-11-04"],
      ["2026-11-01T03:59:59.999Z", "2026-10-31"],
      ["2026-11-01T04:00:00.000Z", "2026-11-01"],
      // The hour the clocks repeat, and the 25th hour of 1 November.
      ["2026-11-01T06:30:00.000Z", "2026-11-01"],
      ["2026-11-02T04:30:00.000Z", "2026-11-01"],
      ["2026-11-02T05:00:00.000Z", "2026-11-02"],
    ],
    now: "2026-11-15T15:00:00.000Z",
    windowDays: 30,
  },
  {
    name: "New York, over the March change",
    timezone: Timezone.AmericaNew_York,
    instants: [
      ["2026-03-08T04:59:59.999Z", "2026-03-07"],
      ["2026-03-08T05:00:00.000Z", "2026-03-08"],
      // 8 March is 23 hours long: 23:30 on it is 03:30 UTC on the 9th.
      ["2026-03-09T03:30:00.000Z", "2026-03-08"],
      ["2026-03-09T04:00:00.000Z", "2026-03-09"],
    ],
    now: "2026-03-20T12:00:00.000Z",
    windowDays: 30,
  },
  {
    name: "London, over the October change",
    timezone: Timezone.EuropeLondon,
    instants: [
      // 00:30 BST on the 25th is 23:30 UTC on the 24th.
      ["2026-10-24T23:30:00.000Z", "2026-10-25"],
      ["2026-10-25T23:30:00.000Z", "2026-10-25"],
      ["2026-10-26T00:00:00.000Z", "2026-10-26"],
    ],
    now: "2026-11-01T09:00:00.000Z",
    windowDays: 30,
  },
  {
    name: "Auckland, over the September change",
    timezone: Timezone.PacificAuckland,
    instants: [
      ["2026-09-26T11:59:59.999Z", "2026-09-26"],
      ["2026-09-26T12:00:00.000Z", "2026-09-27"],
      // 27 September is 23 hours long there.
      ["2026-09-27T10:59:59.999Z", "2026-09-27"],
      ["2026-09-27T11:00:00.000Z", "2026-09-28"],
    ],
    now: "2026-10-05T00:00:00.000Z",
    windowDays: 30,
  },
  {
    name: "Kolkata, half an hour off UTC's hours",
    timezone: Timezone.AsiaKolkata,
    instants: [
      ["2026-11-04T18:29:59.999Z", "2026-11-04"],
      ["2026-11-04T18:30:00.000Z", "2026-11-05"],
      ["2026-11-04T23:59:00.000Z", "2026-11-05"],
    ],
    now: "2026-11-10T06:00:00.000Z",
    windowDays: 14,
  },
  {
    name: "Kathmandu, 45 minutes off UTC's hours",
    timezone: Timezone.AsiaKathmandu,
    instants: [
      ["2026-11-04T18:14:59.999Z", "2026-11-04"],
      ["2026-11-04T18:15:00.000Z", "2026-11-05"],
      ["2026-11-04T18:29:59.999Z", "2026-11-05"],
    ],
    now: "2026-11-10T06:00:00.000Z",
    windowDays: 14,
  },
  {
    name: "Tokyo, east of UTC",
    timezone: Timezone.AsiaTokyo,
    instants: [
      // 01:00 on the 5th in Tokyo is 16:00 UTC on the 4th.
      ["2026-11-04T16:00:00.000Z", "2026-11-05"],
      ["2026-11-04T14:59:59.999Z", "2026-11-04"],
    ],
    now: "2026-11-10T06:00:00.000Z",
    windowDays: 14,
  },
  {
    name: "Lord Howe, whose clocks change by half an hour",
    timezone: Timezone.AustraliaLord_Howe,
    instants: [
      ["2026-10-03T13:29:59.999Z", "2026-10-03"],
      ["2026-10-03T13:30:00.000Z", "2026-10-04"],
      // 4 October is 23.5 hours long there.
      ["2026-10-04T12:59:59.999Z", "2026-10-04"],
      ["2026-10-04T13:00:00.000Z", "2026-10-05"],
    ],
    now: "2026-10-12T00:00:00.000Z",
    windowDays: 14,
  },
  {
    name: "Santiago, whose 6 September has no midnight",
    timezone: Timezone.AmericaSantiago,
    instants: [
      ["2026-09-06T03:59:59.999Z", "2026-09-05"],
      // The clocks go from 24:00 on the 5th to 01:00 on the 6th.
      ["2026-09-06T04:00:00.000Z", "2026-09-06"],
      ["2026-09-07T02:59:59.999Z", "2026-09-06"],
      ["2026-09-07T03:00:00.000Z", "2026-09-07"],
    ],
    now: "2026-09-15T12:00:00.000Z",
    windowDays: 14,
  },
];

export default function describeSecurityOverviewReaderDays(
  processTimezone: string,
): void {
  describe(`the Security overview's day bars, with the process in ${processTimezone}`, () => {
    test("the process runs in the zone its file names", () => {
      expect(process.env["TZ"]).toBe(processTimezone);
      // ICU spells some zones the old way (Asia/Calcutta, Asia/Katmandu).
      expect(
        TimezoneAlias.getCanonicalTimezone(
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
      ).toBe(processTimezone);
    });

    describe("a New York reader (the issue's cases)", () => {
      test("a case opened at 01:00 UTC on 5 November counts on the 4 November bar", () => {
        const metrics: SecurityOverviewMetrics = overviewOf({
          now: "2026-11-10T15:00:00.000Z",
          windowDays: 30,
          cases: ["2026-11-05T01:00:00.000Z"],
          timezone: Timezone.AmericaNew_York,
        });

        expect(countedDays(metrics.casesOpenedPerDay)).toEqual({
          "2026-11-04": 1,
        });
      });

      test("a detection first seen then counts on the 4 November bar too", () => {
        const metrics: SecurityOverviewMetrics = overviewOf({
          now: "2026-11-10T15:00:00.000Z",
          windowDays: 30,
          detectionWindowDays: 14,
          detections: ["2026-11-05T01:00:00.000Z"],
          timezone: Timezone.AmericaNew_York,
        });

        expect(countedDays(metrics.detectionsPerDay)).toEqual({
          "2026-11-04": 1,
        });
        expect(metrics.detectionsPerDay[0]!.day).toBe("2026-10-27");
      });

      test("with no zone the same case counts on UTC's 5 November, as before", () => {
        const metrics: SecurityOverviewMetrics = overviewOf({
          now: "2026-11-10T15:00:00.000Z",
          windowDays: 30,
          cases: ["2026-11-05T01:00:00.000Z"],
          detections: ["2026-11-05T01:00:00.000Z"],
        });

        expect(countedDays(metrics.casesOpenedPerDay)).toEqual({
          "2026-11-05": 1,
        });
        expect(countedDays(metrics.detectionsPerDay)).toEqual({
          "2026-11-05": 1,
        });
      });

      test("the bars over the 1 November clock change are one a day, with no gap and no duplicate", () => {
        const metrics: SecurityOverviewMetrics = overviewOf({
          now: "2026-11-15T15:00:00.000Z",
          windowDays: 30,
          detectionWindowDays: 14,
          timezone: Timezone.AmericaNew_York,
        });

        expect(dayNames(metrics.casesOpenedPerDay)).toEqual(
          datesFrom("2026-10-16", "2026-11-15"),
        );
        expect(dayNames(metrics.detectionsPerDay)).toEqual(
          datesFrom("2026-11-01", "2026-11-15"),
        );
      });

      test("1 November is one bar of 25 hours: its 25th hour counts on it, the next midnight on the 2nd", () => {
        const days: Array<CalendarDay> = calendarDaysBetween(
          new Date("2026-10-30T12:00:00.000Z"),
          new Date("2026-11-03T12:00:00.000Z"),
          Timezone.AmericaNew_York,
        );

        expect(days).toEqual([
          {
            day: "2026-10-30",
            startMs: Date.parse("2026-10-30T04:00:00.000Z"),
            endMs: Date.parse("2026-10-31T04:00:00.000Z"),
          },
          {
            day: "2026-10-31",
            startMs: Date.parse("2026-10-31T04:00:00.000Z"),
            endMs: Date.parse("2026-11-01T04:00:00.000Z"),
          },
          {
            day: "2026-11-01",
            startMs: Date.parse("2026-11-01T04:00:00.000Z"),
            endMs: Date.parse("2026-11-02T05:00:00.000Z"),
          },
          {
            day: "2026-11-02",
            startMs: Date.parse("2026-11-02T05:00:00.000Z"),
            endMs: Date.parse("2026-11-03T05:00:00.000Z"),
          },
          {
            day: "2026-11-03",
            startMs: Date.parse("2026-11-03T05:00:00.000Z"),
            endMs: Date.parse("2026-11-04T05:00:00.000Z"),
          },
        ]);

        const metrics: SecurityOverviewMetrics = overviewOf({
          now: "2026-11-15T15:00:00.000Z",
          windowDays: 30,
          cases: [
            "2026-11-01T04:00:00.000Z",
            "2026-11-02T04:30:00.000Z",
            "2026-11-02T05:00:00.000Z",
          ],
          timezone: Timezone.AmericaNew_York,
        });

        expect(countedDays(metrics.casesOpenedPerDay)).toEqual({
          "2026-11-01": 2,
          "2026-11-02": 1,
        });
      });

      test("the last bar is the reader's today, not UTC's", () => {
        // 22:00 on 4 November in New York; already the 5th in UTC.
        const metrics: SecurityOverviewMetrics = overviewOf({
          now: "2026-11-05T03:00:00.000Z",
          windowDays: 30,
          cases: ["2026-11-05T02:30:00.000Z"],
          timezone: Timezone.AmericaNew_York,
        });
        const days: Array<string> = dayNames(metrics.casesOpenedPerDay);

        expect(days[days.length - 1]).toBe("2026-11-04");
        expect(countedDays(metrics.casesOpenedPerDay)).toEqual({
          "2026-11-04": 1,
        });
      });
    });

    describe.each(
      READERS.map((reader: ReaderCase): [string, ReaderCase] => {
        return [reader.name, reader];
      }),
    )("a reader in %s", (_name: string, reader: ReaderCase) => {
      test("each instant counts on the reader's own day", () => {
        for (const [instant, day] of reader.instants) {
          // The platform's clock agrees with the expected day.
          expect(platformDay(Date.parse(instant), reader.timezone)).toBe(day);
          expect(dayInTimezone(new Date(instant), reader.timezone)).toBe(day);
        }

        const metrics: SecurityOverviewMetrics = overviewOf({
          now: reader.now,
          windowDays: reader.windowDays,
          cases: reader.instants.map(([instant]: [string, string]) => {
            return instant;
          }),
          detections: reader.instants.map(([instant]: [string, string]) => {
            return instant;
          }),
          timezone: reader.timezone,
        });
        const expected: Record<string, number> = {};

        for (const [, day] of reader.instants) {
          expected[day] = (expected[day] || 0) + 1;
        }

        expect(countedDays(metrics.casesOpenedPerDay)).toEqual(expected);
        expect(countedDays(metrics.detectionsPerDay)).toEqual(expected);
      });

      test("the bars are the reader's dates, one a day from the window's first to today", () => {
        const metrics: SecurityOverviewMetrics = overviewOf({
          now: reader.now,
          windowDays: reader.windowDays,
          timezone: reader.timezone,
        });
        const nowMs: number = Date.parse(reader.now);

        expect(dayNames(metrics.casesOpenedPerDay)).toEqual(
          datesFrom(
            platformDay(nowMs - reader.windowDays * DAY, reader.timezone),
            platformDay(nowMs, reader.timezone),
          ),
        );
      });

      test("each day starts where the one before it ends, at the reader's midnight", () => {
        const nowMs: number = Date.parse(reader.now);
        const days: Array<CalendarDay> = calendarDaysBetween(
          new Date(nowMs - reader.windowDays * DAY),
          new Date(nowMs),
          reader.timezone,
        );

        for (let index: number = 0; index < days.length; index++) {
          const day: CalendarDay = days[index]!;

          expect(platformDay(day.startMs, reader.timezone)).toBe(day.day);
          expect(platformDay(day.endMs - 1, reader.timezone)).toBe(day.day);
          expect(platformDay(day.endMs, reader.timezone)).toBe(
            nextDate(day.day),
          );
          // 23 to 25 hours, 23.5 or 24.5 on Lord Howe Island.
          expect(day.endMs - day.startMs).toBeGreaterThanOrEqual(23 * HOUR);
          expect(day.endMs - day.startMs).toBeLessThanOrEqual(25 * HOUR);

          if (index > 0) {
            expect(day.startMs).toBe(days[index - 1]!.endMs);
          }
        }
      });

      test("every case in the window is on exactly one bar", () => {
        const nowMs: number = Date.parse(reader.now);
        const startMs: number = nowMs - reader.windowDays * DAY;
        const cases: Array<string> = [];

        // A case every 97 minutes, so every hour of the day is hit.
        for (let t: number = startMs; t <= nowMs; t += 97 * 60 * 1000) {
          cases.push(new Date(t).toISOString());
        }

        const metrics: SecurityOverviewMetrics = overviewOf({
          now: reader.now,
          windowDays: reader.windowDays,
          cases: cases,
          timezone: reader.timezone,
        });
        const expected: Record<string, number> = {};

        for (const instant of cases) {
          const day: string = platformDay(Date.parse(instant), reader.timezone);
          expected[day] = (expected[day] || 0) + 1;
        }

        expect(countedDays(metrics.casesOpenedPerDay)).toEqual(expected);
        expect(
          metrics.casesOpenedPerDay.reduce(
            (sum: number, day: DayCount): number => {
              return sum + day.total;
            },
            0,
          ),
        ).toBe(cases.length);
      });
    });

    test("findCalendarDay finds the day dayInTimezone names, for every instant, in every zone", () => {
      // A seeded walk over two years: the same instants on every run.
      const random: SeededRandom = seededRandom(7925);

      for (const reader of READERS) {
        const days: Array<CalendarDay> = calendarDaysBetween(
          new Date("2026-01-01T00:00:00.000Z"),
          new Date("2026-12-31T00:00:00.000Z"),
          reader.timezone,
        );

        expect(days.length).toBeGreaterThanOrEqual(365);
        expect(
          new Set(
            days.map((day: CalendarDay): string => {
              return day.day;
            }),
          ).size,
        ).toBe(days.length);

        for (let sample: number = 0; sample < 400; sample++) {
          const ms: number =
            days[0]!.startMs +
            Math.floor(
              random() * (days[days.length - 1]!.endMs - days[0]!.startMs),
            );

          expect(findCalendarDay(days, new Date(ms))?.day).toBe(
            platformDay(ms, reader.timezone),
          );
        }

        expect(
          findCalendarDay(days, new Date(days[0]!.startMs - 1)),
        ).toBeUndefined();
        expect(
          findCalendarDay(days, new Date(days[days.length - 1]!.endMs)),
        ).toBeUndefined();
      }
    });

    test("with no zone, the days are UTC's, exactly as before", () => {
      expect(
        daysBetween(
          new Date("2026-10-12T23:00:00Z"),
          new Date("2026-10-14T01:00:00Z"),
        ),
      ).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
      expect(dayInTimezone(new Date("2026-11-05T01:00:00.000Z"))).toBe(
        utcDay(new Date("2026-11-05T01:00:00.000Z")),
      );
      expect(
        daysBetween(
          new Date("2026-10-12T23:00:00Z"),
          new Date("2026-10-14T01:00:00Z"),
          Timezone.UTC,
        ),
      ).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
    });

    test("a legacy name is the zone it stands for", () => {
      expect(
        daysBetween(
          new Date("2026-11-01T12:00:00.000Z"),
          new Date("2026-11-03T12:00:00.000Z"),
          Timezone.USPacificNew,
        ),
      ).toEqual(
        daysBetween(
          new Date("2026-11-01T12:00:00.000Z"),
          new Date("2026-11-03T12:00:00.000Z"),
          Timezone.AmericaLos_Angeles,
        ),
      );
      expect(
        dayInTimezone(
          new Date("2026-11-02T07:30:00.000Z"),
          Timezone.USPacificNew,
        ),
      ).toBe("2026-11-01");
    });

    test("a window inside one day is that day; one that ends at a midnight holds the day starting there", () => {
      expect(
        daysBetween(
          new Date("2026-11-04T05:00:00.000Z"),
          new Date("2026-11-04T05:00:00.000Z"),
          Timezone.AmericaNew_York,
        ),
      ).toEqual(["2026-11-04"]);
      // A window ending on a midnight holds the day that starts there.
      expect(
        daysBetween(
          new Date("2026-11-03T12:00:00.000Z"),
          new Date("2026-11-05T05:00:00.000Z"),
          Timezone.AmericaNew_York,
        ),
      ).toEqual(["2026-11-03", "2026-11-04", "2026-11-05"]);
    });

    test("each bar is labelled with the date it counts, whatever zone the process is in", () => {
      expect(formatDayLabel("2026-11-04")).toBe("Nov 4");
      expect(formatDayLabel("2026-11-01")).toBe("Nov 1");
      expect(formatDayLabel("2026-03-08")).toBe("Mar 8");
      expect(formatDayLabel("2026-09-06")).toBe("Sep 6");
    });
  });
}
