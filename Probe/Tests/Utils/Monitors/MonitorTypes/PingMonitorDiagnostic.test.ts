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
import {
  NETWORK_DEVICE_DIAGNOSTIC_PING_PACKET_COUNT,
  NETWORK_DEVICE_DIAGNOSTIC_PING_TIMEOUT_IN_MS,
  NetworkDeviceDiagnosticPingResult,
} from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import ping from "ping";
import OnlineCheck from "../../../../Utils/OnlineCheck";
import PingMonitor from "../../../../Utils/Monitors/MonitorTypes/PingMonitor";

/*
 * runDiagnosticPing is the one-shot ping behind the "Ping" button on the
 * topology map (Probe/Jobs/NetworkDevice/FetchDiagnostics.ts). It is
 * neither PingMonitor.ping — up to five attempts with sleeps, an OnlineCheck
 * detour that can return null, a timeout reported as "up" — nor
 * checkReachability, the cheap two-packet fleet check that keeps only the
 * average RTT. These tests pin what a diagnostic needs instead: ONE probe
 * call, the full packet statistics, the shared defaults in the config
 * handed to the `ping` library, and the never-null / never-throws
 * guarantees the job relies on to answer every claimed diagnostic.
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
    output: "5 packets transmitted, 5 packets received, 0.0% packet loss",
    time: 1.2,
    times: [1.2, 1.4, 1.1, 1.9, 1.4],
    min: "1.100",
    max: "1.900",
    avg: "1.400",
    stddev: "0.300",
    packetLoss: "0.000",
    ...overrides,
  };
}

function makeDeadResult(
  overrides?: Partial<ping.PingResponse>,
): ping.PingResponse {
  return makePingResult({
    alive: false,
    output: "5 packets transmitted, 0 packets received, 100.0% packet loss",
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

function soleProbeConfig(): ping.PingConfig {
  expect(probeSpy).toHaveBeenCalledTimes(1);
  return probeSpy.mock.calls[0]![1] as ping.PingConfig;
}

describe("runDiagnosticPing — a host that answers", () => {
  test("is online with the full packet statistics and no failure cause", async () => {
    const result: NetworkDeviceDiagnosticPingResult =
      await PingMonitor.runDiagnosticPing({ host: new IPv4("10.0.0.5") });

    expect(result).toEqual({
      isOnline: true,
      failureCause: "",
      pingResponse: {
        packetsSent: 5,
        packetsReceived: 5,
        packetLossPercent: 0,
        minRoundTripTimeInMs: 1.1,
        maxRoundTripTimeInMs: 1.9,
        avgRoundTripTimeInMs: 1.4,
        jitterInMs: 0.3,
      },
    });
  });

  test("pings the address once with the shared five-packet default", async () => {
    await PingMonitor.runDiagnosticPing({ host: new IPv4("10.0.0.5") });

    expect(probeSpy.mock.calls[0]![0]).toBe("10.0.0.5");
    expect(soleProbeConfig().min_reply).toBe(
      NETWORK_DEVICE_DIAGNOSTIC_PING_PACKET_COUNT,
    );
    expect(NETWORK_DEVICE_DIAGNOSTIC_PING_PACKET_COUNT).toBe(5);
  });

  test("lost packets keep the host online, with the loss and the stats from the replies that came back", async () => {
    probeSpy.mockResolvedValue(
      makePingResult({
        times: [2, 4],
        min: "unknown",
        max: "unknown",
        avg: "unknown",
        stddev: "unknown",
        packetLoss: "unknown",
      }),
    );

    const result: NetworkDeviceDiagnosticPingResult =
      await PingMonitor.runDiagnosticPing({ host: new IPv4("10.0.0.5") });

    expect(result.isOnline).toBe(true);
    expect(result.failureCause).toBe("");
    // Recomputed from `times` with the DIAGNOSTIC packet count: 3 of 5 lost.
    expect(result.pingResponse).toEqual({
      packetsSent: 5,
      packetsReceived: 2,
      packetLossPercent: 60,
      minRoundTripTimeInMs: 2,
      maxRoundTripTimeInMs: 4,
      avgRoundTripTimeInMs: 3,
      jitterInMs: 1,
    });
  });
});

describe("runDiagnosticPing — a host that does not answer", () => {
  /*
   * A dead device is a COMPLETED diagnostic: the statistics (100% loss)
   * come back with the verdict so the dashboard can show them.
   */
  test("is offline with 100% loss and a cause naming the host and the packet count", async () => {
    probeSpy.mockResolvedValue(makeDeadResult());

    const result: NetworkDeviceDiagnosticPingResult =
      await PingMonitor.runDiagnosticPing({ host: new IPv4("10.0.0.5") });

    expect(result.isOnline).toBe(false);
    expect(result.failureCause).toBe(
      "No ICMP echo reply from 10.0.0.5 (5 sent)",
    );
    expect(result.pingResponse).toEqual({
      packetsSent: 5,
      packetsReceived: 0,
      packetLossPercent: 100,
      minRoundTripTimeInMs: undefined,
      maxRoundTripTimeInMs: undefined,
      avgRoundTripTimeInMs: undefined,
      jitterInMs: undefined,
    });
  });

  /*
   * THE difference from checkReachability and ping(): no retry. Somebody
   * is watching; a second full probe would double the time a dead device
   * takes to be called dead, for an answer the first probe already gave.
   */
  test("probes exactly once — no retry", async () => {
    probeSpy.mockResolvedValue(makeDeadResult());

    await PingMonitor.runDiagnosticPing({ host: new IPv4("10.0.0.5") });

    expect(probeSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * THE difference from PingMonitor.ping: that path asks OnlineCheck
   * whether the probe itself is online and returns null if not, which is
   * "no verdict" for a monitor but a spinner that never stops for a
   * diagnostic.
   */
  test("never consults OnlineCheck and never returns null", async () => {
    probeSpy.mockResolvedValue(makeDeadResult());

    const result: NetworkDeviceDiagnosticPingResult | null =
      await PingMonitor.runDiagnosticPing({ host: new IPv4("10.0.0.5") });

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

    const result: NetworkDeviceDiagnosticPingResult =
      await PingMonitor.runDiagnosticPing({ host: new IPv4("10.0.0.5") });

    expect(result.isOnline).toBe(false);
    expect(result.failureCause).toContain("ICMP ping is not usable");
    expect(result.failureCause).toContain("Operation not permitted");
  });
});

describe("runDiagnosticPing — never throws", () => {
  test("a rejecting ping library is offline with the error as the cause and no statistics, after one attempt", async () => {
    probeSpy.mockRejectedValue(
      new Error(
        "ping.probe: there was an error while executing the ping program.",
      ),
    );

    await expect(
      PingMonitor.runDiagnosticPing({ host: new IPv4("10.0.0.5") }),
    ).resolves.toEqual({
      isOnline: false,
      failureCause:
        "ping.probe: there was an error while executing the ping program.",
      pingResponse: undefined,
    });

    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(onlineCheckSpy).not.toHaveBeenCalled();
  });

  test("a Hostname with no host is offline without ever pinging", async () => {
    const result: NetworkDeviceDiagnosticPingResult =
      await PingMonitor.runDiagnosticPing({ host: new Hostname("") });

    expect(result.isOnline).toBe(false);
    expect(result.failureCause).toContain("no hostname");
    expect(result.pingResponse).toBeUndefined();
    expect(probeSpy).not.toHaveBeenCalled();
  });
});

describe("runDiagnosticPing — the config handed to the ping library", () => {
  test("packetCount and timeout land in min_reply, timeout (seconds) and deadline", async () => {
    await PingMonitor.runDiagnosticPing({
      host: new IPv4("10.0.0.5"),
      packetCount: 3,
      timeoutMs: 2000,
    });

    const config: ping.PingConfig = soleProbeConfig();
    expect(config.min_reply).toBe(3);
    expect(config.timeout).toBe(2);
    // Whole-process bound: reply wait plus one second per packet.
    expect(config.deadline).toBe(5);
    expect(config.v6).toBe(false);
  });

  test("no overrides: the shared defaults — five packets, a 5 s wait, a 10 s deadline", async () => {
    await PingMonitor.runDiagnosticPing({ host: new IPv4("10.0.0.5") });

    const config: ping.PingConfig = soleProbeConfig();
    expect(NETWORK_DEVICE_DIAGNOSTIC_PING_TIMEOUT_IN_MS).toBe(5000);
    expect(config.min_reply).toBe(5);
    expect(config.timeout).toBe(5);
    expect(config.deadline).toBe(10);
  });

  test("the config is exactly what getReachabilityPingConfig builds for this platform", async () => {
    await PingMonitor.runDiagnosticPing({
      host: new IPv4("10.0.0.5"),
      packetCount: 4,
      timeoutMs: 3000,
    });

    expect(soleProbeConfig()).toEqual(
      PingMonitor.getReachabilityPingConfig({
        isIPv6Target: false,
        packetCount: 4,
        timeoutInSeconds: 3,
        platform: process.platform,
      }),
    );
  });

  test("timeoutMs is mapped to whole seconds, rounded up", async () => {
    await PingMonitor.runDiagnosticPing({
      host: new IPv4("10.0.0.5"),
      timeoutMs: 4500,
    });

    // The library's timeout is in seconds; 4500ms must not truncate to 4.
    expect(soleProbeConfig().timeout).toBe(5);
  });

  test("a sub-second timeout never rounds down to 0 (which the library would read as 'default')", async () => {
    await PingMonitor.runDiagnosticPing({
      host: new IPv4("10.0.0.5"),
      timeoutMs: 200,
    });

    expect(soleProbeConfig().timeout).toBe(1);
  });

  test("a packet count below one is raised to one", async () => {
    await PingMonitor.runDiagnosticPing({
      host: new IPv4("10.0.0.5"),
      packetCount: 0,
    });

    expect(soleProbeConfig().min_reply).toBe(1);
  });

  /*
   * The job's numbers arrive as JSON from the server; a malformed one must
   * fall back to the default, never reach the shell as "NaN".
   */
  test("a non-numeric packet count falls back to the default", async () => {
    await PingMonitor.runDiagnosticPing({
      host: new IPv4("10.0.0.5"),
      packetCount: Number("five"),
    });

    expect(soleProbeConfig().min_reply).toBe(
      NETWORK_DEVICE_DIAGNOSTIC_PING_PACKET_COUNT,
    );
  });

  test("an IPv6 literal sets v6 so the IPv6 ping binary is used", async () => {
    await PingMonitor.runDiagnosticPing({ host: new IPv6("2001:db8::1") });

    expect(probeSpy.mock.calls[0]![0]).toBe("2001:db8::1");
    expect(soleProbeConfig().v6).toBe(true);
  });

  test("a DNS hostname pings by name with v6 off", async () => {
    await PingMonitor.runDiagnosticPing({
      host: new Hostname("core-sw1.example.com"),
    });

    expect(probeSpy.mock.calls[0]![0]).toBe("core-sw1.example.com");
    expect(soleProbeConfig().v6).toBe(false);
  });

  /*
   * Hostname.isValid accepts an unbracketed IPv6 literal, so a device whose
   * address arrived typed as a Hostname still has to reach the v6 binary.
   */
  test("a Hostname carrying an IPv6 literal sets v6 too", async () => {
    await PingMonitor.runDiagnosticPing({ host: new Hostname("2001:db8::1") });

    expect(soleProbeConfig().v6).toBe(true);
  });
});
