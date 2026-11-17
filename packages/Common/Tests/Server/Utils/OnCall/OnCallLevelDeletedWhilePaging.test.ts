import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import {
  OnCallEscalationAdvanceKind,
  OnCallEscalationAdvanceResult,
} from "../../../../Server/Utils/OnCall/OnCallEscalationAdvance";
import { ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE } from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  OnCallPassOnAnswer,
  OnCallPassOnOutcome,
} from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import UserNotificationExecutionStatus from "../../../../Types/UserNotification/UserNotificationExecutionStatus";
import PassOnWorld, { ANA, BOB, CARL, DANA } from "./PassOnWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A LEVEL DELETED WHILE THE POLICY PAGES ON IT (issue #9036), END TO END.
 *
 * Deleting an escalation rule used to delete every run that last reached it
 * (ON DELETE CASCADE): a run paging on Level 2 vanished mid-incident, with
 * its timeline and everybody's pages, and nobody paged Level 3. Now the
 * database keeps them and clears the rule from them (ON DELETE SET NULL).
 * These run the real paging code - the rules paging, the worker moving the
 * run on, a person passing the page on - in the in-memory world
 * (PassOnWorld), whose deleteRule does what the database and the rule's
 * delete do, and read what the policy did:
 *
 *   - the run keeps paging: it waits out the wait the deleted level
 *     started, then pages the level after it - nobody early, nobody
 *     dropped;
 *   - the people the deleted level paged keep their pages, and can still
 *     acknowledge or pass them on - which moves the run on at once;
 *   - its lines say which level they were, as they were written;
 *   - a level deleted before the run's own skips nothing.
 *
 * The policy, Payments, waits 30 minutes on each level.
 */

let world: PassOnWorld;

beforeEach(() => {
  world = new PassOnWorld();
  world.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the level the run is on is deleted", () => {
  let level1: OnCallDutyPolicyEscalationRule;
  let level2: OnCallDutyPolicyEscalationRule;
  let level3: OnCallDutyPolicyEscalationRule;

  beforeEach(async () => {
    level1 = world.addRule({ order: 1, users: [ANA] });
    level2 = world.addRule({ order: 2, name: "Database", users: [BOB] });
    level3 = world.addRule({ order: 3, users: [CARL] });
    await world.startRun();

    // Level 1's wait runs out: Level 2 pages Bob.
    await world.tick(30);
    expect(world.pagedBy(level2)).toEqual(["Bob Smith"]);

    world.deleteRule(level2);
  });

  test("the run, its lines and Bob's page are all still there, the rule cleared from them", () => {
    expect(world.runs).toHaveLength(1);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Executing);
    expect(world.run.lastExecutedEscalationRuleId).toBeUndefined();
    // Its place stays: where it goes on from.
    expect(world.run.lastExecutedEscalationRuleOrder).toBe(2);

    const bobsPages: Array<UserOnCallLog> = world.logsOf(BOB);
    expect(bobsPages).toHaveLength(1);
    expect(bobsPages[0]!.status).toBe(
      UserNotificationExecutionStatus.Executing,
    );
    expect(bobsPages[0]!.onCallDutyPolicyEscalationRuleId).toBeUndefined();
  });

  test("its lines say which level they were, as they were written", () => {
    const bobsLines: Array<OnCallDutyPolicyExecutionLogTimeline> =
      world.steps.filter((step: OnCallDutyPolicyExecutionLogTimeline) => {
        return step.alertSentToUserId?.toString() === BOB.toString();
      });

    expect(bobsLines.length).toBeGreaterThan(0);

    for (const line of bobsLines) {
      expect(line.onCallDutyPolicyEscalationRuleId).toBeUndefined();
      expect(line.escalationRuleOrder).toBe(2);
      expect(line.escalationRuleName).toBe("Database");
    }

    // A level still there names its rule, and recorded the same.
    const anasLines: Array<OnCallDutyPolicyExecutionLogTimeline> =
      world.steps.filter((step: OnCallDutyPolicyExecutionLogTimeline) => {
        return step.alertSentToUserId?.toString() === ANA.toString();
      });

    expect(anasLines[0]!.onCallDutyPolicyEscalationRuleId?.toString()).toBe(
      level1.id!.toString(),
    );
    expect(anasLines[0]!.escalationRuleOrder).toBe(1);
    expect(anasLines[0]!.escalationRuleName).toBe("Level 1");
  });

  test("the run waits out the wait the deleted level started: nobody is paged early", async () => {
    expect(await world.tick(29)).toBeNull();
    expect(world.pagedBy(level3)).toEqual([]);
  });

  test("then pages the level that moved up into its place - Carl - and never stops on its own", async () => {
    // Level 3 moved up to Level 2's place.
    expect(level3.order).toBe(2);

    await world.tick(29);
    const moved: OnCallEscalationAdvanceResult | null = await world.tick(1);

    expect(moved?.kind).toBe(OnCallEscalationAdvanceKind.RuleStarted);
    expect(moved?.rule).toMatchObject({ order: 2, name: "Level 3" });
    expect(world.pagedBy(level3)).toEqual(["Carl Diaz"]);
    expect(world.run.lastExecutedEscalationRuleId?.toString()).toBe(
      level3.id!.toString(),
    );
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Executing);
  });

  test("Bob, paged by the deleted level, can still pass the page on: the run moves on at once", async () => {
    const preview: OnCallPassOnAnswer = await world.preview(BOB);

    expect(preview.result?.outcome).toBe(OnCallPassOnOutcome.NextRulePaged);
    expect(preview.result?.rule).toMatchObject({ order: 2, name: "Level 3" });

    const answer: OnCallPassOnAnswer = await world.passOn(BOB);

    expect(answer.passedOn).toBe(true);
    expect(answer.result?.outcome).toBe(OnCallPassOnOutcome.NextRulePaged);
    expect(world.pagedBy(level3)).toEqual(["Carl Diaz"]);
    // Straight away: not after the deleted level's wait.
    expect(world.clock.getTime()).toBe(world.pages[2]!.at.getTime());
  });
});

