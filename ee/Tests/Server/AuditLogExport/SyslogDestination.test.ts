import net from "net";
import tls from "tls";
import { afterEach, describe, expect, test } from "@jest/globals";
import SyslogDestination, {
  AUDIT_LOG_EXPORT_SYSLOG_PRIORITY,
  frameSyslogMessage,
  getSyslogHostName,
  SyslogTargetResolver,
  toSyslogMessage,
} from "../../../Server/AuditLogExport/Destinations/SyslogDestination";
import { AuditLogExportDeliveryError } from "../../../Server/AuditLogExport/Destinations/Types";
import { AuditLogExportSettings } from "Common/Server/Utils/AuditLog/Export/AuditLogExportSettings";
import { ResolvedAddress } from "Common/Server/Utils/DataSource/EgressGuard";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import {
  AUDIT_LOG_EXPORT_RECORD_KEYS,
  AuditLogExportRecord,
} from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import {
  createTestCertificate,
  TestCertificate,
} from "Common/Tests/Server/Utils/IRC/TestCertificate";
import {
  auditLogRecord,
  batchOf,
  deliveryOf,
  settingsOf,
} from "./AuditLogExportTestData";

/*
 * Syslog, against real receivers on this machine: a TCP one and a TLS one
 * with a certificate made for the test (Common's TestCertificate). They
 * read frames as rsyslog and syslog-ng do - octet counting, or one message
 * per line - and parse every message back.
 *
 * The egress policy refuses loopback for every export, so the receivers
 * are reached through a resolver that answers 127.0.0.1 for their names -
 * what the policy hands the connection for an allowed host. A test below
 * keeps the real policy and shows it refuses 127.0.0.1.
 */

interface Receiver {
  port: number;
  received: Promise<Buffer>;
  close: () => Promise<void>;
}

const openServers: Array<net.Server> = [];

afterEach(async () => {
  for (const server of openServers.splice(0)) {
    await new Promise<void>((resolve: () => void): void => {
      server.close((): void => {
        resolve();
      });
    });
  }
});

function listen(
  server: net.Server,
  onData: (socket: net.Socket) => Promise<Buffer>,
): Promise<Receiver> {
  let resolveReceived: (data: Buffer) => void = (): void => {
    return undefined;
  };

  const received: Promise<Buffer> = new Promise<Buffer>(
    (resolve: (data: Buffer) => void): void => {
      resolveReceived = resolve;
    },
  );

  // A TLS server's sockets are read once the handshake is done, decrypted.
  server.on(
    server instanceof tls.Server ? "secureConnection" : "connection",
    (socket: net.Socket): void => {
      void onData(socket).then(resolveReceived);
    },
  );

  openServers.push(server);

  return new Promise<Receiver>((resolve: (receiver: Receiver) => void): void => {
    server.listen(0, "127.0.0.1", (): void => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        received,
        close: (): Promise<void> => {
          return new Promise<void>((done: () => void): void => {
            server.close((): void => {
              done();
            });
          });
        },
      });
    });
  });
}

// Reads until the sender ends, then closes its side, as a syslog receiver does.
function readAll(socket: net.Socket): Promise<Buffer> {
  return new Promise<Buffer>((resolve: (data: Buffer) => void): void => {
    const chunks: Array<Buffer> = [];

    socket.on("data", (chunk: Buffer): void => {
      chunks.push(chunk);
    });
    socket.on("end", (): void => {
      socket.end();
      resolve(Buffer.concat(chunks));
    });
    socket.on("error", (): void => {
      resolve(Buffer.concat(chunks));
    });
  });
}

// Octet-counted frames (RFC 6587 / 5425): "<length> <message>" one after another.
function readOctetCountedFrames(data: Buffer): Array<string> {
  const frames: Array<string> = [];
  let offset: number = 0;

  while (offset < data.length) {
    const space: number = data.indexOf(0x20, offset);
    const length: number = Number(data.subarray(offset, space).toString("ascii"));

    frames.push(data.subarray(space + 1, space + 1 + length).toString("utf8"));
    offset = space + 1 + length;
  }

  return frames;
}

const toLoopback: SyslogTargetResolver = async (): Promise<
  Array<ResolvedAddress>
> => {
  return [{ address: "127.0.0.1", family: 4 }];
};

const syslogSettings: (config: Record<string, unknown>) => AuditLogExportSettings = (
  config: Record<string, unknown>,
): AuditLogExportSettings => {
  return settingsOf({
    type: AuditLogExportDestinationType.Syslog,
    config: config as never,
  });
};

