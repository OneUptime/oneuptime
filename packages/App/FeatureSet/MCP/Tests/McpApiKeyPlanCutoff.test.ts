/**
 * The MCP server's API-key mode, below the plan that sells API keys.
 *
 * An MCP client that connects with an API key reaches the project through
 * the REST API, which the server calls with the key in the APIKey header
 * (Types/McpCredential). Below Growth, the API refuses every request made
 * with one of the project's keys (Common/Types/Billing/
 * PlanCutoffCredentials), so every tool that needs the key - reads and
 * writes alike - answers with the refusal: a tool error the agent reads,
 * carrying the 402, the message that names the plan, and advice not to
 * retry. The key itself is untouched and works again after an upgrade.
 *
 * The tool handlers run on a real MCP server over an in-memory transport.
 * Their API calls are answered by the API's real authentication middleware
 * (UserMiddleware.getUserMiddleware, which every REST route runs first), with
 * only the key and plan lookups stubbed - so the 402 is the API's own.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Logger",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    },
  };
});
jest.mock("../Utils/MCPLogger");

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerToolHandlers } from "../Handlers/ToolHandler";
import { McpServer, createMCPServerInstance } from "../Server/MCPServer";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import { generateAllTools } from "../Tools/ToolGenerator";
import McpCredentialUtil from "../Types/McpCredential";
import { McpToolInfo } from "../Types/McpTypes";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import ApiKeyPermissionService from "Common/Server/Services/ApiKeyPermissionService";
import ApiKeyService from "Common/Server/Services/ApiKeyService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import ProjectService, {
  CurrentPlan,
} from "Common/Server/Services/ProjectService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Headers from "Common/Types/API/Headers";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { getApiKeysStoppedMessage } from "Common/Types/Billing/PlanCutoffCredentials";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/Utils/API";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const API_KEY: string = "80000000-0000-4000-8000-000000000001";
const API_KEY_ID: ObjectID = new ObjectID(
  "80000000-0000-4000-8000-000000000002",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "80000000-0000-4000-8000-000000000003",
);
const INCIDENT_ID: string = "80000000-0000-4000-8000-000000000004";

const SUGGESTION_402: string =
  "The project's billing does not allow this, and the error says why: a plan the project is not on, an unpaid subscription, or a balance to add. Do not retry: ask a project owner to resolve it in Project Settings > Billing.";

const savedPlanEnvironment: Record<string, string | undefined> = {};

let currentPlan: PlanType = PlanType.Free;
let apiCalls: Array<{ url: string; headers: Headers }> = [];
let mcpServer: McpServer | undefined;
let client: Client | undefined;

/*
 * The OneUptime API as the MCP server's calls meet it: the request goes
 * through the real authentication middleware, and a refusal there is the
 * API's answer. Past it, every route answers an empty success.
 */
const answerLikeTheApi: (options: {
  url: URL;
  headers?: Headers;
  data?: JSONObject;
}) => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> = async (options: {
  url: URL;
  headers?: Headers;
  data?: JSONObject;
}): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
  const headers: Headers = options.headers || {};

  apiCalls.push({ url: options.url.toString(), headers });

  // Node lower-cases incoming header names.
  const lowerCased: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    lowerCased[name.toLowerCase()] = String(value);
  }

  const request: ExpressRequest = {
    headers: lowerCased,
    params: {},
    query: {},
    body: options.data || {},
  } as unknown as ExpressRequest;

  let refusal: Exception | null = null;

  await UserMiddleware.getUserMiddleware(
    request,
    {
      set: jest.fn(),
      status: jest.fn(),
      send: jest.fn(),
    } as unknown as ExpressResponse,
    ((error?: unknown): void => {
      if (error) {
        refusal = error as Exception;
      }
    }) as NextFunction,
  );

  if (refusal) {
    const exception: Exception = refusal as Exception;

    return new HTTPErrorResponse(
      exception.code,
      { error: exception.message },
      {},
    );
  }

  return new HTTPResponse(200, { data: [], count: 0 } as JSONObject, {});
};

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUBSCRIPTION_PLAN_")) {
      savedPlanEnvironment[key] = process.env[key];
      delete process.env[key];
    }
  }

  Object.assign(process.env, PLAN_ENVIRONMENT);

  OneUptimeApiService.initialize({ url: "https://oneuptime.example.com" });
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

