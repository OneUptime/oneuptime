import { mockRouter } from "./Helpers";
import "../../../Server/API/NetworkDiscoveredDeviceAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import DiscoveredDevices from "../../../Server/Utils/NetworkDevice/DiscoveredDevices";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import {
  DiscoveredDeviceShow,
  DiscoveredDeviceSort,
} from "../../../Types/NetworkDevice/DiscoveredDevice";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

/*
 * The Discovered Devices list over HTTP (issue #5775). The handlers read
 * the request, make sure a person signed in to the project is asking, and
 * hand the rest to DiscoveredDevices, whose own suite covers the rights
 * each action needs. Nothing reaches it from a malformed request, an
 * anonymous caller or a project API key.
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

jest.mock("../../../Server/Utils/NetworkDevice/DiscoveredDevices", () => {
  return {
    __esModule: true,
    default: {
      list: jest.fn(),
      listIds: jest.fn(),
      hideFromMap: jest.fn(),
      showOnMap: jest.fn(),
      showEverythingOnMap: jest.fn(),
    },
  };
});

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
  "aa000000-0000-4000-8000-000000000021",
);
const ME: ObjectID = new ObjectID("bb000000-0000-4000-8000-000000000021");
const ROW_A: string = "10000000-0000-4000-8000-00000000002a";
const ROW_B: string = "10000000-0000-4000-8000-00000000002b";
const SITE_ID: string = "30000000-0000-4000-8000-000000000021";

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
  uri: string,
  body: unknown = {},
): Promise<{ thrown: unknown; payload: Record<string, unknown> | undefined }> {
  const next: jest.Mock = jest.fn();
  const sender: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  sender.mockClear();

  await route("POST", uri).handlerFunction(
    {
      params: {},
      query: {},
      body: body,
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

const LIST: string = "/network-discovered-device/list";
const IDS: string = "/network-discovered-device/ids";
const HIDE: string = "/network-discovered-device/hide-from-map";
const SHOW: string = "/network-discovered-device/show-on-map";
const SHOW_EVERYTHING: string =
  "/network-discovered-device/show-everything-on-map";
const ROUTES: Array<string> = [LIST, IDS, HIDE, SHOW, SHOW_EVERYTHING];

function noActionRan(): void {
  expect(DiscoveredDevices.list).not.toHaveBeenCalled();
  expect(DiscoveredDevices.listIds).not.toHaveBeenCalled();
  expect(DiscoveredDevices.hideFromMap).not.toHaveBeenCalled();
  expect(DiscoveredDevices.showOnMap).not.toHaveBeenCalled();
  expect(DiscoveredDevices.showEverythingOnMap).not.toHaveBeenCalled();
}

beforeEach(() => {
  callerProps = propsWith([Permission.ProjectOwner]);
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return callerProps;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("who may call the Discovered Devices API", () => {
  test("every route is a POST read through the user middleware", () => {
    for (const uri of ROUTES) {
      expect(route("POST", uri).middleware).toBe(
        UserMiddleware.getUserMiddleware,
      );
    }
  });

  test.each(ROUTES)(
    "%s answers a caller with no session with 401",
    async (uri: string) => {
      callerProps = { userType: UserType.Public };

      const { thrown } = await call(uri, { endpointIds: [ROW_A] });

      expect(thrown).toBeInstanceOf(NotAuthenticatedException);
      noActionRan();
    },
  );

  test.each(ROUTES)(
    "%s refuses a project API key: the list is a person's tool",
    async (uri: string) => {
      callerProps = {
        ...propsWith([Permission.ProjectOwner]),
        userId: undefined,
        userType: UserType.API,
      };

      const { thrown } = await call(uri, { endpointIds: [ROW_A] });

      expect(thrown).toBeInstanceOf(NotAuthorizedException);
      noActionRan();
    },
  );

  test.each(ROUTES)(
    "%s refuses a person who is not a member of the project",
    async (uri: string) => {
      callerProps = {
        ...propsWith([Permission.ProjectOwner]),
        userTenantAccessPermission: {},
      };

      const { thrown } = await call(uri, { endpointIds: [ROW_A] });

      expect(thrown).toBeInstanceOf(NotAuthorizedException);
      noActionRan();
    },
  );

  test("a refusal from the list itself reaches the person as it was said", async () => {
    const refusal: NotAuthorizedException = new NotAuthorizedException(
      "You may not see this project's discovered devices.",
    );
    (DiscoveredDevices.list as jest.Mock).mockRejectedValue(refusal);

    const { thrown, payload } = await call(LIST, {});

    expect(thrown).toBe(refusal);
    expect(payload).toBeUndefined();
  });
});

describe("reading the list", () => {
  test("passes the read request, the project and the person's props", async () => {
    (DiscoveredDevices.list as jest.Mock).mockResolvedValue({
      rows: [],
      count: 0,
      counts: { all: 0, notMonitored: 0, monitored: 0, hidden: 0 },
    });

    const { thrown, payload } = await call(LIST, {
      search: "  10.0.0.  ",
      show: DiscoveredDeviceShow.Hidden,
      siteId: SITE_ID,
      sort: DiscoveredDeviceSort.IpAddress,
      limit: 50,
      skip: 100,
    });

    expect(thrown).toBeUndefined();
    expect(DiscoveredDevices.list).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      props: callerProps,
      request: {
        search: "10.0.0.",
        show: DiscoveredDeviceShow.Hidden,
        siteId: SITE_ID,
        sort: DiscoveredDeviceSort.IpAddress,
        sortOrder: "asc",
        limit: 50,
        skip: 100,
      },
    });
    expect(payload).toEqual({
      rows: [],
      count: 0,
      counts: { all: 0, notMonitored: 0, monitored: 0, hidden: 0 },
    });
  });

  test("an empty body asks for the first page of devices not monitored", async () => {
    (DiscoveredDevices.list as jest.Mock).mockResolvedValue({
      rows: [],
      count: 0,
      counts: { all: 0, notMonitored: 0, monitored: 0, hidden: 0 },
    });

    await call(LIST, undefined);

    expect(DiscoveredDevices.list).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          show: DiscoveredDeviceShow.NotMonitored,
          skip: 0,
          limit: 25,
        }),
      }),
    );
  });

  test.each([
    [{ limit: 1000 }, "Show between 1 and 100 devices a page."],
    [
      { show: "everything" },
      "Show the devices that are not monitored, the monitored ones, the hidden ones, or all of them.",
    ],
    [{ search: "x".repeat(101) }, "Search for at most 100 characters."],
    [{ siteId: "not-an-id" }, "This site was not found."],
  ])(
    "refuses %j before reading anything",
    async (body: JSONObject, message: string) => {
      const { thrown } = await call(LIST, body);

      expect(thrown).toEqual(new BadDataException(message));
      noActionRan();
    },
  );

  test("select all answers the matching ids and how many match", async () => {
    (DiscoveredDevices.listIds as jest.Mock).mockResolvedValue({
      ids: [ROW_A, ROW_B],
      count: 2,
    });

    const { payload } = await call(IDS, { search: "printer" });

    expect(DiscoveredDevices.listIds).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        request: expect.objectContaining({ search: "printer" }),
      }),
    );
    expect(payload).toEqual({ ids: [ROW_A, ROW_B], count: 2 });
  });
});

describe("hiding and showing devices on the map", () => {
  const CHANGE: JSONObject = {
    changed: 1,
    unchanged: 0,
    skippedMonitored: 1,
    notFound: 0,
  };

  test("hide passes the selected ids, cleaned, and answers what changed", async () => {
    (DiscoveredDevices.hideFromMap as jest.Mock).mockResolvedValue(CHANGE);

    const { payload } = await call(HIDE, {
      endpointIds: [` ${ROW_A.toUpperCase()} `, ROW_A, ROW_B],
    });

    expect(DiscoveredDevices.hideFromMap).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      props: callerProps,
      endpointIds: [ROW_A, ROW_B],
    });
    expect(payload).toEqual(CHANGE);
  });

  test("show passes the selected ids and answers what changed", async () => {
    (DiscoveredDevices.showOnMap as jest.Mock).mockResolvedValue(CHANGE);

    const { payload } = await call(SHOW, { endpointIds: [ROW_B] });

    expect(DiscoveredDevices.showOnMap).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      props: callerProps,
      endpointIds: [ROW_B],
    });
    expect(payload).toEqual(CHANGE);
  });

  test.each([HIDE, SHOW])(
    "%s refuses an empty or malformed selection",
    async (uri: string) => {
      expect((await call(uri, {})).thrown).toEqual(
        new BadDataException("Select the devices first."),
      );
      expect((await call(uri, { endpointIds: ["nope"] })).thrown).toEqual(
        new BadDataException(
          "One of the selected devices was not found. Refresh the list and select them again.",
        ),
      );
      noActionRan();
    },
  );

  test("show everything answers how many nodes came back", async () => {
    (DiscoveredDevices.showEverythingOnMap as jest.Mock).mockResolvedValue({
      changed: 4,
    });

    const { payload } = await call(SHOW_EVERYTHING);

    expect(DiscoveredDevices.showEverythingOnMap).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      props: callerProps,
    });
    expect(payload).toEqual({ changed: 4 });
  });
});
