import CommonAPI from "../../../Server/API/CommonAPI";
import "../../../Server/API/SharedNamesAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import LabelService from "../../../Server/Services/LabelService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import TeamService from "../../../Server/Services/TeamService";
import UniqueNameInProject from "../../../Server/Utils/Database/UniqueNameInProject";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { SharedNameKind } from "../../../Types/Database/SharedNames";
import Dictionary from "../../../Types/Dictionary";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GET /shared-names/:kind (#9746): which teams, labels (#9856), on-call
 * policies or on-call schedules of the request's project share a name, for
 * their list to mark.
 *
 * The route asks for an authenticated member of the project, or a project
 * API key, before anything is read; the project is the request's own; the
 * records are read with the caller's own props, never as root, by the
 * kind's own service (UniqueNameInProject.findRecordsSharingName); a kind it
 * does not know is no list; and the answer is never cached.
 */

/*
 * The route's router is made as its module loads, before this file's
 * imports are bound: the mock router is read from the module itself, the
 * same one `mockRouter` below names.
 */
jest.mock("../../../Server/Utils/Express", () => {
  const helpers: typeof import("./Helpers") =
    jest.requireActual<typeof import("./Helpers")>("./Helpers");

  return {
    getRouter: () => {
      return helpers.mockRouter;
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
    setNoCacheHeaders: jest.fn(),
  };
});

const TENANTS_A: string = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANTS_B: string = "aaaaaaaa-0000-4000-8000-000000000002";

function buildProps(data: {
  projectId: ObjectID;
  userId?: ObjectID | undefined;
  userType?: UserType | undefined;
  permissions: Array<Permission>;
  accessTo?: ObjectID | undefined;
}): DatabaseCommonInteractionProps {
  const accessTo: ObjectID = data.accessTo || data.projectId;
  const permissionMap: Dictionary<UserTenantAccessPermission> = {
    [accessTo.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: accessTo,
      permissions: data.permissions.map(
        (permission: Permission): UserPermission => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        },
      ),
    },
  };

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userType: data.userType || UserType.User,
    userTenantAccessPermission: permissionMap,
  } as DatabaseCommonInteractionProps;
}

interface RouteCallResult {
  thrownToNext: unknown;
  nextCallCount: number;
  res: ExpressResponse;
}

async function callRoute(kind: string): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: { kind: kind },
    query: {},
    body: {},
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("GET", "/shared-names/:kind")
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
    res: res,
  };
}

describe("GET /shared-names/:kind", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let findSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    userId = ObjectID.generate();

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(
        buildProps({
          projectId,
          userId,
          permissions: [Permission.ProjectMember],
        }),
      );
    findSpy = jest
      .spyOn(UniqueNameInProject, "findRecordsSharingName")
      .mockResolvedValue([[TENANTS_A, TENANTS_B]]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is a read, mounted behind getUserMiddleware", () => {
    expect(mockRouter.match("GET", "/shared-names/:kind").middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
  });

  /*
   * An archived on-call policy or label is offered in no picker, so
   * policies and labels count only while in service; a team and a schedule
   * have no archive.
   */
  test.each([
    [SharedNameKind.Team, TeamService, false],
    [SharedNameKind.Label, LabelService, true],
    [SharedNameKind.OnCallPolicy, OnCallDutyPolicyService, true],
    [SharedNameKind.OnCallSchedule, OnCallDutyPolicyScheduleService, false],
  ])(
    "for %s, answers the groups its own service finds, read with the caller's own props, uncached",
    async (
      kind: SharedNameKind,
      service: unknown,
      leavesOutArchived: boolean,
    ) => {
      const result: RouteCallResult = await callRoute(kind);

      expect(result.nextCallCount).toBe(0);
      expect(findSpy).toHaveBeenCalledTimes(1);

      const call: {
        service: unknown;
        projectId: ObjectID;
        props: DatabaseCommonInteractionProps;
        leaveOutArchived?: boolean;
      } = findSpy.mock.calls[0]![0];

      expect(call.service).toBe(service);
      expect(Boolean(call.leaveOutArchived)).toBe(leavesOutArchived);
      expect(call.projectId.toString()).toBe(projectId.toString());
      expect(call.props.userId?.toString()).toBe(userId.toString());
      expect(call.props.isRoot).toBeFalsy();

      expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(result.res);
      expect(
        (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
          .calls[0]![2] as JSONObject,
      ).toEqual({ groups: [[TENANTS_A, TENANTS_B]] });
    },
  );

  test("a project API key may ask too", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(
        buildProps({
          projectId,
          userType: UserType.API,
          permissions: [Permission.ProjectMember],
        }),
      );

    const result: RouteCallResult = await callRoute(SharedNameKind.Team);

    expect(result.nextCallCount).toBe(0);
    expect(findSpy).toHaveBeenCalledTimes(1);
  });

  test.each(["labels", "Label", "Team", "users", ""])(
    "a kind it does not know (%j) is no list, and nothing is read",
    async (kind: string) => {
      const result: RouteCallResult = await callRoute(kind);

      expect(result.thrownToNext).toBeInstanceOf(NotFoundException);
      // It names the kinds there are.
      expect((result.thrownToNext as Error).message).toBe(
        "There is no list of records with names of their own by that name. Ask for team, label, on-call-policy or on-call-schedule.",
      );
      expect(findSpy).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    },
  );

  test("someone who is not a member of the request's project is refused, and nothing is read", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(
        buildProps({
          projectId,
          userId,
          permissions: [Permission.ProjectMember],
          accessTo: ObjectID.generate(),
        }),
      );

    const result: RouteCallResult = await callRoute(SharedNameKind.Team);

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("a read the service refuses is the route's answer", async () => {
    findSpy.mockRejectedValue(
      new NotAuthorizedException("You do not have permission to read teams."),
    );

    const result: RouteCallResult = await callRoute(SharedNameKind.Team);

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
