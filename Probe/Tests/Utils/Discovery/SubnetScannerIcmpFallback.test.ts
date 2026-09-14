// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import SubnetScanner, {
  DiscoveredHost,
  SubnetScanConfig,
  SubnetScanResult,
  SubnetScanSnmpConfig,
} from "../../../Utils/Discovery/SubnetScanner";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpV3Auth from "Common/Types/Monitor/SnmpMonitor/SnmpV3Auth";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";

/*
 * github.com/OneUptime/oneuptime/issues/3078 — "SNMP Discovery Scan finds
 * 0 of N hosts for some subnet ranges while identical scans on other ranges
 * succeed".
 *
 * The ICMP pre-sweep was a hard gate: a host that did not answer an echo
 * request was never SNMP-probed at all. That is only an optimisation, and it
 * is wrong in exactly the place it matters most — a firewalled management
 * VLAN routinely drops echo while permitting UDP/161 from the NMS, and
 * Windows hosts block echo by default. On such a segment every address looks
 * dead, every SNMP probe is skipped, and the scan reports a confident
 * "Completed, 0 of 254" that is indistinguishable from empty address space,
 * while an adjacent VLAN that happens to permit echo scans perfectly.
 *
 * The rule these tests pin: the ICMP gate may make a sweep faster, but it may
 * never be the reason a sweep finds nothing.
 */

// A /29 sweeps six hosts: 10.0.0.1 .. 10.0.0.6.
const SIX_HOSTS: string = "10.0.0.0/29";
const ALL_SIX: Array<string> = [
  "10.0.0.1",
  "10.0.0.2",
  "10.0.0.3",
  "10.0.0.4",
  "10.0.0.5",
  "10.0.0.6",
];

/*
 * A scan carries an ORDERED LIST of credential sets, and none of the ICMP
 * behaviour below depends on how long that list is, so every sweep here runs
 * with exactly one — built by this helper so the migration to the list shape
 * costs one line per test rather than a rewritten fixture.
 *
 * SubnetScanSnmpConfig.snmpVersion is the PARSED enum (SnmpVersion.V3, i.e.
 * "3"), not the stored dropdown key ("V3"): parsing the stored spelling is
 * FetchScans.buildProbeSnmpConfigs' job now.
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

type ProbeRecorder = {
  hosts: Array<string>;
  configs: Array<MonitorStepSnmpMonitor>;
};

/*
 * Records every host handed to the SNMP layer, answering for the hosts in
 * `snmpSpeakers` and staying silent for the rest.
 */
function recordProbes(snmpSpeakers: Array<string> = []): ProbeRecorder {
  const recorder: ProbeRecorder = { hosts: [], configs: [] };

  jest
    .spyOn(SnmpMonitor, "probeSystemInfo")
    .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
      recorder.hosts.push(config.hostname || "");
      recorder.configs.push(config);

      if (snmpSpeakers.includes(config.hostname || "")) {
        return { sysName: `device-${config.hostname}` };
      }

      return null;
    });

  return recorder;
}

function mockPingAlive(aliveHosts: Array<string>): void {
  jest
    .spyOn(SubnetScanner, "isHostAliveByPing")
    .mockImplementation(async (host: string) => {
      return aliveHosts.includes(host);
    });
}

