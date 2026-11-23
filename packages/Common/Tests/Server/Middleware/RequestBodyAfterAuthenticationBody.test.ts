jest.mock("../../../Server/Utils/Logger", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Logger",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import AppBodyParsers from "../../../Server/Middleware/AppBodyParsers";
import RequestBodyAfterAuthentication from "../../../Server/Middleware/RequestBodyAfterAuthentication";
import UnreadRequestBody, {
  UNREAD_BODY_READ_OFF_BYTES,
} from "../../../Server/Middleware/UnreadRequestBody";
import {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
  RequestHandler,
  createExpressApp,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import { RequestBodyLimit } from "../../../Server/Utils/RequestBodyLimit";
import { getTooManyJsonValuesMessage } from "../../../Server/Utils/RequestBodyRefusal";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import { JsonElementLimit } from "../../../Utils/JsonElementCount";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  BodyServer,
  CONNECTIONS,
  Connection,
  KIB,
  MIB,
  READ_OR_TWO,
  SentRequest,
  sendOverHttp,
  startBodyServer,
} from "../TestingUtils/RequestBodyOverHttp";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import zlib from "zlib";

/*
 * A BODY READ ONCE ITS KEY IS RIGHT IS THE BODY STARTSERVER READ (#10702).
 *
 * The telemetry batches collectors, agents and CI send were read by
 * StartServer before routing, so before their key was checked. Their routes
 * now read them after the key, with RequestBodyAfterAuthentication.readBody -
 * StartServer's own parsers (AppBodyParsers), run later. So a handler gets
 * exactly the body it got before: here, over HTTP, every kind of body is
 * sent to a route read as StartServer reads one (before a key check) and to
 * the same route read after the key, and each answers with all it found -
 * the body, its kind, its raw text, the limit it was held to, or the
 * refusal, in the same words.
 *
 * Only what is new differs: with parseGzipJson, a gzip JSON body is parsed
 * as the same body uncompressed is; and nothing of a body is read for a
 * request the key check refuses.
 */

jest.setTimeout(300000);

const KEY: string = "the-right-key";

// A route's limit, small enough to cross in a test.
const LIMIT: RequestBodyLimit = {
  bytes: MIB,
  values: 1000,
  objectsArraysAndStrings: 1000,
};

const checkKey: RequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void => {
  if (req.headers["x-test-key"] !== KEY) {
    res.status(401).json({ refused: "no key" });
    return;
  }

  next();
};

// As StartServer reads every route's body before routing.
const readAsStartServer: Array<RequestHandler> = [
  (req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
    AppBodyParsers.read(req, res, next, LIMIT);
  },
  (req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
    AppBodyParsers.readForm(req, res, next, LIMIT);
  },
];

interface Found {
  kind: "undefined" | "bytes" | "object" | "array" | "other";
  body: unknown;
  rawBody: string | null;
  rawFormUrlEncodedBody: string | null;
  limit: number | null;
}

const answerWhatArrived: RequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
): void => {
  const body: unknown = (req as { body?: unknown }).body;
  const isBytes: boolean = Buffer.isBuffer(body);

  const found: Found = {
    kind:
      body === undefined
        ? "undefined"
        : isBytes
          ? "bytes"
          : Array.isArray(body)
            ? "array"
            : typeof body === "object" && body !== null
              ? "object"
              : "other",
    body: isBytes ? (body as Buffer).toString("hex") : body,
    rawBody: (req as OneUptimeRequest).rawBody ?? null,
    rawFormUrlEncodedBody:
      (req as OneUptimeRequest).rawFormUrlEncodedBody ?? null,
    limit: (req as OneUptimeRequest).requestBodyLimit?.bytes ?? null,
  };

  res.json(found);
};

interface Sent {
  how: string;
  headers: Record<string, string>;
  body: Buffer;
}

const RANDOM: SeededRandom = seededRandom(10702);

// Bytes drawn from the shared seeded generator.
const noise: (bytes: number) => Buffer = (bytes: number): Buffer => {
  const buffer: Buffer = Buffer.alloc(bytes);

  for (let offset: number = 0; offset + 4 <= bytes; offset += 4) {
    buffer.writeUInt32LE(RANDOM(4294967296), offset);
  }

  return buffer;
};

