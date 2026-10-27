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

function setUp(options: NotificationOptions = {}): {
  id: ObjectID;
  token: string;
  row: UserOnCallLogTimeline;
  update: jest.SpyInstance;
} {
  const id: ObjectID = ObjectID.generate();
  const row: UserOnCallLogTimeline = notification(id, options);

  jest
    .spyOn(UserOnCallLogTimelineService, "findOneById")
    .mockResolvedValue(row);

  const update: jest.SpyInstance = jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);

  return {
    id: id,
    token: CustomChannelActionToken.sign({ userOnCallLogTimelineId: id }),
    row: row,
    update: update,
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

    expect((call["id"] as ObjectID).toString()).toBe(id.toString());
    expect(data["isAcknowledged"]).toBe(true);
    expect(data["acknowledgedAt"]).toBeInstanceOf(Date);
    expect(data["status"]).toBe(UserNotificationStatus.Acknowledged);
    expect(call["props"]).toEqual({ isRoot: true });
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
