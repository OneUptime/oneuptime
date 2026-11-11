// Set required env vars before importing anything that pulls Config.ts.
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
    EXTERNAL_FAULT: "external-fault",
  };
});

import { SpyInstance } from "jest-mock";
import CertificateRevocationChecker from "../../../../Utils/Monitors/CertificateRevocation/CertificateRevocationChecker";
import RevocationHttpClient, {
  RevocationFetchError,
  RevocationFetchOptions,
} from "../../../../Utils/Monitors/CertificateRevocation/RevocationHttpClient";
import HttpMonitorRequest, {
  MonitorTlsOptions,
} from "../../../../Utils/Monitors/HttpMonitorRequest";
import ApiMonitor, {
  APIResponse,
} from "../../../../Utils/Monitors/MonitorTypes/ApiMonitor";
import SSLMonitor, {
  SslResponse,
} from "../../../../Utils/Monitors/MonitorTypes/SslMonitor";
import WebsiteMonitor, {
  ProbeWebsiteResponse,
} from "../../../../Utils/Monitors/MonitorTypes/WebsiteMonitor";
import ProxyConfig from "../../../../Utils/ProxyConfig";
import {
  CRL_URL,
  OCSP_URL,
  RevocationTestPki,
  cleanupRevocationTestPki,
  generateRevocationTestPki,
} from "./RevocationTestPki";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import URL from "Common/Types/API/URL";
import CertificateRevocationCheckMethod from "Common/Types/Monitor/SSLMonitor/CertificateRevocationCheckMethod";
import CertificateRevocationStatus from "Common/Types/Monitor/SSLMonitor/CertificateRevocationStatus";
import PositiveNumber from "Common/Types/PositiveNumber";
import http from "http";
import https from "https";
import net, { AddressInfo } from "net";

/*
 * The customer's report, end to end: a server whose certificate chains to a
 * trusted root, matches the host name, has not expired - and has been
 * revoked by its issuer. Node accepts it; a browser refuses it. Website and
 * API checks must now fail on it exactly as they fail on an expired
 * certificate, and an SSL Certificate check must call it not valid.
 *
 * The servers here staple OCSP responses (as the customer's WAF does) or not
 * at all, and the issuer's responder and CRL are served from a real CA
 * database through a stubbed RevocationHttpClient.fetch.
 */

jest.setTimeout(60000);

let pki: RevocationTestPki;

interface TestServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

const runningServers: Array<TestServer> = [];

