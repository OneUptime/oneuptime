import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A MESSAGE A BLOCKED PROJECT SENDS NOTHING OF, COUNTED AS NOT SENT
 * (issue #6600).
 *
 * A project a master admin blocked sends nothing (BlockedProjectNotifications),
 * and the refusal never reaches the Notification service, whose senders
 * count every other message. So each core sender's refusal is counted where
 * it is made: once, as not sent, under the sender's own channel - for the
 * platform's operator, a blocked project's messages are the block working,
 * not deliveries that failed.
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string>;
}

const sendCounterCalls: Array<RecordedCall> = [];

jest.mock("../../../../Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return {
          add: (value: number, attributes: Record<string, string>): void => {
            sendCounterCalls.push({ value, attributes });
          },
        };
      },
      getNotificationDuration: () => {
        return { record: jest.fn() };
      },
    },
  };
});

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
import CustomNotificationChannelDeliveryService from "../../../../Server/Services/CustomNotificationChannelDeliveryService";
import MailService from "../../../../Server/Services/MailService";
import ProjectService from "../../../../Server/Services/ProjectService";
import PushNotificationService from "../../../../Server/Services/PushNotificationService";
import SmsService from "../../../../Server/Services/SmsService";
import TelegramService from "../../../../Server/Services/TelegramService";
import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import WebhookService from "../../../../Server/Services/WebhookService";
import WhatsAppService from "../../../../Server/Services/WhatsAppService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import BlockedProjectNotifications from "../../../../Server/Utils/Notification/BlockedProjectNotifications";
import CustomChannelEdition from "../../../../Server/Utils/Notification/CustomChannelEdition";
import { NotificationDeliveryChannel } from "../../../../Server/Utils/Telemetry/NotificationDeliveryMetrics";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../../../../Server/Utils/Workspace/WorkspaceBase";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import Email from "../../../../Types/Email";
import ObjectID from "../../../../Types/ObjectID";
import Phone from "../../../../Types/Phone";
import WorkspaceMessagePayload from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import API from "../../../../Utils/API";

const BLOCKED_PROJECT_ID: ObjectID = new ObjectID(
  "66003333-0000-4000-8000-0000000000b1",
);
const LIVE_PROJECT_ID: ObjectID = new ObjectID(
  "66003333-0000-4000-8000-0000000000a1",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "66003333-0000-4000-8000-000000000001",
);
const CUSTOM_CHANNEL_ID: ObjectID = new ObjectID(
  "66003333-0000-4000-8000-0000000000c1",
);

let post: jest.SpiedFunction<typeof API.post>;

