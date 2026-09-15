import SecurityEventConnectionAPI from "../../../Server/API/SecurityEventConnectionAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionService, {
  Service as SecurityEventConnectionServiceType,
} from "../../../Server/Services/SecurityEventConnectionService";
import SecurityEventConnectionRunExecutor from "../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionRunExecutor";
import SecurityEventConnectionTester from "../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionTester";
import { SecurityConnectorSettings } from "../../../Server/Utils/SecurityEvent/Connectors/Types";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { SecurityConnectorTestReport } from "../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";

/*
 * The two custom routes on the Security Event Connection API. Mirrors the
 * Google SecOps API suite: the permission gate is asserted in both
 * directions, tenant scoping cannot be forged through the route id, and
 * the synchronous test never persists anything - not for a saved
 * connection (whose stored secrets are overlaid, not replaced) and not for
 * unsaved settings.
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
  "../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry",
  () => {
    return { __esModule: true, default: { getConnector: jest.fn() } };
  },
);
jest.mock(
  "../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionRunExecutor",
  () => {
    return {
      __esModule: true,
      default: { enqueue: jest.fn(), validateOptions: jest.fn() },
    };
  },
);
jest.mock(
  "../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionTester",
  () => {
    return { __esModule: true, default: { test: jest.fn() } };
  },
);

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUN: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const STORED_SECRET: string = "stored-okta-token-1a2b3c";
const NEW_SECRET: string = "rotated-okta-token-4d5e6f";
const STORED_SETTINGS: SecurityConnectorSettings = {
  provider: SecurityEventConnectorProvider.OktaSystemLog,
  config: { orgUrl: "https://acme.okta.com", filter: "" },
  secrets: { apiToken: STORED_SECRET },
  alertingOnly: true,
};
const REPORT: SecurityConnectorTestReport = {
  provider: SecurityEventConnectorProvider.OktaSystemLog,
  status: "pass",
  startedAt: "2026-09-10T12:00:00.000Z",
  completedAt: "2026-09-10T12:00:01.000Z",
  durationMs: 1000,
  checks: [],
  summary: "All good.",
};

let props: DatabaseCommonInteractionProps;
let runHandler: Handler;
let testHandler: Handler;
let next: jest.Mock;
let req: ExpressRequest;
let loaded: SecurityEventConnection;
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

beforeAll(() => {
  new SecurityEventConnectionAPI();
  runHandler = route(
    "/security-event-connection/:connectionId/run",
  ).handlers.slice(-1)[0]!;
  testHandler = route("/security-event-connection/test").handlers.slice(-1)[0]!;
});
beforeEach(() => {
  props = { userId: OTHER, tenantId: PROJECT };
  setPermission(Permission.SecurityAdmin);
  req = {
    params: { connectionId: CONNECTION.toString() },
    body: { type: "test" },
  } as unknown as ExpressRequest;
  next = jest.fn();
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });
  const accessible: SecurityEventConnection = new SecurityEventConnection();
  accessible.id = CONNECTION;
  accessible.projectId = PROJECT;
  jest
    .spyOn(SecurityEventConnectionService, "findOneBy")
    .mockResolvedValue(accessible);
  loaded = new SecurityEventConnection();
  loaded.id = CONNECTION;
  loaded.projectId = PROJECT;
  loaded.provider = SecurityEventConnectorProvider.OktaSystemLog;
  loaded.config = STORED_SETTINGS.config;
  loaded.secrets = JSON.stringify(STORED_SETTINGS.secrets);
  loaded.alertingOnly = true;
  loaded.isEnabled = true;
  jest
    .spyOn(SecurityEventConnectionService, "findOneById")
    .mockResolvedValue(loaded);
  jest
    .spyOn(SecurityEventConnectionService, "getConnectorSettings")
    .mockResolvedValue(STORED_SETTINGS);
  jest
    .spyOn(SecurityEventConnectionService, "create")
    .mockResolvedValue(loaded);
  jest
    .spyOn(SecurityEventConnectionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityEventConnectionService, "updateOneBy")
    .mockResolvedValue(0 as never);
  jest
    .spyOn(SecurityEventConnectionServiceType, "validateSettings")
    .mockImplementation(
      async (data: {
        provider: unknown;
        config: JSONObject;
        secrets: JSONObject;
        alertingOnly: boolean;
        requireRequiredSecrets: boolean;
      }): Promise<SecurityConnectorSettings> => {
        if (data.provider !== SecurityEventConnectorProvider.OktaSystemLog) {
          throw new BadDataException(
            "Provider must be one of the supported security event connectors.",
          );
        }
        return {
          provider: SecurityEventConnectorProvider.OktaSystemLog,
          config: data.config,
          secrets: data.secrets,
          alertingOnly: data.alertingOnly,
        };
      },
    );
  (SecurityEventConnectionRunExecutor.enqueue as jest.Mock).mockResolvedValue(
    RUN,
  );
  (
    SecurityEventConnectionRunExecutor.validateOptions as jest.Mock
  ).mockImplementation((value: unknown) => {
    return { type: (value as JSONObject)["type"] };
  });
  (SecurityEventConnectionTester.test as jest.Mock).mockResolvedValue(REPORT);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("route registration", () => {
  test.each([
    "/security-event-connection/:connectionId/run",
    "/security-event-connection/test",
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

describe("POST /security-event-connection/:connectionId/run", () => {
  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
  ])(
    "allows %s, scopes the lookup to the tenant and reads no credentials in the API process",
    async (permission: Permission) => {
      setPermission(permission);
      await runHandler(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(SecurityEventConnectionService.findOneBy).toHaveBeenCalledWith({
        query: { _id: CONNECTION.toString(), projectId: PROJECT },
        select: { _id: true, projectId: true },
        props,
      });
      expect(SecurityEventConnectionService.findOneById).not.toHaveBeenCalled();
      expect(
        SecurityEventConnectionService.getConnectorSettings,
      ).not.toHaveBeenCalled();
      expect(SecurityEventConnectionRunExecutor.enqueue).toHaveBeenCalledWith({
        projectId: PROJECT,
        connectionId: CONNECTION,
        requestedByUserId: OTHER,
        options: { type: "test" },
      });
      expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(req, res, {
        runId: RUN.toString(),
      });
    },
  );

  test.each([
    Permission.SecurityMember,
    Permission.SecurityViewer,
    Permission.ProjectMember,
    Permission.Public,
  ])(
    "denies %s before resource or credential access and queueing",
    async (permission: Permission) => {
      setPermission(permission);
      await runHandler(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(SecurityEventConnectionService.findOneBy).not.toHaveBeenCalled();
      expect(SecurityEventConnectionRunExecutor.enqueue).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    },
  );

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
  ])("never treats blocked %s as a grant", async (permission: Permission) => {
    setPermission(permission, true);
    await runHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(SecurityEventConnectionRunExecutor.enqueue).not.toHaveBeenCalled();
  });

  test.each(["anonymous", "missing tenant", "not a member"])(
    "rejects %s before any resource access",
    async (reason: string) => {
      if (reason === "anonymous") {
        props.userId = undefined;
      }
      if (reason === "missing tenant") {
        props.tenantId = undefined;
      }
      if (reason === "not a member") {
        props.userTenantAccessPermission = {};
      }
      await runHandler(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(SecurityEventConnectionService.findOneBy).not.toHaveBeenCalled();
      expect(SecurityEventConnectionRunExecutor.enqueue).not.toHaveBeenCalled();
    },
  );

  test.each([null, OTHER])(
    "rejects a missing/foreign resource project %s even with a forged route ID",
    async (projectId: ObjectID | null) => {
      const connection: SecurityEventConnection = new SecurityEventConnection();
      if (projectId) {
        connection.projectId = projectId;
      }
      (SecurityEventConnectionService.findOneBy as jest.Mock).mockResolvedValue(
        projectId ? connection : null,
      );
      await runHandler(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(SecurityEventConnectionRunExecutor.enqueue).not.toHaveBeenCalled();
    },
  );

  test("does not accept permissions belonging to another tenant", async () => {
    props.userTenantAccessPermission![OTHER.toString()] = {
      ...props.userTenantAccessPermission![PROJECT.toString()]!,
      projectId: OTHER,
      permissions: [
        ...props.userTenantAccessPermission![PROJECT.toString()]!.permissions,
      ],
    };
    props.userTenantAccessPermission![PROJECT.toString()]!.permissions = [];
    await runHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(SecurityEventConnectionRunExecutor.enqueue).not.toHaveBeenCalled();
  });

  test.each(["", "not-a-uuid"])(
    "rejects malformed connection ID %j",
    async (id: string) => {
      req.params["connectionId"] = id;
      await runHandler(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(SecurityEventConnectionService.findOneBy).not.toHaveBeenCalled();
    },
  );

  test("delegates body validation to the executor and passes its normalized options on", async () => {
    req.body = { type: "backfill", startTime: "a", endTime: "b", extra: 1 };
    (
      SecurityEventConnectionRunExecutor.validateOptions as jest.Mock
    ).mockReturnValue({
      type: "backfill",
      startTime: "2026-09-09T00:00:00.000Z",
      endTime: "2026-09-10T00:00:00.000Z",
    });
    await runHandler(req, res, next);
    expect(
      SecurityEventConnectionRunExecutor.validateOptions,
    ).toHaveBeenCalledWith(req.body);
    expect(SecurityEventConnectionRunExecutor.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          type: "backfill",
          startTime: "2026-09-09T00:00:00.000Z",
          endTime: "2026-09-10T00:00:00.000Z",
        },
      }),
    );
  });

  test("a body the executor rejects is a 400 and nothing is queued", async () => {
    (
      SecurityEventConnectionRunExecutor.validateOptions as jest.Mock
    ).mockImplementation(() => {
      throw new BadDataException("Choose test, poll, preview, or backfill.");
    });
    await runHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Choose test, poll, preview, or backfill.",
      }),
    );
    expect(SecurityEventConnectionRunExecutor.enqueue).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("propagates admission failure instead of reporting a queued run", async () => {
    (SecurityEventConnectionRunExecutor.enqueue as jest.Mock).mockRejectedValue(
      new Error("Queue unavailable"),
    );
    await runHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Queue unavailable" }),
    );
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe("POST /security-event-connection/test - saved connection", () => {
  beforeEach(() => {
    req = {
      params: {},
      body: { connectionId: CONNECTION.toString() },
    } as unknown as ExpressRequest;
  });

  test("tests the stored settings of a tenant-scoped connection and returns the report", async () => {
    await testHandler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(SecurityEventConnectionService.findOneBy).toHaveBeenCalledWith({
      query: { _id: CONNECTION.toString(), projectId: PROJECT },
      select: { _id: true, projectId: true },
      props,
    });
    // Secrets are read as root, with the schedule columns the report needs.
    expect(SecurityEventConnectionService.findOneById).toHaveBeenCalledWith({
      id: CONNECTION,
      select: expect.objectContaining({
        provider: true,
        config: true,
        secrets: true,
        alertingOnly: true,
        isEnabled: true,
        pollIntervalInMinutes: true,
        createdAt: true,
        lastPolledAt: true,
        lastSuccessfulPollAt: true,
        lastEventIngestedAt: true,
        lastError: true,
      }),
      props: { isRoot: true },
    });
    expect(
      SecurityEventConnectionService.getConnectorSettings,
    ).toHaveBeenCalledWith(loaded);
    expect(
      SecurityEventConnectionServiceType.validateSettings,
    ).toHaveBeenCalledWith({
      provider: SecurityEventConnectorProvider.OktaSystemLog,
      config: STORED_SETTINGS.config,
      secrets: { apiToken: STORED_SECRET },
      alertingOnly: true,
      requireRequiredSecrets: true,
    });
    expect(SecurityEventConnectionTester.test).toHaveBeenCalledWith({
      settings: expect.objectContaining({
        secrets: { apiToken: STORED_SECRET },
      }),
      connection: loaded,
    });
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      req,
      res,
      REPORT,
    );
  });

  test("never creates or updates anything", async () => {
    await testHandler(req, res, next);
    expect(SecurityEventConnectionService.create).not.toHaveBeenCalled();
    expect(SecurityEventConnectionService.updateOneById).not.toHaveBeenCalled();
    expect(SecurityEventConnectionService.updateOneBy).not.toHaveBeenCalled();
    expect(SecurityEventConnectionRunExecutor.enqueue).not.toHaveBeenCalled();
  });

  test("overlays non-empty unsaved secrets on the stored ones and blank values keep the stored value", async () => {
    req.body = {
      connectionId: CONNECTION.toString(),
      config: { orgUrl: "https://acme.oktapreview.com" },
      secrets: { apiToken: "" },
      alertingOnly: false,
    };
    await testHandler(req, res, next);

    expect(
      SecurityEventConnectionServiceType.validateSettings,
    ).toHaveBeenCalledWith({
      provider: SecurityEventConnectorProvider.OktaSystemLog,
      config: { orgUrl: "https://acme.oktapreview.com" },
      secrets: { apiToken: STORED_SECRET },
      alertingOnly: false,
      requireRequiredSecrets: true,
    });

    req.body = {
      connectionId: CONNECTION.toString(),
      secrets: JSON.stringify({ apiToken: NEW_SECRET }),
    };
    await testHandler(req, res, next);

    expect(
      SecurityEventConnectionServiceType.validateSettings,
    ).toHaveBeenLastCalledWith({
      provider: SecurityEventConnectorProvider.OktaSystemLog,
      config: STORED_SETTINGS.config,
      secrets: { apiToken: NEW_SECRET },
      alertingOnly: true,
      requireRequiredSecrets: true,
    });
    expect(SecurityEventConnectionService.updateOneById).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  /*
   * null used to be listed here too. It now removes the stored key, the
   * same rule a save applies (review finding
   * optional-secret-cannot-be-cleared); see the tests below.
   */
  test.each(["", undefined])(
    "a %j secret value keeps the stored one too",
    async (value: unknown) => {
      req.body = {
        connectionId: CONNECTION.toString(),
        secrets: { apiToken: value },
      };
      await testHandler(req, res, next);
      const call: { secrets: JSONObject } = (
        SecurityEventConnectionServiceType.validateSettings as jest.Mock
      ).mock.calls[0]![0] as { secrets: JSONObject };
      expect(call.secrets).toEqual({ apiToken: STORED_SECRET });
    },
  );

  test("a null optional secret is removed from the overlay, so the test runs without the stale credential", async () => {
    const awsSettings: SecurityConnectorSettings = {
      provider: SecurityEventConnectorProvider.AwsSecurityHub,
      config: { region: "us-east-1", accessKeyId: "ASIA1" },
      secrets: { secretAccessKey: STORED_SECRET, sessionToken: "session-1" },
      alertingOnly: true,
    };
    loaded.provider = SecurityEventConnectorProvider.AwsSecurityHub;
    (
      SecurityEventConnectionService.getConnectorSettings as jest.Mock
    ).mockResolvedValue(awsSettings);
    (
      SecurityEventConnectionServiceType.validateSettings as jest.Mock
    ).mockImplementation(
      async (data: {
        provider: unknown;
        config: JSONObject;
        secrets: JSONObject;
        alertingOnly: boolean;
      }): Promise<SecurityConnectorSettings> => {
        return {
          provider: SecurityEventConnectorProvider.AwsSecurityHub,
          config: data.config,
          secrets: data.secrets,
          alertingOnly: data.alertingOnly,
        };
      },
    );
    req.body = {
      connectionId: CONNECTION.toString(),
      config: { region: "us-east-1", accessKeyId: "AKIA2" },
      secrets: { secretAccessKey: NEW_SECRET, sessionToken: null },
    };

    await testHandler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(
      SecurityEventConnectionServiceType.validateSettings,
    ).toHaveBeenCalledWith({
      provider: SecurityEventConnectorProvider.AwsSecurityHub,
      config: { region: "us-east-1", accessKeyId: "AKIA2" },
      secrets: { secretAccessKey: NEW_SECRET },
      alertingOnly: true,
      requireRequiredSecrets: true,
    });
    expect(SecurityEventConnectionTester.test).toHaveBeenCalledWith({
      settings: expect.objectContaining({
        secrets: { secretAccessKey: NEW_SECRET },
      }),
      connection: loaded,
    });
    expect(SecurityEventConnectionService.updateOneById).not.toHaveBeenCalled();
  });

  test("clearing a required secret in the overlay is a 400 naming the field, and nothing is tested", async () => {
    // The real validation, so the message is the one a save would return.
    (
      SecurityEventConnectionServiceType.validateSettings as jest.Mock
    ).mockRestore();
    req.body = {
      connectionId: CONNECTION.toString(),
      secrets: { apiToken: null },
    };

    await testHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "API token is required for Okta System Log.",
      }),
    );
    expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
  });

  test("a null for a key that is neither a credential nor stored is a 400, not a silent no-op", async () => {
    req.body = {
      connectionId: CONNECTION.toString(),
      secrets: { apiTokn: null },
    };

    await testHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Credentials contains an unknown setting "apiTokn" for Okta System Log.',
      }),
    );
    expect(
      SecurityEventConnectionServiceType.validateSettings,
    ).not.toHaveBeenCalled();
    expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
  });

  test.each([
    Permission.SecurityMember,
    Permission.SecurityViewer,
    Permission.ProjectMember,
  ])(
    "denies %s before the connection is read",
    async (permission: Permission) => {
      setPermission(permission);
      await testHandler(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(SecurityEventConnectionService.findOneBy).not.toHaveBeenCalled();
      expect(SecurityEventConnectionService.findOneById).not.toHaveBeenCalled();
      expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
    },
  );

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
  ])("allows %s", async (permission: Permission) => {
    setPermission(permission);
    await testHandler(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(SecurityEventConnectionTester.test).toHaveBeenCalledTimes(1);
  });

  test.each(["", "not-a-uuid", 42])(
    "rejects a malformed connection ID %j without reading anything",
    async (id: unknown) => {
      req.body = { connectionId: id };
      await testHandler(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(SecurityEventConnectionService.findOneBy).not.toHaveBeenCalled();
      expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
    },
  );

  test.each([null, OTHER])(
    "rejects a missing/foreign connection %s before secrets are read",
    async (projectId: ObjectID | null) => {
      const connection: SecurityEventConnection = new SecurityEventConnection();
      if (projectId) {
        connection.projectId = projectId;
      }
      (SecurityEventConnectionService.findOneBy as jest.Mock).mockResolvedValue(
        projectId ? connection : null,
      );
      await testHandler(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(SecurityEventConnectionService.findOneById).not.toHaveBeenCalled();
      expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
    },
  );

  test("a connection deleted between the scope check and the root read is refused", async () => {
    (SecurityEventConnectionService.findOneById as jest.Mock).mockResolvedValue(
      null,
    );
    await testHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: "The connection no longer exists." }),
    );
    expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
  });

  test("a validation failure of the overlaid settings is a 400 and the tester is not called", async () => {
    (
      SecurityEventConnectionServiceType.validateSettings as jest.Mock
    ).mockRejectedValue(
      new BadDataException("Okta organization URL is required."),
    );
    await testHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Okta organization URL is required.",
      }),
    );
    expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
  });

  test("unparseable overlays are a 400", async () => {
    req.body = { connectionId: CONNECTION.toString(), secrets: "not json" };
    await testHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Credentials must be a JSON object.",
      }),
    );
    expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
  });
});

