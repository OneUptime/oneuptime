import { mockRouter } from "./Helpers";
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

/*
 * WHAT THIS FILE DEFENDS
 *
 * Test LLM Provider, as the people who press it: the request the Dashboard
 * sends (POST /llm-provider/test, the provider's id, the project in the
 * tenant header), the caller's real permissions, the route's own access
 * rule (LlmProviderTestAccess) and the permission layer behind it - nothing
 * of it stubbed but the provider's table, held in memory, and the call to
 * the LLM provider itself.
 *
 * A customer added their own OpenAI provider, pressed Test, and read "You do
 * not have permissions to select on - isGlobalLlm. You need any one of these
 * permissions:". So did every project member, the owner included, since the
 * button shipped: its access check read the provider with the caller's props
 * and selected isGlobalLlm, a column no project role may read. The suites
 * before this one stubbed that read, and server administrators - who tried
 * the button - skip every column check.
 *
 * The rule now, as the docs say it (ai/llm-provider.md):
 *
 *   - whoever may change a project's provider tests it, in its project:
 *     Project Owner, Project Admin, Project Member, Settings Admin, Settings
 *     Member and Edit LLM - the provider's update list, team blocks, a
 *     credential issued for reading only and the plan counted;
 *   - everyone else who may read providers sees the button locked, and the
 *     API refuses them in the same words;
 *   - a global provider is tested by a server administrator, from the Admin
 *     Dashboard;
 *   - another project's provider and one that does not exist are answered
 *     alike.
 */

type MockBillingGlobal = typeof globalThis & {
  __llmProviderTestBillingEnabled: boolean;
};

