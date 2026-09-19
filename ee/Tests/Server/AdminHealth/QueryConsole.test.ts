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
import { createServer, Server } from "http";
import { AddressInfo } from "net";

/*
 * The OneUptime Health query console, served by the enterprise module.
 *
 * Who may use it: a signed-in master admin (JWT only, never the master API
 * key), on a self-hosted Enterprise Edition whose license covers instance
 * health. OneUptime Cloud (billing on) never offers it - it would run against
 * shared production datastores - whatever the license says.
 *
 * What it may do: the safety rails moved with it unchanged - read-only by
 * default, row and cell caps, statement timeouts, host-escape and Redis
 * denylists - so they are pinned here against fake datastores.
 *
 * Billing AND the edition are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true).
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("Common/Server/Middleware/MasterAdminAuthorization", () => {
  type Middleware = (req: unknown, res: unknown, next: () => void) => void;

  const isAuthorizedMasterAdminMiddleware: Middleware = (
    _req: unknown,
    _res: unknown,
    next: () => void,
  ): void => {
    next();
  };

  const isAuthorizedMasterAdminOrMasterApiKeyMiddleware: Middleware = (
    _req: unknown,
    _res: unknown,
    next: () => void,
  ): void => {
    next();
  };

  return {
    __esModule: true,
    default: {
      isAuthorizedMasterAdminMiddleware,
      isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
    },
  };
});

import EnterpriseModule from "../../../Server/Index";
import { getAdminHealthRouter } from "../../../Server/AdminHealth/Index";
import {
  assertQueryConsoleAvailable,
  clickhouseStatementIsRead,
  createQueryConsoleRouter,
  firstSqlKeyword,
  parseRedisCommandLine,
  QUERY_CONSOLE_ENGINES,
  QUERY_CONSOLE_NOT_ON_CLOUD_MESSAGE,
  QUERY_DEFAULT_ROWS,
  QUERY_MAX_CELL_LENGTH,
  QUERY_MAX_ROWS,
  QUERY_REDIS_MAX_COMMANDS,
  REDIS_ALWAYS_BLOCKED,
  REDIS_READONLY_ALLOWED,
  resolveRowLimit,
  toQueryCell,
  assertPostgresStatementAllowed,
} from "../../../Server/AdminHealth/QueryConsole";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import { EnterpriseServerModuleShape } from "Common/Server/Enterprise/EnterpriseServerModule";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Redis from "Common/Server/Infrastructure/Redis";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Exception from "Common/Types/Exception/Exception";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

interface HttpResult {
  status: number;
  body: JSONObject;
}

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: unknown }>;
  };
};

let httpServer: Server;
let baseUrl: string = "";

const runQuery: (
  engine: string,
  body: JSONObject,
) => Promise<HttpResult> = async (
  engine: string,
  body: JSONObject,
): Promise<HttpResult> => {
  const response: globalThis.Response = await fetch(
    `${baseUrl}/api/admin/health/query/${engine}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  return {
    status: response.status,
    body: (await response.json()) as JSONObject,
  };
};

// The licensed, self-hosted state every engine test runs in.
const licensedSelfHosted: () => void = (): void => {
  setTestBillingEnabled(false);
  installFakeEnterpriseModule();
};

// ---- fake datastores -----------------------------------------------------

interface FakeQueryRunner {
  queries: Array<string>;
  committed: boolean;
  rolledBack: boolean;
  released: boolean;
  isTransactionActive: boolean;
  connect: () => Promise<void>;
  startTransaction: () => Promise<void>;
  commitTransaction: () => Promise<void>;
  rollbackTransaction: () => Promise<void>;
  release: () => Promise<void>;
  query: (
    sql: string,
    parameters?: unknown,
    useStructuredResult?: boolean,
  ) => Promise<unknown>;
}

const createFakeQueryRunner: (data: {
  records: Array<Record<string, unknown>>;
  affected?: number;
  failOn?: string;
}) => FakeQueryRunner = (data: {
  records: Array<Record<string, unknown>>;
  affected?: number;
  failOn?: string;
}): FakeQueryRunner => {
  const runner: FakeQueryRunner = {
    queries: [],
    committed: false,
    rolledBack: false,
    released: false,
    isTransactionActive: false,
    connect: async (): Promise<void> => {
      return undefined;
    },
    startTransaction: async (): Promise<void> => {
      runner.isTransactionActive = true;
    },
    commitTransaction: async (): Promise<void> => {
      runner.committed = true;
      runner.isTransactionActive = false;
    },
    rollbackTransaction: async (): Promise<void> => {
      runner.rolledBack = true;
      runner.isTransactionActive = false;
    },
    release: async (): Promise<void> => {
      runner.released = true;
    },
    query: async (sql: string): Promise<unknown> => {
      runner.queries.push(sql);

      if (data.failOn && sql.includes(data.failOn)) {
        throw new Error(`relation "${data.failOn}" does not exist`);
      }

      if (sql.startsWith("FETCH FORWARD")) {
        const count: number = Number(sql.split(" ")[2]);
        return { records: data.records.slice(0, count) };
      }

      if (
        sql.startsWith("SET ") ||
        sql.startsWith("DECLARE ") ||
        sql.startsWith("CLOSE ")
      ) {
        return { records: [] };
      }

      return {
        records: data.records,
        affected: data.affected,
      };
    },
  };

  return runner;
};

const usePostgres: (runner: FakeQueryRunner) => void = (
  runner: FakeQueryRunner,
): void => {
  jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
    createQueryRunner: (): FakeQueryRunner => {
      return runner;
    },
  } as unknown as ReturnType<typeof PostgresAppInstance.getDataSource>);
};

interface FakeClickhouseClient {
  queries: Array<{ query: string; settings: Record<string, unknown> }>;
  commands: Array<{ query: string; settings: Record<string, unknown> }>;
  query: (input: {
    query: string;
    clickhouse_settings: Record<string, unknown>;
  }) => Promise<{ json: () => Promise<unknown> }>;
  command: (input: {
    query: string;
    clickhouse_settings: Record<string, unknown>;
  }) => Promise<void>;
}

const useClickhouse: (result: {
  meta: Array<{ name: string; type: string }>;
  data: Array<Record<string, unknown>>;
}) => FakeClickhouseClient = (result: {
  meta: Array<{ name: string; type: string }>;
  data: Array<Record<string, unknown>>;
}): FakeClickhouseClient => {
  const client: FakeClickhouseClient = {
    queries: [],
    commands: [],
    query: async (input: {
      query: string;
      clickhouse_settings: Record<string, unknown>;
    }): Promise<{ json: () => Promise<unknown> }> => {
      client.queries.push({
        query: input.query,
        settings: input.clickhouse_settings,
      });
      return {
        json: async (): Promise<unknown> => {
          return result;
        },
      };
    },
    command: async (input: {
      query: string;
      clickhouse_settings: Record<string, unknown>;
    }): Promise<void> => {
      client.commands.push({
        query: input.query,
        settings: input.clickhouse_settings,
      });
    },
  };

  jest
    .spyOn(ClickhouseAppInstance, "getDataSource")
    .mockReturnValue(
      client as unknown as ReturnType<
        typeof ClickhouseAppInstance.getDataSource
      >,
    );

  return client;
};

interface FakeRedisConnection {
  calls: Array<Array<string>>;
  disconnected: boolean;
  call: (command: string, ...args: Array<string>) => Promise<unknown>;
  disconnect: () => void;
}

interface FakeRedis {
  base: { calls: Array<Array<string>>; duplicate: () => FakeRedisConnection };
  connections: Array<FakeRedisConnection>;
}

const useRedis: (replies: Record<string, unknown>) => FakeRedis = (
  replies: Record<string, unknown>,
): FakeRedis => {
  const fake: FakeRedis = {
    base: {
      calls: [],
      duplicate: (): FakeRedisConnection => {
        const connection: FakeRedisConnection = {
          calls: [],
          disconnected: false,
          call: async (
            command: string,
            ...args: Array<string>
          ): Promise<unknown> => {
            connection.calls.push([command, ...args]);
            return replies[command] ?? "OK";
          },
          disconnect: (): void => {
            connection.disconnected = true;
          },
        };
        fake.connections.push(connection);
        return connection;
      },
    },
    connections: [],
  };

  jest
    .spyOn(Redis, "getClient")
    .mockReturnValue(
      fake.base as unknown as ReturnType<typeof Redis.getClient>,
    );
  jest.spyOn(Redis, "isConnected").mockReturnValue(true);

  return fake;
};

// ---------------------------------------------------------------------------

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson());
  app.use("/api/admin/health", getAdminHealthRouter() as ExpressRouter);
  app.use(
    (
      error: Exception,
      _req: ExpressRequest,
      res: ExpressResponse,
      _next: NextFunction,
    ): void => {
      const status: number =
        typeof error.code === "number" && error.code >= 400 && error.code < 600
          ? error.code
          : 500;
      res.status(status).json({ message: error.message });
    },
  );

  httpServer = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    httpServer.close((): void => {
      resolve();
    });
  });
});

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(null);
  jest.spyOn(ClickhouseAppInstance, "getDataSource").mockReturnValue(null);
  jest.spyOn(Redis, "getClient").mockReturnValue(null);
  jest.spyOn(Redis, "isConnected").mockReturnValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
});

describe("the enterprise admin-health router", () => {
  const layers: () => Array<RouteLayer> = (): Array<RouteLayer> => {
    return (getAdminHealthRouter() as unknown as { stack: Array<RouteLayer> })
      .stack;
  };

  test("is what the assembled enterprise module hands core, built once", () => {
    const router: ExpressRouter | null = getAdminHealthRouter();

    expect(router).not.toBeNull();
    expect(getAdminHealthRouter()).toBe(router);
    expect(EnterpriseModule.getAdminHealthRouter()).toBe(router);
  });

  /*
   * It is mounted at /api/admin/health AHEAD of core's router: a router.use()
   * layer here would run for every core health request, and a master-admin-only
   * one would turn master-API-key requests to /migrations and /support-bundle
   * into 403s.
   */
  test("holds routes only - no router.use() layer", () => {
    expect(
      EnterpriseServerModuleShape.findLayersWithoutRoute(
        getAdminHealthRouter() as ExpressRouter,
      ),
    ).toEqual([]);
    expect(
      EnterpriseServerModuleShape.findLayersWithoutRoute(
        createQueryConsoleRouter(),
      ),
    ).toEqual([]);
  });

  test("serves exactly the three console routes, as POSTs", () => {
    expect(
      layers().map((layer: RouteLayer): string => {
        return `${Object.keys(layer.route?.methods || {}).join(",")} ${layer.route?.path}`;
      }),
    ).toEqual([
      "post /query/postgres",
      "post /query/clickhouse",
      "post /query/redis",
    ]);
    expect([...QUERY_CONSOLE_ENGINES]).toEqual([
      "postgres",
      "clickhouse",
      "redis",
    ]);
  });

  test("never shadows a core read-only route", () => {
    for (const layer of layers()) {
      expect(layer.route?.methods["get"]).toBeUndefined();
    }
  });

  test("keeps every console route on the JWT-only master-admin middleware (never the master API key)", () => {
    for (const layer of layers()) {
      expect(layer.route?.stack[0]?.handle).toBe(
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      );
      expect(layer.route?.stack[0]?.handle).not.toBe(
        MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
      );
    }
  });
});

