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
 * GET /on-call-schedule-timeline, the data behind the "every schedule on one
 * week / month grid" page.
 *
 * The pure helpers (the team filter, the window reader, the response
 * builder) are tested as functions. The route itself goes through a REAL
 * Express application built from what the module registered on the mock
 * router, over an ephemeral HTTP server, with every database service, the
 * renderer and the render-slot cache stubbed at their public seams. What is
 * under test is the route: who may call it, which reads carry the CALLER's
 * props (the gate) and which are root (only ever keyed on what the gate
 * returned), what reaches the renderer, and what comes back.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
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

/*
 * The real UserMiddleware functions are replaced with pass-throughs; the
 * spied CommonAPI.getDatabaseCommonInteractionProps decides who the caller
 * is. The route's own guards are what is under test.
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

// See OnCallCalendarAPI.test.ts: keeps a pre-existing TS diagnostic out.
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
  TIMELINE_RETRY_AFTER_SECONDS,
  buildTimelineResponse,
  readTimelineTeamFilter,
  readTimelineWindow,
} from "../../../Server/API/OnCallScheduleTimelineAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import OnCallCalendarFeedCache from "../../../Server/Infrastructure/OnCallCalendarFeedCache";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import OnCallDutyPolicyScheduleLayerUserService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleOwnerTeamService from "../../../Server/Services/OnCallDutyPolicyScheduleOwnerTeamService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import { ExpressRequest } from "../../../Server/Utils/Express";
import OnCallCalendarFeedRenderer, {
  CachedScheduleSegments,
  ScheduleInfo,
} from "../../../Server/Utils/OnCall/OnCallCalendarFeedRenderer";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import MaterializedShiftUtil, {
  MaterializedShift,
} from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import {
  SCHEDULE_TIMELINE_ROUTE,
  ScheduleTimelineResponse,
  ScheduleTimelineScheduleJson,
  ScheduleTimelineShiftJson,
  TIMELINE_MAX_PAST_DAYS,
  TIMELINE_MAX_SCHEDULES,
  TimelineWindow,
} from "../../../Types/OnCallDutyPolicy/ScheduleTimeline";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import {
  at,
  shift,
} from "../../Types/OnCallDutyPolicy/CalendarFeedTestFixtures";
import express from "express";
import http from "http";
import { AddressInfo } from "net";

// -- Harness ----------------------------------------------------------------

type RouteHandler = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
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

interface CapturedFind {
  query: Record<string, unknown>;
  select?: Record<string, unknown> | undefined;
  sort?: Record<string, unknown> | undefined;
  limit?: number | undefined;
  skip?: number | undefined;
  props: { isRoot?: boolean | undefined } & Record<string, unknown>;
}

const API_PREFIX: string = "/api";
const NOW: Date = at("2026-09-17T12:00:00.000Z");
const WEEK_FROM: string = "2026-09-14T04:00:00.000Z";
const WEEK_TO: string = "2026-09-21T04:00:00.000Z";

let server: http.Server;
let baseUrl: string;

let projectId: ObjectID;
let userId: ObjectID;
let scheduleA: ObjectID;
let scheduleB: ObjectID;
let teamSre: ObjectID;
let teamPayments: ObjectID;

let propsSpy: jest.SpyInstance;
let scheduleFindBy: jest.SpyInstance;
let scheduleCountBy: jest.SpyInstance;
let ownerTeamFindBy: jest.SpyInstance;
let teamFindBy: jest.SpyInstance;
let teamMemberFindBy: jest.SpyInstance;
let layerUserFindBy: jest.SpyInstance;
let loadSchedules: jest.SpyInstance;
let loadSegments: jest.SpyInstance;
let tryAcquireRenderSlot: jest.SpyInstance;
let releaseRenderSlot: jest.SpyInstance;

function registeredRoutes(): Array<RegisteredRoute> {
  return mockRouter.routes as unknown as Array<RegisteredRoute>;
}

function buildMemberProps(data: {
  projectId: ObjectID | undefined;
  userId: ObjectID | undefined;
  // Defaults to ProjectMember, which can read every on-call table.
  permissions?: Array<Permission> | undefined;
  // Team BLOCK rows (unlabelled), which override any Allow.
  blocks?: Array<Permission> | undefined;
}): DatabaseCommonInteractionProps {
  const grants: Array<UserPermission> = [
    ...(data.permissions || [Permission.ProjectMember]).map(
      (permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        };
      },
    ),
    ...(data.blocks || []).map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: true,
      };
    }),
  ];

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  if (data.projectId) {
    permissionMap[data.projectId.toString()] = {
      _type: "UserTenantAccessPermission",
      projectId: data.projectId,
      permissions: grants,
    };
  }

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userTenantAccessPermission: permissionMap,
  };
}

function request(requestPath: string): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (error: Error) => void) => {
      const clientRequest: http.ClientRequest = http.request(
        `${baseUrl}${requestPath}`,
        { method: "GET" },
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

function timelinePath(query?: Record<string, string>): string {
  const params: URLSearchParams = new URLSearchParams({
    from: WEEK_FROM,
    to: WEEK_TO,
    ...(query || {}),
  });

  return `${API_PREFIX}${SCHEDULE_TIMELINE_ROUTE}?${params.toString()}`;
}

function json(result: HttpResult): ScheduleTimelineResponse {
  return JSON.parse(result.body) as ScheduleTimelineResponse;
}

// The values a QueryHelper.any(...) operator matches.
function anyValues(operator: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    ((operator as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters as Record<string, unknown>) || {};

  return (Object.values(parameters)[0] as Array<string>) || [];
}

function captured(spy: jest.SpyInstance, call: number = 0): CapturedFind {
  return spy.mock.calls[call]?.[0] as CapturedFind;
}

function segment(data: {
  scheduleId: string;
  scheduleName?: string;
  shifts?: Array<MaterializedShift>;
  truncated?: boolean;
  timezone?: string | null;
}): CachedScheduleSegments {
  return {
    scheduleId: data.scheduleId,
    scheduleName: data.scheduleName || "Schedule",
    scheduleTimezone:
      data.timezone === undefined ? "Europe/Stockholm" : data.timezone,
    projectId: projectId.toString(),
    projectName: "Acme",
    shiftConfigVersion: 3,
    lastModifiedAt: NOW.toISOString(),
    truncated: Boolean(data.truncated),
    shifts: MaterializedShiftUtil.toJSONArray(data.shifts || []),
    envelope: [],
    envelopeTruncated: false,
  };
}

function scheduleRow(
  id: ObjectID,
  name: string,
): { id: ObjectID; name: string } {
  return { id, name };
}

beforeAll(async () => {
  const app: express.Express = express();

  for (const route of registeredRoutes()) {
    const chain: Array<express.RequestHandler> = [
      ...route.middlewares,
      route.handlerFunction,
    ] as unknown as Array<express.RequestHandler>;

    if (route.method === "GET") {
      app.get(`${API_PREFIX}${route.uri}`, ...chain);
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

  projectId = ObjectID.generate();
  userId = ObjectID.generate();
  scheduleA = ObjectID.generate();
  scheduleB = ObjectID.generate();
  teamSre = ObjectID.generate();
  teamPayments = ObjectID.generate();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  propsSpy = jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(buildMemberProps({ projectId, userId }));

  scheduleFindBy = jest
    .spyOn(OnCallDutyPolicyScheduleService, "findBy")
    .mockResolvedValue([
      scheduleRow(scheduleA, "Payments primary"),
      scheduleRow(scheduleB, "SRE primary"),
    ] as never);

  scheduleCountBy = jest
    .spyOn(OnCallDutyPolicyScheduleService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);

  ownerTeamFindBy = jest
    .spyOn(OnCallDutyPolicyScheduleOwnerTeamService, "findBy")
    .mockResolvedValue([
      { onCallDutyPolicyScheduleId: scheduleA, teamId: teamPayments },
      { onCallDutyPolicyScheduleId: scheduleB, teamId: teamSre },
      // A schedule owned by two teams.
      { onCallDutyPolicyScheduleId: scheduleB, teamId: teamPayments },
    ] as never);

  teamFindBy = jest.spyOn(TeamService, "findBy").mockResolvedValue([
    { id: teamSre, name: "SRE" },
    { id: teamPayments, name: "Payments" },
  ] as never);

  teamMemberFindBy = jest
    .spyOn(TeamMemberService, "findBy")
    .mockResolvedValue([{ teamId: teamSre }] as never);

  layerUserFindBy = jest
    .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
    .mockResolvedValue([{ onCallDutyPolicyScheduleId: scheduleB }] as never);

  loadSchedules = jest
    .spyOn(OnCallCalendarFeedRenderer, "loadSchedules")
    .mockImplementation(async (ids: Array<ObjectID>) => {
      return ids.map((id: ObjectID): ScheduleInfo => {
        return {
          id,
          name: "Schedule",
          projectId,
          shiftConfigVersion: 3,
        };
      });
    });

  loadSegments = jest
    .spyOn(OnCallCalendarFeedRenderer, "loadScheduleSegmentsBatch")
    .mockImplementation(async () => {
      return [
        segment({
          scheduleId: scheduleA.toString(),
          scheduleName: "Payments primary",
          shifts: [
            shift({
              scheduleId: scheduleA.toString(),
              start: at("2026-09-16T09:00:00.000Z"),
              end: at("2026-09-23T09:00:00.000Z"),
              userId: "user-b",
              userName: "Bob Berg",
            }),
            shift({
              scheduleId: scheduleA.toString(),
              start: at("2026-09-09T09:00:00.000Z"),
              end: at("2026-09-16T09:00:00.000Z"),
              userId: "user-a",
              userName: "Alice Andersson",
              layerId: "layer-1",
              layerName: "Weekly",
            }),
            // Before the window: the cache window is wider.
            shift({
              scheduleId: scheduleA.toString(),
              start: at("2026-09-02T09:00:00.000Z"),
              end: at("2026-09-09T09:00:00.000Z"),
            }),
            // Policy variant: never on the timeline.
            shift({
              scheduleId: scheduleA.toString(),
              start: at("2026-09-17T09:00:00.000Z"),
              end: at("2026-09-17T17:00:00.000Z"),
              userId: "user-c",
              policyVariantOf: {
                policyId: "pol-2",
                policyName: "Secondary",
                globalUserId: "user-b",
              },
            }),
          ],
        }),
        segment({
          scheduleId: scheduleB.toString(),
          scheduleName: "SRE primary",
          timezone: null,
          truncated: true,
        }),
      ];
    });

  tryAcquireRenderSlot = jest
    .spyOn(OnCallCalendarFeedCache, "tryAcquireRenderSlot")
    .mockReturnValue(true);

  releaseRenderSlot = jest
    .spyOn(OnCallCalendarFeedCache, "releaseRenderSlot")
    .mockReturnValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// -- Registration -----------------------------------------------------------

describe("registration", () => {
  test("registers exactly one GET route, behind the session middleware", () => {
    const routes: Array<RegisteredRoute> = registeredRoutes();

    expect(
      routes.map((route: RegisteredRoute) => {
        return `${route.method} ${route.uri}`;
      }),
    ).toEqual([`GET ${SCHEDULE_TIMELINE_ROUTE}`]);

    expect(routes[0]?.middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });
});

// -- Pure helpers -----------------------------------------------------------

describe("readTimelineTeamFilter", () => {
  function reqWith(query: Record<string, unknown>): ExpressRequest {
    return { query } as unknown as ExpressRequest;
  }

  test("absent or blank means no filter", () => {
    expect(readTimelineTeamFilter(reqWith({}))).toBeNull();
    expect(readTimelineTeamFilter(reqWith({ teamId: "" }))).toBeNull();
    expect(readTimelineTeamFilter(reqWith({ teamId: "   " }))).toBeNull();
    expect(readTimelineTeamFilter({} as ExpressRequest)).toBeNull();
  });

  test("a UUID is parsed (first value of a repeated parameter)", () => {
    const id: ObjectID = ObjectID.generate();

    expect(
      readTimelineTeamFilter(
        reqWith({ teamId: ` ${id.toString()} ` }),
      )?.toString(),
    ).toBe(id.toString());
    expect(
      readTimelineTeamFilter(
        reqWith({ teamId: [id.toString(), "other"] }),
      )?.toString(),
    ).toBe(id.toString());
  });

  test("anything else is a 400, never a silently unfiltered answer", () => {
    expect(() => {
      readTimelineTeamFilter(reqWith({ teamId: "sre" }));
    }).toThrow(BadDataException);
    expect(() => {
      readTimelineTeamFilter(reqWith({ teamId: "1; drop table" }));
    }).toThrow("teamId must be a valid id.");
  });
});

describe("readTimelineWindow", () => {
  test("reads and clamps from / to", () => {
    const window: TimelineWindow = readTimelineWindow(
      { query: { from: WEEK_FROM, to: WEEK_TO } } as unknown as ExpressRequest,
      NOW,
    );

    expect(window.from.toISOString()).toBe(WEEK_FROM);
    expect(window.to.toISOString()).toBe(WEEK_TO);
  });

  test("takes the first of a repeated parameter", () => {
    const window: TimelineWindow = readTimelineWindow(
      {
        query: { from: [WEEK_FROM, "2020-01-01T00:00:00.000Z"], to: WEEK_TO },
      } as unknown as ExpressRequest,
      NOW,
    );

    expect(window.from.toISOString()).toBe(WEEK_FROM);
  });

  test("a missing `from` is a 400", () => {
    expect(() => {
      readTimelineWindow({ query: {} } as unknown as ExpressRequest, NOW);
    }).toThrow(BadDataException);
  });
});

describe("buildTimelineResponse", () => {
  const window: TimelineWindow = {
    from: at(WEEK_FROM),
    to: at(WEEK_TO),
  };

  function build(
    overrides?: Partial<Parameters<typeof buildTimelineResponse>[0]>,
  ): ScheduleTimelineResponse {
    return buildTimelineResponse({
      window,
      now: NOW,
      schedules: [
        { id: "s-1", name: "One" },
        { id: "s-2", name: "Two" },
      ],
      segments: [],
      ownerTeamIdsBySchedule: new Map(),
      rosterScheduleIds: new Set(),
      teamNames: new Map(),
      memberTeamIds: new Set(),
      totalScheduleCount: 2,
      includeOverrides: true,
      ...(overrides || {}),
    });
  }

  test("every readable schedule gets a row, even with no segment", () => {
    const response: ScheduleTimelineResponse = build();

    expect(
      response.schedules.map((schedule: ScheduleTimelineScheduleJson) => {
        return [schedule.scheduleId, schedule.scheduleName, schedule.shifts];
      }),
    ).toEqual([
      ["s-1", "One", []],
      ["s-2", "Two", []],
    ]);
    expect(response.schedules[0]?.scheduleTimezone).toBeNull();
    expect(response.truncated).toBe(false);
  });

  test("window and generation stamps are ISO strings", () => {
    const response: ScheduleTimelineResponse = build();

    expect(response.from).toBe(WEEK_FROM);
    expect(response.to).toBe(WEEK_TO);
    expect(response.generatedAt).toBe(NOW.toISOString());
  });

  test("the segment's name and zone win over the gate's (renames race)", () => {
    const response: ScheduleTimelineResponse = build({
      segments: [
        segment({
          scheduleId: "s-1",
          scheduleName: "One (renamed)",
          timezone: "Asia/Tokyo",
        }),
      ],
    });

    expect(response.schedules[0]?.scheduleName).toBe("One (renamed)");
    expect(response.schedules[0]?.scheduleTimezone).toBe("Asia/Tokyo");
  });

  test("shifts are projected, filtered to the window and sorted", () => {
    const shifts: Array<MaterializedShift> = [
      shift({
        start: at("2026-09-18T09:00:00.000Z"),
        end: at("2026-09-19T09:00:00.000Z"),
        shiftKey: "late",
      }),
      shift({
        start: at("2026-09-15T09:00:00.000Z"),
        end: at("2026-09-16T09:00:00.000Z"),
        shiftKey: "early",
      }),
      shift({
        start: at("2026-09-25T09:00:00.000Z"),
        end: at("2026-09-26T09:00:00.000Z"),
        shiftKey: "outside",
      }),
    ];

    const response: ScheduleTimelineResponse = build({
      segments: [segment({ scheduleId: "s-1", shifts })],
    });

    expect(
      response.schedules[0]?.shifts.map((item: ScheduleTimelineShiftJson) => {
        return item.shiftKey;
      }),
    ).toEqual(["early", "late"]);
  });

  test("any truncated segment marks the response truncated", () => {
    const response: ScheduleTimelineResponse = build({
      segments: [segment({ scheduleId: "s-2", truncated: true })],
    });

    expect(response.truncated).toBe(true);
    expect(response.schedules[0]?.truncated).toBe(false);
    expect(response.schedules[1]?.truncated).toBe(true);
  });

  test("owner teams without a name (deleted teams) are dropped", () => {
    const response: ScheduleTimelineResponse = build({
      ownerTeamIdsBySchedule: new Map([["s-1", ["t-1", "t-gone"]]]),
      teamNames: new Map([["t-1", "SRE"]]),
    });

    expect(response.schedules[0]?.ownerTeamIds).toEqual(["t-1"]);
    expect(response.teams).toEqual([
      { teamId: "t-1", teamName: "SRE", isCurrentUserMember: false },
    ]);
  });

  test("teams are only those owning a returned schedule, sorted by name, with membership", () => {
    const response: ScheduleTimelineResponse = build({
      ownerTeamIdsBySchedule: new Map([
        ["s-1", ["t-z"]],
        ["s-2", ["t-a", "t-z"]],
      ]),
      teamNames: new Map([
        ["t-z", "Zebra"],
        ["t-a", "Alpha"],
        ["t-unused", "Unused"],
      ]),
      memberTeamIds: new Set(["t-z"]),
    });

    expect(response.teams).toEqual([
      { teamId: "t-a", teamName: "Alpha", isCurrentUserMember: false },
      { teamId: "t-z", teamName: "Zebra", isCurrentUserMember: true },
    ]);
  });

  test("roster membership is per schedule", () => {
    const response: ScheduleTimelineResponse = build({
      rosterScheduleIds: new Set(["s-2"]),
    });

    expect(
      response.schedules.map((schedule: ScheduleTimelineScheduleJson) => {
        return schedule.isCurrentUserOnRoster;
      }),
    ).toEqual([false, true]);
  });

  test("without override access the shift stays but its provenance is stripped", () => {
    const covered: MaterializedShift = shift({
      start: at("2026-09-15T12:00:00.000Z"),
      end: at("2026-09-15T18:00:00.000Z"),
      userId: "user-b",
      userName: "Bob Berg",
      override: {
        originalUserId: "user-a",
        originalUserName: "Alice Andersson",
        overrideStartsAt: at("2026-09-15T12:00:00.000Z"),
        overrideEndsAt: at("2026-09-15T18:00:00.000Z"),
      },
    });

    const withAccess: ScheduleTimelineResponse = build({
      segments: [segment({ scheduleId: "s-1", shifts: [covered] })],
    });
    const withoutAccess: ScheduleTimelineResponse = build({
      segments: [segment({ scheduleId: "s-1", shifts: [covered] })],
      includeOverrides: false,
    });

    expect(withAccess.schedules[0]?.shifts[0]?.override?.originalUserName).toBe(
      "Alice Andersson",
    );
    expect(withoutAccess.schedules[0]?.shifts[0]).toMatchObject({
      userId: "user-b",
      userName: "Bob Berg",
      override: null,
    });
  });

  test("schedulesTruncated compares the total with what was returned", () => {
    expect(build({ totalScheduleCount: 2 }).schedulesTruncated).toBe(false);

    const truncated: ScheduleTimelineResponse = build({
      totalScheduleCount: 400,
    });

    expect(truncated.schedulesTruncated).toBe(true);
    expect(truncated.totalScheduleCount).toBe(400);

    // A count that raced below the rows is never reported as less.
    expect(build({ totalScheduleCount: 1 }).totalScheduleCount).toBe(2);
  });
});

// -- The route --------------------------------------------------------------

describe("GET /on-call-schedule-timeline: who may call it", () => {
  test("a member of the tenant project is served", async () => {
    const result: HttpResult = await request(timelinePath());

    expect(result.status).toBe(200);
    expect(propsSpy).toHaveBeenCalledTimes(1);
  });

  test("a caller who is not a member of the tenant project is refused", async () => {
    propsSpy.mockResolvedValue({
      tenantId: projectId,
      userId,
      userTenantAccessPermission: {},
    });

    const result: HttpResult = await request(timelinePath());

    expect(result.status).toBe(ExceptionCode.NotAuthorizedException);
    expect(scheduleFindBy).not.toHaveBeenCalled();
    expect(loadSegments).not.toHaveBeenCalled();
  });

  test("a caller without a user (e.g. only a header) is refused", async () => {
    propsSpy.mockResolvedValue(
      buildMemberProps({ projectId, userId: undefined }),
    );

    const result: HttpResult = await request(timelinePath());

    // No credentials means an expired session can refresh and retry.
    expect(result.status).toBe(ExceptionCode.NotAuthenticatedException);
    expect(JSON.parse(result.body).message).toBe(
      CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
    );
    expect(scheduleFindBy).not.toHaveBeenCalled();
    expect(loadSchedules).not.toHaveBeenCalled();
    expect(loadSegments).not.toHaveBeenCalled();
    expect(tryAcquireRenderSlot).not.toHaveBeenCalled();
  });

  test("an authenticated API key without a user is still refused", async () => {
    propsSpy.mockResolvedValue({
      ...buildMemberProps({ projectId, userId: undefined }),
      userType: UserType.API,
    });

    const result: HttpResult = await request(timelinePath());

    expect(result.status).toBe(ExceptionCode.NotAuthorizedException);
    expect(JSON.parse(result.body).message).toBe(
      "You are not authorized to access this project's data.",
    );
    expect(scheduleFindBy).not.toHaveBeenCalled();
    expect(loadSchedules).not.toHaveBeenCalled();
    expect(loadSegments).not.toHaveBeenCalled();
    expect(tryAcquireRenderSlot).not.toHaveBeenCalled();
  });

  test("a request without a tenant is a 400", async () => {
    propsSpy.mockResolvedValue({ tenantId: undefined, userId });

    const result: HttpResult = await request(timelinePath());

    expect(result.status).toBe(ExceptionCode.BadDataException);
    expect(scheduleFindBy).not.toHaveBeenCalled();
  });

  test("a role that can list schedules but not read their layers is refused before anything is read", async () => {
    propsSpy.mockResolvedValue(
      buildMemberProps({
        projectId,
        userId,
        permissions: [Permission.ReadProjectOnCallDutyPolicySchedule],
      }),
    );

    const result: HttpResult = await request(timelinePath());

    expect(result.status).toBe(ExceptionCode.NotAuthorizedException);
    expect(JSON.parse(result.body).message).toBe(
      "You do not have permission to read this project's on-call schedule layers.",
    );
    expect(scheduleFindBy).not.toHaveBeenCalled();
    expect(loadSchedules).not.toHaveBeenCalled();
    expect(loadSegments).not.toHaveBeenCalled();
    expect(tryAcquireRenderSlot).not.toHaveBeenCalled();
  });

  test("the layer read permission alone is enough to be served", async () => {
    propsSpy.mockResolvedValue(
      buildMemberProps({
        projectId,
        userId,
        permissions: [
          Permission.ReadProjectOnCallDutyPolicySchedule,
          Permission.ReadOnCallDutyPolicyScheduleLayer,
        ],
      }),
    );

    const result: HttpResult = await request(timelinePath());

    expect(result.status).toBe(200);
    expect(json(result).schedules).toHaveLength(2);
  });

  test("override provenance is only sent to callers who can read user overrides", async () => {
    loadSegments.mockResolvedValue([
      segment({
        scheduleId: scheduleA.toString(),
        shifts: [
          shift({
            scheduleId: scheduleA.toString(),
            start: at("2026-09-15T12:00:00.000Z"),
            end: at("2026-09-15T18:00:00.000Z"),
            userId: "user-b",
            userName: "Bob Berg",
            override: {
              originalUserId: "user-a",
              originalUserName: "Alice Andersson",
              overrideStartsAt: at("2026-09-15T12:00:00.000Z"),
              overrideEndsAt: at("2026-09-15T18:00:00.000Z"),
            },
          }),
        ],
      }),
    ]);

    const full: ScheduleTimelineResponse = json(await request(timelinePath()));

    expect(full.schedules[0]?.shifts[0]?.override?.originalUserId).toBe(
      "user-a",
    );

    propsSpy.mockResolvedValue(
      buildMemberProps({
        projectId,
        userId,
        permissions: [
          Permission.ReadProjectOnCallDutyPolicySchedule,
          Permission.ReadOnCallDutyPolicyScheduleLayer,
        ],
      }),
    );

    const restricted: ScheduleTimelineResponse = json(
      await request(timelinePath()),
    );

    expect(restricted.schedules[0]?.shifts[0]).toMatchObject({
      userName: "Bob Berg",
      override: null,
    });
    expect(JSON.stringify(restricted)).not.toContain("Alice Andersson");
  });

  test("a team BLOCK on reading layers overrides the Allow, as on the CRUD read", async () => {
    propsSpy.mockResolvedValue(
      buildMemberProps({
        projectId,
        userId,
        blocks: [Permission.ReadOnCallDutyPolicyScheduleLayer],
      }),
    );

    const result: HttpResult = await request(timelinePath());

    expect(result.status).toBe(ExceptionCode.NotAuthorizedException);
    expect(JSON.parse(result.body).message).toContain(
      "is in your team's permission block list",
    );
    expect(scheduleFindBy).not.toHaveBeenCalled();
    expect(loadSegments).not.toHaveBeenCalled();
  });

  test("a team BLOCK on reading overrides strips override provenance", async () => {
    loadSegments.mockResolvedValue([
      segment({
        scheduleId: scheduleA.toString(),
        shifts: [
          shift({
            scheduleId: scheduleA.toString(),
            start: at("2026-09-15T12:00:00.000Z"),
            end: at("2026-09-15T18:00:00.000Z"),
            userId: "user-b",
            userName: "Bob Berg",
            override: {
              originalUserId: "user-a",
              originalUserName: "Alice Andersson",
              overrideStartsAt: at("2026-09-15T12:00:00.000Z"),
              overrideEndsAt: at("2026-09-15T18:00:00.000Z"),
            },
          }),
        ],
      }),
    ]);

    propsSpy.mockResolvedValue(
      buildMemberProps({
        projectId,
        userId,
        blocks: [Permission.ReadOnCallDutyPolicyUserOverride],
      }),
    );

    const result: HttpResult = await request(timelinePath());

    expect(result.status).toBe(200);
    expect(json(result).schedules[0]?.shifts[0]).toMatchObject({
      userName: "Bob Berg",
      override: null,
    });
    expect(result.body).not.toContain("Alice Andersson");
  });

  test("a master admin is served whatever their team blocks", async () => {
    propsSpy.mockResolvedValue({
      ...buildMemberProps({
        projectId,
        userId,
        blocks: [
          Permission.ReadOnCallDutyPolicyScheduleLayer,
          Permission.ReadOnCallDutyPolicyUserOverride,
        ],
      }),
      isMasterAdmin: true,
    });

    const result: HttpResult = await request(timelinePath());

    expect(result.status).toBe(200);
    expect(json(result).schedules).toHaveLength(2);
  });

  test("a permission error from the gate read is passed through", async () => {
    scheduleFindBy.mockRejectedValue(
      new NotAuthorizedException("You do not have permission to read."),
    );

    const result: HttpResult = await request(timelinePath());

    expect(result.status).toBe(ExceptionCode.NotAuthorizedException);
    expect(loadSegments).not.toHaveBeenCalled();
  });
});

describe("GET /on-call-schedule-timeline: validation", () => {
  test("a missing `from` is a 400", async () => {
    const result: HttpResult = await request(
      `${API_PREFIX}${SCHEDULE_TIMELINE_ROUTE}?to=${WEEK_TO}`,
    );

    expect(result.status).toBe(ExceptionCode.BadDataException);
    expect(JSON.parse(result.body).message).toBe("from is required.");
    expect(scheduleFindBy).not.toHaveBeenCalled();
  });

  test("a garbage window is a 400", async () => {
    const result: HttpResult = await request(
      timelinePath({ from: "last week" }),
    );

    expect(result.status).toBe(ExceptionCode.BadDataException);
  });

  test("an inverted window is a 400", async () => {
    const result: HttpResult = await request(
      timelinePath({ from: WEEK_TO, to: WEEK_FROM }),
    );

    expect(result.status).toBe(ExceptionCode.BadDataException);
  });

  test("a malformed teamId is a 400", async () => {
    const result: HttpResult = await request(timelinePath({ teamId: "sre" }));

    expect(result.status).toBe(ExceptionCode.BadDataException);
    expect(ownerTeamFindBy).not.toHaveBeenCalled();
    expect(scheduleFindBy).not.toHaveBeenCalled();
  });

  test("a far-past window is clamped, not refused", async () => {
    const result: HttpResult = await request(
      timelinePath({
        from: "2025-01-06T00:00:00.000Z",
        to: "2025-01-13T00:00:00.000Z",
      }),
    );

    expect(result.status).toBe(200);

    const earliest: Date = OneUptimeDate.addRemoveDays(
      NOW,
      -TIMELINE_MAX_PAST_DAYS,
    );

    expect(json(result).from).toBe(earliest.toISOString());
  });
});

describe("GET /on-call-schedule-timeline: the gate", () => {
  test("schedules are read with the CALLER's props, scoped to the tenant, by name", async () => {
    await request(timelinePath());

    const args: CapturedFind = captured(scheduleFindBy);

    expect(args.props.isRoot).toBeFalsy();
    expect(args.props["tenantId"]?.toString()).toBe(projectId.toString());
    expect(args.props["userId"]?.toString()).toBe(userId.toString());
    expect(args.query["projectId"]?.toString()).toBe(projectId.toString());
    expect(args.query["_id"]).toBeUndefined();
    expect(args.select).toEqual({ _id: true, name: true });
    expect(args.sort).toEqual({ name: SortOrder.Ascending });
    expect(args.limit).toBe(TIMELINE_MAX_SCHEDULES + 1);
  });

  test("owner teams are read with the caller's props too", async () => {
    await request(timelinePath());

    const args: CapturedFind = captured(ownerTeamFindBy);

    expect(args.props.isRoot).toBeFalsy();
    expect(args.query["projectId"]?.toString()).toBe(projectId.toString());
    expect(anyValues(args.query["onCallDutyPolicyScheduleId"]).sort()).toEqual(
      [scheduleA.toString(), scheduleB.toString()].sort(),
    );
  });

  test("the root reads are keyed only on what the gate returned", async () => {
    await request(timelinePath());

    const teamArgs: CapturedFind = captured(teamFindBy);
    expect(teamArgs.props.isRoot).toBe(true);
    expect(teamArgs.query["projectId"]?.toString()).toBe(projectId.toString());
    expect(anyValues(teamArgs.query["_id"]).sort()).toEqual(
      [teamSre.toString(), teamPayments.toString()].sort(),
    );

    const memberArgs: CapturedFind = captured(teamMemberFindBy);
    expect(memberArgs.props.isRoot).toBe(true);
    expect(memberArgs.query["userId"]?.toString()).toBe(userId.toString());
    expect(memberArgs.query["projectId"]?.toString()).toBe(
      projectId.toString(),
    );
    expect(memberArgs.query["hasAcceptedInvitation"]).toBe(true);

    const layerArgs: CapturedFind = captured(layerUserFindBy);
    expect(layerArgs.props.isRoot).toBe(true);
    expect(layerArgs.query["userId"]?.toString()).toBe(userId.toString());
    expect(
      anyValues(layerArgs.query["onCallDutyPolicyScheduleId"]).sort(),
    ).toEqual([scheduleA.toString(), scheduleB.toString()].sort());

    const ids: Array<ObjectID> = loadSchedules.mock
      .calls[0]?.[0] as Array<ObjectID>;
    expect(ids.map(String)).toEqual([
      scheduleA.toString(),
      scheduleB.toString(),
    ]);
  });

  test("a caller who can read no schedules gets an empty timeline and no render", async () => {
    scheduleFindBy.mockResolvedValue([]);

    const result: HttpResult = await request(timelinePath());

    expect(result.status).toBe(200);
    expect(json(result)).toMatchObject({
      schedules: [],
      teams: [],
      totalScheduleCount: 0,
      schedulesTruncated: false,
      truncated: false,
    });
    expect(ownerTeamFindBy).not.toHaveBeenCalled();
    expect(tryAcquireRenderSlot).not.toHaveBeenCalled();
    expect(loadSegments).not.toHaveBeenCalled();
  });

  test("an owner-team permission error serves the timeline ungrouped", async () => {
    ownerTeamFindBy.mockRejectedValue(
      new NotAuthorizedException("No owner-team permission."),
    );

    const result: HttpResult = await request(timelinePath());

    expect(result.status).toBe(200);

    const payload: ScheduleTimelineResponse = json(result);

    expect(payload.schedules).toHaveLength(2);
    expect(payload.teams).toEqual([]);
    expect(
      payload.schedules.every((schedule: ScheduleTimelineScheduleJson) => {
        return schedule.ownerTeamIds.length === 0;
      }),
    ).toBe(true);
    expect(teamFindBy).not.toHaveBeenCalled();
  });
});

describe("GET /on-call-schedule-timeline: owner-team failures", () => {
  test("a database error reading owner teams is an error, not an ungrouped 200", async () => {
    ownerTeamFindBy.mockRejectedValue(new Error("statement timeout"));

    const result: HttpResult = await request(timelinePath());

    expect(result.status).toBe(500);
    expect(loadSegments).not.toHaveBeenCalled();
    expect(releaseRenderSlot).not.toHaveBeenCalled();
  });

  test("a plan refusal reading owner teams also serves the timeline ungrouped", async () => {
    ownerTeamFindBy.mockRejectedValue(
      new PaymentRequiredException("Upgrade your plan."),
    );

    const result: HttpResult = await request(timelinePath());

    expect(result.status).toBe(200);
    expect(json(result).teams).toEqual([]);
  });
});

describe("GET /on-call-schedule-timeline: ?teamId=", () => {
  /*
   * The team owns A and B, but label scoping lets the caller read only B.
   * Everything after the gate must be keyed on what the gate returned, never
   * on the team's own list of schedule ids.
   */
  test("a team schedule the gate does not return is never read or rendered", async () => {
    ownerTeamFindBy
      .mockResolvedValueOnce([
        { onCallDutyPolicyScheduleId: scheduleA },
        { onCallDutyPolicyScheduleId: scheduleB },
      ] as never)
      .mockResolvedValueOnce([
        { onCallDutyPolicyScheduleId: scheduleB, teamId: teamSre },
      ] as never);
    scheduleFindBy.mockResolvedValue([scheduleRow(scheduleB, "SRE primary")]);

    const result: HttpResult = await request(
      timelinePath({ teamId: teamSre.toString() }),
    );

    expect(result.status).toBe(200);

    // The gate was asked about both of the team's schedules...
    expect(anyValues(captured(scheduleFindBy).query["_id"]).sort()).toEqual(
      [scheduleA.toString(), scheduleB.toString()].sort(),
    );

    // ...and everything after it only about the one it returned.
    expect(
      json(result).schedules.map((item: ScheduleTimelineScheduleJson) => {
        return item.scheduleId;
      }),
    ).toEqual([scheduleB.toString()]);
    expect(
      anyValues(
        captured(ownerTeamFindBy, 1).query["onCallDutyPolicyScheduleId"],
      ),
    ).toEqual([scheduleB.toString()]);
    expect(
      anyValues(captured(layerUserFindBy).query["onCallDutyPolicyScheduleId"]),
    ).toEqual([scheduleB.toString()]);
    expect(
      (loadSchedules.mock.calls[0]?.[0] as Array<ObjectID>).map(String),
    ).toEqual([scheduleB.toString()]);
    expect(
      (
        loadSegments.mock.calls[0]?.[0] as { schedules: Array<ScheduleInfo> }
      ).schedules.map((info: ScheduleInfo) => {
        return info.id.toString();
      }),
    ).toEqual([scheduleB.toString()]);
  });

  test("narrows the gate to the team's schedules", async () => {
    ownerTeamFindBy
      .mockResolvedValueOnce([
        { onCallDutyPolicyScheduleId: scheduleB },
        { onCallDutyPolicyScheduleId: scheduleB },
      ] as never)
      .mockResolvedValueOnce([
        { onCallDutyPolicyScheduleId: scheduleB, teamId: teamSre },
      ] as never);
    scheduleFindBy.mockResolvedValue([scheduleRow(scheduleB, "SRE primary")]);

    const result: HttpResult = await request(
      timelinePath({ teamId: teamSre.toString() }),
    );

    expect(result.status).toBe(200);

    const teamArgs: CapturedFind = captured(ownerTeamFindBy, 0);
    expect(teamArgs.props.isRoot).toBeFalsy();
    expect(teamArgs.query["teamId"]?.toString()).toBe(teamSre.toString());
    expect(teamArgs.query["projectId"]?.toString()).toBe(projectId.toString());

    const scheduleArgs: CapturedFind = captured(scheduleFindBy);
    expect(anyValues(scheduleArgs.query["_id"])).toEqual([
      scheduleB.toString(),
    ]);
    expect(scheduleArgs.props.isRoot).toBeFalsy();
  });

  test("a team that owns nothing is an empty timeline, with nothing else read", async () => {
    ownerTeamFindBy.mockResolvedValue([]);

    const result: HttpResult = await request(
      timelinePath({ teamId: teamSre.toString() }),
    );

    expect(result.status).toBe(200);
    expect(json(result).schedules).toEqual([]);
    expect(scheduleFindBy).not.toHaveBeenCalled();
    expect(tryAcquireRenderSlot).not.toHaveBeenCalled();
  });
});

