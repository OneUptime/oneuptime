import User from "../../../Models/DatabaseModels/User";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import CustomNotificationChannelService from "../../../Server/Services/CustomNotificationChannelService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallTestPageService, {
  MESSAGING_PRICE_SETTINGS,
  getPreviewMethodsOfRule,
} from "../../../Server/Services/OnCallTestPageService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserMattermostService from "../../../Server/Services/UserMattermostService";
import UserMicrosoftTeamsService from "../../../Server/Services/UserMicrosoftTeamsService";
import UserNotificationRuleService, {
  ExecuteFallbackNotificationOptions,
  ExecuteNotificationRuleOptions,
  FallbackNotificationOutcome,
  FallbackNotificationResult,
} from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserPushService from "../../../Server/Services/UserPushService";
import UserService from "../../../Server/Services/UserService";
import UserSlackService from "../../../Server/Services/UserSlackService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import logger from "../../../Server/Utils/Logger";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageCost,
  OnCallTestPagePreview,
  OnCallTestPagePreviewMethod,
  OnCallTestPagePreviewPerson,
  OnCallTestPageRecordKind,
  OnCallTestPageWarningCode,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import Phone from "../../../Types/Phone";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import { TwilioMessageKind } from "../../../Utils/Project/TwilioAccount";
import { readUserIdWhileMember } from "../TestingUtils/MembershipCondition";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * WHAT A TEST PAGE SENDS A PERSON WITH NO RULE FOR ITS SEVERITY, AND WHAT IT
 * COSTS (#7262) - AND WHAT OF IT THE PROJECT'S BALANCE PAYS FOR (#7263).
 *
 * A real page to somebody with no on-call rule for its severity goes to
 * what the project's fallback picks of their methods
 * (UserNotificationRuleService.chooseFallbackChannels): every free one -
 * push, email, Slack, Microsoft Teams, Mattermost, a custom channel that
 * pages everyone - or, with none, ONE paid one, the first of SMS, a call,
 * WhatsApp and Telegram they have verified on a channel the project has on;
 * or, with none of those either, a webhook. A test page runs the same path,
 * so its preview lists those methods - read by the fallback's own reader
 * (getFallbackRules), never a copy of it - marked as the fallback's, and
 * prices them: the first level's cost and, walking every level, the walk's.
 *
 * Only the database reads are stood in for: the preview, the fallback's
 * reader and the fallback's delivery run as they are. A text or a call is
 * paid from the balance only on OneUptime Cloud, and the billing flag is
 * read when the module loads, so this file pins billing on.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: true,
  };
});

const PROJECT: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000801");
const POLICY: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000802");
const SEVERITY: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000803");
const LOG: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000804");
const ANA: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-0000000008a1");
const BOB: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-0000000008b1");
const SAM: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-0000000008c1");

const NAMES: Record<string, string> = {
  [ANA.toString()]: "Ana Lopez",
  [BOB.toString()]: "Bob Stone",
  [SAM.toString()]: "Sam Rivera",
};

// Prices, in US cents, as the Notification service reads them.
const SMS_PRICE: number = 10;
const CALL_PRICE: number = 25;

// The verified methods a person has, whatever rule uses them.
interface Methods {
  push?: boolean;
  email?: boolean;
  slack?: boolean;
  teams?: boolean;
  mattermost?: boolean;
  sms?: boolean;
  call?: boolean;
  whatsApp?: boolean;
  telegram?: boolean;
  webhook?: boolean;
}

// The project's switches, as the preview and the fallback read them.
interface ProjectSwitches {
  enableSmsNotifications: boolean;
  enableCallNotifications: boolean;
  enableWhatsAppNotifications: boolean;
  enableTelegramNotifications: boolean;
  disableOnCallNotificationFallback: boolean;
}

// One escalation level: its order, its wait, and whom it names.
interface Level {
  id: ObjectID;
  order: number;
  escalateAfterInMinutes: number;
  people: Array<ObjectID>;
}

