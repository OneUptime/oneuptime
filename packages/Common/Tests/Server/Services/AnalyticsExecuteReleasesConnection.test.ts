import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { ClickHouseClient, createClient } from "@clickhouse/client";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";
import zlib from "zlib";
import ClickhouseDatabase from "../../../Server/Infrastructure/ClickhouseDatabase";
import { dataSourceOptions } from "../../../Server/Infrastructure/ClickhouseConfig";
import AnalyticsDatabaseService, {
  MigrationExecuteOptions,
} from "../../../Server/Services/AnalyticsDatabaseService";
import {
  SQL,
  Statement,
} from "../../../Server/Utils/AnalyticsDatabase/Statement";
import StreamUtil from "../../../Server/Utils/Stream";
import MutableMetric from "../../../Models/AnalyticsModels/MutableMetric";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { Stream } from "stream";

/*
 * ---------------------------------------------------------------------------
 * A STATEMENT GIVES ITS CONNECTION BACK (#6086).
 *
 * AnalyticsDatabaseService.execute() handed back the response stream of
 * client.exec(), and none of its callers - every create, update and delete
 * of an analytics row, the migrations, the session replay jobs - read it. An
 * HTTP connection goes back to the pool only once its response is read to
 * the end, so each one stayed out until the server dropped the idle
 * keep-alive or the client's 58-second idle timer did. With the pool's
 * connections all held that way, every read queued behind them: on the perf
 * kit's stack 3,317 requests waited for half an hour, among them the
 * telemetry monitor checks that share the telemetry queue's workers with
 * OTLP ingest, which stopped too.
 *
 * Here the pool has ONE connection and the server keeps every connection
 * open, as ClickHouse does: a statement whose connection is not given back
 * leaves the next one waiting, so each call below must finish well inside a
 * few seconds.
 * ---------------------------------------------------------------------------
 */

interface ReceivedRequest {
  method: string;
  params: Record<string, string>;
  body: string;
}

const received: Array<ReceivedRequest> = [];

const server: http.Server = http.createServer(
  (request: http.IncomingMessage, response: http.ServerResponse) => {
    const chunks: Array<Buffer> = [];

    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    request.on("end", () => {
      const raw: Buffer = Buffer.concat(chunks);
      const body: string = (
        request.headers["content-encoding"] === "gzip"
          ? zlib.gunzipSync(raw)
          : raw
      ).toString("utf-8");
      const url: URL = new URL(request.url || "/", "http://localhost");
      const params: Record<string, string> = {};

      url.searchParams.forEach((value: string, key: string) => {
        params[key] = value;
      });

      received.push({ method: request.method || "", params, body });

      if (url.pathname === "/ping") {
        response.end("Ok.\n");
        return;
      }

      // An insert's statement is a URL parameter; any other is the body.
      const statement: string = params["query"] || body;

      if (statement.includes("NoSuchTable")) {
        response.statusCode = 404;
        response.setHeader("X-ClickHouse-Exception-Code", "60");
        response.end(
          "Code: 60. DB::Exception: Table oneuptime.NoSuchTable does not exist. (UNKNOWN_TABLE)\n",
        );
        return;
      }

      if (body.includes("system.columns")) {
        response.end("Nullable(String)\n");
        return;
      }

      // A statement with nothing to say: an empty answer, connection kept.
      response.end("");
    });
  },
);

let url: string;
let client: ClickHouseClient;
let service: AnalyticsDatabaseService<MutableMetric>;

const nodeSetTimeout: typeof globalThis.setTimeout =
  timers.setTimeout as typeof globalThis.setTimeout;

/*
 * Common's jest environment is jsdom, whose setTimeout returns a bare number
 * with no unref(); the client unrefs its socket timers. Lend it Node's for
 * the suite, as ClickhouseQuerySpans.test.ts does.
 */
const jsdomSetTimeout: typeof globalThis.setTimeout = globalThis.setTimeout;
const jsdomClearTimeout: typeof globalThis.clearTimeout =
  globalThis.clearTimeout;

// The work, or a failure once it has waited `ms` - as a held connection does.
async function within<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      work,
      new Promise<T>(
        (_resolve: (value: T) => void, reject: (e: Error) => void) => {
          timer = nodeSetTimeout(() => {
            reject(new Error(`still waiting after ${ms} ms`));
          }, ms);
        },
      ),
    ]);
  } finally {
    timers.clearTimeout(timer);
  }
}

interface PoolState {
  inUse: number;
  free: number;
  queued: number;
}

// The pool's HTTP agent: connections lent out, idle, and requests waiting.
function poolState(): PoolState {
  const agent: http.Agent = (
    client as unknown as { connection: { agent: http.Agent } }
  ).connection.agent;

  const count: (list: NodeJS.ReadOnlyDict<Array<unknown>>) => number = (
    list: NodeJS.ReadOnlyDict<Array<unknown>>,
  ): number => {
    return Object.values(list).reduce(
      (total: number, sockets: Array<unknown> | undefined) => {
        return total + (sockets?.length || 0);
      },
      0,
    );
  };

  return {
    inUse: count(agent.sockets),
    free: count(agent.freeSockets),
    queued: count(agent.requests),
  };
}

