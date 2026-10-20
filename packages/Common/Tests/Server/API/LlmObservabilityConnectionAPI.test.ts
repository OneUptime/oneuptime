import LlmObservabilityConnectionAPI from "../../../Server/API/LlmObservabilityConnectionAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import LlmObservabilityConnection from "../../../Models/DatabaseModels/LlmObservabilityConnection";
import LlmObservabilityConnectionService from "../../../Server/Services/LlmObservabilityConnectionService";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import Response from "../../../Server/Utils/Response";
import LlmConnectorRegistry from "../../../Server/Utils/LlmObservability/LlmConnectorRegistry";
import LlmConnectionScheduler from "../../../Server/Utils/LlmObservability/LlmConnectionScheduler";
import { LlmConnectionSettings } from "../../../Server/Utils/LlmObservability/LlmConnectorTypes";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import LlmConnectionProvider from "../../../Types/LlmObservability/LlmConnectionProvider";
import {
  LlmConnectionFailureKind,
  LlmConnectionTestResult,
} from "../../../Types/LlmObservability/LlmConnectionTest";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * The two routes beside the AI connections' CRUD: "Test connection" (a
 * saved connection with the form's unsaved values over it, or settings
 * never saved) and "Read now". Both are for project owners and admins
 * only, are scoped to the caller's project, check settings before anything
 * is sent, and never answer with a credential. `jest` is the global one.
 */

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;
const recordedRoutes: Array<{ uri: string; handlers: Array<Handler> }> = [];

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return {
        post: (uri: string, ...handlers: Array<Handler>): void => {
          recordedRoutes.push({ uri, handlers });
        },
        get: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
      };
    },
  };
});
jest.mock("../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn() };
});
jest.mock("../../../Server/Utils/LlmObservability/LlmConnectorRegistry", () => {
  return { __esModule: true, default: { getConnector: jest.fn() } };
});
jest.mock(
  "../../../Server/Utils/LlmObservability/LlmConnectionScheduler",
  () => {
    return { __esModule: true, default: { enqueue: jest.fn() } };
  },
);

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const STORED_KEY: string = "sk-admin-stored-key-111111";
const NEW_KEY: string = "sk-admin-new-key-222222";

const PASS: LlmConnectionTestResult = {
  provider: LlmConnectionProvider.OpenAI,
  status: "pass",
  message: "Connected. Found usage in the last 7 days.",
  counts: { days: 7, models: 2 },
  durationMs: 120,
};

let props: DatabaseCommonInteractionProps;
let testHandler: Handler;
let readNowHandler: Handler;
let next: jest.Mock;
let testConnection: jest.Mock;
let accessible: LlmObservabilityConnection | null;
const res: ExpressResponse = {} as ExpressResponse;

function setPermission(permission: Permission, blocked: boolean = false): void {
  props.userTenantAccessPermission = {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: [
        {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: blocked,
        },
      ],
    },
  };
}

function route(uri: string): { uri: string; handlers: Array<Handler> } {
  const found: { uri: string; handlers: Array<Handler> } | undefined =
    recordedRoutes.find((item: { uri: string }) => {
      return item.uri === uri;
    });
  expect(found).toBeDefined();
  return found!;
}

function request(body: JSONObject, params: JSONObject = {}): ExpressRequest {
  return { body, params } as unknown as ExpressRequest;
}

function sent(): JSONObject {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as jest.Mock
  ).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0]![2] as JSONObject;
}

function testedWith(): LlmConnectionSettings {
  expect(testConnection).toHaveBeenCalledTimes(1);
  return testConnection.mock.calls[0]![0] as LlmConnectionSettings;
}

