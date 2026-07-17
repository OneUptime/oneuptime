// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import SubnetScanner from "../../../Utils/Discovery/SubnetScanner";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpV3Auth from "Common/Types/Monitor/SnmpMonitor/SnmpV3Auth";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

describe("SubnetScanner.countHosts", () => {
  it("counts a /24 as 254 usable hosts (excludes network + broadcast)", () => {
    expect(SubnetScanner.countHosts("192.168.1.0/24")).toBe(254);
  });

  it("counts a /30 as 2 usable hosts", () => {
    expect(SubnetScanner.countHosts("10.0.0.0/30")).toBe(2);
  });

  it("counts /31 and /32 as every address (no network/broadcast exclusion)", () => {
    expect(SubnetScanner.countHosts("10.0.0.0/31")).toBe(2);
    expect(SubnetScanner.countHosts("10.0.0.5/32")).toBe(1);
  });

  it("counts a /8 as ~16.7M without allocating them", () => {
    /*
     * The whole point: this must be derivable from the prefix, not by
     * building the address array.
     */
    expect(SubnetScanner.countHosts("10.0.0.0/8")).toBe(Math.pow(2, 24) - 2);
  });

  it("returns 0 for malformed or out-of-range CIDRs", () => {
    expect(SubnetScanner.countHosts("not-a-cidr")).toBe(0);
    expect(SubnetScanner.countHosts("10.0.0.0")).toBe(0);
    expect(SubnetScanner.countHosts("10.0.0.0/33")).toBe(0);
    expect(SubnetScanner.countHosts("999.0.0.0/24")).toBe(0);
  });

  it("agrees with expandCidr for reasonable subnets", () => {
    for (const cidr of ["192.168.1.0/29", "172.16.5.0/28", "10.1.1.0/30"]) {
      expect(SubnetScanner.countHosts(cidr)).toBe(
        SubnetScanner.expandCidr(cidr).length,
      );
    }
  });
});

describe("SubnetScanner.scan oversized-subnet guard", () => {
  it("rejects an oversized subnet before expanding it (no OOM)", async () => {
    // A /8 would materialize ~16.7M strings if the guard ran after expansion.
    await expect(SubnetScanner.scan({ cidr: "10.0.0.0/8" })).rejects.toThrow(
      /exceeding the/,
    );
  });

  it("rejects a malformed CIDR", async () => {
    await expect(SubnetScanner.scan({ cidr: "not-a-cidr" })).rejects.toThrow(
      /Invalid or empty CIDR/,
    );
  });
});

/*
 * What the scanner hands the SNMP layer for each host.
 *
 * The version is the trap here. The discovery form stores the dropdown KEY
 * ("V1"/"V2c"/"V3") while SnmpMonitor branches on the enum VALUE ("1"/"2c"/"3"),
 * so casting the stored string instead of parsing it leaves "V3" !== SnmpVersion.V3.
 * The v3 branch is then skipped and the host is silently probed as v2c with
 * community "public" — the wrong protocol on the wire, and no error to notice.
 * These tests assert on the config actually handed to probeSystemInfo, because
 * that is the only place the downgrade is visible.
 */
