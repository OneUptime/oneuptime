import { mockRouter } from "./Helpers";
import "../../../Server/API/NetworkDeviceDiscoveryScanRunAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import ProbeService from "../../../Server/Services/ProbeService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  DISCOVERY_SCAN_RUN_NOT_ALLOWED_REFUSAL,
  DISCOVERY_SCAN_RUN_PATH,
  DiscoveryScanRunResult,
  getDiscoveryScanRunRoute,
} from "../../../Utils/NetworkDiscovery/DiscoveryScanRun";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

/*
 * WHO MAY RUN A DISCOVERY SCAN AGAIN, THROUGH THE REAL ROUTE (OneUptime
 * issue #10334).
 *
 * POST /network-device-discovery-scan/:scanId/run writes as root, so who
 * may ask is the gate. Everything from the request to the write is real
 * here - the route, the props helper, NetworkDeviceDiscoveryScanService
 * .runAgain and the permission check it asks (the one the CRUD API asks of
 * an update by id) - and only the database is answered, from one scan row
 * in memory. So "refused" means the row never moved, and "allowed" means it
 * was queued.
 *
 * Who may run a scan is who may edit one: running it replaces its results
 * and queues it, a change to the scan. Who may create scans but not edit
 * them, who may only read them, and a team blocked from editing them are
 * refused, and a project API key with the edit permission may run one - a
 * re-run after new devices are installed is worth automating.
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

const PROJECT_ID: ObjectID = new ObjectID(
  "10334000-0000-4000-8000-0000000000a1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10334000-0000-4000-8000-0000000000a4",
);
const SIMON: ObjectID = new ObjectID("10334000-0000-4000-8000-0000000000a2");
const SCAN_ID: ObjectID = new ObjectID("10334000-0000-4000-8000-0000000000a3");
const PROBE_ID: ObjectID = new ObjectID(
  "10334000-0000-4000-8000-0000000000a5",
);

type Row = Record<string, unknown>;

let scanRow: Row;

// The one scan: All Tablets Discovery, finished, not repeating.
function tabletsScan(): Row {
  return {
    _id: SCAN_ID.toString(),
    projectId: PROJECT_ID,
    name: "All Tablets Discovery",
    cidr: "10.16-49.0-255.45-47",
    probeId: PROBE_ID,
    status: "Completed",
    completedAt: new Date("2026-11-19T10:00:00.000Z"),
    runRequestedAt: null,
  };
}

// A principal holding exactly these permissions, in a project.
function propsWith(data: {
  permissions?: Array<Permission>;
  blocked?: Array<Permission>;
  userType?: UserType;
  projectId?: ObjectID;
}): DatabaseCommonInteractionProps {
  const projectId: ObjectID = data.projectId || PROJECT_ID;
  const row: (
    permission: Permission,
    isBlockPermission: boolean,
  ) => UserPermission = (
    permission: Permission,
    isBlockPermission: boolean,
  ): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: isBlockPermission,
    };
  };

  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: [
      ...(data.permissions || []).map((permission: Permission) => {
        return row(permission, false);
      }),
      ...(data.blocked || []).map((permission: Permission) => {
        return row(permission, true);
      }),
    ],
  };

  const isApiKey: boolean = data.userType === UserType.API;

  return {
    tenantId: projectId,
    ...(isApiKey ? {} : { userId: SIMON }),
    userType: data.userType || UserType.User,
    userTenantAccessPermission: { [projectId.toString()]: tenant },
    ...ON_HIGHEST_PLAN,
  };
}

let callerProps: DatabaseCommonInteractionProps;

interface RegisteredRoute {
  method: string;
  uri: string;
  middlewares: Array<unknown>;
  handlerFunction: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => void | Promise<void>;
}

function runRoute(): RegisteredRoute {
  const found: RegisteredRoute | undefined = (
    mockRouter.routes as unknown as Array<RegisteredRoute>
  ).find((candidate: RegisteredRoute): boolean => {
    return (
      candidate.method === "POST" && candidate.uri === DISCOVERY_SCAN_RUN_PATH
    );
  });

  if (!found) {
    throw new Error(`No POST ${DISCOVERY_SCAN_RUN_PATH}`);
  }

  return found;
}

async function pressRunAgain(
  scanId: string = SCAN_ID.toString(),
): Promise<{ thrown: unknown; payload: unknown }> {
  const next: jest.Mock = jest.fn();
  const sender: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  sender.mockClear();

  await runRoute().handlerFunction(
    {
      params: { scanId: scanId },
      query: {},
      body: {},
      headers: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  const last: Array<unknown> | undefined =
    sender.mock.calls[sender.mock.calls.length - 1];

  return {
    thrown: next.mock.calls[0]?.[0],
    payload: last ? last[2] : undefined,
  };
}

function expectQueued(): void {
  expect(scanRow["status"]).toBe("Pending");
  expect(AuditLogService.recordUpdate).toHaveBeenCalledTimes(1);
}

function expectUntouched(): void {
  expect(scanRow["status"]).toBe("Completed");
  expect(scanRow["runRequestedAt"]).toBeNull();
  expect(
    NetworkDeviceDiscoveryScanService.compareAndSetColumnsByIdWithoutHooks,
  ).not.toHaveBeenCalled();
  expect(AuditLogService.recordUpdate).not.toHaveBeenCalled();
}

// The permissions that may edit a scan, as the model itself lists them.
const EDITORS: Array<Permission> = (
  new NetworkDeviceDiscoveryScan().getUpdatePermissions() || []
).filter((permission: Permission): boolean => {
  return permission !== Permission.Public;
});

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance"] });
  jest.setSystemTime(new Date("2026-11-22T10:00:00.000Z"));

  scanRow = tabletsScan();
  callerProps = propsWith({ permissions: [Permission.ProjectMember] });

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return callerProps;
    });

  jest
    .spyOn(NetworkDeviceDiscoveryScanService, "findOneBy")
    .mockImplementation((async (findBy: {
      query: Row;
      select: Row;
    }): Promise<NetworkDeviceDiscoveryScan | null> => {
      if (
        String(findBy.query["_id"]).toLowerCase() !==
          String(scanRow["_id"]).toLowerCase() ||
        String(findBy.query["projectId"]) !== String(scanRow["projectId"])
      ) {
        return null;
      }

      const model: NetworkDeviceDiscoveryScan =
        new NetworkDeviceDiscoveryScan();

      for (const column of Object.keys(findBy.select)) {
        (model as unknown as Row)[column] = scanRow[column];
      }

      return model;
    }) as never);

  jest
    .spyOn(
      NetworkDeviceDiscoveryScanService,
      "compareAndSetColumnsByIdWithoutHooks",
    )
    .mockImplementation((async (input: {
      data: Row;
      expectedData: Row;
    }): Promise<boolean> => {
      if (input.expectedData["status"] !== scanRow["status"]) {
        return false;
      }

      Object.assign(scanRow, input.data);
      return true;
    }) as never);

  jest.spyOn(ProbeService, "findOneById").mockImplementation((async () => {
    const probe: Probe = new Probe(PROBE_ID);
    probe.name = "Office Probe";
    probe.projectId = PROJECT_ID;
    probe.connectionStatus = ProbeConnectionStatus.Connected;
    return probe;
  }) as never);

  jest.spyOn(AuditLogService, "recordUpdate").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe("the route", () => {
  test("is a POST to the scan's run path, through the user middleware and the product switch", () => {
    const route: RegisteredRoute = runRoute();

    expect(DISCOVERY_SCAN_RUN_PATH).toBe(
      "/network-device-discovery-scan/:scanId/run",
    );
    expect(getDiscoveryScanRunRoute(SCAN_ID.toString())).toBe(
      `/network-device-discovery-scan/${SCAN_ID.toString()}/run`,
    );
    expect(route.middlewares[0]).toBe(UserMiddleware.getUserMiddleware);
    // The Network product's refusal while it is switched off.
    expect(route.middlewares).toHaveLength(2);
  });

  test("queues the scan it names, as the caller, and answers with it queued", async () => {
    const { thrown, payload } = await pressRunAgain();

    expect(thrown).toBeUndefined();
    expectQueued();
    expect(scanRow["runRequestedByUserId"]).toEqual(SIMON);
    expect(payload).toEqual({
      scanId: SCAN_ID.toString(),
      status: "Pending",
      runRequestedAt: "2026-11-22T10:00:00.000Z",
    } as DiscoveryScanRunResult);
  });

  test.each([["not-a-scan-id"], ["1; DROP TABLE"], [""]])(
    "refuses a scan id that is not one (%s), and nothing runs",
    async (scanId: string) => {
      const { thrown } = await pressRunAgain(scanId);

      expect(thrown).toBeInstanceOf(BadDataException);
      expectUntouched();
    },
  );
});

describe("who may run a scan: whoever may edit one", () => {
  test("the permissions that may edit a scan are the project's editors and the Network product's", () => {
    expect([...EDITORS].sort()).toEqual(
      [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.SettingsAdmin,
        Permission.SettingsMember,
        Permission.EditNetworkDeviceDiscoveryScan,
        Permission.NetworkAdmin,
        Permission.NetworkMember,
      ].sort(),
    );
  });

  test.each(EDITORS.map((permission: Permission) => [permission]))(
    "%s may run a scan",
    async (permission: Permission) => {
      callerProps = propsWith({
        permissions: [
          permission,
          // A write needs a read: a role that may edit scans reads them too.
          Permission.ReadNetworkDeviceDiscoveryScan,
        ],
      });

      const { thrown } = await pressRunAgain();

      expect(thrown).toBeUndefined();
      expectQueued();
    },
  );

  test.each([
    [Permission.Viewer],
    [Permission.SettingsViewer],
    [Permission.ReadNetworkDeviceDiscoveryScan],
    // May start a new scan, not change an existing one.
    [Permission.CreateNetworkDeviceDiscoveryScan],
    [Permission.DeleteNetworkDeviceDiscoveryScan],
    [Permission.EditNetworkDevice],
  ])("%s may not, and nothing runs", async (permission: Permission) => {
    callerProps = propsWith({
      permissions: [permission, Permission.ReadNetworkDeviceDiscoveryScan],
    });

    const { thrown } = await pressRunAgain();

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect((thrown as Error).message).toBe(
      DISCOVERY_SCAN_RUN_NOT_ALLOWED_REFUSAL,
    );
    expectUntouched();
  });

  test("may edit scans but not read them: a write needs a read, as an edit does", async () => {
    callerProps = propsWith({
      permissions: [Permission.EditNetworkDeviceDiscoveryScan],
    });

    const { thrown } = await pressRunAgain();

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expectUntouched();
  });

  test("a team blocked from editing scans may not, whatever else it holds", async () => {
    callerProps = propsWith({
      permissions: [Permission.ProjectMember],
      blocked: [Permission.EditNetworkDeviceDiscoveryScan],
    });

    const { thrown } = await pressRunAgain();

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expectUntouched();
  });

  test("a project API key that may edit scans may run one, and no person is named", async () => {
    callerProps = propsWith({
      permissions: [
        Permission.EditNetworkDeviceDiscoveryScan,
        Permission.ReadNetworkDeviceDiscoveryScan,
      ],
      userType: UserType.API,
    });

    const { thrown } = await pressRunAgain();

    expect(thrown).toBeUndefined();
    expectQueued();
    expect(scanRow["runRequestedByUserId"]).toBeNull();
  });

  test("a project API key that may only read scans may not", async () => {
    callerProps = propsWith({
      permissions: [Permission.ReadNetworkDeviceDiscoveryScan],
      userType: UserType.API,
    });

    const { thrown } = await pressRunAgain();

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expectUntouched();
  });

  test("a caller with no session is answered 401, and nothing runs", async () => {
    callerProps = { userType: UserType.Public };

    const { thrown } = await pressRunAgain();

    expect(thrown).toBeInstanceOf(NotAuthenticatedException);
    expectUntouched();
  });

  test("a caller who names no project is refused, and nothing runs", async () => {
    callerProps = {
      ...propsWith({ permissions: [Permission.ProjectOwner] }),
      tenantId: undefined,
    };

    const { thrown } = await pressRunAgain();

    expect(thrown).toBeInstanceOf(BadDataException);
    expectUntouched();
  });

  test("a caller who is no member of the project they name is refused, and nothing runs", async () => {
    callerProps = {
      ...propsWith({ permissions: [Permission.ProjectOwner] }),
      userTenantAccessPermission: {},
    };

    const { thrown } = await pressRunAgain();

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expectUntouched();
  });

  test("an owner of another project reaches no scan of this one", async () => {
    callerProps = propsWith({
      permissions: [Permission.ProjectOwner],
      projectId: OTHER_PROJECT_ID,
    });

    const { thrown } = await pressRunAgain();

    expect(thrown).toBeInstanceOf(BadDataException);
    expectUntouched();
  });
});
