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
  type ReverseDnsNamingOutcome,
  type ReverseDnsPassOptions,
  SubnetScanConfig,
  SubnetScanResult,
  type SubnetScanSnmpConfig,
} from "../../../Utils/Discovery/SubnetScanner";
import ReverseDnsResolver, {
  DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
  getReverseDnsTotalBudgetInMs,
  ReverseDnsResolution,
} from "../../../Utils/Discovery/ReverseDnsResolver";
import dns from "dns";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import logger from "Common/Server/Utils/Logger";
import { scanWithDeadline } from "../../../Jobs/Discovery/FetchScans";
import { stubNetbiosAsResolvingNothing } from "../../TestingUtils/StubNetbios";

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
 * Any field of a resolution, typed as `unknown` on purpose. The seam is public
 * and spied on, so the scanner has to survive a double that leaves a field out
 * (`undefined`) or fills it with nonsense ("yes", NaN) — and the tests that pin
 * that need to be able to write exactly those doubles.
 */
type ReverseDnsDoubleOverrides = {
  [Key in keyof ReverseDnsResolution]?: unknown;
} & { delayInMs?: number };

/*
 * Replaces the reverse-DNS seam with a fixed table, and records which
 * addresses it was asked about — "was it asked at all, and only for the hosts
 * it found" is half of what this file checks — and with which pass options,
 * because the budget override only matters if it actually reaches the seam.
 */
function mockReverseDns(
  hostnameByIpAddress: Record<string, string>,
  overrides?: ReverseDnsDoubleOverrides,
): {
  asked: Array<Array<string>>;
  options: Array<ReverseDnsPassOptions | undefined>;
} {
  const asked: Array<Array<string>> = [];
  const options: Array<ReverseDnsPassOptions | undefined> = [];

  jest
    .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
    .mockImplementation(
      async (
        ipAddresses: Array<string>,
        passOptions?: ReverseDnsPassOptions | undefined,
      ): Promise<ReverseDnsResolution> => {
        asked.push([...ipAddresses]);
        options.push(passOptions);

        if (overrides?.delayInMs) {
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, overrides.delayInMs);
          });
        }

        const resolution: Record<string, unknown> = {
          hostnameByIpAddress: new Map<string, string>(
            Object.entries(hostnameByIpAddress),
          ),
          isReverseDnsAvailable: true,
          isTimeBudgetExhausted: false,
          lookedUpCount: new Set<string>(ipAddresses).size,
          notLookedUpCount: 0,
          totalBudgetInMs: 60000,
          ...overrides,
        };

        return resolution as unknown as ReverseDnsResolution;
      },
    );

  return { asked: asked, options: options };
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

/*
 * This suite spies on the reverse-DNS seam itself, so it does not use
 * stubReverseDnsAsResolvingNothing — and therefore does not get the NetBIOS
 * stub that helper installs. None of these sweeps opts into NetBIOS, but a
 * suite that drives scanWithDeadline must not rely on that to stay off UDP 137
 * (ReverseDnsStubIntegrity.test.ts enforces it).
 */
stubNetbiosAsResolvingNothing();

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

    await expect(
      SubnetScanner.attachReverseDnsHostnames([]),
    ).resolves.toMatchObject({ resolvedCount: 0 });
    expect(reverseDns.asked).toHaveLength(0);
  });

  it("stamps names onto the array it was given", async () => {
    // In place, on the exact array the caller already holds.
    mockReverseDns({ "10.0.0.2": "printer.corp.example.com" });

    const hosts: Array<DiscoveredHost> = [
      { ipAddress: "10.0.0.1", snmpReachable: false },
      { ipAddress: "10.0.0.2", snmpReachable: false },
    ];

    const count: number = (await SubnetScanner.attachReverseDnsHostnames(hosts))
      .resolvedCount;

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

/*
 * The pass's VERDICT, carried onto the result.
 *
 * The resolver asks addresses in ascending order and stops when its wall-clock
 * budget runs out or it decides the resolver does not work from here. Either
 * way the TAIL of a big sweep keeps IP-address names, and for as long as the
 * scanner handed back a bare count the only trace of that was a warning in
 * the probe log: a Review dialog full of bare addresses from 10.0.4.0 upwards
 * looked exactly like a network that publishes no PTR records.
 *
 * result.reverseDnsOutcome is what the final status message reads to tell
 * those apart, so everything below pins what reaches it — and, just as much,
 * what a double that reports less (or nonsense) must NOT turn into.
 */

function hostsAt(...ipAddresses: Array<string>): Array<DiscoveredHost> {
  return ipAddresses.map((ipAddress: string): DiscoveredHost => {
    return { ipAddress: ipAddress, snmpReachable: false };
  });
}

/*
 * A finished sweep with exactly these hosts, for the cases the real sweep
 * cannot produce on demand — a repeated address, a host that arrives already
 * carrying a name.
 */
function mockSweepReturning(hosts: Array<DiscoveredHost>): void {
  jest.spyOn(SubnetScanner, "scan").mockResolvedValue({
    discoveredHosts: hosts,
    scannedHostCount: 6,
    scannedPorts: [],
    responderCountByConfigId: {},
    snmpErrorHostCount: 0,
    icmpFilteredFallbackHostCount: 0,
    isIcmpOnlySweep: true,
  });
}

// Runs the pass directly over `hosts` against a double built from these parts.
async function outcomeFor(
  hosts: Array<DiscoveredHost>,
  hostnameByIpAddress: Record<string, string>,
  overrides?: ReverseDnsDoubleOverrides,
): Promise<ReverseDnsNamingOutcome> {
  mockReverseDns(hostnameByIpAddress, overrides);

  return await SubnetScanner.attachReverseDnsHostnames(hosts);
}

function warnedLines(): string {
  return (
    logger.warn as unknown as { mock: { calls: Array<Array<unknown>> } }
  ).mock.calls
    .map((call: Array<unknown>) => {
      return String(call[0]);
    })
    .join("\n");
}

describe("result.reverseDnsOutcome — a pass that got through every address", () => {
  it("carries the counts, the flags and the budget the pass ran under", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    mockReverseDns(
      {
        "10.0.0.1": "core-gw.corp.example.com",
        "10.0.0.3": "nas-1.corp.example.com",
      },
      { totalBudgetInMs: 61600 },
    );

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.reverseDnsOutcome).toEqual({
      resolvedCount: 2,
      addressCount: 3,
      namedAddressCount: 2,
      notLookedUpAddressCount: 0,
      isTimeBudgetExhausted: false,
      isReverseDnsAvailable: true,
      totalBudgetInMs: 61600,
    });
    expect(result.reverseDnsOutcome?.error).toBeUndefined();
    /*
     * The legacy count and the verdict's count are one number read twice. If
     * they drifted, the probe log and the status message would disagree about
     * the same pass.
     */
    expect(result.reverseDnsResolvedCount).toBe(
      result.reverseDnsOutcome?.resolvedCount,
    );
  });

  it("carries it on the SNMP return path too", async () => {
    // The sweep has two return paths; the verdict must not exist on only one.
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockSnmp({ "10.0.0.1": "core-switch-01" });
    mockReverseDns(
      { "10.0.0.2": "cam-lobby.corp.example.com" },
      { totalBudgetInMs: 60000 },
    );

    const result: SubnetScanResult = await sweep(withSnmp());

    expect(result.reverseDnsOutcome).toEqual({
      resolvedCount: 1,
      addressCount: 2,
      namedAddressCount: 1,
      notLookedUpAddressCount: 0,
      isTimeBudgetExhausted: false,
      isReverseDnsAvailable: true,
      totalBudgetInMs: 60000,
    });
  });

  it("reads a pass that named nobody as complete, not as cut short", async () => {
    /*
     * Most addresses on most networks have no PTR record. A complete pass that
     * found none is the ordinary answer and must say nothing was left unasked
     * — or every such scan would carry a note blaming a time limit.
     */
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockReverseDns({});

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.reverseDnsOutcome).toMatchObject({
      resolvedCount: 0,
      addressCount: 2,
      namedAddressCount: 0,
      notLookedUpAddressCount: 0,
      isTimeBudgetExhausted: false,
      isReverseDnsAvailable: true,
    });
  });

  it("is absent when SubnetScanner.scan is called directly", async () => {
    /*
     * Absent means "this result has not been through the pass", the same rule
     * as reverseDnsResolvedCount. A verdict stamped by scan() would describe a
     * pass that never ran.
     */
    mockPingAlive(["10.0.0.1"]);
    mockReverseDns({ "10.0.0.1": "gw.corp.example.com" });

    const result: SubnetScanResult = await SubnetScanner.scan(icmpOnly());

    expect(result.reverseDnsOutcome).toBeUndefined();
    expect(result.netbiosOutcome).toBeUndefined();
  });

  it("is present and all zero when the sweep found nothing, with no budget to report", async () => {
    /*
     * scanWithDeadline stamps the verdict whenever the pass was reached, even
     * with nothing to ask. Zero addresses is what keeps the status message
     * from saying anything about naming; and since no pass ran, there is no
     * budget to name — the double's 60000 must not leak onto it.
     */
    mockPingAlive([]);
    const reverseDns: { asked: Array<Array<string>> } = mockReverseDns(
      {},
      { totalBudgetInMs: 60000 },
    );

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(reverseDns.asked).toHaveLength(0);
    expect(result.reverseDnsOutcome).toEqual({
      resolvedCount: 0,
      addressCount: 0,
      namedAddressCount: 0,
      notLookedUpAddressCount: 0,
      isTimeBudgetExhausted: false,
      isReverseDnsAvailable: true,
    });
    expect(result.reverseDnsOutcome?.totalBudgetInMs).toBeUndefined();
  });

  it("leaves the NetBIOS verdict absent on a scan that did not opt into NetBIOS", async () => {
    /*
     * The two verdicts are stamped independently. A NetBIOS outcome on a scan
     * that never asked for NetBIOS would be a pass that did not happen, and a
     * status note about hosts "not asked" by a lookup the operator left off.
     */
    mockPingAlive(["10.0.0.1"]);
    mockReverseDns({});

    for (const config of [
      icmpOnly(),
      { ...icmpOnly(), isNetbiosLookupEnabled: false },
    ]) {
      const result: SubnetScanResult = await sweep(config);

      expect(result.reverseDnsOutcome).toBeDefined();
      expect(result.netbiosOutcome).toBeUndefined();
      expect(result.netbiosResolvedCount).toBeUndefined();
    }

    expect(SubnetScanner.resolveNetbiosNames).not.toHaveBeenCalled();
  });
});

