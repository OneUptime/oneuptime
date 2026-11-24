import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../../Models/DatabaseModels/TeamPermission";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A MIGRATION THAT CHANGES PERMISSION ROWS MAKES EVERY SERVER READ MEMBERS'
 * PERMISSION SETS AGAIN (#8373).
 *
 * A member's set in a project is cached in Redis for up to 30 days, and a
 * schema migration deletes rows straight from Postgres: nothing used to
 * rebuild the sets of the teams it changed, so a member whose team held a
 * row it took away kept it in their cached set - until a change to one of
 * their teams, their memberships or a sign-in, or for 30 days.
 *
 * Every set is now cached with the version of the permission rows it was
 * built from (PERMISSION_ROWS_VERSION, the number of the newest migration in
 * PERMISSION_ROW_MIGRATIONS), and one cached with an older version, or with
 * none, is read as missing - and deleted - so it is rebuilt from the rows as
 * they are. Here: what is cached, what is served, and the issue's own check -
 * a team's row, a member who signs in, the row deleted as the migration
 * deletes it, and the member's next request.
 *
 * Redis and Postgres are replaced at the module boundary by a key-value
 * store and membership and permission tables in memory. The store keeps
 * values as GlobalCache does (JSONFunctions.serialize, then text), so what is
 * read back made the same round trip as in Redis; the real-Valkey suite
 * (PermissionRowsVersionValkey) reads the same through Redis itself.
 * AccessTokenService and UserPermissionUtil are real.
 */

interface Membership {
  userId: ObjectID;
  projectId: ObjectID;
  teamId: ObjectID;
}

interface Row {
  teamId: ObjectID;
  projectId: ObjectID;
  permission: Permission;
}

const mockMemberships: Array<Membership> = [];
const mockRows: Array<Row> = [];
const mockStore: Map<string, string> = new Map<string, string>();
const mockDeletes: Array<string> = [];
const mockSets: Array<string> = [];
const mockDatabaseReads: Array<string> = [];
// When set, a delete fails as a dropped connection does.
let mockDeleteFails: boolean = false;

function mockKeyOf(namespace: string, key: string): string {
  return `${namespace}-${key}`;
}

function mockRead(namespace: string, key: string): JSONObject | null {
  const raw: string | undefined = mockStore.get(mockKeyOf(namespace, key));

  return raw
    ? JSONFunctions.deserialize(JSONFunctions.parse(raw) as JSONObject)
    : null;
}

// The values a query column asks for: a plain value, or QueryHelper.any's.
function mockValuesOf(queryValue: unknown): Array<string> | null {
  if (queryValue === undefined) {
    return null;
  }

  const parameters: Record<string, unknown> | undefined = (
    queryValue as { objectLiteralParameters?: Record<string, unknown> }
  )?.objectLiteralParameters;

  const values: Array<unknown> = parameters
    ? (Object.values(parameters).find((parameter: unknown) => {
        return Array.isArray(parameter);
      }) as Array<unknown> | undefined) || []
    : [queryValue];

  return values.map((value: unknown) => {
    return String(value).toLowerCase();
  });
}

function mockAsks(asked: Array<string> | null, value: ObjectID): boolean {
  return asked === null || asked.includes(value.toString().toLowerCase());
}

jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getJSONObject: async (
        namespace: string,
        key: string,
      ): Promise<JSONObject | null> => {
        return mockRead(namespace, key);
      },
      getJSONObjects: async (
        namespace: string,
        keys: Array<string>,
      ): Promise<Array<JSONObject | null>> => {
        return keys.map((key: string): JSONObject | null => {
          return mockRead(namespace, key);
        });
      },
      setJSON: async (
        namespace: string,
        key: string,
        value: JSONObject,
      ): Promise<void> => {
        mockSets.push(mockKeyOf(namespace, key));
        mockStore.set(
          mockKeyOf(namespace, key),
          JSON.stringify(JSONFunctions.serialize(value)),
        );
      },
      deleteKey: async (namespace: string, key: string): Promise<void> => {
        if (mockDeleteFails) {
          throw new Error("Connection is closed.");
        }

        mockDeletes.push(mockKeyOf(namespace, key));
        mockStore.delete(mockKeyOf(namespace, key));
      },
    },
  };
});

