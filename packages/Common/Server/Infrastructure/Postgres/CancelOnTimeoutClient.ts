import logger from "../../Utils/Logger";
import net from "net";
import { Client, ClientConfig, Query } from "pg";

/*
 * A STATEMENT THE APP STOPS WAITING FOR IS STOPPED ON THE DATABASE TOO, AND
 * ITS CONNECTION IS NEVER HANDED OUT AGAIN.
 *
 * The node-postgres client the app's pools open their connections with
 * (DataSourceOptions `extra.Client`: the runtime pool, and the schema
 * migration runner's and the migration failure diagnosis', which are built
 * from the same options).
 *
 * node-postgres' own client-side query timeout (`query_timeout`,
 * DATABASE_QUERY_TIMEOUT_MS) only stops waiting: the statement runs on in
 * the database, holding its locks, and may still be applied after the app
 * reported it failed. Inside save() - every create - it was worse: TypeORM's
 * ROLLBACK waited behind the statement still running, ran out of time as
 * well and was dropped unsent, and the connection went back to the pool
 * with the transaction open. The next request to borrow it ran START
 * TRANSACTION and COMMIT, and committed the write the first request had been
 * told failed. Nothing bounds such a statement where the database enforces
 * no statement timeout of its own: behind PgBouncer, which drops the
 * statement_timeout the app asks for at connect (HelmChart/Docs/Postgres.md).
 *
 * This client keeps the same timeout - the pool's `query_timeout`, or a
 * statement's own - and acts on it:
 *
 *   - a statement still waiting in this connection's own queue is taken out
 *     of it, never sent, and fails with the timeout, as before - marked as
 *     never sent (StatementNotSentError);
 *   - a statement sent and not yet answered is cancelled on the database:
 *     the protocol's cancel request for this connection (what psql sends on
 *     Ctrl-C), which PgBouncer passes on to the server connection the
 *     statement runs on. The connection takes no further statement
 *     (StatementNotSentError), and the caller waits a little longer for the
 *     database's answer (CANCEL_ANSWER_WAIT_IN_MS);
 *   - that answer is handed on as it is: almost always the database saying
 *     it cancelled the statement (SQLSTATE 57014), which applied nothing,
 *     or - had the statement finished in the moment before the cancel came -
 *     its result. When no answer comes in that time (the cancel could not
 *     reach the database, or the connection is gone) the caller is told the
 *     read timed out ("Query read timeout"), and the statement may still be
 *     applied (StatementOutcome);
 *   - either way the connection is then closed and never handed to another
 *     request: a transaction it held open is rolled back by the database
 *     when the connection goes, so nobody can commit it.
 *
 * Streams and cursors (query objects of their own) run as node-postgres
 * runs them, without a timeout; the app uses none.
 */

/*
 * How long a caller waits for the database's answer once its statement is
 * being cancelled - the cancel request's round trip, the statement
 * stopping, and its answer - counted from the client-side timeout.
 */
export const CANCEL_ANSWER_WAIT_IN_MS: number = 5_000;

/*
 * The longest a caller waits for one statement on this client: its timeout,
 * and then the answer to the cancel. A timeout that is not a positive
 * number bounds nothing, and is answered as it is.
 */
export const getLongestStatementWaitInMs: (queryTimeoutMs: number) => number = (
  queryTimeoutMs: number,
): number => {
  if (!Number.isFinite(queryTimeoutMs) || queryTimeoutMs <= 0) {
    return queryTimeoutMs;
  }

  return queryTimeoutMs + CANCEL_ANSWER_WAIT_IN_MS;
};

// What a caller is told when no answer came, in node-postgres' own words.
export const QUERY_READ_TIMEOUT_MESSAGE: string = "Query read timeout";

/*
 * A statement that failed before it was sent: refused because its
 * connection is being closed - an earlier statement on it ran past its
 * timeout - or timed out still waiting in its connection's own queue (told
 * in node-postgres' words, QUERY_READ_TIMEOUT_MESSAGE). It applied nothing
 * (StatementOutcome).
 */
export class StatementNotSentError extends Error {
  public readonly isStatementNotSent: boolean = true;

  public constructor(message?: string | undefined) {
    super(
      message ||
        "The statement was not sent: its database connection is being closed because an earlier statement on it ran past its timeout.",
    );
    this.name = "StatementNotSentError";
  }
}

