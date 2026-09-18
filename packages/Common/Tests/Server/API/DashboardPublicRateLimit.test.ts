import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * Wiring for the public dashboard rate limiter.
 *
 * The unit tests in Tests/Server/Middleware cover the limiter's own
 * behaviour. What this file protects is the part that silently rots: that
 * EVERY route on the anonymous /public-dashboard-api surface is actually
 * behind it, that it sits in FRONT of the auth middleware, that the budget is
 * shared across the surface rather than granted per route, and that
 * /master-password is on the tighter bucket. A route added later without a
 * limiter fails the first test here.
 */

jest.mock("../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
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
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEntityArrayResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

import DashboardAPI from "../../../Server/API/DashboardAPI";
import BaseAPI from "../../../Server/API/BaseAPI";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardService from "../../../Server/Services/DashboardService";
import Redis from "../../../Server/Infrastructure/Redis";
import Response from "../../../Server/Utils/Response";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import Exception from "../../../Types/Exception/Exception";
import ObjectID from "../../../Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;

const READ_PER_DASHBOARD_LIMIT: number = 600;
const MASTER_PASSWORD_PER_DASHBOARD_LIMIT: number = 15;

/* Same counting fake as the middleware unit tests use. */
class FakeRedisClient {
  public counters: Map<string, number> = new Map();

  public pipeline(): FakePipeline {
    return new FakePipeline(this);
  }
}

type QueuedCommand = () => [Error | null, unknown];

class FakePipeline {
  private commands: Array<QueuedCommand> = [];

  public constructor(private client: FakeRedisClient) {}

  public incr(key: string): FakePipeline {
    this.commands.push((): [Error | null, unknown] => {
      const next: number = (this.client.counters.get(key) || 0) + 1;
      this.client.counters.set(key, next);
      return [null, next];
    });

    return this;
  }

  public expire(): FakePipeline {
    this.commands.push((): [Error | null, unknown] => {
      return [null, 1];
    });

    return this;
  }

  public async exec(): Promise<unknown> {
    return this.commands.map((command: QueuedCommand) => {
      return command();
    });
  }
}

interface PublicRoute {
  method: string;
  uri: string;
  params: Record<string, string>;
  body?: Record<string, unknown>;
}

/*
 * Every route this router exposes under /public-dashboard-api. Nginx rewrites
 * that prefix to /api/dashboard before it reaches the process, so this router
 * IS the public surface and the whole list belongs behind the limiter.
 */
const buildPublicRoutes: (dashboardId: string) => Array<PublicRoute> = (
  dashboardId: string,
) => {
  return [
    {
      method: "GET",
      uri: "/dashboard/seo/:dashboardIdOrDomain",
      params: { dashboardIdOrDomain: dashboardId },
    },
    {
      method: "POST",
      uri: "/dashboard/overview/:dashboardIdOrDomain",
      params: { dashboardIdOrDomain: dashboardId },
    },
    {
      method: "GET",
      uri: "/dashboard/overview/:dashboardIdOrDomain",
      params: { dashboardIdOrDomain: dashboardId },
    },
    {
      method: "POST",
      uri: "/dashboard/domain",
      params: {},
      body: { domain: "dash.example.com" },
    },
    {
      method: "POST",
      uri: "/dashboard/metadata/:dashboardId",
      params: { dashboardId },
    },
    {
      method: "POST",
      uri: "/dashboard/view-config/:dashboardId",
      params: { dashboardId },
    },
    {
      method: "POST",
      uri: "/dashboard/attribute-values/:dashboardId",
      params: { dashboardId },
    },
    {
      method: "POST",
      uri: "/dashboard/metric-types/:dashboardId",
      params: { dashboardId },
    },
    {
      method: "POST",
      uri: "/dashboard/metrics-aggregate/:dashboardId",
      params: { dashboardId },
    },
    {
      method: "POST",
      uri: "/dashboard/resource-list/:dashboardId/:resourceType",
      params: { dashboardId, resourceType: "incident" },
    },
    {
      method: "POST",
      uri: "/dashboard/slo-history-aggregate/:dashboardId",
      params: { dashboardId },
    },
    {
      method: "POST",
      uri: "/dashboard/master-password/:dashboardId",
      params: { dashboardId },
    },
  ];
};

const MASTER_PASSWORD_URI: string = "/dashboard/master-password/:dashboardId";

/* The limiter's read window, used to pin the clock below. */
const READ_WINDOW_SECONDS: number = 60;

describe("DashboardAPI public rate limiting", () => {
  let client: FakeRedisClient;
  let dashboardId: string;
  let publicRoutes: Array<PublicRoute>;
  let nowSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    mockRouter.routes.length = 0;
    jest.clearAllMocks();

    new DashboardAPI();

    client = new FakeRedisClient();
    getClientMock.mockReturnValue(client);
    isConnectedMock.mockReturnValue(true);

    /*
     * Pinned to the start of a window. These tests fire hundreds of requests
     * in a loop, and on real time a loop that happened to straddle a window
     * boundary would see the counter reset halfway through and never reach
     * the limit — a flake that only shows up under load, which is exactly
     * when the suite is slowest.
     */
    let pinnedTime: number = 1_700_000_000_000;
    pinnedTime = pinnedTime - (pinnedTime % (READ_WINDOW_SECONDS * 1000));

    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => {
      return pinnedTime;
    });

    dashboardId = ObjectID.generate().toString();
    publicRoutes = buildPublicRoutes(dashboardId);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  const buildRequest: (
    route: PublicRoute,
    clientIp?: string,
  ) => ExpressRequest = (
    route: PublicRoute,
    clientIp: string = "203.0.113.7",
  ) => {
    return {
      params: route.params,
      body: route.body || {},
      query: {},
      cookies: {},
      headers: { "x-forwarded-for": clientIp },
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;
  };

  const buildResponse: () => ExpressResponse = () => {
    return {
      setHeader: jest.fn(),
      status: jest.fn(),
      send: jest.fn(),
    } as unknown as ExpressResponse;
  };

  /* Drive only the rate limiter, not the handler behind it. */
  const runLimiter: (
    route: PublicRoute,
    clientIp?: string,
  ) => Promise<boolean> = async (
    route: PublicRoute,
    clientIp: string = "203.0.113.7",
  ) => {
    let reachedNext: boolean = false;

    await (
      mockRouter.match(route.method, route.uri).middlewares[0] as (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ) => Promise<void>
    )(buildRequest(route, clientIp), buildResponse(), (() => {
      reachedNext = true;
    }) as unknown as NextFunction);

    return reachedNext;
  };

  describe("registration", () => {
    it.each(
      buildPublicRoutes("00000000-0000-4000-8000-000000000000").map(
        (route: PublicRoute) => {
          return [`${route.method} ${route.uri}`, route] as const;
        },
      ),
    )(
      "puts a limiter in front of %s",
      async (_label: string, route: PublicRoute) => {
        const registered: { middlewares: Array<unknown> } = mockRouter.match(
          route.method,
          route.uri,
        );

        expect(registered.middlewares).toHaveLength(2);
        expect(typeof registered.middlewares[0]).toBe("function");
      },
    );

    /*
     * Order matters: ahead of UserMiddleware a flood is refused before it
     * costs a session lookup, and behind it the limiter would be doing that
     * work for every request it was about to reject.
     */
    it.each(
      buildPublicRoutes("00000000-0000-4000-8000-000000000000").map(
        (route: PublicRoute) => {
          return [`${route.method} ${route.uri}`, route] as const;
        },
      ),
    )(
      "runs the limiter before authorization on %s",
      async (_label: string, route: PublicRoute) => {
        const registered: { middlewares: Array<unknown> } = mockRouter.match(
          route.method,
          route.uri,
        );

        expect(registered.middlewares[1]).toBe(
          UserMiddleware.getUserMiddleware,
        );
        expect(registered.middlewares[0]).not.toBe(
          UserMiddleware.getUserMiddleware,
        );
      },
    );

    /*
     * The guard against a route being added to this surface later without a
     * limiter.
     *
     * DashboardAPI inherits authenticated CRUD routes from BaseAPI, which are
     * NOT part of the anonymous surface and are correctly unlimited here — so
     * the inherited set is derived by registering a plain BaseAPI for the same
     * model and subtracting it, rather than hardcoding a list that would
     * quietly drift. Everything DashboardAPI declares itself is served under
     * /public-dashboard-api and must be limited.
     */
    it("leaves no custom dashboard route without a limiter in front", () => {
      const declaredRoutes: Array<{
        method: string;
        uri: string;
        middlewares: Array<unknown>;
      }> = [...mockRouter.routes];

      mockRouter.routes.length = 0;
      new BaseAPI(Dashboard, DashboardService);

      const inheritedRouteKeys: Set<string> = new Set(
        mockRouter.routes.map((route: { method: string; uri: string }) => {
          return `${route.method} ${route.uri}`;
        }),
      );

      const unlimited: Array<string> = declaredRoutes
        .filter((route: { method: string; uri: string }) => {
          return !inheritedRouteKeys.has(`${route.method} ${route.uri}`);
        })
        .filter((route: { middlewares: Array<unknown> }) => {
          return route.middlewares[0] === UserMiddleware.getUserMiddleware;
        })
        .map((route: { method: string; uri: string }) => {
          return `${route.method} ${route.uri}`;
        });

      expect(unlimited).toEqual([]);
    });

    /*
     * And the converse, so the subtraction above cannot pass by accident: the
     * custom routes really are the public surface this file enumerates.
     */
    it("declares exactly the public routes this suite covers", () => {
      const declaredRoutes: Array<{ method: string; uri: string }> = [
        ...mockRouter.routes,
      ];

      mockRouter.routes.length = 0;
      new BaseAPI(Dashboard, DashboardService);

      const inheritedRouteKeys: Set<string> = new Set(
        mockRouter.routes.map((route: { method: string; uri: string }) => {
          return `${route.method} ${route.uri}`;
        }),
      );

      const customRouteKeys: Array<string> = declaredRoutes
        .filter((route: { method: string; uri: string }) => {
          return !inheritedRouteKeys.has(`${route.method} ${route.uri}`);
        })
        .map((route: { method: string; uri: string }) => {
          return `${route.method} ${route.uri}`;
        })
        .sort();

      const expectedKeys: Array<string> = publicRoutes
        .map((route: PublicRoute) => {
          return `${route.method} ${route.uri}`;
        })
        .sort();

      expect(customRouteKeys).toEqual(expectedKeys);
    });

    it("covers every route named in the public dashboard surface", () => {
      for (const route of publicRoutes) {
        expect(() => {
          return mockRouter.match(route.method, route.uri);
        }).not.toThrow();
      }
    });
  });

  describe("read budget", () => {
    it("lets normal dashboard traffic through", async () => {
      for (const route of publicRoutes) {
        if (route.uri === MASTER_PASSWORD_URI) {
          continue;
        }

        expect(await runLimiter(route)).toBe(true);
      }
    });

    it("refuses a caller that exhausts the budget", async () => {
      const route: PublicRoute = publicRoutes.find((candidate: PublicRoute) => {
        return candidate.uri === "/dashboard/metrics-aggregate/:dashboardId";
      }) as PublicRoute;

      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT; i++) {
        expect(await runLimiter(route)).toBe(true);
      }

      expect(await runLimiter(route)).toBe(false);
    });

    it("answers a refusal with 429", async () => {
      const route: PublicRoute = publicRoutes.find((candidate: PublicRoute) => {
        return candidate.uri === "/dashboard/metrics-aggregate/:dashboardId";
      }) as PublicRoute;

      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT + 1; i++) {
        await runLimiter(route);
      }

      const error: Exception = sendErrorResponseMock.mock
        .calls[0]?.[2] as Exception;

      expect(error.code).toBe(ExceptionCode.TooManyRequestsException);
    });

    /*
     * One budget for the whole surface. If each route had its own counter, an
     * attacker would simply round-robin the ten routes for ten times the
     * ClickHouse and Postgres work.
     */
    it("shares one budget across the whole surface rather than one per route", async () => {
      /*
       * Every route that names THIS dashboard by id. /dashboard/domain is
       * excluded because it names a dashboard by domain instead, so it
       * legitimately keys into a different bucket and would blur the count.
       */
      const readRoutes: Array<PublicRoute> = publicRoutes.filter(
        (route: PublicRoute) => {
          return (
            route.uri !== MASTER_PASSWORD_URI &&
            route.uri !== "/dashboard/domain"
          );
        },
      );

      let allowed: number = 0;

      /*
       * Round-robin far past the point where any single route would have
       * been exhausted on its own.
       */
      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT + 20; i++) {
        const route: PublicRoute = readRoutes[
          i % readRoutes.length
        ] as PublicRoute;

        if (await runLimiter(route)) {
          allowed++;
        }
      }

      expect(allowed).toBe(READ_PER_DASHBOARD_LIMIT);
    });

    it("does not let one viewer's flood affect another viewer", async () => {
      const route: PublicRoute = publicRoutes.find((candidate: PublicRoute) => {
        return candidate.uri === "/dashboard/metrics-aggregate/:dashboardId";
      }) as PublicRoute;

      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT + 5; i++) {
        await runLimiter(route, "203.0.113.7");
      }

      expect(await runLimiter(route, "198.51.100.4")).toBe(true);
    });
  });

  describe("master password bucket", () => {
    const masterPasswordRoute: () => PublicRoute = () => {
      return {
        method: "POST",
        uri: MASTER_PASSWORD_URI,
        params: { dashboardId },
      };
    };

    /*
     * The sharpest case in the whole change: this route verifies a bcrypt
     * hash per request, so unlimited it is an online guessing oracle that
     * also burns a CPU-bound hash per guess.
     */
    it("cuts password guessing off long before the read budget would", async () => {
      const route: PublicRoute = masterPasswordRoute();

      for (let i: number = 0; i < MASTER_PASSWORD_PER_DASHBOARD_LIMIT; i++) {
        expect(await runLimiter(route)).toBe(true);
      }

      expect(await runLimiter(route)).toBe(false);
      expect(MASTER_PASSWORD_PER_DASHBOARD_LIMIT).toBeLessThan(
        READ_PER_DASHBOARD_LIMIT,
      );
    });

    it("stops the guess before it reaches the bcrypt comparison", async () => {
      const route: PublicRoute = masterPasswordRoute();

      for (let i: number = 0; i < MASTER_PASSWORD_PER_DASHBOARD_LIMIT; i++) {
        await runLimiter(route);
      }

      /*
       * next() is what hands control to UserMiddleware and then the handler
       * that calls verifyHashedColumnValue. Not reaching it is the point.
       */
      expect(await runLimiter(route)).toBe(false);
    });

    it("does not spend the read budget", async () => {
      const route: PublicRoute = masterPasswordRoute();

      for (
        let i: number = 0;
        i < MASTER_PASSWORD_PER_DASHBOARD_LIMIT + 5;
        i++
      ) {
        await runLimiter(route);
      }

      const readRoute: PublicRoute = publicRoutes.find(
        (candidate: PublicRoute) => {
          return candidate.uri === "/dashboard/view-config/:dashboardId";
        },
      ) as PublicRoute;

      expect(await runLimiter(readRoute)).toBe(true);
    });

    /*
     * And the converse: a busy dashboard must not lock its own viewers out of
     * entering the password.
     */
    it("is not consumed by read traffic", async () => {
      const readRoute: PublicRoute = publicRoutes.find(
        (candidate: PublicRoute) => {
          return candidate.uri === "/dashboard/view-config/:dashboardId";
        },
      ) as PublicRoute;

      for (let i: number = 0; i < READ_PER_DASHBOARD_LIMIT + 5; i++) {
        await runLimiter(readRoute);
      }

      expect(await runLimiter(masterPasswordRoute())).toBe(true);
    });
  });

  describe("when Redis is unavailable", () => {
    beforeEach(() => {
      isConnectedMock.mockReturnValue(false);
    });

    /*
     * Reads fail open — a Redis blip must not black out every customer's
     * public dashboard.
     */
    it("keeps serving public dashboard reads", async () => {
      for (const route of publicRoutes) {
        if (route.uri === MASTER_PASSWORD_URI) {
          continue;
        }

        expect(await runLimiter(route)).toBe(true);
      }
    });

    /*
     * Password attempts fail closed — without the counter there is no bound
     * on guessing at all.
     */
    it("refuses password attempts with a 503", async () => {
      const route: PublicRoute = {
        method: "POST",
        uri: MASTER_PASSWORD_URI,
        params: { dashboardId },
      };

      expect(await runLimiter(route)).toBe(false);

      const error: Exception = sendErrorResponseMock.mock
        .calls[0]?.[2] as Exception;

      expect(error.code).toBe(ExceptionCode.ServiceUnavailableException);
    });
  });
});
