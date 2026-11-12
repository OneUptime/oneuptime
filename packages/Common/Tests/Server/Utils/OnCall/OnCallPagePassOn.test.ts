import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import UserOnCallLogTimeline from "../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import UserOnCallLogService from "../../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import OnCallAcknowledgementTimeout, {
  OnCallTimeoutRecordState,
} from "../../../../Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import { OnCallEscalationAdvanceKind } from "../../../../Server/Utils/OnCall/OnCallEscalationAdvance";
import OnCallPagePassOn from "../../../../Server/Utils/OnCall/OnCallPagePassOn";
import { recordSendResult } from "../../../../Server/Utils/OnCall/OnCallNotificationStatus";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
} from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
  OnCallOpenPage,
  OnCallPageRecordType,
  OnCallPassOnAnswer,
  OnCallPassOnOutcome,
  OnCallPassOnRefusal,
  getOnCallPassOnRefusalSentence,
  getOnCallPassOnSentence,
} from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import UserNotificationExecutionStatus from "../../../../Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationStatus from "../../../../Types/UserNotification/UserNotificationStatus";
import PassOnWorld, {
  ANA,
  BOB,
  CARL,
  DANA,
  INCIDENT_ID,
  PROJECT_ID,
  RUN_ID,
  START,
  TEAM_ID,
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
 * "CAN'T TAKE IT? PASS IT ON." - THE ENGINE, END TO END.
 *
 * A customer asked for a NACK: the person being paged can say they cannot
 * take the page, and the policy moves up its escalation path at once rather
 * than waiting out the rule. These run the real paging code - rules paging
 * their people, the run moving on, a person's log carrying "Passed On" to
 * the run's timeline - in an in-memory world (PassOnWorld), and read what
 * the policy did: who it paged, when, and what it says about each person.
 *
 * The policy, Payments, waits 30 minutes on each rule. It is 03:00 UTC.
 */

let world: PassOnWorld;

beforeEach(() => {
  world = new PassOnWorld();
  world.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function passed(answer: OnCallPassOnAnswer): OnCallPassOnOutcome {
  expect(answer.passedOn).toBe(true);
  expect(answer.refusal).toBeUndefined();

  return answer.result!.outcome;
}

describe("one person on the rule passes the page on", () => {
  let level1: OnCallDutyPolicyEscalationRule;
  let level2: OnCallDutyPolicyEscalationRule;

  beforeEach(async () => {
    level1 = world.addRule({ order: 1, users: [ANA] });
    level2 = world.addRule({ order: 2, users: [BOB] });
    await world.startRun();
  });

  test("the next rule is paged straight away, not after its 30 minutes", async () => {
    expect(world.pagedBy(level1)).toEqual(["Ana Lopez"]);
    expect(world.pagedBy(level2)).toEqual([]);

    const answer: OnCallPassOnAnswer = await world.passOn(ANA);

    expect(passed(answer)).toBe(OnCallPassOnOutcome.NextRulePaged);
    expect(world.pagedBy(level2)).toEqual(["Bob Smith"]);
    expect(world.currentOrder()).toBe(2);

    // Bob was paged at the very moment Ana passed it on.
    expect(world.pages[1]!.at.getTime()).toBe(START.getTime());
  });

  test("says which rule is paging now, and who it paged", async () => {
    const answer: OnCallPassOnAnswer = await world.passOn(ANA);

    expect(answer.result).toMatchObject({
      outcome: OnCallPassOnOutcome.NextRulePaged,
      isPreview: false,
      isDirectPage: false,
      policyName: "Payments",
      rule: { order: 2, name: "Level 2" },
      pagedNames: ["Bob Smith"],
      ruleCount: 2,
    });
    expect(getOnCallPassOnSentence(answer.result!)).toBe(
      "The policy is now paging Level 2 of 2: Bob Smith.",
    );
  });

  test("Ana's page is passed on: her log, and her line on the run's timeline", async () => {
    await world.passOn(ANA);

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
    expect(world.stepsOf(ANA)).toEqual([
      {
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        message: ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
      },
    ]);
  });

  test("the run moved on once: one claim, won", async () => {
    await world.passOn(ANA);

    expect(world.claims).toEqual([{ previous: START, won: true }]);
  });

  test("the worker's tick after it waits out Level 2's own 30 minutes, from when Bob was paged", async () => {
    await world.passOn(ANA);

    expect(await world.tick(29)).toBeNull();
    expect(world.pagedNames()).toEqual(["Ana Lopez", "Bob Smith"]);
  });

  test("the notification it was passed on from says so", async () => {
    const delivery: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    delivery.id = nextId();
    delivery.status = UserNotificationStatus.Sent;
    world.deliveries.push(delivery);

    await world.passOn(ANA, delivery.id!);

    expect(delivery.status).toBe(UserNotificationStatus.PassedOn);
    expect(delivery.statusMessage).toBe(
      ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
    );
  });

  test("the notification is marked escalated before the page is: the feed names the channel, read from it, as the page says it was escalated", async () => {
    const delivery: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    delivery.id = nextId();
    delivery.status = UserNotificationStatus.Sent;
    world.deliveries.push(delivery);

    jest.mocked(UserOnCallLogTimelineService.updateOneBy).mockClear();
    jest.mocked(UserOnCallLogService.updateOneById).mockClear();

    await world.passOn(ANA, delivery.id!);

    const deliveryWrites: Array<number> = jest.mocked(
      UserOnCallLogTimelineService.updateOneBy,
    ).mock.invocationCallOrder;
    const pageWrites: Array<number> = jest.mocked(
      UserOnCallLogService.updateOneById,
    ).mock.invocationCallOrder;

    expect(deliveryWrites).toHaveLength(1);
    expect(pageWrites.length).toBeGreaterThan(0);

    for (const pageWrite of pageWrites) {
      expect(deliveryWrites[0]!).toBeLessThan(pageWrite);
    }

    expect(world.stepsOf(ANA)[0]!.status).toBe(
      OnCallDutyExecutionLogTimelineStatus.PassedOn,
    );
  });

  /*
   * Issue #7082: the escalation is written on the notification only over
   * what its send or its provider wrote (OnCallNotificationStatus.
   * recordPassOn), at the status and the version read.
   */
  test("the notification is written at the status and the version read", async () => {
    const delivery: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    delivery.id = nextId();
    delivery.status = UserNotificationStatus.Sent;
    delivery.version = 3;
    world.deliveries.push(delivery);

    jest.mocked(UserOnCallLogTimelineService.updateOneBy).mockClear();

    await world.passOn(ANA, delivery.id!);

    expect(
      jest.mocked(UserOnCallLogTimelineService.updateOneBy).mock.calls[0]![0],
    ).toEqual({
      query: {
        _id: delivery.id!.toString(),
        status: UserNotificationStatus.Sent,
        version: 3,
      },
      data: {
        status: UserNotificationStatus.PassedOn,
        statusMessage: ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
      },
      props: { isRoot: true },
    });
    expect(delivery.version).toBe(4);
  });

  test.each([
    UserNotificationStatus.Sending,
    UserNotificationStatus.Error,
    UserNotificationStatus.NotAnswered,
  ])(
    "a notification at %s is marked escalated too",
    async (status: UserNotificationStatus) => {
      const delivery: UserOnCallLogTimeline = new UserOnCallLogTimeline();
      delivery.id = nextId();
      delivery.status = status;
      world.deliveries.push(delivery);

      await world.passOn(ANA, delivery.id!);

      expect(delivery.status).toBe(UserNotificationStatus.PassedOn);
    },
  );

  test("a notification acknowledged meanwhile - the acknowledgement landing after the page was read - stays acknowledged", async () => {
    const delivery: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    delivery.id = nextId();
    delivery.status = UserNotificationStatus.Acknowledged;
    delivery.statusMessage = "Notification Acknowledged";
    delivery.isAcknowledged = true;
    world.deliveries.push(delivery);

    await world.passOn(ANA, delivery.id!);

    expect(delivery.status).toBe(UserNotificationStatus.Acknowledged);
    expect(delivery.statusMessage).toBe("Notification Acknowledged");
    expect(delivery.isAcknowledged).toBe(true);
  });

  test("a send that finishes after the escalation does not write over it", async () => {
    const delivery: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    delivery.id = nextId();
    delivery.status = UserNotificationStatus.Sending;
    world.deliveries.push(delivery);

    await world.passOn(ANA, delivery.id!);

    await expect(
      recordSendResult({
        userOnCallLogTimelineId: delivery.id!,
        isSent: true,
        statusMessage: "Message sent.",
      }),
    ).resolves.toBe(false);

    expect(delivery.status).toBe(UserNotificationStatus.PassedOn);
    expect(delivery.statusMessage).toBe(
      ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
    );
  });

  test("passing it on again is refused: already passed on", async () => {
    await world.passOn(ANA);

    const again: OnCallPassOnAnswer = await world.passOn(ANA);

    expect(again).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.AlreadyPassedOn,
    });
    expect(world.pagedNames()).toEqual(["Ana Lopez", "Bob Smith"]);
  });

  test("a page whose notifications all went out can be passed on too", async () => {
    await world.deliver(ANA);

    expect(world.logsOf(ANA)[0]!.status).toBe(
      UserNotificationExecutionStatus.Completed,
    );

    expect(passed(await world.passOn(ANA))).toBe(
      OnCallPassOnOutcome.NextRulePaged,
    );
    expect(world.stepsOf(ANA)[0]!.status).toBe(
      OnCallDutyExecutionLogTimelineStatus.PassedOn,
    );
  });

  test("somebody who is not paged has nothing to pass on", async () => {
    expect(await world.passOn(CARL)).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.NotPaged,
    });
    expect(world.claims).toEqual([]);
  });

  test("Bob is not paged by the run again when Ana passes, and nor is anybody else", async () => {
    await world.passOn(ANA);
    await world.tick(30);

    // Level 2 was the last rule and nothing repeats: the run ends.
    expect(world.pagedNames()).toEqual(["Ana Lopez", "Bob Smith"]);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(world.run.statusMessage).toBe(
      ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
    );
  });
});

