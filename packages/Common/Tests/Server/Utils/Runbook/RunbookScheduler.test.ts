import ProjectService from "../../../../Server/Services/ProjectService";
import RunbookExecutionService from "../../../../Server/Services/RunbookExecutionService";
import RunbookService from "../../../../Server/Services/RunbookService";
import logger from "../../../../Server/Utils/Logger";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import RunbookScheduler, {
  RUNBOOK_SCHEDULE_SELECT,
  RunbookScheduledTimeOutcome,
  RunbookSchedulerClass,
  RunbookSchedulerPassResult,
} from "../../../../Server/Utils/Runbook/RunbookScheduler";
import RunbookStarter, {
  RUNBOOK_START_SELECT,
} from "../../../../Server/Utils/Runbook/RunbookStarter";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import ObjectID from "../../../../Types/ObjectID";
import RunbookExecutionStatus from "../../../../Types/Runbook/RunbookExecutionStatus";
import {
  RunbookScheduleMissedRunPolicy,
  RunbookScheduleOverlapPolicy,
} from "../../../../Types/Runbook/RunbookSchedule";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import RunbookTriggerType from "../../../../Types/Runbook/RunbookTriggerType";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../../TestingUtils/InMemoryRepository";
import { getJestSpyOn } from "../../../Spy";
import type { SpyInstance } from "jest-mock";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE WORKER THAT STARTS SCHEDULED RUNS, against in-memory tables.
 *
 * The real scheduler and the real start path (RunbookStarter) run over a
 * Runbook table and a RunbookExecution table held in memory, with a
 * compare-and-set that, like Postgres's single UPDATE, checks and writes in
 * one step - so two passes started at once really race for each due time.
 * What is checked: a due time starts exactly one run, recorded as the
 * Schedule's, however many Workers look; times OneUptime missed; a run that
 * is still going; waiting runs; refusals and failures; and whole nights
 * across daylight saving time changes, pass by pass, a minute apart.
 *
 * RunbookSchedulerPostgres runs the claim against a real Postgres.
 */

const PROJECT_ID: string = "1f6e8b6a-3c1e-4b1e-9b1e-000000000001";
const RUNBOOK_ID: string = "2a7f9c7b-4d2f-4c2f-8c2f-000000000002";
const OTHER_RUNBOOK_ID: string = "3b8a0d8c-5e3a-4d3a-9d3a-000000000003";

const MINUTE: number = 60 * 1000;

const at: (iso: string) => Date = (iso: string): Date => {
  return new Date(iso);
};

let runbooks: InMemoryTable;
let executions: InMemoryTable;
let enqueued: Array<string>;
let isBlocked: boolean;

function sameValue(stored: unknown, expected: unknown): boolean {
  if (
    (stored === null || stored === undefined) &&
    (expected === null || expected === undefined)
  ) {
    return true;
  }

  if (stored === null || stored === undefined) {
    return false;
  }

  if (expected === null || expected === undefined) {
    return false;
  }

  if (stored instanceof Date || expected instanceof Date) {
    return (
      new Date(stored as Date).getTime() ===
      new Date(expected as Date).getTime()
    );
  }

  return String(stored) === String(expected);
}

/*
 * The compare-and-set as Postgres runs it: the expected values are checked
 * and the new ones written in one step, with no await in between.
 */
function useAtomicCompareAndSet(table: InMemoryTable): void {
  getJestSpyOn(
    RunbookService,
    "compareAndSetColumnsByIdWithoutHooks",
  ).mockImplementation(
    async (input: {
      id: ObjectID;
      data: Record<string, unknown>;
      expectedData: Record<string, unknown>;
    }): Promise<boolean> => {
      const row: StoredRow | undefined = table.get(input.id);

      if (!row) {
        return false;
      }

      for (const [column, value] of Object.entries(input.expectedData)) {
        if (!sameValue(row[column], value)) {
          return false;
        }
      }

      Object.assign(row, input.data);
      table.updates.push({ id: String(row["_id"]), set: { ...input.data } });

      return true;
    },
  );
}

