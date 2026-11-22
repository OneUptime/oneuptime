import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyOwnerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyOwnerUserService from "../../../Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import logger from "../../../Server/Utils/Logger";
import {
  ON_CALL_CHAT_INVITEE_UNNAMED,
  ON_CALL_CHAT_NOBODY_NAMED,
} from "../../../Server/Utils/OnCall/OnCallChatByWorkspace";
import OnDutyPoliciesCache from "../../../Server/Utils/OnCall/OnDutyPoliciesCache";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * NO ON-CALL LINE NAMES SOMEONE ONLY INVITED BY THEIR EMAIL ADDRESS (#10616).
 *
 * An escalation rule, an override or an owner can name someone invited who
 * has not joined the project yet (#10412). The policy's Slack, Microsoft
 * Teams and Mattermost channels can be read by people outside the project,
 * and so can its feed - posted to the channels, and taken anywhere by
 * workflows and the API - so neither may say their address. Each line
 * named them through UserService.getUserMarkdownString, which names
 * someone pending by the name typed for them, else by the address they
 * were invited at (#10175): "👨🏻‍💻 Added **ivy@invited.test** to on-call policy
 * Payments." The removal and owner entries printed the address after the
 * name as well.
 *
 * Now every on-call line names its people through OnCallChatByWorkspace:
 * someone only invited by the name typed with their invitation, else
 * "someone who hasn't joined the project yet" - as the coverage-gap lines
 * of #10586 did already. A member is named as before: by their name, else
 * by their address.
 *
 * These drive the real services and the real naming
 * (UserService.getUserMarkdownString, WorkspaceUtil.getUserStringForWorkspace),
 * with only what they read from the database faked: Ivy's account has a
 * name and an address of its own, which the project must never see either
 * (#9823), and she was invited at ivy@invited.test.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10616000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "10616000-0000-4000-8000-000000000002",
);
const RULE_ID: ObjectID = new ObjectID("10616000-0000-4000-8000-000000000003");

// Members: Ana has a name; Nell has none.
const ANA: ObjectID = new ObjectID("10616000-0000-4000-8000-0000000000a1");
const NELL: ObjectID = new ObjectID("10616000-0000-4000-8000-0000000000a2");
// Whoever makes the change.
const DANA: ObjectID = new ObjectID("10616000-0000-4000-8000-0000000000d1");
// Invited at ivy@invited.test, and not joined yet.
const IVY: ObjectID = new ObjectID("10616000-0000-4000-8000-0000000000e1");

const DASHBOARD: string = "https://oneuptime.test/dashboard";
const POLICY_LINK: string = `${DASHBOARD}/${PROJECT_ID.toString()}/on-call-duty/policies/${POLICY_ID.toString()}`;

function linkOf(userId: ObjectID): string {
  return `${DASHBOARD}/${PROJECT_ID.toString()}/users/${userId.toString()}`;
}

// The accounts as OneUptime reads them, as root.
const ACCOUNTS: Record<string, { name?: string; email: string }> = {
  [ANA.toString()]: { name: "Ana Lee", email: "ana@acme.test" },
  [NELL.toString()]: { email: "nell@acme.test" },
  [DANA.toString()]: { name: "Dana Fox", email: "dana@acme.test" },
  // Her own account's name and address: the project sees neither.
  [IVY.toString()]: { name: "Ivy Account-Name", email: "ivy@private.test" },
};

// Everything no line may ever say of Ivy.
const IVY_SECRETS: Array<string> = [
  "invited.test",
  "private.test",
  "Account-Name",
];

type FeedItem = Parameters<
  typeof OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem
>[0];

let items: Array<FeedItem>;
// The name typed with Ivy's invitation; undefined: she has joined.
let typedName: string | null | undefined;
let pendingReads: Array<Array<string>>;

const ALL_WORKSPACES: Array<WorkspaceType> = [
  WorkspaceType.Slack,
  WorkspaceType.MicrosoftTeams,
  WorkspaceType.Mattermost,
];

function connect(workspaceTypes: Array<WorkspaceType>): void {
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
    .mockResolvedValue(
      workspaceTypes.map(
        (workspaceType: WorkspaceType): WorkspaceProjectAuthToken => {
          const auth: WorkspaceProjectAuthToken =
            new WorkspaceProjectAuthToken();
          auth.workspaceType = workspaceType;
          auth.authToken = "token";
          return auth;
        },
      ),
    );
}

// Every word of the entries: the feed's, the shared line's, each workspace's.
function everythingSaid(): Array<string> {
  return items.flatMap((item: FeedItem): Array<string> => {
    return [
      item.feedInfoInMarkdown,
      item.chatInfoInMarkdown || "",
      ...Object.values(item.chatInfoByWorkspaceType || {}),
    ];
  });
}

function expectNothingOfIvysAddress(): void {
  expect(items.length).toBeGreaterThan(0);

  for (const words of everythingSaid()) {
    for (const secret of IVY_SECRETS) {
      expect(words).not.toContain(secret);
    }
  }
}

// What the lines call Ivy, for each name that can be typed for her.
const TYPED_NAMES: Array<{
  typed: string | null;
  named: string;
  why: string;
}> = [
  { typed: "Ivy", named: "Ivy", why: "the name typed" },
  {
    typed: null,
    named: ON_CALL_CHAT_INVITEE_UNNAMED,
    why: "no name typed",
  },
  {
    typed: "   ",
    named: ON_CALL_CHAT_INVITEE_UNNAMED,
    why: "only spaces typed",
  },
  {
    typed: "ivy@invited.test",
    named: ON_CALL_CHAT_INVITEE_UNNAMED,
    why: "an address typed as the name",
  },
];

beforeEach(() => {
  items = [];
  pendingReads = [];
  typedName = "Ivy";

  connect(ALL_WORKSPACES);

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD));

  // Nobody connected a workspace account: every name is OneUptime's.
  jest
    .spyOn(WorkspaceUserAuthTokenService, "getUserAuth")
    .mockResolvedValue(null as never);

  jest.spyOn(UserService, "findOneBy").mockImplementation((async (data: {
    query: { _id: ObjectID | string };
  }): Promise<User | null> => {
    const account: { name?: string; email: string } | undefined =
      ACCOUNTS[data.query._id.toString()];

    if (!account) {
      return null;
    }

    const user: User = new User();
    user._id = data.query._id.toString();

    if (account.name) {
      user.name = new Name(account.name);
    }

    user.email = new Email(account.email);

    return user;
  }) as never);

  jest
    .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
    .mockImplementation((async (data: {
      userIds: Array<string>;
    }): Promise<Map<string, WithheldProfile>> => {
      pendingReads.push(data.userIds);

      const withheld: Map<string, WithheldProfile> = new Map<
        string,
        WithheldProfile
      >();

      for (const userId of data.userIds) {
        if (
          typedName !== undefined &&
          userId.toLowerCase() === IVY.toString().toLowerCase()
        ) {
          withheld.set(userId.toLowerCase(), {
            inviteeName: typedName,
            inviteeEmail: "ivy@invited.test",
          });
        }
      }

      return withheld;
    }) as never);

  jest.spyOn(UserService, "getTimezoneForUser").mockResolvedValue(null);
  // The policy's schedules: none, so Mattermost's moments read in UTC.
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyName")
    .mockResolvedValue("Payments");
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(URL.fromString(POLICY_LINK));

  jest
    .spyOn(OnCallDutyPolicyFeedService, "createOnCallDutyPolicyFeedItem")
    .mockImplementation((async (item: FeedItem): Promise<void> => {
      items.push(item);
    }) as never);

  jest
    .spyOn(OnDutyPoliciesCache, "forgetProjects")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "startTimeLogForUser")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "endTimeLogForUser")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---- The lines, through the real services ----

function ruleRow(userId: ObjectID): OnCallDutyPolicyEscalationRuleUser {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy._id = POLICY_ID.toString();
  policy.name = "Payments";

  const rule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  rule._id = RULE_ID.toString();
  rule.name = "First line";
  rule.order = 1;

  const user: User = new User();
  user._id = userId.toString();

  const row: OnCallDutyPolicyEscalationRuleUser =
    new OnCallDutyPolicyEscalationRuleUser();
  row._id = ObjectID.generate().toString();
  row.projectId = PROJECT_ID;
  row.onCallDutyPolicy = policy;
  row.onCallDutyPolicyEscalationRule = rule;
  row.user = user;
  row.createdByUserId = DANA;

  return row;
}

async function addToRule(userId: ObjectID): Promise<void> {
  const row: OnCallDutyPolicyEscalationRuleUser = ruleRow(userId);

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findOneById")
    .mockResolvedValue(row as never);

  await (
    OnCallDutyPolicyEscalationRuleUserService as unknown as {
      onCreateSuccess: (
        onCreate: unknown,
        createdItem: OnCallDutyPolicyEscalationRuleUser,
      ) => Promise<unknown>;
    }
  ).onCreateSuccess({}, row);
}

async function takeOffRule(userId: ObjectID): Promise<void> {
  jest
    .spyOn(
      OnCallDutyPolicyEscalationRuleUserService,
      "findRowsAndHoldDeleteToThem",
    )
    .mockResolvedValue([ruleRow(userId)] as never);

  await (
    OnCallDutyPolicyEscalationRuleUserService as unknown as {
      onBeforeDelete: (deleteBy: unknown) => Promise<unknown>;
    }
  ).onBeforeDelete({
    query: { _id: ObjectID.generate() },
    props: { userId: DANA },
  });
}

const FROM: Date = new Date("2026-11-23T09:00:00.000Z");
const UNTIL: Date = new Date("2026-11-27T17:00:00.000Z");

function stubOverrideRosters(): void {
  for (const method of [
    "refreshRostersForOverrideUser",
    "propagateShiftChangeForOverrides",
  ]) {
    jest
      .spyOn(OnCallDutyPolicyUserOverrideService as never, method as never)
      .mockResolvedValue(undefined as never);
  }
}

async function addOverride(data: {
  away: ObjectID;
  cover?: ObjectID | undefined;
}): Promise<void> {
  stubOverrideRosters();

  const override: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();
  override._id = ObjectID.generate().toString();
  override.projectId = PROJECT_ID;
  override.onCallDutyPolicyId = POLICY_ID;
  override.overrideUserId = data.away;

  if (data.cover) {
    override.routeAlertsToUserId = data.cover;
  }

  override.startsAt = FROM;
  override.endsAt = UNTIL;
  override.createdByUserId = DANA;

  await (
    OnCallDutyPolicyUserOverrideService as unknown as {
      onCreateSuccess: (
        onCreate: unknown,
        createdItem: OnCallDutyPolicyUserOverride,
      ) => Promise<unknown>;
    }
  ).onCreateSuccess({}, override);
}

async function changeOverrideCover(data: {
  away: ObjectID;
  coverBefore: ObjectID | null;
  coverAfter: ObjectID | null;
}): Promise<void> {
  const after: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();

  if (data.coverAfter) {
    after.routeAlertsToUserId = data.coverAfter;
  }

  after.startsAt = FROM;
  after.endsAt = UNTIL;

  await (
    OnCallDutyPolicyUserOverrideService as unknown as {
      addChangedFeedItem: (data: unknown) => Promise<void>;
    }
  ).addChangedFeedItem({
    before: {
      id: ObjectID.generate().toString(),
      projectId: PROJECT_ID,
      onCallDutyPolicyId: POLICY_ID,
      overrideUserId: data.away,
      routeAlertsToUserId: data.coverBefore,
      startsAt: FROM,
      endsAt: UNTIL,
    },
    after: after,
    userId: DANA,
  });
}

async function removeOverride(away: ObjectID): Promise<void> {
  const override: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();
  override.onCallDutyPolicyId = POLICY_ID;
  override.projectId = PROJECT_ID;
  override.overrideUserId = away;
  override.startsAt = FROM;
  override.endsAt = UNTIL;

  jest
    .spyOn(OnCallDutyPolicyUserOverrideService, "findRowsAndHoldDeleteToThem")
    .mockResolvedValue([override] as never);
  // The team rule is not what this is about.
  jest
    .spyOn(OnCallDutyPolicyUserOverrideService as never, "checkTeamAccess")
    .mockResolvedValue(undefined as never);

  await (
    OnCallDutyPolicyUserOverrideService as unknown as {
      onBeforeDelete: (deleteBy: unknown) => Promise<unknown>;
    }
  ).onBeforeDelete({
    query: { _id: ObjectID.generate() },
    props: { userId: DANA },
  });
}

function ownerRow(userId: ObjectID): OnCallDutyPolicyOwnerUser {
  const row: OnCallDutyPolicyOwnerUser = new OnCallDutyPolicyOwnerUser();
  row._id = ObjectID.generate().toString();
  row.projectId = PROJECT_ID;
  row.onCallDutyPolicyId = POLICY_ID;
  row.userId = userId;
  row.createdByUserId = DANA;
  return row;
}

async function addOwner(userId: ObjectID): Promise<void> {
  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "getNotificationRulesWhereInviteOwnersIsTrue",
    )
    .mockResolvedValue([] as never);
  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "inviteUsersBasedOnRulesAndWorkspaceChannels",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OnCallDutyPolicyService, "getWorkspaceChannelForOnCallDutyPolicy")
    .mockResolvedValue([] as never);

  await OnCallDutyPolicyOwnerUserService.onCreateSuccess(
    { createBy: { props: {} } } as never,
    ownerRow(userId),
  );
}

