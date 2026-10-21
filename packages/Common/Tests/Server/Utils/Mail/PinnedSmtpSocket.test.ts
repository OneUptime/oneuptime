import PinnedSmtpSocket, {
  SmtpSocketCallback,
} from "../../../../Server/Utils/Mail/PinnedSmtpSocket";
import { ResolvedAddress } from "../../../../Server/Utils/DataSource/EgressGuard";
import { afterEach, describe, expect, test } from "@jest/globals";
import net from "net";

/*
 * The socket half of pinning a tenant-chosen SMTP server.
 *
 * The check that an SMTP host is allowed happens before the connection, but
 * nodemailer given a *host name* resolves it again itself, behind a five minute
 * cache that ignores the record's TTL. So a name that answered with a public
 * address during validation and a private one a moment later would be checked
 * against the first and connected to the second. PinnedSmtpSocket closes that
 * window: it dials the addresses the guard already validated and hands
 * nodemailer a connected socket, leaving it nothing to resolve.
 *
 * Which makes the first thing worth proving the negative one — that the host
 * name is *not* what gets dialed. These tests pass a name that cannot resolve
 * at all together with a loopback address, and the connection still lands: if
 * the pinned lookup were ever dropped, every one of them would fail instead.
 *
 * Real loopback sockets throughout rather than a mocked `net`; a mock of the
 * module would assert the arguments this passes to net.connect and prove
 * nothing about where the bytes went.
 */

// A name with a reserved TLD (RFC 2606): guaranteed never to resolve anywhere.
const UNRESOLVABLE_HOST: string = "smtp.pinning-must-not-resolve-this.invalid";

const CONNECT_TIMEOUT_MS: number = 5000;

/*
 * Errors raised inside Node's `net` fail `toBeInstanceOf(Error)` here: the
 * suite runs in a jsdom environment, so the `Error` the test sees and the one
 * the socket threw come from different realms. Assert the shape that matters
 * instead — a connection failure has to reach nodemailer as something with a
 * message on it, whichever realm made it.
 */
function expectConnectionFailure(error: Error | null): Error {
  expect(error).not.toBeNull();
  expect(typeof error!.message).toBe("string");
  expect(error!.message.length).toBeGreaterThan(0);

  return error!;
}

interface ConnectOutcome {
  calls: number;
  error: Error | null;
  connection: net.Socket | undefined;
}

let servers: Array<net.Server> = [];
let sockets: Array<net.Socket> = [];

// A listening loopback server, and the port it landed on.
function listen(): Promise<{ server: net.Server; port: number }> {
  return new Promise(
    (resolve: (value: { server: net.Server; port: number }) => void): void => {
      const server: net.Server = net.createServer();
      servers.push(server);
      server.listen(0, "127.0.0.1", (): void => {
        resolve({
          server: server,
          port: (server.address() as net.AddressInfo).port,
        });
      });
    },
  );
}

// A port nothing is listening on: bound to learn the number, then released.
async function closedPort(): Promise<number> {
  const { server, port } = await listen();
  await new Promise((resolve: (value: unknown) => void): void => {
    server.close(resolve);
  });
  return port;
}

/*
 * Runs connect and resolves once onDone has fired, then waits a further tick
 * so that a second call — which the `settled` guard exists to prevent — would
 * be counted rather than missed.
 */
function connectAndWait(data: {
  host: string;
  port: number;
  addresses: Array<ResolvedAddress>;
  timeoutInMs?: number;
}): Promise<ConnectOutcome> {
  return new Promise((resolve: (value: ConnectOutcome) => void): void => {
    const outcome: ConnectOutcome = {
      calls: 0,
      error: null,
      connection: undefined,
    };

    const onDone: SmtpSocketCallback = (
      error: Error | null,
      socketOptions?: { connection: net.Socket },
    ): void => {
      outcome.calls = outcome.calls + 1;

      if (outcome.calls === 1) {
        outcome.error = error;
        outcome.connection = socketOptions?.connection;

        if (socketOptions?.connection) {
          sockets.push(socketOptions.connection);
        }

        setTimeout((): void => {
          resolve(outcome);
        }, 50);
      }
    };

    PinnedSmtpSocket.connect({
      host: data.host,
      port: data.port,
      addresses: data.addresses,
      timeoutInMs: data.timeoutInMs ?? CONNECT_TIMEOUT_MS,
      onDone: onDone,
    });
  });
}