describe("result.reverseDnsOutcome — a pass cut short by its time budget", () => {
  it("mirrors the flag, how many addresses were never asked, and the budget it had", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"]);
    mockReverseDns(
      { "10.0.0.1": "core-gw.corp.example.com" },
      {
        isTimeBudgetExhausted: true,
        lookedUpCount: 2,
        notLookedUpCount: 2,
        totalBudgetInMs: 70400,
      },
    );

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.reverseDnsOutcome).toEqual({
      resolvedCount: 1,
      addressCount: 4,
      namedAddressCount: 1,
      notLookedUpAddressCount: 2,
      isTimeBudgetExhausted: true,
      isReverseDnsAvailable: true,
      totalBudgetInMs: 70400,
    });
    // Cut short is still not failed: the hosts are all there.
    expect(result.discoveredHosts).toHaveLength(4);
  });

  it("clamps an over-reported never-asked figure to the addresses left unnamed", async () => {
    /*
     * An address that was never asked cannot have been named, so a figure
     * above addressCount - namedAddressCount describes some other list. The
     * status message would otherwise say "40 were never looked up" about a
     * scan of four hosts.
     */
    mockPingAlive(["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"]);
    mockReverseDns(
      { "10.0.0.1": "core-gw.corp.example.com" },
      { isTimeBudgetExhausted: true, notLookedUpCount: 40 },
    );

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.reverseDnsOutcome?.notLookedUpAddressCount).toBe(3);
  });

  it("clamps it to zero when every address was named anyway", async () => {
    const outcome: ReverseDnsNamingOutcome = await outcomeFor(
      hostsAt("10.0.0.1", "10.0.0.2"),
      {
        "10.0.0.1": "a.corp.example.com",
        "10.0.0.2": "b.corp.example.com",
      },
      { isTimeBudgetExhausted: true, notLookedUpCount: 5 },
    );

    expect(outcome.notLookedUpAddressCount).toBe(0);
    expect(outcome.isTimeBudgetExhausted).toBe(true);
  });

  it("reports the never-asked figure as UNKNOWN when an exhausted double leaves it out", async () => {
    /*
     * Unknown, not zero. Zero would let the status message drop the "K were
     * never looked up" clause and imply the pass reached everything, when it
     * is known to have stopped early and nobody said how early.
     */
    const outcome: ReverseDnsNamingOutcome = await outcomeFor(
      hostsAt("10.0.0.1", "10.0.0.2", "10.0.0.3"),
      { "10.0.0.1": "gw.corp.example.com" },
      { isTimeBudgetExhausted: true, notLookedUpCount: undefined },
    );

    expect(outcome.isTimeBudgetExhausted).toBe(true);
    expect(outcome.notLookedUpAddressCount).toBeUndefined();
  });

  it("reports zero never-asked when a COMPLETE double leaves the figure out", async () => {
    /*
     * The other half: a pass that neither ran out of time nor gave up asked
     * every address by definition, so an omitted figure there is zero. Every
     * pre-existing double in the probe's suites omitted it.
     */
    const outcome: ReverseDnsNamingOutcome = await outcomeFor(
      hostsAt("10.0.0.1", "10.0.0.2"),
      {},
      { notLookedUpCount: undefined },
    );

    expect(outcome.notLookedUpAddressCount).toBe(0);
  });

  it("keeps a reported zero as zero rather than reading it as missing", async () => {
    // 0 is a count. A truthiness check would turn it into "unknown".
    const outcome: ReverseDnsNamingOutcome = await outcomeFor(
      hostsAt("10.0.0.1", "10.0.0.2"),
      {},
      { isTimeBudgetExhausted: true, notLookedUpCount: 0 },
    );

    expect(outcome.notLookedUpAddressCount).toBe(0);
  });

  it("carries a pass that both ran out of time and found the resolver unusable", async () => {
    // Independent facts, per ReverseDnsResolution; neither may mask the other.
    const outcome: ReverseDnsNamingOutcome = await outcomeFor(
      hostsAt("10.0.0.1", "10.0.0.2", "10.0.0.3"),
      {},
      {
        isTimeBudgetExhausted: true,
        isReverseDnsAvailable: false,
        notLookedUpCount: 2,
      },
    );

    expect(outcome).toMatchObject({
      isTimeBudgetExhausted: true,
      isReverseDnsAvailable: false,
      notLookedUpAddressCount: 2,
      namedAddressCount: 0,
    });
  });
});

