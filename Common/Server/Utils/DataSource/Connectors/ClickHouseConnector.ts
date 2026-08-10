import https from "https";
import { ClickHouseClient, createClient } from "@clickhouse/client";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import {
  DATA_SOURCE_CONNECT_TIMEOUT_IN_MS,
  DATA_SOURCE_MAX_TABLE_ROWS,
  DATA_SOURCE_MAX_TIME_SERIES_ROWS,
  DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
} from "../../../../Types/DataSource/DataSourceLimits";
import DataSourceTableResult from "../../../../Types/DataSource/DataSourceTableResult";
import DataSourceType from "../../../../Types/DataSource/DataSourceType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import DataSourceEgressGuard from "../EgressGuard";
import SqlQueryGuard from "../SqlQueryGuard";
import SqlResultShaper from "../SqlResultShaper";
import {
  DataSourceConnectionSettings,
  DataSourceConnector,
  DataSourceQueryWindow,
} from "../Types";

/*
 * ClickHouse Data Source connector.
 *
 * Talks to ClickHouse over its HTTP interface via @clickhouse/client. Safety
 * layers, in order:
 *  - DataSourceEgressGuard validates the host BEFORE any socket is opened;
 *  - SqlQueryGuard rejects anything that is not a single read-only statement;
 *  - every query runs with the server-enforced `readonly: 1` session setting,
 *    `max_execution_time` and a `max_result_rows` cap (fetched as cap+1 so
 *    truncation is detectable by the shared shaper).
 */

/*
 * The exact client configuration this connector builds. Structurally a subset
 * of @clickhouse/client's NodeClickHouseClientConfigOptions, declared here so
 * tests can assert on it without importing driver internals.
 */
export interface ClickHouseClientConfig {
  url: string;
  username: string;
  password: string;
  database?: string;
  application: string;
  request_timeout: number;
  max_open_connections: number;
  compression: {
    request: boolean;
    response: boolean;
  };
  http_agent?: https.Agent;
}

/*
 * Narrow view of the ClickHouse client — exactly the three calls this
 * connector makes. `json<T>()` is typed as "the caller declares the whole
 * response shape", which is what the real ResultSet returns at runtime for
 * format "JSON".
 */
export interface ClickHouseClientLike {
  query(params: {
    query: string;
    format: "JSON";
    clickhouse_settings?: Record<string, unknown>;
  }): Promise<{ json<T>(): Promise<T> }>;
  ping(): Promise<{ success: boolean }>;
  close(): Promise<void>;
}

// DI seam so tests can hand in a fake client instead of a real driver.
export type ClickHouseClientFactory = (
  config: ClickHouseClientConfig,
) => ClickHouseClientLike;

/*
 * Shape of a ClickHouse HTTP JSON response — the rows live under `data`
 * (alongside `meta`, `rows`, `statistics`, which this connector ignores).
 */
export interface ClickHouseJsonResponse {
  data?: Array<Record<string, unknown>>;
}

const defaultClientFactory: ClickHouseClientFactory = (
  config: ClickHouseClientConfig,
): ClickHouseClientLike => {
  const client: ClickHouseClient = createClient(config);
  /*
   * The real ResultSet types json<T>() as Promise<ResponseJSON<T>> while the
   * seam narrows it to Promise<T> (callers pass the full response type as T).
   * The runtime object satisfies the seam; only the generic bookkeeping
   * differs, hence the cast.
   */
  return client as unknown as ClickHouseClientLike;
};

export default class ClickHouseConnector implements DataSourceConnector {
  public dataSourceType: DataSourceType = DataSourceType.ClickHouse;

  private clientFactory: ClickHouseClientFactory;

  public constructor(clientFactory?: ClickHouseClientFactory | undefined) {
    this.clientFactory = clientFactory || defaultClientFactory;
  }

  public async testConnection(
    settings: DataSourceConnectionSettings,
  ): Promise<void> {
    this.assertDatabaseHost(settings);

    // SSRF gate: validate the resolved target before any socket is opened.
    await DataSourceEgressGuard.assertHostnameAllowed(settings.databaseHost!);

    /*
     * Connection tests get the (shorter) connect timeout — a ping does no
     * server-side work, so there is no execution time to wait out.
     */
    const client: ClickHouseClientLike = this.clientFactory(
      this.buildClientConfig(settings, DATA_SOURCE_CONNECT_TIMEOUT_IN_MS),
    );

    try {
      let pingResult: { success: boolean };
      try {
        pingResult = await client.ping();
      } catch (error) {
        throw new BadDataException(
          SqlResultShaper.sanitizeError(error, this.getSecrets(settings)),
        );
      }

      if (!pingResult.success) {
        throw new BadDataException(
          "Could not connect to ClickHouse: ping failed. Check the database host, port, credentials and TLS settings.",
        );
      }
    } finally {
      await this.closeQuietly(client);
    }
  }

  public async queryTimeSeries(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
  ): Promise<AggregatedResult> {
    const rows: Array<Record<string, unknown>> = await this.runQuery(
      settings,
      query,
      window,
      DATA_SOURCE_MAX_TIME_SERIES_ROWS,
    );

    return SqlResultShaper.rowsToTimeSeries(rows, {
      maxRows: DATA_SOURCE_MAX_TIME_SERIES_ROWS,
    });
  }