jest.mock("../../../../Server/Services/TeamMemberService", () => {
  const find: (data: {
    query: Record<string, unknown>;
  }) => Promise<Array<TeamMember>> = async (data: {
    query: Record<string, unknown>;
  }): Promise<Array<TeamMember>> => {
    mockDatabaseReads.push("TeamMember");
    const users: Array<string> | null = mockValuesOf(data.query["userId"]);
    const projects: Array<string> | null = mockValuesOf(
      data.query["projectId"],
    );

    return mockMemberships
      .filter((membership: Membership): boolean => {
        return (
          mockAsks(users, membership.userId) &&
          mockAsks(projects, membership.projectId)
        );
      })
      .map((membership: Membership): TeamMember => {
        const member: TeamMember = new TeamMember();
        member.userId = membership.userId;
        member.projectId = membership.projectId;
        member.teamId = membership.teamId;
        member.hasAcceptedInvitation = true;
        return member;
      });
  };

  return { __esModule: true, default: { findBy: find, findAllBy: find } };
});

jest.mock("../../../../Server/Services/TeamPermissionService", () => {
  const find: (data: {
    query: Record<string, unknown>;
  }) => Promise<Array<TeamPermission>> = async (data: {
    query: Record<string, unknown>;
  }): Promise<Array<TeamPermission>> => {
    mockDatabaseReads.push("TeamPermission");
    const teams: Array<string> | null = mockValuesOf(data.query["teamId"]);
    const projects: Array<string> | null = mockValuesOf(
      data.query["projectId"],
    );

    return mockRows
      .filter((row: Row): boolean => {
        return mockAsks(teams, row.teamId) && mockAsks(projects, row.projectId);
      })
      .map((row: Row): TeamPermission => {
        const permission: TeamPermission = new TeamPermission();
        permission.teamId = row.teamId;
        permission.projectId = row.projectId;
        permission.permission = row.permission;
        permission.isBlockPermission = false;
        permission.labels = [];
        return permission;
      });
  };

  return { __esModule: true, default: { findBy: find, findAllBy: find } };
});

jest.mock("../../../../Server/Utils/Realtime/RealtimeAccessChanges", () => {
  return {
    __esModule: true,
    RealtimeAccessChangeKind: { PermissionsChanged: "PermissionsChanged" },
    default: { announce: (): void => {} },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: (): void => {},
      info: (): void => {},
      warn: (): void => {},
      error: (): void => {},
    },
  };
});

import {
  PERMISSION_ROW_MIGRATIONS,
  PERMISSION_ROWS_VERSION,
  getMigrationNumber,
} from "../../../../Server/Infrastructure/Postgres/PermissionRowMigrations";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import UserPermissionUtil, {
  PERMISSION_ROWS_VERSION_FIELD,
} from "../../../../Server/Utils/UserPermission/UserPermission";

const MEMBER: ObjectID = new ObjectID("b8000000-0000-4000-8000-000000000001");
const PROJECT: ObjectID = new ObjectID("b8000000-0000-4000-8000-0000000000a1");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "b8000000-0000-4000-8000-0000000000a2",
);
const LEFT_PROJECT: ObjectID = new ObjectID(
  "b8000000-0000-4000-8000-0000000000a3",
);
const TEAM: ObjectID = new ObjectID("b8000000-0000-4000-8000-0000000000e1");
const OTHER_TEAM: ObjectID = new ObjectID(
  "b8000000-0000-4000-8000-0000000000e2",
);

// The version the migration before the newest one cached sets with.
const PREVIOUS_VERSION: number = getMigrationNumber(
  PERMISSION_ROW_MIGRATIONS[PERMISSION_ROW_MIGRATIONS.length - 2]!,
);

/*
 * The member's set once the migration took Edit Incident Feed away: their
 * team's other row, and what every member holds.
 */
