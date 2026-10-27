import { PostgresQueryRunner } from "typeorm/driver/postgres/PostgresQueryRunner";
import {
  DatabaseCall,
  DatabaseServer,
  DatabaseSystemName,
  StatementSummary,
  summarizeStatement,
  traceDatabaseCall,
} from "./DatabaseClientSpan";

/*
 * A CLIENT span for every statement OneUptime sends its own Postgres:
 * "SELECT Monitor", "INSERT TelemetryAttribute", "START TRANSACTION", under
 * the request or job that sent it. See DatabaseClientSpan for the rules
 * every such span follows.
 *
 * It wraps TypeORM's query runner, the one road every repository call, query
 * builder and dataSource.query() takes, so it sees exactly OneUptime's own
 * data sources - never the pg clients the probe's database monitors and the
 * Postgres data sources open to customers' databases. And it starts before
 * the runner borrows a connection from the pool: a statement that waited for
 * a free connection shows that wait in its span, where the pool being too
 * small for the load can be seen.
 *
 * The text recorded is the statement as TypeORM sends it, with $1, $2 in
 * place of every value; the values themselves are never recorded.
 */

const WRAPPED_QUERY: unique symbol = Symbol("oneuptime.postgresQuerySpans");

type QueryFunction = (
  this: PostgresQueryRunner,
  query: string,
  parameters?: Array<unknown>,
  useStructuredResult?: boolean,
) => Promise<unknown>;

type WrappedQueryFunction = QueryFunction & {
  [WRAPPED_QUERY]?: QueryFunction | undefined;
};

// TypeORM's PostgresQueryRunner, or a stand-in with its query().
export interface QueryRunnerClass {
  prototype: { query: WrappedQueryFunction };
}

interface PostgresConnectionOptions {
  host?: unknown;
  port?: unknown;
  database?: unknown;
  url?: unknown;
}

// Where a runner's statements go, from its data source's options.
export function getPostgresServer(options: unknown): DatabaseServer {
  const connectionOptions: PostgresConnectionOptions = (options ||
    {}) as PostgresConnectionOptions;

  let address: string | undefined =
    typeof connectionOptions.host === "string" && connectionOptions.host
      ? connectionOptions.host
      : undefined;
  let port: number | undefined =
    typeof connectionOptions.port === "number"
      ? connectionOptions.port
      : undefined;
  let namespace: string | undefined =
    typeof connectionOptions.database === "string" && connectionOptions.database
      ? connectionOptions.database
      : undefined;

  if (typeof connectionOptions.url === "string" && connectionOptions.url) {
    try {
      const url: URL = new URL(connectionOptions.url);
      address = address || url.hostname || undefined;
      port = port || (url.port ? Number(url.port) : undefined);
      namespace = namespace || url.pathname.replace(/^\//, "") || undefined;
    } catch {
      // A URL TypeORM could connect with but URL cannot read: keep the rest.
    }
  }

  return {
    address: address,
    port: port || 5432,
    namespace: namespace,
  };
}

export function describePostgresStatement(
  options: unknown,
  query: string,
): DatabaseCall {
  const summary: StatementSummary = summarizeStatement(query);

  return {
    system: DatabaseSystemName.Postgres,
    server: getPostgresServer(options),
    operation: summary.operation,
    collection: summary.collection,
    queryText: typeof query === "string" ? query : undefined,
  };
}

export default class PostgresQuerySpans {
  /*
   * Wrap the query runner's query() once per process. PostgresDatabase.connect
   * calls this before it opens the pool, so the schema migration runner's and
   * the failure diagnosis' data sources - built inside connect() - are
   * covered too.
   */
  public static install(
    queryRunnerClass: QueryRunnerClass = PostgresQueryRunner as unknown as QueryRunnerClass,
  ): void {
    const prototype: QueryRunnerClass["prototype"] = queryRunnerClass.prototype;
    const original: WrappedQueryFunction = prototype.query;

    if (original[WRAPPED_QUERY]) {
      return;
    }

    const query: WrappedQueryFunction = function (
      this: PostgresQueryRunner,
      statement: string,
      parameters?: Array<unknown>,
      useStructuredResult?: boolean,
    ): Promise<unknown> {
      return traceDatabaseCall(
        () => {
          return describePostgresStatement(
            (this as unknown as { driver?: { options?: unknown } }).driver
              ?.options,
            statement,
          );
        },
        () => {
          return original.call(
            this,
            statement,
            parameters,
            useStructuredResult,
          );
        },
      );
    };

    query[WRAPPED_QUERY] = original;
    prototype.query = query;
  }

  public static isInstalled(
    queryRunnerClass: QueryRunnerClass = PostgresQueryRunner as unknown as QueryRunnerClass,
  ): boolean {
    return Boolean(queryRunnerClass.prototype.query[WRAPPED_QUERY]);
  }

  // Test seam: put back the query() install() wrapped.
  public static uninstall(
    queryRunnerClass: QueryRunnerClass = PostgresQueryRunner as unknown as QueryRunnerClass,
  ): void {
    const original: QueryFunction | undefined =
      queryRunnerClass.prototype.query[WRAPPED_QUERY];

    if (original) {
      queryRunnerClass.prototype.query = original;
    }
  }
}
