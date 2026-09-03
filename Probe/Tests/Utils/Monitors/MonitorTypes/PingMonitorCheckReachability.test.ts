// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Hostname from "Common/Types/API/Hostname";
import IPv4 from "Common/Types/IP/IPv4";
import IPv6 from "Common/Types/IP/IPv6";
import ping from "ping";
import OnlineCheck from "../../../../Utils/OnlineCheck";
import PingMonitor, {
  DEVICE_REACHABILITY_PACKET_COUNT,
  DEVICE_REACHABILITY_RETRIES,
  DeviceReachabilityCheck,
} from "../../../../Utils/Monitors/MonitorTypes/PingMonitor";

/*
 * checkReachability is the ping half of the ping-first network-device poll
 * (Probe/Jobs/NetworkDevice/FetchList.ts). It is NOT PingMonitor.ping — the
 * Ping-monitor path returns null when the probe looks offline, sends five
 * packets with up to five retries, and reports a timeout as "up". A device
 * poll needs a verdict for every device, cheaply, and "no reply" means
 * down. These tests pin those differences, the exact config handed to the
 * `ping` library (packet count, per-reply wait, deadline, IPv6), and the
 * never-null / never-throws guarantees the poll job relies on.
 *
 * The OS ping binary is never forked: ping.promise.probe is spied on.
 */

function makePingResult(
  overrides?: Partial<ping.PingResponse>,
): ping.PingResponse {
  return {
    inputHost: "10.0.0.5",
    host: "10.0.0.5",
    numeric_host: "10.0.0.5",
    alive: true,
    output: "2 packets transmitted, 2 packets received, 0.0% packet loss",
    time: 1.2,
    times: [1.2, 1.4],
    min: "1.200",
    max: "1.400",
    avg: "1.300",
    stddev: "0.100",
    packetLoss: "0.000",
    ...overrides,
  };
}

function makeDeadResult(
  overrides?: Partial<ping.PingResponse>,
): ping.PingResponse {
  return makePingResult({
    alive: false,
    output: "2 packets transmitted, 0 packets received, 100.0% packet loss",
    time: "unknown",
    times: [],
    min: "unknown",
    max: "unknown",
    avg: "unknown",
    stddev: "unknown",
    packetLoss: "100.000",
    ...overrides,
  });
}

// eslint-disable-next-line @typescript-eslint/typedef
let probeSpy = jest.spyOn(ping.promise, "probe");
// eslint-disable-next-line @typescript-eslint/typedef
let onlineCheckSpy = jest.spyOn(OnlineCheck, "canProbeMonitorPingMonitors");

