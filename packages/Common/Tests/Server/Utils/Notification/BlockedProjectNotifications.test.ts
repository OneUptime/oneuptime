jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import CallService from "../../../../Server/Services/CallService";
import MailService from "../../../../Server/Services/MailService";
import ProjectService from "../../../../Server/Services/ProjectService";
import PushNotificationService from "../../../../Server/Services/PushNotificationService";
import SmsService from "../../../../Server/Services/SmsService";
import TelegramService from "../../../../Server/Services/TelegramService";
import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import WebhookService from "../../../../Server/Services/WebhookService";
import WhatsAppService from "../../../../Server/Services/WhatsAppService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import logger from "../../../../Server/Utils/Logger";
import BlockedProjectNotifications from "../../../../Server/Utils/Notification/BlockedProjectNotifications";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import Email from "../../../../Types/Email";
import ExceptionMessages from "../../../../Types/Exception/ExceptionMessages";
import ObjectID from "../../../../Types/ObjectID";
import Phone from "../../../../Types/Phone";
import WorkspaceMessagePayload from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import API from "../../../../Utils/API";
import { WorkspaceSendMessageResponse } from "../../../../Server/Utils/Workspace/WorkspaceBase";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * NOTHING IS SENT FOR A BLOCKED PROJECT.
 *
 * A project a master admin blocked sends nothing until it is unblocked: no
 * email, SMS, call, WhatsApp, Telegram, push or webhook from the senders
 * that name it, and no chat message as its bot. A sender answers what it
 * answers for a message the project deliberately does not send, and nothing
 * reaches the Notification service. A lookup that fails sends as usual: on-call pages must not stop
 * for every project because a check for abuse could not run.
 * ---------------------------------------------------------------------------
 */

const BLOCKED_PROJECT_ID: ObjectID = new ObjectID(
  "b3000000-0000-4000-8000-0000000000b1",
);
const LIVE_PROJECT_ID: ObjectID = new ObjectID(
  "b3000000-0000-4000-8000-0000000000a1",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "b3000000-0000-4000-8000-000000000001",
);

let isProjectBlocked: jest.SpyInstance;
let markNotSent: jest.SpyInstance;
let post: jest.SpyInstance;

