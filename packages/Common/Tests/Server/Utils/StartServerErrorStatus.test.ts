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
import QueryTimeoutException from "../../../Types/Exception/QueryTimeoutException";
import {
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorKind,
  readUnexplainedError,
} from "../../../Types/Exception/UnexplainedError";
import { REQUEST_BODY_REFUSAL_MESSAGES } from "../../../Server/Utils/RequestBodyRefusal";
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

  /*
   * A search stopped at the 45 s query limit (issue #4707). The explorers and
   * API callers read 504 as "took too long" and the message as what to try.
   * Not 408: a browser resends a request answered 408 on a reused
   * connection, running the same search again unseen.
   */
  it("answers a read stopped at its time limit with 504 and its message", () => {
    const message: string =
      "This query took longer than 45 seconds and was stopped before it finished. Try a shorter time range or more specific filters.";

    handle(new QueryTimeoutException(message));

    expect(statuses).toEqual([504]);
    expect(bodies).toEqual([{ error: message }]);
  });

  /*
   * What the issue's readers saw: JSON.parse's SyntaxError on the empty body
   * a stopped read answered with. It is not an Exception, so its message is
   * thrown away. The ClickHouse reader no longer lets one reach this handler
   * (ClickhouseReadResult); this is why it must not.
   */
  it("answers an error that is not an Exception with a 500 that keeps its message in the log", () => {
    handle(new SyntaxError("Unexpected end of JSON input"));

    expect(statuses).toEqual([500]);
    /*
     * Not "Server Error" any more (#6836): what happened and what to do
     * next. This request has no id, so there is no reference to give;
     * UnexplainedServerError.test.ts covers the answer with one.
     */
    expect(bodies).toEqual([{ error: UNEXPLAINED_ERROR_MESSAGES.server }]);
    expect(JSON.stringify(bodies)).not.toContain("Unexpected end of JSON");
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

/*
 * A body the App's own body parsers refused (#8419). express.json and
 * express.urlencoded raise an http-errors error - a `type`, a 4xx status,
 * `expose` - which is none of OneUptime's Exceptions, so it took the last
 * branch: an error in the logs and a 500 "could not explain" with a
 * reference, for a body over 50 MB or JSON that does not parse.
 */
describe("the express error handler answers a refused request body as the client's", () => {
  let statuses: Array<number>;
  let bodies: Array<unknown>;
  let res: ExpressResponse;
  let nextCalls: number;
  let errorLog: ReturnType<typeof jest.spyOn>;
  let debugLog: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {});
    debugLog = jest.spyOn(logger, "debug").mockImplementation((): void => {});

    statuses = [];
    bodies = [];
    nextCalls = 0;

    res = {
      headersSent: false,
      status: (code: number): ExpressResponse => {
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

  function handle(err: Error): void {
    expressErrorHandler(
      err,
      {
        url: "/api/monitor",
        originalUrl: "/api/monitor",
        method: "POST",
        requestId: "4f1c2d3e-0000-4000-8000-000000000000",
      } as unknown as ExpressRequest,
      res,
      (() => {
        nextCalls++;
      }) as unknown as NextFunction,
    );
  }

  // The shape http-errors gives body-parser's errors.
  function bodyParserError(data: {
    message: string;
    status: number;
    type: string;
    expose?: boolean;
  }): Error {
    return Object.assign(new Error(data.message), {
      status: data.status,
      statusCode: data.status,
      expose: data.expose ?? data.status < 500,
      type: data.type,
    });
  }

  it("answers a body over the limit with 413 and the sentence the front ends read as too large (the issue's reproduction)", () => {
    handle(
      Object.assign(new Error("request entity too large"), {
        status: 413,
        statusCode: 413,
        expose: true,
        type: "entity.too.large",
      }),
    );

    // Before: [500] and UNEXPLAINED_ERROR_MESSAGES.server.
    expect(statuses).toEqual([413]);
    expect(bodies).toEqual([{ error: UNEXPLAINED_ERROR_MESSAGES.tooLarge }]);
    expect(readUnexplainedError(UNEXPLAINED_ERROR_MESSAGES.tooLarge)).toEqual({
      kind: UnexplainedErrorKind.TooLarge,
      reference: null,
    });
  });

  it("says OneUptime's own 50 MB when the parser names that limit, as raw-body does (#8567)", () => {
    handle(
      Object.assign(new Error("request entity too large"), {
        status: 413,
        statusCode: 413,
        expose: true,
        type: "entity.too.large",
        limit: 52428800,
        length: 60000000,
      }),
    );

    expect(statuses).toEqual([413]);
    expect(bodies).toEqual([
      { error: UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime },
    ]);
    expect(
      readUnexplainedError(UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime),
    ).toEqual({
      kind: UnexplainedErrorKind.TooLargeForOneUptime,
      reference: null,
    });
  });

  it("gives no reference for it: there is nothing for support to look up", () => {
    handle(
      bodyParserError({
        message: "request entity too large",
        status: 413,
        type: "entity.too.large",
      }),
    );

    expect(JSON.stringify(bodies)).not.toContain("reference");
    expect(JSON.stringify(bodies)).not.toContain("4f1c2d3e");
  });

  it("answers JSON that does not parse with 400 and a sentence of its own", () => {
    handle(
      bodyParserError({
        message: "Unexpected token } in JSON at position 9",
        status: 400,
        type: "entity.parse.failed",
      }),
    );

    expect(statuses).toEqual([400]);
    expect(bodies).toEqual([
      { error: REQUEST_BODY_REFUSAL_MESSAGES.invalidJson },
    ]);
    // The parser's words, and the body it quotes, stay out of the answer.
    expect(JSON.stringify(bodies)).not.toContain("Unexpected token");
  });

  it.each([
    ["entity.too.large", 413, REQUEST_BODY_REFUSAL_MESSAGES.tooLarge],
    ["parameters.too.many", 413, REQUEST_BODY_REFUSAL_MESSAGES.tooManyFields],
    ["entity.parse.failed", 400, REQUEST_BODY_REFUSAL_MESSAGES.invalidJson],
    ["request.aborted", 400, REQUEST_BODY_REFUSAL_MESSAGES.cutOff],
    ["request.size.invalid", 400, REQUEST_BODY_REFUSAL_MESSAGES.sizeMismatch],
    [
      "encoding.unsupported",
      415,
      REQUEST_BODY_REFUSAL_MESSAGES.encodingUnsupported,
    ],
    [
      "charset.unsupported",
      415,
      REQUEST_BODY_REFUSAL_MESSAGES.charsetUnsupported,
    ],
    [
      "querystring.parse.rangeError",
      400,
      REQUEST_BODY_REFUSAL_MESSAGES.tooDeep,
    ],
  ])(
    "answers body-parser's %s with %i and its sentence",
    (type: string, status: number, message: string) => {
      handle(
        bodyParserError({
          message: "the parser's words",
          status: status,
          type: type,
        }),
      );

      expect(statuses).toEqual([status]);
      expect(bodies).toEqual([{ error: message }]);
    },
  );

  it("logs a refused body at debug, never as an error that pages anyone", () => {
    handle(
      bodyParserError({
        message: "request entity too large",
        status: 413,
        type: "entity.too.large",
      }),
    );

    expect(errorLog).not.toHaveBeenCalled();
    expect(debugLog).toHaveBeenCalledTimes(1);
    expect(String(debugLog.mock.calls[0]![0])).toContain("entity.too.large");
    expect(String(debugLog.mock.calls[0]![0])).toContain("413");
  });

  it.each([
    ["stream.not.readable", 500],
    ["stream.encoding.set", 500],
    ["entity.verify.failed", 403],
  ])(
    "still answers the parser's %s as a failure the server could not explain: it is the server's",
    (type: string, status: number) => {
      handle(bodyParserError({ message: "the parser's words", status, type }));

      expect(statuses).toEqual([500]);
      expect(JSON.stringify(bodies)).toContain(
        "The server ran into a problem it could not explain",
      );
      expect(errorLog).toHaveBeenCalled();
    },
  );

  it("does not take an error of the code's own for a parser's, though it carries a parser's type", () => {
    // No `expose`, no status: thrown by OneUptime's code, not body-parser.
    handle(
      Object.assign(new TypeError("Cannot read properties of undefined"), {
        type: "entity.parse.failed",
      }),
    );

    expect(statuses).toEqual([500]);
    expect(bodies).toEqual([
      expect.objectContaining({
        error: expect.stringContaining(
          "The server ran into a problem it could not explain",
        ),
        reference: "4f1c2d3e",
      }),
    ]);
  });

  it("does not take a 5xx that names a client type, or one not exposed, for the client's", () => {
    handle(
      bodyParserError({
        message: "x",
        status: 500,
        type: "entity.too.large",
        expose: true,
      }),
    );
    handle(
      bodyParserError({
        message: "x",
        status: 413,
        type: "entity.too.large",
        expose: false,
      }),
    );

    expect(statuses).toEqual([500, 500]);
  });

  it("still answers a TypeError with a 500 and a reference", () => {
    handle(new TypeError("Cannot read properties of undefined (reading 'x')"));

    expect(statuses).toEqual([500]);
    expect(bodies).toEqual([
      expect.objectContaining({ reference: "4f1c2d3e" }),
    ]);
    expect(errorLog).toHaveBeenCalled();
  });

  it("leaves a refused body whose answer has started to the default handler", () => {
    (res as unknown as { headersSent: boolean }).headersSent = true;

    handle(
      bodyParserError({
        message: "request entity too large",
        status: 413,
        type: "entity.too.large",
      }),
    );

    expect(nextCalls).toBe(1);
    expect(statuses).toEqual([]);
  });
});
