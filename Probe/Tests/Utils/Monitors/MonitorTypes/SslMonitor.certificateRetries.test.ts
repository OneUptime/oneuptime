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
import URL from "Common/Types/API/URL";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import SSLMonitor, {
  SslResponse,
} from "../../../../Utils/Monitors/MonitorTypes/SslMonitor";
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
let silentServer: net.Server;
let silentPort: number = 0;
let silentConnections: number = 0;

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

  silentServer = net.createServer((socket: net.Socket) => {
    silentConnections++;
    socket.resume();
    socket.on("error", () => {});
    openSockets.add(socket);
    socket.on("close", () => {
      openSockets.delete(socket);
    });
  });
  silentPort = await listen(silentServer);

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
  await close(silentServer);
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

describe("SSL monitor attempt budgets over real TLS connections", () => {
  beforeEach(() => {
    droppedConnections = 0;
    flakyConnections = 0;
    silentConnections = 0;
    dropsBeforeServing = 0;
    jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([0, 1, 3])(
    "does not multiply retry %s with hidden certificate retries",
    async (retry: number) => {
      const response: SslResponse | null = await SSLMonitor.ping(
        URL.fromString("https://127.0.0.1:" + droppingPort),
        {
          retry,
          timeout: new PositiveNumber(1000),
          isOnlineCheckRequest: true,
        },
      );

      expect(response?.isOnline).toBe(false);
      expect(response?.totalAttempts).toBe(retry + 1);
      expect(droppedConnections).toBe(retry + 1);
      expect(Sleep.sleep).toHaveBeenCalledTimes(retry);
    },
  );

  test.each([0, 1, 3])(
    "revalidates an invalid certificate for retry %s",
    async (retry: number) => {
      const response: SslResponse | null = await SSLMonitor.ping(
        URL.fromString("https://127.0.0.1:" + flakyPort),
        {
          retry,
          timeout: new PositiveNumber(1000),
          isOnlineCheckRequest: true,
        },
      );

      expect(response?.isOnline).toBe(true);
      expect(response?.isValidCertificate).toBe(false);
      expect(response?.certificateValidationErrorCode).toBe(
        "DEPTH_ZERO_SELF_SIGNED_CERT",
      );
      expect(response?.totalAttempts).toBe(retry + 1);
      // Each attempt validates strictly, then reads details without trusting them.
      expect(flakyConnections).toBe(2 * (retry + 1));
      expect(
        response?.probeAttempts?.every((attempt: ProbeAttempt) => {
          return Boolean(attempt.failureCause);
        }),
      ).toBe(true);
      expect(Sleep.sleep).toHaveBeenCalledTimes(retry);
    },
  );

  test.each([0, 1, 3])(
    "gives every TLS timeout retry %s its own bounded connection",
    async (retry: number) => {
      const response: SslResponse | null = await SSLMonitor.ping(
        URL.fromString("https://127.0.0.1:" + silentPort),
        {
          retry,
          timeout: new PositiveNumber(500),
          isOnlineCheckRequest: true,
        },
      );

      expect(response?.isOnline).toBe(false);
      expect(response?.isTimeout).toBe(true);
      expect(response?.totalAttempts).toBe(retry + 1);
      expect(silentConnections).toBe(retry + 1);
      expect(Sleep.sleep).toHaveBeenCalledTimes(retry);
    },
    20000,
  );
});
