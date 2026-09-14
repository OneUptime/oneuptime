import CommonAPI from "../../../Server/API/CommonAPI";
import LogAggregationService from "../../../Server/Services/LogAggregationService";
import TraceAggregationService from "../../../Server/Services/TraceAggregationService";
import ExceptionAggregationService from "../../../Server/Services/ExceptionAggregationService";
import MetricAggregationService from "../../../Server/Services/MetricAggregationService";
import ResourceFacetResolver, {
  ResourceFacetEntity,
  ResourceFacetListSpec,
} from "../../../Server/Utils/Telemetry/ResourceFacetResolver";
import ResourceEntityFilter, {
  ResourceEntityScope,
} from "../../../Server/Utils/Telemetry/ResourceEntityFilter";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { RESOURCE_FACET_CATALOG_KEYS } from "../../../Types/Telemetry/ResourceFacetCatalog";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The four facet endpoints behind the Logs / Traces / Exceptions / Metrics
 * filter sidebars, driven through their real middleware chain.
 *
 * What is pinned here is the LIST-FIRST contract: resource facets fetch
 * their Postgres rows before counting, and a resource type the project has
 * none of answers [] without its ClickHouse count query ever running. The
 * explorers ask for every resource type in the catalog on each refresh, so
 * a regression here multiplies ClickHouse load rather than failing loudly.
 * The response shape (one entry per requested key, resource facets carrying
 * displayName) and per-facet degradation are pinned alongside.
 */

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type RecordedRoute = {
  method: string;
  uri: string;
  handlers: Array<RouterFunction>;
};

const recordedRoutes: Array<RecordedRoute> = [];

type RecordRouteFunction = (
  method: string,
) => (uri: string, ...handlers: Array<RouterFunction>) => void;

const recordRoute: RecordRouteFunction = (method: string) => {
  return (uri: string, ...handlers: Array<RouterFunction>): void => {
    recordedRoutes.push({
      method: method.toUpperCase(),
      uri: uri,
      handlers: handlers,
    });
  };
};

const telemetryRouter: JSONObject = {
  get: recordRoute("get"),
  post: recordRoute("post"),
  put: recordRoute("put"),
  delete: recordRoute("delete"),
} as unknown as JSONObject;

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return telemetryRouter;
    },
    getClientIp: () => {
      return "203.0.113.7";
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
  };
});

const LOGS_ROUTE: string = "/telemetry/logs/facets";
const TRACES_ROUTE: string = "/telemetry/traces/facets";
const EXCEPTIONS_ROUTE: string = "/telemetry/exceptions/facets";
const METRICS_ROUTE: string = "/telemetry/metrics/facets";

type FacetsBody = Record<
  string,
  Array<{ value: string; count: number; displayName?: string }>
>;

type CallResult = {
  thrownToNext: unknown;
  reachedHandler: boolean;
  facets: FacetsBody | undefined;
};

function findRoute(uri: string): RecordedRoute {
  const route: RecordedRoute | undefined = recordedRoutes.find(
    (candidate: RecordedRoute): boolean => {
      return candidate.method === "POST" && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`Route not registered: ${uri}`);
  }

  return route;
}

/*
 * Runs a recorded route's middleware chain from requireUserAuthentication
 * on (index 0, getUserMiddleware, only populates the session fields these
 * fixtures set directly).
 */