beforeEach(() => {
  isProjectBlocked = jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockImplementation(async (projectId: ObjectID): Promise<boolean> => {
      return projectId.toString() === BLOCKED_PROJECT_ID.toString();
    });
  markNotSent = jest
    .spyOn(UserOnCallLogTimelineService, "markNotSent")
    .mockResolvedValue(undefined);
  post = jest
    .spyOn(API, "post")
    .mockResolvedValue(new HTTPResponse(200, {}, {}) as unknown as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const expectNotSent: (response: unknown, channel: string) => void = (
  response: unknown,
  channel: string,
): void => {
  expect(response).toBeInstanceOf(HTTPErrorResponse);
  expect((response as HTTPErrorResponse).statusCode).toBe(403);
  expect((response as HTTPErrorResponse).message).toBe(
    `${channel} not sent: ${ExceptionMessages.ProjectBlocked}`,
  );
  expect(post).not.toHaveBeenCalled();
};

describe("BlockedProjectNotifications.getRefusal", () => {
  test("refuses for a blocked project, and the on-call timeline says why", async () => {
    const refusal: HTTPErrorResponse | null =
      await BlockedProjectNotifications.getRefusal({
        channel: "SMS",
        projectId: BLOCKED_PROJECT_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      });

    expect(refusal?.statusCode).toBe(403);
    expect(markNotSent).toHaveBeenCalledWith({
      userOnCallLogTimelineId: TIMELINE_ID,
      reason: `SMS not sent: ${ExceptionMessages.ProjectBlocked}`,
    });
  });

  test("lets a project that is not blocked send", async () => {
    await expect(
      BlockedProjectNotifications.getRefusal({
        channel: "SMS",
        projectId: LIVE_PROJECT_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      }),
    ).resolves.toBeNull();

    expect(markNotSent).not.toHaveBeenCalled();
  });

  test("asks nothing when no project is named: an account email, a sign-in code", async () => {
    await expect(
      BlockedProjectNotifications.getRefusal({ channel: "Email" }),
    ).resolves.toBeNull();

    expect(isProjectBlocked).not.toHaveBeenCalled();
  });

  test("fails open: a lookup that fails sends as usual, and is logged", async () => {
    isProjectBlocked.mockRejectedValue(new Error("database unavailable"));

    await expect(
      BlockedProjectNotifications.getRefusal({
        channel: "Call",
        projectId: BLOCKED_PROJECT_ID,
      }),
    ).resolves.toBeNull();

    expect(logger.error).toHaveBeenCalled();
  });
});

describe("the senders", () => {
  test("email is not sent", async () => {
    const response: unknown = await MailService.sendMail(
      {
        toEmail: new Email("someone@example.com"),
        subject: "Incident created",
        vars: {},
      },
      { projectId: BLOCKED_PROJECT_ID },
    );

    expectNotSent(response, "Email");
  });

  test("email with no project - an account email - is sent as usual", async () => {
    await MailService.sendMail({
      toEmail: new Email("someone@example.com"),
      subject: "Reset your password",
      vars: {},
    });

    expect(post).toHaveBeenCalledTimes(1);
  });

  test("an SMS is not sent", async () => {
    const response: unknown = await SmsService.sendSms(
      { to: new Phone("+15550000000"), message: "Incident created" },
      { projectId: BLOCKED_PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
    );

    expectNotSent(response, "SMS");
    expect(markNotSent).toHaveBeenCalledTimes(1);
  });

  test("an SMS of a project that is not blocked is sent", async () => {
    await SmsService.sendSms(
      { to: new Phone("+15550000000"), message: "Incident created" },
      { projectId: LIVE_PROJECT_ID },
    );

    expect(post).toHaveBeenCalledTimes(1);
  });

  test("a call is not made", async () => {
    const response: unknown = await CallService.makeCall(
      {
        to: new Phone("+15550000000"),
        data: [],
      } as unknown as Parameters<typeof CallService.makeCall>[0],
      { projectId: BLOCKED_PROJECT_ID },
    );

    expectNotSent(response, "Call");
  });

  test("a WhatsApp message is not sent", async () => {
    const response: unknown = await WhatsAppService.sendWhatsAppMessage(
      {
        to: new Phone("+15550000000"),
      } as unknown as Parameters<typeof WhatsAppService.sendWhatsAppMessage>[0],
      { projectId: BLOCKED_PROJECT_ID },
    );

    expectNotSent(response, "WhatsApp message");
  });

  test("a Telegram message is not sent", async () => {
    const response: unknown = await TelegramService.sendTelegramMessage(
      {
        to: "123456",
        message: "Incident created",
      } as unknown as Parameters<typeof TelegramService.sendTelegramMessage>[0],
      { projectId: BLOCKED_PROJECT_ID },
    );

    expectNotSent(response, "Telegram message");
  });

  test("a webhook is not sent", async () => {
    const response: unknown = await WebhookService.sendWebhook(
      {
        url: "https://hooks.example.com/oneuptime",
        eventType: "incident.created",
        payload: {},
      },
      { projectId: BLOCKED_PROJECT_ID },
    );

    expectNotSent(response, "Webhook");
  });

  test("a push notification is not sent, and nothing else is asked of it", async () => {
    // No devices: a send that went ahead would throw "No devices provided".
    await expect(
      PushNotificationService.sendPushNotification(
        {
          devices: [],
          message: { title: "Incident created", body: "Checkout API" },
        } as unknown as Parameters<
          typeof PushNotificationService.sendPushNotification
        >[0],
        { projectId: BLOCKED_PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
      ),
    ).resolves.toBeUndefined();

    expect(markNotSent).toHaveBeenCalledTimes(1);
  });
});

describe("chat messages as the project's bot", () => {
  const payload: (workspaceType: WorkspaceType) => WorkspaceMessagePayload = (
    workspaceType: WorkspaceType,
  ): WorkspaceMessagePayload => {
    return {
      _type: "WorkspaceMessagePayload",
      channelNames: ["incidents"],
      channelIds: [],
      messageBlocks: [],
      workspaceType: workspaceType,
    };
  };

  test("are not posted to any workspace, answered as for none connected", async () => {
    const getProjectAuth: jest.SpyInstance = jest.spyOn(
      WorkspaceProjectAuthTokenService,
      "getProjectAuth",
    );

    const responses: Array<WorkspaceSendMessageResponse> =
      await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
        projectId: BLOCKED_PROJECT_ID,
        messagePayloadsByWorkspace: [
          payload(WorkspaceType.Slack),
          payload(WorkspaceType.MicrosoftTeams),
        ],
      });

    expect(responses).toEqual([
      { workspaceType: WorkspaceType.Slack, threads: [] },
      { workspaceType: WorkspaceType.MicrosoftTeams, threads: [] },
    ]);
    expect(getProjectAuth).not.toHaveBeenCalled();
  });

  test("are not posted to a channel either", async () => {
    const getWorkspaceTypeUtil: jest.SpyInstance = jest.spyOn(
      WorkspaceUtil,
      "getWorkspaceTypeUtil",
    );

    const response: WorkspaceSendMessageResponse =
      await WorkspaceUtil.postToWorkspaceChannels({
        workspaceUserId: "U123",
        projectOrUserAuthTokenForWorkspace: "xoxb-token",
        workspaceType: WorkspaceType.Slack,
        workspaceMessagePayload: payload(WorkspaceType.Slack),
        projectId: BLOCKED_PROJECT_ID,
      });

    expect(response).toEqual({
      workspaceType: WorkspaceType.Slack,
      threads: [],
    });
    expect(getWorkspaceTypeUtil).not.toHaveBeenCalled();
  });
});
