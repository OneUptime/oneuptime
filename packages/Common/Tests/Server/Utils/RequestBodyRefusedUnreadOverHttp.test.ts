jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("ERROR"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import Express, {
  ExpressApplication,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import {
  INFLATE_FAILED_TYPE,
  REQUEST_BODY_REFUSAL_MESSAGES,
  getTooLargeForRouteMessage,
} from "../../../Server/Utils/RequestBodyRefusal";
import { ORDINARY_REQUEST_BODY_LIMIT } from "../../../Server/Utils/RequestBodyLimit";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { execFile } from "child_process";
import express from "express";
import http from "http";
import { AddressInfo, Socket } from "net";
import timers from "timers";
import zlib from "zlib";

/*
 * A REFUSED BODY IS NOT READ TO ITS END, AND ITS CLIENT STILL READS THE
 * ANSWER (#10598); A BODY THAT DOES NOT INFLATE IS THE CLIENT'S (#10597).
 *
 * Through StartServer's own middleware, as every OneUptime service mounts
 * it, behind a real socket, with real clients: Node's http client on a
 * connection it asks to keep and on one it asks to close (the probe and the
 * CLI send with it), and fetch (an OpenTelemetry exporter in Node, the
 * browsers' API), in a process of its own.
 *
 * Measured before: 64 MiB sent to an ordinary route, held to 1 MB, were read
 * - every byte - before the 413 was sent, a chunked body for as long as the
 * client sent, and the same for a body of a type no parser reads, after the
 * route's answer. A gzip body that did not inflate was a 500 and an error-
 * level log line, from any client. Here every such body is answered, and
 * what the server read off the connection in all - the answer, and after
 * it - is counted: a socket read or two past the route's limit, at most.
 */

// jsdom has no setImmediate, and Express needs it.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

// A refused connection is held at most a couple of seconds once answered.
jest.setTimeout(120000);

const KIB: number = 1024;
const MIB: number = 1024 * 1024;

// The most an ordinary route takes, and a socket read or two past it.
const LIMIT: number = ORDINARY_REQUEST_BODY_LIMIT.bytes;
const READ_OR_TWO: number = 512 * KIB;

// What every client sends of a refused body, at most: far more than is read.
const SENT: number = 64 * MIB;

const ROUTE: string = "/api/monitor/get-list";

let server: http.Server;
let port: number;

// What the server read off each request's connection, by its tag.
interface ConnectionRead {
  // Resolves once the server has closed it, with all it read off it.
  closed: Promise<number>;
}

const connections: Map<string, ConnectionRead> = new Map();

// What the route was handed, by tag: a refused body never reaches it.
const reached: Array<string> = [];

beforeAll(async () => {
  // The App's own express app: importing StartServer mounted its middleware.
  const app: ExpressApplication = Express.getExpressApp();

  // An ordinary route that answers without reading what it is not given.
  app.post(ROUTE, (req: express.Request, res: express.Response) => {
    reached.push(String(req.headers["x-test"] || ""));
    res.send({ isBuffer: Buffer.isBuffer(req.body) });
  });

  app.use(expressErrorHandler);

  server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      const tag: string = String(req.headers["x-test"] || "");
      const socket: Socket = req.socket;

      connections.set(tag, {
        closed: new Promise<number>((resolve: (bytes: number) => void) => {
          socket.once("close", () => {
            resolve(socket.bytesRead);
          });
        }),
      });

      app(req as express.Request, res as express.Response);
    },
  );
  server.keepAliveTimeout = 60000;

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();

  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  reached.length = 0;
});

interface Answer {
  status: number | null;
  connection: string | null;
  body: Record<string, unknown>;
  // What the client was told when the server closed under its body.
  clientError: string | null;
}

type Connection = "keep-alive" | "close";

let count: number = 0;

function nextTag(): string {
  return `request-${++count}`;
}

/*
 * Sends `bytes` of `fill` - or `body` - to the route with Node's http client,
 * 64 KiB at a time as the socket takes them, with a Content-Length or
 * chunked, until the body is sent or the server has answered and closed.
 */