const REBUILT_FROM_THE_ROWS: Array<Permission> = [
  Permission.CurrentUser,
  Permission.UnAuthorizedSsoUser,
  Permission.ProjectUser,
  Permission.ReadProjectIncident,
].sort();

function tenantStoreKey(userId: ObjectID, projectId: ObjectID): string {
  return mockKeyOf(
    "project-permissions",
    UserPermissionUtil.buildTenantPermissionCacheKey(userId, projectId),
  );
}

function rowOf(permission: Permission, teamId: ObjectID): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    isBlockPermission: false,
    teamId,
  };
}

function setOf(
  projectId: ObjectID,
  permissions: Array<Permission>,
  teamId: ObjectID = TEAM,
): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId,
    isBlockPermission: false,
    permissions: permissions.map((permission: Permission) => {
      return rowOf(permission, teamId);
    }),
  };
}

// A set as a server cached it: with `version`, or with none (before this).
function seedCached(data: {
  projectId: ObjectID;
  permissions: Array<Permission>;
  version?: unknown;
}): void {
  const set: JSONObject = { ...setOf(data.projectId, data.permissions) };

  if (data.version !== undefined) {
    set[PERMISSION_ROWS_VERSION_FIELD] = data.version as number;
  }

  mockStore.set(
    tenantStoreKey(MEMBER, data.projectId),
    JSON.stringify(JSONFunctions.serialize(set)),
  );
}

function namesOf(
  permission: UserTenantAccessPermission | null | undefined,
): Array<Permission> {
  return (permission?.permissions || [])
    .map((row: UserPermission): Permission => {
      return row.permission;
    })
    .sort();
}

function cachedVersionOf(projectId: ObjectID): unknown {
  return mockRead(
    "project-permissions",
    UserPermissionUtil.buildTenantPermissionCacheKey(MEMBER, projectId),
  )?.[PERMISSION_ROWS_VERSION_FIELD];
}

function grant(permission: Permission, teamId: ObjectID = TEAM): void {
  mockRows.push({
    teamId,
    projectId: teamId === OTHER_TEAM ? OTHER_PROJECT : PROJECT,
    permission,
  });
}

// What a migration does: a DELETE straight from the table, and nothing else.
function deleteRowsAsAMigrationDoes(permission: Permission): void {
  for (let i: number = mockRows.length - 1; i >= 0; i--) {
    if (mockRows[i]!.permission === permission) {
      mockRows.splice(i, 1);
    }
  }
}

beforeEach(() => {
  mockMemberships.length = 0;
  mockRows.length = 0;
  mockStore.clear();
  mockDeletes.length = 0;
  mockSets.length = 0;
  mockDatabaseReads.length = 0;
  mockDeleteFails = false;
});

describe("what a member's cached set carries", () => {
  test("the version of the permission rows it was built from, beside the set itself", () => {
    const set: UserTenantAccessPermission = setOf(PROJECT, [
      Permission.ReadProjectIncident,
    ]);
    const cached: JSONObject =
      UserPermissionUtil.toCachedTenantAccessPermission(set);

    expect(cached).toEqual({
      ...set,
      [PERMISSION_ROWS_VERSION_FIELD]: PERMISSION_ROWS_VERSION,
    });
    // A copy: the set handed in is not changed.
    expect(set[PERMISSION_ROWS_VERSION_FIELD]).toBeUndefined();
  });

  test("the version is the number of the newest migration that changed permission rows", () => {
    expect(PERMISSION_ROWS_VERSION).toBe(
      getMigrationNumber(
        PERMISSION_ROW_MIGRATIONS[PERMISSION_ROW_MIGRATIONS.length - 1]!,
      ),
    );
    expect(PERMISSION_ROWS_VERSION).toBe(1809186970000);
    expect(PREVIOUS_VERSION).toBeLessThan(PERMISSION_ROWS_VERSION);
  });

  test("cacheUserTenantAccessPermission writes it under the member's key, in the project permissions", async () => {
    await UserPermissionUtil.cacheUserTenantAccessPermission(
      MEMBER,
      PROJECT,
      setOf(PROJECT, [Permission.ProjectMember]),
    );

    expect(mockSets).toEqual([tenantStoreKey(MEMBER, PROJECT)]);
    expect(cachedVersionOf(PROJECT)).toBe(PERMISSION_ROWS_VERSION);
    expect(
      namesOf(
        mockRead(
          "project-permissions",
          `${MEMBER.toString()}:${PROJECT.toString()}`,
        ) as UserTenantAccessPermission,
      ),
    ).toEqual([Permission.ProjectMember]);
  });
});

