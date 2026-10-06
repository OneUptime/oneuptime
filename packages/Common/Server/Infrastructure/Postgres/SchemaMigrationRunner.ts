import {
  PostgresMigrationLockRetryTimeoutMs,
  PostgresMigrationLockTimeoutMs,
} from "../../EnvironmentConfig";
import { scrubMigrationErrorText } from "../../Utils/Database/MigrationFailureLog";
import logger from "../../Utils/Logger";
import Sleep from "../../../Types/Sleep";
import {
  DataSource,
  DataSourceOptions,
  Migration,
  MigrationExecutor,
} from "typeorm";

/*
 * Applies the pending TypeORM schema migrations without letting one of them
 * queue ahead of the app's traffic.
 *
 * WHY
 *
 * DDL needs strong table locks: ALTER TABLE takes ACCESS EXCLUSIVE (and
 * dropping a foreign key takes it on the table the key REFERENCES too),
 * CREATE INDEX takes SHARE, adding a foreign key SHARE ROW EXCLUSIVE on both
 * tables. Postgres grants locks in queue order, so a DDL statement that has
 * to wait for one long transaction blocks every query that arrives on that
 * table after it - plain SELECTs included - until it gets its lock or gives
 * up. The migrate Job's statements used to have no lock_timeout at all (the
 * app pool's 3 s is deliberately not applied on the migration path), so such a
 * statement waited as long as the blocking transaction lived, bounded only by
 * statement_timeout, and every probe result, heartbeat and ingest lookup on
 * that table failed behind it. 14.0.13 asked for ACCESS EXCLUSIVE on
 * "Monitor", "Project", "User" and "Incident" that way.
 *
 * HOW
 *
 * Migrations run on a connection of their own whose lock_timeout is
 * DATABASE_MIGRATION_LOCK_TIMEOUT_MS (2 s), below the app's own 3 s, so an app
 * query queued behind a migration's lock request is delayed, never failed. It
 * is a STARTUP parameter, not a SET, so it is that session's default:
 * `SET lock_timeout = DEFAULT` in a migration (1798300000000 does that after
 * its index build) comes back to it instead of dropping the bound for every
 * migration after it. The app pool keeps its own settings - data migrations
 * run there, after this.
 *
 * A migration still runs in a transaction of its own
 * (migrationsTransactionMode "each"), so when one of its statements runs out
 * of lock_timeout (55P03), or Postgres breaks a deadlock by cancelling it
 * (40P01), the whole migration rolls back and releases every lock it took. The
 * runner then waits - backing off from one second to thirty, with jitter, so
 * the app gets the table back in between - and runs the pending migrations
 * again, from that one: the ones before it are committed and recorded. Each
 * migration may keep retrying for DATABASE_MIGRATION_LOCK_RETRY_TIMEOUT_MS (10
 * minutes); after that the run fails with SchemaMigrationLockTimeoutError, and
 * the log names the oldest open transactions - the usual culprits - with the
 * tables they hold.
 *
 * WHAT A MIGRATION MUST STILL DO ITSELF
 *
 * - A migration with `transaction = false` is not rolled back. It must be
 *   safe to run again from the start (OnlineDdl's helpers are).
 * - Bounding the WAIT does nothing for how long a lock is HELD. A migration
 *   holds every lock it took until it commits, so building an index or
 *   validating a foreign key on a table that already has rows blocks that
 *   table's writers for the whole scan. Do those online: OnlineDdl.createIndex
 *   and OnlineDdl.addForeignKey, in a migration with `transaction = false`
 *   (SchemaMigrationsOnlineDdl.test.ts holds new migrations to it).
 * - Each strong lock a migration takes is held while it waits for the next
 *   one, so a migration touching several busy tables blocks the first while
 *   it waits for the last. Keep migrations on busy tables small.
 */

export interface SchemaMigrationLockPolicy {
  /* lock_timeout of every migration statement. 0 = wait as long as it takes. */
  lockTimeoutInMs: number;
  /* How long one migration keeps being retried. 0 = never retried. */
  retryTimeoutInMs: number;
  /* The wait before the first retry; it doubles for every retry after. */
  firstRetryDelayInMs: number;
  /* The longest wait between two attempts. */
  maxRetryDelayInMs: number;
}

