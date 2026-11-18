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
  ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
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

  test("then pages the first level after its place - Carl - and never stops on its own", async () => {
    // The levels after it keep their numbers: a gap at 2 (issue #9573).
    expect(level3.order).toBe(3);

    await world.tick(29);
    const moved: OnCallEscalationAdvanceResult | null = await world.tick(1);

    expect(moved?.kind).toBe(OnCallEscalationAdvanceKind.RuleStarted);
    expect(moved?.rule).toMatchObject({ order: 3, name: "Level 3" });
    expect(world.pagedBy(level3)).toEqual(["Carl Diaz"]);
    expect(world.run.lastExecutedEscalationRuleId?.toString()).toBe(
      level3.id!.toString(),
    );
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Executing);
  });

  test("Bob, paged by the deleted level, can still pass the page on: the run moves on at once", async () => {
    const preview: OnCallPassOnAnswer = await world.preview(BOB);

    expect(preview.result?.outcome).toBe(OnCallPassOnOutcome.NextRulePaged);
    expect(preview.result?.rule).toMatchObject({ order: 3, name: "Level 3" });

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

    // Level 1 goes: a gap at place 1, Level 3 and Level 4 keep theirs.
    world.deleteRule(level1);

    await world.tick(30);

    expect(world.pagedBy(level4)).toEqual(["Dana Kim"]);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Executing);
  });

  /*
   * A policy written before deletes left gaps renumbered the levels after a
   * deleted one: Level 3 at place 2, Level 4 at place 3, with the run still
   * recording place 3. The run is placed by its level, never by a number,
   * so it went on to Dana then too.
   */
  test("skips nothing when the levels after the deleted one were renumbered under it", async () => {
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

    world.deleteRule(level1);

    for (const later of world.rules) {
      later.order = later.order! - 1;
    }

    await world.tick(30);

    // It used to look for place 4 - nothing there - and end, Dana unpaged.
    expect(world.pagedBy(level4)).toEqual(["Dana Kim"]);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Executing);
  });
});

/*
 * TWO LEVELS AT ONE PLACE (issue #9573): a policy whose levels Terraform
 * numbers one write each, caught between two writes, or a configuration
 * that gives two levels one number. The levels come in the order of their
 * ids, as they are read: the second of the two is paged after the first,
 * never skipped.
 */
describe("two levels at one place", () => {
  test("both are paged, the first by id first, then the level after them", async () => {
    world.addRule({ order: 1, users: [ANA] });
    // Bob's rule is made first, so its id is the lower: it comes first.
    const twinFirst: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 2,
      users: [BOB],
    });
    const twinSecond: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 2,
      users: [CARL],
    });
    const after: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 5,
      users: [DANA],
    });
    await world.startRun();

    await world.tick(30);
    expect(world.pagedBy(twinFirst)).toEqual(["Bob Smith"]);

    // By place alone, the run looked past place 2 and went to Dana.
    await world.tick(30);
    expect(world.pagedBy(twinSecond)).toEqual(["Carl Diaz"]);
    expect(world.pagedBy(after)).toEqual([]);

    await world.tick(30);
    expect(world.pagedBy(after)).toEqual(["Dana Kim"]);
    expect(world.pagedNames()).toEqual([
      "Ana Lopez",
      "Bob Smith",
      "Carl Diaz",
      "Dana Kim",
    ]);
  });

  test("escalating to the second of them skips the first, with a line for it", async () => {
    world.addRule({ order: 1, users: [ANA] });
    world.addRule({ order: 2, users: [BOB] });
    const twinSecond: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 2,
      users: [CARL],
    });
    world.addRule({ order: 3, users: [DANA] });
    await world.startRun();

    await world.passOn(ANA, undefined, twinSecond.id!);

    expect(world.levelLines()).toEqual([
      {
        order: 2,
        message: ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
      },
    ]);
    expect(world.pagedNames()).toEqual(["Ana Lopez", "Carl Diaz"]);
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
