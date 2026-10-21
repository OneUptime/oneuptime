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
 * TEST CONNECTION, as the people who press it: POST
 * /external-mcp-server/test with the server's id and the project in the
 * tenant header, the caller's real permissions, the route's own rule and
 * the permission layer behind it - nothing stubbed but the servers' table,
 * held in memory, and the way to the MCP server, which is a fake one.
 *
 *   - whoever may change a server tests it, in its project (owners and
 *     admins): OneUptime signs in with the saved credential, reads the
 *     tools, says what it found, and keeps it on the record;
 *   - everyone else who may read servers is refused in the words the
 *     Dashboard's locked Test button says, and nothing is sent;
 *   - another project's server, one that does not exist and an id that is
 *     not one are answered alike, and nothing is sent;
 *   - a server that cannot be reached is the test's answer, not an error;
 *   - below the plan that sells servers, the owner is asked to upgrade.
 *
 * The saved credential is never in the answer.
 */

type MockBillingGlobal = typeof globalThis & {
  __mcpServerTestBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__mcpServerTestBillingEnabled = true;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__mcpServerTestBillingEnabled;
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
      getLogLevel: jest.fn().mockReturnValue("ERROR"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import CommonAPI from "../../../Server/API/CommonAPI";
import ExternalMcpServerAPI, {
  EXTERNAL_MCP_SERVER_ID_REQUIRED_MESSAGE,
  EXTERNAL_MCP_SERVER_NOT_FOUND_MESSAGE,
  EXTERNAL_MCP_SERVER_TEST_REFUSED_SENTENCE,
} from "../../../Server/API/ExternalMcpServerAPI";
import ExternalMcpServerService from "../../../Server/Services/ExternalMcpServerService";
import ExternalMcpServerConnection from "../../../Server/Utils/AI/Mcp/ExternalMcpServerConnection";
import { clearMcpSignInCachesForTests } from "../../../Server/Utils/AI/Mcp/McpSignIn";
import Encryption from "../../../Server/Utils/Encryption";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ExternalMcpServer from "../../../Models/DatabaseModels/ExternalMcpServer";
import ExternalMcpServerAuthType from "../../../Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import { ExternalMcpServerFailureKind } from "../../../Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { EXTERNAL_MCP_SERVER_TEST_REFUSED_SENTENCE as DASHBOARD_REFUSED_SENTENCE } from "../../../../App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/ExternalMcpServerCopy";
import { EXTERNAL_MCP_SERVER_API_PATH } from "../../../../App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/ExternalMcpServerTestApi";
import FakeMcpServer, {
  LocalMcpHttpTransport,
} from "../../Helpers/FakeMcpServer";
import { customDomainCaller } from "./CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "7a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b01",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "7a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b02",
);
const SERVER_ID: string = "7a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b03";
const OTHER_PROJECT_SERVER_ID: string = "7a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b04";
const MISSING_SERVER_ID: string = "7a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b05";

const SAVED_TOKEN: string = "saved-mcp-token-4a1b6f0e";

// The route the Dashboard's Test dialog posts to.
const TEST_ROUTE: string = `${EXTERNAL_MCP_SERVER_API_PATH}/test`;

const REFUSAL: string =
  "You do not have permission to test this MCP server. You need one of these permissions: Project Owner, Project Admin.";

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

let props: DatabaseCommonInteractionProps;
let servers: InMemoryTable;
let fake: FakeMcpServer;
let storedToken: string;

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;

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

function rows(): Array<StoredRow> {
  return [
    {
      _id: SERVER_ID,
      projectId: PROJECT_ID.toString(),
      name: "AWS",
      url: fake.url("/mcp"),
      authType: ExternalMcpServerAuthType.BearerToken,
      bearerToken: storedToken,
      isEnabled: true,
      version: 1,
    },
    {
      _id: OTHER_PROJECT_SERVER_ID,
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Their AWS",
      url: fake.url("/mcp"),
      authType: ExternalMcpServerAuthType.BearerToken,
      bearerToken: storedToken,
      isEnabled: true,
      version: 1,
    },
  ];
}

// The Dashboard's request, or any other body.
async function pressTest(
  externalMcpServerId: unknown = SERVER_ID,
  body?: JSONObject,
): Promise<void> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    headers: {},
    body: body || { externalMcpServerId },
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match("post", TEST_ROUTE)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

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

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUBSCRIPTION_PLAN_")) {
      savedPlanEnvironment[key] = process.env[key];
      delete process.env[key];
    }
  }

  Object.assign(process.env, PLAN_ENVIRONMENT);

  mockRouter.routes.length = 0;
  new ExternalMcpServerAPI();

  storedToken = await Encryption.encrypt(SAVED_TOKEN);
});