export const SCHEMA_MIGRATION_LOCK_POLICY: SchemaMigrationLockPolicy = {
  lockTimeoutInMs: PostgresMigrationLockTimeoutMs,
  retryTimeoutInMs: PostgresMigrationLockRetryTimeoutMs,
  firstRetryDelayInMs: 1000,
  maxRetryDelayInMs: 30 * 1000,
};

/*
 * The errors a later attempt can get past: lock_not_available (lock_timeout
 * ran out) and deadlock_detected (Postgres cancelled this side of a deadlock).
 */
export const LOCK_CONTENTION_ERROR_CODES: ReadonlyArray<string> = [
  "55P03",
  "40P01",
];

/* How many of the oldest open transactions a lock failure lists. */
const OPEN_TRANSACTIONS_LISTED: number = 5;

export class SchemaMigrationLockTimeoutError extends Error {
  public readonly migrationName: string;
  public readonly attempts: number;
  public readonly lastError: unknown;

  public constructor(data: {
    migrationName: string;
    attempts: number;
    waitedInMs: number;
    policy: SchemaMigrationLockPolicy;
    lastError: unknown;
  }) {
    super(
      `Schema migration ${data.migrationName} could not get its locks: ${data.attempts} attempt(s) over ${Math.round(
        data.waitedInMs / 1000,
      )} s, each waiting at most ${data.policy.lockTimeoutInMs} ms for a lock before rolling back (DATABASE_MIGRATION_LOCK_TIMEOUT_MS / DATABASE_MIGRATION_LOCK_RETRY_TIMEOUT_MS). Another transaction held a conflicting lock on a table it changes the whole time; the log lists the oldest open transactions. Last error: ${SchemaMigrationRunner.getErrorMessage(
        data.lastError,
      )}`,
    );
    this.name = "SchemaMigrationLockTimeoutError";
    this.migrationName = data.migrationName;
    this.attempts = data.attempts;
    this.lastError = data.lastError;
  }
}

interface OpenTransaction {
  pid: number;
  applicationName: string | null;
  backendType: string | null;
  state: string | null;
  transactionAgeInSeconds: number;
  waitEventType: string | null;
  tables: Array<string> | null;
  query: string | null;
}

interface WaitingMigration {
  name: string;
  since: number;
  attempts: number;
}

export default class SchemaMigrationRunner {
  /*
   * The options of the connection schema migrations run on: the app's own,
   * with the lock bound as a startup parameter (see above) and nothing run
   * by initialize() itself.
   */
  public static getDataSourceOptions(
    options: DataSourceOptions,
    policy: SchemaMigrationLockPolicy = SCHEMA_MIGRATION_LOCK_POLICY,
  ): DataSourceOptions {
    const extra: Record<string, unknown> = {
      ...((options as { extra?: Record<string, unknown> }).extra || {}),
    };

    delete extra["lock_timeout"];

    if (policy.lockTimeoutInMs > 0) {
      extra["lock_timeout"] = policy.lockTimeoutInMs;
    }

    return {
      ...options,
      migrationsRun: false,
      synchronize: false,
      extra,
    } as DataSourceOptions;
  }

  /*
   * Applies every pending migration of `options` on a connection of its own
   * (getDataSourceOptions), retrying a migration that cannot get its locks,
   * and closes that connection again.
   */
  public static async runPendingMigrations(
    options: DataSourceOptions,
    policy: SchemaMigrationLockPolicy = SCHEMA_MIGRATION_LOCK_POLICY,
  ): Promise<Array<string>> {
    const dataSource: DataSource = new DataSource(
      this.getDataSourceOptions(options, policy),
    );

    await dataSource.initialize();

    try {
      return await this.applyPendingMigrations(dataSource, policy);
    } finally {
      // A failure to close must not replace the migration's own outcome.
      await dataSource.destroy().catch((error: unknown) => {
        logger.warn(
          `Could not close the schema migration connection: ${this.getErrorMessage(
            error,
          )}`,
        );
      });
    }
  }

