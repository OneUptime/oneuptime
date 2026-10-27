import SecurityCaseAPI from "../../../Server/API/SecurityCaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityDetectionService from "../../../Server/Services/SecurityDetectionService";
import SecurityPlaybookRunService from "../../../Server/Services/SecurityPlaybookRunService";
import SecurityRiskiestEntitiesReader from "../../../Server/Utils/SecurityEvent/EntityRisk/SecurityRiskiestEntities";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityRiskiestEntities } from "../../../Types/SecurityCase/SecurityEntityRisk";
import { stubSecurityCaseValues } from "../../Helpers/SecurityCaseValuesStub";

/*
 * Where the Security Overview's Riskiest Entities come from, at the route:
 * POST /security-case/overview hands them over with its figures - the top
 * of Entity Risk's list, read as the caller - and the route that ranked
 * values by how many findings named them (POST /security-case/top-entities,
 * a second "riskiest" that disagreed with Entity Risk's scores) is gone, so
 * nothing in the product can draw that ranking again.
 */

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

const recordedRoutes: Array<{
  method: string;
  uri: string;
  handlers: Array<Handler>;
}> = [];

jest.mock("../../../Server/Utils/Express", () => {
  const record: (method: string) => (...args: Array<unknown>) => void = (
    method: string,
  ) => {
    return (uri: unknown, ...handlers: Array<unknown>): void => {
      recordedRoutes.push({
        method,
        uri: String(uri),
        handlers: handlers as Array<Handler>,
      });
    };
  };

  return {
    getRouter: () => {
      return {
        post: record("post"),
        get: record("get"),
        put: record("put"),
        delete: record("delete"),
      };
    },
  };
});
jest.mock("../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn() };
});

const PROJECT: ObjectID = new ObjectID("51515151-5151-4151-8151-515151515151");
const USER: ObjectID = new ObjectID("52525252-5252-4252-8252-525252525252");

const OVERVIEW: string = "/security-case/overview";

// Any route that ranked the "top entities", however its address was spelled.
const TOP_ENTITIES_ROUTE: RegExp = /top-entit/i;

const RISKIEST: SecurityRiskiestEntities = {
  threshold: 100,
  total: 3,
  entities: [
    {
      value: "k.morgan@acme-commerce.example",
      type: SecurityEntityType.User,
      score: 200,
    },
    { value: "203.0.113.47", type: SecurityEntityType.IpAddress, score: 125 },
    { value: "fin-ws-112", type: SecurityEntityType.Host, score: 113 },
  ],
};

let props: DatabaseCommonInteractionProps;
let next: jest.Mock;
const res: ExpressResponse = {} as ExpressResponse;

function setPermissions(...permissions: Array<Permission>): void {
  props.userTenantAccessPermission = {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: permissions.map((permission: Permission) => {
        return {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
    },
  } as never;
}

function routesAt(uri: string): Array<{
  method: string;
  uri: string;
  handlers: Array<Handler>;
}> {
  return recordedRoutes.filter((item: { uri: string }): boolean => {
    return item.uri === uri;
  });
}

function overviewRoute(): Handler {
  const found: Array<{ handlers: Array<Handler> }> = routesAt(OVERVIEW);
  expect(found).toHaveLength(1);
  return found[0]!.handlers[found[0]!.handlers.length - 1]!;
}

function answered(): JSONObject {
  const mock: jest.Mock = Response.sendJsonObjectResponse as jest.Mock;
  return mock.mock.calls[mock.mock.calls.length - 1]![2] as JSONObject;
}

beforeAll(() => {
  new SecurityCaseAPI();
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT };
  setPermissions(Permission.SecurityViewer);
  next = jest.fn();
  stubSecurityCaseValues();
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });
  jest.spyOn(SecurityCaseService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(SecurityDetectionService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(SecurityPlaybookRunService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("the routes the Overview's Riskiest Entities can come from", () => {
  test("the overview is one route, behind sign-in", () => {
    const found: Array<{ method: string; handlers: Array<Handler> }> =
      routesAt(OVERVIEW);

    expect(found).toHaveLength(1);
    expect(found[0]!.method).toBe("post");
    expect(found[0]!.handlers.slice(0, 2)).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });

  test("no route ranks values by how many findings named them any more", () => {
    expect(routesAt("/security-case/top-entities")).toEqual([]);
    // Nor under any other spelling of its address.
    expect(
      recordedRoutes.filter((item: { uri: string }): boolean => {
        return TOP_ENTITIES_ROUTE.test(item.uri);
      }),
    ).toEqual([]);
    // The routes were read at all: the overview's is among them.
    expect(recordedRoutes.length).toBeGreaterThan(5);
  });
});

describe("POST /security-case/overview", () => {
  test("hands over the riskiest entities with the figures, read once as the caller for the caller's project", async () => {
    const read: jest.SpyInstance = jest
      .spyOn(SecurityRiskiestEntitiesReader, "read")
      .mockResolvedValue(RISKIEST);

    await overviewRoute()(
      { params: {}, body: {} } as unknown as ExpressRequest,
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ projectId: PROJECT, props });
    expect(answered()["riskiestEntities"]).toEqual(RISKIEST);
    expect(answered()["metrics"]).toBeDefined();
  });

  test("risk that could not be read is null in the answer, and the overview is still answered", async () => {
    jest.spyOn(SecurityRiskiestEntitiesReader, "read").mockResolvedValue(null);

    await overviewRoute()(
      { params: {}, body: {} } as unknown as ExpressRequest,
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(answered()["riskiestEntities"]).toBeNull();
    expect(answered()["metrics"]).toBeDefined();
  });

  test.each([
    Permission.ProjectMember,
    Permission.ReadSecurityEvent,
    Permission.TelemetryAdmin,
  ])(
    "refuses %s before reading anything: no Security case access, no riskiest entities",
    async (permission: Permission) => {
      setPermissions(permission);
      const read: jest.SpyInstance = jest
        .spyOn(SecurityRiskiestEntitiesReader, "read")
        .mockResolvedValue(RISKIEST);

      await overviewRoute()(
        { params: {}, body: {} } as unknown as ExpressRequest,
        res,
        next,
      );

      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0]![0]).toBeInstanceOf(NotAuthorizedException);
      expect(read).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    },
  );
});
