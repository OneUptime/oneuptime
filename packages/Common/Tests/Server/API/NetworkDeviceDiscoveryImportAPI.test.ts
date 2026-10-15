import { mockRouter } from "./Helpers";
import { assertCanSeeImports } from "../../../Server/API/NetworkDeviceDiscoveryImportAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import NetworkDeviceDiscoveryImportService from "../../../Server/Services/NetworkDeviceDiscoveryImportService";
import DiscoveryImportRunner, {
  DISCOVERY_IMPORT_VIEW_SELECT,
} from "../../../Server/Utils/NetworkDiscovery/DiscoveryImportRunner";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import NetworkDeviceDiscoveryImport from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryImport";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import {
  DiscoveryImportAlerting,
  DiscoveryImportDeviceOutcome,
  DiscoveryImportMonitorOutcome,
  DiscoveryImportStatus,
} from "../../../Types/NetworkDevice/DiscoveryImport";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

/*
 * The discovery import's HTTP face (issues #4811-#4815). Its imports are
 * internal rows read as root, so these handlers are the gate: a person
 * signed in to the project (never anonymous, never a project API key - an
 * import acts as a person), who may see the project's discovery scans; the
 * rest - creating devices and monitors - is the runner's to check, with the
 * person's own permissions, and is covered by its own suite.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn(),
  };
});

jest.mock(
  "../../../Server/Services/NetworkDeviceDiscoveryImportService",
  () => {
    return {
      __esModule: true,
      default: { findBy: jest.fn(), findOneBy: jest.fn() },
    };
  },
);

jest.mock(
  "../../../Server/Utils/NetworkDiscovery/DiscoveryImportRunner",
  () => {
    const actual: {
      default: { toView: unknown };
      DISCOVERY_IMPORT_VIEW_SELECT: unknown;
    } = jest.requireActual(
      "../../../Server/Utils/NetworkDiscovery/DiscoveryImportRunner",
    );

    return {
      __esModule: true,
      DISCOVERY_IMPORT_VIEW_SELECT: actual.DISCOVERY_IMPORT_VIEW_SELECT,
      default: {
        start: jest.fn(),
        stop: jest.fn(),
        retry: jest.fn(),
        findImport: jest.fn(),
        // What the Dashboard is told is the real view, whatever the row.
        toView: actual.default.toView,
        isWorthListing: (
          actual.default as unknown as { isWorthListing: unknown }
        ).isWorthListing,
      },
    };
  },
);

jest.mock("../../../Server/Utils/Billing/CallerPlan", () => {
  const actual: { default: Record<string, unknown> } = jest.requireActual(
    "../../../Server/Utils/Billing/CallerPlan",
  );
  const CallerPlanWithTestProps: Record<string, unknown> = Object.create(
    actual.default,
  );
  CallerPlanWithTestProps["withPlan"] = jest.fn(async (props: unknown) => {
    return props;
  });

  return { __esModule: true, default: CallerPlanWithTestProps };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000000011",
);
const ME: ObjectID = new ObjectID("bb000000-0000-4000-8000-000000000011");
const SCAN_ID: ObjectID = new ObjectID("cc000000-0000-4000-8000-000000000011");
const IMPORT_ID: ObjectID = new ObjectID(
  "dd000000-0000-4000-8000-000000000011",
);

function propsWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const rows: Array<UserPermission> = permissions.map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    },
  );

  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows,
  };

  return {
    tenantId: PROJECT_ID,
    userId: ME,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: tenant },
    ...ON_HIGHEST_PLAN,
  };
}

let callerProps: DatabaseCommonInteractionProps;

interface RegisteredRoute {
  method: string;
  uri: string;
  middleware: unknown;
  handlerFunction: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => void | Promise<void>;
}

function route(method: string, uri: string): RegisteredRoute {
  const found: RegisteredRoute | undefined = (
    mockRouter.routes as unknown as Array<RegisteredRoute>
  ).find((candidate: RegisteredRoute): boolean => {
    return candidate.method === method && candidate.uri === uri;
  });

  if (!found) {
    throw new Error(`No ${method} ${uri}`);
  }

  return found;
}

async function call(
  method: string,
  uri: string,
  data: {
    params?: Dictionary<string>;
    body?: JSONObject;
    query?: Dictionary<string>;
  } = {},
): Promise<{ thrown: unknown; payload: Record<string, unknown> | undefined }> {
  const next: jest.Mock = jest.fn();
  const sender: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  sender.mockClear();

  await route(method, uri).handlerFunction(
    {
      params: data.params || {},
      query: data.query || {},
      body: data.body || {},
      headers: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  const last: Array<unknown> | undefined =
    sender.mock.calls[sender.mock.calls.length - 1];

  return {
    thrown: next.mock.calls[0]?.[0],
    payload: last ? (last[2] as Record<string, unknown>) : undefined,
  };
}

function importRow(
  overrides: Partial<NetworkDeviceDiscoveryImport> = {},
): NetworkDeviceDiscoveryImport {
  const row: NetworkDeviceDiscoveryImport = new NetworkDeviceDiscoveryImport();
  row.id = IMPORT_ID;
  row.projectId = PROJECT_ID;
  row.networkDeviceDiscoveryScanId = SCAN_ID;
  row.status = DiscoveryImportStatus.Running;
  row.settings = {
    pollingIntervalInMinutes: 5,
    applyVendorTemplates: true,
    alerting: DiscoveryImportAlerting.None,
  };
  row.results = [
    {
      ipAddress: "10.0.0.1",
      name: "core-sw-01",
      isPingOnly: false,
      device: DiscoveryImportDeviceOutcome.Created,
      monitor: DiscoveryImportMonitorOutcome.NotRequested,
    },
    {
      ipAddress: "10.0.0.2",
      name: "10.0.0.2",
      isPingOnly: true,
      device: DiscoveryImportDeviceOutcome.Failed,
      deviceError: "Refused.",
      monitor: DiscoveryImportMonitorOutcome.NotRequested,
    },
  ];
  row.createdByUserId = ME;
  row.createdAt = new Date("2026-10-15T09:00:00Z");
  Object.assign(row, overrides);
  return row;
}

const SCAN_READER: Array<Permission> = [
  Permission.ReadNetworkDeviceDiscoveryScan,
];

const ROUTES: Array<[string, string]> = [
  ["POST", "/network-device-discovery-import/start"],
  ["GET", "/network-device-discovery-import/import/:importId"],
  ["GET", "/network-device-discovery-import/scan/:scanId/latest"],
  ["GET", "/network-device-discovery-import/active"],
  ["POST", "/network-device-discovery-import/import/:importId/stop"],
  ["POST", "/network-device-discovery-import/import/:importId/retry"],
];

const IDS: Dictionary<string> = {
  importId: IMPORT_ID.toString(),
  scanId: SCAN_ID.toString(),
};

beforeEach(() => {
  callerProps = propsWith([Permission.ProjectOwner]);
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return callerProps;
    });
  (DiscoveryImportRunner.findImport as jest.Mock).mockResolvedValue(
    importRow(),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("who may call the discovery import API", () => {
  test("every route reads the session through the user middleware", () => {
    for (const [method, uri] of ROUTES) {
      expect(route(method, uri).middleware).toBe(
        UserMiddleware.getUserMiddleware,
      );
    }
  });

  test.each(ROUTES)(
    "%s %s answers a caller with no session with 401",
    async (method: string, uri: string) => {
      callerProps = { userType: UserType.Public };

      const { thrown } = await call(method, uri, { params: IDS });

      expect(thrown).toBeInstanceOf(NotAuthenticatedException);
      expect(DiscoveryImportRunner.start).not.toHaveBeenCalled();
      expect(NetworkDeviceDiscoveryImportService.findBy).not.toHaveBeenCalled();
    },
  );

  test.each(ROUTES)(
    "%s %s refuses a project API key: an import acts as a person",
    async (method: string, uri: string) => {
      callerProps = {
        ...propsWith([Permission.ProjectOwner]),
        userId: undefined,
        userType: UserType.API,
      };

      const { thrown } = await call(method, uri, { params: IDS });

      expect(thrown).toBeInstanceOf(NotAuthorizedException);
      expect(DiscoveryImportRunner.start).not.toHaveBeenCalled();
      expect(DiscoveryImportRunner.stop).not.toHaveBeenCalled();
      expect(DiscoveryImportRunner.retry).not.toHaveBeenCalled();
    },
  );

  test.each(ROUTES)(
    "%s %s refuses a member who may not see discovery scans",
    async (method: string, uri: string) => {
      callerProps = propsWith([Permission.ReadNetworkDevice]);

      const { thrown } = await call(method, uri, { params: IDS });

      expect(thrown).toBeInstanceOf(NotAuthorizedException);
      expect((thrown as Error).message).toContain(
        "may not see this project's discovery scans",
      );
    },
  );

  test("seeing imports is the right to read discovery scans, nothing more", () => {
    expect(() => {
      assertCanSeeImports(propsWith(SCAN_READER));
    }).not.toThrow();
    expect(() => {
      assertCanSeeImports(propsWith([Permission.ProjectMember]));
    }).not.toThrow();
    expect(() => {
      assertCanSeeImports(propsWith([Permission.CreateNetworkDevice]));
    }).toThrow(NotAuthorizedException);
  });
});

describe("asking for an import", () => {
  test("hands the body to the runner as the person, in their project, and answers with the import", async () => {
    (DiscoveryImportRunner.start as jest.Mock).mockResolvedValue(importRow());
    const body: JSONObject = {
      scanId: SCAN_ID.toString(),
      ipAddresses: ["10.0.0.1", "10.0.0.2"],
      settings: {
        pollingIntervalInMinutes: 1,
        alerting: DiscoveryImportAlerting.None,
      },
    };

    const { thrown, payload } = await call(
      "POST",
      "/network-device-discovery-import/start",
      { body: body },
    );

    expect(thrown).toBeUndefined();
    expect(DiscoveryImportRunner.start).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      props: callerProps,
      scanId: body["scanId"],
      ipAddresses: body["ipAddresses"],
      settings: body["settings"],
    });
    expect(DiscoveryImportRunner.findImport).toHaveBeenCalledWith({
      importId: IMPORT_ID,
      projectId: PROJECT_ID,
      select: DISCOVERY_IMPORT_VIEW_SELECT,
    });
    expect(payload!["import"]).toEqual(
      expect.objectContaining({
        id: IMPORT_ID.toString(),
        scanId: SCAN_ID.toString(),
        status: DiscoveryImportStatus.Running,
        isMine: true,
      }),
    );
  });

  test("a refusal from the runner is the answer", async () => {
    (DiscoveryImportRunner.start as jest.Mock).mockRejectedValue(
      new BadDataException("Select the hosts to import."),
    );

    const { thrown } = await call(
      "POST",
      "/network-device-discovery-import/start",
      { body: {} },
    );

    expect((thrown as Error).message).toBe("Select the hosts to import.");
  });
});

describe("reading imports", () => {
  test("one import, with only the hosts worth a line", async () => {
    const { payload } = await call(
      "GET",
      "/network-device-discovery-import/import/:importId",
      { params: IDS },
    );

    const view: JSONObject = payload!["import"] as JSONObject;
    expect(view["progress"]).toEqual(
      expect.objectContaining({
        hosts: 2,
        devicesCreated: 1,
        devicesFailed: 1,
      }),
    );
    expect(
      (view["results"] as Array<JSONObject>).map(
        (result: JSONObject): unknown => {
          return result["ipAddress"];
        },
      ),
    ).toEqual(["10.0.0.2"]);
  });

  test("every host, when asked for them all", async () => {
    const { payload } = await call(
      "GET",
      "/network-device-discovery-import/import/:importId",
      { params: IDS, query: { results: "all" } },
    );

    expect(
      ((payload!["import"] as JSONObject)["results"] as Array<JSONObject>)
        .length,
    ).toBe(2);
  });

  test("an id that is not one is refused before anything is read", async () => {
    const { thrown } = await call(
      "GET",
      "/network-device-discovery-import/import/:importId",
      { params: { importId: "../../etc" } },
    );

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(DiscoveryImportRunner.findImport).not.toHaveBeenCalled();
  });

  test("the scan's latest import, newest first, of this project - or none", async () => {
    (
      NetworkDeviceDiscoveryImportService.findOneBy as jest.Mock
    ).mockResolvedValue(null);

    const none: { payload: Record<string, unknown> | undefined } = await call(
      "GET",
      "/network-device-discovery-import/scan/:scanId/latest",
      { params: IDS },
    );

    expect(none.payload).toEqual({ import: null });
    const query: JSONObject = (
      (NetworkDeviceDiscoveryImportService.findOneBy as jest.Mock).mock
        .calls[0]![0] as { query: JSONObject; sort: JSONObject }
    ).query;
    expect(query).toEqual({
      projectId: PROJECT_ID,
      networkDeviceDiscoveryScanId: SCAN_ID,
    });

    (
      NetworkDeviceDiscoveryImportService.findOneBy as jest.Mock
    ).mockResolvedValue(importRow({ status: DiscoveryImportStatus.Completed }));

    const found: { payload: Record<string, unknown> | undefined } = await call(
      "GET",
      "/network-device-discovery-import/scan/:scanId/latest",
      { params: IDS },
    );

    expect((found.payload!["import"] as JSONObject)["status"]).toBe(
      DiscoveryImportStatus.Completed,
    );
  });

  test("the project's imports that have not finished", async () => {
    (NetworkDeviceDiscoveryImportService.findBy as jest.Mock).mockResolvedValue(
      [importRow(), importRow({ status: DiscoveryImportStatus.Queued })],
    );

    const { payload } = await call(
      "GET",
      "/network-device-discovery-import/active",
    );

    expect((payload!["imports"] as Array<JSONObject>).length).toBe(2);
    const query: Record<string, unknown> = (
      (NetworkDeviceDiscoveryImportService.findBy as jest.Mock).mock
        .calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query["projectId"]).toBe(PROJECT_ID);
  });
});

describe("stopping and retrying", () => {
  test("stop is the runner's, as the person, and answers with the import", async () => {
    const { thrown, payload } = await call(
      "POST",
      "/network-device-discovery-import/import/:importId/stop",
      { params: IDS },
    );

    expect(thrown).toBeUndefined();
    expect(DiscoveryImportRunner.stop).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      props: callerProps,
      importId: IMPORT_ID,
    });
    expect(payload!["import"]).toBeTruthy();
  });

  test("retry answers with the NEW import", async () => {
    const retryId: ObjectID = new ObjectID(
      "dd000000-0000-4000-8000-000000000099",
    );
    (DiscoveryImportRunner.retry as jest.Mock).mockResolvedValue(
      importRow({ id: retryId } as Partial<NetworkDeviceDiscoveryImport>),
    );
    (DiscoveryImportRunner.findImport as jest.Mock).mockResolvedValue(
      importRow({
        id: retryId,
        retryOfImportId: IMPORT_ID,
      } as Partial<NetworkDeviceDiscoveryImport>),
    );

    const { payload } = await call(
      "POST",
      "/network-device-discovery-import/import/:importId/retry",
      { params: IDS },
    );

    expect(DiscoveryImportRunner.retry).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      props: callerProps,
      importId: IMPORT_ID,
    });
    expect((payload!["import"] as JSONObject)["id"]).toBe(retryId.toString());
    expect((payload!["import"] as JSONObject)["retryOfImportId"]).toBe(
      IMPORT_ID.toString(),
    );
  });
});
