import CallService from "../../../Server/Services/CallService";
import MailService from "../../../Server/Services/MailService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import SmsService from "../../../Server/Services/SmsService";
import TelegramService from "../../../Server/Services/TelegramService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserMicrosoftTeamsService from "../../../Server/Services/UserMicrosoftTeamsService";
import UserNotificationEmailRollupItemService from "../../../Server/Services/UserNotificationEmailRollupItemService";
import UserNotificationEmailRollupSettingService from "../../../Server/Services/UserNotificationEmailRollupSettingService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserSlackService from "../../../Server/Services/UserSlackService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import WebhookService from "../../../Server/Services/WebhookService";
import WhatsAppService from "../../../Server/Services/WhatsAppService";
import WorkspaceUserNotificationService from "../../../Server/Services/WorkspaceUserNotificationService";
import EmailRollupWriter, {
  SendOrRollupData,
} from "../../../Server/Utils/EmailRollup/EmailRollupWriter";
import { BURST_THRESHOLD } from "../../../Server/Utils/EmailRollup/EmailRollupConstants";
import logger from "../../../Server/Utils/Logger";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserMicrosoftTeams from "../../../Models/DatabaseModels/UserMicrosoftTeams";
import UserNotificationEmailRollupItem from "../../../Models/DatabaseModels/UserNotificationEmailRollupItem";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import UserSlack from "../../../Models/DatabaseModels/UserSlack";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../Types/JSON";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../Types/SMS/SMS";
import TelegramMessage from "../../../Types/Telegram/TelegramMessage";
import { WhatsAppMessagePayload } from "../../../Types/WhatsApp/WhatsAppMessage";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import fs from "fs";
import path from "path";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import URL from "../../../Types/API/URL";

/*
 * sendUserNotification's email branch now runs through EmailRollupWriter
 * instead of calling MailService directly. That single line is the whole
 * feature, and it sits above eight other delivery channels. What breaks in
 * production if the behaviour pinned here regresses:
 *
 *   1. A DEFERRED EMAIL SILENCES THE OTHER CHANNELS. Holding an email back
 *      must hold back the EMAIL, and nothing else. SMS, call, push, WhatsApp,
 *      Telegram, Slack, Microsoft Teams and webhook are separate opt-ins that
 *      a user may be relying on precisely because email is noisy; if a
 *      deferral suppressed them the feature would be dropping notifications,
 *      not batching them.
 *
 *   2. THE ENVELOPE GETS MUTATED. The Telegram fallback body and the Slack /
 *      Microsoft Teams markdown are both synthesised from
 *      data.emailEnvelope.subject AFTER the email branch has run. A writer
 *      that reused the envelope object to stash a truncated or brace-stripped
 *      subject would silently rewrite three other channels' messages.
 *
 *   3. ONE ADDRESS TAKES DOWN THE REST. The call the writer replaced was
 *      fire-and-forget, so a failure for one verified address could not affect
 *      another - or any later channel. The replacement is awaited, which
 *      re-opens that door unless the loop keeps it shut.
 *
 *   4. THE ENQUEUE IS NOT AWAITED. If sendUserNotification could return before
 *      the ledger row exists, a worker that exits after its last notification
 *      loses the row: the burst counter under-counts and a deferred email is
 *      never queued for anyone to flush.
 *
 *   5. forceImmediate DOES NOT REACH THE WRITER. It is the only way an SLA
 *      breach - which borrows the incident-created event type - can say it is
 *      urgent. Dropped in the hand-off, it fails silently and only under load.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const SUBJECT: string = "Incident created: Checkout is down {{notATemplate}}";
const SMS_BODY: string = "OneUptime: New incident created: Checkout is down.";

const EVENT_TYPE: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION;
const ON_CALL_ROSTER_EVENT: NotificationSettingEventType =
  NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER;

type SendUserNotificationData = Parameters<
  typeof UserNotificationSettingService.sendUserNotification
>[0];

function allChannelsOn(): UserNotificationSetting {
  return {
    alertByEmail: true,
    alertBySMS: true,
    alertByCall: true,
    alertByPush: true,
    alertByWhatsApp: true,
    alertByTelegram: true,
    alertBySlack: true,
    alertByMicrosoftTeams: true,
    alertByWebhook: true,
  } as unknown as UserNotificationSetting;
}

function buildEnvelope(): EmailEnvelope {
  return {
    subject: SUBJECT,
    templateType: EmailTemplateType.BlankTemplate,
    vars: {
      incidentViewLink: "https://oneuptime.com/dashboard/incidents/1",
    },
  } as unknown as EmailEnvelope;
}

function notificationData(
  overrides: Partial<SendUserNotificationData> = {},
): SendUserNotificationData {
  return {
    userId: USER_ID,
    projectId: PROJECT_ID,
    eventType: EVENT_TYPE,
    emailEnvelope: buildEnvelope(),
    smsMessage: { message: SMS_BODY } as SMSMessage,
    callRequestMessage: {} as CallRequestMessage,
    pushNotificationMessage: {} as PushNotificationMessage,
    whatsAppMessage: {} as WhatsAppMessagePayload,
    incidentId: INCIDENT_ID,
    ...overrides,
  } as SendUserNotificationData;
}

/*
 * The SLA-breach job lives in App and Common cannot import it, so the one
 * assertion that can be made about it from here is made against its source
 * text. Section (F) explains why that is worth doing at all.
 */
