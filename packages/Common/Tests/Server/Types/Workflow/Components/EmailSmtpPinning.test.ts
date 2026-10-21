import Email from "../../../../../Server/Types/Workflow/Components/Email";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import DataSourceEgressGuard from "../../../../../Server/Utils/DataSource/EgressGuard";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import dns from "dns";
import net from "net";
import timers from "timers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Email.test.ts mocks nodemailer, so it can only show what the component asks
 * the library for. This file runs the real library against a local socket to
 * show that what it asks for is what happens: the connection goes only to
 * addresses the egress guard validated, falling through them in turn;
 * nodemailer never resolves the name a second time (the DNS-rebinding
 * window); and TLS, implicit or STARTTLS, still presents the name the user
 * typed as SNI.
 *
 * The guard is stubbed to "validate" the name to loopback, because loopback
 * is the only address a unit test can listen on and the real guard rightly
 * refuses it. The name itself is under .invalid (RFC 6761), which never
 * resolves, and every resolver nodemailer could reach for is spied on.
 */

/*
 * nodemailer schedules its socket work with setImmediate, and Common's jest
 * environment is jsdom, which does not expose it (see
 * MultipartFormData.test.ts). Lend jsdom the real one from Node.
 */
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

const SMTP_HOST_NAME: string = "smtp.pinning.invalid";

type ResolverMethod = (
  hostname: string,
  callback: (error: NodeJS.ErrnoException | null, addresses: never) => void,
) => void;

interface FakeSmtpServer {
  port: number;
  /*
   * Bytes of the first TLS record the client sent (its ClientHello), or
   * undefined if none arrived. The server records it before it drops the
   * connection, so it is in place by the time the component's run() settles.
   */
  clientHello: () => Buffer | undefined;
  // Every SMTP command line the client sent in plaintext.
  commands: Array<string>;
  close: () => Promise<void>;
}

function makeOptions(): RunOptions {
  return {
    log: jest.fn() as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };
}

/*
 * Just enough SMTP to walk nodemailer through a send. mode "implicit-tls"
 * expects a TLS handshake straight away; "starttls" answers EHLO with
 * STARTTLS and then expects the handshake; "plain" accepts the message.
 * Either TLS mode records the ClientHello and then drops the connection,
 * since only what the client offered is of interest.
 */
async function startFakeSmtpServer(
  mode: "implicit-tls" | "starttls" | "plain",
): Promise<FakeSmtpServer> {
  const commands: Array<string> = [];
  const sockets: Set<net.Socket> = new Set();
  let clientHello: Buffer | undefined = undefined;

  const server: net.Server = net.createServer((socket: net.Socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    socket.on("error", () => {});

    let expectingTls: boolean = mode === "implicit-tls";
    let inData: boolean = false;
    let buffered: Buffer = Buffer.alloc(0);

    const reply: (line: string) => void = (line: string): void => {
      socket.write(`${line}\r\n`);
    };

    if (!expectingTls) {
      reply("220 fake.smtp ESMTP");
    }

    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);

      if (expectingTls) {
        // A TLS record is a 5-byte header whose last two bytes are its length.
        if (buffered.length < 5) {
          return;
        }
        const recordLength: number = buffered.readUInt16BE(3);
        if (buffered.length < 5 + recordLength) {
          return;
        }
        clientHello = buffered.subarray(0, 5 + recordLength);
        socket.destroy();
        return;
      }

      let text: string = buffered.toString("latin1");
      let lineEnd: number = text.indexOf("\r\n");

      while (lineEnd !== -1 && !expectingTls) {
        const line: string = text.substring(0, lineEnd);
        text = text.substring(lineEnd + 2);

        if (inData) {
          if (line === ".") {
            inData = false;
            reply("250 2.0.0 queued");
          }
        } else {
          commands.push(line);
          const verb: string = line.split(" ")[0]!.toUpperCase();

          if (verb === "EHLO") {
            if (mode === "starttls") {
              reply("250-fake.smtp");
              reply("250 STARTTLS");
            } else {
              reply("250 fake.smtp");
            }
          } else if (verb === "STARTTLS") {
            reply("220 2.0.0 ready to start TLS");
            expectingTls = true;
          } else if (verb === "DATA") {
            reply("354 go ahead");
            inData = true;
          } else if (verb === "QUIT") {
            reply("221 bye");
            socket.end();
          } else {
            reply("250 OK");
          }
        }

        lineEnd = text.indexOf("\r\n");
      }

      buffered = Buffer.from(text, "latin1");
    });
  });

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: (server.address() as net.AddressInfo).port,
    clientHello: (): Buffer | undefined => {
      return clientHello;
    },
    commands,
    close: async (): Promise<void> => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

function smtpArgs(port: number, overrides: JSONObject = {}): JSONObject {
  return {
    from: "alerts@example.com",
    to: "on-call@example.com",
    subject: "Pinned",
    "email-body": "<p>Pinned</p>",
    "smtp-host": SMTP_HOST_NAME,
    "smtp-port": port,
    secure: false,
    ...overrides,
  };
}