const JSON_TYPE: Record<string, string> = {
  "content-type": "application/json",
};
const RECORDS: Buffer = Buffer.from(
  JSON.stringify([
    { message: "order placed", level: "info" },
    { message: "ü 中" },
  ]),
);
const LINES: Buffer = Buffer.from(
  "<13>1 2026-11-22T10:00:00Z web-01 checkout - - order placed\n<11>1 2026-11-22T10:00:01Z web-01 checkout - - declined\n",
);

// Every kind of body the batches' clients send, and some none send.
const BODIES: Array<Sent> = [
  { how: "a JSON array", headers: JSON_TYPE, body: RECORDS },
  {
    how: "a JSON object",
    headers: JSON_TYPE,
    body: Buffer.from(JSON.stringify({ messages: ["a", "b"] })),
  },
  {
    how: "JSON with its charset",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: RECORDS,
  },
  { how: "an empty JSON body", headers: JSON_TYPE, body: Buffer.alloc(0) },
  {
    how: "a form",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: Buffer.from("a=1&b[c]=2&d=%C3%BC"),
  },
  {
    how: "protobuf",
    headers: { "content-type": "application/x-protobuf" },
    body: noise(4 * KIB),
  },
  {
    how: "Connect's protobuf",
    headers: { "content-type": "application/proto" },
    body: noise(4 * KIB),
  },
  {
    how: "gzip JSON",
    headers: { ...JSON_TYPE, "content-encoding": "gzip" },
    body: zlib.gzipSync(RECORDS),
  },
  {
    how: "gzip lines sent as JSON, as rsyslog's batches are",
    headers: { ...JSON_TYPE, "content-encoding": "gzip" },
    body: zlib.gzipSync(LINES),
  },
  {
    how: "gzip x-ndjson",
    headers: {
      "content-type": "application/x-ndjson",
      "content-encoding": "gzip",
    },
    body: zlib.gzipSync(LINES),
  },
  {
    how: "gzip protobuf",
    headers: {
      "content-type": "application/proto",
      "content-encoding": "gzip",
    },
    body: zlib.gzipSync(noise(4 * KIB)),
  },
  {
    how: "deflate JSON",
    headers: { ...JSON_TYPE, "content-encoding": "deflate" },
    body: zlib.deflateSync(RECORDS),
  },
  {
    how: "plain text, which no parser reads",
    headers: { "content-type": "text/plain" },
    body: LINES,
  },
  {
    how: "x-ndjson, which no parser reads",
    headers: { "content-type": "application/x-ndjson" },
    body: LINES,
  },
  { how: "a body with no type", headers: {}, body: RECORDS },
  {
    how: "JSON that does not parse",
    headers: JSON_TYPE,
    body: Buffer.from("[{ not json"),
  },
  {
    how: "JSON in a charset no parser reads",
    headers: { "content-type": "application/json; charset=latin1" },
    body: RECORDS,
  },
  {
    how: "JSON with more values than the route reads",
    headers: JSON_TYPE,
    body: Buffer.from(`[${"0,".repeat(LIMIT.values)}0]`),
  },
  {
    how: "gzip JSON with more values than the route reads",
    headers: { ...JSON_TYPE, "content-encoding": "gzip" },
    body: zlib.gzipSync(Buffer.from(`[${"0,".repeat(LIMIT.values)}0]`)),
  },
  {
    how: "JSON over the route's bytes",
    headers: JSON_TYPE,
    body: Buffer.from(JSON.stringify({ padding: "x".repeat(LIMIT.bytes) })),
  },
  {
    how: "a gzip bomb",
    headers: { ...JSON_TYPE, "content-encoding": "gzip" },
    body: zlib.gzipSync(Buffer.alloc(4 * LIMIT.bytes, 0x20)),
  },
  {
    how: "gzip that does not inflate",
    headers: { ...JSON_TYPE, "content-encoding": "gzip" },
    body: Buffer.from("not gzip at all, though it says so"),
  },
];

