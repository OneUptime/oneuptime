import ApiKeyPermissionService from "Common/Server/Services/ApiKeyPermissionService";
import TeamPermissionService from "Common/Server/Services/TeamPermissionService";
import APIKeyPermission from "Common/Models/DatabaseModels/ApiKeyPermission";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import Permission from "Common/Types/Permission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import ObjectID from "Common/Types/ObjectID";
import AddScheduledMaintenanceTemplateOwnerPermissions from "../../FeatureSet/Workers/DataMigrations/AddScheduledMaintenanceTemplateOwnerPermissions";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The backfill has to hold two lines at once, and getting either wrong is
 * silent:
 *
 *   It must not REVOKE. The two template-owner Create permissions changed
 *   string value, so every grant stored under the old value stops covering the
 *   template tables the moment the code ships.
 *
 *   It must not WIDEN. Creating a ScheduledMaintenanceTemplateOwnerUser row
 *   needed the old User string for the table gate AND the old Team string for
 *   the required scheduledMaintenanceTemplateId column, so a team holding only
 *   the User grant could not do it — and must not be able to afterwards.
 *
 * And blocks must be carried across, because block enforcement is table-level:
 * a block on the old string denied on the template tables too, and dropping it
 * would turn a deliberate denial into silent access.
 */

const OLD_USER: Permission = Permission.CreateScheduledMaintenanceOwnerUser;
const OLD_TEAM: Permission = Permission.CreateScheduledMaintenanceOwnerTeam;
const NEW_USER: Permission =
  Permission.CreateScheduledMaintenanceTemplateOwnerUser;
const NEW_TEAM: Permission =
  Permission.CreateScheduledMaintenanceTemplateOwnerTeam;

const PROJECT_ID: ObjectID = ObjectID.generate();

function teamRow(data: {
  teamId: ObjectID;
  permission: Permission;
  isBlockPermission?: boolean;
  scope?: PermissionScope;
}): TeamPermission {
  const row: TeamPermission = new TeamPermission();
  row.teamId = data.teamId;
  row.projectId = PROJECT_ID;
  row.permission = data.permission;
  row.isBlockPermission = data.isBlockPermission || false;
  row.scope = data.scope || PermissionScope.All;
  row.labels = [];
  return row;
}

function apiKeyRow(data: {
  apiKeyId: ObjectID;
  permission: Permission;
  isBlockPermission?: boolean;
}): APIKeyPermission {
  const row: APIKeyPermission = new APIKeyPermission();
  row.apiKeyId = data.apiKeyId;
  row.projectId = PROJECT_ID;
  row.permission = data.permission;
  row.isBlockPermission = data.isBlockPermission || false;
  row.labels = [];
  return row;
}

// Rows the migration decided to insert, captured from the create() spies.
interface Created {
  permission: Permission;
  isBlockPermission: boolean;
  scope?: PermissionScope | undefined;
}

function runWith(data: {
  teamRows: Array<TeamPermission>;
  apiKeyRows?: Array<APIKeyPermission>;
}): Promise<{ teams: Array<Created>; apiKeys: Array<Created> }> {
  const teams: Array<Created> = [];
  const apiKeys: Array<Created> = [];

  jest
    .spyOn(TeamPermissionService, "findBy")
    .mockResolvedValue(data.teamRows as never);
  jest
    .spyOn(TeamPermissionService, "findOneBy")
    .mockResolvedValue(null as never);
  jest
    .spyOn(TeamPermissionService, "create")
    .mockImplementation((createBy: unknown): never => {
      const item: TeamPermission = (createBy as { data: TeamPermission }).data;
      teams.push({
        permission: item.permission!,
        isBlockPermission: Boolean(item.isBlockPermission),
        scope: item.scope,
      });
      return Promise.resolve(item) as never;
    });

  jest
    .spyOn(ApiKeyPermissionService, "findBy")
    .mockResolvedValue((data.apiKeyRows || []) as never);
  jest
    .spyOn(ApiKeyPermissionService, "findOneBy")
    .mockResolvedValue(null as never);
  jest
    .spyOn(ApiKeyPermissionService, "create")
    .mockImplementation((createBy: unknown): never => {
      const item: APIKeyPermission = (createBy as { data: APIKeyPermission })
        .data;
      apiKeys.push({
        permission: item.permission!,
        isBlockPermission: Boolean(item.isBlockPermission),
      });
      return Promise.resolve(item) as never;
    });

  const migration: AddScheduledMaintenanceTemplateOwnerPermissions =
    new AddScheduledMaintenanceTemplateOwnerPermissions();

  return migration.migrate().then(() => {
    return { teams: teams, apiKeys: apiKeys };
  });
}

