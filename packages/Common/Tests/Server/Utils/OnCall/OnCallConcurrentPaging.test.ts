import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import OnCallDutyPolicyEscalationRuleService, {
  OnCallPagedTarget,
  OnCallPagingOutcome,
} from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallAcknowledgementTimeoutUtil, {
  OnCallPageAgainOutcome,
  OnCallPageAgainResult,
} from "../../../../Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import OnCallPageMerge, {
  OnCallMergedPageReading,
  OnCallMergedPageStanding,
} from "../../../../Server/Utils/OnCall/OnCallPageMerge";
import OnCallPagePassOn from "../../../../Server/Utils/OnCall/OnCallPagePassOn";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  OnCallPageCoverKind,
  getOnCallPageMergedLine,
  getOnCallPageMergedMessage,
} from "../../../../Types/OnCallDutyPolicy/OnCallPageMerge";
import UserNotificationExecutionStatus from "../../../../Types/UserNotification/UserNotificationExecutionStatus";
import {
  getOnCallPolicyRunRecordHandledMessage,
  getOnCallPolicyRunRecordResolvedMessage,
} from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  OnCallOpenPage,
  OnCallPageRecordType,
  OnCallPassOnAnswer,
  OnCallPassOnOutcome,
} from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import AcknowledgementTimeoutWorld, {
  ACKNOWLEDGED,
  CREATED,
} from "./AcknowledgementTimeoutWorld";
import {
  ANA,
  BOB,
  CARL,
  DANA,
  INCIDENT_ID,
  NAMES,
  POLICY_ID,
  PROJECT_ID,
  PageEvent,
  RUN_ID,
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
 * CONCURRENT PAGING AND ACKNOWLEDGEMENT, THROUGH THE REAL CODE
 * (https://github.com/OneUptime/oneuptime/issues/7596, #7837).
 *
 * A customer asked three things:
 *
 *   1. An incident runs two on-call policies, and the same person is on call
 *      in both: are they paged twice?
 *   2. Once anybody acknowledges, does paging stop for every policy?
 *   3. How does a policy started by hand behave on an incident that is
 *      acknowledged already?
 *
 * Each is answered here by running OneUptime's own code over an incident in
 * memory (AcknowledgementTimeoutWorld): escalation rules paging their people,
 * the run moving on, the incident's states, answering a page, escalating it,
 * the page-again clock - and the escalation worker's tick, ending each run
 * by the one rule the worker ends runs by (isOnCallPageEndedOnlyByAnAnswer).
 *
 * The first answer changed with #7837: the second policy's page of them is
 * merged into their open page from the first (OnCallPageMerge) - one set of
 * notifications, with the second run saying who is paging them.
 *
 * The policy, Payments, pages Ana at its first level and Carl at its second,
 * 30 minutes later; Dana is somebody who works the incident without being
 * paged by it. A second policy, Billing, pages whom each test says.
 */

let world: AcknowledgementTimeoutWorld;
let first: OnCallDutyPolicyEscalationRule;

const LEVEL_WAIT_IN_MINUTES: number = 30;

beforeEach(() => {
  world = new AcknowledgementTimeoutWorld();
  world.install();
  first = world.addRule({ order: 1, users: [ANA] });
  world.addRule({ order: 2, users: [CARL] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * A run of a policy for the incident, paging the policy's first level, as
 * OnCallDutyPolicyExecutionLogService starts every run: started by hand -
 * Execute On-Call Policy in the Dashboard, Slack or Microsoft Teams - by
 * `by`, or by OneUptime (no `by`), as the incident's on-call rules start it;
 * as observers when `isObserverPage`.
 */
async function startPolicy(data: {
  by?: ObjectID | undefined;
  onCallDutyPolicyId?: ObjectID | undefined;
  firstRule?: OnCallDutyPolicyEscalationRule | undefined;
  isObserverPage?: boolean | undefined;
}): Promise<ObjectID> {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = nextId();
  run.projectId = PROJECT_ID;
  run.onCallDutyPolicyId = data.onCallDutyPolicyId || POLICY_ID;
  run.triggeredByIncidentId = INCIDENT_ID;

  if (data.by) {
    run.triggeredByUserId = data.by;
  }

  if (data.isObserverPage) {
    run.isObserverPage = true;
  }

  run.userNotificationEventType = UserNotificationEventType.IncidentCreated;
  run.status = OnCallDutyPolicyStatus.Executing;
  run.onCallPolicyExecutionRepeatCount = 1;
  run.createdAt = new Date(world.clock);
  world.addRunRow(run);

  await OnCallDutyPolicyEscalationRuleService.startRuleExecution(
    (data.firstRule || first).id!,
    {
      projectId: PROJECT_ID,
      triggeredByIncidentId: INCIDENT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      onCallPolicyExecutionLogId: run.id,
      onCallPolicyId: run.onCallDutyPolicyId,
    },
  );

  return run.id;
}

// A run of the policy started by hand, by `by`.
async function startByHand(
  by: ObjectID,
  data?: {
    onCallDutyPolicyId?: ObjectID | undefined;
    firstRule?: OnCallDutyPolicyEscalationRule | undefined;
  },
): Promise<ObjectID> {
  return await startPolicy({ ...data, by: by });
}

interface SecondPolicy {
  policyId: ObjectID;
  rule: OnCallDutyPolicyEscalationRule;
}

/*
 * A second policy of the same incident, Billing, whose first level pages
 * `users` and waits `escalateAfterInMinutes` - and, when `thenUsers` are
 * given, a second level that pages them.
 */
function secondPolicy(
  users: Array<ObjectID>,
  options?: {
    escalateAfterInMinutes?: number | undefined;
    thenUsers?: Array<ObjectID> | undefined;
  },
): SecondPolicy {
  const policyId: ObjectID = nextId();
  const rule: OnCallDutyPolicyEscalationRule = world.addRule({
    order: 1,
    users: users,
    escalateAfterInMinutes: options?.escalateAfterInMinutes,
  });
  rule.onCallDutyPolicyId = policyId;

  if (options?.thenUsers) {
    const next: OnCallDutyPolicyEscalationRule = world.addRule({
      order: 2,
      users: options.thenUsers,
    });
    next.onCallDutyPolicyId = policyId;
  }

  world.policyNames[policyId.toString()] = "Billing";

  return { policyId: policyId, rule: rule };
}

// A run of Billing, as OneUptime starts it for the incident.
async function startBilling(billing: SecondPolicy): Promise<ObjectID> {
  return await startPolicy({
    onCallDutyPolicyId: billing.policyId,
    firstRule: billing.rule,
  });
}

/*
 * Everybody's pages, as "Name: run" - one row for each time a run paged them
 * through their On-Call Rules. A page merged into another sends nothing, and
 * is no row here (mergedPagesOf).
 */
function pagesOf(userId: ObjectID): Array<string> {
  return world.pages
    .filter((page: PageEvent) => {
      return page.userId === userId.toString();
    })
    .map((page: PageEvent) => {
      return `${NAMES[userId.toString()]}: ${page.runId}`;
    });
}

// A person's log in a run.
function logOf(userId: ObjectID, runId: ObjectID): UserOnCallLog {
  return world.logs.find((log: UserOnCallLog) => {
    return (
      log.userId?.toString() === userId.toString() &&
      log.onCallDutyPolicyExecutionLogId?.toString() === runId.toString()
    );
  })!;
}

// The run's line for a person.
function lineOf(
  userId: ObjectID,
  runId: ObjectID,
): OnCallDutyPolicyExecutionLogTimeline {
  return world.steps.find((step: OnCallDutyPolicyExecutionLogTimeline) => {
    return (
      step.alertSentToUserId?.toString() === userId.toString() &&
      step.onCallDutyPolicyExecutionLogId?.toString() === runId.toString()
    );
  })!;
}

// A person's merged pages, as "Name: run into the log of run".
function mergedPagesOf(userId: ObjectID): Array<string> {
  return world.merges
    .filter((merge: { userId: string }) => {
      return merge.userId === userId.toString();
    })
    .map((merge: { runId: string; intoLogId: string }) => {
      const into: UserOnCallLog | undefined = world.logs.find(
        (log: UserOnCallLog) => {
          return log.id?.toString() === merge.intoLogId;
        },
      );

      return `${NAMES[userId.toString()]}: ${merge.runId} into ${into?.onCallDutyPolicyExecutionLogId?.toString()}`;
    });
}

async function openPagesOf(userId: ObjectID): Promise<Array<OnCallOpenPage>> {
  return await OnCallPagePassOn.getOpenPagesForRecord({
    userId: userId,
    projectId: PROJECT_ID,
    recordType: OnCallPageRecordType.Incident,
    recordId: INCIDENT_ID,
  });
}

describe("1. the same person on call in two policies of one incident", () => {
  test("is paged once: the second policy's page of them is merged into the first's, and sends nothing", async () => {
    const billing: SecondPolicy = secondPolicy([ANA]);

    await world.startRun();
    const billingRun: ObjectID = await startBilling(billing);

    expect(pagesOf(ANA)).toEqual([`Ana Lopez: ${RUN_ID.toString()}`]);
    expect(mergedPagesOf(ANA)).toEqual([
      `Ana Lopez: ${billingRun.toString()} into ${RUN_ID.toString()}`,
    ]);
    expect(logOf(ANA, billingRun).status).toBe(
      UserNotificationExecutionStatus.AlreadyPaged,
    );
    expect(logOf(ANA, billingRun).mergedIntoUserOnCallLogId!.toString()).toBe(
      logOf(ANA, RUN_ID).id!.toString(),
    );
  });

  test("the second run's line for them says who is paging them already", async () => {
    const billing: SecondPolicy = secondPolicy([ANA]);

    await world.startRun();
    const billingRun: ObjectID = await startBilling(billing);

    expect(lineOf(ANA, billingRun).status).toBe(
      OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
    );
    expect(lineOf(ANA, billingRun).statusMessage).toBe(
      getOnCallPageMergedMessage({ policyName: "Payments" }),
    );
    expect(lineOf(ANA, billingRun).statusMessage).toBe(
      "Already paged about this by Payments, so not paged again.",
    );
    expect(logOf(ANA, billingRun).statusMessage).toBe(
      lineOf(ANA, billingRun).statusMessage,
    );
  });

  test("somebody only the second policy names is paged by it as always", async () => {
    const billing: SecondPolicy = secondPolicy([ANA, BOB]);

    await world.startRun();
    const billingRun: ObjectID = await startBilling(billing);

    expect(pagesOf(BOB)).toEqual([`Bob Smith: ${billingRun.toString()}`]);
    expect(pagesOf(ANA)).toEqual([`Ana Lopez: ${RUN_ID.toString()}`]);
    expect(mergedPagesOf(BOB)).toEqual([]);
  });

  test("named twice in one level - by name and through a team - is paged once by it", async () => {
    world.teamMembers[TEAM_ID.toString()] = [ANA, BOB];
    first = world.addRule({ order: 1, users: [ANA], teams: [TEAM_ID] });
    world.rules = world.rules.filter((rule: OnCallDutyPolicyEscalationRule) => {
      return rule === first || rule.order !== 1;
    });

    await world.startRun();

    expect(pagesOf(ANA)).toHaveLength(1);
    expect(pagesOf(BOB)).toHaveLength(1);
  });

  test("the second policy's level, holding only somebody already paged, waits its minutes before its next level", async () => {
    const billing: SecondPolicy = secondPolicy([ANA], {
      escalateAfterInMinutes: 10,
      thenUsers: [BOB],
    });

    await world.startRun();
    const billingRun: ObjectID = await startBilling(billing);

    // Not a level that paged nobody: it is not passed at once.
    expect(world.runById(billingRun).lastExecutedEscalationRuleOrder).toBe(1);
    expect(pagesOf(BOB)).toEqual([]);
    expect(world.levelLines()).toEqual([]);

    world.advance(9);
    await world.escalationTick();

    expect(pagesOf(BOB)).toEqual([]);

    world.advance(1);
    await world.escalationTick();

    expect(pagesOf(BOB)).toEqual([`Bob Smith: ${billingRun.toString()}`]);
  });

  test("a page whose notifications all went out is still open while its run pages: a later policy's page is merged into it", async () => {
    const billing: SecondPolicy = secondPolicy([ANA]);

    await world.startRun();
    // Her On-Call Rules have all sent what they had to; Payments still waits.
    await world.deliver(ANA);

    world.advance(5);
    const billingRun: ObjectID = await startBilling(billing);

    expect(pagesOf(ANA)).toEqual([`Ana Lopez: ${RUN_ID.toString()}`]);
    expect(logOf(ANA, billingRun).status).toBe(
      UserNotificationExecutionStatus.AlreadyPaged,
    );
  });

  test("a page whose run stopped is no longer open: the next policy pages them itself", async () => {
    const billing: SecondPolicy = secondPolicy([ANA]);

    await world.startRun();
    await world.deliver(ANA);
    world.runById(RUN_ID).status = OnCallDutyPolicyStatus.Completed;

    const billingRun: ObjectID = await startBilling(billing);

    expect(pagesOf(ANA)).toEqual([
      `Ana Lopez: ${RUN_ID.toString()}`,
      `Ana Lopez: ${billingRun.toString()}`,
    ]);
    expect(mergedPagesOf(ANA)).toEqual([]);
  });

  test("a page they escalated is no longer open: the next policy pages them itself", async () => {
    const billing: SecondPolicy = secondPolicy([ANA]);

    await world.startRun();
    await world.escalate(ANA, RUN_ID);

    const billingRun: ObjectID = await startBilling(billing);

    expect(pagesOf(ANA)).toContain(`Ana Lopez: ${billingRun.toString()}`);
    expect(mergedPagesOf(ANA)).toEqual([]);
  });

  test("a third policy's page is merged into their first page too, not into the second's", async () => {
    const billing: SecondPolicy = secondPolicy([ANA]);
    const third: SecondPolicy = secondPolicy([ANA]);

    await world.startRun();
    const billingRun: ObjectID = await startBilling(billing);
    world.advance(1);
    const thirdRun: ObjectID = await startBilling(third);

    expect(pagesOf(ANA)).toEqual([`Ana Lopez: ${RUN_ID.toString()}`]);
    expect(mergedPagesOf(ANA)).toEqual([
      `Ana Lopez: ${billingRun.toString()} into ${RUN_ID.toString()}`,
      `Ana Lopez: ${thirdRun.toString()} into ${RUN_ID.toString()}`,
    ]);
  });
});

describe("1. answering the one page answers it for every run it stands for", () => {
  test("both runs record them as who acknowledged it, and the merged page is acknowledged with it", async () => {
    const billing: SecondPolicy = secondPolicy([ANA]);

    await world.startRun();
    const billingRun: ObjectID = await startBilling(billing);

    world.advance(4);
    await world.answerPage(ANA, RUN_ID);

    for (const run of [RUN_ID, billingRun]) {
      expect(world.runById(run).status).toBe(OnCallDutyPolicyStatus.Completed);
      expect(world.runById(run).acknowledgedByUserId!.toString()).toBe(
        ANA.toString(),
      );
    }

    expect(logOf(ANA, billingRun).status).toBe(
      UserNotificationExecutionStatus.Completed,
    );
    expect(logOf(ANA, billingRun).acknowledgedAt).toEqual(
      new Date(world.clock),
    );
    expect(lineOf(ANA, billingRun).status).toBe(
      OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
    );
    expect(world.incident!.stateId.toString()).toBe(ACKNOWLEDGED.toString());
  });

  test("neither policy pages its next level after that", async () => {
    const billing: SecondPolicy = secondPolicy([ANA], {
      escalateAfterInMinutes: 10,
      thenUsers: [BOB],
    });

    await world.startRun();
    await startBilling(billing);

    world.advance(4);
    await world.answerPage(ANA, RUN_ID);

    world.advance(LEVEL_WAIT_IN_MINUTES);
    await world.escalationTick();

    expect(pagesOf(BOB)).toEqual([]);
    expect(pagesOf(CARL)).toEqual([]);
  });

  test("somebody else on the second policy's level is not answered for: only the person who answered is", async () => {
    const billing: SecondPolicy = secondPolicy([ANA, BOB]);

    await world.startRun();
    const billingRun: ObjectID = await startBilling(billing);

    world.advance(4);
    await world.answerPage(ANA, RUN_ID);

    expect(logOf(BOB, billingRun).acknowledgedAt).toBeFalsy();
    expect(logOf(ANA, billingRun).acknowledgedAt).toBeTruthy();
  });
});

describe("1. escalating the one page", () => {
  test("from its message escalates that policy only: the merged page is then free to take the page over", async () => {
    const billing: SecondPolicy = secondPolicy([ANA]);

    await world.startRun();
    const billingRun: ObjectID = await startBilling(billing);

    world.advance(2);
    const answer: OnCallPassOnAnswer = await world.escalate(ANA, RUN_ID);

    expect(answer.passedOn).toBe(true);
    expect(pagesOf(CARL)).toEqual([`Carl Diaz: ${RUN_ID.toString()}`]);
    // Billing is not escalated: Ana still has its page.
    expect(logOf(ANA, billingRun).status).toBe(
      UserNotificationExecutionStatus.AlreadyPaged,
    );
    expect(world.runById(billingRun).status).toBe(
      OnCallDutyPolicyStatus.Executing,
    );

    const merged: OnCallMergedPageReading =
      await OnCallPageMerge.readMergedPage(logOf(ANA, billingRun));

    expect(merged.standing).toBe(OnCallMergedPageStanding.TakesOver);
    expect(merged.by).toEqual({
      kind: OnCallPageCoverKind.Policy,
      name: "Payments",
    });
  });

  test("from the Dashboard or the app escalates every page about it, the merged one too", async () => {
    const billing: SecondPolicy = secondPolicy([ANA], {
      thenUsers: [BOB],
    });

    await world.startRun();
    const billingRun: ObjectID = await startBilling(billing);

    // The record's page lists both runs' pages of hers, and escalates both.
    expect(
      (await openPagesOf(ANA)).map((page: OnCallOpenPage) => {
        return page.executionLogId;
      }),
    ).toEqual([RUN_ID.toString(), billingRun.toString()]);

    world.advance(2);
    const answers: Array<OnCallPassOnAnswer> =
      await OnCallPagePassOn.passOnForRecord({
        userId: ANA,
        projectId: PROJECT_ID,
        recordType: OnCallPageRecordType.Incident,
        recordId: INCIDENT_ID,
      });

    expect(
      answers.map((answer: OnCallPassOnAnswer) => {
        return answer.passedOn;
      }),
    ).toEqual([true, true]);
    expect(logOf(ANA, billingRun).status).toBe(
      UserNotificationExecutionStatus.PassedOn,
    );
    expect(pagesOf(CARL)).toEqual([`Carl Diaz: ${RUN_ID.toString()}`]);
    expect(pagesOf(BOB)).toEqual([`Bob Smith: ${billingRun.toString()}`]);
  });

  test("from the app, the merged page is escalated too when its own run has stopped: it would page them again otherwise", async () => {
    const billing: SecondPolicy = secondPolicy([ANA]);

    await world.startRun();
    const billingRun: ObjectID = await startBilling(billing);

    // Billing went through its levels; Ana's page of it still stands on Payments'.
    world.runById(billingRun).status = OnCallDutyPolicyStatus.Completed;

    world.advance(2);
    await OnCallPagePassOn.passOnForRecord({
      userId: ANA,
      projectId: PROJECT_ID,
      recordType: OnCallPageRecordType.Incident,
      recordId: INCIDENT_ID,
    });

    expect(logOf(ANA, billingRun).status).toBe(
      UserNotificationExecutionStatus.PassedOn,
    );
  });

  test("the merged page keeps the second policy's level waiting while somebody else on it escalates", async () => {
    const billing: SecondPolicy = secondPolicy([ANA, BOB], {
      thenUsers: [DANA],
    });

    await world.startRun();
    const billingRun: ObjectID = await startBilling(billing);

    world.advance(2);
    const answer: OnCallPassOnAnswer = await world.escalate(BOB, billingRun);

    // Ana is still on Billing's level, through Payments' page of her.
    expect(answer.passedOn).toBe(true);
    expect(answer.result!.outcome).toBe(OnCallPassOnOutcome.OthersStillPaged);
    expect(pagesOf(DANA)).toEqual([]);
  });
});

describe("1. what is never merged", () => {
  test("a policy started by hand pages its people itself, even somebody another policy is paging already", async () => {
    const billing: SecondPolicy = secondPolicy([ANA]);

    await world.startRun();
    const byHand: ObjectID = await startByHand(DANA, {
      onCallDutyPolicyId: billing.policyId,
      firstRule: billing.rule,
    });

    expect(pagesOf(ANA)).toEqual([
      `Ana Lopez: ${RUN_ID.toString()}`,
      `Ana Lopez: ${byHand.toString()}`,
    ]);
    expect(mergedPagesOf(ANA)).toEqual([]);
  });

  test("a policy OneUptime starts is merged into an open page of a policy started by hand, which outlasts it", async () => {
    const billing: SecondPolicy = secondPolicy([ANA]);

    const byHand: ObjectID = await startByHand(DANA);
    const billingRun: ObjectID = await startBilling(billing);

    expect(pagesOf(ANA)).toEqual([`Ana Lopez: ${byHand.toString()}`]);
    expect(mergedPagesOf(ANA)).toEqual([
      `Ana Lopez: ${billingRun.toString()} into ${byHand.toString()}`,
    ]);

    // Her answer to the page by hand answers Billing's too.
    world.advance(3);
    await world.answerPage(ANA, byHand);

    expect(world.runById(billingRun).acknowledgedByUserId!.toString()).toBe(
      ANA.toString(),
    );
  });

  test("an observer's page and a responder's page are never merged: a responder's page after an observer's", async () => {
    const billing: SecondPolicy = secondPolicy([ANA]);

    const observers: ObjectID = await startPolicy({ isObserverPage: true });
    const billingRun: ObjectID = await startBilling(billing);

    expect(pagesOf(ANA)).toEqual([
      `Ana Lopez: ${observers.toString()}`,
      `Ana Lopez: ${billingRun.toString()}`,
    ]);
    expect(mergedPagesOf(ANA)).toEqual([]);
  });

  test("an observer's page and a responder's page are never merged: an observer's page after a responder's", async () => {
    const billing: SecondPolicy = secondPolicy([ANA]);

    await world.startRun();
    const observers: ObjectID = await startPolicy({
      onCallDutyPolicyId: billing.policyId,
      firstRule: billing.rule,
      isObserverPage: true,
    });

    expect(pagesOf(ANA)).toEqual([
      `Ana Lopez: ${RUN_ID.toString()}`,
      `Ana Lopez: ${observers.toString()}`,
    ]);
    expect(mergedPagesOf(ANA)).toEqual([]);
  });

  test("seeing an observer's page answers no responder's page merged into anything", async () => {
    const billing: SecondPolicy = secondPolicy([ANA]);

    const observers: ObjectID = await startPolicy({ isObserverPage: true });
    await world.startRun();
    const billingRun: ObjectID = await startBilling(billing);

    // Billing's page of her stands on Payments' responder's page, not the observers'.
    expect(mergedPagesOf(ANA)).toEqual([
      `Ana Lopez: ${billingRun.toString()} into ${RUN_ID.toString()}`,
    ]);

    world.advance(2);
    await world.answerPage(ANA, observers);

    expect(logOf(ANA, billingRun).status).toBe(
      UserNotificationExecutionStatus.AlreadyPaged,
    );
    expect(world.runById(billingRun).acknowledgedByUserId).toBeFalsy();
  });
});

describe("2. somebody acknowledges the incident", () => {
  test("answering a page acknowledges the incident, and every policy's run ends at the next tick - no next level for any of them", async () => {
    const other: { policyId: ObjectID; rule: OnCallDutyPolicyEscalationRule } =
      secondPolicy([BOB]);

    await world.startRun();
    // A second policy of the incident, as OneUptime starts it: by nobody.
    const secondRun: ObjectID = await startByHand(DANA, {
      onCallDutyPolicyId: other.policyId,
      firstRule: other.rule,
    });
    delete world.runById(secondRun).triggeredByUserId;

    world.advance(5);
    await world.answerPage(ANA, RUN_ID);

    expect(world.incident!.stateId.toString()).toBe(ACKNOWLEDGED.toString());
    expect(world.runById(RUN_ID).status).toBe(OnCallDutyPolicyStatus.Completed);

    world.advance(1);
    await world.escalationTick();

    expect(world.runById(secondRun).status).toBe(
      OnCallDutyPolicyStatus.Completed,
    );
    expect(world.runById(secondRun).statusMessage).toBe(
      getOnCallPolicyRunRecordHandledMessage("incident"),
    );

    world.advance(LEVEL_WAIT_IN_MINUTES);
    await world.escalationTick();

    expect(pagesOf(CARL)).toEqual([]);
  });

  test("acknowledging it in the Dashboard ends the run just the same, though no page was answered", async () => {
    await world.startRun();

    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    await world.escalationTick();

    expect(world.runById(RUN_ID).status).toBe(OnCallDutyPolicyStatus.Completed);

    world.advance(LEVEL_WAIT_IN_MINUTES);
    await world.escalationTick();

    expect(pagesOf(CARL)).toEqual([]);
  });

  test("while nobody has, the policy moves on to its next level", async () => {
    await world.startRun();

    world.advance(LEVEL_WAIT_IN_MINUTES);
    await world.escalationTick();

    expect(world.incident!.stateId.toString()).toBe(CREATED.toString());
    expect(pagesOf(CARL)).toEqual([`Carl Diaz: ${RUN_ID.toString()}`]);
  });
});

describe("3. a policy started by hand on an incident somebody acknowledged already", () => {
  async function startedByHandAfterAcknowledgement(): Promise<ObjectID> {
    await world.acknowledgeInDashboard(DANA);
    world.advance(1);

    return await startByHand(DANA);
  }

  test("pages its first level, and is not ended at the next tick: it moves on to its next level when nobody answers", async () => {
    const run: ObjectID = await startedByHandAfterAcknowledgement();

    expect(pagesOf(ANA)).toEqual([`Ana Lopez: ${run.toString()}`]);

    world.advance(1);
    await world.escalationTick();

    expect(world.runById(run).status).toBe(OnCallDutyPolicyStatus.Executing);

    world.advance(LEVEL_WAIT_IN_MINUTES);
    await world.escalationTick();

    expect(pagesOf(CARL)).toEqual([`Carl Diaz: ${run.toString()}`]);
    expect(world.runById(run).status).toBe(OnCallDutyPolicyStatus.Executing);
  });

  test("ends once somebody it paged answers it - no next level after that", async () => {
    const run: ObjectID = await startedByHandAfterAcknowledgement();

    world.advance(4);
    await world.answerPage(ANA, run);

    expect(world.runById(run).status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(world.runById(run).acknowledgedByUserId!.toString()).toBe(
      ANA.toString(),
    );

    world.advance(LEVEL_WAIT_IN_MINUTES);
    await world.escalationTick();

    expect(pagesOf(CARL)).toEqual([]);
  });

  test("ends once the incident is resolved", async () => {
    const run: ObjectID = await startedByHandAfterAcknowledgement();

    world.advance(4);
    await world.resolve(DANA);
    await world.escalationTick();

    expect(world.runById(run).status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(world.runById(run).statusMessage).toBe(
      getOnCallPolicyRunRecordResolvedMessage("incident"),
    );
  });

  test("the person paged can escalate it - it is not refused as already acknowledged", async () => {
    const run: ObjectID = await startedByHandAfterAcknowledgement();

    world.advance(2);
    const answer: OnCallPassOnAnswer = await world.escalate(ANA, run);

    expect(answer.passedOn).toBe(true);
    expect(answer.result!.outcome).toBe(OnCallPassOnOutcome.NextRulePaged);
    expect(pagesOf(CARL)).toEqual([`Carl Diaz: ${run.toString()}`]);
  });

  test("the Dashboard and the app offer Acknowledge again for it, which answers it", async () => {
    const run: ObjectID = await startedByHandAfterAcknowledgement();

    const pages: Array<OnCallOpenPage> = await openPagesOf(ANA);

    expect(pages).toHaveLength(1);
    expect(pages[0]!.executionLogId).toBe(run.toString());
    expect(pages[0]!.isPageAgain).toBe(true);
    // Paged to help, not paged again: the app does not say "again".
    expect(pages[0]!.isAskedFor).toBe(true);

    world.advance(3);

    expect(
      await OnCallAcknowledgementTimeoutUtil.acknowledgePagesAgainForRecord({
        userId: ANA,
        projectId: PROJECT_ID,
        recordType: OnCallPageRecordType.Incident,
        recordId: INCIDENT_ID,
      }),
    ).toBe(1);
    expect(world.runById(run).status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(world.runById(run).acknowledgedByUserId!.toString()).toBe(
      ANA.toString(),
    );
    expect(world.isStillPaging(ANA, run)).toBe(false);
    expect(await openPagesOf(ANA)).toEqual([]);
  });

  test("answered, it starts the policy's page-again clock from the answer, as answering a page again does", async () => {
    const run: ObjectID = await startedByHandAfterAcknowledgement();

    world.advance(4);
    await world.answerPage(ANA, run);

    expect(world.runningClocks()).toEqual([
      { runId: run.toString(), startedAt: new Date(world.clock) },
    ]);
  });
});

describe("3. a policy started by hand on an incident nobody acknowledged yet", () => {
  test("its person acknowledging the incident answers their page of it", async () => {
    const run: ObjectID = await startByHand(DANA);

    world.advance(3);
    await world.changeState(ACKNOWLEDGED, ANA, { tellsWho: true });

    expect(world.runById(run).status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(world.runById(run).acknowledgedByUserId!.toString()).toBe(
      ANA.toString(),
    );

    world.advance(LEVEL_WAIT_IN_MINUTES);
    await world.escalationTick();

    expect(pagesOf(CARL)).toEqual([]);
  });

  test("somebody it did not page acknowledging the incident does not end it", async () => {
    const run: ObjectID = await startByHand(DANA);

    world.advance(3);
    await world.changeState(ACKNOWLEDGED, DANA, { tellsWho: true });
    await world.escalationTick();

    expect(world.runById(run).status).toBe(OnCallDutyPolicyStatus.Executing);

    world.advance(LEVEL_WAIT_IN_MINUTES);
    await world.escalationTick();

    expect(pagesOf(CARL)).toEqual([`Carl Diaz: ${run.toString()}`]);
  });

  test("the Dashboard offers it no Acknowledge again: the incident's own Acknowledge answers it", async () => {
    await startByHand(DANA);

    const pages: Array<OnCallOpenPage> = await openPagesOf(ANA);

    expect(pages).toHaveLength(1);
    expect("isPageAgain" in pages[0]!).toBe(false);
    expect("isAskedFor" in pages[0]!).toBe(false);
  });
});

describe("the policy does not page again on top of a run started by hand that is still paging", () => {
  test("the clock runs out while it pages: nothing pages again until it is answered, then the clock counts from the answer", async () => {
    // OneUptime's run, acknowledged in the Dashboard: its clock starts.
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    await world.escalationTick();

    // Five minutes later Dana starts the policy by hand for more hands.
    world.advance(5);
    const run: ObjectID = await startByHand(DANA);

    // The clock runs out 30 minutes after the acknowledgement.
    world.advance(LEVEL_WAIT_IN_MINUTES - 5);
    const stillPaging: Array<OnCallPageAgainResult> =
      await world.pageAgainTick();

    expect(
      stillPaging.map((result: OnCallPageAgainResult) => {
        return result.outcome;
      }),
    ).toEqual([OnCallPageAgainOutcome.StillPaging]);
    expect(world.pagesAgain()).toEqual([]);

    // Ana answers the run started by hand: the clock counts from now.
    world.advance(2);
    await world.answerPage(ANA, run);
    const answeredAt: Date = new Date(world.clock);

    expect(world.runningClocks()).toEqual([
      { runId: run.toString(), startedAt: answeredAt },
    ]);

    world.advance(LEVEL_WAIT_IN_MINUTES - 1);
    expect(
      (await world.pageAgainTick()).map((result: OnCallPageAgainResult) => {
        return result.outcome;
      }),
    ).toEqual([OnCallPageAgainOutcome.NotDue]);

    world.advance(1);
    const results: Array<OnCallPageAgainResult> = await world.pageAgainTick();

    expect(
      results.map((result: OnCallPageAgainResult) => {
        return result.outcome;
      }),
    ).toEqual([OnCallPageAgainOutcome.PagedAgain]);
    expect(world.pagesAgain()).toHaveLength(1);
  });

  test("a run OneUptime started still pages again when its clock runs out, as it always did", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    await world.escalationTick();

    world.advance(LEVEL_WAIT_IN_MINUTES);

    expect(
      (await world.pageAgainTick()).map((result: OnCallPageAgainResult) => {
        return result.outcome;
      }),
    ).toEqual([OnCallPageAgainOutcome.PagedAgain]);
  });
});

/*
 * A DIRECT PAGE AND A POLICY PAGING ONE PERSON ABOUT ONE INCIDENT (#8859).
 *
 * A page somebody sends from Slack or Microsoft Teams, and a workflow's Page
 * Users step, page people with no policy behind the page (OnCallDirectPage).
 * Each was left out of #7837's merge, and so a person a policy and a direct
 * page both reached was paged twice:
 *
 *   - Dana pages Ana from the incident's channel; a moment later a policy's
 *     level reaches Ana. The policy's page of her is now merged into Dana's,
 *     which goes on until Ana answers it, and outlasts it.
 *   - A workflow's Page Users step pages Ana about an incident a policy is
 *     paging her about already. The workflow's page of her is now merged
 *     into the policy's - and, the other way round, a policy's page of her
 *     into the workflow's.
 *
 * A page somebody sends from a chat still pages its people itself, always:
 * it is asked for. An observer's page is never merged, either way.
 */
describe("4. a direct page and a policy paging the same person about one incident (#8859)", () => {
  /*
   * A direct page about the incident, run as OnCallDutyPolicyExecutionLog
   * Service starts one: sent from a chat by `by`, or by a workflow's step
   * named `workflowName`; to observers when `isObserverPage`.
   */
  async function startDirect(data: {
    users: Array<ObjectID>;
    by?: ObjectID | undefined;
    workflowName?: string | undefined;
    isObserverPage?: boolean | undefined;
  }): Promise<{ runId: ObjectID; outcome: OnCallPagingOutcome }> {
    const run: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    run.id = nextId();
    run.projectId = PROJECT_ID;
    run.triggeredByIncidentId = INCIDENT_ID;
    run.userNotificationEventType = UserNotificationEventType.IncidentCreated;
    run.status = OnCallDutyPolicyStatus.Executing;
    run.createdAt = new Date(world.clock);

    if (data.by) {
      run.triggeredByUserId = data.by;
    }

    if (data.workflowName !== undefined) {
      run.triggeredByWorkflowId = nextId();
      run.triggeredByWorkflowName = data.workflowName;
    }

    if (data.isObserverPage) {
      run.isObserverPage = true;
    }

    // As the database holds it: with no policy (addRunRow reads one with every run).
    world.runs.push(run);

    const outcome: OnCallPagingOutcome =
      await OnCallDutyPolicyEscalationRuleService.startDirectPage({
        projectId: PROJECT_ID,
        triggeredByIncidentId: INCIDENT_ID,
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
        onCallPolicyExecutionLogId: run.id,
        targets: {
          userIds: data.users,
          teamIds: [],
          onCallScheduleIds: [],
        },
      });

    return { runId: run.id, outcome: outcome };
  }

  test("Dana pages Ana from a chat, then a policy reaches her: the policy's page is merged into Dana's, and sends nothing", async () => {
    const fromDana: { runId: ObjectID } = await startDirect({
      users: [ANA],
      by: DANA,
    });

    world.advance(1);
    await world.startRun();

    expect(pagesOf(ANA)).toEqual([`Ana Lopez: ${fromDana.runId.toString()}`]);
    expect(mergedPagesOf(ANA)).toEqual([
      `Ana Lopez: ${RUN_ID.toString()} into ${fromDana.runId.toString()}`,
    ]);
    expect(logOf(ANA, RUN_ID).status).toBe(
      UserNotificationExecutionStatus.AlreadyPaged,
    );
  });

  test("the policy's line for her names Dana, who paged her directly - not a policy called Dana", async () => {
    const fromDana: { runId: ObjectID } = await startDirect({
      users: [ANA],
      by: DANA,
    });
    await world.startRun();

    expect(lineOf(ANA, RUN_ID).status).toBe(
      OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
    );
    expect(lineOf(ANA, RUN_ID).statusMessage).toBe(
      "Already paged directly about this by Dana Kim, so not paged again.",
    );
    expect(logOf(ANA, RUN_ID).statusMessage).toBe(
      lineOf(ANA, RUN_ID).statusMessage,
    );
    expect(logOf(ANA, RUN_ID).mergedIntoUserOnCallLogId!.toString()).toBe(
      logOf(ANA, fromDana.runId).id!.toString(),
    );
  });

  test("answering Dana's page answers the policy's too: its run records Ana as who acknowledged it", async () => {
    const fromDana: { runId: ObjectID } = await startDirect({
      users: [ANA],
      by: DANA,
    });
    await world.startRun();

    world.advance(3);
    await world.answerPage(ANA, fromDana.runId);

    expect(world.runById(RUN_ID).acknowledgedByUserId!.toString()).toBe(
      ANA.toString(),
    );
    expect(logOf(ANA, RUN_ID).acknowledgedAt).toEqual(new Date(world.clock));
    expect(lineOf(ANA, RUN_ID).status).toBe(
      OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
    );
  });

  test("Dana's page ends without Ana's answer - she escalated it from one of its messages: the policy's page takes it over", async () => {
    const fromDana: { runId: ObjectID } = await startDirect({
      users: [ANA],
      by: DANA,
    });
    await world.startRun();

    world.advance(2);
    await world.escalate(ANA, fromDana.runId);

    // The policy's page of her is not escalated with it: she still has it.
    expect(logOf(ANA, RUN_ID).status).toBe(
      UserNotificationExecutionStatus.AlreadyPaged,
    );

    const merged: OnCallMergedPageReading =
      await OnCallPageMerge.readMergedPage(logOf(ANA, RUN_ID));

    expect(merged.standing).toBe(OnCallMergedPageStanding.TakesOver);
    // Its take-over names Dana, as the merged page's line did.
    expect(merged.by).toEqual({
      kind: OnCallPageCoverKind.PersonPage,
      name: "Dana Kim",
    });
  });

  test("a page Dana sends from a chat still pages Ana itself, though a policy is paging her already", async () => {
    await world.startRun();
    const fromDana: { runId: ObjectID } = await startDirect({
      users: [ANA],
      by: DANA,
    });

    expect(pagesOf(ANA)).toEqual([
      `Ana Lopez: ${RUN_ID.toString()}`,
      `Ana Lopez: ${fromDana.runId.toString()}`,
    ]);
    expect(mergedPagesOf(ANA)).toEqual([]);
  });

  test("a workflow's Page Users step reaches Ana while a policy pages her: the workflow's page is merged into the policy's", async () => {
    await world.startRun();
    const workflow: { runId: ObjectID; outcome: OnCallPagingOutcome } =
      await startDirect({ users: [ANA, BOB], workflowName: "Nightly Checks" });

    expect(pagesOf(ANA)).toEqual([`Ana Lopez: ${RUN_ID.toString()}`]);
    expect(mergedPagesOf(ANA)).toEqual([
      `Ana Lopez: ${workflow.runId.toString()} into ${RUN_ID.toString()}`,
    ]);
    expect(lineOf(ANA, workflow.runId).statusMessage).toBe(
      getOnCallPageMergedMessage({ policyName: "Payments" }),
    );
    // Somebody the policy is not paging is paged by the workflow, as always.
    expect(pagesOf(BOB)).toEqual([`Bob Smith: ${workflow.runId.toString()}`]);
  });

  test("the workflow is told Ana was paged - by the policy's page, which it names", async () => {
    await world.startRun();
    const workflow: { runId: ObjectID; outcome: OnCallPagingOutcome } =
      await startDirect({ users: [ANA], workflowName: "Nightly Checks" });

    expect(
      workflow.outcome.paged.map((paged: OnCallPagedTarget) => {
        return {
          userId: paged.userId.toString(),
          alreadyPagedBy: paged.alreadyPagedByExecutionLogId?.toString(),
        };
      }),
    ).toEqual([{ userId: ANA.toString(), alreadyPagedBy: RUN_ID.toString() }]);
    expect(workflow.outcome.notPaged).toEqual([]);
  });

  test("a policy's level reaches Ana while a workflow's page of her is open: the policy's page is merged into the workflow's", async () => {
    const workflow: { runId: ObjectID } = await startDirect({
      users: [ANA],
      workflowName: "Nightly Checks",
    });
    await world.startRun();

    expect(pagesOf(ANA)).toEqual([`Ana Lopez: ${workflow.runId.toString()}`]);
    expect(lineOf(ANA, RUN_ID).statusMessage).toBe(
      getOnCallPageMergedLine({
        kind: OnCallPageCoverKind.WorkflowPage,
        name: "Nightly Checks",
      }),
    );
  });

  test("answering the policy's page answers the workflow's page merged into it", async () => {
    await world.startRun();
    const workflow: { runId: ObjectID } = await startDirect({
      users: [ANA],
      workflowName: "Nightly Checks",
    });

    world.advance(2);
    await world.answerPage(ANA, RUN_ID);

    expect(logOf(ANA, workflow.runId).acknowledgedAt).toEqual(
      new Date(world.clock),
    );
    expect(world.runById(workflow.runId).acknowledgedByUserId!.toString()).toBe(
      ANA.toString(),
    );
  });

  test("the policy's page of Ana ends without her answer - its run stopped: the workflow's page takes it over", async () => {
    await world.startRun();
    const workflow: { runId: ObjectID } = await startDirect({
      users: [ANA],
      workflowName: "Nightly Checks",
    });

    await world.deliver(ANA);
    world.runById(RUN_ID).status = OnCallDutyPolicyStatus.Completed;

    expect(
      (await OnCallPageMerge.readMergedPage(logOf(ANA, workflow.runId)))
        .standing,
    ).toBe(OnCallMergedPageStanding.TakesOver);
  });

  test("a workflow's page to observers and a policy's page of responders are never merged, either way", async () => {
    const observers: { runId: ObjectID } = await startDirect({
      users: [ANA],
      workflowName: "Keep managers informed",
      isObserverPage: true,
    });
    await world.startRun();
    const moreObservers: { runId: ObjectID } = await startDirect({
      users: [ANA],
      workflowName: "Keep managers informed",
      isObserverPage: true,
    });

    expect(pagesOf(ANA)).toEqual([
      `Ana Lopez: ${observers.runId.toString()}`,
      `Ana Lopez: ${RUN_ID.toString()}`,
      `Ana Lopez: ${moreObservers.runId.toString()}`,
    ]);
    expect(mergedPagesOf(ANA)).toEqual([]);
  });

  test("a page Dana sent to observers is no page a policy's is merged into", async () => {
    const observers: { runId: ObjectID } = await startDirect({
      users: [ANA],
      by: DANA,
      isObserverPage: true,
    });
    await world.startRun();

    expect(pagesOf(ANA)).toEqual([
      `Ana Lopez: ${observers.runId.toString()}`,
      `Ana Lopez: ${RUN_ID.toString()}`,
    ]);
  });
});
