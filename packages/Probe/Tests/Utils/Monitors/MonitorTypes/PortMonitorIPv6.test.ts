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

  const sockets: Array<MockSocket> = [];

  class MockSocket extends actualEvents.EventEmitter {
    public readonly connectCalls: Array<{ port: number; host: string }> = [];

    public constructor() {
      super();
      sockets.push(this);
    }

    public connect(port: number, host: string): this {
      this.connectCalls.push({ port, host });
      setImmediate(() => {
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
      resetMockSockets: (): void => {
        sockets.length = 0;
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
import net from "net";
import PortMonitor from "../../../../Utils/Monitors/MonitorTypes/PortMonitor";
import { EventEmitter } from "events";

interface ControllableNet {
  getMockSockets: () => Array<
    EventEmitter & { connectCalls: Array<{ port: number; host: string }> }
  >;
  resetMockSockets: () => void;
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