async function startHttpsServer(data: {
  leaf: "good" | "revoked";
  // What the server staples: an OCSP response, or nothing.
  staple: Buffer | null;
}): Promise<TestServer> {
  const sockets: Set<net.Socket> = new Set<net.Socket>();
  const server: https.Server = https.createServer(
    {
      cert:
        (data.leaf === "good" ? pki.goodLeafPem : pki.revokedLeafPem) +
        pki.intermediatePem,
      key: data.leaf === "good" ? pki.goodLeafKeyPem : pki.revokedLeafKeyPem,
    },
    (_request: http.IncomingMessage, response: http.ServerResponse) => {
      response.writeHead(200, {
        "Content-Type": "text/plain",
        Connection: "close",
      });
      response.end("ok");
    },
  );

  if (data.staple) {
    const staple: Buffer = data.staple;
    server.on(
      "OCSPRequest",
      (
        _certificate: Buffer,
        _issuer: Buffer,
        callback: (error: Error | null, response?: Buffer) => void,
      ) => {
        callback(null, staple);
      },
    );
  }

  server.on("connection", (socket: net.Socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });
  server.on("tlsClientError", () => {
    // A client that refuses the certificate surfaces here; expected.
  });

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const port: number = (server.address() as AddressInfo).port;
  const testServer: TestServer = {
    url: `https://localhost:${port}/health`,
    port: port,
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

  runningServers.push(testServer);
  return testServer;
}

let fetchSpy: SpyInstance<typeof RevocationHttpClient.fetch>;

// The issuer's responder and CRL, reachable or not.
function issuerServices(reachable: boolean): void {
  fetchSpy.mockImplementation(
    async (options: RevocationFetchOptions): Promise<Buffer> => {
      if (!reachable) {
        throw new RevocationFetchError(
          "could not be reached (Cannot Find Host.)",
        );
      }

      if (options.url === OCSP_URL) {
        return pki.answerOcspRequest(options.body as Buffer);
      }

      if (options.url === CRL_URL) {
        return pki.crlDer;
      }

      throw new Error(`Unexpected URL ${options.url}`);
    },
  );
}

beforeAll(() => {
  pki = generateRevocationTestPki();
}, 60000);

afterAll(() => {
  cleanupRevocationTestPki(pki);
});

beforeEach(() => {
  CertificateRevocationChecker.clearCache();

  // Every hop goes to the loopback test servers.
  jest
    .spyOn(DataSourceEgressGuard, "assertUrlAllowed")
    .mockImplementation(async (rawUrl: string) => {
      return {
        url: new globalThis.URL(rawUrl),
        addresses: [{ address: "127.0.0.1", family: 4 }],
      };
    });

  /*
   * Trust the test root, as a real probe trusts public CAs. Everything else
   * about the TLS options - and the revocation check's own requestOCSP -
   * is left as the code under test builds it.
   */
  const tlsAgentOptions: (tls?: MonitorTlsOptions) => https.AgentOptions = (
    HttpMonitorRequest as any
  ).getTlsAgentOptions.bind(HttpMonitorRequest);
  jest
    .spyOn(HttpMonitorRequest as any, "getTlsAgentOptions")
    .mockImplementation((tls?: unknown) => {
      return {
        ...tlsAgentOptions(tls as MonitorTlsOptions | undefined),
        ca: pki.rootPem,
      };
    });

  const sslOptions: (...args: Array<unknown>) => https.RequestOptions = (
    SSLMonitor as any
  ).getOptions.bind(SSLMonitor);
  jest
    .spyOn(SSLMonitor as any, "getOptions")
    .mockImplementation((...args: Array<unknown>) => {
      return { ...sslOptions(...args), ca: pki.rootPem };
    });

  fetchSpy = jest.spyOn(RevocationHttpClient, "fetch");
  issuerServices(true);
});

afterEach(async () => {
  jest.restoreAllMocks();

  while (runningServers.length > 0) {
    await runningServers.pop()!.close();
  }
});

async function pingWebsite(
  server: TestServer,
  options: { allowSelfSignedCertificates?: boolean; retry?: number } = {},
): Promise<ProbeWebsiteResponse> {
  const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
    URL.fromString(server.url),
    {
      retry: options.retry ?? 0,
      timeout: new PositiveNumber(15000),
      allowSelfSignedCertificates: options.allowSelfSignedCertificates,
    },
  );

  expect(response).not.toBeNull();
  return response as ProbeWebsiteResponse;
}

