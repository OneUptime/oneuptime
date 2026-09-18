import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The limiter in front of the license server's two anonymous routes,
 * POST /enterprise-license/validate and POST /enterprise-license/report-user-count.
 *
 * What matters:
 *   - both a per-(license key, address) and a per-address ceiling, per route;
 *   - the license key never lands in Redis (or a log) in the clear;
 *   - the window does not slide under sustained load;
 *   - a refused request gets 429 with Retry-After and never reaches the handler;
 *   - Redis being down lets requests THROUGH (daily reports must not fail on a
 *     Redis blip), unlike the sign-in limiter.
 */

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
    },
  };
});

import Redis from "Common/Server/Infrastructure/Redis";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import LicenseServerRateLimit, {
  LicenseServerRateLimitBucket,
  LicenseServerRateLimitBucketConfig,
  LicenseServerRateLimitDecision,
  LicenseServerRateLimitOutcome,
  LicenseServerRateLimitScope,
} from "../../../Server/LicenseServer/LicenseServerRateLimit";
import { collectLoggedText } from "./LicenseServerTestKit";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;
const loggerWarnMock: MockedFn = logger.warn as unknown as MockedFn;

const WINDOW_SECONDS: number = 15 * 60;
const LICENSE_KEY: string = "0f9e8d7c6b5a49382716a5b4c3d2e1f0acme";
const CLIENT_IP: string = "203.0.113.7";

interface RecordedExpire {
  key: string;
  ttlSeconds: number;
}

type QueuedCommand = () => [Error | null, unknown];

// Behaves like a Redis counter store: INCR increments, EXPIRE records a TTL.
class FakeRedisClient {
  public counters: Map<string, number> = new Map();
  public expires: Array<RecordedExpire> = [];
  public failNextExec: Error | null = null;

  public pipeline(): FakePipeline {
    return new FakePipeline(this);
  }
}

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

  public expire(key: string, ttlSeconds: number): FakePipeline {
    this.commands.push((): [Error | null, unknown] => {
      this.client.expires.push({ key, ttlSeconds });
      return [null, 1];
    });

    return this;
  }

  public async exec(): Promise<unknown> {
    if (this.client.failNextExec) {
      const error: Error = this.client.failNextExec;
      this.client.failNextExec = null;
      throw error;
    }

    return this.commands.map((command: QueuedCommand) => {
      return command();
    });
  }
}

const buildRequest: (data?: {
  licenseKey?: unknown;
  socketAddress?: string | undefined;
}) => ExpressRequest = (data?: {
  licenseKey?: unknown;
  socketAddress?: string | undefined;
}): ExpressRequest => {
  return {
    body:
      data && "licenseKey" in data
        ? { licenseKey: data.licenseKey }
        : { licenseKey: LICENSE_KEY },
    headers: {},
    socket: { remoteAddress: data?.socketAddress || CLIENT_IP },
  } as unknown as ExpressRequest;
};

interface BuiltResponse {
  response: ExpressResponse;
  headers: Record<string, string>;
}

const buildResponse: () => BuiltResponse = (): BuiltResponse => {
  const headers: Record<string, string> = {};

  return {
    response: {
      setHeader: (name: string, value: string): void => {
        headers[name] = value;
      },
    } as unknown as ExpressResponse,
    headers,
  };
};

const RATE_LIMIT_ENV_KEYS: Array<string> = [
  "ENTERPRISE_LICENSE_VALIDATE_RATE_LIMIT_WINDOW_SECONDS",
  "ENTERPRISE_LICENSE_VALIDATE_RATE_LIMIT_PER_LICENSE_KEY_PER_WINDOW",
  "ENTERPRISE_LICENSE_VALIDATE_RATE_LIMIT_PER_IP_PER_WINDOW",
  "ENTERPRISE_LICENSE_REPORT_USER_COUNT_RATE_LIMIT_WINDOW_SECONDS",
  "ENTERPRISE_LICENSE_REPORT_USER_COUNT_RATE_LIMIT_PER_LICENSE_KEY_PER_WINDOW",
  "ENTERPRISE_LICENSE_REPORT_USER_COUNT_RATE_LIMIT_PER_IP_PER_WINDOW",
];

