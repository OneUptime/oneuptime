import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import IncidentService from "../../../Server/Services/IncidentService";
import AlertService from "../../../Server/Services/AlertService";
import MailService from "../../../Server/Services/MailService";
import SmsService from "../../../Server/Services/SmsService";
import CallService from "../../../Server/Services/CallService";
import WhatsAppService from "../../../Server/Services/WhatsAppService";
import TelegramService from "../../../Server/Services/TelegramService";
import WebhookService from "../../../Server/Services/WebhookService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import WorkspaceUserNotificationService from "../../../Server/Services/WorkspaceUserNotificationService";
import logger from "../../../Server/Utils/Logger";
import Incident from "../../../Models/DatabaseModels/Incident";
import Alert from "../../../Models/DatabaseModels/Alert";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import Email from "../../../Types/Email";
import Phone from "../../../Types/Phone";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  getOnCallTestPageNotVerifiedMessage,
  OnCallTestPageNotVerifiedChannel,
  readOnCallTestPageDeliveryLine,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPageLine";
import { OnCallTestPageLineCode } from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A REAL PAGE'S "NOT VERIFIED" ROW NAMES ITS METHOD (#7551).
 *
 * When an incident or an alert pages somebody through a rule whose method
 * is not verified, the delivery writes an Error row to their on-call log
 * instead of sending. User Settings > On-Call Logs draws that row's
 * Notification Method cell from the method the row names
 * (NotificationMethodView reads userEmail, userSms, userCall ...), and
 * draws nothing for a row that names none. Only the WhatsApp, Telegram,
 * Slack, Microsoft Teams and Mattermost rows named theirs: an unverified
 * email, SMS or call row was an Error beside an empty cell, the address
 * said only in the English sentence.
 *
 * Every row now names its method, and is written with the one line the test
 * page writes for the same thing (getOnCallTestPageNotVerifiedMessage), so
 * the reader that words that line in the reader's language
 * (readOnCallTestPageDeliveryLine) reads the real page's line too, and the
 * two copies cannot drift apart.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7551aaaa-0000-4000-8000-000000000001",
);
const RULE_ID: ObjectID = new ObjectID("7551aaaa-0000-4000-8000-000000000002");
const LOG_ID: ObjectID = new ObjectID("7551aaaa-0000-4000-8000-000000000003");
const USER_ID: ObjectID = new ObjectID("7551aaaa-0000-4000-8000-000000000004");
const INCIDENT_ID: ObjectID = new ObjectID(
  "7551aaaa-0000-4000-8000-000000000005",
);
const ALERT_ID: ObjectID = new ObjectID("7551aaaa-0000-4000-8000-000000000006");
const TIMELINE_ID: ObjectID = new ObjectID(
  "7551aaaa-0000-4000-8000-000000000007",
);
const METHOD_ID: ObjectID = new ObjectID(
  "7551aaaa-0000-4000-8000-000000000008",
);

// Every column a timeline row names its method by.
const METHOD_COLUMNS: ReadonlyArray<keyof UserOnCallLogTimeline> = [
  "userEmailId",
  "userSmsId",
  "userCallId",
  "userWhatsAppId",
  "userTelegramId",
  "userSlackId",
  "userMicrosoftTeamsId",
  "userMattermostId",
  "userPushId",
  "userWebhookId",
  "customNotificationChannelId",
];

/*
 * The row as it was handed to create(). The service writes one timeline
 * object and hands that same object to every create(), so each row is
 * copied as it is written.
 */
interface WrittenRow {
  status: UserNotificationStatus | undefined;
  statusMessage: string | undefined;
  methodIds: Partial<Record<keyof UserOnCallLogTimeline, string>>;
}

interface UnverifiedMethod {
  name: string;
  channel: OnCallTestPageNotVerifiedChannel;
  // The rule's relation to the method.
  relation: string;
  // The row's column that names it.
  column: keyof UserOnCallLogTimeline;
  method: JSONObject;
  // The email or the number the line names, if any.
  address?: string;
}

