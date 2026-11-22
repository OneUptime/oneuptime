import readRequestBodyRefusal, {
  APP_BODY_LIMIT_IN_BYTES,
  APP_REQUEST_BODY_LIMIT_FIELD,
  INFLATE_FAILED_TYPE,
  MULTIPART_LIMIT_TYPE,
  MULTIPART_MALFORMED_TYPE,
  REFUSAL_ANSWER_FIELD,
  REQUEST_BODY_REFUSAL_MESSAGES,
  REQUEST_BODY_REFUSALS,
  RequestBodyRefusal,
  TOO_MANY_JSON_VALUES_TYPE,
  UNREAD_BODY_CONNECTION_GRACE_MS,
  closeConnectionAfterAnswer,
  createCutOffError,
  createInflateFailedError,
  createTooLargeError,
  createTooManyJsonValuesError,
  describeBodyLimit,
  getTooLargeForRouteMessage,
  getTooManyJsonValuesMessage,
  isInflateError,
  markAsRequestBodyRefusal,
  stopReadingRequestBody,
  withAppRequestBodyLimit,
} from "../../../Server/Utils/RequestBodyRefusal";
import BadRequestException from "../../../Types/Exception/BadRequestException";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import PayloadTooLargeException from "../../../Types/Exception/PayloadTooLargeException";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import {
  LARGE_REQUEST_BODY_BYTES,
  LARGE_REQUEST_BODY_LIMIT,
} from "../../../Server/Utils/RequestBodyLimit";
import { JsonElementLimit } from "../../../Utils/JsonElementCount";
import {
  EMPTY_ERROR_PHRASES,
  isEmptyErrorPhrase,
  meetsErrorMessageRule,
} from "../../../Types/Exception/ErrorMessageRule";
import {
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorKind,
  readUnexplainedError,
} from "../../../Types/Exception/UnexplainedError";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { EventEmitter } from "events";
import express from "express";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";
import zlib from "zlib";

/*
 * readRequestBodyRefusal tells a body parser's refusal of the client's body
 * from a fault in the code (#8419), and says what to answer. The handler's
 * side is StartServerErrorStatus.test.ts; the parsers over a socket,
 * RequestBodyRefusalOverHttp.test.ts.
 */

// An error as http-errors makes body-parser's: exposed when it is a 4xx.
function parserError(
  status: number,
  type: string,
  message: string = "the parser's words",
): Error {
  return Object.assign(new Error(message), {
    status: status,
    statusCode: status,
    expose: status < 500,
    type: type,
  });
}

