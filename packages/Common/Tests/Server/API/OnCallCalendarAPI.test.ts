import { mockRouter } from "./Helpers";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * The HTTP face of the on-call calendar feeds.
 *
 * Two levels of test live here on purpose. The pure helpers (forwarded-proto
 * resolution, the `?schedule=` filter, the client classifier, the bookkeeping
 * throttle, the /my-shifts window, the FeedStatus builders) are tested as
 * functions. Everything else goes through a REAL Express application built
 * from the routes the module registered on the mock router, over an ephemeral
 * HTTP server: the properties that matter most -- the one response rule (404
 * vs empty VCALENDAR vs 503), the header set and the header that must be
 * absent, 304 through req.fresh, HEAD being served without being counted,
 * the http->https 301 -- are Express behaviours layered on the route's own,
 * and a fake `res` object would only prove what the fake was written to do.
 *
 * The renderer, the rate-limit counter, the caches, the lock and every
 * database service are stubbed at their public seams; what is under test is
 * the route: what it looks up, what it never selects, what it hands the
 * renderer, what it writes back, and what it never logs.
 */

type EnvOverrides = {
  disableFeed: boolean;
  httpProtocol: string;
  host: string;
  trustedProxyHops: number;
  billingEnabled: boolean;
  provisionSsl: boolean;
};

type EnvMockGlobal = typeof globalThis & {
  __oneuptimeOnCallCalendarApiEnv: EnvOverrides;
};

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: EnvMockGlobal = globalThis as EnvMockGlobal;

  mockGlobal.__oneuptimeOnCallCalendarApiEnv = {
    disableFeed: false,
    httpProtocol: "https://",
    host: "oneuptime.example.com",
    trustedProxyHops: 0,
    billingEnabled: false,
    provisionSsl: true,
  };

  Object.defineProperty(mocked, "DisableOnCallCalendarFeed", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__oneuptimeOnCallCalendarApiEnv.disableFeed;
    },
  });

  Object.defineProperty(mocked, "HttpProtocol", {
    configurable: true,
    enumerable: true,
    get: (): string => {
      return mockGlobal.__oneuptimeOnCallCalendarApiEnv.httpProtocol;
    },
  });

  Object.defineProperty(mocked, "Host", {
    configurable: true,
    enumerable: true,
    get: (): string => {
      return mockGlobal.__oneuptimeOnCallCalendarApiEnv.host;
    },
  });

  Object.defineProperty(mocked, "TrustedProxyHops", {
    configurable: true,
    enumerable: true,
    get: (): number => {
      return mockGlobal.__oneuptimeOnCallCalendarApiEnv.trustedProxyHops;
    },
  });

  Object.defineProperty(mocked, "ProvisionSsl", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__oneuptimeOnCallCalendarApiEnv.provisionSsl;
    },
  });

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__oneuptimeOnCallCalendarApiEnv.billingEnabled;
    },
  });

  return mocked;
});

/*
 * Logger is replaced wholesale (it drags in the telemetry SDK) with
 * recorders, and getLogAttributesFromRequest keeps the real module's
 * behaviour -- requestId, projectId and userId only, never the URL -- so the
 * "no token in logs" assertions also cover the attributes every error log
 * line carries.
 */
jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: (
      req:
        | {
            requestId?: string;
            tenantId?: { toString: () => string } | string;
            userAuthorization?: { userId?: { toString: () => string } };
          }
        | null
        | undefined,
    ): Record<string, string> => {
      const attributes: Record<string, string> = {};

      if (!req) {
        return attributes;
      }

      if (req.requestId) {
        attributes["requestId"] = req.requestId;
      }

      if (req.tenantId) {
        attributes["projectId"] = req.tenantId.toString();
      }

      if (req.userAuthorization?.userId) {
        attributes["userId"] = req.userAuthorization.userId.toString();
      }

      return attributes;
    },
  };
});

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(() => {
        return null;
      }),
      isConnected: jest.fn(() => {
        return false;
      }),
    },
  };
});

/*
 * The session routes are registered with the real UserMiddleware functions;
 * here they pass every request through and CommonAPI.getDatabaseCommonInteractionProps
 * (spied below) decides who the caller is. The routes' own guards are what is
 * under test, not the middleware.
 */
jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: async (
        _req: unknown,
        _res: unknown,
        next: () => void,
      ): Promise<void> => {
        next();
      },
      requireUserAuthentication: async (
        _req: unknown,
        _res: unknown,
        next: () => void,
      ): Promise<void> => {
        next();
      },
    },
  };
});

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and the services below import
 * DatabaseService, which does.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import {
  BOOKKEEPING_INTERVAL_MS,
  FEED_ALLOWED_METHODS,
  FEED_CURRENT_ROUTE,
  FEED_ROTATE_ROUTE,
  FeedStatus,
  KILL_SWITCH_RETRY_AFTER_SECONDS,
  MY_SHIFTS_DEFAULT_DAYS,
  MY_SHIFTS_MAX_DAYS,
  MY_SHIFTS_ROUTE,
  PERSONAL_FEED_FALLBACK_ROUTE,
  PERSONAL_FEED_ROUTE,
  PROJECT_FEED_CURRENT_ROUTE,
  PROJECT_FEED_FALLBACK_ROUTE,
  PROJECT_FEED_PUBLISH_ROUTE,
  PROJECT_FEED_ROTATE_ROUTE,
  PROJECT_FEED_ROUTE,
  ROTATE_LOCK_NAMESPACE,
  ROTATE_LOCK_TIMEOUT_MS,
  SCHEDULE_FEED_CURRENT_ROUTE,
  SCHEDULE_FEED_FALLBACK_ROUTE,
  SCHEDULE_FEED_PUBLISH_ROUTE,
  SCHEDULE_FEED_ROTATE_ROUTE,
  SCHEDULE_FEED_ROUTE,
  assertJsonRequest,
  buildAbsentFeedStatus,
  buildFeedStatus,
  classifyCalendarClient,
  isPreviousTokenInGrace,
  readMyShiftsWindow,
  readScheduleFilter,
  resolveTrustedForwardedProto,
  shouldRecordFetch,
} from "../../../Server/API/OnCallCalendarAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import OnCallCalendarFeedCache from "../../../Server/Infrastructure/OnCallCalendarFeedCache";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import OnCallCalendarFeedRateLimit, {
  OnCallCalendarFeedRateLimitOutcome,
  OnCallCalendarFeedRateLimitScope,
} from "../../../Server/Middleware/OnCallCalendarFeedRateLimit";
import OnCallDutyPolicyScheduleCalendarFeedService from "../../../Server/Services/OnCallDutyPolicyScheduleCalendarFeedService";
import ProjectOnCallCalendarFeedService from "../../../Server/Services/ProjectOnCallCalendarFeedService";
import UserOnCallCalendarFeedService from "../../../Server/Services/UserOnCallCalendarFeedService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import CalendarFeedToken, {
  CalendarFeedRotation,
} from "../../../Server/Utils/OnCall/CalendarFeedToken";
import OnCallCalendarFeedRenderer, {
  FEED_DISABLED_REASON,
  FeedRenderOutcome,
  FeedRenderStatus,
  NO_SCHEDULES_REASON,
  PLAN_REASON,
  RENDER_CAP_RETRY_AFTER_SECONDS,
  TOKEN_ROTATED_REASON,
} from "../../../Server/Utils/OnCall/OnCallCalendarFeedRenderer";
import OnCallCalendarFeedUrls, {
  HOST_WARNING,
  PROTOCOL_WARNING,
} from "../../../Server/Utils/OnCall/OnCallCalendarFeedUrls";
import Response from "../../../Server/Utils/Response";
import Protocol from "../../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import {
  DEFAULT_FUTURE_DAYS,
  DEFAULT_PAST_DAYS,
  MAX_FUTURE_DAYS,
  MAX_PAST_DAYS,
} from "../../../Types/OnCallDutyPolicy/CalendarFeedWindow";
import { MaterializedShift } from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import OnCallCalendarFeedUtil, {
  FeedRenderResult,
  OnCallCalendarFeedKind,
} from "../../../Types/OnCallDutyPolicy/OnCallCalendarFeedUtil";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  DASHBOARD_URL,
  at,
  shift,
} from "../../Types/OnCallDutyPolicy/CalendarFeedTestFixtures";
import express from "express";
import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import path from "path";

// -- Harness ----------------------------------------------------------------

type RouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

/*
 * Helpers.ts keeps its Route type private; this is the slice of it this file
 * uses, so a change to the harness's internals cannot silently retype these
 * assertions.
 */
interface RegisteredRoute {
  method: string;
  uri: string;
  middlewares: Array<RouteHandler>;
  handlerFunction: RouteHandler;
}

/* The app mounts every custom router under /<APP_NAME> = /api. */
const API_PREFIX: string = "/api";

const NOW: Date = at("2026-09-01T12:00:00Z");

/* A token that is valid in shape (43 chars) but belongs to nobody. */
const UNKNOWN_TOKEN: string = `${"unknown".repeat(6)}_`;

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface CapturedFindOneBy {
  query: Record<string, unknown>;
  select?: Record<string, unknown> | undefined;
  props?:
    | { isRoot?: boolean | undefined; ignoreHooks?: boolean | undefined }
    | undefined;
}

interface CapturedUpdate {
  id?: ObjectID | undefined;
  query?: Record<string, unknown> | undefined;
  data: Record<string, unknown>;
  props?:
    | { isRoot?: boolean | undefined; ignoreHooks?: boolean | undefined }
    | undefined;
}

interface CapturedCreate {
  data: Record<string, unknown>;
  props?:
    | { isRoot?: boolean | undefined; ignoreHooks?: boolean | undefined }
    | undefined;
}

/*
 * A feed row as the three services hand one back: a plain object with the
 * columns the routes read. The routes only ever read properties, so a model
 * instance would add nothing but decorator noise.
 */
interface FeedRowFixture {
  id: ObjectID;
  projectId: ObjectID;
  userId?: ObjectID | undefined;
  onCallDutyPolicyScheduleId?: ObjectID | undefined;
  tokenHash: string;
  previousTokenHash?: string | undefined;
  previousTokenExpiresAt?: Date | undefined;
  tokenHint?: string | undefined;
  isEnabled: boolean;
  includeCoveringShifts?: boolean | undefined;
  includeCoverageGaps?: boolean | undefined;
  minimumGapMinutes?: number | undefined;
  rotateWhenMemberLeaves?: boolean | undefined;
  pastDays: number;
  futureDays: number;
  lastFetchedAt?: Date | undefined;
  lastFetchedClient?: string | undefined;
  fetchCount: number;
  lastRenderTruncated?: boolean | undefined;
  rotatedAt?: Date | undefined;
}

function getEnv(): EnvOverrides {
  return (globalThis as EnvMockGlobal).__oneuptimeOnCallCalendarApiEnv;
}

function setEnv(overrides: Partial<EnvOverrides>): void {
  (globalThis as EnvMockGlobal).__oneuptimeOnCallCalendarApiEnv = {
    ...getEnv(),
    ...overrides,
  };
}

function resetEnv(): void {
  (globalThis as EnvMockGlobal).__oneuptimeOnCallCalendarApiEnv = {
    disableFeed: false,
    httpProtocol: Protocol.HTTPS,
    host: "oneuptime.example.com",
    trustedProxyHops: 0,
    billingEnabled: false,
    provisionSsl: true,
  };
}

function registeredRoutes(): Array<RegisteredRoute> {
  return mockRouter.routes as unknown as Array<RegisteredRoute>;
}

function routeFor(method: string, uri: string): RegisteredRoute {
  const route: RegisteredRoute | undefined = registeredRoutes().find(
    (candidate: RegisteredRoute): boolean => {
      return candidate.method === method && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`No ${method} route registered for ${uri}`);
  }

  return route;
}

function buildMemberProps(data: {
  projectId: ObjectID | undefined;
  userId: ObjectID | undefined;
}): DatabaseCommonInteractionProps {
  const memberPermission: UserPermission = {
    _type: "UserPermission",
    permission: Permission.ProjectMember,
    labelIds: [],
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  if (data.projectId) {
    const tenantPermission: UserTenantAccessPermission = {
      _type: "UserTenantAccessPermission",
      projectId: data.projectId,
      permissions: [memberPermission],
    };

    permissionMap[data.projectId.toString()] = tenantPermission;
  }

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userTenantAccessPermission: permissionMap,
  };
}