describe("which cached sets are served", () => {
  test.each([
    ["this release's version", PERMISSION_ROWS_VERSION, true],
    [
      "a newer release's version, cached while both run",
      PERMISSION_ROWS_VERSION + 100000,
      true,
    ],
    ["the version before the newest migration", PREVIOUS_VERSION, false],
    ["a version long ago", 1700000000000, false],
    ["no version: cached before sets carried one", undefined, false],
    ["a version written as text", String(PERMISSION_ROWS_VERSION), false],
    ["no number at all", Number.NaN, false],
    ["infinity", Number.POSITIVE_INFINITY, false],
    ["null", null, false],
    ["a negative number", -1, false],
    ["zero", 0, false],
  ])(
    "a set cached with %s (%s): served, %s",
    (_label: string, version: unknown, served: boolean) => {
      const cached: JSONObject = {
        ...setOf(PROJECT, [Permission.ReadProjectIncident]),
      };

      if (version !== undefined) {
        cached[PERMISSION_ROWS_VERSION_FIELD] = version as number;
      }

      expect(UserPermissionUtil.isCachedFromCurrentPermissionRows(cached)).toBe(
        served,
      );
    },
  );

  test("a current set is served as it was built, without the version, and with Project User", async () => {
    seedCached({
      projectId: PROJECT,
      permissions: [Permission.ReadProjectIncident],
      version: PERMISSION_ROWS_VERSION,
    });

    const served: UserTenantAccessPermission | null =
      await UserPermissionUtil.getUserTenantAccessPermissionFromCache(
        MEMBER,
        PROJECT,
      );

    expect(namesOf(served)).toEqual(
      [Permission.ReadProjectIncident, Permission.ProjectUser].sort(),
    );
    expect(served?.[PERMISSION_ROWS_VERSION_FIELD]).toBeUndefined();
    expect(served?._type).toBe("UserTenantAccessPermission");
    expect(mockDeletes).toEqual([]);
  });

  test.each([
    ["no version", undefined],
    ["the version before the newest migration", PREVIOUS_VERSION],
  ])(
    "a set cached with %s is read as missing, and deleted",
    async (_label: string, version: number | undefined) => {
      seedCached({
        projectId: PROJECT,
        permissions: [Permission.EditIncidentFeed],
        version,
      });

      expect(
        await UserPermissionUtil.getUserTenantAccessPermissionFromCache(
          MEMBER,
          PROJECT,
        ),
      ).toBeNull();
      expect(mockDeletes).toEqual([tenantStoreKey(MEMBER, PROJECT)]);
      expect(mockStore.has(tenantStoreKey(MEMBER, PROJECT))).toBe(false);
    },
  );

  test("a key that holds nothing is a miss, and costs no delete", async () => {
    expect(
      await UserPermissionUtil.getUserTenantAccessPermissionFromCache(
        MEMBER,
        PROJECT,
      ),
    ).toBeNull();
    expect(mockDeletes).toEqual([]);
  });

  test("a stale set the cache will not delete is still not served, and nothing throws", async () => {
    seedCached({ projectId: PROJECT, permissions: [Permission.ProjectOwner] });
    mockDeleteFails = true;

    expect(
      await UserPermissionUtil.getUserTenantAccessPermissionFromCache(
        MEMBER,
        PROJECT,
      ),
    ).toBeNull();
    expect(
      await UserPermissionUtil.getUserTenantAccessPermissionsFromCache(MEMBER, [
        PROJECT,
      ]),
    ).toEqual([null]);
  });

  test("several projects at once: each is read as one is, and only the stale ones are deleted", async () => {
    seedCached({
      projectId: PROJECT,
      permissions: [Permission.ReadProjectIncident],
      version: PERMISSION_ROWS_VERSION,
    });
    seedCached({
      projectId: OTHER_PROJECT,
      permissions: [Permission.EditIncidentFeed],
    });
    seedCached({
      projectId: LEFT_PROJECT,
      permissions: [Permission.ProjectOwner],
      version: PREVIOUS_VERSION,
    });
    const missing: ObjectID = ObjectID.generate();

    const sets: Array<UserTenantAccessPermission | null> =
      await UserPermissionUtil.getUserTenantAccessPermissionsFromCache(MEMBER, [
        PROJECT,
        OTHER_PROJECT,
        LEFT_PROJECT,
        missing,
      ]);

    expect(namesOf(sets[0])).toEqual(
      [Permission.ReadProjectIncident, Permission.ProjectUser].sort(),
    );
    expect(sets.slice(1)).toEqual([null, null, null]);
    expect(mockDeletes.sort()).toEqual(
      [
        tenantStoreKey(MEMBER, OTHER_PROJECT),
        tenantStoreKey(MEMBER, LEFT_PROJECT),
      ].sort(),
    );
  });

  test("several projects at once, none stale: nothing is deleted", async () => {
    seedCached({
      projectId: PROJECT,
      permissions: [Permission.ReadProjectIncident],
      version: PERMISSION_ROWS_VERSION,
    });

    await UserPermissionUtil.getUserTenantAccessPermissionsFromCache(MEMBER, [
      PROJECT,
      OTHER_PROJECT,
    ]);

    expect(mockDeletes).toEqual([]);
  });
});

