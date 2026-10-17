import { mockRouter } from "./Helpers";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The team's calendar link for scheduled maintenance, over HTTP.
 *
 * The routes the module registered are replayed onto a REAL Express
 * application on an ephemeral port, so the answers are Express's own: the
 * 404 that says nothing, the empty calendar for a link turned off or
 * replaced, the header set, 304 through req.fresh, HEAD served without being
 * counted. The services, the rate limit counter and Redis are stubbed at
 * their public seams; the renderer and the cache are real, over an in-memory
 * GlobalCache, so what is checked is what a calendar app would read.
 *
 * And who may hold the link: every session route asks that the caller reads
 * every event of the project, and answers a reader held to some events with
 * a reason - 200 from /current (a 403 sends the Dashboard to its Forbidden
 * page), 400 from /publish and /rotate - never with the link.
 */

type EnvMockGlobal = typeof globalThis & {
  __maintenanceCalendarApiEnv: { host: string; httpProtocol: string };
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

  mockGlobal.__maintenanceCalendarApiEnv = {
    host: "oneuptime.example.com",
    httpProtocol: "https://",
  };

  Object.defineProperty(mocked, "Host", {
    configurable: true,
    enumerable: true,
    get: (): string => {
      return mockGlobal.__maintenanceCalendarApiEnv.host;
    },
  });

  Object.defineProperty(mocked, "HttpProtocol", {
    configurable: true,
    enumerable: true,
    get: (): string => {
      return mockGlobal.__maintenanceCalendarApiEnv.httpProtocol;
    },
  });

  return mocked;
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: (): Record<string, string> => {
      return {};
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

jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  const pass: (
    _req: unknown,
    _res: unknown,
    next: () => void,
  ) => Promise<void> = async (
    _req: unknown,
    _res: unknown,
    next: () => void,
  ): Promise<void> => {
    next();
  };

  return {
    __esModule: true,
    default: {
      getUserMiddleware: pass,
      requireUserAuthentication: pass,
    },
  };
});

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
  PUBLISH_LOCK_NAMESPACE,
  READ_EVERY_EVENT_MESSAGE,
  TEAM_FEED_CURRENT_ROUTE,
  TEAM_FEED_FALLBACK_ROUTE,
  TEAM_FEED_PUBLISH_ROUTE,
  TEAM_FEED_ROTATE_ROUTE,
  TEAM_FEED_ROUTE,
  getTeamCalendarCacheKey,
} from "../../../Server/API/ScheduledMaintenanceCalendarAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import OnCallCalendarFeedRateLimit, {
  OnCallCalendarFeedRateLimitOutcome,
  OnCallCalendarFeedRateLimitScope,
} from "../../../Server/Middleware/OnCallCalendarFeedRateLimit";
import ScheduledMaintenanceCalendarFeedService from "../../../Server/Services/ScheduledMaintenanceCalendarFeedService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import CalendarFeedToken from "../../../Server/Utils/OnCall/CalendarFeedToken";
import MaintenanceCalendarFeedCache from "../../../Server/Utils/ScheduledMaintenance/MaintenanceCalendarFeedCache";
import MaintenanceCalendarFeedUrls from "../../../Server/Utils/ScheduledMaintenance/MaintenanceCalendarFeedUrls";
import TeamMaintenanceCalendar, {
  TEAM_CALENDAR_REPLACED_REASON,
  TEAM_CALENDAR_TURNED_OFF_REASON,
  TeamCalendarEvents,
} from "../../../Server/Utils/ScheduledMaintenance/TeamMaintenanceCalendar";
import ScheduledMaintenanceCalendarFeed from "../../../Models/DatabaseModels/ScheduledMaintenanceCalendarFeed";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import Exception from "../../../Types/Exception/Exception";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { MaintenanceCalendarEventInput } from "../../../Types/ScheduledMaintenance/MaintenanceCalendar";
import {
  ParsedEvent,
  checkICalendarConformance,
  readCalendarText,
  readEvents,
} from "../../Types/Calendar/ICalendarConformance";
import express from "express";
import http from "http";
import { AddressInfo } from "net";

// -- Harness ----------------------------------------------------------------

type RouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

