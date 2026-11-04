import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import OnCallDutyPolicyEscalationRuleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallEscalationAdvance from "../../../../Server/Utils/OnCall/OnCallEscalationAdvance";
import OnCallPagePassOn from "../../../../Server/Utils/OnCall/OnCallPagePassOn";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE } from "../../../../Types/OnCallDutyPolicy/OnCallEmptyLevel";
import {
  ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
  OnCallOpenPage,
  OnCallPageRecordType,
  OnCallPassOnAnswer,
  OnCallPassOnLevelChoice,
  OnCallPassOnOutcome,
  OnCallPassOnRefusal,
  getOnCallPassOnSentence,
  hasOnCallPassOnLevelChoice,
} from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import UserNotificationExecutionStatus from "../../../../Types/UserNotification/UserNotificationExecutionStatus";
import PassOnWorld, {
  ANA,
  BOB,
  CARL,
  DANA,
  INCIDENT_ID,
  PROJECT_ID,
  RUN_ID,
  START,
  nextId,
} from "./PassOnWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ESCALATING TO A LEVEL THE PERSON PICKS, NOT ONLY THE NEXT - THE ENGINE,
 * END TO END.
 *
 * Somebody who cannot take a page escalates it, and the policy pages its
 * next level at once (#4914). With two or more levels after theirs, they can
 * pick a later one instead: the next level is on leave too, or the page
 * needs the database team two levels up. These run the real paging code in
 * the in-memory world (PassOnWorld) and read what the policy did: which
 * level it paged and when, what it wrote for the levels it skipped, and how
 * the run goes on from there.
 *
 * The policy, Payments, waits 30 minutes on each level. It is 03:00 UTC.
 */

let world: PassOnWorld;

beforeEach(() => {
  world = new PassOnWorld();
  world.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The ids of the levels a preview offers, as their orders.
function offeredOrders(answer: OnCallPassOnAnswer): Array<number> {
  return (answer.result?.levelChoices || []).map(
    (choice: OnCallPassOnLevelChoice) => {
      return choice.order;
    },
  );
}

describe("the levels a preview offers", () => {
  test("every level after the person's, the next one first - each by its escalation rule", async () => {
    world.addRule({ order: 1, users: [ANA] });
    const level2: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 2,
      name: "Platform leads",
      users: [BOB],
    });
    const level3: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 3,
      name: "DBA leads",
      users: [CARL],
    });
    await world.startRun();

    const preview: OnCallPassOnAnswer = await world.preview(ANA);

    expect(preview.result!.outcome).toBe(OnCallPassOnOutcome.NextRulePaged);
    expect(preview.result!.levelChoices).toEqual([
      {
        escalationRuleId: level2.id!.toString(),
        order: 2,
        name: "Platform leads",
      },
      {
        escalationRuleId: level3.id!.toString(),
        order: 3,
        name: "DBA leads",
      },
    ]);
    expect(hasOnCallPassOnLevelChoice(preview.result)).toBe(true);

    // What escalating pages unless another level is picked: the next one.
    expect(preview.result!.rule).toEqual({ order: 2, name: "Platform leads" });
  });

  test("one level after theirs is offered, but there is nothing to pick", async () => {
    world.addRule({ order: 1, users: [ANA] });
    world.addRule({ order: 2, users: [BOB] });
    await world.startRun();

    const preview: OnCallPassOnAnswer = await world.preview(ANA);

    expect(offeredOrders(preview)).toEqual([2]);
    expect(hasOnCallPassOnLevelChoice(preview.result)).toBe(false);
  });

  test("a person on Level 2 is offered only the levels after it", async () => {
    world.addRule({ order: 1, users: [ANA] });
    world.addRule({ order: 2, users: [BOB] });
    world.addRule({ order: 3, users: [CARL] });
    world.addRule({ order: 4, users: [DANA] });
    await world.startRun();
    await world.tick(30);

    expect(world.currentOrder()).toBe(2);
    expect(offeredOrders(await world.preview(BOB))).toEqual([3, 4]);
  });

  test("none while somebody else on the level is still paged: escalating pages no level now", async () => {
    world.addRule({ order: 1, users: [ANA, CARL] });
    world.addRule({ order: 2, users: [BOB] });
    world.addRule({ order: 3, users: [DANA] });
    await world.startRun();

    const preview: OnCallPassOnAnswer = await world.preview(ANA);

    expect(preview.result!.outcome).toBe(OnCallPassOnOutcome.OthersStillPaged);
    expect(preview.result!.levelChoices).toBeUndefined();
  });

  test("none on the last level: the policy starts over or stops", async () => {
    world.repeatsAllowed = 1;
    world.addRule({ order: 1, users: [ANA] });
    await world.startRun();

    expect((await world.preview(ANA)).result!.levelChoices).toBeUndefined();
  });

  test("a person's open pages about the record carry them too (the Dashboard's dialog)", async () => {
    world.addRule({ order: 1, users: [ANA] });
    world.addRule({ order: 2, users: [BOB] });
    world.addRule({ order: 3, users: [CARL] });
    await world.startRun();

    const pages: Array<OnCallOpenPage> =
      await OnCallPagePassOn.getOpenPagesForRecord({
        userId: ANA,
        projectId: PROJECT_ID,
        recordType: OnCallPageRecordType.Incident,
        recordId: INCIDENT_ID,
      });

    expect(
      (pages[0]!.preview.levelChoices || []).map(
        (choice: OnCallPassOnLevelChoice) => {
          return choice.order;
        },
      ),
    ).toEqual([2, 3]);
  });
});

