import dgram from "dgram";
import net from "net";
import os from "os";
import tls from "tls";
import { afterEach, describe, expect, test } from "@jest/globals";
import SyslogDestination, {
  AUDIT_LOG_EXPORT_SYSLOG_PRIORITY,
  AUDIT_LOG_EXPORT_SYSLOG_UDP_BURST_BYTES,
  AUDIT_LOG_EXPORT_SYSLOG_UDP_BURST_DATAGRAMS,
  AUDIT_LOG_EXPORT_SYSLOG_UDP_NAME_LIMIT,
  AUDIT_LOG_EXPORT_SYSLOG_UDP_PAUSE_IN_MS,
  AUDIT_LOG_EXPORT_SYSLOG_UDP_SETTLE_IN_MS,
  AUDIT_LOG_EXPORT_SYSLOG_UDP_VALUE_LIMITS,
  describeSyslogError,
  fitSyslogMessage,
  frameSyslogMessage,
  getSyslogHostName,
  readSyslogUdpMessageSize,
  SyslogTargetResolver,
  SyslogUdpSocketFactory,
  toSyslogMessage,
} from "../../../Server/AuditLogExport/Destinations/SyslogDestination";
import {
  AuditLogExportDeliveryError,
  AuditLogExportDeliveryReceipt,
} from "../../../Server/AuditLogExport/Destinations/Types";
import { AuditLogExportSettings } from "Common/Server/Utils/AuditLog/Export/AuditLogExportSettings";
import { ResolvedAddress } from "Common/Server/Utils/DataSource/EgressGuard";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import {
  AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_UDP_MESSAGE_SIZE,
  AUDIT_LOG_EXPORT_MAX_SYSLOG_UDP_MESSAGE_SIZE,
  AUDIT_LOG_EXPORT_MIN_SYSLOG_UDP_MESSAGE_SIZE,
} from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import {
  AUDIT_LOG_EXPORT_RECORD_KEYS,
  AuditLogExportChange,
  AuditLogExportRecord,
} from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  describeLargeJson,
  limitText,
} from "Common/Utils/AuditLog/AuditLogValues";
import {
  createTestCertificate,
  TestCertificate,
} from "Common/Tests/Server/Utils/IRC/TestCertificate";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
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

  return new Promise<Receiver>(
    (resolve: (receiver: Receiver) => void): void => {
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
    },
  );
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
    const length: number = Number(
      data.subarray(offset, space).toString("ascii"),
    );

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

