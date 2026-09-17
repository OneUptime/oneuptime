// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import SubnetScanner, {
  SubnetScanConfig,
  SubnetScanSnmpConfig,
} from "../../../Utils/Discovery/SubnetScanner";
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

import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";

/*
 * A scan carries an ORDERED LIST of credential sets rather than one flattened
 * set, so every sweep below is built through these two helpers.
 *
 * Every guarantee in THIS file is about the sweep itself — which addresses are
 * probed, which hosts are recorded, how errors are counted — and none of them
 * depend on how many credential sets the scan carries. So they all sweep with
 * exactly ONE config, and the helper keeps that config out of the way. The
 * multi-config behaviour (first match wins, adaptive ordering, per-config
 * responder counts) is pinned in SubnetScannerMultiConfig.test.ts.
 *
 * Note the shape of `snmpVersion` here: SubnetScanSnmpConfig carries the
 * PARSED enum value (SnmpVersion.V3, i.e. "3"), never the stored dropdown key
 * ("V3"). Parsing the stored spelling is the caller's job now — see
 * FetchScans.buildProbeSnmpConfigs.
 */
const ONLY_CONFIG_ID: string = "config-1";

function buildSnmpConfig(
  overrides: Partial<SubnetScanSnmpConfig> = {},
): SubnetScanSnmpConfig {
  return {
    id: ONLY_CONFIG_ID,
    label: "SNMP v2c on port 161",
    snmpVersion: SnmpVersion.V2c,
    communityString: "public",
    port: 161,
    ...overrides,
  };
}

function scanConfig(
  cidr: string,
  overrides: Partial<SubnetScanSnmpConfig> = {},
): SubnetScanConfig {
  return {
    cidr: cidr,
    snmpConfigs: [buildSnmpConfig(overrides)],
  };
}

/*
 * Reverse DNS (issue #3529) is the sweep's third network seam, alongside ICMP
 * and SNMP, and is stubbed out for this whole file for the same reason those
 * are: nothing here is about naming, and a unit test must not ask the
 * machine's real resolver about 10.0.0.0/8. Hosts therefore come back with no
 * dnsHostname, exactly as they did before the feature existed.
 */
stubReverseDnsAsResolvingNothing();

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

  it("counts an octet-range target as the product of its octet widths", () => {
    // 1 x 7 x 256 x 16.
    expect(SubnetScanner.countHosts("10.16-22.0-255.51-66")).toBe(28672);
  });

  /*
   * A bare address is the degenerate octet range and now scans exactly that
   * one host. It used to count 0 (rejected), when only CIDR was accepted.
   */
  it("counts a bare address as a single host", () => {
    expect(SubnetScanner.countHosts("10.0.0.5")).toBe(1);
  });

  it("returns 0 for malformed or out-of-range targets", () => {
    expect(SubnetScanner.countHosts("not-a-cidr")).toBe(0);
    expect(SubnetScanner.countHosts("10.0.0.0/33")).toBe(0);
    expect(SubnetScanner.countHosts("999.0.0.0/24")).toBe(0);
    expect(SubnetScanner.countHosts("10.22-16.0.1")).toBe(0);
  });

  it("agrees with expandTarget for reasonable targets", () => {
    for (const target of [
      "192.168.1.0/29",
      "172.16.5.0/28",
      "10.1.1.0/30",
      "10.0.0.1-10",
      "10.1-2.3-4.5-6",
    ]) {
      expect(SubnetScanner.countHosts(target)).toBe(
        SubnetScanner.expandTarget(target).length,
      );
    }
  });
});

describe("SubnetScanner.scan oversized-target guard", () => {
  it("rejects an oversized subnet before expanding it (no OOM)", async () => {
    // A /8 would materialize ~16.7M strings if the guard ran after expansion.
    await expect(SubnetScanner.scan(scanConfig("10.0.0.0/8"))).rejects.toThrow(
      /exceeding the/,
    );
  });

  it("rejects an oversized octet range before expanding it", async () => {
    await expect(
      SubnetScanner.scan(scanConfig("10.0-255.0-255.1-10")),
    ).rejects.toThrow(/exceeding the/);
  });

  it("rejects a malformed target", async () => {
    await expect(SubnetScanner.scan(scanConfig("not-a-cidr"))).rejects.toThrow(
      /not a valid scan target/,
    );
  });

  it("rejects a reversed octet range rather than sweeping nothing", async () => {
    await expect(
      SubnetScanner.scan(scanConfig("10.22-16.0.1-20")),
    ).rejects.toThrow(/reversed/);
  });

  it("rejects an empty target", async () => {
    await expect(SubnetScanner.scan(scanConfig(""))).rejects.toThrow(
      /scan target is required/,
    );
  });
});

