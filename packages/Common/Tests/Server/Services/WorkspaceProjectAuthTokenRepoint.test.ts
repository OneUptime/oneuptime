import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * WorkspaceProjectAuthTokenService.refreshAuthToken — the workspace REPOINT
 * guard.
 *
 * A OneUptime project stores exactly one workspace connection per workspace
 * type: one Microsoft tenant, one Slack team. refreshAuthToken upserts on
 * (projectId, workspaceType) and USED TO overwrite workspaceProjectId
 * unconditionally, so re-running the connect flow while signed into a
 * DIFFERENT Microsoft tenant (or a different Slack team) silently repointed
 * the project. Every existing notification rule then aimed at channels/chats
 * that no longer resolve, and every bot conversation captured under the old
 * workspace was orphaned — with no error to the admin and nothing in the logs.
 *
 * The fix selects workspaceProjectId alongside _id and refuses the write when
 * the stored workspace differs from the incoming one, telling the admin to
 * disconnect the existing connection first.
 *
 * What is pinned here:
 *
 *   1. The happy paths still work: no row -> create with every field set and
 *      nothing logged; matching workspaceProjectId -> updateOneById.
 *   2. A MISMATCH throws BadDataException BEFORE any write — neither create
 *      nor updateOneById may be reached — the message names the workspace type
 *      and tells the admin to disconnect, and the log carries structured
 *      context.
 *   3. A stored row with no workspaceProjectId has nothing to protect and must
 *      still update.
 *   4. The guard is workspace-agnostic: Slack behaves exactly like Microsoft
 *      Teams, and the lookup is scoped to (projectId, workspaceType) so the
 *      two types cannot cross-fire.
 *   5. THE SUBTLE REGRESSION: the findOneBy select must include
 *      workspaceProjectId. Drop that one field and findOneBy hands back a row
 *      whose workspaceProjectId is undefined, the guard never fires, and the
 *      silent repoint is back. The findOneBy mock below HONOURS the select for
 *      exactly this reason — it projects the stored row down to the columns
 *      the caller asked for, the way the database does — so reverting either
 *      half of the fix breaks the guard tests on BEHAVIOUR, not just the one
 *      white-box assertion on the select object.
 *   6. The pre-existing argument validation is unchanged, and rejects before
 *      any database round trip.
 *   7. One known limitation, documented deliberately rather than asserted as
 *      desirable: the guard is TENANT-scoped, not team-scoped.
 */

import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsMiscData,
  SlackMiscData,
  WorkspaceMiscData,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import logger from "../../../Server/Utils/Logger";

const TEAMS_TENANT_A: string = "11111111-2222-3333-4444-555555555555";
const TEAMS_TENANT_B: string = "99999999-8888-7777-6666-555555555555";
const SLACK_TEAM_A: string = "T0AAAAAAA";
const SLACK_TEAM_B: string = "T0BBBBBBB";

let findOneBy: jest.SpyInstance;
let create: jest.SpyInstance;
let updateOneById: jest.SpyInstance;
let loggerError: jest.SpyInstance;

function teamsMiscData(
  overrides?: Partial<MicrosoftTeamsMiscData>,
): MicrosoftTeamsMiscData {
  return {
    tenantId: TEAMS_TENANT_A,
    teamId: "team-1",
    teamName: "Engineering",
    botId: "bot-1",
    ...(overrides || {}),
  } as MicrosoftTeamsMiscData;
}

function slackMiscData(overrides?: Partial<SlackMiscData>): SlackMiscData {
  return {
    teamId: SLACK_TEAM_A,
    teamName: "Acme",
    botUserId: "U0BOT",
    ...(overrides || {}),
  } as SlackMiscData;
}

/*
 * The full row as it sits in the database. What refreshAuthToken actually gets
 * to see is decided by its own select — see mockStoredRow.
 */
type StoredRow = {
  id: ObjectID;
  projectId: ObjectID;
  workspaceType: WorkspaceType;
  authToken: string;
  workspaceProjectId: string | undefined | null;
  miscData: WorkspaceMiscData;
};

