import OnCallTestPageDelivery, {
  ON_CALL_TEST_PAGE_WEBHOOK_EVENT,
  OnCallTestPageContext,
} from "../../../../Server/Utils/OnCall/OnCallTestPageDelivery";
import OnCallPageLinks from "../../../../Server/Utils/OnCall/OnCallPageLinks";
import CallService from "../../../../Server/Services/CallService";
import CustomNotificationChannelDeliveryService from "../../../../Server/Services/CustomNotificationChannelDeliveryService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import MailService from "../../../../Server/Services/MailService";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import ProjectCallSMSConfigService from "../../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../../Server/Services/ProjectService";
import PushNotificationService from "../../../../Server/Services/PushNotificationService";
import ShortLinkService from "../../../../Server/Services/ShortLinkService";
import SmsService from "../../../../Server/Services/SmsService";
import TelegramService from "../../../../Server/Services/TelegramService";
import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import UserService from "../../../../Server/Services/UserService";
import WebhookService from "../../../../Server/Services/WebhookService";
import WhatsAppService from "../../../../Server/Services/WhatsAppService";
import WorkspaceUserNotificationService from "../../../../Server/Services/WorkspaceUserNotificationService";
import { getServerTranslator } from "../../../../Server/Utils/ServerTranslation";
import logger from "../../../../Server/Utils/Logger";
import UserNotificationRule from "../../../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLogTimeline from "../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import URL from "../../../../Types/API/URL";
import CallRequest, { GatherInput } from "../../../../Types/Call/CallRequest";
import { CustomChannelEvent } from "../../../../Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import Email from "../../../../Types/Email";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../../Types/JSON";
import PushNotificationLevel from "../../../../Types/NotificationRule/PushNotificationLevel";
import ObjectID from "../../../../Types/ObjectID";
import { OnCallTestPageRecordKind } from "../../../../Types/OnCallDutyPolicy/OnCallTestPage";
import Phone from "../../../../Types/Phone";
import PushDeviceType from "../../../../Types/PushNotification/PushDeviceType";
import PushNotificationMessage from "../../../../Types/PushNotification/PushNotificationMessage";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationStatus from "../../../../Types/UserNotification/UserNotificationStatus";
import { WhatsAppTemplateIds } from "../../../../Types/WhatsApp/WhatsAppTemplates";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { WorkspacePayloadMarkdown } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import { ExecuteNotificationRuleOptions } from "../../../../Server/Services/UserNotificationRuleService";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A TEST PAGE'S MESSAGES (OnCallTestPageDelivery): every method a real page
 * of the rule would use gets the test's own message, by the same sender,
 * with the same plan and balance rules (the sender is handed the project),
 * and a row of the person's timeline per message - TEST in the first words,
 * the links that acknowledge it, nothing that names a record.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RULE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const LOG_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const SENDER_ID: ObjectID = new ObjectID(
  "45454545-4545-4545-8545-454545454545",
);
const METHOD_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const RUN_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const POLICY_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const CHANNEL_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

const ACK_PAGE_URL: string = "https://oneuptime.test/acknowledge-page/row";
const EMAIL_ACK_URL: string = "https://oneuptime.test/acknowledge-page/email";
const CALL_RESPONSE_URL: string = "https://oneuptime.test/call/gather-input";
const SHORT_URL: string = "https://oneuptime.test/l/abcd";

let createdRows: Array<UserOnCallLogTimeline>;
let rowCounter: number;

function options(
  overrides: Partial<ExecuteNotificationRuleOptions> = {},
): ExecuteNotificationRuleOptions {
  return {
    projectId: PROJECT_ID,
    userNotificationEventType: UserNotificationEventType.TestPage,
    onCallPolicyExecutionLogId: RUN_ID,
    onCallPolicyId: undefined,
    userNotificationLogId: LOG_ID,
    ...overrides,
  };
}

