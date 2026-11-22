jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import GzipRequestBodyMiddleware from "../../../Server/Middleware/GzipRequestBody";
import {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  createExpressApp,
} from "../../../Server/Utils/Express";
import {
  LARGE_REQUEST_BODY_LIMIT,
  RequestBodyLimit,
} from "../../../Server/Utils/RequestBodyLimit";
import { INFLATE_FAILED_TYPE } from "../../../Server/Utils/RequestBodyRefusal";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";
import zlib from "zlib";

/*
 * A REFUSED GZIP BODY'S CONNECTION IS CLOSED, NOT HELD OPEN OR DRAINED
 * (#10260), AND ITS ANSWER STILL REACHES THE CLIENT (#10598), over HTTP.
 *
 * GzipRequestBody refuses a body over its route's limit - as sent, as it
 * inflates, by its values - before the rest of it is read, and stops reading
 * it. It counted on Node to close the connection then, and Node does so only
 * for a client that asked for it to be closed. A keep-alive client's
 * connection was held open, its body paused unread, until the server's
 * keep-alive timeout; one whose body was refused on its Content-Length before
 * a byte was read was drained - every byte the client sent read and thrown
 * away - and a body that did not inflate was drained the same way. Every
 * such answer now closes its connection once it is sent: half-closed, the
 * rest of the body unread, so that the client still reads the answer before
 * the connection goes (closeConnectionAfterAnswer). Here the clients ask to
 * keep their connections, or to close them, and the server's keep-alive
 * timeout is a minute, so a connection left open would outlast the test.
 */

// The connection is held at most a couple of seconds once answered.
jest.setTimeout(60000);

const KIB: number = 1024;
const MIB: number = 1024 * 1024;

const LIMIT: RequestBodyLimit = {
  bytes: MIB,
  values: 1000,
  objectsArraysAndStrings: 1000,
};

interface Answer {
  status: number;
  type: unknown;
  connection: string | undefined;
  // What the server read off the connection by the time it answered.
  bytesRead: number;
  /*
   * Resolves once the server has closed the connection, with what it read
   * off it in all, the answer and after it.
   */
  serverClosed: Promise<number>;
}

let server: http.Server;
let port: number;

const requests: Map<string, { bytesRead: number; closed: Promise<number> }> =
  new Map();

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();

  app.use((req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    const tag: string = String(req.headers["x-test"] || "");
    const closed: Promise<number> = new Promise<number>(
      (resolve: (bytes: number) => void) => {
        req.socket.once("close", () => {
          resolve(req.socket.bytesRead);
        });
      },
    );

    requests.set(tag, { bytesRead: 0, closed: closed });

    res.on("finish", () => {
      requests.set(tag, { bytesRead: req.socket.bytesRead, closed: closed });
    });

    next();
  });

  // A route held to a small limit, and one to a large route's 50 MiB.
  for (const [path, limit] of [
    ["/gzip", LIMIT],
    ["/gzip-large", LARGE_REQUEST_BODY_LIMIT],
  ] as Array<[string, RequestBodyLimit]>) {
    app.post(
      path,
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        GzipRequestBodyMiddleware.parseBody(req, res, next, limit);
      },
      (req: ExpressRequest, res: ExpressResponse) => {
        res.json({ bytes: (req.body as Buffer).length });
      },
    );
  }

  app.use(
    (
      err: Record<string, unknown>,
      _req: ExpressRequest,
      res: ExpressResponse,
      _next: NextFunction,
    ): void => {
      res.status(Number(err["status"]) || 500).json({ type: err["type"] });
    },
  );

  server = http.createServer(app);
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

let count: number = 0;

type Connection = "keep-alive" | "close";

const CONNECTIONS: Array<Connection> = ["keep-alive", "close"];

/*
 * A request on a connection of its own, which asks to be kept alive or to be
 * closed; the body is sent whole, or - `declared` - only its first `body`,
 * under a Content-Length that says more.
 */
