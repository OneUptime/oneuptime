import User from "../../../Models/DatabaseModels/User";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallTestPageService, {
  MESSAGING_PRICE_SETTINGS,
} from "../../../Server/Services/OnCallTestPageService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserService from "../../../Server/Services/UserService";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageCost,
  OnCallTestPageKind,
  OnCallTestPageNotPagedCode,
  OnCallTestPagePreview,
  OnCallTestPagePreviewLevel,
  OnCallTestPagePreviewPerson,
  OnCallTestPageReachedThroughCode,
  OnCallTestPageRecordKind,
  OnCallTestPageWarningCode,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import Phone from "../../../Types/Phone";
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

/*
 * WHAT A POLICY'S TEST THAT WALKS EVERY LEVEL WILL SEND, BEFORE IT IS SENT
 * (#7016): the levels after the first it reaches, nobody acknowledging it -
 * each when it starts at the earliest, with its people - the levels it ends
 * before, and what the whole walk costs at most.
 *
 * A walking test waits each level's own wait cut to two minutes, moves past
 * a level that pages nobody at once, follows the levels' order 1, 2, 3 and
 * stops at a gap, and ends fifteen minutes after it was sent.
 *
 * A text or a call is paid from the project's balance only on OneUptime
 * Cloud, and the billing flag is read when the module loads, so this file
 * pins billing on rather than following the environment it runs in.
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

const PROJECT: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000601");
const POLICY: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000602");
const SEVERITY: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000603");
const TEAM: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000604");
const SCHEDULE: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-000000000605");
const ANA: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-0000000006a1");
const BOB: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-0000000006b1");
const CARA: ObjectID = new ObjectID("7e5ae000-0000-4000-8000-0000000006c1");

const NAMES: Record<string, string> = {
  [ANA.toString()]: "Ana Lopez",
  [BOB.toString()]: "Bob Stone",
  [CARA.toString()]: "Cara Diaz",
};

// Prices, in US cents, as the Notification service reads them.
const SMS_PRICE: number = 10;
const CALL_PRICE: number = 25;

// One escalation level: its order, its wait, and who it names.
interface Level {
  id: ObjectID;
  order: number;
  escalateAfterInMinutes: number;
  people: Array<ObjectID>;
  teams?: Array<{ teamId: ObjectID; name: string }> | undefined;
  schedules?: Array<{ scheduleId: ObjectID; name: string }> | undefined;
}

function level(
  order: number,
  escalateAfterInMinutes: number,
  people: Array<ObjectID>,
  more?: Pick<Level, "teams" | "schedules">,
): Level {
  return {
    id: new ObjectID(
      `7e5ae000-0000-4000-8000-0000000007${String(order).padStart(2, "0")}`,
    ),
    order: order,
    escalateAfterInMinutes: escalateAfterInMinutes,
    people: people,
    ...(more || {}),
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

function emailRule(email: string, isVerified: boolean): UserNotificationRule {
  return {
    id: ObjectID.generate(),
    notifyAfterMinutes: 0,
    userEmail: { email: new Email(email), isVerified: isVerified },
  } as unknown as UserNotificationRule;
}

let levels: Array<Level>;
let rulesOf: Record<string, Array<UserNotificationRule>>;
let onCallIn: Record<string, ObjectID | null>;
let membersOf: Record<string, Array<ObjectID>>;
let ownTwilioFor: Array<TwilioMessageKind>;
// Whose on-call rules were read, and which levels' people, in order.
let rulesReadFor: Array<string>;
let levelsRead: Array<string>;

const savedPrices: Record<string, string | undefined> = {};

beforeEach(() => {
  levels = [level(1, 30, [ANA]), level(2, 10, [BOB])];
  rulesOf = {
    [ANA.toString()]: [smsRule("+15550100")],
    [BOB.toString()]: [callRule("+15550200")],
    [CARA.toString()]: [smsRule("+15550300"), callRule("+15550301")],
  };
  onCallIn = {};
  membersOf = {};
  ownTwilioFor = [];
  rulesReadFor = [];
  levelsRead = [];

  for (const setting of [
    MESSAGING_PRICE_SETTINGS.sms,
    MESSAGING_PRICE_SETTINGS.callPerMinute,
  ]) {
    savedPrices[setting] = process.env[setting];
  }

  process.env[MESSAGING_PRICE_SETTINGS.sms] = String(SMS_PRICE);
  process.env[MESSAGING_PRICE_SETTINGS.callPerMinute] = String(CALL_PRICE);

  jest
    .spyOn(IncidentSeverityService, "findOneBy")
    .mockResolvedValue({ name: "Critical" } as never);
  jest
    .spyOn(AlertSeverityService, "findOneBy")
    .mockResolvedValue({ name: "High" } as never);

  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    enableSmsNotifications: true,
    enableCallNotifications: true,
    enableWhatsAppNotifications: true,
    enableTelegramNotifications: true,
    disableOnCallNotificationFallback: false,
  } as never);

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

  const levelOf: (query: unknown) => Level | undefined = (
    query: unknown,
  ): Level | undefined => {
    const ruleId: string = String(
      (query as { onCallDutyPolicyEscalationRuleId: ObjectID })
        .onCallDutyPolicyEscalationRuleId,
    );

    return levels.find((each: Level): boolean => {
      return each.id.toString() === ruleId;
    });
  };

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
    .mockImplementation((async (data: { query: unknown }) => {
      return (levelOf(data.query)?.teams || []).map(
        (team: { teamId: ObjectID; name: string }) => {
          return { teamId: team.teamId, team: { name: team.name } };
        },
      );
    }) as never);

  jest.spyOn(TeamMemberService, "getUsersInTeams").mockImplementation((async (
    teamIds: Array<ObjectID>,
  ) => {
    return (membersOf[teamIds[0]!.toString()] || []).map((userId: ObjectID) => {
      return { id: userId };
    });
  }) as never);

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
    .mockImplementation((async (data: { query: unknown }) => {
      const found: Level | undefined = levelOf(data.query);

      levelsRead.push(found ? String(found.order) : "?");

      return (found?.people || []).map((userId: ObjectID) => {
        return { userId: userId };
      });
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
    .mockImplementation((async (data: { query: unknown }) => {
      return (levelOf(data.query)?.schedules || []).map(
        (schedule: { scheduleId: ObjectID; name: string }) => {
          return {
            onCallDutyPolicyScheduleId: schedule.scheduleId,
            onCallDutyPolicySchedule: { name: schedule.name },
            pageNextInRotation: false,
          };
        },
      );
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyScheduleService, "getCurrentOnCallInSchedule")
    .mockImplementation((async (scheduleId: ObjectID) => {
      const userId: ObjectID | null | undefined =
        onCallIn[scheduleId.toString()];
      return userId ? { userId: userId } : null;
    }) as never);

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

  jest
    .spyOn(UserNotificationRuleService, "findBy")
    .mockImplementation((async (data: { query: Record<string, unknown> }) => {
      const userId: string =
        readUserIdWhileMember(data.query["userId"])?.userId || "";

      rulesReadFor.push(userId);

      return rulesOf[userId] || [];
    }) as never);
  jest
    .spyOn(UserNotificationRuleService, "findOneBy")
    .mockResolvedValue(null as never);
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

async function previewPolicy(): Promise<OnCallTestPagePreview> {
  return await OnCallTestPageService.getPreview({
    projectId: PROJECT,
    callerUserId: ANA,
    recordKind: OnCallTestPageRecordKind.Incident,
    severityId: SEVERITY,
    policyId: POLICY,
  });
}

// Each level the walk reaches: its order, and the minute it starts.
function startsOf(preview: OnCallTestPagePreview): Array<[number, number]> {
  return (preview.walkLevels || []).map(
    (walked: OnCallTestPagePreviewLevel): [number, number] => {
      return [walked.order, walked.startsAfterMinutes];
    },
  );
}

function namesOf(people: Array<OnCallTestPagePreviewPerson>): Array<string> {
  return people.map((person: OnCallTestPagePreviewPerson): string => {
    return person.userName;
  });
}

function countsOf(
  cost: OnCallTestPageCost | undefined,
): Pick<OnCallTestPageCost, "smsCount" | "callCount"> {
  return { smsCount: cost?.smsCount || 0, callCount: cost?.callCount || 0 };
}

describe("a two-level policy (#7016)", () => {
  test("the second level is listed with its people, starting after the first level's wait cut to a test's two minutes", async () => {
    const preview: OnCallTestPagePreview = await previewPolicy();

    expect(preview.kind).toBe(OnCallTestPageKind.Policy);
    expect(preview.levelCount).toBe(2);
    expect(namesOf(preview.people)).toEqual(["Ana Lopez"]);
    expect(startsOf(preview)).toEqual([[2, 2]]);
    expect(namesOf(preview.walkLevels![0]!.people)).toEqual(["Bob Stone"]);
    expect(preview.walkLevels![0]!.notPaged).toEqual([]);
    expect(preview.walkLevels![0]!.notPagedCodes).toEqual([]);
    expect(preview.walkUnreachedLevelCount).toBe(0);
  });

  test("the first level's test costs its own text; a walk costs the second level's call too, from the project's balance", async () => {
    const preview: OnCallTestPagePreview = await previewPolicy();

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
    expect(preview.walkCost).toEqual({
      isPaid: true,
      smsCount: 1,
      callCount: 1,
      whatsAppCount: 0,
      telegramCount: 0,
      paidSmsCount: 1,
      paidCallCount: 1,
      paidWhatsAppCount: 0,
      paidTelegramCount: 0,
      estimatedCostInUSDCents: SMS_PRICE + CALL_PRICE,
    });
  });

  test("a walk whose later level only texts and calls through the project's own Twilio counts them, and does not charge for them", async () => {
    ownTwilioFor = [TwilioMessageKind.Call];

    const preview: OnCallTestPagePreview = await previewPolicy();

    expect(countsOf(preview.walkCost)).toEqual({ smsCount: 1, callCount: 1 });
    expect(preview.walkCost!.estimatedCostInUSDCents).toBe(SMS_PRICE);
    // What the balance pays for leaves the call out, as the amount does (#7263).
    expect(preview.walkCost!.paidSmsCount).toBe(1);
    expect(preview.walkCost!.paidCallCount).toBe(0);
  });

  test("somebody named by both levels is paged, and priced, at each", async () => {
    levels = [level(1, 30, [ANA]), level(2, 10, [ANA, BOB])];

    const preview: OnCallTestPagePreview = await previewPolicy();

    expect(namesOf(preview.walkLevels![0]!.people)).toEqual([
      "Ana Lopez",
      "Bob Stone",
    ]);
    expect(countsOf(preview.cost)).toEqual({ smsCount: 1, callCount: 0 });
    expect(countsOf(preview.walkCost)).toEqual({ smsCount: 2, callCount: 1 });
    expect(preview.walkCost!.estimatedCostInUSDCents).toBe(
      2 * SMS_PRICE + CALL_PRICE,
    );
  });

  test("each person's methods are read once, however many levels page them", async () => {
    levels = [level(1, 1, [ANA]), level(2, 1, [ANA]), level(3, 1, [ANA, BOB])];

    await previewPolicy();

    expect(
      rulesReadFor.filter((userId: string): boolean => {
        return userId === ANA.toString();
      }),
    ).toHaveLength(1);
    expect(
      rulesReadFor.filter((userId: string): boolean => {
        return userId === BOB.toString();
      }),
    ).toHaveLength(1);
  });
});

describe("when each later level starts", () => {
  test("a level whose own wait is shorter than a test's keeps it; one with none starts the next right away", async () => {
    levels = [
      level(1, 1, [ANA]),
      level(2, 0, [BOB]),
      level(3, 45, [CARA]),
      level(4, 5, [BOB]),
    ];

    const preview: OnCallTestPagePreview = await previewPolicy();

    expect(startsOf(preview)).toEqual([
      [2, 1],
      [3, 1],
      [4, 3],
    ]);
  });

  test("a level that pages nobody is passed at once: the next starts when it does", async () => {
    levels = [level(1, 30, [ANA]), level(2, 30, []), level(3, 30, [CARA])];

    const preview: OnCallTestPagePreview = await previewPolicy();

    expect(startsOf(preview)).toEqual([
      [2, 2],
      [3, 2],
    ]);
    expect(preview.walkLevels![0]!.people).toEqual([]);
    expect(preview.walkLevels![0]!.notPagedCodes).toEqual([
      {
        code: OnCallTestPageNotPagedCode.LevelNamesNobody,
        levelOrder: 2,
        message:
          "Escalation rule 2 pages nobody yet. Add people, a team or a schedule to it.",
      },
    ]);
    expect(preview.walkLevels![0]!.notPaged).toEqual([
      "Escalation rule 2 pages nobody yet. Add people, a team or a schedule to it.",
    ]);
  });

  test("a first level that pages nobody: the second starts right away, and the walk pages it", async () => {
    levels = [level(1, 30, []), level(2, 30, [BOB])];

    const preview: OnCallTestPagePreview = await previewPolicy();

    expect(preview.people).toEqual([]);
    expect(startsOf(preview)).toEqual([[2, 0]]);
    expect(countsOf(preview.cost)).toEqual({ smsCount: 0, callCount: 0 });
    expect(countsOf(preview.walkCost)).toEqual({ smsCount: 0, callCount: 1 });
  });

  test("levels the test ends before are counted, not listed - and their people are never read", async () => {
    levels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((order: number): Level => {
      return level(order, 5, [ANA]);
    });

    const preview: OnCallTestPagePreview = await previewPolicy();

    // Two minutes apart, and the test ends fifteen minutes after it was sent.
    expect(startsOf(preview)).toEqual([
      [2, 2],
      [3, 4],
      [4, 6],
      [5, 8],
      [6, 10],
      [7, 12],
      [8, 14],
    ]);
    expect(preview.walkUnreachedLevelCount).toBe(2);
    expect(levelsRead).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    // Ana is texted at each of the eight levels the walk reaches.
    expect(countsOf(preview.walkCost)).toEqual({ smsCount: 8, callCount: 0 });
    expect(preview.walkCost!.estimatedCostInUSDCents).toBe(8 * SMS_PRICE);
  });

  test("a gap in the levels' order ends the walk, as it ends a run", async () => {
    levels = [level(1, 1, [ANA]), level(2, 1, [BOB]), level(4, 1, [CARA])];

    const preview: OnCallTestPagePreview = await previewPolicy();

    expect(startsOf(preview)).toEqual([[2, 1]]);
    expect(preview.walkUnreachedLevelCount).toBe(1);
    expect(levelsRead).toEqual(["1", "2"]);
    expect(countsOf(preview.walkCost)).toEqual({ smsCount: 1, callCount: 1 });
  });
});

describe("what each later level says", () => {
  test("why each person is paged at that level, and why a target reaches nobody, as codes with their English", async () => {
    membersOf = { [TEAM.toString()]: [ANA, BOB] };
    levels = [
      level(1, 30, [ANA]),
      level(2, 30, [], {
        teams: [{ teamId: TEAM, name: "Platform" }],
        schedules: [{ scheduleId: SCHEDULE, name: "Primary rotation" }],
      }),
    ];

    const preview: OnCallTestPagePreview = await previewPolicy();
    const second: OnCallTestPagePreviewLevel = preview.walkLevels![0]!;

    // Named directly at the first level, through the team at the second.
    expect(preview.people[0]!.reachedThrough).toBeUndefined();
    expect(preview.people[0]!.reachedThroughCode).toBeUndefined();
    expect(
      second.people.map((person: OnCallTestPagePreviewPerson) => {
        return [
          person.userName,
          person.reachedThrough,
          person.reachedThroughCode,
        ];
      }),
    ).toEqual([
      [
        "Ana Lopez",
        "Team Platform",
        { code: OnCallTestPageReachedThroughCode.Team, name: "Platform" },
      ],
      [
        "Bob Stone",
        "Team Platform",
        { code: OnCallTestPageReachedThroughCode.Team, name: "Platform" },
      ],
    ]);
    expect(second.notPagedCodes).toEqual([
      {
        code: OnCallTestPageNotPagedCode.NobodyOnCall,
        scheduleName: "Primary rotation",
        message: "Nobody is on call in schedule Primary rotation now.",
      },
    ]);
  });

  test("a later level's people carry their warnings, as codes too", async () => {
    rulesOf[BOB.toString()] = [emailRule("bob@example.com", false)];

    const preview: OnCallTestPagePreview = await previewPolicy();
    const bob: OnCallTestPagePreviewPerson = preview.walkLevels![0]!.people[0]!;

    expect(bob.warningCodes).toEqual([
      {
        code: OnCallTestPageWarningCode.MethodNotVerified,
        channel: OnCallPageChannel.Email,
        message: "This Email method is not verified, so the test can't use it.",
      },
    ]);
    expect(bob.warnings).toEqual([
      "This Email method is not verified, so the test can't use it.",
    ]);
    // An unverified method is not sent, so it costs nothing.
    expect(countsOf(preview.walkCost)).toEqual({ smsCount: 1, callCount: 0 });
  });
});

describe("what has no walk", () => {
  test("a policy with one level: nothing to walk, and a walk costs what the first level does", async () => {
    levels = [level(1, 30, [ANA])];

    const preview: OnCallTestPagePreview = await previewPolicy();

    expect(preview.walkLevels).toEqual([]);
    expect(preview.walkUnreachedLevelCount).toBe(0);
    expect(preview.walkCost).toEqual(preview.cost);
  });

  test("a policy with no levels walks nothing", async () => {
    levels = [];

    const preview: OnCallTestPagePreview = await previewPolicy();

    expect(preview.people).toEqual([]);
    expect(preview.walkLevels).toEqual([]);
    expect(preview.walkUnreachedLevelCount).toBe(0);
    expect(preview.notPagedCodes).toEqual([
      {
        code: OnCallTestPageNotPagedCode.PolicyHasNoLevels,
        message:
          "This policy has no escalation rules yet, so a test pages nobody.",
      },
    ]);
  });

  test("a test of a person has no levels to walk, and no walk's cost", async () => {
    const preview: OnCallTestPagePreview =
      await OnCallTestPageService.getPreview({
        projectId: PROJECT,
        callerUserId: ANA,
        recordKind: OnCallTestPageRecordKind.Incident,
        severityId: SEVERITY,
        targetUserId: BOB,
      });

    expect(preview.kind).toBe(OnCallTestPageKind.Member);
    expect(preview.walkLevels).toBeUndefined();
    expect(preview.walkCost).toBeUndefined();
    expect(preview.notPagedCodes).toEqual([]);
    expect(preview.cost.estimatedCostInUSDCents).toBe(CALL_PRICE);
  });
});