function runbookRow(overrides: StoredRow = {}): StoredRow {
  return {
    _id: RUNBOOK_ID,
    projectId: PROJECT_ID,
    name: "Rotate the logs",
    slug: "rotate-the-logs",
    steps: [
      {
        id: "step-1",
        order: 1,
        type: RunbookStepType.Manual,
        title: "Check the disk",
        config: {},
      },
    ],
    isEnabled: true,
    isScheduleEnabled: true,
    scheduleCron: "0 9 * * *",
    scheduleTimezone: "UTC",
    scheduleOverlapPolicy: RunbookScheduleOverlapPolicy.Skip,
    scheduleMissedRunPolicy: RunbookScheduleMissedRunPolicy.RunOnce,
    scheduleNextRunAt: at("2026-10-15T09:00:00.000Z"),
    scheduleQueuedRunAt: null,
    version: 1,
    ...overrides,
  };
}

function activeRun(runbookId: string = RUNBOOK_ID): StoredRow {
  return {
    _id: ObjectID.generate().toString(),
    projectId: PROJECT_ID,
    runbookId: runbookId,
    runbookNameSnapshot: "Rotate the logs",
    status: RunbookExecutionStatus.WaitingForManualStep,
    triggerType: RunbookTriggerType.Manual,
    version: 1,
  };
}

function scheduledRuns(): Array<StoredRow> {
  return executions.rows.filter((row: StoredRow) => {
    return row["triggerType"] === RunbookTriggerType.Schedule;
  });
}

function stored(column: string, id: string = RUNBOOK_ID): unknown {
  return runbooks.get(id)?.[column];
}

function storedDate(column: string, id: string = RUNBOOK_ID): string | null {
  const value: unknown = stored(column, id);

  return value ? new Date(value as Date).toISOString() : null;
}

