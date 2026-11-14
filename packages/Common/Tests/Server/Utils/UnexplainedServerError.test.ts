import Response from "../../../Server/Utils/Response";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import { sendUnexplainedError } from "../../../Server/Utils/UnexplainedServerError";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import logger, { LogAttributes } from "../../../Server/Utils/Logger";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import ServerException from "../../../Types/Exception/ServerException";
import {
  getUnexplainedServerErrorMessage,
  readUnexplainedError,
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorKind,
} from "../../../Types/Exception/UnexplainedError";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * #6836: a request that failed in a way nothing explained used to be
 * answered with "Server Error", which the Dashboard showed as "Server Error.
 * Please try again". Now the answer says what happened and what to do next,
 * and carries a reference - the start of the request's id, which every log
 * record of the request carries - and the server writes a log line naming
 * it, so an administrator can find the failure from what a person read out.
 */

const REQUEST_ID: string = "7b3e1c90-1d2f-4e5a-8b6c-0a1b2c3d4e5f";
const REFERENCE: string = "7b3e1c90";

interface Captured {
  statuses: Array<number>;
  bodies: Array<Record<string, unknown>>;
  logLines: Array<{ body: unknown; attributes: LogAttributes | undefined }>;
}

let captured: Captured;
let res: ExpressResponse;

const request: (overrides?: Record<string, unknown>) => ExpressRequest = (
  overrides: Record<string, unknown> = {},
): ExpressRequest => {
  return {
    requestId: REQUEST_ID,
    method: "POST",
    originalUrl: "/api/monitor?token=secret-token-value",
    url: "/monitor?token=secret-token-value",
    ...overrides,
  } as unknown as ExpressRequest;
};

beforeEach(() => {
  captured = { statuses: [], bodies: [], logLines: [] };

  jest
    .spyOn(logger, "error")
    .mockImplementation(
      (body: unknown, attributes?: LogAttributes | undefined): void => {
        captured.logLines.push({ body, attributes });
      },
    );

  res = {
    headersSent: false,
    status: (code: number): ExpressResponse => {
      captured.statuses.push(code);
      return res;
    },
    send: (body: Record<string, unknown>): ExpressResponse => {
      captured.bodies.push(body);
      return res;
    },
  } as unknown as ExpressResponse;
});

afterEach(() => {
  jest.restoreAllMocks();
});

const handle: (
  err: Error | Exception | HTTPErrorResponse,
  req?: ExpressRequest,
) => void = (
  err: Error | Exception | HTTPErrorResponse,
  req: ExpressRequest = request(),
): void => {
  expressErrorHandler(err, req, res, (() => {}) as unknown as NextFunction);
};

// The log line that names the reference.
const referenceLogLine: () => string | undefined = (): string | undefined => {
  return captured.logLines
    .map((line: { body: unknown }): unknown => {
      return line.body;
    })
    .find((body: unknown): boolean => {
      return typeof body === "string" && body.startsWith("Unexplained error");
    }) as string | undefined;
};

describe("sendUnexplainedError", () => {
  test("answers with what happened, what to do next and the reference", () => {
    sendUnexplainedError(request(), res, { status: 500, errorField: "error" });

    expect(captured.statuses).toEqual([500]);
    expect(captured.bodies).toEqual([
      {
        error: getUnexplainedServerErrorMessage(REFERENCE),
        reference: REFERENCE,
      },
    ]);
  });

  test("writes a log line that names the reference, the method and the path", () => {
    sendUnexplainedError(request(), res, { status: 500, errorField: "error" });

    const line: string | undefined = referenceLogLine();

    expect(line).toContain(`reference ${REFERENCE}`);
    expect(line).toContain("POST /api/monitor");
  });

  test("never logs the query string, which can hold a token", () => {
    sendUnexplainedError(request(), res, { status: 500, errorField: "error" });

    expect(referenceLogLine()).not.toContain("secret-token-value");
    expect(referenceLogLine()).not.toContain("?");
  });

  test("logs the line with the request's attributes, the full request id among them", () => {
    sendUnexplainedError(request(), res, { status: 500, errorField: "error" });

    const line: { attributes: LogAttributes | undefined } | undefined =
      captured.logLines.find((entry: { body: unknown }): boolean => {
        return entry.body === referenceLogLine();
      });

    expect(line?.attributes?.requestId).toBe(REQUEST_ID);
  });

  test("answers in the field its caller answers with", () => {
    sendUnexplainedError(request(), res, {
      status: 500,
      errorField: "message",
    });

    expect(captured.bodies[0]).toEqual({
      message: getUnexplainedServerErrorMessage(REFERENCE),
      reference: REFERENCE,
    });
  });

  test("without a request id, says to try again and names no reference", () => {
    sendUnexplainedError(request({ requestId: undefined }), res, {
      status: 500,
      errorField: "error",
    });

    expect(captured.bodies).toEqual([
      { error: UNEXPLAINED_ERROR_MESSAGES.server },
    ]);
    expect(referenceLogLine()).toContain("Unexplained error:");
  });

  test("keeps an error status and turns anything else into a 500", () => {
    sendUnexplainedError(request(), res, { status: 503, errorField: "error" });
    sendUnexplainedError(request(), res, { status: 200, errorField: "error" });
    sendUnexplainedError(request(), res, { status: 2, errorField: "error" });

    expect(captured.statuses).toEqual([503, 500, 500]);
  });

  test("the answer is one the Dashboard reads back as the server's, with its reference", () => {
    sendUnexplainedError(request(), res, { status: 500, errorField: "error" });

    expect(
      readUnexplainedError(captured.bodies[0]?.["error"] as string),
    ).toEqual({
      kind: UnexplainedErrorKind.ServerWithReference,
      reference: REFERENCE,
    });
  });
});

