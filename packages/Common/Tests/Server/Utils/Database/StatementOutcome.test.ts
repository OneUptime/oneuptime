import StatementOutcome from "../../../../Server/Utils/Database/StatementOutcome";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  cancelledByDatabase,
  clientTimeout,
  connectionLost,
  databaseAnswer,
} from "../../TestingUtils/StatementFailures";
import { describe, expect, test } from "@jest/globals";
import { QueryFailedError } from "typeorm";

/*
 * WHETHER A STATEMENT THAT FAILED MAY STILL BE APPLIED
 * (Server/Utils/Database/StatementOutcome).
 *
 * A statement the database answered with an error of its own was not
 * applied. One whose answer never came - the client stopped waiting for it,
 * or the connection was lost while it ran - may still be: the SSO sign-in
 * changes keep their locks for such a write until the database would have
 * cancelled it (ProjectSsoProviderChanges.giveBackAfterFailedWrite).
 */

describe("a statement the database never answered may still be applied", () => {
  test("the client stopped waiting for the answer: node-postgres' own query timeout", () => {
    expect(StatementOutcome.isUnknown(clientTimeout())).toBe(true);
  });

  test("the connection ended while the statement ran", () => {
    expect(StatementOutcome.isUnknown(connectionLost())).toBe(true);
  });

  test("the connection was reset under it: an error of the socket, not of the database", () => {
    const reset: Error & { code?: string } = new Error("read ECONNRESET");
    reset.code = "ECONNRESET";

    expect(
      StatementOutcome.isUnknown(new QueryFailedError("UPDATE", [], reset)),
    ).toBe(true);
  });

  test.each([
    ["08006", "server conn crashed?"],
    ["08P01", "server conn crashed?"],
    ["08003", "connection does not exist"],
  ])(
    "an answer that the connection failed - SQLSTATE %s, as PgBouncer answers when it loses the server connection - says nothing about the statement",
    (code: string, message: string) => {
      expect(
        StatementOutcome.isUnknown(
          databaseAnswer({ code, message, severity: "FATAL" }),
        ),
      ).toBe(true);
    },
  );

  test("a driver error with a code but no severity is not the database's answer", () => {
    const socketError: Error & { code?: string } = new Error(
      "connect ETIMEDOUT",
    );
    socketError.code = "ETIMEDOUT";

    expect(
      StatementOutcome.isUnknown(
        new QueryFailedError("UPDATE", [], socketError),
      ),
    ).toBe(true);
  });

  test("known by its name too, should another copy of TypeORM have thrown it", () => {
    expect(
      StatementOutcome.isUnknown({
        name: "QueryFailedError",
        message: "Query read timeout",
        driverError: new Error("Query read timeout"),
      }),
    ).toBe(true);
  });
});

describe("a statement the database answered was not applied", () => {
  test("the database cancelled it at its own statement timeout, and said so", () => {
    expect(StatementOutcome.isUnknown(cancelledByDatabase())).toBe(false);
  });

  test.each([
    ["55P03", "canceling statement due to lock timeout"],
    ["23505", "duplicate key value violates unique constraint"],
    ["40P01", "deadlock detected"],
    ["22P02", "invalid input syntax for type uuid"],
  ])(
    "an error of its own - SQLSTATE %s - rolls the statement back",
    (code: string, message: string) => {
      expect(
        StatementOutcome.isUnknown(databaseAnswer({ code, message })),
      ).toBe(false);
    },
  );

  test("the same answer known by its name", () => {
    expect(
      StatementOutcome.isUnknown({
        name: "QueryFailedError",
        message: "canceling statement due to statement timeout",
        driverError: { severity: "ERROR", code: "57014" },
      }),
    ).toBe(false);
  });
});

describe("a failure before any statement was sent applied nothing", () => {
  test.each([
    ["a refusal", new BadDataException("Refused.")],
    [
      "no free connection in the pool",
      new Error("timeout exceeded when trying to connect"),
    ],
    [
      "an error named like TypeORM's, carrying no driver error",
      { name: "QueryFailedError" },
    ],
    ["nothing at all", undefined],
    ["null", null],
    ["a string", "Query read timeout"],
  ])("%s", (_label: string, error: unknown) => {
    expect(StatementOutcome.isUnknown(error)).toBe(false);
  });
});
