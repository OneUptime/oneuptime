import { TransporterPool } from "../../FeatureSet/Notification/Services/MailService";
import SMTPOAuthService from "../../FeatureSet/Notification/Services/SMTPOAuthService";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import EmailServer from "Common/Types/Email/EmailServer";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import DataSourceEgressGuard, {
  EgressGuardOptions,
  ResolvedAddress,
} from "Common/Server/Utils/DataSource/EgressGuard";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import dns from "dns";
import net from "net";
import nodemailer, {
  type SMTPSentMessageInfo,
  type SMTPTransportOptions,
  type Transporter,
} from "nodemailer";

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    getEmailServerType: jest.fn(),
    getGlobalSMTPConfig: jest.fn(),
    getSendgridConfig: jest.fn(),
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  return { IsDevelopment: false, EncryptionSecret: "test-encryption-secret" };
});

jest.mock("Common/Server/Services/EmailLogService", () => {
  return { __esModule: true, default: { create: jest.fn() } };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return { __esModule: true, default: { updateOneById: jest.fn() } };
});

jest.mock("Common/Models/DatabaseModels/EmailLog", () => {
  return { __esModule: true, default: jest.fn() };
});

jest.mock("Common/Models/DatabaseModels/GlobalConfig", () => {
  return {
    EmailServerType: { Sendgrid: "Sendgrid", CustomSMTP: "Custom SMTP" },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return { add: jest.fn() };
      },
      getNotificationDuration: () => {
        return { record: jest.fn() };
      },
    },
  };
});

jest.mock(
  "../../FeatureSet/Notification/Services/MailProviders/MicrosoftGraphMailProvider",
  () => {
    return { __esModule: true, default: jest.fn() };
  },
);

/*
 * A project's SMTP server is checked by the egress guard, and the check is
 * only worth anything if the address it approved is the address dialed.
 *
 * nodemailer, given a host name, resolves it again by itself (a
 * dns.Resolver's resolve4/resolve6, falling back to dns.lookup, behind a
 * process-wide cache kept for five minutes whatever the TTL). A DNS server
 * that answers the guard's getaddrinfo with a public address and nodemailer
 * with 127.0.0.1 or 169.254.169.254 would reach whatever listens there, and
 * the refused / timed out / "Invalid greeting. response=<banner>" outcome is
 * stored in EmailLog.statusMessage for the project to read. A pooled
 * transporter lives for as long as the config keeps sending and opens new
 * connections by itself, long after the check that built it.
 *
 * This runs the real nodemailer, pooled and XOAUTH2, against a local socket:
 * each connection goes to an address the guard validated for that
 * connection, and nothing ever resolves the name a second time.
 *
 * The guard is stubbed to "validate" the name to loopback, because loopback
 * is the only address a unit test can listen on and the real guard rightly
 * refuses it. Everything else it is asked goes to the real policy. The name
 * is under .invalid (RFC 6761), which never resolves, and every resolver
 * nodemailer could reach for is spied on.
 */

const SMTP_HOST_NAME: string = "smtp.pinning.invalid";

const realAssertHostnameAllowed: typeof DataSourceEgressGuard.assertHostnameAllowed =
  DataSourceEgressGuard.assertHostnameAllowed.bind(DataSourceEgressGuard);

// What Promise.allSettled reports for one send.
interface SettledSend {
  status: string;
  reason?: unknown;
}

type ResolverMethod = (
  hostname: string,
  callback: (error: NodeJS.ErrnoException | null, addresses: never) => void,
) => void;

interface FakeSmtpServer {
  port: number;
  // How many TCP connections the server has accepted.
  connections: () => number;
  // Every SMTP command line the client sent in plaintext.
  commands: Array<string>;
  /*
   * Bytes of the first TLS record the client sent (its ClientHello), or
   * undefined if none arrived.
   */
  clientHello: () => Buffer | undefined;
  close: () => Promise<void>;
}

/*
 * Just enough SMTP to walk nodemailer through a send, AUTH included. mode
 * "starttls" answers EHLO with STARTTLS and then records the ClientHello and
 * drops the connection, since only what the client offered is of interest.
 */
