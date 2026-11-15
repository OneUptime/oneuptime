import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import { getOnCallPolicyRunRecordHandledMessage } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { FindOperator } from "typeorm";

/*
 * THE ON-CALL POLICY WORKER IN AN ALERT STORM, A PAGE AT A TIME.
 *
 * Every minute the worker used to read every run still going and start the
 * work of all of them at once: for each, its record and its project's
 * states, then whatever the run needed - in an alert storm thousands of
 * queries at the same moment on a pool of fifty connections, while on-call
 * pages failed to load. These pin, with the real OnCallRecordStates over
 * mocked services:
 *
 *   1. runs are read a keyset page of POLICY_RUN_PAGE_SIZE at a time;
 *   2. a page's records are read in one query per kind, and each project's
 *      states once for the whole run;
 *   3. a run with nothing to do this minute costs no query of its own;
 *   4. never more than POLICY_RUN_CONCURRENCY runs are worked on at once;
 *   5. it stops between pages and runs at its deadline;
 *   6. a page whose records cannot be read waits for the next minute, and
 *      none of its runs is ended in error for it.
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

jest.mock("Common/Server/Services/IncidentService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentStateService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/AlertService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/AlertStateService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/AlertEpisodeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentEpisodeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import OnCallEscalationAdvance from "Common/Server/Utils/OnCall/OnCallEscalationAdvance";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import {
  POLICY_RUN_CONCURRENCY,
  POLICY_RUN_PAGE_SIZE,
  POLICY_RUN_SELECT,
} from "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions";

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
const incidentService: { findBy: jest.Mock } = IncidentService as unknown as {
  findBy: jest.Mock;
};
const incidentStateService: { findBy: jest.Mock } =
  IncidentStateService as unknown as { findBy: jest.Mock };

const MINUTE: number = 60 * 1000;
const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);

function uuid(prefix: string, index: number): ObjectID {
  return new ObjectID(
    `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
}

const CREATED_STATE: ObjectID = uuid("11111111", 1);
const ACKNOWLEDGED_STATE: ObjectID = uuid("11111111", 2);
const RESOLVED_STATE: ObjectID = uuid("11111111", 3);

function projectStates(): Array<IncidentState> {
  return [
    [CREATED_STATE, 1, "isCreatedState"],
    [ACKNOWLEDGED_STATE, 2, "isAcknowledgedState"],
    [RESOLVED_STATE, 3, "isResolvedState"],
  ].map(([id, order, flag]: Array<unknown>) => {
    const state: IncidentState = new IncidentState();
    state.id = id as ObjectID;
    state.projectId = PROJECT_ID;
    state.order = order as number;
    (state as unknown as Record<string, boolean>)[flag as string] = true;
    return state;
  });
}

// The runs and records the database holds.
let runs: Array<OnCallDutyPolicyExecutionLog>;
let incidentStateById: Map<string, ObjectID>;

/*
 * A run paging an incident: `waitedMinutes` into a rule that waits
 * `waitMinutes` before the next.
 */
function pagingRun(data: {
  index: number;
  waitedMinutes: number;
  waitMinutes?: number;
  incidentState?: ObjectID;
}): OnCallDutyPolicyExecutionLog {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = uuid("bbbbbbbb", data.index);
  run.projectId = PROJECT_ID;
  run.onCallDutyPolicyId = uuid("cccccccc", 1);
  run.status = OnCallDutyPolicyStatus.Executing;
  run.createdAt = new Date(Date.now() - 60 * MINUTE);
  run.lastEscalationRuleExecutedAt = new Date(
    Date.now() - data.waitedMinutes * MINUTE,
  );
  run.executeNextEscalationRuleInMinutes = data.waitMinutes ?? 30;
  run.triggeredByIncidentId = uuid("dddddddd", data.index);
  run.onCallDutyPolicy = new OnCallDutyPolicy();
  run.onCallDutyPolicy.isArchived = false;

  incidentStateById.set(
    run.triggeredByIncidentId.toString(),
    data.incidentState || CREATED_STATE,
  );

  return run;
}

function cursorOf(query: Record<string, unknown>): string | undefined {
  const cursor: FindOperator<ObjectID> | undefined = query["_id"] as
    | FindOperator<ObjectID>
    | undefined;

  return cursor
    ? String(Object.values(cursor.objectLiteralParameters!)[0])
    : undefined;
}

function idsIn(query: Record<string, unknown>): Array<string> {
  const predicate: FindOperator<unknown> = query[
    "_id"
  ] as FindOperator<unknown>;
  return Object.values(predicate.objectLiteralParameters!)[0] as Array<string>;
}