function post(data: {
  body: Buffer;
  connection: Connection;
  path?: string;
  contentType?: string;
  declared?: number;
}): Promise<Answer> {
  const agent: http.Agent = new http.Agent({
    keepAlive: data.connection === "keep-alive",
  });
  const tag: string = `request-${++count}`;

  return new Promise<Answer>(
    (resolve: (answer: Answer) => void, reject: (err: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: data.path || "/gzip",
          method: "POST",
          agent: agent,
          headers: {
            "content-type": data.contentType || "application/json",
            "content-encoding": "gzip",
            "content-length": String(data.declared || data.body.length),
            "x-test": tag,
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            const seen: { bytesRead: number; closed: Promise<number> } =
              requests.get(tag)!;

            resolve({
              status: response.statusCode || 0,
              type: (
                JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
                  type?: unknown;
                }
              ).type,
              connection: response.headers["connection"],
              bytesRead: seen.bytesRead,
              serverClosed: seen.closed.then((bytes: number) => {
                agent.destroy();
                return bytes;
              }),
            });
          });
        },
      );

      /*
       * The server closes the connection under the rest of a refused body,
       * once its answer is on its way: the answer has arrived by then.
       */
      request.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "EPIPE" && err.code !== "ECONNRESET") {
          reject(err);
        }
      });

      if (data.declared) {
        request.write(data.body);
        return;
      }

      request.end(data.body);
    },
  );
}

describe("a refused gzip body's connection", () => {
  test.each(CONNECTIONS)(
    "inflating past the limit: answered 413, and closed, with the rest unread (%s)",
    async (connection: Connection) => {
      const answer: Answer = await post({
        connection: connection,
        body: zlib.gzipSync(Buffer.alloc(64 * MIB)),
      });

      expect(answer.status).toBe(413);
      expect(answer.connection).toBe("close");
      await answer.serverClosed;
    },
  );

  test.each(CONNECTIONS)(
    "past the limit's values as it inflates: answered 413, and closed (%s)",
    async (connection: Connection) => {
      const answer: Answer = await post({
        connection: connection,
        body: zlib.gzipSync(Buffer.from(`[${"{},".repeat(2000000)}{}]`)),
      });

      expect(answer.status).toBe(413);
      expect(answer.connection).toBe("close");
      await answer.serverClosed;
    },
  );

  test.each(CONNECTIONS)(
    "a Content-Length past the limit: answered 413 and closed, not drained - 8 MiB sent, a socket read or two read in all (%s)",
    async (connection: Connection) => {
      const answer: Answer = await post({
        connection: connection,
        body: Buffer.alloc(8 * MIB, 1),
        declared: 64 * MIB,
      });

      expect(answer.status).toBe(413);
      expect(answer.connection).toBe("close");
      expect(answer.bytesRead).toBeLessThanOrEqual(512 * KIB);
      // Nothing more is read once answered: Node used to drain the rest.
      expect(await answer.serverClosed).toBeLessThanOrEqual(512 * KIB);
    },
  );

  test.each(CONNECTIONS)(
    "a body that does not inflate: answered 400 as the client's, and closed, not drained - 40 MiB sent, a socket read or two read in all (%s)",
    async (connection: Connection) => {
      const answer: Answer = await post({
        connection: connection,
        path: "/gzip-large",
        body: Buffer.concat([
          Buffer.from("this is not gzip"),
          Buffer.alloc(40 * MIB, 1),
        ]),
        contentType: "application/octet-stream",
      });

      expect(answer.status).toBe(400);
      expect(answer.type).toBe(INFLATE_FAILED_TYPE);
      expect(answer.connection).toBe("close");
      expect(answer.bytesRead).toBeLessThanOrEqual(512 * KIB);
      expect(await answer.serverClosed).toBeLessThanOrEqual(512 * KIB);
    },
  );
});

describe("a gzip body read whole", () => {
  test("keeps its connection, as the client asked", async () => {
    const answer: Answer = await post({
      connection: "keep-alive",
      body: zlib.gzipSync(Buffer.from('{"rows":[1,2,3]}')),
    });

    expect(answer.status).toBe(200);
    expect(answer.connection).toBe("keep-alive");
  });

  test("closes it, when the client asked that", async () => {
    const answer: Answer = await post({
      connection: "close",
      body: zlib.gzipSync(Buffer.from('{"rows":[1,2,3]}')),
    });

    expect(answer.status).toBe(200);
    expect(answer.connection).toBe("close");
    await answer.serverClosed;
  });
});
