import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import Timezone from "../../../Types/Timezone";
import TimezoneAlias from "../../../Types/TimezoneAlias";
import { describe, expect, test } from "@jest/globals";

/*
 * WHERE A BUCKET ENDS (AggregationIntervalUtil.getBucketEnd, issue #7924).
 *
 * A bucket of the aggregate API ends where the next one starts. An hour and
 * shorter are a fixed length of time. A day, a week, a month and a year are
 * units of the calendar of the zone the request asked its buckets to follow
 * (AggregateBy.timezone, the reader's since issue #7277; UTC when it named
 * none), so their length is the calendar's: a day is 23 or 25 hours where
 * the clocks change, 23.5 or 24.5 on Lord Howe Island, a month 28 to 31
 * days, a year 365 or 366 - never the nominal 24 hours, 30 days or 365 days
 * that getAggregationIntervalMs gives, which the whole-interval trims judged
 * them by.
 *
 * Every instant below is the start of a local day, week, month or year as
 * Python's zoneinfo has it, not as the code under test works it out. The
 * cases run in several process zones (the @timezone docblock of each file
 * that calls this, through Tests/Utils/TimezoneEnvironment.js, sets TZ), and
 * only the zone the bucket was cut in may move them.
 */

interface BucketCase {
  name: string;
  timezone: Timezone;
  start: string;
  end: string;
}

// A day in each zone, around each of its clock changes in 2026.
const DAYS: ReadonlyArray<BucketCase> = [
  {
    name: "a New York day before the spring change: 24 hours",
    timezone: Timezone.AmericaNew_York,
    start: "2026-03-07T05:00:00.000Z",
    end: "2026-03-08T05:00:00.000Z",
  },
  {
    name: "New York's 8 March, the clocks forward: 23 hours",
    timezone: Timezone.AmericaNew_York,
    start: "2026-03-08T05:00:00.000Z",
    end: "2026-03-09T04:00:00.000Z",
  },
  {
    name: "New York's 9 March, in summer time: 24 hours",
    timezone: Timezone.AmericaNew_York,
    start: "2026-03-09T04:00:00.000Z",
    end: "2026-03-10T04:00:00.000Z",
  },
  {
    name: "New York's 1 November, the clocks back: 25 hours",
    timezone: Timezone.AmericaNew_York,
    start: "2026-11-01T04:00:00.000Z",
    end: "2026-11-02T05:00:00.000Z",
  },
  {
    name: "New York's 5 November: 24 hours, from 05:00 UTC",
    timezone: Timezone.AmericaNew_York,
    start: "2026-11-05T05:00:00.000Z",
    end: "2026-11-06T05:00:00.000Z",
  },
  {
    name: "London's 29 March, the clocks forward: 23 hours",
    timezone: Timezone.EuropeLondon,
    start: "2026-03-29T00:00:00.000Z",
    end: "2026-03-29T23:00:00.000Z",
  },
  {
    name: "London's 25 October, the clocks back: 25 hours",
    timezone: Timezone.EuropeLondon,
    start: "2026-10-24T23:00:00.000Z",
    end: "2026-10-26T00:00:00.000Z",
  },
  {
    name: "Auckland's 5 April, the clocks back: 25 hours",
    timezone: Timezone.PacificAuckland,
    start: "2026-04-04T11:00:00.000Z",
    end: "2026-04-05T12:00:00.000Z",
  },
  {
    name: "Auckland's 27 September, the clocks forward: 23 hours",
    timezone: Timezone.PacificAuckland,
    start: "2026-09-26T12:00:00.000Z",
    end: "2026-09-27T11:00:00.000Z",
  },
  {
    name: "a Kolkata day, half past a UTC hour",
    timezone: Timezone.AsiaKolkata,
    start: "2026-11-04T18:30:00.000Z",
    end: "2026-11-05T18:30:00.000Z",
  },
  {
    name: "a Kathmandu day, a quarter past a UTC hour",
    timezone: Timezone.AsiaKathmandu,
    start: "2026-11-04T18:15:00.000Z",
    end: "2026-11-05T18:15:00.000Z",
  },
  {
    name: "Lord Howe's 5 April, the clocks back half an hour: 24.5 hours",
    timezone: Timezone.AustraliaLord_Howe,
    start: "2026-04-04T13:00:00.000Z",
    end: "2026-04-05T13:30:00.000Z",
  },
  {
    name: "Lord Howe's 4 October, the clocks forward half an hour: 23.5 hours",
    timezone: Timezone.AustraliaLord_Howe,
    start: "2026-10-03T13:30:00.000Z",
    end: "2026-10-04T13:00:00.000Z",
  },
  {
    name: "Santiago's 4 April, its midnight repeated: 25 hours",
    timezone: Timezone.AmericaSantiago,
    start: "2026-04-04T03:00:00.000Z",
    end: "2026-04-05T04:00:00.000Z",
  },
  {
    name: "Santiago's 6 September, whose midnight never comes: 23 hours from 01:00",
    timezone: Timezone.AmericaSantiago,
    start: "2026-09-06T04:00:00.000Z",
    end: "2026-09-07T03:00:00.000Z",
  },
  {
    name: "a Tokyo day",
    timezone: Timezone.AsiaTokyo,
    start: "2026-11-04T15:00:00.000Z",
    end: "2026-11-05T15:00:00.000Z",
  },
  {
    name: "a UTC day",
    timezone: Timezone.UTC,
    start: "2026-11-05T00:00:00.000Z",
    end: "2026-11-06T00:00:00.000Z",
  },
];

