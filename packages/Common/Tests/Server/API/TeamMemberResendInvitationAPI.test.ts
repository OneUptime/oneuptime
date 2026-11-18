import CommonAPI from "../../../Server/API/CommonAPI";
import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import { PublicMessageRateLimitException } from "../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  RESEND_INVITATION_REFUSALS,
  getResendInvitationRoute,
} from "../../../Types/Team/ResendInvitation";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * POST /team-member/:id/resend-invitation (#9519): a pending person's
 * invitation email, sent again from their row. Checked with the caller's
 * own permissions, in the request's project - a master admin's in the
 * Admin Dashboard, which works in no project, in the membership's own - and
 * answered with the address it went to. A refusal of the per-address
 * limit says when to come back.
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
    setNoCacheHeaders: jest.fn(),
  };
});

const ROUTE: string = "/team-member/:id/resend-invitation";

const PROJECT_ID: ObjectID = new ObjectID(
  "95200000-0000-4000-8000-000000000001",
);
const CALLER_ID: ObjectID = new ObjectID(
  "95200000-0000-4000-8000-000000000002",
);
const MEMBERSHIP_ID: ObjectID = new ObjectID(
  "95200000-0000-4000-8000-000000000003",
);

function memberProps(): DatabaseCommonInteractionProps {
  const adminPermission: UserPermission = {
    _type: "UserPermission",
    permission: Permission.ProjectAdmin,
    labelIds: [],
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [adminPermission],
    },
  };

  return {
    tenantId: PROJECT_ID,
    userId: CALLER_ID,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

function masterAdminProps(
  tenantId?: ObjectID | undefined,
): DatabaseCommonInteractionProps {
  return {
    tenantId: tenantId,
    userId: CALLER_ID,
    userType: UserType.MasterAdmin,
    isMasterAdmin: true,
  };
}

type CallResult = {
  thrownToNext: unknown;
  headers: Record<string, string>;
};

async function callRoute(id: unknown): Promise<CallResult> {
  const headers: Record<string, string> = {};

  const req: ExpressRequest = {
    params: { id: id },
    query: {},
    body: {},
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
    setHeader: (name: string, value: string): void => {
      headers[name] = value;
    },
  } as unknown as ExpressResponse;

  const next: Mock = jest.fn();

  await mockRouter
    .match("POST", ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    headers: headers,
  };
}

// What the route answered, as it sent it.
function answered(): JSONObject {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(calls).toHaveLength(1);

  return calls[0]![2] as JSONObject;
}

type ResendAsked = {
  teamMemberId: ObjectID;
  projectId: ObjectID | null;
  props: DatabaseCommonInteractionProps;
};

describe("POST /team-member/:id/resend-invitation", () => {
  let resendSpy: SpyInstance<typeof TeamMemberService.resendInvitation>;
  let propsSpy: SpyInstance<typeof CommonAPI.getDatabaseCommonInteractionProps>;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new TeamMemberAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    propsSpy = jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(memberProps());

    resendSpy = jest
      .spyOn(TeamMemberService, "resendInvitation")
      .mockResolvedValue({ email: "grace@example.com" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function asked(): ResendAsked {
    expect(resendSpy).toHaveBeenCalledTimes(1);
    return resendSpy.mock.calls[0]![0] as ResendAsked;
  }

  test("is the route a row asks, behind the user middleware, for whoever may invite - not only a master admin", () => {
    expect(getResendInvitationRoute(MEMBERSHIP_ID)).toBe(
      `/team-member/${MEMBERSHIP_ID.toString()}/resend-invitation`,
    );

    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "POST",
      ROUTE,
    );

    expect(route.middlewares).toContain(UserMiddleware.getUserMiddleware);
    expect(route.middlewares).not.toContain(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    );
  });

  test("sends it again for the membership named, in the request's project, with the caller's own props, and says where it went", async () => {
    await callRoute(MEMBERSHIP_ID.toString());

    expect(asked().teamMemberId.toString()).toBe(MEMBERSHIP_ID.toString());
    expect(asked().projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(asked().props).toEqual(memberProps());
    expect(asked().props.isRoot).toBeFalsy();
    expect(answered()).toEqual({ email: "grace@example.com" });
    expect(Response.setNoCacheHeaders).toHaveBeenCalled();
  });

  test("a master admin in the Admin Dashboard names no project: the membership's own decides", async () => {
    propsSpy.mockResolvedValue(masterAdminProps());

    await callRoute(MEMBERSHIP_ID.toString());

    expect(asked().projectId).toBeNull();
    expect(answered()).toEqual({ email: "grace@example.com" });
  });

  test("a master admin in a project's Dashboard is held to that project", async () => {
    propsSpy.mockResolvedValue(masterAdminProps(PROJECT_ID));

    await callRoute(MEMBERSHIP_ID.toString());

    expect(asked().projectId?.toString()).toBe(PROJECT_ID.toString());
  });

  test("refuses a caller who is no member of the request's project, sending nothing", async () => {
    propsSpy.mockResolvedValue({
      tenantId: PROJECT_ID,
      userId: CALLER_ID,
      userType: UserType.User,
      userTenantAccessPermission: {},
    });

    const result: CallResult = await callRoute(MEMBERSHIP_ID.toString());

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(resendSpy).not.toHaveBeenCalled();
  });

  test("refuses a request that names no project, unless a master admin sent it", async () => {
    propsSpy.mockResolvedValue({
      userId: CALLER_ID,
      userType: UserType.User,
      userTenantAccessPermission: {},
    });

    const result: CallResult = await callRoute(MEMBERSHIP_ID.toString());

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(resendSpy).not.toHaveBeenCalled();
  });

  test.each([
    ["an id that is not one", "'; DROP TABLE TeamMember; --"],
    ["no id", ""],
    ["something else", 42],
  ])("refuses %s, sending nothing", async (_case: string, id: unknown) => {
    const result: CallResult = await callRoute(id);

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(resendSpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("a refusal of the per-address limit says when to come back", async () => {
    const refusal: PublicMessageRateLimitException =
      new PublicMessageRateLimitException(
        "Too many invitations were sent to this email address in the last hour. Please try again later.",
        1234,
      );
    resendSpy.mockRejectedValue(refusal as never);

    const result: CallResult = await callRoute(MEMBERSHIP_ID.toString());

    expect(result.thrownToNext).toBe(refusal);
    expect(result.headers["Retry-After"]).toBe("1234");
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("passes on the service's refusals as they are, with no Retry-After", async () => {
    const refusal: NotFoundException = new NotFoundException(
      RESEND_INVITATION_REFUSALS.notInvited,
    );
    resendSpy.mockRejectedValue(refusal as never);

    const result: CallResult = await callRoute(MEMBERSHIP_ID.toString());

    expect(result.thrownToNext).toBe(refusal);
    expect(result.headers["Retry-After"]).toBeUndefined();
  });
});
