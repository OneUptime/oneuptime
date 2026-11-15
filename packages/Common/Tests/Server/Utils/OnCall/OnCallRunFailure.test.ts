import OnCallRunFailure, {
  OnCallRunFailureKind,
} from "../../../../Server/Utils/OnCall/OnCallRunFailure";
import BadDataException from "../../../../Types/Exception/BadDataException";
import BadDataExceptionWithDetails from "../../../../Types/Exception/BadDataExceptionWithDetails";
import DatabaseNotConnectedException from "../../../../Types/Exception/DatabaseNotConnectedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import QueryTimeoutException from "../../../../Types/Exception/QueryTimeoutException";
import ServiceUnavailableException from "../../../../Types/Exception/ServiceUnavailableException";
import TimeoutException from "../../../../Types/Exception/TimeoutException";
import TooManyRequestsException from "../../../../Types/Exception/TooManyRequestsException";
import UnableToReachServer from "../../../../Types/Exception/UnableToReachServer";
import { OnCallPageRecordGoneException } from "../../../../Types/OnCallDutyPolicy/OnCallPageRecordGone";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH FAILED STEPS OF AN ON-CALL RUN ARE TRIED AGAIN (issue #8167).
 *
 * The policy-run worker ended a run in Error on any error, so a connection
 * reset while it paged the next escalation rule meant no later rule was
 * ever paged. OnCallRunFailure tells a failure a retry can outlast - the
 * database, the network, the queue - from one it cannot - a record that is
 * gone, bad data - and reads anything else as worth trying again, the
 * tries being bounded (OnCallPolicyRunRetry). These pin it against errors
 * shaped as pg, its pool, TypeORM, ioredis and Node throw them.
 */

// An error as Node, pg or ioredis throws it: a message, and a code beside it.
function errorWith(
  message: string,
  extra: Record<string, unknown> = {},
): Error {
  return Object.assign(new Error(message), extra);
}

// A TypeORM QueryFailedError: pg's error kept as driverError, its code copied.
function queryFailed(code: string, message: string): Error {
  const driverError: Error = errorWith(message, { code: code });

  return errorWith(message, {
    name: "QueryFailedError",
    query: 'UPDATE "OnCallDutyPolicyExecutionLog" SET ...',
    driverError: driverError,
    code: code,
  });
}

function kindOf(error: unknown): OnCallRunFailureKind {
  return OnCallRunFailure.classify(error);
}

describe("a failure a retry cannot fix", () => {
  test.each([
    [
      "the record a run pages about is gone",
      new BadDataException("Incident not found"),
    ],
    [
      "a deleted escalation rule",
      new BadDataException(
        "The escalation rule 1 no longer exists. It may have been deleted.",
      ),
    ],
    [
      "a record found gone as a page is sent",
      new OnCallPageRecordGoneException("alert"),
    ],
    [
      "bad data with its details",
      new BadDataExceptionWithDetails("Invalid userNotificationEventType", {}),
    ],
    ["something not found", new NotFoundException("Policy not found")],
  ])("is permanent: %s", (_name: string, error: Error) => {
    expect(kindOf(error)).toBe(OnCallRunFailureKind.Permanent);
    expect(OnCallRunFailure.isRetryable(kindOf(error))).toBe(false);
  });

  test("OneUptime's own judgement wins over words that look transient", () => {
    expect(
      kindOf(new BadDataException("Connection terminated unexpectedly")),
    ).toBe(OnCallRunFailureKind.Permanent);
  });
});

describe("a failure of the database, the network or the queue", () => {
  test.each([
    // pg and its pool.
    [
      "pg: a connection that broke",
      new Error("Connection terminated unexpectedly"),
    ],
    [
      "pg: a connection that timed out",
      new Error("Connection terminated due to connection timeout"),
    ],
    [
      "pg-pool: no connection in time",
      new Error("timeout exceeded when trying to connect"),
    ],
    [
      "pg: a client that is not queryable",
      new Error(
        "Client has encountered a connection error and is not queryable",
      ),
    ],
    [
      "pg-pool: the pool shutting down",
      new Error("Cannot use a pool after calling end on the pool"),
    ],
    ["pg: its own query timeout", new Error("Query read timeout")],
    [
      "TypeORM: a query runner released under it",
      new Error("Query runner already released. Cannot run queries anymore."),
    ],
    // Postgres, by SQLSTATE, as TypeORM wraps it.
    [
      "Postgres 57P01: shut down by an administrator",
      queryFailed(
        "57P01",
        "terminating connection due to administrator command",
      ),
    ],
    [
      "Postgres 57P03: starting up",
      queryFailed("57P03", "the database system is starting up"),
    ],
    [
      "Postgres 53300: too many connections",
      queryFailed("53300", "sorry, too many clients already"),
    ],
    [
      "Postgres 53300: slots reserved",
      queryFailed(
        "53300",
        "remaining connection slots are reserved for non-replication superuser connections",
      ),
    ],
    [
      "Postgres 08006: a connection failure",
      queryFailed("08006", "connection failure"),
    ],
    [
      "Postgres 57014: a statement timeout",
      queryFailed("57014", "canceling statement due to statement timeout"),
    ],
    [
      "Postgres 55P03: a lock timeout",
      queryFailed("55P03", "canceling statement due to lock timeout"),
    ],
    ["Postgres 40P01: a deadlock", queryFailed("40P01", "deadlock detected")],
    [
      "Postgres 40001: a serialization failure",
      queryFailed(
        "40001",
        "could not serialize access due to concurrent update",
      ),
    ],
    // Node's sockets.
    [
      "a connection reset",
      errorWith("read ECONNRESET", { code: "ECONNRESET", syscall: "read" }),
    ],
    [
      "a connection refused",
      errorWith("connect ECONNREFUSED 10.0.0.5:5432", {
        code: "ECONNREFUSED",
        syscall: "connect",
      }),
    ],
    [
      "a connect that timed out",
      errorWith("connect ETIMEDOUT", { code: "ETIMEDOUT" }),
    ],
    ["a broken pipe", errorWith("write EPIPE", { code: "EPIPE" })],
    [
      "a name that did not resolve, for now",
      errorWith("getaddrinfo EAI_AGAIN postgres", { code: "EAI_AGAIN" }),
    ],
    [
      "a host unreachable",
      errorWith("connect EHOSTUNREACH", { code: "EHOSTUNREACH" }),
    ],
    ["a socket hung up", new Error("socket hang up")],
    // ioredis, under the queue and the cache.
    ["ioredis: a closed connection", new Error("Connection is closed.")],
    [
      "ioredis: its retries used up",
      errorWith(
        'Reached the max retries per request limit (which is 20). Refer to "maxRetriesPerRequest" option for details.',
        { name: "MaxRetriesPerRequestError" },
      ),
    ],
    [
      "ioredis: an offline queue",
      new Error(
        "Stream isn't writeable and enableOfflineQueue options is false",
      ),
    ],
    // OneUptime's own.
    ["the database not connected", new DatabaseNotConnectedException()],
    [
      "the cache not connected",
      new DatabaseNotConnectedException("Cache is not connected"),
    ],
    ["a timeout", new TimeoutException("The job ran out of its time limit.")],
    ["a query timeout", new QueryTimeoutException("The read took too long.")],
    [
      "a service unavailable",
      new ServiceUnavailableException("Try again later."),
    ],
    ["too many requests", new TooManyRequestsException("Slow down.")],
    ["a server out of reach", new UnableToReachServer("No answer.")],
  ])("is transient: %s", (_name: string, error: Error) => {
    expect(kindOf(error)).toBe(OnCallRunFailureKind.Transient);
    expect(OnCallRunFailure.isRetryable(kindOf(error))).toBe(true);
  });

  test("a code in lower case or with spaces round it reads the same", () => {
    expect(kindOf(errorWith("reset", { code: " econnreset " }))).toBe(
      OnCallRunFailureKind.Transient,
    );
  });

  test("a code of a transient SQLSTATE class it does not list reads as one", () => {
    // 08001: the client could not open a connection; 53200: out of memory.
    expect(kindOf(errorWith("x", { code: "08001" }))).toBe(
      OnCallRunFailureKind.Transient,
    );
    expect(kindOf(errorWith("x", { code: "53200" }))).toBe(
      OnCallRunFailureKind.Transient,
    );
  });

  test("is found inside what it is wrapped in", () => {
    const reset: Error = errorWith("read ECONNRESET", { code: "ECONNRESET" });

    // An error's cause.
    expect(
      kindOf(errorWith("Could not page the rule.", { cause: reset })),
    ).toBe(OnCallRunFailureKind.Transient);
    // A driver error with no code on the wrapper.
    expect(kindOf(errorWith("query failed", { driverError: reset }))).toBe(
      OnCallRunFailureKind.Transient,
    );
    // An original error.
    expect(kindOf(errorWith("wrapped", { originalError: reset }))).toBe(
      OnCallRunFailureKind.Transient,
    );
    // Node trying each address of a name: an AggregateError of the attempts.
    expect(
      kindOf(
        errorWith("", {
          name: "AggregateError",
          errors: [
            errorWith("connect ECONNREFUSED ::1:5432", {
              code: "ECONNREFUSED",
            }),
            errorWith("connect ECONNREFUSED 127.0.0.1:5432", {
              code: "ECONNREFUSED",
            }),
          ],
        }),
      ),
    ).toBe(OnCallRunFailureKind.Transient);
  });

  test("is not looked for past a few wrappers, nor round a loop", () => {
    let deep: Error = errorWith("read ECONNRESET", { code: "ECONNRESET" });

    for (let level: number = 0; level < 10; level++) {
      deep = errorWith(`level ${level}`, { cause: deep });
    }

    expect(kindOf(deep)).toBe(OnCallRunFailureKind.Unrecognized);

    const loop: Error = new Error("a cause of itself");
    (loop as unknown as { cause: unknown }).cause = loop;

    expect(kindOf(loop)).toBe(OnCallRunFailureKind.Unrecognized);
  });
});

describe("a failure not recognised", () => {
  test.each([
    [
      "a bug",
      new TypeError("Cannot read properties of undefined (reading 'id')"),
    ],
    ["a plain error", new Error("Something else went wrong.")],
    [
      "a unique violation, which a retry finds again",
      queryFailed(
        "23505",
        'duplicate key value violates unique constraint "x"',
      ),
    ],
    ["a bad uuid", queryFailed("22P02", "invalid input syntax for type uuid")],
    ["a thrown string", "Database is down"],
    ["nothing", null],
    ["undefined", undefined],
    ["a number", 42],
    ["an empty object", {}],
  ])("is tried again, bounded: %s", (_name: string, error: unknown) => {
    expect(kindOf(error)).toBe(OnCallRunFailureKind.Unrecognized);
    expect(OnCallRunFailure.isRetryable(kindOf(error))).toBe(true);
  });

  test("a number code, as OneUptime's own exceptions carry, is not read as a socket's", () => {
    expect(kindOf(errorWith("x", { code: 500 }))).toBe(
      OnCallRunFailureKind.Unrecognized,
    );
  });
});

describe("what a failure is described as", () => {
  test("its message, on one line", () => {
    expect(
      OnCallRunFailure.describe(
        new Error("Connection terminated\n   unexpectedly  "),
      ),
    ).toBe("Connection terminated unexpectedly");
  });

  test("its code, when it has no message", () => {
    expect(
      OnCallRunFailure.describe(errorWith("", { code: "ECONNRESET" })),
    ).toBe("ECONNRESET");
  });

  test("a thrown string as it is", () => {
    expect(OnCallRunFailure.describe("Database is down")).toBe(
      "Database is down",
    );
  });

  test("something with nothing to say, in a sentence", () => {
    for (const nothing of [null, undefined, {}, new Error("")]) {
      expect(OnCallRunFailure.describe(nothing)).toBe(
        "An error with no message.",
      );
    }
  });
});
