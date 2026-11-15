import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import ProjectMilestoneService from "Common/Server/Services/ProjectMilestoneService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import OnCallSendLag from "Common/Server/Utils/OnCall/OnCallSendLag";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  ANA,
  BOB,
  CARL,
  DANA,
  PageEvent,
  START,
} from "Common/Tests/Server/Utils/OnCall/PassOnWorld";

type AnyFunction = (...args: Array<any>) => any;
import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions";
import PolicyRunFailureWorld, {
  FailurePoint,
  connectionReset,
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
 * A LEVEL WHOSE PAGING STOPS PART WAY PAGES THE REST OF ITS PEOPLE
 * (issue #8406).
 *
 * An escalation rule is recorded on its run, then pages each person it
 * names in turn. A database error in the middle - paging the second of
 * three people, say - or a worker that stopped there left the rest of the
 * level unpaged for good: the rule was recorded, so trying the step again
 * could not start the level again without paging its first person twice,
 * and the run waited out the level's wait and moved on.
 *
 * Now the level is kept in flight while it pages, and the worker resumes
 * one that never finished - at the run's next try after a failure, or two
 * minutes after its last sign of life when its process stopped: the people
 * it did not get to are paged, once, and nobody it paged is paged again,
 * nor any line it wrote written twice. The level's wait still runs from
 * when it started.
 *
 * Driven through the tick the worker registers with RunCron, the real
 * rule start and resume (startRuleExecution, resumeRuleExecution) and
 * OnCallEscalationAdvance, over PolicyRunFailureWorld.
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

  world.addLevel({
    order: 1,
    users: [ANA],
    escalateAfterInMinutes: 10,
  });
  // Dana is away with nobody to cover: the level says so, and pages Bob and Carl.
  levelTwo = world.addLevel({
    order: 2,
    users: [DANA, BOB, CARL],
    escalateAfterInMinutes: 10,
  });
  world.addLevel({
    order: 3,
    users: [ANA],
    escalateAfterInMinutes: 10,
  });
  world.away[DANA.toString()] = new Date(START.getTime() + 24 * 60 * 60000);

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

async function minutesPass(minutes: number): Promise<void> {
  for (let minute: number = 0; minute < minutes; minute++) {
    await world.workerTickAfter(1);
  }
}

function pages(userId: ObjectID): (args: Array<unknown>) => boolean {
  return (args: Array<unknown>): boolean => {
    return String(args[0]).toLowerCase() === userId.toString().toLowerCase();
  };
}

// The lines of a level about a person, by what they say.
function linesOf(
  rule: OnCallDutyPolicyEscalationRule,
  userId: ObjectID,
): Array<string> {
  return world.steps
    .filter((line: OnCallDutyPolicyExecutionLogTimeline) => {
      return (
        line.onCallDutyPolicyEscalationRuleId?.toString() ===
          rule.id!.toString() &&
        line.alertSentToUserId?.toString().toLowerCase() ===
          userId.toString().toLowerCase()
      );
    })
    .map((line: OnCallDutyPolicyExecutionLogTimeline): string => {
      return String(line.status);
    });
}

describe("a level whose paging fails part way", () => {
  test("REGRESSION: the people it did not get to are paged the next minute, once, and the next level comes after its wait", async () => {
    await world.startRun();
    world.failAt(FailurePoint.PagePerson, { when: pages(CARL) });

    await minutesPass(10);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0", "Bob Smith L2 @ 10"]);

    await minutesPass(1);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 10",
      "Carl Diaz L2 @ 11",
    ]);

    await minutesPass(9);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 10",
      "Carl Diaz L2 @ 11",
      "Ana Lopez L3 @ 20",
    ]);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
    expect(world.keptFailures()).toBeNull();
  });

  test("failing at its first person, everybody it names is paged the next minute, once each", async () => {
    await world.startRun();
    world.failAt(FailurePoint.PagePerson, { when: pages(BOB) });

    await minutesPass(11);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 11",
      "Carl Diaz L2 @ 11",
    ]);
  });

  test("no line is written twice: the away person's once, and the line written for the person whose page failed is theirs", async () => {
    await world.startRun();
    world.failAt(FailurePoint.PagePerson, { when: pages(CARL) });

    await minutesPass(12);

    expect(linesOf(levelTwo, DANA)).toHaveLength(1);
    expect(linesOf(levelTwo, BOB)).toHaveLength(1);
    expect(linesOf(levelTwo, CARL)).toHaveLength(1);
    expect(world.timesPaged(CARL, levelTwo)).toBe(1);
  });

  test("a resume that fails too is tried again, waiting longer, and pages the rest once it goes through", async () => {
    await world.startRun();
    world.failAt(FailurePoint.PagePerson, { when: pages(CARL), times: 2 });

    await minutesPass(10);
    // Fails at 10, and again at 11: the third try is two minutes on.
    await minutesPass(3);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 10",
      "Carl Diaz L2 @ 13",
    ]);
    expect(world.timesPaged(BOB, levelTwo)).toBe(1);
  });

  test("a level whose paging keeps failing ends the run in Error after its tries, having paged who it could, once each", async () => {
    await world.startRun();
    world.failAt(FailurePoint.PagePerson, {
      when: pages(CARL),
      times: Number.MAX_SAFE_INTEGER,
      error: connectionReset,
    });

    await minutesPass(60);

    expect(run().status).toBe(OnCallDutyPolicyStatus.Error);
    expect(run().statusMessage).toContain("every try failed");
    expect(world.timesPaged(BOB, levelTwo)).toBe(1);
    expect(world.timesPaged(CARL, levelTwo)).toBe(0);
  });

  test("an incident acknowledged before the next try is not paged about: the run ends, and the rest of the level is not paged", async () => {
    await world.startRun();
    world.failAt(FailurePoint.PagePerson, { when: pages(CARL) });

    await minutesPass(10);
    world.isRecordAcknowledged = true;
    await minutesPass(1);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0", "Bob Smith L2 @ 10"]);
    expect(run().status).toBe(OnCallDutyPolicyStatus.Completed);
  });

  test("a Redis that is down keeps no level in flight: the rest of the level is lost as before, and the run goes on", async () => {
    await world.startRun();
    world.failAt(FailurePoint.PagePerson, { when: pages(CARL) });

    // Redis is down from Level 2's start on.
    await minutesPass(9);
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValue(new Error("Cache is not connected") as never);
    jest
      .spyOn(GlobalCache, "getStrings")
      .mockRejectedValue(new Error("Cache is not connected") as never);

    await minutesPass(11);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 10",
      "Ana Lopez L3 @ 20",
    ]);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
  });
});