/*
 * Octet-range notation reaches the SNMP layer as plain addresses, exactly as
 * a CIDR sweep does — the notation is a front end on the address list and
 * nothing downstream of expansion knows which notation produced it.
 */
describe("SubnetScanner octet-range sweeps", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it("sweeps exactly the addresses the range enumerates", async () => {
    const probed: Array<string> = mockSnmpAnsweringEverywhere();
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig("10.1-2.0.5-6"));

    expect([...probed].sort()).toEqual([
      "10.1.0.5",
      "10.1.0.6",
      "10.2.0.5",
      "10.2.0.6",
    ]);
    expect(result.scannedHostCount).toBe(4);
  });

  /*
   * A range is an explicit enumeration: .0 and .255 are swept when named,
   * where the equivalent /24 would drop them as network and broadcast.
   */
  it("sweeps .0 and .255 when the range names them, unlike the equivalent CIDR", async () => {
    const probed: Array<string> = mockSnmpAnsweringEverywhere();
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);

    await SubnetScanner.scan(scanConfig("10.0.0.0-255"));

    expect(probed).toContain("10.0.0.0");
    expect(probed).toContain("10.0.0.255");
    expect(probed.length).toBe(256);
    // The CIDR spelling of the same block drops both.
    expect(SubnetScanner.countHosts("10.0.0.0/24")).toBe(254);
  });

  it("sweeps a single bare address", async () => {
    const probed: Array<string> = mockSnmpAnsweringEverywhere();
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig("10.9.8.7"));

    expect(probed).toEqual(["10.9.8.7"]);
    expect(result.scannedHostCount).toBe(1);
  });

  it("returns discovered hosts in ascending address order", async () => {
    mockSnmpAnsweringEverywhere();
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig("10.1-2.0.8-9"));

    expect(
      result.discoveredHosts.map((discovered: { ipAddress: string }) => {
        return discovered.ipAddress;
      }),
    ).toEqual(["10.1.0.8", "10.1.0.9", "10.2.0.8", "10.2.0.9"]);
  });

  it("applies the ICMP gate to a range sweep the same way it does to a subnet", async () => {
    const probed: Array<string> = mockSnmpAnsweringEverywhere();
    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async (host: string) => {
        return host === "10.1.0.6";
      });

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig("10.1-2.0.5-6"));

    expect(probed).toEqual(["10.1.0.6"]);
    expect(result.scannedHostCount).toBe(4);
    expect(result.respondedToPingCount).toBe(1);
  });

  it("carries SNMP credentials into a range sweep unchanged", async () => {
    const captured: Array<MonitorStepSnmpMonitor> = [];
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
        captured.push(config);
        return null;
      });
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);

    await SubnetScanner.scan(
      scanConfig("10.0.0.1-2", {
        snmpVersion: SnmpVersion.V3,
        snmpV3Auth: {
          securityLevel: SnmpSecurityLevel.AuthNoPriv,
          username: "monitoring",
          authProtocol: SnmpAuthProtocol.SHA,
          authKey: "auth-passphrase",
        },
        port: 1610,
      }),
    );

    expect(captured.length).toBe(2);
    for (const config of captured) {
      expect(config.snmpVersion).toBe(SnmpVersion.V3);
      expect(config.port).toBe(1610);
    }
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
 *
 * That STORED -> ENUM parse no longer happens in the scanner: it moved out to
 * FetchScans.buildProbeSnmpConfigs, which hands this layer a
 * SubnetScanSnmpConfig whose snmpVersion is already the enum, and it is pinned
 * there by Probe/Tests/Jobs/Discovery/FetchScansSnmpConfigs.test.ts.
 *
 * What remains the scanner's job — and what these tests pin — is passing that
 * parsed version STRAIGHT THROUGH to the SNMP layer for every host, without
 * re-deriving, re-defaulting or casting it. Doing any of those here would
 * resurrect exactly the silent v2c downgrade the parse exists to prevent, so
 * these tests still assert on the config actually handed to probeSystemInfo:
 * that is the only place the downgrade would be visible.
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

  it("hands the SNMP layer the V3 version its config carries, not a re-derived one", async () => {
    const captured: Array<MonitorStepSnmpMonitor> = captureProbedConfigs();

    await SubnetScanner.scan(
      scanConfig(TINY_CIDR, {
        snmpVersion: SnmpVersion.V3,
        snmpV3Auth: V3_AUTH,
      }),
    );

    expect(captured.length).toBeGreaterThan(0);
    // Not the literal "V3" — that would silently downgrade to v2c.
    expect(captured[0]!.snmpVersion).toBe(SnmpVersion.V3);
  });

  it("hands the SNMP layer the V1 version its config carries rather than downgrading it to v2c", async () => {
    const captured: Array<MonitorStepSnmpMonitor> = captureProbedConfigs();

    await SubnetScanner.scan(
      scanConfig(TINY_CIDR, { snmpVersion: SnmpVersion.V1 }),
    );

    expect(captured[0]!.snmpVersion).toBe(SnmpVersion.V1);
  });

  it("puts the enum VALUE on the wire, which is the spelling SnmpMonitor branches on", async () => {
    const captured: Array<MonitorStepSnmpMonitor> = captureProbedConfigs();

    await SubnetScanner.scan(
      scanConfig(TINY_CIDR, {
        snmpVersion: SnmpVersion.V3,
        snmpV3Auth: V3_AUTH,
      }),
    );

    /*
     * Spelled out as the raw value because that is the whole point of the
     * seam: the stored key "V3" is NOT equal to SnmpVersion.V3 ("3"), and a
     * scanner that passed the key through would take the v2c branch.
     */
    expect(captured[0]!.snmpVersion).toBe(SnmpVersion.V3);
    expect(String(captured[0]!.snmpVersion)).toBe("3");
  });

  it("hands the SNMP layer v2c when that is the version its config carries", async () => {
    const captured: Array<MonitorStepSnmpMonitor> = captureProbedConfigs();

    /*
     * v2c is what a scan with no configured version ends up with — the
     * defaulting itself is SnmpVersionUtil.parse's, applied in
     * FetchScans.buildProbeSnmpConfigs and pinned in
     * Probe/Tests/Jobs/Discovery/FetchScansSnmpConfigs.test.ts. Here the only
     * guarantee is that the scanner does not second-guess it.
     */
    await SubnetScanner.scan(
      scanConfig(TINY_CIDR, { snmpVersion: SnmpVersion.V2c }),
    );

    expect(captured[0]!.snmpVersion).toBe(SnmpVersion.V2c);
  });

  it("carries the v3 credentials through to every host probed", async () => {
    const captured: Array<MonitorStepSnmpMonitor> = captureProbedConfigs();

    await SubnetScanner.scan(
      scanConfig(TINY_CIDR, {
        snmpVersion: SnmpVersion.V3,
        snmpV3Auth: V3_AUTH,
      }),
    );

    for (const config of captured) {
      expect(config.snmpV3Auth).toEqual(V3_AUTH);
    }
  });

  it("leaves snmpV3Auth undefined for a v2c scan", async () => {
    const captured: Array<MonitorStepSnmpMonitor> = captureProbedConfigs();

    await SubnetScanner.scan(
      scanConfig(TINY_CIDR, {
        snmpVersion: SnmpVersion.V2c,
        communityString: "private",
      }),
    );

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
      await SubnetScanner.scan(scanConfig(TINY_CIDR));

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
      await SubnetScanner.scan(scanConfig(TINY_CIDR));

    // No host was dropped: the pre-sweep failure degraded to a plain SNMP sweep.
    expect([...probed].sort()).toEqual(["10.0.0.0", "10.0.0.1"]);
    expect(result.scannedHostCount).toBe(2);
    // A count from a sweep that never ran would be a lie.
    expect(result.respondedToPingCount).toBeUndefined();
  });

  it("flags SNMP responders with snmpReachable: true and the id of the config that answered", async () => {
    mockSnmpAnsweringEverywhere();
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig(TINY_CIDR));

    /*
     * snmpConfigId is what lets the import path build the device with the
     * credentials that actually worked for it, so it is asserted as part of
     * the whole host object rather than left to a looser check.
     */
    expect(result.discoveredHosts).toEqual([
      {
        ipAddress: "10.0.0.0",
        sysName: "device-10.0.0.0",
        snmpReachable: true,
        snmpConfigId: ONLY_CONFIG_ID,
      },
      {
        ipAddress: "10.0.0.1",
        sysName: "device-10.0.0.1",
        snmpReachable: true,
        snmpConfigId: ONLY_CONFIG_ID,
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
      await SubnetScanner.scan(scanConfig(TINY_CIDR));

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

  it("records a ping-alive, SNMP-silent host with snmpReachable: false and no config id", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);
    jest.spyOn(SnmpMonitor, "probeSystemInfo").mockResolvedValue(null);

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig(TINY_CIDR));

    /*
     * No snmpConfigId: no config found this host, and stamping one would tell
     * the import path to build the device with credentials that were never
     * shown to work for it.
     */
    expect(result.discoveredHosts).toEqual([
      { ipAddress: "10.0.0.0", snmpReachable: false },
      { ipAddress: "10.0.0.1", snmpReachable: false },
    ]);
    for (const host of result.discoveredHosts) {
      expect(host.snmpConfigId).toBeUndefined();
    }
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
      await SubnetScanner.scan(scanConfig(TINY_CIDR));

    expect(result.discoveredHosts).toEqual([
      { ipAddress: "10.0.0.0", snmpReachable: false },
      {
        ipAddress: "10.0.0.1",
        sysName: "sw1",
        sysDescr: "Cisco IOS",
        snmpReachable: true,
        snmpConfigId: ONLY_CONFIG_ID,
      },
    ]);
  });

  it("still discards SNMP-silent hosts when the ping sweep never ran (aliveness unknown)", async () => {
    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockRejectedValue(new Error("ICMP sockets require elevated privileges"));
    jest.spyOn(SnmpMonitor, "probeSystemInfo").mockResolvedValue(null);

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig(TINY_CIDR));

    /*
     * Without the pre-sweep there is no ICMP evidence the host exists, so
     * "no SNMP answer" cannot be distinguished from "no host" — recording
     * these would turn every dead address into a phantom endpoint.
     */
    expect(result.discoveredHosts).toEqual([]);
  });

  /*
   * The ICMP-silent hosts are re-probed (see the fallback tests below), but a
   * host that answered neither ICMP nor SNMP is still not a discovery: there
   * is no evidence anything is at that address.
   */
  it("does not record hosts that answered neither ICMP nor SNMP", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(false);
    jest.spyOn(SnmpMonitor, "probeSystemInfo").mockResolvedValue(null);

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig(TINY_CIDR));

    expect(result.discoveredHosts).toEqual([]);
  });
});

