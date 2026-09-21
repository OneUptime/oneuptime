import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import {
  UptimeDailyAggregate,
  UptimeDayBucket,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import UptimeDailyAggregateUtil from "../../../Utils/StatusPage/UptimeDailyAggregateUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * The wire format for the uptime aggregate, which replaced shipping raw
 * MonitorStatusTimeline rows to the status page.
 *
 * Two properties matter more than the round trip itself:
 *
 * 1. It must be SMALL. The rows it replaces serialize to ~431 bytes each,
 *    almost entirely typed-JSON envelopes, so one real status page's 254,550
 *    matching rows came to ~105 MB. If this format ever grows envelopes it
 *    gives that back.
 *
 * 2. Parsing must be TOTAL. A status page that cannot read its aggregate has
 *    to fall back to "no data", which is honest. What it must never do is
 *    fall back to something that looks like uptime.
 */

const MONITOR_A: string = "11111111-1111-4111-8111-111111111111";
const STATUS_UP: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function sample(): UptimeDailyAggregate {
  return {
    monitors: [
      {
        monitorId: new ObjectID(MONITOR_A),
        buckets: [
          {
            bucketStart: new Date("2026-07-01T00:00:00.000Z"),
            bucketEnd: new Date("2026-07-02T00:00:00.000Z"),
            daySeconds: 86400,
            coveredSeconds: 86400,
            statusDurations: [
              {
                monitorStatusId: new ObjectID(STATUS_UP),
                seconds: 86400,
              },
            ],
          },
          {
            bucketStart: new Date("2026-07-02T00:00:00.000Z"),
            bucketEnd: new Date("2026-07-03T00:00:00.000Z"),
            daySeconds: 86400,
            coveredSeconds: 0,
            statusDurations: [],
          },
        ],
      },
    ],
    isComplete: true,
    completeFrom: null,
  };
}

describe("UptimeDailyAggregateUtil", () => {
  describe("round trip", () => {
    test("survives toJSON -> fromJSON unchanged", () => {
      const parsed: UptimeDailyAggregate = UptimeDailyAggregateUtil.fromJSON(
        UptimeDailyAggregateUtil.toJSON(sample()),
      );

      expect(parsed.monitors).toHaveLength(1);
      expect(parsed.monitors[0]!.monitorId.toString()).toBe(MONITOR_A);
      expect(parsed.monitors[0]!.buckets).toHaveLength(2);

      const first: UptimeDayBucket = parsed.monitors[0]!.buckets[0]!;

      expect(first.coveredSeconds).toBe(86400);
      expect(first.daySeconds).toBe(86400);
      expect(first.bucketStart.toISOString()).toBe("2026-07-01T00:00:00.000Z");
      expect(first.statusDurations[0]!.monitorStatusId.toString()).toBe(
        STATUS_UP,
      );
    });

    test("a no-data day survives as a no-data day", () => {
      /*
       * The single most important thing to preserve. If coverage were lost in
       * transit the client would treat the day as ordinary and paint it with
       * the operator's colour - which is the bug this whole change removes.
       */
      const parsed: UptimeDailyAggregate = UptimeDailyAggregateUtil.fromJSON(
        UptimeDailyAggregateUtil.toJSON(sample()),
      );

      expect(parsed.monitors[0]!.buckets[1]!.coveredSeconds).toBe(0);
      expect(parsed.monitors[0]!.buckets[1]!.statusDurations).toHaveLength(0);
    });
  });

  describe("the wire format stays small", () => {
    test("dates and ids are plain strings, not typed-JSON envelopes", () => {
      const json: JSONObject = UptimeDailyAggregateUtil.toJSON(sample());
      const encoded: string = JSON.stringify(json);

      expect(encoded).not.toContain("_type");
      expect(encoded).toContain("2026-07-01T00:00:00.000Z");
      expect(encoded).toContain(MONITOR_A);
    });

    test("a 90-day, 50-monitor page stays far below the row payload it replaces", () => {
      /*
       * The rows this replaces were ~431 bytes each and a real page matched
       * 254,550 of them (~105 MB). This asserts the replacement is bounded by
       * structure rather than by how much a monitor flaps.
       */
      const aggregate: UptimeDailyAggregate = {
        monitors: [],
        isComplete: true,
        completeFrom: null,
      };

      for (let m: number = 0; m < 50; m++) {
        const buckets: Array<UptimeDayBucket> = [];

        for (let d: number = 0; d < 90; d++) {
          const start: Date = new Date(
            Date.UTC(2026, 3, 1) + d * 24 * 60 * 60 * 1000,
          );

          buckets.push({
            bucketStart: start,
            bucketEnd: new Date(start.getTime() + 86400000),
            daySeconds: 86400,
            coveredSeconds: 86400,
            statusDurations: [
              { monitorStatusId: new ObjectID(STATUS_UP), seconds: 86000 },
              { monitorStatusId: new ObjectID(MONITOR_A), seconds: 400 },
            ],
          });
        }

        aggregate.monitors.push({
          monitorId: new ObjectID(
            `${MONITOR_A.slice(0, -2)}${m % 10}${m % 10}`,
          ),
          buckets,
        });
      }

      const bytes: number = JSON.stringify(
        UptimeDailyAggregateUtil.toJSON(aggregate),
      ).length;

      // Comfortably under a megabyte for the largest page the product allows.
      expect(bytes).toBeLessThan(1_500_000);
    });
  });

  describe("parsing is total", () => {
    test.each([
      ["null", null],
      ["undefined", undefined],
      ["an empty object", {}],
      ["monitors not an array", { monitors: "nope" }],
    ])(
      "%s yields an empty aggregate rather than throwing",
      (_name: string, input: unknown) => {
        expect(() => {
          return UptimeDailyAggregateUtil.fromJSON(input as JSONObject);
        }).not.toThrow();

        const parsed: UptimeDailyAggregate = UptimeDailyAggregateUtil.fromJSON(
          input as JSONObject,
        );

        expect(parsed.monitors).toHaveLength(0);
      },
    );

    test("a bucket with an unparseable date is dropped, not turned into coverage", () => {
      const parsed: UptimeDailyAggregate = UptimeDailyAggregateUtil.fromJSON({
        monitors: [
          {
            monitorId: MONITOR_A,
            buckets: [
              {
                bucketStart: "not-a-date",
                bucketEnd: "also-not",
                daySeconds: 1,
              },
            ],
          },
        ],
        weird: true,
      } as unknown as JSONObject);

      expect(parsed.monitors[0]!.buckets).toHaveLength(0);
    });

    test("a missing isComplete means complete, not incomplete", () => {
      /*
       * An older server has no cap in this path either. Defaulting to
       * incomplete would grey out every bar on a perfectly healthy page.
       */
      const parsed: UptimeDailyAggregate = UptimeDailyAggregateUtil.fromJSON({
        monitors: [],
      } as unknown as JSONObject);

      expect(parsed.isComplete).toBe(true);
    });

    test("an explicit isComplete false is honoured", () => {
      const parsed: UptimeDailyAggregate = UptimeDailyAggregateUtil.fromJSON({
        monitors: [],
        isComplete: false,
        completeFrom: "2026-07-05T00:00:00.000Z",
      } as unknown as JSONObject);

      expect(parsed.isComplete).toBe(false);
      expect(parsed.completeFrom?.toISOString()).toBe(
        "2026-07-05T00:00:00.000Z",
      );
    });
  });

  describe("getBucketsForMonitor", () => {
    test("returns that monitor's buckets", () => {
      expect(
        UptimeDailyAggregateUtil.getBucketsForMonitor(sample(), MONITOR_A),
      ).toHaveLength(2);
    });

    test("returns empty for a monitor that is not in the aggregate", () => {
      expect(
        UptimeDailyAggregateUtil.getBucketsForMonitor(
          sample(),
          "99999999-9999-4999-8999-999999999999",
        ),
      ).toHaveLength(0);
    });

    test("returns empty rather than throwing when there is no aggregate", () => {
      expect(
        UptimeDailyAggregateUtil.getBucketsForMonitor(null, MONITOR_A),
      ).toHaveLength(0);
    });
  });
});
