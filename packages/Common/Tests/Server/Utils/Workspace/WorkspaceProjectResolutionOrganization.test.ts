import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Project from "../../../../Models/DatabaseModels/Project";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import ProjectService from "../../../../Server/Services/ProjectService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import SlackRequestWorkspaceUtil from "../../../../Server/Utils/Workspace/Slack/SlackRequestWorkspace";
import WorkspaceProjectResolver, {
  WorkspaceProjectEvidence,
  WorkspaceProjectResolution,
} from "../../../../Server/Utils/Workspace/WorkspaceProjectResolution";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

jest.mock("../../../../Server/Utils/Logger");

/*
 * THE PROJECTS OF A REQUEST FROM A WORKSPACE OF A SLACK ENTERPRISE
 * ORGANIZATION (WorkspaceProjectResolver with several ids).
 *
 * A request from such a workspace can be about a project connected to the
 * workspace (stored under its T... id) or one connected to the whole
 * organization (stored under its E... id); SlackRequestWorkspace names both,
 * the installation the request is for first. The connections under each id
 * are read in turn, the first id's first, each project once - so the
 * project of the installation the request was made for comes first.
 */

const WORKSPACE_ID: string = "T0EAST";
const ORGANIZATION_ID: string = "E0ACME";

const EAST_PROJECT: ObjectID = new ObjectID(
  "e2000000-0000-4000-8000-000000000001",
);
const ORGANIZATION_PROJECT: ObjectID = new ObjectID(
  "e2000000-0000-4000-8000-000000000002",
);
const BOTH_PROJECT: ObjectID = new ObjectID(
  "e2000000-0000-4000-8000-000000000003",
);

const NAMES: Record<string, string> = {
  [EAST_PROJECT.toString()]: "East Production",
  [ORGANIZATION_PROJECT.toString()]: "Acme Everywhere",
  [BOTH_PROJECT.toString()]: "Both",
};

function connectionOf(
  projectId: ObjectID,
  workspaceProjectId: string,
  createdAt: string,
): WorkspaceProjectAuthToken {
  const connection: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  connection.id = ObjectID.generate();
  connection.projectId = projectId;
  connection.workspaceProjectId = workspaceProjectId;
  connection.workspaceType = WorkspaceType.Slack;
  connection.authToken = `xoxb-${workspaceProjectId}`;
  connection.createdAt = new Date(createdAt);
  return connection;
}

function projectIdsOf(
  connections: Array<WorkspaceProjectAuthToken>,
): Array<string> {
  return connections.map((connection: WorkspaceProjectAuthToken): string => {
    return connection.projectId!.toString();
  });
}

let connections: Array<WorkspaceProjectAuthToken>;
let connectionReads: Array<JSONObject>;
let projectReads: number;

beforeEach(() => {
  connections = [];
  connectionReads = [];
  projectReads = 0;

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findBy")
    .mockImplementation((async (findBy: JSONObject) => {
      connectionReads.push(findBy);
      const query: JSONObject = findBy["query"] as JSONObject;

      return connections
        .filter((connection: WorkspaceProjectAuthToken): boolean => {
          return (
            query["workspaceProjectId"] === connection.workspaceProjectId &&
            query["workspaceType"] === connection.workspaceType
          );
        })
        .sort((a: WorkspaceProjectAuthToken, b: WorkspaceProjectAuthToken) => {
          return a.createdAt!.getTime() - b.createdAt!.getTime();
        });
    }) as never);

  jest.spyOn(ProjectService, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
  }) => {
    projectReads++;
    const asked: string = JSON.stringify(findBy.query["_id"]).toLowerCase();

    return Object.keys(NAMES)
      .filter((id: string): boolean => {
        return asked.includes(id.toLowerCase());
      })
      .map((id: string): Project => {
        const project: Project = new Project();
        project.id = new ObjectID(id);
        project.name = NAMES[id]!;
        return project;
      });
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getConnectionIdList", () => {
  test("one id, or several - each once, in order, without the empty ones", () => {
    expect(WorkspaceProjectResolver.getConnectionIdList("T0EAST")).toEqual([
      "T0EAST",
    ]);
    expect(
      WorkspaceProjectResolver.getConnectionIdList([
        "E0ACME",
        "",
        "T0EAST",
        "E0ACME",
      ]),
    ).toEqual(["E0ACME", "T0EAST"]);
    expect(WorkspaceProjectResolver.getConnectionIdList("")).toEqual([]);
    expect(WorkspaceProjectResolver.getConnectionIdList(undefined)).toEqual([]);
    expect(
      WorkspaceProjectResolver.getConnectionIdList([
        42 as unknown as string,
        null as unknown as string,
        "T0EAST",
      ]),
    ).toEqual(["T0EAST"]);
  });
});

