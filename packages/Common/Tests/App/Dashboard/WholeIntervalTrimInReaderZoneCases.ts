import {
  DATABASE_QUERY_INGEST_GRACE_MS,
  DatabaseTimePoint,
  getCompleteBucketSeries,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries";
import {
  MessageQueueTimePoint,
  getCompleteMessageQueueCountSeries,
  getMessageQueueCountSettleMs,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import { getMetricRowPoints } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsViewer";
import { SparklinePoint } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/SparklinePoint";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import {
  MessageQueueMetricDescriptor,
  getMessageQueueMetricDescriptorsByName,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import Timezone from "../../../Types/Timezone";
import TimezoneAlias from "../../../Types/TimezoneAlias";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * THE WHOLE-INTERVAL TRIMS ON THE READER'S CALENDAR (issue #7924).
 *
 * Three charts draw a count per interval and leave out the intervals that
 * have not closed: the Database overview's "Queries from applications"
 * (getCompleteBucketSeries), the Message Queue pages' per-period counts
 * (getCompleteMessageQueueCountSeries) and the Metrics list's summed and
 * counted rows (getMetricRowPoints). Their reads go out through
 * AnalyticsModelAPI.aggregate, which asks for day, week, month and year
 * buckets in the reader's zone (issue #7277), so each of those intervals
 * closes at the reader's next midnight, Monday, 1st or 1 January: after 23
 * or 25 hours across a clock change (24.5 on Lord Howe Island), after 28 to
 * 31 days for a month. They judged it by a fixed 24 hours, 7 days, 30 days
 * or 365 days instead.
 *
 * Each case is one interval as the server starts it for that reader (the
 * instants are Python zoneinfo's), and the one before it, which has closed.
 * At the last moment before the interval's real end (plus the half-minute
 * ingest grace, and a late source's settle time) it is still open and left
 * out; at that moment it is whole and kept. The cases run with the process
 * in several zones (the @timezone docblock of each file calling this), which
 * must not move them.
 */

interface TrimCase {
  name: string;
  reader: Timezone;
  interval: AggregationInterval;
  // How long a window over it is, so the window buckets by `interval`.
  windowDays: number;
  previousStart: string;
  start: string;
  end: string;
}

const CASES: ReadonlyArray<TrimCase> = [
  {
    name: "New York's 25-hour 1 November",
    reader: Timezone.AmericaNew_York,
    interval: AggregationInterval.Day,
    windowDays: 30,
    previousStart: "2026-10-31T04:00:00.000Z",
    start: "2026-11-01T04:00:00.000Z",
    end: "2026-11-02T05:00:00.000Z",
  },
  {
    name: "New York's 23-hour 8 March",
    reader: Timezone.AmericaNew_York,
    interval: AggregationInterval.Day,
    windowDays: 30,
    previousStart: "2026-03-07T05:00:00.000Z",
    start: "2026-03-08T05:00:00.000Z",
    end: "2026-03-09T04:00:00.000Z",
  },
  {
    name: "London's 25-hour 25 October",
    reader: Timezone.EuropeLondon,
    interval: AggregationInterval.Day,
    windowDays: 30,
    previousStart: "2026-10-23T23:00:00.000Z",
    start: "2026-10-24T23:00:00.000Z",
    end: "2026-10-26T00:00:00.000Z",
  },
  {
    name: "London's 23-hour 29 March",
    reader: Timezone.EuropeLondon,
    interval: AggregationInterval.Day,
    windowDays: 30,
    previousStart: "2026-03-28T00:00:00.000Z",
    start: "2026-03-29T00:00:00.000Z",
    end: "2026-03-29T23:00:00.000Z",
  },
  {
    name: "Auckland's 25-hour 5 April",
    reader: Timezone.PacificAuckland,
    interval: AggregationInterval.Day,
    windowDays: 30,
    previousStart: "2026-04-03T11:00:00.000Z",
    start: "2026-04-04T11:00:00.000Z",
    end: "2026-04-05T12:00:00.000Z",
  },
  {
    name: "Auckland's 23-hour 27 September",
    reader: Timezone.PacificAuckland,
    interval: AggregationInterval.Day,
    windowDays: 30,
    previousStart: "2026-09-25T12:00:00.000Z",
    start: "2026-09-26T12:00:00.000Z",
    end: "2026-09-27T11:00:00.000Z",
  },
  {
    name: "Lord Howe's 24.5-hour 5 April",
    reader: Timezone.AustraliaLord_Howe,
    interval: AggregationInterval.Day,
    windowDays: 30,
    previousStart: "2026-04-03T13:00:00.000Z",
    start: "2026-04-04T13:00:00.000Z",
    end: "2026-04-05T13:30:00.000Z",
  },
  {
    name: "a Kolkata day, from half past a UTC hour",
    reader: Timezone.AsiaKolkata,
    interval: AggregationInterval.Day,
    windowDays: 30,
    previousStart: "2026-11-03T18:30:00.000Z",
    start: "2026-11-04T18:30:00.000Z",
    end: "2026-11-05T18:30:00.000Z",
  },
  {
    name: "a Kathmandu day, from a quarter past a UTC hour",
    reader: Timezone.AsiaKathmandu,
    interval: AggregationInterval.Day,
    windowDays: 30,
    previousStart: "2026-11-03T18:15:00.000Z",
    start: "2026-11-04T18:15:00.000Z",
    end: "2026-11-05T18:15:00.000Z",
  },
  {
    name: "New York's 169-hour week over the November change",
    reader: Timezone.AmericaNew_York,
    interval: AggregationInterval.Week,
    windowDays: 60,
    previousStart: "2026-10-19T04:00:00.000Z",
    start: "2026-10-26T04:00:00.000Z",
    end: "2026-11-02T05:00:00.000Z",
  },
  {
    name: "London's 169-hour week over the October change",
    reader: Timezone.EuropeLondon,
    interval: AggregationInterval.Week,
    windowDays: 60,
    previousStart: "2026-10-11T23:00:00.000Z",
    start: "2026-10-18T23:00:00.000Z",
    end: "2026-10-26T00:00:00.000Z",
  },
  {
    name: "a Kolkata week",
    reader: Timezone.AsiaKolkata,
    interval: AggregationInterval.Week,
    windowDays: 60,
    previousStart: "2026-10-25T18:30:00.000Z",
    start: "2026-11-01T18:30:00.000Z",
    end: "2026-11-08T18:30:00.000Z",
  },
  {
    name: "a Kathmandu week",
    reader: Timezone.AsiaKathmandu,
    interval: AggregationInterval.Week,
    windowDays: 60,
    previousStart: "2026-10-25T18:15:00.000Z",
    start: "2026-11-01T18:15:00.000Z",
    end: "2026-11-08T18:15:00.000Z",
  },
  {
    name: "New York's 28-day February",
    reader: Timezone.AmericaNew_York,
    interval: AggregationInterval.Month,
    windowDays: 300,
    previousStart: "2026-01-01T05:00:00.000Z",
    start: "2026-02-01T05:00:00.000Z",
    end: "2026-03-01T05:00:00.000Z",
  },
  {
    name: "Kolkata's 31-day October",
    reader: Timezone.AsiaKolkata,
    interval: AggregationInterval.Month,
    windowDays: 300,
    previousStart: "2026-08-31T18:30:00.000Z",
    start: "2026-09-30T18:30:00.000Z",
    end: "2026-10-31T18:30:00.000Z",
  },
  {
    name: "Kathmandu's 31-day October",
    reader: Timezone.AsiaKathmandu,
    interval: AggregationInterval.Month,
    windowDays: 300,
    previousStart: "2026-08-31T18:15:00.000Z",
    start: "2026-09-30T18:15:00.000Z",
    end: "2026-10-31T18:15:00.000Z",
  },
  {
    name: "Auckland's September, an hour short of 30 days",
    reader: Timezone.PacificAuckland,
    interval: AggregationInterval.Month,
    windowDays: 300,
    previousStart: "2026-07-31T12:00:00.000Z",
    start: "2026-08-31T12:00:00.000Z",
    end: "2026-09-30T11:00:00.000Z",
  },
  {
    name: "UTC's 366-day 2028",
    reader: Timezone.UTC,
    interval: AggregationInterval.Year,
    windowDays: 7 * 365,
    previousStart: "2027-01-01T00:00:00.000Z",
    start: "2028-01-01T00:00:00.000Z",
    end: "2029-01-01T00:00:00.000Z",
  },
  {
    name: "Kathmandu's 2027",
    reader: Timezone.AsiaKathmandu,
    interval: AggregationInterval.Year,
    windowDays: 7 * 365,
    previousStart: "2025-12-31T18:15:00.000Z",
    start: "2026-12-31T18:15:00.000Z",
    end: "2027-12-31T18:15:00.000Z",
  },
];

const DAY_MS: number = 24 * 60 * 60 * 1000;

function windowEndingAt(
  now: number,
  item: TrimCase,
): { start: Date; end: Date } {
  return {
    start: new Date(now - item.windowDays * DAY_MS),
    end: new Date(now),
  };
}

// A late source's count: its intervals are whole only once it delivered.
function sqsSent(): MessageQueueMetricDescriptor {
  const descriptor: MessageQueueMetricDescriptor | undefined =
    getMessageQueueMetricDescriptorsByName(
      "amazonaws.com/aws/sqs/numberofmessagessent",
    ).find((candidate: MessageQueueMetricDescriptor): boolean => {
      return candidate.system === "aws_sqs";
    });

  if (!descriptor) {
    throw new Error("The SQS sent count is not in the catalog");
  }

  return descriptor;
}

export default function describeWholeIntervalTrims(
  processTimezone: string,
): void {
  describe(`the whole-interval trims on the reader's calendar, with the process in ${processTimezone}`, () => {
    afterEach(() => {
      OneUptimeDate.setUserTimezone(null);
    });

    test("the process runs in the zone its file names", () => {
      expect(process.env["TZ"]).toBe(processTimezone);
      // ICU spells some zones the old way (Asia/Calcutta, Asia/Katmandu).
      expect(
        TimezoneAlias.getCanonicalTimezone(
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
      ).toBe(processTimezone);
    });

    test.each(
      CASES.map((item: TrimCase): [string, TrimCase] => {
        return [item.name, item];
      }),
    )(
      "%s: the window buckets by it, and the server starts it there for this reader",
      (_name: string, item: TrimCase) => {
        OneUptimeDate.setUserTimezone(item.reader);
        const window: { start: Date; end: Date } = windowEndingAt(
          Date.parse(item.end),
          item,
        );

        expect(
          AggregationIntervalUtil.getAggregationIntervalForWindow({
            startDate: window.start,
            endDate: window.end,
          }),
        ).toBe(item.interval);
        // The zone the read carried (AnalyticsModelAPI.aggregate).
        expect(
          AggregationIntervalUtil.getReaderTimezone({
            startDate: window.start,
            endDate: window.end,
          }),
        ).toBe(item.reader);
        expect(window.start.getTime()).toBeLessThan(
          Date.parse(item.previousStart),
        );
      },
    );

    describe("the Database overview's query counts (getCompleteBucketSeries)", () => {
      function keptAt(now: number, item: TrimCase): Array<string> {
        return getCompleteBucketSeries(
          [
            { x: new Date(item.previousStart), y: 60 },
            { x: new Date(item.start), y: 60 },
          ],
          windowEndingAt(now, item),
          now,
        ).map((point: DatabaseTimePoint): string => {
          return point.x.toISOString();
        });
      }

      test.each(
        CASES.map((item: TrimCase): [string, TrimCase] => {
          return [item.name, item];
        }),
      )(
        "%s is left out until it has closed, and kept once it has",
        (_name: string, item: TrimCase) => {
          OneUptimeDate.setUserTimezone(item.reader);
          const closed: number =
            Date.parse(item.end) + DATABASE_QUERY_INGEST_GRACE_MS;

          expect(keptAt(closed - 1, item)).toEqual([item.previousStart]);
          expect(keptAt(closed, item)).toEqual([
            item.previousStart,
            item.start,
          ]);
        },
      );
    });

    describe("the Message Queue pages' per-period counts (getCompleteMessageQueueCountSeries)", () => {
      function keptAt(now: number, item: TrimCase): Array<string> {
        return getCompleteMessageQueueCountSeries(
          [
            { x: new Date(item.previousStart), y: 40 },
            { x: new Date(item.start), y: 40 },
          ],
          sqsSent(),
          windowEndingAt(now, item),
          now,
        ).map((point: MessageQueueTimePoint): string => {
          return point.x.toISOString();
        });
      }

      test.each(
        CASES.map((item: TrimCase): [string, TrimCase] => {
          return [item.name, item];
        }),
      )(
        "%s waits for its source after it closed, then is kept",
        (_name: string, item: TrimCase) => {
          OneUptimeDate.setUserTimezone(item.reader);
          const settleMs: number = getMessageQueueCountSettleMs(
            sqsSent(),
            windowEndingAt(Date.parse(item.end), item),
          );
          const whole: number =
            Date.parse(item.end) + settleMs + DATABASE_QUERY_INGEST_GRACE_MS;

          // CloudWatch's late delivery is waited for over every interval.
          expect(settleMs).toBeGreaterThan(0);
          expect(keptAt(whole - 1, item)).toEqual([item.previousStart]);
          expect(keptAt(whole, item)).toEqual([item.previousStart, item.start]);
        },
      );
    });

    describe("the Metrics list's summed and counted rows (getMetricRowPoints)", () => {
      function keptAt(
        now: number,
        item: TrimCase,
        aggregationType: MetricsAggregationType,
      ): Array<string> {
        const window: { start: Date; end: Date } = windowEndingAt(now, item);

        return getMetricRowPoints({
          points: [
            { time: item.previousStart, value: 7 },
            { time: item.start, value: 7 },
          ],
          aggregationType: aggregationType,
          startAndEndDate: new InBetween<Date>(window.start, window.end),
          now: now,
        }).map((point: SparklinePoint): string => {
          return point.time;
        });
      }

      test.each(
        CASES.flatMap(
          (
            item: TrimCase,
          ): Array<[string, MetricsAggregationType, TrimCase]> => {
            return [
              MetricsAggregationType.Sum,
              MetricsAggregationType.Count,
            ].map(
              (
                aggregationType: MetricsAggregationType,
              ): [string, MetricsAggregationType, TrimCase] => {
                return [item.name, aggregationType, item];
              },
            );
          },
        ),
      )(
        "%s, read as %s, is left out until it has closed, and kept once it has",
        (
          _name: string,
          aggregationType: MetricsAggregationType,
          item: TrimCase,
        ) => {
          OneUptimeDate.setUserTimezone(item.reader);
          const closed: number =
            Date.parse(item.end) + DATABASE_QUERY_INGEST_GRACE_MS;

          expect(keptAt(closed - 1, item, aggregationType)).toEqual([
            item.previousStart,
          ]);
          expect(keptAt(closed, item, aggregationType)).toEqual([
            item.previousStart,
            item.start,
          ]);
        },
      );

      test("an average keeps every interval, closed or not, as it always did", () => {
        const item: TrimCase = CASES[0]!;
        OneUptimeDate.setUserTimezone(item.reader);
        const now: number = Date.parse(item.start) + 60 * 60 * 1000;

        expect(keptAt(now, item, MetricsAggregationType.Avg)).toEqual([
          item.previousStart,
          item.start,
        ]);
      });
    });

    test("a reader whose zone the list does not name has UTC's days, as their read had", () => {
      // The browser reported a zone the list does not name: the read had none.
      OneUptimeDate.setUserTimezone(null);
      const original: () => Timezone = OneUptimeDate.getCurrentTimezone;
      OneUptimeDate.getCurrentTimezone = (): Timezone => {
        return "Mars/Olympus_Mons" as Timezone;
      };

      try {
        const now: number =
          Date.parse("2026-11-06T00:00:00.000Z") +
          DATABASE_QUERY_INGEST_GRACE_MS;
        const kept: Array<string> = getCompleteBucketSeries(
          [
            { x: new Date("2026-11-04T00:00:00.000Z"), y: 1 },
            { x: new Date("2026-11-05T00:00:00.000Z"), y: 1 },
          ],
          { start: new Date(now - 30 * DAY_MS), end: new Date(now) },
          now,
        ).map((point: DatabaseTimePoint): string => {
          return point.x.toISOString();
        });

        expect(kept).toEqual([
          "2026-11-04T00:00:00.000Z",
          "2026-11-05T00:00:00.000Z",
        ]);
        expect(
          getCompleteBucketSeries(
            [
              { x: new Date("2026-11-04T00:00:00.000Z"), y: 1 },
              { x: new Date("2026-11-05T00:00:00.000Z"), y: 1 },
            ],
            { start: new Date(now - 30 * DAY_MS), end: new Date(now - 1) },
            now - 1,
          ).map((point: DatabaseTimePoint): string => {
            return point.x.toISOString();
          }),
        ).toEqual(["2026-11-04T00:00:00.000Z"]);
      } finally {
        OneUptimeDate.getCurrentTimezone = original;
      }
    });
  });
}