function send(data: {
  tag: string;
  headers: Record<string, string>;
  connection: Connection;
  chunked: boolean;
  bytes?: number;
  body?: Buffer;
}): Promise<Answer> {
  const agent: http.Agent = new http.Agent({
    keepAlive: data.connection === "keep-alive",
  });
  const body: Buffer | null = data.body || null;
  const total: number = body ? body.length : data.bytes || 0;

  return new Promise<Answer>((resolve: (answer: Answer) => void) => {
    const answer: Answer = {
      status: null,
      connection: null,
      body: {},
      clientError: null,
    };
    let isDone: boolean = false;

    const finish: () => void = (): void => {
      if (isDone) {
        return;
      }

      isDone = true;
      agent.destroy();
      resolve(answer);
    };

    const headers: Record<string, string> = {
      ...data.headers,
      "x-test": data.tag,
    };

    if (!data.chunked) {
      headers["content-length"] = String(total);
    }

    const request: http.ClientRequest = http.request(
      {
        host: "127.0.0.1",
        port: port,
        path: ROUTE,
        method: "POST",
        agent: agent,
        headers: headers,
      },
      (response: http.IncomingMessage) => {
        const chunks: Array<Buffer> = [];

        answer.status = response.statusCode || 0;
        answer.connection = response.headers["connection"] || null;

        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          const text: string = Buffer.concat(chunks).toString("utf8");

          try {
            answer.body = JSON.parse(text) as Record<string, unknown>;
          } catch {
            answer.body = { raw: text };
          }

          finish();
        });
      },
    );

    request.on("error", (err: NodeJS.ErrnoException) => {
      answer.clientError = err.code || err.message;

      // The answer may still be on its way: it is what is checked.
      timers.setTimeout(finish, 1000);
    });

    const piece: Buffer = Buffer.alloc(64 * KIB, 0x20);
    let offset: number = 0;

    const write: () => void = (): void => {
      while (offset < total && !isDone && answer.clientError === null) {
        const next: Buffer = body
          ? body.subarray(offset, offset + piece.length)
          : piece.subarray(0, Math.min(piece.length, total - offset));

        offset += next.length;

        if (!request.write(next)) {
          request.once("drain", write);
          return;
        }
      }

      if (offset >= total) {
        request.end();
      }
    };

    write();
  });
}

/*
 * Sends the body with fetch, in a Node process of its own (jest's
 * environment has no fetch): `bytes` of spaces as a stream, chunked, or with
 * the Content-Length given.
 */
function sendWithFetch(data: {
  tag: string;
  headers: Record<string, string>;
  bytes: number;
}): Promise<Answer> {
  const script: string = `
    const [url, headersJson, bytesText] = process.argv.slice(1);
    const total = Number(bytesText);
    const piece = new Uint8Array(64 * 1024).fill(32);
    let offset = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (offset >= total) { controller.close(); return; }
        const size = Math.min(piece.length, total - offset);
        offset += size;
        controller.enqueue(piece.subarray(0, size));
      },
    });
    fetch(url, { method: "POST", headers: JSON.parse(headersJson), body, duplex: "half" })
      .then(async (res) => {
        const text = await res.text();
        process.stdout.write(JSON.stringify({ status: res.status, connection: res.headers.get("connection"), text }));
      })
      .catch((err) => {
        process.stdout.write(JSON.stringify({ error: String((err.cause && (err.cause.code || err.cause.message)) || err.message) }));
      });
  `;

  return new Promise<Answer>((resolve: (answer: Answer) => void) => {
    execFile(
      process.execPath,
      [
        "-e",
        script,
        `http://127.0.0.1:${port}${ROUTE}`,
        JSON.stringify({ ...data.headers, "x-test": data.tag }),
        String(data.bytes),
      ],
      { timeout: 60000 },
      (_error: Error | null, stdout: string) => {
        const seen: {
          status?: number;
          connection?: string | null;
          text?: string;
          error?: string;
        } = JSON.parse(stdout || "{}");

        let body: Record<string, unknown> = {};

        try {
          body = JSON.parse(seen.text || "{}") as Record<string, unknown>;
        } catch {
          body = { raw: seen.text };
        }

        resolve({
          status: seen.status ?? null,
          connection: seen.connection ?? null,
          body: body,
          clientError: seen.error ?? null,
        });
      },
    );
  });
}

