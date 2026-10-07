import { mockRouter } from "./Helpers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import "../../../Server/API/NotificationAPI";
import "../../../Server/API/AIBillingAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ProjectService from "../../../Server/Services/ProjectService";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Project from "../../../Models/DatabaseModels/Project";
import AutoRechargeState from "../../../Types/Billing/AutoRechargeState";
import ProjectBalanceType from "../../../Types/Billing/ProjectBalanceType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { PROJECT_BALANCE_AUTO_RECHARGE_STATE_ROUTE } from "../../../Utils/Project/ProjectBalance";

/*
 * GET /notification/auto-recharge-state and GET /ai/auto-recharge-state:
 * what Auto Recharge of each balance would do now, for the page that holds
 * it - which shows "Auto Recharge could not charge the card" at the top
 * while the answer is Failed, so nobody has to wait for the owners' email.
 *
 * Any member of the project may ask (every member reads the Auto Recharge
 * settings on those pages); nobody else learns anything - not even whether
 * the project exists. Each route answers for its own balance: a failed AI
 * charge is not the SMS balance's, and the other way round.
 */

type MockBillingGlobal = typeof globalThis & {
  __autoRechargeStateRouteBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__autoRechargeStateRouteBillingEnabled = true;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__autoRechargeStateRouteBillingEnabled;
    },
  });

  return mocked;
});
jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});
jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});
jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
      requireUserAuthentication: jest.fn(),
    },
  };
});

function setBillingEnabled(value: boolean): void {
  (globalThis as MockBillingGlobal).__autoRechargeStateRouteBillingEnabled =
    value;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000b1",
);

interface BalanceRoute {
  balance: ProjectBalanceType;
  name: string;
  failureNamespace: string;
  otherFailureNamespace: string;
  project: Record<string, unknown>;
}

const ROUTES: Array<BalanceRoute> = [
  {
    balance: ProjectBalanceType.SmsOrCall,
    name: "SMS and call balance",
    failureNamespace: "sms-or-call-auto-recharge-failed",
    otherFailureNamespace: "ai-auto-recharge-failed",
    project: {
      enableAutoRechargeSmsOrCallBalance: true,
      autoRechargeSmsOrCallByBalanceInUSD: 20,
      autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
    },
  },
  {
    balance: ProjectBalanceType.AI,
    name: "AI credits",
    failureNamespace: "ai-auto-recharge-failed",
    otherFailureNamespace: "sms-or-call-auto-recharge-failed",
    project: {
      enableAutoRechargeAiBalance: true,
      autoAiRechargeByBalanceInUSD: 20,
      autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
    },
  },
];

let cache: Map<string, string>;
let project: Record<string, unknown> | null;

function member(
  options: { projectId?: ObjectID; isMasterAdmin?: boolean } = {},
): OneUptimeRequest {
  const rowsFor: ObjectID = options.projectId || PROJECT_ID;

  return {
    tenantId: PROJECT_ID,
    userAuthorization: { isMasterAdmin: Boolean(options.isMasterAdmin) },
    userTenantAccessPermission: {
      [rowsFor.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: rowsFor,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.ProjectMember,
            labelIds: [],
          },
        ],
      },
    },
  } as unknown as OneUptimeRequest;
}

async function ask(
  route: BalanceRoute,
  req: OneUptimeRequest,
): Promise<{ state: string | undefined; error: unknown }> {
  const next: ReturnType<typeof jest.fn> = jest.fn();

  await mockRouter
    .match("get", PROJECT_BALANCE_AUTO_RECHARGE_STATE_ROUTE[route.balance])
    .handlerFunction(
      req,
      {} as OneUptimeResponse,
      next as unknown as NextFunction,
    );

  const sent: Array<unknown> | undefined = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls[0] as Array<unknown> | undefined;

  return {
    state: sent
      ? ((sent[2] as Record<string, unknown>)["state"] as string)
      : undefined,
    error: next.mock.calls[0]?.[0],
  };
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  setBillingEnabled(true);
  cache = new Map<string, string>();
  project = null;

  jest.spyOn(GlobalCache, "getString").mockImplementation((async (
    namespace: string,
    key: string,
  ) => {
    return cache.get(`${namespace}-${key}`) || null;
  }) as never);

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    return project ? (Object.assign(new Project(), project) as Project) : null;
  }) as never);
});