describe("readRequestBodyRefusal", () => {
  test.each(Object.entries(REQUEST_BODY_REFUSALS))(
    "reads body-parser's %s",
    (type: string, rule: { status: number; message: string }) => {
      const refusal: RequestBodyRefusal | null = readRequestBodyRefusal(
        parserError(rule.status, type),
      );

      expect(refusal).toEqual({
        type: type,
        status: rule.status,
        message: rule.message,
      });
    },
  );

  test("a body too large and a form with too many fields are both 413", () => {
    expect(REQUEST_BODY_REFUSALS["entity.too.large"]).toEqual({
      status: 413,
      message: UNEXPLAINED_ERROR_MESSAGES.tooLarge,
    });
    expect(REQUEST_BODY_REFUSALS["parameters.too.many"]).toEqual({
      status: 413,
      message: REQUEST_BODY_REFUSAL_MESSAGES.tooManyFields,
    });
  });

  /*
   * #8567: past the App's own 50 MB, OneUptime refused it, and says so in a
   * sentence of its own, which the front ends read apart from a proxy's 413.
   */
  test("a body past the App's own 50 MB says OneUptime's limit", () => {
    const refusal: RequestBodyRefusal | null = readRequestBodyRefusal(
      Object.assign(parserError(413, "entity.too.large"), {
        limit: APP_BODY_LIMIT_IN_BYTES,
        length: APP_BODY_LIMIT_IN_BYTES + 1,
      }),
    );

    expect(refusal).toEqual({
      type: "entity.too.large",
      status: 413,
      message: UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime,
    });
    expect(readUnexplainedError(refusal!.message)?.kind).toBe(
      UnexplainedErrorKind.TooLargeForOneUptime,
    );
  });

  test("the App's limit is the large routes' 50 MiB, in the bytes raw-body names", () => {
    expect(APP_BODY_LIMIT_IN_BYTES).toBe(52428800);
    expect(LARGE_REQUEST_BODY_BYTES).toBe(APP_BODY_LIMIT_IN_BYTES);
    expect(LARGE_REQUEST_BODY_LIMIT.bytes).toBe(APP_BODY_LIMIT_IN_BYTES);

    const startServer: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Server",
        "Utils",
        "StartServer.ts",
      ),
      "utf8",
    );

    // The JSON, form and protobuf parsers: each takes its route's bytes.
    expect(startServer).not.toMatch(/limit:\s*"[^"]+"/);
    expect(
      Array.from(startServer.matchAll(/limit: limit\.bytes/g)),
    ).toHaveLength(3);
    expect(UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime).toContain(
      "the 50 MB OneUptime takes in one request",
    );
  });

  /*
   * #10183: most routes take 1 MB. A body over it is OneUptime's refusal
   * too, and says that limit, not the sentence a proxy's 413 gets.
   */
  test("a body past the limit StartServer held its route to says that limit", () => {
    const refusal: RequestBodyRefusal | null = readRequestBodyRefusal(
      Object.assign(parserError(413, "entity.too.large"), {
        limit: 1024 * 1024,
        [APP_REQUEST_BODY_LIMIT_FIELD]: 1024 * 1024,
      }),
    );

    expect(refusal).toEqual({
      type: "entity.too.large",
      status: 413,
      message:
        "What was sent is larger than the 1 MB OneUptime takes in one request to this address, so this did not finish. Try again with less at once.",
    });
    expect(meetsErrorMessageRule(refusal!.message)).toBe(true);
    // Shown as it is: not the proxy's kind, whose words send an admin to a proxy.
    expect(readUnexplainedError(refusal!.message)).toBeNull();
  });

  test("the App's own 50 MB keeps the sentence the front ends read back, marked or not", () => {
    expect(
      readRequestBodyRefusal(
        Object.assign(parserError(413, "entity.too.large"), {
          limit: APP_BODY_LIMIT_IN_BYTES,
          [APP_REQUEST_BODY_LIMIT_FIELD]: APP_BODY_LIMIT_IN_BYTES,
        }),
      )?.message,
    ).toBe(UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime);
  });

  test("a mark that is not the limit the parser named is not believed", () => {
    expect(
      readRequestBodyRefusal(
        Object.assign(parserError(413, "entity.too.large"), {
          limit: 64 * 1024,
          [APP_REQUEST_BODY_LIMIT_FIELD]: 1024 * 1024,
        }),
      )?.message,
    ).toBe(UNEXPLAINED_ERROR_MESSAGES.tooLarge);
  });

  test.each([
    [1024 * 1024, "1 MB"],
    [50 * 1024 * 1024, "50 MB"],
    [1.5 * 1024 * 1024, "1.5 MB"],
    [512 * 1024, "512 KB"],
    [100, "1 KB"],
  ])("a limit of %d bytes is said as %s", (bytes: number, said: string) => {
    expect(describeBodyLimit(bytes)).toBe(said);
  });

  test("a JSON body with more values than its route reads is 413, with the limit it passed", () => {
    const error: Error = createTooManyJsonValuesError(
      {
        values: 100001,
        objectsArraysAndStrings: 100001,
        passed: JsonElementLimit.Values,
      },
      { values: 100000, objectsArraysAndStrings: 100000 },
    );

    expect(readRequestBodyRefusal(error)).toEqual({
      type: TOO_MANY_JSON_VALUES_TYPE,
      status: 413,
      message:
        "The request body holds more than 100,000 JSON values (objects, arrays, strings and numbers), the most OneUptime reads in one request to this address, so this did not finish. Send less in each request.",
    });

    expect(
      readRequestBodyRefusal(
        createTooManyJsonValuesError(
          {
            values: 5,
            objectsArraysAndStrings: 1000001,
            passed: JsonElementLimit.ObjectsArraysAndStrings,
          },
          { values: 26214400, objectsArraysAndStrings: 1000000 },
        ),
      )?.message,
    ).toBe(
      "The request body holds more than 1,000,000 JSON objects, arrays and strings, the most OneUptime reads in one request to this address, so this did not finish. Send less in each request.",
    );
  });

  test("the too-many-values sentences say what happened and what to do, and are shown as they are", () => {
    for (const passed of [
      JsonElementLimit.Values,
      JsonElementLimit.ObjectsArraysAndStrings,
    ]) {
      const message: string = getTooManyJsonValuesMessage(passed, 100000);

      expect(meetsErrorMessageRule(message)).toBe(true);
      expect(isEmptyErrorPhrase(message)).toBe(false);
      expect(message).toContain(", so this did not finish. ");
      expect(readUnexplainedError(message)).toBeNull();
    }

    expect(meetsErrorMessageRule(getTooLargeForRouteMessage(1048576))).toBe(
      true,
    );
  });

  test("a too-many-values error that names no limit keeps its type's sentence", () => {
    expect(
      readRequestBodyRefusal(parserError(413, TOO_MANY_JSON_VALUES_TYPE))
        ?.message,
    ).toBe(REQUEST_BODY_REFUSAL_MESSAGES.tooManyJsonValues);
  });

  test.each([
    ["a route's own 64 KB", 64 * 1024],
    ["one byte short of the App's", APP_BODY_LIMIT_IN_BYTES - 1],
    ["no limit named", undefined],
    ["a limit that is not a number", "50mb"],
  ])(
    "a body past another limit (%s) keeps the sentence that names none",
    (_what: string, limit: unknown) => {
      expect(
        readRequestBodyRefusal(
          Object.assign(parserError(413, "entity.too.large"), { limit }),
        )?.message,
      ).toBe(UNEXPLAINED_ERROR_MESSAGES.tooLarge);
    },
  );

  test("too many fields is not said as a size, whatever limit the error names", () => {
    expect(
      readRequestBodyRefusal(
        Object.assign(parserError(413, "parameters.too.many"), {
          limit: APP_BODY_LIMIT_IN_BYTES,
        }),
      )?.message,
    ).toBe(REQUEST_BODY_REFUSAL_MESSAGES.tooManyFields);
  });

  test("JSON that does not parse is 400", () => {
    expect(
      readRequestBodyRefusal(parserError(400, "entity.parse.failed"))?.status,
    ).toBe(400);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "entity.too.large"],
    ["a number", 413],
    ["a plain Error", new Error("request entity too large")],
    ["a TypeError", new TypeError("Cannot read properties of undefined")],
  ])("is not fooled by %s", (_what: string, value: unknown) => {
    expect(readRequestBodyRefusal(value)).toBeNull();
  });

  test.each([
    ["stream.not.readable", 500],
    ["stream.encoding.set", 500],
    ["entity.verify.failed", 403],
    ["some.other.type", 400],
  ])(
    "leaves the parser's %s to the handler: the server's, not the client's",
    (type: string, status: number) => {
      expect(readRequestBodyRefusal(parserError(status, type))).toBeNull();
    },
  );

  test("a client type with a 5xx status is not a refusal", () => {
    expect(
      readRequestBodyRefusal(parserError(500, "entity.too.large")),
    ).toBeNull();
  });

  test("a client type that is not exposed is not a refusal", () => {
    const error: Error = Object.assign(new Error("x"), {
      status: 413,
      expose: false,
      type: "entity.too.large",
    });

    expect(readRequestBodyRefusal(error)).toBeNull();
  });

  test("a client type with no status, or a status that is not a number, is not a refusal", () => {
    expect(
      readRequestBodyRefusal(
        Object.assign(new Error("x"), {
          expose: true,
          type: "entity.too.large",
        }),
      ),
    ).toBeNull();
    expect(
      readRequestBodyRefusal(
        Object.assign(new Error("x"), {
          status: "413",
          expose: true,
          type: "entity.too.large",
        }),
      ),
    ).toBeNull();
  });

  test("statusCode is read when status is not set", () => {
    expect(
      readRequestBodyRefusal(
        Object.assign(new Error("x"), {
          statusCode: 400,
          expose: true,
          type: "entity.parse.failed",
        }),
      )?.message,
    ).toBe(REQUEST_BODY_REFUSAL_MESSAGES.invalidJson);
  });

  test("a type inherited from the prototype is not one of the parsers'", () => {
    const error: Error = Object.assign(new Error("x"), {
      status: 400,
      expose: true,
      type: "toString",
    });

    expect(readRequestBodyRefusal(error)).toBeNull();
  });

  test("the answer never carries the parser's own words", () => {
    const refusal: RequestBodyRefusal | null = readRequestBodyRefusal(
      parserError(
        400,
        "entity.parse.failed",
        'Unexpected token } in JSON at position 6 "{"secret":}"',
      ),
    );

    expect(refusal?.message).not.toContain("secret");
    expect(refusal?.message).not.toContain("Unexpected");
  });
});

