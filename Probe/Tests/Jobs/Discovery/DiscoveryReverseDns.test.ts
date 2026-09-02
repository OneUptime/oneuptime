// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

type CapturedCronJob = {
  jobName: string;
  runFunction: PromiseVoidFunction;
};

const mockCapturedCronJobs: Array<CapturedCronJob> = [];

jest.mock("Common/Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (props: CapturedCronJob): void => {
      mockCapturedCronJobs.push(props);
    },
  };
});

import SubnetScanner, {
  DiscoveredHost,
  SubnetScanConfig,
  SubnetScanResult,
  type SubnetScanSnmpConfig,
} from "../../../Utils/Discovery/SubnetScanner";
import { ReverseDnsResolution } from "../../../Utils/Discovery/ReverseDnsResolver";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import logger from "Common/Server/Utils/Logger";
import { scanWithDeadline } from "../../../Jobs/Discovery/FetchScans";

/*
 * OneUptime issue #3529 — "Network Discovery Scan should perform reverse DNS
 * lookup and display hostnames".
 *
 * The reported symptom was a Review dialog listing 10.18.166.51, .53, .54,
 * .55 on an estate where every one of those addresses has a DNS record. Those
 * rows are hosts with no readable SNMP: with no sysName there was nothing to
 * call them but their address.
 *
 * This file pins the PROBE half of the fix, and it drives `scanWithDeadline`
 * rather than `SubnetScanner.scan` on purpose — because WHERE the pass runs is
 * itself one of the guarantees.
 *
 * The sweep runs inside a deadline race: if it has not settled by
 * PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS, `scanWithDeadline` rejects and the scan
 * is reported Failed with no hosts at all. The reverse-DNS pass originally sat
 * at the end of `scan()`, inside that race, which meant a sweep that had
 * already found every host on a subnet could be thrown away wholesale because
 * looking up their names took the run past the line — an enrichment destroying
 * the result it exists to improve. It now runs after the race has settled, and
 * "after the race" is only observable from here.
 *
 * So this file pins three things:
 *
 *   1. Hosts get named — on both sweep return paths, including the ICMP-only
 *      one the issue was actually reported against, and including the hosts
 *      the ICMP-filtered fallback pass finds.
 *   2. Naming NEVER costs a sweep its results. Not when the resolver is
 *      broken, not when the pass throws, and — the case with teeth — not when
 *      the pass is slower than the sweep's entire remaining deadline.
 *   3. The sweep itself is untouched: same hosts, same order, same tallies.
 */

const SIX_HOSTS: string = "10.0.0.0/29";

function snmpConfig(): SubnetScanSnmpConfig {
  return {
    id: "config-1",
    label: "v2c on 161",
    snmpVersion: SnmpVersion.V2c,
    communityString: "public",
    port: 161,
  };
}

/*
 * Answers the ICMP pre-sweep for `aliveHosts`, reporting every other address
 * as cleanly down, so no test here forks the real ping binary.
 */
function mockPingAlive(aliveHosts: Array<string>): void {
  jest
    .spyOn(SubnetScanner, "isHostAliveByPing")
    .mockImplementation(async (host: string) => {
      return aliveHosts.includes(host);
    });
}

// Every host answers SNMP with the sysName given, or none answer at all.
function mockSnmp(sysNameByHost: Record<string, string>): void {
  jest
    .spyOn(SnmpMonitor, "probeSystemInfo")
    .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
      const sysName: string | undefined = sysNameByHost[config.hostname || ""];

      return sysName ? { sysName: sysName } : null;
    });
}

/*
 * Replaces the reverse-DNS seam with a fixed table, and records which
 * addresses it was asked about — "was it asked at all, and only for the hosts
 * it found" is half of what this file checks.
 */
