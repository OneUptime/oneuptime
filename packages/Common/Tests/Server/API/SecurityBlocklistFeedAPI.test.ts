import { mockRouter } from "./Helpers";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A FIREWALL READS ITS BLOCKLIST FEED THROUGH THE REAL ROUTE (#10345).
 *
 * The routes the API registered are replayed onto a real Express
 * application on an ephemeral port and fetched over HTTP, so what is under
 * test is what a firewall meets: the status, the headers (a Basic
 * challenge, the ETag, Retry-After), a 304 by If-None-Match, a HEAD that
 * loads nothing, and the near misses under the prefix. The rate limiter is
 * the real one, counting in an in-memory Redis.
 *
 * The feed, the project's blocks and the fetch log are held in memory
 * behind the services that read and write them; what the project protects
 * is what each test says.
 *
 * Pinned: each way a firewall sends the secret (basic auth with any
 * username, a bearer token, the path), and every way a wrong one is
 * refused; a rotated secret that keeps working for a day and not a moment
 * longer; a revoked secret that stops at once; the rate limit per feed and
 * address; the source allowlist; and that the secret is never written to a
 * log line.
 */

type EnvMockGlobal = typeof globalThis & {
  __oneuptimeBlocklistFeedCounters: Map<string, number>;
};

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

// Every line is kept, so a test can say the secret is in none.
jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: (): Record<string, string> => {
      return {};
    },
  };
});

/*
 * Redis, in memory: the rate limiter's INCR and EXPIRE pipelines, counted
 * per key, so the real limiter decides.
 */
jest.mock("../../../Server/Infrastructure/Redis", () => {
  const mockGlobal: EnvMockGlobal = globalThis as EnvMockGlobal;
  mockGlobal.__oneuptimeBlocklistFeedCounters = new Map<string, number>();

  const client: unknown = {
    pipeline: () => {
      const operations: Array<() => [null, unknown]> = [];
      const pipeline: Record<string, unknown> = {
        incr: (key: string) => {
          operations.push((): [null, unknown] => {
            const counters: Map<string, number> =
              mockGlobal.__oneuptimeBlocklistFeedCounters;
            const value: number = (counters.get(key) || 0) + 1;
            counters.set(key, value);
            return [null, value];
          });
          return pipeline;
        },
        expire: () => {
          operations.push((): [null, unknown] => {
            return [null, 1];
          });
          return pipeline;
        },
        exec: async () => {
          return operations.map((operation: () => [null, unknown]) => {
            return operation();
          });
        },
      };
      return pipeline;
    },
  };

  return {
    __esModule: true,
    default: {
      getClient: () => {
        return client;
      },
      isConnected: () => {
        return true;
      },
    },
  };
});

jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: async (
        _req: unknown,
        _res: unknown,
        next: () => void,
      ): Promise<void> => {
        next();
      },
      requireUserAuthentication: async (
        _req: unknown,
        _res: unknown,
        next: () => void,
      ): Promise<void> => {
        next();
      },
    },
  };
});

