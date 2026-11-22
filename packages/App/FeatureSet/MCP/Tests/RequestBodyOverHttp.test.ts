/*
 * THE MCP ENDPOINT AND THE MCP OAUTH ENDPOINTS READ A GZIP BODY, AND NEVER
 * READ ONE PAST ITS LIMIT (#10643), over HTTP, through StartServer's own
 * middleware - as the App mounts it - and the real routes, with real
 * clients.
 *
 * Each of these routes runs a JSON or form parser of its own, after
 * StartServer. StartServer inflates a gzip body before routing and leaves
 * its bytes in req.body, unparsed; the route's parser - body-parser on its
 * own - read the spent stream again, and a VALID gzip body was answered 500,
 * "The server ran into a problem it could not explain", with an error-level
 * log line, for any client. Now the route's parser reads the bytes
 * StartServer inflated (RequestBodyParser): a gzip body is answered as the
 * same body sent uncompressed is. And what #10597 and #10598 hold every
 * route to holds here: a gzip body that does not inflate is a 400 logged at
 * debug, a gzip bomb and a body over the route's limit are 413s with no
 * more than a socket read or two read past the limit, the connection
 * closed.
 *
 * The OAuth endpoints' limit is their own, 64 KB (#10672): it held only a
 * gzip body, which StartServer only inflates for the route's parser, while
 * an uncompressed one StartServer parsed first, at the ordinary 1 MB. Now
 * StartServer holds every body there to the 64 KB, whatever its encoding,
 * and answers it alike.
 */

// Tool calls would reach the API: none is made here.
jest.mock("../Services/OneUptimeApiService");

jest.mock("Common/Server/Utils/Logger", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Logger",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

// No Valkey: the OAuth endpoints' rate limits are let through (registration's refused).
jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import {
  MCP_OAUTH_REQUEST_BODY_LIMIT,
  ORDINARY_REQUEST_BODY_LIMIT,
} from "Common/Server/Utils/RequestBodyLimit";
import {
  REQUEST_BODY_REFUSAL_MESSAGES,
  getTooLargeForRouteMessage,
} from "Common/Server/Utils/RequestBodyRefusal";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import {
  BodyAnswer,
  BodyServer,
  CONNECTIONS,
  Connection,
  KIB,
  MIB,
  READ_OR_TWO,
  SentRequest,
  sendOverHttp,
  sendWithFetch,
  startBodyServer,
} from "Common/Tests/Server/TestingUtils/RequestBodyOverHttp";
import { setupMCPRoutes } from "../Handlers/RouteHandler";
import { McpToolInfo } from "../Types/McpTypes";
import ModelType from "../Types/ModelType";
import OneUptimeOperation from "../Types/OneUptimeOperation";
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

// A refused connection is held at most a couple of seconds once answered.
jest.setTimeout(180000);

const TOOLS: Array<McpToolInfo> = [
  {
    name: "create_project",
    description: "Create a new project",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
    },
    modelName: "Project",
    operation: OneUptimeOperation.Create,
    modelType: ModelType.Database,
    singularName: "Project",
    pluralName: "Projects",
    tableName: "Project",
    apiPath: "/project",
  },
];

const FORM: string = "application/x-www-form-urlencoded";
const JSON_TYPE: string = "application/json";

// The most the MCP endpoint takes, an ordinary route (RequestBodyLimit).
const LIMIT: number = ORDINARY_REQUEST_BODY_LIMIT.bytes;

// The most the OAuth endpoints take, a limit of their own (#10672).
const OAUTH_LIMIT: number = MCP_OAUTH_REQUEST_BODY_LIMIT.bytes;

// What every client sends of a refused body, at most: far more than is read.
const SENT: number = 64 * MIB;

interface OwnParserRoute {
  name: string;
  path: string;
  contentType: string;
  headers?: Record<string, string>;
  // A body the route reads.
  body: Buffer;
  // What shows the route read that body, when its answer can show it.
  showsItRead?: (answer: BodyAnswer) => void;
  // The most the route takes (RequestBodyLimit).
  limit: number;
}

