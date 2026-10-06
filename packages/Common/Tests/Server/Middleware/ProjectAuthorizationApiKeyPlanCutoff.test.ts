import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import User from "../../../Models/DatabaseModels/User";
import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService, {
  CurrentPlan,
} from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import { getApiKeysStoppedMessage } from "../../../Types/Billing/PlanCutoffCredentials";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import getJestMockFunction, { MockFunction } from "../../MockType";
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

/*
 * Below the plan that sells API keys (Growth), a project's API keys stop
 * working: the API-key middleware - the one door every API-key request goes
 * through - refuses the key with a 402 that names the plan, once the key has
 * checked out and before anything is read with it. The key is not touched:
 * the same key works again as soon as the project is back on the plan.
 * Self-hosted (billing off) and the instance's master key are not affected.
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

const API_KEY_VALUE: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000001",
);
const API_KEY_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000002",
);
const KEY_PROJECT_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000003",
);
const MASTER_API_KEY_VALUE: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000004",
);
const MASTER_ADMIN_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000005",
);

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

let findApiKey: ReturnType<typeof getJestSpyOn>;
let findApiKeyPermissions: ReturnType<typeof getJestSpyOn>;
let globalConfigFindOneBy: ReturnType<typeof getJestSpyOn>;
let userFindOneBy: ReturnType<typeof getJestSpyOn>;
let getCurrentPlan: ReturnType<typeof getJestSpyOn>;

const onPlan: (
  plan: PlanType | null,
  isSubscriptionUnpaid?: boolean,
) => void = (plan: PlanType | null, isSubscriptionUnpaid?: boolean): void => {
  getCurrentPlan.mockResolvedValue({
    plan: plan,
    isSubscriptionUnpaid: Boolean(isSubscriptionUnpaid),
  } as CurrentPlan);
};

beforeEach(() => {
  setTestBillingEnabled(true);

  // The key resolves to its project, carrying one permission.
  findApiKey = getJestSpyOn(ApiKeyService, "findApiKey").mockResolvedValue({
    id: API_KEY_ID,
    projectId: KEY_PROJECT_ID,
    name: "Terraform",
  });
  findApiKeyPermissions = getJestSpyOn(
    ApiKeyPermissionService,
    "findPermissionsByApiKeyId",
  ).mockResolvedValue([
    {
      permission: Permission.ProjectAdmin,
      labelIds: [],
      isBlockPermission: false,
    },
  ]);
  globalConfigFindOneBy = getJestSpyOn(
    GlobalConfigService,
    "findOneBy",
  ).mockResolvedValue(null);
  userFindOneBy = getJestSpyOn(UserService, "findOneBy").mockResolvedValue(
    null,
  );
  getCurrentPlan = getJestSpyOn(ProjectService, "getCurrentPlan");
  onPlan(PlanType.Growth);
});

afterEach(() => {
  jest.restoreAllMocks();
});

interface Outcome {
  error: Exception | null;
  request: OneUptimeRequest;
}

// The middleware as Express runs it: it never rejects, it calls next once.
const authenticate: (
  headers: Record<string, string>,
) => Promise<Outcome> = async (
  headers: Record<string, string>,
): Promise<Outcome> => {
  const request: OneUptimeRequest = {
    headers: headers,
    params: {},
    query: {},
    body: {},
  } as unknown as OneUptimeRequest;

  const next: MockFunction = getJestMockFunction();

  await expect(
    ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware(
      request as unknown as ExpressRequest,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    ),
  ).resolves.toBeUndefined();

  expect(next).toHaveBeenCalledTimes(1);

  return {
    error: (next.mock.calls[0]![0] as Exception | undefined) || null,
    request,
  };
};

const withKey: () => Promise<Outcome> = async (): Promise<Outcome> => {
  return await authenticate({ apikey: API_KEY_VALUE.toString() });
};

describe("a project below Growth (billing on)", () => {
  beforeEach(() => {
    onPlan(PlanType.Free);
  });

  test("has its API key refused with a 402", async () => {
    const outcome: Outcome = await withKey();

    expect(outcome.error).toBeInstanceOf(PaymentRequiredException);
    expect(outcome.error!.code).toBe(402);
  });

  test("is told the plan the keys need, that they are kept, and where to upgrade", async () => {
    const outcome: Outcome = await withKey();

    expect(outcome.error!.message).toBe(
      getApiKeysStoppedMessage(PlanType.Growth),
    );
  });

  test("checks the plan of the project the key belongs to, not one the caller names", async () => {
    await authenticate({
      apikey: API_KEY_VALUE.toString(),
      tenantid: "7b000000-0000-4000-8000-0000000000ff",
    });

    expect(getCurrentPlan).toHaveBeenCalledTimes(1);
    expect(String(getCurrentPlan.mock.calls[0]![0])).toBe(
      KEY_PROJECT_ID.toString(),
    );
  });

  test("leaves no identity on the request and reads nothing with the key", async () => {
    const outcome: Outcome = await withKey();
    const request: OneUptimeRequest = outcome.request;

    expect(request.userType).toBeUndefined();
    expect(request.apiKeyId).toBeUndefined();
    expect(request.userTenantAccessPermission).toBeUndefined();
    expect(request.userGlobalAccessPermission).toBeUndefined();
    expect(findApiKeyPermissions).not.toHaveBeenCalled();
  });

  /*
   * The cut-off is the key's, not the master key's fallback: a refused key
   * is not then tried as the instance's master key.
   */
  test("is not retried as the master key", async () => {
    await withKey();

    expect(globalConfigFindOneBy).not.toHaveBeenCalled();
    expect(userFindOneBy).not.toHaveBeenCalled();
  });

  test("is refused whatever the subscription state, an unpaid one included", async () => {
    onPlan(PlanType.Free, true);

    const outcome: Outcome = await withKey();

    expect(outcome.error).toBeInstanceOf(PaymentRequiredException);
    expect(outcome.error!.message).toBe(
      getApiKeysStoppedMessage(PlanType.Growth),
    );
  });
});