describe("several people on one rule", () => {
  let level1: OnCallDutyPolicyEscalationRule;
  let level2: OnCallDutyPolicyEscalationRule;

  beforeEach(async () => {
    level1 = world.addRule({ order: 1, users: [ANA, BOB] });
    level2 = world.addRule({ order: 2, users: [CARL] });
    await world.startRun();
  });

  test("one of them passing it on does not wake the next rule while the other may take it", async () => {
    const answer: OnCallPassOnAnswer = await world.passOn(ANA);

    expect(passed(answer)).toBe(OnCallPassOnOutcome.OthersStillPaged);
    expect(answer.result!.stillPagedNames).toEqual(["Bob Smith"]);
    expect(world.pagedBy(level2)).toEqual([]);
    expect(world.currentOrder()).toBe(1);
    expect(world.claims).toEqual([]);
  });

  test("it says who is still paged, and when the next rule comes if nobody acknowledges", async () => {
    const answer: OnCallPassOnAnswer = await world.passOn(ANA);

    expect(answer.result!.nextRule).toEqual({ order: 2, name: "Level 2" });
    expect(answer.result!.nextStepAt?.toISOString()).toBe(
      "2026-10-16T03:30:00.000Z",
    );
    // The world's clock reads 3:00 AM: the time is today, so no date.
    expect(getOnCallPassOnSentence(answer.result!, { timezone: "UTC" })).toBe(
      "Bob Smith is still being paged. If nobody acknowledges by 3:30 AM UTC, the policy pages Level 2 of 2 next.",
    );
  });

  test("once every one of them has passed it on, the next rule is paged straight away", async () => {
    await world.passOn(ANA);
    const answer: OnCallPassOnAnswer = await world.passOn(BOB);

    expect(passed(answer)).toBe(OnCallPassOnOutcome.NextRulePaged);
    expect(answer.result!.pagedNames).toEqual(["Carl Diaz"]);
    expect(world.pagedBy(level1)).toEqual(["Ana Lopez", "Bob Smith"]);
    expect(world.pagedBy(level2)).toEqual(["Carl Diaz"]);
  });

  test("the rule's own wait still moves the run on for the one who did not answer", async () => {
    await world.passOn(ANA);

    expect(await world.tick(29)).toBeNull();

    const advanced: Awaited<ReturnType<PassOnWorld["tick"]>> =
      await world.tick(1);

    expect(advanced?.kind).toBe(OnCallEscalationAdvanceKind.RuleStarted);
    expect(world.pagedBy(level2)).toEqual(["Carl Diaz"]);
  });

  test("passing it on at the same moment moves the run on once: the claim", async () => {
    const answers: Array<OnCallPassOnAnswer> = await Promise.all([
      world.passOn(ANA),
      world.passOn(BOB),
    ]);

    // Carl is paged once, whoever's look came last.
    expect(world.pagedBy(level2)).toEqual(["Carl Diaz"]);
    expect(
      answers.every((answer: OnCallPassOnAnswer) => {
        return answer.passedOn;
      }),
    ).toBe(true);
    expect(
      answers.some((answer: OnCallPassOnAnswer) => {
        return answer.result!.outcome === OnCallPassOnOutcome.NextRulePaged;
      }),
    ).toBe(true);
    expect(
      world.claims.filter((claim: { won: boolean }) => {
        return claim.won;
      }),
    ).toHaveLength(1);
  });

  test("a pass and the worker's tick landing together move the run on once", async () => {
    await world.passOn(ANA);
    world.clock = new Date(START.getTime() + 30 * 60 * 1000);

    await Promise.all([world.passOn(BOB), world.tick(0)]);

    expect(world.pagedBy(level2)).toEqual(["Carl Diaz"]);
    expect(
      world.claims.filter((claim: { won: boolean }) => {
        return claim.won;
      }),
    ).toHaveLength(1);
  });
});