beforeAll(() => {
  new LlmObservabilityConnectionAPI();
  testHandler = route("/llm-observability-connection/test").handlers.slice(
    -1,
  )[0]!;
  readNowHandler = route(
    "/llm-observability-connection/:connectionId/read-now",
  ).handlers.slice(-1)[0]!;
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT };
  setPermission(Permission.ProjectAdmin);
  next = jest.fn();
  testConnection = jest.fn(async () => {
    return PASS;
  });
  (LlmConnectorRegistry.getConnector as jest.Mock).mockReturnValue({
    provider: LlmConnectionProvider.OpenAI,
    kind: "provider-account",
    // The real check of the key's shape, so a wrong key is refused before a test.
    validateSettings: (settings: LlmConnectionSettings) => {
      if (!String(settings.secrets["adminKey"] || "").startsWith("sk-admin-")) {
        throw new BadDataException(
          "An OpenAI admin key starts with sk-admin-.",
        );
      }
    },
    testConnection,
  });
  (LlmConnectionScheduler.enqueue as jest.Mock).mockResolvedValue(undefined);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });

  accessible = new LlmObservabilityConnection();
  accessible.id = CONNECTION;
  accessible.projectId = PROJECT;
  accessible.isEnabled = true;
  jest
    .spyOn(LlmObservabilityConnectionService, "findOneBy")
    .mockImplementation((async () => {
      return accessible;
    }) as never);
  jest
    .spyOn(LlmObservabilityConnectionService, "getConnectorSettings")
    .mockResolvedValue({
      provider: LlmConnectionProvider.OpenAI,
      config: {},
      secrets: { adminKey: STORED_KEY },
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("route registration", () => {
  test.each([
    "/llm-observability-connection/test",
    "/llm-observability-connection/:connectionId/read-now",
  ])(
    "%s resolves the user and requires authentication before its handler",
    (uri: string) => {
      expect(route(uri).handlers.slice(0, 2)).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
      expect(route(uri).handlers).toHaveLength(3);
    },
  );
});

describe("POST /llm-observability-connection/test", () => {
  test.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "%s tests settings never saved",
    async (permission: Permission) => {
      setPermission(permission);

      await testHandler(
        request({
          provider: LlmConnectionProvider.OpenAI,
          config: {},
          secrets: { adminKey: NEW_KEY },
        }),
        res,
        next,
      );

      expect(next).not.toHaveBeenCalled();
      expect(testedWith()).toEqual({
        provider: LlmConnectionProvider.OpenAI,
        config: {},
        secrets: { adminKey: NEW_KEY },
      });
      expect(sent()).toEqual(PASS);
      expect(
        LlmObservabilityConnectionService.findOneBy,
      ).not.toHaveBeenCalled();
    },
  );

  test("settings a save would refuse are the test's answer, and nothing is sent", async () => {
    await testHandler(
      request({
        provider: LlmConnectionProvider.OpenAI,
        config: {},
        secrets: { adminKey: "sk-proj-PROJECTKEYVALUE" },
      }),
      res,
      next,
    );

    expect(testConnection).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    const result: JSONObject = sent();
    expect(result).toMatchObject({
      status: "fail",
      failureKind: LlmConnectionFailureKind.Settings,
      message: "An OpenAI admin key starts with sk-admin-.",
    });
    expect(JSON.stringify(result)).not.toContain("PROJECTKEYVALUE");
  });

  test("an unknown provider is a settings failure", async () => {
    await testHandler(
      request({ provider: "openrouter", config: {}, secrets: {} }),
      res,
      next,
    );

    expect(sent()).toMatchObject({
      status: "fail",
      failureKind: LlmConnectionFailureKind.Settings,
    });
    expect(testConnection).not.toHaveBeenCalled();
  });

  test("a saved connection is tested with its stored key, read in the caller's project", async () => {
    await testHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(LlmObservabilityConnectionService.findOneBy).toHaveBeenCalledWith({
      query: { _id: CONNECTION.toString(), projectId: PROJECT },
      select: { _id: true, projectId: true },
      props,
    });
    expect(testedWith().secrets).toEqual({ adminKey: STORED_KEY });
    expect(JSON.stringify(sent())).not.toContain(STORED_KEY);
  });

  test("the form's unsaved key is tested over the stored one; an empty one keeps it", async () => {
    await testHandler(
      request({
        connectionId: CONNECTION.toString(),
        secrets: { adminKey: NEW_KEY },
      }),
      res,
      next,
    );
    expect(testedWith().secrets).toEqual({ adminKey: NEW_KEY });

    testConnection.mockClear();
    (Response.sendJsonObjectResponse as jest.Mock).mockClear();

    await testHandler(
      request({
        connectionId: CONNECTION.toString(),
        secrets: { adminKey: "" },
      }),
      res,
      next,
    );
    expect(testedWith().secrets).toEqual({ adminKey: STORED_KEY });
  });

  test("another project's connection is refused before its settings are read", async () => {
    accessible = null;

    await testHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(
      LlmObservabilityConnectionService.getConnectorSettings,
    ).not.toHaveBeenCalled();
    expect(testConnection).not.toHaveBeenCalled();
  });

  test("a connection id that is not one is a settings failure", async () => {
    await testHandler(request({ connectionId: "../../users" }), res, next);

    expect(sent()).toMatchObject({
      status: "fail",
      failureKind: LlmConnectionFailureKind.Settings,
    });
    expect(LlmObservabilityConnectionService.findOneBy).not.toHaveBeenCalled();
  });

  test.each([
    Permission.ProjectMember,
    Permission.ReadTelemetryServiceTraces,
    Permission.Public,
  ])(
    "%s may not test, and nothing is read or sent",
    async (permission: Permission) => {
      setPermission(permission);

      await testHandler(
        request({
          provider: LlmConnectionProvider.OpenAI,
          config: {},
          secrets: { adminKey: NEW_KEY },
        }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(testConnection).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    },
  );

  test("a blocked admin is not an admin", async () => {
    setPermission(Permission.ProjectAdmin, true);

    await testHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(LlmObservabilityConnectionService.findOneBy).not.toHaveBeenCalled();
  });

  test("a test that throws anyway is answered as a failure without the key", async () => {
    testConnection.mockRejectedValue(new Error(`socket hang up ${NEW_KEY}`));

    await testHandler(
      request({
        provider: LlmConnectionProvider.OpenAI,
        config: {},
        secrets: { adminKey: NEW_KEY },
      }),
      res,
      next,
    );

    const result: JSONObject = sent();
    expect(result["status"]).toBe("fail");
    expect(JSON.stringify(result)).not.toContain(NEW_KEY);
  });
});

describe("POST /llm-observability-connection/:connectionId/read-now", () => {
  test("queues a read of an enabled connection of the caller's project", async () => {
    await readNowHandler(
      request({}, { connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(LlmObservabilityConnectionService.findOneBy).toHaveBeenCalledWith({
      query: { _id: CONNECTION.toString(), projectId: PROJECT },
      select: { _id: true, projectId: true, isEnabled: true },
      props,
    });
    expect(LlmConnectionScheduler.enqueue).toHaveBeenCalledWith(
      CONNECTION,
      expect.any(Date),
    );
    expect(sent()).toEqual({ queued: true });
    // The API process never reads the credentials.
    expect(
      LlmObservabilityConnectionService.getConnectorSettings,
    ).not.toHaveBeenCalled();
  });

  test("a connection that is off is not read", async () => {
    accessible!.isEnabled = false;

    await readNowHandler(
      request({}, { connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "This connection is turned off. Turn it on to read it.",
      }),
    );
    expect(LlmConnectionScheduler.enqueue).not.toHaveBeenCalled();
  });

  test.each([
    ["another project's connection", CONNECTION.toString(), null],
    ["an id that is not one", "not-an-id", undefined],
  ])(
    "%s is refused",
    async (_name: string, id: string, found: null | undefined) => {
      if (found === null) {
        accessible = null;
      }

      await readNowHandler(request({}, { connectionId: id }), res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(LlmConnectionScheduler.enqueue).not.toHaveBeenCalled();
    },
  );

  test("a member may not read now", async () => {
    setPermission(Permission.ProjectMember);

    await readNowHandler(
      request({}, { connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(LlmObservabilityConnectionService.findOneBy).not.toHaveBeenCalled();
    expect(LlmConnectionScheduler.enqueue).not.toHaveBeenCalled();
  });
});
