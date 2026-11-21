import UnreadRequestBody, {
  UNREAD_BODY_READ_OFF_BYTES,
  isRequestBodyLeftUnread,
} from "../../../Server/Middleware/UnreadRequestBody";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";

/*
 * A RESPONSE SENT BEFORE ANYONE READ ITS REQUEST'S BODY CLOSES THE
 * CONNECTION, RATHER THAN HAVE NODE READ THE REST OF IT (#10598).
 *
 * Node reads off a body nobody read once the answer is sent, to keep the
 * connection: 64 MiB of text/plain sent to an ordinary route were read in
 * full after its answer. Over a socket, with real clients:
 * RequestBodyRefusedUnreadOverHttp.test.ts ("a body nobody reads").
 */

interface FakeRequest {
  headers: Record<string, string | undefined>;
  complete: boolean;
  readableFlowing: boolean | null;
}

function request(data: {
  headers?: Record<string, string>;
  complete?: boolean;
  readableFlowing?: boolean | null;
}): ExpressRequest {
  const req: FakeRequest = {
    headers: data.headers || {},
    complete: Boolean(data.complete),
    readableFlowing:
      data.readableFlowing === undefined ? null : data.readableFlowing,
  };

  return req as unknown as ExpressRequest;
}

describe("isRequestBodyLeftUnread", () => {
  test.each([
    ["no body at all", {}, false],
    ["an empty body", { "content-length": "0" }, false],
    ["a body a socket read holds", { "content-length": "100" }, false],
    [
      "a body of exactly a socket read",
      { "content-length": String(UNREAD_BODY_READ_OFF_BYTES) },
      false,
    ],
    [
      "a body one byte over a socket read",
      { "content-length": String(UNREAD_BODY_READ_OFF_BYTES + 1) },
      true,
    ],
    [
      "a body of 64 MiB",
      { "content-length": String(64 * 1024 * 1024) },
      true,
    ],
    ["a chunked body, of any size", { "transfer-encoding": "chunked" }, true],
    ["a Content-Length that is no number", { "content-length": "many" }, false],
  ])(
    "%s, unread and not all in: %s",
    (_what: string, headers: Record<string, string>, isLeft: boolean) => {
      expect(isRequestBodyLeftUnread(request({ headers: headers }))).toBe(
        isLeft,
      );
    },
  );

  test("a body that is all in is not left: Node's read of it costs nothing more", () => {
    expect(
      isRequestBodyLeftUnread(
        request({
          headers: { "transfer-encoding": "chunked" },
          complete: true,
        }),
      ),
    ).toBe(false);
  });

  test("a body someone reads, or paused to refuse, is theirs", () => {
    for (const readableFlowing of [true, false]) {
      expect(
        isRequestBodyLeftUnread(
          request({
            headers: { "transfer-encoding": "chunked" },
            readableFlowing: readableFlowing,
          }),
        ),
      ).toBe(false);
    }
  });

  test("a real request stream nobody touched is left unread; one being read is not", () => {
    const stream: PassThrough = new PassThrough();

    Object.assign(stream, {
      headers: { "transfer-encoding": "chunked" },
      complete: false,
    });

    expect(isRequestBodyLeftUnread(stream as unknown as ExpressRequest)).toBe(
      true,
    );

    stream.on("data", (): void => {});

    expect(isRequestBodyLeftUnread(stream as unknown as ExpressRequest)).toBe(
      false,
    );
  });
});

describe("closeConnectionInstead", () => {
  interface FakeAnswer {
    shouldKeepAlive: boolean;
    headersSent: boolean;
    req: ExpressRequest;
    writeHead: (...args: Array<unknown>) => unknown;
  }

  // Runs the middleware on an answer, then writes its head as Express does.
  function answer(req: ExpressRequest): {
    res: FakeAnswer;
    written: Array<Array<unknown>>;
    returned: unknown;
    nextCalls: number;
  } {
    const written: Array<Array<unknown>> = [];
    const res: FakeAnswer = {
      shouldKeepAlive: true,
      headersSent: false,
      req: req,
      writeHead: function (this: FakeAnswer, ...args: Array<unknown>) {
        written.push(args);
        this.headersSent = true;
        return this;
      },
    };
    let nextCalls: number = 0;

    UnreadRequestBody.closeConnectionInstead(
      req,
      res as unknown as ExpressResponse,
      ((): void => {
        nextCalls++;
      }) as NextFunction,
    );

    const returned: unknown = res.writeHead(413, { "x-reason": "test" });

    return { res, written, returned, nextCalls };
  }

  test("an answer written while a large body is left unread closes the connection, and never drains it", () => {
    const req: ExpressRequest = request({
      headers: { "content-length": String(64 * 1024 * 1024) },
    });
    const outcome: ReturnType<typeof answer> = answer(req);

    expect(outcome.nextCalls).toBe(1);
    expect(outcome.res.shouldKeepAlive).toBe(false);
    expect(
      typeof (req as unknown as { _dump?: unknown })._dump,
    ).toBe("function");
    // The head is written as it was asked to be, and returns what it did.
    expect(outcome.written).toEqual([[413, { "x-reason": "test" }]]);
    expect(outcome.returned).toBe(outcome.res);
  });

  test.each([
    ["no body", request({})],
    ["a small body", request({ headers: { "content-length": "2" } })],
    [
      "a body all in",
      request({ headers: { "transfer-encoding": "chunked" }, complete: true }),
    ],
    [
      "a body being read",
      request({
        headers: { "transfer-encoding": "chunked" },
        readableFlowing: true,
      }),
    ],
  ])(
    "an answer with %s keeps its connection as the client asked",
    (_what: string, req: ExpressRequest) => {
      const outcome: ReturnType<typeof answer> = answer(req);

      expect(outcome.res.shouldKeepAlive).toBe(true);
      expect((req as unknown as { _dump?: unknown })._dump).toBeUndefined();
      expect(outcome.written).toHaveLength(1);
    },
  );

  test("StartServer mounts it before anything that can answer", () => {
    const startServer: string = fs.readFileSync(
      path.join(__dirname, "../../../Server/Utils/StartServer.ts"),
      "utf8",
    );

    const mounted: number = startServer.indexOf(
      "app.use(UnreadRequestBody.closeConnectionInstead);",
    );

    expect(mounted).toBeGreaterThan(-1);

    for (const later of [
      "app.use(CorsMiddleware);",
      "app.use(setDefaultHeaders);",
      "GzipRequestBodyMiddleware.parseBody(req, res, next, limit)",
    ]) {
      expect(startServer.indexOf(later)).toBeGreaterThan(mounted);
    }
  });

  test("a jest mock of writeHead is called through, once", () => {
    const writeHead: ReturnType<typeof jest.fn> = jest.fn();
    const res: Record<string, unknown> = {
      shouldKeepAlive: true,
      headersSent: false,
      writeHead: writeHead,
    };

    UnreadRequestBody.closeConnectionInstead(
      request({}),
      res as unknown as ExpressResponse,
      ((): void => {}) as NextFunction,
    );
    (res["writeHead"] as (status: number) => void)(200);

    expect(writeHead).toHaveBeenCalledTimes(1);
    expect(writeHead).toHaveBeenCalledWith(200);
  });
});
