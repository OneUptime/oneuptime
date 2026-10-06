import { PostgresMigrationWaitTimeoutMs } from "../../EnvironmentConfig";
import logger from "../../Utils/Logger";
import Sleep from "../../../Types/Sleep";
import { DataSource, Migration, MigrationExecutor } from "typeorm";

/*
 * Keeps a process that does not apply the schema migrations itself from
 * starting on a schema older than its code.
 *
 * WHY
 *
 * In the Helm chart a migrate Job applies the migrations and the runtime pods
 * never do (RUN_DATABASE_MIGRATIONS_ON_BOOT=false). The Job runs
 * asynchronously by default (migrate.hook=false), so the new pods of a
 * release start while it is still migrating, and nothing kept them from
 * serving on the old schema. In the 14.0.11 -> 14.0.13 upgrade the new worker
 * pods read Monitor."isArchived" (MonitorService.getEnabledMonitorQuery(),
 * the probe claim's raw SQL, MONITOR_PAUSE_FLAGS_SELECT) before
 * AddArchiveToMoreResources had committed it. Every such query failed with
 * `column m.isArchived does not exist`, and once those pods had replaced the
 * old ones no monitor was processed until the migration committed.
 *
 * HOW
 *
 * PostgresDatabase.connect() calls this in a process that does not run the
 * migrations, once its pool is up and before it hands the pool out. It reads
 * which migrations this code knows that the database has not recorded and,
 * while any is pending, reads again every five seconds. A migration counts
 * once the transaction that recorded it commits, which is when its schema
 * change becomes visible. Until then connect() has not returned, so the
 * process has not started: its HTTP server is not listening, the pod is not
 * ready, and the old pods keep serving. Migrations the database has and this
 * code does not know (after a rollback to an older release) do not matter.
 *
 * The list is TypeORM's own (MigrationExecutor.getPendingMigrations), which
 * only reads: it looks the migrations table up and selects from it.
 * DataSource.showMigrations() answers the same question but creates that
 * table when it does not exist yet - on a new install, a CREATE TABLE from
 * every waiting pod, racing the migrate Job's own (TypeORM checks for the
 * table, then creates it) - and it answers only yes or no, where the log has
 * to say which migrations are missing.
 *
 * BOUNDED
 *
 * It waits at most DATABASE_MIGRATION_WAIT_TIMEOUT_MS (15 minutes, inside the
 * chart's 17-minute startup probe window), then throws
 * SchemaMigrationWaitTimeoutError: the process exits, is restarted, and waits
 * again. It never starts on the older schema. 0 does not wait: it logs what
 * is missing and returns at once, as connect() did before.
 *
 * NOT COVERED
 *
 * - Data migrations (Workers/DataMigrations). The Job runs them after the
 *   schema migrations and they can be long backfills, so code must work on
 *   data they have not reached yet.
 * - The ClickHouse schema, which the Job also syncs.
 */

export interface SchemaMigrationWaitPolicy {
  /* How long to wait for the pending migrations. 0 = do not wait. */
  timeoutInMs: number;
  /* The pause between two reads of the pending migrations. */
  pollIntervalInMs: number;
  /* How often a wait that goes on is logged again. */
  logIntervalInMs: number;
}

export const SCHEMA_MIGRATION_WAIT_POLICY: SchemaMigrationWaitPolicy = {
  timeoutInMs: PostgresMigrationWaitTimeoutMs,
  pollIntervalInMs: 5 * 1000,
  logIntervalInMs: 60 * 1000,
};

/* How many pending migrations a log line or an error names. */
const MIGRATIONS_NAMED: number = 5;

export class SchemaMigrationWaitTimeoutError extends Error {
  /* Still pending at the last read that worked; null if none did. */
  public readonly pendingMigrationNames: Array<string> | null;
  public readonly waitedInMs: number;
  /* Why the last read failed; null if it did not. */
  public readonly lastError: unknown;

  public constructor(data: {
    pendingMigrationNames: Array<string> | null;
    waitedInMs: number;
    lastError: unknown;
  }) {
    const waited: string = `${Math.round(data.waitedInMs / 1000)} s`;
    const lastError: string = data.lastError
      ? ` The last read failed: ${SchemaMigrationWait.getErrorMessage(
          data.lastError,
        )}.`
      : "";

    super(
      `${
        data.pendingMigrationNames
          ? `Gave up after ${waited} waiting for ${
              data.pendingMigrationNames.length
            } schema migration(s) to be applied: ${SchemaMigrationWait.describeMigrations(
              data.pendingMigrationNames,
            )}.`
          : `Gave up after ${waited} waiting for the schema migrations to be applied: could not read which ones are.`
      }${lastError} This process does not apply schema migrations (RUN_DATABASE_MIGRATIONS_ON_BOOT=false), and it does not start on a schema older than its code. Whatever applies them - in the Helm chart, the migrate Job - has not finished: check its log. DATABASE_MIGRATION_WAIT_TIMEOUT_MS sets how long this waits (0: start without waiting).`,
    );
    this.name = "SchemaMigrationWaitTimeoutError";
    this.pendingMigrationNames = data.pendingMigrationNames;
    this.waitedInMs = data.waitedInMs;
    this.lastError = data.lastError;
  }
}