describe("a team on the rule", () => {
  test("its members are the people on the rule: the run moves on once all of them passed", async () => {
    world.teamMembers[TEAM_ID.toString()] = [ANA, BOB];
    world.addRule({ order: 1, teams: [TEAM_ID] });
    const level2: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 2,
      users: [CARL],
    });
    await world.startRun();

    expect(passed(await world.passOn(BOB))).toBe(
      OnCallPassOnOutcome.OthersStillPaged,
    );
    expect(passed(await world.passOn(ANA))).toBe(
      OnCallPassOnOutcome.NextRulePaged,
    );
    expect(world.pagedBy(level2)).toEqual(["Carl Diaz"]);
  });
});

describe("the person who passed it on is not paged again by the run", () => {
  test("a later rule that names them passes them over, and pages the rest", async () => {
    world.addRule({ order: 1, users: [ANA] });
    const level2: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 2,
      users: [ANA, BOB],
    });
    await world.startRun();

    await world.passOn(ANA);

    expect(world.pagedBy(level2)).toEqual(["Bob Smith"]);
    expect(world.stepsOf(ANA)).toEqual([
      {
        status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
        message: ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
      },
      {
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        message: ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
      },
    ]);
  });

  test("named twice by a later rule - in its team and by name - they get one line", async () => {
    world.teamMembers[TEAM_ID.toString()] = [ANA, BOB];
    world.addRule({ order: 1, users: [ANA] });
    world.addRule({ order: 2, users: [ANA], teams: [TEAM_ID] });
    await world.startRun();

    await world.passOn(ANA);

    expect(world.stepsOf(ANA)).toHaveLength(2);
  });

  test("a rule that names only people who passed it on is passed at once: the run goes on to the next", async () => {
    world.addRule({ order: 1, users: [ANA] });
    const level2: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 2,
      users: [ANA],
    });
    const level3: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 3,
      users: [CARL],
    });
    await world.startRun();

    const answer: OnCallPassOnAnswer = await world.passOn(ANA);

    expect(answer.result).toMatchObject({
      outcome: OnCallPassOnOutcome.NextRulePaged,
      rule: { order: 3, name: "Level 3" },
      pagedNames: ["Carl Diaz"],
    });
    expect(world.pagedBy(level2)).toEqual([]);
    expect(world.pagedBy(level3)).toEqual(["Carl Diaz"]);
    expect(world.currentOrder()).toBe(3);

    // Moving past Level 2 was claimed too.
    expect(
      world.claims.filter((claim: { won: boolean }) => {
        return claim.won;
      }),
    ).toHaveLength(2);
  });

  test("such a rule writes no 'no users in this rule' line: its people's own lines say why", async () => {
    world.addRule({ order: 1, users: [ANA] });
    world.addRule({ order: 2, users: [ANA] });
    world.addRule({ order: 3, users: [CARL] });
    await world.startRun();

    await world.passOn(ANA);

    expect(
      world.steps
        .filter((step: { alertSentToUserId?: ObjectID | undefined }) => {
          return !step.alertSentToUserId;
        })
        .map((step: { statusMessage?: string | undefined }) => {
          return step.statusMessage;
        }),
    ).toEqual([]);
  });
});

