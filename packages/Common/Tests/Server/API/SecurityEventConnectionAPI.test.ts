import SecurityEventConnectionAPI from "../../../Server/API/SecurityEventConnectionAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionService, {
  Service as SecurityEventConnectionServiceType,
} from "../../../Server/Services/SecurityEventConnectionService";
import SecurityEventConnectionRunExecutor from "../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionRunExecutor";
import SecurityEventConnectionTester from "../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionTester";
import SecurityEventConnectorRegistry from "../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry";
import GoogleSecOpsClient, {
  FetchLike,
} from "../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsConnector, {
  GoogleSecOpsClientFactory,
} from "../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsConnector";
import { SecurityConnectorSettings } from "../../../Server/Utils/SecurityEvent/Connectors/Types";
import { PRIVATE_KEY } from "../Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsConnectorFixtures";
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
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";

/*
 * The two custom routes on the Security Event Connection API, which serve
 * every provider including Google SecOps (whose own API and suite were
 * retired): the permission gate is asserted in both directions, tenant
 * scoping cannot be forged through the route id, and the synchronous test
 * never persists anything but a run-history row for a saved connection
 * tested exactly as stored - not for a saved connection tested with
 * unsaved edits (whose stored secrets are overlaid, not replaced) and not
 * for unsaved settings.
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
    // Tested exactly as stored, so the test is recorded in run history.
    expect(SecurityEventConnectionTester.test).toHaveBeenCalledWith({
      settings: expect.objectContaining({
        secrets: { apiToken: STORED_SECRET },
      }),
      connection: loaded,
      recordRun: true,
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
    // Unsaved edits were tested, so nothing is recorded against the row.
    expect(SecurityEventConnectionTester.test).toHaveBeenCalledWith({
      settings: expect.objectContaining({
        secrets: { secretAccessKey: NEW_SECRET },
      }),
      connection: loaded,
      recordRun: false,
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
    // No connection, so there is no history to record the test in.
    expect(SecurityEventConnectionTester.test).toHaveBeenCalledWith({
      settings: {
        provider: SecurityEventConnectorProvider.OktaSystemLog,
        config: { orgUrl: "https://acme.okta.com" },
        secrets: { apiToken: NEW_SECRET },
        alertingOnly: true,
      },
      connection: undefined,
      recordRun: false,
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

  test("a non-boolean alertingOnly is refused like a save refuses it, before anything is validated", async () => {
    req.body = { ...(req.body as JSONObject), alertingOnly: "false" };
    await testHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Alerting records only must be true or false.",
      }),
    );
    expect(
      SecurityEventConnectionServiceType.validateSettings,
    ).not.toHaveBeenCalled();
    expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
  });
});

/*
 * Google SecOps moved into this API from /google-secops-connection (now
 * removed); these cases are ported from that API's suite. The routes are
 * provider-agnostic, so what is pinned for google-secops is what that API
 * guaranteed: the edit form's unsaved settings are tested with the stored
 * key, which can never be read back into the form; a test of anything other
 * than the saved settings writes no run-history row; unsaved settings are
 * validated with the save-time rules of the real Google SecOps connector
 * and never persisted; and the permission gate and tenant scoping hold.
 */