async function removeOwner(userId: ObjectID): Promise<void> {
  await (
    OnCallDutyPolicyOwnerUserService as unknown as {
      onDeleteSuccess: (
        onDelete: unknown,
        itemIds: Array<ObjectID>,
      ) => Promise<unknown>;
    }
  ).onDeleteSuccess(
    {
      deleteBy: { props: { userId: DANA } },
      carryForward: { itemsToDelete: [ownerRow(userId)] },
    },
    [],
  );
}

// ---- The cases ----

describe("a person added to an escalation rule", () => {
  test.each(TYPED_NAMES)(
    "REGRESSION: someone only invited ($why) is named '$named' in the feed and in every channel, never by an address",
    async ({ typed, named }: { typed: string | null; named: string }) => {
      typedName = typed;

      await addToRule(IVY);

      expect(items).toHaveLength(1);
      expect(items[0]!.feedInfoInMarkdown).toBe(
        mdText`👨🏻‍💻 Added **${named}** to the [On-Call Policy Payments](${POLICY_LINK}) escalation rule **First line** with order **1**.`.toString(),
      );

      const line: string =
        mdText`👨🏻‍💻 Added **${named}** to on-call policy [Payments](${POLICY_LINK}).`.toString();

      expect(items[0]!.chatInfoInMarkdown).toBe(line);
      expect(items[0]!.chatInfoByWorkspaceType).toEqual({
        [WorkspaceType.Slack]: line,
        [WorkspaceType.MicrosoftTeams]: line,
        [WorkspaceType.Mattermost]: line,
      });
      expectNothingOfIvysAddress();
    },
  );

  test("a member is named as before: by their name, a link to their page", async () => {
    await addToRule(ANA);

    expect(items[0]!.feedInfoInMarkdown).toBe(
      `👨🏻‍💻 Added **[Ana Lee](${linkOf(ANA)})** to the [On-Call Policy Payments](${POLICY_LINK}) escalation rule **First line** with order **1**.`,
    );
    expect(items[0]!.chatInfoByWorkspaceType?.[WorkspaceType.Slack]).toBe(
      `👨🏻‍💻 Added **[Ana Lee](${linkOf(ANA)})** to on-call policy [Payments](${POLICY_LINK}).`,
    );
  });

  test("a member with no name is still named by their address: they joined, and the project knows them by it", async () => {
    await addToRule(NELL);

    expect(items[0]!.chatInfoByWorkspaceType?.[WorkspaceType.Slack]).toBe(
      `👨🏻‍💻 Added **[nell@acme.test](${linkOf(NELL)})** to on-call policy [Payments](${POLICY_LINK}).`,
    );
  });

  test("once Ivy has joined, she is named by her own name, as any member", async () => {
    typedName = undefined;

    await addToRule(IVY);

    expect(items[0]!.chatInfoInMarkdown).toBe(
      `👨🏻‍💻 Added **[Ivy Account-Name](${linkOf(IVY)})** to on-call policy [Payments](${POLICY_LINK}).`,
    );
  });
});