describe("GET /on-call-schedule-timeline: the cap on schedules", () => {
  test("past the cap, only the first 250 are rendered and the total is counted", async () => {
    const rows: Array<{ id: ObjectID; name: string }> = [];

    for (let index: number = 0; index < TIMELINE_MAX_SCHEDULES + 1; index++) {
      rows.push(scheduleRow(ObjectID.generate(), `Schedule ${index}`));
    }

    scheduleFindBy.mockResolvedValue(rows);
    scheduleCountBy.mockResolvedValue(new PositiveNumber(412));
    ownerTeamFindBy.mockResolvedValue([]);
    loadSegments.mockResolvedValue([]);

    const result: HttpResult = await request(timelinePath());
    const payload: ScheduleTimelineResponse = json(result);

    expect(payload.schedules).toHaveLength(TIMELINE_MAX_SCHEDULES);
    expect(payload.totalScheduleCount).toBe(412);
    expect(payload.schedulesTruncated).toBe(true);

    const countArgs: CapturedFind = captured(scheduleCountBy);
    expect(countArgs.props.isRoot).toBeFalsy();
    expect(countArgs.query["projectId"]?.toString()).toBe(projectId.toString());

    expect((loadSchedules.mock.calls[0]?.[0] as Array<ObjectID>).length).toBe(
      TIMELINE_MAX_SCHEDULES,
    );
  });

  test("under the cap nothing is counted", async () => {
    await request(timelinePath());

    expect(scheduleCountBy).not.toHaveBeenCalled();
  });
});