function personalRow(overrides?: Partial<FeedRowFixture>): FeedRowFixture {
  return {
    id: ObjectID.generate(),
    projectId: ObjectID.generate(),
    userId: ObjectID.generate(),
    tokenHash: CalendarFeedToken.hash(CalendarFeedToken.mint()),
    tokenHint: "k3Qx",
    isEnabled: true,
    includeCoveringShifts: true,
    pastDays: DEFAULT_PAST_DAYS,
    futureDays: DEFAULT_FUTURE_DAYS,
    lastFetchedAt: undefined,
    fetchCount: 0,
    lastRenderTruncated: false,
    rotatedAt: at("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

function scheduleRow(overrides?: Partial<FeedRowFixture>): FeedRowFixture {
  return {
    id: ObjectID.generate(),
    projectId: ObjectID.generate(),
    onCallDutyPolicyScheduleId: ObjectID.generate(),
    tokenHash: CalendarFeedToken.hash(CalendarFeedToken.mint()),
    tokenHint: "s4Rt",
    isEnabled: true,
    includeCoverageGaps: false,
    minimumGapMinutes: 60,
    rotateWhenMemberLeaves: false,
    pastDays: DEFAULT_PAST_DAYS,
    futureDays: DEFAULT_FUTURE_DAYS,
    lastFetchedAt: undefined,
    fetchCount: 0,
    lastRenderTruncated: false,
    rotatedAt: at("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

function projectRow(overrides?: Partial<FeedRowFixture>): FeedRowFixture {
  return {
    id: ObjectID.generate(),
    projectId: ObjectID.generate(),
    tokenHash: CalendarFeedToken.hash(CalendarFeedToken.mint()),
    tokenHint: "p9Zz",
    isEnabled: true,
    includeCoverageGaps: true,
    minimumGapMinutes: 30,
    rotateWhenMemberLeaves: true,
    pastDays: DEFAULT_PAST_DAYS,
    futureDays: DEFAULT_FUTURE_DAYS,
    lastFetchedAt: undefined,
    fetchCount: 0,
    lastRenderTruncated: false,
    rotatedAt: at("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

/*
 * TypeORM returns ONLY the selected columns; everything else on the entity
 * stays undefined. The fake has to do the same, or a route that reads a
 * column it never selected passes here and fails in production -- which is
 * exactly what happened with tokenHash: no status read can select it (its
 * read access list is empty, so the non-root schedule/project reads would be
 * refused), and the status builder demanded it.
 *
 * `_id` in a select maps to the fixture's `id`, the way the model's `_id`
 * maps to its id column.
 */
function project(
  row: FeedRowFixture,
  select: Record<string, unknown> | undefined,
): FeedRowFixture {
  if (!select) {
    return row;
  }

  const projected: Record<string, unknown> = {};

  for (const [column, wanted] of Object.entries(select)) {
    if (!wanted) {
      continue;
    }

    const key: string = column === "_id" ? "id" : column;

    projected[key] = (row as unknown as Record<string, unknown>)[key];
  }

  return projected as unknown as FeedRowFixture;
}

/*
 * A findOneBy implementation over a fixed set of rows, answering the three
 * query shapes the routes use: { tokenHash }, { previousTokenHash } (public
 * lookups) and { projectId, userId | onCallDutyPolicyScheduleId } (session
 * lookups). The row it hands back carries only the selected columns.
 */
function lookupFrom(
  rows: Array<FeedRowFixture>,
): (args: CapturedFindOneBy) => Promise<FeedRowFixture | null> {
  return async (args: CapturedFindOneBy): Promise<FeedRowFixture | null> => {
    const query: Record<string, unknown> = args.query;

    const found: FeedRowFixture | null = matchRow(rows, query);

    return found ? project(found, args.select) : null;
  };
}

function matchRow(
  rows: Array<FeedRowFixture>,
  query: Record<string, unknown>,
): FeedRowFixture | null {
  for (const row of rows) {
    if (typeof query["tokenHash"] === "string") {
      if (row.tokenHash === query["tokenHash"]) {
        return row;
      }

      continue;
    }

    if (typeof query["previousTokenHash"] === "string") {
      if (
        row.previousTokenHash &&
        row.previousTokenHash === query["previousTokenHash"]
      ) {
        return row;
      }

      continue;
    }

    if (
      query["projectId"] &&
      String(query["projectId"]) !== row.projectId.toString()
    ) {
      continue;
    }

    if (query["_id"] && String(query["_id"]) !== row.id.toString()) {
      continue;
    }

    if (query["userId"]) {
      if (row.userId && String(query["userId"]) === row.userId.toString()) {
        return row;
      }

      continue;
    }

    if (query["onCallDutyPolicyScheduleId"]) {
      if (
        row.onCallDutyPolicyScheduleId &&
        String(query["onCallDutyPolicyScheduleId"]) ===
          row.onCallDutyPolicyScheduleId.toString()
      ) {
        return row;
      }

      continue;
    }

    if (query["projectId"] || query["_id"]) {
      return row;
    }
  }

  return null;
}

function renderedOutcome(
  kind: OnCallCalendarFeedKind,
  overrides?: Partial<FeedRenderOutcome>,
): FeedRenderOutcome {
  const rendered: FeedRenderResult = OnCallCalendarFeedUtil.render({
    kind,
    shifts: [
      shift({
        start: at("2026-09-02T07:00:00Z"),
        end: at("2026-09-02T15:00:00Z"),
      }),
    ],
    dashboardUrl: DASHBOARD_URL,
  });

  return {
    status: FeedRenderStatus.Rendered,
    kind,
    body: rendered.body,
    etag: Response.getCalendarETag(rendered.body),
    lastModified: rendered.lastModifiedAt || NOW,
    stale: false,
    truncated: false,
    eventCount: rendered.eventCount,
    cacheHit: false,
    reason: null,
    retryAfterSeconds: null,
    ...overrides,
  };
}

function callsOf<T>(spy: jest.SpyInstance): Array<T> {
  return spy.mock.calls.map((args: Array<unknown>): T => {
    return args[0] as T;
  });
}

function everyLogArgument(): Array<string> {
  const recorders: Array<jest.Mock> = [
    logger.debug as unknown as jest.Mock,
    logger.info as unknown as jest.Mock,
    logger.warn as unknown as jest.Mock,
    logger.error as unknown as jest.Mock,
  ];

  const rendered: Array<string> = [];

  for (const recorder of recorders) {
    for (const call of recorder.mock.calls) {
      for (const argument of call) {
        rendered.push(String(argument));

        if (argument instanceof Error) {
          rendered.push(argument.message);
          rendered.push(argument.stack || "");
        }

        try {
          rendered.push(JSON.stringify(argument) || "");
        } catch {
          // circular; String() above is enough
        }
      }
    }
  }

  return rendered;
}

function flushBackgroundWork(): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

// -- Spies ------------------------------------------------------------------

let propsSpy: jest.SpyInstance;
let nowSpy: jest.SpyInstance;
let consumeSpy: jest.SpyInstance;
let renderSpy: jest.SpyInstance;
let materializeSpy: jest.SpyInstance;

let personalFindOneBy: jest.SpyInstance;
let personalFindOneById: jest.SpyInstance;
let personalUpdateOneById: jest.SpyInstance;
let personalCreateForUser: jest.SpyInstance;
let personalRotate: jest.SpyInstance;

let scheduleFindOneBy: jest.SpyInstance;
let scheduleFindOneById: jest.SpyInstance;
let scheduleUpdateOneById: jest.SpyInstance;
let scheduleUpdateOneBy: jest.SpyInstance;
let scheduleCreate: jest.SpyInstance;
let scheduleRotate: jest.SpyInstance;

let projectFindOneBy: jest.SpyInstance;
let projectFindOneById: jest.SpyInstance;
let projectUpdateOneById: jest.SpyInstance;
let projectUpdateOneBy: jest.SpyInstance;
let projectCreate: jest.SpyInstance;
let projectRotate: jest.SpyInstance;

let purgeForUser: jest.SpyInstance;
let purgeForSchedule: jest.SpyInstance;
let purgeForProject: jest.SpyInstance;
let tryAcquireRenderSlot: jest.SpyInstance;
let releaseRenderSlot: jest.SpyInstance;

let scheduleModelFindOneBy: jest.SpyInstance;
let semaphoreLock: jest.SpyInstance;
let semaphoreRelease: jest.SpyInstance;

let projectId: ObjectID;
let userId: ObjectID;

// -- Server -----------------------------------------------------------------

let server: http.Server;
let baseUrl: string;

function request(
  requestPath: string,
  init?: { method?: string; headers?: Record<string, string> },
): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (error: Error) => void) => {
      const clientRequest: http.ClientRequest = http.request(
        `${baseUrl}${requestPath}`,
        { method: init?.method || "GET", headers: init?.headers || {} },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode || 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
          response.on("error", reject);
        },
      );

      clientRequest.on("error", reject);
      clientRequest.end();
    },
  );
}

function header(result: HttpResult, name: string): string | undefined {
  const value: string | Array<string> | undefined =
    result.headers[name.toLowerCase()];

  if (value === undefined) {
    return undefined;
  }

  return Array.isArray(value) ? value.join(", ") : value;
}

function json(result: HttpResult): Record<string, unknown> {
  return JSON.parse(result.body) as Record<string, unknown>;
}

function feedPath(kind: OnCallCalendarFeedKind, token: string): string {
  return OnCallCalendarFeedUrls.getFeedPath(kind, token);
}

function postJson(
  requestPath: string,
  headers?: Record<string, string>,
): Promise<HttpResult> {
  return request(requestPath, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
  });
}

beforeAll(async () => {
  const app: express.Express = express();

  /*
   * The module registered its routes on mockRouter when it was imported;
   * replaying them onto a real application gives every test Express's own
   * routing, conditional-request and HEAD semantics.
   */
  for (const route of registeredRoutes()) {
    const chain: Array<express.RequestHandler> = [
      ...route.middlewares,
      route.handlerFunction,
    ] as unknown as Array<express.RequestHandler>;

    const fullPath: string = `${API_PREFIX}${route.uri}`;

    if (route.method === "GET") {
      app.get(fullPath, ...chain);
    } else if (route.method === "POST") {
      app.post(fullPath, ...chain);
    } else if (route.method === "ALL") {
      app.all(fullPath, ...chain);
    }
  }

  /* The app's error middleware, reduced to what the routes rely on. */
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ): void => {
      const code: number = (err as Exception).code as number;
      const status: number =
        Number.isInteger(code) && code >= 400 && code <= 599 ? code : 500;

      res.status(status).send({ message: (err as Error).message });
    },
  );

  server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address: AddressInfo = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  resetEnv();

  projectId = ObjectID.generate();
  userId = ObjectID.generate();

  nowSpy = jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  propsSpy = jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(buildMemberProps({ projectId, userId }));

  consumeSpy = jest
    .spyOn(OnCallCalendarFeedRateLimit, "consume")
    .mockResolvedValue({
      outcome: OnCallCalendarFeedRateLimitOutcome.Allowed,
    });

  renderSpy = jest.spyOn(OnCallCalendarFeedRenderer, "render");
  materializeSpy = jest.spyOn(
    OnCallCalendarFeedRenderer,
    "materializeUserShifts",
  );

  personalFindOneBy = jest
    .spyOn(UserOnCallCalendarFeedService, "findOneBy")
    .mockResolvedValue(null);
  personalFindOneById = jest
    .spyOn(UserOnCallCalendarFeedService, "findOneById")
    .mockResolvedValue(null);
  personalUpdateOneById = jest
    .spyOn(UserOnCallCalendarFeedService, "updateOneById")
    .mockResolvedValue(undefined as never);
  personalCreateForUser = jest.spyOn(
    UserOnCallCalendarFeedService,
    "createForUser",
  );
  personalRotate = jest.spyOn(UserOnCallCalendarFeedService, "rotateTokenById");

  scheduleFindOneBy = jest
    .spyOn(OnCallDutyPolicyScheduleCalendarFeedService, "findOneBy")
    .mockResolvedValue(null);
  scheduleFindOneById = jest
    .spyOn(OnCallDutyPolicyScheduleCalendarFeedService, "findOneById")
    .mockResolvedValue(null);
  scheduleUpdateOneById = jest
    .spyOn(OnCallDutyPolicyScheduleCalendarFeedService, "updateOneById")
    .mockResolvedValue(undefined as never);
  scheduleUpdateOneBy = jest
    .spyOn(OnCallDutyPolicyScheduleCalendarFeedService, "updateOneBy")
    .mockResolvedValue(undefined as never);
  scheduleCreate = jest
    .spyOn(OnCallDutyPolicyScheduleCalendarFeedService, "create")
    .mockResolvedValue(undefined as never);
  scheduleRotate = jest.spyOn(
    OnCallDutyPolicyScheduleCalendarFeedService,
    "rotateTokenById",
  );

  projectFindOneBy = jest
    .spyOn(ProjectOnCallCalendarFeedService, "findOneBy")
    .mockResolvedValue(null);
  projectFindOneById = jest
    .spyOn(ProjectOnCallCalendarFeedService, "findOneById")
    .mockResolvedValue(null);
  projectUpdateOneById = jest
    .spyOn(ProjectOnCallCalendarFeedService, "updateOneById")
    .mockResolvedValue(undefined as never);
  projectUpdateOneBy = jest
    .spyOn(ProjectOnCallCalendarFeedService, "updateOneBy")
    .mockResolvedValue(undefined as never);
  projectCreate = jest
    .spyOn(ProjectOnCallCalendarFeedService, "create")
    .mockResolvedValue(undefined as never);
  projectRotate = jest.spyOn(
    ProjectOnCallCalendarFeedService,
    "rotateTokenById",
  );

  /*
   * The schedule itself, read with the CALLER's props before a shared feed is
   * published: that read is what applies the label scoping. The default here
   * is "the caller may see it".
   */
  scheduleModelFindOneBy = jest
    .spyOn(OnCallDutyPolicyScheduleService, "findOneBy")
    .mockResolvedValue({ id: ObjectID.generate() } as never);

  purgeForUser = jest
    .spyOn(OnCallCalendarFeedCache, "purgeForUser")
    .mockResolvedValue(undefined);
  purgeForSchedule = jest
    .spyOn(OnCallCalendarFeedCache, "purgeForSchedule")
    .mockResolvedValue(undefined);
  purgeForProject = jest
    .spyOn(OnCallCalendarFeedCache, "purgeForProject")
    .mockResolvedValue(undefined);
  tryAcquireRenderSlot = jest
    .spyOn(OnCallCalendarFeedCache, "tryAcquireRenderSlot")
    .mockReturnValue(true);
  releaseRenderSlot = jest
    .spyOn(OnCallCalendarFeedCache, "releaseRenderSlot")
    .mockReturnValue(undefined);

  semaphoreLock = jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({ release: jest.fn() } as never);
  semaphoreRelease = jest
    .spyOn(Semaphore, "release")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// -- Registration -----------------------------------------------------------

describe("OnCallCalendarAPI: route registration", () => {
  test("registers the three public capability routes as GET with kill switch, scheme guard and rate limiter in that order", () => {
    for (const uri of [
      PERSONAL_FEED_ROUTE,
      SCHEDULE_FEED_ROUTE,
      PROJECT_FEED_ROUTE,
    ]) {
      const route: RegisteredRoute = routeFor("GET", uri);

      expect(route.middlewares).toHaveLength(3);
      expect(route.middlewares[0]?.name).toBe("killSwitchMiddleware");
      expect(route.middlewares[1]?.name).toBe("schemeGuardMiddleware");
      expect(typeof route.middlewares[2]).toBe("function");
    }
  });

  test("the public routes live under exactly the three path prefixes the Nginx access-log exemption matches", () => {
    const nginxLocation: RegExp =
      /^\/api\/on-call-calendar\/(user|schedule|project)\//;

    expect(`${API_PREFIX}${PERSONAL_FEED_ROUTE}`).toMatch(nginxLocation);
    expect(`${API_PREFIX}${SCHEDULE_FEED_ROUTE}`).toMatch(nginxLocation);
    expect(`${API_PREFIX}${PROJECT_FEED_ROUTE}`).toMatch(nginxLocation);

    for (const uri of [
      FEED_CURRENT_ROUTE,
      FEED_ROTATE_ROUTE,
      SCHEDULE_FEED_CURRENT_ROUTE,
      SCHEDULE_FEED_PUBLISH_ROUTE,
      SCHEDULE_FEED_ROTATE_ROUTE,
      PROJECT_FEED_CURRENT_ROUTE,
      PROJECT_FEED_PUBLISH_ROUTE,
      PROJECT_FEED_ROTATE_ROUTE,
      MY_SHIFTS_ROUTE,
    ]) {
      expect(`${API_PREFIX}${uri}`).not.toMatch(nginxLocation);
    }
  });

  test("the public route templates are the URL builder's paths with :token in place of the token", () => {
    /* The builder percent-encodes the token, so the placeholder is decoded. */
    expect(PERSONAL_FEED_ROUTE).toBe(
      decodeURIComponent(
        OnCallCalendarFeedUrls.getFeedRoutePath(
          OnCallCalendarFeedKind.Personal,
          ":token",
        ),
      ),
    );
    expect(SCHEDULE_FEED_ROUTE).toBe(
      decodeURIComponent(
        OnCallCalendarFeedUrls.getFeedRoutePath(
          OnCallCalendarFeedKind.Schedule,
          ":token",
        ),
      ),
    );
    expect(PROJECT_FEED_ROUTE).toBe(
      decodeURIComponent(
        OnCallCalendarFeedUrls.getFeedRoutePath(
          OnCallCalendarFeedKind.Project,
          ":token",
        ),
      ),
    );
  });

  test("registers the session routes with the user middleware pair", () => {
    const expected: Array<[string, string]> = [
      ["GET", FEED_CURRENT_ROUTE],
      ["POST", FEED_ROTATE_ROUTE],
      ["GET", SCHEDULE_FEED_CURRENT_ROUTE],
      ["POST", SCHEDULE_FEED_PUBLISH_ROUTE],
      ["POST", SCHEDULE_FEED_ROTATE_ROUTE],
      ["GET", PROJECT_FEED_CURRENT_ROUTE],
      ["POST", PROJECT_FEED_PUBLISH_ROUTE],
      ["POST", PROJECT_FEED_ROTATE_ROUTE],
      ["GET", MY_SHIFTS_ROUTE],
    ];

    for (const [method, uri] of expected) {
      const route: RegisteredRoute = routeFor(method, uri);

      expect(route.middlewares).toHaveLength(2);
      expect(route.uri.startsWith("/on-call-calendar/")).toBe(true);
    }
  });

  test("registers no route the spec does not name", () => {
    const uris: Array<string> = registeredRoutes()
      .filter((route: RegisteredRoute): boolean => {
        return route.uri.startsWith("/on-call-calendar");
      })
      .map((route: RegisteredRoute): string => {
        return `${route.method} ${route.uri}`;
      })
      .sort();

    expect(uris).toEqual(
      [
        `GET ${PERSONAL_FEED_ROUTE}`,
        `GET ${SCHEDULE_FEED_ROUTE}`,
        `GET ${PROJECT_FEED_ROUTE}`,
        `GET ${FEED_CURRENT_ROUTE}`,
        `POST ${FEED_ROTATE_ROUTE}`,
        `GET ${SCHEDULE_FEED_CURRENT_ROUTE}`,
        `POST ${SCHEDULE_FEED_PUBLISH_ROUTE}`,
        `POST ${SCHEDULE_FEED_ROTATE_ROUTE}`,
        `GET ${PROJECT_FEED_CURRENT_ROUTE}`,
        `POST ${PROJECT_FEED_PUBLISH_ROUTE}`,
        `POST ${PROJECT_FEED_ROTATE_ROUTE}`,
        `GET ${MY_SHIFTS_ROUTE}`,
        `ALL ${PERSONAL_FEED_FALLBACK_ROUTE}`,
        `ALL ${SCHEDULE_FEED_FALLBACK_ROUTE}`,
        `ALL ${PROJECT_FEED_FALLBACK_ROUTE}`,
      ].sort(),
    );
  });

  /*
   * The fallbacks must come AFTER the three exact GET routes (Express matches
   * in registration order) and they must cover every method.
   */
  test("registers the token-path fallbacks after the routes they back up", () => {
    const order: Array<string> = registeredRoutes().map(
      (route: RegisteredRoute): string => {
        return `${route.method} ${route.uri}`;
      },
    );

    for (const [exact, fallback] of [
      [PERSONAL_FEED_ROUTE, PERSONAL_FEED_FALLBACK_ROUTE],
      [SCHEDULE_FEED_ROUTE, SCHEDULE_FEED_FALLBACK_ROUTE],
      [PROJECT_FEED_ROUTE, PROJECT_FEED_FALLBACK_ROUTE],
    ]) {
      expect(order.indexOf(`GET ${exact}`)).toBeGreaterThanOrEqual(0);
      expect(order.indexOf(`ALL ${fallback}`)).toBeGreaterThan(
        order.indexOf(`GET ${exact}`),
      );
    }
  });

  test("App/FeatureSet/BaseAPI/Index.ts mounts the router and the generic CRUD of the five models", () => {
    const indexPath: string = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "App",
      "FeatureSet",
      "BaseAPI",
      "Index.ts",
    );

    const source: string = fs.readFileSync(indexPath, "utf8");

    expect(source).toContain(
      'import OnCallCalendarAPI from "Common/Server/API/OnCallCalendarAPI";',
    );
    expect(source).toContain(
      "app.use(`/${APP_NAME.toLocaleLowerCase()}`, OnCallCalendarAPI);",
    );

    const models: Array<string> = [
      "UserOnCallCalendarFeed",
      "OnCallDutyPolicyScheduleCalendarFeed",
      "ProjectOnCallCalendarFeed",
      "UserOnCallShiftReminder",
      "UserOnCallShiftReminderLog",
    ];

    for (const model of models) {
      expect(source).toContain(
        `import ${model} from "Common/Models/DatabaseModels/${model}";`,
      );
      expect(source).toContain(
        `import ${model}Service, {\n  Service as ${model}ServiceType,\n} from "Common/Server/Services/${model}Service";`,
      );

      /*
       * One BaseAPI mount per model. Prettier wraps the generic differently
       * per name length, so match on the constructor arguments, which are
       * always `(Model, ModelService)`, optionally split across lines.
       */
      const mount: RegExp = new RegExp(
        `new BaseAPI<\\s*${model},\\s*${model}ServiceType\\s*>\\(\\s*${model},\\s*${model}Service,?\\s*\\)\\.getRouter\\(\\)`,
      );

      expect(source).toMatch(mount);
    }
  });
});

// -- Pure helpers -----------------------------------------------------------

describe("resolveTrustedForwardedProto", () => {
  function requestWith(
    value: string | Array<string> | undefined,
  ): ExpressRequest {
    return {
      headers: value === undefined ? {} : { "x-forwarded-proto": value },
    } as unknown as ExpressRequest;
  }

  test("with no trusted proxy hops there is no trustworthy header, so undefined", () => {
    expect(
      resolveTrustedForwardedProto(requestWith("http"), {
        trustedProxyHops: 0,
      }),
    ).toBeUndefined();
  });

  test("one hop reads the rightmost entry (the one our proxy wrote)", () => {
    expect(
      resolveTrustedForwardedProto(requestWith("https, http"), {
        trustedProxyHops: 1,
      }),
    ).toBe("http");
  });

  test("two hops reads the second entry from the right", () => {
    expect(
      resolveTrustedForwardedProto(requestWith("http, https, http"), {
        trustedProxyHops: 2,
      }),
    ).toBe("https");
  });

  test("a caller-supplied leftmost entry cannot be reached with one hop", () => {
    expect(
      resolveTrustedForwardedProto(requestWith("http, https"), {
        trustedProxyHops: 1,
      }),
    ).toBe("https");
  });

  test("fewer entries than hops means our proxy wrote none, so undefined", () => {
    expect(
      resolveTrustedForwardedProto(requestWith("http"), {
        trustedProxyHops: 2,
      }),
    ).toBeUndefined();
  });

  test("a missing or blank header is undefined", () => {
    expect(
      resolveTrustedForwardedProto(requestWith(undefined), {
        trustedProxyHops: 1,
      }),
    ).toBeUndefined();
    expect(
      resolveTrustedForwardedProto(requestWith("   "), {
        trustedProxyHops: 1,
      }),
    ).toBeUndefined();
  });

  test("array-valued headers are joined, and the value is trimmed and lower-cased", () => {
    expect(
      resolveTrustedForwardedProto(requestWith(["https", " HTTP "]), {
        trustedProxyHops: 1,
      }),
    ).toBe("http");
  });

  test("defaults to the configured TRUSTED_PROXY_HOPS", () => {
    setEnv({ trustedProxyHops: 1 });
    expect(resolveTrustedForwardedProto(requestWith("http"))).toBe("http");

    setEnv({ trustedProxyHops: 0 });
    expect(resolveTrustedForwardedProto(requestWith("http"))).toBeUndefined();
  });
});

describe("readScheduleFilter", () => {
  function requestWithQuery(query: Record<string, unknown>): ExpressRequest {
    return { query } as unknown as ExpressRequest;
  }

  test("absent -> undefined (no filter)", () => {
    expect(readScheduleFilter(requestWithQuery({}))).toBeUndefined();
    expect(
      readScheduleFilter(requestWithQuery({ nocache3: "1" })),
    ).toBeUndefined();
  });

  test("blank -> undefined", () => {
    expect(
      readScheduleFilter(requestWithQuery({ schedule: "" })),
    ).toBeUndefined();
    expect(
      readScheduleFilter(requestWithQuery({ schedule: "   " })),
    ).toBeUndefined();
  });

  test("not a UUID -> null (the route answers 404, never the whole feed)", () => {
    expect(
      readScheduleFilter(requestWithQuery({ schedule: "abc" })),
    ).toBeNull();
    expect(
      readScheduleFilter(requestWithQuery({ schedule: "1; DROP TABLE" })),
    ).toBeNull();
  });

  test("a UUID -> the ObjectID", () => {
    const id: ObjectID = ObjectID.generate();
    const filter: ObjectID | undefined | null = readScheduleFilter(
      requestWithQuery({ schedule: id.toString() }),
    );

    expect(filter?.toString()).toBe(id.toString());
  });

  test("a repeated parameter uses the first value", () => {
    const id: ObjectID = ObjectID.generate();
    const filter: ObjectID | undefined | null = readScheduleFilter(
      requestWithQuery({ schedule: [id.toString(), "garbage"] }),
    );

    expect(filter?.toString()).toBe(id.toString());
  });
});

describe("classifyCalendarClient", () => {
  test.each([
    ["Google-Calendar-Importer", "Google Calendar"],
    ["Mozilla/5.0 (compatible; Google-Calendar-Importer)", "Google Calendar"],
    [
      "Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.5)",
      "Microsoft Outlook",
    ],
    ["Outlook-iOS/2.0", "Microsoft Outlook"],
    ["CalendarAgent/1000 CFNetwork/1500 Darwin/23.0", "Apple Calendar"],
    ["iOS/17.5 (21F79) dataaccessd/1.0", "Apple Calendar"],
    ["Mozilla/5.0 Thunderbird/115.0", "Thunderbird"],
    ["okhttp/4.12.0", "Android app"],
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/126.0", "Browser"],
    ["curl/8.5.0", "Command line"],
    ["Wget/1.21", "Command line"],
    ["SomethingNobodyKnows/1.0", "Other"],
  ])("%s -> %s", (userAgent: string, expected: string) => {
    expect(classifyCalendarClient(userAgent)).toBe(expected);
  });

  test("no User-Agent -> null", () => {
    expect(classifyCalendarClient(undefined)).toBeNull();
    expect(classifyCalendarClient("")).toBeNull();
    expect(classifyCalendarClient("   ")).toBeNull();
  });

  test("array headers are joined", () => {
    expect(classifyCalendarClient(["Mozilla/5.0", "Thunderbird/115"])).toBe(
      "Thunderbird",
    );
  });

  test("never returns the raw string", () => {
    const raw: string =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8; device-id=ABCDEF) Chrome/126";

    expect(classifyCalendarClient(raw)).not.toContain("ABCDEF");
  });
});

describe("isPreviousTokenInGrace", () => {
  test("a future expiry is inside the grace", () => {
    expect(
      isPreviousTokenInGrace(
        { previousTokenExpiresAt: at("2026-09-02T12:00:00Z") },
        NOW,
      ),
    ).toBe(true);
  });

  test("a past expiry is not", () => {
    expect(
      isPreviousTokenInGrace(
        { previousTokenExpiresAt: at("2026-09-01T11:59:59Z") },
        NOW,
      ),
    ).toBe(false);
  });

  test("an expiry equal to now is not (strictly greater)", () => {
    expect(isPreviousTokenInGrace({ previousTokenExpiresAt: NOW }, NOW)).toBe(
      false,
    );
  });

  test("no expiry at all is not", () => {
    expect(isPreviousTokenInGrace({}, NOW)).toBe(false);
    expect(
      isPreviousTokenInGrace({ previousTokenExpiresAt: undefined }, NOW),
    ).toBe(false);
  });

  test("a string date (as a raw row might carry) is understood", () => {
    expect(
      isPreviousTokenInGrace(
        {
          previousTokenExpiresAt: "2026-10-01T00:00:00.000Z" as unknown as Date,
        },
        NOW,
      ),
    ).toBe(true);
  });
});

describe("shouldRecordFetch", () => {
  test("HEAD is never recorded", () => {
    expect(
      shouldRecordFetch({ method: "HEAD", lastFetchedAt: null, now: NOW }),
    ).toBe(false);
  });

  test("a first GET is recorded", () => {
    expect(
      shouldRecordFetch({ method: "GET", lastFetchedAt: null, now: NOW }),
    ).toBe(true);
    expect(
      shouldRecordFetch({
        method: undefined,
        lastFetchedAt: undefined,
        now: NOW,
      }),
    ).toBe(true);
  });

  test("a GET inside the 5-minute interval is not", () => {
    expect(
      shouldRecordFetch({
        method: "get",
        lastFetchedAt: new Date(NOW.getTime() - BOOKKEEPING_INTERVAL_MS + 1000),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("a GET at or past the interval is", () => {
    expect(
      shouldRecordFetch({
        method: "GET",
        lastFetchedAt: new Date(NOW.getTime() - BOOKKEEPING_INTERVAL_MS),
        now: NOW,
      }),
    ).toBe(true);
    expect(
      shouldRecordFetch({
        method: "GET",
        lastFetchedAt: new Date(NOW.getTime() - 6 * 60 * 1000),
        now: NOW,
      }),
    ).toBe(true);
  });

  test("the interval is five minutes", () => {
    expect(BOOKKEEPING_INTERVAL_MS).toBe(5 * 60 * 1000);
  });
});

describe("readMyShiftsWindow", () => {
  function requestWithQuery(query: Record<string, unknown>): ExpressRequest {
    return { query } as unknown as ExpressRequest;
  }

  test("defaults to now -> now + 30 days", () => {
    const window: { from: Date; to: Date } = readMyShiftsWindow(
      requestWithQuery({}),
      NOW,
    );

    expect(window.from.toISOString()).toBe(NOW.toISOString());
    expect(window.to.toISOString()).toBe(
      OneUptimeDate.addRemoveDays(NOW, MY_SHIFTS_DEFAULT_DAYS).toISOString(),
    );
    expect(MY_SHIFTS_DEFAULT_DAYS).toBe(30);
  });

  test("explicit from and to are honoured", () => {
    const window: { from: Date; to: Date } = readMyShiftsWindow(
      requestWithQuery({
        from: "2026-09-10T00:00:00.000Z",
        to: "2026-09-12T00:00:00.000Z",
      }),
      NOW,
    );

    expect(window.from.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(window.to.toISOString()).toBe("2026-09-12T00:00:00.000Z");
  });

  test("a span beyond 120 days is cut to 120 days, not refused", () => {
    const window: { from: Date; to: Date } = readMyShiftsWindow(
      requestWithQuery({
        from: "2026-09-01T00:00:00.000Z",
        to: "2027-09-01T00:00:00.000Z",
      }),
      NOW,
    );

    expect(window.to.toISOString()).toBe(
      OneUptimeDate.addRemoveDays(
        at("2026-09-01T00:00:00.000Z"),
        MY_SHIFTS_MAX_DAYS,
      ).toISOString(),
    );
    expect(MY_SHIFTS_MAX_DAYS).toBe(120);
  });

  /*
   * Regression: `from` was unbounded. A far-future `from` is a fresh
   * schedule-cache entry AND a fresh LayerUtil expansion that walks one
   * rotation period at a time from the layer's start to the window -- the
   * full 200,000-iteration cap per restricted layer, seconds of synchronous
   * CPU, while holding one of the four render slots the public feeds share.
   * The window is now clamped into the range the feeds themselves address.
   */
  test("a far-future from is pulled back inside the feed window", () => {
    const window: { from: Date; to: Date } = readMyShiftsWindow(
      requestWithQuery({ from: "2500-01-01T00:00:00.000Z" }),
      NOW,
    );

    const latest: Date = OneUptimeDate.addRemoveDays(NOW, MAX_FUTURE_DAYS);

    expect(window.from.getTime()).toBeLessThanOrEqual(latest.getTime());
    expect(window.to.getTime()).toBeLessThanOrEqual(latest.getTime());
    expect(window.to.getTime()).toBeGreaterThan(window.from.getTime());
  });

  test("a far-past from is pulled forward to the earliest the feeds render", () => {
    const window: { from: Date; to: Date } = readMyShiftsWindow(
      requestWithQuery({
        from: "1970-01-01T00:00:00.000Z",
        to: "1970-03-01T00:00:00.000Z",
      }),
      NOW,
    );

    expect(window.from.toISOString()).toBe(
      OneUptimeDate.addRemoveDays(NOW, -MAX_PAST_DAYS).toISOString(),
    );
    expect(window.to.getTime()).toBeGreaterThan(window.from.getTime());
    expect(window.to.getTime()).toBeLessThanOrEqual(
      OneUptimeDate.addRemoveDays(NOW, MAX_FUTURE_DAYS).getTime(),
    );
  });

  test("a window inside the range is left exactly as asked", () => {
    const from: Date = OneUptimeDate.addRemoveDays(NOW, -1);
    const to: Date = OneUptimeDate.addRemoveDays(NOW, 20);

    const window: { from: Date; to: Date } = readMyShiftsWindow(
      requestWithQuery({ from: from.toISOString(), to: to.toISOString() }),
      NOW,
    );

    expect(window.from.toISOString()).toBe(from.toISOString());
    expect(window.to.toISOString()).toBe(to.toISOString());
  });

  test("every window it returns is one the feeds could render", () => {
    const earliest: Date = OneUptimeDate.addRemoveDays(NOW, -MAX_PAST_DAYS);
    const latest: Date = OneUptimeDate.addRemoveDays(NOW, MAX_FUTURE_DAYS);

    for (const from of [
      "1900-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-09-01T12:00:00.000Z",
      "2027-06-01T00:00:00.000Z",
      "2500-01-01T00:00:00.000Z",
    ]) {
      const window: { from: Date; to: Date } = readMyShiftsWindow(
        requestWithQuery({ from }),
        NOW,
      );

      expect(window.from.getTime()).toBeGreaterThanOrEqual(earliest.getTime());
      expect(window.to.getTime()).toBeLessThanOrEqual(latest.getTime());
      expect(window.to.getTime()).toBeGreaterThan(window.from.getTime());
      expect(window.to.getTime() - window.from.getTime()).toBeLessThanOrEqual(
        MY_SHIFTS_MAX_DAYS * 24 * 60 * 60 * 1000,
      );
    }
  });

  test("to <= from is a BadDataException", () => {
    expect(() => {
      return readMyShiftsWindow(
        requestWithQuery({
          from: "2026-09-10T00:00:00.000Z",
          to: "2026-09-10T00:00:00.000Z",
        }),
        NOW,
      );
    }).toThrow(BadDataException);
  });

  test("garbage dates are a BadDataException, not a 500", () => {
    expect(() => {
      return readMyShiftsWindow(requestWithQuery({ from: "yesterday" }), NOW);
    }).toThrow(BadDataException);
    expect(() => {
      return readMyShiftsWindow(requestWithQuery({ to: "soon" }), NOW);
    }).toThrow(BadDataException);
  });
});

describe("assertJsonRequest", () => {
  function requestWithContentType(
    value: string | Array<string> | undefined,
  ): ExpressRequest {
    return {
      headers: value === undefined ? {} : { "content-type": value },
    } as unknown as ExpressRequest;
  }

  test("application/json passes, with or without parameters", () => {
    expect(() => {
      return assertJsonRequest(requestWithContentType("application/json"));
    }).not.toThrow();
    expect(() => {
      return assertJsonRequest(
        requestWithContentType("Application/JSON; charset=utf-8"),
      );
    }).not.toThrow();
  });

  test("a missing or non-JSON content type is a 415", () => {
    for (const value of [
      undefined,
      "",
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
    ]) {
      let thrown: unknown = null;

      try {
        assertJsonRequest(requestWithContentType(value));
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(Exception);
      expect((thrown as Exception).code).toBe(415);
    }
  });

  test("an array header uses its first value", () => {
    expect(() => {
      return assertJsonRequest(
        requestWithContentType(["application/json", "text/plain"]),
      );
    }).not.toThrow();
  });
});

describe("buildAbsentFeedStatus", () => {
  test("personal: exists false, no urls, personal defaults", () => {
    const status: FeedStatus = buildAbsentFeedStatus(
      OnCallCalendarFeedKind.Personal,
    );

    expect(status).toEqual({
      exists: false,
      feedId: null,
      isEnabled: false,
      needsRegeneration: false,
      tokenHint: null,
      rotatedAt: null,
      previousTokenExpiresAt: null,
      lastFetchedAt: null,
      lastFetchedClient: null,
      fetchCount: 0,
      lastRenderTruncated: false,
      settings: {
        includeCoveringShifts: true,
        pastDays: DEFAULT_PAST_DAYS,
        futureDays: DEFAULT_FUTURE_DAYS,
      },
      urls: null,
      hostWarning: null,
      protocolWarning: null,
    });
  });

  test("shared kinds carry the shared defaults", () => {
    for (const kind of [
      OnCallCalendarFeedKind.Schedule,
      OnCallCalendarFeedKind.Project,
    ]) {
      const status: FeedStatus = buildAbsentFeedStatus(kind);

      expect(status.exists).toBe(false);
      expect(status.settings).toEqual({
        includeCoverageGaps: false,
        minimumGapMinutes: 60,
        pastDays: DEFAULT_PAST_DAYS,
        futureDays: DEFAULT_FUTURE_DAYS,
        rotateWhenMemberLeaves: false,
      });
    }
  });

  test("the deployment warnings come from the environment", () => {
    setEnv({ host: "localhost:3002", httpProtocol: Protocol.HTTP });

    const status: FeedStatus = buildAbsentFeedStatus(
      OnCallCalendarFeedKind.Personal,
    );

    expect(status.hostWarning).toBe(HOST_WARNING);
    expect(status.protocolWarning).toBe(PROTOCOL_WARNING);
  });
});

describe("buildFeedStatus", () => {
  const token: string = CalendarFeedToken.mint();

  test("a freshly minted plaintext token yields the three URLs", () => {
    const row: FeedRowFixture = personalRow({
      tokenHash: CalendarFeedToken.hash(token),
    });

    const status: FeedStatus = buildFeedStatus({
      kind: OnCallCalendarFeedKind.Personal,
      feed: row,
      plaintextToken: token,
    });

    expect(status.exists).toBe(true);
    expect(status.feedId).toBe(row.id.toString());
    expect(status.needsRegeneration).toBe(false);
    expect(status.urls).toEqual(
      OnCallCalendarFeedUrls.buildFeedUrls({
        kind: OnCallCalendarFeedKind.Personal,
        token,
      }),
    );
    expect(status.urls?.https).toContain(
      `/api/on-call-calendar/user/${token}/`,
    );
    expect(status.urls?.webcal.startsWith("webcals://")).toBe(true);
    expect(status.tokenHint).toBe(row.tokenHint);
    expect(status.rotatedAt).toBe(row.rotatedAt?.toISOString());
    expect(status.settings).toEqual({
      includeCoveringShifts: true,
      pastDays: DEFAULT_PAST_DAYS,
      futureDays: DEFAULT_FUTURE_DAYS,
    });
  });

  test("a decrypted token that hashes to tokenHash yields URLs", () => {
    const status: FeedStatus = buildFeedStatus({
      kind: OnCallCalendarFeedKind.Schedule,
      feed: scheduleRow({ tokenHash: CalendarFeedToken.hash(token) }),
      decryptedToken: token,
    });

    expect(status.needsRegeneration).toBe(false);
    expect(status.urls?.https).toContain(
      `/api/on-call-calendar/schedule/${token}/schedule.ics`,
    );
  });

  /*
   * The status rows the routes read never carry tokenHash: no status read can
   * select it. The hash to verify against comes from the decrypting root read
   * instead, as `verifiedTokenHash`.
   */
  test("a status row without tokenHash verifies against the hash the decrypting read returned", () => {
    const status: FeedStatus = buildFeedStatus({
      kind: OnCallCalendarFeedKind.Schedule,
      feed: {
        _id: ObjectID.generate().toString(),
        isEnabled: true,
        tokenHint: "abcd",
        pastDays: DEFAULT_PAST_DAYS,
        futureDays: DEFAULT_FUTURE_DAYS,
      },
      decryptedToken: token,
      verifiedTokenHash: CalendarFeedToken.hash(token),
    });

    expect(status.needsRegeneration).toBe(false);
    expect(status.urls?.https).toContain(token);
  });

  test("a verified hash that the decrypted token does not match is still needsRegeneration", () => {
    const status: FeedStatus = buildFeedStatus({
      kind: OnCallCalendarFeedKind.Schedule,
      feed: { _id: ObjectID.generate().toString(), isEnabled: true },
      decryptedToken: token,
      verifiedTokenHash: CalendarFeedToken.hash(CalendarFeedToken.mint()),
    });

    expect(status.needsRegeneration).toBe(true);
    expect(status.urls).toBeNull();
  });

  test("no hash from anywhere is needsRegeneration, never a URL on trust alone", () => {
    const status: FeedStatus = buildFeedStatus({
      kind: OnCallCalendarFeedKind.Schedule,
      feed: { _id: ObjectID.generate().toString(), isEnabled: true },
      decryptedToken: token,
    });

    expect(status.needsRegeneration).toBe(true);
    expect(status.urls).toBeNull();
  });

  test("a decrypted token that does NOT hash to tokenHash means the secret changed: needsRegeneration, no urls", () => {
    const status: FeedStatus = buildFeedStatus({
      kind: OnCallCalendarFeedKind.Personal,
      feed: personalRow({
        tokenHash: CalendarFeedToken.hash(CalendarFeedToken.mint()),
      }),
      decryptedToken: token,
    });

    expect(status.needsRegeneration).toBe(true);
    expect(status.urls).toBeNull();
    expect(status.exists).toBe(true);
  });

  test("a failed decrypt is needsRegeneration, no urls", () => {
    const status: FeedStatus = buildFeedStatus({
      kind: OnCallCalendarFeedKind.Project,
      feed: projectRow(),
      decryptFailed: true,
    });

    expect(status.needsRegeneration).toBe(true);
    expect(status.urls).toBeNull();
  });

  test("garbage in the decrypted column (wrong shape) is needsRegeneration", () => {
    const status: FeedStatus = buildFeedStatus({
      kind: OnCallCalendarFeedKind.Personal,
      feed: personalRow(),
      decryptedToken: "\u0000\u0001not-a-token",
    });

    expect(status.needsRegeneration).toBe(true);
    expect(status.urls).toBeNull();
  });

  test("shared feeds expose the shared settings", () => {
    const status: FeedStatus = buildFeedStatus({
      kind: OnCallCalendarFeedKind.Project,
      feed: projectRow({
        includeCoverageGaps: true,
        minimumGapMinutes: 15,
        rotateWhenMemberLeaves: true,
        pastDays: 5,
        futureDays: 45,
      }),
      plaintextToken: token,
    });

    expect(status.settings).toEqual({
      includeCoverageGaps: true,
      minimumGapMinutes: 15,
      pastDays: 5,
      futureDays: 45,
      rotateWhenMemberLeaves: true,
    });
  });

  test("bookkeeping columns are copied as ISO strings and numbers", () => {
    const status: FeedStatus = buildFeedStatus({
      kind: OnCallCalendarFeedKind.Personal,
      feed: personalRow({
        isEnabled: false,
        lastFetchedAt: at("2026-08-31T09:00:00Z"),
        lastFetchedClient: "Google Calendar",
        fetchCount: 143,
        lastRenderTruncated: true,
        previousTokenExpiresAt: at("2026-09-30T00:00:00Z"),
      }),
      plaintextToken: token,
    });

    expect(status.isEnabled).toBe(false);
    expect(status.lastFetchedAt).toBe("2026-08-31T09:00:00.000Z");
    expect(status.lastFetchedClient).toBe("Google Calendar");
    expect(status.fetchCount).toBe(143);
    expect(status.lastRenderTruncated).toBe(true);
    expect(status.previousTokenExpiresAt).toBe("2026-09-30T00:00:00.000Z");
  });

  test("the feed id falls back to _id when the row is raw", () => {
    const rawId: string = ObjectID.generate().toString();

    const status: FeedStatus = buildFeedStatus({
      kind: OnCallCalendarFeedKind.Personal,
      feed: { _id: rawId, tokenHash: CalendarFeedToken.hash(token) },
      plaintextToken: token,
    });

    expect(status.feedId).toBe(rawId);
  });

  test("the response never carries the hash", () => {
    const status: FeedStatus = buildFeedStatus({
      kind: OnCallCalendarFeedKind.Personal,
      feed: personalRow({ tokenHash: CalendarFeedToken.hash(token) }),
      plaintextToken: token,
    });

    expect(JSON.stringify(status)).not.toContain(CalendarFeedToken.hash(token));
  });
});

// -- Public routes: the personal feed -----------------------------------------

describe("GET /on-call-calendar/user/:token/shifts.ics", () => {
  let token: string;
  let row: FeedRowFixture;

  beforeEach(() => {
    token = CalendarFeedToken.mint();
    row = personalRow({
      projectId,
      userId,
      tokenHash: CalendarFeedToken.hash(token),
    });

    personalFindOneBy.mockImplementation(lookupFrom([row]) as never);
    renderSpy.mockResolvedValue(
      renderedOutcome(OnCallCalendarFeedKind.Personal),
    );
  });

  test("a malformed token is 404 with a generic body, and no database lookup happens", async () => {
    for (const bad of [
      "short",
      token.slice(0, 42),
      `${token}x`,
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO+P",
    ]) {
      const result: HttpResult = await request(
        `${API_PREFIX}/on-call-calendar/user/${encodeURIComponent(bad)}/shifts.ics`,
      );

      expect(result.status).toBe(404);
      expect(json(result)).toEqual({ message: "Not found." });
    }

    expect(personalFindOneBy).not.toHaveBeenCalled();
    expect(renderSpy).not.toHaveBeenCalled();
  });

  test("an unknown but well-formed token is 404 with the SAME generic body, after both lookups", async () => {
    expect(CalendarFeedToken.isValidShape(UNKNOWN_TOKEN)).toBe(true);

    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Personal, UNKNOWN_TOKEN),
    );

    expect(result.status).toBe(404);
    expect(json(result)).toEqual({ message: "Not found." });
    expect(header(result, "content-type")).not.toContain("text/calendar");
    expect(personalFindOneBy).toHaveBeenCalledTimes(2);
    expect(renderSpy).not.toHaveBeenCalled();
  });

  test("the public lookup never selects the encrypted token column, current or previous", async () => {
    await request(feedPath(OnCallCalendarFeedKind.Personal, UNKNOWN_TOKEN));

    const calls: Array<CapturedFindOneBy> =
      callsOf<CapturedFindOneBy>(personalFindOneBy);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.query).toEqual({
      tokenHash: CalendarFeedToken.hash(UNKNOWN_TOKEN),
    });
    expect(calls[1]?.query).toEqual({
      previousTokenHash: CalendarFeedToken.hash(UNKNOWN_TOKEN),
    });

    for (const call of calls) {
      expect(call.select?.["token"]).toBeUndefined();
      expect(call.select?.["tokenHash"]).toBeUndefined();
      expect(call.select?.["previousTokenHash"]).toBeUndefined();
      expect(call.props?.isRoot).toBe(true);
      expect(call.props?.ignoreHooks).toBe(true);
    }
  });

  test("a known token renders: 200, the calendar header set, and no Pragma", async () => {
    const outcome: FeedRenderOutcome = renderedOutcome(
      OnCallCalendarFeedKind.Personal,
    );
    renderSpy.mockResolvedValue(outcome);

    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Personal, token),
    );

    expect(result.status).toBe(200);
    expect(result.body).toBe(outcome.body);
    expect(result.body).toContain("BEGIN:VEVENT");
    expect(header(result, "content-type")).toBe("text/calendar; charset=utf-8");
    expect(header(result, "content-disposition")).toBe(
      'inline; filename="oneuptime-on-call.ics"',
    );
    expect(header(result, "cache-control")).toBe("private, max-age=300");
    expect(header(result, "expires")).toBeDefined();
    expect(header(result, "etag")).toBe(outcome.etag);
    expect(header(result, "etag")?.startsWith("W/")).toBe(false);
    expect(header(result, "last-modified")).toBe(
      outcome.lastModified.toUTCString(),
    );
    expect(header(result, "x-content-type-options")).toBe("nosniff");
    expect(header(result, "x-robots-tag")).toBe("noindex");
    expect(header(result, "pragma")).toBeUndefined();
    expect(header(result, "warning")).toBeUndefined();
  });

  test("hands the renderer the row's settings and never the token", async () => {
    row.includeCoveringShifts = false;
    row.pastDays = 7;
    row.futureDays = 30;

    await request(feedPath(OnCallCalendarFeedKind.Personal, token));

    expect(renderSpy).toHaveBeenCalledTimes(1);

    const renderRequest: Record<string, unknown> = renderSpy.mock
      .calls[0]?.[0] as Record<string, unknown>;

    expect(renderRequest["kind"]).toBe(OnCallCalendarFeedKind.Personal);
    expect(String(renderRequest["feedId"])).toBe(row.id.toString());
    expect(String(renderRequest["projectId"])).toBe(projectId.toString());
    expect(String(renderRequest["userId"])).toBe(userId.toString());
    expect(renderRequest["tokenHash"]).toBe(CalendarFeedToken.hash(token));
    expect(renderRequest["includeCoveringShifts"]).toBe(false);
    expect(renderRequest["pastDays"]).toBe(7);
    expect(renderRequest["futureDays"]).toBe(30);
    expect(renderRequest["scheduleFilterId"]).toBeUndefined();
    expect((renderRequest["now"] as Date).toISOString()).toBe(
      NOW.toISOString(),
    );
    expect(JSON.stringify(renderRequest)).not.toContain(token);
  });

  test("?schedule=<uuid> becomes the render filter", async () => {
    const scheduleId: ObjectID = ObjectID.generate();

    const result: HttpResult = await request(
      `${feedPath(OnCallCalendarFeedKind.Personal, token)}?schedule=${scheduleId.toString()}`,
    );

    expect(result.status).toBe(200);

    const renderRequest: Record<string, unknown> = renderSpy.mock
      .calls[0]?.[0] as Record<string, unknown>;

    expect(String(renderRequest["scheduleFilterId"])).toBe(
      scheduleId.toString(),
    );
  });

  test("?schedule=<not a uuid> is 404: a filtered link never quietly renders the whole feed", async () => {
    const result: HttpResult = await request(
      `${feedPath(OnCallCalendarFeedKind.Personal, token)}?schedule=payments`,
    );

    expect(result.status).toBe(404);
    expect(renderSpy).not.toHaveBeenCalled();
    expect(personalFindOneBy).not.toHaveBeenCalled();
  });

  test("unknown query parameters (?nocache3, cache busters) are ignored", async () => {
    const result: HttpResult = await request(
      `${feedPath(OnCallCalendarFeedKind.Personal, token)}?nocache3&_=1725192000&project=${ObjectID.generate().toString()}`,
    );

    expect(result.status).toBe(200);
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  test("the rotated-out token inside its grace serves an EMPTY calendar (200) that says why, and is not counted", async () => {
    const previousToken: string = CalendarFeedToken.mint();
    row.previousTokenHash = CalendarFeedToken.hash(previousToken);
    row.previousTokenExpiresAt = at("2026-09-20T00:00:00Z");

    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Personal, previousToken),
    );

    expect(result.status).toBe(200);
    expect(header(result, "content-type")).toBe("text/calendar; charset=utf-8");
    expect(result.body).toContain("BEGIN:VCALENDAR");
    expect(result.body).not.toContain("BEGIN:VEVENT");
    expect(result.body.replace(/\r\n /g, "")).toContain(
      TOKEN_ROTATED_REASON.slice(0, 40),
    );
    expect(renderSpy).not.toHaveBeenCalled();
    expect(personalUpdateOneById).not.toHaveBeenCalled();
  });

  test("the rotated-out token past its grace is 404", async () => {
    const previousToken: string = CalendarFeedToken.mint();
    row.previousTokenHash = CalendarFeedToken.hash(previousToken);
    row.previousTokenExpiresAt = at("2026-08-01T00:00:00Z");

    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Personal, previousToken),
    );

    expect(result.status).toBe(404);
    expect(json(result)).toEqual({ message: "Not found." });
  });

  test("a rotated-out token whose row has no expiry recorded is 404", async () => {
    const previousToken: string = CalendarFeedToken.mint();
    row.previousTokenHash = CalendarFeedToken.hash(previousToken);
    row.previousTokenExpiresAt = undefined;

    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Personal, previousToken),
    );

    expect(result.status).toBe(404);
  });

  test("a disabled feed serves an EMPTY calendar (200) and is not counted", async () => {
    row.isEnabled = false;

    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Personal, token),
    );

    expect(result.status).toBe(200);
    expect(result.body).not.toContain("BEGIN:VEVENT");
    expect(result.body.replace(/\r\n /g, "")).toContain(
      FEED_DISABLED_REASON.slice(0, 40),
    );
    expect(renderSpy).not.toHaveBeenCalled();
    expect(personalUpdateOneById).not.toHaveBeenCalled();
  });

  test("an Empty outcome from the renderer (below plan, no schedules) is 200 with the renderer's body", async () => {
    renderSpy.mockResolvedValue(
      OnCallCalendarFeedRenderer.buildEmptyOutcome({
        kind: OnCallCalendarFeedKind.Personal,
        reason: PLAN_REASON,
        now: NOW,
      }),
    );

    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Personal, token),
    );

    expect(result.status).toBe(200);
    expect(header(result, "content-type")).toBe("text/calendar; charset=utf-8");
    expect(result.body).not.toContain("BEGIN:VEVENT");
    expect(result.body.replace(/\r\n /g, "")).toContain(
      PLAN_REASON.slice(0, 40),
    );
  });

  /*
   * Regression: bookkeeping used to run only for a Rendered outcome, so an
   * enabled, current feed whose calendar is EMPTY -- the user is not on a
   * schedule yet, or the project is below plan -- was polled all day and the
   * settings page still said "Nothing has fetched this link yet. Is this
   * server reachable from where your calendar app runs?". That is exactly the
   * question a user staring at an empty calendar is asking, and the answer
   * was wrong.
   */
  test("an empty calendar served for an enabled, current feed still counts as a fetch", async () => {
    renderSpy.mockResolvedValue(
      OnCallCalendarFeedRenderer.buildEmptyOutcome({
        kind: OnCallCalendarFeedKind.Personal,
        reason: NO_SCHEDULES_REASON,
        now: NOW,
      }),
    );

    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Personal, token),
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; Google-Calendar" } },
    );

    expect(result.status).toBe(200);
    expect(personalUpdateOneById).toHaveBeenCalledTimes(1);

    const update: CapturedUpdate = personalUpdateOneById.mock
      .calls[0]?.[0] as CapturedUpdate;

    expect(update.data["fetchCount"]).toBe(1);
    expect(update.data["lastFetchedClient"]).toBe("Google Calendar");
    expect(update.data["lastRenderTruncated"]).toBe(false);
    expect(update.props?.isRoot).toBe(true);
  });

  test("an Unavailable outcome (render cap, nothing cached) is 503 + Retry-After 60 and not a calendar", async () => {
    renderSpy.mockResolvedValue(
      OnCallCalendarFeedRenderer.buildUnavailableOutcome(
        OnCallCalendarFeedKind.Personal,
        RENDER_CAP_RETRY_AFTER_SECONDS,
      ),
    );

    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Personal, token),
    );

    expect(result.status).toBe(503);
    expect(header(result, "retry-after")).toBe("60");
    expect(header(result, "content-type")).not.toContain("text/calendar");
    expect(header(result, "content-disposition")).toBeUndefined();
    expect(header(result, "x-robots-tag")).toBeUndefined();
    expect(header(result, "warning")).toBeUndefined();
    expect(personalUpdateOneById).not.toHaveBeenCalled();
  });

  test("a stale (last-good) outcome carries Warning: 110 and records lastRenderTruncated", async () => {
    renderSpy.mockResolvedValue(
      renderedOutcome(OnCallCalendarFeedKind.Personal, {
        stale: true,
        truncated: true,
      }),
    );

    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Personal, token),
      { headers: { "User-Agent": "Google-Calendar-Importer" } },
    );

    expect(result.status).toBe(200);
    expect(header(result, "warning")).toBe('110 - "Response is Stale"');

    await flushBackgroundWork();

    const update: CapturedUpdate | undefined = callsOf<CapturedUpdate>(
      personalUpdateOneById,
    )[0];

    expect(update?.data["lastRenderTruncated"]).toBe(true);
  });

  test("the kill switch is 503 + Retry-After 3600 and costs neither a counter round trip nor a lookup", async () => {
    setEnv({ disableFeed: true });

    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Personal, token),
    );

    expect(result.status).toBe(503);
    expect(header(result, "retry-after")).toBe(
      String(KILL_SWITCH_RETRY_AFTER_SECONDS),
    );
    expect(KILL_SWITCH_RETRY_AFTER_SECONDS).toBe(3600);
    expect(consumeSpy).not.toHaveBeenCalled();
    expect(personalFindOneBy).not.toHaveBeenCalled();
    expect(renderSpy).not.toHaveBeenCalled();
  });

  test("the kill switch answers even a malformed token with 503 (no enumeration of good vs bad tokens while off)", async () => {
    setEnv({ disableFeed: true });

    const result: HttpResult = await request(
      `${API_PREFIX}/on-call-calendar/user/nope/shifts.ics`,
    );

    expect(result.status).toBe(503);
  });

  test("a rate-limited request is 429 + Retry-After before any lookup", async () => {
    consumeSpy.mockResolvedValue({
      outcome: OnCallCalendarFeedRateLimitOutcome.RateLimited,
      retryAfterSeconds: 17,
      scope: OnCallCalendarFeedRateLimitScope.Token,
      isFirstRejectionInWindow: true,
    });

    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Personal, token),
    );

    expect(result.status).toBe(429);
    expect(header(result, "retry-after")).toBe("17");
    expect(personalFindOneBy).not.toHaveBeenCalled();
    expect(renderSpy).not.toHaveBeenCalled();
  });

  test("the limiter is consumed with the token's key, not the token, and the caller address", async () => {
    await request(feedPath(OnCallCalendarFeedKind.Personal, token));

    expect(consumeSpy).toHaveBeenCalledTimes(1);

    const consumed: { tokenKey: string; clientIp: string } = consumeSpy.mock
      .calls[0]?.[0] as { tokenKey: string; clientIp: string };

    expect(consumed.tokenKey).toBe(
      OnCallCalendarFeedRateLimit.hashToken(token),
    );
    expect(consumed.tokenKey.startsWith("t:")).toBe(true);
    expect(consumed.tokenKey).not.toContain(token);
    expect(consumed.clientIp).toBeTruthy();
  });

  test("an unavailable counter fails open", async () => {
    consumeSpy.mockResolvedValue({
      outcome: OnCallCalendarFeedRateLimitOutcome.CounterUnavailable,
    });

    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Personal, token),
    );

    expect(result.status).toBe(200);
  });

  describe("scheme guard", () => {
    test("https instance + trusted X-Forwarded-Proto: http -> 301 to the https URL built from HOST, before any lookup", async () => {
      setEnv({
        httpProtocol: Protocol.HTTPS,
        host: "oneuptime.example.com",
        trustedProxyHops: 1,
      });

      const requestPath: string = `${feedPath(
        OnCallCalendarFeedKind.Personal,
        token,
      )}?schedule=${ObjectID.generate().toString()}`;

      const result: HttpResult = await request(requestPath, {
        headers: { "X-Forwarded-Proto": "http", Host: "evil.example.net" },
      });

      expect(result.status).toBe(301);
      expect(header(result, "location")).toBe(
        `https://oneuptime.example.com${requestPath}`,
      );
      expect(header(result, "cache-control")).toBe("no-store");
      expect(personalFindOneBy).not.toHaveBeenCalled();
      expect(consumeSpy).not.toHaveBeenCalled();
    });

    test("the redirect target never comes from the request's Host header", async () => {
      setEnv({ httpProtocol: Protocol.HTTPS, trustedProxyHops: 1 });

      const result: HttpResult = await request(
        feedPath(OnCallCalendarFeedKind.Personal, token),
        { headers: { "X-Forwarded-Proto": "http", Host: "evil.example.net" } },
      );

      expect(header(result, "location")).not.toContain("evil.example.net");
    });

    /*
     * Regression: the guard used to fire on the trusted X-Forwarded-Proto
     * alone. Every proxying location in the shipped Nginx config sets
     * `X-Forwarded-Proto $scheme`, REPLACING whatever an outer proxy sent, so
     * on an install that terminates TLS on an external reverse proxy
     * (PROVISION_SSL=false with HTTP_PROTOCOL=https, which config.example.env
     * documents) Nginx always reported `http`. The 301 went to the very URL
     * the client had just asked for: an endless redirect loop, and all three
     * feed routes unusable while the dashboard handed out those same URLs.
     */
    test("an install whose TLS is terminated outside Nginx serves the feed instead of looping", async () => {
      setEnv({
        httpProtocol: Protocol.HTTPS,
        trustedProxyHops: 1,
        provisionSsl: false,
      });

      const result: HttpResult = await request(
        feedPath(OnCallCalendarFeedKind.Personal, token),
        { headers: { "X-Forwarded-Proto": "http" } },
      );

      expect(result.status).toBe(200);
      expect(result.body).toContain("BEGIN:VCALENDAR");
      expect(header(result, "location")).toBeUndefined();
    });

    test("with no trusted proxy hops the header is not trusted and the feed is served", async () => {
      setEnv({ httpProtocol: Protocol.HTTPS, trustedProxyHops: 0 });

      const result: HttpResult = await request(
        feedPath(OnCallCalendarFeedKind.Personal, token),
        { headers: { "X-Forwarded-Proto": "http" } },
      );

      expect(result.status).toBe(200);
    });

    test("a request that already arrived over https is served", async () => {
      setEnv({ httpProtocol: Protocol.HTTPS, trustedProxyHops: 1 });

      const result: HttpResult = await request(
        feedPath(OnCallCalendarFeedKind.Personal, token),
        { headers: { "X-Forwarded-Proto": "https" } },
      );

      expect(result.status).toBe(200);
    });

    test("an http instance never redirects", async () => {
      setEnv({ httpProtocol: Protocol.HTTP, trustedProxyHops: 1 });

      const result: HttpResult = await request(
        feedPath(OnCallCalendarFeedKind.Personal, token),
        { headers: { "X-Forwarded-Proto": "http" } },
      );

      expect(result.status).toBe(200);
    });

    test("an https instance with an empty HOST cannot build a target and serves the feed", async () => {
      setEnv({ httpProtocol: Protocol.HTTPS, trustedProxyHops: 1, host: "" });

      const result: HttpResult = await request(
        feedPath(OnCallCalendarFeedKind.Personal, token),
        { headers: { "X-Forwarded-Proto": "http" } },
      );

      expect(result.status).toBe(200);
    });
  });

  describe("conditional requests and HEAD (Express semantics on top of the route)", () => {
    test("If-None-Match with the current ETag is 304 with no body", async () => {
      const outcome: FeedRenderOutcome = renderedOutcome(
        OnCallCalendarFeedKind.Personal,
      );
      renderSpy.mockResolvedValue(outcome);

      const result: HttpResult = await request(
        feedPath(OnCallCalendarFeedKind.Personal, token),
        { headers: { "If-None-Match": outcome.etag } },
      );

      expect(result.status).toBe(304);
      expect(result.body).toBe("");
      expect(header(result, "etag")).toBe(outcome.etag);
    });

    test("a weak W/ If-None-Match (Outlook) still matches", async () => {
      const outcome: FeedRenderOutcome = renderedOutcome(
        OnCallCalendarFeedKind.Personal,
      );
      renderSpy.mockResolvedValue(outcome);

      const result: HttpResult = await request(
        feedPath(OnCallCalendarFeedKind.Personal, token),
        { headers: { "If-None-Match": `W/${outcome.etag}` } },
      );

      expect(result.status).toBe(304);
      expect(result.body).toBe("");
    });

    test("a stale If-None-Match gets the full body", async () => {
      const result: HttpResult = await request(
        feedPath(OnCallCalendarFeedKind.Personal, token),
        { headers: { "If-None-Match": '"0123456789abcdef0123456789abcdef"' } },
      );

      expect(result.status).toBe(200);
      expect(result.body).toContain("BEGIN:VCALENDAR");
    });

    test("If-Modified-Since at or after Last-Modified is 304", async () => {
      const outcome: FeedRenderOutcome = renderedOutcome(
        OnCallCalendarFeedKind.Personal,
      );
      renderSpy.mockResolvedValue(outcome);

      const result: HttpResult = await request(
        feedPath(OnCallCalendarFeedKind.Personal, token),
        {
          headers: { "If-Modified-Since": outcome.lastModified.toUTCString() },
        },
      );

      expect(result.status).toBe(304);
    });

    test("HEAD is answered with the headers and no body, and is NOT counted as a fetch", async () => {
      const result: HttpResult = await request(
        feedPath(OnCallCalendarFeedKind.Personal, token),
        { method: "HEAD" },
      );

      expect(result.status).toBe(200);
      expect(result.body).toBe("");
      expect(header(result, "content-type")).toBe(
        "text/calendar; charset=utf-8",
      );
      expect(header(result, "etag")).toBeDefined();

      await flushBackgroundWork();

      expect(personalUpdateOneById).not.toHaveBeenCalled();
    });
  });

  describe("bookkeeping", () => {
    test("a first GET writes lastFetchedAt, the coarse client family, fetchCount + 1 and lastRenderTruncated as root", async () => {
      row.fetchCount = 41;

      await request(feedPath(OnCallCalendarFeedKind.Personal, token), {
        headers: { "User-Agent": "Google-Calendar-Importer" },
      });

      await flushBackgroundWork();

      expect(personalUpdateOneById).toHaveBeenCalledTimes(1);

      const update: CapturedUpdate = callsOf<CapturedUpdate>(
        personalUpdateOneById,
      )[0] as CapturedUpdate;

      expect(String(update.id)).toBe(row.id.toString());
      expect(update.data).toEqual({
        lastFetchedAt: NOW,
        lastFetchedClient: "Google Calendar",
        fetchCount: 42,
        lastRenderTruncated: false,
      });
      expect(update.props?.isRoot).toBe(true);
      expect(update.props?.ignoreHooks).toBe(true);
    });

    test("the raw User-Agent is never stored", async () => {
      const userAgent: string =
        "Mozilla/5.0 (Linux; Android 14; Pixel 8; device-id=ABCDEF) okhttp/4.12";

      await request(feedPath(OnCallCalendarFeedKind.Personal, token), {
        headers: { "User-Agent": userAgent },
      });

      await flushBackgroundWork();

      const update: CapturedUpdate = callsOf<CapturedUpdate>(
        personalUpdateOneById,
      )[0] as CapturedUpdate;

      expect(update.data["lastFetchedClient"]).toBe("Android app");
      expect(JSON.stringify(update)).not.toContain("ABCDEF");
    });

    test("a GET inside the five-minute interval is not written", async () => {
      row.lastFetchedAt = new Date(NOW.getTime() - 60 * 1000);

      await request(feedPath(OnCallCalendarFeedKind.Personal, token));
      await flushBackgroundWork();

      expect(personalUpdateOneById).not.toHaveBeenCalled();
    });

    test("a GET after the interval is written", async () => {
      row.lastFetchedAt = new Date(NOW.getTime() - 6 * 60 * 1000);

      await request(feedPath(OnCallCalendarFeedKind.Personal, token));
      await flushBackgroundWork();

      expect(personalUpdateOneById).toHaveBeenCalledTimes(1);
    });

    test("a no-User-Agent fetch is recorded as Other", async () => {
      await request(feedPath(OnCallCalendarFeedKind.Personal, token));
      await flushBackgroundWork();

      const update: CapturedUpdate = callsOf<CapturedUpdate>(
        personalUpdateOneById,
      )[0] as CapturedUpdate;

      expect(update.data["lastFetchedClient"]).toBe("Other");
    });

    test("a failing bookkeeping write never reaches the response, and its log line carries no token", async () => {
      personalUpdateOneById.mockRejectedValue(new Error("postgres is away"));

      const result: HttpResult = await request(
        feedPath(OnCallCalendarFeedKind.Personal, token),
      );

      await flushBackgroundWork();

      expect(result.status).toBe(200);
      expect(logger.warn).toHaveBeenCalled();

      for (const line of everyLogArgument()) {
        expect(line).not.toContain(token);
      }
    });
  });

  test("a renderer that throws is passed to the error handler, not answered as a calendar", async () => {
    renderSpy.mockRejectedValue(new Error(`boom ${"x".repeat(3)}`));

    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Personal, token),
    );

    expect(result.status).toBe(500);
    expect(header(result, "content-type")).not.toContain("text/calendar");
    expect(result.body).not.toContain(token);
  });

  test("a row with no user cannot be served (404)", async () => {
    row.userId = undefined;

    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Personal, token),
    );

    expect(result.status).toBe(404);
    expect(renderSpy).not.toHaveBeenCalled();
  });

  test("across every branch, the token and its hash never reach a log line", async () => {
    const previousToken: string = CalendarFeedToken.mint();
    row.previousTokenHash = CalendarFeedToken.hash(previousToken);
    row.previousTokenExpiresAt = at("2026-09-20T00:00:00Z");
    personalUpdateOneById.mockRejectedValue(new Error("write failed"));

    await request(feedPath(OnCallCalendarFeedKind.Personal, token));
    await request(feedPath(OnCallCalendarFeedKind.Personal, previousToken));
    await request(feedPath(OnCallCalendarFeedKind.Personal, UNKNOWN_TOKEN));
    await request(`${API_PREFIX}/on-call-calendar/user/bad/shifts.ics`);

    renderSpy.mockResolvedValue(
      OnCallCalendarFeedRenderer.buildUnavailableOutcome(
        OnCallCalendarFeedKind.Personal,
        60,
      ),
    );
    await request(feedPath(OnCallCalendarFeedKind.Personal, token));

    renderSpy.mockRejectedValue(new Error("render exploded"));
    await request(feedPath(OnCallCalendarFeedKind.Personal, token));

    consumeSpy.mockResolvedValue({
      outcome: OnCallCalendarFeedRateLimitOutcome.RateLimited,
      retryAfterSeconds: 5,
      scope: OnCallCalendarFeedRateLimitScope.Ip,
      isFirstRejectionInWindow: true,
    });
    await request(feedPath(OnCallCalendarFeedKind.Personal, token));

    setEnv({ disableFeed: true });
    await request(feedPath(OnCallCalendarFeedKind.Personal, token));

    await flushBackgroundWork();

    const lines: Array<string> = everyLogArgument();

    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      expect(line).not.toContain(token);
      expect(line).not.toContain(previousToken);
      expect(line).not.toContain(UNKNOWN_TOKEN);
      expect(line).not.toContain(CalendarFeedToken.hash(token));
      expect(line).not.toContain(CalendarFeedToken.hash(previousToken));
    }
  });
});

