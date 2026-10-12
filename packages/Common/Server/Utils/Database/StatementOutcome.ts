import { QueryFailedError } from "typeorm";

/*
 * WHETHER A STATEMENT THAT FAILED MAY STILL BE APPLIED.
 *
 * A statement the database answered with an error of its own - a constraint,
 * a lock it waited too long for, one it cancelled at its statement timeout,
 * or at the app's request - was not applied: a statement that fails is
 * rolled back.
 *
 * One the database never answered may still be. The app's client cancels a
 * statement it stopped waiting for (DATABASE_QUERY_TIMEOUT_MS) and hands on
 * the database's answer to the cancel (Infrastructure/Postgres/
 * CancelOnTimeoutClient); only when no answer comes even then - the cancel
 * could not reach the database, the connection is gone - is the caller told
 * the read timed out, and a connection lost while a statement runs leaves it
 * to the database whether it finishes: either way the database may still run
 * the statement, and commit it, after the caller was told that it failed. So
 * does an answer that the connection itself failed (SQLSTATE class 08,
 * connection exception - PgBouncer's answer when it loses the server
 * connection a statement ran on): it says nothing about the statement.
 * PgBouncer gives that class too to a statement it never sent on to the
 * database - no server connection came free in time (query_wait_timeout), or
 * none could be opened - and those were never run. Nor was a statement the
 * app's client never sent: refused on a connection it is closing, or out of
 * time while still queued behind another statement on its connection
 * (StatementNotSentError).
 *
 * Only the write itself can apply anything of it. When the caller knows
 * which step of a create, update or delete failed (DatabaseService hands it
 * to the error hooks: StatementContext.failedStep), a statement around the
 * write - a check, a hook, a helper - applies nothing of the write: it had
 * not started, or it was done. And of the statements the write sends, only
 * one that writes can: a read whose answer never came leaves nothing to
 * land, and TypeORM's error carries the statement it sent
 * (QueryFailedError.query), so a read is told by its first word.
 *
 * A write that runs in a transaction of its own - TypeORM's save(), which
 * every create goes through - lands only with its COMMIT. A statement of it
 * whose answer never came does not: the connection it ran on is closed
 * rather than handed to another request (CancelOnTimeoutClient), and the
 * database rolls back a transaction whose connection goes - as it does one
 * whose connection is lost. So there only a COMMIT whose answer never came
 * may still apply (StatementContext.inOwnTransaction), told from TypeORM's
 * own statements by its first word.
 *
 * TypeORM hands every failure of a statement it sent as a QueryFailedError,
 * the driver's error on it (driverError). node-postgres reports the
 * database's own answer as a DatabaseError, which always carries the
 * severity and the SQLSTATE the server sent. A failure before any statement
 * was sent - no free connection in the pool, say - is no QueryFailedError,
 * and counts as not applied. A statement whose text is not known counts as
 * one that writes.
 */

// Which step of a create, update or delete a failure came from.
export enum WriteStep {
  /*
   * The write itself: the repository's INSERT (save(), in a transaction of
   * its own), UPDATE or DELETE.
   */
  Write = "Write",
  /*
   * A statement around it - a check, a hook, a helper - before the write
   * started or once it was done: never the write itself.
   */
  AroundWrite = "AroundWrite",
}

// What the caller knows of the write whose statement failed.
export interface StatementContext {
  /*
   * The write runs in a transaction of its own (TypeORM's save()): only its
   * COMMIT, unanswered, may still apply.
   */
  inOwnTransaction?: boolean | undefined;
  /*
   * Which step of the write failed, when the caller knows it
   * (DatabaseService's error hooks are handed it).
   */
  failedStep?: WriteStep | undefined;
}

// SQLSTATE class 08, connection exception: the connection failed, not the statement.
const CONNECTION_EXCEPTION_CLASS: string = "08";

// PgBouncer's answers for a statement it never sent on to the database.
const NEVER_SENT_ON_ANSWERS: Array<string> = [
  "query_wait_timeout",
  "pgbouncer cannot connect to server",
];

// Statements that change nothing, by their first word.
const READ_STATEMENTS: Array<string> = ["SELECT", "SHOW"];

