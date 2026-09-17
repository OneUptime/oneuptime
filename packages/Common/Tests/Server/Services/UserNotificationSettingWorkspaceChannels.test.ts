import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserSlackService from "../../../Server/Services/UserSlackService";
import UserMicrosoftTeamsService from "../../../Server/Services/UserMicrosoftTeamsService";
import WorkspaceUserNotificationService from "../../../Server/Services/WorkspaceUserNotificationService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import MailService from "../../../Server/Services/MailService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserNotificationEmailRollupItemService from "../../../Server/Services/UserNotificationEmailRollupItemService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import logger from "../../../Server/Utils/Logger";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import UserSlack from "../../../Models/DatabaseModels/UserSlack";
import UserMicrosoftTeams from "../../../Models/DatabaseModels/UserMicrosoftTeams";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserNotificationEmailRollupItem from "../../../Models/DatabaseModels/UserNotificationEmailRollupItem";
import URL from "../../../Types/API/URL";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../Types/SMS/SMS";
import { WhatsAppMessagePayload } from "../../../Types/WhatsApp/WhatsAppMessage";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * sendUserNotification is the settings-based (non-on-call-rule) delivery path:
 * "incident created and I own it", "I go on-call", and the ~40 other
 * NotificationSettingEventType rows. Its callers were all written before the
 * workspace channels existed, so they hand over payloads for the older
 * channels only — which is why the Slack / Microsoft Teams block SYNTHESISES
 * its markdown from the email subject + SMS body, exactly the way the
 * Telegram fallback body works. Pinned here:
 *
 *   1. THE TOGGLES. alertBySlack / alertByMicrosoftTeams each gate their own
 *      channel and nothing else, and a settings row with both off sends no
 *      workspace message at all (including not looking the methods up).
 *
 *   2. THE ADDRESSES. Only VERIFIED method rows are read, each one gets its
 *      own send, and a row whose address column is empty is skipped.
 *
 *   3. THE BODY. `🔔 **{subject}**` + blank line + SMS body; subject-less
 *      notifications fall back to the generic headline; a notification with
 *      neither subject nor SMS body sends nothing rather than a blank DM.
 *
 *   4. ISOLATION. Sends are fire-and-forget: a rejected workspace send is
 *      logged and never rejects sendUserNotification.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const SLACK_USER_ID: string = "U0123ABCD";
const SECOND_SLACK_USER_ID: string = "U0456EFGH";
const TEAMS_USER_ID: string = "entra-object-id-1";

const EVENT_TYPE: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION;
const MONITOR_STATUS_CHANGE_EVENT: NotificationSettingEventType =
  NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION;

type SendUserNotificationData = Parameters<
  typeof UserNotificationSettingService.sendUserNotification
>[0];

function settingsRow(
  overrides: Partial<UserNotificationSetting> = {},
): UserNotificationSetting {
  return {
    alertByEmail: false,
    alertBySMS: false,
    alertByCall: false,
    alertByPush: false,
    alertByWhatsApp: false,
    alertByTelegram: false,
    alertBySlack: false,
    alertByMicrosoftTeams: false,
    alertByWebhook: false,
    ...overrides,
  } as unknown as UserNotificationSetting;
}

function notificationData(
  overrides: Partial<SendUserNotificationData> = {},
): SendUserNotificationData {
  const emailEnvelope: EmailEnvelope = {
    subject: "Incident created: Checkout is down",
    templateType: EmailTemplateType.BlankTemplate,
    vars: {},
  } as unknown as EmailEnvelope;

  const smsMessage: SMSMessage = {
    message:
      "OneUptime: New incident created: Checkout is down. Please acknowledge.",
  } as SMSMessage;

  return {
    userId: USER_ID,
    projectId: PROJECT_ID,
    eventType: EVENT_TYPE,
    emailEnvelope: emailEnvelope,
    smsMessage: smsMessage,
    callRequestMessage: {} as CallRequestMessage,
    pushNotificationMessage: {} as PushNotificationMessage,
    whatsAppMessage: {} as WhatsAppMessagePayload,
    incidentId: INCIDENT_ID,
    ...overrides,
  } as SendUserNotificationData;
}

