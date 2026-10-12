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
 * A project's own LLM provider, end to end through the server, as the
 * people the docs name (ai/llm-provider.md) use it: add it, find it in the
 * list, open it, press Test, change it, replace its key without reading it,
 * make it the default, have the AI features use it - and record that in AI
 * Logs, without spending the project's AI credits - and delete it. The
 * requests are the Dashboard's (ModelAPI's bodies, the pages' selects); the
 * caller's props are real; BaseAPI's routes, LlmProviderService's hooks and
 * the whole permission layer run as they do in production. Only the table
 * is held in memory, and the model is faked where the provider would answer.
 *
 * The customer was stopped at Test, by a read of a column nobody may read.
 * Every other step is walked too, as a project owner, a project admin, a
 * project member and a member given the LLM permissions alone, so the next
 * step that only works for server administrators fails here first.
 */

type MockBillingGlobal = typeof globalThis & {
  __llmProviderWalkBillingEnabled: boolean;
};

// Billing on, as Common Test runs: the plan checks are asked.
jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__llmProviderWalkBillingEnabled = true;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__llmProviderWalkBillingEnabled;
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

import CommonAPI from "../../../Server/API/CommonAPI";
import LlmProviderAPI from "../../../Server/API/LlmProviderAPI";
import AIService from "../../../Server/Services/AIService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import Encryption from "../../../Server/Utils/Encryption";
import logger from "../../../Server/Utils/Logger";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import LLMService, {
  LLMCompletionRequest,
} from "../../../Server/Utils/LLM/LLMService";
import Response from "../../../Server/Utils/Response";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "./CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  DASHBOARD_TEST_ROUTE,
  dashboardTestBody,
} from "../../Helpers/LlmProviderTestRequest";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const GLOBAL_PROVIDER_ID: string = "55555555-5555-4555-8555-555555555555";

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

/*
 * Who walks it: the roles that may add, change, test and delete a project's
 * providers, and a member given only the LLM permissions.
 */
const WALKERS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  ["a project member", [Permission.ProjectMember]],
  [
    "a member given Create, Edit, Read and Delete LLM",
    [
      Permission.CreateProjectLlm,
      Permission.EditProjectLlm,
      Permission.ReadProjectLlm,
      Permission.DeleteProjectLlm,
    ],
  ],
];

// The customer's provider, as the create form fills it in.
const CUSTOMER_PROVIDER: {
  name: string;
  llmType: LlmType;
  apiKey: string;
  modelName: string;
} = {
  name: "Chatgpt",
  llmType: LlmType.OpenAI,
  apiKey: "sk-proj-customer-key",
  modelName: "gpt-5.1",
};

/*
 * What the provider's page reads (Settings > LLM Providers > View Provider):
 * a member who may not read the parameters reads whether any are saved.
 */
const VIEW_SELECT_FOR_ANY_READER: JSONObject = {
  _id: true,
  name: true,
  description: true,
  llmType: true,
  modelName: true,
  baseUrl: true,
  hasAdditionalParams: true,
  isDefault: true,
};

// What the list of the project's providers reads.
const LIST_SELECT: JSONObject = {
  _id: true,
  name: true,
  description: true,
  isDefault: true,
};

let props: DatabaseCommonInteractionProps;
let providers: InMemoryTable;
let getCompletion: MockedFn;

const sendEntityResponseMock: MockedFn =
  Response.sendEntityResponse as unknown as MockedFn;
const sendEntityArrayResponseMock: MockedFn =
  Response.sendEntityArrayResponse as unknown as MockedFn;
const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;
const sendEmptySuccessResponseMock: MockedFn =
  Response.sendEmptySuccessResponse as unknown as MockedFn;

function caller(permissions: Array<Permission>): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

