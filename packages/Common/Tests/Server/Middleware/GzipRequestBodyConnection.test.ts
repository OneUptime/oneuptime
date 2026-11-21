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
 * (#10260), over HTTP.
 *
 * GzipRequestBody refuses a body over its route's limit - as sent, as it
 * inflates, by its values - before the rest of it is read, and stops reading
 * it. It counted on Node to close the connection then, and Node does so only
 * for a client that asked for it to be closed. A keep-alive client's
 * connection was held open, its body paused unread, until the server's
 * keep-alive timeout; one whose body was refused on its Content-Length before
 * a byte was read was drained - every byte the client sent read and thrown
 * away - and a body that did not inflate was drained the same way. Every
 * such answer now closes its connection once it is sent. Here the clients
 * ask to keep their connections, and the server's keep-alive timeout is a
 * minute, so a connection left open would outlast the test.
 */

const KIB: number = 1024;
const MIB: number = 1024 * 1024;

const LIMIT: RequestBodyLimit = {
  bytes: MIB,
  values: 1000,
  objectsArraysAndStrings: 1000,
};

interface Answer {
  status: number;
  connection: string | undefined;
  // What the server read off the connection by the time it answered.
  bytesRead: number;
  // Resolves once the server has closed the connection.
  serverClosed: Promise<void>;
}

let server: http.Server;
let port: number;

const requests: Map<string, { bytesRead: number; closed: Promise<void> }> =
  new Map();

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();

  app.use((req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    const tag: string = String(req.headers["x-test"] || "");
    const closed: Promise<void> = new Promise<void>((resolve: () => void) => {
      req.socket.once("close", () => {
        resolve();
      });
    });

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

/*
 * A request on a connection of its own, which asks to be kept alive; the
 * body is sent whole, or - `declared` - only its first `body`, under a
 * Content-Length that says more.
 */
function post(data: {
  body: Buffer;
  path?: string;
  contentType?: string;
  declared?: number;
}): Promise<Answer> {
  const agent: http.Agent = new http.Agent({ keepAlive: true });
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
          response.resume();
          response.on("end", () => {
            const seen: { bytesRead: number; closed: Promise<void> } =
              requests.get(tag)!;

            resolve({
              status: response.statusCode || 0,
              connection: response.headers["connection"],
              bytesRead: seen.bytesRead,
              serverClosed: seen.closed.then(() => {
                agent.destroy();
              }),
            });
          });
        },
      );

      // A server that answered before reading the body closes under it.
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
  test("inflating past the limit: answered 413, and closed, with the rest unread", async () => {
    const answer: Answer = await post({
      body: zlib.gzipSync(Buffer.alloc(64 * MIB)),
    });

    expect(answer.status).toBe(413);
    expect(answer.connection).toBe("close");
    await answer.serverClosed;
  });

  test("past the limit's values as it inflates: answered 413, and closed", async () => {
    const answer: Answer = await post({
      body: zlib.gzipSync(Buffer.from(`[${"{},".repeat(2000000)}{}]`)),
    });

    expect(answer.status).toBe(413);
    expect(answer.connection).toBe("close");
    await answer.serverClosed;
  }, 60000);

  test("a Content-Length past the limit: answered 413 and closed, not drained - 8 MiB sent, a socket read or two read", async () => {
    const answer: Answer = await post({
      body: Buffer.alloc(8 * MIB, 1),
      declared: 64 * MIB,
    });

    expect(answer.status).toBe(413);
    expect(answer.connection).toBe("close");
    await answer.serverClosed;
    expect(answer.bytesRead).toBeLessThanOrEqual(512 * KIB);
  });

  test("a body that does not inflate: answered, and closed, not drained - 40 MiB sent, a socket read or two read", async () => {
    const answer: Answer = await post({
      path: "/gzip-large",
      body: Buffer.concat([
        Buffer.from("this is not gzip"),
        Buffer.alloc(40 * MIB, 1),
      ]),
      contentType: "application/octet-stream",
    });

    expect(answer.status).toBe(500);
    expect(answer.connection).toBe("close");
    await answer.serverClosed;
    expect(answer.bytesRead).toBeLessThanOrEqual(512 * KIB);
  });
});

describe("a gzip body read whole", () => {
  test("keeps its connection, as the client asked", async () => {
    const answer: Answer = await post({
      body: zlib.gzipSync(Buffer.from('{"rows":[1,2,3]}')),
    });

    expect(answer.status).toBe(200);
    expect(answer.connection).toBe("keep-alive");
  });
});
