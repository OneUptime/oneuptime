import {
  ConnectionOptions,
  createConnection,
  Connection,
} from "mysql2/promise";
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
 * MySQL / MariaDB connector for external Data Sources.
 *
 * Read-only enforcement is layered:
 *  1. SqlQueryGuard.assertReadOnlyQuery rejects anything that is not a
 *     single read-only statement BEFORE a connection is opened;
 *  2. the driver runs with multipleStatements: false so stacked statements
 *     can never execute even if the classifier were bypassed;
 *  3. the user's query runs inside START TRANSACTION READ ONLY, so the
 *     server itself rejects writes regardless of the query text.
 */

/*
 * Minimal surface of a mysql2 promise connection the connector uses —
 * doubles as the DI seam so tests can substitute a scripted fake without
 * touching a real server. Result rows are element [0] of the query tuple.
 */
export interface MySqlConnectionLike {
  query(sql: string): Promise<[unknown, unknown]>;
  end(): Promise<void>;
  destroy(): void;
}

export type MySqlConnectionFactory = (
  options: ConnectionOptions,
) => Promise<MySqlConnectionLike>;

const defaultConnectionFactory: MySqlConnectionFactory = async (
  options: ConnectionOptions,
): Promise<MySqlConnectionLike> => {
  const connection: Connection = await createConnection(options);
  return {
    query: async (sql: string): Promise<[unknown, unknown]> => {
      const result: [unknown, unknown] = (await connection.query(sql)) as [
        unknown,
        unknown,
      ];
      return result;
    },
    end: (): Promise<void> => {
      return connection.end();
    },
    destroy: (): void => {
      connection.destroy();
    },
  };
};

export default class MySqlConnector implements DataSourceConnector {
  public dataSourceType: DataSourceType = DataSourceType.MySQL;

  private connectionFactory: MySqlConnectionFactory;

  public constructor(connectionFactory?: MySqlConnectionFactory) {
    this.connectionFactory = connectionFactory || defaultConnectionFactory;
  }

  public async testConnection(
    settings: DataSourceConnectionSettings,
  ): Promise<void> {
    const connection: MySqlConnectionLike = await this.connect(settings);
    try {
      await connection.query("SELECT 1");
    } catch (error) {
      throw new BadDataException(
        SqlResultShaper.sanitizeError(error, this.getSecrets(settings)),
      );
    } finally {
      await this.closeConnection(connection);
    }
  }

