import CustomRolePermissionService from "../../../Server/Services/CustomRolePermissionService";
import CustomRoleService, {
  CUSTOM_ROLE_OWNED_ONLY_MESSAGE,
} from "../../../Server/Services/CustomRoleService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import TeamOwnerTeamService from "../../../Server/Services/TeamOwnerTeamService";
import TeamOwnerUserService from "../../../Server/Services/TeamOwnerUserService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import Team from "../../../Models/DatabaseModels/Team";
import TeamOwnerTeam from "../../../Models/DatabaseModels/TeamOwnerTeam";
import TeamOwnerUser from "../../../Models/DatabaseModels/TeamOwnerUser";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { BUILT_IN_TEAM_OWNERS_MESSAGE } from "../../../Types/Team/BuiltInTeam";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A TEAM HAS OWNERS, AND THE TEAM PERMISSIONS SCOPED TO OWNED REACH THE
 * TEAMS THEIR HOLDER OWNS (#6561).
 *
 * The sweeps hold the Owned scope itself to every kind with owners, teams
 * among them (OwnedScopeEveryKindWithOwners, OwnedScopeOwnerWrites,
 * OwnedRecordsDeleteEveryKind). This suite holds what is a team's own:
 *
 *   - Owners and Admin, which come with every project, take no owners, in
 *     the words the Dashboard shows (TeamService.assertTeamCanHaveOwners,
 *     asked by both owner services);
 *   - whoever creates a team with Create Team scoped to Owned becomes its
 *     first owner, through the owner table that names the team by
 *     ownedTeamId - and nobody does with Create Team over the whole
 *     project, as a team is no operational resource;
 *   - a member of a team holds its rows through it, so inviting someone to
 *     it hands on nothing they do not hold: the team's rows scoped to Owned
 *     are covered by the inviter's own copies, held through that very team
 *     at the same scope and labels - not through another team, not for a
 *     row being created, not past a block, and not for the teams a single
 *     sign-on provider hands on;
 *   - a custom role is given to teams of every owner, so Edit Team
 *     Permissions scoped to Owned never changes one, nor what it holds.
 */

jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

const PROJECT_ID: ObjectID = new ObjectID(
  "6d100000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("6d200000-0000-4000-8000-000000000001");
// The team being joined, and another team of the inviter's.
const TEAM_T: ObjectID = new ObjectID("6d300000-0000-4000-8000-000000000001");
const TEAM_U: ObjectID = new ObjectID("6d300000-0000-4000-8000-000000000002");
const LABEL_A: ObjectID = new ObjectID("6d400000-0000-4000-8000-000000000001");
const LABEL_B: ObjectID = new ObjectID("6d400000-0000-4000-8000-000000000002");

interface RowOptions {
  teamId?: ObjectID | undefined;
  labelIds?: Array<ObjectID> | undefined;
  isBlock?: boolean | undefined;
}

function row(
  permission: Permission,
  scope: PermissionScope,
  options?: RowOptions,
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    scope: scope,
    labelIds: options?.labelIds || [],
    isBlockPermission: Boolean(options?.isBlock),
    teamId: options?.teamId,
  };
}

function propsHolding(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    ...ON_HIGHEST_PLAN,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.User],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
  };
}

// A row of the team being joined, as findAllBy reads it.
function rowOfTeamT(
  permission: Permission,
  scope: PermissionScope,
  labelIds: Array<ObjectID> = [],
): TeamPermission {
  const model: TeamPermission = new TeamPermission();
  model.teamId = TEAM_T;
  model.projectId = PROJECT_ID;
  model.permission = permission;
  model.scope = scope;
  model.labels = labelIds.map((labelId: ObjectID) => {
    return { _id: labelId.toString(), id: labelId } as never;
  });
  model.isBlockPermission = false;

  return model;
}