describe("result.reverseDnsOutcome — an unusable resolver, and doubles reporting nonsense", () => {
  it("carries a resolver judged unusable, with the addresses it skipped", async () => {
    /*
     * "No answer from this probe's resolver" is a probe-configuration fact the
     * operator can fix, and a different note from "ran out of time".
     */
    mockPingAlive(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    mockReverseDns(
      {},
      {
        isReverseDnsAvailable: false,
        lookedUpCount: 1,
        notLookedUpCount: 2,
        totalBudgetInMs: 60000,
      },
    );

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.reverseDnsOutcome).toEqual({
      resolvedCount: 0,
      addressCount: 3,
      namedAddressCount: 0,
      notLookedUpAddressCount: 2,
      isTimeBudgetExhausted: false,
      isReverseDnsAvailable: false,
      totalBudgetInMs: 60000,
    });
  });

  it("reports the skipped figure as unknown when an unusable resolver's double leaves it out", async () => {
    // Stopped early is stopped early, whichever of the two reasons stopped it.
    const outcome: ReverseDnsNamingOutcome = await outcomeFor(
      hostsAt("10.0.0.1", "10.0.0.2"),
      {},
      { isReverseDnsAvailable: false, notLookedUpCount: undefined },
    );

    expect(outcome.isReverseDnsAvailable).toBe(false);
    expect(outcome.notLookedUpAddressCount).toBeUndefined();
  });

  it("reads anything but the literal false as a WORKING resolver", async () => {
    /*
     * A double that leaves the flag out must not convict the probe of having
     * no DNS: the status message would tell the operator to go and fix a
     * resolver configuration that is fine.
     */
    for (const value of [undefined, null, 0, "", "no", "false"]) {
      const outcome: ReverseDnsNamingOutcome = await outcomeFor(
        hostsAt("10.0.0.1"),
        {},
        { isReverseDnsAvailable: value, notLookedUpCount: undefined },
      );

      expect({
        value: value,
        available: outcome.isReverseDnsAvailable,
      }).toEqual({ value: value, available: true });
      // And, read as available and not exhausted, nothing was left unasked.
      expect(outcome.notLookedUpAddressCount).toBe(0);
    }
  });

  it("reads anything but the literal true as a pass that was NOT cut short", async () => {
    // Otherwise a "yes" from a sloppy double puts a time-limit note on a scan.
    for (const value of ["yes", "true", 1, {}, []]) {
      const outcome: ReverseDnsNamingOutcome = await outcomeFor(
        hostsAt("10.0.0.1", "10.0.0.2"),
        {},
        { isTimeBudgetExhausted: value, notLookedUpCount: undefined },
      );

      expect({
        value: value,
        exhausted: outcome.isTimeBudgetExhausted,
      }).toEqual({ value: value, exhausted: false });
      expect(outcome.notLookedUpAddressCount).toBe(0);
    }
  });

  it("reads a nonsense budget as unknown rather than carrying it", async () => {
    /*
     * formatNamingBudget would otherwise print "NaNms" or "Infinitym" into the
     * status message. Unknown makes the note say "time limit" with no figure.
     */
    for (const value of [NaN, -1, Infinity, -Infinity, "60000", null, {}]) {
      const outcome: ReverseDnsNamingOutcome = await outcomeFor(
        hostsAt("10.0.0.1"),
        {},
        { isTimeBudgetExhausted: true, totalBudgetInMs: value },
      );

      expect({ value: value, budget: outcome.totalBudgetInMs }).toEqual({
        value: value,
        budget: undefined,
      });
    }
  });

  it("reads a nonsense never-asked figure as unknown on a pass that stopped early", async () => {
    // "NaN were never looked up" is worse than a note that says less.
    for (const value of [NaN, -3, Infinity, "2", null]) {
      const outcome: ReverseDnsNamingOutcome = await outcomeFor(
        hostsAt("10.0.0.1", "10.0.0.2", "10.0.0.3"),
        {},
        { isTimeBudgetExhausted: true, notLookedUpCount: value },
      );

      expect({
        value: value,
        notLookedUp: outcome.notLookedUpAddressCount,
      }).toEqual({ value: value, notLookedUp: undefined });
    }
  });

  it("reads a nonsense never-asked figure as zero on a pass that did not stop early", async () => {
    const outcome: ReverseDnsNamingOutcome = await outcomeFor(
      hostsAt("10.0.0.1", "10.0.0.2"),
      {},
      { notLookedUpCount: NaN },
    );

    expect(outcome.notLookedUpAddressCount).toBe(0);
  });

  it("floors fractional counts and budgets", async () => {
    /*
     * "2.9 hosts" cannot be printed, and rounding up would claim an address
     * was skipped that the resolver did not say was.
     */
    const outcome: ReverseDnsNamingOutcome = await outcomeFor(
      hostsAt("10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"),
      { "10.0.0.1": "gw.corp.example.com" },
      {
        isTimeBudgetExhausted: true,
        notLookedUpCount: 2.9,
        totalBudgetInMs: 61600.7,
      },
    );

    expect(outcome.notLookedUpAddressCount).toBe(2);
    expect(outcome.totalBudgetInMs).toBe(61600);
  });
});

describe("result.reverseDnsOutcome — a host list that repeats an address", () => {
  /*
   * The SNMP path appends in completion order across two passes, so the same
   * address can legitimately appear twice. resolvedCount keeps its legacy
   * meaning (host ENTRIES stamped); every address figure counts what the
   * resolver actually asks, which is distinct addresses.
   */

  it("counts entries in resolvedCount and distinct addresses everywhere else", async () => {
    const hosts: Array<DiscoveredHost> = hostsAt(
      "10.0.0.1",
      "10.0.0.1",
      "10.0.0.2",
    );
    const reverseDns: { asked: Array<Array<string>> } = mockReverseDns({
      "10.0.0.1": "gw.corp.example.com",
    });

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames(hosts);

    expect(outcome).toMatchObject({
      resolvedCount: 2,
      addressCount: 2,
      namedAddressCount: 1,
      notLookedUpAddressCount: 0,
    });
    // Both entries carry the name; de-duplicating is the resolver's job.
    expect(hosts[0]!.dnsHostname).toBe("gw.corp.example.com");
    expect(hosts[1]!.dnsHostname).toBe("gw.corp.example.com");
    expect(reverseDns.asked[0]).toEqual(["10.0.0.1", "10.0.0.1", "10.0.0.2"]);
  });

  it("clamps the never-asked figure against distinct addresses, not entries", async () => {
    /*
     * Four entries, one named, leaves three unnamed ENTRIES but only one
     * unnamed ADDRESS. Clamping to entries would let a double claim three
     * addresses were skipped from a list that holds two.
     */
    const outcome: ReverseDnsNamingOutcome = await outcomeFor(
      hostsAt("10.0.0.1", "10.0.0.2", "10.0.0.2", "10.0.0.2"),
      { "10.0.0.1": "gw.corp.example.com" },
      { isTimeBudgetExhausted: true, notLookedUpCount: 9 },
    );

    expect(outcome.addressCount).toBe(2);
    expect(outcome.namedAddressCount).toBe(1);
    expect(outcome.notLookedUpAddressCount).toBe(1);
  });

  it("carries the same split through scanWithDeadline", async () => {
    mockSweepReturning(hostsAt("10.0.0.3", "10.0.0.3", "10.0.0.5"));
    mockReverseDns({ "10.0.0.3": "sw3.corp.example.com" });

    const result: SubnetScanResult = await sweep(withSnmp());

    expect(result.reverseDnsResolvedCount).toBe(2);
    expect(result.reverseDnsOutcome).toMatchObject({
      resolvedCount: 2,
      addressCount: 2,
      namedAddressCount: 1,
    });
  });
});

