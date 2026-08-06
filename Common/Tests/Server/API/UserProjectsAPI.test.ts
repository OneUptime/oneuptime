import CommonAPI from "../../../Server/API/CommonAPI";
import UserAPI from "../../../Server/API/UserAPI";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DEFAULT_LIMIT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * The two master-admin endpoints behind the Admin Dashboard's
 * User > Projects page.
 *
 * POST /user/:userId/projects exists because no CRUD list answers "which
 * projects is this person in?": /team-member/get-list returns MEMBERSHIPS, so a
 * user on three teams of one project comes back as three rows and pages as
 * three. The grouping, the page window applied to the GROUPED list, and the
 * count being a number of projects are the whole point, and all three fail
 * silently — the table just shows duplicate projects, or offers pages that
 * render empty.
 *
 * POST /user/:userId/remove-from-project is the master-admin twin of
 * /team-member/remove-user-from-project. That one takes its project from the
 * request's tenant; a master admin sends no tenant, so this one is told the
 * project. What must not change is the rest: ONE deleteBy over the whole set
 * (so the Owners-team guard runs before anything is deleted) with the caller's
 * own props rather than root.
 *
 * Both are guarded by the master-admin middleware, which is the only thing
 * standing between "list one user's projects" and "read across every tenant on
 * the instance". That the routes carry it is asserted directly, because
 * nothing else in these tests would notice its absence.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    sendFileByPath: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const PROJECTS_ROUTE: string = "/user/:userId/projects";
const REMOVE_ROUTE: string = "/user/:userId/remove-from-project";

const USER_ID: string = "00000000-0000-4000-8000-000000000001";
const PROJECT_ONE_ID: string = "00000000-0000-4000-8000-0000000000a1";
const PROJECT_TWO_ID: string = "00000000-0000-4000-8000-0000000000a2";

type MembershipSpec = {
  id: string;
  projectId: string;
  projectName: string;
  teamId?: string | undefined;
  teamName?: string | undefined;
  hasAcceptedInvitation?: boolean | undefined;
  createdAt?: Date | undefined;
};

function buildMembership(spec: MembershipSpec): TeamMember {
  const teamMember: TeamMember = new TeamMember();

  teamMember._id = spec.id;
  teamMember.projectId = new ObjectID(spec.projectId);
  teamMember.hasAcceptedInvitation = spec.hasAcceptedInvitation ?? true;

  const project: Project = new Project();
  project._id = spec.projectId;
  project.name = spec.projectName;
  teamMember.project = project;

  if (spec.teamId) {
    teamMember.teamId = new ObjectID(spec.teamId);

    const team: Team = new Team();
    team._id = spec.teamId;
    team.name = spec.teamName || spec.teamId;
    teamMember.team = team;
  }

  if (spec.createdAt) {
    teamMember.createdAt = spec.createdAt;
  }

  return teamMember;
}

type RouteCallResult = {
  thrownToNext: unknown;
  nextCallCount: number;
};

async function callRoute(data: {
  route: string;
  params?: Dictionary<string> | undefined;
  query?: Dictionary<string> | undefined;
  body?: Dictionary<unknown> | undefined;
}): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: data.params || {},
    query: data.query || {},
    body: data.body || {},
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("POST", data.route)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

function sentRows(): Array<JSONObject> {
  const call: Array<unknown> | undefined = (
    Response.sendJsonArrayResponse as unknown as {
      mock: { calls: Array<Array<unknown>> };
    }
  ).mock.calls[0];

  return (call?.[2] as Array<JSONObject>) || [];
}

function sentCount(): number {
  const call: Array<unknown> | undefined = (
    Response.sendJsonArrayResponse as unknown as {
      mock: { mock: never; calls: Array<Array<unknown>> };
    }
  ).mock.calls[0];

  return (call?.[3] as PositiveNumber)?.toNumber();
}

function projectNamesSent(): Array<string> {
  return sentRows().map((row: JSONObject) => {
    return ((row["project"] as JSONObject)?.["name"] as string) || "";
  });
}