describe("a person taken out of an escalation rule", () => {
  test.each(TYPED_NAMES)(
    "REGRESSION: someone only invited ($why) is named '$named', with no address after the name",
    async ({ typed, named }: { typed: string | null; named: string }) => {
      typedName = typed;

      await takeOffRule(IVY);

      expect(items).toHaveLength(1);
      expect(items[0]!.feedInfoInMarkdown).toBe(
        mdText`👨🏻‍💻 Removed **${named}** from the [On-Call Policy Payments](${POLICY_LINK}) for escalation rule First line with order 1.`.toString(),
      );

      const line: string =
        mdText`👨🏻‍💻 Removed **${named}** from on-call policy [Payments](${POLICY_LINK}).`.toString();

      expect(items[0]!.chatInfoInMarkdown).toBe(line);

      for (const workspaceType of ALL_WORKSPACES) {
        expect(items[0]!.chatInfoByWorkspaceType?.[workspaceType]).toBe(line);
      }

      expectNothingOfIvysAddress();
    },
  );

  test("a member: named as the add names them, linked to their page - no address after the name", async () => {
    await takeOffRule(ANA);

    expect(items[0]!.feedInfoInMarkdown).toBe(
      `👨🏻‍💻 Removed **[Ana Lee](${linkOf(ANA)})** from the [On-Call Policy Payments](${POLICY_LINK}) for escalation rule First line with order 1.`,
    );
  });

  test("REGRESSION: a member with no name is no longer taken out in silence", async () => {
    await takeOffRule(NELL);

    expect(items).toHaveLength(1);
    expect(items[0]!.chatInfoInMarkdown).toBe(
      `👨🏻‍💻 Removed **[nell@acme.test](${linkOf(NELL)})** from on-call policy [Payments](${POLICY_LINK}).`,
    );
  });

  test("their on-call time log on the rule still ends", async () => {
    await takeOffRule(IVY);

    expect(
      OnCallDutyPolicyTimeLogService.endTimeLogForUser,
    ).toHaveBeenCalledTimes(1);
  });
});

