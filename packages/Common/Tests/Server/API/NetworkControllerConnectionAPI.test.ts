import NetworkControllerConnectionAPI from "../../../Server/API/NetworkControllerConnectionAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import NetworkControllerConnection from "../../../Models/DatabaseModels/NetworkControllerConnection";
import NetworkControllerConnectionService from "../../../Server/Services/NetworkControllerConnectionService";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import Response from "../../../Server/Utils/Response";
import NetworkControllerConnectorRegistry from "../../../Server/Utils/NetworkController/NetworkControllerConnectorRegistry";
import NetworkControllerScheduler from "../../../Server/Utils/NetworkController/NetworkControllerScheduler";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../Types/LlmObservability/LlmConnectionTest";
import { MerakiRegion } from "../../../Types/NetworkController/MerakiRegion";
import { NetworkControllerConfig } from "../../../Types/NetworkController/NetworkControllerConnectionSettings";
import { NetworkControllerTestResult } from "../../../Types/NetworkController/NetworkControllerConnectionTest";
import NetworkControllerProvider from "../../../Types/NetworkController/NetworkControllerProvider";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * The two routes beside the Meraki connections' CRUD: "Test" (settings
 * never saved - the key, the region, the organization once one is picked -
 * or a saved connection with the form's unsaved values over it) and "Read
 * now". Both are for project owners and admins only, are scoped to the
 * caller's project, check settings before anything is sent to Meraki, and
 * never answer with the key. `jest` is the global one.
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
jest.mock(
  "../../../Server/Utils/NetworkController/NetworkControllerConnectorRegistry",
  () => {
    return { __esModule: true, default: { getConnector: jest.fn() } };
  },
);
jest.mock(
  "../../../Server/Utils/NetworkController/NetworkControllerScheduler",
  () => {
    return { __esModule: true, default: { enqueue: jest.fn() } };
  },
);

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const STORED_KEY: string = "0123456789abcdef0123456789abcdef01234567";
const NEW_KEY: string = "fedcba9876543210fedcba9876543210fedcba98";

const STORED_CONFIG: NetworkControllerConfig = {
  region: MerakiRegion.Global,
  organizationId: "549236",
  organizationName: "Acme Retail",
  readIntervalInMinutes: 5,
};

const PASS: NetworkControllerTestResult = {
  provider: NetworkControllerProvider.Meraki,
  status: "pass",
  message: "Reads 312 networks and 287 appliances in Acme Retail.",
  organizations: [{ id: "549236", name: "Acme Retail" }],
  organizationId: "549236",
  networkCount: 312,
  applianceCount: 287,
  durationMs: 120,
};

let props: DatabaseCommonInteractionProps;
let testHandler: Handler;
let readNowHandler: Handler;
let next: jest.Mock;
let testConnection: jest.Mock;
let accessible: NetworkControllerConnection | null;
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

function testedWith(): { apiKey: string; config: NetworkControllerConfig } {
  expect(testConnection).toHaveBeenCalledTimes(1);
  return testConnection.mock.calls[0]![0] as {
    apiKey: string;
    config: NetworkControllerConfig;
  };
}

