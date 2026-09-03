// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";
delete process.env["PROBE_ALLOW_PRIVATE_NETWORK_MONITORS"];

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import HttpMonitorRequest, {
  HTTP_MONITOR_MAX_REDIRECTS,
  HTTP_MONITOR_MAX_REQUEST_BYTES,
  HTTP_MONITOR_MAX_RESPONSE_BYTES,
  HttpMonitorExecutionContext,
  PinnedHttpProxyAgent,
  PinnedHttpsProxyAgent,
  PreparedHttpMonitorRequest,
  RedirectRequest,
} from "../../../Utils/Monitors/HttpMonitorRequest";
import ProxyConfig from "../../../Utils/ProxyConfig";
import { HttpTimingCollector } from "../../../Utils/HttpTimingAgents";
import { PROBE_PRIVATE_NETWORK_HINT } from "../../../Config";
import DataSourceEgressGuard, {
  EgressLookupFunction,
  ResolvedAddress,
} from "Common/Server/Utils/DataSource/EgressGuard";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import Headers from "Common/Types/API/Headers";
import OneUptimeURL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import TimeoutException from "Common/Types/Exception/TimeoutException";
import { JSONObject } from "Common/Types/JSON";
import { HttpsProxyAgent } from "https-proxy-agent";
import { EventEmitter } from "events";
import http from "http";
import https from "https";
import net from "net";

/*
 * HttpMonitorRequest is the security boundary between a tenant-controlled
 * monitor definition and a shared probe's network. These tests intentionally
 * inject DNS results and proxy decisions; none of them opens a real socket.
 */

const PUBLIC_IPV4: ResolvedAddress = {
  address: "93.184.216.34",
  family: 4,
};

const PUBLIC_IPV6: ResolvedAddress = {
  address: "2606:4700:4700::1111",
  family: 6,
};

interface LookupResult {
  error: NodeJS.ErrnoException | null;
  address: string | Array<{ address: string; family: number }>;
  family?: number | undefined;
}

type CallLookup = (
  lookup: EgressLookupFunction,
  hostname: string,
  options: { all?: boolean | undefined; family?: number | undefined },
) => Promise<LookupResult>;

const callLookup: CallLookup = (
  lookup: EgressLookupFunction,
  hostname: string,
  options: { all?: boolean | undefined; family?: number | undefined },
): Promise<LookupResult> => {
  return new Promise((resolve: (value: LookupResult) => void) => {
    lookup(
      hostname,
      options,
      (
        error: NodeJS.ErrnoException | null,
        address: string | Array<{ address: string; family: number }>,
        family?: number,
      ): void => {
        resolve({ error, address, family });
      },
    );
  });
};

type AllowTarget = (url: string, addresses?: Array<ResolvedAddress>) => void;

const allowTarget: AllowTarget = (
  url: string,
  addresses: Array<ResolvedAddress> = [PUBLIC_IPV4],
): void => {
  jest.spyOn(DataSourceEgressGuard, "assertUrlAllowed").mockResolvedValue({
    url: new globalThis.URL(url),
    addresses: addresses,
  });
};

type LookupFromAgent = (
  agent: http.Agent | https.Agent,
) => EgressLookupFunction;

const lookupFromAgent: LookupFromAgent = (
  agent: http.Agent | https.Agent,
): EgressLookupFunction => {
  return (
    agent as unknown as {
      options: { lookup: EgressLookupFunction };
    }
  ).options.lookup;
};

