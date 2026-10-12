import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import OnCallPolicyRunMessage from "../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
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
 * EVERY CHANGE TO AN ON-CALL RUN BRINGS ITS ONE CHAT MESSAGE UP TO DATE -
 * AND NOTHING ELSE ABOUT THE RUN IS POSTED.
 *
 * The run's execution log, its step-by-step timeline and each page's
 * delivery rows each ask OnCallPolicyRunMessage to refresh the run's Slack /
 * Microsoft Teams message when they change. The feed entries they write for
 * the record stay - but go to the feed only: they used to be posted to every
 * channel too ("On Call Policy Started Executing", "Status Updated", "On-Call
 * Alert Notification Sent to <person>", in the maintainer's screenshots).
 *
 * A step's feed entry is written when its status CHANGES: a page marked
 * "Notification Sent" when it goes out and again when the person's rules
 * have all run used to write the entry twice, in the feed and in chat.
 */

type Hook = (...args: Array<unknown>) => Promise<unknown>;

function hookOf(service: unknown, name: string): Hook {
  return (service as Record<string, Hook>)[name]!.bind(service);
}

const PROJECT_ID: ObjectID = ObjectID.generate();
const RUN_ID: ObjectID = ObjectID.generate();
const OTHER_RUN_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();

let refreshSpy: SpyInstance<typeof OnCallPolicyRunMessage.refresh>;
let feedSpy: SpyInstance<typeof IncidentFeedService.createIncidentFeedItem>;

function refreshedIds(): Array<string> {
  return refreshSpy.mock.calls.map(
    (call: Array<ObjectID | string | null | undefined>): string => {
      return String(call[0]);
    },
  );
}

beforeEach(() => {
  refreshSpy = jest
    .spyOn(OnCallPolicyRunMessage, "refresh")
    .mockImplementation((): void => {
      return undefined;
    });
  feedSpy = jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("OnCallDutyPolicyExecutionLogService", () => {
  function newRun(): OnCallDutyPolicyExecutionLog {
    const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
    run.id = RUN_ID;
    run.projectId = PROJECT_ID;
    run.onCallDutyPolicyId = ObjectID.generate();
    run.triggeredByIncidentId = INCIDENT_ID;
    return run;
  }

  test("a new run asks for its message - and its 'Started Executing' entry is the feed's only", async () => {
    jest.spyOn(OnCallDutyPolicyService, "findOneById").mockResolvedValue({
      id: ObjectID.generate(),
      projectId: PROJECT_ID,
      name: "PolicyX",
    } as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
      .mockResolvedValue(null);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
      .mockResolvedValue(1);
    jest
      .spyOn(
        IncidentService,
        "getIncidentNumber",
      )
      .mockResolvedValue({ number: 8, numberWithPrefix: "INC-8" });
    jest
      .spyOn(
        IncidentService,
        "getIncidentLinkInDashboard",
      )
      .mockResolvedValue(
        URL.fromString(
          "https://oneuptime.test/incident",
        ),
      );

    await hookOf(OnCallDutyPolicyExecutionLogService, "onCreateSuccess")(
      { createBy: { data: newRun(), props: { isRoot: true } }, carryForward: {} },
      newRun(),
    );

    expect(refreshedIds()).toEqual([RUN_ID.toString()]);

    expect(feedSpy).toHaveBeenCalledTimes(1);
    const feed: Parameters<typeof IncidentFeedService.createIncidentFeedItem>[0] =
      feedSpy.mock.calls[0]![0];
    expect(feed.feedInfoInMarkdown).toContain(
      "On Call Policy Started Executing",
    );
    // REGRESSION (screenshot 5, red box): this used to be posted to Slack and Teams.
    expect(feed.workspaceNotification).toBeUndefined();
  });

  test("a run refused because its policy is archived still asks for its message: it says why nobody was paged", async () => {
    await hookOf(OnCallDutyPolicyExecutionLogService, "onCreateSuccess")(
      {
        createBy: { data: newRun(), props: { isRoot: true } },
        carryForward: { isPolicyArchived: true },
      },
      newRun(),
    );

    expect(refreshedIds()).toEqual([RUN_ID.toString()]);
    expect(feedSpy).not.toHaveBeenCalled();
  });

  test("every update of a run asks for its message - one that moves the escalation without a status too", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(null);

    await hookOf(OnCallDutyPolicyExecutionLogService, "onUpdateSuccess")(
      {
        updateBy: {
          query: { _id: RUN_ID.toString() },
          data: { lastExecutedEscalationRuleOrder: 2 },
          props: { isRoot: true },
        },
        carryForward: null,
      },
      [RUN_ID, OTHER_RUN_ID],
    );

    expect(refreshedIds()).toEqual([
      RUN_ID.toString(),
      OTHER_RUN_ID.toString(),
    ]);
    expect(feedSpy).not.toHaveBeenCalled();
  });

  test("a status update writes the feed entry, for the feed only", async () => {
    const stored: OnCallDutyPolicyExecutionLog = newRun();
    stored.status = OnCallDutyPolicyStatus.Executing;
    stored.statusMessage = "First escalation rule executed...";

    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(stored);
    jest.spyOn(OnCallDutyPolicyService, "findOneById").mockResolvedValue({
      id: ObjectID.generate(),
      projectId: PROJECT_ID,
      name: "PolicyX",
    } as never);
    jest
      .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
      .mockResolvedValue(
        URL.fromString(
          "https://oneuptime.test/policy",
        ),
      );
    jest
      .spyOn(IncidentService, "getIncidentNumber")
      .mockResolvedValue({ number: 8, numberWithPrefix: "INC-8" });
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(
        URL.fromString(
          "https://oneuptime.test/incident",
        ),
      );

    await hookOf(OnCallDutyPolicyExecutionLogService, "onUpdateSuccess")(
      {
        updateBy: {
          query: { _id: RUN_ID.toString() },
          data: { status: OnCallDutyPolicyStatus.Executing },
          props: { isRoot: true },
        },
        carryForward: null,
      },
      [RUN_ID],
    );

    expect(refreshedIds()).toEqual([RUN_ID.toString()]);
    expect(feedSpy).toHaveBeenCalledTimes(1);
    expect(feedSpy.mock.calls[0]![0].feedInfoInMarkdown).toContain(
      "On Call Policy Status Updated",
    );
    // REGRESSION (screenshot 5, red box): "Status Updated ... Started / Executing" in chat.
    expect(feedSpy.mock.calls[0]![0].workspaceNotification).toBeUndefined();
  });
});

describe("OnCallDutyPolicyExecutionLogTimelineService", () => {
  let feedBuilt: Array<string>;

  function step(
    status: OnCallDutyExecutionLogTimelineStatus,
    runId: ObjectID = RUN_ID,
  ): OnCallDutyPolicyExecutionLogTimeline {
    const row: OnCallDutyPolicyExecutionLogTimeline =
      new OnCallDutyPolicyExecutionLogTimeline();
    row.id = ObjectID.generate();
    row.status = status;
    row.onCallDutyPolicyExecutionLogId = runId;
    return row;
  }

  beforeEach(() => {
    feedBuilt = [];
    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "addToIncidentOrAlertFeed")
      .mockImplementation((async (data: {
        onCallDutyPolicyExecutionLogTimelineId: ObjectID;
      }): Promise<void> => {
        feedBuilt.push(data.onCallDutyPolicyExecutionLogTimelineId.toString());
      }) as never);
  });

  test("a new step writes its feed entry and asks for the run's message", async () => {
    const created: OnCallDutyPolicyExecutionLogTimeline = step(
      OnCallDutyExecutionLogTimelineStatus.Executing,
    );

    await hookOf(OnCallDutyPolicyExecutionLogTimelineService, "onCreateSuccess")(
      { createBy: { data: created, props: { isRoot: true } }, carryForward: null },
      created,
    );

    expect(feedBuilt).toEqual([created.id!.toString()]);
    expect(refreshedIds()).toEqual([RUN_ID.toString()]);
  });

  test("REGRESSION: a page marked Notification Sent a second time writes no second feed entry", async () => {
    const row: OnCallDutyPolicyExecutionLogTimeline = step(
      OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    );

    jest
      .spyOn(
        OnCallDutyPolicyExecutionLogTimelineService,
        "findRowsAndHoldUpdateToThem",
      )
      .mockResolvedValue([row]);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findBy")
      .mockResolvedValue([row]);

    const updateBy: Record<string, unknown> = {
      query: { _id: row.id!.toString() },
      data: {
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        statusMessage: "Alert Sent",
      },
      props: { isRoot: true },
    };

    // What the step said before: Notification Sent already.
    const onUpdate: { updateBy: unknown; carryForward: unknown } =
      (await hookOf(OnCallDutyPolicyExecutionLogTimelineService, "onBeforeUpdate")(
        updateBy,
      )) as { updateBy: unknown; carryForward: unknown };

    await hookOf(OnCallDutyPolicyExecutionLogTimelineService, "onUpdateSuccess")(
      onUpdate,
      [row.id],
    );

    expect(feedBuilt).toEqual([]);
    // The run's message still hears of it (and sends nothing if nothing changed).
    expect(refreshedIds()).toEqual([RUN_ID.toString()]);
  });

  test("a step whose status changes writes its feed entry once", async () => {
    const before: OnCallDutyPolicyExecutionLogTimeline = step(
      OnCallDutyExecutionLogTimelineStatus.Executing,
    );
    const after: OnCallDutyPolicyExecutionLogTimeline = step(
      OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    );
    after.id = before.id;

    jest
      .spyOn(
        OnCallDutyPolicyExecutionLogTimelineService,
        "findRowsAndHoldUpdateToThem",
      )
      .mockResolvedValue([before]);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findBy")
      .mockResolvedValue([after]);

    const onUpdate: { updateBy: unknown; carryForward: unknown } =
      (await hookOf(OnCallDutyPolicyExecutionLogTimelineService, "onBeforeUpdate")({
        query: { _id: before.id!.toString() },
        data: { status: OnCallDutyExecutionLogTimelineStatus.NotificationSent },
        props: { isRoot: true },
      })) as { updateBy: unknown; carryForward: unknown };

    expect(onUpdate.carryForward).toEqual({
      statusBeforeUpdate: {
        [before.id!.toString()]: OnCallDutyExecutionLogTimelineStatus.Executing,
      },
    });

    await hookOf(OnCallDutyPolicyExecutionLogTimelineService, "onUpdateSuccess")(
      onUpdate,
      [before.id],
    );

    expect(feedBuilt).toEqual([before.id!.toString()]);
    expect(refreshedIds()).toEqual([RUN_ID.toString()]);
  });

  test("an update that writes no status reads nothing before it and writes no feed entry", async () => {
    const row: OnCallDutyPolicyExecutionLogTimeline = step(
      OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    );
    const heldRead: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogTimelineService.findRowsAndHoldUpdateToThem
    > = jest
      .spyOn(
        OnCallDutyPolicyExecutionLogTimelineService,
        "findRowsAndHoldUpdateToThem",
      )
      .mockResolvedValue([row]);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findBy")
      .mockResolvedValue([row]);

    const onUpdate: { updateBy: unknown; carryForward: unknown } =
      (await hookOf(OnCallDutyPolicyExecutionLogTimelineService, "onBeforeUpdate")({
        query: { _id: row.id!.toString() },
        data: { statusMessage: "Retrying" },
        props: { isRoot: true },
      })) as { updateBy: unknown; carryForward: unknown };

    expect(heldRead).not.toHaveBeenCalled();

    await hookOf(OnCallDutyPolicyExecutionLogTimelineService, "onUpdateSuccess")(
      onUpdate,
      [row.id],
    );

    expect(feedBuilt).toEqual([]);
    expect(refreshedIds()).toEqual([RUN_ID.toString()]);
  });

  test("an update with no status read before it (an update from elsewhere) still writes its entry, as it always did", async () => {
    const row: OnCallDutyPolicyExecutionLogTimeline = step(
      OnCallDutyExecutionLogTimelineStatus.Skipped,
      OTHER_RUN_ID,
    );
    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findBy")
      .mockResolvedValue([row]);

    await hookOf(OnCallDutyPolicyExecutionLogTimelineService, "onUpdateSuccess")(
      {
        updateBy: {
          query: { _id: row.id!.toString() },
          data: { status: OnCallDutyExecutionLogTimelineStatus.Skipped },
          props: { isRoot: true },
        },
        carryForward: null,
      },
      [row.id],
    );

    expect(feedBuilt).toEqual([row.id!.toString()]);
    expect(refreshedIds()).toEqual([OTHER_RUN_ID.toString()]);
  });
});

describe("UserOnCallLogTimelineService - how a page reached somebody", () => {
  test("a delivery that is written asks for the run's message", async () => {
    const delivery: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    delivery.id = ObjectID.generate();
    delivery.onCallDutyPolicyExecutionLogId = RUN_ID;
    delivery.status = UserNotificationStatus.Sending;

    await hookOf(UserOnCallLogTimelineService, "onCreateSuccess")(
      { createBy: { data: delivery, props: { isRoot: true } }, carryForward: null },
      delivery,
    );

    expect(refreshedIds()).toEqual([RUN_ID.toString()]);
  });

  test("a delivery whose status changes asks for the message of each run it belongs to", async () => {
    const sent: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    sent.id = ObjectID.generate();
    sent.onCallDutyPolicyExecutionLogId = RUN_ID;

    const findBy: SpyInstance<typeof UserOnCallLogTimelineService.findBy> =
      jest.spyOn(UserOnCallLogTimelineService, "findBy").mockResolvedValue([sent]);

    await hookOf(UserOnCallLogTimelineService, "onUpdateSuccess")(
      {
        updateBy: {
          query: { _id: sent.id!.toString() },
          data: { status: UserNotificationStatus.Sent },
          props: { isRoot: true },
        },
        carryForward: null,
      },
      [sent.id],
    );

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(refreshedIds()).toEqual([RUN_ID.toString()]);
  });

  test("an update that writes no status asks for nothing", async () => {
    const findBy: SpyInstance<typeof UserOnCallLogTimelineService.findBy> =
      jest.spyOn(UserOnCallLogTimelineService, "findBy").mockResolvedValue([]);

    await hookOf(UserOnCallLogTimelineService, "onUpdateSuccess")(
      {
        updateBy: {
          query: { _id: ObjectID.generate().toString() },
          data: { statusMessage: "Sending..." },
          props: { isRoot: true },
        },
        carryForward: null,
      },
      [ObjectID.generate()],
    );

    expect(findBy).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
  });
});

describe("UserOnCallLogService - a skipped page never shows as sent", () => {
  test("REGRESSION: a skipped page's log is completed without its hook, so the step never reads 'Notification Sent' on the way to Skipped", async () => {
    const writes: Array<string> = [];

    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "updateOneById")
      .mockImplementation((async (data: {
        data: { status: OnCallDutyExecutionLogTimelineStatus };
      }): Promise<number> => {
        writes.push(`timeline:${data.data.status}`);
        return 1;
      }) as never);
    jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockImplementation((async (data: {
        data: { status: UserNotificationExecutionStatus };
        props: { isRoot?: boolean; ignoreHooks?: boolean };
      }): Promise<number> => {
        writes.push(
          `log:${data.data.status}:${data.props.isRoot ? "root" : "user"}:${data.props.ignoreHooks ? "without hooks" : "with hooks"}`,
        );
        return 1;
      }) as never);

    const createdItem: UserOnCallLog = new UserOnCallLog();
    createdItem.id = ObjectID.generate();
    createdItem.onCallDutyPolicyExecutionLogTimelineId = ObjectID.generate();

    await hookOf(UserOnCallLogService, "writeNoRuleOutcome")({
      createdItem: createdItem,
      status: UserNotificationExecutionStatus.Completed,
      timelineStatus: OnCallDutyExecutionLogTimelineStatus.Skipped,
      statusMessage: "You have opted out of notifications for Sev4 incidents.",
    });

    /*
     * The log's hook would have written the step as "Notification Sent"
     * (Completed) before the explicit write made it "Skipped": two feed
     * entries, the first one false.
     */
    expect(writes).toEqual([
      `log:${UserNotificationExecutionStatus.Completed}:root:without hooks`,
      `timeline:${OnCallDutyExecutionLogTimelineStatus.Skipped}`,
    ]);
  });

  async function complete(
    timelineStatus: OnCallDutyExecutionLogTimelineStatus,
  ): Promise<Array<OnCallDutyExecutionLogTimelineStatus>> {
    const written: Array<OnCallDutyExecutionLogTimelineStatus> = [];

    const log: UserOnCallLog = new UserOnCallLog();
    log.onCallDutyPolicyExecutionLogTimelineId = ObjectID.generate();
    const step: OnCallDutyPolicyExecutionLogTimeline =
      new OnCallDutyPolicyExecutionLogTimeline();
    step.status = timelineStatus;
    log.onCallDutyPolicyExecutionLogTimeline = step;

    jest.spyOn(UserOnCallLogService, "findBy").mockResolvedValue([log]);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "updateOneById")
      .mockImplementation((async (data: {
        data: { status: OnCallDutyExecutionLogTimelineStatus };
      }): Promise<number> => {
        written.push(data.data.status);
        return 1;
      }) as never);

    await hookOf(UserOnCallLogService, "onUpdateSuccess")(
      {
        updateBy: {
          query: { _id: ObjectID.generate().toString() },
          data: {
            status: UserNotificationExecutionStatus.Completed,
            statusMessage: "done",
          },
          props: { isRoot: true },
        },
        carryForward: null,
      },
      [],
    );

    return written;
  }

  test("a completed log marks a step still going out as Notification Sent, as it always did", async () => {
    expect(await complete(OnCallDutyExecutionLogTimelineStatus.Executing)).toEqual([
      OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    ]);
    expect(
      await complete(OnCallDutyExecutionLogTimelineStatus.NotificationSent),
    ).toEqual([OnCallDutyExecutionLogTimelineStatus.NotificationSent]);
  });

  test.each([
    OnCallDutyExecutionLogTimelineStatus.Skipped,
    OnCallDutyExecutionLogTimelineStatus.Error,
    OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
  ])(
    "a completed log leaves a step that already says what became of the page (%s) as it is",
    async (status: OnCallDutyExecutionLogTimelineStatus) => {
      expect(await complete(status)).toEqual([]);
    },
  );
});