// A week, from Monday's midnight to the next Monday's.
const WEEKS: ReadonlyArray<BucketCase> = [
  {
    name: "New York's week over the November change: 169 hours",
    timezone: Timezone.AmericaNew_York,
    start: "2026-10-26T04:00:00.000Z",
    end: "2026-11-02T05:00:00.000Z",
  },
  {
    name: "New York's week over the March change: 167 hours",
    timezone: Timezone.AmericaNew_York,
    start: "2026-03-02T05:00:00.000Z",
    end: "2026-03-09T04:00:00.000Z",
  },
  {
    name: "London's week over the October change: 169 hours",
    timezone: Timezone.EuropeLondon,
    start: "2026-10-18T23:00:00.000Z",
    end: "2026-10-26T00:00:00.000Z",
  },
  {
    name: "London's week over the March change: 167 hours",
    timezone: Timezone.EuropeLondon,
    start: "2026-03-23T00:00:00.000Z",
    end: "2026-03-29T23:00:00.000Z",
  },
  {
    name: "Auckland's week over the April change: 169 hours",
    timezone: Timezone.PacificAuckland,
    start: "2026-03-29T11:00:00.000Z",
    end: "2026-04-05T12:00:00.000Z",
  },
  {
    name: "a Kolkata week",
    timezone: Timezone.AsiaKolkata,
    start: "2026-11-01T18:30:00.000Z",
    end: "2026-11-08T18:30:00.000Z",
  },
  {
    name: "a Kathmandu week",
    timezone: Timezone.AsiaKathmandu,
    start: "2026-11-01T18:15:00.000Z",
    end: "2026-11-08T18:15:00.000Z",
  },
];

