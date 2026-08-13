import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallNotificationAlertingService from "../../../Server/Services/OnCallNotificationAlertingService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserNotificationRuleService, {
  ExecuteFallbackNotificationOptions,
  ExecuteNotificationRuleOptions,
  FALLBACK_NOTIFICATION_CLAIM_KEY,
  FallbackNotificationOutcome,
  FallbackNotificationResult,
} from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService, {
  NO_NOTIFICATION_RULES_STATUS_MESSAGE,
} from "../../../Server/Services/UserOnCallLogService";
import UserPushService from "../../../Server/Services/UserPushService";
import UserService from "../../../Server/Services/UserService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import logger from "../../../Server/Utils/Logger";
import Project from "../../../Models/DatabaseModels/Project";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import Phone from "../../../Types/Phone";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The verified-method fallback: what happens when a responder is paged and has
 * NO notification rule for the (ruleType x severity) that fired.
 *
 * Before Phase 1 that was a dead-end - an Error row nobody reads, no send, and
 * an escalation timer running down as though the responder had simply declined
 * to acknowledge (Gap C). The fallback pages them anyway, on whatever they have
 * verified. This file pins the four things about it that are easy to get subtly,
 * silently wrong:
 *
 *   1. WHICH CHANNELS. Zero-cost first: a responder with a verified push device
 *      and a verified email gets both, because there is no reason to choose and
 *      neither costs the project anything. Only a responder with neither is
 *      worth spending money on, and then exactly once, down the ladder
 *      SMS -> Call -> WhatsApp -> Telegram -> Webhook - and only through
 *      channels the PROJECT still has switched on. That last clause is the one
 *      with a bill attached: SmsService and CallService check their project flag
 *      at send time, but WhatsApp and Telegram only check theirs when the method
 *      is created, so a project that switched WhatsApp off would be billed by a
 *      fallback that did not look for itself (spec constraint 7). It is driven
 *      per channel below.
 *
 *   2. ONE DELIVERY CALL PER CHANNEL. This is the highest-value assertion in the
 *      file (spec constraint 1). deliverNotificationForRule keeps ONE mutable
 *      UserOnCallLogTimeline instance and mutates it as it walks its channel
 *      blocks; after the first create() that instance carries an _id, so a
 *      second create() with it UPDATEs the row it already wrote instead of
 *      inserting a new one. A fallback that looped channels inside a single
 *      delivery call would therefore overwrite the first channel's timeline row
 *      with the second's - one page would vanish from the record entirely. So:
 *      two channels means two calls, each with its OWN freshly built rule.
 *
 *   3. THE UNSAVED RULE. Each channel is delivered through a UserNotificationRule
 *      assembled in memory and never persisted - the user did not ask for this
 *      rule, and writing it would rewrite their configuration behind their back.
 *      It has to carry the method RELATION (rule.userEmail as a loaded UserEmail
 *      with .email and .isVerified), not merely the FK, because every channel
 *      block reads the relation and never dereferences the id: a rule with only
 *      userEmailId set sends nothing at all, quietly.
 *
 *   4. THE OUTCOME THE CALLER ACTS ON. UserNotificationExecutionStatus.Error is
 *      TERMINAL - ExecutePendingExecutions selects Executing and
 *      TimeoutStuckExecutions selects Started, so nothing re-selects an Error
 *      log. "This responder has nothing we can page them on" is worth burning
 *      the log for; "the send raised" is not the same thing at all, and both are
 *      notified:false. Hence the three-way FallbackNotificationOutcome, and
 *      hence the wiring assertions in section (F).
 *
 * Nothing here touches a database or a sender: deliverNotificationForRule is
 * stubbed at the service boundary (it fans out into template generation, short
 * links, seven providers and the timeline writer), and every lookup is a
 * jest.spyOn. What is under test is the fallback's own decision-making.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const LOG_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const INCIDENT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const POLICY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const EMAIL_METHOD_ID: ObjectID = new ObjectID(
  "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
);
const PUSH_METHOD_ID: ObjectID = new ObjectID(
  "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
);
const SMS_METHOD_ID: ObjectID = new ObjectID(
  "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3",
);
const CALL_METHOD_ID: ObjectID = new ObjectID(
  "a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4",
);
const WHATSAPP_METHOD_ID: ObjectID = new ObjectID(
  "a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5",
);
const TELEGRAM_METHOD_ID: ObjectID = new ObjectID(
  "a6a6a6a6-a6a6-4a6a-8a6a-a6a6a6a6a6a6",
);
const WEBHOOK_METHOD_ID: ObjectID = new ObjectID(
  "a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7",
);

const RESPONDER_EMAIL: string = "responder@company.com";
const SEVERITY_NAME: string = "Sev4";
const RESPONDER_NAME: string = "Jane Doe";

/*
 * The four project switches the paid ladder consults, and the flag key each
 * channel is gated on. Kept as one table because the "is this channel allowed"
 * question is asked identically for all four and answered in four separate
 * blocks of production code - exactly the shape that drifts.
 */
type PaidChannelName = "SMS" | "Call" | "WhatsApp" | "Telegram";

const SMS_FLAG: string = "enableSmsNotifications";
const CALL_FLAG: string = "enableCallNotifications";
const WHATSAPP_FLAG: string = "enableWhatsAppNotifications";
const TELEGRAM_FLAG: string = "enableTelegramNotifications";

/*
 * A project row as chooseFallbackChannels reads it. Every paid channel starts
 * DISABLED so that a test which forgets to enable one cannot accidentally bill
 * for it - the interesting default is the restrictive one.
 */
function makeProject(overrides: Record<string, unknown> = {}): Project {
  return {
    _id: PROJECT_ID.toString(),
    enableSmsNotifications: false,
    enableCallNotifications: false,
    enableWhatsAppNotifications: false,
    enableTelegramNotifications: false,
    ...overrides,
  } as unknown as Project;
}

function makeVerifiedPush(): Record<string, unknown> {
  return {
    id: PUSH_METHOD_ID,
    _id: PUSH_METHOD_ID.toString(),
    deviceToken: "device-token",
    deviceType: "iOS",
    isVerified: true,
  };
}

function makeVerifiedEmail(): Record<string, unknown> {
  return {
    id: EMAIL_METHOD_ID,
    _id: EMAIL_METHOD_ID.toString(),
    email: new Email(RESPONDER_EMAIL),
    isVerified: true,
  };
}

function makeVerifiedSms(): Record<string, unknown> {
  return {
    id: SMS_METHOD_ID,
    _id: SMS_METHOD_ID.toString(),
    phone: new Phone("+11234567890"),
    isVerified: true,
  };
}

function makeVerifiedCall(): Record<string, unknown> {
  return {
    id: CALL_METHOD_ID,
    _id: CALL_METHOD_ID.toString(),
    phone: new Phone("+11234567891"),
    isVerified: true,
  };
}

function makeVerifiedWhatsApp(): Record<string, unknown> {
  return {
    id: WHATSAPP_METHOD_ID,
    _id: WHATSAPP_METHOD_ID.toString(),
    phone: new Phone("+11234567892"),
    isVerified: true,
  };
}

function makeVerifiedTelegram(): Record<string, unknown> {
  return {
    id: TELEGRAM_METHOD_ID,
    _id: TELEGRAM_METHOD_ID.toString(),
    telegramChatId: "123456",
    telegramUserHandle: "@responder",
    isVerified: true,
  };
}