test("both routes are where the pages ask, behind sign-in", () => {
  expect(PROJECT_BALANCE_AUTO_RECHARGE_STATE_ROUTE).toEqual({
    [ProjectBalanceType.SmsOrCall]: "/notification/auto-recharge-state",
    [ProjectBalanceType.AI]: "/ai/auto-recharge-state",
  });

  for (const uri of Object.values(PROJECT_BALANCE_AUTO_RECHARGE_STATE_ROUTE)) {
    expect(mockRouter.match("get", uri).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  }
});

describe.each(ROUTES)("$name", (route: BalanceRoute) => {
  test("its last automatic charge failed: Failed, to any member", async () => {
    project = route.project;
    cache.set(`${route.failureNamespace}-${PROJECT_ID.toString()}`, "x");

    expect((await ask(route, member())).state).toBe(AutoRechargeState.Failed);
  });

  test("set up, with no failure: Ready", async () => {
    project = route.project;

    expect((await ask(route, member())).state).toBe(AutoRechargeState.Ready);
  });

  test("the other balance's failure is not this one's", async () => {
    project = route.project;
    cache.set(`${route.otherFailureNamespace}-${PROJECT_ID.toString()}`, "x");

    expect((await ask(route, member())).state).toBe(AutoRechargeState.Ready);
  });

  test("Auto Recharge off: Off, even with a failure remembered", async () => {
    project = Object.fromEntries(
      Object.keys(route.project).map((column: string) => {
        return [column, column.startsWith("enable") ? false : 20];
      }),
    );
    cache.set(`${route.failureNamespace}-${PROJECT_ID.toString()}`, "x");

    expect((await ask(route, member())).state).toBe(AutoRechargeState.Off);
  });

  test("it reads only this balance's Auto Recharge columns, as root", async () => {
    project = route.project;

    await ask(route, member());

    const call: { select: Record<string, boolean>; props: unknown } = (
      ProjectService.findOneById as unknown as jest.Mock
    ).mock.calls[0]![0] as { select: Record<string, boolean>; props: unknown };

    expect(Object.keys(call.select).sort()).toEqual(
      Object.keys(route.project).sort(),
    );
    expect(call.props).toEqual({ isRoot: true });
  });

  test("not a member of the project: refused, and nothing about the project is read", async () => {
    project = route.project;

    const { state, error } = await ask(
      route,
      member({ projectId: ObjectID.generate() }),
    );

    expect(state).toBeUndefined();
    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "You do not have access to this project",
    );
    expect(ProjectService.findOneById).not.toHaveBeenCalled();
  });

  test("a master admin may ask", async () => {
    project = route.project;
    cache.set(`${route.failureNamespace}-${PROJECT_ID.toString()}`, "x");

    expect(
      (
        await ask(
          route,
          member({ projectId: ObjectID.generate(), isMasterAdmin: true }),
        )
      ).state,
    ).toBe(AutoRechargeState.Failed);
  });

  test("no project named: refused", async () => {
    const req: OneUptimeRequest = member();
    delete (req as unknown as Record<string, unknown>)["tenantId"];

    const { error } = await ask(route, req);

    expect((error as Error).message).toBe("Project ID is required");
  });

  test("where OneUptime does not bill: Off, without reading the project", async () => {
    setBillingEnabled(false);

    expect((await ask(route, member())).state).toBe(AutoRechargeState.Off);
    expect(ProjectService.findOneById).not.toHaveBeenCalled();
  });

  test("a project that is gone: an error, not a state", async () => {
    project = null;

    const { state, error } = await ask(route, member());

    expect(state).toBeUndefined();
    expect((error as Error).message).toBe("Project not found");
  });

  test("the shared cache is down: Ready (the failure cannot be read, and nothing is charged without it anyway)", async () => {
    project = route.project;
    (GlobalCache.getString as unknown as jest.Mock).mockImplementation(
      (async () => {
        throw new Error("Cache is not connected");
      }) as never,
    );

    expect((await ask(route, member())).state).toBe(AutoRechargeState.Ready);
  });
});
