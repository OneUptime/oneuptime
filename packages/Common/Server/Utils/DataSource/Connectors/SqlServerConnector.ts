import * as mssql from "mssql";
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
 * Microsoft SQL Server / Azure SQL connector for external Data Sources.
 *
 * READ-ONLY ENFORCEMENT: unlike PostgreSQL and MySQL, SQL Server has NO
 * session-level read-only mode (there is no READ ONLY transaction the
 * server enforces), so the SqlQueryGuard classifier — written to be sound
 * for T-SQL specifically, including semicolon-less multi-statement batches
 * ("SELECT 1 DROP TABLE x") and sp_*\/xp_* procedures — IS the read-only
 * enforcement for this connector. Operators are strongly recommended to
 * additionally connect with a read-only login (e.g. db_datareader only).
 * As defense in depth every query still runs inside a transaction that is
 * ALWAYS rolled back, undoing anything that slipped through.
 *
 * Rows are capped server-side with SET ROWCOUNT at cap+1 (a separate batch
 * on the same session/transaction) so the shaper can detect truncation; it
 * also wins over a larger user-supplied TOP.
 */

/*
 * Minimal surface of the mssql (tedious) pool API the connector uses —
 * doubles as the DI seam so tests can substitute a scripted fake without a
 * real server. mssql's API is pool-based: requests hang off a transaction,
 * which hangs off the pool.
 */
export interface SqlServerRequestLike {
  batch(sql: string): Promise<unknown>;
  query(sql: string): Promise<{
    recordset?: Array<Record<string, unknown>> | undefined;
  }>;
}

export interface SqlServerTransactionLike {
  begin(): Promise<void>;
  rollback(): Promise<void>;
  request(): SqlServerRequestLike;
}

export interface SqlServerPoolLike {
  connect(): Promise<void>;
  close(): Promise<void>;
  transaction(): SqlServerTransactionLike;
}

export type SqlServerPoolFactory = (config: mssql.config) => SqlServerPoolLike;

/*
 * Default factory adapting the real mssql driver (default export = the
 * pure-JS tedious driver — never msnodesqlv8/ODBC) onto the seam above.
 * Each request() call returns a FRESH mssql.Request, so the SET ROWCOUNT
 * batch and the user's query run as separate requests on one transaction.
 */
const defaultPoolFactory: SqlServerPoolFactory = (
  config: mssql.config,
): SqlServerPoolLike => {
  const pool: mssql.ConnectionPool = new mssql.ConnectionPool(config);

  return {
    connect: async (): Promise<void> => {
      await pool.connect();
    },
    close: async (): Promise<void> => {
      await pool.close();
    },
    transaction: (): SqlServerTransactionLike => {
      const transaction: mssql.Transaction = new mssql.Transaction(pool);

      return {
        begin: async (): Promise<void> => {
          await transaction.begin();
        },
        rollback: async (): Promise<void> => {
          await transaction.rollback();
        },
        request: (): SqlServerRequestLike => {
          const request: mssql.Request = new mssql.Request(transaction);

          return {
            batch: (sql: string): Promise<unknown> => {
              return request.batch(sql);
            },
            query: async (
              sql: string,
            ): Promise<{
              recordset?: Array<Record<string, unknown>> | undefined;
            }> => {
              const result: mssql.IResult<Record<string, unknown>> =
                await request.query<Record<string, unknown>>(sql);
              return {
                recordset: result.recordset
                  ? Array.from(result.recordset)
                  : undefined,
              };
            },
          };
        },
      };
    },
  };
};

export default class SqlServerConnector implements DataSourceConnector {
  public dataSourceType: DataSourceType = DataSourceType.MicrosoftSqlServer;

  private poolFactory: SqlServerPoolFactory;

  public constructor(poolFactory?: SqlServerPoolFactory) {
    this.poolFactory = poolFactory || defaultPoolFactory;
  }

  public async testConnection(
    settings: DataSourceConnectionSettings,
  ): Promise<void> {
    /*
     * Cheap probe through the exact same guarded path a real query takes:
     * egress guard, connect, transaction, SELECT 1, rollback, close.
     */
    await this.executeReadOnlySql(settings, "SELECT 1", 1);
  }

