import BadDataException from "../../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ServiceUnavailableException from "../../../Types/Exception/ServiceUnavailableException";
import TimeoutException from "../../../Types/Exception/TimeoutException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import UnableToReachServer from "../../../Types/Exception/UnableToReachServer";

/*
 * WHETHER A STEP OF AN ON-CALL RUN THAT FAILED IS WORTH TRYING AGAIN
 * (issue #8167).
 *
 * The worker that moves on-call policy runs on
 * (OnCallDutyPolicyExecutionLog:ExecutePendingExecutions) ended a run in
 * Error on any error, and Error is final: a connection reset while it paged
 * the next escalation rule meant no later rule was ever paged - most likely
 * in an alert storm, when the database is busiest. A failure is one of:
 *
 *   - PERMANENT: a retry finds the same thing. The record the run pages
 *     about is gone, an escalation rule was deleted, the run's data is bad
 *     (BadDataException, NotFoundException). The run ends now, saying why.
 *   - TRANSIENT: the database, the network or the queue failed for a
 *     moment - a connection reset or refused, a pool or statement timeout,
 *     a database that is starting up or shutting down, a deadlock, Redis
 *     that went away. Tried again, a little later.
 *   - UNRECOGNIZED: anything else. Tried again too, as a transient failure
 *     is - a page that comes late beats one that is dropped - and the tries
 *     are bounded (OnCallPolicyRunRetry), so a failure that is really a bug
 *     ends the run in Error once they run out, rather than every minute,
 *     forever (#8106).
 *
 * Read from the error and what it wraps: a TypeORM QueryFailedError's
 * driverError, an error's cause, an AggregateError's errors - each with the
 * code Postgres or Node gives it, or the words pg, its pool and ioredis
 * write when a connection is lost.
 */

export enum OnCallRunFailureKind {
  Permanent = "Permanent",
  Transient = "Transient",
  Unrecognized = "Unrecognized",
}

/*
 * Node's codes for a socket or a name lookup that failed: the network, or a
 * server that is not answering.
 */
const NETWORK_ERROR_CODES: ReadonlyArray<string> = [
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "EHOSTDOWN",
  "ENETUNREACH",
  "ENETDOWN",
  "ENETRESET",
  "EADDRNOTAVAIL",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
];

/*
 * Postgres's SQLSTATE classes a retry can outlast: a connection lost or
 * refused (08), and a server short of connections, memory or disk (53).
 */
const TRANSIENT_POSTGRES_CODE_CLASSES: ReadonlyArray<string> = ["08", "53"];

/*
 * And single SQLSTATEs: a server shutting down, crashed or starting up
 * (57P01 to 57P03), a statement cancelled at its time limit (57014), a lock
 * not taken in time (55P03), a deadlock (40P01), a serialization failure
 * (40001), and an I/O error on the server (58030).
 */
const TRANSIENT_POSTGRES_CODES: ReadonlyArray<string> = [
  "57P01",
  "57P02",
  "57P03",
  "57014",
  "55P03",
  "40P01",
  "40001",
  "58030",
];

/*
 * What the database client, its pool, TypeORM and ioredis write when a
 * connection is lost or cannot be had, where there is no code to read.
 */
const TRANSIENT_MESSAGES: ReadonlyArray<RegExp> = [
  // pg: "Connection terminated unexpectedly", "... due to connection timeout".
  /connection terminated/i,
  // pg-pool, waiting for a connection.
  /timeout exceeded when trying to connect/i,
  /connection timeout/i,
  // pg, a client whose connection broke.
  /client has encountered a connection error/i,
  // pg-pool, while the process shuts down.
  /cannot use a pool after calling end/i,
  // pg's own query timeout.
  /query read timeout/i,
  // TypeORM, a query runner whose connection was released under it.
  /query runner already released/i,
  // ioredis: a connection closed, an offline queue, its retries used up.
  /connection is closed/i,
  /stream isn't writeable/i,
  /reached the max retries per request limit/i,
  /socket hang up/i,
  // Postgres's words for the SQLSTATEs above.
  /too many clients/i,
  /remaining connection slots are reserved/i,
  /the database system is (starting up|shutting down|in recovery mode)/i,
  /terminating connection due to/i,
  /canceling statement due to (statement|lock) timeout/i,
  /could not serialize access/i,
  /deadlock detected/i,
  /could not obtain lock/i,
];

