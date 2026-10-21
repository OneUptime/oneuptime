import AIBillingService from "../../../Server/Services/AIBillingService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import NotificationService from "../../../Server/Services/NotificationService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageSCIMService from "../../../Server/Services/StatusPageSCIMService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import AiCreditsUsedUpOwnerNotice, {
  AiCreditsUsedUpNoticeOutcome,
} from "../../../Server/Utils/AI/AiCreditsUsedUpOwnerNotice";
import ProjectAiDailyLimitOwnerNotice, {
  ProjectAiDailyLimitNoticeOutcome,
} from "../../../Server/Utils/AI/ProjectAiDailyLimitOwnerNotice";
import PlanDowngradeOwnerNotice, {
  PlanDowngradeNoticeOutcome,
} from "../../../Server/Utils/Billing/PlanDowngradeOwnerNotice";
import logger from "../../../Server/Utils/Logger";
import TeamPermissionHolders, {
  TeamMembershipRow,
  TeamPermissionRow,
} from "../../../Server/Utils/Permission/TeamPermissionHolders";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import { ProjectAiDailyLimit } from "../../../Types/AI/ProjectAiDailyLimits";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { useAiCreditsWorld } from "../TestingUtils/AiCreditsWorld";
import { useMessagingBalanceWorld } from "../TestingUtils/MessagingBalanceWorld";
import {
  ProjectOwnerRoster,
  ROSTER_NOT_OWNER_EMAILS,
  ROSTER_OWNER_EMAILS,
  ROSTER_PEOPLE,
  ROSTER_TEAMS,
  useProjectOwnerRoster,
} from "../TestingUtils/ProjectOwnerRoster";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * WHO THE OWNER EMAILS GO TO.
 *
 * A project's owners are the members who hold Project Owner, read by the
 * rule every permission check follows (Types/HeldPermissions, here through
 * Server/Utils/Permission/TeamPermissionHolders): an owner team's allow row
 * grants it, a team's block row never does, and a block with no labels takes
 * it away from everyone on that team - whatever an owner team they are also
 * on allows. ProjectService.getOwners used to list every accepted member of
 * every team with a Project Owner row, blocks included, so a member a team
 * blocked from being an owner got the owners' email about plan changes, the
 * plan cut-off, AI limits and credits and low balances.
 *
 * The cases (TestingUtils/ProjectOwnerRoster): alice is an owner; bob is on
 * the owner team and on a team that blocks Project Owner; carol's second team
 * blocks it for one label only, which limits records and an owner email
 * names none; dave was invited and has not accepted; erin was invited to the
 * blocking team and has not accepted, so it takes nothing away; frank is only
 * on the blocking team; grace has Manage Billing and no owner row.
 *
 * Then every owner email path is driven for real, down to the mail service,
 * and each must reach alice, carol and erin, and nobody else.
 */

type MockGlobal = typeof globalThis & {
  __ownerRuleDashboardUrl: string;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const urlModule: { default: { fromString: (url: string) => unknown } } =
    jest.requireActual("../../../Types/API/URL") as {
      default: { fromString: (url: string) => unknown };
    };
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockGlobal = globalThis as MockGlobal;
  mockGlobal.__ownerRuleDashboardUrl =
    "https://oneuptime.example.com/dashboard";

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return true;
    },
  });

  Object.defineProperty(mocked, "DashboardClientUrl", {
    configurable: true,
    enumerable: true,
    get: (): unknown => {
      return urlModule.default.fromString(mockGlobal.__ownerRuleDashboardUrl);
    },
  });

  return mocked;
});

const PROJECT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-0000000000f1",
);

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const savedPlanEnvironment: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUBSCRIPTION_PLAN_")) {
      savedPlanEnvironment[key] = process.env[key];
      delete process.env[key];
    }
  }

  Object.assign(process.env, PLAN_ENVIRONMENT);
});

afterAll(() => {
  for (const key of Object.keys(PLAN_ENVIRONMENT)) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(savedPlanEnvironment)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
});

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest.spyOn(logger, "info").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function emailsOf(users: Array<User>): Array<string> {
  return users.map((user: User): string => {
    return user.email!.toString();
  });
}

// Each address the mail service was handed, once, in the order it came.
function distinct(addresses: Array<string>): Array<string> {
  return addresses.filter((address: string, index: number): boolean => {
    return addresses.indexOf(address) === index;
  });
}