function rule(methods: Record<string, unknown>): UserNotificationRule {
  return {
    id: RULE_ID,
    userId: USER_ID,
    ...methods,
  } as unknown as UserNotificationRule;
}

function newRow(): UserOnCallLogTimeline {
  const row: UserOnCallLogTimeline = new UserOnCallLogTimeline();
  row.projectId = PROJECT_ID;
  row.userNotificationLogId = LOG_ID;
  row.userId = USER_ID;
  row.userNotificationRuleId = RULE_ID;
  row.userNotificationEventType = UserNotificationEventType.TestPage;
  return row;
}

async function deliver(
  methods: Record<string, unknown>,
  overrides: Partial<ExecuteNotificationRuleOptions> = {},
  language: string = "en",
): Promise<boolean> {
  const attempted: boolean = await OnCallTestPageDelivery.deliver({
    rule: rule(methods),
    options: options(overrides),
    translator: getServerTranslator(language),
    newTimelineRow: newRow,
  });

  // Sends are not awaited: let their .catch run before asserting.
  await Promise.resolve();
  await Promise.resolve();

  return attempted;
}

function armRun(data: {
  recordKind?: OnCallTestPageRecordKind;
  triggeredByUserId?: ObjectID | undefined;
  onCallDutyPolicyId?: ObjectID | undefined;
}): void {
  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
    .mockResolvedValue({
      id: RUN_ID,
      testPageRecordKind: data.recordKind || OnCallTestPageRecordKind.Incident,
      testPageSeverityId: SEVERITY_ID,
      triggeredByUserId: data.triggeredByUserId,
      onCallDutyPolicyId: data.onCallDutyPolicyId,
    } as never);
}