const UNVERIFIED_METHODS: Array<UnverifiedMethod> = [
  {
    name: "an email",
    channel: OnCallPageChannel.Email,
    relation: "userEmail",
    column: "userEmailId",
    method: {
      id: METHOD_ID,
      email: new Email("responder@company.com"),
      isVerified: false,
    } as unknown as JSONObject,
    address: "responder@company.com",
  },
  {
    name: "an SMS",
    channel: OnCallPageChannel.SMS,
    relation: "userSms",
    column: "userSmsId",
    method: {
      id: METHOD_ID,
      phone: new Phone("+15550100"),
      isVerified: false,
    } as unknown as JSONObject,
    address: "+15550100",
  },
  {
    name: "a call",
    channel: OnCallPageChannel.Call,
    relation: "userCall",
    column: "userCallId",
    method: {
      id: METHOD_ID,
      phone: new Phone("+15550101"),
      isVerified: false,
    } as unknown as JSONObject,
    address: "+15550101",
  },
  {
    name: "a WhatsApp number",
    channel: OnCallPageChannel.WhatsApp,
    relation: "userWhatsApp",
    column: "userWhatsAppId",
    method: {
      id: METHOD_ID,
      phone: new Phone("+15550102"),
      isVerified: false,
    } as unknown as JSONObject,
    address: "+15550102",
  },
  {
    name: "a Telegram account",
    channel: OnCallPageChannel.Telegram,
    relation: "userTelegram",
    column: "userTelegramId",
    method: {
      id: METHOD_ID,
      telegramChatId: "123456",
      isVerified: false,
    } as unknown as JSONObject,
  },
  {
    name: "a Slack account",
    channel: OnCallPageChannel.Slack,
    relation: "userSlack",
    column: "userSlackId",
    method: {
      id: METHOD_ID,
      slackUserId: "U0123456789",
      isVerified: false,
    } as unknown as JSONObject,
  },
  {
    name: "a Microsoft Teams account",
    channel: OnCallPageChannel.MicrosoftTeams,
    relation: "userMicrosoftTeams",
    column: "userMicrosoftTeamsId",
    method: {
      id: METHOD_ID,
      microsoftTeamsUserId: "teams-user-1",
      isVerified: false,
    } as unknown as JSONObject,
  },
  {
    name: "a Mattermost account",
    channel: OnCallPageChannel.Mattermost,
    relation: "userMattermost",
    column: "userMattermostId",
    method: {
      id: METHOD_ID,
      mattermostUserId: "abcdefghijklmnopqrstuvwxyz",
      isVerified: false,
    } as unknown as JSONObject,
  },
];

interface RecordKind {
  name: string;
  eventType: UserNotificationEventType;
  ids: JSONObject;
}

const RECORD_KINDS: Array<RecordKind> = [
  {
    name: "an incident",
    eventType: UserNotificationEventType.IncidentCreated,
    ids: { triggeredByIncidentId: INCIDENT_ID } as unknown as JSONObject,
  },
  {
    name: "an alert",
    eventType: UserNotificationEventType.AlertCreated,
    ids: { triggeredByAlertId: ALERT_ID } as unknown as JSONObject,
  },
];

type ExecuteOptions = Parameters<
  typeof UserNotificationRuleService.executeNotificationRuleItem
>[1];

let rows: Array<WrittenRow>;
let senders: Array<jest.SpyInstance>;
let findRule: jest.SpyInstance;

function useRule(channels: JSONObject): void {
  findRule.mockResolvedValue({
    id: RULE_ID,
    _id: RULE_ID.toString(),
    userId: USER_ID,
    ...channels,
  } as unknown as UserNotificationRule as never);
}

async function page(kind: RecordKind): Promise<void> {
  await UserNotificationRuleService.executeNotificationRuleItem(RULE_ID, {
    projectId: PROJECT_ID,
    userNotificationEventType: kind.eventType,
    userNotificationLogId: LOG_ID,
    ...kind.ids,
  } as unknown as ExecuteOptions);
}

