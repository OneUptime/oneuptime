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

import tls from "tls";
import net, { AddressInfo } from "net";
import URL from "Common/Types/API/URL";
import PositiveNumber from "Common/Types/PositiveNumber";
import SSLMonitor, {
  SslResponse,
} from "../../../../Utils/Monitors/MonitorTypes/SslMonitor";
import {
  cleanupSslCertificateFixtures,
  generateSslCertificateFixtures,
  SslCertificateFixtures,
} from "./SslTestCertificates";

/*
 * Regression suite for https://github.com/OneUptime/oneuptime/issues/3225.
 *
 * The probe used to fetch a certificate with rejectUnauthorized:true, and on
 * ANY failure retry with rejectUnauthorized:false and set isSelfSigned=true
 * — discarding the real TLS error. Every distinct failure (untrusted CA,
 * hostname mismatch, expired, incomplete chain) was therefore reported
 * identically, always with isOnline:true and an empty failureCause. A
 * monitor watching a host with a broken certificate read as healthy.
 *
 * These tests assert the probe now emits an explicit validation verdict.
 */

let fixtures: SslCertificateFixtures;

interface RunningServer {
  server: tls.Server;
  port: number;
}

const runningServers: Array<tls.Server> = [];

/*
 * Every socket any test server accepted. A rejected TLS handshake can leave
 * one half-open, and server.close() waits for those — which turns a slow
 * machine into a hung teardown rather than a test failure. Tracking them
 * means teardown can destroy them outright.
 */
const acceptedSockets: Array<net.Socket> = [];

async function startTlsServer(data: {
  cert: string;
  key: string;
}): Promise<RunningServer> {
  return new Promise<RunningServer>(
    (resolve: (value: RunningServer) => void) => {
      const server: tls.Server = tls.createServer(
        { cert: data.cert, key: data.key },
        (socket: tls.TLSSocket) => {
          /*
           * Answer with a minimal HTTP response so https.get's response
           * callback fires and the certificate can be read.
           */
          socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
        },
      );

      server.on("connection", (socket: net.Socket) => {
        acceptedSockets.push(socket);
        socket.on("error", () => {
          // Half-open handshakes surface here; expected.
        });
      });

      server.on("tlsClientError", () => {
        // A client that refuses our certificate surfaces here; expected.
      });

      server.listen(0, "127.0.0.1", () => {
        runningServers.push(server);
        resolve({
          server,
          port: (server.address() as AddressInfo).port,
        });
      });
    },
  );
}

beforeAll(() => {
  fixtures = generateSslCertificateFixtures();
});

afterAll(async () => {
  /*
   * Destroy sockets before closing servers: close() waits for open
   * connections, so a single half-open handshake would stall teardown.
   */
  for (const socket of acceptedSockets) {
    socket.destroy();
  }

  for (const server of runningServers) {
    (
      server as unknown as { closeAllConnections?: () => void }
    ).closeAllConnections?.();

    /*
     * Bounded wait. Teardown must never be the thing that fails this
     * suite — the assertions above are what carry the regression.
     */
    await new Promise<void>((resolve: () => void) => {
      const timer: ReturnType<typeof setTimeout> = setTimeout(resolve, 2000);

      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  cleanupSslCertificateFixtures(fixtures);
}, 60000);

describe("SSLMonitor certificate validation verdict", () => {
  test("a self-signed certificate is reported as self-signed AND invalid", async () => {
    const running: RunningServer = await startTlsServer({
      cert: fixtures.selfSignedCert,
      key: fixtures.selfSignedKey,
    });

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      "127.0.0.1",
      running.port,
      5000,
    );

    expect(response.isValidCertificate).toBe(false);
    expect(response.isSelfSigned).toBe(true);
    expect(response.certificateValidationErrorCode).toBeTruthy();
    // The certificate itself was still readable, so its contents come back.
    expect(response.expiresAt).toBeDefined();
  }, 30000);

  test("a hostname mismatch is NOT reported as self-signed", async () => {
    const running: RunningServer = await startTlsServer({
      cert: fixtures.wrongHostCert,
      key: fixtures.wrongHostKey,
    });

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      "127.0.0.1",
      running.port,
      5000,
    );

    /*
     * The heart of the bug: this certificate is CA-issued and unexpired, it
     * simply does not cover the host we dialled. Pre-fix it came back as
     * isSelfSigned:true, which is a lie, and as a valid-looking response.
     */
    expect(response.isValidCertificate).toBe(false);
    expect(response.isSelfSigned).toBe(false);
    expect(response.certificateValidationErrorCode).toBeTruthy();
  }, 30000);

  test("an untrusted-CA certificate is invalid but not self-signed", async () => {
    const running: RunningServer = await startTlsServer({
      cert: fixtures.validCert,
      key: fixtures.validKey,
    });

    /*
     * The leaf is signed by our test CA, which the probe's trust store does
     * not know about, so strict validation fails with an issuer error - not
     * with a self-signed error.
     */
    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      "127.0.0.1",
      running.port,
      5000,
    );

    expect(response.isValidCertificate).toBe(false);
    expect(response.isSelfSigned).toBe(false);
    expect(response.certificateValidationErrorCode).toBeTruthy();
  }, 30000);

  test("the validation error is preserved instead of discarded", async () => {
    const running: RunningServer = await startTlsServer({
      cert: fixtures.wrongHostCert,
      key: fixtures.wrongHostKey,
    });

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      "127.0.0.1",
      running.port,
      5000,
    );

    expect(response.certificateValidationError).toBeTruthy();
    expect(response.failureCause).toBeTruthy();
  }, 30000);

  test("certificate contents are still reported for an invalid certificate", async () => {
    const running: RunningServer = await startTlsServer({
      cert: fixtures.wrongHostCert,
      key: fixtures.wrongHostKey,
    });

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      "127.0.0.1",
      running.port,
      5000,
    );

    expect(response.expiresAt).toBeDefined();
    expect(response.createdAt).toBeDefined();
    expect(response.serialNumber).toBeTruthy();
    expect(response.fingerprint).toBeTruthy();
  }, 30000);

  test("issuer is populated, and differs from subject for a CA-issued leaf", async () => {
    const running: RunningServer = await startTlsServer({
      cert: fixtures.validCert,
      key: fixtures.validKey,
    });

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      "127.0.0.1",
      running.port,
      5000,
    );

    expect(response.issuer).toBeTruthy();
    expect(response.issuer).toContain("oneuptime-ssl-monitor-test-ca");
  }, 30000);

  test("issuer equals subject for a self-signed leaf", async () => {
    const running: RunningServer = await startTlsServer({
      cert: fixtures.selfSignedCert,
      key: fixtures.selfSignedKey,
    });

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      "127.0.0.1",
      running.port,
      5000,
    );

    expect(response.issuer).toBeTruthy();
    expect(response.issuer).toContain("selfsigned.oneuptime-test");
  }, 30000);

  test("an expired certificate is invalid and not mislabelled self-signed", async () => {
    if (!fixtures.expiredCert || !fixtures.expiredKey) {
      /*
       * openssl too old to backdate a certificate. The expiry LOGIC is
       * covered without a live server in the criteria suite.
       */
      return;
    }

    const running: RunningServer = await startTlsServer({
      cert: fixtures.expiredCert,
      key: fixtures.expiredKey,
    });

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      "127.0.0.1",
      running.port,
      5000,
    );

    expect(response.isValidCertificate).toBe(false);
    expect(response.isSelfSigned).toBe(false);
    expect(response.certificateValidationErrorCode).toBe("CERT_HAS_EXPIRED");
  }, 30000);
});

