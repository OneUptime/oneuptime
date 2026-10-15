import CommonAPI from "../../../Server/API/CommonAPI";
import ProjectAPI, {
  getNumberingReadPermissions,
} from "../../../Server/API/ProjectAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ProjectService from "../../../Server/Services/ProjectService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import Project from "../../../Models/DatabaseModels/Project";
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
  NUMBERED_RECORD_KINDS,
  NumberedRecordKind,
  NumberedRecordKindInfo,
  RecordNumbering,
} from "../../../Utils/Project/NextNumber";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * GET /project/:id/numbering
 *
 * Where each kind of number stands in the project - its prefix, the
 * highest number given out and the number the next record gets - for the
 * Numbering pages' Next Number card. The counters behind it are no caller's
 * to read through the model API, so the answer is read as OneUptime and the
 * route asks for itself: credentials, a member or API key of the project
 * the URL names, and a permission that reads where the project's numbers
 * start. It reads nothing until all three hold, and is never cached.
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
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

const ROUTE: string = "/project/:id/numbering";

const NUMBERING: Array<RecordNumbering> = [
  {
    kind: NumberedRecordKind.Incident,
    prefix: "INC-",
    highestNumber: 2345,
    nextNumber: 10000,
    numbersStartAt: 10000,
  },
  {
    kind: NumberedRecordKind.IncidentEpisode,
    prefix: "IE-",
    highestNumber: 0,
    nextNumber: 1,
    numbersStartAt: null,
  },
  {
    kind: NumberedRecordKind.Alert,
    prefix: null,
    highestNumber: 41,
    nextNumber: 42,
    numbersStartAt: null,
  },
  {
    kind: NumberedRecordKind.AlertEpisode,
    prefix: "AE-",
    highestNumber: 3,
    nextNumber: 4,
    numbersStartAt: 2,
  },
  {
    kind: NumberedRecordKind.ScheduledMaintenance,
    prefix: "SM-",
    highestNumber: 7,
    nextNumber: 8,
    numbersStartAt: null,
  },
];

function grants(
  permissions: Array<Permission>,
  isBlockPermission: boolean,
): Array<UserPermission> {
  return permissions.map((permission: Permission): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: isBlockPermission,
    };
  });
}

function buildProps(data: {
  projectId: ObjectID;
  permissions: Array<Permission>;
  blocks?: Array<Permission> | undefined;
  isApiKey?: boolean | undefined;
}): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: [
      ...grants(data.permissions, false),
      ...grants(data.blocks || [], true),
    ],
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[data.projectId.toString()] = tenantPermission;

  if (data.isApiKey) {
    return {
      tenantId: data.projectId,
      userType: UserType.API,
      userTenantAccessPermission: permissionMap,
    };
  }

  return {
    tenantId: data.projectId,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

interface RouteCallResult {
  thrownToNext: unknown;
  nextCallCount: number;
  res: ExpressResponse;
}

async function callRoute(id: string): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: { id: id },
    query: {},
    body: {},
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("GET", ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
    res: res,
  };
}