describe("a worker that stops in the middle of a level", () => {
  test("REGRESSION: the level is resumed two minutes after its last sign of life, and the rest of it is paged once", async () => {
    await world.startRun();
    world.crashAt(FailurePoint.PagePerson, { when: pages(CARL) });

    await minutesPass(11);

    // A minute on, it may still be paging somewhere: left to it.
    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0", "Bob Smith L2 @ 10"]);

    await minutesPass(1);

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
      "Ana Lopez L3 @ 20",
    ]);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
  });

  test("one that stops again as the level is resumed is resumed once more, and still pages nobody twice", async () => {
    await world.startRun();
    // The level stops at Carl as it pages at 10, and its resume at 12 stops at Carl too.
    world.crashAt(FailurePoint.PagePerson, { when: pages(CARL) });
    world.crashAt(FailurePoint.PagePerson, { when: pages(CARL) });

    await minutesPass(12);

    expect(pagesSoFar()).toEqual(["Ana Lopez L1 @ 0", "Bob Smith L2 @ 10"]);

    // Two minutes after the resume's own sign of life.
    await minutesPass(2);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 10",
      "Carl Diaz L2 @ 14",
    ]);
    expect(world.timesPaged(BOB, levelTwo)).toBe(1);
    expect(world.timesPaged(CARL, levelTwo)).toBe(1);
    expect(linesOf(levelTwo, CARL)).toHaveLength(1);
  });
});

describe("a run whose first level fails part way as it starts", () => {
  test("REGRESSION: handed to its escalation, the rest of its first level is paged the next minute, once", async () => {
    world.rules = [levelTwo];
    levelTwo.order = 1;
    world.failAt(FailurePoint.PagePerson, { when: pages(CARL) });

    const created: OnCallDutyPolicyExecutionLog = world.newRun();

    await (
      OnCallDutyPolicyExecutionLogService as unknown as {
        onCreateSuccess: (
          onCreate: unknown,
          item: OnCallDutyPolicyExecutionLog,
        ) => Promise<unknown>;
      }
    ).onCreateSuccess({ carryForward: null }, created);

    expect(pagesSoFar()).toEqual(["Bob Smith L1 @ 0"]);
    expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);

    await minutesPass(1);

    expect(pagesSoFar()).toEqual(["Bob Smith L1 @ 0", "Carl Diaz L1 @ 1"]);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
  });
});

