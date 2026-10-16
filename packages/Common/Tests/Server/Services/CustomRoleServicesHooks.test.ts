import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import TeamCustomRole from "../../../Models/DatabaseModels/TeamCustomRole";
import Team from "../../../Models/DatabaseModels/Team";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import CustomRolePermissionService from "../../../Server/Services/CustomRolePermissionService";
import CustomRoleService from "../../../Server/Services/CustomRoleService";
import TeamCustomRoleService from "../../../Server/Services/TeamCustomRoleService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import CustomRoleSync from "../../../Server/Utils/CustomRole/CustomRoleSync";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * THE CUSTOM ROLE SERVICES' HOOKS, ON THE PATHS A REAL DATABASE RARELY TAKES.
 *
 * CustomRolesPostgres.test.ts runs the services against Postgres; this holds
 * what is hard to make happen there: a sync that fails after the role's
 * permission, or the role's hold of a team, was written - which must be
 * taken back, so a role never says more than its teams hold - a change
 * whose copies were deleted and whose write then failed, and the refusals
 * a team's copies of a role's permission meet when changed on their own.
 */

const PROJECT: ObjectID = new ObjectID("5a000000-0000-4000-8000-000000000001");
const ROLE: ObjectID = new ObjectID("5b000000-0000-4000-8000-000000000001");
const ROW: ObjectID = new ObjectID("5c000000-0000-4000-8000-000000000001");
const TEAM: ObjectID = new ObjectID("5d000000-0000-4000-8000-000000000001");
const GIVEN: ObjectID = new ObjectID("5e000000-0000-4000-8000-000000000001");
const COPY: ObjectID = new ObjectID("5f000000-0000-4000-8000-000000000001");

type HookService = Record<
  string,
  (...args: Array<unknown>) => Promise<unknown>
>;

const callHook: (
  service: unknown,
  hook: string,
  ...args: Array<unknown>
) => Promise<unknown> = (
  service: unknown,
  hook: string,
  ...args: Array<unknown>
): Promise<unknown> => {
  return (service as HookService)[hook]!.apply(service, args);
};

const adminProps: DatabaseCommonInteractionProps = {
  userId: new ObjectID("6a000000-0000-4000-8000-000000000001"),
  tenantId: PROJECT,
  ...ON_HIGHEST_PLAN,
  userGlobalAccessPermission: {
    _type: "UserGlobalAccessPermission",
    projectIds: [PROJECT],
    globalPermissions: [Permission.User],
  },
  userTenantAccessPermission: {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectAdmin,
          labelIds: [],
          isBlockPermission: false,
          scope: PermissionScope.All,
        },
      ],
    },
  },
};

beforeEach(() => {
  stubProjectDirectory({});
  getJestSpyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a permission added to a role whose teams could not be given it", () => {
  test("is taken out of the role again, the count kept, and the add refused", async () => {
    const created: CustomRolePermission = new CustomRolePermission(ROW);
    created.projectId = PROJECT;
    created.customRoleId = ROLE;
    created.permission = Permission.IncidentMember;

    const failure: Error = new Error("could not write the copies");
    getJestSpyOn(CustomRoleSync, "syncRoles").mockRejectedValue(failure);
    const deleteBy: jest.SpyInstance = getJestSpyOn(
      CustomRolePermissionService,
      "deleteBy",
    ).mockResolvedValue(1);
    const recount: jest.SpyInstance = getJestSpyOn(
      CustomRolePermissionService,
      "recountPermissions",
    ).mockResolvedValue(0);

    await expect(
      callHook(
        CustomRolePermissionService,
        "onCreateSuccess",
        { createBy: { data: created, props: adminProps }, carryForward: null },
        created,
      ),
    ).rejects.toBe(failure);

    const undo: DeleteBy<CustomRolePermission> = deleteBy.mock
      .calls[0]![0] as DeleteBy<CustomRolePermission>;
    expect(String(undo.query._id)).toBe(ROW.toString());
    expect(String(undo.query.projectId)).toBe(PROJECT.toString());
    expect(undo.props).toEqual({ isRoot: true, ignoreHooks: true });
    expect(recount).toHaveBeenCalledWith({
      customRoleId: ROLE,
      projectId: PROJECT,
    });
  });

  test("when the copies are made, the role's count is counted again", async () => {
    const created: CustomRolePermission = new CustomRolePermission(ROW);
    created.projectId = PROJECT;
    created.customRoleId = ROLE;

    getJestSpyOn(CustomRoleSync, "syncRoles").mockResolvedValue([TEAM]);
    const deleteBy: jest.SpyInstance = getJestSpyOn(
      CustomRolePermissionService,
      "deleteBy",
    ).mockResolvedValue(1);
    const recount: jest.SpyInstance = getJestSpyOn(
      CustomRolePermissionService,
      "recountPermissions",
    ).mockResolvedValue(1);

    await expect(
      callHook(
        CustomRolePermissionService,
        "onCreateSuccess",
        { createBy: { data: created, props: adminProps }, carryForward: null },
        created,
      ),
    ).resolves.toBe(created);

    expect(deleteBy).not.toHaveBeenCalled();
    expect(recount).toHaveBeenCalledTimes(1);
    expect(CustomRoleSync.syncRoles).toHaveBeenCalledWith({
      projectId: PROJECT,
      customRoleIds: [ROLE],
    });
  });
});

