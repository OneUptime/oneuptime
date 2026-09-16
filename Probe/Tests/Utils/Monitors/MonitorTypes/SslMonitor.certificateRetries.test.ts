// Set required env vars before importing SSLMonitor (through Register/Config).
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Utils/OnlineCheck", () => {
  return {
    __esModule: true,
    default: {
      canProbeMonitorWebsiteMonitors: jest.fn(async (): Promise<boolean> => {
        return true;
      }),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

import https from "https";
import net, { AddressInfo } from "net";
import tls from "tls";
import Sleep from "Common/Types/Sleep";
import SSLMonitor from "../../../../Utils/Monitors/MonitorTypes/SslMonitor";
import SelfSignedCertificate from "./SslTestCertificates";

/*
 * getCertificate's own `retry` counts retries AFTER the first handshake
 * attempt, like every other retry value in the probe: 0 connects once, 1
 * connects up to twice, and no value keeps the three attempts it always made.
 * It used to be a total-attempt count read with `||`, so 0 and 1 both meant
 * one attempt and an explicit 0 turned back into three.
 *
 * Attempts are counted on the server side, from real connections, so the
 * test does not depend on how the retry loop is written. Only the one-second
 * pause between attempts is mocked out.
 */

// Accepts each connection and drops it at once: a retryable connection error.
let droppingServer: net.Server;
let droppingPort: number = 0;
let droppedConnections: number = 0;

/*
 * Serves HTTPS with a self-signed certificate, and drops the first
 * `dropsBeforeServing` connections before the handshake.
 */
let flakyServer: https.Server;
let flakyPort: number = 0;
let flakyConnections: number = 0;
let dropsBeforeServing: number = 0;

const openSockets: Set<net.Socket> = new Set<net.Socket>();

function listen(server: net.Server): Promise<number> {
  return new Promise<number>((resolve: (port: number) => void) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
}

beforeAll(async () => {
  droppingServer = net.createServer((socket: net.Socket) => {
    droppedConnections++;
    socket.on("error", () => {
      // The client may see the reset first; nothing to do here.
    });
    socket.destroy();
  });
  droppingPort = await listen(droppingServer);

  flakyServer = https.createServer(
    {
      key: SelfSignedCertificate.key,
      cert: SelfSignedCertificate.cert,
    },
    (_req: unknown, res: { end: (body: string) => void }) => {
      res.end("ok");
    },
  );
  // 'connection' fires for the raw TCP socket, before any TLS is spoken.
  flakyServer.on("connection", (socket: net.Socket) => {
    flakyConnections++;
    socket.on("error", () => {
      // Expected for the dropped connections.
    });

    if (flakyConnections <= dropsBeforeServing) {
      socket.destroy();
      return;
    }

    openSockets.add(socket);
    socket.on("close", () => {
      openSockets.delete(socket);
    });
  });
  flakyPort = await listen(flakyServer);
});

afterAll(async () => {
  for (const socket of openSockets) {
    socket.destroy();
  }

  await close(droppingServer);
  await close(flakyServer);
});

describe("SSLMonitor.getCertificate retries", () => {
  let sleepSpy: jest.Mock;

  beforeEach(() => {
    droppedConnections = 0;
    flakyConnections = 0;
    dropsBeforeServing = 0;
    sleepSpy = jest
      .spyOn(Sleep, "sleep")
      .mockResolvedValue(undefined as never) as unknown as jest.Mock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("keeps three handshake attempts when no retry value is passed", async () => {
    await expect(
      SSLMonitor.getCertificate({
        host: "127.0.0.1",
        port: droppingPort,
        rejectUnauthorized: false,
        timeoutInMs: 5000,
      }),
    ).rejects.toThrow();

    expect(droppedConnections).toBe(3);
    expect(sleepSpy).toHaveBeenCalledTimes(2);
  }, 20000);

  test("connects exactly once when retry is 0", async () => {
    await expect(
      SSLMonitor.getCertificate({
        host: "127.0.0.1",
        port: droppingPort,
        rejectUnauthorized: false,
        timeoutInMs: 5000,
        retry: 0,
      }),
    ).rejects.toThrow();

    expect(droppedConnections).toBe(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  }, 20000);

  test("connects twice when retry is 1", async () => {
    await expect(
      SSLMonitor.getCertificate({
        host: "127.0.0.1",
        port: droppingPort,
        rejectUnauthorized: false,
        timeoutInMs: 5000,
        retry: 1,
      }),
    ).rejects.toThrow();

    expect(droppedConnections).toBe(2);
    expect(sleepSpy).toHaveBeenCalledTimes(1);
  }, 20000);

  test("a continuing call does not retry past the caller's count", async () => {
    // Attempt 3 of "retry: 2" is the last one, whoever makes it.
    await expect(
      SSLMonitor.getCertificate({
        host: "127.0.0.1",
        port: droppingPort,
        rejectUnauthorized: false,
        timeoutInMs: 5000,
        retry: 2,
        currentRetryCount: 3,
      }),
    ).rejects.toThrow();

    expect(droppedConnections).toBe(1);
  }, 20000);

  test("a retry recovers the certificate after a dropped connection", async () => {
    dropsBeforeServing = 1;

    const certificate: tls.PeerCertificate = await SSLMonitor.getCertificate({
      host: "127.0.0.1",
      port: flakyPort,
      rejectUnauthorized: false,
      timeoutInMs: 5000,
      retry: 1,
    });

    expect(certificate.subject).toBeTruthy();
    expect(flakyConnections).toBe(2);
  }, 20000);

  test("with retry 0 the same dropped connection is final", async () => {
    dropsBeforeServing = 1;

    await expect(
      SSLMonitor.getCertificate({
        host: "127.0.0.1",
        port: flakyPort,
        rejectUnauthorized: false,
        timeoutInMs: 5000,
        retry: 0,
      }),
    ).rejects.toThrow();

    expect(flakyConnections).toBe(1);
  }, 20000);

  /*
   * A validation verdict is deterministic, so it stays unretried however
   * many retries the caller allows.
   */
  test("never retries a certificate validation failure", async () => {
    await expect(
      SSLMonitor.getCertificate({
        host: "127.0.0.1",
        port: flakyPort,
        rejectUnauthorized: true,
        timeoutInMs: 5000,
        retry: 2,
      }),
    ).rejects.toMatchObject({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" });

    expect(flakyConnections).toBe(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  }, 20000);
});