interface RegisteredRoute {
  method: string;
  uri: string;
  middlewares: Array<RouteHandler>;
  handlerFunction: RouteHandler;
}

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const API_PREFIX: string = "/api";

const NOW: Date = new Date("2026-10-15T10:20:00.000Z");

// Fixed tokens in the shape the routes accept: 43 base64url characters.
const TOKEN: string = `maintenance${"A".repeat(32)}`;
const PREVIOUS_TOKEN: string = `maintenance${"B".repeat(32)}`;
const UNKNOWN_TOKEN: string = `maintenance${"C".repeat(32)}`;
const ROTATED_TOKEN: string = `maintenance${"D".repeat(32)}`;

const EVENT_ID: string = "75000000-0000-4000-8000-000000000001";

interface FeedRow {
  id: ObjectID;
  projectId: ObjectID;
  token: string;
  tokenHash: string;
  previousTokenHash?: string | undefined;
  previousTokenExpiresAt?: Date | undefined;
  tokenHint: string;
  isEnabled: boolean;
  rotatedAt: Date;
  lastFetchedAt?: Date | undefined;
  lastFetchedClient?: string | undefined;
  fetchCount: number;
}

let rows: Array<FeedRow>;
let projectId: ObjectID;
let userId: ObjectID;
let cache: Map<string, string>;

let readsEverySpy: jest.SpiedFunction<
  typeof ScheduledMaintenanceService.readsEveryRecordInProject
>;
let findOneBySpy: jest.SpiedFunction<
  typeof ScheduledMaintenanceCalendarFeedService.findOneBy
>;
let findOneByIdSpy: jest.SpiedFunction<
  typeof ScheduledMaintenanceCalendarFeedService.findOneById
>;
let updateOneByIdSpy: jest.SpiedFunction<
  typeof ScheduledMaintenanceCalendarFeedService.updateOneById
>;
let updateOneBySpy: jest.SpiedFunction<
  typeof ScheduledMaintenanceCalendarFeedService.updateOneBy
>;
let createSpy: jest.SpiedFunction<
  typeof ScheduledMaintenanceCalendarFeedService.create
>;
let rotateSpy: jest.SpiedFunction<
  typeof ScheduledMaintenanceCalendarFeedService.rotateTokenById
>;
let readEventsSpy: jest.SpiedFunction<
  typeof TeamMaintenanceCalendar.readEvents
>;
let consumeSpy: jest.SpiedFunction<typeof OnCallCalendarFeedRateLimit.consume>;
let lockSpy: jest.SpiedFunction<typeof Semaphore.lock>;
let releaseSpy: jest.SpiedFunction<typeof Semaphore.release>;

function registeredRoutes(): Array<RegisteredRoute> {
  return (mockRouter.routes as unknown as Array<RegisteredRoute>).filter(
    (route: RegisteredRoute) => {
      return route.uri.startsWith("/scheduled-maintenance-calendar/");
    },
  );
}

function routeFor(method: string, uri: string): RegisteredRoute {
  const route: RegisteredRoute | undefined = registeredRoutes().find(
    (candidate: RegisteredRoute) => {
      return candidate.method === method && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`No ${method} route registered for ${uri}`);
  }

  return route;
}

function memberProps(): DatabaseCommonInteractionProps {
  const permission: UserPermission = {
    _type: "UserPermission",
    permission: Permission.ProjectMember,
    labelIds: [],
    isBlockPermission: false,
  };

  const tenant: Dictionary<UserTenantAccessPermission> = {};

  tenant[projectId.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: [permission],
  };

  return {
    tenantId: projectId,
    userId: userId,
    userTenantAccessPermission: tenant,
  };
}

function feedRow(overrides?: Partial<FeedRow>): FeedRow {
  return {
    id: new ObjectID("75100000-0000-4000-8000-000000000001"),
    projectId: projectId,
    token: TOKEN,
    tokenHash: CalendarFeedToken.hash(TOKEN),
    tokenHint: TOKEN.slice(-4),
    isEnabled: true,
    rotatedAt: new Date("2026-10-01T09:00:00.000Z"),
    fetchCount: 3,
    ...overrides,
  };
}

/*
 * TypeORM hands back ONLY the selected columns, with `_id` read as `id`; the
 * fake does the same, so a route that reads a column it never selected
 * fails here as it would in production.
 */
