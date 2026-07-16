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
import { afterEach, describe, expect, it, jest } from "@jest/globals";

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
