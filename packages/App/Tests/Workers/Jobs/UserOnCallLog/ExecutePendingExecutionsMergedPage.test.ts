import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { getRepeatClaimKey } from "Common/Types/NotificationRule/NotificationRepeat";
import {
  OnCallPageCoverKind,
  getOnCallPageMergeTakenOverMessage,
  getOnCallPageMergedLine,
  getOnCallPageMergedMessage,
} from "Common/Types/OnCallDutyPolicy/OnCallPageMerge";
import UserOnCallLogService from "Common/Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import logger from "Common/Server/Utils/Logger";
import ProjectMembership from "Common/Server/Utils/TeamMember/ProjectMembership";
import QueryHelper, {
  FindOperator,
} from "Common/Server/Types/Database/QueryHelper";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A PAGE MERGED INTO THE PERSON'S OPEN PAGE FROM ANOTHER POLICY'S RUN, AS
 * THE WORKER THAT SENDS THEIR NOTIFICATIONS RUNS IT (issue #7837,
 * Types/OnCallDutyPolicy/OnCallPageMerge).
 *
 * Ana is on call in Payments and in Billing, which an incident runs both.
 * Payments paged her; Billing's page of her was merged into it, and sends
 * nothing of its own while Payments' page is open. Each minute the worker
 * reads where Payments' page is:
 *
 *   - still open: Billing's page waits, sending nothing;
 *   - answered by her: Billing's is answered with it;
 *   - over without her answer (she escalated it from one of its messages,
 *     it failed, its run stopped, it is gone): Billing's page takes the page
 *     over and pages her itself - what Payments' page sent counts as sent,
 *     unless it failed; and it ends, sending nothing, when Payments' page
 *     had sent everything already.
 *
 * And it ends as any page of its kind does: once the incident is
 * acknowledged, or she leaves the project.
 */

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

/*
 * Where each run's record stands, answered one record at a time by the
 * per-record reads this suite mocks (Fixtures/OnCallRecordStatesPerRecord).
 */
jest.mock("Common/Server/Utils/OnCall/OnCallRecordStates", () => {
  return jest
    .requireActual("../Fixtures/OnCallRecordStatesPerRecord")
    .onCallRecordStatesReadPerRecord();
});

import {
  USER_LOG_STATUSES_WORKED_ON,
  executePendingNotificationLog,
} from "../../../../FeatureSet/Workers/Jobs/UserOnCallLog/ExecutePendingExecutions";
import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";

const runTick: () => Promise<void> = (RunCron as unknown as jest.Mock).mock
  .calls[0]![2] as () => Promise<void>;

const MEMBER: { isProjectMember: boolean } = { isProjectMember: true };

const LOG_ID: ObjectID = new ObjectID("78370000-0000-4000-8000-000000000001");
const COVER_ID: ObjectID = new ObjectID("78370000-0000-4000-8000-000000000002");
const PROJECT_ID: ObjectID = new ObjectID(
  "78370000-0000-4000-8000-000000000003",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "78370000-0000-4000-8000-000000000004",
);
const ANA: ObjectID = new ObjectID("78370000-0000-4000-8000-000000000005");
const CALL_RULE: ObjectID = new ObjectID(
  "78370000-0000-4000-8000-000000000006",
);
const PUSH_RULE: ObjectID = new ObjectID(
  "78370000-0000-4000-8000-000000000007",
);
const BILLING: ObjectID = new ObjectID("78370000-0000-4000-8000-000000000008");
const BILLING_RUN: ObjectID = new ObjectID(
  "78370000-0000-4000-8000-000000000009",
);
const BILLING_LINE: ObjectID = new ObjectID(
  "78370000-0000-4000-8000-00000000000a",
);
const SEVERITY: ObjectID = new ObjectID("78370000-0000-4000-8000-00000000000b");

type PendingLog = Parameters<typeof executePendingNotificationLog>[0];

/*
 * Billing's page of Ana, merged into Payments' page of her ten minutes ago:
 * it sent nothing of its own. Or, `isDirectPage`, a workflow's Page Users
 * step's page of her (#8859), with no policy. Its line names what it was
 * merged into: Payments, unless `line` says otherwise.
 */
