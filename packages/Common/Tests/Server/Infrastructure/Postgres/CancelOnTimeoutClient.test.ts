import CancelOnTimeoutClient, {
  CANCEL_ANSWER_WAIT_IN_MS,
  CancelOnTimeoutClientConfig,
  CancelRequestOutcome,
  QUERY_READ_TIMEOUT_MESSAGE,
  StatementNotSentError,
  getLongestStatementWaitInMs,
} from "../../../../Server/Infrastructure/Postgres/CancelOnTimeoutClient";
import logger from "../../../../Server/Utils/Logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { EventEmitter } from "events";
import net from "net";
import { DatabaseError, Pool, PoolClient, QueryResult } from "pg";

/*
 * CancelOnTimeoutClient on its own, against a stand-in for node-postgres'
 * connection to the database (the wire messages a Client reacts to), and a
 * real socket listening for the cancel request. What it is held to:
 *
 *   - a statement answered in time is answered as node-postgres answers it,
 *     in every calling convention;
 *   - one still waiting in the connection's queue when its time runs out is
 *     never sent, and the connection goes on;
 *   - one sent and unanswered is cancelled with the connection's own key;
 *     its caller gets the database's answer, or - when none comes - the
 *     read timeout; the connection takes no further statement and is
 *     closed, before the caller is told, so no pool takes it back.
 *
 * The real database's side - the statement stopped, the transaction rolled
 * back, nothing left for the next borrower - is AbandonedStatementsPostgres.
 */

// The suites run where setImmediate is not defined: the next turn, by a timer.
const soon: (run: () => void) => void = (run: () => void): void => {
  setTimeout(run, 0);
};

const PROCESS_ID: number = 4242;
const SECRET_KEY: number = -1_234_567;

// The cancel request's code: 1234 in the high 16 bits, 5678 in the low.
const CANCEL_REQUEST_CODE: number = 80877102;

/*
 * The connection a Client talks to the database through: it records what
 * the client sends, and the test answers as the database would.
 */
class FakeConnection extends EventEmitter {
  public parsedStatements: Record<string, string> = {};
  public _connecting: boolean = false;
  // The text of every statement sent, in order.
  public sent: Array<string> = [];
  public closedBy: "terminate" | "destroy" | null = null;
  public backendKey: { processID: number; secretKey: number } | null = {
    processID: PROCESS_ID,
    secretKey: SECRET_KEY,
  };

  public stream: {
    writable: boolean;
    cork: () => void;
    uncork: () => void;
    destroy: () => void;
  } = {
    writable: true,
    cork: (): void => {
      return undefined;
    },
    uncork: (): void => {
      return undefined;
    },
    destroy: (): void => {
      this.close("destroy");
    },
  };

  public connect(): void {
    this._connecting = true;
    soon(() => {
      this.emit("connect");
    });
  }

  public startup(): void {
    soon(() => {
      if (this.backendKey) {
        this.emit("backendKeyData", this.backendKey);
      }

      this.emit("readyForQuery", {});
    });
  }

  public requestSsl(): void {
    return undefined;
  }

  public query(text: string): void {
    this.sent.push(text);
  }

  public parse(config: { text: string }): void {
    this.sent.push(config.text);
  }

  public bind(): void {
    return undefined;
  }

  public describe(): void {
    return undefined;
  }

  public execute(): void {
    return undefined;
  }

  public sync(): void {
    return undefined;
  }

  public flush(): void {
    return undefined;
  }

  public end(): void {
    this.close("terminate");
  }

  // The database's answer: the statement is done.
  public answer(command: string = "UPDATE 1"): void {
    this.emit("commandComplete", { text: command });
    this.emit("readyForQuery", {});
  }

  // The database's answer: an error of its own.
  public answerError(code: string, message: string): void {
    const error: DatabaseError = new DatabaseError(message, 0, "error");
    error.severity = "ERROR";
    error.code = code;

    this.emit("errorMessage", error);
    this.emit("readyForQuery", {});
  }

