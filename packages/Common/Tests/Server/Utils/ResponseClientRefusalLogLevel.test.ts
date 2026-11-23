import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ClientRefusalLog from "../../../Server/Utils/ClientRefusalLog";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import ResponseUtil from "../../../Server/Utils/Response";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ServerException from "../../../Types/Exception/ServerException";
import TimeoutException from "../../../Types/Exception/TimeoutException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";

/*
 * A REFUSAL OF WHAT THE CLIENT SENT IS LOGGED AT DEBUG (#10703, #10768).
 *
 * sendErrorResponse and the Express error handler logged every error they
 * answered at error level. A client that keeps sending what is refused - a
 * wrong key, a malformed query, a page that is not there - wrote an error-
 * level line a request at the default LOG_LEVEL=ERROR, filling the log
 * sink and raising error alerts at no cost to itself. Now:
 *
 *   - a 4xx whose Exception declares the fault the client's is logged at
 *     debug and counted by its route, the first of each minute on a route
 *     at warn (ClientRefusalLog);
 *   - a refusal its caller marks (isClientRefusal: TelemetryIngest's) is
 *     logged at debug alone: the caller counts it;
 *   - every 5xx, and every 4xx whose Exception says the fault is not the
 *     client's, is logged at error, as before.
 *
 * The answer itself is the same either way.
 */

type MockFn = jest.Mock;

interface Captured {
  status: number | null;
  body: unknown;
}

let captured: Captured;
let response: ExpressResponse;
let request: ExpressRequest;

