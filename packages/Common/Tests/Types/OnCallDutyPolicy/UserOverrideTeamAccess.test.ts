import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import PermissionScopeNarrowing from "../../../Types/Database/AccessControl/PermissionScopeNarrowing";
import HeldPermissionsUtil, {
  HeldPermissions,
  TeamGrants,
} from "../../../Types/HeldPermissions";
import ObjectID from "../../../Types/ObjectID";
import GlobalUserOverrideAccess from "../../../Types/OnCallDutyPolicy/GlobalUserOverrideAccess";
import UserOverrideTeamAccess, {
  USER_OVERRIDE_TEAM_AWAY_REFUSAL,
  USER_OVERRIDE_TEAM_COVER_REFUSAL,
  USER_OVERRIDE_TEAM_DELETE_REFUSAL,
  USER_OVERRIDE_TEAM_EDIT_REFUSAL,
  USER_OVERRIDE_TEAM_NO_TEAM_REFUSAL,
  USER_OVERRIDE_TEAM_PERMISSION,
  USER_OVERRIDE_TEAM_PICKER_HINT,
} from "../../../Types/OnCallDutyPolicy/UserOverrideTeamAccess";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
  UserPermission,
} from "../../../Types/Permission";
import {
  PermissionHolder,
  getCustomRolePermissionProblem,
  getTenantPermissionProblem,
} from "../../../Types/Team/CustomRole";
import { describe, expect, test } from "@jest/globals";

/*
 * MANAGE ON-CALL POLICY USER OVERRIDES FOR OWN TEAM (issue #9733): the
 * permission itself, as the roles UI and the rule read it
 * (Types/OnCallDutyPolicy/UserOverrideTeamAccess), and the teams that give
 * it, as the one rule reads them from a caller's rows
 * (HeldPermissionsUtil.getTeamGrants). The server's and the dashboard's
 * suites hold what they do with it; this holds what they read.
 */

const PAYMENTS: string = "9733b000-0000-4000-8000-0000000000f1";
const MOBILE: string = "9733b000-0000-4000-8000-0000000000f2";
const LABEL: string = "9733b000-0000-4000-8000-0000000000e1";

const row: (
  permission: Permission,
  data?: {
    teamId?: unknown;
    scope?: PermissionScope;
    labelIds?: Array<string>;
    isBlock?: boolean;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    teamId?: unknown;
    scope?: PermissionScope;
    labelIds?: Array<string>;
    isBlock?: boolean;
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
    ...(data?.teamId ? { teamId: data.teamId as ObjectID } : {}),
  };
};

const held: (rows: Array<UserPermission>) => HeldPermissions = (
  rows: Array<UserPermission>,
): HeldPermissions => {
  return HeldPermissionsUtil.fromRows({ rows });
};

const MODEL: OnCallDutyPolicyUserOverride = new OnCallDutyPolicyUserOverride();

const ON_PAYMENTS: UserPermission = row(USER_OVERRIDE_TEAM_PERMISSION, {
  teamId: new ObjectID(PAYMENTS),
});

describe("the permission, as the roles UI offers it", () => {
  const props: PermissionProps | undefined =
    PermissionHelper.getAllPermissionProps().find(
      (candidate: PermissionProps): boolean => {
        return candidate.permission === USER_OVERRIDE_TEAM_PERMISSION;
      },
    );

  test("is listed under On-Call, named after the record it guards, with a plain explanation", () => {
    expect(props).toBeDefined();
    expect(props!.title).toBe(
      "Manage On-Call Policy User Overrides for Own Team",
    );
    expect(props!.group).toBe(PermissionGroup.OnCallDutyPolicy);
    expect(props!.description).toContain(
      "the person who is away and the person who covers must both be in that team",
    );
    expect(props!.description).toContain("An API key is in no team");
  });

  test("is offered to teams, custom roles and API keys, as one permission, never a role", () => {
    expect(
      PermissionHelper.isAssignableToTenant(USER_OVERRIDE_TEAM_PERMISSION),
    ).toBe(true);
    expect(props!.isRolePermission).toBe(false);
    expect(
      PermissionHelper.getRolePermissionProps().some(
        (candidate: PermissionProps): boolean => {
          return candidate.permission === USER_OVERRIDE_TEAM_PERMISSION;
        },
      ),
    ).toBe(false);

    for (const holder of [PermissionHolder.Team, PermissionHolder.ApiKey]) {
      expect(
        getTenantPermissionProblem({
          permission: USER_OVERRIDE_TEAM_PERMISSION,
          holder: holder,
        }),
      ).toBeNull();
    }

    expect(
      getCustomRolePermissionProblem({
        permission: USER_OVERRIDE_TEAM_PERMISSION,
      }),
    ).toBeNull();
  });

  test("its name fits the column it is stored in", () => {
    expect(USER_OVERRIDE_TEAM_PERMISSION.length).toBeLessThanOrEqual(100);
  });

  test("labels and owners narrow it, as they narrow the permissions beside it: every scope is offered", () => {
    expect(
      PermissionScopeNarrowing.getScopes(USER_OVERRIDE_TEAM_PERMISSION),
    ).toEqual([
      PermissionScope.All,
      PermissionScope.Owned,
      PermissionScope.Labels,
    ]);
    expect(
      PermissionScopeNarrowing.getNarrowedBy(USER_OVERRIDE_TEAM_PERMISSION),
    ).toBe(
      PermissionScopeNarrowing.getNarrowedBy(
        Permission.CreateOnCallDutyPolicyUserOverride,
      ),
    );

    // A custom role's copy of it may be scoped as the role says.
    expect(
      getCustomRolePermissionProblem({
        permission: USER_OVERRIDE_TEAM_PERMISSION,
        scope: PermissionScope.Owned,
      }),
    ).toBeNull();
  });
});