/*
 * The regression this suite exists for.
 *
 * Gating SNMP on an ICMP reply is only an optimisation, and it silently
 * deletes an entire subnet's worth of devices when echo is filtered — the
 * normal configuration for a firewalled management VLAN, where UDP/161 is
 * open to the NMS and ICMP is not. The symptom is a scan that reports
 * "Completed, 0 of 254 hosts" on one VLAN while an adjacent VLAN that permits
 * echo scans perfectly, with nothing anywhere to say why.
 */
describe("SubnetScanner ICMP-filtered subnet fallback", () => {
  // A /29 sweeps six hosts: 10.0.0.1 .. 10.0.0.6.
  const SMALL_CIDR: string = "10.0.0.0/29";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("SNMP-probes ICMP-silent hosts when the ICMP-alive ones yield no SNMP responder", async () => {
    const probed: Array<string> = [];

    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(false);
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
        probed.push(config.hostname || "");
        // Only this one device speaks SNMP; ICMP is filtered for all of them.
        if (config.hostname === "10.0.0.4") {
          return { sysName: "core-sw1", sysDescr: "Cisco IOS" };
        }
        return null;
      });

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig(SMALL_CIDR));

    // Every address was SNMP-probed despite answering no ping at all.
    expect([...probed].sort()).toEqual([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
      "10.0.0.4",
      "10.0.0.5",
      "10.0.0.6",
    ]);
    // The device that used to be invisible is now discovered.
    expect(result.discoveredHosts).toEqual([
      {
        ipAddress: "10.0.0.4",
        sysName: "core-sw1",
        sysDescr: "Cisco IOS",
        snmpReachable: true,
        snmpConfigId: ONLY_CONFIG_ID,
      },
    ]);
    expect(result.respondedToPingCount).toBe(0);
    expect(result.icmpFilteredFallbackHostCount).toBe(6);
  });

  it("keeps the fast path when the ICMP-alive hosts do answer SNMP", async () => {
    const probed: Array<string> = [];

    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async (host: string) => {
        return host === "10.0.0.2";
      });
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
        probed.push(config.hostname || "");
        return { sysName: "sw1" };
      });

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig(SMALL_CIDR));

    // One SNMP responder is enough: the other five keep their skipped 2s.
    expect(probed).toEqual(["10.0.0.2"]);
    expect(result.icmpFilteredFallbackHostCount).toBe(0);
  });

  it("does not re-probe hosts the first pass already covered", async () => {
    const probed: Array<string> = [];

    // Pre-sweep broken: the first pass already probes every host.
    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockRejectedValue(new Error("ICMP sockets require elevated privileges"));
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
        probed.push(config.hostname || "");
        return null;
      });

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig(SMALL_CIDR));

    expect(probed).toHaveLength(6);
    expect(new Set(probed).size).toBe(6);
    expect(result.icmpFilteredFallbackHostCount).toBe(0);
  });
});