function discoveredAddresses(result: SubnetScanResult): Array<string> {
  return result.discoveredHosts.map((host: DiscoveredHost) => {
    return host.ipAddress;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * Reverse DNS (issue #3529) is the sweep's third network seam, alongside ICMP
 * and SNMP, and is stubbed out for this whole file for the same reason those
 * are: nothing here is about naming, and a unit test must not ask the
 * machine's real resolver about 10.0.0.0/8. Hosts therefore come back with no
 * dnsHostname, exactly as they did before the feature existed.
 */
stubReverseDnsAsResolvingNothing();

describe("SubnetScanner — an entirely ICMP-filtered subnet", () => {
  /*
   * The reported scenario, reduced: the devices are there and answer SNMP,
   * but the segment drops echo. This used to return zero hosts.
   */
  it("finds the SNMP devices even though not one address answered ICMP", async () => {
    mockPingAlive([]);
    const recorder: ProbeRecorder = recordProbes(["10.0.0.4", "10.0.0.5"]);

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect([...recorder.hosts].sort()).toEqual(ALL_SIX);
    expect(discoveredAddresses(result)).toEqual(["10.0.0.4", "10.0.0.5"]);
    expect(result.respondedToPingCount).toBe(0);
    expect(result.icmpFilteredFallbackHostCount).toBe(6);
  });

  it("counts the fallback devices as SNMP-reachable, so they are importable", async () => {
    mockPingAlive([]);
    recordProbes(["10.0.0.4"]);

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    /*
     * snmpConfigId travels with the host: the import path builds the device
     * with the credentials that actually answered it, so a host found in the
     * fallback pass has to carry the same stamp as one found in the first.
     */
    expect(result.discoveredHosts).toEqual([
      {
        ipAddress: "10.0.0.4",
        sysName: "device-10.0.0.4",
        sysDescr: undefined,
        snmpReachable: true,
        snmpConfigId: ONLY_CONFIG_ID,
      },
    ]);
  });

  it("still reports the full sweep size, not just the re-probed part", async () => {
    mockPingAlive([]);
    recordProbes([]);

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(result.scannedHostCount).toBe(6);
  });

  /*
   * A subnet that really is empty must still come back empty. The fallback
   * buys correctness on filtered segments; it must not invent hosts on quiet
   * ones.
   */
  it("an address that answered neither ICMP nor SNMP is still not a discovery", async () => {
    mockPingAlive([]);
    recordProbes([]);

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(result.discoveredHosts).toEqual([]);
    expect(result.icmpFilteredFallbackHostCount).toBe(6);
  });
});

describe("SubnetScanner — a partially ICMP-filtered subnet", () => {
  /*
   * The nastier real-world shape: a couple of hosts answer echo but none of
   * them speak SNMP, while the switches that do speak SNMP sit behind the
   * filter. The gated pass finds nothing, so the skipped hosts get their
   * chance.
   */
  it("re-probes the ICMP-silent hosts when the ICMP-alive ones answer no SNMP", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    const recorder: ProbeRecorder = recordProbes(["10.0.0.6"]);

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    // First pass: the two ping-alive hosts. Then the four it skipped.
    expect(recorder.hosts.slice(0, 2).sort()).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect([...recorder.hosts].sort()).toEqual(ALL_SIX);
    expect(result.icmpFilteredFallbackHostCount).toBe(4);
  });

  it("keeps the ping-only hosts alongside whatever the fallback finds", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    recordProbes(["10.0.0.6"]);

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    /*
     * The ping-only hosts carry NO snmpConfigId — no credential set found
     * them — while the SNMP responder carries the id of the one that did.
     */
    expect(result.discoveredHosts).toEqual([
      { ipAddress: "10.0.0.1", snmpReachable: false },
      { ipAddress: "10.0.0.2", snmpReachable: false },
      {
        ipAddress: "10.0.0.6",
        sysName: "device-10.0.0.6",
        sysDescr: undefined,
        snmpReachable: true,
        snmpConfigId: ONLY_CONFIG_ID,
      },
    ]);
  });

  it("reports the ICMP count from the pre-sweep, not from the fallback", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    recordProbes(["10.0.0.6"]);

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    // Two answered echo; the fallback probing four more does not change that.
    expect(result.respondedToPingCount).toBe(2);
  });

  /*
   * Results are sorted by address, and the fallback appends out of order —
   * a host discovered in the second pass can sort before one from the first.
   */
  it("returns hosts in ascending address order across both passes", async () => {
    mockPingAlive(["10.0.0.6"]);
    recordProbes(["10.0.0.2", "10.0.0.4"]);

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(discoveredAddresses(result)).toEqual([
      "10.0.0.2",
      "10.0.0.4",
      "10.0.0.6",
    ]);
  });
});

describe("SubnetScanner — when the fallback must NOT run", () => {
  /*
   * The whole point of the pre-sweep is skipping SNMP's 2s timeout on dead
   * addresses. One SNMP responder proves the gate is working on this segment,
   * so the skipped hosts stay skipped.
   */
  it("stays on the fast path as soon as one host answers SNMP", async () => {
    mockPingAlive(["10.0.0.2"]);
    const recorder: ProbeRecorder = recordProbes(["10.0.0.2"]);

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(recorder.hosts).toEqual(["10.0.0.2"]);
    expect(result.icmpFilteredFallbackHostCount).toBe(0);
  });

  it("does not re-probe when the pre-sweep was unavailable and everything was probed already", async () => {
    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockRejectedValue(new Error("ICMP sockets require elevated privileges"));
    const recorder: ProbeRecorder = recordProbes([]);

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(recorder.hosts).toHaveLength(6);
    expect(new Set(recorder.hosts).size).toBe(6);
    expect(result.icmpFilteredFallbackHostCount).toBe(0);
    // A count from a sweep that never ran would be a lie.
    expect(result.respondedToPingCount).toBeUndefined();
  });

  it("does not re-probe when every host was ping-alive and already probed", async () => {
    mockPingAlive(ALL_SIX);
    const recorder: ProbeRecorder = recordProbes([]);

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(recorder.hosts).toHaveLength(6);
    expect(result.icmpFilteredFallbackHostCount).toBe(0);
  });

  it("never probes the same address twice", async () => {
    mockPingAlive(["10.0.0.3"]);
    const recorder: ProbeRecorder = recordProbes([]);

    await SubnetScanner.scan(scanConfig(SIX_HOSTS));

    expect(recorder.hosts).toHaveLength(6);
    expect(new Set(recorder.hosts).size).toBe(6);
  });
});

describe("SubnetScanner — the fallback pass is a real scan, not a degraded one", () => {
  const V3_AUTH: SnmpV3Auth = {
    securityLevel: SnmpSecurityLevel.AuthPriv,
    username: "WBNOC",
    authProtocol: SnmpAuthProtocol.SHA,
    authKey: "auth-passphrase",
  } as SnmpV3Auth;

  it("carries the scan's credentials, version and port into every re-probe", async () => {
    mockPingAlive([]);
    const recorder: ProbeRecorder = recordProbes([]);

    await SubnetScanner.scan(
      scanConfig(SIX_HOSTS, {
        snmpVersion: SnmpVersion.V3,
        snmpV3Auth: V3_AUTH,
        port: 1610,
      }),
    );

    expect(recorder.configs).toHaveLength(6);
    for (const config of recorder.configs) {
      expect(config.snmpVersion).toBe(SnmpVersion.V3);
      expect(config.snmpV3Auth).toEqual(V3_AUTH);
      expect(config.port).toBe(1610);
      // Discovery never retries: one 2s attempt per address, per pass.
      expect(config.retries).toBe(0);
      expect(config.timeout).toBe(2000);
    }
  });

  it("reports the port it actually probed", async () => {
    mockPingAlive([]);
    recordProbes([]);

    /*
     * The result reports a LIST of ports now, because a scan's configs can
     * disagree about which one to use. A single-config sweep still reports
     * exactly the one port it touched.
     */
    const custom: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS, { port: 1610 }),
    );
    expect(custom.scannedPorts).toEqual([1610]);

    const standard: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );
    expect(standard.scannedPorts).toEqual([161]);
  });

  /*
   * Sweeping a whole subnet at once exhausts sockets, and the fallback can
   * double the number of probes a scan issues — so it has to obey the same
   * wave size as the first pass.
   */
  it("keeps both passes inside the concurrency limit", async () => {
    const inFlight: { now: number; peak: number } = { now: 0, peak: 0 };

    mockPingAlive([]);
    jest.spyOn(SnmpMonitor, "probeSystemInfo").mockImplementation(async () => {
      inFlight.now++;
      inFlight.peak = Math.max(inFlight.peak, inFlight.now);
      await new Promise((resolve: (value: void) => void) => {
        setTimeout(resolve, 1);
      });
      inFlight.now--;
      return null;
    });

    // 126 hosts, well past the 32-worker wave size.
    await SubnetScanner.scan(scanConfig("10.0.0.0/25"));

    expect(inFlight.peak).toBeGreaterThan(1);
    expect(inFlight.peak).toBeLessThanOrEqual(32);
  });

  it("pings every address in the target before probing any of them", async () => {
    const pinged: Array<string> = [];

    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async (host: string) => {
        pinged.push(host);
        return false;
      });
    recordProbes([]);

    await SubnetScanner.scan(scanConfig(SIX_HOSTS));

    expect([...pinged].sort()).toEqual(ALL_SIX);
  });
});