function projectRow(
  row: FeedRow,
  select: Record<string, unknown> | undefined,
): ScheduledMaintenanceCalendarFeed {
  const projected: Record<string, unknown> = {};

  for (const [column, wanted] of Object.entries(select || {})) {
    if (wanted) {
      const key: string = column === "_id" ? "id" : column;
      projected[key] = (row as unknown as Record<string, unknown>)[key];
    }
  }

  return projected as unknown as ScheduledMaintenanceCalendarFeed;
}

function matchRow(query: Record<string, unknown>): FeedRow | null {
  for (const row of rows) {
    if (typeof query["tokenHash"] === "string") {
      if (row.tokenHash === query["tokenHash"]) {
        return row;
      }
      continue;
    }

    if (typeof query["previousTokenHash"] === "string") {
      if (row.previousTokenHash === query["previousTokenHash"]) {
        return row;
      }
      continue;
    }

    if (
      query["projectId"] &&
      String(query["projectId"]) === row.projectId.toString()
    ) {
      return row;
    }
  }

  return null;
}

function teamEvent(): MaintenanceCalendarEventInput {
  return {
    id: EVENT_ID,
    title: "Database upgrade",
    description: "We move the primary database to new hardware.",
    startsAt: new Date("2026-10-20T22:00:00.000Z"),
    endsAt: new Date("2026-10-21T01:00:00.000Z"),
    stateName: "Scheduled",
    createdAt: new Date("2026-10-10T09:00:00.000Z"),
    updatedAt: new Date("2026-10-12T09:30:00.000Z"),
    version: 2,
    affects: ["API"],
    statusPages: ["Public status"],
    labels: [],
    url: `https://oneuptime.example.com/dashboard/${EVENT_ID}`,
  };
}

function everyLogArgument(): string {
  const lines: Array<string> = [];

  for (const recorder of [
    logger.debug,
    logger.info,
    logger.warn,
    logger.error,
  ]) {
    for (const call of (recorder as unknown as jest.Mock).mock.calls) {
      for (const argument of call) {
        lines.push(String(argument));

        if (argument instanceof Error) {
          lines.push(argument.stack || "");
        }
      }
    }
  }

  return lines.join("\n");
}

function flush(): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

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

function feedPath(token: string): string {
  return MaintenanceCalendarFeedUrls.getFeedPath(token);
}