describe("the sentences", () => {
  test.each(Object.entries(REQUEST_BODY_REFUSAL_MESSAGES))(
    "%s says what happened and what to do, as a sentence",
    (_name: string, message: string) => {
      expect(meetsErrorMessageRule(message)).toBe(true);
      expect(isEmptyErrorPhrase(message)).toBe(false);
      expect(message).toContain(", so this did not finish. ");
      expect(message.split(". ").length).toBeGreaterThanOrEqual(2);
    },
  );

  test("none is one of the empty phrases", () => {
    for (const message of Object.values(REQUEST_BODY_REFUSAL_MESSAGES)) {
      for (const phrase of EMPTY_ERROR_PHRASES) {
        expect(message.toLowerCase()).not.toBe(phrase.toLowerCase());
      }
    }
  });

  test("the two too-large sentences are the front ends' own, each read back as its kind", () => {
    expect(REQUEST_BODY_REFUSAL_MESSAGES.tooLarge).toBe(
      UNEXPLAINED_ERROR_MESSAGES.tooLarge,
    );
    expect(
      readUnexplainedError(REQUEST_BODY_REFUSAL_MESSAGES.tooLarge),
    ).toEqual({ kind: UnexplainedErrorKind.TooLarge, reference: null });
    expect(REQUEST_BODY_REFUSAL_MESSAGES.tooLargeForOneUptime).toBe(
      UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime,
    );
    expect(
      readUnexplainedError(REQUEST_BODY_REFUSAL_MESSAGES.tooLargeForOneUptime),
    ).toEqual({
      kind: UnexplainedErrorKind.TooLargeForOneUptime,
      reference: null,
    });
  });

  test("the others are the API's own words, shown as they are", () => {
    for (const [name, message] of Object.entries(
      REQUEST_BODY_REFUSAL_MESSAGES,
    )) {
      if (name !== "tooLarge" && name !== "tooLargeForOneUptime") {
        expect([name, readUnexplainedError(message)]).toEqual([name, null]);
      }
    }
  });

  test("every sentence is used by a type, or by the App's own limit, and every type's sentence is one of them", () => {
    const used: Set<string> = new Set<string>(
      Object.values(REQUEST_BODY_REFUSALS).map(
        (rule: { message: string }): string => {
          return rule.message;
        },
      ),
    );

    used.add(REQUEST_BODY_REFUSAL_MESSAGES.tooLargeForOneUptime);

    expect(Array.from(used).sort()).toEqual(
      Object.values(REQUEST_BODY_REFUSAL_MESSAGES).sort(),
    );
  });

  test("every refusal is a 4xx", () => {
    for (const rule of Object.values(REQUEST_BODY_REFUSALS)) {
      expect(rule.status).toBeGreaterThanOrEqual(400);
      expect(rule.status).toBeLessThan(500);
    }
  });
});

