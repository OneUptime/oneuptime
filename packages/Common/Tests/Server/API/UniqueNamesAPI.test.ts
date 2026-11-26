import CommonAPI from "../../../Server/API/CommonAPI";
import {
  getRequiredUniqueNameServices,
  getServiceOfTable,
} from "../../../Server/API/UniqueNamesAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import BaseService from "../../../Server/Services/BaseService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import LabelService from "../../../Server/Services/LabelService";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import MonitorService from "../../../Server/Services/MonitorService";
import TableViewService from "../../../Server/Services/TableViewService";
import RequiredUniqueNames from "../../../Server/Utils/Database/RequiredUniqueNames";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Dictionary from "../../../Types/Dictionary";
import {
  DuplicateNamesOfKind,
  UNIQUE_NAME_CHECK_ROUTE,
  UNIQUE_NAME_DUPLICATES_ROUTE,
  UniqueNameCheckAnswer,
} from "../../../Types/Database/RequiredUniqueNames";
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

/*
 * GET /unique-names/check and GET /unique-names/duplicates (#10761): the
 * Dashboard's warning as a form takes a name another record has, and the
 * names a project holds twice, listed beside Require Unique Names.
 *
 * Both ask for an authenticated member of the request's project, or a
 * project API key, before anything is read; the project is the request's
 * own; records are read with the caller's own props, never as root; a kind
 * whose names repeat freely is no kind of the check; a caller who may not
 * read a kind is refused its check; and nothing is cached.
 */

jest.mock("../../../Server/Utils/Express", () => {
  const helpers: typeof import("./Helpers") =
    jest.requireActual<typeof import("./Helpers")>("./Helpers");

  return {
    getRouter: () => {
      return helpers.mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

/*
 * The registry the routes walk, kept to a few services: two kinds the
 * setting holds, a kind unique always, and two whose names repeat.
 */
jest.mock("../../../Server/Services/Index", () => {
  return {
    __esModule: true,
    default: [
      jest.requireActual<{ default: unknown }>(
        "../../../Server/Services/MonitorGroupService",
      ).default,
      jest.requireActual<{ default: unknown }>(
        "../../../Server/Services/IncidentTemplateService",
      ).default,
      jest.requireActual<{ default: unknown }>(
        "../../../Server/Services/LabelService",
      ).default,
      jest.requireActual<{ default: unknown }>(
        "../../../Server/Services/TableViewService",
      ).default,
      jest.requireActual<{ default: unknown }>(
        "../../../Server/Services/IncidentService",
      ).default,
    ],
  };
});

function buildProps(data: {
  projectId: ObjectID;
  userId?: ObjectID | undefined;
  userType?: UserType | undefined;
  permissions: Array<Permission>;
  accessTo?: ObjectID | undefined;
}): DatabaseCommonInteractionProps {
  const accessTo: ObjectID = data.accessTo || data.projectId;
  const permissionMap: Dictionary<UserTenantAccessPermission> = {
    [accessTo.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: accessTo,
      permissions: data.permissions.map(
        (permission: Permission): UserPermission => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        },
      ),
    },
  };

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userType: data.userType || UserType.User,
    userTenantAccessPermission: permissionMap,
    /*
     * A request's props carry its project's plan where billing is on, as
     * it is in CI (CallerPlan.withPlan): one that holds every kind asked
     * about here, so what a test refuses is the caller, never the plan.
     */
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  } as DatabaseCommonInteractionProps;
}

interface RouteCallResult {
  thrownToNext: unknown;
  nextCallCount: number;
  res: ExpressResponse;
}

async function callRoute(
  route: string,
  query: Record<string, unknown> = {},
): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: {},
    query: query,
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
    .match("GET", route)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
    res: res,
  };
}

