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
 * A PERSON PAGED BY A PAGE A PERSON ASKED FOR (OnCallPersonPage), AS THE
 * WORKER THAT SENDS THEIR NOTIFICATIONS RUNS IT.
 *
 * Their page goes on - a call after ten minutes, a push that repeats -
 * until somebody the page paged answers it, or its record is resolved.
 * Ended by the record's acknowledgement, it reached them by its first
 * notifications only: paging somebody into an incident that is being worked
 * on - acknowledged already - is what paging from its channel is mostly
 * for. A workflow's direct page and every policy's run are ended by the
 * record's acknowledgement, as they always were.
 */

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
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
  startedBy: "person" | "workflow" | "policy started by a person";
  acknowledgedAt?: Date | undefined;
}): PendingLog {
  const executionLog: OnCallDutyPolicyExecutionLog =
    new OnCallDutyPolicyExecutionLog();

  if (run.startedBy !== "workflow") {
    executionLog.triggeredByUserId = JANE;
  }

  if (run.startedBy === "workflow") {
    executionLog.triggeredByWorkflowId = WORKFLOW;
  }

  if (run.startedBy === "policy started by a person") {
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

describe("a person's page about an incident somebody else acknowledged", () => {
  test("goes on: the call due after five minutes is made", async () => {
    await executePendingNotificationLog(
      pendingLog({ startedBy: "person" }),
      MEMBER,
    );

    expect(executedRules).toEqual([RULE_ID.toString()]);
    expect(
      updates.some((update: { statusMessage?: string }) => {
        return (update.statusMessage || "").includes("is acknowledged");
      }),
    ).toBe(false);
    // Whether the incident is acknowledged is not what decides it.
    expect(isAcknowledgedAsked).toBe(0);
  });

  test("ends once somebody it paged answered it", async () => {
    await executePendingNotificationLog(
      pendingLog({ startedBy: "person", acknowledgedAt: new Date() }),
      MEMBER,
    );

    expect(executedRules).toEqual([]);
    expect(updates).toEqual([
      {
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: "Execution completed because this page is acknowledged.",
      },
    ]);
  });

  test("ends once its incident is resolved", async () => {
    recordState = { isAcknowledged: true, isResolved: true };

    await executePendingNotificationLog(
      pendingLog({ startedBy: "person" }),
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

  test("ends once its incident is deleted", async () => {
    recordState = null;

    await executePendingNotificationLog(
      pendingLog({ startedBy: "person" }),
      MEMBER,
    );

    expect(executedRules).toEqual([]);
    expect(updates[0]!.statusMessage).toBe(
      "Execution completed because incident is deleted.",
    );
  });
});

describe("pages nobody asked for by hand", () => {
  test.each([
    ["a workflow's direct page", "workflow"],
    ["an on-call policy's run a person started", "policy started by a person"],
  ] as const)(
    "%s: ended by the incident's acknowledgement, as it always was",
    async (
      _name: string,
      startedBy: "workflow" | "policy started by a person",
    ) => {
      await executePendingNotificationLog(
        pendingLog({ startedBy: startedBy }),
        MEMBER,
      );

      expect(executedRules).toEqual([]);
      expect(updates).toEqual([
        {
          status: UserNotificationExecutionStatus.Completed,
          statusMessage:
            "Execution completed because incident is acknowledged.",
        },
      ]);
      expect(isAcknowledgedAsked).toBe(1);
    },
  );
});

describe("the worker's tick", () => {
  test("reads each page's run with who started it, which tells a person's page apart", async () => {
    const findAllBy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "findAllBy")
      .mockResolvedValue([] as Array<UserOnCallLog> as never);
    jest
      .spyOn(ProjectMembership, "getMemberKeys")
      .mockResolvedValue(new Set<string>() as never);

    await runTick();

    expect(findAllBy.mock.calls[0]![0].select).toMatchObject({
      onCallDutyPolicyExecutionLog: {
        pageAgainNumber: true,
        acknowledgedAt: true,
        onCallDutyPolicyId: true,
        triggeredByUserId: true,
        triggeredByWorkflowId: true,
      },
    });
  });
});