async function callRoute(
  method: string,
  route: string,
  data: {
    body?: JSONObject;
    params?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
): Promise<{ error: Error | undefined }> {
  const req: ExpressRequest = {
    params: data.params || {},
    query: data.query || {},
    headers: {},
    body: data.body || {},
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match(method, route)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return { error: next.mock.calls[0]?.[0] as Error | undefined };
}

// ModelAPI.createOrUpdate's body for a provider the form filled in.
function formBody(values: Partial<LlmProvider>): JSONObject {
  const provider: LlmProvider = new LlmProvider();

  for (const [key, value] of Object.entries(values)) {
    (provider as unknown as Record<string, unknown>)[key] = value;
  }

  return {
    data: JSONFunctions.serialize(BaseModel.toJSON(provider, LlmProvider)),
    miscDataProps: {},
  };
}

// The id of the provider the last create answered with.
function createdId(): string {
  const created: BaseModel = sendEntityResponseMock.mock.calls[
    sendEntityResponseMock.mock.calls.length - 1
  ]![2] as BaseModel;

  return created.id!.toString();
}

function storedProviders(): Array<StoredRow> {
  return providers.rows.filter((row: StoredRow): boolean => {
    return String(row["projectId"]) === PROJECT_ID.toString();
  });
}

function rowOf(id: string): StoredRow {
  return providers.get(id)!;
}

async function add(values: Partial<LlmProvider>): Promise<string> {
  const { error } = await callRoute("POST", "/llm-provider", {
    body: formBody(values),
  });

  expect(error).toBeUndefined();
  return createdId();
}

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUBSCRIPTION_PLAN_")) {
      savedPlanEnvironment[key] = process.env[key];
      delete process.env[key];
    }
  }

  Object.assign(process.env, PLAN_ENVIRONMENT);

  mockRouter.routes.length = 0;
  new LlmProviderAPI();
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