describe("POST /user/:userId/projects", () => {
  let findBySpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    findBySpy = jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the route is registered", () => {
    expect(() => {
      return mockRouter.match("POST", PROJECTS_ROUTE);
    }).not.toThrow();
  });

  test("only a master admin can reach it", () => {
    expect(mockRouter.match("POST", PROJECTS_ROUTE).middleware).toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    );
  });

  test("reads only the memberships of the user in the path", async () => {
    await callRoute({
      route: PROJECTS_ROUTE,
      params: { userId: USER_ID },
    });

    expect(findBySpy).toHaveBeenCalledTimes(1);

    const findBy: { query: Dictionary<unknown> } = findBySpy.mock
      .calls[0]![0] as { query: Dictionary<unknown> };

    expect((findBy.query["userId"] as ObjectID).toString()).toBe(USER_ID);
    // Nothing else narrows it — every project the user is in is in scope.
    expect(Object.keys(findBy.query)).toEqual(["userId"]);
  });

  test("selects the project and team each membership belongs to", async () => {
    /*
     * A row is a project carrying its teams. Drop either relation from the
     * select and the response still has the right SHAPE — just with a blank
     * project name and no teams.
     */
    await callRoute({
      route: PROJECTS_ROUTE,
      params: { userId: USER_ID },
    });

    const select: Dictionary<unknown> = (
      findBySpy.mock.calls[0]![0] as { select: Dictionary<unknown> }
    ).select;

    expect(select["project"]).toEqual(
      expect.objectContaining({ _id: true, name: true }),
    );
    expect(select["team"]).toEqual(
      expect.objectContaining({ _id: true, name: true }),
    );
    expect(select["hasAcceptedInvitation"]).toBe(true);
  });

  test("returns one row per project, not one per membership", async () => {
    findBySpy.mockResolvedValue([
      buildMembership({
        id: "m1",
        projectId: PROJECT_ONE_ID,
        projectName: "Acme Production",
        teamId: "team-owners",
        teamName: "Owners",
      }),
      buildMembership({
        id: "m2",
        projectId: PROJECT_ONE_ID,
        projectName: "Acme Production",
        teamId: "team-eng",
        teamName: "Engineering",
      }),
      buildMembership({
        id: "m3",
        projectId: PROJECT_TWO_ID,
        projectName: "Acme Staging",
        teamId: "team-eng-staging",
        teamName: "Engineering",
      }),
    ]);

    await callRoute({
      route: PROJECTS_ROUTE,
      params: { userId: USER_ID },
    });

    expect(projectNamesSent()).toEqual(["Acme Production", "Acme Staging"]);
  });

  test("counts projects, not memberships", async () => {
    /*
     * The pager divides this by the page size. A membership count would offer
     * pages that render empty.
     */
    findBySpy.mockResolvedValue([
      buildMembership({
        id: "m1",
        projectId: PROJECT_ONE_ID,
        projectName: "Acme Production",
        teamId: "t1",
      }),
      buildMembership({
        id: "m2",
        projectId: PROJECT_ONE_ID,
        projectName: "Acme Production",
        teamId: "t2",
      }),
      buildMembership({
        id: "m3",
        projectId: PROJECT_ONE_ID,
        projectName: "Acme Production",
        teamId: "t3",
      }),
    ]);

    await callRoute({
      route: PROJECTS_ROUTE,
      params: { userId: USER_ID },
    });

    expect(sentCount()).toBe(1);
  });

  test("carries every team of the project on its row", async () => {
    findBySpy.mockResolvedValue([
      buildMembership({
        id: "m1",
        projectId: PROJECT_ONE_ID,
        projectName: "Acme Production",
        teamId: "team-owners",
        teamName: "Owners",
      }),
      buildMembership({
        id: "m2",
        projectId: PROJECT_ONE_ID,
        projectName: "Acme Production",
        teamId: "team-eng",
        teamName: "Engineering",
      }),
    ]);

    await callRoute({
      route: PROJECTS_ROUTE,
      params: { userId: USER_ID },
    });

    const row: JSONObject = sentRows()[0]!;

    expect(
      (row["teams"] as Array<JSONObject>).map((team: JSONObject) => {
        return team["name"];
      }),
    ).toEqual(["Engineering", "Owners"]);
    expect(row["teamCount"]).toBe(2);
    expect(row["teamMemberIds"]).toEqual(["m1", "m2"]);
  });

  test("reports the user the row belongs to", async () => {
    findBySpy.mockResolvedValue([
      buildMembership({
        id: "m1",
        projectId: PROJECT_ONE_ID,
        projectName: "Acme Production",
        teamId: "t1",
      }),
    ]);

    await callRoute({
      route: PROJECTS_ROUTE,
      params: { userId: USER_ID },
    });

    expect(JSON.stringify(sentRows()[0]!["userId"])).toContain(USER_ID);
  });

  test("reports a user with one accepted team as a member, with the rest pending", async () => {
    findBySpy.mockResolvedValue([
      buildMembership({
        id: "m1",
        projectId: PROJECT_ONE_ID,
        projectName: "Acme Production",
        teamId: "t1",
        hasAcceptedInvitation: true,
      }),
      buildMembership({
        id: "m2",
        projectId: PROJECT_ONE_ID,
        projectName: "Acme Production",
        teamId: "t2",
        hasAcceptedInvitation: false,
      }),
    ]);

    await callRoute({
      route: PROJECTS_ROUTE,
      params: { userId: USER_ID },
    });

    expect(sentRows()[0]!["hasAcceptedInvitation"]).toBe(true);
    expect(sentRows()[0]!["pendingTeamCount"]).toBe(1);
  });

  test("sorts the projects by name", async () => {
    findBySpy.mockResolvedValue([
      buildMembership({
        id: "m1",
        projectId: PROJECT_TWO_ID,
        projectName: "zebra corp",
        teamId: "t1",
      }),
      buildMembership({
        id: "m2",
        projectId: PROJECT_ONE_ID,
        projectName: "Acme Production",
        teamId: "t2",
      }),
    ]);

    await callRoute({
      route: PROJECTS_ROUTE,
      params: { userId: USER_ID },
    });

    expect(projectNamesSent()).toEqual(["Acme Production", "zebra corp"]);
  });

  test("returns an empty list for a user in no project", async () => {
    await callRoute({
      route: PROJECTS_ROUTE,
      params: { userId: USER_ID },
    });

    expect(sentRows()).toEqual([]);
    expect(sentCount()).toBe(0);
  });
});

