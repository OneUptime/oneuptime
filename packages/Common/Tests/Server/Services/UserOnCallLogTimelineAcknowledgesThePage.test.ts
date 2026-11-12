import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import ProjectMilestoneService from "../../../Server/Services/ProjectMilestoneService";
import {
  ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
  recordAcknowledgement,
  recordPassOn,
  recordSendResult,
  STUCK_NOTIFICATION_STATUS_MESSAGE,
} from "../../../Server/Utils/OnCall/OnCallNotificationStatus";
import OnCallPolicyRunMessage from "../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * AN ACKNOWLEDGEMENT WRITTEN ON A NOTIFICATION ACKNOWLEDGES THE PAGE (issue
 * #7082).
 *
 * The person acknowledges a page from one of its messages - its link, a
 * call's 1, a custom channel's button - and OnCallNotificationStatus writes
 * the notification Acknowledged at the status and the version it read it at
 * (recordAcknowledgement), so a send that finishes late never writes over
 * it. The notification's update hook (UserOnCallLogTimelineService
 * .onUpdateSuccess) then acknowledges the person's page, the run and the
 * record (acknowledgePage) - what stops the escalation.
 *
 * The hook reads the notification the update wrote. Read by the update's
 * own query - the status and the version as they were BEFORE the write -
 * it finds nothing once the write moved them on, and the page was never
 * acknowledged: every acknowledgement from a message left the escalation
 * running. So it reads the rows the update wrote, by their ids.
 *
 * These run the real update pipeline - DatabaseService's compare-and-set,
 * the hooks - over the notification held in memory (InMemoryRepository),
 * with only what the hook tells further along stood in for.
 */

const PROJECT: ObjectID = new ObjectID("0c0c7082-0000-4000-8000-0000000000b1");
const USER: ObjectID = new ObjectID("0c0c7082-0000-4000-8000-0000000000b2");
const USER_LOG: ObjectID = new ObjectID("0c0c7082-0000-4000-8000-0000000000b3");
const RUN: ObjectID = new ObjectID("0c0c7082-0000-4000-8000-0000000000b4");
const STEP: ObjectID = new ObjectID("0c0c7082-0000-4000-8000-0000000000b5");
const INCIDENT: ObjectID = new ObjectID("0c0c7082-0000-4000-8000-0000000000b6");
const SMS: ObjectID = new ObjectID("0c0c7082-0000-4000-8000-0000000000b7");
const NOTIFICATION: ObjectID = new ObjectID(
  "0c0c7082-0000-4000-8000-0000000000b8",
);
const OTHER_NOTIFICATION: ObjectID = new ObjectID(
  "0c0c7082-0000-4000-8000-0000000000b9",
);

const SENT_AT: Date = new Date("2026-11-12T09:00:00.000Z");
const ACKNOWLEDGED_AT: Date = new Date("2026-11-12T09:02:00.000Z");

type AcknowledgePage = typeof UserOnCallLogTimelineService.acknowledgePage;

let table: InMemoryTable;
let acknowledgePage: SpyInstance<AcknowledgePage>;

// Ana's SMS of a page about an incident, as its page wrote it.
function notificationRow(
  id: ObjectID,
  status: UserNotificationStatus,
  statusMessage: string,
): StoredRow {
  return {
    _id: id.toString(),
    projectId: PROJECT,
    userId: USER,
    userNotificationLogId: USER_LOG,
    onCallDutyPolicyExecutionLogId: RUN,
    onCallDutyPolicyExecutionLogTimelineId: STEP,
    triggeredByIncidentId: INCIDENT,
    userSmsId: SMS,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    status: status,
    statusMessage: statusMessage,
    isAcknowledged: false,
    version: 1,
    createdAt: SENT_AT,
  };
}

function given(status: UserNotificationStatus, statusMessage: string): void {
  table = useInMemoryTable(UserOnCallLogTimelineService, [
    notificationRow(NOTIFICATION, status, statusMessage),
    // Another of Ana's notifications of the page: never read for this one.
    notificationRow(
      OTHER_NOTIFICATION,
      UserNotificationStatus.Sent,
      "Email sent.",
    ),
  ]);
}

function stored(id: ObjectID = NOTIFICATION): StoredRow {
  return table.get(id)!;
}

function acknowledge(): Promise<boolean> {
  return recordAcknowledgement({
    userOnCallLogTimelineId: NOTIFICATION,
    statusMessage: ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
    acknowledgedAt: ACKNOWLEDGED_AT,
  });
}

