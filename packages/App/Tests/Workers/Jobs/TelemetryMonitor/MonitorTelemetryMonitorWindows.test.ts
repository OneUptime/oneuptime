import fs from "fs";
import ObjectID from "Common/Types/ObjectID";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";

/*
 * EVERY TELEMETRY CHECK JUDGES THE WINDOW IT WAS DUE TO, HOWEVER LATE IT
 * RUNS (issue #11248).
 *
 * The real scheduler (the cron registration of
 * ScheduleTelemetryMonitorEvaluations) queues every check of a few hundred
 * monitors, and a model of the Telemetry queue (MonitorTelemetryMonitorWindowsHarness:
 * its workers, its per-monitor deduplication, its retries and how far
 * behind its ingest is) runs the real evaluation job on each,
 * processTelemetryMonitorEvaluationFromQueue, over tens of minutes of
 * simulated time. Each monitor is a Logs monitor whose window is as long as
 * its interval - a 1-minute count checked every minute, a 5-minute count
 * every 5 minutes - so its windows should follow on from one another
 * exactly: each starting where the last ended, no time judged by no check
 * and none judged twice. Each window is read off what the check handed on
 * (MonitorResource's judgedWindow) and off its log count's own query.
 *
 * They do, while checks run late:
 *
 *   - the queue's workers are busy, with a probe's results arriving all at
 *     once ahead of them;
 *   - a run of the scheduler dies part way, and the next queues what it
 *     left a tick late;
 *   - the queue refuses a job, and the next run queues it again;
 *   - a check fails and BullMQ tries it again 5 and 10 seconds later;
 *   - all of them at once.
 *
 * Each runs again as every check judged before this change, its window
 * ending when it ran (its job with no due time): there the same lateness
 * leaves time judged by no check and time judged twice, as the issue says.
 *
 * And where the windows cannot follow on: while ingest is more than a
 * minute behind a window's end, the window ends where the queue is - never
 * judging more than a minute of data still waiting to be read - and they
 * follow on again once it catches up; while the queue is so far behind that
 * a monitor's next check comes due before its last one started, BullMQ
 * keeps the one waiting, which judges its own whole window: no time is
 * judged twice, and what goes unjudged is whole windows.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn(), getQueue: jest.fn() },
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

jest.mock("Common/Server/Services/LogService", () => {
  return { __esModule: true, default: { countBy: jest.fn() } };
});

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return { __esModule: true, default: { monitorResource: jest.fn() } };
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

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return { __esModule: true, default: jest.fn() };
});

import Monitor from "Common/Models/DatabaseModels/Monitor";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import LogService from "Common/Server/Services/LogService";
import MonitorService from "Common/Server/Services/MonitorService";
import CronTab from "Common/Server/Utils/CronTab";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import TelemetryMonitorSchedule from "Common/Server/Utils/Monitor/TelemetryMonitorSchedule";
import ReceivingCoverage from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import TelemetryIngestBacklog from "Common/Server/Utils/Telemetry/TelemetryIngestBacklog";
import Includes from "Common/Types/BaseDatabase/Includes";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import PositiveNumber from "Common/Types/PositiveNumber";
import { INGEST_BACKLOG_ALLOWANCE_MS } from "Common/Utils/Telemetry/ReceivingGaps";
import { TelemetryMonitorEvaluationJobData } from "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import TelemetryQueueService from "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";
import "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/ScheduleTelemetryMonitorEvaluations";
import { processTelemetryMonitorEvaluationFromQueue } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import {
  FROM,
  MINUTE_MS,
  ON_TIME_MS,
  POPULATION,
  Population,
  SECOND_MS,
  SETTLED,
  SchedulerRun,
  SpreadHarness,
  StoredMonitor,
} from "./MonitorTelemetryMonitorSpreadHarness";
import {
  JudgedWindow,
  QueueModelOptions,
  TelemetryQueueModel,
  TilingReport,
  WindowsSimulationOptions,
  asQueued,
  runWithQueue,
  tilingOf,
} from "./MonitorTelemetryMonitorWindowsHarness";

const registration: Array<unknown> = (
  RunCron as unknown as jest.Mock
).mock.calls.find((call: Array<unknown>): boolean => {
  return call[0] === "TelemetryMonitor:MonitorTelemetryMonitor";
})!;

const SCHEDULER_SCHEDULE: string = (registration[1] as { schedule: string })
  .schedule;
const runScheduler: SchedulerRun = registration[2] as SchedulerRun;

const findBy: jest.Mock = MonitorService.findBy as unknown as jest.Mock;
const findOneById: jest.Mock = MonitorService.findOneById as unknown as jest.Mock;
const enqueueJob: jest.Mock =
  TelemetryQueueService.addTelemetryMonitorEvaluationJob as unknown as jest.Mock;
const countBy: jest.Mock = LogService.countBy as unknown as jest.Mock;
const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "11248000-0000-4000-8000-0000000000ff",
);

const harness: SpreadHarness = new SpreadHarness({
  findBy,
  query: mockQuery,
  enqueueJob,
  schedule: SCHEDULER_SCHEDULE,
  runScheduler: runScheduler,
  projectId: PROJECT_ID,
});

// A smaller installation, for the many runs: every interval but the hour's.
const SMALL_POPULATION: Array<Population> = [
  { monitoringInterval: undefined, intervalMs: MINUTE_MS, count: 70 },
  { monitoringInterval: "* * * * *", intervalMs: MINUTE_MS, count: 15 },
  { monitoringInterval: "*/2 * * * *", intervalMs: 2 * MINUTE_MS, count: 10 },
  { monitoringInterval: "*/5 * * * *", intervalMs: 5 * MINUTE_MS, count: 5 },
];