describe("who may use the console", () => {
  test.each(QUERY_CONSOLE_ENGINES)(
    "OneUptime Cloud (billing on) refuses %s with a Cloud message, even with a valid license",
    async (engine: string) => {
      setTestBillingEnabled(true);
      installFakeEnterpriseModule();

      const result: HttpResult = await runQuery(engine, { query: "SELECT 1" });

      expect(result.status).toBe(402);
      expect(result.body["message"]).toBe(QUERY_CONSOLE_NOT_ON_CLOUD_MESSAGE);
      expect(QUERY_CONSOLE_NOT_ON_CLOUD_MESSAGE).toContain("OneUptime Cloud");
    },
  );

  test("the Cloud refusal comes before anything reaches a datastore", async () => {
    setTestBillingEnabled(true);
    installFakeEnterpriseModule();
    const runner: FakeQueryRunner = createFakeQueryRunner({ records: [] });
    usePostgres(runner);

    await runQuery("postgres", {
      query: 'DELETE FROM "User"',
      readOnly: false,
    });

    expect(runner.queries).toEqual([]);
  });

  test("without the enterprise module registered it answers with the Community message", async () => {
    const result: HttpResult = await runQuery("postgres", {
      query: "SELECT 1",
    });

    expect(result.status).toBe(402);
    expect(result.body["message"]).toBe(
      EnterpriseEdition.COMMUNITY_EDITION_MESSAGE,
    );
  });

  test.each(["missing", "expired", "invalid"] as const)(
    "an Enterprise install whose license is %s is refused with the license message",
    async (status: "missing" | "expired" | "invalid") => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus(status),
      });

      const result: HttpResult = await runQuery("redis", { query: "PING" });

      expect(result.status).toBe(402);
      expect(result.body["message"]).toBe(
        EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
      );
    },
  );

  test("a license that leaves out instance health is refused", async () => {
    installFakeEnterpriseModuleWithFeatures([
      EnterpriseFeature.SSO,
      EnterpriseFeature.SCIM,
      EnterpriseFeature.TeamCompliance,
      EnterpriseFeature.AuditLogs,
    ]);

    const result: HttpResult = await runQuery("clickhouse", {
      query: "SELECT 1",
    });

    expect(result.status).toBe(402);
  });

  test.each(["valid", "grace"] as const)(
    "a self-hosted install with a %s license reaches the engine",
    async (status: "valid" | "grace") => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus(status),
      });

      const result: HttpResult = await runQuery("postgres", {
        query: "SELECT 1",
      });

      expect(result.status).toBe(200);
      expect(result.body["success"]).toBe(false);
      expect(result.body["error"]).toBe(
        "Postgres is not connected on this instance.",
      );
    },
  );

  test("the edition answer comes before request validation", async () => {
    const result: HttpResult = await runQuery("postgres", { query: "   " });

    expect(result.status).toBe(402);
  });

  test("a licensed request without a query is a 400", async () => {
    licensedSelfHosted();

    const result: HttpResult = await runQuery("postgres", { query: "   " });

    expect(result.status).toBe(400);
    expect(result.body["message"]).toBe("A query is required.");
  });

  test("assertQueryConsoleAvailable checks billing first, then the license", async () => {
    setTestBillingEnabled(true);
    await expect(assertQueryConsoleAvailable()).rejects.toThrow(
      QUERY_CONSOLE_NOT_ON_CLOUD_MESSAGE,
    );

    setTestBillingEnabled(false);
    await expect(assertQueryConsoleAvailable()).rejects.toThrow(
      EnterpriseEdition.COMMUNITY_EDITION_MESSAGE,
    );

    installFakeEnterpriseModule();
    await expect(assertQueryConsoleAvailable()).resolves.toBeUndefined();
  });
});