const syslogSettings: (
  config: Record<string, unknown>,
) => AuditLogExportSettings = (
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

const failureOf: (
  run: () => Promise<unknown>,
) => Promise<AuditLogExportDeliveryError> = async (
  run: () => Promise<unknown>,
): Promise<AuditLogExportDeliveryError> => {
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

    expect(receipt.location).toBe(
      `syslog://syslog.example.com:${receiver.port}`,
    );

    const frames: Array<string> = readOctetCountedFrames(
      await receiver.received,
    );

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
          settings: syslogSettings({
            host: "127.0.0.1",
            port: 514,
            protocol: "tcp",
          }),
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

    expect(error.message).toContain(
      "The syslog receiver's certificate is not trusted",
    );
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

/*
 * Syslog over UDP (issue #6392), against real UDP receivers on this
 * machine: one datagram per message, nothing around it (RFC 5426). A
 * datagram has no answer, so what can fail is heard only from the host -
 * a port that is closed (ICMP, ECONNREFUSED) - and that is what these
 * check, with the same loopback resolver as above.
 */

interface DatagramReceiver {
  port: number;
  datagrams: Array<Buffer>;
  // The first `count` datagrams, once that many have arrived.
  waitFor: (count: number) => Promise<Array<Buffer>>;
}

const openSockets: Array<dgram.Socket> = [];

afterEach(async () => {
  for (const socket of openSockets.splice(0)) {
    await new Promise<void>((resolve: () => void): void => {
      try {
        socket.close((): void => {
          resolve();
        });
      } catch {
        resolve();
      }
    });
  }
});

// Whether this machine answers on IPv6's loopback (a container may have IPv6 off).
const HAS_IPV6_LOOPBACK: boolean = Object.values(os.networkInterfaces()).some(
  (addresses: Array<os.NetworkInterfaceInfo> | undefined): boolean => {
    return (addresses || []).some((address: os.NetworkInterfaceInfo) => {
      return address.address === "::1";
    });
  },
);

function listenForDatagrams(
  type: "udp4" | "udp6" = "udp4",
  address: string = "127.0.0.1",
  port: number = 0,
): Promise<DatagramReceiver> {
  const socket: dgram.Socket = dgram.createSocket(type);
  const datagrams: Array<Buffer> = [];

  socket.on("message", (message: Buffer): void => {
    datagrams.push(message);
  });
  openSockets.push(socket);

  const waitFor: (count: number) => Promise<Array<Buffer>> = (
    count: number,
  ): Promise<Array<Buffer>> => {
    return new Promise<Array<Buffer>>(
      (resolve: (received: Array<Buffer>) => void): void => {
        const check: () => void = (): void => {
          if (datagrams.length >= count) {
            resolve(datagrams.slice(0, count));
            return;
          }

          setTimeout(check, 5);
        };

        check();
      },
    );
  };

  return new Promise<DatagramReceiver>(
    (
      resolve: (receiver: DatagramReceiver) => void,
      reject: (error: Error) => void,
    ): void => {
      socket.once("error", reject);
      socket.bind(port, address, (): void => {
        resolve({ port: socket.address().port, datagrams, waitFor });
      });
    },
  );
}

// A UDP port nothing listens on: one bound, read and closed again.
async function closedUdpPort(
  type: "udp4" | "udp6" = "udp4",
  address: string = "127.0.0.1",
): Promise<number> {
  const socket: dgram.Socket = dgram.createSocket(type);

  await new Promise<void>((resolve: () => void): void => {
    socket.bind(0, address, (): void => {
      resolve();
    });
  });

  const port: number = socket.address().port;

  await new Promise<void>((resolve: () => void): void => {
    socket.close((): void => {
      resolve();
    });
  });

  return port;
}

const udpSettings: (config: JSONObject) => AuditLogExportSettings = (
  config: JSONObject,
): AuditLogExportSettings => {
  return syslogSettings({
    host: "syslog.example.com",
    protocol: "udp",
    ...config,
  });
};

// A record whose one change holds a text of `length` characters, before and after.
const recordWithText: (length: number) => AuditLogExportRecord = (
  length: number,
): AuditLogExportRecord => {
  return auditLogRecord({
    createdAt: "2026-10-24T09:15:03.000Z",
    changes: [
      {
        field: "description",
        oldValue: "a".repeat(length),
        newValue: "b".repeat(length),
      },
    ],
  });
};

const bytesOf: (text: string) => number = (text: string): number => {
  return Buffer.byteLength(text, "utf8");
};

// "[… 12 more changes]" after the changes kept, "[… 12 changes]" when none is.
const LEFT_OUT_CHANGES: RegExp = /^\[… ([\d,]+) (more )?changes?\]$/;

describe("syslog over UDP", () => {
  test("one RFC 5424 message per datagram, nothing around it, on the port the export names", async () => {
    const receiver: DatagramReceiver = await listenForDatagrams();

    const receipt: AuditLogExportDeliveryReceipt = await new SyslogDestination({
      resolveTarget: toLoopback,
      hostName: "oneuptime.example.com",
      udpSettleInMs: 20,
    }).deliver(
      deliveryOf({
        settings: udpSettings({ port: receiver.port }),
        batch: batchOf(records),
      }),
    );

    expect(receipt).toEqual({
      location: `syslog+udp://syslog.example.com:${receiver.port}`,
      isUnconfirmed: true,
    });

    const datagrams: Array<Buffer> = await receiver.waitFor(3);

    datagrams.forEach((datagram: Buffer, index: number): void => {
      const message: string = datagram.toString("utf8");

      // No length in front of it, no line break after it: the datagram is the frame.
      expect(message).toBe(
        toSyslogMessage({
          record: records[index]!,
          hostName: "oneuptime.example.com",
        }),
      );

      const { header, json } = parseMessage(message);

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
    expect(
      parseMessage(datagrams[1]!.toString("utf8")).json["resourceName"],
    ).toBe("Multi-line\nname é");
  });

  test("the TLS settings left in a stored config change nothing: no framing, no certificate", async () => {
    const receiver: DatagramReceiver = await listenForDatagrams();

    // Settings as no save would keep them: framing and a certificate over UDP.
    await new SyslogDestination({
      resolveTarget: toLoopback,
      hostName: "-",
      udpSettleInMs: 20,
    }).deliver(
      deliveryOf({
        settings: {
          type: AuditLogExportDestinationType.Syslog,
          config: {
            host: "syslog.example.com",
            port: receiver.port,
            protocol: "udp",
            framing: "newline",
            caCertificate: "-----BEGIN CERTIFICATE-----\nnot one",
          },
          secrets: {},
        },
        batch: batchOf(records),
      }),
    );

    const datagrams: Array<Buffer> = await receiver.waitFor(3);

    for (const datagram of datagrams) {
      expect(datagram.toString("utf8").startsWith("<110>1 ")).toBe(true);
      expect(datagram.toString("utf8").endsWith("}")).toBe(true);
    }
  });

  test("a batch arrives whole and in order: a hundred datagrams", async () => {
    const receiver: DatagramReceiver = await listenForDatagrams();
    const many: Array<AuditLogExportRecord> = Array.from(
      { length: 100 },
      (_: unknown, index: number): AuditLogExportRecord => {
        return auditLogRecord({
          createdAt: new Date(
            Date.UTC(2026, 9, 24, 9, 15, 0) + index * 1000,
          ).toISOString(),
        });
      },
    );

    await new SyslogDestination({
      resolveTarget: toLoopback,
      udpSettleInMs: 20,
    }).deliver(
      deliveryOf({
        settings: udpSettings({ port: receiver.port }),
        batch: batchOf(many),
      }),
    );

    const datagrams: Array<Buffer> = await receiver.waitFor(100);

    expect(
      datagrams.map((datagram: Buffer): unknown => {
        return parseMessage(datagram.toString("utf8")).json["id"];
      }),
    ).toEqual(
      many.map((record: AuditLogExportRecord): string => {
        return record.id;
      }),
    );
  });

  /*
   * Sent back to back, a receiver's socket buffer (212 KB by default) runs
   * over: of 500 datagrams of 8 KB, a receiver in this process got 13. Sent
   * in bursts with a pause between, every one arrives.
   */
  test("a full batch of large entries arrives whole: the datagrams go out in bursts the receiver's buffer holds", async () => {
    const receiver: DatagramReceiver = await listenForDatagrams();
    const large: Array<AuditLogExportRecord> = Array.from(
      { length: 500 },
      (_: unknown, index: number): AuditLogExportRecord => {
        return {
          ...recordWithText(3500),
          id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        };
      },
    );

    await new SyslogDestination({
      resolveTarget: toLoopback,
      udpSettleInMs: 20,
    }).deliver(
      deliveryOf({
        settings: udpSettings({ port: receiver.port }),
        batch: batchOf(large),
      }),
    );

    const datagrams: Array<Buffer> = await receiver.waitFor(500);

    expect(datagrams[0]!.length).toBeGreaterThan(7000);
    expect(
      datagrams.map((datagram: Buffer): unknown => {
        return parseMessage(datagram.toString("utf8")).json["id"];
      }),
    ).toEqual(
      large.map((record: AuditLogExportRecord): string => {
        return record.id;
      }),
    );
  });

  test("a burst is at most 32 datagrams or 64 KB, then a pause of 10 ms", () => {
    expect(AUDIT_LOG_EXPORT_SYSLOG_UDP_BURST_DATAGRAMS).toBe(32);
    expect(AUDIT_LOG_EXPORT_SYSLOG_UDP_BURST_BYTES).toBe(64 * 1024);
    expect(AUDIT_LOG_EXPORT_SYSLOG_UDP_PAUSE_IN_MS).toBe(10);
  });

  test("an entry too long for the size arrives shortened, at most that many bytes, and whole JSON", async () => {
    const receiver: DatagramReceiver = await listenForDatagrams();
    const long: AuditLogExportRecord = recordWithText(20000);

    await new SyslogDestination({
      resolveTarget: toLoopback,
      udpSettleInMs: 20,
    }).deliver(
      deliveryOf({
        settings: udpSettings({ port: receiver.port, maxMessageSize: 2048 }),
        batch: batchOf([long, records[0]!]),
      }),
    );

    const [shortened, whole] = await receiver.waitFor(2);

    expect(shortened!.length).toBeLessThanOrEqual(2048);

    const json: Record<string, unknown> = parseMessage(
      shortened!.toString("utf8"),
    ).json;
    const change: AuditLogExportChange = (
      json["changes"] as Array<AuditLogExportChange>
    )[0]!;

    expect(json["id"]).toBe(long.id);
    expect(change.field).toBe("description");
    expect(String(change.newValue)).toMatch(
      /^b+ \[… [\d,]+ more characters\]$/,
    );

    // An entry that fits goes as it is.
    expect(whole!.toString("utf8")).toBe(
      toSyslogMessage({ record: records[0]!, hostName: getSyslogHostName() }),
    );
  });

  test("an export that names no size sends at most 8192 bytes a datagram", async () => {
    const receiver: DatagramReceiver = await listenForDatagrams();

    await new SyslogDestination({
      resolveTarget: toLoopback,
      udpSettleInMs: 20,
    }).deliver(
      deliveryOf({
        settings: udpSettings({ port: receiver.port }),
        batch: batchOf([recordWithText(9000)]),
      }),
    );

    const [datagram] = await receiver.waitFor(1);

    expect(datagram!.length).toBeLessThanOrEqual(8192);
    expect(datagram!.length).toBeGreaterThan(1024);
    expect(() => {
      return parseMessage(datagram!.toString("utf8"));
    }).not.toThrow();
  });

  test("the largest size a datagram carries goes out whole: 65,507 bytes", async () => {
    const receiver: DatagramReceiver = await listenForDatagrams();

    await new SyslogDestination({
      resolveTarget: toLoopback,
      udpSettleInMs: 20,
    }).deliver(
      deliveryOf({
        settings: udpSettings({
          port: receiver.port,
          maxMessageSize: AUDIT_LOG_EXPORT_MAX_SYSLOG_UDP_MESSAGE_SIZE,
        }),
        batch: batchOf([recordWithText(200000)]),
      }),
    );

    const [datagram] = await receiver.waitFor(1);

    expect(datagram!.length).toBeLessThanOrEqual(65507);
    expect(datagram!.length).toBeGreaterThan(8192);
    expect(() => {
      return parseMessage(datagram!.toString("utf8"));
    }).not.toThrow();
  });

  test("a port nothing listens on is heard (ECONNREFUSED), says what to check, and is retried", async () => {
    const port: number = await closedUdpPort();

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new SyslogDestination({
        resolveTarget: toLoopback,
        udpSettleInMs: 500,
      }).deliver(
        deliveryOf({
          settings: udpSettings({ port }),
          batch: batchOf(records),
        }),
      );
    });

    expect(error.message).toBe(
      `Nothing receives syslog over UDP at syslog.example.com:${port}: its host answered that the port is closed (ECONNREFUSED). Check the host, the port and the protocol. It is retried automatically.`,
    );
    expect(error.retryable).toBe(true);
  });

  test("one datagram to a closed port is heard too, in the moment waited after it (a test entry)", async () => {
    const port: number = await closedUdpPort();

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new SyslogDestination({
        resolveTarget: toLoopback,
        udpSettleInMs: 500,
      }).deliver(
        deliveryOf({
          settings: udpSettings({ port }),
          batch: batchOf([records[0]!], true),
        }),
      );
    });

    expect(error.message).toContain("(ECONNREFUSED)");
    expect(error.retryable).toBe(true);
  });

  /*
   * On this machine the host's answer is back before the send that drew it
   * has called back. Across a network it takes a round trip, so the batch
   * waits for it after its last datagram: here the answer is held back as a
   * network would hold it, and a batch that did not wait would call itself
   * sent.
   */
  test("an answer that the port is closed is waited for, though it takes a round trip to come", async () => {
    const port: number = await closedUdpPort();
    const heldBack: Array<string> = [];
    const answersLate: SyslogUdpSocketFactory = (
      type: dgram.SocketType,
    ): dgram.Socket => {
      const socket: dgram.Socket = dgram.createSocket(type);
      const emit: (event: string, ...args: Array<unknown>) => boolean =
        socket.emit.bind(socket);

      (
        socket as unknown as {
          emit: (event: string, ...args: Array<unknown>) => boolean;
        }
      ).emit = (event: string, ...args: Array<unknown>): boolean => {
        if (event !== "error") {
          return emit(event, ...args);
        }

        heldBack.push(String((args[0] as NodeJS.ErrnoException)?.code));
        setTimeout((): void => {
          emit(event, ...args);
        }, 100);

        return true;
      };

      return socket;
    };

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new SyslogDestination({
        resolveTarget: toLoopback,
        udpSettleInMs: 500,
        createUdpSocket: answersLate,
      }).deliver(
        deliveryOf({
          settings: udpSettings({ port }),
          batch: batchOf([records[0]!], true),
        }),
      );
    });

    // The answer did come late, and the batch still heard it.
    expect(heldBack).toEqual(["ECONNREFUSED"]);
    expect(error.message).toContain("(ECONNREFUSED)");
    expect(error.retryable).toBe(true);
  });

  test("waits a second by default for the host to answer, after the last datagram", () => {
    expect(AUDIT_LOG_EXPORT_SYSLOG_UDP_SETTLE_IN_MS).toBe(1000);
  });

  test("an address the socket cannot be pointed at gives way to the next, before anything is sent", async () => {
    const receiver: DatagramReceiver = await listenForDatagrams();

    // A UDP socket may not be pointed at a broadcast address (EACCES) unless it asks to.
    const receipt: AuditLogExportDeliveryReceipt = await new SyslogDestination({
      resolveTarget: async (): Promise<Array<ResolvedAddress>> => {
        return [
          { address: "255.255.255.255", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ];
      },
      udpSettleInMs: 20,
    }).deliver(
      deliveryOf({
        settings: udpSettings({ port: receiver.port }),
        batch: batchOf(records),
      }),
    );

    expect(receipt.isUnconfirmed).toBe(true);
    expect(await receiver.waitFor(3)).toHaveLength(3);
  });

  test("no address to point a socket at fails, says why, and is retried", async () => {
    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new SyslogDestination({
        resolveTarget: async (): Promise<Array<ResolvedAddress>> => {
          return [{ address: "255.255.255.255", family: 4 }];
        },
        udpSettleInMs: 20,
      }).deliver(
        deliveryOf({
          settings: udpSettings({ port: 514 }),
          batch: batchOf(records),
        }),
      );
    });

    expect(error.message).toMatch(
      /^Sending syslog over UDP to syslog\.example\.com:514 failed \(EACCES\): .+\. It is retried automatically\.$/,
    );
    expect(error.retryable).toBe(true);
  });

  test("the real egress policy refuses the server's own loopback over UDP too", async () => {
    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new SyslogDestination().deliver({
        ...deliveryOf({
          settings: syslogSettings({
            host: "127.0.0.1",
            protocol: "udp",
          }),
          batch: batchOf(records),
        }),
        egress: { targetLabel: "Syslog", blockPrivateAddresses: false },
      });
    });

    expect(error.message).toContain("Syslog host 127.0.0.1 is not allowed");
    expect(error.retryable).toBe(false);
  });

  (HAS_IPV6_LOOPBACK ? test : test.skip)(
    "an IPv6 receiver gets its datagrams on a udp6 socket",
    async () => {
      const receiver: DatagramReceiver = await listenForDatagrams(
        "udp6",
        "::1",
      );

      const receipt: AuditLogExportDeliveryReceipt =
        await new SyslogDestination({
          resolveTarget: async (): Promise<Array<ResolvedAddress>> => {
            return [{ address: "::1", family: 6 }];
          },
          udpSettleInMs: 20,
        }).deliver(
          deliveryOf({
            settings: udpSettings({
              host: "2001:db8::10",
              port: receiver.port,
            }),
            batch: batchOf(records),
          }),
        );

      expect(receipt.location).toBe(
        `syslog+udp://2001:db8::10:${receiver.port}`,
      );
      expect(await receiver.waitFor(3)).toHaveLength(3);
    },
  );

  (HAS_IPV6_LOOPBACK ? test : test.skip)(
    "once a datagram has left, a failure is the batch's: the next address is not sent the batch again",
    async () => {
      // A receiver on IPv6's loopback, and the same port closed on IPv4's.
      const receiver: DatagramReceiver = await listenForDatagrams(
        "udp6",
        "::1",
      );
      const probe: dgram.Socket = dgram.createSocket("udp4");
      const isPortFree: boolean = await new Promise<boolean>(
        (resolve: (free: boolean) => void): void => {
          probe.once("error", (): void => {
            resolve(false);
          });
          probe.bind(receiver.port, "127.0.0.1", (): void => {
            probe.close((): void => {
              resolve(true);
            });
          });
        },
      );

      expect(isPortFree).toBe(true);

      const error: AuditLogExportDeliveryError = await failureOf(() => {
        return new SyslogDestination({
          resolveTarget: async (): Promise<Array<ResolvedAddress>> => {
            return [
              { address: "127.0.0.1", family: 4 },
              { address: "::1", family: 6 },
            ];
          },
          udpSettleInMs: 300,
        }).deliver(
          deliveryOf({
            settings: udpSettings({ port: receiver.port }),
            batch: batchOf(records),
          }),
        );
      });

      expect(error.message).toContain("(ECONNREFUSED)");

      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 100);
      });

      expect(receiver.datagrams).toHaveLength(0);
    },
  );
});

