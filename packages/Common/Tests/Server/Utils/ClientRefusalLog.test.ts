import ClientRefusalLog, {
  CLIENT_REFUSAL_LOG_INTERVAL_MS,
  ClientRefusalCounter,
  MAX_CLIENT_REFUSAL_ROUTES,
  OTHER_CLIENT_REFUSAL_ROUTES,
  isClientErrorStatus,
  isClientRefusal,
} from "../../../Server/Utils/ClientRefusalLog";
import { ExpressRequest } from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import StatusCode from "../../../Types/API/StatusCode";
import APIException from "../../../Types/Exception/ApiException";
import BadDataException from "../../../Types/Exception/BadDataException";
import BadRequestException from "../../../Types/Exception/BadRequestException";
import ConflictException from "../../../Types/Exception/ConflictException";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import NameTakenException from "../../../Types/Exception/NameTakenException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import PayloadTooLargeException from "../../../Types/Exception/PayloadTooLargeException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ProjectBlockedException from "../../../Types/Exception/ProjectBlockedException";
import QueryTimeoutException from "../../../Types/Exception/QueryTimeoutException";
import ServerException from "../../../Types/Exception/ServerException";
import ServiceUnavailableException from "../../../Types/Exception/ServiceUnavailableException";
import SSOAuthorizationException from "../../../Types/Exception/SsoAuthorizationException";
import TenantNotFoundException from "../../../Types/Exception/TenantNotFoundException";
import TimeoutException from "../../../Types/Exception/TimeoutException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import UnableToReachServer from "../../../Types/Exception/UnableToReachServer";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHICH REFUSALS ARE A CLIENT'S, AND HOW EACH IS LOGGED (#10768).
 *
 * Response.sendErrorResponse and the Express error handler logged every
 * error they answered at error level, from any client. A 4xx whose
 * Exception declares the fault the client's, in words, is now logged at
 * debug and counted by its route, with a warn line a minute a route; every
 * 5xx, and every 4xx that is not the client's fault, stays at error. No
 * real fault of the server's may be logged below error.
 */

// As sendErrorResponse and the error handler answer an Exception.
const statusOf: (error: Exception) => number = (error: Exception): number => {
  return StatusCode.isValidStatusCode(error.code) ? error.code : 500;
};

type Case = [string, Exception];

const CLIENTS: Array<Case> = [
  ["BadDataException", new BadDataException("The query is malformed.")],
  ["BadRequestException", new BadRequestException("The batch is empty.")],
  [
    "NotAuthenticatedException",
    new NotAuthenticatedException("Invalid Probe ID or Probe Key"),
  ],
  [
    "PaymentRequiredException",
    new PaymentRequiredException("Add a payment method."),
  ],
  ["ForbiddenException", new ForbiddenException("You may not do this.")],
  ["ProjectBlockedException", new ProjectBlockedException()],
  ["NotFoundException", new NotFoundException("Page not found - /nowhere")],
  [
    "TenantNotFoundException",
    new TenantNotFoundException("No project has this ID."),
  ],
  ["SSOAuthorizationException", new SSOAuthorizationException()],
  ["ConflictException", new ConflictException("The record changed.")],
  [
    "PayloadTooLargeException",
    new PayloadTooLargeException("The file is too large."),
  ],
  [
    "NotAuthorizedException",
    new NotAuthorizedException("This key has been disabled."),
  ],
  [
    "TooManyRequestsException",
    new TooManyRequestsException("Too many wrong keys. Try again later."),
  ],
  [
    "NameTakenException",
    new NameTakenException("A monitor with this name already exists."),
  ],
  [
    "a BadDataException a site declared a user error",
    new BadDataException("The value is wrong.").asUserError(),
  ],
  [
    "a base Exception a site declared an expected denial",
    new Exception(
      ExceptionCode.ForbiddenException,
      "This is refused.",
    ).asExpectedDenial(),
  ],
];