beforeEach(() => {
  jest.clearAllMocks();
  runs = [];
  incidentStateById = new Map();

  // A database that serves keyset pages of the runs still going.
  runService.findBy.mockImplementation(
    async (args: {
      query: Record<string, unknown>;
      limit: number;
    }): Promise<Array<OnCallDutyPolicyExecutionLog>> => {
      const after: string | undefined = cursorOf(args.query);

      return runs
        .filter((run: OnCallDutyPolicyExecutionLog) => {
          return (
            (run.status === OnCallDutyPolicyStatus.Executing ||
              run.status === OnCallDutyPolicyStatus.Waiting) &&
            (after === undefined || run.id!.toString() > after)
          );
        })
        .sort(
          (
            a: OnCallDutyPolicyExecutionLog,
            b: OnCallDutyPolicyExecutionLog,
          ) => {
            return a.id!.toString() < b.id!.toString() ? -1 : 1;
          },
        )
        .slice(0, args.limit);
    },
  );

  incidentService.findBy.mockImplementation(
    async (args: {
      query: Record<string, unknown>;
    }): Promise<Array<Incident>> => {
      return idsIn(args.query).map((id: string) => {
        const incident: Incident = new Incident();
        incident.id = new ObjectID(id);
        incident.projectId = PROJECT_ID;
        incident.currentIncidentStateId = incidentStateById.get(id)!;
        return incident;
      });
    },
  );
  incidentStateService.findBy.mockResolvedValue(projectStates());

  runService.updateOneById.mockResolvedValue(undefined);
  advance.mockResolvedValue(undefined);
});

async function tick(deadline?: JobDeadline): Promise<void> {
  await mockCapturedJobs[JOB_NAME]!(deadline);
}

