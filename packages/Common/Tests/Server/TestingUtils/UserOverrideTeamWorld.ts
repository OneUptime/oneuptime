import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import DatabaseService from "../../../Server/Services/DatabaseService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import FeedMarkdown, {
  MarkdownText,
} from "../../../Utils/Markdown/FeedMarkdown";
import {
  InMemoryTable,
  StoredRow,
  rowMatchesWhere,
  useInMemoryTable,
} from "./InMemoryRepository";
import { stubProjectDirectory } from "./ProjectDirectory";
import { ON_HIGHEST_PLAN } from "./RequestPlan";
import { useUserOverrideTimesInMemory } from "./UserOverrideTimesInMemory";
import { getJestSpyOn } from "../../Spy";
import { jest } from "@jest/globals";

/*
 * A PROJECT OF TEAMS AND THEIR USER OVERRIDES, IN MEMORY, for the suites of
 * Manage On-Call Policy User Overrides for Own Team (issue #9733): the
 * service's (OnCallDutyPolicyUserOverrideTeamAccess) and the API's
 * (OnCallDutyPolicyUserOverrideTeamAccessAPI).
 *
 *   Payments: Alice, Bob, Dave - and Pat, invited, not yet accepted
 *   Mobile:   Carol, Dave
 *   Everyone: Alice, Bob, Carol, Dave, Erin - the team that lets everybody
 *             read the on-call pages, and gives nobody the permission
 *
 * The payments policy carries the "payments" label; the other policy none.
 * Every add, edit and delete runs through the real
 * OnCallDutyPolicyUserOverrideService - its permission checks, its hooks,
 * the lock override times are written under - with the override table in
 * memory (installUserOverrideTeamWorld), and the team rule reads who is in
 * which team from MEMBERSHIPS.
 */

export const PROJECT: string = "9733aaaa-0000-4000-8000-000000000001";

// The policy labelled "payments", and one with no label.
export const POLICY: string = "9733aaaa-0000-4000-8000-0000000000b1";
export const OTHER_POLICY: string = "9733aaaa-0000-4000-8000-0000000000b2";
export const PAYMENTS_LABEL: string = "9733aaaa-0000-4000-8000-0000000000e1";

export const PAYMENTS: string = "9733aaaa-0000-4000-8000-0000000000f1";
export const MOBILE: string = "9733aaaa-0000-4000-8000-0000000000f2";
export const EVERYONE: string = "9733aaaa-0000-4000-8000-0000000000f3";

export const ALICE: string = "9733aaaa-0000-4000-8000-0000000000c1";
export const BOB: string = "9733aaaa-0000-4000-8000-0000000000c2";
export const CAROL: string = "9733aaaa-0000-4000-8000-0000000000c3";
export const DAVE: string = "9733aaaa-0000-4000-8000-0000000000c4";
export const ERIN: string = "9733aaaa-0000-4000-8000-0000000000c5";
export const PAT: string = "9733aaaa-0000-4000-8000-0000000000c6";

export const NAMES: Record<string, string> = {
  [ALICE]: "Alice Avery",
  [BOB]: "Bob Brook",
  [CAROL]: "Carol Chen",
  [DAVE]: "Dave Diaz",
  [ERIN]: "Erin Evans",
  [PAT]: "Pat Park",
};

export const USERS: Array<StoredRow> = Object.keys(NAMES).map(
  (id: string): StoredRow => {
    return { _id: id, name: NAMES[id], timezone: "UTC" };
  },
);

const membership: (
  teamId: string,
  userId: string,
  hasAcceptedInvitation?: boolean,
) => StoredRow = (
  teamId: string,
  userId: string,
  hasAcceptedInvitation: boolean = true,
): StoredRow => {
  return {
    projectId: PROJECT,
    teamId: teamId,
    userId: userId,
    hasAcceptedInvitation: hasAcceptedInvitation,
  };
};