  public async queryTimeSeries(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
  ): Promise<AggregatedResult> {
    const rows: Array<Record<string, unknown>> = await this.runReadOnlyQuery(
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
    const rows: Array<Record<string, unknown>> = await this.runReadOnlyQuery(
      settings,
      query,
      window,
      DATA_SOURCE_MAX_TABLE_ROWS,
    );
    return SqlResultShaper.rowsToTable(rows, {
      maxRows: DATA_SOURCE_MAX_TABLE_ROWS,
    });
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

  private buildConnectionOptions(
    settings: DataSourceConnectionSettings,
  ): ConnectionOptions {
    const options: ConnectionOptions = {
      host: settings.databaseHost!,
      port: settings.databasePort ?? 3306,
      connectTimeout: DATA_SOURCE_CONNECT_TIMEOUT_IN_MS,
      /*
       * NEVER true: stacked statements ("SELECT 1; DROP TABLE x") must be
       * impossible at the driver level, as defense in depth beneath the
       * SqlQueryGuard classifier and the read-only transaction.
       */
      multipleStatements: false,
    };

    if (settings.databaseName !== undefined) {
      options.database = settings.databaseName;
    }
    if (settings.username !== undefined) {
      options.user = settings.username;
    }
    if (settings.password !== undefined) {
      options.password = settings.password;
    }

    if (settings.additionalOptions?.["sslEnabled"] === true) {
      /*
       * Certificate verification stays ON by default; only an explicit
       * sslRejectUnauthorized === false disables it.
       */
      options.ssl = {
        rejectUnauthorized:
          settings.additionalOptions?.["sslRejectUnauthorized"] !== false,
      };
    }

    return options;
  }

  /*
   * Egress-validate the host, then open a driver connection. Called only
   * after the query (when there is one) has already passed the read-only
   * guard, so a rejected query never even dials the server.
   */
  private async connect(
    settings: DataSourceConnectionSettings,
  ): Promise<MySqlConnectionLike> {
    if (!settings.databaseHost) {
      throw new BadDataException(
        "MySQL data source is missing a database host. Set the host in the data source settings.",
      );
    }

    /*
     * SSRF guard — must pass BEFORE any socket is opened towards the
     * configured host.
     */
    await DataSourceEgressGuard.assertHostnameAllowed(settings.databaseHost);

    const options: ConnectionOptions = this.buildConnectionOptions(settings);

    try {
      return await this.connectionFactory(options);
    } catch (error) {
      throw new BadDataException(
        SqlResultShaper.sanitizeError(error, this.getSecrets(settings)),
      );
    }
  }

  /*
   * Teardown: roll the read-only transaction back (harmless when none is
   * open), then close. Every step is guarded — a wedged server must not
   * turn cleanup into an unhandled rejection — with destroy() as the
   * hard fallback when a graceful end() fails.
   */
  private async closeConnection(
    connection: MySqlConnectionLike,
  ): Promise<void> {
    try {
      await connection.query("ROLLBACK");
    } catch {
      /* Best effort — the transaction may already be gone. */
    }

    try {
      await connection.end();
    } catch {
      try {
        connection.destroy();
      } catch {
        /* Best effort — the socket may already be gone. */
      }
    }
  }

  private async runReadOnlyQuery(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
    maxRows: number,
  ): Promise<Array<Record<string, unknown>>> {
    const withMacros: string = SqlQueryGuard.applyTimeMacros(
      query,
      window.startDate,
      window.endDate,
    );

    /*
     * The read-only classifier runs on the USER's query only. The session
     * SET statements issued below are our own fixed strings and never pass
     * through this guard — the guard's ban on the SET keyword applies to
     * user queries, not to the connector's session setup.
     */
    SqlQueryGuard.assertReadOnlyQuery(withMacros);

    /* Drop a trailing semicolon; the statement runs bare. */
    const finalSql: string = withMacros.replace(/;\s*$/, "");

    const connection: MySqlConnectionLike = await this.connect(settings);

    try {
      /*
       * Best-effort server-side statement timeout. MAX_EXECUTION_TIME
       * (milliseconds, SELECT-only) exists on MySQL 5.7.8+; MariaDB uses
       * max_statement_time in seconds instead, so this statement can fail
       * there — swallow the error and rely on the engine defaults rather
       * than failing the query.
       */
      try {
        await connection.query(
          `SET SESSION MAX_EXECUTION_TIME = ${DATA_SOURCE_QUERY_TIMEOUT_IN_MS}`,
        );
      } catch {
        /* Non-fatal — variable unknown on MariaDB and older MySQL. */
      }

      /*
       * Server-side row bound at cap+1 so the shaper can detect truncation.
       * An explicit LIMIT in the user's query takes precedence over
       * SQL_SELECT_LIMIT; the shaper's maxRows clamp is the authoritative
       * cap either way.
       */
      await connection.query(`SET SESSION SQL_SELECT_LIMIT = ${maxRows + 1}`);

      /*
       * Server-enforced read-only guarantee, independent of the query text
       * classifier.
       */
      await connection.query("START TRANSACTION READ ONLY");

      const result: [unknown, unknown] = await connection.query(finalSql);
      const rows: unknown = result[0];
      return Array.isArray(rows)
        ? (rows as Array<Record<string, unknown>>)
        : [];
    } catch (error) {
      if (error instanceof BadDataException) {
        throw error;
      }
      throw new BadDataException(
        SqlResultShaper.sanitizeError(error, this.getSecrets(settings)),
      );
    } finally {
      await this.closeConnection(connection);
    }
  }
}
