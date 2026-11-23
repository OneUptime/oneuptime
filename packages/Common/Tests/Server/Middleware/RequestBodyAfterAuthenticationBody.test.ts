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