describe("AddScheduledMaintenanceTemplateOwnerPermissions", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test("the old and new permission values are genuinely different", () => {
    // If these ever collide again the whole migration is a no-op.
    expect(NEW_USER.toString()).not.toBe(OLD_USER.toString());
    expect(NEW_TEAM.toString()).not.toBe(OLD_TEAM.toString());
  });

  test("copies the Team grant one-for-one", async () => {
    const teamId: ObjectID = ObjectID.generate();

    const result: { teams: Array<Created> } = await runWith({
      teamRows: [teamRow({ teamId: teamId, permission: OLD_TEAM })],
    });

    expect(result.teams).toEqual([
      {
        permission: NEW_TEAM,
        isBlockPermission: false,
        scope: PermissionScope.All,
      },
    ]);
  });

  test("does NOT grant the new User permission to a team holding only the old User grant", async () => {
    /*
     * This team cannot create template owner-user rows today, because the
     * required column needs the Team grant it does not have. Handing it the new
     * permission would be a widening.
     */
    const teamId: ObjectID = ObjectID.generate();

    const result: { teams: Array<Created> } = await runWith({
      teamRows: [teamRow({ teamId: teamId, permission: OLD_USER })],
    });

    expect(result.teams).toEqual([]);
  });

  test("grants the new User permission when the team holds both old grants", async () => {
    const teamId: ObjectID = ObjectID.generate();

    const result: { teams: Array<Created> } = await runWith({
      teamRows: [
        teamRow({ teamId: teamId, permission: OLD_USER }),
        teamRow({ teamId: teamId, permission: OLD_TEAM }),
      ],
    });

    expect(
      result.teams
        .map((created: Created) => {
          return created.permission.toString();
        })
        .sort(),
    ).toEqual([NEW_TEAM.toString(), NEW_USER.toString()].sort());
  });

  test("does not pair grants held by different teams", async () => {
    // Team A holds the User grant, team B the Team grant. Neither gains NEW_USER.
    const teamA: ObjectID = ObjectID.generate();
    const teamB: ObjectID = ObjectID.generate();

    const result: { teams: Array<Created> } = await runWith({
      teamRows: [
        teamRow({ teamId: teamA, permission: OLD_USER }),
        teamRow({ teamId: teamB, permission: OLD_TEAM }),
      ],
    });

    expect(
      result.teams.map((created: Created) => {
        return created.permission;
      }),
    ).toEqual([NEW_TEAM]);
  });

  test("copies BOTH block rows unconditionally, so a denial keeps denying", async () => {
    const teamId: ObjectID = ObjectID.generate();

    const result: { teams: Array<Created> } = await runWith({
      teamRows: [
        teamRow({
          teamId: teamId,
          permission: OLD_USER,
          isBlockPermission: true,
        }),
      ],
    });

    // No companion Team grant, yet the block is still carried across.
    expect(result.teams).toEqual([
      {
        permission: NEW_USER,
        isBlockPermission: true,
        scope: PermissionScope.All,
      },
    ]);
  });

  test("does not let an allow grant satisfy a block row's pairing, or vice versa", async () => {
    const teamId: ObjectID = ObjectID.generate();

    const result: { teams: Array<Created> } = await runWith({
      teamRows: [
        // Allow-side User grant, block-side Team grant: different lists.
        teamRow({ teamId: teamId, permission: OLD_USER }),
        teamRow({
          teamId: teamId,
          permission: OLD_TEAM,
          isBlockPermission: true,
        }),
      ],
    });

    // Only the block copy — the allow-side User grant has no allow-side pair.
    expect(result.teams).toEqual([
      {
        permission: NEW_TEAM,
        isBlockPermission: true,
        scope: PermissionScope.All,
      },
    ]);
  });

  test("carries the scope of the row it copies", async () => {
    const teamId: ObjectID = ObjectID.generate();

    const result: { teams: Array<Created> } = await runWith({
      teamRows: [
        teamRow({
          teamId: teamId,
          permission: OLD_TEAM,
          scope: PermissionScope.Owned,
        }),
      ],
    });

    expect(result.teams[0]!.scope).toBe(PermissionScope.Owned);
  });

  test("applies the same rules to API keys", async () => {
    const keyWithBoth: ObjectID = ObjectID.generate();
    const keyWithUserOnly: ObjectID = ObjectID.generate();

    const result: { apiKeys: Array<Created> } = await runWith({
      teamRows: [],
      apiKeyRows: [
        apiKeyRow({ apiKeyId: keyWithBoth, permission: OLD_USER }),
        apiKeyRow({ apiKeyId: keyWithBoth, permission: OLD_TEAM }),
        apiKeyRow({ apiKeyId: keyWithUserOnly, permission: OLD_USER }),
      ],
    });

    expect(
      result.apiKeys
        .map((created: Created) => {
          return created.permission.toString();
        })
        .sort(),
    ).toEqual([NEW_TEAM.toString(), NEW_USER.toString()].sort());
  });

  test("is a no-op when nothing holds the old permissions", async () => {
    const result: { teams: Array<Created>; apiKeys: Array<Created> } =
      await runWith({ teamRows: [], apiKeyRows: [] });

    expect(result.teams).toEqual([]);
    expect(result.apiKeys).toEqual([]);
  });
});