describe("the last escalation rule", () => {
  test("with the policy's repeats left, the policy starts again from rule 1 - without them", async () => {
    world.repeatsAllowed = 1;
    const level1: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 1,
      users: [ANA, BOB],
    });
    const level2: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 2,
      users: [CARL],
    });
    await world.startRun();
    await world.tick(30);

    expect(world.pagedBy(level2)).toEqual(["Carl Diaz"]);

    // Ana passes on her Level 1 page while Level 2 pages Carl.
    await world.passOn(ANA);

    const answer: OnCallPassOnAnswer = await world.passOn(CARL);

    expect(answer.result).toMatchObject({
      outcome: OnCallPassOnOutcome.PolicyStartedAgain,
      rule: { order: 1 },
      pagedNames: ["Bob Smith"],
    });
    expect(world.pagedBy(level1)).toEqual([
      "Ana Lopez",
      "Bob Smith",
      "Bob Smith",
    ]);
    expect(world.run.onCallPolicyExecutionRepeatCount).toBe(2);
    expect(getOnCallPassOnSentence(answer.result!)).toBe(
      "There was no level after yours, so the policy started over and is paging Level 1 of 2 again.",
    );
  });

  test("with no repeat left, paging stops - and when everybody passed it on, the run says so", async () => {
    world.addRule({ order: 1, users: [ANA] });
    world.addRule({ order: 2, users: [BOB] });
    await world.startRun();

    await world.passOn(ANA);
    const answer: OnCallPassOnAnswer = await world.passOn(BOB);

    expect(passed(answer)).toBe(OnCallPassOnOutcome.PagingStopped);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(world.run.statusMessage).toBe(
      ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
    );
    expect(getOnCallPassOnSentence(answer.result!)).toBe(
      "Nobody else is left to page, so paging stopped. Somebody needs to take it.",
    );
  });

  test("with somebody it paged who never answered, it ends as one nobody acknowledged", async () => {
    world.addRule({ order: 1, users: [ANA] });
    world.addRule({ order: 2, users: [BOB] });
    await world.startRun();

    // Ana's wait runs out with no answer; Bob, on the last rule, passes it on.
    await world.tick(30);
    await world.passOn(BOB);

    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(world.run.statusMessage).toBe(
      ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
    );
  });

  test("a single-rule policy that repeats does not page the person who passed it on again and again", async () => {
    world.repeatsAllowed = 3;
    world.addRule({ order: 1, users: [ANA] });
    await world.startRun();

    const answer: OnCallPassOnAnswer = await world.passOn(ANA);

    /*
     * Every repeat would page nobody but Ana: the run ends at once. The
     * first repeat is a pass that reached nobody, and such a pass is not
     * gone round again (OnCallEscalationAdvance): the run stops there,
     * rather than spending its other repeats on nobody.
     */
    expect(passed(answer)).toBe(OnCallPassOnOutcome.PagingStopped);
    expect(world.pagedNames()).toEqual(["Ana Lopez"]);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(world.run.statusMessage).toBe(
      ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
    );
    expect(world.run.onCallPolicyExecutionRepeatCount).toBe(2);
  });
});

describe("a page from an earlier rule", () => {
  test("is passed on, and the run - on a later rule already - goes on as it is", async () => {
    world.addRule({ order: 1, users: [ANA] });
    const level2: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 2,
      users: [BOB],
    });
    world.addRule({ order: 3, users: [CARL] });
    await world.startRun();
    await world.tick(30);

    expect(world.pagedBy(level2)).toEqual(["Bob Smith"]);

    const answer: OnCallPassOnAnswer = await world.passOn(ANA);

    expect(answer.result).toMatchObject({
      outcome: OnCallPassOnOutcome.AlreadyEscalated,
      rule: { order: 2, name: "Level 2" },
    });
    expect(world.currentOrder()).toBe(2);
    expect(world.pagedNames()).toEqual(["Ana Lopez", "Bob Smith"]);
    expect(world.logsOf(ANA)[0]!.status).toBe(
      UserNotificationExecutionStatus.PassedOn,
    );
  });
});