// What came of a cancel request.
export enum CancelRequestOutcome {
  // Sent, and the database (or the pooler) closed the connection once it read it.
  Delivered = "Delivered",
  // The connection it needs could not be opened, or failed before it was sent.
  Failed = "Failed",
  // Not done in time.
  TimedOut = "TimedOut",
  // The connection never told its key (BackendKeyData), so none can be sent.
  NoKey = "NoKey",
}

// The options a pool hands each client: node-postgres' own, and its own.
export type CancelOnTimeoutClientConfig = ClientConfig &
  Record<string, unknown>;

type QueryCallback = (
  error: Error | null | undefined,
  result?: unknown,
) => void;

// The node-postgres internals this client works with (pg 8, lib/client.js).
interface ClientInternals {
  activeQuery: unknown;
  queryQueue: Array<unknown>;
  processID: number | null;
  secretKey: number | null;
  connection: unknown;
  host: string;
  port: number;
  _pulseQueryQueue: () => void;
}

// A query object node-postgres runs (lib/query.js), as this client uses it.
interface QueryInternals {
  callback?: QueryCallback | undefined;
  submit?: unknown;
  handleError?: ((error: Error, connection: unknown) => void) | undefined;
}

// The protocol's CancelRequest code: 1234 in the high 16 bits, 5678 in the low.
const CANCEL_REQUEST_CODE: number = 80877102;

// What answered a statement once it was being cancelled.
interface CancelledStatementAnswer {
  error: Error | null | undefined;
  result: unknown;
}

export default class CancelOnTimeoutClient extends Client {
  // The pool's `query_timeout`, kept here instead of handed to node-postgres.
  private readonly defaultQueryTimeoutInMs: number;

  // A statement on this connection ran past its timeout: it takes no more.
  private closingAfterTimeout: boolean = false;

  public constructor(config?: string | CancelOnTimeoutClientConfig) {
    super(CancelOnTimeoutClient.withoutQueryTimeout(config));
    this.defaultQueryTimeoutInMs = CancelOnTimeoutClient.timeoutOf(config, 0);
  }

  // Whether a statement on this connection ran past its timeout.
  public get isClosingAfterTimeout(): boolean {
    return this.closingAfterTimeout;
  }

  /*
   * node-postgres' query(), held to the timeout this client keeps. Every
   * calling convention node-postgres takes - text or config, values,
   * callback or promise - is kept.
   */
  public override query(...args: Array<any>): any {
    const config: unknown = args[0];

    // Streams, cursors: a query object of its own, run as node-postgres runs it.
    if (
      config === null ||
      config === undefined ||
      typeof (config as QueryInternals).submit === "function"
    ) {
      if (config && this.closingAfterTimeout) {
        return this.refuseSubmittable(config as QueryInternals);
      }

      return (super.query as (...queryArgs: Array<any>) => any).apply(
        this,
        args,
      );
    }

    const timeoutInMs: number = CancelOnTimeoutClient.timeoutOf(
      config as string | CancelOnTimeoutClientConfig,
      this.defaultQueryTimeoutInMs,
    );

    const query: Query = new Query(
      CancelOnTimeoutClient.withoutQueryTimeout(
        config as string | CancelOnTimeoutClientConfig,
      ) as any,
      args[1],
      args[2],
    );
    const queryInternals: QueryInternals = query as unknown as QueryInternals;

    let result: Promise<unknown> | undefined = undefined;

    if (!queryInternals.callback) {
      result = new Promise<unknown>(
        (
          resolve: (value: unknown) => void,
          reject: (reason: Error) => void,
        ): void => {
          queryInternals.callback = (
            error: Error | null | undefined,
            answer?: unknown,
          ): void => {
            if (error) {
              reject(error);
              return;
            }

            resolve(answer);
          };
        },
      ).catch((error: Error) => {
        // A stack that leads back to the caller, as node-postgres gives one.
        Error.captureStackTrace(error);
        throw error;
      });
    }

    if (this.closingAfterTimeout) {
      const refuse: QueryCallback = queryInternals.callback!;

      process.nextTick(() => {
        refuse(new StatementNotSentError());
      });

      return result;
    }

    if (timeoutInMs > 0) {
      this.watch(query, timeoutInMs);
    }

    super.query(query);

    return result;
  }