/*
 * Billing on, as Common Test runs: every plan check is asked, and the
 * suite answers the same locally and in CI.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__llmProviderTestBillingEnabled = true;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__llmProviderTestBillingEnabled;
    },
  });

  return mocked;
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendFileResponse: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import CommonAPI from "../../../Server/API/CommonAPI";
import LlmProviderAPI from "../../../Server/API/LlmProviderAPI";
import LlmProviderTestAccess from "../../../Server/API/LlmProviderTestAccess";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import Encryption from "../../../Server/Utils/Encryption";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import LLMService, {
  LLMCompletionRequest,
} from "../../../Server/Utils/LLM/LLMService";
import Response from "../../../Server/Utils/Response";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { customDomainCaller } from "./CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  DASHBOARD_TEST_ROUTE,
  dashboardTestBody,
} from "../../Helpers/LlmProviderTestRequest";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

// The customer's provider: OpenAI, gpt-5.1, the default Base URL, Default.
const PROVIDER_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_PROJECT_PROVIDER_ID: string =
  "44444444-4444-4444-8444-444444444444";
const GLOBAL_PROVIDER_ID: string = "55555555-5555-4555-8555-555555555555";
const MISSING_PROVIDER_ID: string = "66666666-6666-4666-8666-666666666666";

const CUSTOMER_KEY: string = "sk-proj-customer-key";
const OTHER_PROJECT_KEY: string = "sk-proj-other-project";
const GLOBAL_KEY: string = "sk-instance-global-key";

const CONNECTED: string =
  "Connection successful. The LLM provider responded to a test prompt and used tool calling.";

// What the button said to the customer, and to every member.
const CUSTOMER_REFUSAL: string =
  "You do not have permissions to select on - isGlobalLlm";

const TESTERS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  ["a project member", [Permission.ProjectMember]],
  ["a settings admin", [Permission.SettingsAdmin]],
  ["a settings member", [Permission.SettingsMember]],
  [
    "someone holding Edit LLM (and Read LLM)",
    [Permission.EditProjectLlm, Permission.ReadProjectLlm],
  ],
  [
    "a viewer whose team was given Edit LLM",
    [Permission.Viewer, Permission.EditProjectLlm],
  ],
];

// They may read providers, but not change one.
const READERS_WHO_MAY_NOT_TEST: Array<[string, Array<Permission>]> = [
  ["a viewer", [Permission.Viewer]],
  ["a settings viewer", [Permission.SettingsViewer]],
  ["someone holding Read LLM", [Permission.ReadProjectLlm]],
  [
    "someone holding Create LLM and Read LLM",
    [Permission.CreateProjectLlm, Permission.ReadProjectLlm],
  ],
  [
    "someone holding Delete LLM and Read LLM",
    [Permission.DeleteProjectLlm, Permission.ReadProjectLlm],
  ],
];

/*
 * The plans, as Common Test's environment defines them (test-setup.sh), so
 * the plan checks read the same plans locally.
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

const savedPlanEnvironment: Record<string, string | undefined> = {};

// The provider update list, as the refusal names it.
const REFUSAL: string =
  "You do not have permission to test this LLM Provider. You need one of these permissions: Project Owner, Project Admin, Project Member, Settings Admin, Settings Member, Edit LLM.";

let props: DatabaseCommonInteractionProps;
let providers: InMemoryTable;
let getCompletion: MockedFn;
let stored: { customer: string; other: string; global: string };

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;

function setBillingEnabled(value: boolean): void {
  (globalThis as MockBillingGlobal).__llmProviderTestBillingEnabled = value;
}

function caller(
  permissions: Array<Permission>,
  extra: Partial<Parameters<typeof customDomainCaller>[0]> = {},
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: permissions,
      projectId: PROJECT_ID,
      ...extra,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

// A server administrator in the Admin Dashboard: no project named.
function serverAdmin(): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    userType: UserType.MasterAdmin,
    isMasterAdmin: true,
  };
}

function rows(): Array<StoredRow> {
  return [
    {
      _id: PROVIDER_ID,
      projectId: PROJECT_ID.toString(),
      name: "Chatgpt",
      llmType: LlmType.OpenAI,
      apiKey: stored.customer,
      modelName: "gpt-5.1",
      isGlobalLlm: false,
      isDefault: true,
      version: 1,
    },
    {
      _id: OTHER_PROJECT_PROVIDER_ID,
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Their OpenAI",
      llmType: LlmType.OpenAI,
      apiKey: stored.other,
      modelName: "gpt-5.1",
      isGlobalLlm: false,
      isDefault: true,
      version: 1,
    },
    {
      _id: GLOBAL_PROVIDER_ID,
      name: "OneUptime AI",
      llmType: LlmType.OpenAICompatible,
      apiKey: stored.global,
      baseUrl: "http://oneuptime-vllm.oneuptime.svc.cluster.local:8000/v1",
      modelName: "Qwen/Qwen2.5-1.5B-Instruct",
      isGlobalLlm: true,
      isDefault: false,
      version: 1,
    },
  ];
}

// The request Test sends: the Dashboard's body, through the route's handler.
async function pressTest(
  llmProviderId: unknown = PROVIDER_ID,
  body?: JSONObject,
): Promise<void> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    headers: {},
    body: body || dashboardTestBody(llmProviderId),
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match("post", DASHBOARD_TEST_ROUTE)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  // The route answers every outcome itself; nothing reaches the error handler.
  expect(next).not.toHaveBeenCalled();
}

function verdict(): JSONObject {
  expect(sendErrorResponseMock).not.toHaveBeenCalled();
  expect(sendJsonObjectResponseMock).toHaveBeenCalledTimes(1);
  return sendJsonObjectResponseMock.mock.calls[0]![2] as JSONObject;
}

function refusal(): Exception {
  expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
  expect(sendErrorResponseMock).toHaveBeenCalledTimes(1);
  return sendErrorResponseMock.mock.calls[0]![2] as Exception;
}

function sentRequests(): Array<LLMCompletionRequest> {
  return getCompletion.mock.calls.map(
    (call: Array<unknown>): LLMCompletionRequest => {
      return call[0] as LLMCompletionRequest;
    },
  );
}

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUBSCRIPTION_PLAN_")) {
      savedPlanEnvironment[key] = process.env[key];
      delete process.env[key];
    }
  }

  Object.assign(process.env, PLAN_ENVIRONMENT);

  mockRouter.routes.length = 0;
  new LlmProviderAPI();

  stored = {
    customer: await Encryption.encrypt(CUSTOMER_KEY),
    other: await Encryption.encrypt(OTHER_PROJECT_KEY),
    global: await Encryption.encrypt(GLOBAL_KEY),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  setBillingEnabled(true);

  providers = useInMemoryTable(LlmProviderService, rows());

  // The provider answers the probe by calling its tool.
  getCompletion = jest
    .spyOn(LLMService, "getCompletion")
    .mockResolvedValue({
      content: "OK",
      toolCalls: [{ id: "call_1", name: "connection_test_ping", arguments: {} }],
      usage: undefined,
    } as never) as unknown as MockedFn;

  props = caller([Permission.ProjectOwner]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  setBillingEnabled(true);
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
});

describe("Test, on the customer's own provider: whoever may change it tests it", () => {
  test.each(TESTERS)(
    "%s tests the project's provider, with its own key and model",
    async (_who: string, permissions: Array<Permission>) => {
      props = caller(permissions);

      await pressTest();

      expect(verdict()).toEqual({
        success: true,
        supportsToolCalling: true,
        message: CONNECTED,
      });

      const request: LLMCompletionRequest = sentRequests()[0]!;
      expect(request.llmProviderConfig.llmType).toBe(LlmType.OpenAI);
      expect(request.llmProviderConfig.apiKey).toBe(CUSTOMER_KEY);
      expect(request.llmProviderConfig.modelName).toBe("gpt-5.1");
      // A project's provider is never run as a global one.
      expect(request.llmProviderConfig.isGlobalProvider).toBeUndefined();
    },
  );

  test("regression: the customer's refusal is gone for every tester", async () => {
    for (const [, permissions] of TESTERS) {
      jest.clearAllMocks();
      props = caller(permissions);

      await pressTest();

      for (const call of sendErrorResponseMock.mock.calls) {
        expect((call[2] as Exception).message).not.toContain(CUSTOMER_REFUSAL);
      }

      expect(sendJsonObjectResponseMock).toHaveBeenCalledTimes(1);
    }
  });

  test("a project API key holding Edit LLM tests the provider", async () => {
    props = caller([Permission.EditProjectLlm, Permission.ReadProjectLlm], {
      isApiKey: true,
    });

    await pressTest();

    expect(verdict()["success"]).toBe(true);
    expect(sentRequests()[0]!.llmProviderConfig.apiKey).toBe(CUSTOMER_KEY);
  });

  test("the key is read only once the caller may test: what decides whose provider it is never asks for it", async () => {
    await pressTest();

    const selects: Array<JSONObject> = (
      providers.repository.find.mock.calls as Array<
        Array<{ select?: JSONObject }>
      >
    ).map((call: Array<{ select?: JSONObject }>): JSONObject => {
      return call[0]!.select || {};
    });

    expect(selects[0]).toEqual(
      expect.objectContaining({ _id: true, projectId: true }),
    );
    expect(selects[0]!["apiKey"]).toBeUndefined();
    expect(selects[0]!["isGlobalLlm"]).toBeUndefined();

    expect(
      selects.some((select: JSONObject): boolean => {
        return select["apiKey"] === true;
      }),
    ).toBe(true);
  });
});

describe("Test, refused: who may read providers but not change one, and who may not see them", () => {
  test.each(READERS_WHO_MAY_NOT_TEST)(
    "%s is told who may test, and the provider is never called",
    async (_who: string, permissions: Array<Permission>) => {
      props = caller(permissions);

      await pressTest();

      const error: Exception = refusal();
      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error.message).toBe(REFUSAL);
      expect(getCompletion).not.toHaveBeenCalled();
    },
  );

  test("a member without any LLM permission is refused in the same words", async () => {
    props = caller([Permission.ReadProjectIncident]);

    await pressTest();

    expect(refusal().message).toBe(REFUSAL);
    expect(getCompletion).not.toHaveBeenCalled();
  });

  test("the refusal names exactly the provider's update list", () => {
    expect(LlmProviderTestAccess.getRefusalMessage()).toBe(REFUSAL);
    expect(new LlmProvider().getUpdatePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditProjectLlm,
    ]);
  });

  test("a member whose team blocks Project Member may not test, whatever their role says", async () => {
    props = caller([Permission.ProjectMember], {
      blocks: [Permission.ProjectMember],
    });

    await pressTest();

    expect(refusal()).toBeInstanceOf(NotAuthorizedException);
    expect(getCompletion).not.toHaveBeenCalled();
  });

  test("a credential issued for reading only may not test, the owner's included", async () => {
    props = caller([Permission.ProjectOwner], { isReadOnlyCredential: true });

    await pressTest();

    expect(refusal().message).toBe(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    );
    expect(getCompletion).not.toHaveBeenCalled();
  });

  test("below the plan that sells providers, the owner is asked to upgrade", async () => {
    props = {
      ...caller([Permission.ProjectOwner]),
      currentPlan: PlanType.Free,
      isSubscriptionUnpaid: false,
    };

    await pressTest();

    const error: Exception = refusal();
    expect(error).toBeInstanceOf(PaymentRequiredException);
    expect(error.message).toContain("Growth");
    expect(getCompletion).not.toHaveBeenCalled();
  });

  test("with billing off, no plan is asked", async () => {
    setBillingEnabled(false);
    props = {
      ...caller([Permission.ProjectMember]),
      currentPlan: PlanType.Free,
    };

    await pressTest();

    expect(verdict()["success"]).toBe(true);
  });
});

describe("Test, across projects: another project's provider is not found", () => {
  test("the owner of another project, naming their own project, is told it is not found and nothing is called", async () => {
    props = caller([Permission.ProjectOwner], { projectId: OTHER_PROJECT_ID });

    await pressTest(PROVIDER_ID);

    const error: Exception = refusal();
    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(LlmProviderTestAccess.NOT_FOUND_MESSAGE);
    expect(getCompletion).not.toHaveBeenCalled();
  });

  test("a provider that does not exist is answered in the same words", async () => {
    await pressTest(MISSING_PROVIDER_ID);

    expect(refusal().message).toBe(LlmProviderTestAccess.NOT_FOUND_MESSAGE);
  });

  test("so is an id that is not one", async () => {
    await pressTest("not-a-provider-id");

    expect(refusal().message).toBe(LlmProviderTestAccess.NOT_FOUND_MESSAGE);
    expect(providers.repository.find).not.toHaveBeenCalled();
  });

  test("and the other project's own key never leaves the server", async () => {
    props = caller([Permission.ProjectOwner], { projectId: PROJECT_ID });

    await pressTest(OTHER_PROJECT_PROVIDER_ID);

    expect(refusal().message).toBe(LlmProviderTestAccess.NOT_FOUND_MESSAGE);
    expect(JSON.stringify(sendErrorResponseMock.mock.calls)).not.toContain(
      OTHER_PROJECT_KEY,
    );
  });

  test("someone signed in who is not a member of the project they name is refused before the provider is read", async () => {
    props = {
      ...customDomainCaller({
        permissions: [Permission.ProjectOwner],
        projectId: OTHER_PROJECT_ID,
      }),
      ...ON_HIGHEST_PLAN,
      // Names the customer's project, where they hold nothing.
      tenantId: PROJECT_ID,
    };

    await pressTest();

    expect(refusal().message).toBe(
      "You are not authorized to access this project's data.",
    );
    expect(providers.repository.find).not.toHaveBeenCalled();
  });

  test("a request that names no project is told to name one", async () => {
    props = {
      ...caller([Permission.ProjectOwner]),
    };
    delete props.tenantId;

    await pressTest();

    expect(refusal().message).toBe("Project ID is required");
    expect(getCompletion).not.toHaveBeenCalled();
  });

  test("no provider id at all is a bad request", async () => {
    await pressTest(undefined, {});

    expect(refusal().message).toBe(LlmProviderTestAccess.ID_REQUIRED_MESSAGE);
  });
});

describe("Test, on a global provider: server administrators, from the Admin Dashboard", () => {
  test("a server administrator tests a global provider, run as global", async () => {
    props = serverAdmin();

    await pressTest(GLOBAL_PROVIDER_ID);

    expect(verdict()["success"]).toBe(true);

    const request: LLMCompletionRequest = sentRequests()[0]!;
    expect(request.llmProviderConfig.apiKey).toBe(GLOBAL_KEY);
    expect(request.llmProviderConfig.baseUrl).toBe(
      "http://oneuptime-vllm.oneuptime.svc.cluster.local:8000/v1",
    );
    // It may reach the in-cluster address a project's provider may not.
    expect(request.llmProviderConfig.isGlobalProvider).toBe(true);
  });

  test("a server administrator may test a project's provider too, not run as global", async () => {
    props = serverAdmin();

    await pressTest(PROVIDER_ID);

    expect(verdict()["success"]).toBe(true);
    expect(sentRequests()[0]!.llmProviderConfig.isGlobalProvider).toBeUndefined();
  });

  test.each(TESTERS)(
    "%s of a project may not test a global provider",
    async (_who: string, permissions: Array<Permission>) => {
      props = caller(permissions);

      await pressTest(GLOBAL_PROVIDER_ID);

      const error: Exception = refusal();
      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error.message).toBe(LlmProviderTestAccess.GLOBAL_PROVIDER_MESSAGE);
      expect(getCompletion).not.toHaveBeenCalled();
    },
  );

  test("whether a provider is global is its project's to say: a project's row marked global is still the project's", async () => {
    providers.rows[0]!["isGlobalLlm"] = true;
    props = caller([Permission.ProjectMember]);

    await pressTest(PROVIDER_ID);

    expect(verdict()["success"]).toBe(true);
    // Its members chose where it points, so it is not run as global.
    expect(sentRequests()[0]!.llmProviderConfig.isGlobalProvider).toBeUndefined();
  });

  test("a row no project owns, even one not marked global, is a server administrator's", async () => {
    providers.rows[2]!["isGlobalLlm"] = false;
    props = caller([Permission.ProjectOwner]);

    await pressTest(GLOBAL_PROVIDER_ID);

    expect(refusal().message).toBe(
      LlmProviderTestAccess.GLOBAL_PROVIDER_MESSAGE,
    );
  });
});

describe("Test, before the handler", () => {
  test("the route asks who the caller is first: an anonymous request is answered 401", async () => {
    const middlewares: Array<unknown> = mockRouter.match(
      "post",
      DASHBOARD_TEST_ROUTE,
    ).middlewares;

    expect(middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);

    await UserMiddleware.requireUserAuthentication(
      { userType: UserType.Public } as unknown as ExpressRequest,
      {} as ExpressResponse,
      jest.fn() as unknown as NextFunction,
    );

    const error: Exception = sendErrorResponseMock.mock
      .calls[0]![2] as Exception;
    expect(error.code).toBe(401);
  });
});