function answered(): JSONObject {
  return (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
    .calls[0]![2] as JSONObject;
}

let projectId: ObjectID;
let userId: ObjectID;

beforeEach(() => {
  jest.clearAllMocks();
  projectId = ObjectID.generate();
  userId = ObjectID.generate();

  jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps").mockResolvedValue(
    buildProps({
      projectId,
      userId,
      permissions: [Permission.ProjectMember],
    }),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /unique-names/check", () => {
  const FREE: UniqueNameCheckAnswer = {
    isRequired: true,
    takenBy: {
      id: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
      name: "Production",
      isArchived: false,
    },
    isTakenByUnreadable: false,
  };

  let checkSpy: jest.SpyInstance;

  beforeEach(() => {
    checkSpy = jest
      .spyOn(RequiredUniqueNames, "checkName")
      .mockResolvedValue(FREE);
  });

  test("is a read, mounted behind getUserMiddleware", () => {
    expect(
      mockRouter.match("GET", UNIQUE_NAME_CHECK_ROUTE).middlewares,
    ).toEqual([UserMiddleware.getUserMiddleware]);
  });

  test("checks a kind the setting holds with the caller's own props, uncached", async () => {
    const exceptId: string = ObjectID.generate().toString();

    const result: RouteCallResult = await callRoute(UNIQUE_NAME_CHECK_ROUTE, {
      tableName: "MonitorGroup",
      name: "  production ",
      exceptId: exceptId,
    });

    expect(result.nextCallCount).toBe(0);
    expect(checkSpy).toHaveBeenCalledTimes(1);

    const call: {
      service: unknown;
      rule: { column: string; isAlwaysUnique: boolean };
      projectId: ObjectID;
      name: string;
      exceptId: ObjectID | null;
      props: DatabaseCommonInteractionProps;
    } = checkSpy.mock.calls[0]![0];

    expect(call.service).toBe(MonitorGroupService);
    expect(call.rule).toEqual({ column: "name", isAlwaysUnique: false });
    expect(call.projectId.toString()).toBe(projectId.toString());
    expect(call.name).toBe("  production ");
    expect(call.exceptId?.toString()).toBe(exceptId);
    expect(call.props.userId?.toString()).toBe(userId.toString());
    expect(call.props.isRoot).toBeFalsy();

    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(result.res);
    expect(answered()).toEqual({
      isRequired: true,
      takenBy: {
        id: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
        name: "Production",
        isArchived: false,
      },
      isTakenByUnreadable: false,
    });
  });

  test("checks a template by its template name", async () => {
    await callRoute(UNIQUE_NAME_CHECK_ROUTE, {
      tableName: "IncidentTemplate",
      name: "Outage",
    });

    expect(checkSpy.mock.calls[0]![0].service).toBe(IncidentTemplateService);
    expect(checkSpy.mock.calls[0]![0].rule).toEqual({
      column: "templateName",
      isAlwaysUnique: false,
    });
  });

  test("checks a kind unique always too, as one a save would refuse", async () => {
    await callRoute(UNIQUE_NAME_CHECK_ROUTE, {
      tableName: "Label",
      name: "Production",
    });

    expect(checkSpy.mock.calls[0]![0].service).toBe(LabelService);
    expect(checkSpy.mock.calls[0]![0].rule).toEqual({
      column: "name",
      isAlwaysUnique: true,
    });
  });

  test("leaves out an edited record's id that is no id", async () => {
    await callRoute(UNIQUE_NAME_CHECK_ROUTE, {
      tableName: "MonitorGroup",
      name: "Production",
      exceptId: "not-an-id",
    });

    expect(checkSpy.mock.calls[0]![0].exceptId).toBeNull();
  });

  test("reads a name no longer than any column holds", async () => {
    await callRoute(UNIQUE_NAME_CHECK_ROUTE, {
      tableName: "MonitorGroup",
      name: "x".repeat(5000),
    });

    expect(checkSpy.mock.calls[0]![0].name).toHaveLength(1000);
  });

  test.each(["TableView", "Incident", "Monitor", "", "monitorgroup"])(
    "a kind whose names repeat, or one it does not know (%j), is nothing to check, and nothing is read",
    async (tableName: string) => {
      const result: RouteCallResult = await callRoute(UNIQUE_NAME_CHECK_ROUTE, {
        tableName: tableName,
        name: "Production",
      });

      expect(result.thrownToNext).toBeInstanceOf(NotFoundException);
      expect(checkSpy).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    },
  );

  test("a caller who may not read the kind is refused, as a list of it would be", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(
        buildProps({
          projectId,
          userId,
          permissions: [Permission.ReadAuditLog],
        }),
      );

    const result: RouteCallResult = await callRoute(UNIQUE_NAME_CHECK_ROUTE, {
      tableName: "MonitorGroup",
      name: "Production",
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(checkSpy).not.toHaveBeenCalled();
  });

  test("someone who is not a member of the request's project is refused, and nothing is read", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(
        buildProps({
          projectId,
          userId,
          permissions: [Permission.ProjectMember],
          accessTo: ObjectID.generate(),
        }),
      );

    const result: RouteCallResult = await callRoute(UNIQUE_NAME_CHECK_ROUTE, {
      tableName: "MonitorGroup",
      name: "Production",
    });

    expect(
      result.thrownToNext instanceof NotAuthenticatedException ||
        result.thrownToNext instanceof NotAuthorizedException,
    ).toBe(true);
    expect(checkSpy).not.toHaveBeenCalled();
  });

  test("a project API key may ask too", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(
        buildProps({
          projectId,
          userType: UserType.API,
          permissions: [Permission.ProjectMember],
        }),
      );

    const result: RouteCallResult = await callRoute(UNIQUE_NAME_CHECK_ROUTE, {
      tableName: "MonitorGroup",
      name: "Production",
    });

    expect(result.nextCallCount).toBe(0);
    expect(checkSpy).toHaveBeenCalledTimes(1);
  });
});