  /*
   * The retry loop over TypeORM's own runner, on an initialized DataSource.
   * Returns the names of the migrations it applied.
   */
  public static async applyPendingMigrations(
    dataSource: DataSource,
    policy: SchemaMigrationLockPolicy = SCHEMA_MIGRATION_LOCK_POLICY,
  ): Promise<Array<string>> {
    // null when it could not be read: the run goes ahead regardless.
    const pendingAtStart: Array<string> | null =
      await this.getPendingMigrationNames(dataSource);

    if (pendingAtStart && pendingAtStart.length === 0) {
      return [];
    }

    const startedAt: number = Date.now();

    logger.info(
      `Applying ${
        pendingAtStart
          ? `${pendingAtStart.length} pending schema migration(s), ${pendingAtStart[0]} first`
          : "the pending schema migrations"
      }. A statement waits ${
        policy.lockTimeoutInMs > 0
          ? `at most ${policy.lockTimeoutInMs} ms`
          : "without limit"
      } for a lock; a migration that runs out is rolled back and retried.`,
    );

    let waiting: WaitingMigration | null = null;
    let lastRun: Array<Migration> = [];

    for (;;) {
      try {
        lastRun = await dataSource.runMigrations({ transaction: "each" });
        break;
      } catch (error) {
        if (!this.isLockContentionError(error)) {
          throw error;
        }

        /*
         * TypeORM runs pending migrations in timestamp order and stops at
         * the first failure, so the first one still pending is the one that
         * was rolled back.
         */
        const name: string =
          (await this.getPendingMigrationNames(dataSource))?.[0] ||
          "(unknown migration)";
        const now: number = Date.now();

        if (!waiting || waiting.name !== name) {
          // A different migration: it gets a window of its own.
          waiting = { name: name, since: now, attempts: 0 };
        }

        waiting.attempts++;

        const delayInMs: number = this.getRetryDelayInMs(
          waiting.attempts,
          policy,
        );
        const waitedInMs: number = now - waiting.since;

        if (
          policy.retryTimeoutInMs <= 0 ||
          waitedInMs + delayInMs > policy.retryTimeoutInMs
        ) {
          await this.logOpenTransactions(dataSource, policy);
          throw new SchemaMigrationLockTimeoutError({
            migrationName: name,
            attempts: waiting.attempts,
            waitedInMs: waitedInMs,
            policy: policy,
            lastError: error,
          });
        }

        logger.warn(
          `Schema migration ${name} rolled back: ${this.getErrorMessage(
            error,
          )} (${this.getStatementHead(error)}). Another transaction holds a lock it needs; retrying in ${delayInMs} ms (attempt ${
            waiting.attempts + 1
          }). App queries on the table are not held up meanwhile.`,
        );

        if (waiting.attempts === 1) {
          await this.logOpenTransactions(dataSource, policy);
        }

        await Sleep.sleep(delayInMs);
      }
    }

    const pendingAtEnd: Array<string> | null =
      await this.getPendingMigrationNames(dataSource);
    const applied: Array<string> =
      pendingAtStart && pendingAtEnd
        ? pendingAtStart.filter((name: string): boolean => {
            return !pendingAtEnd.includes(name);
          })
        : lastRun.map((migration: Migration): string => {
            return migration.name;
          });

    logger.info(
      `Applied ${applied.length} schema migration(s) in ${Math.round(
        (Date.now() - startedAt) / 1000,
      )} s.`,
    );

    return applied;
  }

  public static isLockContentionError(error: unknown): boolean {
    const codes: Array<unknown> = [
      (error as { code?: unknown } | null)?.code,
      (error as { driverError?: { code?: unknown } } | null)?.driverError?.code,
    ];

    return codes.some((code: unknown): boolean => {
      return (
        typeof code === "string" && LOCK_CONTENTION_ERROR_CODES.includes(code)
      );
    });
  }

