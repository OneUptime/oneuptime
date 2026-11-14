import { describe, expect, test } from "@jest/globals";
import { QueryFailedError } from "typeorm";
import {
  POSTGRES_LOCK_CONTENTION_ERROR_CODES,
  isPostgresLockContentionError,
} from "../../../../Server/Utils/Database/PostgresLockContention";

/*
 * OneUptime issue #7194. The writes that may give up on a row another
 * writer holds - and leave it for the next poll - tell that failure from
 * every other by its SQLSTATE: 55P03 lock_not_available (lock_timeout ran
 * out) and 40P01 deadlock_detected. Anything else is a real failure and
 * must still be thrown, so this has to be exact.
 */

type DriverError = Error & { code?: unknown };

function driverError(code: unknown, message: string = "failed"): DriverError {
  const error: DriverError = new Error(message);
  error.code = code;
  return error;
}

describe("isPostgresLockContentionError", () => {
  test("names exactly the lock timeout and the deadlock", () => {
    expect([...POSTGRES_LOCK_CONTENTION_ERROR_CODES].sort()).toEqual([
      "40P01",
      "55P03",
    ]);
  });

  test.each(["55P03", "40P01"])(
    "%s from the driver itself is contention",
    (code: string) => {
      expect(isPostgresLockContentionError(driverError(code))).toBe(true);
    },
  );

  /*
   * What a repository's manager.query actually throws: TypeORM's
   * QueryFailedError, which copies the driver error's fields onto itself
   * and keeps the driver error as driverError.
   */
  test.each(["55P03", "40P01"])(
    "%s wrapped in TypeORM's QueryFailedError is contention",
    (code: string) => {
      const wrapped: QueryFailedError = new QueryFailedError(
        'UPDATE "NetworkDevice" SET ...',
        [],
        driverError(code, "canceling statement due to lock timeout"),
      );

      expect(isPostgresLockContentionError(wrapped)).toBe(true);
    },
  );

  test("only the driver error's code, as an exception that kept nothing else", () => {
    expect(
      isPostgresLockContentionError({ driverError: { code: "55P03" } }),
    ).toBe(true);
  });

  test("the code PostgresErrorTranslator tags its exceptions with", () => {
    expect(isPostgresLockContentionError({ postgresErrorCode: "40P01" })).toBe(
      true,
    );
  });

  test.each([
    ["a unique violation", "23505"],
    ["a foreign key violation", "23503"],
    ["a statement timeout", "57014"],
    ["an admin shutdown", "57P01"],
    ["a serialization failure", "40001"],
    ["a lower-case look-alike", "55p03"],
    ["a numeric code", 55],
  ])("%s is not contention", (_label: string, code: unknown) => {
    expect(isPostgresLockContentionError(driverError(code))).toBe(false);
    expect(isPostgresLockContentionError({ driverError: { code } })).toBe(
      false,
    );
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "canceling statement due to lock timeout"],
    ["a number", 55],
    ["an error with no code", new Error("lock timeout")],
    ["a null driver error", { driverError: null }],
  ])("%s is not contention", (_label: string, error: unknown) => {
    expect(isPostgresLockContentionError(error)).toBe(false);
  });
});