/*
 * The parsers' own types, read from the versions installed: a client error
 * a new body-parser adds is either answered here or listed as the server's,
 * so it does not quietly become a 500 with a reference again.
 */
describe("the body parsers' error types are all decided", () => {
  // Types the parsers raise that are the server's, with why.
  const SERVER_FAULTS: Record<string, string> = {
    "stream.not.readable": "a stream read twice: how the parsers are wired",
    "stream.encoding.set": "a stream given an encoding: how they are wired",
    "entity.verify.failed": "a verify function of ours threw",
  };

  // The families body-parser and raw-body name their types in.
  const TYPE_FAMILY: RegExp =
    /^(?:entity|request|stream|encoding|charset|parameters|querystring)\./;

  function typesIn(file: string): Array<string> {
    const source: string = fs.readFileSync(file, "utf8");
    const types: Set<string> = new Set<string>();

    for (const match of source.matchAll(/type:\s*'([a-z.A-Z]+)'/g)) {
      types.add(match[1]!);
    }

    for (const match of source.matchAll(/'([a-z]+\.[a-z.A-Z]+)'/g)) {
      if (TYPE_FAMILY.test(match[1]!)) {
        types.add(match[1]!);
      }
    }

    return Array.from(types);
  }

  const MODULES: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "node_modules",
  );

  const files: Array<string> = [
    path.join(MODULES, "raw-body", "index.js"),
    path.join(MODULES, "body-parser", "lib", "read.js"),
    path.join(MODULES, "body-parser", "lib", "types", "json.js"),
    path.join(MODULES, "body-parser", "lib", "types", "urlencoded.js"),
  ].filter((file: string): boolean => {
    return fs.existsSync(file);
  });

  test("the parsers' sources were found", () => {
    expect(files.length).toBe(4);
  });

  test("each type they raise is answered as the client's or listed as the server's", () => {
    const found: Set<string> = new Set<string>();

    for (const file of files) {
      for (const type of typesIn(file)) {
        found.add(type);
      }
    }

    expect(found.size).toBeGreaterThan(5);

    for (const type of found) {
      const isDecided: boolean =
        Object.prototype.hasOwnProperty.call(REQUEST_BODY_REFUSALS, type) ||
        Object.prototype.hasOwnProperty.call(SERVER_FAULTS, type);

      expect([type, isDecided]).toEqual([type, true]);
    }
  });

  test("no type is both", () => {
    for (const type of Object.keys(SERVER_FAULTS)) {
      expect(
        Object.prototype.hasOwnProperty.call(REQUEST_BODY_REFUSALS, type),
      ).toBe(false);
    }
  });
});