function postJson(requestPath: string): Promise<HttpResult> {
  return request(requestPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

function json(result: HttpResult): Record<string, any> {
  return JSON.parse(result.body) as Record<string, any>;
}

beforeAll(async () => {
  const app: express.Express = express();

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

  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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
  MaintenanceCalendarFeedCache.clearInFlight();

  projectId = new ObjectID("75200000-0000-4000-8000-000000000001");
  userId = new ObjectID("75300000-0000-4000-8000-000000000001");
  rows = [feedRow()];
  cache = new Map();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return memberProps();
    });

  readsEverySpy = jest
    .spyOn(ScheduledMaintenanceService, "readsEveryRecordInProject")
    .mockResolvedValue(true);

  consumeSpy = jest
    .spyOn(OnCallCalendarFeedRateLimit, "consume")
    .mockResolvedValue({
      outcome: OnCallCalendarFeedRateLimitOutcome.Allowed,
    });

  findOneBySpy = jest
    .spyOn(ScheduledMaintenanceCalendarFeedService, "findOneBy")
    .mockImplementation((async (args: {
      query: Record<string, unknown>;
      select?: Record<string, unknown>;
    }) => {
      const found: FeedRow | null = matchRow(args.query);
      return found ? projectRow(found, args.select) : null;
    }) as never);

  findOneByIdSpy = jest
    .spyOn(ScheduledMaintenanceCalendarFeedService, "findOneById")
    .mockImplementation((async (args: {
      id: ObjectID;
      select?: Record<string, unknown>;
    }) => {
      const found: FeedRow | undefined = rows.find((row: FeedRow) => {
        return row.id.toString() === args.id.toString();
      });
      return found ? projectRow(found, args.select) : null;
    }) as never);

  updateOneByIdSpy = jest
    .spyOn(ScheduledMaintenanceCalendarFeedService, "updateOneById")
    .mockResolvedValue(undefined as never);
  updateOneBySpy = jest
    .spyOn(ScheduledMaintenanceCalendarFeedService, "updateOneBy")
    .mockResolvedValue(undefined as never);
  createSpy = jest
    .spyOn(ScheduledMaintenanceCalendarFeedService, "create")
    .mockImplementation((async () => {
      rows.push(feedRow());
      return {} as never;
    }) as never);
  rotateSpy = jest
    .spyOn(ScheduledMaintenanceCalendarFeedService, "rotateTokenById")
    .mockImplementation((async () => {
      const previous: FeedRow = rows[0]!;
      rows[0] = feedRow({
        token: ROTATED_TOKEN,
        tokenHash: CalendarFeedToken.hash(ROTATED_TOKEN),
        tokenHint: ROTATED_TOKEN.slice(-4),
        previousTokenHash: previous.tokenHash,
        previousTokenExpiresAt: new Date("2026-11-14T10:20:00.000Z"),
        rotatedAt: NOW,
      });

      return {
        token: ROTATED_TOKEN,
        tokenHash: CalendarFeedToken.hash(ROTATED_TOKEN),
        tokenHint: ROTATED_TOKEN.slice(-4),
        rotatedAt: NOW,
        previousTokenHash: previous.tokenHash,
        previousTokenExpiresAt: new Date("2026-11-14T10:20:00.000Z"),
      };
    }) as never);

  jest
    .spyOn(TeamMaintenanceCalendar, "getProjectName")
    .mockResolvedValue("Acme Production");
  readEventsSpy = jest
    .spyOn(TeamMaintenanceCalendar, "readEvents")
    .mockImplementation(async (): Promise<TeamCalendarEvents> => {
      return { events: [teamEvent()], isTruncated: false };
    });

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return cache.get(`${namespace}|${key}`) || null;
    });
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        cache.set(`${namespace}|${key}`, value);
      },
    );

  lockSpy = jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({ release: jest.fn() } as never);
  releaseSpy = jest
    .spyOn(Semaphore, "release")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// -- Registration -----------------------------------------------------------

describe("ScheduledMaintenanceCalendarAPI: route registration", () => {
  test("the public route is rate limited and needs no session; the session routes need one", () => {
    const publicRoute: RegisteredRoute = routeFor("GET", TEAM_FEED_ROUTE);

    expect(publicRoute.middlewares).toHaveLength(1);
    expect(typeof publicRoute.middlewares[0]).toBe("function");

    for (const [method, uri] of [
      ["GET", TEAM_FEED_CURRENT_ROUTE],
      ["POST", TEAM_FEED_PUBLISH_ROUTE],
      ["POST", TEAM_FEED_ROTATE_ROUTE],
    ] as Array<[string, string]>) {
      expect(routeFor(method, uri).middlewares).toHaveLength(2);
    }

    expect(routeFor("ALL", TEAM_FEED_FALLBACK_ROUTE)).toBeDefined();
  });

  test("the public route lives under the prefix the Nginx log exemption matches, and the session routes do not", () => {
    const nginxLocation: RegExp =
      /^\/api\/(on-call-calendar\/(user|schedule|project)|scheduled-maintenance-calendar\/project)\//;

    expect(`${API_PREFIX}${TEAM_FEED_ROUTE}`).toMatch(nginxLocation);

    for (const uri of [
      TEAM_FEED_CURRENT_ROUTE,
      TEAM_FEED_PUBLISH_ROUTE,
      TEAM_FEED_ROTATE_ROUTE,
    ]) {
      expect(`${API_PREFIX}${uri}`).not.toMatch(nginxLocation);
    }
  });

  test("the public route is the URL builder's path with :token in place of the token", () => {
    // The builder percent-encodes the token, so the placeholder is decoded.
    expect(TEAM_FEED_ROUTE).toBe(
      decodeURIComponent(
        MaintenanceCalendarFeedUrls.getFeedRoutePath(":token"),
      ),
    );
  });
});

// -- Public route -----------------------------------------------------------

