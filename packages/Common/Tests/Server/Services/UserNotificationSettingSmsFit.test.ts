import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserSlackService from "../../../Server/Services/UserSlackService";
import SmsService from "../../../Server/Services/SmsService";
import TelegramService from "../../../Server/Services/TelegramService";
import WorkspaceUserNotificationService from "../../../Server/Services/WorkspaceUserNotificationService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import logger from "../../../Server/Utils/Logger";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserSlack from "../../../Models/DatabaseModels/UserSlack";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import SMS, { SMSMessage } from "../../../Types/SMS/SMS";
import TelegramMessage from "../../../Types/Telegram/TelegramMessage";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import { buildNotificationSms } from "../../../Utils/Sms/NotificationSms";
import { countSmsSegments, SmsEncoding } from "../../../Utils/Sms/SmsSegments";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE SMS COPY OF A NOTIFICATION, AND ITS OTHER COPIES.
 *
 * sendUserNotification sends one text on several channels: the SMS, and the
 * Telegram and Slack or Microsoft Teams messages it builds from the same
 * text when the caller has none of its own. Only the SMS is billed by the
 * part, so only the SMS copy is fitted (NotificationSms): written in the
 * characters an SMS carries cheaply, and without the turn-off sentence when
 * that makes it one part - measured with the installation's own name, as
 * the Notification service sends it. The other copies keep every
 * character, and the sentence, as written.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5114c000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("5114c000-0000-4000-8000-000000000002");
const PHONE: string = "+15555550109";

let smsSent: Array<SMS>;
let telegramSent: Array<TelegramMessage>;
let workspaceSent: Array<Array<WorkspaceMessageBlock>>;

function settingsRow(): UserNotificationSetting {
  return {
    alertByEmail: false,
    alertBySMS: true,
    alertByCall: false,
    alertByPush: false,
    alertByWhatsApp: false,
    alertByTelegram: true,
    alertBySlack: true,
    alertByMicrosoftTeams: false,
    alertByWebhook: false,
  } as unknown as UserNotificationSetting;
}

function flushMicrotasks(): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

async function send(message: string): Promise<void> {
  await UserNotificationSettingService.sendUserNotification({
    userId: USER_ID,
    projectId: PROJECT_ID,
    eventType:
      NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
    emailEnvelope: {
      subject: "[Acknowledged Incident INC-42] - Checkout is down",
      templateType: EmailTemplateType.BlankTemplate,
      vars: {},
    } as unknown as EmailEnvelope,
    smsMessage: { message: message } as SMSMessage,
    callRequestMessage: { data: [] } as unknown as CallRequestMessage,
    pushNotificationMessage: {} as PushNotificationMessage,
  });
  await flushMicrotasks();
}

function workspaceText(): string {
  return (workspaceSent[0] || [])
    .map((block: WorkspaceMessageBlock): string => {
      return (block as WorkspacePayloadMarkdown).text || "";
    })
    .join("\n");
}

beforeEach(() => {
  smsSent = [];
  telegramSent = [];
  workspaceSent = [];

  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(EnterpriseEdition, "getProductBranding")
    .mockReturnValue(null as never);
  jest
    .spyOn(UserNotificationSettingService, "findOneBy")
    .mockResolvedValue(settingsRow() as never);
  jest
    .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
    .mockResolvedValue(undefined as never);
  jest.spyOn(UserSmsService, "findBy").mockResolvedValue([
    { phone: new Phone(PHONE) } as unknown as UserSMS,
  ] as never);
  jest.spyOn(UserTelegramService, "findBy").mockResolvedValue([
    { telegramChatId: "1234567" } as unknown as UserTelegram,
  ] as never);
  jest.spyOn(UserSlackService, "findBy").mockResolvedValue([
    {
      id: new ObjectID("5114c000-0000-4000-8000-000000000003"),
      slackUserId: "U0123ABCD",
    } as unknown as UserSlack,
  ] as never);
  jest.spyOn(SmsService, "sendSms").mockImplementation((async (sms: SMS) => {
    smsSent.push(sms);
    return new HTTPResponse(200, {}, {});
  }) as never);
  jest
    .spyOn(TelegramService, "sendTelegramMessage")
    .mockImplementation((async (message: TelegramMessage) => {
      telegramSent.push(message);
      return new HTTPResponse(200, {}, {});
    }) as never);
  jest
    .spyOn(WorkspaceUserNotificationService, "sendDirectMessageToUser")
    .mockImplementation((async (data: {
      messageBlocks: Array<WorkspaceMessageBlock>;
    }) => {
      workspaceSent.push(data.messageBlocks);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a notification's SMS copy", () => {
  test("is written in GSM-7's characters, so a curly quote does not make it UCS-2", async () => {
    await send(
      buildNotificationSms(
        "Incident INC-42 (\u{201C}Checkout\u{201D} \u{2013} payments\u{2026}) is now Acknowledged.",
      ),
    );

    expect(smsSent.length).toBe(1);
    expect(smsSent[0]!.to.toString()).toBe(PHONE);
    expect(smsSent[0]!.message).toBe(
      'OneUptime: Incident INC-42 ("Checkout" - payments...) is now Acknowledged. Turn off in User Settings > Notification Settings.',
    );
    expect(countSmsSegments(smsSent[0]!.message)).toEqual({
      encoding: SmsEncoding.Gsm7,
      length: smsSent[0]!.message.length,
      segments: 1,
    });
  });

  test("leaves the turn-off sentence out when that makes it one part", async () => {
    const news: string = `Incident INC-42 (${"x".repeat(70)}) is now Acknowledged.`;

    await send(buildNotificationSms(news));

    expect(smsSent[0]!.message).toBe(`OneUptime: ${news}`);
    expect(countSmsSegments(smsSent[0]!.message).segments).toBe(1);
  });

  test("is measured with the installation's own name", async () => {
    jest
      .spyOn(EnterpriseEdition, "getProductBranding")
      .mockReturnValue({
        productName: "Acme Corporation Monitoring Platform",
      } as never);

    // 150 characters as written; 177 with the longer name.
    const news: string = `${"w".repeat(85)}.`;

    await send(buildNotificationSms(news));

    expect(smsSent[0]!.message).toBe(`OneUptime: ${news}`);
    expect(
      countSmsSegments(ProductBrandingText.brandText(smsSent[0]!.message))
        .segments,
    ).toBe(1);
  });
});

describe("its other copies", () => {
  test("Telegram and Slack keep every character and the turn-off sentence", async () => {
    const message: string = buildNotificationSms(
      "Incident INC-42 (\u{201C}Checkout\u{201D} \u{2013} payments\u{2026}) is now Acknowledged.",
    );

    await send(message);

    expect(telegramSent.length).toBe(1);
    expect(telegramSent[0]!.body).toContain(
      "\u{201C}Checkout\u{201D} \u{2013} payments\u{2026}",
    );
    expect(telegramSent[0]!.body).toContain(
      "Turn off in User Settings &gt; Notification Settings.",
    );
    expect(workspaceSent.length).toBe(1);
    expect(workspaceText()).toContain(
      "\u{201C}Checkout\u{201D} \u{2013} payments\u{2026}",
    );
    expect(workspaceText()).toContain(
      "Turn off in User Settings > Notification Settings.",
    );
  });
});