describe("Postgres", () => {
  beforeEach(licensedSelfHosted);

  test("read-only pages a SELECT through a cursor inside a READ ONLY transaction and rolls it back", async () => {
    const runner: FakeQueryRunner = createFakeQueryRunner({
      records: [{ id: 1 }, { id: 2 }, { id: 3 }],
    });
    usePostgres(runner);

    const result: HttpResult = await runQuery("postgres", {
      query: 'SELECT id FROM "User";',
      maxRows: 2,
    });

    expect(result.status).toBe(200);
    expect(result.body["success"]).toBe(true);
    expect(runner.queries).toEqual([
      "SET TRANSACTION READ ONLY",
      "SET LOCAL statement_timeout = 30000",
      'DECLARE oneuptime_console_cursor NO SCROLL CURSOR FOR SELECT id FROM "User"',
      "FETCH FORWARD 3 FROM oneuptime_console_cursor",
      "CLOSE oneuptime_console_cursor",
    ]);
    expect(runner.rolledBack).toBe(true);
    expect(runner.committed).toBe(false);
    expect(runner.released).toBe(true);
    expect(result.body["rows"]).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.body["columns"]).toEqual(["id"]);
    expect(result.body["truncated"]).toBe(true);
    expect(result.body["readOnly"]).toBe(true);
  });

  test("read-only is the default when the request does not say", async () => {
    const runner: FakeQueryRunner = createFakeQueryRunner({ records: [] });
    usePostgres(runner);

    await runQuery("postgres", { query: "SELECT 1" });

    expect(runner.queries[0]).toBe("SET TRANSACTION READ ONLY");
    expect(runner.rolledBack).toBe(true);
  });

  test("write mode commits and reports the affected rows", async () => {
    const runner: FakeQueryRunner = createFakeQueryRunner({
      records: [],
      affected: 3,
    });
    usePostgres(runner);

    const result: HttpResult = await runQuery("postgres", {
      query: "UPDATE \"Project\" SET name = 'x'",
      readOnly: false,
    });

    expect(runner.queries).not.toContain("SET TRANSACTION READ ONLY");
    expect(runner.committed).toBe(true);
    expect(result.body["message"]).toBe(
      "Statement executed. 3 row(s) affected.",
    );
    expect(result.body["affectedRows"]).toBe(3);
  });

  test.each([
    ["COPY ... PROGRAM", "COPY x FROM PROGRAM 'id'"],
    ["COPY to/from a server file", "COPY x TO '/tmp/out'"],
    ["pg_read_file", "SELECT pg_read_file('/etc/passwd')"],
    ["dblink", "SELECT * FROM dblink('host=evil', 'select 1')"],
    ["lo_export", "SELECT lo_export(1, '/tmp/x')"],
  ])(
    "refuses %s even in write mode, before connecting",
    async (label: string, sql: string) => {
      const runner: FakeQueryRunner = createFakeQueryRunner({ records: [] });
      usePostgres(runner);

      const result: HttpResult = await runQuery("postgres", {
        query: sql,
        readOnly: false,
      });

      expect(result.status).toBe(200);
      expect(result.body["success"]).toBe(false);
      expect(String(result.body["error"])).toContain(
        `${label} is blocked in the query console`,
      );
      expect(runner.queries).toEqual([]);
    },
  );

  test("a failing statement is rolled back, the connection released, and the error shown inline", async () => {
    const runner: FakeQueryRunner = createFakeQueryRunner({
      records: [],
      failOn: "missing_table",
    });
    usePostgres(runner);

    const result: HttpResult = await runQuery("postgres", {
      query: "SELECT * FROM missing_table",
    });

    expect(result.status).toBe(200);
    expect(result.body["success"]).toBe(false);
    expect(result.body["error"]).toBe(
      'relation "missing_table" does not exist',
    );
    expect(runner.rolledBack).toBe(true);
    expect(runner.released).toBe(true);
  });

  test("the requested row limit is capped", async () => {
    const runner: FakeQueryRunner = createFakeQueryRunner({ records: [] });
    usePostgres(runner);

    await runQuery("postgres", { query: "SELECT 1", maxRows: 50000 });

    expect(runner.queries).toContain(
      `FETCH FORWARD ${QUERY_MAX_ROWS + 1} FROM oneuptime_console_cursor`,
    );
  });
});