beforeEach(() => {
  sendCounterCalls.length = 0;

  jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockImplementation(async (projectId: ObjectID): Promise<boolean> => {
      return projectId.toString() === BLOCKED_PROJECT_ID.toString();
    });
  jest
    .spyOn(UserOnCallLogTimelineService, "markNotSent")
    .mockResolvedValue(undefined as never);
  post = jest
    .spyOn(API, "post")
    .mockResolvedValue(new HTTPResponse(200, {}, {}) as unknown as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function notSent(): Array<string> {
  return sendCounterCalls.map((call: RecordedCall) => {
    expect(call.value).toBe(1);
    expect(call.attributes["outcome"]).toBe("not_sent");
    expect(call.attributes["notification.provider"]).toBe("none");
    return call.attributes["notification.channel"]!;
  });
}

describe("BlockedProjectNotifications.getRefusal", () => {
  test("a refusal naming its channel is counted as not sent, with whether it was a page", async () => {
    await BlockedProjectNotifications.getRefusal({
      channel: "SMS",
      deliveryChannel: NotificationDeliveryChannel.SMS,
      projectId: BLOCKED_PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(sendCounterCalls).toEqual([
      {
        value: 1,
        attributes: {
          "notification.channel": "sms",
          "notification.provider": "none",
          "notification.provider.config": "global",
          "notification.on_call_page": "true",
          outcome: "not_sent",
        },
      },
    ]);
  });

  test("a project that is not blocked is not counted here: its sender counts it", async () => {
    await BlockedProjectNotifications.getRefusal({
      channel: "SMS",
      deliveryChannel: NotificationDeliveryChannel.SMS,
      projectId: LIVE_PROJECT_ID,
    });

    expect(sendCounterCalls).toEqual([]);
  });

  test("a refusal that names no delivery channel - an OpenStack project's notice - is not counted", async () => {
    await BlockedProjectNotifications.getRefusal({
      channel: "Webhook",
      projectId: BLOCKED_PROJECT_ID,
    });

    expect(sendCounterCalls).toEqual([]);
  });

  test("no project named - an account email - is not counted", async () => {
    await BlockedProjectNotifications.getRefusal({
      channel: "Email",
      deliveryChannel: NotificationDeliveryChannel.Email,
    });

    expect(sendCounterCalls).toEqual([]);
  });
});

describe("every core sender's refusal is counted under its own channel", () => {
  test("email", async () => {
    await MailService.sendMail(
      {
        toEmail: new Email("someone@example.com"),
        subject: "Incident created",
        vars: {},
      },
      { projectId: BLOCKED_PROJECT_ID },
    );

    expect(notSent()).toEqual(["email"]);
  });

  test("an SMS", async () => {
    await SmsService.sendSms(
      { to: new Phone("+15550000000"), message: "Incident created" },
      { projectId: BLOCKED_PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
    );

    expect(notSent()).toEqual(["sms"]);
    expect(sendCounterCalls[0]!.attributes["notification.on_call_page"]).toBe(
      "true",
    );
  });

  test("a call", async () => {
    await CallService.makeCall(
      {
        to: new Phone("+15550000000"),
        data: [],
      } as unknown as Parameters<typeof CallService.makeCall>[0],
      { projectId: BLOCKED_PROJECT_ID },
    );

    expect(notSent()).toEqual(["call"]);
  });

  test("a WhatsApp message", async () => {
    await WhatsAppService.sendWhatsAppMessage(
      {
        to: new Phone("+15550000000"),
      } as unknown as Parameters<typeof WhatsAppService.sendWhatsAppMessage>[0],
      { projectId: BLOCKED_PROJECT_ID },
    );

    expect(notSent()).toEqual(["whatsapp"]);
  });

  test("a Telegram message", async () => {
    await TelegramService.sendTelegramMessage(
      {
        to: "123456",
        message: "Incident created",
      } as unknown as Parameters<typeof TelegramService.sendTelegramMessage>[0],
      { projectId: BLOCKED_PROJECT_ID },
    );

    expect(notSent()).toEqual(["telegram"]);
  });

  test("a webhook", async () => {
    await WebhookService.sendWebhook(
      {
        url: "https://hooks.example.com/oneuptime",
        eventType: "incident.created",
        payload: {},
      },
      { projectId: BLOCKED_PROJECT_ID },
    );

    expect(notSent()).toEqual(["webhook"]);
  });

  test("a push notification", async () => {
    await PushNotificationService.sendPushNotification(
      {
        devices: [],
        message: { title: "Incident created", body: "Checkout API" },
      } as unknown as Parameters<
        typeof PushNotificationService.sendPushNotification
      >[0],
      { projectId: BLOCKED_PROJECT_ID },
    );

    expect(notSent()).toEqual(["push"]);
  });

  test("a custom channel's request", async () => {
    jest.spyOn(CustomChannelEdition, "isActive").mockReturnValue(true);

    await CustomNotificationChannelDeliveryService.send({
      customNotificationChannelId: CUSTOM_CHANNEL_ID,
      eventType: "on-call.page",
      payload: {},
      projectId: BLOCKED_PROJECT_ID,
    });

    expect(post).not.toHaveBeenCalled();
    expect(notSent()).toEqual(["custom_channel"]);
  });

  test("a live project's message is not counted by core: the Notification service counts it", async () => {
    await SmsService.sendSms(
      { to: new Phone("+15550000000"), message: "Incident created" },
      { projectId: LIVE_PROJECT_ID },
    );

    expect(post).toHaveBeenCalledTimes(1);
    expect(sendCounterCalls).toEqual([]);
  });
});

/*
 * A blocked project's bot posts in no channel (WorkspaceUtil): each channel
 * - and Microsoft Teams chat - its message names is not sent, under the
 * workspace it was for, as a channel post (issue #6645). Nothing reaches the
 * workspace, so nothing else counts it.
 */
describe("a blocked project's chat channel posts are counted as not sent", () => {
  function payload(data: {
    workspaceType: WorkspaceType;
    channelNames?: Array<string> | undefined;
    channelIds?: Array<string> | undefined;
    chatIds?: Array<string> | undefined;
  }): WorkspaceMessagePayload {
    const messagePayload: WorkspaceMessagePayload = {
      _type: "WorkspaceMessagePayload",
      channelNames: data.channelNames || [],
      channelIds: data.channelIds || [],
      messageBlocks: [],
      workspaceType: data.workspaceType,
    };

    if (data.chatIds) {
      messagePayload.chatIds = data.chatIds;
    }

    return messagePayload;
  }

  function notSentPost(channel: string): {
    value: number;
    attributes: Record<string, string>;
  } {
    return {
      value: 1,
      attributes: {
        "notification.channel": channel,
        "notification.provider": channel,
        "notification.provider.config": "project",
        "notification.on_call_page": "false",
        "notification.destination": "channel",
        outcome: "not_sent",
      },
    };
  }

  test("every workspace's: one for each channel and chat its message names", async () => {
    const getProjectAuth: jest.SpyInstance = jest.spyOn(
      WorkspaceProjectAuthTokenService,
      "getProjectAuth",
    );

    const responses: Array<WorkspaceSendMessageResponse> =
      await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
        projectId: BLOCKED_PROJECT_ID,
        messagePayloadsByWorkspace: [
          payload({
            workspaceType: WorkspaceType.Slack,
            channelNames: ["incidents", "ops"],
          }),
          payload({
            workspaceType: WorkspaceType.MicrosoftTeams,
            channelIds: ["19:a@thread.tacv2"],
            chatIds: ["19:chat-1@thread.v2"],
          }),
          payload({
            workspaceType: WorkspaceType.Mattermost,
            channelIds: ["c".repeat(26)],
          }),
        ],
      });

    expect(responses).toHaveLength(3);
    expect(getProjectAuth).not.toHaveBeenCalled();
    expect(sendCounterCalls).toEqual([
      notSentPost("slack"),
      notSentPost("slack"),
      notSentPost("microsoft_teams"),
      notSentPost("microsoft_teams"),
      notSentPost("mattermost"),
    ]);
  });

  test("one workspace's: each channel its message names, once", async () => {
    const sendMessage: jest.SpyInstance = jest.spyOn(SlackUtil, "sendMessage");

    await WorkspaceUtil.postToWorkspaceChannels({
      workspaceUserId: "U123",
      projectOrUserAuthTokenForWorkspace: "xoxb-token",
      workspaceType: WorkspaceType.Slack,
      workspaceMessagePayload: payload({
        workspaceType: WorkspaceType.Slack,
        channelNames: ["incidents"],
        channelIds: ["C1"],
      }),
      projectId: BLOCKED_PROJECT_ID,
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(sendCounterCalls).toEqual([
      notSentPost("slack"),
      notSentPost("slack"),
    ]);
  });

  test("a live project's message goes on to its workspace, which counts its posts: none here", async () => {
    const sendMessage: jest.SpyInstance = jest
      .spyOn(SlackUtil, "sendMessage")
      .mockResolvedValue({ workspaceType: WorkspaceType.Slack, threads: [] });

    await WorkspaceUtil.postToWorkspaceChannels({
      workspaceUserId: "U123",
      projectOrUserAuthTokenForWorkspace: "xoxb-token",
      workspaceType: WorkspaceType.Slack,
      workspaceMessagePayload: payload({
        workspaceType: WorkspaceType.Slack,
        channelIds: ["C1"],
      }),
      projectId: LIVE_PROJECT_ID,
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendCounterCalls).toEqual([]);
  });
});
