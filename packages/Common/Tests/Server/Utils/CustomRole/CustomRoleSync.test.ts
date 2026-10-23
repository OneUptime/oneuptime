import CustomRolePermission from "../../../../Models/DatabaseModels/CustomRolePermission";
import Label from "../../../../Models/DatabaseModels/Label";
import TeamCustomRole from "../../../../Models/DatabaseModels/TeamCustomRole";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../../Models/DatabaseModels/TeamPermission";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import ApiKeyCustomRoleService from "../../../../Server/Services/ApiKeyCustomRoleService";
import ApiKeyPermissionService from "../../../../Server/Services/ApiKeyPermissionService";
import CustomRolePermissionService from "../../../../Server/Services/CustomRolePermissionService";
import TeamCustomRoleService from "../../../../Server/Services/TeamCustomRoleService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../../Server/Services/TeamPermissionService";
import CustomRoleSync from "../../../../Server/Utils/CustomRole/CustomRoleSync";
import logger from "../../../../Server/Utils/Logger";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../../Server/Types/Database/DeleteBy";
import FindAllBy from "../../../../Server/Types/Database/FindAllBy";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import InMemoryLocks from "../../TestingUtils/InMemoryLocks";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * CustomRoleSync with the database stood in for: the order it writes in,
 * what it writes the copies as, whose cached permissions it rebuilds, and
 * what it does when Valkey or a rebuild fails. The same sync against a real
 * Postgres is CustomRolesPostgres.test.ts. No API key is given the role
 * here: the keys' half of the sync is CustomRoleSyncApiKeys.test.ts.
 */

const PROJECT: ObjectID = new ObjectID("0a000000-0000-4000-8000-000000000001");
const ROLE: ObjectID = new ObjectID("0b000000-0000-4000-8000-000000000001");
const TEAM_A: ObjectID = new ObjectID("0c000000-0000-4000-8000-000000000001");
const TEAM_B: ObjectID = new ObjectID("0c000000-0000-4000-8000-000000000002");
const GIVEN_A: ObjectID = new ObjectID("0d000000-0000-4000-8000-000000000001");
const GIVEN_B: ObjectID = new ObjectID("0d000000-0000-4000-8000-000000000002");
const ROW: ObjectID = new ObjectID("0e000000-0000-4000-8000-000000000001");
const LABEL: ObjectID = new ObjectID("0f000000-0000-4000-8000-000000000001");
const USER_1: ObjectID = new ObjectID("1a000000-0000-4000-8000-000000000001");
const USER_2: ObjectID = new ObjectID("1a000000-0000-4000-8000-000000000002");

const givenTo: (id: ObjectID, teamId: ObjectID) => TeamCustomRole = (
  id: ObjectID,
  teamId: ObjectID,
): TeamCustomRole => {
  const given: TeamCustomRole = new TeamCustomRole(id);
  given.teamId = teamId;
  given.customRoleId = ROLE;
  return given;
};

const roleRow: () => CustomRolePermission = (): CustomRolePermission => {
  const row: CustomRolePermission = new CustomRolePermission(ROW);
  row.customRoleId = ROLE;
  row.permission = Permission.MonitorViewer;
  row.scope = PermissionScope.Labels;
  row.labels = [new Label(LABEL)];
  return row;
};

const memberOf: (userId: ObjectID) => TeamMember = (
  userId: ObjectID,
): TeamMember => {
  const member: TeamMember = new TeamMember();
  member.userId = userId;
  return member;
};