const NOT_CLIENTS: Array<Case> = [
  ["ServerException", new ServerException("The queue is down.")],
  [
    "DatabaseNotConnectedException",
    new DatabaseNotConnectedException("The database is not connected."),
  ],
  [
    "ServiceUnavailableException",
    new ServiceUnavailableException("Try again in a minute."),
  ],
  [
    "QueryTimeoutException (504)",
    new QueryTimeoutException("The query took too long."),
  ],
  [
    "APIException, whose code is no status (500)",
    new APIException("The LLM provider did not answer."),
  ],
  // 4xx codes, and the server's fault all the same.
  [
    "TimeoutException (408), infrastructure",
    new TimeoutException("The SMTP server did not answer."),
  ],
  [
    "UnableToReachServer (415), infrastructure",
    new UnableToReachServer("Slack could not be reached."),
  ],
  [
    "a base Exception with a 4xx code, which no class declares the client's",
    new Exception(ExceptionCode.NotFoundException, "No such row."),
  ],
  [
    "a BadDataException a site declared a code fault",
    new BadDataException("An invariant broke.").asCodeFault(),
  ],
  [
    "a BadDataException a site declared infrastructure",
    new BadDataException("The cache is full.").asInfrastructure(),
  ],
  [
    "a 5xx a site declared a user error",
    new ServerException("Declared wrongly.").asUserError(),
  ],
  // A refusal the server could not put into words is the server's to fix.
  ["a BadDataException with no words", new BadDataException("")],
  [
    'a BadDataException saying only "Server Error"',
    new BadDataException("Server Error"),
  ],
];

