// Set required env vars before importing modules that pull in Config.ts.
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
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpMonitorResponse from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import logger from "Common/Server/Utils/Logger";
import SnmpMonitor from "../../../../Utils/Monitors/MonitorTypes/SnmpMonitor";

/*
 * An SNMP monitor or device poll against an IPv6 device, from a probe with
 * no usable IPv6. net-snmp's send fails on the probe before anything leaves
 * it: "send EADDRNOTAVAIL <addr>:161" with IPv6 switched off (the customer's
 * probe), "send ENETUNREACH" on a Docker bridge without IPv6, both reproduced
 * in node:26-bookworm-slim. That bare text became "Device is unreachable by
 * ping and SNMP: send EADDRNOTAVAIL ...", about a device nobody contacted.
 *
 * The GET is stubbed at executeSnmpQuery, the one seam between the retry
 * loop and net-snmp, so no UDP socket is opened.
 */

const DEVICE_ADDRESS: string = "2001:518:2800:9::2";

type SnmpMonitorPrivate = {
  executeSnmpQuery: (
    config: MonitorStepSnmpMonitor,
    options: unknown,
  ) => Promise<unknown>;
};

function buildConfig(hostname: string): MonitorStepSnmpMonitor {
  return {
    snmpVersion: SnmpVersion.V2c,
    hostname: hostname,
    port: 161,
    communityString: "public",
    oids: [{ oid: "1.3.6.1.2.1.1.1.0" }],
    timeout: 3000,
    retries: 1,
    monitorInterfaces: false,
  } as MonitorStepSnmpMonitor;
}

// The error a dgram send rejects with: Node sets code and address on it.
function sendError(code: string, address: string): Error {
  return Object.assign(new Error(`send ${code} ${address}:161`), {
    code: code,
    errno: code === "EADDRNOTAVAIL" ? -99 : -101,
    syscall: "send",
    address: address,
    port: 161,
  });
}

function failEveryQueryWith(error: Error): jest.Mock {
  return jest
    .spyOn(SnmpMonitor as unknown as SnmpMonitorPrivate, "executeSnmpQuery")
    .mockRejectedValue(error as never) as unknown as jest.Mock;
}

function attemptCauses(
  response: SnmpMonitorResponse | null,
): Array<string | undefined> {
  return (response?.probeAttempts || []).map((attempt: ProbeAttempt) => {
    return attempt.failureCause;
  });
}

describe("SnmpMonitor.query on a probe that cannot send IPv6 traffic", () => {
  beforeEach(() => {
    jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined as never);
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the customer's EADDRNOTAVAIL is the probe's, on every attempt and in the result", async () => {
    const executeSnmpQuery: jest.Mock = failEveryQueryWith(
      sendError("EADDRNOTAVAIL", DEVICE_ADDRESS),
    );

    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      buildConfig(DEVICE_ADDRESS),
      { isOnlineCheckRequest: true },
    );

    const expected: string = `This probe cannot send IPv6 traffic (send EADDRNOTAVAIL ${DEVICE_ADDRESS}:161), so ${DEVICE_ADDRESS} was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether ${DEVICE_ADDRESS} is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.`;

    // retries: 1 is still two attempts.
    expect(executeSnmpQuery).toHaveBeenCalledTimes(2);
    expect(response?.isOnline).toBe(false);
    expect(response?.isTimeout).toBe(false);
    expect(response?.totalAttempts).toBe(2);
    expect(response?.failureCause).toBe(expected);
    expect(attemptCauses(response)).toEqual([expected, expected]);
  });

  test("ENETUNREACH, a probe with no IPv6 route, is the probe's too", async () => {
    failEveryQueryWith(sendError("ENETUNREACH", DEVICE_ADDRESS));

    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      buildConfig(DEVICE_ADDRESS),
      { retry: 0, isOnlineCheckRequest: true },
    );

    expect(response?.isOnline).toBe(false);
    expect(response?.failureCause).toContain(
      `This probe cannot send IPv6 traffic (send ENETUNREACH ${DEVICE_ADDRESS}:161), so ${DEVICE_ADDRESS} was never contacted.`,
    );
  });

  test("an IPv4 device makes no IPv6 claim", async () => {
    failEveryQueryWith(sendError("EADDRNOTAVAIL", "10.0.0.1"));

    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      buildConfig("10.0.0.1"),
      { retry: 0, isOnlineCheckRequest: true },
    );

    expect(response?.failureCause).toBe(
      "This probe could not send traffic to 10.0.0.1 (send EADDRNOTAVAIL 10.0.0.1:161), so 10.0.0.1 was never contacted. The failure is on the probe, not on 10.0.0.1.",
    );
    expect(response?.failureCause).not.toContain("IPv6");
  });

  test("a device that does not answer is still a timeout, worded as before", async () => {
    failEveryQueryWith(new Error("Request timed out"));

    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      buildConfig(DEVICE_ADDRESS),
      { retry: 1, isOnlineCheckRequest: true },
    );

    expect(response?.isTimeout).toBe(true);
    expect(response?.failureCause).toBe(
      "Request was tried 2 times and it timed out.",
    );
    expect(attemptCauses(response)).toEqual([
      "Request timed out",
      "Request timed out",
    ]);
  });

  test("any other error keeps its own message", async () => {
    failEveryQueryWith(new Error("No OIDs configured for SNMP monitor"));

    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      buildConfig(DEVICE_ADDRESS),
      { retry: 0, isOnlineCheckRequest: true },
    );

    expect(response?.isTimeout).toBe(false);
    expect(response?.failureCause).toBe("No OIDs configured for SNMP monitor");
  });
});
