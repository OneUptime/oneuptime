import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import ResponseUtil from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import Exception from "../../../Types/Exception/Exception";

/*
 * A REFUSAL OF WHAT THE CLIENT SENT IS LOGGED AT DEBUG (#10703).
 *
 * sendErrorResponse logs every error it answers at error level. A route
 * that refuses a client's request for what the client sent - telemetry with
 * no ingestion key, a wrong one, one switched off or over its rate - says so
 * (isClientRefusal), and the refusal is logged at debug instead: such a
 * client keeps sending, and an error-level line each, at the default
 * LOG_LEVEL=ERROR, filled the error log and raised error alerts at no cost
 * to it. The answer itself is the same.
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

  captured = { status: null, body: undefined };
  response = {
    status: (code: number): ExpressResponse => {
      captured.status = code;
      return response;
    },
    send: (body: unknown): void => {
      captured.body = body;
    },
  } as unknown as ExpressResponse;
  request = { headers: {}, socket: {} } as unknown as ExpressRequest;
});

afterEach(() => {
  jest.restoreAllMocks();
});

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
];

describe("sendErrorResponse", () => {
  test.each(REFUSALS)(
    "a client refusal (%s) is logged at debug, never at error, and answered the same",
    (_what: string, refusal: Exception, status: number) => {
      ResponseUtil.sendErrorResponse(request, response, refusal);

      const answeredBefore: Captured = { ...captured };

      expect(logger.error).toHaveBeenCalledTimes(1);

      (logger.error as unknown as MockFn).mockClear();

      ResponseUtil.sendErrorResponse(request, response, refusal, {
        isClientRefusal: true,
      });

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(refusal, expect.anything());
      // The answer is the one any error gets.
      expect(captured).toEqual(answeredBefore);
      expect(captured).toEqual({
        status: status,
        body: { message: refusal.message },
      });
    },
  );

  test("without the option, every error is logged at error, as it always was", () => {
    ResponseUtil.sendErrorResponse(
      request,
      response,
      new BadDataException("The request is malformed."),
      undefined,
    );
    ResponseUtil.sendErrorResponse(
      request,
      response,
      new BadDataException("The request is malformed."),
      { isClientRefusal: false },
    );

    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(logger.debug).not.toHaveBeenCalledWith(
      expect.any(BadDataException),
      expect.anything(),
    );
  });
});
