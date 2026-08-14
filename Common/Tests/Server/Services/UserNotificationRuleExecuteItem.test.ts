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
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import logger from "../../../Server/Utils/Logger";
import Incident from "../../../Models/DatabaseModels/Incident";
import Alert from "../../../Models/DatabaseModels/Alert";
import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import BadDataException from "../../../Types/Exception/BadDataException";
import Email from "../../../Types/Email";
import Phone from "../../../Types/Phone";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import EmailMessage from "../../../Types/Email/EmailMessage";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * `executeNotificationRuleItem` is the last mile of the on-call system: by the
 * time control reaches it, an incident has fired, a policy has escalated, a
 * responder has been chosen, and a delay has elapsed. Everything that happens
 * inside decides whether a human's phone actually rings. Three things in it are
 * load-bearing and easy to break by accident, so they are pinned here:
 *
 *   1. THE CLAIM GATE. The very first statement is an atomic claim
 *      (`UserOnCallLogService.claimNotificationRuleExecution`, audit F7). When
 *      the claim is lost, the function must return *before* it reads anything
 *      and before any send happens — that is what stops two overlapping cron
 *      ticks from double-paging one responder for one escalation. A refactor
 *      that moved the rule lookup above the gate, or that treated `false` as
 *      "keep going", would silently reintroduce duplicate pages, so we assert
 *      not just "nothing was sent" but "findOneById was never even called" and
 *      that the claim strictly precedes the read.
 *
 *   2. THE SELECT CONTRACT. Every channel is verification-gated at send time
 *      (`userEmail?.email && userEmail?.isVerified`). Those gates are only as
 *      good as the `select` that hydrates them: an unselected `isVerified`
 *      arrives as `undefined`, which is falsy, so dropping it would not page
 *      unverified methods — it would *silence every verified one* and write a
 *      "not verified" error row for a phone that is perfectly verified. The
 *      exact select shape is therefore asserted field by field, together with
 *      the verified/unverified behaviour it drives.
 *
 *   3. THE SCHEDULING ENTRYPOINT. `startUserNotificationRulesExecution` writes
 *      the `UserOnCallLog` row that the ExecutePendingExecutions worker later
 *      picks up. Every option it is handed has to land on that row (a dropped
 *      `onCallDutyPolicyExecutionLogTimelineId` means the timeline never
 *      reconciles), the row must be `Scheduled`/"Scheduled" so the worker picks
 *      it up at all, and its fire-and-forget workspace-invite call must never
 *      be able to take the scheduling down with it.
 *
 * Nothing here touches a database and no template rendering is exercised — the
 * senders and generators are stubbed. This file pins CONTROL FLOW and CONTRACTS,
 * which is precisely what a later refactor of this 1700-line method will break.
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
const ALERT_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const TEAM_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const POLICY_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const ESCALATION_RULE_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const EXECUTION_LOG_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const EXECUTION_LOG_TIMELINE_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);
const ALERT_EPISODE_ID: ObjectID = new ObjectID(
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
);
const INCIDENT_EPISODE_ID: ObjectID = new ObjectID(
  "ffffffff-ffff-4fff-8fff-ffffffffffff",
);
const OVERRIDE_USER_ID: ObjectID = new ObjectID(
  "12121212-1212-4212-8212-121212121212",
);
const METHOD_ID: ObjectID = new ObjectID(
  "13131313-1313-4313-8313-131313131313",
);

type ExecuteOptions = Parameters<
  typeof UserNotificationRuleService.executeNotificationRuleItem
>[1];

type StartOptions = Parameters<
  typeof UserNotificationRuleService.startUserNotificationRulesExecution
>[1];

/* The `select` / `props` bundle handed to findOneById. */
interface FindOneByIdArg {
  id: ObjectID;
  select: JSONObject;
  props: { isRoot: boolean };
}

/*
 * The service mutates ONE UserOnCallLogTimeline instance and passes that same
 * instance to create() over and over, so mock.calls all alias the final state.
 * We snapshot the fields we care about at call time instead.
 */
interface TimelineRow {
  status: UserNotificationStatus | undefined;
  statusMessage: string | undefined;
  userId: ObjectID | undefined;
  userNotificationRuleId: ObjectID | undefined;
  userNotificationLogId: ObjectID | undefined;
  projectId: ObjectID | undefined;
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

function executeOptions(
  overrides: Partial<ExecuteOptions> = {},
): ExecuteOptions {
  return {
    projectId: PROJECT_ID,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    triggeredByIncidentId: INCIDENT_ID,
    onCallPolicyId: POLICY_ID,
    userNotificationLogId: LOG_ID,
    ...overrides,
  };
}

function ruleItem(channels: JSONObject = {}): UserNotificationRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    userId: USER_ID,
    ...channels,
  } as unknown as UserNotificationRule;
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