let server: BodyServer;

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();

  // As StartServer mounts it first: an answer to a body unread closes it.
  app.use(UnreadRequestBody.closeConnectionInstead);

  app.post("/before", ...readAsStartServer, checkKey, answerWhatArrived);
  app.post(
    "/after",
    checkKey,
    RequestBodyAfterAuthentication.readBody(LIMIT),
    answerWhatArrived,
  );
  app.post(
    "/after-json",
    checkKey,
    RequestBodyAfterAuthentication.readBody(LIMIT, { parseGzipJson: true }),
    answerWhatArrived,
  );
  // As the Fluent route reads its batches: records a line at a time too.
  app.post(
    "/after-lines",
    checkKey,
    RequestBodyAfterAuthentication.readBody(LIMIT, {
      parseGzipJson: true,
      readLines: true,
    }),
    answerWhatArrived,
  );
  // A body read before this ran - by StartServer, or a signature's check - is left as it is.
  app.post(
    "/read-twice",
    checkKey,
    RequestBodyAfterAuthentication.readBody(LIMIT),
    RequestBodyAfterAuthentication.readBody(LIMIT, { parseGzipJson: true }),
    answerWhatArrived,
  );

  app.use(expressErrorHandler);

  server = await startBodyServer(app);
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  (logger.error as unknown as jest.Mock).mockClear();
});

const send: (
  path: string,
  sent: Sent,
  chunked?: boolean,
) => Promise<SentRequest> = (
  path: string,
  sent: Sent,
  chunked?: boolean,
): Promise<SentRequest> => {
  return sendOverHttp(server, {
    path: path,
    headers: { ...sent.headers, "x-test-key": KEY },
    chunked: Boolean(chunked),
    body: sent.body,
  });
};

const answerOf: (sent: SentRequest) => unknown = (
  sent: SentRequest,
): unknown => {
  return { status: sent.answer.status, json: sent.answer.json };
};

