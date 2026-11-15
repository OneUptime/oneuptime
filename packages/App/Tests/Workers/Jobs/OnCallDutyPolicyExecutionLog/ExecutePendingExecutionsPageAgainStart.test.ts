import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallPageAgainClaimsInFlight from "Common/Server/Utils/OnCall/OnCallPageAgainClaimsInFlight";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import PositiveNumber from "Common/Types/PositiveNumber";
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
import PolicyRunFailureWorld, {
  FailurePoint,
  ProcessStopped,
} from "./PolicyRunFailureWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PAGE AGAIN WHOSE START FAILS BEFORE ITS RULE IS RECORDED STILL PAGES
 * (issue #8514).
 *
 * A page again (an acknowledged record not resolved in time) starts at the
 * escalation rule that was paging, with the person who acknowledged paged
 * first. A database error before that rule was recorded on its run -
 * reading the rule, writing that it started, recording the rule - ended it
 * in Error with nobody paged; the acknowledgement clock was stopped, so no
 * later page again came either. A process that stopped there left it to the
 * stuck-run job, which handed it to its escalation from the policy's first
 * level: neither the rule it starts at nor the person who acknowledged.
 *
 * Now its start is kept in flight until its rule is recorded, and a start
 * that fails or stops is started by the policy-run worker from where it
 * starts, the person who acknowledged first - once each.
 *
 * Driven through the real startPageAgain, the ticks the worker and the
 * stuck-run job register with RunCron, the real rule start and
 * OnCallEscalationAdvance, over PolicyRunFailureWorld.
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
let levelTwo: OnCallDutyPolicyEscalationRule;

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

  world.addLevel({ order: 1, users: [DANA], escalateAfterInMinutes: 10 });
  levelTwo = world.addLevel({
    order: 2,
    users: [BOB, CARL],
    escalateAfterInMinutes: 10,
  });

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
});

afterEach(() => {
  jest.restoreAllMocks();
});

function pagesSoFar(): Array<string> {
  return world.pagesSince(START);
}

// Ana acknowledged the incident, and is paged first by its page again at Level 2.
async function pageAgain(): Promise<void> {
  await world.startPageAgain({ startAtRule: levelTwo, acknowledgedBy: ANA });
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

function startsRule(
  rule: OnCallDutyPolicyEscalationRule,
): (args: Array<unknown>) => boolean {
  return (args: Array<unknown>): boolean => {
    return String((args[0] as { id?: ObjectID }).id) === rule.id!.toString();
  };
}

function writesStatus(
  status: OnCallDutyPolicyStatus,
): (args: Array<unknown>) => boolean {
  return (args: Array<unknown>): boolean => {
    return (args[0] as { data?: { status?: string } }).data?.status === status;
  };
}

const PAGED_AT_ONE: Array<string> = [
  "Ana Lopez L2 @ 1",
  "Bob Smith L2 @ 1",
  "Carl Diaz L2 @ 1",
];

// The run whose acknowledgement clock the page again stopped.
const PAGED_RUN_ID: ObjectID = new ObjectID(
  "85490000-0000-4000-8000-0000000000e1",
);

const PAGED_AT_ZERO: Array<string> = [
  "Ana Lopez L2 @ 0",
  "Bob Smith L2 @ 0",
  "Carl Diaz L2 @ 0",
];

describe("a page again whose start fails before its rule is recorded", () => {
  test("REGRESSION: the read of the rule it starts at failing: the worker starts it the next minute, from that rule, the person who acknowledged first - once each", async () => {
    world.failAt(FailurePoint.ReadNextRule);

    // Whoever started the page again is not failed: it is paged from here.
    await expect(pageAgain()).resolves.toBeUndefined();

    expect(pagesSoFar()).toEqual([]);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Executing);

    await minutesPass(1);

    expect(pagesSoFar()).toEqual(PAGED_AT_ONE);

    await minutesPass(5);

    expect(pagesSoFar()).toEqual(PAGED_AT_ONE);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
    expect(world.runStatuses).not.toContain(OnCallDutyPolicyStatus.Error);
  });

  test("its Started write failing: the same, started the next minute", async () => {
    world.failAt(FailurePoint.WriteRunStatus, {
      when: writesStatus(OnCallDutyPolicyStatus.Started),
    });

    await pageAgain();
    await minutesPass(1);

    expect(pagesSoFar()).toEqual(PAGED_AT_ONE);
  });

  test("the read of its rule as it starts failing: the same", async () => {
    world.failAt(FailurePoint.ReadStartingRule, { when: startsRule(levelTwo) });

    await pageAgain();
    await minutesPass(1);

    expect(pagesSoFar()).toEqual(PAGED_AT_ONE);
  });

  test("the record of its rule failing: the same", async () => {
    world.failAt(FailurePoint.RecordRule);

    await pageAgain();
    await minutesPass(1);

    expect(pagesSoFar()).toEqual(PAGED_AT_ONE);
  });

  test("a start that keeps failing is tried at the worker's tries, then ends in Error saying why", async () => {
    world.failAlwaysAt(FailurePoint.ReadNextRule);

    await pageAgain();
    await minutesPass(45);

    expect(pagesSoFar()).toEqual([]);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Error);
    expect(world.run.statusMessage).toContain("every try failed");
  });

  test("an incident resolved before the worker's try is not paged about", async () => {
    world.failAt(FailurePoint.ReadNextRule);

    await pageAgain();
    world.isRecordResolved = true;
    await minutesPass(1);

    expect(pagesSoFar()).toEqual([]);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Completed);
  });
});