describe("an override", () => {
  test.each(TYPED_NAMES)(
    "REGRESSION: added for someone only invited ($why) - '$named' in the feed and every channel",
    async ({ typed, named }: { typed: string | null; named: string }) => {
      typedName = typed;

      await addOverride({ away: IVY, cover: ANA });

      expect(items).toHaveLength(1);
      expect(items[0]!.feedInfoInMarkdown).toContain(
        mdText`🔁 Added a User Override Rule for user **${named}** for the [On-Call Policy Payments](${POLICY_LINK}). All alerts will be routed to **[Ana Lee](${linkOf(ANA)})**`.toString(),
      );
      expect(items[0]!.chatInfoInMarkdown).toContain(
        mdText`🔁 Added an override on [Payments](${POLICY_LINK}): [Ana Lee](${linkOf(ANA)}) covers for ${named} from `.toString(),
      );

      for (const workspaceType of ALL_WORKSPACES) {
        expect(items[0]!.chatInfoByWorkspaceType?.[workspaceType]).toContain(
          mdText`covers for ${named} from `.toString(),
        );
      }

      expectNothingOfIvysAddress();
    },
  );

  test.each(TYPED_NAMES)(
    "REGRESSION: someone only invited ($why) named to cover - '$named'",
    async ({ typed, named }: { typed: string | null; named: string }) => {
      typedName = typed;

      await addOverride({ away: ANA, cover: IVY });

      expect(items[0]!.feedInfoInMarkdown).toContain(
        mdText`All alerts will be routed to **${named}** from `.toString(),
      );
      expect(
        items[0]!.chatInfoByWorkspaceType?.[WorkspaceType.Slack],
      ).toContain(
        mdText`: ${named} covers for [Ana Lee](${linkOf(ANA)}) from `.toString(),
      );
      expectNothingOfIvysAddress();
    },
  );

  test.each(TYPED_NAMES)(
    "REGRESSION: changed - '$named' ($why) as who covered before and who covers now",
    async ({ typed, named }: { typed: string | null; named: string }) => {
      typedName = typed;

      await changeOverrideCover({
        away: ANA,
        coverBefore: IVY,
        coverAfter: NELL,
      });
      await changeOverrideCover({
        away: ANA,
        coverBefore: NELL,
        coverAfter: IVY,
      });

      expect(items).toHaveLength(2);
      expect(items[0]!.feedInfoInMarkdown).toContain(
        mdText`Changed: who covers (it was **${named}**).`.toString(),
      );
      expect(items[1]!.chatInfoInMarkdown).toContain(
        mdText`✏️ Changed an override on [Payments](${POLICY_LINK}): ${named} covers for [Ana Lee](${linkOf(ANA)}) from `.toString(),
      );
      expect(
        items[1]!.chatInfoByWorkspaceType?.[WorkspaceType.MicrosoftTeams],
      ).toContain(mdText`: ${named} covers for `.toString());
      expectNothingOfIvysAddress();
    },
  );

  test.each(TYPED_NAMES)(
    "REGRESSION: taken back for someone only invited ($why) - '$named'",
    async ({ typed, named }: { typed: string | null; named: string }) => {
      typedName = typed;

      await removeOverride(IVY);

      expect(items).toHaveLength(1);
      expect(items[0]!.feedInfoInMarkdown).toBe(
        mdText`❌ Removed a User Override Rule for user **${named}** for the [On-Call Policy Payments](${POLICY_LINK}). All alerts will be routed back to **${named}**`.toString(),
      );

      const line: string =
        mdText`❌ Removed an override on [Payments](${POLICY_LINK}): ${named} is paged on their turns again.`.toString();

      expect(items[0]!.chatInfoInMarkdown).toBe(line);

      for (const workspaceType of ALL_WORKSPACES) {
        expect(items[0]!.chatInfoByWorkspaceType?.[workspaceType]).toBe(line);
      }

      expectNothingOfIvysAddress();
    },
  );
});