beforeEach(() => {
  acknowledgePage = jest
    .spyOn(UserOnCallLogTimelineService, "acknowledgePage")
    .mockResolvedValue(undefined);

  // What the hook tells further along, for every status it writes.
  jest.spyOn(OnCallPolicyRunMessage, "refresh").mockImplementation(() => {
    return undefined;
  });
  jest
    .spyOn(
      OnCallDutyPolicyExecutionLogTimelineService,
      "refreshNotificationChannels",
    )
    .mockResolvedValue(undefined);
  jest
    .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "addNotificationToFeed")
    .mockResolvedValue(undefined);
  jest
    .spyOn(ProjectMilestoneService, "reachInBackground")
    .mockImplementation(() => {
      return undefined;
    });
  jest
    .spyOn(
      UserOnCallLogTimelineService as unknown as {
        recordTimeToSend: () => Promise<void>;
      },
      "recordTimeToSend",
    )
    .mockResolvedValue(undefined);

  given(UserNotificationStatus.Sent, "SMS sent.");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an acknowledgement from a notification acknowledges the person's page", () => {
  test.each([
    [UserNotificationStatus.Sending, "Sending SMS."],
    [UserNotificationStatus.Sent, "SMS sent."],
    [UserNotificationStatus.Error, "Twilio: the number is unreachable."],
    [UserNotificationStatus.NotAnswered, "Call not answered."],
    [UserNotificationStatus.PassedOn, ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE],
    [UserNotificationStatus.Error, STUCK_NOTIFICATION_STATUS_MESSAGE],
  ])(
    "over %s (%s): written at the status and the version read, and the page acknowledged",
    async (status: UserNotificationStatus, statusMessage: string) => {
      given(status, statusMessage);

      await expect(acknowledge()).resolves.toBe(true);

      expect(stored()["status"]).toBe(UserNotificationStatus.Acknowledged);
      expect(stored()["statusMessage"]).toBe(
        ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
      );
      expect(stored()["isAcknowledged"]).toBe(true);

      // The write named the status and the version it read the row at.
      const update: Array<unknown> =
        table.repository.update.mock.calls[0] || [];
      expect(update[0]).toEqual(
        expect.objectContaining({ _id: NOTIFICATION.toString(), version: 1 }),
      );

      // And the hook acknowledged the page the notification is of: once.
      expect(acknowledgePage).toHaveBeenCalledTimes(1);
    },
  );

  test("the page acknowledged is the notification's own: its person, their page, the run, the record, when and by what", async () => {
    await acknowledge();

    expect(acknowledgePage).toHaveBeenCalledTimes(1);

    const page: Parameters<AcknowledgePage>[0] =
      acknowledgePage.mock.calls[0]![0];

    expect({
      userOnCallLogId: page.userOnCallLogId?.toString(),
      userId: page.userId?.toString(),
      onCallDutyPolicyExecutionLogId:
        page.onCallDutyPolicyExecutionLogId?.toString(),
      onCallDutyPolicyExecutionLogTimelineId:
        page.onCallDutyPolicyExecutionLogTimelineId?.toString(),
      triggeredByIncidentId: page.triggeredByIncidentId?.toString(),
      projectId: page.projectId?.toString(),
      acknowledgedAt: page.acknowledgedAt.getTime(),
      channel: page.acknowledgedFrom?.channel,
      userNotificationEventType: page.userNotificationEventType,
    }).toEqual({
      userOnCallLogId: USER_LOG.toString(),
      userId: USER.toString(),
      onCallDutyPolicyExecutionLogId: RUN.toString(),
      onCallDutyPolicyExecutionLogTimelineId: STEP.toString(),
      triggeredByIncidentId: INCIDENT.toString(),
      projectId: PROJECT.toString(),
      acknowledgedAt: ACKNOWLEDGED_AT.getTime(),
      channel: OnCallPageChannel.SMS,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
    });
  });

  test("the hook reads the notification the update wrote, by its id - not by the update's query, which names the status and the version it no longer has", async () => {
    await acknowledge();

    const reads: Array<Record<string, unknown>> =
      table.repository.find.mock.calls.map((call: Array<unknown>) => {
        return (call[0] || {}) as Record<string, unknown>;
      });

    // The last read is the hook's: the acknowledged row, as it is now.
    const hookRead: Record<string, unknown> = reads[reads.length - 1]!;
    const where: Record<string, unknown> = (hookRead["where"] || {}) as Record<
      string,
      unknown
    >;

    expect(Object.keys(where)).not.toContain("status");
    expect(Object.keys(where)).not.toContain("version");
    expect(stored()["status"]).toBe(UserNotificationStatus.Acknowledged);
    expect(acknowledgePage).toHaveBeenCalledTimes(1);
  });

  test("a second acknowledgement writes nothing, and the page is acknowledged once", async () => {
    await expect(acknowledge()).resolves.toBe(true);
    await expect(acknowledge()).resolves.toBe(false);

    expect(acknowledgePage).toHaveBeenCalledTimes(1);
    expect(
      table.updates.filter((update: { id: string }) => {
        return update.id === NOTIFICATION.toString();
      }),
    ).toHaveLength(1);
  });

  test("another notification of the page is never touched by it", async () => {
    await acknowledge();

    expect(stored(OTHER_NOTIFICATION)["status"]).toBe(
      UserNotificationStatus.Sent,
    );
    expect(
      table.updates.map((update: { id: string }) => {
        return update.id;
      }),
    ).toEqual([NOTIFICATION.toString()]);
  });
});

describe("no other write acknowledges a page", () => {
  test("an escalation from the notification: Passed On, and the page is not acknowledged", async () => {
    await expect(
      recordPassOn({
        userOnCallLogTimelineId: NOTIFICATION,
        statusMessage: ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
      }),
    ).resolves.toBe(true);

    expect(stored()["status"]).toBe(UserNotificationStatus.PassedOn);
    expect(acknowledgePage).not.toHaveBeenCalled();
  });

  test("a send's result over Sending: Sent, and the page is not acknowledged", async () => {
    given(UserNotificationStatus.Sending, "Sending SMS.");

    await expect(
      recordSendResult({
        userOnCallLogTimelineId: NOTIFICATION,
        isSent: true,
        statusMessage: "SMS sent.",
      }),
    ).resolves.toBe(true);

    expect(stored()["status"]).toBe(UserNotificationStatus.Sent);
    expect(acknowledgePage).not.toHaveBeenCalled();
  });

  test("a send that finishes after the acknowledgement writes nothing over it, and acknowledges nothing again", async () => {
    given(UserNotificationStatus.Sending, "Sending SMS.");

    await acknowledge();

    await expect(
      recordSendResult({
        userOnCallLogTimelineId: NOTIFICATION,
        isSent: true,
        statusMessage: "SMS sent.",
      }),
    ).resolves.toBe(false);

    expect(stored()["status"]).toBe(UserNotificationStatus.Acknowledged);
    expect(acknowledgePage).toHaveBeenCalledTimes(1);
  });
});