describe("a project on a plan that includes API keys (billing on)", () => {
  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "on %s, the key works as before",
    async (plan: PlanType) => {
      onPlan(plan);

      const outcome: Outcome = await withKey();

      expect(outcome.error).toBeNull();
      expect(outcome.request.userType).toBe(UserType.API);
      expect(String(outcome.request.tenantId)).toBe(KEY_PROJECT_ID.toString());
      expect(String(outcome.request.apiKeyId)).toBe(API_KEY_ID.toString());
      expect(outcome.request.apiKeyName).toBe("Terraform");
      expect(findApiKeyPermissions).toHaveBeenCalledTimes(1);
    },
  );

  /*
   * The unpaid checks are the rest of billing's to make, record by record,
   * as before: the key itself still authenticates.
   */
  test("an unpaid subscription on the plan still authenticates the key", async () => {
    onPlan(PlanType.Growth, true);

    const outcome: Outcome = await withKey();

    expect(outcome.error).toBeNull();
    expect(outcome.request.userType).toBe(UserType.API);
  });
});

describe("an upgrade", () => {
  test("turns the same key back on, with nothing about the key changed", async () => {
    onPlan(PlanType.Free);

    const refused: Outcome = await withKey();

    expect(refused.error).toBeInstanceOf(PaymentRequiredException);

    onPlan(PlanType.Growth);

    const accepted: Outcome = await withKey();

    expect(accepted.error).toBeNull();
    expect(accepted.request.userType).toBe(UserType.API);
  });

  test("and a downgrade stops it again", async () => {
    onPlan(PlanType.Scale);

    expect((await withKey()).error).toBeNull();

    onPlan(PlanType.Free);

    expect((await withKey()).error).toBeInstanceOf(PaymentRequiredException);
  });
});

describe("billing off (self-hosted)", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
  });

  test.each([PlanType.Free, PlanType.Growth, null])(
    "the key works whatever plan is stored (%s), and no plan is read",
    async (plan: PlanType | null) => {
      onPlan(plan);

      const outcome: Outcome = await withKey();

      expect(outcome.error).toBeNull();
      expect(outcome.request.userType).toBe(UserType.API);
      expect(getCurrentPlan).not.toHaveBeenCalled();
    },
  );
});

describe("what the plan check never sees", () => {
  beforeEach(() => {
    onPlan(PlanType.Free);
  });

  /*
   * A caller without a valid key learns nothing about any project's plan:
   * the plan is read only once a key has checked out.
   */
  test("an unknown key is refused as invalid, and no plan is read", async () => {
    findApiKey.mockResolvedValue(null);

    const outcome: Outcome = await withKey();

    expect(outcome.error).toBeInstanceOf(BadDataException);
    expect(outcome.error!.message).toBe("Invalid API Key");
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });

  test("a malformed key is refused as invalid, and no plan is read", async () => {
    const outcome: Outcome = await authenticate({ apikey: "not-a-key" });

    expect(outcome.error).toBeInstanceOf(BadDataException);
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });

  /*
   * The instance's master key is not an API key of a project: it has no
   * project plan, and it keeps working as the master admin.
   */
  test("the instance's master key is not held to a project's plan", async () => {
    findApiKey.mockResolvedValue(null);

    const masterConfig: GlobalConfig = new GlobalConfig();
    masterConfig._id = ObjectID.getZeroObjectID().toString();
    globalConfigFindOneBy.mockResolvedValue(masterConfig);

    const masterAdmin: User = new User();
    masterAdmin._id = MASTER_ADMIN_ID.toString();
    masterAdmin.email = new Email("admin@example.com");
    masterAdmin.name = new Name("Master Admin");
    userFindOneBy.mockResolvedValue(masterAdmin);

    const outcome: Outcome = await authenticate({
      apikey: MASTER_API_KEY_VALUE.toString(),
    });

    expect(outcome.error).toBeNull();
    expect(outcome.request.userType).toBe(UserType.MasterAdmin);
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });
});
