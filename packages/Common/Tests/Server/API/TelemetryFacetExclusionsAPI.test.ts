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
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
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
 * "Is not" through the telemetry endpoints behind the explorers' charts and
 * facet counts, driven through their real middleware chain.
 *
 * Each endpoint reads what the reader LEFT OUT beside what they keep:
 * `excludedSeverityTexts`, `excludedServiceIds` and `excludedResourceFilters`
 * (logs), `excludedStatusCodes`, `excludedSpanKinds` and `excludedSpanNames`
 * (traces), `excludedExceptionTypes` and `excludedEnvironments`
 * (exceptions), and `excludedServiceIds` everywhere. What is pinned is that
 * each reaches the aggregation request, read defensively, and that a
 * service left out joins the ones a block takes away rather than replacing
 * them.
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

const CHECKOUT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BILLING_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HOST_ID: string = "5f4e3d2c-1b0a-4998-8776-655443322110";

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
 * fixtures set directly). What reached `next` with an error is returned.
 */
async function callRoute(data: {
  uri: string;
  request: JSONObject;
  body: JSONObject;
}): Promise<unknown> {
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

  let thrownToNext: unknown = undefined;

  for (let index: number = 1; index < route.handlers.length; index++) {
    const handler: RouterFunction | undefined = route.handlers[index];

    if (!handler) {
      break;
    }

    const step: { calledNext: boolean } = { calledNext: false };

    const next: NextFunction = ((error?: unknown): void => {
      step.calledNext = true;

      if (error) {
        thrownToNext = error;
      }
    }) as unknown as NextFunction;

    await handler(req, res, next);

    if (!step.calledNext) {
      break;
    }
  }

  return thrownToNext;
}

interface Spy {
  mock: { calls: Array<Array<unknown>> };
  mockImplementation: (implementation: (...args: Array<any>) => any) => unknown;
}

function spyOn<K extends string, T extends Record<K, unknown>>(
  target: T,
  method: K,
): Spy {
  return jest.spyOn(target as never, method as never) as unknown as Spy;
}

// The one request a stubbed service method was handed.
function onlyRequest(spy: Spy): JSONObject {
  expect(spy.mock.calls.length).toBeGreaterThan(0);

  return spy.mock.calls[0]![0] as JSONObject;
}

// Ids as the request carries them (ObjectIDs), in order.
function idsOf(value: unknown): Array<string> {
  return ((value as Array<ObjectID> | undefined) || []).map(
    (id: ObjectID): string => {
      return id.toString();
    },
  );
}

