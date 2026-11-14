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
import OnCallAcknowledgementTimeout, {
  OnCallTimeoutRecordState,
} from "Common/Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import ProjectMembership from "Common/Server/Utils/TeamMember/ProjectMembership";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A PERSON PAGED AS AN OBSERVER (OnCallObserverPage), AS THE WORKER THAT
 * SENDS THEIR NOTIFICATIONS RUNS IT.
 *
 * Observers are kept informed about a record somebody else responds to: the
 * responders acknowledging it is no sign the observer has seen it. So their
 * page goes on - a call after five minutes, a push that repeats - until
 * somebody the page paged answers it, or its record is resolved, whichever
 * started it: a policy's run, a workflow's direct page, a person's page.
 * A responder's page is ended by the record's acknowledgement, as it always
 * was.
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
import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";

const runTick: () => Promise<void> = (RunCron as unknown as jest.Mock).mock
  .calls[0]![2] as () => Promise<void>;

const MEMBER: { isProjectMember: boolean } = { isProjectMember: true };

const LOG_ID: ObjectID = new ObjectID("9f000000-0000-4000-8000-000000000001");
const PROJECT_ID: ObjectID = new ObjectID(
  "9f000000-0000-4000-8000-000000000002",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "9f000000-0000-4000-8000-000000000003",
);
const USER_ID: ObjectID = new ObjectID("9f000000-0000-4000-8000-000000000004");
const RULE_ID: ObjectID = new ObjectID("9f000000-0000-4000-8000-000000000005");
const JANE: ObjectID = new ObjectID("9f000000-0000-4000-8000-000000000006");
const WORKFLOW: ObjectID = new ObjectID("9f000000-0000-4000-8000-000000000007");
const POLICY: ObjectID = new ObjectID("9f000000-0000-4000-8000-000000000008");

type PendingLog = Parameters<typeof executePendingNotificationLog>[0];

// A person's page of a run, ten minutes in: a rule that calls after five is due.
function pendingLog(run: {
  startedBy:
    | "person"
    | "workflow"
    | "policy started by a person"
    | "policy OneUptime started";
  acknowledgedAt?: Date | undefined;
  isObserverPage?: boolean | undefined;
}): PendingLog {
  const executionLog: OnCallDutyPolicyExecutionLog =
    new OnCallDutyPolicyExecutionLog();

  if (run.isObserverPage !== undefined) {
    executionLog.isObserverPage = run.isObserverPage;
  }

  if (
    run.startedBy !== "workflow" &&
    run.startedBy !== "policy OneUptime started"
  ) {
    executionLog.triggeredByUserId = JANE;
  }

  if (run.startedBy === "workflow") {
    executionLog.triggeredByWorkflowId = WORKFLOW;
  }

  if (
    run.startedBy === "policy started by a person" ||
    run.startedBy === "policy OneUptime started"
  ) {
    executionLog.onCallDutyPolicyId = POLICY;
  }

  if (run.acknowledgedAt) {
    executionLog.acknowledgedAt = run.acknowledgedAt;
  }

  return {
    id: LOG_ID,
    _id: LOG_ID.toString(),
    projectId: PROJECT_ID,
    userId: USER_ID,
    createdAt: new Date(Date.now() - 10 * 60 * 1000),
    executedNotificationRules: {},
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    triggeredByIncidentId: INCIDENT_ID,
    onCallDutyPolicyExecutionLog: executionLog,
  } as unknown as PendingLog;
}

let updates: Array<{ status?: string; statusMessage?: string }>;
let executedRules: Array<string>;
let recordState: OnCallTimeoutRecordState | null;
let isAcknowledgedAsked: number;