import SecurityBlocklistFeedAPI, {
  BLOCKLIST_FEED_ALLOWED_METHODS,
  BLOCKLIST_FEED_FALLBACK_ROUTE,
  BLOCKLIST_FEED_HEADER_ROUTE,
  BLOCKLIST_FEED_PATH_SECRET_ROUTE,
  SECRET_REQUIRED_MESSAGE,
  SOURCE_NOT_ALLOWED_MESSAGE,
  UNAVAILABLE_MESSAGE,
} from "../../../Server/API/SecurityBlocklistFeedAPI";
import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlocklistFeed from "../../../Models/DatabaseModels/SecurityBlocklistFeed";
import SecurityBlocklistFeedRateLimit, {
  RATE_LIMITED_MESSAGE,
  SECURITY_BLOCKLIST_FEED_RATE_LIMIT_PER_FEED,
} from "../../../Server/Middleware/SecurityBlocklistFeedRateLimit";
import SecurityBlockService from "../../../Server/Services/SecurityBlockService";
import SecurityBlocklistFeedFetchService, {
  SecurityBlocklistFeedFetchRecord,
} from "../../../Server/Services/SecurityBlocklistFeedFetchService";
import SecurityBlocklistFeedService from "../../../Server/Services/SecurityBlocklistFeedService";
import logger from "../../../Server/Utils/Logger";
import SecurityBlocklistFeedProtection from "../../../Server/Utils/SecurityBlocklist/SecurityBlocklistFeedProtection";
import SecurityBlocklistFeedServe, {
  SECURITY_BLOCKLIST_FEED_NOT_FOUND_MESSAGE,
  getSecurityBlocklistFeedMd5,
  isSecurityBlocklistFeedNotModified,
  readSecurityBlocklistFeedCredentials,
} from "../../../Server/Utils/SecurityBlocklist/SecurityBlocklistFeedServe";
import SecurityBlocklistJobs from "../../../Server/Utils/SecurityBlocklist/SecurityBlocklistJobs";
import SecurityProtectedAddresses from "../../../Server/Utils/SecurityBlocklist/SecurityProtectedAddresses";
import OneUptimeDate from "../../../Types/Date";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockState,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SECURITY_BLOCKLIST_FEED_SECRET_GRACE_IN_MS,
  SecurityBlocklistFeedFamily,
} from "../../../Types/SecurityBlocklist/SecurityBlocklistFeed";
import {
  SecurityAddressProtection,
  SecurityProtectedAddressSource,
} from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import express from "express";
import http from "http";
import { AddressInfo } from "net";

const API_PREFIX: string = "/api";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const FEED_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECRET: string =
  "4f1c0e5d8a7b6c3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e";
const OTHER_SECRET: string =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const NOW: Date = new Date("2026-11-21T10:00:00.000Z");
const HOUR_IN_MS: number = 60 * 60 * 1000;

let server: http.Server;
let baseUrl: string;
let feed: SecurityBlocklistFeed | null;
let blocks: Array<SecurityBlock>;
let fetches: Array<SecurityBlocklistFeedFetchRecord>;
let protections: Array<SecurityAddressProtection>;
let now: Date;

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function request(
  path: string,
  options?: { method?: string; headers?: Record<string, string> },
): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (error: Error) => void) => {
      const req: http.ClientRequest = http.request(
        `${baseUrl}${path}`,
        { method: options?.method || "GET", headers: options?.headers || {} },
        (res: http.IncomingMessage) => {
          let body: string = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            body += chunk;
          });
          res.on("end", () => {
            resolve({
              status: res.statusCode || 0,
              headers: res.headers,
              body,
            });
          });
        },
      );
      req.on("error", reject);
      req.end();
    },
  );
}

function feedPath(file: string = "blocklist.txt"): string {
  return `${API_PREFIX}/blocklist-feed/${FEED_ID}/${file}`;
}

function pathSecretPath(
  secret: string,
  file: string = "blocklist.txt",
): string {
  return `${API_PREFIX}/blocklist-feed/${FEED_ID}/${secret}/${file}`;
}

function bearer(secret: string): Record<string, string> {
  return { Authorization: `Bearer ${secret}` };
}

