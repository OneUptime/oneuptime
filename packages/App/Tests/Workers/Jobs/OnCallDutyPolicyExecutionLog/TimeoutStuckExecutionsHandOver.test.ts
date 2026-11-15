import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import ProjectMilestoneService from "Common/Server/Services/ProjectMilestoneService";
import OneUptimeDate from "Common/Types/Date";
import PositiveNumber from "Common/Types/PositiveNumber";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  ANA,
  BOB,
  CARL,
  DANA,
  START,
} from "Common/Tests/Server/Utils/OnCall/PassOnWorld";
import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/TimeoutStuckExecutions";
import PolicyRunFailureWorld, { FailurePoint } from "./PolicyRunFailureWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A POLICY RUN LEFT STARTED OR SCHEDULED IS PAGED, NOT TIMED OUT
 * (issue #8405).
 *
 * A run moves from Scheduled to Started to Executing as it starts: its
 * create hook writes Started, pages its first escalation rule, and writes
 * Executing. The worker reads only Executing and Waiting runs, and
 * TimeoutStuckExecutions ended a run still Started or Scheduled five
 * minutes on in Error - having paged nobody: a database error as the run
 * started, a process that stopped as it started, and the incident's first
 * level, and every level after it, was never paged.
 *
 * Now a start that fails hands the run to its escalation at once, and the
 * stuck-run job hands over one whose start never finished. Its escalation
 * pages what the start did not - from its first rule at once when none was
 * recorded on it - claimed, so nobody is paged twice.
 *
 * Driven through the real create hook (onCreateSuccess), the ticks the
 * worker and the stuck-run job register with RunCron, the real rule start
 * and OnCallEscalationAdvance, over PolicyRunFailureWorld.
 */

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

function registeredTick(name: string): () => Promise<void> {
  return (RunCron as unknown as jest.Mock).mock.calls.find(
    (call: Array<unknown>): boolean => {
      return call[0] === name;
    },
  )![2] as () => Promise<void>;
}

const workerTick: () => Promise<void> = registeredTick(
  "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions",
);
const stuckJobTick: () => Promise<void> = registeredTick(
  "OnCallDutyPolicyExecutionLog:TimeoutStuckExecutions",
);

const MINUTE: number = 60 * 1000;

let world: PolicyRunFailureWorld;

// The values a FindOperator was made with: Raw's parameters.
function operatorValues(operator: unknown): Array<unknown> {
  return Object.values(
    (operator as { objectLiteralParameters?: Record<string, unknown> })
      .objectLiteralParameters || {},
  );
}

beforeEach(() => {
  world = new PolicyRunFailureWorld();
  world.install();
  world.useWorkerTick(workerTick);

  world.addLevel({ order: 1, users: [ANA], escalateAfterInMinutes: 10 });
  world.addLevel({ order: 2, users: [BOB, CARL], escalateAfterInMinutes: 10 });
  world.addLevel({ order: 3, users: [DANA], escalateAfterInMinutes: 10 });

  // Minutes ago, on the world's clock.
  jest.spyOn(OneUptimeDate, "getSomeMinutesAgo").mockImplementation(((
    minutes: number | PositiveNumber,
  ) => {
    const value: number =
      minutes instanceof PositiveNumber ? minutes.toNumber() : minutes;
    return new Date(world.clock.getTime() - value * MINUTE);
  }) as never);

  // The stuck-run job's reads: runs in a status, written before a moment.
  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "findAllBy")
    .mockImplementation((async (args: { query: Record<string, unknown> }) => {
      if (world.stopped) {
        throw new Error("The worker's process stopped here.");
      }

      const before: Date = new Date(
        operatorValues(args.query["createdAt"])[0] as Date,
      );

      return world.runs
        .filter((candidate: OnCallDutyPolicyExecutionLog) => {
          return (
            candidate.status === args.query["status"] &&
            candidate.createdAt!.getTime() < before.getTime()
          );
        })
        .map((candidate: OnCallDutyPolicyExecutionLog) => {
          return Object.assign(new OnCallDutyPolicyExecutionLog(), candidate);
        });
    }) as never);

  // The create hook's feed line and milestone are not what is tested here.
  jest
    .spyOn(
      OnCallDutyPolicyExecutionLogService as never,
      "getPolicyLink" as never,
    )
    .mockResolvedValue(null as never);
  jest
    .spyOn(ProjectMilestoneService, "reachInBackground")
    .mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function run(): OnCallDutyPolicyExecutionLog {
  return world.run;
}

function pagesSoFar(): Array<string> {
  return world.pagesSince(START);
}

/*
 * The run is created, and its create hook starts it, as OneUptime does for
 * an incident: whatever the hook throws, it throws at whoever created it.
 */
async function createRun(): Promise<void> {
  const created: OnCallDutyPolicyExecutionLog = world.newRun();

  try {
    await (
      OnCallDutyPolicyExecutionLogService as unknown as {
        onCreateSuccess: (
          onCreate: unknown,
          item: OnCallDutyPolicyExecutionLog,
        ) => Promise<unknown>;
      }
    ).onCreateSuccess({ carryForward: null }, created);
  } finally {
    world.stopped = false;
  }
}

// A minute passes: the stuck-run job runs, then the worker, as in production.
async function minutesPass(minutes: number): Promise<void> {
  for (let minute: number = 0; minute < minutes; minute++) {
    world.clock = new Date(world.clock.getTime() + MINUTE);

    try {
      await stuckJobTick();
    } finally {
      world.stopped = false;
    }

    await world.workerTickAfter(0);
  }
}

function readsOrder(order: number): (args: Array<unknown>) => boolean {
  return (args: Array<unknown>): boolean => {
    return (args[0] as { query?: { order?: number } }).query?.order === order;
  };
}

function writesStatus(
  status: OnCallDutyPolicyStatus,
): (args: Array<unknown>) => boolean {
  return (args: Array<unknown>): boolean => {
    return (args[0] as { data?: { status?: string } }).data?.status === status;
  };
}

describe("a run whose start fails as it is created", () => {
  test("REGRESSION: the read of its first rule failing hands it to its escalation, which pages Level 1 the next minute, and every level after, once", async () => {
    world.failAt(FailurePoint.ReadNextRule, { when: readsOrder(1) });

    // Whoever created it is not failed: the run is paged from here.
    await expect(createRun()).resolves.toBeUndefined();

    expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);
    expect(pagesSoFar()).toEqual([]);

    await minutesPass(21);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 1",
      "Bob Smith L2 @ 11",
      "Carl Diaz L2 @ 11",
      "Dana Kim L3 @ 21",
    ]);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
    expect(world.runStatuses.includes(OnCallDutyPolicyStatus.Error)).toBe(
      false,
    );
  });

  test("its Started write failing hands it over from Scheduled, and Level 1 is paged the next minute", async () => {
    world.failAt(FailurePoint.WriteRunStatus, {
      when: writesStatus(OnCallDutyPolicyStatus.Started),
    });

    await createRun();

    expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);

    await minutesPass(11);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 1",
      "Bob Smith L2 @ 11",
      "Carl Diaz L2 @ 11",
    ]);
  });

  test("the read of its first rule as it starts failing: nobody was paged, and Level 1 is paged the next minute", async () => {
    world.failAt(FailurePoint.ReadStartingRule);

    await createRun();
    await minutesPass(1);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 1"]);
  });

  test("a start that keeps failing is tried by the worker a few times, then ends in Error saying why - not timed out with nobody told why", async () => {
    world.failAlwaysAt(FailurePoint.ReadNextRule);

    await createRun();
    await minutesPass(45);

    expect(run().status).toBe(OnCallDutyPolicyStatus.Error);
    expect(run().statusMessage).toContain("every try failed");
    expect(pagesSoFar()).toEqual([]);
  });

  test("a start that goes through is never handed over: each level is paged once", async () => {
    await createRun();
    await minutesPass(25);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 10",
      "Carl Diaz L2 @ 10",
      "Dana Kim L3 @ 20",
    ]);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
  });
});