const COMMON_DIR: string = path.resolve(__dirname, "../../..");
const APP_DIR: string = path.resolve(COMMON_DIR, "../App");
const SLA_BREACH_JOB_PATH: string = path.join(
  APP_DIR,
  "FeatureSet",
  "Workers",
  "Jobs",
  "IncidentSla",
  "CheckSlaBreaches.ts",
);

type SkipStringLiteralFunction = (source: string, start: number) => number;

/*
 * The index just past the string literal that starts at `start`. Escapes are
 * honoured, so a quote inside a string cannot end it early.
 */
const skipStringLiteral: SkipStringLiteralFunction = (
  source: string,
  start: number,
): number => {
  const quote: string = source.charAt(start);
  let index: number = start + 1;

  while (index < source.length) {
    const character: string = source.charAt(index);

    if (character === "\\") {
      index = index + 2;
      continue;
    }

    if (character === quote) {
      return index + 1;
    }

    index = index + 1;
  }

  return source.length;
};

type ExtractCallArgumentsFunction = (
  source: string,
  callee: string,
) => string | null;

/*
 * The text between the parentheses of the first call to `callee`, with
 * comments and string bodies blanked out. Null when there is no such call,
 * which is what makes "somebody renamed the call away" a failure rather than
 * a vacuous pass.
 *
 * A character scan rather than a regex, on purpose. The argument object spans
 * twenty lines and the whole point of the assertion is that it survives
 * reformatting, so nothing here may depend on where the newlines fall.
 * Blanking comments is what stops the prose ABOVE a property from satisfying
 * an assertion about the property; skipping string bodies is what stops a
 * parenthesis inside a message from ending the call early.
 */
const extractCallArguments: ExtractCallArgumentsFunction = (
  source: string,
  callee: string,
): string | null => {
  const calleeIndex: number = source.indexOf(callee);

  if (calleeIndex < 0) {
    return null;
  }

  const openIndex: number = source.indexOf("(", calleeIndex + callee.length);

  if (openIndex < 0) {
    return null;
  }

  const collected: Array<string> = [];
  let depth: number = 0;
  let index: number = openIndex;

  while (index < source.length) {
    const character: string = source.charAt(index);
    const nextCharacter: string = source.charAt(index + 1);

    if (character === "/" && nextCharacter === "*") {
      const end: number = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      collected.push(" ");
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      const end: number = source.indexOf("\n", index + 2);
      index = end < 0 ? source.length : end;
      collected.push(" ");
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      index = skipStringLiteral(source, index);
      collected.push('""');
      continue;
    }

    if (character === "(") {
      depth = depth + 1;
      index = index + 1;

      if (depth > 1) {
        collected.push(character);
      }

      continue;
    }

    if (character === ")") {
      depth = depth - 1;
      index = index + 1;

      if (depth === 0) {
        return collected.join("");
      }

      collected.push(character);
      continue;
    }

    collected.push(character);
    index = index + 1;
  }

  return null;
};

