import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import ObjectID from "Common/Types/ObjectID";
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
 * A MOVE ON WHOSE PROCESS STOPS AFTER ITS CLAIM IS GIVEN BACK
 * (issue #8410).
 *
 * A run moves on to its next escalation rule by a claim first, which moves
 * its lastEscalationRuleExecutedAt to the moment of the claim - and that
 * also starts the wait of the rule it is on afresh. A move that fails
 * before its next rule gives the claim back (#8167). A worker whose
 * process stopped there - a deploy, an OOM kill - never did: the run
 * waited its rule's whole wait again, and the next level was paged that
 * much later.
 *
 * Now the move on is kept in flight while it is under way, and the worker
 * gives the claim back two minutes after it was taken: the next level is
 * paged then, once. One whose next rule started keeps its claim - some of
 * its people may be paged - and its level is resumed instead (#8406).
 *
 * Driven through the tick the worker registers with RunCron, the real
 * OnCallEscalationAdvance, rule start and give-back, over
 * PolicyRunFailureWorld.
 */

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

const runTick: () => Promise<void> = (
  RunCron as unknown as jest.Mock
).mock.calls.find((call: Array<unknown>): boolean => {
  return call[0] === "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions";
})![2] as () => Promise<void>;

let world: PolicyRunFailureWorld;
let levelTwo: OnCallDutyPolicyEscalationRule;

beforeEach(() => {
  world = new PolicyRunFailureWorld();
  world.install();
  world.useWorkerTick(runTick);

  world.addLevel({ order: 1, users: [ANA], escalateAfterInMinutes: 10 });
  levelTwo = world.addLevel({
    order: 2,
    users: [BOB, CARL],
    escalateAfterInMinutes: 10,
  });
  world.addLevel({ order: 3, users: [DANA], escalateAfterInMinutes: 10 });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function pagesSoFar(): Array<string> {
  return world.pagesSince(START);
}

async function minutesPass(minutes: number): Promise<void> {
  for (let minute: number = 0; minute < minutes; minute++) {
    await world.workerTickAfter(1);
  }
}

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

describe("a worker that stops after claiming a move on", () => {
  test("REGRESSION: the claim is given back two minutes on, and the next level is paged then - not a whole rule wait later - once", async () => {
    await world.startRun();
    // The move to Level 2 is claimed at 10; the process stops as it reads Level 2.
    world.crashAt(FailurePoint.ReadNextRule, { when: readsOrder(2) });

    await minutesPass(11);

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

  test("stopped as its next rule was read as it started, before it was recorded: given back the same way", async () => {
    await world.startRun();
    world.crashAt(FailurePoint.ReadStartingRule, {
      when: (args: Array<unknown>): boolean => {
        return (
          String((args[0] as { id?: ObjectID }).id) === levelTwo.id!.toString()
        );
      },
    });

    await minutesPass(12);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 12",
      "Carl Diaz L2 @ 12",
    ]);
  });

  test("stopped once its next rule started, in the middle of the level: the claim is kept, and the level is resumed - nobody paged twice", async () => {
    await world.startRun();
    world.crashAt(FailurePoint.PagePerson, { when: pages(CARL) });

    await minutesPass(12);

    // Level 2 is not started again: Bob was paged at 10, and Carl at 12 by its resume.
    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 10",
      "Carl Diaz L2 @ 12",
    ]);

    await minutesPass(8);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 10",
      "Carl Diaz L2 @ 12",
      "Dana Kim L3 @ 20",
    ]);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
  });

  test("stopped as the policy began again from its first rule: given back, and it begins again two minutes on", async () => {
    world.repeatsAllowed = 1;
    world.rules = world.rules.filter((rule: OnCallDutyPolicyEscalationRule) => {
      return rule.order === 1;
    });
    await world.startRun();
    world.crashAt(FailurePoint.WriteRepeat);

    await minutesPass(12);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0", "Ana Lopez L1 @ 12"]);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
  });
});

describe("a move on that fails after its claim, its give-back failing too", () => {
  test("is given back by the worker two minutes after its claim, and the next level is paged then, once", async () => {
    await world.startRun();
    world.failAt(FailurePoint.ReadNextRule, { when: readsOrder(2) });
    world.failAt(FailurePoint.GiveBackClaim);

    await minutesPass(11);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0"]);

    await minutesPass(1);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 12",
      "Carl Diaz L2 @ 12",
    ]);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
  });

  test("a give-back the worker's try fails as well is made at the run's next try", async () => {
    await world.startRun();
    world.failAt(FailurePoint.ReadNextRule, { when: readsOrder(2) });
    // The move's own give-back at 10, and the worker's at 12.
    world.failAt(FailurePoint.GiveBackClaim, { times: 2 });

    await minutesPass(12);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0"]);

    // The failed try at 12 is tried again a minute later.
    await minutesPass(1);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 13",
      "Carl Diaz L2 @ 13",
    ]);
  });
});

describe("a move on that finished", () => {
  test("leaves nothing in flight: a normal run pages each level once, on time", async () => {
    await world.startRun();
    await minutesPass(21);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 10",
      "Carl Diaz L2 @ 10",
      "Dana Kim L3 @ 20",
    ]);
    expect(
      Array.from(world.cache.keys()).filter((key: string) => {
        return key.startsWith("on-call-move-ons-in-flight");
      }),
    ).toEqual([]);
  });
});

describe("a Redis that is down", () => {
  test("keeps no move on in flight: the run waits its rule's wait again, as before, and pages nobody twice", async () => {
    await world.startRun();
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValue(new Error("Cache is not connected") as never);
    jest
      .spyOn(GlobalCache, "getStrings")
      .mockRejectedValue(new Error("Cache is not connected") as never);
    world.crashAt(FailurePoint.ReadNextRule, { when: readsOrder(2) });

    await minutesPass(19);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0"]);

    await minutesPass(1);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 20",
      "Carl Diaz L2 @ 20",
    ]);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
  });
});