describe("ClickHouse", () => {
  beforeEach(licensedSelfHosted);

  test("read-only runs a SELECT with readonly=2 and server-side caps", async () => {
    const client: FakeClickhouseClient = useClickhouse({
      meta: [{ name: "count", type: "UInt64" }],
      data: [{ count: "42" }],
    });

    const result: HttpResult = await runQuery("clickhouse", {
      query: "SELECT count() AS count FROM Log",
      maxRows: 10,
    });

    expect(result.body["success"]).toBe(true);
    expect(client.queries).toHaveLength(1);
    expect(client.queries[0]?.settings).toEqual({
      max_execution_time: 30,
      max_result_rows: "11",
      result_overflow_mode: "break",
      readonly: "2",
    });
    expect(client.commands).toEqual([]);
    expect(result.body["columns"]).toEqual(["count"]);
    expect(result.body["columnTypes"]).toEqual([
      { name: "count", type: "UInt64" },
    ]);
    expect(result.body["rows"]).toEqual([{ count: "42" }]);
  });

  test("read-only refuses a write or DDL statement without running anything", async () => {
    const client: FakeClickhouseClient = useClickhouse({ meta: [], data: [] });

    const result: HttpResult = await runQuery("clickhouse", {
      query: "ALTER TABLE Log DROP PARTITION 202601",
    });

    expect(result.body["success"]).toBe(false);
    expect(result.body["error"]).toBe(
      "This looks like a write or DDL statement. Turn off read-only mode to run it.",
    );
    expect(client.queries).toEqual([]);
    expect(client.commands).toEqual([]);
  });

  test("write mode runs DDL through command()", async () => {
    const client: FakeClickhouseClient = useClickhouse({ meta: [], data: [] });

    const result: HttpResult = await runQuery("clickhouse", {
      query: "OPTIMIZE TABLE Log FINAL",
      readOnly: false,
    });

    expect(result.body["success"]).toBe(true);
    expect(result.body["message"]).toBe("Statement executed successfully.");
    expect(client.commands).toEqual([
      {
        query: "OPTIMIZE TABLE Log FINAL",
        settings: { max_execution_time: 30 },
      },
    ]);
  });
});

