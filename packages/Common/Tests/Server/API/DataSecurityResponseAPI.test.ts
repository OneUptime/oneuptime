import { mockRouter } from "./Helpers";
import DataSecurityAPI from "../../../Server/API/DataSecurityAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import DataSecurityResponse from "../../../Server/Utils/DataSecurity/DataSecurityResponse";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  DATA_SECURITY_API_ROUTES,
  DataSecurityResponseAvailability,
  DataSecurityResponseUnavailableReason,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataSecurityResponseAction } from "../../../Types/DataSecurity/DataSecurityResponseAction";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

/*
 * FIX IT FROM HERE, ON THE SERVER: Data Security's two response routes.
 *
 *   POST /data-store/:id/response-actions   which actions the store can take
 *                                           now, and why not - for anyone
 *                                           who may read Data Security
 *   POST /data-store/:id/respond            Block public access or Revoke
 *                                           sharing, { action,
 *                                           dataSecurityIssueId? } - for
 *                                           anyone who may edit the store
 *
 * Both refuse whoever is not a member of the project, or lacks the route's
 * permissions, before they read anything; both read only the caller's
 * project. The response itself (DataSecurityResponse) is stood in for: its
 * own suite runs it against fake clouds.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const STORE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const ISSUE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const PERMISSION_MESSAGE: string =
  "You do not have permission to do this in Data Security.";

const READ: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadDataStore,
];
const OPERATE: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditDataStore,
];

function buildProps(
  permissions: Array<Permission>,
  memberOf: ObjectID = PROJECT_ID,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: memberOf,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };
  const map: Dictionary<UserTenantAccessPermission> = {};
  map[memberOf.toString()] = tenantPermission;

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: map,
  };
}

interface RouteCall {
  thrown: unknown;
  answer: JSONObject | undefined;
}

let propsSpy: jest.SpyInstance;
let storeFindOneSpy: jest.SpyInstance;
let issueFindOneSpy: jest.SpyInstance;
let availabilitySpy: jest.SpyInstance;
let runSpy: jest.SpyInstance;
let storeRow: DataStore | null;
let issueRow: DataSecurityIssue | null;

const AVAILABILITY: DataSecurityResponseAvailability = {
  actions: [
    {
      action: DataSecurityResponseAction.BlockPublicAccess,
      isAvailable: false,
      unavailableReason: DataSecurityResponseUnavailableReason.ResponseOff,
    },
  ],
  cloudConnectionId: "55555555-5555-4555-8555-555555555555",
};

function asCaller(permissions: Array<Permission>): void {
  propsSpy.mockResolvedValue(buildProps(permissions));
}

async function call(
  path: string,
  body: JSONObject = {},
  id: string = STORE_ID.toString(),
): Promise<RouteCall> {
  const req: ExpressRequest = {
    params: { id },
    query: {},
    body,
    headers: {},
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {} as ExpressResponse;
  const next: jest.Mock = jest.fn();
  const send: jest.Mock = Response.sendJsonObjectResponse as unknown as jest.Mock;
  const before: number = send.mock.calls.length;

  await mockRouter
    .match("POST", path)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrown: next.mock.calls[0]?.[0],
    answer:
      send.mock.calls.length > before
        ? (send.mock.calls[send.mock.calls.length - 1]![2] as JSONObject)
        : undefined,
  };
}

const RESPONSE_ACTIONS: string = DATA_SECURITY_API_ROUTES.responseActions(":id");
const RESPOND: string = DATA_SECURITY_API_ROUTES.respond(":id");
const BLOCK: JSONObject = { action: DataSecurityResponseAction.BlockPublicAccess };

beforeAll(() => {
  mockRouter.routes.length = 0;
  new DataSecurityAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  storeRow = new DataStore(STORE_ID);
  issueRow = new DataSecurityIssue(ISSUE_ID);

  propsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
  asCaller([Permission.ProjectOwner]);

  storeFindOneSpy = jest
    .spyOn(DataStoreService, "findOneBy")
    .mockImplementation((async () => {
      return storeRow;
    }) as never);
  issueFindOneSpy = jest
    .spyOn(DataSecurityIssueService, "findOneBy")
    .mockImplementation((async () => {
      return issueRow;
    }) as never);
  availabilitySpy = jest
    .spyOn(DataSecurityResponse, "getAvailability")
    .mockResolvedValue(AVAILABILITY);
  runSpy = jest.spyOn(DataSecurityResponse, "run").mockResolvedValue({
    changed: true,
    summary: "Turned on Block Public Access for customer-exports.",
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the response routes and who may call them", () => {
  test("are the shared paths the Dashboard calls", () => {
    expect(DATA_SECURITY_API_ROUTES.responseActions("x")).toBe(
      "/data-store/x/response-actions",
    );
    expect(DATA_SECURITY_API_ROUTES.respond("x")).toBe("/data-store/x/respond");
  });

  test.each([RESPONSE_ACTIONS, RESPOND])(
    "%s is a POST behind the user middleware and sign-in",
    (path: string) => {
      expect(mockRouter.match("POST", path).middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
    },
  );

  test.each(READ)(
    "which actions a store can take answers a caller holding %s",
    async (permission: Permission) => {
      asCaller([permission]);

      const result: RouteCall = await call(RESPONSE_ACTIONS);

      expect(result.thrown).toBeUndefined();
      expect(result.answer).toEqual(AVAILABILITY);
      expect(availabilitySpy).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
      });
    },
  );

  test.each([Permission.ProjectMember, Permission.ReadDataSecurityIssue])(
    "which actions a store can take refuses a caller holding only %s, before reading anything",
    async (permission: Permission) => {
      asCaller([permission]);

      const result: RouteCall = await call(RESPONSE_ACTIONS);

      expect(result.thrown).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrown as Exception).message).toBe(PERMISSION_MESSAGE);
      expect(storeFindOneSpy).not.toHaveBeenCalled();
      expect(availabilitySpy).not.toHaveBeenCalled();
    },
  );

  test.each(OPERATE)(
    "a response runs for a caller holding %s, as them",
    async (permission: Permission) => {
      asCaller([permission]);

      const result: RouteCall = await call(RESPOND, BLOCK);

      expect(result.thrown).toBeUndefined();
      expect(result.answer).toEqual({
        changed: true,
        summary: "Turned on Block Public Access for customer-exports.",
      });
      expect(runSpy).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        action: DataSecurityResponseAction.BlockPublicAccess,
        userId: USER_ID,
        dataSecurityIssueId: undefined,
      });
    },
  );

  test.each([
    Permission.SecurityViewer,
    Permission.ReadDataStore,
    Permission.EditDataSecurityIssue,
    Permission.ProjectMember,
  ])(
    "a response refuses a caller holding only %s, before reading or changing anything",
    async (permission: Permission) => {
      asCaller([permission]);

      const result: RouteCall = await call(RESPOND, BLOCK);

      expect(result.thrown).toBeInstanceOf(NotAuthorizedException);
      expect(storeFindOneSpy).not.toHaveBeenCalled();
      expect(runSpy).not.toHaveBeenCalled();
    },
  );

  test.each([RESPONSE_ACTIONS, RESPOND])(
    "%s refuses an anonymous caller, and someone of another project",
    async (path: string) => {
      propsSpy.mockResolvedValue({});

      const anonymous: RouteCall = await call(path, BLOCK);

      expect(anonymous.thrown).toBeInstanceOf(NotAuthenticatedException);

      propsSpy.mockResolvedValue(
        buildProps([Permission.ProjectOwner], ObjectID.generate()),
      );

      const outsider: RouteCall = await call(path, BLOCK);

      expect(outsider.thrown).toBeInstanceOf(NotAuthorizedException);
      expect(storeFindOneSpy).not.toHaveBeenCalled();
      expect(runSpy).not.toHaveBeenCalled();
    },
  );
});

describe("which store, which action, which issue", () => {
  test("a store of another project - or none - is not found, and nothing runs", async () => {
    storeRow = null;

    const result: RouteCall = await call(RESPOND, BLOCK);

    expect(result.thrown).toBeInstanceOf(BadDataException);
    expect((result.thrown as Exception).message).toBe("Data store not found.");
    expect(storeFindOneSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: STORE_ID, projectId: PROJECT_ID },
      }),
    );
    expect(runSpy).not.toHaveBeenCalled();
  });

  test("an id that is not one is not found, before anything is read", async () => {
    const result: RouteCall = await call(RESPOND, BLOCK, "not-an-id");

    expect(result.thrown).toBeInstanceOf(BadDataException);
    expect(storeFindOneSpy).not.toHaveBeenCalled();
  });

  test.each([undefined, "", "Delete the bucket", 7])(
    "an action that is not one of the two (%p) is refused, and nothing runs",
    async (action: unknown) => {
      const result: RouteCall = await call(
        RESPOND,
        action === undefined ? {} : ({ action } as JSONObject),
      );

      expect(result.thrown).toBeInstanceOf(BadDataException);
      expect((result.thrown as Exception).message).toBe(
        'Choose "Block public access" or "Revoke sharing".',
      );
      expect(runSpy).not.toHaveBeenCalled();
    },
  );

  test("Revoke sharing runs as asked", async () => {
    await call(RESPOND, { action: DataSecurityResponseAction.RevokeSharing });

    expect(runSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: DataSecurityResponseAction.RevokeSharing,
      }),
    );
  });

  test("run from one of the store's issues, its timeline is told", async () => {
    const result: RouteCall = await call(RESPOND, {
      ...BLOCK,
      dataSecurityIssueId: ISSUE_ID.toString(),
    });

    expect(result.thrown).toBeUndefined();
    expect(issueFindOneSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          _id: ISSUE_ID,
          projectId: PROJECT_ID,
          dataStoreId: STORE_ID,
        },
      }),
    );
    expect(runSpy).toHaveBeenCalledWith(
      expect.objectContaining({ dataSecurityIssueId: ISSUE_ID }),
    );
  });

  test("an issue of another store, or another project, is not found: its timeline never claims the change", async () => {
    issueRow = null;

    const result: RouteCall = await call(RESPOND, {
      ...BLOCK,
      dataSecurityIssueId: ISSUE_ID.toString(),
    });

    expect(result.thrown).toBeInstanceOf(BadDataException);
    expect((result.thrown as Exception).message).toBe("Issue not found.");
    expect(runSpy).not.toHaveBeenCalled();
  });

  test.each(["not-an-id", 12, true])(
    "an issue id that is not one (%p) is not found, before anything changes",
    async (value: unknown) => {
      const result: RouteCall = await call(RESPOND, {
        ...BLOCK,
        dataSecurityIssueId: value,
      } as JSONObject);

      expect(result.thrown).toBeInstanceOf(BadDataException);
      expect(issueFindOneSpy).not.toHaveBeenCalled();
      expect(runSpy).not.toHaveBeenCalled();
    },
  );

  test("what the response says goes back as it is: a refusal from the store's connection too", async () => {
    runSpy.mockRejectedValue(
      new BadDataException(
        'Turn on "Data security response" on the store\'s cloud connection and run its updated setup command: it grants the narrow write role this needs.',
      ),
    );

    const result: RouteCall = await call(RESPOND, BLOCK);

    expect(result.thrown).toBeInstanceOf(BadDataException);
    expect((result.thrown as Exception).message).toContain(
      'Turn on "Data security response"',
    );
    expect(result.answer).toBeUndefined();
  });
});
