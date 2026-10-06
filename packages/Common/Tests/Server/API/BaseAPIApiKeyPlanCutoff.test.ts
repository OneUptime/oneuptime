import BaseAPI from "../../../Server/API/BaseAPI";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService, {
  CurrentPlan,
} from "../../../Server/Services/ProjectService";
import {
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import LogPipeline from "../../../Models/DatabaseModels/LogPipeline";
import { getApiKeysStoppedMessage } from "../../../Types/Billing/PlanCutoffCredentials";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Exception from "../../../Types/Exception/Exception";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

/*
 * Every route of the REST API that a project's API key reaches - here every
 * CRUD route BaseAPI registers for a model, reads and writes alike - stops
 * answering the key once the project is below Growth, and answers it again
 * once it is back. The refusal is the API-key middleware's, ahead of each
 * route's handler, so it holds for any model and any route behind
 * UserMiddleware.getUserMiddleware; LogPipeline is used because every plan
 * may use it, so the key's plan is the only thing that can refuse.
 *
 * Terraform, the CLI, the MCP server's API-key mode and any script call
 * exactly these routes with the key in the ApiKey header.
 */

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const API_KEY_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000001",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000002",
);
const RECORD_ID: string = "7c000000-0000-4000-8000-000000000003";
const API_KEY: string = "7c000000-0000-4000-8000-000000000004";

/*
 * Registered once, at module load: mockRouter.match returns the first route
 * with a method and path, and that route closes over the instance that
 * registered it.
 */
const logPipelineService: DatabaseService<LogPipeline> =
  new DatabaseService<LogPipeline>(LogPipeline);
const logPipelineApi: BaseAPI<
  LogPipeline,
  DatabaseService<LogPipeline>
> = new BaseAPI<LogPipeline, DatabaseService<LogPipeline>>(
  LogPipeline,
  logPipelineService,
);

const PATH: string = new LogPipeline().getCrudApiPath()!.toString();

type ApiMethod =
  | "createItem"
  | "getList"
  | "count"
  | "getItem"
  | "updateItem"
  | "deleteItem";

// Every CRUD route, and the BaseAPI method its handler serves it with.
const ROUTES: ReadonlyArray<{
  method: string;
  uri: string;
  serves: ApiMethod;
  isWrite: boolean;
}> = [
  { method: "POST", uri: PATH, serves: "createItem", isWrite: true },
  { method: "POST", uri: `${PATH}/get-list`, serves: "getList", isWrite: false },
  { method: "GET", uri: `${PATH}/get-list`, serves: "getList", isWrite: false },
  { method: "POST", uri: `${PATH}/count`, serves: "count", isWrite: false },
  {
    method: "POST",
    uri: `${PATH}/:id/get-item`,
    serves: "getItem",
    isWrite: false,
  },
  {
    method: "GET",
    uri: `${PATH}/:id/get-item`,
    serves: "getItem",
    isWrite: false,
  },
  { method: "PUT", uri: `${PATH}/:id`, serves: "updateItem", isWrite: true },
  {
    method: "POST",
    uri: `${PATH}/:id/update-item`,
    serves: "updateItem",
    isWrite: true,
  },
  { method: "DELETE", uri: `${PATH}/:id`, serves: "deleteItem", isWrite: true },
  {
    method: "POST",
    uri: `${PATH}/:id/delete-item`,
    serves: "deleteItem",
    isWrite: true,
  },
];

const savedPlanEnvironment: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUBSCRIPTION_PLAN_")) {
      savedPlanEnvironment[key] = process.env[key];
      delete process.env[key];
    }
  }

  Object.assign(process.env, PLAN_ENVIRONMENT);
});

afterAll(() => {
  for (const key of Object.keys(PLAN_ENVIRONMENT)) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(savedPlanEnvironment)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }

  setTestBillingEnabled(false);
});

let getCurrentPlan: ReturnType<typeof getJestSpyOn>;
let served: Record<ApiMethod, ReturnType<typeof getJestSpyOn>>;

const onPlan: (plan: PlanType) => void = (plan: PlanType): void => {
  getCurrentPlan.mockResolvedValue({
    plan: plan,
    isSubscriptionUnpaid: false,
  } as CurrentPlan);
};