  private close(how: "terminate" | "destroy"): void {
    if (this.closedBy) {
      return;
    }

    this.closedBy = how;
    this.stream.writable = false;
    soon(() => {
      this.emit("end");
    });
  }
}

/*
 * How long a client in these tests waits for the answer to its cancel. A
 * test that answers the cancel itself has the long wait, so a busy machine
 * cannot run it out before the answer comes; a test that waits for it to
 * run out has the short one.
 */
const ANSWER_WAIT_IN_MS: number = 2000;
const SHORT_ANSWER_WAIT_IN_MS: number = 300;

// A client whose wait for the answer to a cancel is shorter, for these tests.
class QuickCancelClient extends CancelOnTimeoutClient {
  public static answerWaitInMs: number = ANSWER_WAIT_IN_MS;

  public cancelOutcomes: Array<CancelRequestOutcome> = [];

  public sendCancel(waitInMs: number): Promise<CancelRequestOutcome> {
    return this.sendCancelRequest(waitInMs);
  }

  protected override getCancelAnswerWaitInMs(): number {
    return QuickCancelClient.answerWaitInMs;
  }

  protected override async sendCancelRequest(
    waitInMs: number,
  ): Promise<CancelRequestOutcome> {
    const outcome: CancelRequestOutcome = await super.sendCancelRequest(
      waitInMs,
    );
    this.cancelOutcomes.push(outcome);
    return outcome;
  }
}

// Somewhere to receive cancel requests: each one read, then its connection closed.
interface CancelListener {
  port: number;
  requests: Array<Buffer>;
  close: () => Promise<void>;
}

const listenForCancels: (options?: {
  neverClose?: boolean;
}) => Promise<CancelListener> = async (options?: {
  neverClose?: boolean;
}): Promise<CancelListener> => {
  const requests: Array<Buffer> = [];
  const sockets: Array<net.Socket> = [];

  const server: net.Server = net.createServer((socket: net.Socket) => {
    sockets.push(socket);
    socket.once("data", (data: Buffer) => {
      requests.push(data);

      if (!options?.neverClose) {
        socket.end();
      }
    });
  });

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: (server.address() as net.AddressInfo).port,
    requests,
    close: (): Promise<void> => {
      for (const socket of sockets) {
        socket.destroy();
      }

      return new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
};

// A port nothing listens on.
const closedPort: () => Promise<number> = async (): Promise<number> => {
  const server: net.Server = net.createServer();

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const port: number = (server.address() as net.AddressInfo).port;

  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });

  return port;
};

const sleep: (ms: number) => Promise<void> = (ms: number): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
};

// Waits until `check` holds, for at most a second.
const eventually: (check: () => boolean) => Promise<void> = async (
  check: () => boolean,
): Promise<void> => {
  for (let attempt: number = 0; attempt < 100 && !check(); attempt++) {
    await sleep(10);
  }

  expect(check()).toBe(true);
};