describe("picking a later level", () => {
  let level1: OnCallDutyPolicyEscalationRule;
  let level2: OnCallDutyPolicyEscalationRule;
  let level3: OnCallDutyPolicyEscalationRule;

  beforeEach(async () => {
    level1 = world.addRule({ order: 1, users: [ANA] });
    level2 = world.addRule({ order: 2, name: "Platform leads", users: [BOB] });
    level3 = world.addRule({ order: 3, name: "DBA leads", users: [CARL] });
    await world.startRun();
  });

  test("pages the level picked at once, and never the one between", async () => {
    const answer: OnCallPassOnAnswer = await world.passOn(
      ANA,
      undefined,
      level3.id!,
    );

    expect(answer.passedOn).toBe(true);
    expect(world.pagedBy(level1)).toEqual(["Ana Lopez"]);
    expect(world.pagedBy(level2)).toEqual([]);
    expect(world.pagedBy(level3)).toEqual(["Carl Diaz"]);
    expect(world.currentOrder()).toBe(3);

    // Carl was paged the moment Ana escalated.
    expect(world.pages[1]!.at.getTime()).toBe(START.getTime());
  });

  test("answers that the level picked is paging now, and who it paged", async () => {
    const answer: OnCallPassOnAnswer = await world.passOn(
      ANA,
      undefined,
      level3.id!,
    );

    expect(answer.result).toMatchObject({
      outcome: OnCallPassOnOutcome.NextRulePaged,
      isPreview: false,
      rule: { order: 3, name: "DBA leads" },
      pagedNames: ["Carl Diaz"],
      ruleCount: 3,
    });
    // What it did, not what it could have: no levels to pick from.
    expect(answer.result!.levelChoices).toBeUndefined();
    expect(getOnCallPassOnSentence(answer.result!)).toBe(
      "The policy is now paging DBA leads (Level 3 of 3): Carl Diaz.",
    );
  });

  test("the level between gets one line on the run's timeline: skipped, the page escalated past it", async () => {
    await world.passOn(ANA, undefined, level3.id!);

    expect(world.levelLines()).toEqual([
      {
        order: 2,
        message: ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
      },
    ]);

    const skipped: Array<OnCallDutyExecutionLogTimelineStatus> = world.steps
      .filter((step: { statusMessage?: string | undefined }) => {
        return (
          step.statusMessage ===
          ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE
        );
      })
      .map((step: { status?: OnCallDutyExecutionLogTimelineStatus }) => {
        return step.status!;
      });

    expect(skipped).toEqual([OnCallDutyExecutionLogTimelineStatus.Skipped]);
  });

  test("the skipped level's line is written before the level picked pages, so the feed reads in order", async () => {
    await world.passOn(ANA, undefined, level3.id!);

    const order: Array<string> = world.steps.map(
      (step: {
        statusMessage?: string | undefined;
        alertSentToUserId?: ObjectID | undefined;
      }) => {
        if (step.alertSentToUserId) {
          return step.alertSentToUserId.toString();
        }

        return step.statusMessage || "";
      },
    );

    expect(order).toEqual([
      ANA.toString(),
      ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
      CARL.toString(),
    ]);
  });

  test("Ana's page is escalated, as it is when she leaves the next level picked", async () => {
    await world.passOn(ANA, undefined, level3.id!);

    expect(
      world.logsOf(ANA).map((log: UserOnCallLog) => {
        return [log.status, log.statusMessage];
      }),
    ).toEqual([
      [
        UserNotificationExecutionStatus.PassedOn,
        ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
      ],
    ]);
  });

  test("the level picked waits its own 30 minutes, then the run goes on from it - not back to the level skipped", async () => {
    const level4: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 4,
      users: [DANA],
    });

    await world.passOn(ANA, undefined, level3.id!);

    expect(await world.tick(29)).toBeNull();
    expect(world.pagedBy(level4)).toEqual([]);

    await world.tick(1);

    expect(world.pagedBy(level4)).toEqual(["Dana Kim"]);
    expect(world.pagedBy(level2)).toEqual([]);
    expect(world.currentOrder()).toBe(4);
  });

  test("after the last level, a repeat goes round again from Level 1: the level skipped is paged this time", async () => {
    world.run.onCallDutyPolicy = {
      name: "Payments",
      repeatPolicyIfNoOneAcknowledges: true,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: 1,
    } as never;

    await world.passOn(ANA, undefined, level3.id!);
    await world.tick(30);

    /*
     * Level 1 names only Ana, who escalated: it is passed at once, and
     * Level 2 - skipped on the first round - pages.
     */
    expect(world.run.onCallPolicyExecutionRepeatCount).toBe(2);
    expect(world.pagedBy(level2)).toEqual(["Bob Smith"]);
    expect(world.currentOrder()).toBe(2);
    // Only the first round's skip: the repeat skipped nothing.
    expect(
      world.levelLines().filter((line: { message: string }) => {
        return (
          line.message === ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE
        );
      }),
    ).toHaveLength(1);
  });

  test("the run moved on once: one claim, won", async () => {
    await world.passOn(ANA, undefined, level3.id!);

    expect(
      world.claims.map((claim: { won: boolean }) => {
        return claim.won;
      }),
    ).toEqual([true]);
  });

  test("picking the next level is escalating as before: nothing is skipped", async () => {
    await world.passOn(ANA, undefined, level2.id!);

    expect(world.pagedBy(level2)).toEqual(["Bob Smith"]);
    expect(world.pagedBy(level3)).toEqual([]);
    expect(world.levelLines()).toEqual([]);
    expect(world.currentOrder()).toBe(2);
  });

  test("picking nothing pages the next level", async () => {
    await world.passOn(ANA);

    expect(world.pagedBy(level2)).toEqual(["Bob Smith"]);
    expect(world.levelLines()).toEqual([]);
  });
});