/*
 * Deliberately carries no isVerified: UserWebhook has no such column, so
 * presence of a URL is the whole gate. A fixture that invented an isVerified
 * would hide a regression that started requiring one.
 */
function makeWebhook(): Record<string, unknown> {
  return {
    id: WEBHOOK_METHOD_ID,
    _id: WEBHOOK_METHOD_ID.toString(),
    webhookUrl: "https://hooks.example.com/on-call",
    name: "Pager bridge",
    secret: "s3cr3t",
  };
}

/*
 * deliverNotificationForRule is private - it is the seam the fallback reuses
 * from executeNotificationRuleItem, not part of the service's public surface.
 * Spying on it needs a structural view of the singleton rather than a widened
 * class, so the cast lives here and nowhere else.
 */
interface UserNotificationRuleServiceInternals {
  deliverNotificationForRule: (
    notificationRuleItem: UserNotificationRule,
    options: ExecuteNotificationRuleOptions,
  ) => Promise<boolean>;
}

function ruleServiceInternals(): UserNotificationRuleServiceInternals {
  return UserNotificationRuleService as unknown as UserNotificationRuleServiceInternals;
}

interface UserOnCallLogServiceInternals {
  handleNoMatchingNotificationRule: (data: {
    createdItem: UserOnCallLog;
    notificationRuleType: NotificationRuleType;
    incidentSeverityId: ObjectID | undefined;
    alertSeverityId: ObjectID | undefined;
    severityName: string;
  }) => Promise<void>;
}

function fallbackOptions(
  overrides: Partial<ExecuteFallbackNotificationOptions> = {},
): ExecuteFallbackNotificationOptions {
  return {
    userId: USER_ID,
    projectId: PROJECT_ID,
    userOnCallLogId: LOG_ID,
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    severityName: SEVERITY_NAME,
    userNotificationLogId: LOG_ID,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    triggeredByIncidentId: INCIDENT_ID,
    onCallPolicyId: POLICY_ID,
    ...overrides,
  };
}

/* The query bundle every method lookup is handed. */
interface FindOneByArg {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: { isRoot: boolean };
}

function queryOf(spy: jest.SpyInstance): Record<string, unknown> {
  return (spy.mock.calls[0]![0] as FindOneByArg).query;
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve()
    .then((): Promise<void> => {
      return Promise.resolve();
    })
    .then((): Promise<void> => {
      return Promise.resolve();
    });
}

/*
 * ------------------------------------------------------------------------- *
 * (A)-(E) executeFallbackNotification itself.
 * -------------------------------------------------------------------------
 */