afterEach(async () => {
  for (const socket of sockets) {
    socket.destroy();
  }
  sockets = [];

  await Promise.all(
    servers.map((server: net.Server): Promise<void> => {
      return new Promise((resolve: () => void): void => {
        server.close((): void => {
          return resolve();
        });
      });
    }),
  );
  servers = [];
});

describe("PinnedSmtpSocket.connect", () => {
  test("connects to the validated address even though the host name does not resolve", async () => {
    const { server, port } = await listen();

    const accepted: Promise<net.Socket> = new Promise(
      (resolve: (value: net.Socket) => void): void => {
        server.once("connection", resolve);
      },
    );

    const outcome: ConnectOutcome = await connectAndWait({
      host: UNRESOLVABLE_HOST,
      port: port,
      addresses: [{ address: "127.0.0.1", family: 4 }],
    });

    expect(outcome.error).toBeNull();
    expect(outcome.connection).toBeInstanceOf(net.Socket);

    /*
     * The point of the whole class: the bytes went to the address the guard
     * validated, not anywhere the name might have pointed.
     */
    const serverSide: net.Socket = await accepted;
    expect(serverSide.remoteAddress).toBe("127.0.0.1");
    expect(outcome.connection!.remotePort).toBe(port);
    serverSide.destroy();
  });

  test("hands back a socket that is already connected and usable", async () => {
    const { server, port } = await listen();

    const received: Promise<string> = new Promise(
      (resolve: (value: string) => void): void => {
        server.once("connection", (socket: net.Socket): void => {
          socket.once("data", (chunk: Buffer): void => {
            resolve(chunk.toString());
            socket.destroy();
          });
        });
      },
    );

    const outcome: ConnectOutcome = await connectAndWait({
      host: UNRESOLVABLE_HOST,
      port: port,
      addresses: [{ address: "127.0.0.1", family: 4 }],
    });

    expect(outcome.connection!.connecting).toBe(false);
    expect(outcome.connection!.destroyed).toBe(false);

    // nodemailer writes its EHLO onto exactly this socket.
    outcome.connection!.write("EHLO pinned\r\n");
    await expect(received).resolves.toBe("EHLO pinned\r\n");
  });

  test("reports the address it was given, not the name, so onDone fires once", async () => {
    const port: number = await closedPort();

    const outcome: ConnectOutcome = await connectAndWait({
      host: UNRESOLVABLE_HOST,
      port: port,
      addresses: [{ address: "127.0.0.1", family: 4 }],
    });

    /*
     * A refused connection, not a DNS failure: the name never went to a
     * resolver. ECONNREFUSED names the address that refused.
     */
    expect(expectConnectionFailure(outcome.error).message).toContain(
      "127.0.0.1",
    );
    expect(outcome.connection).toBeUndefined();
    expect(outcome.calls).toBe(1);
  });

  test("a failed connection does not leave a live socket behind", async () => {
    const port: number = await closedPort();

    const outcome: ConnectOutcome = await connectAndWait({
      host: UNRESOLVABLE_HOST,
      port: port,
      addresses: [{ address: "127.0.0.1", family: 4 }],
    });

    expect(outcome.error).not.toBeNull();
    expect(outcome.connection).toBeUndefined();
  });

  test("a socket that never answers ends the attempt instead of hanging the send", async () => {
    /*
     * 192.0.2.0/24 is TEST-NET-1 (RFC 5737) and is not routed, so the SYN goes
     * unanswered and setTimeout is what ends the attempt. Only the invariants
     * are asserted, not the message: a network that answers with an ICMP
     * unreachable instead of dropping the packet takes the error path, and
     * both outcomes are the behaviour under test — the send ends, once,
     * rather than waiting on nodemailer's own timeout, which has not started.
     */
    const outcome: ConnectOutcome = await connectAndWait({
      host: UNRESOLVABLE_HOST,
      port: 25,
      addresses: [{ address: "192.0.2.1", family: 4 }],
      timeoutInMs: 150,
    });

    expectConnectionFailure(outcome.error);
    expect(outcome.connection).toBeUndefined();
    expect(outcome.calls).toBe(1);
  });

  test("onDone is called once even when the connected socket errors afterwards", async () => {
    // afterEach closes the server; only the port it landed on is needed here.
    const { port } = await listen();

    const outcome: ConnectOutcome = await new Promise(
      (resolve: (value: ConnectOutcome) => void): void => {
        const seen: ConnectOutcome = {
          calls: 0,
          error: null,
          connection: undefined,
        };

        PinnedSmtpSocket.connect({
          host: UNRESOLVABLE_HOST,
          port: port,
          addresses: [{ address: "127.0.0.1", family: 4 }],
          timeoutInMs: CONNECT_TIMEOUT_MS,
          onDone: (
            error: Error | null,
            socketOptions?: { connection: net.Socket },
          ): void => {
            seen.calls = seen.calls + 1;
            seen.error = error;
            seen.connection = socketOptions?.connection;

            if (seen.calls > 1 || !socketOptions?.connection) {
              return;
            }

            const socket: net.Socket = socketOptions.connection;
            sockets.push(socket);

            /*
             * What nodemailer does on being handed the socket, and the reason
             * the class installs its own no-op listener: without an error
             * handler an ECONNRESET here is an unhandled 'error' event, which
             * takes the process down.
             */
            socket.on("error", (): void => {});
            socket.destroy(new Error("reset by peer"));

            setTimeout((): void => {
              resolve(seen);
            }, 50);
          },
        });
      },
    );

    expect(outcome.calls).toBe(1);
    expect(outcome.error).toBeNull();
    expect(outcome.connection!.destroyed).toBe(true);
  });
});