describe("LicenseServerRateLimit", () => {
  let client: FakeRedisClient;
  let currentTime: number;

  const consume: (data?: {
    bucket?: LicenseServerRateLimitBucket;
    licenseKey?: unknown;
    socketAddress?: string;
  }) => Promise<LicenseServerRateLimitDecision> = async (data?: {
    bucket?: LicenseServerRateLimitBucket;
    licenseKey?: unknown;
    socketAddress?: string;
  }): Promise<LicenseServerRateLimitDecision> => {
    const request: ExpressRequest = buildRequest(
      data && "licenseKey" in data
        ? { licenseKey: data.licenseKey, socketAddress: data.socketAddress }
        : { socketAddress: data?.socketAddress },
    );

    return await LicenseServerRateLimit.consume({
      bucket: data?.bucket || LicenseServerRateLimitBucket.Validate,
      licenseKeyHash: LicenseServerRateLimit.resolveLicenseKeyHash(request),
      clientIp: LicenseServerRateLimit.resolveClientIp(request),
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    LicenseServerRateLimit.resetForTests();

    for (const key of RATE_LIMIT_ENV_KEYS) {
      delete process.env[key];
    }

    client = new FakeRedisClient();
    getClientMock.mockReturnValue(client);
    isConnectedMock.mockReturnValue(true);

    currentTime = 1_700_000_000_000;
    currentTime = currentTime - (currentTime % (WINDOW_SECONDS * 1000));
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return currentTime;
    });
  });

  afterEach(() => {
    for (const key of RATE_LIMIT_ENV_KEYS) {
      delete process.env[key];
    }

    jest.restoreAllMocks();
  });

  describe("budgets", () => {
    test("ships generous defaults for both routes", () => {
      expect(
        LicenseServerRateLimit.getBucketConfig(
          LicenseServerRateLimitBucket.Validate,
        ),
      ).toEqual({
        windowSeconds: 900,
        perLicenseKeyLimit: 30,
        perIpLimit: 120,
      });
      expect(
        LicenseServerRateLimit.getBucketConfig(
          LicenseServerRateLimitBucket.ReportUserCount,
        ),
      ).toEqual({
        windowSeconds: 900,
        perLicenseKeyLimit: 150,
        perIpLimit: 300,
      });
    });

    test("each number can be tuned from the environment; junk falls back to the default", () => {
      process.env["ENTERPRISE_LICENSE_VALIDATE_RATE_LIMIT_WINDOW_SECONDS"] =
        "60";
      process.env[
        "ENTERPRISE_LICENSE_VALIDATE_RATE_LIMIT_PER_LICENSE_KEY_PER_WINDOW"
      ] = "5";
      process.env["ENTERPRISE_LICENSE_VALIDATE_RATE_LIMIT_PER_IP_PER_WINDOW"] =
        "-3";

      const config: LicenseServerRateLimitBucketConfig =
        LicenseServerRateLimit.getBucketConfig(
          LicenseServerRateLimitBucket.Validate,
        );

      expect(config).toEqual({
        windowSeconds: 60,
        perLicenseKeyLimit: 5,
        perIpLimit: 120,
      });
    });
  });

  describe("keys", () => {
    test("hashes the license key - it never appears in a Redis key", async () => {
      await consume();

      const keys: Array<string> = Array.from(client.counters.keys());

      expect(keys).toHaveLength(2);

      for (const key of keys) {
        expect(key).not.toContain(LICENSE_KEY);
        expect(key.startsWith("license-server:rl:validate:")).toBe(true);
      }

      expect(
        LicenseServerRateLimit.resolveLicenseKeyHash(buildRequest()),
      ).toMatch(/^[0-9a-f]{32}$/);
    });

    test("treats surrounding whitespace as the same key (the handler trims it)", () => {
      expect(
        LicenseServerRateLimit.resolveLicenseKeyHash(
          buildRequest({ licenseKey: `  ${LICENSE_KEY}\n` }),
        ),
      ).toBe(LicenseServerRateLimit.resolveLicenseKeyHash(buildRequest()));
    });

    test.each([
      ["missing", undefined],
      ["blank", "   "],
      ["not a string", { nested: true }],
    ])(
      "puts a %s license key in the shared 'none' bucket",
      (_label: string, licenseKey: unknown) => {
        expect(
          LicenseServerRateLimit.resolveLicenseKeyHash(
            buildRequest({ licenseKey }),
          ),
        ).toBe("none");
      },
    );

    test("bills the transport peer, and 'unknown' when there is none", () => {
      expect(LicenseServerRateLimit.resolveClientIp(buildRequest())).toBe(
        CLIENT_IP,
      );
      expect(
        LicenseServerRateLimit.resolveClientIp({
          headers: {},
          socket: {},
        } as unknown as ExpressRequest),
      ).toBe("unknown");
    });

    test("keeps the two routes' counters apart", async () => {
      await consume({ bucket: LicenseServerRateLimitBucket.Validate });
      await consume({ bucket: LicenseServerRateLimitBucket.ReportUserCount });

      const keys: Array<string> = Array.from(client.counters.keys());

      expect(
        keys.filter((key: string) => {
          return key.includes(":validate:");
        }),
      ).toHaveLength(2);
      expect(
        keys.filter((key: string) => {
          return key.includes(":report-user-count:");
        }),
      ).toHaveLength(2);
    });
  });

  describe("limits", () => {
    test("allows up to the per-license-key limit from one address, then refuses", async () => {
      for (let attempt: number = 1; attempt <= 30; attempt++) {
        expect((await consume()).outcome).toBe(
          LicenseServerRateLimitOutcome.Allowed,
        );
      }

      const refused: LicenseServerRateLimitDecision = await consume();

      expect(refused.outcome).toBe(LicenseServerRateLimitOutcome.RateLimited);
      expect(refused.scope).toBe(LicenseServerRateLimitScope.LicenseKey);
      expect(refused.isFirstRejectionInWindow).toBe(true);
      expect(refused.retryAfterSeconds).toBe(WINDOW_SECONDS);

      const refusedAgain: LicenseServerRateLimitDecision = await consume();

      expect(refusedAgain.isFirstRejectionInWindow).toBe(false);
    });

    test("rotating license keys still runs into the per-address ceiling", async () => {
      for (let attempt: number = 1; attempt <= 120; attempt++) {
        expect(
          (await consume({ licenseKey: `probe-${attempt}` })).outcome,
        ).toBe(LicenseServerRateLimitOutcome.Allowed);
      }

      const refused: LicenseServerRateLimitDecision = await consume({
        licenseKey: "probe-121",
      });

      expect(refused.outcome).toBe(LicenseServerRateLimitOutcome.RateLimited);
      expect(refused.scope).toBe(LicenseServerRateLimitScope.Ip);
    });

    test("another address has its own budget", async () => {
      for (let attempt: number = 1; attempt <= 31; attempt++) {
        await consume();
      }

      expect((await consume({ socketAddress: "198.51.100.23" })).outcome).toBe(
        LicenseServerRateLimitOutcome.Allowed,
      );
    });

    test("the daily report has the larger budget", async () => {
      for (let attempt: number = 1; attempt <= 150; attempt++) {
        expect(
          (
            await consume({
              bucket: LicenseServerRateLimitBucket.ReportUserCount,
            })
          ).outcome,
        ).toBe(LicenseServerRateLimitOutcome.Allowed);
      }

      expect(
        (
          await consume({
            bucket: LicenseServerRateLimitBucket.ReportUserCount,
          })
        ).outcome,
      ).toBe(LicenseServerRateLimitOutcome.RateLimited);
    });

    test("sets the expiry only when a counter is created, so the window never slides", async () => {
      for (let attempt: number = 1; attempt <= 5; attempt++) {
        await consume();
      }

      expect(client.expires).toHaveLength(2);

      for (const recorded of client.expires) {
        expect(recorded.ttlSeconds).toBe(WINDOW_SECONDS * 2);
      }
    });

    test("a new window starts a fresh budget", async () => {
      for (let attempt: number = 1; attempt <= 31; attempt++) {
        await consume();
      }

      currentTime += WINDOW_SECONDS * 1000;

      expect((await consume()).outcome).toBe(
        LicenseServerRateLimitOutcome.Allowed,
      );
    });
  });

  describe("when Redis is unavailable", () => {
    test("reports the counter unavailable when there is no client", async () => {
      getClientMock.mockReturnValue(null);

      expect((await consume()).outcome).toBe(
        LicenseServerRateLimitOutcome.CounterUnavailable,
      );
    });

    test("reports the counter unavailable when the pipeline fails, and logs it once per interval", async () => {
      client.failNextExec = new Error("connection reset");
      expect((await consume()).outcome).toBe(
        LicenseServerRateLimitOutcome.CounterUnavailable,
      );

      client.failNextExec = new Error("connection reset");
      await consume();

      expect(
        loggerWarnMock.mock.calls.filter((call: Array<unknown>) => {
          return String(call[0]).includes("counter failed");
        }),
      ).toHaveLength(1);
    });
  });

  describe("middleware", () => {
    test("is one stable function per route, so a route's middleware list is fixed", () => {
      expect(
        LicenseServerRateLimit.getMiddleware(
          LicenseServerRateLimitBucket.Validate,
        ),
      ).toBe(
        LicenseServerRateLimit.getMiddleware(
          LicenseServerRateLimitBucket.Validate,
        ),
      );
      expect(
        LicenseServerRateLimit.getMiddleware(
          LicenseServerRateLimitBucket.Validate,
        ),
      ).not.toBe(
        LicenseServerRateLimit.getMiddleware(
          LicenseServerRateLimitBucket.ReportUserCount,
        ),
      );
    });

    test("lets an allowed request through to the handler", async () => {
      const next: NextFunction = jest.fn() as unknown as NextFunction;

      await LicenseServerRateLimit.getMiddleware(
        LicenseServerRateLimitBucket.Validate,
      )(buildRequest(), buildResponse().response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(sendErrorResponseMock).not.toHaveBeenCalled();
    });

    test("answers 429 with Retry-After, and never calls the handler, once over the limit", async () => {
      const middleware: ReturnType<
        typeof LicenseServerRateLimit.getMiddleware
      > = LicenseServerRateLimit.getMiddleware(
        LicenseServerRateLimitBucket.Validate,
      );

      for (let attempt: number = 1; attempt <= 30; attempt++) {
        await middleware(
          buildRequest(),
          buildResponse().response,
          jest.fn() as unknown as NextFunction,
        );
      }

      const next: NextFunction = jest.fn() as unknown as NextFunction;
      const built: BuiltResponse = buildResponse();

      await middleware(buildRequest(), built.response, next);

      expect(next).not.toHaveBeenCalled();
      expect(sendErrorResponseMock).toHaveBeenCalledTimes(1);

      const exception: Exception = sendErrorResponseMock.mock
        .calls[0]?.[2] as Exception;

      expect(exception.code).toBe(ExceptionCode.TooManyRequestsException);
      expect(built.headers["Retry-After"]).toBe(String(WINDOW_SECONDS));
    });

    test("logs the first refusal in a window - by address, never with the license key", async () => {
      const middleware: ReturnType<
        typeof LicenseServerRateLimit.getMiddleware
      > = LicenseServerRateLimit.getMiddleware(
        LicenseServerRateLimitBucket.Validate,
      );

      for (let attempt: number = 1; attempt <= 33; attempt++) {
        await middleware(
          buildRequest(),
          buildResponse().response,
          jest.fn() as unknown as NextFunction,
        );
      }

      const refusals: Array<Array<unknown>> = loggerWarnMock.mock.calls.filter(
        (call: Array<unknown>) => {
          return String(call[0]).includes("rejecting");
        },
      );

      expect(refusals).toHaveLength(1);
      expect(String(refusals[0]?.[0])).toContain(CLIENT_IP);
      expect(collectLoggedText([loggerWarnMock])).not.toContain(LICENSE_KEY);
    });

    test("fails OPEN: with Redis down the request still reaches the handler", async () => {
      getClientMock.mockReturnValue(null);

      const next: NextFunction = jest.fn() as unknown as NextFunction;

      await LicenseServerRateLimit.getMiddleware(
        LicenseServerRateLimitBucket.ReportUserCount,
      )(buildRequest(), buildResponse().response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(sendErrorResponseMock).not.toHaveBeenCalled();
      expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    });
  });
});