// The statements that commit a transaction, by their first word.
const COMMIT_STATEMENTS: Array<string> = ["COMMIT", "END"];

interface DatabaseAnswer {
  code: string;
  message: string;
}

export default class StatementOutcome {
  /*
   * What is known of a create's failed statement: a create is written by
   * save(), in a transaction of its own - and, when DatabaseService said,
   * which step of it failed (`failedStatement`).
   */
  public static ofCreate(
    failedStatement?: StatementContext | undefined,
  ): StatementContext {
    return { inOwnTransaction: true, ...(failedStatement || {}) };
  }

  /*
   * Whether the statement whose failure this is may still be applied by the
   * database: it was sent, it is the write - or, in a transaction of its
   * own, commits - and the database's own answer to it never came.
   */
  public static mayStillApply(
    error: unknown,
    context?: StatementContext | undefined,
  ): boolean {
    if (!StatementOutcome.isSentStatementFailure(error)) {
      return false;
    }

    const driverError: unknown = (error as { driverError?: unknown })
      .driverError;

    // Never sent: refused on a connection being closed, or out of time in its queue.
    if (StatementOutcome.wasNeverSent(driverError)) {
      return false;
    }

    // Not the write itself: it had not started, or it was done.
    if (context?.failedStep === WriteStep.AroundWrite) {
      return false;
    }

    const answer: DatabaseAnswer | null =
      StatementOutcome.getDatabaseAnswer(driverError);

    if (answer && !StatementOutcome.saysNothingOfTheStatement(answer)) {
      return false;
    }

    const firstWord: string | null = StatementOutcome.getFirstWord(
      (error as { query?: unknown }).query,
    );

    // Which statement it was is not known: it may have been the write.
    if (firstWord === null) {
      return true;
    }

    if (READ_STATEMENTS.includes(firstWord)) {
      return false;
    }

    if (context?.inOwnTransaction) {
      return COMMIT_STATEMENTS.includes(firstWord);
    }

    return true;
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
   * The app's client never sent the statement: its connection was being
   * closed after an earlier one ran past its timeout, or it ran out of time
   * still waiting in the connection's queue (CancelOnTimeoutClient's
   * StatementNotSentError, known by its mark).
   */
  private static wasNeverSent(driverError: unknown): boolean {
    return Boolean(
      driverError &&
        typeof driverError === "object" &&
        (driverError as { isStatementNotSent?: unknown }).isStatementNotSent ===
          true,
    );
  }

  /*
   * An answer that the connection failed (SQLSTATE class 08) says nothing of
   * the statement - unless it is PgBouncer's for one it never sent on.
   */
  private static saysNothingOfTheStatement(answer: DatabaseAnswer): boolean {
    return (
      answer.code.startsWith(CONNECTION_EXCEPTION_CLASS) &&
      !NEVER_SENT_ON_ANSWERS.includes(answer.message.trim())
    );
  }

  /*
   * The database's own answer - node-postgres' DatabaseError, with its
   * severity and SQLSTATE - or null when the error is not one.
   */
  private static getDatabaseAnswer(
    driverError: unknown,
  ): DatabaseAnswer | null {
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

    return {
      code: record["code"],
      message: typeof record["message"] === "string" ? record["message"] : "",
    };
  }

  /*
   * The first word of a statement, upper case - past any comments, blank
   * space and opening brackets before it - or null when there is none.
   */
  private static getFirstWord(statement: unknown): string | null {
    if (typeof statement !== "string") {
      return null;
    }

    let rest: string = statement;

    for (;;) {
      const trimmed: string = rest.replace(/^[\s(]+/, "");

      if (trimmed.startsWith("--")) {
        const lineEnd: number = trimmed.indexOf("\n");
        rest = lineEnd < 0 ? "" : trimmed.slice(lineEnd + 1);
        continue;
      }

      if (trimmed.startsWith("/*")) {
        const commentEnd: number = trimmed.indexOf("*/");
        rest = commentEnd < 0 ? "" : trimmed.slice(commentEnd + 2);
        continue;
      }

      const word: RegExpMatchArray | null = trimmed.match(/^[A-Za-z]+/);

      return word ? word[0].toUpperCase() : null;
    }
  }
}
