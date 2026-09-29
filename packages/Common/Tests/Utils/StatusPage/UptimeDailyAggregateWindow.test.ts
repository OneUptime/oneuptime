/**
 * @timezone America/New_York
 */
/*
 * The process runs in New York so that "the browser's own days" and "UTC
 * days" are different things here, as they are for a visitor west of UTC.
 */
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import {
  UptimeDailyAggregate,
  UptimeDayBucket,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import UptimeDailyAggregateUtil from "../../../Utils/StatusPage/UptimeDailyAggregateUtil";
import DayUptimeGraphUtil, {
  UptimeGraphDay,
} from "../../../Utils/Uptime/DayUptimeGraphUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * The status page draws its uptime strips over the window the SERVER
 * bucketed (UptimeDailyAggregateUtil.getWindow), not over a window the
 * browser works out for itself. Two ways the browser's own window used to
 * leave a bar with no bucket - painted as "no data", the grey bar the whole
 * fix is about:
 *
 *   - The server's window is exactly N x 24 hours (its process runs in UTC).
 *     The browser's OneUptimeDate.getSomeDaysAgoFromDate(now, N) is N
 *     calendar days in the VISITOR's zone - an hour longer or shorter when a
 *     DST change falls inside the window. For an hour each evening that is
 *     enough to put a whole UTC day in front of the first bucket, or to lose
 *     the first bucket.
 *
 *   - The payload is cached for 15 s and refetched every minute. Just after
 *     UTC midnight the browser clock is already on the new day while the
 *     newest bucket is still yesterday's.
 */

const MONITOR_A: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_B: string = "22222222-2222-4222-8222-222222222222";
const STATUS_UP: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const DAY_MS: number = 24 * 60 * 60 * 1000;

function bucket(start: string, end: string): UptimeDayBucket {
  const bucketStart: Date = new Date(start);
  const bucketEnd: Date = new Date(end);
  const seconds: number = (bucketEnd.getTime() - bucketStart.getTime()) / 1000;

  return {
    bucketStart: bucketStart,
    bucketEnd: bucketEnd,
    daySeconds: seconds,
    coveredSeconds: seconds,
    statusDurations: [
      { monitorStatusId: new ObjectID(STATUS_UP), seconds: seconds },
    ],
  };
}

/*
 * The buckets getDailyUptimeAggregate cuts for a window, in UTC: one per UTC
 * calendar day the window touches, the first clipped to the window start and
 * the last clamped to the window end (the server's "now").
 */
function serverUtcBuckets(
  windowStart: Date,
  windowEnd: Date,
): Array<UptimeDayBucket> {
  const buckets: Array<UptimeDayBucket> = [];

  let dayStart: number = Date.UTC(
    windowStart.getUTCFullYear(),
    windowStart.getUTCMonth(),
    windowStart.getUTCDate(),
  );

  while (dayStart < windowEnd.getTime()) {
    const start: number = Math.max(dayStart, windowStart.getTime());
    const end: number = Math.min(dayStart + DAY_MS, windowEnd.getTime());

    if (end > start) {
      buckets.push(
        bucket(new Date(start).toISOString(), new Date(end).toISOString()),
      );
    }

    dayStart += DAY_MS;
  }

  return buckets;
}

function aggregateOf(
  bucketsByMonitor: Array<Array<UptimeDayBucket>>,
): UptimeDailyAggregate {
  const ids: Array<string> = [MONITOR_A, MONITOR_B];

  return {
    monitors: bucketsByMonitor.map(
      (buckets: Array<UptimeDayBucket>, index: number) => {
        return {
          monitorId: new ObjectID(ids[index]!),
          buckets: buckets,
        };
      },
    ),
    isComplete: true,
    completeFrom: null,
    timezone: "UTC",
  };
}

/*
 * Pairs each bar with the bucket whose start falls in it, the way
 * DayUptimeGraph looks a reading up. Returns the bars with no bucket and
 * the buckets that landed on no bar.
 */
function pair(
  days: Array<UptimeGraphDay>,
  buckets: Array<UptimeDayBucket>,
): { barsWithoutBucket: Array<string>; bucketsWithoutBar: Array<string> } {
  const barsWithoutBucket: Array<string> = [];

  for (const day of days) {
    const hasBucket: boolean = buckets.some((b: UptimeDayBucket) => {
      return (
        b.bucketStart.getTime() >= day.startOfDay.getTime() &&
        b.bucketStart.getTime() <= day.endOfDay.getTime()
      );
    });

    if (!hasBucket) {
      barsWithoutBucket.push(day.startOfDay.toISOString());
    }
  }

  const bucketsWithoutBar: Array<string> = buckets
    .filter((b: UptimeDayBucket) => {
      return !days.some((day: UptimeGraphDay) => {
        return (
          b.bucketStart.getTime() >= day.startOfDay.getTime() &&
          b.bucketStart.getTime() <= day.endOfDay.getTime()
        );
      });
    })
    .map((b: UptimeDayBucket) => {
      return b.bucketStart.toISOString();
    });

  return { barsWithoutBucket, bucketsWithoutBar };
}

describe("UptimeDailyAggregateUtil.getWindow", () => {
  test("there is no window without buckets", () => {
    expect(UptimeDailyAggregateUtil.getWindow(null)).toBeNull();
    expect(UptimeDailyAggregateUtil.getWindow(undefined)).toBeNull();
    expect(UptimeDailyAggregateUtil.getWindow(aggregateOf([]))).toBeNull();
    expect(
      UptimeDailyAggregateUtil.getWindow(aggregateOf([[], []])),
    ).toBeNull();
  });

  test("the window runs from the earliest bucket start to the latest bucket end", () => {
    const window: { startDate: Date; endDate: Date } | null =
      UptimeDailyAggregateUtil.getWindow(
        aggregateOf([
          [
            // deliberately out of order
            bucket("2026-09-21T00:00:00.000Z", "2026-09-22T00:00:00.000Z"),
            bucket("2026-07-24T08:49:59.288Z", "2026-07-25T00:00:00.000Z"),
          ],
          [bucket("2026-09-22T00:00:00.000Z", "2026-09-22T08:49:59.288Z")],
        ]),
      );

    expect(window).not.toBeNull();
    expect(window!.startDate.toISOString()).toBe("2026-07-24T08:49:59.288Z");
    expect(window!.endDate.toISOString()).toBe("2026-09-22T08:49:59.288Z");
  });
});

describe("a strip drawn over the server's window pairs every bar with a bucket", () => {
  /*
   * Each case is a moment the browser's own window disagreed with the
   * server's. `browserBars` is what the strip drew before, from
   * getSomeDaysAgoFromDate in New York; it is asserted too, so that the case
   * keeps demonstrating the failure it guards against.
   */
  interface WindowCase {
    name: string;
    now: string;
    days: number;
    browserBars: number;
  }

  const cases: Array<WindowCase> = [
    {
      // 19:30 EST, 60 days back crosses the Nov 1 fall-back.
      name: "an autumn evening in New York (window crosses the fall-back)",
      now: "2026-12-15T00:30:00.000Z",
      days: 60,
      browserBars: 62,
    },
    {
      // 19:30 EDT, 60 days back crosses the Mar 8 spring-forward.
      name: "a spring evening in New York (window crosses the spring-forward)",
      now: "2026-04-20T23:30:00.000Z",
      days: 60,
      browserBars: 60,
    },
    {
      name: "a 90 day window across the fall-back",
      now: "2026-11-20T00:30:00.000Z",
      days: 90,
      browserBars: 92,
    },
    {
      name: "an ordinary afternoon with no DST change in the window",
      now: "2026-09-22T18:00:00.000Z",
      days: 60,
      browserBars: 61,
    },
  ];

  for (const windowCase of cases) {
    test(windowCase.name, () => {
      const now: Date = new Date(windowCase.now);
      const serverStart: Date = new Date(
        now.getTime() - windowCase.days * DAY_MS,
      );
      const buckets: Array<UptimeDayBucket> = serverUtcBuckets(
        serverStart,
        now,
      );

      const window: { startDate: Date; endDate: Date } | null =
        UptimeDailyAggregateUtil.getWindow(aggregateOf([buckets, buckets]));

      const days: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
        startDate: window!.startDate,
        endDate: window!.endDate,
        timezone: "UTC",
      });

      expect(days).toHaveLength(buckets.length);
      expect(days).toHaveLength(windowCase.days + 1);
      expect(pair(days, buckets)).toEqual({
        barsWithoutBucket: [],
        bucketsWithoutBar: [],
      });

      // The strip as it was drawn before, from the browser's own window.
      const browserDays: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
        startDate: OneUptimeDate.getSomeDaysAgoFromDate(now, windowCase.days),
        endDate: now,
        timezone: "UTC",
      });

      expect(browserDays).toHaveLength(windowCase.browserBars);

      if (windowCase.browserBars !== buckets.length) {
        const pairing: {
          barsWithoutBucket: Array<string>;
          bucketsWithoutBar: Array<string>;
        } = pair(browserDays, buckets);

        expect(
          pairing.barsWithoutBucket.length + pairing.bucketsWithoutBar.length,
        ).toBeGreaterThan(0);
      }
    });
  }

  test("just after UTC midnight, today's bar is the newest bucket's day, not a day with no bucket", () => {
    /*
     * The server built the payload at 23:59:55Z on Sep 22 and it was served
     * from cache at 00:00:03Z on Sep 23. Drawn from the browser clock, the
     * last bar was Sep 23 UTC and had nothing to be painted from.
     */
    const serverNow: Date = new Date("2026-09-22T23:59:55.000Z");
    const browserNow: Date = new Date("2026-09-23T00:00:03.000Z");
    const buckets: Array<UptimeDayBucket> = serverUtcBuckets(
      new Date(serverNow.getTime() - 60 * DAY_MS),
      serverNow,
    );

    const window: { startDate: Date; endDate: Date } | null =
      UptimeDailyAggregateUtil.getWindow(aggregateOf([buckets]));

    const days: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
      startDate: window!.startDate,
      endDate: window!.endDate,
      timezone: "UTC",
    });

    expect(days[days.length - 1]!.startOfDay.toISOString()).toBe(
      "2026-09-22T00:00:00.000Z",
    );
    expect(pair(days, buckets).barsWithoutBucket).toEqual([]);

    const browserDays: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
      startDate: OneUptimeDate.getSomeDaysAgoFromDate(browserNow, 60),
      endDate: browserNow,
      timezone: "UTC",
    });

    expect(pair(browserDays, buckets).barsWithoutBucket).toContain(
      "2026-09-23T00:00:00.000Z",
    );
  });
});