beforeEach(() => {
  probeSpy = jest
    .spyOn(ping.promise, "probe")
    .mockResolvedValue(makePingResult());
  onlineCheckSpy = jest
    .spyOn(OnlineCheck, "canProbeMonitorPingMonitors")
    .mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function probeConfig(callIndex: number): ping.PingConfig {
  const call: Array<unknown> | undefined = probeSpy.mock.calls[callIndex];
  if (!call) {
    throw new Error(`ping.promise.probe was not called ${callIndex + 1}x`);
  }
  return call[1] as ping.PingConfig;
}

describe("checkReachability — a host that answers", () => {
  test("is online with the average RTT and packet loss from the ping summary", async () => {
    const result: DeviceReachabilityCheck = await PingMonitor.checkReachability(
      { host: new IPv4("10.0.0.5") },
    );

    expect(result).toEqual({
      isOnline: true,
      avgRttMs: 1.3,
      packetLossPercent: 0,
      failureCause: "",
    });
  });

  test("sends exactly the device packet count, once — no retry on success", async () => {
    await PingMonitor.checkReachability({ host: new IPv4("10.0.0.5") });

    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(probeSpy.mock.calls[0]![0]).toBe("10.0.0.5");
    expect(probeConfig(0).min_reply).toBe(DEVICE_REACHABILITY_PACKET_COUNT);
    expect(DEVICE_REACHABILITY_PACKET_COUNT).toBe(2);
  });

  test("one lost packet of two is still online, with the loss reported", async () => {
    probeSpy.mockResolvedValue(
      makePingResult({
        times: [3.5],
        avg: "3.500",
        packetLoss: "50.000",
      }),
    );

    const result: DeviceReachabilityCheck = await PingMonitor.checkReachability(
      { host: new IPv4("10.0.0.5") },
    );

    expect(result.isOnline).toBe(true);
    expect(result.avgRttMs).toBe(3.5);
    expect(result.packetLossPercent).toBe(50);
  });

  test("recomputes the stats from per-packet times when the summary is unparsed", async () => {
    probeSpy.mockResolvedValue(
      makePingResult({
        times: [2, 4],
        avg: "unknown",
        packetLoss: "unknown",
      }),
    );

    const result: DeviceReachabilityCheck = await PingMonitor.checkReachability(
      { host: new IPv4("10.0.0.5") },
    );

    expect(result.avgRttMs).toBe(3);
    // Loss falls back to (sent - received) / sent with the DEVICE count (2), not ping()'s 5.
    expect(result.packetLossPercent).toBe(0);
  });
});

describe("checkReachability — a host that does not answer", () => {
  test("retries exactly once and is then offline with a cause", async () => {
    probeSpy.mockResolvedValue(makeDeadResult());

    const result: DeviceReachabilityCheck = await PingMonitor.checkReachability(
      { host: new IPv4("10.0.0.5") },
    );

    expect(DEVICE_REACHABILITY_RETRIES).toBe(1);
    expect(probeSpy).toHaveBeenCalledTimes(2);
    expect(result.isOnline).toBe(false);
    expect(result.avgRttMs).toBeNull();
    expect(result.packetLossPercent).toBe(100);
    expect(result.failureCause).toContain("10.0.0.5");
    expect(result.failureCause).not.toBe("");
  });

  test("a reply on the retry makes the host online", async () => {
    probeSpy
      .mockResolvedValueOnce(makeDeadResult())
      .mockResolvedValueOnce(makePingResult());

    const result: DeviceReachabilityCheck = await PingMonitor.checkReachability(
      { host: new IPv4("10.0.0.5") },
    );

    expect(probeSpy).toHaveBeenCalledTimes(2);
    expect(result.isOnline).toBe(true);
    expect(result.failureCause).toBe("");
  });

  /*
   * THE difference from PingMonitor.ping: that path asks OnlineCheck
   * whether the probe itself is online and returns null if not, which is
   * "no verdict" for a monitor but a stuck device for a poll.
   */
  test("never consults OnlineCheck and never returns null", async () => {
    probeSpy.mockResolvedValue(makeDeadResult());

    const result: DeviceReachabilityCheck | null =
      await PingMonitor.checkReachability({ host: new IPv4("10.0.0.5") });

    expect(result).not.toBeNull();
    expect(onlineCheckSpy).not.toHaveBeenCalled();
  });

  test("a broken ping layer (no ICMP privileges) is named as the cause, not 'host down'", async () => {
    probeSpy.mockResolvedValue(
      makeDeadResult({
        output: "ping: socket: Operation not permitted",
        packetLoss: "unknown",
      }),
    );

    const result: DeviceReachabilityCheck = await PingMonitor.checkReachability(
      { host: new IPv4("10.0.0.5") },
    );

    expect(result.isOnline).toBe(false);
    expect(result.failureCause).toContain("ICMP ping is not usable");
    expect(result.failureCause).toContain("Operation not permitted");
  });
});

describe("checkReachability — never throws", () => {
  test("a rejecting ping library becomes an offline verdict with the error as the cause", async () => {
    probeSpy.mockRejectedValue(
      new Error(
        "ping.probe: there was an error while executing the ping program.",
      ),
    );

    await expect(
      PingMonitor.checkReachability({ host: new IPv4("10.0.0.5") }),
    ).resolves.toEqual({
      isOnline: false,
      avgRttMs: null,
      packetLossPercent: null,
      failureCause:
        "ping.probe: there was an error while executing the ping program.",
    });

    // Still retried: a transient spawn failure deserves the same second chance.
    expect(probeSpy).toHaveBeenCalledTimes(2);
    expect(onlineCheckSpy).not.toHaveBeenCalled();
  });

  test("a rejection on the first attempt and a reply on the retry is online", async () => {
    probeSpy
      .mockRejectedValueOnce(new Error("spawn EAGAIN"))
      .mockResolvedValueOnce(makePingResult());

    const result: DeviceReachabilityCheck = await PingMonitor.checkReachability(
      { host: new IPv4("10.0.0.5") },
    );

    expect(result.isOnline).toBe(true);
  });

  test("a Hostname with no host is offline without ever pinging", async () => {
    const result: DeviceReachabilityCheck = await PingMonitor.checkReachability(
      { host: new Hostname("") },
    );

    expect(result.isOnline).toBe(false);
    expect(result.failureCause).toContain("no hostname");
    expect(probeSpy).not.toHaveBeenCalled();
  });
});

describe("checkReachability — the config handed to the ping library", () => {
  test("an IPv6 literal sets v6 so the IPv6 ping binary is used", async () => {
    await PingMonitor.checkReachability({ host: new IPv6("2001:db8::25") });

    expect(probeSpy.mock.calls[0]![0]).toBe("2001:db8::25");
    expect(probeConfig(0).v6).toBe(true);
  });

  test("an IPv4 literal does not", async () => {
    await PingMonitor.checkReachability({ host: new IPv4("192.0.2.25") });

    expect(probeConfig(0).v6).toBe(false);
  });

  test("a DNS hostname pings by name with v6 off", async () => {
    await PingMonitor.checkReachability({
      host: new Hostname("core-sw1.example.net"),
    });

    expect(probeSpy.mock.calls[0]![0]).toBe("core-sw1.example.net");
    expect(probeConfig(0).v6).toBe(false);
  });

  /*
   * Hostname.isValid accepts an unbracketed IPv6 literal, so a device whose
   * address arrived typed as a Hostname still has to reach the v6 binary.
   */
  test("a Hostname carrying an IPv6 literal sets v6 too", async () => {
    await PingMonitor.checkReachability({ host: new Hostname("2001:db8::1") });

    expect(probeConfig(0).v6).toBe(true);
  });

  test("timeoutMs is mapped to whole seconds, rounded up", async () => {
    await PingMonitor.checkReachability({
      host: new IPv4("10.0.0.5"),
      timeoutMs: 4500,
    });

    // The library's timeout is in seconds; 4500ms must not truncate to 4.
    expect(probeConfig(0).timeout).toBe(5);
  });

  test("a sub-second timeout never rounds down to 0 (which the library would read as 'default')", async () => {
    await PingMonitor.checkReachability({
      host: new IPv4("10.0.0.5"),
      timeoutMs: 200,
    });

    expect(probeConfig(0).timeout).toBe(1);
  });

  test("no timeout defaults to 5 seconds", async () => {
    await PingMonitor.checkReachability({ host: new IPv4("10.0.0.5") });

    expect(probeConfig(0).timeout).toBe(5);
  });

  test("packetCount and retries overrides are honoured", async () => {
    probeSpy.mockResolvedValue(makeDeadResult());

    await PingMonitor.checkReachability({
      host: new IPv4("10.0.0.5"),
      packetCount: 3,
      retries: 2,
    });

    expect(probeSpy).toHaveBeenCalledTimes(3);
    expect(probeConfig(0).min_reply).toBe(3);
    expect(probeConfig(2).min_reply).toBe(3);
  });

  test("retries 0 means a single attempt", async () => {
    probeSpy.mockResolvedValue(makeDeadResult());

    await PingMonitor.checkReachability({
      host: new IPv4("10.0.0.5"),
      retries: 0,
    });

    expect(probeSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * The library fills defaults INTO the object it is handed. If the same
   * object were reused, the second attempt would run on the first's
   * mutated copy — so each call must get its own.
   */
  test("each attempt gets its own config object", async () => {
    probeSpy.mockResolvedValue(makeDeadResult());

    await PingMonitor.checkReachability({ host: new IPv4("10.0.0.5") });

    expect(probeSpy).toHaveBeenCalledTimes(2);
    expect(probeConfig(0)).not.toBe(probeConfig(1));
    expect(probeConfig(0)).toEqual(probeConfig(1));
  });
});

/*
 * The platform quirks are pinned through the pure config builder so every
 * platform's shape is asserted wherever the tests run: the `ping` library
 * THROWS on options a platform's binary lacks, and a thrown option would
 * turn into a false Down for every device polled from that platform.
 */
describe("getReachabilityPingConfig — per-platform shape", () => {
  test("linux: packet count, per-reply wait, deadline, v6 flag", () => {
    expect(
      PingMonitor.getReachabilityPingConfig({
        isIPv6Target: false,
        packetCount: 2,
        timeoutInSeconds: 5,
        platform: "linux",
      }),
    ).toEqual({ min_reply: 2, v6: false, timeout: 5, deadline: 7 });
  });

  test("the deadline bounds the whole probe: reply wait plus one second per packet", () => {
    expect(
      PingMonitor.getReachabilityPingConfig({
        isIPv6Target: false,
        packetCount: 3,
        timeoutInSeconds: 2,
        platform: "linux",
      }).deadline,
    ).toBe(5);
  });

  test("linux IPv6 keeps the wait and deadline", () => {
    expect(
      PingMonitor.getReachabilityPingConfig({
        isIPv6Target: true,
        packetCount: 2,
        timeoutInSeconds: 5,
        platform: "linux",
      }),
    ).toEqual({ min_reply: 2, v6: true, timeout: 5, deadline: 7 });
  });

  test("windows: no deadline (the library throws on it)", () => {
    expect(
      PingMonitor.getReachabilityPingConfig({
        isIPv6Target: false,
        packetCount: 2,
        timeoutInSeconds: 5,
        platform: "win32",
      }),
    ).toEqual({ min_reply: 2, v6: false, timeout: 5 });
  });

  test("macOS IPv4 keeps the wait and deadline", () => {
    expect(
      PingMonitor.getReachabilityPingConfig({
        isIPv6Target: false,
        packetCount: 2,
        timeoutInSeconds: 5,
        platform: "darwin",
      }),
    ).toEqual({ min_reply: 2, v6: false, timeout: 5, deadline: 7 });
  });

  test("macOS IPv6: neither wait nor deadline (ping6 has no such flags and the library throws)", () => {
    expect(
      PingMonitor.getReachabilityPingConfig({
        isIPv6Target: true,
        packetCount: 2,
        timeoutInSeconds: 5,
        platform: "darwin",
      }),
    ).toEqual({ min_reply: 2, v6: true });
  });
});