async function callRoute(data: {
  uri: string;
  request: JSONObject;
  body: JSONObject;
}): Promise<CallResult> {
  const route: RecordedRoute = findRoute(data.uri);

  const req: ExpressRequest = {
    ...data.request,
    body: data.body,
    params: {},
    query: {},
    headers: { "user-agent": "jest-agent" },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    setHeader: (): void => {
      // no-op
    },
    send: (): void => {
      // no-op
    },
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as ExpressResponse;

  const outcome: { thrownToNext: unknown; reachedHandler: boolean } = {
    thrownToNext: undefined,
    reachedHandler: false,
  };

  for (let index: number = 1; index < route.handlers.length; index++) {
    const handler: RouterFunction | undefined = route.handlers[index];

    if (!handler) {
      break;
    }

    if (index === route.handlers.length - 1) {
      outcome.reachedHandler = true;
    }

    const step: { calledNext: boolean } = { calledNext: false };

    const next: NextFunction = ((error?: unknown): void => {
      step.calledNext = true;

      if (error) {
        outcome.thrownToNext = error;
      }
    }) as unknown as NextFunction;

    await handler(req, res, next);

    if (!step.calledNext) {
      break;
    }
  }

  const sendJsonObjectResponse: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  const jsonCall: Array<unknown> | undefined = sendJsonObjectResponse.mock
    .calls[0] as Array<unknown> | undefined;
  const jsonBody: JSONObject | undefined = jsonCall
    ? (jsonCall[2] as JSONObject)
    : undefined;

  return {
    thrownToNext: outcome.thrownToNext,
    reachedHandler: outcome.reachedHandler,
    facets: jsonBody
      ? (jsonBody["facets"] as unknown as FacetsBody)
      : undefined,
  };
}

interface Spy {
  mock: { calls: Array<Array<unknown>> };
  mockImplementation: (implementation: (...args: Array<any>) => any) => unknown;
}

function spyOn(target: object, method: string): Spy {
  return jest.spyOn(target as never, method as never) as unknown as Spy;
}

describe("telemetry facet endpoints (list first)", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let listedRows: Record<string, Array<ResourceFacetEntity>>;
  let listEntities: Spy;
  let viewerRequest: JSONObject;

  beforeAll(() => {
    recordedRoutes.length = 0;
    /*
     * Loaded lazily: TelemetryAPI calls Express.getRouter() at module scope,
     * so a static import would run the mock factory before `telemetryRouter`
     * is initialised.
     */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../../../Server/API/TelemetryAPI");
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    userId = ObjectID.generate();
    listedRows = {};

    listEntities = spyOn(ResourceFacetResolver, "listEntities");
    listEntities.mockImplementation(
      async (
        _projectId: ObjectID,
        specs: Array<ResourceFacetListSpec>,
      ): Promise<Record<string, Array<ResourceFacetEntity>>> => {
        return Object.fromEntries(
          specs.map(
            (
              spec: ResourceFacetListSpec,
            ): [string, Array<ResourceFacetEntity>] => {
              return [spec.facetKey, listedRows[spec.facetKey] || []];
            },
          ),
        );
      },
    );

    const permissionMap: Dictionary<UserTenantAccessPermission> = {};
    permissionMap[projectId.toString()] = {
      _type: "UserTenantAccessPermission",
      projectId: projectId,
      permissions: [Permission.ProjectMember, Permission.TelemetryViewer].map(
        (permission: Permission): UserPermission => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        },
      ),
    };

    const databaseProps: DatabaseCommonInteractionProps = {
      tenantId: projectId,
      userId: userId,
      userType: UserType.User,
      userTenantAccessPermission: permissionMap,
    };

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(databaseProps);

    viewerRequest = {
      userType: UserType.User,
      tenantId: projectId,
      userTenantAccessPermission: permissionMap,
      userAuthorization: { userId: userId },
    } as unknown as JSONObject;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function listedFacetKeys(): Array<string> {
    const call: Array<unknown> | undefined = listEntities.mock.calls[0];
    const specs: Array<ResourceFacetListSpec> = (
      call ? call[1] : []
    ) as Array<ResourceFacetListSpec>;

    return specs.map((spec: ResourceFacetListSpec): string => {
      return spec.facetKey;
    });
  }

  /*
   * Stubs a per-facet getFacetValues and records the keys it was asked to
   * count. Keys listed in `failing` reject.
   */
  function stubPerFacetCounts(
    service: object,
    values: Record<string, Array<{ value: string; count: number }>>,
    failing: Array<string> = [],
  ): { counted: Array<string>; requests: Array<JSONObject> } {
    const recorded: { counted: Array<string>; requests: Array<JSONObject> } = {
      counted: [],
      requests: [],
    };

    spyOn(service, "getFacetValues").mockImplementation(
      async (
        request: JSONObject,
      ): Promise<Array<{ value: string; count: number }>> => {
        const facetKey: string = request["facetKey"] as string;
        recorded.counted.push(facetKey);
        recorded.requests.push(request);

        if (failing.includes(facetKey)) {
          throw new Error(`ClickHouse timeout for ${facetKey}`);
        }

        return values[facetKey] || [];
      },
    );

    return recorded;
  }

  describe("POST /telemetry/logs/facets", () => {
    test("counts only the resource types that have rows; the rest answer [] with no ClickHouse query", async () => {
      listedRows = {
        primaryEntityId: [{ id: "svc-1", displayName: "checkout" }],
        kubernetesClusterId: [
          { id: "k8s-1", displayName: "prod-eu" },
          { id: "k8s-2", displayName: "prod-us" },
        ],
      };
      const counts: { counted: Array<string> } = stubPerFacetCounts(
        LogAggregationService,
        {
          severityText: [{ value: "Error", count: 4 }],
          primaryEntityId: [{ value: "svc-1", count: 40 }],
          kubernetesClusterId: [{ value: "k8s-2", count: 9 }],
        },
      );

      const result: CallResult = await callRoute({
        uri: LOGS_ROUTE,
        request: viewerRequest,
        body: {
          facetKeys: [
            "severityText",
            "primaryEntityId",
            ...RESOURCE_FACET_CATALOG_KEYS,
          ],
        },
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(counts.counted.sort()).toEqual(
        ["kubernetesClusterId", "primaryEntityId", "severityText"].sort(),
      );

      expect(Object.keys(result.facets!).sort()).toEqual(
        ["severityText", "primaryEntityId", ...RESOURCE_FACET_CATALOG_KEYS]
          .slice()
          .sort(),
      );
      expect(result.facets!["severityText"]).toEqual([
        { value: "Error", count: 4 },
      ]);
      expect(result.facets!["primaryEntityId"]).toEqual([
        { value: "svc-1", count: 40, displayName: "checkout" },
      ]);
      expect(result.facets!["kubernetesClusterId"]).toEqual([
        { value: "k8s-2", count: 9, displayName: "prod-us" },
        { value: "k8s-1", count: 0, displayName: "prod-eu" },
      ]);
      for (const facetKey of RESOURCE_FACET_CATALOG_KEYS) {
        if (facetKey !== "kubernetesClusterId") {
          expect(result.facets![facetKey]).toEqual([]);
        }
      }
    });

    test("lists every requested resource facet in one batch, with its search text and the limit", async () => {
      stubPerFacetCounts(LogAggregationService, {});

      await callRoute({
        uri: LOGS_ROUTE,
        request: viewerRequest,
        body: {
          facetKeys: ["severityText", "hostId", "iotFleetId"],
          facetSearchText: { hostId: "web", severityText: "ignored" },
          limit: 200,
        },
      });

      expect(listEntities.mock.calls).toHaveLength(1);
      expect(listEntities.mock.calls[0]![1]).toEqual([
        { facetKey: "hostId", searchText: "web", limit: 200 },
        { facetKey: "iotFleetId", searchText: undefined, limit: 200 },
      ]);
    });

    test("keeps the two-key default when the body names no facets", async () => {
      const counts: { counted: Array<string> } = stubPerFacetCounts(
        LogAggregationService,
        {},
      );

      const result: CallResult = await callRoute({
        uri: LOGS_ROUTE,
        request: viewerRequest,
        body: {},
      });

      expect(Object.keys(result.facets!).sort()).toEqual([
        "primaryEntityId",
        "severityText",
      ]);
      expect(listedFacetKeys()).toEqual(["primaryEntityId"]);
      expect(counts.counted).toEqual(["severityText"]);
    });

    test("a failing count degrades per facet: plain facets to [], resource facets to their rows at count 0", async () => {
      listedRows = { hostId: [{ id: "h1", displayName: "web-1" }] };
      stubPerFacetCounts(LogAggregationService, {}, ["severityText", "hostId"]);

      const result: CallResult = await callRoute({
        uri: LOGS_ROUTE,
        request: viewerRequest,
        body: { facetKeys: ["severityText", "hostId"] },
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(result.facets).toEqual({
        severityText: [],
        hostId: [{ value: "h1", count: 0, displayName: "web-1" }],
      });
    });

    test("a selection on a newly filterable type reaches the count queries as a resource scope", async () => {
      const fleetId: string = ObjectID.generate().toString();
      const fleetScope: ResourceEntityScope = {
        entityIds: [fleetId],
        entityKeys: [],
        attributeKey: "resource.iot.fleet.name",
        attributeValues: ["sensors"],
      };
      const resolveScopes: Spy = spyOn(ResourceEntityFilter, "resolveScopes");
      resolveScopes.mockImplementation(
        async (): Promise<Array<ResourceEntityScope>> => {
          return [fleetScope];
        },
      );
      const counts: { requests: Array<JSONObject> } = stubPerFacetCounts(
        LogAggregationService,
        {},
      );

      await callRoute({
        uri: LOGS_ROUTE,
        request: viewerRequest,
        body: {
          facetKeys: ["severityText"],
          resourceFilters: { iotFleetId: [fleetId] },
        },
      });

      expect(resolveScopes.mock.calls[0]![0]).toEqual({
        projectId,
        selections: { iotFleetId: [fleetId] },
      });
      expect(counts.requests[0]!["resourceScopes"]).toEqual([fleetScope]);
    });
  });

  describe("POST /telemetry/exceptions/facets", () => {
    test("the default facet list covers every catalog resource type, and only listed ones are counted", async () => {
      listedRows = {
        primaryEntityId: [{ id: "svc-1", displayName: "checkout" }],
        serverlessFunctionId: [{ id: "fn-1", displayName: "resize-image" }],
      };
      const counts: { counted: Array<string> } = stubPerFacetCounts(
        ExceptionAggregationService,
        {
          serverlessFunctionId: [{ value: "fn-1", count: 3 }],
          exceptionType: [{ value: "TypeError", count: 3 }],
        },
      );

      const result: CallResult = await callRoute({
        uri: EXCEPTIONS_ROUTE,
        request: viewerRequest,
        body: {},
      });

      expect(listedFacetKeys()).toEqual([
        "primaryEntityId",
        ...RESOURCE_FACET_CATALOG_KEYS,
      ]);
      expect(Object.keys(result.facets!)).toEqual([
        "primaryEntityId",
        ...RESOURCE_FACET_CATALOG_KEYS,
        "exceptionType",
        "environment",
      ]);
      expect(counts.counted.sort()).toEqual(
        [
          "environment",
          "exceptionType",
          "primaryEntityId",
          "serverlessFunctionId",
        ].sort(),
      );
      expect(result.facets!["serverlessFunctionId"]).toEqual([
        { value: "fn-1", count: 3, displayName: "resize-image" },
      ]);
      expect(result.facets!["dockerSwarmClusterId"]).toEqual([]);
    });
  });

  describe("POST /telemetry/metrics/facets", () => {
    test("the default facet list is Services plus every catalog type; nothing listed means no count query at all", async () => {
      const counts: { counted: Array<string> } = stubPerFacetCounts(
        MetricAggregationService,
        { primaryEntityId: [{ value: "svc-1", count: 1 }] },
      );

      const result: CallResult = await callRoute({
        uri: METRICS_ROUTE,
        request: viewerRequest,
        body: {},
      });

      expect(listedFacetKeys()).toEqual([
        "primaryEntityId",
        ...RESOURCE_FACET_CATALOG_KEYS,
      ]);
      expect(counts.counted).toEqual([]);
      expect(result.facets).toEqual(
        Object.fromEntries(
          ["primaryEntityId", ...RESOURCE_FACET_CATALOG_KEYS].map(
            (facetKey: string): [string, Array<never>] => {
              return [facetKey, []];
            },
          ),
        ),
      );
    });

    test("a type with rows is counted and merged", async () => {
      listedRows = { vmwareVCenterId: [{ id: "vc-1", displayName: "vc-eu" }] };
      stubPerFacetCounts(MetricAggregationService, {
        vmwareVCenterId: [{ value: "vc-1", count: 12 }],
      });

      const result: CallResult = await callRoute({
        uri: METRICS_ROUTE,
        request: viewerRequest,
        body: { facetKeys: ["vmwareVCenterId", "proxmoxClusterId"] },
      });

      expect(result.facets).toEqual({
        vmwareVCenterId: [{ value: "vc-1", count: 12, displayName: "vc-eu" }],
        proxmoxClusterId: [],
      });
    });
  });

  describe("POST /telemetry/traces/facets", () => {
    interface TraceSpies {
      sample: Spy;
      resourceCounts: Spy;
      rootSpan: Spy;
      hasException: Spy;
    }

    function stubTraceCounts(data: {
      serviceCounts?: Array<[string, number]>;
      statusCounts?: Array<[string, number]>;
      failResourceCounts?: boolean;
    }): TraceSpies {
      const sample: Spy = spyOn(
        TraceAggregationService,
        "getFacetValuesFromSample",
      );
      sample.mockImplementation(
        async (request: JSONObject): Promise<JSONObject> => {
          return Object.fromEntries(
            (request["facetKeys"] as Array<string>).map(
              (facetKey: string): [string, Array<JSONObject>] => {
                return [facetKey, [{ value: `${facetKey}-v`, count: 1 }]];
              },
            ),
          );
        },
      );

      const resourceCounts: Spy = spyOn(
        TraceAggregationService,
        "getResourceFacetCounts",
      );
      resourceCounts.mockImplementation(
        async (): Promise<{
          serviceCounts: Map<string, number>;
          statusCounts: Map<string, number>;
        }> => {
          if (data.failResourceCounts) {
            throw new Error("projection query timed out");
          }

          return {
            serviceCounts: new Map<string, number>(data.serviceCounts || []),
            statusCounts: new Map<string, number>(data.statusCounts || []),
          };
        },
      );

      const rootSpan: Spy = spyOn(TraceAggregationService, "getRootSpanCounts");
      rootSpan.mockImplementation(
        async (): Promise<{ rootCount: number; nonRootCount: number }> => {
          return { rootCount: 2, nonRootCount: 5 };
        },
      );

      const hasException: Spy = spyOn(
        TraceAggregationService,
        "getHasExceptionCounts",
      );
      hasException.mockImplementation(
        async (): Promise<{
          withExceptionCount: number;
          withoutExceptionCount: number;
        }> => {
          return { withExceptionCount: 1, withoutExceptionCount: 6 };
        },
      );

      return { sample, resourceCounts, rootSpan, hasException };
    }

    test("skips the shared resource count query when no statusCode is requested and no resource type has rows", async () => {
      const spies: TraceSpies = stubTraceCounts({});

      const result: CallResult = await callRoute({
        uri: TRACES_ROUTE,
        request: viewerRequest,
        body: {
          facetKeys: ["kind", "isRootSpan", ...RESOURCE_FACET_CATALOG_KEYS],
        },
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(spies.resourceCounts.mock.calls).toHaveLength(0);
      expect(listedFacetKeys()).toEqual([...RESOURCE_FACET_CATALOG_KEYS]);

      // Resource keys never go to the sample.
      expect(
        (spies.sample.mock.calls[0]![0] as JSONObject)["facetKeys"],
      ).toEqual(["kind"]);

      expect(result.facets!["kind"]).toEqual([{ value: "kind-v", count: 1 }]);
      expect(result.facets!["isRootSpan"]).toEqual([
        { value: "true", count: 2 },
        { value: "false", count: 5 },
      ]);
      for (const facetKey of RESOURCE_FACET_CATALOG_KEYS) {
        expect(result.facets![facetKey]).toEqual([]);
      }
    });

    test("still runs the shared count query for statusCode even when no resource type has rows", async () => {
      const spies: TraceSpies = stubTraceCounts({
        statusCounts: [
          ["0", 3],
          ["2", 8],
        ],
      });

      const result: CallResult = await callRoute({
        uri: TRACES_ROUTE,
        request: viewerRequest,
        body: { facetKeys: ["statusCode", "hostId"] },
      });

      expect(spies.resourceCounts.mock.calls).toHaveLength(1);
      expect(result.facets!["statusCode"]).toEqual([
        { value: "2", count: 8 },
        { value: "0", count: 3 },
      ]);
      expect(result.facets!["hostId"]).toEqual([]);
    });

    test("runs the shared count query once as soon as any resource type has rows, and merges it into each", async () => {
      listedRows = {
        primaryEntityId: [{ id: "svc-1", displayName: "checkout" }],
        iotFleetId: [{ id: "fleet-1", displayName: "sensors" }],
      };
      const spies: TraceSpies = stubTraceCounts({
        serviceCounts: [
          ["svc-1", 30],
          ["fleet-1", 2],
        ],
      });

      const result: CallResult = await callRoute({
        uri: TRACES_ROUTE,
        request: viewerRequest,
        body: {
          facetKeys: ["primaryEntityId", "iotFleetId", "cephClusterId"],
        },
      });

      expect(spies.resourceCounts.mock.calls).toHaveLength(1);
      expect(spies.sample.mock.calls).toHaveLength(0);
      expect(result.facets).toEqual({
        primaryEntityId: [
          { value: "svc-1", count: 30, displayName: "checkout" },
        ],
        iotFleetId: [{ value: "fleet-1", count: 2, displayName: "sensors" }],
        cephClusterId: [],
      });
    });

    test("a failing count query keeps listed rows at count 0", async () => {
      listedRows = { hostId: [{ id: "h1", displayName: "web-1" }] };
      stubTraceCounts({ failResourceCounts: true });

      const result: CallResult = await callRoute({
        uri: TRACES_ROUTE,
        request: viewerRequest,
        body: { facetKeys: ["hostId", "statusCode"] },
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(result.facets).toEqual({
        hostId: [{ value: "h1", count: 0, displayName: "web-1" }],
        statusCode: [],
      });
    });

    test("passes facet search text and limit to the listing", async () => {
      stubTraceCounts({});

      await callRoute({
        uri: TRACES_ROUTE,
        request: viewerRequest,
        body: {
          facetKeys: ["dockerSwarmClusterId", "name"],
          facetSearchText: { dockerSwarmClusterId: "swarm" },
          limit: 50,
        },
      });

      expect(listEntities.mock.calls[0]![1]).toEqual([
        { facetKey: "dockerSwarmClusterId", searchText: "swarm", limit: 50 },
      ]);
    });

    test("a request with no resource facets and no statusCode never lists or counts resources", async () => {
      const spies: TraceSpies = stubTraceCounts({});

      const result: CallResult = await callRoute({
        uri: TRACES_ROUTE,
        request: viewerRequest,
        body: { facetKeys: ["kind", "hasException"] },
      });

      expect(listEntities.mock.calls).toHaveLength(0);
      expect(spies.resourceCounts.mock.calls).toHaveLength(0);
      expect(result.facets).toEqual({
        kind: [{ value: "kind-v", count: 1 }],
        hasException: [
          { value: "true", count: 1 },
          { value: "false", count: 6 },
        ],
      });
    });
  });
});
