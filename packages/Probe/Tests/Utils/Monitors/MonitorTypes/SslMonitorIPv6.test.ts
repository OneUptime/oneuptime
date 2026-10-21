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

import { SpyInstance } from "jest-mock";
import dns from "dns";
import { RequestOptions } from "https";
import { AddressInfo } from "net";
import tls from "tls";
import URL from "Common/Types/API/URL";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import SSLMonitor, {
  SslResponse,
} from "../../../../Utils/Monitors/MonitorTypes/SslMonitor";
import ProbeDnsLookup from "../../../../Utils/Monitors/ProbeDnsLookup";
import SelfSignedCertificate from "./SslTestCertificates";

/*
 * An SSL Certificate Monitor pointed at an IPv6 literal.
 *
 * The URL form of an IPv6 host is bracketed — "https://[2001:db8::1]/" — and
 * Hostname.fromAuthority hands that host back WITH its brackets, because
 * brackets are part of a URL authority. https.get does not strip them: it
 * resolves "[2001:db8::1]" as a name and fails ENOTFOUND, so every IPv6 SSL
 * monitor died on a DNS error for an address that needs no DNS.
 *
 * A real TLS listener on the IPv6 loopback is used rather than a mock,
 * because the whole defect was in what Node does with the string.
 */

let tlsServer: tls.Server;
const openSockets: Array<tls.TLSSocket> = [];
let tlsPort: number = 0;
let ipv6Available: boolean = true;

beforeAll(async () => {
  tlsServer = tls.createServer(
    { key: SelfSignedCertificate.key, cert: SelfSignedCertificate.cert },
    (socket: tls.TLSSocket) => {
      openSockets.push(socket);
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
    },
  );

  await new Promise<void>((resolve: () => void) => {
    tlsServer.once("error", () => {
      // A CI runner with IPv6 disabled entirely: skip rather than fail.
      ipv6Available = false;
      resolve();
    });
    tlsServer.listen(0, "::1", () => {
      tlsPort = (tlsServer.address() as AddressInfo).port;
      resolve();
    });
  });
}, 30000);

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    if (!tlsServer.listening) {
      resolve();
      return;
    }

    /*
     * close() alone waits for sockets the monitor left half-open, which
     * outlives the hook's deadline.
     */
    for (const socket of openSockets) {
      socket.destroy();
    }
    tlsServer.close(() => {
      return resolve();
    });
  });
}, 30000);

describe("SSLMonitor with an IPv6 literal host", () => {
  test("reaches a listener on the IPv6 loopback instead of failing ENOTFOUND", async () => {
    if (!ipv6Available) {
      return;
    }

    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://[::1]:${tlsPort}/`),
      {
        timeout: new PositiveNumber(5000),
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response).not.toBeNull();

    /*
     * The assertion that pins the fix. Pre-fix the failure cause carried
     * "ENOTFOUND [::1]" — Node had been asked to resolve the brackets as
     * part of a hostname.
     */
    expect(response?.failureCause || "").not.toContain("ENOTFOUND");
    expect(response?.failureCause || "").not.toContain("[::1]");
  }, 30000);

  test("the certificate is actually read back over IPv6", async () => {
    if (!ipv6Available) {
      return;
    }

    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://[::1]:${tlsPort}/`),
      {
        timeout: new PositiveNumber(5000),
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.isOnline).toBe(true);
    expect(response?.isSelfSigned).toBe(true);
    expect(response?.expiresAt).toBeDefined();
  }, 30000);

  test("an IPv6 host with a non-default port still splits host from port", async () => {
    if (!ipv6Available) {
      return;
    }

    /*
     * The bracket-stripping must not undo the port split that
     * https://github.com/OneUptime/oneuptime/issues/3225 added: a monitor on
     * a non-443 port must not try to resolve a host named "[::1]:PORT".
     */
    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://[::1]:${tlsPort}/some/path`),
      {
        timeout: new PositiveNumber(5000),
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.isOnline).toBe(true);
  }, 30000);
});

