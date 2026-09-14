import GoogleSecOpsConnectionAPI from "../../../Server/API/GoogleSecOpsConnectionAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import GoogleSecOpsConnection from "../../../Models/DatabaseModels/GoogleSecOpsConnection";
import GoogleSecOpsConnectionService from "../../../Server/Services/GoogleSecOpsConnectionService";
import GoogleSecOpsRunExecutor from "../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsRunExecutor";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

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
  "../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsPoller",
  () => {
    return { __esModule: true, default: {} };
  },
);

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUN: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
let props: DatabaseCommonInteractionProps;
let handler: Handler;
let next: jest.Mock;
let req: ExpressRequest;
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

beforeAll(() => {
  new GoogleSecOpsConnectionAPI();
  handler = recordedRoutes
    .find((route: { uri: string }) => {
      return route.uri === "/google-secops-connection/:connectionId/run";
    })!
    .handlers.slice(-1)[0]!;
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
  const connection: GoogleSecOpsConnection = new GoogleSecOpsConnection();
  connection.id = CONNECTION;
  connection.projectId = PROJECT;
  jest
    .spyOn(GoogleSecOpsConnectionService, "findOneBy")
    .mockResolvedValue(connection);
  jest
    .spyOn(GoogleSecOpsConnectionService, "findOneById")
    .mockResolvedValue(null);
  jest.spyOn(GoogleSecOpsRunExecutor, "enqueue").mockResolvedValue(RUN);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test("registers both user resolution and required authentication before the operation", () => {
  const route: { uri: string; handlers: Array<Handler> } = recordedRoutes.find(
    (item: { uri: string }) => {
      return item.uri.endsWith("/:connectionId/run");
    },
  )!;
  expect(route.handlers.slice(0, 2)).toEqual([
    UserMiddleware.getUserMiddleware,
    UserMiddleware.requireUserAuthentication,
  ]);
});

test.each([
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
])(
  "allows %s and reads no credentials in the API process",
  async (permission: Permission) => {
    setPermission(permission);
    await handler(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(GoogleSecOpsConnectionService.findOneBy).toHaveBeenCalledWith({
      query: { _id: CONNECTION.toString(), projectId: PROJECT },
      select: { _id: true, projectId: true },
      props,
    });
    expect(GoogleSecOpsConnectionService.findOneById).not.toHaveBeenCalled();
    expect(GoogleSecOpsRunExecutor.enqueue).toHaveBeenCalledWith({
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
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(GoogleSecOpsConnectionService.findOneBy).not.toHaveBeenCalled();
    expect(GoogleSecOpsRunExecutor.enqueue).not.toHaveBeenCalled();
  },
);

test.each([
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
])("never treats blocked %s as a grant", async (permission: Permission) => {
  setPermission(permission, true);
  await handler(req, res, next);
  expect(next).toHaveBeenCalledWith(expect.any(Error));
  expect(GoogleSecOpsRunExecutor.enqueue).not.toHaveBeenCalled();
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
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(GoogleSecOpsConnectionService.findOneBy).not.toHaveBeenCalled();
    expect(GoogleSecOpsRunExecutor.enqueue).not.toHaveBeenCalled();
  },
);

test.each([null, OTHER])(
  "rejects missing/foreign resource project %s even with a forged route ID",
  async (projectId: ObjectID | null) => {
    const connection: GoogleSecOpsConnection = new GoogleSecOpsConnection();
    if (projectId) {
      connection.projectId = projectId;
    }
    (GoogleSecOpsConnectionService.findOneBy as jest.Mock).mockResolvedValue(
      projectId ? connection : null,
    );
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(GoogleSecOpsRunExecutor.enqueue).not.toHaveBeenCalled();
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
  await handler(req, res, next);
  expect(next).toHaveBeenCalledWith(expect.any(Error));
  expect(GoogleSecOpsRunExecutor.enqueue).not.toHaveBeenCalled();
});

test.each(["", "not-a-uuid"])(
  "rejects malformed connection ID %s",
  async (id: string) => {
    req.params["connectionId"] = id;
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(GoogleSecOpsConnectionService.findOneBy).not.toHaveBeenCalled();
  },
);

test("propagates admission failure instead of reporting a queued run", async () => {
  (GoogleSecOpsRunExecutor.enqueue as jest.Mock).mockRejectedValue(
    new Error("Queue unavailable"),
  );
  await handler(req, res, next);
  expect(next).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Queue unavailable" }),
  );
  expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
});