describe("readBody hands a route the body StartServer handed it", () => {
  test.each(
    BODIES.map((sent: Sent): [string, Sent] => {
      return [sent.how, sent];
    }),
  )(
    "%s: the same body, kind, raw text and limit, or the same refusal, declared and chunked",
    async (_how: string, sent: Sent) => {
      for (const chunked of [false, true]) {
        const before: SentRequest = await send("/before", sent, chunked);
        const after: SentRequest = await send("/after", sent, chunked);

        expect(answerOf(after)).toEqual(answerOf(before));
      }

      // Nothing either way is the server's error.
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  test("JSON is parsed, with its text kept and the route's limit on it", async () => {
    const after: SentRequest = await send("/after", BODIES[0]!);

    expect(after.answer.json).toEqual({
      kind: "array",
      body: JSON.parse(RECORDS.toString("utf8")),
      rawBody: RECORDS.toString("utf8"),
      rawFormUrlEncodedBody: null,
      limit: LIMIT.bytes,
    });
  });

  test("a gzip body is its inflated bytes, whatever its type", async () => {
    const after: SentRequest = await send("/after", BODIES[8]!);

    expect(after.answer.json).toEqual({
      kind: "bytes",
      body: LINES.toString("hex"),
      rawBody: null,
      rawFormUrlEncodedBody: null,
      limit: LIMIT.bytes,
    });
  });

  test("a body read before is left as it is", async () => {
    for (const sent of [BODIES[0]!, BODIES[7]!, BODIES[5]!]) {
      expect(answerOf(await send("/read-twice", sent))).toEqual(
        answerOf(await send("/after", sent)),
      );
    }
  });
});

describe("parseGzipJson: a gzip JSON body is read as the same body uncompressed", () => {
  test("gzip JSON is parsed, its inflated text kept as rawBody, as the body uncompressed is", async () => {
    const uncompressed: SentRequest = await send("/after-json", BODIES[0]!);
    const gzipped: SentRequest = await send("/after-json", BODIES[7]!);

    expect(answerOf(gzipped)).toEqual(answerOf(uncompressed));
    expect((gzipped.answer.json as Found).kind).toBe("array");
  });

  test("a gzip body of no JSON type is left its inflated bytes", async () => {
    for (const sent of [BODIES[9]!, BODIES[10]!]) {
      expect(answerOf(await send("/after-json", sent))).toEqual(
        answerOf(await send("/after", sent)),
      );
    }
  });

  test("everything else is read as readBody reads it", async () => {
    for (const sent of BODIES.filter((candidate: Sent): boolean => {
      return !candidate.headers["content-encoding"]?.includes("gzip");
    })) {
      expect({
        how: sent.how,
        answer: answerOf(await send("/after-json", sent)),
      }).toEqual({
        how: sent.how,
        answer: answerOf(await send("/after", sent)),
      });
    }
  });

  test("gzip lines sent as JSON are no JSON: refused 400, as the lines uncompressed would be", async () => {
    const gzipped: SentRequest = await send("/after-json", BODIES[8]!);
    const uncompressed: SentRequest = await send("/after-json", {
      how: "lines sent as JSON",
      headers: JSON_TYPE,
      body: LINES,
    });

    expect(gzipped.answer.status).toBe(400);
    expect(answerOf(gzipped)).toEqual(answerOf(uncompressed));
  });

  test("gzip JSON with more values than the route reads is refused 413 before JSON.parse, in the words StartServer uses", async () => {
    const parse: ReturnType<typeof jest.spyOn> = jest.spyOn(JSON, "parse");

    const gzipped: SentRequest = await send("/after-json", BODIES[18]!);

    expect(answerOf(gzipped)).toEqual({
      status: 413,
      json: {
        error: getTooManyJsonValuesMessage(
          JsonElementLimit.Values,
          LIMIT.values,
        ),
      },
    });
    expect(
      (parse.mock.calls as Array<Array<unknown>>).some(
        (call: Array<unknown>): boolean => {
          return typeof call[0] === "string" && call[0].length > KIB;
        },
      ),
    ).toBe(false);

    parse.mockRestore();
  });
});

/*
 * readLines (#10769): newline-delimited JSON - Fluentd's HTTP output without
 * json_array, Fluent Bit's with format json_lines - is read as its values, a
 * line at a time, counted first; text as its bytes. Sent as it is, no
 * parser StartServer runs read either, so the route found no body; gzip-
 * compressed, it found the inflated bytes. Both are now read alike.
 */
describe("readLines: newline-delimited JSON is read as its values, and text as its bytes, gzip-compressed or not", () => {
  const RECORD_LINES: Array<Record<string, unknown>> = [
    { message: "order placed", level: "info" },
    { message: "ü 中", nested: { pod: "web-1" } },
  ];
  const NDJSON: Buffer = Buffer.from(
    RECORD_LINES.map((record: Record<string, unknown>): string => {
      return `${JSON.stringify(record)}\n`;
    }).join(""),
  );

  const encodings: Array<{ how: string; encode: (body: Buffer) => Sent }> = [
    {
      how: "as it is",
      encode: (body: Buffer): Sent => {
        return { how: "as it is", headers: {}, body: body };
      },
    },
    {
      how: "gzip",
      encode: (body: Buffer): Sent => {
        return {
          how: "gzip",
          headers: { "content-encoding": "gzip" },
          body: zlib.gzipSync(body),
        };
      },
    },
    {
      how: "deflate",
      encode: (body: Buffer): Sent => {
        return {
          how: "deflate",
          headers: { "content-encoding": "deflate" },
          body: zlib.deflateSync(body),
        };
      },
    },
  ];

  test.each([
    "application/x-ndjson",
    "application/ndjson",
    "application/jsonl",
    "application/x-ndjson; charset=utf-8",
  ])(
    "%s: its records, its text kept as rawBody, as it is, gzip and deflate, declared and chunked",
    async (contentType: string) => {
      for (const encoding of encodings) {
        const encoded: Sent = encoding.encode(NDJSON);

        for (const chunked of [false, true]) {
          const sent: SentRequest = await send(
            "/after-lines",
            {
              how: encoding.how,
              headers: { ...encoded.headers, "content-type": contentType },
              body: encoded.body,
            },
            chunked,
          );

          expect({ encoding: encoding.how, chunked, ...answerOf(sent) }).toEqual(
            {
              encoding: encoding.how,
              chunked,
              status: 200,
              json: {
                kind: "array",
                body: RECORD_LINES,
                rawBody: NDJSON.toString("utf8"),
                rawFormUrlEncodedBody: null,
                limit: LIMIT.bytes,
              },
            },
          );
        }
      }

      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  test("text lines between the records are kept as their text", async () => {
    const mixed: Buffer = Buffer.from(
      `order placed\n${JSON.stringify(RECORD_LINES[0])}\r\n  2026-11-22 WARN retrying  \n\n`,
    );

    for (const encoding of encodings) {
      const encoded: Sent = encoding.encode(mixed);
      const sent: SentRequest = await send("/after-lines", {
        how: encoding.how,
        headers: {
          ...encoded.headers,
          "content-type": "application/x-ndjson",
        },
        body: encoded.body,
      });

      expect((sent.answer.json as Found).body).toEqual([
        "order placed",
        RECORD_LINES[0],
        "2026-11-22 WARN retrying",
      ]);
    }
  });

  test("text (text/*) is its bytes, sent as it is as gzip-compressed: plain text was left unread", async () => {
    for (const contentType of ["text/plain", "text/csv; charset=utf-8"]) {
      const answers: Array<unknown> = [];

      for (const encoding of encodings) {
        const encoded: Sent = encoding.encode(LINES);

        answers.push(
          answerOf(
            await send("/after-lines", {
              how: encoding.how,
              headers: { ...encoded.headers, "content-type": contentType },
              body: encoded.body,
            }),
          ),
        );
      }

      expect(answers).toEqual([
        {
          status: 200,
          json: {
            kind: "bytes",
            body: LINES.toString("hex"),
            rawBody: null,
            rawFormUrlEncodedBody: null,
            limit: LIMIT.bytes,
          },
        },
        answers[0],
        answers[0],
      ]);
      // As readBody alone hands a gzip text body on.
      expect(answers[1]).toEqual(
        answerOf(
          await send("/after", {
            how: "gzip text",
            headers: { "content-type": contentType, "content-encoding": "gzip" },
            body: zlib.gzipSync(LINES),
          }),
        ),
      );
    }
  });

  test("every other body is read as parseGzipJson reads it", async () => {
    for (const sent of BODIES.filter((candidate: Sent): boolean => {
      const type: string = candidate.headers["content-type"] || "";
      return !type.includes("ndjson") && !type.startsWith("text/");
    })) {
      expect({
        how: sent.how,
        answer: answerOf(await send("/after-lines", sent)),
      }).toEqual({
        how: sent.how,
        answer: answerOf(await send("/after-json", sent)),
      });
    }
  });

  test("past the route's values it is refused 413 before a long line is parsed, as it is and gzip-compressed alike", async () => {
    const line: string = `[${"0,".repeat(400)}0]\n`;
    const over: Buffer = Buffer.from(line.repeat(3));
    const parse: ReturnType<typeof jest.spyOn> = jest.spyOn(JSON, "parse");

    try {
      for (const encoding of encodings) {
        const encoded: Sent = encoding.encode(over);
        const sent: SentRequest = await send("/after-lines", {
          how: encoding.how,
          headers: {
            ...encoded.headers,
            "content-type": "application/x-ndjson",
          },
          body: encoded.body,
        });

        expect(answerOf(sent)).toEqual({
          status: 413,
          json: {
            error: getTooManyJsonValuesMessage(
              JsonElementLimit.Values,
              LIMIT.values,
            ),
          },
        });
      }

      // Two lines fit the 1,000 values; the third, which passes them, was never parsed.
      expect(
        (parse.mock.calls as Array<Array<unknown>>).filter(
          (call: Array<unknown>): boolean => {
            return typeof call[0] === "string" && call[0].startsWith("[0,");
          },
        ),
      ).toHaveLength(2 * encodings.length);
    } finally {
      parse.mockRestore();
    }

    expect(logger.error).not.toHaveBeenCalled();
  });

  test("past the route's bytes it is refused 413 in the words every body over its limit gets: declared unread, chunked at the limit, gzip as it inflates", async () => {
    const big: Buffer = Buffer.from(
      `${JSON.stringify({ message: "x".repeat(64) })}\n`.repeat(
        Math.ceil((2 * LIMIT.bytes) / 80),
      ),
    );
    const words: unknown = answerOf(
      await send("/after-json", {
        how: "JSON over the route's bytes",
        headers: JSON_TYPE,
        body: Buffer.from(JSON.stringify({ padding: "x".repeat(LIMIT.bytes) })),
      }),
    );

    for (const chunked of [false, true]) {
      const sent: SentRequest = await sendOverHttp(server, {
        path: "/after-lines",
        headers: { "content-type": "application/x-ndjson", "x-test-key": KEY },
        chunked: chunked,
        body: big,
      });

      expect(answerOf(sent)).toEqual(words);
      expect(sent.answer.connection).toBe("close");

      const read: number = await server.readInAll(sent.tag);

      expect(read).toBeLessThanOrEqual(
        chunked ? LIMIT.bytes + READ_OR_TWO : READ_OR_TWO,
      );
    }

    const bomb: SentRequest = await send("/after-lines", {
      how: "a gzip bomb of lines",
      headers: {
        "content-type": "application/x-ndjson",
        "content-encoding": "gzip",
      },
      body: zlib.gzipSync(big),
    });

    expect(answerOf(bomb)).toEqual(words);
  });

  test.each([...CONNECTIONS])(
    "with no key, 40 MiB of it, declared or chunked, gzip or not, have a socket read or two read (%s)",
    async (connection: Connection) => {
      const lines: Buffer = Buffer.from(
        `${JSON.stringify({ message: "a".repeat(1000) })}\n`.repeat(
          (40 * MIB) / 1024,
        ),
      );

      for (const sent of [
        { headers: { "content-type": "application/x-ndjson" }, body: lines },
        {
          headers: {
            "content-type": "application/x-ndjson",
            "content-encoding": "gzip",
          },
          body: zlib.gzipSync(lines),
        },
      ]) {
        for (const chunked of [false, true]) {
          const refused: SentRequest = await sendOverHttp(server, {
            path: "/after-lines",
            headers: sent.headers,
            connection: connection,
            chunked: chunked,
            body: sent.body,
          });

          expect(refused.answer.status).toBe(401);
          expect(await server.readInAll(refused.tag)).toBeLessThanOrEqual(
            READ_OR_TWO,
          );
        }
      }
    },
  );
});

describe("a request the key check refuses has nothing of its body read", () => {
  test.each([...CONNECTIONS])(
    "40 MiB of JSON, declared or chunked, gzip or not: refused, a socket read or two read (%s)",
    async (connection: Connection) => {
      const bodies: Array<Sent> = [
        {
          how: "JSON",
          headers: JSON_TYPE,
          body: Buffer.from(
            JSON.stringify({ messages: ["a".repeat(40 * MIB)] }),
          ),
        },
        {
          how: "gzip JSON",
          headers: { ...JSON_TYPE, "content-encoding": "gzip" },
          body: zlib.gzipSync(
            Buffer.from(JSON.stringify({ messages: ["a".repeat(40 * MIB)] })),
          ),
        },
      ];

      for (const sent of bodies) {
        for (const chunked of [false, true]) {
          for (const path of ["/after", "/after-json"]) {
            const refused: SentRequest = await sendOverHttp(server, {
              path: path,
              headers: sent.headers,
              connection: connection,
              chunked: chunked,
              body: sent.body,
            });

            expect(refused.answer.status).toBe(401);
            expect(refused.answer.clientError).toBeNull();

            /*
             * Closed under the rest - but a body of no more than 64 KiB (the
             * gzip one, 40 MiB of one byte compressed) is read off and keeps
             * its connection, as every unread body does (UnreadRequestBody).
             * Read off, never inflated.
             */
            if (sent.body.length > UNREAD_BODY_READ_OFF_BYTES) {
              expect(refused.answer.connection).toBe("close");
            }

            expect(await server.readInAll(refused.tag)).toBeLessThanOrEqual(
              READ_OR_TWO,
            );
          }
        }
      }
    },
  );
});
