import fs from "fs";
import path from "path";
import CommonAPI from "../../../Server/API/CommonAPI";
import LogAggregationService from "../../../Server/Services/LogAggregationService";
import TraceAggregationService from "../../../Server/Services/TraceAggregationService";
import ExceptionAggregationService from "../../../Server/Services/ExceptionAggregationService";
import MetricAggregationService from "../../../Server/Services/MetricAggregationService";
import ProfileAggregationService from "../../../Server/Services/ProfileAggregationService";
import ProfileService from "../../../Server/Services/ProfileService";
import ProfileSampleService from "../../../Server/Services/ProfileSampleService";
import TelemetryAttributeService from "../../../Server/Services/TelemetryAttributeService";
import LlmConversationService from "../../../Server/Services/LlmConversationService";
import {
  LLM_CONVERSATION_DEFAULT_LOOKBACK_MS,
  LLM_CONVERSATION_HINT_PADDING_MS,
  LLM_CONVERSATION_MAX_PAGE_SIZE,
  LlmConversationKeyKind,
  LlmConversationSort,
} from "../../../Types/Telemetry/LlmConversationApi";
import { LlmAnswerIssue } from "../../../Types/Telemetry/LlmAnswerIssue";
import { LLM_MONITOR_DEFAULT_WINDOW_SECONDS } from "../../../Types/Monitor/MonitorStepLlmMonitor";
import BadDataException from "../../../Types/Exception/BadDataException";
import TelemetryReadAccess from "../../../Server/Utils/Telemetry/TelemetryReadAccess";
import TelemetrySourceMapService from "../../../Server/Services/TelemetrySourceMapService";
import OwnerTableRegistry from "../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import ResourceFacetResolver, {
  ResourceFacetEntity,
  ResourceFacetListSpec,
} from "../../../Server/Utils/Telemetry/ResourceFacetResolver";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "../../../Server/Utils/Telemetry/TelemetryReadScope";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { MockFunction } from "../../MockType";
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
 * EVERY /telemetry/* READ FOLLOWS THE CALLER'S READ SCOPE.
 *
 * Each route below runs through its real guards and handler; only the
 * ClickHouse reads behind it (the aggregation services) and the Postgres
 * lookups behind the owner table registry are answered here. Four callers
 * read the same project:
 *
 *   - a project-wide reader, who reads every service;
 *   - a reader limited to label A, who reads service A only;
 *   - a reader limited to what they own, who reads service B (which they
 *     own) and the project's unattributed bucket;
 *   - a project-wide reader with a block on label C, who reads every service
 *     but C.
 *
 * For each route the request its aggregation read receives must say exactly
 * that: the services to keep (serviceIds) and the services to leave out
 * (excludedServiceIds).
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

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const TEAM_ID: ObjectID = ObjectID.generate();

// Carries label A: what the label-A reader reads.
const SERVICE_A: ObjectID = ObjectID.generate();
// Owned by the caller: what the Owned reader reads.
const SERVICE_B: ObjectID = ObjectID.generate();
// Carries label C: what the block takes away.
const SERVICE_C: ObjectID = ObjectID.generate();

const LABEL_A: ObjectID = ObjectID.generate();
const LABEL_C: ObjectID = ObjectID.generate();

const NO_RESOURCE: string = TelemetryReadScopeUtil.NO_RESOURCE_ID;

type PrincipalName =
  | "project-wide"
  | "label A"
  | "owned"
  | "project-wide, label C blocked";

const PRINCIPALS: Array<PrincipalName> = [
  "project-wide",
  "label A",
  "owned",
  "project-wide, label C blocked",
];

// What each reader's reads keep and leave out, as sorted id strings.
interface ExpectedFilter {
  serviceIds: Array<string>;
  excludedServiceIds: Array<string>;
}

function sortedIds(...ids: Array<ObjectID | string>): Array<string> {
  return ids
    .map((id: ObjectID | string) => {
      return id.toString();
    })
    .sort();
}

const EXPECTED: Record<PrincipalName, ExpectedFilter> = {
  "project-wide": { serviceIds: [], excludedServiceIds: [] },
  "label A": { serviceIds: sortedIds(SERVICE_A), excludedServiceIds: [] },
  owned: {
    serviceIds: sortedIds(SERVICE_B, PROJECT_ID),
    excludedServiceIds: [],
  },
  "project-wide, label C blocked": {
    serviceIds: [],
    excludedServiceIds: sortedIds(SERVICE_C),
  },
};

/*
 * The same readers asking for services A and C by id: each keeps the ones
 * they may read, and a reader who may read neither matches nothing.
 */
const EXPECTED_WHEN_ASKING_FOR_A_AND_C: Record<PrincipalName, ExpectedFilter> =
  {
    "project-wide": {
      serviceIds: sortedIds(SERVICE_A, SERVICE_C),
      excludedServiceIds: [],
    },
    "label A": { serviceIds: sortedIds(SERVICE_A), excludedServiceIds: [] },
    owned: { serviceIds: [NO_RESOURCE], excludedServiceIds: [] },
    "project-wide, label C blocked": {
      serviceIds: sortedIds(SERVICE_A),
      excludedServiceIds: sortedIds(SERVICE_C),
    },
  };

function row(
  permission: Permission,
  data: {
    scope?: PermissionScope;
    labelIds?: Array<ObjectID>;
    isBlockPermission?: boolean;
  },
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    scope: data.scope,
    labelIds: data.labelIds || [],
    isBlockPermission: data.isBlockPermission || false,
  };
}

function rowsFor(
  principal: PrincipalName,
  permission: Permission,
): Array<UserPermission> {
  switch (principal) {
    case "project-wide":
      return [row(permission, { scope: PermissionScope.All })];
    case "label A":
      return [
        row(permission, { scope: PermissionScope.Labels, labelIds: [LABEL_A] }),
      ];
    case "owned":
      return [row(permission, { scope: PermissionScope.Owned })];
    case "project-wide, label C blocked":
      return [
        row(permission, { scope: PermissionScope.All }),
        row(permission, { labelIds: [LABEL_C], isBlockPermission: true }),
      ];
  }
}

interface Principal {
  request: JSONObject;
  props: DatabaseCommonInteractionProps;
}

