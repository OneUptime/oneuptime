import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import ModelPermission from "Common/Server/Types/Database/Permissions/Index";
import ownerTableRegistry from "Common/Server/Types/Database/Permissions/OwnerTableRegistry";
import Response from "Common/Server/Utils/Response";
import TopologyQueries from "Common/Server/Utils/Topology/TopologyQueries";
import TopologyResponseCache from "Common/Server/Utils/Topology/TopologyResponseCache";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import { TopologyApiPath } from "Common/Types/Topology/TopologyApi";
import EntityType from "Common/Types/Telemetry/EntityType";
import UserType from "Common/Types/UserType";
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
      sendJsonStringResponse: jest.fn(),
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

/*
 * The SQL is replaced: what is under test is the gate in front of it (who
 * may ask, about which project, with what body), the cache between the gate
 * and the SQL, and what is sent back.
 */
jest.mock("Common/Server/Utils/Topology/TopologyQueries", () => {
  return {
    __esModule: true,
    default: {
      getServiceMap: jest.fn(),
      getInfrastructure: jest.fn(),
      getCollectionPage: jest.fn(),
      getCollectionSearch: jest.fn(),
      getEntity: jest.fn(),
      getEntityConnections: jest.fn(),
    },
  };
});

// Importing the module registers its routes on the mocked router.
import TopologyAPI from "../../FeatureSet/BaseAPI/API/Topology";

new TopologyAPI().getRouter();

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const RANGE_START: string = new Date(
  Math.floor((Date.now() - 3600_000) / 60_000) * 60_000 + 42_123,
).toISOString();
const FLOORED: Date = new Date(
  Math.floor(Date.parse(RANGE_START) / 60_000) * 60_000,
);

type QueryName =
  | "getServiceMap"
  | "getInfrastructure"
  | "getCollectionPage"
  | "getCollectionSearch"
  | "getEntity"
  | "getEntityConnections";

const queries: Record<QueryName, jest.Mock> =
  TopologyQueries as unknown as Record<QueryName, jest.Mock>;
const responseUtil: { sendJsonStringResponse: jest.Mock } =
  Response as unknown as { sendJsonStringResponse: jest.Mock };

interface RouteCase {
  path: TopologyApiPath;
  query: QueryName;
  body: JSONObject;
  readsRelationships: boolean;
  cached: boolean;
}

const ROUTES: Array<RouteCase> = [
  {
    path: TopologyApiPath.ServiceMap,
    query: "getServiceMap",
    body: { rangeStart: RANGE_START },
    readsRelationships: true,
    cached: true,
  },
  {
    path: TopologyApiPath.Infrastructure,
    query: "getInfrastructure",
    body: { rangeStart: RANGE_START },
    readsRelationships: true,
    cached: true,
  },
  {
    path: TopologyApiPath.InfrastructureCollection,
    query: "getCollectionPage",
    body: {
      rangeStart: RANGE_START,
      entityType: EntityType.NetworkDevice,
      includeInactive: false,
      nameTerms: [" Core "],
    },
    readsRelationships: false,
    cached: false,
  },
  {
    path: TopologyApiPath.InfrastructureCollectionSearch,
    query: "getCollectionSearch",
    body: {
      rangeStart: RANGE_START,
      includeInactive: true,
      types: [{ entityType: EntityType.IoTDevice, nameTerms: ["pump"] }],
    },
    readsRelationships: false,
    cached: false,
  },
  {
    path: TopologyApiPath.Entity,
    query: "getEntity",
    body: { rangeStart: RANGE_START, entityKey: "svc-a" },
    readsRelationships: true,
    cached: false,
  },
  {
    path: TopologyApiPath.EntityConnections,
    query: "getEntityConnections",
    body: {
      rangeStart: RANGE_START,
      entityKey: "svc-a",
      section: "calls",
      offset: 100,
    },
    readsRelationships: true,
    cached: false,
  },
];