describe("SSLMonitor connection failures", () => {
  test("a refused connection is offline and is NOT called self-signed", async () => {
    /*
     * Bind then immediately close, so the port is almost certainly free and
     * the connection is refused.
     */
    const probeServer: net.Server = net.createServer();
    const port: number = await new Promise<number>(
      (resolve: (value: number) => void) => {
        probeServer.listen(0, "127.0.0.1", () => {
          const assigned: number = (probeServer.address() as AddressInfo).port;
          probeServer.close(() => {
            return resolve(assigned);
          });
        });
      },
    );

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      "127.0.0.1",
      port,
      2000,
    );

    expect(response.isOnline).toBe(false);
    expect(response.isValidCertificate).toBe(false);
    /*
     * Regression guard: a connection failure says NOTHING about the
     * certificate. Pre-fix it fell into the same catch that set
     * isSelfSigned=true.
     */
    expect(response.isSelfSigned).toBe(false);
    expect(response.expiresAt).toBeUndefined();
    expect(response.failureCause).toBeTruthy();
  }, 30000);
});

describe("SSLMonitor.ping response shape", () => {
  test("a completed check records responseTimeInMs for the metrics chart", async () => {
    const running: RunningServer = await startTlsServer({
      cert: fixtures.selfSignedCert,
      key: fixtures.selfSignedKey,
    });

    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://127.0.0.1:${running.port}/`),
      {
        timeout: new PositiveNumber(5000),
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response).not.toBeNull();
    expect(typeof response?.responseTimeInMs).toBe("number");
    expect(response?.responseTimeInMs).toBeGreaterThanOrEqual(0);
  }, 30000);

  test("ping resolves the port from the URL authority", async () => {
    const running: RunningServer = await startTlsServer({
      cert: fixtures.selfSignedCert,
      key: fixtures.selfSignedKey,
    });

    /*
     * URL.fromString leaves the port glued to the authority
     * ("127.0.0.1:8443"), so a probe that reads url.hostname.hostname
     * directly tries to resolve a host of that literal name. If the port is
     * not recovered here this check cannot reach the server at all.
     */
    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://127.0.0.1:${running.port}/`),
      {
        timeout: new PositiveNumber(5000),
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response).not.toBeNull();
    expect(response?.isOnline).toBe(true);
    expect(response?.expiresAt).toBeDefined();
  }, 30000);

  test("probe attempts are recorded", async () => {
    const running: RunningServer = await startTlsServer({
      cert: fixtures.selfSignedCert,
      key: fixtures.selfSignedKey,
    });

    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://127.0.0.1:${running.port}/`),
      {
        timeout: new PositiveNumber(5000),
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.totalAttempts).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(response?.probeAttempts)).toBe(true);
  }, 30000);
});