/*
 * A RESUMED LEVEL PAGES AS ITS START DID (issue #8471): a page again's
 * acknowledger, whom its level pages before its own people, is paged first
 * by the resume too; and the resume's pages are timed as the level's were
 * as it started - due when the wait before it ran out, or as its page
 * started - so a page it sends late shows as late (notification.send.lag).
 */
describe("a resumed level, as its start paged it", () => {
  test("REGRESSION: a page again's acknowledger, paged first, is paged by the resume when the level stopped before them", async () => {
    // Ana acknowledged, and is paged first by the page again at Level 2: her page fails.
    world.failAt(FailurePoint.PagePerson, { when: pages(ANA) });

    await world.startPageAgain({ startAtRule: levelTwo, acknowledgedBy: ANA });

    expect(pagesSoFar()).toEqual([]);

    await minutesPass(1);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L2 @ 1",
      "Bob Smith L2 @ 1",
      "Carl Diaz L2 @ 1",
    ]);
    expect(world.hasAnybodyBeenPagedTwiceByARuleInAPass()).toBe(false);
  });

  test("the acknowledger paged before the level stopped is not paged again", async () => {
    world.failAt(FailurePoint.PagePerson, { when: pages(CARL) });

    await world.startPageAgain({ startAtRule: levelTwo, acknowledgedBy: ANA });
    await minutesPass(1);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L2 @ 0",
      "Bob Smith L2 @ 0",
      "Carl Diaz L2 @ 1",
    ]);
    expect(world.timesPaged(ANA, levelTwo)).toBe(1);
  });

  test("REGRESSION: a first level resumed is timed from its page's start, as its first pass was", async () => {
    world.rules = [levelTwo];
    levelTwo.order = 1;
    world.failAt(FailurePoint.PagePerson, { when: pages(CARL) });

    await (
      OnCallDutyPolicyExecutionLogService as unknown as {
        onCreateSuccess: (
          onCreate: unknown,
          item: OnCallDutyPolicyExecutionLog,
        ) => Promise<unknown>;
      }
    ).onCreateSuccess({ carryForward: null }, world.newRun());

    await minutesPass(1);

    const bob: PageEvent = world.pages.find((page: PageEvent) => {
      return page.userId.toLowerCase() === BOB.toString().toLowerCase();
    })!;
    const carl: PageEvent = world.pages.find((page: PageEvent) => {
      return page.userId.toLowerCase() === CARL.toString().toLowerCase();
    })!;

    // Carl is paged a minute late, and his page says it was due as Bob's was.
    expect(carl.at.getTime() - bob.at.getTime()).toBe(60 * 1000);
    expect(bob.pageStart).not.toBeNull();
    expect(carl.pageStart).toEqual(bob.pageStart);
  });

  test("REGRESSION: a later level resumed is timed from when the wait before it ran out, as its first pass was", async () => {
    // What each page's send was due at, as the scheduled send it ran in says.
    const dueAt: Map<string, number | null> = new Map();
    const paging: AnyFunction = (
      UserNotificationRuleService.startUserNotificationRulesExecution as unknown as {
        getMockImplementation: () => AnyFunction;
      }
    ).getMockImplementation();

    jest
      .spyOn(UserNotificationRuleService, "startUserNotificationRulesExecution")
      .mockImplementation((async (...args: Array<unknown>) => {
        dueAt.set(
          String(args[0]).toLowerCase(),
          OnCallSendLag.getScheduledSend()?.dueAt.getTime() ?? null,
        );
        return await paging(...args);
      }) as never);

    await world.startRun();
    world.failAt(FailurePoint.PagePerson, { when: pages(CARL) });

    await minutesPass(11);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez L1 @ 0",
      "Bob Smith L2 @ 10",
      "Carl Diaz L2 @ 11",
    ]);

    // Level 2 was due as Level 1's wait ran out, at 10: Carl's page, sent at 11, says so.
    const levelTwoDue: number = START.getTime() + 10 * 60 * 1000;

    expect(dueAt.get(BOB.toString().toLowerCase())).toBe(levelTwoDue);
    expect(dueAt.get(CARL.toString().toLowerCase())).toBe(levelTwoDue);
  });
});
