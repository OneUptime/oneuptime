import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import IncidentService from "../../../Server/Services/IncidentService";
import AlertService from "../../../Server/Services/AlertService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import MailService from "../../../Server/Services/MailService";
import SmsService from "../../../Server/Services/SmsService";
import CallService from "../../../Server/Services/CallService";
import WhatsAppService from "../../../Server/Services/WhatsAppService";
import TelegramService from "../../../Server/Services/TelegramService";
import WebhookService from "../../../Server/Services/WebhookService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import logger from "../../../Server/Utils/Logger";
import Incident from "../../../Models/DatabaseModels/Incident";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import BadDataException from "../../../Types/Exception/BadDataException";
import Email from "../../../Types/Email";
import Phone from "../../../Types/Phone";
import ObjectID from "../../../Types/ObjectID";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import EmailMessage from "../../../Types/Email/EmailMessage";
import SMS from "../../../Types/SMS/SMS";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * Phase 1 §2.1 split `executeNotificationRuleItem` in two. The public method
 * kept its signature and now does only what a rule ID implies — claim the
 * on-call log, load the rule, hand both to the delivery half — and everything
 * from the Twilio-config lookup downwards moved into a private
 * `deliverNotificationForRule(rule, options)`.
 *
 * The extraction exists so the on-call FALLBACK can reuse the delivery half
 * with a UserNotificationRule it assembled in memory and never saved: there is
 * no rule row to claim and no id to look up, so the first half is meaningless
 * to it while the second half is exactly what it needs. That makes the SEAM
 * between the two halves — not the seven channel blocks, which
 * NotificationChannelEventCoverage.test.ts owns — the thing worth pinning, and
 * this file pins five properties of it:
 *
 *   1. THE CLAIM IS STILL FIRST. The atomic claim (audit F7) is what stops two
 *      overlapping cron ticks double-paging one responder. A refactor that let
 *      the rule load drift above it, or that read `false` as "carry on", brings
 *      duplicate pages straight back — so a lost claim is asserted to stop the
 *      method before `findOneById` is even called, not merely before the send.
 *
 *   2. A MISSING RULE STILL THROWS. `BadDataException("Notification rule item
 *      not found.")` is what ExecutePendingExecutions turns into an `Error`
 *      log. Swallowing it during the split would leave the log stuck Executing
 *      forever.
 *
 *   3. THE SELECT SURVIVED INTACT. Every channel gate reads
 *      `<method>?.isVerified`, and an unselected column arrives as `undefined`.
 *      Dropping `isVerified` from this select therefore does NOT page
 *      unverified methods — it silences every VERIFIED one and writes "not
 *      verified" rows about perfectly verified phones. `userWebhook`'s
 *      `webhookUrl`/`name`/`secret` matter for the opposite reason: `secret`
 *      signs the outgoing request. The shape is asserted field by field.
 *
 *   4. THE RULE CROSSES THE SEAM UNCHANGED. The object `findOneById` returned
 *      and the caller's own options bag are handed to the delivery half by
 *      reference — no copy, no reshaping, nothing dropped on the way.
 *
 *   5. THE DELIVERY HALF STANDS ALONE. It can be driven directly with an
 *      UNSAVED, id-less rule and still writes a timeline row and dispatches.
 *      This is the regression guard for blocker B1: while
 *      `UserOnCallLogTimeline.userNotificationRuleId` was NOT NULL, every
 *      fallback delivery threw at the first `create()` — before a single page
 *      left the process — because an unsaved rule has no id to put there.
 *
 * Plus the one value the split had to keep hoisted: `projectTwilioConfig` is
 * resolved ONCE, inside the delivery half, from `options.projectId`, and handed
 * to the paid senders. Resolving it per channel would multiply a project-config
 * read by the number of channels; resolving it in the public half would leave
 * the fallback sending on the GLOBAL Twilio account.
 *
 * No database is touched. Every sender, every template generator and every
 * persistence call is a `jest.spyOn` stub, and the private delivery half is
 * reached through a cast, exactly as the neighbouring characterisation tests
 * reach protected hooks.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RULE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const LOG_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const INCIDENT_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const TEAM_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const POLICY_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const ESCALATION_RULE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const EXECUTION_LOG_TIMELINE_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const EMAIL_METHOD_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const SMS_METHOD_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const PUSH_METHOD_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);

const RESPONDER_EMAIL: string = "responder@company.com";
const RESPONDER_PHONE: string = "+11234567890";

/* The options bag both halves share, taken from the public signature. */
type ExecuteOptions = Parameters<
  typeof UserNotificationRuleService.executeNotificationRuleItem
>[1];

/* The `select` / `props` bundle handed to findOneById. */
interface FindOneByIdArg {
  id: ObjectID;
  select: JSONObject;
  props: { isRoot: boolean };
}

/*
 * `deliverNotificationForRule` is private, so TypeScript will not let a test
 * name it on the service. It is a perfectly ordinary prototype method at
 * runtime, and the fallback's whole design rests on it being callable with a
 * rule that was never persisted — so it is reached here through a structural
 * cast, the same trick the neighbouring files use for protected hooks.
 *
 * It returns whether a page was actually handed to a sender. That boolean is
 * NOT decoration: executeFallbackNotification reads it to decide which channel
 * names to tell the operator the responder was reached on.
 */
interface DeliveryHalf {
  deliverNotificationForRule: (
    notificationRuleItem: UserNotificationRule,
    options: ExecuteOptions,
  ) => Promise<boolean>;
}

function deliveryHalf(): DeliveryHalf {
  return UserNotificationRuleService as unknown as DeliveryHalf;
}

