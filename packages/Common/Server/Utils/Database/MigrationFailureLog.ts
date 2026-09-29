import os from "os";
import { DataSource, DataSourceOptions } from "typeorm";
import logger from "../Logger";
import { AppVersion } from "../../EnvironmentConfig";

/*
 * Records migrations that FAILED to apply into the "MigrationFailure" table so
 * the admin health page can explain WHY a migration is pending (what error,
 * when it ran) instead of only showing that it is behind. Every write here is
 * best-effort: a diagnostic log must never itself crash a boot / migrate Job or
 * mask the real migration error, so all failures inside this module are
 * swallowed (logged, not thrown).
 */

// Which runner a failed migration belongs to. Stored verbatim in the table.
export enum MigrationFailureType {
  PostgresSchema = "PostgresSchema",
  DataMigration = "DataMigration",
}

// Keep a single row bounded so a pathological error/stack can't bloat the table.
const MAX_ERROR_MESSAGE_LENGTH: number = 10000;
const MAX_ERROR_STACK_LENGTH: number = 20000;

/*
 * Best-effort credential scrub for the free-form error text we persist. DB /
 * migration errors seldom carry secrets, but a connection error can echo a
 * `scheme://user:pass@host` DSN and a failing DDL can quote a literal default,
 * so we mask the obvious vectors before the text is stored and later shown.
 */
const CONNECTION_STRING_SECRET_PATTERN: RegExp =
  /([a-z][a-z0-9+.-]*:\/\/[^:@\s/]+):[^\s/]+@/gi;
const KEYWORD_SECRET_PATTERN: RegExp =
  /(password|secret|token|api[_-]?key|apikey|credential|private[_-]?key|auth[_-]?token|access[_-]?key)(\s*[:=]\s*)('(?:[^']|'')*'|"[^"]*"|[^\s,)]+)/gi;

export function scrubMigrationErrorText(text: string): string {
  if (!text) {
    return text;
  }

  return text
    .replace(
      CONNECTION_STRING_SECRET_PATTERN,
      (_match: string, prefix: string): string => {
        return `${prefix}:***REDACTED***@`;
      },
    )
    .replace(
      KEYWORD_SECRET_PATTERN,
      (_match: string, keyword: string, separator: string): string => {
        return `${keyword}${separator}***REDACTED***`;
      },
    );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || "Unknown error";
  }
  return String(error);
}

function toErrorStack(error: unknown): string | null {
  return error instanceof Error && error.stack ? error.stack : null;
}

interface MigrationFailureInput {
  migrationName: string;
  migrationType: MigrationFailureType;
  error: unknown;
}

/*
 * Append one failed-attempt row using the provided (already-connected)
 * DataSource. Raw SQL — not the Service layer — so it also works on a
 * throwaway diagnostic connection and never depends on realtime/event wiring.
 * Returns true if the row was written. If the "MigrationFailure" table does not
 * exist yet (e.g. its own migration is still pending on a first rollout) the
 * INSERT throws and is swallowed — the caller's real error is unaffected.
 */
export async function recordMigrationFailure(
  dataSource: DataSource,
  input: MigrationFailureInput,
): Promise<boolean> {
  try {
    const message: string = scrubMigrationErrorText(
      toErrorMessage(input.error),
    ).substring(0, MAX_ERROR_MESSAGE_LENGTH);

    const rawStack: string | null = toErrorStack(input.error);
    const stack: string | null = rawStack
      ? scrubMigrationErrorText(rawStack).substring(0, MAX_ERROR_STACK_LENGTH)
      : null;

    await dataSource.query(
      `INSERT INTO "MigrationFailure"
         ("migrationName", "migrationType", "errorMessage", "errorStack", "attemptedAt", "hostName", "appVersion", "version", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, now(), now())`,
      [
        input.migrationName,
        input.migrationType,
        message,
        stack,
        new Date(),
        os.hostname(),
        AppVersion,
      ],
    );

    return true;
  } catch (err) {
    // Diagnostic write must never mask the real failure — log and move on.
    logger.warn(
      `Could not record migration failure for "${input.migrationName}" (${input.migrationType}); continuing.`,
    );
    logger.warn(err);
    return false;
  }
}