export default class SchemaMigrationWait {
  /*
   * Returns once every schema migration of `dataSource` is applied - at once
   * when they already are, the usual case - or right away when
   * policy.timeoutInMs is 0. Throws SchemaMigrationWaitTimeoutError when they
   * are not applied by the end of policy.timeoutInMs. A read that fails is
   * tried again, like a pending migration.
   */
  public static async waitForPendingMigrations(
    dataSource: DataSource,
    policy: SchemaMigrationWaitPolicy = SCHEMA_MIGRATION_WAIT_POLICY,
  ): Promise<void> {
    const startedAt: number = Date.now();
    let pending: Array<string> | null = null;
    let lastError: unknown = null;
    let loggedAt: number | null = null;
    let explained: boolean = false;

    for (;;) {
      try {
        pending = await this.getPendingMigrationNames(dataSource);
        lastError = null;
      } catch (error) {
        lastError = error;
      }

      const now: number = Date.now();
      const waitedInMs: number = now - startedAt;

      if (!lastError && pending && pending.length === 0) {
        if (loggedAt !== null) {
          logger.info(
            `The schema migrations this code needs are applied, after ${Math.round(
              waitedInMs / 1000,
            )} s of waiting; continuing to start.`,
          );
        }
        return;
      }

      if (policy.timeoutInMs <= 0) {
        logger.warn(
          `${
            lastError
              ? `Could not read which schema migrations are applied: ${this.getErrorMessage(
                  lastError,
                )}.`
              : `${pending!.length} schema migration(s) this code needs are not applied: ${this.describeMigrations(
                  pending!,
                )}.`
          } DATABASE_MIGRATION_WAIT_TIMEOUT_MS is 0, so this process starts anyway, on the schema it found; what needs a missing migration fails until it is applied.`,
        );
        return;
      }

      const remainingInMs: number = policy.timeoutInMs - waitedInMs;

      if (remainingInMs <= 0) {
        throw new SchemaMigrationWaitTimeoutError({
          pendingMigrationNames: pending,
          waitedInMs: waitedInMs,
          lastError: lastError,
        });
      }

      const due: boolean =
        loggedAt === null || now - loggedAt >= policy.logIntervalInMs;

      if (lastError) {
        if (due) {
          logger.warn(
            `Could not read which schema migrations are applied: ${this.getErrorMessage(
              lastError,
            )}. Trying again in ${Math.round(policy.pollIntervalInMs / 1000)} s.`,
          );
          loggedAt = now;
        }
      } else if (!explained) {
        logger.info(this.getWaitExplanation(dataSource, pending!, policy));
        explained = true;
        loggedAt = now;
      } else if (due) {
        logger.info(
          `Still waiting, after ${Math.round(waitedInMs / 1000)} s, for ${
            pending!.length
          } schema migration(s): ${this.describeMigrations(pending!)}.`,
        );
        loggedAt = now;
      }

      await Sleep.sleep(Math.min(policy.pollIntervalInMs, remainingInMs));
    }
  }

  /*
   * The migrations of `dataSource` the database has not recorded, in the
   * order they run. Only reads (see above); throws when it cannot.
   */
  public static async getPendingMigrationNames(
    dataSource: DataSource,
  ): Promise<Array<string>> {
    const pending: Array<Migration> = await new MigrationExecutor(
      dataSource,
    ).getPendingMigrations();

    return pending.map((migration: Migration): string => {
      return migration.name;
    });
  }

  /* The first few names, and how many more there are. */
  public static describeMigrations(names: Array<string>): string {
    const named: string = names.slice(0, MIGRATIONS_NAMED).join(", ");

    return names.length > MIGRATIONS_NAMED
      ? `${named} and ${names.length - MIGRATIONS_NAMED} more`
      : named;
  }

  public static getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private static getWaitExplanation(
    dataSource: DataSource,
    pending: Array<string>,
    policy: SchemaMigrationWaitPolicy,
  ): string {
    const known: number = (dataSource.migrations || []).length;

    return `${
      pending.length === known
        ? `Waiting for the database schema to be created before starting: none of this code's ${known} schema migrations is applied yet.`
        : `Waiting for ${pending.length} schema migration(s) to be applied before starting: ${this.describeMigrations(
            pending,
          )}.`
    } This process does not apply them itself (RUN_DATABASE_MIGRATIONS_ON_BOOT=false; in the Helm chart the migrate Job does), and its code needs them. Waiting up to ${Math.round(
      policy.timeoutInMs / 1000,
    )} s (DATABASE_MIGRATION_WAIT_TIMEOUT_MS).`;
  }
}
