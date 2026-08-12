import CommonAPI from "../../../Server/API/CommonAPI";
import UserAPI from "../../../Server/API/UserAPI";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
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
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
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
 * Both are guarded by a master-admin middleware, which is the only thing
 * standing between "list one user's projects" and "read across every tenant on
 * the instance". That the routes carry it is asserted directly, because
 * nothing else in these tests would notice its absence.
 *
 * The two carry DIFFERENT master-admin middlewares, and which one each carries
 * is the security boundary of this file:
 *
 *   - /projects reads, so it takes
 *     isAuthorizedMasterAdminOrMasterApiKeyMiddleware — a master-admin session
 *     OR the instance-wide master API key, so scripts can call it.
 *   - /remove-from-project writes, so it stays on
 *     isAuthorizedMasterAdminMiddleware — session only. A leaked static key must
 *     not be able to strip somebody's project access headlessly.
 *
 * A find/replace that "helpfully" widened the second one would leave every
 * assertion about grouping, paging and deleting green, so the middlewares are
 * asserted by identity, and the whole UserAPI route surface is swept to prove
 * the read is the ONLY route the key can reach.
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

const AUTH_STATUS_ROUTE: string = "/user/:userId/authentication-status";
const SET_PASSWORD_ROUTE: string = "/user/:userId/set-password";
const RESET_LINK_ROUTE: string = "/user/:userId/send-password-reset-link";

const USER_ID: string = "00000000-0000-4000-8000-000000000001";
const PROJECT_ONE_ID: string = "00000000-0000-4000-8000-0000000000a1";
const PROJECT_TWO_ID: string = "00000000-0000-4000-8000-0000000000a2";