// Trailing epoch in a migration class name — how TypeORM orders/identifies them.
function parseMigrationTimestamp(name: string): number {
  const match: RegExpMatchArray | null = name.match(/(\d{10,})$/);
  return match ? Number(match[1]) : 0;
}

/*
 * The TypeORM schema runner (migrationsRun) applies migrations in ascending
 * timestamp order and halts at the first failure, so the FIRST defined
 * migration not yet in the `migrations` table is exactly the one that failed.
 * We recompute it here from a throwaway connection because the app's own
 * connect() has already failed (its DataSource is not usable) at the point a
 * schema migration throws.
 */
export async function recordSchemaMigrationFailureBestEffort(
  dataSourceOptions: DataSourceOptions,
  originalError: unknown,
): Promise<void> {
  /*
   * Only THIS process's own boot runs schema migrations (migrationsRun=true —
   * the migrate Job and single-pod / dev boots). On runtime pods where a
   * dedicated migrate Job owns migrations (migrationsRun=false), a connect()
   * failure is a connectivity problem, never a failed migration — recording
   * one here would misattribute an outage to a (legitimately) pending
   * migration, so skip.
   */
  if (
    (dataSourceOptions as { migrationsRun?: boolean }).migrationsRun !== true
  ) {
    return;
  }

  let diagnosticDataSource: DataSource | null = null;

  try {
    diagnosticDataSource = new DataSource({
      ...dataSourceOptions,
      // Never re-run migrations or sync schema on the diagnostic connection.
      migrationsRun: false,
      synchronize: false,
      // Keep the probe short so a genuinely-down DB doesn't slow the failing boot.
      extra: {
        ...((dataSourceOptions as { extra?: Record<string, unknown> }).extra ||
          {}),
        connectionTimeoutMillis: 5000,
      },
    } as DataSourceOptions);

    /*
     * If this fails, the original error was a connectivity problem (not a bad
     * migration) — there is nothing meaningful to attribute, so we skip.
     */
    await diagnosticDataSource.initialize();

    const definedMigrationClasses: Array<new () => { name: string }> =
      Array.isArray(dataSourceOptions.migrations)
        ? (dataSourceOptions.migrations as unknown as Array<
            new () => { name: string }
          >)
        : [];

    const definedNames: Array<string> = Array.from(
      new Set(
        definedMigrationClasses.map(
          (MigrationClass: new () => { name: string }): string => {
            return new MigrationClass().name;
          },
        ),
      ),
    ).sort((a: string, b: string): number => {
      return parseMigrationTimestamp(a) - parseMigrationTimestamp(b);
    });

    let appliedNames: Set<string> = new Set();
    try {
      const rows: Array<{ name: string }> = await diagnosticDataSource.query(
        "SELECT name FROM migrations",
      );
      appliedNames = new Set(
        rows.map((row: { name: string }): string => {
          return row.name;
        }),
      );
    } catch {
      // migrations table may not exist on a brand-new DB — treat as none applied.
    }

    const firstPending: string | undefined = definedNames.find(
      (name: string): boolean => {
        return !appliedNames.has(name);
      },
    );

    /*
     * No pending schema migration means the connect() failure was not a pending
     * migration failing (e.g. an entity-metadata error) — don't misattribute it.
     */
    if (!firstPending) {
      return;
    }

    await recordMigrationFailure(diagnosticDataSource, {
      migrationName: firstPending,
      migrationType: MigrationFailureType.PostgresSchema,
      error: originalError,
    });
  } catch (err) {
    // Best-effort diagnostics only — swallow everything.
    logger.warn("Could not record Postgres schema migration failure.");
    logger.warn(err);
  } finally {
    try {
      if (diagnosticDataSource && diagnosticDataSource.isInitialized) {
        await diagnosticDataSource.destroy();
      }
    } catch (destroyErr) {
      logger.warn(destroyErr);
    }
  }
}
