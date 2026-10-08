import StatementOutcome from "../../../../Server/Utils/Database/StatementOutcome";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  COMMIT_STATEMENT,
  INSERT_STATEMENT,
  SELECT_STATEMENT,
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
 * applied. One that writes, whose answer never came - the client stopped
 * waiting for it, or the connection was lost while it ran - may still be:
 * the SSO sign-in changes keep their locks for such a write until the
 * database would have cancelled it (ProjectSsoProviderChanges.
 * giveBackAfterFailedWrite). A read leaves nothing to land, and in a
 * transaction of its own a write lands only with its COMMIT.
 */

describe("a write the database never answered may still be applied", () => {
  test("the client stopped waiting for the answer: node-postgres' own query timeout", () => {
    expect(StatementOutcome.mayStillApply(clientTimeout())).toBe(true);
  });

  test("the connection ended while the statement ran", () => {
    expect(StatementOutcome.mayStillApply(connectionLost())).toBe(true);
  });

  test("the connection was reset under it: an error of the socket, not of the database", () => {
    const reset: Error & { code?: string } = new Error("read ECONNRESET");
    reset.code = "ECONNRESET";

    expect(
      StatementOutcome.mayStillApply(
        new QueryFailedError(INSERT_STATEMENT, [], reset),
      ),
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
        StatementOutcome.mayStillApply(
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
      StatementOutcome.mayStillApply(
        new QueryFailedError(INSERT_STATEMENT, [], socketError),
      ),
    ).toBe(true);
  });

  test("known by its name too, should another copy of TypeORM have thrown it", () => {
    expect(
      StatementOutcome.mayStillApply({
        name: "QueryFailedError",
        message: "Query read timeout",
        query: 'UPDATE "GlobalConfig" SET "requireSsoForLogin" = $1',
        driverError: new Error("Query read timeout"),
      }),
    ).toBe(true);
  });

  test("a statement whose text is not known counts as one that writes", () => {
    expect(
      StatementOutcome.mayStillApply({
        name: "QueryFailedError",
        message: "Query read timeout",
        driverError: new Error("Query read timeout"),
      }),
    ).toBe(true);
  });

  test("the first word decides, past blank space, brackets and comments", () => {
    expect(
      StatementOutcome.mayStillApply(
        clientTimeout(
          '\n  -- written by the hooks\n  /* sign-in rule */ (UPDATE "Project" SET "name" = $1)',
        ),
      ),
    ).toBe(true);
    expect(
      StatementOutcome.mayStillApply(clientTimeout("/* a read */\n  select 1")),
    ).toBe(false);
  });
});

describe("a read the database never answered applied nothing", () => {
  test("a SELECT the client stopped waiting for: a check's own read, or one made once the write was done", () => {
    expect(
      StatementOutcome.mayStillApply(clientTimeout(SELECT_STATEMENT)),
    ).toBe(false);
    expect(
      StatementOutcome.mayStillApply(connectionLost(SELECT_STATEMENT)),
    ).toBe(false);
  });

  test("whatever the caller knows of the write", () => {
    expect(
      StatementOutcome.mayStillApply(clientTimeout(SELECT_STATEMENT), {
        inOwnTransaction: true,
      }),
    ).toBe(false);
  });
});

describe("a write in a transaction of its own - a create - lands only with its COMMIT", () => {
  test("an INSERT the client stopped waiting for is rolled back with its transaction", () => {
    expect(
      StatementOutcome.mayStillApply(clientTimeout(INSERT_STATEMENT), {
        inOwnTransaction: true,
      }),
    ).toBe(false);
    expect(
      StatementOutcome.mayStillApply(connectionLost(INSERT_STATEMENT), {
        inOwnTransaction: true,
      }),
    ).toBe(false);
  });

  test("a COMMIT whose answer never came may have landed", () => {
    expect(
      StatementOutcome.mayStillApply(clientTimeout(COMMIT_STATEMENT), {
        inOwnTransaction: true,
      }),
    ).toBe(true);
    expect(
      StatementOutcome.mayStillApply(connectionLost("commit"), {
        inOwnTransaction: true,
      }),
    ).toBe(true);
  });

  test("a statement whose text is not known may have been the COMMIT", () => {
    expect(
      StatementOutcome.mayStillApply(
        {
          name: "QueryFailedError",
          driverError: new Error("Query read timeout"),
        },
        { inOwnTransaction: true },
      ),
    ).toBe(true);
  });

  test("outside a transaction of its own, an INSERT the client stopped waiting for may still land", () => {
    expect(
      StatementOutcome.mayStillApply(clientTimeout(INSERT_STATEMENT)),
    ).toBe(true);
  });
});

describe("a statement the database answered was not applied", () => {
  test("the database cancelled it at its own statement timeout, and said so", () => {
    expect(StatementOutcome.mayStillApply(cancelledByDatabase())).toBe(false);
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
        StatementOutcome.mayStillApply(databaseAnswer({ code, message })),
      ).toBe(false);
    },
  );

  test.each([["query_wait_timeout"], ["pgbouncer cannot connect to server"]])(
    "PgBouncer's answer for a statement it never sent on to the database - %s - though it gives a connection exception",
    (message: string) => {
      expect(
        StatementOutcome.mayStillApply(
          databaseAnswer({ code: "08P01", message, severity: "FATAL" }),
        ),
      ).toBe(false);
    },
  );

  test("the same answer known by its name", () => {
    expect(
      StatementOutcome.mayStillApply({
        name: "QueryFailedError",
        message: "canceling statement due to statement timeout",
        query: 'UPDATE "Project" SET "requireSsoForLogin" = $1',
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
    expect(StatementOutcome.mayStillApply(error)).toBe(false);
  });
});
