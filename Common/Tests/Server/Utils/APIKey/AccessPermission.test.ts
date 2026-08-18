import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under ts-jest
 * (Buffer vs BinaryLike) that breaks every suite whose import graph reaches
 * it. Nothing here touches password hashing; stub the module before the
 * service import graph drags it into compilation.
 */
jest.mock("../../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import APIKeyAccessPermission from "../../../../Server/Utils/APIKey/AccessPermission";
import ApiKeyPermissionService, {
  ApiKeyPermissionRow,
} from "../../../../Server/Services/ApiKeyPermissionService";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { getJestSpyOn } from "../../../Spy";

/*
 * This class turns an API key into the permission set a request runs under, so
 * every method here is a privilege-granting decision. The security invariant
 * that must hold across all of them: a *default* (ordinary) API key is never
 * silently handed ProjectOwner, while a *master* key deliberately is. A
 * regression that leaks ProjectOwner into the default path would give every API
 * key full control of the project; one that dropped it from the master path
 * would break trusted internal automation. Both directions are pinned below.
 *
 * getApiTenantAccessPermission also reshapes the (cached) permission rows into
 * the runtime UserPermission shape (labelIds carried over, block flag
 * preserved). That mapping is where a dropped label would quietly widen a
 * scoped permission, so it is tested against a spied service rather than a
 * live database.
 */

const projectId: ObjectID = ObjectID.generate();
const apiKeyId: ObjectID = ObjectID.generate();

const permissionValues: (
  permissions: Array<UserPermission>,
) => Array<Permission> = (
  permissions: Array<UserPermission>,
): Array<Permission> => {
  return permissions.map((p: UserPermission) => {
    return p.permission;
  });
};

describe("APIKeyAccessPermission.getDefaultApiGlobalPermission", () => {
  it("grants Public, User and CurrentUser for the project", async () => {
    const perm: UserGlobalAccessPermission =
      await APIKeyAccessPermission.getDefaultApiGlobalPermission(projectId);

    expect(perm._type).toBe("UserGlobalAccessPermission");
    expect(
      perm.projectIds.map((p: ObjectID) => {
        return p.toString();
      }),
    ).toEqual([projectId.toString()]);
    expect(perm.globalPermissions).toEqual([
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
    ]);
  });

  it("does NOT grant ProjectOwner to an ordinary key", async () => {
    // The core boundary: a default key must never be an owner.
    const perm: UserGlobalAccessPermission =
      await APIKeyAccessPermission.getDefaultApiGlobalPermission(projectId);
    expect(perm.globalPermissions).not.toContain(Permission.ProjectOwner);
  });
});

describe("APIKeyAccessPermission.getMasterKeyApiGlobalPermission", () => {
  it("grants everything the default key has, plus ProjectOwner", async () => {
    const master: UserGlobalAccessPermission =
      await APIKeyAccessPermission.getMasterKeyApiGlobalPermission(projectId);
    const def: UserGlobalAccessPermission =
      await APIKeyAccessPermission.getDefaultApiGlobalPermission(projectId);

    // Superset: no default grant is lost when elevating to master.
    for (const p of def.globalPermissions) {
      expect(master.globalPermissions).toContain(p);
    }
    // The one deliberate elevation.
    expect(master.globalPermissions).toContain(Permission.ProjectOwner);
  });

  it("scopes to exactly the one project", async () => {
    const master: UserGlobalAccessPermission =
      await APIKeyAccessPermission.getMasterKeyApiGlobalPermission(projectId);
    expect(
      master.projectIds.map((p: ObjectID) => {
        return p.toString();
      }),
    ).toEqual([projectId.toString()]);
  });
});

describe("APIKeyAccessPermission.getMasterApiTenantAccessPermission", () => {
  it("elevates the default tenant permission with ProjectOwner", async () => {
    const perm: UserTenantAccessPermission =
      await APIKeyAccessPermission.getMasterApiTenantAccessPermission(
        projectId,
      );

    expect(perm._type).toBe("UserTenantAccessPermission");
    expect(perm.projectId.toString()).toBe(projectId.toString());
    expect(permissionValues(perm.permissions)).toContain(
      Permission.ProjectOwner,
    );
    // The default tenant baseline is retained alongside the elevation.
    expect(permissionValues(perm.permissions)).toContain(
      Permission.CurrentUser,
    );
  });
});

describe("APIKeyAccessPermission.getApiTenantAccessPermission", () => {
  const spyFindPermissions: jest.SpyInstance = getJestSpyOn(
    ApiKeyPermissionService,
    "findPermissionsByApiKeyId",
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  const makeRow: (data: {
    permission: Permission;
    labelIds?: Array<ObjectID>;
    isBlockPermission?: boolean;
  }) => ApiKeyPermissionRow = (data: {
    permission: Permission;
    labelIds?: Array<ObjectID>;
    isBlockPermission?: boolean;
  }): ApiKeyPermissionRow => {
    return {
      permission: data.permission,
      labelIds: data.labelIds ?? [],
      isBlockPermission: data.isBlockPermission ?? false,
    };
  };

  it("queries the permissions for exactly this api key", async () => {
    spyFindPermissions.mockResolvedValue([] as never);

    await APIKeyAccessPermission.getApiTenantAccessPermission(
      projectId,
      apiKeyId,
    );

    expect(spyFindPermissions).toHaveBeenCalledTimes(1);
    const arg: ObjectID = spyFindPermissions.mock.calls[0]![0] as ObjectID;
    expect(arg.toString()).toBe(apiKeyId.toString());
  });

  it("returns just the default baseline when the key has no permissions", async () => {
    spyFindPermissions.mockResolvedValue([] as never);

    const perm: UserTenantAccessPermission =
      await APIKeyAccessPermission.getApiTenantAccessPermission(
        projectId,
        apiKeyId,
      );

    // No stored rows -> no ProjectOwner. An empty key is not an owner.
    expect(permissionValues(perm.permissions)).not.toContain(
      Permission.ProjectOwner,
    );
    expect(permissionValues(perm.permissions)).toContain(
      Permission.CurrentUser,
    );
  });

  it("maps each stored permission row onto the tenant permission", async () => {
    const labelId: ObjectID = ObjectID.generate();
    spyFindPermissions.mockResolvedValue([
      makeRow({
        permission: Permission.CreateProjectIncident,
        labelIds: [labelId],
        isBlockPermission: false,
      }),
    ] as never);

    const perm: UserTenantAccessPermission =
      await APIKeyAccessPermission.getApiTenantAccessPermission(
        projectId,
        apiKeyId,
      );

    const mapped: UserPermission | undefined = perm.permissions.find(
      (p: UserPermission) => {
        return p.permission === Permission.CreateProjectIncident;
      },
    );
    expect(mapped).toBeDefined();
    /*
     * The label scope must survive the mapping, or the permission silently
     * widens from "these labels" to "all".
     */
    expect(
      mapped!.labelIds.map((l: ObjectID) => {
        return l.toString();
      }),
    ).toEqual([labelId.toString()]);
  });

  it("preserves the block flag so a deny row stays a deny row", async () => {
    spyFindPermissions.mockResolvedValue([
      makeRow({
        permission: Permission.CreateProjectIncident,
        labelIds: [],
        isBlockPermission: true,
      }),
    ] as never);

    const perm: UserTenantAccessPermission =
      await APIKeyAccessPermission.getApiTenantAccessPermission(
        projectId,
        apiKeyId,
      );

    const mapped: UserPermission | undefined = perm.permissions.find(
      (p: UserPermission) => {
        return p.permission === Permission.CreateProjectIncident;
      },
    );
    // Flipping a block permission to an allow would invert an admin's intent.
    expect(mapped!.isBlockPermission).toBe(true);
  });

  it("treats a row with no labels as an empty (unscoped) label set", async () => {
    /*
     * The service DTO normalizes a stored row's undefined labels to [] (pinned
     * in ApiKeyPermissionService.test.ts); here the mapping must keep that
     * empty set an array rather than dropping it to undefined.
     */
    spyFindPermissions.mockResolvedValue([
      makeRow({
        permission: Permission.CreateProjectIncident,
      }),
    ] as never);

    const perm: UserTenantAccessPermission =
      await APIKeyAccessPermission.getApiTenantAccessPermission(
        projectId,
        apiKeyId,
      );

    const mapped: UserPermission | undefined = perm.permissions.find(
      (p: UserPermission) => {
        return p.permission === Permission.CreateProjectIncident;
      },
    );
    expect(mapped).toBeDefined();
    expect(mapped!.labelIds).toEqual([]);
  });
});