describe("an entry fitted to a datagram", () => {
  const HOST_NAME: string = "oneuptime.example.com";

  const changesOf: (message: string) => Array<AuditLogExportChange> = (
    message: string,
  ): Array<AuditLogExportChange> => {
    return parseMessage(message).json["changes"] as Array<AuditLogExportChange>;
  };

  test("goes whole when it fits, exactly as over TCP", () => {
    const record: AuditLogExportRecord = records[0]!;
    const fitted: { message: string; isShortened: boolean } = fitSyslogMessage({
      record,
      hostName: HOST_NAME,
      maxBytes: 1024,
    });

    expect(fitted).toEqual({
      message: toSyslogMessage({ record, hostName: HOST_NAME }),
      isShortened: false,
    });
  });

  test("an entry exactly the size goes whole; one byte more is shortened", () => {
    const record: AuditLogExportRecord = recordWithText(3000);
    const size: number = bytesOf(
      toSyslogMessage({ record, hostName: HOST_NAME }),
    );

    expect(
      fitSyslogMessage({ record, hostName: HOST_NAME, maxBytes: size })
        .isShortened,
    ).toBe(false);
    expect(
      fitSyslogMessage({ record, hostName: HOST_NAME, maxBytes: size - 1 })
        .isShortened,
    ).toBe(true);
  });

  test("text keeps its start and says how much is left out, at the first limit that fits", () => {
    const record: AuditLogExportRecord = recordWithText(10000);

    // Two 4,096-character excerpts are more than 8,192 bytes with the rest; two of 1,024 fit.
    const fitted: { message: string; isShortened: boolean } = fitSyslogMessage({
      record,
      hostName: HOST_NAME,
      maxBytes: 8192,
    });
    const change: AuditLogExportChange = changesOf(fitted.message)[0]!;

    expect(fitted.isShortened).toBe(true);
    expect(bytesOf(fitted.message)).toBeLessThanOrEqual(8192);
    expect(change).toEqual({
      field: "description",
      oldValue: limitText("a".repeat(10000), 1024),
      newValue: limitText("b".repeat(10000), 1024),
    });
    expect(change.newValue).toBe(
      `${"b".repeat(1024)} [… 8,976 more characters]`,
    );

    // With room for 4,096 characters of each, that is what is kept.
    expect(
      changesOf(
        fitSyslogMessage({ record, hostName: HOST_NAME, maxBytes: 16384 })
          .message,
      )[0]!.newValue,
    ).toBe(limitText("b".repeat(10000), 4096));
  });

  test("the limits go from 4096 characters down to 16", () => {
    expect([...AUDIT_LOG_EXPORT_SYSLOG_UDP_VALUE_LIMITS]).toEqual([
      4096, 1024, 256, 64, 16,
    ]);
    expect(AUDIT_LOG_EXPORT_SYSLOG_UDP_NAME_LIMIT).toBe(128);
  });

  test("JSON too long for the limit is recorded by its size, as the audit log records it; JSON that fits stays JSON", () => {
    const big: JSONObject = {};

    for (let index: number = 0; index < 400; index++) {
      big[`key${index}`] = `value number ${index}`;
    }

    const record: AuditLogExportRecord = auditLogRecord({
      createdAt: "2026-10-24T09:15:03.000Z",
      changes: [
        { field: "layout", oldValue: big, newValue: { small: true } },
        { field: "count", oldValue: 1, newValue: 2 },
        { field: "flag", oldValue: false, newValue: null },
      ],
    });
    const fitted: { message: string; isShortened: boolean } = fitSyslogMessage({
      record,
      hostName: HOST_NAME,
      maxBytes: 4096,
    });

    expect(changesOf(fitted.message)).toEqual([
      {
        field: "layout",
        oldValue: describeLargeJson(JSON.stringify(big).length),
        newValue: { small: true },
      },
      { field: "count", oldValue: 1, newValue: 2 },
      { field: "flag", oldValue: false, newValue: null },
    ]);
    expect(describeLargeJson(JSON.stringify(big).length)).toMatch(
      /^\[[\d.]+ KB of JSON\]$/,
    );
  });

  test("a change keeps the keys it had: a create's change has no before", () => {
    const record: AuditLogExportRecord = auditLogRecord({
      createdAt: "2026-10-24T09:15:03.000Z",
      changes: [{ field: "description", newValue: "c".repeat(5000) }],
    });

    const change: AuditLogExportChange = changesOf(
      fitSyslogMessage({ record, hostName: HOST_NAME, maxBytes: 2048 }).message,
    )[0]!;

    expect(Object.keys(change)).toEqual(["field", "newValue"]);
  });

  test("version 2's summary keeps fewer lines, each shorter, the last counting the rest", () => {
    const record: AuditLogExportRecord = {
      ...auditLogRecord({ createdAt: "2026-10-24T09:15:03.000Z" }),
      schemaVersion: 2,
      changes: [
        {
          field: "steps",
          oldValue: "3 steps",
          newValue: "4 steps",
          summary: Array.from({ length: 25 }, (_: unknown, index: number) => {
            return `Changed step ${index} › ${"x".repeat(200)}`;
          }),
        },
      ],
    };

    const fitted: { message: string; isShortened: boolean } = fitSyslogMessage({
      record,
      hostName: HOST_NAME,
      maxBytes: 2048,
    });
    const summary: Array<string> = changesOf(fitted.message)[0]!.summary!;

    expect(bytesOf(fitted.message)).toBeLessThanOrEqual(2048);
    expect(summary.length).toBeLessThan(25);
    expect(summary[summary.length - 1]).toBe(
      `and ${25 - (summary.length - 1)} more lines`,
    );
    expect(summary[0]!.startsWith("Changed step 0 › ")).toBe(true);
  });

  test("when even short values do not fit, the first changes are kept and one more counts the rest", () => {
    const record: AuditLogExportRecord = auditLogRecord({
      createdAt: "2026-10-24T09:15:03.000Z",
      changes: Array.from({ length: 300 }, (_: unknown, index: number) => {
        return { field: `field${index}`, oldValue: index, newValue: index + 1 };
      }),
    });

    const fitted: { message: string; isShortened: boolean } = fitSyslogMessage({
      record,
      hostName: HOST_NAME,
      maxBytes: 1024,
    });
    const changes: Array<AuditLogExportChange> = changesOf(fitted.message);
    const kept: Array<AuditLogExportChange> = changes.slice(0, -1);
    const marker: string = changes[changes.length - 1]!.field;
    const counted: number = Number(
      LEFT_OUT_CHANGES.exec(marker)![1]!.replace(",", ""),
    );

    expect(bytesOf(fitted.message)).toBeLessThanOrEqual(1024);
    expect(kept.length).toBeGreaterThan(0);
    expect(marker).toBe(`[… ${counted} more changes]`);
    expect(kept.length + counted).toBe(300);
    expect(kept).toEqual(record.changes.slice(0, kept.length));
    // A version 1 change has no summary, so neither has the one that counts.
    expect(Object.keys(changes[changes.length - 1]!)).toEqual(["field"]);

    // As many as fit: one more would not.
    const oneMore: string = toSyslogMessage({
      record: {
        ...record,
        changes: [
          ...record.changes.slice(0, kept.length + 1),
          { field: `[… ${counted - 1} more changes]` },
        ],
      },
      hostName: HOST_NAME,
    });

    expect(bytesOf(oneMore)).toBeGreaterThan(1024);
  });

  test("version 2's counting change has a summary of null, as every version 2 change does", () => {
    const record: AuditLogExportRecord = {
      ...auditLogRecord({ createdAt: "2026-10-24T09:15:03.000Z" }),
      schemaVersion: 2,
      changes: Array.from({ length: 200 }, (_: unknown, index: number) => {
        return {
          field: `field${index}`,
          oldValue: index,
          newValue: index + 1,
          summary: null,
        };
      }),
    };

    const changes: Array<AuditLogExportChange> = changesOf(
      fitSyslogMessage({ record, hostName: HOST_NAME, maxBytes: 1024 }).message,
    );

    expect(changes[changes.length - 1]).toEqual({
      field: expect.stringMatching(LEFT_OUT_CHANGES) as unknown as string,
      summary: null,
    });
  });

  test("when no change fits, one counts them all: [… 1 change]", () => {
    const record: AuditLogExportRecord = auditLogRecord({
      createdAt: "2026-10-24T09:15:03.000Z",
      // A field's name is never shortened, so this change never fits 1024 bytes.
      changes: [{ field: "f".repeat(900), oldValue: 1, newValue: 2 }],
    });

    const fitted: { message: string; isShortened: boolean } = fitSyslogMessage({
      record,
      hostName: HOST_NAME,
      maxBytes: 1024,
    });

    expect(fitted.isShortened).toBe(true);
    expect(bytesOf(fitted.message)).toBeLessThanOrEqual(1024);
    expect(changesOf(fitted.message)).toEqual([{ field: "[… 1 change]" }]);
  });

  test("names are cut to 128 characters only once the values are being shortened", () => {
    const longName: string = "N".repeat(3000);
    const record: AuditLogExportRecord = {
      ...recordWithText(10),
      resourceName: longName,
      userName: "Jane Doe",
    };

    // It fits 8192 bytes whole.
    expect(
      parseMessage(
        fitSyslogMessage({ record, hostName: HOST_NAME, maxBytes: 8192 })
          .message,
      ).json["resourceName"],
    ).toBe(longName);

    const json: Record<string, unknown> = parseMessage(
      fitSyslogMessage({ record, hostName: HOST_NAME, maxBytes: 2048 }).message,
    ).json;

    expect(json["resourceName"]).toBe(limitText(longName, 128));
    expect(json["userName"]).toBe("Jane Doe");
    // Ids, times and kinds are never cut.
    expect(json["resourceId"]).toBe(record.resourceId);
    expect(json["createdAt"]).toBe(record.createdAt);
    expect(json["action"]).toBe(record.action);
  });

  test("an entry that cannot be made to fit goes as the shortest whole JSON there is", () => {
    const id: string = "11111111-2222-4333-8444-555555555555";
    const record: AuditLogExportRecord = {
      ...recordWithText(5000),
      resourceName: "R".repeat(500),
      userName: "U".repeat(500),
      userEmail: `${"e".repeat(300)}@example.com`,
      apiKeyId: id,
      apiKeyName: "K".repeat(500),
      mcpOAuthGrantId: id,
      mcpClientName: "M".repeat(500),
      workflowId: id,
      workflowName: "W".repeat(500),
    };
    const hostName: string = "h".repeat(255);

    const fitted: { message: string; isShortened: boolean } = fitSyslogMessage({
      record,
      hostName,
      maxBytes: 1024,
    });
    const json: Record<string, unknown> = parseMessage(fitted.message).json;

    expect(fitted.isShortened).toBe(true);
    expect(bytesOf(fitted.message)).toBeGreaterThan(1024);
    expect(bytesOf(fitted.message)).toBeLessThan(2048);
    expect(Object.keys(json)).toEqual([...AUDIT_LOG_EXPORT_RECORD_KEYS]);
    expect(json["changes"]).toEqual([{ field: "[… 1 change]" }]);
    expect(json["workflowName"]).toBe(limitText("W".repeat(500), 128));
  });

  test("any entry, any size: at most that many bytes, whole UTF-8, whole JSON, every key, the changes in order", () => {
    const random: SeededRandom = seededRandom(6392);
    const alphabet: Array<string> = [
      "a",
      "Z",
      "7",
      " ",
      "é",
      "日本",
      "😀",
      '"',
      "\\",
      "\n",
      "\t",
      String.fromCharCode(0x2028),
      "<",
      "&",
    ];
    const text: (length: number) => string = (length: number): string => {
      let value: string = "";

      for (let index: number = 0; index < length; index++) {
        value += alphabet[random(alphabet.length)]!;
      }

      return value;
    };
    // A value as a change records one: long text at the top, small JSON two levels deep.
    const value: (depth: number) => JSONValue = (depth: number): JSONValue => {
      switch (random(depth >= 2 ? 4 : 6)) {
        case 0:
          return text(depth === 0 ? random(12000) : random(200));
        case 1:
          return random(100000) - 50000;
        case 2:
          return random(2) === 1;
        case 3:
          return null;
        case 4: {
          const object: JSONObject = {};

          for (let index: number = random(8); index > 0; index--) {
            object[text(1 + random(10))] = value(depth + 1);
          }

          return object;
        }
        default:
          return Array.from({ length: random(8) }, () => {
            return value(depth + 1);
          });
      }
    };
    const sizes: Array<number> = [1024, 1500, 2048, 4096, 8192, 65507];

    for (let run: number = 0; run < 150; run++) {
      const schemaVersion: 1 | 2 = random(2) === 0 ? 1 : 2;
      const changes: Array<AuditLogExportChange> = Array.from(
        { length: random(60) },
        (): AuditLogExportChange => {
          const change: AuditLogExportChange = { field: text(1 + random(20)) };

          if (random(4) !== 0) {
            change.oldValue = value(0);
          }

          if (random(4) !== 0) {
            change.newValue = value(0);
          }

          if (schemaVersion === 2) {
            change.summary =
              random(2) === 0
                ? null
                : Array.from({ length: 1 + random(30) }, () => {
                    return text(random(300));
                  });
          }

          return change;
        },
      );
      const record: AuditLogExportRecord = {
        ...auditLogRecord({ createdAt: "2026-10-24T09:15:03.000Z" }),
        schemaVersion,
        resourceName: text(random(120)),
        userName: text(random(60)),
        changes,
      };
      const maxBytes: number =
        random(3) === 0
          ? AUDIT_LOG_EXPORT_MIN_SYSLOG_UDP_MESSAGE_SIZE +
            random(
              AUDIT_LOG_EXPORT_MAX_SYSLOG_UDP_MESSAGE_SIZE -
                AUDIT_LOG_EXPORT_MIN_SYSLOG_UDP_MESSAGE_SIZE +
                1,
            )
          : sizes[random(sizes.length)]!;

      const whole: string = toSyslogMessage({ record, hostName: HOST_NAME });
      const fitted: { message: string; isShortened: boolean } =
        fitSyslogMessage({ record, hostName: HOST_NAME, maxBytes });
      const context: string = `run ${run}, ${maxBytes} bytes`;

      expect([context, bytesOf(fitted.message) <= maxBytes]).toEqual([
        context,
        true,
      ]);
      expect([context, fitted.isShortened]).toEqual([
        context,
        bytesOf(whole) > maxBytes,
      ]);
      // Never half a character: what goes out reads back as it was written.
      expect(
        Buffer.from(fitted.message, "utf8").toString("utf8") === fitted.message,
      ).toBe(true);
      // The same entry fits the same way every time.
      expect(
        fitSyslogMessage({ record, hostName: HOST_NAME, maxBytes }).message,
      ).toBe(fitted.message);

      const json: Record<string, unknown> = parseMessage(fitted.message).json;
      const sent: Array<AuditLogExportChange> = json[
        "changes"
      ] as Array<AuditLogExportChange>;

      expect(Object.keys(json)).toEqual([...AUDIT_LOG_EXPORT_RECORD_KEYS]);
      expect([json["id"], json["createdAt"], json["schemaVersion"]]).toEqual([
        record.id,
        record.createdAt,
        schemaVersion,
      ]);

      // The alphabet has no "[" or "…": only the change that counts the rest reads like one.
      const last: AuditLogExportChange | undefined = sent[sent.length - 1];
      const counting: RegExpExecArray | null = last
        ? LEFT_OUT_CHANGES.exec(last.field)
        : null;
      const kept: Array<AuditLogExportChange> = counting
        ? sent.slice(0, -1)
        : sent;

      expect([
        context,
        kept.length + (counting ? Number(counting[1]!.replace(/,/g, "")) : 0),
      ]).toEqual([context, changes.length]);

      kept.forEach((change: AuditLogExportChange, index: number): void => {
        expect(change.field).toBe(changes[index]!.field);
        expect(Object.keys(change)).toEqual(Object.keys(changes[index]!));
      });
    }
  });
});

