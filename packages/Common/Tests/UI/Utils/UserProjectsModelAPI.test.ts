import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import UserProjectsModelAPI, {
  UserProjectRow,
} from "../../../UI/Utils/ModelAPI/UserProjectsModelAPI";
import API from "../../../UI/Utils/API/API";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import Dictionary from "../../../Types/Dictionary";
import Query from "../../../Types/BaseDatabase/Query";
import Select from "../../../Types/BaseDatabase/Select";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * This API is what makes the Admin Dashboard's User > Projects table page over
 * PROJECTS instead of over memberships. The table itself is unchanged, so every
 * behaviour below is invisible from the component: if the response is not
 * mapped back into rows the Teams column renders empty, if `count` is not
 * carried through the pager offers pages that render empty, and if deleting a
 * row deletes one membership the row stays on screen and the delete looks like
 * it silently failed.
 *
 * The payloads here are built the way the server builds them - the model
 * serialized with BaseModel.toJSON, aggregates attached alongside - so these
 * tests also pin the wire contract between the two halves rather than a
 * hand-written idea of it.
 *
 * ModelAPI's statics are spied rather than the module being mocked, because
 * UserProjectsModelAPI extends ModelAPI and delegates to it.
 */

const USER_ID: ObjectID = new ObjectID("00000000-0000-4000-8000-000000000001");
const PROJECT_ONE_ID: string = "00000000-0000-4000-8000-0000000000a1";
const PROJECT_TWO_ID: string = "00000000-0000-4000-8000-0000000000a2";

type RowSpec = {
  id?: string | undefined;
  projectId: string;
  projectName: string;
  teams?: Array<{ id: string; name: string }> | undefined;
  hasAcceptedInvitation?: boolean | undefined;
  pendingTeamCount?: number | undefined;
  teamMemberIds?: Array<string> | undefined;
  joinedAt?: Date | undefined;
};

/*
 * The JSON one row of POST /user/:userId/projects is made of. Mirrors
 * UserAPI.serializeUserProjectMembership.
 */
const buildRowJson: (spec: RowSpec) => JSONObject = (
  spec: RowSpec,
): JSONObject => {
  const teamMember: TeamMember = new TeamMember();

  if (spec.id) {
    teamMember._id = spec.id;
  }

  teamMember.userId = USER_ID;
  teamMember.projectId = new ObjectID(spec.projectId);
  teamMember.hasAcceptedInvitation = spec.hasAcceptedInvitation ?? true;

  const project: Project = new Project();
  project._id = spec.projectId;
  project.name = spec.projectName;
  teamMember.project = project;

  if (spec.joinedAt) {
    teamMember.createdAt = spec.joinedAt;
  }

  const teams: Array<Team> = (spec.teams || []).map(
    (team: { id: string; name: string }) => {
      const teamModel: Team = new Team();
      teamModel._id = team.id;
      teamModel.name = team.name;
      return teamModel;
    },
  );

  const json: JSONObject = BaseModel.toJSON(teamMember, TeamMember);

  json["teams"] = BaseModel.toJSONArray(teams, Team) as JSONArray;
  json["teamCount"] = teams.length;
  json["pendingTeamCount"] = spec.pendingTeamCount ?? 0;
  json["teamMemberIds"] = spec.teamMemberIds || (spec.id ? [spec.id] : []);

  return json;
};

const buildListResponse: (data: {
  rows: Array<JSONObject>;
  count?: number | undefined;
  skip?: number | undefined;
  limit?: number | undefined;
}) => HTTPResponse<JSONArray> = (data: {
  rows: Array<JSONObject>;
  count?: number | undefined;
  skip?: number | undefined;
  limit?: number | undefined;
}): HTTPResponse<JSONArray> => {
  return new HTTPResponse<JSONArray>(
    200,
    {
      data: data.rows,
      count: data.count ?? data.rows.length,
      skip: data.skip ?? 0,
      limit: data.limit ?? 10,
    },
    {},
  );
};

/*
 * Hand-rolled rather than jest.SpiedFunction<typeof API.fetch>: the statics are
 * generic, and the installed jest typings cannot describe a spy on a generic
 * method without collapsing it to one instantiation.
 */
interface Spy {
  mockResolvedValue: (value: unknown) => Spy;
  mockResolvedValueOnce: (value: unknown) => Spy;
  mockImplementation: (fn: (...args: Array<unknown>) => unknown) => Spy;
  mock: { calls: Array<Array<unknown>> };
}