// -- Near misses on a token path ---------------------------------------------

/*
 * Regression: only the three exact GET routes existed, so a link pasted
 * without the trailing `shifts.ics`, a typo in the filename, or any
 * POST/PUT/DELETE to a feed URL fell through to the application's own
 * catch-alls, which answer `Page not found - ${req.url}` -- the plaintext
 * capability token, at ERROR level, in stdout, in the master-admin support
 * bundle's recent-log buffer and in the OTel log exporter. Redaction cannot
 * save it: the message has no credential keyword, no key=value shape and no
 * scheme, so the hint regex never fires. These fallbacks answer first, and
 * their message is a constant.
 */
describe("near misses on a token-bearing path never echo or log the token", () => {
  let token: string;

  beforeEach(() => {
    token = CalendarFeedToken.mint();

    personalFindOneBy.mockImplementation(
      lookupFrom([
        personalRow({
          projectId,
          userId,
          tokenHash: CalendarFeedToken.hash(token),
        }),
      ]) as never,
    );
  });

  function nearMisses(): Array<{ path: string; method: string }> {
    const kinds: Array<string> = ["user", "schedule", "project"];
    const out: Array<{ path: string; method: string }> = [];

    for (const kind of kinds) {
      /* The link pasted without its filename. */
      out.push({
        path: `${API_PREFIX}/on-call-calendar/${kind}/${token}`,
        method: "GET",
      });
      /* A typo in the filename. */
      out.push({
        path: `${API_PREFIX}/on-call-calendar/${kind}/${token}/shifts.ical`,
        method: "GET",
      });
      /* A trailing slash. */
      out.push({
        path: `${API_PREFIX}/on-call-calendar/${kind}/${token}/`,
        method: "GET",
      });
      /* A client or a scanner using the wrong method on the real URL. */
      for (const method of ["POST", "PUT", "DELETE"]) {
        out.push({
          path: `${API_PREFIX}/on-call-calendar/${kind}/${token}/shifts.ics`,
          method,
        });
      }
    }

    return out;
  }

  test("a GET that misses the exact route is a generic 404 that does not name the URL", async () => {
    const result: HttpResult = await request(
      `${API_PREFIX}/on-call-calendar/user/${token}`,
    );

    expect(result.status).toBe(404);
    expect(json(result)).toEqual({ message: "Not found." });
    expect(result.body).not.toContain(token);
    expect(personalFindOneBy).not.toHaveBeenCalled();
    expect(renderSpy).not.toHaveBeenCalled();
  });

  test("a wrong method on the real URL is 405 with Allow: GET, HEAD", async () => {
    const result: HttpResult = await postJson(
      `${API_PREFIX}/on-call-calendar/user/${token}/shifts.ics`,
    );

    expect(result.status).toBe(405);
    expect(header(result, "allow")).toBe(FEED_ALLOWED_METHODS);
    expect(result.body).not.toContain(token);
    expect(renderSpy).not.toHaveBeenCalled();
  });

  test("OPTIONS is answered as OPTIONS should be, not as a 405", async () => {
    const result: HttpResult = await request(
      `${API_PREFIX}/on-call-calendar/user/${token}/shifts.ics`,
      { method: "OPTIONS" },
    );

    expect(result.status).toBe(200);
    expect(header(result, "allow")).toBe(FEED_ALLOWED_METHODS);
    expect(result.body).not.toContain(token);
  });

  test("no near miss on any of the three kinds puts the token in the body or a log line", async () => {
    for (const { path, method } of nearMisses()) {
      const result: HttpResult = await request(path, { method });

      expect([404, 405]).toContain(result.status);
      expect(result.body).not.toContain(token);
    }

    await flushBackgroundWork();

    const lines: Array<string> = everyLogArgument();

    for (const line of lines) {
      expect(line).not.toContain(token);
      expect(line).not.toContain(CalendarFeedToken.hash(token));
    }
  });

  test("the exact route still wins over the fallback", async () => {
    renderSpy.mockResolvedValue(
      renderedOutcome(OnCallCalendarFeedKind.Personal),
    );

    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Personal, token),
    );

    expect(result.status).toBe(200);
    expect(result.body).toContain("BEGIN:VCALENDAR");
  });

  test("the fallbacks do not shadow the session routes", async () => {
    const result: HttpResult = await request(
      `${API_PREFIX}${SCHEDULE_FEED_CURRENT_ROUTE.replace(
        ":scheduleId",
        ObjectID.generate().toString(),
      )}`,
    );

    expect(result.status).toBe(200);
    expect(json(result)["exists"]).toBe(false);
  });
});