function level(
  order: number,
  escalateAfterInMinutes: number,
  people: Array<ObjectID>,
): Level {
  return {
    id: new ObjectID(
      `7e5ae000-0000-4000-8000-0000000009${String(order).padStart(2, "0")}`,
    ),
    order: order,
    escalateAfterInMinutes: escalateAfterInMinutes,
    people: people,
  };
}

function smsRule(phone: string): UserNotificationRule {
  return {
    id: ObjectID.generate(),
    notifyAfterMinutes: 0,
    userSms: { phone: new Phone(phone), isVerified: true },
  } as unknown as UserNotificationRule;
}

function callRule(phone: string): UserNotificationRule {
  return {
    id: ObjectID.generate(),
    notifyAfterMinutes: 0,
    userCall: { phone: new Phone(phone), isVerified: true },
  } as unknown as UserNotificationRule;
}

let levels: Array<Level>;
let rulesOf: Record<string, Array<UserNotificationRule>>;
let methodsOf: Record<string, Methods>;
let optedOut: Array<string>;
let project: ProjectSwitches;
let ownTwilioFor: Array<TwilioMessageKind>;
let fallbackRead: SpyInstance<
  typeof UserNotificationRuleService.getFallbackRules
>;

const savedPrices: Record<string, string | undefined> = {};

// The user a fallback read asks about: a plain id, as the fallback queries.
function userOf(data: { query: Record<string, unknown> }): string {
  return String(data.query["userId"]);
}

/*
 * A verified method's row, as the fallback's read of it returns it - or
 * null when the person has none of that kind.
 */
function methodRow(
  kind: keyof Methods,
  row: Record<string, unknown>,
): (data: { query: Record<string, unknown> }) => Promise<unknown> {
  return async (data: { query: Record<string, unknown> }): Promise<unknown> => {
    const userId: string = userOf(data);

    if (!methodsOf[userId]?.[kind]) {
      return null;
    }

    return {
      id: new ObjectID(
        `7e5ae000-0000-4000-8000-${userId.slice(-4)}0000${String(
          Object.keys(row).length,
        ).padStart(4, "0")}`,
      ),
      isVerified: true,
      ...row,
    };
  };
}