describe("skipping more than one level", () => {
  test("each level between gets its line, in order", async () => {
    world.addRule({ order: 1, users: [ANA] });
    world.addRule({ order: 2, users: [BOB] });
    world.addRule({ order: 3, users: [CARL] });
    const level4: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 4,
      users: [DANA],
    });
    await world.startRun();

    await world.passOn(ANA, undefined, level4.id!);

    expect(world.levelLines()).toEqual([
      {
        order: 2,
        message: ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
      },
      {
        order: 3,
        message: ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
      },
    ]);
    expect(world.pagedNames()).toEqual(["Ana Lopez", "Dana Kim"]);
    expect(world.currentOrder()).toBe(4);
  });
});

describe("a level picked that pages nobody", () => {
  test("is passed at once like any empty level: the level after it is paged", async () => {
    world.addRule({ order: 1, users: [ANA] });
    world.addRule({ order: 2, users: [BOB] });
    const level3: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 3,
      users: [],
    });
    const level4: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 4,
      users: [DANA],
    });
    await world.startRun();

    const answer: OnCallPassOnAnswer = await world.passOn(
      ANA,
      undefined,
      level3.id!,
    );

    expect(world.pagedBy(level4)).toEqual(["Dana Kim"]);
    expect(world.currentOrder()).toBe(4);
    expect(world.levelLines()).toEqual([
      {
        order: 2,
        message: ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
      },
      { order: 3, message: ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE },
    ]);

    // The answer names the level paging now, the one people were reached at.
    expect(answer.result).toMatchObject({
      outcome: OnCallPassOnOutcome.NextRulePaged,
      rule: { order: 4 },
      pagedNames: ["Dana Kim"],
    });
  });
});

