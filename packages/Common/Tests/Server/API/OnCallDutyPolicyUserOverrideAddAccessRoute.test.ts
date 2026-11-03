import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import OnCallDutyPolicyUserOverrideAPI from "../../../Server/API/OnCallDutyPolicyUserOverrideAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import ObjectID from "../../../Types/ObjectID";
import {
  USER_OVERRIDE_ADD_ACCESS_MAX_POLICIES,
  UserOverrideAddAccess,
} from "../../../Types/OnCallDutyPolicy/UserOverrideAddAccess";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

/*
 * POST /on-call-duty-policy-user-override/add-access: where the caller may
 * add a user override (Types/OnCallDutyPolicy/UserOverrideAddAccess). Its
 * answers are held to a real create's in OnCallDutyPolicyUserOverrideAddAccess
 * (Tests/Server/Services); this file holds the route around them - who may
 * ask, in which project, about what - with the service's answer stubbed.
 */

const ROUTE: string = "/on-call-duty-policy-user-override/add-access";

new OnCallDutyPolicyUserOverrideAPI();

const PROJECT_ID: ObjectID = new ObjectID(
  "0dd10000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0dd10000-0000-4000-8000-000000000002");
const POLICY_A: string = "0dd10000-0000-4000-8000-0000000000a2";
const POLICY_B: string = "0dd10000-0000-4000-8000-0000000000b2";

const MEMBER: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  userType: UserType.User,
  tenantId: PROJECT_ID,
};

interface RouteCall {
  thrown: unknown;
  sent: unknown;
}

const callRoute: (data: {
  props: DatabaseCommonInteractionProps;
  body: unknown;
}) => Promise<RouteCall> = async (data: {
  props: DatabaseCommonInteractionProps;
  body: unknown;
}): Promise<RouteCall> => {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(data.props);

  const next: jest.Mock = jest.fn();

  await mockRouter.match("post", ROUTE).handlerFunction(
    {
      params: {},
      query: {},
      headers: {},
      body: data.body,
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  const sent: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  return {
    thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    sent: sent.mock.calls[0] ? sent.mock.calls[0][2] : undefined,
  };
};

let getAddAccess: jest.Mock;

beforeEach(() => {
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();
  (Response.setNoCacheHeaders as unknown as jest.Mock).mockClear();

  getAddAccess = jest
    .spyOn(OnCallDutyPolicyUserOverrideService, "getAddAccess")
    .mockResolvedValue({
      global: false,
      onCallDutyPolicyIds: [POLICY_A],
    } as UserOverrideAddAccess) as unknown as jest.Mock;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /on-call-duty-policy-user-override/add-access", () => {
  test("is a POST behind the session middleware, which answers a request with no session 401", () => {
    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "post",
      ROUTE,
    );

    expect(route.middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });

  test("hands the service the policies asked about and the caller, and sends its answer uncached", async () => {
    const call: RouteCall = await callRoute({
      props: MEMBER,
      body: { onCallDutyPolicyIds: [POLICY_A, POLICY_B] },
    });

    expect(call.thrown).toBeUndefined();
    expect(getAddAccess).toHaveBeenCalledTimes(1);

    const asked: { onCallDutyPolicyIds: Array<ObjectID> } = getAddAccess.mock
      .calls[0]![0] as { onCallDutyPolicyIds: Array<ObjectID> };

    expect(
      asked.onCallDutyPolicyIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([POLICY_A, POLICY_B]);
    expect((getAddAccess.mock.calls[0]![0] as { props: unknown }).props).toBe(
      MEMBER,
    );

    expect(call.sent).toEqual({
      global: false,
      onCallDutyPolicyIds: [POLICY_A],
    });
    expect(Response.setNoCacheHeaders).toHaveBeenCalledTimes(1);
  });

  test("a body with no list asks about no policy: only whether a global override may be added", async () => {
    await callRoute({ props: MEMBER, body: {} });

    expect(
      (getAddAccess.mock.calls[0]![0] as { onCallDutyPolicyIds: unknown })
        .onCallDutyPolicyIds,
    ).toEqual([]);
  });

  test("a request with no credentials is answered 401, and the service is not asked", async () => {
    const call: RouteCall = await callRoute({
      props: { tenantId: PROJECT_ID, userType: UserType.Public },
      body: { onCallDutyPolicyIds: [POLICY_A] },
    });

    expect(call.thrown).toBeInstanceOf(NotAuthenticatedException);
    expect(getAddAccess).not.toHaveBeenCalled();
  });

  test("a request that names no project is refused, and the service is not asked", async () => {
    const call: RouteCall = await callRoute({
      props: { userId: USER_ID, userType: UserType.User },
      body: { onCallDutyPolicyIds: [POLICY_A] },
    });

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect(getAddAccess).not.toHaveBeenCalled();
  });

  test.each([
    ["a list that is not one", { onCallDutyPolicyIds: POLICY_A }],
    ["an id that is not one", { onCallDutyPolicyIds: [POLICY_A, "nope"] }],
    ["an id that is not text", { onCallDutyPolicyIds: [42] }],
  ])("%s is refused as bad data", async (_name: string, body: unknown) => {
    const call: RouteCall = await callRoute({ props: MEMBER, body: body });

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect(getAddAccess).not.toHaveBeenCalled();
  });

  test(`more than ${USER_OVERRIDE_ADD_ACCESS_MAX_POLICIES} policies at once is refused`, async () => {
    const tooMany: Array<string> = [];

    for (let i: number = 0; i <= USER_OVERRIDE_ADD_ACCESS_MAX_POLICIES; i++) {
      tooMany.push(ObjectID.generate().toString());
    }

    const call: RouteCall = await callRoute({
      props: MEMBER,
      body: { onCallDutyPolicyIds: tooMany },
    });

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect(getAddAccess).not.toHaveBeenCalled();
  });
});