/*
 * The issue's own check: a team's row, a member who signs in, the row
 * deleted as a migration deletes it (straight from the table: no hook, no
 * refresh), and the member's next request - before, it was served from the
 * set the sign-in cached, row included.
 */
describe("a member's next request after a migration took a row away", () => {
  beforeEach(() => {
    mockMemberships.push({ userId: MEMBER, projectId: PROJECT, teamId: TEAM });
    grant(Permission.ReadProjectIncident);
    grant(Permission.EditIncidentFeed);
  });

  test("every set a sign-in writes carries this release's version", async () => {
    mockMemberships.push({
      userId: MEMBER,
      projectId: OTHER_PROJECT,
      teamId: OTHER_TEAM,
    });
    grant(Permission.ReadProjectMonitor, OTHER_TEAM);

    await AccessTokenService.refreshUserAllPermissions(MEMBER);

    expect(cachedVersionOf(PROJECT)).toBe(PERMISSION_ROWS_VERSION);
    expect(cachedVersionOf(OTHER_PROJECT)).toBe(PERMISSION_ROWS_VERSION);
  });

  test("so does a set a change to the member's teams writes", async () => {
    await AccessTokenService.refreshUserTenantAccessPermission(MEMBER, PROJECT);

    expect(cachedVersionOf(PROJECT)).toBe(PERMISSION_ROWS_VERSION);
  });

  test("a set this release cached after the migration is served from the cache: it was built from the rows the migration left", async () => {
    deleteRowsAsAMigrationDoes(Permission.EditIncidentFeed);
    await AccessTokenService.refreshUserAllPermissions(MEMBER);
    mockDatabaseReads.length = 0;

    const served: UserTenantAccessPermission | null =
      await AccessTokenService.getUserTenantAccessPermission(MEMBER, PROJECT);

    expect(namesOf(served)).not.toContain(Permission.EditIncidentFeed);
    expect(namesOf(served)).toContain(Permission.ReadProjectIncident);
    expect(mockDatabaseReads).toEqual([]);
  });

  test.each([
    ["by the release before sets carried a version", undefined],
    ["by the release of the migration before the newest", "previous" as const],
  ])(
    "a set cached %s, before the migration, is rebuilt without the row",
    async (_label: string, version: undefined | "previous") => {
      // Signed in before the migration: the set holds the row.
      seedCached({
        projectId: PROJECT,
        permissions: [
          Permission.ReadProjectIncident,
          Permission.EditIncidentFeed,
        ],
        version: version === "previous" ? PREVIOUS_VERSION : undefined,
      });
      await AccessTokenService.refreshUserGlobalAccessPermission(MEMBER);

      deleteRowsAsAMigrationDoes(Permission.EditIncidentFeed);

      const served: UserTenantAccessPermission | null =
        await AccessTokenService.getUserTenantAccessPermission(MEMBER, PROJECT);

      expect(namesOf(served)).toEqual(REBUILT_FROM_THE_ROWS);
      // Rebuilt from the rows, and cached again with this release's version.
      expect(mockDatabaseReads).toEqual(
        expect.arrayContaining(["TeamMember", "TeamPermission"]),
      );
      expect(cachedVersionOf(PROJECT)).toBe(PERMISSION_ROWS_VERSION);
      expect(
        namesOf(
          mockRead(
            "project-permissions",
            UserPermissionUtil.buildTenantPermissionCacheKey(MEMBER, PROJECT),
          ) as UserTenantAccessPermission,
        ),
      ).not.toContain(Permission.EditIncidentFeed);

      // And the next request is served from that set.
      mockDatabaseReads.length = 0;
      expect(
        namesOf(
          await AccessTokenService.getUserTenantAccessPermission(
            MEMBER,
            PROJECT,
          ),
        ),
      ).toEqual(REBUILT_FROM_THE_ROWS);
      expect(mockDatabaseReads).toEqual([]);
    },
  );

  /*
   * What the version is for: the cache cannot tell a set built before the
   * migration from one built after it but by the version it carries. So a
   * migration that changes permission rows must raise it - it is listed in
   * PERMISSION_ROW_MIGRATIONS, and PermissionRowMigrationsGuard fails until
   * it is.
   */
  test("a stale set cached with this release's version would be served, row included: so every migration that changes rows raises it", async () => {
    seedCached({
      projectId: PROJECT,
      permissions: [
        Permission.ReadProjectIncident,
        Permission.EditIncidentFeed,
      ],
      version: PERMISSION_ROWS_VERSION,
    });
    await AccessTokenService.refreshUserGlobalAccessPermission(MEMBER);
    deleteRowsAsAMigrationDoes(Permission.EditIncidentFeed);

    // Stamped as if cached after the migration, the stale set is trusted.
    expect(
      namesOf(
        await AccessTokenService.getUserTenantAccessPermission(MEMBER, PROJECT),
      ),
    ).toContain(Permission.EditIncidentFeed);
  });

  test("a set a newer release cached is served by this one as it is", async () => {
    seedCached({
      projectId: PROJECT,
      permissions: [Permission.ReadProjectIncident],
      version: PERMISSION_ROWS_VERSION + 100000,
    });
    await AccessTokenService.refreshUserGlobalAccessPermission(MEMBER);
    mockDatabaseReads.length = 0;

    expect(
      namesOf(
        await AccessTokenService.getUserTenantAccessPermission(MEMBER, PROJECT),
      ),
    ).toEqual([Permission.ReadProjectIncident, Permission.ProjectUser].sort());
    expect(mockDatabaseReads).toEqual([]);
  });

  test("a stale set of a project the member has left is not served, and goes", async () => {
    seedCached({
      projectId: LEFT_PROJECT,
      permissions: [Permission.ProjectOwner],
    });
    await AccessTokenService.refreshUserGlobalAccessPermission(MEMBER);

    expect(
      await AccessTokenService.getUserTenantAccessPermission(
        MEMBER,
        LEFT_PROJECT,
      ),
    ).toBeNull();
    expect(mockStore.has(tenantStoreKey(MEMBER, LEFT_PROJECT))).toBe(false);
    expect(mockSets).not.toContain(tenantStoreKey(MEMBER, LEFT_PROJECT));
  });

  test("several projects at once: the stale ones are rebuilt, a current one served, a left one refused", async () => {
    mockMemberships.push({
      userId: MEMBER,
      projectId: OTHER_PROJECT,
      teamId: OTHER_TEAM,
    });
    grant(Permission.ReadProjectMonitor, OTHER_TEAM);
    grant(Permission.EditMonitorFeed, OTHER_TEAM);
    await AccessTokenService.refreshUserGlobalAccessPermission(MEMBER);

    // OTHER_PROJECT cached by this release; PROJECT before the migration.
    seedCached({
      projectId: OTHER_PROJECT,
      permissions: [Permission.ReadProjectMonitor],
      version: PERMISSION_ROWS_VERSION,
    });
    seedCached({
      projectId: PROJECT,
      permissions: [
        Permission.ReadProjectIncident,
        Permission.EditIncidentFeed,
      ],
      version: PREVIOUS_VERSION,
    });
    seedCached({
      projectId: LEFT_PROJECT,
      permissions: [Permission.ProjectOwner],
    });

    deleteRowsAsAMigrationDoes(Permission.EditIncidentFeed);
    deleteRowsAsAMigrationDoes(Permission.EditMonitorFeed);

    const sets: Map<string, UserTenantAccessPermission | null> =
      await AccessTokenService.getUserTenantAccessPermissions(MEMBER, [
        PROJECT,
        OTHER_PROJECT,
        LEFT_PROJECT,
      ]);

    expect(namesOf(sets.get(PROJECT.toString().toLowerCase()))).toEqual(
      REBUILT_FROM_THE_ROWS,
    );
    // Served from the cache as this release cached it.
    expect(namesOf(sets.get(OTHER_PROJECT.toString().toLowerCase()))).toEqual(
      [Permission.ReadProjectMonitor, Permission.ProjectUser].sort(),
    );
    expect(sets.get(LEFT_PROJECT.toString().toLowerCase())).toBeNull();
    expect(cachedVersionOf(PROJECT)).toBe(PERMISSION_ROWS_VERSION);
    expect(mockStore.has(tenantStoreKey(MEMBER, LEFT_PROJECT))).toBe(false);
  });
});