/*
 * The parser's real errors, not ones built by hand: express.json and
 * express.urlencoded driven on a request stream with no socket.
 */
describe("the errors the real parsers raise are read", () => {
  type Middleware = (
    req: unknown,
    res: unknown,
    next: (err?: unknown) => void,
  ) => void;

  function errorOf(
    middleware: Middleware,
    data: { headers: Record<string, string>; body: Buffer | string },
  ): Promise<unknown> {
    const payload: Buffer = Buffer.isBuffer(data.body)
      ? data.body
      : Buffer.from(data.body);
    const req: PassThrough & Record<string, unknown> =
      new PassThrough() as PassThrough & Record<string, unknown>;

    req["headers"] = {
      ...data.headers,
      "content-length": String(payload.length),
      "transfer-encoding": undefined,
    };
    req["method"] = "POST";
    req["url"] = "/";

    return new Promise<unknown>((resolve: (value: unknown) => void) => {
      middleware(req, {}, (err?: unknown) => {
        resolve(err);
      });
      req.end(payload);
    });
  }

  const json: Middleware = express.json({ limit: "1kb" }) as Middleware;
  const form: Middleware = express.urlencoded({
    extended: true,
    limit: "1kb",
  }) as Middleware;

  test("a JSON body over the limit", async () => {
    const error: unknown = await errorOf(json, {
      headers: { "content-type": "application/json" },
      body: `{"a":"${"x".repeat(2048)}"}`,
    });

    // A limit of the route's own, not the App's 50 MB: no number is said.
    expect(readRequestBodyRefusal(error)).toEqual({
      type: "entity.too.large",
      status: 413,
      message: UNEXPLAINED_ERROR_MESSAGES.tooLarge,
    });
  });

  test("raw-body names the limit, in bytes, that the App's own is told by", async () => {
    const error: unknown = await errorOf(json, {
      headers: { "content-type": "application/json" },
      body: `{"a":"${"x".repeat(2048)}"}`,
    });

    expect((error as { limit?: unknown }).limit).toBe(1024);
  });

  test("JSON that does not parse", async () => {
    const error: unknown = await errorOf(json, {
      headers: { "content-type": "application/json" },
      body: '{"a":}',
    });

    expect(readRequestBodyRefusal(error)?.message).toBe(
      REQUEST_BODY_REFUSAL_MESSAGES.invalidJson,
    );
  });

  test("an encoding the parser does not read", async () => {
    const error: unknown = await errorOf(json, {
      headers: { "content-type": "application/json", "content-encoding": "br" },
      body: '{"a":1}',
    });

    expect(readRequestBodyRefusal(error)?.status).toBe(415);
  });

  test("a form over the limit", async () => {
    const error: unknown = await errorOf(form, {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `a=${"x".repeat(2048)}`,
    });

    expect(readRequestBodyRefusal(error)?.status).toBe(413);
  });

  test("a body that parses is no error at all", async () => {
    const error: unknown = await errorOf(json, {
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
    });

    expect(error).toBeUndefined();
    expect(readRequestBodyRefusal(error)).toBeNull();
  });
});

/*
 * #10597: a body whose Content-Encoding says gzip or deflate, and that does
 * not inflate, is the client's. It was a 500 and an error-level log line.
 */