/*
 * A probe with no usable IPv6, checking the certificate of an IPv6 host that
 * is up. The TCP connect under the TLS handshake fails with EADDRNOTAVAIL
 * (IPv6 off on the probe's loopback, the customer's case) or ENETUNREACH (a
 * plain Docker bridge) before a packet leaves the probe. The failure cause
 * used to be that bare Node message, next to isValidCertificate false, which
 * reads as the customer's endpoint being broken.
 *
 * getCertificate is stubbed with the error Node produces: no real socket on
 * a developer machine or CI runner can be made to fail this way on demand.
 */
describe("SSLMonitor on a probe that cannot send IPv6 traffic", () => {
  const CUSTOMER_ADDRESS: string = "2001:518:2800:9::2";

  const connectError: (data: {
    code: string;
    errno: number;
    address: string;
    local?: string | undefined;
  }) => NodeJS.ErrnoException = (data: {
    code: string;
    errno: number;
    address: string;
    local?: string | undefined;
  }): NodeJS.ErrnoException => {
    const message: string = data.local
      ? `connect ${data.code} ${data.address}:443 - Local (${data.local})`
      : `connect ${data.code} ${data.address}:443`;

    return Object.assign(new Error(message), {
      code: data.code,
      errno: data.errno,
      syscall: "connect",
      address: data.address,
      port: 443,
    });
  };

  const noIPv6SourceAddress: () => NodeJS.ErrnoException =
    (): NodeJS.ErrnoException => {
      return connectError({
        code: "EADDRNOTAVAIL",
        errno: -99,
        address: CUSTOMER_ADDRESS,
        local: ":::0",
      });
    };

  /*
   * Not "cannot send IPv6 traffic": from a TCP connect, EADDRNOTAVAIL is
   * also what a probe that has run out of local ports gets.
   */
  const CUSTOMER_FAILURE_CAUSE: string =
    "This probe could not open an IPv6 connection from its own side (connect EADDRNOTAVAIL 2001:518:2800:9::2:443 - Local (:::0)), so 2001:518:2800:9::2 was never contacted. This usually means the probe has no usable IPv6 address or route (less often, that it has run out of local ports); this says nothing about whether 2001:518:2800:9::2 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.";

  let getCertificateSpy: SpyInstance<typeof SSLMonitor.getCertificate>;

  beforeEach(() => {
    getCertificateSpy = jest.spyOn(SSLMonitor, "getCertificate");
    jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the customer's EADDRNOTAVAIL is reported as the probe's, not as a certificate verdict", async () => {
    getCertificateSpy.mockRejectedValue(noIPv6SourceAddress());

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      CUSTOMER_ADDRESS,
      443,
      1000,
    );

    expect(response.failureCause).toBe(CUSTOMER_FAILURE_CAUSE);
    expect(response.isOnline).toBe(false);
    expect(response.isTimeout).toBe(false);
    expect(response.isSelfSigned).toBe(false);
    /*
     * Still false, not undefined: the dashboard reads a missing field as an
     * old probe's payload and would show "Signed by a CA". Criteria already
     * treat any offline response as not valid, so this changes no verdict.
     */
    expect(response.isValidCertificate).toBe(false);
    expect(response.certificateValidationError).toBe("");
    expect(response.certificateValidationErrorCode).toBe("");
    expect(response.expiresAt).toBeUndefined();
    // A connection failure is not retried without verification.
    expect(getCertificateSpy).toHaveBeenCalledTimes(1);
  });

  test("every retry of ping() carries the probe-side cause, and the retry count is unchanged", async () => {
    getCertificateSpy.mockRejectedValue(noIPv6SourceAddress());

    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://[${CUSTOMER_ADDRESS}]/`),
      {
        timeout: new PositiveNumber(1000),
        retry: 3,
        isOnlineCheckRequest: true,
      },
    );

    expect(getCertificateSpy).toHaveBeenCalledTimes(4);
    expect(response?.isOnline).toBe(false);
    expect(response?.failureCause).toBe(CUSTOMER_FAILURE_CAUSE);
    expect(response?.totalAttempts).toBe(4);
    expect(
      (response?.probeAttempts || []).map(
        (attempt: ProbeAttempt): string | undefined => {
          return attempt.failureCause;
        },
      ),
    ).toEqual([
      CUSTOMER_FAILURE_CAUSE,
      CUSTOMER_FAILURE_CAUSE,
      CUSTOMER_FAILURE_CAUSE,
      CUSTOMER_FAILURE_CAUSE,
    ]);
  });

  test("ENETUNREACH to an IPv6 host is hedged, because a router can send it too", async () => {
    getCertificateSpy.mockRejectedValue(
      connectError({
        code: "ENETUNREACH",
        errno: -101,
        address: CUSTOMER_ADDRESS,
        local: ":::0",
      }),
    );

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      CUSTOMER_ADDRESS,
      443,
      1000,
    );

    expect(response.isOnline).toBe(false);
    expect(response.failureCause).toBe(
      "This probe could not reach 2001:518:2800:9::2 over IPv6 (connect ENETUNREACH 2001:518:2800:9::2:443 - Local (:::0)). Most likely this probe has no IPv6 route rather than 2001:518:2800:9::2 being down. Monitor IPv6 destinations from a probe that has IPv6 connectivity.",
    );
  });

  test("an IPv4 host with no source address is the probe's, with no IPv6 claim", async () => {
    getCertificateSpy.mockRejectedValue(
      connectError({
        code: "EADDRNOTAVAIL",
        errno: -99,
        address: "192.0.2.1",
        local: "0.0.0.0:0",
      }),
    );

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      "192.0.2.1",
      443,
      1000,
    );

    expect(response.failureCause).toBe(
      "This probe could not send traffic to 192.0.2.1 (connect EADDRNOTAVAIL 192.0.2.1:443 - Local (0.0.0.0:0)), so 192.0.2.1 was never contacted. The failure is on the probe, not on 192.0.2.1.",
    );
  });

  /*
   * Each of these says something real about the destination or the path, so
   * each keeps the message it had: a refusal means the host is up with the
   * port closed, EHOSTUNREACH is a router or neighbour lookup giving up on
   * the target, and IPv4 ENETUNREACH may be a router's "no route" with no
   * hedged wording to put it in.
   */
  test.each([
    ["ECONNREFUSED", -111, CUSTOMER_ADDRESS, undefined, "Connection Refused."],
    [
      "EHOSTUNREACH",
      -113,
      CUSTOMER_ADDRESS,
      "2001:db8::5:51000",
      "connect EHOSTUNREACH 2001:518:2800:9::2:443 - Local (2001:db8::5:51000)",
    ],
    [
      "ENETUNREACH",
      -101,
      "192.0.2.1",
      "0.0.0.0:0",
      "connect ENETUNREACH 192.0.2.1:443 - Local (0.0.0.0:0)",
    ],
  ])(
    "%s (errno %i) to %s keeps its message",
    async (
      code: string,
      errno: number,
      address: string,
      local: string | undefined,
      expectedFailureCause: string,
    ) => {
      getCertificateSpy.mockRejectedValue(
        connectError({ code, errno, address, local }),
      );

      const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
        address,
        443,
        1000,
      );

      expect(response.isOnline).toBe(false);
      expect(response.failureCause).toBe(expectedFailureCause);
    },
  );

  test("an IPv4 proxy the probe cannot reach is not blamed on the probe's IPv6", async () => {
    /*
     * With a proxy configured the connect is to the proxy, so the error
     * names the proxy's address, not the IPv6 target's.
     */
    const proxyError: (code: string, errno: number) => NodeJS.ErrnoException = (
      code: string,
      errno: number,
    ): NodeJS.ErrnoException => {
      return Object.assign(
        new Error(`connect ${code} 10.0.0.1:3128 - Local (0.0.0.0:0)`),
        {
          code: code,
          errno: errno,
          syscall: "connect",
          address: "10.0.0.1",
          port: 3128,
        },
      );
    };

    getCertificateSpy
      .mockRejectedValueOnce(proxyError("EADDRNOTAVAIL", -99))
      .mockRejectedValueOnce(proxyError("ENETUNREACH", -101));

    const noSourceAddress: SslResponse = await SSLMonitor.getSslMonitorResponse(
      CUSTOMER_ADDRESS,
      443,
      1000,
    );
    const noRoute: SslResponse = await SSLMonitor.getSslMonitorResponse(
      CUSTOMER_ADDRESS,
      443,
      1000,
    );

    expect(noSourceAddress.failureCause).toBe(
      "This probe could not send traffic to 2001:518:2800:9::2 (connect EADDRNOTAVAIL 10.0.0.1:3128 - Local (0.0.0.0:0)), so 2001:518:2800:9::2 was never contacted. The failure is on the probe, not on 2001:518:2800:9::2.",
    );
    expect(noRoute.failureCause).toBe(
      "connect ENETUNREACH 10.0.0.1:3128 - Local (0.0.0.0:0)",
    );
  });

  /*
   * Both families failed with "no route". The IPv6 attempt alone would read
   * as a probe without IPv6, but the IPv4 one failed too, so this is not an
   * IPv6 problem and keeps the message it always had.
   */
  test("a dual-stack name with no route on both families is not called IPv6", async () => {
    const aggregateError: Error & { code: string; errors: Array<Error> } =
      Object.assign(new Error(""), {
        name: "AggregateError",
        code: "ENETUNREACH",
        errors: [
          connectError({
            code: "ENETUNREACH",
            errno: -101,
            address: "2001:db8::1",
            local: ":::0",
          }),
          connectError({
            code: "ENETUNREACH",
            errno: -101,
            address: "192.0.2.1",
          }),
        ],
      });
    getCertificateSpy.mockRejectedValue(aggregateError);

    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString("https://dual-stack.example/"),
      {
        timeout: new PositiveNumber(1000),
        retry: 1,
        isOnlineCheckRequest: true,
      },
    );

    const expected: string = API.getFriendlyErrorMessage(aggregateError);

    expect(response?.isOnline).toBe(false);
    expect(response?.failureCause).toBe(expected);
    expect(response?.failureCause).not.toContain("IPv6");
    expect(response?.failureCause).not.toContain("This probe");
    expect(
      (response?.probeAttempts || []).map(
        (attempt: ProbeAttempt): string | undefined => {
          return attempt.failureCause;
        },
      ),
    ).toEqual([expected, expected]);
  });

  test("a dual-stack name that could not leave the probe on either family gets no IPv6 claim", async () => {
    getCertificateSpy.mockRejectedValue(
      Object.assign(new Error(""), {
        name: "AggregateError",
        code: "EADDRNOTAVAIL",
        errors: [
          connectError({
            code: "EADDRNOTAVAIL",
            errno: -99,
            address: "2001:db8::1",
            local: ":::0",
          }),
          connectError({
            code: "EADDRNOTAVAIL",
            errno: -99,
            address: "192.0.2.1",
            local: "0.0.0.0:0",
          }),
        ],
      }),
    );

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      "dual-stack.example",
      443,
      1000,
    );

    expect(response.failureCause).toBe(
      "This probe could not send traffic to dual-stack.example (connect EADDRNOTAVAIL 2001:db8::1:443 - Local (:::0)), so dual-stack.example was never contacted. The failure is on the probe, not on dual-stack.example.",
    );
  });

  test("an IPv6-only name whose every address could not leave the probe is the probe's, named by the host", async () => {
    getCertificateSpy.mockRejectedValue(
      Object.assign(new Error(""), {
        name: "AggregateError",
        code: "EADDRNOTAVAIL",
        errors: [
          connectError({
            code: "EADDRNOTAVAIL",
            errno: -99,
            address: "2001:db8::64",
            local: ":::0",
          }),
          connectError({
            code: "EADDRNOTAVAIL",
            errno: -99,
            address: "2001:db8::65",
            local: ":::0",
          }),
        ],
      }),
    );

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      "v6only.example",
      443,
      1000,
    );

    expect(response.failureCause).toBe(
      "This probe could not open an IPv6 connection from its own side (connect EADDRNOTAVAIL 2001:db8::64:443 - Local (:::0)), so v6only.example was never contacted. This usually means the probe has no usable IPv6 address or route (less often, that it has run out of local ports); this says nothing about whether v6only.example is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.",
    );
  });

  test("a timed-out handshake to an IPv6 host is still a timeout", async () => {
    getCertificateSpy.mockRejectedValue(
      connectError({
        code: "ETIMEDOUT",
        errno: -110,
        address: CUSTOMER_ADDRESS,
      }),
    );

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      CUSTOMER_ADDRESS,
      443,
      1000,
    );

    expect(response.isTimeout).toBe(true);
    expect(response.failureCause).toBe(
      "SSL Certificate Monitor - the connection timed out after 1000ms.",
    );
  });

  test("a probe that loses IPv6 between the strict and lenient passes keeps the validation error", async () => {
    getCertificateSpy
      .mockRejectedValueOnce(
        Object.assign(new Error("self-signed certificate"), {
          code: "DEPTH_ZERO_SELF_SIGNED_CERT",
        }),
      )
      .mockRejectedValueOnce(noIPv6SourceAddress());

    const response: SslResponse = await SSLMonitor.getSslMonitorResponse(
      CUSTOMER_ADDRESS,
      443,
      1000,
    );

    expect(response.isOnline).toBe(false);
    expect(response.isSelfSigned).toBe(true);
    expect(response.certificateValidationErrorCode).toBe(
      "DEPTH_ZERO_SELF_SIGNED_CERT",
    );
    expect(response.failureCause).toBe(CUSTOMER_FAILURE_CAUSE);
  });

  test("an error thrown out of the whole check is described the same way", async () => {
    /*
     * getSslMonitorResponse resolves for every connection failure it knows
     * about, but ping() has its own catch for anything it throws, and that
     * path writes the attempt and the final failure cause too.
     */
    jest
      .spyOn(SSLMonitor, "getSslMonitorResponse")
      .mockRejectedValue(noIPv6SourceAddress());

    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://[${CUSTOMER_ADDRESS}]/`),
      {
        timeout: new PositiveNumber(1000),
        retry: 1,
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.isOnline).toBe(false);
    expect(response?.failureCause).toBe(CUSTOMER_FAILURE_CAUSE);
    expect(
      (response?.probeAttempts || []).map(
        (attempt: ProbeAttempt): string | undefined => {
          return attempt.failureCause;
        },
      ),
    ).toEqual([CUSTOMER_FAILURE_CAUSE, CUSTOMER_FAILURE_CAUSE]);
  });
});

