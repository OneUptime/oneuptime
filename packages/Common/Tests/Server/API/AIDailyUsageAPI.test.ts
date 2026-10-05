import { mockRouter } from "./Helpers";
import "../../../Server/API/AIDailyUsageAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AIService from "../../../Server/Services/AIService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { ProjectAiDailyLimit } from "../../../Types/AI/ProjectAiDailyLimits";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

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
  };
});

type MockBillingGlobal = typeof globalThis & {
  __aiDailyUsageApiTestBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__aiDailyUsageApiTestBillingEnabled = false;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__aiDailyUsageApiTestBillingEnabled;
    },
  });

  return mocked;
});

function setBillingEnabled(value: boolean): void {
  (globalThis as MockBillingGlobal).__aiDailyUsageApiTestBillingEnabled = value;
}

/*
 * POST /ai/daily-usage: what a project's AI used today, against its own
 * daily AI limits - the line under Project Settings → AI Features → More
 * settings.
 *
 * The figures are sums of the project's AI Logs, so the caller must be
 * able to read those: getUserMiddleware lets anonymous callers through and
 * takes the project from a header, so the route checks the caller itself -
 * no credentials is 401, a member (or a project API key) without LlmLog's
 * read permissions is refused, and only then is anything read. Spend is
 * answered only where AI is billed.
 */

const ROUTE: string = "/ai/daily-usage";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

function tenantPermissions(
  permissions: Array<Permission>,
  blocked: Array<Permission> = [],
): Dictionary<UserTenantAccessPermission> {
  const dictionary: Dictionary<UserTenantAccessPermission> = {};

  dictionary[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [
      ...permissions.map((permission: Permission) => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        } as UserPermission;
      }),
      ...blocked.map((permission: Permission) => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: true,
        } as UserPermission;
      }),
    ],
    isBlockPermission: false,
  } as UserTenantAccessPermission;

  return dictionary;
}

function memberProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userType: UserType.User,
    userId: USER_ID,
    userTenantAccessPermission: tenantPermissions(permissions),
  };
}

let usageRead: jest.SpyInstance;

function withProps(props: DatabaseCommonInteractionProps): void {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);
}

async function call(): Promise<{ thrown: unknown; sent: JSONObject | null }> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: {},
    headers: {},
  } as unknown as ExpressRequest;
  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("post", ROUTE)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  const sendJson: jest.Mock = Response.sendJsonObjectResponse as jest.Mock;

  return {
    thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    sent: sendJson.mock.calls[0]
      ? (sendJson.mock.calls[0][2] as JSONObject)
      : null,
  };
}

beforeEach(() => {
  setBillingEnabled(false);
  (Response.sendJsonObjectResponse as jest.Mock).mockClear();
  usageRead = jest.spyOn(AIService, "getProjectDailyUsage").mockResolvedValue({
    limits: { tokenLimit: 200000, spendLimitInUSD: null },
    usage: { usedTokensToday: 45210, spentTodayInUSDCents: 0 },
    reachedLimit: null,
    dayStartedAt: new Date("2026-10-05T00:00:00.000Z"),
    resetsAt: new Date("2026-10-06T00:00:00.000Z"),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  setBillingEnabled(false);
});

describe("POST /ai/daily-usage", () => {
  test("is a POST behind the user middleware", () => {
    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "post",
      ROUTE,
    );

    expect(route.middlewares).toEqual([UserMiddleware.getUserMiddleware]);
  });

  test("answers a project member who may read the AI Logs with today's usage", async () => {
    withProps(memberProps([Permission.ProjectMember]));

    const result: { thrown: unknown; sent: JSONObject | null } = await call();

    expect(result.thrown).toBeUndefined();
    expect(usageRead).toHaveBeenCalledWith(PROJECT_ID);
    expect(result.sent).toEqual({
      usedTokensToday: 45210,
      spentTodayInUSDCents: null,
      tokenLimit: 200000,
      spendLimitInUSD: null,
      reachedLimit: null,
      dayStartedAt: "2026-10-05T00:00:00.000Z",
      resetsAt: "2026-10-06T00:00:00.000Z",
    });
  });

  test.each([
    [Permission.ProjectOwner],
    [Permission.ProjectAdmin],
    [Permission.Viewer],
    [Permission.ReadLlmLog],
  ])("%s may read it", async (permission: Permission) => {
    withProps(memberProps([permission]));

    const result: { thrown: unknown; sent: JSONObject | null } = await call();

    expect(result.thrown).toBeUndefined();
    expect(result.sent).not.toBeNull();
  });

  test("answers spend where AI is billed", async () => {
    setBillingEnabled(true);
    usageRead.mockResolvedValue({
      limits: { tokenLimit: null, spendLimitInUSD: 25 },
      usage: { usedTokensToday: 900000, spentTodayInUSDCents: 2500 },
      reachedLimit: ProjectAiDailyLimit.Spend,
      dayStartedAt: new Date("2026-10-05T00:00:00.000Z"),
      resetsAt: new Date("2026-10-06T00:00:00.000Z"),
    });
    withProps(memberProps([Permission.ProjectOwner]));

    const result: { thrown: unknown; sent: JSONObject | null } = await call();

    expect(result.sent).toEqual(
      expect.objectContaining({
        usedTokensToday: 900000,
        spentTodayInUSDCents: 2500,
        spendLimitInUSD: 25,
        reachedLimit: "Spend",
      }),
    );
  });

  test("an expired session is 401, before anything is read", async () => {
    withProps({
      tenantId: PROJECT_ID,
      userType: UserType.Public,
      userId: undefined,
      userTenantAccessPermission: undefined,
    });

    const result: { thrown: unknown; sent: JSONObject | null } = await call();

    expect(result.thrown).toBeInstanceOf(NotAuthenticatedException);
    expect(usageRead).not.toHaveBeenCalled();
    expect(result.sent).toBeNull();
  });

  test("a signed-in user of another project is refused, before anything is read", async () => {
    withProps({
      tenantId: PROJECT_ID,
      userType: UserType.User,
      userId: USER_ID,
      userTenantAccessPermission: {},
    });

    const result: { thrown: unknown; sent: JSONObject | null } = await call();

    expect(result.thrown).toBeInstanceOf(NotAuthorizedException);
    expect(usageRead).not.toHaveBeenCalled();
  });

  test("a member whose teams grant no AI Logs read is refused", async () => {
    withProps(memberProps([Permission.ReadProjectMonitor]));

    const result: { thrown: unknown; sent: JSONObject | null } = await call();

    expect(result.thrown).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrown as Error).message).toBe(
      "You do not have permission to read this project's AI usage.",
    );
    expect(usageRead).not.toHaveBeenCalled();
  });

  test("a team block on reading the AI Logs is honoured", async () => {
    withProps({
      tenantId: PROJECT_ID,
      userType: UserType.User,
      userId: USER_ID,
      userTenantAccessPermission: tenantPermissions(
        [Permission.ProjectMember],
        [Permission.ProjectMember],
      ),
    });

    const result: { thrown: unknown; sent: JSONObject | null } = await call();

    expect(result.thrown).toBeDefined();
    expect(usageRead).not.toHaveBeenCalled();
  });

  test("a project API key that may read the AI Logs is answered", async () => {
    withProps({
      tenantId: PROJECT_ID,
      userType: UserType.API,
      userId: undefined,
      userTenantAccessPermission: tenantPermissions([Permission.ReadLlmLog]),
    });

    const result: { thrown: unknown; sent: JSONObject | null } = await call();

    expect(result.thrown).toBeUndefined();
    expect(usageRead).toHaveBeenCalledWith(PROJECT_ID);
  });
});
