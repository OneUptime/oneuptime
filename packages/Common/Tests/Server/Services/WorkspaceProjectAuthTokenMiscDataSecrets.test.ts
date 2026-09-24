import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WorkspaceProjectAuthToken.miscData is readable by every project Viewer
 * through the CRUD API (the dashboard reads adminConsentGranted, teams and
 * chats from it). Microsoft Teams connections used to cache the tenant's live
 * Microsoft Graph app token there too, as miscData.appAccessToken, so any
 * Viewer could lift it with GET /workspace-project-auth-token selecting
 * miscData.
 *
 * The token now lives only in the server-only authToken / authTokenExpiresAt
 * columns. What is pinned here:
 *
 *   1. A Viewer's read goes through DatabaseService and comes back WITHOUT the
 *      legacy token keys, even when the stored row still carries them (not
 *      yet migrated, or written by an old pod during a rolling deploy), and
 *      the fields the dashboard needs survive.
 *   2. The same strip applies to root reads, so server code that reads
 *      miscData and writes it back cannot carry a token forward.
 *   3. A Viewer still cannot select authToken / authTokenExpiresAt.
 *   4. The writers keep the token out of miscData: refreshAuthToken stores the
 *      expiry in its own column, and saveRefreshedAuthToken (used by the Teams
 *      token refresh) writes only the token columns of the existing row.
 */

import WorkspaceProjectAuthTokenService, {
  Service as WorkspaceProjectAuthTokenServiceClass,
} from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsMiscData,
  MiscData,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

const TENANT_ID: string = "11111111-2222-3333-4444-555555555555";
const GRAPH_TOKEN: string = "eyJ0eXAiOiJKV1QifQ.graph-app-token.signature";

let projectId: ObjectID;
let userId: ObjectID;

function propsWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const userPermissions: Array<UserPermission> = permissions.map(
    (permission: Permission) => {
      return {
        _type: "UserPermission" as const,
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    },
  );

  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: userPermissions,
  };

  return {
    userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

// A Teams row as an older release left it: the Graph token inside miscData.
function legacyTeamsRow(): WorkspaceProjectAuthToken {
  const row: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  row._id = ObjectID.generate().toString();
  row.projectId = projectId;
  row.workspaceType = WorkspaceType.MicrosoftTeams;
  row.workspaceProjectId = TENANT_ID;
  row.authToken = GRAPH_TOKEN;
  row.miscData = {
    tenantId: TENANT_ID,
    teamId: "team-1",
    teamName: "Engineering",
    botId: "bot-1",
    adminConsentGranted: true,
    availableTeams: { "team-1": { id: "team-1", name: "Engineering" } },
    availableChats: {
      "19:chat@thread.v2": {
        id: "19:chat@thread.v2",
        name: "On-call",
        chatType: "groupChat",
      },
    },
    appAccessToken: GRAPH_TOKEN,
    appAccessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    lastAppTokenIssuedAt: "2026-01-01T00:00:00.000Z",
  };
  return row;
}

function expectNoToken(miscData: MiscData | undefined): void {
  expect(miscData).toBeDefined();
  expect(miscData).not.toHaveProperty("appAccessToken");
  expect(miscData).not.toHaveProperty("appAccessTokenExpiresAt");
  expect(miscData).not.toHaveProperty("lastAppTokenIssuedAt");
  expect(JSON.stringify(miscData)).not.toContain(GRAPH_TOKEN);
}

describe("WorkspaceProjectAuthToken miscData never serves the Graph app token", () => {
  let find: jest.Mock;

  beforeEach(() => {
    jest.restoreAllMocks();
    projectId = ObjectID.generate();
    userId = ObjectID.generate();

    find = jest.fn(async () => {
      return [legacyTeamsRow()];
    });

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getRepository")
      .mockReturnValue({ find } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a Viewer's list read strips the token keys and keeps what the dashboard reads", async () => {
    const items: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectAuthTokenService.findBy({
        query: {},
        select: {
          miscData: true,
          workspaceType: true,
          workspaceProjectId: true,
        },
        skip: 0,
        limit: 10,
        props: propsWith([Permission.Viewer]),
      });

    expect(find).toHaveBeenCalledTimes(1);
    expect(items).toHaveLength(1);

    const miscData: MicrosoftTeamsMiscData = items[0]!
      .miscData as MicrosoftTeamsMiscData;
    expectNoToken(miscData);
    expect(miscData.adminConsentGranted).toBe(true);
    expect(Object.keys(miscData.availableTeams || {})).toEqual(["team-1"]);
    expect(Object.keys(miscData.availableChats || {})).toEqual([
      "19:chat@thread.v2",
    ]);
  });

  test("a Viewer's single-item read strips the token keys", async () => {
    const item: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.findOneById({
        id: ObjectID.generate(),
        select: { miscData: true },
        props: propsWith([Permission.Viewer]),
      });

    expectNoToken(item?.miscData);
  });

  test("a Viewer still cannot select the token column itself", async () => {
    for (const column of ["authToken", "authTokenExpiresAt"]) {
      await expect(
        WorkspaceProjectAuthTokenService.findBy({
          query: {},
          select: { [column]: true } as any,
          skip: 0,
          limit: 10,
          props: propsWith([Permission.Viewer]),
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    }

    expect(find).not.toHaveBeenCalled();
  });

  test("root reads are stripped too, while authToken still carries the token", async () => {
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    expectNoToken(projectAuth?.miscData);
    expect(projectAuth?.authToken).toBe(GRAPH_TOKEN);

    // The token columns are what the server reads the token from.
    const select: Record<string, unknown> = (find.mock.calls[0]![0] as any)
      .select;
    expect(select["authToken"]).toBe(true);
    expect(select["authTokenExpiresAt"]).toBe(true);
  });
});

describe("WorkspaceProjectAuthTokenService.removeLegacyServerOnlyMiscData", () => {
  test("returns a copy without the token keys and leaves the input alone", () => {
    const input: MiscData = {
      tenantId: TENANT_ID,
      appAccessToken: GRAPH_TOKEN,
      appAccessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    };

    const output: MiscData =
      WorkspaceProjectAuthTokenServiceClass.removeLegacyServerOnlyMiscData(
        input,
      );

    expect(output).toEqual({ tenantId: TENANT_ID });
    expect(input["appAccessToken"]).toBe(GRAPH_TOKEN);
  });

  test("returns miscData without token keys as-is", () => {
    const input: MiscData = { teamId: "T1", teamName: "Acme", botUserId: "U1" };

    expect(
      WorkspaceProjectAuthTokenServiceClass.removeLegacyServerOnlyMiscData(
        input,
      ),
    ).toBe(input);
  });
});

describe("WorkspaceProjectAuthToken writers keep the token out of miscData", () => {
  let findOneBy: jest.SpyInstance;
  let create: jest.SpyInstance;
  let updateOneById: jest.SpyInstance;
  let updateOneBy: jest.SpyInstance;

  beforeEach(() => {
    jest.restoreAllMocks();
    projectId = ObjectID.generate();

    findOneBy = jest
      .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
      .mockResolvedValue(null);
    create = jest
      .spyOn(WorkspaceProjectAuthTokenService, "create")
      .mockImplementation(async (args: any) => {
        return args.data;
      });
    updateOneById = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockResolvedValue(1);
    updateOneBy = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneBy")
      .mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const teamsMiscData: MicrosoftTeamsMiscData = {
    tenantId: TENANT_ID,
    teamId: "team-1",
    teamName: "Engineering",
    botId: "bot-1",
    adminConsentGranted: true,
  };

  test("refreshAuthToken stores the token's expiry in its own column on create", async () => {
    const expiresAt: Date = new Date(Date.now() + 3600 * 1000);

    await WorkspaceProjectAuthTokenService.refreshAuthToken({
      projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
      authToken: GRAPH_TOKEN,
      authTokenExpiresAt: expiresAt,
      workspaceProjectId: TENANT_ID,
      miscData: teamsMiscData,
    });

    expect(create).toHaveBeenCalledTimes(1);
    const created: WorkspaceProjectAuthToken = (create.mock.calls[0]![0] as any)
      .data;
    expect(created.authToken).toBe(GRAPH_TOKEN);
    expect(created.authTokenExpiresAt).toBe(expiresAt);
    expectNoToken(created.miscData);
  });

  test("refreshAuthToken replaces the expiry on update, and clears it when none is given", async () => {
    findOneBy.mockResolvedValue({
      _id: ObjectID.generate().toString(),
      id: ObjectID.generate(),
      workspaceProjectId: TENANT_ID,
    });

    const expiresAt: Date = new Date(Date.now() + 3600 * 1000);

    await WorkspaceProjectAuthTokenService.refreshAuthToken({
      projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
      authToken: GRAPH_TOKEN,
      authTokenExpiresAt: expiresAt,
      workspaceProjectId: TENANT_ID,
      miscData: teamsMiscData,
    });

    await WorkspaceProjectAuthTokenService.refreshAuthToken({
      projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
      authToken: "a-token-with-no-known-expiry",
      workspaceProjectId: TENANT_ID,
      miscData: teamsMiscData,
    });

    expect(updateOneById).toHaveBeenCalledTimes(2);
    const first: any = (updateOneById.mock.calls[0]![0] as any).data;
    const second: any = (updateOneById.mock.calls[1]![0] as any).data;

    expect(first.authTokenExpiresAt).toBe(expiresAt);
    expectNoToken(first.miscData);

    // A new token must not inherit the previous token's expiry.
    expect(second.authTokenExpiresAt).toBeNull();
  });

  test("saveRefreshedAuthToken writes only the token columns of the existing connection", async () => {
    const expiresAt: Date = new Date(Date.now() + 3600 * 1000);

    await WorkspaceProjectAuthTokenService.saveRefreshedAuthToken({
      projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceProjectId: TENANT_ID,
      authToken: GRAPH_TOKEN,
      authTokenExpiresAt: expiresAt,
    });

    expect(updateOneBy).toHaveBeenCalledTimes(1);
    const args: any = updateOneBy.mock.calls[0]![0];

    // Scoped to the same connection: a disconnected or repointed row is not written.
    expect(args.query).toEqual({
      projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceProjectId: TENANT_ID,
    });
    expect(args.data).toEqual({
      authToken: GRAPH_TOKEN,
      authTokenExpiresAt: expiresAt,
    });
    expect(args.props).toEqual({ isRoot: true });

    // Never an upsert, never a miscData write.
    expect(create).not.toHaveBeenCalled();
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("saveRefreshedAuthToken rejects a missing workspace before touching the database", async () => {
    await expect(
      WorkspaceProjectAuthTokenService.saveRefreshedAuthToken({
        projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceProjectId: "",
        authToken: GRAPH_TOKEN,
        authTokenExpiresAt: new Date(),
      }),
    ).rejects.toThrow("workspaceProjectId is required");

    expect(updateOneBy).not.toHaveBeenCalled();
  });
});