function tenantPermissions(
  projectId: ObjectID,
  permissions: Array<Permission>,
): Record<string, UserTenantAccessPermission> {
  return {
    [projectId.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: projectId,
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
  projectId: ObjectID = PROJECT_ID,
  permissions: Array<Permission> = [Permission.TelemetryViewer],
): DatabaseCommonInteractionProps {
  return {
    tenantId: projectId,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: tenantPermissions(projectId, permissions),
  };
}

let propsForRequest: DatabaseCommonInteractionProps = memberProps();
/*
 * Structurally typed rather than as jest.SpiedFunction: @jest/globals and
 * @types/jest disagree on the spy's shape (the repo's idiom, see
 * NetworkDeviceTopologyEndpointAdoptionAPI.test.ts).
 */
type PermissionCheckSpy = {
  mock: { calls: Array<Array<unknown>> };
  mockRejectedValue: (error: Error) => void;
  mockRestore: () => void;
};

let permissionCheck: PermissionCheckSpy;

async function call(
  route: string,
  body: unknown,
  props: DatabaseCommonInteractionProps = propsForRequest,
): Promise<{ next: jest.Mock; res: ExpressResponse; req: ExpressRequest }> {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);
  const next: jest.Mock = jest.fn() as unknown as jest.Mock;
  const req: ExpressRequest = { body } as unknown as ExpressRequest;
  const res: ExpressResponse = {} as ExpressResponse;
  await mockRouter
    .match("post", route)
    .handlerFunction(req, res, next as unknown as NextFunction);
  return { next, res, req };
}

function errorFrom(next: jest.Mock): Error {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0]![0] as Error;
}

function sentJson(index: number = 0): unknown {
  const sent: Array<unknown> | undefined =
    responseUtil.sendJsonStringResponse.mock.calls[index];
  expect(sent).toBeDefined();
  expect(typeof sent![2]).toBe("string");
  return JSON.parse(sent![2] as string);
}

function expectNothingRead(): void {
  for (const query of Object.values(queries)) {
    expect(query).not.toHaveBeenCalled();
  }
  expect(responseUtil.sendJsonStringResponse).not.toHaveBeenCalled();
}

