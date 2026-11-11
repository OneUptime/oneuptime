import UserOnCallLogService, {
  NOT_A_PROJECT_MEMBER_STATUS_MESSAGE,
  NO_NOTIFICATION_RULES_STATUS_MESSAGE,
} from "../../../Server/Services/UserOnCallLogService";
import UserNotificationRuleService, {
  FallbackNotificationOutcome,
} from "../../../Server/Services/UserNotificationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallNotificationAlertingService from "../../../Server/Services/OnCallNotificationAlertingService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import logger from "../../../Server/Utils/Logger";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import Model from "../../../Models/DatabaseModels/UserOnCallLog";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  ON_CALL_TEST_PAGE_RULES_RAN_MESSAGE,
  ON_CALL_TEST_PAGE_RUN_UNREADABLE_MESSAGE,
  OnCallTestPageRecordKind,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import { expectUserIdWhileMember } from "../TestingUtils/MembershipCondition";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A TEST PAGE, FOR ONE PERSON (UserOnCallLogService.runTestPageRules).
 *
 * A test page's log has no record to read a severity from: its run says
 * which kind of page and which severity it stands in for. The person's
 * rules for that cell are the rules a real page runs (getPagingRulesQuery),
 * and they all run now, in the order a real page would reach them - so a
 * test proves exactly the methods and order of a real page, without the
 * waits. With no rule, it is a real page's no-rule path - only nobody else
 * is told a page could not be delivered: the test's result says it.
 */

const LOG_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const STEP_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const RUN_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const POLICY_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

const ruleId: (n: number) => ObjectID = (n: number): ObjectID => {
  return new ObjectID(`f0f0f0f0-f0f0-4f0f-8f0f-${String(n).padStart(12, "0")}`);
};

interface StoredRule {
  id: ObjectID;
  ruleType: NotificationRuleType;
  incidentSeverityId?: ObjectID | undefined;
  alertSeverityId?: ObjectID | undefined;
  notifyAfterMinutes: number;
}

/*
 * One person's rules, as the database holds them: a cell of incident rules
 * for one severity (now, 5 minutes, 10 minutes), another severity's, and an
 * alert rule - read in the order they were written, not the order a page
 * reaches them.
 */
const STORED_RULES: Array<StoredRule> = [
  {
    id: ruleId(1),
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    incidentSeverityId: INCIDENT_SEVERITY_ID,
    notifyAfterMinutes: 10,
  },
  {
    id: ruleId(2),
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    incidentSeverityId: INCIDENT_SEVERITY_ID,
    notifyAfterMinutes: 0,
  },
  {
    id: ruleId(3),
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    incidentSeverityId: INCIDENT_SEVERITY_ID,
    notifyAfterMinutes: 5,
  },
  {
    id: ruleId(4),
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    incidentSeverityId: new ObjectID("12121212-1212-4121-8121-121212121212"),
    notifyAfterMinutes: 0,
  },
  {
    id: ruleId(5),
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    alertSeverityId: ALERT_SEVERITY_ID,
    notifyAfterMinutes: 0,
  },
];

interface RuleQuery {
  userId: unknown;
  projectId: ObjectID;
  ruleType: NotificationRuleType;
  incidentSeverityId?: ObjectID | undefined;
  alertSeverityId?: ObjectID | undefined;
  notifyAfterMinutes?: number | undefined;
  isOptOut?: unknown;
}

// The rows a query of a person's rules selects, as the database would.
function select(query: RuleQuery): Array<StoredRule> {
  return STORED_RULES.filter((rule: StoredRule): boolean => {
    if (rule.ruleType !== query.ruleType) {
      return false;
    }

    if (
      query.incidentSeverityId &&
      rule.incidentSeverityId?.toString() !==
        query.incidentSeverityId.toString()
    ) {
      return false;
    }

    if (
      query.alertSeverityId &&
      rule.alertSeverityId?.toString() !== query.alertSeverityId.toString()
    ) {
      return false;
    }

    if (
      query.notifyAfterMinutes !== undefined &&
      rule.notifyAfterMinutes !== query.notifyAfterMinutes
    ) {
      return false;
    }

    return true;
  });
}

/*
 * A raw condition as the SQL it renders and the values it binds, with its
 * random parameter names numbered: two conditions built alike read alike.
 */