beforeEach(() => {
  updates = [];
  executedRules = [];
  // Somebody else is on the incident: acknowledged, not resolved.
  recordState = { isAcknowledged: true, isResolved: false };
  isAcknowledgedAsked = 0;

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  jest
    .spyOn(UserOnCallLogService, "getNotificationRuleType")
    .mockReturnValue(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT);

  jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
    incidentSeverityId: new ObjectID("9f000000-0000-4000-8000-0000000000aa"),
  } as never);
  jest.spyOn(AlertService, "findOneById").mockResolvedValue(null as never);
  jest
    .spyOn(AlertEpisodeService, "findOneById")
    .mockResolvedValue(null as never);
  jest
    .spyOn(IncidentEpisodeService, "findOneById")
    .mockResolvedValue(null as never);

  jest
    .spyOn(IncidentService, "isIncidentAcknowledged")
    .mockImplementation(async (): Promise<boolean> => {
      isAcknowledgedAsked++;
      return true;
    });

  jest
    .spyOn(OnCallAcknowledgementTimeout, "readRecordState")
    .mockImplementation(async (): Promise<OnCallTimeoutRecordState | null> => {
      return recordState;
    });

  // One rule: call after five minutes.
  const rule: UserNotificationRule = new UserNotificationRule();
  rule.id = RULE_ID;
  rule.notifyAfterMinutes = 5;

  jest
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

describe.each<[string, "workflow" | "policy started by a person" | "person"]>([
  ["a policy's run", "policy started by a person"],
  ["a workflow's direct page", "workflow"],
  ["a person's page", "person"],
])(
  "an observer paged by %s, about an incident its responders acknowledged",
  (
    _name: string,
    startedBy: "workflow" | "policy started by a person" | "person",
  ) => {
    test("goes on: the call due after five minutes is made", async () => {
      await executePendingNotificationLog(
        pendingLog({ startedBy: startedBy, isObserverPage: true }),
        MEMBER,
      );

      expect(executedRules).toEqual([RULE_ID.toString()]);
      expect(updates).toEqual([]);
      // Whether the incident is acknowledged is not what decides it.
      expect(isAcknowledgedAsked).toBe(0);
    });

    test("ends once somebody it paged answered it", async () => {
      await executePendingNotificationLog(
        pendingLog({
          startedBy: startedBy,
          isObserverPage: true,
          acknowledgedAt: new Date(),
        }),
        MEMBER,
      );

      expect(executedRules).toEqual([]);
      expect(updates).toEqual([
        {
          status: UserNotificationExecutionStatus.Completed,
          statusMessage:
            "Execution completed because this page is acknowledged.",
        },
      ]);
    });

    test("ends once its incident is resolved", async () => {
      recordState = { isAcknowledged: true, isResolved: true };

      await executePendingNotificationLog(
        pendingLog({ startedBy: startedBy, isObserverPage: true }),
        MEMBER,
      );

      expect(executedRules).toEqual([]);
      expect(updates).toEqual([
        {
          status: UserNotificationExecutionStatus.Completed,
          statusMessage: "Execution completed because incident is resolved.",
        },
      ]);
    });
  },
);

describe("a responder's page beside it", () => {
  test("is ended by the incident's acknowledgement, as it always was", async () => {
    await executePendingNotificationLog(
      pendingLog({
        startedBy: "policy OneUptime started",
        isObserverPage: false,
      }),
      MEMBER,
    );

    expect(executedRules).toEqual([]);
    expect(updates).toEqual([
      {
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: "Execution completed because incident is acknowledged.",
      },
    ]);
    expect(isAcknowledgedAsked).toBe(1);
  });

  test("of a policy a person started by hand goes on until answered, as the observers' does (OnCallPolicyStartedByHand)", async () => {
    await executePendingNotificationLog(
      pendingLog({
        startedBy: "policy started by a person",
        isObserverPage: false,
      }),
      MEMBER,
    );

    expect(executedRules).toEqual([RULE_ID.toString()]);
    expect(updates).toEqual([]);
    expect(isAcknowledgedAsked).toBe(0);
  });
});

describe("the worker's tick", () => {
  test("reads each page's run with whether it pages observers", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "findBy")
      .mockResolvedValue([] as Array<UserOnCallLog> as never);
    jest
      .spyOn(ProjectMembership, "getMemberKeys")
      .mockResolvedValue(new Set<string>() as never);

    await runTick();

    expect(findBy.mock.calls[0]![0].select).toMatchObject({
      onCallDutyPolicyExecutionLog: {
        isObserverPage: true,
      },
    });
  });
});
