import type { ClickHouseClient } from "@clickhouse/client";
import {
  DatabaseCall,
  DatabaseServer,
  DatabaseSystemName,
  StatementSummary,
  summarizeStatement,
  traceDatabaseCall,
} from "./DatabaseClientSpan";

/*
 * A CLIENT span for every query, insert and statement a ClickHouse pool of
 * OneUptime's own sends (ClickhouseDatabase.connect instruments each pool's
 * client): "SELECT oneuptime.Log", "INSERT MetricItemV2", under the request
 * or job that sent it. See DatabaseClientSpan for the rules every such span
 * follows.
 *
 * The client speaks HTTP, but no HTTP instrumentation is involved: the
 * client's own methods are wrapped, on the instances OneUptime made, so no
 * other outgoing request is touched.
 *
 * A query's span ends when ClickHouse starts answering, which for a read
 * with a time limit (http_wait_end_of_query) is when the query is done; a
 * read that streams its rows goes on being read by its caller after that.
 * An insert's ends when ClickHouse has accepted the rows. Rows are never
 * recorded, and the statements the services send carry their values as
 * query parameters ({p0:String}), so the text recorded holds none either.
 */

const INSTRUMENTED: unique symbol = Symbol("oneuptime.clickhouseQuerySpans");

type ClientMethod = (params: unknown, ...rest: Array<unknown>) => unknown;

interface InstrumentableClickhouseClient {
  query: ClientMethod;
  insert: ClientMethod;
  exec: ClientMethod;
  command: ClientMethod;
  [INSTRUMENTED]?: boolean | undefined;
}

export interface ClickhouseConnection {
  url?: string | URL | undefined;
  database?: string | undefined;
}

// Where a pool's requests go, from the options it was created with.
export function getClickhouseServer(
  connection: ClickhouseConnection,
): DatabaseServer {
  let address: string | undefined = undefined;
  let port: number | undefined = undefined;

  if (connection.url) {
    try {
      const url: URL = new URL(connection.url.toString());
      address = url.hostname || undefined;
      port = url.port
        ? Number(url.port)
        : url.protocol === "https:"
          ? 8443
          : 8123;
    } catch {
      // The client accepted it; the span simply goes without an address.
    }
  }

  return {
    address: address,
    port: port,
    namespace: connection.database || undefined,
  };
}

function statementOf(params: unknown): string | undefined {
  const query: unknown = (params as { query?: unknown } | undefined)?.query;
  return typeof query === "string" ? query : undefined;
}

export function describeClickhouseCall(
  method: "query" | "insert" | "exec" | "command",
  params: unknown,
  server: DatabaseServer,
): DatabaseCall {
  if (method === "insert") {
    const table: unknown = (params as { table?: unknown } | undefined)?.table;
    const format: unknown = (params as { format?: unknown } | undefined)
      ?.format;
    const tableName: string | null =
      typeof table === "string" && table ? table : null;

    return {
      system: DatabaseSystemName.ClickHouse,
      server: server,
      operation: "INSERT",
      collection: tableName,
      // The statement the client sends; the rows follow it in the body.
      queryText: tableName
        ? `INSERT INTO ${tableName} FORMAT ${typeof format === "string" ? format : "JSONCompactEachRow"}`
        : undefined,
    };
  }

  const statement: string | undefined = statementOf(params);
  const summary: StatementSummary = statement
    ? summarizeStatement(statement)
    : { operation: null, collection: null };

  return {
    system: DatabaseSystemName.ClickHouse,
    server: server,
    operation: summary.operation,
    collection: summary.collection,
    queryText: statement,
  };
}

const TRACED_METHODS: Array<"query" | "insert" | "exec" | "command"> = [
  "query",
  "insert",
  "exec",
  "command",
];

export default class ClickhouseQuerySpans {
  public static isInstrumented(client: ClickHouseClient): boolean {
    return Boolean(
      (client as unknown as InstrumentableClickhouseClient)[INSTRUMENTED],
    );
  }

  // Idempotent: a client is instrumented once, however often it is handed in.
  public static instrument(
    client: ClickHouseClient,
    connection: ClickhouseConnection,
  ): void {
    const clickhouse: InstrumentableClickhouseClient =
      client as unknown as InstrumentableClickhouseClient;

    if (clickhouse[INSTRUMENTED]) {
      return;
    }

    clickhouse[INSTRUMENTED] = true;

    const server: DatabaseServer = getClickhouseServer(connection);

    for (const method of TRACED_METHODS) {
      const original: ClientMethod | undefined = clickhouse[method];

      if (typeof original !== "function") {
        continue;
      }

      clickhouse[method] = function (
        this: InstrumentableClickhouseClient,
        params: unknown,
        ...rest: Array<unknown>
      ): Promise<unknown> {
        return traceDatabaseCall(
          () => {
            return describeClickhouseCall(method, params, server);
          },
          () => {
            return original.call(this, params, ...rest) as Promise<unknown>;
          },
        );
      };
    }
  }
}