export const MEMBERSHIPS: Array<StoredRow> = [
  membership(PAYMENTS, ALICE),
  membership(PAYMENTS, BOB),
  membership(PAYMENTS, DAVE),
  membership(PAYMENTS, PAT, false),
  membership(MOBILE, CAROL),
  membership(MOBILE, DAVE),
  ...[ALICE, BOB, CAROL, DAVE, ERIN].map((userId: string): StoredRow => {
    return membership(EVERYONE, userId);
  }),
];

// Half a minute into 12:00 on the day.
export const NOW: Date = new Date("2026-11-19T12:00:30.000Z");

// The overrides the project has.
export const TEAM_GLOBAL: string = "9733aaaa-0000-4000-8000-0000000000d1";
export const TEAM_SKIP_ON_POLICY: string =
  "9733aaaa-0000-4000-8000-0000000000d2";
export const OUTSIDER_AWAY: string = "9733aaaa-0000-4000-8000-0000000000d3";
export const OUTSIDER_COVERS: string = "9733aaaa-0000-4000-8000-0000000000d4";
export const RUNNING_TEAM: string = "9733aaaa-0000-4000-8000-0000000000d5";
export const RUNNING_OUTSIDER: string = "9733aaaa-0000-4000-8000-0000000000d6";
export const OUTSIDER_ON_POLICY: string =
  "9733aaaa-0000-4000-8000-0000000000d7";
export const OUTSIDER_ON_OTHER_POLICY: string =
  "9733aaaa-0000-4000-8000-0000000000d8";

const TOMORROW_STARTS: Date = new Date("2026-11-20T09:00:00.000Z");
const TOMORROW_ENDS: Date = new Date("2026-11-20T17:00:00.000Z");
const LATER_STARTS: Date = new Date("2026-11-21T09:00:00.000Z");
const LATER_ENDS: Date = new Date("2026-11-21T17:00:00.000Z");

// When an override under way ends.
export const RUNNING_ENDS: Date = new Date("2026-11-19T20:00:00.000Z");

// What an add asks for: well away from every override above.
export const ADD_STARTS: Date = new Date("2026-12-10T09:00:00.000Z");
export const ADD_ENDS: Date = new Date("2026-12-12T09:00:00.000Z");

const stored: (data: {
  id: string;
  away: string;
  covers: string | null;
  policyId?: string | undefined;
  startsAt?: Date | undefined;
  endsAt?: Date | undefined;
}) => StoredRow = (data: {
  id: string;
  away: string;
  covers: string | null;
  policyId?: string | undefined;
  startsAt?: Date | undefined;
  endsAt?: Date | undefined;
}): StoredRow => {
  return {
    _id: data.id,
    projectId: PROJECT,
    onCallDutyPolicyId: data.policyId || null,
    overrideUserId: data.away,
    routeAlertsToUserId: data.covers,
    startsAt: data.startsAt || TOMORROW_STARTS,
    endsAt: data.endsAt || TOMORROW_ENDS,
    createdAt: new Date("2026-11-01T10:00:00.000Z"),
    version: 1,
  };
};

export const rowsAtStart: () => Array<StoredRow> = (): Array<StoredRow> => {
  return [
    // Bob away on every policy tomorrow, Dave covering: both of Payments.
    stored({ id: TEAM_GLOBAL, away: BOB, covers: DAVE }),
    // Bob skipped on the payments policy tomorrow.
    stored({
      id: TEAM_SKIP_ON_POLICY,
      away: BOB,
      covers: null,
      policyId: POLICY,
    }),
    // Carol, of Mobile, away tomorrow; Bob covers.
    stored({ id: OUTSIDER_AWAY, away: CAROL, covers: BOB }),
    // Dave away the day after; Carol, of Mobile, covers.
    stored({
      id: OUTSIDER_COVERS,
      away: DAVE,
      covers: CAROL,
      startsAt: LATER_STARTS,
      endsAt: LATER_ENDS,
    }),
    // Under way since this morning: Alice covered by Bob.
    stored({
      id: RUNNING_TEAM,
      away: ALICE,
      covers: BOB,
      startsAt: new Date("2026-11-19T08:00:00.000Z"),
      endsAt: RUNNING_ENDS,
    }),
    // Under way: Erin, in no team of Alice's but Everyone, covered by Bob.
    stored({
      id: RUNNING_OUTSIDER,
      away: ERIN,
      covers: BOB,
      startsAt: new Date("2026-11-19T08:00:00.000Z"),
      endsAt: RUNNING_ENDS,
    }),
    // Carol away on the payments policy the day after, Bob covering.
    stored({
      id: OUTSIDER_ON_POLICY,
      away: CAROL,
      covers: BOB,
      policyId: POLICY,
      startsAt: LATER_STARTS,
      endsAt: LATER_ENDS,
    }),
    // Carol away on the other policy the day after, Dave covering.
    stored({
      id: OUTSIDER_ON_OTHER_POLICY,
      away: CAROL,
      covers: DAVE,
      policyId: OTHER_POLICY,
      startsAt: LATER_STARTS,
      endsAt: LATER_ENDS,
    }),
  ];
};

