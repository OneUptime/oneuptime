// Set required env vars before importing PortMonitor (through Register/Config).
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  afterEach,
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
      canProbeMonitorPortMonitors: jest.fn(async (): Promise<boolean> => {
        return true;
      }),
    },
  };
});

jest.mock("../../../../Services/Register", () => {
  return {
    __esModule: true,
    default: {
      isPingMonitoringEnabled: jest.fn(async (): Promise<boolean> => {
        return true;
      }),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { debug: jest.fn(), error: jest.fn() },
  };
});

jest.mock("net", () => {
  const actualNet: typeof import("net") = jest.requireActual(
    "net",
  ) as typeof import("net");
  const actualEvents: typeof import("events") = jest.requireActual(
    "events",
  ) as typeof import("events");

  const actualDns: typeof import("dns") = jest.requireActual(
    "dns",
  ) as typeof import("dns");

  type LookupLike = (
    hostname: string,
    options: { all: boolean; hints: number },
    callback: (
      error: Error | null,
      addresses: Array<{ address: string; family: number }>,
    ) => void,
  ) => void;

  const sockets: Array<MockSocket> = [];
  // Errors for the next connects to fail with; an empty queue connects.
  const connectErrors: Array<Error> = [];
  /*
   * For the next connects: resolve through the lookup PortMonitor handed
   * over, the way Node's net does (every address, with dns.ADDRCONFIG), then
   * fail with the error built for the first address it answered.
   */
  const lookupThenFail: Array<(address: string) => Error> = [];

  class MockSocket extends actualEvents.EventEmitter {
    public readonly connectCalls: Array<{ port: number; host: string }> = [];
    // The lookup each connect was handed, in the same order.
    public readonly connectLookups: Array<unknown> = [];

    public constructor() {
      super();
      sockets.push(this);
    }

    // PortMonitor passes the options form: { port, host, lookup }.
    public connect(options: {
      port: number;
      host: string;
      lookup?: unknown;
    }): this {
      this.connectCalls.push({ port: options.port, host: options.host });
      this.connectLookups.push(options.lookup);

      const failAfterLookup: ((address: string) => Error) | undefined =
        lookupThenFail.shift();

      if (failAfterLookup) {
        (options.lookup as LookupLike)(
          options.host,
          { all: true, hints: actualDns.ADDRCONFIG },
          (
            error: Error | null,
            addresses: Array<{ address: string; family: number }>,
          ) => {
            if (error) {
              this.emit("error", error);
              return;
            }

            this.emit("error", failAfterLookup(addresses[0]!.address));
          },
        );
        return this;
      }

      const connectError: Error | undefined = connectErrors.shift();
      setImmediate(() => {
        if (connectError) {
          return this.emit("error", connectError);
        }

        return this.emit("connect");
      });
      return this;
    }

    public destroy(): this {
      return this;
    }
  }

  return {
    __esModule: true,
    default: {
      ...actualNet,
      Socket: MockSocket,
      getMockSockets: (): Array<MockSocket> => {
        return sockets;
      },
      queueConnectError: (error: Error): void => {
        connectErrors.push(error);
      },
      queueLookupThenFail: (makeError: (address: string) => Error): void => {
        lookupThenFail.push(makeError);
      },
      resetMockSockets: (): void => {
        sockets.length = 0;
        connectErrors.length = 0;
        lookupThenFail.length = 0;
      },
    },
  };
});

import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import IP from "Common/Types/IP/IP";
import IPv6 from "Common/Types/IP/IPv6";
import Port from "Common/Types/Port";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import { RequestFailedPhase } from "Common/Types/Probe/RequestFailedDetails";
import Sleep from "Common/Types/Sleep";
import dns from "dns";
import { SpyInstance } from "jest-mock";
import net from "net";
import PortMonitor, {
  PortMonitorResponse,
} from "../../../../Utils/Monitors/MonitorTypes/PortMonitor";
import ProbeDnsLookup from "../../../../Utils/Monitors/ProbeDnsLookup";
import { EventEmitter } from "events";

interface ControllableNet {
  getMockSockets: () => Array<
    EventEmitter & {
      connectCalls: Array<{ port: number; host: string }>;
      connectLookups: Array<unknown>;
    }
  >;
  queueConnectError: (error: Error) => void;
  queueLookupThenFail: (makeError: (address: string) => Error) => void;
  resetMockSockets: () => void;
}

// The fields Node sets on a socket's connect error.
interface SocketConnectError extends Error {
  code: string;
  errno: number;
  syscall: string;
  address: string;
  port: number;
}

const controllableNet: ControllableNet = net as unknown as ControllableNet;

/*
 * The Port-monitor path with an IPv6 destination. BGP is TCP/179, which is
 * what the customer report behind this suite was checking.
 *
 * The assertion that matters is what reaches socket.connect: Node does NOT
 * strip IPv6 URL brackets, so "[2001:db8::1]" is resolved as a NAME and the
 * check fails ENOTFOUND on an address that needed no DNS at all.
 */

const CUSTOMER_ADDRESS: string = "2001:518:2800:9::2";

function lastConnect(): { port: number; host: string } {
  const sockets: Array<{
    connectCalls: Array<{ port: number; host: string }>;
  }> = controllableNet.getMockSockets();
  const calls: Array<{ port: number; host: string }> =
    sockets[sockets.length - 1]!.connectCalls;

  return calls[calls.length - 1]!;
}

beforeEach(() => {
  controllableNet.resetMockSockets();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("PortMonitor.ping — IPv6 destinations", () => {
  test("an IP destination dials the bare address on the configured port", async () => {
    await PortMonitor.ping(
      IP.fromString(CUSTOMER_ADDRESS) as IPv6,
      new Port(179),
      {
        retry: 0,
        timeout: new PositiveNumber(500),
        isOnlineCheckRequest: true,
      },
    );

    expect(lastConnect()).toEqual({ host: CUSTOMER_ADDRESS, port: 179 });
  });

  test("a bracketed IPv6 Hostname has its brackets removed before connect", async () => {
    /*
     * net.connect({host: "[2001:db8::1]"}) does a DNS lookup and fails
     * ENOTFOUND. The brackets belong to URL syntax, not to the address.
     */
    await PortMonitor.ping(
      new Hostname(`[${CUSTOMER_ADDRESS}]`),
      new Port(179),
      {
        retry: 0,
        timeout: new PositiveNumber(500),
        isOnlineCheckRequest: true,
      },
    );

    expect(lastConnect().host).toBe(CUSTOMER_ADDRESS);
    expect(net.isIP(lastConnect().host)).toBe(6);
  });

  test("a URL destination is unwrapped the same way", async () => {
    await PortMonitor.ping(
      URL.fromString(`https://[${CUSTOMER_ADDRESS}]/`),
      new Port(179),
      {
        retry: 0,
        timeout: new PositiveNumber(500),
        isOnlineCheckRequest: true,
      },
    );

    expect(lastConnect().host).toBe(CUSTOMER_ADDRESS);
  });

  test("a bracketed Hostname carrying its own port still uses that port", async () => {
    await PortMonitor.ping(
      Hostname.fromAuthority(`[${CUSTOMER_ADDRESS}]:179`),
      new Port(80),
      {
        retry: 0,
        timeout: new PositiveNumber(500),
        isOnlineCheckRequest: true,
      },
    );

    expect(lastConnect()).toEqual({ host: CUSTOMER_ADDRESS, port: 179 });
  });

  test("an IPv6 destination built by Hostname.fromString is not truncated", async () => {
    /*
     * fromString used to return host "2001" / port 518 here, so the check
     * dialled a DNS name called "2001" on port 518 — and because 518 is a
     * legal port, nothing anywhere said so.
     */
    await PortMonitor.ping(
      Hostname.fromString(CUSTOMER_ADDRESS),
      new Port(179),
      {
        retry: 0,
        timeout: new PositiveNumber(500),
        isOnlineCheckRequest: true,
      },
    );

    expect(lastConnect()).toEqual({ host: CUSTOMER_ADDRESS, port: 179 });
  });

  test("IPv4 destinations are dialled exactly as before", async () => {
    await PortMonitor.ping(IP.fromString("192.0.2.1") as never, new Port(179), {
      retry: 0,
      timeout: new PositiveNumber(500),
      isOnlineCheckRequest: true,
    });

    expect(lastConnect()).toEqual({ host: "192.0.2.1", port: 179 });
  });

  test("a DNS name is passed through untouched, brackets or not being irrelevant", async () => {
    await PortMonitor.ping(new Hostname("rs1.example.net"), new Port(179), {
      retry: 0,
      timeout: new PositiveNumber(500),
      isOnlineCheckRequest: true,
    });

    expect(lastConnect()).toEqual({ host: "rs1.example.net", port: 179 });
  });
});

/*
 * A probe with no usable IPv6. Node's connect() fails with EADDRNOTAVAIL
 * (IPv6 off on the probe's loopback, the customer's case) or ENETUNREACH (a
 * plain Docker bridge) before a single packet leaves the probe, while the
 * host being checked answers fine from anywhere with IPv6. The failure cause
 * used to be the bare Node message, which reads as the customer's port being
 * broken.
 */
describe("PortMonitor.ping — a probe that cannot send IPv6 traffic", () => {
  const TCP_FAILURE_DESCRIPTION: string =
    "TCP connection establishment failed before the port could be reached.";

  const connectError: (data: {
    code: string;
    errno: number;
    address: string;
    local?: string | undefined;
  }) => SocketConnectError = (data: {
    code: string;
    errno: number;
    address: string;
    local?: string | undefined;
  }): SocketConnectError => {
    const message: string = data.local
      ? `connect ${data.code} ${data.address}:179 - Local (${data.local})`
      : `connect ${data.code} ${data.address}:179`;

    return Object.assign(new Error(message), {
      code: data.code,
      errno: data.errno,
      syscall: "connect",
      address: data.address,
      port: 179,
    });
  };

  const noIPv6SourceAddress: () => SocketConnectError =
    (): SocketConnectError => {
      return connectError({
        code: "EADDRNOTAVAIL",
        errno: -99,
        address: CUSTOMER_ADDRESS,
        local: ":::0",
      });
    };

  const pingCustomerAddress: (
    retry: number,
  ) => Promise<PortMonitorResponse | null> = (
    retry: number,
  ): Promise<PortMonitorResponse | null> => {
    return PortMonitor.ping(
      IP.fromString(CUSTOMER_ADDRESS) as IPv6,
      new Port(179),
      {
        retry: retry,
        timeout: new PositiveNumber(500),
        isOnlineCheckRequest: true,
      },
    );
  };

  // eslint-disable-next-line @typescript-eslint/typedef
  let sleepSpy = jest.spyOn(Sleep, "sleep");

  beforeEach(() => {
    sleepSpy = jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);
  });

  afterEach(() => {
    sleepSpy.mockRestore();
  });

  test("the customer's EADDRNOTAVAIL is reported as the probe's, with the OS error kept", async () => {
    controllableNet.queueConnectError(noIPv6SourceAddress());

    const result: PortMonitorResponse | null = await pingCustomerAddress(0);

    expect(result?.isOnline).toBe(false);
    expect(result?.isTimeout).toBe(false);
    /*
     * Not "cannot send IPv6 traffic": from a TCP connect, EADDRNOTAVAIL is
     * also what a probe that has run out of local ports gets.
     */
    expect(result?.failureCause).toBe(
      "This probe could not open an IPv6 connection from its own side (connect EADDRNOTAVAIL 2001:518:2800:9::2:179 - Local (:::0)), so 2001:518:2800:9::2 was never contacted. This usually means the probe has no usable IPv6 address or route (less often, that it has run out of local ports); this says nothing about whether 2001:518:2800:9::2 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.",
    );
    expect(result?.requestFailedDetails).toMatchObject({
      failedPhase: RequestFailedPhase.TCPConnection,
      errorCode: "EADDRNOTAVAIL",
      rawErrorMessage:
        "Error: connect EADDRNOTAVAIL 2001:518:2800:9::2:179 - Local (:::0)",
    });
    expect(result?.requestFailedDetails?.errorDescription).toBe(
      "The probe could not open the IPv6 connection from its own side, so the TCP connection was never attempted and the destination port was never contacted. The failure is on the probe, not on the destination.",
    );
  });

  test("every retry carries the probe-side cause, and the retry count is unchanged", async () => {
    for (let index: number = 0; index < 4; index++) {
      controllableNet.queueConnectError(noIPv6SourceAddress());
    }

    const result: PortMonitorResponse | null = await pingCustomerAddress(3);

    expect(controllableNet.getMockSockets()).toHaveLength(4);
    expect(sleepSpy).toHaveBeenCalledTimes(3);
    expect(result?.isOnline).toBe(false);
    expect(result?.totalAttempts).toBe(4);

    for (const attempt of result?.probeAttempts || []) {
      expect(attempt.isOnline).toBe(false);
      expect(attempt.failureCause).toBe(result?.failureCause);
    }

    expect(
      (result?.probeAttempts || []).map((attempt: ProbeAttempt): number => {
        return attempt.attemptNumber;
      }),
    ).toEqual([1, 2, 3, 4]);
    expect(result?.failureCause).toContain(
      "could not open an IPv6 connection from its own side",
    );
  });

  test("EAFNOSUPPORT, IPv6 switched off in the probe's kernel, is the probe's too", async () => {
    controllableNet.queueConnectError(
      connectError({
        code: "EAFNOSUPPORT",
        errno: -97,
        address: CUSTOMER_ADDRESS,
      }),
    );

    const result: PortMonitorResponse | null = await pingCustomerAddress(0);

    expect(result?.isOnline).toBe(false);
    expect(result?.failureCause).toContain(
      "This probe cannot send IPv6 traffic (connect EAFNOSUPPORT 2001:518:2800:9::2:179), so 2001:518:2800:9::2 was never contacted.",
    );
    expect(result?.requestFailedDetails?.errorCode).toBe("EAFNOSUPPORT");
    expect(result?.requestFailedDetails?.errorDescription).toBe(
      "The probe cannot send IPv6 traffic, so the TCP connection was never attempted and the destination port was never contacted. The failure is on the probe, not on the destination.",
    );
  });

  test("ENETUNREACH to an IPv6 destination is hedged, because a router can send it too", async () => {
    controllableNet.queueConnectError(
      connectError({
        code: "ENETUNREACH",
        errno: -101,
        address: CUSTOMER_ADDRESS,
        local: ":::0",
      }),
    );

    const result: PortMonitorResponse | null = await pingCustomerAddress(0);

    expect(result?.isOnline).toBe(false);
    expect(result?.failureCause).toBe(
      "This probe could not reach 2001:518:2800:9::2 over IPv6 (connect ENETUNREACH 2001:518:2800:9::2:179 - Local (:::0)). Most likely this probe has no IPv6 route rather than 2001:518:2800:9::2 being down. Monitor IPv6 destinations from a probe that has IPv6 connectivity.",
    );
    expect(result?.failureCause).not.toContain("never contacted");
    expect(result?.requestFailedDetails).toMatchObject({
      failedPhase: RequestFailedPhase.TCPConnection,
      errorCode: "ENETUNREACH",
    });
    expect(result?.requestFailedDetails?.errorDescription).toContain(
      "Most likely",
    );
  });

  test("a DNS name that resolved to IPv6 is worded as IPv6, from the error's address", async () => {
    controllableNet.queueConnectError(noIPv6SourceAddress());

    const result: PortMonitorResponse | null = await PortMonitor.ping(
      new Hostname("rs1.example.net"),
      new Port(179),
      {
        retry: 0,
        timeout: new PositiveNumber(500),
        isOnlineCheckRequest: true,
      },
    );

    expect(result?.failureCause).toContain(
      "This probe could not open an IPv6 connection from its own side (connect EADDRNOTAVAIL 2001:518:2800:9::2:179 - Local (:::0)), so rs1.example.net was never contacted.",
    );
  });

  test("an IPv4 destination with no source address is the probe's, with no IPv6 claim", async () => {
    controllableNet.queueConnectError(
      connectError({
        code: "EADDRNOTAVAIL",
        errno: -99,
        address: "192.0.2.1",
        local: "0.0.0.0:0",
      }),
    );

    const result: PortMonitorResponse | null = await PortMonitor.ping(
      IP.fromString("192.0.2.1") as never,
      new Port(179),
      {
        retry: 0,
        timeout: new PositiveNumber(500),
        isOnlineCheckRequest: true,
      },
    );

    expect(result?.failureCause).toBe(
      "This probe could not send traffic to 192.0.2.1 (connect EADDRNOTAVAIL 192.0.2.1:179 - Local (0.0.0.0:0)), so 192.0.2.1 was never contacted. The failure is on the probe, not on 192.0.2.1.",
    );
    expect(result?.requestFailedDetails?.errorDescription).not.toContain(
      "IPv6",
    );
  });

  /*
   * Each of these says something real about the destination or the path:
   * a refusal means the host is up with the port closed, EHOSTUNREACH is a
   * router or neighbour lookup giving up on the target, and IPv4 ENETUNREACH
   * may be a router's "no route" with no hedged wording to put it in.
   */
  test.each([
    ["ECONNREFUSED", -111, CUSTOMER_ADDRESS, undefined],
    ["EHOSTUNREACH", -113, CUSTOMER_ADDRESS, "2001:db8::5:51000"],
    ["ENETUNREACH", -101, "192.0.2.1", "0.0.0.0:0"],
  ])(
    "%s (errno %i) to %s keeps the Node message and the TCP description",
    async (
      code: string,
      errno: number,
      address: string,
      local: string | undefined,
    ) => {
      const error: SocketConnectError = connectError({
        code,
        errno,
        address,
        local,
      });
      controllableNet.queueConnectError(error);

      const result: PortMonitorResponse | null = await PortMonitor.ping(
        IP.fromString(address) as never,
        new Port(179),
        {
          retry: 0,
          timeout: new PositiveNumber(500),
          isOnlineCheckRequest: true,
        },
      );

      expect(result?.isOnline).toBe(false);
      expect(result?.failureCause).toBe(`Error: ${error.message}`);
      expect(result?.requestFailedDetails).toMatchObject({
        failedPhase: RequestFailedPhase.TCPConnection,
        errorCode: code,
        errorDescription: TCP_FAILURE_DESCRIPTION,
      });
    },
  );

  test("an IPv6 connect that timed out is still a timeout", async () => {
    controllableNet.queueConnectError(
      connectError({
        code: "ETIMEDOUT",
        errno: -110,
        address: CUSTOMER_ADDRESS,
      }),
    );

    const result: PortMonitorResponse | null = await pingCustomerAddress(0);

    expect(result?.isTimeout).toBe(true);
    expect(result?.failureCause).toBe(
      "Error: connect ETIMEDOUT 2001:518:2800:9::2:179",
    );
    expect(result?.requestFailedDetails?.failedPhase).toBe(
      RequestFailedPhase.RequestTimeout,
    );
  });

  test("a dual-stack name whose IPv4 attempt timed out is not blamed on the probe", async () => {
    /*
     * Node's happy-eyeballs connect fails with one error per address and
     * copies the FIRST attempt's code onto the aggregate. The IPv6 attempt
     * never left the probe, but the IPv4 one went out and got no answer: that
     * is an outage, not a probe without IPv6.
     */
    const aggregateError: Error & { code: string; errors: Array<Error> } =
      Object.assign(new Error(""), {
        name: "AggregateError",
        code: "EADDRNOTAVAIL",
        errors: [
          noIPv6SourceAddress(),
          connectError({
            code: "ETIMEDOUT",
            errno: -110,
            address: "192.0.2.1",
          }),
        ],
      });
    controllableNet.queueConnectError(aggregateError);

    const result: PortMonitorResponse | null = await PortMonitor.ping(
      new Hostname("dual-stack.example"),
      new Port(179),
      {
        retry: 0,
        timeout: new PositiveNumber(500),
        isOnlineCheckRequest: true,
      },
    );

    expect(result?.isOnline).toBe(false);
    expect(result?.failureCause).toContain(
      "AggregateError (all connection attempts failed)",
    );
    expect(result?.failureCause).not.toContain("This probe");
    expect(result?.requestFailedDetails?.errorDescription).toBe(
      TCP_FAILURE_DESCRIPTION,
    );
  });

  /*
   * Both families failed with "no route". The IPv6 attempt alone would read
   * as a probe without IPv6, but the IPv4 one failed too, and an IPv4
   * ENETUNREACH during a TCP connect can be a router's: this is not an IPv6
   * problem, whichever attempt Node happened to try first.
   */
  test.each([
    ["IPv6 first", ["2001:db8::1", "192.0.2.1"]],
    ["IPv4 first", ["192.0.2.1", "2001:db8::1"]],
  ])(
    "a dual-stack name with no route on both families is not called IPv6 (%s)",
    async (_order: string, addresses: Array<string>) => {
      const aggregateError: Error & { code: string; errors: Array<Error> } =
        Object.assign(new Error(""), {
          name: "AggregateError",
          code: "ENETUNREACH",
          errors: addresses.map((address: string): SocketConnectError => {
            return connectError({
              code: "ENETUNREACH",
              errno: -101,
              address: address,
              local: net.isIPv6(address) ? ":::0" : undefined,
            });
          }),
        });
      controllableNet.queueConnectError(aggregateError);

      const result: PortMonitorResponse | null = await PortMonitor.ping(
        new Hostname("dual-stack.example"),
        new Port(179),
        {
          retry: 0,
          timeout: new PositiveNumber(500),
          isOnlineCheckRequest: true,
        },
      );

      expect(result?.isOnline).toBe(false);
      expect(result?.failureCause).toContain(
        "AggregateError (all connection attempts failed)",
      );
      expect(result?.failureCause).not.toContain("IPv6");
      expect(result?.failureCause).not.toContain("This probe");
      expect(result?.requestFailedDetails).toMatchObject({
        failedPhase: RequestFailedPhase.TCPConnection,
        errorCode: "ENETUNREACH",
        errorDescription: TCP_FAILURE_DESCRIPTION,
      });
    },
  );

  test("a dual-stack name that could not leave the probe on either family gets no IPv6 claim", async () => {
    const aggregateError: Error & { code: string; errors: Array<Error> } =
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
      });
    controllableNet.queueConnectError(aggregateError);

    const result: PortMonitorResponse | null = await PortMonitor.ping(
      new Hostname("dual-stack.example"),
      new Port(179),
      {
        retry: 0,
        timeout: new PositiveNumber(500),
        isOnlineCheckRequest: true,
      },
    );

    expect(result?.failureCause).toBe(
      "This probe could not send traffic to dual-stack.example (connect EADDRNOTAVAIL 2001:db8::1:179 - Local (:::0)), so dual-stack.example was never contacted. The failure is on the probe, not on dual-stack.example.",
    );
    expect(result?.requestFailedDetails?.errorDescription).toBe(
      "The probe could not open the TCP connection from its own side, so the destination port was never contacted. The failure is on the probe, not on the destination.",
    );
  });
});