let fetchSpy: Spy;
let postSpy: Spy;
let getItemSpy: Spy;
let getListSpy: Spy;
let deleteItemSpy: Spy;

type FetchArgs = {
  method: unknown;
  url: { toString: () => string };
  data: Record<string, unknown>;
  headers?: Record<string, string> | undefined;
  params?: Record<string, string> | undefined;
};

const fetchCallArgs: (callIndex: number) => FetchArgs = (
  callIndex: number,
): FetchArgs => {
  return fetchSpy.mock.calls[callIndex]![0] as FetchArgs;
};

const postCallArgs: (callIndex: number) => {
  url: { toString: () => string };
  data: Record<string, unknown>;
  headers?: Record<string, string> | undefined;
} = (
  callIndex: number,
): {
  url: { toString: () => string };
  data: Record<string, unknown>;
  headers?: Record<string, string> | undefined;
} => {
  return postSpy.mock.calls[callIndex]![0] as {
    url: { toString: () => string };
    data: Record<string, unknown>;
    headers?: Record<string, string> | undefined;
  };
};

const listProjects: (data?: {
  skip?: number | undefined;
  limit?: number | undefined;
  query?: Query<TeamMember> | undefined;
}) => Promise<ListResult<TeamMember>> = async (data?: {
  skip?: number | undefined;
  limit?: number | undefined;
  query?: Query<TeamMember> | undefined;
}): Promise<ListResult<TeamMember>> => {
  return UserProjectsModelAPI.getList<TeamMember>({
    modelType: TeamMember,
    query: data?.query || ({ userId: USER_ID } as Query<TeamMember>),
    limit: data?.limit ?? 10,
    skip: data?.skip ?? 0,
    select: {} as Select<TeamMember>,
    sort: {} as never,
  });
};