function mockReverseDns(
  hostnameByIpAddress: Record<string, string>,
  overrides?: Partial<ReverseDnsResolution> & { delayInMs?: number },
): { asked: Array<Array<string>> } {
  const asked: Array<Array<string>> = [];

  jest
    .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
    .mockImplementation(
      async (ipAddresses: Array<string>): Promise<ReverseDnsResolution> => {
        asked.push([...ipAddresses]);

        if (overrides?.delayInMs) {
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, overrides.delayInMs);
          });
        }

        return {
          hostnameByIpAddress: new Map<string, string>(
            Object.entries(hostnameByIpAddress),
          ),
          isReverseDnsAvailable: true,
          isTimeBudgetExhausted: false,
          ...overrides,
        };
      },
    );

  return { asked: asked };
}

function icmpOnly(): SubnetScanConfig {
  return { cidr: SIX_HOSTS, isSnmpEnabled: false };
}

function withSnmp(): SubnetScanConfig {
  return { cidr: SIX_HOSTS, snmpConfigs: [snmpConfig()] };
}

/*
 * A deadline long enough that nothing in this file trips it by accident. The
 * one test that IS about the deadline sets its own.
 */
const GENEROUS_DEADLINE_IN_MS: number = 30000;

function sweep(
  config: SubnetScanConfig,
  deadlineInMs: number = GENEROUS_DEADLINE_IN_MS,
): Promise<SubnetScanResult> {
  return scanWithDeadline(config, "scan-3529", deadlineInMs);
}

function hostAt(
  result: SubnetScanResult,
  ipAddress: string,
): DiscoveredHost | undefined {
  return result.discoveredHosts.find((host: DiscoveredHost) => {
    return host.ipAddress === ipAddress;
  });
}

beforeEach(() => {
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an ICMP-only sweep — the case the issue was reported against", () => {
  /*
   * These hosts have no system group by construction: the sweep never asks
   * them for one. Before this feature the Review dialog had nothing to call
   * them but their address, which is exactly the screenshot on the issue.
   */

  it("names ping-only hosts by their PTR record", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    mockReverseDns({
      "10.0.0.1": "core-gw.corp.example.com",
      "10.0.0.2": "printer-3.corp.example.com",
    });

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(hostAt(result, "10.0.0.1")?.dnsHostname).toBe(
      "core-gw.corp.example.com",
    );
    expect(hostAt(result, "10.0.0.2")?.dnsHostname).toBe(
      "printer-3.corp.example.com",
    );
    // No record: the field is simply absent, and the caller falls back.
    expect(hostAt(result, "10.0.0.3")?.dnsHostname).toBeUndefined();
    expect(result.reverseDnsResolvedCount).toBe(2);
  });

  it("asks only about the hosts it found, not the range it swept", async () => {
    /*
     * The economics of running this with no column to turn it off. A /29
     * sweeps six addresses; if two answer, two lookups are paid for, not six
     * — and on a /16 that difference is the whole feasibility of the feature.
     */
    mockPingAlive(["10.0.0.2", "10.0.0.5"]);
    const reverseDns: { asked: Array<Array<string>> } = mockReverseDns({});

    await sweep(icmpOnly());

    expect(reverseDns.asked).toHaveLength(1);
    expect(reverseDns.asked[0]).toEqual(["10.0.0.2", "10.0.0.5"]);
  });

  it("does not ask at all when the sweep found nothing", async () => {
    mockPingAlive([]);
    const reverseDns: { asked: Array<Array<string>> } = mockReverseDns({});

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(reverseDns.asked).toHaveLength(0);
    expect(result.discoveredHosts).toHaveLength(0);
    expect(result.reverseDnsResolvedCount).toBe(0);
  });

  it("leaves every other field of the ping-only record untouched", async () => {
    /*
     * `snmpReachable: false` is what makes DiscoveryImportEligibility hand
     * these hosts to the Monitor method rather than importing an SNMP-polled
     * device that could never be polled. Adding a name must not disturb it.
     */
    mockPingAlive(["10.0.0.1"]);
    mockReverseDns({ "10.0.0.1": "gw.corp.example.com" });

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(hostAt(result, "10.0.0.1")).toEqual({
      ipAddress: "10.0.0.1",
      snmpReachable: false,
      dnsHostname: "gw.corp.example.com",
    });
  });

  it("preserves the sweep's ascending address order", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.4", "10.0.0.6"]);
    mockReverseDns({ "10.0.0.4": "middle.corp.example.com" });

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(
      result.discoveredHosts.map((host: DiscoveredHost) => {
        return host.ipAddress;
      }),
    ).toEqual(["10.0.0.1", "10.0.0.4", "10.0.0.6"]);
  });

  it("reports the same counts it reported before naming existed", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockReverseDns({ "10.0.0.1": "gw.corp.example.com" });

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.scannedHostCount).toBe(6);
    expect(result.respondedToPingCount).toBe(2);
    expect(result.isIcmpOnlySweep).toBe(true);
    expect(result.scannedPorts).toEqual([]);
    expect(result.snmpErrorHostCount).toBe(0);
  });
});

