import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import MessageQueueTopologyService, {
  MessageQueueTopologyRequest,
} from "Common/Server/Services/MessageQueueTopologyService";
import Response from "Common/Server/Utils/Response";
import TelemetryReadAccess from "Common/Server/Utils/Telemetry/TelemetryReadAccess";
import { TelemetryReadScope } from "Common/Server/Utils/Telemetry/TelemetryReadScope";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import {
  MESSAGE_QUEUE_TOPOLOGY_API_PATH,
  MESSAGE_QUEUE_TOPOLOGY_MAX_RANGE_MS,
  MessageQueueTopologyResponse,
} from "Common/Types/MessageQueue/MessageQueueTopology";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
    },
  };
});

// Importing the module registers its route on the mocked router.
import MessageQueueTopologyAPI from "../../FeatureSet/BaseAPI/API/MessageQueueTopology";

new MessageQueueTopologyAPI().getRouter();

/*
 * POST /api/telemetry/message-queues/topology: who may ask, about what, and
 * what reaches the read. The handler runs for real - the props, the tenant
 * check, the Span read permission, the range, the caller's read scope -
 * and the read it ends in (MessageQueueTopologyService.getTopology) is
 * answered here.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_A: ObjectID = ObjectID.generate();
const SERVICE_B: ObjectID = ObjectID.generate();

const TOPOLOGY: MessageQueueTopologyResponse = {
  startTime: "2026-11-07T11:00:00.000Z",
  endTime: "2026-11-07T12:00:00.000Z",
  queues: [],
  services: [],
  flows: [],
  truncation: { queues: false, flows: false },
};

const responseUtil: { sendJsonObjectResponse: jest.Mock } =
  Response as unknown as { sendJsonObjectResponse: jest.Mock };

function tenantPermissions(
  permissions: Array<Permission>,
): Record<string, UserTenantAccessPermission> {
  return {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: permissions.map((permission: Permission) => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        } as UserPermission;
      }),
      isBlockPermission: false,
    } as UserTenantAccessPermission,
  };
}

function memberProps(
  permissions: Array<Permission> = [Permission.TelemetryViewer],
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: tenantPermissions(permissions),
  };
}

type Spy = {
  mock: { calls: Array<Array<unknown>> };
  mockResolvedValue: (value: unknown) => void;
  mockRejectedValue: (value: unknown) => void;
};

let getTopology: Spy;
let getScope: Spy;

interface Called {
  next: jest.Mock;
  req: ExpressRequest;
  res: ExpressResponse;
}

async function call(
  body: unknown,
  props: DatabaseCommonInteractionProps = memberProps(),
): Promise<Called> {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);
  const next: jest.Mock = jest.fn() as unknown as jest.Mock;
  const req: ExpressRequest = { body } as unknown as ExpressRequest;
  const res: ExpressResponse = {} as unknown as ExpressResponse;
  await mockRouter
    .match("post", MESSAGE_QUEUE_TOPOLOGY_API_PATH)
    .handlerFunction(req, res, next as unknown as NextFunction);
  return { next, req, res };
}

function errorFrom(next: jest.Mock): unknown {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0]![0];
}

function request(): MessageQueueTopologyRequest {
  expect(getTopology.mock.calls).toHaveLength(1);
  return getTopology.mock.calls[0]![0] as MessageQueueTopologyRequest;
}

function ids(values: Array<ObjectID> | undefined): Array<string> {
  return (values || []).map((value: ObjectID): string => {
    return value.toString();
  });
}

describe("POST /telemetry/message-queues/topology", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getTopology = jest.spyOn(
      MessageQueueTopologyService,
      "getTopology" as never,
    ) as unknown as Spy;
    getTopology.mockResolvedValue(TOPOLOGY);
    getScope = jest.spyOn(
      TelemetryReadAccess,
      "getScope" as never,
    ) as unknown as Spy;
    getScope.mockResolvedValue({
      readableIds: null,
      blockedIds: [],
    } as TelemetryReadScope);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is a POST at the path the Dashboard calls, behind getUserMiddleware alone", () => {
    const routes: Array<{ method: string; uri: string }> =
      mockRouter.routes.filter((route: { uri: string }): boolean => {
        return route.uri.includes("message-queues");
      });
    expect(routes).toHaveLength(1);
    expect(routes[0]!.method).toBe("POST");
    expect(routes[0]!.uri).toBe(MESSAGE_QUEUE_TOPOLOGY_API_PATH);
    expect(
      mockRouter.match("post", MESSAGE_QUEUE_TOPOLOGY_API_PATH).middlewares,
    ).toEqual([UserMiddleware.getUserMiddleware]);
  });

  test("answers with the topology the read made", async () => {
    const { next, req, res } = await call({
      startTime: "2026-11-07T11:00:00.000Z",
      endTime: "2026-11-07T12:00:00.000Z",
    });
    expect(next).not.toHaveBeenCalled();
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    expect(responseUtil.sendJsonObjectResponse.mock.calls[0]![0]).toBe(req);
    expect(responseUtil.sendJsonObjectResponse.mock.calls[0]![1]).toBe(res);
    expect(responseUtil.sendJsonObjectResponse.mock.calls[0]![2]).toEqual(
      TOPOLOGY,
    );
  });

  test("reads the caller's project, the range asked for, with the caller's props", async () => {
    const props: DatabaseCommonInteractionProps = memberProps();
    await call(
      {
        startTime: "2026-11-07T11:00:00.000Z",
        endTime: "2026-11-07T12:00:00.000Z",
        // Anything project-shaped in the body is ignored.
        projectId: ObjectID.generate().toString(),
      },
      props,
    );
    const read: MessageQueueTopologyRequest = request();
    expect(read.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(read.window.startTime.toISOString()).toBe(
      "2026-11-07T11:00:00.000Z",
    );
    expect(read.window.endTime.toISOString()).toBe("2026-11-07T12:00:00.000Z");
    expect(read.props).toBe(props);
  });

  test("reads the last hour when the body names no range, from one reading of the clock", async () => {
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2026-11-07T12:00:00.000Z"));
    await call({});
    const read: MessageQueueTopologyRequest = request();
    expect(read.window.endTime.toISOString()).toBe("2026-11-07T12:00:00.000Z");
    expect(read.window.endTime.getTime() - read.window.startTime.getTime()).toBe(
      60 * 60 * 1000,
    );
  });

  test("a project-wide reader's read names no service", async () => {
    await call({});
    expect(request().serviceFilter).toEqual({
      serviceIds: undefined,
      excludedServiceIds: undefined,
    });
  });

  test("a reader limited to some services reads only those, less what a block takes away", async () => {
    getScope.mockResolvedValue({
      readableIds: [SERVICE_A.toString()],
      blockedIds: [SERVICE_B.toString()],
    } as TelemetryReadScope);
    await call({});
    expect(ids(request().serviceFilter.serviceIds)).toEqual([
      SERVICE_A.toString(),
    ]);
    expect(ids(request().serviceFilter.excludedServiceIds)).toEqual([
      SERVICE_B.toString(),
    ]);
  });

  test("a reader who may read no service's traces reads none: never every service", async () => {
    getScope.mockResolvedValue({
      readableIds: [],
      blockedIds: [],
    } as TelemetryReadScope);
    await call({});
    const serviceIds: Array<string> = ids(request().serviceFilter.serviceIds);
    expect(serviceIds).toHaveLength(1);
    expect(serviceIds[0]).toBe(ObjectID.getZeroObjectID().toString());
  });

  test("the scope is the Span model's", async () => {
    await call({});
    expect(getScope.mock.calls).toHaveLength(1);
    expect((getScope.mock.calls[0]![0] as { name: string }).name).toBe("Span");
  });

  test("an anonymous caller gets 401 before anything is read", async () => {
    const { next } = await call({}, {} as DatabaseCommonInteractionProps);
    expect(errorFrom(next)).toBeInstanceOf(NotAuthenticatedException);
    expect(getTopology.mock.calls).toHaveLength(0);
    expect(getScope.mock.calls).toHaveLength(0);
  });

  test("a request scoped to no project is refused", async () => {
    const props: DatabaseCommonInteractionProps = memberProps();
    delete props.tenantId;
    const { next } = await call({}, props);
    expect(errorFrom(next)).toBeInstanceOf(BadDataException);
    expect(getTopology.mock.calls).toHaveLength(0);
  });

  test("a request across several projects is refused", async () => {
    const { next } = await call(
      {},
      { ...memberProps(), isMultiTenantRequest: true },
    );
    expect(errorFrom(next)).toBeInstanceOf(BadDataException);
    expect(getTopology.mock.calls).toHaveLength(0);
  });

  test("a caller who may read queues but not traces is refused", async () => {
    const { next } = await call({}, memberProps([Permission.ReadMessageQueue]));
    expect(errorFrom(next)).toBeInstanceOf(NotAuthorizedException);
    expect(getTopology.mock.calls).toHaveLength(0);
  });

  test.each([
    [Permission.ProjectOwner],
    [Permission.ProjectMember],
    [Permission.Viewer],
    [Permission.TelemetryViewer],
    [Permission.ReadTelemetryServiceTraces],
  ])("a caller holding %s may read it", async (permission: Permission) => {
    const { next } = await call({}, memberProps([permission]));
    expect(next).not.toHaveBeenCalled();
    expect(getTopology.mock.calls).toHaveLength(1);
  });

  test("root reads it without a project permission", async () => {
    const { next } = await call(
      {},
      { tenantId: PROJECT_ID, isRoot: true } as DatabaseCommonInteractionProps,
    );
    expect(next).not.toHaveBeenCalled();
    expect(getTopology.mock.calls).toHaveLength(1);
  });

  const REFUSED: Array<[string, JSONObject]> = [
    ["a start that is not a date", { startTime: "soon" }],
    ["an end that is not a date", { endTime: 1762516800000 }],
    [
      "a start after its end",
      {
        startTime: "2026-11-07T12:00:00.000Z",
        endTime: "2026-11-07T11:00:00.000Z",
      },
    ],
    [
      "a range wider than 93 days",
      {
        startTime: new Date(
          Date.parse("2026-11-07T12:00:00.000Z") -
            MESSAGE_QUEUE_TOPOLOGY_MAX_RANGE_MS -
            1,
        ).toISOString(),
        endTime: "2026-11-07T12:00:00.000Z",
      },
    ],
  ];

  test.each(REFUSED)(
    "%s is refused with the reason, and nothing is read",
    async (_name: string, body: JSONObject) => {
      const { next } = await call(body);
      expect(errorFrom(next)).toBeInstanceOf(BadDataException);
      expect(getTopology.mock.calls).toHaveLength(0);
    },
  );

  test("a body that is not an object reads as no range", async () => {
    const { next } = await call(null);
    expect(next).not.toHaveBeenCalled();
    expect(getTopology.mock.calls).toHaveLength(1);
  });

  test("a failed read is handed to the error handler", async () => {
    const failure: Error = new Error("ClickHouse is away");
    getTopology.mockRejectedValue(failure);
    const { next } = await call({});
    expect(errorFrom(next)).toBe(failure);
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe("the route is mounted", () => {
  const BASE_API_INDEX: string = fs
    .readFileSync(
      path.join(__dirname, "..", "..", "FeatureSet", "BaseAPI", "Index.ts"),
      "utf8",
    )
    .replace(/\s+/g, "");

  test("BaseAPI imports the router and mounts it once under /api", () => {
    expect(BASE_API_INDEX).toContain(
      'importMessageQueueTopologyAPIfrom"./API/MessageQueueTopology";',
    );
    expect(
      BASE_API_INDEX.split("newMessageQueueTopologyAPI().getRouter()").length -
        1,
    ).toBe(1);
    expect(BASE_API_INDEX).toContain(
      "app.use(`/${APP_NAME.toLocaleLowerCase()}`,newMessageQueueTopologyAPI().getRouter(),);",
    );
  });
});