const SELECT_KEY_TO_ROW_KEY: Record<string, keyof StoredRow> = {
  _id: "id",
  id: "id",
  projectId: "projectId",
  workspaceType: "workspaceType",
  authToken: "authToken",
  workspaceProjectId: "workspaceProjectId",
  miscData: "miscData",
};

function buildStoredRow(overrides?: Partial<StoredRow>): StoredRow {
  return {
    id: ObjectID.generate(),
    projectId: ObjectID.generate(),
    workspaceType: WorkspaceType.MicrosoftTeams,
    authToken: "stored-token",
    workspaceProjectId: TEAMS_TENANT_A,
    miscData: teamsMiscData(),
    ...(overrides || {}),
  };
}

/*
 * findOneBy hands back ONLY the columns the caller selected — so this
 * projection is the whole point of the mock, not a nicety. A row that carried
 * workspaceProjectId regardless of the select would keep the guard tests green
 * even with `workspaceProjectId: true` deleted from production's select, which
 * is precisely the regression this suite exists to catch.
 */
function projectOntoSelect(
  row: StoredRow,
  select: Record<string, boolean> | undefined,
): WorkspaceProjectAuthToken {
  const selected: Record<string, boolean> = select || {};
  const projected: Record<string, unknown> = {};

  for (const selectKey of Object.keys(selected)) {
    if (!selected[selectKey]) {
      continue;
    }

    const rowKey: keyof StoredRow | undefined =
      SELECT_KEY_TO_ROW_KEY[selectKey];

    if (!rowKey) {
      continue;
    }

    projected[rowKey] = row[rowKey];
  }

  return projected as unknown as WorkspaceProjectAuthToken;
}

type FindOneByArgs = {
  query: Record<string, unknown>;
  select: Record<string, boolean> | undefined;
  props: { isRoot: boolean };
};

function mockStoredRow(overrides?: Partial<StoredRow>): StoredRow {
  const row: StoredRow = buildStoredRow(overrides);

  findOneBy.mockImplementation(
    async (
      findBy: FindOneByArgs,
    ): Promise<WorkspaceProjectAuthToken | null> => {
      return projectOntoSelect(row, findBy.select);
    },
  );

  return row;
}

type RefreshArgs = {
  projectId: ObjectID;
  workspaceType: WorkspaceType;
  authToken: string;
  workspaceProjectId: string;
  miscData: WorkspaceMiscData;
};

function refreshArgs(overrides?: Partial<RefreshArgs>): RefreshArgs {
  return {
    projectId: ObjectID.generate(),
    workspaceType: WorkspaceType.MicrosoftTeams,
    authToken: "auth-token-1",
    workspaceProjectId: TEAMS_TENANT_A,
    miscData: teamsMiscData(),
    ...(overrides || {}),
  };
}

async function refresh(overrides?: Partial<RefreshArgs>): Promise<void> {
  return await WorkspaceProjectAuthTokenService.refreshAuthToken(
    refreshArgs(overrides),
  );
}

async function captureError(fn: () => Promise<void>): Promise<Exception> {
  try {
    await fn();
  } catch (err) {
    return err as Exception;
  }
  throw new Error("Expected refreshAuthToken to throw, but it resolved.");
}

