import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import ProjectMilestoneService from "Common/Server/Services/ProjectMilestoneService";
import OnCallLevelsInFlight, {
  OnCallLevelInFlight,
} from "Common/Server/Utils/OnCall/OnCallLevelsInFlight";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  ANA,
  BOB,
  CARL,
  DANA,
  NAMES,
  PageEvent,
  START,
} from "Common/Tests/Server/Utils/OnCall/PassOnWorld";
import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions";
import PolicyRunFailureWorld, { FailurePoint } from "./PolicyRunFailureWorld";
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
 * A LEVEL DELETED WHILE THE WORKER PAGES THROUGH ITS POLICY (issue #9036).
 *
 * Deleting an escalation rule deleted every run that last reached it (ON
 * DELETE CASCADE): a run paging on Level 2 vanished, and the worker never
 * paged Level 3. The run stays now, the rule cleared from it (ON DELETE SET
 * NULL) and its place kept. The worker, minute by minute:
 *
 *   - waits out the wait the deleted level started, then pages the level
 *     that moved up into its place - nobody early, and the run never just
 *     stops;
 *   - does not resume a deleted level whose paging stopped part way: the
 *     people it did not get to are on no level of the policy now;
 *   - does not start again a page again whose rule was recorded and then
 *     deleted: that would page its people twice.
 *
 * Driven through the tick the worker registers with RunCron, the real rule
 * start and OnCallEscalationAdvance, over PolicyRunFailureWorld, whose
 * deleteRule does what the database and the rule's delete do.
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
let levelThree: OnCallDutyPolicyEscalationRule;

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
  levelThree = world.addLevel({
    order: 3,
    users: [DANA],
    escalateAfterInMinutes: 10,
  });

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

// Everybody paged, by name and minute since the start: "Bob Smith @ 10".
function pagesSoFar(): Array<string> {
  return world.pages.map((page: PageEvent): string => {
    return `${NAMES[page.userId] || page.userId} @ ${Math.round(
      (page.at.getTime() - START.getTime()) / 60000,
    )}`;
  });
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

describe("the level a run is paging on is deleted", () => {
  test("REGRESSION: the run keeps paging - the level after it is paged when the deleted level's wait is over", async () => {
    await world.startRun();
    await minutesPass(10);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez @ 0",
      "Bob Smith @ 10",
      "Carl Diaz @ 10",
    ]);

    world.deleteRule(levelTwo);

    // Nobody early: the deleted level's wait runs from when it started.
    await minutesPass(9);

    expect(pagesSoFar()).toHaveLength(3);

    await minutesPass(1);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez @ 0",
      "Bob Smith @ 10",
      "Carl Diaz @ 10",
      "Dana Kim @ 20",
    ]);
    expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);
    expect(run().lastExecutedEscalationRuleId?.toString()).toBe(
      levelThree.id!.toString(),
    );
    expect(world.keptFailures()).toBeNull();
  });

  test("the last level deleted: the run ends once its wait is over, saying it went through every level", async () => {
    await world.startRun();
    await minutesPass(20);

    expect(pagesSoFar()).toContain("Dana Kim @ 20");

    world.deleteRule(levelThree);

    await minutesPass(10);

    expect(run().status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(pagesSoFar()).toHaveLength(4);
  });
});

describe("a deleted level whose paging stopped part way", () => {
  test("is not resumed: the people it did not get to are on no level now, and the run goes on after its wait", async () => {
    await world.startRun();
    world.failAt(FailurePoint.PagePerson, { when: pages(CARL) });

    await minutesPass(10);

    expect(pagesSoFar()).toEqual(["Ana Lopez @ 0", "Bob Smith @ 10"]);

    world.deleteRule(levelTwo);

    await minutesPass(1);

    // Carl is not paged for a level that is gone.
    expect(pagesSoFar()).toEqual(["Ana Lopez @ 0", "Bob Smith @ 10"]);
    expect(
      (await OnCallLevelsInFlight.read([run().id!])).has(run().id!.toString()),
    ).toBe(false);

    await minutesPass(9);

    expect(pagesSoFar()).toEqual([
      "Ana Lopez @ 0",
      "Bob Smith @ 10",
      "Dana Kim @ 20",
    ]);
    expect(run().status).toBe(OnCallDutyPolicyStatus.Executing);
  });
});

describe("a page again whose rule was recorded, and deleted since", () => {
  test("is not started again from its start: it goes on from its place, and pages nobody twice", async () => {
    const pageAgainStart: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.startHandedOverPageAgain
    > = jest.spyOn(
      OnCallDutyPolicyExecutionLogService,
      "startHandedOverPageAgain",
    );

    /*
     * A page again that recorded Level 2 as it started - and stopped before
     * its start's place in flight became its level's - whose Level 2 was
     * then deleted: the rule cleared, the place kept.
     */
    const pageAgain: OnCallDutyPolicyExecutionLog = world.newRun();
    pageAgain.status = OnCallDutyPolicyStatus.Executing;
    pageAgain.pageAgainNumber = 1;
    pageAgain.lastExecutedEscalationRuleOrder = 2;
    pageAgain.lastEscalationRuleExecutedAt = new Date(world.clock);
    pageAgain.executeNextEscalationRuleInMinutes = 10;

    const start: OnCallLevelInFlight = {
      ruleId: levelTwo.id!.toString(),
      startedAt: new Date(world.clock),
      heartbeatAt: new Date(world.clock),
      stopped: true,
      pageAgain: {
        startAtRuleId: levelTwo.id!.toString(),
        acknowledgedByUserId: ANA.toString(),
        minutes: 30,
      },
    };

    await OnCallLevelsInFlight.keep(pageAgain.id!, start);
    world.deleteRule(levelTwo);

    await minutesPass(1);

    expect(pageAgainStart).not.toHaveBeenCalled();
    expect(pagesSoFar()).toEqual([]);

    await minutesPass(9);

    // Its place, 2, is Level 3's now: Dana, once.
    expect(pagesSoFar()).toEqual(["Dana Kim @ 10"]);
    expect(pageAgainStart).not.toHaveBeenCalled();
  });
});