beforeEach(() => {
  createdRows = [];
  rowCounter = 0;

  jest
    .spyOn(UserOnCallLogTimelineService, "create")
    .mockImplementation((createBy: unknown): Promise<UserOnCallLogTimeline> => {
      const data: UserOnCallLogTimeline = (
        createBy as { data: UserOnCallLogTimeline }
      ).data;
      rowCounter++;
      createdRows.push(data);
      const saved: UserOnCallLogTimeline = data;
      saved.id = new ObjectID(
        `aaaaaaaa-aaaa-4aaa-8aaa-${String(rowCounter).padStart(12, "0")}`,
      );
      return Promise.resolve(saved);
    });

  jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);

  armRun({ triggeredByUserId: USER_ID });

  jest
    .spyOn(IncidentSeverityService, "findOneById")
    .mockResolvedValue({ name: "Critical" } as never);
  jest
    .spyOn(AlertSeverityService, "findOneById")
    .mockResolvedValue({ name: "High" } as never);
  jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue({ name: "Acme" } as never);
  jest
    .spyOn(OnCallDutyPolicyService, "findOneById")
    .mockResolvedValue({ name: "Primary" } as never);
  jest
    .spyOn(UserService, "findOneById")
    .mockResolvedValue({ name: "Ana Lopez", email: "ana@example.com" } as never);

  jest
    .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
    .mockResolvedValue(undefined as never);

  jest.spyOn(ShortLinkService, "saveShortLinkFor").mockResolvedValue({} as never);
  jest
    .spyOn(ShortLinkService, "getShortenedUrl")
    .mockResolvedValue(URL.fromString(SHORT_URL) as never);
  jest
    .spyOn(OnCallPageLinks, "getAcknowledgePageUrl")
    .mockResolvedValue(URL.fromString(ACK_PAGE_URL) as never);
  jest
    .spyOn(OnCallPageLinks, "getEmailAcknowledgePageUrl")
    .mockResolvedValue(URL.fromString(EMAIL_ACK_URL) as never);
  jest
    .spyOn(OnCallPageLinks, "getCallResponseUrl")
    .mockResolvedValue(URL.fromString(CALL_RESPONSE_URL) as never);

  jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined as never);
  jest.spyOn(SmsService, "sendSms").mockResolvedValue(undefined as never);
  jest.spyOn(CallService, "makeCall").mockResolvedValue(undefined as never);
  jest
    .spyOn(WhatsAppService, "sendWhatsAppMessage")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(TelegramService, "sendTelegramMessage")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(WorkspaceUserNotificationService, "sendDirectMessageToUser")
    .mockResolvedValue(undefined as never);
  jest.spyOn(WebhookService, "sendWebhook").mockResolvedValue(undefined as never);
  jest
    .spyOn(PushNotificationService, "sendPushNotification")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomNotificationChannelDeliveryService, "send")
    .mockResolvedValue({ ok: true, message: "ok" } as never);
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("email", () => {
  test("the test's own template, TEST first, with the link that acknowledges it", async () => {
    const attempted: boolean = await deliver({
      userEmail: {
        id: METHOD_ID,
        email: new Email("ana@example.com"),
        isVerified: true,
      },
    });

    expect(attempted).toBe(true);
    expect(MailService.sendMail).toHaveBeenCalledTimes(1);

    const [message, sendOptions] = (MailService.sendMail as jest.Mock).mock
      .calls[0] as [JSONObject, JSONObject];

    expect(message["templateType"]).toBe(EmailTemplateType.OnCallTestPage);
    expect(message["subject"]).toBe("TEST page from Acme: nothing is wrong");
    expect(message["isSubjectLiteral"]).toBe(true);
    expect((message["toEmail"] as Email).toString()).toBe("ana@example.com");

    const vars: JSONObject = message["vars"] as JSONObject;
    expect(vars["acknowledgeLink"]).toBe(EMAIL_ACK_URL);
    expect(vars["whatItTests"]).toBe(
      "Nothing is wrong. This tests how Acme pages you for an incident of severity Critical.",
    );
    expect(vars["sentBy"]).toBe("You sent yourself this test page.");
    // English: the envelope names no language, as every English email's.
    expect(message["language"]).toBeUndefined();

    // Sent in the project, so its rules for blocked projects apply.
    expect(sendOptions["projectId"]).toBe(PROJECT_ID);
    expect(sendOptions["userId"]).toBe(USER_ID);
    expect(String(sendOptions["userOnCallLogTimelineId"])).toBe(
      createdRows[0]!.id!.toString(),
    );

    expect(createdRows).toHaveLength(1);
    expect(createdRows[0]!.status).toBe(UserNotificationStatus.Sending);
    expect(createdRows[0]!.statusMessage).toBe(
      "Sending email to ana@example.com",
    );
    expect(createdRows[0]!.userEmailId?.toString()).toBe(METHOD_ID.toString());
    expect(createdRows[0]!.userNotificationEventType).toBe(
      UserNotificationEventType.TestPage,
    );
  });

  test("in the person's language: the envelope names it, the subject is worded in it", async () => {
    await deliver(
      {
        userEmail: {
          id: METHOD_ID,
          email: new Email("ana@example.com"),
          isVerified: true,
        },
      },
      {},
      "de",
    );

    const [message] = (MailService.sendMail as jest.Mock).mock.calls[0] as [
      JSONObject,
    ];

    expect(message["language"]).toBe("de");
    expect(withoutIsolateMarks(message["subject"] as string)).toBe(
      "TEST-Alarmierung von Acme: Alles in Ordnung",
    );
  });

  test("an email that is not verified gets the row a real page writes, and nothing is sent", async () => {
    const attempted: boolean = await deliver({
      userEmail: {
        id: METHOD_ID,
        email: new Email("ana@example.com"),
        isVerified: false,
      },
    });

    expect(attempted).toBe(false);
    expect(MailService.sendMail).not.toHaveBeenCalled();
    expect(createdRows).toHaveLength(1);
    expect(createdRows[0]!.status).toBe(UserNotificationStatus.Error);
    expect(createdRows[0]!.statusMessage).toBe(
      "Email notification not sent because email ana@example.com is not verified.",
    );
  });

  test("a send that fails before its sender says so marks its row Error, with the reason", async () => {
    (MailService.sendMail as jest.Mock).mockRejectedValue(
      new Error("SMTP refused") as never,
    );

    await deliver({
      userEmail: {
        id: METHOD_ID,
        email: new Email("ana@example.com"),
        isVerified: true,
      },
    });

    expect(UserOnCallLogTimelineService.updateOneById).toHaveBeenCalledWith({
      id: createdRows[0]!.id,
      data: {
        status: UserNotificationStatus.Error,
        statusMessage: "SMTP refused",
      },
      props: {
        isRoot: true,
      },
    });
  });
});