describe("Valkey", () => {
  beforeEach(licensedSelfHosted);

  test("runs each line on a dedicated connection that is closed afterwards", async () => {
    const redis: FakeRedis = useRedis({ GET: "value", PING: "PONG" });

    const result: HttpResult = await runQuery("redis", {
      query: "# a comment\n\nPING\nGET some:key\n",
    });

    const results: JSONArray = result.body["results"] as JSONArray;

    expect(result.body["success"]).toBe(true);
    expect(results).toEqual([
      { command: "PING", ok: true, reply: "PONG" },
      { command: "GET some:key", ok: true, reply: "value" },
    ]);
    expect(redis.base.calls).toEqual([]);
    expect(redis.connections).toHaveLength(1);
    expect(redis.connections[0]?.calls).toEqual([
      ["PING"],
      ["GET", "some:key"],
    ]);
    expect(redis.connections[0]?.disconnected).toBe(true);
  });

  test.each([true, false])(
    "FLUSHALL is refused whatever the mode (readOnly=%s)",
    async (readOnly: boolean) => {
      const redis: FakeRedis = useRedis({});

      const result: HttpResult = await runQuery("redis", {
        query: "FLUSHALL",
        readOnly,
      });

      expect((result.body["results"] as JSONArray)[0]).toEqual({
        command: "FLUSHALL",
        ok: false,
        error:
          "The FLUSHALL command is not allowed from the query console. Use redis-cli for this operation.",
      });
      expect(redis.connections[0]?.calls).toEqual([]);
    },
  );

  test("read-only refuses a write, write mode runs it", async () => {
    const readOnlyRedis: FakeRedis = useRedis({});

    const refused: HttpResult = await runQuery("redis", {
      query: "SET a b",
    });

    expect((refused.body["results"] as JSONArray)[0]).toEqual({
      command: "SET a b",
      ok: false,
      error:
        "SET is not a permitted read-only command. Turn off read-only mode to run write commands.",
    });
    expect(readOnlyRedis.connections[0]?.calls).toEqual([]);

    const writeRedis: FakeRedis = useRedis({});

    await runQuery("redis", { query: 'SET a "b c"', readOnly: false });

    expect(writeRedis.connections[0]?.calls).toEqual([["SET", "a", "b c"]]);
  });

  test("MEMORY is read-only only for its read subcommands", async () => {
    const redis: FakeRedis = useRedis({ MEMORY: 123 });

    const result: HttpResult = await runQuery("redis", {
      query: "MEMORY USAGE some:key\nMEMORY PURGE",
    });
    const results: JSONArray = result.body["results"] as JSONArray;

    expect((results[0] as JSONObject)["ok"]).toBe(true);
    expect((results[1] as JSONObject)["ok"]).toBe(false);
    expect(redis.connections[0]?.calls).toEqual([
      ["MEMORY", "USAGE", "some:key"],
    ]);
  });

  test("more than the command cap is refused as a whole", async () => {
    useRedis({});

    const result: HttpResult = await runQuery("redis", {
      query: new Array(QUERY_REDIS_MAX_COMMANDS + 1).fill("PING").join("\n"),
    });

    expect(result.body["success"]).toBe(false);
    expect(String(result.body["error"])).toContain(
      `a maximum of ${QUERY_REDIS_MAX_COMMANDS} commands`,
    );
  });

  test("an unreachable Valkey is reported inline", async () => {
    const result: HttpResult = await runQuery("redis", { query: "PING" });

    expect(result.body["success"]).toBe(false);
    expect(result.body["error"]).toBe(
      "Valkey is not connected on this instance.",
    );
  });
});