describe("GET the team's calendar link", () => {
  test("a link that works answers every event as a calendar app reads it", async () => {
    const result: HttpResult = await request(feedPath(TOKEN));

    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe("text/calendar; charset=utf-8");
    expect(result.headers["content-disposition"]).toBe(
      'inline; filename="maintenance.ics"',
    );
    expect(result.headers["cache-control"]).toBe("private, max-age=300");
    expect(result.headers["etag"]).toBeDefined();
    expect(checkICalendarConformance(result.body).problems).toEqual([]);

    const events: Array<ParsedEvent> = readEvents(result.body);

    expect(events).toHaveLength(1);
    expect(events[0]!.summary).toBe("Database upgrade");
    expect(readCalendarText(result.body, "X-WR-CALNAME")).toBe(
      "Acme Production · Maintenance",
    );
    expect(readEventsSpy).toHaveBeenCalledWith({
      projectId: projectId,
      now: NOW,
    });
  });

  test("looks the link up by the token's hash, as root, and never reads the encrypted token", async () => {
    await request(feedPath(TOKEN));

    const lookups: Array<Record<string, any>> = findOneBySpy.mock.calls.map(
      (call: Array<unknown>) => {
        return call[0] as Record<string, any>;
      },
    );

    expect(lookups[0]!["query"]).toEqual({
      tokenHash: CalendarFeedToken.hash(TOKEN),
    });
    expect(lookups[0]!["props"]).toEqual({ isRoot: true, ignoreHooks: true });

    for (const lookup of lookups) {
      expect(lookup["select"]["token"]).toBeUndefined();
      expect(lookup["select"]["tokenHash"]).toBeUndefined();
    }

    expect(findOneByIdSpy).not.toHaveBeenCalled();
  });

  test.each([
    ["a token of the wrong shape", "not-a-token"],
    ["a token nobody holds", UNKNOWN_TOKEN],
  ])("%s is a 404 that says nothing", async (_name: string, token: string) => {
    const result: HttpResult = await request(feedPath(token));

    expect(result.status).toBe(404);
    expect(result.body).not.toContain("BEGIN:VCALENDAR");
    expect(result.body).not.toContain(token);
    expect(readEventsSpy).not.toHaveBeenCalled();
  });

  test("a malformed token is refused before any lookup", async () => {
    await request(feedPath("short"));

    expect(findOneBySpy).not.toHaveBeenCalled();
  });

  test("a link turned off answers an empty calendar saying so, so the app clears its copy", async () => {
    rows = [feedRow({ isEnabled: false })];

    const result: HttpResult = await request(feedPath(TOKEN));

    expect(result.status).toBe(200);
    expect(result.body).not.toContain("BEGIN:VEVENT");
    expect(readCalendarText(result.body, "X-WR-CALDESC")).toContain(
      TEAM_CALENDAR_TURNED_OFF_REASON,
    );
    expect(readEventsSpy).not.toHaveBeenCalled();

    await flush();

    expect(updateOneByIdSpy).not.toHaveBeenCalled();
  });

  test("a link replaced by a new one answers an empty calendar for its 30 days, then 404", async () => {
    rows = [
      feedRow({
        token: ROTATED_TOKEN,
        tokenHash: CalendarFeedToken.hash(ROTATED_TOKEN),
        previousTokenHash: CalendarFeedToken.hash(PREVIOUS_TOKEN),
        previousTokenExpiresAt: new Date("2026-11-01T00:00:00.000Z"),
      }),
    ];

    const inGrace: HttpResult = await request(feedPath(PREVIOUS_TOKEN));

    expect(inGrace.status).toBe(200);
    expect(inGrace.body).not.toContain("BEGIN:VEVENT");
    expect(readCalendarText(inGrace.body, "X-WR-CALDESC")).toContain(
      TEAM_CALENDAR_REPLACED_REASON,
    );

    rows[0]!.previousTokenExpiresAt = new Date("2026-10-15T10:19:59.000Z");

    const expired: HttpResult = await request(feedPath(PREVIOUS_TOKEN));

    expect(expired.status).toBe(404);
    expect(readEventsSpy).not.toHaveBeenCalled();
  });

  test("a second fetch within five minutes is answered from the cache, under a key that holds no token", async () => {
    await request(feedPath(TOKEN));
    await flush();
    const second: HttpResult = await request(feedPath(TOKEN));

    expect(second.status).toBe(200);
    expect(readEventsSpy).toHaveBeenCalledTimes(1);

    const keys: string = Array.from(cache.keys()).join("\n");

    expect(keys).toContain(
      getTeamCalendarCacheKey({
        feed: projectRow(rows[0]!, { _id: true, rotatedAt: true }),
        now: NOW,
      }),
    );
    expect(keys).not.toContain(TOKEN);
    expect(keys).not.toContain(CalendarFeedToken.hash(TOKEN));
  });

  test("a regenerated link is a new cache key, and so is a new UTC day", () => {
    const feed: ScheduledMaintenanceCalendarFeed = projectRow(rows[0]!, {
      _id: true,
      rotatedAt: true,
    });
    const regenerated: ScheduledMaintenanceCalendarFeed = projectRow(
      feedRow({ rotatedAt: new Date("2026-10-15T09:00:00.000Z") }),
      { _id: true, rotatedAt: true },
    );

    const key: string = getTeamCalendarCacheKey({ feed, now: NOW });

    expect(getTeamCalendarCacheKey({ feed: regenerated, now: NOW })).not.toBe(
      key,
    );
    expect(
      getTeamCalendarCacheKey({
        feed,
        now: new Date("2026-10-16T00:00:01.000Z"),
      }),
    ).not.toBe(key);
    expect(
      getTeamCalendarCacheKey({
        feed,
        now: new Date("2026-10-15T23:59:59.000Z"),
      }),
    ).toBe(key);
  });

  test("an app that already holds this body is answered 304", async () => {
    const first: HttpResult = await request(feedPath(TOKEN));
    await flush();

    const again: HttpResult = await request(feedPath(TOKEN), {
      headers: { "If-None-Match": String(first.headers["etag"]) },
    });

    expect(again.status).toBe(304);
    expect(again.body).toBe("");
  });

  test("a fetch is written down: when, by which app, how often", async () => {
    await request(feedPath(TOKEN), {
      headers: { "User-Agent": "Google-Calendar-Importer" },
    });
    await flush();

    expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);

    const written: Record<string, any> = updateOneByIdSpy.mock
      .calls[0]![0] as Record<string, any>;

    expect(written["data"]).toEqual({
      lastFetchedAt: NOW,
      lastFetchedClient: "Google Calendar",
      fetchCount: 4,
    });
    expect(written["props"]).toEqual({ isRoot: true, ignoreHooks: true });
  });

  test("a HEAD, or a fetch within five minutes of the last one written down, is not", async () => {
    await request(feedPath(TOKEN), { method: "HEAD" });

    rows = [feedRow({ lastFetchedAt: new Date("2026-10-15T10:18:00.000Z") })];
    await request(feedPath(TOKEN));
    await flush();

    expect(updateOneByIdSpy).not.toHaveBeenCalled();
  });

  test("a link over its rate limit is refused with 429 before it is looked up", async () => {
    consumeSpy.mockResolvedValue({
      outcome: OnCallCalendarFeedRateLimitOutcome.RateLimited,
      scope: OnCallCalendarFeedRateLimitScope.Token,
      retryAfterSeconds: 30,
      isFirstRejectionInWindow: true,
    });

    const result: HttpResult = await request(feedPath(TOKEN));

    expect(result.status).toBe(429);
    expect(result.headers["retry-after"]).toBe("30");
    expect(findOneBySpy).not.toHaveBeenCalled();
  });

  test("a token pasted without its file name is a 404 that never writes the token down", async () => {
    const result: HttpResult = await request(
      `${API_PREFIX}/scheduled-maintenance-calendar/project/${TOKEN}`,
    );

    expect(result.status).toBe(404);
    expect(result.body).not.toContain(TOKEN);
    expect(everyLogArgument()).not.toContain(TOKEN);
  });

  test("the token never reaches a log line, even when the render fails", async () => {
    readEventsSpy.mockRejectedValue(new Error("database away"));

    const result: HttpResult = await request(feedPath(TOKEN));

    expect(result.status).toBe(500);
    expect(result.body).not.toContain(TOKEN);
    expect(everyLogArgument()).not.toContain(TOKEN);
  });
});

