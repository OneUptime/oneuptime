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
 * Wiring for the attempt limit on the status page master password route.
 *
 * The limiter's own behaviour is covered in
 * Tests/Server/Middleware/PublicDashboardRateLimitStatusPage.test.ts. What
 * this file protects is the part that silently rots: that the route actually
 * has the limiter, that it sits in FRONT of the auth middleware and the
 * handler, that it counts per status page rather than per anything else, and
 * that its budget is its own rather than the dashboard master password
 * route's.
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

import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import StatusPageService from "../../../Server/Services/StatusPageService";
import Redis from "../../../Server/Infrastructure/Redis";
import Response from "../../../Server/Utils/Response";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import Exception from "../../../Types/Exception/Exception";
import BadDataException from "../../../Types/Exception/BadDataException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";

type MockedFn = ReturnType<typeof jest.fn>;

type RouteFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;

const STATUS_PAGE_MASTER_PASSWORD_URI: string =
  "/status-page/master-password/:statusPageId";
const DASHBOARD_MASTER_PASSWORD_URI: string =
  "/dashboard/master-password/:dashboardId";

/* The shipped defaults, restated so a change to either has to be deliberate. */
const WINDOW_SECONDS: number = 15 * 60;
const PER_STATUS_PAGE_LIMIT: number = 15;
const PER_IP_LIMIT: number = 45;

const CLIENT_IP: string = "203.0.113.7";

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

