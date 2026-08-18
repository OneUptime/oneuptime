// Set required env vars before importing anything that pulls Config.ts
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import SSLMonitor, {
  SslResponse,
} from "../../../../Utils/Monitors/MonitorTypes/SslMonitor";
import OnlineCheck from "../../../../Utils/OnlineCheck";
import URL from "Common/Types/API/URL";
import PositiveNumber from "Common/Types/PositiveNumber";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import * as net from "net";
import { AddressInfo, Socket } from "net";
import * as https from "https";
import * as tls from "tls";
import { IncomingMessage, ServerResponse } from "http";

interface SelfSignedCert {
  certPath: string;
  keyPath: string;
}

/*
 * Generated with openssl rather than checked in, exactly as the mTLS probe
 * tests do. A committed PEM would start failing on the day it expired.
 */
function generateSelfSignedCert(
  workDir: string,
  commonName: string,
  daysValid: number,
): SelfSignedCert {
  const keyPath: string = path.join(workDir, `${commonName}.key`);
  const certPath: string = path.join(workDir, `${commonName}.crt`);

  execFileSync("openssl", ["genrsa", "-out", keyPath, "2048"], {
    stdio: "pipe",
  });
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-new",
      "-key",
      keyPath,
      "-out",
      certPath,
      "-days",
      daysValid.toString(),
      "-subj",
      `/C=US/ST=CA/L=San Francisco/O=OneUptime Test/OU=Probe/CN=${commonName}`,
    ],
    { stdio: "pipe" },
  );

  return { certPath, keyPath };
}

/*
 * A port that accepts the TCP connection and then says nothing at all - the
 * shape of a host sitting behind a middlebox that swallows the TLS handshake.
 * Before the timeout was wired up this made the probe's promise never settle,
 * which is what silently dropped the monitor's check every cycle (issue #3225).
 */
function createSilentTcpServer(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const sockets: Array<Socket> = [];

  const server: net.Server = net.createServer((socket: Socket) => {
    // Deliberately never respond. Hold the socket open.
    sockets.push(socket);
  });

  return new Promise(
    (
      resolve: (value: { port: number; close: () => Promise<void> }) => void,
    ) => {
      server.listen(0, "127.0.0.1", () => {
        const address: AddressInfo = server.address() as AddressInfo;

        resolve({
          port: address.port,
          close: (): Promise<void> => {
            for (const socket of sockets) {
              socket.destroy();
            }

            return new Promise((done: () => void) => {
              server.close(() => {
                done();
              });
            });
          },
        });
      });
    },
  );
}

// A port nobody is listening on, so connecting is refused immediately.
async function getClosedPort(): Promise<number> {
  const server: net.Server = net.createServer();

  const port: number = await new Promise((resolve: (v: number) => void) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });

  await new Promise((resolve: (v: void) => void) => {
    server.close(() => {
      resolve();
    });
  });

  return port;
}