describe("Website monitor", () => {
  test("a revoked certificate the server staples a 'revoked' answer for fails the check", async () => {
    const server: TestServer = await startHttpsServer({
      leaf: "revoked",
      staple: pki.ocspResponse("revoked", "issuer"),
    });

    const response: ProbeWebsiteResponse = await pingWebsite(server);

    expect(response.isOnline).toBe(false);
    expect(response.isTimeout).toBe(false);
    expect(response.failureCause).toContain(
      "certificate has been revoked by its issuer",
    );
    expect(response.failureCause).toContain("Key Compromise");
    expect(response.requestFailedDetails?.errorCode).toBe("CERT_REVOKED");
    // The stapled answer was enough: nobody else was asked.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a revoked certificate with no staple fails the check, from the issuer's responder", async () => {
    const server: TestServer = await startHttpsServer({
      leaf: "revoked",
      staple: null,
    });

    const response: ProbeWebsiteResponse = await pingWebsite(server);

    expect(response.isOnline).toBe(false);
    expect(response.failureCause).toContain("issuer's OCSP responder");
  });

  test("a good certificate passes, and the response time does not include the lookup", async () => {
    const server: TestServer = await startHttpsServer({
      leaf: "good",
      staple: null,
    });

    fetchSpy.mockImplementation(
      async (options: RevocationFetchOptions): Promise<Buffer> => {
        // A slow responder: its time must not be counted as the site's.
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 600);
        });
        return pki.answerOcspRequest(options.body as Buffer);
      },
    );

    const response: ProbeWebsiteResponse = await pingWebsite(server);

    expect(response.isOnline).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.responseTimeInMS.toNumber()).toBeLessThan(600);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("issuer services that cannot be reached do not fail the check (soft-fail, like browsers)", async () => {
    const server: TestServer = await startHttpsServer({
      leaf: "revoked",
      staple: null,
    });
    issuerServices(false);

    const response: ProbeWebsiteResponse = await pingWebsite(server);

    expect(response.isOnline).toBe(true);
    expect(response.statusCode).toBe(200);
  });

  test("'allow self-signed certificates' turns verification off, so revocation is not checked either", async () => {
    const server: TestServer = await startHttpsServer({
      leaf: "revoked",
      staple: pki.ocspResponse("revoked", "issuer"),
    });

    const response: ProbeWebsiteResponse = await pingWebsite(server, {
      allowSelfSignedCertificates: true,
    });

    expect(response.isOnline).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a probe with the check turned off does not check", async () => {
    jest
      .spyOn(CertificateRevocationChecker, "isEnabled")
      .mockReturnValue(false);
    const server: TestServer = await startHttpsServer({
      leaf: "revoked",
      staple: pki.ocspResponse("revoked", "issuer"),
    });

    const response: ProbeWebsiteResponse = await pingWebsite(server);

    expect(response.isOnline).toBe(true);
  });

  test("the failure is retried like any certificate error, each attempt recorded", async () => {
    const server: TestServer = await startHttpsServer({
      leaf: "revoked",
      staple: pki.ocspResponse("revoked", "issuer"),
    });

    const response: ProbeWebsiteResponse = await pingWebsite(server, {
      retry: 1,
    });

    expect(response.isOnline).toBe(false);
    expect(response.totalAttempts).toBe(2);
    for (const attempt of response.probeAttempts || []) {
      expect(attempt.isOnline).toBe(false);
      expect(attempt.failureCause).toContain("revoked");
    }
  });

  test("through an HTTPS proxy, the tunnelled connection's certificate is checked", async () => {
    const server: TestServer = await startHttpsServer({
      leaf: "revoked",
      staple: pki.ocspResponse("revoked", "issuer"),
    });

    const proxySockets: Set<net.Socket> = new Set<net.Socket>();
    const proxy: http.Server = http.createServer();
    proxy.on(
      "connect",
      (_request: http.IncomingMessage, client: net.Socket, head: Buffer) => {
        const upstream: net.Socket = net.connect({
          host: "127.0.0.1",
          port: server.port,
        });
        proxySockets.add(upstream);
        proxySockets.add(client);
        upstream.once("connect", () => {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length > 0) {
            upstream.write(head);
          }
          client.pipe(upstream);
          upstream.pipe(client);
        });
        upstream.on("error", () => {
          client.destroy();
        });
        client.on("error", () => {
          upstream.destroy();
        });
      },
    );
    await new Promise<void>((resolve: () => void) => {
      proxy.listen(0, "127.0.0.1", resolve);
    });
    const proxyPort: number = (proxy.address() as AddressInfo).port;

    jest.spyOn(ProxyConfig, "getHttpProxyAgent").mockReturnValue(null);
    jest
      .spyOn(ProxyConfig, "getHttpsProxyAgent")
      .mockReturnValue(new https.Agent() as never);
    jest
      .spyOn(ProxyConfig, "getHttpsProxyUrl")
      .mockReturnValue(`http://127.0.0.1:${proxyPort}`);

    try {
      const response: ProbeWebsiteResponse = await pingWebsite(server);

      expect(response.isOnline).toBe(false);
      expect(response.failureCause).toContain(
        "certificate has been revoked by its issuer",
      );
    } finally {
      for (const socket of proxySockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve: () => void) => {
        proxy.close(() => {
          resolve();
        });
      });
    }
  });
});

