import User from "../../../Models/DatabaseModels/User";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import UserService from "../../../Server/Services/UserService";
import OnCallTestPageEvents, {
  TEST_PAGE_ACKNOWLEDGED_EVENT,
  TEST_PAGE_SENT_EVENT,
} from "../../../Server/Utils/OnCall/OnCallTestPageEvents";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import ProjectMilestoneService, {
  Service as ProjectMilestoneServiceClass,
} from "../../../Server/Services/ProjectMilestoneService";
import ProjectService from "../../../Server/Services/ProjectService";
import WelcomeChecklistService from "../../../Server/Services/WelcomeChecklistService";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageKind,
  OnCallTestPageRecordKind,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ACKNOWLEDGING A TEST PAGE (UserOnCallLogTimelineService.acknowledgeTestPage).
 *
 * A test page is acknowledged from its message - a link, a call's 1 - as a
 * real page is, and says who, by what and how long after the message went
 * out. There is no record to acknowledge and no timeout clock to start; the
 * first person to acknowledge it ends the run, and product analytics hears
 * it once (the activation milestone's hook, #6830). Everybody who
 * acknowledges it is noted for their own first steps on Home (#7043).
 */

const PROJECT: ObjectID = new ObjectID("7e5ac000-0000-4000-8000-000000000001");
const RUN: ObjectID = new ObjectID("7e5ac000-0000-4000-8000-000000000002");
const LINE: ObjectID = new ObjectID("7e5ac000-0000-4000-8000-000000000003");
const LOG: ObjectID = new ObjectID("7e5ac000-0000-4000-8000-000000000004");
const ROW: ObjectID = new ObjectID("7e5ac000-0000-4000-8000-000000000005");
const SMS_ID: ObjectID = new ObjectID("7e5ac000-0000-4000-8000-000000000006");
const ANA: ObjectID = new ObjectID("7e5ac000-0000-4000-8000-0000000000a1");

const SENT_AT: Date = new Date("2026-11-11T09:00:00.000Z");
const ACKNOWLEDGED_AT: Date = new Date("2026-11-11T09:00:14.000Z");

let logUpdate: jest.SpyInstance;
let runUpdate: jest.SpyInstance;
let lineUpdate: jest.SpyInstance;
let acknowledged: jest.SpyInstance;
let incidentAcknowledge: jest.SpyInstance;
let alertAcknowledge: jest.SpyInstance;
let clockStart: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(UserService, "findOneById").mockImplementation((async () => {
    const user: User = new User();
    user.id = ANA;
    user.name = new Name("Ana Lopez");
    user.email = new Email("ana@example.com");
    return user;
  }) as never);

  logUpdate = jest
    .spyOn(UserOnCallLogService, "updateOneById")
    .mockResolvedValue(undefined as never);
  runUpdate = jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneBy")
    .mockResolvedValue(1 as never);
  lineUpdate = jest
    .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
  acknowledged = jest
    .spyOn(OnCallTestPageEvents, "onTestPageAcknowledged")
    .mockImplementation(() => {
      return undefined;
    });
  incidentAcknowledge = jest
    .spyOn(IncidentService, "acknowledgeIncident")
    .mockResolvedValue(undefined as never);
  alertAcknowledge = jest
    .spyOn(AlertService, "acknowledgeAlert")
    .mockResolvedValue(undefined as never);
  clockStart = jest
    .spyOn(
      OnCallDutyPolicyExecutionLogService,
      "startAcknowledgementTimeoutClock",
    )
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function acknowledgeTest(acknowledgedFrom?: {
  channel?: OnCallPageChannel;
  sentAt?: Date;
}): Promise<void> {
  await UserOnCallLogTimelineService.acknowledgePage({
    userOnCallLogId: LOG,
    userId: ANA,
    onCallDutyPolicyExecutionLogId: RUN,
    onCallDutyPolicyExecutionLogTimelineId: LINE,
    acknowledgedAt: ACKNOWLEDGED_AT,
    userNotificationEventType: UserNotificationEventType.TestPage,
    acknowledgedFrom: acknowledgedFrom,
    projectId: PROJECT,
  });
}

const MESSAGE: string =
  "Test page acknowledged by Ana Lopez (ana@example.com) by SMS after 14 seconds.";

describe("a test page acknowledged from its message", () => {
  test("the person's log says who, by what, and how long after their message went out", async () => {
    await acknowledgeTest({ channel: OnCallPageChannel.SMS, sentAt: SENT_AT });

    expect(logUpdate).toHaveBeenCalledWith({
      id: LOG,
      data: {
        acknowledgedAt: ACKNOWLEDGED_AT,
        acknowledgedByUserId: ANA,
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: MESSAGE,
      },
      props: { isRoot: true },
    });
  });

  test("the run ends, saying it - only if nobody acknowledged it first", async () => {
    await acknowledgeTest({ channel: OnCallPageChannel.SMS, sentAt: SENT_AT });

    expect(runUpdate).toHaveBeenCalledTimes(1);

    const updateBy: {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
    } = runUpdate.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
    };

    expect(updateBy.query["_id"]).toBe(RUN.toString());
    // Whoever acknowledged it first stays its answer.
    expect(updateBy.query["acknowledgedAt"]).toBeDefined();
    expect(updateBy.data).toEqual({
      acknowledgedAt: ACKNOWLEDGED_AT,
      acknowledgedByUserId: ANA,
      status: OnCallDutyPolicyStatus.Completed,
      statusMessage: MESSAGE,
    });
  });

  test("the run's line for the person is acknowledged", async () => {
    await acknowledgeTest({ channel: OnCallPageChannel.SMS, sentAt: SENT_AT });

    expect(lineUpdate).toHaveBeenCalledWith({
      id: LINE,
      data: {
        acknowledgedAt: ACKNOWLEDGED_AT,
        isAcknowledged: true,
        status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
        statusMessage: MESSAGE,
      },
      props: { isRoot: true },
    });
  });

  test("no record is acknowledged and no timeout clock starts: there is none", async () => {
    await acknowledgeTest({ channel: OnCallPageChannel.SMS, sentAt: SENT_AT });

    expect(incidentAcknowledge).not.toHaveBeenCalled();
    expect(alertAcknowledge).not.toHaveBeenCalled();
    expect(clockStart).not.toHaveBeenCalled();
  });

  test("product analytics hears it, with the project, the run and the channel", async () => {
    await acknowledgeTest({ channel: OnCallPageChannel.SMS, sentAt: SENT_AT });

    expect(acknowledged).toHaveBeenCalledWith({
      projectId: PROJECT,
      executionLogId: RUN,
      acknowledgedByUserId: ANA,
      channel: OnCallPageChannel.SMS,
    });
  });

  test("acknowledged with no message behind it, it says only who", async () => {
    await acknowledgeTest();

    expect(
      (logUpdate.mock.calls[0]![0] as { data: { statusMessage: string } }).data
        .statusMessage,
    ).toBe("Test page acknowledged by Ana Lopez (ana@example.com).");
  });

  test("somebody who is not there any more is refused", async () => {
    jest.spyOn(UserService, "findOneById").mockResolvedValue(null as never);

    await expect(acknowledgeTest()).rejects.toThrow("User not found.");
    expect(logUpdate).not.toHaveBeenCalled();
  });
});

/*
 * A POLICY'S TEST PAGES SEVERAL PEOPLE, AND MORE THAN ONE MAY ANSWER IT
 * (#7043). The run keeps who answered first; each person who answers has
 * their own page acknowledged, and is told to what the test records - so
 * the teammate who answers second has their first steps on Home done too.
 */
describe("two people who acknowledge one policy's test", () => {
  const BEN: ObjectID = new ObjectID("7e5ac000-0000-4000-8000-0000000000b1");
  const BEN_LOG: ObjectID = new ObjectID(
    "7e5ac000-0000-4000-8000-0000000000b2",
  );
  const BEN_LINE: ObjectID = new ObjectID(
    "7e5ac000-0000-4000-8000-0000000000b3",
  );

  async function acknowledgeAs(page: {
    userId: ObjectID;
    logId: ObjectID;
    lineId: ObjectID;
    at: Date;
  }): Promise<void> {
    await UserOnCallLogTimelineService.acknowledgePage({
      userOnCallLogId: page.logId,
      userId: page.userId,
      onCallDutyPolicyExecutionLogId: RUN,
      onCallDutyPolicyExecutionLogTimelineId: page.lineId,
      acknowledgedAt: page.at,
      userNotificationEventType: UserNotificationEventType.TestPage,
      acknowledgedFrom: { channel: OnCallPageChannel.Call, sentAt: SENT_AT },
      projectId: PROJECT,
    });
  }

  beforeEach(() => {
    jest.spyOn(UserService, "findOneById").mockImplementation((async (data: {
      id: ObjectID;
    }) => {
      const user: User = new User();
      user.id = data.id;
      user.name = new Name(
        data.id.toString() === BEN.toString() ? "Ben Ode" : "Ana Lopez",
      );
      return user;
    }) as never);

    // The second finds the run answered already: it changes nothing there.
    runUpdate
      .mockResolvedValueOnce(1 as never)
      .mockResolvedValueOnce(0 as never);
  });

  test("each has their own page and line acknowledged; the run asks to keep the first", async () => {
    await acknowledgeAs({
      userId: ANA,
      logId: LOG,
      lineId: LINE,
      at: ACKNOWLEDGED_AT,
    });
    await acknowledgeAs({
      userId: BEN,
      logId: BEN_LOG,
      lineId: BEN_LINE,
      at: new Date(ACKNOWLEDGED_AT.getTime() + 30 * 1000),
    });

    expect(
      logUpdate.mock.calls.map((call: Array<unknown>) => {
        const update: {
          id: ObjectID;
          data: { acknowledgedByUserId: ObjectID };
        } = call[0] as {
          id: ObjectID;
          data: { acknowledgedByUserId: ObjectID };
        };

        return [update.id, update.data.acknowledgedByUserId];
      }),
    ).toEqual([
      [LOG, ANA],
      [BEN_LOG, BEN],
    ]);
    expect(
      lineUpdate.mock.calls.map((call: Array<unknown>) => {
        return (call[0] as { id: ObjectID }).id;
      }),
    ).toEqual([LINE, BEN_LINE]);

    // Both ask the run to take them only while nobody has answered it.
    for (const call of runUpdate.mock.calls) {
      expect(
        (call[0] as { query: Record<string, unknown> }).query["acknowledgedAt"],
      ).toBeDefined();
    }
  });

  test("each is told to what the test records, the second as the first", async () => {
    await acknowledgeAs({
      userId: ANA,
      logId: LOG,
      lineId: LINE,
      at: ACKNOWLEDGED_AT,
    });
    await acknowledgeAs({
      userId: BEN,
      logId: BEN_LOG,
      lineId: BEN_LINE,
      at: new Date(ACKNOWLEDGED_AT.getTime() + 30 * 1000),
    });

    expect(acknowledged).toHaveBeenCalledTimes(2);
    expect(
      acknowledged.mock.calls.map((call: Array<unknown>) => {
        return (call[0] as { acknowledgedByUserId: ObjectID })
          .acknowledgedByUserId;
      }),
    ).toEqual([ANA, BEN]);
  });

  test("and so each one's first steps on Home are noted", async () => {
    acknowledged.mockRestore();
    jest.spyOn(ProductAnalytics, "isConfigured").mockReturnValue(false);
    jest
      .spyOn(ProjectMilestoneService, "reachInBackground")
      .mockImplementation(() => {
        return undefined;
      });
    const note: jest.SpyInstance = jest
      .spyOn(WelcomeChecklistService, "noteTestPageAcknowledgedInBackground")
      .mockImplementation(() => {
        return undefined;
      });

    await acknowledgeAs({
      userId: ANA,
      logId: LOG,
      lineId: LINE,
      at: ACKNOWLEDGED_AT,
    });
    await acknowledgeAs({
      userId: BEN,
      logId: BEN_LOG,
      lineId: BEN_LINE,
      at: new Date(ACKNOWLEDGED_AT.getTime() + 30 * 1000),
    });

    expect(note.mock.calls).toEqual([
      [{ projectId: PROJECT, userId: ANA }],
      [{ projectId: PROJECT, userId: BEN }],
    ]);
  });
});

describe("the message a test page is acknowledged from", () => {
  test("is read from the notification acknowledged: its channel and when it went out", async () => {
    const page: jest.SpyInstance = jest
      .spyOn(UserOnCallLogTimelineService, "acknowledgePage")
      .mockResolvedValue(undefined as never);

    const row: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    row.id = ROW;
    row.projectId = PROJECT;
    row.userId = ANA;
    row.userNotificationLogId = LOG;
    row.onCallDutyPolicyExecutionLogId = RUN;
    row.onCallDutyPolicyExecutionLogTimelineId = LINE;
    row.userNotificationEventType = UserNotificationEventType.TestPage;
    row.userSmsId = SMS_ID;
    row.createdAt = SENT_AT;

    const findBy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogTimelineService, "findBy")
      .mockResolvedValue([row] as never);

    await (
      UserOnCallLogTimelineService as unknown as {
        onUpdateSuccess: (
          onUpdate: unknown,
          ids: Array<ObjectID>,
        ) => Promise<unknown>;
      }
    ).onUpdateSuccess(
      {
        updateBy: {
          query: { _id: ROW.toString() },
          data: { acknowledgedAt: ACKNOWLEDGED_AT, isAcknowledged: true },
          props: { isRoot: true },
        },
        carryForward: null,
      },
      [ROW],
    );

    const select: Record<string, unknown> = (
      findBy.mock.calls.find((call: Array<unknown>) => {
        return Boolean(
          (call[0] as { select?: Record<string, unknown> }).select?.[
            "userNotificationEventType"
          ],
        );
      })![0] as { select: Record<string, unknown> }
    ).select;

    expect(select["createdAt"]).toBe(true);
    expect(select["userSmsId"]).toBe(true);
    expect(select["userCallId"]).toBe(true);

    expect(page).toHaveBeenCalledTimes(1);
    expect(page.mock.calls[0]![0]).toMatchObject({
      userOnCallLogId: LOG,
      userId: ANA,
      onCallDutyPolicyExecutionLogId: RUN,
      userNotificationEventType: UserNotificationEventType.TestPage,
      acknowledgedFrom: {
        channel: OnCallPageChannel.SMS,
        sentAt: SENT_AT,
      },
      projectId: PROJECT,
    });
  });
});

