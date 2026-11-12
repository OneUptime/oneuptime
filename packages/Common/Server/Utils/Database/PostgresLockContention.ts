/*
 * Whether a failed statement failed only because of another writer's row
 * lock: lock_not_available (55P03 - the statement waited lock_timeout,
 * DATABASE_LOCK_TIMEOUT_MS, and gave up) or deadlock_detected (40P01 -
 * Postgres cancelled this side of a deadlock). Neither says anything about
 * the write itself; the same write lands once the other writer is done.
 *
 * Read off the error as each layer hands it on: the driver's own error, the
 * QueryFailedError TypeORM wraps it in (driverError), and the exception
 * PostgresErrorTranslator makes of it (postgresErrorCode).
 */
export const POSTGRES_LOCK_CONTENTION_ERROR_CODES: ReadonlyArray<string> = [
  "55P03",
  "40P01",
];

export function isPostgresLockContentionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const failed: {
    code?: unknown;
    postgresErrorCode?: unknown;
    driverError?: { code?: unknown } | null;
  } = error as {
    code?: unknown;
    postgresErrorCode?: unknown;
    driverError?: { code?: unknown } | null;
  };

  return [failed.code, failed.postgresErrorCode, failed.driverError?.code].some(
    (code: unknown): boolean => {
      return (
        typeof code === "string" &&
        POSTGRES_LOCK_CONTENTION_ERROR_CODES.includes(code)
      );
    },
  );
}
