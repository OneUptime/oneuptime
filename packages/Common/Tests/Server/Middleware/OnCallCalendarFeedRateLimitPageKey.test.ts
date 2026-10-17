import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The calendar rate limiter keyed by something other than a token in the
 * path: a status page's maintenance calendar is named by the page (its id or
 * its own domain), and StatusPageMaintenanceCalendarFeed hands the limiter a
 * key for it. The key reaches Redis through the same sanitizer as every
 * other segment, and a route that passes no key keeps the token behaviour.
 */

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
      sendErrorResponse: jest.fn(),
    },
  };
});

import Response from "../../../Server/Utils/Response";
import OnCallCalendarFeedRateLimit, {
  OnCallCalendarFeedRateLimitOutcome,
  OnCallCalendarFeedRateLimitScope,
} from "../../../Server/Middleware/OnCallCalendarFeedRateLimit";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Exception from "../../../Types/Exception/Exception";
import { randomBytes } from "crypto";

type ConsumeArgs = { tokenKey: string; clientIp: string };

const TOKEN: string = randomBytes(32).toString("base64url");

function buildRequest(data: {
  token?: string | undefined;
  hostname?: string | undefined;
}): ExpressRequest {
  return {
    params: data.token ? { token: data.token } : {},
    headers: { "x-forwarded-for": "203.0.113.7" },
    hostname: data.hostname,
    socket: { remoteAddress: "203.0.113.7" },
  } as unknown as ExpressRequest;
}

function buildResponse(): {
  response: ExpressResponse;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};

  return {
    response: {
      set: (key: string, value: string): void => {
        headers[key] = value;
      },
      setHeader: (key: string, value: string): void => {
        headers[key] = value;
      },
    } as unknown as ExpressResponse,
    headers,
  };
}

let consumeSpy: jest.SpiedFunction<typeof OnCallCalendarFeedRateLimit.consume>;

beforeEach(() => {
  consumeSpy = jest
    .spyOn(OnCallCalendarFeedRateLimit, "consume")
    .mockResolvedValue({
      outcome: OnCallCalendarFeedRateLimitOutcome.Allowed,
    } as Awaited<ReturnType<typeof OnCallCalendarFeedRateLimit.consume>>);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

async function run(
  middleware: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>,
  request: ExpressRequest,
): Promise<{ nextCalled: boolean; headers: Record<string, string> }> {
  const { response, headers } = buildResponse();
  let nextCalled: boolean = false;

  await middleware(request, response, (() => {
    nextCalled = true;
  }) as unknown as NextFunction);

  return { nextCalled, headers };
}

function consumedWith(): ConsumeArgs {
  return consumeSpy.mock.calls[0]?.[0] as unknown as ConsumeArgs;
}

describe("OnCallCalendarFeedRateLimit.getMiddleware with resolveTokenKey", () => {
  test("counts the request under the key the route resolves, not a token", async () => {
    const result: { nextCalled: boolean } = await run(
      OnCallCalendarFeedRateLimit.getMiddleware({
        resolveTokenKey: (): string => {
          return "s:0123456789abcdef";
        },
      }),
      buildRequest({ hostname: "status.example.com" }),
    );

    expect(result.nextCalled).toBe(true);
    expect(consumedWith().tokenKey).toBe("s:0123456789abcdef");
    expect(consumedWith().clientIp).toBe("203.0.113.7");
  });

  test("the resolved key goes through the same sanitizer as every key segment", async () => {
    await run(
      OnCallCalendarFeedRateLimit.getMiddleware({
        resolveTokenKey: (): string => {
          return "status page/with spaces\r\n*";
        },
      }),
      buildRequest({ hostname: "status.example.com" }),
    );

    expect(consumedWith().tokenKey).toBe(
      OnCallCalendarFeedRateLimit.sanitizeKeySegment(
        "status page/with spaces\r\n*",
      ),
    );
    expect(consumedWith().tokenKey).toBe("status_page_with_spaces___");
  });

  test("a route that passes no key keeps keying by the token in its path", async () => {
    await run(
      OnCallCalendarFeedRateLimit.getMiddleware(),
      buildRequest({ token: TOKEN }),
    );

    expect(consumedWith().tokenKey).toBe(
      OnCallCalendarFeedRateLimit.resolveTokenKey(
        buildRequest({ token: TOKEN }),
      ),
    );
    expect(consumedWith().tokenKey).not.toContain(TOKEN);
  });

  test("a page over its budget is refused with 429 before the route runs", async () => {
    consumeSpy.mockResolvedValue({
      outcome: OnCallCalendarFeedRateLimitOutcome.RateLimited,
      scope: OnCallCalendarFeedRateLimitScope.Token,
      retryAfterSeconds: 42,
      isFirstRejectionInWindow: true,
    } as Awaited<ReturnType<typeof OnCallCalendarFeedRateLimit.consume>>);

    const result: { nextCalled: boolean; headers: Record<string, string> } =
      await run(
        OnCallCalendarFeedRateLimit.getMiddleware({
          resolveTokenKey: (): string => {
            return "s:0123456789abcdef";
          },
        }),
        buildRequest({ hostname: "status.example.com" }),
      );

    expect(result.nextCalled).toBe(false);
    expect(result.headers["Retry-After"]).toBe("42");

    const sendErrorResponse: jest.Mock =
      Response.sendErrorResponse as unknown as jest.Mock;
    const error: Exception = sendErrorResponse.mock.calls[0]?.[2] as Exception;

    expect(error.code).toBe(429);
  });
});