describe("a body that does not inflate", () => {
  // zlib's own errors, as each way of not inflating raises them.
  function zlibErrorOf(inflate: () => unknown): Error {
    try {
      inflate();
    } catch (err) {
      return err as Error;
    }

    throw new Error("expected zlib to refuse the bytes");
  }

  const NOT_INFLATING: Array<[string, () => unknown]> = [
    [
      "not gzip at all",
      (): unknown => {
        return zlib.gunzipSync(Buffer.from("this is not gzip"));
      },
    ],
    [
      "gzip cut off",
      (): unknown => {
        return zlib.gunzipSync(
          zlib.gzipSync(Buffer.from("x".repeat(10000))).subarray(0, 20),
        );
      },
    ],
    [
      "not deflate at all",
      (): unknown => {
        return zlib.inflateSync(Buffer.from("this is not deflate"));
      },
    ],
  ];

  test.each(NOT_INFLATING)(
    "zlib's error for a body %s is told apart",
    (_what: string, inflate: () => unknown) => {
      expect(isInflateError(zlibErrorOf(inflate))).toBe(true);
    },
  );

  test.each(NOT_INFLATING)(
    "a body %s is refused 400, in a sentence of its own",
    (_what: string, inflate: () => unknown) => {
      const error: Error = createInflateFailedError(zlibErrorOf(inflate));

      expect(readRequestBodyRefusal(error)).toEqual({
        type: INFLATE_FAILED_TYPE,
        status: 400,
        message: REQUEST_BODY_REFUSAL_MESSAGES.notInflated,
      });
      expect(error.message).not.toBe("");
    },
  );

  test("as body-parser hands zlib's error on - with a 400 added - it is still told apart", () => {
    const error: Error = Object.assign(
      zlibErrorOf((): unknown => {
        return zlib.inflateSync(Buffer.from("garbage"));
      }),
      { status: 400, statusCode: 400, expose: true },
    );

    expect(isInflateError(error)).toBe(true);
    // Without the type, it is no refusal of the client's body at all.
    expect(readRequestBodyRefusal(error)).toBeNull();
  });

  test.each([
    ["an error of another kind", new Error("boom")],
    [
      "a socket's error",
      Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
    ],
    ["a Z_ code on something that is no error", { code: "Z_DATA_ERROR" }],
    ["nothing", undefined],
    ["null", null],
  ])("%s is not zlib's", (_what: string, error: unknown) => {
    expect(isInflateError(error)).toBe(false);
  });

  test("a cause with no message still gives the error one", () => {
    expect(createInflateFailedError(undefined).message).not.toBe("");
    expect(createInflateFailedError(new Error("")).message).not.toBe("");
  });

  test("the sentence says what happened and what to do, and is shown as it is", () => {
    const message: string = REQUEST_BODY_REFUSAL_MESSAGES.notInflated;

    expect(meetsErrorMessageRule(message)).toBe(true);
    expect(isEmptyErrorPhrase(message)).toBe(false);
    expect(message).toContain(", so this did not finish. ");
    expect(message).toContain("Content-Encoding");
    expect(readUnexplainedError(message)).toBeNull();
  });
});

describe("a body over a reader's limit", () => {
  test("says the route's limit, as body-parser's error marked by StartServer does", () => {
    const error: Error = createTooLargeError(1024 * 1024, 64 * 1024 * 1024);

    expect(error).toMatchObject({
      type: "entity.too.large",
      status: 413,
      expose: true,
      limit: 1024 * 1024,
      length: 64 * 1024 * 1024,
      [APP_REQUEST_BODY_LIMIT_FIELD]: 1024 * 1024,
    });
    expect(readRequestBodyRefusal(error)?.message).toBe(
      getTooLargeForRouteMessage(1024 * 1024),
    );
  });

  test("past the App's own 50 MB, says the sentence the front ends read back", () => {
    expect(
      readRequestBodyRefusal(
        createTooLargeError(
          APP_BODY_LIMIT_IN_BYTES,
          APP_BODY_LIMIT_IN_BYTES + 1,
        ),
      )?.message,
    ).toBe(UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime);
  });
});

/*
 * The answer to a body refused unread closes its connection without a byte
 * more read, and without cutting the answer off (#10598). Over a socket:
 * RequestBodyParserOverHttp.test.ts and GzipRequestBodyConnection.test.ts.
 */