describe("Email workflow component — real nodemailer against the pinned address", () => {
  let server: FakeSmtpServer | undefined;
  let guardSpy: SpyInstance<typeof DataSourceEgressGuard.assertHostnameAllowed>;
  // Every name nodemailer tried to resolve itself; must stay empty.
  const resolverCalls: Array<string> = [];

  beforeEach(() => {
    resolverCalls.length = 0;

    guardSpy = jest
      .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    /*
     * nodemailer resolves a hostname with a dns.Resolver (resolve4 and
     * resolve6), falling back to dns.lookup. Record any use and fail it.
     */
    for (const method of ["resolve4", "resolve6"] as const) {
      jest.spyOn(dns.Resolver.prototype, method).mockImplementation(((
        hostname: string,
        callback: Parameters<ResolverMethod>[1],
      ): void => {
        resolverCalls.push(`${method}:${hostname}`);
        const error: NodeJS.ErrnoException = new Error(`unexpected ${method}`);
        error.code = dns.NOTFOUND;
        callback(error, undefined as never);
      }) as never);
    }

    /*
     * net.Server#listen looks up even a literal address, so IP literals go
     * through to the real lookup; only a name counts as a re-resolution.
     */
    const realLookup: typeof dns.lookup = dns.lookup;
    jest.spyOn(dns, "lookup").mockImplementation(((
      hostname: string,
      options: unknown,
      callback: (error: NodeJS.ErrnoException | null) => void,
    ): void => {
      if (net.isIP(hostname) !== 0) {
        (realLookup as unknown as (...args: Array<unknown>) => void)(
          hostname,
          options,
          callback,
        );
        return;
      }
      resolverCalls.push(`lookup:${hostname}`);
      const error: NodeJS.ErrnoException = new Error("unexpected lookup");
      error.code = "ENOTFOUND";
      callback(error);
    }) as never);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  test("delivers over the validated address without resolving the name again", async () => {
    server = await startFakeSmtpServer("plain");

    const result: RunReturnType = await new Email().run(
      smtpArgs(server.port),
      makeOptions(),
    );

    expect(result.returnValues).toEqual({});
    expect(result.executePort?.id).toBe("success");
    expect(guardSpy).toHaveBeenCalledWith(SMTP_HOST_NAME, {
      targetLabel: "SMTP server",
    });
    expect(resolverCalls).toEqual([]);
    expect(server.commands).toEqual(
      expect.arrayContaining([
        "MAIL FROM:<alerts@example.com>",
        "RCPT TO:<on-call@example.com>",
        "DATA",
      ]),
    );
  }, 20000);

  test("presents the typed name as SNI on implicit TLS", async () => {
    server = await startFakeSmtpServer("implicit-tls");

    const result: RunReturnType = await new Email().run(
      smtpArgs(server.port, { secure: true }),
      makeOptions(),
    );

    expect(resolverCalls).toEqual([]);
    const hello: Buffer | undefined = server.clientHello();
    // 0x16 is a TLS handshake record: the client really did start TLS here.
    expect(hello?.[0]).toBe(0x16);
    expect(hello?.includes(Buffer.from(SMTP_HOST_NAME, "latin1"))).toBe(true);
    expect(result.executePort?.id).toBe("error");
  }, 20000);

  test("presents the typed name as SNI on the STARTTLS upgrade", async () => {
    server = await startFakeSmtpServer("starttls");

    const result: RunReturnType = await new Email().run(
      smtpArgs(server.port),
      makeOptions(),
    );

    expect(resolverCalls).toEqual([]);
    expect(server.commands).toContain("STARTTLS");
    const hello: Buffer | undefined = server.clientHello();
    expect(hello?.[0]).toBe(0x16);
    expect(hello?.includes(Buffer.from(SMTP_HOST_NAME, "latin1"))).toBe(true);
    expect(result.executePort?.id).toBe("error");
  }, 20000);

  test("sends no SNI when the host was typed as an IP address", async () => {
    server = await startFakeSmtpServer("implicit-tls");

    await new Email().run(
      smtpArgs(server.port, { "smtp-host": "127.0.0.1", secure: true }),
      makeOptions(),
    );

    const hello: Buffer | undefined = server.clientHello();
    expect(hello?.[0]).toBe(0x16);
    expect(hello?.includes(Buffer.from(SMTP_HOST_NAME, "latin1"))).toBe(false);
    expect(hello?.includes(Buffer.from("127.0.0.1", "latin1"))).toBe(false);
  }, 20000);

  /*
   * What nodemailer did when it resolved the name itself: a validated
   * address that cannot be reached — an address family this worker has no
   * route for, or one dead record of several — falls through to the next.
   * Nothing listens on [::1] at this port (and on a host without IPv6 the
   * attempt fails outright), so delivery has to come from the second
   * address.
   */
  test("falls through to the next validated address when one cannot be reached", async () => {
    server = await startFakeSmtpServer("plain");
    guardSpy.mockResolvedValue([
      { address: "::1", family: 6 },
      { address: "127.0.0.1", family: 4 },
    ]);

    const result: RunReturnType = await new Email().run(
      smtpArgs(server.port),
      makeOptions(),
    );

    expect(result.returnValues).toEqual({});
    expect(result.executePort?.id).toBe("success");
    expect(server.commands).toContain("DATA");
    expect(resolverCalls).toEqual([]);
  }, 20000);

  /*
   * Node reports "every address failed" as an AggregateError with an empty
   * message; the workflow log should still say what happened at each one.
   */
  test("names every failed address when none of them answers", async () => {
    server = await startFakeSmtpServer("plain");
    const deadPort: number = server.port;
    await server.close();
    server = undefined;
    guardSpy.mockResolvedValue([
      { address: "::1", family: 6 },
      { address: "127.0.0.1", family: 4 },
    ]);

    const result: RunReturnType = await new Email().run(
      smtpArgs(deadPort),
      makeOptions(),
    );

    expect(result.executePort?.id).toBe("error");
    const error: string = String(result.returnValues["error"]);
    expect(error).toContain(`connect ECONNREFUSED 127.0.0.1:${deadPort}`);
    expect(error).toContain("::1");
    // One "; "-separated message per attempt, not Error#toString output.
    expect(error).not.toContain("Error:");
    expect(resolverCalls).toEqual([]);
  }, 20000);
});
