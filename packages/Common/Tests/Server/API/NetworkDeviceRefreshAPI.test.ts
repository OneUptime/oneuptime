import { mockRouter } from "./Helpers";
import "../../../Server/API/NetworkDeviceRefreshAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkDeviceRefreshRunner from "../../../Server/Utils/NetworkDevice/NetworkDeviceRefreshRunner";
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
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

/*
 * Refresh, over HTTP (NetworkDeviceRefreshAPI): who may ask for a network
 * device to be read again now - someone signed in to the project, or a
 * project API key that may write, with the permission to edit network
 * devices - and that the device must be one the caller can see, in their
 * own project, before anything is queued.
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

jest.mock(
  "../../../Server/Utils/NetworkDevice/NetworkDeviceRefreshRunner",
  () => {
    return {
      __esModule: true,
      default: { refresh: jest.fn() },
    };
  },
);

const PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000000011",
);
const ME: ObjectID = new ObjectID("bb000000-0000-4000-8000-000000000011");
const DEVICE_ID: ObjectID = new ObjectID(
  "cc000000-0000-4000-8000-000000000011",
);
const URI: string = "/network-device/:networkDeviceId/refresh";

const ANSWER: JSONObject = {
  requestedAt: "2026-10-28T12:00:00.000Z",
  isProbeReading: true,
  probeName: "Branch probe",
  isControllerReading: false,
  wasAlreadyRequested: false,
};

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

function route(): RegisteredRoute {
  const found: RegisteredRoute | undefined = (
    mockRouter.routes as unknown as Array<RegisteredRoute>
  ).find((candidate: RegisteredRoute): boolean => {
    return candidate.method === "POST" && candidate.uri === URI;
  });

  if (!found) {
    throw new Error(`No POST ${URI}`);
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

function visibleDevice(): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.id = DEVICE_ID;
  device.projectId = PROJECT_ID;
  return device;
}

beforeEach(() => {
  callerProps = propsWith([Permission.ProjectMember]);
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return callerProps;
    });
  (NetworkDeviceService.findOneBy as jest.Mock).mockResolvedValue(
    visibleDevice(),
  );
  (NetworkDeviceRefreshRunner.refresh as jest.Mock).mockResolvedValue(ANSWER);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("POST /network-device/:networkDeviceId/refresh", () => {
  test("reads the session through the user middleware", () => {
    expect(route().middleware).toBe(UserMiddleware.getUserMiddleware);
  });

  test("a member who may edit network devices: the device is read again, and the answer says by whom", async () => {
    const { thrown, payload } = await call();

    expect(thrown).toBeUndefined();
    expect(payload).toEqual(ANSWER);
    expect(NetworkDeviceRefreshRunner.refresh).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });
  });

  test("the device is looked up as the caller, in the caller's project", async () => {
    await call();

    const lookup: { query: JSONObject; props: unknown } = (
      NetworkDeviceService.findOneBy as jest.Mock
    ).mock.calls[0]![0] as { query: JSONObject; props: unknown };

    expect(lookup.query).toEqual({ _id: DEVICE_ID, projectId: PROJECT_ID });
    expect(lookup.props).toBe(callerProps);
  });

  test("a device the caller cannot see, or another project's, is not found - and nothing is queued", async () => {
    (NetworkDeviceService.findOneBy as jest.Mock).mockResolvedValue(null);

    const { thrown } = await call();

    expect(thrown).toBeInstanceOf(NotFoundException);
    expect(NetworkDeviceRefreshRunner.refresh).not.toHaveBeenCalled();
  });

  test("a caller with no session is answered 401", async () => {
    callerProps = { userType: UserType.Public };

    const { thrown } = await call();

    expect(thrown).toBeInstanceOf(NotAuthenticatedException);
    expect(NetworkDeviceRefreshRunner.refresh).not.toHaveBeenCalled();
  });

  test("a member who may only read network devices is refused", async () => {
    callerProps = propsWith([Permission.ReadNetworkDevice]);

    const { thrown } = await call();

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect((thrown as Error).message).toContain(
      "Refreshing a network device needs permission to edit network devices.",
    );
    expect(NetworkDeviceRefreshRunner.refresh).not.toHaveBeenCalled();
  });

  test("a project API key that may edit network devices may ask, as a CMDB sync would", async () => {
    callerProps = {
      ...propsWith([Permission.EditNetworkDevice]),
      userId: undefined,
      userType: UserType.API,
    };

    const { thrown, payload } = await call();

    expect(thrown).toBeUndefined();
    expect(payload).toEqual(ANSWER);
  });

  test("a read-only credential cannot ask", async () => {
    callerProps = {
      ...propsWith([Permission.ProjectOwner]),
      isReadOnlyCredential: true,
    };

    const { thrown } = await call();

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(NetworkDeviceRefreshRunner.refresh).not.toHaveBeenCalled();
  });

  test("an id that is not one is a bad request", async () => {
    const { thrown } = await call({ networkDeviceId: "core-sw-01" });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(NetworkDeviceService.findOneBy).not.toHaveBeenCalled();
  });

  test("why a device cannot be refreshed reaches the caller as it is", async () => {
    (NetworkDeviceRefreshRunner.refresh as jest.Mock).mockRejectedValue(
      new BadDataException("Polling is turned off for this device."),
    );

    const { thrown } = await call();

    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as Error).message).toBe(
      "Polling is turned off for this device.",
    );
  });
});