/*
 * Every set is cached through cacheUserTenantAccessPermission, so none is
 * written without the version: a write of the project permissions that
 * went around it would be served after the next migration, stale.
 */
describe("every write of a member's set carries the version", () => {
  const SERVER: string = path.join(__dirname, "../../../../Server");
  const HELPER: string = path.join(
    SERVER,
    "Utils/UserPermission/UserPermission.ts",
  );

  const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;

  function serverFiles(directory: string, into: Array<string>): Array<string> {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!["node_modules", "build", "dist"].includes(entry.name)) {
          serverFiles(full, into);
        }
      } else if (TYPESCRIPT_FILE.test(entry.name)) {
        into.push(full);
      }
    }

    return into;
  }

  // A file's code: its block and line comments taken out.
  function codeOf(file: string): string {
    return fs
      .readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "$1");
  }

  const WRITE_OF_PROJECT_PERMISSIONS: RegExp =
    /GlobalCache\.set\w*\(\s*(?:PermissionNamespace\.ProjectPermission|["'`]project-permissions["'`])/;

  test("no server code writes the project permissions but the helper", () => {
    const writers: Array<string> = serverFiles(SERVER, [])
      .filter((file: string): boolean => {
        return WRITE_OF_PROJECT_PERMISSIONS.test(codeOf(file));
      })
      .map((file: string): string => {
        return path.relative(SERVER, file);
      });

    expect(writers).toEqual(["Utils/UserPermission/UserPermission.ts"]);
  });

  test("the scan finds a write of them: the helper's own", () => {
    expect(WRITE_OF_PROJECT_PERMISSIONS.test(codeOf(HELPER))).toBe(true);
    expect(
      WRITE_OF_PROJECT_PERMISSIONS.test(
        `await GlobalCache.setJSON(\n  "project-permissions",\n  key,\n  set,\n);`,
      ),
    ).toBe(true);
  });

  test("AccessTokenService caches every set it builds through the helper", () => {
    const code: string = codeOf(
      path.join(SERVER, "Services/AccessTokenService.ts"),
    );

    expect(
      code.match(/UserPermissionUtil\.cacheUserTenantAccessPermission\(/g),
    ).toHaveLength(3);
  });
});