function mergedPage(data?: {
  mergedInto?: ObjectID | null | undefined;
  isDirectPage?: boolean | undefined;
  line?: string | undefined;
}): PendingLog {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.userNotificationEventType = UserNotificationEventType.IncidentCreated;

  if (data?.isDirectPage) {
    run.triggeredByWorkflowId = BILLING;
  } else {
    run.onCallDutyPolicyId = BILLING;
  }

  return {
    id: LOG_ID,
    _id: LOG_ID.toString(),
    projectId: PROJECT_ID,
    userId: ANA,
    createdAt: new Date(Date.now() - 10 * 60 * 1000),
    status: UserNotificationExecutionStatus.AlreadyPaged,
    statusMessage:
      data?.line ?? getOnCallPageMergedMessage({ policyName: "Payments" }),
    mergedIntoUserOnCallLogId:
      data?.mergedInto === null ? undefined : data?.mergedInto || COVER_ID,
    executedNotificationRules: {},
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    triggeredByIncidentId: INCIDENT_ID,
    onCallDutyPolicyId: data?.isDirectPage ? undefined : BILLING,
    onCallDutyPolicyExecutionLogId: BILLING_RUN,
    onCallDutyPolicyExecutionLogTimelineId: BILLING_LINE,
    onCallDutyPolicyExecutionLog: run,
  } as unknown as PendingLog;
}

/*
 * Payments' page of Ana, as the worker reads it for Billing's - or,
 * `sentByJane`, a page Jane sent Ana from a chat (#8859), with no policy.
 */
function coverPage(data: {
  status: UserNotificationExecutionStatus;
  runStatus?: OnCallDutyPolicyStatus | undefined;
  acknowledgedAt?: Date | undefined;
  sent?: JSONObject | undefined;
  sentByJane?: boolean | undefined;
}): UserOnCallLog {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.status = data.runStatus || OnCallDutyPolicyStatus.Executing;

  if (data.sentByJane) {
    run.triggeredByUserId = new ObjectID(
      "78370000-0000-4000-8000-00000000000c",
    );
  } else {
    run.onCallDutyPolicyId = new ObjectID(
      "78370000-0000-4000-8000-00000000000d",
    );
  }

  const cover: UserOnCallLog = new UserOnCallLog();
  cover.id = COVER_ID;
  cover.status = data.status;
  cover.executedNotificationRules = data.sent || {};

  if (!data.sentByJane) {
    cover.onCallDutyPolicy = { name: "Payments" } as never;
  }

  cover.onCallDutyPolicyExecutionLog = run;

  if (data.acknowledgedAt) {
    cover.acknowledgedAt = data.acknowledgedAt;
  }

  return cover;
}

// Everything Payments' push sent: its first push and its first two repeats.
const PUSH_AND_TWO_REPEATS: JSONObject = {
  [PUSH_RULE.toString()]: "2026-11-16T03:00:00.000Z",
  [getRepeatClaimKey(PUSH_RULE.toString(), 1)]: "2026-11-16T03:03:00.000Z",
  [getRepeatClaimKey(PUSH_RULE.toString(), 2)]: "2026-11-16T03:06:00.000Z",
};

let updates: Array<{
  status?: string;
  statusMessage?: string;
  executedNotificationRules?: JSONObject;
}>;
let sent: Array<{ ruleId: string; repeatNumber?: number | undefined }>;
let cover: UserOnCallLog | null;
let rules: Array<UserNotificationRule>;
let isIncidentAcknowledged: boolean;
let answered: Array<Record<string, unknown>>;
let coverReads: number;
let fallbacks: number;

function call(): UserNotificationRule {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule.id = CALL_RULE;
  rule.notifyAfterMinutes = 5;
  return rule;
}

function push(repeatEveryMinutes: number): UserNotificationRule {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule.id = PUSH_RULE;
  rule.notifyAfterMinutes = 0;
  rule.repeatEveryMinutes = repeatEveryMinutes;
  return rule;
}