describe("PinnedSmtpSocket.describeConnectionError", () => {
  test("an error that already says something is passed straight through", () => {
    const error: Error = new Error("connect ECONNREFUSED 10.0.0.5:587");

    expect(PinnedSmtpSocket.describeConnectionError(error)).toBe(error);
  });

  test("an AggregateError with an empty message is replaced by what each attempt said", () => {
    /*
     * What autoSelectFamily reports when every pinned address fails: an
     * AggregateError whose own message is empty. Left alone it reaches the
     * user as a bare "could not be sent" with nothing to act on.
     */
    const aggregate: Error & { errors?: Array<Error> } = new Error("");
    aggregate.errors = [
      new Error("connect ECONNREFUSED 10.0.0.5:587"),
      new Error("connect ETIMEDOUT 10.0.0.6:587"),
    ];

    const described: Error =
      PinnedSmtpSocket.describeConnectionError(aggregate);

    expect(described).not.toBe(aggregate);
    expect(described.message).toBe(
      "connect ECONNREFUSED 10.0.0.5:587; connect ETIMEDOUT 10.0.0.6:587",
    );
  });

  test("the code is carried over so callers that branch on it still can", () => {
    const aggregate: Error & { errors?: Array<Error>; code?: string } =
      new Error("");
    aggregate.errors = [new Error("connect ECONNREFUSED 10.0.0.5:587")];
    aggregate.code = "ECONNREFUSED";

    const described: NodeJS.ErrnoException =
      PinnedSmtpSocket.describeConnectionError(aggregate);

    expect(described.code).toBe("ECONNREFUSED");
  });

  test("no code on the aggregate leaves none on the description", () => {
    const aggregate: Error & { errors?: Array<Error> } = new Error("");
    aggregate.errors = [new Error("connect ECONNREFUSED 10.0.0.5:587")];

    const described: NodeJS.ErrnoException =
      PinnedSmtpSocket.describeConnectionError(aggregate);

    expect(described.code).toBeUndefined();
  });

  test("a message wins over the attempts, so a described error is never rewritten twice", () => {
    const aggregate: Error & { errors?: Array<Error> } = new Error(
      "everything failed",
    );
    aggregate.errors = [new Error("connect ECONNREFUSED 10.0.0.5:587")];

    expect(PinnedSmtpSocket.describeConnectionError(aggregate)).toBe(aggregate);
  });

  test("an empty message with no attempts to describe is passed through", () => {
    const error: Error = new Error("");

    expect(PinnedSmtpSocket.describeConnectionError(error)).toBe(error);
  });

  test("an empty attempt list is passed through rather than turned into an empty message", () => {
    const aggregate: Error & { errors?: Array<Error> } = new Error("");
    aggregate.errors = [];

    expect(PinnedSmtpSocket.describeConnectionError(aggregate)).toBe(aggregate);
  });

  test("an errors property that is not a list is left alone", () => {
    const odd: Error & { errors?: unknown } = new Error("");
    odd.errors = { first: "connect ECONNREFUSED" };

    expect(PinnedSmtpSocket.describeConnectionError(odd)).toBe(odd);
  });

  test("attempts that are not errors are still described rather than dropped", () => {
    const aggregate: Error & { errors?: Array<unknown> } = new Error("");
    aggregate.errors = [
      "plain string failure",
      null,
      { message: "an object with a message" },
    ];

    const described: Error =
      PinnedSmtpSocket.describeConnectionError(aggregate);

    expect(described.message).toBe(
      "plain string failure; null; an object with a message",
    );
  });
});