beforeEach(() => {
  setTestBillingEnabled(true);
  currentPlan = PlanType.Free;
  apiCalls = [];

  jest.spyOn(ApiKeyService, "findApiKey").mockResolvedValue({
    id: API_KEY_ID,
    projectId: PROJECT_ID,
    name: "Claude Desktop",
  });
  jest
    .spyOn(ApiKeyPermissionService, "findPermissionsByApiKeyId")
    .mockResolvedValue([
      {
        permission: Permission.ProjectAdmin,
        labelIds: [],
        isBlockPermission: false,
      },
    ] as never);
  jest.spyOn(GlobalConfigService, "findOneBy").mockResolvedValue(null);
  jest
    .spyOn(ProjectService, "getCurrentPlan")
    .mockImplementation(async (): Promise<CurrentPlan> => {
      return { plan: currentPlan, isSubscriptionUnpaid: false };
    });

  for (const method of ["get", "post", "put", "delete"] as const) {
    jest.spyOn(API, method).mockImplementation(answerLikeTheApi as never);
  }
});

afterEach(async () => {
  await client?.close();
  await mcpServer?.close();
  client = undefined;
  mcpServer = undefined;

  jest.restoreAllMocks();
});

const tools: Array<McpToolInfo> = generateAllTools();

async function callWithKey(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ isError: boolean; payload: any }> {
  const [clientTransport, serverTransport]: [
    InMemoryTransport,
    InMemoryTransport,
  ] = InMemoryTransport.createLinkedPair();

  mcpServer = createMCPServerInstance();
  registerToolHandlers(mcpServer, tools, McpCredentialUtil.fromApiKey(API_KEY));

  await mcpServer.connect(serverTransport);

  client = new Client({ name: "plan-cutoff-test", version: "1.0.0" });
  await client.connect(clientTransport);

  const result: {
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
  } = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
  };

  await client.close();
  await mcpServer.close();
  client = undefined;
  mcpServer = undefined;

  return {
    isError: result.isError === true,
    payload: JSON.parse(result.content[0]!.text),
  };
}

// A read and a write tool of the generated set, and a hand-written one.
const KEY_TOOLS: Array<[string, Record<string, unknown>]> = [
  ["list_incidents", {}],
  ["get_incident", { id: INCIDENT_ID }],
  ["create_incident", { title: "Checkout is down" }],
  ["update_incident", { id: INCIDENT_ID, title: "Checkout is slow" }],
  ["delete_incident", { id: INCIDENT_ID }],
];

describe("an MCP client with an API key of a project below Growth (billing on)", () => {
  it.each(KEY_TOOLS)(
    "%s answers the API's 402, naming the plan, and advises not to retry",
    async (name: string, args: Record<string, unknown>) => {
      const result: { isError: boolean; payload: any } = await callWithKey(
        name,
        args,
      );

      expect(result.isError).toBe(true);
      expect(result.payload.success).toBe(false);
      expect(result.payload.statusCode).toBe(402);
      expect(result.payload.error).toBe(
        `API request failed: 402 - ${getApiKeysStoppedMessage(PlanType.Growth)}`,
      );
      expect(result.payload.suggestion).toBe(SUGGESTION_402);
    },
  );

  it("sends the key to the API as it came, which is where it is refused", async () => {
    await callWithKey("list_incidents");

    expect(apiCalls.length).toBeGreaterThan(0);
    expect(apiCalls[0]!.headers["APIKey"]).toBe(API_KEY);
  });

  it("the whoami workflow tool is refused the same way", async () => {
    const result: { isError: boolean; payload: any } =
      await callWithKey("oneuptime_whoami");

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.payload)).toContain(
      getApiKeysStoppedMessage(PlanType.Growth),
    );
  });
});

describe("an MCP client with an API key of a project on Growth or above", () => {
  it.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "on %s, a tool works as before",
    async (plan: PlanType) => {
      currentPlan = plan;

      const result: { isError: boolean; payload: any } =
        await callWithKey("list_incidents");

      expect(result.isError).toBe(false);
    },
  );
});

describe("an upgrade", () => {
  it("turns the same key back on for the MCP client, with nothing to reconnect", async () => {
    currentPlan = PlanType.Free;
    expect((await callWithKey("list_incidents")).isError).toBe(true);

    currentPlan = PlanType.Growth;
    expect((await callWithKey("list_incidents")).isError).toBe(false);
  });
});

describe("billing off (self-hosted)", () => {
  it("the key works on any plan", async () => {
    setTestBillingEnabled(false);
    currentPlan = PlanType.Free;

    const result: { isError: boolean; payload: any } =
      await callWithKey("list_incidents");

    expect(result.isError).toBe(false);
  });
});