describe("SMS", () => {
  test("TEST first, the project, nothing wrong, and the short link - sent in the project with its Twilio", async () => {
    const twilio: Record<string, string> = { accountSid: "AC1" };
    (
      ProjectCallSMSConfigService.getProjectDefaultTwilioConfig as jest.Mock
    ).mockResolvedValue(twilio as never);

    await deliver({
      userSms: {
        id: METHOD_ID,
        phone: new Phone("+15550100"),
        isVerified: true,
      },
    });

    const [sms, sendOptions] = (SmsService.sendSms as jest.Mock).mock
      .calls[0] as [{ to: Phone; message: string }, JSONObject];

    expect(sms.to.toString()).toBe("+15550100");
    expect(sms.message).toBe(
      `TEST page from OneUptime for Acme: nothing is wrong. Acknowledge: ${SHORT_URL}`,
    );
    // The project is what applies its SMS switch and balance to the test.
    expect(sendOptions["projectId"]).toBe(PROJECT_ID);
    expect(sendOptions["customTwilioConfig"]).toBe(twilio);
    expect(String(sendOptions["userOnCallLogTimelineId"])).toBe(
      createdRows[0]!.id!.toString(),
    );
    expect(createdRows[0]!.statusMessage).toBe("Sending SMS to +15550100.");
    expect(createdRows[0]!.userSmsId?.toString()).toBe(METHOD_ID.toString());
  });

  test("a long project name is cut, so the text stays short", async () => {
    (ProjectService.findOneById as jest.Mock).mockResolvedValue({
      name: "The Very Long Project Name Of A Big Company Inc",
    } as never);

    await deliver({
      userSms: {
        id: METHOD_ID,
        phone: new Phone("+15550100"),
        isVerified: true,
      },
    });

    const [sms] = (SmsService.sendSms as jest.Mock).mock.calls[0] as [
      { message: string },
    ];

    expect(sms.message).toContain("for The Very Long Project Name Of A Big Com…:");
    expect(sms.message.length).toBeLessThanOrEqual(160);
  });

  test("an unverified number is not texted", async () => {
    await deliver({
      userSms: {
        id: METHOD_ID,
        phone: new Phone("+15550100"),
        isVerified: false,
      },
    });

    expect(SmsService.sendSms).not.toHaveBeenCalled();
    expect(createdRows[0]!.statusMessage).toBe(
      "SMS not sent because phone +15550100 is not verified.",
    );
  });
});

describe("call", () => {
  test("says it is a test and nothing is wrong, and 1 acknowledges it through the row's own callback", async () => {
    await deliver({
      userCall: {
        id: METHOD_ID,
        phone: new Phone("+15550100"),
        isVerified: true,
      },
    });

    const [callRequest, sendOptions] = (CallService.makeCall as jest.Mock).mock
      .calls[0] as [CallRequest, JSONObject];

    expect(callRequest.to.toString()).toBe("+15550100");

    const says: Array<string> = callRequest.data
      .filter((item: unknown): boolean => {
        return Boolean((item as { sayMessage?: string }).sayMessage);
      })
      .map((item: unknown): string => {
        return (item as { sayMessage: string }).sayMessage;
      });

    expect(says[0]).toBe(
      "This is a test page from OneUptime. Nothing is wrong.",
    );
    expect(says[1]).toBe(
      "This tests how Acme pages you for an incident of severity Critical.",
    );

    const gather: GatherInput = callRequest.data.find((item: unknown) => {
      return Boolean((item as GatherInput).onInputCallRequest);
    }) as GatherInput;

    expect(gather.introMessage).toBe("To acknowledge this test page, press 1.");
    expect(gather.responseUrl.toString()).toBe(CALL_RESPONSE_URL);
    expect(
      (gather.onInputCallRequest["1"] as { sayMessage: string }).sayMessage,
    ).toContain("You have acknowledged this test page.");
    // Nothing to escalate on a test: 1 is the only answer.
    expect(Object.keys(gather.onInputCallRequest).sort()).toEqual([
      "1",
      "default",
    ]);

    expect(sendOptions["projectId"]).toBe(PROJECT_ID);
    expect(createdRows[0]!.statusMessage).toBe("Making a call to +15550100.");
  });
});