beforeAll(async () => {
  globalThis.setTimeout = nodeSetTimeout;
  globalThis.clearTimeout =
    timers.clearTimeout as typeof globalThis.clearTimeout;

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // The App pool's own settings (compression, keep-alive, timeouts), one connection.
  client = createClient({
    ...dataSourceOptions,
    url: url,
    username: "default",
    password: "",
    database: "oneuptime",
    max_open_connections: 1,
  });

  const database: ClickhouseDatabase = {
    getDataSource: (): ClickHouseClient => {
      return client;
    },
    getDatasourceOptions: (): { database: string } => {
      return { database: "oneuptime" };
    },
  } as unknown as ClickhouseDatabase;

  service = new AnalyticsDatabaseService<MutableMetric>({
    modelType: MutableMetric,
    database: database,
    ingestDatabase: database,
  });
});

afterAll(async () => {
  await client.close();
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
  globalThis.setTimeout = jsdomSetTimeout;
  globalThis.clearTimeout = jsdomClearTimeout;
});

beforeEach(() => {
  received.length = 0;
  jest.restoreAllMocks();
});

describe("AnalyticsDatabaseService.execute gives its connection back", () => {
  test("statements run one after another on a pool of one connection", async () => {
    for (let i: number = 0; i < 6; i++) {
      await within(
        5_000,
        service.execute(
          `INSERT INTO MutableMetricItem (name) VALUES ('metric-${i}')`,
        ),
      );

      // Nothing lent out or waiting once the call has returned.
      expect(poolState()).toEqual({ inUse: 0, free: 1, queued: 0 });
    }

    expect(received).toHaveLength(6);
  });

  test("many at once all finish, through the one connection, in turn", async () => {
    await within(
      10_000,
      Promise.all(
        Array.from({ length: 20 }, (_unused: unknown, i: number) => {
          return service.execute(
            `ALTER TABLE MutableMetricItem DELETE WHERE name = 'metric-${i}'`,
          );
        }),
      ),
    );

    expect(received).toHaveLength(20);
    expect(poolState()).toEqual({ inUse: 0, free: 1, queued: 0 });
  });

  test("a migration's statement on the migration pool gives its connection back too", async () => {
    // The service's migration pool is its database here (as in tests).
    for (let i: number = 0; i < 3; i++) {
      await within(
        5_000,
        service.execute(
          `ALTER TABLE MutableMetricItem ADD COLUMN IF NOT EXISTS c${i} String`,
          MigrationExecuteOptions,
        ),
      );
    }

    expect(poolState()).toEqual({ inUse: 0, free: 1, queued: 0 });
  });

  test("a statement ClickHouse refuses still fails, and gives its connection back", async () => {
    await expect(
      within(5_000, service.execute("INSERT INTO NoSuchTable VALUES (1)")),
    ).rejects.toThrow("NoSuchTable does not exist");

    await within(5_000, service.execute("SELECT 1"));
    expect(poolState()).toEqual({ inUse: 0, free: 1, queued: 0 });
  });

  test("the request is the one client.exec() sent: the statement, its parameters, settings and query id", async () => {
    const statement: Statement = SQL`ALTER TABLE MutableMetricItem DELETE WHERE name = ${{
      type: TableColumnType.Text,
      value: "metric-a",
    }}`;
    const options: {
      clickhouseSettings: { mutations_sync: "1" };
      queryId: string;
    } = {
      clickhouseSettings: { mutations_sync: "1" },
      queryId: "query-id-1",
    };

    await within(5_000, service.execute(statement, options));

    const sentByExecute: ReceivedRequest = received[0]!;

    // What the old execute() sent, through client.exec() itself.
    const result: { stream: NodeJS.ReadableStream } = (await within(
      5_000,
      client.exec({
        query: statement.query,
        query_params: statement.query_params,
        clickhouse_settings: options.clickhouseSettings,
        query_id: "query-id-1",
      }),
    )) as unknown as { stream: NodeJS.ReadableStream };

    // Read to the end, so this test's own call gives the connection back.
    await StreamUtil.convertStreamToText(result.stream as unknown as Stream);

    expect(sentByExecute).toEqual(received[1]);
    expect(sentByExecute.method).toBe("POST");
    expect(sentByExecute.body).toBe(statement.query);
    expect(sentByExecute.params["query_id"]).toBe("query-id-1");
    expect(sentByExecute.params["param_p0"]).toBe("metric-a");
    expect(sentByExecute.params["mutations_sync"]).toBe("1");
  });
});

