import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import logger from "../../../Server/Utils/Logger";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserMicrosoftTeams from "../../../Models/DatabaseModels/UserMicrosoftTeams";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserSlack from "../../../Models/DatabaseModels/UserSlack";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import CriticalAlertSound from "../../../Types/PushNotification/CriticalAlertSound";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A repeat sends the push again - and nothing else.
 *
 * Repeating is a push rule's option, and the write guards refuse it on a rule
 * without a phone. But a rule written through the API can name an email, a
 * text, a call or a chat beside its phone, and the first send of such a rule
 * goes to all of them, as it always has. Were a repeat to do the same, a
 * rule repeating every minute would call a phone line and send a text ten
 * more times - the very cost the push-only rule exists to prevent. So the
 * rule a repeat hands to delivery carries its push device alone.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const LOG_ID: ObjectID = ObjectID.generate();
const RULE_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const OTHER_USER_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();

type ExecuteOptions = Parameters<
  typeof UserNotificationRuleService.executeNotificationRuleItem
>[1];

interface ServiceInternals {
  deliverNotificationForRule: (
    notificationRuleItem: UserNotificationRule,
    options: ExecuteOptions,
  ) => Promise<boolean>;
  recordMismatchedNotificationMethod: (
    ...args: Array<unknown>
  ) => Promise<void>;
}

function internals(): ServiceInternals {
  return UserNotificationRuleService as unknown as ServiceInternals;
}

// Every method a rule can name, each owned by `ownerUserId`.
function ruleWithEveryMethod(
  ownerUserId: ObjectID = USER_ID,
): UserNotificationRule {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule._id = RULE_ID.toString();
  rule.projectId = PROJECT_ID;
  rule.userId = USER_ID;
  rule.ruleType = NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
  rule.notifyAfterMinutes = 0;
  rule.repeatEveryMinutes = 1;

  const push: UserPush = new UserPush();
  push._id = ObjectID.generate().toString();
  push.userId = USER_ID;
  push.deviceToken = "ExponentPushToken[handset]";
  push.isCriticalAlertEnabled = true;
  push.criticalAlertSound = CriticalAlertSound.SmokeAlarm;
  push.criticalAlertVolume = 75;
  rule.userPush = push;
  rule.userPushId = push.id!;

  const methods: Array<[string, { _id?: string; userId?: ObjectID }]> = [
    ["userEmail", new UserEmail()],
    ["userSms", new UserSMS()],
    ["userCall", new UserCall()],
    ["userWhatsApp", new UserWhatsApp()],
    ["userTelegram", new UserTelegram()],
    ["userSlack", new UserSlack()],
    ["userMicrosoftTeams", new UserMicrosoftTeams()],
    ["userWebhook", new UserWebhook()],
  ];

  for (const [relationColumn, method] of methods) {
    const methodId: ObjectID = ObjectID.generate();
    method._id = methodId.toString();
    method.userId = ownerUserId;
    (rule as unknown as Record<string, unknown>)[relationColumn] = method;
    (rule as unknown as Record<string, unknown>)[`${relationColumn}Id`] =
      methodId;
  }

  return rule;
}

const NON_PUSH_RELATIONS: Array<string> = [
  "userEmail",
  "userSms",
  "userCall",
  "userWhatsApp",
  "userTelegram",
  "userSlack",
  "userMicrosoftTeams",
  "userWebhook",
];

function options(repeatNumber?: number | undefined): ExecuteOptions {
  return {
    projectId: PROJECT_ID,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    userNotificationLogId: LOG_ID,
    triggeredByIncidentId: INCIDENT_ID,
    ...(repeatNumber !== undefined ? { repeatNumber: repeatNumber } : {}),
  } as ExecuteOptions;
}

let deliver: jest.SpyInstance;

/*
 * The rule as delivery received it: a snapshot of each method relation and
 * id, taken when it was handed over.
 */
function deliveredMethods(): Record<string, unknown> {
  expect(deliver).toHaveBeenCalledTimes(1);

  const rule: Record<string, unknown> = deliver.mock
    .calls[0]![0] as unknown as Record<string, unknown>;
  const snapshot: Record<string, unknown> = {};

  for (const relationColumn of [...NON_PUSH_RELATIONS, "userPush"]) {
    snapshot[relationColumn] = rule[relationColumn];
    snapshot[`${relationColumn}Id`] = rule[`${relationColumn}Id`];
  }

  return snapshot;
}

