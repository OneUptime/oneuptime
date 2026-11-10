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
import BlockedProjectNotifications from "../../../../Server/Utils/Notification/BlockedProjectNotifications";
import CustomChannelEdition from "../../../../Server/Utils/Notification/CustomChannelEdition";
import { NotificationDeliveryChannel } from "../../../../Server/Utils/Telemetry/NotificationDeliveryMetrics";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import Email from "../../../../Types/Email";
import ObjectID from "../../../../Types/ObjectID";
import Phone from "../../../../Types/Phone";
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
