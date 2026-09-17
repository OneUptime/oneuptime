// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import SubnetScanner, {
  DiscoveredHost,
  SubnetScanConfig,
  SubnetScanProgress,
  SubnetScanResult,
  SubnetScanSnmpConfig,
} from "../../../Utils/Discovery/SubnetScanner";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

import {
  installReverseDnsStub,
  stubReverseDnsAsResolvingNothing,
} from "../../TestingUtils/StubReverseDns";

/*
 * github.com/OneUptime/oneuptime/issues/3598 and #3599.
 *
 * A sweep used to be one atomic unit of work: every address in the target was
 * pinged before a single one was SNMP-probed, and NOTHING left the scanner
 * until both passes were finished. Three consequences, all of them reported:
 *
 *   - a 15,360-address scan showed "0 of 15360" for however long it ran, which
 *     is indistinguishable from a scan that is not working at all;
 *   - a sweep abandoned at the probe's deadline reported nothing whatsoever,
 *     having already confirmed hundreds of devices;
 *   - auto-import, which reads a scan's stored results, had nothing to read
 *     until the very end (#3599: 527 discovered switches, unimportable for a
 *     day).
 *
 * The sweep now runs segment by segment and reports what it holds after each.
 * These tests pin that reporting AND — more importantly — that segmenting
 * changed no result: the ICMP gate, the ICMP-filtered fallback, the ordering
 * and every counter behave exactly as they did.
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
  overrides: Partial<SubnetScanConfig> = {},
): SubnetScanConfig {
  return {
    cidr: cidr,
    snmpConfigs: [buildSnmpConfig()],
    ...overrides,
  };
}

/*
 * A target big enough to be swept in more than one segment.
 *
 * 1,024 addresses at the 32-worker floor gives a 512-address segment, so this
 * is exactly two segments — the smallest range that can tell "reports as it
 * goes" apart from "reports once at the end".
 */
const TWO_SEGMENT_TARGET: string = "10.0.0-3.0-255";
const TWO_SEGMENT_HOST_COUNT: number = 1024;
const SEGMENT_SIZE: number = 512;

// One segment. A /24 must keep behaving exactly as it always has.
const ONE_SEGMENT_TARGET: string = "10.9.9.0/24";

function mockPingAlive(aliveHosts: Array<string>): void {
  jest
    .spyOn(SubnetScanner, "isHostAliveByPing")
    .mockImplementation(async (host: string) => {
      return aliveHosts.includes(host);
    });
}

function mockSnmp(snmpSpeakers: Array<string> = []): Array<string> {
  const probed: Array<string> = [];

  jest
    .spyOn(SnmpMonitor, "probeSystemInfo")
    .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
      const host: string = config.hostname || "";
      probed.push(host);

      return snmpSpeakers.includes(host) ? { sysName: `device-${host}` } : null;
    });

  return probed;
}

// Collects every progress report a sweep makes.
function collectProgress(): {
  reports: Array<SubnetScanProgress>;
  onProgress: (progress: SubnetScanProgress) => void;
} {
  const reports: Array<SubnetScanProgress> = [];

  return {
    reports: reports,
    onProgress: (progress: SubnetScanProgress): void => {
      reports.push(progress);
    },
  };
}

function addressesOf(hosts: Array<DiscoveredHost>): Array<string> {
  return hosts.map((host: DiscoveredHost) => {
    return host.ipAddress;
  });
}