  /*
   * Exponential from firstRetryDelayInMs, capped at maxRetryDelayInMs, then
   * spread +-25% so concurrent runners (docker compose boots app and worker
   * together) do not retry in step.
   */
  public static getRetryDelayInMs(
    attempt: number,
    policy: SchemaMigrationLockPolicy = SCHEMA_MIGRATION_LOCK_POLICY,
  ): number {
    const base: number = Math.min(
      policy.maxRetryDelayInMs,
      policy.firstRetryDelayInMs * Math.pow(2, Math.max(0, attempt - 1)),
    );

    return Math.round(base * (0.75 + Math.random() * 0.5));
  }

  public static getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /* TypeORM puts the failed statement on its QueryFailedError. */
  private static getStatementHead(error: unknown): string {
    const query: unknown = (error as { query?: unknown } | null)?.query;

    if (typeof query !== "string" || !query.trim()) {
      return "statement unknown";
    }

    const head: string = query.replace(/\s+/g, " ").trim();

    return head.length > 160 ? `${head.substring(0, 160)}...` : head;
  }

  /*
   * The migrations still to run, in the order TypeORM runs them (by
   * timestamp); null when they could not be read.
   */
  public static async getPendingMigrationNames(
    dataSource: DataSource,
  ): Promise<Array<string> | null> {
    try {
      const pending: Array<Migration> = await new MigrationExecutor(
        dataSource,
      ).getPendingMigrations();

      return pending.map((migration: Migration): string => {
        return migration.name;
      });
    } catch (error) {
      logger.warn(
        `Could not list the pending schema migrations: ${this.getErrorMessage(
          error,
        )}`,
      );
      return null;
    }
  }

  /*
   * The transactions open longest in this database, with the tables they
   * hold locks on: whatever the migration waited for is almost always among
   * them (a report, a backup, a session left idle in a transaction, an
   * anti-wraparound vacuum). Best-effort: a failure here never hides the
   * migration's own error.
   */
  private static async logOpenTransactions(
    dataSource: DataSource,
    policy: SchemaMigrationLockPolicy,
  ): Promise<void> {
    try {
      const transactions: Array<OpenTransaction> = await dataSource.query(
        `SELECT a.pid,
                a.application_name AS "applicationName",
                a.backend_type AS "backendType",
                a.state,
                floor(extract(epoch FROM now() - a.xact_start))::int AS "transactionAgeInSeconds",
                a.wait_event_type AS "waitEventType",
                ARRAY(SELECT DISTINCT c.relname::text
                        FROM pg_locks l
                        JOIN pg_class c ON c.oid = l.relation
                       WHERE l.pid = a.pid AND l.granted
                         AND l.locktype = 'relation'
                         AND c.relkind IN ('r', 'p')
                       ORDER BY 1 LIMIT 10) AS "tables",
                left(a.query, 160) AS "query"
           FROM pg_stat_activity a
          WHERE a.datname = current_database()
            AND a.pid <> pg_backend_pid()
            AND a.xact_start IS NOT NULL
            AND a.xact_start < now() - make_interval(secs => $1)
          ORDER BY a.xact_start
          LIMIT ${OPEN_TRANSACTIONS_LISTED}`,
        // Whatever held the lock was open for at least the lock wait.
        [policy.lockTimeoutInMs / 1000],
      );

      if (transactions.length === 0) {
        logger.warn(
          "No transaction in this database has been open for longer than a migration lock wait; the locks were held by a stream of shorter ones.",
        );
        return;
      }

      for (const transaction of transactions) {
        logger.warn(
          `Open transaction: pid ${transaction.pid}, ${
            transaction.backendType || "backend"
          }${
            transaction.applicationName
              ? ` "${transaction.applicationName}"`
              : ""
          }, ${transaction.state || "unknown state"}${
            transaction.waitEventType
              ? ` (waiting on ${transaction.waitEventType})`
              : ""
          }, open for ${transaction.transactionAgeInSeconds} s, holding locks on ${
            transaction.tables && transaction.tables.length > 0
              ? transaction.tables.join(", ")
              : "no table"
          }; last statement: ${scrubMigrationErrorText(
            (transaction.query || "").replace(/\s+/g, " ").trim(),
          )}`,
        );
      }
    } catch (error) {
      logger.warn(
        `Could not list the open transactions: ${this.getErrorMessage(error)}`,
      );
    }
  }
}
