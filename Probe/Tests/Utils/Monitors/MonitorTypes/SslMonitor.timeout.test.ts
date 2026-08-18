// Set required env vars before importing SSLMonitor (through Register/Config).
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  afterAll,
  beforeAll,
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

import net from "net";
import tls from "tls";
import { AddressInfo } from "net";
import URL from "Common/Types/API/URL";
import PositiveNumber from "Common/Types/PositiveNumber";
import SSLMonitor, {
  SslResponse,
  DEFAULT_SSL_MONITOR_TIMEOUT_IN_MS,
} from "../../../../Utils/Monitors/MonitorTypes/SslMonitor";
import SelfSignedCertificate from "./SslTestCertificates";

/*
 * These suites pin the fix for the unbounded hang described in
 * https://github.com/OneUptime/oneuptime/issues/3225.
 *
 * SSLMonitor accepted a `timeout` option and never read it, and
 * getCertificate registered no deadline of any kind on its https.get. A peer
 * that completes TCP (or even the full TLS handshake) and then goes silent
 * left the promise unsettled forever. Because the ingest POST happens only
 * AFTER the step returns, that monitor posted no result at all, on every
 * cycle - a monitor that reads as healthy while providing zero coverage.
 *
 * Every test here fails on the pre-fix code by exhausting the jest timeout.
 */

// A TCP listener that accepts the connection and never speaks TLS.
let tcpSilentServer: net.Server;
let tcpSilentPort: number = 0;

// A TLS listener that completes the handshake and never writes a response.
let tlsSilentServer: tls.Server;
let tlsSilentPort: number = 0;

// Sockets the servers accepted, so we can assert the client hung up.
const acceptedTcpSockets: Array<net.Socket> = [];
const acceptedTlsSockets: Array<tls.TLSSocket> = [];

beforeAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    tcpSilentServer = net.createServer((socket: net.Socket) => {
      acceptedTcpSockets.push(socket);

      /*
       * Put the socket in flowing mode. A paused socket never processes the
       * incoming FIN, so it would not emit 'close' when the client hangs
       * up - the server would look like it was still connected and the
       * leak assertion below would fail against correct code.
       */
      socket.resume();

      // Deliberately silent: never negotiate TLS, never end the socket.
      socket.on("error", () => {
        // A client-side destroy surfaces here; it is expected.
      });
    });
    tcpSilentServer.listen(0, "127.0.0.1", () => {
      tcpSilentPort = (tcpSilentServer.address() as AddressInfo).port;
      resolve();
    });
  });

  await new Promise<void>((resolve: () => void) => {
    tlsSilentServer = tls.createServer(
      {
        key: SelfSignedCertificate.key,
        cert: SelfSignedCertificate.cert,
      },
      (socket: tls.TLSSocket) => {
        acceptedTlsSockets.push(socket);
        /*
         * Handshake completes, then nothing is ever written - so https.get's
         * response callback never fires. This is the case req.setTimeout
         * exists for.
         */
        socket.on("error", () => {
          // Expected when the client destroys the request.
        });
      },
    );
    tlsSilentServer.listen(0, "127.0.0.1", () => {
      tlsSilentPort = (tlsSilentServer.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  for (const socket of acceptedTcpSockets) {
    socket.destroy();
  }
  for (const socket of acceptedTlsSockets) {
    socket.destroy();
  }

  await new Promise<void>((resolve: () => void) => {
    tcpSilentServer.close(() => {
      return resolve();
    });
  });
  await new Promise<void>((resolve: () => void) => {
    tlsSilentServer.close(() => {
      return resolve();
    });
  });
});

describe("SSLMonitor timeout handling (issue #3225)", () => {
  test("settles rather than hanging against a TCP-accept-then-silent peer", async () => {
    const startedAt: number = Date.now();

    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://127.0.0.1:${tcpSilentPort}/`),
      {
        timeout: new PositiveNumber(1000),
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    const elapsed: number = Date.now() - startedAt;

    expect(response).not.toBeNull();
    // Pre-fix this never settles at all.
    expect(elapsed).toBeLessThan(8000);
  }, 20000);

  test("settles rather than hanging against a TLS-handshake-then-silent peer", async () => {
    const startedAt: number = Date.now();

    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://127.0.0.1:${tlsSilentPort}/`),
      {
        timeout: new PositiveNumber(1000),
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    const elapsed: number = Date.now() - startedAt;

    expect(response).not.toBeNull();
    expect(elapsed).toBeLessThan(8000);
  }, 20000);

  test("a timed-out check reports isOnline FALSE, not true", async () => {
    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://127.0.0.1:${tcpSilentPort}/`),
      {
        timeout: new PositiveNumber(1000),
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response).not.toBeNull();

    /*
     * The regression guard that matters most. The old code returned
     * `isOnline: true` on timeout, so a permanently stalled endpoint
     * satisfied nothing and every "Is Online = False" criterion was dead -
     * the monitor read Operational forever.
     */
    expect(response?.isOnline).toBe(false);
    expect(response?.isTimeout).toBe(true);
  }, 20000);

  test("a timed-out check is never reported as a valid certificate", async () => {
    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://127.0.0.1:${tcpSilentPort}/`),
      {
        timeout: new PositiveNumber(1000),
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.isValidCertificate).toBe(false);
  }, 20000);

  test("the failure cause names the SSL Certificate Monitor and the timeout", async () => {
    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://127.0.0.1:${tcpSilentPort}/`),
      {
        timeout: new PositiveNumber(1000),
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    /*
     * "Timeout Error." on its own does not tell an operator which check
     * timed out or what the budget was.
     */
    expect(response?.failureCause).toContain("SSL Certificate Monitor");
    expect(response?.failureCause).toContain("timed out");
    expect(response?.failureCause).toContain("1000");
  }, 20000);

  test("the client hangs up on timeout instead of leaking the socket", async () => {
    const socketsBefore: number = acceptedTcpSockets.length;

    await SSLMonitor.ping(
      URL.fromString(`https://127.0.0.1:${tcpSilentPort}/`),
      {
        timeout: new PositiveNumber(1000),
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    const newSockets: Array<net.Socket> =
      acceptedTcpSockets.slice(socketsBefore);

    expect(newSockets.length).toBeGreaterThan(0);

    /*
     * Wait for the server side to observe the hang-up rather than sleeping
     * a fixed amount: FIN propagation is not instantaneous and a fixed
     * sleep makes this flaky on a loaded machine.
     */
    await Promise.all(
      newSockets.map(async (socket: net.Socket): Promise<void> => {
        if (socket.destroyed || socket.readableEnded) {
          return;
        }

        await new Promise<void>((resolve: () => void) => {
          const done: () => void = (): void => {
            clearTimeout(timer);
            resolve();
          };
          const timer: ReturnType<typeof setTimeout> = setTimeout(done, 5000);
          socket.once("close", done);
          socket.once("end", done);
        });
      }),
    );

    for (const socket of newSockets) {
      /*
       * Regression guard for the socket leak: an abandoned ClientRequest
       * keeps its socket - and the event loop - alive, which is what let a
       * hung check accumulate one stuck connection per cron tick.
       */
      expect(socket.destroyed || socket.readableEnded || socket.closed).toBe(
        true,
      );
    }
  }, 30000);

  test("retries do not multiply the deadline without bound", async () => {
    const startedAt: number = Date.now();

    await SSLMonitor.ping(
      URL.fromString(`https://127.0.0.1:${tcpSilentPort}/`),
      {
        timeout: new PositiveNumber(500),
        retry: 2,
        isOnlineCheckRequest: true,
      },
    );

    const elapsed: number = Date.now() - startedAt;

    /*
     * Timeouts are terminal for a single connect attempt: getCertificate
     * must NOT re-enter its own 3x retry loop on a timeout, or the wall
     * clock becomes retry x strict/lenient x 3 connects.
     */
    expect(elapsed).toBeLessThan(15000);
  }, 30000);
});

describe("SSLMonitor timeout wiring", () => {
  test("getOptions carries the threaded timeout", () => {
    const options: Record<string, unknown> = (
      SSLMonitor as unknown as {
        getOptions: (
          host: string,
          port: number,
          rejectUnauthorized: boolean,
          timeoutInMs?: number,
        ) => Record<string, unknown>;
      }
    ).getOptions("example.com", 443, true, 1234);

    expect(options["timeout"]).toBe(1234);
  });

  test("getOptions falls back to the shared default when none is supplied", () => {
    const options: Record<string, unknown> = (
      SSLMonitor as unknown as {
        getOptions: (
          host: string,
          port: number,
          rejectUnauthorized: boolean,
          timeoutInMs?: number,
        ) => Record<string, unknown>;
      }
    ).getOptions("example.com", 443, true);

    expect(options["timeout"]).toBe(DEFAULT_SSL_MONITOR_TIMEOUT_IN_MS);
  });

  test("the default matches the other probe monitor types", () => {
    expect(DEFAULT_SSL_MONITOR_TIMEOUT_IN_MS).toBe(5000);
  });
});