describe("a level picked that is not offered any more", () => {
  let level3: OnCallDutyPolicyEscalationRule;

  beforeEach(async () => {
    world.addRule({ order: 1, users: [ANA] });
    world.addRule({ order: 2, users: [BOB] });
    level3 = world.addRule({ order: 3, users: [CARL] });
    await world.startRun();
  });

  const expectNothingChanged: () => void = (): void => {
    expect(world.pagedNames()).toEqual(["Ana Lopez"]);
    expect(world.currentOrder()).toBe(1);
    expect(world.levelLines()).toEqual([]);
    expect(world.claims).toEqual([]);
    expect(world.logsOf(ANA)[0]!.status).toBe(
      UserNotificationExecutionStatus.Executing,
    );
  };

  test("a level deleted since it was offered is refused, and nothing changes: Ana is still paged", async () => {
    world.rules = world.rules.filter((rule: OnCallDutyPolicyEscalationRule) => {
      return rule !== level3;
    });

    expect(await world.passOn(ANA, undefined, level3.id!)).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.LevelNotAvailable,
    });
    expectNothingChanged();
  });

  test("a level of another policy is refused", async () => {
    const elsewhere: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    elsewhere.id = nextId();
    elsewhere.projectId = PROJECT_ID;
    elsewhere.onCallDutyPolicyId = nextId();
    elsewhere.order = 3;
    world.rules.push(elsewhere);

    expect(await world.passOn(ANA, undefined, elsewhere.id!)).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.LevelNotAvailable,
    });
    expectNothingChanged();
  });

  test("an id that is no level at all is refused", async () => {
    expect(
      await world.passOn(
        ANA,
        undefined,
        new ObjectID("0f500000-0000-4000-8000-0000000000ee"),
      ),
    ).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.LevelNotAvailable,
    });
    expectNothingChanged();
  });

  test("Ana's own level is no level to escalate to", async () => {
    const level1: OnCallDutyPolicyEscalationRule = world.rules.find(
      (rule: OnCallDutyPolicyEscalationRule) => {
        return rule.order === 1;
      },
    )!;

    expect((await world.passOn(ANA, undefined, level1.id!)).refusal).toBe(
      OnCallPassOnRefusal.LevelNotAvailable,
    );
    expectNothingChanged();
  });

  test("once refused, escalating again with the level picked from the levels as they are works", async () => {
    world.rules = world.rules.filter((rule: OnCallDutyPolicyEscalationRule) => {
      return rule !== level3;
    });
    await world.passOn(ANA, undefined, level3.id!);

    expect(offeredOrders(await world.preview(ANA))).toEqual([2]);

    const answer: OnCallPassOnAnswer = await world.passOn(ANA);

    expect(answer.passedOn).toBe(true);
    expect(world.pagedNames()).toEqual(["Ana Lopez", "Bob Smith"]);
  });
});