describe("a page again whose start stopped - a worker that restarted - before its rule was recorded", () => {
  test("REGRESSION: handed over just after five minutes, it is started from the rule it starts at, the person who acknowledged first - not from the policy's first level", async () => {
    world.crashAt(FailurePoint.ReadNextRule);

    await pageAgain().catch(() => {
      return undefined;
    });
    world.stopped = false;

    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Scheduled);

    await minutesPass(5);

    expect(pagesSoFar()).toEqual([]);

    await minutesPass(1);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L2 @ 6",
      "Bob Smith L2 @ 6",
      "Carl Diaz L2 @ 6",
    ]);
    // Never Dana, Level 1's.
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
  });

  test("stopped once it was Started: the same, from the rule it starts at", async () => {
    world.crashAt(FailurePoint.ReadStartingRule, {
      when: startsRule(levelTwo),
    });

    await pageAgain().catch(() => {
      return undefined;
    });
    world.stopped = false;

    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Started);

    await minutesPass(6);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L2 @ 6",
      "Bob Smith L2 @ 6",
      "Carl Diaz L2 @ 6",
    ]);
  });

  test("a Redis that is down keeps no start: handed over, it pages from the policy's first level, as any stuck run does", async () => {
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValue(new Error("Cache is not connected") as never);
    jest
      .spyOn(GlobalCache, "getStrings")
      .mockRejectedValue(new Error("Cache is not connected") as never);
    world.crashAt(FailurePoint.ReadNextRule);

    await pageAgain().catch(() => {
      return undefined;
    });
    world.stopped = false;

    await minutesPass(6);

    expect(pagesSoFar()).toEqual(["Dana Kim L1 @ 6"]);
  });
});