describe("telemetry endpoints read what a reader left out", () => {
  let projectId: ObjectID;
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
    const userId: ObjectID = ObjectID.generate();

    spyOn(ResourceFacetResolver, "listEntities").mockImplementation(
      async (
        _projectId: ObjectID,
        specs: Array<ResourceFacetListSpec>,
      ): Promise<Record<string, Array<ResourceFacetEntity>>> => {
        return Object.fromEntries(
          specs.map(
            (
              spec: ResourceFacetListSpec,
            ): [string, Array<ResourceFacetEntity>] => {
              // One row each, so every resource facet is counted.
              return [spec.facetKey, [{ id: CHECKOUT_ID, displayName: "a" }]];
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

  describe("logs", () => {
    test("the facet counts get the severities and services left out", async () => {
      const counts: Spy = spyOn(LogAggregationService, "getFacetValues");
      counts.mockImplementation(async (): Promise<Array<unknown>> => {
        return [];
      });

      const thrown: unknown = await callRoute({
        uri: "/telemetry/logs/facets",
        request: viewerRequest,
        body: {
          facetKeys: ["severityText", "primaryEntityId"],
          excludedSeverityTexts: ["Debug", "Trace", 7, ""],
          excludedServiceIds: [CHECKOUT_ID, "not-an-id", BILLING_ID],
        },
      });

      expect(thrown).toBeUndefined();
      expect(counts.mock.calls).toHaveLength(2);

      for (const call of counts.mock.calls) {
        const request: JSONObject = call[0] as JSONObject;
        expect(request["excludedSeverityTexts"]).toEqual(["Debug", "Trace"]);
        expect(idsOf(request["excludedServiceIds"])).toEqual([
          CHECKOUT_ID,
          BILLING_ID,
        ]);
      }
    });

    test("the chart gets them too", async () => {
      const histogram: Spy = spyOn(LogAggregationService, "getHistogram");
      histogram.mockImplementation(async (): Promise<Array<unknown>> => {
        return [];
      });

      await callRoute({
        uri: "/telemetry/logs/histogram",
        request: viewerRequest,
        body: {
          excludedSeverityTexts: ["Debug"],
          excludedServiceIds: [CHECKOUT_ID],
        },
      });

      const request: JSONObject = onlyRequest(histogram);
      expect(request["excludedSeverityTexts"]).toEqual(["Debug"]);
      expect(idsOf(request["excludedServiceIds"])).toEqual([CHECKOUT_ID]);
    });

    test("and the analytics tab", async () => {
      const timeseries: Spy = spyOn(
        LogAggregationService,
        "getAnalyticsTimeseries",
      );
      timeseries.mockImplementation(async (): Promise<Array<unknown>> => {
        return [];
      });

      await callRoute({
        uri: "/telemetry/logs/analytics",
        request: viewerRequest,
        body: {
          chartType: "timeseries",
          excludedSeverityTexts: ["Information"],
          excludedServiceIds: [BILLING_ID],
        },
      });

      const request: JSONObject = onlyRequest(timeseries);
      expect(request["excludedSeverityTexts"]).toEqual(["Information"]);
      expect(idsOf(request["excludedServiceIds"])).toEqual([BILLING_ID]);
    });

    test("a resource left out resolves to a scope marked isExcluded, beside a kept one", async () => {
      const resolveScopes: Spy = spyOn(ResourceEntityFilter, "resolveScopes");
      resolveScopes.mockImplementation(
        async (data: {
          selections: Record<string, Array<string>>;
          isExcluded?: boolean;
        }): Promise<Array<ResourceEntityScope>> => {
          return Object.values(data.selections).map(
            (ids: Array<string>): ResourceEntityScope => {
              return data.isExcluded
                ? { entityIds: ids, entityKeys: [], isExcluded: true }
                : { entityIds: ids, entityKeys: [] };
            },
          );
        },
      );
      const histogram: Spy = spyOn(LogAggregationService, "getHistogram");
      histogram.mockImplementation(async (): Promise<Array<unknown>> => {
        return [];
      });

      await callRoute({
        uri: "/telemetry/logs/histogram",
        request: viewerRequest,
        body: {
          resourceFilters: { kubernetesClusterId: [BILLING_ID] },
          excludedResourceFilters: { hostId: [HOST_ID] },
        },
      });

      expect(resolveScopes.mock.calls).toHaveLength(2);
      expect(resolveScopes.mock.calls[0]![0]).toEqual({
        projectId,
        selections: { kubernetesClusterId: [BILLING_ID] },
      });
      expect(resolveScopes.mock.calls[1]![0]).toEqual({
        projectId,
        selections: { hostId: [HOST_ID] },
        isExcluded: true,
      });
      expect(onlyRequest(histogram)["resourceScopes"]).toEqual([
        { entityIds: [BILLING_ID], entityKeys: [] },
        { entityIds: [HOST_ID], entityKeys: [], isExcluded: true },
      ]);
    });

    test("nothing left out sends no left-out fields at all", async () => {
      const histogram: Spy = spyOn(LogAggregationService, "getHistogram");
      histogram.mockImplementation(async (): Promise<Array<unknown>> => {
        return [];
      });

      await callRoute({
        uri: "/telemetry/logs/histogram",
        request: viewerRequest,
        body: {
          excludedSeverityTexts: "Debug",
          excludedServiceIds: ["not-an-id"],
        },
      });

      const request: JSONObject = onlyRequest(histogram);
      expect(request["excludedSeverityTexts"]).toBeUndefined();
      expect(request["excludedServiceIds"]).toBeUndefined();
      expect(request["resourceScopes"]).toBeUndefined();
    });
  });

  describe("traces", () => {
    test("the chart gets the statuses, kinds, names and services left out", async () => {
      const histogram: Spy = spyOn(TraceAggregationService, "getHistogram");
      histogram.mockImplementation(async (): Promise<Array<unknown>> => {
        return [];
      });

      await callRoute({
        uri: "/telemetry/traces/histogram",
        request: viewerRequest,
        body: {
          excludedStatusCodes: [2, "0", "unset", null],
          excludedSpanKinds: ["SPAN_KIND_CLIENT", 4],
          excludedSpanNames: ["GET /health", "GET /health"],
          excludedServiceIds: [CHECKOUT_ID],
        },
      });

      const request: JSONObject = onlyRequest(histogram);
      expect(request["excludedStatusCodes"]).toEqual([2, 0]);
      expect(request["excludedSpanKinds"]).toEqual(["SPAN_KIND_CLIENT"]);
      expect(request["excludedSpanNames"]).toEqual(["GET /health"]);
      expect(idsOf(request["excludedServiceIds"])).toEqual([CHECKOUT_ID]);
    });

    test("the analytics chart gets them through the same body reading", async () => {
      const timeseries: Spy = spyOn(
        TraceAggregationService,
        "getAnalyticsTimeseries",
      );
      timeseries.mockImplementation(async (): Promise<Array<unknown>> => {
        return [];
      });

      await callRoute({
        uri: "/telemetry/traces/analytics",
        request: viewerRequest,
        body: {
          chartType: "timeseries",
          metric: "count",
          excludedStatusCodes: [1],
        },
      });

      expect(onlyRequest(timeseries)["excludedStatusCodes"]).toEqual([1]);
    });

    test("the facet counts get them too", async () => {
      const sample: Spy = spyOn(
        TraceAggregationService,
        "getFacetValuesFromSample",
      );
      sample.mockImplementation(
        async (): Promise<Record<string, Array<unknown>>> => {
          return {};
        },
      );

      await callRoute({
        uri: "/telemetry/traces/facets",
        request: viewerRequest,
        body: {
          facetKeys: ["kind"],
          excludedSpanKinds: ["SPAN_KIND_INTERNAL"],
          excludedServiceIds: [BILLING_ID],
        },
      });

      const request: JSONObject = onlyRequest(sample);
      expect(request["excludedSpanKinds"]).toEqual(["SPAN_KIND_INTERNAL"]);
      expect(idsOf(request["excludedServiceIds"])).toEqual([BILLING_ID]);
    });
  });

  describe("exceptions", () => {
    test("the chart gets the types, environments and services left out", async () => {
      const histogram: Spy = spyOn(ExceptionAggregationService, "getHistogram");
      histogram.mockImplementation(async (): Promise<Array<unknown>> => {
        return [];
      });

      await callRoute({
        uri: "/telemetry/exceptions/histogram",
        request: viewerRequest,
        body: {
          excludedExceptionTypes: ["TypeError"],
          excludedEnvironments: ["staging", 3],
          excludedServiceIds: [CHECKOUT_ID],
        },
      });

      const request: JSONObject = onlyRequest(histogram);
      expect(request["excludedExceptionTypes"]).toEqual(["TypeError"]);
      expect(request["excludedEnvironments"]).toEqual(["staging"]);
      expect(idsOf(request["excludedServiceIds"])).toEqual([CHECKOUT_ID]);
    });

    test("the facet counts get them too", async () => {
      const counts: Spy = spyOn(ExceptionAggregationService, "getFacetValues");
      counts.mockImplementation(async (): Promise<Array<unknown>> => {
        return [];
      });

      await callRoute({
        uri: "/telemetry/exceptions/facets",
        request: viewerRequest,
        body: {
          facetKeys: ["exceptionType", "environment"],
          excludedExceptionTypes: ["TypeError"],
          excludedEnvironments: ["staging"],
          excludedServiceIds: [BILLING_ID],
        },
      });

      expect(counts.mock.calls).toHaveLength(2);

      for (const call of counts.mock.calls) {
        const request: JSONObject = call[0] as JSONObject;
        expect(request["excludedExceptionTypes"]).toEqual(["TypeError"]);
        expect(request["excludedEnvironments"]).toEqual(["staging"]);
        expect(idsOf(request["excludedServiceIds"])).toEqual([BILLING_ID]);
      }
    });
  });

  describe("metrics", () => {
    test("the facet counts get the services left out", async () => {
      const counts: Spy = spyOn(MetricAggregationService, "getFacetValues");
      counts.mockImplementation(async (): Promise<Array<unknown>> => {
        return [];
      });

      await callRoute({
        uri: "/telemetry/metrics/facets",
        request: viewerRequest,
        body: {
          facetKeys: ["primaryEntityId"],
          excludedServiceIds: [CHECKOUT_ID],
        },
      });

      expect(idsOf(onlyRequest(counts)["excludedServiceIds"])).toEqual([
        CHECKOUT_ID,
      ]);
    });
  });
});