/*
 * "Returned null" covered both "nothing is at this address" and "the agent
 * refused these credentials". A single credential set applied to every host in
 * a sweep means one wrong v3 key blanks all 254 results — and the scan
 * reported a clean zero with nothing to distinguish it from empty space.
 */
describe("SubnetScanner — SNMP errors are evidence, not noise", () => {
  function mockSnmpErroring(messageFor: (host: string) => string | null): void {
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(
        async (
          config: MonitorStepSnmpMonitor,
          onError?: ((error: unknown) => void) | undefined,
        ) => {
          const message: string | null = messageFor(config.hostname || "");
          if (message !== null) {
            onError?.(new Error(message));
          }
          return null;
        },
      );
  }

  it("counts a rejection from every host and names it", async () => {
    mockPingAlive(ALL_SIX);
    mockSnmpErroring(() => {
      return "Authentication failure";
    });

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(result.snmpErrorHostCount).toBe(6);
    expect(result.mostCommonSnmpError).toBe("Authentication failure");
  });

  it("ignores timeouts — most addresses in a sweep are empty", async () => {
    mockPingAlive(ALL_SIX);
    mockSnmpErroring(() => {
      return "Request timed out";
    });

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(result.snmpErrorHostCount).toBe(0);
    expect(result.mostCommonSnmpError).toBeUndefined();
  });

  it("recognises timeout wording in any case or phrasing", async () => {
    mockPingAlive(ALL_SIX);
    mockSnmpErroring((host: string) => {
      return host === "10.0.0.1"
        ? "Request TIMED OUT after 2000ms"
        : "socket Timeout";
    });

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(result.snmpErrorHostCount).toBe(0);
  });

  it("picks the error the most hosts gave", async () => {
    mockPingAlive(ALL_SIX);
    mockSnmpErroring((host: string) => {
      return host === "10.0.0.1" ? "connect ECONNREFUSED" : "Unknown user name";
    });

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(result.snmpErrorHostCount).toBe(6);
    expect(result.mostCommonSnmpError).toBe("Unknown user name");
  });

  it("counts a mix of timeouts and rejections as rejections only", async () => {
    mockPingAlive(ALL_SIX);
    mockSnmpErroring((host: string) => {
      return ["10.0.0.1", "10.0.0.2"].includes(host)
        ? "Authentication failure"
        : "Request timed out";
    });

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(result.snmpErrorHostCount).toBe(2);
    expect(result.mostCommonSnmpError).toBe("Authentication failure");
  });

  /*
   * The message is quoted into a varchar(500) status column, so a device that
   * returns a novel-length error cannot be allowed to blow the write.
   */
  it("keeps only the head of an enormous error message", async () => {
    mockPingAlive(ALL_SIX);
    mockSnmpErroring(() => {
      return `AUTH${"x".repeat(5000)}`;
    });

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(result.mostCommonSnmpError).toHaveLength(120);
    expect(result.mostCommonSnmpError?.startsWith("AUTH")).toBe(true);
  });

  it("ignores an error that carries no message at all", async () => {
    mockPingAlive(ALL_SIX);
    mockSnmpErroring(() => {
      return "   ";
    });

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(result.snmpErrorHostCount).toBe(0);
  });

  it("handles a thrown value that is not an Error", async () => {
    mockPingAlive(ALL_SIX);
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(
        async (
          _config: MonitorStepSnmpMonitor,
          onError?: ((error: unknown) => void) | undefined,
        ) => {
          onError?.("usmStatsUnknownEngineIDs");
          return null;
        },
      );

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(result.snmpErrorHostCount).toBe(6);
    expect(result.mostCommonSnmpError).toBe("usmStatsUnknownEngineIDs");
  });

  it("counts a probe that rejected outright, not only one that reported", async () => {
    mockPingAlive(ALL_SIX);
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockRejectedValue(new Error("unexpected decode failure"));

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(result.snmpErrorHostCount).toBe(6);
    expect(result.mostCommonSnmpError).toBe("unexpected decode failure");
  });

  /*
   * The combination from the bug report: echo filtered AND the credentials
   * refused. Both facts have to survive to the status message, because they
   * are two different fixes.
   */
  it("collects rejections from the fallback pass too", async () => {
    mockPingAlive([]);
    mockSnmpErroring(() => {
      return "Authentication failure";
    });

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(result.icmpFilteredFallbackHostCount).toBe(6);
    expect(result.snmpErrorHostCount).toBe(6);
    expect(result.mostCommonSnmpError).toBe("Authentication failure");
  });

  /*
   * A rejection proves an SNMP agent is there, but not that the ADDRESS is
   * live in a way discovery can import — the host list stays evidence-based
   * (ICMP reply or an SNMP answer), so a rejection alone does not create a
   * phantom device row.
   */
  it("does not turn a rejection into a discovered host on its own", async () => {
    mockPingAlive([]);
    mockSnmpErroring(() => {
      return "Authentication failure";
    });

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(result.discoveredHosts).toEqual([]);
  });

  it("records a ping-alive host that rejected the credentials as SNMP-unreachable", async () => {
    mockPingAlive(["10.0.0.3"]);
    mockSnmpErroring(() => {
      return "Authentication failure";
    });

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(SIX_HOSTS),
    );

    expect(result.discoveredHosts).toEqual([
      { ipAddress: "10.0.0.3", snmpReachable: false },
    ]);
  });
});