function setUp(rows: Array<StoredRow>, runs: Array<StoredRow> = []): void {
  runbooks = useInMemoryTable(RunbookService, rows);
  executions = useInMemoryTable(RunbookExecutionService, runs);
  useAtomicCompareAndSet(runbooks);
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  enqueued = [];
  isBlocked = false;

  RunbookStarter.registerEnqueuer(
    async (data: { runbookExecutionId: ObjectID }): Promise<void> => {
      enqueued.push(data.runbookExecutionId.toString());
    },
  );

  getJestSpyOn(ProjectService, "isProjectBlocked").mockImplementation(
    async (): Promise<boolean> => {
      return isBlocked;
    },
  );

  /*
   * A run names its runbook, which the create checks is the project's, by
   * a read of its own: the real check runs against Postgres in
   * RunbookSchedulerPostgres.
   */
  getJestSpyOn(
    ProjectScopedReferenceValidator,
    "validateReferencesBelongToProject",
  ).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a scheduled time that has come", () => {
  test("starts one run, recorded as the schedule's with the time it was due, and moves the next run on", async () => {
    setUp([runbookRow()]);

    const result: RunbookSchedulerPassResult =
      await RunbookScheduler.runDueSchedules(at("2026-10-15T09:00:20.000Z"));

    expect(result.outcomes).toEqual([
      {
        runbookId: RUNBOOK_ID,
        dueAt: "2026-10-15T09:00:00.000Z",
        outcome: RunbookScheduledTimeOutcome.Started,
      },
    ]);

    const runs: Array<StoredRow> = scheduledRuns();

    expect(runs).toHaveLength(1);
    expect(String(runs[0]!["runbookId"])).toBe(RUNBOOK_ID);
    expect(String(runs[0]!["projectId"])).toBe(PROJECT_ID);
    expect(runs[0]).toMatchObject({
      status: RunbookExecutionStatus.Scheduled,
      triggerType: RunbookTriggerType.Schedule,
      triggerDetails: { scheduledFor: "2026-10-15T09:00:00.000Z" },
      runbookNameSnapshot: "Rotate the logs",
    });
    expect(runs[0]!["triggeredByUserId"]).toBeUndefined();
    expect(runs[0]!["inputs"]).toBeUndefined();
    expect(enqueued).toEqual([String(runs[0]!["_id"])]);
    expect(storedDate("scheduleNextRunAt")).toBe("2026-10-16T09:00:00.000Z");
  });

  test("starts one run however many Workers look at it at once", async () => {
    setUp([runbookRow()]);

    const now: Date = at("2026-10-15T09:00:05.000Z");

    const passes: Array<RunbookSchedulerPassResult> = await Promise.all([
      RunbookScheduler.runDueSchedules(now),
      RunbookScheduler.runDueSchedules(now),
      RunbookScheduler.runDueSchedules(now),
      RunbookScheduler.runDueSchedules(now),
    ]);

    const outcomes: Array<RunbookScheduledTimeOutcome> = passes.flatMap(
      (pass: RunbookSchedulerPassResult) => {
        return pass.outcomes.map(
          (item: { outcome: RunbookScheduledTimeOutcome }) => {
            return item.outcome;
          },
        );
      },
    );

    expect(
      outcomes.filter((outcome: RunbookScheduledTimeOutcome) => {
        return outcome === RunbookScheduledTimeOutcome.Started;
      }),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome: RunbookScheduledTimeOutcome) => {
        return outcome === RunbookScheduledTimeOutcome.AlreadyClaimed;
      }),
    ).toHaveLength(passes.length - 1);
    expect(scheduledRuns()).toHaveLength(1);
    expect(enqueued).toHaveLength(1);
  });

  test("starts nothing for a time another Worker claimed between the read and the claim", async () => {
    setUp([runbookRow()]);

    const row: Runbook = new Runbook();
    Object.assign(row, runbookRow());

    // Someone else moved the column on after this pass read it.
    runbooks.get(RUNBOOK_ID)!["scheduleNextRunAt"] = at(
      "2026-10-16T09:00:00.000Z",
    );

    expect(
      await RunbookScheduler.runDueTime({
        runbook: row,
        now: at("2026-10-15T09:00:05.000Z"),
      }),
    ).toBe(RunbookScheduledTimeOutcome.AlreadyClaimed);
    expect(scheduledRuns()).toHaveLength(0);
  });

  test("leaves alone a time that has not come, a schedule turned off and a runbook turned off", async () => {
    setUp([
      runbookRow({ scheduleNextRunAt: at("2026-10-15T09:05:00.000Z") }),
      runbookRow({
        _id: OTHER_RUNBOOK_ID,
        slug: "other",
        isScheduleEnabled: false,
      }),
      runbookRow({
        _id: "4c9b1e9d-6f4b-4e4b-8e4b-000000000004",
        slug: "third",
        isEnabled: false,
      }),
    ]);

    const result: RunbookSchedulerPassResult =
      await RunbookScheduler.runDueSchedules(at("2026-10-15T09:01:00.000Z"));

    expect(result.outcomes).toEqual([]);
    expect(scheduledRuns()).toHaveLength(0);
  });

  test("starts each runbook's own due time, and each once", async () => {
    setUp([
      runbookRow(),
      runbookRow({
        _id: OTHER_RUNBOOK_ID,
        slug: "other",
        scheduleCron: "*/15 * * * *",
        scheduleNextRunAt: at("2026-10-15T09:00:00.000Z"),
      }),
    ]);

    await Promise.all([
      RunbookScheduler.runDueSchedules(at("2026-10-15T09:00:30.000Z")),
      RunbookScheduler.runDueSchedules(at("2026-10-15T09:00:30.000Z")),
    ]);

    expect(
      scheduledRuns()
        .map((row: StoredRow) => {
          return String(row["runbookId"]);
        })
        .sort(),
    ).toEqual([RUNBOOK_ID, OTHER_RUNBOOK_ID].sort());
    expect(storedDate("scheduleNextRunAt", OTHER_RUNBOOK_ID)).toBe(
      "2026-10-15T09:15:00.000Z",
    );
  });
});