  public async queryTimeSeries(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
  ): Promise<AggregatedResult> {
    const rows: Array<Record<string, unknown>> = await this.runGuardedQuery(
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
    const rows: Array<Record<string, unknown>> = await this.runGuardedQuery(
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

  private buildPoolConfig(
    settings: DataSourceConnectionSettings,
  ): mssql.config {
    const isSslEnabled: boolean =
      settings.additionalOptions?.["sslEnabled"] === true;

    /*
     * With TLS on, certificate verification stays ON unless the operator
     * explicitly opted out for a self-signed cert
     * (sslRejectUnauthorized === false → trust the server certificate).
     * With TLS off the flag is irrelevant; tedious still wants
     * trustServerCertificate true so it skips pointless verification.
     */
    const trustServerCertificate: boolean = isSslEnabled
      ? settings.additionalOptions?.["sslRejectUnauthorized"] === false
      : true;

    return {
      server: settings.databaseHost!,
      port: settings.databasePort ?? 1433,
      database: settings.databaseName,
      user: settings.username,
      password: settings.password,
      connectionTimeout: DATA_SOURCE_CONNECT_TIMEOUT_IN_MS,
      requestTimeout: DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
      pool: { max: 1, min: 0, idleTimeoutMillis: 30000 },
      options: {
        encrypt: isSslEnabled,
        trustServerCertificate: trustServerCertificate,
        appName: "OneUptime-DataSource",
      },
    };
  }

  /*
   * Apply the dashboard time macros, run the T-SQL-aware read-only
   * classifier (the enforcement layer for SQL Server — see header), then
   * execute. The classified text is EXACTLY the executed text: nothing is
   * appended or embedded, so there is no gap between what was checked and
   * what runs (SET ROWCOUNT goes out as its own connector-owned batch).
   */
  private async runGuardedQuery(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
    maxRows: number,
  ): Promise<Array<Record<string, unknown>>> {
    const finalSql: string = SqlQueryGuard.applyTimeMacros(
      query,
      window.startDate,
      window.endDate,
    );

    SqlQueryGuard.assertReadOnlyQuery(finalSql);

    return this.executeReadOnlySql(settings, finalSql, maxRows + 1);
  }

  /*
   * Egress-validate the host, connect a single-connection pool, and run
   * `sql` inside an always-rolled-back transaction with a server-side
   * SET ROWCOUNT row cap. Teardown (rollback, then close) always runs and
   * each step is individually guarded so a wedged server cannot turn
   * cleanup into an unhandled rejection.
   */
  private async executeReadOnlySql(
    settings: DataSourceConnectionSettings,
    sql: string,
    rowFetchLimit: number,
  ): Promise<Array<Record<string, unknown>>> {
    if (!settings.databaseHost) {
      throw new BadDataException(
        "Microsoft SQL Server data source is missing a database host. Set the host in the data source settings.",
      );
    }

    /*
     * SSRF guard — must pass BEFORE any socket is opened towards the
     * configured host.
     */
    await DataSourceEgressGuard.assertHostnameAllowed(settings.databaseHost);

    const pool: SqlServerPoolLike = this.poolFactory(
      this.buildPoolConfig(settings),
    );

    let transaction: SqlServerTransactionLike | undefined = undefined;
    let isTransactionBegun: boolean = false;

    try {
      await pool.connect();

      transaction = pool.transaction();
      await transaction.begin();
      isTransactionBegun = true;

      /*
       * Hard server-side row cap: SET ROWCOUNT stops the server after this
       * many rows (callers pass cap+1 so truncation stays detectable) and
       * wins over a larger user-supplied TOP. It is session-scoped, so it
       * applies to the user's query, which runs next on this connection.
       */
      await transaction.request().batch(`SET ROWCOUNT ${rowFetchLimit}`);

      const result: {
        recordset?: Array<Record<string, unknown>> | undefined;
      } = await transaction.request().query(sql);

      return result.recordset || [];
    } catch (error) {
      if (error instanceof BadDataException) {
        throw error;
      }
      throw new BadDataException(
        SqlResultShaper.sanitizeError(error, this.getSecrets(settings)),
      );
    } finally {
      if (transaction && isTransactionBegun) {
        try {
          await transaction.rollback();
        } catch {
          /*
           * Best effort — SQL Server rolls an abandoned transaction back
           * itself when the connection goes away.
           */
        }
      }

      try {
        await pool.close();
      } catch {
        /* Best effort — nothing more can be done with a wedged pool. */
      }
    }
  }
}