describe("UserNotificationSettingService.sendUserNotification - workspace channels", () => {
  let findSettings: jest.SpyInstance;
  let findSlacks: jest.SpyInstance;
  let findTeams: jest.SpyInstance;
  let findEmails: jest.SpyInstance;
  let sendMail: jest.SpyInstance;
  let sendDm: jest.SpyInstance;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    loggerError = jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });

    findSettings = jest
      .spyOn(UserNotificationSettingService, "findOneBy")
      .mockResolvedValue(settingsRow({ alertBySlack: true }) as never);

    jest
      .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
      .mockResolvedValue(undefined as never);

    findEmails = jest.spyOn(UserEmailService, "findBy").mockResolvedValue([
      {
        email: "user@example.com",
      } as unknown as UserEmail,
    ] as never);

    sendMail = jest
      .spyOn(MailService, "sendMail")
      .mockResolvedValue(undefined as never);

    /*
     * The email branch now runs through EmailRollupWriter, which counts this
     * address's recent owner emails and writes a ledger row before sending.
     * Both are stubbed here on purpose rather than left unmocked: an unmocked
     * countBy rejects with no database, the writer's fail-open catch swallows
     * that, and every email assertion in this suite would then be exercising
     * the failure path. "Below the burst threshold nothing changed" has to be
     * pinned deliberately, not by accident.
     */
    jest
      .spyOn(UserNotificationEmailRollupItemService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    jest
      .spyOn(UserNotificationEmailRollupItemService, "create")
      .mockResolvedValue(new UserNotificationEmailRollupItem() as never);

    findSlacks = jest.spyOn(UserSlackService, "findBy").mockResolvedValue([
      {
        id: new ObjectID("44444444-4444-4444-8444-444444444444"),
        slackUserId: SLACK_USER_ID,
      } as unknown as UserSlack,
    ] as never);

    findTeams = jest
      .spyOn(UserMicrosoftTeamsService, "findBy")
      .mockResolvedValue([
        {
          id: new ObjectID("55555555-5555-4555-8555-555555555555"),
          microsoftTeamsUserId: TEAMS_USER_ID,
        } as unknown as UserMicrosoftTeams,
      ] as never);

    sendDm = jest
      .spyOn(WorkspaceUserNotificationService, "sendDirectMessageToUser")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function flushMicrotasks(): Promise<void> {
    return Promise.resolve()
      .then((): Promise<void> => {
        return Promise.resolve();
      })
      .then((): Promise<void> => {
        return Promise.resolve();
      });
  }

  interface CapturedSendArg {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    workspaceUserId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
    userId: ObjectID;
    incidentId?: ObjectID;
    userOnCallLogTimelineId?: ObjectID;
  }

  function sendArgs(): Array<CapturedSendArg> {
    return sendDm.mock.calls.map((call: Array<unknown>) => {
      return call[0] as CapturedSendArg;
    });
  }

  /*
   * ----------------------------------------------------------------------- *
   * (A) The toggles.
   * -----------------------------------------------------------------------
   */

  describe("the per-channel toggles", () => {
    test("alertBySlack on sends to Slack and never reads the Teams methods", async () => {
      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      expect(sendDm).toHaveBeenCalledTimes(1);
      expect(sendArgs()[0]?.workspaceType).toBe(WorkspaceType.Slack);
      expect(sendArgs()[0]?.workspaceUserId).toBe(SLACK_USER_ID);
      expect(findTeams).not.toHaveBeenCalled();
    });

    test("alertByMicrosoftTeams on sends to Teams and never reads the Slack methods", async () => {
      findSettings.mockResolvedValue(
        settingsRow({ alertByMicrosoftTeams: true }) as never,
      );

      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      expect(sendDm).toHaveBeenCalledTimes(1);
      expect(sendArgs()[0]?.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
      expect(sendArgs()[0]?.workspaceUserId).toBe(TEAMS_USER_ID);
      expect(findSlacks).not.toHaveBeenCalled();
    });

    test("both toggles on sends one message per channel", async () => {
      findSettings.mockResolvedValue(
        settingsRow({
          alertBySlack: true,
          alertByMicrosoftTeams: true,
        }) as never,
      );

      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      expect(sendDm).toHaveBeenCalledTimes(2);
      const workspaceTypes: Array<WorkspaceType> = sendArgs().map(
        (arg: CapturedSendArg) => {
          return arg.workspaceType;
        },
      );
      expect(workspaceTypes).toContain(WorkspaceType.Slack);
      expect(workspaceTypes).toContain(WorkspaceType.MicrosoftTeams);
    });

    test("both toggles off sends nothing and does not even look the methods up", async () => {
      findSettings.mockResolvedValue(settingsRow() as never);

      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      expect(sendDm).not.toHaveBeenCalled();
      expect(findSlacks).not.toHaveBeenCalled();
      expect(findTeams).not.toHaveBeenCalled();
    });

    test("no monitor status-change setting sends nothing on any channel", async () => {
      findSettings.mockResolvedValue(null as never);

      await UserNotificationSettingService.sendUserNotification(
        notificationData({ eventType: MONITOR_STATUS_CHANGE_EVENT }),
      );

      expect(findEmails).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
      expect(
        ProjectCallSMSConfigService.getProjectDefaultTwilioConfig,
      ).not.toHaveBeenCalled();
      expect(findSlacks).not.toHaveBeenCalled();
      expect(findTeams).not.toHaveBeenCalled();
      expect(sendDm).not.toHaveBeenCalled();
    });

    test("an explicit monitor status-change email opt-in still delivers", async () => {
      findSettings.mockResolvedValue(
        settingsRow({ alertByEmail: true }) as never,
      );

      await UserNotificationSettingService.sendUserNotification(
        notificationData({ eventType: MONITOR_STATUS_CHANGE_EVENT }),
      );

      expect(findEmails).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
        toEmail: "user@example.com",
      });
      expect(sendDm).not.toHaveBeenCalled();
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (B) The address reads.
   * -----------------------------------------------------------------------
   */

  describe("the address reads", () => {
    test("only VERIFIED Slack rows are read, scoped to this user and project", async () => {
      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      const arg: {
        query: { userId: ObjectID; projectId: ObjectID; isVerified: boolean };
        props: { isRoot: boolean };
      } = findSlacks.mock.calls[0][0] as {
        query: { userId: ObjectID; projectId: ObjectID; isVerified: boolean };
        props: { isRoot: boolean };
      };
      expect(arg.query.userId.toString()).toBe(USER_ID.toString());
      expect(arg.query.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(arg.query.isVerified).toBe(true);
      expect(arg.props.isRoot).toBe(true);
    });

    test("every linked account gets its own send", async () => {
      findSlacks.mockResolvedValue([
        { slackUserId: SLACK_USER_ID } as unknown as UserSlack,
        { slackUserId: SECOND_SLACK_USER_ID } as unknown as UserSlack,
      ] as never);

      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      expect(sendDm).toHaveBeenCalledTimes(2);
      const targets: Array<string> = sendArgs().map((arg: CapturedSendArg) => {
        return arg.workspaceUserId;
      });
      expect(targets).toContain(SLACK_USER_ID);
      expect(targets).toContain(SECOND_SLACK_USER_ID);
    });

    test("a row whose address column is empty is skipped rather than sent to nobody", async () => {
      findSlacks.mockResolvedValue([
        { slackUserId: "" } as unknown as UserSlack,
        { slackUserId: SLACK_USER_ID } as unknown as UserSlack,
      ] as never);

      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      expect(sendDm).toHaveBeenCalledTimes(1);
      expect(sendArgs()[0]?.workspaceUserId).toBe(SLACK_USER_ID);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (C) The synthesised body.
   * -----------------------------------------------------------------------
   */

  describe("the synthesised markdown body", () => {
    function firstBlockText(): string {
      const block: WorkspaceMessageBlock | undefined =
        sendArgs()[0]?.messageBlocks[0];
      return (block as WorkspacePayloadMarkdown).text;
    }

    test("is built from the email subject (bold, belled) plus the SMS body", async () => {
      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      const text: string = firstBlockText();
      expect(text).toContain("🔔 **Incident created: Checkout is down**");
      expect(text).toContain(
        "OneUptime: New incident created: Checkout is down. Please acknowledge.",
      );
    });

    test("a subject-less notification falls back to the generic headline", async () => {
      await UserNotificationSettingService.sendUserNotification(
        notificationData({
          emailEnvelope: {
            subject: "",
            templateType: EmailTemplateType.BlankTemplate,
            vars: {},
          } as unknown as EmailEnvelope,
        }),
      );

      expect(firstBlockText()).toContain("🔔 **OneUptime notification**");
    });

    test("neither subject nor SMS body sends nothing rather than a blank DM", async () => {
      await UserNotificationSettingService.sendUserNotification(
        notificationData({
          emailEnvelope: {
            subject: "",
            templateType: EmailTemplateType.BlankTemplate,
            vars: {},
          } as unknown as EmailEnvelope,
          smsMessage: { message: "" } as SMSMessage,
        }),
      );

      expect(sendDm).not.toHaveBeenCalled();
    });

    test("the context ids ride along so the workspace log can attribute the message", async () => {
      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      expect(sendArgs()[0]?.incidentId?.toString()).toBe(
        INCIDENT_ID.toString(),
      );
      expect(sendArgs()[0]?.userId.toString()).toBe(USER_ID.toString());
      // The settings path has no on-call timeline row to flip.
      expect(sendArgs()[0]?.userOnCallLogTimelineId).toBeUndefined();
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (D) The email hand-off preserves content and correlation ids.
   * -----------------------------------------------------------------------
   */

  describe("the email hand-off", () => {
    /*
     * Owner emails now pass through EmailRollupWriter on their way to
     * MailService. Below the burst threshold the email keeps its content and
     * gains a direct preferences link. The second argument is the correlation-id
     * bag every downstream log line joins on, so a field silently dropped in the hand-off would
     * detach incident emails from their incident with nothing failing.
     */
    test("MailService receives the original content and correlation ids with a direct preferences link", async () => {
      findSettings.mockResolvedValue(
        settingsRow({ alertByEmail: true }) as never,
      );
      jest
        .spyOn(DatabaseConfig, "getDashboardUrl")
        .mockResolvedValue(
          URL.fromString("https://oneuptime.example.com/dashboard"),
        );

      const data: SendUserNotificationData = notificationData();
      await UserNotificationSettingService.sendUserNotification(data);

      expect(sendMail).toHaveBeenCalledTimes(1);

      expect(sendMail.mock.calls[0]?.[0]).toEqual({
        subject: "Incident created: Checkout is down",
        templateType: EmailTemplateType.BlankTemplate,
        vars: {
          notificationPreferencesUrl: `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/user-settings/notification-settings`,
        },
        toEmail: "user@example.com",
      });
      expect(data.emailEnvelope.vars).toEqual({});

      expect(sendMail.mock.calls[0]?.[1]).toEqual({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertId: undefined,
        alertEpisodeId: undefined,
        incidentEpisodeId: undefined,
        monitorId: undefined,
        scheduledMaintenanceId: undefined,
        statusPageId: undefined,
        statusPageAnnouncementId: undefined,
        userId: USER_ID,
        teamId: undefined,
        onCallPolicyId: undefined,
        onCallPolicyEscalationRuleId: undefined,
        onCallDutyPolicyExecutionLogTimelineId: undefined,
        onCallScheduleId: undefined,
      });

      /*
       * toEqual treats an explicitly-undefined property as absent, so the key
       * set is pinned separately - otherwise the hand-off could quietly stop
       * forwarding a field and this test would still pass.
       */
      const optionKeys: Array<string> = Object.keys(
        sendMail.mock.calls[0]?.[1] as Record<string, unknown>,
      ).sort();
      expect(optionKeys).toEqual(
        [
          "alertEpisodeId",
          "alertId",
          "incidentEpisodeId",
          "incidentId",
          "monitorId",
          "onCallDutyPolicyExecutionLogTimelineId",
          "onCallPolicyEscalationRuleId",
          "onCallPolicyId",
          "onCallScheduleId",
          "projectId",
          "scheduledMaintenanceId",
          "statusPageAnnouncementId",
          "statusPageId",
          "teamId",
          "userId",
        ].sort(),
      );
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (E) Failure isolation.
   * -----------------------------------------------------------------------
   */

  describe("failure isolation", () => {
    test("a rejected workspace send is logged and never rejects sendUserNotification", async () => {
      sendDm.mockRejectedValue(new Error("workspace unreachable") as never);

      await expect(
        UserNotificationSettingService.sendUserNotification(notificationData()),
      ).resolves.toBeUndefined();

      await flushMicrotasks();

      expect(loggerError).toHaveBeenCalled();
    });
  });
});
