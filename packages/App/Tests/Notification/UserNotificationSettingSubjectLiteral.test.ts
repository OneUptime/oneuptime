import UserEmail from "Common/Models/DatabaseModels/UserEmail";
import UserNotificationEmailRollupItem from "Common/Models/DatabaseModels/UserNotificationEmailRollupItem";
import UserNotificationSetting from "Common/Models/DatabaseModels/UserNotificationSetting";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import MailService from "Common/Server/Services/MailService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import UserEmailService from "Common/Server/Services/UserEmailService";
import UserNotificationEmailRollupItemService from "Common/Server/Services/UserNotificationEmailRollupItemService";
import UserNotificationEmailRollupSettingService from "Common/Server/Services/UserNotificationEmailRollupSettingService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import logger from "Common/Server/Utils/Logger";
import URL from "Common/Types/API/URL";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Email from "Common/Types/Email";
import EmailMessage, { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "Common/Types/SMS/SMS";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

/*
 * Owner jobs hand their email to UserNotificationSettingService, which copies
 * the envelope (adding the preferences link) and passes it through the rollup
 * writer to MailService. The flag that marks the subject as finished text has
 * to survive that copy: dropped, the mailer compiles the subject through
 * Handlebars again, and an owner whose incident title contains a lone "{{"
 * gets no email.
 *
 * The real service runs with email as the only enabled channel; its database
 * reads and MailService are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OWNER_EMAIL: string = "owner@acme.test";
const SUBJECT: string =
  "[New Incident #12] - Rollout of {{ .Values.image.tag }} stalled";

type SendUserNotificationData = Parameters<
  typeof UserNotificationSettingService.sendUserNotification
>[0];

function notificationData(
  overrides: Partial<SendUserNotificationData> = {},
): SendUserNotificationData {
  const envelope: EmailEnvelope = {
    templateType: EmailTemplateType.IncidentOwnerResourceCreated,
    vars: {
      incidentViewLink: "https://oneuptime.test/dashboard/incidents/12",
    },
    subject: SUBJECT,
    isSubjectLiteral: true,
  };

  return {
    userId: USER_ID,
    projectId: PROJECT_ID,
    eventType:
      NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
    emailEnvelope: envelope,
    smsMessage: { message: "Incident created" } as SMSMessage,
    callRequestMessage: {} as CallRequestMessage,
    pushNotificationMessage: {} as PushNotificationMessage,
    whatsAppMessage: {} as WhatsAppMessagePayload,
    incidentId: INCIDENT_ID,
    ...overrides,
  } as SendUserNotificationData;
}

describe("UserNotificationSettingService.sendUserNotification", () => {
  let sendMail: jest.SpiedFunction<typeof MailService.sendMail>;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    jest
      .spyOn(UserNotificationSettingService, "findOneBy")
      .mockResolvedValue({ alertByEmail: true } as UserNotificationSetting);
    jest
      .spyOn(UserEmailService, "findBy")
      .mockResolvedValue([
        { email: new Email(OWNER_EMAIL) } as unknown as UserEmail,
      ]);
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/dashboard"));
    jest
      .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
      .mockResolvedValue(undefined);

    // An address that has had no owner email recently: sent immediately.
    jest
      .spyOn(UserNotificationEmailRollupItemService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(UserNotificationEmailRollupItemService, "create")
      .mockResolvedValue(new UserNotificationEmailRollupItem());
    jest
      .spyOn(
        UserNotificationEmailRollupSettingService,
        "isRollupEnabledForUser",
      )
      .mockResolvedValue(true);

    sendMail = jest
      .spyOn(MailService, "sendMail")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    { name: "sent immediately", forceImmediate: undefined },
    { name: "forced past the rollup", forceImmediate: true },
  ])(
    "keeps a literal subject literal when the owner email is $name",
    async ({ forceImmediate }: { forceImmediate: boolean | undefined }) => {
      await UserNotificationSettingService.sendUserNotification(
        notificationData({ forceImmediate: forceImmediate }),
      );

      expect(sendMail).toHaveBeenCalledTimes(1);

      const sent: EmailMessage = sendMail.mock.calls[0]![0];
      expect(sent.isSubjectLiteral).toBe(true);
      expect(sent.subject).toBe(SUBJECT);
      expect(sent.toEmail.toString()).toBe(OWNER_EMAIL);
    },
  );
});
