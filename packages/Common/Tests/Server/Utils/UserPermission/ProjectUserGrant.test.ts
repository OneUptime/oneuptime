import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Permission.ProjectUser is what "is a member of this project" means. Nothing
 * stores it — no TeamPermission row carries it — so it has to be added to a
 * member's permission set as their session is resolved. Before this it was
 * declared in the catalogue, referenced by a handful of models, and granted
 * nowhere, which made every read list mentioning it a dead branch.
 *
 * Three things have to hold, and each has bitten a permission system before:
 *   - a member gets it, exactly once, unrestricted;
 *   - a snapshot cached before the grant existed still comes back with it (the
 *     entry lives for 30 days unless a membership change rewrites it, so a
 *     signed-in user would otherwise stay locked out for weeks after deploy);
 *   - a caller who is only *part way* into the project — the SSO-required,
 *     SSO-not-satisfied path — does not get it.
 *
 * GlobalCache is mocked at the module boundary: the real one opens Redis.
 */

const mockGetJSONObject: jest.Mock = jest.fn();
const mockSetJSON: jest.Mock = jest.fn();

jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getJSONObject: (...args: Array<unknown>) => {
        return mockGetJSONObject(...args);
      },
      setJSON: (...args: Array<unknown>) => {
        return mockSetJSON(...args);
      },
    },
  };
});

import UserPermissionUtil from "../../../../Server/Utils/UserPermission/UserPermission";

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

type MakePermissionFunction = (
  permissions: Array<Permission>,
) => UserTenantAccessPermission;

const makePermission: MakePermissionFunction = (
  permissions: Array<Permission>,
): UserTenantAccessPermission => {
  return {
    projectId,
    isBlockPermission: false,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        permission,
        labelIds: [],
        isBlockPermission: false,
        _type: "UserPermission",
      };
    }),
  };
};

type PermissionNamesFunction = (
  permission: UserTenantAccessPermission,
) => Array<Permission>;

const permissionNames: PermissionNamesFunction = (
  permission: UserTenantAccessPermission,
): Array<Permission> => {
  return permission.permissions.map((row: UserPermission) => {
    return row.permission;
  });
};

describe("UserPermissionUtil.withProjectUserPermission", () => {
  test("adds ProjectUser to a member whose teams grant only a domain role", () => {
    const permission: UserTenantAccessPermission =
      UserPermissionUtil.withProjectUserPermission(
        makePermission([Permission.MonitorViewer]),
      );

    expect(permissionNames(permission)).toEqual([
      Permission.MonitorViewer,
      Permission.ProjectUser,
    ]);
  });

  /*
   * Unrestricted, because a label-scoped row would make the shared models
   * label-filtered — and none of them carry labels, so the filter would match
   * nothing and the saved views would silently come back empty.
   */
  test("the added row is unrestricted and is not a block", () => {
    const permission: UserTenantAccessPermission =
      UserPermissionUtil.withProjectUserPermission(makePermission([]));

    const row: UserPermission | undefined = permission.permissions.find(
      (candidate: UserPermission) => {
        return candidate.permission === Permission.ProjectUser;
      },
    );

    expect(row).toBeDefined();
    expect(row?.labelIds).toEqual([]);
    expect(row?.isBlockPermission).toBe(false);
    expect(row?._type).toBe("UserPermission");
  });

  test("is idempotent - refresh then cache read must not stack duplicates", () => {
    let permission: UserTenantAccessPermission = makePermission([
      Permission.MonitorViewer,
    ]);

    permission = UserPermissionUtil.withProjectUserPermission(permission);
    permission = UserPermissionUtil.withProjectUserPermission(permission);
    permission = UserPermissionUtil.withProjectUserPermission(permission);

    expect(
      permissionNames(permission).filter((name: Permission) => {
        return name === Permission.ProjectUser;
      }),
    ).toHaveLength(1);
  });

  /*
   * The snapshot handed in may have come straight out of the cache and be
   * shared with whatever else is holding it. Appending in place would grow that
   * array by one row on every read of the same object.
   */
  test("does not mutate the permission set it was given", () => {
    const original: UserTenantAccessPermission = makePermission([
      Permission.MonitorViewer,
    ]);

    const permission: UserTenantAccessPermission =
      UserPermissionUtil.withProjectUserPermission(original);

    expect(permissionNames(original)).toEqual([Permission.MonitorViewer]);
    expect(permissionNames(permission)).toEqual([
      Permission.MonitorViewer,
      Permission.ProjectUser,
    ]);
  });

  test("leaves an administrator's existing rows exactly as they were", () => {
    const original: UserTenantAccessPermission = makePermission([
      Permission.ProjectAdmin,
      Permission.CreateProjectMonitor,
    ]);
    const labelId: ObjectID = ObjectID.generate();
    original.permissions[0]!.labelIds = [labelId];

    const permission: UserTenantAccessPermission =
      UserPermissionUtil.withProjectUserPermission(original);

    expect(permission.permissions[0]!.permission).toBe(Permission.ProjectAdmin);
    expect(permission.permissions[0]!.labelIds).toEqual([labelId]);
    expect(permission.permissions[1]!.permission).toBe(
      Permission.CreateProjectMonitor,
    );
  });

  /*
   * A team can block a permission for its members. Nothing blocks ProjectUser
   * today, but if a row for it is already present the helper must leave that
   * row alone rather than add a second, granting one.
   */
  test("does not override an existing ProjectUser row", () => {
    const original: UserTenantAccessPermission = makePermission([
      Permission.ProjectUser,
    ]);
    original.permissions[0]!.isBlockPermission = true;

    const permission: UserTenantAccessPermission =
      UserPermissionUtil.withProjectUserPermission(original);

    expect(permission.permissions).toHaveLength(1);
    expect(permission.permissions[0]!.isBlockPermission).toBe(true);
  });
});