function expectOnlyTheOwnersTold(roster: ProjectOwnerRoster): void {
  const sentTo: Array<string> = roster.sentTo();

  expect(distinct(sentTo).sort()).toEqual([...ROSTER_OWNER_EMAILS].sort());

  for (const address of ROSTER_NOT_OWNER_EMAILS) {
    expect([address, sentTo.includes(address)]).toEqual([address, false]);
  }
}

describe("TeamPermissionHolders.getHolderIds: the one rule, read for people", () => {
  const ALLOW: TeamPermissionRow = {
    teamId: "team-owners",
    permission: Permission.ProjectOwner,
    isBlockPermission: false,
  };

  const BLOCK: TeamPermissionRow = {
    teamId: "team-blocked",
    permission: Permission.ProjectOwner,
    isBlockPermission: true,
  };

  const LABELLED_BLOCK: TeamPermissionRow = {
    teamId: "team-eu",
    permission: Permission.ProjectOwner,
    isBlockPermission: true,
    labelIds: ["7c000000-0000-4000-8000-0000000000e1"],
  };

  function holders(
    rows: Array<TeamPermissionRow>,
    memberships: Array<TeamMembershipRow>,
  ): Array<string> {
    return TeamPermissionHolders.getHolderIds({
      permission: Permission.ProjectOwner,
      rows,
      memberships,
    });
  }

  test("an allow row grants it to everyone on the team", () => {
    expect(
      holders(
        [ALLOW],
        [
          { teamId: "team-owners", userId: "user-1" },
          { teamId: "team-owners", userId: "user-2" },
        ],
      ),
    ).toEqual(["user-1", "user-2"]);
  });

  test("a block row grants nothing on its own", () => {
    expect(
      holders([BLOCK], [{ teamId: "team-blocked", userId: "user-1" }]),
    ).toEqual([]);
  });

  test("a block with no labels on another team takes it away, whatever the owner team allows", () => {
    expect(
      holders(
        [ALLOW, BLOCK],
        [
          { teamId: "team-owners", userId: "user-1" },
          { teamId: "team-owners", userId: "user-2" },
          { teamId: "team-blocked", userId: "user-2" },
        ],
      ),
    ).toEqual(["user-1"]);
  });

  test("a block on the owner team itself takes it away from all of its members", () => {
    expect(
      holders(
        [ALLOW, { ...BLOCK, teamId: "team-owners" }],
        [{ teamId: "team-owners", userId: "user-1" }],
      ),
    ).toEqual([]);
  });

  test("a block with labels limits only the records carrying them: it takes nothing away here", () => {
    expect(
      holders(
        [ALLOW, LABELLED_BLOCK],
        [
          { teamId: "team-owners", userId: "user-1" },
          { teamId: "team-eu", userId: "user-1" },
        ],
      ),
    ).toEqual(["user-1"]);
  });

  test("an allow row limited to some labels or to owned records still grants it, as requirePermission reads it", () => {
    expect(
      holders(
        [
          {
            ...ALLOW,
            labelIds: ["7c000000-0000-4000-8000-0000000000e2"],
          },
          {
            teamId: "team-owned",
            permission: Permission.ProjectOwner,
            scope: PermissionScope.Owned,
          },
        ],
        [
          { teamId: "team-owners", userId: "user-1" },
          { teamId: "team-owned", userId: "user-2" },
        ],
      ),
    ).toEqual(["user-1", "user-2"]);
  });

  test("rows for other permissions are not read: a Manage Billing allow makes no owner, a Project Admin block takes none away", () => {
    expect(
      holders(
        [
          {
            teamId: "team-finance",
            permission: Permission.ManageProjectBilling,
          },
          ALLOW,
          {
            teamId: "team-owners",
            permission: Permission.ProjectAdmin,
            isBlockPermission: true,
          },
        ],
        [
          { teamId: "team-finance", userId: "user-1" },
          { teamId: "team-owners", userId: "user-2" },
        ],
      ),
    ).toEqual(["user-2"]);
  });

  test("a row that does not say it is a block is an allow, as everywhere else", () => {
    expect(
      holders(
        [{ teamId: "team-owners", permission: Permission.ProjectOwner }],
        [{ teamId: "team-owners", userId: "user-1" }],
      ),
    ).toEqual(["user-1"]);
  });

  test("each person once, in the order their memberships come, ids as given or as ObjectIDs", () => {
    const userId: ObjectID = new ObjectID(
      "7a000000-0000-4000-8000-0000000000ff",
    );

    expect(
      holders(
        [ALLOW, { ...ALLOW, teamId: "team-owners-2" }],
        [
          { teamId: "team-owners", userId: userId },
          { teamId: "team-owners-2", userId: userId.toString() },
          { teamId: "team-owners", userId: "user-2" },
        ],
      ),
    ).toEqual([userId.toString(), "user-2"]);
  });

  test("nobody on a team with a row holds nothing", () => {
    expect(holders([ALLOW, BLOCK], [])).toEqual([]);
  });
});