describe("GET /project/:id/numbering", () => {
  let projectId: ObjectID;
  let propsSpy: jest.SpyInstance;
  let numberingSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new ProjectAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();

    propsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
    numberingSpy = jest
      .spyOn(ProjectService, "getNumbering")
      .mockResolvedValue(NUMBERING);

    mockCaller([Permission.ProjectAdmin]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockCaller(
    permissions: Array<Permission>,
    blocks?: Array<Permission>,
  ): void {
    propsSpy.mockResolvedValue(
      buildProps({
        projectId: projectId,
        permissions: permissions,
        blocks: blocks,
      }),
    );
  }

  function sentBody(): JSONObject {
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    return (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
      .calls[0]![2] as JSONObject;
  }

  function expectNothingRead(): void {
    expect(numberingSpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  }

  test("is mounted behind getUserMiddleware", () => {
    expect(mockRouter.match("GET", ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
  });

  test("tells a member where each kind of number stands in their project, uncached", async () => {
    const result: RouteCallResult = await callRoute(projectId.toString());

    expect(result.nextCallCount).toBe(0);
    expect(numberingSpy).toHaveBeenCalledTimes(1);
    expect((numberingSpy.mock.calls[0]![0] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(result.res);
    expect(sentBody()).toEqual({
      numbering: [
        {
          kind: "Incident",
          prefix: "INC-",
          highestNumber: 2345,
          nextNumber: 10000,
          numbersStartAt: 10000,
        },
        {
          kind: "IncidentEpisode",
          prefix: "IE-",
          highestNumber: 0,
          nextNumber: 1,
          numbersStartAt: null,
        },
        {
          kind: "Alert",
          prefix: null,
          highestNumber: 41,
          nextNumber: 42,
          numbersStartAt: null,
        },
        {
          kind: "AlertEpisode",
          prefix: "AE-",
          highestNumber: 3,
          nextNumber: 4,
          numbersStartAt: 2,
        },
        {
          kind: "ScheduledMaintenance",
          prefix: "SM-",
          highestNumber: 7,
          nextNumber: 8,
          numbersStartAt: null,
        },
      ],
    });
  });

  test("names the project the same however its id is cased", async () => {
    const result: RouteCallResult = await callRoute(
      projectId.toString().toUpperCase(),
    );

    expect(result.nextCallCount).toBe(0);
    expect(numberingSpy).toHaveBeenCalledTimes(1);
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadProject,
  ])("answers a %s", async (permission: Permission) => {
    mockCaller([permission]);

    const result: RouteCallResult = await callRoute(projectId.toString());

    expect(result.nextCallCount).toBe(0);
    expect(numberingSpy).toHaveBeenCalledTimes(1);
  });

  test("answers the project's API key that may read the project", async () => {
    propsSpy.mockResolvedValue(
      buildProps({
        projectId: projectId,
        permissions: [Permission.ReadProject],
        isApiKey: true,
      }),
    );

    const result: RouteCallResult = await callRoute(projectId.toString());

    expect(result.nextCallCount).toBe(0);
    expect(numberingSpy).toHaveBeenCalledTimes(1);
  });

  test("refuses an unauthenticated caller with a 401, before reading anything", async () => {
    propsSpy.mockResolvedValue({});

    const result: RouteCallResult = await callRoute(projectId.toString());

    expect(result.thrownToNext).toBeInstanceOf(NotAuthenticatedException);
    expectNothingRead();
  });

  test("refuses a caller with no project, before reading anything", async () => {
    propsSpy.mockResolvedValue({
      userId: ObjectID.generate(),
      userType: UserType.User,
    });

    const result: RouteCallResult = await callRoute(projectId.toString());

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect((result.thrownToNext as Exception).message).toBe(
      "Project ID is required",
    );
    expectNothingRead();
  });

  test("refuses someone who is not a member of the project they named", async () => {
    const props: DatabaseCommonInteractionProps = buildProps({
      projectId: ObjectID.generate(),
      permissions: [Permission.ProjectOwner],
    });
    props.tenantId = projectId;
    propsSpy.mockResolvedValue(props);

    const result: RouteCallResult = await callRoute(projectId.toString());

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expectNothingRead();
  });

  /*
   * The tenant comes from the caller's own header: an owner of project A
   * must not read project B's numbers by putting B's id in the URL.
   */
  test("refuses a URL that names another project than the caller's", async () => {
    mockCaller([Permission.ProjectOwner]);

    const result: RouteCallResult = await callRoute(
      ObjectID.generate().toString(),
    );

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expectNothingRead();
  });

  test("refuses a URL whose id is not a project id", async () => {
    for (const id of ["1", "not-an-id", ""]) {
      jest.clearAllMocks();

      const result: RouteCallResult = await callRoute(id);

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expectNothingRead();
    }
  });

  test("refuses a member who may not read the project's settings", async () => {
    mockCaller([Permission.ReadProjectIncident, Permission.IncidentMember]);

    const result: RouteCallResult = await callRoute(projectId.toString());

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as Exception).message).toBe(
      "You do not have permission to read this project's numbering.",
    );
    expectNothingRead();
  });

  test("refuses a member whose team is blocked from reading the project", async () => {
    mockCaller([Permission.ReadProject], [Permission.ReadProject]);

    const result: RouteCallResult = await callRoute(projectId.toString());

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expectNothingRead();
  });
});

describe("who may read the numbering", () => {
  test("whoever may read where numbers start, of every kind, and nobody else", () => {
    const project: Project = new Project();

    for (const info of NUMBERED_RECORD_KINDS as ReadonlyArray<NumberedRecordKindInfo>) {
      expect(project.getColumnAccessControlFor(info.startsAtColumn)?.read).toEqual(
        getNumberingReadPermissions(),
      );
    }

    expect(getNumberingReadPermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
    ]);
  });
});