describe("UserPermissionUtil.getDefaultUserTenantAccessPermission", () => {
  /*
   * This is also the permission set UserAuthorization hands a user who owes the
   * project an SSO login. They are on the roster but have not proved who they
   * are for this project yet, so they are not a project user.
   */
  test("does not grant ProjectUser", () => {
    const permission: UserTenantAccessPermission =
      UserPermissionUtil.getDefaultUserTenantAccessPermission(projectId);

    expect(permissionNames(permission)).toEqual([
      Permission.CurrentUser,
      Permission.UnAuthorizedSsoUser,
    ]);
  });
});

describe("UserPermissionUtil.getUserTenantAccessPermissionFromCache", () => {
  beforeEach(() => {
    mockGetJSONObject.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("adds ProjectUser to a snapshot written before the grant existed", async () => {
    mockGetJSONObject.mockResolvedValue(
      makePermission([Permission.MonitorViewer]) as never,
    );

    const permission: UserTenantAccessPermission | null =
      await UserPermissionUtil.getUserTenantAccessPermissionFromCache(
        userId,
        projectId,
      );

    expect(permission).not.toBeNull();
    expect(permissionNames(permission!)).toContain(Permission.ProjectUser);
    expect(permission!._type).toBe("UserTenantAccessPermission");
  });

  test("does not duplicate the row on a snapshot that already has it", async () => {
    mockGetJSONObject.mockResolvedValue(
      makePermission([
        Permission.MonitorViewer,
        Permission.ProjectUser,
      ]) as never,
    );

    const permission: UserTenantAccessPermission | null =
      await UserPermissionUtil.getUserTenantAccessPermissionFromCache(
        userId,
        projectId,
      );

    expect(
      permissionNames(permission!).filter((name: Permission) => {
        return name === Permission.ProjectUser;
      }),
    ).toHaveLength(1);
  });

  /*
   * A cache miss must stay a miss. Returning a permission set carrying only
   * ProjectUser would turn "this user is not in the project" into "this user is
   * a member with no roles".
   */
  test("a cache miss is still a miss", async () => {
    mockGetJSONObject.mockResolvedValue(null as never);

    expect(
      await UserPermissionUtil.getUserTenantAccessPermissionFromCache(
        userId,
        projectId,
      ),
    ).toBeNull();
  });

  test("survives a stored snapshot with no permissions array", async () => {
    mockGetJSONObject.mockResolvedValue({ projectId } as never);

    const permission: UserTenantAccessPermission | null =
      await UserPermissionUtil.getUserTenantAccessPermissionFromCache(
        userId,
        projectId,
      );

    expect(permissionNames(permission!)).toEqual([Permission.ProjectUser]);
  });

  test("reads the delimited cache key, not a concatenation", async () => {
    mockGetJSONObject.mockResolvedValue(null as never);

    await UserPermissionUtil.getUserTenantAccessPermissionFromCache(
      userId,
      projectId,
    );

    expect(mockGetJSONObject).toHaveBeenCalledWith(
      "project-permissions",
      `${userId.toString()}:${projectId.toString()}`,
    );
  });
});