describe("result.reverseDnsOutcome — the lookup pass throws", () => {
  /*
   * Unreachable by design — the resolver never rejects — and the verdict still
   * has to be honest about it: every unnamed host was left unnamed for a
   * reason that is neither the budget nor the resolver, and the operator is
   * told so.
   */

  it("records the message, keeps every host, and warns", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    jest
      .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
      .mockRejectedValue(new Error("resolver blew up"));

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.discoveredHosts).toHaveLength(2);
    expect(result.reverseDnsOutcome).toEqual({
      resolvedCount: 0,
      addressCount: 2,
      namedAddressCount: 0,
      isTimeBudgetExhausted: false,
      isReverseDnsAvailable: true,
      error: "resolver blew up",
    });
    /*
     * Unknown, not zero: a pass that threw has no idea how many addresses it
     * reached. And no budget, because the resolver never reported one.
     */
    expect(result.reverseDnsOutcome?.notLookedUpAddressCount).toBeUndefined();
    expect(result.reverseDnsOutcome?.totalBudgetInMs).toBeUndefined();
    expect(result.reverseDnsResolvedCount).toBe(0);
    expect(warnedLines()).toMatch(/resolver blew up/);
  });

  it("truncates a long message to 120 characters", async () => {
    // It can end up on the status message, bounded the way SNMP errors are.
    const longMessage: string = "x".repeat(90) + "y".repeat(90);

    mockPingAlive(["10.0.0.1"]);
    jest
      .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
      .mockRejectedValue(new Error(longMessage));

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.reverseDnsOutcome?.error).toBe(longMessage.substring(0, 120));
  });

  it("trims whitespace around the message", async () => {
    jest
      .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
      .mockRejectedValue(new Error("  resolver blew up \n"));

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames(hostsAt("10.0.0.1"));

    expect(outcome.error).toBe("resolver blew up");
  });

  it("says 'unknown error' for a throw with nothing to say", async () => {
    /*
     * An empty error must still read as an error. Left empty, the status
     * message would print "failed on this probe ()" — and a falsy `error`
     * would drop the note altogether, hiding that the pass threw.
     */
    for (const thrown of [undefined, null, "", "   ", new Error("   ")]) {
      jest
        .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
        .mockRejectedValue(thrown);

      const outcome: ReverseDnsNamingOutcome =
        await SubnetScanner.attachReverseDnsHostnames(hostsAt("10.0.0.1"));

      expect({ thrown: String(thrown), error: outcome.error }).toEqual({
        thrown: String(thrown),
        error: "unknown error",
      });
    }
  });

  it("uses a thrown non-Error value as the message", async () => {
    jest
      .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
      .mockRejectedValue("resolver socket closed");

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames(hostsAt("10.0.0.1"));

    expect(outcome.error).toBe("resolver socket closed");
  });

  it("recounts from the hosts when the pass throws partway through stamping", async () => {
    /*
     * A name stamped before the throw stays stamped, and is uploaded. The
     * verdict has to describe the hosts the caller is about to send, so it is
     * recounted from them — a verdict of zero here would disagree with a host
     * that visibly carries a name.
     */
    const hostnameByIpAddress: Map<string, string> = new Map<string, string>([
      ["10.0.0.1", "core-gw.corp.example.com"],
      ["10.0.0.2", "printer-3.corp.example.com"],
      ["10.0.0.3", "nas-1.corp.example.com"],
    ]);
    let reads: number = 0;

    hostnameByIpAddress.get = (ipAddress: string): string | undefined => {
      reads++;

      if (reads > 1) {
        throw new Error("name table went away");
      }

      return Map.prototype.get.call(hostnameByIpAddress, ipAddress) as
        | string
        | undefined;
    };

    jest.spyOn(SubnetScanner, "resolveReverseDnsHostnames").mockResolvedValue({
      hostnameByIpAddress: hostnameByIpAddress,
      isReverseDnsAvailable: true,
      isTimeBudgetExhausted: false,
      lookedUpCount: 3,
      notLookedUpCount: 0,
      totalBudgetInMs: 60000,
    });

    const hosts: Array<DiscoveredHost> = hostsAt(
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
    );

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames(hosts);

    expect(hosts).toHaveLength(3);
    expect(hosts[0]!.dnsHostname).toBe("core-gw.corp.example.com");
    expect(hosts[1]!.dnsHostname).toBeUndefined();
    expect(hosts[2]!.dnsHostname).toBeUndefined();
    expect(outcome).toMatchObject({
      resolvedCount: 1,
      addressCount: 3,
      namedAddressCount: 1,
      isTimeBudgetExhausted: false,
      isReverseDnsAvailable: true,
      error: "name table went away",
    });
    expect(outcome.notLookedUpAddressCount).toBeUndefined();
    expect(warnedLines()).toMatch(/name table went away/);
  });

  it("counts a name a host already carried, because it is uploaded too", async () => {
    /*
     * Pins that the figure really is RECOUNTED from the hosts rather than
     * carried from the loop that threw: the loop had stamped nothing when the
     * very first read failed, but the second host arrived already named.
     */
    const hostnameByIpAddress: Map<string, string> = new Map<string, string>();

    hostnameByIpAddress.get = (): string | undefined => {
      throw new Error("name table went away");
    };

    jest.spyOn(SubnetScanner, "resolveReverseDnsHostnames").mockResolvedValue({
      hostnameByIpAddress: hostnameByIpAddress,
      isReverseDnsAvailable: true,
      isTimeBudgetExhausted: false,
      lookedUpCount: 2,
      notLookedUpCount: 0,
      totalBudgetInMs: 60000,
    });

    const hosts: Array<DiscoveredHost> = [
      { ipAddress: "10.0.0.1", snmpReachable: false },
      {
        ipAddress: "10.0.0.2",
        snmpReachable: false,
        dnsHostname: "legacy.corp.example.com",
      },
    ];

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames(hosts);

    expect(hosts[1]!.dnsHostname).toBe("legacy.corp.example.com");
    expect(outcome).toMatchObject({
      resolvedCount: 1,
      addressCount: 2,
      namedAddressCount: 1,
      error: "name table went away",
    });
  });

  it("puts the recount on reverseDnsResolvedCount too", async () => {
    // The legacy count and the verdict must agree on the failure path as well.
    const hostnameByIpAddress: Map<string, string> = new Map<string, string>([
      ["10.0.0.1", "core-gw.corp.example.com"],
      ["10.0.0.2", "printer-3.corp.example.com"],
    ]);
    let reads: number = 0;

    hostnameByIpAddress.get = (ipAddress: string): string | undefined => {
      reads++;

      if (reads > 1) {
        throw new Error("name table went away");
      }

      return Map.prototype.get.call(hostnameByIpAddress, ipAddress) as
        | string
        | undefined;
    };

    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    jest.spyOn(SubnetScanner, "resolveReverseDnsHostnames").mockResolvedValue({
      hostnameByIpAddress: hostnameByIpAddress,
      isReverseDnsAvailable: true,
      isTimeBudgetExhausted: false,
      lookedUpCount: 2,
      notLookedUpCount: 0,
      totalBudgetInMs: 60000,
    });

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.reverseDnsResolvedCount).toBe(1);
    expect(result.reverseDnsOutcome?.resolvedCount).toBe(1);
    expect(result.reverseDnsOutcome?.error).toBe("name table went away");
    expect(hostAt(result, "10.0.0.1")?.dnsHostname).toBe(
      "core-gw.corp.example.com",
    );
  });

  it("treats a resolution with no name table as a failed pass, not a crash", async () => {
    /*
     * A double (or a future refactor) that resolves without the map throws
     * inside the pass. That must surface as an error on the verdict, never as
     * a rejected scanWithDeadline that reports a finished sweep Failed.
     */
    mockPingAlive(["10.0.0.1"]);
    mockReverseDns({}, { hostnameByIpAddress: undefined });

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.discoveredHosts).toHaveLength(1);
    expect(hostAt(result, "10.0.0.1")?.dnsHostname).toBeUndefined();
    expect(result.reverseDnsOutcome?.resolvedCount).toBe(0);
    expect(result.reverseDnsOutcome?.error).toEqual(expect.any(String));
    expect(result.reverseDnsOutcome?.error).not.toBe("");
  });
});