// A Postgres SQLSTATE: five characters, its class the first two.
const SQLSTATE: RegExp = /^[0-9A-Z]{5}$/;

// How far into what an error wraps it is read.
const MAX_DEPTH: number = 4;

interface ErrorShape {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
  driverError?: unknown;
  originalError?: unknown;
  errors?: unknown;
}

export default class OnCallRunFailure {
  public static classify(error: unknown): OnCallRunFailureKind {
    if (this.isPermanent(error)) {
      return OnCallRunFailureKind.Permanent;
    }

    if (this.isTransient(error, 0)) {
      return OnCallRunFailureKind.Transient;
    }

    return OnCallRunFailureKind.Unrecognized;
  }

  // Whether a run whose step failed so is tried again.
  public static isRetryable(kind: OnCallRunFailureKind): boolean {
    return kind !== OnCallRunFailureKind.Permanent;
  }

  /*
   * What a step failed with, in a line: the error's own message, or its
   * code, or what it was. For a run's status message and the worker's log.
   */
  public static describe(error: unknown): string {
    const shape: ErrorShape | null =
      error && typeof error === "object" ? (error as ErrorShape) : null;
    const message: string =
      typeof shape?.message === "string"
        ? shape.message
        : typeof error === "string"
          ? error
          : "";
    const oneLine: string = message.replace(/\s+/g, " ").trim();

    if (oneLine) {
      return oneLine;
    }

    if (typeof shape?.code === "string" && shape.code.trim()) {
      return shape.code.trim();
    }

    return "An error with no message.";
  }

  /*
   * A retry finds the same thing: what OneUptime throws for data that is
   * not there or not right. Read on the error itself only - a transient
   * failure is never wrapped in one.
   */
  private static isPermanent(error: unknown): boolean {
    return (
      error instanceof BadDataException || error instanceof NotFoundException
    );
  }

  private static isTransient(error: unknown, depth: number): boolean {
    if (!error || typeof error !== "object" || depth > MAX_DEPTH) {
      return false;
    }

    if (
      error instanceof DatabaseNotConnectedException ||
      error instanceof TimeoutException ||
      error instanceof ServiceUnavailableException ||
      error instanceof TooManyRequestsException ||
      error instanceof UnableToReachServer
    ) {
      return true;
    }

    const shape: ErrorShape = error as ErrorShape;

    if (this.isTransientCode(shape.code)) {
      return true;
    }

    if (
      typeof shape.message === "string" &&
      TRANSIENT_MESSAGES.some((pattern: RegExp): boolean => {
        return pattern.test(shape.message as string);
      })
    ) {
      return true;
    }

    for (const wrapped of [
      shape.driverError,
      shape.cause,
      shape.originalError,
    ]) {
      if (
        wrapped &&
        wrapped !== error &&
        this.isTransient(wrapped, depth + 1)
      ) {
        return true;
      }
    }

    // An AggregateError: Node trying each address of a name, say.
    if (Array.isArray(shape.errors) && shape.errors.length > 0) {
      return shape.errors.some((attempt: unknown): boolean => {
        return this.isTransient(attempt, depth + 1);
      });
    }

    return false;
  }

  private static isTransientCode(code: unknown): boolean {
    if (typeof code !== "string") {
      return false;
    }

    const value: string = code.trim().toUpperCase();

    if (!value) {
      return false;
    }

    if (NETWORK_ERROR_CODES.includes(value)) {
      return true;
    }

    if (TRANSIENT_POSTGRES_CODES.includes(value)) {
      return true;
    }

    // A five-character SQLSTATE of a transient class: 08006, 53300 ...
    return (
      SQLSTATE.test(value) &&
      TRANSIENT_POSTGRES_CODE_CLASSES.includes(value.slice(0, 2))
    );
  }
}