describe("a level picked when escalating pages no level now", () => {
  test("somebody else on the level is still paged: the run waits for them, as it always did", async () => {
    world.addRule({ order: 1, users: [ANA, DANA] });
    const level2: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 2,
      users: [BOB],
    });
    const level3: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 3,
      users: [CARL],
    });
    await world.startRun();

    const answer: OnCallPassOnAnswer = await world.passOn(
      ANA,
      undefined,
      level3.id!,
    );

    // Not refused: Ana escalated, and the level picked does not apply.
    expect(answer.passedOn).toBe(true);
    expect(answer.result!.outcome).toBe(OnCallPassOnOutcome.OthersStillPaged);
    expect(world.pagedBy(level2)).toEqual([]);
    expect(world.pagedBy(level3)).toEqual([]);
    expect(world.levelLines()).toEqual([]);
    expect(world.logsOf(ANA)[0]!.status).toBe(
      UserNotificationExecutionStatus.PassedOn,
    );
  });

  test("the run moved on past the person already: it goes on as it is", async () => {
    world.addRule({ order: 1, users: [ANA] });
    const level2: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 2,
      users: [BOB],
    });
    const level3: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 3,
      users: [CARL],
    });
    await world.startRun();
    await world.tick(30);

    const answer: OnCallPassOnAnswer = await world.passOn(
      ANA,
      undefined,
      level3.id!,
    );

    expect(answer.result!.outcome).toBe(OnCallPassOnOutcome.AlreadyEscalated);
    expect(world.pagedBy(level2)).toEqual(["Bob Smith"]);
    expect(world.pagedBy(level3)).toEqual([]);
    expect(world.currentOrder()).toBe(2);
  });
});

describe("the worker's tick in the same moment", () => {
  test("a pass to a picked level and the tick move the run on once", async () => {
    world.addRule({ order: 1, users: [ANA] });
    const level2: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 2,
      users: [BOB],
    });
    const level3: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 3,
      users: [CARL],
    });
    await world.startRun();

    // The tick reads the run first, then Ana escalates, then the tick claims.
    world.clock = new Date(START.getTime() + 30 * 60 * 1000);
    const readByTheWorker: typeof world.run = Object.assign(
      Object.create(Object.getPrototypeOf(world.run)),
      world.run,
    );

    await world.passOn(ANA, undefined, level3.id!);

    await OnCallEscalationAdvance.advance({
      run: readByTheWorker,
      now: world.clock,
    });

    expect(world.pagedBy(level3)).toEqual(["Carl Diaz"]);
    expect(world.pagedBy(level2)).toEqual([]);
    expect(
      world.claims.map((claim: { won: boolean }) => {
        return claim.won;
      }),
    ).toEqual([true, false]);
  });
});