// All the server read off the request's connection, once it closed it.
function readInAll(tag: string): Promise<number> {
  return connections.get(tag)!.closed;
}

const CONNECTIONS: Array<Connection> = ["keep-alive", "close"];

const KINDS: Array<[string, Record<string, string>]> = [
  ["JSON", { "content-type": "application/json" }],
  ["a form", { "content-type": "application/x-www-form-urlencoded" }],
  ["protobuf", { "content-type": "application/x-protobuf" }],
];

describe("a body over the route's limit", () => {
  for (const [kind, headers] of KINDS) {
    for (const connection of CONNECTIONS) {
      test(`${kind}, declared over it: answered 413 before a byte is read, the connection closed (${connection})`, async () => {
        const tag: string = nextTag();
        const answer: Answer = await send({
          tag: tag,
          headers: headers,
          connection: connection,
          chunked: false,
          bytes: SENT,
        });

        expect(answer.status).toBe(413);
        expect(answer.connection).toBe("close");
        expect(answer.body).toEqual({
          error: getTooLargeForRouteMessage(LIMIT),
        });
        expect(await readInAll(tag)).toBeLessThanOrEqual(READ_OR_TWO);
        expect(reached).toEqual([]);
        expect(logger.error).not.toHaveBeenCalled();
      });

      test(`${kind}, chunked past it: answered 413 at the limit, the connection closed (${connection})`, async () => {
        const tag: string = nextTag();
        const answer: Answer = await send({
          tag: tag,
          headers: headers,
          connection: connection,
          chunked: true,
          bytes: SENT,
        });

        expect(answer.status).toBe(413);
        expect(answer.connection).toBe("close");
        expect(answer.body).toEqual({
          error: getTooLargeForRouteMessage(LIMIT),
        });

        const read: number = await readInAll(tag);

        expect(read).toBeGreaterThan(LIMIT);
        expect(read).toBeLessThanOrEqual(LIMIT + READ_OR_TWO);
        expect(reached).toEqual([]);
        expect(logger.error).not.toHaveBeenCalled();
      });
    }
  }

  test.each([
    ["declared", { "content-length": String(SENT) }],
    ["chunked", {}],
  ])(
    "sent with fetch, %s: the 413 is read, and the connection closed",
    async (_how: string, extra: Record<string, string>) => {
      const tag: string = nextTag();
      const answer: Answer = await sendWithFetch({
        tag: tag,
        headers: { "content-type": "application/json", ...extra },
        bytes: SENT,
      });

      expect(answer.clientError).toBeNull();
      expect(answer.status).toBe(413);
      expect(answer.connection).toBe("close");
      expect(answer.body).toEqual({
        error: getTooLargeForRouteMessage(LIMIT),
      });
      expect(await readInAll(tag)).toBeLessThanOrEqual(LIMIT + READ_OR_TWO);
    },
  );
});

/*
 * #10597: any client could have the App answer 500 and log an error, with
 * its stack, once a request: the gzip reader runs before routing, on every
 * route, before any key is checked.
 */
describe("a body that does not inflate", () => {
  for (const encoding of ["gzip", "deflate"]) {
    test(`${encoding}: answered 400 in a sentence of its own, logged at debug and never at error`, async () => {
      for (const connection of CONNECTIONS) {
        const tag: string = nextTag();
        const answer: Answer = await send({
          tag: tag,
          headers: {
            "content-type": "application/json",
            "content-encoding": encoding,
          },
          connection: connection,
          chunked: false,
          body: Buffer.from(`this is not ${encoding}`),
        });

        expect(answer.status).toBe(400);
        expect(answer.body).toEqual({
          error: REQUEST_BODY_REFUSAL_MESSAGES.notInflated,
        });
        expect(reached).toEqual([]);
      }

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(
        (
          logger.debug as unknown as { mock: { calls: Array<Array<unknown>> } }
        ).mock.calls.filter((call: Array<unknown>): boolean => {
          return String(call[0]).includes(INFLATE_FAILED_TYPE);
        }),
      ).toHaveLength(2);
    });

    test(`${encoding}, 40 MiB of it chunked: refused at its first bytes, the rest unread`, async () => {
      const tag: string = nextTag();
      const answer: Answer = await send({
        tag: tag,
        headers: {
          "content-type": "application/json",
          "content-encoding": encoding,
        },
        connection: "keep-alive",
        chunked: true,
        body: Buffer.concat([
          Buffer.from(`this is not ${encoding}`),
          Buffer.alloc(40 * MIB, 1),
        ]),
      });

      expect(answer.status).toBe(400);
      expect(answer.connection).toBe("close");
      expect(await readInAll(tag)).toBeLessThanOrEqual(READ_OR_TWO);
      expect(logger.error).not.toHaveBeenCalled();
    });
  }

  test("a gzip bomb is still refused at the limit as it inflates, its connection closed", async () => {
    const tag: string = nextTag();
    const answer: Answer = await send({
      tag: tag,
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      connection: "keep-alive",
      chunked: true,
      body: zlib.gzipSync(Buffer.alloc(64 * MIB, 0x20)),
    });

    expect(answer.status).toBe(413);
    expect(answer.connection).toBe("close");
    expect(await readInAll(tag)).toBeLessThanOrEqual(READ_OR_TWO);
  });
});