// The two permissions a team that owns itself is given in the docs' recipe.
const RECIPE: Array<Permission> = [
  Permission.InviteProjectTeamMembers,
  Permission.RemoveProjectTeamMembers,
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Owners and Admin take no owners", () => {
  const withTeam: (team: Team | null) => jest.SpiedFunction<never> = (
    team: Team | null,
  ): jest.SpiedFunction<never> => {
    return jest
      .spyOn(TeamService, "findOneById")
      .mockResolvedValue(team as never) as never;
  };

  const team: (isTeamEditable: boolean) => Team = (
    isTeamEditable: boolean,
  ): Team => {
    const model: Team = new Team(TEAM_T);
    model.isTeamEditable = isTeamEditable;
    return model;
  };

  test("a team that comes with every project is refused, in the words the Dashboard shows", async () => {
    withTeam(team(false));

    await expect(TeamService.assertTeamCanHaveOwners(TEAM_T)).rejects.toThrow(
      new BadDataException(BUILT_IN_TEAM_OWNERS_MESSAGE),
    );
    expect(BUILT_IN_TEAM_OWNERS_MESSAGE).toBe(
      "This team comes with every project and can't have owners.",
    );
  });

  test("every other team may have owners, read as OneUptime whoever asks", async () => {
    const lookup: jest.SpiedFunction<never> = withTeam(team(true));

    await expect(
      TeamService.assertTeamCanHaveOwners(TEAM_T.toString()),
    ).resolves.toBeUndefined();
    expect(lookup).toHaveBeenCalledWith({
      id: TEAM_T,
      select: { isTeamEditable: true },
      props: { isRoot: true },
    });
  });

  test("a team that is not there, and no team at all, are the reference check's to answer", async () => {
    const lookup: jest.SpiedFunction<never> = withTeam(null);

    await expect(
      TeamService.assertTeamCanHaveOwners(TEAM_T),
    ).resolves.toBeUndefined();
    await expect(
      TeamService.assertTeamCanHaveOwners(undefined),
    ).resolves.toBeUndefined();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["TeamOwnerUser", TeamOwnerUserService, TeamOwnerUser],
    ["TeamOwnerTeam", TeamOwnerTeamService, TeamOwnerTeam],
  ])(
    "%s: an owner is added only to a team that may have owners, after the project's reference check",
    async (
      _name: string,
      service: unknown,
      modelType: { new (): TeamOwnerUser | TeamOwnerTeam },
    ) => {
      const order: Array<string> = [];

      jest
        .spyOn(ProjectReferencesService.prototype as never, "onBeforeCreate")
        .mockImplementation((async (createBy: unknown) => {
          order.push("references");
          return { createBy: createBy, carryForward: null };
        }) as never);

      const assertion: jest.SpiedFunction<never> = jest
        .spyOn(TeamService, "assertTeamCanHaveOwners")
        .mockImplementation((async () => {
          order.push("team");
          throw new BadDataException(BUILT_IN_TEAM_OWNERS_MESSAGE);
        }) as never) as never;

      const data: TeamOwnerUser | TeamOwnerTeam = new modelType();
      data.ownedTeamId = TEAM_T;
      data.projectId = PROJECT_ID;

      await expect(
        (
          service as {
            onBeforeCreate: (createBy: unknown) => Promise<unknown>;
          }
        ).onBeforeCreate({ data: data, props: { isRoot: true } }),
      ).rejects.toThrow(BUILT_IN_TEAM_OWNERS_MESSAGE);
      expect(order).toEqual(["references", "team"]);
      expect(assertion).toHaveBeenCalledWith(TEAM_T);
    },
  );
});