describe("push", () => {
  test("TEST first, with no page buttons, opening the page that acknowledges it", async () => {
    await deliver({
      pushNotificationLevel: PushNotificationLevel.Standard,
      userPush: {
        id: METHOD_ID,
        deviceToken: "token",
        deviceType: PushDeviceType.iOS,
        isVerified: true,
        isCriticalAlertEnabled: true,
      },
    });

    const [request, sendOptions] = (
      PushNotificationService.sendPushNotification as jest.Mock
    ).mock.calls[0] as [
      { message: PushNotificationMessage; devices: Array<{ token: string }> },
      JSONObject,
    ];

    expect(request.message.title).toBe("TEST page from OneUptime");
    expect(request.message.body).toBe(
      "Nothing is wrong. This tests how Acme pages you for an incident of severity Critical.",
    );
    expect(request.message.url).toBe(ACK_PAGE_URL);
    // The On-Call app's Acknowledge acknowledges a record: a test has none.
    expect(request.message.categoryId).toBeUndefined();
    expect(request.devices[0]!.token).toBe("token");
    expect(String(sendOptions["userOnCallLogTimelineId"])).toBe(
      createdRows[0]!.id!.toString(),
    );
    expect(createdRows[0]!.statusMessage).toBe(
      "Sending push notification to device.",
    );
  });

  test("rings through silent mode exactly when the real page of the rule would", async () => {
    await deliver({
      pushNotificationLevel: PushNotificationLevel.Critical,
      userPush: {
        id: METHOD_ID,
        deviceToken: "token",
        deviceType: PushDeviceType.iOS,
        isVerified: true,
        isCriticalAlertEnabled: true,
      },
    });

    let [request] = (PushNotificationService.sendPushNotification as jest.Mock)
      .mock.calls[0] as [{ message: PushNotificationMessage }];
    expect(request.message.isCriticalAlert).toBe(true);

    (PushNotificationService.sendPushNotification as jest.Mock).mockClear();

    await deliver({
      pushNotificationLevel: PushNotificationLevel.Standard,
      userPush: {
        id: METHOD_ID,
        deviceToken: "token",
        deviceType: PushDeviceType.iOS,
        isVerified: true,
        isCriticalAlertEnabled: true,
      },
    });

    [request] = (PushNotificationService.sendPushNotification as jest.Mock).mock
      .calls[0] as [{ message: PushNotificationMessage }];
    expect(request.message.isCriticalAlert).toBe(false);
  });

  test("a device that stopped receiving gets the words a real page writes", async () => {
    await deliver({
      userPush: {
        id: METHOD_ID,
        deviceToken: "token",
        deviceType: PushDeviceType.iOS,
        isVerified: false,
      },
    });

    expect(PushNotificationService.sendPushNotification).not.toHaveBeenCalled();
    expect(createdRows[0]!.status).toBe(UserNotificationStatus.Error);
    expect(createdRows[0]!.statusMessage).toBe(
      PushNotificationService.getNotSentToUnverifiedDeviceMessage(
        PushDeviceType.iOS,
      ),
    );
  });
});