/*
 * "Returned null" used to cover both "nothing is at this address" (a timeout)
 * and "the agent refused these credentials" (an auth failure). With a single
 * credential set applied to the whole sweep, one wrong v3 key blanks every
 * host — and the scan reported a clean zero with no way to tell that apart
 * from an empty subnet.
 */
describe("SubnetScanner SNMP error reporting", () => {
  const TINY_CIDR: string = "10.0.0.0/31";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockSnmpFailingWith(message: string): void {
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(
        async (
          _config: MonitorStepSnmpMonitor,
          onError?: ((error: unknown) => void) | undefined,
        ) => {
          onError?.(new Error(message));
          return null;
        },
      );
  }

  it("counts and names the SNMP error hosts answered with", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);
    mockSnmpFailingWith("Authentication failure");

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig(TINY_CIDR));

    expect(result.snmpErrorHostCount).toBe(2);
    expect(result.mostCommonSnmpError).toBe("Authentication failure");
  });

  it("ignores timeouts — an empty address is not a diagnosis", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);
    mockSnmpFailingWith("Request timed out");

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig(TINY_CIDR));

    expect(result.snmpErrorHostCount).toBe(0);
    expect(result.mostCommonSnmpError).toBeUndefined();
  });

  it("reports the most frequent error when hosts fail in different ways", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(
        async (
          config: MonitorStepSnmpMonitor,
          onError?: ((error: unknown) => void) | undefined,
        ) => {
          onError?.(
            new Error(
              config.hostname === "10.0.0.1"
                ? "connect ECONNREFUSED"
                : "Unknown user name",
            ),
          );
          return null;
        },
      );

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig("10.0.0.0/29"));

    expect(result.snmpErrorHostCount).toBe(6);
    // Five of six hosts, versus one ECONNREFUSED.
    expect(result.mostCommonSnmpError).toBe("Unknown user name");
  });

  it("a throwing SNMP probe records the ping-alive host as SNMP-unreachable", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockRejectedValue(new Error("unexpected decode failure"));

    const result: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig(TINY_CIDR));

    expect(result.discoveredHosts).toEqual([
      { ipAddress: "10.0.0.0", snmpReachable: false },
      { ipAddress: "10.0.0.1", snmpReachable: false },
    ]);
  });
});