describe("POST /security-event-connection/test - unsaved settings", () => {
  beforeEach(() => {
    req = {
      params: {},
      body: {
        provider: "okta",
        config: { orgUrl: "https://acme.okta.com" },
        secrets: { apiToken: NEW_SECRET },
      },
    } as unknown as ExpressRequest;
  });

  test("validates the settings with required secrets and tests them without a connection", async () => {
    await testHandler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(SecurityEventConnectionService.findOneBy).not.toHaveBeenCalled();
    expect(SecurityEventConnectionService.findOneById).not.toHaveBeenCalled();
    expect(
      SecurityEventConnectionService.getConnectorSettings,
    ).not.toHaveBeenCalled();
    expect(
      SecurityEventConnectionServiceType.validateSettings,
    ).toHaveBeenCalledWith({
      provider: "okta",
      config: { orgUrl: "https://acme.okta.com" },
      secrets: { apiToken: NEW_SECRET },
      alertingOnly: true,
      requireRequiredSecrets: true,
    });
    expect(SecurityEventConnectionTester.test).toHaveBeenCalledWith({
      settings: {
        provider: SecurityEventConnectorProvider.OktaSystemLog,
        config: { orgUrl: "https://acme.okta.com" },
        secrets: { apiToken: NEW_SECRET },
        alertingOnly: true,
      },
      connection: undefined,
    });
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      req,
      res,
      REPORT,
    );
  });

  test("never persists the unsaved settings", async () => {
    await testHandler(req, res, next);
    expect(SecurityEventConnectionService.create).not.toHaveBeenCalled();
    expect(SecurityEventConnectionService.updateOneById).not.toHaveBeenCalled();
    expect(SecurityEventConnectionService.updateOneBy).not.toHaveBeenCalled();
  });

  test("config and secrets may arrive as JSON strings; alertingOnly false is honoured", async () => {
    req.body = {
      provider: "okta",
      config: JSON.stringify({ orgUrl: "https://acme.okta.com" }),
      secrets: JSON.stringify({ apiToken: NEW_SECRET }),
      alertingOnly: false,
    };
    await testHandler(req, res, next);
    expect(
      SecurityEventConnectionServiceType.validateSettings,
    ).toHaveBeenCalledWith({
      provider: "okta",
      config: { orgUrl: "https://acme.okta.com" },
      secrets: { apiToken: NEW_SECRET },
      alertingOnly: false,
      requireRequiredSecrets: true,
    });
  });

  test.each([
    Permission.SecurityMember,
    Permission.SecurityViewer,
    Permission.ProjectMember,
  ])(
    "denies %s before anything is validated",
    async (permission: Permission) => {
      setPermission(permission);
      await testHandler(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(
        SecurityEventConnectionServiceType.validateSettings,
      ).not.toHaveBeenCalled();
      expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
    },
  );

  test.each([undefined, null, "text", [1]])(
    "a non-object body %j is validated as empty settings and fails there",
    async (body: unknown) => {
      req.body = body;
      await testHandler(req, res, next);
      expect(
        SecurityEventConnectionServiceType.validateSettings,
      ).toHaveBeenCalledWith({
        provider: undefined,
        config: {},
        secrets: {},
        alertingOnly: true,
        requireRequiredSecrets: true,
      });
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
    },
  );

  test("an unsupported provider is a 400", async () => {
    req.body = { provider: "not-a-provider", config: {}, secrets: {} };
    await testHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Provider must be one of the supported security event connectors.",
      }),
    );
    expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
  });

  test("a tester failure propagates instead of returning a partial report", async () => {
    (SecurityEventConnectionTester.test as jest.Mock).mockRejectedValue(
      new Error("Redis unavailable"),
    );
    await testHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Redis unavailable" }),
    );
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