describe("a scheduled time OneUptime missed", () => {
  test("counts as on time within the grace, and as missed after it", async () => {
    setUp([runbookRow()]);

    await RunbookScheduler.runDueSchedules(at("2026-10-15T09:04:59.000Z"));

    expect(scheduledRuns()[0]!["triggerDetails"]).toEqual({
      scheduledFor: "2026-10-15T09:00:00.000Z",
    });
  });

  test("starts one catch-up run for every time it missed, when the schedule runs missed times once", async () => {
    // Every 15 minutes, and OneUptime was down for three hours.
    setUp([
      runbookRow({
        scheduleCron: "*/15 * * * *",
        scheduleNextRunAt: at("2026-10-15T06:00:00.000Z"),
      }),
    ]);

    const result: RunbookSchedulerPassResult =
      await RunbookScheduler.runDueSchedules(at("2026-10-15T09:07:00.000Z"));

    expect(
      result.outcomes.map((item: { outcome: string }) => {
        return item.outcome;
      }),
    ).toEqual([RunbookScheduledTimeOutcome.Started]);

    const runs: Array<StoredRow> = scheduledRuns();

    expect(runs).toHaveLength(1);
    expect(runs[0]!["triggerDetails"]).toEqual({
      scheduledFor: "2026-10-15T06:00:00.000Z",
      isCatchUp: true,
    });
    // Past every time it missed: the next is the next one from now.
    expect(storedDate("scheduleNextRunAt")).toBe("2026-10-15T09:15:00.000Z");

    // And the next pass starts nothing more for the missed ones.
    await RunbookScheduler.runDueSchedules(at("2026-10-15T09:08:00.000Z"));
    expect(scheduledRuns()).toHaveLength(1);
  });

  test("starts nothing for the times it missed, when the schedule skips them", async () => {
    setUp([
      runbookRow({
        scheduleMissedRunPolicy: RunbookScheduleMissedRunPolicy.Skip,
        scheduleNextRunAt: at("2026-10-14T09:00:00.000Z"),
      }),
    ]);

    const result: RunbookSchedulerPassResult =
      await RunbookScheduler.runDueSchedules(at("2026-10-15T12:00:00.000Z"));

    expect(result.outcomes[0]!.outcome).toBe(
      RunbookScheduledTimeOutcome.SkippedMissed,
    );
    expect(scheduledRuns()).toHaveLength(0);
    expect(storedDate("scheduleNextRunAt")).toBe("2026-10-16T09:00:00.000Z");
  });

  test("still runs a time that is only a little late, when the schedule skips missed times", async () => {
    setUp([
      runbookRow({
        scheduleMissedRunPolicy: RunbookScheduleMissedRunPolicy.Skip,
      }),
    ]);

    await RunbookScheduler.runDueSchedules(at("2026-10-15T09:03:00.000Z"));

    expect(scheduledRuns()).toHaveLength(1);
  });
});

