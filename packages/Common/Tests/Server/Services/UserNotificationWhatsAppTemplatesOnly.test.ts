import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import URL from "../../../Types/API/URL";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import CallService from "../../../Server/Services/CallService";
import CustomNotificationChannelService from "../../../Server/Services/CustomNotificationChannelService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import SmsService from "../../../Server/Services/SmsService";
import TelegramService from "../../../Server/Services/TelegramService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import WebhookService from "../../../Server/Services/WebhookService";
import WhatsAppService from "../../../Server/Services/WhatsAppService";
import EmailRollupWriter from "../../../Server/Utils/EmailRollup/EmailRollupWriter";
import logger from "../../../Server/Utils/Logger";
import { createWhatsAppMessageFromTemplate } from "../../../Server/Utils/WhatsAppTemplateUtil";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import WhatsAppMessage, {
  WhatsAppMessagePayload,
} from "../../../Types/WhatsApp/WhatsAppMessage";
import { WhatsAppTemplateIds } from "../../../Types/WhatsApp/WhatsAppTemplates";

/*
 * WHATSAPP IS HANDED ONLY A MESSAGE IT CAN DELIVER (#9715).
 *
 * WhatsApp delivers only messages made from a template Meta approved. The
 * SLO, exception and missed call notifications handed sendUserNotification
 * a plain body: the notification service refused it, wrote a failed
 * WhatsApp log, and the person heard nothing. Those senders hand over no
 * WhatsApp message now; and sendUserNotification skips a message with no
 * template as it skips a missing one, so no undeliverable send is ever
 * attempted, whichever caller slips. Every other channel goes out as
 * always.
 */

const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PHONE: string = "+15550100";

let reached: Array<string>;
let whatsAppSent: Array<WhatsAppMessage>;
let warnings: Array<string>;

function everythingOn(): UserNotificationSetting {
  return {
    alertByEmail: true,
    alertBySMS: true,
    alertByCall: true,
    alertByPush: true,
    alertByWhatsApp: true,
    alertByTelegram: true,
    alertBySlack: false,
    alertByMicrosoftTeams: false,
    alertByMattermost: false,
    alertByWebhook: true,
    alertByCustomChannel: false,
  } as unknown as UserNotificationSetting;
}