stubReverseDnsAsResolvingNothing();

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SubnetScanner progress — a sweep reports as it goes", () => {
  it("reports once per segment, ending at the full target size", async () => {
    mockPingAlive([]);
    mockSnmp([]);

    const collector: ReturnType<typeof collectProgress> = collectProgress();

    await SubnetScanner.scan(
      scanConfig(TWO_SEGMENT_TARGET, { onProgress: collector.onProgress }),
    );

    /*
     * Two segments, plus the ICMP-filtered fallback pass (nothing answered
     * ICMP here, so every address is re-probed) which reports per segment
     * too. The first two reports are the ones that matter for the count.
     */
    expect(collector.reports.length).toBeGreaterThanOrEqual(2);
    expect(collector.reports[0]!.sweptHostCount).toBe(SEGMENT_SIZE);
    expect(collector.reports[1]!.sweptHostCount).toBe(TWO_SEGMENT_HOST_COUNT);

    for (const report of collector.reports) {
      expect(report.totalHostCount).toBe(TWO_SEGMENT_HOST_COUNT);
    }
  });

  it("reports exactly once for a sweep that fits in one segment", async () => {
    mockPingAlive(["10.9.9.7"]);
    mockSnmp(["10.9.9.7"]);

    const collector: ReturnType<typeof collectProgress> = collectProgress();

    await SubnetScanner.scan(
      scanConfig(ONE_SEGMENT_TARGET, { onProgress: collector.onProgress }),
    );

    expect(collector.reports).toHaveLength(1);
    expect(collector.reports[0]!.sweptHostCount).toBe(254);
    expect(collector.reports[0]!.totalHostCount).toBe(254);
  });

  it("never reports a swept count that goes backwards or past the total", async () => {
    mockPingAlive([]);
    mockSnmp([]);

    const collector: ReturnType<typeof collectProgress> = collectProgress();

    await SubnetScanner.scan(
      scanConfig(TWO_SEGMENT_TARGET, { onProgress: collector.onProgress }),
    );

    let previous: number = 0;

    for (const report of collector.reports) {
      expect(report.sweptHostCount).toBeGreaterThanOrEqual(previous);
      expect(report.sweptHostCount).toBeLessThanOrEqual(report.totalHostCount);
      previous = report.sweptHostCount;
    }
  });

  /*
   * The whole point of #3599: the hosts a long sweep has already found have
   * to be knowable BEFORE the sweep ends, not merely at the end.
   */
  it("hands over hosts found in an early segment before the sweep finishes", async () => {
    mockPingAlive(["10.0.0.5"]);
    mockSnmp(["10.0.0.5"]);

    const collector: ReturnType<typeof collectProgress> = collectProgress();

    await SubnetScanner.scan(
      scanConfig(TWO_SEGMENT_TARGET, { onProgress: collector.onProgress }),
    );

    const firstReport: SubnetScanProgress = collector.reports[0]!;

    expect(firstReport.sweptHostCount).toBeLessThan(TWO_SEGMENT_HOST_COUNT);
    expect(addressesOf(firstReport.discoveredHosts)).toEqual(["10.0.0.5"]);
    expect(firstReport.snmpResponderCount).toBe(1);
  });

  it("reports hosts address-ascending, same as the final result", async () => {
    // Found out of address order across both segments.
    mockPingAlive(["10.0.3.9", "10.0.0.4", "10.0.1.2"]);
    mockSnmp(["10.0.3.9", "10.0.0.4", "10.0.1.2"]);

    const collector: ReturnType<typeof collectProgress> = collectProgress();

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(TWO_SEGMENT_TARGET, { onProgress: collector.onProgress }),
    );

    const lastReport: SubnetScanProgress =
      collector.reports[collector.reports.length - 1]!;

    expect(addressesOf(lastReport.discoveredHosts)).toEqual([
      "10.0.0.4",
      "10.0.1.2",
      "10.0.3.9",
    ]);
    expect(addressesOf(result.discoveredHosts)).toEqual(
      addressesOf(lastReport.discoveredHosts),
    );
  });

  /*
   * The reported array is handed to an uploader that may hold it across an
   * await. If it were the sweep's live array, the upload would see it grow —
   * and could mutate what the sweep is still counting.
   */
  it("hands over a copy, not the array the sweep is still appending to", async () => {
    mockPingAlive(["10.0.0.5"]);
    mockSnmp(["10.0.0.5"]);

    const collector: ReturnType<typeof collectProgress> = collectProgress();

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(TWO_SEGMENT_TARGET, { onProgress: collector.onProgress }),
    );

    const firstReport: SubnetScanProgress = collector.reports[0]!;

    // Vandalise the snapshot; the sweep's own result must not notice.
    firstReport.discoveredHosts.push({
      ipAddress: "203.0.113.1",
      snmpReachable: true,
    });
    firstReport.discoveredHosts.length = 0;

    expect(addressesOf(result.discoveredHosts)).toEqual(["10.0.0.5"]);
  });

  it("carries the ICMP tally, and drops it once the pre-sweep breaks", async () => {
    mockPingAlive(["10.9.9.7", "10.9.9.8"]);
    mockSnmp([]);

    const withPing: ReturnType<typeof collectProgress> = collectProgress();

    await SubnetScanner.scan(
      scanConfig(ONE_SEGMENT_TARGET, { onProgress: withPing.onProgress }),
    );

    expect(withPing.reports[0]!.respondedToPingCount).toBe(2);

    /*
     * A mid-test restore takes the reverse-DNS stub with it, so it has to be
     * re-installed by hand — ReverseDnsStubIntegrity.test.ts fails the build
     * if any file forgets.
     */
    jest.restoreAllMocks();
    installReverseDnsStub();

    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockRejectedValue(new Error("ICMP sockets require elevated privileges"));
    mockSnmp([]);

    const withoutPing: ReturnType<typeof collectProgress> = collectProgress();

    await SubnetScanner.scan(
      scanConfig(ONE_SEGMENT_TARGET, { onProgress: withoutPing.onProgress }),
    );

    /*
     * A count over an unknown subset of the range is not a count — the same
     * rule the final result follows.
     */
    for (const report of withoutPing.reports) {
      expect(report.respondedToPingCount).toBeUndefined();
    }
  });

  it("says which kind of sweep it is", async () => {
    mockPingAlive(["10.9.9.7"]);
    mockSnmp(["10.9.9.7"]);

    const snmpSweep: ReturnType<typeof collectProgress> = collectProgress();
    await SubnetScanner.scan(
      scanConfig(ONE_SEGMENT_TARGET, { onProgress: snmpSweep.onProgress }),
    );
    expect(snmpSweep.reports[0]!.isIcmpOnlySweep).toBe(false);

    const icmpSweep: ReturnType<typeof collectProgress> = collectProgress();
    await SubnetScanner.scan({
      cidr: ONE_SEGMENT_TARGET,
      isSnmpEnabled: false,
      snmpConfigs: [],
      onProgress: icmpSweep.onProgress,
    });
    expect(icmpSweep.reports[0]!.isIcmpOnlySweep).toBe(true);
    expect(icmpSweep.reports[0]!.snmpResponderCount).toBe(0);
    expect(addressesOf(icmpSweep.reports[0]!.discoveredHosts)).toEqual([
      "10.9.9.7",
    ]);
  });

  /*
   * The ICMP-filtered fallback re-probes addresses the segment loop already
   * counted, and can be the longest part of the sweep — and the part where an
   * entire filtered subnet's inventory is found. It has to report, but it must
   * not double-count the range.
   */
  it("reports during the ICMP-filtered fallback without re-counting addresses", async () => {
    mockPingAlive([]);
    mockSnmp(["10.0.2.7"]);

    const collector: ReturnType<typeof collectProgress> = collectProgress();

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(TWO_SEGMENT_TARGET, { onProgress: collector.onProgress }),
    );

    expect(result.icmpFilteredFallbackHostCount).toBe(TWO_SEGMENT_HOST_COUNT);

    const lastReport: SubnetScanProgress =
      collector.reports[collector.reports.length - 1]!;

    expect(lastReport.sweptHostCount).toBe(TWO_SEGMENT_HOST_COUNT);
    expect(addressesOf(lastReport.discoveredHosts)).toEqual(["10.0.2.7"]);

    // The fallback found it, so a report AFTER the last segment carried it.
    const segmentReports: Array<SubnetScanProgress> = collector.reports.slice(
      0,
      2,
    );
    for (const report of segmentReports) {
      expect(report.discoveredHosts).toEqual([]);
    }
  });
});