describe("AnalyticsDatabaseService.executeAndReadText", () => {
  test("reads the answer, and gives the connection back", async () => {
    for (let i: number = 0; i < 4; i++) {
      await expect(
        within(
          5_000,
          service.executeAndReadText(
            "SELECT type FROM system.columns WHERE name = 'name'",
          ),
        ),
      ).resolves.toBe("Nullable(String)\n");
    }

    expect(poolState()).toEqual({ inUse: 0, free: 1, queued: 0 });
  });

  test("the column checks read through it", async () => {
    await expect(
      within(5_000, service.doesColumnExistInDatabase("name")),
    ).resolves.toBe(true);

    expect(poolState()).toEqual({ inUse: 0, free: 1, queued: 0 });
  });
});

/*
 * insertJsonRows writes its body in pieces (JsonEachRowBody) and sends it
 * through exec(), where it used to hand the rows to client.insert(), which
 * joined them into one string: the request must be the one insert() sent -
 * the same statement and settings, the same body once ungzipped - and its
 * connection given back.
 */
describe("AnalyticsDatabaseService.insertJsonRows", () => {
  const ROWS: Array<Record<string, unknown>> = Array.from(
    { length: 300 },
    (_unused: unknown, i: number) => {
      return {
        _id: `id-${i}`,
        name: i % 7 === 0 ? `métrica ${i} 🚀` : `metric-${i}`,
        attributes: { "host.name": "web-01", i: i, line: "a\nb" },
        value: i * 1.5,
      };
    },
  );

  // Every URL parameter but the per-request id, and the response's encoding.
  function comparable(request: ReceivedRequest): ReceivedRequest {
    const params: Record<string, string> = { ...request.params };
    delete params["query_id"];
    delete params["enable_http_compression"];
    return { ...request, params: params };
  }

  test("sends what client.insert() sent: the statement, the settings, the body", async () => {
    await within(
      5_000,
      service.insertJsonRows(ROWS as never, {
        dedupToken: "fanin:MutableMetricItem:1",
        clickhouseSettings: { distributed_foreground_insert: 1 },
      }),
    );

    await within(
      5_000,
      client.insert({
        table: "MutableMetricItem",
        values: ROWS,
        format: "JSONEachRow",
        // A token makes the insert synchronous (#11536).
        clickhouse_settings: {
          async_insert: 0,
          insert_deduplication_token: "fanin:MutableMetricItem:1",
          distributed_foreground_insert: 1,
        },
      }),
    );

    expect(received).toHaveLength(2);

    const sent: ReceivedRequest = received[0]!;

    expect(comparable(sent)).toEqual(comparable(received[1]!));
    expect(sent.params["query"]).toBe(
      "INSERT INTO MutableMetricItem FORMAT JSONEachRow",
    );
    expect(sent.params["insert_deduplication_token"]).toBe(
      "fanin:MutableMetricItem:1",
    );
    expect(sent.body).toBe(
      ROWS.map((row: Record<string, unknown>) => {
        return JSON.stringify(row) + "\n";
      }).join(""),
    );
    expect(poolState()).toEqual({ inUse: 0, free: 1, queued: 0 });
  });

  test("an insert asked to be async is sent without its token, as the fan-in writer's are (#11536)", async () => {
    await within(
      5_000,
      service.insertJsonRows(ROWS as never, {
        dedupToken: "fanin:MutableMetricItem:2",
        clickhouseSettings: { async_insert: 1 },
      }),
    );

    expect(received).toHaveLength(1);
    expect(received[0]!.params["async_insert"]).toBe("1");
    expect(received[0]!.params["insert_deduplication_token"]).toBeUndefined();
    expect(received[0]!.params["async_insert_deduplicate"]).toBeUndefined();
    expect(poolState()).toEqual({ inUse: 0, free: 1, queued: 0 });
  });

  test("inserts one after another on a pool of one connection", async () => {
    for (let i: number = 0; i < 5; i++) {
      await within(5_000, service.insertJsonRows(ROWS as never));
      expect(poolState()).toEqual({ inUse: 0, free: 1, queued: 0 });
    }

    expect(received).toHaveLength(5);
  });

  test("an insert ClickHouse refuses fails, and gives its connection back", async () => {
    const database: ClickhouseDatabase = {
      getDataSource: (): ClickHouseClient => {
        return client;
      },
      getDatasourceOptions: (): { database: string } => {
        return { database: "oneuptime" };
      },
    } as unknown as ClickhouseDatabase;
    const refused: AnalyticsDatabaseService<MutableMetric> =
      new AnalyticsDatabaseService<MutableMetric>({
        modelType: MutableMetric,
        database: database,
        ingestDatabase: database,
      });
    (refused.model as unknown as { tableName: string }).tableName =
      "NoSuchTable";

    await expect(
      within(5_000, refused.insertJsonRows(ROWS as never)),
    ).rejects.toThrow("NoSuchTable does not exist");

    expect(poolState()).toEqual({ inUse: 0, free: 1, queued: 0 });
  });

  test("no rows, no request", async () => {
    await service.insertJsonRows([]);
    expect(received).toHaveLength(0);
  });
});
