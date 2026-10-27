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
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import UserOnCallLogTimeline from "../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CustomChannelAction,
  CustomChannelActionResult,
} from "../../../../Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import { OnCallPassOnAnswer } from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import UserNotificationStatus from "../../../../Types/UserNotification/UserNotificationStatus";
import { afterEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * THE ACTION LINKS OF AN SMS OR A CALL SENT THROUGH THE SERVER'S OWN
 * GATEWAY.
 *
 * A server that sends its SMS and calls through its own gateway hands the
 * gateway, with every on-call page, the links that acknowledge, escalate or
 * resolve it (CallAndSmsGatewayPayload) - the same links, and the same
 * token, a custom channel's page carries. So the links are accepted for a
 * notification that went out as an SMS or a call, as they are for one on a
 * custom channel, and for no other kind: an email, a push, a WhatsApp or a
 * webhook carry none, and a token for one is refused as before.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const EXECUTION_LOG_ID: ObjectID = ObjectID.generate();

// What a notification went out as: the column its method is linked by.
type SentAs =
  | "sms"
  | "call"
  | "customChannel"
  | "email"
  | "push"
  | "whatsapp"
  | "telegram"
  | "slack"
  | "microsoftTeams"
  | "webhook"
  | "nothing";

const METHOD_COLUMN: Record<Exclude<SentAs, "nothing">, string> = {
  sms: "userSmsId",
  call: "userCallId",
  customChannel: "customNotificationChannelId",
  email: "userEmailId",
  push: "userPushId",
  whatsapp: "userWhatsAppId",
  telegram: "userTelegramId",
  slack: "userSlackId",
  microsoftTeams: "userMicrosoftTeamsId",
  webhook: "userWebhookId",
};

function notification(
  id: ObjectID,
  sentAs: SentAs,
  options: { isAcknowledged?: boolean } = {},
): UserOnCallLogTimeline {
  const row: UserOnCallLogTimeline = new UserOnCallLogTimeline();
  row._id = id.toString();
  row.projectId = PROJECT_ID;
  row.userId = USER_ID;
  row.isAcknowledged = Boolean(options.isAcknowledged);
  row.onCallDutyPolicyExecutionLogId = EXECUTION_LOG_ID;
  row.triggeredByIncidentId = ObjectID.generate();
  row.user = new User();

  if (sentAs !== "nothing") {
    (row as unknown as Record<string, unknown>)[METHOD_COLUMN[sentAs]] =
      ObjectID.generate();
  }

  return row;
}

function setUp(
  sentAs: SentAs,
  options: { isAcknowledged?: boolean } = {},
): {
  id: ObjectID;
  token: string;
  find: jest.SpyInstance;
  update: jest.SpyInstance;
} {
  const id: ObjectID = ObjectID.generate();

  const find: jest.SpyInstance = jest
    .spyOn(UserOnCallLogTimelineService, "findOneById")
    .mockResolvedValue(notification(id, sentAs, options));

  const update: jest.SpyInstance = jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);

  return {
    id: id,
    token: CustomChannelActionToken.sign({ userOnCallLogTimelineId: id }),
    find: find,
    update: update,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a page sent as an SMS or a call through the gateway", () => {
  test.each(["sms", "call"] as Array<SentAs>)(
    "%s: acknowledged through its link, as the person it paged",
    async (sentAs: SentAs) => {
      const { id, token, update } = setUp(sentAs);

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
      expect(data["status"]).toBe(UserNotificationStatus.Acknowledged);
      expect(call["props"]).toEqual({ isRoot: true });
    },
  );

  test.each(["sms", "call"] as Array<SentAs>)(
    "%s: a page already acknowledged is not acknowledged again",
    async (sentAs: SentAs) => {
      const { id, token, update } = setUp(sentAs, { isAcknowledged: true });

      const answer: CustomChannelActionAnswer = await CustomChannelActions.act({
        notificationId: id.toString(),
        action: CustomChannelAction.Acknowledge,
        token: token,
      });

      expect(answer.result).toBe(CustomChannelActionResult.AlreadyAcknowledged);
      expect(update).not.toHaveBeenCalled();
    },
  );

  test.each(["sms", "call"] as Array<SentAs>)(
    "%s: escalated through its link, passing the page on from this notification",
    async (sentAs: SentAs) => {
      const { id, token } = setUp(sentAs);

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

      expect(answer.result).toBe(CustomChannelActionResult.Escalated);
      expect(passOn).toHaveBeenCalledTimes(1);

      const call: Record<string, unknown> = passOn.mock.calls[0]![0] as never;

      expect((call["userId"] as ObjectID).toString()).toBe(USER_ID.toString());
      expect((call["executionLogId"] as ObjectID).toString()).toBe(
        EXECUTION_LOG_ID.toString(),
      );
      expect((call["viaUserOnCallLogTimelineId"] as ObjectID).toString()).toBe(
        id.toString(),
      );
    },
  );

  test.each(["sms", "call"] as Array<SentAs>)(
    "%s: resolved through its link, with the person's own permissions",
    async (sentAs: SentAs) => {
      const { id, token } = setUp(sentAs);
      const props: DatabaseCommonInteractionProps = {
        userId: USER_ID,
        tenantId: PROJECT_ID,
      };

      jest
        .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
        .mockResolvedValue(props);
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
        isAcknowledged: false,
        isResolved: false,
        hasStarted: true,
      } as never);
      const resolve: jest.SpyInstance = jest
        .spyOn(WorkspaceMemberActions, "resolve")
        .mockResolvedValue(undefined);

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

      const authorizeCall: Record<string, unknown> = authorize.mock
        .calls[0]![0] as never;

      expect(authorizeCall["props"]).toBe(props);
      expect(authorizeCall["modelType"]).toBe(IncidentStateTimeline);
      expect(resolve).toHaveBeenCalledTimes(1);
    },
  );

  test("the notification is read with the columns that say it went out as an SMS or a call", async () => {
    const { id, token, find } = setUp("sms");

    await CustomChannelActions.act({
      notificationId: id.toString(),
      action: CustomChannelAction.Acknowledge,
      token: token,
    });

    const select: Record<string, unknown> = (
      find.mock.calls[0]![0] as Record<string, unknown>
    )["select"] as Record<string, unknown>;

    expect(select["userSmsId"]).toBe(true);
    expect(select["userCallId"]).toBe(true);
    expect(select["customNotificationChannelId"]).toBe(true);
  });
});