describe("result.reverseDnsOutcome — the resolver's failure reason", () => {
  /*
   * isReverseDnsAvailable false says the first waves of lookups all failed.
   * A probe with a broken resolver and a reverse zone delegated to a dead
   * nameserver both produce that verdict, and the ONLY thing on the scan's
   * status message that tells the operator which of the two to go and fix is
   * the resolver's first infrastructure failure (ESERVFAIL against
   * ECONNREFUSED). So it has to reach the verdict — trimmed, because it is
   * quoted into a sentence — and a double that reports a blank or a
   * non-string must not put "()" or "[object Object]" there instead.
   */

  it("carries the reason, trimmed, on a pass that got through every address", async () => {
    /*
     * Copied regardless of the verdict. A complete pass can still have met a
     * failure along the way; whether it is worth SAYING is the note's call,
     * not the scanner's, and the scanner deciding for it would hide the
     * reason from a caller that does want it.
     */
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockReverseDns(
      { "10.0.0.1": "core-gw.corp.example.com" },
      { failureReason: "  queryPtr ESERVFAIL 2.0.0.10.in-addr.arpa \n" },
    );

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.reverseDnsOutcome).toEqual({
      resolvedCount: 1,
      addressCount: 2,
      namedAddressCount: 1,
      notLookedUpAddressCount: 0,
      isTimeBudgetExhausted: false,
      isReverseDnsAvailable: true,
      totalBudgetInMs: 60000,
      failureReason: "queryPtr ESERVFAIL 2.0.0.10.in-addr.arpa",
    });
  });

  it("carries the reason, trimmed, on a pass cut short by its time budget", async () => {
    const outcome: ReverseDnsNamingOutcome = await outcomeFor(
      hostsAt("10.0.0.1", "10.0.0.2", "10.0.0.3"),
      { "10.0.0.1": "core-gw.corp.example.com" },
      {
        isTimeBudgetExhausted: true,
        notLookedUpCount: 2,
        failureReason: "\tqueryPtr ETIMEOUT 2.0.0.10.in-addr.arpa  ",
      },
    );

    expect(outcome).toMatchObject({
      isTimeBudgetExhausted: true,
      isReverseDnsAvailable: true,
      notLookedUpAddressCount: 2,
      failureReason: "queryPtr ETIMEOUT 2.0.0.10.in-addr.arpa",
    });
  });

  it("carries the reason, trimmed, on a resolver judged unusable, through scanWithDeadline", async () => {
    // The case the reason exists for, on the path the status message reads.
    mockPingAlive(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    mockReverseDns(
      {},
      {
        isReverseDnsAvailable: false,
        lookedUpCount: 1,
        notLookedUpCount: 2,
        totalBudgetInMs: 60000,
        failureReason: " queryPtr ECONNREFUSED 1.0.0.10.in-addr.arpa\n\n",
      },
    );

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.reverseDnsOutcome).toEqual({
      resolvedCount: 0,
      addressCount: 3,
      namedAddressCount: 0,
      notLookedUpAddressCount: 2,
      isTimeBudgetExhausted: false,
      isReverseDnsAvailable: false,
      totalBudgetInMs: 60000,
      failureReason: "queryPtr ECONNREFUSED 1.0.0.10.in-addr.arpa",
    });
  });

  it("keeps whitespace INSIDE the reason, trimming only its ends", async () => {
    /*
     * Trimmed, not normalised: "connect ECONNREFUSED 10.0.0.53:53" is
     * meaningful with its spaces, and a reason that lost them would not be
     * the string the operator can search the probe log for.
     */
    const outcome: ReverseDnsNamingOutcome = await outcomeFor(
      hostsAt("10.0.0.1"),
      {},
      {
        isReverseDnsAvailable: false,
        failureReason: "  connect  ECONNREFUSED 10.0.0.53:53  ",
      },
    );

    expect(outcome.failureReason).toBe("connect  ECONNREFUSED 10.0.0.53:53");
  });

  it("reads a blank, whitespace-only or non-string reason as no reason at all", async () => {
    /*
     * Absent, never "": the note tests `failureReason` to decide whether to
     * print a parenthetical, and a present-but-blank string would print "()".
     * A non-string is a double describing something else — it must not be
     * String()-ed into "[object Object]" or "42" on the status message.
     */
    for (const value of [
      undefined,
      "",
      "   ",
      "\n\t ",
      42,
      0,
      NaN,
      null,
      true,
      {},
      { message: "ESERVFAIL" },
      ["ESERVFAIL"],
      new Error("ESERVFAIL"),
    ]) {
      const outcome: ReverseDnsNamingOutcome = await outcomeFor(
        hostsAt("10.0.0.1", "10.0.0.2"),
        {},
        { isReverseDnsAvailable: false, failureReason: value },
      );

      expect({
        value: value,
        failureReason: outcome.failureReason,
      }).toEqual({ value: value, failureReason: undefined });
      // The rest of the verdict is unaffected by a reason it could not read.
      expect(outcome.isReverseDnsAvailable).toBe(false);
    }
  });

  it("carries no reason for an empty host list, whatever the double would have said", async () => {
    // No pass ran, so no resolver failed; the seam is not even asked.
    const reverseDns: { asked: Array<Array<string>> } = mockReverseDns(
      {},
      { isReverseDnsAvailable: false, failureReason: "ESERVFAIL" },
    );

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames([]);

    expect(reverseDns.asked).toHaveLength(0);
    expect(outcome).not.toHaveProperty("failureReason");
  });

  it("carries no reason when the lookup pass throws", async () => {
    /*
     * A pass that threw reports `error`, and only `error`. A failureReason
     * beside it would give the note two different explanations for the same
     * unnamed hosts — and the throw path never saw a resolution to read one
     * from. Pinned as the KEY being absent, since toEqual elsewhere in this
     * file cannot tell an absent key from an undefined one.
     */
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    jest
      .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
      .mockRejectedValue(new Error("resolver blew up"));

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.reverseDnsOutcome?.error).toBe("resolver blew up");
    expect(result.reverseDnsOutcome).not.toHaveProperty("failureReason");
  });

  it("carries no reason when the pass throws AFTER the resolution reported one", async () => {
    /*
     * The resolution resolved, with a reason, and then reading its name table
     * threw. The verdict is the throw path's — `error` — rather than a blend
     * of the two, for the same reason as above.
     */
    const hostnameByIpAddress: Map<string, string> = new Map<string, string>();

    hostnameByIpAddress.get = (): string | undefined => {
      throw new Error("name table went away");
    };

    jest.spyOn(SubnetScanner, "resolveReverseDnsHostnames").mockResolvedValue({
      hostnameByIpAddress: hostnameByIpAddress,
      isReverseDnsAvailable: false,
      isTimeBudgetExhausted: false,
      lookedUpCount: 1,
      notLookedUpCount: 1,
      totalBudgetInMs: 60000,
      failureReason: "queryPtr ESERVFAIL 1.0.0.10.in-addr.arpa",
    });

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames(
        hostsAt("10.0.0.1", "10.0.0.2"),
      );

    expect(outcome.error).toBe("name table went away");
    expect(outcome).not.toHaveProperty("failureReason");
  });
});