  /*
   * Sends the protocol's cancel request for this connection, on a
   * connection of its own, and waits - at most `waitInMs` - for the
   * database (or PgBouncer) to close that connection once it has read it.
   * Never throws.
   */
  protected sendCancelRequest(waitInMs: number): Promise<CancelRequestOutcome> {
    const internals: ClientInternals = this as unknown as ClientInternals;
    const processID: number | null = internals.processID;
    const secretKey: number | null = internals.secretKey;

    if (typeof processID !== "number" || typeof secretKey !== "number") {
      return Promise.resolve(CancelRequestOutcome.NoKey);
    }

    // Length, code, and the connection's key: four big-endian 32-bit numbers.
    const request: Uint8Array = new Uint8Array(16);
    const fields: DataView = new DataView(request.buffer);
    fields.setInt32(0, 16);
    fields.setInt32(4, CANCEL_REQUEST_CODE);
    fields.setInt32(8, processID);
    fields.setInt32(12, secretKey);

    return new Promise<CancelRequestOutcome>(
      (resolve: (outcome: CancelRequestOutcome) => void): void => {
        let isDone: boolean = false;
        let isSent: boolean = false;
        let timer: ReturnType<typeof setTimeout> | undefined = undefined;
        let socket: net.Socket | undefined = undefined;

        const finish: (outcome: CancelRequestOutcome) => void = (
          outcome: CancelRequestOutcome,
        ): void => {
          if (isDone) {
            return;
          }

          isDone = true;
          clearTimeout(timer);
          socket?.destroy();
          resolve(outcome);
        };

        const sentOrFailed: () => void = (): void => {
          finish(
            isSent
              ? CancelRequestOutcome.Delivered
              : CancelRequestOutcome.Failed,
          );
        };

        timer = setTimeout(() => {
          finish(CancelRequestOutcome.TimedOut);
        }, waitInMs);

        try {
          // A host that is a directory is a unix socket's, as node-postgres reads it.
          socket =
            typeof internals.host === "string" && internals.host.startsWith("/")
              ? net.connect({
                  path: `${internals.host}/.s.PGSQL.${internals.port}`,
                })
              : net.connect({ host: internals.host, port: internals.port });
        } catch {
          finish(CancelRequestOutcome.Failed);
          return;
        }

        const cancelSocket: net.Socket = socket;

        cancelSocket.setNoDelay(true);

        cancelSocket.once("connect", () => {
          cancelSocket.write(request, () => {
            isSent = true;
          });
        });

        // The other end reads the request and closes: it was delivered.
        cancelSocket.once("error", sentOrFailed);
        cancelSocket.once("close", sentOrFailed);
      },
    );
  }

  // How long a caller waits for the answer once its statement is being cancelled.
  protected getCancelAnswerWaitInMs(): number {
    return CANCEL_ANSWER_WAIT_IN_MS;
  }

  // A stream or cursor handed in while the connection is being closed: refused.
  private refuseSubmittable(submittable: QueryInternals): QueryInternals {
    process.nextTick(() => {
      submittable.handleError?.(
        new StatementNotSentError(),
        (this as unknown as ClientInternals).connection,
      );
    });

    return submittable;
  }

  /*
   * Holds a query to its timeout: its answer reaches the caller as it
   * comes, unless the timeout comes first (cancelAfterTimeout).
   */
  private watch(query: Query, timeoutInMs: number): void {
    const queryInternals: QueryInternals = query as unknown as QueryInternals;
    const deliver: QueryCallback = queryInternals.callback!;

    let isSettled: boolean = false;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    // Once the timeout has come: what the statement's answer is handed to.
    let onAnswerAfterTimeout: QueryCallback | null = null;

    const settle: QueryCallback = (
      error: Error | null | undefined,
      answer?: unknown,
    ): void => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      clearTimeout(timer);

      try {
        deliver(error, answer);
      } catch (callbackError) {
        // A caller's callback that throws must not leave this client half way.
        process.nextTick(() => {
          throw callbackError;
        });
      }
    };

    queryInternals.callback = (
      error: Error | null | undefined,
      answer?: unknown,
    ): void => {
      if (onAnswerAfterTimeout) {
        onAnswerAfterTimeout(error, answer);
        return;
      }

      settle(error, answer);
    };

