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
 * A PERSON PAGED BY AN ON-CALL POLICY SOMEBODY STARTED BY HAND
 * (OnCallPolicyStartedByHand, issue #7596), AS THE WORKER THAT SENDS THEIR
 * NOTIFICATIONS RUNS IT.
 *
 * Execute On-Call Policy is mostly pressed on a record somebody is on
 * already. Ended by the record's acknowledgement, the people it paged got
 * the notifications their On-Call Rules send straight away and nothing
 * after: no call ten minutes later, no push that repeats. Their page now
 * goes on until somebody the run paged answers it, or the record is
 * resolved. A person paged by a policy OneUptime started on its own still
 * stops once anybody acknowledges the record, and is paged on while nobody
 * has.
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

const LOG_ID: ObjectID = new ObjectID("7596c000-0000-4000-8000-000000000001");
const PROJECT_ID: ObjectID = new ObjectID(
  "7596c000-0000-4000-8000-000000000002",
);
const RECORD_ID: ObjectID = new ObjectID(
  "7596c000-0000-4000-8000-000000000003",
);
const USER_ID: ObjectID = new ObjectID("7596c000-0000-4000-8000-000000000004");
const CALL_RULE: ObjectID = new ObjectID(
  "7596c000-0000-4000-8000-000000000005",
);
const PUSH_RULE: ObjectID = new ObjectID(
  "7596c000-0000-4000-8000-000000000006",
);
const JANE: ObjectID = new ObjectID("7596c000-0000-4000-8000-000000000007");
const POLICY: ObjectID = new ObjectID("7596c000-0000-4000-8000-000000000008");
const WORKFLOW: ObjectID = new ObjectID("7596c000-0000-4000-8000-000000000009");
const SEVERITY: ObjectID = new ObjectID("7596c000-0000-4000-8000-00000000000a");

type RecordKind = "incident" | "alert" | "alert episode" | "incident episode";

type StartedBy = "a person, by hand" | "OneUptime" | "a workflow, as a person";

const RECORD_KINDS: Array<RecordKind> = [
  "incident",
  "alert",
  "alert episode",
  "incident episode",
];

type PendingLog = Parameters<typeof executePendingNotificationLog>[0];

/*
 * A person's page of a policy's run, ten minutes in: their rule that calls
 * after five minutes is due, and so is the first repeat of their push that
 * repeats every three.
 */
function pendingLog(data: {
  about: RecordKind;
  startedBy: StartedBy;
  acknowledgedAt?: Date | undefined;
}): PendingLog {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.onCallDutyPolicyId = POLICY;

  if (data.startedBy !== "OneUptime") {
    run.triggeredByUserId = JANE;
  }

  if (data.startedBy === "a workflow, as a person") {
    run.triggeredByWorkflowId = WORKFLOW;
  }

  if (data.acknowledgedAt) {
    run.acknowledgedAt = data.acknowledgedAt;
  }

  const eventType: Record<RecordKind, UserNotificationEventType> = {
    incident: UserNotificationEventType.IncidentCreated,
    alert: UserNotificationEventType.AlertCreated,
    "alert episode": UserNotificationEventType.AlertEpisodeCreated,
    "incident episode": UserNotificationEventType.IncidentEpisodeCreated,
  };
  run.userNotificationEventType = eventType[data.about];

  const recordColumn: Record<RecordKind, string> = {
    incident: "triggeredByIncidentId",
    alert: "triggeredByAlertId",
    "alert episode": "triggeredByAlertEpisodeId",
    "incident episode": "triggeredByIncidentEpisodeId",
  };

  return {
    id: LOG_ID,
    _id: LOG_ID.toString(),
    projectId: PROJECT_ID,
    userId: USER_ID,
    createdAt: new Date(Date.now() - 10 * 60 * 1000),
    // The push went out as the page started.
    executedNotificationRules: { [PUSH_RULE.toString()]: true },
    userNotificationEventType: eventType[data.about],
    [recordColumn[data.about]]: RECORD_ID,
    onCallDutyPolicyExecutionLog: run,
  } as unknown as PendingLog;
}

let updates: Array<{ status?: string; statusMessage?: string }>;
let sent: Array<{ ruleId: string; repeatNumber?: number | undefined }>;
let recordState: OnCallTimeoutRecordState | null;
let acknowledgedAsked: number;
let isRecordAcknowledged: boolean;

beforeEach(() => {
  updates = [];
  sent = [];
  // Somebody else is on the record: acknowledged, not resolved.
  recordState = { isAcknowledged: true, isResolved: false };
  acknowledgedAsked = 0;
  isRecordAcknowledged = true;

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  jest
    .spyOn(UserOnCallLogService, "getNotificationRuleType")
    .mockReturnValue(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT);

  jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
    incidentSeverityId: SEVERITY,
  } as never);
  jest.spyOn(AlertService, "findOneById").mockResolvedValue({
    alertSeverityId: SEVERITY,
  } as never);
  jest.spyOn(AlertEpisodeService, "findOneById").mockResolvedValue({
    alertSeverityId: SEVERITY,
  } as never);
  jest.spyOn(IncidentEpisodeService, "findOneById").mockResolvedValue({
    incidentSeverityId: SEVERITY,
  } as never);

  const asked: () => Promise<boolean> = async (): Promise<boolean> => {
    acknowledgedAsked++;
    return isRecordAcknowledged;
  };

  jest
    .spyOn(IncidentService, "isIncidentAcknowledged")
    .mockImplementation(asked);
  jest.spyOn(AlertService, "isAlertAcknowledged").mockImplementation(asked);
  jest
    .spyOn(AlertEpisodeService, "isEpisodeAcknowledged")
    .mockImplementation(asked);
  jest
    .spyOn(IncidentEpisodeService, "isEpisodeAcknowledged")
    .mockImplementation(asked);

  jest
    .spyOn(OnCallAcknowledgementTimeout, "readRecordState")
    .mockImplementation(async (): Promise<OnCallTimeoutRecordState | null> => {
      return recordState;
    });

  // Call after five minutes; push at once, again every three minutes.
  const call: UserNotificationRule = new UserNotificationRule();
  call.id = CALL_RULE;
  call.notifyAfterMinutes = 5;

  const push: UserNotificationRule = new UserNotificationRule();
  push.id = PUSH_RULE;
  push.notifyAfterMinutes = 0;
  push.repeatEveryMinutes = 3;

  jest
    .spyOn(UserNotificationRuleService, "findBy")
    .mockResolvedValue([call, push] as never);

  jest
    .spyOn(UserNotificationRuleService, "executeNotificationRuleItem")
    .mockImplementation((async (
      ruleId: ObjectID,
      options: { repeatNumber?: number | undefined },
    ) => {
      sent.push({
        ruleId: ruleId.toString(),
        repeatNumber: options.repeatNumber,
      });
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

describe("a person paged by a policy started by hand, about a record somebody else acknowledged (Q3)", () => {
  test.each(RECORD_KINDS)(
    "about an %s: their page goes on - the call due after five minutes is made, and the push repeats",
    async (about: RecordKind) => {
      await executePendingNotificationLog(
        pendingLog({ about: about, startedBy: "a person, by hand" }),
        MEMBER,
      );

      expect(sent).toEqual([
        { ruleId: CALL_RULE.toString(), repeatNumber: undefined },
        // Ten minutes in: its third repeat is the latest due.
        { ruleId: PUSH_RULE.toString(), repeatNumber: 3 },
      ]);
      expect(
        updates.some((update: { statusMessage?: string }) => {
          return (update.statusMessage || "").includes("is acknowledged");
        }),
      ).toBe(false);
      // Whether the record is acknowledged is not what decides it.
      expect(acknowledgedAsked).toBe(0);
    },
  );

  test("ends once somebody the run paged answered it", async () => {
    await executePendingNotificationLog(
      pendingLog({
        about: "incident",
        startedBy: "a person, by hand",
        acknowledgedAt: new Date(),
      }),
      MEMBER,
    );

    expect(sent).toEqual([]);
    expect(updates).toEqual([
      {
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: "Execution completed because this page is acknowledged.",
      },
    ]);
  });

  test.each(RECORD_KINDS)(
    "ends once its %s is resolved",
    async (about: RecordKind) => {
      recordState = { isAcknowledged: true, isResolved: true };

      await executePendingNotificationLog(
        pendingLog({ about: about, startedBy: "a person, by hand" }),
        MEMBER,
      );

      expect(sent).toEqual([]);
      expect(updates).toEqual([
        {
          status: UserNotificationExecutionStatus.Completed,
          statusMessage: `Execution completed because ${about} is resolved.`,
        },
      ]);
    },
  );
});

describe("a person paged by a policy nobody started by hand (Q2)", () => {
  test.each(RECORD_KINDS)(
    "OneUptime's, about an acknowledged %s: their page stops at once, as it always did",
    async (about: RecordKind) => {
      await executePendingNotificationLog(
        pendingLog({ about: about, startedBy: "OneUptime" }),
        MEMBER,
      );

      expect(sent).toEqual([]);
      expect(updates).toEqual([
        {
          status: UserNotificationExecutionStatus.Completed,
          statusMessage: `Execution completed because ${about} is acknowledged.`,
        },
      ]);
      expect(acknowledgedAsked).toBe(1);
    },
  );

  test("a workflow's, started as a person: stops once the incident is acknowledged, as it always did", async () => {
    await executePendingNotificationLog(
      pendingLog({ about: "incident", startedBy: "a workflow, as a person" }),
      MEMBER,
    );

    expect(sent).toEqual([]);
    expect(updates[0]!.statusMessage).toBe(
      "Execution completed because incident is acknowledged.",
    );
  });

  test.each(RECORD_KINDS)(
    "OneUptime's, about an %s nobody acknowledged: the call and the repeat still go out",
    async (about: RecordKind) => {
      isRecordAcknowledged = false;

      await executePendingNotificationLog(
        pendingLog({ about: about, startedBy: "OneUptime" }),
        MEMBER,
      );

      expect(sent).toEqual([
        { ruleId: CALL_RULE.toString(), repeatNumber: undefined },
        { ruleId: PUSH_RULE.toString(), repeatNumber: 3 },
      ]);
      expect(updates).toEqual([]);
    },
  );
});

describe("the worker's tick", () => {
  test("reads each page's run with what tells a policy started by hand apart", async () => {
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
        isObserverPage: true,
        userNotificationEventType: true,
      },
    });
  });
});
