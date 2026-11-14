import ObjectID from "Common/Types/ObjectID";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import UserOnCallLogService from "Common/Server/Services/UserOnCallLogService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import AlertService from "Common/Server/Services/AlertService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import logger from "Common/Server/Utils/Logger";
import OnCallAcknowledgementTimeout from "Common/Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A TEST PAGE'S LOG ON THE WORKER THAT SENDS A PERSON'S NOTIFICATIONS
 * (OnCallTestPage).
 *
 * A test runs every one of a person's rules as its log is written - the
 * immediate ones and the later ones, without the waits - and none of them
 * repeats. So there is nothing left for the worker to send, and no record
 * to read: a test log it finds still paging is complete. A real page's log
 * goes on as it did, reading its rules with the same query a test reads
 * its rules with (getPagingRulesQuery).
 */

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

/*
 * Where each run's record stands, answered one record at a time by the
 * per-record reads this suite mocks, as the worker read them before it read
 * a page's records together (Fixtures/OnCallRecordStatesPerRecord).
 */
jest.mock("Common/Server/Utils/OnCall/OnCallRecordStates", () => {
  return jest
    .requireActual("../Fixtures/OnCallRecordStatesPerRecord")
    .onCallRecordStatesReadPerRecord();
});

import { executePendingNotificationLog } from "../../../../FeatureSet/Workers/Jobs/UserOnCallLog/ExecutePendingExecutions";

const MEMBER: { isProjectMember: boolean } = { isProjectMember: true };

const LOG_ID: ObjectID = new ObjectID("9f7e0000-0000-4000-8000-000000000001");
const PROJECT_ID: ObjectID = new ObjectID(
  "9f7e0000-0000-4000-8000-000000000002",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "9f7e0000-0000-4000-8000-000000000003",
);
const USER_ID: ObjectID = new ObjectID("9f7e0000-0000-4000-8000-000000000004");
const RULE_ID: ObjectID = new ObjectID("9f7e0000-0000-4000-8000-000000000005");
const SEVERITY_ID: ObjectID = new ObjectID(
  "9f7e0000-0000-4000-8000-0000000000aa",
);

type PendingLog = Parameters<typeof executePendingNotificationLog>[0];

function pendingLog(eventType: UserNotificationEventType): PendingLog {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();

  return {
    id: LOG_ID,
    _id: LOG_ID.toString(),
    projectId: PROJECT_ID,
    userId: USER_ID,
    createdAt: new Date(Date.now() - 10 * 60 * 1000),
    executedNotificationRules: {},
    userNotificationEventType: eventType,
    ...(eventType === UserNotificationEventType.TestPage
      ? {}
      : { triggeredByIncidentId: INCIDENT_ID }),
    onCallDutyPolicyExecutionLog: run,
  } as unknown as PendingLog;
}

let updates: Array<{ status?: string; statusMessage?: string }>;
let executedRules: Array<string>;
let rulesRead: jest.SpyInstance;
let ruleTypeAsked: jest.SpyInstance;
let incidentRead: jest.SpyInstance;

beforeEach(() => {
  updates = [];
  executedRules = [];

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  ruleTypeAsked = jest
    .spyOn(UserOnCallLogService, "getNotificationRuleType")
    .mockReturnValue(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT);

  incidentRead = jest
    .spyOn(IncidentService, "findOneById")
    .mockResolvedValue({ incidentSeverityId: SEVERITY_ID } as never);
  jest.spyOn(AlertService, "findOneById").mockResolvedValue(null as never);
  jest
    .spyOn(AlertEpisodeService, "findOneById")
    .mockResolvedValue(null as never);
  jest
    .spyOn(IncidentEpisodeService, "findOneById")
    .mockResolvedValue(null as never);
  jest
    .spyOn(IncidentService, "isIncidentAcknowledged")
    .mockResolvedValue(false as never);
  jest
    .spyOn(OnCallAcknowledgementTimeout, "readRecordState")
    .mockResolvedValue({ isAcknowledged: false, isResolved: false } as never);

  const rule: UserNotificationRule = new UserNotificationRule();
  rule.id = RULE_ID;
  rule.notifyAfterMinutes = 5;

  rulesRead = jest
    .spyOn(UserNotificationRuleService, "findBy")
    .mockResolvedValue([rule] as never);

  jest
    .spyOn(UserNotificationRuleService, "executeNotificationRuleItem")
    .mockImplementation((async (ruleId: ObjectID) => {
      executedRules.push(ruleId.toString());
    }) as never);

  jest
    .spyOn(UserOnCallLogService, "updateOneById")
    .mockImplementation((async (data: {
      data: { status?: string; statusMessage?: string };
    }) => {
      updates.push(data.data);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a test page's log", () => {
  test("is complete: nothing is left to send, and no record is read", async () => {
    await executePendingNotificationLog(
      pendingLog(UserNotificationEventType.TestPage),
      MEMBER,
    );

    expect(updates).toEqual([
      { status: UserNotificationExecutionStatus.Completed },
    ]);
    expect(executedRules).toEqual([]);
    expect(rulesRead).not.toHaveBeenCalled();
    expect(incidentRead).not.toHaveBeenCalled();
    // A test page's event type maps to no rule type of its own.
    expect(ruleTypeAsked).not.toHaveBeenCalled();
  });
});

describe("a real page's log", () => {
  test("still sends what is due, reading its rules as a test reads its own", async () => {
    await executePendingNotificationLog(
      pendingLog(UserNotificationEventType.IncidentCreated),
      MEMBER,
    );

    expect(executedRules).toEqual([RULE_ID.toString()]);

    const query: Record<string, unknown> = (
      rulesRead.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    const expected: Record<string, unknown> =
      UserOnCallLogService.getPagingRulesQuery({
        userId: USER_ID,
        projectId: PROJECT_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: SEVERITY_ID,
      }) as unknown as Record<string, unknown>;

    expect(Object.keys(query).sort()).toEqual(Object.keys(expected).sort());
    expect(query["projectId"]).toEqual(PROJECT_ID);
    expect(query["ruleType"]).toBe(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    );
    expect(query["incidentSeverityId"]).toEqual(SEVERITY_ID);
    expect(query["alertSeverityId"]).toBeUndefined();
    expect(query["isOptOut"]).toBeDefined();
    expect(query["userId"]).toBeDefined();
  });
});