describe("somebody took it already", () => {
  beforeEach(async () => {
    world.addRule({ order: 1, users: [ANA, BOB] });
    world.addRule({ order: 2, users: [CARL] });
    await world.startRun();
  });

  test("a page about a record somebody acknowledged is not passed on", async () => {
    world.isRecordAcknowledged = true;

    expect(await world.passOn(ANA)).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.RecordAcknowledged,
    });
    expect(world.logsOf(ANA)[0]!.status).toBe(
      UserNotificationExecutionStatus.Executing,
    );
  });

  test("names who acknowledged it, when the run says", async () => {
    world.isRecordAcknowledged = true;
    world.run.acknowledgedByUserId = BOB;
    world.run.acknowledgedByUser = { name: "Bob Smith" } as never;

    expect(await world.passOn(ANA)).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.RecordAcknowledged,
      acknowledgedByName: "Bob Smith",
    });
  });

  test("acknowledging after passing it on still takes the record, and stops the run", async () => {
    await world.passOn(ANA);

    const delivery: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    delivery.id = nextId();
    delivery.projectId = PROJECT_ID;
    delivery.userId = ANA;
    delivery.userNotificationLogId = world.logsOf(ANA)[0]!.id!;
    delivery.onCallDutyPolicyExecutionLogId = RUN_ID;
    delivery.onCallDutyPolicyExecutionLogTimelineId =
      world.logsOf(ANA)[0]!.onCallDutyPolicyExecutionLogTimelineId!;
    delivery.triggeredByIncidentId = INCIDENT_ID;
    world.deliveries.push(delivery);

    jest
      .spyOn(UserOnCallLogTimelineService, "findBy")
      .mockResolvedValue([delivery] as never);

    // The acknowledge link: its update's own hook, the real one.
    await (
      UserOnCallLogTimelineService as unknown as Record<
        string,
        (...args: Array<unknown>) => Promise<unknown>
      >
    )["onUpdateSuccess"]!.call(
      UserOnCallLogTimelineService,
      {
        updateBy: {
          query: { _id: delivery.id!.toString() },
          data: {
            acknowledgedAt: new Date(START),
            isAcknowledged: true,
            status: UserNotificationStatus.Acknowledged,
          },
          props: { isRoot: true },
        },
        carryForward: null,
      },
      [delivery.id!],
    );

    expect(world.acknowledgedBy?.toString()).toBe(ANA.toString());
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(world.run.acknowledgedByUserId?.toString()).toBe(ANA.toString());
    expect(world.stepsOf(ANA)[0]!.status).toBe(
      OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
    );
  });
});

describe("who took it, when no page was answered (#6711)", () => {
  /*
   * Somebody acknowledged the incident in the Dashboard, the app, Slack or
   * Microsoft Teams - answering no page, so the run names nobody. The
   * refusal the person reads names them, from the incident's own state
   * timeline; the Dashboard's list of the person's pages, read on every
   * visit, reads no timeline.
   */
  beforeEach(async () => {
    world.addRule({ order: 1, users: [ANA, BOB] });
    world.addRule({ order: 2, users: [CARL] });
    await world.startRun();
    world.isRecordAcknowledged = true;
  });

  test("escalating names who acknowledged it, from the incident's timeline", async () => {
    world.recordStanding = {
      isAcknowledged: true,
      isResolved: false,
      acknowledgement: { createdByUserId: CARL, startsAt: new Date(START) },
    };

    expect(await world.passOn(ANA)).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.RecordAcknowledged,
      acknowledgedByName: "Carl Diaz",
    });
    expect(
      getOnCallPassOnRefusalSentence(await world.passOn(ANA), {
        recordLabel: "Incident INC-7",
      }),
    ).toBe(
      "Incident INC-7 was already acknowledged by Carl Diaz, so there is nothing to escalate.",
    );
  });

  test("what escalating would do, asked first, names them too", async () => {
    world.recordStanding = {
      isAcknowledged: true,
      isResolved: false,
      acknowledgement: { createdByUserId: CARL, startsAt: new Date(START) },
    };

    expect((await world.preview(ANA)).acknowledgedByName).toBe("Carl Diaz");
  });

  test("an answer to a page names who answered it: the timeline is not read", async () => {
    world.run.acknowledgedAt = new Date(START);
    world.run.acknowledgedByUserId = BOB;
    world.run.acknowledgedByUser = { name: "Bob Smith" } as never;
    world.recordStanding = {
      isAcknowledged: true,
      isResolved: false,
      acknowledgement: { createdByUserId: CARL, startsAt: new Date(START) },
    };

    expect((await world.passOn(ANA)).acknowledgedByName).toBe("Bob Smith");
    expect(
      OnCallAcknowledgementTimeout.readRecordStanding,
    ).not.toHaveBeenCalled();
  });

  test("acknowledged by nobody by name - a workflow, an API key: no name", async () => {
    world.recordStanding = {
      isAcknowledged: true,
      isResolved: false,
      acknowledgement: { createdByUserId: null, startsAt: new Date(START) },
    };

    expect(await world.passOn(ANA)).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.RecordAcknowledged,
    });
  });

  test("a timeline that cannot be read: no name, never a throw", async () => {
    jest
      .spyOn(OnCallAcknowledgementTimeout, "readRecordStanding")
      .mockImplementation(async () => {
        throw new Error("the database is away");
      });

    expect(await world.passOn(ANA)).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.RecordAcknowledged,
    });
    expect(world.errors.join("\n")).toContain(
      "Could not read who acknowledged incident",
    );
  });

  test("the record's own run is what is read: its kind and its id", async () => {
    await world.passOn(ANA);

    expect(
      OnCallAcknowledgementTimeout.readRecordStanding,
    ).toHaveBeenCalledWith({
      kind: "incident",
      recordId: INCIDENT_ID,
    });
  });

  test("the Dashboard's list of the person's pages reads no timeline", async () => {
    expect(
      await OnCallPagePassOn.getOpenPagesForRecord({
        userId: ANA,
        projectId: PROJECT_ID,
        recordType: OnCallPageRecordType.Incident,
        recordId: INCIDENT_ID,
      }),
    ).toEqual([]);
    expect(
      OnCallAcknowledgementTimeout.readRecordStanding,
    ).not.toHaveBeenCalled();
  });

  test("a person's page resolved without an answer names nobody, and reads no timeline", async () => {
    // A direct page Dana asked for: no policy, by its id or read with it.
    delete world.run.onCallDutyPolicyId;
    delete world.run.onCallDutyPolicy;
    world.run.triggeredByUserId = DANA;

    jest
      .spyOn(OnCallAcknowledgementTimeout, "readRecordState")
      .mockResolvedValue({ isAcknowledged: true, isResolved: true });

    expect(await world.passOn(ANA)).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.RecordAcknowledged,
    });
    expect(
      OnCallAcknowledgementTimeout.readRecordStanding,
    ).not.toHaveBeenCalled();
  });
});

