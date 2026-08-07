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
    default: {
      debug: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("net", () => {
  const actualNet: typeof import("net") = jest.requireActual(
    "net",
  ) as typeof import("net");
  const actualEvents: typeof import("events") = jest.requireActual(
    "events",
  ) as typeof import("events");
  const EventEmitterConstructor: typeof import("events").EventEmitter =
    actualEvents.EventEmitter;

  type SocketScenario = (socket: InstanceType<typeof MockSocket>) => void;

  const scenarios: Array<SocketScenario> = [];
  const sockets: Array<InstanceType<typeof MockSocket>> = [];

  class MockSocket extends EventEmitterConstructor {
    public readonly connectCalls: Array<{ port: number; host: string }> = [];
    public destroyCallCount: number = 0;

    public constructor() {
      super();
      sockets.push(this);
    }

    public connect(port: number, host: string): this {
      this.connectCalls.push({ port, host });

      const scenario: SocketScenario | undefined = scenarios.shift();
      if (!scenario) {
        throw new Error("No mock socket scenario was queued");
      }

      scenario(this);
      return this;
    }

    public destroy(): this {
      this.destroyCallCount++;
      return this;
    }
  }

  return {
    __esModule: true,
    default: {
      ...actualNet,
      Socket: MockSocket,
      queueSocketScenario: (scenario: SocketScenario): void => {
        scenarios.push(scenario);
      },
      getMockSockets: (): Array<InstanceType<typeof MockSocket>> => {
        return sockets;
      },
      resetMockSockets: (): void => {
        scenarios.length = 0;
        sockets.length = 0;
      },
    },
  };
});

import Hostname from "Common/Types/API/Hostname";
import IPv4 from "Common/Types/IP/IPv4";
import IPv6 from "Common/Types/IP/IPv6";
import Port from "Common/Types/Port";
import PositiveNumber from "Common/Types/PositiveNumber";
import { RequestFailedPhase } from "Common/Types/Probe/RequestFailedDetails";
import Sleep from "Common/Types/Sleep";
import net from "net";
import Register from "../../../../Services/Register";
import PortMonitor, {
  PortMonitorResponse,
} from "../../../../Utils/Monitors/MonitorTypes/PortMonitor";
import { EventEmitter } from "events";

interface MockSocket extends EventEmitter {
  connectCalls: Array<{ port: number; host: string }>;
  destroyCallCount: number;
}

interface ControllableNet {
  queueSocketScenario: (scenario: (socket: MockSocket) => void) => void;
  getMockSockets: () => Array<MockSocket>;
  resetMockSockets: () => void;
}

interface ErrorWithCode extends Error {
  code: string;
}

const controllableNet: ControllableNet = net as unknown as ControllableNet;
const ipLiterals: Array<[IPv4 | IPv6, string]> = [
  [new IPv4("192.0.2.25"), "192.0.2.25"],
  [new IPv6("2001:db8::25"), "2001:db8::25"],
];

const flushPromises: () => Promise<void> = async (): Promise<void> => {
  for (let index: number = 0; index < 8; index++) {
    await Promise.resolve();
  }
};

const advanceTime: (milliseconds: number) => Promise<void> = async (
  milliseconds: number,
): Promise<void> => {
  jest.advanceTimersByTime(milliseconds);
  await flushPromises();
};

const nodeError: (code: string, message: string) => ErrorWithCode = (
  code: string,
  message: string,
): ErrorWithCode => {
  return Object.assign(new Error(message), { code });
};

describe("PortMonitor phase timings", () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["performance"] });
    controllableNet.resetMockSockets();
    jest.spyOn(Register, "isPingMonitoringEnabled").mockResolvedValue(true);
    jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test("measures hostname DNS through the first connection attempt and TCP through connect", async () => {
    controllableNet.queueSocketScenario((socket: MockSocket): void => {
      setTimeout(() => {
        socket.emit("lookup", null, "2001:db8::1", 6, "example.com");
      }, 30);
      setTimeout(() => {
        socket.emit("lookup", null, "192.0.2.10", 4, "example.com");
      }, 40);
      setTimeout(() => {
        socket.emit("connectionAttempt", "2001:db8::1", 443, 6);
      }, 50);
      setTimeout(() => {
        socket.emit("connect");
      }, 90);
    });

    const resultPromise: Promise<PortMonitorResponse | null> = PortMonitor.ping(
      new Hostname("example.com"),
      new Port(443),
      {
        retry: 1,
        timeout: new PositiveNumber(500),
        isOnlineCheckRequest: true,
      },
    );

    await advanceTime(90);
    const result: PortMonitorResponse | null = await resultPromise;

    expect(result).toMatchObject({
      isOnline: true,
      failureCause: "",
      totalAttempts: 1,
      portTimings: {
        dnsLookupInMs: 50,
        tcpConnectInMs: 40,
        totalConnectionInMs: 90,
      },
    });
    expect(result?.responseTimeInMS?.toNumber()).toBe(90);
    expect(result?.probeAttempts?.[0]?.responseTimeInMs).toBe(90);
    expect(controllableNet.getMockSockets()[0]?.connectCalls).toEqual([
      { port: 443, host: "example.com" },
    ]);
  });

  test.each(ipLiterals)(
    "omits DNS for the IP literal %s",
    async (destination: IPv4 | IPv6, hostAddress: string) => {
      controllableNet.queueSocketScenario((socket: MockSocket): void => {
        setTimeout(() => {
          socket.emit("connectionAttempt", hostAddress, 8080, 4);
        }, 5);
        setTimeout(() => {
          socket.emit("connect");
        }, 25);
      });

      const resultPromise: Promise<PortMonitorResponse | null> =
        PortMonitor.ping(destination, new Port(8080), {
          retry: 1,
          timeout: new PositiveNumber(100),
          isOnlineCheckRequest: true,
        });

      await advanceTime(25);
      const result: PortMonitorResponse | null = await resultPromise;

      expect(result?.responseTimeInMS?.toNumber()).toBe(25);
      expect(result?.portTimings).toEqual({
        tcpConnectInMs: 20,
        totalConnectionInMs: 25,
      });
      expect(result?.portTimings).not.toHaveProperty("dnsLookupInMs");
    },
  );

  test("includes IPv6-to-IPv4 fallback in TCP connection time", async () => {
    controllableNet.queueSocketScenario((socket: MockSocket): void => {
      setTimeout(() => {
        socket.emit("connectionAttempt", "2001:db8::10", 443, 6);
      }, 20);
      setTimeout(() => {
        socket.emit(
          "connectionAttemptFailed",
          "2001:db8::10",
          443,
          6,
          nodeError("ENETUNREACH", "connect ENETUNREACH 2001:db8::10"),
        );
      }, 45);
      setTimeout(() => {
        socket.emit("connectionAttempt", "192.0.2.10", 443, 4);
      }, 55);
      setTimeout(() => {
        socket.emit("connect");
      }, 85);
    });

    const resultPromise: Promise<PortMonitorResponse | null> = PortMonitor.ping(
      new Hostname("dual-stack.example"),
      new Port(443),
      {
        retry: 1,
        timeout: new PositiveNumber(200),
        isOnlineCheckRequest: true,
      },
    );

    await advanceTime(85);
    const result: PortMonitorResponse | null = await resultPromise;

    expect(result?.portTimings).toEqual({
      dnsLookupInMs: 20,
      tcpConnectInMs: 65,
      totalConnectionInMs: 85,
    });
  });

  test("uses hostname lookup as the TCP start when a single address skips connectionAttempt", async () => {
    controllableNet.queueSocketScenario((socket: MockSocket): void => {
      setTimeout(() => {
        socket.emit("lookup", null, "192.0.2.20", 4, "single-address.example");
      }, 15);
      setTimeout(() => {
        socket.emit("connect");
      }, 35);
    });

    const resultPromise: Promise<PortMonitorResponse | null> = PortMonitor.ping(
      new Hostname("single-address.example"),
      new Port(80),
      {
        retry: 1,
        timeout: new PositiveNumber(100),
        isOnlineCheckRequest: true,
      },
    );

    await advanceTime(35);
    const result: PortMonitorResponse | null = await resultPromise;

    expect(result?.portTimings).toEqual({
      dnsLookupInMs: 15,
      tcpConnectInMs: 20,
      totalConnectionInMs: 35,
    });
  });

  test("falls back defensively when connect has neither lookup nor connectionAttempt", async () => {
    controllableNet.queueSocketScenario((socket: MockSocket): void => {
      setTimeout(() => {
        socket.emit("connect");
      }, 35);
    });

    const resultPromise: Promise<PortMonitorResponse | null> = PortMonitor.ping(
      new Hostname("eventless-runtime.example"),
      new Port(80),
      {
        retry: 1,
        timeout: new PositiveNumber(100),
        isOnlineCheckRequest: true,
      },
    );

    await advanceTime(35);
    const result: PortMonitorResponse | null = await resultPromise;

    expect(result?.portTimings).toEqual({
      tcpConnectInMs: 35,
      totalConnectionInMs: 35,
    });
  });

  test("uses one absolute deadline that includes hostname resolution", async () => {
    controllableNet.queueSocketScenario((socket: MockSocket): void => {
      setTimeout(() => {
        socket.emit("lookup", null, "192.0.2.30", 4, "slow-dns.example");
      }, 80);
      setTimeout(() => {
        socket.emit("connectionAttempt", "192.0.2.30", 443, 4);
      }, 120);
      setTimeout(() => {
        socket.emit("connect");
      }, 140);
    });

    const resultPromise: Promise<PortMonitorResponse | null> = PortMonitor.ping(
      new Hostname("slow-dns.example"),
      new Port(443),
      {
        retry: 1,
        timeout: new PositiveNumber(100),
        isOnlineCheckRequest: true,
      },
    );

    await advanceTime(100);
    const result: PortMonitorResponse | null = await resultPromise;

    expect(result).toMatchObject({
      isOnline: false,
      isTimeout: true,
      totalAttempts: 1,
      requestFailedDetails: {
        failedPhase: RequestFailedPhase.RequestTimeout,
      },
    });
    expect(result?.responseTimeInMS).toBeUndefined();
    expect(result?.portTimings).toBeUndefined();
    expect(result?.probeAttempts?.[0]?.responseTimeInMs).toBe(100);
  });

  test("marks a native socket ETIMEDOUT error as a timeout", async () => {
    controllableNet.queueSocketScenario((socket: MockSocket): void => {
      setTimeout(() => {
        socket.emit(
          "error",
          nodeError("ETIMEDOUT", "connect ETIMEDOUT 192.0.2.35:443"),
        );
      }, 30);
    });

    const resultPromise: Promise<PortMonitorResponse | null> = PortMonitor.ping(
      new Hostname("socket-timeout.example"),
      new Port(443),
      {
        retry: 1,
        timeout: new PositiveNumber(100),
        isOnlineCheckRequest: true,
      },
    );

    await advanceTime(30);
    const result: PortMonitorResponse | null = await resultPromise;

    expect(result).toMatchObject({
      isOnline: false,
      isTimeout: true,
      requestFailedDetails: {
        failedPhase: RequestFailedPhase.RequestTimeout,
        errorCode: "ETIMEDOUT",
      },
    });
  });

  test("marks a representative AggregateError ETIMEDOUT child as a timeout", async () => {
    const aggregateError: Error & { errors: Array<ErrorWithCode> } =
      Object.assign(new Error("All connection attempts failed"), {
        name: "AggregateError",
        errors: [
          nodeError("ETIMEDOUT", "connect ETIMEDOUT 192.0.2.36:443"),
          nodeError("ENETUNREACH", "connect ENETUNREACH 2001:db8::36:443"),
        ],
      });

    controllableNet.queueSocketScenario((socket: MockSocket): void => {
      setTimeout(() => {
        socket.emit("error", aggregateError);
      }, 30);
    });

    const resultPromise: Promise<PortMonitorResponse | null> = PortMonitor.ping(
      new Hostname("aggregate-timeout.example"),
      new Port(443),
      {
        retry: 1,
        timeout: new PositiveNumber(100),
        isOnlineCheckRequest: true,
      },
    );

    await advanceTime(30);
    const result: PortMonitorResponse | null = await resultPromise;

    expect(result).toMatchObject({
      isOnline: false,
      isTimeout: true,
      requestFailedDetails: {
        failedPhase: RequestFailedPhase.RequestTimeout,
        errorCode: "ETIMEDOUT",
      },
    });
  });

  test("settles once and ignores a late connect after the deadline", async () => {
    controllableNet.queueSocketScenario((socket: MockSocket): void => {
      setTimeout(() => {
        socket.emit("connectionAttempt", "192.0.2.40", 80, 4);
      }, 20);
      setTimeout(() => {
        socket.emit("connect");
      }, 150);
    });

    const resultPromise: Promise<PortMonitorResponse | null> = PortMonitor.ping(
      new Hostname("late.example"),
      new Port(80),
      {
        retry: 1,
        timeout: new PositiveNumber(100),
        isOnlineCheckRequest: true,
      },
    );

    await advanceTime(100);
    const result: PortMonitorResponse | null = await resultPromise;
    const socket: MockSocket | undefined = controllableNet.getMockSockets()[0];

    expect(result?.isOnline).toBe(false);
    expect(result?.isTimeout).toBe(true);
    expect(socket?.destroyCallCount).toBe(1);
    expect(socket?.listenerCount("lookup")).toBe(0);
    expect(socket?.listenerCount("connect")).toBe(0);
    expect(socket?.listenerCount("connectionAttempt")).toBe(0);
    expect(socket?.listenerCount("error")).toBe(0);

    await advanceTime(50);

    expect(result?.isOnline).toBe(false);
    expect(result?.portTimings).toBeUndefined();
    expect(socket?.destroyCallCount).toBe(1);
  });

  test("classifies a DNS resolution failure", async () => {
    controllableNet.queueSocketScenario((socket: MockSocket): void => {
      setTimeout(() => {
        socket.emit(
          "lookup",
          nodeError(
            "ENOTFOUND",
            "getaddrinfo ENOTFOUND does-not-exist.example",
          ),
          undefined,
          undefined,
          "does-not-exist.example",
        );
      }, 20);
      setTimeout(() => {
        socket.emit(
          "error",
          nodeError(
            "ENOTFOUND",
            "getaddrinfo ENOTFOUND does-not-exist.example",
          ),
        );
      }, 30);
    });

    const resultPromise: Promise<PortMonitorResponse | null> = PortMonitor.ping(
      new Hostname("does-not-exist.example"),
      new Port(443),
      {
        retry: 1,
        timeout: new PositiveNumber(100),
        isOnlineCheckRequest: true,
      },
    );

    await advanceTime(30);
    const result: PortMonitorResponse | null = await resultPromise;

    expect(result).toMatchObject({
      isOnline: false,
      isTimeout: false,
      requestFailedDetails: {
        failedPhase: RequestFailedPhase.DNSResolution,
        errorCode: "ENOTFOUND",
      },
    });
    expect(result?.failureCause).toContain("ENOTFOUND");
  });

  test("reports structural AggregateError attempts without string matching", async () => {
    const aggregateError: Error & { errors: Array<ErrorWithCode> } =
      Object.assign(new Error("All connection attempts failed"), {
        name: "AggregateError",
        errors: [
          nodeError("ECONNREFUSED", "connect ECONNREFUSED 192.0.2.50:443"),
          nodeError("ENETUNREACH", "connect ENETUNREACH 2001:db8::50:443"),
        ],
      });

    controllableNet.queueSocketScenario((socket: MockSocket): void => {
      setTimeout(() => {
        socket.emit("error", aggregateError);
      }, 40);
    });

    const resultPromise: Promise<PortMonitorResponse | null> = PortMonitor.ping(
      new Hostname("unreachable.example"),
      new Port(443),
      {
        retry: 1,
        timeout: new PositiveNumber(100),
        isOnlineCheckRequest: true,
      },
    );

    await advanceTime(40);
    const result: PortMonitorResponse | null = await resultPromise;

    expect(result).toMatchObject({
      isOnline: false,
      isTimeout: false,
      requestFailedDetails: {
        failedPhase: RequestFailedPhase.TCPConnection,
        errorCode: "ECONNREFUSED",
      },
    });
    expect(result?.failureCause).toContain(
      "AggregateError (all connection attempts failed)",
    );
    expect(result?.failureCause).toContain("ECONNREFUSED");
    expect(result?.failureCause).toContain("ENETUNREACH");
  });

  test("cleans up an absolute deadline when connect throws synchronously", async () => {
    controllableNet.queueSocketScenario((): void => {
      throw nodeError("EINVAL", "connect EINVAL");
    });

    const result: PortMonitorResponse | null = await PortMonitor.ping(
      new Hostname("invalid.example"),
      new Port(443),
      {
        retry: 1,
        timeout: new PositiveNumber(100),
        isOnlineCheckRequest: true,
      },
    );
    const socket: MockSocket | undefined = controllableNet.getMockSockets()[0];

    expect(result?.isOnline).toBe(false);
    expect(result?.isTimeout).toBe(false);
    expect(socket?.destroyCallCount).toBe(1);
  });

  test("records failed attempts and returns timings from the successful retry", async () => {
    controllableNet.queueSocketScenario((socket: MockSocket): void => {
      setTimeout(() => {
        socket.emit(
          "error",
          nodeError("ECONNREFUSED", "connect ECONNREFUSED 192.0.2.60:80"),
        );
      }, 15);
    });
    controllableNet.queueSocketScenario((socket: MockSocket): void => {
      setTimeout(() => {
        socket.emit("connectionAttempt", "192.0.2.61", 80, 4);
      }, 10);
      setTimeout(() => {
        socket.emit("connect");
      }, 30);
    });

    const resultPromise: Promise<PortMonitorResponse | null> = PortMonitor.ping(
      new Hostname("retry.example"),
      new Port(80),
      {
        retry: 2,
        timeout: new PositiveNumber(100),
        isOnlineCheckRequest: true,
      },
    );

    await advanceTime(15);
    await advanceTime(30);
    const result: PortMonitorResponse | null = await resultPromise;

    expect(Sleep.sleep).toHaveBeenCalledTimes(1);
    expect(result?.totalAttempts).toBe(2);
    expect(result?.probeAttempts).toMatchObject([
      {
        attemptNumber: 1,
        responseTimeInMs: 15,
        isOnline: false,
        failureCause: expect.stringContaining("ECONNREFUSED"),
      },
      {
        attemptNumber: 2,
        responseTimeInMs: 30,
        isOnline: true,
      },
    ]);
    expect(result?.responseTimeInMS?.toNumber()).toBe(30);
    expect(result?.portTimings).toEqual({
      dnsLookupInMs: 10,
      tcpConnectInMs: 20,
      totalConnectionInMs: 30,
    });
  });

  test("preserves the narrow port-25 online-on-timeout policy", async () => {
    jest.spyOn(Register, "isPingMonitoringEnabled").mockResolvedValue(false);
    controllableNet.queueSocketScenario((): void => {});

    const resultPromise: Promise<PortMonitorResponse | null> = PortMonitor.ping(
      new Hostname("smtp.example"),
      new Port(25),
      {
        retry: 1,
        timeout: new PositiveNumber(50),
        isOnlineCheckRequest: true,
      },
    );

    await flushPromises();
    await advanceTime(50);
    const result: PortMonitorResponse | null = await resultPromise;

    expect(Register.isPingMonitoringEnabled).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      isOnline: true,
      failureCause: "",
      totalAttempts: 1,
    });
    expect(result?.isTimeout).toBeUndefined();
    expect(result?.responseTimeInMS?.toNumber()).toBe(50);
    expect(result?.portTimings).toBeUndefined();
  });

  test("treats port 25 as an ordinary offline timeout when the policy is disabled", async () => {
    controllableNet.queueSocketScenario((): void => {});

    const resultPromise: Promise<PortMonitorResponse | null> = PortMonitor.ping(
      new Hostname("smtp.example"),
      new Port(25),
      {
        retry: 1,
        timeout: new PositiveNumber(50),
        isOnlineCheckRequest: true,
      },
    );

    await flushPromises();
    await advanceTime(50);
    const result: PortMonitorResponse | null = await resultPromise;

    expect(result).toMatchObject({
      isOnline: false,
      isTimeout: true,
      totalAttempts: 1,
    });
  });

  test("honors a port embedded in a hostname without pre-resolving it", async () => {
    controllableNet.queueSocketScenario((socket: MockSocket): void => {
      setTimeout(() => {
        socket.emit("connectionAttempt", "192.0.2.70", 8443, 4);
      }, 10);
      setTimeout(() => {
        socket.emit("connect");
      }, 20);
    });

    const resultPromise: Promise<PortMonitorResponse | null> = PortMonitor.ping(
      new Hostname("override.example", new Port(8443)),
      new Port(443),
      {
        retry: 1,
        timeout: new PositiveNumber(100),
        isOnlineCheckRequest: true,
      },
    );

    await advanceTime(20);
    await resultPromise;

    expect(controllableNet.getMockSockets()[0]?.connectCalls).toEqual([
      { port: 8443, host: "override.example" },
    ]);
  });
});