describe("ProjectService.getOwners", () => {
  test("names the members who hold Project Owner: alice, carol and erin", async () => {
    useProjectOwnerRoster(PROJECT_ID);

    const owners: Array<User> = await ProjectService.getOwners(PROJECT_ID);

    expect(emailsOf(owners)).toEqual(ROSTER_OWNER_EMAILS);
  });

  test("not bob, whose other team blocks Project Owner", async () => {
    useProjectOwnerRoster(PROJECT_ID);

    expect(emailsOf(await ProjectService.getOwners(PROJECT_ID))).not.toContain(
      ROSTER_PEOPLE.bob.email,
    );
  });

  test("not dave, who has not accepted the owner team's invitation, and not frank or grace, whom no owner team allows", async () => {
    useProjectOwnerRoster(PROJECT_ID);

    const owners: Array<string> = emailsOf(
      await ProjectService.getOwners(PROJECT_ID),
    );

    for (const address of [
      ROSTER_PEOPLE.dave.email,
      ROSTER_PEOPLE.frank.email,
      ROSTER_PEOPLE.grace.email,
    ]) {
      expect(owners).not.toContain(address);
    }
  });

  test("reads every Project Owner row of the project - allows and blocks, with their labels - and the accepted members of those teams only", async () => {
    useProjectOwnerRoster(PROJECT_ID);

    await ProjectService.getOwners(PROJECT_ID);

    const rowsRead: jest.SpyInstance =
      TeamPermissionService.findBy as unknown as jest.SpyInstance;
    const membersRead: jest.SpyInstance =
      TeamMemberService.findBy as unknown as jest.SpyInstance;

    expect(rowsRead).toHaveBeenCalledTimes(1);
    expect(rowsRead.mock.calls[0]![0].query).toEqual({
      projectId: PROJECT_ID,
      permission: Permission.ProjectOwner,
    });
    expect(rowsRead.mock.calls[0]![0].select).toEqual(
      expect.objectContaining({
        teamId: true,
        isBlockPermission: true,
        labels: { _id: true },
      }),
    );
    expect(rowsRead.mock.calls[0]![0].props).toEqual({ isRoot: true });

    expect(membersRead).toHaveBeenCalledTimes(1);

    const membersQuery: Record<string, unknown> =
      membersRead.mock.calls[0]![0].query;

    expect(membersQuery["projectId"]).toEqual(PROJECT_ID);
    expect(membersQuery["hasAcceptedInvitation"]).toBe(true);

    const teamIds: Array<string> = Object.values(
      (
        membersQuery["teamId"] as {
          objectLiteralParameters: Record<string, Array<string>>;
        }
      ).objectLiteralParameters,
    )[0]!.map((teamId: unknown): string => {
      return String(teamId);
    });

    expect(teamIds.sort()).toEqual(
      [
        ROSTER_TEAMS.owners.toString(),
        ROSTER_TEAMS.contractors.toString(),
        ROSTER_TEAMS.euOnly.toString(),
      ].sort(),
    );
  });

  test("a project whose only Project Owner rows are blocks has no owners, and its memberships are not read", async () => {
    jest.spyOn(TeamPermissionService, "findBy").mockResolvedValue([
      {
        teamId: ROSTER_TEAMS.contractors,
        permission: Permission.ProjectOwner,
        isBlockPermission: true,
        labels: [],
      },
    ] as never);
    const membersRead: jest.SpyInstance = jest.spyOn(
      TeamMemberService,
      "findBy",
    );

    await expect(ProjectService.getOwners(PROJECT_ID)).resolves.toEqual([]);
    expect(membersRead).not.toHaveBeenCalled();
  });

  test("another project's rows make no owners here", async () => {
    useProjectOwnerRoster(PROJECT_ID);

    await expect(
      ProjectService.getOwners(
        new ObjectID("7d000000-0000-4000-8000-0000000000f2"),
      ),
    ).resolves.toEqual([]);
  });
});