function basic(username: string, password: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

// A fetch whose answer is out: its bookkeeping done.
async function fetchFeed(
  path: string,
  options?: { method?: string; headers?: Record<string, string> },
): Promise<HttpResult> {
  const result: HttpResult = await request(path, options);
  await SecurityBlocklistFeedServe.waitForPendingBookkeeping();
  return result;
}

function block(
  value: string,
  extra?: Partial<Record<string, unknown>>,
): SecurityBlock {
  const made: SecurityBlock = new SecurityBlock();
  made._id = ObjectID.generate().toString();
  made.projectId = PROJECT_ID;
  made.value = value;
  made.action = SecurityBlockAction.Block;
  made.state = SecurityBlockState.Active;
  made.createdAt = new Date(NOW.getTime() - HOUR_IN_MS);
  made.expiresAt = new Date(NOW.getTime() + HOUR_IN_MS);
  Object.assign(made, extra || {});
  return made;
}

function makeFeed(): SecurityBlocklistFeed {
  const made: SecurityBlocklistFeed = new SecurityBlocklistFeed();
  made._id = FEED_ID;
  made.projectId = PROJECT_ID;
  made.name = "Palo Alto feed";
  made.family = SecurityBlocklistFeedFamily.Both;
  made.secret = new HashedString(
    SecurityBlocklistFeedService.hashSecret(SECRET),
    true,
  );
  return made;
}

// A row as a read hands it back: a copy of its own, so a test changes the table only through the service.
function copy<T>(model: T): T {
  const made: T = Object.create(
    Object.getPrototypeOf(model as unknown as Record<string, unknown>),
  ) as T;
  Object.assign(made as unknown as Record<string, unknown>, model);
  return made;
}

function everyLogLine(): string {
  return [
    ...(logger.debug as jest.Mock).mock.calls,
    ...(logger.info as jest.Mock).mock.calls,
    ...(logger.warn as jest.Mock).mock.calls,
    ...(logger.error as jest.Mock).mock.calls,
  ]
    .map((call: Array<unknown>): string => {
      return call
        .map((argument: unknown): string => {
          return argument instanceof Error
            ? `${argument.message} ${argument.stack || ""}`
            : JSON.stringify(argument) || String(argument);
        })
        .join(" ");
    })
    .join("\n");
}

beforeAll(async () => {
  mockRouter.routes.length = 0;
  new SecurityBlocklistFeedAPI();

  const app: express.Express = express();

  // The feed's routes, as the API registered them: the CRUD routes are BaseAPI's, read elsewhere.
  for (const route of mockRouter.routes) {
    if (!route.uri.startsWith("/blocklist-feed")) {
      continue;
    }

    const chain: Array<express.RequestHandler> = [
      ...route.middlewares,
      route.handlerFunction,
    ] as unknown as Array<express.RequestHandler>;
    const fullPath: string = `${API_PREFIX}${route.uri}`;

    if (route.method === "GET") {
      app.get(fullPath, ...chain);
    } else if (route.method === "ALL") {
      app.all(fullPath, ...chain);
    }
  }

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ): void => {
      res.status(500).send({ message: (err as Error).message });
    },
  );

  server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as EnvMockGlobal).__oneuptimeBlocklistFeedCounters.clear();
  SecurityBlocklistFeedProtection.clearCache();

  now = NOW;
  feed = makeFeed();
  blocks = [block("35.205.11.131"), block("2001:db8::9")];
  fetches = [];
  protections = [];

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return now;
  });

  jest
    .spyOn(SecurityBlocklistFeedService, "findForServe")
    .mockImplementation((async (
      id: ObjectID,
    ): Promise<SecurityBlocklistFeed | null> => {
      return feed && id.toString() === FEED_ID ? copy(feed) : null;
    }) as never);
  jest
    .spyOn(SecurityBlocklistFeedService, "findOneById")
    .mockImplementation((async (): Promise<SecurityBlocklistFeed | null> => {
      return feed ? copy(feed) : null;
    }) as never);
  jest
    .spyOn(SecurityBlocklistFeedService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (args: unknown): Promise<void> => {
      Object.assign(feed!, (args as { data: JSONObject }).data);
    }) as never);
  jest
    .spyOn(SecurityBlocklistFeedService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (args: unknown): Promise<boolean> => {
      Object.assign(feed!, (args as { data: JSONObject }).data);
      return true;
    }) as never);
  jest
    .spyOn(SecurityBlocklistFeedFetchService, "record")
    .mockImplementation((async (
      record: SecurityBlocklistFeedFetchRecord,
    ): Promise<void> => {
      fetches.push(record);
    }) as never);
  jest.spyOn(SecurityBlockService, "findBy").mockImplementation((async () => {
    return blocks.map(copy);
  }) as never);
  jest
    .spyOn(SecurityProtectedAddresses, "readAllProtections")
    .mockImplementation((async () => {
      return { protections: [], unreadSources: [], incompleteSources: [] };
    }) as never);
  jest
    .spyOn(SecurityProtectedAddresses, "readProtectedEntities")
    .mockImplementation((async () => {
      return { protections, isComplete: true };
    }) as never);
  jest
    .spyOn(SecurityBlocklistJobs, "queueReconcile")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the routes", () => {
  test("a firewall reads a feed by GET, rate limited before anything else, with no session middleware", () => {
    const routes: Array<{ method: string; uri: string }> = mockRouter.routes
      .filter((route: { uri: string }): boolean => {
        return route.uri.startsWith("/blocklist-feed");
      })
      .map((route: { method: string; uri: string }) => {
        return { method: route.method, uri: route.uri };
      });

    expect(routes).toEqual([
      { method: "GET", uri: BLOCKLIST_FEED_HEADER_ROUTE },
      { method: "GET", uri: BLOCKLIST_FEED_PATH_SECRET_ROUTE },
      { method: "ALL", uri: BLOCKLIST_FEED_FALLBACK_ROUTE },
    ]);

    for (const uri of [
      BLOCKLIST_FEED_HEADER_ROUTE,
      BLOCKLIST_FEED_PATH_SECRET_ROUTE,
    ]) {
      const route: { middlewares: Array<unknown> } = mockRouter.match(
        "GET",
        uri,
      );
      expect(route.middlewares).toEqual([
        SecurityBlocklistFeedRateLimit.middleware,
      ]);
    }
  });
});