/*
 * A body of a type no parser reads reaches the route unread. Node read the
 * rest of it off once the route had answered - 64 MiB, in full - to keep the
 * connection: now the connection is closed instead (UnreadRequestBody).
 */
describe("a body nobody reads", () => {
  for (const connection of CONNECTIONS) {
    for (const chunked of [false, true]) {
      test(`answered by the route, ${chunked ? "chunked" : "declared"}: the connection closed, the rest unread (${connection})`, async () => {
        const tag: string = nextTag();
        const answer: Answer = await send({
          tag: tag,
          headers: { "content-type": "text/plain" },
          connection: connection,
          chunked: chunked,
          bytes: SENT,
        });

        expect(answer.status).toBe(200);
        expect(answer.connection).toBe("close");
        expect(reached).toEqual([tag]);
        expect(await readInAll(tag)).toBeLessThanOrEqual(READ_OR_TWO);
      });
    }
  }

  test("sent with fetch: the route's answer is read, and the connection closed", async () => {
    const tag: string = nextTag();
    const answer: Answer = await sendWithFetch({
      tag: tag,
      headers: { "content-type": "application/octet-stream" },
      bytes: SENT,
    });

    expect(answer.clientError).toBeNull();
    expect(answer.status).toBe(200);
    expect(answer.connection).toBe("close");
    expect(await readInAll(tag)).toBeLessThanOrEqual(READ_OR_TWO);
  });
});

describe("a body read whole", () => {
  test.each([
    [
      "JSON",
      { "content-type": "application/json" },
      Buffer.from('{"query":{"name":"API"}}'),
    ],
    [
      "gzip JSON",
      { "content-type": "application/json", "content-encoding": "gzip" },
      zlib.gzipSync(Buffer.from('{"query":{"name":"API"}}')),
    ],
    [
      "deflate JSON",
      { "content-type": "application/json", "content-encoding": "deflate" },
      zlib.deflateSync(Buffer.from('{"query":{"name":"API"}}')),
    ],
    ["a small text nobody reads", { "content-type": "text/plain" }, Buffer.from("ok")],
  ])(
    "%s keeps its connection, as the client asked",
    async (
      _kind: string,
      headers: Record<string, string>,
      body: Buffer,
    ) => {
      const tag: string = nextTag();
      const answer: Answer = await send({
        tag: tag,
        headers: headers,
        connection: "keep-alive",
        chunked: false,
        body: body,
      });

      expect(answer.status).toBe(200);
      expect(answer.connection).toBe("keep-alive");
      expect(answer.clientError).toBeNull();
    },
  );

  test("a body just at the limit is read and answered by the route", async () => {
    const tag: string = nextTag();
    const body: Buffer = Buffer.alloc(LIMIT, 0x20);

    body[0] = 0x7b; // {
    body[LIMIT - 1] = 0x7d; // }

    const answer: Answer = await send({
      tag: tag,
      headers: { "content-type": "application/json" },
      connection: "keep-alive",
      chunked: true,
      body: body,
    });

    expect(answer.status).toBe(200);
    expect(answer.connection).toBe("keep-alive");
    expect(reached).toEqual([tag]);
  });
});