const ROUTES: Array<OwnParserRoute> = [
  {
    name: "the MCP endpoint",
    path: "/mcp",
    contentType: JSON_TYPE,
    headers: { accept: "application/json, text/event-stream" },
    body: Buffer.from(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "a-gzip-client", version: "0.1" },
        },
      }),
    ),
    showsItRead: (answer: BodyAnswer): void => {
      expect(answer.json).toMatchObject({
        id: 1,
        result: { serverInfo: { name: "oneuptime-mcp" } },
      });
    },
    limit: LIMIT,
  },
  {
    name: "the MCP OAuth token endpoint",
    path: "/mcp/oauth/token",
    contentType: FORM,
    body: Buffer.from("grant_type=nonsense&client_id=a-client"),
    showsItRead: (answer: BodyAnswer): void => {
      // A body it could not read is "grant_type is required."
      expect(answer.json).toMatchObject({ error: "unsupported_grant_type" });
    },
    limit: OAUTH_LIMIT,
  },
  {
    name: "the MCP OAuth revocation endpoint",
    path: "/mcp/oauth/revoke",
    contentType: FORM,
    body: Buffer.from("token=a-token&token_type_hint=refresh_token"),
    limit: OAUTH_LIMIT,
  },
  {
    name: "the MCP OAuth authorization endpoint, posted a form",
    path: "/mcp/oauth/authorize",
    contentType: FORM,
    body: Buffer.from("response_type=code&state=xyz"),
    limit: OAUTH_LIMIT,
  },
  {
    name: "MCP OAuth client registration",
    path: "/mcp/oauth/register",
    contentType: JSON_TYPE,
    body: Buffer.from(
      JSON.stringify({
        redirect_uris: ["https://client.example/callback"],
        client_name: "A gzip client",
      }),
    ),
    limit: OAUTH_LIMIT,
  },
  {
    name: "the MCP OAuth consent page's details",
    path: "/mcp/oauth/consent/details",
    contentType: JSON_TYPE,
    body: Buffer.from(JSON.stringify({ ticket: "a-ticket" })),
    limit: OAUTH_LIMIT,
  },
];

let server: BodyServer;

beforeAll(async () => {
  // The App's own express app: importing StartServer mounted its middleware.
  const app: ExpressApplication = Express.getExpressApp();

  setupMCPRoutes(app, TOOLS);
  app.use(expressErrorHandler);

  server = await startBodyServer(app);
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  jest.clearAllMocks();
});

type MockCalls = { mock: { calls: Array<Array<unknown>> } };

// The error-level lines logged while `send` ran.
async function errorLinesOf(send: () => Promise<SentRequest>): Promise<{
  sent: SentRequest;
  errorLines: number;
}> {
  const before: number = (logger.error as unknown as MockCalls).mock.calls
    .length;
  const sent: SentRequest = await send();

  return {
    sent: sent,
    errorLines:
      (logger.error as unknown as MockCalls).mock.calls.length - before,
  };
}

function headersOf(
  route: OwnParserRoute,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { "content-type": route.contentType, ...route.headers, ...extra };
}

