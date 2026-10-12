import { StatementNotSentError } from "../../../Server/Infrastructure/Postgres/CancelOnTimeoutClient";
import { DatabaseError } from "pg";
import { QueryFailedError } from "typeorm";

/*
 * Failures of a statement that was sent, as TypeORM hands them to a
 * service's error hooks: a QueryFailedError, with the statement it sent
 * (query) and the driver's error (driverError), from which StatementOutcome
 * decides whether the statement may still be applied.
 *
 *   - clientTimeout: the client stopped waiting for the answer
 *     (DATABASE_QUERY_TIMEOUT_MS) and no answer came to its cancel either -
 *     the cancel could not reach the database (CancelOnTimeoutClient);
 *   - connectionLost: the connection ended while the statement ran;
 *   - notSent: the client never sent it - refused on a connection being
 *     closed, or out of time in its queue (StatementNotSentError);
 *   - databaseAnswer: the database's own answer - node-postgres'
 *     DatabaseError, with the severity and the SQLSTATE the server sent.
 *
 * Each fails an UPDATE unless given another statement.
 */

export const UPDATE_STATEMENT: string =
  'UPDATE "Project" SET "requireSsoForLogin" = $1 WHERE "_id" = $2';

export const INSERT_STATEMENT: string =
  'INSERT INTO "Project"("_id", "name", "requireSsoForLogin") VALUES ($1, $2, $3) RETURNING "_id"';

export const SELECT_STATEMENT: string =
  'SELECT "Project"."_id" AS "Project__id" FROM "Project" "Project" WHERE "Project"."_id" = $1';

export const COMMIT_STATEMENT: string = "COMMIT";

export const clientTimeout: (statement?: string) => QueryFailedError = (
  statement?: string,
): QueryFailedError => {
  return new QueryFailedError(
    statement || UPDATE_STATEMENT,
    [],
    new Error("Query read timeout"),
  );
};

export const notSent: (
  statement?: string,
  message?: string,
) => QueryFailedError = (
  statement?: string,
  message?: string,
): QueryFailedError => {
  return new QueryFailedError(
    statement || UPDATE_STATEMENT,
    [],
    new StatementNotSentError(message),
  );
};

export const connectionLost: (statement?: string) => QueryFailedError = (
  statement?: string,
): QueryFailedError => {
  return new QueryFailedError(
    statement || UPDATE_STATEMENT,
    [],
    new Error("Connection terminated unexpectedly"),
  );
};

export const databaseAnswer: (data: {
  code: string;
  message: string;
  severity?: string | undefined;
  statement?: string | undefined;
}) => QueryFailedError = (data: {
  code: string;
  message: string;
  severity?: string | undefined;
  statement?: string | undefined;
}): QueryFailedError => {
  const answer: DatabaseError = new DatabaseError(data.message, 0, "error");
  answer.severity = data.severity || "ERROR";
  answer.code = data.code;

  return new QueryFailedError(data.statement || UPDATE_STATEMENT, [], answer);
};

// The database cancelled the statement at its own statement timeout, and said so.
export const cancelledByDatabase: () => QueryFailedError =
  (): QueryFailedError => {
    return databaseAnswer({
      code: "57014",
      message: "canceling statement due to statement timeout",
    });
  };

/*
 * The database cancelled the statement at the app's request - the cancel
 * the client sends for a statement it stopped waiting for
 * (CancelOnTimeoutClient) - and said so.
 */
export const cancelledAtAppRequest: (statement?: string) => QueryFailedError = (
  statement?: string,
): QueryFailedError => {
  return databaseAnswer({
    code: "57014",
    message: "canceling statement due to user request",
    statement,
  });
};