describe("SubnetScanner progress — reporting can never break the sweep", () => {
  it("survives a callback that throws", async () => {
    mockPingAlive(["10.9.9.7"]);
    mockSnmp(["10.9.9.7"]);

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(ONE_SEGMENT_TARGET, {
        onProgress: (): void => {
          throw new Error("the ingest endpoint is on fire");
        },
      }),
    );

    expect(addressesOf(result.discoveredHosts)).toEqual(["10.9.9.7"]);
  });

  it("survives a callback that rejects", async () => {
    mockPingAlive(["10.9.9.7"]);
    mockSnmp(["10.9.9.7"]);

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(ONE_SEGMENT_TARGET, {
        onProgress: async (): Promise<void> => {
          throw new Error("connect ETIMEDOUT");
        },
      }),
    );

    expect(addressesOf(result.discoveredHosts)).toEqual(["10.9.9.7"]);
  });

  it("sweeps normally with no callback at all", async () => {
    mockPingAlive(["10.9.9.7"]);
    mockSnmp(["10.9.9.7"]);

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(ONE_SEGMENT_TARGET),
    );

    expect(addressesOf(result.discoveredHosts)).toEqual(["10.9.9.7"]);
    expect(result.scannedHostCount).toBe(254);
  });
});

/*
 * Segmenting interleaves two passes that used to be strictly sequential over
 * the whole target. The results must not change — these are the properties a
 * careless interleave would break.
 */
