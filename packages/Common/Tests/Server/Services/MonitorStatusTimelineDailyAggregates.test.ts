import { Service as MonitorStatusTimelineServiceType } from "../../../Server/Services/MonitorStatusTimelineService";
import ObjectID from "../../../Types/ObjectID";
import {
  MonitorUptimeDailyAggregate,
  UptimeDailyAggregate,
  UptimeDayBucket,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * The status-page uptime bars used to be painted from raw MonitorStatusTimeline
 * rows fetched under a single `limit: LIMIT_MAX` (10,000) across EVERY monitor
 * on the page, sorted `startsAt DESC`.
 *
 * Measured on a real status page: 254,550 rows matched the 60-day window and
 * 10,000 came back - 3.9%. The oldest surviving row started four days before
 * the request, so 56 of 60 bars were painted from data that had been dropped,
 * and the uptime percentage was computed from the same 3.9%.
 *
 * The cap is GLOBAL across monitors and the sort is newest-first, so a quiet
 * monitor's covering row - which has an OLD startsAt - sorts last and is cut
 * first. On the reporting page, three flapping monitors held 9,995 of the
 * 10,000 slots. The healthier a monitor is, the more likely it loses its whole
 * history to a noisy neighbour.
 *
 * These tests cover the SHAPING half (no database): turning the SQL's
 * (monitor, day, status) rows into buckets, and in particular keeping a
 * no-coverage day distinguishable from a day spent up.
 */

const MONITOR_A: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_B: string = "22222222-2222-4222-8222-222222222222";
const STATUS_UP: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STATUS_DOWN: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Row = {
  monitorId: string;
  bucketStart: Date;
  bucketEnd: Date;
  daySeconds: string | number;
  monitorStatusId: string | null;
  seconds: string | number;
};

function row(
  monitorId: string,
  day: string,
  statusId: string | null,
  seconds: number,
  daySeconds: number = 86400,
): Row {
  const start: Date = new Date(`${day}T00:00:00.000Z`);
  const end: Date = new Date(start.getTime() + daySeconds * 1000);

  return {
    monitorId,
    bucketStart: start,
    bucketEnd: end,
    /* The pg driver returns bigint columns as strings. */
    daySeconds: String(daySeconds),
    monitorStatusId: statusId,
    seconds: String(seconds),
  };
}

function aggregate(rows: Array<Row>): UptimeDailyAggregate {
  return MonitorStatusTimelineServiceType.toUptimeDailyAggregate(rows);
}

function bucketsFor(
  result: UptimeDailyAggregate,
  monitorId: string,
): Array<UptimeDayBucket> {
  const monitor: MonitorUptimeDailyAggregate | undefined =
    result.monitors.find((m: MonitorUptimeDailyAggregate) => {
      return m.monitorId.toString() === monitorId;
    });

  return monitor ? monitor.buckets : [];
}

describe("MonitorStatusTimelineService.toUptimeDailyAggregate", () => {
  describe("a day with no coverage is not a day spent up", () => {
    test("a NULL-status row yields a bucket with zero coverage and no durations", () => {
      /*
       * This is the LEFT JOIN's "nothing overlapped this day" row. It is the
       * single most important case in this file: before the fix such a day
       * fell through to the status page's defaultBarColor, which is GREEN on
       * 4,642 status pages - the page silently asserting uptime for a period
       * it has no data for.
       */
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-01", null, 0),
      ]);

      const buckets: Array<UptimeDayBucket> = bucketsFor(result, MONITOR_A);

      expect(buckets).toHaveLength(1);
      expect(buckets[0]!.coveredSeconds).toBe(0);
      expect(buckets[0]!.statusDurations).toHaveLength(0);
      expect(buckets[0]!.daySeconds).toBe(86400);
    });

    test("a zero-second status row does not manufacture coverage", () => {
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-01", STATUS_UP, 0),
      ]);

      expect(bucketsFor(result, MONITOR_A)[0]!.coveredSeconds).toBe(0);
      expect(bucketsFor(result, MONITOR_A)[0]!.statusDurations).toHaveLength(0);
    });

    test("a fully covered day is distinguishable from a no-data day", () => {
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-01", null, 0),
        row(MONITOR_A, "2026-07-02", STATUS_UP, 86400),
      ]);

      const buckets: Array<UptimeDayBucket> = bucketsFor(result, MONITOR_A);

      expect(buckets[0]!.coveredSeconds).toBe(0);
      expect(buckets[1]!.coveredSeconds).toBe(86400);
    });
  });

  describe("partial coverage is a real reading, not a no-data day", () => {
    test("the day a monitor was created reports what was measured", () => {
      /*
       * A monitor created at noon has half a day of data. That is a genuine
       * reading of a shorter interval and must render normally - not as
       * no-data, and not penalised for the hours before it existed.
       */
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-01", STATUS_UP, 43200),
      ]);

      const bucket: UptimeDayBucket = bucketsFor(result, MONITOR_A)[0]!;

      expect(bucket.coveredSeconds).toBe(43200);
      expect(bucket.daySeconds).toBe(86400);
      expect(bucket.coveredSeconds).toBeLessThan(bucket.daySeconds);
      expect(bucket.statusDurations).toHaveLength(1);
    });
  });

  describe("multiple statuses in one day", () => {
    test("durations are kept separately and summed into coverage", () => {
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-01", STATUS_UP, 82800),
        row(MONITOR_A, "2026-07-01", STATUS_DOWN, 3600),
      ]);

      const buckets: Array<UptimeDayBucket> = bucketsFor(result, MONITOR_A);

      expect(buckets).toHaveLength(1);
      expect(buckets[0]!.coveredSeconds).toBe(86400);
      expect(buckets[0]!.statusDurations).toHaveLength(2);

      const down: number =
        buckets[0]!.statusDurations.find((d: { monitorStatusId: ObjectID }) => {
          return d.monitorStatusId.toString() === STATUS_DOWN;
        })?.seconds || 0;

      expect(down).toBe(3600);
    });
  });

  describe("day length is never assumed to be 86400", () => {
    test("a clipped first bucket keeps its real length", () => {
      /*
       * The window's first and last buckets are clipped to the window, and a
       * local day crossing a DST boundary is genuinely 23 or 25 hours. Any
       * consumer dividing by a hardcoded 86400 would misreport both.
       */
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-01", STATUS_UP, 45147, 45147),
      ]);

      expect(bucketsFor(result, MONITOR_A)[0]!.daySeconds).toBe(45147);
    });

    test("a 23-hour DST day is reported as 82800 seconds", () => {
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-03-29", STATUS_UP, 82800, 82800),
      ]);

      expect(bucketsFor(result, MONITOR_A)[0]!.daySeconds).toBe(82800);
    });

    test("a 25-hour DST day is reported as 90000 seconds", () => {
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-10-25", STATUS_UP, 90000, 90000),
      ]);

      expect(bucketsFor(result, MONITOR_A)[0]!.daySeconds).toBe(90000);
    });
  });

  describe("monitors are kept apart", () => {
    test("a noisy monitor cannot consume a quiet one's buckets", () => {
      /*
       * The shape of the original bug: a global cap let three flapping
       * monitors hold 9,995 of 10,000 slots and starve the quiet ones. The
       * aggregate is per monitor, so a quiet monitor's days survive
       * regardless of what its neighbours are doing.
       */
      const rows: Array<Row> = [];

      for (let i: number = 0; i < 500; i++) {
        rows.push(row(MONITOR_A, "2026-07-01", STATUS_UP, 1));
        rows.push(row(MONITOR_A, "2026-07-01", STATUS_DOWN, 1));
      }

      rows.push(row(MONITOR_B, "2026-07-01", STATUS_UP, 86400));

      const result: UptimeDailyAggregate = aggregate(rows);

      expect(bucketsFor(result, MONITOR_B)).toHaveLength(1);
      expect(bucketsFor(result, MONITOR_B)[0]!.coveredSeconds).toBe(86400);
    });
  });

  describe("output shape", () => {
    test("buckets come back in chronological order whatever order the rows arrive in", () => {
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-03", STATUS_UP, 86400),
        row(MONITOR_A, "2026-07-01", STATUS_UP, 86400),
        row(MONITOR_A, "2026-07-02", STATUS_UP, 86400),
      ]);

      const starts: Array<number> = bucketsFor(result, MONITOR_A).map(
        (b: UptimeDayBucket) => {
          return b.bucketStart.getTime();
        },
      );

      expect(starts).toEqual([...starts].sort());
    });

    test("bigint columns arriving as strings are coerced to numbers", () => {
      /*
       * The pg driver returns bigint as a string. Left uncoerced, coverage
       * arithmetic would concatenate instead of adding.
       */
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-01", STATUS_UP, 3600),
        row(MONITOR_A, "2026-07-01", STATUS_DOWN, 1800),
      ]);

      const bucket: UptimeDayBucket = bucketsFor(result, MONITOR_A)[0]!;

      expect(typeof bucket.coveredSeconds).toBe("number");
      expect(typeof bucket.daySeconds).toBe("number");
      expect(bucket.coveredSeconds).toBe(5400);
    });

    test("an empty result set is complete, not incomplete", () => {
      const result: UptimeDailyAggregate = aggregate([]);

      expect(result.monitors).toHaveLength(0);
      expect(result.isComplete).toBe(true);
      expect(result.completeFrom).toBeNull();
    });

    test("there is no silent cap: the aggregate always declares completeness", () => {
      /*
       * Requirement 4. The old path had a bound that nothing surfaced. These
       * fields exist so a bound added later has to SHOW rather than be
       * absorbed into a green bar.
       */
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-01", STATUS_UP, 86400),
      ]);

      expect(result).toHaveProperty("isComplete");
      expect(result).toHaveProperty("completeFrom");
      expect(result.isComplete).toBe(true);
    });
  });
});