describe("UserNotificationRuleService.executeFallbackNotification", () => {
  let claimSpy: jest.SpyInstance;
  let deliverSpy: jest.SpyInstance;
  let ruleCreateSpy: jest.SpyInstance;
  let pushFindSpy: jest.SpyInstance;
  let emailFindSpy: jest.SpyInstance;
  let smsFindSpy: jest.SpyInstance;
  let callFindSpy: jest.SpyInstance;
  let whatsAppFindSpy: jest.SpyInstance;
  let telegramFindSpy: jest.SpyInstance;
  let webhookFindSpy: jest.SpyInstance;
  let projectFindSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });

    claimSpy = jest
      .spyOn(UserOnCallLogService, "claimNotificationExecution")
      .mockResolvedValue(true as never);

    /*
     * Stubbed at the service boundary. The real method fans out into template
     * generation, short-link creation, seven providers and the timeline writer;
     * its return value ("was a page actually handed to a sender") is the only
     * part of it the fallback reasons about.
     */
    deliverSpy = jest
      .spyOn(ruleServiceInternals(), "deliverNotificationForRule")
      .mockResolvedValue(true as never);

    ruleCreateSpy = jest
      .spyOn(UserNotificationRuleService, "create")
      .mockResolvedValue(undefined as never);

    // A responder with nothing configured: every test opts IN to its methods.
    pushFindSpy = jest
      .spyOn(UserPushService, "findOneBy")
      .mockResolvedValue(null as never);
    emailFindSpy = jest
      .spyOn(UserEmailService, "findOneBy")
      .mockResolvedValue(null as never);
    smsFindSpy = jest
      .spyOn(UserSmsService, "findOneBy")
      .mockResolvedValue(null as never);
    callFindSpy = jest
      .spyOn(UserCallService, "findOneBy")
      .mockResolvedValue(null as never);
    whatsAppFindSpy = jest
      .spyOn(UserWhatsAppService, "findOneBy")
      .mockResolvedValue(null as never);
    telegramFindSpy = jest
      .spyOn(UserTelegramService, "findOneBy")
      .mockResolvedValue(null as never);
    webhookFindSpy = jest
      .spyOn(UserWebhookService, "findOneBy")
      .mockResolvedValue(null as never);

    projectFindSpy = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(makeProject() as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function runFallback(
    overrides: Partial<ExecuteFallbackNotificationOptions> = {},
  ): Promise<FallbackNotificationResult> {
    return UserNotificationRuleService.executeFallbackNotification(
      fallbackOptions(overrides),
    );
  }

  function deliveredRules(): Array<UserNotificationRule> {
    return deliverSpy.mock.calls.map(
      (call: Array<unknown>): UserNotificationRule => {
        return call[0] as UserNotificationRule;
      },
    );
  }

  function deliveredOptions(): Array<ExecuteNotificationRuleOptions> {
    return deliverSpy.mock.calls.map(
      (call: Array<unknown>): ExecuteNotificationRuleOptions => {
        return call[1] as ExecuteNotificationRuleOptions;
      },
    );
  }

  function paidChannelFindSpy(channelName: PaidChannelName): jest.SpyInstance {
    const byChannel: Record<PaidChannelName, jest.SpyInstance> = {
      SMS: smsFindSpy,
      Call: callFindSpy,
      WhatsApp: whatsAppFindSpy,
      Telegram: telegramFindSpy,
    };

    return byChannel[channelName];
  }

  function everyPaidChannelFindSpy(): Array<jest.SpyInstance> {
    return [smsFindSpy, callFindSpy, whatsAppFindSpy, telegramFindSpy];
  }

  function giveResponderEveryPaidMethod(): void {
    smsFindSpy.mockResolvedValue(makeVerifiedSms() as never);
    callFindSpy.mockResolvedValue(makeVerifiedCall() as never);
    whatsAppFindSpy.mockResolvedValue(makeVerifiedWhatsApp() as never);
    telegramFindSpy.mockResolvedValue(makeVerifiedTelegram() as never);
    webhookFindSpy.mockResolvedValue(makeWebhook() as never);
  }

  /*
   * ----------------------------------------------------------------------- *
   * (A) Channel selection - zero-cost channels.
   * -----------------------------------------------------------------------
   */

  describe("channel selection: the zero-cost pair", () => {
    test("a responder with a verified push device AND a verified email gets BOTH", async () => {
      pushFindSpy.mockResolvedValue(makeVerifiedPush() as never);
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);

      const result: FallbackNotificationResult = await runFallback();

      /*
       * Both, and in this order: push and email cost nothing, so there is no
       * reason to pick between them and every reason to maximise the chance of
       * reaching a human who is not looking at their phone.
       */
      expect(result.channelsUsed).toEqual(["Push", "Email"]);
      expect(result.notified).toBe(true);
      expect(result.outcome).toBe(FallbackNotificationOutcome.Delivered);
    });

    test("a verified push device alone is enough - no paid channel is even looked up", async () => {
      pushFindSpy.mockResolvedValue(makeVerifiedPush() as never);

      const result: FallbackNotificationResult = await runFallback();

      expect(result.channelsUsed).toEqual(["Push"]);
      for (const spy of everyPaidChannelFindSpy()) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(webhookFindSpy).not.toHaveBeenCalled();
    });

    test("a verified email alone is enough - no paid channel is even looked up", async () => {
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);

      const result: FallbackNotificationResult = await runFallback();

      expect(result.channelsUsed).toEqual(["Email"]);
      for (const spy of everyPaidChannelFindSpy()) {
        expect(spy).not.toHaveBeenCalled();
      }
    });

    test("with a zero-cost channel available the project settings are never even read", async () => {
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);

      await runFallback();

      /*
       * The project row is only consulted to decide whether a PAID channel may
       * be used. Reaching it at all on this path would mean the ladder is being
       * evaluated when it should not be.
       */
      expect(projectFindSpy).not.toHaveBeenCalled();
    });

    test("the push lookup is scoped to this project, this user, and verified devices only", async () => {
      pushFindSpy.mockResolvedValue(makeVerifiedPush() as never);

      await runFallback();

      const query: Record<string, unknown> = queryOf(pushFindSpy);
      expect((query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect((query["userId"] as ObjectID).toString()).toBe(USER_ID.toString());
      /*
       * The verification predicate lives in the QUERY, which is the only place
       * it can live: nothing downstream re-checks it before the fallback builds
       * a rule around the row. Dropping it would page an unverified device.
       */
      expect(query["isVerified"]).toBe(true);
    });

    test("the email lookup is scoped to this project, this user, and verified addresses only", async () => {
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);

      await runFallback();

      const query: Record<string, unknown> = queryOf(emailFindSpy);
      expect((query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect((query["userId"] as ObjectID).toString()).toBe(USER_ID.toString());
      expect(query["isVerified"]).toBe(true);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (A continued) Channel selection - the paid ladder and its project gates.
   * -----------------------------------------------------------------------
   */

  describe("channel selection: the paid ladder", () => {
    test.each<[PaidChannelName, string, Record<string, unknown>]>([
      ["SMS", SMS_FLAG, makeVerifiedSms()],
      ["Call", CALL_FLAG, makeVerifiedCall()],
      ["WhatsApp", WHATSAPP_FLAG, makeVerifiedWhatsApp()],
      ["Telegram", TELEGRAM_FLAG, makeVerifiedTelegram()],
    ])(
      "%s is used when the responder has it verified and the project has it enabled",
      async (
        channelName: PaidChannelName,
        flagKey: string,
        method: Record<string, unknown>,
      ): Promise<void> => {
        projectFindSpy.mockResolvedValue(
          makeProject({ [flagKey]: true }) as never,
        );
        paidChannelFindSpy(channelName).mockResolvedValue(method as never);

        const result: FallbackNotificationResult = await runFallback();

        expect(result.channelsUsed).toEqual([channelName]);
        expect(result.outcome).toBe(FallbackNotificationOutcome.Delivered);
        // Exactly one paid channel, never a spree down the ladder.
        expect(deliverSpy).toHaveBeenCalledTimes(1);
      },
    );

    test.each<[PaidChannelName, string, Record<string, unknown>]>([
      ["SMS", SMS_FLAG, makeVerifiedSms()],
      ["Call", CALL_FLAG, makeVerifiedCall()],
      ["WhatsApp", WHATSAPP_FLAG, makeVerifiedWhatsApp()],
      ["Telegram", TELEGRAM_FLAG, makeVerifiedTelegram()],
    ])(
      "%s is skipped - not even queried - when the project has it disabled",
      async (
        channelName: PaidChannelName,
        _flagKey: string,
        method: Record<string, unknown>,
      ): Promise<void> => {
        /*
         * This is the constraint that stops a fallback billing a project that
         * deliberately switched a channel off. Only SmsService and CallService
         * enforce their flag at send time; WhatsApp and Telegram check theirs
         * when a method is CREATED, so by the time a fallback picks one up the
         * project's answer has never been asked. It is asked here.
         */
        projectFindSpy.mockResolvedValue(makeProject() as never);
        paidChannelFindSpy(channelName).mockResolvedValue(method as never);

        const result: FallbackNotificationResult = await runFallback();

        expect(paidChannelFindSpy(channelName)).not.toHaveBeenCalled();
        expect(result.channelsUsed).toEqual([]);
        expect(result.notified).toBe(false);
        expect(result.outcome).toBe(
          FallbackNotificationOutcome.NoUsableNotificationMethod,
        );
        expect(deliverSpy).not.toHaveBeenCalled();
      },
    );

    test("with everything available and everything enabled, SMS wins and the rest are never queried", async () => {
      giveResponderEveryPaidMethod();
      projectFindSpy.mockResolvedValue(
        makeProject({
          [SMS_FLAG]: true,
          [CALL_FLAG]: true,
          [WHATSAPP_FLAG]: true,
          [TELEGRAM_FLAG]: true,
        }) as never,
      );

      const result: FallbackNotificationResult = await runFallback();

      expect(result.channelsUsed).toEqual(["SMS"]);
      expect(callFindSpy).not.toHaveBeenCalled();
      expect(whatsAppFindSpy).not.toHaveBeenCalled();
      expect(telegramFindSpy).not.toHaveBeenCalled();
      expect(webhookFindSpy).not.toHaveBeenCalled();
    });

    test.each<[string, Record<string, unknown>, string]>([
      [
        "SMS off",
        { [CALL_FLAG]: true, [WHATSAPP_FLAG]: true, [TELEGRAM_FLAG]: true },
        "Call",
      ],
      [
        "SMS and Call off",
        { [WHATSAPP_FLAG]: true, [TELEGRAM_FLAG]: true },
        "WhatsApp",
      ],
      ["SMS, Call and WhatsApp off", { [TELEGRAM_FLAG]: true }, "Telegram"],
      ["every paid channel off", {}, "Webhook"],
    ])(
      "with %s, the ladder falls through to %s",
      async (
        _label: string,
        flags: Record<string, unknown>,
        expectedChannel: string,
      ): Promise<void> => {
        giveResponderEveryPaidMethod();
        projectFindSpy.mockResolvedValue(makeProject(flags) as never);

        const result: FallbackNotificationResult = await runFallback();

        expect(result.channelsUsed).toEqual([expectedChannel]);
      },
    );

    test.each<[PaidChannelName, string, Record<string, unknown>]>([
      ["SMS", SMS_FLAG, makeVerifiedSms()],
      ["Call", CALL_FLAG, makeVerifiedCall()],
      ["WhatsApp", WHATSAPP_FLAG, makeVerifiedWhatsApp()],
      ["Telegram", TELEGRAM_FLAG, makeVerifiedTelegram()],
    ])(
      "the %s lookup is verification-gated and scoped to this responder",
      async (
        channelName: PaidChannelName,
        flagKey: string,
        method: Record<string, unknown>,
      ): Promise<void> => {
        projectFindSpy.mockResolvedValue(
          makeProject({ [flagKey]: true }) as never,
        );
        paidChannelFindSpy(channelName).mockResolvedValue(method as never);

        await runFallback();

        const query: Record<string, unknown> = queryOf(
          paidChannelFindSpy(channelName),
        );
        expect(query["isVerified"]).toBe(true);
        expect((query["projectId"] as ObjectID).toString()).toBe(
          PROJECT_ID.toString(),
        );
        expect((query["userId"] as ObjectID).toString()).toBe(
          USER_ID.toString(),
        );
      },
    );

    test("the paid ladder is only reached when BOTH zero-cost channels are missing", async () => {
      pushFindSpy.mockResolvedValue(makeVerifiedPush() as never);
      giveResponderEveryPaidMethod();
      projectFindSpy.mockResolvedValue(
        makeProject({ [SMS_FLAG]: true }) as never,
      );

      const result: FallbackNotificationResult = await runFallback();

      expect(result.channelsUsed).toEqual(["Push"]);
      expect(smsFindSpy).not.toHaveBeenCalled();
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (A continued) Channel selection - the webhook backstop.
   * -----------------------------------------------------------------------
   */

  describe("channel selection: the webhook backstop", () => {
    test("a webhook qualifies on presence alone - it has no verification concept", async () => {
      webhookFindSpy.mockResolvedValue(makeWebhook() as never);

      const result: FallbackNotificationResult = await runFallback();

      expect(result.channelsUsed).toEqual(["Webhook"]);
      expect(result.outcome).toBe(FallbackNotificationOutcome.Delivered);
    });

    test("the webhook lookup carries NO isVerified predicate", async () => {
      webhookFindSpy.mockResolvedValue(makeWebhook() as never);

      await runFallback();

      const query: Record<string, unknown> = queryOf(webhookFindSpy);
      /*
       * UserWebhook has no isVerified column. Adding the predicate to this
       * query for symmetry with the others would match nothing at all, and the
       * backstop would silently stop existing.
       */
      expect(Object.keys(query).sort()).toEqual(["projectId", "userId"]);
      expect(query["isVerified"]).toBeUndefined();
    });

    test("a webhook is still used when every paid channel is switched off - there is no flag for it", async () => {
      giveResponderEveryPaidMethod();
      projectFindSpy.mockResolvedValue(makeProject() as never);

      const result: FallbackNotificationResult = await runFallback();

      expect(result.channelsUsed).toEqual(["Webhook"]);
      for (const spy of everyPaidChannelFindSpy()) {
        expect(spy).not.toHaveBeenCalled();
      }
    });

    test("a project row that cannot be read bills nothing and still reaches the webhook", async () => {
      projectFindSpy.mockResolvedValue(null as never);
      giveResponderEveryPaidMethod();

      const result: FallbackNotificationResult = await runFallback();

      /*
       * `project?.enableSmsNotifications` on a null project is falsy, so a
       * deleted or unreadable project fails CLOSED for everything with a bill
       * attached and open for the one channel that has none.
       */
      for (const spy of everyPaidChannelFindSpy()) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(result.channelsUsed).toEqual(["Webhook"]);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (B) One delivery call per channel - spec constraint 1.
   * -----------------------------------------------------------------------
   */

  describe("one delivery call per channel", () => {
    beforeEach(() => {
      pushFindSpy.mockResolvedValue(makeVerifiedPush() as never);
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);
    });

    test("two chosen channels means deliverNotificationForRule is called TWICE", async () => {
      await runFallback();

      /*
       * Not once with two methods on one rule. deliverNotificationForRule keeps
       * a single mutable UserOnCallLogTimeline instance across its channel
       * blocks, and that instance carries an _id after the first create(); a
       * second create() with it UPDATEs the first row instead of inserting a
       * second. Two channels inside one call would therefore leave ONE timeline
       * row describing the second page and no trace of the first.
       */
      expect(deliverSpy).toHaveBeenCalledTimes(2);
    });

    test("the two calls are handed DIFFERENT rule instances", async () => {
      await runFallback();

      const rules: Array<UserNotificationRule> = deliveredRules();
      expect(rules).toHaveLength(2);
      expect(rules[0]).not.toBe(rules[1]);
    });

    test("each rule carries exactly ONE method relation", async () => {
      await runFallback();

      const rules: Array<UserNotificationRule> = deliveredRules();
      const pushRule: UserNotificationRule = rules[0]!;
      const emailRule: UserNotificationRule = rules[1]!;

      expect(pushRule.userPush).toBeDefined();
      expect(pushRule.userEmail).toBeUndefined();
      expect(pushRule.userEmailId).toBeUndefined();

      expect(emailRule.userEmail).toBeDefined();
      expect(emailRule.userPush).toBeUndefined();
      expect(emailRule.userPushId).toBeUndefined();
    });

    test("no rule ever carries a second channel's method (the multiplexed-rule regression)", async () => {
      await runFallback();

      for (const rule of deliveredRules()) {
        const methodsOnRule: Array<unknown> = [
          rule.userEmail,
          rule.userPush,
          rule.userSms,
          rule.userCall,
          rule.userWhatsApp,
          rule.userTelegram,
          rule.userWebhook,
        ].filter((method: unknown): boolean => {
          return Boolean(method);
        });

        expect(methodsOnRule).toHaveLength(1);
      }
    });

    test("both calls receive the very same options bundle the caller handed in", async () => {
      const options: ExecuteFallbackNotificationOptions = fallbackOptions();

      await UserNotificationRuleService.executeFallbackNotification(options);

      const forwarded: Array<ExecuteNotificationRuleOptions> =
        deliveredOptions();
      /*
       * Identity, not shape: everything that attributes the page back to its
       * escalation (the incident id, the policy, the escalation rule, the
       * on-call timeline row) rides in this object, and both channels have to
       * describe the same page.
       */
      expect(forwarded[0]).toBe(options);
      expect(forwarded[1]).toBe(options);
    });

    test("a single chosen channel produces exactly one call", async () => {
      pushFindSpy.mockResolvedValue(null as never);

      await runFallback();

      expect(deliverSpy).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (C) The unsaved rule.
   * -----------------------------------------------------------------------
   */

  describe("the rule handed to delivery is built in memory and never saved", () => {
    test("the method RELATION is populated, not merely the foreign key", async () => {
      const email: Record<string, unknown> = makeVerifiedEmail();
      emailFindSpy.mockResolvedValue(email as never);

      await runFallback();

      const rule: UserNotificationRule = deliveredRules()[0]!;

      /*
       * Every channel block reads the relation (`userEmail?.email &&
       * userEmail?.isVerified`) and never dereferences the id. A rule carrying
       * only userEmailId would sail through delivery sending absolutely
       * nothing, and the fallback would then report a channel it never used.
       */
      expect(rule.userEmail).toBe(email);
      expect(rule.userEmail!.email!.toString()).toBe(RESPONDER_EMAIL);
      expect(rule.userEmail!.isVerified).toBe(true);
      // ...and the FK too, so the row is self-consistent if it is ever read.
      expect(rule.userEmailId!.toString()).toBe(EMAIL_METHOD_ID.toString());
    });

    test("the push relation is populated with the device the sender needs", async () => {
      const push: Record<string, unknown> = makeVerifiedPush();
      pushFindSpy.mockResolvedValue(push as never);

      await runFallback();

      const rule: UserNotificationRule = deliveredRules()[0]!;
      expect(rule.userPush).toBe(push);
      expect(rule.userPush!.deviceToken).toBe("device-token");
      expect(rule.userPush!.isVerified).toBe(true);
      expect(rule.userPushId!.toString()).toBe(PUSH_METHOD_ID.toString());
    });

    test("the rule carries the responder, the project, the rule type and notifyAfterMinutes 0", async () => {
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);

      await runFallback();

      const rule: UserNotificationRule = deliveredRules()[0]!;
      expect(rule.userId!.toString()).toBe(USER_ID.toString());
      expect(rule.projectId!.toString()).toBe(PROJECT_ID.toString());
      expect(rule.ruleType).toBe(
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      );
      // Immediate: the page is already late by the time the fallback runs.
      expect(rule.notifyAfterMinutes).toBe(0);
    });

    test("the rule type follows whatever the caller was paging for", async () => {
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);

      await runFallback({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      });

      expect(deliveredRules()[0]!.ruleType).toBe(
        NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      );
    });

    test("the rule has no id, so no timeline row can point at a rule that does not exist", async () => {
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);

      await runFallback();

      /*
       * buildLogTimelineItem sets userNotificationRuleId only `if
       * (notificationRuleItem.id)`. An id here would be a dangling FK on every
       * timeline row the fallback writes.
       */
      expect(deliveredRules()[0]!.id).toBeNull();
    });

    test("no fallback rule is EVER persisted", async () => {
      pushFindSpy.mockResolvedValue(makeVerifiedPush() as never);
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);

      await runFallback();

      /*
       * The responder did not ask for these rules. Saving them would silently
       * rewrite their notification configuration, and the next page would find
       * "matching rules" that a human never created.
       */
      expect(ruleCreateSpy).not.toHaveBeenCalled();
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (D) The claim.
   * -----------------------------------------------------------------------
   */

  describe("the fallback claims the on-call log under a reserved key", () => {
    test("the claim key is the literal __fallback__", async () => {
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);

      await runFallback();

      expect(claimSpy).toHaveBeenCalledTimes(1);
      const claimArg: { userOnCallLogId: ObjectID; claimKey: string } = claimSpy
        .mock.calls[0]![0] as {
        userOnCallLogId: ObjectID;
        claimKey: string;
      };

      /*
       * There is no rule to claim under - that is the entire reason the
       * fallback is running - so it claims a reserved literal instead.
       * executedNotificationRules is a jsonb map keyed by arbitrary text, so
       * the literal sits beside real rule uuids and can never collide with one.
       */
      expect(claimArg.claimKey).toBe("__fallback__");
      expect(claimArg.userOnCallLogId.toString()).toBe(LOG_ID.toString());
    });

    test("the exported claim key constant is that same literal", () => {
      // Pinned because the string is the interop contract with existing rows.
      expect(FALLBACK_NOTIFICATION_CLAIM_KEY).toBe("__fallback__");
    });

    test("the claim strictly precedes any method lookup", async () => {
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);

      await runFallback();

      expect(claimSpy.mock.invocationCallOrder[0]).toBeLessThan(
        emailFindSpy.mock.invocationCallOrder[0] as number,
      );
    });

    test("a lost claim delivers nothing and does not even look for a method", async () => {
      claimSpy.mockResolvedValue(false as never);
      pushFindSpy.mockResolvedValue(makeVerifiedPush() as never);
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);

      const result: FallbackNotificationResult = await runFallback();

      expect(deliverSpy).not.toHaveBeenCalled();
      expect(pushFindSpy).not.toHaveBeenCalled();
      expect(emailFindSpy).not.toHaveBeenCalled();
      expect(result.notified).toBe(false);
      expect(result.channelsUsed).toEqual([]);
    });

    test("a lost claim is DeliveryFailed, never NoUsableNotificationMethod", async () => {
      claimSpy.mockResolvedValue(false as never);

      const result: FallbackNotificationResult = await runFallback();

      /*
       * The distinction is load-bearing. NoUsableNotificationMethod makes the
       * caller write a TERMINAL Error onto the log - "this responder is
       * unreachable" - which would be stamped over a page another run has in
       * flight right now.
       */
      expect(result.outcome).toBe(FallbackNotificationOutcome.DeliveryFailed);
      expect(result.outcome).not.toBe(
        FallbackNotificationOutcome.NoUsableNotificationMethod,
      );
    });

    test("of two concurrent fallbacks for one log, only the winner delivers", async () => {
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);
      claimSpy
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(false as never);

      const results: Array<FallbackNotificationResult> = await Promise.all([
        runFallback(),
        runFallback(),
      ]);

      // One page, not two - the responder's phone buzzes once.
      expect(deliverSpy).toHaveBeenCalledTimes(1);
      expect(results[0]!.notified).toBe(true);
      expect(results[0]!.channelsUsed).toEqual(["Email"]);
      expect(results[1]!.notified).toBe(false);
      expect(results[1]!.channelsUsed).toEqual([]);
      expect(results[1]!.outcome).toBe(
        FallbackNotificationOutcome.DeliveryFailed,
      );
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (E) The three outcomes.
   * -----------------------------------------------------------------------
   */

  describe("the outcome the caller branches on", () => {
    test("Delivered when at least one channel dispatched a page", async () => {
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);

      const result: FallbackNotificationResult = await runFallback();

      expect(result.outcome).toBe(FallbackNotificationOutcome.Delivered);
      expect(result.notified).toBe(true);
      expect(result.channelsUsed).toEqual(["Email"]);
    });

    test("NoUsableNotificationMethod when the responder has nothing at all", async () => {
      const result: FallbackNotificationResult = await runFallback();

      /*
       * The one permanent ending: a retry finds the same nothing, and only a
       * human adding a notification method changes it. It is the only outcome
       * the caller is allowed to turn into a terminal Error.
       */
      expect(result.outcome).toBe(
        FallbackNotificationOutcome.NoUsableNotificationMethod,
      );
      expect(result.notified).toBe(false);
      expect(result.channelsUsed).toEqual([]);
      expect(deliverSpy).not.toHaveBeenCalled();
    });

    test("DeliveryFailed when the only chosen channel raised", async () => {
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);
      deliverSpy.mockRejectedValue(new Error("smtp exploded") as never);

      const result: FallbackNotificationResult = await runFallback();

      /*
       * There WAS something to try, so the responder is reachable and today
       * simply was not reached. Reporting this as NoUsableNotificationMethod
       * would tell the operator to go add a notification method that already
       * exists.
       */
      expect(result.outcome).toBe(FallbackNotificationOutcome.DeliveryFailed);
      expect(result.notified).toBe(false);
      expect(result.channelsUsed).toEqual([]);
    });

    test("a raising channel does not take the fallback down with it", async () => {
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);
      deliverSpy.mockRejectedValue(new Error("smtp exploded") as never);

      await expect(runFallback()).resolves.toBeDefined();
    });

    test("DeliveryFailed when the chosen channel fell through its event-type guard", async () => {
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);
      deliverSpy.mockResolvedValue(false as never);

      const result: FallbackNotificationResult = await runFallback();

      /*
       * deliverNotificationForRule resolves perfectly happily when no channel
       * block claimed the event type - it writes an Error timeline row and
       * returns false. "Did not throw" is emphatically not "paged".
       */
      expect(result.outcome).toBe(FallbackNotificationOutcome.DeliveryFailed);
      expect(result.notified).toBe(false);
    });

    test("a channel that dispatched NOTHING is not listed in channelsUsed", async () => {
      pushFindSpy.mockResolvedValue(makeVerifiedPush() as never);
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);
      // Push goes out; email falls through to the guard and sends nothing.
      deliverSpy
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(false as never);

      const result: FallbackNotificationResult = await runFallback();

      /*
       * channelsUsed is read back to the operator verbatim as "notified via
       * fallback (Push, Email)". A name in there that nobody was actually
       * contacted on is a lie in the single place somebody looks to find out
       * whether the responder was reached.
       */
      expect(result.channelsUsed).toEqual(["Push"]);
      expect(result.channelsUsed).not.toContain("Email");
      expect(result.outcome).toBe(FallbackNotificationOutcome.Delivered);
      expect(result.notified).toBe(true);
    });

    test("one channel raising does not stop the next channel from being tried", async () => {
      pushFindSpy.mockResolvedValue(makeVerifiedPush() as never);
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);
      deliverSpy
        .mockRejectedValueOnce(new Error("APNs down") as never)
        .mockResolvedValueOnce(true as never);

      const result: FallbackNotificationResult = await runFallback();

      expect(deliverSpy).toHaveBeenCalledTimes(2);
      expect(result.channelsUsed).toEqual(["Email"]);
      expect(result.outcome).toBe(FallbackNotificationOutcome.Delivered);
      expect(result.notified).toBe(true);
    });

    test("notified always mirrors outcome === Delivered", async () => {
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);

      const delivered: FallbackNotificationResult = await runFallback();

      deliverSpy.mockResolvedValue(false as never);
      const failed: FallbackNotificationResult = await runFallback();

      emailFindSpy.mockResolvedValue(null as never);
      const nothing: FallbackNotificationResult = await runFallback();

      for (const result of [delivered, failed, nothing]) {
        expect(result.notified).toBe(
          result.outcome === FallbackNotificationOutcome.Delivered,
        );
      }
    });

    test("an undelivered outcome always carries an empty channel list", async () => {
      emailFindSpy.mockResolvedValue(makeVerifiedEmail() as never);
      deliverSpy.mockResolvedValue(false as never);

      const result: FallbackNotificationResult = await runFallback();

      expect(result.notified).toBe(false);
      expect(result.channelsUsed).toEqual([]);
    });
  });
});

/*
 * ------------------------------------------------------------------------- *
 * (F) The wiring: what UserOnCallLogService does with all of that.
 * -------------------------------------------------------------------------
 */

describe("UserOnCallLogService.handleNoMatchingNotificationRule", () => {
  let logUpdateSpy: jest.SpyInstance;
  let timelineUpdateSpy: jest.SpyInstance;
  let optOutFindSpy: jest.SpyInstance;
  let projectFindSpy: jest.SpyInstance;
  let fallbackSpy: jest.SpyInstance;
  let userFindSpy: jest.SpyInstance;
  let alertOwnersSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

  interface StatusUpdateCall {
    id: ObjectID;
    data: {
      status?: UserNotificationExecutionStatus | undefined;
      statusMessage?: string | undefined;
    };
    props: { isRoot: boolean };
  }

  interface TimelineUpdateCall {
    id: ObjectID;
    data: {
      status?: OnCallDutyExecutionLogTimelineStatus | undefined;
      statusMessage?: string | undefined;
    };
    props: { isRoot: boolean };
  }

  interface UndeliverableAlertCall {
    projectId: ObjectID;
    userId: ObjectID;
    ruleType: NotificationRuleType;
    severityName: string;
    onCallDutyPolicyId: ObjectID | undefined;
    fallbackChannelsUsed: Array<string>;
  }

  function makeCreatedLog(): UserOnCallLog {
    return {
      id: LOG_ID,
      _id: LOG_ID.toString(),
      projectId: PROJECT_ID,
      userId: USER_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      triggeredByIncidentId: INCIDENT_ID,
      onCallDutyPolicyId: POLICY_ID,
      onCallDutyPolicyExecutionLogTimelineId: TIMELINE_ID,
    } as unknown as UserOnCallLog;
  }

  function callHandleNoMatchingNotificationRule(): Promise<void> {
    return (
      UserOnCallLogService as unknown as UserOnCallLogServiceInternals
    ).handleNoMatchingNotificationRule({
      createdItem: makeCreatedLog(),
      notificationRuleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: INCIDENT_SEVERITY_ID,
      alertSeverityId: undefined,
      severityName: SEVERITY_NAME,
    });
  }

  function statusUpdates(): Array<StatusUpdateCall> {
    return logUpdateSpy.mock.calls.map(
      (call: Array<unknown>): StatusUpdateCall => {
        return call[0] as StatusUpdateCall;
      },
    );
  }

  function timelineUpdates(): Array<TimelineUpdateCall> {
    return timelineUpdateSpy.mock.calls.map(
      (call: Array<unknown>): TimelineUpdateCall => {
        return call[0] as TimelineUpdateCall;
      },
    );
  }

  function lastStatusUpdate(): StatusUpdateCall {
    const updates: Array<StatusUpdateCall> = statusUpdates();

    return updates[updates.length - 1]!;
  }

  beforeEach(() => {
    loggerErrorSpy = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    logUpdateSpy = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    timelineUpdateSpy = jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);

    // No opt-out row: the interesting default is the one where a page is due.
    optOutFindSpy = jest
      .spyOn(UserNotificationRuleService, "findOneBy")
      .mockResolvedValue(null as never);

    // Fallback enabled, which is the product default.
    projectFindSpy = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(makeProject() as never);

    fallbackSpy = jest
      .spyOn(UserNotificationRuleService, "executeFallbackNotification")
      .mockResolvedValue({
        outcome: FallbackNotificationOutcome.Delivered,
        notified: true,
        channelsUsed: ["Push", "Email"],
      } as never);

    userFindSpy = jest.spyOn(UserService, "findOneById").mockResolvedValue({
      name: new Name(RESPONDER_NAME),
    } as never);

    alertOwnersSpy = jest
      .spyOn(OnCallNotificationAlertingService, "notifyOfUndeliverablePage")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("an opt-out row means deliberate silence", () => {
    test("the log is Completed and the timeline says Skipped", async () => {
      optOutFindSpy.mockResolvedValue({ _id: "opt-out-row" } as never);

      await callHandleNoMatchingNotificationRule();

      /*
       * Completed, not Error: the system did exactly what it was told to do.
       * Skipped rather than Notification Sent because nothing was in fact sent,
       * and an operator scanning the escalation has to be able to tell "muted
       * on purpose" from "delivered".
       */
      expect(lastStatusUpdate().data.status).toBe(
        UserNotificationExecutionStatus.Completed,
      );
      expect(lastStatusUpdate().data.statusMessage).toContain("opted out");
      expect(timelineUpdates()[0]!.data.status).toBe(
        OnCallDutyExecutionLogTimelineStatus.Skipped,
      );
      expect(timelineUpdates()[0]!.id.toString()).toBe(TIMELINE_ID.toString());
    });

    test("the fallback is NEVER called, and the project is not even read", async () => {
      optOutFindSpy.mockResolvedValue({ _id: "opt-out-row" } as never);

      await callHandleNoMatchingNotificationRule();

      /*
       * The opt-out is checked FIRST, before the project setting and before any
       * delivery. Paging somebody who asked not to be paged is the one failure
       * mode the fallback could introduce, and this is what forecloses it.
       */
      expect(fallbackSpy).not.toHaveBeenCalled();
      expect(projectFindSpy).not.toHaveBeenCalled();
    });

    test("nobody is alerted - an opt-out is not a misconfiguration", async () => {
      optOutFindSpy.mockResolvedValue({ _id: "opt-out-row" } as never);

      await callHandleNoMatchingNotificationRule();

      expect(alertOwnersSpy).not.toHaveBeenCalled();
    });

    test("the opt-out lookup asks for exactly the cell that came up empty", async () => {
      await callHandleNoMatchingNotificationRule();

      const query: Record<string, unknown> = (
        optOutFindSpy.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;

      expect((query["userId"] as ObjectID).toString()).toBe(USER_ID.toString());
      expect((query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(query["ruleType"]).toBe(
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      );
      expect((query["incidentSeverityId"] as ObjectID).toString()).toBe(
        INCIDENT_SEVERITY_ID.toString(),
      );
      expect(query["isOptOut"]).toBe(true);
    });
  });

  describe("disableOnCallNotificationFallback restores the old dead-end", () => {
    beforeEach(() => {
      projectFindSpy.mockResolvedValue(
        makeProject({ disableOnCallNotificationFallback: true }) as never,
      );
    });

    test("the log and the timeline both carry the ORIGINAL sentence, verbatim", async () => {
      await callHandleNoMatchingNotificationRule();

      /*
       * A project that sets this flag is asking for precisely the pre-fallback
       * behaviour, so it must receive precisely the pre-fallback words -
       * operators grep their execution logs for this sentence.
       */
      expect(lastStatusUpdate().data.status).toBe(
        UserNotificationExecutionStatus.Error,
      );
      expect(lastStatusUpdate().data.statusMessage).toBe(
        NO_NOTIFICATION_RULES_STATUS_MESSAGE,
      );
      expect(timelineUpdates()[0]!.data.status).toBe(
        OnCallDutyExecutionLogTimelineStatus.Error,
      );
      expect(timelineUpdates()[0]!.data.statusMessage).toBe(
        NO_NOTIFICATION_RULES_STATUS_MESSAGE,
      );
    });

    test("the fallback is never called - the project is never billed for one", async () => {
      await callHandleNoMatchingNotificationRule();

      expect(fallbackSpy).not.toHaveBeenCalled();
    });

    test("the owner alert IS still fired, with an empty channel list", async () => {
      await callHandleNoMatchingNotificationRule();

      /*
       * This one is a real bug that was written and then fixed: the early
       * return sat ABOVE the alert, so the owner notification reached every
       * project except the one that needs it most. A project that has switched
       * the fallback off is the population still losing pages exactly the way
       * they were lost before any of this existed.
       */
      expect(alertOwnersSpy).toHaveBeenCalledTimes(1);

      const alerted: UndeliverableAlertCall = alertOwnersSpy.mock
        .calls[0]![0] as UndeliverableAlertCall;
      expect(alerted.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(alerted.userId.toString()).toBe(USER_ID.toString());
      expect(alerted.ruleType).toBe(
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      );
      expect(alerted.severityName).toBe(SEVERITY_NAME);
      expect(alerted.onCallDutyPolicyId!.toString()).toBe(POLICY_ID.toString());
      // Empty means "this responder was not reached at all".
      expect(alerted.fallbackChannelsUsed).toEqual([]);
    });
  });

  describe("the fallback delivered", () => {
    test("the log is left Executing, not Completed and not Error", async () => {
      await callHandleNoMatchingNotificationRule();

      /*
       * Executing matches the normal path: there are no further rules to fire,
       * so ExecutePendingExecutions finds an empty rule list on its next tick
       * and closes the log out as Completed.
       */
      expect(lastStatusUpdate().data.status).toBe(
        UserNotificationExecutionStatus.Executing,
      );
    });

    test("the message names the severity and the channels that carried the page", async () => {
      await callHandleNoMatchingNotificationRule();

      const message: string | undefined = lastStatusUpdate().data.statusMessage;
      expect(message).toContain(
        `No notification rule configured for ${SEVERITY_NAME}`,
      );
      expect(message).toContain("notified via fallback (Push, Email)");
      // The old dead-end sentence is not written on this path at all.
      expect(message).not.toBe(NO_NOTIFICATION_RULES_STATUS_MESSAGE);
    });

    test("the timeline says Notification Sent with the SAME message as the log", async () => {
      await callHandleNoMatchingNotificationRule();

      expect(timelineUpdates()).toHaveLength(1);
      expect(timelineUpdates()[0]!.data.status).toBe(
        OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      );
      // Two records of one event must not tell an operator two stories.
      expect(timelineUpdates()[0]!.data.statusMessage).toBe(
        lastStatusUpdate().data.statusMessage,
      );
    });

    test("the fallback is handed this log, this responder and this severity", async () => {
      await callHandleNoMatchingNotificationRule();

      expect(fallbackSpy).toHaveBeenCalledTimes(1);
      const options: Record<string, unknown> = fallbackSpy.mock
        .calls[0]![0] as Record<string, unknown>;

      expect((options["userId"] as ObjectID).toString()).toBe(
        USER_ID.toString(),
      );
      expect((options["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect((options["userOnCallLogId"] as ObjectID).toString()).toBe(
        LOG_ID.toString(),
      );
      expect((options["userNotificationLogId"] as ObjectID).toString()).toBe(
        LOG_ID.toString(),
      );
      expect(options["ruleType"]).toBe(
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      );
      expect(options["severityName"]).toBe(SEVERITY_NAME);
      expect(options["userNotificationEventType"]).toBe(
        UserNotificationEventType.IncidentCreated,
      );
      expect((options["triggeredByIncidentId"] as ObjectID).toString()).toBe(
        INCIDENT_ID.toString(),
      );
    });

    test("the humans are still told - a delivered fallback is still a misconfiguration", async () => {
      await callHandleNoMatchingNotificationRule();

      expect(alertOwnersSpy).toHaveBeenCalledTimes(1);
      const alerted: UndeliverableAlertCall = alertOwnersSpy.mock
        .calls[0]![0] as UndeliverableAlertCall;
      /*
       * A non-empty list is the "your configuration is wrong but nobody was
       * dropped" signal, and it is what tells the two branches apart at the
       * single call site.
       */
      expect(alerted.fallbackChannelsUsed).toEqual(["Push", "Email"]);
    });
  });

  describe("the fallback found nothing to page the responder on", () => {
    beforeEach(() => {
      fallbackSpy.mockResolvedValue({
        outcome: FallbackNotificationOutcome.NoUsableNotificationMethod,
        notified: false,
        channelsUsed: [],
      } as never);
    });

    test("the log ends terminally, naming the responder and what to do about it", async () => {
      await callHandleNoMatchingNotificationRule();

      expect(lastStatusUpdate().data.status).toBe(
        UserNotificationExecutionStatus.Error,
      );
      expect(lastStatusUpdate().data.statusMessage).toContain(RESPONDER_NAME);
      expect(lastStatusUpdate().data.statusMessage).toContain(
        "has no verified notification method",
      );
      expect(lastStatusUpdate().data.statusMessage).toContain(
        "User Settings > Notification Methods",
      );
      expect(timelineUpdates()[0]!.data.status).toBe(
        OnCallDutyExecutionLogTimelineStatus.Error,
      );
    });

    test("a responder whose name cannot be read degrades to a neutral phrase", async () => {
      userFindSpy.mockResolvedValue(null as never);

      await callHandleNoMatchingNotificationRule();

      /*
       * The lookup only ever feeds a string, so a deleted user must not cost a
       * status message - let alone throw out of the paging path.
       */
      expect(lastStatusUpdate().data.statusMessage).toContain("This responder");
      expect(lastStatusUpdate().data.status).toBe(
        UserNotificationExecutionStatus.Error,
      );
    });

    test("the owners hear about it with an empty channel list", async () => {
      await callHandleNoMatchingNotificationRule();

      const alerted: UndeliverableAlertCall = alertOwnersSpy.mock
        .calls[0]![0] as UndeliverableAlertCall;
      expect(alerted.fallbackChannelsUsed).toEqual([]);
    });
  });

  describe("the fallback tried and failed", () => {
    test("a DeliveryFailed outcome does NOT claim the responder is unreachable", async () => {
      fallbackSpy.mockResolvedValue({
        outcome: FallbackNotificationOutcome.DeliveryFailed,
        notified: false,
        channelsUsed: [],
      } as never);

      await callHandleNoMatchingNotificationRule();

      /*
       * Sending the operator after a notification method that already exists
       * wastes the one action the message is supposed to buy.
       */
      expect(lastStatusUpdate().data.statusMessage).toContain(
        "the fallback delivery attempt failed",
      );
      expect(lastStatusUpdate().data.statusMessage).not.toContain(
        "has no verified notification method",
      );
      expect(lastStatusUpdate().data.status).toBe(
        UserNotificationExecutionStatus.Error,
      );
    });

    test("a fallback that THREW still ends the log at Error, never at Executing", async () => {
      fallbackSpy.mockRejectedValue(new Error("smtp exploded") as never);

      await callHandleNoMatchingNotificationRule();

      /*
       * REGRESSION GUARD, and the reason this test exists at all: leaving the
       * log Executing here looks like the kind thing to do - "transient
       * failure, let the worker retry" - and it is a worse bug than the one it
       * avoids. Nothing re-enters this function; it runs once, from
       * onCreateSuccess, at the moment the row is written. So the next
       * ExecutePendingExecutions tick picks the log up, queries for due rules,
       * finds none (there were never any - that is why we are here), takes its
       * all-executed path and marks the log COMPLETED. onUpdateSuccess then
       * translates Completed into Notification Sent on the escalation timeline,
       * and within a minute the record reads "Alert Sent" for a page that was
       * never delivered.
       */
      expect(lastStatusUpdate().data.status).toBe(
        UserNotificationExecutionStatus.Error,
      );
      expect(lastStatusUpdate().data.status).not.toBe(
        UserNotificationExecutionStatus.Executing,
      );
      expect(timelineUpdates()[0]!.data.status).toBe(
        OnCallDutyExecutionLogTimelineStatus.Error,
      );
      expect(timelineUpdates()[0]!.data.statusMessage).toBe(
        lastStatusUpdate().data.statusMessage,
      );
    });

    test("a fallback that threw is contained: the escalation is not taken down with it", async () => {
      fallbackSpy.mockRejectedValue(new Error("smtp exploded") as never);

      /*
       * The caller is part-way through paging an entire escalation level. A
       * throw out of here would abort every responder queued behind this one.
       */
      await expect(
        callHandleNoMatchingNotificationRule(),
      ).resolves.toBeUndefined();
      expect(loggerErrorSpy).toHaveBeenCalled();
    });

    test("a fallback that threw still tells the humans", async () => {
      fallbackSpy.mockRejectedValue(new Error("smtp exploded") as never);

      await callHandleNoMatchingNotificationRule();

      expect(alertOwnersSpy).toHaveBeenCalledTimes(1);
      const alerted: UndeliverableAlertCall = alertOwnersSpy.mock
        .calls[0]![0] as UndeliverableAlertCall;
      expect(alerted.fallbackChannelsUsed).toEqual([]);
    });
  });

  describe("the owner alert is fire-and-forget", () => {
    test("a REJECTING notifyOfUndeliverablePage does not reject the paging path", async () => {
      alertOwnersSpy.mockRejectedValue(
        new Error("owner lookup exploded") as never,
      );

      /*
       * The alert is an explanation of a delivery problem. A bug in the
       * explanation must never propagate into - or delay - the paging path that
       * produced it.
       */
      await expect(
        callHandleNoMatchingNotificationRule(),
      ).resolves.toBeUndefined();

      await flushMicrotasks();

      // Swallowed into the log rather than lost silently.
      expect(loggerErrorSpy).toHaveBeenCalled();
    });

    test("a rejecting alert does not disturb the statuses that were already written", async () => {
      alertOwnersSpy.mockRejectedValue(
        new Error("owner lookup exploded") as never,
      );

      await callHandleNoMatchingNotificationRule();
      await flushMicrotasks();

      expect(lastStatusUpdate().data.status).toBe(
        UserNotificationExecutionStatus.Executing,
      );
      expect(timelineUpdates()[0]!.data.status).toBe(
        OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      );
    });

    test("the alert is NOT awaited - the paging path returns while it is still pending", async () => {
      let release: () => void = (): void => {
        return undefined;
      };
      const pending: Promise<void> = new Promise<void>(
        (resolve: () => void): void => {
          release = resolve;
        },
      );
      alertOwnersSpy.mockReturnValue(pending);

      /*
       * If the alert were awaited, this await would never settle and the test
       * would time out. Reaching the next line IS the assertion.
       */
      await callHandleNoMatchingNotificationRule();

      expect(alertOwnersSpy).toHaveBeenCalledTimes(1);

      release();
      await pending;
    });
  });

  describe("the writes the no-rule path makes", () => {
    test("the log is written before the on-call timeline", async () => {
      await callHandleNoMatchingNotificationRule();

      /*
       * Order matters: updateOneById's own onUpdateSuccess hook maps the
       * execution status onto the timeline, and the explicit second write is
       * what lets this path say something the mapping cannot - Skipped for an
       * opt-out, Notification Sent under an Executing log.
       */
      expect(logUpdateSpy.mock.invocationCallOrder[0]).toBeLessThan(
        timelineUpdateSpy.mock.invocationCallOrder[0] as number,
      );
    });

    test("exactly one log write and one timeline write, both as root", async () => {
      await callHandleNoMatchingNotificationRule();

      expect(statusUpdates()).toHaveLength(1);
      expect(timelineUpdates()).toHaveLength(1);
      expect(statusUpdates()[0]!.id.toString()).toBe(LOG_ID.toString());
      expect(statusUpdates()[0]!.props.isRoot).toBe(true);
      expect(timelineUpdates()[0]!.id.toString()).toBe(TIMELINE_ID.toString());
      expect(timelineUpdates()[0]!.props.isRoot).toBe(true);
    });

    test("the timeline never says the generic 'Alert Sent' on this path", async () => {
      await callHandleNoMatchingNotificationRule();

      /*
       * The normal path writes "Alert Sent". A fallback delivery deliberately
       * writes something an operator can act on instead, so it can never be
       * mistaken for a configured one.
       */
      expect(timelineUpdates()[0]!.data.statusMessage).not.toBe("Alert Sent");
    });
  });
});