describe("what a test page records", () => {
  let capture: jest.SpyInstance;
  let reach: jest.SpyInstance;
  let note: jest.SpyInstance;

  // The events are sent once the project's plan is read.
  async function settled(): Promise<void> {
    for (let i: number = 0; i < 5; i++) {
      await Promise.resolve();
    }
  }

  beforeEach(() => {
    acknowledged.mockRestore();
    capture = jest
      .spyOn(ProductAnalytics, "captureForUser")
      .mockImplementation(() => {
        return undefined;
      });
    jest.spyOn(ProductAnalytics, "isConfigured").mockReturnValue(true);
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({ planName: "Growth" } as never);
    reach = jest
      .spyOn(ProjectMilestoneService, "reachInBackground")
      .mockImplementation(() => {
        return undefined;
      });
    note = jest
      .spyOn(WelcomeChecklistService, "noteTestPageAcknowledgedInBackground")
      .mockImplementation(() => {
        return undefined;
      });
  });

  test("one acknowledged: that person's first steps on Home are done (#6807)", () => {
    OnCallTestPageEvents.onTestPageAcknowledged({
      projectId: PROJECT,
      executionLogId: RUN,
      acknowledgedByUserId: ANA,
    });

    expect(note).toHaveBeenCalledWith({ projectId: PROJECT, userId: ANA });
  });

  test("one sent, or one with no project, notes nobody", () => {
    OnCallTestPageEvents.onTestPageSent({
      projectId: PROJECT,
      executionLogId: RUN,
      sentByUserId: ANA,
      kind: OnCallTestPageKind.Policy,
      recordKind: OnCallTestPageRecordKind.Alert,
    });
    OnCallTestPageEvents.onTestPageAcknowledged({
      projectId: undefined,
      executionLogId: RUN,
      acknowledgedByUserId: ANA,
    });

    expect(note).not.toHaveBeenCalled();
  });

  test("one sent: who sent which kind, in which project, by the events' rule", async () => {
    OnCallTestPageEvents.onTestPageSent({
      projectId: PROJECT,
      executionLogId: RUN,
      sentByUserId: ANA,
      kind: OnCallTestPageKind.Policy,
      recordKind: OnCallTestPageRecordKind.Alert,
    });

    await settled();

    expect(capture).toHaveBeenCalledWith({
      userId: ANA,
      event: TEST_PAGE_SENT_EVENT,
      properties: {
        project_id: PROJECT.toString(),
        plan: "Growth",
        edition: ProjectMilestoneServiceClass.getEdition(),
        execution_log_id: RUN.toString(),
        kind: OnCallTestPageKind.Policy,
        record_kind: OnCallTestPageRecordKind.Alert,
      },
    });
    expect(TEST_PAGE_SENT_EVENT).toBe("test_page/sent");
    // Sending one is no milestone: acknowledging one is.
    expect(reach).not.toHaveBeenCalled();
  });

  test("one acknowledged: the project's milestone, and who, by what", async () => {
    OnCallTestPageEvents.onTestPageAcknowledged({
      projectId: PROJECT,
      executionLogId: RUN,
      acknowledgedByUserId: ANA,
      channel: OnCallPageChannel.Call,
    });

    expect(reach).toHaveBeenCalledWith({
      projectId: PROJECT,
      milestone: ActivationMilestone.FirstTestPageAcknowledged,
    });

    await settled();

    expect(capture).toHaveBeenCalledWith({
      userId: ANA,
      event: TEST_PAGE_ACKNOWLEDGED_EVENT,
      properties: {
        project_id: PROJECT.toString(),
        plan: "Growth",
        edition: ProjectMilestoneServiceClass.getEdition(),
        execution_log_id: RUN.toString(),
        channel: OnCallPageChannel.Call,
      },
    });
    expect(TEST_PAGE_ACKNOWLEDGED_EVENT).toBe("test_page/acknowledged");
  });

  test("where analytics is not set up, nothing is sent and no plan is read - the milestone is still kept", async () => {
    (ProductAnalytics.isConfigured as unknown as jest.Mock).mockReturnValue(
      false,
    );

    OnCallTestPageEvents.onTestPageAcknowledged({
      projectId: PROJECT,
      executionLogId: RUN,
      acknowledgedByUserId: ANA,
    });

    await settled();

    expect(capture).not.toHaveBeenCalled();
    expect(ProjectService.findOneById).not.toHaveBeenCalled();
    expect(reach).toHaveBeenCalledTimes(1);
  });

  test("analytics that fails never fails the test page", async () => {
    capture.mockImplementation(() => {
      throw new Error("analytics is down");
    });
    reach.mockImplementation(() => {
      throw new Error("milestones are down");
    });

    expect(() => {
      OnCallTestPageEvents.onTestPageAcknowledged({
        projectId: PROJECT,
        executionLogId: RUN,
        acknowledgedByUserId: ANA,
      });
    }).not.toThrow();

    await settled();
  });
});