/*
 * An IPv6-only name on a probe without IPv6. https.get resolves through
 * net.connect, which asks with dns.ADDRCONFIG; glibc then drops every AAAA
 * answer on a host with no global IPv6 address, and the check reported
 * "getaddrinfo ENOTFOUND" (the customer's DNS) for a name that resolves fine.
 * The SSL check resolves without that hint.
 */
describe("SSLMonitor resolves without dns.ADDRCONFIG", () => {
  // dns.lookup is overloaded; only the calls are read back.
  type LookupSpy = SpyInstance<(...args: Array<unknown>) => void>;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the request options carry the lookup without dns.ADDRCONFIG", () => {
    const options: RequestOptions = (
      SSLMonitor as unknown as {
        getOptions: (
          url: string,
          port: number,
          rejectUnauthorized: boolean,
          timeoutInMs?: number,
        ) => RequestOptions;
      }
    ).getOptions("v6only.example", 443, true, 1000);

    expect(options.lookup).toBe(ProbeDnsLookup.lookupWithoutAddrConfig);
  });

  test("an IPv6-only name reaches its certificate through that lookup", async () => {
    if (!ipv6Available) {
      return;
    }

    // What glibc answers on a v6-less host: nothing with ADDRCONFIG, AAAA without.
    const lookupSpy: LookupSpy = jest.spyOn(dns, "lookup").mockImplementation(((
      hostname: string,
      options: dns.LookupOptions,
      callback: (
        error: NodeJS.ErrnoException | null,
        addresses: Array<dns.LookupAddress>,
      ) => void,
    ): void => {
      setImmediate(() => {
        if (((options.hints || 0) & dns.ADDRCONFIG) !== 0) {
          callback(
            Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
              code: "ENOTFOUND",
            }),
            [],
          );
          return;
        }

        callback(null, [{ address: "::1", family: 6 }]);
      });
    }) as never) as unknown as LookupSpy;

    const response: SslResponse | null = await SSLMonitor.ping(
      URL.fromString(`https://v6only.example:${tlsPort}/`),
      {
        timeout: new PositiveNumber(5000),
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.failureCause || "").not.toContain("ENOTFOUND");
    expect(response?.isOnline).toBe(true);
    expect(lookupSpy).toHaveBeenCalled();
    for (const call of lookupSpy.mock.calls) {
      expect(call[0]).toBe("v6only.example");
      expect(
        (((call[1] as dns.LookupOptions).hints || 0) & dns.ADDRCONFIG) === 0,
      ).toBe(true);
    }
  }, 30000);
});