export const TEAM_PERMISSION: Permission =
  Permission.ManageTeamOnCallDutyPolicyUserOverride;

// A permission row, as AccessTokenService builds one from a team's permission.
export const row: (
  permission: Permission,
  data?: {
    teamId?: string | undefined;
    scope?: PermissionScope | undefined;
    labelIds?: Array<string> | undefined;
    isBlock?: boolean | undefined;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    teamId?: string | undefined;
    scope?: PermissionScope | undefined;
    labelIds?: Array<string> | undefined;
    isBlock?: boolean | undefined;
  },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: (data?.labelIds || []).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    scope: data?.scope || PermissionScope.All,
    isBlockPermission: Boolean(data?.isBlock),
    ...(data?.teamId ? { teamId: new ObjectID(data.teamId) } : {}),
  };
};

// Everyone reads the on-call pages: policies, schedules and overrides.
export const READS: UserPermission = row(Permission.OnCallViewer, {
  teamId: EVERYONE,
});

export const ON_PAYMENTS: UserPermission = row(TEAM_PERMISSION, {
  teamId: PAYMENTS,
});

export const ON_MOBILE: UserPermission = row(TEAM_PERMISSION, {
  teamId: MOBILE,
});

const tenantAccess: (
  rows: Array<UserPermission>,
) => Record<string, UserTenantAccessPermission> = (
  rows: Array<UserPermission>,
): Record<string, UserTenantAccessPermission> => {
  return {
    [PROJECT]: {
      _type: "UserTenantAccessPermission",
      projectId: new ObjectID(PROJECT),
      permissions: rows,
    },
  };
};

// A member of the project holding `rows`: Alice, unless said.
export const member: (
  rows: Array<UserPermission>,
  userId?: string,
) => DatabaseCommonInteractionProps = (
  rows: Array<UserPermission>,
  userId: string = ALICE,
): DatabaseCommonInteractionProps => {
  return {
    userId: new ObjectID(userId),
    userType: UserType.User,
    tenantId: new ObjectID(PROJECT),
    userTenantAccessPermission: tenantAccess(rows),
    ...ON_HIGHEST_PLAN,
  };
};

// A project API key holding `rows`: no person, no team.
export const apiKey: (
  rows: Array<UserPermission>,
) => DatabaseCommonInteractionProps = (
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps => {
  return {
    userType: UserType.API,
    tenantId: new ObjectID(PROJECT),
    userTenantAccessPermission: tenantAccess(rows),
    ...ON_HIGHEST_PLAN,
  };
};

// Alice, managing the user overrides of Payments' people.
export const teamScoped: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return member([READS, ON_PAYMENTS]);
  };

// An override to add: who is away, who covers (none for a skip), and where.
export const newOverride: (data: {
  away: string;
  covers?: string | undefined;
  policyId?: string | undefined;
}) => OnCallDutyPolicyUserOverride = (data: {
  away: string;
  covers?: string | undefined;
  policyId?: string | undefined;
}): OnCallDutyPolicyUserOverride => {
  const override: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();
  override.projectId = new ObjectID(PROJECT);
  override.overrideUserId = new ObjectID(data.away);

  if (data.covers) {
    override.routeAlertsToUserId = new ObjectID(data.covers);
  }

  if (data.policyId) {
    override.onCallDutyPolicyId = new ObjectID(data.policyId);
  }

  override.startsAt = ADD_STARTS;
  override.endsAt = ADD_ENDS;

  return override;
};