// What every check handed on, and what each log count read.
const judged: Array<JudgedWindow> = [];
const counted: Array<JudgedWindow> = [];

// The due time each check's job carried, by job, as it ran.
const runningDueAt: Map<string, number | null> = new Map();

// Each read of how far behind ingest is, as TelemetryIngestBacklog answered it.
const backlogReads: Array<{ at: number; head: number | null }> = [];

/*
 * The stretch measured: from the first minute every monitor is at its own
 * moment, to two minutes before the end (what was queued last may not have
 * a successor).
 */
function measured(minutes: number): { from: number; to: number } {
  return { from: SETTLED + MINUTE_MS, to: FROM + (minutes - 2) * MINUTE_MS };
}

function logStepFor(stored: StoredMonitor): MonitorSteps {
  const step: MonitorStep = new MonitorStep();
  step.setLogMonitor({
    ...MonitorStepLogMonitorUtil.getDefault(),
    lastXSecondsOfLogs: stored.intervalMs / SECOND_MS,
    // Its own service, so its count says whose window it read.
    telemetryServiceIds: [new ObjectID(stored.id)],
  });

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };

  return steps;
}

/*
 * The model of the Telemetry queue, running the real evaluation job. A
 * check judged "as before" is handed its job with no due time and no
 * queuedAt: its window ends when it runs, as every check's did.
 */
function makeQueue(
  options: Omit<QueueModelOptions, "dataForEvaluation"> & {
    judgedAsBefore?: boolean | undefined;
    // A job queued before due times were carried: queuedAt alone.
    queuedAtOnly?: boolean | undefined;
  },
): TelemetryQueueModel {
  const queue: TelemetryQueueModel = new TelemetryQueueModel(
    {
      ...options,
      dataForEvaluation: (
        data: TelemetryMonitorEvaluationJobData,
      ): TelemetryMonitorEvaluationJobData => {
        if (options.judgedAsBefore) {
          return {
            monitorId: data.monitorId,
            projectId: data.projectId,
          } as TelemetryMonitorEvaluationJobData;
        }

        if (options.queuedAtOnly) {
          return {
            monitorId: data.monitorId,
            projectId: data.projectId,
            queuedAt: data.queuedAt,
          };
        }

        return data;
      },
    },
    async (data: TelemetryMonitorEvaluationJobData): Promise<void> => {
      runningDueAt.set(
        data.monitorId,
        data.dueAt ? new Date(data.dueAt).getTime() : null,
      );
      await processTelemetryMonitorEvaluationFromQueue(data);
    },
  );

  jest
    .spyOn(TelemetryIngestBacklog, "getOldestWaitingSince")
    .mockImplementation(async (): Promise<Date | null> => {
      const head: Date | null = queue.oldestWaitingSince();
      backlogReads.push({ at: Date.now(), head: head?.getTime() ?? null });
      return head;
    });

  return queue;
}

/*
 * The oldest waiting job a check's plan saw: ReceivingCoverage reads it at
 * most every 10 seconds, so the last read at or before the check ran.
 */
function backlogSeenAt(atMs: number): number | null {
  let seen: number | null = null;

  for (const read of backlogReads) {
    if (read.at > atMs) {
      break;
    }

    seen = read.head;
  }

  return seen;
}