describe("closeConnectionAfterAnswer", () => {
  interface FakeSocket extends EventEmitter {
    writable: boolean;
    end: ReturnType<typeof jest.fn>;
    destroy: ReturnType<typeof jest.fn>;
    destroySoon?: () => void;
  }

  function fakeSocket(): FakeSocket {
    const socket: FakeSocket = new EventEmitter() as FakeSocket;

    socket.writable = true;
    socket.end = jest.fn();
    socket.destroy = jest.fn();

    return socket;
  }

  function fakeAnswer(data: {
    shouldKeepAlive: boolean;
    headersSent?: boolean;
    req?: PassThrough | undefined;
    socket?: FakeSocket | undefined;
  }): ExpressResponse {
    return {
      shouldKeepAlive: data.shouldKeepAlive,
      headersSent: Boolean(data.headersSent),
      req: data.req,
      socket: data.socket,
    } as unknown as ExpressResponse;
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  test("says whether the connection was to be kept, and has the answer close it", () => {
    for (const wasKept of [true, false]) {
      const res: ExpressResponse = fakeAnswer({ shouldKeepAlive: wasKept });

      expect(closeConnectionAfterAnswer(res)).toBe(wasKept);
      expect(res.shouldKeepAlive).toBe(false);
    }
  });

  test("an answer already on its way is left as it is", () => {
    const res: ExpressResponse = fakeAnswer({
      shouldKeepAlive: true,
      headersSent: true,
    });

    expect(closeConnectionAfterAnswer(res)).toBe(true);
    expect(res.shouldKeepAlive).toBe(true);
  });

  test("the body is never read off once the answer is sent", () => {
    const req: PassThrough = new PassThrough();

    req.write(Buffer.alloc(64 * 1024, 1));
    closeConnectionAfterAnswer(fakeAnswer({ shouldKeepAlive: true, req: req }));

    // What Node calls once the answer is sent, for a body nobody read.
    (req as unknown as { _dump: () => void })._dump();

    expect(req.readableFlowing).toBeNull();
    expect(req.readableLength).toBe(64 * 1024);
  });

  test("once the answer is written, the socket is half-closed and destroyed only after the grace", () => {
    jest.useFakeTimers();

    const socket: FakeSocket = fakeSocket();

    closeConnectionAfterAnswer(
      fakeAnswer({ shouldKeepAlive: true, socket: socket }),
    );

    // What Node calls once the answer is written, to close the connection.
    socket.destroySoon!();

    expect(socket.end).toHaveBeenCalledTimes(1);
    expect(socket.destroy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(UNREAD_BODY_CONNECTION_GRACE_MS - 1);
    expect(socket.destroy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  test("a client that hangs up first ends it, and nothing is destroyed after", () => {
    jest.useFakeTimers();

    const socket: FakeSocket = fakeSocket();

    closeConnectionAfterAnswer(
      fakeAnswer({ shouldKeepAlive: true, socket: socket }),
    );
    socket.destroySoon!();
    socket.emit("close");

    jest.advanceTimersByTime(UNREAD_BODY_CONNECTION_GRACE_MS * 2);
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  test("a socket that can no longer be written is not ended again", () => {
    jest.useFakeTimers();

    const socket: FakeSocket = fakeSocket();

    socket.writable = false;
    closeConnectionAfterAnswer(
      fakeAnswer({ shouldKeepAlive: true, socket: socket }),
    );
    socket.destroySoon!();

    expect(socket.end).not.toHaveBeenCalled();
    jest.advanceTimersByTime(UNREAD_BODY_CONNECTION_GRACE_MS);
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  test("an answer with no request or socket of its own (a test's) is still marked", () => {
    const res: ExpressResponse = fakeAnswer({ shouldKeepAlive: true });

    expect(() => {
      closeConnectionAfterAnswer(res);
    }).not.toThrow();
    expect(res.shouldKeepAlive).toBe(false);
  });

  test("stopReadingRequestBody pauses the body, and has the answer close the connection", () => {
    const req: PassThrough = new PassThrough();
    const res: ExpressResponse = fakeAnswer({
      shouldKeepAlive: true,
      req: req,
    });

    req.on("data", (): void => {});
    stopReadingRequestBody(req as unknown as ExpressRequest, res);

    expect(req.readableFlowing).toBe(false);
    expect(res.shouldKeepAlive).toBe(false);
  });
});

/*
 * #10643: a multipart body multer refuses stays the Exception it was, in the
 * same words, and is marked as the client's body refused, so the error
 * handler answers it with its status and logs it at debug - where each was
 * an error-level line (and a malformed body a 500), from any client.
 */
describe("a refusal of the code's own", () => {
  test("keeps the Exception it is, and is answered in the words it was made with", () => {
    const limit: PayloadTooLargeException = markAsRequestBodyRefusal(
      new PayloadTooLargeException(
        "Multipart request rejected: LIMIT_FILE_COUNT.",
      ),
      MULTIPART_LIMIT_TYPE,
      413,
    );

    expect(limit).toBeInstanceOf(PayloadTooLargeException);
    expect(limit.code).toBe(ExceptionCode.PayloadTooLargeException);
    expect(readRequestBodyRefusal(limit)).toEqual({
      type: MULTIPART_LIMIT_TYPE,
      status: 413,
      message: "Multipart request rejected: LIMIT_FILE_COUNT.",
    });

    const malformed: BadRequestException = markAsRequestBodyRefusal(
      new BadRequestException(REQUEST_BODY_REFUSAL_MESSAGES.multipartMalformed),
      MULTIPART_MALFORMED_TYPE,
      400,
    );

    expect(malformed).toBeInstanceOf(BadRequestException);
    expect(readRequestBodyRefusal(malformed)).toEqual({
      type: MULTIPART_MALFORMED_TYPE,
      status: 400,
      message: REQUEST_BODY_REFUSAL_MESSAGES.multipartMalformed,
    });
  });

  test("its words are only ever the ones it was marked with: a library's message of the same type is not shown", () => {
    // busboy's own words, on an error that merely carries the type.
    const refusal: RequestBodyRefusal | null = readRequestBodyRefusal(
      parserError(400, MULTIPART_MALFORMED_TYPE, "Unexpected end of form"),
    );

    expect(refusal?.message).toBe(
      REQUEST_BODY_REFUSAL_MESSAGES.multipartMalformed,
    );
    expect(
      readRequestBodyRefusal(
        parserError(413, MULTIPART_LIMIT_TYPE, "LIMIT_PART_COUNT"),
      )?.message,
    ).toBe(REQUEST_BODY_REFUSAL_MESSAGES.multipartTooLarge);
  });

  test("marked with no words, it says its type's sentence", () => {
    const refusal: RequestBodyRefusal | null = readRequestBodyRefusal(
      markAsRequestBodyRefusal(new Error(""), MULTIPART_LIMIT_TYPE, 413),
    );

    expect(refusal?.message).toBe(
      REQUEST_BODY_REFUSAL_MESSAGES.multipartTooLarge,
    );
  });

  test("the words it is answered in are the field it was marked with", () => {
    const error: Error = markAsRequestBodyRefusal(
      new Error("Multipart request rejected: LIMIT_FIELD_VALUE."),
      MULTIPART_LIMIT_TYPE,
      413,
    );

    expect(
      (error as unknown as Record<string, unknown>)[REFUSAL_ANSWER_FIELD],
    ).toBe("Multipart request rejected: LIMIT_FIELD_VALUE.");
    expect(error).toMatchObject({
      type: MULTIPART_LIMIT_TYPE,
      status: 413,
      statusCode: 413,
      expose: true,
    });
  });
});

describe("a reader's next, marked with the App's own limit", () => {
  test("a body over it says that limit, and is not read as a proxy's", () => {
    const handed: Array<unknown> = [];
    const next: (err?: unknown) => void = withAppRequestBodyLimit(
      (err?: unknown): void => {
        handed.push(err);
      },
      1048576,
    );

    next(parserError(413, "entity.too.large"));
    next(
      Object.assign(parserError(413, "entity.too.large"), { limit: 1048576 }),
    );

    expect(
      (handed[0] as Record<string, unknown>)[APP_REQUEST_BODY_LIMIT_FIELD],
    ).toBe(1048576);
    expect(readRequestBodyRefusal(handed[1])?.message).toBe(
      getTooLargeForRouteMessage(1048576),
    );
  });

  test("any other error, and none, is handed on as it is", () => {
    const handed: Array<unknown> = [];
    const next: (err?: unknown) => void = withAppRequestBodyLimit(
      (err?: unknown): void => {
        handed.push(err);
      },
      1048576,
    );
    const parseFailed: Error = parserError(400, "entity.parse.failed");

    next();
    next(parseFailed);

    expect(handed).toEqual([undefined, parseFailed]);
    expect(
      (parseFailed as unknown as Record<string, unknown>)[
        APP_REQUEST_BODY_LIMIT_FIELD
      ],
    ).toBeUndefined();
  });
});

describe("a body whose client went away before it was read", () => {
  test("is answered as one cut off mid-body is: 400, never a 500", () => {
    expect(readRequestBodyRefusal(createCutOffError())).toEqual({
      type: "request.aborted",
      status: 400,
      message: REQUEST_BODY_REFUSAL_MESSAGES.cutOff,
    });
  });
});
