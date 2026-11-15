import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../../Models/DatabaseModels/TeamPermission";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import {
  TestRedisClient,
  connectTestRedis,
} from "../../TestingUtils/Redis/TestRedisClient";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Members' cached permission sets and the version of the permission rows
 * they were built from (#8373), against a real Valkey: the set as
 * GlobalCache writes it and reads it back, the expiry it is written with,
 * and the issue's own check - a team's row, a member who signed in before
 * the migration, the row deleted as the migration deletes it, and the
 * member's next request, answered from the rows rather than the set Valkey
 * kept. PermissionRowsVersionCache.test.ts holds the same with a store in
 * memory; here Valkey keeps it.
 *
 * It needs Valkey: CI's test-setup.sh starts one on localhost:6310. Locally,
 * a disposable one:
 *
 *   docker run -d --rm -p 16418:6379 valkey/valkey:9.1-alpine
 *   PERMISSION_ROWS_VERSION_TEST_REDIS_URL=redis://localhost:16418 \
 *     npx jest Tests/Server/Utils/UserPermission/PermissionRowsVersionValkey.test.ts
 *
 * Every member and project here is a fresh id, and the keys this suite wrote
 * are removed after each test. Postgres is a membership table and a
 * permission table in memory.
 */

interface Membership {
  userId: string;
  projectId: string;
  teamId: string;
}

interface Row {
  teamId: string;
  projectId: string;
  permission: string;
}

const mockMemberships: Array<Membership> = [];
const mockRows: Array<Row> = [];
const mockDatabaseReads: Array<string> = [];

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

jest.mock("../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getClient: jest.fn(), isConnected: jest.fn() },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
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
          (users === null || users.includes(membership.userId)) &&
          (projects === null || projects.includes(membership.projectId))
        );
      })
      .map((membership: Membership): TeamMember => {
        const member: TeamMember = new TeamMember();
        member.userId = new ObjectID(membership.userId);
        member.projectId = new ObjectID(membership.projectId);
        member.teamId = new ObjectID(membership.teamId);
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
        return (
          (teams === null || teams.includes(row.teamId)) &&
          (projects === null || projects.includes(row.projectId))
        );
      })
      .map((row: Row): TeamPermission => {
        const permission: TeamPermission = new TeamPermission();
        permission.teamId = new ObjectID(row.teamId);
        permission.projectId = new ObjectID(row.projectId);
        permission.permission = row.permission as Permission;
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

import Redis from "../../../../Server/Infrastructure/Redis";
import {
  PERMISSION_ROW_MIGRATIONS,
  PERMISSION_ROWS_VERSION,
  getMigrationNumber,
} from "../../../../Server/Infrastructure/Postgres/PermissionRowMigrations";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import UserPermissionUtil, {
  PERMISSION_ROWS_VERSION_FIELD,
} from "../../../../Server/Utils/UserPermission/UserPermission";

let client: TestRedisClient;
const writtenKeys: Array<string> = [];

const PREVIOUS_VERSION: number = getMigrationNumber(
  PERMISSION_ROW_MIGRATIONS[PERMISSION_ROW_MIGRATIONS.length - 2]!,
);

interface World {
  member: ObjectID;
  project: ObjectID;
  team: ObjectID;
}

// A member of a project, through one team: fresh ids, so no key is shared.
function newWorld(member: ObjectID = ObjectID.generate()): World {
  const world: World = {
    member: member,
    project: ObjectID.generate(),
    team: ObjectID.generate(),
  };

  mockMemberships.push({
    userId: world.member.toString().toLowerCase(),
    projectId: world.project.toString().toLowerCase(),
    teamId: world.team.toString().toLowerCase(),
  });

  writtenKeys.push(
    tenantKey(world.member, world.project),
    `user-${world.member.toString()}`,
  );

  return world;
}

function grant(world: World, permission: Permission): void {
  mockRows.push({
    teamId: world.team.toString().toLowerCase(),
    projectId: world.project.toString().toLowerCase(),
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

// The key Valkey keeps a member's set in a project under.
function tenantKey(userId: ObjectID, projectId: ObjectID): string {
  return `project-permissions-${UserPermissionUtil.buildTenantPermissionCacheKey(
    userId,
    projectId,
  )}`;
}

/*
 * A set as a server of an older release cached it: GlobalCache.setJSON's
 * value and expiry, with the version that release cached sets with - or,
 * before sets carried one, with none.
 */
async function cacheAsAnOlderReleaseDid(data: {
  world: World;
  permissions: Array<Permission>;
  version?: number | undefined;
}): Promise<void> {
  const set: JSONObject = {
    _type: "UserTenantAccessPermission",
    projectId: data.world.project,
    permissions: data.permissions.map((permission: Permission): JSONObject => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
        teamId: data.world.team,
      };
    }),
  };

  if (data.version !== undefined) {
    set[PERMISSION_ROWS_VERSION_FIELD] = data.version;
  }

  await client.set(
    tenantKey(data.world.member, data.world.project),
    JSON.stringify(JSONFunctions.serialize(set)),
    "EX",
    30 * 24 * 60 * 60,
  );
}

async function storedSetOf(world: World): Promise<JSONObject | null> {
  const raw: string | null = await client.get(
    tenantKey(world.member, world.project),
  );

  return raw ? (JSON.parse(raw) as JSONObject) : null;
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

beforeAll(async () => {
  client = await connectTestRedis(
    process.env["PERMISSION_ROWS_VERSION_TEST_REDIS_URL"],
  );
});

afterAll(async () => {
  await client.quit();
});

beforeEach(() => {
  jest.mocked(Redis.getClient).mockReturnValue(client);
  jest.mocked(Redis.isConnected).mockReturnValue(true);
  mockMemberships.length = 0;
  mockRows.length = 0;
  mockDatabaseReads.length = 0;
});

afterEach(async () => {
  if (writtenKeys.length > 0) {
    await client.del(...writtenKeys);
  }

  writtenKeys.length = 0;
});

describe("a member's set, as Valkey keeps it", () => {
  test("is written with the version of the rows it was built from, for 30 days", async () => {
    const world: World = newWorld();
    grant(world, Permission.ReadProjectIncident);

    await AccessTokenService.refreshUserTenantAccessPermission(
      world.member,
      world.project,
    );

    const stored: JSONObject | null = await storedSetOf(world);

    expect(stored?.[PERMISSION_ROWS_VERSION_FIELD]).toBe(
      PERMISSION_ROWS_VERSION,
    );
    expect(stored?.["_type"]).toBe("UserTenantAccessPermission");

    const ttl: number = await client.ttl(
      tenantKey(world.member, world.project),
    );

    expect(ttl).toBeGreaterThan(29 * 24 * 60 * 60);
    expect(ttl).toBeLessThanOrEqual(30 * 24 * 60 * 60);
  });

  test("is read back as it was built, without the version", async () => {
    const world: World = newWorld();
    grant(world, Permission.ReadProjectIncident);
    await AccessTokenService.refreshUserTenantAccessPermission(
      world.member,
      world.project,
    );

    const served: UserTenantAccessPermission | null =
      await UserPermissionUtil.getUserTenantAccessPermissionFromCache(
        world.member,
        world.project,
      );

    expect(namesOf(served)).toContain(Permission.ReadProjectIncident);
    expect(served?.[PERMISSION_ROWS_VERSION_FIELD]).toBeUndefined();
    expect(served?.projectId?.toString()).toBe(world.project.toString());
  });

  test.each([
    ["before sets carried a version", undefined],
    ["by the release of the migration before the newest", PREVIOUS_VERSION],
  ])(
    "one cached %s is read as missing, and Valkey no longer keeps it",
    async (_label: string, version: number | undefined) => {
      const world: World = newWorld();
      await cacheAsAnOlderReleaseDid({
        world,
        permissions: [Permission.EditIncidentFeed],
        version,
      });

      expect(
        await UserPermissionUtil.getUserTenantAccessPermissionFromCache(
          world.member,
          world.project,
        ),
      ).toBeNull();
      expect(await client.exists(tenantKey(world.member, world.project))).toBe(
        0,
      );
    },
  );

  test("one a newer release cached is read as it is", async () => {
    const world: World = newWorld();
    await cacheAsAnOlderReleaseDid({
      world,
      permissions: [Permission.ReadProjectIncident],
      version: PERMISSION_ROWS_VERSION + 100000,
    });

    expect(
      namesOf(
        await UserPermissionUtil.getUserTenantAccessPermissionFromCache(
          world.member,
          world.project,
        ),
      ),
    ).toContain(Permission.ReadProjectIncident);
    expect(await client.exists(tenantKey(world.member, world.project))).toBe(1);
  });

  test("several projects of a member in one read: the stale ones go, the current one stays", async () => {
    const current: World = newWorld();
    const stale: World = newWorld(current.member);
    const unversioned: World = newWorld(current.member);

    grant(current, Permission.ReadProjectIncident);
    await AccessTokenService.refreshUserTenantAccessPermission(
      current.member,
      current.project,
    );
    await cacheAsAnOlderReleaseDid({
      world: stale,
      permissions: [Permission.EditMonitorFeed],
      version: PREVIOUS_VERSION,
    });
    await cacheAsAnOlderReleaseDid({
      world: unversioned,
      permissions: [Permission.AddLabelsToProjectResources],
    });

    const sets: Array<UserTenantAccessPermission | null> =
      await UserPermissionUtil.getUserTenantAccessPermissionsFromCache(
        current.member,
        [current.project, stale.project, unversioned.project],
      );

    expect(namesOf(sets[0])).toContain(Permission.ReadProjectIncident);
    expect(sets.slice(1)).toEqual([null, null]);
    expect(
      await client.exists(tenantKey(current.member, current.project)),
    ).toBe(1);
    expect(
      await client.exists(
        tenantKey(stale.member, stale.project),
        tenantKey(unversioned.member, unversioned.project),
      ),
    ).toBe(0);
  });
});

/*
 * The issue's check, on a server with Valkey: a team's row, a member who
 * signed in before the migration (their set in Valkey holds the row), the
 * row deleted with a DELETE as the migration deletes it, and the member's
 * set read again. Before, Valkey's set was served, row included, for up to
 * 30 days.
 */
describe("a member's next request after a migration took their team's row away", () => {
  test.each([
    ["before sets carried a version", undefined],
    ["by the release of the migration before the newest", PREVIOUS_VERSION],
  ])(
    "a set signed in %s is answered from the rows, without the row",
    async (_label: string, version: number | undefined) => {
      const world: World = newWorld();
      grant(world, Permission.ReadProjectIncident);
      grant(world, Permission.EditIncidentFeed);

      // Signed in on the release before: Valkey's set holds the row.
      await AccessTokenService.refreshUserGlobalAccessPermission(world.member);
      await cacheAsAnOlderReleaseDid({
        world,
        permissions: [
          Permission.ReadProjectIncident,
          Permission.EditIncidentFeed,
        ],
        version,
      });

      deleteRowsAsAMigrationDoes(Permission.EditIncidentFeed);

      const served: UserTenantAccessPermission | null =
        await AccessTokenService.getUserTenantAccessPermission(
          world.member,
          world.project,
        );

      expect(namesOf(served)).toContain(Permission.ReadProjectIncident);
      expect(namesOf(served)).not.toContain(Permission.EditIncidentFeed);

      // What Valkey keeps now is the rebuilt set, with this release's version.
      const stored: JSONObject | null = await storedSetOf(world);

      expect(stored?.[PERMISSION_ROWS_VERSION_FIELD]).toBe(
        PERMISSION_ROWS_VERSION,
      );
      expect(JSON.stringify(stored)).not.toContain(Permission.EditIncidentFeed);

      // And the next request is answered from it, without reading the rows.
      mockDatabaseReads.length = 0;

      expect(
        namesOf(
          await AccessTokenService.getUserTenantAccessPermission(
            world.member,
            world.project,
          ),
        ),
      ).not.toContain(Permission.EditIncidentFeed);
      expect(mockDatabaseReads).toEqual([]);
    },
  );

  test("a sign-in after the migration caches sets without the row, with this release's version", async () => {
    const world: World = newWorld();
    grant(world, Permission.ReadProjectIncident);
    grant(world, Permission.CreateOnCallDutyPolicyScheduleLayerUser);

    deleteRowsAsAMigrationDoes(
      Permission.CreateOnCallDutyPolicyScheduleLayerUser,
    );
    await AccessTokenService.refreshUserAllPermissions(world.member);

    const stored: JSONObject | null = await storedSetOf(world);

    expect(stored?.[PERMISSION_ROWS_VERSION_FIELD]).toBe(
      PERMISSION_ROWS_VERSION,
    );
    expect(JSON.stringify(stored)).not.toContain(
      Permission.CreateOnCallDutyPolicyScheduleLayerUser,
    );
  });
});