// -- Public routes: the schedule feed ------------------------------------------

describe("GET /on-call-calendar/schedule/:token/schedule.ics", () => {
  let token: string;
  let row: FeedRowFixture;

  beforeEach(() => {
    token = CalendarFeedToken.mint();
    row = scheduleRow({
      projectId,
      tokenHash: CalendarFeedToken.hash(token),
      includeCoverageGaps: true,
      minimumGapMinutes: 45,
      pastDays: 3,
      futureDays: 60,
    });

    scheduleFindOneBy.mockImplementation(lookupFrom([row]) as never);
    renderSpy.mockResolvedValue(
      renderedOutcome(OnCallCalendarFeedKind.Schedule),
    );
  });

  test("a known token renders the schedule feed with the row's gap settings", async () => {
    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Schedule, token),
    );

    expect(result.status).toBe(200);
    expect(header(result, "content-type")).toBe("text/calendar; charset=utf-8");
    expect(header(result, "pragma")).toBeUndefined();

    const renderRequest: Record<string, unknown> = renderSpy.mock
      .calls[0]?.[0] as Record<string, unknown>;

    expect(renderRequest["kind"]).toBe(OnCallCalendarFeedKind.Schedule);
    expect(String(renderRequest["scheduleId"])).toBe(
      row.onCallDutyPolicyScheduleId?.toString(),
    );
    expect(String(renderRequest["projectId"])).toBe(projectId.toString());
    expect(renderRequest["includeCoverageGaps"]).toBe(true);
    expect(renderRequest["minimumGapMinutes"]).toBe(45);
    expect(renderRequest["pastDays"]).toBe(3);
    expect(renderRequest["futureDays"]).toBe(60);
    expect(renderRequest["tokenHash"]).toBe(CalendarFeedToken.hash(token));
    expect(renderRequest["userId"]).toBeUndefined();
  });

  test("the lookup never selects the token", async () => {
    await request(feedPath(OnCallCalendarFeedKind.Schedule, UNKNOWN_TOKEN));

    for (const call of callsOf<CapturedFindOneBy>(scheduleFindOneBy)) {
      expect(call.select?.["token"]).toBeUndefined();
      expect(call.select?.["tokenHash"]).toBeUndefined();
      expect(call.props?.isRoot).toBe(true);
    }
  });

  test("unknown -> 404; rotated-in-grace -> empty; disabled -> empty", async () => {
    const unknown: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Schedule, UNKNOWN_TOKEN),
    );
    expect(unknown.status).toBe(404);

    const previousToken: string = CalendarFeedToken.mint();
    row.previousTokenHash = CalendarFeedToken.hash(previousToken);
    row.previousTokenExpiresAt = at("2026-09-20T00:00:00Z");

    const rotated: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Schedule, previousToken),
    );
    expect(rotated.status).toBe(200);
    expect(rotated.body).not.toContain("BEGIN:VEVENT");
    expect(rotated.body.replace(/\r\n /g, "")).toContain(
      TOKEN_ROTATED_REASON.slice(0, 40),
    );

    row.isEnabled = false;

    const disabled: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Schedule, token),
    );
    expect(disabled.status).toBe(200);
    expect(disabled.body).not.toContain("BEGIN:VEVENT");
    expect(disabled.body.replace(/\r\n /g, "")).toContain(
      FEED_DISABLED_REASON.slice(0, 40),
    );

    expect(renderSpy).not.toHaveBeenCalled();
  });

  test("a row without a schedule id (FK gone) is 404", async () => {
    row.onCallDutyPolicyScheduleId = undefined;

    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Schedule, token),
    );

    expect(result.status).toBe(404);
  });

  test("bookkeeping goes to the schedule feed service", async () => {
    await request(feedPath(OnCallCalendarFeedKind.Schedule, token), {
      headers: { "User-Agent": "CalendarAgent/1000" },
    });

    await flushBackgroundWork();

    expect(scheduleUpdateOneById).toHaveBeenCalledTimes(1);
    expect(personalUpdateOneById).not.toHaveBeenCalled();
    expect(projectUpdateOneById).not.toHaveBeenCalled();

    const update: CapturedUpdate = callsOf<CapturedUpdate>(
      scheduleUpdateOneById,
    )[0] as CapturedUpdate;

    expect(update.data["lastFetchedClient"]).toBe("Apple Calendar");
    expect(update.data["fetchCount"]).toBe(1);
  });

  test("the kill switch and the scheme guard apply here too", async () => {
    setEnv({ disableFeed: true });

    const off: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Schedule, token),
    );
    expect(off.status).toBe(503);
    expect(header(off, "retry-after")).toBe("3600");

    setEnv({
      disableFeed: false,
      httpProtocol: Protocol.HTTPS,
      trustedProxyHops: 1,
    });

    const redirected: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Schedule, token),
      { headers: { "X-Forwarded-Proto": "http" } },
    );
    expect(redirected.status).toBe(301);
  });
});