describe("findConnections with a workspace and its organization", () => {
  test("each id is read in turn, as OneUptime, oldest first - the first id's projects first", async () => {
    connections = [
      connectionOf(
        ORGANIZATION_PROJECT,
        ORGANIZATION_ID,
        "2026-01-01T00:00:00Z",
      ),
      connectionOf(EAST_PROJECT, WORKSPACE_ID, "2026-06-01T00:00:00Z"),
    ];

    const found: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectResolver.findConnections({
        workspaceType: WorkspaceType.Slack,
        workspaceId: [WORKSPACE_ID, ORGANIZATION_ID],
      });

    // The workspace's project first, though the organization's is older.
    expect(projectIdsOf(found)).toEqual([
      EAST_PROJECT.toString(),
      ORGANIZATION_PROJECT.toString(),
    ]);

    expect(connectionReads).toHaveLength(2);
    expect(connectionReads[0]).toMatchObject({
      query: {
        workspaceType: WorkspaceType.Slack,
        workspaceProjectId: WORKSPACE_ID,
      },
      sort: { createdAt: SortOrder.Ascending },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
    expect(connectionReads[1]).toMatchObject({
      query: {
        workspaceType: WorkspaceType.Slack,
        workspaceProjectId: ORGANIZATION_ID,
      },
    });
  });

  test("the organization's installation's request: the organization's projects first", async () => {
    connections = [
      connectionOf(EAST_PROJECT, WORKSPACE_ID, "2026-01-01T00:00:00Z"),
      connectionOf(
        ORGANIZATION_PROJECT,
        ORGANIZATION_ID,
        "2026-06-01T00:00:00Z",
      ),
    ];

    const ids: Array<string> = SlackRequestWorkspaceUtil.getConnectionIds({
      teamId: WORKSPACE_ID,
      enterpriseId: ORGANIZATION_ID,
      isEnterpriseInstall: true,
    });

    const found: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectResolver.findConnections({
        workspaceType: WorkspaceType.Slack,
        workspaceId: ids,
      });

    expect(projectIdsOf(found)).toEqual([
      ORGANIZATION_PROJECT.toString(),
      EAST_PROJECT.toString(),
    ]);
  });

  test("a project connected under both ids is one project - its first id's connection", async () => {
    const underWorkspace: WorkspaceProjectAuthToken = connectionOf(
      BOTH_PROJECT,
      WORKSPACE_ID,
      "2026-03-01T00:00:00Z",
    );
    connections = [
      connectionOf(BOTH_PROJECT, ORGANIZATION_ID, "2026-01-01T00:00:00Z"),
      underWorkspace,
    ];

    const found: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectResolver.findConnections({
        workspaceType: WorkspaceType.Slack,
        workspaceId: [WORKSPACE_ID, ORGANIZATION_ID],
      });

    expect(found).toHaveLength(1);
    expect(found[0]).toBe(underWorkspace);
  });

  test("an id given twice is read once; no ids read nothing", async () => {
    await WorkspaceProjectResolver.findConnections({
      workspaceType: WorkspaceType.Slack,
      workspaceId: [WORKSPACE_ID, WORKSPACE_ID],
    });

    expect(connectionReads).toHaveLength(1);

    connectionReads = [];

    expect(
      await WorkspaceProjectResolver.findConnections({
        workspaceType: WorkspaceType.Slack,
        workspaceId: [],
      }),
    ).toEqual([]);
    expect(
      await WorkspaceProjectResolver.findConnections({
        workspaceType: WorkspaceType.Slack,
        workspaceId: ["", ""],
      }),
    ).toEqual([]);
    expect(connectionReads).toHaveLength(0);
  });

  test("one id, as before: read once", async () => {
    connections = [
      connectionOf(EAST_PROJECT, WORKSPACE_ID, "2026-01-01T00:00:00Z"),
    ];

    expect(
      projectIdsOf(
        await WorkspaceProjectResolver.findConnections({
          workspaceType: WorkspaceType.Slack,
          workspaceId: WORKSPACE_ID,
        }),
      ),
    ).toEqual([EAST_PROJECT.toString()]);
    expect(connectionReads).toHaveLength(1);
  });
});

describe("resolve with a workspace and its organization", () => {
  test("a project connected to the whole organization is about a request from any of its workspaces", async () => {
    connections = [
      connectionOf(
        ORGANIZATION_PROJECT,
        ORGANIZATION_ID,
        "2026-01-01T00:00:00Z",
      ),
    ];

    const resolution: WorkspaceProjectResolution =
      await WorkspaceProjectResolver.resolve({
        workspaceType: WorkspaceType.Slack,
        workspaceId: SlackRequestWorkspaceUtil.getConnectionIds({
          teamId: "T0WEST",
          enterpriseId: ORGANIZATION_ID,
          isEnterpriseInstall: true,
        }),
      });

    expect(resolution.projectAuth?.projectId?.toString()).toBe(
      ORGANIZATION_PROJECT.toString(),
    );
    expect(resolution.decidedBy).toBe(WorkspaceProjectEvidence.OnlyProject);
    expect(resolution.isAmbiguous).toBe(false);
  });

  test("a project that moved from the workspace to the organization is found whichever of the two Slack names first", async () => {
    connections = [
      connectionOf(
        ORGANIZATION_PROJECT,
        ORGANIZATION_ID,
        "2026-01-01T00:00:00Z",
      ),
    ];

    for (const isEnterpriseInstall of [true, false]) {
      const resolution: WorkspaceProjectResolution =
        await WorkspaceProjectResolver.resolve({
          workspaceType: WorkspaceType.Slack,
          workspaceId: SlackRequestWorkspaceUtil.getConnectionIds({
            teamId: WORKSPACE_ID,
            enterpriseId: ORGANIZATION_ID,
            isEnterpriseInstall: isEnterpriseInstall,
          }),
        });

      expect(resolution.projectAuth?.projectId?.toString()).toBe(
        ORGANIZATION_PROJECT.toString(),
      );
    }
  });

  test("a request from a workspace of another organization finds none", async () => {
    connections = [
      connectionOf(
        ORGANIZATION_PROJECT,
        ORGANIZATION_ID,
        "2026-01-01T00:00:00Z",
      ),
    ];

    const resolution: WorkspaceProjectResolution =
      await WorkspaceProjectResolver.resolve({
        workspaceType: WorkspaceType.Slack,
        workspaceId: SlackRequestWorkspaceUtil.getConnectionIds({
          teamId: "T0OTHER",
          enterpriseId: "E0OTHER",
          isEnterpriseInstall: true,
        }),
      });

    expect(resolution.projectAuth).toBeNull();
    expect(resolution.connections).toEqual([]);
  });
});

describe("getSharedWorkspaceProjectName with a workspace and its organization", () => {
  test("two projects - one connected to the workspace, one to the organization - are told apart by name", async () => {
    connections = [
      connectionOf(EAST_PROJECT, WORKSPACE_ID, "2026-01-01T00:00:00Z"),
      connectionOf(
        ORGANIZATION_PROJECT,
        ORGANIZATION_ID,
        "2026-02-01T00:00:00Z",
      ),
    ];

    expect(
      await WorkspaceProjectResolver.getSharedWorkspaceProjectName({
        workspaceType: WorkspaceType.Slack,
        workspaceId: [WORKSPACE_ID, ORGANIZATION_ID],
        projectId: ORGANIZATION_PROJECT,
      }),
    ).toBe("Acme Everywhere");
  });

  test("one project under both ids is one project: no name to tell apart", async () => {
    connections = [
      connectionOf(BOTH_PROJECT, WORKSPACE_ID, "2026-01-01T00:00:00Z"),
      connectionOf(BOTH_PROJECT, ORGANIZATION_ID, "2026-02-01T00:00:00Z"),
    ];

    expect(
      await WorkspaceProjectResolver.getSharedWorkspaceProjectName({
        workspaceType: WorkspaceType.Slack,
        workspaceId: [WORKSPACE_ID, ORGANIZATION_ID],
        projectId: BOTH_PROJECT,
      }),
    ).toBeNull();
    expect(projectReads).toBe(0);
  });

  test("no ids: none, and nothing is read", async () => {
    expect(
      await WorkspaceProjectResolver.getSharedWorkspaceProjectName({
        workspaceType: WorkspaceType.Slack,
        workspaceId: ["", ""],
        projectId: EAST_PROJECT,
      }),
    ).toBeNull();
    expect(connectionReads).toHaveLength(0);
  });
});