describe("a scheduled time while a run is still going", () => {
  test("starts nothing when the schedule skips it, whatever started the run in progress", async () => {
    setUp([runbookRow()], [activeRun()]);

    const result: RunbookSchedulerPassResult =
      await RunbookScheduler.runDueSchedules(at("2026-10-15T09:00:10.000Z"));

    expect(result.outcomes[0]!.outcome).toBe(
      RunbookScheduledTimeOutcome.SkippedStillRunning,
    );
    expect(scheduledRuns()).toHaveLength(0);
    expect(stored("scheduleQueuedRunAt")).toBeNull();
    expect(storedDate("scheduleNextRunAt")).toBe("2026-10-16T09:00:00.000Z");
  });

  test("a run of another runbook does not count", async () => {
    setUp([runbookRow()], [activeRun(OTHER_RUNBOOK_ID)]);

    await RunbookScheduler.runDueSchedules(at("2026-10-15T09:00:10.000Z"));

    expect(scheduledRuns()).toHaveLength(1);
  });

  test("a run that ended does not count", async () => {
    setUp(
      [runbookRow()],
      [
        { ...activeRun(), status: RunbookExecutionStatus.Completed },
        { ...activeRun(), status: RunbookExecutionStatus.Failed },
        { ...activeRun(), status: RunbookExecutionStatus.Cancelled },
      ],
    );

    await RunbookScheduler.runDueSchedules(at("2026-10-15T09:00:10.000Z"));

    expect(scheduledRuns()).toHaveLength(1);
  });

  test("has one run wait, and starts it once the run in progress ends, when the schedule runs it after", async () => {
    const running: StoredRow = {
      ...activeRun(),
      status: RunbookExecutionStatus.Running,
    };

    setUp(
      [
        runbookRow({
          scheduleCron: "*/15 * * * *",
          scheduleOverlapPolicy: RunbookScheduleOverlapPolicy.RunAfter,
        }),
      ],
      [running],
    );

    let result: RunbookSchedulerPassResult =
      await RunbookScheduler.runDueSchedules(at("2026-10-15T09:00:10.000Z"));

    expect(result.outcomes[0]!.outcome).toBe(
      RunbookScheduledTimeOutcome.Queued,
    );
    expect(storedDate("scheduleQueuedRunAt")).toBe("2026-10-15T09:00:00.000Z");
    expect(scheduledRuns()).toHaveLength(0);

    // Still going at the next time: one run already waits, and still only one.
    result = await RunbookScheduler.runDueSchedules(
      at("2026-10-15T09:15:10.000Z"),
    );
    expect(result.outcomes[0]!.outcome).toBe(
      RunbookScheduledTimeOutcome.AlreadyQueued,
    );
    expect(storedDate("scheduleQueuedRunAt")).toBe("2026-10-15T09:00:00.000Z");

    // The run in progress ends: the waiting run starts, once, at the next pass.
    executions.get(String(running["_id"]))!["status"] =
      RunbookExecutionStatus.Completed;

    const passes: Array<RunbookSchedulerPassResult> = await Promise.all([
      RunbookScheduler.runDueSchedules(at("2026-10-15T09:16:00.000Z")),
      RunbookScheduler.runDueSchedules(at("2026-10-15T09:16:00.000Z")),
    ]);

    expect(passes[0]!.startedFromQueue + passes[1]!.startedFromQueue).toBe(1);

    const runs: Array<StoredRow> = scheduledRuns();

    expect(runs).toHaveLength(1);
    expect(runs[0]!["triggerDetails"]).toEqual({
      scheduledFor: "2026-10-15T09:00:00.000Z",
      waitedForPreviousRun: true,
    });
    expect(stored("scheduleQueuedRunAt")).toBeNull();
  });

  test("keeps the run waiting while the run it waits for goes on", async () => {
    setUp(
      [
        runbookRow({
          scheduleOverlapPolicy: RunbookScheduleOverlapPolicy.RunAfter,
          scheduleNextRunAt: at("2026-10-16T09:00:00.000Z"),
          scheduleQueuedRunAt: at("2026-10-15T09:00:00.000Z"),
        }),
      ],
      [activeRun()],
    );

    const result: RunbookSchedulerPassResult =
      await RunbookScheduler.runDueSchedules(at("2026-10-15T10:00:00.000Z"));

    expect(result.startedFromQueue).toBe(0);
    expect(scheduledRuns()).toHaveLength(0);
    expect(storedDate("scheduleQueuedRunAt")).toBe("2026-10-15T09:00:00.000Z");
  });

  test("never starts a waiting run of a schedule or runbook that was turned off", async () => {
    setUp([
      runbookRow({
        isScheduleEnabled: false,
        scheduleQueuedRunAt: at("2026-10-15T09:00:00.000Z"),
      }),
      runbookRow({
        _id: OTHER_RUNBOOK_ID,
        slug: "other",
        isEnabled: false,
        scheduleQueuedRunAt: at("2026-10-15T09:00:00.000Z"),
      }),
    ]);

    const result: RunbookSchedulerPassResult =
      await RunbookScheduler.runDueSchedules(at("2026-10-15T10:00:00.000Z"));

    expect(result.startedFromQueue).toBe(0);
    expect(scheduledRuns()).toHaveLength(0);
  });
});