// -- Session routes ---------------------------------------------------------

describe("GET /current", () => {
  test("a reader of every event sees the link, read back from its encrypted column", async () => {
    const result: HttpResult = await request(
      `${API_PREFIX}${TEAM_FEED_CURRENT_ROUTE}`,
    );

    expect(result.status).toBe(200);

    const status: Record<string, any> = json(result);

    expect(status["exists"]).toBe(true);
    expect(status["refusedReason"]).toBeNull();
    expect(status["needsRegeneration"]).toBe(false);
    expect(status["isEnabled"]).toBe(true);
    expect(status["fetchCount"]).toBe(3);
    expect(status["settings"]).toEqual({ pastDays: 90, futureDays: 365 });
    expect(status["urls"]).toEqual(
      MaintenanceCalendarFeedUrls.buildFeedUrls({ token: TOKEN }),
    );
    expect(status["urls"]["https"]).toBe(
      `https://oneuptime.example.com/api/scheduled-maintenance-calendar/project/${TOKEN}/maintenance.ics`,
    );
  });

  test("the link is looked up with the caller's own props, so the model's access lists apply", async () => {
    await request(`${API_PREFIX}${TEAM_FEED_CURRENT_ROUTE}`);

    const lookup: Record<string, any> = findOneBySpy.mock
      .calls[0]![0] as Record<string, any>;

    expect(lookup["query"]).toEqual({ projectId: projectId });
    expect(lookup["props"]["isRoot"]).toBeUndefined();
    expect(lookup["props"]["userId"]).toEqual(userId);
    expect(lookup["select"]["token"]).toBeUndefined();
  });

  test("a project with no link yet says so, with nothing to copy", async () => {
    rows = [];

    const status: Record<string, any> = json(
      await request(`${API_PREFIX}${TEAM_FEED_CURRENT_ROUTE}`),
    );

    expect(status["exists"]).toBe(false);
    expect(status["urls"]).toBeNull();
    expect(status["refusedReason"]).toBeNull();
  });

  test("a reader held to some events is told why with a 200, and learns nothing of the link", async () => {
    readsEverySpy.mockResolvedValue(false);

    const result: HttpResult = await request(
      `${API_PREFIX}${TEAM_FEED_CURRENT_ROUTE}`,
    );

    expect(result.status).toBe(200);

    const status: Record<string, any> = json(result);

    expect(status["refusedReason"]).toBe(READ_EVERY_EVENT_MESSAGE);
    expect(status["exists"]).toBe(false);
    expect(status["urls"]).toBeNull();
    expect(status["tokenHint"]).toBeNull();
    expect(result.body).not.toContain(TOKEN);
    expect(findOneBySpy).not.toHaveBeenCalled();
  });

  test("a token that no longer decrypts to its hash asks for a new link instead of failing", async () => {
    rows = [feedRow({ token: UNKNOWN_TOKEN })];

    const status: Record<string, any> = json(
      await request(`${API_PREFIX}${TEAM_FEED_CURRENT_ROUTE}`),
    );

    expect(status["exists"]).toBe(true);
    expect(status["needsRegeneration"]).toBe(true);
    expect(status["urls"]).toBeNull();
  });

  test("a decrypt that throws is the same: a new link, never a 500", async () => {
    findOneByIdSpy.mockRejectedValue(new Error("bad decrypt"));

    const result: HttpResult = await request(
      `${API_PREFIX}${TEAM_FEED_CURRENT_ROUTE}`,
    );

    expect(result.status).toBe(200);
    expect(json(result)["needsRegeneration"]).toBe(true);
  });
});