describe("UserNotificationSettingService.sendUserNotification - rollup routing", () => {
  let findSettings: jest.SpyInstance;
  let findEmails: jest.SpyInstance;
  let sendMail: jest.SpyInstance;
  let countRecent: jest.SpyInstance;
  let createItem: jest.SpyInstance;
  let sendSms: jest.SpyInstance;
  let makeCall: jest.SpyInstance;
  let sendPush: jest.SpyInstance;
  let sendWhatsApp: jest.SpyInstance;
  let sendTelegram: jest.SpyInstance;
  let sendDm: jest.SpyInstance;
  let sendWebhook: jest.SpyInstance;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    loggerError = jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });

    findSettings = jest
      .spyOn(UserNotificationSettingService, "findOneBy")
      .mockResolvedValue(allChannelsOn() as never);

    jest
      .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
      .mockResolvedValue(undefined as never);

    findEmails = jest.spyOn(UserEmailService, "findBy").mockResolvedValue([
      {
        email: "owner@example.com",
      } as unknown as UserEmail,
    ] as never);

    sendMail = jest
      .spyOn(MailService, "sendMail")
      .mockResolvedValue(undefined as never);

    countRecent = jest
      .spyOn(UserNotificationEmailRollupItemService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    createItem = jest
      .spyOn(UserNotificationEmailRollupItemService, "create")
      .mockResolvedValue(new UserNotificationEmailRollupItem() as never);

    /*
     * The absent-row answer, which is what almost every real user has. Without
     * it the writer reaches the real preference read, that read reaches a
     * Postgres this suite does not have, and the throw lands in the writer's
     * fail-open catch - so every deferral assertion below would quietly become
     * an assertion about what an unreachable database does, and pass or fail
     * for the wrong reason. The escape hatch's own behaviour is pinned in
     * Tests/Server/Utils/EmailRollup/EmailRollupWriter.test.ts; here it is
     * held constant so the routing between channels is what is being measured.
     */
    jest
      .spyOn(
        UserNotificationEmailRollupSettingService,
        "isRollupEnabledForUser",
      )
      .mockResolvedValue(true as never);

    jest.spyOn(UserSmsService, "findBy").mockResolvedValue([
      {
        phone: "+15550000001",
      } as unknown as UserSMS,
    ] as never);
    sendSms = jest
      .spyOn(SmsService, "sendSms")
      .mockResolvedValue(undefined as never);

    jest.spyOn(UserCallService, "findBy").mockResolvedValue([
      {
        phone: "+15550000002",
      } as unknown as UserCall,
    ] as never);
    makeCall = jest
      .spyOn(CallService, "makeCall")
      .mockResolvedValue(undefined as never);

    sendPush = jest
      .spyOn(PushNotificationService, "sendPushNotificationToUser")
      .mockResolvedValue(undefined as never);

    jest.spyOn(UserWhatsAppService, "findBy").mockResolvedValue([
      {
        phone: "+15550000003",
      } as unknown as UserWhatsApp,
    ] as never);
    sendWhatsApp = jest
      .spyOn(WhatsAppService, "sendWhatsAppMessage")
      .mockResolvedValue(undefined as never);

    jest.spyOn(UserTelegramService, "findBy").mockResolvedValue([
      {
        telegramChatId: "telegram-chat-1",
      } as unknown as UserTelegram,
    ] as never);
    sendTelegram = jest
      .spyOn(TelegramService, "sendTelegramMessage")
      .mockResolvedValue(undefined as never);

    jest.spyOn(UserSlackService, "findBy").mockResolvedValue([
      {
        slackUserId: "U0123ABCD",
      } as unknown as UserSlack,
    ] as never);
    jest.spyOn(UserMicrosoftTeamsService, "findBy").mockResolvedValue([
      {
        microsoftTeamsUserId: "entra-object-id-1",
      } as unknown as UserMicrosoftTeams,
    ] as never);
    sendDm = jest
      .spyOn(WorkspaceUserNotificationService, "sendDirectMessageToUser")
      .mockResolvedValue(undefined as never);

    jest.spyOn(UserWebhookService, "findBy").mockResolvedValue([
      {
        webhookUrl: "https://example.com/hook",
        name: "hook",
      } as unknown as UserWebhook,
    ] as never);
    sendWebhook = jest
      .spyOn(WebhookService, "sendWebhook")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * A macrotask, not a microtask hop: the awaited chain inside
   * sendUserNotification is several promises deep, and a fixed number of
   * `await Promise.resolve()` hops would silently start passing (or failing)
   * whenever that depth changes.
   */
  function flushPendingWork(): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }

  function deferEveryEmail(): void {
    countRecent.mockResolvedValue(
      new PositiveNumber(BURST_THRESHOLD + 1) as never,
    );
  }

  /*
   * ----------------------------------------------------------------------- *
   * (A) A deferred email leaves every other channel alone.
   * -----------------------------------------------------------------------
   */

  describe("when the writer defers the email", () => {
    test("no mail is sent but a pending ledger row is written", async () => {
      deferEveryEmail();

      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      expect(findEmails).toHaveBeenCalledTimes(1);
      expect(sendMail).not.toHaveBeenCalled();
      expect(createItem).toHaveBeenCalledTimes(1);
    });

    test("every other channel still fires", async () => {
      deferEveryEmail();

      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      expect(sendSms).toHaveBeenCalledTimes(1);
      expect(makeCall).toHaveBeenCalledTimes(1);
      expect(sendPush).toHaveBeenCalledTimes(1);
      expect(sendWhatsApp).toHaveBeenCalledTimes(1);
      expect(sendTelegram).toHaveBeenCalledTimes(1);
      // One Slack DM and one Microsoft Teams DM.
      expect(sendDm).toHaveBeenCalledTimes(2);
      expect(sendWebhook).toHaveBeenCalledTimes(1);
    });

    test("the channels that synthesise from the email subject use the ORIGINAL subject", async () => {
      deferEveryEmail();

      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      const telegram: TelegramMessage = sendTelegram.mock
        .calls[0]?.[0] as TelegramMessage;
      expect(telegram.body).toContain(SUBJECT);

      const workspaceBlocks: Array<WorkspaceMessageBlock> = (
        sendDm.mock.calls[0]?.[0] as {
          messageBlocks: Array<WorkspaceMessageBlock>;
        }
      ).messageBlocks;
      expect((workspaceBlocks[0] as WorkspacePayloadMarkdown).text).toContain(
        SUBJECT,
      );

      const webhookPayload: JSONObject = (
        sendWebhook.mock.calls[0]?.[0] as { payload: JSONObject }
      ).payload;
      expect(webhookPayload["subject"]).toBe(SUBJECT);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (B) The envelope is never mutated.
   * -----------------------------------------------------------------------
   */

  describe("the email envelope", () => {
    test.each([
      "11111111-1111-4111-8111-111111111111",
      "44444444-4444-4444-8444-444444444444",
    ])(
      "links directly to the sending project's preferences: %s",
      async (projectId: string) => {
        const dashboardUrl: URL = URL.fromString(
          "https://self-hosted.example.com/dashboard",
        );
        jest
          .spyOn(DatabaseConfig, "getDashboardUrl")
          .mockResolvedValue(dashboardUrl);
        const data: SendUserNotificationData = notificationData({
          projectId: new ObjectID(projectId),
        });
        Object.freeze(data.emailEnvelope.vars);
        Object.freeze(data.emailEnvelope);

        await UserNotificationSettingService.sendUserNotification(data);

        const sent: EmailEnvelope = sendMail.mock
          .calls[0]?.[0] as EmailEnvelope;
        expect(sent.vars["notificationPreferencesUrl"]).toBe(
          `https://self-hosted.example.com/dashboard/${projectId}/user-settings/notification-settings`,
        );
        expect(sent.subject).toBe(data.emailEnvelope.subject);
        expect(sent.templateType).toBe(data.emailEnvelope.templateType);
        expect(sent.vars["incidentViewLink"]).toBe(
          data.emailEnvelope.vars["incidentViewLink"],
        );
        expect(data.emailEnvelope.vars).not.toHaveProperty(
          "notificationPreferencesUrl",
        );
        expect(dashboardUrl.toString()).toBe(
          "https://self-hosted.example.com/dashboard",
        );
        expect(JSON.stringify(sendWebhook.mock.calls)).not.toContain(
          "notificationPreferencesUrl",
        );
        expect(JSON.stringify(sendDm.mock.calls)).not.toContain(
          "notificationPreferencesUrl",
        );
      },
    );

    test("replaces a stale preferences URL without modifying the producer's variables", async () => {
      const data: SendUserNotificationData = notificationData();
      data.emailEnvelope.vars["notificationPreferencesUrl"] =
        "https://old.example.com/other-project";
      jest
        .spyOn(DatabaseConfig, "getDashboardUrl")
        .mockResolvedValue(
          URL.fromString("https://current.example.com/dashboard"),
        );

      await UserNotificationSettingService.sendUserNotification(data);

      const sent: EmailEnvelope = sendMail.mock.calls[0]?.[0] as EmailEnvelope;
      expect(sent.vars["notificationPreferencesUrl"]).toBe(
        `https://current.example.com/dashboard/${PROJECT_ID.toString()}/user-settings/notification-settings`,
      );
      expect(data.emailEnvelope.vars["notificationPreferencesUrl"]).toBe(
        "https://old.example.com/other-project",
      );
    });

    test("does not mistake the preferences URL for the resource link in a rollup", async () => {
      deferEveryEmail();
      const data: SendUserNotificationData = notificationData();
      data.emailEnvelope.vars = {};

      await UserNotificationSettingService.sendUserNotification(data);

      const item: UserNotificationEmailRollupItem = (
        createItem.mock.calls[0]?.[0] as {
          data: UserNotificationEmailRollupItem;
        }
      ).data;
      expect(item.viewLink).toBeUndefined();
      expect(sendMail).not.toHaveBeenCalled();
    });

    test("keeps every delivery channel working if the preferences URL cannot be built", async () => {
      jest
        .spyOn(DatabaseConfig, "getDashboardUrl")
        .mockRejectedValue(new Error("URL unavailable"));

      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      const sent: EmailEnvelope = sendMail.mock.calls[0]?.[0] as EmailEnvelope;
      expect(sent.vars).not.toHaveProperty("notificationPreferencesUrl");
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendSms).toHaveBeenCalledTimes(1);
      expect(makeCall).toHaveBeenCalledTimes(1);
      expect(sendPush).toHaveBeenCalledTimes(1);
      expect(sendTelegram).toHaveBeenCalledTimes(1);
      expect(sendWhatsApp).toHaveBeenCalledTimes(1);
      expect(sendDm).toHaveBeenCalledTimes(2);
      expect(sendWebhook).toHaveBeenCalledTimes(1);
      expect(loggerError).toHaveBeenCalledTimes(1);
    });

    test("does not build email preferences when email is disabled", async () => {
      findSettings.mockResolvedValue({
        ...allChannelsOn(),
        alertByEmail: false,
      } as never);
      const getDashboardUrl: jest.SpyInstance = jest.spyOn(
        DatabaseConfig,
        "getDashboardUrl",
      );

      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      expect(getDashboardUrl).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
      expect(sendSms).toHaveBeenCalledTimes(1);
    });

    test("does not build email preferences without a verified email address", async () => {
      findEmails.mockResolvedValue([] as never);
      const getDashboardUrl: jest.SpyInstance = jest.spyOn(
        DatabaseConfig,
        "getDashboardUrl",
      );

      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      expect(getDashboardUrl).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
      expect(sendSms).toHaveBeenCalledTimes(1);
    });

    test("is deep-equal before and after the call, whether the email is deferred", async () => {
      deferEveryEmail();

      const data: SendUserNotificationData = notificationData();
      const snapshot: string = JSON.stringify(data.emailEnvelope);

      await UserNotificationSettingService.sendUserNotification(data);

      expect(JSON.stringify(data.emailEnvelope)).toBe(snapshot);
      expect(data.emailEnvelope.subject).toBe(SUBJECT);
    });

    test("is deep-equal before and after the call when the email is sent immediately", async () => {
      /*
       * The immediate path is the one that stores a brace-stripped, truncated
       * copy of the subject, so it is the one where a careless writer would be
       * tempted to edit the envelope in place.
       */
      const data: SendUserNotificationData = notificationData();
      const snapshot: string = JSON.stringify(data.emailEnvelope);

      await UserNotificationSettingService.sendUserNotification(data);

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(data.emailEnvelope)).toBe(snapshot);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (C) Per-address fan-out and isolation.
   * -----------------------------------------------------------------------
   */

  describe("per-address fan-out", () => {
    function threeVerifiedAddresses(): void {
      findEmails.mockResolvedValue([
        { email: "first@example.com" } as unknown as UserEmail,
        { email: "second@example.com" } as unknown as UserEmail,
        { email: "third@example.com" } as unknown as UserEmail,
      ] as never);
    }

    test("each verified address gets its own hand-off to the writer", async () => {
      threeVerifiedAddresses();

      const sendOrRollup: jest.SpyInstance = jest
        .spyOn(EmailRollupWriter, "sendOrRollup")
        .mockResolvedValue(undefined as never);

      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      expect(sendOrRollup).toHaveBeenCalledTimes(3);

      const addresses: Array<string> = sendOrRollup.mock.calls.map(
        (call: Array<unknown>): string => {
          return (call[0] as SendOrRollupData).toEmail.toString();
        },
      );
      expect(addresses).toEqual([
        "first@example.com",
        "second@example.com",
        "third@example.com",
      ]);
    });

    test("a throw for the middle address costs neither the other two nor the other channels", async () => {
      threeVerifiedAddresses();

      const sendOrRollup: jest.SpyInstance = jest
        .spyOn(EmailRollupWriter, "sendOrRollup")
        .mockImplementation((data: SendOrRollupData): Promise<void> => {
          if (data.toEmail.toString() === "second@example.com") {
            return Promise.reject(new Error("writer exploded"));
          }
          return Promise.resolve();
        });

      await expect(
        UserNotificationSettingService.sendUserNotification(notificationData()),
      ).resolves.toBeUndefined();

      expect(sendOrRollup).toHaveBeenCalledTimes(3);
      expect(loggerError).toHaveBeenCalledTimes(1);

      // The eight non-email channels below the loop still ran.
      expect(sendSms).toHaveBeenCalledTimes(1);
      expect(makeCall).toHaveBeenCalledTimes(1);
      expect(sendPush).toHaveBeenCalledTimes(1);
      expect(sendWhatsApp).toHaveBeenCalledTimes(1);
      expect(sendTelegram).toHaveBeenCalledTimes(1);
      expect(sendDm).toHaveBeenCalledTimes(2);
      expect(sendWebhook).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (D) The enqueue is awaited.
   * -----------------------------------------------------------------------
   */

  describe("the enqueue", () => {
    test("sendUserNotification does not resolve before the ledger write settles", async () => {
      let releaseCreate: (row: UserNotificationEmailRollupItem) => void = (
        _row: UserNotificationEmailRollupItem,
      ): void => {
        return undefined;
      };

      const gate: Promise<UserNotificationEmailRollupItem> =
        new Promise<UserNotificationEmailRollupItem>(
          (resolve: (row: UserNotificationEmailRollupItem) => void): void => {
            releaseCreate = resolve;
          },
        );

      createItem.mockReturnValue(gate);

      let settled: boolean = false;
      const pending: Promise<void> =
        UserNotificationSettingService.sendUserNotification(
          notificationData(),
        ).then((): void => {
          settled = true;
        });

      await flushPendingWork();
      expect(createItem).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);

      releaseCreate(new UserNotificationEmailRollupItem());
      await pending;

      expect(settled).toBe(true);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (E) forceImmediate threads through, and the on-call bypass survives the
   *     round trip through the seam.
   * -----------------------------------------------------------------------
   */

  describe("forceImmediate and the on-call bypass", () => {
    test("forceImmediate reaches the writer when the caller sets it", async () => {
      const sendOrRollup: jest.SpyInstance = jest
        .spyOn(EmailRollupWriter, "sendOrRollup")
        .mockResolvedValue(undefined as never);

      await UserNotificationSettingService.sendUserNotification(
        notificationData({ forceImmediate: true }),
      );

      expect(
        (sendOrRollup.mock.calls[0]?.[0] as SendOrRollupData).forceImmediate,
      ).toBe(true);
    });

    test("the key is absent entirely when the caller does not set it", async () => {
      /*
       * Spread-conditional rather than `forceImmediate: data.forceImmediate`,
       * because exactOptionalPropertyTypes is on: an explicit undefined would
       * not compile against an optional property.
       */
      const sendOrRollup: jest.SpyInstance = jest
        .spyOn(EmailRollupWriter, "sendOrRollup")
        .mockResolvedValue(undefined as never);

      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      expect(
        "forceImmediate" in
          (sendOrRollup.mock.calls[0]?.[0] as SendOrRollupData),
      ).toBe(false);
    });

    test("forceImmediate sends immediately end to end, with no counting and no row", async () => {
      deferEveryEmail();

      await UserNotificationSettingService.sendUserNotification(
        notificationData({ forceImmediate: true }),
      );

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(countRecent).not.toHaveBeenCalled();
      expect(createItem).not.toHaveBeenCalled();
    });

    test("a never-rolled-up event type comes straight back out as an immediate send", async () => {
      /*
       * Driven through the real writer with the counter armed high, so this
       * fails if the eligibility check is ever moved below the count.
       */
      deferEveryEmail();
      findSettings.mockResolvedValue(allChannelsOn() as never);

      await UserNotificationSettingService.sendUserNotification(
        notificationData({ eventType: ON_CALL_ROSTER_EVENT }),
      );

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(countRecent).not.toHaveBeenCalled();
      expect(createItem).not.toHaveBeenCalled();
      expect(loggerError).not.toHaveBeenCalled();
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (F) The SLA-breach bypass - the only caller of forceImmediate there is.
   *
   * Every other "must never be delayed" case in this design is excluded
   * STRUCTURALLY: NEVER_ROLLED_UP_EVENT_TYPES is a property of the event type
   * itself, so no caller can forget it and no reviewer has to remember it.
   * The SLA-breach job is the one exception. It sends under
   * EmailTemplateType.IncidentOwnerResourceCreated and reuses
   * SEND_INCIDENT_CREATED_OWNER_NOTIFICATION, so its event type cannot say
   * "this deadline has already passed" - only the caller knows that, and it
   * says so with one property in a twenty-line object literal.
   *
   * A property like that gets deleted by accident: in a rebase, in a
   * find-and-replace, by a reformat that drops a line. Nothing downstream
   * notices. The mail still goes out - five minutes late, batched with the
   * incident chatter that caused the breach, and only for the projects noisy
   * enough to cross the threshold, which are exactly the projects whose SLA
   * breaches matter most. So it is pinned twice: as behaviour at the seam,
   * and as source text at the caller, because Common cannot import App.
   * -----------------------------------------------------------------------
   */

  describe("the SLA-breach bypass", () => {
    test("far past the burst threshold, forceImmediate is the only reason the mail goes out", async () => {
      /*
       * Twenty-five times the threshold: a recipient this deep into a burst
       * has every other rollup-eligible email deferred, which is what makes
       * the control at the bottom of this test the real assertion.
       */
      countRecent.mockResolvedValue(
        new PositiveNumber(BURST_THRESHOLD * 25) as never,
      );

      await UserNotificationSettingService.sendUserNotification(
        notificationData({ forceImmediate: true }),
      );

      expect(sendMail).toHaveBeenCalledTimes(1);

      const delivered: EmailEnvelope & { toEmail: Email } = sendMail.mock
        .calls[0]?.[0] as EmailEnvelope & { toEmail: Email };
      expect(delivered.subject).toBe(SUBJECT);
      expect(delivered.toEmail.toString()).toBe("owner@example.com");

      /*
       * Not merely "sent anyway": the bypass sits above every database line,
       * so an urgent email must not pay for the counter or the ledger row.
       */
      expect(countRecent).not.toHaveBeenCalled();
      expect(createItem).not.toHaveBeenCalled();

      /*
       * THE CONTROL. The identical notification without the flag is deferred.
       * Without it, the assertions above would still pass in a world where
       * forceImmediate were ignored end to end and the burst counter were the
       * thing that was broken.
       */
      sendMail.mockClear();
      createItem.mockClear();

      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      expect(sendMail).not.toHaveBeenCalled();
      expect(createItem).toHaveBeenCalledTimes(1);
    });

    test("the job file is still where the two source assertions below look for it", () => {
      /*
       * A moved or renamed job would otherwise turn those assertions into a
       * readFileSync throw that says nothing about what was being checked.
       */
      expect(fs.existsSync(SLA_BREACH_JOB_PATH)).toBe(true);
    });

    test("CheckSlaBreaches asks for the bypass by name when it sends the breach notification", () => {
      const source: string = fs.readFileSync(SLA_BREACH_JOB_PATH, "utf8");

      const functionIndex: number = source.indexOf(
        "async function sendBreachNotification",
      );
      expect(functionIndex).toBeGreaterThanOrEqual(0);

      const argumentText: string | null = extractCallArguments(
        source.slice(functionIndex),
        "UserNotificationSettingService.sendUserNotification",
      );

      /*
       * Null means sendBreachNotification no longer calls sendUserNotification
       * at all - a bigger change than this test can judge, and one that must
       * not be allowed to read as "the bypass is fine".
       */
      expect(argumentText).not.toBeNull();

      /*
       * Whitespace- and position-insensitive: the property may sit anywhere in
       * the object literal, formatted however prettier likes. What it may not
       * be is absent, false, or a variable whose value this test cannot see.
       */
      expect(argumentText ?? "").toMatch(
        /(^|[{,\s])forceImmediate\s*:\s*true\s*(,|\}|$)/,
      );
    });

    test("the reason the bypass is needed is still true: the job borrows the incident-created identity", () => {
      /*
       * The bypass exists only because this job cannot express urgency through
       * its event type. If that ever stops being true - the job gets its own
       * NotificationSettingEventType, or its own template - the right fix is
       * to add that type to NEVER_ROLLED_UP_EVENT_TYPES and delete the
       * caller-side flag, making the exclusion structural like every other
       * one. This test going red is the prompt to do that, not a bug in
       * itself.
       */
      const source: string = fs.readFileSync(SLA_BREACH_JOB_PATH, "utf8");

      expect(source).toContain(
        "EmailTemplateType.IncidentOwnerResourceCreated",
      );
      expect(source).toContain(
        "NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION",
      );
    });
  });
});