/*
 * An IPv6-only name on a probe without IPv6. Node's net.connect resolves with
 * dns.ADDRCONFIG, and glibc drops every AAAA answer on a host that has no
 * global IPv6 address, so the check used to fail "getaddrinfo ENOTFOUND" and
 * blame the customer's DNS for a name that resolves fine (reproduced with
 * ipv6.google.com in node:26-bookworm-slim with IPv6 disabled). PortMonitor
 * now resolves without that hint, so the connect is what fails, on the probe.
 */
describe("PortMonitor.ping — an IPv6-only name on a probe without IPv6", () => {
  const V6_ONLY_ADDRESS: string = "2001:db8::64";

  // dns.lookup is overloaded; only the calls are read back.
  type LookupSpy = SpyInstance<(...args: Array<unknown>) => void>;

  // What glibc answers: nothing with ADDRCONFIG on a v6-less host, AAAA without.
  const lookupAnsweringLikeGlibc: (data: {
    hasAddress: boolean;
  }) => LookupSpy = (data: { hasAddress: boolean }): LookupSpy => {
    return jest.spyOn(dns, "lookup").mockImplementation(((
      hostname: string,
      options: dns.LookupOptions,
      callback: (
        error: NodeJS.ErrnoException | null,
        addresses: Array<dns.LookupAddress>,
      ) => void,
    ): void => {
      setImmediate(() => {
        const usesAddrConfig: boolean =
          ((options.hints || 0) & dns.ADDRCONFIG) !== 0;

        if (!data.hasAddress || usesAddrConfig) {
          callback(
            Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
              code: "ENOTFOUND",
              hostname: hostname,
            }),
            [],
          );
          return;
        }

        callback(null, [{ address: V6_ONLY_ADDRESS, family: 6 }]);
      });
    }) as never) as unknown as LookupSpy;
  };

  const connectFailedOnTheProbe: (address: string) => Error = (
    address: string,
  ): Error => {
    return Object.assign(
      new Error(`connect EADDRNOTAVAIL ${address}:443 - Local (:::0)`),
      {
        code: "EADDRNOTAVAIL",
        errno: -99,
        syscall: "connect",
        address: address,
        port: 443,
      },
    );
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("connect is handed the lookup without dns.ADDRCONFIG", async () => {
    await PortMonitor.ping(new Hostname("v6only.example"), new Port(443), {
      retry: 0,
      timeout: new PositiveNumber(500),
      isOnlineCheckRequest: true,
    });

    const sockets: Array<{ connectLookups: Array<unknown> }> =
      controllableNet.getMockSockets();

    expect(sockets[sockets.length - 1]!.connectLookups).toEqual([
      ProbeDnsLookup.lookupWithoutAddrConfig,
    ]);
  });

  test("the name resolves, the connect fails on the probe, and the probe is blamed rather than DNS", async () => {
    const lookupSpy: LookupSpy = lookupAnsweringLikeGlibc({
      hasAddress: true,
    });
    controllableNet.queueLookupThenFail(connectFailedOnTheProbe);

    const result: PortMonitorResponse | null = await PortMonitor.ping(
      new Hostname("v6only.example"),
      new Port(443),
      {
        retry: 0,
        timeout: new PositiveNumber(500),
        isOnlineCheckRequest: true,
      },
    );

    // Node asked for every address with ADDRCONFIG; the probe dropped only the hint.
    expect(lookupSpy).toHaveBeenCalledTimes(1);
    expect(lookupSpy.mock.calls[0]![0]).toBe("v6only.example");
    expect(lookupSpy.mock.calls[0]![1]).toEqual({ all: true, hints: 0 });

    expect(result?.isOnline).toBe(false);
    expect(result?.failureCause).toBe(
      `This probe could not open an IPv6 connection from its own side (connect EADDRNOTAVAIL ${V6_ONLY_ADDRESS}:443 - Local (:::0)), so v6only.example was never contacted. This usually means the probe has no usable IPv6 address or route (less often, that it has run out of local ports); this says nothing about whether v6only.example is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.`,
    );
    expect(result?.requestFailedDetails).toMatchObject({
      failedPhase: RequestFailedPhase.TCPConnection,
      errorCode: "EADDRNOTAVAIL",
    });
  });

  test("a name that does not exist is still a DNS failure", async () => {
    lookupAnsweringLikeGlibc({ hasAddress: false });
    controllableNet.queueLookupThenFail(connectFailedOnTheProbe);

    const result: PortMonitorResponse | null = await PortMonitor.ping(
      new Hostname("does-not-exist.example"),
      new Port(443),
      {
        retry: 0,
        timeout: new PositiveNumber(500),
        isOnlineCheckRequest: true,
      },
    );

    expect(result?.isOnline).toBe(false);
    expect(result?.failureCause).toBe(
      "Error: getaddrinfo ENOTFOUND does-not-exist.example",
    );
    expect(result?.requestFailedDetails).toMatchObject({
      failedPhase: RequestFailedPhase.DNSResolution,
      errorCode: "ENOTFOUND",
    });
  });
});