beforeAll(() => {
  new NetworkControllerConnectionAPI();
  testHandler = route("/network-controller-connection/test").handlers.slice(
    -1,
  )[0]!;
  readNowHandler = route(
    "/network-controller-connection/:connectionId/read-now",
  ).handlers.slice(-1)[0]!;
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT };
  setPermission(Permission.ProjectAdmin);
  next = jest.fn();
  testConnection = jest.fn(async () => {
    return PASS;
  });
  (
    NetworkControllerConnectorRegistry.getConnector as jest.Mock
  ).mockReturnValue({
    provider: NetworkControllerProvider.Meraki,
    testConnection,
  });
  (NetworkControllerScheduler.enqueue as jest.Mock).mockResolvedValue(
    undefined,
  );

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });

  accessible = new NetworkControllerConnection();
  accessible.id = CONNECTION;
  accessible.projectId = PROJECT;
  accessible.isEnabled = true;
  jest
    .spyOn(NetworkControllerConnectionService, "findOneBy")
    .mockImplementation((async () => {
      return accessible;
    }) as never);
  jest
    .spyOn(NetworkControllerConnectionService, "getControllerSettings")
    .mockResolvedValue({
      provider: NetworkControllerProvider.Meraki,
      projectId: PROJECT.toString(),
      config: STORED_CONFIG,
      apiKey: STORED_KEY,
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("route registration", () => {
  test.each([
    "/network-controller-connection/test",
    "/network-controller-connection/:connectionId/read-now",
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

describe("POST /network-controller-connection/test", () => {
  test.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "%s tests a key never saved, before an organization is picked",
    async (permission: Permission) => {
      setPermission(permission);

      await testHandler(
        request({
          provider: "meraki",
          config: { region: "canada" },
          secrets: { apiKey: ` ${NEW_KEY} ` },
        }),
        res,
        next,
      );

      expect(next).not.toHaveBeenCalled();
      expect(testedWith()).toEqual({
        apiKey: NEW_KEY,
        config: {
          region: MerakiRegion.Canada,
          organizationId: "",
          organizationName: "",
          readIntervalInMinutes: 5,
        },
      });
      // Through the SSRF-guarded transport, never one the request names.
      expect(typeof testConnection.mock.calls[0]![1].transport).toBe(
        "function",
      );
      expect(sent()).toEqual(PASS);
      expect(
        NetworkControllerConnectionService.findOneBy,
      ).not.toHaveBeenCalled();
    },
  );

  test.each([
    [
      "a key that cannot be one",
      { secrets: { apiKey: "short" } },
      "This is not a Meraki dashboard API key",
    ],
    ["no key", { secrets: {} }, "Enter the Meraki dashboard API key"],
    [
      "a region that is not Meraki's",
      { config: { region: "mars" }, secrets: { apiKey: NEW_KEY } },
      "Region must be one of Meraki's dashboards",
    ],
    [
      "an address to call",
      { config: { url: "https://evil.example" }, secrets: { apiKey: NEW_KEY } },
      'Settings has no "url"',
    ],
    [
      "another controller",
      { provider: "unifi", secrets: { apiKey: NEW_KEY } },
      "Controller must be 'meraki'",
    ],
  ])(
    "%s is the test's answer, and nothing is sent to Meraki",
    async (_name: string, body: JSONObject, message: string) => {
      await testHandler(request(body), res, next);

      expect(testConnection).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      const result: JSONObject = sent();
      expect(result).toMatchObject({
        status: "fail",
        failureKind: LlmConnectionFailureKind.Settings,
      });
      expect(result["message"]).toContain(message);
      expect(JSON.stringify(result)).not.toContain(NEW_KEY);
    },
  );

  test("a saved connection is tested with its stored key, read in the caller's project", async () => {
    await testHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(NetworkControllerConnectionService.findOneBy).toHaveBeenCalledWith({
      query: { _id: CONNECTION.toString(), projectId: PROJECT },
      select: { _id: true, projectId: true },
      props,
    });
    expect(testedWith()).toEqual({ apiKey: STORED_KEY, config: STORED_CONFIG });
    expect(JSON.stringify(sent())).not.toContain(STORED_KEY);
  });

  test("the form's unsaved key and interval are tested over the stored ones; an empty key keeps it", async () => {
    await testHandler(
      request({
        connectionId: CONNECTION.toString(),
        config: { readIntervalInMinutes: 15 },
        secrets: { apiKey: NEW_KEY },
      }),
      res,
      next,
    );
    expect(testedWith()).toEqual({
      apiKey: NEW_KEY,
      config: { ...STORED_CONFIG, readIntervalInMinutes: 15 },
    });

    testConnection.mockClear();
    (Response.sendJsonObjectResponse as jest.Mock).mockClear();

    await testHandler(
      request({ connectionId: CONNECTION.toString(), secrets: { apiKey: "" } }),
      res,
      next,
    );
    expect(testedWith().apiKey).toBe(STORED_KEY);
  });

  test.each([
    ["another organization", { organizationId: "777001" }],
    ["another region", { region: "china" }],
  ])(
    "a saved connection's key is never tested against %s",
    async (_name: string, config: JSONObject) => {
      await testHandler(
        request({ connectionId: CONNECTION.toString(), config }),
        res,
        next,
      );

      expect(testConnection).not.toHaveBeenCalled();
      expect(sent()).toMatchObject({
        status: "fail",
        failureKind: LlmConnectionFailureKind.Settings,
        message:
          "A saved connection is tested with its own organization and region. To try another one, connect it as well.",
      });
    },
  );

  test("another project's connection is refused before its settings are read", async () => {
    accessible = null;

    await testHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(
      NetworkControllerConnectionService.getControllerSettings,
    ).not.toHaveBeenCalled();
    expect(testConnection).not.toHaveBeenCalled();
  });

  test("a connection ID that is not one is a settings failure", async () => {
    await testHandler(request({ connectionId: "../../users" }), res, next);

    expect(sent()).toMatchObject({
      status: "fail",
      failureKind: LlmConnectionFailureKind.Settings,
    });
    expect(NetworkControllerConnectionService.findOneBy).not.toHaveBeenCalled();
  });

  test.each([
    Permission.ProjectMember,
    Permission.ReadNetworkDevice,
    Permission.Viewer,
  ])(
    "%s may not test, and nothing is read or sent",
    async (permission: Permission) => {
      setPermission(permission);

      await testHandler(
        request({ provider: "meraki", secrets: { apiKey: NEW_KEY } }),
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
    expect(NetworkControllerConnectionService.findOneBy).not.toHaveBeenCalled();
  });

  test("a test that throws anyway is answered as a failure without the key", async () => {
    testConnection.mockRejectedValue(new Error(`socket hang up ${NEW_KEY}`));

    await testHandler(
      request({ provider: "meraki", secrets: { apiKey: NEW_KEY } }),
      res,
      next,
    );

    const result: JSONObject = sent();
    expect(result["status"]).toBe("fail");
    expect(JSON.stringify(result)).not.toContain(NEW_KEY);
  });
});

describe("POST /network-controller-connection/:connectionId/read-now", () => {
  test("queues a read of an enabled connection of the caller's project", async () => {
    await readNowHandler(
      request({}, { connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(NetworkControllerConnectionService.findOneBy).toHaveBeenCalledWith({
      query: { _id: CONNECTION.toString(), projectId: PROJECT },
      select: { _id: true, projectId: true, isEnabled: true },
      props,
    });
    expect(NetworkControllerScheduler.enqueue).toHaveBeenCalledWith(
      CONNECTION,
      expect.any(Date),
    );
    expect(sent()).toEqual({ queued: true });
    // The API process never reads the key to queue a read.
    expect(
      NetworkControllerConnectionService.getControllerSettings,
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
    expect(NetworkControllerScheduler.enqueue).not.toHaveBeenCalled();
  });

  test("another project's connection, or an ID that is not one, is not read", async () => {
    accessible = null;
    await readNowHandler(
      request({}, { connectionId: CONNECTION.toString() }),
      res,
      next,
    );
    await readNowHandler(request({}, { connectionId: "1 OR 1=1" }), res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(NetworkControllerScheduler.enqueue).not.toHaveBeenCalled();
  });

  test("a member may not read now", async () => {
    setPermission(Permission.ProjectMember);

    await readNowHandler(
      request({}, { connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(NetworkControllerScheduler.enqueue).not.toHaveBeenCalled();
  });
});
