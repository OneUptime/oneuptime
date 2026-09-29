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
  it,
} from "@jest/globals";
import WebsiteMonitor, {
  ProbeWebsiteResponse,
} from "../../../../Utils/Monitors/MonitorTypes/WebsiteMonitor";
import HttpMonitorRequest, {
  MonitorTlsOptions,
} from "../../../../Utils/Monitors/HttpMonitorRequest";
import {
  CLIENT_CERTIFICATE_CN,
  CLIENT_KEY_PASSPHRASE,
  FINAL_BODY_MARKER,
  HttpsHit,
  SelfSignedRedirectServers,
  startSelfSignedRedirectServers,
} from "./SelfSignedRedirectServers";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import URL from "Common/Types/API/URL";

/*
 * Regression suite for "Allow self-signed certificates" being dropped after
 * a cross-origin redirect. The SSRF hardening follows redirects one hop at a
 * time and stopped passing ANY TLS option after an origin change, so an
 * http://host -> https://host redirect to a self-signed certificate failed
 * with "Self Signed Certificate." even though the owner had allowed it.
 */

describe("WebsiteMonitor self-signed certificate allowance across redirects", () => {
  let servers: SelfSignedRedirectServers;
  let prepareSpy: jest.SpyInstance;

  const tlsForHop: (hop: number) => MonitorTlsOptions | undefined = (
    hop: number,
  ): MonitorTlsOptions | undefined => {
    return (
      prepareSpy.mock.calls[hop]![1] as NonNullable<
        Parameters<typeof HttpMonitorRequest.prepare>[1]
      >
    ).tls;
  };

  const hitPaths: () => Array<string> = (): Array<string> => {
    return servers.httpsHits.map((hit: HttpsHit) => {
      return hit.path;
    });
  };

  beforeAll(async () => {
    servers = await startSelfSignedRedirectServers();
  }, 30000);

  afterAll(async () => {
    await servers.close();
  });

  beforeEach(() => {
    servers.httpsHits.length = 0;

    /*
     * These tests exercise TLS options, not the private-network policy.
     * Pin every hop, whatever its hostname, to the loopback servers.
     */
    jest
      .spyOn(DataSourceEgressGuard, "assertUrlAllowed")
      .mockImplementation(async (rawUrl: string) => {
        return {
          url: new globalThis.URL(rawUrl),
          addresses: [{ address: "127.0.0.1", family: 4 }],
        };
      });
    prepareSpy = jest.spyOn(HttpMonitorRequest, "prepare");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps the self-signed allowance on an http -> https redirect to the same host", async () => {
    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString(`${servers.httpOrigin}/to-https/final`),
      {
        allowSelfSignedCertificates: true,
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.failureCause).toBe("");
    expect(response?.isOnline).toBe(true);
    expect(response?.statusCode).toBe(200);
    expect(response?.responseBody?.toString()).toContain(FINAL_BODY_MARKER);
    expect(response?.totalAttempts).toBe(1);
    expect(hitPaths()).toEqual(["/final"]);
    expect(prepareSpy).toHaveBeenCalledTimes(2);
    expect(tlsForHop(1)).toEqual({ allowSelfSignedCertificates: true });
  });

  it("still rejects the self-signed certificate after that redirect when self-signed certificates are not allowed", async () => {
    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString(`${servers.httpOrigin}/to-https/final`),
      {
        allowSelfSignedCertificates: false,
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.isOnline).toBe(false);
    expect(response?.failureCause).toBe("Self Signed Certificate.");
    expect(response?.totalAttempts).toBe(1);
    expect(servers.httpsHits).toEqual([]);
    expect(prepareSpy).toHaveBeenCalledTimes(2);
    expect(tlsForHop(0)?.allowSelfSignedCertificates).toBeFalsy();
    expect(tlsForHop(1)).toBeUndefined();
  });

  it("verifies a redirect to a different hostname normally", async () => {
    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString(`${servers.httpOrigin}/to-localhost/final`),
      {
        allowSelfSignedCertificates: true,
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.isOnline).toBe(false);
    expect(response?.failureCause).toBe("Self Signed Certificate.");
    expect(servers.httpsHits).toEqual([]);
    expect(prepareSpy).toHaveBeenCalledTimes(2);
    expect(prepareSpy.mock.calls[1]![0]).toMatch(/^https:\/\/localhost:/);
    expect(tlsForHop(1)).toBeUndefined();
  });

  it("presents the client certificate on the monitor's own origin, including same-origin redirects", async () => {
    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString(`${servers.httpsOrigin}/same-origin-redirect`),
      {
        allowSelfSignedCertificates: true,
        tlsClientCertificate: servers.clientCertificate,
        tlsClientKey: servers.clientKey,
        tlsClientKeyPassphrase: CLIENT_KEY_PASSPHRASE,
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.failureCause).toBe("");
    expect(response?.isOnline).toBe(true);
    expect(servers.httpsHits).toEqual([
      {
        path: "/same-origin-redirect",
        clientCertificateCN: CLIENT_CERTIFICATE_CN,
      },
      { path: "/final", clientCertificateCN: CLIENT_CERTIFICATE_CN },
    ]);
  });

  it("never presents client certificate material after the redirect leaves the monitor's origin", async () => {
    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString(`${servers.httpOrigin}/to-https/final`),
      {
        allowSelfSignedCertificates: true,
        tlsClientCertificate: servers.clientCertificate,
        tlsClientKey: servers.clientKey,
        tlsClientKeyPassphrase: CLIENT_KEY_PASSPHRASE,
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.failureCause).toBe("");
    expect(response?.isOnline).toBe(true);
    expect(servers.httpsHits).toEqual([
      { path: "/final", clientCertificateCN: undefined },
    ]);

    expect(prepareSpy).toHaveBeenCalledTimes(2);
    expect(tlsForHop(0)).toEqual({
      allowSelfSignedCertificates: true,
      tlsClientCertificate: servers.clientCertificate,
      tlsClientKey: servers.clientKey,
      tlsClientKeyPassphrase: CLIENT_KEY_PASSPHRASE,
    });
    expect(tlsForHop(1)).toStrictEqual({ allowSelfSignedCertificates: true });
  });

  it("does not bring the client certificate back when the chain returns to the monitor's origin", async () => {
    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString(`${servers.httpsOrigin}/to-http/final`),
      {
        allowSelfSignedCertificates: true,
        tlsClientCertificate: servers.clientCertificate,
        tlsClientKey: servers.clientKey,
        tlsClientKeyPassphrase: CLIENT_KEY_PASSPHRASE,
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.failureCause).toBe("");
    expect(response?.isOnline).toBe(true);
    expect(servers.httpsHits).toEqual([
      { path: "/to-http/final", clientCertificateCN: CLIENT_CERTIFICATE_CN },
      { path: "/final", clientCertificateCN: undefined },
    ]);

    expect(prepareSpy).toHaveBeenCalledTimes(3);
    expect(tlsForHop(1)).toStrictEqual({ allowSelfSignedCertificates: true });
    expect(tlsForHop(2)).toStrictEqual({ allowSelfSignedCertificates: true });
  });
});
