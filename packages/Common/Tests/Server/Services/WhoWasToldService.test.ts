jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../Models/DatabaseModels/Alert";
import EmailLog from "../../../Models/DatabaseModels/EmailLog";
import Incident from "../../../Models/DatabaseModels/Incident";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import SmsLog from "../../../Models/DatabaseModels/SmsLog";
import WebhookLog from "../../../Models/DatabaseModels/WebhookLog";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import AlertService from "../../../Server/Services/AlertService";
import CallLogService from "../../../Server/Services/CallLogService";
import EmailLogService from "../../../Server/Services/EmailLogService";
import IncidentService from "../../../Server/Services/IncidentService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import PushNotificationLogService from "../../../Server/Services/PushNotificationLogService";
import SmsLogService from "../../../Server/Services/SmsLogService";
import TelegramLogService from "../../../Server/Services/TelegramLogService";
import WebhookLogService from "../../../Server/Services/WebhookLogService";
import WhatsAppLogService from "../../../Server/Services/WhatsAppLogService";
import WhoWasToldService from "../../../Server/Services/WhoWasToldService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import MailStatus from "../../../Types/Mail/MailStatus";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import {
  WHO_WAS_TOLD_ROWS_PER_KIND,
  WhoWasToldResult,
  WhoWasToldStatus,
} from "../../../Types/Notification/WhoWasTold";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { OnCallTestPageRecordKind } from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import PositiveNumber from "../../../Types/PositiveNumber";
import SmsStatus from "../../../Types/SmsStatus";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import WebhookStatus from "../../../Types/WebhookStatus";
import WorkspaceNotificationActionType from "../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHO WAS TOLD ABOUT AN INCIDENT OR AN ALERT, READ AS ITS READER (#7075).
 *
 * The service reads the record as the person asking - a private incident
 * they may not see is not found, and nothing about it is read - then every
 * run, step and log as them, and counts what they may not read as OneUptime
 * too, so only the number leaves. Status page subscribers are counted, never
 * listed. Each rule here has a test; the services are stubbed, and the rows
 * they answer are what each read would return for the caller.
 */

type Spy = jest.SpyInstance;

const PROJECT: ObjectID = new ObjectID("70750000-0000-4000-8000-000000000001");
const INCIDENT: ObjectID = new ObjectID("70750000-0000-4000-8000-000000000002");
const ALERT: ObjectID = new ObjectID("70750000-0000-4000-8000-000000000003");
const RUN_1: ObjectID = new ObjectID("70750000-0000-4000-8000-0000000000a1");
const ANA: ObjectID = new ObjectID("70750000-0000-4000-8000-0000000000b1");
const BEN: ObjectID = new ObjectID("70750000-0000-4000-8000-0000000000b2");

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: new ObjectID("70750000-0000-4000-8000-0000000000c1"),
};

const AT: (minute: number) => Date = (minute: number): Date => {
  return new Date(Date.UTC(2026, 10, 17, 10, minute, 0));
};

const LOG_SERVICES: Array<{
  findBy: unknown;
  countBy: unknown;
}> = [
  EmailLogService,
  SmsLogService,
  CallLogService,
  PushNotificationLogService,
  WhatsAppLogService,
  TelegramLogService,
  WebhookLogService,
  WorkspaceNotificationLogService,
];

interface Read {
  query: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
}

// The SQL a query's raw condition writes for `column`, to tell IS NULL from IS NOT NULL.
function sqlOf(value: unknown, column: string): string {
  const operator: { getSql?: (alias: string) => string } = value as {
    getSql?: (alias: string) => string;
  };

  return operator?.getSql ? operator.getSql(column) : String(value);
}

function isRoot(read: Read): boolean {
  return Boolean(read.props?.isRoot);
}

function isSubscriberRead(read: Read): boolean {
  return sqlOf(read.query["statusPageId"], "s") === "(s IS NOT NULL)";
}

function count(value: number): PositiveNumber {
  return new PositiveNumber(value);
}

let findSpies: Map<unknown, Spy>;
let countSpies: Map<unknown, Spy>;

function findOf(service: unknown): Spy {
  return findSpies.get(service)!;
}

function countOf(service: unknown): Spy {
  return countSpies.get(service)!;
}

function readsOf(spy: Spy): Array<Read> {
  return spy.mock.calls.map((call: Array<unknown>): Read => {
    return call[0] as Read;
  });
}

let runFind: Spy;
let runCount: Spy;
let stepFind: Spy;
let incidentFind: Spy;
let alertFind: Spy;

