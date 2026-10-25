import { Client, ClientConfig } from "pg";
import {
  DatabaseHost,
  DatabaseName,
  DatabasePassword,
  DatabasePort,
  DatabaseRejectUnauthorized,
  DatabaseSslCa,
  DatabaseSslCert,
  DatabaseSslKey,
  DatabaseUsername,
  ShouldDatabaseSslEnable,
} from "../../EnvironmentConfig";

/*
 * One connection of its own to OneUptime's PostgreSQL server, outside the
 * app's pool - to a database the pool does not use, or for statements the
 * pool must not run: what the Enterprise Edition's backups ask before a
 * dump (the server's version, the database's size and encoding, whether
 * the user may create databases), and what a restore does on the server's
 * maintenance database (create the database it restores into, then switch
 * the two over by renaming them, which no connection to either may watch).
 *
 * The same host, port, user, password and TLS settings as the app's pool
 * (DATABASE_*), so it reaches exactly the server the app does. It is never
 * pooled: every use opens one connection and closes it.
 */

export interface PostgresConnectionTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?:
    | {
        rejectUnauthorized: boolean;
        ca?: string | undefined;
        key?: string | undefined;
        cert?: string | undefined;
      }
    | undefined;
}

export type PostgresRow = Record<string, unknown>;

export interface PostgresAdminClient {
  query: (sql: string, params?: Array<unknown>) => Promise<Array<PostgresRow>>;
}

// How long a connection may take to open before it counts as failed.
const CONNECT_TIMEOUT_IN_MS: number = 30 * 1000;

export default class PostgresAdminConnection {
  // The app's own server, user and TLS, on `database` (the app's database by default).
  public static getAppTarget(database?: string): PostgresConnectionTarget {
    return {
      host: DatabaseHost.toString(),
      port: DatabasePort.toNumber(),
      user: DatabaseUsername,
      password: DatabasePassword,
      database: database || DatabaseName,
      ...(ShouldDatabaseSslEnable
        ? {
            ssl: {
              rejectUnauthorized: DatabaseRejectUnauthorized,
              ca: DatabaseSslCa,
              key: DatabaseSslKey,
              cert: DatabaseSslCert,
            },
          }
        : {}),
    };
  }

  // The same server and user, on another database.
  public static onDatabase(
    target: PostgresConnectionTarget,
    database: string,
  ): PostgresConnectionTarget {
    return { ...target, database };
  }

  /*
   * Opens one connection, hands it to `run`, and closes it whatever `run`
   * does. Parameters ($1, $2...) are passed separately, never spliced into
   * the statement.
   */
  public static async withClient<T>(
    target: PostgresConnectionTarget,
    run: (client: PostgresAdminClient) => Promise<T>,
  ): Promise<T> {
    const config: ClientConfig = {
      host: target.host,
      port: target.port,
      user: target.user,
      password: target.password,
      database: target.database,
      application_name: "oneuptime-backup",
      connectionTimeoutMillis: CONNECT_TIMEOUT_IN_MS,
      ...(target.ssl ? { ssl: target.ssl } : {}),
    };

    const client: Client = new Client(config);

    // A connection the server drops while idle must not crash the process.
    client.on("error", () => {
      // Surfaces on the next query, which fails.
    });

    await client.connect();

    try {
      return await run({
        query: async (
          sql: string,
          params?: Array<unknown>,
        ): Promise<Array<PostgresRow>> => {
          const result: { rows: Array<PostgresRow> } = await client.query(
            sql,
            params as Array<unknown> | undefined,
          );

          return result.rows;
        },
      });
    } finally {
      await client.end().catch(() => {
        // Already closed.
      });
    }
  }

  // A PostgreSQL identifier, double-quoted: a database's name in a statement.
  public static quoteIdentifier(name: string): string {
    return `"${name.split('"').join('""')}"`;
  }
}