// -- Public routes: the project feed --------------------------------------------

describe("GET /on-call-calendar/project/:token/project.ics", () => {
  let token: string;
  let row: FeedRowFixture;

  beforeEach(() => {
    token = CalendarFeedToken.mint();
    row = projectRow({
      projectId,
      tokenHash: CalendarFeedToken.hash(token),
    });

    projectFindOneBy.mockImplementation(lookupFrom([row]) as never);
    renderSpy.mockResolvedValue(
      renderedOutcome(OnCallCalendarFeedKind.Project),
    );
  });

  test("a known token renders the project feed", async () => {
    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Project, token),
    );

    expect(result.status).toBe(200);
    expect(header(result, "content-type")).toBe("text/calendar; charset=utf-8");

    const renderRequest: Record<string, unknown> = renderSpy.mock
      .calls[0]?.[0] as Record<string, unknown>;

    expect(renderRequest["kind"]).toBe(OnCallCalendarFeedKind.Project);
    expect(String(renderRequest["projectId"])).toBe(projectId.toString());
    expect(renderRequest["includeCoverageGaps"]).toBe(true);
    expect(renderRequest["minimumGapMinutes"]).toBe(30);
    expect(renderRequest["scheduleId"]).toBeUndefined();
    expect(renderRequest["userId"]).toBeUndefined();
  });

  test("the lookup never selects the token", async () => {
    await request(feedPath(OnCallCalendarFeedKind.Project, UNKNOWN_TOKEN));

    const calls: Array<CapturedFindOneBy> =
      callsOf<CapturedFindOneBy>(projectFindOneBy);

    expect(calls).toHaveLength(2);

    for (const call of calls) {
      expect(call.select?.["token"]).toBeUndefined();
      expect(call.select?.["tokenHash"]).toBeUndefined();
      expect(call.props?.isRoot).toBe(true);
    }
  });

  test("unknown -> 404; rotated-in-grace -> empty; disabled -> empty; rotated-past-grace -> 404", async () => {
    expect(
      (await request(feedPath(OnCallCalendarFeedKind.Project, UNKNOWN_TOKEN)))
        .status,
    ).toBe(404);

    const previousToken: string = CalendarFeedToken.mint();
    row.previousTokenHash = CalendarFeedToken.hash(previousToken);
    row.previousTokenExpiresAt = at("2026-09-20T00:00:00Z");

    const rotated: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Project, previousToken),
    );
    expect(rotated.status).toBe(200);
    expect(rotated.body).not.toContain("BEGIN:VEVENT");

    row.previousTokenExpiresAt = at("2026-08-01T00:00:00Z");
    expect(
      (await request(feedPath(OnCallCalendarFeedKind.Project, previousToken)))
        .status,
    ).toBe(404);

    row.isEnabled = false;
    const disabled: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Project, token),
    );
    expect(disabled.status).toBe(200);
    expect(disabled.body).not.toContain("BEGIN:VEVENT");

    expect(renderSpy).not.toHaveBeenCalled();
    expect(projectUpdateOneById).not.toHaveBeenCalled();
  });

  test("bookkeeping goes to the project feed service", async () => {
    await request(feedPath(OnCallCalendarFeedKind.Project, token), {
      headers: { "User-Agent": "Mozilla/5.0 Thunderbird/128" },
    });

    await flushBackgroundWork();

    expect(projectUpdateOneById).toHaveBeenCalledTimes(1);

    const update: CapturedUpdate = callsOf<CapturedUpdate>(
      projectUpdateOneById,
    )[0] as CapturedUpdate;

    expect(update.data["lastFetchedClient"]).toBe("Thunderbird");
  });

  test("HEAD is served and not counted", async () => {
    const result: HttpResult = await request(
      feedPath(OnCallCalendarFeedKind.Project, token),
      { method: "HEAD" },
    );

    expect(result.status).toBe(200);
    expect(result.body).toBe("");

    await flushBackgroundWork();

    expect(projectUpdateOneById).not.toHaveBeenCalled();
  });
});