const MASTER_API_KEY: string = "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34";
const OTHER_API_KEY: string = "1c9d7f40-2b83-4a55-8e70-6d4b9a0c3e12";

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

  test("only a master admin — by session or by master API key — can reach it", () => {
    expect(mockRouter.match("POST", PROJECTS_ROUTE).middleware).toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
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

  /*
   * Session only — deliberately NOT the middleware its read-only sibling
   * carries. This route deletes, and the master API key is a static credential
   * that lives in a config table and in whatever script holds it.
   */
  test("only a master admin SESSION can reach it, never the master API key", () => {
    expect(mockRouter.match("POST", REMOVE_ROUTE).middleware).toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    );

    expect(mockRouter.match("POST", REMOVE_ROUTE).middleware).not.toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
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

/*
 * The gate and the handler together, driven the way a real request arrives:
 * through the route's middleware first, and only into the handler if the
 * middleware lets it past.
 *
 * The describes above call handlerFunction directly, which is the right way to
 * test grouping and paging but says nothing about who may call it — and this is
 * a route that reads across EVERY tenant on the instance. Two failure modes
 * live in the gap and neither is visible from either side alone:
 *
 *   - a caller who should be refused reaching the read anyway. Asserted as
 *     "TeamMemberService.findBy was never called", not merely as "an error was
 *     returned": returning 401 after already reading every membership on the
 *     instance would satisfy the weaker assertion.
 *   - the master-key path authorizing but the handler then failing, because the
 *     key branch calls next() WITHOUT setting userAuthorization, userType or
 *     tenantId on the request. A handler that read any of them would work under
 *     a session and break under a key, and no unit test that hand-builds a
 *     request would notice.
 */
describe("POST /user/:userId/projects — the master API key path", () => {
  let findBySpy: jest.SpyInstance;

  type MiddlewareCallResult = {
    // Whether the gate let the request through to the read.
    reachedHandler: boolean;
    errorSentToClient: NotAuthorizedException | undefined;
    // The request object as the handler saw it, to inspect what the gate set.
    request: ExpressRequest;
  };

  async function callThroughMiddleware(data: {
    headers: Dictionary<string | Array<string> | undefined>;
    params?: Dictionary<string> | undefined;
    query?: Dictionary<string> | undefined;
  }): Promise<MiddlewareCallResult> {
    const req: ExpressRequest = {
      params: data.params || { userId: USER_ID },
      query: data.query || {},
      body: {},
      headers: data.headers,
    } as unknown as ExpressRequest;

    const res: ExpressResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    const route: {
      middleware: (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ) => void | Promise<void>;
      handlerFunction: (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ) => void | Promise<void>;
    } = mockRouter.match("POST", PROJECTS_ROUTE);

    const middlewareNext: jest.Mock = jest.fn();

    await route.middleware(req, res, middlewareNext as unknown as NextFunction);

    const reachedHandler: boolean = middlewareNext.mock.calls.length > 0;

    if (reachedHandler) {
      await route.handlerFunction(
        req,
        res,
        jest.fn() as unknown as NextFunction,
      );
    }

    const errorCall: Array<unknown> | undefined = (
      Response.sendErrorResponse as unknown as {
        mock: { calls: Array<Array<unknown>> };
      }
    ).mock.calls[0];

    return {
      reachedHandler: reachedHandler,
      errorSentToClient: errorCall?.[2] as NotAuthorizedException | undefined,
      request: req,
    };
  }

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    findBySpy = jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([
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
        projectName: "Beta Staging",
        teamId: "team-ops",
        teamName: "Ops",
      }),
    ]);

    /*
     * Stand in for the GlobalConfig lookup — only this one key is live. Spying
     * here rather than on getApiKey keeps the real header parsing and the real
     * UUID guard in the test.
     */
    jest.spyOn(ProjectMiddleware, "isMasterApiKey").mockImplementation(((
      apiKey: ObjectID,
    ): Promise<boolean> => {
      return Promise.resolve(apiKey.toString() === MASTER_API_KEY);
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("when the master API key is presented", () => {
    test("a request carrying nothing but the key gets the grouped list", async () => {
      const result: MiddlewareCallResult = await callThroughMiddleware({
        headers: { apikey: MASTER_API_KEY },
      });

      expect(result.reachedHandler).toBe(true);
      expect(Response.sendErrorResponse).not.toHaveBeenCalled();
      // Two projects out of three memberships — the grouping still happens.
      expect(projectNamesSent()).toEqual(["Acme Production", "Beta Staging"]);
      expect(sentCount()).toBe(2);
    });

    /*
     * The handler must not depend on anything the key branch leaves unset. If
     * this ever fails, the route works for the Admin Dashboard and 500s for
     * every script — the exact split a route-registration test cannot see.
     */
    test("works even though the key branch sets no session state on the request", async () => {
      const result: MiddlewareCallResult = await callThroughMiddleware({
        headers: { apikey: MASTER_API_KEY },
      });

      const request: Dictionary<unknown> =
        result.request as unknown as Dictionary<unknown>;

      expect(request["userAuthorization"]).toBeUndefined();
      expect(request["userType"]).toBeUndefined();
      expect(request["tenantId"]).toBeUndefined();

      // ...and the read happened anyway.
      expect(findBySpy).toHaveBeenCalledTimes(1);
      expect(Response.sendJsonArrayResponse).toHaveBeenCalledTimes(1);
    });

    test("still reads as root, so it can see projects the key's user is not in", async () => {
      await callThroughMiddleware({ headers: { apikey: MASTER_API_KEY } });

      const props: DatabaseCommonInteractionProps = (
        findBySpy.mock.calls[0]![0] as { props: DatabaseCommonInteractionProps }
      ).props;

      expect(props.isRoot).toBe(true);
    });

    test("pages over projects on the key path too", async () => {
      await callThroughMiddleware({
        headers: { apikey: MASTER_API_KEY },
        query: { skip: "1", limit: "1" },
      });

      expect(projectNamesSent()).toEqual(["Beta Staging"]);
      // count stays the size of the whole grouped list, not of the page.
      expect(sentCount()).toBe(2);
    });

    /*
     * A key caller has no tenant, and this endpoint must not acquire one from a
     * stray header: the handler passes literal `{ isRoot: true }` props, so
     * there is no props.tenantId for the root tenant-scoping to apply. Worth
     * pinning because "send projectid with the key" is a natural thing for a
     * caller to try, and silently getting one project's worth of an answer
     * would be worse than an error.
     */
    test("a projectid header does not narrow the read", async () => {
      await callThroughMiddleware({
        headers: { apikey: MASTER_API_KEY, projectid: PROJECT_ONE_ID },
      });

      const findBy: { query: Dictionary<unknown> } = findBySpy.mock
        .calls[0]![0] as { query: Dictionary<unknown> };

      expect(Object.keys(findBy.query)).toEqual(["userId"]);
      expect(projectNamesSent()).toEqual(["Acme Production", "Beta Staging"]);
    });

    test("validates the user id before reading, key or no key", async () => {
      const result: MiddlewareCallResult = await callThroughMiddleware({
        headers: { apikey: MASTER_API_KEY },
        params: { userId: "not-a-uuid" },
      });

      expect(result.reachedHandler).toBe(true);
      expect(findBySpy).not.toHaveBeenCalled();
    });
  });

  describe("when the credential cannot authorize the request", () => {
    /*
     * Every one of these must stop AT the gate. The assertion that matters is
     * findBy — a refusal issued after the cross-tenant read has already run is
     * not a refusal.
     */
    const unusableCredentials: Array<[string, string | Array<string>]> = [
      ["a well-formed key that is not the master key", OTHER_API_KEY],
      ["an empty apikey header", ""],
      ["a whitespace-only apikey header", "   "],
      ["a non-UUID apikey header", "not-a-uuid"],
      ["a truncated UUID", "8e1a3a52-6d64-4f1f-9a2e"],
      [
        "a UUID with non-hex characters",
        "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2bZZ",
      ],
      ["a SQL injection attempt", "' OR 1=1 --"],
      ["duplicate apikey headers", [MASTER_API_KEY, OTHER_API_KEY]],
    ];

    test.each(unusableCredentials)(
      "refuses %s without reading anything",
      async (_label: string, apiKeyHeader: string | Array<string>) => {
        const result: MiddlewareCallResult = await callThroughMiddleware({
          headers: { apikey: apiKeyHeader },
        });

        expect(result.reachedHandler).toBe(false);
        expect(findBySpy).not.toHaveBeenCalled();
        expect(Response.sendJsonArrayResponse).not.toHaveBeenCalled();

        expect(result.errorSentToClient).toBeInstanceOf(NotAuthorizedException);
        expect(result.errorSentToClient?.message).toBe(
          "Unauthorized: Access token is required.",
        );
      },
    );

    test("refuses a request with no credential at all", async () => {
      const result: MiddlewareCallResult = await callThroughMiddleware({
        headers: {},
      });

      expect(result.reachedHandler).toBe(false);
      expect(findBySpy).not.toHaveBeenCalled();
    });

    /*
     * Fail closed. A GlobalConfig lookup that throws must not be read as "the
     * key checked out"; the middleware swallows it and falls through to the
     * session check, which has nothing to work with here.
     */
    test("refuses when the key lookup itself throws", async () => {
      jest
        .spyOn(ProjectMiddleware, "isMasterApiKey")
        .mockRejectedValue(new Error("database is down") as never);

      const result: MiddlewareCallResult = await callThroughMiddleware({
        headers: { apikey: MASTER_API_KEY },
      });

      expect(result.reachedHandler).toBe(false);
      expect(findBySpy).not.toHaveBeenCalled();
    });

    /*
     * The UUID guard has to run BEFORE the lookup: masterApiKey is a Postgres
     * uuid column, and a non-UUID raises 22P02 as a raw QueryFailedError, which
     * is not a OneUptime Exception and so escapes the error translator as a 500.
     */
    test("never reaches the key lookup with a malformed value", async () => {
      await callThroughMiddleware({ headers: { apikey: "garbage" } });

      expect(ProjectMiddleware.isMasterApiKey).not.toHaveBeenCalled();
    });
  });

  describe("session access is unchanged by the widening", () => {
    /*
     * The Admin Dashboard reaches this route with a cookie session and no key.
     * Accepting the key must not have cost it that.
     */
    test("a master admin session still gets the grouped list", async () => {
      jest
        .spyOn(UserMiddleware, "getAccessTokenFromExpressRequest")
        .mockReturnValue("a.master.admin.token" as never);

      jest.spyOn(JSONWebToken, "decode").mockReturnValue({
        isMasterAdmin: true,
      } as unknown as JSONWebTokenData as never);

      const result: MiddlewareCallResult = await callThroughMiddleware({
        headers: {},
      });

      expect(result.reachedHandler).toBe(true);
      expect(projectNamesSent()).toEqual(["Acme Production", "Beta Staging"]);
    });

    test("an ordinary user session is still refused", async () => {
      jest
        .spyOn(UserMiddleware, "getAccessTokenFromExpressRequest")
        .mockReturnValue("an.ordinary.user.token" as never);

      jest.spyOn(JSONWebToken, "decode").mockReturnValue({
        isMasterAdmin: false,
      } as unknown as JSONWebTokenData as never);

      const result: MiddlewareCallResult = await callThroughMiddleware({
        headers: {},
      });

      expect(result.reachedHandler).toBe(false);
      expect(findBySpy).not.toHaveBeenCalled();
      expect(result.errorSentToClient?.message).toBe(
        "Unauthorized: Only master admins can perform this action.",
      );
    });

    /*
     * An unusable key must not cost a caller their valid session. This
     * middleware falls through rather than failing fast, unlike the
     * presence-based routing in UserAuthorization.
     */
    test("an unusable key alongside a master admin session still passes", async () => {
      jest
        .spyOn(UserMiddleware, "getAccessTokenFromExpressRequest")
        .mockReturnValue("a.master.admin.token" as never);

      jest.spyOn(JSONWebToken, "decode").mockReturnValue({
        isMasterAdmin: true,
      } as unknown as JSONWebTokenData as never);

      const result: MiddlewareCallResult = await callThroughMiddleware({
        headers: { apikey: "" },
      });

      expect(result.reachedHandler).toBe(true);
    });
  });
});

/*
 * The rule the widening has to keep: on UserAPI, the master API key reaches
 * reads and nothing else.
 *
 * Asserted as a sweep over the whole registered surface rather than route by
 * route, so a NEW master-admin route added later has to make a deliberate
 * choice — adding one that accepts the key fails this test until somebody
 * writes it into the expected list and, one hopes, thinks about why.
 */
describe("UserAPI master-admin route surface", () => {
  type RouteSummary = { method: string; uri: string; middleware: unknown };

  function routesGuardedBy(middleware: unknown): Array<string> {
    return (mockRouter.routes as unknown as Array<RouteSummary>)
      .filter((route: RouteSummary) => {
        return route.middleware === middleware;
      })
      .map((route: RouteSummary) => {
        return `${route.method} ${route.uri}`;
      })
      .sort();
  }

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserAPI();
  });

  test("the projects read is the ONLY route a static key can reach", () => {
    expect(
      routesGuardedBy(
        MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
      ),
    ).toEqual([`POST ${PROJECTS_ROUTE}`]);
  });

  test("every master-admin route that writes stays session-only", () => {
    expect(
      routesGuardedBy(
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      ),
    ).toEqual(
      [
        `GET ${AUTH_STATUS_ROUTE}`,
        `POST ${REMOVE_ROUTE}`,
        `POST ${RESET_LINK_ROUTE}`,
        `POST ${SET_PASSWORD_ROUTE}`,
      ].sort(),
    );
  });

  /*
   * Spelled out one by one as well as swept, because these are the routes where
   * a leaked static key would stop being a disclosure and start being an
   * account takeover: removing somebody's access, setting their password, or
   * mailing a reset link to their inbox.
   */
  test.each([
    ["POST", REMOVE_ROUTE],
    ["POST", SET_PASSWORD_ROUTE],
    ["POST", RESET_LINK_ROUTE],
    ["GET", AUTH_STATUS_ROUTE],
  ])(
    "%s %s does not accept the master API key",
    (method: string, uri: string) => {
      expect(mockRouter.match(method, uri).middleware).toBe(
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      );
    },
  );
});