describe("CustomRoleSync", () => {
  let writes: Array<string>;
  let created: Array<TeamPermission>;
  let deletedQueries: Array<DeleteBy<TeamPermission>>;
  let copies: Array<TeamPermission>;
  let locks: InMemoryLocks;

  beforeEach(() => {
    writes = [];
    created = [];
    deletedQueries = [];
    copies = [];
    locks = new InMemoryLocks();
    locks.install();

    getJestSpyOn(TeamCustomRoleService, "findAllBy").mockResolvedValue([
      givenTo(GIVEN_A, TEAM_A),
      givenTo(GIVEN_B, TEAM_B),
    ]);
    getJestSpyOn(CustomRolePermissionService, "findAllBy").mockResolvedValue([
      roleRow(),
    ]);
    getJestSpyOn(TeamPermissionService, "findAllBy").mockImplementation(
      async (): Promise<Array<TeamPermission>> => {
        return copies;
      },
    );
    getJestSpyOn(TeamPermissionService, "deleteBy").mockImplementation(
      async (deleteBy: DeleteBy<TeamPermission>): Promise<number> => {
        writes.push("delete");
        deletedQueries.push(deleteBy);
        return 1;
      },
    );
    getJestSpyOn(TeamPermissionService, "create").mockImplementation(
      async (createBy: CreateBy<TeamPermission>): Promise<TeamPermission> => {
        writes.push("create");
        created.push(createBy.data);
        expect(createBy.props).toEqual({ isRoot: true, ignoreHooks: true });
        return createBy.data;
      },
    );
    // No API key holds the role, nor a copy of it.
    getJestSpyOn(ApiKeyCustomRoleService, "findAllBy").mockResolvedValue([]);
    getJestSpyOn(ApiKeyPermissionService, "findAllBy").mockResolvedValue([]);
    getJestSpyOn(ApiKeyPermissionService, "deleteBy").mockImplementation(
      async (): Promise<number> => {
        writes.push("delete-key-copy");
        return 1;
      },
    );
    getJestSpyOn(ApiKeyPermissionService, "create").mockImplementation(
      async (): Promise<never> => {
        throw new Error("No key holds the role: no key copy is made.");
      },
    );
    getJestSpyOn(
      ApiKeyPermissionService,
      "forgetPermissionsOfProjects",
    ).mockResolvedValue(undefined);
    getJestSpyOn(TeamMemberService, "findAllBy").mockImplementation(
      async (findAllBy: FindAllBy<TeamMember>): Promise<Array<TeamMember>> => {
        // Only accepted members hold the project's permissions.
        expect(findAllBy.query.hasAcceptedInvitation).toBe(true);
        return [memberOf(USER_1), memberOf(USER_2), memberOf(USER_1)];
      },
    );
    getJestSpyOn(
      AccessTokenService,
      "refreshUserTenantAccessPermission",
    ).mockResolvedValue(null);
    getJestSpyOn(
      AccessTokenService,
      "clearCachedPermissions",
    ).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("makes a copy of the role's permission on every team given it, as OneUptime, with the role's marks, scope and labels", async () => {
    const changed: Array<ObjectID> = await CustomRoleSync.syncRoles({
      projectId: PROJECT,
      customRoleIds: [ROLE, ROLE],
    });

    expect(
      changed.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([TEAM_A.toString(), TEAM_B.toString()]);
    expect(created).toHaveLength(2);

    for (const [copy, teamId, givenId] of [
      [created[0]!, TEAM_A, GIVEN_A],
      [created[1]!, TEAM_B, GIVEN_B],
    ] as Array<[TeamPermission, ObjectID, ObjectID]>) {
      expect(copy.projectId?.toString()).toBe(PROJECT.toString());
      expect(copy.teamId?.toString()).toBe(teamId.toString());
      expect(copy.permission).toBe(Permission.MonitorViewer);
      expect(copy.scope).toBe(PermissionScope.Labels);
      expect(copy.isBlockPermission).toBe(false);
      expect(
        (copy.labels || []).map((label: Label): string => {
          return label.id!.toString();
        }),
      ).toEqual([LABEL.toString()]);
      expect(copy.customRoleId?.toString()).toBe(ROLE.toString());
      expect(copy.teamCustomRoleId?.toString()).toBe(givenId.toString());
      expect(copy.customRolePermissionId?.toString()).toBe(ROW.toString());
    }
  });

  test("deletes what no longer matches before it creates anything", async () => {
    const stale: TeamPermission = new TeamPermission(
      new ObjectID("2a000000-0000-4000-8000-000000000001"),
    );
    stale.teamId = TEAM_A;
    stale.customRoleId = ROLE;
    stale.teamCustomRoleId = GIVEN_A;
    stale.customRolePermissionId = ROW;
    stale.permission = Permission.MonitorAdmin;
    stale.scope = PermissionScope.All;
    stale.labels = [];
    copies = [stale];

    await CustomRoleSync.syncRoles({
      projectId: PROJECT,
      customRoleIds: [ROLE],
    });

    expect(writes).toEqual(["delete", "create", "create"]);
    expect(deletedQueries[0]!.props).toEqual({
      isRoot: true,
      ignoreHooks: true,
    });
    expect(String(deletedQueries[0]!.query.projectId)).toBe(PROJECT.toString());
  });

  test("rebuilds the cached permissions of each accepted member of the teams it changed, once each", async () => {
    await CustomRoleSync.syncRoles({
      projectId: PROJECT,
      customRoleIds: [ROLE],
    });

    const refreshed: Array<string> = (
      AccessTokenService.refreshUserTenantAccessPermission as jest.Mock
    ).mock.calls.map((call: Array<unknown>): string => {
      expect(String(call[1])).toBe(PROJECT.toString());
      return String(call[0]);
    });

    expect(refreshed).toEqual([USER_1.toString(), USER_2.toString()]);
  });

  test("changes nothing, and rebuilds nobody's permissions, when the copies are right", async () => {
    await CustomRoleSync.syncRoles({
      projectId: PROJECT,
      customRoleIds: [ROLE],
    });
    copies = created.map((copy: TeamPermission, index: number) => {
      copy.id = new ObjectID(`3a000000-0000-4000-8000-00000000000${index}`);
      return copy;
    });
    writes = [];
    (
      AccessTokenService.refreshUserTenantAccessPermission as jest.Mock
    ).mockClear();

    const changed: Array<ObjectID> = await CustomRoleSync.syncRoles({
      projectId: PROJECT,
      customRoleIds: [ROLE],
    });

    expect(changed).toEqual([]);
    expect(writes).toEqual([]);
    expect(
      AccessTokenService.refreshUserTenantAccessPermission,
    ).not.toHaveBeenCalled();
  });

  test("runs inside the project's lock, and gives it back", async () => {
    await CustomRoleSync.syncRoles({
      projectId: PROJECT,
      customRoleIds: [ROLE],
    });

    const label: string = `${CustomRoleSync.LOCK_NAMESPACE}/${PROJECT.toString()}`;
    expect(locks.events).toEqual([`lock:${label}`, `release:${label}`]);
    expect(
      locks.isHeld(PROJECT.toString(), CustomRoleSync.LOCK_NAMESPACE),
    ).toBe(false);
  });

  test("gives the lock back when the sync fails", async () => {
    getJestSpyOn(TeamPermissionService, "create").mockRejectedValue(
      new Error("database went away"),
    );

    await expect(
      CustomRoleSync.syncRoles({ projectId: PROJECT, customRoleIds: [ROLE] }),
    ).rejects.toThrow("database went away");

    expect(
      locks.isHeld(PROJECT.toString(), CustomRoleSync.LOCK_NAMESPACE),
    ).toBe(false);
    // Nobody's cached permissions are rebuilt for a sync that did not finish.
    expect(
      AccessTokenService.refreshUserTenantAccessPermission,
    ).not.toHaveBeenCalled();
  });

  test("still syncs when Valkey cannot give the lock: the sync reads everything afresh", async () => {
    locks.unreachable = true;
    const logged: jest.SpyInstance = getJestSpyOn(
      logger,
      "error",
    ).mockImplementation(() => {
      return undefined;
    });

    await CustomRoleSync.syncRoles({
      projectId: PROJECT,
      customRoleIds: [ROLE],
    });

    expect(created).toHaveLength(2);
    expect(logged).toHaveBeenCalled();
  });

  test("drops a member's cached permissions when they cannot be rebuilt, so the next request rebuilds them", async () => {
    getJestSpyOn(AccessTokenService, "refreshUserTenantAccessPermission")
      .mockRejectedValueOnce(new Error("cache is down"))
      .mockResolvedValue(null);
    getJestSpyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });

    await CustomRoleSync.refreshMembersOfTeams({
      projectId: PROJECT,
      teamIds: [TEAM_A],
    });

    expect(AccessTokenService.clearCachedPermissions).toHaveBeenCalledTimes(1);
    expect(
      String(
        (AccessTokenService.clearCachedPermissions as jest.Mock).mock
          .calls[0]![0],
      ),
    ).toBe(USER_1.toString());
    // The next member is still rebuilt.
    expect(
      AccessTokenService.refreshUserTenantAccessPermission,
    ).toHaveBeenCalledTimes(2);
  });

  test("asks nothing of the database for no roles and no teams", async () => {
    expect(
      await CustomRoleSync.syncRoles({ projectId: PROJECT, customRoleIds: [] }),
    ).toEqual([]);
    expect(
      await CustomRoleSync.getTeamIdsGivenRoles({
        projectId: PROJECT,
        customRoleIds: [],
      }),
    ).toEqual([]);
    expect(
      await CustomRoleSync.getMemberIdsOfTeams({
        projectId: PROJECT,
        teamIds: [],
      }),
    ).toEqual([]);
    expect(
      await CustomRoleSync.removeCopiesOfRolePermissions({
        projectId: PROJECT,
        customRolePermissionIds: [],
      }),
    ).toEqual([]);

    expect(TeamCustomRoleService.findAllBy).not.toHaveBeenCalled();
    expect(TeamMemberService.findAllBy).not.toHaveBeenCalled();
    expect(TeamPermissionService.findAllBy).not.toHaveBeenCalled();
    expect(ApiKeyCustomRoleService.findAllBy).not.toHaveBeenCalled();
    expect(ApiKeyPermissionService.findAllBy).not.toHaveBeenCalled();
  });

  test("with no key given the role, the keys' half reads the role's permissions no second time and forgets no key's permissions", async () => {
    await CustomRoleSync.syncRoles({
      projectId: PROJECT,
      customRoleIds: [ROLE],
    });

    // Once, for the teams.
    expect(CustomRolePermissionService.findAllBy).toHaveBeenCalledTimes(1);
    expect(
      ApiKeyPermissionService.forgetPermissionsOfProjects,
    ).not.toHaveBeenCalled();
    expect(writes).not.toContain("delete-key-copy");
  });

  test("removes the copies of the role permissions about to change, from every team, and says which teams", async () => {
    const first: TeamPermission = new TeamPermission(
      new ObjectID("4a000000-0000-4000-8000-000000000001"),
    );
    first.teamId = TEAM_A;
    const second: TeamPermission = new TeamPermission(
      new ObjectID("4a000000-0000-4000-8000-000000000002"),
    );
    second.teamId = TEAM_B;
    copies = [first, second];

    const teams: Array<ObjectID> =
      await CustomRoleSync.removeCopiesOfRolePermissions({
        projectId: PROJECT,
        customRolePermissionIds: [ROW],
      });

    expect(
      teams.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([TEAM_A.toString(), TEAM_B.toString()]);
    expect(writes).toEqual(["delete"]);
    expect(JSON.stringify(deletedQueries[0]!.query._id)).toContain(
      first.id!.toString(),
    );
  });
});