const records: Array<AuditLogExportRecord> = [
  auditLogRecord({ createdAt: "2026-10-24T09:15:03.000Z" }),
  auditLogRecord({
    createdAt: "2026-10-24T09:15:04.000Z",
    resourceName: "Multi-line\nname é",
  }),
  auditLogRecord({ createdAt: "2026-10-24T09:15:05.000Z" }),
];

// A message's parts: <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID SD MSG.
function parseMessage(message: string): {
  header: Array<string>;
  json: Record<string, unknown>;
} {
  const parts: Array<string> = message.split(" ");
  const header: Array<string> = parts.slice(0, 7);

  return {
    header,
    json: JSON.parse(parts.slice(7).join(" ")) as Record<string, unknown>,
  };
}

const failureOf: (run: () => Promise<unknown>) => Promise<AuditLogExportDeliveryError> =
  async (run: () => Promise<unknown>): Promise<AuditLogExportDeliveryError> => {
    try {
      await run();
    } catch (error) {
      expect(error).toBeInstanceOf(AuditLogExportDeliveryError);
      return error as AuditLogExportDeliveryError;
    }

    throw new Error("Expected the delivery to fail.");
  };

describe("syslog over TCP", () => {
  test("one RFC 5424 message per entry, octet counted, facility log audit", async () => {
    const receiver: Receiver = await listen(net.createServer(), readAll);

    const receipt: { location: string } = await new SyslogDestination({
      resolveTarget: toLoopback,
      hostName: "oneuptime.example.com",
    }).deliver(
      deliveryOf({
        settings: syslogSettings({
          host: "syslog.example.com",
          port: receiver.port,
          protocol: "tcp",
        }),
        batch: batchOf(records),
      }),
    );

    expect(receipt.location).toBe(`syslog://syslog.example.com:${receiver.port}`);

    const frames: Array<string> = readOctetCountedFrames(await receiver.received);

    expect(frames).toHaveLength(3);

    frames.forEach((frame: string, index: number): void => {
      const { header, json } = parseMessage(frame);

      expect(header).toEqual([
        `<${AUDIT_LOG_EXPORT_SYSLOG_PRIORITY}>1`,
        records[index]!.createdAt,
        "oneuptime.example.com",
        "oneuptime",
        "-",
        "audit-log",
        "-",
      ]);
      expect(json["id"]).toBe(records[index]!.id);
      expect(Object.keys(json)).toEqual([...AUDIT_LOG_EXPORT_RECORD_KEYS]);
    });

    // A line break inside a value stays inside its message.
    expect(parseMessage(frames[1]!).json["resourceName"]).toBe(
      "Multi-line\nname é",
    );
    expect(AUDIT_LOG_EXPORT_SYSLOG_PRIORITY).toBe(13 * 8 + 6);
  });

  test("one message per line, for receivers that read TCP by lines", async () => {
    const receiver: Receiver = await listen(net.createServer(), readAll);

    await new SyslogDestination({ resolveTarget: toLoopback }).deliver(
      deliveryOf({
        settings: syslogSettings({
          host: "syslog.example.com",
          port: receiver.port,
          protocol: "tcp",
          framing: "newline",
        }),
        batch: batchOf(records),
      }),
    );

    const lines: Array<string> = (await receiver.received)
      .toString("utf8")
      .split("\n");

    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe("");
    expect(parseMessage(lines[2]!).json["id"]).toBe(records[2]!.id);
  });

  test("a receiver that does not close its side still gets everything, and the batch counts as sent", async () => {
    let collected: Buffer = Buffer.alloc(0);
    const server: net.Server = net.createServer((socket: net.Socket): void => {
      socket.on("data", (chunk: Buffer): void => {
        collected = Buffer.concat([collected, chunk]);
      });
      // Never ends its side.
    });
    openServers.push(server);

    const port: number = await new Promise<number>(
      (resolve: (port: number) => void): void => {
        server.listen(0, "127.0.0.1", (): void => {
          resolve((server.address() as net.AddressInfo).port);
        });
      },
    );

    await new SyslogDestination({
      resolveTarget: toLoopback,
      closeGraceInMs: 200,
    }).deliver(
      deliveryOf({
        settings: syslogSettings({
          host: "syslog.example.com",
          port,
          protocol: "tcp",
        }),
        batch: batchOf(records),
      }),
    );

    expect(readOctetCountedFrames(collected)).toHaveLength(3);
  });

  test("nothing listening is worth trying again, and says what to check", async () => {
    const server: net.Server = net.createServer();
    const port: number = await new Promise<number>(
      (resolve: (port: number) => void): void => {
        server.listen(0, "127.0.0.1", (): void => {
          resolve((server.address() as net.AddressInfo).port);
        });
      },
    );
    await new Promise<void>((resolve: () => void): void => {
      server.close((): void => {
        resolve();
      });
    });

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new SyslogDestination({ resolveTarget: toLoopback }).deliver(
        deliveryOf({
          settings: syslogSettings({
            host: "syslog.example.com",
            port,
            protocol: "tcp",
          }),
          batch: batchOf(records),
        }),
      );
    });

    expect(error.message).toBe(
      `Nothing accepted the connection at syslog.example.com:${port} (ECONNREFUSED). Check the host, the port and the protocol. It is retried automatically.`,
    );
    expect(error.retryable).toBe(true);
  });

  test("the real egress policy refuses the server's own loopback", async () => {
    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new SyslogDestination().deliver({
        ...deliveryOf({
          settings: syslogSettings({ host: "127.0.0.1", port: 514, protocol: "tcp" }),
          batch: batchOf(records),
        }),
        egress: { targetLabel: "Syslog", blockPrivateAddresses: false },
      });
    });

    expect(error.message).toContain("Syslog host 127.0.0.1 is not allowed");
    expect(error.retryable).toBe(false);
  });
});