beforeEach(() => {
  /*
   * ProxyConfig already has focused NO_PROXY parsing tests. Here its public
   * per-target decision is the seam so preparation can be tested in isolation.
   */
  jest.spyOn(ProxyConfig, "getHttpProxyAgent").mockReturnValue(null);
  jest.spyOn(ProxyConfig, "getHttpsProxyAgent").mockReturnValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("HttpMonitorExecutionContext", () => {
  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: ["performance"],
      now: new Date("2026-09-03T12:00:00.000Z"),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("owns one stable AbortSignal and configurable cumulative response budget", () => {
    const context: HttpMonitorExecutionContext =
      new HttpMonitorExecutionContext(5000, 1234);

    expect(context.signal).toBe(context.signal);
    expect(context.signal.aborted).toBe(false);
    expect(context.responseBodyBudget.remainingBytes).toBe(1234);

    context.dispose();
  });

  test("reports a decreasing timeout against one absolute deadline", () => {
    const context: HttpMonitorExecutionContext =
      new HttpMonitorExecutionContext(1000);

    expect(context.remainingTimeoutInMs()).toBe(1000);
    jest.advanceTimersByTime(375);
    expect(context.remainingTimeoutInMs()).toBe(625);
    expect(context.canWait(624)).toBe(true);
    expect(context.canWait(625)).toBe(false);

    context.dispose();
  });

  test("aborts an in-flight operation at the absolute deadline", async () => {
    const context: HttpMonitorExecutionContext =
      new HttpMonitorExecutionContext(100);
    const neverSettles: Promise<string> = context.run(async () => {
      return await new Promise<string>(() => {});
    });
    const assertion: Promise<void> =
      expect(neverSettles).rejects.toBeInstanceOf(TimeoutException);

    jest.advanceTimersByTime(100);

    await assertion;
    expect(context.signal.aborted).toBe(true);
    context.dispose();
  });

  test("does not replace an operation error that occurs before the deadline", async () => {
    const context: HttpMonitorExecutionContext =
      new HttpMonitorExecutionContext(1000);
    const operationError: Error = new Error("upstream failed");

    await expect(
      context.run(async (): Promise<never> => {
        throw operationError;
      }),
    ).rejects.toBe(operationError);
    expect(context.signal.aborted).toBe(false);

    context.dispose();
  });

  test("completes a retry sleep inside the remaining deadline", async () => {
    const context: HttpMonitorExecutionContext =
      new HttpMonitorExecutionContext(1000);
    const sleeping: Promise<void> = context.sleep(250);

    jest.advanceTimersByTime(250);

    await expect(sleeping).resolves.toBeUndefined();
    expect(context.remainingTimeoutInMs()).toBe(750);
    expect(context.signal.aborted).toBe(false);
    context.dispose();
  });

  test("refuses a retry sleep that would consume the entire remaining deadline", async () => {
    const context: HttpMonitorExecutionContext =
      new HttpMonitorExecutionContext(1000);
    jest.advanceTimersByTime(400);

    await expect(context.sleep(600)).rejects.toBeInstanceOf(TimeoutException);
    expect(context.signal.aborted).toBe(false);

    context.dispose();
  });

  test("dispose clears the deadline timer without aborting the signal", () => {
    const context: HttpMonitorExecutionContext =
      new HttpMonitorExecutionContext(100);

    context.dispose();
    jest.advanceTimersByTime(100);

    expect(context.signal.aborted).toBe(false);
  });
});

describe("HttpMonitorRequest.prepare", () => {
  test("uses separate bounded response and request byte ceilings", () => {
    expect(HTTP_MONITOR_MAX_RESPONSE_BYTES).toBe(512 * 1024);
    expect(HTTP_MONITOR_MAX_REQUEST_BYTES).toBe(10 * 1024 * 1024);
  });

  test("enforces strict private-address policy with probe-specific operator guidance", async () => {
    const guard: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataSourceEgressGuard, "assertUrlAllowed")
      .mockResolvedValue({
        url: new globalThis.URL("https://api.example.com/v1/health?full=true"),
        addresses: [PUBLIC_IPV4],
      });

    const prepared: PreparedHttpMonitorRequest =
      await HttpMonitorRequest.prepare(
        "https://api.example.com/v1/health?full=true",
      );

    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledWith(
      "https://api.example.com/v1/health?full=true",
      {
        blockPrivateAddresses: true,
        targetLabel: "Monitor target",
        privateNetworkHint: PROBE_PRIVATE_NETWORK_HINT,
        includeResolvedAddressInError: false,
      },
    );
    expect(prepared.url.toString()).toBe(
      "https://api.example.com/v1/health?full=true",
    );
    expect(prepared.doNotFollowRedirects).toBe(true);
    expect(prepared.disableProxy).toBe(true);
    expect(prepared.maxContentLength).toBe(HTTP_MONITOR_MAX_RESPONSE_BYTES);
    expect(prepared.maxBodyLength).toBe(HTTP_MONITOR_MAX_REQUEST_BYTES);
  });

  test.each([
    "https://api.example.com/a//b?tag=one&tag=two",
    "https://api.example.com/~health",
  ])(
    "preserves the validated href exactly for dispatch: %s",
    async (targetUrl: string) => {
      allowTarget(targetUrl);

      const prepared: PreparedHttpMonitorRequest =
        await HttpMonitorRequest.prepare(targetUrl);

      expect(prepared.dispatchUrl).toBe(targetUrl);
    },
  );

  test("does not consult proxy configuration or build agents after policy rejection", async () => {
    jest
      .spyOn(DataSourceEgressGuard, "assertUrlAllowed")
      .mockRejectedValue(
        new BadDataException(
          "Monitor target host 127.0.0.1 is not allowed: loopback address.",
        ),
      );

    await expect(
      HttpMonitorRequest.prepare("http://127.0.0.1/admin"),
    ).rejects.toThrow("loopback address");

    expect(ProxyConfig.getHttpProxyAgent).not.toHaveBeenCalled();
    expect(ProxyConfig.getHttpsProxyAgent).not.toHaveBeenCalled();
  });

  test.each([
    ["HTTP", "http://multi-address.example/path", "httpAgent"],
    ["HTTPS", "https://multi-address.example/path", "httpsAgent"],
  ])(
    "pins the %s socket lookup to the complete validated address set",
    async (_label: string, targetUrl: string, selectedAgentName: string) => {
      allowTarget(targetUrl, [PUBLIC_IPV4, PUBLIC_IPV6]);

      const prepared: PreparedHttpMonitorRequest =
        await HttpMonitorRequest.prepare(targetUrl);
      const selectedAgent: http.Agent | https.Agent =
        prepared[selectedAgentName as "httpAgent" | "httpsAgent"]!;
      const lookup: EgressLookupFunction = lookupFromAgent(selectedAgent);

      expect(typeof lookup).toBe("function");
      await expect(
        callLookup(lookup, "rebound-to-private.attacker.example", {
          all: false,
        }),
      ).resolves.toMatchObject({
        error: null,
        address: PUBLIC_IPV4.address,
        family: 4,
      });
      await expect(
        callLookup(lookup, "rebound-to-private.attacker.example", {
          all: true,
        }),
      ).resolves.toMatchObject({
        error: null,
        address: [PUBLIC_IPV4, PUBLIC_IPV6],
      });
    },
  );

  test("copies caller headers instead of mutating the monitor definition", async () => {
    allowTarget("https://headers.example.com/");
    const headers: Headers = {
      Authorization: "Bearer monitor-token",
      "X-Monitor": "oneuptime",
    };

    const prepared: PreparedHttpMonitorRequest =
      await HttpMonitorRequest.prepare("https://headers.example.com/", {
        headers: headers,
      });

    prepared.headers["X-Monitor"] = "changed-for-request";
    expect(headers).toEqual({
      Authorization: "Bearer monitor-token",
      "X-Monitor": "oneuptime",
    });
  });

  test("carries client TLS credentials, passphrase, and self-signed opt-in onto the pinned HTTPS agent", async () => {
    allowTarget("https://mtls.example.com/health");

    const prepared: PreparedHttpMonitorRequest =
      await HttpMonitorRequest.prepare("https://mtls.example.com/health", {
        tls: {
          allowSelfSignedCertificates: true,
          tlsClientCertificate: "  CLIENT CERTIFICATE  ",
          tlsClientKey: "  CLIENT PRIVATE KEY  ",
          tlsClientKeyPassphrase: "pass phrase",
        },
      });

    expect(prepared.httpsAgent?.options).toMatchObject({
      rejectUnauthorized: false,
      cert: "CLIENT CERTIFICATE",
      key: "CLIENT PRIVATE KEY",
      passphrase: "pass phrase",
    });
    expect(typeof lookupFromAgent(prepared.httpsAgent!)).toBe("function");
  });

  test("does not install a partial client identity when either certificate or key is missing", async () => {
    allowTarget("https://mtls.example.com/health");

    const prepared: PreparedHttpMonitorRequest =
      await HttpMonitorRequest.prepare("https://mtls.example.com/health", {
        tls: {
          tlsClientCertificate: "CLIENT CERTIFICATE",
          tlsClientKey: "   ",
          tlsClientKeyPassphrase: "must-not-leak",
        },
      });

    expect(prepared.httpsAgent?.options.cert).toBeUndefined();
    expect(prepared.httpsAgent?.options.key).toBeUndefined();
    expect(prepared.httpsAgent?.options.passphrase).toBeUndefined();
  });

  test("uses pinned lookups and TLS options when HTTP timing collection is enabled", async () => {
    allowTarget("https://timed.example.com/health", [PUBLIC_IPV6]);
    const collector: HttpTimingCollector = new HttpTimingCollector();

    const prepared: PreparedHttpMonitorRequest =
      await HttpMonitorRequest.prepare("https://timed.example.com/health", {
        timingCollector: collector,
        tls: { allowSelfSignedCertificates: true },
      });

    expect(prepared.httpsAgent?.options.rejectUnauthorized).toBe(false);
    await expect(
      callLookup(
        lookupFromAgent(prepared.httpAgent!),
        "changed-after-validation.example",
        { all: false },
      ),
    ).resolves.toMatchObject({ address: PUBLIC_IPV6.address, family: 6 });
    await expect(
      callLookup(
        lookupFromAgent(prepared.httpsAgent!),
        "changed-after-validation.example",
        { all: false },
      ),
    ).resolves.toMatchObject({ address: PUBLIC_IPV6.address, family: 6 });
  });

  test("attributes guarded DNS validation time to lookup instead of download", async () => {
    jest.useFakeTimers({
      doNotFake: ["performance"],
      now: new Date("2026-09-03T12:00:00.000Z"),
    });

    try {
      jest
        .spyOn(DataSourceEgressGuard, "assertUrlAllowed")
        .mockImplementation(async () => {
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 40);
          });
          return {
            url: new globalThis.URL("http://delayed-dns.example/health"),
            addresses: [PUBLIC_IPV4],
          };
        });
      const collector: HttpTimingCollector = new HttpTimingCollector();

      const preparedRequest: Promise<PreparedHttpMonitorRequest> =
        HttpMonitorRequest.prepare("http://delayed-dns.example/health", {
          timingCollector: collector,
        });
      jest.advanceTimersByTime(40);
      await preparedRequest;

      const socket: net.Socket = new EventEmitter() as net.Socket;
      collector.attach(socket);
      socket.emit("lookup");
      jest.advanceTimersByTime(10);
      socket.emit("connect");
      jest.advanceTimersByTime(20);
      socket.emit("data", Buffer.from("first byte"));

      expect(collector.getTimings(100)).toEqual({
        dnsLookupInMs: 40,
        tcpConnectInMs: 10,
        timeToFirstByteInMs: 20,
        downloadInMs: 30,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test("pins an HTTP proxy request URI to the validated IP while preserving the original Host", async () => {
    allowTarget("http://status.example.com:8080/health?verbose=true");
    jest
      .spyOn(ProxyConfig, "getHttpProxyAgent")
      .mockReturnValue(new http.Agent() as never);
    jest
      .spyOn(ProxyConfig, "getHttpProxyUrl")
      .mockReturnValue("http://proxy.example.com:3128");

    const prepared: PreparedHttpMonitorRequest =
      await HttpMonitorRequest.prepare(
        "http://status.example.com:8080/health?verbose=true",
      );

    expect(prepared.url.toString()).toBe(
      "http://93.184.216.34:8080/health?verbose=true",
    );
    expect(prepared.headers).toMatchObject({
      Host: "status.example.com:8080",
    });
    expect(prepared.httpAgent).toBeInstanceOf(PinnedHttpProxyAgent);
    expect(prepared.httpsAgent).toBeUndefined();
    expect(prepared.disableProxy).toBe(true);
  });

  test("pins an HTTPS proxy CONNECT URL to an IPv6 address and keeps hostname identity for Host and SNI", async () => {
    allowTarget("https://secure.example.com:8443/health", [PUBLIC_IPV6]);
    jest
      .spyOn(ProxyConfig, "getHttpsProxyAgent")
      .mockReturnValue(new https.Agent() as never);
    jest
      .spyOn(ProxyConfig, "getHttpsProxyUrl")
      .mockReturnValue("http://proxy.example.com:3128");

    const prepared: PreparedHttpMonitorRequest =
      await HttpMonitorRequest.prepare(
        "https://secure.example.com:8443/health",
        {
          tls: {
            allowSelfSignedCertificates: true,
            tlsClientCertificate: "CLIENT CERTIFICATE",
            tlsClientKey: "CLIENT PRIVATE KEY",
            tlsClientKeyPassphrase: "pass phrase",
          },
        },
      );

    expect(prepared.url.toString()).toBe(
      "https://[2606:4700:4700::1111]:8443/health",
    );
    expect(prepared.headers).toMatchObject({
      Host: "secure.example.com:8443",
    });
    expect(prepared.httpsAgent).toBeInstanceOf(PinnedHttpsProxyAgent);
    expect(prepared.httpAgent).toBeUndefined();
    const proxyConnectionOptions: {
      rejectUnauthorized?: boolean | undefined;
      cert?: string | undefined;
      key?: string | undefined;
      passphrase?: string | undefined;
    } = (
      prepared.httpsAgent as unknown as {
        connectOpts: {
          rejectUnauthorized?: boolean | undefined;
          cert?: string | undefined;
          key?: string | undefined;
          passphrase?: string | undefined;
        };
      }
    ).connectOpts;
    expect(proxyConnectionOptions.rejectUnauthorized).toBeUndefined();
    expect(proxyConnectionOptions.cert).toBeUndefined();
    expect(proxyConnectionOptions.key).toBeUndefined();
    expect(proxyConnectionOptions.passphrase).toBeUndefined();
  });

  test("preserves an explicitly configured Host header when using a proxy", async () => {
    allowTarget("http://edge.example.com/path");
    jest
      .spyOn(ProxyConfig, "getHttpProxyAgent")
      .mockReturnValue(new http.Agent() as never);
    jest
      .spyOn(ProxyConfig, "getHttpProxyUrl")
      .mockReturnValue("http://proxy.example.com:3128");

    const prepared: PreparedHttpMonitorRequest =
      await HttpMonitorRequest.prepare("http://edge.example.com/path", {
        headers: { host: "virtual-host.example.com" },
      });

    expect(prepared.headers).toEqual({ host: "virtual-host.example.com" });
  });

  test("honours a per-target NO_PROXY decision by keeping the original URL and using pinned direct agents", async () => {
    allowTarget("https://no-proxy.example.com/health");
    const getProxyUrl: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ProxyConfig,
      "getHttpsProxyUrl",
    );

    const prepared: PreparedHttpMonitorRequest =
      await HttpMonitorRequest.prepare("https://no-proxy.example.com/health");

    expect(ProxyConfig.getHttpsProxyAgent).toHaveBeenCalledWith(
      "https://no-proxy.example.com/health",
    );
    expect(getProxyUrl).not.toHaveBeenCalled();
    expect(prepared.url.toString()).toBe("https://no-proxy.example.com/health");
    expect(prepared.httpAgent).toBeInstanceOf(http.Agent);
    expect(prepared.httpsAgent).toBeInstanceOf(https.Agent);
    await expect(
      callLookup(
        lookupFromAgent(prepared.httpsAgent!),
        "no-proxy.example.com",
        { all: false },
      ),
    ).resolves.toMatchObject({ address: PUBLIC_IPV4.address });
  });

  test("fails closed when ProxyConfig supplies an agent without its proxy URL", async () => {
    allowTarget("http://proxy-config.example.com/health");
    jest
      .spyOn(ProxyConfig, "getHttpProxyAgent")
      .mockReturnValue(new http.Agent() as never);
    jest.spyOn(ProxyConfig, "getHttpProxyUrl").mockReturnValue(null);

    await expect(
      HttpMonitorRequest.prepare("http://proxy-config.example.com/health"),
    ).rejects.toThrow("Monitor target proxy configuration is incomplete.");
  });
});

describe("Pinned proxy agents", () => {
  test("PinnedHttpProxyAgent puts the validated authority in the absolute proxy request URI and restores Host", () => {
    const agent: PinnedHttpProxyAgent = new PinnedHttpProxyAgent(
      "http://proxy.example.com:3128",
      "93.184.216.34:8080",
    );
    const headers: Record<string, string | number | string[] | undefined> = {
      host: "original.example.com:8080",
    };
    const request: {
      path: string;
      getHeader: (name: string) => string | number | string[] | undefined;
      setHeader: (
        name: string,
        value: string | number | readonly string[],
      ) => void;
      removeHeader: (name: string) => void;
    } = {
      path: "/private?probe=true",
      getHeader: (name: string): string | number | string[] | undefined => {
        return headers[name];
      },
      setHeader: (
        name: string,
        value: string | number | readonly string[],
      ): void => {
        if (Array.isArray(value)) {
          headers[name] = [...(value as readonly string[])];
        } else {
          headers[name] = value as string | number;
        }
      },
      removeHeader: (name: string): void => {
        delete headers[name];
      },
    };

    agent.setRequestProps(
      request as never,
      {
        port: 8080,
        secureEndpoint: false,
      } as never,
    );

    expect(request.path).toBe("http://93.184.216.34:8080/private?probe=true");
    expect(headers["host"]).toBe("original.example.com:8080");
  });

  test.each([
    [
      "//169.254.169.254/latest/meta-data",
      "http://93.184.216.34:8080//169.254.169.254/latest/meta-data",
    ],
    [
      "///169.254.169.254/latest/meta-data?role=admin",
      "http://93.184.216.34:8080///169.254.169.254/latest/meta-data?role=admin",
    ],
    [
      "/safe?next=//169.254.169.254/latest/meta-data",
      "http://93.184.216.34:8080/safe?next=//169.254.169.254/latest/meta-data",
    ],
  ])(
    "keeps a network-path-looking origin path on the pinned HTTP proxy authority (%s)",
    (requestPath: string, expectedAbsoluteTarget: string) => {
      const agent: PinnedHttpProxyAgent = new PinnedHttpProxyAgent(
        "http://proxy.example.com:3128",
        "93.184.216.34:8080",
      );
      const headers: Record<string, string> = {
        host: "public.example.com:8080",
      };
      const request: {
        path: string;
        getHeader: (name: string) => string | undefined;
        setHeader: (name: string, value: string) => void;
        removeHeader: (name: string) => void;
      } = {
        path: requestPath,
        getHeader: (name: string): string | undefined => {
          return headers[name];
        },
        setHeader: (name: string, value: string): void => {
          headers[name] = value;
        },
        removeHeader: (name: string): void => {
          delete headers[name];
        },
      };

      agent.setRequestProps(
        request as never,
        { port: 8080, secureEndpoint: false } as never,
      );

      expect(request.path).toBe(expectedAbsoluteTarget);
      expect(headers["host"]).toBe("public.example.com:8080");
    },
  );

  test("PinnedHttpsProxyAgent applies target TLS identity and credentials only inside the CONNECT tunnel", async () => {
    const socket: net.Socket = new net.Socket();
    const parentConnect: ReturnType<typeof jest.spyOn> = jest
      .spyOn(HttpsProxyAgent.prototype, "connect")
      .mockResolvedValue(socket as never);
    const agent: PinnedHttpsProxyAgent = new PinnedHttpsProxyAgent(
      "http://proxy.example.com:3128",
      "secure.example.com",
      {
        rejectUnauthorized: false,
        cert: "CLIENT CERTIFICATE",
        key: "CLIENT PRIVATE KEY",
        passphrase: "pass phrase",
      },
    );
    const request: EventEmitter = new EventEmitter();

    await agent.connect(
      request as never,
      {
        host: PUBLIC_IPV4.address,
        port: 443,
        secureEndpoint: true,
        servername: PUBLIC_IPV4.address,
      } as never,
    );

    expect(parentConnect).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        host: PUBLIC_IPV4.address,
        port: 443,
        secureEndpoint: true,
        servername: "secure.example.com",
        rejectUnauthorized: false,
        cert: "CLIENT CERTIFICATE",
        key: "CLIENT PRIVATE KEY",
        passphrase: "pass phrase",
      }),
    );
    socket.destroy();
  });
});

