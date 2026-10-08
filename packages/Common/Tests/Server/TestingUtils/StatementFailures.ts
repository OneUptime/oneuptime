import { DatabaseError } from "pg";
import { QueryFailedError } from "typeorm";

/*
 * Failures of a statement that was sent, as TypeORM hands them to a
 * service's error hooks: a QueryFailedError, with the statement it sent
 * (query) and the driver's error (driverError), from which StatementOutcome
 * decides whether the statement may still be applied.
 *
 *   - clientTimeout: the client stopped waiting for the answer
 *     (node-postgres' query_timeout, DATABASE_QUERY_TIMEOUT_MS);
 *   - connectionLost: the connection ended while the statement ran;
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