beforeEach(() => {
  findOneBy = jest.spyOn(
    WorkspaceProjectAuthTokenService,
    "findOneBy",
  ) as jest.SpyInstance;
  create = jest.spyOn(
    WorkspaceProjectAuthTokenService,
    "create",
  ) as jest.SpyInstance;
  updateOneById = jest.spyOn(
    WorkspaceProjectAuthTokenService,
    "updateOneById",
  ) as jest.SpyInstance;
  loggerError = jest.spyOn(logger, "error") as jest.SpyInstance;

  findOneBy.mockResolvedValue(null);
  create.mockImplementation(
    async (createBy: {
      data: WorkspaceProjectAuthToken;
    }): Promise<WorkspaceProjectAuthToken> => {
      return createBy.data;
    },
  );
  updateOneById.mockResolvedValue(1);
  loggerError.mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspaceProjectAuthTokenService.refreshAuthToken first connection", () => {
  test("creates a row with every field set when the project has no connection", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const miscData: MicrosoftTeamsMiscData = teamsMiscData();

    await refresh({
      projectId: projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
      authToken: "brand-new-token",
      workspaceProjectId: TEAMS_TENANT_A,
      miscData: miscData,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(updateOneById).not.toHaveBeenCalled();

    const created: WorkspaceProjectAuthToken = create.mock.calls[0][0].data;
    expect(created).toBeInstanceOf(WorkspaceProjectAuthToken);
    expect(created.projectId?.toString()).toBe(projectId.toString());
    expect(created.authToken).toBe("brand-new-token");
    expect(created.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
    expect(created.workspaceProjectId).toBe(TEAMS_TENANT_A);
    expect(created.miscData).toEqual(miscData);
    expect(create.mock.calls[0][0].props).toEqual({ isRoot: true });

    // A first connection repoints nothing, so the guard must stay quiet.
    expect(loggerError).not.toHaveBeenCalled();
  });
});

describe("WorkspaceProjectAuthTokenService.refreshAuthToken same workspace", () => {
  test("updates the existing row when workspaceProjectId matches", async () => {
    const miscData: MicrosoftTeamsMiscData = teamsMiscData({
      teamName: "Renamed Team",
    });
    const row: StoredRow = mockStoredRow({
      workspaceProjectId: TEAMS_TENANT_A,
    });

    await refresh({
      authToken: "rotated-token",
      workspaceProjectId: TEAMS_TENANT_A,
      miscData: miscData,
    });

    expect(create).not.toHaveBeenCalled();
    expect(updateOneById).toHaveBeenCalledTimes(1);

    const updateArgs: {
      id: ObjectID;
      data: {
        authToken: string;
        workspaceProjectId: string;
        miscData: WorkspaceMiscData;
      };
      props: { isRoot: boolean };
    } = updateOneById.mock.calls[0][0];
    expect(updateArgs.id.toString()).toBe(row.id.toString());
    expect(updateArgs.data.authToken).toBe("rotated-token");
    expect(updateArgs.data.workspaceProjectId).toBe(TEAMS_TENANT_A);
    expect(updateArgs.data.miscData).toEqual(miscData);
    expect(updateArgs.props).toEqual({ isRoot: true });
    expect(loggerError).not.toHaveBeenCalled();
  });
});

describe("WorkspaceProjectAuthTokenService.refreshAuthToken repoint guard", () => {
  test("throws BadDataException when the stored workspace differs", async () => {
    mockStoredRow({ workspaceProjectId: TEAMS_TENANT_A });

    const error: Exception = await captureError(async (): Promise<void> => {
      return await refresh({ workspaceProjectId: TEAMS_TENANT_B });
    });

    expect(error).toBeInstanceOf(BadDataException);
  });

  test("fires the guard BEFORE any write — no create, no update", async () => {
    mockStoredRow({ workspaceProjectId: TEAMS_TENANT_A });

    await captureError(async (): Promise<void> => {
      return await refresh({ workspaceProjectId: TEAMS_TENANT_B });
    });

    expect(create).not.toHaveBeenCalled();
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("the message tells the admin to disconnect and names the workspace type", async () => {
    mockStoredRow({ workspaceProjectId: TEAMS_TENANT_A });

    const error: Exception = await captureError(async (): Promise<void> => {
      return await refresh({
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceProjectId: TEAMS_TENANT_B,
      });
    });

    expect(error.message.toLowerCase()).toContain("disconnect");
    /*
     * The admin-facing display name, not the enum value: "Microsoft Teams",
     * never "MicrosoftTeams".
     */
    expect(error.message).toContain("Microsoft Teams");
    expect(error.message).not.toContain(WorkspaceType.MicrosoftTeams);
  });

  test("logs the refusal with structured project and workspace context", async () => {
    const projectId: ObjectID = ObjectID.generate();
    mockStoredRow({ workspaceProjectId: TEAMS_TENANT_A });

    await captureError(async (): Promise<void> => {
      return await refresh({
        projectId: projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceProjectId: TEAMS_TENANT_B,
      });
    });

    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(loggerError.mock.calls[0][1]).toEqual({
      projectId: projectId.toString(),
      workspaceType: WorkspaceType.MicrosoftTeams,
    });
  });

  test("compares workspace ids exactly — a case difference is a different workspace", async () => {
    /*
     * The comparison is strict on purpose: a tenant id that arrives in a
     * different case is not evidence that it is the same workspace, and
     * refusing is the safe side of the trade.
     */
    mockStoredRow({ workspaceProjectId: SLACK_TEAM_A });

    const error: Exception = await captureError(async (): Promise<void> => {
      return await refresh({
        workspaceType: WorkspaceType.Slack,
        workspaceProjectId: SLACK_TEAM_A.toLowerCase(),
        miscData: slackMiscData(),
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("a stored row with no workspaceProjectId updates instead of throwing", async () => {
    /*
     * Rows written before workspaceProjectId was populated have nothing to
     * protect, so the guard must not strand them — the next connect adopts
     * whatever workspace arrives.
     */
    mockStoredRow({ workspaceProjectId: null });

    await expect(
      refresh({ workspaceProjectId: TEAMS_TENANT_B }),
    ).resolves.toBeUndefined();

    expect(updateOneById).toHaveBeenCalledTimes(1);
    expect(updateOneById.mock.calls[0][0].data.workspaceProjectId).toBe(
      TEAMS_TENANT_B,
    );
    expect(create).not.toHaveBeenCalled();
    expect(loggerError).not.toHaveBeenCalled();
  });
});

describe("WorkspaceProjectAuthTokenService.refreshAuthToken guard scope", () => {
  test("a different Teams TEAM in the SAME tenant is allowed and overwrites miscData", async () => {
    /*
     * DOCUMENTS CURRENT BEHAVIOUR, NOT DESIRED BEHAVIOUR.
     *
     * The guard is TENANT-scoped, not team-scoped: for Microsoft Teams,
     * workspaceProjectId holds the tenant id, while the team the bot was
     * actually installed into lives in miscData.teamId. Two different teams in
     * one tenant are therefore indistinguishable to the guard, so this
     * reconnect passes and replaces miscData wholesale — the old team id, name
     * and bot id are gone, and anything captured under that team is orphaned
     * exactly the way a cross-tenant repoint used to orphan things.
     *
     * If the guard is ever tightened to compare teams too, this is the test
     * that should change.
     */
    const row: StoredRow = mockStoredRow({
      workspaceProjectId: TEAMS_TENANT_A,
      miscData: teamsMiscData({ teamId: "team-1", teamName: "Engineering" }),
    });
    const differentTeam: MicrosoftTeamsMiscData = teamsMiscData({
      teamId: "team-2",
      teamName: "Support",
      botId: "bot-2",
    });

    await expect(
      refresh({
        workspaceProjectId: TEAMS_TENANT_A,
        miscData: differentTeam,
      }),
    ).resolves.toBeUndefined();

    expect(updateOneById).toHaveBeenCalledTimes(1);
    expect(updateOneById.mock.calls[0][0].id.toString()).toBe(
      row.id.toString(),
    );
    expect(updateOneById.mock.calls[0][0].data.miscData).toEqual(differentTeam);
    expect(loggerError).not.toHaveBeenCalled();
  });
});

describe("WorkspaceProjectAuthTokenService.refreshAuthToken across workspace types", () => {
  test("Slack repoints are refused exactly like Microsoft Teams ones", async () => {
    mockStoredRow({
      workspaceType: WorkspaceType.Slack,
      workspaceProjectId: SLACK_TEAM_A,
    });

    const error: Exception = await captureError(async (): Promise<void> => {
      return await refresh({
        workspaceType: WorkspaceType.Slack,
        workspaceProjectId: SLACK_TEAM_B,
        miscData: slackMiscData({ teamId: SLACK_TEAM_B }),
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain("Slack");
    expect(error.message).not.toContain("Microsoft Teams");
    expect(create).not.toHaveBeenCalled();
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("a Slack reconnect to the same team still updates", async () => {
    mockStoredRow({
      workspaceType: WorkspaceType.Slack,
      workspaceProjectId: SLACK_TEAM_A,
    });

    await refresh({
      workspaceType: WorkspaceType.Slack,
      workspaceProjectId: SLACK_TEAM_A,
      miscData: slackMiscData(),
    });

    expect(updateOneById).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("WorkspaceProjectAuthTokenService.refreshAuthToken lookup", () => {
  /*
   * Without workspaceProjectId in the select, findOneBy returns a row whose
   * workspaceProjectId is undefined and every repoint sails through as an
   * update. The guard tests above already fail on behaviour if that happens
   * (the findOneBy mock honours the select); this pins the cause directly so
   * the failure is diagnosable rather than mysterious.
   */
  test("selects workspaceProjectId alongside _id so the guard can fire", async () => {
    await refresh();

    expect(findOneBy).toHaveBeenCalledTimes(1);
    const select: { _id?: boolean; workspaceProjectId?: boolean } =
      findOneBy.mock.calls[0][0].select;
    expect(select.workspaceProjectId).toBe(true);
    expect(select._id).toBe(true);
  });

  test("scopes the lookup to this project and this workspace type only", async () => {
    /*
     * A project connected to Microsoft Teams must still be able to connect
     * Slack, so the row this guard compares against has to be the row for THIS
     * workspace type — and the upsert has to key on nothing else, or a
     * reconnect from a new workspace would find no row and create a duplicate
     * instead of hitting the guard.
     */
    const projectId: ObjectID = ObjectID.generate();

    await refresh({
      projectId: projectId,
      workspaceType: WorkspaceType.Slack,
      workspaceProjectId: SLACK_TEAM_A,
      miscData: slackMiscData(),
    });

    const query: { projectId: ObjectID; workspaceType: WorkspaceType } =
      findOneBy.mock.calls[0][0].query;
    expect(query.projectId.toString()).toBe(projectId.toString());
    expect(query.workspaceType).toBe(WorkspaceType.Slack);
    expect(Object.keys(query).sort()).toEqual(["projectId", "workspaceType"]);
  });

  test("reads with root props so the connect flow is not permission-scoped", async () => {
    await refresh();

    expect(findOneBy.mock.calls[0][0].props).toEqual({ isRoot: true });
  });
});

describe("WorkspaceProjectAuthTokenService.refreshAuthToken argument validation", () => {
  test("throws when projectId is missing", async () => {
    const error: Exception = await captureError(async (): Promise<void> => {
      return await WorkspaceProjectAuthTokenService.refreshAuthToken({
        ...refreshArgs(),
        projectId: undefined as unknown as ObjectID,
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe("projectId is required");
    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("throws when workspaceType is missing", async () => {
    const error: Exception = await captureError(async (): Promise<void> => {
      return await WorkspaceProjectAuthTokenService.refreshAuthToken({
        ...refreshArgs(),
        workspaceType: undefined as unknown as WorkspaceType,
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe("workspaceType is required");
    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("throws when authToken is missing", async () => {
    const error: Exception = await captureError(async (): Promise<void> => {
      return await WorkspaceProjectAuthTokenService.refreshAuthToken({
        ...refreshArgs(),
        authToken: "",
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe("authToken is required");
    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("throws when workspaceProjectId is missing", async () => {
    const error: Exception = await captureError(async (): Promise<void> => {
      return await WorkspaceProjectAuthTokenService.refreshAuthToken({
        ...refreshArgs(),
        workspaceProjectId: "",
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe("workspaceProjectId is required");
    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("throws when miscData is missing", async () => {
    const error: Exception = await captureError(async (): Promise<void> => {
      return await WorkspaceProjectAuthTokenService.refreshAuthToken({
        ...refreshArgs(),
        miscData: undefined as unknown as WorkspaceMiscData,
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe("miscData is required");
    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("validation rejects before any write is attempted", async () => {
    await captureError(async (): Promise<void> => {
      return await WorkspaceProjectAuthTokenService.refreshAuthToken({
        ...refreshArgs(),
        authToken: "",
      });
    });

    expect(create).not.toHaveBeenCalled();
    expect(updateOneById).not.toHaveBeenCalled();
  });
});