function describeCondition(value: unknown): string {
  if (!(value instanceof FindOperator) || typeof value.getSql !== "function") {
    return JSON.stringify(value);
  }

  const parameters: Record<string, unknown> =
    (value.objectLiteralParameters as Record<string, unknown> | undefined) ||
    {};
  let sql: string = (value.getSql as (alias: string) => string)("column");

  Object.keys(parameters).forEach((name: string, index: number): void => {
    sql = sql.split(`:...${name}`).join(`:...p${index}`);
    sql = sql.split(`:${name}`).join(`:p${index}`);
  });

  return JSON.stringify({ sql: sql, values: Object.values(parameters) });
}

function makeLog(overrides: Record<string, unknown> = {}): Model {
  return {
    id: LOG_ID,
    _id: LOG_ID.toString(),
    projectId: PROJECT_ID,
    userId: USER_ID,
    userNotificationEventType: UserNotificationEventType.TestPage,
    onCallDutyPolicyExecutionLogTimelineId: STEP_ID,
    onCallDutyPolicyExecutionLogId: RUN_ID,
    onCallDutyPolicyId: POLICY_ID,
    ...overrides,
  } as unknown as Model;
}

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

function armRun(run: Record<string, unknown> | null): void {
  (
    OnCallDutyPolicyExecutionLogService.findOneById as jest.Mock
  ).mockResolvedValue((run ? { id: RUN_ID, ...run } : null) as never);
}

let findBySpy: jest.SpyInstance;
let executeSpy: jest.SpyInstance;
let updateOneBySpy: jest.SpyInstance;
let logUpdateSpy: jest.SpyInstance;
let stepUpdateSpy: jest.SpyInstance;
let alertingSpy: jest.SpyInstance;
let fallbackSpy: jest.SpyInstance;
let optOutSpy: jest.SpyInstance;
let membershipSpy: jest.SpyInstance;
let projectSpy: jest.SpyInstance;
let timelineCreateSpy: jest.SpyInstance;

beforeEach(() => {
  logUpdateSpy = jest
    .spyOn(UserOnCallLogService, "updateOneById")
    .mockResolvedValue(undefined as never);
  updateOneBySpy = jest
    .spyOn(UserOnCallLogService, "updateOneBy")
    .mockResolvedValue(undefined as never);
  stepUpdateSpy = jest
    .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
    .mockResolvedValue(null as never);
  armRun({
    testPageRecordKind: OnCallTestPageRecordKind.Incident,
    testPageSeverityId: INCIDENT_SEVERITY_ID,
  });

  findBySpy = jest
    .spyOn(UserNotificationRuleService, "findBy")
    .mockImplementation(
      (findBy: unknown): Promise<Array<UserNotificationRule>> => {
        const query: RuleQuery = (findBy as { query: RuleQuery }).query;
        return Promise.resolve(
          select(query).map((rule: StoredRule): UserNotificationRule => {
            return {
              id: rule.id,
              notifyAfterMinutes: rule.notifyAfterMinutes,
            } as unknown as UserNotificationRule;
          }),
        );
      },
    );

  jest
    .spyOn(UserNotificationRuleService, "countBy")
    .mockImplementation((countBy: unknown): Promise<PositiveNumber> => {
      return Promise.resolve(
        new PositiveNumber(
          select((countBy as { query: RuleQuery }).query).length,
        ),
      );
    });

  executeSpy = jest
    .spyOn(UserNotificationRuleService, "executeNotificationRuleItem")
    .mockResolvedValue(undefined as never);

  optOutSpy = jest
    .spyOn(UserNotificationRuleService, "findOneBy")
    .mockResolvedValue(null as never);

  fallbackSpy = jest
    .spyOn(UserNotificationRuleService, "executeFallbackNotification")
    .mockResolvedValue({
      outcome: FallbackNotificationOutcome.Delivered,
      notified: true,
      channelsUsed: ["Email"],
    } as never);

  alertingSpy = jest
    .spyOn(OnCallNotificationAlertingService, "notifyOfUndeliverablePage")
    .mockResolvedValue(undefined as never);

  membershipSpy = jest
    .spyOn(ProjectMembership, "isMember")
    .mockResolvedValue(true as never);

  projectSpy = jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue({ disableOnCallNotificationFallback: false } as never);

  jest
    .spyOn(IncidentSeverityService, "findOneById")
    .mockResolvedValue({ name: "Critical" } as never);
  jest
    .spyOn(AlertSeverityService, "findOneById")
    .mockResolvedValue({ name: "High" } as never);
  jest
    .spyOn(UserService, "findOneById")
    .mockResolvedValue({ name: "Ana Lopez" } as never);
  jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
    incidentSeverityId: INCIDENT_SEVERITY_ID,
    incidentSeverity: { name: "Critical" },
  } as never);

  timelineCreateSpy = jest
    .spyOn(UserOnCallLogTimelineService, "create")
    .mockImplementation((createBy: unknown): Promise<UserOnCallLogTimeline> => {
      return Promise.resolve(
        (createBy as { data: UserOnCallLogTimeline }).data,
      );
    });

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function executedRuleIds(): Array<string> {
  return executeSpy.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as ObjectID).toString();
  });
}