/*
 * The scheduler's jobs onto the model's queue: as the queue keeps them, the
 * dates as text. One the queue refuses throws, as Queue.addJob would.
 */
function queueTheScheduler(
  queue: TelemetryQueueModel,
  refuses?: ((monitorId: string) => boolean) | undefined,
): void {
  enqueueJob.mockImplementation(
    async (job: {
      monitorId: ObjectID;
      projectId?: ObjectID | undefined;
      dueAt?: Date | undefined;
    }): Promise<void> => {
      const id: string = job.monitorId.toString();

      if (refuses?.(id)) {
        throw new Error("the queue refused the job");
      }

      queue.addCheck(asQueued(job));
    },
  );
}

async function simulate(data: {
  queue: TelemetryQueueModel;
  options: WindowsSimulationOptions;
}): Promise<void> {
  await runWithQueue({
    schedule: SCHEDULER_SCHEDULE,
    runScheduler: runScheduler,
    queue: data.queue,
    options: data.options,
  });
}

// A probe's results arriving all at once, every 2 minutes, at its own second.
function probeResultsEvery2Minutes(
  queue: TelemetryQueueModel,
  random: SeededRandom,
  data: { results: number; holdMs: number },
): (tick: number) => void {
  let nextAt: number = FROM + random(120) * SECOND_MS;

  return (tick: number): void => {
    if (tick >= nextAt) {
      queue.addWork(data.results, data.holdMs);
      nextAt += 2 * MINUTE_MS;
    }
  };
}

/*
 * What each run measured, written as JSON to TELEMETRY_WINDOWS_REPORT_FILE
 * when it is set: the numbers the pull request quotes.
 */
const reports: Record<string, Record<string, number>> = {};

function keep(
  name: string,
  report: TilingReport,
  queue: TelemetryQueueModel,
): TilingReport {
  reports[name] = {
    ...report,
    longestWaitMs: queue.longestWaitMs,
    retried: queue.counts.retried,
    droppedWhileWaiting: queue.counts.droppedWhileWaiting,
  };

  return report;
}

afterAll(() => {
  const file: string | undefined = process.env["TELEMETRY_WINDOWS_REPORT_FILE"];

  if (file) {
    fs.writeFileSync(file, JSON.stringify(reports, null, 2));
  }
});

/*
 * Checks dropped because the monitor's last still waited, once every monitor
 * is at its own moment. The first minute after the upgrade has some: the
 * scheduler before #11060 left every monitor due at once, and a monitor
 * whose own moment comes a few seconds later can find that check still
 * waiting behind the rest.
 */
function droppedAfterTheUpgrade(queue: TelemetryQueueModel): Array<number> {
  return queue.droppedAt.filter((at: number): boolean => {
    return at >= SETTLED;
  });
}

// The monitor's own moments: a window that ends on one ends on its schedule.
function endsOnItsOwnMoment(window: JudgedWindow): boolean {
  const stored: StoredMonitor = harness.store.get(window.monitorId)!;

  return (
    TelemetryMonitorSchedule.getNextRunAt({
      monitorId: window.monitorId,
      monitoringInterval: stored.monitoringInterval,
      after: new Date(window.endsAt - 1),
    }).getTime() === window.endsAt
  );
}

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
  countBy.mockReset();
  monitorResource.mockReset();
  findOneById.mockReset();
  judged.length = 0;
  counted.length = 0;
  runningDueAt.clear();
  backlogReads.length = 0;

  ReceivingCoverage.clearCache();
  TelemetryMonitorSchedule.clearReadings();
  CronTab.clearNextExecutionMemo();

  // No receiving ledger to read: OneUptime received throughout.
  jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(false);

  findOneById.mockImplementation(
    async (args: { id: ObjectID }): Promise<Monitor | null> => {
      const stored: StoredMonitor | undefined = harness.store.get(
        args.id.toString(),
      );

      if (!stored) {
        return null;
      }

      const monitor: Monitor = new Monitor(new ObjectID(stored.id));
      monitor.projectId = PROJECT_ID;
      monitor.monitorType = MonitorType.Logs;
      monitor.monitorSteps = logStepFor(stored);
      return monitor;
    },
  );

  countBy.mockImplementation(
    async (args: {
      query: { time: InBetween<Date>; primaryEntityId: Includes };
    }): Promise<PositiveNumber> => {
      const monitorId: string = String(args.query.primaryEntityId.values[0]);

      counted.push({
        monitorId: monitorId,
        startsAt: new Date(args.query.time.startValue as Date).getTime(),
        endsAt: new Date(args.query.time.endValue as Date).getTime(),
        ranAt: Date.now(),
        dueAt: runningDueAt.get(monitorId) ?? null,
      });

      return new PositiveNumber(0);
    },
  );

  monitorResource.mockImplementation(
    async (
      response: { monitorId: ObjectID },
      options: { judgedWindow: { startsAt: Date; endsAt: Date } },
    ): Promise<null> => {
      const monitorId: string = response.monitorId.toString();

      judged.push({
        monitorId: monitorId,
        startsAt: options.judgedWindow.startsAt.getTime(),
        endsAt: options.judgedWindow.endsAt.getTime(),
        ranAt: Date.now(),
        dueAt: runningDueAt.get(monitorId) ?? null,
      });

      return null;
    },
  );

  harness.seed(SMALL_POPULATION);
  harness.serveFromTheStore();
  harness.applyStatementsToTheStore();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

