/*
 * THE DOCS' "WAS THIS PAGE HELPFUL?" AND "FOUND NOTHING" READ A GZIP BODY,
 * AND NEVER READ ONE PAST ITS LIMIT (#10643), over HTTP, through
 * StartServer's own middleware - as the App mounts it - and the docs' real
 * routes, with real clients.
 *
 * Both routes run a JSON parser of their own (2 KB) after StartServer, which
 * had already inflated a gzip body and left its bytes: the route's parser,
 * body-parser on its own, read the spent stream again, and a valid gzip
 * body was answered 500 with an error-level log line. Now it reads the bytes
 * StartServer inflated (RequestBodyParser): a gzip answer is taken as the
 * same answer sent uncompressed, held to the same 2 KB as it inflates.
 *
 * And the 2 KB holds whatever the body's encoding (#10672): StartServer
 * parsed an uncompressed answer at the ordinary 1 MB before the route's
 * parser came to it. It holds both routes to their 2 KB before routing now.
 */

jest.mock("../../../FeatureSet/Docs/Utils/Config", () => {
  const path: typeof Path = jest.requireActual("path") as typeof Path;
  const root: string = path.resolve(__dirname, "../../../FeatureSet/Docs");
  return {
    ContentPath: path.join(root, "Content"),
    StaticPath: path.join(root, "Static"),
    ViewsPath: path.join(root, "Views"),
  };
});
jest.mock("Common/Server/Utils/LocalFile", () => {
  const fs: typeof FileSystem = jest.requireActual("fs") as typeof FileSystem;
  return {
    __esModule: true,
    default: {
      doesFileExist: async (file: string): Promise<boolean> => {
        return fs.existsSync(file);
      },
      read: (file: string): Promise<string> => {
        return fs.promises.readFile(file, "utf8");
      },
    },
  };
});
jest.mock("Common/Server/Utils/Logger", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Logger",
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
jest.mock("../../../FeatureSet/Docs/Utils/LlmsTxt", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../FeatureSet/Docs/Utils/Placeholders", () => {
  return {
    __esModule: true,
    default: {
      render: (content: string): string => {
        return content;
      },
    },
  };
});

import DocsFeatureSet from "../../../FeatureSet/Docs/Index";
import { DOCS_SEARCH_REPORT_MAX_LENGTH } from "../../../FeatureSet/Docs/Utils/DocsSearchReport";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { DOCS_REPORT_REQUEST_BODY_LIMIT } from "Common/Server/Utils/RequestBodyLimit";
import {
  REQUEST_BODY_REFUSAL_MESSAGES,
  getTooLargeForRouteMessage,
} from "Common/Server/Utils/RequestBodyRefusal";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import API from "Common/Utils/API";
import {
  BodyServer,
  CONNECTIONS,
  Connection,
  MIB,
  READ_OR_TWO,
  SentRequest,
  sendOverHttp,
  sendWithFetch,
  startBodyServer,
} from "Common/Tests/Server/TestingUtils/RequestBodyOverHttp";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type * as FileSystem from "fs";
import type * as Path from "path";
import zlib from "zlib";

jest.setTimeout(180000);

// The most these routes take, a limit of their own (RequestBodyLimit, #10672).
const LIMIT: number = DOCS_REPORT_REQUEST_BODY_LIMIT.bytes;

const SENT: number = 64 * MIB;

interface DocsRoute {
  name: string;
  path: string;
  // An answer the route takes: 204. One it cannot read is 400.
  body: Buffer;
}

const ROUTES: Array<DocsRoute> = [
  {
    name: '"Was this page helpful?"',
    path: "/docs/feedback",
    body: Buffer.from(
      JSON.stringify({
        page: "monitor/website-monitor",
        isHelpful: false,
        reason: "unclear",
        language: "fr",
      }),
    ),
  },
  {
    name: "a docs search that found nothing",
    path: "/docs/search/found-nothing",
    body: Buffer.from(JSON.stringify({ query: "sentinelone", language: "de" })),
  },
];