describe("a test page runs every rule of its cell at once", () => {
  test("in the order a real page reaches them: now, then 5 minutes, then 10", async () => {
    await callOnCreateSuccess(makeLog());

    expect(executedRuleIds()).toEqual([
      ruleId(2).toString(),
      ruleId(3).toString(),
      ruleId(1).toString(),
    ]);
  });

  test("each with the test's options: its event type, its run, its step, and no record", async () => {
    await callOnCreateSuccess(makeLog());

    for (const call of executeSpy.mock.calls) {
      const options: Record<string, unknown> = call[1] as Record<
        string,
        unknown
      >;

      expect(options["userNotificationEventType"]).toBe(
        UserNotificationEventType.TestPage,
      );
      expect(options["userNotificationLogId"]).toBe(LOG_ID);
      expect(options["onCallPolicyExecutionLogId"]).toBe(RUN_ID);
      expect(options["onCallDutyPolicyExecutionLogTimelineId"]).toBe(STEP_ID);
      expect(options["onCallPolicyId"]).toBe(POLICY_ID);
      expect(options["triggeredByIncidentId"]).toBeUndefined();
      expect(options["triggeredByAlertId"]).toBeUndefined();
      // Never a repeat: a test sends each rule once.
      expect(options["repeatNumber"]).toBeUndefined();
    }
  });

  test("reads the person's rules of the kind and severity its run names, opt-outs left out, while a member", async () => {
    await callOnCreateSuccess(makeLog());

    const query: RuleQuery = (
      findBySpy.mock.calls[0]![0] as { query: RuleQuery }
    ).query;

    expect(query.ruleType).toBe(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT);
    expect(query.incidentSeverityId?.toString()).toBe(
      INCIDENT_SEVERITY_ID.toString(),
    );
    expect(query.alertSeverityId).toBeUndefined();
    // Every rule of the cell: no notifyAfterMinutes filter.
    expect(query.notifyAfterMinutes).toBeUndefined();
    expect(query.isOptOut).toBeDefined();
    expectUserIdWhileMember(query.userId, {
      userId: USER_ID,
      projectId: PROJECT_ID,
    });
  });

  test("an alert's test runs the alert rules of its severity", async () => {
    armRun({
      testPageRecordKind: OnCallTestPageRecordKind.Alert,
      testPageSeverityId: ALERT_SEVERITY_ID,
    });

    await callOnCreateSuccess(makeLog());

    expect(executedRuleIds()).toEqual([ruleId(5).toString()]);

    const query: RuleQuery = (
      findBySpy.mock.calls[0]![0] as { query: RuleQuery }
    ).query;
    expect(query.ruleType).toBe(NotificationRuleType.ON_CALL_EXECUTED_ALERT);
    expect(query.alertSeverityId?.toString()).toBe(
      ALERT_SEVERITY_ID.toString(),
    );
    expect(query.incidentSeverityId).toBeUndefined();
  });

  test("then the log is complete - unless somebody acknowledged it while its rules ran", async () => {
    await callOnCreateSuccess(makeLog());

    expect(updateOneBySpy).toHaveBeenCalledTimes(1);

    const updateBy: {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
    } = updateOneBySpy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
    };

    expect(updateBy.query["_id"]).toBe(LOG_ID.toString());
    // Only while nobody acknowledged it: their words stay as they are.
    expect(updateBy.query["acknowledgedAt"]).toBeDefined();
    expect(updateBy.data).toEqual({
      status: UserNotificationExecutionStatus.Completed,
      statusMessage: ON_CALL_TEST_PAGE_RULES_RAN_MESSAGE,
    });
  });

  test("a rule that fails says so on the person's timeline, and the others still run", async () => {
    executeSpy.mockImplementation((id: unknown): Promise<void> => {
      if ((id as ObjectID).toString() === ruleId(3).toString()) {
        return Promise.reject(new Error("Notification rule item not found."));
      }

      return Promise.resolve();
    });

    await callOnCreateSuccess(makeLog());

    expect(executedRuleIds()).toHaveLength(3);

    const row: UserOnCallLogTimeline = (
      timelineCreateSpy.mock.calls[0]![0] as { data: UserOnCallLogTimeline }
    ).data;

    expect(row.status).toBe(UserNotificationStatus.Error);
    expect(row.statusMessage).toBe("Notification rule item not found.");
    expect(row.userNotificationRuleId?.toString()).toBe(ruleId(3).toString());
    expect(row.userNotificationEventType).toBe(
      UserNotificationEventType.TestPage,
    );
    expect(row.onCallDutyPolicyExecutionLogTimelineId).toBe(STEP_ID);
    // The log still completes.
    expect(updateOneBySpy).toHaveBeenCalledTimes(1);
  });

  test("a run that does not say what it tests sends nothing, and says why", async () => {
    armRun({ testPageRecordKind: undefined, testPageSeverityId: undefined });

    await callOnCreateSuccess(makeLog());

    expect(executeSpy).not.toHaveBeenCalled();
    expect(logUpdateSpy).toHaveBeenLastCalledWith({
      id: LOG_ID,
      data: {
        status: UserNotificationExecutionStatus.Error,
        statusMessage: ON_CALL_TEST_PAGE_RUN_UNREADABLE_MESSAGE,
      },
      props: { isRoot: true, ignoreHooks: true },
    });
    expect(stepUpdateSpy).toHaveBeenCalledWith({
      id: STEP_ID,
      data: {
        status: OnCallDutyExecutionLogTimelineStatus.Error,
        statusMessage: ON_CALL_TEST_PAGE_RUN_UNREADABLE_MESSAGE,
      },
      props: { isRoot: true },
    });
  });
});