/*
 * The single-config sweep still has to report the port it used and account for
 * the one credential set it carries — the list-shaped result fields degrade to
 * exactly the one-entry answers a single-config scan had before the list
 * existed.
 */
describe("SubnetScanner single-config result shape", () => {
  const TINY_CIDR: string = "10.0.0.0/31";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reports the one port it probed as a one-element list", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);
    jest.spyOn(SnmpMonitor, "probeSystemInfo").mockResolvedValue(null);

    const custom: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig(TINY_CIDR, { port: 1610 }));
    expect(custom.scannedPorts).toEqual([1610]);

    const standard: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig(TINY_CIDR));
    expect(standard.scannedPorts).toEqual([161]);
  });

  it("reports the one config's responder count, zero included", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);
    jest.spyOn(SnmpMonitor, "probeSystemInfo").mockResolvedValue(null);

    const silent: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig(TINY_CIDR));

    /*
     * A zero-valued entry rather than an absent one: "this credential found
     * nobody" is exactly what the operator needs told, and an empty map would
     * leave the summary unable to say it.
     */
    expect(silent.responderCountByConfigId).toEqual({ [ONLY_CONFIG_ID]: 0 });

    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
        return { sysName: "device-" + config.hostname };
      });

    const answered: Awaited<ReturnType<typeof SubnetScanner.scan>> =
      await SubnetScanner.scan(scanConfig(TINY_CIDR));

    expect(answered.responderCountByConfigId).toEqual({ [ONLY_CONFIG_ID]: 2 });
  });
});
