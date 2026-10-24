import ApiKeyCustomRole from "../../../../Models/DatabaseModels/ApiKeyCustomRole";
import ApiKeyPermission from "../../../../Models/DatabaseModels/ApiKeyPermission";
import CustomRolePermission from "../../../../Models/DatabaseModels/CustomRolePermission";
import Label from "../../../../Models/DatabaseModels/Label";
import TeamPermission from "../../../../Models/DatabaseModels/TeamPermission";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import ApiKeyCustomRoleService from "../../../../Server/Services/ApiKeyCustomRoleService";
import ApiKeyPermissionService from "../../../../Server/Services/ApiKeyPermissionService";
import CustomRolePermissionService from "../../../../Server/Services/CustomRolePermissionService";
import TeamCustomRoleService from "../../../../Server/Services/TeamCustomRoleService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../../Server/Services/TeamPermissionService";
import CustomRoleSync from "../../../../Server/Utils/CustomRole/CustomRoleSync";
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
 * CustomRoleSync's API key half, with the database stood in for: a key
 * given a role holds a copy of each of the role's permissions that gives a
 * key anything, written as OneUptime with the role's marks and labels;
 * stale copies go before new ones are made; and every server stops serving
 * a key's old permissions - after the deletes, so nothing taken away is
 * served on, and after the creates. The same sync against a real Postgres
 * is ApiKeyCustomRolesPostgres.test.ts.
 */

const PROJECT: ObjectID = new ObjectID("0a000000-0000-4000-8000-000000000001");
const ROLE: ObjectID = new ObjectID("0b000000-0000-4000-8000-000000000001");
const KEY_A: ObjectID = new ObjectID("0c000000-0000-4000-8000-000000000001");
const KEY_B: ObjectID = new ObjectID("0c000000-0000-4000-8000-000000000002");
const GIVEN_A: ObjectID = new ObjectID("0d000000-0000-4000-8000-000000000001");
const GIVEN_B: ObjectID = new ObjectID("0d000000-0000-4000-8000-000000000002");
const LABELLED_ROW: ObjectID = new ObjectID(
  "0e000000-0000-4000-8000-000000000001",
);
const OWNED_ROW: ObjectID = new ObjectID(
  "0e000000-0000-4000-8000-000000000002",
);
const LABEL: ObjectID = new ObjectID("0f000000-0000-4000-8000-000000000001");

const givenTo: (id: ObjectID, apiKeyId: ObjectID) => ApiKeyCustomRole = (
  id: ObjectID,
  apiKeyId: ObjectID,
): ApiKeyCustomRole => {
  const given: ApiKeyCustomRole = new ApiKeyCustomRole(id);
  given.apiKeyId = apiKeyId;
  given.customRoleId = ROLE;
  return given;
};

// Monitor Viewer for the Production label, and Alert Member for what is owned.
const roleRows: () => Array<CustomRolePermission> =
  (): Array<CustomRolePermission> => {
    const labelled: CustomRolePermission = new CustomRolePermission(
      LABELLED_ROW,
    );
    labelled.customRoleId = ROLE;
    labelled.permission = Permission.MonitorViewer;
    labelled.scope = PermissionScope.Labels;
    labelled.labels = [new Label(LABEL)];

    const owned: CustomRolePermission = new CustomRolePermission(OWNED_ROW);
    owned.customRoleId = ROLE;
    owned.permission = Permission.AlertMember;
    owned.scope = PermissionScope.Owned;
    owned.labels = [];

    return [labelled, owned];
  };