describe("a test page uses exactly the methods and order a real page of that severity would", () => {
  test("the same rules: a real page's immediate ones now, the rest as they come due - a test's all at once", async () => {
    /*
     * A real incident page of the severity: its log runs the immediate
     * rules as it is written (notifyAfterMinutes 0), and the worker runs
     * the rest as they come due, reading them with getPagingRulesQuery.
     */
    await callOnCreateSuccess(
      makeLog({
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
        triggeredByIncidentId: INCIDENT_ID,
      }),
    );

    const realImmediate: Array<string> = executedRuleIds();
    const realImmediateQuery: RuleQuery = (
      findBySpy.mock.calls[0]![0] as { query: RuleQuery }
    ).query;

    const realLater: Array<string> = select(
      UserOnCallLogService.getPagingRulesQuery({
        userId: USER_ID,
        projectId: PROJECT_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: INCIDENT_SEVERITY_ID,
      }) as unknown as RuleQuery,
    )
      .sort((a: StoredRule, b: StoredRule): number => {
        return a.notifyAfterMinutes - b.notifyAfterMinutes;
      })
      .filter((rule: StoredRule): boolean => {
        return rule.notifyAfterMinutes > 0;
      })
      .map((rule: StoredRule): string => {
        return rule.id.toString();
      });

    executeSpy.mockClear();
    findBySpy.mockClear();

    // The test page of the same kind and severity.
    await callOnCreateSuccess(makeLog());

    const testRun: Array<string> = executedRuleIds();
    const testQuery: RuleQuery = (
      findBySpy.mock.calls[0]![0] as { query: RuleQuery }
    ).query;

    expect(testRun).toEqual([...realImmediate, ...realLater]);

    // The same read, but for the waits.
    expect(testQuery.ruleType).toBe(realImmediateQuery.ruleType);
    expect(testQuery.incidentSeverityId?.toString()).toBe(
      realImmediateQuery.incidentSeverityId?.toString(),
    );
    expect(testQuery.projectId).toBe(realImmediateQuery.projectId);
    expect(realImmediateQuery.notifyAfterMinutes).toBe(0);
    expect(testQuery.notifyAfterMinutes).toBeUndefined();
    expect(describeCondition(testQuery.isOptOut)).toBe(
      describeCondition(realImmediateQuery.isOptOut),
    );
    expect(describeCondition(testQuery.isOptOut)).toBe(
      '{"sql":"(column NOT IN (:...p0) or column IS NULL)","values":[["true"]]}',
    );
  });

  test("getPagingRulesQuery is the cell a real page counts: the membership condition, the kind, the severity, no opt-outs", () => {
    const query: RuleQuery = UserOnCallLogService.getPagingRulesQuery({
      userId: USER_ID,
      projectId: PROJECT_ID,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      alertSeverityId: ALERT_SEVERITY_ID,
    }) as unknown as RuleQuery;

    expectUserIdWhileMember(query.userId, {
      userId: USER_ID,
      projectId: PROJECT_ID,
    });
    expect(query.projectId).toBe(PROJECT_ID);
    expect(query.ruleType).toBe(NotificationRuleType.ON_CALL_EXECUTED_ALERT);
    expect(query.alertSeverityId).toBe(ALERT_SEVERITY_ID);
    expect(query.incidentSeverityId).toBeUndefined();
    expect(query.isOptOut).toBeDefined();
  });
});

