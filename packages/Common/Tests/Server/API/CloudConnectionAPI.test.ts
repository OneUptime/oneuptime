import CloudConnectionAPI from "../../../Server/API/CloudConnectionAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudConnectionService from "../../../Server/Services/CloudConnectionService";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import Response from "../../../Server/Utils/Response";
import CloudConnectorRegistry from "../../../Server/Utils/CloudConnection/CloudConnectorRegistry";
import CloudConnectionScheduler from "../../../Server/Utils/CloudConnection/CloudConnectionScheduler";
import AwsServerIdentity from "../../../Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import {
  CloudConnectionSettings,
  CloudConnector,
} from "../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../Types/CloudConnection/CloudConnectionCatalog";
import { getAwsExternalIdForProject } from "../../../Types/CloudConnection/CloudConnectionSetupCommands";
import {
  CloudConnectionFailureKind,
  CloudConnectionTestResult,
} from "../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * The three routes beside the cloud connections' CRUD: "Test connection"
 * (a saved connection with the form's unsaved values over it, or settings
 * never saved), "Read now", and the AWS role setup the form writes its
 * command from. All are for project owners and admins only, scoped to the
 * caller's project, check settings before anything is sent, sign in to a
 * role with the connection's own project's external id, and never answer
 * with a credential. `jest` is the global one.
 */

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;
const recordedRoutes: Array<{
  method: string;
  uri: string;
  handlers: Array<Handler>;
}> = [];

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      const record: (
        method: string,
      ) => (uri: string, ...handlers: Array<Handler>) => void = (
        method: string,
      ) => {
        return (uri: string, ...handlers: Array<Handler>): void => {
          recordedRoutes.push({ method, uri, handlers });
        };
      };

      return {
        post: record("post"),
        get: record("get"),
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
  "../../../Server/Utils/CloudConnection/CloudConnectorRegistry",
  () => {
    return { __esModule: true, default: { getConnector: jest.fn() } };
  },
);
jest.mock(
  "../../../Server/Utils/CloudConnection/CloudConnectionScheduler",
  () => {
    return { __esModule: true, default: { enqueue: jest.fn() } };
  },
);

const ActualRegistry: typeof CloudConnectorRegistry = (
  jest.requireActual(
    "../../../Server/Utils/CloudConnection/CloudConnectorRegistry",
  ) as { default: typeof CloudConnectorRegistry }
).default;

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const USER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ACCESS_KEY_ID: string = "AKIAIOSFODNN7EXAMPLE";
const STORED_SECRET: string = "storedSecretAccessKey/aaaaaaaaaaaaaaaaaaaa";
const NEW_SECRET: string = "newSecretAccessKey/bbbbbbbbbbbbbbbbbbbbbbb";

const PASS: CloudConnectionTestResult = {
  provider: CloudProvider.AWS,
  status: "pass",
  message: "Signed in to AWS account 123456789012 and found 3 resources.",
  accounts: ["123456789012"],
  resourceCount: 3,
  durationMs: 120,
};

let props: DatabaseCommonInteractionProps;
let testHandler: Handler;
let readNowHandler: Handler;
let roleSetupHandler: Handler;
let next: jest.Mock;
let testConnection: jest.Mock;
let accessible: CloudConnection | null;
const res: ExpressResponse = {} as ExpressResponse;

