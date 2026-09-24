/**
 * @timezone America/New_York
 */
/*
 * The docblock above runs this file with the process in New York, so the
 * timezone tests below can tell "UTC" apart from "the viewer's own zone".
 * Falling back to the viewer's zone is exactly the mismatch the aggregate's
 * timezone field exists to remove. Every other test in this file builds its
 * dates from ISO strings with a Z suffix and is unaffected by the zone.
 */
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import {
  UptimeDailyAggregate,
  UptimeDayBucket,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import UptimeDailyAggregateUtil, {
  DEFAULT_UPTIME_AGGREGATE_TIMEZONE,
} from "../../../Utils/StatusPage/UptimeDailyAggregateUtil";
import UptimeUtil from "../../../Utils/Uptime/UptimeUtil";
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

/*
 * The status page's downtime statuses (Degraded + Offline) and two that are
 * not downtime. Operational is STATUS_UP above.
 */
const STATUS_DEGRADED: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STATUS_OFFLINE: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const STATUS_MAINTENANCE: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const DAY_SECONDS: number = 86400;

const DOWNTIME_STATUS_IDS: Array<string> = [STATUS_DEGRADED, STATUS_OFFLINE];

/*
 * One day bucket, `dayIndex` UTC days after 2026-07-01. `durations` are
 * [statusId, seconds] pairs. coveredSeconds is passed in rather than summed
 * so a test can hand getUptimePercent a bucket the server would never send
 * (durations longer than the coverage, durations with no coverage).
 */
function dayBucket(
  dayIndex: number,
  coveredSeconds: number,
  durations: Array<[string, number]>,
  daySeconds: number = DAY_SECONDS,
): UptimeDayBucket {
  const bucketStart: Date = new Date(
    Date.UTC(2026, 6, 1) + dayIndex * DAY_SECONDS * 1000,
  );

  return {
    bucketStart: bucketStart,
    bucketEnd: new Date(bucketStart.getTime() + daySeconds * 1000),
    daySeconds: daySeconds,
    coveredSeconds: coveredSeconds,
    statusDurations: durations.map((duration: [string, number]) => {
      return {
        monitorStatusId: new ObjectID(duration[0]),
        seconds: duration[1],
      };
    }),
  };
}

// A fully covered day with `downSeconds` of `downStatusId` and the rest Operational.
function coveredDay(
  dayIndex: number,
  downStatusId?: string | undefined,
  downSeconds: number = 0,
): UptimeDayBucket {
  const durations: Array<[string, number]> = [
    [STATUS_UP, DAY_SECONDS - downSeconds],
  ];

  if (downStatusId && downSeconds > 0) {
    durations.push([downStatusId, downSeconds]);
  }

  return dayBucket(dayIndex, DAY_SECONDS, durations);
}

/*
 * The shape of one of status.chainflip.io's flapping monitors, measured from
 * the production aggregate: sixty fully covered UTC days with 17,270 seconds
 * of Offline and Degraded between them, spread unevenly (and one day with
 * both) the way flapping spreads it.
 */
const CHAINFLIP_DOWNTIME_SECONDS: number = 17270;
const CHAINFLIP_DAYS: number = 60;

function chainflipBuckets(): Array<UptimeDayBucket> {
  const buckets: Array<UptimeDayBucket> = [];

  for (let d: number = 0; d < CHAINFLIP_DAYS; d++) {
    if (d < 10) {
      buckets.push(coveredDay(d, STATUS_OFFLINE, 1000));
    } else if (d < 20) {
      buckets.push(coveredDay(d, STATUS_DEGRADED, 700));
    } else if (d === 20) {
      buckets.push(
        dayBucket(d, DAY_SECONDS, [
          [STATUS_UP, DAY_SECONDS - 270],
          [STATUS_OFFLINE, 150],
          [STATUS_DEGRADED, 120],
        ]),
      );
    } else {
      buckets.push(coveredDay(d));
    }
  }

  return buckets;
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

        /*
         * The empty aggregate is a UTC one, never a zone-less one: a client
         * reading `timezone` off it must not have to guess, and guessing
         * "local" would draw the bars on the viewer's days.
         */
        expect(parsed.timezone).toBe("UTC");
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

  /*
   * ROOT CAUSE 3: the aggregate is cut in UTC days (one cached payload per
   * status page, shared by every visitor) but the browser drew its bars on the
   * VISITOR's local days and matched each reading to whichever local day its
   * bucketStart fell in. West of UTC every bar showed the next UTC day's
   * reading and today's bar had none, so it fell back to the capped rows and
   * came out grey.
   *
   * The fix makes the zone travel with the buckets. Before it, the wire
   * format had no `timezone` key at all, so every assertion on it below fails
   * against the old toJSON / fromJSON (and getTimezone / isValidTimezone did
   * not exist).
   */
  describe("the zone the buckets were cut in travels on the wire", () => {
    function inZone(timezone: string | undefined): UptimeDailyAggregate {
      return { ...sample(), timezone: timezone };
    }

    test("the default zone is UTC, the zone the server's SQL has always defaulted to", () => {
      expect(DEFAULT_UPTIME_AGGREGATE_TIMEZONE).toBe("UTC");
    });

    test("toJSON writes the aggregate's zone", () => {
      const json: JSONObject = UptimeDailyAggregateUtil.toJSON(
        inZone("Asia/Tokyo"),
      );

      expect(json["timezone"]).toBe("Asia/Tokyo");
    });

    test("toJSON writes UTC for an aggregate that does not say, rather than leaving it out", () => {
      /*
       * An aggregate built by code that predates the field is a UTC one. The
       * key is always written so a client never has to infer it.
       */
      const json: JSONObject = UptimeDailyAggregateUtil.toJSON(sample());

      expect(json).toHaveProperty("timezone");
      expect(json["timezone"]).toBe("UTC");
    });

    test("toJSON never writes a zone the client would have to reject", () => {
      const json: JSONObject = UptimeDailyAggregateUtil.toJSON(
        inZone("Mars/Olympus_Mons"),
      );

      expect(json["timezone"]).toBe("UTC");
    });

    test("fromJSON reads a valid zone", () => {
      const parsed: UptimeDailyAggregate = UptimeDailyAggregateUtil.fromJSON({
        monitors: [],
        timezone: "America/New_York",
      } as unknown as JSONObject);

      expect(parsed.timezone).toBe("America/New_York");
    });

    test.each([
      ["absent", undefined],
      ["null", null],
      ["an empty string", ""],
      ["whitespace", "   "],
      ["a number", 330],
      ["an object", { name: "Asia/Tokyo" }],
      ["an array", ["Asia/Tokyo"]],
      ["a zone nobody knows", "Mars/Olympus_Mons"],
      ["the word local", "local"],
    ])(
      "fromJSON maps a timezone that is %s to UTC",
      (_name: string, timezone: unknown) => {
        /*
         * A server that predates the field cut its buckets in UTC. Anything
         * else - and above all the viewer's own zone, which is New York in
         * this file - pairs every bar with the wrong reading.
         */
        const parsed: UptimeDailyAggregate = UptimeDailyAggregateUtil.fromJSON({
          monitors: [],
          timezone: timezone,
        } as unknown as JSONObject);

        expect(parsed.timezone).toBe("UTC");
      },
    );

    test("a zone survives toJSON -> fromJSON along with the buckets", () => {
      const parsed: UptimeDailyAggregate = UptimeDailyAggregateUtil.fromJSON(
        UptimeDailyAggregateUtil.toJSON(inZone("Asia/Kolkata")),
      );

      expect(parsed.timezone).toBe("Asia/Kolkata");
      expect(parsed.monitors[0]!.buckets).toHaveLength(2);
      expect(parsed.monitors[0]!.buckets[0]!.coveredSeconds).toBe(86400);
    });

    test("a zone survives the real wire: JSON.stringify and JSON.parse in between", () => {
      const wire: string = JSON.stringify(
        UptimeDailyAggregateUtil.toJSON(inZone("America/Los_Angeles")),
      );

      const parsed: UptimeDailyAggregate = UptimeDailyAggregateUtil.fromJSON(
        JSON.parse(wire) as JSONObject,
      );

      expect(parsed.timezone).toBe("America/Los_Angeles");
    });

    test("an aggregate without a zone round trips as a UTC one", () => {
      const parsed: UptimeDailyAggregate = UptimeDailyAggregateUtil.fromJSON(
        UptimeDailyAggregateUtil.toJSON(sample()),
      );

      expect(parsed.timezone).toBe("UTC");
    });
  });

  describe("getTimezone", () => {
    test("returns the zone the aggregate carries", () => {
      expect(
        UptimeDailyAggregateUtil.getTimezone({
          ...sample(),
          timezone: "Europe/London",
        }),
      ).toBe("Europe/London");
    });

    test.each([
      ["null", null],
      ["undefined", undefined],
    ])("a %s aggregate is UTC", (_name: string, aggregate: unknown) => {
      expect(
        UptimeDailyAggregateUtil.getTimezone(
          aggregate as UptimeDailyAggregate | null | undefined,
        ),
      ).toBe("UTC");
    });

    test.each([
      ["absent", undefined],
      ["an empty string", ""],
      ["whitespace", "  "],
      ["a zone nobody knows", "Nowhere/Special"],
    ])(
      "an aggregate whose zone is %s is UTC",
      (_name: string, timezone: string | undefined) => {
        expect(
          UptimeDailyAggregateUtil.getTimezone({
            ...sample(),
            timezone: timezone,
          }),
        ).toBe("UTC");
      },
    );

    test("never falls back to the viewer's own zone", () => {
      // precondition: this file runs in New York (see the docblock).
      expect(new Date("2026-07-01T12:00:00.000Z").getTimezoneOffset()).toBe(
        240,
      );

      expect(UptimeDailyAggregateUtil.getTimezone(null)).toBe("UTC");
      expect(
        UptimeDailyAggregateUtil.getTimezone({
          ...sample(),
          timezone: "not a zone",
        }),
      ).not.toBe("America/New_York");
    });
  });

  describe("isValidTimezone", () => {
    test.each([["UTC"], ["Asia/Tokyo"], ["America/New_York"], ["Etc/GMT+5"]])(
      "%s is a valid zone",
      (timezone: string) => {
        expect(UptimeDailyAggregateUtil.isValidTimezone(timezone)).toBe(true);
      },
    );

    test.each([
      ["an empty string", ""],
      ["whitespace", "   "],
      ["an unknown zone", "Not/AZone"],
      ["local", "local"],
      ["a number", 42],
      ["null", null],
      ["undefined", undefined],
      ["an object", {}],
      ["an array holding a zone", ["UTC"]],
      ["a boolean", true],
    ])("%s is not a valid zone", (_name: string, timezone: unknown) => {
      expect(UptimeDailyAggregateUtil.isValidTimezone(timezone)).toBe(false);
    });
  });

  /*
   * ROOT CAUSE 2: the header uptime percentage (and every group roll-up) was
   * computed from the timeline rows the page receives, which arrive under a
   * 10,000 row cap across every monitor on the page - about five days of a
   * sixty day window on status.chainflip.io. It read 99.876% for a monitor
   * whose sixty days were 99.667%. getUptimePercent measures the same buckets
   * the bars are painted from. It did not exist before the fix, so every test
   * in this block fails against the old code.
   */
  describe("getUptimePercent", () => {
    test("no buckets is no reading, not 100%", () => {
      expect(
        UptimeDailyAggregateUtil.getUptimePercent({
          buckets: [],
          downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
          precision: UptimePrecision.TWO_DECIMAL,
        }),
      ).toBeNull();
    });

    test("buckets that cover nothing are no reading, even if they carry durations", () => {
      /*
       * null is what lets a caller fall back to the rows. A zero-coverage
       * bucket's durations are not trusted: the server never sends them, and
       * counting them would report downtime for time nobody watched.
       */
      expect(
        UptimeDailyAggregateUtil.getUptimePercent({
          buckets: [
            dayBucket(0, 0, []),
            dayBucket(1, 0, [[STATUS_OFFLINE, 5000]]),
            dayBucket(2, -10, [[STATUS_OFFLINE, 10]]),
          ],
          downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
          precision: UptimePrecision.TWO_DECIMAL,
        }),
      ).toBeNull();
    });

    test.each([
      [UptimePrecision.NO_DECIMAL],
      [UptimePrecision.ONE_DECIMAL],
      [UptimePrecision.TWO_DECIMAL],
      [UptimePrecision.THREE_DECIMAL],
    ])(
      "a window spent entirely Operational is 100 at %s",
      (precision: UptimePrecision) => {
        const buckets: Array<UptimeDayBucket> = [];

        for (let d: number = 0; d < 60; d++) {
          buckets.push(coveredDay(d));
        }

        expect(
          UptimeDailyAggregateUtil.getUptimePercent({
            buckets: buckets,
            downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
            precision: precision,
          }),
        ).toBe(100);
      },
    );

    test("downtime is measured over the seconds covered: an uncovered half day is not counted as up", () => {
      /*
       * The first bucket is half covered (the monitor was created at noon,
       * or the window clips it). Covered: 43,200 + 86,400 = 129,600 s, 8,640
       * of them Offline -> 93.33%. Dividing by the buckets' 172,800 day
       * seconds would read 95% - the unwatched half counted as uptime.
       */
      const percent: number | null = UptimeDailyAggregateUtil.getUptimePercent({
        buckets: [
          dayBucket(0, 43200, [[STATUS_UP, 43200]]),
          coveredDay(1, STATUS_OFFLINE, 8640),
        ],
        downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
        precision: UptimePrecision.TWO_DECIMAL,
      });

      expect(percent).toBe(
        UptimeUtil.roundToPrecision({
          number: ((129600 - 8640) / 129600) * 100,
          precision: UptimePrecision.TWO_DECIMAL,
        }),
      );
      expect(percent).toBe(93.33);
      expect(percent).not.toBe(95);
    });

    test("downtime in a half covered day is not diluted by the half nobody watched", () => {
      /*
       * 43,200 s Offline in a half covered first day, then a clean day.
       * 43,200 / 129,600 down -> 66.66%. Over the day seconds it would read
       * 75%. The no-data days of a monitor younger than the window add
       * nothing either way.
       */
      const buckets: Array<UptimeDayBucket> = [];

      for (let d: number = 0; d < 58; d++) {
        buckets.push(dayBucket(d, 0, []));
      }

      buckets.push(dayBucket(58, 43200, [[STATUS_OFFLINE, 43200]]));
      buckets.push(coveredDay(59));

      const percent: number | null = UptimeDailyAggregateUtil.getUptimePercent({
        buckets: buckets,
        downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
        precision: UptimePrecision.TWO_DECIMAL,
      });

      expect(percent).toBe(66.66);
      expect(percent).not.toBe(75);
    });

    test("every downtime status is summed and statuses that are not downtime are ignored", () => {
      /*
       * 3,600 Degraded + 1,800 Offline = 5,400 of 86,400 down -> 93.75%.
       * The 1,000 s of Maintenance is covered time the page does not count
       * as downtime, so it stays in the numerator.
       */
      const percent: number | null = UptimeDailyAggregateUtil.getUptimePercent({
        buckets: [
          dayBucket(0, DAY_SECONDS, [
            [STATUS_UP, 80000],
            [STATUS_DEGRADED, 3600],
            [STATUS_OFFLINE, 1800],
            [STATUS_MAINTENANCE, 1000],
          ]),
        ],
        downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
        precision: UptimePrecision.TWO_DECIMAL,
      });

      expect(percent).toBe(93.75);
    });

    test("an empty downtime list means every covered second counts as up", () => {
      expect(
        UptimeDailyAggregateUtil.getUptimePercent({
          buckets: chainflipBuckets(),
          downtimeMonitorStatusIds: [],
          precision: UptimePrecision.THREE_DECIMAL,
        }),
      ).toBe(100);
    });

    test("downtime ids are accepted as ObjectIDs, strings, or a mix", () => {
      const buckets: Array<UptimeDayBucket> = [
        dayBucket(0, DAY_SECONDS, [
          [STATUS_UP, 81000],
          [STATUS_DEGRADED, 3600],
          [STATUS_OFFLINE, 1800],
        ]),
      ];

      const idLists: Array<Array<ObjectID | string>> = [
        [STATUS_DEGRADED, STATUS_OFFLINE],
        [new ObjectID(STATUS_DEGRADED), new ObjectID(STATUS_OFFLINE)],
        [new ObjectID(STATUS_DEGRADED), STATUS_OFFLINE],
      ];

      for (const ids of idLists) {
        expect(
          UptimeDailyAggregateUtil.getUptimePercent({
            buckets: buckets,
            downtimeMonitorStatusIds: ids,
            precision: UptimePrecision.TWO_DECIMAL,
          }),
        ).toBe(93.75);
      }
    });

    test("a downtime id listed twice is not counted twice", () => {
      expect(
        UptimeDailyAggregateUtil.getUptimePercent({
          buckets: [coveredDay(0, STATUS_OFFLINE, 8640)],
          downtimeMonitorStatusIds: [
            STATUS_OFFLINE,
            STATUS_OFFLINE,
            new ObjectID(STATUS_OFFLINE),
          ],
          precision: UptimePrecision.TWO_DECIMAL,
        }),
      ).toBe(90);
    });

    test("a negative duration is ignored rather than handing time back", () => {
      /*
       * 3,600 s Offline and a corrupt -3,600 s Degraded. Summed naively the
       * day would be down for 0 s and read 100%.
       */
      expect(
        UptimeDailyAggregateUtil.getUptimePercent({
          buckets: [
            dayBucket(0, DAY_SECONDS, [
              [STATUS_UP, DAY_SECONDS - 3600],
              [STATUS_OFFLINE, 3600],
              [STATUS_DEGRADED, -3600],
            ]),
          ],
          downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
          precision: UptimePrecision.TWO_DECIMAL,
        }),
      ).toBe(95.83);
    });

    test("a bucket cannot be down for longer than it was covered", () => {
      /*
       * The first bucket claims 7,200 s Offline in 3,600 s of coverage. It is
       * clamped per bucket to 3,600, so 3,600 of 90,000 covered seconds are
       * down -> 96%. Clamping only the total would let this bucket eat an
       * hour of the next day's uptime and read 92%.
       */
      const percent: number | null = UptimeDailyAggregateUtil.getUptimePercent({
        buckets: [
          dayBucket(0, 3600, [[STATUS_OFFLINE, 7200]], 3600),
          coveredDay(1),
        ],
        downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
        precision: UptimePrecision.TWO_DECIMAL,
      });

      expect(percent).toBe(96);
      expect(percent).not.toBe(92);
    });

    test("never reports below 0%", () => {
      expect(
        UptimeDailyAggregateUtil.getUptimePercent({
          buckets: [
            dayBucket(0, 100, [
              [STATUS_OFFLINE, 1000],
              [STATUS_DEGRADED, 500],
            ]),
          ],
          downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
          precision: UptimePrecision.THREE_DECIMAL,
        }),
      ).toBe(0);
    });

    test.each([
      [UptimePrecision.NO_DECIMAL, 99],
      [UptimePrecision.ONE_DECIMAL, 99.9],
      [UptimePrecision.TWO_DECIMAL, 99.99],
      [UptimePrecision.THREE_DECIMAL, 99.991],
    ])(
      "7 s down in a day is floored at %s to %s, like UptimeUtil.roundToPrecision",
      (precision: UptimePrecision, expected: number) => {
        const raw: number = ((DAY_SECONDS - 7) / DAY_SECONDS) * 100;

        const percent: number | null =
          UptimeDailyAggregateUtil.getUptimePercent({
            buckets: [coveredDay(0, STATUS_OFFLINE, 7)],
            downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
            precision: precision,
          });

        expect(percent).toBe(
          UptimeUtil.roundToPrecision({ number: raw, precision: precision }),
        );
        expect(percent).toBe(expected);
      },
    );

    test.each([
      [UptimePrecision.NO_DECIMAL, 99],
      [UptimePrecision.ONE_DECIMAL, 99.9],
      [UptimePrecision.TWO_DECIMAL, 99.99],
      [UptimePrecision.THREE_DECIMAL, 99.999],
    ])(
      "one second down in ten days is floored at %s to %s, never rounded up to 100",
      (precision: UptimePrecision, expected: number) => {
        // 99.99988...% - rounding to nearest would say 100 at every precision.
        const buckets: Array<UptimeDayBucket> = [
          coveredDay(0, STATUS_OFFLINE, 1),
        ];

        for (let d: number = 1; d < 10; d++) {
          buckets.push(coveredDay(d));
        }

        expect(
          UptimeDailyAggregateUtil.getUptimePercent({
            buckets: buckets,
            downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
            precision: precision,
          }),
        ).toBe(expected);
      },
    );

    test("the chainflip monitor: sixty covered days with 17,270 s down read 99.666 at three decimals", () => {
      /*
       * The production numbers. The page's header showed 99.876%, computed
       * from the five days of rows that survived the 10,000 row cap.
       */
      const coveredSeconds: number = CHAINFLIP_DAYS * DAY_SECONDS;
      const expected: number =
        Math.floor(
          ((coveredSeconds - CHAINFLIP_DOWNTIME_SECONDS) / coveredSeconds) *
            100 *
            1000,
        ) / 1000;

      const percent: number | null = UptimeDailyAggregateUtil.getUptimePercent({
        buckets: chainflipBuckets(),
        downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
        precision: UptimePrecision.THREE_DECIMAL,
      });

      expect(percent).toBe(expected);
      expect(percent).toBe(99.666);
      expect(percent).not.toBe(99.876);
    });

    test("the chainflip fixture really holds 17,270 s of downtime in 60 covered days", () => {
      // guards the fixture the test above depends on.
      const buckets: Array<UptimeDayBucket> = chainflipBuckets();
      let covered: number = 0;
      let down: number = 0;

      for (const bucket of buckets) {
        covered += bucket.coveredSeconds;

        for (const duration of bucket.statusDurations) {
          if (
            DOWNTIME_STATUS_IDS.includes(duration.monitorStatusId.toString())
          ) {
            down += duration.seconds;
          }
        }
      }

      expect(buckets).toHaveLength(CHAINFLIP_DAYS);
      expect(covered).toBe(CHAINFLIP_DAYS * DAY_SECONDS);
      expect(down).toBe(CHAINFLIP_DOWNTIME_SECONDS);
    });
  });
});
