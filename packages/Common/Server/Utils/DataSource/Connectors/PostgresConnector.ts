import { Client, ClientConfig } from "pg";
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
  DataSourceConnector,
  DataSourceConnectionSettings,
  DataSourceQueryWindow,
} from "../Types";

/*
 * PostgreSQL Data Source connector.
 *
 * Read-only enforcement is layered: the SqlQueryGuard classifier rejects
 * anything that is not a single read-only statement BEFORE a connection is
 * opened, and the query then runs inside a server-enforced READ ONLY
 * transaction (which also blocks writable CTEs the classifier cannot see).
 * Rows are capped server-side with a NO SCROLL cursor + bounded FETCH so an
 * unbounded query never materializes on the OneUptime API server — the same
 * technique the probe's SqlMonitor uses.
 */

/*
 * Structural subset of pg's Client used by this connector. The constructor
 * accepts a factory producing this shape so tests can inject a fake client
 * and record every statement without touching a real database.
 */
export interface PgClientLike {
  connect(): Promise<void>;
  query(text: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}

export type PgClientFactory = (config: ClientConfig) => PgClientLike;

const CURSOR_NAME: string = "oneuptime_data_source_cursor";

export default class PostgresConnector implements DataSourceConnector {
  public dataSourceType: DataSourceType = DataSourceType.PostgreSQL;

  private clientFactory: PgClientFactory;

  public constructor(clientFactory?: PgClientFactory) {
    this.clientFactory =
      clientFactory ||
      ((config: ClientConfig): PgClientLike => {
        /*
         * Wrap the driver client: pg's Client.connect() resolves with the
         * Client instance, but the seam promises void — adapt instead of
         * widening the interface every fake must implement.
         */
        const client: Client = new Client(config);
        return {
          connect: async (): Promise<void> => {
            await client.connect();
          },
          query: (
            text: string,
          ): Promise<{ rows: Array<Record<string, unknown>> }> => {
            return client.query(text);
          },
          end: (): Promise<void> => {
            return client.end();
          },
        };
      });
  }

  public async testConnection(
    settings: DataSourceConnectionSettings,
  ): Promise<void> {
    await this.assertEgressAllowed(settings);

    const client: PgClientLike = this.clientFactory(
      this.buildClientConfig(settings),
    );

    try {
      await client.connect();
      await client.query("SELECT 1");
    } catch (error) {
      throw this.toBadDataException(error, settings);
    } finally {
      try {
        await client.end();
      } catch {
        // Best effort — the socket may never have opened.
      }
    }
  }

  public async queryTimeSeries(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
  ): Promise<AggregatedResult> {
    const rows: Array<Record<string, unknown>> = await this.fetchRows(
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
    const rows: Array<Record<string, unknown>> = await this.fetchRows(
      settings,
      query,
      window,
      DATA_SOURCE_MAX_TABLE_ROWS,
    );

    return SqlResultShaper.rowsToTable(rows, {
      maxRows: DATA_SOURCE_MAX_TABLE_ROWS,
    });
  }

  /*
   * Validate the target host through the SSRF egress guard. MUST run before
   * any connection is opened (test and query alike).
   */
  private async assertEgressAllowed(
    settings: DataSourceConnectionSettings,
  ): Promise<void> {
    if (!settings.databaseHost) {
      throw new BadDataException(
        "Database host is required for a PostgreSQL data source.",
      );
    }

    await DataSourceEgressGuard.assertHostnameAllowed(settings.databaseHost);
  }

  private buildClientConfig(
    settings: DataSourceConnectionSettings,
  ): ClientConfig {
    const sslEnabled: boolean =
      settings.additionalOptions?.["sslEnabled"] === true;
    const sslRejectUnauthorized: boolean =
      settings.additionalOptions?.["sslRejectUnauthorized"] !== false;

    return {
      host: settings.databaseHost,
      port: settings.databasePort ?? 5432,
      database: settings.databaseName ?? "postgres",
      user: settings.username,
      password: settings.password,
      connectionTimeoutMillis: DATA_SOURCE_CONNECT_TIMEOUT_IN_MS,
      // Server-side per-statement cap (primary timeout control).
      statement_timeout: DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
      // Client-side backstop in case the server ignores statement_timeout.
      query_timeout: DATA_SOURCE_QUERY_TIMEOUT_IN_MS + 2000,
      application_name: "OneUptime-DataSource",
      ssl: sslEnabled ? { rejectUnauthorized: sslRejectUnauthorized } : false,
    };
  }

  private toBadDataException(
    error: unknown,
    settings: DataSourceConnectionSettings,
  ): BadDataException {
    if (error instanceof BadDataException) {
      return error;
    }

    return new BadDataException(
      SqlResultShaper.sanitizeError(error, [
        settings.password,
        settings.apiToken,
        settings.databaseHost,
        settings.username,
      ]),
    );
  }

  /*
   * Open a connection, run the (macro-expanded, read-only-verified) query
   * inside a READ ONLY transaction and read at most maxRows+1 rows through a
   * server-side cursor — the +1 lets the shaper detect truncation. The
   * transaction is always rolled back and the connection always closed.
   */
  private async fetchRows(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
    maxRows: number,
  ): Promise<Array<Record<string, unknown>>> {
    await this.assertEgressAllowed(settings);

    const finalSql: string = SqlQueryGuard.applyTimeMacros(
      query,
      window.startDate,
      window.endDate,
    );
    SqlQueryGuard.assertReadOnlyQuery(finalSql);

    // Strip trailing terminators so the SQL embeds in DECLARE ... CURSOR.
    const cursorSql: string = finalSql.replace(/;+\s*$/g, "").trim();

    const client: PgClientLike = this.clientFactory(
      this.buildClientConfig(settings),
    );

    try {
      await client.connect();

      /*
       * Server-enforced read-only guarantee: a READ ONLY transaction blocks
       * all writes — including writable CTEs — regardless of the query text.
       */
      await client.query("START TRANSACTION READ ONLY");
      await client.query(
        `SET LOCAL statement_timeout = ${Math.floor(
          DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
        )}`,
      );

      await client.query(
        `DECLARE ${CURSOR_NAME} NO SCROLL CURSOR FOR ${cursorSql}`,
      );

      const result: { rows: Array<Record<string, unknown>> } =
        await client.query(`FETCH FORWARD ${maxRows + 1} FROM ${CURSOR_NAME}`);

      return result.rows || [];
    } catch (error) {
      throw this.toBadDataException(error, settings);
    } finally {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Best effort — the transaction may never have started.
      }

      try {
        await client.end();
      } catch {
        // Best effort — the socket may already be gone.
      }
    }
  }
}
