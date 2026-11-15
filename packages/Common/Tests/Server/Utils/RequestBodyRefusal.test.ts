import readRequestBodyRefusal, {
  REQUEST_BODY_REFUSAL_MESSAGES,
  REQUEST_BODY_REFUSALS,
  RequestBodyRefusal,
} from "../../../Server/Utils/RequestBodyRefusal";
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
import { describe, expect, test } from "@jest/globals";
import express from "express";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";

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

  test("a body too large and a form with too many fields are both too large: 413", () => {
    expect(REQUEST_BODY_REFUSALS["entity.too.large"]).toEqual({
      status: 413,
      message: UNEXPLAINED_ERROR_MESSAGES.tooLarge,
    });
    expect(REQUEST_BODY_REFUSALS["parameters.too.many"]).toEqual({
      status: 413,
      message: UNEXPLAINED_ERROR_MESSAGES.tooLarge,
    });
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

  test("too large is the front ends' own sentence, read back as too large", () => {
    expect(REQUEST_BODY_REFUSAL_MESSAGES.tooLarge).toBe(
      UNEXPLAINED_ERROR_MESSAGES.tooLarge,
    );
    expect(
      readUnexplainedError(REQUEST_BODY_REFUSAL_MESSAGES.tooLarge),
    ).toEqual({ kind: UnexplainedErrorKind.TooLarge, reference: null });
  });

  test("the others are the API's own words, shown as they are", () => {
    for (const [name, message] of Object.entries(
      REQUEST_BODY_REFUSAL_MESSAGES,
    )) {
      if (name !== "tooLarge") {
        expect([name, readUnexplainedError(message)]).toEqual([name, null]);
      }
    }
  });

  test("every sentence is used by a type, and every type's sentence is one of them", () => {
    const used: Set<string> = new Set<string>(
      Object.values(REQUEST_BODY_REFUSALS).map(
        (rule: { message: string }): string => {
          return rule.message;
        },
      ),
    );

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

    expect(readRequestBodyRefusal(error)).toEqual({
      type: "entity.too.large",
      status: 413,
      message: UNEXPLAINED_ERROR_MESSAGES.tooLarge,
    });
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