describe("the permission, as the user override table lists it", () => {
  test("adds, edits and deletes overrides; reads none", () => {
    expect(MODEL.getCreatePermissions()).toContain(
      USER_OVERRIDE_TEAM_PERMISSION,
    );
    expect(MODEL.getUpdatePermissions()).toContain(
      USER_OVERRIDE_TEAM_PERMISSION,
    );
    expect(MODEL.getDeletePermissions()).toContain(
      USER_OVERRIDE_TEAM_PERMISSION,
    );
    expect(MODEL.getReadPermissions()).not.toContain(
      USER_OVERRIDE_TEAM_PERMISSION,
    );
  });

  test("on every column an add writes, and every column an edit may change, as Create and Edit are", () => {
    for (const column of MODEL.getTableColumns().columns) {
      const access: {
        create?: Array<Permission>;
        update?: Array<Permission>;
        read?: Array<Permission>;
      } = (MODEL.getColumnAccessControlFor(column) || {}) as {
        create?: Array<Permission>;
        update?: Array<Permission>;
        read?: Array<Permission>;
      };

      expect({
        column,
        create: (access.create || []).includes(USER_OVERRIDE_TEAM_PERMISSION),
        update: (access.update || []).includes(USER_OVERRIDE_TEAM_PERMISSION),
        read: (access.read || []).includes(USER_OVERRIDE_TEAM_PERMISSION),
      }).toEqual({
        column,
        create: (access.create || []).includes(
          Permission.CreateOnCallDutyPolicyUserOverride,
        ),
        update: (access.update || []).includes(
          Permission.EditOnCallDutyPolicyUserOverride,
        ),
        read: false,
      });
    }
  });

  test("no default role gains anything: the roles that manage overrides are the ones they were", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
    ]) {
      expect(MODEL.getCreatePermissions()).toContain(permission);
    }

    expect(MODEL.getCreatePermissions()).not.toContain(Permission.Viewer);
    expect(MODEL.getCreatePermissions()).not.toContain(Permission.OnCallViewer);
  });
});