beforeEach(() => {
  rows = [];

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  jest
    .spyOn(UserOnCallLogTimelineService, "create")
    .mockImplementation((createBy: unknown): Promise<UserOnCallLogTimeline> => {
      const data: UserOnCallLogTimeline = (
        createBy as { data: UserOnCallLogTimeline }
      ).data;

      const methodIds: Partial<Record<keyof UserOnCallLogTimeline, string>> =
        {};

      for (const column of METHOD_COLUMNS) {
        const value: unknown = data[column];

        if (value) {
          methodIds[column] = String(value);
        }
      }

      rows.push({
        status: data.status,
        statusMessage: data.statusMessage,
        methodIds: methodIds,
      });

      return Promise.resolve({
        id: TIMELINE_ID,
      } as unknown as UserOnCallLogTimeline);
    });
  jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserOnCallLogService, "claimNotificationRuleExecution")
    .mockResolvedValue(true as never);
  findRule = jest.spyOn(UserNotificationRuleService, "findOneById");
  jest
    .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
    .mockResolvedValue(undefined as never);
  jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
    id: INCIDENT_ID,
    projectId: PROJECT_ID,
    title: "Checkout is down",
    incidentNumber: 42,
    incidentNumberWithPrefix: "INC-42",
  } as unknown as Incident as never);
  jest.spyOn(AlertService, "findOneById").mockResolvedValue({
    id: ALERT_ID,
    projectId: PROJECT_ID,
    title: "Disk almost full",
    alertNumber: 7,
    alertNumberWithPrefix: "ALR-7",
  } as unknown as Alert as never);

  senders = [
    jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined as never),
    jest.spyOn(SmsService, "sendSms").mockResolvedValue(undefined as never),
    jest.spyOn(CallService, "makeCall").mockResolvedValue(undefined as never),
    jest
      .spyOn(WhatsAppService, "sendWhatsAppMessage")
      .mockResolvedValue(undefined as never),
    jest
      .spyOn(TelegramService, "sendTelegramMessage")
      .mockResolvedValue(undefined as never),
    jest
      .spyOn(WorkspaceUserNotificationService, "sendDirectMessageToUser")
      .mockResolvedValue(undefined as never),
    jest
      .spyOn(WebhookService, "sendWebhook")
      .mockResolvedValue(undefined as never),
    jest
      .spyOn(PushNotificationService, "sendPushNotification")
      .mockResolvedValue(undefined as never),
  ];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(RECORD_KINDS)(
  "a real page about $name through a method that is not verified",
  (kind: RecordKind) => {
    describe.each(UNVERIFIED_METHODS)("$name", (method: UnverifiedMethod) => {
      test("writes one Error row that names the method, so its Notification Method cell is drawn", async () => {
        useRule({ [method.relation]: method.method } as JSONObject);

        await page(kind);

        expect(rows).toHaveLength(1);
        expect(rows[0]!.status).toBe(UserNotificationStatus.Error);
        // The method, and that one only.
        expect(rows[0]!.methodIds).toEqual({
          [method.column]: METHOD_ID.toString(),
        });
      });

      test("writes the line the test page writes for it, which the reader words in the reader's language", async () => {
        useRule({ [method.relation]: method.method } as JSONObject);

        await page(kind);

        const line: string = getOnCallTestPageNotVerifiedMessage({
          channel: method.channel,
          address: method.address,
        });

        expect(rows[0]!.statusMessage).toBe(line);

        // The address, where the line has one, is the method's.
        if (method.address) {
          expect(line).toContain(method.address);
        }

        expect(
          readOnCallTestPageDeliveryLine({
            statusMessage: rows[0]!.statusMessage,
            channel: method.channel,
          }),
        ).toEqual({
          code: OnCallTestPageLineCode.MethodNotVerified,
          channel: method.channel,
        });
      });

      test("sends nothing through it", async () => {
        useRule({ [method.relation]: method.method } as JSONObject);

        await page(kind);

        for (const sender of senders) {
          expect(sender).not.toHaveBeenCalled();
        }
      });
    });
  },
);

describe("the lines a real page writes for a method that is not verified", () => {
  test("read today's words exactly, so rows already written read the same", () => {
    expect(
      getOnCallTestPageNotVerifiedMessage({
        channel: OnCallPageChannel.Email,
        address: "responder@company.com",
      }),
    ).toBe(
      "Email notification not sent because email responder@company.com is not verified.",
    );
    expect(
      getOnCallTestPageNotVerifiedMessage({
        channel: OnCallPageChannel.SMS,
        address: "+15550100",
      }),
    ).toBe("SMS not sent because phone +15550100 is not verified.");
    expect(
      getOnCallTestPageNotVerifiedMessage({
        channel: OnCallPageChannel.Call,
        address: "+15550101",
      }),
    ).toBe("Call not sent because phone +15550101 is not verified.");
    expect(
      getOnCallTestPageNotVerifiedMessage({
        channel: OnCallPageChannel.WhatsApp,
        address: "+15550102",
      }),
    ).toBe(
      "WhatsApp message not sent because phone +15550102 is not verified.",
    );
    expect(
      getOnCallTestPageNotVerifiedMessage({
        channel: OnCallPageChannel.Telegram,
      }),
    ).toBe(
      "Telegram message not sent because the Telegram account is not verified.",
    );
    expect(
      getOnCallTestPageNotVerifiedMessage({ channel: OnCallPageChannel.Slack }),
    ).toBe("Slack message not sent because the Slack account is not verified.");
    expect(
      getOnCallTestPageNotVerifiedMessage({
        channel: OnCallPageChannel.MicrosoftTeams,
      }),
    ).toBe(
      "Microsoft Teams message not sent because the Microsoft Teams account is not verified.",
    );
    expect(
      getOnCallTestPageNotVerifiedMessage({
        channel: OnCallPageChannel.Mattermost,
      }),
    ).toBe(
      "Mattermost message not sent because the Mattermost account is not verified.",
    );
  });

  test("a rule with a verified and an unverified method writes the Error row for the unverified one only", async () => {
    useRule({
      userEmail: {
        id: new ObjectID("7551aaaa-0000-4000-8000-0000000000e1"),
        email: new Email("verified@company.com"),
        isVerified: true,
      },
      userSms: {
        id: METHOD_ID,
        phone: new Phone("+15550100"),
        isVerified: false,
      },
    } as unknown as JSONObject);
    jest
      .spyOn(
        UserNotificationRuleService,
        "generateEmailTemplateForIncidentCreated",
      )
      .mockResolvedValue({} as never);

    await page(RECORD_KINDS[0]!);

    const errors: Array<WrittenRow> = rows.filter((row: WrittenRow) => {
      return row.status === UserNotificationStatus.Error;
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]!.methodIds["userSmsId"]).toBe(METHOD_ID.toString());
    expect(errors[0]!.statusMessage).toBe(
      "SMS not sent because phone +15550100 is not verified.",
    );
  });
});