function readableIncident(): Incident {
  return Object.assign(new Incident(), {
    _id: INCIDENT.toString(),
    subscriberNotificationStatusOnIncidentCreated:
      StatusPageSubscriberNotificationStatus.Success,
    subscriberNotificationStatusMessage: "Notification sent to 3 pages.",
  });
}

beforeEach(() => {
  findSpies = new Map<unknown, Spy>();
  countSpies = new Map<unknown, Spy>();

  for (const service of LOG_SERVICES) {
    findSpies.set(
      service,
      jest
        .spyOn(service as never, "findBy" as never)
        .mockResolvedValue([] as never),
    );
    countSpies.set(
      service,
      jest
        .spyOn(service as never, "countBy" as never)
        .mockResolvedValue(count(0) as never),
    );
  }

  incidentFind = jest
    .spyOn(IncidentService, "findOneBy")
    .mockResolvedValue(readableIncident() as never);
  alertFind = jest
    .spyOn(AlertService, "findOneBy")
    .mockResolvedValue(
      Object.assign(new Alert(), { _id: ALERT.toString() }) as never,
    );
  runFind = jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
    .mockResolvedValue([] as never);
  runCount = jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "countBy")
    .mockResolvedValue(count(0) as never);
  stepFind = jest
    .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findBy")
    .mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function readIncident(): Promise<WhoWasToldResult> {
  return await WhoWasToldService.getForIncident({
    projectId: PROJECT,
    incidentId: INCIDENT,
    props: PROPS,
  });
}

function aRun(): OnCallDutyPolicyExecutionLog {
  return Object.assign(new OnCallDutyPolicyExecutionLog(), {
    _id: RUN_1.toString(),
    status: OnCallDutyPolicyStatus.Executing,
    statusMessage: "",
    createdAt: AT(0),
    onCallDutyPolicyId: new ObjectID("70750000-0000-4000-8000-0000000000d1"),
    onCallDutyPolicy: { name: "Default" },
    acknowledgedAt: AT(3),
    acknowledgedByUser: { name: "Ana Lopez" },
  });
}

function aStep(): OnCallDutyPolicyExecutionLogTimeline {
  return Object.assign(new OnCallDutyPolicyExecutionLogTimeline(), {
    _id: "70750000-0000-4000-8000-0000000000e1",
    onCallDutyPolicyExecutionLogId: RUN_1,
    status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
    statusMessage: "Acknowledged.",
    createdAt: AT(1),
    isAcknowledged: true,
    acknowledgedAt: AT(3),
    alertSentToUserId: ANA,
    alertSentToUser: { name: "Ana Lopez" },
    onCallDutyPolicyEscalationRule: { name: "First responders" },
    // The level's place, as the line kept it when it was written.
    escalationRuleOrder: 1,
    userBelongsToTeam: { name: "Platform" },
    notificationChannels: [OnCallPageChannel.SMS, OnCallPageChannel.Email],
  });
}

describe("the record is read first, as its reader", () => {
  test("an incident the caller may not read - a private one - is not found, and nothing about it is read", async () => {
    incidentFind.mockResolvedValue(null as never);

    await expect(readIncident()).rejects.toBeInstanceOf(NotFoundException);

    expect((incidentFind.mock.calls[0]![0] as Read).props).toBe(PROPS);
    expect((incidentFind.mock.calls[0]![0] as Read).query).toMatchObject({
      _id: INCIDENT.toString(),
      projectId: PROJECT,
    });
    expect(runFind).not.toHaveBeenCalled();
    expect(runCount).not.toHaveBeenCalled();
    for (const service of LOG_SERVICES) {
      expect(findOf(service)).not.toHaveBeenCalled();
      expect(countOf(service)).not.toHaveBeenCalled();
    }
  });

  test("an alert the caller may not read is not found, and nothing about it is read", async () => {
    alertFind.mockResolvedValue(null as never);

    await expect(
      WhoWasToldService.getForAlert({
        projectId: PROJECT,
        alertId: ALERT,
        props: PROPS,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect((alertFind.mock.calls[0]![0] as Read).props).toBe(PROPS);
    expect(runFind).not.toHaveBeenCalled();
    expect(findOf(SmsLogService)).not.toHaveBeenCalled();
  });
});

describe("every row is read as the caller, about this record only", () => {
  test("runs, steps and each kind of log are read with the caller's props, and the logs never list a subscriber", async () => {
    runFind.mockResolvedValue([aRun()] as never);
    stepFind.mockResolvedValue([aStep()] as never);

    await readIncident();

    expect((runFind.mock.calls[0]![0] as Read).props).toBe(PROPS);
    expect((runFind.mock.calls[0]![0] as Read).query).toEqual({
      projectId: PROJECT,
      triggeredByIncidentId: INCIDENT,
    });
    expect((stepFind.mock.calls[0]![0] as Read).props).toBe(PROPS);

    for (const service of LOG_SERVICES) {
      const reads: Array<Read> = readsOf(findOf(service));

      expect(reads).toHaveLength(1);
      expect(reads[0]!.props).toBe(PROPS);
      expect(reads[0]!.query["projectId"]).toBe(PROJECT);
      expect(reads[0]!.query["incidentId"]).toBe(INCIDENT);
      expect(sqlOf(reads[0]!.query["statusPageId"], "s")).toBe("(s IS NULL)");
    }
  });

  test("the workspace logs read are the messages posted, not channels made or people invited", async () => {
    await readIncident();

    expect(
      readsOf(findOf(WorkspaceNotificationLogService))[0]!.query["actionType"],
    ).toBe(WorkspaceNotificationActionType.SendMessage);
  });

  test("the steps read are those of the runs the caller may read", async () => {
    runFind.mockResolvedValue([aRun()] as never);

    await readIncident();

    const query: Record<string, unknown> = (stepFind.mock.calls[0]![0] as Read)
      .query;
    expect(query["projectId"]).toBe(PROJECT);
    expect(sqlOf(query["onCallDutyPolicyExecutionLogId"], "r")).toContain(
      "r IN",
    );
  });

  /*
   * A rule's order is no column a reader may read through a relation: the
   * real read refuses the whole find (the Postgres suite found it). The
   * steps ask a level's name only, and take its place from the line.
   */
  test("the steps ask a level's name through its rule, never its order", async () => {
    runFind.mockResolvedValue([aRun()] as never);

    await readIncident();

    const select: Record<string, unknown> = (
      stepFind.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(select["onCallDutyPolicyEscalationRule"]).toEqual({ name: true });
    expect(select["escalationRuleOrder"]).toBe(true);
  });

  test("with no run the caller may read, no step is read", async () => {
    await readIncident();

    expect(stepFind).not.toHaveBeenCalled();
  });

  test("an alert reads its own runs and logs, and has no subscribers", async () => {
    const result: WhoWasToldResult = await WhoWasToldService.getForAlert({
      projectId: PROJECT,
      alertId: ALERT,
      props: PROPS,
    });

    expect((runFind.mock.calls[0]![0] as Read).query).toEqual({
      projectId: PROJECT,
      triggeredByAlertId: ALERT,
    });
    expect(readsOf(findOf(EmailLogService))[0]!.query["alertId"]).toBe(ALERT);
    expect(readsOf(findOf(EmailLogService))[0]!.query["incidentId"]).toBe(
      undefined,
    );
    expect(result.recordKind).toBe(OnCallTestPageRecordKind.Alert);
    expect(result.subscribers).toBeUndefined();
    expect(
      readsOf(countOf(EmailLogService)).filter(isSubscriberRead),
    ).toHaveLength(0);
  });
});

describe("the chain as the caller may read it", () => {
  test("a run, its step and the logs make one person, acknowledged, with each notification", async () => {
    runFind.mockResolvedValue([aRun()] as never);
    stepFind.mockResolvedValue([aStep()] as never);
    findOf(SmsLogService).mockResolvedValue([
      Object.assign(new SmsLog(), {
        _id: "70750000-0000-4000-8000-0000000000f1",
        status: SmsStatus.Delivered,
        createdAt: AT(1),
        userId: ANA,
        user: { name: "Ana Lopez" },
        onCallDutyPolicyId: new ObjectID(
          "70750000-0000-4000-8000-0000000000d1",
        ),
      }),
    ] as never);
    findOf(EmailLogService).mockResolvedValue([
      Object.assign(new EmailLog(), {
        _id: "70750000-0000-4000-8000-0000000000f2",
        status: MailStatus.Error,
        statusMessage: "Mailbox full.",
        createdAt: AT(2),
        userId: BEN,
        user: { email: "ben@example.com" },
        toEmail: "ben@example.com",
      }),
    ] as never);

    const result: WhoWasToldResult = await readIncident();

    expect(result.people).toHaveLength(2);
    const [ana, ben] = result.people;
    expect(ana).toMatchObject({
      userId: ANA.toString(),
      name: "Ana Lopez",
      status: WhoWasToldStatus.Acknowledged,
    });
    expect(ana!.pages[0]).toMatchObject({
      policyName: "Default",
      levelOrder: 1,
      levelName: "First responders",
      teamName: "Platform",
      channels: [OnCallPageChannel.SMS, OnCallPageChannel.Email],
    });
    expect(ana!.notifications[0]).toMatchObject({
      channel: OnCallPageChannel.SMS,
      status: "Delivered",
      isOnCallPage: true,
    });
    // Named by their email when their name is not known.
    expect(ben).toMatchObject({
      name: "ben@example.com",
      status: WhoWasToldStatus.Failed,
      failedCount: 1,
    });
    expect(ben!.notifications[0]!.statusMessage).toBe("Mailbox full.");
    expect(result.runs[0]).toMatchObject({
      policyName: "Default",
      acknowledgedByName: "Ana Lopez",
    });
  });

  test("a webhook is listed by its host, never its address's path or key", async () => {
    findOf(WebhookLogService).mockResolvedValue([
      Object.assign(new WebhookLog(), {
        _id: "70750000-0000-4000-8000-0000000000f3",
        status: WebhookStatus.Error,
        statusMessage: "Answered 500.",
        createdAt: AT(2),
        webhookUrl: "https://hooks.example.com/services/SECRET-KEY",
      }),
    ] as never);

    const result: WhoWasToldResult = await readIncident();

    expect(result.channels[0]).toMatchObject({
      channel: OnCallPageChannel.Webhook,
      name: "hooks.example.com",
      status: WhoWasToldStatus.Failed,
    });
    expect(JSON.stringify(result)).not.toContain("SECRET-KEY");
  });

  test("a workspace message is listed by its channel", async () => {
    findOf(WorkspaceNotificationLogService).mockResolvedValue([
      Object.assign(new WorkspaceNotificationLog(), {
        _id: "70750000-0000-4000-8000-0000000000f4",
        status: WorkspaceNotificationStatus.Success,
        createdAt: AT(2),
        workspaceType: WorkspaceType.Slack,
        channelId: "C123",
        channelName: "#incidents",
      }),
    ] as never);

    const result: WhoWasToldResult = await readIncident();

    expect(result.channels[0]).toMatchObject({
      channel: OnCallPageChannel.Slack,
      name: "#incidents",
      workspaceType: WorkspaceType.Slack,
      status: WhoWasToldStatus.Told,
    });
  });
});

describe("what the caller may not read is counted, never named", () => {
  test("a kind of log the caller may not read at all is counted as OneUptime, and none of it listed", async () => {
    findOf(SmsLogService).mockRejectedValue(
      new NotAuthorizedException("You may not read SMS logs."),
    );
    countOf(SmsLogService).mockImplementation((async (read: Read) => {
      return count(isRoot(read) ? 4 : 0);
    }) as never);

    const result: WhoWasToldResult = await readIncident();

    expect(result.hiddenNotificationCount).toBe(4);
    expect(result.people).toEqual([]);
    // The caller's own count of them was never asked: their read was refused.
    const counted: Array<Read> = readsOf(countOf(SmsLogService)).filter(
      (read: Read): boolean => {
        return !isSubscriberRead(read);
      },
    );
    expect(counted.length).toBeGreaterThan(0);
    expect(counted.every(isRoot)).toBe(true);
  });

  test("rows the caller may read are not counted as hidden; rows only OneUptime reads are", async () => {
    findOf(EmailLogService).mockResolvedValue([
      Object.assign(new EmailLog(), {
        _id: "70750000-0000-4000-8000-0000000000f5",
        status: MailStatus.Success,
        createdAt: AT(1),
        userId: ANA,
        user: { name: "Ana Lopez" },
      }),
    ] as never);
    countOf(EmailLogService).mockImplementation((async (read: Read) => {
      return count(isRoot(read) ? 3 : 1);
    }) as never);

    const result: WhoWasToldResult = await readIncident();

    expect(result.hiddenNotificationCount).toBe(2);
    expect(result.people).toHaveLength(1);
  });

  test("the hidden count is of people and channels: subscriber logs are never in it", async () => {
    countOf(EmailLogService).mockImplementation((async (read: Read) => {
      return count(isSubscriberRead(read) ? 900 : isRoot(read) ? 1 : 0);
    }) as never);

    const result: WhoWasToldResult = await readIncident();

    expect(result.hiddenNotificationCount).toBe(1);
    for (const read of readsOf(countOf(EmailLogService)).filter(isRoot)) {
      expect(sqlOf(read.query["statusPageId"], "s")).toBe("(s IS NULL)");
    }
  });

  test("runs of a policy the caller may not read are counted, and their steps never read", async () => {
    runFind.mockResolvedValue([aRun()] as never);
    runCount.mockImplementation((async (read: Read) => {
      return count(isRoot(read) ? 2 : 1);
    }) as never);

    const result: WhoWasToldResult = await readIncident();

    expect(result.hiddenRunCount).toBe(1);
    expect(result.runs).toHaveLength(1);
    expect((stepFind.mock.calls[0]![0] as Read).props).toBe(PROPS);
  });

  test("runs the caller may not read at all are counted", async () => {
    runFind.mockRejectedValue(new NotAuthorizedException("No."));
    runCount.mockImplementation((async (read: Read) => {
      return count(isRoot(read) ? 3 : 0);
    }) as never);

    const result: WhoWasToldResult = await readIncident();

    expect(result.hiddenRunCount).toBe(3);
    expect(result.runs).toEqual([]);
    expect(stepFind).not.toHaveBeenCalled();
  });

  test("on-call that is not on the project's plan is neither shown nor counted", async () => {
    runFind.mockRejectedValue(
      new PaymentRequiredException("On-call is on the Growth plan."),
    );

    const result: WhoWasToldResult = await readIncident();

    expect(result.hiddenRunCount).toBe(0);
    expect(runCount).not.toHaveBeenCalled();
  });

  test("a count that fails says nothing is hidden, rather than failing the answer", async () => {
    countOf(CallLogService).mockImplementation((async (read: Read) => {
      if (isRoot(read)) {
        throw new Error("The database is busy.");
      }

      return count(0);
    }) as never);

    const result: WhoWasToldResult = await readIncident();

    expect(result.hiddenNotificationCount).toBe(0);
  });

  test("a read that fails otherwise fails the answer, rather than saying nobody was told", async () => {
    findOf(PushNotificationLogService).mockRejectedValue(
      new Error("The database is down."),
    );

    await expect(readIncident()).rejects.toThrow("The database is down.");
  });

  test("a read cut at its limit is counted as the caller, and said to be cut", async () => {
    const rows: Array<SmsLog> = Array.from(
      { length: WHO_WAS_TOLD_ROWS_PER_KIND },
      (_unused: unknown, index: number): SmsLog => {
        return Object.assign(new SmsLog(), {
          _id: `70750000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          status: SmsStatus.Delivered,
          createdAt: AT(1),
          userId: ANA,
        });
      },
    );
    findOf(SmsLogService).mockResolvedValue(rows as never);
    countOf(SmsLogService).mockImplementation((async (read: Read) => {
      return count(isRoot(read) ? 620 : 600);
    }) as never);

    const result: WhoWasToldResult = await readIncident();

    expect(result.isTruncated).toBe(true);
    expect(result.hiddenNotificationCount).toBe(20);
    expect(
      readsOf(countOf(SmsLogService)).some((read: Read): boolean => {
        return read.props === PROPS;
      }),
    ).toBe(true);
  });
});

describe("an incident's status page subscribers", () => {
  test("are its created notification's status, and their emails and SMS counted as the caller - never listed", async () => {
    countOf(EmailLogService).mockImplementation((async (read: Read) => {
      if (!isSubscriberRead(read)) {
        return count(0);
      }

      return count(read.query["status"] ? 2 : 40);
    }) as never);
    countOf(SmsLogService).mockImplementation((async (read: Read) => {
      if (!isSubscriberRead(read)) {
        return count(0);
      }

      return count(read.query["status"] ? 1 : 5);
    }) as never);

    const result: WhoWasToldResult = await readIncident();

    expect(result.subscribers).toEqual({
      status: StatusPageSubscriberNotificationStatus.Success,
      statusMessage: "Notification sent to 3 pages.",
      sentCount: 42,
      failedCount: 3,
      areCountsReadable: true,
    });

    const subscriberReads: Array<Read> = [
      ...readsOf(countOf(EmailLogService)),
      ...readsOf(countOf(SmsLogService)),
    ].filter(isSubscriberRead);

    expect(subscriberReads).toHaveLength(4);
    for (const read of subscriberReads) {
      expect(read.props).toBe(PROPS);
      expect(read.query["incidentId"]).toBe(INCIDENT);
    }
    expect(result.people).toEqual([]);
  });

  test("counts the caller may not read say so, and nothing is counted", async () => {
    countOf(EmailLogService).mockImplementation((async (read: Read) => {
      if (isSubscriberRead(read)) {
        throw new NotAuthorizedException("You may not read email logs.");
      }

      return count(0);
    }) as never);

    const result: WhoWasToldResult = await readIncident();

    expect(result.subscribers).toMatchObject({
      status: StatusPageSubscriberNotificationStatus.Success,
      sentCount: 0,
      failedCount: 0,
      areCountsReadable: false,
    });
  });
});