describe("SubnetScanner SNMP config handed to the SNMP layer", () => {
  const V3_AUTH: SnmpV3Auth = {
    securityLevel: SnmpSecurityLevel.AuthNoPriv,
    username: "monitoring",
    authProtocol: SnmpAuthProtocol.SHA,
    authKey: "auth-passphrase",
  };

  // A /31 is the smallest sweep that still probes hosts: 2 addresses.
  const TINY_CIDR: string = "10.0.0.0/31";

  function captureProbedConfigs(): Array<MonitorStepSnmpMonitor> {
    const captured: Array<MonitorStepSnmpMonitor> = [];

    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
        captured.push(config);
        return null;
      });

    return captured;
  }

  beforeEach(() => {
    /*
     * The ICMP pre-sweep now gates every SNMP probe. Mark every host as
     * ping-alive so these tests keep exercising the SNMP config handoff
     * (and never shell out to the real ping binary).
     */
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("normalizes the stored V3 dropdown key to the SnmpVersion enum value", async () => {
    const captured: Array<MonitorStepSnmpMonitor> = captureProbedConfigs();

    await SubnetScanner.scan({
      cidr: TINY_CIDR,
      snmpVersion: "V3",
      snmpV3Auth: V3_AUTH,
    });

    expect(captured.length).toBeGreaterThan(0);
    // Not the literal "V3" — that would silently downgrade to v2c.
    expect(captured[0]!.snmpVersion).toBe(SnmpVersion.V3);
  });

  it("normalizes the stored V1 dropdown key rather than downgrading it to v2c", async () => {
    const captured: Array<MonitorStepSnmpMonitor> = captureProbedConfigs();

    await SubnetScanner.scan({ cidr: TINY_CIDR, snmpVersion: "V1" });

    expect(captured[0]!.snmpVersion).toBe(SnmpVersion.V1);
  });

  it("tolerates the raw enum spelling a non-dropdown writer may have stored", async () => {
    const captured: Array<MonitorStepSnmpMonitor> = captureProbedConfigs();

    await SubnetScanner.scan({
      cidr: TINY_CIDR,
      snmpVersion: "3",
      snmpV3Auth: V3_AUTH,
    });

    expect(captured[0]!.snmpVersion).toBe(SnmpVersion.V3);
  });

  it("defaults to v2c when no version is configured", async () => {
    const captured: Array<MonitorStepSnmpMonitor> = captureProbedConfigs();

    await SubnetScanner.scan({ cidr: TINY_CIDR });

    expect(captured[0]!.snmpVersion).toBe(SnmpVersion.V2c);
  });

  it("carries the v3 credentials through to every host probed", async () => {
    const captured: Array<MonitorStepSnmpMonitor> = captureProbedConfigs();

    await SubnetScanner.scan({
      cidr: TINY_CIDR,
      snmpVersion: "V3",
      snmpV3Auth: V3_AUTH,
    });

    for (const config of captured) {
      expect(config.snmpV3Auth).toEqual(V3_AUTH);
    }
  });

  it("leaves snmpV3Auth undefined for a v2c scan", async () => {
    const captured: Array<MonitorStepSnmpMonitor> = captureProbedConfigs();

    await SubnetScanner.scan({
      cidr: TINY_CIDR,
      snmpVersion: "V2c",
      snmpCommunityString: "private",
    });

    expect(captured[0]!.snmpV3Auth).toBeUndefined();
    expect(captured[0]!.communityString).toBe("private");
  });
});

/*
 * The ICMP pre-sweep exists to skip SNMP's 2-second timeout on dead hosts,
 * but it must never turn into a discovery filter when pinging itself is
 * broken: a rejection from the ping layer (privileges, missing binary) has
 * to fall back to SNMP-probing every host, exactly as before the pre-sweep.
 */
describe("SubnetScanner ICMP pre-sweep", () => {
  // A /31 sweeps exactly two hosts: 10.0.0.0 and 10.0.0.1.
  const TINY_CIDR: string = "10.0.0.0/31";

  function mockSnmpAnsweringEverywhere(): Array<string> {
    const probed: Array<string> = [];

    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
        probed.push(config.hostname || "");
        return { sysName: "device-" + config.hostname };
      });

    return probed;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("skips SNMP for hosts that do not answer ping and reports the ping count", async () => {
    const probed: Array<string> = mockSnmpAnsweringEverywhere();

    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async (host: string) => {
        return host === "10.0.0.1";
      });

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan({ cidr: TINY_CIDR });

    // Only the ping-alive host reaches the SNMP layer.
    expect(probed).toEqual(["10.0.0.1"]);
    // The skipped host still counts as scanned — the sweep covered it.
    expect(result.scannedHostCount).toBe(2);
    expect(result.respondedToPingCount).toBe(1);
    expect(
      result.discoveredHosts.map((discovered: { ipAddress: string }) => {
        return discovered.ipAddress;
      }),
    ).toEqual(["10.0.0.1"]);
  });

  it("SNMP-probes every host when pinging itself is broken (best-effort fallback)", async () => {
    const probed: Array<string> = mockSnmpAnsweringEverywhere();

    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockRejectedValue(new Error("ICMP sockets require elevated privileges"));

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan({ cidr: TINY_CIDR });

    // No host was dropped: the pre-sweep failure degraded to a plain SNMP sweep.
    expect([...probed].sort()).toEqual(["10.0.0.0", "10.0.0.1"]);
    expect(result.scannedHostCount).toBe(2);
    // A count from a sweep that never ran would be a lie.
    expect(result.respondedToPingCount).toBeUndefined();
  });

  it("does not report a partial ping count when the pre-sweep dies mid-scan", async () => {
    const probed: Array<string> = mockSnmpAnsweringEverywhere();

    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async (host: string) => {
        if (host === "10.0.0.0") {
          return true;
        }
        throw new Error("ping binary vanished mid-scan");
      });

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan({ cidr: TINY_CIDR });

    // The host whose ping errored falls through to SNMP, not into a skip.
    expect(probed).toContain("10.0.0.1");
    expect(probed).toContain("10.0.0.0");
    // Some hosts were ping-gated and some were not: the count covers an
    // unknown subset, so it must not be reported at all.
    expect(result.respondedToPingCount).toBeUndefined();
  });
});