describe("result.reverseDnsOutcome.error — describing what the pass threw", () => {
  /*
   * `error` is quoted into the scan's status message, so what it says about
   * an EMPTY throw matters as much as what it says about a real one. Before
   * this was fixed, an Error with an empty message fell back to String(error)
   * — its class name — so `new Error("")` put "(Error)" on the status message
   * while `new Error(" ")` said "unknown error" about exactly the same
   * nothing. Every empty throw now says "unknown error", and a non-Error is
   * still described by its own string form.
   */

  async function errorForRejection(
    thrown: unknown,
  ): Promise<string | undefined> {
    jest
      .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
      .mockRejectedValue(thrown);

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames(hostsAt("10.0.0.1"));

    return outcome.error;
  }

  it("says 'unknown error' for an Error with an empty message, not 'Error'", async () => {
    // The case with teeth: String() of this very value is the class name.
    const thrown: Error = new Error("");

    expect(String(thrown)).toBe("Error");
    expect(await errorForRejection(thrown)).toBe("unknown error");
  });

  it("says 'unknown error' for an Error whose message is only whitespace", async () => {
    expect(await errorForRejection(new Error("   "))).toBe("unknown error");
    expect(await errorForRejection(new Error("\n\t"))).toBe("unknown error");
  });

  it("says 'unknown error' for an empty TypeError, not 'TypeError'", async () => {
    /*
     * A subclass's name is no more a description than Error's is. The
     * enrichment most plausibly throws exactly this — reading a property off
     * a malformed resolution — and "(TypeError)" tells the operator nothing
     * they can act on.
     */
    const thrown: TypeError = new TypeError("");

    expect(String(thrown)).toBe("TypeError");
    expect(await errorForRejection(thrown)).toBe("unknown error");
  });

  it("says 'unknown error' for an Error whose message was blanked after it was built", async () => {
    // A named, custom Error with nothing to say is still nothing to say.
    const thrown: Error = new Error("resolver blew up");

    thrown.name = "ResolverError";
    thrown.message = " ";

    expect(await errorForRejection(thrown)).toBe("unknown error");
  });

  it("uses a thrown string as the message", async () => {
    expect(await errorForRejection("boom")).toBe("boom");
  });

  it("says 'unknown error' for a rejection with undefined", async () => {
    expect(await errorForRejection(undefined)).toBe("unknown error");
  });

  it("says 'unknown error' for an object whose string form is empty", async () => {
    /*
     * A non-Error is described by String(), so a value that stringifies to
     * nothing must land on the same fallback as an empty Error rather than on
     * a blank `error` — which would drop the note and hide that the pass
     * threw.
     */
    const thrown: { toString: () => string } = {
      toString: (): string => {
        return "";
      },
    };

    expect(String(thrown)).toBe("");
    expect(await errorForRejection(thrown)).toBe("unknown error");
  });

  it("keeps a message of exactly 120 characters whole", async () => {
    // The bound is inclusive: the boundary value itself is not cut.
    const message: string = "a".repeat(119) + "Z";

    expect(message).toHaveLength(120);
    expect(await errorForRejection(new Error(message))).toBe(message);
  });

  it("cuts a message of 121 characters to its first 120", async () => {
    // A head excerpt: the character that goes is the last one.
    const message: string = "a".repeat(120) + "Z";

    expect(message).toHaveLength(121);

    const error: string | undefined = await errorForRejection(
      new Error(message),
    );

    expect(error).toHaveLength(120);
    expect(error).toBe("a".repeat(120));
  });

  it("trims before it measures, so padding cannot push a 120-character message over", async () => {
    const message: string = "b".repeat(119) + "Z";

    expect(await errorForRejection(new Error(`   ${message}\n\n`))).toBe(
      message,
    );
  });
});

/*
 * Spies the REAL seam's resolver so it cannot look anything up, while still
 * reading the budget off the instance resolveReverseDnsHostnames built. The
 * budget is decided in the constructor and getTotalBudgetInMs, both left real;
 * only the lookups are replaced.
 *
 * Belt and braces: Node's own Resolver#reverse is spied to reject too, and
 * every test using this asserts it was never called — so a change that made
 * the pass reach the network anyway fails here instead of querying the
 * machine's DNS.
 *
 * And Resolver#resolvePtr with it (OneUptime issue #3916): the default lookup
 * asks resolvePtr for an IPv4 address, because reverse() reports every DNS
 * failure as "no record", so that is now the call a leak would make.
 */
function spyOnResolverWithoutLookups(): {
  budgets: Array<{ addressCount: number; totalBudgetInMs: number }>;
} {
  const budgets: Array<{ addressCount: number; totalBudgetInMs: number }> = [];

  jest
    .spyOn(dns.promises.Resolver.prototype, "reverse")
    .mockRejectedValue(new Error("a unit test must never send a PTR query"));
  jest
    .spyOn(dns.promises.Resolver.prototype, "resolvePtr")
    .mockRejectedValue(new Error("a unit test must never send a PTR query"));

  jest
    .spyOn(ReverseDnsResolver.prototype, "resolveHostnames")
    .mockImplementation(async function (
      this: ReverseDnsResolver,
      ipAddresses: Array<string>,
    ): Promise<ReverseDnsResolution> {
      const addressCount: number = new Set<string>(ipAddresses).size;
      const totalBudgetInMs: number = this.getTotalBudgetInMs(addressCount);

      budgets.push({
        addressCount: addressCount,
        totalBudgetInMs: totalBudgetInMs,
      });

      return {
        hostnameByIpAddress: new Map<string, string>(),
        isReverseDnsAvailable: true,
        isTimeBudgetExhausted: false,
        lookedUpCount: addressCount,
        notLookedUpCount: 0,
        totalBudgetInMs: totalBudgetInMs,
      };
    });

  return { budgets: budgets };
}