// -- Session routes: the personal feed ------------------------------------------

describe("GET /on-call-calendar/feed/current", () => {
  test("no feed yet: exists false with the defaults and the deployment warnings", async () => {
    setEnv({ host: "localhost", httpProtocol: Protocol.HTTP });

    const result: HttpResult = await request(
      `${API_PREFIX}${FEED_CURRENT_ROUTE}`,
    );

    expect(result.status).toBe(200);
    expect(json(result)).toEqual({
      ...buildAbsentFeedStatus(OnCallCalendarFeedKind.Personal),
      hostWarning: HOST_WARNING,
      protocolWarning: PROTOCOL_WARNING,
    });

    const lookup: CapturedFindOneBy = callsOf<CapturedFindOneBy>(
      personalFindOneBy,
    )[0] as CapturedFindOneBy;

    expect(String(lookup.query["projectId"])).toBe(projectId.toString());
    expect(String(lookup.query["userId"])).toBe(userId.toString());
    expect(lookup.select?.["token"]).toBeUndefined();
    expect(personalFindOneById).not.toHaveBeenCalled();
  });

  test("an existing feed: the ONE decrypting read, verified against tokenHash, yields the URLs", async () => {
    const token: string = CalendarFeedToken.mint();
    const row: FeedRowFixture = personalRow({
      projectId,
      userId,
      tokenHash: CalendarFeedToken.hash(token),
      fetchCount: 12,
      lastFetchedAt: at("2026-08-31T10:00:00Z"),
      lastFetchedClient: "Google Calendar",
    });

    personalFindOneBy.mockImplementation(lookupFrom([row]) as never);
    personalFindOneById.mockResolvedValue({
      id: row.id,
      token,
      tokenHash: row.tokenHash,
    } as never);

    const result: HttpResult = await request(
      `${API_PREFIX}${FEED_CURRENT_ROUTE}`,
    );

    expect(result.status).toBe(200);

    const status: Record<string, unknown> = json(result);

    expect(status["exists"]).toBe(true);
    expect(status["feedId"]).toBe(row.id.toString());
    expect(status["needsRegeneration"]).toBe(false);
    expect(status["tokenHint"]).toBe(row.tokenHint);
    expect(status["fetchCount"]).toBe(12);
    expect(status["lastFetchedAt"]).toBe("2026-08-31T10:00:00.000Z");
    expect(status["lastFetchedClient"]).toBe("Google Calendar");
    expect(status["hostWarning"]).toBeNull();
    expect(status["protocolWarning"]).toBeNull();

    const urls: Record<string, string> = status["urls"] as Record<
      string,
      string
    >;

    expect(urls["https"]).toBe(
      `https://oneuptime.example.com/api/on-call-calendar/user/${token}/shifts.ics`,
    );
    expect(urls["webcal"]).toBe(
      `webcals://oneuptime.example.com/api/on-call-calendar/user/${token}/shifts.ics`,
    );
    expect(urls["googleAdd"]).toContain(
      encodeURIComponent(urls["https"] || ""),
    );

    const decryptingRead: {
      id: ObjectID;
      select: Record<string, unknown>;
      props: { isRoot?: boolean };
    } = personalFindOneById.mock.calls[0]?.[0] as {
      id: ObjectID;
      select: Record<string, unknown>;
      props: { isRoot?: boolean };
    };

    expect(String(decryptingRead.id)).toBe(row.id.toString());
    expect(decryptingRead.select["token"]).toBe(true);
    expect(decryptingRead.select["tokenHash"]).toBe(true);
    expect(decryptingRead.props.isRoot).toBe(true);
  });

  /*
   * Regression: the status builder verified the decrypted token against the
   * STATUS ROW's tokenHash, and no status read can select that column -- its
   * read access list is empty, so the non-root schedule and project reads
   * would be refused outright. The row therefore never carried it and every
   * /current and /publish answered `needsRegeneration: true, urls: null` for
   * a perfectly good feed: the settings page told every user on every page
   * load to regenerate a link that worked, and regenerating it blanked the
   * calendar they had already subscribed. The hash to verify against comes
   * from the decrypting root read, which selects it.
   */
  test("the status read does not select tokenHash, and the link is shown anyway", async () => {
    const token: string = CalendarFeedToken.mint();
    const row: FeedRowFixture = personalRow({
      projectId,
      userId,
      tokenHash: CalendarFeedToken.hash(token),
    });

    personalFindOneBy.mockImplementation(lookupFrom([row]) as never);
    personalFindOneById.mockResolvedValue({
      id: row.id,
      token,
      tokenHash: row.tokenHash,
    } as never);

    const status: Record<string, unknown> = json(
      await request(`${API_PREFIX}${FEED_CURRENT_ROUTE}`),
    );

    const statusRead: CapturedFindOneBy = personalFindOneBy.mock
      .calls[0]?.[0] as CapturedFindOneBy;

    expect(statusRead.select?.["tokenHash"]).toBeUndefined();
    expect(statusRead.select?.["token"]).toBeUndefined();
    expect(status["needsRegeneration"]).toBe(false);
    expect(status["urls"]).not.toBeNull();
  });

  test("a decrypted token that does not match the hash the root read returned is needsRegeneration", async () => {
    const token: string = CalendarFeedToken.mint();
    const row: FeedRowFixture = personalRow({
      projectId,
      userId,
      tokenHash: CalendarFeedToken.hash(token),
    });

    personalFindOneBy.mockImplementation(lookupFrom([row]) as never);

    /* Decrypts to something, but not to what tokenHash says. */
    personalFindOneById.mockResolvedValue({
      id: row.id,
      token: CalendarFeedToken.mint(),
      tokenHash: row.tokenHash,
    } as never);

    const status: Record<string, unknown> = json(
      await request(`${API_PREFIX}${FEED_CURRENT_ROUTE}`),
    );

    expect(status["needsRegeneration"]).toBe(true);
    expect(status["urls"]).toBeNull();
  });

  test("webcal is webcal:// on an http instance", async () => {
    setEnv({ httpProtocol: Protocol.HTTP });

    const token: string = CalendarFeedToken.mint();
    const row: FeedRowFixture = personalRow({
      projectId,
      userId,
      tokenHash: CalendarFeedToken.hash(token),
    });

    personalFindOneBy.mockImplementation(lookupFrom([row]) as never);
    personalFindOneById.mockResolvedValue({
      id: row.id,
      token,
      tokenHash: row.tokenHash,
    } as never);

    const status: Record<string, unknown> = json(
      await request(`${API_PREFIX}${FEED_CURRENT_ROUTE}`),
    );

    const urls: Record<string, string> = status["urls"] as Record<
      string,
      string
    >;

    expect(urls["webcal"]?.startsWith("webcal://")).toBe(true);
    expect(urls["https"]?.startsWith("http://")).toBe(true);
    expect(status["protocolWarning"]).toBe(PROTOCOL_WARNING);
  });

  test("a rotated ENCRYPTION_SECRET (decrypt throws) is needsRegeneration, still 200, never 500", async () => {
    const row: FeedRowFixture = personalRow({ projectId, userId });

    personalFindOneBy.mockImplementation(lookupFrom([row]) as never);
    personalFindOneById.mockRejectedValue(
      new Error("Unsupported state or unable to authenticate data"),
    );

    const result: HttpResult = await request(
      `${API_PREFIX}${FEED_CURRENT_ROUTE}`,
    );

    expect(result.status).toBe(200);

    const status: Record<string, unknown> = json(result);

    expect(status["exists"]).toBe(true);
    expect(status["needsRegeneration"]).toBe(true);
    expect(status["urls"]).toBeNull();
    expect(status["tokenHint"]).toBe(row.tokenHint);
  });

  test("a rotated ENCRYPTION_SECRET (decrypt yields bytes that do not hash to tokenHash) is needsRegeneration", async () => {
    const row: FeedRowFixture = personalRow({ projectId, userId });

    personalFindOneBy.mockImplementation(lookupFrom([row]) as never);
    personalFindOneById.mockResolvedValue({
      id: row.id,
      token: CalendarFeedToken.mint(),
      tokenHash: row.tokenHash,
    } as never);

    const status: Record<string, unknown> = json(
      await request(`${API_PREFIX}${FEED_CURRENT_ROUTE}`),
    );

    expect(status["needsRegeneration"]).toBe(true);
    expect(status["urls"]).toBeNull();
  });

  test("an empty token column is needsRegeneration", async () => {
    const row: FeedRowFixture = personalRow({ projectId, userId });

    personalFindOneBy.mockImplementation(lookupFrom([row]) as never);
    personalFindOneById.mockResolvedValue({
      id: row.id,
      token: "",
      tokenHash: row.tokenHash,
    } as never);

    const status: Record<string, unknown> = json(
      await request(`${API_PREFIX}${FEED_CURRENT_ROUTE}`),
    );

    expect(status["needsRegeneration"]).toBe(true);
  });

  test("the response never carries the hash", async () => {
    const token: string = CalendarFeedToken.mint();
    const row: FeedRowFixture = personalRow({
      projectId,
      userId,
      tokenHash: CalendarFeedToken.hash(token),
    });

    personalFindOneBy.mockImplementation(lookupFrom([row]) as never);
    personalFindOneById.mockResolvedValue({
      id: row.id,
      token,
      tokenHash: row.tokenHash,
    } as never);

    const result: HttpResult = await request(
      `${API_PREFIX}${FEED_CURRENT_ROUTE}`,
    );

    expect(result.body).not.toContain(row.tokenHash);
  });

  test("without a tenant header the caller is refused and nothing is read", async () => {
    propsSpy.mockResolvedValue(
      buildMemberProps({ projectId: undefined, userId }),
    );

    const result: HttpResult = await request(
      `${API_PREFIX}${FEED_CURRENT_ROUTE}`,
    );

    expect(result.status).toBe(ExceptionCode.BadDataException);
    expect(personalFindOneBy).not.toHaveBeenCalled();
  });

  test("a caller who is not a member of the claimed project is refused", async () => {
    propsSpy.mockResolvedValue({
      tenantId: projectId,
      userId,
      userTenantAccessPermission: {},
    });

    const result: HttpResult = await request(
      `${API_PREFIX}${FEED_CURRENT_ROUTE}`,
    );

    expect(result.status).toBe(ExceptionCode.NotAuthorizedException);
    expect(personalFindOneBy).not.toHaveBeenCalled();
  });

  test("an anonymous caller (no user) is refused", async () => {
    propsSpy.mockResolvedValue(
      buildMemberProps({ projectId, userId: undefined }),
    );

    const result: HttpResult = await request(
      `${API_PREFIX}${FEED_CURRENT_ROUTE}`,
    );

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(personalFindOneBy).not.toHaveBeenCalled();
  });
});