describe("POST /user/:userId/projects — paging", () => {
  let findBySpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    /*
     * Five projects, one membership each, deliberately out of alphabetical
     * order so a page window applied before the sort would be visible.
     */
    findBySpy = jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([
      buildMembership({
        id: "m5",
        projectId: "00000000-0000-4000-8000-0000000000e5",
        projectName: "Echo",
        teamId: "t5",
      }),
      buildMembership({
        id: "m3",
        projectId: "00000000-0000-4000-8000-0000000000e3",
        projectName: "Charlie",
        teamId: "t3",
      }),
      buildMembership({
        id: "m1",
        projectId: "00000000-0000-4000-8000-0000000000e1",
        projectName: "Alpha",
        teamId: "t1",
      }),
      buildMembership({
        id: "m4",
        projectId: "00000000-0000-4000-8000-0000000000e4",
        projectName: "Delta",
        teamId: "t4",
      }),
      buildMembership({
        id: "m2",
        projectId: "00000000-0000-4000-8000-0000000000e2",
        projectName: "Bravo",
        teamId: "t2",
      }),
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns the requested page of projects", async () => {
    await callRoute({
      route: PROJECTS_ROUTE,
      params: { userId: USER_ID },
      query: { skip: "2", limit: "2" },
    });

    expect(projectNamesSent()).toEqual(["Charlie", "Delta"]);
  });

  test("reports the total across every page, not the page size", async () => {
    await callRoute({
      route: PROJECTS_ROUTE,
      params: { userId: USER_ID },
      query: { skip: "0", limit: "2" },
    });

    expect(sentCount()).toBe(5);
  });

  test("returns an empty page past the end rather than wrapping", async () => {
    await callRoute({
      route: PROJECTS_ROUTE,
      params: { userId: USER_ID },
      query: { skip: "10", limit: "2" },
    });

    expect(sentRows()).toEqual([]);
    expect(sentCount()).toBe(5);
  });

  test("pages the grouped list, so a page boundary never splits a project", async () => {
    /*
     * Two projects, four memberships. Asking for one project must return one
     * project with both its teams — not one of its memberships.
     */
    findBySpy.mockResolvedValue([
      buildMembership({
        id: "m1",
        projectId: PROJECT_ONE_ID,
        projectName: "Acme Production",
        teamId: "t1",
        teamName: "Owners",
      }),
      buildMembership({
        id: "m2",
        projectId: PROJECT_ONE_ID,
        projectName: "Acme Production",
        teamId: "t2",
        teamName: "Engineering",
      }),
      buildMembership({
        id: "m3",
        projectId: PROJECT_TWO_ID,
        projectName: "Acme Staging",
        teamId: "t3",
        teamName: "Owners",
      }),
      buildMembership({
        id: "m4",
        projectId: PROJECT_TWO_ID,
        projectName: "Acme Staging",
        teamId: "t4",
        teamName: "Engineering",
      }),
    ]);

    await callRoute({
      route: PROJECTS_ROUTE,
      params: { userId: USER_ID },
      query: { skip: "0", limit: "1" },
    });

    expect(projectNamesSent()).toEqual(["Acme Production"]);
    expect(sentRows()[0]!["teamCount"]).toBe(2);
    expect(sentCount()).toBe(2);
  });

  test("falls back to a default page rather than returning everything when paging is unparseable", async () => {
    /*
     * A NaN skip/limit turns Array.slice into "from 0 to the end", which is
     * the failure that matters: it silently ignores paging and ships every
     * project the user is in to a caller that asked for a page. The dataset is
     * deliberately larger than DEFAULT_LIMIT so "a default page" and
     * "everything" are distinguishable.
     */
    findBySpy.mockResolvedValue(
      Array.from(
        { length: DEFAULT_LIMIT + 4 },
        (_unused: unknown, index: number) => {
          return buildMembership({
            id: `m${index}`,
            projectId: `00000000-0000-4000-8000-0000000001${(index + 10).toString()}`,
            // Zero-padded so alphabetical order is numerical order.
            projectName: `Project ${(index + 1).toString().padStart(2, "0")}`,
            teamId: `t${index}`,
          });
        },
      ),
    );

    await callRoute({
      route: PROJECTS_ROUTE,
      params: { userId: USER_ID },
      query: { skip: "not-a-number", limit: "-3" },
    });

    expect(sentRows()).toHaveLength(DEFAULT_LIMIT);
    expect(projectNamesSent()[0]).toBe("Project 01");
    // The total still reports every project, so the caller can page on.
    expect(sentCount()).toBe(DEFAULT_LIMIT + 4);
  });

  test("treats an absent skip and limit the same way", async () => {
    await callRoute({
      route: PROJECTS_ROUTE,
      params: { userId: USER_ID },
    });

    // Fewer projects than DEFAULT_LIMIT here, so the whole list is one page.
    expect(projectNamesSent()).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
      "Delta",
      "Echo",
    ]);
    expect(sentCount()).toBe(5);
  });
});