describe("API monitor", () => {
  test("a revoked certificate fails the check", async () => {
    const server: TestServer = await startHttpsServer({
      leaf: "revoked",
      staple: pki.ocspResponse("revoked", "responder"),
    });

    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString(server.url),
      {
        requestType: HTTPMethod.GET,
        retry: 0,
        timeout: new PositiveNumber(15000),
      },
    );

    expect(response?.isOnline).toBe(false);
    expect(response?.failureCause).toContain(
      "certificate has been revoked by its issuer",
    );
    expect(response?.requestFailedDetails?.errorCode).toBe("CERT_REVOKED");
  });

  test("a good certificate passes", async () => {
    const server: TestServer = await startHttpsServer({
      leaf: "good",
      staple: pki.ocspResponse("good", "responder"),
    });

    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString(server.url),
      {
        requestType: HTTPMethod.GET,
        retry: 0,
        timeout: new PositiveNumber(15000),
      },
    );

    expect(response?.isOnline).toBe(true);
    expect(response?.statusCode).toBe(200);
  });
});

describe("SSL Certificate monitor", () => {
  test("a revoked certificate is not valid, with the revocation recorded", async () => {
    const server: TestServer = await startHttpsServer({
      leaf: "revoked",
      staple: pki.ocspResponse("revoked", "issuer"),
    });

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      "127.0.0.1",
      server.port,
      10000,
    );

    // Reachable, with a certificate that is not trustworthy.
    expect(response.isOnline).toBe(true);
    expect(response.isValidCertificate).toBe(false);
    expect(response.isSelfSigned).toBe(false);
    expect(response.certificateValidationErrorCode).toBe("CERT_REVOKED");
    expect(response.certificateValidationError).toContain(
      "certificate has been revoked by its issuer",
    );
    expect(response.failureCause).toBe(response.certificateValidationError);
    expect(response.revocationStatus).toBe(CertificateRevocationStatus.Revoked);
    expect(response.revocationCheckMethod).toBe(
      CertificateRevocationCheckMethod.StapledOcsp,
    );
    expect(response.revocationReason).toBe("Key Compromise");
    expect(response.revokedAt).toBeInstanceOf(Date);
    // Expiry and the rest are still read.
    expect(response.expiresAt).toBeInstanceOf(Date);
  });

  test("a good certificate is valid and recorded as not revoked", async () => {
    const server: TestServer = await startHttpsServer({
      leaf: "good",
      staple: null,
    });

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      "127.0.0.1",
      server.port,
      10000,
    );

    expect(response.isValidCertificate).toBe(true);
    expect(response.certificateValidationErrorCode).toBe("");
    expect(response.revocationStatus).toBe(
      CertificateRevocationStatus.NotRevoked,
    );
    expect(response.revocationCheckMethod).toBe(
      CertificateRevocationCheckMethod.Ocsp,
    );
  });

  test("no answer from the issuer leaves the certificate valid, with the status Unknown and why", async () => {
    const server: TestServer = await startHttpsServer({
      leaf: "revoked",
      staple: null,
    });
    issuerServices(false);

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      "127.0.0.1",
      server.port,
      10000,
    );

    expect(response.isValidCertificate).toBe(true);
    expect(response.revocationStatus).toBe(CertificateRevocationStatus.Unknown);
    expect(response.revocationCheckError).toContain("could not be reached");
  });

  test("a certificate that already failed validation is not looked up", async () => {
    // Without the test root the chain is untrusted.
    (SSLMonitor as any).getOptions.mockRestore();
    const server: TestServer = await startHttpsServer({
      leaf: "revoked",
      staple: pki.ocspResponse("revoked", "issuer"),
    });

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      "127.0.0.1",
      server.port,
      10000,
    );

    expect(response.isValidCertificate).toBe(false);
    expect(response.certificateValidationErrorCode).not.toBe("CERT_REVOKED");
    expect(response.revocationStatus).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("ping() treats a revoked certificate as a failed check and retries it", async () => {
    const server: TestServer = await startHttpsServer({
      leaf: "revoked",
      staple: pki.ocspResponse("revoked", "issuer"),
    });

    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://127.0.0.1:${server.port}`),
      { retry: 1, timeout: new PositiveNumber(10000) },
    );

    expect(response?.isOnline).toBe(true);
    expect(response?.isValidCertificate).toBe(false);
    expect(response?.totalAttempts).toBe(2);
    expect(response?.probeAttempts?.[0]?.failureCause).toContain("revoked");
  });
});