jest.setTimeout(10 * 60 * 1000);

// Busy workers: a probe's 120 results at once, every 2 minutes, ahead of the checks.
function busyQueue(
  random: SeededRandom,
  judgedAsBefore: boolean,
): { queue: TelemetryQueueModel; atTick: (tick: number) => void } {
  const queue: TelemetryQueueModel = makeQueue({
    workers: 6,
    holdMs: (): number => {
      return 200 + random(2300);
    },
    judgedAsBefore,
  });

  return {
    queue,
    atTick: probeResultsEvery2Minutes(queue, random, {
      results: 120,
      holdMs: 450,
    }),
  };
}

describe("Telemetry checks that run late judge the windows they were due to (#11248)", () => {
  test("busy workers: checks start up to ten seconds and more late, and every monitor's windows follow on exactly", async () => {
    const random: SeededRandom = seededRandom(11248);
    const { queue, atTick } = busyQueue(random, false);
    queueTheScheduler(queue);

    await simulate({ queue, options: { minutes: 30, random, atTick } });

    // The checks did run late, and none so late that the next was due first.
    expect(queue.longestWaitMs).toBeGreaterThan(8 * SECOND_MS);
    expect(droppedAfterTheUpgrade(queue)).toEqual([]);

    const report: TilingReport = keep("busy workers", tilingOf(judged, measured(30)), queue);

    // 100 monitors over 25 minutes: about 2,000 windows, none broken.
    expect(report.windows).toBeGreaterThan(1800);
    expect(report).toMatchObject({ breaks: 0, gapMs: 0, overlapMs: 0 });

    // Each ends when its job said it was due: from the upgrade's last old
    // stamp on, its monitor's own moment.
    for (const window of judged) {
      expect(window.endsAt).toBe(window.dueAt);

      if (window.endsAt >= SETTLED) {
        expect(endsOnItsOwnMoment(window)).toBe(true);
      }
    }

    // And each log count read exactly that window.
    expect(counted).toEqual(judged);
  });

  test("busy workers, as every check judged before: time judged by no check, and time judged twice", async () => {
    const random: SeededRandom = seededRandom(11248);
    const { queue, atTick } = busyQueue(random, true);
    queueTheScheduler(queue);

    await simulate({ queue, options: { minutes: 30, random, atTick } });

    const report: TilingReport = keep(
      "busy workers, as before",
      tilingOf(judged, measured(30)),
      queue,
    );

    // Measured: 666 of 2,185 broken, 21 minutes unjudged and 19 judged twice.
    expect(report.windows).toBeGreaterThan(1800);
    expect(report.breaks).toBeGreaterThan(report.windows / 5);
    // Seconds unjudged after one late check, and judged twice before the next.
    expect(report.largestGapMs).toBeGreaterThan(5 * SECOND_MS);
    expect(report.largestOverlapMs).toBeGreaterThan(5 * SECOND_MS);
    expect(report.gapMs).toBeGreaterThan(10 * MINUTE_MS);
    expect(report.overlapMs).toBeGreaterThan(10 * MINUTE_MS);
  });

  test("a run of the scheduler that dies part way: the next queues what it left a tick late, and the windows still follow on exactly", async () => {
    const random: SeededRandom = seededRandom(6);
    const queue: TelemetryQueueModel = makeQueue({
      workers: 50,
      holdMs: (): number => {
        return 50;
      },
    });
    queueTheScheduler(queue);

    await simulate({
      queue,
      options: {
        minutes: 30,
        random,
        // One run in five dies, somewhere in its 10 seconds.
        diesAfterMs: (run: number): number | null => {
          return run % 5 === 3 ? 500 + random(9000) : null;
        },
      },
    });

    const lateRuns: Array<JudgedWindow> = judged.filter(
      (window: JudgedWindow) => {
        return window.ranAt - window.endsAt > 2 * SECOND_MS;
      },
    );

    expect(lateRuns.length).toBeGreaterThan(100);
    expect(keep("a run that dies part way", tilingOf(judged, measured(30)), queue)).toMatchObject({
      breaks: 0,
      gapMs: 0,
      overlapMs: 0,
    });
  });

  test("a run of the scheduler that dies part way, as every check judged before: the late checks' windows break", async () => {
    const random: SeededRandom = seededRandom(6);
    const queue: TelemetryQueueModel = makeQueue({
      workers: 50,
      holdMs: (): number => {
        return 50;
      },
      judgedAsBefore: true,
    });
    queueTheScheduler(queue);

    await simulate({
      queue,
      options: {
        minutes: 30,
        random,
        diesAfterMs: (run: number): number | null => {
          return run % 5 === 3 ? 500 + random(9000) : null;
        },
      },
    });

    const report: TilingReport = keep("a run that dies part way, as before", tilingOf(judged, measured(30)), queue);

    expect(report.breaks).toBeGreaterThan(100);
    expect(report.largestGapMs).toBeGreaterThan(2 * SECOND_MS);
    expect(report.largestOverlapMs).toBeGreaterThan(2 * SECOND_MS);
  });

  test("a queue that refuses jobs: the next run queues each again, and its window is still the one it was due to", async () => {
    const random: SeededRandom = seededRandom(8);
    const refusedLastTime: Set<string> = new Set<string>();
    let refused: number = 0;
    const queue: TelemetryQueueModel = makeQueue({
      workers: 50,
      holdMs: (): number => {
        return 50;
      },
    });

    // One job in forty refused; some refused twice running.
    queueTheScheduler(queue, (monitorId: string): boolean => {
      if (refusedLastTime.delete(monitorId)) {
        return random(3) === 0;
      }

      if (random(40) === 0) {
        refusedLastTime.add(monitorId);
        refused++;
        return true;
      }

      return false;
    });

    await simulate({ queue, options: { minutes: 30, random } });

    expect(refused).toBeGreaterThan(30);
    expect(keep("refused jobs", tilingOf(judged, measured(30)), queue)).toMatchObject({
      breaks: 0,
      gapMs: 0,
      overlapMs: 0,
    });

    // Checks queued 10 and 20 seconds late judged the window they were due to.
    expect(
      judged.some((window: JudgedWindow) => {
        return window.ranAt - window.endsAt >= 9 * SECOND_MS;
      }),
    ).toBe(true);
    for (const window of judged) {
      expect(window.endsAt).toBe(window.dueAt);
    }
  });

  test("a queue that refuses jobs, as every check judged before: the retried checks' windows break", async () => {
    const random: SeededRandom = seededRandom(8);
    const queue: TelemetryQueueModel = makeQueue({
      workers: 50,
      holdMs: (): number => {
        return 50;
      },
      judgedAsBefore: true,
    });

    queueTheScheduler(queue, (): boolean => {
      return random(40) === 0;
    });

    await simulate({ queue, options: { minutes: 30, random } });

    const report: TilingReport = keep("refused jobs, as before", tilingOf(judged, measured(30)), queue);

    expect(report.breaks).toBeGreaterThan(30);
    expect(report.largestGapMs).toBeGreaterThan(9 * SECOND_MS);
    expect(report.largestOverlapMs).toBeGreaterThan(9 * SECOND_MS);
  });

  test("a check that fails is tried again 5 and 10 seconds later with the same job, and judges the same window", async () => {
    const random: SeededRandom = seededRandom(15);
    const queue: TelemetryQueueModel = makeQueue({
      workers: 50,
      holdMs: (): number => {
        return 300;
      },
      // One check in fifteen fails its first try, one in a hundred its second.
      fails: (_monitorId: string, attempt: number): boolean => {
        if (attempt === 1) {
          return random(15) === 0;
        }

        return attempt === 2 && random(7) === 0;
      },
    });
    queueTheScheduler(queue);

    await simulate({ queue, options: { minutes: 30, random } });

    expect(queue.counts.retried).toBeGreaterThan(50);
    expect(queue.counts.failed).toBe(0);
    expect(droppedAfterTheUpgrade(queue)).toEqual([]);
    expect(keep("failed checks tried again", tilingOf(judged, measured(30)), queue)).toMatchObject({
      breaks: 0,
      gapMs: 0,
      overlapMs: 0,
    });
    expect(
      judged.some((window: JudgedWindow) => {
        return window.ranAt - window.endsAt >= 5 * SECOND_MS;
      }),
    ).toBe(true);
  });

  test("a check that fails and is tried again, as every check judged before: its window moved with it", async () => {
    const random: SeededRandom = seededRandom(15);
    const queue: TelemetryQueueModel = makeQueue({
      workers: 50,
      holdMs: (): number => {
        return 300;
      },
      fails: (_monitorId: string, attempt: number): boolean => {
        return attempt === 1 && random(15) === 0;
      },
      judgedAsBefore: true,
    });
    queueTheScheduler(queue);

    await simulate({ queue, options: { minutes: 30, random } });

    const report: TilingReport = keep("failed checks tried again, as before", tilingOf(judged, measured(30)), queue);

    expect(report.breaks).toBeGreaterThan(50);
    expect(report.largestGapMs).toBeGreaterThanOrEqual(5 * SECOND_MS);
    expect(report.largestOverlapMs).toBeGreaterThanOrEqual(5 * SECOND_MS);
  });

  test("everything at once - busy workers, dying runs, refused jobs and failed checks - over 300 monitors and an hour: the windows follow on exactly", async () => {
    harness.seed(POPULATION);

    const random: SeededRandom = seededRandom(2025);
    const queue: TelemetryQueueModel = makeQueue({
      workers: 12,
      holdMs: (): number => {
        return 150 + random(1800);
      },
      fails: (_monitorId: string, attempt: number): boolean => {
        return attempt === 1 && random(30) === 0;
      },
    });
    const atTick: (tick: number) => void = probeResultsEvery2Minutes(
      queue,
      random,
      { results: 300, holdMs: 350 },
    );

    queueTheScheduler(queue, (): boolean => {
      return random(60) === 0;
    });

    await simulate({
      queue,
      options: {
        minutes: 62,
        random,
        atTick,
        diesAfterMs: (run: number): number | null => {
          return run % 7 === 4 ? 500 + random(9000) : null;
        },
      },
    });

    expect(queue.counts.retried).toBeGreaterThan(100);
    expect(queue.longestWaitMs).toBeGreaterThan(5 * SECOND_MS);
    expect(droppedAfterTheUpgrade(queue)).toEqual([]);

    const report: TilingReport = keep("everything at once, 300 monitors, an hour", tilingOf(judged, measured(62)), queue);

    // 300 monitors, most every minute, for an hour.
    expect(report.windows).toBeGreaterThan(14000);
    expect(report).toMatchObject({ breaks: 0, gapMs: 0, overlapMs: 0 });
  });

  test("jobs queued before due times were carried judge the window that ends when they were queued: within the scheduler's step of their own", async () => {
    const random: SeededRandom = seededRandom(31);
    const queue: TelemetryQueueModel = makeQueue({
      workers: 6,
      holdMs: (): number => {
        return 200 + random(2300);
      },
      queuedAtOnly: true,
    });
    const atTick: (tick: number) => void = probeResultsEvery2Minutes(
      queue,
      random,
      { results: 120, holdMs: 450 },
    );
    queueTheScheduler(queue);

    await simulate({ queue, options: { minutes: 20, random, atTick } });

    // Late as the busy queue makes them, and still all but on their windows.
    expect(queue.longestWaitMs).toBeGreaterThan(8 * SECOND_MS);

    const report: TilingReport = keep("jobs from before due times were carried", tilingOf(judged, measured(20)), queue);

    expect(report.windows).toBeGreaterThan(1000);
    expect(report.largestGapMs).toBeLessThan(ON_TIME_MS);
    expect(report.largestOverlapMs).toBeLessThan(ON_TIME_MS);
  });
});

