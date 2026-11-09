import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
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
import UserMattermostService from "../../../Server/Services/UserMattermostService";
import UserMicrosoftTeamsService from "../../../Server/Services/UserMicrosoftTeamsService";
import UserNotificationSettingService, {
  UserNotificationChannels,
} from "../../../Server/Services/UserNotificationSettingService";
import UserSlackService from "../../../Server/Services/UserSlackService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import WebhookService from "../../../Server/Services/WebhookService";
import WhatsAppService from "../../../Server/Services/WhatsAppService";
import WorkspaceUserNotificationService from "../../../Server/Services/WorkspaceUserNotificationService";
import EmailRollupWriter from "../../../Server/Utils/EmailRollup/EmailRollupWriter";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

/*
 * ONE NOTIFICATION, TO ONE SIDE OF A PERSON'S CHANNELS (#6353):
 * UserNotificationSettingService.sendUserNotification's `channels`.
 *
 * Left out, or All, a notification goes to every channel the person turned
 * on, as it always has. ChatOnly sends it to their Slack, Microsoft Teams and
 * Mattermost accounts alone - an approval request asked again in chat, its
 * message there having changed - and AllButChat to everything else: email,
 * SMS, call, push, WhatsApp, Telegram, webhooks and custom channels.
 */

const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

type Reached = Array<string>;

let reached: Reached;

function everythingOn(): UserNotificationSetting {
  return {
    alertByEmail: true,
    alertBySMS: true,
    alertByCall: true,
    alertByPush: true,
    alertByWhatsApp: true,
    alertByTelegram: true,
    alertBySlack: true,
    alertByMicrosoftTeams: true,
    alertByMattermost: true,
    alertByWebhook: true,
    alertByCustomChannel: true,
  } as unknown as UserNotificationSetting;
}

async function send(channels?: UserNotificationChannels): Promise<void> {
  await UserNotificationSettingService.sendUserNotification({
    userId: USER_ID,
    projectId: PROJECT_ID,
    eventType:
      NotificationSettingEventType.SEND_PUBLIC_NOTE_APPROVAL_REQUESTED_NOTIFICATION,
    emailEnvelope: {
      subject: "Approval needed: public note on Incident INC-42",
      vars: {},
    } as unknown as EmailEnvelope,
    smsMessage: { message: "Approval needed." },
    callRequestMessage: { data: [] } as CallRequestMessage,
    pushNotificationMessage: {
      title: "Approval needed",
      body: "A public note waits.",
    } as PushNotificationMessage,
    whatsAppMessage: { templateKey: "x" } as never,
    ...(channels ? { channels } : {}),
  });

  // Custom channels go out in the background: let them.
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

beforeEach(() => {
  reached = [];

  jest
    .spyOn(UserNotificationSettingService, "findOneBy")
    .mockResolvedValue(everythingOn() as never);
  jest
    .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/dashboard") as never);

  jest
    .spyOn(UserEmailService, "findBy")
    .mockResolvedValue([{ email: "bob@example.com" }] as never);
  jest.spyOn(UserSmsService, "findBy").mockResolvedValue([{ phone: "+1555" }] as never);
  jest
    .spyOn(UserWhatsAppService, "findBy")
    .mockResolvedValue([{ phone: "+1555" }] as never);
  jest
    .spyOn(UserTelegramService, "findBy")
    .mockResolvedValue([{ telegramChatId: "42" }] as never);
  jest.spyOn(UserCallService, "findBy").mockResolvedValue([{ phone: "+1555" }] as never);
  jest
    .spyOn(UserWebhookService, "findBy")
    .mockResolvedValue([{ webhookUrl: "https://hooks.example", name: "Mine" }] as never);
  jest
    .spyOn(UserSlackService, "findBy")
    .mockResolvedValue([{ slackUserId: "U0BOB" }] as never);
  jest
    .spyOn(UserMicrosoftTeamsService, "findBy")
    .mockResolvedValue([{ microsoftTeamsUserId: "entra-bob" }] as never);
  jest
    .spyOn(UserMattermostService, "findBy")
    .mockResolvedValue([{ mattermostUserId: "m".repeat(26) }] as never);

  jest.spyOn(EmailRollupWriter, "sendOrRollup").mockImplementation((async () => {
    reached.push("email");
  }) as never);
  jest.spyOn(SmsService, "sendSms").mockImplementation((async () => {
    reached.push("sms");
  }) as never);
  jest
    .spyOn(WhatsAppService, "sendWhatsAppMessage")
    .mockImplementation((async () => {
      reached.push("whatsapp");
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
    .mockImplementation((async () => {
      reached.push("custom");
      return [];
    }) as never);
  jest
    .spyOn(WorkspaceUserNotificationService, "sendDirectMessageToUser")
    .mockImplementation((async (data: { workspaceType: WorkspaceType }) => {
      reached.push(data.workspaceType);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const CHAT: Array<string> = [
  WorkspaceType.Slack,
  WorkspaceType.MicrosoftTeams,
  WorkspaceType.Mattermost,
];
const ELSEWHERE: Array<string> = [
  "call",
  "custom",
  "email",
  "push",
  "sms",
  "telegram",
  "webhook",
  "whatsapp",
];

describe("sendUserNotification: which of a person's channels", () => {
  test("left out: every channel they turned on, as always", async () => {
    await send();

    expect([...reached].sort()).toEqual([...CHAT, ...ELSEWHERE].sort());
  });

  test("All: the same", async () => {
    await send(UserNotificationChannels.All);

    expect([...reached].sort()).toEqual([...CHAT, ...ELSEWHERE].sort());
  });

  test("ChatOnly: their Slack, Microsoft Teams and Mattermost accounts, and nothing else", async () => {
    await send(UserNotificationChannels.ChatOnly);

    expect([...reached].sort()).toEqual([...CHAT].sort());
  });

  test("AllButChat: everything but their chat accounts", async () => {
    await send(UserNotificationChannels.AllButChat);

    expect([...reached].sort()).toEqual([...ELSEWHERE].sort());
  });

  test("ChatOnly still sends only the chats they turned on", async () => {
    jest.spyOn(UserNotificationSettingService, "findOneBy").mockResolvedValue({
      ...everythingOn(),
      alertBySlack: false,
      alertByMicrosoftTeams: false,
    } as never);

    await send(UserNotificationChannels.ChatOnly);

    expect(reached).toEqual([WorkspaceType.Mattermost]);
  });

  test("somebody with no setting for the event gets nothing, whatever the channels", async () => {
    jest
      .spyOn(UserNotificationSettingService, "findOneBy")
      .mockResolvedValue(null as never);

    for (const channels of Object.values(UserNotificationChannels)) {
      await send(channels);
    }

    expect(reached).toEqual([]);
  });
});