describe("the size a UDP export sends at most", () => {
  test("is the one it names, the default when it names none, and never one a datagram cannot carry", () => {
    const cases: Array<[string, number]> = [
      ["", AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_UDP_MESSAGE_SIZE],
      ["  ", 8192],
      ["2048", 2048],
      [" 4096 ", 4096],
      ["1024", 1024],
      ["65507", 65507],
      // What a save refuses, read as safely as it can be.
      ["100", 1024],
      ["100000", 65507],
      ["2048.5", 8192],
      ["big", 8192],
    ];

    for (const [value, expected] of cases) {
      expect([value, readSyslogUdpMessageSize(value)]).toEqual([
        value,
        expected,
      ]);
    }
  });
});

describe("what a UDP failure says", () => {
  const describeUdp: (error: unknown) => AuditLogExportDeliveryError = (
    error: unknown,
  ): AuditLogExportDeliveryError => {
    return describeSyslogError({
      error,
      host: "siem.example.com",
      port: 514,
      protocol: "udp",
    });
  };

  test("a closed port is retried; a datagram too long names the setting to lower", () => {
    expect(describeUdp({ code: "ECONNREFUSED", message: "x" })).toEqual(
      expect.objectContaining({
        message:
          "Nothing receives syslog over UDP at siem.example.com:514: its host answered that the port is closed (ECONNREFUSED). Check the host, the port and the protocol. It is retried automatically.",
        retryable: true,
      }),
    );

    const tooLong: AuditLogExportDeliveryError = describeUdp({
      code: "EMSGSIZE",
      message: "send EMSGSIZE",
    });

    expect(tooLong.message).toBe(
      "A message was too long to send over UDP to siem.example.com:514 (EMSGSIZE). Lower Maximum message size.",
    );
    expect(tooLong.retryable).toBe(false);
  });

  test("anything else says what failed, and is retried", () => {
    const failure: AuditLogExportDeliveryError = describeUdp({
      code: "ENETUNREACH",
      message: "connect ENETUNREACH 2001:db8::1:514.",
    });

    expect(failure.message).toBe(
      "Sending syslog over UDP to siem.example.com:514 failed (ENETUNREACH): connect ENETUNREACH 2001:db8::1:514. It is retried automatically.",
    );
    expect(failure.retryable).toBe(true);
    expect(describeUdp("oops").message).toBe(
      "Sending syslog over UDP to siem.example.com:514 failed: oops. It is retried automatically.",
    );
  });

  test("TCP's words are unchanged: a connection was refused", () => {
    expect(
      describeSyslogError({
        error: { code: "ECONNREFUSED" },
        host: "siem.example.com",
        port: 514,
        protocol: "tcp",
      }).message,
    ).toBe(
      "Nothing accepted the connection at siem.example.com:514 (ECONNREFUSED). Check the host, the port and the protocol. It is retried automatically.",
    );
  });
});