describe("an SNMP sweep — naming alongside the system group", () => {
  it("names SNMP responders and ping-only hosts in the same pass", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockSnmp({ "10.0.0.1": "core-switch-01" });
    mockReverseDns({
      "10.0.0.1": "sw1.corp.example.com",
      "10.0.0.2": "cam-lobby.corp.example.com",
    });

    const result: SubnetScanResult = await sweep(withSnmp());

    /*
     * The SNMP responder keeps its sysName AND gains a PTR name. Which of the
     * two wins as the device's name is DiscoveredDeviceBuilder's decision,
     * not the probe's — the probe's job is to report both facts.
     */
    expect(hostAt(result, "10.0.0.1")?.sysName).toBe("core-switch-01");
    expect(hostAt(result, "10.0.0.1")?.dnsHostname).toBe(
      "sw1.corp.example.com",
    );
    expect(hostAt(result, "10.0.0.2")?.snmpReachable).toBe(false);
    expect(hostAt(result, "10.0.0.2")?.dnsHostname).toBe(
      "cam-lobby.corp.example.com",
    );
    expect(result.reverseDnsResolvedCount).toBe(2);
  });

  it("asks once, after the sweep, for every discovered address", async () => {
    /*
     * Once, not per pass and not per host: the lookups are a single batch on
     * the finished list, which is what lets the resolver de-duplicate and
     * budget across the whole set.
     */
    mockPingAlive(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    mockSnmp({ "10.0.0.2": "switch-2" });
    const reverseDns: { asked: Array<Array<string>> } = mockReverseDns({});

    await sweep(withSnmp());

    expect(reverseDns.asked).toHaveLength(1);
    expect(reverseDns.asked[0]!.slice().sort()).toEqual([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
    ]);
  });

  it("names hosts found by the ICMP-filtered fallback pass too", async () => {
    /*
     * Phase 3 re-probes ICMP-silent hosts when the gated pass found no SNMP
     * responder. Those hosts are appended after the first pass, so an
     * enrichment that ran before the fallback would leave exactly the hosts
     * on a management VLAN — the hardest ones to identify by address —
     * unnamed.
     */
    mockPingAlive([]);
    mockSnmp({ "10.0.0.4": "hidden-switch" });
    mockReverseDns({ "10.0.0.4": "mgmt-sw.corp.example.com" });

    const result: SubnetScanResult = await sweep(withSnmp());

    expect(result.icmpFilteredFallbackHostCount).toBeGreaterThan(0);
    expect(hostAt(result, "10.0.0.4")?.dnsHostname).toBe(
      "mgmt-sw.corp.example.com",
    );
  });

  it("leaves the sweep's own tallies alone", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockSnmp({ "10.0.0.1": "core-switch-01" });
    mockReverseDns({ "10.0.0.1": "sw1.corp.example.com" });

    const result: SubnetScanResult = await sweep(withSnmp());

    expect(result.scannedHostCount).toBe(6);
    expect(result.respondedToPingCount).toBe(2);
    expect(result.scannedPorts).toEqual([161]);
    expect(result.responderCountByConfigId).toEqual({ "config-1": 1 });
    expect(result.discoveredHosts).toHaveLength(2);
  });
});

