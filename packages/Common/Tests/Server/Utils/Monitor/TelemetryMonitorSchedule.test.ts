/** @timezone UTC */
import TelemetryMonitorSchedule, {
  CADENCE_REFERENCE_DATE,
  EVERY_MINUTE_SCHEDULE,
  TELEMETRY_MONITOR_MAX_SPREAD_MS,
  TELEMETRY_MONITOR_MIN_CADENCE_MS,
  TelemetryMonitorScheduleReading,
} from "../../../../Server/Utils/Monitor/TelemetryMonitorSchedule";
import CronTab from "../../../../Server/Utils/CronTab";
import ObjectID from "../../../../Types/ObjectID";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { currentZone } from "../../TestingUtils/CronTabMemoCases";
import {
  expectRunsToBeTheSchedulesMoved,
  monitorIdFrom,
} from "../../TestingUtils/TelemetryMonitorScheduleCases";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * WHEN A TELEMETRY MONITOR RUNS (issue #11060).
 *
 * Every telemetry monitor on a schedule used to be due at the same instant,
 * so every evaluation of an installation started in the first seconds of
 * each minute. Each now runs at its own moment of its interval: its
 * schedule's runs, each moved later by the same offset, a hash of its ID.
 * These hold:
 *
 *   - the phase is the same for the same ID however it is written, and the
 *     IDs of an installation are spread evenly over the interval;
 *   - what an interval means: every minute with none, its cadence (the
 *     shortest gap between its runs) and the spread (the cadence, at most 5
 *     minutes) for each kind of schedule, a human cadence read as its cron,
 *     one faster than a minute run every minute, an unreadable one every
 *     minute and said to be unreadable;
 *   - a monitor's runs are its schedule's runs moved by its offset, each the
 *     first after the instant asked from - none skipped, none twice - so the
 *     time between two runs is exactly its schedule's;
 *   - nothing the process keeps changes the answer: a restart, or another
 *     replica, works out the same runs.
 */

const START: number = Date.UTC(2026, 10, 26, 9, 41, 17, 250);

/*
 * The offsets of the first four sequentialIds, every minute: worked out
 * once and written out, so a change to the hash - which would move every
 * monitor of every installation to another moment on upgrade - fails here.
 */
const GOLDEN_EVERY_MINUTE_OFFSETS_MS: Array<number> = [
  21855, 20461, 31800, 49280,
];
const SECOND_IN_MS: number = 1000;
const MINUTE_IN_MS: number = 60 * SECOND_IN_MS;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

function monitorIds(seed: number, count: number): Array<string> {
  const random: SeededRandom = seededRandom(seed);

  return Array.from({ length: count }, (): string => {
    return monitorIdFrom(random);
  });
}

// IDs one after another, as a sequence or a test fixture hands them out.
function sequentialIds(count: number): Array<string> {
  return Array.from({ length: count }, (_: unknown, index: number): string => {
    return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  });
}

function runsOf(data: {
  monitorId: string;
  monitoringInterval: string | null | undefined;
  from: number;
  count: number;
  onUnreadable?: () => void;
}): Array<number> {
  const runs: Array<number> = [];
  let after: number = data.from;

  for (let index: number = 0; index < data.count; index++) {
    after = TelemetryMonitorSchedule.getNextRunAt({
      monitorId: data.monitorId,
      monitoringInterval: data.monitoringInterval,
      after: new Date(after),
      onUnreadable: data.onUnreadable,
    }).getTime();
    runs.push(after);
  }

  return runs;
}

function gapsOf(runs: Array<number>): Array<number> {
  return runs.slice(1).map((run: number, index: number): number => {
    return run - runs[index]!;
  });
}

describe("TelemetryMonitorSchedule", () => {
  beforeEach(() => {
    TelemetryMonitorSchedule.clearReadings();
    CronTab.clearNextExecutionMemo();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    TelemetryMonitorSchedule.clearReadings();
    CronTab.clearNextExecutionMemo();
  });

  test("this file runs in UTC", () => {
    expect(currentZone()).toBe("UTC");
  });

  describe("a monitor's phase", () => {
    test("is from 0 up to, not including, 1, and the same for the same ID however it is written", () => {
      for (const id of monitorIds(11060, 500)) {
        const phase: number = TelemetryMonitorSchedule.getPhase(id);

        expect(phase).toBeGreaterThanOrEqual(0);
        expect(phase).toBeLessThan(1);
        expect(TelemetryMonitorSchedule.getPhase(new ObjectID(id))).toBe(phase);
        expect(TelemetryMonitorSchedule.getPhase(id.toUpperCase())).toBe(phase);
        expect(TelemetryMonitorSchedule.getPhase(` ${id} `)).toBe(phase);
      }
    });

    test("is the same in every release: the moment a monitor has does not move on an upgrade", () => {
      // Worked out once; a change to the hash would move every monitor.
      const offsets: Array<number> = sequentialIds(4).map(
        (id: string): number => {
          return TelemetryMonitorSchedule.getOffsetInMs({
            monitorId: id,
            reading: TelemetryMonitorSchedule.read(null),
          });
        },
      );

      expect(offsets).toEqual(
        sequentialIds(4).map((id: string): number => {
          return Math.floor(TelemetryMonitorSchedule.getPhase(id) * 60000);
        }),
      );
      expect(offsets).toEqual(GOLDEN_EVERY_MINUTE_OFFSETS_MS);
    });

    test("is spread evenly over the interval, for IDs drawn at random and for IDs one after another", () => {
      for (const ids of [monitorIds(2718, 6000), sequentialIds(6000)]) {
        const buckets: Array<number> = new Array<number>(60).fill(0);

        for (const id of ids) {
          buckets[Math.floor(TelemetryMonitorSchedule.getPhase(id) * 60)]! += 1;
        }

        // 100 a bucket: each second of a minute within 40% of it.
        expect(Math.min(...buckets)).toBeGreaterThanOrEqual(60);
        expect(Math.max(...buckets)).toBeLessThanOrEqual(140);

        const chiSquare: number = buckets.reduce(
          (sum: number, count: number): number => {
            return sum + ((count - 100) * (count - 100)) / 100;
          },
          0,
        );

        // 59 degrees of freedom: 100 is past the 99.9th percentile.
        expect(chiSquare).toBeLessThan(100);
      }
    });

    test("tells IDs that differ in one character apart", () => {
      const phases: Set<string> = new Set<string>();

      for (const id of sequentialIds(1000)) {
        phases.add(TelemetryMonitorSchedule.getPhase(id).toFixed(9));
      }

      expect(phases.size).toBe(1000);
    });
  });

  describe("what a monitor's interval means", () => {
    test.each([[undefined], [null], [""], ["   "]])(
      "none (%p) is every minute, spread over the minute",
      (value: string | null | undefined) => {
        expect(TelemetryMonitorSchedule.read(value)).toEqual({
          cron: EVERY_MINUTE_SCHEDULE,
          cadenceInMs: MINUTE_IN_MS,
          spreadInMs: MINUTE_IN_MS,
          isReadable: true,
        });
      },
    );

    test.each([
      ["* * * * *", MINUTE_IN_MS, MINUTE_IN_MS],
      ["*/2 * * * *", 2 * MINUTE_IN_MS, 2 * MINUTE_IN_MS],
      ["*/5 * * * *", 5 * MINUTE_IN_MS, 5 * MINUTE_IN_MS],
      /*
       * A 7-minute step: 7 minutes from the reference on (its 4-minute gap
       * at the hour is a run later than the cadence reads).
       */
      ["*/7 * * * *", 7 * MINUTE_IN_MS, TELEMETRY_MONITOR_MAX_SPREAD_MS],
      ["*/10 * * * *", 10 * MINUTE_IN_MS, TELEMETRY_MONITOR_MAX_SPREAD_MS],
      ["*/15 * * * *", 15 * MINUTE_IN_MS, TELEMETRY_MONITOR_MAX_SPREAD_MS],
      ["*/30 * * * *", 30 * MINUTE_IN_MS, TELEMETRY_MONITOR_MAX_SPREAD_MS],
      // Its runs 10 and 50 minutes apart: the shorter is its cadence.
      ["0,10 * * * *", 10 * MINUTE_IN_MS, TELEMETRY_MONITOR_MAX_SPREAD_MS],
      ["0 * * * *", HOUR_IN_MS, TELEMETRY_MONITOR_MAX_SPREAD_MS],
      ["0 */2 * * *", 2 * HOUR_IN_MS, TELEMETRY_MONITOR_MAX_SPREAD_MS],
      ["0 */12 * * *", 12 * HOUR_IN_MS, TELEMETRY_MONITOR_MAX_SPREAD_MS],
      ["0 0 * * *", DAY_IN_MS, TELEMETRY_MONITOR_MAX_SPREAD_MS],
      // Weekdays at 9: a day apart, and three over the weekend.
      ["0 9 * * 1-5", DAY_IN_MS, TELEMETRY_MONITOR_MAX_SPREAD_MS],
      ["0 0 * * 0", 7 * DAY_IN_MS, TELEMETRY_MONITOR_MAX_SPREAD_MS],
    ])(
      "%s: a cadence of %d ms, spread over %d ms",
      (schedule: string, cadenceInMs: number, spreadInMs: number) => {
        expect(TelemetryMonitorSchedule.read(schedule)).toEqual({
          cron: schedule,
          cadenceInMs: cadenceInMs,
          spreadInMs: spreadInMs,
          isReadable: true,
        });
      },
    );

    test("a cadence written in words is read as its cron, as the probe scheduler reads one", () => {
      for (const value of ["5m", "Every 5 minutes", "every 5 minutes"]) {
        expect(TelemetryMonitorSchedule.read(value)).toEqual({
          cron: "*/5 * * * *",
          cadenceInMs: 5 * MINUTE_IN_MS,
          spreadInMs: 5 * MINUTE_IN_MS,
          isReadable: true,
        });
      }

      // And its runs are the cron's.
      const id: string = monitorIds(31, 1)[0]!;

      expect(
        runsOf({
          monitorId: id,
          monitoringInterval: "5m",
          from: START,
          count: 5,
        }),
      ).toEqual(
        runsOf({
          monitorId: id,
          monitoringInterval: "*/5 * * * *",
          from: START,
          count: 5,
        }),
      );
    });

    test("a schedule faster than once a minute, as one stored before they were refused, runs every minute", () => {
      for (const schedule of [
        "*/30 * * * * *",
        "* * * * * *",
        "0,30 * * * * *",
      ]) {
        expect(TelemetryMonitorSchedule.read(schedule)).toEqual({
          cron: EVERY_MINUTE_SCHEDULE,
          cadenceInMs: TELEMETRY_MONITOR_MIN_CADENCE_MS,
          spreadInMs: MINUTE_IN_MS,
          isReadable: true,
        });

        expect(
          gapsOf(
            runsOf({
              monitorId: monitorIds(5, 1)[0]!,
              monitoringInterval: schedule,
              from: START,
              count: 10,
            }),
          ),
        ).toEqual(new Array<number>(9).fill(MINUTE_IN_MS));
      }
    });

    test("a schedule with seconds that is a minute or slower is its own", () => {
      expect(TelemetryMonitorSchedule.read("30 */2 * * * *")).toEqual({
        cron: "30 */2 * * * *",
        cadenceInMs: 2 * MINUTE_IN_MS,
        spreadInMs: 2 * MINUTE_IN_MS,
        isReadable: true,
      });
    });

    test("an interval that cannot be read runs every minute, and says so on every run", () => {
      for (const value of [
        "not-a-valid-cron",
        "every fortnight-ish",
        "0 0 30 2 *",
      ]) {
        const reading: TelemetryMonitorScheduleReading =
          TelemetryMonitorSchedule.read(value);

        expect(reading).toEqual({
          cron: EVERY_MINUTE_SCHEDULE,
          cadenceInMs: MINUTE_IN_MS,
          spreadInMs: MINUTE_IN_MS,
          isReadable: false,
        });

        const onUnreadable: ReturnType<typeof jest.fn> = jest.fn();
        const runs: Array<number> = runsOf({
          monitorId: monitorIds(7, 1)[0]!,
          monitoringInterval: value,
          from: START,
          count: 4,
          onUnreadable: onUnreadable as unknown as () => void,
        });

        expect(onUnreadable).toHaveBeenCalledTimes(4);
        expect(gapsOf(runs)).toEqual([
          MINUTE_IN_MS,
          MINUTE_IN_MS,
          MINUTE_IN_MS,
        ]);
      }
    });

    test("a readable interval never calls onUnreadable", () => {
      const onUnreadable: ReturnType<typeof jest.fn> = jest.fn();

      runsOf({
        monitorId: monitorIds(8, 1)[0]!,
        monitoringInterval: "*/5 * * * *",
        from: START,
        count: 3,
        onUnreadable: onUnreadable as unknown as () => void,
      });
      runsOf({
        monitorId: monitorIds(8, 1)[0]!,
        monitoringInterval: null,
        from: START,
        count: 3,
        onUnreadable: onUnreadable as unknown as () => void,
      });

      expect(onUnreadable).not.toHaveBeenCalled();
    });

    test("is worked out once per interval, and the same after it is forgotten", () => {
      const first: TelemetryMonitorScheduleReading =
        TelemetryMonitorSchedule.read("*/5 * * * *");

      expect(TelemetryMonitorSchedule.read("*/5 * * * *")).toBe(first);

      TelemetryMonitorSchedule.clearReadings();

      const again: TelemetryMonitorScheduleReading =
        TelemetryMonitorSchedule.read("*/5 * * * *");

      expect(again).not.toBe(first);
      expect(again).toEqual(first);
    });

    test("measures its cadence from a fixed instant, whatever the time is", () => {
      jest.useFakeTimers({
        now: CADENCE_REFERENCE_DATE.getTime() + 37 * DAY_IN_MS,
      });

      try {
        // Measured from the reference, a Monday: 10 then 50 minutes apart.
        expect(TelemetryMonitorSchedule.read("0,10 * * * *").cadenceInMs).toBe(
          10 * MINUTE_IN_MS,
        );
        expect(TelemetryMonitorSchedule.read("0 9 * * 1-5").cadenceInMs).toBe(
          DAY_IN_MS,
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("a monitor's runs", () => {
    test("are its schedule's runs, each moved by its offset: every run the first after the instant asked, none skipped, none twice", () => {
      const held: number = expectRunsToBeTheSchedulesMoved({
        monitorIds: [...monitorIds(1, 12), ...sequentialIds(4)],
        from: START,
        runs: 40,
        random: seededRandom(101),
      });

      expect(held).toBeGreaterThan(7000);
    });

    test("are exactly as far apart as its schedule's: a minute, 2 minutes, 5 minutes, an hour, a day", () => {
      for (const [schedule, gap] of [
        [null, MINUTE_IN_MS],
        ["* * * * *", MINUTE_IN_MS],
        ["*/2 * * * *", 2 * MINUTE_IN_MS],
        ["*/5 * * * *", 5 * MINUTE_IN_MS],
        ["*/15 * * * *", 15 * MINUTE_IN_MS],
        ["0 * * * *", HOUR_IN_MS],
        ["0 0 * * *", DAY_IN_MS],
      ] as Array<[string | null, number]>) {
        for (const id of monitorIds(41, 50)) {
          const runs: Array<number> = runsOf({
            monitorId: id,
            monitoringInterval: schedule,
            from: START,
            count: 30,
          });

          expect(gapsOf(runs)).toEqual(new Array<number>(29).fill(gap));
        }
      }
    });

    test("a monitor checked every minute keeps to its own moment of the minute, and the same moment of every minute", () => {
      for (const id of monitorIds(43, 200)) {
        const offset: number = TelemetryMonitorSchedule.getOffsetInMs({
          monitorId: id,
          reading: TelemetryMonitorSchedule.read(null),
        });

        for (const run of runsOf({
          monitorId: id,
          monitoringInterval: null,
          from: START,
          count: 20,
        })) {
          expect(run % MINUTE_IN_MS).toBe(offset);
        }
      }
    });

    test("a monitor checked every 2 minutes is spread over both minutes, as #11060 asks", () => {
      const ids: Array<string> = monitorIds(47, 400);
      const minuteOfTheTwo: Array<number> = [0, 0];

      for (const id of ids) {
        const run: number = TelemetryMonitorSchedule.getNextRunAt({
          monitorId: id,
          monitoringInterval: "*/2 * * * *",
          after: new Date(START),
        }).getTime();

        // Which of the two minutes, counted from the even one.
        minuteOfTheTwo[
          Math.floor((run % (2 * MINUTE_IN_MS)) / MINUTE_IN_MS)
        ]! += 1;
      }

      expect(minuteOfTheTwo[0]).toBeGreaterThan(150);
      expect(minuteOfTheTwo[1]).toBeGreaterThan(150);
    });

    test("a monitor checked every hour or every day runs within the first 5 minutes of the hour or day its schedule names", () => {
      for (const id of monitorIds(53, 200)) {
        for (const run of runsOf({
          monitorId: id,
          monitoringInterval: "0 * * * *",
          from: START,
          count: 30,
        })) {
          expect(run % HOUR_IN_MS).toBeLessThan(
            TELEMETRY_MONITOR_MAX_SPREAD_MS,
          );
        }

        for (const run of runsOf({
          monitorId: id,
          monitoringInterval: "0 0 * * *",
          from: START,
          count: 10,
        })) {
          expect(run % DAY_IN_MS).toBeLessThan(TELEMETRY_MONITOR_MAX_SPREAD_MS);
        }

        for (const run of runsOf({
          monitorId: id,
          monitoringInterval: "0 9 * * 1-5",
          from: START,
          count: 10,
        })) {
          const day: number = new Date(run).getUTCDay();

          expect(day).toBeGreaterThanOrEqual(1);
          expect(day).toBeLessThanOrEqual(5);
          expect((run % DAY_IN_MS) - 9 * HOUR_IN_MS).toBeGreaterThanOrEqual(0);
          expect((run % DAY_IN_MS) - 9 * HOUR_IN_MS).toBeLessThan(
            TELEMETRY_MONITOR_MAX_SPREAD_MS,
          );
        }
      }
    });

    test("a monitor keeps its place in the interval when its interval changes: the same phase of a minute and of 5 minutes", () => {
      for (const id of monitorIds(59, 100)) {
        const ofAMinute: number = TelemetryMonitorSchedule.getOffsetInMs({
          monitorId: id,
          reading: TelemetryMonitorSchedule.read(null),
        });
        const ofFiveMinutes: number = TelemetryMonitorSchedule.getOffsetInMs({
          monitorId: id,
          reading: TelemetryMonitorSchedule.read("*/5 * * * *"),
        });

        expect(Math.abs(ofAMinute * 5 - ofFiveMinutes)).toBeLessThanOrEqual(5);
      }
    });

    test("the monitors of an installation start spread over the minute: no second holds more than about three times its share", () => {
      const ids: Array<string> = monitorIds(61, 3000);
      const perSecond: Array<number> = new Array<number>(60).fill(0);

      for (const id of ids) {
        const run: number = TelemetryMonitorSchedule.getNextRunAt({
          monitorId: id,
          monitoringInterval: null,
          after: new Date(START),
        }).getTime();

        perSecond[Math.floor((run % MINUTE_IN_MS) / SECOND_IN_MS)]! += 1;
      }

      // 50 a second. The old scheduler started all 3,000 in its first one.
      expect(Math.max(...perSecond)).toBeLessThan(150);
      expect(Math.min(...perSecond)).toBeGreaterThan(15);
      expect(
        perSecond.slice(0, 10).reduce((a: number, b: number) => {
          return a + b;
        }, 0) / ids.length,
      ).toBeLessThan(0.25);
    });

    test("are the same after a restart and on another replica: nothing the process keeps decides them", () => {
      const ids: Array<string> = monitorIds(67, 30);
      const schedules: Array<string | null> = [
        null,
        "*/5 * * * *",
        "0 * * * *",
        "0 9 * * 1-5",
      ];

      const workOut: () => Array<number> = (): Array<number> => {
        return ids.flatMap((id: string): Array<number> => {
          return schedules.flatMap((schedule: string | null): Array<number> => {
            return runsOf({
              monitorId: id,
              monitoringInterval: schedule,
              from: START,
              count: 5,
            });
          });
        });
      };

      const first: Array<number> = workOut();

      // A restart: nothing kept.
      TelemetryMonitorSchedule.clearReadings();
      CronTab.clearNextExecutionMemo();

      expect(workOut()).toEqual(first);

      // Later on: the same runs, whatever the time now is.
      jest.useFakeTimers({ now: START + 3 * DAY_IN_MS + 12345 });

      try {
        TelemetryMonitorSchedule.clearReadings();
        CronTab.clearNextExecutionMemo();

        expect(workOut()).toEqual(first);
      } finally {
        jest.useRealTimers();
      }
    });

    test("a run asked for right at a run is the next one; a millisecond before, that run itself", () => {
      for (const id of monitorIds(71, 50)) {
        const run: Date = TelemetryMonitorSchedule.getNextRunAt({
          monitorId: id,
          monitoringInterval: null,
          after: new Date(START),
        });

        expect(
          TelemetryMonitorSchedule.getNextRunAt({
            monitorId: id,
            monitoringInterval: null,
            after: run,
          }).getTime(),
        ).toBe(run.getTime() + MINUTE_IN_MS);

        expect(
          TelemetryMonitorSchedule.getNextRunAt({
            monitorId: id,
            monitoringInterval: null,
            after: new Date(run.getTime() - 1),
          }).getTime(),
        ).toBe(run.getTime());
      }
    });

    test("from a stamp the old scheduler wrote - the start of a minute, or a minute after its run - the next run is less than an interval away", () => {
      for (const id of monitorIds(73, 200)) {
        for (const oldStamp of [
          // A cron monitor: the start of the minute.
          Date.UTC(2026, 10, 26, 10, 0, 0, 0),
          // One with no interval: a minute after the old run began.
          Date.UTC(2026, 10, 26, 10, 0, 0, 153),
        ]) {
          const next: number = TelemetryMonitorSchedule.getNextRunAt({
            monitorId: id,
            monitoringInterval: null,
            after: new Date(oldStamp),
          }).getTime();

          expect(next).toBeGreaterThan(oldStamp);
          expect(next - oldStamp).toBeLessThanOrEqual(MINUTE_IN_MS);
        }
      }
    });
  });
});
