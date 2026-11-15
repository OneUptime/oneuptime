import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ObjectID from "Common/Types/ObjectID";
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
 * A STEP OF A POLICY RUN THAT FAILS IS TRIED AGAIN, AND PAGES NOBODY TWICE
 * (issue #8167).
 *
 * The worker that moves on-call policy runs on ended a run in Error on any
 * error: a database blip as it paged the next escalation rule, and none of
 * the run's later rules was ever paged. Here the database fails under the
 * REAL worker at each step of a run - the claim that moves it on, the read
 * of its next rule, the rule starting and being recorded, a person's page,
 * the run's status, the claim that starts a run that waited - and the
 * worker restarts in the middle of each (PolicyRunFailureWorld). Every
 * time, the run goes on paging and nobody is paged twice by a rule in a
 * pass:
 *
 *   - a failure before anybody was paged is tried again a minute later,
 *     and the level is paged then - not a whole rule's wait later: a move
 *     that failed after its claim gives the claim back
 *     (giveBackEscalationAdvance), and a start that failed after its claim
 *     hands the run to its escalation (handStartedRunToEscalation);
 *   - a failure in the middle of a level keeps what it paged, and the run
 *     goes on to the next level once the level's wait is over;
 *   - a worker that stops part-way keeps nothing back, and the next tick
 *     carries on from what the database holds.
 *
 * The policy: Level 1 pages Ana, Level 2 pages Bob and Carl, Level 3 pages
 * Dana, each waiting 10 minutes before the next.
 */

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

const JOB_NAME: string =
  "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions";

// The tick itself: what the worker registered with RunCron as it was imported.
const runTick: () => Promise<void> = (
  RunCron as unknown as jest.Mock
).mock.calls.find((call: Array<unknown>): boolean => {
  return call[0] === JOB_NAME;
})![2] as () => Promise<void>;

let world: PolicyRunFailureWorld;
let levelOne: OnCallDutyPolicyEscalationRule;
let levelTwo: OnCallDutyPolicyEscalationRule;
let levelThree: OnCallDutyPolicyEscalationRule;

beforeEach(() => {
  world = new PolicyRunFailureWorld();
  world.install();
  world.useWorkerTick(runTick);

  levelOne = world.addLevel({
    order: 1,
    users: [ANA],
    escalateAfterInMinutes: 10,
  });
  levelTwo = world.addLevel({
    order: 2,
    users: [BOB, CARL],
    escalateAfterInMinutes: 10,
  });
  levelThree = world.addLevel({
    order: 3,
    users: [DANA],
    escalateAfterInMinutes: 10,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// A call reads the rule of `order`, or pages `userId`, or starts `rule`.
function readsOrder(order: number): (args: Array<unknown>) => boolean {
  return (args: Array<unknown>): boolean => {
    return (args[0] as { query?: { order?: number } }).query?.order === order;
  };
}

function pages(userId: ObjectID): (args: Array<unknown>) => boolean {
  return (args: Array<unknown>): boolean => {
    return String(args[0]).toLowerCase() === userId.toString().toLowerCase();
  };
}

function starts(
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

function run(): OnCallDutyPolicyExecutionLog {
  return world.run;
}

// Every page so far, as "<name> L<level> @ <minute since START>".
function pagesSoFar(): Array<string> {
  return world.pagesSince(START);
}

// Ticks once a minute for `minutes` minutes.
async function minutesPass(minutes: number): Promise<void> {
  for (let minute: number = 0; minute < minutes; minute++) {
    await world.workerTickAfter(1);
  }
}

// A run that waited to page until START + `inMinutes`.
function waitingRun(inMinutes: number): OnCallDutyPolicyExecutionLog {
  const waiting: OnCallDutyPolicyExecutionLog = world.newRun();
  waiting.status = OnCallDutyPolicyStatus.Waiting;
  waiting.pagingStartsAt = new Date(START.getTime() + inMinutes * 60 * 1000);
  return waiting;
}

describe("a run that pages, its move to the next level failing", () => {
  test("REGRESSION: a database blip at the claim leaves the run paging, and the next minute pages the next level, once", async () => {
    await world.startRun();
    world.failAt(FailurePoint.ClaimMoveOn);

    await minutesPass(10);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0"]);
    expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);
    expect(world.keptFailures()).toMatchObject({ failedTries: 1 });

    await minutesPass(1);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 11",
      "Carl Diaz L2 @ 11",
    ]);
    // It went on: its failed try is forgotten.
    expect(world.keptFailures()).toBeNull();

    await minutesPass(10);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 11",
      "Carl Diaz L2 @ 11",
      "Dana Kim L3 @ 21",
    ]);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
    expect(world.runStatuses).not.toContain(OnCallDutyPolicyStatus.Error);
  });

  test.each([
    {
      step: "the read of the next rule, after its claim",
      point: FailurePoint.ReadNextRule,
      when: readsOrder(2),
    },
    {
      step: "the read of the next rule as it starts",
      point: FailurePoint.ReadStartingRule,
      when: (args: Array<unknown>): boolean => {
        return starts(levelTwo)(args);
      },
    },
    {
      step: "the record of the next rule on the run",
      point: FailurePoint.RecordRule,
      when: undefined,
    },
  ])(
    "REGRESSION: $step - nobody was paged, so the claim is given back, and the next minute pages the level",
    async (data: {
      point: FailurePoint;
      when: ((args: Array<unknown>) => boolean) | undefined;
    }) => {
      await world.startRun();
      world.failAt(data.point, { when: data.when });

      await minutesPass(10);

      expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0"]);
      // Its rule's wait was not started afresh by a claim that paged nobody.
      expect(run().lastEscalationRuleExecutedAt).toEqual(START);
      expect(run().lastExecutedEscalationRuleId?.toString()).toBe(
        levelOne.id!.toString(),
      );

      await minutesPass(1);

      // Paged a minute later - not a whole 10-minute wait later.
      expect(pagesSoFar()).toEqual([
        "Ana Lopez L1 @ 0",
        "Bob Smith L2 @ 11",
        "Carl Diaz L2 @ 11",
      ]);
      expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
      expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);
    },
  );

  test("REGRESSION: in the middle of a level: the rest of it is paged the next minute, nobody is paged twice, and the next level comes after its wait", async () => {
    await world.startRun();
    // Bob is paged; the page of Carl, Level 2's second person, fails.
    world.failAt(FailurePoint.PagePerson, { when: pages(CARL) });

    await minutesPass(10);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0", "Bob Smith L2 @ 10"]);
    expect(run().lastExecutedEscalationRuleOrder).toBe(2);
    expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);

    await minutesPass(10);

    /*
     * Level 2 is resumed, not started again (issue #8406): Carl, whose page
     * failed, is paged the next minute, and Bob is not paged twice. Level 3
     * is paged on time, Level 2's wait run from when it started.
     */
    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 10",
      "Carl Diaz L2 @ 11",
      "Dana Kim L3 @ 20",
    ]);
    expect(world.timesPaged(BOB, levelTwo)).toBe(1);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
  });

  test("a run whose record was acknowledged, its ending failing, ends the next minute, paging nobody more", async () => {
    await world.startRun();
    world.isRecordAcknowledged = true;
    world.failAt(FailurePoint.WriteRunStatus, {
      when: writesStatus(OnCallDutyPolicyStatus.Completed),
    });

    await minutesPass(1);

    expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);

    await minutesPass(1);

    expect(run().status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(run().statusMessage).toBe(
      "Execution completed because incident is acknowledged or resolved.",
    );

    await minutesPass(20);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0"]);
  });

  test("a run that went through every rule, its ending failing, ends the next minute", async () => {
    await world.startRun();
    await minutesPass(20);

    expect(pagesSoFar()).toHaveLength(4);

    world.failAt(FailurePoint.WriteRunStatus, {
      when: writesStatus(OnCallDutyPolicyStatus.Completed),
    });

    await minutesPass(10);

    expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);

    await minutesPass(1);

    expect(run().status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(pagesSoFar()).toHaveLength(4);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
  });

  test("a policy that repeats, the write that begins it again failing, begins it again the next minute - once", async () => {
    world.repeatsAllowed = 1;
    world.rules = [levelOne];
    await world.startRun();
    world.failAt(FailurePoint.WriteRepeat);

    await minutesPass(10);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0"]);
    expect(run().onCallPolicyExecutionRepeatCount).toBe(1);

    await minutesPass(1);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0", "Ana Lopez L1 @ 11"]);
    expect(run().onCallPolicyExecutionRepeatCount).toBe(2);

    await minutesPass(10);

    // Its one repeat used, it ends.
    expect(run().status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0", "Ana Lopez L1 @ 11"]);
  });
});