describe("authentication", () => {
  test("no secret: 401 with a Basic challenge, and nothing is read", async () => {
    const result: HttpResult = await fetchFeed(feedPath());

    expect(result.status).toBe(401);
    expect(result.headers["www-authenticate"]).toBe(
      'Basic realm="OneUptime blocklist feed", charset="UTF-8"',
    );
    expect(JSON.parse(result.body).message).toBe(SECRET_REQUIRED_MESSAGE);
    expect(SecurityBlocklistFeedService.findForServe).not.toHaveBeenCalled();
    expect(fetches).toEqual([]);
  });

  test("basic auth: the secret as the password, whatever the username", async () => {
    for (const username of ["oneuptime", "paloalto", ""]) {
      const result: HttpResult = await fetchFeed(feedPath(), {
        headers: basic(username, SECRET),
      });

      expect(result.status).toBe(200);
      expect(result.body).toBe("35.205.11.131\n2001:db8::9\n");
      expect(result.headers["content-type"]).toBe("text/plain; charset=utf-8");
    }

    expect(fetches[fetches.length - 1]!.authMethod).toBe("Basic");
  });

  test("a bearer token", async () => {
    const result: HttpResult = await fetchFeed(feedPath(), {
      headers: bearer(SECRET),
    });

    expect(result.status).toBe(200);
    expect(fetches[0]!.authMethod).toBe("Bearer");
  });

  test("the secret in the path, for a firewall that sends no header", async () => {
    const result: HttpResult = await fetchFeed(pathSecretPath(SECRET));

    expect(result.status).toBe(200);
    expect(result.body).toBe("35.205.11.131\n2001:db8::9\n");
    expect(fetches[0]!.authMethod).toBe("Path");
  });

  test("a wrong secret in a header: 401; in the path: 404, as a URL that does not exist", async () => {
    expect(
      (await fetchFeed(feedPath(), { headers: bearer(OTHER_SECRET) })).status,
    ).toBe(401);
    expect(
      (
        await fetchFeed(feedPath(), {
          headers: basic("oneuptime", OTHER_SECRET),
        })
      ).status,
    ).toBe(401);
    expect((await fetchFeed(pathSecretPath(OTHER_SECRET))).status).toBe(404);
    // Not shaped like a secret: refused before anything is read.
    expect((await fetchFeed(pathSecretPath("not-a-secret"))).status).toBe(404);
    expect((await fetchFeed(pathSecretPath(SECRET.toUpperCase()))).status).toBe(
      404,
    );
    expect(fetches).toEqual([]);
  });

  test("a scheme it does not know, or a basic header that is not one, carries no secret", async () => {
    for (const authorization of [
      `Token ${SECRET}`,
      "Bearer",
      "Basic !!!",
      `Basic ${Buffer.from(SECRET).toString("base64")}`,
    ]) {
      const result: HttpResult = await fetchFeed(feedPath(), {
        headers: { Authorization: authorization },
      });
      expect(result.status).toBe(401);
    }
  });

  test("an unknown feed, a malformed feed ID and a file no feed serves: 404, saying nothing", async () => {
    for (const path of [
      `${API_PREFIX}/blocklist-feed/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/blocklist.txt`,
      `${API_PREFIX}/blocklist-feed/not-a-feed/blocklist.txt`,
      feedPath("index.html"),
      feedPath("blocklist.csv"),
    ]) {
      const result: HttpResult = await fetchFeed(path, {
        headers: bearer(SECRET),
      });

      expect(result.status).toBe(404);
      expect(JSON.parse(result.body).message).toBe(
        SECURITY_BLOCKLIST_FEED_NOT_FOUND_MESSAGE,
      );
    }
  });

  test("a near miss under the prefix: 405 with Allow for another method, 200 for OPTIONS, 404 for a short path", async () => {
    const post: HttpResult = await request(feedPath(), {
      method: "POST",
      headers: bearer(SECRET),
    });
    expect(post.status).toBe(405);
    expect(post.headers["allow"]).toBe(BLOCKLIST_FEED_ALLOWED_METHODS);

    const options: HttpResult = await request(feedPath(), {
      method: "OPTIONS",
    });
    expect(options.status).toBe(200);
    expect(options.headers["allow"]).toBe(BLOCKLIST_FEED_ALLOWED_METHODS);

    const short: HttpResult = await request(
      `${API_PREFIX}/blocklist-feed/${FEED_ID}`,
    );
    expect(short.status).toBe(404);
  });

  test("the secret is never written to a log line, whatever the answer", async () => {
    await fetchFeed(feedPath(), { headers: bearer(SECRET) });
    await fetchFeed(pathSecretPath(SECRET));
    await fetchFeed(pathSecretPath(SECRET, "nope.txt"));
    await request(pathSecretPath(SECRET), { method: "DELETE" });
    await fetchFeed(pathSecretPath(OTHER_SECRET));

    expect(everyLogLine()).not.toContain(SECRET);
    expect(everyLogLine()).not.toContain(OTHER_SECRET);
  });
});