beforeEach(() => {
  fetchSpy = (jest.spyOn(API, "fetch") as unknown as Spy).mockImplementation(
    async () => {
      return buildListResponse({ rows: [] });
    },
  );

  postSpy = (jest.spyOn(API, "post") as unknown as Spy).mockImplementation(
    async () => {
      return new HTTPResponse<JSONObject>(
        200,
        { numberOfMembershipsDeleted: 2 },
        {},
      );
    },
  );

  getItemSpy = jest.spyOn(ModelAPI, "getItem") as unknown as Spy;
  getListSpy = jest.spyOn(ModelAPI, "getList") as unknown as Spy;
  deleteItemSpy = (
    jest.spyOn(ModelAPI, "deleteItem") as unknown as Spy
  ).mockImplementation(async () => {
    return undefined;
  });

  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserProjectsModelAPI.getList", () => {
  it("asks the projects-of-a-user endpoint for the user in the query", async () => {
    await listProjects();

    expect(fetchSpy.mock.calls).toHaveLength(1);
    expect(fetchCallArgs(0).url.toString()).toContain(
      `/user/${USER_ID.toString()}/projects`,
    );
  });

  it("accepts the user id as a plain string too", async () => {
    await listProjects({
      query: { userId: USER_ID.toString() } as unknown as Query<TeamMember>,
    });

    expect(fetchCallArgs(0).url.toString()).toContain(
      `/user/${USER_ID.toString()}/projects`,
    );
  });

  it("refuses to list without a user rather than reporting an empty list", async () => {
    /*
     * An empty list here renders as "this user is in no projects", which is a
     * wrong answer rather than a missing one.
     */
    await expect(
      listProjects({ query: {} as Query<TeamMember> }),
    ).rejects.toThrow();

    expect(fetchSpy.mock.calls).toHaveLength(0);
  });

  it("asks the server for the page the table wants", async () => {
    await listProjects({ skip: 20, limit: 10 });

    expect(fetchCallArgs(0).params).toEqual({ skip: "20", limit: "10" });
  });

  it("sends the caller's headers, so the Admin Dashboard's tenant-less ones win", async () => {
    /*
     * A subclass overrides getCommonHeaders to send no tenant (see
     * AdminUserProjectsModelAPI), which only works if the header set is read
     * through `this` rather than off ModelAPI directly.
     */
    jest
      .spyOn(ModelAPI, "getCommonHeaders")
      .mockReturnValue({ "x-test": "from-this" });

    await listProjects();

    expect(fetchCallArgs(0).headers).toEqual({ "x-test": "from-this" });
  });

  it("hydrates each row into a TeamMember carrying its project", async () => {
    fetchSpy.mockResolvedValue(
      buildListResponse({
        rows: [
          buildRowJson({
            id: "m1",
            projectId: PROJECT_ONE_ID,
            projectName: "Acme Production",
            teams: [{ id: "t1", name: "Owners" }],
          }),
        ],
      }),
    );

    const result: ListResult<TeamMember> = await listProjects();

    const row: TeamMember = result.data[0]!;

    expect(row).toBeInstanceOf(TeamMember);
    expect(row.project).toBeInstanceOf(Project);
    expect(row.project?.name?.toString()).toBe("Acme Production");
    expect(row.projectId?.toString()).toBe(PROJECT_ONE_ID);
    expect(row._id?.toString()).toBe("m1");
  });

  it("carries every team of the project onto the row", async () => {
    fetchSpy.mockResolvedValue(
      buildListResponse({
        rows: [
          buildRowJson({
            id: "m1",
            projectId: PROJECT_ONE_ID,
            projectName: "Acme Production",
            teams: [
              { id: "t1", name: "Engineering" },
              { id: "t2", name: "Owners" },
            ],
          }),
        ],
      }),
    );

    const result: ListResult<TeamMember> = await listProjects();
    const row: UserProjectRow = result.data[0]! as UserProjectRow;

    expect(row.teamsForProject).toHaveLength(2);
    expect(row.teamsForProject[0]).toBeInstanceOf(Team);
    expect(
      row.teamsForProject.map((team: Team) => {
        return team.name?.toString();
      }),
    ).toEqual(["Engineering", "Owners"]);
    expect(row.teamCountForProject).toBe(2);
  });

  it("leaves a project with no teams as an empty list rather than undefined", async () => {
    /*
     * The Teams cell maps over this. Undefined would throw in the middle of
     * rendering the table instead of showing "no teams".
     */
    fetchSpy.mockResolvedValue(
      buildListResponse({
        rows: [
          buildRowJson({
            id: "m1",
            projectId: PROJECT_ONE_ID,
            projectName: "Acme Production",
          }),
        ],
      }),
    );

    const result: ListResult<TeamMember> = await listProjects();
    const row: UserProjectRow = result.data[0]! as UserProjectRow;

    expect(row.teamsForProject).toEqual([]);
    expect(row.teamCountForProject).toBe(0);
  });

  it("carries the pending-invitation count the Status cell reads", async () => {
    fetchSpy.mockResolvedValue(
      buildListResponse({
        rows: [
          buildRowJson({
            id: "m1",
            projectId: PROJECT_ONE_ID,
            projectName: "Acme Production",
            teams: [
              { id: "t1", name: "Owners" },
              { id: "t2", name: "Engineering" },
            ],
            hasAcceptedInvitation: true,
            pendingTeamCount: 1,
          }),
        ],
      }),
    );

    const result: ListResult<TeamMember> = await listProjects();
    const row: UserProjectRow = result.data[0]! as UserProjectRow;

    expect(row.hasAcceptedInvitation).toBe(true);
    expect(row.pendingTeamCountForProject).toBe(1);
  });

  it("reads a missing pending count as none rather than NaN", async () => {
    const rowJson: JSONObject = buildRowJson({
      id: "m1",
      projectId: PROJECT_ONE_ID,
      projectName: "Acme Production",
    });
    delete rowJson["pendingTeamCount"];

    fetchSpy.mockResolvedValue(buildListResponse({ rows: [rowJson] }));

    const result: ListResult<TeamMember> = await listProjects();

    expect((result.data[0]! as UserProjectRow).pendingTeamCountForProject).toBe(
      0,
    );
  });

  it("carries the memberships the row was folded from", async () => {
    fetchSpy.mockResolvedValue(
      buildListResponse({
        rows: [
          buildRowJson({
            id: "m1",
            projectId: PROJECT_ONE_ID,
            projectName: "Acme Production",
            teamMemberIds: ["m1", "m2", "m3"],
          }),
        ],
      }),
    );

    const result: ListResult<TeamMember> = await listProjects();

    expect((result.data[0]! as UserProjectRow).teamMemberIdsForProject).toEqual(
      ["m1", "m2", "m3"],
    );
  });

  it("reports the server's count of projects, not the number of rows on the page", async () => {
    fetchSpy.mockResolvedValue(
      buildListResponse({
        rows: [
          buildRowJson({
            id: "m1",
            projectId: PROJECT_ONE_ID,
            projectName: "Acme Production",
          }),
        ],
        count: 42,
        skip: 10,
        limit: 1,
      }),
    );

    const result: ListResult<TeamMember> = await listProjects();

    expect(result.count).toBe(42);
    expect(result.skip).toBe(10);
    expect(result.limit).toBe(1);
    expect(result.data).toHaveLength(1);
  });

  it("keeps the order the server sorted the projects into", async () => {
    fetchSpy.mockResolvedValue(
      buildListResponse({
        rows: [
          buildRowJson({
            id: "m1",
            projectId: PROJECT_ONE_ID,
            projectName: "Acme Production",
          }),
          buildRowJson({
            id: "m2",
            projectId: PROJECT_TWO_ID,
            projectName: "Acme Staging",
          }),
        ],
      }),
    );

    const result: ListResult<TeamMember> = await listProjects();

    expect(
      result.data.map((row: TeamMember) => {
        return row.project?.name?.toString();
      }),
    ).toEqual(["Acme Production", "Acme Staging"]);
  });

  it("returns nothing for a user in no project", async () => {
    const result: ListResult<TeamMember> = await listProjects();

    expect(result.data).toEqual([]);
    expect(result.count).toBe(0);
  });

  it("throws the server's error rather than an empty list", async () => {
    fetchSpy.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "boom" }, {}),
    );

    await expect(listProjects()).rejects.toBeInstanceOf(HTTPErrorResponse);
  });

  it("behaves like the plain API for a model it was not written for", async () => {
    const projects: ListResult<Project> = {
      data: [],
      count: 0,
      skip: 0,
      limit: 10,
    };

    getListSpy.mockResolvedValue(projects as never);

    const result: ListResult<Project> =
      await UserProjectsModelAPI.getList<Project>({
        modelType: Project,
        query: {} as Query<Project>,
        limit: 10,
        skip: 0,
        select: {} as Select<Project>,
        sort: {} as never,
      });

    expect(result).toBe(projects);
    expect(fetchSpy.mock.calls).toHaveLength(0);
  });
});