async function startFakeSmtpServer(
  mode: "plain" | "starttls" = "plain",
): Promise<FakeSmtpServer> {
  const commands: Array<string> = [];
  const sockets: Set<net.Socket> = new Set();
  let connections: number = 0;
  let clientHello: Buffer | undefined = undefined;

  const server: net.Server = net.createServer((socket: net.Socket) => {
    connections++;
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    socket.on("error", () => {});

    let expectingTls: boolean = false;
    let inData: boolean = false;
    let buffered: Buffer = Buffer.alloc(0);

    const reply: (line: string) => void = (line: string): void => {
      socket.write(`${line}\r\n`);
    };

    reply("220 fake.smtp ESMTP");

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
            reply("250-fake.smtp");
            if (mode === "starttls") {
              reply("250 STARTTLS");
            } else {
              reply("250 AUTH PLAIN XOAUTH2");
            }
          } else if (verb === "STARTTLS") {
            reply("220 2.0.0 ready to start TLS");
            expectingTls = true;
          } else if (verb === "AUTH") {
            reply("235 2.7.0 Authentication successful");
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
    connections: (): number => {
      return connections;
    },
    commands,
    clientHello: (): Buffer | undefined => {
      return clientHello;
    },
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

function projectEmailServer(
  port: number,
  overrides: Partial<EmailServer> = {},
): EmailServer {
  return {
    // An id means "this came from a project's ProjectSmtpConfig".
    id: ObjectID.generate(),
    host: new Hostname(SMTP_HOST_NAME),
    port: new Port(port),
    username: "user",
    password: "pass",
    fromEmail: new Email("noreply@example.com"),
    fromName: "OneUptime",
    secure: false,
    authType: SMTPAuthenticationType.UsernamePassword,
    ...overrides,
  };
}

function sendTestMail(
  transporter: Transporter<SMTPSentMessageInfo>,
): Promise<SMTPSentMessageInfo> {
  return transporter.sendMail({
    from: "OneUptime <noreply@example.com>",
    to: "on-call@example.com",
    subject: "Pinned",
    html: "<p>Pinned</p>",
  });
}

describe("project SMTP servers are dialed only at validated addresses (real nodemailer)", () => {
  let server: FakeSmtpServer | undefined;
  let guardSpy: jest.SpyInstance;
  /*
   * What the guard's resolver says the SMTP host is, one answer per
   * validation, the last answer repeating. Loopback stands for "a public
   * address": the test server is the only thing a unit test can reach.
   */
  let dnsAnswers: Array<Array<ResolvedAddress>>;
  // Every name nodemailer tried to resolve itself; must stay empty.
  const resolverCalls: Array<string> = [];

  beforeEach(() => {
    resolverCalls.length = 0;
    dnsAnswers = [[{ address: "127.0.0.1", family: 4 }]];

    guardSpy = jest
      .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
      .mockImplementation(
        (
          hostname: string,
          options?: EgressGuardOptions,
        ): Promise<Array<ResolvedAddress>> => {
          const answer: Array<ResolvedAddress> =
            dnsAnswers.length > 1 ? dnsAnswers.shift()! : dnsAnswers[0]!;

          if (
            hostname === SMTP_HOST_NAME &&
            answer.every((resolved: ResolvedAddress) => {
              return resolved.address === "127.0.0.1";
            })
          ) {
            return Promise.resolve(answer);
          }

          // Anything else is judged by the real policy.
          return realAssertHostnameAllowed(hostname, {
            ...options,
            resolveFunction: () => {
              return Promise.resolve(answer);
            },
          });
        },
      );

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
    await TransporterPool.cleanup();
    jest.restoreAllMocks();
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  test("a pooled send reaches the validated address without resolving the name again", async () => {
    server = await startFakeSmtpServer();

    const transporter: Transporter<SMTPSentMessageInfo> =
      await TransporterPool.getTransporter(projectEmailServer(server.port), {});
    await sendTestMail(transporter);

    expect(resolverCalls).toEqual([]);
    expect(server.commands).toEqual(
      expect.arrayContaining([
        "MAIL FROM:<noreply@example.com>",
        "RCPT TO:<on-call@example.com>",
        "DATA",
      ]),
    );
    /*
     * One validation: the first connection uses the addresses getTransporter
     * just validated instead of resolving a second time.
     */
    expect(guardSpy).toHaveBeenCalledTimes(1);
    expect(guardSpy).toHaveBeenCalledWith(SMTP_HOST_NAME, {
      targetLabel: "SMTP server",
    });
  }, 20000);

  /*
   * Two sends at once make the pool open a second connection by itself,
   * without going back through getTransporter. That connection is validated
   * too.
   */
  test("every new pooled connection validates the host again", async () => {
    server = await startFakeSmtpServer();

    const transporter: Transporter<SMTPSentMessageInfo> =
      await TransporterPool.getTransporter(projectEmailServer(server.port), {});
    await Promise.all([sendTestMail(transporter), sendTestMail(transporter)]);

    expect(server.connections()).toBe(2);
    expect(guardSpy).toHaveBeenCalledTimes(2);
    expect(resolverCalls).toEqual([]);
  }, 20000);

  /*
   * The rebinding attack on a pooled transporter: the name passes the check
   * that builds the transporter, then resolves to the metadata address. The
   * next connection the pool opens is refused, with the guard's reason, and
   * never dialed.
   */
  test("a pooled connection opened after the name rebinds to a blocked address is refused, not dialed", async () => {
    server = await startFakeSmtpServer();

    const transporter: Transporter<SMTPSentMessageInfo> =
      await TransporterPool.getTransporter(projectEmailServer(server.port), {});

    dnsAnswers = [[{ address: "169.254.169.254", family: 4 }]];

    const [first, second] = (await Promise.allSettled([
      sendTestMail(transporter),
      sendTestMail(transporter),
    ])) as Array<SettledSend>;

    // The first connection was validated before the name changed.
    expect(first!.status).toBe("fulfilled");
    expect(second!.status).toBe("rejected");
    expect(String(second!.reason)).toContain(
      `SMTP server host ${SMTP_HOST_NAME} resolves to 169.254.169.254, which is not allowed`,
    );
    expect(server.connections()).toBe(1);
    expect(resolverCalls).toEqual([]);
  }, 20000);

  /*
   * And a later connection dials what ITS validation returned, not what an
   * earlier one did. Nothing listens on [::1] at this port (and on a host
   * without IPv6 the attempt fails outright), so the attempt shows up as an
   * error naming ::1 rather than as a connection to the server.
   */
  test("a later pooled connection dials the addresses its own validation returned", async () => {
    server = await startFakeSmtpServer();

    const transporter: Transporter<SMTPSentMessageInfo> =
      await TransporterPool.getTransporter(projectEmailServer(server.port), {});

    dnsAnswers = [[{ address: "::1", family: 6 }]];

    const [first, second] = (await Promise.allSettled([
      sendTestMail(transporter),
      sendTestMail(transporter),
    ])) as Array<SettledSend>;

    expect(first!.status).toBe("fulfilled");
    expect(second!.status).toBe("rejected");
    expect(String(second!.reason)).toContain("::1");
    expect(server.connections()).toBe(1);
    expect(resolverCalls).toEqual([]);
  }, 20000);

  test("the XOAUTH2 transporter is pinned the same way", async () => {
    server = await startFakeSmtpServer();
    jest
      .spyOn(SMTPOAuthService, "getAccessToken")
      .mockResolvedValue("oauth-access-token");

    const transporter: Transporter<SMTPSentMessageInfo> =
      await TransporterPool.getTransporter(
        projectEmailServer(server.port, {
          authType: SMTPAuthenticationType.OAuth,
          username: "sender@example.com",
          password: undefined,
          clientId: "client-id",
          clientSecret: "client-secret",
          tokenUrl: URL.fromString("https://login.example.com/token"),
          scope: "https://outlook.office365.com/.default",
          oauthProviderType: OAuthProviderType.ClientCredentials,
        }),
        {},
      );
    await sendTestMail(transporter);

    const xoauth2: string = Buffer.from(
      "user=sender@example.com\x01auth=Bearer oauth-access-token\x01\x01",
    ).toString("base64");

    expect(server.commands).toContain(`AUTH XOAUTH2 ${xoauth2}`);
    expect(server.commands).toContain("DATA");
    expect(guardSpy).toHaveBeenCalledTimes(1);
    expect(resolverCalls).toEqual([]);
  }, 20000);

  test("an OAuth send after the name rebinds to loopback is refused, not dialed", async () => {
    server = await startFakeSmtpServer();
    jest
      .spyOn(SMTPOAuthService, "getAccessToken")
      .mockResolvedValue("oauth-access-token");

    /*
     * getTransporter's check passes; the answer changes before the second
     * send on the same transporter, which is what MailService's retry loop
     * does after a failed attempt.
     */
    const transporter: Transporter<SMTPSentMessageInfo> =
      await TransporterPool.getTransporter(
        projectEmailServer(server.port, {
          authType: SMTPAuthenticationType.OAuth,
          username: "sender@example.com",
          password: undefined,
          clientId: "client-id",
          clientSecret: "client-secret",
          tokenUrl: URL.fromString("https://login.example.com/token"),
          scope: "https://outlook.office365.com/.default",
          oauthProviderType: OAuthProviderType.ClientCredentials,
        }),
        {},
      );
    await sendTestMail(transporter);

    dnsAnswers = [[{ address: "127.0.0.53", family: 4 }]];

    await expect(sendTestMail(transporter)).rejects.toThrow(
      `SMTP server host ${SMTP_HOST_NAME} resolves to 127.0.0.53, which is not allowed: loopback address.`,
    );

    expect(server.connections()).toBe(1);
    expect(resolverCalls).toEqual([]);
  }, 20000);

  /*
   * nodemailer is handed a socket, not a name, but it is still given the
   * name as host: that is what TLS sends as SNI and verifies the
   * certificate against.
   */
  test("STARTTLS still presents the configured name as SNI", async () => {
    server = await startFakeSmtpServer("starttls");

    const transporter: Transporter<SMTPSentMessageInfo> =
      await TransporterPool.getTransporter(
        projectEmailServer(server.port, { secure: true }),
        {},
      );
    await expect(sendTestMail(transporter)).rejects.toThrow();

    expect(server.commands).toContain("STARTTLS");
    const hello: Buffer | undefined = server.clientHello();
    // 0x16 is a TLS handshake record: the client really did start TLS here.
    expect(hello?.[0]).toBe(0x16);
    expect(hello?.includes(Buffer.from(SMTP_HOST_NAME, "latin1"))).toBe(true);
    expect(resolverCalls).toEqual([]);
  }, 20000);
});

describe("which SMTP transporters are pinned", () => {
  let createTransportSpy: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);

    createTransportSpy = jest
      .spyOn(nodemailer, "createTransport")
      .mockReturnValue({
        sendMail: () => {
          return Promise.resolve({});
        },
        close: () => {
          return undefined;
        },
      } as never);
  });

  afterEach(async () => {
    await TransporterPool.cleanup();
    jest.restoreAllMocks();
  });

  function transportOptions(): SMTPTransportOptions {
    return createTransportSpy.mock.calls[0]![0] as SMTPTransportOptions;
  }

  test("a project server gets the pinned socket and keeps its TLS options", async () => {
    await TransporterPool.getTransporter(projectEmailServer(587), {});

    expect(transportOptions()).toMatchObject({
      host: SMTP_HOST_NAME,
      port: 587,
      secure: false,
      requireTLS: false,
      tls: { rejectUnauthorized: false },
      pool: true,
    });
    expect(transportOptions().getSocket).toBeInstanceOf(Function);
  });

  test("a project server that asked for TLS still verifies the certificate", async () => {
    await TransporterPool.getTransporter(
      projectEmailServer(587, { secure: true }),
      {},
    );

    expect(transportOptions().requireTLS).toBe(true);
    expect(transportOptions().tls).toBeUndefined();
    expect(transportOptions().getSocket).toBeInstanceOf(Function);
  });

  test("the operator's global server is neither validated nor pinned", async () => {
    const guardSpy: jest.SpyInstance = jest.spyOn(
      DataSourceEgressGuard,
      "assertHostnameAllowed",
    );
    const globalServer: EmailServer = projectEmailServer(587);
    delete (globalServer as { id?: ObjectID | undefined }).id;

    await TransporterPool.getTransporter(globalServer, {});

    expect(guardSpy).not.toHaveBeenCalled();
    expect(transportOptions().host).toBe(SMTP_HOST_NAME);
    expect(transportOptions().getSocket).toBeUndefined();
  });
});