describe("WhatsApp", () => {
  test("the test message Meta approved, sent in the project", async () => {
    await deliver({
      userWhatsApp: {
        id: METHOD_ID,
        phone: new Phone("+15550100"),
        isVerified: true,
      },
    });

    const [message, sendOptions] = (
      WhatsAppService.sendWhatsAppMessage as jest.Mock
    ).mock.calls[0] as [JSONObject, JSONObject];

    expect(message["templateKey"]).toBe(WhatsAppTemplateIds.TestNotification);
    expect(message["templateLanguageCode"]).toBe("en");
    expect(sendOptions["projectId"]).toBe(PROJECT_ID);
    expect(createdRows[0]!.userWhatsAppId?.toString()).toBe(
      METHOD_ID.toString(),
    );
  });
});

describe("Telegram", () => {
  test("HTML with TEST first and the acknowledge link, every value escaped", async () => {
    (ProjectService.findOneById as jest.Mock).mockResolvedValue({
      name: "R&D <ops>",
    } as never);

    await deliver({
      userTelegram: {
        id: METHOD_ID,
        telegramChatId: "12345",
        isVerified: true,
      },
    });

    const [message] = (TelegramService.sendTelegramMessage as jest.Mock).mock
      .calls[0] as [{ body: string; parseMode: string; to: string }];

    expect(message.to).toBe("12345");
    expect(message.parseMode).toBe("HTML");
    expect(message.body.startsWith("🧪 <b>TEST page from")).toBe(true);
    expect(message.body).toContain("R&amp;D &lt;ops&gt;");
    expect(message.body).not.toContain("<ops>");
    expect(message.body).toContain(
      `<a href="${SHORT_URL}">Acknowledge test page</a>`,
    );
  });
});

describe("Slack, Microsoft Teams and Mattermost", () => {
  test.each<[string, WorkspaceType, string, string]>([
    ["userSlack", WorkspaceType.Slack, "slackUserId", "userSlackId"],
    [
      "userMicrosoftTeams",
      WorkspaceType.MicrosoftTeams,
      "microsoftTeamsUserId",
      "userMicrosoftTeamsId",
    ],
    [
      "userMattermost",
      WorkspaceType.Mattermost,
      "mattermostUserId",
      "userMattermostId",
    ],
  ])(
    "%s gets a message to the person, TEST first, with the acknowledge link",
    async (
      relation: string,
      workspaceType: WorkspaceType,
      userIdColumn: string,
      timelineColumn: string,
    ) => {
      await deliver({
        [relation]: {
          id: METHOD_ID,
          [userIdColumn]: "U123",
          isVerified: true,
        },
      });

      const [send] = (
        WorkspaceUserNotificationService.sendDirectMessageToUser as jest.Mock
      ).mock.calls[0] as [
        {
          workspaceType: WorkspaceType;
          workspaceUserId: string;
          messageBlocks: Array<WorkspacePayloadMarkdown>;
          notificationText: string;
          userOnCallLogTimelineId: ObjectID;
          incidentId?: ObjectID;
          alertId?: ObjectID;
        },
      ];

      expect(send.workspaceType).toBe(workspaceType);
      expect(send.workspaceUserId).toBe("U123");
      expect(send.notificationText).toBe("TEST page from OneUptime");
      expect(send.messageBlocks[0]!.text.startsWith("🧪 **TEST page from")).toBe(
        true,
      );
      expect(send.messageBlocks[0]!.text).toContain(
        `[Acknowledge test page](${SHORT_URL})`,
      );
      // About no record.
      expect(send.incidentId).toBeUndefined();
      expect(send.alertId).toBeUndefined();
      expect(String(send.userOnCallLogTimelineId)).toBe(
      createdRows[0]!.id!.toString(),
    );
      expect(
        (createdRows[0] as unknown as Record<string, ObjectID>)[
          timelineColumn
        ]?.toString(),
      ).toBe(METHOD_ID.toString());
    },
  );

  test("a project or a sender name with Markdown in it is escaped, not rendered", async () => {
    armRun({ triggeredByUserId: SENDER_ID });
    (UserService.findOneById as jest.Mock).mockResolvedValue({
      name: "[click](https://evil.example)",
    } as never);

    await deliver({
      userSlack: { id: METHOD_ID, slackUserId: "U1", isVerified: true },
    });

    const [send] = (
      WorkspaceUserNotificationService.sendDirectMessageToUser as jest.Mock
    ).mock.calls[0] as [{ messageBlocks: Array<WorkspacePayloadMarkdown> }];

    expect(send.messageBlocks[0]!.text).not.toContain(
      "[click](https://evil.example)",
    );
  });

  test("an account that is not verified gets a real page's row", async () => {
    await deliver({
      userSlack: { id: METHOD_ID, slackUserId: "U1", isVerified: false },
    });

    expect(
      WorkspaceUserNotificationService.sendDirectMessageToUser,
    ).not.toHaveBeenCalled();
    expect(createdRows[0]!.statusMessage).toBe(
      "Slack message not sent because the Slack account is not verified.",
    );
    expect(createdRows[0]!.userSlackId?.toString()).toBe(METHOD_ID.toString());
  });
});

