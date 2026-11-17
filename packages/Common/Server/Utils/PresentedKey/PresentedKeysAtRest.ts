import logger from "../Logger";

/*
 * WHEN THE KEYS PRESENTED TO ONEUPTIME ARE PROTECTED AT REST (#9012).
 *
 * The keys and tokens presented to OneUptime - a probe's key, a monitor's
 * secret key, a SCIM bearer token - were stored as written. Now they are
 * kept encrypted (PresentedKey), or hashed (a SCIM bearer token). The
 * values stored before are protected in two steps, so that a server of the
 * release before - one still running beside this release's while an
 * upgrade rolls out, which compares a key as written - keeps checking the
 * keys it has:
 *
 *   1. The HashPresentedKeysForLookup data migration, at the upgrade,
 *      writes each key's lookup hash beside it and changes no key: every
 *      server keeps finding every key, this release's by its hash.
 *   2. The PresentedKeys:ProtectAtRest job, once SETTLE_PERIOD_MS has gone
 *      by since that migration ran - when no server of the release before
 *      can still be serving - encrypts (or hashes) each value stored as
 *      written, in place, and then records PROTECTED_AT_REST_MARKER.
 *
 * Until that record exists, a key may still be stored as written, and a
 * request's key that is not found by its hash is looked up as written too
 * (mayHoldKeysAsWritten). Once it does, no key a request presents goes
 * into a query.
 */

// The data migration that writes the lookup hashes: when it ran starts the wait.
export const LOOKUP_HASH_MIGRATION_NAME: string = "HashPresentedKeysForLookup";

// Recorded in the DataMigrations table once every value stored as written is protected.
export const PROTECTED_AT_REST_MARKER: string = "ProtectPresentedKeysAtRest";

/*
 * How long after the lookup hashes are written the values stored as written
 * are protected in place: long past any rolling upgrade, so no server of
 * the release before - which compares keys as written - is still running.
 */
export const SETTLE_PERIOD_MS: number = 24 * 60 * 60 * 1000;

// How long a process goes by what it last found, before it asks again.
export const PROTECTION_CHECK_TTL_MS: number = 60 * 1000;

// What reads the DataMigrations table: an EntityManager, a DataSource.
export interface SqlRunner {
  query: (sql: string, parameters?: Array<unknown>) => Promise<unknown>;
}

// Whether a data migration (or the marker) is recorded as done, and when.
export const EXECUTED_AT_SQL: string = `SELECT MIN("executedAt") AS "executedAt" FROM "DataMigrations" WHERE "name" = $1 AND "executed" = true AND "deletedAt" IS NULL`;

export default class PresentedKeysAtRest {
  private static protection: {
    isProtected: boolean;
    checkedAt: number;
  } | null = null;

  /*
   * When a data migration (or the marker) was recorded as done, or null
   * when it is not.
   */
  public static async getExecutedAt(
    runner: SqlRunner,
    name: string,
  ): Promise<Date | null> {
    const rows: unknown = await runner.query(EXECUTED_AT_SQL, [name]);

    const executedAt: unknown = Array.isArray(rows)
      ? (rows[0] as Record<string, unknown> | undefined)?.["executedAt"]
      : undefined;

    if (!executedAt) {
      return null;
    }

    const date: Date = new Date(executedAt as string | Date);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  /*
   * Whether a key may still be stored as written: until the
   * PresentedKeys:ProtectAtRest job has protected every one. Asked of the
   * database at most once a minute per process. A question the database
   * does not answer counts as yes: an upgrade must not lock anyone out.
   */
  public static async mayHoldKeysAsWritten(
    runner: SqlRunner,
  ): Promise<boolean> {
    const now: number = Date.now();

    if (
      PresentedKeysAtRest.protection &&
      now - PresentedKeysAtRest.protection.checkedAt < PROTECTION_CHECK_TTL_MS
    ) {
      return !PresentedKeysAtRest.protection.isProtected;
    }

    let isProtected: boolean = false;

    try {
      isProtected = Boolean(
        await PresentedKeysAtRest.getExecutedAt(
          runner,
          PROTECTED_AT_REST_MARKER,
        ),
      );
    } catch (err) {
      logger.error(
        "PresentedKeysAtRest: could not tell whether the keys presented to OneUptime are protected at rest yet; they are looked up as written too until it can:",
      );
      logger.error(err);
    }

    PresentedKeysAtRest.protection = {
      isProtected: isProtected,
      checkedAt: now,
    };

    return !isProtected;
  }

  // Forgets what was found, so the next question asks the database: for tests.
  public static forget(): void {
    PresentedKeysAtRest.protection = null;
  }
}