describe("Google SecOps connections", () => {
  /*
   * Real service-account keys: the connector parses private_key as a PEM
   * at save time, so a placeholder body would be a request the route
   * refuses with a 400 before the tester is reached. Stored and pasted
   * share the generated key and differ by client_email, which is all the
   * run-history rules compare.
   */
  const GOOGLE_STORED_KEY: string = JSON.stringify(
    {
      type: "service_account",
      client_email: "stored@acme-secops.iam.gserviceaccount.com",
      private_key: PRIVATE_KEY,
    },
    null,
    2,
  );
  const GOOGLE_PASTED_KEY: string = JSON.stringify({
    type: "service_account",
    client_email: "pasted@acme-secops.iam.gserviceaccount.com",
    private_key: PRIVATE_KEY,
  });
  // Well-formed JSON around a key body no PEM decoder reads.
  const GOOGLE_UNREADABLE_KEY: string = JSON.stringify({
    type: "service_account",
    client_email: "stored@acme-secops.iam.gserviceaccount.com",
    private_key:
      "-----BEGIN PRIVATE KEY-----\nstored\n-----END PRIVATE KEY-----\n",
  });
  const UNREADABLE_KEY_MESSAGE: string =
    "Service account JSON private_key is not a readable PEM private key. Check that newlines are real newlines and the key is not encrypted.";
  /*
   * An AWS connection for the provider-agnostic secret rules. The access key
   * id is a well-formed long-lived (AKIA) id, so the save-time rules would
   * accept these settings and a blank session token needs no pairing.
   */
  const AWS_STORED: SecurityConnectorSettings = {
    provider: SecurityEventConnectorProvider.AwsSecurityHub,
    config: { region: "us-east-1", accessKeyId: "AKIAIOSFODNN7EXAMPLE" },
    secrets: { secretAccessKey: STORED_SECRET },
    alertingOnly: true,
  };
  const GOOGLE_CONFIG: JSONObject = {
    region: "us",
    instanceResourceName: "projects/acme-secops/locations/us/instances/old",
  };
  const GOOGLE_STORED: SecurityConnectorSettings = {
    provider: SecurityEventConnectorProvider.GoogleSecOps,
    config: GOOGLE_CONFIG,
    secrets: { serviceAccountJson: GOOGLE_STORED_KEY },
    alertingOnly: true,
  };
  const GOOGLE_REPORT: SecurityConnectorTestReport = {
    provider: SecurityEventConnectorProvider.GoogleSecOps,
    status: "pass",
    startedAt: "2026-09-14T12:00:00.000Z",
    completedAt: "2026-09-14T12:00:02.000Z",
    durationMs: 2000,
    checks: [],
    summary: "ok",
  };
  const GOOGLE_DEFINITION: SecurityEventConnectorDefinition =
    getSecurityEventConnectorDefinition(
      SecurityEventConnectorProvider.GoogleSecOps,
    )!;
  const GOOGLE_REGIONS: string = (
    GOOGLE_DEFINITION.configFields[0]!.options || []
  )
    .map((option: { value: string }): string => {
      return option.value;
    })
    .join(", ");

  type TesterCall = {
    settings: SecurityConnectorSettings;
    connection: SecurityEventConnection | undefined;
    recordRun: boolean;
  };

  function testedCall(): TesterCall {
    expect(SecurityEventConnectionTester.test).toHaveBeenCalledTimes(1);
    return (SecurityEventConnectionTester.test as jest.Mock).mock
      .calls[0]![0] as TesterCall;
  }

  /*
   * Every attempt to reach Google while the API validates. Validation builds
   * no client, so this stays empty; a route that started contacting the
   * provider before the tester would record here and fail instead of
   * silently making network calls from the API process.
   */
  let networkAttempts: Array<string> = [];

  /*
   * The save-time rules end to end: the service's validation, dispatching
   * through the (mocked) registry to the real GoogleSecOpsConnector, so the
   * region/location match and the key's PEM parsing apply exactly as they do
   * on a save. Its fetch and client factory refuse to run.
   */
  function useRealValidation(): void {
    (
      SecurityEventConnectionServiceType.validateSettings as jest.Mock
    ).mockRestore();
    networkAttempts = [];
    const refuseFetch: FetchLike = (url: string): Promise<never> => {
      networkAttempts.push(`fetch ${url}`);
      throw new Error("The connection test API must not call Google.");
    };
    const refuseClient: GoogleSecOpsClientFactory = (data: {
      instanceResourceName: string;
    }): GoogleSecOpsClient => {
      networkAttempts.push(`client ${data.instanceResourceName}`);
      throw new Error("The connection test API must not build a client.");
    };
    (SecurityEventConnectorRegistry.getConnector as jest.Mock).mockReturnValue(
      new GoogleSecOpsConnector(refuseFetch, refuseClient),
    );
  }

  beforeEach(() => {
    req = {
      params: { connectionId: CONNECTION.toString() },
      body: { connectionId: CONNECTION.toString() },
    } as unknown as ExpressRequest;
    loaded.provider = SecurityEventConnectorProvider.GoogleSecOps;
    loaded.config = { ...GOOGLE_CONFIG };
    loaded.secrets = JSON.stringify(GOOGLE_STORED.secrets);
    loaded.alertingOnly = true;
    (
      SecurityEventConnectionService.getConnectorSettings as jest.Mock
    ).mockResolvedValue(GOOGLE_STORED);
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
          provider: data.provider as SecurityEventConnectorProvider,
          config: data.config,
          secrets: data.secrets,
          alertingOnly: data.alertingOnly,
        };
      },
    );
    (SecurityEventConnectionTester.test as jest.Mock).mockResolvedValue(
      GOOGLE_REPORT,
    );
  });

  describe("permission gate and tenant scoping", () => {
    test.each([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
    ])(
      "allows %s to test a saved connection, reading its key only as root, and records the run",
      async (permission: Permission) => {
        setPermission(permission);

        await testHandler(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(SecurityEventConnectionService.findOneBy).toHaveBeenCalledWith({
          query: { _id: CONNECTION.toString(), projectId: PROJECT },
          select: { _id: true, projectId: true },
          props,
        });
        expect(SecurityEventConnectionService.findOneById).toHaveBeenCalledWith(
          expect.objectContaining({
            id: CONNECTION,
            select: expect.objectContaining({
              secrets: true,
              lastPolledAt: true,
            }),
            props: { isRoot: true },
          }),
        );
        expect(SecurityEventConnectionTester.test).toHaveBeenCalledWith({
          settings: GOOGLE_STORED,
          connection: loaded,
          recordRun: true,
        });
        expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
          req,
          res,
          GOOGLE_REPORT,
        );
        expect(SecurityEventConnectionService.create).not.toHaveBeenCalled();
        expect(
          SecurityEventConnectionService.updateOneById,
        ).not.toHaveBeenCalled();
        expect(
          SecurityEventConnectionRunExecutor.enqueue,
        ).not.toHaveBeenCalled();
      },
    );

    test.each([
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ProjectMember,
      Permission.Public,
    ])(
      "denies %s before the connection or its key is read",
      async (permission: Permission) => {
        setPermission(permission);

        await testHandler(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.any(Error));
        expect(SecurityEventConnectionService.findOneBy).not.toHaveBeenCalled();
        expect(
          SecurityEventConnectionService.findOneById,
        ).not.toHaveBeenCalled();
        expect(
          SecurityEventConnectionService.getConnectorSettings,
        ).not.toHaveBeenCalled();
        expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
      },
    );

    test("never treats a blocked grant as a grant", async () => {
      setPermission(Permission.SecurityAdmin, true);

      await testHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
    });

    test("does not accept a grant that belongs to another tenant", async () => {
      props.userTenantAccessPermission![OTHER.toString()] = {
        ...props.userTenantAccessPermission![PROJECT.toString()]!,
        projectId: OTHER,
      };
      props.userTenantAccessPermission![PROJECT.toString()]!.permissions = [];

      await testHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
    });

    test.each([null, OTHER])(
      "rejects a connection that is missing or belongs to project %s before its key is read",
      async (projectId: ObjectID | null) => {
        const connection: SecurityEventConnection =
          new SecurityEventConnection();
        if (projectId) {
          connection.projectId = projectId;
        }
        (
          SecurityEventConnectionService.findOneBy as jest.Mock
        ).mockResolvedValue(projectId ? connection : null);

        await testHandler(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.any(Error));
        expect(
          SecurityEventConnectionService.findOneById,
        ).not.toHaveBeenCalled();
        expect(
          SecurityEventConnectionService.getConnectorSettings,
        ).not.toHaveBeenCalled();
        expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
      },
    );

    test("a queued operation on a Google SecOps connection goes through the shared executor, tenant-scoped", async () => {
      req.body = { type: "poll" };

      await runHandler(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(SecurityEventConnectionRunExecutor.enqueue).toHaveBeenCalledWith({
        projectId: PROJECT,
        connectionId: CONNECTION,
        requestedByUserId: OTHER,
        options: { type: "poll" },
      });
      expect(
        SecurityEventConnectionService.getConnectorSettings,
      ).not.toHaveBeenCalled();
    });

    test("a queued operation is denied to a security viewer", async () => {
      setPermission(Permission.SecurityViewer);
      req.body = { type: "poll" };

      await runHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(SecurityEventConnectionRunExecutor.enqueue).not.toHaveBeenCalled();
    });
  });

  /*
   * Review finding edit-form-test-ignores-edited-settings, carried over. The
   * edit form cannot read the stored key back, so "Test" sends the
   * connection id plus what is on screen. A test that used anything other
   * than the saved settings must not be recorded against the connection.
   */
  describe("the edit form's unsaved settings and the run-history row", () => {
    test("tests the edited settings with the stored key and records no run row", async () => {
      const edited: JSONObject = {
        region: "europe",
        instanceResourceName: "projects/acme-secops/locations/eu/instances/new",
      };
      req.body = {
        connectionId: CONNECTION.toString(),
        config: edited,
        // An untouched key editor: the stored key is used.
        secrets: { serviceAccountJson: "" },
        alertingOnly: false,
      };

      await testHandler(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(
        SecurityEventConnectionServiceType.validateSettings,
      ).toHaveBeenCalledWith({
        provider: SecurityEventConnectorProvider.GoogleSecOps,
        config: edited,
        secrets: { serviceAccountJson: GOOGLE_STORED_KEY },
        alertingOnly: false,
        requireRequiredSecrets: true,
      });
      const call: TesterCall = testedCall();
      expect(call.connection).toBe(loaded);
      expect(call.settings.config).toEqual(edited);
      expect(call.settings.secrets["serviceAccountJson"]).toBe(
        GOOGLE_STORED_KEY,
      );
      expect(call.settings.alertingOnly).toBe(false);
      expect(call.recordRun).toBe(false);
      expect(SecurityEventConnectionService.create).not.toHaveBeenCalled();
      expect(
        SecurityEventConnectionService.updateOneById,
      ).not.toHaveBeenCalled();
      expect(SecurityEventConnectionService.updateOneBy).not.toHaveBeenCalled();
    });

    /*
     * Validation is a pass-through here so each row isolates the run-history
     * rule, but every row is still a request the real save-time rules
     * accept: a row the route would refuse with a 400 never reaches that
     * rule, so asserting its recordRun would describe a response production
     * cannot give. Refused requests (a required key of whitespace or null, a
     * region that does not match the instance) are pinned in the describe
     * that runs the real rules.
     */
    test.each<[string, JSONObject, boolean]>([
      ["nothing but the connection id", {}, true],
      ["the stored config sent back as it is", { config: GOOGLE_CONFIG }, true],
      [
        /*
         * Only the text field is padded: a dropdown value is matched against
         * its options exactly, so " us " is refused at save time.
         */
        "the stored config with padding the connector trims",
        {
          config: {
            region: "us",
            instanceResourceName:
              " projects/acme-secops/locations/us/instances/old\n",
          },
        },
        true,
      ],
      [
        "the stored config as a JSON string",
        { config: JSON.stringify(GOOGLE_CONFIG) },
        true,
      ],
      [
        "a blank key (an untouched key editor)",
        { secrets: { serviceAccountJson: "" } },
        true,
      ],
      [
        "an undefined key",
        { secrets: { serviceAccountJson: undefined as never } },
        true,
      ],
      ["an empty secrets object", { secrets: {} }, true],
      [
        "secrets as a JSON string holding a blank key",
        { secrets: JSON.stringify({ serviceAccountJson: "" }) },
        true,
      ],
      ["the stored Data to import", { alertingOnly: true }, true],
      [
        "a null Data to import, which keeps the stored one",
        { alertingOnly: null },
        true,
      ],
      [
        "every value equal to the stored one at once",
        {
          config: GOOGLE_CONFIG,
          secrets: { serviceAccountJson: "" },
          alertingOnly: true,
        },
        true,
      ],
      [
        "a changed region, with the instance in that region",
        {
          config: {
            region: "europe",
            instanceResourceName:
              "projects/acme-secops/locations/eu/instances/old",
          },
        },
        false,
      ],
      [
        "a changed instance resource name",
        {
          config: {
            ...GOOGLE_CONFIG,
            instanceResourceName:
              "projects/acme-secops/locations/us/instances/new",
          },
        },
        false,
      ],
      [
        "a pasted key",
        { secrets: { serviceAccountJson: GOOGLE_PASTED_KEY } },
        false,
      ],
      [
        "a pasted key identical to the stored one (no oracle for the stored key)",
        { secrets: { serviceAccountJson: GOOGLE_STORED_KEY } },
        false,
      ],
      [
        "Alerts and Detections instead of the stored Alerts only",
        { alertingOnly: false },
        false,
      ],
      [
        "one changed value among equal ones",
        {
          config: GOOGLE_CONFIG,
          secrets: { serviceAccountJson: "" },
          alertingOnly: false,
        },
        false,
      ],
    ])(
      "%s: recordRun is %s",
      async (_label: string, edit: JSONObject, recordRun: boolean) => {
        req.body = { connectionId: CONNECTION.toString(), ...edit };

        await testHandler(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(testedCall().recordRun).toBe(recordRun);
        expect(testedCall().connection).toBe(loaded);
        expect(SecurityEventConnectionService.create).not.toHaveBeenCalled();
        expect(
          SecurityEventConnectionService.updateOneById,
        ).not.toHaveBeenCalled();
      },
    );

    test("with Detections saved, sending false tests what is saved and sending true does not", async () => {
      (
        SecurityEventConnectionService.getConnectorSettings as jest.Mock
      ).mockResolvedValue({ ...GOOGLE_STORED, alertingOnly: false });

      req.body = { connectionId: CONNECTION.toString(), alertingOnly: false };
      await testHandler(req, res, next);
      req.body = { connectionId: CONNECTION.toString(), alertingOnly: true };
      await testHandler(req, res, next);
      req.body = { connectionId: CONNECTION.toString() };
      await testHandler(req, res, next);

      const calls: Array<TesterCall> = (
        SecurityEventConnectionTester.test as jest.Mock
      ).mock.calls.map((call: Array<unknown>): TesterCall => {
        return call[0] as TesterCall;
      });
      expect(
        calls.map((call: TesterCall): [boolean, boolean] => {
          return [call.settings.alertingOnly, call.recordRun];
        }),
      ).toEqual([
        [false, true],
        [true, false],
        [false, true],
      ]);
      expect(next).not.toHaveBeenCalled();
    });

    test("a null for an optional credential that is not stored still counts as an edit, so nothing reveals what is stored", async () => {
      loaded.provider = SecurityEventConnectorProvider.AwsSecurityHub;
      (
        SecurityEventConnectionService.getConnectorSettings as jest.Mock
      ).mockResolvedValue(AWS_STORED);
      req.body = {
        connectionId: CONNECTION.toString(),
        secrets: { sessionToken: null },
      };

      await testHandler(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(testedCall().settings.secrets).toEqual({
        secretAccessKey: STORED_SECRET,
      });
      expect(testedCall().recordRun).toBe(false);
    });

    /*
     * A whitespace-only value is not "", so mergeSecrets puts it over the
     * stored value as a save would, and any provided secret counts as an
     * edit. Only an optional credential can show this: the save-time rules
     * read whitespace as empty, which an optional field allows and a
     * required one refuses (the Google SecOps key of whitespace is a 400 in
     * the describe that runs the real rules).
     */
    test("a whitespace-only optional credential is provided, so it overlays the stored settings and records no run row", async () => {
      loaded.provider = SecurityEventConnectorProvider.AwsSecurityHub;
      (
        SecurityEventConnectionService.getConnectorSettings as jest.Mock
      ).mockResolvedValue(AWS_STORED);
      req.body = {
        connectionId: CONNECTION.toString(),
        secrets: { sessionToken: "   " },
      };

      await testHandler(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(testedCall().settings.secrets).toEqual({
        secretAccessKey: STORED_SECRET,
        sessionToken: "   ",
      });
      expect(testedCall().recordRun).toBe(false);
    });

    test.each<[string, JSONObject, boolean]>([
      [
        "an optional field sent empty where the stored row has it empty too",
        { orgUrl: "https://acme.okta.com", filter: "" },
        true,
      ],
      [
        "an optional field left out where the stored row has it empty",
        { orgUrl: "https://acme.okta.com" },
        true,
      ],
      [
        "an optional field filled in where the stored row has it empty",
        { orgUrl: "https://acme.okta.com", filter: 'eventType sw "user"' },
        false,
      ],
    ])(
      "config normalization is shared by every provider: %s",
      async (_label: string, config: JSONObject, recordRun: boolean) => {
        loaded.provider = SecurityEventConnectorProvider.OktaSystemLog;
        (
          SecurityEventConnectionService.getConnectorSettings as jest.Mock
        ).mockResolvedValue(STORED_SETTINGS);
        req.body = { connectionId: CONNECTION.toString(), config };

        await testHandler(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(testedCall().recordRun).toBe(recordRun);
      },
    );
  });

  describe("the edit form's unsaved settings are validated with the save-time rules", () => {
    beforeEach(() => {
      useRealValidation();
    });

    test("valid edits pass the real rules and reach the tester with the stored key", async () => {
      req.body = {
        connectionId: CONNECTION.toString(),
        config: {
          region: "europe",
          instanceResourceName:
            "projects/acme-secops/locations/eu/instances/new",
        },
      };

      await testHandler(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(testedCall().settings).toEqual({
        provider: SecurityEventConnectorProvider.GoogleSecOps,
        config: {
          region: "europe",
          instanceResourceName:
            "projects/acme-secops/locations/eu/instances/new",
        },
        secrets: { serviceAccountJson: GOOGLE_STORED_KEY },
        alertingOnly: true,
      });
      expect(testedCall().recordRun).toBe(false);
      expect(networkAttempts).toEqual([]);
    });

    test.each<[JSONObject, string]>([
      [
        { config: { ...GOOGLE_CONFIG, region: "us-central1" } },
        `Region must be one of: ${GOOGLE_REGIONS}.`,
      ],
      [
        { config: { ...GOOGLE_CONFIG, region: "" } },
        "Region is required for Google SecOps.",
      ],
      [
        { config: { ...GOOGLE_CONFIG, instanceResourceName: "nope" } },
        "Instance resource name must look like projects/{project}/locations/{location}/instances/{instance}.",
      ],
      /*
       * Both values pass the catalog on their own; only the connector knows
       * the regional endpoint must serve the instance's location.
       */
      [
        {
          config: {
            region: "europe",
            instanceResourceName:
              "projects/acme-secops/locations/us/instances/old",
          },
        },
        "Region must match the locations segment of the instance resource name.",
      ],
      /*
       * The old route read a null region as "keep the stored one". Here the
       * whole config is one value, and null is an empty config.
       */
      [{ config: null }, "Region is required for Google SecOps."],
      [
        { secrets: { serviceAccountJson: "not json" } },
        "Service account JSON must be a JSON object.",
      ],
      [
        { secrets: { serviceAccountJson: { client_email: "x" } } },
        "Service account JSON must be sent as JSON text (a string), not as a parsed object.",
      ],
      [
        { secrets: { serviceAccountJson: null } },
        "Service account JSON is required for Google SecOps.",
      ],
      /*
       * Not "", so it replaces the stored key rather than keeping it, and a
       * required field of whitespace is empty.
       */
      [
        { secrets: { serviceAccountJson: "   " } },
        "Service account JSON is required for Google SecOps.",
      ],
      [
        { secrets: { privateKey: "x" } },
        'Credentials contains an unknown setting "privateKey" for Google SecOps.',
      ],
    ])(
      "rejects the edit %j with the save-time rule and tests nothing",
      async (edit: JSONObject, message: string) => {
        req.body = { connectionId: CONNECTION.toString(), ...edit };

        await testHandler(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message }));
        expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
        expect(networkAttempts).toEqual([]);
      },
    );

    /*
     * The stored key is validated too, not only what the form sends: a key
     * that can no longer sign a token is refused here with the field named,
     * instead of reaching the tester and failing as an authentication check.
     */
    test("a stored key whose private_key is not a readable PEM is refused even with nothing edited", async () => {
      (
        SecurityEventConnectionService.getConnectorSettings as jest.Mock
      ).mockResolvedValue({
        ...GOOGLE_STORED,
        secrets: { serviceAccountJson: GOOGLE_UNREADABLE_KEY },
      });
      req.body = { connectionId: CONNECTION.toString() };

      await testHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: UNREADABLE_KEY_MESSAGE }),
      );
      expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
      expect(networkAttempts).toEqual([]);
    });

    test.each(["yes", 1, "true", {}])(
      "a Data to import of %j is refused before the connection is read",
      async (value: unknown) => {
        req.body = {
          connectionId: CONNECTION.toString(),
          alertingOnly: value as never,
        };

        await testHandler(req, res, next);

        expect(next).toHaveBeenCalledWith(
          expect.objectContaining({
            message: "Alerting records only must be true or false.",
          }),
        );
        expect(SecurityEventConnectionService.findOneBy).not.toHaveBeenCalled();
        expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
      },
    );
  });

  describe("unsaved settings from the create form", () => {
    const UNSAVED_CONFIG: JSONObject = {
      region: "us",
      instanceResourceName: "projects/acme-secops/locations/us/instances/i",
    };

    beforeEach(() => {
      useRealValidation();
      req = {
        params: {},
        body: {
          provider: SecurityEventConnectorProvider.GoogleSecOps,
          config: UNSAVED_CONFIG,
          secrets: { serviceAccountJson: GOOGLE_PASTED_KEY },
          alertingOnly: false,
        },
      } as unknown as ExpressRequest;
    });

    test("tests them with the real save-time rules, without a connection, a run row or any write", async () => {
      await testHandler(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(SecurityEventConnectionTester.test).toHaveBeenCalledWith({
        settings: {
          provider: SecurityEventConnectorProvider.GoogleSecOps,
          config: UNSAVED_CONFIG,
          secrets: { serviceAccountJson: GOOGLE_PASTED_KEY },
          alertingOnly: false,
        },
        connection: undefined,
        recordRun: false,
      });
      expect(typeof testedCall().settings.secrets["serviceAccountJson"]).toBe(
        "string",
      );
      expect(SecurityEventConnectionService.findOneBy).not.toHaveBeenCalled();
      expect(SecurityEventConnectionService.findOneById).not.toHaveBeenCalled();
      expect(
        SecurityEventConnectionService.getConnectorSettings,
      ).not.toHaveBeenCalled();
      expect(SecurityEventConnectionService.create).not.toHaveBeenCalled();
      expect(
        SecurityEventConnectionService.updateOneById,
      ).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
        req,
        res,
        GOOGLE_REPORT,
      );
      expect(networkAttempts).toEqual([]);
    });

    test("Data to import defaults to Alerts only when the form leaves it out", async () => {
      delete (req.body as JSONObject)["alertingOnly"];

      await testHandler(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(testedCall().settings.alertingOnly).toBe(true);
    });

    test.each<[JSONObject, string]>([
      [
        { config: { region: "us" } },
        "Instance resource name is required for Google SecOps.",
      ],
      [
        {
          config: {
            instanceResourceName: UNSAVED_CONFIG["instanceResourceName"]!,
          },
        },
        "Region is required for Google SecOps.",
      ],
      [
        { config: { ...UNSAVED_CONFIG, region: "us-central1" } },
        `Region must be one of: ${GOOGLE_REGIONS}.`,
      ],
      [
        { config: { ...UNSAVED_CONFIG, instanceResourceName: "nope" } },
        "Instance resource name must look like projects/{project}/locations/{location}/instances/{instance}.",
      ],
      [{ secrets: {} }, "Service account JSON is required for Google SecOps."],
      [
        { secrets: { serviceAccountJson: "  \n " } },
        "Service account JSON is required for Google SecOps.",
      ],
      [
        { secrets: { serviceAccountJson: GOOGLE_UNREADABLE_KEY } },
        UNREADABLE_KEY_MESSAGE,
      ],
      [
        { secrets: { serviceAccountJson: "not json" } },
        "Service account JSON must be a JSON object.",
      ],
      [
        { secrets: { serviceAccountJson: JSON.parse(GOOGLE_PASTED_KEY) } },
        "Service account JSON must be sent as JSON text (a string), not as a parsed object.",
      ],
      [{ alertingOnly: "yes" }, "Alerting records only must be true or false."],
      [
        { provider: "google-secops-connection" },
        "Provider must be one of the supported security event connectors.",
      ],
    ])(
      "rejects the unsaved settings %j with the save-time rule and tests nothing",
      async (edit: JSONObject, message: string) => {
        req.body = { ...(req.body as JSONObject), ...edit };

        await testHandler(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message }));
        expect(SecurityEventConnectionTester.test).not.toHaveBeenCalled();
        expect(SecurityEventConnectionService.create).not.toHaveBeenCalled();
        expect(networkAttempts).toEqual([]);
      },
    );
  });
});