describe("a schedule without a next run yet", () => {
  test("gets one, worked out from now, and starts nothing in the same pass", async () => {
    setUp([runbookRow({ scheduleNextRunAt: null })]);

    const result: RunbookSchedulerPassResult =
      await RunbookScheduler.runDueSchedules(at("2026-10-15T09:00:30.000Z"));

    expect(result.planned).toBe(1);
    expect(result.outcomes).toEqual([]);
    expect(storedDate("scheduleNextRunAt")).toBe("2026-10-16T09:00:00.000Z");
  });

  test("planNextRun writes only over an empty column, and nothing for a schedule that does not run", async () => {
    setUp([
      runbookRow({ scheduleNextRunAt: null }),
      runbookRow({
        _id: OTHER_RUNBOOK_ID,
        slug: "other",
        scheduleNextRunAt: at("2026-10-20T09:00:00.000Z"),
      }),
    ]);

    expect(
      (
        await RunbookScheduler.planNextRun({
          runbookId: new ObjectID(RUNBOOK_ID),
          now: at("2026-10-15T08:59:00.000Z"),
        })
      )?.toISOString(),
    ).toBe("2026-10-15T09:00:00.000Z");
    expect(storedDate("scheduleNextRunAt")).toBe("2026-10-15T09:00:00.000Z");

    // Already worked out: left as it is.
    await RunbookScheduler.planNextRun({
      runbookId: new ObjectID(OTHER_RUNBOOK_ID),
      now: at("2026-10-15T08:59:00.000Z"),
    });
    expect(storedDate("scheduleNextRunAt", OTHER_RUNBOOK_ID)).toBe(
      "2026-10-20T09:00:00.000Z",
    );
  });

  test("planNextRun writes nothing for a schedule that is off, a runbook that is off, or no cron", async () => {
    for (const overrides of [
      { isScheduleEnabled: false },
      { isEnabled: false },
      { scheduleCron: null },
    ]) {
      setUp([runbookRow({ scheduleNextRunAt: null, ...overrides })]);

      expect(
        await RunbookScheduler.planNextRun({
          runbookId: new ObjectID(RUNBOOK_ID),
          now: at("2026-10-15T08:59:00.000Z"),
        }),
      ).toBeNull();
      expect(stored("scheduleNextRunAt")).toBeNull();
    }
  });
});

describe("a run the start path does not start", () => {
  test("a runbook without steps: refused, and the schedule goes on to its next time", async () => {
    setUp([runbookRow({ steps: [] })]);

    const result: RunbookSchedulerPassResult =
      await RunbookScheduler.runDueSchedules(at("2026-10-15T09:00:10.000Z"));

    expect(result.outcomes[0]!.outcome).toBe(
      RunbookScheduledTimeOutcome.Refused,
    );
    expect(executions.rows).toHaveLength(0);
    expect(storedDate("scheduleNextRunAt")).toBe("2026-10-16T09:00:00.000Z");
  });

  test("a project a master admin blocked: refused, nothing written", async () => {
    setUp([runbookRow()]);
    isBlocked = true;

    const result: RunbookSchedulerPassResult =
      await RunbookScheduler.runDueSchedules(at("2026-10-15T09:00:10.000Z"));

    expect(result.outcomes[0]!.outcome).toBe(
      RunbookScheduledTimeOutcome.Refused,
    );
    expect(executions.rows).toHaveLength(0);
  });

  test("a start that fails before anything is written gives the time back, and the next pass starts it", async () => {
    setUp([runbookRow()]);

    const create: SpyInstance<typeof RunbookExecutionService.create> =
      jest.spyOn(RunbookExecutionService, "create");
    create.mockRejectedValueOnce(new Error("The database went away."));

    const first: RunbookSchedulerPassResult =
      await RunbookScheduler.runDueSchedules(at("2026-10-15T09:00:10.000Z"));

    expect(first.outcomes[0]!.outcome).toBe(RunbookScheduledTimeOutcome.Failed);
    expect(storedDate("scheduleNextRunAt")).toBe("2026-10-15T09:00:00.000Z");

    create.mockRestore();

    const second: RunbookSchedulerPassResult =
      await RunbookScheduler.runDueSchedules(at("2026-10-15T09:01:10.000Z"));

    expect(second.outcomes[0]!.outcome).toBe(
      RunbookScheduledTimeOutcome.Started,
    );
    expect(scheduledRuns()).toHaveLength(1);
  });

  test("a run that cannot be queued is failed with the reason, not left waiting", async () => {
    setUp([runbookRow()]);

    RunbookStarter.registerEnqueuer(async (): Promise<void> => {
      throw new Error("Redis is down.");
    });

    const result: RunbookSchedulerPassResult =
      await RunbookScheduler.runDueSchedules(at("2026-10-15T09:00:10.000Z"));

    expect(result.outcomes[0]!.outcome).toBe(
      RunbookScheduledTimeOutcome.NotQueued,
    );

    const runs: Array<StoredRow> = scheduledRuns();

    expect(runs).toHaveLength(1);
    expect(runs[0]!["status"]).toBe(RunbookExecutionStatus.Failed);
    expect(String(runs[0]!["failureReason"])).toContain(
      "could not queue this run",
    );
    // The time is spent: the schedule goes on.
    expect(storedDate("scheduleNextRunAt")).toBe("2026-10-16T09:00:00.000Z");
  });
});