describe("the last-resort handler answers what nothing explained", () => {
  test("a TypeError: the reference, never its message", () => {
    handle(new TypeError("Cannot read properties of undefined (reading 'id')"));

    expect(captured.statuses).toEqual([500]);
    expect(captured.bodies[0]).toEqual({
      error: getUnexplainedServerErrorMessage(REFERENCE),
      reference: REFERENCE,
    });
    expect(JSON.stringify(captured.bodies)).not.toContain("Cannot read");
  });

  test("logs the error itself first, then the line that names its reference", () => {
    const error: TypeError = new TypeError("boom");

    handle(error);

    expect(captured.logLines[0]?.body).toBe(error);
    expect(captured.logLines[1]?.body).toBe(referenceLogLine());
  });

  test("a ServerException with its default 'Server Error'", () => {
    handle(new ServerException());

    expect(captured.statuses).toEqual([500]);
    expect(captured.bodies[0]?.["reference"]).toBe(REFERENCE);
  });

  test("an Exception thrown with no message keeps its status", () => {
    handle(new BadDataException(""));

    expect(captured.statuses).toEqual([400]);
    expect(captured.bodies[0]?.["reference"]).toBe(REFERENCE);
  });

  test("an Exception with an out-of-range code and no message is a 500", () => {
    handle(new Exception(ExceptionCode.APIException, ""));

    expect(captured.statuses).toEqual([500]);
    expect(captured.bodies[0]?.["reference"]).toBe(REFERENCE);
  });

  test("another service's answer that says nothing", () => {
    handle(new HTTPErrorResponse(502, { error: "Server Error" }, {}));

    expect(captured.statuses).toEqual([502]);
    expect(captured.bodies[0]?.["reference"]).toBe(REFERENCE);
  });

  test("a rejected promise with nothing to say", async () => {
    const rejection: Promise<never> = Promise.reject(new Error(""));

    handle(rejection as unknown as Error);

    await rejection.catch((): void => {});
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    expect(captured.statuses).toEqual([500]);
    expect(captured.bodies[0]?.["reference"]).toBe(REFERENCE);
  });
});

describe("the last-resort handler leaves what was explained alone", () => {
  test("an Exception's own message, with no reference", () => {
    handle(new BadDataException("Promo code is invalid."));

    expect(captured.statuses).toEqual([400]);
    expect(captured.bodies).toEqual([{ error: "Promo code is invalid." }]);
    expect(referenceLogLine()).toBeUndefined();
  });

  test("another service's own words, and its own reference, passed on as they came", () => {
    const upstream: Record<string, string> = {
      error: getUnexplainedServerErrorMessage("0a0b0c0d"),
      reference: "0a0b0c0d",
    };

    handle(new HTTPErrorResponse(500, upstream, {}));

    expect(captured.bodies).toEqual([upstream]);
    expect(referenceLogLine()).toBeUndefined();
  });
});

describe("Response.sendErrorResponse", () => {
  test("answers an Exception with no message with the reference, in `message`", () => {
    Response.sendErrorResponse(request(), res, new ServerException());

    expect(captured.statuses).toEqual([500]);
    expect(captured.bodies).toEqual([
      {
        message: getUnexplainedServerErrorMessage(REFERENCE),
        reference: REFERENCE,
      },
    ]);
    expect(referenceLogLine()).toContain(`reference ${REFERENCE}`);
  });

  test("keeps a message that says what happened", () => {
    Response.sendErrorResponse(
      request(),
      res,
      new BadDataException("This team no longer exists."),
    );

    expect(captured.bodies).toEqual([
      { message: "This team no longer exists." },
    ]);
    expect(referenceLogLine()).toBeUndefined();
  });
});