// A month, from its 1st to the next 1st.
const MONTHS: ReadonlyArray<BucketCase> = [
  {
    name: "UTC's January: 31 days",
    timezone: Timezone.UTC,
    start: "2026-01-01T00:00:00.000Z",
    end: "2026-02-01T00:00:00.000Z",
  },
  {
    name: "UTC's February 2026: 28 days",
    timezone: Timezone.UTC,
    start: "2026-02-01T00:00:00.000Z",
    end: "2026-03-01T00:00:00.000Z",
  },
  {
    name: "UTC's February 2028, a leap year: 29 days",
    timezone: Timezone.UTC,
    start: "2028-02-01T00:00:00.000Z",
    end: "2028-03-01T00:00:00.000Z",
  },
  {
    name: "UTC's April: 30 days",
    timezone: Timezone.UTC,
    start: "2026-04-01T00:00:00.000Z",
    end: "2026-05-01T00:00:00.000Z",
  },
  {
    name: "UTC's October: 31 days",
    timezone: Timezone.UTC,
    start: "2026-10-01T00:00:00.000Z",
    end: "2026-11-01T00:00:00.000Z",
  },
  {
    name: "New York's March: 31 days less the hour the clocks skip",
    timezone: Timezone.AmericaNew_York,
    start: "2026-03-01T05:00:00.000Z",
    end: "2026-04-01T04:00:00.000Z",
  },
  {
    name: "New York's November: 30 days and the hour the clocks repeat",
    timezone: Timezone.AmericaNew_York,
    start: "2026-11-01T04:00:00.000Z",
    end: "2026-12-01T05:00:00.000Z",
  },
  {
    name: "London's October: 31 days and an hour",
    timezone: Timezone.EuropeLondon,
    start: "2026-09-30T23:00:00.000Z",
    end: "2026-11-01T00:00:00.000Z",
  },
  {
    name: "Auckland's September: 30 days less an hour",
    timezone: Timezone.PacificAuckland,
    start: "2026-08-31T12:00:00.000Z",
    end: "2026-09-30T11:00:00.000Z",
  },
  {
    name: "Kolkata's February 2028, a leap year",
    timezone: Timezone.AsiaKolkata,
    start: "2028-01-31T18:30:00.000Z",
    end: "2028-02-29T18:30:00.000Z",
  },
  {
    name: "Kathmandu's October",
    timezone: Timezone.AsiaKathmandu,
    start: "2026-09-30T18:15:00.000Z",
    end: "2026-10-31T18:15:00.000Z",
  },
];

// A year, from 1 January to the next 1 January.
const YEARS: ReadonlyArray<BucketCase> = [
  {
    name: "UTC's 2027: 365 days",
    timezone: Timezone.UTC,
    start: "2027-01-01T00:00:00.000Z",
    end: "2028-01-01T00:00:00.000Z",
  },
  {
    name: "UTC's 2028, a leap year: 366 days",
    timezone: Timezone.UTC,
    start: "2028-01-01T00:00:00.000Z",
    end: "2029-01-01T00:00:00.000Z",
  },
  {
    name: "New York's 2028",
    timezone: Timezone.AmericaNew_York,
    start: "2028-01-01T05:00:00.000Z",
    end: "2029-01-01T05:00:00.000Z",
  },
  {
    name: "Kolkata's 2027",
    timezone: Timezone.AsiaKolkata,
    start: "2026-12-31T18:30:00.000Z",
    end: "2027-12-31T18:30:00.000Z",
  },
  {
    name: "Kathmandu's 2028",
    timezone: Timezone.AsiaKathmandu,
    start: "2027-12-31T18:15:00.000Z",
    end: "2028-12-31T18:15:00.000Z",
  },
];

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

function endOf(
  bucketStart: string,
  interval: AggregationInterval,
  timezone?: Timezone | undefined,
): string {
  return AggregationIntervalUtil.getBucketEnd({
    bucketStart: new Date(bucketStart),
    interval: interval,
    timezone: timezone,
  }).toISOString();
}