describe("an owner of the policy", () => {
  test.each(TYPED_NAMES)(
    "REGRESSION: someone only invited ($why) added as owner - '$named' in the entry the channels hear too",
    async ({ typed, named }: { typed: string | null; named: string }) => {
      typedName = typed;

      await addOwner(IVY);

      expect(items).toHaveLength(1);
      expect(items[0]!.feedInfoInMarkdown).toBe(
        mdText`👨🏻‍💻 Added **${named}** to the [On-Call Policy Payments](${POLICY_LINK}) as the owner.`.toString(),
      );
      // The entry is the channels' line: it goes to them as it is.
      expect(items[0]!.chatInfoInMarkdown).toBeUndefined();
      expect(items[0]!.workspaceNotification).toMatchObject({
        sendWorkspaceNotification: true,
      });
      expectNothingOfIvysAddress();
    },
  );

  test.each(TYPED_NAMES)(
    "REGRESSION: someone only invited ($why) removed as owner - '$named', with no address after it",
    async ({ typed, named }: { typed: string | null; named: string }) => {
      typedName = typed;

      await removeOwner(IVY);

      expect(items).toHaveLength(1);
      expect(items[0]!.feedInfoInMarkdown).toBe(
        mdText`👨🏻‍💻 Removed **${named}** from the [On-Call Policy Payments](${POLICY_LINK}) as the owner.`.toString(),
      );
      expectNothingOfIvysAddress();
    },
  );

  test("a member: added and removed by their name, linked to their page - the removal no longer prints their address", async () => {
    await addOwner(ANA);
    await removeOwner(ANA);

    expect(
      items.map((item: FeedItem): string => {
        return item.feedInfoInMarkdown;
      }),
    ).toEqual([
      `👨🏻‍💻 Added **[Ana Lee](${linkOf(ANA)})** to the [On-Call Policy Payments](${POLICY_LINK}) as the owner.`,
      `👨🏻‍💻 Removed **[Ana Lee](${linkOf(ANA)})** from the [On-Call Policy Payments](${POLICY_LINK}) as the owner.`,
    ]);
  });

  test("REGRESSION: a member with no name removed as owner is said, as their add is", async () => {
    await removeOwner(NELL);

    expect(items).toHaveLength(1);
    expect(items[0]!.feedInfoInMarkdown).toContain(
      `Removed **[nell@acme.test](${linkOf(NELL)})** from the`,
    );
  });
});

