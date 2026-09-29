import ObjectID from "../../../Types/ObjectID";
import {
  UptimeDayBucket,
  UptimeStatusDuration,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import UptimeDailyAggregateUtil, {
  UptimeDailyAggregateTotals,
} from "../../../Utils/StatusPage/UptimeDailyAggregateUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * Uptime and downtime read off a monitor's day buckets.
 *
 * These replace figures computed from timeline rows that arrive under one
 * 10,000 row cap across every monitor on a status page. On a page with a
 * flapping monitor the cap keeps only the newest few days of the window, so a
 * percentage computed from the rows is a percentage of those days. The
 * buckets have no cap, and the server's uptime report and uptime endpoint now
 * read single-monitor resources from them.
 */

const DAY_SECONDS: number = 86400;

const OPERATIONAL: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OFFLINE: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DEGRADED: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function day(data: {
  index: number;
  seconds: Array<[string, number]>;
}): UptimeDayBucket {
  const bucketStart: Date = new Date(
    Date.UTC(2026, 5, 1) + data.index * DAY_SECONDS * 1000,
  );

  const statusDurations: Array<UptimeStatusDuration> = data.seconds.map(
    ([statusId, seconds]: [string, number]): UptimeStatusDuration => {
      return { monitorStatusId: new ObjectID(statusId), seconds: seconds };
    },
  );

  return {
    bucketStart: bucketStart,
    bucketEnd: new Date(bucketStart.getTime() + DAY_SECONDS * 1000),
    daySeconds: DAY_SECONDS,
    coveredSeconds: statusDurations.reduce(
      (total: number, duration: UptimeStatusDuration) => {
        return total + duration.seconds;
      },
      0,
    ),
    statusDurations: statusDurations,
  };
}

/*
 * Sixty full days, each spending downtimeOnDay(its index) seconds Offline and
 * the rest Operational.
 */
function sixtyDays(
  downtimeOnDay: (index: number) => number,
): Array<UptimeDayBucket> {
  const buckets: Array<UptimeDayBucket> = [];

  for (let index: number = 0; index < 60; index++) {
    const offline: number = downtimeOnDay(index);

    buckets.push(
      day({
        index: index,
        seconds: [
          [OPERATIONAL, DAY_SECONDS - offline],
          [OFFLINE, offline],
        ],
      }),
    );
  }

  return buckets;
}

describe("UptimeDailyAggregateUtil.getTotals", () => {
  test("adds up covered seconds and the seconds spent in a downtime status", () => {
    const totals: UptimeDailyAggregateTotals =
      UptimeDailyAggregateUtil.getTotals({
        buckets: [
          day({
            index: 0,
            seconds: [
              [OPERATIONAL, 80000],
              [OFFLINE, 6400],
            ],
          }),
          day({
            index: 1,
            seconds: [
              [OPERATIONAL, 86000],
              [DEGRADED, 400],
            ],
          }),
        ],
        downtimeMonitorStatusIds: [OFFLINE],
      });

    // Degraded is not a downtime status on this page.
    expect(totals).toEqual({ coveredSeconds: 172800, downtimeSeconds: 6400 });
  });

  test("counts every status the page treats as downtime", () => {
    const totals: UptimeDailyAggregateTotals =
      UptimeDailyAggregateUtil.getTotals({
        buckets: [
          day({
            index: 0,
            seconds: [
              [OPERATIONAL, 80000],
              [OFFLINE, 6000],
              [DEGRADED, 400],
            ],
          }),
        ],
        downtimeMonitorStatusIds: [
          new ObjectID(OFFLINE),
          new ObjectID(DEGRADED),
        ],
      });

    expect(totals.downtimeSeconds).toBe(6400);
  });

  test("gives a day with nothing recorded neither coverage nor downtime", () => {
    const totals: UptimeDailyAggregateTotals =
      UptimeDailyAggregateUtil.getTotals({
        buckets: [
          day({ index: 0, seconds: [] }),
          day({
            index: 1,
            seconds: [[OFFLINE, 3600]],
          }),
        ],
        downtimeMonitorStatusIds: [OFFLINE],
      });

    /*
     * The empty day is a monitor that did not exist yet, or a hole in the
     * record. Counting it as covered would dilute the downtime with uptime
     * nobody measured.
     */
    expect(totals).toEqual({ coveredSeconds: 3600, downtimeSeconds: 3600 });
  });

  test("never lets a day be down for longer than it was watched", () => {
    const bucket: UptimeDayBucket = day({
      index: 0,
      seconds: [[OFFLINE, 3600]],
    });

    // overlapping rows can double count a span inside one status.
    bucket.statusDurations.push({
      monitorStatusId: new ObjectID(OFFLINE),
      seconds: 3600,
    });

    const totals: UptimeDailyAggregateTotals =
      UptimeDailyAggregateUtil.getTotals({
        buckets: [bucket],
        downtimeMonitorStatusIds: [OFFLINE],
      });

    expect(totals).toEqual({ coveredSeconds: 3600, downtimeSeconds: 3600 });
  });

  test("is zero for a monitor with no buckets", () => {
    expect(
      UptimeDailyAggregateUtil.getTotals({
        buckets: [],
        downtimeMonitorStatusIds: [OFFLINE],
      }),
    ).toEqual({ coveredSeconds: 0, downtimeSeconds: 0 });
  });
});

describe("UptimeDailyAggregateUtil.getUptimePercent", () => {
  test("measures the whole window, not the newest few days of it", () => {
    /*
     * The shape that was overstated: a monitor that was down for a few
     * minutes a day for most of sixty days and has been quiet lately. The
     * rows that survive the cap are the quiet days; the buckets are all of
     * them.
     */
    const buckets: Array<UptimeDayBucket> = sixtyDays((index: number) => {
      return index < 55 ? 300 : 60;
    });

    // (60 x 86400 - (55 x 300 + 5 x 60)) / (60 x 86400) = 99.6759...%
    expect(
      UptimeDailyAggregateUtil.getUptimePercent({
        buckets: buckets,
        downtimeMonitorStatusIds: [OFFLINE],
        precision: UptimePrecision.THREE_DECIMAL,
      }),
    ).toBe(99.675);

    // the newest five days alone would have read far higher.
    expect(
      UptimeDailyAggregateUtil.getUptimePercent({
        buckets: buckets.slice(55),
        downtimeMonitorStatusIds: [OFFLINE],
        precision: UptimePrecision.THREE_DECIMAL,
      }),
    ).toBe(99.93);
  });

  test("rounds down to the precision, like every other uptime figure", () => {
    const buckets: Array<UptimeDayBucket> = sixtyDays(() => {
      return 288;
    });

    const percentAt: (precision: UptimePrecision) => number | null = (
      precision: UptimePrecision,
    ): number | null => {
      return UptimeDailyAggregateUtil.getUptimePercent({
        buckets: buckets,
        downtimeMonitorStatusIds: [OFFLINE],
        precision: precision,
      });
    };

    // 99.6666...% - never rounded up to a figure the monitor did not reach.
    expect(percentAt(UptimePrecision.NO_DECIMAL)).toBe(99);
    expect(percentAt(UptimePrecision.ONE_DECIMAL)).toBe(99.6);
    expect(percentAt(UptimePrecision.TWO_DECIMAL)).toBe(99.66);
    expect(percentAt(UptimePrecision.THREE_DECIMAL)).toBe(99.666);
  });

  test("is 100 for a monitor that was never down", () => {
    expect(
      UptimeDailyAggregateUtil.getUptimePercent({
        buckets: sixtyDays(() => {
          return 0;
        }),
        downtimeMonitorStatusIds: [OFFLINE],
        precision: UptimePrecision.TWO_DECIMAL,
      }),
    ).toBe(100);
  });

  test("is 0 for a monitor that was down the whole time", () => {
    expect(
      UptimeDailyAggregateUtil.getUptimePercent({
        buckets: sixtyDays(() => {
          return DAY_SECONDS;
        }),
        downtimeMonitorStatusIds: [OFFLINE],
        precision: UptimePrecision.TWO_DECIMAL,
      }),
    ).toBe(0);
  });

  test("measures a monitor younger than the window from its first reading", () => {
    /*
     * Created at noon on the last day and offline ever since: 0%, not the
     * 99% that dividing by the whole window would report.
     */
    const buckets: Array<UptimeDayBucket> = [
      day({ index: 0, seconds: [] }),
      day({ index: 1, seconds: [] }),
      day({ index: 2, seconds: [[OFFLINE, 43200]] }),
    ];

    expect(
      UptimeDailyAggregateUtil.getUptimePercent({
        buckets: buckets,
        downtimeMonitorStatusIds: [OFFLINE],
        precision: UptimePrecision.TWO_DECIMAL,
      }),
    ).toBe(0);
  });

  test("is null when nothing was recorded, so the caller can fall back", () => {
    expect(
      UptimeDailyAggregateUtil.getUptimePercent({
        buckets: [day({ index: 0, seconds: [] })],
        downtimeMonitorStatusIds: [OFFLINE],
        precision: UptimePrecision.TWO_DECIMAL,
      }),
    ).toBeNull();

    expect(
      UptimeDailyAggregateUtil.getUptimePercent({
        buckets: [],
        downtimeMonitorStatusIds: [OFFLINE],
        precision: UptimePrecision.TWO_DECIMAL,
      }),
    ).toBeNull();
  });
});