export default function describeBucketEnds(processTimezone: string): void {
  describe(`AggregationIntervalUtil.getBucketEnd, with the process in ${processTimezone}`, () => {
    test("the process runs in the zone its file names", () => {
      expect(process.env["TZ"]).toBe(processTimezone);
      // ICU spells some zones the old way (Asia/Calcutta, Asia/Katmandu).
      expect(
        TimezoneAlias.getCanonicalTimezone(
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
      ).toBe(processTimezone);
    });

    describe.each([
      ["day", AggregationInterval.Day, DAYS],
      ["week", AggregationInterval.Week, WEEKS],
      ["month", AggregationInterval.Month, MONTHS],
      ["year", AggregationInterval.Year, YEARS],
    ] as Array<[string, AggregationInterval, ReadonlyArray<BucketCase>]>)(
      "a %s ends where the next one starts in its zone",
      (
        _unit: string,
        interval: AggregationInterval,
        cases: ReadonlyArray<BucketCase>,
      ) => {
        test.each(
          cases.map((item: BucketCase) => {
            return [item.name, item];
          }),
        )("%s", (_name: string, item: BucketCase) => {
          expect(endOf(item.start, interval, item.timezone)).toBe(item.end);
        });

        test.each(
          cases.map((item: BucketCase) => {
            return [item.name, item];
          }),
        )(
          "%s, asked from inside it: the end of the unit holding it",
          (_name: string, item: BucketCase) => {
            const inside: string = new Date(
              (Date.parse(item.start) + Date.parse(item.end)) / 2,
            ).toISOString();
            const lastMillisecond: string = new Date(
              Date.parse(item.end) - 1,
            ).toISOString();

            expect(endOf(inside, interval, item.timezone)).toBe(item.end);
            expect(endOf(lastMillisecond, interval, item.timezone)).toBe(
              item.end,
            );
          },
        );

        test.each(
          cases.map((item: BucketCase) => {
            return [item.name, item];
          }),
        )(
          "%s, and the next one starts there",
          (_name: string, item: BucketCase) => {
            const next: string = endOf(item.end, interval, item.timezone);

            expect(Date.parse(next)).toBeGreaterThan(Date.parse(item.end));
            expect(endOf(item.end, interval, item.timezone)).toBe(next);
          },
        );
      },
    );

    test("the fixed widths the trims used are wrong on every case of a changing length", () => {
      const nominal: Record<string, number> = {
        [AggregationInterval.Day]: 24 * HOUR,
        [AggregationInterval.Week]: 7 * 24 * HOUR,
        [AggregationInterval.Month]: 30 * 24 * HOUR,
        [AggregationInterval.Year]: 365 * 24 * HOUR,
      };
      let differ: number = 0;

      for (const [interval, cases] of [
        [AggregationInterval.Day, DAYS],
        [AggregationInterval.Week, WEEKS],
        [AggregationInterval.Month, MONTHS],
        [AggregationInterval.Year, YEARS],
      ] as Array<[AggregationInterval, ReadonlyArray<BucketCase>]>) {
        for (const item of cases) {
          const length: number = Date.parse(item.end) - Date.parse(item.start);

          if (length !== nominal[interval]) {
            differ++;
            expect(endOf(item.start, interval, item.timezone)).not.toBe(
              new Date(
                Date.parse(item.start) + nominal[interval]!,
              ).toISOString(),
            );
          }
        }
      }

      // The clock changes, the 28-, 29- and 31-day months and the leap year.
      expect(differ).toBeGreaterThanOrEqual(25);
    });

    test("with no zone, a bucket is UTC's, as the server cuts a request that names none", () => {
      expect(endOf("2026-11-05T00:00:00.000Z", AggregationInterval.Day)).toBe(
        "2026-11-06T00:00:00.000Z",
      );
      expect(endOf("2026-11-02T00:00:00.000Z", AggregationInterval.Week)).toBe(
        "2026-11-09T00:00:00.000Z",
      );
      expect(endOf("2028-02-01T00:00:00.000Z", AggregationInterval.Month)).toBe(
        "2028-03-01T00:00:00.000Z",
      );
      expect(endOf("2028-01-01T00:00:00.000Z", AggregationInterval.Year)).toBe(
        "2029-01-01T00:00:00.000Z",
      );
      // A New York midnight read as UTC's: the UTC day it falls in ends.
      expect(endOf("2026-11-05T05:00:00.000Z", AggregationInterval.Day)).toBe(
        "2026-11-06T00:00:00.000Z",
      );
    });

    test("a legacy name is read as the zone it stands for", () => {
      // US/Pacific-New has left tzdata; it is still Los Angeles.
      expect(
        endOf(
          "2026-11-01T07:00:00.000Z",
          AggregationInterval.Day,
          Timezone.USPacificNew,
        ),
      ).toBe(
        endOf(
          "2026-11-01T07:00:00.000Z",
          AggregationInterval.Day,
          Timezone.AmericaLos_Angeles,
        ),
      );
      expect(
        endOf(
          "2026-11-01T07:00:00.000Z",
          AggregationInterval.Day,
          Timezone.AmericaLos_Angeles,
        ),
      ).toBe("2026-11-02T08:00:00.000Z");
      expect(
        endOf(
          "2026-11-04T18:30:00.000Z",
          AggregationInterval.Day,
          Timezone.AsiaCalcutta,
        ),
      ).toBe("2026-11-05T18:30:00.000Z");
    });

    test.each([
      [AggregationInterval.Minute, MINUTE],
      [AggregationInterval.FiveMinutes, 5 * MINUTE],
      [AggregationInterval.FifteenMinutes, 15 * MINUTE],
      [AggregationInterval.ThirtyMinutes, 30 * MINUTE],
      [AggregationInterval.Hour, HOUR],
    ] as Array<[AggregationInterval, number]>)(
      "a %s bucket is its fixed length, in every zone and across a clock change",
      (interval: AggregationInterval, widthMs: number) => {
        for (const start of [
          "2026-11-01T05:30:00.000Z",
          "2026-11-01T06:00:00.000Z",
          "2026-03-29T00:45:00.000Z",
        ]) {
          const expected: string = new Date(
            Date.parse(start) + widthMs,
          ).toISOString();

          for (const timezone of [
            undefined,
            Timezone.UTC,
            Timezone.AmericaNew_York,
            Timezone.EuropeLondon,
            Timezone.AsiaKolkata,
            Timezone.AsiaKathmandu,
          ]) {
            expect(endOf(start, interval, timezone)).toBe(expected);
          }
        }
      },
    );

    test("Total is the one whole-window bucket: its nominal width, never a loop", () => {
      const start: string = "2026-11-05T05:00:00.000Z";

      expect(
        Date.parse(endOf(start, AggregationInterval.Total, Timezone.UTC)) -
          Date.parse(start),
      ).toBe(
        AggregationIntervalUtil.getAggregationIntervalMs(
          AggregationInterval.Total,
        ),
      );
    });

    test("a date that is not one has no end", () => {
      expect(
        AggregationIntervalUtil.getBucketEnd({
          bucketStart: new Date(Number.NaN),
          interval: AggregationInterval.Day,
          timezone: Timezone.AmericaNew_York,
        }).getTime(),
      ).toBeNaN();
    });

    test("each calendar interval names its unit; an hour and shorter, and Total, none", () => {
      expect(
        Object.values(AggregationInterval).map(
          (interval: AggregationInterval) => {
            return [
              interval,
              AggregationIntervalUtil.getCalendarUnit(interval),
            ];
          },
        ),
      ).toEqual([
        [AggregationInterval.Minute, undefined],
        [AggregationInterval.FiveMinutes, undefined],
        [AggregationInterval.FifteenMinutes, undefined],
        [AggregationInterval.ThirtyMinutes, undefined],
        [AggregationInterval.Hour, undefined],
        [AggregationInterval.Day, "day"],
        [AggregationInterval.Week, "week"],
        [AggregationInterval.Month, "month"],
        [AggregationInterval.Year, "year"],
        [AggregationInterval.Total, undefined],
      ]);

      for (const interval of Object.values(AggregationInterval)) {
        expect(
          AggregationIntervalUtil.getCalendarUnit(interval) !== undefined,
        ).toBe(AggregationIntervalUtil.isCalendarInterval(interval));
      }
    });
  });
}