describe("whole nights, a pass every minute", () => {
  /*
   * The Worker's job runs once a minute: run it pass by pass across a span
   * and collect the runs the schedule started.
   */
  async function passEveryMinute(data: {
    from: string;
    to: string;
  }): Promise<Array<string>> {
    for (
      let now: number = at(data.from).getTime();
      now <= at(data.to).getTime();
      now += MINUTE
    ) {
      // A little after each minute begins, as a busy queue runs it.
      await RunbookScheduler.runDueSchedules(new Date(now + 7000));

      // Each run is over within the minute.
      for (const row of executions.rows) {
        row["status"] = RunbookExecutionStatus.Completed;
      }
    }

    return scheduledRuns()
      .map((row: StoredRow) => {
        return String(
          (row["triggerDetails"] as Record<string, unknown>)["scheduledFor"],
        );
      })
      .sort();
  }

  test("02:30 in Berlin on the night the clocks go back runs once, the first time", async () => {
    setUp([
      runbookRow({
        scheduleCron: "30 2 * * *",
        scheduleTimezone: "Europe/Berlin",
        scheduleNextRunAt: null,
      }),
    ]);

    expect(
      await passEveryMinute({
        from: "2026-10-24T22:00:00.000Z",
        to: "2026-10-25T03:00:00.000Z",
      }),
    ).toEqual(["2026-10-25T00:30:00.000Z"]);
  });

  test("02:30 in Berlin on the night the clocks go forward runs once, at 03:30", async () => {
    setUp([
      runbookRow({
        scheduleCron: "30 2 * * *",
        scheduleTimezone: "Europe/Berlin",
        scheduleNextRunAt: null,
      }),
    ]);

    expect(
      await passEveryMinute({
        from: "2026-03-28T22:00:00.000Z",
        to: "2026-03-29T03:00:00.000Z",
      }),
    ).toEqual(["2026-03-29T01:30:00.000Z"]);
  });

  test("every 15 minutes through the hour that comes round twice runs every 15 minutes", async () => {
    setUp([
      runbookRow({
        scheduleCron: "*/15 * * * *",
        scheduleTimezone: "Europe/Berlin",
        scheduleNextRunAt: null,
      }),
    ]);

    const runs: Array<string> = await passEveryMinute({
      from: "2026-10-24T23:00:00.000Z",
      to: "2026-10-25T02:00:00.000Z",
    });

    expect(runs.length).toBe(12);

    for (let i: number = 1; i < runs.length; i++) {
      expect(at(runs[i]!).getTime() - at(runs[i - 1]!).getTime()).toBe(
        15 * MINUTE,
      );
    }
  });

  test("09:00 New York on weekdays starts one run each weekday at 09:00 there", async () => {
    setUp([
      runbookRow({
        scheduleCron: "0 9 * * 1-5",
        scheduleTimezone: "America/New_York",
        scheduleNextRunAt: null,
      }),
    ]);

    // Friday 2026-10-16 to Monday 2026-10-19, New York on EDT (UTC-4).
    expect(
      await passEveryMinute({
        from: "2026-10-16T12:00:00.000Z",
        to: "2026-10-19T14:00:00.000Z",
      }),
    ).toEqual(["2026-10-16T13:00:00.000Z", "2026-10-19T13:00:00.000Z"]);
  });
});