describe("a role given to a team that could not be given its permissions", () => {
  test("is taken from the team again, its members rebuilt, and the give refused", async () => {
    const created: TeamCustomRole = new TeamCustomRole(GIVEN);
    created.projectId = PROJECT;
    created.customRoleId = ROLE;
    created.teamId = TEAM;

    const failure: Error = new Error("could not write the copies");
    getJestSpyOn(CustomRoleSync, "syncRoles").mockRejectedValue(failure);
    const refresh: jest.SpyInstance = getJestSpyOn(
      CustomRoleSync,
      "refreshMembersOfTeams",
    ).mockResolvedValue(undefined);
    const deleteBy: jest.SpyInstance = getJestSpyOn(
      TeamCustomRoleService,
      "deleteBy",
    ).mockResolvedValue(1);

    await expect(
      callHook(
        TeamCustomRoleService,
        "onCreateSuccess",
        { createBy: { data: created, props: adminProps }, carryForward: null },
        created,
      ),
    ).rejects.toBe(failure);

    const undo: DeleteBy<TeamCustomRole> = deleteBy.mock
      .calls[0]![0] as DeleteBy<TeamCustomRole>;
    expect(String(undo.query._id)).toBe(GIVEN.toString());
    expect(undo.props).toEqual({ isRoot: true, ignoreHooks: true });
    expect(refresh).toHaveBeenCalledWith({
      projectId: PROJECT,
      teamIds: [TEAM],
    });
  });
});