describe("the teams that give a permission (HeldPermissionsUtil.getTeamGrants)", () => {
  test("each team once, lower-cased, with whether one of its rows reaches the whole project", () => {
    const grants: TeamGrants = HeldPermissionsUtil.getTeamGrants(
      [
        ON_PAYMENTS,
        row(USER_OVERRIDE_TEAM_PERMISSION, {
          teamId: new ObjectID(MOBILE.toUpperCase()),
          scope: PermissionScope.Labels,
          labelIds: [LABEL],
        }),
        // Payments again, narrowed: it still reaches the whole project.
        row(USER_OVERRIDE_TEAM_PERMISSION, {
          teamId: new ObjectID(PAYMENTS),
          scope: PermissionScope.Owned,
        }),
      ],
      USER_OVERRIDE_TEAM_PERMISSION,
    );

    expect(grants).toEqual({
      teams: [
        { teamId: PAYMENTS, isProjectWide: true },
        { teamId: MOBILE, isProjectWide: false },
      ],
      isGrantedByNoTeam: false,
    });
  });

  test("an Owned row is narrowed, a stray label on an All row too", () => {
    expect(
      HeldPermissionsUtil.getTeamGrants(
        [
          row(USER_OVERRIDE_TEAM_PERMISSION, {
            teamId: new ObjectID(PAYMENTS),
            scope: PermissionScope.Owned,
          }),
          row(USER_OVERRIDE_TEAM_PERMISSION, {
            teamId: new ObjectID(MOBILE),
            labelIds: [LABEL],
          }),
        ],
        USER_OVERRIDE_TEAM_PERMISSION,
      ).teams,
    ).toEqual([
      { teamId: PAYMENTS, isProjectWide: false },
      { teamId: MOBILE, isProjectWide: false },
    ]);
  });

  test("blocks give nothing, and other permissions' rows are not this one's", () => {
    expect(
      HeldPermissionsUtil.getTeamGrants(
        [
          row(USER_OVERRIDE_TEAM_PERMISSION, {
            teamId: new ObjectID(PAYMENTS),
            isBlock: true,
          }),
          row(Permission.OnCallMember, { teamId: new ObjectID(MOBILE) }),
        ],
        USER_OVERRIDE_TEAM_PERMISSION,
      ),
    ).toEqual({ teams: [], isGrantedByNoTeam: false });
  });

  test("a row no team grants - an API key's - is counted apart", () => {
    expect(
      HeldPermissionsUtil.getTeamGrants(
        [row(USER_OVERRIDE_TEAM_PERMISSION)],
        USER_OVERRIDE_TEAM_PERMISSION,
      ),
    ).toEqual({ teams: [], isGrantedByNoTeam: true });
  });

  test("a team id as a stored snapshot holds it: text, or the object an ObjectID was written as", () => {
    expect(
      HeldPermissionsUtil.getTeamGrants(
        [
          row(USER_OVERRIDE_TEAM_PERMISSION, { teamId: PAYMENTS }),
          row(USER_OVERRIDE_TEAM_PERMISSION, {
            teamId: { _type: "ObjectID", value: MOBILE },
          }),
        ],
        USER_OVERRIDE_TEAM_PERMISSION,
      ).teams.map((grant: { teamId: string }): string => {
        return grant.teamId;
      }),
    ).toEqual([PAYMENTS, MOBILE]);

    expect(HeldPermissionsUtil.readTeamId(null)).toBeNull();
    expect(HeldPermissionsUtil.readTeamId("")).toBeNull();
    expect(HeldPermissionsUtil.readTeamId({})).toBeNull();
  });

  test("anything that is no list of rows gives nothing", () => {
    expect(
      HeldPermissionsUtil.getTeamGrants(null, USER_OVERRIDE_TEAM_PERMISSION),
    ).toEqual({ teams: [], isGrantedByNoTeam: false });
  });
});