beforeEach(async () => {
  jest.clearAllMocks();
  stubProjectDirectory({});

  for (const level of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {});
  }

  // The instance's global provider, which projects fall back to.
  providers = useInMemoryTable(LlmProviderService, [
    {
      _id: GLOBAL_PROVIDER_ID,
      name: "OneUptime AI",
      llmType: LlmType.OpenAI,
      apiKey: await Encryption.encrypt("sk-instance-key"),
      modelName: "gpt-5.1",
      isGlobalLlm: true,
      isDefault: false,
      costPerMillionTokensInUSDCents: 300,
      version: 1,
    },
  ]);

  getCompletion = jest
    .spyOn(LLMService, "getCompletion")
    .mockResolvedValue({
      content: "OK",
      toolCalls: [{ id: "call_1", name: "connection_test_ping", arguments: {} }],
      usage: { promptTokens: 60, completionTokens: 12, totalTokens: 72 },
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
});

describe.each(WALKERS)(
  "%s walks a provider of their own, end to end",
  (_who: string, permissions: Array<Permission>) => {
    beforeEach(() => {
      props = caller(permissions);
    });

    test("add: the create form's provider is saved in the project, its key encrypted, as the default", async () => {
      const id: string = await add(CUSTOMER_PROVIDER);

      const row: StoredRow = rowOf(id);
      expect(String(row["projectId"])).toBe(PROJECT_ID.toString());
      expect(row["name"]).toBe("Chatgpt");
      expect(row["llmType"]).toBe(LlmType.OpenAI);
      expect(row["modelName"]).toBe("gpt-5.1");
      // A new provider is the default (LlmProviderService.onBeforeCreate).
      expect(row["isDefault"]).toBe(true);
      // Never global: no project role may say so.
      expect(row["isGlobalLlm"]).not.toBe(true);
      // Stored encrypted, never as typed.
      expect(row["apiKey"]).not.toBe(CUSTOMER_PROVIDER.apiKey);
      expect(await Encryption.decrypt(row["apiKey"] as string)).toBe(
        CUSTOMER_PROVIDER.apiKey,
      );
      expect(String(row["createdByUserId"])).toBe(props.userId!.toString());
    });

    test("list and view: the project's providers, and the provider's page, never its key", async () => {
      const id: string = await add(CUSTOMER_PROVIDER);

      const list: { error: Error | undefined } = await callRoute(
        "POST",
        "/llm-provider/get-list",
        {
          body: {
            query: { projectId: PROJECT_ID.toString() },
            select: LIST_SELECT,
            sort: { name: "Ascending" },
          },
          query: { skip: "0", limit: "10" },
        },
      );

      expect(list.error).toBeUndefined();
      const listed: Array<BaseModel> = sendEntityArrayResponseMock.mock
        .calls[0]![2] as Array<BaseModel>;
      expect(
        listed.map((provider: BaseModel): string => {
          return provider.id!.toString();
        }),
      ).toEqual([id]);

      const item: { error: Error | undefined } = await callRoute(
        "POST",
        "/llm-provider/:id/get-item",
        {
          params: { id },
          body: { select: VIEW_SELECT_FOR_ANY_READER },
        },
      );

      expect(item.error).toBeUndefined();
      const viewed: LlmProvider = sendEntityResponseMock.mock.calls[
        sendEntityResponseMock.mock.calls.length - 1
      ]![2] as LlmProvider;
      expect(viewed.id?.toString()).toBe(id);
      expect(viewed.name).toBe("Chatgpt");

      /*
       * What the page's read asked the table for (the in-memory table
       * answers every column, Postgres only those selected): never the key.
       */
      const lastRead: JSONObject = (
        providers.repository.find.mock.calls[
          providers.repository.find.mock.calls.length - 1
        ] as Array<{ select: JSONObject }>
      )[0]!.select;
      expect(lastRead["name"]).toBe(true);
      expect(lastRead["apiKey"]).toBeUndefined();
      expect(lastRead["additionalParams"]).toBeUndefined();
    });

    test("Test: the provider answers with the key and model they saved", async () => {
      const id: string = await add(CUSTOMER_PROVIDER);

      await callRoute("POST", DASHBOARD_TEST_ROUTE, {
        body: dashboardTestBody(id),
      });

      expect(sendErrorResponseMock).not.toHaveBeenCalled();
      expect(
        (sendJsonObjectResponseMock.mock.calls[0]![2] as JSONObject)["success"],
      ).toBe(true);

      const request: LLMCompletionRequest = getCompletion.mock
        .calls[0]![0] as LLMCompletionRequest;
      expect(request.llmProviderConfig.apiKey).toBe(CUSTOMER_PROVIDER.apiKey);
      expect(request.llmProviderConfig.modelName).toBe("gpt-5.1");
    });

    test("edit: the edit form's change is saved, and a new key replaces the old one without being read", async () => {
      const id: string = await add(CUSTOMER_PROVIDER);

      // The edit form, as a member sees it: no Base URL, the key left blank.
      const renamed: { error: Error | undefined } = await callRoute(
        "PUT",
        "/llm-provider/:id",
        {
          params: { id },
          body: formBody({
            name: "ChatGPT (production)",
            description: "Ask AI and investigations",
            llmType: LlmType.OpenAI,
            modelName: "gpt-5.1-mini",
            isDefault: true,
          }),
        },
      );

      expect(renamed.error).toBeUndefined();
      expect(rowOf(id)["name"]).toBe("ChatGPT (production)");
      expect(rowOf(id)["modelName"]).toBe("gpt-5.1-mini");
      // Left blank, the key is kept.
      expect(await Encryption.decrypt(rowOf(id)["apiKey"] as string)).toBe(
        CUSTOMER_PROVIDER.apiKey,
      );

      // A new key, typed into the blank field.
      const rekeyed: { error: Error | undefined } = await callRoute(
        "PUT",
        "/llm-provider/:id",
        {
          params: { id },
          body: formBody({ apiKey: "sk-proj-rotated-key" }),
        },
      );

      expect(rekeyed.error).toBeUndefined();

      jest.clearAllMocks();
      await callRoute("POST", DASHBOARD_TEST_ROUTE, {
        body: dashboardTestBody(id),
      });

      expect(
        (getCompletion.mock.calls[0]![0] as LLMCompletionRequest)
          .llmProviderConfig.apiKey,
      ).toBe("sk-proj-rotated-key");
    });

    test("default: a second provider becomes the default, and making the first the default again moves it back", async () => {
      const first: string = await add(CUSTOMER_PROVIDER);
      const second: string = await add({
        ...CUSTOMER_PROVIDER,
        name: "Claude",
        llmType: LlmType.Anthropic,
        apiKey: "sk-ant-customer-key",
        modelName: "claude-sonnet-5-5",
      });

      expect(rowOf(first)["isDefault"]).toBe(false);
      expect(rowOf(second)["isDefault"]).toBe(true);

      const { error } = await callRoute("PUT", "/llm-provider/:id", {
        params: { id: first },
        body: formBody({ isDefault: true }),
      });

      expect(error).toBeUndefined();
      expect(rowOf(first)["isDefault"]).toBe(true);
      expect(rowOf(second)["isDefault"]).toBe(false);
    });

    test("the AI features use it: Ask AI and investigations resolve it, and AI Logs records it without spending AI credits", async () => {
      const id: string = await add(CUSTOMER_PROVIDER);

      // Every AI feature resolves the project's provider here.
      const resolved: LlmProvider | null =
        await LlmProviderService.getLLMProviderForProject(PROJECT_ID);
      expect(resolved?.id?.toString()).toBe(id);
      expect(resolved?.apiKey).toBe(CUSTOMER_PROVIDER.apiKey);

      // Ask AI's provider picker: theirs first, as the default, then the global one.
      const selectable: Array<LlmProvider> =
        await LlmProviderService.getSelectableProvidersForProject(PROJECT_ID);
      expect(
        selectable.map((provider: LlmProvider): [string, boolean] => {
          return [provider.name || "", provider.isDefault === true];
        }),
      ).toEqual([
        ["Chatgpt", true],
        ["OneUptime AI", false],
      ]);

      // A call, as Ask AI and investigations make one.
      jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
        id: PROJECT_ID,
        enableAi: true,
        aiCurrentBalanceInUSDCents: 0,
      } as unknown as Project);
      const deduct: MockedFn = jest
        .spyOn(ProjectService, "deductAiBalanceInUSDCents")
        .mockResolvedValue(undefined as never) as unknown as MockedFn;
      const createLog: MockedFn = jest
        .spyOn(LlmLogService, "create")
        .mockResolvedValue(new LlmLog() as never) as unknown as MockedFn;

      await AIService.executeWithLogging({
        projectId: PROJECT_ID,
        userId: props.userId!,
        feature: "Ask AI",
        messages: [{ role: "user", content: "Why is checkout slow?" }],
      });

      const request: LLMCompletionRequest = getCompletion.mock
        .calls[0]![0] as LLMCompletionRequest;
      expect(request.llmProviderConfig.apiKey).toBe(CUSTOMER_PROVIDER.apiKey);
      expect(request.llmProviderConfig.modelName).toBe("gpt-5.1");

      const log: LlmLog = (createLog.mock.calls[0]![0] as { data: LlmLog })
        .data;
      expect(log.llmProviderId?.toString()).toBe(id);
      expect(log.llmProviderName).toBe("Chatgpt");
      expect(log.isGlobalProvider).toBe(false);
      expect(log.wasBilled).not.toBe(true);
      // Their own provider: no AI credits spent.
      expect(deduct).not.toHaveBeenCalled();
    });

    test("delete: the provider is gone, and the project falls back to the global one", async () => {
      const id: string = await add(CUSTOMER_PROVIDER);

      const { error } = await callRoute("DELETE", "/llm-provider/:id", {
        params: { id },
      });

      expect(error).toBeUndefined();
      expect(sendEmptySuccessResponseMock).toHaveBeenCalled();
      expect(storedProviders()).toHaveLength(0);

      const resolved: LlmProvider | null =
        await LlmProviderService.getLLMProviderForProject(PROJECT_ID);
      expect(resolved?.id?.toString()).toBe(GLOBAL_PROVIDER_ID);
    });
  },
);