describe("the worker finishing a log just as it is passed on", () => {
  test("the timeline keeps 'Passed On', so the run still passes the person over", async () => {
    world.addRule({ order: 1, users: [ANA, BOB] });
    const level2: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 2,
      users: [ANA, CARL],
    });
    await world.startRun();

    await world.passOn(ANA);

    // The worker read Ana's log before she passed it on, and finishes it now.
    await (
      await import("../../../../Server/Services/UserOnCallLogService")
    ).default.updateOneById({
      id: world.logsOf(ANA)[0]!.id!,
      data: { status: UserNotificationExecutionStatus.Completed },
      props: { isRoot: true },
    });

    expect(world.stepsOf(ANA)[0]!.status).toBe(
      OnCallDutyExecutionLogTimelineStatus.PassedOn,
    );

    await world.tick(30);

    expect(world.pagedBy(level2)).toEqual(["Carl Diaz"]);
  });
});

describe("a run that stopped paging", () => {
  beforeEach(async () => {
    world.addRule({ order: 1, users: [ANA] });
    await world.startRun();
  });

  test("with the person's notifications all sent, the page is over", async () => {
    await world.deliver(ANA);
    world.run.status = OnCallDutyPolicyStatus.Completed;

    expect(await world.passOn(ANA)).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.PageOver,
    });
  });

  test("with a notification of theirs still going out, passing it on stops it, and moves nothing", async () => {
    world.run.status = OnCallDutyPolicyStatus.Completed;

    const answer: OnCallPassOnAnswer = await world.passOn(ANA);

    expect(passed(answer)).toBe(OnCallPassOnOutcome.PagingStopped);
    expect(world.logsOf(ANA)[0]!.status).toBe(
      UserNotificationExecutionStatus.PassedOn,
    );
    expect(world.claims).toEqual([]);
  });
});

describe("a direct page", () => {
  test("has no next rule: the others are still paged", async () => {
    await world.startDirectPage([ANA, BOB]);

    const answer: OnCallPassOnAnswer = await world.passOn(ANA);

    expect(answer.result).toMatchObject({
      outcome: OnCallPassOnOutcome.OthersStillPaged,
      isDirectPage: true,
      policyName: "",
      stillPagedNames: ["Bob Smith"],
    });
    expect(answer.result!.nextStepAt).toBeUndefined();
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Executing);
    expect(getOnCallPassOnSentence(answer.result!)).toBe(
      "Bob Smith is still being paged.",
    );
  });

  test("once everybody it paged passed it on, it ends as one nobody could take", async () => {
    await world.startDirectPage([ANA, BOB]);

    await world.passOn(ANA);
    const answer: OnCallPassOnAnswer = await world.passOn(BOB);

    expect(passed(answer)).toBe(OnCallPassOnOutcome.PagingStopped);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(world.run.statusMessage).toBe(
      ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
    );
    expect(world.pagedNames()).toEqual(["Ana Lopez", "Bob Smith"]);
  });

  test("the one person it paged passing it on ends it at once", async () => {
    await world.startDirectPage([ANA]);

    expect(passed(await world.passOn(ANA))).toBe(
      OnCallPassOnOutcome.PagingStopped,
    );
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Completed);
  });

  test("two people ending it at the same moment end it once", async () => {
    await world.startDirectPage([ANA, BOB]);

    await Promise.all([world.passOn(ANA), world.passOn(BOB)]);

    expect(
      world.runStatuses.filter((status: OnCallDutyPolicyStatus) => {
        return status === OnCallDutyPolicyStatus.Completed;
      }),
    ).toHaveLength(1);
  });
});