describe("the budget override reaches the resolver", () => {
  /*
   * PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS is the operator's only lever when
   * the note says the pass ran out of time. It is read in FetchScans, handed
   * through attachReverseDnsHostnames to the seam, and from there into the
   * resolver's constructor. A break anywhere along that path means raising it
   * does nothing — and the note keeps telling the operator to raise it.
   */

  it("attachReverseDnsHostnames hands its options to the seam untouched", async () => {
    const reverseDns: {
      options: Array<ReverseDnsPassOptions | undefined>;
    } = mockReverseDns({});
    const options: ReverseDnsPassOptions = { totalBudgetInMs: 5000 };

    await SubnetScanner.attachReverseDnsHostnames(hostsAt("10.0.0.1"), options);

    expect(reverseDns.options).toHaveLength(1);
    expect(reverseDns.options[0]).toBe(options);
    expect(reverseDns.options[0]?.totalBudgetInMs).toBe(5000);
  });

  it("hands the seam no options when it was given none", async () => {
    const reverseDns: {
      options: Array<ReverseDnsPassOptions | undefined>;
    } = mockReverseDns({});

    await SubnetScanner.attachReverseDnsHostnames(hostsAt("10.0.0.1"));

    expect(reverseDns.options).toEqual([undefined]);
  });

  it("scanWithDeadline asks for an AUTOMATIC budget when the variable is unset", async () => {
    /*
     * Unset parses to 0, and 0 must become undefined on the way through: the
     * resolver clamps a fixed budget to at least 1ms, so a 0 that leaked
     * through would end every pass before its first wave and name nothing.
     */
    expect(process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"]).toBe(
      undefined,
    );
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    const reverseDns: {
      options: Array<ReverseDnsPassOptions | undefined>;
    } = mockReverseDns({});

    await sweep(icmpOnly());

    expect(reverseDns.options).toHaveLength(1);
    expect(reverseDns.options[0]).toBeDefined();
    expect(reverseDns.options[0]?.totalBudgetInMs).toBeUndefined();
  });

  it("scanWithDeadline passes a configured budget through, and none for a value out of range", async () => {
    /*
     * Config.ts reads the variable once at load, so each value gets a freshly
     * loaded module graph — and the spies go on THAT graph's SubnetScanner,
     * which is the one its scanWithDeadline calls.
     */
    const originalValue: string | undefined =
      process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"];

    const optionsWith: (
      value: string,
    ) => Promise<ReverseDnsPassOptions | undefined> = async (
      value: string,
    ): Promise<ReverseDnsPassOptions | undefined> => {
      process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"] = value;

      /*
       * Held on an object: a bare `let` assigned inside the callback stays
       * narrowed to its initial undefined outside it.
       */
      const fresh: {
        scanWithDeadline?: typeof scanWithDeadline;
        scanner?: typeof SubnetScanner;
        logger?: typeof logger;
      } = {};

      jest.isolateModules(() => {
        fresh.scanWithDeadline = (
          jest.requireActual("../../../Jobs/Discovery/FetchScans") as {
            scanWithDeadline: typeof scanWithDeadline;
          }
        ).scanWithDeadline;
        fresh.scanner = (
          jest.requireActual("../../../Utils/Discovery/SubnetScanner") as {
            default: typeof SubnetScanner;
          }
        ).default;
        fresh.logger = (
          jest.requireActual("Common/Server/Utils/Logger") as {
            default: typeof logger;
          }
        ).default;
      });

      const scanner: typeof SubnetScanner = fresh.scanner!;
      const passOptions: Array<ReverseDnsPassOptions | undefined> = [];

      // A different module instance from the file's spies, which is the point.
      expect(scanner).not.toBe(SubnetScanner);

      jest.spyOn(fresh.logger!, "debug").mockImplementation(() => {
        return undefined as never;
      });
      jest.spyOn(fresh.logger!, "warn").mockImplementation(() => {
        return undefined as never;
      });
      jest.spyOn(scanner, "scan").mockResolvedValue({
        discoveredHosts: hostsAt("10.0.0.1"),
        scannedHostCount: 6,
        scannedPorts: [],
        responderCountByConfigId: {},
        snmpErrorHostCount: 0,
        icmpFilteredFallbackHostCount: 0,
        isIcmpOnlySweep: true,
      });
      jest
        .spyOn(scanner, "resolveReverseDnsHostnames")
        .mockImplementation(
          async (
            ipAddresses: Array<string>,
            options?: ReverseDnsPassOptions | undefined,
          ): Promise<ReverseDnsResolution> => {
            passOptions.push(options);

            return {
              hostnameByIpAddress: new Map<string, string>(),
              isReverseDnsAvailable: true,
              isTimeBudgetExhausted: false,
              lookedUpCount: new Set<string>(ipAddresses).size,
              notLookedUpCount: 0,
              totalBudgetInMs: 60000,
            };
          },
        );
      jest
        .spyOn(scanner, "resolveNetbiosNames")
        .mockRejectedValue(new Error("no NetBIOS in this test"));

      await fresh.scanWithDeadline!(icmpOnly(), "scan-budget", 30000);

      expect(passOptions).toHaveLength(1);

      return passOptions[0];
    };

    try {
      expect((await optionsWith("90000"))?.totalBudgetInMs).toBe(90000);
      /*
       * Below the 1s floor Config falls back to 0 (automatic), which must
       * again reach the seam as undefined. The parser's own range rules are
       * pinned in Tests/ConfigDiscoveryNamingBudget.test.ts; one value here
       * is enough to show a SET variable goes through the same `|| undefined`.
       * Each value costs a whole module graph, so no more than that.
       */
      expect((await optionsWith("500"))?.totalBudgetInMs).toBeUndefined();
    } finally {
      if (originalValue === undefined) {
        delete process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"];
      } else {
        process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"] = originalValue;
      }
    }
  });

  it("resolveReverseDnsHostnames builds its resolver with a fixed budget when given one", async () => {
    const resolver: {
      budgets: Array<{ addressCount: number; totalBudgetInMs: number }>;
    } = spyOnResolverWithoutLookups();

    const resolution: ReverseDnsResolution =
      await SubnetScanner.resolveReverseDnsHostnames(["10.0.0.1", "10.0.0.2"], {
        totalBudgetInMs: 5000,
      });

    expect(resolver.budgets).toEqual([
      { addressCount: 2, totalBudgetInMs: 5000 },
    ]);
    expect(resolution.totalBudgetInMs).toBe(5000);
    expect(dns.promises.Resolver.prototype.reverse).not.toHaveBeenCalled();
    expect(dns.promises.Resolver.prototype.resolvePtr).not.toHaveBeenCalled();
  });

  it("resolveReverseDnsHostnames sizes the budget to each pass when given none", async () => {
    /*
     * The fix for the flat sixty seconds: a thousand hosts behind a slow
     * resolver get the time a thousand hosts need, while a handful keep the
     * floor they always had. Sized over DISTINCT addresses.
     */
    const resolver: {
      budgets: Array<{ addressCount: number; totalBudgetInMs: number }>;
    } = spyOnResolverWithoutLookups();

    const thousandAddresses: Array<string> = [];

    for (let index: number = 0; index < 1000; index++) {
      thousandAddresses.push(`10.0.${Math.floor(index / 256)}.${index % 256}`);
    }

    await SubnetScanner.resolveReverseDnsHostnames(["10.0.0.1", "10.0.0.1"]);
    await SubnetScanner.resolveReverseDnsHostnames(
      [...thousandAddresses, "10.0.0.1"],
      { totalBudgetInMs: undefined },
    );

    expect(resolver.budgets).toEqual([
      {
        addressCount: 1,
        totalBudgetInMs: DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
      },
      {
        addressCount: 1000,
        totalBudgetInMs: getReverseDnsTotalBudgetInMs({ addressCount: 1000 }),
      },
    ]);
    expect(resolver.budgets[1]!.totalBudgetInMs).toBeGreaterThan(
      DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
    );
    expect(dns.promises.Resolver.prototype.reverse).not.toHaveBeenCalled();
    expect(dns.promises.Resolver.prototype.resolvePtr).not.toHaveBeenCalled();
  });

  it("scanWithDeadline hands the seam an options object with no NaN or Infinity in it", async () => {
    /*
     * The resolver now reads a non-finite budget as automatic, but that is a
     * second line of defence, not licence to send one: every field of what
     * scanWithDeadline builds is either a finite number or undefined. With
     * the variable unset, the budget is undefined — not NaN from an
     * unparsed value, and not the Config default of 0 either.
     */
    expect(process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"]).toBe(
      undefined,
    );
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    const reverseDns: {
      options: Array<ReverseDnsPassOptions | undefined>;
    } = mockReverseDns({});

    await sweep(icmpOnly());

    expect(reverseDns.options).toHaveLength(1);

    const passOptions: ReverseDnsPassOptions = reverseDns.options[0]!;

    expect(passOptions).toEqual(expect.any(Object));
    expect(passOptions.totalBudgetInMs).toBeUndefined();

    for (const [key, value] of Object.entries(passOptions)) {
      expect({
        key: key,
        isFiniteOrUndefined:
          value === undefined ||
          (typeof value === "number" && Number.isFinite(value)),
      }).toEqual({ key: key, isFiniteOrUndefined: true });
    }
  });

  it("resolveReverseDnsHostnames sizes the budget AUTOMATICALLY when handed NaN or Infinity", async () => {
    /*
     * A fixed budget of NaN made a deadline no clock ever reaches, and
     * Infinity is the same unbounded pass spelled honestly. The seam is
     * public, so a caller can hand it either; both must build a resolver
     * that sizes the budget to the pass exactly as if it had been given
     * none, and the budget reported back must be that finite figure.
     */
    const resolver: {
      budgets: Array<{ addressCount: number; totalBudgetInMs: number }>;
    } = spyOnResolverWithoutLookups();

    const resolutions: Array<ReverseDnsResolution> = [];

    for (const totalBudgetInMs of [NaN, Infinity, -Infinity]) {
      resolutions.push(
        await SubnetScanner.resolveReverseDnsHostnames(
          ["10.0.0.1", "10.0.0.2"],
          { totalBudgetInMs: totalBudgetInMs },
        ),
      );
    }

    expect(resolver.budgets).toEqual([
      {
        addressCount: 2,
        totalBudgetInMs: DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
      },
      {
        addressCount: 2,
        totalBudgetInMs: DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
      },
      {
        addressCount: 2,
        totalBudgetInMs: DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
      },
    ]);

    for (const resolution of resolutions) {
      expect(resolution.totalBudgetInMs).toBe(
        DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
      );
    }

    expect(dns.promises.Resolver.prototype.reverse).not.toHaveBeenCalled();
    expect(dns.promises.Resolver.prototype.resolvePtr).not.toHaveBeenCalled();
  });

  it("resolveReverseDnsHostnames grows a NaN or Infinity budget with the pass, like an absent one", async () => {
    /*
     * The two tiny passes above cannot tell "automatic" from "the 60-second
     * floor pinned as a fixed value". A thousand addresses can: automatic
     * sizing gives them more than the floor, so a NaN or Infinity that had
     * been clamped to some fixed figure would show here.
     */
    const resolver: {
      budgets: Array<{ addressCount: number; totalBudgetInMs: number }>;
    } = spyOnResolverWithoutLookups();

    const thousandAddresses: Array<string> = [];

    for (let index: number = 0; index < 1000; index++) {
      thousandAddresses.push(`10.0.${Math.floor(index / 256)}.${index % 256}`);
    }

    await SubnetScanner.resolveReverseDnsHostnames(thousandAddresses, {
      totalBudgetInMs: NaN,
    });
    await SubnetScanner.resolveReverseDnsHostnames(thousandAddresses, {
      totalBudgetInMs: Infinity,
    });
    await SubnetScanner.resolveReverseDnsHostnames(thousandAddresses);

    const automatic: number = getReverseDnsTotalBudgetInMs({
      addressCount: 1000,
    });

    expect(automatic).toBeGreaterThan(DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS);
    expect(Number.isFinite(automatic)).toBe(true);
    expect(resolver.budgets).toEqual([
      { addressCount: 1000, totalBudgetInMs: automatic },
      { addressCount: 1000, totalBudgetInMs: automatic },
      { addressCount: 1000, totalBudgetInMs: automatic },
    ]);
    expect(dns.promises.Resolver.prototype.reverse).not.toHaveBeenCalled();
    expect(dns.promises.Resolver.prototype.resolvePtr).not.toHaveBeenCalled();
  });

  it("carries a finite budget onto the verdict when the pass was handed NaN or Infinity", async () => {
    /*
     * The end of the chain: the note formats this figure into "its 1m time
     * limit". Automatic sizing must reach it as a real number rather than the
     * verdict falling back to "time limit" with no figure — or, worse, the
     * pass running unbounded.
     */
    spyOnResolverWithoutLookups();

    for (const totalBudgetInMs of [NaN, Infinity]) {
      const outcome: ReverseDnsNamingOutcome =
        await SubnetScanner.attachReverseDnsHostnames(
          hostsAt("10.0.0.1", "10.0.0.2"),
          { totalBudgetInMs: totalBudgetInMs },
        );

      expect({
        totalBudgetInMs: totalBudgetInMs,
        carried: outcome.totalBudgetInMs,
      }).toEqual({
        totalBudgetInMs: totalBudgetInMs,
        carried: DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
      });
    }

    expect(dns.promises.Resolver.prototype.reverse).not.toHaveBeenCalled();
    expect(dns.promises.Resolver.prototype.resolvePtr).not.toHaveBeenCalled();
  });

  it("carries the budget the resolver actually used onto result.reverseDnsOutcome", async () => {
    // The whole chain, with only the lookups themselves replaced.
    const resolver: {
      budgets: Array<{ addressCount: number; totalBudgetInMs: number }>;
    } = spyOnResolverWithoutLookups();
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(result.reverseDnsOutcome?.totalBudgetInMs).toBe(
      DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
    );

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames(hostsAt("10.0.0.9"), {
        totalBudgetInMs: 5000,
      });

    expect(outcome.totalBudgetInMs).toBe(5000);
    expect(resolver.budgets).toEqual([
      {
        addressCount: 2,
        totalBudgetInMs: DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
      },
      { addressCount: 1, totalBudgetInMs: 5000 },
    ]);
    expect(dns.promises.Resolver.prototype.reverse).not.toHaveBeenCalled();
    expect(dns.promises.Resolver.prototype.resolvePtr).not.toHaveBeenCalled();
  });
});