beforeEach(async () => {
  jest.clearAllMocks();
  clearMcpSignInCachesForTests();
  (globalThis as MockBillingGlobal).__mcpServerTestBillingEnabled = true;

  fake = await FakeMcpServer.start({
    serverName: "aws-mcp",
    serverVersion: "1.4.0",
    requiredHeaders: { authorization: `Bearer ${SAVED_TOKEN}` },
    tools: [
      { name: "describe_instances", readOnly: true },
      { name: "reboot_instance", readOnly: false },
    ],
  });

  servers = useInMemoryTable(ExternalMcpServerService, rows());

  const realFromServer: typeof ExternalMcpServerConnection.fromServer =
    ExternalMcpServerConnection.fromServer.bind(ExternalMcpServerConnection);

  jest
    .spyOn(ExternalMcpServerConnection, "fromServer")
    .mockImplementation((server: ExternalMcpServer) => {
      return realFromServer(server, { transport: new LocalMcpHttpTransport() });
    });

  props = caller([Permission.ProjectOwner]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
});

afterEach(async () => {
  jest.restoreAllMocks();
  await fake.stop();
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

describe("Test connection, by whoever may change the server", () => {
  test.each([
    ["a project owner", [Permission.ProjectOwner]],
    ["a project admin", [Permission.ProjectAdmin]],
  ])(
    "%s connects with the saved token, reads the tools and keeps what it found",
    async (_who: string, permissions: Array<Permission>) => {
      props = caller(permissions);

      await pressTest();

      const answer: JSONObject = verdict();
      expect(answer["isConnected"]).toBe(true);
      expect(answer["serverName"]).toBe("aws-mcp");
      expect(answer["serverVersion"]).toBe("1.4.0");
      expect(answer["transport"]).toBe("StreamableHttp");
      expect(answer["tools"]).toEqual([
        { name: "describe_instances", readsOnly: true },
        { name: "reboot_instance", readsOnly: false },
      ]);
      expect(answer["message"]).toBe(
        'Connected to "aws-mcp" over Streamable HTTP. It offers 2 tools, 1 of them only reads.',
      );

      // The test calls no tool on the server.
      expect(fake.calls).toEqual([]);
      expect(fake.methods()).not.toContain("tools/call");

      // Kept on the record: the list says how the server is doing.
      const record: StoredRow = servers.get(SERVER_ID)!;
      expect(record["lastConnectedAt"]).toBeTruthy();
      expect(record["lastError"]).toBeNull();
      expect(record["serverName"]).toBe("aws-mcp");

      // The saved token is never in the answer.
      expect(JSON.stringify(answer)).not.toContain(SAVED_TOKEN);
    },
  );

  test("a server that refuses the sign-in is the test's answer, kept as the last error", async () => {
    await fake.stop();
    fake = await FakeMcpServer.start({
      requiredHeaders: { authorization: "Bearer another-token" },
      tools: [{ name: "describe_instances", readOnly: true }],
    });
    servers = useInMemoryTable(ExternalMcpServerService, rows());

    await pressTest();

    const answer: JSONObject = verdict();
    expect(answer["isConnected"]).toBe(false);
    expect(answer["failureKind"]).toBe(
      ExternalMcpServerFailureKind.SignInRefused,
    );
    expect(servers.get(SERVER_ID)!["lastError"]).toBe(answer["message"]);
    expect(JSON.stringify(answer)).not.toContain(SAVED_TOKEN);
  });
});

describe("Test connection, refused", () => {
  test.each([
    ["a project member", [Permission.ProjectMember]],
    ["a viewer", [Permission.Viewer]],
  ])(
    "%s, who may read servers, is refused in the words of the locked button, and nothing is sent",
    async (_who: string, permissions: Array<Permission>) => {
      props = caller(permissions);

      await pressTest();

      expect(refusal().message).toBe(REFUSAL);
      expect(fake.requests).toEqual([]);
    },
  );

  test("the locked button's sentence is the refusal's, word for word", () => {
    expect(DASHBOARD_REFUSED_SENTENCE).toBe(
      EXTERNAL_MCP_SERVER_TEST_REFUSED_SENTENCE,
    );
    expect(REFUSAL.startsWith(EXTERNAL_MCP_SERVER_TEST_REFUSED_SENTENCE)).toBe(
      true,
    );
  });

  test("another project's server, a missing one and an id that is not one are answered alike", async () => {
    for (const id of [
      OTHER_PROJECT_SERVER_ID,
      MISSING_SERVER_ID,
      "not-an-id",
    ]) {
      jest.clearAllMocks();

      await pressTest(id);

      const error: Exception = refusal();
      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(EXTERNAL_MCP_SERVER_NOT_FOUND_MESSAGE);
    }

    expect(fake.requests).toEqual([]);
  });

  test("no id at all is asked for", async () => {
    await pressTest(undefined, {});

    expect(refusal().message).toBe(EXTERNAL_MCP_SERVER_ID_REQUIRED_MESSAGE);
  });

  test("below the plan that sells servers, the owner is asked to upgrade", async () => {
    props = {
      ...caller([Permission.ProjectOwner]),
      currentPlan: PlanType.Free,
      isSubscriptionUnpaid: false,
    };

    await pressTest();

    const error: Exception = refusal();
    expect(error).toBeInstanceOf(PaymentRequiredException);
    expect(fake.requests).toEqual([]);
  });
});
