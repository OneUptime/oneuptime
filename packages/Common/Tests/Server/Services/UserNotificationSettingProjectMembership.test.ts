import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import MailService from "../../../Server/Services/MailService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import logger from "../../../Server/Utils/Logger";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../Types/SMS/SMS";
import { FindOperator } from "typeorm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * sendUserNotification - owner notifications, shift notices, reminders,
 * removal notices, every settings-based message - delivers only through the
 * person's setting row for the event, and reads that row only while the
 * person is a member of the project. The membership condition rides on that
 * read (ProjectMembership.userIdWhileMember), so the check costs no extra
 * query; somebody who has left reads as having nothing set up. The real SQL
 * runs in ProjectMembershipPostgres.test.ts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const EVENT_TYPE: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION;

type SendUserNotificationData = Parameters<
  typeof UserNotificationSettingService.sendUserNotification
>[0];

function notificationData(): SendUserNotificationData {
  return {
    userId: USER_ID,
    projectId: PROJECT_ID,
    eventType: EVENT_TYPE,
    emailEnvelope: {
      subject: "Incident created: Checkout is down",
      templateType: EmailTemplateType.BlankTemplate,
      vars: {},
    } as unknown as EmailEnvelope,
    smsMessage: { message: "Checkout is down" } as SMSMessage,
    callRequestMessage: {} as CallRequestMessage,
    pushNotificationMessage: {} as PushNotificationMessage,
  } as SendUserNotificationData;
}

describe("sendUserNotification reaches members of the project only", () => {
  let findSettings: SpyInstance<
    typeof UserNotificationSettingService.findOneBy
  >;
  let findEmails: SpyInstance<typeof UserEmailService.findBy>;
  let sendMail: SpyInstance<typeof MailService.sendMail>;
  let twilioConfig: SpyInstance<
    typeof ProjectCallSMSConfigService.getProjectDefaultTwilioConfig
  >;

  beforeEach(() => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    findSettings = jest.spyOn(UserNotificationSettingService, "findOneBy");
    findEmails = jest
      .spyOn(UserEmailService, "findBy")
      .mockResolvedValue([] as Array<UserEmail>);
    sendMail = jest
      .spyOn(MailService, "sendMail")
      .mockResolvedValue(undefined as never);
    twilioConfig = jest
      .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the setting read carries the membership condition for this person and this project", async () => {
    findSettings.mockResolvedValue(null);

    await UserNotificationSettingService.sendUserNotification(
      notificationData(),
    );

    expect(findSettings).toHaveBeenCalledTimes(1);

    const query: Record<string, unknown> = findSettings.mock.calls[0]![0]
      .query as Record<string, unknown>;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["eventType"]).toBe(EVENT_TYPE);

    const userCondition: FindOperator<unknown> = query[
      "userId"
    ] as FindOperator<unknown>;

    expect(userCondition).toBeInstanceOf(FindOperator);
    expect(userCondition.type).toBe("raw");
    expect(
      Object.values(userCondition.objectLiteralParameters || {}).sort(),
    ).toEqual([PROJECT_ID.toString(), USER_ID.toString()].sort());

    const sql: string = (userCondition.getSql as (alias: string) => string)(
      "setting.userId",
    );

    expect(sql).toContain(`"projectMembership"."hasAcceptedInvitation" = true`);
    expect(sql).toContain(`"projectMembership"."userId" = setting.userId`);
  });

  test("nobody's setting read back (not a member): nothing is looked up or sent", async () => {
    findSettings.mockResolvedValue(null);

    await UserNotificationSettingService.sendUserNotification(
      notificationData(),
    );

    expect(findEmails).not.toHaveBeenCalled();
    expect(twilioConfig).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("a member's setting read back: the channels it turns on are used", async () => {
    findSettings.mockResolvedValue({
      alertByEmail: true,
    } as unknown as UserNotificationSetting);

    await UserNotificationSettingService.sendUserNotification(
      notificationData(),
    );

    expect(findEmails).toHaveBeenCalledTimes(1);
  });

  test("the condition is the shared one, so every sender asks the same question", async () => {
    const userIdWhileMember: SpyInstance<
      typeof ProjectMembership.userIdWhileMember
    > = jest.spyOn(ProjectMembership, "userIdWhileMember");
    findSettings.mockResolvedValue(null);

    await UserNotificationSettingService.sendUserNotification(
      notificationData(),
    );

    expect(userIdWhileMember).toHaveBeenCalledTimes(1);
    expect(userIdWhileMember.mock.calls[0]![0]).toEqual({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });
  });
});