describe("Topology API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    TopologyResponseCache.clear();
    propsForRequest = memberProps();
    permissionCheck = jest
      .spyOn(ModelPermission, "checkReadQueryPermission")
      .mockResolvedValue({
        query: {},
        select: null,
        relationSelect: null,
      } as never) as unknown as PermissionCheckSpy;
    for (const [name, query] of Object.entries(queries)) {
      query.mockImplementation(async (): Promise<JSONObject> => {
        return { from: name };
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("every route is a POST behind getUserMiddleware alone", () => {
    for (const route of ROUTES) {
      expect(mockRouter.match("post", route.path).middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
      ]);
    }
    expect(
      mockRouter.routes
        .filter((registered: { uri: string }): boolean => {
          return registered.uri.startsWith("/telemetry/topology");
        })
        .map((registered: { uri: string }): string => {
          return registered.uri;
        })
        .sort(),
    ).toEqual(Object.values(TopologyApiPath).sort());
  });

  describe.each(ROUTES)("$path", (route: RouteCase) => {
    test("answers with the query's result as a JSON string", async () => {
      const { next, req, res } = await call(route.path, route.body);
      expect(next).not.toHaveBeenCalled();
      expect(queries[route.query]).toHaveBeenCalledTimes(1);
      expect(responseUtil.sendJsonStringResponse).toHaveBeenCalledTimes(1);
      expect(responseUtil.sendJsonStringResponse.mock.calls[0]![0]).toBe(req);
      expect(responseUtil.sendJsonStringResponse.mock.calls[0]![1]).toBe(res);
      expect(sentJson()).toEqual({ from: route.query });
    });

    test("an anonymous caller gets 401 before anything is checked or read", async () => {
      const { next } = await call(
        route.path,
        { nonsense: true },
        { tenantId: PROJECT_ID, userType: UserType.Public },
      );
      const error: Error = errorFrom(next);
      expect(error).toBeInstanceOf(NotAuthenticatedException);
      expect(permissionCheck).not.toHaveBeenCalled();
      expectNothingRead();
    });

    test("a caller without a project is refused", async () => {
      const { next } = await call(route.path, route.body, {
        userType: UserType.API,
      });
      const error: Error = errorFrom(next);
      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toContain("Project ID is required");
      expectNothingRead();
    });

    test("a multi-tenant request is refused", async () => {
      const { next } = await call(route.path, route.body, {
        ...memberProps(),
        isMultiTenantRequest: true,
      });
      expect(errorFrom(next)).toBeInstanceOf(BadDataException);
      expectNothingRead();
    });

    test("checks read permission on every model it reads, with the caller's props", async () => {
      await call(route.path, route.body);
      const models: Array<unknown> = permissionCheck.mock.calls.map(
        (args: Array<unknown>): unknown => {
          return args[0];
        },
      );
      expect(models).toEqual(
        route.readsRelationships
          ? [InventoryItem, InventoryItemRelationship]
          : [InventoryItem],
      );
      for (const args of permissionCheck.mock.calls) {
        expect((args[1] as JSONObject)["projectId"]).toBe(PROJECT_ID);
        expect(args[2]).toBeNull();
        expect(args[3]).toBe(propsForRequest);
      }
    });

    test("a refused permission check is passed on and nothing is read", async () => {
      permissionCheck.mockRejectedValue(
        new NotAuthorizedException("You do not have permissions to read"),
      );
      const { next } = await call(route.path, route.body);
      expect(errorFrom(next)).toBeInstanceOf(NotAuthorizedException);
      expectNothingRead();
    });

    test("reads the caller's own project, whatever the body says", async () => {
      await call(route.path, {
        ...route.body,
        projectId: OTHER_PROJECT_ID.toString(),
        tenantId: OTHER_PROJECT_ID.toString(),
      });
      const request: JSONObject = queries[route.query].mock
        .calls[0]![0] as JSONObject;
      expect((request["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(request["rangeStart"]).toEqual(FLOORED);
    });

    test("an invalid body is a 400 and reads nothing", async () => {
      const { next } = await call(route.path, {
        ...route.body,
        rangeStart: "not a date",
      });
      expect(errorFrom(next)).toBeInstanceOf(BadDataException);
      expectNothingRead();
    });

    test("a failing query is passed on", async () => {
      queries[route.query].mockRejectedValue(new Error("statement timeout"));
      const { next } = await call(route.path, route.body);
      expect(errorFrom(next).message).toBe("statement timeout");
      expect(responseUtil.sendJsonStringResponse).not.toHaveBeenCalled();
    });

    test(
      route.cached
        ? "a second request inside the minute is served from the cache, after its own checks"
        : "is never cached",
      async () => {
        await call(route.path, route.body);
        await call(route.path, route.body);
        expect(queries[route.query]).toHaveBeenCalledTimes(
          route.cached ? 1 : 2,
        );
        expect(permissionCheck).toHaveBeenCalledTimes(
          (route.readsRelationships ? 2 : 1) * 2,
        );
        expect(responseUtil.sendJsonStringResponse).toHaveBeenCalledTimes(2);
        expect(responseUtil.sendJsonStringResponse.mock.calls[1]![2]).toBe(
          responseUtil.sendJsonStringResponse.mock.calls[0]![2],
        );
      },
    );
  });

  describe("request validation", () => {
    test.each([
      [TopologyApiPath.ServiceMap, {}, /rangeStart/],
      [
        TopologyApiPath.Infrastructure,
        { rangeStart: "2999-01-01T00:00:00Z" },
        /future/,
      ],
      [
        TopologyApiPath.InfrastructureCollection,
        {
          rangeStart: RANGE_START,
          entityType: EntityType.KubernetesPod,
          includeInactive: true,
        },
        /not a flat infrastructure type/,
      ],
      [
        TopologyApiPath.InfrastructureCollection,
        {
          rangeStart: RANGE_START,
          entityType: EntityType.NetworkDevice,
          includeInactive: true,
          cursor: { name: "a" },
        },
        /cursor.key/,
      ],
      [
        TopologyApiPath.InfrastructureCollectionSearch,
        { rangeStart: RANGE_START, includeInactive: true, types: "all" },
        /types must be an array/,
      ],
      [
        TopologyApiPath.Entity,
        { rangeStart: RANGE_START, entityKey: "" },
        /entityKey/,
      ],
      [
        TopologyApiPath.EntityConnections,
        {
          rangeStart: RANGE_START,
          entityKey: "k",
          section: "everything",
          offset: 0,
        },
        /section must be one of/,
      ],
      [
        TopologyApiPath.EntityConnections,
        {
          rangeStart: RANGE_START,
          entityKey: "k",
          section: "calls",
          offset: -5,
        },
        /offset/,
      ],
    ])(
      "%s rejects %j",
      async (route: string, body: JSONObject, message: RegExp) => {
        const { next } = await call(route, body);
        const error: Error = errorFrom(next);
        expect(error).toBeInstanceOf(BadDataException);
        expect(error.message).toMatch(message);
        expectNothingRead();
      },
    );

    test("the parsed request reaches the query: floored, normalized, defaulted", async () => {
      await call(TopologyApiPath.InfrastructureCollection, {
        rangeStart: RANGE_START,
        entityType: EntityType.NetworkDevice,
        includeInactive: false,
        nameTerms: [" Core ", "SW"],
      });
      expect(queries.getCollectionPage.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        rangeStart: FLOORED,
        entityType: EntityType.NetworkDevice,
        includeInactive: false,
        nameTerms: ["core", "sw"],
        cursor: null,
        limit: 50,
      });
    });
  });

  describe("the map cache", () => {
    test("is keyed by project: another project builds its own", async () => {
      await call(TopologyApiPath.ServiceMap, { rangeStart: RANGE_START });
      await call(
        TopologyApiPath.ServiceMap,
        { rangeStart: RANGE_START },
        memberProps(OTHER_PROJECT_ID),
      );
      expect(queries.getServiceMap).toHaveBeenCalledTimes(2);
      expect(
        (queries.getServiceMap.mock.calls[1]![0] as JSONObject)["projectId"],
      ).toBe(OTHER_PROJECT_ID);
    });

    test("is keyed by route and minute: the same minute shares, the next does not", async () => {
      const sameMinute: string = new Date(
        FLOORED.getTime() + 59_999,
      ).toISOString();
      const nextMinute: string = new Date(
        FLOORED.getTime() + 60_000,
      ).toISOString();
      await call(TopologyApiPath.Infrastructure, { rangeStart: RANGE_START });
      await call(TopologyApiPath.Infrastructure, { rangeStart: sameMinute });
      await call(TopologyApiPath.ServiceMap, { rangeStart: sameMinute });
      await call(TopologyApiPath.Infrastructure, { rangeStart: nextMinute });
      expect(queries.getInfrastructure).toHaveBeenCalledTimes(2);
      expect(queries.getServiceMap).toHaveBeenCalledTimes(1);
    });

    test("a cached map is still refused to a caller the permission check refuses", async () => {
      await call(TopologyApiPath.ServiceMap, { rangeStart: RANGE_START });
      permissionCheck.mockRejectedValue(
        new NotAuthorizedException("blocked by a team rule"),
      );
      const { next } = await call(TopologyApiPath.ServiceMap, {
        rangeStart: RANGE_START,
      });
      expect(errorFrom(next)).toBeInstanceOf(NotAuthorizedException);
      expect(responseUtil.sendJsonStringResponse).toHaveBeenCalledTimes(1);
    });

    test("concurrent cold requests share one build", async () => {
      let release: (value: JSONObject) => void = (): void => {
        return undefined;
      };
      queries.getServiceMap.mockImplementation((): Promise<JSONObject> => {
        return new Promise<JSONObject>(
          (resolve: (value: JSONObject) => void): void => {
            release = resolve;
          },
        );
      });
      const first: Promise<unknown> = call(TopologyApiPath.ServiceMap, {
        rangeStart: RANGE_START,
      });
      const second: Promise<unknown> = call(TopologyApiPath.ServiceMap, {
        rangeStart: RANGE_START,
      });
      // Let both requests pass their checks and reach the cache.
      for (let tick: number = 0; tick < 20; tick++) {
        await Promise.resolve();
      }
      release({ entities: [] });
      await Promise.all([first, second]);
      expect(queries.getServiceMap).toHaveBeenCalledTimes(1);
      expect(responseUtil.sendJsonStringResponse).toHaveBeenCalledTimes(2);
      expect(sentJson(0)).toEqual({ entities: [] });
      expect(sentJson(1)).toEqual({ entities: [] });
    });

    test("a failed build is not cached: the next request builds again", async () => {
      queries.getServiceMap.mockRejectedValueOnce(new Error("timeout"));
      const failed: { next: jest.Mock } = await call(
        TopologyApiPath.ServiceMap,
        {
          rangeStart: RANGE_START,
        },
      );
      expect(errorFrom(failed.next).message).toBe("timeout");
      await call(TopologyApiPath.ServiceMap, { rangeStart: RANGE_START });
      expect(queries.getServiceMap).toHaveBeenCalledTimes(2);
      expect(sentJson(0)).toEqual({ from: "getServiceMap" });
    });
  });

  describe("with the real permission pipeline", () => {
    beforeEach(() => {
      permissionCheck.mockRestore();
    });

    /*
     * The route discards the query checkReadQueryPermission returns and binds
     * the tenant itself. That is only equivalent while neither model has
     * anything the pipeline would turn into a row predicate — labels (access
     * control), owners, a user column — so pin both the metadata and the
     * pipeline's actual output.
     */
    test("InventoryItem and its relationships carry no row-scoping column the SQL would drop", () => {
      for (const model of [
        new InventoryItem(),
        new InventoryItemRelationship(),
      ]) {
        expect(model.getAccessControlColumn()).toBeFalsy();
        expect(model.getUserColumn()).toBeFalsy();
        expect(model.getTenantColumn()).toBe("projectId");
        expect(model.canQueryMultiTenant()).toBe(false);
        expect(model.isOperationalResource).toBeFalsy();
        expect(model.ownedThrough).toBeFalsy();
        expect(ownerTableRegistry.has(model.constructor.name)).toBe(false);
      }
    });

    test("for a member, the pipeline's query is exactly the tenant the SQL binds", async () => {
      for (const modelType of [InventoryItem, InventoryItemRelationship]) {
        const checked: { query: unknown } =
          (await ModelPermission.checkReadQueryPermission(
            modelType as typeof InventoryItem,
            { projectId: PROJECT_ID },
            null,
            memberProps(),
          )) as { query: unknown };
        // Serialized for TypeORM, but still nothing but the tenant.
        expect(Object.keys(checked.query as JSONObject)).toEqual(["projectId"]);
        expect(JSON.stringify(checked.query)).toContain(PROJECT_ID.toString());
      }
    });

    test("a telemetry viewer may read the map", async () => {
      const { next } = await call(TopologyApiPath.ServiceMap, {
        rangeStart: RANGE_START,
      });
      expect(next).not.toHaveBeenCalled();
      expect(queries.getServiceMap).toHaveBeenCalledTimes(1);
    });

    test("a member without an inventory read permission may not", async () => {
      const { next } = await call(
        TopologyApiPath.ServiceMap,
        { rangeStart: RANGE_START },
        memberProps(PROJECT_ID, [Permission.ReadProjectIncident]),
      );
      expect(errorFrom(next)).toBeInstanceOf(NotAuthorizedException);
      expectNothingRead();
    });

    test("permissions granted in another project do not count", async () => {
      const props: DatabaseCommonInteractionProps = memberProps(
        OTHER_PROJECT_ID,
        [Permission.TelemetryViewer],
      );
      props.tenantId = PROJECT_ID;
      const { next } = await call(
        TopologyApiPath.Entity,
        { rangeStart: RANGE_START, entityKey: "svc-a" },
        props,
      );
      expect(errorFrom(next)).toBeInstanceOf(NotAuthorizedException);
      expectNothingRead();
    });
  });
});

/*
 * The stubs above stand in for real modules. If the route starts calling a
 * member a stub lacks, the handler throws a TypeError the tests would read
 * as a failure of something else; if it stops calling one, the assertions
 * about it become vacuous. Both are caught here from the route's source.
 */
const ROUTE_SOURCE: string = fs
  .readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "FeatureSet",
      "BaseAPI",
      "API",
      "Topology.ts",
    ),
    "utf8",
  )
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\/\/.*$/gm, " ");