describe("webhook", () => {
  test("the documented test event, saying it is a test page, signed with its secret", async () => {
    await deliver(
      {
        userWebhook: {
          id: METHOD_ID,
          webhookUrl: "https://hooks.example.com/on-call",
          secret: "s3cret",
        },
      },
      { onCallPolicyId: POLICY_ID },
    );

    const [request, sendOptions] = (WebhookService.sendWebhook as jest.Mock)
      .mock.calls[0] as [
      {
        url: string;
        eventType: string;
        payload: JSONObject;
        secret: string;
      },
      JSONObject,
    ];

    expect(ON_CALL_TEST_PAGE_WEBHOOK_EVENT).toBe("test");
    expect(request.url).toBe("https://hooks.example.com/on-call");
    expect(request.eventType).toBe("test");
    expect(request.secret).toBe("s3cret");
    expect(request.payload["eventType"]).toBe("test");
    expect(request.payload["isTestPage"]).toBe(true);
    expect(request.payload["userId"]).toBe(USER_ID.toString());
    expect(request.payload["onCallPolicyId"]).toBe(POLICY_ID.toString());
    expect(request.payload["testPage"]).toEqual({
      executionLogId: RUN_ID.toString(),
      recordKind: "Incident",
      severity: "Critical",
      acknowledgeUrl: ACK_PAGE_URL,
    });
    // No record of any kind on the wire.
    expect(request.payload["incident"]).toBeUndefined();
    expect(request.payload["alert"]).toBeUndefined();
    expect(sendOptions["projectId"]).toBe(PROJECT_ID);
  });
});

describe("custom channel", () => {
  test("the documented Send test payload, so a channel's service needs nothing new", async () => {
    await deliver({
      customNotificationChannelId: CHANNEL_ID,
      customNotificationChannel: { name: "Pager App", isEnabled: true },
    });

    const [send] = (CustomNotificationChannelDeliveryService.send as jest.Mock)
      .mock.calls[0] as [
      {
        customNotificationChannelId: ObjectID;
        eventType: string;
        payload: JSONObject;
        projectId: ObjectID;
        userOnCallLogTimelineId: ObjectID;
      },
    ];

    expect(send.customNotificationChannelId).toBe(CHANNEL_ID);
    expect(send.eventType).toBe(CustomChannelEvent.Test);
    expect(send.payload["event"]).toBe("test");
    expect(send.payload["record"]).toBeNull();
    expect(send.payload["actions"]).toBeNull();
    expect(send.projectId).toBe(PROJECT_ID);
    expect(String(send.userOnCallLogTimelineId)).toBe(
      createdRows[0]!.id!.toString(),
    );
    expect(createdRows[0]!.statusMessage).toBe("Sending to Pager App.");
  });

  test("a channel that is turned off says so and sends nothing", async () => {
    await deliver({
      customNotificationChannelId: CHANNEL_ID,
      customNotificationChannel: { name: "Pager App", isEnabled: false },
    });

    expect(CustomNotificationChannelDeliveryService.send).not.toHaveBeenCalled();
    expect(createdRows[0]!.status).toBe(UserNotificationStatus.Error);
    expect(createdRows[0]!.statusMessage).toBe(
      "Not sent: Pager App is turned off.",
    );
  });
});