export interface UserOverrideTeamWorld {
  table: InMemoryTable;
  // How many times the team rule has read who is in which team.
  membershipReads: () => number;
  // How many items the policies' feeds were written.
  feedItemCount: () => number;
}

/*
 * Sets the world up for one test: call it from a beforeEach, and restore it
 * with jest.restoreAllMocks().
 */
export function installUserOverrideTeamWorld(): UserOverrideTeamWorld {
  stubProjectDirectory({});
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  const table: InMemoryTable = useInMemoryTable(
    OnCallDutyPolicyUserOverrideService,
    rowsAtStart(),
  );

  useUserOverrideTimesInMemory({
    overrides: (): Array<StoredRow> => {
      return table.rows;
    },
    users: (): Array<StoredRow> => {
      return USERS;
    },
  });

  // Who is in which team, as the team rule reads it.
  let membershipReads: number = 0;

  getJestSpyOn(TeamMemberService, "findBy").mockImplementation((async (args: {
    query: Record<string, unknown>;
  }): Promise<Array<TeamMember>> => {
    membershipReads++;

    return MEMBERSHIPS.filter((candidate: StoredRow): boolean => {
      return rowMatchesWhere(candidate, args.query);
    }).map((candidate: StoredRow): TeamMember => {
      const found: TeamMember = new TeamMember();
      found.userId = new ObjectID(String(candidate["userId"]));
      found.teamId = new ObjectID(String(candidate["teamId"]));
      return found;
    });
  }) as never);

  // Every policy is one the caller reads: an override on it is under a parent they may read.
  jest
    .spyOn(
      DatabaseService as unknown as {
        findReadableParentIds: (data: {
          parentModelType: { new (): BaseModel };
          ids: Array<string>;
        }) => Promise<Array<string>>;
      },
      "findReadableParentIds",
    )
    .mockImplementation(
      async (data: {
        parentModelType: { new (): BaseModel };
        ids: Array<string>;
      }): Promise<Array<string>> => {
        return [...data.ids];
      },
    );

  // The payments policy carries the payments label; the other, none.
  jest
    .spyOn(
      DatabaseService as unknown as {
        findRecordLabels: (data: {
          ids: Array<string>;
        }) => Promise<Record<string, Array<string>>>;
      },
      "findRecordLabels",
    )
    .mockImplementation(
      async (data: {
        ids: Array<string>;
      }): Promise<Record<string, Array<string>>> => {
        const labels: Record<string, Array<string>> = {};

        for (const id of data.ids) {
          labels[id.toLowerCase()] =
            id.toLowerCase() === POLICY ? [PAYMENTS_LABEL] : [];
        }

        return labels;
      },
    );

  jest
    .spyOn(
      DatabaseService as unknown as {
        findLabelNames: () => Promise<Array<string>>;
      },
      "findLabelNames",
    )
    .mockResolvedValue(["payments"]);

  // What a saved override sets off: the policy feed and the roster refreshes.
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyName")
    .mockResolvedValue("Payments");
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/policy"));
  jest.spyOn(UserService, "getTimezoneForUser").mockResolvedValue(null);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockImplementation(
      async (data: { userId: ObjectID }): Promise<MarkdownText> => {
        return FeedMarkdown.asMarkdown(
          NAMES[data.userId.toString().toLowerCase()] || "somebody",
        );
      },
    );

  const feedItem: ReturnType<typeof jest.spyOn> = jest
    .spyOn(OnCallDutyPolicyFeedService, "createOnCallDutyPolicyFeedItem")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(OnCallDutyPolicyScheduleService, "refreshRostersForUserInProject")
    .mockResolvedValue(undefined);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "getScheduleIdsForUsersInProject")
    .mockResolvedValue([]);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "propagateShiftConfigChange")
    .mockResolvedValue(undefined);

  return {
    table: table,
    membershipReads: (): number => {
      return membershipReads;
    },
    feedItemCount: (): number => {
      return feedItem.mock.calls.length;
    },
  };
}