describe("CustomRoleSync for API keys", () => {
  let writes: Array<string>;
  let created: Array<ApiKeyPermission>;
  let deletedQueries: Array<DeleteBy<ApiKeyPermission>>;
  let keyCopies: Array<ApiKeyPermission>;
  let givenToKeys: Array<ApiKeyCustomRole>;
  let locks: InMemoryLocks;

  beforeEach(() => {
    writes = [];
    created = [];
    deletedQueries = [];
    keyCopies = [];
    givenToKeys = [givenTo(GIVEN_A, KEY_A), givenTo(GIVEN_B, KEY_B)];
    locks = new InMemoryLocks();
    locks.install();

    // No team is given the role here (CustomRoleSync.test.ts has them).
    getJestSpyOn(TeamCustomRoleService, "findAllBy").mockResolvedValue([]);
    getJestSpyOn(TeamPermissionService, "findAllBy").mockResolvedValue([]);
    getJestSpyOn(TeamPermissionService, "deleteBy").mockResolvedValue(0);
    getJestSpyOn(TeamPermissionService, "create").mockImplementation(
      async (): Promise<TeamPermission> => {
        throw new Error("No team holds the role: no team copy is made.");
      },
    );
    getJestSpyOn(TeamMemberService, "findAllBy").mockResolvedValue([]);
    getJestSpyOn(
      AccessTokenService,
      "refreshUserTenantAccessPermission",
    ).mockResolvedValue(null);

    getJestSpyOn(CustomRolePermissionService, "findAllBy").mockImplementation(
      async (): Promise<Array<CustomRolePermission>> => {
        return roleRows();
      },
    );
    getJestSpyOn(ApiKeyCustomRoleService, "findAllBy").mockImplementation(
      async (
        findAllBy: FindAllBy<ApiKeyCustomRole>,
      ): Promise<Array<ApiKeyCustomRole>> => {
        expect(findAllBy.props).toEqual({ isRoot: true });
        expect(String(findAllBy.query.projectId)).toBe(PROJECT.toString());
        return givenToKeys;
      },
    );
    getJestSpyOn(ApiKeyPermissionService, "findAllBy").mockImplementation(
      async (
        findAllBy: FindAllBy<ApiKeyPermission>,
      ): Promise<Array<ApiKeyPermission>> => {
        expect(findAllBy.props).toEqual({ isRoot: true });
        expect(String(findAllBy.query.projectId)).toBe(PROJECT.toString());
        return keyCopies;
      },
    );
    getJestSpyOn(ApiKeyPermissionService, "deleteBy").mockImplementation(
      async (deleteBy: DeleteBy<ApiKeyPermission>): Promise<number> => {
        writes.push("delete");
        deletedQueries.push(deleteBy);
        return 1;
      },
    );
    getJestSpyOn(ApiKeyPermissionService, "create").mockImplementation(
      async (
        createBy: CreateBy<ApiKeyPermission>,
      ): Promise<ApiKeyPermission> => {
        writes.push("create");
        created.push(createBy.data);
        expect(createBy.props).toEqual({ isRoot: true, ignoreHooks: true });
        return createBy.data;
      },
    );
    getJestSpyOn(
      ApiKeyPermissionService,
      "forgetPermissionsOfProjects",
    ).mockImplementation(
      async (
        projectIds: Array<ObjectID | string | undefined | null>,
      ): Promise<void> => {
        writes.push(
          `forget:${projectIds
            .map((projectId: ObjectID | string | undefined | null) => {
              return String(projectId);
            })
            .join(",")}`,
        );
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("makes a copy of each permission a key can hold on every key given the role, as OneUptime, with the role's marks and labels", async () => {
    await CustomRoleSync.syncRoles({
      projectId: PROJECT,
      customRoleIds: [ROLE],
    });

    // Monitor Viewer reaches both keys; Alert Member, limited to what is owned, neither.
    expect(created).toHaveLength(2);

    for (const [copy, apiKeyId, givenId] of [
      [created[0]!, KEY_A, GIVEN_A],
      [created[1]!, KEY_B, GIVEN_B],
    ] as Array<[ApiKeyPermission, ObjectID, ObjectID]>) {
      expect(copy.projectId?.toString()).toBe(PROJECT.toString());
      expect(copy.apiKeyId?.toString()).toBe(apiKeyId.toString());
      expect(copy.permission).toBe(Permission.MonitorViewer);
      expect(copy.isBlockPermission).toBe(false);
      expect(
        (copy.labels || []).map((label: Label): string => {
          return label.id!.toString();
        }),
      ).toEqual([LABEL.toString()]);
      expect(copy.customRoleId?.toString()).toBe(ROLE.toString());
      expect(copy.apiKeyCustomRoleId?.toString()).toBe(givenId.toString());
      expect(copy.customRolePermissionId?.toString()).toBe(
        LABELLED_ROW.toString(),
      );
    }

    expect(
      created.some((copy: ApiKeyPermission): boolean => {
        return copy.permission === Permission.AlertMember;
      }),
    ).toBe(false);

    // Every server forgets the keys' cached permissions once the copies are in.
    expect(writes).toEqual(["create", "create", `forget:${PROJECT}`]);
  });

  test("deletes what no longer matches, and has every server forget it, before it creates anything", async () => {
    const stale: ApiKeyPermission = new ApiKeyPermission(
      new ObjectID("2a000000-0000-4000-8000-000000000001"),
    );
    stale.apiKeyId = KEY_A;
    stale.customRoleId = ROLE;
    stale.apiKeyCustomRoleId = GIVEN_A;
    stale.customRolePermissionId = LABELLED_ROW;
    stale.permission = Permission.MonitorAdmin;
    stale.labels = [];
    keyCopies = [stale];

    await CustomRoleSync.syncRoles({
      projectId: PROJECT,
      customRoleIds: [ROLE],
    });

    expect(writes).toEqual([
      "delete",
      `forget:${PROJECT}`,
      "create",
      "create",
      `forget:${PROJECT}`,
    ]);
    expect(deletedQueries[0]!.props).toEqual({
      isRoot: true,
      ignoreHooks: true,
    });
    expect(String(deletedQueries[0]!.query.projectId)).toBe(PROJECT.toString());
    expect(JSON.stringify(deletedQueries[0]!.query._id)).toContain(
      stale.id!.toString(),
    );
  });

  test("a copy of a permission the role now limits to what is owned is taken from the key, and nothing is made in its place", async () => {
    const madeBefore: ApiKeyPermission = new ApiKeyPermission(
      new ObjectID("2b000000-0000-4000-8000-000000000001"),
    );
    madeBefore.apiKeyId = KEY_A;
    madeBefore.customRoleId = ROLE;
    madeBefore.apiKeyCustomRoleId = GIVEN_A;
    madeBefore.customRolePermissionId = OWNED_ROW;
    madeBefore.permission = Permission.AlertMember;
    madeBefore.labels = [];

    const right: ApiKeyPermission = new ApiKeyPermission(
      new ObjectID("2b000000-0000-4000-8000-000000000002"),
    );
    right.apiKeyId = KEY_A;
    right.customRoleId = ROLE;
    right.apiKeyCustomRoleId = GIVEN_A;
    right.customRolePermissionId = LABELLED_ROW;
    right.permission = Permission.MonitorViewer;
    right.labels = [new Label(LABEL)];

    givenToKeys = [givenTo(GIVEN_A, KEY_A)];
    keyCopies = [madeBefore, right];

    await CustomRoleSync.syncRoles({
      projectId: PROJECT,
      customRoleIds: [ROLE],
    });

    expect(writes).toEqual(["delete", `forget:${PROJECT}`]);
    expect(JSON.stringify(deletedQueries[0]!.query._id)).toContain(
      madeBefore.id!.toString(),
    );
    expect(JSON.stringify(deletedQueries[0]!.query._id)).not.toContain(
      right.id!.toString(),
    );
  });

  test("changes nothing, and has no server forget anything, when the copies are right", async () => {
    await CustomRoleSync.syncRoles({
      projectId: PROJECT,
      customRoleIds: [ROLE],
    });
    keyCopies = created.map((copy: ApiKeyPermission, index: number) => {
      copy.id = new ObjectID(`3a000000-0000-4000-8000-00000000000${index}`);
      return copy;
    });
    writes = [];

    await CustomRoleSync.syncRoles({
      projectId: PROJECT,
      customRoleIds: [ROLE],
    });

    expect(writes).toEqual([]);
  });

  test("a role taken from a key leaves its copies to the cascade: a sync of what is left deletes any copy that outlived it", async () => {
    const orphan: ApiKeyPermission = new ApiKeyPermission(
      new ObjectID("2c000000-0000-4000-8000-000000000001"),
    );
    orphan.apiKeyId = KEY_A;
    orphan.customRoleId = ROLE;
    orphan.apiKeyCustomRoleId = new ObjectID(
      "0d000000-0000-4000-8000-0000000000ff",
    );
    orphan.customRolePermissionId = LABELLED_ROW;
    orphan.permission = Permission.MonitorViewer;
    orphan.labels = [new Label(LABEL)];

    givenToKeys = [];
    keyCopies = [orphan];

    await CustomRoleSync.syncRoles({
      projectId: PROJECT,
      customRoleIds: [ROLE],
    });

    expect(writes).toEqual(["delete", `forget:${PROJECT}`]);
  });

  test("returns the teams it changed, never the keys: the keys' permissions are forgotten, not rebuilt", async () => {
    const changed: Array<ObjectID> = await CustomRoleSync.syncRoles({
      projectId: PROJECT,
      customRoleIds: [ROLE],
    });

    expect(changed).toEqual([]);
    expect(
      AccessTokenService.refreshUserTenantAccessPermission,
    ).not.toHaveBeenCalled();
  });

  test("runs the keys' half inside the project's lock, and gives it back when it fails", async () => {
    getJestSpyOn(ApiKeyPermissionService, "create").mockRejectedValue(
      new Error("database went away"),
    );

    await expect(
      CustomRoleSync.syncRoles({ projectId: PROJECT, customRoleIds: [ROLE] }),
    ).rejects.toThrow("database went away");

    const label: string = `${CustomRoleSync.LOCK_NAMESPACE}/${PROJECT.toString()}`;
    expect(locks.events).toEqual([`lock:${label}`, `release:${label}`]);
    expect(
      locks.isHeld(PROJECT.toString(), CustomRoleSync.LOCK_NAMESPACE),
    ).toBe(false);
  });

  test("reconcileApiKeys reads the role's permissions only when a key has the role or a copy of it", async () => {
    givenToKeys = [];
    keyCopies = [];

    const changed: Array<ObjectID> = await CustomRoleSync.reconcileApiKeys({
      projectId: PROJECT,
      customRoleIds: [ROLE],
    });

    expect(changed).toEqual([]);
    expect(CustomRolePermissionService.findAllBy).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  test("reconcileApiKeys says which keys it changed, each once", async () => {
    const changed: Array<ObjectID> = await CustomRoleSync.reconcileApiKeys({
      projectId: PROJECT,
      customRoleIds: [ROLE, ROLE],
    });

    expect(
      changed.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([KEY_A.toString(), KEY_B.toString()]);
  });

  test("removes the copies of the role permissions about to change from every key too, and has every server forget them", async () => {
    const first: ApiKeyPermission = new ApiKeyPermission(
      new ObjectID("4a000000-0000-4000-8000-000000000001"),
    );
    first.apiKeyId = KEY_A;
    const second: ApiKeyPermission = new ApiKeyPermission(
      new ObjectID("4a000000-0000-4000-8000-000000000002"),
    );
    second.apiKeyId = KEY_B;
    keyCopies = [first, second];

    const teams: Array<ObjectID> =
      await CustomRoleSync.removeCopiesOfRolePermissions({
        projectId: PROJECT,
        customRolePermissionIds: [LABELLED_ROW],
      });

    // No team had a copy; the keys' went, and every server forgets them.
    expect(teams).toEqual([]);
    expect(writes).toEqual(["delete", `forget:${PROJECT}`]);
    expect(JSON.stringify(deletedQueries[0]!.query._id)).toContain(
      first.id!.toString(),
    );
    expect(JSON.stringify(deletedQueries[0]!.query._id)).toContain(
      second.id!.toString(),
    );
    expect(deletedQueries[0]!.props).toEqual({
      isRoot: true,
      ignoreHooks: true,
    });
  });

  test("removing the copies of role permissions no key holds forgets nothing", async () => {
    keyCopies = [];

    await CustomRoleSync.removeCopiesOfRolePermissions({
      projectId: PROJECT,
      customRolePermissionIds: [LABELLED_ROW],
    });

    expect(writes).toEqual([]);
  });
});