describe("what is read, and a read that fails", () => {
  test("whether someone is only invited is read once per person for the whole change, however many lines and workspaces name them", async () => {
    await removeOverride(IVY);

    const ivyReads: Array<Array<string>> = pendingReads.filter(
      (userIds: Array<string>): boolean => {
        return userIds.includes(IVY.toString());
      },
    );

    // The feed, the shared line and three workspaces: one read.
    expect(ivyReads).toHaveLength(1);
    // Never asked of a workspace: nobody only invited has an account there.
    expect(WorkspaceUserAuthTokenService.getUserAuth).not.toHaveBeenCalledWith(
      expect.objectContaining({ userId: IVY }),
    );
  });

  test("a read that fails names them Somebody - never what could be an address - and is logged", async () => {
    jest
      .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
      .mockRejectedValue(new Error("database down") as never);

    await addToRule(IVY);

    expect(items).toHaveLength(1);
    expect(items[0]!.chatInfoInMarkdown).toBe(
      `👨🏻‍💻 Added **${ON_CALL_CHAT_NOBODY_NAMED}** to on-call policy [Payments](${POLICY_LINK}).`,
    );
    expectNothingOfIvysAddress();
    expect(logger.error).toHaveBeenCalledWith(
      "Could not read whether somebody an on-call line names is only invited to the project; the line names them as Somebody.",
      expect.anything(),
    );
  });

  test("the name typed is text: it links nowhere and mentions nobody", async () => {
    typedName = "[Click](https://evil.test) <!channel>";

    await addToRule(IVY);

    for (const words of everythingSaid()) {
      expect(words).not.toContain("[Click](https://evil.test)");
      expect(words).not.toContain("<!channel>");
    }

    expect(items[0]!.chatInfoInMarkdown).toContain(
      mdText`**${typedName}**`.toString(),
    );
  });
});
