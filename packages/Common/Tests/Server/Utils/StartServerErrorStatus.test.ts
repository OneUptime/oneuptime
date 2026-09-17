import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import APIException from "../../../Types/Exception/ApiException";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * ExceptionCode is NOT an HTTP status enum. Most of its members happen to be
 * one — BadDataException 400, NotFoundException 404 — but five are not:
 * NotImplementedException 0, GeneralException 1, APIException 2,
 * BadOperationException 5, WebRequestException 6.
 *
 * Handing one of those to res.status() makes Node's writeHead throw
 * ERR_HTTP_INVALID_STATUS_CODE. Express's finalhandler rescues the throw into
 * a bare HTML 500, and because that body is HTML the browser-side
 * HTTPErrorResponse finds no message field in it and the dashboard shows the
 * useless "Server Error. Please try again".
 *
 * That is not a theoretical code path. It is the one an LLM provider failure
 * takes: a connection refused, a DNS failure or a request timeout against a
 * self-hosted Ollama surfaces from Common/Utils/API.ts as an APIException,
 * whose code is 2. So while investigating GH#3434 ("Generate Postmortem with
 * AI" failing with a generic connection error), the very error meant to
 * explain the failure was itself being destroyed on the way out.
 *
 * Both of the express error handler's sibling branches already guarded; the
 * Exception branch was the outlier, and Response.sendErrorResponse had the
 * same hole with a `|| 500` that only rescues the zero-valued code.
 */

describe("the express error handler never hands an invalid status to res.status()", () => {
  let statuses: Array<number>;
  let bodies: Array<unknown>;
  let res: ExpressResponse;
  let nextCalls: number;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    statuses = [];
    bodies = [];
    nextCalls = 0;

    res = {
      headersSent: false,
      status: (code: number): ExpressResponse => {
        /*
         * Node's real behaviour, which is the whole point: an out-of-range
         * code throws here rather than producing a response.
         */
        if (!Number.isInteger(code) || code < 100 || code > 599) {
          throw new RangeError(`Invalid status code: ${code}`);
        }

        statuses.push(code);
        return res;
      },
      send: (body: unknown): ExpressResponse => {
        bodies.push(body);
        return res;
      },
    } as unknown as ExpressResponse;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function handle(err: Error | Exception | HTTPErrorResponse): void {
    expressErrorHandler(
      err,
      { url: "/api/incident/generate-postmortem-from-ai/x" } as ExpressRequest,
      res,
      (() => {
        nextCalls++;
      }) as unknown as NextFunction,
    );
  }

  it("answers 500 for an APIException and keeps the provider's own message", () => {
    /*
     * The shape of a real Ollama failure: Common/Utils/API.ts throws
     * `new APIException("Request failed to <url>. Connection refused")` when
     * the provider produces no response at all.
     */
    handle(
      new APIException(
        "Request failed to http://ollama:11434/api/chat. Connection refused",
      ),
    );

    expect(statuses).toEqual([500]);
    expect(bodies).toEqual([
      {
        error:
          "Request failed to http://ollama:11434/api/chat. Connection refused",
      },
    ]);
  });

  it.each([
    ["NotImplementedException", ExceptionCode.NotImplementedException],
    ["GeneralException", ExceptionCode.GeneralException],
    ["APIException", ExceptionCode.APIException],
    ["BadOperationException", ExceptionCode.BadOperationException],
    ["WebRequestException", ExceptionCode.WebRequestException],
  ])(
    "downgrades the out-of-range %s code to 500 instead of throwing",
    (_name: string, code: ExceptionCode) => {
      expect(() => {
        handle(new Exception(code, "the real reason"));
      }).not.toThrow();

      expect(statuses).toEqual([500]);
      expect(bodies).toEqual([{ error: "the real reason" }]);
    },
  );

  it("still passes through the codes that really are HTTP statuses", () => {
    handle(new BadDataException("Note type must be 'public' or 'internal'"));
    expect(statuses).toEqual([400]);

    statuses = [];
    handle(new NotFoundException("Incident not found"));
    expect(statuses).toEqual([404]);
  });

  it("leaves a response that has already started to the default handler", () => {
    (res as unknown as { headersSent: boolean }).headersSent = true;

    handle(new APIException("too late"));

    expect(nextCalls).toBe(1);
    expect(statuses).toEqual([]);
  });
});

describe("Response.sendErrorResponse never hands an invalid status to res.status()", () => {
  let statuses: Array<number>;
  let bodies: Array<unknown>;
  let res: ExpressResponse;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    statuses = [];
    bodies = [];

    res = {
      status: (code: number): ExpressResponse => {
        if (!Number.isInteger(code) || code < 100 || code > 599) {
          throw new RangeError(`Invalid status code: ${code}`);
        }

        statuses.push(code);
        return res;
      },
      send: (body: unknown): ExpressResponse => {
        bodies.push(body);
        return res;
      },
    } as unknown as ExpressResponse;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function send(error: Exception): void {
    Response.sendErrorResponse({ url: "/api" } as ExpressRequest, res, error);
  }

  it("downgrades an APIException to 500 and keeps its message", () => {
    /*
     * `error.code || 500` rescued only ExceptionCode 0. Codes 1, 2, 5 and 6
     * are truthy, so they went straight through to res.status().
     */
    expect(() => {
      send(new APIException("Connection refused"));
    }).not.toThrow();

    expect(statuses).toEqual([500]);
    expect(bodies).toEqual([{ message: "Connection refused" }]);
  });

  it.each([
    ["NotImplementedException", ExceptionCode.NotImplementedException],
    ["GeneralException", ExceptionCode.GeneralException],
    ["BadOperationException", ExceptionCode.BadOperationException],
    ["WebRequestException", ExceptionCode.WebRequestException],
  ])("downgrades %s to 500", (_name: string, code: ExceptionCode) => {
    expect(() => {
      send(new Exception(code, "the real reason"));
    }).not.toThrow();

    expect(statuses).toEqual([500]);
  });

  it("still passes through real HTTP statuses", () => {
    send(new NotFoundException("Attachment not found"));
    expect(statuses).toEqual([404]);
    expect(bodies).toEqual([{ message: "Attachment not found" }]);

    statuses = [];
    send(new BadDataException("Invalid Incident ID"));
    expect(statuses).toEqual([400]);
  });
});