describe("UserProjectsModelAPI.deleteItem", () => {
  const buildRowMembership: (data: {
    id: string;
    projectId?: string | undefined;
  }) => TeamMember = (data: {
    id: string;
    projectId?: string | undefined;
  }): TeamMember => {
    const teamMember: TeamMember = new TeamMember();
    teamMember._id = data.id;
    teamMember.userId = USER_ID;

    if (data.projectId) {
      teamMember.projectId = new ObjectID(data.projectId);
    }

    return teamMember;
  };

  /*
   * Routing this through one endpoint is about atomicity, not tidiness. The
   * server refuses to remove the last accepted member of the Owners team, and
   * it refuses per request - so a DELETE-per-membership loop destroys every
   * other team first and only then reports the failure, leaving the person
   * stripped of teams the admin was just told they had not lost.
   */
  it("removes the user from the project in a single request", async () => {
    getItemSpy.mockResolvedValue(
      buildRowMembership({ id: "m1", projectId: PROJECT_ONE_ID }) as never,
    );

    await UserProjectsModelAPI.deleteItem<TeamMember>({
      modelType: TeamMember,
      id: new ObjectID("m1"),
    });

    expect(postSpy.mock.calls).toHaveLength(1);
    expect(postCallArgs(0).url.toString()).toContain(
      `/user/${USER_ID.toString()}/remove-from-project`,
    );
    expect(postCallArgs(0).data).toEqual({ projectId: PROJECT_ONE_ID });
  });

  it("never issues a delete per membership", async () => {
    getItemSpy.mockResolvedValue(
      buildRowMembership({ id: "m1", projectId: PROJECT_ONE_ID }) as never,
    );

    await UserProjectsModelAPI.deleteItem<TeamMember>({
      modelType: TeamMember,
      id: new ObjectID("m1"),
    });

    expect(deleteItemSpy.mock.calls).toHaveLength(0);
    // No sibling enumeration either - the server resolves the set itself.
    expect(getListSpy.mock.calls).toHaveLength(0);
  });

  it("resolves the user and project from the row it was handed", async () => {
    getItemSpy.mockResolvedValue(
      buildRowMembership({ id: "m1", projectId: PROJECT_ONE_ID }) as never,
    );

    await UserProjectsModelAPI.deleteItem<TeamMember>({
      modelType: TeamMember,
      id: new ObjectID("m1"),
    });

    const getItemArgs: { id: ObjectID; select: Record<string, boolean> } =
      getItemSpy.mock.calls[0]![0] as {
        id: ObjectID;
        select: Record<string, boolean>;
      };

    expect(getItemArgs.id.toString()).toBe("m1");
    expect(getItemArgs.select["userId"]).toBe(true);
    expect(getItemArgs.select["projectId"]).toBe(true);
  });

  it("throws the server's error rather than reporting a removal that did not happen", async () => {
    getItemSpy.mockResolvedValue(
      buildRowMembership({ id: "m1", projectId: PROJECT_ONE_ID }) as never,
    );
    postSpy.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        {
          message:
            "This team should have at least 1 member who has accepted the invitation.",
        },
        {},
      ),
    );

    await expect(
      UserProjectsModelAPI.deleteItem<TeamMember>({
        modelType: TeamMember,
        id: new ObjectID("m1"),
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });

  it("falls back to the single delete when the row is already gone", async () => {
    getItemSpy.mockResolvedValue(null as never);

    await UserProjectsModelAPI.deleteItem<TeamMember>({
      modelType: TeamMember,
      id: new ObjectID("m1"),
    });

    expect(postSpy.mock.calls).toHaveLength(0);
    expect(deleteItemSpy.mock.calls).toHaveLength(1);
  });

  it("falls back to the single delete rather than guessing which project to empty", async () => {
    // The membership came back without the project the row stands for.
    getItemSpy.mockResolvedValue(buildRowMembership({ id: "m1" }) as never);

    await UserProjectsModelAPI.deleteItem<TeamMember>({
      modelType: TeamMember,
      id: new ObjectID("m1"),
    });

    expect(postSpy.mock.calls).toHaveLength(0);
    expect(deleteItemSpy.mock.calls).toHaveLength(1);
  });

  it("behaves like the plain API for a model it was not written for", async () => {
    await UserProjectsModelAPI.deleteItem<Project>({
      modelType: Project,
      id: new ObjectID(PROJECT_ONE_ID),
    });

    expect(deleteItemSpy.mock.calls).toHaveLength(1);
    expect(postSpy.mock.calls).toHaveLength(0);
    expect(getItemSpy.mock.calls).toHaveLength(0);
  });
});

/*
 * AdminUserProjectsModelAPI subclasses this to send no `tenantid` header - a
 * master admin is not working inside a project. That only holds if every
 * request this class makes reads its headers through `this`; a `ModelAPI.x(...)`
 * anywhere in here silently reverts to the base headers, which is invisible
 * until a request is rejected for carrying a tenant the caller is not in.
 */
describe("UserProjectsModelAPI in a subclass that overrides its headers", () => {
  class SubclassedUserProjectsModelAPI extends UserProjectsModelAPI {
    public static override getCommonHeaders(): Dictionary<string> {
      return { "x-subclass": "yes" };
    }
  }

  it("uses the subclass's headers to list projects", async () => {
    await SubclassedUserProjectsModelAPI.getList<TeamMember>({
      modelType: TeamMember,
      query: { userId: USER_ID } as Query<TeamMember>,
      limit: 10,
      skip: 0,
      select: {} as Select<TeamMember>,
      sort: {} as never,
    });

    expect(fetchCallArgs(0).headers).toEqual({ "x-subclass": "yes" });
  });

  it("uses the subclass's headers when it falls through to the plain list", async () => {
    /*
     * The fall-through is a real code path: a table's entity filter fetches
     * its dropdown options through the table's own modelAPI.
     */
    await SubclassedUserProjectsModelAPI.getList<Project>({
      modelType: Project,
      query: {} as Query<Project>,
      limit: 10,
      skip: 0,
      select: {} as Select<Project>,
      sort: {} as never,
    });

    expect(getListSpy.mock.calls).toHaveLength(1);
    expect(fetchCallArgs(0).headers).toEqual({ "x-subclass": "yes" });
  });

  it("uses the subclass's headers to remove a user from a project", async () => {
    const membership: TeamMember = new TeamMember();
    membership._id = "m1";
    membership.userId = USER_ID;
    membership.projectId = new ObjectID(PROJECT_ONE_ID);

    getItemSpy.mockResolvedValue(membership as never);

    await SubclassedUserProjectsModelAPI.deleteItem<TeamMember>({
      modelType: TeamMember,
      id: new ObjectID("m1"),
    });

    expect(postCallArgs(0).headers).toEqual({ "x-subclass": "yes" });
  });
});