async function execute(
  rule: UserNotificationRule,
  repeatNumber?: number | undefined,
): Promise<void> {
  jest
    .spyOn(UserNotificationRuleService, "findOneById")
    .mockResolvedValue(rule as never);

  await UserNotificationRuleService.executeNotificationRuleItem(
    RULE_ID,
    options(repeatNumber),
  );
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(UserOnCallLogService, "claimNotificationRuleExecution")
    .mockResolvedValue(true as never);
  deliver = jest
    .spyOn(internals(), "deliverNotificationForRule")
    .mockResolvedValue(true as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the first send of a rule", () => {
  test("goes to every method the rule names, as it always has", async () => {
    await execute(ruleWithEveryMethod());

    const delivered: Record<string, unknown> = deliveredMethods();

    for (const relationColumn of [...NON_PUSH_RELATIONS, "userPush"]) {
      expect(delivered[relationColumn]).toBeDefined();
      expect(delivered[`${relationColumn}Id`]).toBeDefined();
    }
  });

  test("a repeat number of 0 is the first send", async () => {
    await execute(ruleWithEveryMethod(), 0);

    expect(deliveredMethods()["userCall"]).toBeDefined();
    expect(deliveredMethods()["userSms"]).toBeDefined();
  });
});

describe("a repeat", () => {
  test.each([1, 2, 5, 10])(
    "repeat %d goes to the push device and to nothing else",
    async (repeatNumber: number) => {
      await execute(ruleWithEveryMethod(), repeatNumber);

      const delivered: Record<string, unknown> = deliveredMethods();

      for (const relationColumn of NON_PUSH_RELATIONS) {
        expect(delivered[relationColumn]).toBeUndefined();
        expect(delivered[`${relationColumn}Id`]).toBeUndefined();
      }

      expect(delivered["userPush"]).toBeDefined();
      expect(delivered["userPushId"]).toBeDefined();
    },
  );

  test("keeps the device's chosen alarm and volume", async () => {
    await execute(ruleWithEveryMethod(), 3);

    const device: UserPush = deliveredMethods()["userPush"] as UserPush;

    expect(device.criticalAlertSound).toBe(CriticalAlertSound.SmokeAlarm);
    expect(device.criticalAlertVolume).toBe(75);
    expect(device.isCriticalAlertEnabled).toBe(true);
  });

  test("keeps everything that is not a method: who, what and when", async () => {
    await execute(ruleWithEveryMethod(), 4);

    const rule: UserNotificationRule = deliver.mock
      .calls[0]![0] as UserNotificationRule;

    expect(rule.id?.toString()).toBe(RULE_ID.toString());
    expect(rule.userId?.toString()).toBe(USER_ID.toString());
    expect(rule.ruleType).toBe(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT);
    expect(rule.repeatEveryMinutes).toBe(1);
  });

  test("is still checked for methods owned by somebody else before anything is stripped", async () => {
    /*
     * The ownership guard reads every method the rule names. Were the
     * methods stripped first, a rule pointing at another person's phone line
     * would sail through it on every repeat.
     */
    const recordMismatch: jest.SpyInstance = jest
      .spyOn(internals(), "recordMismatchedNotificationMethod")
      .mockResolvedValue(undefined as never);

    await execute(ruleWithEveryMethod(OTHER_USER_ID), 2);

    expect(recordMismatch).toHaveBeenCalledTimes(1);
    expect(deliver).not.toHaveBeenCalled();
  });

  test("a repeat whose claim was lost delivers nothing at all", async () => {
    jest
      .spyOn(UserOnCallLogService, "claimNotificationRuleExecution")
      .mockResolvedValue(false as never);

    await execute(ruleWithEveryMethod(), 6);

    expect(deliver).not.toHaveBeenCalled();
  });

  test("a push-only rule repeats exactly as it is", async () => {
    const rule: UserNotificationRule = ruleWithEveryMethod();

    for (const relationColumn of NON_PUSH_RELATIONS) {
      (rule as unknown as Record<string, unknown>)[relationColumn] = undefined;
      (rule as unknown as Record<string, unknown>)[`${relationColumn}Id`] =
        undefined;
    }

    await execute(rule, 1);

    expect(deliveredMethods()["userPush"]).toBe(rule.userPush);
  });
});