describe("a page again whose process stopped once its run was written, before it kept its start (issue #8549)", () => {
  // What the page-again tick does with it, two minutes on (OnCallPageAgainStoppedProcess shows when).
  async function settledByThePageAgainTick(): Promise<boolean> {
    return await OnCallDutyPolicyExecutionLogService.keepPageAgainStartIfMissing(
      {
        runId: world.run.id!,
        startAtRuleId: levelTwo.id!.toString(),
        acknowledgedByUserId: ANA.toString(),
        minutes: 30,
        dueAt: new Date(START),
      },
    );
  }

  function startsKept(): Array<string> {
    return Array.from(world.cache.keys()).filter((key: string) => {
      return key.startsWith("on-call-levels-in-flight");
    });
  }

  test("REGRESSION: its start kept by the page-again tick, it is handed over just after five minutes and started from the rule it starts at, the person who acknowledged first - once each", async () => {
    await world
      .startPageAgain({
        startAtRule: levelTwo,
        acknowledgedBy: ANA,
        onRunCreated: (): void => {
          world.stopped = true;
          throw new ProcessStopped();
        },
      })
      .catch(() => {
        return undefined;
      });
    world.stopped = false;

    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Scheduled);
    expect(startsKept()).toEqual([]);

    await minutesPass(2);
    await expect(settledByThePageAgainTick()).resolves.toBe(true);
    expect(startsKept()).toHaveLength(1);

    await minutesPass(3);

    expect(pagesSoFar()).toEqual([]);

    await minutesPass(1);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L2 @ 6",
      "Bob Smith L2 @ 6",
      "Carl Diaz L2 @ 6",
    ]);

    // Settled again, it keeps nothing: its rule is recorded.
    await expect(settledByThePageAgainTick()).resolves.toBe(false);

    await minutesPass(3);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L2 @ 6",
      "Bob Smith L2 @ 6",
      "Carl Diaz L2 @ 6",
    ]);
    // Never Dana, Level 1's.
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
    expect(world.runStatuses).not.toContain(OnCallDutyPolicyStatus.Error);
  });

  test("REGRESSION: its workers down past five minutes, the stuck-run job keeps its start from the page again in flight before it hands it over - not from the policy's first level", async () => {
    await world
      .startPageAgain({
        startAtRule: levelTwo,
        acknowledgedBy: ANA,
        onRunCreated: async (runId: ObjectID): Promise<void> => {
          // As the page-again tick keeps its page again in flight, once its run is written.
          await OnCallPageAgainClaimsInFlight.keep(PAGED_RUN_ID, {
            claimedAt: new Date(START),
            clockStartedAt: new Date(START.getTime() - 30 * MINUTE),
            pageAgainNumber: 1,
            startAtRuleId: levelTwo.id!.toString(),
            acknowledgedByUserId: ANA.toString(),
            minutes: 30,
            dueAt: new Date(START),
            pageAgainRunId: runId.toString(),
          });

          world.stopped = true;
          throw new ProcessStopped();
        },
      })
      .catch(() => {
        return undefined;
      });
    world.stopped = false;

    // The workers are down for six minutes: nothing settles it.
    world.clock = new Date(world.clock.getTime() + 6 * MINUTE);

    // Back, the stuck-run job runs before the page-again tick.
    await minutesPass(1);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L2 @ 7",
      "Bob Smith L2 @ 7",
      "Carl Diaz L2 @ 7",
    ]);

    // The page-again tick, when it settles it, keeps nothing more.
    await expect(settledByThePageAgainTick()).resolves.toBe(false);

    await minutesPass(3);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L2 @ 7",
      "Bob Smith L2 @ 7",
      "Carl Diaz L2 @ 7",
    ]);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
  });

  test("one whose start was kept is not kept over: the page again started, it is paged from its rule once", async () => {
    await pageAgain();

    await expect(settledByThePageAgainTick()).resolves.toBe(false);

    await minutesPass(6);

    expect(pagesSoFar()).toEqual(PAGED_AT_ZERO);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
  });
});

describe("a page again that starts as it should", () => {
  test("pages from the rule it starts at once, the person who acknowledged first, and leaves nothing in flight", async () => {
    await pageAgain();

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L2 @ 0",
      "Bob Smith L2 @ 0",
      "Carl Diaz L2 @ 0",
    ]);

    await minutesPass(6);

    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
    expect(
      Array.from(world.cache.keys()).filter((key: string) => {
        return key.startsWith("on-call-levels-in-flight");
      }),
    ).toEqual([]);
  });
});