beforeEach(() => {
  for (const level of ["error", "warn", "info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {});
  }

  ClientRefusalLog.counter.clear();

  captured = { status: null, body: undefined };
  response = {
    headersSent: false,
    status: (code: number): ExpressResponse => {
      captured.status = code;
      return response;
    },
    send: (body: unknown): void => {
      captured.body = body;
    },
  } as unknown as ExpressResponse;
  request = {
    method: "POST",
    baseUrl: "/probe-ingest",
    route: { path: "/probe/response/ingest" },
    headers: {},
    socket: {},
  } as unknown as ExpressRequest;
});

afterEach(() => {
  jest.restoreAllMocks();
});

const callsOf: (level: "error" | "warn" | "debug") => number = (
  level: "error" | "warn" | "debug",
): number => {
  return (logger[level] as unknown as MockFn).mock.calls.length;
};

const REFUSALS: Array<[string, Exception, number]> = [
  [
    "no ingestion key",
    new NotAuthenticatedException(
      "Missing ingestion token. Send your OneUptime telemetry ingestion key in the x-oneuptime-token header.",
    ),
    401,
  ],
  [
    "a key switched off",
    new NotAuthorizedException(
      "This telemetry ingestion key has been disabled.",
    ),
    422,
  ],
  [
    "a key over its rate",
    new TooManyRequestsException(
      "Too many telemetry requests for this ingestion key. Please retry later.",
    ),
    429,
  ],
  [
    "a probe's wrong key",
    new BadDataException("Invalid Probe ID or Probe Key"),
    400,
  ],
  ["a page that is not there", new NotFoundException("Page not found - /x"), 404],
];

describe("sendErrorResponse", () => {
  test.each(REFUSALS)(
    "a client's refusal (%s) is logged at debug, never at error, and answered the same",
    (_what: string, refusal: Exception, status: number) => {
      ResponseUtil.sendErrorResponse(request, response, refusal);

      expect(callsOf("error")).toBe(0);
      expect(logger.debug).toHaveBeenCalledWith(refusal, expect.anything());
      // The first on its route this minute, with its words.
      expect(callsOf("warn")).toBe(1);
      expect(String((logger.warn as unknown as MockFn).mock.calls[0]![0])).toContain(
        `(POST /probe-ingest/probe/response/ingest ${status}) with "${refusal.message}"`,
      );
      expect(captured).toEqual({
        status: status,
        body: { message: refusal.message },
      });
    },
  );

  test.each(REFUSALS)(
    "one its caller marks (%s) is logged at debug alone - its caller counts it - and answered the same",
    (_what: string, refusal: Exception, status: number) => {
      ResponseUtil.sendErrorResponse(request, response, refusal, {
        isClientRefusal: true,
      });

      expect(callsOf("error")).toBe(0);
      expect(callsOf("warn")).toBe(0);
      expect(logger.debug).toHaveBeenCalledWith(refusal, expect.anything());
      expect(ClientRefusalLog.counter.getCounts().size).toBe(0);
      expect(captured).toEqual({
        status: status,
        body: { message: refusal.message },
      });
    },
  );

  test("a burst of 200 refusals from a client writes no error line, one warn line and a debug line each", () => {
    for (let index: number = 0; index < 200; index++) {
      ResponseUtil.sendErrorResponse(
        request,
        response,
        new BadDataException("Invalid Probe ID or Probe Key"),
      );
    }

    expect(callsOf("error")).toBe(0);
    expect(callsOf("warn")).toBe(1);
    expect(callsOf("debug")).toBe(200);
    expect(Object.fromEntries(ClientRefusalLog.counter.getCounts())).toEqual({
      "POST /probe-ingest/probe/response/ingest 400": 199,
    });
  });

  test.each([
    ["a 5xx", new ServerException("The queue is down."), 500],
    [
      "a TimeoutException, whose 408 is the server's infrastructure",
      new TimeoutException("The SMTP server did not answer."),
      408,
    ],
    [
      "a 4xx a site declared a code fault",
      new BadDataException("An invariant broke.").asCodeFault(),
      400,
    ],
  ])(
    "%s is logged at error, as it always was, and answered the same",
    (_what: string, error: Exception, status: number) => {
      ResponseUtil.sendErrorResponse(request, response, error);
      ResponseUtil.sendErrorResponse(request, response, error, {
        isClientRefusal: false,
      });

      expect(callsOf("error")).toBe(2);
      expect(callsOf("warn")).toBe(0);
      expect(logger.debug).not.toHaveBeenCalledWith(error, expect.anything());
      expect(captured).toEqual({
        status: status,
        body: { message: error.message },
      });
    },
  );

  test("a 5xx its caller marks a client's refusal is logged at error all the same", () => {
    const error: ServerException = new ServerException("The queue is down.");

    ResponseUtil.sendErrorResponse(request, response, error, {
      isClientRefusal: true,
    });

    expect(logger.error).toHaveBeenCalledWith(error, expect.anything());
    expect(logger.debug).not.toHaveBeenCalledWith(error, expect.anything());
  });

  test("a refusal with no words is the server's: logged at error, and answered with a reference", () => {
    const error: BadDataException = new BadDataException("");

    ResponseUtil.sendErrorResponse(request, response, error);

    expect(logger.error).toHaveBeenCalledWith(error, expect.anything());
    expect(captured.status).toBe(400);
  });
});

describe("the Express error handler", () => {
  const handle: (err: Error | Exception | HTTPErrorResponse) => void = (
    err: Error | Exception | HTTPErrorResponse,
  ): void => {
    expressErrorHandler(
      err,
      request,
      response,
      (() => {}) as unknown as NextFunction,
    );
  };

  test.each(REFUSALS)(
    "a client's refusal a route hands on (%s) is logged at debug and counted, and answered as before",
    (_what: string, refusal: Exception, status: number) => {
      handle(refusal);

      expect(callsOf("error")).toBe(0);
      expect(logger.debug).toHaveBeenCalledWith(refusal, expect.anything());
      expect(callsOf("warn")).toBe(1);
      expect(captured).toEqual({
        status: status,
        body: { error: refusal.message },
      });
    },
  );

  test("a burst of 200 writes no error line and one warn line", () => {
    for (let index: number = 0; index < 200; index++) {
      handle(new NotAuthenticatedException("Your session has expired."));
    }

    expect(callsOf("error")).toBe(0);
    expect(callsOf("warn")).toBe(1);
    expect(callsOf("debug")).toBe(200);
  });

  test.each([
    ["a 5xx Exception", new ServerException("The queue is down.")],
    [
      "a TimeoutException",
      new TimeoutException("The SMTP server did not answer."),
    ],
    ["a TypeError", new TypeError("Cannot read properties of undefined")],
    [
      "another service's 4xx, passed on",
      new HTTPErrorResponse(400, { error: "Bad request upstream." }, {}),
    ],
  ])("%s is logged at error, as it always was", (_what: string, err: unknown) => {
    handle(err as Error);

    expect(logger.error).toHaveBeenCalledWith(err, expect.anything());
    expect(callsOf("warn")).toBe(0);
  });
});