    timer = setTimeout(() => {
      if (isSettled) {
        return;
      }

      const internals: ClientInternals = this as unknown as ClientInternals;
      const queuedAt: number = internals.queryQueue.indexOf(query);

      // Never sent: out of the queue, and failed, as node-postgres does.
      if (queuedAt >= 0) {
        internals.queryQueue.splice(queuedAt, 1);
        settle(new StatementNotSentError(QUERY_READ_TIMEOUT_MESSAGE));
        internals._pulseQueryQueue();
        return;
      }

      // Not running either: whatever happened to it, it is not answered.
      if (internals.activeQuery !== query) {
        settle(new Error(QUERY_READ_TIMEOUT_MESSAGE));
        return;
      }

      onAnswerAfterTimeout = this.cancelAfterTimeout(timeoutInMs, settle);
    }, timeoutInMs);
  }

  /*
   * The statement this connection is running ran past its timeout: the
   * connection takes no more statements, the statement is cancelled on the
   * database, and once the connection is being closed the caller is handed
   * the database's answer - or, if none came in time, the timeout. Answers
   * what the statement's answer is to be handed to.
   */
  private cancelAfterTimeout(
    timeoutInMs: number,
    settle: QueryCallback,
  ): QueryCallback {
    this.closingAfterTimeout = true;

    const waitInMs: number = this.getCancelAnswerWaitInMs();
    let isFinished: boolean = false;
    let cancelOutcome: CancelRequestOutcome | null = null;
    let answerTimer: ReturnType<typeof setTimeout> | undefined = undefined;

    logger.warn(
      `A database statement ran past its ${timeoutInMs} ms timeout (DATABASE_QUERY_TIMEOUT_MS). It is being cancelled on the database, and its connection will be closed.`,
    );

    const finish: (answer: CancelledStatementAnswer | null) => void = (
      answer: CancelledStatementAnswer | null,
    ): void => {
      if (isFinished) {
        return;
      }

      isFinished = true;
      clearTimeout(answerTimer);

      if (!answer) {
        logger.warn(
          `The database did not answer a statement within ${waitInMs} ms of its cancel (cancel request: ${
            cancelOutcome || "still under way"
          }). Its connection was closed; the statement may still be applied.`,
        );
      }

      /*
       * Closing before the caller is told: no pool takes back a connection
       * that is being closed (node-postgres' _ending), however soon the
       * caller gives it back.
       */
      this.end().catch((error: unknown) => {
        logger.warn("Could not close a database connection after a timeout.");
        logger.warn(error);
      });

      if (answer) {
        settle(answer.error, answer.result);
        return;
      }

      settle(new Error(QUERY_READ_TIMEOUT_MESSAGE));
    };

    answerTimer = setTimeout(() => {
      finish(null);
    }, waitInMs);

    this.sendCancelRequest(waitInMs)
      .then((outcome: CancelRequestOutcome) => {
        cancelOutcome = outcome;
      })
      .catch(() => {
        cancelOutcome = CancelRequestOutcome.Failed;
      });

    return (error: Error | null | undefined, answer?: unknown): void => {
      // The database answered: the result, or an error of its own.
      if (!error || CancelOnTimeoutClient.isDatabaseAnswer(error)) {
        finish({ error, result: answer });
        return;
      }

      // The connection failed: that is no answer.
      finish(null);
    };
  }

  /*
   * An answer the database itself sent: node-postgres' DatabaseError, which
   * always carries the severity and the SQLSTATE.
   */
  private static isDatabaseAnswer(error: unknown): boolean {
    if (!error || typeof error !== "object") {
      return false;
    }

    const record: Record<string, unknown> = error as Record<string, unknown>;

    return (
      typeof record["severity"] === "string" &&
      typeof record["code"] === "string"
    );
  }

  /*
   * The timeout in options or a statement's config, as node-postgres reads
   * one (a positive number), or `fallback`.
   */
  private static timeoutOf(
    config: string | CancelOnTimeoutClientConfig | undefined,
    fallback: number,
  ): number {
    if (!config || typeof config !== "object") {
      return fallback;
    }

    const timeout: unknown = config["query_timeout"];

    return typeof timeout === "number" && timeout > 0 ? timeout : fallback;
  }

  /*
   * Options or a config without the timeout node-postgres would keep
   * itself. Copied with every property as it is: the pool hands the
   * password over as a property that is not enumerable, which a spread
   * would drop.
   */
  private static withoutQueryTimeout<
    T extends string | CancelOnTimeoutClientConfig | undefined,
  >(config: T): T {
    if (!config || typeof config !== "object") {
      return config;
    }

    const rest: Record<string, unknown> = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(config),
    );
    delete rest["query_timeout"];

    return rest as unknown as T;
  }
}