beforeEach(() => {
  updates = [];
  sent = [];
  answered = [];
  coverReads = 0;
  fallbacks = 0;
  cover = coverPage({ status: UserNotificationExecutionStatus.Executing });
  // Call after five minutes; push at once, again every three minutes.
  rules = [call(), push(3)];
  isIncidentAcknowledged = false;

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });

  jest
    .spyOn(UserOnCallLogService, "getNotificationRuleType")
    .mockReturnValue(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT);

  jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
    incidentSeverityId: SEVERITY,
  } as never);

  jest
    .spyOn(IncidentService, "isIncidentAcknowledged")
    .mockImplementation(async (): Promise<boolean> => {
      return isIncidentAcknowledged;
    });

  jest
    .spyOn(UserOnCallLogService, "findOneById")
    .mockImplementation((async () => {
      coverReads++;
      return cover;
    }) as never);

  jest
    .spyOn(UserNotificationRuleService, "findBy")
    .mockImplementation((async () => {
      return rules;
    }) as never);

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
    .spyOn(UserOnCallLogService, "sendToLogWithNoRules")
    .mockImplementation((async () => {
      fallbacks++;
    }) as never);

  jest
    .spyOn(UserOnCallLogService, "updateOneById")
    .mockImplementation((async (data: {
      data: {
        status?: string;
        statusMessage?: string;
        executedNotificationRules?: JSONObject;
      };
    }) => {
      updates.push(data.data);
    }) as never);

  jest
    .spyOn(UserOnCallLogTimelineService, "acknowledgePage")
    .mockImplementation((async (page: Record<string, unknown>) => {
      answered.push(page);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("while the page it was merged into is open", () => {
  test("it sends nothing, and stays as it is: the other page's notifications stand for both", async () => {
    await executePendingNotificationLog(mergedPage(), MEMBER);

    expect(sent).toEqual([]);
    expect(updates).toEqual([]);
    expect(answered).toEqual([]);
  });

  test("the other page's notifications all went out, but its run still pages: it still waits", async () => {
    cover = coverPage({
      status: UserNotificationExecutionStatus.Completed,
      runStatus: OnCallDutyPolicyStatus.Executing,
      sent: PUSH_AND_TWO_REPEATS,
    });

    await executePendingNotificationLog(mergedPage(), MEMBER);

    expect(sent).toEqual([]);
    expect(updates).toEqual([]);
  });
});

describe("once she answered the page it was merged into", () => {
  test("it is answered with it, at the moment she answered, as the page it is", async () => {
    const acknowledgedAt: Date = new Date(Date.now() - 60 * 1000);
    cover = coverPage({
      status: UserNotificationExecutionStatus.Completed,
      acknowledgedAt: acknowledgedAt,
    });

    await executePendingNotificationLog(mergedPage(), MEMBER);

    expect(sent).toEqual([]);
    expect(answered).toHaveLength(1);
    expect(answered[0]).toMatchObject({
      userOnCallLogId: LOG_ID,
      userId: ANA,
      onCallDutyPolicyExecutionLogId: BILLING_RUN,
      onCallDutyPolicyExecutionLogTimelineId: BILLING_LINE,
      triggeredByIncidentId: INCIDENT_ID,
      acknowledgedAt: acknowledgedAt,
      projectId: PROJECT_ID,
      isAnsweredWithAnotherPage: true,
    });
  });
});

describe("once the page it was merged into is over without her answer", () => {
  test("she escalated it from one of its messages: it takes the page over, counting what that page sent as sent", async () => {
    cover = coverPage({
      status: UserNotificationExecutionStatus.PassedOn,
      sent: PUSH_AND_TWO_REPEATS,
    });

    await executePendingNotificationLog(mergedPage(), MEMBER);

    expect(updates[0]).toEqual({
      status: UserNotificationExecutionStatus.Executing,
      statusMessage: getOnCallPageMergeTakenOverMessage({
        policyName: "Payments",
      }),
      executedNotificationRules: PUSH_AND_TWO_REPEATS,
    });
    expect(updates[0]!.statusMessage).toBe(
      "Their page from Payments is over, so this policy pages them now.",
    );
    // The call due after five minutes, and the push's third repeat - not its first push again.
    expect(sent).toEqual([
      { ruleId: CALL_RULE.toString(), repeatNumber: undefined },
      { ruleId: PUSH_RULE.toString(), repeatNumber: 3 },
    ]);
  });

  test("its run stopped with her notifications all sent: nothing is left, and it ends sending nothing", async () => {
    rules = [call(), push(0)];
    cover = coverPage({
      status: UserNotificationExecutionStatus.Completed,
      runStatus: OnCallDutyPolicyStatus.Completed,
      sent: {
        [CALL_RULE.toString()]: "2026-11-16T03:05:00.000Z",
        [PUSH_RULE.toString()]: "2026-11-16T03:00:00.000Z",
      },
    });

    await executePendingNotificationLog(mergedPage(), MEMBER);

    expect(sent).toEqual([]);
    expect(updates).toEqual([
      { status: UserNotificationExecutionStatus.Completed },
    ]);
  });

  test("it failed: everything is sent again, rather than risk a page that never reached her", async () => {
    cover = coverPage({
      status: UserNotificationExecutionStatus.Error,
      sent: PUSH_AND_TWO_REPEATS,
    });

    await executePendingNotificationLog(mergedPage(), MEMBER);

    expect(updates[0]).toMatchObject({
      status: UserNotificationExecutionStatus.Executing,
      executedNotificationRules: {},
    });
    expect(sent).toEqual([
      { ruleId: CALL_RULE.toString(), repeatNumber: undefined },
      { ruleId: PUSH_RULE.toString(), repeatNumber: undefined },
    ]);
  });

  test("it is gone: it takes the page over from the start, naming the page as its own line did (#8859)", async () => {
    cover = null;

    await executePendingNotificationLog(mergedPage(), MEMBER);

    expect(updates[0]).toMatchObject({
      status: UserNotificationExecutionStatus.Executing,
      statusMessage:
        "Their page from Payments is over, so this policy pages them now.",
    });
    expect(sent).toHaveLength(2);
  });

  test("it is gone, and its own line names nothing: another on-call policy", async () => {
    cover = null;

    await executePendingNotificationLog(
      mergedPage({ line: "Something else." }),
      MEMBER,
    );

    expect(updates[0]).toMatchObject({
      status: UserNotificationExecutionStatus.Executing,
      statusMessage:
        "Their page from another on-call policy is over, so this policy pages them now.",
    });
  });

  test("it names no page at all: it takes the page over from the start", async () => {
    await executePendingNotificationLog(
      mergedPage({ mergedInto: null }),
      MEMBER,
    );

    expect(coverReads).toBe(0);
    expect(updates[0]).toMatchObject({
      status: UserNotificationExecutionStatus.Executing,
    });
    expect(sent).toHaveLength(2);
  });

  test("with no rule for the page, the other page's fallback stands for it: it ends sending nothing", async () => {
    rules = [];
    cover = coverPage({
      status: UserNotificationExecutionStatus.PassedOn,
      sent: { __fallback__: "2026-11-16T03:00:00.000Z" },
    });

    await executePendingNotificationLog(mergedPage(), MEMBER);

    expect(fallbacks).toBe(0);
    expect(updates).toEqual([
      { status: UserNotificationExecutionStatus.Completed },
    ]);
  });

  test("with no rule for the page, and the other page failed: it falls back to her verified methods itself", async () => {
    rules = [];
    cover = coverPage({ status: UserNotificationExecutionStatus.Error });

    await executePendingNotificationLog(mergedPage(), MEMBER);

    expect(updates[0]).toMatchObject({
      status: UserNotificationExecutionStatus.Executing,
    });
    expect(fallbacks).toBe(1);
  });
});

describe("it ends as any page of its kind does", () => {
  test("once the incident is acknowledged: it ends, without reading the other page", async () => {
    isIncidentAcknowledged = true;

    await executePendingNotificationLog(mergedPage(), MEMBER);

    expect(sent).toEqual([]);
    expect(coverReads).toBe(0);
    expect(updates).toEqual([
      {
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: "Execution completed because incident is acknowledged.",
      },
    ]);
  });

  test("once she left the project", async () => {
    await executePendingNotificationLog(mergedPage(), {
      isProjectMember: false,
    });

    expect(sent).toEqual([]);
    expect(coverReads).toBe(0);
    expect(updates[0]).toMatchObject({
      status: UserNotificationExecutionStatus.Completed,
    });
  });
});

describe("the worker's tick", () => {
  test("goes through the merged pages as well as the pages still paging, with what it reads of them", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "findBy")
      .mockResolvedValue([] as Array<UserOnCallLog> as never);
    jest
      .spyOn(ProjectMembership, "getMemberKeys")
      .mockResolvedValue(new Set<string>() as never);

    await runTick();

    expect(USER_LOG_STATUSES_WORKED_ON).toEqual([
      UserNotificationExecutionStatus.Executing,
      UserNotificationExecutionStatus.AlreadyPaged,
    ]);

    const status: FindOperator<unknown> = findBy.mock.calls[0]![0].query
      .status as FindOperator<unknown>;

    // "Any of" the two (QueryHelper.any), whatever its parameter is called.
    expect(status.type).toBe(QueryHelper.any(["x"]).type);
    expect(Object.values(status.objectLiteralParameters || {})).toEqual([
      [
        UserNotificationExecutionStatus.Executing,
        UserNotificationExecutionStatus.AlreadyPaged,
      ],
    ]);
    expect(findBy.mock.calls[0]![0].select).toMatchObject({
      status: true,
      mergedIntoUserOnCallLogId: true,
      executedNotificationRules: true,
    });
  });
});

/*
 * A DIRECT PAGE AND A POLICY (#8859): a workflow's page of Ana merged into
 * Payments' page of her, or Billing's merged into a page Jane sent her from
 * a chat, is run as any merged page is - and its take-over says what it is.
 */
describe("a page merged into a direct page, or a direct page merged into a policy's", () => {
  test("a workflow's page of her takes Payments' page over when she escalated it: she is paged directly now", async () => {
    cover = coverPage({
      status: UserNotificationExecutionStatus.PassedOn,
      sent: PUSH_AND_TWO_REPEATS,
    });

    await executePendingNotificationLog(
      mergedPage({ isDirectPage: true }),
      MEMBER,
    );

    expect(updates[0]).toEqual({
      status: UserNotificationExecutionStatus.Executing,
      statusMessage:
        "Their page from Payments is over, so they are paged directly now.",
      executedNotificationRules: PUSH_AND_TWO_REPEATS,
    });
    expect(sent).toEqual([
      { ruleId: CALL_RULE.toString(), repeatNumber: undefined },
      { ruleId: PUSH_RULE.toString(), repeatNumber: 3 },
    ]);
  });

  test("a workflow's page of her waits while Payments' page is open, sending nothing", async () => {
    await executePendingNotificationLog(
      mergedPage({ isDirectPage: true }),
      MEMBER,
    );

    expect(sent).toEqual([]);
    expect(updates).toEqual([]);
  });

  test("Billing's page of her takes over Jane's page, which she escalated: its line names Jane, as the merged line did", async () => {
    cover = coverPage({
      status: UserNotificationExecutionStatus.PassedOn,
      sent: PUSH_AND_TWO_REPEATS,
      sentByJane: true,
    });

    await executePendingNotificationLog(
      mergedPage({
        line: getOnCallPageMergedLine({
          kind: OnCallPageCoverKind.PersonPage,
          name: "Jane Doe",
        }),
      }),
      MEMBER,
    );

    expect(updates[0]).toEqual({
      status: UserNotificationExecutionStatus.Executing,
      statusMessage:
        "Their page from Jane Doe is over, so this policy pages them now.",
      executedNotificationRules: PUSH_AND_TWO_REPEATS,
    });
  });

  test("answering Jane's page answers Billing's merged into it", async () => {
    const acknowledgedAt: Date = new Date(Date.now() - 60 * 1000);
    cover = coverPage({
      status: UserNotificationExecutionStatus.Completed,
      acknowledgedAt: acknowledgedAt,
      sentByJane: true,
    });

    await executePendingNotificationLog(
      mergedPage({
        line: getOnCallPageMergedLine({
          kind: OnCallPageCoverKind.PersonPage,
          name: "Jane Doe",
        }),
      }),
      MEMBER,
    );

    expect(sent).toEqual([]);
    expect(answered).toHaveLength(1);
    expect(answered[0]).toMatchObject({
      userOnCallLogId: LOG_ID,
      acknowledgedAt: acknowledgedAt,
      isAnsweredWithAnotherPage: true,
    });
  });
});
