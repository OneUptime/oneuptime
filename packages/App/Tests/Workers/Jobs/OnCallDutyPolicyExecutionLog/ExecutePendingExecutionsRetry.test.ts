import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import BadDataException from "Common/Types/Exception/BadDataException";
import ColumnLength from "Common/Types/Database/ColumnLength";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPolicyAiHoldOutcome } from "Common/Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";

/*
 * THE POLICY-RUN WORKER TRIES A FAILED STEP AGAIN, AND STOPS IN TIME
 * (issue #8167).
 *
 * The worker ended a run in Error on any error. Now a failure a retry
 * cannot fix ends the run at once, as before; any other is tried again at
 * minutes 1, 3, 7, 12, 17 ... after it, and a run whose step failed ten
 * tries in a row ends in Error, saying how long it was tried and what the
 * last try failed with. These pin that for every kind of step the worker
 * runs - ending an archived policy's run, a test page's tick, ending a run
 * whose record was handled, ending a direct page, moving a run on, and for
 * a run that waits: ending it, classifying OneUptime AI's hold, starting it
 * - with the real OnCallRecordStates and the failed tries kept in a Redis
 * in memory, over mocked services.
 */

type CronHandler = (deadline?: unknown) => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
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

// Redis, in memory: what the worker keeps of a run's failed tries.
const mockRedis: Map<string, string> = new Map();
let mockRedisIsDown: boolean = false;

jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  const down: () => void = (): void => {
    if (mockRedisIsDown) {
      throw new Error("Connection is closed.");
    }
  };

  return {
    __esModule: true,
    default: {
      getStrings: jest.fn(async (namespace: string, keys: Array<string>) => {
        down();
        return keys.map((key: string) => {
          return mockRedis.get(`${namespace}-${key}`) || null;
        });
      }),
      setString: jest.fn(
        async (namespace: string, key: string, value: string) => {
          down();
          mockRedis.set(`${namespace}-${key}`, value);
        },
      ),
      deleteKey: jest.fn(async (namespace: string, key: string) => {
        down();
        mockRedis.delete(`${namespace}-${key}`);
      }),
    },
  };
});

jest.mock("Common/Server/Services/OnCallDutyPolicyExecutionLogService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      updateOneById: jest.fn(),
      startWaitingRun: jest.fn(),
      endWaitingRun: jest.fn(),
      endDirectPageIfItsPagesAreOver: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/OnCall/OnCallEscalationAdvance", () => {
  return { __esModule: true, default: { advance: jest.fn() } };
});

jest.mock("Common/Server/Utils/OnCall/OnCallTestPageRuns", () => {
  return { __esModule: true, default: { tick: jest.fn() } };
});