describe("a page a person asked for, about an incident somebody is on already (#6710)", () => {
  /*
   * Dana pages Ana - and Bob - into an incident from its Slack channel
   * (OnCallPersonPage): a direct page, started by a person, no workflow.
   * Somebody else acknowledged the incident already, as is usual for a page
   * from an incident's own channel. The page goes on until one of them
   * answers it or the incident is resolved, so each of them can still say
   * they cannot take it.
   */
  // Where the incident stands, as the run reads it (readRecordState).
  let standing: OnCallTimeoutRecordState | null;

  async function startPersonPage(userIds: Array<ObjectID>): Promise<void> {
    await world.startDirectPage(userIds);
    world.run.triggeredByUserId = DANA;
    world.isRecordAcknowledged = true;
  }

  beforeEach(() => {
    standing = { isAcknowledged: true, isResolved: false };

    jest
      .spyOn(OnCallAcknowledgementTimeout, "readRecordState")
      .mockImplementation(async () => {
        return standing;
      });
  });

  test("is not refused as acknowledged: escalating it stops paging the one person it paged", async () => {
    await startPersonPage([ANA]);

    expect(passed(await world.passOn(ANA))).toBe(
      OnCallPassOnOutcome.PagingStopped,
    );
    expect(world.logsOf(ANA)[0]!.status).toBe(
      UserNotificationExecutionStatus.PassedOn,
    );
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Completed);
  });

  test("with others it paged, says who is still being paged", async () => {
    await startPersonPage([ANA, BOB]);

    const answer: OnCallPassOnAnswer = await world.passOn(ANA);

    expect(passed(answer)).toBe(OnCallPassOnOutcome.OthersStillPaged);
    expect(answer.result!.stillPagedNames).toEqual(["Bob Smith"]);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Executing);
  });

  test("what escalating would do is offered first, as for any page", async () => {
    await startPersonPage([ANA, BOB]);

    const preview: OnCallPassOnAnswer = await world.preview(ANA);

    expect(preview.refusal).toBeUndefined();
    expect(preview.result).toMatchObject({
      outcome: OnCallPassOnOutcome.OthersStillPaged,
      isPreview: true,
      isDirectPage: true,
    });
    expect(world.logsOf(ANA)[0]!.status).toBe(
      UserNotificationExecutionStatus.Executing,
    );
  });

  test("the Dashboard and the app list it among the person's pages, so they offer Escalate", async () => {
    await startPersonPage([ANA, BOB]);

    const pages: Array<OnCallOpenPage> =
      await OnCallPagePassOn.getOpenPagesForRecord({
        userId: ANA,
        projectId: PROJECT_ID,
        recordType: OnCallPageRecordType.Incident,
        recordId: INCIDENT_ID,
      });

    expect(pages).toHaveLength(1);
    expect(pages[0]!.executionLogId).toBe(RUN_ID.toString());
    expect(pages[0]!.preview.outcome).toBe(
      OnCallPassOnOutcome.OthersStillPaged,
    );
    // It is no page again: the header offers no Acknowledge for it.
    expect("isPageAgain" in pages[0]!).toBe(false);
  });

  test("once one of its people answered it, it is taken - and says who", async () => {
    await startPersonPage([ANA, BOB]);
    world.run.acknowledgedAt = new Date(START);
    world.run.acknowledgedByUserId = BOB;
    world.run.acknowledgedByUser = { name: "Bob Smith" } as never;

    expect(await world.passOn(ANA)).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.RecordAcknowledged,
      acknowledgedByName: "Bob Smith",
    });
    expect(world.logsOf(ANA)[0]!.status).toBe(
      UserNotificationExecutionStatus.Executing,
    );
  });

  test("once its incident is resolved, it is over", async () => {
    await startPersonPage([ANA]);
    standing = { isAcknowledged: true, isResolved: true };

    expect(await world.passOn(ANA)).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.RecordAcknowledged,
    });
  });

  test("once its incident is gone, it is over", async () => {
    await startPersonPage([ANA]);
    standing = null;

    expect((await world.passOn(ANA)).refusal).toBe(
      OnCallPassOnRefusal.RecordAcknowledged,
    );
  });

  test("its record's standing is read for the record the run pages about", async () => {
    await startPersonPage([ANA]);

    await world.preview(ANA);

    expect(OnCallAcknowledgementTimeout.readRecordState).toHaveBeenCalledWith({
      kind: "incident",
      recordId: INCIDENT_ID,
    });
  });

  test("the run is read with every column that tells a person's page apart", async () => {
    await startPersonPage([ANA]);

    await world.preview(ANA);

    const calls: Array<Array<unknown>> = jest.mocked(
      OnCallDutyPolicyExecutionLogService.findOneById,
    ).mock.calls as unknown as Array<Array<unknown>>;

    expect(calls.length).toBeGreaterThan(0);
    expect((calls[calls.length - 1]![0] as { select: unknown }).select).toEqual(
      expect.objectContaining({
        onCallDutyPolicyId: true,
        triggeredByUserId: true,
        triggeredByWorkflowId: true,
      }),
    );
  });

  test("a direct page a workflow started still ends with its record's acknowledgement", async () => {
    await startPersonPage([ANA]);
    world.run.triggeredByWorkflowId = nextId();

    expect(await world.passOn(ANA)).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.RecordAcknowledged,
    });
    expect(OnCallAcknowledgementTimeout.readRecordState).not.toHaveBeenCalled();
  });

  test("a policy's page still ends with its record's acknowledgement", async () => {
    world.addRule({ order: 1, users: [ANA] });
    await world.startRun();
    world.run.triggeredByUserId = DANA;
    world.isRecordAcknowledged = true;

    expect((await world.passOn(ANA)).refusal).toBe(
      OnCallPassOnRefusal.RecordAcknowledged,
    );
  });

  test("an observer's page about an acknowledged record is left as it was: nothing to escalate", async () => {
    await startPersonPage([ANA]);
    world.run.isObserverPage = true;
    delete world.run.triggeredByUserId;

    expect((await world.passOn(ANA)).refusal).toBe(
      OnCallPassOnRefusal.RecordAcknowledged,
    );
  });

  test("about an incident nobody has acknowledged, it is escalated as before", async () => {
    await startPersonPage([ANA]);
    world.isRecordAcknowledged = false;
    standing = { isAcknowledged: false, isResolved: false };

    expect(passed(await world.passOn(ANA))).toBe(
      OnCallPassOnOutcome.PagingStopped,
    );
  });
});