function membersUsedOn(name: string): Set<string> {
  const members: Set<string> = new Set<string>();
  for (const match of ROUTE_SOURCE.matchAll(
    new RegExp(`\\b${name}\\.([A-Za-z0-9_]+)`, "g"),
  )) {
    members.add(match[1] as string);
  }
  return members;
}

describe("the stubs in this file track the route they stand in for", () => {
  const stubs: Array<{ name: string; stub: Record<string, unknown> }> = [
    { name: "TopologyQueries", stub: queries as Record<string, unknown> },
    { name: "Response", stub: responseUtil as Record<string, unknown> },
    {
      name: "UserMiddleware",
      stub: UserMiddleware as unknown as Record<string, unknown>,
    },
  ];

  for (const { name, stub } of stubs) {
    test(`${name}: the route calls only what the stub provides, and all of it`, () => {
      const used: Set<string> = membersUsedOn(name);
      expect(Array.from(used).sort()).not.toEqual([]);
      expect(
        Array.from(used).filter((member: string): boolean => {
          return !(member in stub);
        }),
      ).toEqual([]);
      expect(
        Object.keys(stub).filter((member: string): boolean => {
          return !used.has(member);
        }),
      ).toEqual([]);
    });
  }

  test("the spied members exist on the real modules", () => {
    expect(membersUsedOn("CommonAPI")).toEqual(
      new Set<string>([
        "getDatabaseCommonInteractionProps",
        "assertTenantScoped",
      ]),
    );
    expect(membersUsedOn("ModelPermission")).toEqual(
      new Set<string>(["checkReadQueryPermission"]),
    );
    expect(typeof CommonAPI.getDatabaseCommonInteractionProps).toBe("function");
    expect(typeof CommonAPI.assertTenantScoped).toBe("function");
    expect(typeof ModelPermission.checkReadQueryPermission).toBe("function");
  });
});