describe("SSLMonitor", () => {
  let workDir: string;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-ssl-monitor-"));
  }, 60000);

  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  /*
   * URL.fromString hands the whole authority to the Hostname constructor and
   * leaves Hostname.port unset, so reading hostname/port off it naively dialled
   * the literal name "example.com:8443" on port 443 - every SSL monitor on a
   * non-443 port failed to resolve on every check.
   */
  describe("getHostAndPort", () => {
    it("splits an explicit port off the authority", () => {
      expect(
        SSLMonitor.getHostAndPort(URL.fromString("https://example.com:8443/")),
      ).toEqual({ host: "example.com", port: 8443 });
    });

    it("defaults to 443 when the URL carries no port", () => {
      expect(
        SSLMonitor.getHostAndPort(
          URL.fromString("https://self-signed.badssl.com/"),
        ),
      ).toEqual({ host: "self-signed.badssl.com", port: 443 });
    });

    it("ignores the path, query and fragment", () => {
      expect(
        SSLMonitor.getHostAndPort(
          URL.fromString("https://example.com:9443/deep/path?a=b"),
        ),
      ).toEqual({ host: "example.com", port: 9443 });
    });

    it("reads past userinfo", () => {
      expect(
        SSLMonitor.getHostAndPort(
          URL.fromString("https://user:token@example.com:8443/"),
        ),
      ).toEqual({ host: "example.com", port: 8443 });
    });

    it("unwraps a bracketed IPv6 literal for tls.connect", () => {
      expect(
        SSLMonitor.getHostAndPort(URL.fromString("https://[::1]:8443/")),
      ).toEqual({ host: "::1", port: 8443 });
    });

    it("handles an IPv4 literal with a port", () => {
      expect(
        SSLMonitor.getHostAndPort(URL.fromString("https://127.0.0.1:44321/")),
      ).toEqual({ host: "127.0.0.1", port: 44321 });
    });
  });

  describe("a reachable host serving an untrusted certificate", () => {
    let server: https.Server;
    let serverUrl: URL;
    let certs: SelfSignedCert;

    beforeAll(async () => {
      certs = generateSelfSignedCert(workDir, "localhost", 365);

      server = https.createServer(
        {
          key: fs.readFileSync(certs.keyPath),
          cert: fs.readFileSync(certs.certPath),
        },
        (_req: IncomingMessage, res: ServerResponse) => {
          res.statusCode = 200;
          res.end("<html><body>OK</body></html>");
        },
      );

      await new Promise<void>((resolve: () => void) => {
        server.listen(0, "127.0.0.1", () => {
          const address: AddressInfo = server.address() as AddressInfo;
          serverUrl = URL.fromString(`https://127.0.0.1:${address.port}/`);
          resolve();
        });
      });
    }, 60000);

    afterAll(async () => {
      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    });

    /*
     * This is the reporter's exact scenario (self-signed.badssl.com): the
     * strict handshake fails, the permissive retry succeeds, and the check has
     * to come back online-but-untrusted so IsNotAValidCertificate can fire.
     */
    it("reports the certificate as self signed and the host as online", async () => {
      const response: SslResponse | null = await SSLMonitor.ping(serverUrl, {
        retry: 0,
        isOnlineCheckRequest: true,
        timeout: new PositiveNumber(10000),
      });

      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(true);
      expect(response!.isSelfSigned).toBe(true);
      expect(response!.isTimeout).toBeFalsy();
      expect(response!.failureCause).toBe("");
    }, 60000);

    it("surfaces the certificate identity fields", async () => {
      const response: SslResponse | null = await SSLMonitor.ping(serverUrl, {
        retry: 0,
        isOnlineCheckRequest: true,
        timeout: new PositiveNumber(10000),
      });

      expect(response!.commonName).toBe("localhost");
      expect(response!.organization).toBe("OneUptime Test");
      expect(response!.organizationalUnit).toBe("Probe");
      expect(response!.country).toBe("US");
      expect(response!.state).toBe("CA");
      expect(response!.serialNumber).toBeTruthy();
      expect(response!.fingerprint).toBeTruthy();
      expect(response!.fingerprint256).toBeTruthy();
    }, 60000);

    it("parses the certificate validity window into real dates", async () => {
      const response: SslResponse | null = await SSLMonitor.ping(serverUrl, {
        retry: 0,
        isOnlineCheckRequest: true,
        timeout: new PositiveNumber(10000),
      });

      expect(response!.createdAt).toBeInstanceOf(Date);
      expect(response!.expiresAt).toBeInstanceOf(Date);
      expect(response!.expiresAt!.getTime()).toBeGreaterThan(Date.now());
      expect(Number.isNaN(response!.expiresAt!.getTime())).toBe(false);
    }, 60000);

    /*
     * SSL was the only probe monitor type that never reported a response time,
     * so doesMonitorTypeHaveGraphs offered a graph that could never have a
     * point on it.
     */
    it("reports a response time", async () => {
      const response: SslResponse | null = await SSLMonitor.ping(serverUrl, {
        retry: 0,
        isOnlineCheckRequest: true,
        timeout: new PositiveNumber(10000),
      });

      expect(typeof response!.responseTimeInMs).toBe("number");
      expect(response!.responseTimeInMs!).toBeGreaterThanOrEqual(0);
    }, 60000);

    it("records one probe attempt for a first-try success", async () => {
      const response: SslResponse | null = await SSLMonitor.ping(serverUrl, {
        retry: 1,
        isOnlineCheckRequest: true,
        timeout: new PositiveNumber(10000),
      });

      expect(response!.totalAttempts).toBe(1);
      expect(response!.probeAttempts).toHaveLength(1);
      expect(response!.probeAttempts![0]!.isOnline).toBe(true);
    }, 60000);

    /*
     * The response body is never read, so without an explicit destroy the
     * one-off agent held the socket open until the body drained - which never
     * happened - leaking one TLS socket and fd per check.
     */
    it("closes the underlying socket instead of leaking it", async () => {
      const address: AddressInfo = server.address() as AddressInfo;

      let openConnections: number = 0;
      await new Promise<void>((resolve: () => void) => {
        server.getConnections((_err: Error | null, count: number) => {
          openConnections = count;
          resolve();
        });
      });

      await SSLMonitor.getCertificate({
        host: "127.0.0.1",
        port: address.port,
        rejectUnauthorized: false,
        timeoutInMs: 10000,
      });

      // Give the close a tick to propagate to the server side.
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 500);
      });

      const connectionsAfter: number = await new Promise(
        (resolve: (v: number) => void) => {
          server.getConnections((_err: Error | null, count: number) => {
            resolve(count);
          });
        },
      );

      expect(connectionsAfter).toBeLessThanOrEqual(openConnections);
    }, 60000);

    it("honours the port carried on the URL", async () => {
      const address: AddressInfo = server.address() as AddressInfo;

      const certificate: tls.PeerCertificate = await SSLMonitor.getCertificate({
        host: "127.0.0.1",
        port: address.port,
        rejectUnauthorized: false,
        timeoutInMs: 10000,
      });

      expect(certificate.subject.CN).toBe("localhost");
    }, 60000);
  });

  describe("an expired certificate", () => {
    let server: https.Server;
    let serverUrl: URL;

    beforeAll(async () => {
      /*
       * openssl cannot mint a certificate that is already expired with -days,
       * so it is backdated: valid from 30 days ago for 1 day.
       */
      const keyPath: string = path.join(workDir, "expired.key");
      const certPath: string = path.join(workDir, "expired.crt");

      execFileSync("openssl", ["genrsa", "-out", keyPath, "2048"], {
        stdio: "pipe",
      });
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-new",
          "-key",
          keyPath,
          "-out",
          certPath,
          "-not_before",
          "20200101000000Z",
          "-not_after",
          "20200102000000Z",
          "-subj",
          "/CN=expired.oneuptime.test",
        ],
        { stdio: "pipe" },
      );

      server = https.createServer(
        {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
        },
        (_req: IncomingMessage, res: ServerResponse) => {
          res.end("OK");
        },
      );

      await new Promise<void>((resolve: () => void) => {
        server.listen(0, "127.0.0.1", () => {
          const address: AddressInfo = server.address() as AddressInfo;
          serverUrl = URL.fromString(`https://127.0.0.1:${address.port}/`);
          resolve();
        });
      });
    }, 60000);

    afterAll(async () => {
      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    });

    it("still returns the certificate, with an expiry in the past", async () => {
      const response: SslResponse | null = await SSLMonitor.ping(serverUrl, {
        retry: 0,
        isOnlineCheckRequest: true,
        timeout: new PositiveNumber(10000),
      });

      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(true);
      expect(response!.expiresAt).toBeInstanceOf(Date);
      expect(response!.expiresAt!.getTime()).toBeLessThan(Date.now());
    }, 60000);
  });

  describe("a host that accepts the connection and never completes the handshake", () => {
    let silent: { port: number; close: () => Promise<void> };

    beforeAll(async () => {
      silent = await createSilentTcpServer();
    }, 60000);

    afterAll(async () => {
      await silent.close();
    });

    /*
     * THE regression test for issue #3225. Node's https.get applies no default
     * socket timeout, so before the deadline was wired up this promise never
     * settled: the probe worker hung, the monitor's result was never POSTed to
     * the ingest API, and because nextPingAt is advanced at claim time the
     * cycle was silently lost - forever, every cycle.
     */
    it("rejects getCertificate within the timeout instead of hanging", async () => {
      const startedAt: number = Date.now();

      await expect(
        SSLMonitor.getCertificate({
          host: "127.0.0.1",
          port: silent.port,
          rejectUnauthorized: false,
          timeoutInMs: 2000,
        }),
      ).rejects.toThrow(/timeout exceeded/);

      const elapsed: number = Date.now() - startedAt;
      expect(elapsed).toBeLessThan(10000);
    }, 60000);

    it("settles ping() as an offline, timed-out check rather than hanging", async () => {
      const startedAt: number = Date.now();

      const response: SslResponse | null = await SSLMonitor.ping(
        URL.fromString(`https://127.0.0.1:${silent.port}/`),
        {
          retry: 1,
          isOnlineCheckRequest: true,
          timeout: new PositiveNumber(2000),
        },
      );

      const elapsed: number = Date.now() - startedAt;

      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(false);
      expect(response!.isTimeout).toBe(true);
      expect(response!.failureCause).toContain("timed out");
      expect(elapsed).toBeLessThan(30000);
    }, 60000);

    /*
     * The strict and permissive handshakes share one budget. Giving each the
     * full timeout would make the user's Timeout setting quietly mean twice
     * what they asked for, and the retry ladder would multiply that again.
     */
    it("shares one timeout budget across both handshake passes", async () => {
      const startedAt: number = Date.now();

      await expect(
        SSLMonitor.getSslMonitorResponse("127.0.0.1", silent.port, 2000),
      ).rejects.toThrow();

      const elapsed: number = Date.now() - startedAt;

      /*
       * One 2s budget plus the 1s floor the second pass always gets, not
       * 2 x 2s. Generous headroom for a loaded CI box.
       */
      expect(elapsed).toBeLessThan(6000);
    }, 60000);

    it("applies the user's retry count to a timing-out host", async () => {
      const response: SslResponse | null = await SSLMonitor.ping(
        URL.fromString(`https://127.0.0.1:${silent.port}/`),
        {
          retry: 2,
          isOnlineCheckRequest: true,
          timeout: new PositiveNumber(1000),
        },
      );

      expect(response!.totalAttempts).toBe(2);
      expect(response!.probeAttempts).toHaveLength(2);
    }, 60000);
  });

  describe("an unreachable host", () => {
    let closedPort: number;

    beforeAll(async () => {
      closedPort = await getClosedPort();
    }, 60000);

    it("reports offline with a failure cause rather than returning null", async () => {
      const response: SslResponse | null = await SSLMonitor.ping(
        URL.fromString(`https://127.0.0.1:${closedPort}/`),
        {
          retry: 1,
          isOnlineCheckRequest: true,
          timeout: new PositiveNumber(3000),
        },
      );

      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(false);
      expect(response!.isTimeout).toBe(false);
      expect(response!.failureCause).toBeTruthy();
    }, 60000);

    /*
     * getSslMonitorResponse used to swallow its own errors and return an
     * offline object, which made every error path in ping() dead code: the
     * user's retry count was never applied and probeAttempts was always 1.
     */
    it("retries as many times as the user configured", async () => {
      const response: SslResponse | null = await SSLMonitor.ping(
        URL.fromString(`https://127.0.0.1:${closedPort}/`),
        {
          retry: 3,
          isOnlineCheckRequest: true,
          timeout: new PositiveNumber(3000),
        },
      );

      expect(response!.totalAttempts).toBe(3);
      expect(response!.probeAttempts).toHaveLength(3);
      expect(response!.probeAttempts![0]!.attemptNumber).toBe(1);
      expect(response!.probeAttempts![2]!.attemptNumber).toBe(3);

      for (const attempt of response!.probeAttempts!) {
        expect(attempt.isOnline).toBe(false);
        expect(attempt.failureCause).toBeTruthy();
      }
    }, 60000);

    /*
     * clampMonitorRetryCount lets a user save 0, and the ladder only became
     * live once getSslMonitorResponse started throwing - so "|| 5" would have
     * newly turned "do not retry" into five attempts.
     */
    it("treats a configured retry count of 0 as a single attempt", async () => {
      const response: SslResponse | null = await SSLMonitor.ping(
        URL.fromString(`https://127.0.0.1:${closedPort}/`),
        {
          retry: 0,
          isOnlineCheckRequest: true,
          timeout: new PositiveNumber(3000),
        },
      );

      expect(response!.totalAttempts).toBe(1);
    }, 60000);

    it("reports a response time even on the failure path", async () => {
      const response: SslResponse | null = await SSLMonitor.ping(
        URL.fromString(`https://127.0.0.1:${closedPort}/`),
        {
          retry: 1,
          isOnlineCheckRequest: true,
          timeout: new PositiveNumber(3000),
        },
      );

      expect(typeof response!.responseTimeInMs).toBe("number");
    }, 60000);
  });

  describe("error classification", () => {
    afterAll(() => {
      jest.restoreAllMocks();
    });

    /*
     * Happy-eyeballs exhausted - typically a dual-stack host with a dead IPv6
     * route. This used to return null, and a null step result is never POSTed
     * to the ingest API at all, so the monitor sat at its creation status
     * forever with no timeline event and no monitor log: exactly the
     * "never executes" symptom reported in issue #3225.
     */
    it("reports an AggregateError as offline rather than returning null", async () => {
      const aggregate: Error = new Error("connect ECONNREFUSED");
      aggregate.name = "AggregateError";

      const spy: jest.SpyInstance = jest
        .spyOn(SSLMonitor, "getSslMonitorResponse")
        .mockRejectedValue(aggregate as never);

      const response: SslResponse | null = await SSLMonitor.ping(
        URL.fromString("https://aggregate.oneuptime.test/"),
        {
          retry: 1,
          isOnlineCheckRequest: true,
          timeout: new PositiveNumber(1000),
        },
      );

      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(false);
      expect(response!.isTimeout).toBe(false);
      expect(response!.failureCause).toContain("AggregateError");
      expect(response!.probeAttempts).toHaveLength(1);

      spy.mockRestore();
    }, 60000);

    /*
     * The one legitimate null: the probe itself has no connectivity, so it
     * must not slander the target as down.
     */
    it("returns null only when the probe itself is offline", async () => {
      const responseSpy: jest.SpyInstance = jest
        .spyOn(SSLMonitor, "getSslMonitorResponse")
        .mockRejectedValue(new Error("connect ECONNREFUSED") as never);

      const onlineSpy: jest.SpyInstance = jest
        .spyOn(OnlineCheck, "canProbeMonitorWebsiteMonitors")
        .mockResolvedValue(false as never);

      const response: SslResponse | null = await SSLMonitor.ping(
        URL.fromString("https://offline-probe.oneuptime.test/"),
        {
          retry: 1,
          timeout: new PositiveNumber(1000),
        },
      );

      expect(response).toBeNull();

      responseSpy.mockRestore();
      onlineSpy.mockRestore();
    }, 60000);

    it("still reports the target offline when the probe itself is online", async () => {
      const responseSpy: jest.SpyInstance = jest
        .spyOn(SSLMonitor, "getSslMonitorResponse")
        .mockRejectedValue(new Error("connect ECONNREFUSED") as never);

      const onlineSpy: jest.SpyInstance = jest
        .spyOn(OnlineCheck, "canProbeMonitorWebsiteMonitors")
        .mockResolvedValue(true as never);

      const response: SslResponse | null = await SSLMonitor.ping(
        URL.fromString("https://online-probe.oneuptime.test/"),
        {
          retry: 1,
          timeout: new PositiveNumber(1000),
        },
      );

      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(false);

      responseSpy.mockRestore();
      onlineSpy.mockRestore();
    }, 60000);
  });

  describe("getSslMonitorResponse contract", () => {
    /*
     * It used to return { isOnline: false, failureCause } here. Returning
     * instead of throwing is what made ping()'s retry loop, probeAttempts
     * accounting and isTimeout handling unreachable.
     */
    it("throws rather than returning an offline object", async () => {
      const closedPort: number = await getClosedPort();

      await expect(
        SSLMonitor.getSslMonitorResponse("127.0.0.1", closedPort, 2000),
      ).rejects.toThrow();
    }, 60000);
  });
});
