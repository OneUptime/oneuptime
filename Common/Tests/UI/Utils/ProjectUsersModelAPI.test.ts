import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUsersModelAPI from "../../../UI/Utils/ModelAPI/ProjectUsersModelAPI";
import { ProjectUserRow } from "../../../UI/Utils/TeamMembersByUser";
import API from "../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import Select from "../../../Types/BaseDatabase/Select";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

/*
 * This API is what makes the Users table page over people instead of over
 * memberships. The table itself is unchanged, so every behaviour below is
 * invisible from the component: if the skip/limit is applied to the wrong list
 * the table pages over memberships again and duplicates come back; if `count`
 * is a membership count the pager offers pages that render empty; and if
 * deleting a row only deletes one membership the row stays on screen and the
 * delete looks like it silently failed.
 *
 * ModelAPI's statics are spied rather than the module being mocked, because
 * ProjectUsersModelAPI extends ModelAPI and delegates to it by name.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000001",
);

type MembershipSpec = {
  id: string;
  userId: string;
  userName?: string | undefined;
  teamId?: string | undefined;
  teamName?: string | undefined;
  hasAcceptedInvitation?: boolean | undefined;
  projectId?: ObjectID | undefined;
};

const buildMembership: (spec: MembershipSpec) => TeamMember = (
  spec: MembershipSpec,
): TeamMember => {
  const teamMember: TeamMember = new TeamMember();

  teamMember._id = spec.id;
  teamMember.userId = new ObjectID(spec.userId);
  teamMember.projectId = spec.projectId || PROJECT_ID;
  teamMember.hasAcceptedInvitation = spec.hasAcceptedInvitation ?? true;

  const user: User = new User();
  user._id = spec.userId;

  if (spec.userName) {
    user.name = new Name(spec.userName);
  }

  teamMember.user = user;

  if (spec.teamId) {
    teamMember.teamId = new ObjectID(spec.teamId);

    const team: Team = new Team();
    team._id = spec.teamId;
    team.name = spec.teamName || spec.teamId;
    teamMember.team = team;
  }

  return teamMember;
};

const asListResult: (
  teamMembers: Array<TeamMember>,
) => ListResult<TeamMember> = (
  teamMembers: Array<TeamMember>,
): ListResult<TeamMember> => {
  return {
    data: teamMembers,
    count: teamMembers.length,
    skip: 0,
    limit: teamMembers.length,
  };
};

type GetListArgs = {
  modelType: { new (): TeamMember };
  query: Query<TeamMember>;
  limit: number;
  skip: number;
  select: Select<TeamMember>;
  sort: Record<string, unknown>;
};

/*
 * Hand-rolled rather than jest.SpiedFunction<typeof ModelAPI.getList>: both
 * statics are generic, and the installed jest typings cannot describe a spy on
 * a generic method without collapsing it to one instantiation.
 */
interface Spy {
  mockResolvedValue: (value: unknown) => Spy;
  mockResolvedValueOnce: (value: unknown) => Spy;
  mockImplementation: (fn: (...args: Array<unknown>) => unknown) => Spy;
  mock: { calls: Array<Array<unknown>> };
}

let getListSpy: Spy;
let getItemSpy: Spy;
let deleteItemSpy: Spy;
let postSpy: Spy;