const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json",
};

let server: BodyServer;

beforeAll(async () => {
  // Product analytics is not set up here: nothing is sent, and nothing could be.
  jest.spyOn(API, "post").mockImplementation(async () => {
    return new HTTPResponse(200, {}, {}) as never;
  });

  // The App's own express app: importing StartServer mounted its middleware.
  const app: ExpressApplication = Express.getExpressApp();

  app.set("view engine", "ejs");
  await DocsFeatureSet.init();
  app.use(expressErrorHandler);

  server = await startBodyServer(app);
}, 180000);

afterAll(async () => {
  if (server) {
    await server.close();
  }
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe.each(ROUTES)("$name", (route: DocsRoute) => {
  test("a valid gzip answer is taken as the same answer sent uncompressed: never a 500, never logged at error", async () => {
    const uncompressed: SentRequest = await sendOverHttp(server, {
      path: route.path,
      headers: JSON_HEADERS,
      body: route.body,
    });

    expect(uncompressed.answer.status).toBe(204);

    for (const connection of CONNECTIONS) {
      for (const chunked of [false, true]) {
        const gzipped: SentRequest = await sendOverHttp(server, {
          path: route.path,
          headers: { ...JSON_HEADERS, "content-encoding": "gzip" },
          connection: connection,
          chunked: chunked,
          body: zlib.gzipSync(route.body),
        });

        // A body the route could not read is a 400.
        expect(gzipped.answer.status).toBe(204);
        expect(gzipped.answer.clientError).toBeNull();
      }
    }

    expect(logger.error).not.toHaveBeenCalled();
  });

  test.each([...CONNECTIONS])(
    "an answer past the route's own 2 KB is refused 413 alike, sent as it is, declared or chunked, or gzipped (%s)",
    async (connection: Connection) => {
      const padded: Buffer = Buffer.from(
        JSON.stringify({
          ...JSON.parse(route.body.toString()),
          padding: " ".repeat(4096),
        }),
      );

      for (const chunked of [false, true]) {
        for (const gzip of [false, true]) {
          const sent: SentRequest = await sendOverHttp(server, {
            path: route.path,
            headers: gzip
              ? { ...JSON_HEADERS, "content-encoding": "gzip" }
              : JSON_HEADERS,
            connection: connection,
            chunked: chunked,
            body: gzip ? zlib.gzipSync(padded) : padded,
          });

          // Sent as it is, it was parsed at the ordinary 1 MB.
          expect(sent.answer.status).toBe(413);
          expect(sent.answer.json).toEqual({
            error: getTooLargeForRouteMessage(LIMIT),
          });
          expect(sent.answer.clientError).toBeNull();
          expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(
            LIMIT + READ_OR_TWO,
          );
        }
      }

      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  test("an answer within the 2 KB is taken alike, as it is or gzipped", async () => {
    const padded: Buffer = Buffer.from(
      JSON.stringify({
        ...JSON.parse(route.body.toString()),
        padding: " ".repeat(1024),
      }),
    );

    expect(padded.length).toBeLessThan(LIMIT);

    for (const gzip of [false, true]) {
      const sent: SentRequest = await sendOverHttp(server, {
        path: route.path,
        headers: gzip
          ? { ...JSON_HEADERS, "content-encoding": "gzip" }
          : JSON_HEADERS,
        body: gzip ? zlib.gzipSync(padded) : padded,
      });

      expect(sent.answer.status).toBe(204);
    }
  });

  test("a gzip body that does not inflate is refused 400 in its sentence, logged at debug and never at error", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: route.path,
      headers: { ...JSON_HEADERS, "content-encoding": "gzip" },
      body: Buffer.from("this is not gzip"),
    });

    expect(sent.answer.status).toBe(400);
    expect(sent.answer.json).toEqual({
      error: REQUEST_BODY_REFUSAL_MESSAGES.notInflated,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("a gzip bomb is refused 413 as it inflates, with a socket read or two read", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: route.path,
      headers: { ...JSON_HEADERS, "content-encoding": "gzip" },
      chunked: true,
      body: zlib.gzipSync(Buffer.alloc(SENT, 0x20)),
    });

    expect(sent.answer.status).toBe(413);
    expect(sent.answer.connection).toBe("close");
    expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
  });

  test.each([...CONNECTIONS])(
    "a body over the route's limit is refused 413, declared or chunked, the rest unread (%s)",
    async (connection: Connection) => {
      const declared: SentRequest = await sendOverHttp(server, {
        path: route.path,
        headers: JSON_HEADERS,
        connection: connection,
        bytes: SENT,
      });

      expect(declared.answer.status).toBe(413);
      expect(declared.answer.connection).toBe("close");
      expect(declared.answer.json).toEqual({
        error: getTooLargeForRouteMessage(LIMIT),
      });
      expect(await server.readInAll(declared.tag)).toBeLessThanOrEqual(
        READ_OR_TWO,
      );

      const chunked: SentRequest = await sendOverHttp(server, {
        path: route.path,
        headers: JSON_HEADERS,
        connection: connection,
        chunked: true,
        bytes: SENT,
      });

      expect(chunked.answer.status).toBe(413);
      expect(chunked.answer.json).toEqual({
        error: getTooLargeForRouteMessage(LIMIT),
      });
      // It read more than 1 MB before (#10672): the ordinary limit.
      expect(await server.readInAll(chunked.tag)).toBeLessThanOrEqual(
        LIMIT + READ_OR_TWO,
      );
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  test("sent with fetch, past the limit: the 413 is read, the rest unread", async () => {
    const sent: SentRequest = await sendWithFetch(server, {
      path: route.path,
      headers: JSON_HEADERS,
      bytes: SENT,
    });

    expect(sent.answer.clientError).toBeNull();
    expect(sent.answer.status).toBe(413);
    expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(
      LIMIT + READ_OR_TWO,
    );
  });
});

/*
 * The docs page posts a search that found nothing as it was typed, and the
 * server keeps its first DOCS_SEARCH_REPORT_MAX_LENGTH characters. Held to
 * 2 KB whatever its encoding now (#10672), a report of a longer search would
 * be refused rather than cut: so the page cuts it where the server does, and
 * the longest report it can post fits.
 */
describe("the longest search the docs page reports", () => {
  test("is cut where the server cuts it, and fits the 2 KB in any script", async () => {
    const realFs: typeof FileSystem = jest.requireActual(
      "fs",
    ) as typeof FileSystem;
    const realPath: typeof Path = jest.requireActual("path") as typeof Path;
    const scripts: string = realFs.readFileSync(
      realPath.resolve(
        __dirname,
        "../../../FeatureSet/Docs/Views/Partials/Scripts.ejs",
      ),
      "utf8",
    );

    expect(scripts).toContain(
      `var SEARCH_REPORT_MAX_LENGTH = ${DOCS_SEARCH_REPORT_MAX_LENGTH};`,
    );
    expect(scripts).toContain(
      "query: query.slice(0, SEARCH_REPORT_MAX_LENGTH),",
    );

    // Three bytes each, a two-byte escape each, four bytes each two units.
    for (const character of ["語", '"', "😀", "a"]) {
      const body: Buffer = Buffer.from(
        JSON.stringify({
          query: character
            .repeat(DOCS_SEARCH_REPORT_MAX_LENGTH)
            .slice(0, DOCS_SEARCH_REPORT_MAX_LENGTH),
          language: "zh-TW",
        }),
      );

      expect(body.length).toBeLessThan(LIMIT);

      const sent: SentRequest = await sendOverHttp(server, {
        path: "/docs/search/found-nothing",
        headers: JSON_HEADERS,
        body: body,
      });

      expect(sent.answer.status).toBe(204);
    }
  });
});