describe("SubnetScanner segmenting — same results, sooner", () => {
  it("pings a segment fully before SNMP-probing any of it", async () => {
    const order: Array<string> = [];

    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async (host: string) => {
        order.push(`ping ${host}`);
        return host === "10.0.0.5" || host === "10.0.3.9";
      });
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
        order.push(`snmp ${config.hostname}`);
        return { sysName: "device" };
      });

    await SubnetScanner.scan(scanConfig(TWO_SEGMENT_TARGET));

    const firstSnmp: number = order.indexOf("snmp 10.0.0.5");
    const lastPingOfFirstSegment: number = order.indexOf("ping 10.0.1.255");

    /*
     * 10.0.1.255 is the 512th address, the last of segment one. Every ping in
     * that segment precedes the segment's first SNMP probe.
     */
    expect(firstSnmp).toBeGreaterThan(lastPingOfFirstSegment);
  });

  it("starts the next segment's pings only after the previous segment's SNMP", async () => {
    const order: Array<string> = [];

    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async (host: string) => {
        order.push(`ping ${host}`);
        return host === "10.0.0.5";
      });
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
        order.push(`snmp ${config.hostname}`);
        return { sysName: "device" };
      });

    await SubnetScanner.scan(scanConfig(TWO_SEGMENT_TARGET));

    /*
     * The first segment's SNMP work happens before the second segment starts —
     * which is exactly why a host found early can be reported early.
     */
    expect(order.indexOf("snmp 10.0.0.5")).toBeLessThan(
      order.indexOf("ping 10.0.2.0"),
    );
  });

  it("still probes every address when the ICMP pre-sweep breaks mid-sweep", async () => {
    /*
     * The nastiest interleaving case. The pre-sweep works for segment one
     * (gating out its silent addresses) and then breaks, so segment two is
     * probed wholesale. The addresses segment one gated out must still be
     * probed — before segmenting, "the pre-sweep broke" meant every address in
     * the target was SNMP-probed, and that guarantee has to survive.
     */
    let pingCount: number = 0;

    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async (host: string) => {
        pingCount++;

        if (pingCount > 600) {
          throw new Error("ping: socket: Operation not permitted");
        }

        return host === "10.0.0.5";
      });

    const probed: Array<string> = mockSnmp([]);

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig(TWO_SEGMENT_TARGET),
    );

    expect(new Set(probed).size).toBe(TWO_SEGMENT_HOST_COUNT);
    // Every address probed exactly once, fallback included.
    expect(probed).toHaveLength(TWO_SEGMENT_HOST_COUNT);
    /*
     * The pre-sweep broke, so its count covers an unknown subset — and the
     * re-probe of the gated-out addresses is NOT the ICMP-filtered fallback,
     * which is a statement about a WORKING pre-sweep finding nothing.
     */
    expect(result.respondedToPingCount).toBeUndefined();
    expect(result.icmpFilteredFallbackHostCount).toBe(0);
  });

  it("keeps an ICMP-only sweep's hosts address-ascending across segments", async () => {
    mockPingAlive(["10.0.3.9", "10.0.0.4"]);

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: TWO_SEGMENT_TARGET,
      isSnmpEnabled: false,
      snmpConfigs: [],
    });

    expect(addressesOf(result.discoveredHosts)).toEqual([
      "10.0.0.4",
      "10.0.3.9",
    ]);
    expect(result.scannedHostCount).toBe(TWO_SEGMENT_HOST_COUNT);
    expect(result.isIcmpOnlySweep).toBe(true);
  });

  it("stops an ICMP-only sweep the moment ping stops working, keeping what it found", async () => {
    let pingCount: number = 0;

    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async (host: string) => {
        pingCount++;

        if (pingCount > 600) {
          throw new Error("ping: socket: Operation not permitted");
        }

        return host === "10.0.0.4";
      });

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: TWO_SEGMENT_TARGET,
      isSnmpEnabled: false,
      snmpConfigs: [],
    });

    expect(addressesOf(result.discoveredHosts)).toEqual(["10.0.0.4"]);
    expect(result.isIcmpSweepIncomplete).toBe(true);
    /*
     * Spinning through the remaining segments would send no echo at all — the
     * worker returns immediately once the flag is down — so the sweep stops
     * rather than pretending to cover them.
     */
    expect(pingCount).toBeLessThan(TWO_SEGMENT_HOST_COUNT);
  });
});