describe("naming runs OUTSIDE the sweep's deadline", () => {
  /*
   * The guarantee this file exists at the job layer to state.
   *
   * scanWithDeadline races the sweep against PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS
   * and, on a loss, rejects — runScan then reports the scan Failed with zero
   * hosts. While the reverse-DNS pass lived at the end of scan() it spent that
   * same budget, so a completed sweep could be discarded because naming its
   * hosts was slow. These tests would have failed then and must never pass
   * again if the pass moves back inside.
   */

  it("a lookup pass slower than the whole deadline still returns the sweep's hosts", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    // 250ms of naming against a 120ms deadline: fatal if it were inside.
    mockReverseDns({ "10.0.0.1": "gw.corp.example.com" }, { delayInMs: 250 });

    const result: SubnetScanResult = await sweep(icmpOnly(), 120);

    expect(result.discoveredHosts).toHaveLength(2);
    expect(hostAt(result, "10.0.0.1")?.dnsHostname).toBe("gw.corp.example.com");
  });

  it("does not log the deadline's abandonment message for a sweep that finished", async () => {
    /*
     * The timer is disarmed before the lookups rather than in the finally. An
     * armed timer firing mid-lookup writes "did not settle ... Abandoning this
     * sweep" at ERROR level about a sweep whose result is already on its way
     * back — a fabricated line, and precisely the line an operator would read
     * to explain a failure that never happened.
     */
    mockPingAlive(["10.0.0.1"]);
    mockReverseDns({}, { delayInMs: 250 });

    await sweep(icmpOnly(), 120);

    expect(logger.error).not.toHaveBeenCalled();
  });

  it("still fails a sweep that genuinely misses its deadline", async () => {
    /*
     * The other half: moving the pass out must not have disarmed the deadline
     * for the sweep itself.
     */
    jest
      .spyOn(SubnetScanner, "scan")
      .mockImplementation((): Promise<SubnetScanResult> => {
        return new Promise<SubnetScanResult>(() => {});
      });
    const reverseDns: { asked: Array<Array<string>> } = mockReverseDns({});

    await expect(sweep(icmpOnly(), 80)).rejects.toThrow(
      /did not finish|was abandoned/i,
    );
    // And the pass never ran, because there was no result to enrich.
    expect(reverseDns.asked).toHaveLength(0);
  });
});