beforeEach(() => {
  setTestBillingEnabled(true);

  getJestSpyOn(ApiKeyService, "findApiKey").mockResolvedValue({
    id: API_KEY_ID,
    projectId: PROJECT_ID,
  });
  getJestSpyOn(
    ApiKeyPermissionService,
    "findPermissionsByApiKeyId",
  ).mockResolvedValue([
    {
      permission: Permission.ProjectAdmin,
      labelIds: [],
      isBlockPermission: false,
    },
  ]);
  getJestSpyOn(GlobalConfigService, "findOneBy").mockResolvedValue(null);
  getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(
    undefined,
  );
  getCurrentPlan = getJestSpyOn(ProjectService, "getCurrentPlan");
  onPlan(PlanType.Free);

  // Each handler's work stops at its BaseAPI method: reaching it is the answer.
  served = {
    createItem: getJestSpyOn(logPipelineApi, "createItem").mockResolvedValue(
      undefined,
    ),
    getList: getJestSpyOn(logPipelineApi, "getList").mockResolvedValue(
      undefined,
    ),
    count: getJestSpyOn(logPipelineApi, "count").mockResolvedValue(undefined),
    getItem: getJestSpyOn(logPipelineApi, "getItem").mockResolvedValue(
      undefined,
    ),
    updateItem: getJestSpyOn(logPipelineApi, "updateItem").mockResolvedValue(
      undefined,
    ),
    deleteItem: getJestSpyOn(logPipelineApi, "deleteItem").mockResolvedValue(
      undefined,
    ),
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

interface RouteOutcome {
  error: Exception | null;
  request: OneUptimeRequest;
}

/*
 * A route the way Express runs it: its middleware first, then - only when no
 * middleware handed an error to next() - its handler.
 */
const callRoute: (route: {
  method: string;
  uri: string;
}) => Promise<RouteOutcome> = async (route: {
  method: string;
  uri: string;
}): Promise<RouteOutcome> => {
  const registered: ReturnType<typeof mockRouter.match> = mockRouter.match(
    route.method,
    route.uri,
  );

  const request: OneUptimeRequest = {
    headers: { apikey: API_KEY },
    params: { id: RECORD_ID },
    query: {},
    body: { data: { name: "Pipeline" }, query: {}, select: { _id: true } },
  } as unknown as OneUptimeRequest;

  const response: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const captured: { error: Exception | null } = { error: null };

  const next: NextFunction = ((error?: unknown): void => {
    if (error) {
      captured.error = error as Exception;
    }
  }) as unknown as NextFunction;

  for (const middleware of registered.middlewares) {
    await middleware(request, response, next);

    if (captured.error) {
      return { error: captured.error, request };
    }
  }

  await registered.handlerFunction(request, response, next);

  return { error: captured.error, request };
};

const totalServed: () => number = (): number => {
  return Object.values(served).reduce(
    (total: number, spy: ReturnType<typeof getJestSpyOn>): number => {
      return total + spy.mock.calls.length;
    },
    0,
  );
};

describe("the CRUD routes a key reaches", () => {
  test("are every route BaseAPI registers for the model, each behind the user middleware", () => {
    const registered: Array<string> = mockRouter.routes
      .filter((route: { uri: string }) => {
        return route.uri === PATH || route.uri.startsWith(`${PATH}/`);
      })
      .map((route: { method: string; uri: string }) => {
        return `${route.method} ${route.uri}`;
      })
      .sort();

    expect(registered).toEqual(
      ROUTES.map((route: { method: string; uri: string }) => {
        return `${route.method} ${route.uri}`;
      }).sort(),
    );
  });
});

describe("below Growth, with billing on", () => {
  test.each(ROUTES)(
    "$method $uri refuses the key with 402 before its handler runs",
    async (route: { method: string; uri: string }) => {
      const outcome: RouteOutcome = await callRoute(route);

      expect(outcome.error).toBeInstanceOf(PaymentRequiredException);
      expect(outcome.error!.code).toBe(402);
      expect(outcome.error!.message).toBe(
        getApiKeysStoppedMessage(PlanType.Growth),
      );
      expect(totalServed()).toBe(0);
    },
  );

  test("a read and a write are refused alike", async () => {
    const read: RouteOutcome = await callRoute({
      method: "POST",
      uri: `${PATH}/get-list`,
    });
    const write: RouteOutcome = await callRoute({
      method: "POST",
      uri: PATH,
    });

    expect(read.error!.message).toBe(write.error!.message);
    expect(served.getList).not.toHaveBeenCalled();
    expect(served.createItem).not.toHaveBeenCalled();
  });
});

describe("on a plan that includes API keys, with billing on", () => {
  test.each(ROUTES)(
    "$method $uri lets the key through to its handler",
    async (route: { method: string; uri: string; serves: ApiMethod }) => {
      onPlan(PlanType.Growth);

      const outcome: RouteOutcome = await callRoute(route);

      expect(outcome.error).toBeNull();
      expect(outcome.request.userType).toBe(UserType.API);
      expect(served[route.serves]).toHaveBeenCalledTimes(1);
      expect(totalServed()).toBe(1);
    },
  );
});

describe("after an upgrade", () => {
  test("the same key reads and writes again, with nothing about it changed", async () => {
    const refused: RouteOutcome = await callRoute({
      method: "PUT",
      uri: `${PATH}/:id`,
    });

    expect(refused.error).toBeInstanceOf(PaymentRequiredException);

    onPlan(PlanType.Scale);

    const write: RouteOutcome = await callRoute({
      method: "PUT",
      uri: `${PATH}/:id`,
    });
    const read: RouteOutcome = await callRoute({
      method: "GET",
      uri: `${PATH}/:id/get-item`,
    });

    expect(write.error).toBeNull();
    expect(read.error).toBeNull();
    expect(served.updateItem).toHaveBeenCalledTimes(1);
    expect(served.getItem).toHaveBeenCalledTimes(1);
  });
});

describe("with billing off (self-hosted)", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
  });

  test.each(ROUTES)(
    "$method $uri answers the key on any plan",
    async (route: { method: string; uri: string; serves: ApiMethod }) => {
      const outcome: RouteOutcome = await callRoute(route);

      expect(outcome.error).toBeNull();
      expect(served[route.serves]).toHaveBeenCalledTimes(1);
      expect(getCurrentPlan).not.toHaveBeenCalled();
    },
  );
});
