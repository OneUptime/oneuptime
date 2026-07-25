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

  it("flags SNMP responders with snmpReachable: true", async () => {
    mockSnmpAnsweringEverywhere();
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan({ cidr: TINY_CIDR });

    expect(result.discoveredHosts).toEqual([
      {
        ipAddress: "10.0.0.0",
        sysName: "device-10.0.0.0",
        snmpReachable: true,
      },
      {
        ipAddress: "10.0.0.1",
        sysName: "device-10.0.0.1",
        snmpReachable: true,
      },
    ]);
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
    /*
     * Some hosts were ping-gated and some were not: the count covers an
     * unknown subset, so it must not be reported at all.
     */
    expect(result.respondedToPingCount).toBeUndefined();
  });
});

/*
 * Hosts that answer ICMP but not SNMP used to be silently discarded — an
 * entire class of gear (printers, cameras, POS terminals, hosts with a
 * wrong community string) invisible to discovery. They are now recorded
 * with snmpReachable: false so the server can surface them as unmanaged
 * endpoints.
 */
describe("SubnetScanner ping-only host recording", () => {
  // A /31 sweeps exactly two hosts: 10.0.0.0 and 10.0.0.1.
  const TINY_CIDR: string = "10.0.0.0/31";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("records a ping-alive, SNMP-silent host with snmpReachable: false", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);
    jest.spyOn(SnmpMonitor, "probeSystemInfo").mockResolvedValue(null);

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan({ cidr: TINY_CIDR });

    expect(result.discoveredHosts).toEqual([
      { ipAddress: "10.0.0.0", snmpReachable: false },
      { ipAddress: "10.0.0.1", snmpReachable: false },
    ]);
    // Counts are unchanged by the recording.
    expect(result.scannedHostCount).toBe(2);
    expect(result.respondedToPingCount).toBe(2);
  });

  it("mixes snmpReachable true/false correctly in one sweep", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
        if (config.hostname === "10.0.0.1") {
          return { sysName: "sw1", sysDescr: "Cisco IOS" };
        }
        return null;
      });

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan({ cidr: TINY_CIDR });

    expect(result.discoveredHosts).toEqual([
      { ipAddress: "10.0.0.0", snmpReachable: false },
      {
        ipAddress: "10.0.0.1",
        sysName: "sw1",
        sysDescr: "Cisco IOS",
        snmpReachable: true,
      },
    ]);
  });

  it("still discards SNMP-silent hosts when the ping sweep never ran (aliveness unknown)", async () => {
    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockRejectedValue(new Error("ICMP sockets require elevated privileges"));
    jest.spyOn(SnmpMonitor, "probeSystemInfo").mockResolvedValue(null);

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan({ cidr: TINY_CIDR });

    /*
     * Without the pre-sweep there is no ICMP evidence the host exists, so
     * "no SNMP answer" cannot be distinguished from "no host" — recording
     * these would turn every dead address into a phantom endpoint.
     */
    expect(result.discoveredHosts).toEqual([]);
  });

  it("does not record ping-dead hosts at all", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(false);
    // eslint-disable-next-line @typescript-eslint/typedef
    const probeSpy = jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockResolvedValue(null);

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan({ cidr: TINY_CIDR });

    expect(result.discoveredHosts).toEqual([]);
    expect(probeSpy).not.toHaveBeenCalled();
  });

  it("a throwing SNMP probe records the ping-alive host as SNMP-unreachable", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockRejectedValue(new Error("unexpected decode failure"));

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan({ cidr: TINY_CIDR });

    expect(result.discoveredHosts).toEqual([
      { ipAddress: "10.0.0.0", snmpReachable: false },
      { ipAddress: "10.0.0.1", snmpReachable: false },
    ]);
  });
});