const getListCallArgs: (callIndex: number) => GetListArgs = (
  callIndex: number,
): GetListArgs => {
  return getListSpy.mock.calls[callIndex]![0] as GetListArgs;
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

beforeEach(() => {
  getListSpy = jest.spyOn(ModelAPI, "getList") as unknown as Spy;
  getItemSpy = jest.spyOn(ModelAPI, "getItem") as unknown as Spy;
  deleteItemSpy = (
    jest.spyOn(ModelAPI, "deleteItem") as unknown as Spy
  ).mockImplementation(async () => {
    return undefined;
  });
  postSpy = (jest.spyOn(API, "post") as unknown as Spy).mockImplementation(
    async () => {
      return new HTTPResponse<JSONObject>(
        200,
        { numberOfMembershipsDeleted: 3 },
        {},
      );
    },
  );
  jest
    .spyOn(ModelAPI, "getCommonHeaders")
    .mockReturnValue({ tenantid: PROJECT_ID.toString() });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProjectUsersModelAPI.getList", () => {
  const listUsers: (data: {
    skip?: number | undefined;
    limit?: number | undefined;
    query?: Query<TeamMember> | undefined;
    sort?: Record<string, unknown> | undefined;
    select?: Select<TeamMember> | undefined;
  }) => Promise<ListResult<TeamMember>> = async (data: {
    skip?: number | undefined;
    limit?: number | undefined;
    query?: Query<TeamMember> | undefined;
    sort?: Record<string, unknown> | undefined;
    select?: Select<TeamMember> | undefined;
  }): Promise<ListResult<TeamMember>> => {
    return ProjectUsersModelAPI.getList<TeamMember>({
      modelType: TeamMember,
      query: data.query || ({ projectId: PROJECT_ID } as Query<TeamMember>),
      limit: data.limit ?? 10,
      skip: data.skip ?? 0,
      select: data.select || ({} as Select<TeamMember>),
      sort: (data.sort || {}) as never,
    });
  };

  it("returns one row per user and counts people, not memberships", async () => {
    getListSpy.mockResolvedValue(
      asListResult([
        buildMembership({
          id: "m1",
          userId: "u1",
          userName: "Thomas Stock",
          teamId: "t1",
          teamName: "NTW_Online Operations",
        }),
        buildMembership({
          id: "m2",
          userId: "u1",
          userName: "Thomas Stock",
          teamId: "t2",
          teamName: "Owners",
        }),
        buildMembership({
          id: "m3",
          userId: "u2",
          userName: "Jason Apel",
          teamId: "t2",
          teamName: "Owners",
        }),
      ]) as never,
    );

    const result: ListResult<TeamMember> = await listUsers({});

    expect(result.count).toBe(2);
    expect(result.data).toHaveLength(2);
    expect(
      (result.data as Array<ProjectUserRow>).map((row: ProjectUserRow) => {
        return row.teamsForUser.map((team: Team) => {
          return team.name?.toString();
        });
      }),
    ).toEqual([["Owners"], ["NTW_Online Operations", "Owners"]]);
  });

  it("reads the whole membership list once, not one page of it", async () => {
    getListSpy.mockResolvedValue(asListResult([]) as never);

    await listUsers({ skip: 20, limit: 10 });

    expect(getListCallArgs(0).skip).toBe(0);
    expect(getListCallArgs(0).limit).toBeGreaterThan(10);
  });

  it("applies skip and limit to the users, so a page boundary never splits a person", async () => {
    getListSpy.mockResolvedValue(
      asListResult([
        buildMembership({
          id: "m1",
          userId: "u1",
          userName: "A",
          teamId: "t1",
        }),
        buildMembership({
          id: "m2",
          userId: "u1",
          userName: "A",
          teamId: "t2",
        }),
        buildMembership({
          id: "m3",
          userId: "u2",
          userName: "B",
          teamId: "t1",
        }),
        buildMembership({
          id: "m4",
          userId: "u3",
          userName: "C",
          teamId: "t1",
        }),
        buildMembership({
          id: "m5",
          userId: "u4",
          userName: "D",
          teamId: "t1",
        }),
      ]) as never,
    );

    const firstPage: ListResult<TeamMember> = await listUsers({
      skip: 0,
      limit: 2,
    });
    const secondPage: ListResult<TeamMember> = await listUsers({
      skip: 2,
      limit: 2,
    });

    expect(firstPage.count).toBe(4);
    expect(
      firstPage.data.map((row: TeamMember) => {
        return row.userId?.toString();
      }),
    ).toEqual(["u1", "u2"]);
    expect(
      secondPage.data.map((row: TeamMember) => {
        return row.userId?.toString();
      }),
    ).toEqual(["u3", "u4"]);
    expect(secondPage.skip).toBe(2);
    expect(secondPage.limit).toBe(2);
  });

  it("returns an empty page past the end rather than wrapping around", async () => {
    getListSpy.mockResolvedValue(
      asListResult([
        buildMembership({ id: "m1", userId: "u1", teamId: "t1" }),
      ]) as never,
    );

    const result: ListResult<TeamMember> = await listUsers({
      skip: 50,
      limit: 10,
    });

    expect(result.data).toEqual([]);
    expect(result.count).toBe(1);
  });

  it("asks for the fields grouping needs on top of the ones the columns asked for", async () => {
    getListSpy.mockResolvedValue(asListResult([]) as never);

    await listUsers({
      select: {
        user: { name: true, profilePictureId: true },
        team: { name: true },
      } as Select<TeamMember>,
    });

    const select: Record<string, unknown> = getListCallArgs(0)
      .select as unknown as Record<string, unknown>;

    expect(select["userId"]).toBe(true);
    expect(select["teamId"]).toBe(true);
    expect(select["hasAcceptedInvitation"]).toBe(true);
    // The columns' own fields survive.
    expect(select["user"]).toEqual({
      name: true,
      profilePictureId: true,
      _id: true,
    });
    expect(select["team"]).toEqual({ name: true, _id: true });
  });

  it("sorts users by name when the table has no sort of its own", async () => {
    getListSpy.mockResolvedValue(
      asListResult([
        buildMembership({ id: "m1", userId: "u1", userName: "Zoe Baker" }),
        buildMembership({ id: "m2", userId: "u2", userName: "aaron Falzon" }),
      ]) as never,
    );

    const result: ListResult<TeamMember> = await listUsers({ sort: {} });

    expect(
      result.data.map((row: TeamMember) => {
        return row.user?.name?.toString();
      }),
    ).toEqual(["aaron Falzon", "Zoe Baker"]);
  });

  it("keeps the server's order when the table asked for a sort", async () => {
    getListSpy.mockResolvedValue(
      asListResult([
        buildMembership({ id: "m1", userId: "u1", userName: "Zoe Baker" }),
        buildMembership({ id: "m2", userId: "u2", userName: "aaron Falzon" }),
      ]) as never,
    );

    const result: ListResult<TeamMember> = await listUsers({
      sort: { createdAt: "DESC" },
    });

    expect(
      result.data.map((row: TeamMember) => {
        return row.user?.name?.toString();
      }),
    ).toEqual(["Zoe Baker", "aaron Falzon"]);
  });

  it("does not re-read teams when nothing is filtering the table", async () => {
    getListSpy.mockResolvedValue(
      asListResult([
        buildMembership({ id: "m1", userId: "u1", teamId: "t1" }),
      ]) as never,
    );

    await listUsers({ query: { projectId: PROJECT_ID } as Query<TeamMember> });

    expect(getListSpy).toHaveBeenCalledTimes(1);
  });

  it("shows every team a user is on even when the table is filtered to one team", async () => {
    const teamFilteredMemberships: ListResult<TeamMember> = asListResult([
      buildMembership({
        id: "m1",
        userId: "u1",
        userName: "Thomas Stock",
        teamId: "t1",
        teamName: "NTW_Online Operations",
      }),
    ]);

    const allMembershipsOfThoseUsers: ListResult<TeamMember> = asListResult([
      buildMembership({
        id: "m1",
        userId: "u1",
        teamId: "t1",
        teamName: "NTW_Online Operations",
      }),
      buildMembership({
        id: "m2",
        userId: "u1",
        teamId: "t2",
        teamName: "Owners",
      }),
    ]);

    getListSpy
      .mockResolvedValueOnce(teamFilteredMemberships as never)
      .mockResolvedValueOnce(allMembershipsOfThoseUsers as never);

    const result: ListResult<TeamMember> = await listUsers({
      query: {
        projectId: PROJECT_ID,
        teamId: new ObjectID("t1"),
      } as unknown as Query<TeamMember>,
    });

    expect(getListSpy).toHaveBeenCalledTimes(2);

    const refetchQuery: Record<string, unknown> = getListCallArgs(1)
      .query as unknown as Record<string, unknown>;

    expect(refetchQuery["projectId"]).toEqual(PROJECT_ID);
    expect(refetchQuery["userId"]).toBeInstanceOf(Includes);
    expect((refetchQuery["userId"] as Includes).values.map(String)).toEqual([
      "u1",
    ]);
    // The team filter itself must not be carried into the re-read.
    expect(refetchQuery["teamId"]).toBeUndefined();

    expect(
      (result.data[0] as ProjectUserRow).teamsForUser.map((team: Team) => {
        return team.name?.toString();
      }),
    ).toEqual(["NTW_Online Operations", "Owners"]);
  });

  it("only re-reads teams for the users on the current page", async () => {
    getListSpy
      .mockResolvedValueOnce(
        asListResult([
          buildMembership({ id: "m1", userId: "u1", userName: "A" }),
          buildMembership({ id: "m2", userId: "u2", userName: "B" }),
          buildMembership({ id: "m3", userId: "u3", userName: "C" }),
        ]) as never,
      )
      .mockResolvedValueOnce(asListResult([]) as never);

    await listUsers({
      skip: 0,
      limit: 1,
      query: {
        projectId: PROJECT_ID,
        hasAcceptedInvitation: true,
      } as unknown as Query<TeamMember>,
    });

    const refetchQuery: Record<string, unknown> = getListCallArgs(1)
      .query as unknown as Record<string, unknown>;

    expect((refetchQuery["userId"] as Includes).values.map(String)).toEqual([
      "u1",
    ]);
  });

  it("skips the re-read when a filtered page came back empty", async () => {
    getListSpy.mockResolvedValue(asListResult([]) as never);

    await listUsers({
      query: {
        projectId: PROJECT_ID,
        hasAcceptedInvitation: true,
      } as unknown as Query<TeamMember>,
    });

    expect(getListSpy).toHaveBeenCalledTimes(1);
  });

  it("hands other models straight to the plain API", async () => {
    const projects: ListResult<Project> = {
      data: [],
      count: 0,
      skip: 0,
      limit: 10,
    };

    getListSpy.mockResolvedValue(projects as never);

    const result: ListResult<Project> =
      await ProjectUsersModelAPI.getList<Project>({
        modelType: Project,
        query: {} as Query<Project>,
        limit: 10,
        skip: 0,
        select: {} as Select<Project>,
        sort: {} as never,
      });

    expect(result).toBe(projects);
    expect(getListSpy).toHaveBeenCalledTimes(1);
    expect(getListCallArgs(0).limit).toBe(10);
  });
});

describe("ProjectUsersModelAPI.deleteItem", () => {
  /*
   * The whole point of routing this through one endpoint is atomicity. The
   * server refuses to remove the last accepted member of the Owners team, and
   * it refuses per request - so a DELETE-per-membership loop destroys every
   * other team first and only then reports the failure, leaving the person
   * stripped of teams the admin was just told they had not lost. These tests
   * pin "one request, and never a per-membership fan-out".
   */
  it("removes the user from the project in a single request", async () => {
    getItemSpy.mockResolvedValue(
      buildMembership({ id: "m1", userId: "u1", teamId: "t1" }) as never,
    );

    await ProjectUsersModelAPI.deleteItem<TeamMember>({
      modelType: TeamMember,
      id: new ObjectID("m1"),
    });

    expect(postSpy.mock.calls).toHaveLength(1);
    expect(postCallArgs(0).url.toString()).toContain(
      "/team-member/remove-user-from-project",
    );
    expect(postCallArgs(0).data).toEqual({ userId: "u1" });
  });

  it("never issues a delete per membership", async () => {
    getItemSpy.mockResolvedValue(
      buildMembership({ id: "m1", userId: "u1", teamId: "t1" }) as never,
    );

    await ProjectUsersModelAPI.deleteItem<TeamMember>({
      modelType: TeamMember,
      id: new ObjectID("m1"),
    });

    expect(deleteItemSpy.mock.calls).toHaveLength(0);
    // No sibling enumeration either - the server resolves the set itself.
    expect(getListSpy.mock.calls).toHaveLength(0);
  });

  it("resolves the person from the row it was handed", async () => {
    getItemSpy.mockResolvedValue(
      buildMembership({ id: "m1", userId: "u1", teamId: "t1" }) as never,
    );

    await ProjectUsersModelAPI.deleteItem<TeamMember>({
      modelType: TeamMember,
      id: new ObjectID("m1"),
    });

    const lookup: { id: ObjectID; select: Record<string, unknown> } = getItemSpy
      .mock.calls[0]![0] as { id: ObjectID; select: Record<string, unknown> };

    expect(lookup.id.toString()).toBe("m1");
    expect(lookup.select["userId"]).toBe(true);
  });

  it("sends the tenant headers so the server scopes the removal to this project", async () => {
    getItemSpy.mockResolvedValue(
      buildMembership({ id: "m1", userId: "u1", teamId: "t1" }) as never,
    );

    await ProjectUsersModelAPI.deleteItem<TeamMember>({
      modelType: TeamMember,
      id: new ObjectID("m1"),
    });

    expect(postCallArgs(0).headers).toEqual({
      tenantid: PROJECT_ID.toString(),
    });
  });

  it("throws when the server rejects the removal, so the table reports the failure", async () => {
    getItemSpy.mockResolvedValue(
      buildMembership({ id: "m1", userId: "u1", teamId: "t1" }) as never,
    );

    const rejection: HTTPErrorResponse = new HTTPErrorResponse(
      400,
      {
        message:
          "This team should have at least 1 member who has accepted the invitation.",
      },
      {},
    );

    postSpy.mockImplementation(async () => {
      return rejection;
    });

    await expect(
      ProjectUsersModelAPI.deleteItem<TeamMember>({
        modelType: TeamMember,
        id: new ObjectID("m1"),
      }),
    ).rejects.toBe(rejection);

    // Nothing was removed on the way to the rejection.
    expect(deleteItemSpy.mock.calls).toHaveLength(0);
  });

  it("falls back to deleting just the row when its user cannot be resolved", async () => {
    getItemSpy.mockResolvedValue(null as never);

    await ProjectUsersModelAPI.deleteItem<TeamMember>({
      modelType: TeamMember,
      id: new ObjectID("m1"),
    });

    expect(postSpy.mock.calls).toHaveLength(0);
    expect(deleteItemSpy.mock.calls).toHaveLength(1);
    expect(
      (deleteItemSpy.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe("m1");
  });

  it("hands other models straight to the plain API", async () => {
    await ProjectUsersModelAPI.deleteItem<Project>({
      modelType: Project,
      id: new ObjectID("p1"),
    });

    expect(getItemSpy.mock.calls).toHaveLength(0);
    expect(postSpy.mock.calls).toHaveLength(0);
    expect(deleteItemSpy.mock.calls).toHaveLength(1);
  });
});

describe("ProjectUsersModelAPI.getList reading past the page cap", () => {
  const buildMemberships: (
    count: number,
    fromIndex: number,
  ) => Array<TeamMember> = (
    count: number,
    fromIndex: number,
  ): Array<TeamMember> => {
    const memberships: Array<TeamMember> = [];

    for (let i: number = 0; i < count; i++) {
      const index: number = fromIndex + i;
      memberships.push(
        buildMembership({
          id: `m${index}`,
          userId: `u${index}`,
          userName: `User ${String(index).padStart(6, "0")}`,
          teamId: "t1",
        }),
      );
    }

    return memberships;
  };

  it("stops after one request when the first page is short", async () => {
    getListSpy.mockResolvedValue(asListResult(buildMemberships(3, 0)) as never);

    const result: ListResult<TeamMember> =
      await ProjectUsersModelAPI.getList<TeamMember>({
        modelType: TeamMember,
        query: { projectId: PROJECT_ID } as Query<TeamMember>,
        limit: 10,
        skip: 0,
        select: {} as Select<TeamMember>,
        sort: {} as never,
      });

    expect(getListSpy.mock.calls).toHaveLength(1);
    expect(result.count).toBe(3);
  });

  /*
   * A full page is indistinguishable from a truncated one. Stopping there
   * would drop every user beyond the cap from the list AND report the
   * truncated total as the number of people in the project, with nothing on
   * screen saying so.
   */
  it("keeps reading while pages come back full, and counts everyone", async () => {
    getListSpy
      .mockResolvedValueOnce(
        asListResult(buildMemberships(LIMIT_PER_PROJECT, 0)) as never,
      )
      .mockResolvedValueOnce(
        asListResult(buildMemberships(5, LIMIT_PER_PROJECT)) as never,
      );

    const result: ListResult<TeamMember> =
      await ProjectUsersModelAPI.getList<TeamMember>({
        modelType: TeamMember,
        query: { projectId: PROJECT_ID } as Query<TeamMember>,
        limit: 10,
        skip: 0,
        select: {} as Select<TeamMember>,
        sort: {} as never,
      });

    expect(getListSpy.mock.calls).toHaveLength(2);
    expect(getListCallArgs(0).skip).toBe(0);
    expect(getListCallArgs(1).skip).toBe(LIMIT_PER_PROJECT);
    expect(result.count).toBe(LIMIT_PER_PROJECT + 5);
  });

  it("gives up rather than looping forever if pages never get shorter", async () => {
    getListSpy.mockResolvedValue(
      asListResult(buildMemberships(LIMIT_PER_PROJECT, 0)) as never,
    );

    await ProjectUsersModelAPI.getList<TeamMember>({
      modelType: TeamMember,
      query: { projectId: PROJECT_ID } as Query<TeamMember>,
      limit: 10,
      skip: 0,
      select: {} as Select<TeamMember>,
      sort: {} as never,
    });

    expect(getListSpy.mock.calls.length).toBeLessThanOrEqual(10);
    expect(getListSpy.mock.calls.length).toBeGreaterThan(1);
  });
});