describe("Where windows cannot follow on (#11248)", () => {
  /*
   * Bulk telemetry is read only once monitoring work is done, so ingest can
   * fall behind while checks run on time. Minutes 10 to 12 it is 72 seconds
   * behind while every check runs 20 to 30 seconds late - so each window's
   * end is within the minute of where ingest is - and minutes 14 to 18 it is
   * stuck minutes behind.
   */
  function backlogQueue(judgedAsBefore: boolean): TelemetryQueueModel {
    return makeQueue({
      workers: 50,
      holdMs: (): number => {
        return 50;
      },
      bulkHeadAt: (now: number): number | null => {
        if (now >= FROM + 10 * MINUTE_MS && now < FROM + 12 * MINUTE_MS) {
          return now - 72 * SECOND_MS;
        }

        if (now >= FROM + 14 * MINUTE_MS && now < FROM + 18 * MINUTE_MS) {
          return FROM + 13 * MINUTE_MS;
        }

        return null;
      },
      judgedAsBefore,
    });
  }

  /*
   * While ingest is a little behind, the queue refuses each check until it
   * is 20 to 30 seconds late: the next runs queue it then.
   */
  function lateWhileALittleBehind(
    random: SeededRandom,
  ): (monitorId: string) => boolean {
    const refusedUntil: Map<string, number> = new Map();

    return (monitorId: string): boolean => {
      const now: number = Date.now();

      if (now < FROM + 10 * MINUTE_MS || now >= FROM + 12 * MINUTE_MS) {
        return false;
      }

      if (!refusedUntil.has(monitorId)) {
        refusedUntil.set(monitorId, now + 20 * SECOND_MS + random(11) * SECOND_MS);
      }

      if (now < refusedUntil.get(monitorId)!) {
        return true;
      }

      refusedUntil.delete(monitorId);
      return false;
    };
  }

  test("ingest more than a minute behind a window's end: the window ends where the queue is, never past a minute of unread data, and once it catches up they follow on again", async () => {
    const random: SeededRandom = seededRandom(81);
    const queue: TelemetryQueueModel = backlogQueue(false);

    queueTheScheduler(queue, lateWhileALittleBehind(random));

    await simulate({ queue, options: { minutes: 26, random } });

    // Never a window holding more than a minute of data still waiting.
    for (const window of judged) {
      const head: number | null = backlogSeenAt(window.ranAt);

      if (head !== null) {
        expect(window.endsAt - head).toBeLessThanOrEqual(
          INGEST_BACKLOG_ALLOWANCE_MS,
        );
      }
      expect(window.endsAt).toBeLessThanOrEqual(window.dueAt!);
    }

    // The checks did run late while ingest was a little behind.
    expect(
      judged.filter((window: JudgedWindow) => {
        return (
          window.ranAt >= FROM + 10 * MINUTE_MS &&
          window.ranAt < FROM + 12 * MINUTE_MS &&
          window.ranAt - window.dueAt! >= 20 * SECOND_MS
        );
      }).length,
    ).toBeGreaterThan(100);

    // Stuck minutes behind: held back to where the queue is.
    const heldBack: Array<JudgedWindow> = judged.filter(
      (window: JudgedWindow) => {
        return window.endsAt < window.dueAt!;
      },
    );

    expect(heldBack.length).toBeGreaterThan(200);
    for (const window of heldBack) {
      expect(window.ranAt).toBeGreaterThanOrEqual(FROM + 14 * MINUTE_MS);
      expect(window.ranAt).toBeLessThan(FROM + 18 * MINUTE_MS + 10 * SECOND_MS);
    }

    // A little behind, with checks 20 to 40 seconds late: still their own windows.
    expect(
      keep(
        "ingest a little behind, checks 20 to 30 s late",
        tilingOf(judged, {
          from: SETTLED + MINUTE_MS,
          to: FROM + 13 * MINUTE_MS,
        }),
        queue,
      ),
    ).toMatchObject({ breaks: 0, gapMs: 0, overlapMs: 0 });

    // Caught up: following on again, two minutes after.
    expect(
      keep(
        "ingest caught up again",
        tilingOf(judged, {
          from: FROM + 20 * MINUTE_MS,
          to: FROM + 24 * MINUTE_MS,
        }),
        queue,
      ),
    ).toMatchObject({ breaks: 0, gapMs: 0, overlapMs: 0 });
  });

  test("ingest a little behind, as every check judged before: late checks were held back to where the queue was, and their windows broke", async () => {
    const random: SeededRandom = seededRandom(81);
    const queue: TelemetryQueueModel = backlogQueue(true);

    queueTheScheduler(queue, lateWhileALittleBehind(random));

    await simulate({ queue, options: { minutes: 26, random } });

    const report: TilingReport = keep(
      "ingest a little behind, as before",
      tilingOf(judged, {
        from: SETTLED + MINUTE_MS,
        to: FROM + 13 * MINUTE_MS,
      }),
      queue,
    );

    expect(report.breaks).toBeGreaterThan(50);
    expect(report.largestGapMs).toBeGreaterThan(10 * SECOND_MS);
    expect(report.largestOverlapMs).toBeGreaterThan(10 * SECOND_MS);
  });

  /*
   * One worker, and each check holding it 1.5 seconds: about 100 checks a
   * minute queued for about 40 a minute of work. A monitor's next check
   * comes due while its last still waits, and BullMQ keeps the one waiting.
   */
  function overloadedQueue(judgedAsBefore: boolean): TelemetryQueueModel {
    return makeQueue({
      workers: 1,
      holdMs: (): number => {
        return 1500;
      },
      judgedAsBefore,
    });
  }

  test("a queue so far behind that a monitor's next check comes due before its last one started: no time is judged twice, and what goes unjudged is whole windows", async () => {
    const random: SeededRandom = seededRandom(99);
    const queue: TelemetryQueueModel = overloadedQueue(false);
    queueTheScheduler(queue);

    await simulate({ queue, options: { minutes: 20, random } });

    expect(queue.counts.droppedWhileWaiting).toBeGreaterThan(500);
    expect(queue.longestWaitMs).toBeGreaterThan(MINUTE_MS);

    const report: TilingReport = keep("overloaded queue", tilingOf(judged, measured(20)), queue);

    expect(report.overlapMs).toBe(0);
    expect(report.gapMs).toBeGreaterThan(0);

    // Every window a whole window of its own, however late it ran.
    for (const window of judged) {
      const stored: StoredMonitor = harness.store.get(window.monitorId)!;

      expect(window.endsAt).toBe(window.dueAt);
      expect(window.endsAt - window.startsAt).toBe(stored.intervalMs);

      if (window.endsAt >= SETTLED) {
        expect(endsOnItsOwnMoment(window)).toBe(true);
      }
    }

    // So what went unjudged between two windows is whole intervals of it.
    const byMonitor: Map<string, Array<JudgedWindow>> = new Map();

    for (const window of judged) {
      byMonitor.set(window.monitorId, [
        ...(byMonitor.get(window.monitorId) || []),
        window,
      ]);
    }

    for (const [monitorId, windows] of byMonitor) {
      const intervalMs: number = harness.store.get(monitorId)!.intervalMs;
      const settled: Array<JudgedWindow> = windows
        .filter((window: JudgedWindow) => {
          return window.endsAt >= SETTLED;
        })
        .sort((a: JudgedWindow, b: JudgedWindow): number => {
          return a.endsAt - b.endsAt;
        });

      for (let index: number = 1; index < settled.length; index++) {
        const between: number =
          settled[index]!.startsAt - settled[index - 1]!.endsAt;

        expect(between).toBeGreaterThanOrEqual(0);
        expect(between % intervalMs).toBe(0);
      }
    }
  });

  test("the same queue, as every check judged before: each window ends wherever the check ran, and the time between them is any length", async () => {
    const random: SeededRandom = seededRandom(99);
    const queue: TelemetryQueueModel = overloadedQueue(true);
    queueTheScheduler(queue);

    await simulate({ queue, options: { minutes: 20, random } });

    const report: TilingReport = keep("overloaded queue, as before", tilingOf(judged, measured(20)), queue);

    expect(report.breaks).toBeGreaterThan(0);
    expect(
      judged.filter((window: JudgedWindow) => {
        return !endsOnItsOwnMoment(window);
      }).length,
    ).toBeGreaterThan(judged.length / 2);

    // Gaps that are no whole number of the monitor's windows.
    let partGaps: number = 0;
    const byMonitor: Map<string, Array<JudgedWindow>> = new Map();

    for (const window of judged) {
      byMonitor.set(window.monitorId, [
        ...(byMonitor.get(window.monitorId) || []),
        window,
      ]);
    }

    for (const [monitorId, windows] of byMonitor) {
      const intervalMs: number = harness.store.get(monitorId)!.intervalMs;
      windows.sort((a: JudgedWindow, b: JudgedWindow): number => {
        return a.endsAt - b.endsAt;
      });

      for (let index: number = 1; index < windows.length; index++) {
        if ((windows[index]!.startsAt - windows[index - 1]!.endsAt) % intervalMs !== 0) {
          partGaps++;
        }
      }
    }

    expect(partGaps).toBeGreaterThan(100);
  });
});