describe("naming never costs a sweep its results", () => {
  it("returns the sweep's hosts when the resolver names nobody", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockReverseDns({}, { isReverseDnsAvailable: false });

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.discoveredHosts).toHaveLength(2);
    expect(hostAt(result, "10.0.0.1")?.dnsHostname).toBeUndefined();
    expect(result.reverseDnsResolvedCount).toBe(0);
  });

  it("returns the sweep's hosts when the lookup pass THROWS", async () => {
    /*
     * ReverseDnsResolver swallows its own failures, so this should be
     * unreachable — which is precisely why the scanner catches it anyway. A
     * completed sweep must not be lost to a bug in an enrichment, and
     * "unreachable" is not a guarantee, it is an expectation.
     */
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    jest
      .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
      .mockRejectedValue(new Error("resolver blew up"));

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.discoveredHosts).toHaveLength(2);
    expect(result.reverseDnsResolvedCount).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns the SNMP sweep's hosts when the lookup pass throws", async () => {
    // The same guarantee on the other return path.
    mockPingAlive(["10.0.0.1"]);
    mockSnmp({ "10.0.0.1": "core-switch-01" });
    jest
      .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
      .mockRejectedValue(new Error("resolver blew up"));

    const result: SubnetScanResult = await sweep(withSnmp());

    expect(result.discoveredHosts).toHaveLength(1);
    expect(hostAt(result, "10.0.0.1")?.sysName).toBe("core-switch-01");
  });

  it("ignores a name for an address the sweep never found", async () => {
    /*
     * A resolution keyed by something not in the result cannot invent a host.
     * The map is read per discovered host, never iterated into the list.
     */
    mockPingAlive(["10.0.0.1"]);
    mockReverseDns({
      "10.0.0.1": "gw.corp.example.com",
      "10.0.0.99": "ghost.corp.example.com",
    });

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.discoveredHosts).toHaveLength(1);
    expect(result.reverseDnsResolvedCount).toBe(1);
  });

  it("does not fail a sweep whose reverse DNS ran out of time", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockReverseDns(
      { "10.0.0.1": "gw.corp.example.com" },
      { isTimeBudgetExhausted: true },
    );

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.discoveredHosts).toHaveLength(2);
    expect(hostAt(result, "10.0.0.1")?.dnsHostname).toBe("gw.corp.example.com");
    expect(hostAt(result, "10.0.0.2")?.dnsHostname).toBeUndefined();
  });
});

describe("SubnetScanner.scan itself does no naming", () => {
  /*
   * Stated positively, because it is a REQUIREMENT and not an accident. If
   * somebody puts the pass back inside scan(), these fail — and so does the
   * deadline group above, which is the one that explains why.
   */

  it("returns hosts with no dnsHostname and no resolved count", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    const reverseDns: { asked: Array<Array<string>> } = mockReverseDns({
      "10.0.0.1": "gw.corp.example.com",
    });

    const result: SubnetScanResult = await SubnetScanner.scan(icmpOnly());

    expect(reverseDns.asked).toHaveLength(0);
    expect(hostAt(result, "10.0.0.1")?.dnsHostname).toBeUndefined();
    /*
     * Absent, not zero. Zero would say "the pass ran and named nobody"; this
     * result has simply not been through it.
     */
    expect(result.reverseDnsResolvedCount).toBeUndefined();
  });
});

describe("SubnetScanner.attachReverseDnsHostnames — used directly", () => {
  it("returns zero and asks nothing for an empty host list", async () => {
    const reverseDns: { asked: Array<Array<string>> } = mockReverseDns({});

    await expect(SubnetScanner.attachReverseDnsHostnames([])).resolves.toBe(0);
    expect(reverseDns.asked).toHaveLength(0);
  });

  it("stamps names onto the array it was given", async () => {
    // In place, on the exact array the caller already holds.
    mockReverseDns({ "10.0.0.2": "printer.corp.example.com" });

    const hosts: Array<DiscoveredHost> = [
      { ipAddress: "10.0.0.1", snmpReachable: false },
      { ipAddress: "10.0.0.2", snmpReachable: false },
    ];

    const count: number = await SubnetScanner.attachReverseDnsHostnames(hosts);

    expect(count).toBe(1);
    expect(hosts[0]!.dnsHostname).toBeUndefined();
    expect(hosts[1]!.dnsHostname).toBe("printer.corp.example.com");
  });

  it("keeps the array's identity and length", async () => {
    /*
     * scanWithDeadline mutates the result it is about to return, and an
     * existing deadline test asserts that result is the very object the sweep
     * produced. Replacing the array would break that silently.
     */
    mockReverseDns({ "10.0.0.1": "gw.corp.example.com" });

    const hosts: Array<DiscoveredHost> = [
      { ipAddress: "10.0.0.1", snmpReachable: false },
    ];
    const same: Array<DiscoveredHost> = hosts;

    await SubnetScanner.attachReverseDnsHostnames(hosts);

    expect(hosts).toBe(same);
    expect(hosts).toHaveLength(1);
  });
});