describe("who may only read providers", () => {
  const READ_ONLY: Array<[string, Array<Permission>]> = [
    ["a viewer", [Permission.Viewer]],
    ["a settings viewer", [Permission.SettingsViewer]],
    ["someone holding Read LLM", [Permission.ReadProjectLlm]],
  ];

  test.each(READ_ONLY)(
    "%s lists and opens the provider, and may not add, change, test or delete it",
    async (_who: string, permissions: Array<Permission>) => {
      props = caller([Permission.ProjectOwner]);
      const id: string = await add(CUSTOMER_PROVIDER);
      jest.clearAllMocks();

      props = caller(permissions);

      const item: { error: Error | undefined } = await callRoute(
        "POST",
        "/llm-provider/:id/get-item",
        { params: { id }, body: { select: VIEW_SELECT_FOR_ANY_READER } },
      );
      expect(item.error).toBeUndefined();

      const created: { error: Error | undefined } = await callRoute(
        "POST",
        "/llm-provider",
        { body: formBody({ ...CUSTOMER_PROVIDER, name: "Another" }) },
      );
      expect(created.error).toBeInstanceOf(NotAuthorizedException);

      const changed: { error: Error | undefined } = await callRoute(
        "PUT",
        "/llm-provider/:id",
        { params: { id }, body: formBody({ name: "Renamed" }) },
      );
      expect(changed.error).toBeInstanceOf(Exception);
      expect(rowOf(id)["name"]).toBe("Chatgpt");

      await callRoute("POST", DASHBOARD_TEST_ROUTE, {
        body: dashboardTestBody(id),
      });
      expect(
        (sendErrorResponseMock.mock.calls[0]![2] as Exception).message,
      ).toBe(
        "You do not have permission to test this LLM Provider. You need one of these permissions: Project Owner, Project Admin, Project Member, Settings Admin, Settings Member, Edit LLM.",
      );
      expect(getCompletion).not.toHaveBeenCalled();

      const deleted: { error: Error | undefined } = await callRoute(
        "DELETE",
        "/llm-provider/:id",
        { params: { id } },
      );
      expect(deleted.error).toBeInstanceOf(Exception);
      expect(storedProviders()).toHaveLength(1);
    },
  );

  test("a member who may not read the key reads that one is set, never what it is", async () => {
    props = caller([Permission.ProjectOwner]);
    const id: string = await add(CUSTOMER_PROVIDER);

    props = caller([Permission.ProjectMember]);

    const { error } = await callRoute("POST", "/llm-provider/:id/get-item", {
      params: { id },
      body: { select: { ...VIEW_SELECT_FOR_ANY_READER, apiKey: true } },
    });

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error!.message).toContain(
      "You do not have permissions to select on - apiKey.",
    );
  });

  test("the global provider is never in a project's own list", async () => {
    props = caller([Permission.ProjectOwner]);

    await callRoute("POST", "/llm-provider/get-list", {
      body: {
        query: {},
        select: LIST_SELECT,
        sort: { name: "Ascending" },
      },
      query: { skip: "0", limit: "10" },
    });

    const listed: JSONArray = (
      sendEntityArrayResponseMock.mock.calls[0]![2] as Array<BaseModel>
    ).map((provider: BaseModel): JSONObject => {
      return BaseModel.toJSON(provider, LlmProvider);
    });
    expect(listed).toEqual([]);
  });
});