/*
 * The service mutates ONE UserOnCallLogTimeline instance per delivery call and
 * hands that same instance to create(), so mock.calls all alias its final
 * state. Snapshot the fields at call time instead; the raw instances are kept
 * separately, because "did two delivery calls build two distinct rows" is a
 * question only identity can answer.
 */
interface TimelineRow {
  status: UserNotificationStatus | undefined;
  statusMessage: string | undefined;
  userId: ObjectID | undefined;
  userNotificationRuleId: ObjectID | undefined;
  userNotificationLogId: ObjectID | undefined;
  projectId: ObjectID | undefined;
  userNotificationEventType: UserNotificationEventType | undefined;
  userEmailId: ObjectID | undefined;
  userSmsId: ObjectID | undefined;
  userPushId: ObjectID | undefined;
  triggeredByIncidentId: ObjectID | undefined;
  onCallDutyPolicyId: ObjectID | undefined;
  onCallDutyPolicyEscalationRuleId: ObjectID | undefined;
  userBelongsToTeamId: ObjectID | undefined;
}

function executeOptions(
  overrides: Partial<ExecuteOptions> = {},
): ExecuteOptions {
  return {
    projectId: PROJECT_ID,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    triggeredByIncidentId: INCIDENT_ID,
    onCallPolicyId: POLICY_ID,
    onCallPolicyEscalationRuleId: ESCALATION_RULE_ID,
    userBelongsToTeamId: TEAM_ID,
    onCallDutyPolicyExecutionLogTimelineId: EXECUTION_LOG_TIMELINE_ID,
    userNotificationLogId: LOG_ID,
    ...overrides,
  };
}

/*
 * A rule as findOneById hands it back: hydrated, and carrying the `_id` of the
 * row it was read from.
 */
function loadedRule(channels: JSONObject = {}): UserNotificationRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    userId: USER_ID,
    ...channels,
  } as unknown as UserNotificationRule;
}

/*
 * A rule as the FALLBACK builds it: a real model instance with no `_id`, so
 * `.id` is genuinely null, assembled from the user's verified methods and
 * never saved. Real model classes are used rather than object literals
 * precisely because `id` is a getter over `_id` — a literal would fake the one
 * property this half of the file is about.
 */
function unsavedFallbackRule(): UserNotificationRule {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule.projectId = PROJECT_ID;
  rule.userId = USER_ID;
  rule.ruleType = NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
  rule.notifyAfterMinutes = 0;

  return rule;
}

function verifiedUserEmail(): UserEmail {
  const userEmail: UserEmail = new UserEmail();
  userEmail._id = EMAIL_METHOD_ID.toString();
  userEmail.email = new Email(RESPONDER_EMAIL);
  userEmail.isVerified = true;

  return userEmail;
}

function verifiedUserSms(): UserSMS {
  const userSms: UserSMS = new UserSMS();
  userSms._id = SMS_METHOD_ID.toString();
  userSms.phone = new Phone(RESPONDER_PHONE);
  userSms.isVerified = true;

  return userSms;
}

function verifiedUserPush(): UserPush {
  const userPush: UserPush = new UserPush();
  userPush._id = PUSH_METHOD_ID.toString();
  userPush.deviceToken = "device-token";
  userPush.deviceType = PushDeviceType.iOS;
  userPush.isVerified = true;

  return userPush;
}

function fakeIncident(): Incident {
  return {
    id: INCIDENT_ID,
    projectId: PROJECT_ID,
    title: "Checkout is down",
    description: "Checkout returns 500 for every request.",
    incidentNumber: 42,
    incidentNumberWithPrefix: "INC-42",
  } as unknown as Incident;
}

function fakeTwilioConfig(): TwilioConfig {
  return {
    accountSid: "AC-project-account",
    authToken: "project-auth-token",
    primaryPhoneNumber: new Phone("+15550001111"),
    secondaryPhoneNumbers: [],
  };
}

/* Every stub the two halves touch, so no test can reach a real service. */
interface Spies {
  claim: jest.SpyInstance;
  findRule: jest.SpyInstance;
  createRule: jest.SpyInstance;
  twilio: jest.SpyInstance;
  timelineCreate: jest.SpyInstance;
  timelineUpdate: jest.SpyInstance;
  incidentFind: jest.SpyInstance;
  incidentLink: jest.SpyInstance;
  alertFind: jest.SpyInstance;
  alertEpisodeFind: jest.SpyInstance;
  incidentEpisodeFind: jest.SpyInstance;
  mail: jest.SpyInstance;
  sms: jest.SpyInstance;
  call: jest.SpyInstance;
  whatsApp: jest.SpyInstance;
  telegram: jest.SpyInstance;
  webhook: jest.SpyInstance;
  push: jest.SpyInstance;
  emailTemplate: jest.SpyInstance;
  smsTemplate: jest.SpyInstance;
}