beforeEach(() => {
  for (const level of ["error", "warn", "info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {});
  }

  ClientRefusalLog.counter.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("isClientRefusal", () => {
  test.each(CLIENTS)(
    "%s, answered 4xx, is a client's refusal",
    (_what: string, error: Exception) => {
      expect(isClientErrorStatus(statusOf(error))).toBe(true);
      expect(isClientRefusal(error, statusOf(error))).toBe(true);
    },
  );

  test.each(NOT_CLIENTS)(
    "%s is not: it stays at error",
    (_what: string, error: Exception) => {
      expect(isClientRefusal(error, statusOf(error))).toBe(false);
    },
  );

  test("a client's Exception answered with a 5xx is not a client's refusal", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(
        isClientRefusal(new BadDataException("The query is malformed."), status),
      ).toBe(false);
    }
  });

  test("no 1xx, 2xx or 3xx is a refusal, nor a status that is none", () => {
    for (const status of [100, 200, 204, 301, 304, 399, 0, -1, 400.5, NaN]) {
      expect({ status, refusal: isClientErrorStatus(status) }).toEqual({
        status,
        refusal: false,
      });
    }

    for (const status of [400, 404, 418, 422, 429, 499]) {
      expect(isClientErrorStatus(status)).toBe(true);
    }
  });

  test("an error that is no Exception - a TypeError, another service's answer - is no client's", () => {
    expect(isClientRefusal(new TypeError("x is undefined"), 400)).toBe(false);
    expect(
      isClientRefusal(
        Object.assign(new Error("refused"), { status: 400, statusCode: 400 }),
        400,
      ),
    ).toBe(false);
    expect(isClientRefusal("a thrown string", 400)).toBe(false);
    expect(isClientRefusal(null, 400)).toBe(false);
    expect(
      isClientRefusal({ message: "an object", errorClass: "user-error" }, 400),
    ).toBe(false);
  });

  test("an error that crossed a process with its class as a plain field keeps it", () => {
    expect(
      isClientRefusal(
        Object.assign(new Error("Refused upstream."), {
          errorClass: "expected-denial",
        }),
        403,
      ),
    ).toBe(true);
  });

  test("with fault classification switched off, every error stays at error", () => {
    const saved: NodeJS.ProcessEnv = { ...process.env };

    process.env["TELEMETRY_ERROR_CLASS_ENABLED"] = "false";

    try {
      jest.isolateModules(() => {
        const reloaded: {
          isClientRefusal: (error: unknown, status: number) => boolean;
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        } = require("../../../Server/Utils/ClientRefusalLog");

        for (const [, error] of CLIENTS) {
          expect(reloaded.isClientRefusal(error, statusOf(error))).toBe(false);
        }
      });
    } finally {
      process.env = saved;
    }
  });
});

describe("ClientRefusalCounter", () => {
  let now: number;
  let counter: ClientRefusalCounter;

  const START: number = Date.parse("2026-11-23T10:00:00.000Z");

  const warnLines: () => Array<string> = (): Array<string> => {
    return (logger.warn as unknown as jest.Mock).mock.calls.map(
      (call: Array<unknown>): string => {
        return String(call[0]);
      },
    );
  };

  beforeEach(() => {
    now = START;
    counter = new ClientRefusalCounter((): number => {
      return now;
    });
  });

  test("the first refusal on a route is logged at warn, with its words", () => {
    counter.record({
      route: "POST /probe/response/ingest",
      status: 400,
      message: "Invalid Probe ID or Probe Key",
      attributes: { requestId: "r-1" },
    });

    expect(warnLines()).toEqual([
      'Refused 1 request from a client (POST /probe/response/ingest 400) with "Invalid Probe ID or Probe Key". Each such refusal is logged at debug; these counts at most once a minute for each route.',
    ]);
    expect((logger.warn as unknown as jest.Mock).mock.calls[0]![1]).toEqual({
      requestId: "r-1",
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("the rest of the minute is counted; the first after it is logged with the count since the last line", () => {
    const route: string = "POST /probe/response/ingest";

    for (let index: number = 0; index < 50; index++) {
      now = START + index * 1000;
      counter.record({ route, status: 400, message: "Invalid key" });
    }

    expect(warnLines()).toHaveLength(1);
    expect(Object.fromEntries(counter.getCounts())).toEqual({
      [`${route} 400`]: 49,
    });

    now = START + CLIENT_REFUSAL_LOG_INTERVAL_MS;
    counter.record({ route, status: 400, message: "Invalid key, again" });

    expect(warnLines()).toEqual([
      expect.any(String),
      `Refused 50 requests from clients (${route} 400) since 2026-11-23T10:00:00.000Z, the last with "Invalid key, again". Each such refusal is logged at debug; these counts at most once a minute for each route.`,
    ]);
    expect(counter.getCounts().size).toBe(0);
  });

  test("each route and status has a minute of its own", () => {
    counter.record({ route: "POST /a", status: 401, message: "No key." });
    counter.record({ route: "POST /b", status: 401, message: "No key." });
    counter.record({ route: "POST /a", status: 403, message: "Not yours." });
    counter.record({ route: "POST /a", status: 401, message: "No key." });
    counter.record({ route: "GET /a", status: 401, message: "No key." });

    expect(warnLines()).toHaveLength(4);
    expect(Object.fromEntries(counter.getCounts())).toEqual({
      "POST /a 401": 1,
    });
  });

  test("a flood over many routes for an hour is at most a line a minute a route", () => {
    const random: SeededRandom = seededRandom(10768);
    const routes: Array<string> = Array.from(
      { length: 20 },
      (_: unknown, index: number): string => {
        return `POST /route/${index}`;
      },
    );
    let refusals: number = 0;

    for (let second: number = 0; second < 3600; second++) {
      now = START + second * 1000;

      for (let burst: number = random(30); burst > 0; burst--) {
        counter.record({
          route: routes[random(routes.length)]!,
          status: 400 + random(2),
          message: "Refused.",
        });
        refusals++;
      }
    }

    // Routes times statuses times the hour's minutes, at most.
    expect(warnLines().length).toBeLessThanOrEqual(20 * 2 * 60);
    expect(warnLines().length).toBeLessThan(refusals / 10);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test(`holds at most ${MAX_CLIENT_REFUSAL_ROUTES} routes; the rest are counted, and logged, together`, () => {
    for (
      let index: number = 0;
      index < MAX_CLIENT_REFUSAL_ROUTES + 300;
      index++
    ) {
      counter.record({
        route: `GET /page/${index}`,
        status: 404,
        message: "Page not found.",
      });
    }

    // One line for each route held, and one for the rest, together.
    expect(warnLines()).toHaveLength(MAX_CLIENT_REFUSAL_ROUTES + 1);
    expect(warnLines()[MAX_CLIENT_REFUSAL_ROUTES]).toContain(
      `(${OTHER_CLIENT_REFUSAL_ROUTES})`,
    );
    expect(Object.fromEntries(counter.getCounts())).toEqual({
      [OTHER_CLIENT_REFUSAL_ROUTES]: 299,
    });
  });

  test("repeats no more than 300 characters of a refusal's words", () => {
    counter.record({
      route: "GET *",
      status: 404,
      message: `Page not found - /${"a".repeat(5000)}`,
    });

    const line: string = warnLines()[0]!;

    expect(line).toContain(`Page not found - /${"a".repeat(282)}…"`);
    expect(line.length).toBeLessThan(500);
  });

  test("never throws, even when the log does", () => {
    (logger.warn as unknown as jest.Mock).mockImplementation((): void => {
      throw new Error("the sink is gone");
    });

    expect(() => {
      counter.record({ route: "POST /a", status: 400, message: "Refused." });
    }).not.toThrow();
  });

  test("clear forgets every count and every minute", () => {
    counter.record({ route: "POST /a", status: 400, message: "Refused." });
    counter.record({ route: "POST /a", status: 400, message: "Refused." });
    counter.clear();
    counter.record({ route: "POST /a", status: 400, message: "Refused." });

    expect(warnLines()).toHaveLength(2);
    expect(counter.getCounts().size).toBe(0);
  });
});

describe("ClientRefusalLog", () => {
  const request: (data: {
    method?: string;
    baseUrl?: string;
    route?: unknown;
  }) => ExpressRequest = (data: {
    method?: string;
    baseUrl?: string;
    route?: unknown;
  }): ExpressRequest => {
    return {
      method: data.method,
      baseUrl: data.baseUrl,
      route: data.route,
      headers: {},
      requestId: "4f1c2d3e-0000-4000-8000-000000000000",
    } as unknown as ExpressRequest;
  };

  test("counts a request under its method and route template, as the request metrics name it", () => {
    expect(
      ClientRefusalLog.routeOf(
        request({
          method: "post",
          baseUrl: "/probe-ingest",
          route: { path: "/probe/response/ingest" },
        }),
      ),
    ).toBe("POST /probe-ingest/probe/response/ingest");
    expect(
      ClientRefusalLog.routeOf(
        request({ method: "GET", route: { path: "/api/monitor/:id" } }),
      ),
    ).toBe("GET /api/monitor/:id");
    // A route Express matched by a pattern that is no text is none of these.
    expect(
      ClientRefusalLog.routeOf(
        request({ method: "GET", route: { path: /\/x/ } }),
      ),
    ).toBe("GET (no route)");
    expect(ClientRefusalLog.routeOf(request({ method: "DELETE" }))).toBe(
      "DELETE (no route)",
    );
    expect(ClientRefusalLog.routeOf(request({}))).toBe("- (no route)");
  });

  test("logs a refusal at debug, with the request's ids, counts it by route, and warns once", () => {
    const refusal: BadDataException = new BadDataException(
      "Invalid Probe ID or Probe Key",
    );
    const req: ExpressRequest = request({
      method: "POST",
      route: { path: "/probe/response/ingest" },
    });

    for (let index: number = 0; index < 25; index++) {
      ClientRefusalLog.log(req, refusal, 400);
    }

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledTimes(25);
    expect(logger.debug).toHaveBeenCalledWith(refusal, {
      requestId: "4f1c2d3e-0000-4000-8000-000000000000",
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(ClientRefusalLog.counter.getCounts())).toEqual({
      "POST /probe/response/ingest 400": 24,
    });
  });

  test("never throws: a logger mocked without debug or warn answers the request all the same", () => {
    (logger as unknown as Record<string, unknown>)["debug"] = undefined;
    (logger as unknown as Record<string, unknown>)["warn"] = undefined;

    try {
      expect(() => {
        ClientRefusalLog.log(
          request({ method: "POST" }),
          new BadDataException("Refused."),
          400,
        );
      }).not.toThrow();
    } finally {
      jest.restoreAllMocks();
    }
  });
});