describe("every owner email reaches the owners, and nobody blocked from being one", () => {
  test("sendEmailToProjectOwners, which most of them send through", async () => {
    const roster: ProjectOwnerRoster = useProjectOwnerRoster(PROJECT_ID);

    await ProjectService.sendEmailToProjectOwners(
      PROJECT_ID,
      "Subscription overdue",
      "Please update your payment method.",
    );

    expectOnlyTheOwnersTold(roster);
    expect(roster.sendMail).toHaveBeenCalledTimes(ROSTER_OWNER_EMAILS.length);
  });

  test("a plan change: what a downgrade stopped (PlanDowngradeOwnerNotice.notifyIfStopped)", async () => {
    const roster: ProjectOwnerRoster = useProjectOwnerRoster(PROJECT_ID);

    jest
      .spyOn(ApiKeyService, "countBy")
      .mockResolvedValue(new PositiveNumber(2));
    jest
      .spyOn(ProjectSCIMService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(StatusPageSCIMService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({ name: "Acme Production" } as unknown as Project);
    const recorded: jest.SpyInstance = jest
      .spyOn(ProjectService, "markPlanCutoffNoticeSent")
      .mockResolvedValue(undefined);

    await expect(
      PlanDowngradeOwnerNotice.notifyIfStopped({
        projectId: PROJECT_ID,
        fromPlanId: "price_growth_month",
        toPlanId: "price_free_month",
      }),
    ).resolves.toBe(PlanDowngradeNoticeOutcome.Told);

    expectOnlyTheOwnersTold(roster);
    expect(recorded).toHaveBeenCalledTimes(1);
  });

  test("the plan cut-off notice for a project already below its plan (notifyIfAlreadyBelowPlan), which waits for each email", async () => {
    const roster: ProjectOwnerRoster = useProjectOwnerRoster(PROJECT_ID);

    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Free,
      isSubscriptionUnpaid: false,
    });
    jest
      .spyOn(ApiKeyService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    jest
      .spyOn(ProjectSCIMService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    jest
      .spyOn(StatusPageSCIMService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({ name: "Acme Production" } as unknown as Project);
    jest.spyOn(ProjectService, "claimPlanCutoffNotice").mockResolvedValue(true);
    const waited: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "sendEmailToOwnersAndWait",
    );

    await expect(
      PlanDowngradeOwnerNotice.notifyIfAlreadyBelowPlan({
        projectId: PROJECT_ID,
      }),
    ).resolves.toBe(PlanDowngradeNoticeOutcome.Told);

    expectOnlyTheOwnersTold(roster);
    expect(emailsOf(waited.mock.calls[0]![0].owners)).toEqual(
      ROSTER_OWNER_EMAILS,
    );
  });

  test("a project whose only owners are blocked from being owners is not claimed by the cut-off notice: no one to tell", async () => {
    jest.spyOn(TeamPermissionService, "findBy").mockResolvedValue([
      {
        teamId: ROSTER_TEAMS.owners,
        permission: Permission.ProjectOwner,
        isBlockPermission: false,
        labels: [],
      },
      {
        teamId: ROSTER_TEAMS.owners,
        permission: Permission.ProjectOwner,
        isBlockPermission: true,
        labels: [],
      },
    ] as never);
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([
      {
        teamId: ROSTER_TEAMS.owners,
        userId: ROSTER_PEOPLE.bob.id,
        user: { id: ROSTER_PEOPLE.bob.id, email: ROSTER_PEOPLE.bob.email },
      },
    ] as never);
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Free,
      isSubscriptionUnpaid: false,
    });
    jest
      .spyOn(ApiKeyService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    jest
      .spyOn(ProjectSCIMService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(StatusPageSCIMService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    const claim: jest.SpyInstance = jest
      .spyOn(ProjectService, "claimPlanCutoffNotice")
      .mockResolvedValue(true);

    await expect(
      PlanDowngradeOwnerNotice.notifyIfAlreadyBelowPlan({
        projectId: PROJECT_ID,
      }),
    ).resolves.toBe(PlanDowngradeNoticeOutcome.NoOwners);
    expect(claim).not.toHaveBeenCalled();
  });

  test("a daily AI limit reached (ProjectAiDailyLimitOwnerNotice)", async () => {
    const roster: ProjectOwnerRoster = useProjectOwnerRoster(PROJECT_ID);

    jest
      .spyOn(ProjectService, "markAiDailyLimitReached")
      .mockResolvedValue(true);
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({ name: "Acme Production" } as unknown as Project);

    await expect(
      ProjectAiDailyLimitOwnerNotice.notifyIfFirstToday({
        projectId: new ObjectID("7d000000-0000-4000-8000-0000000000f1"),
        status: {
          reachedLimit: ProjectAiDailyLimit.Tokens,
          tokenLimit: 200_000,
          spendLimitInUSD: null,
          usage: { usedTokensToday: 201_234, spentTodayInUSDCents: 0 },
          resetsAt: new Date(Date.now() + 60 * 60 * 1000),
        },
        lastReachedAt: null,
      }),
    ).resolves.toBe(ProjectAiDailyLimitNoticeOutcome.Told);

    expectOnlyTheOwnersTold(roster);
  });

  test("AI credits used up (AiCreditsUsedUpOwnerNotice)", async () => {
    const roster: ProjectOwnerRoster = useProjectOwnerRoster(PROJECT_ID);

    jest
      .spyOn(ProjectService, "claimAiCreditsUsedUpNotice")
      .mockResolvedValue(true);
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      _id: PROJECT_ID.toString(),
      name: "Acme Production",
      aiCurrentBalanceInUSDCents: 0,
      enableAutoRechargeAiBalance: false,
    } as unknown as Project);

    await expect(
      AiCreditsUsedUpOwnerNotice.notifyIfFirst({
        projectId: PROJECT_ID,
        isAutoRechargeOn: false,
      }),
    ).resolves.toBe(AiCreditsUsedUpNoticeOutcome.Told);

    expectOnlyTheOwnersTold(roster);
  });

  test("AI credits: Auto Recharge could not charge the card (AIBillingService)", async () => {
    const world: ReturnType<typeof useAiCreditsWorld> = useAiCreditsWorld(
      PROJECT_ID,
      {
        aiCurrentBalanceInUSDCents: 0,
        enableAutoRechargeAiBalance: true,
        autoAiRechargeByBalanceInUSD: 20,
        autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
      },
    );
    // The world records the owners' emails; here the real ones go out.
    (
      ProjectService.sendEmailToProjectOwners as unknown as jest.SpyInstance
    ).mockRestore();
    const roster: ProjectOwnerRoster = useProjectOwnerRoster(PROJECT_ID);
    world.failChargesWith(new Error("Your card was declined."));

    await expect(
      AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID),
    ).rejects.toThrow("Your card was declined.");

    expectOnlyTheOwnersTold(roster);
  });

  test("AI credits: a recharge by hand is confirmed to the owners (AIBillingService.rechargeBalance)", async () => {
    useAiCreditsWorld(PROJECT_ID, { aiCurrentBalanceInUSDCents: 500 });
    (
      ProjectService.sendEmailToProjectOwners as unknown as jest.SpyInstance
    ).mockRestore();
    const roster: ProjectOwnerRoster = useProjectOwnerRoster(PROJECT_ID);

    await AIBillingService.rechargeBalance(PROJECT_ID, 25);

    expectOnlyTheOwnersTold(roster);
  });

  test("SMS and calls: Auto Recharge could not charge the card (NotificationService)", async () => {
    const world: ReturnType<typeof useMessagingBalanceWorld> =
      useMessagingBalanceWorld(PROJECT_ID, {
        smsOrCallCurrentBalanceInUSDCents: 0,
        enableAutoRechargeSmsOrCallBalance: true,
        autoRechargeSmsOrCallByBalanceInUSD: 20,
        autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
      });
    (
      ProjectService.sendEmailToProjectOwners as unknown as jest.SpyInstance
    ).mockRestore();
    const roster: ProjectOwnerRoster = useProjectOwnerRoster(PROJECT_ID);
    world.failChargesWith(new Error("Your card was declined."));

    await expect(
      NotificationService.rechargeIfBalanceIsLow(PROJECT_ID),
    ).rejects.toThrow("Your card was declined.");

    expectOnlyTheOwnersTold(roster);
  });

  test("SMS and calls: a recharge by hand is confirmed to the owners (NotificationService.rechargeBalance)", async () => {
    useMessagingBalanceWorld(PROJECT_ID, {
      smsOrCallCurrentBalanceInUSDCents: 500,
    });
    (
      ProjectService.sendEmailToProjectOwners as unknown as jest.SpyInstance
    ).mockRestore();
    const roster: ProjectOwnerRoster = useProjectOwnerRoster(PROJECT_ID);

    await NotificationService.rechargeBalance(PROJECT_ID, 25);

    expectOnlyTheOwnersTold(roster);
  });
});