describe("POST /user/:userId/projects — bad input", () => {
  let findBySpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    findBySpy = jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("rejects a missing user id without reading anything", async () => {
    const result: RouteCallResult = await callRoute({
      route: PROJECTS_ROUTE,
      params: {},
    });

    expect(findBySpy).not.toHaveBeenCalled();
    expect(result.nextCallCount).toBe(1);
  });

  test("rejects a user id that is not a uuid without reading anything", async () => {
    const result: RouteCallResult = await callRoute({
      route: PROJECTS_ROUTE,
      params: { userId: "'; DROP TABLE TeamMember; --" },
    });

    expect(findBySpy).not.toHaveBeenCalled();
    expect(result.nextCallCount).toBe(1);
  });

  test("passes a read failure on rather than reporting an empty list", async () => {
    const readError: Error = new Error("connection terminated");
    findBySpy.mockRejectedValue(readError);

    const result: RouteCallResult = await callRoute({
      route: PROJECTS_ROUTE,
      params: { userId: USER_ID },
    });

    expect(result.thrownToNext).toBe(readError);
    expect(Response.sendJsonArrayResponse).not.toHaveBeenCalled();
  });
});

describe("POST /user/:userId/remove-from-project", () => {
  let deleteBySpy: jest.SpyInstance;
  let propsSpy: jest.SpyInstance;
  let callerUserId: ObjectID;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    callerUserId = ObjectID.generate();

    deleteBySpy = jest
      .spyOn(TeamMemberService, "deleteBy")
      .mockResolvedValue(3);

    propsSpy = jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({
        userId: callerUserId,
        userType: UserType.MasterAdmin,
        isMasterAdmin: true,
      } as DatabaseCommonInteractionProps);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the route is registered", () => {
    expect(() => {
      return mockRouter.match("POST", REMOVE_ROUTE);
    }).not.toThrow();
  });

  test("only a master admin can reach it", () => {
    expect(mockRouter.match("POST", REMOVE_ROUTE).middleware).toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    );
  });

  test("removes every membership in ONE delete, scoped to the user and project", async () => {
    await callRoute({
      route: REMOVE_ROUTE,
      params: { userId: USER_ID },
      body: { projectId: PROJECT_ONE_ID },
    });

    expect(deleteBySpy).toHaveBeenCalledTimes(1);

    const deleteBy: { query: Dictionary<unknown> } = deleteBySpy.mock
      .calls[0]![0] as { query: Dictionary<unknown> };

    expect((deleteBy.query["userId"] as ObjectID).toString()).toBe(USER_ID);
    expect((deleteBy.query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ONE_ID,
    );
    // Nothing else narrows it — every team the user is on is in scope.
    expect(Object.keys(deleteBy.query).sort()).toEqual(["projectId", "userId"]);
  });

  test("leaves the user's other projects alone", async () => {
    await callRoute({
      route: REMOVE_ROUTE,
      params: { userId: USER_ID },
      body: { projectId: PROJECT_ONE_ID },
    });

    const query: Dictionary<unknown> = (
      deleteBySpy.mock.calls[0]![0] as { query: Dictionary<unknown> }
    ).query;

    expect((query["projectId"] as ObjectID).toString()).not.toBe(
      PROJECT_TWO_ID,
    );
  });

  test("runs the delete with the caller's own props, never as root", async () => {
    /*
     * isRoot would skip TeamMemberService's SCIM Push Groups guard. A master
     * admin removing people is fine; a master admin silently fighting the
     * customer's identity provider is not.
     */
    await callRoute({
      route: REMOVE_ROUTE,
      params: { userId: USER_ID },
      body: { projectId: PROJECT_ONE_ID },
    });

    const props: DatabaseCommonInteractionProps = (
      deleteBySpy.mock.calls[0]![0] as { props: DatabaseCommonInteractionProps }
    ).props;

    expect(props.isRoot).toBeFalsy();
    expect(props.isMasterAdmin).toBe(true);
    expect(props.userId?.toString()).toBe(callerUserId.toString());
  });

  test("reports how many memberships were removed", async () => {
    await callRoute({
      route: REMOVE_ROUTE,
      params: { userId: USER_ID },
      body: { projectId: PROJECT_ONE_ID },
    });

    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { numberOfMembershipsDeleted: 3 },
    );
  });

  test("rejects a missing project id without deleting anything", async () => {
    await callRoute({
      route: REMOVE_ROUTE,
      params: { userId: USER_ID },
      body: {},
    });

    expect(deleteBySpy).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse).toHaveBeenCalled();
  });

  test("rejects a project id that is not a uuid without deleting anything", async () => {
    const result: RouteCallResult = await callRoute({
      route: REMOVE_ROUTE,
      params: { userId: USER_ID },
      body: { projectId: "'; DROP TABLE TeamMember; --" },
    });

    expect(deleteBySpy).not.toHaveBeenCalled();
    expect(result.nextCallCount).toBe(1);
  });

  test("rejects a missing user id without deleting anything", async () => {
    const result: RouteCallResult = await callRoute({
      route: REMOVE_ROUTE,
      params: {},
      body: { projectId: PROJECT_ONE_ID },
    });

    expect(deleteBySpy).not.toHaveBeenCalled();
    expect(result.nextCallCount).toBe(1);
  });

  test("rejects a user id that is not a uuid without deleting anything", async () => {
    const result: RouteCallResult = await callRoute({
      route: REMOVE_ROUTE,
      params: { userId: "not-a-uuid" },
      body: { projectId: PROJECT_ONE_ID },
    });

    expect(deleteBySpy).not.toHaveBeenCalled();
    expect(result.nextCallCount).toBe(1);
    expect(propsSpy).not.toHaveBeenCalled();
  });

  test("passes a server rejection on rather than reporting success", async () => {
    /*
     * This is the last-accepted-Owner guard. It has to reach the caller as a
     * failure with nothing deleted — which is exactly what the single deleteBy
     * buys over a per-membership loop.
     */
    const guardError: Error = new Error(
      "This team should have at least 1 member who has accepted the invitation.",
    );

    deleteBySpy.mockRejectedValue(guardError);

    const result: RouteCallResult = await callRoute({
      route: REMOVE_ROUTE,
      params: { userId: USER_ID },
      body: { projectId: PROJECT_ONE_ID },
    });

    expect(result.thrownToNext).toBe(guardError);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