describe("a test page with no rule for its severity takes a real page's no-rule path", () => {
  beforeEach(() => {
    armRun({
      testPageRecordKind: OnCallTestPageRecordKind.Incident,
      // A severity nobody has a rule for.
      testPageSeverityId: new ObjectID("abababab-abab-4bab-8bab-abababababab"),
    });
  });

  test("the person's verified methods are paged, as a real page's fallback pages them - with the test's event type", async () => {
    await callOnCreateSuccess(makeLog());

    expect(executeSpy).not.toHaveBeenCalled();
    expect(fallbackSpy).toHaveBeenCalledTimes(1);

    const fallbackOptions: Record<string, unknown> = fallbackSpy.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(fallbackOptions["userNotificationEventType"]).toBe(
      UserNotificationEventType.TestPage,
    );
    expect(fallbackOptions["ruleType"]).toBe(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    );
    expect(fallbackOptions["severityName"]).toBe("Critical");
  });

  test("nobody else is told a page could not be delivered: the test's result says it", async () => {
    fallbackSpy.mockResolvedValue({
      outcome: FallbackNotificationOutcome.NoUsableNotificationMethod,
      notified: false,
      channelsUsed: [],
    } as never);

    await callOnCreateSuccess(makeLog());

    expect(alertingSpy).not.toHaveBeenCalled();
  });

  test("a real page in the same plight still tells its owners (regression)", async () => {
    fallbackSpy.mockResolvedValue({
      outcome: FallbackNotificationOutcome.NoUsableNotificationMethod,
      notified: false,
      channelsUsed: [],
    } as never);

    (IncidentService.findOneById as jest.Mock).mockResolvedValue({
      incidentSeverityId: new ObjectID("abababab-abab-4bab-8bab-abababababab"),
      incidentSeverity: { name: "Low" },
    } as never);

    await callOnCreateSuccess(
      makeLog({
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
        triggeredByIncidentId: INCIDENT_ID,
      }),
    );

    expect(alertingSpy).toHaveBeenCalledTimes(1);
  });

  test("a project that turned the fallback off gets its error, and nobody else is told", async () => {
    projectSpy.mockResolvedValue({
      disableOnCallNotificationFallback: true,
    } as never);

    await callOnCreateSuccess(makeLog());

    expect(fallbackSpy).not.toHaveBeenCalled();
    expect(stepUpdateSpy).toHaveBeenCalledWith({
      id: STEP_ID,
      data: {
        status: OnCallDutyExecutionLogTimelineStatus.Error,
        statusMessage: NO_NOTIFICATION_RULES_STATUS_MESSAGE,
      },
      props: { isRoot: true },
    });
    expect(alertingSpy).not.toHaveBeenCalled();
  });

  test("an opt-out is honoured: nothing is sent, and the step says so", async () => {
    optOutSpy.mockResolvedValue({ id: ruleId(9) } as never);

    await callOnCreateSuccess(makeLog());

    expect(fallbackSpy).not.toHaveBeenCalled();
    expect(stepUpdateSpy).toHaveBeenCalledWith({
      id: STEP_ID,
      data: {
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        statusMessage:
          "You have opted out of notifications for Critical incidents.",
      },
      props: { isRoot: true },
    });
  });

  test("somebody who is not a member is skipped, and no method of theirs is read", async () => {
    membershipSpy.mockResolvedValue(false as never);

    await callOnCreateSuccess(makeLog());

    expect(fallbackSpy).not.toHaveBeenCalled();
    expect(stepUpdateSpy).toHaveBeenCalledWith({
      id: STEP_ID,
      data: {
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        statusMessage: NOT_A_PROJECT_MEMBER_STATUS_MESSAGE,
      },
      props: { isRoot: true },
    });
  });
});

describe("a real page is as it was", () => {
  test("an incident page still runs only its immediate rules as its log is written", async () => {
    await callOnCreateSuccess(
      makeLog({
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
        triggeredByIncidentId: INCIDENT_ID,
      }),
    );

    expect(executedRuleIds()).toEqual([ruleId(2).toString()]);
    expect(updateOneBySpy).not.toHaveBeenCalled();
  });
});