function principalFor(
  principal: PrincipalName,
  permission: Permission,
): Principal {
  const permissionMap: JSONObject = {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: rowsFor(principal, permission),
    },
  } as unknown as JSONObject;

  return {
    request: {
      userType: UserType.User,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: permissionMap,
      userAuthorization: { userId: USER_ID },
    } as unknown as JSONObject,
    props: {
      tenantId: PROJECT_ID,
      userId: USER_ID,
      userType: UserType.User,
      userTeamIds: [TEAM_ID],
      userTenantAccessPermission: permissionMap as never,
    },
  };
}

interface CallResult {
  thrownToNext: unknown;
  errorResponse: unknown;
}

function findRoute(method: string, uri: string): RecordedRoute {
  const route: RecordedRoute | undefined = recordedRoutes.find(
    (candidate: RecordedRoute): boolean => {
      return candidate.method === method && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`Route not registered: ${method} ${uri}`);
  }

  return route;
}

/*
 * Runs a recorded route's chain from requireUserAuthentication on (index 0,
 * getUserMiddleware, only fills the session fields the request carries
 * here already).
 */
async function callRoute(data: {
  method?: string;
  uri: string;
  principal: Principal;
  body?: JSONObject;
  params?: Record<string, string>;
}): Promise<CallResult> {
  const route: RecordedRoute = findRoute(data.method || "POST", data.uri);

  const req: ExpressRequest = {
    ...data.principal.request,
    body: data.body || {},
    params: data.params || {},
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

  const outcome: CallResult = {
    thrownToNext: undefined,
    errorResponse: undefined,
  };

  for (let index: number = 1; index < route.handlers.length; index++) {
    const handler: RouterFunction | undefined = route.handlers[index];

    if (!handler) {
      break;
    }

    const step: { calledNext: boolean } = { calledNext: false };

    const next: NextFunction = ((error?: unknown): void => {
      step.calledNext = true;

      if (error) {
        outcome.thrownToNext = error;
      }
    }) as unknown as NextFunction;

    await handler(req, res, next);

    if (!step.calledNext || outcome.thrownToNext) {
      break;
    }
  }

  const errorCall: Array<unknown> | undefined = (
    Response.sendErrorResponse as unknown as jest.Mock
  ).mock.calls[0] as Array<unknown> | undefined;
  outcome.errorResponse = errorCall ? errorCall[2] : undefined;

  return outcome;
}

interface Spy {
  mock: { calls: Array<Array<unknown>> };
  mockImplementation: (implementation: (...args: Array<any>) => any) => unknown;
  mockResolvedValue: (value: unknown) => unknown;
}

function spyOn(target: unknown, method: string): Spy {
  return jest.spyOn(target as never, method as never) as unknown as Spy;
}

function idStrings(ids: unknown): Array<string> {
  if (!Array.isArray(ids)) {
    return [];
  }

  return (ids as Array<ObjectID | string>)
    .map((id: ObjectID | string) => {
      return id.toString();
    })
    .sort();
}

function filterOf(request: unknown): ExpectedFilter {
  const filter: TelemetryServiceFilter = (request ||
    {}) as TelemetryServiceFilter;

  return {
    serviceIds: idStrings(filter.serviceIds),
    excludedServiceIds: idStrings(filter.excludedServiceIds),
  };
}

const lookupMocks: Map<string, { user: MockFunction; model: MockFunction }> =
  new Map();

function mockRegistryLookups(): void {
  lookupMocks.clear();

  for (const [name, entry] of OwnerTableRegistry.entries()) {
    if (!entry.canOwnTelemetry || !entry.modelService) {
      continue;
    }

    const isService: boolean = name === "Service";

    const user: MockFunction = jest
      .spyOn(entry.ownerUserService, "findBy")
      .mockResolvedValue(
        isService ? [{ [entry.fkColumn]: SERVICE_B }] : ([] as never),
      ) as unknown as MockFunction;

    jest.spyOn(entry.ownerTeamService, "findBy").mockResolvedValue([] as never);

    const model: MockFunction = jest
      .spyOn(entry.modelService, "findBy")
      .mockImplementation((async (request: {
        query: Record<string, unknown>;
      }) => {
        if (!isService) {
          return [];
        }

        const labelIds: Array<string> = (
          (request.query["labels"] as Array<ObjectID>) || []
        ).map((id: ObjectID) => {
          return id.toString();
        });

        const ids: Array<ObjectID> = [];
        if (labelIds.includes(LABEL_A.toString())) {
          ids.push(SERVICE_A);
        }
        if (labelIds.includes(LABEL_C.toString())) {
          ids.push(SERVICE_C);
        }

        return ids.map((id: ObjectID) => {
          return { _id: id.toString() };
        });
      }) as never) as unknown as MockFunction;

    lookupMocks.set(name, { user, model });
  }
}

/*
 * One /telemetry/* route whose read is handed a service filter: how to
 * call it, the read it ends in, and where in that read the filter is.
 */
interface RouteCase {
  uri: string;
  // The grant every reader of this route holds (its scope varies).
  permission: Permission;
  body: JSONObject;
  // Whether the route takes the services to read in its body (serviceIds).
  takesServiceIds: boolean;
  // Installs the read the route ends in; returns the spy to inspect.
  stub: () => Spy;
  // The filter that read was handed, from its first call.
  filterFrom: (call: Array<unknown>) => unknown;
}

const LAST_HOUR: JSONObject = {
  startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  endTime: new Date().toISOString(),
};

function aggregationCase(
  uri: string,
  service: unknown,
  method: string,
  body: JSONObject,
  result: unknown,
  takesServiceIds: boolean,
  permission: Permission = Permission.ProjectMember,
): RouteCase {
  return {
    uri,
    permission,
    body,
    takesServiceIds,
    stub: (): Spy => {
      const spy: Spy = spyOn(service, method);
      spy.mockResolvedValue(result);
      return spy;
    },
    filterFrom: (call: Array<unknown>): unknown => {
      return call[0];
    },
  };
}

function attributeCase(
  uri: string,
  method: "fetchAttributes" | "fetchAttributeValues",
  permission: Permission = Permission.ProjectMember,
): RouteCase {
  return {
    uri,
    permission,
    body: method === "fetchAttributeValues" ? { attributeKey: "k8s.pod" } : {},
    takesServiceIds: false,
    stub: (): Spy => {
      const spy: Spy = spyOn(TelemetryAttributeService, method);
      spy.mockResolvedValue([]);
      return spy;
    },
    filterFrom: (call: Array<unknown>): unknown => {
      return (call[0] as { serviceFilter?: unknown }).serviceFilter;
    },
  };
}

const ROUTE_CASES: Array<RouteCase> = [
  // Attribute pickers.
  attributeCase("/telemetry/logs/get-attributes", "fetchAttributes"),
  attributeCase("/telemetry/logs/get-attribute-values", "fetchAttributeValues"),
  attributeCase("/telemetry/traces/get-attributes", "fetchAttributes"),
  attributeCase(
    "/telemetry/traces/get-attribute-values",
    "fetchAttributeValues",
  ),
  attributeCase("/telemetry/metrics/get-attributes", "fetchAttributes"),
  attributeCase(
    "/telemetry/metrics/get-attribute-values",
    "fetchAttributeValues",
  ),
  attributeCase("/telemetry/exceptions/get-attributes", "fetchAttributes"),
  attributeCase(
    "/telemetry/exceptions/get-attribute-values",
    "fetchAttributeValues",
  ),
  attributeCase(
    "/telemetry/security-events/get-attributes",
    "fetchAttributes",
    Permission.SecurityViewer,
  ),
  attributeCase(
    "/telemetry/security-events/get-attribute-values",
    "fetchAttributeValues",
    Permission.SecurityViewer,
  ),
  // Logs.
  aggregationCase(
    "/telemetry/logs/histogram",
    LogAggregationService,
    "getHistogram",
    {},
    [],
    true,
  ),
  aggregationCase(
    "/telemetry/logs/facets",
    LogAggregationService,
    "getFacetValues",
    { facetKeys: ["severityText"] },
    [],
    true,
  ),
  aggregationCase(
    "/telemetry/logs/analytics",
    LogAggregationService,
    "getAnalyticsTimeseries",
    {},
    [],
    true,
  ),
  aggregationCase(
    "/telemetry/logs/error-patterns",
    LogAggregationService,
    "getTopErrorPatterns",
    {},
    [],
    true,
  ),
  aggregationCase(
    "/telemetry/logs/error-pattern-correlation",
    LogAggregationService,
    "getErrorPatternTimeline",
    { pattern: "connection refused" },
    [],
    true,
  ),
  aggregationCase(
    "/telemetry/logs/export",
    LogAggregationService,
    "getExportLogs",
    {},
    [],
    true,
  ),
  aggregationCase(
    "/telemetry/logs/drop-filter-estimate",
    LogAggregationService,
    "getDropFilterEstimate",
    { filterQuery: "severityText = 'DEBUG'" },
    { totalLogs: 0, matchingLogs: 0, estimatedReductionPercent: 0 },
    true,
  ),

  // Traces.
  aggregationCase(
    "/telemetry/traces/histogram",
    TraceAggregationService,
    "getHistogram",
    {},
    [],
    true,
  ),
  aggregationCase(
    "/telemetry/traces/facets",
    TraceAggregationService,
    "getFacetValuesFromSample",
    { facetKeys: ["kind"] },
    { kind: [] },
    true,
  ),
  aggregationCase(
    "/telemetry/traces/analytics",
    TraceAggregationService,
    "getAnalyticsTimeseries",
    {},
    [],
    true,
  ),

  // AI / LLM conversations: AI calls are trace spans.
  aggregationCase(
    "/telemetry/llm/conversations",
    LlmConversationService,
    "listConversations",
    { includeSummary: true },
    { summary: null, conversations: [], hasMore: false },
    true,
  ),
  aggregationCase(
    "/telemetry/llm/conversation",
    LlmConversationService,
    "getConversation",
    { key: "c:conv-1" },
    {
      key: "c:conv-1",
      kind: "conversation",
      conversationId: "conv-1",
      transcript: { steps: [] },
      truncated: false,
    },
    false,
  ),
  /*
   * The AI / LLM monitor form's preview. Its apps come as the monitor
   * step's own telemetryServiceIds, not serviceIds - pinned in the AI / LLM
   * describe below.
   */
  aggregationCase(
    "/telemetry/llm/answer-stats",
    LlmConversationService,
    "countAnswers",
    {},
    { answerCount: 0, badAnswerCount: 0 },
    false,
  ),

  // Exceptions.
  aggregationCase(
    "/telemetry/exceptions/histogram",
    ExceptionAggregationService,
    "getHistogram",
    {},
    [],
    true,
  ),
  aggregationCase(
    "/telemetry/exceptions/facets",
    ExceptionAggregationService,
    "getFacetValues",
    { facetKeys: ["exceptionType"] },
    [],
    true,
  ),

  // Metrics.
  aggregationCase(
    "/telemetry/metrics/facets",
    MetricAggregationService,
    "getFacetValues",
    { facetKeys: ["primaryEntityId"] },
    [],
    true,
  ),
  aggregationCase(
    "/telemetry/metrics/for-trace",
    MetricAggregationService,
    "getMetricsForTrace",
    { traceId: "4bf92f3577b34da6a3ce929d0e0e4736" },
    [],
    false,
  ),

  // Profiles.
  aggregationCase(
    "/telemetry/profiles/flamegraph",
    ProfileAggregationService,
    "getFlamegraph",
    { ...LAST_HOUR },
    { name: "root", value: 0, children: [] },
    true,
  ),
  aggregationCase(
    "/telemetry/profiles/function-list",
    ProfileAggregationService,
    "getFunctionList",
    { ...LAST_HOUR },
    [],
    true,
  ),
  aggregationCase(
    "/telemetry/profiles/service-activity",
    ProfileAggregationService,
    "getServiceActivity",
    {},
    [],
    false,
  ),
  aggregationCase(
    "/telemetry/profiles/diff-flamegraph",
    ProfileAggregationService,
    "getDiffFlamegraph",
    {
      baselineStartTime: LAST_HOUR["startTime"],
      baselineEndTime: LAST_HOUR["endTime"],
      comparisonStartTime: LAST_HOUR["startTime"],
      comparisonEndTime: LAST_HOUR["endTime"],
    },
    { name: "root", value: 0, children: [] },
    true,
  ),
  aggregationCase(
    "/telemetry/profiles/function-focus",
    ProfileAggregationService,
    "getFunctionFocus",
    { ...LAST_HOUR, functionName: "handleRequest" },
    { callers: [], callees: [] },
    true,
  ),
  aggregationCase(
    "/telemetry/profiles/breakdown",
    ProfileAggregationService,
    "getBreakdown",
    { ...LAST_HOUR, breakdownBy: "service" },
    [],
    true,
  ),
  aggregationCase(
    "/telemetry/profiles/trace-presence",
    ProfileAggregationService,
    "getTracePresence",
    { traceId: "4bf92f3577b34da6a3ce929d0e0e4736" },
    { sampleCount: 0 },
    false,
  ),
];

let currentPrincipal: Principal;

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
  mockRegistryLookups();

  // Every request carries its own props, as a real request does.
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation((async () => {
      return { ...currentPrincipal.props };
    }) as never);

  // The resource facets list one row each, so their counts are read.
  spyOn(ResourceFacetResolver, "listEntities").mockImplementation(
    async (
      _projectId: ObjectID,
      specs: Array<ResourceFacetListSpec>,
    ): Promise<Record<string, Array<ResourceFacetEntity>>> => {
      return Object.fromEntries(
        specs.map((spec: ResourceFacetListSpec) => {
          return [
            spec.facetKey,
            [{ id: SERVICE_A.toString(), displayName: "Service A" }],
          ];
        }),
      ) as Record<string, Array<ResourceFacetEntity>>;
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(ROUTE_CASES)("$uri", (routeCase: RouteCase) => {
  test.each(PRINCIPALS)(
    "a %s reader's read keeps exactly the services they may read",
    async (principalName: PrincipalName) => {
      currentPrincipal = principalFor(principalName, routeCase.permission);
      const read: Spy = routeCase.stub();

      const result: CallResult = await callRoute({
        uri: routeCase.uri,
        principal: currentPrincipal,
        body: routeCase.body,
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(result.errorResponse).toBeUndefined();
      expect(read.mock.calls.length).toBeGreaterThan(0);

      for (const call of read.mock.calls) {
        expect(filterOf(routeCase.filterFrom(call))).toEqual(
          EXPECTED[principalName],
        );
      }
    },
  );

  if (routeCase.takesServiceIds) {
    test.each(PRINCIPALS)(
      "a %s reader asking for services by id keeps only those they may read",
      async (principalName: PrincipalName) => {
        currentPrincipal = principalFor(principalName, routeCase.permission);
        const read: Spy = routeCase.stub();

        await callRoute({
          uri: routeCase.uri,
          principal: currentPrincipal,
          body: {
            ...routeCase.body,
            serviceIds: [SERVICE_A.toString(), SERVICE_C.toString()],
          },
        });

        expect(read.mock.calls.length).toBeGreaterThan(0);
        expect(filterOf(routeCase.filterFrom(read.mock.calls[0]!))).toEqual(
          EXPECTED_WHEN_ASKING_FOR_A_AND_C[principalName],
        );
      },
    );
  }
});

/*
 * The *AllOperationalResources wildcard is a grant over the whole project on
 * every telemetry model (Log, Span, Metric, ExceptionInstance, Profile,
 * ProfileSample are operational resources), so a caller holding only it
 * reads every service - on each route whose guard lets it in. Security
 * events are not operational resources: their routes do not take it.
 */
describe("a caller holding only the operational-resource wildcard", () => {
  const WILDCARD_CASES: Array<RouteCase> = ROUTE_CASES.filter(
    (routeCase: RouteCase): boolean => {
      return !routeCase.uri.startsWith("/telemetry/security-events/");
    },
  );

  test("is checked on every route but the security event ones", () => {
    expect(WILDCARD_CASES.length).toBe(ROUTE_CASES.length - 2);
    expect(
      WILDCARD_CASES.some((routeCase: RouteCase): boolean => {
        return routeCase.uri.startsWith("/telemetry/profiles/");
      }),
    ).toBe(true);
  });

  test.each(
    WILDCARD_CASES.map((routeCase: RouteCase) => {
      return [routeCase.uri, routeCase] as [string, RouteCase];
    }),
  )("%s reads every service", async (_uri: string, routeCase: RouteCase) => {
    currentPrincipal = principalFor(
      "project-wide",
      Permission.ReadAllOperationalResources,
    );
    const read: Spy = routeCase.stub();

    const result: CallResult = await callRoute({
      uri: routeCase.uri,
      principal: currentPrincipal,
      body: routeCase.body,
    });

    expect(result.thrownToNext).toBeUndefined();
    expect(result.errorResponse).toBeUndefined();
    expect(read.mock.calls.length).toBeGreaterThan(0);

    for (const call of read.mock.calls) {
      expect(filterOf(routeCase.filterFrom(call))).toEqual(
        EXPECTED["project-wide"],
      );
    }
  });
});

describe("resource facet listings follow the same scope", () => {
  test.each(PRINCIPALS)(
    "the services listed to a %s reader are the ones they may read",
    async (principalName: PrincipalName) => {
      currentPrincipal = principalFor(principalName, Permission.ProjectMember);
      spyOn(LogAggregationService, "getFacetValues").mockResolvedValue([]);

      await callRoute({
        uri: "/telemetry/logs/facets",
        principal: currentPrincipal,
        body: { facetKeys: ["primaryEntityId"] },
      });

      const listEntities: Spy = ResourceFacetResolver.listEntities as never;
      const specs: Array<ResourceFacetListSpec> = listEntities.mock
        .calls[0]![1] as Array<ResourceFacetListSpec>;
      const scope: TelemetryReadScope = specs[0]!.scope!;

      const expected: ExpectedFilter = EXPECTED[principalName];
      expect(sortedIds(...(scope.blockedIds || []))).toEqual(
        expected.excludedServiceIds,
      );
      expect(
        scope.readableIds === null ? [] : sortedIds(...scope.readableIds),
      ).toEqual(expected.serviceIds);
    },
  );
});

describe("/telemetry/logs/context", () => {
  const SERVICES: Record<string, ObjectID> = {
    "service A": SERVICE_A,
    "service B": SERVICE_B,
    "service C": SERVICE_C,
  };

  test.each([
    ["project-wide", "service C", "reads them"],
    ["label A", "service A", "reads them"],
    ["label A", "service B", "reads none"],
    ["owned", "service B", "reads them"],
    ["owned", "service A", "reads none"],
    ["project-wide, label C blocked", "service A", "reads them"],
    ["project-wide, label C blocked", "service C", "reads none"],
  ] as Array<[PrincipalName, string, "reads them" | "reads none"]>)(
    "a %s reader asking for the lines around a log of %s %s",
    async (
      principalName: PrincipalName,
      serviceName: string,
      outcome: "reads them" | "reads none",
    ) => {
      const serviceId: ObjectID = SERVICES[serviceName]!;
      const readable: boolean = outcome === "reads them";
      currentPrincipal = principalFor(principalName, Permission.ProjectMember);
      const read: Spy = spyOn(LogAggregationService, "getLogContext");
      read.mockResolvedValue({ before: [{ body: "x" }], after: [] });

      await callRoute({
        uri: "/telemetry/logs/context",
        principal: currentPrincipal,
        body: {
          logId: "log-1",
          primaryEntityId: serviceId.toString(),
          time: new Date().toISOString(),
        },
      });

      expect(read.mock.calls.length).toBe(readable ? 1 : 0);

      if (!readable) {
        // Answered as a resource with no logs: nothing before or after.
        const body: JSONObject = (
          Response.sendJsonObjectResponse as unknown as jest.Mock
        ).mock.calls[0]![2] as JSONObject;
        expect(body).toEqual({ before: [], after: [] });
      }
    },
  );
});

/*
 * Profiles have no attribute keys to offer, so their attribute picker
 * answers with none and works out nothing about the caller's scope.
 */
describe("/telemetry/profiles/get-attributes", () => {
  test.each(PRINCIPALS)(
    "a %s reader gets no attributes, and nothing is looked up",
    async (principalName: PrincipalName) => {
      currentPrincipal = principalFor(principalName, Permission.ProjectMember);
      const fetchAttributes: Spy = spyOn(
        TelemetryAttributeService,
        "fetchAttributes",
      );
      const getServiceFilter: Spy = spyOn(
        TelemetryReadAccess,
        "getServiceFilter",
      );

      const result: CallResult = await callRoute({
        uri: "/telemetry/profiles/get-attributes",
        principal: currentPrincipal,
        body: {},
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(result.errorResponse).toBeUndefined();
      expect(fetchAttributes.mock.calls.length).toBe(0);
      expect(getServiceFilter.mock.calls.length).toBe(0);

      const body: JSONObject = (
        Response.sendJsonObjectResponse as unknown as jest.Mock
      ).mock.calls[0]![2] as JSONObject;
      expect(body).toEqual({ attributes: [] });
    },
  );
});

describe("/telemetry/profiles/:profileId/pprof", () => {
  test.each(PRINCIPALS)(
    "a %s reader's profile lookup is narrowed to the services they may read",
    async (principalName: PrincipalName) => {
      currentPrincipal = principalFor(principalName, Permission.ProjectMember);
      const profileRead: Spy = spyOn(ProfileService, "findBy");
      profileRead.mockResolvedValue([]);
      const sampleRead: Spy = spyOn(ProfileSampleService, "findBy");
      sampleRead.mockResolvedValue([]);

      const result: CallResult = await callRoute({
        method: "GET",
        uri: "/telemetry/profiles/:profileId/pprof",
        principal: currentPrincipal,
        params: { profileId: "profile-1" },
      });

      // Nothing matched: answered as a profile that does not exist.
      expect(String(result.errorResponse)).toContain("Profile not found");
      expect(sampleRead.mock.calls.length).toBe(0);

      const query: Record<string, unknown> = (
        profileRead.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(query["profileId"]).toBe("profile-1");

      const expected: ExpectedFilter = EXPECTED[principalName];
      const operator: unknown = query["primaryEntityId"];

      if (expected.serviceIds.length > 0) {
        expect(operator).toBeInstanceOf(Includes);
        expect(sortedIds(...(operator as Includes).values.map(String))).toEqual(
          expected.serviceIds,
        );
      } else if (expected.excludedServiceIds.length > 0) {
        expect(operator).toBeInstanceOf(IncludesNone);
        expect(
          sortedIds(...(operator as IncludesNone).values.map(String)),
        ).toEqual(expected.excludedServiceIds);
      } else {
        expect(operator).toBeUndefined();
      }
    },
  );
});

describe("a block with no labels", () => {
  test("refuses a telemetry read before anything is read", async () => {
    currentPrincipal = principalFor("project-wide", Permission.ProjectMember);
    (
      currentPrincipal.props.userTenantAccessPermission![PROJECT_ID.toString()]!
        .permissions as Array<UserPermission>
    ).push(
      row(Permission.ReadTelemetryServiceLog, { isBlockPermission: true }),
    );
    const read: Spy = spyOn(LogAggregationService, "getHistogram");
    read.mockResolvedValue([]);

    const result: CallResult = await callRoute({
      uri: "/telemetry/logs/histogram",
      principal: currentPrincipal,
      body: {},
    });

    expect(result.thrownToNext ?? result.errorResponse).toBeDefined();
    expect(read.mock.calls.length).toBe(0);
  });
});

describe("/telemetry/exceptions/resolve-stack-trace", () => {
  const FRAMES: Array<JSONObject> = [
    {
      fileName: "https://app.example.com/main.js",
      lineNumber: 1,
      columnNumber: 10,
    },
  ];

  const SERVICES: Record<string, ObjectID> = {
    "service A": SERVICE_A,
    "service B": SERVICE_B,
    "service C": SERVICE_C,
  };

  test.each([
    ["label A", "service A", "resolves them"],
    ["label A", "service B", "leaves them as they came"],
    ["owned", "service B", "resolves them"],
    ["project-wide, label C blocked", "service C", "leaves them as they came"],
  ] as Array<[PrincipalName, string, string]>)(
    "a %s reader's frames of %s: the server %s",
    async (
      principalName: PrincipalName,
      serviceName: string,
      outcome: string,
    ) => {
      const serviceId: ObjectID = SERVICES[serviceName]!;
      currentPrincipal = principalFor(principalName, Permission.ProjectMember);
      const resolve: Spy = spyOn(
        TelemetrySourceMapService,
        "resolveFramesForService",
      );
      resolve.mockResolvedValue({
        frames: [],
        resolvedCount: 1,
        sourceMapCount: 1,
        sourceMapsSkippedForSize: 0,
      });

      await callRoute({
        uri: "/telemetry/exceptions/resolve-stack-trace",
        principal: currentPrincipal,
        body: {
          serviceId: serviceId.toString(),
          serviceVersion: "1.0.0",
          frames: FRAMES,
        },
      });

      const body: JSONObject = (
        Response.sendJsonObjectResponse as unknown as jest.Mock
      ).mock.calls[0]![2] as JSONObject;

      if (outcome === "resolves them") {
        expect(resolve.mock.calls.length).toBe(1);
        expect(body["resolvedCount"]).toBe(1);
      } else {
        // As a service with no source maps answers: every frame as it came.
        expect(resolve.mock.calls.length).toBe(0);
        expect(body["resolvedCount"]).toBe(0);
        expect(body["sourceMapCount"]).toBe(0);
        expect((body["frames"] as Array<JSONObject>)[0]!["resolved"]).toBe(
          false,
        );
      }
    },
  );
});

/*
 * A new /telemetry/* route has to join one of the suites that pin its
 * scope, and has to read through the shared scope (TelemetryReadAccess, or
 * the session replay helpers built on it). Both are checked here, so a read
 * that skips the scope fails CI.
 */
/*
 * The AI conversation routes read the request body themselves; these pin
 * what reaches the read: filters trimmed and bounded, the window, and the
 * refusals that must answer before anything is read.
 */
describe("the AI / LLM monitor preview route", () => {
  const STATS: string = "/telemetry/llm/answer-stats";

  test.each(PRINCIPALS)(
    "a %s reader asking for apps by id keeps only those they may read",
    async (principalName: PrincipalName) => {
      currentPrincipal = principalFor(principalName, Permission.ProjectMember);
      const read: Spy = spyOn(LlmConversationService, "countAnswers");
      read.mockResolvedValue({ answerCount: 0, badAnswerCount: 0 });

      await callRoute({
        uri: STATS,
        principal: currentPrincipal,
        body: {
          telemetryServiceIds: [SERVICE_A.toString(), SERVICE_C.toString()],
        },
      });

      expect(read.mock.calls.length).toBe(1);
      expect(filterOf(read.mock.calls[0]![0])).toEqual(
        EXPECTED_WHEN_ASKING_FOR_A_AND_C[principalName],
      );
    },
  );

  test("the step's settings reach the count as the monitor's check reads them", async () => {
    currentPrincipal = principalFor("project-wide", Permission.ProjectMember);
    const read: Spy = spyOn(LlmConversationService, "countAnswers");
    read.mockResolvedValue({ answerCount: 40, badAnswerCount: 3 });

    const result: CallResult = await callRoute({
      uri: STATS,
      principal: currentPrincipal,
      body: {
        issues: [LlmAnswerIssue.Refused, "bogus", LlmAnswerIssue.CutOff],
        slowAnswerSeconds: 30,
        model: "  gpt-4o  ",
        lastXSecondsOfCalls: 3600,
      },
    });

    const request: Record<string, unknown> = read.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect(request["projectId"]).toEqual(PROJECT_ID);
    expect(request["issues"]).toEqual([
      LlmAnswerIssue.Refused,
      LlmAnswerIssue.CutOff,
    ]);
    expect(request["slowAnswerMs"]).toBe(30_000);
    expect(request["model"]).toBe("gpt-4o");
    expect(
      (request["endTime"] as Date).getTime() -
        (request["startTime"] as Date).getTime(),
    ).toBe(3600 * 1000);

    expect(result.errorResponse).toBeUndefined();
    expect(
      (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
        .calls[0]![2],
    ).toMatchObject({
      answerCount: 40,
      badAnswerCount: 3,
      badAnswerPercent: 7.5,
    });
  });

  test("an empty step reads every problem over the default window", async () => {
    currentPrincipal = principalFor("project-wide", Permission.ProjectMember);
    const read: Spy = spyOn(LlmConversationService, "countAnswers");
    read.mockResolvedValue({ answerCount: 0, badAnswerCount: 0 });

    const result: CallResult = await callRoute({
      uri: STATS,
      principal: currentPrincipal,
      body: {},
    });

    const request: Record<string, unknown> = read.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect(request["issues"]).toEqual([
      LlmAnswerIssue.Failed,
      LlmAnswerIssue.Refused,
      LlmAnswerIssue.CutOff,
      LlmAnswerIssue.Empty,
      LlmAnswerIssue.Flagged,
    ]);
    expect(request["slowAnswerMs"]).toBeNull();
    expect(request["model"]).toBeUndefined();
    expect(
      (request["endTime"] as Date).getTime() -
        (request["startTime"] as Date).getTime(),
    ).toBe(LLM_MONITOR_DEFAULT_WINDOW_SECONDS * 1000);

    // No answers is 0%, not a division by zero.
    expect(result.errorResponse).toBeUndefined();
    expect(
      (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
        .calls[0]![2],
    ).toMatchObject({
      answerCount: 0,
      badAnswerCount: 0,
      badAnswerPercent: 0,
    });
  });
});

describe("the AI / LLM conversation routes", () => {
  const LIST: string = "/telemetry/llm/conversations";
  const DETAIL: string = "/telemetry/llm/conversation";

  function firstRequest(read: Spy): Record<string, unknown> {
    return read.mock.calls[0]![0] as Record<string, unknown>;
  }

  test("the list passes its filters through, trimmed and bounded", async () => {
    currentPrincipal = principalFor("project-wide", Permission.ProjectMember);
    const read: Spy = spyOn(LlmConversationService, "listConversations");
    read.mockResolvedValue({ summary: null, conversations: [], hasMore: false });

    await callRoute({
      uri: LIST,
      principal: currentPrincipal,
      body: {
        ...LAST_HOUR,
        model: "  gpt-4o  ",
        person: "ada@",
        search: "x".repeat(500),
        issue: LlmAnswerIssue.Refused,
        sort: LlmConversationSort.MostExpensive,
        limit: 100000,
        skip: -20,
        includeSummary: true,
      },
    });

    const request: Record<string, unknown> = firstRequest(read);

    expect(request["projectId"]).toEqual(PROJECT_ID);
    expect(request["model"]).toBe("gpt-4o");
    expect(request["person"]).toBe("ada@");
    expect((request["search"] as string).length).toBe(200);
    expect(request["issue"]).toBe(LlmAnswerIssue.Refused);
    expect(request["sort"]).toBe(LlmConversationSort.MostExpensive);
    expect(request["limit"]).toBe(LLM_CONVERSATION_MAX_PAGE_SIZE);
    expect(request["skip"]).toBe(0);
    expect(request["includeSummary"]).toBe(true);
  });

  test("unknown or blank filters read as none, and the summary only when asked", async () => {
    currentPrincipal = principalFor("project-wide", Permission.ProjectMember);
    const read: Spy = spyOn(LlmConversationService, "listConversations");
    read.mockResolvedValue({ summary: null, conversations: [], hasMore: false });

    await callRoute({
      uri: LIST,
      principal: currentPrincipal,
      body: {
        model: "   ",
        issue: "bogus",
        sort: "by-vibes",
        includeSummary: "yes",
      },
    });

    const request: Record<string, unknown> = firstRequest(read);

    expect(request["model"]).toBeUndefined();
    expect(request["issue"]).toBeUndefined();
    expect(request["sort"]).toBe(LlmConversationSort.Newest);
    expect(request["includeSummary"]).toBe(false);
    expect(request["limit"]).toBe(25);
  });

  test("without dates the list reads the last seven days", async () => {
    currentPrincipal = principalFor("project-wide", Permission.ProjectMember);
    const read: Spy = spyOn(LlmConversationService, "listConversations");
    read.mockResolvedValue({ summary: null, conversations: [], hasMore: false });

    await callRoute({ uri: LIST, principal: currentPrincipal, body: {} });

    const request: Record<string, unknown> = firstRequest(read);
    const windowMs: number =
      (request["endTime"] as Date).getTime() -
      (request["startTime"] as Date).getTime();

    expect(windowMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test("a window that ends before it starts is refused before anything is read", async () => {
    currentPrincipal = principalFor("project-wide", Permission.ProjectMember);
    const read: Spy = spyOn(LlmConversationService, "listConversations");

    const result: CallResult = await callRoute({
      uri: LIST,
      principal: currentPrincipal,
      body: {
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() - 60_000).toISOString(),
      },
    });

    expect(read.mock.calls.length).toBe(0);
    expect(result.errorResponse).toBeInstanceOf(BadDataException);
  });

  test.each([
    [undefined],
    [""],
    ["x:nope"],
    ["t:not-a-trace-id"],
    ["c:"],
    [42],
  ])(
    "a conversation view of %p is refused before anything is read",
    async (key: unknown) => {
      currentPrincipal = principalFor("project-wide", Permission.ProjectMember);
      const read: Spy = spyOn(LlmConversationService, "getConversation");

      const result: CallResult = await callRoute({
        uri: DETAIL,
        principal: currentPrincipal,
        body: { key: key as string },
      });

      expect(read.mock.calls.length).toBe(0);
      expect(result.errorResponse).toBeInstanceOf(BadDataException);
    },
  );

  test("a conversation view reads a padded window around its time hint", async () => {
    currentPrincipal = principalFor("project-wide", Permission.ProjectMember);
    const read: Spy = spyOn(LlmConversationService, "getConversation");
    read.mockResolvedValue({ transcript: { steps: [] } });

    const hintStart: Date = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const hintEnd: Date = new Date(Date.now() - 2 * 60 * 60 * 1000);

    await callRoute({
      uri: DETAIL,
      principal: currentPrincipal,
      body: {
        key: "t:0AF7651916CD43DD8448EB211C80319C",
        startTime: hintStart.toISOString(),
        endTime: hintEnd.toISOString(),
      },
    });

    const request: Record<string, unknown> = firstRequest(read);

    // Trace ids are read case-insensitively.
    expect(request["key"]).toEqual({
      kind: LlmConversationKeyKind.Request,
      value: "0af7651916cd43dd8448eb211c80319c",
    });
    expect((request["startTime"] as Date).getTime()).toBe(
      hintStart.getTime() - LLM_CONVERSATION_HINT_PADDING_MS,
    );
    expect((request["endTime"] as Date).getTime()).toBe(
      hintEnd.getTime() + LLM_CONVERSATION_HINT_PADDING_MS,
    );
  });

  test("without a hint a conversation view reads the last 30 days", async () => {
    currentPrincipal = principalFor("project-wide", Permission.ProjectMember);
    const read: Spy = spyOn(LlmConversationService, "getConversation");
    read.mockResolvedValue({ transcript: { steps: [] } });

    await callRoute({
      uri: DETAIL,
      principal: currentPrincipal,
      body: { key: "c:checkout-chat-77" },
    });

    const request: Record<string, unknown> = firstRequest(read);
    const windowMs: number =
      (request["endTime"] as Date).getTime() -
      (request["startTime"] as Date).getTime();

    expect(windowMs).toBe(LLM_CONVERSATION_DEFAULT_LOOKBACK_MS);
    expect(request["key"]).toEqual({
      kind: LlmConversationKeyKind.Conversation,
      value: "checkout-chat-77",
    });
  });
});

describe("every /telemetry/* route", () => {
  // Routes whose scope cases live outside ROUTE_CASES, and where.
  const TESTED_ON_THEIR_OWN: Record<string, string> = {
    "/telemetry/logs/context": "this file: the lines around one log",
    "/telemetry/profiles/:profileId/pprof": "this file: one profile's download",
    "/telemetry/profiles/get-attributes":
      "this file: profiles have no attributes to scope",
    "/telemetry/exceptions/resolve-stack-trace":
      "this file: frames of a service the caller may not read",
  };

  // Session replay routes: SessionReplayAPI.test.ts pins their scope.
  const SESSION_REPLAY_PREFIX: string = "/telemetry/rum/session-replay/";

  test("is in the scope matrix or has scope cases of its own", () => {
    const telemetryRoutes: Array<string> = recordedRoutes
      .map((route: RecordedRoute): string => {
        return route.uri;
      })
      .filter((uri: string): boolean => {
        return uri.startsWith("/telemetry/");
      });

    expect(telemetryRoutes.length).toBeGreaterThan(40);

    const inMatrix: Set<string> = new Set(
      ROUTE_CASES.map((routeCase: RouteCase): string => {
        return routeCase.uri;
      }),
    );

    const uncovered: Array<string> = telemetryRoutes.filter(
      (uri: string): boolean => {
        return (
          !inMatrix.has(uri) &&
          !TESTED_ON_THEIR_OWN[uri] &&
          !uri.startsWith(SESSION_REPLAY_PREFIX)
        );
      },
    );

    expect(uncovered).toEqual([]);
  });

  /*
   * The helpers a route may read its scope through. Each must itself reach
   * TelemetryReadAccess (checked below), so a route that calls one of them
   * reads only what the caller may read.
   */
  const SCOPE_HELPERS: Array<string> = [
    "getAttributes",
    "getAttributeValues",
    "scopeErrorPatternFilters",
    "getProfileServiceFilter",
    "getSessionReplayScope",
    "isApplicationInSessionReplayScope",
    "isApplicationInSessionReplayScopeById",
    "assertSessionReplayApplicationAccess",
    "canReadSessionReplayListMetadata",
    "canReadIdentifiedUserLabel",
    "resolveAccessibleRumApplicationIds",
    "resolveAuthorizedSession",
  ];

  function telemetryApiSource(): string {
    return fs.readFileSync(
      path.join(__dirname, "../../../Server/API/TelemetryAPI.ts"),
      "utf8",
    );
  }

  /*
   * The text of `name`'s definition: up to the line that closes it, a
   * lone `}` or `};` at column 0 (a parameter type closing at column 0,
   * `}): Promise<...> => {`, does not end it).
   */
  function helperSource(source: string, name: string): string {
    const match: RegExpExecArray | null = new RegExp(
      `\\n(?:const ${name}\\b[^=]*=|async function ${name}\\(|function ${name}\\()`,
    ).exec(source);

    if (!match) {
      throw new Error(`No definition of ${name} in TelemetryAPI.ts`);
    }

    const closing: RegExp = /\n\};?\n/g;
    closing.lastIndex = match.index + 1;
    const end: RegExpExecArray | null = closing.exec(source);
    return source.slice(match.index, end ? end.index : undefined);
  }

  function callsScope(text: string, helpers: Array<string>): boolean {
    if (text.includes("TelemetryReadAccess.")) {
      return true;
    }

    return helpers.some((helper: string): boolean => {
      return new RegExp(`\\b${helper}\\(`).test(text);
    });
  }

  test("every scope helper reaches TelemetryReadAccess", () => {
    const source: string = telemetryApiSource();

    // A helper counts once it calls TelemetryReadAccess or a helper that does.
    const reaching: Array<string> = [];
    let grew: boolean = true;

    while (grew) {
      grew = false;
      for (const helper of SCOPE_HELPERS) {
        if (reaching.includes(helper)) {
          continue;
        }
        if (callsScope(helperSource(source, helper), reaching)) {
          reaching.push(helper);
          grew = true;
        }
      }
    }

    expect([...reaching].sort()).toEqual([...SCOPE_HELPERS].sort());
  });

  /*
   * /telemetry/* routes registered outside TelemetryAPI.ts. Each one that
   * reads telemetry asks TelemetryReadAccess itself; one that reads no
   * telemetry row is named here with what it reads instead.
   */
  const READ_NO_TELEMETRY: Record<string, string> = {
    "App/FeatureSet/BaseAPI/API/ServiceOperationalStatus.ts":
      "the active incidents and alerts of services, read through the model layer with the caller's props",
  };

  function serverSourceFiles(directory: string): Array<string> {
    const files: Array<string> = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (
          ["node_modules", "build", "dist", "src", "Tests"].includes(entry.name)
        ) {
          continue;
        }
        files.push(...serverSourceFiles(entryPath));
      } else if (entry.name.endsWith(".ts")) {
        files.push(entryPath);
      }
    }

    return files;
  }

  test("registered outside TelemetryAPI.ts read through TelemetryReadAccess too", () => {
    const packagesRoot: string = path.join(__dirname, "../../../..");
    const routePattern: RegExp =
      /\.(?:get|post|put|delete)\(\s*"(\/telemetry\/[^"]+)"/g;

    const found: Array<string> = [];
    const unscoped: Array<string> = [];

    for (const file of [
      ...serverSourceFiles(path.join(packagesRoot, "Common/Server")),
      ...serverSourceFiles(path.join(packagesRoot, "App/FeatureSet")),
    ]) {
      const relative: string = path
        .relative(packagesRoot, file)
        .split(path.sep)
        .join("/");

      if (relative === "Common/Server/API/TelemetryAPI.ts") {
        continue;
      }

      const source: string = fs.readFileSync(file, "utf8");

      if (!routePattern.test(source)) {
        routePattern.lastIndex = 0;
        continue;
      }
      routePattern.lastIndex = 0;

      found.push(relative);

      if (
        !source.includes("TelemetryReadAccess.") &&
        !READ_NO_TELEMETRY[relative]
      ) {
        unscoped.push(relative);
      }
    }

    expect(found).toContain(
      "App/FeatureSet/BaseAPI/API/ServiceDependencyTimeseries.ts",
    );
    expect(unscoped).toEqual([]);
    // Every file named as reading no telemetry still registers a route.
    for (const named of Object.keys(READ_NO_TELEMETRY)) {
      expect(found).toContain(named);
    }
  });

  test("reads through TelemetryReadAccess or a helper that does", () => {
    const source: string = telemetryApiSource();
    const routePattern: RegExp =
      /\nrouter\.(?:get|post|put|delete)\(\s*"(\/telemetry\/[^"]+)"/g;

    const unscoped: Array<string> = [];
    let found: number = 0;
    let match: RegExpExecArray | null = routePattern.exec(source);

    while (match) {
      found++;
      // The route's own call: up to the `);` that closes router.post(.
      const end: number = source.indexOf("\n);\n", match.index);
      const routeSource: string = source.slice(match.index, end);

      if (!callsScope(routeSource, SCOPE_HELPERS)) {
        unscoped.push(match[1]!);
      }

      match = routePattern.exec(source);
    }

    expect(found).toBeGreaterThan(40);
    expect(unscoped).toEqual([]);
  });
});