describe("a rule with several methods", () => {
  test("every method gets a row of its own - none overwrites another", async () => {
    await deliver({
      userEmail: {
        id: METHOD_ID,
        email: new Email("ana@example.com"),
        isVerified: true,
      },
      userSms: {
        id: METHOD_ID,
        phone: new Phone("+15550100"),
        isVerified: true,
      },
      userCall: {
        id: METHOD_ID,
        phone: new Phone("+15550100"),
        isVerified: false,
      },
    });

    expect(createdRows).toHaveLength(3);
    expect(new Set(createdRows).size).toBe(3);
    expect(
      createdRows.map((row: UserOnCallLogTimeline) => {
        return row.statusMessage;
      }),
    ).toEqual([
      "Sending email to ana@example.com",
      "Sending SMS to +15550100.",
      "Call not sent because phone +15550100 is not verified.",
    ]);
    // A row names the one method it is about.
    expect(createdRows[0]!.userSmsId).toBeUndefined();
  });

  test("a rule that can reach nobody attempts nothing and writes nothing", async () => {
    expect(await deliver({})).toBe(false);
    expect(createdRows).toHaveLength(0);
  });
});

describe("what every message says (readContext)", () => {
  async function readContext(): Promise<OnCallTestPageContext> {
    return await OnCallTestPageDelivery.readContext({
      options: options(),
      userId: USER_ID,
      translator: getServerTranslator("en"),
    });
  }

  test("a test the person sent themselves", async () => {
    expect(await readContext()).toEqual({
      recordKind: OnCallTestPageRecordKind.Incident,
      severityName: "Critical",
      projectName: "Acme",
      isSentBySelf: true,
      senderName: "",
    });
  });

  test("a member's test names who sent it; an alert's names the alert severity", async () => {
    armRun({
      triggeredByUserId: SENDER_ID,
      recordKind: OnCallTestPageRecordKind.Alert,
    });

    expect(await readContext()).toEqual({
      recordKind: OnCallTestPageRecordKind.Alert,
      severityName: "High",
      projectName: "Acme",
      isSentBySelf: false,
      senderName: "Ana Lopez",
    });
  });

  test("a policy's test names the policy", async () => {
    armRun({ triggeredByUserId: SENDER_ID, onCallDutyPolicyId: POLICY_ID });

    expect((await readContext()).policyName).toBe("Primary");
  });

  test("OneUptime's default severity names are worded in the person's language", async () => {
    const context: OnCallTestPageContext =
      await OnCallTestPageDelivery.readContext({
        options: options(),
        userId: USER_ID,
        translator: getServerTranslator("de"),
      });

    expect(context.severityName.length).toBeGreaterThan(0);
  });

  test("a read that fails leaves the sentences plainer, and the test still goes out", async () => {
    (OnCallDutyPolicyExecutionLogService.findOneById as jest.Mock).mockRejectedValue(
      new Error("database is slow") as never,
    );

    expect(await readContext()).toEqual({
      recordKind: OnCallTestPageRecordKind.Incident,
      severityName: "",
      projectName: "",
      isSentBySelf: false,
      senderName: "",
    });
    expect(logger.error).toHaveBeenCalled();

    const attempted: boolean = await deliver({
      userEmail: {
        id: METHOD_ID,
        email: new Email("ana@example.com"),
        isVerified: true,
      },
    });

    expect(attempted).toBe(true);
    expect(MailService.sendMail).toHaveBeenCalledTimes(1);
  });
});