describe("GET /on-call-schedule-timeline: rendering", () => {
  test("the cache window is the served window widened to UTC days", async () => {
    await request(timelinePath());

    const args: {
      schedules: Array<ScheduleInfo>;
      windowStart: Date;
      windowEnd: Date;
      now: Date;
    } = loadSegments.mock.calls[0]?.[0] as {
      schedules: Array<ScheduleInfo>;
      windowStart: Date;
      windowEnd: Date;
      now: Date;
    };

    expect(args.windowStart.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(args.windowEnd.toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(args.now.toISOString()).toBe(NOW.toISOString());
    expect(args.schedules).toHaveLength(2);
  });

  test("render cap reached: 503 + Retry-After, nothing rendered, no slot released", async () => {
    tryAcquireRenderSlot.mockReturnValue(false);

    const result: HttpResult = await request(timelinePath());

    expect(result.status).toBe(503);
    expect(result.headers["retry-after"]).toBe(
      String(TIMELINE_RETRY_AFTER_SECONDS),
    );
    expect(loadSegments).not.toHaveBeenCalled();
    expect(releaseRenderSlot).not.toHaveBeenCalled();
  });

  test("it leaves half the render slots for the public calendar feeds", async () => {
    await request(timelinePath());

    const options: { leaveFreeSlots?: number } = tryAcquireRenderSlot.mock
      .calls[0]?.[0] as { leaveFreeSlots?: number };

    expect(options.leaveFreeSlots).toBe(
      Math.floor(OnCallCalendarFeedCache.getRenderConcurrency() / 2),
    );
  });

  test("the slot is released after a render", async () => {
    await request(timelinePath());

    expect(tryAcquireRenderSlot).toHaveBeenCalledTimes(1);
    expect(releaseRenderSlot).toHaveBeenCalledTimes(1);
  });

  test("the slot is released when the render throws", async () => {
    loadSegments.mockRejectedValue(new Error("layer exploded"));

    const result: HttpResult = await request(timelinePath());

    expect(result.status).toBe(500);
    expect(releaseRenderSlot).toHaveBeenCalledTimes(1);
  });
});

describe("GET /on-call-schedule-timeline: the payload", () => {
  test("schedules, shifts, teams and flags", async () => {
    const result: HttpResult = await request(timelinePath());

    expect(result.status).toBe(200);

    const payload: ScheduleTimelineResponse = json(result);

    expect(payload.from).toBe(WEEK_FROM);
    expect(payload.to).toBe(WEEK_TO);
    expect(payload.generatedAt).toBe(NOW.toISOString());
    expect(payload.truncated).toBe(true);
    expect(payload.totalScheduleCount).toBe(2);
    expect(payload.schedulesTruncated).toBe(false);

    const [payments, sre]: Array<ScheduleTimelineScheduleJson> =
      payload.schedules;

    expect(payments?.scheduleId).toBe(scheduleA.toString());
    expect(payments?.scheduleName).toBe("Payments primary");
    expect(payments?.scheduleTimezone).toBe("Europe/Stockholm");
    expect(payments?.ownerTeamIds).toEqual([teamPayments.toString()]);
    expect(payments?.isCurrentUserOnRoster).toBe(false);

    // Out-of-window and policy-variant shifts are gone; the rest are sorted.
    expect(
      payments?.shifts.map((item: ScheduleTimelineShiftJson) => {
        return [item.userName, item.start, item.end, item.layerName];
      }),
    ).toEqual([
      [
        "Alice Andersson",
        "2026-09-09T09:00:00.000Z",
        "2026-09-16T09:00:00.000Z",
        "Weekly",
      ],
      [
        "Bob Berg",
        "2026-09-16T09:00:00.000Z",
        "2026-09-23T09:00:00.000Z",
        null,
      ],
    ]);

    expect(sre?.scheduleTimezone).toBeNull();
    expect(sre?.truncated).toBe(true);
    expect(sre?.isCurrentUserOnRoster).toBe(true);
    expect(sre?.ownerTeamIds.sort()).toEqual(
      [teamSre.toString(), teamPayments.toString()].sort(),
    );
    expect(sre?.shifts).toEqual([]);

    expect(payload.teams).toEqual([
      {
        teamId: teamPayments.toString(),
        teamName: "Payments",
        isCurrentUserMember: false,
      },
      {
        teamId: teamSre.toString(),
        teamName: "SRE",
        isCurrentUserMember: true,
      },
    ]);
  });

  test("the payload never carries content hashes or policy lists", async () => {
    const result: HttpResult = await request(timelinePath());
    const raw: Record<string, unknown> = JSON.parse(result.body);
    const firstShift: Record<string, unknown> = (
      (raw["schedules"] as Array<Record<string, unknown>>)[0]?.[
        "shifts"
      ] as Array<Record<string, unknown>>
    )[0] as Record<string, unknown>;

    expect(Object.keys(firstShift).sort()).toEqual([
      "end",
      "layerId",
      "layerName",
      "override",
      "shiftKey",
      "start",
      "userId",
      "userName",
    ]);
  });
});
