import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import IncidentService from "../../../Server/Services/IncidentService";
import AlertService from "../../../Server/Services/AlertService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import Model from "../../../Models/DatabaseModels/UserOnCallLog";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * UserOnCallLogService.onCreateSuccess is the moment a page is actually routed
 * to a human. A UserOnCallLog row is written by the escalation machinery, and
 * this hook decides whether the responder's phone rings.
 *
 * The branch these tests are mostly about is the "no rules" dead-end at
 * UserOnCallLogService.ts:329. When the responder has ZERO UserNotificationRule
 * rows matching (ruleType x severity), the hook writes `Error` plus a status
 * message onto the log and onto the on-call timeline, and RETURNS. Nothing is
 * sent. Nobody is emailed. The escalation timer keeps running as if the person
 * had simply chosen not to acknowledge. This is Gap C in
 * Internal/Roadmap/OnCallNotificationReadiness.md, and Phase 1 replaces the
 * dead-end with a verified-method fallback.
 *
 * Everything in section (A) below therefore pins behaviour that is DELIBERATELY
 * WRONG today and is expected to change:
 *
 *   GAP C - Phase 1 replaces this dead-end with a verified-method fallback
 *           (status Success + "notified via fallback (<method>)"), an explicit
 *           opt-out path (status Skipped), and an owner-notification event. The
 *           assertions on `UserNotificationExecutionStatus.Error` and on the
 *           exact "No notification rules found for this user..." string are the
 *           ones a later phase must invert.
 *
 * The rest of the file pins the surrounding machinery that the fallback has to
 * keep working: which severity id is threaded into the rule count for each of
 * the four trigger kinds, the exact option bag handed to
 * executeNotificationRuleItem, the event-type -> rule-type mapping, the
 * execution-status -> timeline-status translation in onUpdateSuccess, and the
 * unconditional `status = Scheduled` stamp in onBeforeCreate.
 *
 * No database is touched: every persistence call is a jest.spyOn stub, and the
 * protected hooks are invoked directly through a cast, exactly as the
 * neighbouring UserOnCallLog / TeamMember characterisation tests do.
 */

const LOG_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const TIMELINE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const EXECUTION_LOG_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const POLICY_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const ESCALATION_RULE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const TEAM_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SCHEDULE_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

const INCIDENT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const ALERT_ID: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const ALERT_EPISODE_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const INCIDENT_EPISODE_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);

const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2",
);
const EPISODE_ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3",
);
const EPISODE_INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4",
);

const RULE_A_ID: ObjectID = new ObjectID(
  "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1",
);
const RULE_B_ID: ObjectID = new ObjectID(
  "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2",
);

/*
 * The literal the dead-end writes. Copied character-for-character from
 * UserOnCallLogService.ts:335 and :348 - it is written twice, and both copies
 * must agree or the log and the timeline tell the operator different stories.
 */
const NO_RULES_MESSAGE: string =
  "No notification rules found for this user. User should add the rules in User Settings > On-Call Rules.";

interface StatusUpdateCall {
  id: ObjectID;
  data: {
    status?: UserNotificationExecutionStatus | undefined;
    statusMessage?: string | undefined;
  };
  props: { isRoot: boolean };
}

interface TimelineUpdateCall {
  id: ObjectID;
  data: {
    status?: OnCallDutyExecutionLogTimelineStatus | undefined;
    statusMessage?: string | undefined;
  };
  props: { isRoot: boolean };
}

interface RuleQueryCall {
  query: {
    userId: ObjectID;
    projectId: ObjectID;
    ruleType: NotificationRuleType;
    notifyAfterMinutes?: number | undefined;
    incidentSeverityId?: ObjectID | undefined;
    alertSeverityId?: ObjectID | undefined;
  };
  skip: number;
  limit: number;
  props: { isRoot: boolean };
}

interface ExecuteOptions {
  projectId: ObjectID;
  userNotificationLogId: ObjectID;
  userNotificationEventType: UserNotificationEventType;
  triggeredByIncidentId?: ObjectID | undefined;
  triggeredByAlertId?: ObjectID | undefined;
  triggeredByAlertEpisodeId?: ObjectID | undefined;
  triggeredByIncidentEpisodeId?: ObjectID | undefined;
  onCallPolicyExecutionLogId?: ObjectID | undefined;
  onCallPolicyId?: ObjectID | undefined;
  onCallPolicyEscalationRuleId?: ObjectID | undefined;
  userBelongsToTeamId?: ObjectID | undefined;
  onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
  onCallScheduleId?: ObjectID | undefined;
}

// A persisted UserOnCallLog row as onCreateSuccess receives it.
function makeCreatedLog(overrides: Record<string, unknown> = {}): Model {
  return {
    id: LOG_ID,
    _id: LOG_ID.toString(),
    projectId: PROJECT_ID,
    userId: USER_ID,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    onCallDutyPolicyExecutionLogTimelineId: TIMELINE_ID,
    onCallDutyPolicyExecutionLogId: EXECUTION_LOG_ID,
    onCallDutyPolicyId: POLICY_ID,
    onCallDutyPolicyEscalationRuleId: ESCALATION_RULE_ID,
    userBelongsToTeamId: TEAM_ID,
    onCallDutyScheduleId: SCHEDULE_ID,
    ...overrides,
  } as unknown as Model;
}

