import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import DashboardService from "../../../Server/Services/DashboardService";
import CookieUtil from "../../../Server/Utils/Cookie";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import {
  DASHBOARD_MASTER_PASSWORD_INVALID_MESSAGE,
  DASHBOARD_MASTER_PASSWORD_REQUIRED_MESSAGE,
} from "../../../Types/Dashboard/MasterPassword";
import BadDataException from "../../../Types/Exception/BadDataException";
import MasterPasswordRequiredException from "../../../Types/Exception/MasterPasswordRequiredException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
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
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

describe("DashboardAPI master password", () => {
  const password: string = "correct horse battery staple";

  let dashboardId: ObjectID;
  let dashboard: Dashboard;
  let mockRequest: ExpressRequest;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new DashboardAPI();
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    dashboardId = ObjectID.generate();
    dashboard = new Dashboard();
    dashboard.id = dashboardId;
    dashboard.isPublicDashboard = true;
    dashboard.enableMasterPassword = true;
    dashboard.masterPassword = new HashedString(
      await HashedString.hashValue(password, EncryptionSecret),
      true,
    );

    jest.spyOn(DashboardService, "findOneById").mockResolvedValue(dashboard);

    mockRequest = {
      params: {
        dashboardId: dashboardId.toString(),
      },
      body: {
        password,
      },
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    mockResponse = {
      cookie: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("denies a protected public dashboard when no master-password cookie is present", async () => {
    const result: Awaited<ReturnType<typeof DashboardService.hasReadAccess>> =
      await DashboardService.hasReadAccess({
        dashboardId,
        req: mockRequest,
      });

    expect(result.hasReadAccess).toBe(false);
    expect(result.error).toBeInstanceOf(MasterPasswordRequiredException);
    expect(result.error?.message).toBe(
      DASHBOARD_MASTER_PASSWORD_REQUIRED_MESSAGE,
    );
  });

  it("fails closed when master-password protection is enabled without a stored password", async () => {
    delete dashboard.masterPassword;

    const result: Awaited<ReturnType<typeof DashboardService.hasReadAccess>> =
      await DashboardService.hasReadAccess({
        dashboardId,
        req: mockRequest,
      });

    expect(result.hasReadAccess).toBe(false);
    expect(result.error).toBeInstanceOf(MasterPasswordRequiredException);
    expect(result.error?.message).toBe(
      DASHBOARD_MASTER_PASSWORD_REQUIRED_MESSAGE,
    );
  });

  it("issues a dashboard-scoped cookie for the correct password and unlocks only that dashboard", async () => {
    await mockRouter
      .match("post", "/dashboard/master-password/:dashboardId")
      .handlerFunction(mockRequest, mockResponse, nextFunction);

    expect(nextFunction).not.toHaveBeenCalled();
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
      mockRequest,
      mockResponse,
    );
    expect(mockResponse.cookie).toHaveBeenCalledTimes(1);

    const cookieCall: Array<unknown> = (mockResponse.cookie as jest.Mock).mock
      .calls[0] as Array<unknown>;
    const cookieName: string = cookieCall[0] as string;
    const cookieToken: string = cookieCall[1] as string;

    expect(cookieName).toBe(
      CookieUtil.getDashboardMasterPasswordKey(dashboardId),
    );
    expect(cookieToken).toEqual(expect.any(String));

    const unlockedRequest: ExpressRequest = {
      cookies: {
        [cookieName]: cookieToken,
      },
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    const unlockedResult: Awaited<
      ReturnType<typeof DashboardService.hasReadAccess>
    > = await DashboardService.hasReadAccess({
      dashboardId,
      req: unlockedRequest,
    });

    expect(unlockedResult.hasReadAccess).toBe(true);
    expect(unlockedResult.error).toBeUndefined();

    const otherDashboardId: ObjectID = ObjectID.generate();
    const copiedCookieRequest: ExpressRequest = {
      cookies: {
        [CookieUtil.getDashboardMasterPasswordKey(otherDashboardId)]:
          cookieToken,
      },
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    const isolatedResult: Awaited<
      ReturnType<typeof DashboardService.hasReadAccess>
    > = await DashboardService.hasReadAccess({
      dashboardId: otherDashboardId,
      req: copiedCookieRequest,
    });

    expect(isolatedResult.hasReadAccess).toBe(false);
    expect(isolatedResult.error).toBeInstanceOf(
      MasterPasswordRequiredException,
    );
  });

  it("rejects an incorrect password without issuing a cookie", async () => {
    mockRequest.body["password"] = "incorrect password";

    await mockRouter
      .match("post", "/dashboard/master-password/:dashboardId")
      .handlerFunction(mockRequest, mockResponse, nextFunction);

    expect(nextFunction).toHaveBeenCalledTimes(1);

    const error: unknown = (nextFunction as jest.Mock).mock.calls[0]?.[0];

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).message).toBe(
      DASHBOARD_MASTER_PASSWORD_INVALID_MESSAGE,
    );
    expect(mockResponse.cookie).not.toHaveBeenCalled();
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });
});