jest.mock("Common/Server/Utils/AI/FirstResponder/AiFirstResponder", () => {
  return { __esModule: true, default: { classifyEndedHold: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentStateService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import AiFirstResponder from "Common/Server/Utils/AI/FirstResponder/AiFirstResponder";
import OnCallEscalationAdvance from "Common/Server/Utils/OnCall/OnCallEscalationAdvance";
import OnCallTestPageRuns from "Common/Server/Utils/OnCall/OnCallTestPageRuns";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions";

const JOB_NAME: string =
  "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions";

const runService: {
  findBy: jest.Mock;
  updateOneById: jest.Mock;
  startWaitingRun: jest.Mock;
  endWaitingRun: jest.Mock;
  endDirectPageIfItsPagesAreOver: jest.Mock;
} = OnCallDutyPolicyExecutionLogService as unknown as {
  findBy: jest.Mock;
  updateOneById: jest.Mock;
  startWaitingRun: jest.Mock;
  endWaitingRun: jest.Mock;
  endDirectPageIfItsPagesAreOver: jest.Mock;
};
const advance: jest.Mock =
  OnCallEscalationAdvance.advance as unknown as jest.Mock;
const testPageTick: jest.Mock = OnCallTestPageRuns.tick as unknown as jest.Mock;
const classifyEndedHold: jest.Mock =
  AiFirstResponder.classifyEndedHold as unknown as jest.Mock;
const incidentService: { findBy: jest.Mock } = IncidentService as unknown as {
  findBy: jest.Mock;
};
const incidentStateService: { findBy: jest.Mock } =
  IncidentStateService as unknown as { findBy: jest.Mock };
const loggerWarn: jest.Mock = logger.warn as unknown as jest.Mock;
const loggerError: jest.Mock = logger.error as unknown as jest.Mock;

const MINUTE: number = 60 * 1000;
const START: Date = new Date("2026-11-15T03:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "81671111-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "81671111-0000-4000-8000-000000000002",
);
const CREATED_STATE: ObjectID = new ObjectID(
  "81671111-0000-4000-8000-0000000000c1",
);
const ACKNOWLEDGED_STATE: ObjectID = new ObjectID(
  "81671111-0000-4000-8000-0000000000c2",
);

function uuid(prefix: string, index: number): ObjectID {
  return new ObjectID(
    `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
}

let clock: Date;
let runs: Array<OnCallDutyPolicyExecutionLog>;
let acknowledged: Set<string>;

// What the database throws as it loses a connection.
function connectionReset(): Error {
  return Object.assign(new Error("Connection terminated unexpectedly"), {
    code: "ECONNRESET",
  });
}

// A column of a run left unset, as a run read without it has it.
function unset(run: OnCallDutyPolicyExecutionLog, column: string): void {
  (run as unknown as Record<string, unknown>)[column] = undefined;
}

// A run paging an incident, its rule's wait over.
function pagingRun(index: number = 1): OnCallDutyPolicyExecutionLog {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = uuid("81672222", index);
  run.projectId = PROJECT_ID;
  run.onCallDutyPolicyId = POLICY_ID;
  run.status = OnCallDutyPolicyStatus.Executing;
  run.createdAt = new Date(START.getTime() - 60 * MINUTE);
  run.lastEscalationRuleExecutedAt = new Date(START.getTime() - 30 * MINUTE);
  run.executeNextEscalationRuleInMinutes = 10;
  run.triggeredByIncidentId = uuid("81673333", index);
  run.userNotificationEventType = UserNotificationEventType.IncidentCreated;
  run.onCallDutyPolicy = new OnCallDutyPolicy();
  run.onCallDutyPolicy.isArchived = false;
  runs.push(run);
  return run;
}

// A run that waits to page, its moment come.
function waitingRun(index: number = 1): OnCallDutyPolicyExecutionLog {
  const run: OnCallDutyPolicyExecutionLog = pagingRun(index);
  run.status = OnCallDutyPolicyStatus.Waiting;
  unset(run, "lastEscalationRuleExecutedAt");
  run.pagingStartsAt = new Date(START.getTime() - MINUTE);
  return run;
}

// What the run was ended with, as updateOneById was asked to write it.
function errorEndings(): Array<{ id: string; statusMessage: string }> {
  return runService.updateOneById.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as {
        id: ObjectID;
        data: { status?: OnCallDutyPolicyStatus; statusMessage?: string };
      };
    })
    .filter((update: { data: { status?: OnCallDutyPolicyStatus } }) => {
      return update.data.status === OnCallDutyPolicyStatus.Error;
    })
    .map((update: { id: ObjectID; data: { statusMessage?: string } }) => {
      return {
        id: update.id.toString(),
        statusMessage: update.data.statusMessage || "",
      };
    });
}

function keptFailures(
  run: OnCallDutyPolicyExecutionLog,
): Record<string, unknown> | null {
  const value: string | undefined = mockRedis.get(
    `on-call-policy-run-failures-${run.id!.toString()}`,
  );

  return value ? (JSON.parse(value) as Record<string, unknown>) : null;
}

// The minute since START of each tick, then the tick.
async function tickAt(minute: number): Promise<void> {
  clock = new Date(START.getTime() + minute * MINUTE);
  await mockCapturedJobs[JOB_NAME]!();
}

// A tick every minute from `from` to `to`; the minutes `work` was called at.
async function everyMinute(
  from: number,
  to: number,
  work: jest.Mock,
): Promise<Array<number>> {
  const tried: Array<number> = [];

  for (let minute: number = from; minute <= to; minute++) {
    const before: number = work.mock.calls.length;
    await tickAt(minute);

    if (work.mock.calls.length > before) {
      tried.push(minute);
    }
  }

  return tried;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.clear();
  mockRedisIsDown = false;
  runs = [];
  acknowledged = new Set();
  clock = new Date(START);

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(clock);
  });

  // The runs still going - Executing or Waiting - as the database holds them.
  runService.findBy.mockImplementation(async () => {
    return runs.filter((run: OnCallDutyPolicyExecutionLog) => {
      return (
        run.status === OnCallDutyPolicyStatus.Executing ||
        run.status === OnCallDutyPolicyStatus.Waiting
      );
    });
  });

  // A write lands on the run, as the database's would.
  runService.updateOneById.mockImplementation(
    async (args: {
      id: ObjectID;
      data: { status?: OnCallDutyPolicyStatus; statusMessage?: string };
    }) => {
      const run: OnCallDutyPolicyExecutionLog | undefined = runs.find(
        (candidate: OnCallDutyPolicyExecutionLog) => {
          return candidate.id!.toString() === args.id.toString();
        },
      );

      if (run && args.data.status) {
        run.status = args.data.status;
        run.statusMessage = args.data.statusMessage || "";
      }
    },
  );

  incidentService.findBy.mockImplementation(
    async (args: { query: Record<string, unknown> }) => {
      const ids: Array<string> = Object.values(
        (
          args.query["_id"] as {
            objectLiteralParameters: Record<string, unknown>;
          }
        ).objectLiteralParameters,
      )[0] as Array<string>;

      return ids.map((id: string) => {
        const incident: Incident = new Incident();
        incident.id = new ObjectID(id);
        incident.projectId = PROJECT_ID;
        incident.currentIncidentStateId = acknowledged.has(id)
          ? ACKNOWLEDGED_STATE
          : CREATED_STATE;
        return incident;
      });
    },
  );

  incidentStateService.findBy.mockResolvedValue(
    [
      [CREATED_STATE, 1, "isCreatedState"],
      [ACKNOWLEDGED_STATE, 2, "isAcknowledgedState"],
    ].map(([id, order, flag]: Array<unknown>) => {
      const state: IncidentState = new IncidentState();
      state.id = id as ObjectID;
      state.projectId = PROJECT_ID;
      state.order = order as number;
      (state as unknown as Record<string, boolean>)[flag as string] = true;
      return state;
    }),
  );

  advance.mockResolvedValue(undefined);
  testPageTick.mockResolvedValue(undefined);
  runService.startWaitingRun.mockResolvedValue(true);
  runService.endWaitingRun.mockResolvedValue(true);
  runService.endDirectPageIfItsPagesAreOver.mockResolvedValue(false);
  classifyEndedHold.mockResolvedValue(OnCallPolicyAiHoldOutcome.HandedOff);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a step that fails for a moment", () => {
  test("REGRESSION: the run is left paging, not ended in Error, and its next try comes a minute later", async () => {
    const run: OnCallDutyPolicyExecutionLog = pagingRun();
    advance.mockRejectedValueOnce(connectionReset());

    await tickAt(0);

    expect(errorEndings()).toEqual([]);
    expect(run.status).toBe(OnCallDutyPolicyStatus.Executing);
    expect(keptFailures(run)).toEqual({
      failedTries: 1,
      firstFailedAt: START.getTime(),
      lastFailedAt: START.getTime(),
      retryAt: START.getTime() + MINUTE,
      lastError: "Connection terminated unexpectedly",
    });

    await tickAt(1);

    expect(advance).toHaveBeenCalledTimes(2);
    // It went on: its failed try is forgotten.
    expect(keptFailures(run)).toBeNull();
  });

  test("is said in a warning, not an error: a blip of the database is expected now and then", async () => {
    pagingRun();
    advance.mockRejectedValueOnce(connectionReset());

    await tickAt(0);

    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        "try 1 of 10 failed, and it is tried again at 2026-11-15T03:01:00.000Z: Connection terminated unexpectedly",
      ),
    );
    expect(loggerError).not.toHaveBeenCalled();
  });

  test("a run waits out its next try: the worker does nothing for it, and costs nothing, until then", async () => {
    pagingRun();
    advance.mockRejectedValue(connectionReset());

    expect(await everyMinute(0, 12, advance)).toEqual([0, 1, 3, 7, 12]);
  });

  test("tries come a minute, two, four, then five minutes apart - ten in all - and the run ends in Error, saying so", async () => {
    const run: OnCallDutyPolicyExecutionLog = pagingRun();
    advance.mockRejectedValue(connectionReset());

    const tried: Array<number> = await everyMinute(0, 60, advance);

    expect(tried).toEqual([0, 1, 3, 7, 12, 17, 22, 27, 32, 37]);
    expect(run.status).toBe(OnCallDutyPolicyStatus.Error);
    expect(errorEndings()).toEqual([
      {
        id: run.id!.toString(),
        statusMessage:
          "OneUptime tried 10 times in 37 minutes to move this run on, and every try failed, so it stopped paging. The last try failed with: Connection terminated unexpectedly. If the incident still needs somebody, page them again.",
      },
    ]);
    expect(keptFailures(run)).toBeNull();
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining("failed 10 tries in a row, and ends in Error"),
    );
  });

  test("a run that goes on after failed tries forgets them: a later failure is a first try again", async () => {
    const run: OnCallDutyPolicyExecutionLog = pagingRun();
    advance
      .mockRejectedValueOnce(connectionReset())
      .mockRejectedValueOnce(connectionReset())
      .mockRejectedValueOnce(connectionReset());

    expect(await everyMinute(0, 7, advance)).toEqual([0, 1, 3, 7]);
    expect(keptFailures(run)).toBeNull();

    advance.mockRejectedValueOnce(connectionReset());
    await tickAt(8);

    expect(keptFailures(run)).toMatchObject({
      failedTries: 1,
      retryAt: START.getTime() + 9 * MINUTE,
    });
  });

  test("a failure a retry cannot fix, after failed tries, ends the run at once, saying why", async () => {
    const run: OnCallDutyPolicyExecutionLog = pagingRun();
    advance
      .mockRejectedValueOnce(connectionReset())
      .mockRejectedValueOnce(
        new BadDataException(
          "The escalation rule 1 no longer exists. It may have been deleted.",
        ),
      );

    await tickAt(0);
    await tickAt(1);

    expect(errorEndings()).toEqual([
      {
        id: run.id!.toString(),
        statusMessage:
          "The escalation rule 1 no longer exists. It may have been deleted.",
      },
    ]);
    expect(keptFailures(run)).toBeNull();
  });

  test("one run's failures are its own: the other runs of its page are worked on each minute", async () => {
    const failing: OnCallDutyPolicyExecutionLog = pagingRun(1);
    const healthy: OnCallDutyPolicyExecutionLog = pagingRun(2);
    advance.mockImplementation(
      async (data: { run: OnCallDutyPolicyExecutionLog }) => {
        if (data.run.id!.toString() === failing.id!.toString()) {
          throw connectionReset();
        }
      },
    );

    for (let minute: number = 0; minute <= 3; minute++) {
      await tickAt(minute);
    }

    const movedOn: Array<string> = advance.mock.calls.map(
      (call: Array<unknown>) => {
        return (
          call[0] as { run: OnCallDutyPolicyExecutionLog }
        ).run.id!.toString();
      },
    );

    expect(
      movedOn.filter((id: string) => {
        return id === healthy.id!.toString();
      }),
    ).toHaveLength(4);
    expect(
      movedOn.filter((id: string) => {
        return id === failing.id!.toString();
      }),
    ).toHaveLength(3);
    expect(keptFailures(healthy)).toBeNull();
  });

  test("with Redis down a run is tried every minute, as the worker always did, and is never ended for it", async () => {
    const run: OnCallDutyPolicyExecutionLog = pagingRun();
    mockRedisIsDown = true;
    advance.mockRejectedValue(connectionReset());

    expect(await everyMinute(0, 45, advance)).toHaveLength(46);
    expect(run.status).toBe(OnCallDutyPolicyStatus.Executing);
    expect(errorEndings()).toEqual([]);
  });

  test("the page of runs reads its runs' failed tries once", async () => {
    pagingRun(1);
    pagingRun(2);
    pagingRun(3);

    await tickAt(0);

    expect(GlobalCache.getStrings).toHaveBeenCalledTimes(1);
    expect(
      (GlobalCache.getStrings as unknown as jest.Mock).mock.calls[0]![1],
    ).toHaveLength(3);
  });
});

describe("a failure not recognised", () => {
  test("is tried again too, bounded the same way, and logged as an error", async () => {
    const run: OnCallDutyPolicyExecutionLog = pagingRun();
    advance.mockRejectedValue(
      new TypeError("Cannot read properties of undefined (reading 'id')"),
    );

    expect(await everyMinute(0, 40, advance)).toEqual([
      0, 1, 3, 7, 12, 17, 22, 27, 32, 37,
    ]);
    expect(run.status).toBe(OnCallDutyPolicyStatus.Error);
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining("try 1 of 10 failed"),
    );
    expect(errorEndings()[0]!.statusMessage).toContain(
      "The last try failed with: Cannot read properties of undefined (reading 'id').",
    );
  });
});

describe("every kind of step", () => {
  /*
   * Each step the worker runs, failing once for a moment: the run is not
   * ended, and the next minute the step is tried, and goes through.
   */
  test.each([
    {
      step: "ending an archived policy's run",
      setUp: (): OnCallDutyPolicyExecutionLog => {
        const run: OnCallDutyPolicyExecutionLog = pagingRun();
        run.onCallDutyPolicy!.isArchived = true;
        runService.updateOneById.mockRejectedValueOnce(connectionReset());
        return run;
      },
      endsWith: OnCallDutyPolicyStatus.Completed,
    },
    {
      step: "ending a run whose incident was acknowledged",
      setUp: (): OnCallDutyPolicyExecutionLog => {
        const run: OnCallDutyPolicyExecutionLog = pagingRun();
        acknowledged.add(run.triggeredByIncidentId!.toString());
        runService.updateOneById.mockRejectedValueOnce(connectionReset());
        return run;
      },
      endsWith: OnCallDutyPolicyStatus.Completed,
    },
    {
      step: "ending a page again whose incident was resolved",
      setUp: (): OnCallDutyPolicyExecutionLog => {
        const run: OnCallDutyPolicyExecutionLog = pagingRun();
        run.pageAgainNumber = 1;
        runService.updateOneById.mockRejectedValueOnce(connectionReset());
        // Resolved: a page again's record is the incident's resolved state.
        incidentStateService.findBy.mockResolvedValue(
          [[CREATED_STATE, 1, "isResolvedState"]].map(
            ([id, order, flag]: Array<unknown>) => {
              const state: IncidentState = new IncidentState();
              state.id = id as ObjectID;
              state.projectId = PROJECT_ID;
              state.order = order as number;
              (state as unknown as Record<string, boolean>)[flag as string] =
                true;
              return state;
            },
          ),
        );
        return run;
      },
      endsWith: OnCallDutyPolicyStatus.Completed,
    },
  ])(
    "$step: the write fails, and is made the next minute",
    async (data: {
      setUp: () => OnCallDutyPolicyExecutionLog;
      endsWith: OnCallDutyPolicyStatus;
    }) => {
      const run: OnCallDutyPolicyExecutionLog = data.setUp();

      await tickAt(0);

      expect(run.status).toBe(OnCallDutyPolicyStatus.Executing);
      expect(keptFailures(run)).toMatchObject({ failedTries: 1 });

      await tickAt(1);

      expect(run.status).toBe(data.endsWith);
      expect(errorEndings()).toEqual([]);
      expect(keptFailures(run)).toBeNull();
    },
  );

  test("a test page's tick", async () => {
    const run: OnCallDutyPolicyExecutionLog = pagingRun();
    unset(run, "triggeredByIncidentId");
    run.userNotificationEventType = UserNotificationEventType.TestPage;
    testPageTick.mockRejectedValueOnce(connectionReset());

    await tickAt(0);
    await tickAt(1);

    expect(testPageTick).toHaveBeenCalledTimes(2);
    expect(errorEndings()).toEqual([]);
  });

  test("a test page that runs out of tries has no record to page again about", async () => {
    const run: OnCallDutyPolicyExecutionLog = pagingRun();
    unset(run, "triggeredByIncidentId");
    run.userNotificationEventType = UserNotificationEventType.TestPage;
    testPageTick.mockRejectedValue(connectionReset());

    await everyMinute(0, 40, testPageTick);

    expect(errorEndings()).toHaveLength(1);
    expect(errorEndings()[0]!.statusMessage).toBe(
      "OneUptime tried 10 times in 37 minutes to move this run on, and every try failed, so it stopped paging. The last try failed with: Connection terminated unexpectedly.",
    );
  });

  test("ending a direct page", async () => {
    const run: OnCallDutyPolicyExecutionLog = pagingRun();
    unset(run, "onCallDutyPolicyId");
    unset(run, "onCallDutyPolicy");
    runService.endDirectPageIfItsPagesAreOver.mockRejectedValueOnce(
      connectionReset(),
    );

    await tickAt(0);
    await tickAt(1);

    expect(runService.endDirectPageIfItsPagesAreOver).toHaveBeenCalledTimes(2);
    expect(errorEndings()).toEqual([]);
  });

  test("starting a run that waited", async () => {
    const run: OnCallDutyPolicyExecutionLog = waitingRun();
    runService.startWaitingRun.mockRejectedValueOnce(connectionReset());

    await tickAt(0);

    expect(run.status).toBe(OnCallDutyPolicyStatus.Waiting);
    expect(errorEndings()).toEqual([]);

    await tickAt(1);

    expect(runService.startWaitingRun).toHaveBeenCalledTimes(2);
    expect(keptFailures(run)).toBeNull();
  });

  test("a run that waited and runs out of tries says nobody was paged", async () => {
    waitingRun();
    runService.startWaitingRun.mockRejectedValue(connectionReset());

    await everyMinute(0, 40, runService.startWaitingRun);

    expect(errorEndings()).toHaveLength(1);
    expect(errorEndings()[0]!.statusMessage).toBe(
      "OneUptime tried 10 times in 37 minutes to start this run, and every try failed, so nobody was paged. The last try failed with: Connection terminated unexpectedly. If the incident still needs somebody, page them again.",
    );
  });

  test("ending a run that waited, its incident acknowledged", async () => {
    const run: OnCallDutyPolicyExecutionLog = waitingRun();
    acknowledged.add(run.triggeredByIncidentId!.toString());
    runService.endWaitingRun.mockRejectedValueOnce(connectionReset());

    await tickAt(0);
    await tickAt(1);

    expect(runService.endWaitingRun).toHaveBeenCalledTimes(2);
    expect(runService.startWaitingRun).not.toHaveBeenCalled();
    expect(errorEndings()).toEqual([]);
  });

  test("classifying how OneUptime AI's hold ended", async () => {
    const run: OnCallDutyPolicyExecutionLog = waitingRun();
    run.aiHoldOutcome = OnCallPolicyAiHoldOutcome.Holding;
    acknowledged.add(run.triggeredByIncidentId!.toString());
    classifyEndedHold.mockRejectedValueOnce(connectionReset());

    await tickAt(0);

    expect(runService.endWaitingRun).not.toHaveBeenCalled();

    await tickAt(1);

    expect(runService.endWaitingRun).toHaveBeenCalledWith(
      expect.objectContaining({
        executionLogId: run.id,
        aiHoldOutcome: OnCallPolicyAiHoldOutcome.HandedOff,
      }),
    );
  });
});

describe("a failure a retry cannot fix", () => {
  test("ends the run at once, with the error's words, as it always did", async () => {
    const run: OnCallDutyPolicyExecutionLog = pagingRun();
    advance.mockRejectedValue(
      new BadDataException("Invalid userNotificationEventType"),
    );

    await tickAt(0);

    expect(errorEndings()).toEqual([
      {
        id: run.id!.toString(),
        statusMessage: "Invalid userNotificationEventType",
      },
    ]);
    expect(advance).toHaveBeenCalledTimes(1);
    expect(keptFailures(run)).toBeNull();
  });

  test("words too long for a run's status message are cut to fit, so the ending is written", async () => {
    pagingRun();
    advance.mockRejectedValue(new BadDataException("x".repeat(3000)));

    await tickAt(0);

    expect(errorEndings()[0]!.statusMessage.length).toBe(ColumnLength.LongText);
  });

  test("an ending that cannot be written is tried again the next minute", async () => {
    const run: OnCallDutyPolicyExecutionLog = pagingRun();
    advance.mockRejectedValue(new BadDataException("Incident not found"));
    runService.updateOneById.mockRejectedValueOnce(connectionReset());

    await tickAt(0);

    expect(run.status).toBe(OnCallDutyPolicyStatus.Executing);

    await tickAt(1);

    expect(run.status).toBe(OnCallDutyPolicyStatus.Error);
    expect(run.statusMessage).toBe("Incident not found");
  });
});
