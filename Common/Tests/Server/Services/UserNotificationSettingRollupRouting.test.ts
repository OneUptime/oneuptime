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
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

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
});