describe("POST /on-call-calendar/feed/rotate", () => {
  test("a non-JSON POST is 415 and mints nothing", async () => {
    const result: HttpResult = await request(
      `${API_PREFIX}${FEED_ROTATE_ROUTE}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );

    expect(result.status).toBe(415);
    expect(personalCreateForUser).not.toHaveBeenCalled();
    expect(personalRotate).not.toHaveBeenCalled();
    expect(semaphoreLock).not.toHaveBeenCalled();
  });

  test("a POST with no content type is 415", async () => {
    const result: HttpResult = await request(
      `${API_PREFIX}${FEED_ROTATE_ROUTE}`,
      {
        method: "POST",
      },
    );

    expect(result.status).toBe(415);
  });

  test("first time: mints the row as root under the (project, user) lock, purges, and returns the plaintext once", async () => {
    const token: string = CalendarFeedToken.mint();
    let created: FeedRowFixture | null = null;

    personalCreateForUser.mockImplementation(
      async (data: { projectId: ObjectID; userId: ObjectID }) => {
        created = personalRow({
          projectId: data.projectId,
          userId: data.userId,
          tokenHash: CalendarFeedToken.hash(token),
          tokenHint: token.slice(-4),
          rotatedAt: NOW,
        });

        return {
          feed: created,
          minted: {
            token,
            tokenHash: CalendarFeedToken.hash(token),
            tokenHint: token.slice(-4),
          },
        };
      },
    );

    personalFindOneBy.mockImplementation(
      async (args: CapturedFindOneBy): Promise<FeedRowFixture | null> => {
        return created ? lookupFrom([created])(args) : null;
      },
    );

    const result: HttpResult = await postJson(
      `${API_PREFIX}${FEED_ROTATE_ROUTE}`,
    );

    expect(result.status).toBe(200);

    expect(personalCreateForUser).toHaveBeenCalledTimes(1);
    expect(personalRotate).not.toHaveBeenCalled();

    const createArgs: { projectId: ObjectID; userId: ObjectID } =
      personalCreateForUser.mock.calls[0]?.[0] as {
        projectId: ObjectID;
        userId: ObjectID;
      };

    expect(createArgs.projectId.toString()).toBe(projectId.toString());
    expect(createArgs.userId.toString()).toBe(userId.toString());

    expect(semaphoreLock).toHaveBeenCalledWith({
      key: `${projectId.toString()}-${userId.toString()}`,
      namespace: ROTATE_LOCK_NAMESPACE,
      lockTimeout: ROTATE_LOCK_TIMEOUT_MS,
    });
    expect(ROTATE_LOCK_NAMESPACE).toBe("OnCallCalendarFeed.rotate");
    expect(semaphoreRelease).toHaveBeenCalledTimes(1);

    expect(purgeForUser).toHaveBeenCalledWith(
      projectId.toString(),
      userId.toString(),
    );

    const status: Record<string, unknown> = json(result);

    expect(status["exists"]).toBe(true);
    expect(status["needsRegeneration"]).toBe(false);
    expect(status["tokenHint"]).toBe(token.slice(-4));
    expect((status["urls"] as Record<string, string>)["https"]).toContain(
      `/api/on-call-calendar/user/${token}/shifts.ics`,
    );

    /* The plaintext came from the mint, so no decrypting read was needed. */
    expect(personalFindOneById).not.toHaveBeenCalled();
  });

  test("existing feed: rotates by id, moving the old hash into its grace, and returns the new plaintext", async () => {
    const oldToken: string = CalendarFeedToken.mint();
    const newToken: string = CalendarFeedToken.mint();
    const row: FeedRowFixture = personalRow({
      projectId,
      userId,
      tokenHash: CalendarFeedToken.hash(oldToken),
    });

    personalFindOneBy.mockImplementation(lookupFrom([row]) as never);

    personalRotate.mockImplementation(
      async (data: { id: ObjectID }): Promise<CalendarFeedRotation> => {
        expect(data.id.toString()).toBe(row.id.toString());

        row.tokenHash = CalendarFeedToken.hash(newToken);
        row.previousTokenHash = CalendarFeedToken.hash(oldToken);
        row.previousTokenExpiresAt = at("2026-10-01T12:00:00Z");
        row.tokenHint = newToken.slice(-4);
        row.rotatedAt = NOW;

        return {
          token: newToken,
          tokenHash: row.tokenHash,
          tokenHint: row.tokenHint,
          rotatedAt: NOW,
          previousTokenHash: row.previousTokenHash,
          previousTokenExpiresAt: row.previousTokenExpiresAt,
        };
      },
    );

    const result: HttpResult = await postJson(
      `${API_PREFIX}${FEED_ROTATE_ROUTE}`,
    );

    expect(result.status).toBe(200);
    expect(personalCreateForUser).not.toHaveBeenCalled();
    expect(personalRotate).toHaveBeenCalledTimes(1);
    expect(purgeForUser).toHaveBeenCalledTimes(1);

    const status: Record<string, unknown> = json(result);

    expect(status["tokenHint"]).toBe(newToken.slice(-4));
    expect(status["rotatedAt"]).toBe(NOW.toISOString());
    expect(status["previousTokenExpiresAt"]).toBe("2026-10-01T12:00:00.000Z");
    expect((status["urls"] as Record<string, string>)["https"]).toContain(
      newToken,
    );
    expect(result.body).not.toContain(oldToken);
  });

  test("the lock is released even when the mint throws, and the error propagates", async () => {
    personalCreateForUser.mockRejectedValue(new Error("unique violation"));

    const result: HttpResult = await postJson(
      `${API_PREFIX}${FEED_ROTATE_ROUTE}`,
    );

    expect(result.status).toBe(500);
    expect(semaphoreRelease).toHaveBeenCalledTimes(1);
    expect(purgeForUser).not.toHaveBeenCalled();
  });

  test("when the lock cannot be taken (Redis away) the rotation still proceeds on the unique index", async () => {
    semaphoreLock.mockRejectedValue(new Error("redis is away"));

    const token: string = CalendarFeedToken.mint();
    const row: FeedRowFixture = personalRow({
      projectId,
      userId,
      tokenHash: CalendarFeedToken.hash(token),
    });

    personalFindOneBy.mockImplementation(lookupFrom([row]) as never);
    personalRotate.mockResolvedValue({
      token,
      tokenHash: row.tokenHash,
      tokenHint: token.slice(-4),
      rotatedAt: NOW,
      previousTokenHash: null,
      previousTokenExpiresAt: null,
    });

    const result: HttpResult = await postJson(
      `${API_PREFIX}${FEED_ROTATE_ROUTE}`,
    );

    expect(result.status).toBe(200);
    expect(personalRotate).toHaveBeenCalledTimes(1);
    expect(semaphoreRelease).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  test("a non-member is refused before the lock", async () => {
    propsSpy.mockResolvedValue({
      tenantId: projectId,
      userId,
      userTenantAccessPermission: {},
    });

    const result: HttpResult = await postJson(
      `${API_PREFIX}${FEED_ROTATE_ROUTE}`,
    );

    expect(result.status).toBe(ExceptionCode.NotAuthorizedException);
    expect(semaphoreLock).not.toHaveBeenCalled();
    expect(personalCreateForUser).not.toHaveBeenCalled();
  });
});

// -- Session routes: the schedule feed -----------------------------------------

describe("schedule-feed session routes", () => {
  let scheduleId: ObjectID;

  function currentPath(): string {
    return `${API_PREFIX}${SCHEDULE_FEED_CURRENT_ROUTE.replace(
      ":scheduleId",
      scheduleId.toString(),
    )}`;
  }

  function publishPath(): string {
    return `${API_PREFIX}${SCHEDULE_FEED_PUBLISH_ROUTE.replace(
      ":scheduleId",
      scheduleId.toString(),
    )}`;
  }

  function rotatePath(): string {
    return `${API_PREFIX}${SCHEDULE_FEED_ROTATE_ROUTE.replace(
      ":scheduleId",
      scheduleId.toString(),
    )}`;
  }

  beforeEach(() => {
    scheduleId = ObjectID.generate();
  });

  test("GET /current reads with the CALLER's props (non-root) so TableAccessControl and label scoping apply", async () => {
    const result: HttpResult = await request(currentPath());

    expect(result.status).toBe(200);
    expect(json(result)["exists"]).toBe(false);
    expect(json(result)["settings"]).toEqual({
      includeCoverageGaps: false,
      minimumGapMinutes: 60,
      pastDays: DEFAULT_PAST_DAYS,
      futureDays: DEFAULT_FUTURE_DAYS,
      rotateWhenMemberLeaves: false,
    });

    const lookup: CapturedFindOneBy = callsOf<CapturedFindOneBy>(
      scheduleFindOneBy,
    )[0] as CapturedFindOneBy;

    expect(String(lookup.query["onCallDutyPolicyScheduleId"])).toBe(
      scheduleId.toString(),
    );
    expect(String(lookup.query["projectId"])).toBe(projectId.toString());
    expect(lookup.props?.isRoot).toBeUndefined();
    expect(lookup.props).toBe(await propsSpy.mock.results[0]?.value);
    expect(lookup.select?.["token"]).toBeUndefined();
  });

  test("GET /current with a published feed decrypts once and returns the schedule URL", async () => {
    const token: string = CalendarFeedToken.mint();
    const row: FeedRowFixture = scheduleRow({
      projectId,
      onCallDutyPolicyScheduleId: scheduleId,
      tokenHash: CalendarFeedToken.hash(token),
      rotateWhenMemberLeaves: true,
    });

    scheduleFindOneBy.mockImplementation(lookupFrom([row]) as never);
    scheduleFindOneById.mockResolvedValue({
      id: row.id,
      token,
      tokenHash: row.tokenHash,
    } as never);

    const status: Record<string, unknown> = json(await request(currentPath()));

    expect(status["exists"]).toBe(true);
    expect(status["feedId"]).toBe(row.id.toString());
    expect(status["needsRegeneration"]).toBe(false);
    expect((status["urls"] as Record<string, string>)["https"]).toBe(
      `https://oneuptime.example.com/api/on-call-calendar/schedule/${token}/schedule.ics`,
    );
    expect(
      (status["settings"] as Record<string, unknown>)["rotateWhenMemberLeaves"],
    ).toBe(true);
    expect(scheduleFindOneById).toHaveBeenCalledTimes(1);
  });

  test("GET /current with a rotated secret is needsRegeneration", async () => {
    const row: FeedRowFixture = scheduleRow({
      projectId,
      onCallDutyPolicyScheduleId: scheduleId,
    });

    scheduleFindOneBy.mockImplementation(lookupFrom([row]) as never);
    scheduleFindOneById.mockRejectedValue(new Error("bad decrypt"));

    const status: Record<string, unknown> = json(await request(currentPath()));

    expect(status["exists"]).toBe(true);
    expect(status["needsRegeneration"]).toBe(true);
    expect(status["urls"]).toBeNull();
  });

  test("a schedule id that is not a UUID is a 400, not a Postgres error", async () => {
    const result: HttpResult = await request(
      `${API_PREFIX}/on-call-calendar/schedule-feed/not-a-uuid/current`,
    );

    expect(result.status).toBe(ExceptionCode.BadDataException);
    expect(scheduleFindOneBy).not.toHaveBeenCalled();
  });

  test("POST /publish (first time) is a NON-root create carrying only projectId and the schedule id, then a purge", async () => {
    const token: string = CalendarFeedToken.mint();
    let created: FeedRowFixture | null = null;

    scheduleCreate.mockImplementation(async () => {
      created = scheduleRow({
        projectId,
        onCallDutyPolicyScheduleId: scheduleId,
        tokenHash: CalendarFeedToken.hash(token),
      });

      return created;
    });

    scheduleFindOneBy.mockImplementation(
      async (args: CapturedFindOneBy): Promise<FeedRowFixture | null> => {
        return created ? lookupFrom([created])(args) : null;
      },
    );
    scheduleFindOneById.mockImplementation(async () => {
      return created
        ? { id: created.id, token, tokenHash: created.tokenHash }
        : null;
    });

    const result: HttpResult = await postJson(publishPath());

    expect(result.status).toBe(200);
    expect(scheduleCreate).toHaveBeenCalledTimes(1);

    const create: CapturedCreate = callsOf<CapturedCreate>(
      scheduleCreate,
    )[0] as CapturedCreate;

    expect(String(create.data["projectId"])).toBe(projectId.toString());
    expect(String(create.data["onCallDutyPolicyScheduleId"])).toBe(
      scheduleId.toString(),
    );
    expect(create.data["token"]).toBeUndefined();
    expect(create.data["tokenHash"]).toBeUndefined();
    expect(create.props?.isRoot).toBeUndefined();
    expect(create.props).toBe(await propsSpy.mock.results[0]?.value);

    expect(scheduleUpdateOneBy).not.toHaveBeenCalled();
    expect(purgeForSchedule).toHaveBeenCalledWith(scheduleId.toString());

    const status: Record<string, unknown> = json(result);

    expect(status["exists"]).toBe(true);
    expect((status["urls"] as Record<string, string>)["https"]).toContain(
      `/api/on-call-calendar/schedule/${token}/schedule.ics`,
    );
  });

  test("POST /publish on an existing feed re-enables it through a NON-root update and keeps the link", async () => {
    const token: string = CalendarFeedToken.mint();
    const row: FeedRowFixture = scheduleRow({
      projectId,
      onCallDutyPolicyScheduleId: scheduleId,
      tokenHash: CalendarFeedToken.hash(token),
      isEnabled: false,
    });

    scheduleFindOneBy.mockImplementation(lookupFrom([row]) as never);
    scheduleFindOneById.mockResolvedValue({
      id: row.id,
      token,
      tokenHash: row.tokenHash,
    } as never);
    scheduleUpdateOneBy.mockImplementation(async (args: CapturedUpdate) => {
      row.isEnabled = args.data["isEnabled"] as boolean;
      return 1;
    });

    const result: HttpResult = await postJson(publishPath());

    expect(result.status).toBe(200);
    expect(scheduleCreate).not.toHaveBeenCalled();
    expect(scheduleRotate).not.toHaveBeenCalled();

    const update: CapturedUpdate = callsOf<CapturedUpdate>(
      scheduleUpdateOneBy,
    )[0] as CapturedUpdate;

    expect(String(update.query?.["_id"])).toBe(row.id.toString());
    expect(String(update.query?.["projectId"])).toBe(projectId.toString());
    expect(update.data).toEqual({ isEnabled: true });
    expect(update.props?.isRoot).toBeUndefined();

    const status: Record<string, unknown> = json(result);

    expect(status["isEnabled"]).toBe(true);
    expect((status["urls"] as Record<string, string>)["https"]).toContain(
      token,
    );
  });

  /*
   * Regression: publish relied on the CREATE for its permission gate, and
   * @CanAccessIfCanReadOn -- the label scoping that decides WHICH schedules an
   * editor may touch -- is only applied to query operations. A label-
   * restricted editor who knew a schedule's id could therefore mint an
   * enabled feed row for a schedule outside their labels (they could not read
   * the link afterwards, but the row was there for the next editor to find
   * "already published"). The route now reads the schedule with the caller's
   * props first.
   */
  test("POST /publish reads the schedule with the CALLER's props before creating", async () => {
    scheduleFindOneBy.mockResolvedValue(null as never);

    await postJson(publishPath());

    expect(scheduleModelFindOneBy).toHaveBeenCalledTimes(1);

    const read: CapturedFindOneBy = scheduleModelFindOneBy.mock
      .calls[0]?.[0] as CapturedFindOneBy;

    expect(String(read.query["_id"])).toBe(scheduleId.toString());
    expect(String(read.query["projectId"])).toBe(projectId.toString());
    expect(read.props?.isRoot).toBeUndefined();
    expect(read.props).toBe(await propsSpy.mock.results[0]?.value);

    /* The schedule read happens BEFORE the feed is created. */
    expect(scheduleModelFindOneBy.mock.invocationCallOrder[0]).toBeLessThan(
      scheduleCreate.mock.invocationCallOrder[0] as number,
    );
  });

  test("POST /publish for a schedule the caller cannot read is 404 and creates nothing", async () => {
    scheduleFindOneBy.mockResolvedValue(null as never);
    scheduleModelFindOneBy.mockResolvedValue(null as never);

    const result: HttpResult = await postJson(publishPath());

    expect(result.status).toBe(404);
    expect(scheduleCreate).not.toHaveBeenCalled();
    expect(purgeForSchedule).not.toHaveBeenCalled();
    expect(json(result)).toEqual({ message: "On-call schedule not found." });
  });

  test("POST /publish on an EXISTING feed needs no second schedule read (the feed read is already scoped)", async () => {
    const token: string = CalendarFeedToken.mint();
    const row: FeedRowFixture = scheduleRow({
      projectId,
      onCallDutyPolicyScheduleId: scheduleId,
      tokenHash: CalendarFeedToken.hash(token),
    });

    scheduleFindOneBy.mockImplementation(lookupFrom([row]) as never);
    scheduleFindOneById.mockResolvedValue({
      id: row.id,
      token,
      tokenHash: row.tokenHash,
    } as never);

    const result: HttpResult = await postJson(publishPath());

    expect(result.status).toBe(200);
    expect(scheduleModelFindOneBy).not.toHaveBeenCalled();
  });

  test("POST /publish by a caller without Edit permission is refused by the service, nothing is purged", async () => {
    scheduleCreate.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to create OnCallDutyPolicyScheduleCalendarFeed.",
      ),
    );

    const result: HttpResult = await postJson(publishPath());

    expect(result.status).toBe(ExceptionCode.NotAuthorizedException);
    expect(purgeForSchedule).not.toHaveBeenCalled();
    expect(scheduleRotate).not.toHaveBeenCalled();
  });

  test("POST /publish with the wrong content type is 415", async () => {
    const result: HttpResult = await request(publishPath(), {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
    });

    expect(result.status).toBe(415);
    expect(scheduleCreate).not.toHaveBeenCalled();
  });

  test("POST /rotate: a NON-root permission probe on an updatable column, THEN the root mint, THEN the purge", async () => {
    const oldToken: string = CalendarFeedToken.mint();
    const newToken: string = CalendarFeedToken.mint();
    const row: FeedRowFixture = scheduleRow({
      projectId,
      onCallDutyPolicyScheduleId: scheduleId,
      tokenHash: CalendarFeedToken.hash(oldToken),
    });

    const order: Array<string> = [];

    scheduleFindOneBy.mockImplementation(lookupFrom([row]) as never);
    scheduleUpdateOneBy.mockImplementation(async () => {
      order.push("probe");
      return 1;
    });
    scheduleRotate.mockImplementation(
      async (data: { id: ObjectID }): Promise<CalendarFeedRotation> => {
        order.push("mint");
        expect(data.id.toString()).toBe(row.id.toString());

        row.tokenHash = CalendarFeedToken.hash(newToken);
        row.tokenHint = newToken.slice(-4);
        row.rotatedAt = NOW;

        return {
          token: newToken,
          tokenHash: row.tokenHash,
          tokenHint: row.tokenHint,
          rotatedAt: NOW,
          previousTokenHash: CalendarFeedToken.hash(oldToken),
          previousTokenExpiresAt: at("2026-10-01T12:00:00Z"),
        };
      },
    );
    purgeForSchedule.mockImplementation(async () => {
      order.push("purge");
    });

    const result: HttpResult = await postJson(rotatePath());

    expect(result.status).toBe(200);
    expect(order).toEqual(["probe", "mint", "purge"]);

    const probe: CapturedUpdate = callsOf<CapturedUpdate>(
      scheduleUpdateOneBy,
    )[0] as CapturedUpdate;

    expect(probe.data).toEqual({ isEnabled: true });
    expect(probe.props?.isRoot).toBeUndefined();
    expect(probe.data["rotatedAt"]).toBeUndefined();
    expect(probe.data["token"]).toBeUndefined();

    expect(purgeForSchedule).toHaveBeenCalledWith(scheduleId.toString());

    const status: Record<string, unknown> = json(result);

    expect((status["urls"] as Record<string, string>)["https"]).toContain(
      newToken,
    );
    expect(result.body).not.toContain(oldToken);
    expect(scheduleFindOneById).not.toHaveBeenCalled();
  });

  test("POST /rotate keeps a disabled feed disabled (the probe writes the current value back)", async () => {
    const row: FeedRowFixture = scheduleRow({
      projectId,
      onCallDutyPolicyScheduleId: scheduleId,
      isEnabled: false,
    });

    scheduleFindOneBy.mockImplementation(lookupFrom([row]) as never);
    scheduleRotate.mockResolvedValue({
      token: CalendarFeedToken.mint(),
      tokenHash: row.tokenHash,
      tokenHint: "abcd",
      rotatedAt: NOW,
      previousTokenHash: null,
      previousTokenExpiresAt: null,
    });

    await postJson(rotatePath());

    const probe: CapturedUpdate = callsOf<CapturedUpdate>(
      scheduleUpdateOneBy,
    )[0] as CapturedUpdate;

    expect(probe.data).toEqual({ isEnabled: false });
  });

  test("POST /rotate by a caller without Edit permission never reaches the mint", async () => {
    const row: FeedRowFixture = scheduleRow({
      projectId,
      onCallDutyPolicyScheduleId: scheduleId,
    });

    scheduleFindOneBy.mockImplementation(lookupFrom([row]) as never);
    scheduleUpdateOneBy.mockRejectedValue(
      new NotAuthorizedException("You do not have permission to edit this."),
    );

    const result: HttpResult = await postJson(rotatePath());

    expect(result.status).toBe(ExceptionCode.NotAuthorizedException);
    expect(scheduleRotate).not.toHaveBeenCalled();
    expect(purgeForSchedule).not.toHaveBeenCalled();
  });

  test("POST /rotate on an unpublished feed is 404 with a message that says to publish first", async () => {
    const result: HttpResult = await postJson(rotatePath());

    expect(result.status).toBe(404);
    expect(json(result)["message"]).toContain("Publish");
    expect(scheduleRotate).not.toHaveBeenCalled();
  });

  test("a feed in ANOTHER project is invisible: the caller-scoped lookup carries the caller's project", async () => {
    const row: FeedRowFixture = scheduleRow({
      projectId: ObjectID.generate(),
      onCallDutyPolicyScheduleId: scheduleId,
    });

    scheduleFindOneBy.mockImplementation(lookupFrom([row]) as never);

    const result: HttpResult = await request(currentPath());

    expect(json(result)["exists"]).toBe(false);
  });
});