describe("StatusPageAPI master password rate limiting", () => {
  let client: FakeRedisClient;
  let statusPageId: string;
  let nowSpy: ReturnType<typeof jest.spyOn>;
  let findOneByIdSpy: ReturnType<typeof jest.spyOn>;
  let verifySpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    mockRouter.routes.length = 0;
    jest.clearAllMocks();

    new StatusPageAPI();
    new DashboardAPI();

    client = new FakeRedisClient();
    getClientMock.mockReturnValue(client);
    isConnectedMock.mockReturnValue(true);

    /*
     * Pinned to the start of a window, so a loop that straddled a boundary
     * cannot see its counter reset halfway and never reach the limit.
     */
    let pinnedTime: number = 1_700_000_000_000;
    pinnedTime = pinnedTime - (pinnedTime % (WINDOW_SECONDS * 1000));

    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => {
      return pinnedTime;
    });

    statusPageId = ObjectID.generate().toString();

    /*
     * A private status page with a master password set. The handler only
     * reaches the verify call through these, so counting verify calls counts
     * the guesses that got past the limiter.
     */
    const statusPage: StatusPage = new StatusPage();
    statusPage.id = new ObjectID(statusPageId);
    statusPage.isPublicStatusPage = false;
    statusPage.enableMasterPassword = true;
    statusPage.masterPassword = new HashedString("stored-hash", true);

    findOneByIdSpy = jest
      .spyOn(StatusPageService, "findOneById")
      .mockResolvedValue(statusPage);
    verifySpy = jest
      .spyOn(StatusPageService, "verifyHashedColumnValue")
      .mockResolvedValue(false);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    jest.restoreAllMocks();
  });

  const buildRequest: (data: {
    params: Record<string, string>;
    clientIp?: string;
  }) => ExpressRequest = (data: {
    params: Record<string, string>;
    clientIp?: string;
  }) => {
    return {
      params: data.params,
      body: { password: "a guess" },
      query: {},
      cookies: {},
      headers: { "x-forwarded-for": data.clientIp || CLIENT_IP },
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;
  };

  const buildResponse: () => ExpressResponse = () => {
    return {
      setHeader: jest.fn(),
      cookie: jest.fn(),
      status: jest.fn(),
      send: jest.fn(),
    } as unknown as ExpressResponse;
  };

  /* Drive only the limiter registered on a route, not what follows it. */
  const runLimiter: (
    uri: string,
    params: Record<string, string>,
    clientIp?: string,
  ) => Promise<boolean> = async (
    uri: string,
    params: Record<string, string>,
    clientIp?: string,
  ) => {
    let reachedNext: boolean = false;

    await (mockRouter.match("POST", uri).middlewares[0] as RouteFunction)(
      buildRequest({ params, clientIp: clientIp || CLIENT_IP }),
      buildResponse(),
      (() => {
        reachedNext = true;
      }) as unknown as NextFunction,
    );

    return reachedNext;
  };

  const attemptStatusPage: (
    targetStatusPageId?: string,
    clientIp?: string,
  ) => Promise<boolean> = (
    targetStatusPageId?: string,
    clientIp?: string,
  ) => {
    return runLimiter(
      STATUS_PAGE_MASTER_PASSWORD_URI,
      { statusPageId: targetStatusPageId || statusPageId },
      clientIp,
    );
  };

  /*
   * The limiter, then the handler, as Express would chain them. UserMiddleware
   * is skipped: it only resolves an optional session and is not what is under
   * test. Returns the error the handler passed on, if the handler ran.
   */
  const runLimiterThenHandler: () => Promise<{
    reachedHandler: boolean;
    handlerError: unknown;
  }> = async () => {
    const route: {
      middlewares: Array<RouteFunction>;
      handlerFunction: RouteFunction;
    } = mockRouter.match("POST", STATUS_PAGE_MASTER_PASSWORD_URI) as {
      middlewares: Array<RouteFunction>;
      handlerFunction: RouteFunction;
    };

    const req: ExpressRequest = buildRequest({ params: { statusPageId } });
    const res: ExpressResponse = buildResponse();

    let reachedHandler: boolean = false;
    let handlerError: unknown = undefined;

    await (route.middlewares[0] as RouteFunction)(req, res, (async () => {
      reachedHandler = true;

      await route.handlerFunction(req, res, ((err: unknown) => {
        handlerError = err;
      }) as unknown as NextFunction);
    }) as unknown as NextFunction);

    return { reachedHandler, handlerError };
  };

  describe("registration", () => {
    it("puts a limiter in front of the route", () => {
      const registered: { middlewares: Array<unknown> } = mockRouter.match(
        "POST",
        STATUS_PAGE_MASTER_PASSWORD_URI,
      );

      expect(registered.middlewares).toHaveLength(2);
      expect(typeof registered.middlewares[0]).toBe("function");
    });

    /*
     * Ahead of UserMiddleware a refused guess costs no session lookup; behind
     * it the limiter would be doing that work for every guess it rejects.
     */
    it("runs the limiter before authorization", () => {
      const registered: { middlewares: Array<unknown> } = mockRouter.match(
        "POST",
        STATUS_PAGE_MASTER_PASSWORD_URI,
      );

      expect(registered.middlewares[0]).not.toBe(
        UserMiddleware.getUserMiddleware,
      );
      expect(registered.middlewares[1]).toBe(UserMiddleware.getUserMiddleware);
    });
  });

  describe("attempt budget", () => {
    it("allows a human's worth of attempts and refuses the next", async () => {
      for (let i: number = 0; i < PER_STATUS_PAGE_LIMIT; i++) {
        expect(await attemptStatusPage()).toBe(true);
      }

      expect(await attemptStatusPage()).toBe(false);

      const error: Exception = sendErrorResponseMock.mock
        .calls[0]?.[2] as Exception;

      expect(error.code).toBe(ExceptionCode.TooManyRequestsException);
      expect(error.message.toLowerCase()).toContain("password");
    });

    /*
     * The point of the change: a refused guess never reaches the password
     * hash, so it costs neither a guess nor a scrypt verify.
     */
    it("stops guesses before they reach the password check", async () => {
      for (let i: number = 0; i < PER_STATUS_PAGE_LIMIT; i++) {
        const result: { reachedHandler: boolean; handlerError: unknown } =
          await runLimiterThenHandler();

        expect(result.reachedHandler).toBe(true);
        expect(result.handlerError).toBeInstanceOf(BadDataException);
      }

      expect(verifySpy).toHaveBeenCalledTimes(PER_STATUS_PAGE_LIMIT);

      for (let i: number = 0; i < 20; i++) {
        const result: { reachedHandler: boolean } =
          await runLimiterThenHandler();

        expect(result.reachedHandler).toBe(false);
      }

      expect(verifySpy).toHaveBeenCalledTimes(PER_STATUS_PAGE_LIMIT);
      expect(findOneByIdSpy).toHaveBeenCalledTimes(PER_STATUS_PAGE_LIMIT);
    });

    it("counts per status page", async () => {
      for (let i: number = 0; i < PER_STATUS_PAGE_LIMIT + 5; i++) {
        await attemptStatusPage();
      }

      expect(await attemptStatusPage(ObjectID.generate().toString())).toBe(
        true,
      );
    });

    it("does not let one viewer's guesses lock out another address", async () => {
      for (let i: number = 0; i < PER_STATUS_PAGE_LIMIT + 5; i++) {
        await attemptStatusPage();
      }

      expect(await attemptStatusPage(statusPageId, "198.51.100.4")).toBe(true);
    });

    it("caps an address guessing across many status pages", async () => {
      let allowed: number = 0;

      for (let i: number = 0; i < PER_IP_LIMIT + 10; i++) {
        if (await attemptStatusPage(ObjectID.generate().toString())) {
          allowed++;
        }
      }

      expect(allowed).toBe(PER_IP_LIMIT);
    });
  });

  /*
   * The status page and dashboard password routes share a limiter, not a
   * budget. Guessing at one must not lock viewers out of the other, and
   * must not be able to borrow the other's allowance.
   */
  describe("separation from the dashboard master password route", () => {
    it("is not spent by dashboard password attempts", async () => {
      for (let i: number = 0; i < PER_IP_LIMIT + 10; i++) {
        await runLimiter(DASHBOARD_MASTER_PASSWORD_URI, {
          dashboardId: statusPageId,
        });
      }

      expect(
        await runLimiter(DASHBOARD_MASTER_PASSWORD_URI, {
          dashboardId: statusPageId,
        }),
      ).toBe(false);

      expect(await attemptStatusPage()).toBe(true);
    });

    it("does not spend the dashboard password budget", async () => {
      for (let i: number = 0; i < PER_IP_LIMIT + 10; i++) {
        await attemptStatusPage();
      }

      expect(await attemptStatusPage()).toBe(false);

      expect(
        await runLimiter(DASHBOARD_MASTER_PASSWORD_URI, {
          dashboardId: statusPageId,
        }),
      ).toBe(true);
    });

    it("writes only status page counters", async () => {
      await attemptStatusPage();

      const keys: Array<string> = Array.from(client.counters.keys());

      expect(keys).toHaveLength(2);

      for (const key of keys) {
        expect(key.startsWith("pspage:rl:")).toBe(true);
      }
    });
  });

  describe("when Redis is unavailable", () => {
    beforeEach(() => {
      isConnectedMock.mockReturnValue(false);
    });

    /*
     * Fails closed: without the counter there is no bound on guessing, so the
     * route refuses rather than serving unthrottled.
     */
    it("refuses attempts with a 503 and never checks the password", async () => {
      const result: { reachedHandler: boolean } = await runLimiterThenHandler();

      expect(result.reachedHandler).toBe(false);
      expect(verifySpy).not.toHaveBeenCalled();

      const error: Exception = sendErrorResponseMock.mock
        .calls[0]?.[2] as Exception;

      expect(error.code).toBe(ExceptionCode.ServiceUnavailableException);
    });
  });
});