beforeEach(() => {
  levels = [level(1, 30, [ANA]), level(2, 10, [BOB])];
  rulesOf = {
    [ANA.toString()]: [smsRule("+15550100")],
    [BOB.toString()]: [callRule("+15550200")],
    [SAM.toString()]: [],
  };
  // Sam: a verified number for texts and calls, and nothing free.
  methodsOf = { [SAM.toString()]: { sms: true, call: true } };
  optedOut = [];
  project = {
    enableSmsNotifications: true,
    enableCallNotifications: true,
    enableWhatsAppNotifications: true,
    enableTelegramNotifications: true,
    disableOnCallNotificationFallback: false,
  };
  ownTwilioFor = [];

  for (const setting of [
    MESSAGING_PRICE_SETTINGS.sms,
    MESSAGING_PRICE_SETTINGS.callPerMinute,
  ]) {
    savedPrices[setting] = process.env[setting];
  }

  process.env[MESSAGING_PRICE_SETTINGS.sms] = String(SMS_PRICE);
  process.env[MESSAGING_PRICE_SETTINGS.callPerMinute] = String(CALL_PRICE);

  jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
  jest.spyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);

  jest
    .spyOn(IncidentSeverityService, "findOneBy")
    .mockResolvedValue({ name: "Critical" } as never);
  jest
    .spyOn(AlertSeverityService, "findOneBy")
    .mockResolvedValue({ name: "High" } as never);

  // The preview and the fallback read the same project row.
  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    return { _id: PROJECT.toString(), ...project };
  }) as never);

  jest
    .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
    .mockImplementation((async (
      _projectId: ObjectID,
      kind: TwilioMessageKind,
    ) => {
      return ownTwilioFor.includes(kind) ? ({} as never) : undefined;
    }) as never);

  jest.spyOn(UserService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }) => {
    const user: User = new User();
    user.id = data.id;
    user.name = new Name(NAMES[data.id.toString()] || "Someone");
    return user;
  }) as never);

  // The policy's levels, and whom each names directly.
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "findBy")
    .mockImplementation((async () => {
      return levels.map((each: Level) => {
        return {
          id: each.id,
          order: each.order,
          escalateAfterInMinutes: each.escalateAfterInMinutes,
        };
      });
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
    .mockImplementation((async (data: { query: Record<string, unknown> }) => {
      const ruleId: string = String(
        data.query["onCallDutyPolicyEscalationRuleId"],
      );
      const found: Level | undefined = levels.find((each: Level): boolean => {
        return each.id.toString() === ruleId;
      });

      return (found?.people || []).map((userId: ObjectID) => {
        return { userId: userId };
      });
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "getAwayOverride")
    .mockResolvedValue(null as never);
  jest
    .spyOn(ProjectMembership, "getMemberUserIds")
    .mockImplementation((async (data: { userIds: Array<ObjectID> }) => {
      return new Set<string>(
        data.userIds.map((userId: ObjectID): string => {
          return userId.toString().toLowerCase();
        }),
      );
    }) as never);
  jest.spyOn(ProjectMembership, "isMember").mockResolvedValue(true as never);

  // A person's rules for the severity, and whether they opted out of it.
  jest
    .spyOn(UserNotificationRuleService, "findBy")
    .mockImplementation((async (data: { query: Record<string, unknown> }) => {
      const userId: string =
        readUserIdWhileMember(data.query["userId"])?.userId || "";

      return rulesOf[userId] || [];
    }) as never);
  jest
    .spyOn(UserNotificationRuleService, "findOneBy")
    .mockImplementation((async (data: { query: Record<string, unknown> }) => {
      return optedOut.includes(userOf(data))
        ? { id: ObjectID.generate() }
        : null;
    }) as never);

  // What the fallback's reader finds of each person's verified methods.
  jest
    .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
    .mockResolvedValue(false as never);
  jest.spyOn(UserPushService, "findOneBy").mockImplementation(
    methodRow("push", {
      deviceName: "Pixel 8",
      deviceType: "android",
    }) as never,
  );
  jest
    .spyOn(UserEmailService, "findOneBy")
    .mockImplementation(
      methodRow("email", { email: new Email("sam@example.com") }) as never,
    );
  jest
    .spyOn(UserSlackService, "findOneBy")
    .mockImplementation(methodRow("slack", { slackUserName: "sam" }) as never);
  jest
    .spyOn(UserMicrosoftTeamsService, "findOneBy")
    .mockImplementation(
      methodRow("teams", { microsoftTeamsUserName: "Sam Rivera" }) as never,
    );
  jest
    .spyOn(UserMattermostService, "findOneBy")
    .mockImplementation(
      methodRow("mattermost", { mattermostUserName: "sam" }) as never,
    );
  jest
    .spyOn(CustomNotificationChannelService, "getChannelsPagingEveryone")
    .mockResolvedValue([] as never);
  jest
    .spyOn(UserSmsService, "findOneBy")
    .mockImplementation(
      methodRow("sms", { phone: new Phone("+15550300") }) as never,
    );
  jest
    .spyOn(UserCallService, "findOneBy")
    .mockImplementation(
      methodRow("call", { phone: new Phone("+15550301") }) as never,
    );
  jest
    .spyOn(UserWhatsAppService, "findOneBy")
    .mockImplementation(
      methodRow("whatsApp", { phone: new Phone("+15550302") }) as never,
    );
  jest
    .spyOn(UserTelegramService, "findOneBy")
    .mockImplementation(
      methodRow("telegram", { telegramUserHandle: "@sam" }) as never,
    );
  jest.spyOn(UserWebhookService, "findOneBy").mockImplementation(
    methodRow("webhook", {
      name: "Sam's pager bridge",
      webhookUrl: "https://hooks.example.com/sam",
    }) as never,
  );

  fallbackRead = jest.spyOn(UserNotificationRuleService, "getFallbackRules");
});

afterEach(() => {
  for (const [setting, value] of Object.entries(savedPrices)) {
    if (value === undefined) {
      delete process.env[setting];
    } else {
      process.env[setting] = value;
    }
  }

  jest.restoreAllMocks();
});

// A test of one person, sent by `callerUserId`.
async function previewPerson(
  userId: ObjectID,
  callerUserId: ObjectID = ANA,
): Promise<OnCallTestPagePreview> {
  return await OnCallTestPageService.getPreview({
    projectId: PROJECT,
    callerUserId: callerUserId,
    recordKind: OnCallTestPageRecordKind.Incident,
    severityId: SEVERITY,
    targetUserId: userId,
  });
}

async function previewPolicy(): Promise<OnCallTestPagePreview> {
  return await OnCallTestPageService.getPreview({
    projectId: PROJECT,
    callerUserId: ANA,
    recordKind: OnCallTestPageRecordKind.Incident,
    severityId: SEVERITY,
    policyId: POLICY,
  });
}

function channelsOf(
  person: OnCallTestPagePreviewPerson,
): Array<OnCallPageChannel> {
  return person.methods.map(
    (method: OnCallTestPagePreviewMethod): OnCallPageChannel => {
      return method.channel;
    },
  );
}

function personNamed(
  people: Array<OnCallTestPagePreviewPerson>,
  name: string,
): OnCallTestPagePreviewPerson {
  const person: OnCallTestPagePreviewPerson | undefined = people.find(
    (each: OnCallTestPagePreviewPerson): boolean => {
      return each.userName === name;
    },
  );

  expect(person).toBeDefined();

  return person!;
}

function warningCodesOf(
  person: OnCallTestPagePreviewPerson,
): Array<OnCallTestPageWarningCode> {
  return (person.warningCodes || []).map(
    (warning: { code: OnCallTestPageWarningCode }) => {
      return warning.code;
    },
  );
}

// What a cost sends and what of it the balance pays for, texts and calls.
function textsAndCalls(cost: OnCallTestPageCost | undefined): {
  sent: [number, number];
  paid: [number, number];
} {
  return {
    sent: [cost?.smsCount || 0, cost?.callCount || 0],
    paid: [cost?.paidSmsCount || 0, cost?.paidCallCount || 0],
  };
}

describe("a person with no rule for the severity is listed with what the fallback sends them (#7262)", () => {
  test("a verified text number and phone, nothing free: the fallback's one paid method - the text - is listed and priced", async () => {
    const preview: OnCallTestPagePreview = await previewPerson(SAM);
    const sam: OnCallTestPagePreviewPerson = preview.people[0]!;

    expect(sam.hasNoRule).toBe(true);
    // One paid channel, as a real page sends: the text, never the call too.
    expect(sam.methods).toEqual([
      {
        channel: OnCallPageChannel.SMS,
        notifyAfterMinutes: 0,
        isVerified: true,
        canAcknowledge: true,
        isFallback: true,
      },
    ]);
    expect(warningCodesOf(sam)).toEqual([
      OnCallTestPageWarningCode.NoRuleFallsBackToListed,
    ]);
    expect(sam.warnings).toEqual([
      "No on-call rule covers this severity: like a real page, the test falls back to the method above.",
    ]);
    expect(preview.cost).toEqual({
      isPaid: true,
      smsCount: 1,
      callCount: 0,
      whatsAppCount: 0,
      telegramCount: 0,
      paidSmsCount: 1,
      paidCallCount: 0,
      paidWhatsAppCount: 0,
      paidTelegramCount: 0,
      estimatedCostInUSDCents: SMS_PRICE,
    });
  });

  test("it is read by the fallback's own reader, once, for the person and the kind of page tested", async () => {
    await OnCallTestPageService.getPreview({
      projectId: PROJECT,
      callerUserId: ANA,
      recordKind: OnCallTestPageRecordKind.Alert,
      severityId: SEVERITY,
      targetUserId: SAM,
    });

    expect(fallbackRead).toHaveBeenCalledTimes(1);
    expect(fallbackRead.mock.calls[0]![0]).toEqual({
      projectId: PROJECT,
      userId: SAM,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    });
  });

  test("texts switched off in the project: the fallback calls instead, and the call is priced", async () => {
    project.enableSmsNotifications = false;

    const preview: OnCallTestPagePreview = await previewPerson(SAM);

    expect(channelsOf(preview.people[0]!)).toEqual([OnCallPageChannel.Call]);
    // The fallback never picks a channel that is off, so nothing warns of one.
    expect(warningCodesOf(preview.people[0]!)).toEqual([
      OnCallTestPageWarningCode.NoRuleFallsBackToListed,
    ]);
    expect(textsAndCalls(preview.cost)).toEqual({
      sent: [0, 1],
      paid: [0, 1],
    });
    expect(preview.cost.estimatedCostInUSDCents).toBe(CALL_PRICE);
  });

  test("with a verified email too, the fallback emails them for free, and the test costs nothing", async () => {
    methodsOf[SAM.toString()] = { email: true, sms: true, call: true };

    const preview: OnCallTestPagePreview = await previewPerson(SAM);

    expect(channelsOf(preview.people[0]!)).toEqual([OnCallPageChannel.Email]);
    expect(preview.cost.isPaid).toBe(false);
    expect(preview.cost.estimatedCostInUSDCents).toBeUndefined();
  });

  test("every free method they have, in the order the fallback sends them", async () => {
    methodsOf[SAM.toString()] = {
      push: true,
      email: true,
      slack: true,
      teams: true,
      mattermost: true,
      sms: true,
    };

    const preview: OnCallTestPagePreview = await previewPerson(SAM);

    expect(channelsOf(preview.people[0]!)).toEqual([
      OnCallPageChannel.Push,
      OnCallPageChannel.Email,
      OnCallPageChannel.Slack,
      OnCallPageChannel.MicrosoftTeams,
      OnCallPageChannel.Mattermost,
    ]);
    expect(
      preview.people[0]!.methods.every(
        (method: OnCallTestPagePreviewMethod): boolean => {
          return method.isFallback === true && method.isVerified;
        },
      ),
    ).toBe(true);
    // More than one method listed: "the methods above".
    expect(preview.people[0]!.warnings).toEqual([
      "No on-call rule covers this severity: like a real page, the test falls back to the methods above.",
    ]);
    expect(preview.cost.isPaid).toBe(false);
  });

  test("WhatsApp, the only verified method on a channel that is on: listed, and paid from the balance", async () => {
    methodsOf[SAM.toString()] = { sms: true, whatsApp: true };
    project.enableSmsNotifications = false;

    const preview: OnCallTestPagePreview = await previewPerson(SAM);

    expect(channelsOf(preview.people[0]!)).toEqual([
      OnCallPageChannel.WhatsApp,
    ]);
    expect(preview.cost.whatsAppCount).toBe(1);
    expect(preview.cost.paidWhatsAppCount).toBe(1);
    expect(preview.cost.isPaid).toBe(true);
  });

  test("only a webhook: the webhook is listed, at no cost", async () => {
    methodsOf[SAM.toString()] = { webhook: true };

    const preview: OnCallTestPagePreview = await previewPerson(SAM);

    expect(channelsOf(preview.people[0]!)).toEqual([OnCallPageChannel.Webhook]);
    expect(preview.cost.isPaid).toBe(false);
  });

  test("nothing the fallback may use: no method is listed, and the preview says the test sends them nothing", async () => {
    methodsOf[SAM.toString()] = { sms: true };
    project.enableSmsNotifications = false;

    const preview: OnCallTestPagePreview = await previewPerson(SAM);

    expect(preview.people[0]!.methods).toEqual([]);
    expect(preview.people[0]!.warningCodes).toEqual([
      {
        code: OnCallTestPageWarningCode.NoRuleNothingToFallBackTo,
        message:
          "No on-call rule covers this severity, and no verified method can be used instead: the test sends nothing.",
      },
    ]);
    expect(preview.cost.isPaid).toBe(false);
  });

  test("the project's fallback off: nothing is listed or priced, and the fallback is never asked", async () => {
    project.disableOnCallNotificationFallback = true;

    const preview: OnCallTestPagePreview = await previewPerson(SAM);

    expect(preview.people[0]!.methods).toEqual([]);
    expect(warningCodesOf(preview.people[0]!)).toEqual([
      OnCallTestPageWarningCode.NoRuleNoFallback,
    ]);
    expect(textsAndCalls(preview.cost)).toEqual({
      sent: [0, 0],
      paid: [0, 0],
    });
    expect(preview.cost.isPaid).toBe(false);
    expect(fallbackRead).not.toHaveBeenCalled();
  });

  test("opted out of the severity: nothing is listed or priced, and the fallback is never asked", async () => {
    optedOut = [SAM.toString()];

    const preview: OnCallTestPagePreview = await previewPerson(SAM);

    expect(preview.people[0]!.isOptedOut).toBe(true);
    expect(preview.people[0]!.methods).toEqual([]);
    expect(warningCodesOf(preview.people[0]!)).toEqual([
      OnCallTestPageWarningCode.OptedOut,
    ]);
    expect(preview.cost.isPaid).toBe(false);
    expect(fallbackRead).not.toHaveBeenCalled();
  });

  test("a person with a rule for the severity is never read by the fallback", async () => {
    const preview: OnCallTestPagePreview = await previewPerson(ANA);

    expect(preview.people[0]!.hasNoRule).toBe(false);
    expect(
      preview.people[0]!.methods.some(
        (method: OnCallTestPagePreviewMethod): boolean => {
          return Boolean(method.isFallback);
        },
      ),
    ).toBe(false);
    expect(fallbackRead).not.toHaveBeenCalled();
  });

  test("where to is shown to the person themselves only, as for the methods their rules name", async () => {
    methodsOf[SAM.toString()] = { push: true, email: true };

    const own: OnCallTestPagePreview = await previewPerson(SAM, SAM);

    expect(
      own.people[0]!.methods.map(
        (method: OnCallTestPagePreviewMethod): string | undefined => {
          return method.address;
        },
      ),
    ).toEqual(["Pixel 8", "sam@example.com"]);

    const someoneElses: OnCallTestPagePreview = await previewPerson(SAM, ANA);

    for (const method of someoneElses.people[0]!.methods) {
      expect(method.address).toBeUndefined();
    }
  });

  test("the view of who would be told reads a person without the fallback's methods, as it always did", async () => {
    const sam: OnCallTestPagePreviewPerson =
      await OnCallTestPageService.getPersonPreview({
        projectId: PROJECT,
        userId: SAM,
        recordKind: OnCallTestPageRecordKind.Incident,
        severityId: SEVERITY,
        showAddresses: false,
        project: { ...project } as never,
      });

    expect(sam.methods).toEqual([]);
    expect(warningCodesOf(sam)).toEqual([
      OnCallTestPageWarningCode.NoRuleFallsBack,
    ]);
    expect(fallbackRead).not.toHaveBeenCalled();
  });
});

describe("what the preview lists is what the fallback sends (#7262)", () => {
  /*
   * The fallback's delivery, run as a real page runs it - its claim and
   * membership check stood in for - with each rule it hands a sender
   * recorded, and read the way the preview reads a rule.
   */
  async function sentByTheFallback(): Promise<Array<OnCallPageChannel>> {
    const delivered: Array<UserNotificationRule> = [];

    jest
      .spyOn(UserOnCallLogService, "claimNotificationExecution")
      .mockResolvedValue(true as never);
    jest
      .spyOn(
        UserNotificationRuleService as unknown as {
          deliverNotificationForRule: (
            rule: UserNotificationRule,
            options: ExecuteNotificationRuleOptions,
          ) => Promise<boolean>;
        },
        "deliverNotificationForRule",
      )
      .mockImplementation((async (rule: UserNotificationRule) => {
        delivered.push(rule);
        return true;
      }) as never);

    const options: ExecuteFallbackNotificationOptions = {
      userId: SAM,
      projectId: PROJECT,
      userOnCallLogId: LOG,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      severityName: "Critical",
      userNotificationLogId: LOG,
      userNotificationEventType: UserNotificationEventType.TestPage,
      onCallPolicyId: undefined,
    };

    const result: FallbackNotificationResult =
      await UserNotificationRuleService.executeFallbackNotification(options);

    if (delivered.length === 0) {
      expect(result.outcome).toBe(
        FallbackNotificationOutcome.NoUsableNotificationMethod,
      );
    }

    return delivered.flatMap(
      (rule: UserNotificationRule): Array<OnCallPageChannel> => {
        return getPreviewMethodsOfRule({
          rule: rule,
          showAddresses: false,
        }).map((method: OnCallTestPagePreviewMethod): OnCallPageChannel => {
          return method.channel;
        });
      },
    );
  }

  const cases: Array<[string, Methods, Partial<ProjectSwitches>]> = [
    ["a text number and a phone", { sms: true, call: true }, {}],
    [
      "a text number and a phone, texts off",
      { sms: true, call: true },
      { enableSmsNotifications: false },
    ],
    [
      "WhatsApp and Telegram",
      { whatsApp: true, telegram: true },
      { enableWhatsAppNotifications: true },
    ],
    [
      "Telegram, WhatsApp off",
      { whatsApp: true, telegram: true },
      { enableWhatsAppNotifications: false },
    ],
    [
      "every free method and a phone",
      {
        push: true,
        email: true,
        slack: true,
        teams: true,
        mattermost: true,
        call: true,
      },
      {},
    ],
    ["an email and a webhook", { email: true, webhook: true }, {}],
    ["a webhook alone", { webhook: true }, {}],
    [
      "only methods on channels that are off",
      { sms: true, call: true },
      { enableSmsNotifications: false, enableCallNotifications: false },
    ],
    ["nothing at all", {}, {}],
  ];

  test.each(cases)(
    "%s: the preview lists exactly the channels the fallback hands a sender",
    async (
      _name: string,
      methods: Methods,
      switches: Partial<ProjectSwitches>,
    ) => {
      methodsOf[SAM.toString()] = methods;
      project = { ...project, ...switches };

      const preview: OnCallTestPagePreview = await previewPerson(SAM);

      expect(channelsOf(preview.people[0]!)).toEqual(await sentByTheFallback());
    },
  );
});

describe("a policy's test, priced with the people it reaches through the fallback (#7262)", () => {
  test("Sam on the first level with no rule: the first level's cost counts his text with Ana's", async () => {
    levels = [level(1, 30, [ANA, SAM]), level(2, 10, [BOB])];

    const preview: OnCallTestPagePreview = await previewPolicy();

    expect(channelsOf(personNamed(preview.people, "Sam Rivera"))).toEqual([
      OnCallPageChannel.SMS,
    ]);
    expect(textsAndCalls(preview.cost)).toEqual({
      sent: [2, 0],
      paid: [2, 0],
    });
    expect(preview.cost.estimatedCostInUSDCents).toBe(2 * SMS_PRICE);
    // Walking every level adds Bob's call at level 2.
    expect(textsAndCalls(preview.walkCost)).toEqual({
      sent: [2, 1],
      paid: [2, 1],
    });
    expect(preview.walkCost!.estimatedCostInUSDCents).toBe(
      2 * SMS_PRICE + CALL_PRICE,
    );
  });

  test("Sam on level 2 of a walk: the first level's cost leaves him out, the walk's counts him", async () => {
    levels = [level(1, 30, [ANA]), level(2, 10, [SAM])];

    const preview: OnCallTestPagePreview = await previewPolicy();
    const sam: OnCallTestPagePreviewPerson = personNamed(
      preview.walkLevels![0]!.people,
      "Sam Rivera",
    );

    expect(sam.hasNoRule).toBe(true);
    expect(channelsOf(sam)).toEqual([OnCallPageChannel.SMS]);
    expect(warningCodesOf(sam)).toEqual([
      OnCallTestPageWarningCode.NoRuleFallsBackToListed,
    ]);
    expect(textsAndCalls(preview.cost)).toEqual({
      sent: [1, 0],
      paid: [1, 0],
    });
    expect(textsAndCalls(preview.walkCost)).toEqual({
      sent: [2, 0],
      paid: [2, 0],
    });
    expect(preview.walkCost!.estimatedCostInUSDCents).toBe(2 * SMS_PRICE);
  });

  test("Sam with no rule as the only person a walk reaches: the walk is priced, the first level is not", async () => {
    levels = [level(1, 30, []), level(2, 10, [SAM])];

    const preview: OnCallTestPagePreview = await previewPolicy();

    expect(preview.cost.isPaid).toBe(false);
    expect(preview.walkCost!.isPaid).toBe(true);
    expect(preview.walkCost!.estimatedCostInUSDCents).toBe(SMS_PRICE);
  });

  test("named at two levels, Sam is read once and priced at each", async () => {
    levels = [level(1, 1, [SAM]), level(2, 1, [SAM])];

    const preview: OnCallTestPagePreview = await previewPolicy();

    expect(fallbackRead).toHaveBeenCalledTimes(1);
    expect(textsAndCalls(preview.walkCost)).toEqual({
      sent: [2, 0],
      paid: [2, 0],
    });
  });

  test("the project's fallback off: Sam's level costs nothing, first level or walk", async () => {
    levels = [level(1, 30, [ANA]), level(2, 10, [SAM])];
    project.disableOnCallNotificationFallback = true;

    const preview: OnCallTestPagePreview = await previewPolicy();

    expect(textsAndCalls(preview.walkCost)).toEqual({
      sent: [1, 0],
      paid: [1, 0],
    });
    expect(fallbackRead).not.toHaveBeenCalled();
  });
});

describe("what the project's balance pays for, beside what the test sends (#7263)", () => {
  test("its own Twilio for texts only: Ana's text is sent but not paid for; her call is, and is the amount", async () => {
    rulesOf[ANA.toString()] = [smsRule("+15550100"), callRule("+15550101")];
    ownTwilioFor = [TwilioMessageKind.SMS];

    const preview: OnCallTestPagePreview = await previewPerson(ANA);

    expect(textsAndCalls(preview.cost)).toEqual({
      sent: [1, 1],
      paid: [0, 1],
    });
    expect(preview.cost.isPaid).toBe(true);
    expect(preview.cost.estimatedCostInUSDCents).toBe(CALL_PRICE);
  });

  test("its own Twilio for texts: a fallback text is sent, and costs the balance nothing", async () => {
    ownTwilioFor = [TwilioMessageKind.SMS];

    const preview: OnCallTestPagePreview = await previewPerson(SAM);

    expect(channelsOf(preview.people[0]!)).toEqual([OnCallPageChannel.SMS]);
    expect(textsAndCalls(preview.cost)).toEqual({
      sent: [1, 0],
      paid: [0, 0],
    });
    expect(preview.cost.isPaid).toBe(false);
  });

  test("a walk with its own Twilio for calls: the walk sends Bob's call, and the balance pays for the texts only", async () => {
    levels = [level(1, 30, [ANA, SAM]), level(2, 10, [BOB])];
    ownTwilioFor = [TwilioMessageKind.Call];

    const preview: OnCallTestPagePreview = await previewPolicy();

    expect(textsAndCalls(preview.walkCost)).toEqual({
      sent: [2, 1],
      paid: [2, 0],
    });
    expect(preview.walkCost!.estimatedCostInUSDCents).toBe(2 * SMS_PRICE);
  });
});