describe("whoever creates a team with Create Team scoped to Owned becomes its first owner", () => {
  type CreatorOwnership = {
    createReliesOnOwnership: (props: DatabaseCommonInteractionProps) => boolean;
    insertCreatorAsOwner: (
      createdItem: Team,
      props: DatabaseCommonInteractionProps,
    ) => Promise<void>;
  };

  const teamService: CreatorOwnership =
    TeamService as unknown as CreatorOwnership;

  test("scoped to Owned, the create relies on ownership; over the whole project, or as a project admin, it does not", () => {
    expect(
      teamService.createReliesOnOwnership(
        propsHolding([
          row(Permission.CreateProjectTeam, PermissionScope.Owned, {
            teamId: TEAM_U,
          }),
        ]),
      ),
    ).toBe(true);
    expect(
      teamService.createReliesOnOwnership(
        propsHolding([
          row(Permission.CreateProjectTeam, PermissionScope.All, {
            teamId: TEAM_U,
          }),
        ]),
      ),
    ).toBe(false);
    expect(
      teamService.createReliesOnOwnership(
        propsHolding([
          row(Permission.CreateProjectTeam, PermissionScope.Owned, {
            teamId: TEAM_U,
          }),
          row(Permission.ProjectAdmin, PermissionScope.All, {
            teamId: TEAM_U,
          }),
        ]),
      ),
    ).toBe(false);
  });

  test("the creator is written into TeamOwnerUser, naming the new team by ownedTeamId", async () => {
    const written: Array<TeamOwnerUser> = [];

    jest
      .spyOn(TeamOwnerUserService, "create")
      .mockImplementation((async (args: { data: TeamOwnerUser }) => {
        written.push(args.data);
        return args.data;
      }) as never);

    const created: Team = new Team(TEAM_T);
    created.projectId = PROJECT_ID;

    await teamService.insertCreatorAsOwner(
      created,
      propsHolding([
        row(Permission.CreateProjectTeam, PermissionScope.Owned, {
          teamId: TEAM_U,
        }),
      ]),
    );

    expect(written).toHaveLength(1);
    expect(written[0]).toBeInstanceOf(TeamOwnerUser);
    expect(written[0]!.ownedTeamId?.toString()).toBe(TEAM_T.toString());
    expect(written[0]!.userId?.toString()).toBe(USER_ID.toString());
    expect(written[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
  });
});

describe("a member of a team invites to it with the rows they hold through it", () => {
  const teamRows: (rows: Array<TeamPermission>) => void = (
    rows: Array<TeamPermission>,
  ): void => {
    jest
      .spyOn(TeamPermissionService, "findAllBy")
      .mockResolvedValue(rows as never);
  };

  const invite: (rows: Array<UserPermission>) => Promise<void> = (
    rows: Array<UserPermission>,
  ): Promise<void> => {
    return TeamPermissionService.assertCanGrantTeamPermissions({
      teamId: TEAM_T,
      projectId: PROJECT_ID,
      props: propsHolding(rows),
    });
  };

  test("a team that owns itself, given the recipe scoped to Owned: its members invite people to it", async () => {
    teamRows(
      RECIPE.map((permission: Permission) => {
        return rowOfTeamT(permission, PermissionScope.Owned);
      }),
    );

    await expect(
      invite(
        RECIPE.map((permission: Permission) => {
          return row(permission, PermissionScope.Owned, { teamId: TEAM_T });
        }),
      ),
    ).resolves.toBeUndefined();
  });

  test("the same rows held through another team cover nothing of this one: an Owned row reaches what its own team owns", async () => {
    teamRows(
      RECIPE.map((permission: Permission) => {
        return rowOfTeamT(permission, PermissionScope.Owned);
      }),
    );

    await expect(
      invite(
        RECIPE.map((permission: Permission) => {
          return row(permission, PermissionScope.Owned, { teamId: TEAM_U });
        }),
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  test("a row of the team the inviter's copy does not match - a broader scope, other labels - is weighed as before", async () => {
    // The team's row reaches the whole project; the inviter's copy, its own.
    teamRows([
      rowOfTeamT(Permission.InviteProjectTeamMembers, PermissionScope.All),
    ]);

    await expect(
      invite([
        row(Permission.InviteProjectTeamMembers, PermissionScope.Owned, {
          teamId: TEAM_T,
        }),
      ]),
    ).rejects.toThrow(NotAuthorizedException);

    // The team's row is limited to one label; the inviter's copy, to another.
    teamRows([
      rowOfTeamT(Permission.InviteProjectTeamMembers, PermissionScope.Labels, [
        LABEL_A,
      ]),
    ]);

    await expect(
      invite([
        row(Permission.InviteProjectTeamMembers, PermissionScope.Labels, {
          teamId: TEAM_T,
          labelIds: [LABEL_B],
        }),
      ]),
    ).rejects.toThrow(NotAuthorizedException);
  });

  test("a block on the permission refuses it, whichever team the row comes through", async () => {
    teamRows([
      rowOfTeamT(Permission.InviteProjectTeamMembers, PermissionScope.Owned),
    ]);

    await expect(
      invite([
        row(Permission.InviteProjectTeamMembers, PermissionScope.Owned, {
          teamId: TEAM_T,
        }),
        row(Permission.InviteProjectTeamMembers, PermissionScope.All, {
          teamId: TEAM_U,
          isBlock: true,
        }),
      ]),
    ).rejects.toThrow(NotAuthorizedException);
  });

  test("a row being created is no team being joined: an Owned copy covers no new row", () => {
    expect(() => {
      TeamPermissionService.assertCanGrantPermission({
        permission: Permission.InviteProjectTeamMembers,
        scope: PermissionScope.Owned,
        props: propsHolding([
          row(Permission.InviteProjectTeamMembers, PermissionScope.Owned, {
            teamId: TEAM_T,
          }),
        ]),
      });
    }).toThrow(NotAuthorizedException);
  });

  test("the teams a single sign-on provider hands on are weighed as before: whoever signs in joins them, not the person saving them", async () => {
    teamRows(
      RECIPE.map((permission: Permission) => {
        return rowOfTeamT(permission, PermissionScope.Owned);
      }),
    );

    const refused: Array<ObjectID> =
      await TeamPermissionService.findTeamsCallerCannotGrant({
        teamIds: [TEAM_T],
        projectId: PROJECT_ID,
        props: propsHolding(
          RECIPE.map((permission: Permission) => {
            return row(permission, PermissionScope.Owned, { teamId: TEAM_T });
          }),
        ),
      });

    expect(
      refused.map((teamId: ObjectID): string => {
        return teamId.toString();
      }),
    ).toEqual([TEAM_T.toString()]);
  });
});

describe("a custom role is changed only with Edit Team Permissions over the whole project", () => {
  const OPERATIONS: Array<DatabaseRequestType> = [
    DatabaseRequestType.Create,
    DatabaseRequestType.Update,
    DatabaseRequestType.Delete,
  ];

  const assertion: (
    modelType: { new (): CustomRole | CustomRolePermission },
    rows: Array<UserPermission>,
    type: DatabaseRequestType,
  ) => () => void = (
    modelType: { new (): CustomRole | CustomRolePermission },
    rows: Array<UserPermission>,
    type: DatabaseRequestType,
  ): (() => void) => {
    return (): void => {
      CustomRoleService.assertNotLimitedToOwnedTeams(
        modelType,
        propsHolding(rows),
        type,
      );
    };
  };

  test.each([
    ["the role", CustomRole],
    ["what it holds", CustomRolePermission],
  ])(
    "%s: refused to a caller whose every grant is scoped to the teams they own, saying why",
    (
      _what: string,
      modelType: { new (): CustomRole | CustomRolePermission },
    ) => {
      for (const type of OPERATIONS) {
        expect(
          assertion(
            modelType,
            [
              row(
                Permission.EditProjectTeamPermissions,
                PermissionScope.Owned,
                {
                  teamId: TEAM_T,
                },
              ),
            ],
            type,
          ),
        ).toThrow(new NotAuthorizedException(CUSTOM_ROLE_OWNED_ONLY_MESSAGE));
      }
    },
  );

  test.each([
    ["the role", CustomRole],
    ["what it holds", CustomRolePermission],
  ])(
    "%s: left to the usual checks with a grant over the whole project, a project admin's, or no grant at all",
    (
      _what: string,
      modelType: { new (): CustomRole | CustomRolePermission },
    ) => {
      const callers: Array<Array<UserPermission>> = [
        [row(Permission.EditProjectTeamPermissions, PermissionScope.All)],
        [
          row(Permission.EditProjectTeamPermissions, PermissionScope.Owned, {
            teamId: TEAM_T,
          }),
          row(Permission.EditProjectTeamPermissions, PermissionScope.All, {
            teamId: TEAM_U,
          }),
        ],
        [row(Permission.ProjectAdmin, PermissionScope.All)],
        [],
      ];

      for (const rows of callers) {
        for (const type of OPERATIONS) {
          expect(assertion(modelType, rows, type)).not.toThrow();
        }
      }
    },
  );

  test("the message says what someone limited to their own teams can still do", () => {
    expect(CUSTOM_ROLE_OWNED_ONLY_MESSAGE).toBe(
      "A custom role can be given to any team, so changing one needs Edit Team Permissions for the whole project, not only for the teams you own. You can still give the project's custom roles to the teams you own, and take them away.",
    );
  });

  test("a role's create, rename and delete ask first", async () => {
    const props: DatabaseCommonInteractionProps = propsHolding([
      row(Permission.EditProjectTeamPermissions, PermissionScope.Owned, {
        teamId: TEAM_T,
      }),
    ]);
    const service: {
      onBeforeCreate: (createBy: unknown) => Promise<unknown>;
      onBeforeUpdate: (updateBy: unknown) => Promise<unknown>;
      onBeforeDelete: (deleteBy: unknown) => Promise<unknown>;
    } = CustomRoleService as never;

    await expect(
      service.onBeforeCreate({ data: new CustomRole(), props: props }),
    ).rejects.toThrow(CUSTOM_ROLE_OWNED_ONLY_MESSAGE);
    await expect(
      service.onBeforeUpdate({
        query: { _id: ObjectID.generate().toString() },
        data: { name: "Responder" },
        props: props,
      }),
    ).rejects.toThrow(CUSTOM_ROLE_OWNED_ONLY_MESSAGE);
    await expect(
      service.onBeforeDelete({
        query: { _id: ObjectID.generate().toString() },
        props: props,
      }),
    ).rejects.toThrow(CUSTOM_ROLE_OWNED_ONLY_MESSAGE);
  });

  test("a change of what a role holds asks after the project's reference check, and its delete first", async () => {
    jest
      .spyOn(ProjectReferencesService.prototype as never, "onBeforeCreate")
      .mockImplementation((async (createBy: unknown) => {
        return { createBy: createBy, carryForward: null };
      }) as never);
    jest
      .spyOn(ProjectReferencesService.prototype as never, "onBeforeUpdate")
      .mockImplementation((async (updateBy: unknown) => {
        return { updateBy: updateBy, carryForward: null };
      }) as never);

    const props: DatabaseCommonInteractionProps = propsHolding([
      row(Permission.EditProjectTeamPermissions, PermissionScope.Owned, {
        teamId: TEAM_T,
      }),
    ]);
    const service: {
      onBeforeCreate: (createBy: unknown) => Promise<unknown>;
      onBeforeUpdate: (updateBy: unknown) => Promise<unknown>;
      onBeforeDelete: (deleteBy: unknown) => Promise<unknown>;
    } = CustomRolePermissionService as never;

    await expect(
      service.onBeforeCreate({
        data: new CustomRolePermission(),
        props: props,
      }),
    ).rejects.toThrow(CUSTOM_ROLE_OWNED_ONLY_MESSAGE);
    await expect(
      service.onBeforeUpdate({
        query: { _id: ObjectID.generate().toString() },
        data: { scope: PermissionScope.All },
        props: props,
      }),
    ).rejects.toThrow(CUSTOM_ROLE_OWNED_ONLY_MESSAGE);
    await expect(
      service.onBeforeDelete({
        query: { _id: ObjectID.generate().toString() },
        props: props,
      }),
    ).rejects.toThrow(CUSTOM_ROLE_OWNED_ONLY_MESSAGE);
  });
});