function fakeAlert(): Alert {
  return {
    id: ALERT_ID,
    projectId: PROJECT_ID,
    title: "Disk almost full",
    description: "94% used on node-3.",
    alertNumber: 7,
    alertNumberWithPrefix: "ALR-7",
  } as unknown as Alert;
}

/* Every stub the delivery path touches, so no test can reach a real service. */
interface DeliverySpies {
  claim: jest.SpyInstance;
  findRule: jest.SpyInstance;
  twilio: jest.SpyInstance;
  timelineCreate: jest.SpyInstance;
  timelineUpdate: jest.SpyInstance;
  incidentFind: jest.SpyInstance;
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
  emailTemplateForIncident: jest.SpyInstance;
}

describe("UserNotificationRuleService.executeNotificationRuleItem", () => {
  let spies: DeliverySpies;
  let timelineRows: Array<TimelineRow>;

  beforeEach(() => {
    timelineRows = [];

    jest.spyOn(logger, "error").mockImplementation((): void => {
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

        timelineRows.push({
          status: data.status,
          statusMessage: data.statusMessage,
          userId: data.userId,
          userNotificationRuleId: data.userNotificationRuleId,
          userNotificationLogId: data.userNotificationLogId,
          projectId: data.projectId,
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
        .mockResolvedValue(ruleItem() as never),
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
      alertFind: jest
        .spyOn(AlertService, "findOneById")
        .mockResolvedValue(fakeAlert() as never),
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
      emailTemplateForIncident: jest
        .spyOn(
          UserNotificationRuleService,
          "generateEmailTemplateForIncidentCreated",
        )
        .mockResolvedValue({} as EmailMessage as never),
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
   * ----------------------------------------------------------------------- *
   * (A) The atomic claim gate.
   * -----------------------------------------------------------------------
   */

  describe("the atomic claim gate runs first and is decisive", () => {
    test("claim resolving FALSE returns immediately - findOneById is never called", async () => {
      spies.claim.mockResolvedValue(false as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(spies.claim).toHaveBeenCalledTimes(1);
      /*
       * The whole point of F7: a lost claim must short-circuit BEFORE the read,
       * not merely before the send.
       */
      expect(spies.findRule).not.toHaveBeenCalled();
    });

    test("claim resolving FALSE sends nothing on any channel and writes no timeline row", async () => {
      spies.claim.mockResolvedValue(false as never);

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

    test("claim resolving FALSE also skips the incident/alert lookups and the Twilio config read", async () => {
      spies.claim.mockResolvedValue(false as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(spies.twilio).not.toHaveBeenCalled();
      expect(spies.incidentFind).not.toHaveBeenCalled();
      expect(spies.alertFind).not.toHaveBeenCalled();
    });

    test("a lost claim resolves (does NOT throw) so the worker does not mark the log Error", async () => {
      spies.claim.mockResolvedValue(false as never);

      /*
       * ExecutePendingExecutions marks a log `Error` on BadDataException. A
       * duplicate-suppressed rule is a normal outcome, not bad data, so this
       * path must resolve quietly.
       */
      await expect(
        UserNotificationRuleService.executeNotificationRuleItem(
          RULE_ID,
          executeOptions(),
        ),
      ).resolves.toBeUndefined();
    });

    test("the claim is made for exactly this on-call log and this rule", async () => {
      spies.claim.mockResolvedValue(false as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions({ userNotificationLogId: LOG_ID }),
      );

      const claimArg: {
        userOnCallLogId: ObjectID;
        userNotificationRuleId: ObjectID;
      } = spies.claim.mock.calls[0][0] as {
        userOnCallLogId: ObjectID;
        userNotificationRuleId: ObjectID;
      };
      expect(claimArg.userOnCallLogId.toString()).toBe(LOG_ID.toString());
      expect(claimArg.userNotificationRuleId.toString()).toBe(
        RULE_ID.toString(),
      );
    });

    test("claim resolving TRUE lets execution proceed to the rule lookup", async () => {
      spies.claim.mockResolvedValue(true as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(spies.findRule).toHaveBeenCalledTimes(1);
    });

    test("the claim strictly PRECEDES the rule lookup (ordering, not just presence)", async () => {
      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(spies.claim.mock.invocationCallOrder[0]).toBeLessThan(
        spies.findRule.mock.invocationCallOrder[0] as number,
      );
    });

    test("a claim that rejects propagates - the page is NOT attempted on an unknown claim state", async () => {
      spies.claim.mockRejectedValue(new Error("db connection reset") as never);

      await expect(
        UserNotificationRuleService.executeNotificationRuleItem(
          RULE_ID,
          executeOptions(),
        ),
      ).rejects.toThrow("db connection reset");

      expect(spies.findRule).not.toHaveBeenCalled();
      for (const sender of everySender()) {
        expect(sender).not.toHaveBeenCalled();
      }
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (B) A rule id that resolves to nothing.
   * -----------------------------------------------------------------------
   */

  describe("a rule id that resolves to nothing", () => {
    test('throws BadDataException("Notification rule item not found.")', async () => {
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

    test("the throw happens before the Twilio config and incident lookups", async () => {
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
    });

    test("nothing is sent when the rule is missing", async () => {
      spies.findRule.mockResolvedValue(null as never);

      await expect(
        UserNotificationRuleService.executeNotificationRuleItem(
          RULE_ID,
          executeOptions(),
        ),
      ).rejects.toThrow(BadDataException);

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
       * Current behaviour, worth knowing: the claim is written before the rule
       * is read, so a rule deleted between scheduling and execution burns its
       * claim and is never retried by a later tick. That is deliberate (a
       * missing rule is permanent), but it means the claim is not released on
       * failure.
       */
      expect(spies.claim).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (C) The select contract that the verification gates depend on.
   * -----------------------------------------------------------------------
   */

  describe("the select handed to findOneById", () => {
    async function captureFindArg(): Promise<FindOneByIdArg> {
      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      return spies.findRule.mock.calls[0][0] as FindOneByIdArg;
    }

    test("targets the requested rule id, as root", async () => {
      const arg: FindOneByIdArg = await captureFindArg();

      expect(arg.id.toString()).toBe(RULE_ID.toString());
      expect(arg.props.isRoot).toBe(true);
    });

    test("is EXACTLY this shape (a dropped field silently changes who gets paged)", async () => {
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
      "%s requests isVerified - without it every verified method reads as unverified",
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
      "%s also requests its address column (%s), which the send gate reads",
      async (channel: string, addressColumn: string) => {
        const arg: FindOneByIdArg = await captureFindArg();
        const selected: JSONObject = arg.select[channel] as JSONObject;

        expect(selected[addressColumn]).toBe(true);
      },
    );

    test("userWebhook requests webhookUrl, name, secret - and its owner", async () => {
      const arg: FindOneByIdArg = await captureFindArg();
      const webhookSelect: JSONObject = arg.select["userWebhook"] as JSONObject;

      /*
       * `userId` is read by no part of the webhook send. It is the
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
    });

    test("userWebhook requests NO isVerified - the UserWebhook model has no such column", async () => {
      const arg: FindOneByIdArg = await captureFindArg();
      const webhookSelect: JSONObject = arg.select["userWebhook"] as JSONObject;

      /*
       * Pinned as-is: webhooks are the one user-contactable channel with no
       * verification concept at all (UserWebhook has no isVerified column), so
       * the delivery gate below is `webhookUrl` alone. If webhook verification
       * is ever introduced, this select AND the gate both have to change.
       */
      expect(webhookSelect["isVerified"]).toBeUndefined();
    });

    test("userPush does NOT request deviceName even though the sender reads it", async () => {
      const arg: FindOneByIdArg = await captureFindArg();
      const pushSelect: JSONObject = arg.select["userPush"] as JSONObject;

      /*
       * KNOWN DEFECT (pinned as-is): the push send path reads
       * `notificationRuleItem.userPush.deviceName` to label the device, but
       * deviceName is not selected here, so it is always undefined and the
       * `name` key is never spread onto the device payload. Harmless today
       * (cosmetic label only) but it is a live select/consumer mismatch.
       */
      expect(pushSelect["deviceName"]).toBeUndefined();
      expect(pushSelect["deviceToken"]).toBe(true);
      expect(pushSelect["deviceType"]).toBe(true);
    });

    test("the rule is read exactly once per execution", async () => {
      await captureFindArg();

      expect(spies.findRule).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (C continued) What the selected isVerified actually gates.
   * -----------------------------------------------------------------------
   */

  describe("verification gating (what isVerified in the select buys)", () => {
    test("a VERIFIED email is delivered and its timeline row is Sending", async () => {
      spies.findRule.mockResolvedValue(
        ruleItem({
          userEmail: {
            id: METHOD_ID,
            email: new Email("responder@company.com"),
            isVerified: true,
          },
        } as unknown as JSONObject) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(spies.mail).toHaveBeenCalledTimes(1);
      expect(timelineRows).toHaveLength(1);
      expect(timelineRows[0]?.status).toBe(UserNotificationStatus.Sending);
      expect(timelineRows[0]?.statusMessage).toContain("responder@company.com");
      // The timeline row is stamped with the identifiers a reader needs.
      expect(timelineRows[0]?.userId?.toString()).toBe(USER_ID.toString());
      expect(timelineRows[0]?.userNotificationRuleId?.toString()).toBe(
        RULE_ID.toString(),
      );
      expect(timelineRows[0]?.userNotificationLogId?.toString()).toBe(
        LOG_ID.toString(),
      );
      expect(timelineRows[0]?.projectId?.toString()).toBe(
        PROJECT_ID.toString(),
      );
    });

    test("no unverified channel is ever contacted, and each writes one Error row", async () => {
      spies.findRule.mockResolvedValue(
        ruleItem({
          userEmail: {
            id: METHOD_ID,
            email: new Email("responder@company.com"),
            isVerified: false,
          },
          userSms: {
            id: METHOD_ID,
            phone: new Phone("+11234567890"),
            isVerified: false,
          },
          userWhatsApp: {
            id: METHOD_ID,
            phone: new Phone("+11234567891"),
            isVerified: false,
          },
          userTelegram: {
            id: METHOD_ID,
            telegramChatId: "123456",
            isVerified: false,
          },
          userCall: {
            id: METHOD_ID,
            phone: new Phone("+11234567892"),
            isVerified: false,
          },
          userPush: {
            id: METHOD_ID,
            deviceToken: "device-token",
            deviceType: "iOS",
            isVerified: false,
          },
        } as unknown as JSONObject) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(spies.mail).not.toHaveBeenCalled();
      expect(spies.sms).not.toHaveBeenCalled();
      expect(spies.call).not.toHaveBeenCalled();
      expect(spies.whatsApp).not.toHaveBeenCalled();
      expect(spies.telegram).not.toHaveBeenCalled();
      expect(spies.push).not.toHaveBeenCalled();

      // One "not verified" Error row per unverified channel: 6 in total.
      expect(timelineRows).toHaveLength(6);
      for (const row of timelineRows) {
        expect(row.status).toBe(UserNotificationStatus.Error);
        expect(row.statusMessage).toContain("not verified");
      }
    });

    test("the Telegram unverified branch keys off the RELATION, not the chat id", async () => {
      spies.findRule.mockResolvedValue(
        ruleItem({
          userTelegram: {
            id: METHOD_ID,
            isVerified: false,
          },
        } as unknown as JSONObject) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      /*
       * Every other channel guards its "not verified" log on the address being
       * present (`userSms?.phone && !isVerified`); Telegram alone guards on the
       * relation existing, so a Telegram row with no chat id still produces an
       * Error row. Pinned as current behaviour.
       */
      expect(spies.telegram).not.toHaveBeenCalled();
      expect(timelineRows).toHaveLength(1);
      expect(timelineRows[0]?.statusMessage).toContain("not verified");
    });

    test("a webhook is dispatched on webhookUrl alone - there is no verification gate", async () => {
      spies.findRule.mockResolvedValue(
        ruleItem({
          userWebhook: {
            id: METHOD_ID,
            webhookUrl: "https://hooks.example.com/on-call",
            name: "Pager bridge",
            secret: "s3cr3t",
          },
        } as unknown as JSONObject) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(spies.webhook).toHaveBeenCalledTimes(1);
      const payload: {
        url: string;
        eventType: string;
        secret: string | undefined;
      } = spies.webhook.mock.calls[0][0] as {
        url: string;
        eventType: string;
        secret: string | undefined;
      };
      expect(payload.url).toBe("https://hooks.example.com/on-call");
      expect(payload.eventType).toBe("on-call.incident.created");
      // The selected `secret` is what signs the request - it must be selected.
      expect(payload.secret).toBe("s3cr3t");
      expect(timelineRows).toHaveLength(1);
      expect(timelineRows[0]?.status).toBe(UserNotificationStatus.Sending);
    });

    test("a rule with no contactable channel at all sends nothing and logs nothing", async () => {
      spies.findRule.mockResolvedValue(ruleItem() as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      for (const sender of everySender()) {
        expect(sender).not.toHaveBeenCalled();
      }
      /*
       * KNOWN GAP (pinned as-is): a hydrated rule pointing at a method that was
       * cascade-deleted produces a completely silent execution - no send and no
       * timeline row saying why.
       */
      expect(timelineRows).toHaveLength(0);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (C continued) The trigger entity must resolve before anything is sent.
   * -----------------------------------------------------------------------
   */

  describe("resolving the triggering entity", () => {
    test("throws when the incident behind an IncidentCreated event is gone", async () => {
      spies.incidentFind.mockResolvedValue(null as never);

      await expect(
        UserNotificationRuleService.executeNotificationRuleItem(
          RULE_ID,
          executeOptions(),
        ),
      ).rejects.toThrow(
        "Incident, Alert, Alert Episode, or Incident Episode not found.",
      );

      for (const sender of everySender()) {
        expect(sender).not.toHaveBeenCalled();
      }
    });

    test("an IncidentCreated event with no triggeredByIncidentId never even queries the incident", async () => {
      await expect(
        UserNotificationRuleService.executeNotificationRuleItem(
          RULE_ID,
          executeOptions({ triggeredByIncidentId: undefined }),
        ),
      ).rejects.toThrow(BadDataException);

      expect(spies.incidentFind).not.toHaveBeenCalled();
    });

    test("the event type - not the supplied ids - picks which entity is loaded", async () => {
      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions({
          userNotificationEventType: UserNotificationEventType.AlertCreated,
          triggeredByAlertId: ALERT_ID,
          triggeredByIncidentId: INCIDENT_ID,
        }),
      );

      expect(spies.alertFind).toHaveBeenCalledTimes(1);
      // IncidentCreated is not the event type, so the incident is never read.
      expect(spies.incidentFind).not.toHaveBeenCalled();
    });
  });
});

/*
 * ------------------------------------------------------------------------- *
 * (D) startUserNotificationRulesExecution - the scheduling entrypoint.
 * -------------------------------------------------------------------------
 */

describe("UserNotificationRuleService.startUserNotificationRulesExecution", () => {
  let createLog: jest.SpyInstance;
  let workspaceRules: jest.SpyInstance;
  let loggerError: jest.SpyInstance;

  function startOptions(overrides: Partial<StartOptions> = {}): StartOptions {
    return {
      projectId: PROJECT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      onCallPolicyId: POLICY_ID,
      ...overrides,
    };
  }

  function fullStartOptions(): StartOptions {
    return {
      projectId: PROJECT_ID,
      triggeredByIncidentId: INCIDENT_ID,
      triggeredByAlertId: ALERT_ID,
      triggeredByAlertEpisodeId: ALERT_EPISODE_ID,
      triggeredByIncidentEpisodeId: INCIDENT_EPISODE_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      onCallPolicyExecutionLogId: EXECUTION_LOG_ID,
      onCallPolicyId: POLICY_ID,
      onCallPolicyEscalationRuleId: ESCALATION_RULE_ID,
      userBelongsToTeamId: TEAM_ID,
      onCallDutyPolicyExecutionLogTimelineId: EXECUTION_LOG_TIMELINE_ID,
      onCallScheduleId: SCHEDULE_ID,
      overridedByUserId: OVERRIDE_USER_ID,
    };
  }

  function createdLog(): UserOnCallLog {
    return (createLog.mock.calls[0][0] as { data: UserOnCallLog }).data;
  }

  beforeEach(() => {
    loggerError = jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    createLog = jest
      .spyOn(UserOnCallLogService, "create")
      .mockResolvedValue({ id: LOG_ID } as unknown as UserOnCallLog as never);

    workspaceRules = jest
      .spyOn(
        UserNotificationRuleService,
        "runWorkspaceRulesForOnCallNotification",
      )
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("creates exactly one UserOnCallLog, as root", async () => {
    await UserNotificationRuleService.startUserNotificationRulesExecution(
      USER_ID,
      startOptions(),
    );

    expect(createLog).toHaveBeenCalledTimes(1);
    const arg: { props: { isRoot: boolean } } = createLog.mock.calls[0][0] as {
      props: { isRoot: boolean };
    };
    expect(arg.props.isRoot).toBe(true);
  });

  test("the log is Scheduled with statusMessage 'Scheduled' so the worker picks it up", async () => {
    await UserNotificationRuleService.startUserNotificationRulesExecution(
      USER_ID,
      startOptions(),
    );

    const log: UserOnCallLog = createdLog();
    expect(log.status).toBe(UserNotificationExecutionStatus.Scheduled);
    expect(log.statusMessage).toBe("Scheduled");
  });

  test("the user and project always land on the log", async () => {
    await UserNotificationRuleService.startUserNotificationRulesExecution(
      USER_ID,
      startOptions(),
    );

    const log: UserOnCallLog = createdLog();
    expect(log.userId?.toString()).toBe(USER_ID.toString());
    expect(log.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(log.userNotificationEventType).toBe(
      UserNotificationEventType.IncidentCreated,
    );
  });

  test("EVERY option field is forwarded onto the log when all of them are supplied", async () => {
    await UserNotificationRuleService.startUserNotificationRulesExecution(
      USER_ID,
      fullStartOptions(),
    );

    const log: UserOnCallLog = createdLog();

    expect(log.triggeredByIncidentId?.toString()).toBe(INCIDENT_ID.toString());
    expect(log.triggeredByAlertId?.toString()).toBe(ALERT_ID.toString());
    expect(log.triggeredByAlertEpisodeId?.toString()).toBe(
      ALERT_EPISODE_ID.toString(),
    );
    expect(log.triggeredByIncidentEpisodeId?.toString()).toBe(
      INCIDENT_EPISODE_ID.toString(),
    );
    // Renamed on the way in: onCallPolicy* -> onCallDutyPolicy*.
    expect(log.onCallDutyPolicyExecutionLogId?.toString()).toBe(
      EXECUTION_LOG_ID.toString(),
    );
    expect(log.onCallDutyPolicyId?.toString()).toBe(POLICY_ID.toString());
    expect(log.onCallDutyPolicyEscalationRuleId?.toString()).toBe(
      ESCALATION_RULE_ID.toString(),
    );
    expect(log.onCallDutyPolicyExecutionLogTimelineId?.toString()).toBe(
      EXECUTION_LOG_TIMELINE_ID.toString(),
    );
    expect(log.userBelongsToTeamId?.toString()).toBe(TEAM_ID.toString());
    // onCallScheduleId -> onCallDutyScheduleId.
    expect(log.onCallDutyScheduleId?.toString()).toBe(SCHEDULE_ID.toString());
    expect(log.overridedByUserId?.toString()).toBe(OVERRIDE_USER_ID.toString());
  });

  test("optional fields left out stay unset on the log (no undefined-id writes)", async () => {
    await UserNotificationRuleService.startUserNotificationRulesExecution(
      USER_ID,
      startOptions({ onCallPolicyId: undefined }),
    );

    const log: UserOnCallLog = createdLog();
    expect(log.triggeredByIncidentId).toBeUndefined();
    expect(log.triggeredByAlertId).toBeUndefined();
    expect(log.triggeredByAlertEpisodeId).toBeUndefined();
    expect(log.triggeredByIncidentEpisodeId).toBeUndefined();
    expect(log.onCallDutyPolicyId).toBeUndefined();
    expect(log.onCallDutyPolicyExecutionLogId).toBeUndefined();
    expect(log.onCallDutyPolicyEscalationRuleId).toBeUndefined();
    expect(log.onCallDutyPolicyExecutionLogTimelineId).toBeUndefined();
    expect(log.userBelongsToTeamId).toBeUndefined();
    expect(log.onCallDutyScheduleId).toBeUndefined();
    expect(log.overridedByUserId).toBeUndefined();
    // ...but the status fields are unconditional.
    expect(log.status).toBe(UserNotificationExecutionStatus.Scheduled);
  });

  test("the workspace-invite call is handed projectId, alertId, incidentId and userId", async () => {
    await UserNotificationRuleService.startUserNotificationRulesExecution(
      USER_ID,
      startOptions({ triggeredByIncidentId: INCIDENT_ID }),
    );

    expect(workspaceRules).toHaveBeenCalledTimes(1);
    const arg: {
      projectId: ObjectID;
      alertId: ObjectID | undefined;
      incidentId: ObjectID | undefined;
      userId: ObjectID;
    } = workspaceRules.mock.calls[0][0] as {
      projectId: ObjectID;
      alertId: ObjectID | undefined;
      incidentId: ObjectID | undefined;
      userId: ObjectID;
    };
    expect(arg.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(arg.incidentId?.toString()).toBe(INCIDENT_ID.toString());
    expect(arg.alertId).toBeUndefined();
    expect(arg.userId.toString()).toBe(USER_ID.toString());
  });

  test("the log is created BEFORE the workspace-invite call is fired", async () => {
    await UserNotificationRuleService.startUserNotificationRulesExecution(
      USER_ID,
      startOptions({ triggeredByIncidentId: INCIDENT_ID }),
    );

    expect(createLog.mock.invocationCallOrder[0]).toBeLessThan(
      workspaceRules.mock.invocationCallOrder[0] as number,
    );
  });

  test("a failure creating the log propagates, and no workspace invite is attempted", async () => {
    createLog.mockRejectedValue(new Error("pool timeout") as never);

    await expect(
      UserNotificationRuleService.startUserNotificationRulesExecution(
        USER_ID,
        startOptions(),
      ),
    ).rejects.toThrow("pool timeout");

    expect(workspaceRules).not.toHaveBeenCalled();
  });

  test("a REJECTION from the workspace-invite call does NOT reject the scheduling", async () => {
    workspaceRules.mockRejectedValue(
      new Error("slack workspace unreachable") as never,
    );

    /*
     * This is the whole reason the call is `.catch`-ed rather than awaited: an
     * unreachable Slack must never stop a page from being scheduled. If this
     * ever starts rejecting, every on-call notification in a project with a
     * broken workspace integration disappears.
     */
    await expect(
      UserNotificationRuleService.startUserNotificationRulesExecution(
        USER_ID,
        startOptions({ triggeredByIncidentId: INCIDENT_ID }),
      ),
    ).resolves.toBeUndefined();

    await flushMicrotasks();

    // It is swallowed into the log, not lost silently.
    expect(loggerError).toHaveBeenCalled();
    expect(createLog).toHaveBeenCalledTimes(1);
  });

  test("the swallowed workspace error is logged with the project and user attributes", async () => {
    workspaceRules.mockRejectedValue(new Error("slack down") as never);

    await UserNotificationRuleService.startUserNotificationRulesExecution(
      USER_ID,
      startOptions({ triggeredByIncidentId: INCIDENT_ID }),
    );
    await flushMicrotasks();

    const attributes: { projectId: string; userId: string } = loggerError.mock
      .calls[0][1] as { projectId: string; userId: string };
    expect(attributes.projectId).toBe(PROJECT_ID.toString());
    expect(attributes.userId).toBe(USER_ID.toString());
  });

  test("the workspace-invite call is NOT awaited (scheduling returns while it is still pending)", async () => {
    let release: () => void = (): void => {
      return undefined;
    };
    const pending: Promise<void> = new Promise<void>(
      (resolve: () => void): void => {
        release = resolve;
      },
    );
    workspaceRules.mockReturnValue(pending);

    /*
     * If startUserNotificationRulesExecution awaited the workspace call, this
     * await would never settle and the test would time out. Reaching the next
     * line IS the assertion.
     */
    await UserNotificationRuleService.startUserNotificationRulesExecution(
      USER_ID,
      startOptions({ triggeredByIncidentId: INCIDENT_ID }),
    );

    expect(workspaceRules).toHaveBeenCalledTimes(1);

    release();
    await pending;
  });

  test("an episode-triggered execution has no incident or alert id, so the workspace call always errors", async () => {
    /*
     * Discovered behaviour, pinned as-is: startUserNotificationRulesExecution
     * forwards `alertId`/`incidentId` verbatim, and
     * runWorkspaceRulesForOnCallNotification throws when BOTH are missing. For
     * AlertEpisodeCreated / IncidentEpisodeCreated executions that is always
     * the case, so every episode page logs a BadDataException on this path.
     * Harmless to delivery (it is caught), but it is permanent log noise.
     */
    workspaceRules.mockRestore();

    const getRules: jest.SpyInstance = jest.spyOn(
      WorkspaceNotificationRuleService,
      "getNotificationRulesWhereInviteOwnersIsTrue",
    );

    await expect(
      UserNotificationRuleService.startUserNotificationRulesExecution(
        USER_ID,
        startOptions({
          userNotificationEventType:
            UserNotificationEventType.AlertEpisodeCreated,
          triggeredByAlertEpisodeId: ALERT_EPISODE_ID,
        }),
      ),
    ).resolves.toBeUndefined();

    await flushMicrotasks();

    expect(createLog).toHaveBeenCalledTimes(1);
    expect(getRules).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalled();
    expect(loggerError.mock.calls[0][0]).toBeInstanceOf(BadDataException);
  });
});

/*
 * ------------------------------------------------------------------------- *
 * (E) runWorkspaceRulesForOnCallNotification.
 * -------------------------------------------------------------------------
 */

describe("UserNotificationRuleService.runWorkspaceRulesForOnCallNotification", () => {
  let getRules: jest.SpyInstance;
  let inviteUsers: jest.SpyInstance;
  let incidentChannels: jest.SpyInstance;
  let alertChannels: jest.SpyInstance;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    loggerError = jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    getRules = jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "getNotificationRulesWhereInviteOwnersIsTrue",
      )
      .mockResolvedValue([] as never);

    inviteUsers = jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "inviteUsersBasedOnRulesAndWorkspaceChannels",
      )
      .mockResolvedValue(undefined as never);

    incidentChannels = jest
      .spyOn(IncidentService, "getWorkspaceChannelForIncident")
      .mockResolvedValue([] as never);

    alertChannels = jest
      .spyOn(AlertService, "getWorkspaceChannelForAlert")
      .mockResolvedValue([] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("throws BadDataException when BOTH incidentId and alertId are supplied", async () => {
    await expect(
      UserNotificationRuleService.runWorkspaceRulesForOnCallNotification({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertId: ALERT_ID,
        userId: USER_ID,
      }),
    ).rejects.toThrow(BadDataException);
  });

  test("the both-supplied message is 'Either incidentId or alertId is required.'", async () => {
    /*
     * Pinned as-is even though it reads wrongly for this branch: the ambiguous
     * case ("you gave me both") reuses the missing-case message verbatim.
     */
    await expect(
      UserNotificationRuleService.runWorkspaceRulesForOnCallNotification({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertId: ALERT_ID,
        userId: USER_ID,
      }),
    ).rejects.toThrow("Either incidentId or alertId is required.");
  });

  test("supplying both short-circuits before any workspace query", async () => {
    await expect(
      UserNotificationRuleService.runWorkspaceRulesForOnCallNotification({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertId: ALERT_ID,
        userId: USER_ID,
      }),
    ).rejects.toThrow(BadDataException);

    expect(getRules).not.toHaveBeenCalled();
    expect(incidentChannels).not.toHaveBeenCalled();
    expect(alertChannels).not.toHaveBeenCalled();
    expect(inviteUsers).not.toHaveBeenCalled();
  });

  test("throws the same BadDataException when NEITHER is supplied", async () => {
    await expect(
      UserNotificationRuleService.runWorkspaceRulesForOnCallNotification({
        projectId: PROJECT_ID,
        userId: USER_ID,
      }),
    ).rejects.toThrow("Either incidentId or alertId is required.");

    expect(getRules).not.toHaveBeenCalled();
  });

  test("the incident path queries incident rules and incident channels only", async () => {
    await UserNotificationRuleService.runWorkspaceRulesForOnCallNotification({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      userId: USER_ID,
    });

    const rulesArg: {
      projectId: ObjectID;
      notificationFor: { incidentId?: ObjectID; alertId?: ObjectID };
      notificationRuleEventType: NotificationRuleEventType;
    } = getRules.mock.calls[0][0] as {
      projectId: ObjectID;
      notificationFor: { incidentId?: ObjectID; alertId?: ObjectID };
      notificationRuleEventType: NotificationRuleEventType;
    };
    expect(rulesArg.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(rulesArg.notificationFor.incidentId?.toString()).toBe(
      INCIDENT_ID.toString(),
    );
    expect(rulesArg.notificationFor.alertId).toBeUndefined();
    expect(rulesArg.notificationRuleEventType).toBe(
      NotificationRuleEventType.Incident,
    );

    expect(incidentChannels).toHaveBeenCalledTimes(1);
    expect(alertChannels).not.toHaveBeenCalled();
  });

  test("the alert path queries alert rules and alert channels only", async () => {
    await UserNotificationRuleService.runWorkspaceRulesForOnCallNotification({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      userId: USER_ID,
    });

    const rulesArg: {
      notificationFor: { incidentId?: ObjectID; alertId?: ObjectID };
      notificationRuleEventType: NotificationRuleEventType;
    } = getRules.mock.calls[0][0] as {
      notificationFor: { incidentId?: ObjectID; alertId?: ObjectID };
      notificationRuleEventType: NotificationRuleEventType;
    };
    expect(rulesArg.notificationFor.alertId?.toString()).toBe(
      ALERT_ID.toString(),
    );
    expect(rulesArg.notificationFor.incidentId).toBeUndefined();
    expect(rulesArg.notificationRuleEventType).toBe(
      NotificationRuleEventType.Alert,
    );

    expect(alertChannels).toHaveBeenCalledTimes(1);
    expect(incidentChannels).not.toHaveBeenCalled();
  });

  test("only the notified user is invited, with the resolved rules and channels", async () => {
    const rules: Array<unknown> = [{ _id: "rule-1" }];
    const channels: Array<unknown> = [{ id: "channel-1", name: "#incidents" }];
    getRules.mockResolvedValue(rules as never);
    incidentChannels.mockResolvedValue(channels as never);

    await UserNotificationRuleService.runWorkspaceRulesForOnCallNotification({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      userId: USER_ID,
    });

    expect(inviteUsers).toHaveBeenCalledTimes(1);
    const inviteArg: {
      notificationRules: Array<unknown>;
      projectId: ObjectID;
      workspaceChannels: Array<unknown>;
      userIds: Array<ObjectID>;
    } = inviteUsers.mock.calls[0][0] as {
      notificationRules: Array<unknown>;
      projectId: ObjectID;
      workspaceChannels: Array<unknown>;
      userIds: Array<ObjectID>;
    };
    expect(inviteArg.notificationRules).toBe(rules);
    expect(inviteArg.workspaceChannels).toBe(channels);
    expect(inviteArg.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(inviteArg.userIds).toHaveLength(1);
    expect(inviteArg.userIds[0]?.toString()).toBe(USER_ID.toString());
  });

  test("a failing invite is swallowed and logged - it never rejects the caller", async () => {
    inviteUsers.mockRejectedValue(new Error("slack api 500") as never);

    await expect(
      UserNotificationRuleService.runWorkspaceRulesForOnCallNotification({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        userId: USER_ID,
      }),
    ).resolves.toBeUndefined();

    await flushMicrotasks();

    expect(loggerError).toHaveBeenCalled();
  });

  test("a failing channel lookup DOES reject (it is awaited, unlike the invite)", async () => {
    incidentChannels.mockRejectedValue(
      new Error("workspace api down") as never,
    );

    await expect(
      UserNotificationRuleService.runWorkspaceRulesForOnCallNotification({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        userId: USER_ID,
      }),
    ).rejects.toThrow("workspace api down");

    expect(inviteUsers).not.toHaveBeenCalled();
  });
});