describe("syslog over TLS", () => {
  const certificate: TestCertificate = createTestCertificate({
    commonName: "syslog.test",
    dnsNames: ["syslog.test"],
  });

  const tlsReceiver: () => Promise<Receiver> = (): Promise<Receiver> => {
    return listen(
      tls.createServer({ key: certificate.key, cert: certificate.cert }),
      readAll,
    );
  };

  test("a receiver whose certificate the given CA signed gets every message, encrypted", async () => {
    const receiver: Receiver = await tlsReceiver();

    const receipt: { location: string } = await new SyslogDestination({
      resolveTarget: toLoopback,
    }).deliver(
      deliveryOf({
        settings: syslogSettings({
          host: "syslog.test",
          port: receiver.port,
          protocol: "tls",
          caCertificate: certificate.cert,
        }),
        batch: batchOf(records),
      }),
    );

    expect(receipt.location).toBe(`syslog+tls://syslog.test:${receiver.port}`);
    expect(readOctetCountedFrames(await receiver.received)).toHaveLength(3);
  });

  test("a certificate nobody trusts says to give its CA", async () => {
    const receiver: Receiver = await tlsReceiver();

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new SyslogDestination({ resolveTarget: toLoopback }).deliver(
        deliveryOf({
          settings: syslogSettings({
            host: "syslog.test",
            port: receiver.port,
            protocol: "tls",
          }),
          batch: batchOf(records),
        }),
      );
    });

    expect(error.message).toContain("The syslog receiver's certificate is not trusted");
    expect(error.message).toContain(
      "If a private CA signed it, paste that CA's certificate in CA certificate.",
    );
    expect(error.retryable).toBe(false);
  });

  test("a certificate for another name says to use the name it names", async () => {
    const receiver: Receiver = await tlsReceiver();

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new SyslogDestination({ resolveTarget: toLoopback }).deliver(
        deliveryOf({
          settings: syslogSettings({
            host: "logs.test",
            port: receiver.port,
            protocol: "tls",
            caCertificate: certificate.cert,
          }),
          batch: batchOf(records),
        }),
      );
    });

    expect(error.message).toBe(
      "The syslog receiver's certificate is not for logs.test (ERR_TLS_CERT_ALTNAME_INVALID). Use the host name the certificate names.",
    );
  });

  test("TLS to a receiver that speaks plain TCP fails without hanging", async () => {
    const receiver: Receiver = await listen(net.createServer(), readAll);

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new SyslogDestination({
        resolveTarget: toLoopback,
        timeoutInMs: 1000,
      }).deliver(
        deliveryOf({
          settings: syslogSettings({
            host: "syslog.test",
            port: receiver.port,
            protocol: "tls",
          }),
          batch: batchOf(records),
        }),
      );
    });

    expect(error).toBeInstanceOf(AuditLogExportDeliveryError);
  });
});

describe("the message", () => {
  test("names the host the installation runs at, or nothing", () => {
    expect(getSyslogHostName("oneuptime.example.com")).toBe(
      "oneuptime.example.com",
    );
    expect(getSyslogHostName("")).toBe("-");
    expect(getSyslogHostName("has space")).toBe("-");
  });

  test("octet counting counts bytes, not characters", () => {
    const message: string = toSyslogMessage({
      record: auditLogRecord({
        createdAt: "2026-10-24T09:15:03.000Z",
        resourceName: "été",
      }),
      hostName: "-",
    });
    const frame: Buffer = frameSyslogMessage(message, "octet-counting");
    const space: number = frame.indexOf(0x20);

    expect(Number(frame.subarray(0, space).toString())).toBe(
      Buffer.byteLength(message, "utf8"),
    );
  });
});