describe("the links are still only a gateway's or a custom channel's", () => {
  test.each([
    "email",
    "push",
    "whatsapp",
    "telegram",
    "slack",
    "microsoftTeams",
    "webhook",
    "nothing",
  ] as Array<SentAs>)(
    "a notification sent as %s carries no links: its token is refused, and nothing changes",
    async (sentAs: SentAs) => {
      const { id, token, update } = setUp(sentAs);

      await expect(
        CustomChannelActions.act({
          notificationId: id.toString(),
          action: CustomChannelAction.Acknowledge,
          token: token,
        }),
      ).rejects.toThrow(
        new NotAuthorizedException(CUSTOM_CHANNEL_NOT_A_CHANNEL_PAGE_MESSAGE),
      );

      expect(update).not.toHaveBeenCalled();
    },
  );

  test("a custom channel's page is accepted as before", async () => {
    const { id, token } = setUp("customChannel");

    const answer: CustomChannelActionAnswer = await CustomChannelActions.act({
      notificationId: id.toString(),
      action: CustomChannelAction.Acknowledge,
      token: token,
    });

    expect(answer.result).toBe(CustomChannelActionResult.Acknowledged);
  });

  test.each(["sms", "call"] as Array<SentAs>)(
    "%s: a token for another notification is refused before anything is read",
    async (sentAs: SentAs) => {
      const { id, find, update } = setUp(sentAs);

      await expect(
        CustomChannelActions.act({
          notificationId: id.toString(),
          action: CustomChannelAction.Acknowledge,
          token: CustomChannelActionToken.sign({
            userOnCallLogTimelineId: ObjectID.generate(),
          }),
        }),
      ).rejects.toThrow(CUSTOM_CHANNEL_INVALID_LINK_MESSAGE);

      expect(find).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    },
  );

  test.each(["sms", "call"] as Array<SentAs>)(
    "%s: the token of the page's own link, which an SMS can be forwarded with, does not resolve",
    async (sentAs: SentAs) => {
      const { id } = setUp(sentAs);
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
    },
  );

  test.each(["sms", "call"] as Array<SentAs>)(
    "%s: no token at all is refused",
    async (sentAs: SentAs) => {
      const { id, update } = setUp(sentAs);

      await expect(
        CustomChannelActions.act({
          notificationId: id.toString(),
          action: CustomChannelAction.Acknowledge,
          token: undefined,
        }),
      ).rejects.toThrow(CUSTOM_CHANNEL_INVALID_LINK_MESSAGE);

      expect(update).not.toHaveBeenCalled();
    },
  );
});