describe("a level deleted while the run pages on a later one", () => {
  test("skips nothing: the level after the run's own is paged when its wait is over", async () => {
    const level1: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 1,
      users: [ANA],
    });
    world.addRule({ order: 2, users: [BOB] });
    const level3: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 3,
      users: [CARL],
    });
    const level4: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 4,
      users: [DANA],
    });
    await world.startRun();
    await world.tick(30);
    await world.tick(30);
    expect(world.pagedBy(level3)).toEqual(["Carl Diaz"]);

    // Level 1 goes: Level 3 is now at place 2, Level 4 at place 3.
    world.deleteRule(level1);

    await world.tick(30);

    // It used to look for place 4 - nothing there - and end, Dana unpaged.
    expect(world.pagedBy(level4)).toEqual(["Dana Kim"]);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Executing);
  });
});

describe("the last level is deleted while the run pages on it", () => {
  test("with no repeat left, the run ends once its wait is over - as one that went through every level, never silently", async () => {
    world.addRule({ order: 1, users: [ANA] });
    const level2: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 2,
      users: [BOB],
    });
    await world.startRun();
    await world.tick(30);
    world.deleteRule(level2);

    expect(await world.tick(29)).toBeNull();

    const ended: OnCallEscalationAdvanceResult | null = await world.tick(1);

    expect(ended?.kind).toBe(OnCallEscalationAdvanceKind.Ended);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(world.run.statusMessage).toBe(
      ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
    );
  });

  test("with a repeat left, the policy starts again from its first level", async () => {
    world.repeatsAllowed = 1;
    const level1: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 1,
      users: [ANA],
    });
    const level2: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 2,
      users: [BOB],
    });
    await world.startRun();
    await world.tick(30);
    world.deleteRule(level2);

    const again: OnCallEscalationAdvanceResult | null = await world.tick(30);

    expect(again?.kind).toBe(OnCallEscalationAdvanceKind.PolicyStartedAgain);
    expect(world.pagedBy(level1)).toEqual(["Ana Lopez", "Ana Lopez"]);
  });
});
