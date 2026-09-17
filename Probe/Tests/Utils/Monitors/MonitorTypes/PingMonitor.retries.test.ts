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
import IPv4 from "Common/Types/IP/IPv4";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import ping from "ping";
import OnlineCheck from "../../../../Utils/OnlineCheck";
import PingMonitor, {
  PingResponse,
} from "../../../../Utils/Monitors/MonitorTypes/PingMonitor";

/*
 * PingMonitor.ping's retry option counts retries AFTER the first attempt:
 * 0 probes once, 2 probes up to three times. It used to be read with `||`
 * and compared with `<`, so 0 probed five times and 2 probed twice.
 *
 * The OS ping binary is never forked: ping.promise.probe is spied on, and
 * the one-second sleep between attempts is mocked out.
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
    times: [1.2, 1.4, 1.3, 1.2, 1.4],
    min: "1.200",
    max: "1.400",
    avg: "1.300",
    stddev: "0.100",
    packetLoss: "0.000",
    ...overrides,
  };
}

function makeDeadResult(): ping.PingResponse {
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
  });
}

function attemptNumbers(response: PingResponse | null): Array<number> {
  return (response?.probeAttempts || []).map(
    (attempt: ProbeAttempt): number => {
      return attempt.attemptNumber;
    },
  );
}

// eslint-disable-next-line @typescript-eslint/typedef
let probeSpy = jest.spyOn(ping.promise, "probe");
// eslint-disable-next-line @typescript-eslint/typedef
let sleepSpy = jest.spyOn(Sleep, "sleep");

beforeEach(() => {
  probeSpy = jest
    .spyOn(ping.promise, "probe")
    .mockResolvedValue(makeDeadResult());
  sleepSpy = jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);
  jest
    .spyOn(OnlineCheck, "canProbeMonitorPingMonitors")
    .mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PingMonitor.ping retries on a host that never answers", () => {
  test("retry 0 probes exactly once", async () => {
    const response: PingResponse | null = await PingMonitor.ping(
      new IPv4("10.0.0.5"),
      { retry: 0, isOnlineCheckRequest: true },
    );

    expect(response?.isOnline).toBe(false);
    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(response?.totalAttempts).toBe(1);
    expect(attemptNumbers(response)).toEqual([1]);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  test("retry 2 probes exactly three times", async () => {
    const response: PingResponse | null = await PingMonitor.ping(
      new IPv4("10.0.0.5"),
      { retry: 2, isOnlineCheckRequest: true },
    );

    expect(response?.isOnline).toBe(false);
    expect(probeSpy).toHaveBeenCalledTimes(3);
    expect(response?.totalAttempts).toBe(3);
    expect(attemptNumbers(response)).toEqual([1, 2, 3]);
    expect(sleepSpy).toHaveBeenCalledTimes(2);
  });

  test("no retry option keeps the five-attempt default", async () => {
    const response: PingResponse | null = await PingMonitor.ping(
      new IPv4("10.0.0.5"),
      { isOnlineCheckRequest: true },
    );

    expect(probeSpy).toHaveBeenCalledTimes(5);
    expect(response?.totalAttempts).toBe(5);
  });

  test("retry 0 does not retry a rejected probe either", async () => {
    probeSpy.mockRejectedValue(new Error("spawn ping ENOENT"));

    const response: PingResponse | null = await PingMonitor.ping(
      new IPv4("10.0.0.5"),
      { retry: 0, isOnlineCheckRequest: true },
    );

    expect(response?.isOnline).toBe(false);
    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(response?.totalAttempts).toBe(1);
  });

  test("the timeout cause counts every attempt made", async () => {
    probeSpy.mockRejectedValue(new Error("timeout exceeded"));

    const response: PingResponse | null = await PingMonitor.ping(
      new IPv4("10.0.0.5"),
      { retry: 2, isOnlineCheckRequest: true },
    );

    expect(probeSpy).toHaveBeenCalledTimes(3);
    expect(response?.isTimeout).toBe(true);
    expect(response?.failureCause).toBe(
      "Request was tried 3 times and it timed out.",
    );
  });
});

describe("PingMonitor.ping retries on a slow reply", () => {
  test.each([
    [0, 1],
    [1, 2],
  ])(
    "a reply slower than ten seconds with retry %i is probed %i time(s)",
    async (retry: number, expectedAttempts: number) => {
      probeSpy.mockResolvedValue(
        makePingResult({
          time: 10001,
          times: [10001],
          min: "10001.000",
          max: "10001.000",
          avg: "10001.000",
        }),
      );

      const response: PingResponse | null = await PingMonitor.ping(
        new IPv4("10.0.0.5"),
        { retry, isOnlineCheckRequest: true },
      );

      expect(response?.isOnline).toBe(true);
      expect(probeSpy).toHaveBeenCalledTimes(expectedAttempts);
      expect(response?.totalAttempts).toBe(expectedAttempts);
    },
  );
});

test("recovers after a timed-out ping and keeps the failed attempt", async () => {
  probeSpy
    .mockRejectedValueOnce(new Error("timeout exceeded"))
    .mockResolvedValue(makePingResult());
  const response: PingResponse | null = await PingMonitor.ping(
    new IPv4("10.0.0.5"),
    { retry: 3, isOnlineCheckRequest: true },
  );
  expect(response?.isOnline).toBe(true);
  expect(response?.totalAttempts).toBe(2);
  expect(response?.probeAttempts?.[0]?.failureCause).toContain("timeout");
  expect(response?.probeAttempts?.[1]?.isOnline).toBe(true);
  expect(probeSpy).toHaveBeenCalledTimes(2);
  expect(sleepSpy).toHaveBeenCalledTimes(1);
});