describe("the console's pure helpers", () => {
  test("resolveRowLimit clamps into [1, max] and defaults bad input", () => {
    expect(resolveRowLimit(undefined)).toBe(QUERY_DEFAULT_ROWS);
    expect(resolveRowLimit("abc")).toBe(QUERY_DEFAULT_ROWS);
    expect(resolveRowLimit(0)).toBe(QUERY_DEFAULT_ROWS);
    expect(resolveRowLimit(-5)).toBe(QUERY_DEFAULT_ROWS);
    expect(resolveRowLimit(7.9)).toBe(7);
    expect(resolveRowLimit("25")).toBe(25);
    expect(resolveRowLimit(QUERY_MAX_ROWS * 10)).toBe(QUERY_MAX_ROWS);
  });

  test("toQueryCell makes every value JSON-safe and size-capped", () => {
    expect(toQueryCell(null)).toBeNull();
    expect(toQueryCell(undefined)).toBeNull();
    expect(toQueryCell(BigInt("9007199254740993"))).toBe("9007199254740993");
    expect(toQueryCell(new Date("2026-01-02T03:04:05.000Z"))).toBe(
      "2026-01-02T03:04:05.000Z",
    );
    expect(toQueryCell(Buffer.from([0xde, 0xad]))).toBe("0xdead");
    expect(toQueryCell(7)).toBe(7);
    expect(toQueryCell(true)).toBe(true);
    expect(toQueryCell({ a: [1, 2] })).toEqual({ a: [1, 2] });

    const long: string = "x".repeat(QUERY_MAX_CELL_LENGTH + 5);
    expect(toQueryCell(long)).toBe(
      `${"x".repeat(QUERY_MAX_CELL_LENGTH)}… (truncated)`,
    );
    expect(
      String(toQueryCell({ big: "y".repeat(QUERY_MAX_CELL_LENGTH) })),
    ).toContain("… (truncated)");
  });

  test("firstSqlKeyword skips comments and leading parentheses", () => {
    expect(firstSqlKeyword("  -- note\n/* block */ select 1")).toBe("SELECT");
    expect(firstSqlKeyword("((SELECT 1))")).toBe("SELECT");
    expect(firstSqlKeyword("with x as (select 1) select * from x")).toBe(
      "WITH",
    );
    expect(firstSqlKeyword("")).toBe("");
  });

  test("clickhouseStatementIsRead recognises read statements only", () => {
    for (const sql of [
      "SELECT 1",
      "WITH a AS (SELECT 1) SELECT * FROM a",
      "SHOW TABLES",
      "DESCRIBE Log",
      "EXPLAIN SELECT 1",
      "EXISTS TABLE Log",
    ]) {
      expect(clickhouseStatementIsRead(sql)).toBe(true);
    }

    for (const sql of [
      "INSERT INTO Log VALUES",
      "ALTER TABLE Log DELETE WHERE 1",
      "DROP TABLE Log",
      "TRUNCATE TABLE Log",
      "SYSTEM STOP MERGES",
    ]) {
      expect(clickhouseStatementIsRead(sql)).toBe(false);
    }
  });

  test("parseRedisCommandLine respects quotes and escapes", () => {
    expect(parseRedisCommandLine("SET key \"a value\" 'single q'")).toEqual([
      "SET",
      "key",
      "a value",
      "single q",
    ]);
    expect(parseRedisCommandLine('SET key "say \\"hi\\""')).toEqual([
      "SET",
      "key",
      'say "hi"',
    ]);
    expect(parseRedisCommandLine("   ")).toEqual([]);
  });

  test("assertPostgresStatementAllowed lets ordinary statements through", () => {
    expect(() => {
      assertPostgresStatementAllowed(
        'SELECT * FROM "Monitor" WHERE "copy" = 1',
      );
    }).not.toThrow();
    expect(() => {
      assertPostgresStatementAllowed("COPY x FROM PROGRAM 'id'");
    }).toThrow("COPY ... PROGRAM");
  });

  test("no Valkey command is both read-only-allowed and always-blocked", () => {
    for (const command of REDIS_READONLY_ALLOWED) {
      expect({ command, blocked: REDIS_ALWAYS_BLOCKED.has(command) }).toEqual({
        command,
        blocked: false,
      });
    }
  });

  test("the destructive and connection-hijacking commands stay blocked", () => {
    for (const command of [
      "SHUTDOWN",
      "FLUSHALL",
      "FLUSHDB",
      "CONFIG",
      "ACL",
      "EVAL",
      "SCRIPT",
      "SELECT",
      "CLIENT",
      "MONITOR",
      "REPLICAOF",
    ]) {
      expect(REDIS_ALWAYS_BLOCKED.has(command)).toBe(true);
    }
  });
});