  public async queryTable(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
  ): Promise<DataSourceTableResult> {
    const rows: Array<Record<string, unknown>> = await this.runQuery(
      settings,
      query,
      window,
      DATA_SOURCE_MAX_TABLE_ROWS,
    );

    return SqlResultShaper.rowsToTable(rows, {
      maxRows: DATA_SOURCE_MAX_TABLE_ROWS,
    });
  }

  private assertDatabaseHost(settings: DataSourceConnectionSettings): void {
    if (!settings.databaseHost) {
      throw new BadDataException(
        "Database host is required for a ClickHouse data source.",
      );
    }
  }

  private getSecrets(
    settings: DataSourceConnectionSettings,
  ): Array<string | undefined> {
    return [
      settings.password,
      settings.apiToken,
      settings.databaseHost,
      settings.username,
    ];
  }

  private buildClientConfig(
    settings: DataSourceConnectionSettings,
    requestTimeoutInMs: number,
  ): ClickHouseClientConfig {
    const sslEnabled: boolean =
      settings.additionalOptions?.["sslEnabled"] === true;
    const rejectUnauthorized: boolean =
      settings.additionalOptions?.["sslRejectUnauthorized"] !== false;

    const scheme: string = sslEnabled ? "https" : "http";
    const port: number = settings.databasePort ?? 8123;

    const config: ClickHouseClientConfig = {
      url: `${scheme}://${settings.databaseHost}:${port}`,
      username: settings.username ?? "default",
      password: settings.password ?? "",
      application: "oneuptime-datasource",
      /*
       * request_timeout is an IDLE-SOCKET timer in @clickhouse/client, not a
       * wall-clock bound on the query: it only fires when the socket goes
       * silent. The real execution bound is the server-side
       * max_execution_time query setting; query callers pass the query
       * timeout + 5s of padding so the server limit fires first, and
       * testConnection passes the connect timeout.
       */
      request_timeout: requestTimeoutInMs,
      max_open_connections: 1,
      /*
       * REQUIRED off, both directions: enabling response compression makes
       * the client send enable_http_compression=1 as a query-level setting,
       * and a readonly=1 session REJECTS changing that setting — every query
       * this connector runs would fail with "Cannot modify
       * 'enable_http_compression' setting in readonly mode".
       */
      compression: {
        request: false,
        response: false,
      },
    };

    if (settings.databaseName) {
      config.database = settings.databaseName;
    }

    if (sslEnabled && !rejectUnauthorized) {
      /*
       * A custom agent is the only way @clickhouse/client can skip TLS
       * certificate verification. The custom agent takes over connection
       * pooling (max_open_connections is ignored when http_agent is set), so
       * the single-connection cap is mirrored here via maxSockets.
       */
      config.http_agent = new https.Agent({
        rejectUnauthorized: false,
        maxSockets: 1,
      });
    }

    return config;
  }

  private async runQuery(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
    maxRows: number,
  ): Promise<Array<Record<string, unknown>>> {
    this.assertDatabaseHost(settings);

    // SSRF gate: validate the resolved target before any socket is opened.
    await DataSourceEgressGuard.assertHostnameAllowed(settings.databaseHost!);

    const finalSql: string = SqlQueryGuard.applyTimeMacros(
      query,
      window.startDate,
      window.endDate,
    );
    SqlQueryGuard.assertReadOnlyQuery(finalSql);

    /*
     * The client appends "FORMAT JSON" to the statement; a trailing
     * semicolon would produce "... ; FORMAT JSON", a syntax error. Nothing
     * else about the statement is rewritten.
     */
    const executedSql: string = finalSql.replace(/;\s*$/, "");

    const client: ClickHouseClientLike = this.clientFactory(
      this.buildClientConfig(settings, DATA_SOURCE_QUERY_TIMEOUT_IN_MS + 5000),
    );

    try {
      const result: { json<T>(): Promise<T> } = await client.query({
        query: executedSql,
        format: "JSON",
        clickhouse_settings: {
          /*
           * Server-enforced read-only session — second layer behind
           * SqlQueryGuard's classifier.
           */
          readonly: 1,
          // Wall-clock bound, enforced by the server (seconds).
          max_execution_time: Math.ceil(DATA_SOURCE_QUERY_TIMEOUT_IN_MS / 1000),
          /*
           * cap+1 with "break" (stop, don't error) so the shaper can tell
           * "exactly cap rows" apart from "more than cap" and set truncated.
           */
          max_result_rows: maxRows + 1,
          result_overflow_mode: "break",
        },
      });

      const response: ClickHouseJsonResponse | null =
        await result.json<ClickHouseJsonResponse | null>();

      if (!response || !Array.isArray(response.data)) {
        throw new BadDataException(
          "ClickHouse returned an unexpected response shape (missing data array). Ensure the query is a single SELECT statement.",
        );
      }

      return response.data.filter((row: Record<string, unknown>) => {
        return row !== null && typeof row === "object" && !Array.isArray(row);
      });
    } catch (error) {
      if (error instanceof BadDataException) {
        throw error;
      }
      throw new BadDataException(
        SqlResultShaper.sanitizeError(error, this.getSecrets(settings)),
      );
    } finally {
      await this.closeQuietly(client);
    }
  }

  private async closeQuietly(client: ClickHouseClientLike): Promise<void> {
    try {
      await client.close();
    } catch {
      /*
       * Best-effort close — the query result (or its error) already decided
       * this call's outcome.
       */
    }
  }
}