function setPermission(permission: Permission): void {
  props.userTenantAccessPermission = {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: [
        {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    },
  };
}

function route(
  method: string,
  uri: string,
): { uri: string; handlers: Array<Handler> } {
  const found: { uri: string; handlers: Array<Handler> } | undefined =
    recordedRoutes.find((item: { method: string; uri: string }) => {
      return item.method === method && item.uri === uri;
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

function testedWith(): CloudConnectionSettings {
  expect(testConnection).toHaveBeenCalledTimes(1);
  return testConnection.mock.calls[0]![0] as CloudConnectionSettings;
}

beforeAll(() => {
  new CloudConnectionAPI();
  testHandler = route("post", "/cloud-connection/test").handlers.slice(-1)[0]!;
  readNowHandler = route(
    "post",
    "/cloud-connection/:connectionId/read-now",
  ).handlers.slice(-1)[0]!;
  roleSetupHandler = route(
    "get",
    "/cloud-connection/aws-role-setup",
  ).handlers.slice(-1)[0]!;
});

beforeEach(() => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
  props = { userId: USER, tenantId: PROJECT };
  setPermission(Permission.ProjectAdmin);
  next = jest.fn();
  testConnection = jest.fn(async () => {
    return PASS;
  });
  // The real connectors validate; only the test that signs in is stubbed.
  (CloudConnectorRegistry.getConnector as jest.Mock).mockImplementation(
    (provider: string): CloudConnector => {
      const real: CloudConnector = ActualRegistry.getConnector(provider);

      return {
        provider: real.provider,
        validateSettings: real.validateSettings.bind(real),
        testConnection,
        read: jest.fn(),
      } as unknown as CloudConnector;
    },
  );
  (CloudConnectionScheduler.enqueue as jest.Mock).mockResolvedValue(undefined);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });

  accessible = new CloudConnection();
  accessible.id = CONNECTION;
  accessible.projectId = PROJECT;
  accessible.isEnabled = true;
  jest
    .spyOn(CloudConnectionService, "findOneBy")
    .mockImplementation((async () => {
      return accessible;
    }) as never);
  jest.spyOn(CloudConnectionService, "getConnectorSettings").mockResolvedValue({
    provider: CloudProvider.AWS,
    projectId: PROJECT.toString(),
    config: {
      authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      accessKeyId: ACCESS_KEY_ID,
    },
    secrets: { secretAccessKey: STORED_SECRET },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("route registration", () => {
  test.each([
    ["post", "/cloud-connection/test"],
    ["post", "/cloud-connection/:connectionId/read-now"],
    ["get", "/cloud-connection/aws-role-setup"],
  ])(
    "%s %s resolves the user and requires authentication before its handler",
    (method: string, uri: string) => {
      expect(route(method, uri).handlers.slice(0, 2)).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
      expect(route(method, uri).handlers).toHaveLength(3);
    },
  );
});

describe("POST /cloud-connection/test", () => {
  test.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "%s tests settings never saved, in the caller's own project",
    async (permission: Permission) => {
      setPermission(permission);

      await testHandler(
        request({
          provider: CloudProvider.AWS,
          projectId: OTHER_PROJECT.toString(),
          config: { accessKeyId: ACCESS_KEY_ID },
          secrets: { secretAccessKey: NEW_SECRET },
        }),
        res,
        next,
      );

      expect(next).not.toHaveBeenCalled();
      expect(testedWith()).toEqual({
        provider: CloudProvider.AWS,
        // Never a project the body names.
        projectId: PROJECT.toString(),
        config: {
          accessKeyId: ACCESS_KEY_ID,
          readIntervalInMinutes: "10",
          // Data Security reads nothing until it is chosen.
          dataSecurity: "off",
          dataSecurityResponse: "off",
          authMethod: CloudConnectionAuthMethod.AwsAccessKey,
        },
        secrets: { secretAccessKey: NEW_SECRET },
      });
      expect(sent()).toEqual(PASS);
      expect(CloudConnectionService.findOneBy).not.toHaveBeenCalled();
    },
  );

  test.each([
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadCloudResource,
  ])("%s may not test", async (permission: Permission) => {
    setPermission(permission);

    await testHandler(
      request({ provider: CloudProvider.AWS, config: {}, secrets: {} }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect((next.mock.calls[0]![0] as Error).message).toContain(
      "Project owners and project administrators",
    );
    expect(testConnection).not.toHaveBeenCalled();
  });

  test("settings a save would refuse are the test's answer, and nothing is sent", async () => {
    await testHandler(
      request({
        provider: CloudProvider.AWS,
        config: { accessKeyId: ACCESS_KEY_ID, regions: "moon-1" },
        secrets: { secretAccessKey: "SECRETVALUEINAREFUSAL" },
      }),
      res,
      next,
    );

    expect(testConnection).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();

    const result: JSONObject = sent();

    expect(result).toMatchObject({
      status: "fail",
      failureKind: CloudConnectionFailureKind.Settings,
    });
    expect(String(result["message"])).toContain("moon-1");
    expect(JSON.stringify(result)).not.toContain("SECRETVALUEINAREFUSAL");
  });

  test("an unknown cloud is a settings failure", async () => {
    await testHandler(
      request({ provider: "oracle", config: {}, secrets: {} }),
      res,
      next,
    );

    expect(sent()).toMatchObject({
      status: "fail",
      failureKind: CloudConnectionFailureKind.Settings,
    });
  });

  test("a saved connection is tested with its stored secret, read in the caller's project", async () => {
    await testHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(CloudConnectionService.findOneBy).toHaveBeenCalledWith({
      query: { _id: CONNECTION.toString(), projectId: PROJECT },
      select: { _id: true, projectId: true },
      props,
    });
    expect(testedWith().secrets).toEqual({ secretAccessKey: STORED_SECRET });
    expect(testedWith().projectId).toBe(PROJECT.toString());
    expect(JSON.stringify(sent())).not.toContain(STORED_SECRET);
  });

  test("the form's unsaved secret is tested over the stored one; an empty one keeps it", async () => {
    await testHandler(
      request({
        connectionId: CONNECTION.toString(),
        secrets: { secretAccessKey: NEW_SECRET },
      }),
      res,
      next,
    );
    expect(testedWith().secrets).toEqual({ secretAccessKey: NEW_SECRET });

    testConnection.mockClear();
    (Response.sendJsonObjectResponse as jest.Mock).mockClear();

    await testHandler(
      request({
        connectionId: CONNECTION.toString(),
        secrets: { secretAccessKey: "" },
      }),
      res,
      next,
    );
    expect(testedWith().secrets).toEqual({ secretAccessKey: STORED_SECRET });
  });

  test("another project's connection is refused before its settings are read", async () => {
    accessible = null;

    await testHandler(
      request({ connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(CloudConnectionService.getConnectorSettings).not.toHaveBeenCalled();
    expect(testConnection).not.toHaveBeenCalled();
  });

  test("an id that is not one is the test's answer", async () => {
    await testHandler(request({ connectionId: "not-an-id" }), res, next);

    expect(sent()).toMatchObject({
      status: "fail",
      message: "A valid connection ID is required.",
    });
  });

  test("a connector that throws is still answered as a failed test", async () => {
    testConnection.mockRejectedValue(new Error(`boom ${NEW_SECRET}`));

    await testHandler(
      request({
        provider: CloudProvider.AWS,
        config: { accessKeyId: ACCESS_KEY_ID },
        secrets: { secretAccessKey: NEW_SECRET },
      }),
      res,
      next,
    );

    const result: JSONObject = sent();
    expect(result["status"]).toBe("fail");
    expect(JSON.stringify(result)).not.toContain(NEW_SECRET);
  });
});

describe("POST /cloud-connection/:connectionId/read-now", () => {
  test("queues a read of an enabled connection of the caller's project", async () => {
    await readNowHandler(
      request({}, { connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(CloudConnectionScheduler.enqueue).toHaveBeenCalledWith(
      CONNECTION,
      expect.any(Date),
    );
    expect(sent()).toEqual({ queued: true });
  });

  test("a connection that is off is not read", async () => {
    accessible!.isEnabled = false;

    await readNowHandler(
      request({}, { connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect((next.mock.calls[0]![0] as Error).message).toContain(
      "This connection is turned off",
    );
    expect(CloudConnectionScheduler.enqueue).not.toHaveBeenCalled();
  });

  test("another project's connection, or no id, is refused", async () => {
    accessible = null;

    await readNowHandler(
      request({}, { connectionId: CONNECTION.toString() }),
      res,
      next,
    );
    await readNowHandler(request({}, { connectionId: "x" }), res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(CloudConnectionScheduler.enqueue).not.toHaveBeenCalled();
  });

  test("a member may not read a connection now", async () => {
    setPermission(Permission.ProjectMember);

    await readNowHandler(
      request({}, { connectionId: CONNECTION.toString() }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(CloudConnectionScheduler.enqueue).not.toHaveBeenCalled();
  });
});

describe("GET /cloud-connection/aws-role-setup", () => {
  test("answers with the caller's project's external id, and what a role trusts", async () => {
    jest.spyOn(AwsServerIdentity, "getRoleSetup").mockResolvedValue({
      isAvailable: true,
      trustedPrincipalArn: "arn:aws:iam::999988887777:root",
      externalId: getAwsExternalIdForProject(PROJECT.toString()),
    });

    await roleSetupHandler(
      request({ projectId: OTHER_PROJECT.toString() }),
      res,
      next,
    );

    expect(AwsServerIdentity.getRoleSetup).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT.toString() }),
    );
    expect(sent()).toEqual({
      isAvailable: true,
      trustedPrincipalArn: "arn:aws:iam::999988887777:root",
      externalId: getAwsExternalIdForProject(PROJECT.toString()),
    });
  });

  test("a member may not ask", async () => {
    setPermission(Permission.ProjectMember);
    jest.spyOn(AwsServerIdentity, "getRoleSetup");

    await roleSetupHandler(request({}), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(AwsServerIdentity.getRoleSetup).not.toHaveBeenCalled();
  });
});