describe("a change to a role's permission", () => {
  const changedRows: () => Array<CustomRolePermission> =
    (): Array<CustomRolePermission> => {
      const row: CustomRolePermission = new CustomRolePermission(ROW);
      row.projectId = PROJECT;
      row.customRoleId = ROLE;
      return [row];
    };

  const updateBy: UpdateBy<CustomRolePermission> = {
    query: { _id: ROW },
    data: { scope: PermissionScope.Owned },
    props: adminProps,
    skip: 0,
    limit: 1,
  } as unknown as UpdateBy<CustomRolePermission>;

  test("deletes the teams' old copies before it is written", async () => {
    getJestSpyOn(
      CustomRolePermissionService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue(changedRows());
    const remove: jest.SpyInstance = getJestSpyOn(
      CustomRoleSync,
      "removeCopiesOfRolePermissions",
    ).mockResolvedValue([TEAM]);

    await callHook(CustomRolePermissionService, "onUpdatePermitted", updateBy);

    expect(remove).toHaveBeenCalledWith({
      projectId: PROJECT,
      customRolePermissionIds: [ROW],
    });
  });

  test("once written, makes the new copies on every team with the role", async () => {
    const sync: jest.SpyInstance = getJestSpyOn(
      CustomRoleSync,
      "syncRoles",
    ).mockResolvedValue([TEAM]);

    const onUpdate: OnUpdate<CustomRolePermission> = {
      updateBy: updateBy,
      carryForward: [
        {
          projectId: PROJECT,
          customRoleIds: [ROLE],
          rolePermissionIds: [ROW],
          teamIds: [],
        },
      ],
    };

    await expect(
      callHook(CustomRolePermissionService, "onUpdateSuccess", onUpdate, [ROW]),
    ).resolves.toBe(onUpdate);
    expect(sync).toHaveBeenCalledWith({
      projectId: PROJECT,
      customRoleIds: [ROLE],
    });
  });

  test("that fails puts the copies back as the role is, and is still refused with its own error", async () => {
    const sync: jest.SpyInstance = getJestSpyOn(
      CustomRoleSync,
      "syncRoles",
    ).mockRejectedValue(new Error("and the sync failed too"));
    const failure: BadDataException = new BadDataException("write failed");

    await expect(
      callHook(CustomRolePermissionService, "onUpdateError", failure, {
        updateBy: updateBy,
        carryForward: [
          {
            projectId: PROJECT,
            customRoleIds: [ROLE],
            rolePermissionIds: [ROW],
            teamIds: [],
          },
        ],
      }),
    ).resolves.toBe(failure);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  test("that failed before its hook ran has nothing to put back", async () => {
    const sync: jest.SpyInstance = getJestSpyOn(
      CustomRoleSync,
      "syncRoles",
    ).mockResolvedValue([]);
    const failure: BadDataException = new BadDataException("refused");

    await expect(
      callHook(
        CustomRolePermissionService,
        "onUpdateError",
        failure,
        undefined,
      ),
    ).resolves.toBe(failure);
    expect(sync).not.toHaveBeenCalled();
  });

  test("may not set the scope to nothing", async () => {
    getJestSpyOn(
      CustomRolePermissionService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue(changedRows());

    await expect(
      callHook(CustomRolePermissionService, "onBeforeUpdate", {
        ...updateBy,
        data: { scope: null },
      }),
    ).rejects.toThrow("The scope of a permission is All, Owned or Labels.");
  });
});

describe("a new role", () => {
  test("holds no permission yet, whatever its create sends", async () => {
    const role: CustomRole = new CustomRole();
    role.permissionCount = 42;
    const onCreate: OnCreate<CustomRole> = {
      createBy: { data: role, props: adminProps },
      carryForward: null,
    };

    await callHook(CustomRoleService, "onCreatePermitted", onCreate);

    expect(role.permissionCount).toBe(0);
  });

  test("is refused a built-in role's name before anything is read", async () => {
    const findBy: jest.SpyInstance = getJestSpyOn(
      CustomRoleService,
      "findBy",
    ).mockResolvedValue([]);
    const role: CustomRole = new CustomRole();
    role.name = "  incident member ";

    await expect(
      callHook(CustomRoleService, "onBeforeCreate", {
        data: role,
        props: adminProps,
      } as CreateBy<CustomRole>),
    ).rejects.toThrow(
      "Incident Member is a built-in role. Pick another name for your role.",
    );
    expect(findBy).not.toHaveBeenCalled();
  });

  test("keeps its name trimmed, with inner runs of space made one", async () => {
    getJestSpyOn(CustomRoleService, "findBy").mockResolvedValue([]);
    const role: CustomRole = new CustomRole();
    role.name = "  Incident    Responder ";

    await callHook(CustomRoleService, "onBeforeCreate", {
      data: role,
      props: adminProps,
    } as CreateBy<CustomRole>);

    expect(role.name).toBe("Incident Responder");
  });

  test("is refused a name another role of the project has, whatever its spacing", async () => {
    const existing: CustomRole = new CustomRole(ROLE);
    existing.name = "Incident  Responder";
    getJestSpyOn(CustomRoleService, "findBy").mockResolvedValue([existing]);
    const role: CustomRole = new CustomRole();
    role.name = "incident responder";

    await expect(
      callHook(CustomRoleService, "onBeforeCreate", {
        data: role,
        props: adminProps,
      } as CreateBy<CustomRole>),
    ).rejects.toThrow(
      "There is already a role called incident responder in this project. Pick another name.",
    );
  });

  test("renamed, may keep its own name in another case", async () => {
    const existing: CustomRole = new CustomRole(ROLE);
    existing.name = "Incident Responder";
    existing.projectId = PROJECT;
    getJestSpyOn(CustomRoleService, "findBy").mockResolvedValue([existing]);
    getJestSpyOn(
      CustomRoleService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([existing]);

    const update: UpdateBy<CustomRole> = {
      query: { _id: ROLE },
      data: { name: "incident responder" },
      props: adminProps,
      skip: 0,
      limit: 1,
    } as unknown as UpdateBy<CustomRole>;

    await callHook(CustomRoleService, "onBeforeUpdate", update);
    expect(update.data.name).toBe("incident responder");
  });

  test("two roles are never renamed to one name at once", async () => {
    const first: CustomRole = new CustomRole(ROLE);
    first.projectId = PROJECT;
    const second: CustomRole = new CustomRole(GIVEN);
    second.projectId = PROJECT;
    getJestSpyOn(
      CustomRoleService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([first, second]);

    await expect(
      callHook(CustomRoleService, "onBeforeUpdate", {
        query: {},
        data: { name: "Team Lead" },
        props: adminProps,
        skip: 0,
        limit: 10,
      }),
    ).rejects.toThrow(
      "Rename one role at a time: two roles can't have the same name.",
    );
  });

  test("renamed in another project than the request's, is refused", async () => {
    const theirs: CustomRole = new CustomRole(ROLE);
    theirs.projectId = new ObjectID("7a000000-0000-4000-8000-000000000001");
    getJestSpyOn(
      CustomRoleService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([theirs]);

    await expect(
      callHook(CustomRoleService, "onBeforeUpdate", {
        query: { _id: ROLE },
        data: { name: "Team Lead" },
        props: adminProps,
        skip: 0,
        limit: 1,
      }),
    ).rejects.toThrow(
      "Custom roles can only be changed inside the current project.",
    );
  });
});

describe("a team's copy of a role's permission", () => {
  const copy: () => TeamPermission = (): TeamPermission => {
    const row: TeamPermission = new TeamPermission(COPY);
    row.projectId = PROJECT;
    row.teamId = TEAM;
    row.permission = Permission.IncidentMember;
    row.customRoleId = ROLE;
    row.teamCustomRoleId = GIVEN;
    const role: CustomRole = new CustomRole(ROLE);
    role.name = "Incident Responder";
    row.customRole = role;
    return row;
  };

  const refusal: string =
    "Incident Member comes with the custom role Incident Responder. Change the role, or take the role away from the team.";

  test("is not changed on its own, by anyone a request speaks for", async () => {
    getJestSpyOn(
      TeamPermissionService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([copy()]);

    for (const props of [
      adminProps,
      { ...adminProps, isMasterAdmin: true },
    ] as Array<DatabaseCommonInteractionProps>) {
      await expect(
        callHook(TeamPermissionService, "onBeforeUpdate", {
          query: { _id: COPY },
          data: { scope: PermissionScope.Owned },
          props: props,
          skip: 0,
          limit: 1,
        }),
      ).rejects.toThrow(refusal);
    }
  });

  test("is not removed on its own, by anyone a request speaks for", async () => {
    getJestSpyOn(
      TeamPermissionService,
      "findRowsAndHoldDeleteToThem",
    ).mockResolvedValue([copy()]);

    for (const props of [
      adminProps,
      { ...adminProps, isMasterAdmin: true },
    ] as Array<DatabaseCommonInteractionProps>) {
      await expect(
        callHook(TeamPermissionService, "onBeforeDelete", {
          query: { _id: COPY },
          props: props,
          skip: 0,
          limit: 1,
        }),
      ).rejects.toThrow(refusal);
    }
  });

  test("named only by its marks, still says it is a role's", async () => {
    const bare: TeamPermission = copy();
    // The row as read without its role: no name, no link to the team's hold.
    const unset: Record<string, unknown> = bare as unknown as Record<
      string,
      unknown
    >;
    unset["customRole"] = undefined;
    unset["teamCustomRoleId"] = undefined;
    getJestSpyOn(
      TeamPermissionService,
      "findRowsAndHoldDeleteToThem",
    ).mockResolvedValue([bare]);

    await expect(
      callHook(TeamPermissionService, "onBeforeDelete", {
        query: { _id: COPY },
        props: adminProps,
        skip: 0,
        limit: 1,
      }),
    ).rejects.toThrow(
      "Incident Member comes with a custom role. Change the role, or take the role away from the team.",
    );
  });

  test("does not count as the team's own when the team is given the same permission directly", async () => {
    const findOneBy: jest.SpyInstance = getJestSpyOn(
      TeamPermissionService,
      "findOneBy",
    ).mockResolvedValue(null);
    const team: Team = new Team(TEAM);
    team.isPermissionsEditable = true;
    team.projectId = PROJECT;
    getJestSpyOn(TeamService, "findOneBy").mockResolvedValue(team);

    const row: TeamPermission = new TeamPermission();
    row.projectId = PROJECT;
    row.teamId = TEAM;
    row.permission = Permission.ProjectAdmin;
    row.scope = PermissionScope.All;

    await callHook(TeamPermissionService, "onBeforeCreate", {
      data: row,
      props: adminProps,
    } as CreateBy<TeamPermission>);

    const duplicateQuery: FindOneBy<TeamPermission> = findOneBy.mock
      .calls[0]![0] as FindOneBy<TeamPermission>;
    const onlyOwnRows: FindOperator<unknown> = duplicateQuery.query
      .teamCustomRoleId as unknown as FindOperator<unknown>;

    expect(onlyOwnRows.type).toBe("raw");
    expect(onlyOwnRows.getSql!("teamCustomRoleId")).toBe(
      "(teamCustomRoleId IS NULL)",
    );
  });
});