describe("POST /publish", () => {
  test("publishes the project's link with the caller's props, under the project's lock", async () => {
    rows = [];

    const result: HttpResult = await postJson(
      `${API_PREFIX}${TEAM_FEED_PUBLISH_ROUTE}`,
    );

    expect(result.status).toBe(200);
    expect(createSpy).toHaveBeenCalledTimes(1);

    const created: Record<string, any> = createSpy.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(
      (created["data"] as ScheduledMaintenanceCalendarFeed).projectId,
    ).toEqual(projectId);
    expect(created["props"]["isRoot"]).toBeUndefined();
    expect(created["props"]["userId"]).toEqual(userId);

    expect(lockSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        key: projectId.toString(),
        namespace: PUBLISH_LOCK_NAMESPACE,
      }),
    );
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(json(result)["urls"]["https"]).toContain(TOKEN);
  });

  test("a link that exists is turned on again rather than made twice", async () => {
    rows = [feedRow({ isEnabled: false })];

    await postJson(`${API_PREFIX}${TEAM_FEED_PUBLISH_ROUTE}`);

    expect(createSpy).not.toHaveBeenCalled();
    expect(updateOneBySpy).toHaveBeenCalledTimes(1);

    const written: Record<string, any> = updateOneBySpy.mock
      .calls[0]![0] as Record<string, any>;

    expect(written["data"]).toEqual({ isEnabled: true });
    expect(written["query"]["projectId"]).toEqual(projectId);
    expect(written["props"]["isRoot"]).toBeUndefined();
  });

  test("without the lock (Redis away) it still publishes, relying on the unique index", async () => {
    rows = [];
    lockSpy.mockRejectedValue(new Error("redis away"));

    const result: HttpResult = await postJson(
      `${API_PREFIX}${TEAM_FEED_PUBLISH_ROUTE}`,
    );

    expect(result.status).toBe(200);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  test("a reader held to some events is refused with the reason", async () => {
    readsEverySpy.mockResolvedValue(false);
    rows = [];

    const result: HttpResult = await postJson(
      `${API_PREFIX}${TEAM_FEED_PUBLISH_ROUTE}`,
    );

    expect(result.status).toBe(400);
    expect(json(result)["message"]).toBe(READ_EVERY_EVENT_MESSAGE);
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("only a JSON request is taken", async () => {
    const result: HttpResult = await request(
      `${API_PREFIX}${TEAM_FEED_PUBLISH_ROUTE}`,
      { method: "POST", headers: { "Content-Type": "text/plain" } },
    );

    expect(result.status).toBe(415);
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe("POST /rotate", () => {
  test("proves the caller may edit the link, then mints a new token and answers the new address", async () => {
    const result: HttpResult = await postJson(
      `${API_PREFIX}${TEAM_FEED_ROTATE_ROUTE}`,
    );

    expect(result.status).toBe(200);
    expect(updateOneBySpy).toHaveBeenCalledTimes(1);

    const written: Record<string, any> = updateOneBySpy.mock
      .calls[0]![0] as Record<string, any>;

    expect(written["props"]["isRoot"]).toBeUndefined();
    expect(written["data"]).toEqual({ isEnabled: true });
    expect(updateOneBySpy.mock.invocationCallOrder[0]!).toBeLessThan(
      rotateSpy.mock.invocationCallOrder[0]!,
    );

    const status: Record<string, any> = json(result);

    expect(status["urls"]["https"]).toContain(ROTATED_TOKEN);
    expect(status["urls"]["https"]).not.toContain(TOKEN);
    expect(status["previousTokenExpiresAt"]).toBe("2026-11-14T10:20:00.000Z");
  });

  test("a project with no link has nothing to regenerate", async () => {
    rows = [];

    const result: HttpResult = await postJson(
      `${API_PREFIX}${TEAM_FEED_ROTATE_ROUTE}`,
    );

    expect(result.status).toBe(404);
    expect(rotateSpy).not.toHaveBeenCalled();
  });

  test("a reader held to some events is refused with the reason", async () => {
    readsEverySpy.mockResolvedValue(false);

    const result: HttpResult = await postJson(
      `${API_PREFIX}${TEAM_FEED_ROTATE_ROUTE}`,
    );

    expect(result.status).toBe(400);
    expect(json(result)["message"]).toBe(READ_EVERY_EVENT_MESSAGE);
    expect(rotateSpy).not.toHaveBeenCalled();
  });

  test("a caller the model refuses to let edit the link gets no new token", async () => {
    updateOneBySpy.mockRejectedValue(
      Object.assign(new Error("You do not have permission to edit this."), {
        code: 403,
      }) as never,
    );

    const result: HttpResult = await postJson(
      `${API_PREFIX}${TEAM_FEED_ROTATE_ROUTE}`,
    );

    expect(result.status).toBe(403);
    expect(rotateSpy).not.toHaveBeenCalled();
  });
});