describe("a run that waited, its start failing", () => {
  test("REGRESSION: the claim to start fails: it still waits, and starts the next minute, paging Level 1 once", async () => {
    waitingRun(5);
    world.failAt(FailurePoint.ClaimStart);

    await minutesPass(5);

    expect(run().status).toBe(OnCallDutyPolicyStatus.Waiting);
    expect(pagesSoFar()).toEqual([]);

    await minutesPass(1);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 6"]);
    expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);
  });

  test.each([
    {
      step: "the read of its first rule, after its claim",
      point: FailurePoint.ReadNextRule,
      when: readsOrder(1),
    },
    {
      step: "the read of its first rule as it starts",
      point: FailurePoint.ReadStartingRule,
      when: (args: Array<unknown>): boolean => {
        return starts(levelOne)(args);
      },
    },
    {
      step: "the record of its first rule on the run",
      point: FailurePoint.RecordRule,
      when: undefined,
    },
  ])(
    "REGRESSION: $step - it is handed to its escalation, which pages Level 1 the next minute, once",
    async (data: {
      point: FailurePoint;
      when: ((args: Array<unknown>) => boolean) | undefined;
    }) => {
      waitingRun(5);
      world.failAt(data.point, { when: data.when });

      await minutesPass(5);

      /*
       * It was Started by its claim, which no tick reads: it used to stay
       * so until it was timed out, having paged nobody.
       */
      expect(pagesSoFar()).toEqual([]);
      expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);
      expect(world.runStatuses).not.toContain(OnCallDutyPolicyStatus.Error);
      // Its escalation starts at once, from when its page was due.
      expect(run().executeNextEscalationRuleInMinutes).toBe(0);
      expect(run().lastEscalationRuleExecutedAt).toEqual(
        new Date(START.getTime() + 5 * 60 * 1000),
      );

      await minutesPass(1);

      expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 6"]);

      await minutesPass(10);

      expect(pagesSoFar()).toEqual([
        "Ana Lopez L1 @ 6",
        "Bob Smith L2 @ 16",
        "Carl Diaz L2 @ 16",
      ]);
      expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
    },
  );

  // The rest of its first level is paged the next minute (issue #8406).
  test("as its first rule pages: who it paged stays paged, the rest of the level is paged the next minute, and the escalation goes on from that rule", async () => {
    world.rules = [levelTwo, levelThree];
    levelTwo.order = 1;
    levelThree.order = 2;
    waitingRun(5);
    world.failAt(FailurePoint.PagePerson, { when: pages(CARL) });

    await minutesPass(5);

    expect(pagesSoFar()).toEqual(["Bob Smith L1 @ 5"]);
    expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);

    await minutesPass(10);

    expect(pagesSoFar()).toEqual([
      "Bob Smith L1 @ 5",
      "Carl Diaz L1 @ 6",
      "Dana Kim L2 @ 15",
    ]);
    expect(world.timesPaged(BOB, levelTwo)).toBe(1);
    expect(world.timesPaged(CARL, levelTwo)).toBe(1);
  });

  test("its last write, that it is paging, failing: it pages on, from its first rule's wait", async () => {
    waitingRun(5);
    world.failAt(FailurePoint.WriteRunStatus, {
      when: writesStatus(OnCallDutyPolicyStatus.Executing),
    });

    await minutesPass(5);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 5"]);
    expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);

    await minutesPass(10);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 5",
      "Bob Smith L2 @ 15",
      "Carl Diaz L2 @ 15",
    ]);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
  });

  test("a run whose record was acknowledged while it waited, its ending failing, ends the next minute, unpaged", async () => {
    waitingRun(30);
    world.isRecordAcknowledged = true;
    world.failAt(FailurePoint.ClaimStart);

    await minutesPass(1);

    expect(run().status).toBe(OnCallDutyPolicyStatus.Waiting);

    await minutesPass(1);

    expect(run().status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(pagesSoFar()).toEqual([]);
  });
});