describe.each(ROUTES)("$name", (route: OwnParserRoute) => {
  test("a valid gzip body is answered as the same body sent uncompressed: never a 500, never logged at error", async () => {
    const uncompressed: { sent: SentRequest; errorLines: number } =
      await errorLinesOf(() => {
        return sendOverHttp(server, {
          path: route.path,
          headers: headersOf(route),
          body: route.body,
        });
      });

    const listening: BodyServer = server;

    for (const connection of CONNECTIONS) {
      for (const chunked of [false, true]) {
        const gzipped: { sent: SentRequest; errorLines: number } =
          await errorLinesOf(() => {
            return sendOverHttp(listening, {
              path: route.path,
              headers: headersOf(route, { "content-encoding": "gzip" }),
              connection: connection,
              chunked: chunked,
              body: zlib.gzipSync(route.body),
            });
          });

        expect(gzipped.sent.answer.status).not.toBe(500);
        expect(gzipped.sent.answer.status).toBe(
          uncompressed.sent.answer.status,
        );
        expect(gzipped.sent.answer.json).toEqual(uncompressed.sent.answer.json);
        expect(gzipped.errorLines).toBe(uncompressed.errorLines);
        expect(gzipped.sent.answer.clientError).toBeNull();

        if (route.showsItRead) {
          route.showsItRead(gzipped.sent.answer);
        }
      }
    }

    if (route.showsItRead) {
      route.showsItRead(uncompressed.sent.answer);
    }
  });

  test("a gzip body that does not inflate is refused 400 in its sentence, logged at debug and never at error", async () => {
    for (const connection of CONNECTIONS) {
      const sent: SentRequest = await sendOverHttp(server, {
        path: route.path,
        headers: headersOf(route, { "content-encoding": "gzip" }),
        connection: connection,
        body: Buffer.from("this is not gzip"),
      });

      expect(sent.answer.status).toBe(400);
      expect(sent.answer.json).toEqual({
        error: REQUEST_BODY_REFUSAL_MESSAGES.notInflated,
      });
      expect(sent.answer.clientError).toBeNull();
    }

    expect(logger.error).not.toHaveBeenCalled();
  });

  test("a gzip bomb is refused 413 as it inflates, with a socket read or two read", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: route.path,
      headers: headersOf(route, { "content-encoding": "gzip" }),
      chunked: true,
      body: zlib.gzipSync(Buffer.alloc(SENT, 0x20)),
    });

    expect(sent.answer.status).toBe(413);
    expect(sent.answer.connection).toBe("close");
    expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test.each([...CONNECTIONS])(
    "a body declared over the route's limit is refused 413 before a byte of it is read (%s)",
    async (connection: Connection) => {
      const sent: SentRequest = await sendOverHttp(server, {
        path: route.path,
        headers: headersOf(route),
        connection: connection,
        bytes: SENT,
      });

      expect(sent.answer.status).toBe(413);
      expect(sent.answer.connection).toBe("close");
      expect(sent.answer.json).toEqual({
        error: getTooLargeForRouteMessage(route.limit),
      });
      expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  test.each([...CONNECTIONS])(
    "a chunked body past the route's limit is refused 413 at the limit, the rest unread (%s)",
    async (connection: Connection) => {
      const sent: SentRequest = await sendOverHttp(server, {
        path: route.path,
        headers: headersOf(route),
        connection: connection,
        chunked: true,
        bytes: SENT,
      });

      expect(sent.answer.status).toBe(413);
      expect(sent.answer.connection).toBe("close");
      expect(sent.answer.json).toEqual({
        error: getTooLargeForRouteMessage(route.limit),
      });

      const read: number = await server.readInAll(sent.tag);

      expect(read).toBeGreaterThan(route.limit);
      expect(read).toBeLessThanOrEqual(route.limit + READ_OR_TWO);
      expect(logger.error).not.toHaveBeenCalled();
    },
  );
});

describe("sent with fetch", () => {
  test("a gzip body over the limit as it inflates, and a body over it as sent: each 413 read, the rest unread", async () => {
    const declared: SentRequest = await sendWithFetch(server, {
      path: "/mcp",
      headers: {
        "content-type": JSON_TYPE,
        "content-length": String(SENT),
      },
      bytes: SENT,
    });

    expect(declared.answer.clientError).toBeNull();
    expect(declared.answer.status).toBe(413);
    expect(await server.readInAll(declared.tag)).toBeLessThanOrEqual(
      LIMIT + READ_OR_TWO,
    );

    const chunked: SentRequest = await sendWithFetch(server, {
      path: "/mcp/oauth/token",
      headers: { "content-type": FORM },
      bytes: SENT,
    });

    expect(chunked.answer.clientError).toBeNull();
    expect(chunked.answer.status).toBe(413);
    expect(await server.readInAll(chunked.tag)).toBeLessThanOrEqual(
      OAUTH_LIMIT + READ_OR_TWO,
    );
  });
});

describe("a route's own limit holds whatever the body's encoding (#10672)", () => {
  const OVER_FORM: Buffer = Buffer.from(
    `grant_type=authorization_code&code=${"a".repeat(100 * KIB)}`,
  );
  const UNDER_FORM: Buffer = Buffer.from(
    `grant_type=authorization_code&code=${"a".repeat(60 * KIB)}`,
  );

  test.each([...CONNECTIONS])(
    "the OAuth endpoints' 64 KB: a 100 KB form is refused 413 alike, sent as it is, declared or chunked, or gzipped (%s)",
    async (connection: Connection) => {
      const answers: Array<SentRequest> = [];

      for (const chunked of [false, true]) {
        answers.push(
          await sendOverHttp(server, {
            path: "/mcp/oauth/token",
            headers: { "content-type": FORM },
            connection: connection,
            chunked: chunked,
            body: OVER_FORM,
          }),
          await sendOverHttp(server, {
            path: "/mcp/oauth/token",
            headers: { "content-type": FORM, "content-encoding": "gzip" },
            connection: connection,
            chunked: chunked,
            body: zlib.gzipSync(OVER_FORM),
          }),
        );
      }

      for (const sent of answers) {
        // Sent as it is, it was parsed at the ordinary 1 MB, and answered 401.
        expect(sent.answer.status).toBe(413);
        expect(sent.answer.json).toEqual({
          error: getTooLargeForRouteMessage(OAUTH_LIMIT),
        });
        expect(sent.answer.connection).toBe("close");
        expect(sent.answer.clientError).toBeNull();
        expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(
          OAUTH_LIMIT + READ_OR_TWO,
        );
      }

      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  test("the words are those of every body over a route's limit, which a gzip one was not told", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: "/mcp/oauth/token",
      headers: { "content-type": FORM, "content-encoding": "gzip" },
      body: zlib.gzipSync(OVER_FORM),
    });

    // The front ends' sentence for any 413, which names no limit.
    expect(sent.answer.json).not.toEqual({
      error: REQUEST_BODY_REFUSAL_MESSAGES.tooLarge,
    });
    expect(sent.answer.json).toEqual({
      error: getTooLargeForRouteMessage(OAUTH_LIMIT),
    });
  });

  test("client registration's JSON past 64 KB is refused 413 alike, as it is or gzipped", async () => {
    const registration: Buffer = Buffer.from(
      JSON.stringify({
        redirect_uris: ["https://client.example/callback"],
        client_name: "x".repeat(100 * KIB),
      }),
    );

    for (const gzip of [false, true]) {
      const sent: SentRequest = await sendOverHttp(server, {
        path: "/mcp/oauth/register",
        headers: {
          "content-type": JSON_TYPE,
          ...(gzip ? { "content-encoding": "gzip" } : {}),
        },
        body: gzip ? zlib.gzipSync(registration) : registration,
      });

      expect(sent.answer.status).toBe(413);
      expect(sent.answer.json).toEqual({
        error: getTooLargeForRouteMessage(OAUTH_LIMIT),
      });
    }
  });

  test("a form within the 64 KB is read alike, as it is or gzipped", async () => {
    for (const gzip of [false, true]) {
      const sent: SentRequest = await sendOverHttp(server, {
        path: "/mcp/oauth/token",
        headers: {
          "content-type": FORM,
          ...(gzip ? { "content-encoding": "gzip" } : {}),
        },
        body: gzip ? zlib.gzipSync(UNDER_FORM) : UNDER_FORM,
      });

      // Read: the token endpoint says what the form lacks.
      expect(sent.answer.status).toBe(401);
      expect(sent.answer.json).toMatchObject({ error: "invalid_client" });
    }
  });

  test("the MCP endpoint takes a gzip body as large as an uncompressed one: its route's limit, not body-parser's 100 KB", async () => {
    const params: Record<string, unknown> = {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "x".repeat(300 * KIB), version: "0.1" },
    };
    const body: Buffer = Buffer.from(
      JSON.stringify({ jsonrpc: "2.0", id: 7, method: "initialize", params }),
    );

    const headers: Record<string, string> = {
      "content-type": JSON_TYPE,
      accept: "application/json, text/event-stream",
    };

    const uncompressed: SentRequest = await sendOverHttp(server, {
      path: "/mcp",
      headers: headers,
      body: body,
    });
    const gzipped: SentRequest = await sendOverHttp(server, {
      path: "/mcp",
      headers: { ...headers, "content-encoding": "gzip" },
      body: zlib.gzipSync(body),
    });

    expect(uncompressed.answer.status).toBe(200);
    expect(gzipped.answer.status).toBe(200);
    expect(gzipped.answer.json).toMatchObject({
      id: 7,
      result: { serverInfo: { name: "oneuptime-mcp" } },
    });
  });
});
