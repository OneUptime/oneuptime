import { mockRouter } from "./Helpers";
import { UNTIED_MONITORS_PATH } from "../../../Server/API/NetworkDeviceUntiedMonitorsAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import UntiedDeviceMonitors from "../../../Server/Utils/NetworkDevice/UntiedDeviceMonitors";
import { UntiedMonitorMatch } from "../../../Utils/NetworkDevice/UntiedDeviceMonitor";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The monitors that check a device's address but are tied to no device,
 * over HTTP (NetworkDeviceUntiedMonitorsAPI, OneUptime issue #9903): what a
 * device's Monitors card offers a one-click tie for, or says why not.
 *
 * What it pins: who may ask, that the device must be one the caller can see
 * in their own project before anything is read, that its address and site
 * are then read as OneUptime for the rule, and that the caller's own props
 * go to UntiedDeviceMonitors, which reads the monitors again as them.
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

jest.mock("../../../Server/Utils/NetworkDevice/UntiedDeviceMonitors", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/NetworkDevice/UntiedDeviceMonitors",
  );

  return {
    ...actual,
    __esModule: true,
    default: { findFor: jest.fn() },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000009903",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000009904",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "cc000000-0000-4000-8000-000000009903",
);
const MONITOR_ID: string = "ee000000-0000-4000-8000-00000000000a";

// A member of the project, signed in.
const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("bb000000-0000-4000-8000-000000009903"),
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    } as UserTenantAccessPermission,
  },
  ...ON_HIGHEST_PLAN,
};

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
      candidate.method === "POST" && candidate.uri === UNTIED_MONITORS_PATH
    );
  });

  if (!found) {
    throw new Error(`No POST ${UNTIED_MONITORS_PATH}`);
  }

  return found;
}

async function call(
  params: Dictionary<string> = { networkDeviceId: DEVICE_ID.toString() },
): Promise<{ thrown: unknown; payload: JSONObject | undefined }> {
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
    payload: last ? (last[2] as JSONObject) : undefined,
  };
}

function storedDevice(projectId: ObjectID = PROJECT_ID): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.id = DEVICE_ID;
  device.projectId = projectId;
  device.hostname = "10.0.0.5";
  return device;
}

const findOneBy: jest.Mock =
  NetworkDeviceService.findOneBy as unknown as jest.Mock;
const findFor: jest.Mock = UntiedDeviceMonitors.findFor as unknown as jest.Mock;

beforeEach(() => {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(CALLER);
  findOneBy.mockResolvedValue(storedDevice());
  findFor.mockResolvedValue({
    monitors: [
      {
        monitorId: MONITOR_ID,
        name: "Branch A ping",
        monitorType: "Ping",
        match: UntiedMonitorMatch.ThisDevice,
      },
    ],
    hasMore: false,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("POST /network-device/:networkDeviceId/untied-monitors", () => {
  test("is the device's own route, beside its CRUD routes", () => {
    expect(UNTIED_MONITORS_PATH).toBe(
      "/network-device/:networkDeviceId/untied-monitors",
    );
  });

  test("reads the session through the user middleware", () => {
    expect(route().middleware).toBe(UserMiddleware.getUserMiddleware);
  });

  test("answers the monitors on the device's address and what their probes see there", async () => {
    const { thrown, payload } = await call();

    expect(thrown).toBeUndefined();
    expect(payload).toEqual({
      monitors: [
        {
          monitorId: MONITOR_ID,
          name: "Branch A ping",
          monitorType: "Ping",
          match: UntiedMonitorMatch.ThisDevice,
        },
      ],
      hasMore: false,
    });
  });

  test("looks the device up as the caller, in the caller's project, before anything else", async () => {
    await call();

    const lookup: { query: JSONObject; select: JSONObject; props: unknown } =
      findOneBy.mock.calls[0]![0];

    expect(lookup.query).toEqual({ _id: DEVICE_ID, projectId: PROJECT_ID });
    expect(lookup.select).toEqual({ _id: true, projectId: true });
    expect(lookup.props).toBe(CALLER);
  });

  test("then reads its address and where it is as OneUptime, for the rule", async () => {
    await call();

    const forRule: { query: JSONObject; select: JSONObject; props: unknown } =
      findOneBy.mock.calls[1]![0];

    expect(forRule.query).toEqual({ _id: DEVICE_ID, projectId: PROJECT_ID });
    expect(forRule.select).toEqual({
      _id: true,
      hostname: true,
      siteId: true,
      probeId: true,
    });
    expect(forRule.props).toEqual({ isRoot: true });
  });

  test("hands the caller's own props on, so the monitors are read as them", async () => {
    await call();

    expect(findFor).toHaveBeenCalledTimes(1);
    const asked: {
      projectId: ObjectID;
      device: NetworkDevice;
      props: DatabaseCommonInteractionProps;
    } = findFor.mock.calls[0]![0];

    expect(asked.projectId).toBe(PROJECT_ID);
    expect(asked.device.hostname).toBe("10.0.0.5");
    expect(asked.props).toBe(CALLER);
  });

  test("a device the caller cannot see is not found, and nothing else is read", async () => {
    findOneBy.mockResolvedValue(null);

    const { thrown, payload } = await call();

    expect(thrown).toBeInstanceOf(NotFoundException);
    expect(payload).toBeUndefined();
    expect(findFor).not.toHaveBeenCalled();
  });

  test("a device of another project is refused", async () => {
    findOneBy.mockResolvedValue(storedDevice(OTHER_PROJECT_ID));

    const { thrown } = await call();

    expect(thrown).toBeDefined();
    expect(findFor).not.toHaveBeenCalled();
  });

  test("an id that is no id is refused before anything is read", async () => {
    const { thrown } = await call({ networkDeviceId: "not-an-id" });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("says when more monitors held the address than were read", async () => {
    findFor.mockResolvedValue({ monitors: [], hasMore: true });

    const { payload } = await call();

    expect(payload).toEqual({ monitors: [], hasMore: true });
  });
});