describe("the on-call policy worker, a page at a time", () => {
  test("reads the runs still going a keyset page at a time", async () => {
    for (
      let index: number = 0;
      index < POLICY_RUN_PAGE_SIZE * 2 + 50;
      index++
    ) {
      runs.push(pagingRun({ index, waitedMinutes: 5 }));
    }

    await tick();

    expect(runService.findBy).toHaveBeenCalledTimes(3);

    const reads: Array<{
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
      skip: number;
      limit: number;
    }> = runService.findBy.mock.calls.map((call: Array<unknown>) => {
      return call[0] as {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        sort: Record<string, unknown>;
        skip: number;
        limit: number;
      };
    });

    for (const read of reads) {
      expect(read.sort).toEqual({ _id: SortOrder.Ascending });
      expect(read.skip).toBe(0);
      expect(read.limit).toBe(POLICY_RUN_PAGE_SIZE);
      expect(read.select).toBe(POLICY_RUN_SELECT);
      expect(JSON.stringify(read.query["status"])).toContain(
        OnCallDutyPolicyStatus.Executing,
      );
      expect(JSON.stringify(read.query["status"])).toContain(
        OnCallDutyPolicyStatus.Waiting,
      );
    }

    expect(cursorOf(reads[0]!.query)).toBeUndefined();
    expect(cursorOf(reads[1]!.query)).toBe(
      uuid("bbbbbbbb", POLICY_RUN_PAGE_SIZE - 1).toString(),
    );
    expect(cursorOf(reads[2]!.query)).toBe(
      uuid("bbbbbbbb", POLICY_RUN_PAGE_SIZE * 2 - 1).toString(),
    );
  });

  test("reads a page's records in one query, and the project's states once for the run", async () => {
    for (
      let index: number = 0;
      index < POLICY_RUN_PAGE_SIZE * 2 + 50;
      index++
    ) {
      runs.push(pagingRun({ index, waitedMinutes: 5 }));
    }

    await tick();

    expect(incidentService.findBy).toHaveBeenCalledTimes(3);
    expect(
      incidentService.findBy.mock.calls.map((call: Array<unknown>) => {
        return idsIn((call[0] as { query: Record<string, unknown> }).query)
          .length;
      }),
    ).toEqual([POLICY_RUN_PAGE_SIZE, POLICY_RUN_PAGE_SIZE, 50]);
    expect(incidentStateService.findBy).toHaveBeenCalledTimes(1);
  });

  test("a run with nothing to do this minute costs no query of its own", async () => {
    // Open incidents, rules still waiting: thousands of these in a storm.
    for (let index: number = 0; index < 250; index++) {
      runs.push(pagingRun({ index, waitedMinutes: 5, waitMinutes: 30 }));
    }

    await tick();

    expect(runService.updateOneById).not.toHaveBeenCalled();
    expect(runService.startWaitingRun).not.toHaveBeenCalled();
    expect(runService.endWaitingRun).not.toHaveBeenCalled();
    expect(runService.endDirectPageIfItsPagesAreOver).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();

    // 3 pages of runs, 3 of records, 1 of states: 7 queries for 250 runs.
    expect(
      runService.findBy.mock.calls.length +
        incidentService.findBy.mock.calls.length +
        incidentStateService.findBy.mock.calls.length,
    ).toBe(7);
  });

  test("ends every run whose incident was acknowledged, from what the page read", async () => {
    for (let index: number = 0; index < 150; index++) {
      runs.push(
        pagingRun({
          index,
          waitedMinutes: 5,
          incidentState: index % 3 === 0 ? ACKNOWLEDGED_STATE : CREATED_STATE,
        }),
      );
    }

    await tick();

    const ended: Array<string> = runService.updateOneById.mock.calls.map(
      (call: Array<unknown>) => {
        const update: {
          id: ObjectID;
          data: { status: OnCallDutyPolicyStatus; statusMessage: string };
        } = call[0] as {
          id: ObjectID;
          data: { status: OnCallDutyPolicyStatus; statusMessage: string };
        };
        expect(update.data.status).toBe(OnCallDutyPolicyStatus.Completed);
        expect(update.data.statusMessage).toBe(
          getOnCallPolicyRunRecordHandledMessage("incident"),
        );
        return update.id.toString();
      },
    );

    expect(ended).toHaveLength(50);
    expect(advance).not.toHaveBeenCalled();
  });

  test("moves on every run whose wait is over, never more than its limit at once", async () => {
    for (let index: number = 0; index < 60; index++) {
      runs.push(pagingRun({ index, waitedMinutes: 31, waitMinutes: 30 }));
    }

    let inFlight: number = 0;
    let mostInFlight: number = 0;

    advance.mockImplementation(async () => {
      inFlight++;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await new Promise<void>((resolve: () => void) => {
        setImmediate(resolve);
      });
      inFlight--;
    });

    await tick();

    expect(advance).toHaveBeenCalledTimes(60);
    expect(mostInFlight).toBe(POLICY_RUN_CONCURRENCY);
  });

  test("stops between runs and pages once its deadline passes", async () => {
    for (let index: number = 0; index < POLICY_RUN_PAGE_SIZE * 3; index++) {
      runs.push(pagingRun({ index, waitedMinutes: 31, waitMinutes: 30 }));
    }

    const deadline: JobDeadline = new JobDeadline();
    advance.mockImplementation(async () => {
      if (advance.mock.calls.length === 20) {
        deadline.end();
      }
    });

    await tick(deadline);

    expect(runService.findBy).toHaveBeenCalledTimes(1);
    // The runs being moved on when it passed finish; no other starts.
    expect(advance.mock.calls.length).toBeGreaterThanOrEqual(20);
    expect(advance.mock.calls.length).toBeLessThan(20 + POLICY_RUN_CONCURRENCY);
  });

  test("a page whose records cannot be read waits for the next minute, and no run is ended in error", async () => {
    for (let index: number = 0; index < POLICY_RUN_PAGE_SIZE + 10; index++) {
      runs.push(pagingRun({ index, waitedMinutes: 31, waitMinutes: 30 }));
    }

    incidentService.findBy.mockRejectedValueOnce(
      new Error("remaining connection slots are reserved"),
    );

    await tick();

    // The first page waits; the second is worked on.
    expect(advance).toHaveBeenCalledTimes(10);
    expect(runService.updateOneById).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("the page waits for the next run"),
    );
  });

  test("an incident that is gone ends its run in error, as reading it on its own did", async () => {
    const run: OnCallDutyPolicyExecutionLog = pagingRun({
      index: 1,
      waitedMinutes: 5,
    });
    runs.push(run);
    incidentService.findBy.mockResolvedValue([]);

    await tick();

    expect(runService.updateOneById).toHaveBeenCalledWith({
      id: run.id,
      data: {
        status: OnCallDutyPolicyStatus.Error,
        statusMessage: "Incident not found",
      },
      props: { isRoot: true },
    });
  });

  test("an archived policy's run ends without its record being read", async () => {
    const run: OnCallDutyPolicyExecutionLog = pagingRun({
      index: 1,
      waitedMinutes: 5,
    });
    run.onCallDutyPolicy!.isArchived = true;
    runs.push(run);

    await tick();

    expect(incidentService.findBy).not.toHaveBeenCalled();
    expect(runService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: run.id,
        data: expect.objectContaining({
          status: OnCallDutyPolicyStatus.Completed,
        }),
      }),
    );
  });

  test("a minute with no runs reads one empty page and nothing else", async () => {
    await tick();

    expect(runService.findBy).toHaveBeenCalledTimes(1);
    expect(incidentService.findBy).not.toHaveBeenCalled();
    expect(incidentStateService.findBy).not.toHaveBeenCalled();
  });
});