describe("what passing it on would do, asked first", () => {
  test("the next rule, for the only person on the rule - and nothing changes", async () => {
    world.addRule({ order: 1, users: [ANA] });
    const managers: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 2,
      name: "Managers",
      users: [BOB],
    });
    await world.startRun();

    const preview: OnCallPassOnAnswer = await world.preview(ANA);

    expect(preview).toEqual({
      passedOn: false,
      result: {
        outcome: OnCallPassOnOutcome.NextRulePaged,
        isPreview: true,
        isDirectPage: false,
        policyName: "Payments",
        rule: { order: 2, name: "Managers" },
        pagedNames: [],
        stillPagedNames: [],
        ruleCount: 2,
        // The levels escalating may page: here only the next one.
        levelChoices: [
          {
            escalationRuleId: managers.id!.toString(),
            order: 2,
            name: "Managers",
          },
        ],
      },
    });
    expect(getOnCallPassOnSentence(preview.result!)).toBe(
      "This will immediately page Managers (Level 2 of 2), without waiting.",
    );
    expect(world.logsOf(ANA)[0]!.status).toBe(
      UserNotificationExecutionStatus.Executing,
    );
    expect(world.claims).toEqual([]);
  });

  test("who else is still paged, on a rule with others on it", async () => {
    world.addRule({ order: 1, users: [ANA, BOB, CARL] });
    await world.startRun();

    expect((await world.preview(ANA)).result).toMatchObject({
      outcome: OnCallPassOnOutcome.OthersStillPaged,
      stillPagedNames: ["Bob Smith", "Carl Diaz"],
    });
  });

  test("the policy starting again, on its last rule with a repeat left", async () => {
    world.repeatsAllowed = 2;
    world.addRule({ order: 1, users: [ANA] });
    await world.startRun();

    expect((await world.preview(ANA)).result).toMatchObject({
      outcome: OnCallPassOnOutcome.PolicyStartedAgain,
      rule: { order: 1 },
    });
  });

  test("paging stopping, on its last rule with no repeat", async () => {
    world.addRule({ order: 1, users: [ANA] });
    await world.startRun();

    expect((await world.preview(ANA)).result?.outcome).toBe(
      OnCallPassOnOutcome.PagingStopped,
    );
  });

  test("a refusal, for somebody who already passed it on", async () => {
    world.addRule({ order: 1, users: [ANA, BOB] });
    await world.startRun();
    await world.passOn(ANA);

    expect(await world.preview(ANA)).toEqual({
      passedOn: false,
      refusal: OnCallPassOnRefusal.AlreadyPassedOn,
    });
  });
});

describe("a person's pages about one record (the Dashboard and the mobile app)", () => {
  beforeEach(async () => {
    world.addRule({ order: 1, users: [ANA, BOB] });
    world.addRule({ order: 2, users: [CARL] });
    await world.startRun();
  });

  test("lists the run that is paging them, with what passing it on would do", async () => {
    const pages: Array<OnCallOpenPage> =
      await OnCallPagePassOn.getOpenPagesForRecord({
        userId: ANA,
        projectId: PROJECT_ID,
        recordType: OnCallPageRecordType.Incident,
        recordId: INCIDENT_ID,
      });

    expect(pages).toHaveLength(1);
    expect(pages[0]!.executionLogId).toBe(RUN_ID.toString());
    expect(pages[0]!.preview.outcome).toBe(
      OnCallPassOnOutcome.OthersStillPaged,
    );
  });

  test("lists nothing for somebody it is not paging", async () => {
    expect(
      await OnCallPagePassOn.getOpenPagesForRecord({
        userId: DANA,
        projectId: PROJECT_ID,
        recordType: OnCallPageRecordType.Incident,
        recordId: INCIDENT_ID,
      }),
    ).toEqual([]);
  });

  test("lists nothing about another record", async () => {
    expect(
      await OnCallPagePassOn.getOpenPagesForRecord({
        userId: ANA,
        projectId: PROJECT_ID,
        recordType: OnCallPageRecordType.Alert,
        recordId: INCIDENT_ID,
      }),
    ).toEqual([]);
  });

  test("passes them on, and answers once for the run", async () => {
    const answers: Array<OnCallPassOnAnswer> =
      await OnCallPagePassOn.passOnForRecord({
        userId: ANA,
        projectId: PROJECT_ID,
        recordType: OnCallPageRecordType.Incident,
        recordId: INCIDENT_ID,
      });

    expect(answers).toHaveLength(1);
    expect(answers[0]!.result?.outcome).toBe(
      OnCallPassOnOutcome.OthersStillPaged,
    );
  });

  test("answers 'not paged' for somebody it is not paging", async () => {
    expect(
      await OnCallPagePassOn.passOnForRecord({
        userId: DANA,
        projectId: PROJECT_ID,
        recordType: OnCallPageRecordType.Incident,
        recordId: INCIDENT_ID,
      }),
    ).toEqual([{ passedOn: false, refusal: OnCallPassOnRefusal.NotPaged }]);
  });

  test("answers why when there is nothing left to pass on", async () => {
    await world.passOn(ANA);

    expect(
      await OnCallPagePassOn.passOnForRecord({
        userId: ANA,
        projectId: PROJECT_ID,
        recordType: OnCallPageRecordType.Incident,
        recordId: INCIDENT_ID,
      }),
    ).toEqual([
      { passedOn: false, refusal: OnCallPassOnRefusal.AlreadyPassedOn },
    ]);
  });
});

describe("the run that is gone", () => {
  test("is nothing to pass on", async () => {
    expect(
      await OnCallPagePassOn.passOn({
        userId: ANA,
        executionLogId: new ObjectID("0f500000-0000-4000-8000-0000000000ff"),
      }),
    ).toEqual({ passedOn: false, refusal: OnCallPassOnRefusal.NotPaged });

    expect(
      jest.mocked(OnCallDutyPolicyExecutionLogService.claimEscalationAdvance),
    ).not.toHaveBeenCalled();
  });
});