const failureOf: (run: Promise<unknown>) => Promise<unknown> = async (
  run: Promise<unknown>,
): Promise<unknown> => {
  try {
    await run;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the statement to fail.");
};

describe("CancelOnTimeoutClient", () => {
  let listener: CancelListener;
  let connection: FakeConnection;
  const clients: Array<CancelOnTimeoutClient> = [];

  // A client on the stand-in connection, sending cancels to the listener.
  const connectedClient: (
    config?: Record<string, unknown>,
  ) => Promise<QuickCancelClient> = async (
    config?: Record<string, unknown>,
  ): Promise<QuickCancelClient> => {
    const client: QuickCancelClient = new QuickCancelClient({
      host: "127.0.0.1",
      port: listener.port,
      user: "postgres",
      database: "oneuptimedb",
      connection: connection as unknown,
      query_timeout: 100,
      ...(config || {}),
    } as CancelOnTimeoutClientConfig);

    // A failing connection is reported as an event too.
    client.on("error", () => {
      return undefined;
    });

    clients.push(client);
    await client.connect();
    return client;
  };

  beforeEach(async () => {
    QuickCancelClient.answerWaitInMs = ANSWER_WAIT_IN_MS;
    listener = await listenForCancels();
    connection = new FakeConnection();

    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      await client.end().catch(() => {
        return undefined;
      });
    }

    await listener.close();
    jest.restoreAllMocks();
  });

  describe("a statement answered in time", () => {
    test("is answered as node-postgres answers it, with a promise", async () => {
      const client: QuickCancelClient = await connectedClient({
        query_timeout: 1000,
      });

      const running: Promise<QueryResult> = client.query(
        'UPDATE "Project" SET "name" = $1',
        ["Acme"],
      );

      await eventually(() => {
        return connection.sent.length === 1;
      });
      connection.answer("UPDATE 3");

      const result: QueryResult = await running;

      expect(result.rowCount).toBe(3);
      expect(result.command).toBe("UPDATE");
      expect(client.isClosingAfterTimeout).toBe(false);
      expect(listener.requests).toEqual([]);
      expect(connection.closedBy).toBeNull();
    });

    test("is answered to a callback, given after the values or in place of them", async () => {
      const client: QuickCancelClient = await connectedClient({
        query_timeout: 1000,
      });

      const answers: Array<unknown> = [];

      client.query(
        "UPDATE one",
        ["value"],
        (error: Error, result: QueryResult): void => {
          answers.push(error || result.rowCount);
        },
      );
      client.query("UPDATE two", (error: Error, result: QueryResult): void => {
        answers.push(error || result.rowCount);
      });

      await eventually(() => {
        return connection.sent.length === 1;
      });
      connection.answer("UPDATE 1");
      await eventually(() => {
        return connection.sent.length === 2;
      });
      connection.answer("UPDATE 2");

      await eventually(() => {
        return answers.length === 2;
      });
      expect(answers).toEqual([1, 2]);
    });

    test("a database error that comes in time is handed on as it came, and the connection goes on", async () => {
      const client: QuickCancelClient = await connectedClient({
        query_timeout: 1000,
      });

      const running: Promise<unknown> = failureOf(
        client.query("INSERT INTO taken"),
      );

      await eventually(() => {
        return connection.sent.length === 1;
      });
      connection.answerError("23505", "duplicate key value");

      const failure: unknown = await running;

      expect((failure as DatabaseError).code).toBe("23505");
      expect(client.isClosingAfterTimeout).toBe(false);
      expect(connection.closedBy).toBeNull();
    });
  });

  describe("a statement still queued when its time runs out", () => {
    test("is never sent, fails with the timeout, and the connection goes on", async () => {
      const client: QuickCancelClient = await connectedClient({
        query_timeout: 5000,
      });

      const first: Promise<QueryResult> = client.query("UPDATE first");
      const second: Promise<unknown> = failureOf(
        client.query({ text: "UPDATE second", query_timeout: 50 } as never),
      );

      const failure: unknown = await second;

      expect((failure as Error).message).toBe(QUERY_READ_TIMEOUT_MESSAGE);
      // Marked as never sent: it applied nothing (StatementOutcome).
      expect(failure).toBeInstanceOf(StatementNotSentError);
      expect((failure as StatementNotSentError).isStatementNotSent).toBe(true);
      expect(connection.sent).toEqual(["UPDATE first"]);

      // The first statement is answered, and the connection takes the next.
      connection.answer("UPDATE 1");
      expect((await first).rowCount).toBe(1);

      const third: Promise<QueryResult> = client.query("UPDATE third");
      await eventually(() => {
        return connection.sent.length === 2;
      });
      connection.answer("UPDATE 1");

      expect((await third).rowCount).toBe(1);
      expect(connection.sent).toEqual(["UPDATE first", "UPDATE third"]);
      expect(client.isClosingAfterTimeout).toBe(false);
      expect(listener.requests).toEqual([]);
    });
  });

  describe("a statement sent and not answered in time", () => {
    test("is cancelled on the database with the connection's own key", async () => {
      const client: QuickCancelClient = await connectedClient();

      const running: Promise<unknown> = failureOf(client.query("UPDATE held"));

      await eventually(() => {
        return listener.requests.length === 1;
      });

      const request: Buffer = listener.requests[0]!;

      expect(request.length).toBe(16);
      expect(request.readInt32BE(0)).toBe(16);
      expect(request.readInt32BE(4)).toBe(CANCEL_REQUEST_CODE);
      expect(request.readInt32BE(8)).toBe(PROCESS_ID);
      expect(request.readInt32BE(12)).toBe(SECRET_KEY);

      connection.answerError(
        "57014",
        "canceling statement due to user request",
      );
      await running;

      /*
       * The caller is handed the database's answer as it comes; the cancel's
       * own connection is closed by the other end after reading it, which
       * may be noticed a moment later: delivered.
       */
      await eventually(() => {
        return client.cancelOutcomes.length === 1;
      });
      expect(client.cancelOutcomes).toEqual([CancelRequestOutcome.Delivered]);
    });

    test("the caller is handed the database's answer to the cancel, and the connection is closed", async () => {
      const client: QuickCancelClient = await connectedClient();

      const running: Promise<unknown> = failureOf(client.query("UPDATE held"));

      await eventually(() => {
        return listener.requests.length === 1;
      });
      expect(client.isClosingAfterTimeout).toBe(true);

      connection.answerError(
        "57014",
        "canceling statement due to user request",
      );

      const failure: unknown = await running;

      expect(failure).toBeInstanceOf(DatabaseError);
      expect((failure as DatabaseError).code).toBe("57014");
      expect((failure as DatabaseError).severity).toBe("ERROR");
      // Answered, so closed the polite way: the database ends the session.
      expect(connection.closedBy).toBe("terminate");
    });

    test("a statement that finished in the moment before the cancel came is answered with its result, and the connection is still closed", async () => {
      const client: QuickCancelClient = await connectedClient();

      const running: Promise<QueryResult> = client.query("UPDATE late");

      await eventually(() => {
        return client.isClosingAfterTimeout;
      });
      connection.answer("UPDATE 1");

      expect((await running).rowCount).toBe(1);
      expect(connection.closedBy).toBe("terminate");
    });

    test("with no answer in time the caller is told the read timed out, and the connection is cut", async () => {
      QuickCancelClient.answerWaitInMs = SHORT_ANSWER_WAIT_IN_MS;
      const client: QuickCancelClient = await connectedClient();
      const startedAt: number = Date.now();

      const failure: unknown = await failureOf(client.query("UPDATE silent"));

      expect((failure as Error).message).toBe(QUERY_READ_TIMEOUT_MESSAGE);
      expect(failure).not.toBeInstanceOf(DatabaseError);
      // The timeout, then the wait for an answer to the cancel.
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
        100 + QuickCancelClient.answerWaitInMs - 20,
      );
      // Still running: the connection is cut, not ended politely.
      expect(connection.closedBy).toBe("destroy");
      // The cancel was sent all the same.
      await eventually(() => {
        return listener.requests.length === 1;
      });
    });

    test("an answer that comes after the wait reaches nobody", async () => {
      QuickCancelClient.answerWaitInMs = SHORT_ANSWER_WAIT_IN_MS;
      const client: QuickCancelClient = await connectedClient();

      const failure: unknown = await failureOf(client.query("UPDATE silent"));

      expect((failure as Error).message).toBe(QUERY_READ_TIMEOUT_MESSAGE);

      // Nothing to hand it to: no throw, no second answer.
      expect(() => {
        connection.answer("UPDATE 1");
      }).not.toThrow();
    });

    test("a connection that fails meanwhile is no answer: the caller is told the read timed out", async () => {
      const client: QuickCancelClient = await connectedClient();

      const running: Promise<unknown> = failureOf(client.query("UPDATE held"));

      await eventually(() => {
        return client.isClosingAfterTimeout;
      });
      connection.emit("error", new Error("read ECONNRESET"));

      const failure: unknown = await running;

      expect((failure as Error).message).toBe(QUERY_READ_TIMEOUT_MESSAGE);
    });

    test("the connection takes no further statement, in any calling convention", async () => {
      const client: QuickCancelClient = await connectedClient();

      const running: Promise<unknown> = failureOf(client.query("UPDATE held"));

      await eventually(() => {
        return client.isClosingAfterTimeout;
      });

      // With a promise.
      const refused: unknown = await failureOf(client.query("ROLLBACK"));
      expect(refused).toBeInstanceOf(StatementNotSentError);
      expect((refused as StatementNotSentError).isStatementNotSent).toBe(true);

      // With a callback.
      const refusedToCallback: unknown = await new Promise<unknown>(
        (resolve: (error: unknown) => void) => {
          client.query("COMMIT", (error: Error) => {
            resolve(error);
          });
        },
      );
      expect(refusedToCallback).toBeInstanceOf(StatementNotSentError);

      // A query object of its own (a stream or a cursor).
      const handedError: unknown = await new Promise<unknown>(
        (resolve: (error: unknown) => void) => {
          client.query({
            submit: (): void => {
              resolve(new Error("submitted"));
            },
            handleError: (error: Error): void => {
              resolve(error);
            },
          } as never);
        },
      );
      expect(handedError).toBeInstanceOf(StatementNotSentError);

      // None of them reached the database.
      expect(connection.sent).toEqual(["UPDATE held"]);

      connection.answerError(
        "57014",
        "canceling statement due to user request",
      );
      await running;
    });

    test("a connection that never told its key sends no cancel, and is still closed", async () => {
      QuickCancelClient.answerWaitInMs = SHORT_ANSWER_WAIT_IN_MS;
      connection.backendKey = null;
      const client: QuickCancelClient = await connectedClient();

      const failure: unknown = await failureOf(client.query("UPDATE silent"));

      expect((failure as Error).message).toBe(QUERY_READ_TIMEOUT_MESSAGE);
      expect(client.cancelOutcomes).toEqual([CancelRequestOutcome.NoKey]);
      expect(listener.requests).toEqual([]);
      expect(connection.closedBy).toBe("destroy");
    });

    test("a statement's own timeout comes before the pool's", async () => {
      const client: QuickCancelClient = await connectedClient({
        query_timeout: 60_000,
      });

      const running: Promise<unknown> = failureOf(
        client.query({ text: "UPDATE own", query_timeout: 50 } as never),
      );

      await eventually(() => {
        return listener.requests.length === 1;
      });
      connection.answerError(
        "57014",
        "canceling statement due to user request",
      );

      expect(((await running) as DatabaseError).code).toBe("57014");
    });

    test("a statement with no timeout of its own and none in the options waits as long as it takes", async () => {
      const client: QuickCancelClient = await connectedClient({
        query_timeout: undefined,
      });

      const running: Promise<QueryResult> = client.query("UPDATE patient");

      await sleep(250);
      expect(client.isClosingAfterTimeout).toBe(false);

      connection.answer("UPDATE 1");
      expect((await running).rowCount).toBe(1);
      expect(listener.requests).toEqual([]);
    });
  });

  describe("the pool", () => {
    /*
     * pg-pool keeps a client given back unless it is ending: the connection
     * is closed before its caller is told, so however soon the caller gives
     * it back - pool.query() does so inside the callback - it is gone.
     */
    test.each([
      ["answered by the database's error", true],
      ["answered with its result", false],
    ])(
      "never takes back a connection whose statement ran past its timeout, %s",
      async (_name: string, answerWithError: boolean) => {
        const pool: Pool = new Pool({
          Client: QuickCancelClient,
          host: "127.0.0.1",
          port: listener.port,
          user: "postgres",
          database: "oneuptimedb",
          max: 1,
          query_timeout: 100,
          connection: connection,
        } as never);

        try {
          const running: Promise<unknown> = pool.query("UPDATE held").then(
            (result: unknown) => {
              return result;
            },
            (error: unknown) => {
              return error;
            },
          );

          await eventually(() => {
            return listener.requests.length === 1;
          });

          if (answerWithError) {
            connection.answerError(
              "57014",
              "canceling statement due to user request",
            );
          } else {
            connection.answer("UPDATE 1");
          }

          await running;

          await eventually(() => {
            return pool.totalCount === 0;
          });
          expect(pool.idleCount).toBe(0);
        } finally {
          await pool.end().catch(() => {
            return undefined;
          });
        }
      },
    );

    test("takes back a connection whose statements were answered in time", async () => {
      const pool: Pool = new Pool({
        Client: QuickCancelClient,
        host: "127.0.0.1",
        port: listener.port,
        user: "postgres",
        database: "oneuptimedb",
        max: 1,
        query_timeout: 1000,
        connection: connection,
      } as never);

      try {
        const client: PoolClient = await pool.connect();
        const running: Promise<QueryResult> = client.query("UPDATE quick");

        await eventually(() => {
          return connection.sent.length === 1;
        });
        connection.answer("UPDATE 1");
        await running;

        client.release();

        expect(pool.totalCount).toBe(1);
        expect(pool.idleCount).toBe(1);
      } finally {
        await pool.end().catch(() => {
          return undefined;
        });
      }
    });
  });

  describe("the cancel request", () => {
    test("is delivered when the other end reads it and closes", async () => {
      const client: QuickCancelClient = await connectedClient();

      expect(await client.sendCancel(1000)).toBe(
        CancelRequestOutcome.Delivered,
      );
      expect(listener.requests).toHaveLength(1);
    });

    test("fails when nothing listens where the database is", async () => {
      const client: QuickCancelClient = await connectedClient({
        port: await closedPort(),
      });

      expect(await client.sendCancel(1000)).toBe(CancelRequestOutcome.Failed);
    });

    test("gives up when the other end never closes", async () => {
      const silent: CancelListener = await listenForCancels({
        neverClose: true,
      });

      try {
        const client: QuickCancelClient = await connectedClient({
          port: silent.port,
        });

        expect(await client.sendCancel(500)).toBe(
          CancelRequestOutcome.TimedOut,
        );
        await eventually(() => {
          return silent.requests.length === 1;
        });
      } finally {
        await silent.close();
      }
    });
  });

  describe("its options", () => {
    test("node-postgres is not handed the timeout: the client keeps it", async () => {
      const client: QuickCancelClient = await connectedClient({
        query_timeout: 35_000,
      });

      expect(
        (
          client as unknown as {
            connectionParameters: { query_timeout: unknown };
          }
        ).connectionParameters.query_timeout,
      ).toBe(false);
    });

    test("a password the pool hands over hidden is kept", () => {
      const config: Record<string, unknown> = {
        host: "127.0.0.1",
        port: 5432,
        user: "postgres",
        query_timeout: 1000,
      };
      Object.defineProperty(config, "password", {
        enumerable: false,
        value: "a hidden password",
      });

      const client: CancelOnTimeoutClient = new CancelOnTimeoutClient(
        config as CancelOnTimeoutClientConfig,
      );

      expect((client as unknown as { password: unknown }).password).toBe(
        "a hidden password",
      );
    });

    test("the options it is handed are left as they were", () => {
      const config: Record<string, unknown> = {
        host: "127.0.0.1",
        query_timeout: 1000,
      };

      new CancelOnTimeoutClient(config as CancelOnTimeoutClientConfig);

      expect(config).toEqual({ host: "127.0.0.1", query_timeout: 1000 });
    });
  });

  describe("the longest a caller waits for one statement", () => {
    test("is its timeout and the wait for an answer to the cancel", () => {
      expect(getLongestStatementWaitInMs(35_000)).toBe(
        35_000 + CANCEL_ANSWER_WAIT_IN_MS,
      );
      expect(CANCEL_ANSWER_WAIT_IN_MS).toBe(5_000);
    });

    test("is unbounded when the timeout is", () => {
      expect(getLongestStatementWaitInMs(0)).toBe(0);
      expect(Number.isNaN(getLongestStatementWaitInMs(NaN))).toBe(true);
    });
  });
});