describe("the rule (UserOverrideTeamAccess)", () => {
  const create: Array<Permission> = MODEL.getCreatePermissions();
  const update: Array<Permission> = MODEL.getUpdatePermissions();

  test("the permissions that reach everyone are the write's own, but the team one", () => {
    expect(UserOverrideTeamAccess.getEveryonePermissions(create)).toEqual(
      create.filter((permission: Permission): boolean => {
        return permission !== USER_OVERRIDE_TEAM_PERMISSION;
      }),
    );
    expect(UserOverrideTeamAccess.getEveryonePermissions(create)).toContain(
      Permission.CreateOnCallDutyPolicyUserOverride,
    );
  });

  test("holding the team permission: an allow row, with no block taking it away", () => {
    expect(
      UserOverrideTeamAccess.holdsTeamPermission(held([ON_PAYMENTS])),
    ).toBe(true);
    expect(
      UserOverrideTeamAccess.holdsTeamPermission(
        held([
          ON_PAYMENTS,
          row(USER_OVERRIDE_TEAM_PERMISSION, { isBlock: true }),
        ]),
      ),
    ).toBe(false);
    expect(
      UserOverrideTeamAccess.holdsTeamPermission(
        held([row(Permission.OnCallMember)]),
      ),
    ).toBe(false);
  });

  test("reaching everyone takes a permission of the write's list over the whole project", () => {
    expect(
      UserOverrideTeamAccess.reachesEveryone(
        held([ON_PAYMENTS, row(Permission.OnCallMember)]),
        create,
      ),
    ).toBe(true);
    expect(
      UserOverrideTeamAccess.reachesEveryone(
        held([
          ON_PAYMENTS,
          row(Permission.OnCallMember, {
            scope: PermissionScope.Labels,
            labelIds: [LABEL],
          }),
        ]),
        create,
      ),
    ).toBe(false);
    // The team permission over the whole project reaches its team, not everyone.
    expect(
      UserOverrideTeamAccess.reachesEveryone(held([ON_PAYMENTS]), create),
    ).toBe(false);
    // Edit over the whole project frees edits, not adds.
    expect(
      UserOverrideTeamAccess.reachesEveryone(
        held([row(Permission.EditOnCallDutyPolicyUserOverride)]),
        update,
      ),
    ).toBe(true);
    expect(
      UserOverrideTeamAccess.reachesEveryone(
        held([row(Permission.EditOnCallDutyPolicyUserOverride)]),
        create,
      ),
    ).toBe(false);
  });

  test("a narrowed permission that reaches everyone is still one held", () => {
    expect(
      UserOverrideTeamAccess.holdsEveryonePermission(
        held([
          row(Permission.CreateOnCallDutyPolicyUserOverride, {
            scope: PermissionScope.Owned,
          }),
        ]),
        create,
      ),
    ).toBe(true);
    expect(
      UserOverrideTeamAccess.holdsEveryonePermission(
        held([ON_PAYMENTS]),
        create,
      ),
    ).toBe(false);
  });

  test("whether a picker is kept to the team, global and on a policy", () => {
    const narrowed: HeldPermissions = held([
      ON_PAYMENTS,
      row(Permission.OnCallMember, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL],
      }),
    ]);

    const cases: Array<{
      name: string;
      held: HeldPermissions;
      isGlobal: boolean;
      expected: boolean;
    }> = [
      {
        name: "team only, global",
        held: held([ON_PAYMENTS]),
        isGlobal: true,
        expected: true,
      },
      {
        name: "team only, on a policy",
        held: held([ON_PAYMENTS]),
        isGlobal: false,
        expected: true,
      },
      {
        name: "narrowed beside it, global",
        held: narrowed,
        isGlobal: true,
        expected: true,
      },
      {
        name: "narrowed beside it, on a policy",
        held: narrowed,
        isGlobal: false,
        expected: false,
      },
      {
        name: "everyone beside it",
        held: held([ON_PAYMENTS, row(Permission.ProjectMember)]),
        isGlobal: true,
        expected: false,
      },
      {
        name: "no team permission",
        held: held([row(Permission.OnCallViewer)]),
        isGlobal: true,
        expected: false,
      },
    ];

    for (const item of cases) {
      expect({
        name: item.name,
        limited: UserOverrideTeamAccess.isLimitedToTeams({
          held: item.held,
          modelPermissions: create,
          isGlobal: item.isGlobal,
        }),
      }).toEqual({ name: item.name, limited: item.expected });
    }
  });

  test("a global override, once the team rule holds it, is open to the team permission over the whole project", () => {
    expect(
      GlobalUserOverrideAccess.mayChange(held([ON_PAYMENTS]), create),
    ).toBe(true);
    expect(
      GlobalUserOverrideAccess.mayChange(
        held([
          row(USER_OVERRIDE_TEAM_PERMISSION, {
            teamId: new ObjectID(PAYMENTS),
            scope: PermissionScope.Labels,
            labelIds: [LABEL],
          }),
        ]),
        create,
      ),
    ).toBe(false);
  });

  test("tells its refusals apart, as a form says each under its field", () => {
    expect(
      UserOverrideTeamAccess.isAwayRefusal(USER_OVERRIDE_TEAM_AWAY_REFUSAL),
    ).toBe(true);
    expect(
      UserOverrideTeamAccess.isAwayRefusal(USER_OVERRIDE_TEAM_COVER_REFUSAL),
    ).toBe(false);
    expect(
      UserOverrideTeamAccess.isCoverRefusal(USER_OVERRIDE_TEAM_COVER_REFUSAL),
    ).toBe(true);
    expect(
      UserOverrideTeamAccess.isCoverRefusal(USER_OVERRIDE_TEAM_EDIT_REFUSAL),
    ).toBe(false);
  });

  test("every refusal is a sentence that says what to do next", () => {
    for (const refusal of [
      USER_OVERRIDE_TEAM_AWAY_REFUSAL,
      USER_OVERRIDE_TEAM_COVER_REFUSAL,
      USER_OVERRIDE_TEAM_EDIT_REFUSAL,
      USER_OVERRIDE_TEAM_DELETE_REFUSAL,
      USER_OVERRIDE_TEAM_NO_TEAM_REFUSAL,
    ]) {
      expect(refusal).toMatch(/^[A-Z].*\.$/);
      expect(refusal.split(". ").length).toBeGreaterThan(1);
    }

    expect(USER_OVERRIDE_TEAM_PICKER_HINT).toContain("{{teams}}");
  });
});