function makeRule(id: ObjectID): UserNotificationRule {
  return {
    id: id,
    _id: id.toString(),
  } as unknown as UserNotificationRule;
}

/*
 * The four shapes of on-call log the escalation machinery can produce, each
 * paired with the event type the caller sets and the severity id the hook is
 * supposed to thread into the rule count.
 */
const INCIDENT_LOG: Record<string, unknown> = {
  triggeredByIncidentId: INCIDENT_ID,
  userNotificationEventType: UserNotificationEventType.IncidentCreated,
};
const ALERT_LOG: Record<string, unknown> = {
  triggeredByAlertId: ALERT_ID,
  userNotificationEventType: UserNotificationEventType.AlertCreated,
};
const ALERT_EPISODE_LOG: Record<string, unknown> = {
  triggeredByAlertEpisodeId: ALERT_EPISODE_ID,
  userNotificationEventType: UserNotificationEventType.AlertEpisodeCreated,
};
const INCIDENT_EPISODE_LOG: Record<string, unknown> = {
  triggeredByIncidentEpisodeId: INCIDENT_EPISODE_ID,
  userNotificationEventType: UserNotificationEventType.IncidentEpisodeCreated,
};

// Call the protected hooks without widening the service's public surface.
function callOnCreateSuccess(createdItem: Model): Promise<Model> {
  const onCreate: OnCreate<Model> = {
    createBy: {
      data: createdItem,
      props: { isRoot: true },
    } as unknown as CreateBy<Model>,
    carryForward: null,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (UserOnCallLogService as any).onCreateSuccess(onCreate, createdItem);
}

function callOnUpdateSuccess(
  data: Record<string, unknown>,
): Promise<OnUpdate<Model>> {
  const onUpdate: OnUpdate<Model> = {
    updateBy: {
      query: { _id: LOG_ID.toString() },
      data: data,
      props: { isRoot: true },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<Model>,
    carryForward: null,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (UserOnCallLogService as any).onUpdateSuccess(onUpdate, [LOG_ID]);
}

function callOnBeforeCreate(
  createBy: CreateBy<Model>,
): Promise<OnCreate<Model>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (UserOnCallLogService as any).onBeforeCreate(createBy);
}

let logUpdateSpy: jest.SpyInstance;
let timelineUpdateSpy: jest.SpyInstance;
let countBySpy: jest.SpyInstance;
let ruleFindBySpy: jest.SpyInstance;
let executeRuleSpy: jest.SpyInstance;

function statusUpdates(): Array<StatusUpdateCall> {
  return logUpdateSpy.mock.calls.map(
    (call: Array<unknown>): StatusUpdateCall => {
      return call[0] as StatusUpdateCall;
    },
  );
}

function timelineUpdates(): Array<TimelineUpdateCall> {
  return timelineUpdateSpy.mock.calls.map(
    (call: Array<unknown>): TimelineUpdateCall => {
      return call[0] as TimelineUpdateCall;
    },
  );
}

beforeEach(() => {
  logUpdateSpy = jest
    .spyOn(UserOnCallLogService, "updateOneById")
    .mockResolvedValue(undefined as never);

  timelineUpdateSpy = jest
    .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);

  // Zero rules is the default for this file - it is the branch under test.
  countBySpy = jest
    .spyOn(UserNotificationRuleService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);

  ruleFindBySpy = jest
    .spyOn(UserNotificationRuleService, "findBy")
    .mockResolvedValue([] as never);

  executeRuleSpy = jest
    .spyOn(UserNotificationRuleService, "executeNotificationRuleItem")
    .mockResolvedValue(undefined as never);

  jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
    incidentSeverityId: INCIDENT_SEVERITY_ID,
  } as never);
  jest.spyOn(AlertService, "findOneById").mockResolvedValue({
    alertSeverityId: ALERT_SEVERITY_ID,
  } as never);
  jest.spyOn(AlertEpisodeService, "findOneById").mockResolvedValue({
    alertSeverityId: EPISODE_ALERT_SEVERITY_ID,
  } as never);
  jest.spyOn(IncidentEpisodeService, "findOneById").mockResolvedValue({
    incidentSeverityId: EPISODE_INCIDENT_SEVERITY_ID,
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * ------------------------------------------------------------------------- *
 * (A) onCreateSuccess - the "no rules" dead-end.
 * -------------------------------------------------------------------------
 */

describe("UserOnCallLogService.onCreateSuccess - zero matching notification rules", () => {
  /*
   * GAP C - Phase 1 inverts these assertions.
   *
   * Every test in this describe block asserts that a responder with no matching
   * rule is silently dropped: the log is marked Error, the timeline is marked
   * Error, and nothing at all is sent. That is today's behaviour and it is the
   * bug the readiness plan exists to fix.
   */

  test("the log is marked Error - a terminal status no worker re-selects", async () => {
    await callOnCreateSuccess(makeCreatedLog(INCIDENT_LOG));

    const updates: Array<StatusUpdateCall> = statusUpdates();

    /*
     * Two writes, in order: the hook first flips the freshly-created row to
     * Started, then - finding no rules - straight to Error.
     */
    expect(updates).toHaveLength(2);
    expect(updates[0]!.data.status).toBe(
      UserNotificationExecutionStatus.Started,
    );
    expect(updates[1]!.data.status).toBe(UserNotificationExecutionStatus.Error);
    expect(updates[1]!.id.toString()).toBe(LOG_ID.toString());
    expect(updates[1]!.props.isRoot).toBe(true);
  });

  test("the log's statusMessage is the exact setup-your-rules string", async () => {
    await callOnCreateSuccess(makeCreatedLog(INCIDENT_LOG));

    const updates: Array<StatusUpdateCall> = statusUpdates();

    expect(updates[1]!.data.statusMessage).toBe(NO_RULES_MESSAGE);
    // The message points at a settings page. Nothing emails the user it.
    expect(updates[1]!.data.statusMessage).toContain(
      "User Settings > On-Call Rules",
    );
  });

  test("the on-call timeline gets the SAME Error status and the SAME message", async () => {
    await callOnCreateSuccess(makeCreatedLog(INCIDENT_LOG));

    const timeline: Array<TimelineUpdateCall> = timelineUpdates();

    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.id.toString()).toBe(TIMELINE_ID.toString());
    expect(timeline[0]!.data.status).toBe(
      OnCallDutyExecutionLogTimelineStatus.Error,
    );
    expect(timeline[0]!.data.statusMessage).toBe(NO_RULES_MESSAGE);
    expect(timeline[0]!.props.isRoot).toBe(true);
  });

  test("executeNotificationRuleItem is NEVER called - the responder is not paged", async () => {
    await callOnCreateSuccess(makeCreatedLog(INCIDENT_LOG));

    expect(executeRuleSpy).not.toHaveBeenCalled();
  });

  test("the immediate-rule lookup is never even attempted (early return)", async () => {
    await callOnCreateSuccess(makeCreatedLog(INCIDENT_LOG));

    /*
     * countBy answered zero, so the hook returns before the notifyAfterMinutes
     * findBy. Any fallback added later has to live between those two points.
     */
    expect(countBySpy).toHaveBeenCalledTimes(1);
    expect(ruleFindBySpy).not.toHaveBeenCalled();
  });

  test("the hook returns the created item unchanged", async () => {
    const created: Model = makeCreatedLog(INCIDENT_LOG);

    const returned: Model = await callOnCreateSuccess(created);

    expect(returned).toBe(created);
  });

  test("the log never reaches Executing and the timeline never says Alert Sent", async () => {
    await callOnCreateSuccess(makeCreatedLog(INCIDENT_LOG));

    const sawExecuting: boolean = statusUpdates().some(
      (update: StatusUpdateCall): boolean => {
        return update.data.status === UserNotificationExecutionStatus.Executing;
      },
    );
    const sawAlertSent: boolean = timelineUpdates().some(
      (update: TimelineUpdateCall): boolean => {
        return update.data.statusMessage === "Alert Sent";
      },
    );

    expect(sawExecuting).toBe(false);
    expect(sawAlertSent).toBe(false);
  });
});

describe("UserOnCallLogService.onCreateSuccess - severity threading per trigger kind", () => {
  /*
   * Each trigger kind loads its own parent entity and threads THAT entity's
   * severity id into the rule count. Getting the wrong key here would count
   * rules for a severity the incident does not have, which reads as "no rules"
   * and lands in the same dead-end.
   */

  test.each<
    [
      string,
      Record<string, unknown>,
      NotificationRuleType,
      "incidentSeverityId" | "alertSeverityId",
      ObjectID,
    ]
  >([
    [
      "incident",
      INCIDENT_LOG,
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      "incidentSeverityId",
      INCIDENT_SEVERITY_ID,
    ],
    [
      "alert",
      ALERT_LOG,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      "alertSeverityId",
      ALERT_SEVERITY_ID,
    ],
    [
      "alert episode",
      ALERT_EPISODE_LOG,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      "alertSeverityId",
      EPISODE_ALERT_SEVERITY_ID,
    ],
    [
      "incident episode",
      INCIDENT_EPISODE_LOG,
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      "incidentSeverityId",
      EPISODE_INCIDENT_SEVERITY_ID,
    ],
  ])(
    "a %s-triggered log counts rules by its own severity, then dead-ends on zero",
    async (
      _label: string,
      overrides: Record<string, unknown>,
      expectedRuleType: NotificationRuleType,
      severityKey: "incidentSeverityId" | "alertSeverityId",
      expectedSeverityId: ObjectID,
    ): Promise<void> => {
      await callOnCreateSuccess(makeCreatedLog(overrides));

      expect(countBySpy).toHaveBeenCalledTimes(1);
      const call: RuleQueryCall = countBySpy.mock.calls[0]![0] as RuleQueryCall;

      expect(call.query.userId.toString()).toBe(USER_ID.toString());
      expect(call.query.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(call.query.ruleType).toBe(expectedRuleType);
      expect(call.query[severityKey]!.toString()).toBe(
        expectedSeverityId.toString(),
      );
      expect(call.skip).toBe(0);
      expect(call.limit).toBe(LIMIT_PER_PROJECT);
      expect(call.props.isRoot).toBe(true);

      // GAP C - Phase 1 inverts this: the zero-rule dead-end for every kind.
      const updates: Array<StatusUpdateCall> = statusUpdates();
      expect(updates[updates.length - 1]!.data.status).toBe(
        UserNotificationExecutionStatus.Error,
      );
      expect(updates[updates.length - 1]!.data.statusMessage).toBe(
        NO_RULES_MESSAGE,
      );
      expect(executeRuleSpy).not.toHaveBeenCalled();
    },
  );

  test("the count query carries only the severity key for its own trigger kind", async () => {
    await callOnCreateSuccess(makeCreatedLog(ALERT_LOG));

    const call: RuleQueryCall = countBySpy.mock.calls[0]![0] as RuleQueryCall;

    /*
     * An alert-triggered log queries alertSeverityId ONLY - incidentSeverityId
     * is not part of the object at all, so the count is not accidentally
     * narrowed by an incident severity.
     */
    expect(Object.keys(call.query).sort()).toEqual([
      "alertSeverityId",
      "projectId",
      "ruleType",
      "userId",
    ]);
  });

  test("a missing parent entity still dead-ends, with an undefined severity in the query", async () => {
    /*
     * findOneById returning null (deleted incident, or a read that raced the
     * write) makes `incident?.incidentSeverityId` undefined. Today that is
     * passed straight through as the query value rather than being treated as
     * an error, and the responder lands in the same silent dead-end.
     */
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null as never);

    await callOnCreateSuccess(makeCreatedLog(INCIDENT_LOG));

    const call: RuleQueryCall = countBySpy.mock.calls[0]![0] as RuleQueryCall;
    expect(call.query.incidentSeverityId).toBeUndefined();

    const updates: Array<StatusUpdateCall> = statusUpdates();
    expect(updates[updates.length - 1]!.data.status).toBe(
      UserNotificationExecutionStatus.Error,
    );
  });

  test("a log with no trigger id at all counts nothing and dead-ends", async () => {
    /*
     * ruleCount starts at PositiveNumber(0) and none of the four `if` blocks
     * run, so countBy is never called and the hook falls straight into the
     * zero-rule branch.
     */
    await callOnCreateSuccess(makeCreatedLog());

    expect(countBySpy).not.toHaveBeenCalled();
    const updates: Array<StatusUpdateCall> = statusUpdates();
    expect(updates[updates.length - 1]!.data.status).toBe(
      UserNotificationExecutionStatus.Error,
    );
    expect(executeRuleSpy).not.toHaveBeenCalled();
  });
});

describe("UserOnCallLogService.onCreateSuccess - at least one matching rule", () => {
  beforeEach(() => {
    countBySpy.mockResolvedValue(new PositiveNumber(1) as never);
    ruleFindBySpy.mockResolvedValue([makeRule(RULE_A_ID)] as never);
  });

  test("executeNotificationRuleItem is called once per immediate rule", async () => {
    ruleFindBySpy.mockResolvedValue([
      makeRule(RULE_A_ID),
      makeRule(RULE_B_ID),
    ] as never);

    await callOnCreateSuccess(makeCreatedLog(INCIDENT_LOG));

    expect(executeRuleSpy).toHaveBeenCalledTimes(2);
    expect((executeRuleSpy.mock.calls[0]![0] as ObjectID).toString()).toBe(
      RULE_A_ID.toString(),
    );
    expect((executeRuleSpy.mock.calls[1]![0] as ObjectID).toString()).toBe(
      RULE_B_ID.toString(),
    );
  });

  test("the log ends at Executing (with no statusMessage)", async () => {
    await callOnCreateSuccess(makeCreatedLog(INCIDENT_LOG));

    const updates: Array<StatusUpdateCall> = statusUpdates();

    expect(updates).toHaveLength(2);
    expect(updates[0]!.data.status).toBe(
      UserNotificationExecutionStatus.Started,
    );
    expect(updates[1]!.data.status).toBe(
      UserNotificationExecutionStatus.Executing,
    );
    expect(updates[1]!.data.statusMessage).toBeUndefined();
  });

  test("the timeline is set to NotificationSent / 'Alert Sent'", async () => {
    await callOnCreateSuccess(makeCreatedLog(INCIDENT_LOG));

    const timeline: Array<TimelineUpdateCall> = timelineUpdates();

    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.id.toString()).toBe(TIMELINE_ID.toString());
    expect(timeline[0]!.data.status).toBe(
      OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    );
    expect(timeline[0]!.data.statusMessage).toBe("Alert Sent");
  });

  test("every field of the executeNotificationRuleItem option bag is forwarded", async () => {
    const created: Model = makeCreatedLog({
      ...INCIDENT_LOG,
      triggeredByAlertId: ALERT_ID,
      triggeredByAlertEpisodeId: ALERT_EPISODE_ID,
      triggeredByIncidentEpisodeId: INCIDENT_EPISODE_ID,
    });

    await callOnCreateSuccess(created);

    expect(executeRuleSpy).toHaveBeenCalledTimes(1);
    const options: ExecuteOptions = executeRuleSpy.mock
      .calls[0]![1] as ExecuteOptions;

    /*
     * Exactly thirteen keys - four of them renamed on the way across
     * (onCallDutyPolicy* -> onCallPolicy*, onCallDutySchedule -> onCallSchedule).
     * A dropped key here is a page that cannot be attributed back to its
     * escalation rule.
     */
    expect(Object.keys(options).sort()).toEqual([
      "onCallDutyPolicyExecutionLogTimelineId",
      "onCallPolicyEscalationRuleId",
      "onCallPolicyExecutionLogId",
      "onCallPolicyId",
      "onCallScheduleId",
      "projectId",
      "triggeredByAlertEpisodeId",
      "triggeredByAlertId",
      "triggeredByIncidentEpisodeId",
      "triggeredByIncidentId",
      "userBelongsToTeamId",
      "userNotificationEventType",
      "userNotificationLogId",
    ]);

    expect(options.userNotificationLogId.toString()).toBe(LOG_ID.toString());
    expect(options.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(options.triggeredByIncidentId!.toString()).toBe(
      INCIDENT_ID.toString(),
    );
    expect(options.triggeredByAlertId!.toString()).toBe(ALERT_ID.toString());
    expect(options.triggeredByAlertEpisodeId!.toString()).toBe(
      ALERT_EPISODE_ID.toString(),
    );
    expect(options.triggeredByIncidentEpisodeId!.toString()).toBe(
      INCIDENT_EPISODE_ID.toString(),
    );
    expect(options.userNotificationEventType).toBe(
      UserNotificationEventType.IncidentCreated,
    );
    expect(options.onCallPolicyExecutionLogId!.toString()).toBe(
      EXECUTION_LOG_ID.toString(),
    );
    expect(options.onCallPolicyId!.toString()).toBe(POLICY_ID.toString());
    expect(options.onCallPolicyEscalationRuleId!.toString()).toBe(
      ESCALATION_RULE_ID.toString(),
    );
    expect(options.userBelongsToTeamId!.toString()).toBe(TEAM_ID.toString());
    expect(options.onCallDutyPolicyExecutionLogTimelineId!.toString()).toBe(
      TIMELINE_ID.toString(),
    );
    expect(options.onCallScheduleId!.toString()).toBe(SCHEDULE_ID.toString());
  });

  test("optional ids that are absent on the log are forwarded as undefined, not dropped", async () => {
    const created: Model = makeCreatedLog({
      ...INCIDENT_LOG,
      onCallDutyPolicyId: undefined,
      onCallDutyScheduleId: undefined,
      userBelongsToTeamId: undefined,
    });

    await callOnCreateSuccess(created);

    const options: ExecuteOptions = executeRuleSpy.mock
      .calls[0]![1] as ExecuteOptions;

    expect(Object.keys(options)).toContain("onCallPolicyId");
    expect(options.onCallPolicyId).toBeUndefined();
    expect(options.onCallScheduleId).toBeUndefined();
    expect(options.userBelongsToTeamId).toBeUndefined();
    // The two required ids are still there.
    expect(options.userNotificationLogId.toString()).toBe(LOG_ID.toString());
  });

  test("the immediate-rule query pins notifyAfterMinutes 0 and both severity keys", async () => {
    await callOnCreateSuccess(makeCreatedLog(INCIDENT_LOG));

    expect(ruleFindBySpy).toHaveBeenCalledTimes(1);
    const call: RuleQueryCall = ruleFindBySpy.mock
      .calls[0]![0] as RuleQueryCall;

    expect(call.query.notifyAfterMinutes).toBe(0);
    expect(call.query.ruleType).toBe(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    );
    expect(call.query.incidentSeverityId!.toString()).toBe(
      INCIDENT_SEVERITY_ID.toString(),
    );
    /*
     * Unlike the countBy query, the findBy query always carries BOTH severity
     * keys; the one that does not apply is present with an undefined value.
     */
    expect(Object.keys(call.query).sort()).toEqual([
      "alertSeverityId",
      "incidentSeverityId",
      "notifyAfterMinutes",
      "projectId",
      "ruleType",
      "userId",
    ]);
    expect(call.query.alertSeverityId).toBeUndefined();
    expect(call.limit).toBe(LIMIT_PER_PROJECT);
    expect(call.props.isRoot).toBe(true);
  });

  test("an alert-episode log resolves alertSeverityId from the episode", async () => {
    await callOnCreateSuccess(makeCreatedLog(ALERT_EPISODE_LOG));

    const call: RuleQueryCall = ruleFindBySpy.mock
      .calls[0]![0] as RuleQueryCall;

    expect(call.query.alertSeverityId!.toString()).toBe(
      EPISODE_ALERT_SEVERITY_ID.toString(),
    );
    expect(call.query.incidentSeverityId).toBeUndefined();
  });

  test("when a log carries both an alert and an alert episode, the alert wins", async () => {
    const created: Model = makeCreatedLog({
      ...ALERT_LOG,
      triggeredByAlertEpisodeId: ALERT_EPISODE_ID,
    });

    await callOnCreateSuccess(created);

    const call: RuleQueryCall = ruleFindBySpy.mock
      .calls[0]![0] as RuleQueryCall;

    // `alert && alert.alertSeverityId ? ... : alertEpisode ...` - alert first.
    expect(call.query.alertSeverityId!.toString()).toBe(
      ALERT_SEVERITY_ID.toString(),
    );
  });

  test("when a log carries both an incident and an incident episode, the incident wins", async () => {
    const created: Model = makeCreatedLog({
      ...INCIDENT_LOG,
      triggeredByIncidentEpisodeId: INCIDENT_EPISODE_ID,
    });

    await callOnCreateSuccess(created);

    const call: RuleQueryCall = ruleFindBySpy.mock
      .calls[0]![0] as RuleQueryCall;

    expect(call.query.incidentSeverityId!.toString()).toBe(
      INCIDENT_SEVERITY_ID.toString(),
    );
  });

  test("rules exist but none are immediate: nothing is sent, yet the log still says Executing", async () => {
    /*
     * The rule count includes DELAYED rules, so a user whose only rule is
     * "call me after 5 minutes" passes the zero-rule guard, sends nothing now,
     * and is left Executing for the worker to pick up on a later tick.
     */
    ruleFindBySpy.mockResolvedValue([] as never);

    await callOnCreateSuccess(makeCreatedLog(INCIDENT_LOG));

    expect(executeRuleSpy).not.toHaveBeenCalled();
    const updates: Array<StatusUpdateCall> = statusUpdates();
    expect(updates[updates.length - 1]!.data.status).toBe(
      UserNotificationExecutionStatus.Executing,
    );
    expect(timelineUpdates()[0]!.data.statusMessage).toBe("Alert Sent");
  });

  test("the created item is returned on the happy path too", async () => {
    const created: Model = makeCreatedLog(INCIDENT_LOG);

    const returned: Model = await callOnCreateSuccess(created);

    expect(returned).toBe(created);
  });
});

/*
 * ------------------------------------------------------------------------- *
 * (B) getNotificationRuleType - event type to rule type.
 * -------------------------------------------------------------------------
 */

describe("UserOnCallLogService.getNotificationRuleType", () => {
  test.each<[UserNotificationEventType, NotificationRuleType]>([
    [
      UserNotificationEventType.IncidentCreated,
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    ],
    [
      UserNotificationEventType.AlertCreated,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    ],
    [
      UserNotificationEventType.AlertEpisodeCreated,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    ],
    [
      UserNotificationEventType.IncidentEpisodeCreated,
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    ],
  ])(
    "%s maps to %s",
    (
      eventType: UserNotificationEventType,
      expected: NotificationRuleType,
    ): void => {
      expect(UserOnCallLogService.getNotificationRuleType(eventType)).toBe(
        expected,
      );
    },
  );

  test("every member of UserNotificationEventType is mapped (no silent hole)", () => {
    const eventTypes: Array<UserNotificationEventType> = Object.values(
      UserNotificationEventType,
    );

    expect(eventTypes).toHaveLength(4);

    for (const eventType of eventTypes) {
      expect(() => {
        return UserOnCallLogService.getNotificationRuleType(eventType);
      }).not.toThrow();
    }
  });

  test("an unknown event type throws BadDataException", () => {
    expect(() => {
      return UserOnCallLogService.getNotificationRuleType(
        "Something Else" as UserNotificationEventType,
      );
    }).toThrow(BadDataException);
  });

  test("the unknown-event-type message names the problem", () => {
    expect(() => {
      return UserOnCallLogService.getNotificationRuleType(
        undefined as unknown as UserNotificationEventType,
      );
    }).toThrow("Invalid user notification event type.");
  });

  test("the two non-on-call rule types are never produced by this mapping", () => {
    /*
     * WHEN_USER_GOES_ON_CALL / OFF_CALL rules exist on the same table. If this
     * mapping ever returned one, a shift-change rule would be counted as
     * incident coverage - the exact confusion the plan flags in Gap E for
     * TeamComplianceService, which ignores ruleType altogether.
     */
    const produced: Array<NotificationRuleType> = Object.values(
      UserNotificationEventType,
    ).map((eventType: UserNotificationEventType): NotificationRuleType => {
      return UserOnCallLogService.getNotificationRuleType(eventType);
    });

    expect(produced).not.toContain(NotificationRuleType.WHEN_USER_GOES_ON_CALL);
    expect(produced).not.toContain(
      NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
    );
    expect(new Set(produced).size).toBe(4);
  });
});

/*
 * ------------------------------------------------------------------------- *
 * (C) onUpdateSuccess - execution status to timeline status.
 * -------------------------------------------------------------------------
 */

describe("UserOnCallLogService.onUpdateSuccess - status translation", () => {
  let logFindBySpy: jest.SpyInstance;

  beforeEach(() => {
    logFindBySpy = jest
      .spyOn(UserOnCallLogService, "findBy")
      .mockResolvedValue([
        {
          onCallDutyPolicyExecutionLogTimelineId: TIMELINE_ID,
        },
      ] as never);
  });

  test.each<
    [UserNotificationExecutionStatus, OnCallDutyExecutionLogTimelineStatus]
  >([
    [
      UserNotificationExecutionStatus.Completed,
      OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    ],
    [
      UserNotificationExecutionStatus.Error,
      OnCallDutyExecutionLogTimelineStatus.Error,
    ],
    [
      UserNotificationExecutionStatus.Executing,
      OnCallDutyExecutionLogTimelineStatus.Executing,
    ],
    [
      UserNotificationExecutionStatus.Scheduled,
      OnCallDutyExecutionLogTimelineStatus.Started,
    ],
    [
      UserNotificationExecutionStatus.Started,
      OnCallDutyExecutionLogTimelineStatus.Started,
    ],
  ])(
    "%s on the log becomes %s on the timeline",
    async (
      status: UserNotificationExecutionStatus,
      expected: OnCallDutyExecutionLogTimelineStatus,
    ): Promise<void> => {
      await callOnUpdateSuccess({ status: status });

      expect(timelineUpdateSpy).toHaveBeenCalledTimes(1);
      const call: TimelineUpdateCall = timelineUpdates()[0]!;
      expect(call.data.status).toBe(expected);
      expect(call.id.toString()).toBe(TIMELINE_ID.toString());
      expect(call.props.isRoot).toBe(true);
    },
  );

  test("Scheduled and Started collapse to the same timeline status", async () => {
    /*
     * Two distinct execution states share one timeline state, so an operator
     * reading the timeline cannot tell "queued" from "picked up". Pinned so a
     * later change that splits them is a deliberate one.
     */
    await callOnUpdateSuccess({
      status: UserNotificationExecutionStatus.Scheduled,
    });
    await callOnUpdateSuccess({
      status: UserNotificationExecutionStatus.Started,
    });

    const written: Array<OnCallDutyExecutionLogTimelineStatus | undefined> =
      timelineUpdates().map(
        (
          call: TimelineUpdateCall,
        ): OnCallDutyExecutionLogTimelineStatus | undefined => {
          return call.data.status;
        },
      );

    expect(written).toEqual([
      OnCallDutyExecutionLogTimelineStatus.Started,
      OnCallDutyExecutionLogTimelineStatus.Started,
    ]);
  });

  test("every member of UserNotificationExecutionStatus has a case - the default is unreachable for valid members", async () => {
    /*
     * The enum has exactly five members and the switch has exactly five cases,
     * so `default: throw new BadDataException("Invalid status")` cannot be hit
     * by a value that came out of the enum. It is reachable only when a caller
     * pushes a string that was never a member (an API payload, a migration, or
     * a cast) into `data.status`.
     */
    const all: Array<UserNotificationExecutionStatus> = Object.values(
      UserNotificationExecutionStatus,
    );

    expect(all.sort()).toEqual([
      UserNotificationExecutionStatus.Completed,
      UserNotificationExecutionStatus.Error,
      UserNotificationExecutionStatus.Executing,
      UserNotificationExecutionStatus.Scheduled,
      UserNotificationExecutionStatus.Started,
    ]);

    for (const status of all) {
      await expect(
        callOnUpdateSuccess({ status: status }),
      ).resolves.toBeDefined();
    }

    expect(timelineUpdateSpy).toHaveBeenCalledTimes(all.length);
  });

  test("a status that is not an enum member throws BadDataException", async () => {
    await expect(
      callOnUpdateSuccess({ status: "Cancelled" }),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  test("the invalid-status throw happens AFTER the row lookup and writes no timeline", async () => {
    /*
     * findBy runs before the switch, so an invalid status costs a query and
     * then aborts the whole update hook with nothing written.
     */
    await expect(callOnUpdateSuccess({ status: "Cancelled" })).rejects.toThrow(
      "Invalid status",
    );

    expect(logFindBySpy).toHaveBeenCalledTimes(1);
    expect(timelineUpdateSpy).not.toHaveBeenCalled();
  });

  test("an update without a status is a no-op: no lookup, no timeline write", async () => {
    await callOnUpdateSuccess({ statusMessage: "just a note" });

    expect(logFindBySpy).not.toHaveBeenCalled();
    expect(timelineUpdateSpy).not.toHaveBeenCalled();
  });

  test("the statusMessage rides along to the timeline verbatim", async () => {
    await callOnUpdateSuccess({
      status: UserNotificationExecutionStatus.Error,
      statusMessage: NO_RULES_MESSAGE,
    });

    expect(timelineUpdates()[0]!.data.statusMessage).toBe(NO_RULES_MESSAGE);
  });

  test("a status update with no statusMessage writes undefined over whatever the timeline had", async () => {
    /*
     * `statusMessage: onUpdate.updateBy.data.statusMessage!` is unconditional,
     * so a bare status change blanks the timeline's existing message rather
     * than leaving it alone.
     */
    await callOnUpdateSuccess({
      status: UserNotificationExecutionStatus.Executing,
    });

    const call: TimelineUpdateCall = timelineUpdates()[0]!;
    expect(Object.keys(call.data)).toContain("statusMessage");
    expect(call.data.statusMessage).toBeUndefined();
  });

  test("every matched log row gets its own timeline update", async () => {
    const otherTimelineId: ObjectID = new ObjectID(
      "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a",
    );

    logFindBySpy.mockResolvedValue([
      { onCallDutyPolicyExecutionLogTimelineId: TIMELINE_ID },
      { onCallDutyPolicyExecutionLogTimelineId: otherTimelineId },
    ] as never);

    await callOnUpdateSuccess({
      status: UserNotificationExecutionStatus.Completed,
    });

    expect(timelineUpdateSpy).toHaveBeenCalledTimes(2);
    expect(
      timelineUpdates().map((call: TimelineUpdateCall): string => {
        return call.id.toString();
      }),
    ).toEqual([TIMELINE_ID.toString(), otherTimelineId.toString()]);
  });

  test("no matching log rows means no timeline updates at all", async () => {
    logFindBySpy.mockResolvedValue([] as never);

    await callOnUpdateSuccess({
      status: UserNotificationExecutionStatus.Completed,
    });

    expect(timelineUpdateSpy).not.toHaveBeenCalled();
  });

  test("a log row with no timeline id still issues an update, with an undefined id", async () => {
    /*
     * `id: item.onCallDutyPolicyExecutionLogTimelineId!` is a non-null
     * assertion over a genuinely optional column. Today the call is made with
     * `undefined` and the failure surfaces downstream rather than here.
     */
    logFindBySpy.mockResolvedValue([{}] as never);

    await callOnUpdateSuccess({
      status: UserNotificationExecutionStatus.Completed,
    });

    expect(timelineUpdateSpy).toHaveBeenCalledTimes(1);
    expect(timelineUpdates()[0]!.id).toBeUndefined();
  });

  test("the row lookup reuses the caller's query and selects only the timeline id", async () => {
    await callOnUpdateSuccess({
      status: UserNotificationExecutionStatus.Completed,
    });

    const call: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      skip: number;
      limit: number;
      props: { isRoot: boolean };
    } = logFindBySpy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      skip: number;
      limit: number;
      props: { isRoot: boolean };
    };

    expect(call.query["_id"]).toBe(LOG_ID.toString());
    expect(call.select["onCallDutyPolicyExecutionLogTimelineId"]).toBe(true);
    expect(call.skip).toBe(0);
    expect(call.limit).toBe(LIMIT_PER_PROJECT);
    expect(call.props.isRoot).toBe(true);
  });

  test("the hook returns the onUpdate it was handed", async () => {
    const returned: OnUpdate<Model> = await callOnUpdateSuccess({
      status: UserNotificationExecutionStatus.Completed,
    });

    expect(returned.updateBy.data.status).toBe(
      UserNotificationExecutionStatus.Completed,
    );
  });
});

/*
 * ------------------------------------------------------------------------- *
 * (D) onBeforeCreate - the status stamp.
 * -------------------------------------------------------------------------
 */

describe("UserOnCallLogService.onBeforeCreate - status is always Scheduled", () => {
  function createBy(data: Record<string, unknown>): CreateBy<Model> {
    return {
      data: data as unknown as Model,
      props: { isRoot: true },
    } as unknown as CreateBy<Model>;
  }

  test("a create with no status is stamped Scheduled", async () => {
    const create: CreateBy<Model> = createBy({ projectId: PROJECT_ID });

    await callOnBeforeCreate(create);

    expect(create.data.status).toBe(UserNotificationExecutionStatus.Scheduled);
  });

  test.each<[UserNotificationExecutionStatus]>([
    [UserNotificationExecutionStatus.Started],
    [UserNotificationExecutionStatus.Executing],
    [UserNotificationExecutionStatus.Completed],
    [UserNotificationExecutionStatus.Error],
  ])(
    "a caller asking for %s is overridden back to Scheduled",
    async (status: UserNotificationExecutionStatus): Promise<void> => {
      /*
       * A row created already Completed (or already Error) would never be
       * picked up by ExecutePendingExecutions, so this stamp is what guarantees
       * the escalation actually enters the pipeline.
       */
      const create: CreateBy<Model> = createBy({ status: status });

      await callOnBeforeCreate(create);

      expect(create.data.status).toBe(
        UserNotificationExecutionStatus.Scheduled,
      );
    },
  );

  test("a nonsense status string is also overridden", async () => {
    const create: CreateBy<Model> = createBy({ status: "Whatever" });

    await callOnBeforeCreate(create);

    expect(create.data.status).toBe(UserNotificationExecutionStatus.Scheduled);
  });

  test("the hook returns the same createBy with a null carryForward", async () => {
    const create: CreateBy<Model> = createBy({ projectId: PROJECT_ID });

    const result: OnCreate<Model> = await callOnBeforeCreate(create);

    expect(result.createBy).toBe(create);
    expect(result.carryForward).toBeNull();
  });

  test("nothing else on the create payload is touched", async () => {
    const create: CreateBy<Model> = createBy({
      projectId: PROJECT_ID,
      userId: USER_ID,
      statusMessage: "set by caller",
    });

    await callOnBeforeCreate(create);

    expect(create.data.projectId).toBe(PROJECT_ID);
    expect(create.data.userId).toBe(USER_ID);
    expect(create.data.statusMessage).toBe("set by caller");
  });
});