describe("rotation and revocation", () => {
  test("the secret a rotation replaced works for a day after it, and not a moment longer; the new one at once", async () => {
    feed!.secret = new HashedString(
      SecurityBlocklistFeedService.hashSecret(OTHER_SECRET),
      true,
    );
    feed!.previousSecret = new HashedString(
      SecurityBlocklistFeedService.hashSecret(SECRET),
      true,
    );
    feed!.previousSecretExpiresAt = new Date(
      NOW.getTime() + SECURITY_BLOCKLIST_FEED_SECRET_GRACE_IN_MS,
    );

    expect(
      (await fetchFeed(feedPath(), { headers: bearer(OTHER_SECRET) })).status,
    ).toBe(200);
    expect(fetches[fetches.length - 1]!.usedPreviousSecret).toBe(false);

    // The firewall not yet given the new secret still reads the feed - and the log says it uses the old one.
    expect(
      (await fetchFeed(feedPath(), { headers: bearer(SECRET) })).status,
    ).toBe(200);
    expect(fetches[fetches.length - 1]!.usedPreviousSecret).toBe(true);
    expect((await fetchFeed(pathSecretPath(SECRET))).status).toBe(200);

    now = new Date(
      NOW.getTime() + SECURITY_BLOCKLIST_FEED_SECRET_GRACE_IN_MS - 1,
    );
    expect(
      (await fetchFeed(feedPath(), { headers: bearer(SECRET) })).status,
    ).toBe(200);

    now = new Date(NOW.getTime() + SECURITY_BLOCKLIST_FEED_SECRET_GRACE_IN_MS);
    expect(
      (await fetchFeed(feedPath(), { headers: bearer(SECRET) })).status,
    ).toBe(401);
    expect((await fetchFeed(pathSecretPath(SECRET))).status).toBe(404);
    expect(
      (await fetchFeed(feedPath(), { headers: bearer(OTHER_SECRET) })).status,
    ).toBe(200);
  });

  test("a revoked feed answers nobody, at once: neither its secret nor the one before", async () => {
    feed!.previousSecret = new HashedString(
      SecurityBlocklistFeedService.hashSecret(OTHER_SECRET),
      true,
    );
    feed!.previousSecretExpiresAt = new Date(NOW.getTime() + HOUR_IN_MS);
    expect(
      (await fetchFeed(feedPath(), { headers: bearer(SECRET) })).status,
    ).toBe(200);

    // What revokeSecret writes.
    feed!.secret = null as unknown as HashedString;
    feed!.previousSecret = null as unknown as HashedString;
    feed!.previousSecretExpiresAt = null as unknown as Date;
    feed!.revokedAt = NOW;

    expect(
      (await fetchFeed(feedPath(), { headers: bearer(SECRET) })).status,
    ).toBe(401);
    expect(
      (await fetchFeed(feedPath(), { headers: bearer(OTHER_SECRET) })).status,
    ).toBe(401);
    expect((await fetchFeed(pathSecretPath(SECRET))).status).toBe(404);
  });

  test("a deleted feed's URL stops working", async () => {
    feed = null;

    expect(
      (await fetchFeed(feedPath(), { headers: bearer(SECRET) })).status,
    ).toBe(404);
  });
});