describe("a worker that restarts in the middle of a run", () => {
  /*
   * The move on was kept in flight (issue #8410): the worker gives its
   * claim back two minutes after it was taken, and the next level is paged
   * then - not a whole rule wait later.
   */
  test("REGRESSION: stopped after the claim, before the next rule: the claim is given back two minutes on, and the next level is paged then, once", async () => {
    await world.startRun();
    world.crashAt(FailurePoint.ReadNextRule, { when: readsOrder(2) });

    await minutesPass(10);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0"]);
    // The process that claimed the move kept nothing back, nor a failure.
    expect(world.keptFailures()).toBeNull();

    // A minute on, the move may still be under way: left to it.
    await minutesPass(1);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0"]);

    await minutesPass(1);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 12",
      "Carl Diaz L2 @ 12",
    ]);

    await minutesPass(10);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 12",
      "Carl Diaz L2 @ 12",
      "Dana Kim L3 @ 22",
    ]);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
  });

  /*
   * The level shows no sign of life after Bob, and is resumed two minutes
   * on (issue #8406): Carl is paged then, and nobody it paged is paged again.
   */
  test("REGRESSION: stopped in the middle of a level: the rest of it is paged two minutes on, nobody it paged is paged again, and the run goes on", async () => {
    await world.startRun();
    world.crashAt(FailurePoint.PagePerson, { when: pages(CARL) });

    await minutesPass(20);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 10",
      "Carl Diaz L2 @ 12",
      "Dana Kim L3 @ 20",
    ]);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
    expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);
  });

  test("stopped as a failed try was being kept: the next tick tries again as a first failure, and pages once", async () => {
    await world.startRun();
    // The claim fails, and the process stops before the failure is kept.
    world.failAt(FailurePoint.ClaimMoveOn, {
      error: (): unknown => {
        world.stopped = true;
        return new Error("Connection terminated unexpectedly");
      },
    });

    await minutesPass(10);

    expect(world.keptFailures()).toBeNull();
    expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);

    await minutesPass(1);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 11",
      "Carl Diaz L2 @ 11",
    ]);
  });

  test("stopped after a waiting run's start was claimed: nobody is paged twice, and the run is left Started", async () => {
    waitingRun(5);
    world.crashAt(FailurePoint.ReadNextRule, { when: readsOrder(1) });

    await minutesPass(5);
    await minutesPass(10);

    /*
     * The process that claimed the start stopped before it could hand the
     * run over: no tick of this worker reads a Started run, and the run is
     * TimeoutStuckExecutions' to end. Nobody was paged, so nobody is twice.
     */
    expect(run().status).toBe(OnCallDutyPolicyStatus.Started);
    expect(pagesSoFar()).toEqual([]);
  });

  test("the failed tries outlive restarts: every tick a fresh process, the run still ends at its tenth", async () => {
    await world.startRun();
    world.failAlwaysAt(FailurePoint.ClaimMoveOn);

    /*
     * Every tick is a fresh process - the worker keeps nothing of a run in
     * memory - and the tries come at minutes 10, 11, 13, 17, 22, 27, 32 ...
     */
    await minutesPass(36);

    expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);
    expect(world.keptFailures()).toMatchObject({ failedTries: 7 });

    // ... 37, 42 and 47, the tenth: Redis kept the count for each.
    await minutesPass(10);

    expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);
    expect(world.keptFailures()).toMatchObject({ failedTries: 9 });

    await minutesPass(1);

    expect(run().status).toBe(OnCallDutyPolicyStatus.Error);
    expect(world.keptFailures()).toBeNull();
  });
});

describe("a run whose step fails for a reason a retry cannot fix", () => {
  test("its incident deleted: it ends at once, saying so, as it always did", async () => {
    await world.startRun();
    world.isIncidentGone = true;

    await minutesPass(1);

    expect(run().status).toBe(OnCallDutyPolicyStatus.Error);
    expect(run().statusMessage).toBe("Incident not found");
    expect(world.keptFailures()).toBeNull();
  });

  test("its next rule deleted as it moves on: it ends at once, saying so", async () => {
    await world.startRun();
    // Level 2 is found, then deleted before it starts.
    world.failAt(FailurePoint.ReadStartingRule, {
      when: (args: Array<unknown>): boolean => {
        if (starts(levelTwo)(args)) {
          world.rules = world.rules.filter(
            (rule: OnCallDutyPolicyEscalationRule) => {
              return rule.id!.toString() !== levelTwo.id!.toString();
            },
          );
        }

        return false;
      },
    });

    await minutesPass(10);

    expect(run().status).toBe(OnCallDutyPolicyStatus.Error);
    expect(run().statusMessage).toBe(
      `The escalation rule ${levelTwo.id!.toString()} no longer exists. It may have been deleted.`,
    );
    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0"]);
  });
});
