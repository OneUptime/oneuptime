import { DatabaseError } from "pg";
import { QueryFailedError } from "typeorm";

/*
 * Failures of a statement that was sent, as TypeORM hands them to a
 * service's error hooks: a QueryFailedError, the driver's error on it
 * (StatementOutcome decides from it whether the statement may still be
 * applied).
 *
 *   - clientTimeout: the client stopped waiting for the answer
 *     (node-postgres' query_timeout, DATABASE_QUERY_TIMEOUT_MS);
 *   - connectionLost: the connection ended while the statement ran;
 *   - databaseAnswer: the database's own answer - node-postgres'
 *     DatabaseError, with the severity and the SQLSTATE the server sent.
 */

const SQL: string =
  'UPDATE "Project" SET "requireSsoForLogin" = $1 WHERE "_id" = $2';

export const clientTimeout: () => QueryFailedError = (): QueryFailedError => {
  return new QueryFailedError(SQL, [], new Error("Query read timeout"));
};

export const connectionLost: () => QueryFailedError = (): QueryFailedError => {
  return new QueryFailedError(
    SQL,
    [],
    new Error("Connection terminated unexpectedly"),
  );
};

export const databaseAnswer: (data: {
  code: string;
  message: string;
  severity?: string | undefined;
}) => QueryFailedError = (data: {
  code: string;
  message: string;
  severity?: string | undefined;
}): QueryFailedError => {
  const answer: DatabaseError = new DatabaseError(data.message, 0, "error");
  answer.severity = data.severity || "ERROR";
  answer.code = data.code;

  return new QueryFailedError(SQL, [], answer);
};

// The database cancelled the statement at its own statement timeout, and said so.
export const cancelledByDatabase: () => QueryFailedError =
  (): QueryFailedError => {
    return databaseAnswer({
      code: "57014",
      message: "canceling statement due to statement timeout",
    });
  };
