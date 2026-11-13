import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import OnCallDutyPolicyEscalationRuleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallAcknowledgementTimeoutUtil, {
  OnCallPageAgainOutcome,
  OnCallPageAgainResult,
} from "../../../../Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import OnCallPagePassOn from "../../../../Server/Utils/OnCall/OnCallPagePassOn";
import ObjectID from "../../../../Types/ObjectID";
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
 * (https://github.com/OneUptime/oneuptime/issues/7596).
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
 * The policy pages Ana at its first level and Carl at its second, 30
 * minutes later; Dana is somebody who works the incident without being
 * paged by it.
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
 * A run of the policy started by hand - Execute On-Call Policy in the
 * Dashboard, Slack or Microsoft Teams - by `by`, paging the policy's first
 * level, as OnCallDutyPolicyExecutionLogService starts every run.
 */
async function startByHand(
  by: ObjectID,
  data?: {
    onCallDutyPolicyId?: ObjectID | undefined;
    firstRule?: OnCallDutyPolicyEscalationRule | undefined;
  },
): Promise<ObjectID> {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = nextId();
  run.projectId = PROJECT_ID;
  run.onCallDutyPolicyId = data?.onCallDutyPolicyId || POLICY_ID;
  run.triggeredByIncidentId = INCIDENT_ID;
  run.triggeredByUserId = by;
  run.userNotificationEventType = UserNotificationEventType.IncidentCreated;
  run.status = OnCallDutyPolicyStatus.Executing;
  run.onCallPolicyExecutionRepeatCount = 1;
  run.createdAt = new Date(world.clock);
  world.addRunRow(run);

  await OnCallDutyPolicyEscalationRuleService.startRuleExecution(
    (data?.firstRule || first).id!,
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

// A second policy of the same incident, whose first level pages `users`.
function secondPolicy(users: Array<ObjectID>): {
  policyId: ObjectID;
  rule: OnCallDutyPolicyEscalationRule;
} {
  const policyId: ObjectID = nextId();
  const rule: OnCallDutyPolicyEscalationRule = world.addRule({
    order: 1,
    users: users,
  });
  rule.onCallDutyPolicyId = policyId;

  return { policyId: policyId, rule: rule };
}

// Everybody's pages, as "Name: run" - one row for each time a run paged them.
function pagesOf(userId: ObjectID): Array<string> {
  return world.logs
    .filter((log: UserOnCallLog) => {
      return log.userId?.toString() === userId.toString();
    })
    .map((log: UserOnCallLog) => {
      return `${NAMES[userId.toString()]}: ${log.onCallDutyPolicyExecutionLogId!.toString()}`;
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
  test("is paged once by each policy's run: two pages, each through their own On-Call Rules", async () => {
    const other: { policyId: ObjectID; rule: OnCallDutyPolicyEscalationRule } =
      secondPolicy([ANA]);

    await world.startRun();
    const secondRun: ObjectID = await startByHand(DANA, {
      onCallDutyPolicyId: other.policyId,
      firstRule: other.rule,
    });

    expect(pagesOf(ANA)).toEqual([
      `Ana Lopez: ${RUN_ID.toString()}`,
      `Ana Lopez: ${secondRun.toString()}`,
    ]);
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