// -- Session routes: the project feed ------------------------------------------

describe("project-feed session routes", () => {
  test("GET /current reads the project's row with the caller's props", async () => {
    const result: HttpResult = await request(
      `${API_PREFIX}${PROJECT_FEED_CURRENT_ROUTE}`,
    );

    expect(result.status).toBe(200);
    expect(json(result)["exists"]).toBe(false);

    const lookup: CapturedFindOneBy = callsOf<CapturedFindOneBy>(
      projectFindOneBy,
    )[0] as CapturedFindOneBy;

    expect(lookup.query).toEqual({ projectId });
    expect(lookup.props?.isRoot).toBeUndefined();
    expect(lookup.select?.["token"]).toBeUndefined();
  });

  test("GET /current with a published feed returns the project URL and the shared settings", async () => {
    const token: string = CalendarFeedToken.mint();
    const row: FeedRowFixture = projectRow({
      projectId,
      tokenHash: CalendarFeedToken.hash(token),
    });

    projectFindOneBy.mockImplementation(lookupFrom([row]) as never);
    projectFindOneById.mockResolvedValue({
      id: row.id,
      token,
      tokenHash: row.tokenHash,
    } as never);

    const status: Record<string, unknown> = json(
      await request(`${API_PREFIX}${PROJECT_FEED_CURRENT_ROUTE}`),
    );

    expect(status["exists"]).toBe(true);
    expect((status["urls"] as Record<string, string>)["https"]).toBe(
      `https://oneuptime.example.com/api/on-call-calendar/project/${token}/project.ics`,
    );
    expect(status["settings"]).toEqual({
      includeCoverageGaps: true,
      minimumGapMinutes: 30,
      pastDays: DEFAULT_PAST_DAYS,
      futureDays: DEFAULT_FUTURE_DAYS,
      rotateWhenMemberLeaves: true,
    });
  });

  test("POST /publish creates a row carrying only projectId, non-root, then purges the project", async () => {
    const token: string = CalendarFeedToken.mint();
    let created: FeedRowFixture | null = null;

    projectCreate.mockImplementation(async () => {
      created = projectRow({
        projectId,
        tokenHash: CalendarFeedToken.hash(token),
      });

      return created;
    });
    projectFindOneBy.mockImplementation(
      async (args: CapturedFindOneBy): Promise<FeedRowFixture | null> => {
        return created ? lookupFrom([created])(args) : null;
      },
    );
    projectFindOneById.mockImplementation(async () => {
      return created
        ? { id: created.id, token, tokenHash: created.tokenHash }
        : null;
    });

    const result: HttpResult = await postJson(
      `${API_PREFIX}${PROJECT_FEED_PUBLISH_ROUTE}`,
    );

    expect(result.status).toBe(200);

    const create: CapturedCreate = callsOf<CapturedCreate>(
      projectCreate,
    )[0] as CapturedCreate;

    expect(String(create.data["projectId"])).toBe(projectId.toString());
    expect(create.data["onCallDutyPolicyScheduleId"]).toBeUndefined();
    expect(create.data["token"]).toBeUndefined();
    expect(create.props?.isRoot).toBeUndefined();

    expect(purgeForProject).toHaveBeenCalledWith(projectId.toString());
    expect(purgeForSchedule).not.toHaveBeenCalled();

    expect((json(result)["urls"] as Record<string, string>)["https"]).toContain(
      `/api/on-call-calendar/project/${token}/project.ics`,
    );
  });

  test("POST /publish without permission is refused and purges nothing", async () => {
    projectCreate.mockRejectedValue(new NotAuthorizedException("no"));

    const result: HttpResult = await postJson(
      `${API_PREFIX}${PROJECT_FEED_PUBLISH_ROUTE}`,
    );

    expect(result.status).toBe(ExceptionCode.NotAuthorizedException);
    expect(purgeForProject).not.toHaveBeenCalled();
  });

  test("POST /rotate probes non-root, mints root, purges the project, returns the plaintext once", async () => {
    const newToken: string = CalendarFeedToken.mint();
    const row: FeedRowFixture = projectRow({ projectId });

    projectFindOneBy.mockImplementation(lookupFrom([row]) as never);
    projectRotate.mockImplementation(
      async (data: { id: ObjectID }): Promise<CalendarFeedRotation> => {
        expect(data.id.toString()).toBe(row.id.toString());

        row.tokenHash = CalendarFeedToken.hash(newToken);
        row.tokenHint = newToken.slice(-4);

        return {
          token: newToken,
          tokenHash: row.tokenHash,
          tokenHint: row.tokenHint,
          rotatedAt: NOW,
          previousTokenHash: "old",
          previousTokenExpiresAt: at("2026-10-01T12:00:00Z"),
        };
      },
    );

    const result: HttpResult = await postJson(
      `${API_PREFIX}${PROJECT_FEED_ROTATE_ROUTE}`,
    );

    expect(result.status).toBe(200);

    const probe: CapturedUpdate = callsOf<CapturedUpdate>(
      projectUpdateOneBy,
    )[0] as CapturedUpdate;

    expect(probe.data).toEqual({ isEnabled: true });
    expect(probe.props?.isRoot).toBeUndefined();
    expect(String(probe.query?.["_id"])).toBe(row.id.toString());

    expect(projectRotate).toHaveBeenCalledTimes(1);
    expect(purgeForProject).toHaveBeenCalledWith(projectId.toString());
    expect((json(result)["urls"] as Record<string, string>)["https"]).toContain(
      newToken,
    );
    expect(projectFindOneById).not.toHaveBeenCalled();
  });

  test("POST /rotate without permission never mints", async () => {
    const row: FeedRowFixture = projectRow({ projectId });

    projectFindOneBy.mockImplementation(lookupFrom([row]) as never);
    projectUpdateOneBy.mockRejectedValue(new NotAuthorizedException("no"));

    const result: HttpResult = await postJson(
      `${API_PREFIX}${PROJECT_FEED_ROTATE_ROUTE}`,
    );

    expect(result.status).toBe(ExceptionCode.NotAuthorizedException);
    expect(projectRotate).not.toHaveBeenCalled();
    expect(purgeForProject).not.toHaveBeenCalled();
  });

  test("POST /rotate on an unpublished project feed is 404", async () => {
    const result: HttpResult = await postJson(
      `${API_PREFIX}${PROJECT_FEED_ROTATE_ROUTE}`,
    );

    expect(result.status).toBe(404);
    expect(projectRotate).not.toHaveBeenCalled();
  });

  test("the three POST routes are 415 without JSON", async () => {
    for (const uri of [
      PROJECT_FEED_PUBLISH_ROUTE,
      PROJECT_FEED_ROTATE_ROUTE,
      FEED_ROTATE_ROUTE,
    ]) {
      const result: HttpResult = await request(`${API_PREFIX}${uri}`, {
        method: "POST",
        headers: { "Content-Type": "text/html" },
      });

      expect(result.status).toBe(415);
    }
  });
});

// -- Session route: /my-shifts --------------------------------------------------

describe("GET /on-call-calendar/my-shifts", () => {
  const sample: MaterializedShift = shift({
    start: at("2026-09-02T07:00:00Z"),
    end: at("2026-09-02T15:00:00Z"),
    projectName: "Acme",
  });

  beforeEach(() => {
    materializeSpy.mockResolvedValue({
      shifts: [sample],
      truncated: false,
      generatedAt: NOW,
    });
  });

  test("with a tenant header the scope is that project, and the window defaults to now -> +30 d", async () => {
    const result: HttpResult = await request(`${API_PREFIX}${MY_SHIFTS_ROUTE}`);

    expect(result.status).toBe(200);

    const args: {
      userId: ObjectID;
      projectIds?: Array<ObjectID>;
      from: Date;
      to: Date;
      now: Date;
    } = materializeSpy.mock.calls[0]?.[0] as {
      userId: ObjectID;
      projectIds?: Array<ObjectID>;
      from: Date;
      to: Date;
      now: Date;
    };

    expect(args.userId.toString()).toBe(userId.toString());
    expect(args.projectIds?.map(String)).toEqual([projectId.toString()]);
    expect(args.from.toISOString()).toBe(NOW.toISOString());
    expect(args.to.toISOString()).toBe(
      OneUptimeDate.addRemoveDays(NOW, 30).toISOString(),
    );
    expect(args.now.toISOString()).toBe(NOW.toISOString());
  });

  test("without a tenant header the scope is every project the caller is rostered in (mobile)", async () => {
    propsSpy.mockResolvedValue({ tenantId: undefined, userId });

    const result: HttpResult = await request(`${API_PREFIX}${MY_SHIFTS_ROUTE}`);

    expect(result.status).toBe(200);

    const args: { projectIds?: Array<ObjectID> } = materializeSpy.mock
      .calls[0]?.[0] as { projectIds?: Array<ObjectID> };

    expect(args.projectIds).toBeUndefined();
  });

  test("with a tenant header the caller must be a member of that project", async () => {
    propsSpy.mockResolvedValue({
      tenantId: projectId,
      userId,
      userTenantAccessPermission: {},
    });

    const result: HttpResult = await request(`${API_PREFIX}${MY_SHIFTS_ROUTE}`);

    expect(result.status).toBe(ExceptionCode.NotAuthorizedException);
    expect(materializeSpy).not.toHaveBeenCalled();
  });

  test("an anonymous caller is refused", async () => {
    propsSpy.mockResolvedValue({ tenantId: undefined, userId: undefined });

    const result: HttpResult = await request(`${API_PREFIX}${MY_SHIFTS_ROUTE}`);

    expect(result.status).toBe(ExceptionCode.BadDataException);
    expect(materializeSpy).not.toHaveBeenCalled();
  });

  test("the payload is { shifts: MaterializedShiftJson[], truncated, generatedAt }", async () => {
    const result: HttpResult = await request(`${API_PREFIX}${MY_SHIFTS_ROUTE}`);

    const payload: Record<string, unknown> = json(result);

    expect(payload["truncated"]).toBe(false);
    expect(payload["generatedAt"]).toBe(NOW.toISOString());

    const shifts: Array<Record<string, unknown>> = payload["shifts"] as Array<
      Record<string, unknown>
    >;

    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({
      shiftKey: sample.shiftKey,
      projectId: sample.projectId,
      projectName: "Acme",
      scheduleId: sample.scheduleId,
      scheduleName: sample.scheduleName,
      scheduleTimezone: "Europe/Stockholm",
      userId: sample.userId,
      userName: sample.userName,
      start: "2026-09-02T07:00:00.000Z",
      end: "2026-09-02T15:00:00.000Z",
      coverageSeconds: 8 * 3600,
      isPast: false,
      shiftConfigVersion: sample.shiftConfigVersion,
    });
    expect(typeof shifts[0]?.["lastModifiedAt"]).toBe("string");
    expect(Array.isArray(shifts[0]?.["policies"])).toBe(true);
    expect("override" in (shifts[0] || {})).toBe(false);
  });

  test("?from and ?to are parsed and the span capped at 120 days", async () => {
    await request(
      `${API_PREFIX}${MY_SHIFTS_ROUTE}?from=2026-09-05T00:00:00.000Z&to=2027-06-01T00:00:00.000Z`,
    );

    const args: { from: Date; to: Date } = materializeSpy.mock
      .calls[0]?.[0] as { from: Date; to: Date };

    expect(args.from.toISOString()).toBe("2026-09-05T00:00:00.000Z");
    expect(args.to.toISOString()).toBe(
      OneUptimeDate.addRemoveDays(
        at("2026-09-05T00:00:00.000Z"),
        MY_SHIFTS_MAX_DAYS,
      ).toISOString(),
    );
  });

  test("a garbage ?from is 400", async () => {
    const result: HttpResult = await request(
      `${API_PREFIX}${MY_SHIFTS_ROUTE}?from=yesterday`,
    );

    expect(result.status).toBe(ExceptionCode.BadDataException);
    expect(materializeSpy).not.toHaveBeenCalled();
  });

  test("render cap reached: 503 + Retry-After 60, nothing materialized, no slot released", async () => {
    tryAcquireRenderSlot.mockReturnValue(false);

    const result: HttpResult = await request(`${API_PREFIX}${MY_SHIFTS_ROUTE}`);

    expect(result.status).toBe(503);
    expect(header(result, "retry-after")).toBe("60");
    expect(materializeSpy).not.toHaveBeenCalled();
    expect(releaseRenderSlot).not.toHaveBeenCalled();
  });

  test("the render slot is released after a successful materialization", async () => {
    await request(`${API_PREFIX}${MY_SHIFTS_ROUTE}`);

    expect(tryAcquireRenderSlot).toHaveBeenCalledTimes(1);
    expect(releaseRenderSlot).toHaveBeenCalledTimes(1);
  });

  /*
   * Regression: this route shared the per-process render slots with the three
   * public feed routes and could take every one of them. Its caller is a
   * logged-in client that can retry (and, on mobile, falls back to its roster
   * list); a calendar client that gets a 503 shows a stale or empty calendar
   * to somebody who may be on call. Half the slots are kept for the feeds.
   */
  test("it leaves half the render slots for the public feeds", async () => {
    await request(`${API_PREFIX}${MY_SHIFTS_ROUTE}`);

    const options: { leaveFreeSlots?: number } = tryAcquireRenderSlot.mock
      .calls[0]?.[0] as { leaveFreeSlots?: number };

    expect(options.leaveFreeSlots).toBe(
      Math.floor(OnCallCalendarFeedCache.getRenderConcurrency() / 2),
    );
    expect(options.leaveFreeSlots).toBeGreaterThan(0);
  });

  test("the render slot is released when the materialization throws", async () => {
    materializeSpy.mockRejectedValue(new Error("layer exploded"));

    const result: HttpResult = await request(`${API_PREFIX}${MY_SHIFTS_ROUTE}`);

    expect(result.status).toBe(500);
    expect(releaseRenderSlot).toHaveBeenCalledTimes(1);
  });

  test("truncated propagates", async () => {
    materializeSpy.mockResolvedValue({
      shifts: [],
      truncated: true,
      generatedAt: NOW,
    });

    const payload: Record<string, unknown> = json(
      await request(`${API_PREFIX}${MY_SHIFTS_ROUTE}`),
    );

    expect(payload["truncated"]).toBe(true);
    expect(payload["shifts"]).toEqual([]);
  });
});

// -- Time --------------------------------------------------------------------

describe("clock", () => {
  test("every public fetch reads the clock once through OneUptimeDate (so grace and bookkeeping share one `now`)", async () => {
    const token: string = CalendarFeedToken.mint();
    const row: FeedRowFixture = personalRow({
      projectId,
      userId,
      tokenHash: CalendarFeedToken.hash(token),
    });

    personalFindOneBy.mockImplementation(lookupFrom([row]) as never);
    renderSpy.mockResolvedValue(
      renderedOutcome(OnCallCalendarFeedKind.Personal),
    );

    await request(feedPath(OnCallCalendarFeedKind.Personal, token));

    expect(nowSpy).toHaveBeenCalled();

    const renderRequest: Record<string, unknown> = renderSpy.mock
      .calls[0]?.[0] as Record<string, unknown>;

    expect((renderRequest["now"] as Date).getTime()).toBe(NOW.getTime());
  });
});
