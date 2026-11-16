import { mockRouter } from "./Helpers";
import {
  WATCHING_MONITORS_PATH,
  WATCHING_MONITOR_IDS_PER_READ,
} from "../../../Server/API/NetworkDeviceWatchingMonitorsAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import MonitorNetworkDeviceService from "../../../Server/Services/MonitorNetworkDeviceService";
import MonitorService from "../../../Server/Services/MonitorService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

/*
 * The Network Device monitors watching a device, over HTTP
 * (NetworkDeviceWatchingMonitorsAPI, OneUptime issue #8101).
 *
 * The device's Overview and Monitors pages used to find these by listing
 * every Network Device monitor of the project, steps and all, and filtering
 * them in the browser - a heavy read on every open, and past the list's
 * page limit a monitor that did watch the device was silently missed. The
 * route answers by the device instead: the device's rows in
 * MonitorNetworkDevice, then those monitors, read as the caller.
 *
 * What it pins: who may ask (someone signed in, or a project API key), that
 * the device must be one the caller can see in their own project before
 * the table is asked, that the table is asked about this device in this
 * project only, and that the answer names only the monitors the caller may
 * read, each once, in id order, however many there are.
 *
 * `jest` is the global one.
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

jest.mock("../../../Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn() },
  };
});

jest.mock("../../../Server/Services/MonitorNetworkDeviceService", () => {
  return {
    __esModule: true,
    default: { findMonitorIdsWatching: jest.fn() },
  };
});

jest.mock("../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn() },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000008101",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000008102",
);
const ME: ObjectID = new ObjectID("bb000000-0000-4000-8000-000000008101");
const DEVICE_ID: ObjectID = new ObjectID(
  "cc000000-0000-4000-8000-000000008101",
);

const WATCHER_A: string = "ee000000-0000-4000-8000-00000000000a";
const WATCHER_B: string = "ee000000-0000-4000-8000-00000000000b";
const WATCHER_C: string = "ee000000-0000-4000-8000-00000000000c";

type AnyQuery = { __in: Array<string> };

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

// The monitors the caller may read, by id: what MonitorService answers them.
let readableByCaller: Set<string>;

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

function route(): RegisteredRoute {
  const found: RegisteredRoute | undefined = (
    mockRouter.routes as unknown as Array<RegisteredRoute>
  ).find((candidate: RegisteredRoute): boolean => {
    return (
      candidate.method === "POST" && candidate.uri === WATCHING_MONITORS_PATH
    );
  });

  if (!found) {
    throw new Error(`No POST ${WATCHING_MONITORS_PATH}`);
  }

  return found;
}

async function call(
  params: Dictionary<string> = { networkDeviceId: DEVICE_ID.toString() },
): Promise<{ thrown: unknown; payload: Record<string, unknown> | undefined }> {
  const next: jest.Mock = jest.fn();
  const sender: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  sender.mockClear();

  await route().handlerFunction(
    { params, query: {}, body: {}, headers: {} } as unknown as ExpressRequest,
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

function visibleDevice(projectId: ObjectID = PROJECT_ID): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.id = DEVICE_ID;
  device.projectId = projectId;
  return device;
}

function monitorReads(): Array<{
  query: JSONObject;
  select: JSONObject;
  limit: number;
  skip: number;
  props: DatabaseCommonInteractionProps;
}> {
  return (MonitorService.findBy as jest.Mock).mock.calls.map(
    (callArguments: Array<unknown>) => {
      return callArguments[0] as {
        query: JSONObject;
        select: JSONObject;
        limit: number;
        skip: number;
        props: DatabaseCommonInteractionProps;
      };
    },
  );
}

function idsAsked(query: JSONObject): Array<string> {
  return (query["_id"] as unknown as AnyQuery).__in;
}

beforeEach(() => {
  callerProps = propsWith([Permission.ProjectMember]);
  readableByCaller = new Set<string>([WATCHER_A, WATCHER_B, WATCHER_C]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return callerProps;
    });
  jest.spyOn(QueryHelper, "any").mockImplementation(((
    values: Array<string | ObjectID>,
  ): AnyQuery => {
    return {
      __in: values.map((value: string | ObjectID): string => {
        return value.toString();
      }),
    };
  }) as never);

  (NetworkDeviceService.findOneBy as jest.Mock).mockResolvedValue(
    visibleDevice(),
  );
  (
    MonitorNetworkDeviceService.findMonitorIdsWatching as jest.Mock
  ).mockResolvedValue([WATCHER_B, WATCHER_A]);
  (MonitorService.findBy as jest.Mock).mockImplementation(
    async (findBy: { query: JSONObject }): Promise<Array<Monitor>> => {
      return idsAsked(findBy.query)
        .filter((id: string): boolean => {
          return readableByCaller.has(id);
        })
        .map((id: string): Monitor => {
          return new Monitor(new ObjectID(id));
        });
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("POST /network-device/:networkDeviceId/watching-monitors", () => {
  test("is the device's own route, beside its CRUD routes", () => {
    expect(WATCHING_MONITORS_PATH).toBe(
      "/network-device/:networkDeviceId/watching-monitors",
    );
  });

  test("reads the session through the user middleware", () => {
    expect(route().middleware).toBe(UserMiddleware.getUserMiddleware);
  });

  test("answers the monitors whose steps name the device, in id order", async () => {
    const { thrown, payload } = await call();

    expect(thrown).toBeUndefined();
    expect(payload).toEqual({ monitorIds: [WATCHER_A, WATCHER_B] });
  });

  test("the device is looked up as the caller, in the caller's project, before anything else is read", async () => {
    await call();

    const lookup: { query: JSONObject; props: unknown } = (
      NetworkDeviceService.findOneBy as jest.Mock
    ).mock.calls[0]![0] as { query: JSONObject; props: unknown };

    expect(lookup.query).toEqual({ _id: DEVICE_ID, projectId: PROJECT_ID });
    expect(lookup.props).toBe(callerProps);
  });

  test("the table is asked about this device, in the caller's project", async () => {
    await call();

    expect(
      MonitorNetworkDeviceService.findMonitorIdsWatching,
    ).toHaveBeenCalledTimes(1);
    expect(
      MonitorNetworkDeviceService.findMonitorIdsWatching,
    ).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      deviceIds: [DEVICE_ID.toString()],
    });
  });

  test("the monitors are read again as the caller: by id, in the project, as Network Device monitors, ids only", async () => {
    await call();

    const reads: ReturnType<typeof monitorReads> = monitorReads();

    expect(reads).toHaveLength(1);
    expect(idsAsked(reads[0]!.query)).toEqual([WATCHER_A, WATCHER_B]);
    expect(
      (reads[0]!.query["projectId"] as unknown as ObjectID).toString(),
    ).toBe(PROJECT_ID.toString());
    expect(reads[0]!.query["monitorType"]).toBe(MonitorType.NetworkDevice);
    expect(reads[0]!.select).toEqual({ _id: true });
    expect(reads[0]!.limit).toBe(2);
    expect(reads[0]!.skip).toBe(0);
    // The caller's own permissions, labels included - never root.
    expect(reads[0]!.props).toBe(callerProps);
    expect(reads[0]!.props.isRoot).toBeUndefined();
  });

  test("a monitor the caller may not read is not named", async () => {
    readableByCaller = new Set<string>([WATCHER_B]);

    const { payload } = await call();

    expect(payload).toEqual({ monitorIds: [WATCHER_B] });
  });

  test("a caller who may not read monitors at all is refused, as the Monitor list would refuse them", async () => {
    (MonitorService.findBy as jest.Mock).mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to read monitors.",
      ),
    );

    const { thrown, payload } = await call();

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(payload).toBeUndefined();
  });

  test("a device no monitor watches answers none, and reads no monitor", async () => {
    (
      MonitorNetworkDeviceService.findMonitorIdsWatching as jest.Mock
    ).mockResolvedValue([]);

    const { thrown, payload } = await call();

    expect(thrown).toBeUndefined();
    expect(payload).toEqual({ monitorIds: [] });
    expect(MonitorService.findBy).not.toHaveBeenCalled();
  });

  test("a monitor named twice is answered once", async () => {
    (
      MonitorNetworkDeviceService.findMonitorIdsWatching as jest.Mock
    ).mockResolvedValue([WATCHER_C, WATCHER_A, WATCHER_C]);

    const { payload } = await call();

    expect(idsAsked(monitorReads()[0]!.query)).toEqual([WATCHER_A, WATCHER_C]);
    expect(payload).toEqual({ monitorIds: [WATCHER_A, WATCHER_C] });
  });

  test("a device watched by more monitors than one read names is read in pieces, and every one is answered", async () => {
    const many: Array<string> = Array.from(
      { length: WATCHING_MONITOR_IDS_PER_READ * 2 + 3 },
      (): string => {
        return ObjectID.generate().toString();
      },
    );
    readableByCaller = new Set<string>(many);
    (
      MonitorNetworkDeviceService.findMonitorIdsWatching as jest.Mock
    ).mockResolvedValue(many);

    const { payload } = await call();

    expect(
      monitorReads().map((read: { query: JSONObject }): number => {
        return idsAsked(read.query).length;
      }),
    ).toEqual([
      WATCHING_MONITOR_IDS_PER_READ,
      WATCHING_MONITOR_IDS_PER_READ,
      3,
    ]);
    expect(payload).toEqual({ monitorIds: [...many].sort() });
  });

  test("a device the caller cannot see is not found - and the table is never asked", async () => {
    (NetworkDeviceService.findOneBy as jest.Mock).mockResolvedValue(null);

    const { thrown, payload } = await call();

    expect(thrown).toBeInstanceOf(NotFoundException);
    expect((thrown as Error).message).toBe(
      "This network device does not exist.",
    );
    expect(payload).toBeUndefined();
    expect(
      MonitorNetworkDeviceService.findMonitorIdsWatching,
    ).not.toHaveBeenCalled();
    expect(MonitorService.findBy).not.toHaveBeenCalled();
  });

  test("another project's device is refused, even if a lookup hands it back", async () => {
    (NetworkDeviceService.findOneBy as jest.Mock).mockResolvedValue(
      visibleDevice(OTHER_PROJECT_ID),
    );

    const { thrown } = await call();

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(
      MonitorNetworkDeviceService.findMonitorIdsWatching,
    ).not.toHaveBeenCalled();
  });

  test("a caller with no session is answered 401, and nothing is read", async () => {
    callerProps = { userType: UserType.Public };

    const { thrown } = await call();

    expect(thrown).toBeInstanceOf(NotAuthenticatedException);
    expect(NetworkDeviceService.findOneBy).not.toHaveBeenCalled();
  });

  test("a project API key may ask, as an integration reading a device's monitors would", async () => {
    callerProps = {
      ...propsWith([
        Permission.ReadNetworkDevice,
        Permission.ReadProjectMonitor,
      ]),
      userId: undefined,
      userType: UserType.API,
    };

    const { thrown, payload } = await call();

    expect(thrown).toBeUndefined();
    expect(payload).toEqual({ monitorIds: [WATCHER_A, WATCHER_B] });
  });

  test("an id that is not one is a bad request, and nothing is read", async () => {
    for (const networkDeviceId of ["core-sw-01", "", "'; DROP TABLE x; --"]) {
      (NetworkDeviceService.findOneBy as jest.Mock).mockClear();

      const { thrown } = await call({ networkDeviceId });

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Error).message).toBe(
        "A valid network device ID is required.",
      );
      expect(NetworkDeviceService.findOneBy).not.toHaveBeenCalled();
    }
  });
});