async function send(data: {
  eventType: NotificationSettingEventType;
  whatsAppMessage?: WhatsAppMessagePayload | undefined;
}): Promise<void> {
  await UserNotificationSettingService.sendUserNotification({
    userId: USER_ID,
    projectId: PROJECT_ID,
    eventType: data.eventType,
    emailEnvelope: {
      subject: "Something happened",
      vars: {},
    } as unknown as EmailEnvelope,
    smsMessage: { message: "Something happened." },
    callRequestMessage: { data: [] } as CallRequestMessage,
    pushNotificationMessage: {
      title: "Something happened",
      body: "Something happened.",
    } as PushNotificationMessage,
    ...(data.whatsAppMessage !== undefined
      ? { whatsAppMessage: data.whatsAppMessage }
      : {}),
  });

  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

beforeEach(() => {
  reached = [];
  whatsAppSent = [];
  warnings = [];

  jest
    .spyOn(UserNotificationSettingService, "findOneBy")
    .mockResolvedValue(everythingOn() as never);
  jest
    .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(
      URL.fromString("https://oneuptime.example/dashboard") as never,
    );

  jest
    .spyOn(UserEmailService, "findBy")
    .mockResolvedValue([{ email: "bob@example.com" }] as never);
  jest
    .spyOn(UserSmsService, "findBy")
    .mockResolvedValue([{ phone: PHONE }] as never);
  jest
    .spyOn(UserWhatsAppService, "findBy")
    .mockResolvedValue([{ phone: new Phone(PHONE) }] as never);
  jest
    .spyOn(UserTelegramService, "findBy")
    .mockResolvedValue([{ telegramChatId: "42" }] as never);
  jest
    .spyOn(UserCallService, "findBy")
    .mockResolvedValue([{ phone: PHONE }] as never);
  jest
    .spyOn(UserWebhookService, "findBy")
    .mockResolvedValue([
      { webhookUrl: "https://hooks.example", name: "Mine" },
    ] as never);

  jest
    .spyOn(EmailRollupWriter, "sendOrRollup")
    .mockImplementation((async () => {
      reached.push("email");
    }) as never);
  jest.spyOn(SmsService, "sendSms").mockImplementation((async () => {
    reached.push("sms");
  }) as never);
  jest
    .spyOn(WhatsAppService, "sendWhatsAppMessage")
    .mockImplementation((async (message: WhatsAppMessage) => {
      reached.push("whatsapp");
      whatsAppSent.push(message);
    }) as never);
  jest
    .spyOn(TelegramService, "sendTelegramMessage")
    .mockImplementation((async () => {
      reached.push("telegram");
    }) as never);
  jest.spyOn(CallService, "makeCall").mockImplementation((async () => {
    reached.push("call");
  }) as never);
  jest
    .spyOn(PushNotificationService, "sendPushNotificationToUser")
    .mockImplementation((async () => {
      reached.push("push");
    }) as never);
  jest.spyOn(WebhookService, "sendWebhook").mockImplementation((async () => {
    reached.push("webhook");
  }) as never);
  jest
    .spyOn(CustomNotificationChannelService, "getChannelsThatAreOn")
    .mockResolvedValue([] as never);
  jest.spyOn(logger, "warn").mockImplementation(((message: unknown) => {
    warnings.push(String(message));
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const EVERY_OTHER_CHANNEL: Array<string> = [
  "call",
  "email",
  "push",
  "sms",
  "telegram",
  "webhook",
];

describe("sendUserNotification and WhatsApp", () => {
  test("a message made from an approved template goes to each WhatsApp number, as always", async () => {
    await send({
      eventType:
        NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
      whatsAppMessage: createWhatsAppMessageFromTemplate({
        eventType:
          NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
        templateVariables: {
          incident_number: "42",
          incident_title: "Checkout is down",
          project_name: "Acme",
          incident_link: "https://oneuptime.example/dashboard/i/42",
        },
      }),
    });

    expect([...reached].sort()).toEqual(
      [...EVERY_OTHER_CHANNEL, "whatsapp"].sort(),
    );
    expect(whatsAppSent).toHaveLength(1);
    expect(whatsAppSent[0]!.templateKey).toBe(
      WhatsAppTemplateIds.IncidentCreatedOwnerNotification,
    );
    expect(whatsAppSent[0]!.to.toString()).toBe(PHONE);
  });

  /*
   * What the SLO, exception and missed call notifications used to hand
   * over: refused by the notification service, a failed log each time.
   */
  test.each([
    NotificationSettingEventType.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION,
    NotificationSettingEventType.SEND_SLO_OWNER_ADDED_NOTIFICATION,
    NotificationSettingEventType.SEND_EXCEPTION_ASSIGNED_NOTIFICATION,
    NotificationSettingEventType.SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION,
  ])(
    "a plain body with no template for %s is never handed to WhatsApp; every other channel still goes out",
    async (eventType: NotificationSettingEventType) => {
      await send({
        eventType: eventType,
        whatsAppMessage: { body: "OneUptime: something happened." },
      });

      expect(whatsAppSent).toEqual([]);
      expect([...reached].sort()).toEqual([...EVERY_OTHER_CHANNEL].sort());
      expect(
        warnings.some((warning: string): boolean => {
          return (
            warning.includes("Skipping WhatsApp notification") &&
            warning.includes(eventType)
          );
        }),
      ).toBe(true);
    },
  );

  test("no WhatsApp message at all is skipped the same way", async () => {
    await send({
      eventType:
        NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    });

    expect(whatsAppSent).toEqual([]);
    expect([...reached].sort()).toEqual([...EVERY_OTHER_CHANNEL].sort());
  });

  test("an empty template key is no template", async () => {
    await send({
      eventType:
        NotificationSettingEventType.SEND_RUNNER_OWNER_ADDED_NOTIFICATION,
      whatsAppMessage: { body: "Hello", templateKey: "" },
    });

    expect(whatsAppSent).toEqual([]);
  });

  test("WhatsApp switched off sends nothing there, whatever the message", async () => {
    jest.spyOn(UserNotificationSettingService, "findOneBy").mockResolvedValue({
      ...everythingOn(),
      alertByWhatsApp: false,
    } as never);

    await send({
      eventType:
        NotificationSettingEventType.SEND_INCIDENT_OWNER_ADDED_NOTIFICATION,
      whatsAppMessage: {
        body: "",
        templateKey: WhatsAppTemplateIds.IncidentOwnerAddedNotification,
      },
    });

    expect(whatsAppSent).toEqual([]);
    expect([...reached].sort()).toEqual([...EVERY_OTHER_CHANNEL].sort());
  });
});
