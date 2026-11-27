import ObjectID from "Common/Types/ObjectID";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";

/*
 * THE TELEMETRY SCHEDULER, RUN FOR AN HOUR AND MORE OF SIMULATED TIME
 * (issue #11060).
 *
 * The cron registration (ScheduleTelemetryMonitorEvaluations) is read for
 * the schedule the scheduler runs on and the function it runs, and both are
 * run as the Worker queue runs them: one run at a time (CronLock), each
 * starting a little after its tick, on a clock the test moves. The monitors
 * live in memory (MonitorTelemetryMonitorSpreadHarness), and the
 * scheduler's statements are applied to them as Postgres applies them. A
 * few hundred monitors - most with no interval (every minute, as the
 * Dashboard makes them), others every minute, 2 minutes, 5 minutes and
 * every hour - start where the scheduler before #11060 left them. These
 * hold:
 *
 *   - THE SPIKE IS GONE: after the first minute, the evaluations start
 *     spread over the minute - not 94% of them in its first 10 seconds, as
 *     the customer measured, and the scheduler before #11060 did (it queued
 *     every one at the start of the minute) - and no second holds more than
 *     a few times its share;
 *   - each monitor keeps its own interval: from the first minute on, every
 *     two evaluations of a monitor are its interval apart, within the
 *     scheduler's step - none skipped, none twice. Before #11060 a monitor
 *     with no interval waited a second minute whenever the scheduler's next
 *     run started earlier after its tick than the last one;
 *   - each keeps the same moment of every interval, through a restart (a
 *     new process works it out again) and on another replica;
 *   - a run that dies part way, two runs that race (a lock that failed
 *     open), and a queue that refuses jobs neither skip an evaluation nor
 *     queue one twice: the next run queues what was left, late by at most a
 *     tick.
 *
 * Run against the scheduler before #11060 (its two files from main before
 * this change), 11 of these 12 fail: every evaluation started in the first
 * second of the minute, and each monitor with no interval waited 119.9
 * seconds between evaluations, skipping a minute every time.
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const mockQuery: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneById: jest.fn(),
      getEnabledMonitorQuery: jest.fn(() => {
        return {};
      }),
      getRepository: jest.fn(() => {
        return { manager: { query: mockQuery } };
      }),
    },
  };
});

jest.mock(
  "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: { addTelemetryMonitorEvaluationJob: jest.fn() },
    };
  },
);

// The cron registration, captured: its schedule and the function it runs.
jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return { __esModule: true, default: jest.fn() };
});

import MonitorService from "Common/Server/Services/MonitorService";
import CronTab from "Common/Server/Utils/CronTab";
import TelemetryQueueService from "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";
import "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/ScheduleTelemetryMonitorEvaluations";
import {
  FROM,
  HOUR_MS,
  MINUTE_MS,
  ON_TIME_MS,
  SECOND_MS,
  SETTLED,
  SchedulerRun,
  SpreadHarness,
  circularSpread,
  gapsOf,
  tickEveryMs,
  total,
} from "./MonitorTelemetryMonitorSpreadHarness";

const registration: Array<unknown> | undefined = (
  RunCron as unknown as jest.Mock
).mock.calls.find((call: Array<unknown>): boolean => {
  return call[0] === "TelemetryMonitor:MonitorTelemetryMonitor";
});

const SCHEDULER_SCHEDULE: string = (registration![1] as { schedule: string })
  .schedule;

const findBy: jest.Mock = MonitorService.findBy as unknown as jest.Mock;
const enqueueJob: jest.Mock =
  TelemetryQueueService.addTelemetryMonitorEvaluationJob as unknown as jest.Mock;

const harness: SpreadHarness = new SpreadHarness({
  findBy,
  query: mockQuery,
  enqueueJob,
  schedule: SCHEDULER_SCHEDULE,
  runScheduler: registration![2] as SchedulerRun,
  projectId: new ObjectID("11060000-0000-4000-8000-0000000000ff"),
});

describe("The telemetry scheduler over an hour and more of simulated time", () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: FROM,
      doNotFake: [
        "performance",
        "hrtime",
        "nextTick",
        "setImmediate",
        "queueMicrotask",
      ],
    });

    mockQuery.mockReset();
    findBy.mockReset();
    enqueueJob.mockReset();

    harness.seed();
    harness.serveFromTheStore();
    harness.applyStatementsToTheStore();
    harness.recordDispatches();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("runs every 10 seconds", () => {
    expect(tickEveryMs(SCHEDULER_SCHEDULE)).toBe(10 * SECOND_MS);
  });

  test("THE SPIKE IS GONE: after the first minute, evaluations start spread over the minute, not in its first seconds", async () => {
    await harness.simulate({ minutes: 70, random: seededRandom(11060) });

    const seconds: Array<number> = harness.bySecondOfTheMinute(SETTLED);
    const queued: number = total(seconds);
    const firstTen: number = total(seconds.slice(0, 10));
    const perSecond: number = queued / 60;

    // 300 monitors for 67 minutes: about 17,000 evaluations.
    expect(queued).toBeGreaterThan(15000);

    // The customer measured 94% in the first 10 seconds; a sixth is even.
    expect(firstTen / queued).toBeLessThan(0.25);

    // No second of the minute holds more than about twice its share.
    expect(Math.max(...seconds)).toBeLessThan(2.5 * perSecond);

    /*
     * Never more than a handful in one second: 300 monitors, about 4.3
     * evaluations a second. The scheduler before #11060 queued 250 or more
     * in the first second of every minute.
     */
    expect(harness.busiestSecond(SETTLED)).toBeLessThanOrEqual(20);
  });

  test("the first minute after the upgrade still starts the evaluations the old scheduler had due together - once - and from then on each at its own moment", async () => {
    await harness.simulate({ minutes: 4, random: seededRandom(7) });

    // The old stamps: due together, at 08:58:00 and 08:58:00.037.
    expect(harness.busiestSecond(FROM)).toBeGreaterThan(200);
    expect(harness.busiestSecond(SETTLED)).toBeLessThanOrEqual(20);
  });

  test("each monitor keeps its own interval: every two evaluations its interval apart - a minute, 2 minutes, 5 minutes, an hour - none skipped, none twice", async () => {
    await harness.simulate({ minutes: 130, random: seededRandom(2718) });

    // From the first evaluation at its own moment on.
    expect(
      harness.offIntervalGaps({ from: SETTLED, toleranceMs: ON_TIME_MS }),
    ).toEqual([]);

    // Over an hour, exactly as many evaluations as the interval has runs.
    const counts: Map<string, number> = harness.countsIn(
      FROM + 10 * MINUTE_MS,
      FROM + 70 * MINUTE_MS,
    );

    for (const id of harness.sortedIds) {
      expect([id, counts.get(id)]).toEqual([
        id,
        HOUR_MS / harness.intervalOf(id),
      ]);
    }
  });

  test("the upgrade itself skips no evaluation: no monitor waits longer than its interval between its old moment and its new one", async () => {
    await harness.simulate({ minutes: 12, random: seededRandom(3) });

    for (const id of harness.sortedIds) {
      const times: Array<number> = harness.timesOf(id);

      expect(times.length).toBeGreaterThan(0);

      for (const gap of gapsOf(times)) {
        expect(gap).toBeLessThanOrEqual(harness.intervalOf(id) + ON_TIME_MS);
      }
    }
  });

  test("a monitor checked every minute keeps the same second of every minute; one checked every 2 or 5 minutes the same moment of every interval", async () => {
    await harness.simulate({ minutes: 30, random: seededRandom(99) });

    for (const id of harness.sortedIds) {
      const times: Array<number> = harness.timesOf(id, SETTLED);

      if (harness.intervalOf(id) > 5 * MINUTE_MS || times.length < 2) {
        continue;
      }

      const moments: Array<number> = times.map((time: number): number => {
        return time % harness.intervalOf(id);
      });

      // On the interval's circle: a moment at :59.9 queued late is :00.2.
      expect(circularSpread(moments, harness.intervalOf(id))).toBeLessThan(
        ON_TIME_MS,
      );
    }
  });

  test("a restart, or another replica, keeps every monitor's moment: the moments are worked out again from nothing before every run", async () => {
    await harness.simulate({
      minutes: 20,
      random: seededRandom(4),
      beforeRun: () => {
        CronTab.clearNextExecutionMemo();
      },
    });

    expect(
      harness.offIntervalGaps({ from: SETTLED, toleranceMs: ON_TIME_MS }),
    ).toEqual([]);
  });

  test("two runs that race at every tick - a lock that failed open - queue each evaluation once", async () => {
    await harness.simulate({
      minutes: 20,
      random: seededRandom(5),
      runsPerTick: 2,
    });

    expect(
      harness.offIntervalGaps({ from: SETTLED, toleranceMs: ON_TIME_MS }),
    ).toEqual([]);

    const counts: Map<string, number> = harness.countsIn(
      FROM + 5 * MINUTE_MS,
      FROM + 15 * MINUTE_MS,
    );

    // Every monitor whose interval fits the 10 minutes a whole number of times.
    for (const id of harness.sortedIds) {
      if ((10 * MINUTE_MS) % harness.intervalOf(id) === 0) {
        expect([id, counts.get(id)]).toEqual([
          id,
          (10 * MINUTE_MS) / harness.intervalOf(id),
        ]);
      }
    }
  });

  test("a worker that dies part way through a run skips no evaluation and queues none twice: the next run queues what it left, late by at most a tick", async () => {
    const random: SeededRandom = seededRandom(6);

    await harness.simulate({
      minutes: 30,
      random: random,
      // One run in five dies, somewhere in its 10 seconds.
      diesAfterMs: (run: number): number | null => {
        return run % 5 === 3 ? 500 + random(9000) : null;
      },
    });

    const late: number = 10 * SECOND_MS + ON_TIME_MS;

    for (const id of harness.sortedIds) {
      for (const gap of gapsOf(harness.timesOf(id, SETTLED))) {
        // Never skipped: at most a tick late.
        expect(gap).toBeLessThanOrEqual(harness.intervalOf(id) + late);
        // Never twice: an evaluation late by a tick is followed on time.
        expect(gap).toBeGreaterThanOrEqual(harness.intervalOf(id) - late);
      }
    }
  });

  test("a queue that refuses some jobs skips no evaluation: a refused monitor is due again, and the next run queues it", async () => {
    const random: SeededRandom = seededRandom(8);
    const refusedLastTime: Set<string> = new Set<string>();
    let refused: number = 0;

    // One job in fifty refused; a refused job's next try goes through.
    harness.recordDispatches({
      refuses: (monitorId: string): boolean => {
        if (refusedLastTime.delete(monitorId)) {
          return false;
        }

        if (random(50) === 0) {
          refusedLastTime.add(monitorId);
          refused++;
          return true;
        }

        return false;
      },
    });

    await harness.simulate({ minutes: 30, random: seededRandom(9) });

    expect(refused).toBeGreaterThan(50);

    const late: number = 10 * SECOND_MS + ON_TIME_MS;

    for (const id of harness.sortedIds) {
      for (const gap of gapsOf(harness.timesOf(id, SETTLED))) {
        // Queued at the next run: late by a tick, and on time after.
        expect(gap).toBeLessThanOrEqual(harness.intervalOf(id) + late);
        expect(gap).toBeGreaterThanOrEqual(harness.intervalOf(id) - late);
      }
    }
  });

  test("a queue that keeps refusing a monitor's job tries it again every run, and its evaluation comes as soon as the queue takes it", async () => {
    const stubborn: string = harness.sortedIds[0]!;
    let refusals: number = 0;

    // The first monitor's job refused at its first five tries after 09:05.
    harness.recordDispatches({
      refuses: (monitorId: string): boolean => {
        if (
          monitorId === stubborn &&
          Date.now() >= FROM + 7 * MINUTE_MS &&
          refusals < 5
        ) {
          refusals++;
          return true;
        }

        return false;
      },
    });

    await harness.simulate({ minutes: 12, random: seededRandom(12) });

    expect(refusals).toBe(5);

    const gaps: Array<number> = gapsOf(harness.timesOf(stubborn, SETTLED));

    // Five runs refused: the evaluation came at the sixth, 50 seconds late.
    expect(Math.max(...gaps)).toBeGreaterThan(MINUTE_MS + 45 * SECOND_MS);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(
      MINUTE_MS + 5 * 10 * SECOND_MS + ON_TIME_MS,
    );

    // And none after it lost: back to its own moment, once a minute.
    const afterIt: Array<number> = gaps.slice(
      gaps.indexOf(Math.max(...gaps)) + 1,
    );

    expect(afterIt.length).toBeGreaterThan(2);
    for (const gap of afterIt.slice(1)) {
      expect(Math.abs(gap - MINUTE_MS)).toBeLessThanOrEqual(ON_TIME_MS);
    }
  });

  test("nothing is queued before it is due: every evaluation at or after its monitor's moment of the interval", async () => {
    // Each monitor's due time when it was queued, as the store had it.
    const dueWhenQueued: Array<[number, number]> = [];

    harness.recordDispatches({
      onQueued: (monitorId: string): void => {
        const next: Date = harness.store.get(monitorId)!.nextMonitorAt!;

        // Stamped already, with the next run: the one queued is an interval before.
        dueWhenQueued.push([
          Date.now(),
          next.getTime() - harness.intervalOf(monitorId),
        ]);
      },
    });

    await harness.simulate({ minutes: 15, random: seededRandom(10) });

    const fromOwnMoments: Array<[number, number]> = dueWhenQueued.filter(
      ([queuedAt]: [number, number]) => {
        return queuedAt >= SETTLED;
      },
    );

    expect(fromOwnMoments.length).toBeGreaterThan(3000);

    for (const [queuedAt, dueAt] of fromOwnMoments) {
      expect(queuedAt).toBeGreaterThanOrEqual(dueAt);
      expect(queuedAt - dueAt).toBeLessThan(ON_TIME_MS);
    }
  });
});