describe("the rate limit", () => {
  test("a feed answers one address 60 times a minute, then 429 with Retry-After, before any read", async () => {
    for (
      let attempt: number = 0;
      attempt < SECURITY_BLOCKLIST_FEED_RATE_LIMIT_PER_FEED;
      attempt++
    ) {
      expect(
        (await fetchFeed(feedPath(), { headers: bearer(SECRET) })).status,
      ).toBe(200);
    }

    const reads: number = (
      SecurityBlocklistFeedService.findForServe as jest.Mock
    ).mock.calls.length;

    const refused: HttpResult = await fetchFeed(feedPath(), {
      headers: bearer(SECRET),
    });

    expect(refused.status).toBe(429);
    expect(JSON.parse(refused.body).message).toBe(RATE_LIMITED_MESSAGE);
    expect(Number(refused.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(Number(refused.headers["retry-after"])).toBeLessThanOrEqual(60);
    // Refused before the feed was read.
    expect(
      (SecurityBlocklistFeedService.findForServe as jest.Mock).mock.calls
        .length,
    ).toBe(reads);
    expect(fetches).toHaveLength(SECURITY_BLOCKLIST_FEED_RATE_LIMIT_PER_FEED);
  });

  test("the limit is per feed: another feed from the same address is counted apart", async () => {
    for (
      let attempt: number = 0;
      attempt <= SECURITY_BLOCKLIST_FEED_RATE_LIMIT_PER_FEED;
      attempt++
    ) {
      await request(feedPath(), { headers: bearer(SECRET) });
    }

    expect(
      (await request(feedPath(), { headers: bearer(SECRET) })).status,
    ).toBe(429);

    const other: HttpResult = await request(
      `${API_PREFIX}/blocklist-feed/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/blocklist.txt`,
      { headers: bearer(SECRET) },
    );
    expect(other.status).toBe(404);
  });
});

describe("the source allowlist", () => {
  test("with none, any address with the secret reads the feed", async () => {
    expect(
      (await fetchFeed(feedPath(), { headers: bearer(SECRET) })).status,
    ).toBe(200);
  });

  test("an address it holds reads the feed; any other gets 403, and is not logged as a fetch", async () => {
    feed!.allowedSourceAddresses = "10.0.0.0/8\n2001:db8::/32";

    const refused: HttpResult = await fetchFeed(feedPath(), {
      headers: bearer(SECRET),
    });
    expect(refused.status).toBe(403);
    expect(JSON.parse(refused.body).message).toBe(SOURCE_NOT_ALLOWED_MESSAGE);
    expect(fetches).toEqual([]);

    feed!.allowedSourceAddresses = "203.0.113.7\n127.0.0.0/8";
    expect(
      (await fetchFeed(feedPath(), { headers: bearer(SECRET) })).status,
    ).toBe(200);
    expect(fetches[0]!.sourceIp).toBe("127.0.0.1");
  });

  test("a wrong secret from an allowed address is still refused", async () => {
    feed!.allowedSourceAddresses = "127.0.0.1";

    expect(
      (await fetchFeed(feedPath(), { headers: bearer(OTHER_SECRET) })).status,
    ).toBe(401);
  });
});

describe("what is served", () => {
  test("expired, lifted and challenged blocks are never served, and protected addresses never", async () => {
    blocks = [
      block("35.205.11.131"),
      block("35.205.11.132", { state: SecurityBlockState.Lifted }),
      block("35.205.11.133", { state: SecurityBlockState.Expired }),
      block("35.205.11.134", { expiresAt: new Date(NOW.getTime() - 1) }),
      block("35.205.11.135", { action: SecurityBlockAction.Challenge }),
      block("203.0.113.0/24"),
      block("198.51.100.7"),
    ];
    protections = [
      {
        source: SecurityProtectedAddressSource.ProtectedEntity,
        protectedValue: "203.0.113.80",
        name: "office",
      },
    ];

    const result: HttpResult = await fetchFeed(feedPath(), {
      headers: bearer(SECRET),
    });

    expect(result.body).toBe("35.205.11.131\n198.51.100.7\n");
  });

  test("an address someone protects is gone from the very next fetch", async () => {
    expect(
      (await fetchFeed(feedPath(), { headers: bearer(SECRET) })).body,
    ).toBe("35.205.11.131\n2001:db8::9\n");

    protections = [
      {
        source: SecurityProtectedAddressSource.ProtectedEntity,
        protectedValue: "35.205.11.131",
        name: "office",
      },
    ];

    expect(
      (await fetchFeed(feedPath(), { headers: bearer(SECRET) })).body,
    ).toBe("2001:db8::9\n");
  });

  test("when what protects an address cannot be read: 503 with Retry-After, and the firewall keeps its list", async () => {
    jest
      .spyOn(SecurityProtectedAddresses, "readAllProtections")
      .mockImplementation((async () => {
        return {
          protections: [],
          unreadSources: [SecurityProtectedAddressSource.CloudResource],
          incompleteSources: [],
        };
      }) as never);

    const result: HttpResult = await fetchFeed(feedPath(), {
      headers: bearer(SECRET),
    });

    expect(result.status).toBe(503);
    expect(result.headers["retry-after"]).toBe("60");
    expect(JSON.parse(result.body).message).toBe(UNAVAILABLE_MESSAGE);
    expect(fetches).toEqual([]);
  });

  test("each format, by its file: the commented list, the nftables script, the nginx include, and the MD5", async () => {
    const commented: HttpResult = await fetchFeed(`${feedPath()}?comments=1`, {
      headers: bearer(SECRET),
    });
    expect(commented.body).toBe(
      "# OneUptime blocklist until 2026-11-21 11:00 UTC\n35.205.11.131\n# OneUptime blocklist until 2026-11-21 11:00 UTC\n2001:db8::9\n",
    );
    expect(fetches[fetches.length - 1]!.file).toBe("blocklist.txt?comments=1");

    const nft: HttpResult = await fetchFeed(feedPath("nftables.nft"), {
      headers: bearer(SECRET),
    });
    expect(nft.body).toContain(
      "add element inet oneuptime blocklist_v4 { 35.205.11.131 }\n",
    );
    expect(nft.body).toContain(
      "add element inet oneuptime blocklist_v6 { 2001:db8::9 }\n",
    );

    const nginx: HttpResult = await fetchFeed(feedPath("nginx.conf"), {
      headers: bearer(SECRET),
    });
    expect(nginx.body).toContain("deny 35.205.11.131;\ndeny 2001:db8::9;\n");

    const md5: HttpResult = await fetchFeed(
      pathSecretPath(SECRET, "blocklist.txt.md5"),
    );
    expect(md5.body).toBe(
      getSecurityBlocklistFeedMd5("35.205.11.131\n2001:db8::9\n"),
    );
    expect(md5.headers["content-type"]).toBe("text/plain; charset=utf-8");
  });

  test("an ETag on every list, a 304 when the firewall holds it already, and a 200 once it changed", async () => {
    const first: HttpResult = await fetchFeed(feedPath(), {
      headers: bearer(SECRET),
    });
    const etag: string = first.headers["etag"] as string;

    expect(etag).toBe(`"${getSecurityBlocklistFeedMd5(first.body)}"`);
    expect(first.headers["cache-control"]).toBe("private, no-cache");

    const second: HttpResult = await fetchFeed(feedPath(), {
      headers: { ...bearer(SECRET), "If-None-Match": etag },
    });
    expect(second.status).toBe(304);
    expect(second.body).toBe("");
    expect(second.headers["etag"]).toBe(etag);

    blocks.push(block("198.51.100.7"));

    const third: HttpResult = await fetchFeed(feedPath(), {
      headers: { ...bearer(SECRET), "If-None-Match": etag },
    });
    expect(third.status).toBe(200);
    expect(third.headers["etag"]).not.toBe(etag);

    expect(
      fetches.map((made: SecurityBlocklistFeedFetchRecord) => {
        return [made.statusCode, made.isChanged];
      }),
    ).toEqual([
      [200, true],
      [304, false],
      [200, true],
    ]);
  });

  test("a HEAD is answered and loads nothing: it is not logged as a fetch", async () => {
    const result: HttpResult = await fetchFeed(feedPath(), {
      method: "HEAD",
      headers: bearer(SECRET),
    });

    expect(result.status).toBe(200);
    expect(result.body).toBe("");
    expect(fetches).toEqual([]);
    expect(feed!.servedConfirmedAt).toBeUndefined();
  });

  test("a fetch records what the firewall holds now, and when", async () => {
    await fetchFeed(feedPath(), {
      headers: { ...bearer(SECRET), "User-Agent": "PAN-OS 11.1" },
    });

    expect(feed!.servedValues).toEqual(["35.205.11.131", "2001:db8::9"]);
    expect(feed!.servedConfirmedAt).toEqual(NOW);
    expect(feed!.lastFetchedAt).toEqual(NOW);
    expect(feed!.lastFetchSourceIp).toBe("127.0.0.1");
    expect(feed!.lastFetchUserAgent).toBe("PAN-OS 11.1");
    expect(SecurityBlocklistJobs.queueReconcile).toHaveBeenCalledWith(
      PROJECT_ID,
    );
  });
});

describe("reading a request's secret", () => {
  test("the path's, else a bearer token, else basic auth's password", () => {
    expect(
      readSecurityBlocklistFeedCredentials({
        pathSecret: ` ${SECRET} `,
        authorization: `Bearer ${OTHER_SECRET}`,
      }),
    ).toEqual({ secret: SECRET, method: "Path" });
    expect(
      readSecurityBlocklistFeedCredentials({
        pathSecret: null,
        authorization: `bearer   ${SECRET}  `,
      }),
    ).toEqual({ secret: SECRET, method: "Bearer" });
    expect(
      readSecurityBlocklistFeedCredentials({
        pathSecret: null,
        authorization: basic("user:with:colons", SECRET)["Authorization"],
      }),
    ).toEqual({ secret: `with:colons:${SECRET}`, method: "Basic" });
    expect(
      readSecurityBlocklistFeedCredentials({
        pathSecret: null,
        authorization: [`Bearer ${SECRET}`, "Bearer other"],
      }),
    ).toEqual({ secret: SECRET, method: "Bearer" });
    expect(
      readSecurityBlocklistFeedCredentials({
        pathSecret: null,
        authorization: undefined,
      }),
    ).toBeNull();
  });

  test("If-None-Match names the ETag, weakly or among others, or any", () => {
    expect(isSecurityBlocklistFeedNotModified('"abc"', '"abc"')).toBe(true);
    expect(isSecurityBlocklistFeedNotModified('W/"abc"', '"abc"')).toBe(true);
    expect(isSecurityBlocklistFeedNotModified('"x", "abc"', '"abc"')).toBe(
      true,
    );
    expect(isSecurityBlocklistFeedNotModified("*", '"abc"')).toBe(true);
    expect(isSecurityBlocklistFeedNotModified('"abd"', '"abc"')).toBe(false);
    expect(isSecurityBlocklistFeedNotModified("", '"abc"')).toBe(false);
    expect(isSecurityBlocklistFeedNotModified(undefined, '"abc"')).toBe(false);
  });
});