describe("what a pass reads", () => {
  /*
   * The in-memory table hands back every column whatever the select says,
   * so the select is checked here: a pass that read no project started
   * nothing against a real database.
   */
  test("reads everything the start path needs, and the schedule", () => {
    expect(RUNBOOK_SCHEDULE_SELECT).toEqual({
      ...RUNBOOK_START_SELECT,
      isScheduleEnabled: true,
      scheduleCron: true,
      scheduleTimezone: true,
      scheduleOverlapPolicy: true,
      scheduleMissedRunPolicy: true,
      scheduleNextRunAt: true,
      scheduleQueuedRunAt: true,
    });
    expect(RUNBOOK_START_SELECT).toEqual({
      _id: true,
      projectId: true,
      name: true,
      steps: true,
      isEnabled: true,
    });
  });

  test("asks the database for those columns in every step of a pass", async () => {
    setUp([
      runbookRow(),
      runbookRow({
        _id: OTHER_RUNBOOK_ID,
        slug: "other",
        scheduleNextRunAt: null,
        scheduleQueuedRunAt: at("2026-10-15T08:00:00.000Z"),
      }),
    ]);

    await RunbookScheduler.runDueSchedules(at("2026-10-15T09:00:10.000Z"));

    const selects: Array<Record<string, unknown>> = (
      runbooks.repository.find.mock.calls as Array<
        Array<{ select?: Record<string, unknown> }>
      >
    ).map((call: Array<{ select?: Record<string, unknown> }>) => {
      return call[0]!.select || {};
    });

    expect(selects.length).toBeGreaterThanOrEqual(3);

    for (const select of selects) {
      for (const column of ["_id", "projectId", "steps", "isEnabled"]) {
        expect({ column, selected: Boolean(select[column]) }).toEqual({
          column,
          selected: true,
        });
      }
    }
  });
});

describe("what a schedule reads as", () => {
  function asRunbook(overrides: StoredRow): Runbook {
    const runbook: Runbook = new Runbook();
    Object.assign(runbook, runbookRow(overrides));
    return runbook;
  }

  test("no next run for a schedule that is off, a runbook that is off, no cron, or one that cannot be read", () => {
    const after: Date = at("2026-10-15T00:00:00.000Z");

    expect(
      RunbookSchedulerClass.getNextRunAt(
        asRunbook({ isScheduleEnabled: false }),
        after,
      ),
    ).toBeNull();
    expect(
      RunbookSchedulerClass.getNextRunAt(
        asRunbook({ isEnabled: false }),
        after,
      ),
    ).toBeNull();
    expect(
      RunbookSchedulerClass.getNextRunAt(
        asRunbook({ scheduleCron: null }),
        after,
      ),
    ).toBeNull();
    expect(
      RunbookSchedulerClass.getNextRunAt(
        asRunbook({ scheduleCron: "not a cron" }),
        after,
      ),
    ).toBeNull();
    expect(
      RunbookSchedulerClass.getNextRunAt(
        asRunbook({ scheduleTimezone: "Mars/Olympus_Mons" }),
        after,
      ),
    ).toBeNull();
  });

  test("a schedule saved with no time zone is read in UTC", () => {
    expect(
      RunbookSchedulerClass.getNextRunAt(
        asRunbook({ scheduleTimezone: null }),
        at("2026-10-15T00:00:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-10-15T09:00:00.000Z");
  });

  test("an unknown policy reads as the default: skip a time while a run goes on, run missed times once", () => {
    const runbook: Runbook = asRunbook({
      scheduleOverlapPolicy: "Whatever",
      scheduleMissedRunPolicy: null,
    });

    expect(RunbookSchedulerClass.getOverlapPolicy(runbook)).toBe(
      RunbookScheduleOverlapPolicy.Skip,
    );
    expect(RunbookSchedulerClass.getMissedRunPolicy(runbook)).toBe(
      RunbookScheduleMissedRunPolicy.RunOnce,
    );
  });
});