describe("UserNotificationRuleService - the deliverNotificationForRule extraction", () => {
  let spies: Spies;
  let timelineRows: Array<TimelineRow>;
  let timelineInstances: Array<UserOnCallLogTimeline>;

  beforeEach(() => {
    timelineRows = [];
    timelineInstances = [];

    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });

    const timelineCreate: jest.SpyInstance = jest.spyOn(
      UserOnCallLogTimelineService,
      "create",
    );
    timelineCreate.mockImplementation(
      (createBy: unknown): Promise<UserOnCallLogTimeline> => {
        const data: UserOnCallLogTimeline = (
          createBy as { data: UserOnCallLogTimeline }
        ).data;

        timelineInstances.push(data);
        timelineRows.push({
          status: data.status,
          statusMessage: data.statusMessage,
          userId: data.userId,
          userNotificationRuleId: data.userNotificationRuleId,
          userNotificationLogId: data.userNotificationLogId,
          projectId: data.projectId,
          userNotificationEventType: data.userNotificationEventType,
          userEmailId: data.userEmailId,
          userSmsId: data.userSmsId,
          userPushId: data.userPushId,
          triggeredByIncidentId: data.triggeredByIncidentId,
          onCallDutyPolicyId: data.onCallDutyPolicyId,
          onCallDutyPolicyEscalationRuleId:
            data.onCallDutyPolicyEscalationRuleId,
          userBelongsToTeamId: data.userBelongsToTeamId,
        });

        return Promise.resolve({
          id: TIMELINE_ID,
        } as unknown as UserOnCallLogTimeline);
      },
    );

    spies = {
      claim: jest
        .spyOn(UserOnCallLogService, "claimNotificationRuleExecution")
        .mockResolvedValue(true as never),
      findRule: jest
        .spyOn(UserNotificationRuleService, "findOneById")
        .mockResolvedValue(loadedRule() as never),
      createRule: jest
        .spyOn(UserNotificationRuleService, "create")
        .mockResolvedValue(loadedRule() as never),
      twilio: jest
        .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
        .mockResolvedValue(undefined as never),
      timelineCreate: timelineCreate,
      timelineUpdate: jest
        .spyOn(UserOnCallLogTimelineService, "updateOneById")
        .mockResolvedValue(undefined as never),
      incidentFind: jest
        .spyOn(IncidentService, "findOneById")
        .mockResolvedValue(fakeIncident() as never),
      incidentLink: jest
        .spyOn(IncidentService, "getIncidentLinkInDashboard")
        .mockResolvedValue(
          URL.fromString("https://dashboard.example.com/incident") as never,
        ),
      alertFind: jest
        .spyOn(AlertService, "findOneById")
        .mockResolvedValue(null as never),
      alertEpisodeFind: jest
        .spyOn(AlertEpisodeService, "findOneById")
        .mockResolvedValue(null as never),
      incidentEpisodeFind: jest
        .spyOn(IncidentEpisodeService, "findOneById")
        .mockResolvedValue(null as never),
      mail: jest
        .spyOn(MailService, "sendMail")
        .mockResolvedValue(undefined as never),
      sms: jest
        .spyOn(SmsService, "sendSms")
        .mockResolvedValue(undefined as never),
      call: jest
        .spyOn(CallService, "makeCall")
        .mockResolvedValue(undefined as never),
      whatsApp: jest
        .spyOn(WhatsAppService, "sendWhatsAppMessage")
        .mockResolvedValue(undefined as never),
      telegram: jest
        .spyOn(TelegramService, "sendTelegramMessage")
        .mockResolvedValue(undefined as never),
      webhook: jest
        .spyOn(WebhookService, "sendWebhook")
        .mockResolvedValue(undefined as never),
      push: jest
        .spyOn(PushNotificationService, "sendPushNotification")
        .mockResolvedValue(undefined as never),
      emailTemplate: jest
        .spyOn(
          UserNotificationRuleService,
          "generateEmailTemplateForIncidentCreated",
        )
        .mockResolvedValue({} as EmailMessage as never),
      smsTemplate: jest
        .spyOn(
          UserNotificationRuleService,
          "generateSmsTemplateForIncidentCreated",
        )
        .mockResolvedValue({} as SMS as never),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function everySender(): Array<jest.SpyInstance> {
    return [
      spies.mail,
      spies.sms,
      spies.call,
      spies.whatsApp,
      spies.telegram,
      spies.webhook,
      spies.push,
    ];
  }

  /*
   * Replace the delivery half so the public half can be observed on its own.
   * Installed per test rather than in beforeEach, because the sections below
   * that drive the delivery half directly need the REAL implementation.
   */
  function stubDeliveryHalf(): jest.SpyInstance {
    return jest
      .spyOn(deliveryHalf(), "deliverNotificationForRule")
      .mockResolvedValue(true as never);
  }

  /* The second argument SmsService.sendSms was handed. */
  function sentSmsOptions(): {
    customTwilioConfig: TwilioConfig | undefined;
  } {
    return spies.sms.mock.calls[0]![1] as {
      customTwilioConfig: TwilioConfig | undefined;
    };
  }

  /*
   * ----------------------------------------------------------------------- *
   * (A) The claim still runs, and still runs FIRST.
   * -----------------------------------------------------------------------
   */

  describe("the public half still claims before it loads anything", () => {
    test("a lost claim returns before findOneById is called at all", async () => {
      spies.claim.mockResolvedValue(false as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(spies.claim).toHaveBeenCalledTimes(1);
      /*
       * The point of F7. Short-circuiting merely before the SEND would still
       * let two ticks race on the read; the gate has to be above the read.
       */
      expect(spies.findRule).not.toHaveBeenCalled();
    });

    test("a lost claim never reaches the delivery half", async () => {
      const deliver: jest.SpyInstance = stubDeliveryHalf();
      spies.claim.mockResolvedValue(false as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(deliver).not.toHaveBeenCalled();
    });

    test("a lost claim sends nothing and writes no timeline row", async () => {
      spies.claim.mockResolvedValue(false as never);
      spies.findRule.mockResolvedValue(
        loadedRule({
          userEmail: verifiedUserEmail(),
        } as unknown as JSONObject) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      for (const sender of everySender()) {
        expect(sender).not.toHaveBeenCalled();
      }
      expect(spies.timelineCreate).not.toHaveBeenCalled();
      expect(spies.timelineUpdate).not.toHaveBeenCalled();
    });

    test("a lost claim skips the Twilio config and the incident lookup too", async () => {
      spies.claim.mockResolvedValue(false as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(spies.twilio).not.toHaveBeenCalled();
      expect(spies.incidentFind).not.toHaveBeenCalled();
    });

    test("a lost claim RESOLVES - it is a normal outcome, not bad data", async () => {
      spies.claim.mockResolvedValue(false as never);

      /*
       * ExecutePendingExecutions marks a log Error on BadDataException. A
       * duplicate suppressed by the claim is not an error, so this path must
       * resolve quietly or every suppressed duplicate burns its on-call log.
       */
      await expect(
        UserNotificationRuleService.executeNotificationRuleItem(
          RULE_ID,
          executeOptions(),
        ),
      ).resolves.toBeUndefined();
    });

    test("the claim names this on-call log and this rule", async () => {
      spies.claim.mockResolvedValue(false as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions({ userNotificationLogId: LOG_ID }),
      );

      const claimArg: {
        userOnCallLogId: ObjectID;
        userNotificationRuleId: ObjectID;
      } = spies.claim.mock.calls[0]![0] as {
        userOnCallLogId: ObjectID;
        userNotificationRuleId: ObjectID;
      };
      expect(claimArg.userOnCallLogId.toString()).toBe(LOG_ID.toString());
      expect(claimArg.userNotificationRuleId.toString()).toBe(
        RULE_ID.toString(),
      );
    });

    test("the claim strictly PRECEDES the rule load, which precedes the delivery half", async () => {
      const deliver: jest.SpyInstance = stubDeliveryHalf();

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(spies.claim.mock.invocationCallOrder[0]).toBeLessThan(
        spies.findRule.mock.invocationCallOrder[0] as number,
      );
      expect(spies.findRule.mock.invocationCallOrder[0]).toBeLessThan(
        deliver.mock.invocationCallOrder[0] as number,
      );
    });

    test("a claim that rejects propagates and nothing is loaded or delivered", async () => {
      const deliver: jest.SpyInstance = stubDeliveryHalf();
      spies.claim.mockRejectedValue(new Error("db connection reset") as never);

      await expect(
        UserNotificationRuleService.executeNotificationRuleItem(
          RULE_ID,
          executeOptions(),
        ),
      ).rejects.toThrow("db connection reset");

      expect(spies.findRule).not.toHaveBeenCalled();
      expect(deliver).not.toHaveBeenCalled();
    });

    test("a held claim lets execution proceed, and the rule is read exactly once", async () => {
      stubDeliveryHalf();

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(spies.claim).toHaveBeenCalledTimes(1);
      expect(spies.findRule).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (B) A rule id that resolves to nothing.
   * -----------------------------------------------------------------------
   */

  describe("a rule id that resolves to nothing", () => {
    test('still throws BadDataException("Notification rule item not found.")', async () => {
      spies.findRule.mockResolvedValue(null as never);

      await expect(
        UserNotificationRuleService.executeNotificationRuleItem(
          RULE_ID,
          executeOptions(),
        ),
      ).rejects.toThrow(BadDataException);

      await expect(
        UserNotificationRuleService.executeNotificationRuleItem(
          RULE_ID,
          executeOptions(),
        ),
      ).rejects.toThrow("Notification rule item not found.");
    });

    test("the delivery half is never entered on a missing rule", async () => {
      const deliver: jest.SpyInstance = stubDeliveryHalf();
      spies.findRule.mockResolvedValue(null as never);

      await expect(
        UserNotificationRuleService.executeNotificationRuleItem(
          RULE_ID,
          executeOptions(),
        ),
      ).rejects.toThrow(BadDataException);

      expect(deliver).not.toHaveBeenCalled();
    });

    test("the throw beats the Twilio config, the incident lookup and any timeline row", async () => {
      spies.findRule.mockResolvedValue(null as never);

      await expect(
        UserNotificationRuleService.executeNotificationRuleItem(
          RULE_ID,
          executeOptions(),
        ),
      ).rejects.toThrow(BadDataException);

      expect(spies.twilio).not.toHaveBeenCalled();
      expect(spies.incidentFind).not.toHaveBeenCalled();
      expect(spies.timelineCreate).not.toHaveBeenCalled();
      for (const sender of everySender()) {
        expect(sender).not.toHaveBeenCalled();
      }
    });

    test("the claim has ALREADY been consumed when the rule turns out to be missing", async () => {
      spies.findRule.mockResolvedValue(null as never);

      await expect(
        UserNotificationRuleService.executeNotificationRuleItem(
          RULE_ID,
          executeOptions(),
        ),
      ).rejects.toThrow(BadDataException);

      /*
       * Pinned as current behaviour, unchanged by the split: the claim is
       * written before the rule is read, so a rule deleted between scheduling
       * and execution burns its claim and no later tick retries it. Deliberate
       * (a missing rule is permanent), but it means the claim is not released.
       */
      expect(spies.claim).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (C) The select the public half still passes.
   * -----------------------------------------------------------------------
   */

  describe("the select handed to findOneById", () => {
    async function captureFindArg(): Promise<FindOneByIdArg> {
      stubDeliveryHalf();

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      return spies.findRule.mock.calls[0]![0] as FindOneByIdArg;
    }

    test("targets the requested rule id, as root", async () => {
      const arg: FindOneByIdArg = await captureFindArg();

      expect(arg.id.toString()).toBe(RULE_ID.toString());
      expect(arg.props.isRoot).toBe(true);
    });

    test("is EXACTLY this shape - a field lost in the split changes who gets paged", async () => {
      const arg: FindOneByIdArg = await captureFindArg();

      /*
       * WHY EACH RELATION ALSO ASKS FOR ITS OWN userId, WHICH NO SENDER READS.
       *
       * A rule is a pair of columns that nothing in the ORM ever compares: its
       * `userId` decides WHOSE page this is, and the method relation decides
       * WHERE that page is delivered. A row where those two name different
       * people routes one person's pages to another person's address, and it is
       * invisible from both ends - the rules page still lists a rule and the
       * on-call log still records a delivered notification.
       *
       * The write-side guards refuse to SAVE such a row. This select is what
       * lets executeNotificationRuleItem refuse to ACT ON one that exists
       * anyway: written before those guards landed, written by internal code
       * running as root, or written down a path a future change forgets to
       * route through them. getNotificationMethodsNotOwnedByRuleOwner compares
       * the loaded relation's userId against the rule's, and it can only report
       * a mismatch it can SEE - an unselected column arrives as `undefined` and
       * is deliberately read as "no evidence", so dropping any one of these
       * seven silently disables the backstop for that channel.
       *
       * Kept as an exact-shape assertion on purpose. This test caught the
       * column being added, which is the whole argument for not relaxing it
       * into a partial match: the select is a contract about who gets paged,
       * and every future edit to it should have to come through here.
       */
      expect(arg.select).toEqual({
        _id: true,
        userId: true,
        userCall: {
          phone: true,
          isVerified: true,
          userId: true,
        },
        userSms: {
          phone: true,
          isVerified: true,
          userId: true,
        },
        userWhatsApp: {
          phone: true,
          isVerified: true,
          userId: true,
        },
        userTelegram: {
          telegramChatId: true,
          telegramUserHandle: true,
          isVerified: true,
          userId: true,
        },
        userWebhook: {
          webhookUrl: true,
          name: true,
          secret: true,
          userId: true,
        },
        userEmail: {
          email: true,
          isVerified: true,
          userId: true,
        },
        userPush: {
          deviceToken: true,
          deviceType: true,
          isVerified: true,
          userId: true,
        },
      });
    });

    test.each<[string]>([
      ["userCall"],
      ["userSms"],
      ["userWhatsApp"],
      ["userTelegram"],
      ["userEmail"],
      ["userPush"],
    ])(
      "%s requests isVerified - every user-contactable channel is verification-gated",
      async (channel: string) => {
        const arg: FindOneByIdArg = await captureFindArg();
        const selected: JSONObject = arg.select[channel] as JSONObject;

        expect(selected).toBeDefined();
        expect(selected["isVerified"]).toBe(true);
      },
    );

    test.each<[string, string]>([
      ["userCall", "phone"],
      ["userSms", "phone"],
      ["userWhatsApp", "phone"],
      ["userTelegram", "telegramChatId"],
      ["userEmail", "email"],
      ["userPush", "deviceToken"],
    ])(
      "%s also requests its address column (%s), which the send gate reads alongside isVerified",
      async (channel: string, addressColumn: string) => {
        const arg: FindOneByIdArg = await captureFindArg();
        const selected: JSONObject = arg.select[channel] as JSONObject;

        expect(selected[addressColumn]).toBe(true);
      },
    );

    test("userWebhook requests webhookUrl, name and secret - and no isVerified", async () => {
      const arg: FindOneByIdArg = await captureFindArg();
      const webhookSelect: JSONObject = arg.select["userWebhook"] as JSONObject;

      /*
       * Webhooks are the one user-contactable channel with no verification
       * concept at all (UserWebhook has no isVerified column), so the delivery
       * gate is `webhookUrl` alone. `secret` is not cosmetic: it signs the
       * outgoing request, so an unselected secret ships UNSIGNED webhooks.
       *
       * `userId` is not read by the webhook sender either. It is the
       * defence-in-depth column described on the exact-shape assertion above -
       * the one the pre-delivery ownership check compares against the rule's
       * own userId - and webhooks are the channel where a hijacked method
       * matters most, because the attacker chooses the endpoint outright.
       */
      expect(webhookSelect).toEqual({
        webhookUrl: true,
        name: true,
        secret: true,
        userId: true,
      });
      expect(webhookSelect["isVerified"]).toBeUndefined();
    });

    test("userId is selected - the timeline row and every sender stamp it", async () => {
      const arg: FindOneByIdArg = await captureFindArg();

      expect(arg.select["userId"]).toBe(true);
      expect(arg.select["_id"]).toBe(true);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (D) The seam itself: what crosses from one half to the other.
   * -----------------------------------------------------------------------
   */

  describe("the seam between the two halves", () => {
    test("the delivery half is entered exactly once per execution", async () => {
      const deliver: jest.SpyInstance = stubDeliveryHalf();

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(deliver).toHaveBeenCalledTimes(1);
    });

    test("the rule object findOneById returned is handed over BY REFERENCE, unchanged", async () => {
      const rule: UserNotificationRule = loadedRule({
        userEmail: verifiedUserEmail(),
      } as unknown as JSONObject);
      spies.findRule.mockResolvedValue(rule as never);
      const deliver: jest.SpyInstance = stubDeliveryHalf();

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      /*
       * Identity, not shape. A copy would be a real regression: the channel
       * blocks read hydrated RELATIONS (userEmail.email, userEmail.isVerified),
       * and any reshaping on the way across is exactly how a relation turns
       * into a bare FK and a verified responder stops being contactable.
       */
      expect(deliver.mock.calls[0]![0]).toBe(rule);
    });

    test("the caller's options bag is handed over BY REFERENCE, unchanged", async () => {
      const options: ExecuteOptions = executeOptions();
      const deliver: jest.SpyInstance = stubDeliveryHalf();

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        options,
      );

      expect(deliver.mock.calls[0]![1]).toBe(options);
    });

    test("the public half itself does no delivery work - it is all beyond the seam", async () => {
      stubDeliveryHalf();

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      /*
       * With the delivery half stubbed out, NOTHING should be left running in
       * the public method: no Twilio config, no trigger-entity lookup, no
       * timeline row, no send. If any of these fire, part of the body was left
       * behind on the claim-and-load side, where the fallback cannot reuse it.
       */
      expect(spies.twilio).not.toHaveBeenCalled();
      expect(spies.incidentFind).not.toHaveBeenCalled();
      expect(spies.alertFind).not.toHaveBeenCalled();
      expect(spies.alertEpisodeFind).not.toHaveBeenCalled();
      expect(spies.incidentEpisodeFind).not.toHaveBeenCalled();
      expect(spies.timelineCreate).not.toHaveBeenCalled();
      for (const sender of everySender()) {
        expect(sender).not.toHaveBeenCalled();
      }
    });

    test("the public method still resolves to undefined - the delivery boolean is swallowed", async () => {
      const deliver: jest.SpyInstance = stubDeliveryHalf();
      deliver.mockResolvedValue(false as never);

      /*
       * The delivery half reports whether anything was dispatched, and the
       * fallback branches on that. The rule-driven path deliberately does not:
       * its signature is Promise<void> and callers await it for sequencing
       * only. Returning the boolean here would be a public-API change.
       */
      await expect(
        UserNotificationRuleService.executeNotificationRuleItem(
          RULE_ID,
          executeOptions(),
        ),
      ).resolves.toBeUndefined();
    });

    test("a throwing delivery half propagates out of the public method", async () => {
      const deliver: jest.SpyInstance = stubDeliveryHalf();
      deliver.mockRejectedValue(
        new BadDataException(
          "Incident, Alert, Alert Episode, or Incident Episode not found.",
        ) as never,
      );

      /*
       * The delivery half is AWAITED, not fired and forgotten. That is what
       * lets ExecutePendingExecutions turn a missing trigger entity into an
       * Error on the log instead of an unhandled rejection.
       */
      await expect(
        UserNotificationRuleService.executeNotificationRuleItem(
          RULE_ID,
          executeOptions(),
        ),
      ).rejects.toThrow(
        "Incident, Alert, Alert Episode, or Incident Episode not found.",
      );
    });

    test("end to end, unstubbed, the rule loaded by id still reaches a sender", async () => {
      spies.findRule.mockResolvedValue(
        loadedRule({
          userEmail: verifiedUserEmail(),
        } as unknown as JSONObject) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(spies.mail).toHaveBeenCalledTimes(1);
      expect(timelineRows).toHaveLength(1);
      expect(timelineRows[0]?.status).toBe(UserNotificationStatus.Sending);
      expect(timelineRows[0]?.statusMessage).toContain(RESPONDER_EMAIL);
      // A rule that DOES have an id still stamps it on the timeline row.
      expect(timelineRows[0]?.userNotificationRuleId?.toString()).toBe(
        RULE_ID.toString(),
      );
      expect(timelineRows[0]?.userEmailId?.toString()).toBe(
        EMAIL_METHOD_ID.toString(),
      );
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (E) The delivery half driven directly with an UNSAVED rule.
   *
   * This is what the fallback does, and it is the regression guard for
   * blocker B1.
   * -----------------------------------------------------------------------
   */

  describe("the delivery half accepts an unsaved, id-less rule", () => {
    test("the rule the fallback builds really has no id", () => {
      const rule: UserNotificationRule = unsavedFallbackRule();

      /*
       * Guarding the guard. `id` is a getter over `_id`, so a rule that was
       * never saved reports null - and every assertion below about the
       * timeline row depends on that actually being the case.
       */
      expect(rule.id).toBeNull();
      expect(rule._id).toBeUndefined();
    });

    test("an id-less email rule still writes a timeline row and dispatches", async () => {
      const rule: UserNotificationRule = unsavedFallbackRule();
      rule.userEmail = verifiedUserEmail();
      rule.userEmailId = EMAIL_METHOD_ID;

      const dispatched: boolean =
        await deliveryHalf().deliverNotificationForRule(rule, executeOptions());

      /*
       * BLOCKER B1. UserOnCallLogTimeline.userNotificationRuleId used to be
       * NOT NULL, so this create() threw for every fallback delivery - before
       * a single page left the process. The column is nullable now and
       * buildLogTimelineItem only sets the id when the rule has one.
       */
      expect(dispatched).toBe(true);
      expect(timelineRows).toHaveLength(1);
      expect(timelineRows[0]?.userNotificationRuleId).toBeUndefined();
      expect(timelineRows[0]?.status).toBe(UserNotificationStatus.Sending);
      expect(timelineRows[0]?.statusMessage).toContain(RESPONDER_EMAIL);
      expect(spies.mail).toHaveBeenCalledTimes(1);
    });

    test("the id-less row still carries everything a reader needs", async () => {
      const rule: UserNotificationRule = unsavedFallbackRule();
      rule.userEmail = verifiedUserEmail();
      rule.userEmailId = EMAIL_METHOD_ID;

      await deliveryHalf().deliverNotificationForRule(rule, executeOptions());

      /*
       * Losing the rule id must not quietly cost the row its other anchors -
       * an operator opening the on-call timeline has to see which log, which
       * user, which escalation and which incident this page belonged to.
       */
      expect(timelineRows[0]?.userId?.toString()).toBe(USER_ID.toString());
      expect(timelineRows[0]?.projectId?.toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(timelineRows[0]?.userNotificationLogId?.toString()).toBe(
        LOG_ID.toString(),
      );
      expect(timelineRows[0]?.userNotificationEventType).toBe(
        UserNotificationEventType.IncidentCreated,
      );
      expect(timelineRows[0]?.triggeredByIncidentId?.toString()).toBe(
        INCIDENT_ID.toString(),
      );
      expect(timelineRows[0]?.onCallDutyPolicyId?.toString()).toBe(
        POLICY_ID.toString(),
      );
      expect(
        timelineRows[0]?.onCallDutyPolicyEscalationRuleId?.toString(),
      ).toBe(ESCALATION_RULE_ID.toString());
      expect(timelineRows[0]?.userBelongsToTeamId?.toString()).toBe(
        TEAM_ID.toString(),
      );
      // The method FK is read off the RELATION, which is all the fallback sets.
      expect(timelineRows[0]?.userEmailId?.toString()).toBe(
        EMAIL_METHOD_ID.toString(),
      );
    });

    test("an id-less push rule dispatches too - push is the fallback's first choice", async () => {
      const rule: UserNotificationRule = unsavedFallbackRule();
      rule.userPush = verifiedUserPush();
      rule.userPushId = PUSH_METHOD_ID;

      const dispatched: boolean =
        await deliveryHalf().deliverNotificationForRule(rule, executeOptions());

      expect(dispatched).toBe(true);
      expect(spies.push).toHaveBeenCalledTimes(1);
      expect(timelineRows).toHaveLength(1);
      expect(timelineRows[0]?.userNotificationRuleId).toBeUndefined();
      expect(timelineRows[0]?.userPushId?.toString()).toBe(
        PUSH_METHOD_ID.toString(),
      );
    });

    test("driving the delivery half directly claims nothing and loads no rule", async () => {
      const rule: UserNotificationRule = unsavedFallbackRule();
      rule.userEmail = verifiedUserEmail();
      rule.userEmailId = EMAIL_METHOD_ID;

      await deliveryHalf().deliverNotificationForRule(rule, executeOptions());

      /*
       * The two things the public half does are exactly the two things a
       * rule with no database row cannot do. If either had been left inside
       * the delivery half, the fallback would try to claim a rule id it does
       * not have and read a row that does not exist.
       */
      expect(spies.claim).not.toHaveBeenCalled();
      expect(spies.findRule).not.toHaveBeenCalled();
    });

    test("the unsaved rule is never persisted on the way through", async () => {
      const rule: UserNotificationRule = unsavedFallbackRule();
      rule.userEmail = verifiedUserEmail();
      rule.userEmailId = EMAIL_METHOD_ID;

      await deliveryHalf().deliverNotificationForRule(rule, executeOptions());

      /*
       * The user never asked for this rule. Saving it would silently rewrite
       * their notification configuration behind their back, and the next real
       * page would match a rule they did not create.
       */
      expect(spies.createRule).not.toHaveBeenCalled();
      expect(rule.id).toBeNull();
    });

    test("two delivery calls build two DISTINCT timeline instances", async () => {
      const pushRule: UserNotificationRule = unsavedFallbackRule();
      pushRule.userPush = verifiedUserPush();
      pushRule.userPushId = PUSH_METHOD_ID;

      const emailRule: UserNotificationRule = unsavedFallbackRule();
      emailRule.userEmail = verifiedUserEmail();
      emailRule.userEmailId = EMAIL_METHOD_ID;

      await deliveryHalf().deliverNotificationForRule(
        pushRule,
        executeOptions(),
      );
      await deliveryHalf().deliverNotificationForRule(
        emailRule,
        executeOptions(),
      );

      /*
       * Why the fallback calls this once PER CHANNEL with a freshly built
       * rule instead of looping channels inside one call: the timeline item is
       * a single mutable instance per call, and after the first create() it
       * carries an _id - so a second create() with the SAME instance UPDATEs
       * the row the first channel wrote instead of inserting a second one. Two
       * calls means two instances, which is what keeps the second page
       * visible.
       */
      expect(timelineInstances).toHaveLength(2);
      expect(timelineInstances[0]).not.toBe(timelineInstances[1]);
      expect(spies.push).toHaveBeenCalledTimes(1);
      expect(spies.mail).toHaveBeenCalledTimes(1);
    });

    test("an id-less rule with no contactable method dispatches nothing and returns false", async () => {
      const rule: UserNotificationRule = unsavedFallbackRule();

      const dispatched: boolean =
        await deliveryHalf().deliverNotificationForRule(rule, executeOptions());

      /*
       * The return value is the fallback's only evidence. "Resolved without
       * throwing" is NOT "paged": a false here is what stops the operator
       * being told the responder was reached on a channel that sent nothing.
       */
      expect(dispatched).toBe(false);
      for (const sender of everySender()) {
        expect(sender).not.toHaveBeenCalled();
      }
      expect(timelineRows).toHaveLength(0);
    });

    test("an id-less rule whose method is UNVERIFIED is not contacted", async () => {
      const rule: UserNotificationRule = unsavedFallbackRule();
      const userEmail: UserEmail = verifiedUserEmail();
      userEmail.isVerified = false;
      rule.userEmail = userEmail;
      rule.userEmailId = EMAIL_METHOD_ID;

      const dispatched: boolean =
        await deliveryHalf().deliverNotificationForRule(rule, executeOptions());

      /*
       * The verification gates are inside the delivery half, so they apply to
       * the fallback exactly as they apply to a configured rule. A fallback
       * that could page unverified addresses would be a way to send mail to an
       * address nobody proved they own.
       */
      expect(dispatched).toBe(false);
      expect(spies.mail).not.toHaveBeenCalled();
      expect(timelineRows).toHaveLength(1);
      expect(timelineRows[0]?.status).toBe(UserNotificationStatus.Error);
      expect(timelineRows[0]?.statusMessage).toContain("not verified");
    });

    test("a missing trigger entity still throws, even for an id-less rule", async () => {
      spies.incidentFind.mockResolvedValue(null as never);

      const rule: UserNotificationRule = unsavedFallbackRule();
      rule.userEmail = verifiedUserEmail();
      rule.userEmailId = EMAIL_METHOD_ID;

      await expect(
        deliveryHalf().deliverNotificationForRule(rule, executeOptions()),
      ).rejects.toThrow(
        "Incident, Alert, Alert Episode, or Incident Episode not found.",
      );

      expect(spies.mail).not.toHaveBeenCalled();
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (F) projectTwilioConfig: resolved once, in the delivery half.
   * -----------------------------------------------------------------------
   */

  describe("the project Twilio config", () => {
    test("is resolved exactly once per delivery, from options.projectId", async () => {
      const options: ExecuteOptions = executeOptions();
      spies.findRule.mockResolvedValue(
        loadedRule({
          userSms: verifiedUserSms(),
        } as unknown as JSONObject) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        options,
      );

      expect(spies.twilio).toHaveBeenCalledTimes(1);
      /*
       * Identity against the caller's own projectId. The channel blocks below
       * pass the TRIGGER entity's projectId to the senders, so reading the
       * config off the incident instead of the options would look identical in
       * every normal case and diverge only in the odd one.
       */
      expect(spies.twilio.mock.calls[0]![0]).toBe(options.projectId);
    });

    test("is resolved AFTER the rule is loaded and BEFORE any timeline row or send", async () => {
      spies.findRule.mockResolvedValue(
        loadedRule({
          userSms: verifiedUserSms(),
        } as unknown as JSONObject) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      /*
       * The ordering IS the extraction boundary: the config lookup was the
       * first statement of the old body's second half, and it has to stay on
       * the delivery side or the fallback never sees it.
       */
      expect(spies.findRule.mock.invocationCallOrder[0]).toBeLessThan(
        spies.twilio.mock.invocationCallOrder[0] as number,
      );
      expect(spies.twilio.mock.invocationCallOrder[0]).toBeLessThan(
        spies.timelineCreate.mock.invocationCallOrder[0] as number,
      );
      expect(spies.twilio.mock.invocationCallOrder[0]).toBeLessThan(
        spies.sms.mock.invocationCallOrder[0] as number,
      );
    });

    test("the resolved config object reaches SmsService.sendSms by reference", async () => {
      const twilioConfig: TwilioConfig = fakeTwilioConfig();
      spies.twilio.mockResolvedValue(twilioConfig as never);
      spies.findRule.mockResolvedValue(
        loadedRule({
          userSms: verifiedUserSms(),
        } as unknown as JSONObject) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(spies.sms).toHaveBeenCalledTimes(1);
      /*
       * A project with its own Twilio account must be billed on that account.
       * Dropping this key does not fail - it quietly sends every on-call SMS
       * from the global OneUptime number.
       */
      expect(sentSmsOptions().customTwilioConfig).toBe(twilioConfig);
    });

    test("no project config resolves to undefined and is still passed through", async () => {
      spies.twilio.mockResolvedValue(undefined as never);
      spies.findRule.mockResolvedValue(
        loadedRule({
          userSms: verifiedUserSms(),
        } as unknown as JSONObject) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      // undefined is the signal for "use the global config", not a bug.
      expect(sentSmsOptions().customTwilioConfig).toBeUndefined();
    });

    test("a fallback-style delivery resolves the PROJECT's config too", async () => {
      const twilioConfig: TwilioConfig = fakeTwilioConfig();
      spies.twilio.mockResolvedValue(twilioConfig as never);

      const rule: UserNotificationRule = unsavedFallbackRule();
      rule.userSms = verifiedUserSms();
      rule.userSmsId = SMS_METHOD_ID;

      const options: ExecuteOptions = executeOptions();
      await deliveryHalf().deliverNotificationForRule(rule, options);

      /*
       * The fallback picks a paid channel only when the responder has no
       * zero-cost method, so when it does reach SMS the project's own Twilio
       * account is the one that must be charged.
       */
      expect(spies.twilio).toHaveBeenCalledTimes(1);
      expect(spies.twilio.mock.calls[0]![0]).toBe(options.projectId);
      expect(sentSmsOptions().customTwilioConfig).toBe(twilioConfig);
    });

    test("it is hoisted above the channel blocks - two channels, still one lookup", async () => {
      /*
       * A rule with two methods is not something the product creates (a rule
       * carries exactly one), and the fallback deliberately never builds one -
       * see the distinct-instances test above for why. It is used HERE only to
       * prove the config read sits above the channel blocks rather than inside
       * them: were it per-block, this would be two reads.
       */
      spies.findRule.mockResolvedValue(
        loadedRule({
          userEmail: verifiedUserEmail(),
          userSms: verifiedUserSms(),
        } as unknown as JSONObject) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(spies.mail).toHaveBeenCalledTimes(1);
      expect(spies.sms).toHaveBeenCalledTimes(1);
      expect(spies.twilio).toHaveBeenCalledTimes(1);
    });

    test("a Twilio config read that rejects takes the whole delivery down", async () => {
      spies.twilio.mockRejectedValue(
        new Error("project config read failed") as never,
      );
      spies.findRule.mockResolvedValue(
        loadedRule({
          userSms: verifiedUserSms(),
        } as unknown as JSONObject) as never,
      );

      /*
       * Pinned as current behaviour: the lookup is the first awaited statement
       * of the delivery half and is not guarded, so a failing project-config
       * read stops the page rather than falling back to the global config.
       * Loud, and the log ends up Error - but it is a real single point of
       * failure for channels that do not need Twilio at all.
       */
      await expect(
        UserNotificationRuleService.executeNotificationRuleItem(
          RULE_ID,
          executeOptions(),
        ),
      ).rejects.toThrow("project config read failed");

      expect(spies.sms).not.toHaveBeenCalled();
      expect(spies.timelineCreate).not.toHaveBeenCalled();
    });
  });
});
