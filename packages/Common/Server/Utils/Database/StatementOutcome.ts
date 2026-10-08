import { QueryFailedError } from "typeorm";

/*
 * WHETHER A STATEMENT THAT FAILED MAY STILL BE APPLIED.
 *
 * A statement the database answered with an error of its own - a constraint,
 * a lock it waited too long for, one it cancelled at its statement timeout -
 * was not applied: a statement that fails is rolled back.
 *
 * One the database never answered may still be. The client's own query
 * timeout (DATABASE_QUERY_TIMEOUT_MS, node-postgres' query_timeout) stops
 * waiting for the answer but does not cancel the statement, and a connection
 * lost while a statement runs leaves it to the database whether it finishes:
 * either way the database may still run the statement, and commit it, after
 * the caller was told that it failed. So does an answer that the connection
 * itself failed (SQLSTATE class 08, connection exception - PgBouncer's
 * answer when it loses the server connection a statement ran on): it says
 * nothing about the statement.
 *
 * TypeORM hands every failure of a statement it sent as a QueryFailedError,
 * the driver's error on it (driverError). node-postgres reports the
 * database's own answer as a DatabaseError, which always carries the
 * severity and the SQLSTATE the server sent. A failure before any statement
 * was sent - no free connection in the pool, say - is no QueryFailedError,
 * and counts as not applied.
 */

// SQLSTATE class 08, connection exception: the connection failed, not the statement.
const CONNECTION_EXCEPTION_CLASS: string = "08";

export default class StatementOutcome {
  /*
   * Whether the statement whose failure this is may still be applied by the
   * database: it was sent, and the database's own answer to it never came.
   */
  public static isUnknown(error: unknown): boolean {
    if (!StatementOutcome.isSentStatementFailure(error)) {
      return false;
    }

    const sqlState: string | null = StatementOutcome.getDatabaseAnswer(
      (error as { driverError?: unknown }).driverError,
    );

    return sqlState === null || sqlState.startsWith(CONNECTION_EXCEPTION_CLASS);
  }

  /*
   * A statement that was sent and failed: TypeORM's QueryFailedError, known
   * by its name too, should another copy of TypeORM have thrown it.
   */
  private static isSentStatementFailure(error: unknown): boolean {
    if (error instanceof QueryFailedError) {
      return true;
    }

    return Boolean(
      error &&
        typeof error === "object" &&
        (error as { name?: unknown }).name === "QueryFailedError" &&
        "driverError" in error,
    );
  }

  /*
   * The SQLSTATE of the database's own answer - node-postgres' DatabaseError,
   * with its severity and code - or null when the error is not one.
   */
  private static getDatabaseAnswer(driverError: unknown): string | null {
    if (!driverError || typeof driverError !== "object") {
      return null;
    }

    const record: Record<string, unknown> = driverError as Record<
      string,
      unknown
    >;

    if (
      typeof record["severity"] !== "string" ||
      typeof record["code"] !== "string"
    ) {
      return null;
    }

    return record["code"];
  }
}