describe("a person's pages about one record, with the level picked per run", () => {
  let level3: OnCallDutyPolicyEscalationRule;

  beforeEach(async () => {
    world.addRule({ order: 1, users: [ANA] });
    world.addRule({ order: 2, users: [BOB] });
    level3 = world.addRule({ order: 3, users: [CARL] });
    await world.startRun();
  });

  test("pages the level picked for the run", async () => {
    const answers: Array<OnCallPassOnAnswer> =
      await OnCallPagePassOn.passOnForRecord({
        userId: ANA,
        projectId: PROJECT_ID,
        recordType: OnCallPageRecordType.Incident,
        recordId: INCIDENT_ID,
        escalateTo: { [RUN_ID.toString().toUpperCase()]: level3.id! },
      });

    expect(answers).toHaveLength(1);
    expect(answers[0]!.result).toMatchObject({
      outcome: OnCallPassOnOutcome.NextRulePaged,
      rule: { order: 3 },
    });
    expect(world.pagedNames()).toEqual(["Ana Lopez", "Carl Diaz"]);
  });

  test("a pick for another run is not this run's: it pages its next level", async () => {
    await OnCallPagePassOn.passOnForRecord({
      userId: ANA,
      projectId: PROJECT_ID,
      recordType: OnCallPageRecordType.Incident,
      recordId: INCIDENT_ID,
      escalateTo: { [nextId().toString()]: level3.id! },
    });

    expect(world.pagedNames()).toEqual(["Ana Lopez", "Bob Smith"]);
  });

  test("a level not offered any more is the answer, and nothing is escalated", async () => {
    world.rules = world.rules.filter((rule: OnCallDutyPolicyEscalationRule) => {
      return rule !== level3;
    });

    expect(
      await OnCallPagePassOn.passOnForRecord({
        userId: ANA,
        projectId: PROJECT_ID,
        recordType: OnCallPageRecordType.Incident,
        recordId: INCIDENT_ID,
        escalateTo: { [RUN_ID.toString()]: level3.id! },
      }),
    ).toEqual([
      { passedOn: false, refusal: OnCallPassOnRefusal.LevelNotAvailable },
    ]);
    expect(world.pagedNames()).toEqual(["Ana Lopez"]);
  });
});

describe("a line for a skipped level that cannot be written", () => {
  test("is logged, and the level picked is paged regardless", async () => {
    world.addRule({ order: 1, users: [ANA] });
    world.addRule({ order: 2, users: [BOB] });
    const level3: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 3,
      users: [CARL],
    });
    await world.startRun();

    jest
      .spyOn(
        OnCallDutyPolicyEscalationRuleService,
        "recordLevelSkippedByEscalation",
      )
      .mockImplementation(async () => {
        throw new Error("database is down");
      });

    const answer: OnCallPassOnAnswer = await world.passOn(
      ANA,
      undefined,
      level3.id!,
    );

    expect(answer.passedOn).toBe(true);
    expect(world.pagedBy(level3)).toEqual(["Carl Diaz"]);
    expect(world.errors.join("\n")).toContain(
      "skipped for a later level picked to page",
    );
  });

  test("the skipped level's line is written by the escalation rule service, as Skipped", async () => {
    world.addRule({ order: 1, users: [ANA] });
    world.addRule({ order: 2, users: [BOB] });
    const level3: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 3,
      users: [CARL],
    });
    await world.startRun();

    await world.passOn(ANA, undefined, level3.id!);

    const written: Array<Record<string, unknown>> = jest
      .mocked(OnCallDutyPolicyExecutionLogTimelineService.create)
      .mock.calls.map((call: Array<unknown>) => {
        return (call[0] as { data: Record<string, unknown> }).data;
      })
      .filter((data: Record<string, unknown>) => {
        return (
          data["statusMessage"] ===
          ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE
        );
      });

    expect(written).toHaveLength(1);
    expect(written[0]!["status"]).toBe(
      OnCallDutyExecutionLogTimelineStatus.Skipped,
    );
    expect(String(written[0]!["onCallDutyPolicyExecutionLogId"])).toBe(
      RUN_ID.toString(),
    );
    expect(String(written[0]!["triggeredByIncidentId"])).toBe(
      INCIDENT_ID.toString(),
    );
    expect(written[0]!["alertSentToUserId"]).toBeUndefined();
  });
});

describe("the run that ended meanwhile", () => {
  test("is a page that is over, picked level or not", async () => {
    world.addRule({ order: 1, users: [ANA] });
    world.addRule({ order: 2, users: [BOB] });
    const level3: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 3,
      users: [CARL],
    });
    await world.startRun();
    await world.deliver(ANA);
    world.run.status = OnCallDutyPolicyStatus.Completed;

    expect(await world.passOn(ANA, undefined, level3.id!)).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.PageOver,
    });
  });
});