describe("a run whose start stopped - a worker that restarted as it started", () => {
  test("REGRESSION: stopped before it was Started: still Scheduled five minutes on, it is handed over just after, and Level 1 is paged then, once", async () => {
    world.crashAt(FailurePoint.ReadNextRule, { when: readsOrder(1) });

    // A process that stopped: what it throws, if anything, reaches nobody.
    await createRun().catch(() => {
      return undefined;
    });

    expect(run().status).toBe(OnCallDutyPolicyStatus.Scheduled);

    await minutesPass(4);

    expect(run().status).toBe(OnCallDutyPolicyStatus.Scheduled);
    expect(pagesSoFar()).toEqual([]);

    await minutesPass(12);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 6",
      "Bob Smith L2 @ 16",
      "Carl Diaz L2 @ 16",
    ]);
    expect(world.runStatuses.includes(OnCallDutyPolicyStatus.Error)).toBe(
      false,
    );
  });

  test("REGRESSION: stopped once Started, before its first rule was recorded: handed over just after five minutes, and Level 1 is paged then, once", async () => {
    world.crashAt(FailurePoint.ReadStartingRule);

    // A process that stopped: what it throws, if anything, reaches nobody.
    await createRun().catch(() => {
      return undefined;
    });

    expect(run().status).toBe(OnCallDutyPolicyStatus.Started);

    await minutesPass(16);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 6",
      "Bob Smith L2 @ 16",
      "Carl Diaz L2 @ 16",
    ]);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
  });

  test("a run that waited, its start stopped after its claim: handed over once it is more than five minutes past its paging start, and Level 1 is paged then", async () => {
    const waiting: OnCallDutyPolicyExecutionLog = world.newRun();
    waiting.status = OnCallDutyPolicyStatus.Waiting;
    waiting.pagingStartsAt = new Date(START.getTime() + 5 * MINUTE);
    world.crashAt(FailurePoint.ReadNextRule, { when: readsOrder(1) });

    await minutesPass(5);

    expect(run().status).toBe(OnCallDutyPolicyStatus.Started);

    // Stuck once its paging start, moved to the tick that claimed it, is over five minutes ago.
    await minutesPass(6);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 11"]);

    await minutesPass(10);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 11",
      "Bob Smith L2 @ 21",
      "Carl Diaz L2 @ 21",
    ]);
  });

  test("a stuck run whose incident was acknowledged since is handed over, and ends paging nobody", async () => {
    world.crashAt(FailurePoint.ReadStartingRule);
    // A process that stopped: what it throws, if anything, reaches nobody.
    await createRun().catch(() => {
      return undefined;
    });

    world.isRecordAcknowledged = true;
    await minutesPass(6);

    expect(pagesSoFar()).toEqual([]);
    expect(run().status).toBe(OnCallDutyPolicyStatus.Completed);
  });
});