describe("GET /unique-names/duplicates", () => {
  const GROUPS: DuplicateNamesOfKind = {
    tableName: "MonitorGroup",
    pluralName: "Monitor Groups",
    groupCount: 1,
    groups: [
      {
        name: "Production",
        count: 2,
        records: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            name: "Production",
            createdAt: null,
            isArchived: false,
          },
          {
            id: "00000000-0000-4000-8000-000000000002",
            name: "production",
            createdAt: null,
            isArchived: false,
          },
        ],
      },
    ],
  };

  let findSpy: jest.SpyInstance;

  beforeEach(() => {
    findSpy = jest
      .spyOn(RequiredUniqueNames, "findDuplicatesOfKind")
      .mockImplementation((async (data: {
        service: unknown;
      }): Promise<DuplicateNamesOfKind | null> => {
        return data.service === MonitorGroupService ? GROUPS : null;
      }) as never);

    jest
      .spyOn(RequiredUniqueNames, "isRequiredInProject")
      .mockResolvedValue(false);
  });

  test("is a read, mounted behind getUserMiddleware", () => {
    expect(
      mockRouter.match("GET", UNIQUE_NAME_DUPLICATES_ROUTE).middlewares,
    ).toEqual([UserMiddleware.getUserMiddleware]);
  });

  test("walks the kinds the setting holds, each once, with the caller's own props, uncached", async () => {
    const result: RouteCallResult = await callRoute(
      UNIQUE_NAME_DUPLICATES_ROUTE,
    );

    expect(result.nextCallCount).toBe(0);

    const services: Array<unknown> = findSpy.mock.calls.map(
      (call: Array<unknown>): unknown => {
        return (call[0] as { service: unknown }).service;
      },
    );

    expect(services).toEqual([IncidentTemplateService, MonitorGroupService]);

    for (const call of findSpy.mock.calls) {
      const asked: {
        projectId: ObjectID;
        props: DatabaseCommonInteractionProps;
      } = call[0];

      expect(asked.projectId.toString()).toBe(projectId.toString());
      expect(asked.props.userId?.toString()).toBe(userId.toString());
      expect(asked.props.isRoot).toBeFalsy();
    }

    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(result.res);
    expect(answered()).toEqual({
      requireUniqueNames: false,
      kinds: [
        {
          tableName: "MonitorGroup",
          pluralName: "Monitor Groups",
          groupCount: 1,
          groups: [
            {
              name: "Production",
              count: 2,
              records: [
                {
                  id: "00000000-0000-4000-8000-000000000001",
                  name: "Production",
                  createdAt: null,
                  isArchived: false,
                },
                {
                  id: "00000000-0000-4000-8000-000000000002",
                  name: "production",
                  createdAt: null,
                  isArchived: false,
                },
              ],
            },
          ],
        },
      ],
    });
  });

  test("says whether the project requires unique names now", async () => {
    jest
      .spyOn(RequiredUniqueNames, "isRequiredInProject")
      .mockResolvedValue(true);

    await callRoute(UNIQUE_NAME_DUPLICATES_ROUTE);

    expect(answered()["requireUniqueNames"]).toBe(true);
  });

  test("someone who is not a member of the request's project is refused, and nothing is read", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(
        buildProps({
          projectId,
          userId,
          permissions: [Permission.ProjectMember],
          accessTo: ObjectID.generate(),
        }),
      );

    const result: RouteCallResult = await callRoute(
      UNIQUE_NAME_DUPLICATES_ROUTE,
    );

    expect(result.thrownToNext).toBeTruthy();
    expect(findSpy).not.toHaveBeenCalled();
  });
});

describe("the registry the routes walk", () => {
  const services: Array<BaseService> = [
    MonitorGroupService,
    MonitorService,
    TableViewService,
    LabelService,
    IncidentTemplateService,
    MonitorGroupService,
  ];

  test("finds a kind by its table", () => {
    expect(getServiceOfTable(services, "TableView")).toBe(TableViewService);
    expect(getServiceOfTable(services, "Nope")).toBeNull();
    expect(getServiceOfTable(services, "")).toBeNull();
  });

  test("walks the kinds the setting holds, each once, by their table's name", () => {
    expect(getRequiredUniqueNameServices(services)).toEqual([
      IncidentTemplateService,
      MonitorService,
      MonitorGroupService,
    ]);
  });
});
