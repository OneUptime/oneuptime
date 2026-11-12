import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import CustomChannelActionToken from "../../../../Server/Utils/OnCall/CustomChannelActionToken";
import CustomChannelActions, {
  CUSTOM_CHANNEL_INVALID_LINK_MESSAGE,
  CUSTOM_CHANNEL_NOT_A_CHANNEL_PAGE_MESSAGE,
  CustomChannelActionAnswer,
} from "../../../../Server/Utils/OnCall/CustomChannelActions";
import OnCallPageLinkToken from "../../../../Server/Utils/OnCall/OnCallPageLinkToken";
import OnCallPagePassOn from "../../../../Server/Utils/OnCall/OnCallPagePassOn";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventType,
} from "../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import AlertEpisodeStateTimeline from "../../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import IncidentEpisodeStateTimeline from "../../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import UserOnCallLogTimeline from "../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CustomChannelAction,
  CustomChannelActionResult,
} from "../../../../Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import {
  OnCallPassOnAnswer,
  OnCallPassOnRefusal,
} from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import UserNotificationStatus from "../../../../Types/UserNotification/UserNotificationStatus";
import {
  MAX_NOTIFICATION_WRITE_ATTEMPTS,
  ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
  ON_CALL_NOTIFICATION_NOT_ACKNOWLEDGED_MESSAGE,
} from "../../../../Server/Utils/OnCall/OnCallNotificationStatus";
import {
  UpdateOneByInput,
  updateNotificationWhileStill,
} from "../../TestingUtils/OnCallTimelineRows";
import { afterEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * What a custom channel's service can do about a page: acknowledge,
 * escalate or resolve it, as the person it paged, only for a notification
 * that went out on a custom channel, and only with a valid token for it.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const CHANNEL_ID: ObjectID = ObjectID.generate();
const EXECUTION_LOG_ID: ObjectID = ObjectID.generate();

interface NotificationOptions {
  isAcknowledged?: boolean;
  status?: UserNotificationStatus;
  withChannel?: boolean;
  withExecutionLog?: boolean;
  record?: "incident" | "alert" | "incidentEpisode" | "alertEpisode" | "none";
  timezone?: string;
}

function notification(
  id: ObjectID,
  options: NotificationOptions = {},
): UserOnCallLogTimeline {
  const row: UserOnCallLogTimeline = new UserOnCallLogTimeline();
  row._id = id.toString();
  row.projectId = PROJECT_ID;
  row.userId = USER_ID;
  row.isAcknowledged = Boolean(options.isAcknowledged);
  row.status =
    options.status ||
    (options.isAcknowledged
      ? UserNotificationStatus.Acknowledged
      : UserNotificationStatus.Sent);
  row.statusMessage = "Delivered to the channel's service.";
  row.version = 1;

  if (options.withChannel !== false) {
    row.customNotificationChannelId = CHANNEL_ID;
  }

  if (options.withExecutionLog !== false) {
    row.onCallDutyPolicyExecutionLogId = EXECUTION_LOG_ID;
  }

  const record: string = options.record || "incident";

  if (record === "incident") {
    row.triggeredByIncidentId = ObjectID.generate();
  } else if (record === "alert") {
    row.triggeredByAlertId = ObjectID.generate();
  } else if (record === "incidentEpisode") {
    row.triggeredByIncidentEpisodeId = ObjectID.generate();
  } else if (record === "alertEpisode") {
    row.triggeredByAlertEpisodeId = ObjectID.generate();
  }

  const user: User = new User();
  if (options.timezone) {
    (user as unknown as Record<string, unknown>)["timezone"] = options.timezone;
  }
  row.user = user;

  return row;
}

/*
 * The notification as the database holds it: every read returns it as it
 * is now, and an update lands only while it still holds the status and the
 * version the update names - OnCallNotificationStatus's compare-and-set -
 * moving the version on. `meanwhile` lands just before the next update: a
 * write between the acknowledgement's read and its write.
 */
function setUp(options: NotificationOptions = {}): {
  id: ObjectID;
  token: string;
  row: UserOnCallLogTimeline;
  update: jest.SpyInstance;
  meanwhile: (change: (row: UserOnCallLogTimeline) => void) => void;
} {
  const id: ObjectID = ObjectID.generate();
  const row: UserOnCallLogTimeline = notification(id, options);
  const changes: Array<(row: UserOnCallLogTimeline) => void> = [];

  jest
    .spyOn(UserOnCallLogTimelineService, "findOneById")
    .mockResolvedValue(row);

  const update: jest.SpyInstance = jest
    .spyOn(UserOnCallLogTimelineService, "updateOneBy")
    .mockImplementation((async (
      updateBy: UpdateOneByInput,
    ): Promise<number> => {
      const change: ((row: UserOnCallLogTimeline) => void) | undefined =
        changes.shift();

      if (change) {
        change(row);
        row.version = (row.version || 0) + 1;
      }

      return updateNotificationWhileStill(row, updateBy);
    }) as never);

  return {
    id: id,
    token: CustomChannelActionToken.sign({ userOnCallLogTimelineId: id }),
    row: row,
    update: update,
    meanwhile: (change: (row: UserOnCallLogTimeline) => void): void => {
      changes.push(change);
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CustomChannelActions: what is refused", () => {
  test("an unknown action is refused before anything is read", async () => {
    const find: jest.SpyInstance = jest.spyOn(
      UserOnCallLogTimelineService,
      "findOneById",
    );

    await expect(
      CustomChannelActions.act({
        notificationId: ObjectID.generate().toString(),
        action: "delete",
        token: "anything",
      }),
    ).rejects.toThrow(BadDataException);

    expect(find).not.toHaveBeenCalled();
  });

  test.each(["", "not-a-uuid", "1234"])(
    "a notification id %p is refused",
    async (notificationId: string) => {
      await expect(
        CustomChannelActions.act({
          notificationId: notificationId,
          action: CustomChannelAction.Acknowledge,
          token: "anything",
        }),
      ).rejects.toThrow(BadDataException);
    },
  );

  test("a missing token is refused, and nothing is read", async () => {
    const find: jest.SpyInstance = jest.spyOn(
      UserOnCallLogTimelineService,
      "findOneById",
    );

    await expect(
      CustomChannelActions.act({
        notificationId: ObjectID.generate().toString(),
        action: CustomChannelAction.Acknowledge,
        token: undefined,
      }),
    ).rejects.toThrow(CUSTOM_CHANNEL_INVALID_LINK_MESSAGE);

    expect(find).not.toHaveBeenCalled();
  });

  test("a token for another notification is refused", async () => {
    const { id, update } = setUp();

    await expect(
      CustomChannelActions.act({
        notificationId: id.toString(),
        action: CustomChannelAction.Acknowledge,
        token: CustomChannelActionToken.sign({
          userOnCallLogTimelineId: ObjectID.generate(),
        }),
      }),
    ).rejects.toThrow(NotAuthorizedException);

    expect(update).not.toHaveBeenCalled();
  });

  test("an on-call page link's token is refused: a forwarded text must not resolve", async () => {
    const { id } = setUp();
    const resolve: jest.SpyInstance = jest.spyOn(
      WorkspaceMemberActions,
      "resolve",
    );

    await expect(
      CustomChannelActions.act({
        notificationId: id.toString(),
        action: CustomChannelAction.Resolve,
        token: OnCallPageLinkToken.sign({ userOnCallLogTimelineId: id }),
      }),
    ).rejects.toThrow(CUSTOM_CHANNEL_INVALID_LINK_MESSAGE);

    expect(resolve).not.toHaveBeenCalled();
  });

  test("a notification that no longer exists is refused", async () => {
    const id: ObjectID = ObjectID.generate();
    jest
      .spyOn(UserOnCallLogTimelineService, "findOneById")
      .mockResolvedValue(null);

    await expect(
      CustomChannelActions.act({
        notificationId: id.toString(),
        action: CustomChannelAction.Acknowledge,
        token: CustomChannelActionToken.sign({ userOnCallLogTimelineId: id }),
      }),
    ).rejects.toThrow(CUSTOM_CHANNEL_INVALID_LINK_MESSAGE);
  });

  test("a notification not sent on a custom channel is refused", async () => {
    const { id, token, update } = setUp({ withChannel: false });

    await expect(
      CustomChannelActions.act({
        notificationId: id.toString(),
        action: CustomChannelAction.Acknowledge,
        token: token,
      }),
    ).rejects.toThrow(CUSTOM_CHANNEL_NOT_A_CHANNEL_PAGE_MESSAGE);

    expect(update).not.toHaveBeenCalled();
  });

  test("the notification is read as root, by its own id", async () => {
    const { id, token } = setUp();

    await CustomChannelActions.act({
      notificationId: id.toString(),
      action: CustomChannelAction.Acknowledge,
      token: token,
    });

    const call: Record<string, unknown> = (
      UserOnCallLogTimelineService.findOneById as unknown as jest.Mock
    ).mock.calls[0]![0] as Record<string, unknown>;

    expect((call["id"] as ObjectID).toString()).toBe(id.toString());
    expect(call["props"]).toEqual({ isRoot: true });
  });
});

describe("CustomChannelActions: acknowledge", () => {
  test("acknowledges the page as its own link does", async () => {
    const { id, token, update } = setUp();

    const answer: CustomChannelActionAnswer = await CustomChannelActions.act({
      notificationId: id.toString(),
      action: CustomChannelAction.Acknowledge,
      token: token,
    });

    expect(answer).toEqual({
      action: CustomChannelAction.Acknowledge,
      result: CustomChannelActionResult.Acknowledged,
      message: "Acknowledged.",
    });

    expect(update).toHaveBeenCalledTimes(1);
    const call: Record<string, unknown> = update.mock.calls[0]![0] as never;
    const data: Record<string, unknown> = call["data"] as Record<
      string,
      unknown
    >;

    // At the status and the version read, so nothing written meanwhile is undone.
    expect(call["query"]).toEqual({
      _id: id.toString(),
      status: UserNotificationStatus.Sent,
      version: 1,
    });
    expect(data["isAcknowledged"]).toBe(true);
    expect(data["acknowledgedAt"]).toBeInstanceOf(Date);
    expect(data["status"]).toBe(UserNotificationStatus.Acknowledged);
    expect(data["statusMessage"]).toBe(
      ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
    );
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test.each([
    UserNotificationStatus.Sending,
    UserNotificationStatus.Error,
    UserNotificationStatus.PassedOn,
  ])(
    "a notification at %s is acknowledged too",
    async (status: UserNotificationStatus) => {
      const { id, token, row } = setUp({ status: status });

      const answer: CustomChannelActionAnswer = await CustomChannelActions.act({
        notificationId: id.toString(),
        action: CustomChannelAction.Acknowledge,
        token: token,
      });

      expect(answer.result).toBe(CustomChannelActionResult.Acknowledged);
      expect(row.status).toBe(UserNotificationStatus.Acknowledged);
      expect(row.isAcknowledged).toBe(true);
    },
  );

  test("a second press landing between this one's read and its write: answered as already acknowledged, and acknowledged once", async () => {
    const { id, token, row, update, meanwhile } = setUp();

    meanwhile((notification: UserOnCallLogTimeline) => {
      notification.status = UserNotificationStatus.Acknowledged;
      notification.statusMessage = ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE;
      notification.isAcknowledged = true;
    });

    const answer: CustomChannelActionAnswer = await CustomChannelActions.act({
      notificationId: id.toString(),
      action: CustomChannelAction.Acknowledge,
      token: token,
    });

    expect(answer).toEqual({
      action: CustomChannelAction.Acknowledge,
      result: CustomChannelActionResult.AlreadyAcknowledged,
      message: "This page was already acknowledged.",
    });
    // Refused at the version read; read again, acknowledged: not written again.
    expect(update).toHaveBeenCalledTimes(1);
    expect(row.version).toBe(2);
  });

  test("the send's result landing between the read and the write: read again, and acknowledged over it", async () => {
    const { id, token, row, update, meanwhile } = setUp({
      status: UserNotificationStatus.Sending,
    });

    meanwhile((notification: UserOnCallLogTimeline) => {
      notification.status = UserNotificationStatus.Sent;
    });

    const answer: CustomChannelActionAnswer = await CustomChannelActions.act({
      notificationId: id.toString(),
      action: CustomChannelAction.Acknowledge,
      token: token,
    });

    expect(answer.result).toBe(CustomChannelActionResult.Acknowledged);
    expect(update).toHaveBeenCalledTimes(2);
    expect(row.status).toBe(UserNotificationStatus.Acknowledged);
  });

  test("a notification that keeps changing under every try: refused with try again, never answered as acknowledged", async () => {
    const { id, token, row, update, meanwhile } = setUp();

    // A write lands before each of the tries: the provider's reports, say.
    for (
      let write: number = 0;
      write < MAX_NOTIFICATION_WRITE_ATTEMPTS;
      write++
    ) {
      meanwhile((notification: UserOnCallLogTimeline) => {
        notification.statusMessage = `Provider report ${write + 1}.`;
      });
    }

    const refusal: unknown = await CustomChannelActions.act({
      notificationId: id.toString(),
      action: CustomChannelAction.Acknowledge,
      token: token,
    }).catch((error: unknown) => {
      return error;
    });

    // The service answers 4xx with this message: the person tries again.
    expect(refusal).toBeInstanceOf(BadDataException);
    expect((refusal as BadDataException).message).toBe(
      ON_CALL_NOTIFICATION_NOT_ACKNOWLEDGED_MESSAGE,
    );
    expect(update).toHaveBeenCalledTimes(MAX_NOTIFICATION_WRITE_ATTEMPTS);
    expect(row.isAcknowledged).toBe(false);
    expect(row.status).toBe(UserNotificationStatus.Sent);
  });

  test("acknowledged meanwhile by the last write that beat every try: answered as already acknowledged", async () => {
    const { id, token, row, update, meanwhile } = setUp();

    for (
      let write: number = 1;
      write < MAX_NOTIFICATION_WRITE_ATTEMPTS;
      write++
    ) {
      meanwhile((notification: UserOnCallLogTimeline) => {
        notification.statusMessage = `Provider report ${write}.`;
      });
    }

    // The last write before the last try: the page's own link, pressed.
    meanwhile((notification: UserOnCallLogTimeline) => {
      notification.status = UserNotificationStatus.Acknowledged;
      notification.statusMessage = ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE;
      notification.isAcknowledged = true;
    });

    const answer: CustomChannelActionAnswer = await CustomChannelActions.act({
      notificationId: id.toString(),
      action: CustomChannelAction.Acknowledge,
      token: token,
    });

    expect(answer).toEqual({
      action: CustomChannelAction.Acknowledge,
      result: CustomChannelActionResult.AlreadyAcknowledged,
      message: "This page was already acknowledged.",
    });
    expect(update).toHaveBeenCalledTimes(MAX_NOTIFICATION_WRITE_ATTEMPTS);
    expect(row.isAcknowledged).toBe(true);
  });

  test("a notification gone between the reads: refused with try again, not answered as acknowledged", async () => {
    const { id, token, row, update } = setUp();

    // Read once by act; gone for the write's read and the read after it.
    jest
      .spyOn(UserOnCallLogTimelineService, "findOneById")
      .mockResolvedValueOnce(row)
      .mockResolvedValue(null);

    await expect(
      CustomChannelActions.act({
        notificationId: id.toString(),
        action: CustomChannelAction.Acknowledge,
        token: token,
      }),
    ).rejects.toThrow(ON_CALL_NOTIFICATION_NOT_ACKNOWLEDGED_MESSAGE);
    expect(update).not.toHaveBeenCalled();
  });

  test("a page already acknowledged is not acknowledged again", async () => {
    const { id, token, update } = setUp({ isAcknowledged: true });

    const answer: CustomChannelActionAnswer = await CustomChannelActions.act({
      notificationId: id.toString(),
      action: CustomChannelAction.Acknowledge,
      token: token,
    });

    expect(answer.result).toBe(CustomChannelActionResult.AlreadyAcknowledged);
    expect(update).not.toHaveBeenCalled();
  });

  test("the token may come in any case of the id", async () => {
    const { id, token } = setUp();

    const answer: CustomChannelActionAnswer = await CustomChannelActions.act({
      notificationId: id.toString().toUpperCase(),
      action: CustomChannelAction.Acknowledge,
      token: token,
    });

    expect(answer.result).toBe(CustomChannelActionResult.Acknowledged);
  });
});

describe("CustomChannelActions: escalate", () => {
  test("passes the page on, as the person, through this notification", async () => {
    const { id, token } = setUp();

    const passOn: jest.SpyInstance = jest
      .spyOn(OnCallPagePassOn, "passOn")
      .mockResolvedValue({
        passedOn: true,
        result: {
          rule: { order: 2, name: "Level 2" },
          ruleCount: 3,
        },
      } as unknown as OnCallPassOnAnswer);

    const answer: CustomChannelActionAnswer = await CustomChannelActions.act({
      notificationId: id.toString(),
      action: CustomChannelAction.Escalate,
      token: token,
    });

    expect(passOn).toHaveBeenCalledTimes(1);
    const call: Record<string, unknown> = passOn.mock.calls[0]![0] as never;
    expect((call["userId"] as ObjectID).toString()).toBe(USER_ID.toString());
    expect((call["executionLogId"] as ObjectID).toString()).toBe(
      EXECUTION_LOG_ID.toString(),
    );
    expect((call["viaUserOnCallLogTimelineId"] as ObjectID).toString()).toBe(
      id.toString(),
    );

    expect(answer.action).toBe(CustomChannelAction.Escalate);
    expect(answer.result).toBe(CustomChannelActionResult.Escalated);
    expect(answer.message.length).toBeGreaterThan(0);
  });

  test("a page that could not be passed on says why", async () => {
    const { id, token } = setUp();

    jest.spyOn(OnCallPagePassOn, "passOn").mockResolvedValue({
      passedOn: false,
      refusal: OnCallPassOnRefusal.RecordAcknowledged,
      acknowledgedByName: "Ana Lopez",
    } as OnCallPassOnAnswer);

    const answer: CustomChannelActionAnswer = await CustomChannelActions.act({
      notificationId: id.toString(),
      action: CustomChannelAction.Escalate,
      token: token,
    });

    expect(answer.result).toBe(CustomChannelActionResult.NotEscalated);
    expect(answer.message).toContain("Ana Lopez");
  });

  test("a page from no on-call policy has nothing to escalate to", async () => {
    const { id, token } = setUp({ withExecutionLog: false });
    const passOn: jest.SpyInstance = jest.spyOn(OnCallPagePassOn, "passOn");

    const answer: CustomChannelActionAnswer = await CustomChannelActions.act({
      notificationId: id.toString(),
      action: CustomChannelAction.Escalate,
      token: token,
    });

    expect(answer.result).toBe(CustomChannelActionResult.NotEscalated);
    expect(passOn).not.toHaveBeenCalled();
  });
});

describe("CustomChannelActions: resolve", () => {
  const PROPS: DatabaseCommonInteractionProps = {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  };

  function spyOnWorkspace(isResolved: boolean): {
    getProps: jest.SpyInstance;
    authorize: jest.SpyInstance;
    resolve: jest.SpyInstance;
  } {
    const getProps: jest.SpyInstance = jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockResolvedValue(PROPS);

    const authorize: jest.SpyInstance = jest
      .spyOn(WorkspaceMemberActions, "authorize")
      .mockImplementation(
        async (data: {
          event: { type: WorkspaceEventType; id: ObjectID };
        }): Promise<WorkspaceEventRecord> => {
          return {
            type: data.event.type,
            id: data.event.id,
            projectId: PROJECT_ID,
          } as unknown as WorkspaceEventRecord;
        },
      );

    jest.spyOn(WorkspaceMemberActions, "getStanding").mockResolvedValue({
      isAcknowledged: isResolved,
      isResolved: isResolved,
      hasStarted: true,
    } as never);

    const resolve: jest.SpyInstance = jest
      .spyOn(WorkspaceMemberActions, "resolve")
      .mockResolvedValue(undefined);

    return { getProps: getProps, authorize: authorize, resolve: resolve };
  }

  test.each([
    ["incident", WorkspaceEventType.Incident, IncidentStateTimeline],
    ["alert", WorkspaceEventType.Alert, AlertStateTimeline],
    [
      "incidentEpisode",
      WorkspaceEventType.IncidentEpisode,
      IncidentEpisodeStateTimeline,
    ],
    [
      "alertEpisode",
      WorkspaceEventType.AlertEpisode,
      AlertEpisodeStateTimeline,
    ],
  ])(
    "resolves the %s the page is about, as the person, with their own permissions",
    async (
      record: string,
      eventType: WorkspaceEventType,
      stateTimeline: unknown,
    ) => {
      const { id, token } = setUp({
        record: record as NonNullable<NotificationOptions["record"]>,
      });
      const { getProps, authorize, resolve } = spyOnWorkspace(false);

      const answer: CustomChannelActionAnswer = await CustomChannelActions.act({
        notificationId: id.toString(),
        action: CustomChannelAction.Resolve,
        token: token,
      });

      expect(answer).toEqual({
        action: CustomChannelAction.Resolve,
        result: CustomChannelActionResult.Resolved,
        message: "Resolved.",
      });

      const propsCall: Record<string, unknown> = getProps.mock
        .calls[0]![0] as never;
      expect((propsCall["userId"] as ObjectID).toString()).toBe(
        USER_ID.toString(),
      );
      expect((propsCall["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );

      const authorizeCall: Record<string, unknown> = authorize.mock
        .calls[0]![0] as never;
      expect(authorizeCall["props"]).toBe(PROPS);
      expect(authorizeCall["modelType"]).toBe(stateTimeline);
      expect(
        (authorizeCall["event"] as { type: WorkspaceEventType }).type,
      ).toBe(eventType);

      expect(resolve).toHaveBeenCalledTimes(1);
      expect((resolve.mock.calls[0]![0] as { props: unknown }).props).toBe(
        PROPS,
      );
    },
  );

  test("a record already resolved is not resolved again", async () => {
    const { id, token } = setUp();
    const { resolve } = spyOnWorkspace(true);

    const answer: CustomChannelActionAnswer = await CustomChannelActions.act({
      notificationId: id.toString(),
      action: CustomChannelAction.Resolve,
      token: token,
    });

    expect(answer.result).toBe(CustomChannelActionResult.AlreadyResolved);
    expect(resolve).not.toHaveBeenCalled();
  });

  test("a person the Dashboard would refuse is refused here too", async () => {
    const { id, token } = setUp();
    const { resolve } = spyOnWorkspace(false);

    jest
      .spyOn(WorkspaceMemberActions, "authorize")
      .mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permission to resolve this incident.",
        ),
      );

    await expect(
      CustomChannelActions.act({
        notificationId: id.toString(),
        action: CustomChannelAction.Resolve,
        token: token,
      }),
    ).rejects.toThrow("You do not have permission to resolve this incident.");

    expect(resolve).not.toHaveBeenCalled();
  });

  test("a page about no record cannot be resolved", async () => {
    const { id, token } = setUp({ record: "none" });
    const { resolve } = spyOnWorkspace(false);

    await expect(
      CustomChannelActions.act({
        notificationId: id.toString(),
        action: CustomChannelAction.Resolve,
        token: token,
      }),
    ).rejects.toThrow(BadDataException);

    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("CustomChannelActions.getPagedRecord", () => {
  test.each([
    ["incident", WorkspaceEventType.Incident, "incident"],
    ["alert", WorkspaceEventType.Alert, "alert"],
    ["incidentEpisode", WorkspaceEventType.IncidentEpisode, "incident episode"],
    ["alertEpisode", WorkspaceEventType.AlertEpisode, "alert episode"],
  ])(
    "a page about an %s names it",
    (record: string, eventType: WorkspaceEventType, noun: string) => {
      const row: UserOnCallLogTimeline = notification(ObjectID.generate(), {
        record: record as NonNullable<NotificationOptions["record"]>,
      });

      const paged: ReturnType<typeof CustomChannelActions.getPagedRecord> =
        CustomChannelActions.getPagedRecord(row);

      expect(paged?.event.type).toBe(eventType);
      expect(paged?.noun).toBe(noun);
    },
  );

  test("a page about nothing names nothing", () => {
    expect(
      CustomChannelActions.getPagedRecord(
        notification(ObjectID.generate(), { record: "none" }),
      ),
    ).toBeNull();
  });
});
