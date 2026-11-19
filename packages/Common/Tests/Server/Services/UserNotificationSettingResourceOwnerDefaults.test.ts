import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import MailService from "../../../Server/Services/MailService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import CountBy from "../../../Server/Types/Database/CountBy";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import logger from "../../../Server/Utils/Logger";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../Types/SMS/SMS";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * BEING MADE AN OWNER OF A SERVICE, INFRASTRUCTURE, A DASHBOARD, A
 * WORKFLOW, A RUNBOOK OR AN ON-CALL RECORD (#9700).
 *
 * The owner-added jobs of these records (Workers ResourceOwnersAdded) send
 * through the person's setting for each event, and sendUserNotification
 * sends nothing without one. So a new member gets all seven by email when
 * they join (addDefaultNotificationSettingsForUser), and a member who
 * joined before the events existed gets each the first time a job tells
 * them (ensureSettingExistsForUser, which the jobs call before they send).
 * A setting that is there - switched off, say - is never written again, and
 * a person who switched an event off is sent nothing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const RESOURCE_OWNER_EVENTS: Array<NotificationSettingEventType> = [
  NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  NotificationSettingEventType.SEND_DASHBOARD_OWNER_ADDED_NOTIFICATION,
  NotificationSettingEventType.SEND_WORKFLOW_OWNER_ADDED_NOTIFICATION,
  NotificationSettingEventType.SEND_RUNBOOK_OWNER_ADDED_NOTIFICATION,
  NotificationSettingEventType.SEND_ON_CALL_POLICY_OWNER_ADDED_NOTIFICATION,
  NotificationSettingEventType.SEND_ON_CALL_SCHEDULE_OWNER_ADDED_NOTIFICATION,
  NotificationSettingEventType.SEND_INCOMING_CALL_POLICY_OWNER_ADDED_NOTIFICATION,
];

describe("the resource owner settings' defaults", () => {
  let store: Map<string, UserNotificationSetting>;

  beforeEach(() => {
    store = new Map<string, UserNotificationSetting>();

    jest
      .spyOn(UserNotificationSettingService, "countBy")
      .mockImplementation((async (
        countBy: CountBy<UserNotificationSetting>,
      ) => {
        return new PositiveNumber(
          store.has(String(countBy.query["eventType"])) ? 1 : 0,
        );
      }) as never);

    jest
      .spyOn(UserNotificationSettingService, "create")
      .mockImplementation((async (
        createBy: CreateBy<UserNotificationSetting>,
      ) => {
        expect(createBy.props).toEqual({ isRoot: true });
        store.set(String(createBy.data.eventType), createBy.data);
        return createBy.data;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(RESOURCE_OWNER_EVENTS)(
    "a new member starts with %s on, by email alone",
    async (eventType: NotificationSettingEventType) => {
      await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
        USER_ID,
        PROJECT_ID,
      );

      const row: UserNotificationSetting | undefined = store.get(eventType);

      expect(row).toBeDefined();
      expect(row!.alertByEmail).toBe(true);
      expect(row!.alertByPush).toBeFalsy();
      expect(row!.alertBySMS).toBeFalsy();
      expect(row!.alertByCall).toBeFalsy();
      expect(row!.alertByWhatsApp).toBeFalsy();
      expect(row!.userId?.toString()).toBe(USER_ID.toString());
      expect(row!.projectId?.toString()).toBe(PROJECT_ID.toString());
    },
  );

  test("addResourceOwnerNotificationSettings seeds exactly the seven, each once", async () => {
    await UserNotificationSettingService.addResourceOwnerNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );
    await UserNotificationSettingService.addResourceOwnerNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );

    expect([...store.keys()].sort()).toEqual([...RESOURCE_OWNER_EVENTS].sort());
    expect(UserNotificationSettingService.create).toHaveBeenCalledTimes(7);
  });

  test.each(RESOURCE_OWNER_EVENTS)(
    "%s is seeded once, and never again over one the person switched off",
    async (eventType: NotificationSettingEventType) => {
      await UserNotificationSettingService.ensureSettingExistsForUser({
        userId: USER_ID,
        projectId: PROJECT_ID,
        eventType: eventType,
      });

      // The person switches email off.
      store.get(eventType)!.alertByEmail = false;

      await UserNotificationSettingService.addResourceOwnerNotificationSettings(
        USER_ID,
        PROJECT_ID,
      );
      await UserNotificationSettingService.ensureSettingExistsForUser({
        userId: USER_ID,
        projectId: PROJECT_ID,
        eventType: eventType,
      });

      expect(
        (UserNotificationSettingService.create as jest.Mock).mock.calls.filter(
          (call: Array<unknown>): boolean => {
            return (
              (call[0] as CreateBy<UserNotificationSetting>).data.eventType ===
              eventType
            );
          },
        ),
      ).toHaveLength(1);
      expect(store.get(eventType)!.alertByEmail).toBe(false);
    },
  );
});

describe("a person who switched a resource owner event off", () => {
  beforeEach(() => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(RESOURCE_OWNER_EVENTS)(
    "is sent nothing for %s",
    async (eventType: NotificationSettingEventType) => {
      const setting: UserNotificationSetting = new UserNotificationSetting();
      setting.alertByEmail = false;
      setting.alertBySMS = false;
      setting.alertByCall = false;
      setting.alertByPush = false;
      setting.alertByWhatsApp = false;
      setting.alertByTelegram = false;
      setting.alertBySlack = false;
      setting.alertByMicrosoftTeams = false;
      setting.alertByMattermost = false;
      setting.alertByWebhook = false;
      setting.alertByCustomChannel = false;

      const findSettings: jest.SpyInstance = jest
        .spyOn(UserNotificationSettingService, "findOneBy")
        .mockResolvedValue(setting as never) as unknown as jest.SpyInstance;
      const findEmails: jest.SpyInstance = jest
        .spyOn(UserEmailService, "findBy")
        .mockResolvedValue(
          [] as Array<UserEmail> as never,
        ) as unknown as jest.SpyInstance;
      const sendMail: jest.SpyInstance = jest
        .spyOn(MailService, "sendMail")
        .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
      const twilioConfig: jest.SpyInstance = jest
        .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
        .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;

      await UserNotificationSettingService.sendUserNotification({
        userId: USER_ID,
        projectId: PROJECT_ID,
        eventType: eventType,
        emailEnvelope: {
          subject: "You have been added as an owner of the host web-1",
          templateType: EmailTemplateType.ResourceOwnerAdded,
          vars: {},
          isSubjectLiteral: true,
        } as EmailEnvelope,
        smsMessage: {
          message: "You have been added as an owner of the host web-1.",
        } as SMSMessage,
        callRequestMessage: { data: [] } as unknown as CallRequestMessage,
        pushNotificationMessage: {} as PushNotificationMessage,
      });

      // Read through the person's own setting for this very event.
      expect(findSettings).toHaveBeenCalledTimes(1);
      expect(
        (findSettings.mock.calls[0]![0] as { query: { eventType: unknown } })
          .query.eventType,
      ).toBe(eventType);

      expect(findEmails).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
      expect(twilioConfig).not.toHaveBeenCalled();
    },
  );
});