describe("HttpMonitorRequest.getRedirectRequest", () => {
  test.each([301, 302, 303, 307, 308])(
    "recognises redirect status %i and location header case-insensitively",
    (statusCode: number) => {
      const redirect: RedirectRequest | null =
        HttpMonitorRequest.getRedirectRequest({
          currentUrl: "https://example.com/start",
          statusCode: statusCode,
          responseHeaders: { LoCaTiOn: "/next" },
          currentMethod: HTTPMethod.GET,
          redirectsFollowed: 0,
        });

      expect(redirect).toMatchObject({
        url: "https://example.com/next",
        method: HTTPMethod.GET,
      });
    },
  );

  test.each([200, 204, 300, 304, 305, 306, 400, 500])(
    "does not treat status %i as a followed redirect",
    (statusCode: number) => {
      expect(
        HttpMonitorRequest.getRedirectRequest({
          currentUrl: "https://example.com/start",
          statusCode: statusCode,
          responseHeaders: { Location: "/next" },
          currentMethod: HTTPMethod.GET,
          redirectsFollowed: 0,
        }),
      ).toBeNull();
    },
  );

  test("does not redirect when Location is missing or empty", () => {
    for (const responseHeaders of [{}, { location: "" }]) {
      expect(
        HttpMonitorRequest.getRedirectRequest({
          currentUrl: "https://example.com/start",
          statusCode: 302,
          responseHeaders: responseHeaders,
          currentMethod: HTTPMethod.GET,
          redirectsFollowed: 0,
        }),
      ).toBeNull();
    }
  });

  test("resolves relative parent paths, query strings, and fragments against the current hop", () => {
    const redirect: RedirectRequest | null =
      HttpMonitorRequest.getRedirectRequest({
        currentUrl: OneUptimeURL.fromString(
          "https://example.com/a/b/start?old=true",
        ),
        statusCode: 302,
        responseHeaders: { Location: "../next?new=true#ready" },
        currentMethod: HTTPMethod.GET,
        redirectsFollowed: 2,
      });

    expect(redirect?.url).toBe("https://example.com/a/next?new=true#ready");
  });

  test("allows exactly the configured maximum redirect hops and rejects the next one", () => {
    expect(
      HttpMonitorRequest.getRedirectRequest({
        currentUrl: "https://example.com/start",
        statusCode: 302,
        responseHeaders: { Location: "/last-allowed-hop" },
        currentMethod: HTTPMethod.GET,
        redirectsFollowed: HTTP_MONITOR_MAX_REDIRECTS - 1,
      })?.url,
    ).toBe("https://example.com/last-allowed-hop");

    expect(() => {
      HttpMonitorRequest.getRedirectRequest({
        currentUrl: "https://example.com/start",
        statusCode: 302,
        responseHeaders: { Location: "/one-too-many" },
        currentMethod: HTTPMethod.GET,
        redirectsFollowed: HTTP_MONITOR_MAX_REDIRECTS,
      });
    }).toThrow(
      `Monitor target exceeded ${HTTP_MONITOR_MAX_REDIRECTS} redirects.`,
    );
  });

  test("rejects a malformed redirect URL", () => {
    expect(() => {
      HttpMonitorRequest.getRedirectRequest({
        currentUrl: "https://example.com/start",
        statusCode: 302,
        responseHeaders: { Location: "http://[not-an-ipv6-address" },
        currentMethod: HTTPMethod.GET,
        redirectsFollowed: 0,
      });
    }).toThrow("Monitor target returned an invalid redirect URL.");
  });

  test.each([301, 302])(
    "rewrites POST to GET on %i and removes body-specific headers case-insensitively",
    (statusCode: number) => {
      const body: JSONObject = { token: "tenant-controlled" };
      const redirect: RedirectRequest | null =
        HttpMonitorRequest.getRedirectRequest({
          currentUrl: "https://example.com/start",
          statusCode: statusCode,
          responseHeaders: { Location: "/next" },
          currentMethod: HTTPMethod.POST,
          requestHeaders: {
            "Content-Length": "29",
            "cOnTeNt-TyPe": "application/json",
            "X-Monitor": "oneuptime",
          },
          requestBody: body,
          redirectsFollowed: 0,
        });

      expect(redirect).toEqual({
        url: "https://example.com/next",
        method: HTTPMethod.GET,
        headers: { "X-Monitor": "oneuptime" },
      });
    },
  );

  test.each([
    HTTPMethod.POST,
    HTTPMethod.PUT,
    HTTPMethod.PATCH,
    HTTPMethod.DELETE,
  ])("rewrites %s to GET on 303", (method: HTTPMethod) => {
    const redirect: RedirectRequest | null =
      HttpMonitorRequest.getRedirectRequest({
        currentUrl: "https://example.com/start",
        statusCode: 303,
        responseHeaders: { Location: "/next" },
        currentMethod: method,
        requestHeaders: {
          "content-type": "application/json",
          "content-length": "7",
        },
        requestBody: { ok: true },
        redirectsFollowed: 0,
      });

    expect(redirect).toEqual({
      url: "https://example.com/next",
      method: HTTPMethod.GET,
      headers: {},
    });
  });

  test.each([307, 308])(
    "preserves method, body, and content headers on %i",
    (statusCode: number) => {
      const body: JSONObject = { preserve: true };
      const redirect: RedirectRequest | null =
        HttpMonitorRequest.getRedirectRequest({
          currentUrl: "https://example.com/start",
          statusCode: statusCode,
          responseHeaders: { Location: "/next" },
          currentMethod: HTTPMethod.POST,
          requestHeaders: {
            "Content-Type": "application/json",
            "Content-Length": "17",
          },
          requestBody: body,
          redirectsFollowed: 0,
        });

      expect(redirect).toEqual({
        url: "https://example.com/next",
        method: HTTPMethod.POST,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "17",
        },
        body: body,
      });
    },
  );

  test("preserves a non-POST method and body on 301", () => {
    const body: JSONObject = { preserve: true };
    const redirect: RedirectRequest | null =
      HttpMonitorRequest.getRedirectRequest({
        currentUrl: "https://example.com/start",
        statusCode: 301,
        responseHeaders: { Location: "/next" },
        currentMethod: HTTPMethod.PUT,
        requestHeaders: { "Content-Type": "application/json" },
        requestBody: body,
        redirectsFollowed: 0,
      });

    expect(redirect).toMatchObject({
      method: HTTPMethod.PUT,
      body: body,
      headers: { "Content-Type": "application/json" },
    });
  });

  test("strips every caller-controlled header across origins without changing the source headers", () => {
    const requestHeaders: Headers = {
      Authorization: "Bearer origin-secret",
      "Proxy-Authorization": "Basic proxy-secret",
      cOoKiE: "session=secret",
      "X-API-Key": "arbitrary-header-secret",
      HOST: "first.example.com",
      Accept: "application/json",
    };

    const redirect: RedirectRequest | null =
      HttpMonitorRequest.getRedirectRequest({
        currentUrl: "https://first.example.com/start",
        statusCode: 302,
        responseHeaders: {
          Location: "https://second.example.com/next",
        },
        currentMethod: HTTPMethod.GET,
        requestHeaders: requestHeaders,
        redirectsFollowed: 0,
      });

    expect(redirect?.headers).toEqual({});
    expect(redirect?.crossesOrigin).toBe(true);
    expect(requestHeaders).toEqual({
      Authorization: "Bearer origin-secret",
      "Proxy-Authorization": "Basic proxy-secret",
      cOoKiE: "session=secret",
      "X-API-Key": "arbitrary-header-secret",
      HOST: "first.example.com",
      Accept: "application/json",
    });
  });

  test.each([
    { statusCode: 301, method: HTTPMethod.POST },
    { statusCode: 302, method: HTTPMethod.POST },
    { statusCode: 303, method: HTTPMethod.POST },
    { statusCode: 303, method: HTTPMethod.PUT },
    { statusCode: 303, method: HTTPMethod.PATCH },
    { statusCode: 303, method: HTTPMethod.DELETE },
  ])(
    "allows a cross-origin $statusCode redirect after the standard $method-to-GET rewrite",
    ({ statusCode, method }: { statusCode: number; method: HTTPMethod }) => {
      const redirect: RedirectRequest | null =
        HttpMonitorRequest.getRedirectRequest({
          currentUrl: "http://first.example.com/start",
          statusCode: statusCode,
          responseHeaders: {
            Location: "https://second.example.com/next",
          },
          currentMethod: method,
          requestHeaders: {
            Authorization: "Bearer must-not-leak",
            "Content-Type": "application/json",
            "Content-Length": "30",
          },
          requestBody: { secret: "must-not-leak" },
          redirectsFollowed: 0,
        });

      expect(redirect).toEqual({
        url: "https://second.example.com/next",
        method: HTTPMethod.GET,
        headers: {},
        crossesOrigin: true,
      });
    },
  );

  test.each([
    { statusCode: 307, method: HTTPMethod.POST },
    { statusCode: 308, method: HTTPMethod.PATCH },
    { statusCode: 301, method: HTTPMethod.PUT },
  ])(
    "refuses a cross-origin $statusCode redirect for $method with a secret body",
    ({ statusCode, method }: { statusCode: number; method: HTTPMethod }) => {
      expect(() => {
        HttpMonitorRequest.getRedirectRequest({
          currentUrl: "https://first.example.com/start",
          statusCode: statusCode,
          responseHeaders: {
            Location: "https://second.example.com/collect",
          },
          currentMethod: method,
          requestHeaders: { "X-API-Key": "must-not-leak" },
          requestBody: { secret: "must-not-leak" },
          redirectsFollowed: 0,
        });
      }).toThrow("unsafe cross-origin redirect");
    },
  );

  test("retains origin credentials for a same-origin redirect but always removes Host", () => {
    const redirect: RedirectRequest | null =
      HttpMonitorRequest.getRedirectRequest({
        currentUrl: "https://example.com:8443/start",
        statusCode: 302,
        responseHeaders: { Location: "/next" },
        currentMethod: HTTPMethod.GET,
        requestHeaders: {
          authorization: "Bearer same-origin",
          Cookie: "session=same-origin",
          Host: "example.com:8443",
        },
        redirectsFollowed: 0,
      });

    expect(redirect?.headers).toEqual({
      authorization: "Bearer same-origin",
      Cookie: "session=same-origin",
    });
    expect(redirect?.crossesOrigin).toBeUndefined();
  });

  test.each(["http://example.com/next", "https://example.com:8443/next"])(
    "treats scheme or effective-port changes as cross-origin for credential stripping (%s)",
    (location: string) => {
      const redirect: RedirectRequest | null =
        HttpMonitorRequest.getRedirectRequest({
          currentUrl: "https://example.com/start",
          statusCode: 302,
          responseHeaders: { Location: location },
          currentMethod: HTTPMethod.GET,
          requestHeaders: { Authorization: "Bearer secret" },
          redirectsFollowed: 0,
        });

      expect(redirect?.headers).toEqual({});
      expect(redirect?.crossesOrigin).toBe(true);
    },
  );
});
