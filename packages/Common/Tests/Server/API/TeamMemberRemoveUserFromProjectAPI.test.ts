import CommonAPI from "../../../Server/API/CommonAPI";
import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * POST /team-member/remove-user-from-project exists so that removing a person
 * from a project is ONE server-side delete rather than a DELETE per membership
 * issued from the browser.
 *
 * That distinction is the whole point, and it is invisible from the outside:
 * TeamMemberService.onBeforeDelete refuses to remove the last accepted member
 * of a team that shouldHaveAtLeastOneMember (the Owners team), and it refuses
 * per request. A client-side loop therefore deletes every other membership
 * first and only then reports the failure, leaving the person stripped of the
 * teams the admin was just told they had not lost. A single deleteBy runs that
 * guard across the whole set before deleting anything.
 *
 * So these tests pin: one deleteBy, over exactly {userId, projectId}, with the
 * caller's own permissions (not root), and with the project taken from the
 * request's tenant rather than from anything the caller put in the body.
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
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const ROUTE: string = "/team-member/remove-user-from-project";

type RouteCallResult = {
  thrownToNext: unknown;
  nextCallCount: number;
};

function buildProps(data: {
  projectId: ObjectID | undefined;
  userId: ObjectID;
}): DatabaseCommonInteractionProps {
  const memberPermission: UserPermission = {
    _type: "UserPermission",
    permission: Permission.ProjectAdmin,
    labelIds: [],
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  if (data.projectId) {
    permissionMap[data.projectId.toString()] = {
      _type: "UserTenantAccessPermission",
      projectId: data.projectId,
      permissions: [memberPermission],
    };
  }

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userTenantAccessPermission: permissionMap,
  };
}

async function callRoute(data: {
  body: Dictionary<unknown>;
  authenticatedUserId?: ObjectID | undefined;
}): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: data.body,
    headers: {},
    userAuthorization: data.authenticatedUserId
      ? { userId: data.authenticatedUserId }
      : undefined,
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("POST", ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

describe("POST /team-member/remove-user-from-project", () => {
  let projectId: ObjectID;
  let callerUserId: ObjectID;
  let targetUserId: ObjectID;
  let deleteBySpy: jest.SpyInstance;
  let propsSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new TeamMemberAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    callerUserId = ObjectID.generate();
    targetUserId = ObjectID.generate();

    deleteBySpy = jest
      .spyOn(TeamMemberService, "deleteBy")
      .mockResolvedValue(3);

    propsSpy = jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(
        buildProps({ projectId: projectId, userId: callerUserId }),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the route is registered", () => {
    expect(() => {
      return mockRouter.match("POST", ROUTE);
    }).not.toThrow();
  });

  test("removes every membership in ONE delete, scoped to the user and project", async () => {
    await callRoute({
      body: { userId: targetUserId.toString() },
      authenticatedUserId: callerUserId,
    });

    expect(deleteBySpy).toHaveBeenCalledTimes(1);

    const deleteBy: {
      query: Dictionary<unknown>;
      props: DatabaseCommonInteractionProps;
    } = deleteBySpy.mock.calls[0]![0] as {
      query: Dictionary<unknown>;
      props: DatabaseCommonInteractionProps;
    };

    expect((deleteBy.query["userId"] as ObjectID).toString()).toBe(
      targetUserId.toString(),
    );
    expect((deleteBy.query["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
    // Nothing else narrows it — every team the user is on is in scope.
    expect(Object.keys(deleteBy.query).sort()).toEqual(["projectId", "userId"]);
  });

  test("runs the delete with the caller's own permissions, never as root", async () => {
    await callRoute({
      body: { userId: targetUserId.toString() },
      authenticatedUserId: callerUserId,
    });

    const props: DatabaseCommonInteractionProps = (
      deleteBySpy.mock.calls[0]![0] as { props: DatabaseCommonInteractionProps }
    ).props;

    expect(props.isRoot).toBeFalsy();
    expect(props.userId?.toString()).toBe(callerUserId.toString());
    expect(props.tenantId?.toString()).toBe(projectId.toString());
  });

  test("reports how many memberships were removed", async () => {
    await callRoute({
      body: { userId: targetUserId.toString() },
      authenticatedUserId: callerUserId,
    });

    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { numberOfMembershipsDeleted: 3 },
    );
  });

  test("takes the project from the request's tenant, not from the body", async () => {
    const attackerSuppliedProjectId: ObjectID = ObjectID.generate();

    await callRoute({
      body: {
        userId: targetUserId.toString(),
        projectId: attackerSuppliedProjectId.toString(),
      },
      authenticatedUserId: callerUserId,
    });

    const query: Dictionary<unknown> = (
      deleteBySpy.mock.calls[0]![0] as { query: Dictionary<unknown> }
    ).query;

    expect((query["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
    expect((query["projectId"] as ObjectID).toString()).not.toBe(
      attackerSuppliedProjectId.toString(),
    );
  });

  test("rejects an unauthenticated caller without deleting anything", async () => {
    await callRoute({ body: { userId: targetUserId.toString() } });

    expect(deleteBySpy).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse).toHaveBeenCalled();
  });

  test("rejects a request with no tenant without deleting anything", async () => {
    propsSpy.mockResolvedValue(
      buildProps({ projectId: undefined, userId: callerUserId }),
    );

    await callRoute({
      body: { userId: targetUserId.toString() },
      authenticatedUserId: callerUserId,
    });

    expect(deleteBySpy).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse).toHaveBeenCalled();
  });

  test("rejects a missing user id without deleting anything", async () => {
    await callRoute({ body: {}, authenticatedUserId: callerUserId });

    expect(deleteBySpy).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse).toHaveBeenCalled();
  });

  test("rejects a user id that is not a uuid without deleting anything", async () => {
    const result: RouteCallResult = await callRoute({
      body: { userId: "'; DROP TABLE TeamMember; --" },
      authenticatedUserId: callerUserId,
    });

    expect(deleteBySpy).not.toHaveBeenCalled();
    expect(result.nextCallCount).toBe(1);
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
      body: { userId: targetUserId.toString() },
      authenticatedUserId: callerUserId,
    });

    expect(result.thrownToNext).toBe(guardError);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
