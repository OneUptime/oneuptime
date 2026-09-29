// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";
/*
 * A custom (non-global) probe unless a test says otherwise. Cleared before any
 * import, because Config.ts reads it once at load and the developer's shell
 * may happen to carry one.
 */
delete process.env["REGISTER_PROBE_KEY"];
/*
 * And no configured NetBIOS host cap, for the same reason: the forwarding
 * tests below pin what scanWithDeadline passes down with the knob UNSET, and
 * Config.ts reads it once at load, so a developer's shell carrying one would
 * quietly rewrite the expectation.
 */
delete process.env["PROBE_DISCOVERY_NETBIOS_MAX_HOSTS"];

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
  NetbiosNamingOutcome,
  NetbiosPassOptions,
  SubnetScanConfig,
  SubnetScanResult,
  type SubnetScanSnmpConfig,
} from "../../../Utils/Discovery/SubnetScanner";
import { ReverseDnsResolution } from "../../../Utils/Discovery/ReverseDnsResolver";
import {
  DEFAULT_NETBIOS_MAX_HOSTS,
  MAX_NETBIOS_MAX_HOSTS_OVERRIDE,
  NetbiosNameResolution,
} from "../../../Utils/Discovery/NetbiosNameResolver";
import { PROBE_DISCOVERY_NETBIOS_MAX_HOSTS } from "../../../Config";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import {
  DiscoveryNetbiosPolicy,
  runScan,
  scanWithDeadline,
} from "../../../Jobs/Discovery/FetchScans";
import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";

/*
 * OneUptime issue #3677 — "Review Discovered Devices" lists hosts with no DNS
 * record and no SNMP as bare IP addresses.
 *
 * The probe can now ask such hosts for their NetBIOS name. The lookup itself
 * (packets, pacing, budgets, which replies count) is pinned against a fake
 * socket in Tests/Utils/Discovery/NetbiosNameResolver.test.ts. THIS file pins
 * where and when the lookup runs, driving scanWithDeadline — and runScan for
 * the scan-row flag — because every one of those decisions is about the job,
 * not the resolver:
 *
 *   1. Only hosts that are STILL unnamed are asked: no sysName, no
 *      dnsHostname. On both return paths of the sweep.
 *   2. It never runs unless the scan opted in with a literal true, and never
 *      on a global probe, whatever the row says. It sends UDP 137 to scanned
 *      hosts; nothing about that may happen by default.
 *   3. It never costs a sweep its results — not when it throws, and not when
 *      it is slower than the sweep's whole deadline.
 *   4. It leaves hosts it could not name exactly as they were: no
 *      `netbiosName` key at all.
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

// Answers the ICMP pre-sweep for `aliveHosts`; nothing forks a real ping.
function mockPingAlive(aliveHosts: Array<string>): void {
  jest
    .spyOn(SubnetScanner, "isHostAliveByPing")
    .mockImplementation(async (host: string) => {
      return aliveHosts.includes(host);
    });
}

// Hosts listed answer SNMP with that sysName; every other host answers nothing.
function mockSnmp(sysNameByHost: Record<string, string>): void {
  jest
    .spyOn(SnmpMonitor, "probeSystemInfo")
    .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
      const sysName: string | undefined = sysNameByHost[config.hostname || ""];

      return sysName !== undefined ? { sysName: sysName } : null;
    });
}

function mockReverseDns(hostnameByIpAddress: Record<string, string>): void {
  jest
    .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
    .mockImplementation(async (): Promise<ReverseDnsResolution> => {
      return {
        hostnameByIpAddress: new Map<string, string>(
          Object.entries(hostnameByIpAddress),
        ),
        isReverseDnsAvailable: true,
        isTimeBudgetExhausted: false,
        lookedUpCount: Object.keys(hostnameByIpAddress).length,
        notLookedUpCount: 0,
        totalBudgetInMs: 60000,
      };
    });
}

/*
 * Any field of a resolution, with any value at all. The seam is public and
 * spied on, so the verdict tests below hand attachNetbiosNames the shapes a
 * careless double would: a count that is a string, a flag that is 1.
 */
type NetbiosResolutionOverrides = {
  [Field in keyof NetbiosNameResolution]?: unknown;
};

/*
 * What the NetBIOS seam was called with: the address list per call, and the
 * pass options per call. "Who was asked, and was anyone asked at all" is most
 * of what this file checks; `askedOptions` adds the knob the probe forwards
 * (PROBE_DISCOVERY_NETBIOS_MAX_HOSTS), which decides how many of them the
 * lookup may actually ask.
 */
interface NetbiosSeamCalls {
  asked: Array<Array<string>>;
  askedOptions: Array<NetbiosPassOptions | undefined>;
}

/*
 * Replaces the NetBIOS seam with a fixed table and records every call it was
 * handed. `resolution` overrides fields of the otherwise complete,
 * unremarkable lookup it answers.
 */
function mockNetbios(
  nameByIpAddress: Record<string, string>,
  options?: { delayInMs?: number; resolution?: NetbiosResolutionOverrides },
): NetbiosSeamCalls {
  const asked: Array<Array<string>> = [];
  const askedOptions: Array<NetbiosPassOptions | undefined> = [];

  jest
    .spyOn(SubnetScanner, "resolveNetbiosNames")
    .mockImplementation(
      async (
        ipAddresses: Array<string>,
        passOptions?: NetbiosPassOptions | undefined,
      ): Promise<NetbiosNameResolution> => {
        asked.push([...ipAddresses]);
        askedOptions.push(passOptions);

        if (options?.delayInMs) {
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, options.delayInMs);
          });
        }

        return {
          nameByIpAddress: new Map<string, string>(
            Object.entries(nameByIpAddress),
          ),
          queriedCount: ipAddresses.length,
          skippedCount: 0,
          isTimeBudgetExhausted: false,
          isHostCapReached: false,
          eligibleCount: new Set<string>(ipAddresses).size,
          maxHosts: 2000,
          totalBudgetInMs: 30000,
          ...options?.resolution,
        } as NetbiosNameResolution;
      },
    );

  return { asked: asked, askedOptions: askedOptions };
}

/*
 * The raw argument lists the seam was called with. `askedOptions` above cannot
 * tell "called with undefined" from "called with one argument", and that
 * distinction is the whole of the no-options case: a seam called with one
 * argument would still read options?.maxHosts as undefined today and break
 * silently the day the signature grows a third parameter.
 */
function netbiosSeamCalls(): Array<Array<unknown>> {
  return (
    SubnetScanner.resolveNetbiosNames as unknown as {
      mock: { calls: Array<Array<unknown>> };
    }
  ).mock.calls;
}

function icmpOnly(isNetbiosLookupEnabled?: boolean): SubnetScanConfig {
  return {
    cidr: SIX_HOSTS,
    isSnmpEnabled: false,
    isNetbiosLookupEnabled: isNetbiosLookupEnabled,
  };
}

function withSnmp(isNetbiosLookupEnabled?: boolean): SubnetScanConfig {
  return {
    cidr: SIX_HOSTS,
    snmpConfigs: [snmpConfig()],
    isNetbiosLookupEnabled: isNetbiosLookupEnabled,
  };
}

const GENEROUS_DEADLINE_IN_MS: number = 30000;

function sweep(
  config: SubnetScanConfig,
  deadlineInMs: number = GENEROUS_DEADLINE_IN_MS,
): Promise<SubnetScanResult> {
  return scanWithDeadline(config, "scan-3677", deadlineInMs);
}

function hostAt(
  result: SubnetScanResult,
  ipAddress: string,
): DiscoveredHost | undefined {
  return result.discoveredHosts.find((host: DiscoveredHost) => {
    return host.ipAddress === ipAddress;
  });
}

function loggedLines(spy: unknown): string {
  return (spy as { mock: { calls: Array<Array<unknown>> } }).mock.calls
    .map((call: Array<unknown>) => {
      return String(call[0]);
    })
    .join("\n");
}

/*
 * Covers BOTH post-sweep seams for every test: installReverseDnsStub installs
 * the NetBIOS stub too. Tests about naming then replace either seam with a
 * table of their own.
 */
stubReverseDnsAsResolvingNothing();

beforeEach(() => {
  /*
   * SNMP resolves nothing unless a test says otherwise. Without this, a sweep
   * built by withSnmp() that does not call mockSnmp() itself runs the REAL
   * SnmpMonitor.probeSystemInfo — a real SNMPv2c GET with community "public"
   * to 10.0.0.0/29 on whatever network runs the suite, plus seconds of real
   * timeouts. A test that needs a sysName overrides this with mockSnmp().
   */
  mockSnmp({});
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

describe("who gets asked — only hosts that are still unnamed", () => {
  it("on an ICMP-only sweep, skips hosts reverse DNS already named", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    mockReverseDns({ "10.0.0.1": "gw.corp.example.com" });
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.0.0.2": "reg01",
    });

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(netbios.asked).toEqual([["10.0.0.2", "10.0.0.3"]]);
    expect(hostAt(result, "10.0.0.2")?.netbiosName).toBe("reg01");
    expect(result.netbiosResolvedCount).toBe(1);
  });

  it("on an SNMP sweep, skips hosts with a sysName and hosts with a PTR name", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    mockSnmp({ "10.0.0.1": "core-switch-01" });
    mockReverseDns({ "10.0.0.3": "printer.corp.example.com" });
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.0.0.2": "cam-lobby",
    });

    const result: SubnetScanResult = await sweep(withSnmp(true));

    expect(netbios.asked).toEqual([["10.0.0.2"]]);
    expect(hostAt(result, "10.0.0.2")?.netbiosName).toBe("cam-lobby");
    // A named host is never handed a NetBIOS name, even if the table has one.
    expect(hostAt(result, "10.0.0.1")).not.toHaveProperty("netbiosName");
    expect(hostAt(result, "10.0.0.3")).not.toHaveProperty("netbiosName");
  });

  it("treats a blank sysName as no name at all", async () => {
    /*
     * An SNMP agent whose sysName varbind came back empty is exactly as
     * nameless as a ping-only host, and the Review dialog would show it as an
     * address either way.
     */
    mockPingAlive(["10.0.0.1"]);
    mockSnmp({ "10.0.0.1": "   " });
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.0.0.1": "blank-agent",
    });

    const result: SubnetScanResult = await sweep(withSnmp(true));

    expect(netbios.asked).toEqual([["10.0.0.1"]]);
    expect(hostAt(result, "10.0.0.1")?.netbiosName).toBe("blank-agent");
  });

  it("asks nothing when every host already has a name", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockReverseDns({
      "10.0.0.1": "a.corp.example.com",
      "10.0.0.2": "b.corp.example.com",
    });
    const netbios: { asked: Array<Array<string>> } = mockNetbios({});

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(netbios.asked).toEqual([]);
    // It RAN — it just had nobody to ask — so the count is zero, not absent.
    expect(result.netbiosResolvedCount).toBe(0);
  });

  it("asks nothing when the sweep found nothing", async () => {
    mockPingAlive([]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({});

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(netbios.asked).toEqual([]);
    expect(result.discoveredHosts).toEqual([]);
  });
});

describe("what a host looks like afterwards", () => {
  it("stores the name lower-cased and normalised, whatever the seam returned", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockNetbios({ "10.0.0.1": "WORKSTATION-01", "10.0.0.2": "BAD NAME" });

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(hostAt(result, "10.0.0.1")?.netbiosName).toBe("workstation-01");
    // Not a usable name, so not a name at all.
    expect(hostAt(result, "10.0.0.2")).not.toHaveProperty("netbiosName");
    expect(result.netbiosResolvedCount).toBe(1);
  });

  it("leaves an unresolved host with no netbiosName key, so old literals still match", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockNetbios({ "10.0.0.1": "reg01" });

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(hostAt(result, "10.0.0.1")).toEqual({
      ipAddress: "10.0.0.1",
      snmpReachable: false,
      netbiosName: "reg01",
    });
    expect(hostAt(result, "10.0.0.2")).toStrictEqual({
      ipAddress: "10.0.0.2",
      snmpReachable: false,
    });
  });

  it("ignores a name for an address the sweep never found", async () => {
    mockPingAlive(["10.0.0.1"]);
    mockNetbios({ "10.0.0.1": "reg01", "10.0.0.99": "ghost" });

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(result.discoveredHosts).toHaveLength(1);
    expect(result.netbiosResolvedCount).toBe(1);
  });

  it("leaves the sweep's order and tallies alone", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.4", "10.0.0.6"]);
    mockNetbios({ "10.0.0.4": "middle" });

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(
      result.discoveredHosts.map((host: DiscoveredHost) => {
        return host.ipAddress;
      }),
    ).toEqual(["10.0.0.1", "10.0.0.4", "10.0.0.6"]);
    expect(result.scannedHostCount).toBe(6);
    expect(result.respondedToPingCount).toBe(3);
  });
});

describe("when it runs at all — opt-in, and never on a global probe", () => {
  it("does not ask when the scan config has no flag", async () => {
    mockPingAlive(["10.0.0.1"]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.0.0.1": "reg01",
    });

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(netbios.asked).toEqual([]);
    expect(hostAt(result, "10.0.0.1")).not.toHaveProperty("netbiosName");
    // Did not run, which is a different statement from "named nobody".
    expect(result.netbiosResolvedCount).toBeUndefined();
  });

  it("does not ask when the flag is false, on either sweep path", async () => {
    mockPingAlive(["10.0.0.1"]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({});

    await sweep(icmpOnly(false));
    await sweep(withSnmp(false));

    expect(netbios.asked).toEqual([]);
  });

  it("does not ask for a truthy value that is not the literal true", async () => {
    mockPingAlive(["10.0.0.1"]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({});

    for (const value of ["true", 1, {}]) {
      await sweep({
        cidr: SIX_HOSTS,
        isSnmpEnabled: false,
        isNetbiosLookupEnabled: value as unknown as boolean,
      });
    }

    expect(netbios.asked).toEqual([]);
  });

  it("does not ask on a global probe, even when the scan opted in", async () => {
    mockPingAlive(["10.0.0.1"]);
    jest.spyOn(DiscoveryNetbiosPolicy, "isGlobalProbe").mockReturnValue(true);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.0.0.1": "reg01",
    });

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(netbios.asked).toEqual([]);
    expect(hostAt(result, "10.0.0.1")).not.toHaveProperty("netbiosName");
    expect(result.netbiosResolvedCount).toBeUndefined();
    expect(loggedLines(logger.debug)).toMatch(/global probe/);

    /*
     * And no longer ONLY a debug line (OneUptime issue #3916): the host the
     * lookup would have asked says why it was not, and the result carries the
     * skip for the status message. Still never asked — the policy stands.
     */
    expect(hostAt(result, "10.0.0.1")).toStrictEqual({
      ipAddress: "10.0.0.1",
      snmpReachable: false,
      netbiosNameStatus: "skipped-global-probe",
    });
    expect(result.isNetbiosLookupSkippedOnGlobalProbe).toBe(true);
  });

  it("reads the probe's real REGISTER_PROBE_KEY through Probe/Config", () => {
    /*
     * The spy above proves scanWithDeadline obeys the policy; this proves the
     * policy reads the real thing. Config.ts evaluates the key once at load,
     * so each case gets a freshly loaded module graph.
     */
    const originalKey: string | undefined = process.env["REGISTER_PROBE_KEY"];

    const isGlobalProbeWith: (key: string | undefined) => boolean = (
      key: string | undefined,
    ): boolean => {
      if (key === undefined) {
        delete process.env["REGISTER_PROBE_KEY"];
      } else {
        process.env["REGISTER_PROBE_KEY"] = key;
      }

      let isGlobal: boolean = false;

      jest.isolateModules(() => {
        const freshFetchScans: {
          DiscoveryNetbiosPolicy: { isGlobalProbe: () => boolean };
        } = jest.requireActual("../../../Jobs/Discovery/FetchScans") as {
          DiscoveryNetbiosPolicy: { isGlobalProbe: () => boolean };
        };

        isGlobal = freshFetchScans.DiscoveryNetbiosPolicy.isGlobalProbe();
      });

      return isGlobal;
    };

    try {
      expect(isGlobalProbeWith("global-probe-registration-key")).toBe(true);
      expect(isGlobalProbeWith(undefined)).toBe(false);
    } finally {
      if (originalKey === undefined) {
        delete process.env["REGISTER_PROBE_KEY"];
      } else {
        process.env["REGISTER_PROBE_KEY"] = originalKey;
      }
    }
  });
});

describe("naming never costs a sweep its results", () => {
  it("returns the sweep's hosts and warns when the NetBIOS pass throws", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    jest
      .spyOn(SubnetScanner, "attachNetbiosNames")
      .mockRejectedValue(new Error("netbios blew up"));

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(result.discoveredHosts).toHaveLength(2);
    expect(result.netbiosResolvedCount).toBeUndefined();
    expect(loggedLines(logger.warn)).toMatch(/netbios blew up/);
  });

  it("returns the SNMP sweep's hosts when the lookup seam rejects", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockSnmp({ "10.0.0.1": "core-switch-01" });
    jest
      .spyOn(SubnetScanner, "resolveNetbiosNames")
      .mockRejectedValue(new Error("socket factory exploded"));

    const result: SubnetScanResult = await sweep(withSnmp(true));

    expect(result.discoveredHosts).toHaveLength(2);
    expect(hostAt(result, "10.0.0.1")?.sysName).toBe("core-switch-01");
    // attachNetbiosNames caught it: the pass ran and named nobody.
    expect(result.netbiosResolvedCount).toBe(0);
    expect(loggedLines(logger.warn)).toMatch(/socket factory exploded/);
  });

  it("a NetBIOS pass slower than the whole deadline still returns the sweep's hosts", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    // 250ms of lookups against a 120ms deadline: fatal if it ran inside.
    mockNetbios({ "10.0.0.1": "reg01" }, { delayInMs: 250 });

    const result: SubnetScanResult = await sweep(icmpOnly(true), 120);

    expect(result.discoveredHosts).toHaveLength(2);
    expect(hostAt(result, "10.0.0.1")?.netbiosName).toBe("reg01");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not ask when the sweep itself misses its deadline", async () => {
    jest
      .spyOn(SubnetScanner, "scan")
      .mockImplementation((): Promise<SubnetScanResult> => {
        return new Promise<SubnetScanResult>(() => {});
      });
    const netbios: { asked: Array<Array<string>> } = mockNetbios({});

    await expect(sweep(icmpOnly(true), 80)).rejects.toThrow(
      /did not finish|was abandoned/i,
    );
    expect(netbios.asked).toEqual([]);
  });
});

describe("SubnetScanner.scan itself does no NetBIOS lookups", () => {
  it("returns hosts with no netbiosName and no count, even with the flag on", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.0.0.1": "reg01",
    });

    const result: SubnetScanResult = await SubnetScanner.scan(icmpOnly(true));

    expect(netbios.asked).toEqual([]);
    expect(hostAt(result, "10.0.0.1")).not.toHaveProperty("netbiosName");
    expect(result.netbiosResolvedCount).toBeUndefined();
  });
});

describe("SubnetScanner.attachNetbiosNames — used directly", () => {
  it("returns zero and asks nothing for an empty host list", async () => {
    const netbios: { asked: Array<Array<string>> } = mockNetbios({});

    await expect(SubnetScanner.attachNetbiosNames([])).resolves.toMatchObject({
      resolvedCount: 0,
    });
    expect(netbios.asked).toEqual([]);
  });

  it("stamps names onto the array it was given, in place", async () => {
    mockNetbios({ "10.0.0.2": "printer" });

    const hosts: Array<DiscoveredHost> = [
      { ipAddress: "10.0.0.1", snmpReachable: false },
      { ipAddress: "10.0.0.2", snmpReachable: false },
    ];
    const same: Array<DiscoveredHost> = hosts;

    const count: number = (await SubnetScanner.attachNetbiosNames(hosts))
      .resolvedCount;

    expect(count).toBe(1);
    expect(hosts).toBe(same);
    expect(hosts[0]).not.toHaveProperty("netbiosName");
    expect(hosts[1]!.netbiosName).toBe("printer");
  });

  it("names every entry for an address the sweep reported twice", async () => {
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.0.0.1": "twice",
    });

    const hosts: Array<DiscoveredHost> = [
      { ipAddress: "10.0.0.1", snmpReachable: false },
      { ipAddress: "10.0.0.1", snmpReachable: false },
    ];

    await expect(
      SubnetScanner.attachNetbiosNames(hosts),
    ).resolves.toMatchObject({
      resolvedCount: 2,
      // Counted once as an address: that is what the status message reports.
      namedAddressCount: 1,
    });
    // De-duplication is the resolver's job; the seam sees the list as given.
    expect(netbios.asked).toHaveLength(1);
    expect(hosts[1]!.netbiosName).toBe("twice");
  });

  it("never throws, even when handed something that is not a host list", async () => {
    mockNetbios({});

    await expect(
      SubnetScanner.attachNetbiosNames(
        undefined as unknown as Array<DiscoveredHost>,
      ),
    ).resolves.toMatchObject({ resolvedCount: 0 });
    await expect(
      SubnetScanner.attachNetbiosNames([
        null,
      ] as unknown as Array<DiscoveredHost>),
    ).resolves.toMatchObject({ resolvedCount: 0 });
  });
});

/*
 * PROBE_DISCOVERY_NETBIOS_MAX_HOSTS, from the probe's environment to the
 * resolver.
 *
 * The knob exists because the host cap is the commonest way the lookup stops
 * short on a large estate, and the scan's status message now says so and tells
 * the operator to raise it. That advice is a lie unless the number actually
 * travels: Config reads it, scanWithDeadline turns the 0 sentinel into
 * `undefined`, attachNetbiosNames forwards the options object untouched, and
 * resolveNetbiosNames hands it to NetbiosNameResolver. Each of those is a
 * separate place for it to be dropped — and a dropped cap is invisible, since
 * every hop keeps working at the built-in 2,000.
 */
describe("SubnetScanner.attachNetbiosNames — forwarding the host cap to the resolver seam", () => {
  it("hands the seam the very options object it was given", async () => {
    const netbios: NetbiosSeamCalls = mockNetbios({});
    const passOptions: NetbiosPassOptions = { maxHosts: 3000 };

    await SubnetScanner.attachNetbiosNames([pingOnly("10.0.0.1")], passOptions);

    expect(netbios.askedOptions).toHaveLength(1);
    // The object itself, not a copy that could have been rebuilt without it.
    expect(netbios.askedOptions[0]).toBe(passOptions);
    expect(netbios.askedOptions[0]).toStrictEqual({ maxHosts: 3000 });
    expect(netbios.asked).toEqual([["10.0.0.1"]]);
  });

  it.each([1, DEFAULT_NETBIOS_MAX_HOSTS, MAX_NETBIOS_MAX_HOSTS_OVERRIDE])(
    "forwards a cap of %p unchanged, without clamping or rounding it itself",
    async (maxHosts: number) => {
      /*
       * Clamping belongs to the resolver's constructor, which is the only
       * place that knows the built-in default. A seam that quietly normalised
       * the figure would make the resolver's own clamping untestable and the
       * reported maxHosts disagree with what was asked for.
       */
      const netbios: NetbiosSeamCalls = mockNetbios({});

      await SubnetScanner.attachNetbiosNames([pingOnly("10.0.0.1")], {
        maxHosts: maxHosts,
      });

      expect(netbios.askedOptions).toStrictEqual([{ maxHosts: maxHosts }]);
    },
  );

  it("passes undefined as the second argument when it is given no options at all", async () => {
    const netbios: NetbiosSeamCalls = mockNetbios({});

    await SubnetScanner.attachNetbiosNames([pingOnly("10.0.0.1")]);

    expect(netbios.askedOptions).toEqual([undefined]);
    // Two arguments, the second of them undefined — not a one-argument call.
    expect(netbios.askedOptions[0]).toBeUndefined();
    expect(netbiosSeamCalls()).toHaveLength(1);
    expect(netbiosSeamCalls()[0]).toHaveLength(2);
    expect(netbiosSeamCalls()[0]![1]).toBeUndefined();
  });

  it("forwards an explicitly undefined cap as undefined, never as a number", async () => {
    /*
     * The shape FetchScans builds from the 0 sentinel:
     * `{ maxHosts: PROBE_DISCOVERY_NETBIOS_MAX_HOSTS || undefined }`. The
     * resolver reads an undefined maxHosts as "use DEFAULT_NETBIOS_MAX_HOSTS";
     * a 0 that reached it would clamp to 1 and the lookup would ask a single
     * host on every scan.
     */
    const netbios: NetbiosSeamCalls = mockNetbios({});

    await SubnetScanner.attachNetbiosNames([pingOnly("10.0.0.1")], {
      maxHosts: undefined,
    });

    expect(netbios.askedOptions).toStrictEqual([{ maxHosts: undefined }]);
  });

  it("asks nothing, and so forwards nothing, when every host already has a name", async () => {
    const netbios: NetbiosSeamCalls = mockNetbios({});

    await SubnetScanner.attachNetbiosNames(
      [{ ipAddress: "10.0.0.1", snmpReachable: true, sysName: "core-01" }],
      { maxHosts: 3000 },
    );

    expect(netbios.asked).toEqual([]);
    expect(netbios.askedOptions).toEqual([]);
  });
});

describe("scanWithDeadline — the probe's configured host cap reaches the resolver seam", () => {
  it("forwards { maxHosts: undefined } while PROBE_DISCOVERY_NETBIOS_MAX_HOSTS is unset", async () => {
    /*
     * Unset is 0, the "use the resolver's own cap" sentinel, and FetchScans
     * must turn it into undefined rather than passing the 0 on. Checked
     * against the Config value itself, so this still pins the mapping — not
     * just today's literal — if the default ever moves.
     */
    expect(PROBE_DISCOVERY_NETBIOS_MAX_HOSTS).toBe(0);

    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    const netbios: NetbiosSeamCalls = mockNetbios({});

    await sweep(icmpOnly(true));

    const expectedMaxHosts: number | undefined =
      PROBE_DISCOVERY_NETBIOS_MAX_HOSTS || undefined;

    expect(expectedMaxHosts).toBeUndefined();
    expect(netbios.askedOptions).toStrictEqual([
      { maxHosts: expectedMaxHosts },
    ]);
    // The key is there and undefined, never a 0 the resolver would clamp to 1.
    expect(netbios.askedOptions[0]).toStrictEqual({ maxHosts: undefined });
    expect(netbiosSeamCalls()[0]).toHaveLength(2);
  });

  it("forwards the same cap on an SNMP sweep, for the hosts SNMP left unnamed", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockSnmp({ "10.0.0.1": "core-switch-01" });
    const netbios: NetbiosSeamCalls = mockNetbios({});

    await sweep(withSnmp(true));

    expect(netbios.asked).toEqual([["10.0.0.2"]]);
    expect(netbios.askedOptions).toStrictEqual([{ maxHosts: undefined }]);
  });

  it("forwards nothing at all when the scan did not opt in", async () => {
    mockPingAlive(["10.0.0.1"]);
    const netbios: NetbiosSeamCalls = mockNetbios({});

    await sweep(icmpOnly(false));

    expect(netbios.askedOptions).toEqual([]);
  });

  it("reports the cap the lookup RAN under, not the one it was asked for", async () => {
    /*
     * netbiosOutcome.maxHosts is what the status message subtracts
     * eligibleAddressCount from to say how many hosts "were not asked", and
     * what FetchScans compares against MAX_NETBIOS_MAX_HOSTS_OVERRIDE to
     * decide whether to advise raising the knob. So it has to be the
     * resolution's figure — the cap the resolver applied after its own
     * clamping — and not an echo of the option that was forwarded.
     */
    mockPingAlive(["10.0.0.1"]);
    const netbios: NetbiosSeamCalls = mockNetbios(
      {},
      {
        resolution: {
          maxHosts: DEFAULT_NETBIOS_MAX_HOSTS,
          isHostCapReached: true,
          eligibleCount: 2500,
          queriedCount: 2000,
          totalBudgetInMs: 53725,
        },
      },
    );

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(netbios.askedOptions).toStrictEqual([{ maxHosts: undefined }]);
    expect(result.netbiosOutcome).toMatchObject({
      maxHosts: 2000,
      isHostCapReached: true,
      eligibleAddressCount: 2500,
      queriedAddressCount: 2000,
      totalBudgetInMs: 53725,
    });
  });

  it("carries a RAISED cap through to the verdict, with the budget it bought", async () => {
    /*
     * The operator's side of the knob: a lookup that ran at 3,000 hosts must
     * report 3,000, or the status sentence would tell an operator who had
     * already raised it that the cap is 2,000 and to raise it again.
     */
    mockPingAlive(["10.0.0.1"]);
    mockNetbios(
      {},
      {
        resolution: {
          maxHosts: 3000,
          isHostCapReached: true,
          eligibleCount: 3500,
          queriedCount: 3000,
          // 2 × (2,999 × 10 + 1,500) × 1.25, the budget 3,000 hosts are sized.
          totalBudgetInMs: 78725,
        },
      },
    );

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(result.netbiosOutcome).toMatchObject({
      maxHosts: 3000,
      isHostCapReached: true,
      eligibleAddressCount: 3500,
      queriedAddressCount: 3000,
      totalBudgetInMs: 78725,
    });
    expect(result.netbiosOutcome?.maxHosts).toBeLessThan(
      MAX_NETBIOS_MAX_HOSTS_OVERRIDE,
    );
  });

  it("carries the ceiling cap through to the verdict as well", async () => {
    /*
     * At MAX_NETBIOS_MAX_HOSTS_OVERRIDE there is nothing left to advise, and
     * FetchScans drops the "raise PROBE_DISCOVERY_NETBIOS_MAX_HOSTS" clause on
     * exactly this figure — so the verdict must carry it unaltered.
     */
    mockPingAlive(["10.0.0.1"]);
    mockNetbios(
      {},
      {
        resolution: {
          maxHosts: MAX_NETBIOS_MAX_HOSTS_OVERRIDE,
          isHostCapReached: true,
          eligibleCount: MAX_NETBIOS_MAX_HOSTS_OVERRIDE + 120,
          queriedCount: MAX_NETBIOS_MAX_HOSTS_OVERRIDE,
        },
      },
    );

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(result.netbiosOutcome?.maxHosts).toBe(
      MAX_NETBIOS_MAX_HOSTS_OVERRIDE,
    );
    expect(result.netbiosOutcome?.eligibleAddressCount).toBe(4120);
  });
});

describe("runScan — the flag comes off the scan row as a literal true", () => {
  /*
   * The row is what the server hands the probe, so this is where "an absent
   * column means off" has to hold: a new probe polling an old server must not
   * start sending UDP 137 for every scan in the project.
   */
  const scanId: ObjectID = ObjectID.generate();

  function makeIcmpOnlyScan(
    overrides?: JSONObject,
  ): NetworkDeviceDiscoveryScan {
    return {
      id: scanId,
      cidr: "10.0.0.0/24",
      isSnmpEnabled: false,
      snmpVersion: null,
      snmpCommunityString: null,
      snmpPort: null,
      ...overrides,
    } as unknown as NetworkDeviceDiscoveryScan;
  }

  function mockSweepFinding(hosts: Array<DiscoveredHost>): void {
    jest.spyOn(SubnetScanner, "scan").mockResolvedValue({
      discoveredHosts: hosts,
      scannedHostCount: 254,
      scannedPorts: [],
      responderCountByConfigId: {},
      respondedToPingCount: hosts.length,
      snmpErrorHostCount: 0,
      icmpFilteredFallbackHostCount: 0,
      isIcmpOnlySweep: true,
      isIcmpSweepIncomplete: false,
    } as SubnetScanResult);
  }

  // The final (success: true, not partial) upload's host list.
  function uploadedDevices(
    fetchSpy: ReturnType<typeof jest.spyOn>,
  ): Array<JSONObject> | undefined {
    const finalUpload: JSONObject | undefined = (
      fetchSpy.mock.calls as Array<Array<JSONObject>>
    )
      .map((call: Array<JSONObject>) => {
        return call[0]!["data"] as JSONObject;
      })
      .find((body: JSONObject) => {
        return body["success"] === true && body["isPartial"] !== true;
      });

    return finalUpload?.["discoveredDevices"] as Array<JSONObject> | undefined;
  }

  it("looks names up and uploads them when the row says true", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const fetchSpy = jest
      .spyOn(API, "fetch")
      .mockResolvedValue({ data: [] } as never);
    mockSweepFinding([
      { ipAddress: "10.18.167.31", snmpReachable: false },
      { ipAddress: "10.18.167.32", snmpReachable: false },
    ]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.18.167.31": "reg01",
    });

    await runScan(makeIcmpOnlyScan({ isNetbiosLookupEnabled: true }));

    expect(netbios.asked).toEqual([["10.18.167.31", "10.18.167.32"]]);
    expect(uploadedDevices(fetchSpy)).toEqual([
      { ipAddress: "10.18.167.31", snmpReachable: false, netbiosName: "reg01" },
      { ipAddress: "10.18.167.32", snmpReachable: false },
    ]);
    expect(loggedLines(logger.debug)).toMatch(/1 named by NetBIOS/);
  });

  it("does not look anything up when the row has no such column", async () => {
    jest.spyOn(API, "fetch").mockResolvedValue({ data: [] } as never);
    mockSweepFinding([{ ipAddress: "10.18.167.31", snmpReachable: false }]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.18.167.31": "reg01",
    });

    await runScan(makeIcmpOnlyScan());

    expect(netbios.asked).toEqual([]);
    expect(loggedLines(logger.debug)).not.toMatch(/named by NetBIOS/);
  });

  it("does not look anything up when the row says false", async () => {
    jest.spyOn(API, "fetch").mockResolvedValue({ data: [] } as never);
    mockSweepFinding([{ ipAddress: "10.18.167.31", snmpReachable: false }]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({});

    await runScan(makeIcmpOnlyScan({ isNetbiosLookupEnabled: false }));

    expect(netbios.asked).toEqual([]);
  });
});

/*
 * The NetBIOS VERDICT — result.netbiosOutcome.
 *
 * The lookup stops early three ways: its host cap, its wall-clock budget, and
 * a UDP socket that failed. Before the verdict was carried out of
 * attachNetbiosNames, each of those was a line in the probe log and nothing
 * else: the scan's status message said nothing, and a Review dialog full of
 * bare addresses looked exactly like a network where nobody answers UDP 137.
 * FetchScans.buildHostNamingNote reads this object to say otherwise, so every
 * field here is something a sentence on the status message is built from.
 */

// A ping-only host, as the sweep reports one.
function pingOnly(ipAddress: string): DiscoveredHost {
  return { ipAddress: ipAddress, snmpReachable: false };
}

// The verdict of a lookup that had nobody to ask.
const UNASKED_OUTCOME: NetbiosNamingOutcome = {
  resolvedCount: 0,
  unnamedAddressCount: 0,
  namedAddressCount: 0,
  isHostCapReached: false,
  isTimeBudgetExhausted: false,
};

// Makes the NetBIOS seam reject with exactly `thrown`, whatever it is.
function mockNetbiosThrowing(thrown: unknown): void {
  jest
    .spyOn(SubnetScanner, "resolveNetbiosNames")
    .mockImplementation(async (): Promise<NetbiosNameResolution> => {
      throw thrown;
    });
}

describe("result.netbiosOutcome — present exactly when the lookup ran", () => {
  it("is set on an opted-in ICMP-only sweep, and agrees with netbiosResolvedCount", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockNetbios({ "10.0.0.1": "reg01" });

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(result.netbiosOutcome).toEqual({
      resolvedCount: 1,
      unnamedAddressCount: 2,
      namedAddressCount: 1,
      eligibleAddressCount: 2,
      queriedAddressCount: 2,
      isHostCapReached: false,
      maxHosts: 2000,
      isTimeBudgetExhausted: false,
      totalBudgetInMs: 30000,
    });
    /*
     * Two fields that say the same thing must not drift: the count is what
     * the probe log prints, the outcome is what the status message prints.
     */
    expect(result.netbiosResolvedCount).toBe(
      result.netbiosOutcome?.resolvedCount,
    );
    // A lookup that simply worked carries no failure of any kind.
    expect(result.netbiosOutcome?.failureReason).toBeUndefined();
    expect(result.netbiosOutcome?.error).toBeUndefined();
  });

  it("is set on an opted-in SNMP sweep, counting only the hosts SNMP left unnamed", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    mockSnmp({ "10.0.0.1": "core-switch-01" });
    mockNetbios({ "10.0.0.3": "cam-lobby" });

    const result: SubnetScanResult = await sweep(withSnmp(true));

    expect(result.netbiosOutcome).toMatchObject({
      resolvedCount: 1,
      unnamedAddressCount: 2,
      namedAddressCount: 1,
    });
  });

  it("is absent when the scan config has no flag, or says false, on either sweep path", async () => {
    /*
     * Absent is the statement "no lookup happened". A zeroed outcome would
     * instead say "it ran and every host was silent", which is a claim about
     * the network the probe never tested.
     */
    mockPingAlive(["10.0.0.1"]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.0.0.1": "reg01",
    });

    const configs: Array<SubnetScanConfig> = [
      icmpOnly(),
      icmpOnly(false),
      withSnmp(),
      withSnmp(false),
    ];

    for (const config of configs) {
      const result: SubnetScanResult = await sweep(config);

      expect(result.netbiosOutcome).toBeUndefined();
      // Reverse DNS ran regardless; only NetBIOS is opt-in.
      expect(result.reverseDnsOutcome).toBeDefined();
    }

    expect(netbios.asked).toEqual([]);
  });

  it("is absent for a truthy flag that is not the literal true", async () => {
    mockPingAlive(["10.0.0.1"]);
    mockNetbios({ "10.0.0.1": "reg01" });

    for (const value of ["true", 1, {}, "yes"]) {
      const result: SubnetScanResult = await sweep({
        cidr: SIX_HOSTS,
        isSnmpEnabled: false,
        isNetbiosLookupEnabled: value as unknown as boolean,
      });

      expect(result.netbiosOutcome).toBeUndefined();
    }
  });

  it("is absent on a global probe, even when the scan opted in", async () => {
    mockPingAlive(["10.0.0.1"]);
    jest.spyOn(DiscoveryNetbiosPolicy, "isGlobalProbe").mockReturnValue(true);
    mockNetbios({ "10.0.0.1": "reg01" });

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    /*
     * A global probe that reported "NetBIOS named 0 of 1 hosts" would be
     * telling the customer it sent a datagram it is forbidden to send.
     */
    expect(result.netbiosOutcome).toBeUndefined();
    expect(result.reverseDnsOutcome).toBeDefined();
  });

  it("is absent when SubnetScanner.scan is called directly, even with the flag on", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockNetbios({ "10.0.0.1": "reg01" });

    const result: SubnetScanResult = await SubnetScanner.scan(icmpOnly(true));

    expect(result.netbiosOutcome).toBeUndefined();
    expect(result.reverseDnsOutcome).toBeUndefined();
  });

  it("is absent when attachNetbiosNames itself rejects, and the sweep still returns", async () => {
    /*
     * The job's own catch: there is no verdict to carry, and inventing one
     * would put a sentence on the status message about a lookup whose result
     * nobody saw.
     */
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    jest
      .spyOn(SubnetScanner, "attachNetbiosNames")
      .mockRejectedValue(new Error("netbios blew up"));

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(result.discoveredHosts).toHaveLength(2);
    expect(result.netbiosOutcome).toBeUndefined();
    expect(result.reverseDnsOutcome).toBeDefined();
  });

  it("is zeroed, not absent, when every host already has a name", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockReverseDns({
      "10.0.0.1": "a.corp.example.com",
      "10.0.0.2": "b.corp.example.com",
    });
    const netbios: { asked: Array<Array<string>> } = mockNetbios(
      {},
      // Would read as a cut-short lookup if any of it leaked through.
      { resolution: { isTimeBudgetExhausted: true, isHostCapReached: true } },
    );

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(netbios.asked).toEqual([]);
    expect(result.netbiosOutcome).toEqual(UNASKED_OUTCOME);
    // Nobody was asked, so nothing may claim a cap, a budget or a query count.
    expect(result.netbiosOutcome?.eligibleAddressCount).toBeUndefined();
    expect(result.netbiosOutcome?.queriedAddressCount).toBeUndefined();
    expect(result.netbiosOutcome?.maxHosts).toBeUndefined();
    expect(result.netbiosOutcome?.totalBudgetInMs).toBeUndefined();
  });

  it("is zeroed, not absent, when the sweep found nothing", async () => {
    mockPingAlive([]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({});

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(netbios.asked).toEqual([]);
    expect(result.netbiosOutcome).toEqual(UNASKED_OUTCOME);
  });
});

describe("SubnetScanner.attachNetbiosNames — the counts in its verdict", () => {
  it("counts distinct unnamed addresses, treating blank sysName and dnsHostname as no name", async () => {
    /*
     * unnamedAddressCount is the denominator of "NetBIOS named X of N hosts".
     * Counting a host SNMP or DNS already named would make a lookup that
     * named everyone it asked look like a partial one; counting a repeated
     * address twice would do the same.
     */
    const netbios: { asked: Array<Array<string>> } = mockNetbios({});

    const hosts: Array<DiscoveredHost> = [
      { ipAddress: "10.0.0.1", snmpReachable: true, sysName: "core-switch" },
      { ipAddress: "10.0.0.2", snmpReachable: false, dnsHostname: "a.corp" },
      { ipAddress: "10.0.0.3", snmpReachable: true, sysName: "   " },
      { ipAddress: "10.0.0.4", snmpReachable: false, dnsHostname: "" },
      pingOnly("10.0.0.5"),
      pingOnly("10.0.0.5"),
    ];

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames(hosts);

    expect(netbios.asked).toEqual([
      ["10.0.0.3", "10.0.0.4", "10.0.0.5", "10.0.0.5"],
    ]);
    expect(outcome.unnamedAddressCount).toBe(3);
    expect(outcome.namedAddressCount).toBe(0);
    expect(outcome.resolvedCount).toBe(0);
  });

  it("counts named ADDRESSES distinctly and named ENTRIES as resolvedCount", async () => {
    mockNetbios({ "10.0.0.1": "twice", "10.0.0.2": "once" });

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames([
        pingOnly("10.0.0.1"),
        pingOnly("10.0.0.1"),
        pingOnly("10.0.0.2"),
        pingOnly("10.0.0.3"),
      ]);

    // resolvedCount keeps its legacy meaning: host entries stamped.
    expect(outcome.resolvedCount).toBe(3);
    expect(outcome.namedAddressCount).toBe(2);
    expect(outcome.unnamedAddressCount).toBe(3);
  });

  it("does not count a name that normalises to nothing, or a name for an address it was not given", async () => {
    mockNetbios({ "10.0.0.1": "BAD NAME", "10.0.0.99": "ghost" });

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames([
        pingOnly("10.0.0.1"),
        pingOnly("10.0.0.2"),
      ]);

    expect(outcome.resolvedCount).toBe(0);
    expect(outcome.namedAddressCount).toBe(0);
    expect(outcome.unnamedAddressCount).toBe(2);
  });

  it("copies eligible, queried, cap and budget figures from the resolution", async () => {
    /*
     * Deliberately NOT derivable from the host list: these come from the
     * resolver, which alone knows how many addresses its policy allowed and
     * how many it reached before it stopped.
     */
    mockNetbios(
      {},
      {
        resolution: {
          eligibleCount: 3,
          queriedCount: 2,
          maxHosts: 2,
          totalBudgetInMs: 45000,
        },
      },
    );

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames([
        pingOnly("10.0.0.1"),
        pingOnly("10.0.0.2"),
        pingOnly("10.0.0.3"),
        pingOnly("8.8.8.8"),
      ]);

    expect(outcome).toMatchObject({
      unnamedAddressCount: 4,
      eligibleAddressCount: 3,
      queriedAddressCount: 2,
      maxHosts: 2,
      totalBudgetInMs: 45000,
    });
  });

  it("keeps a reported zero as zero, not unknown", async () => {
    // "Queried nobody" is a finding; "did not say" is not.
    mockNetbios(
      {},
      { resolution: { eligibleCount: 0, queriedCount: 0, totalBudgetInMs: 0 } },
    );

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames([pingOnly("8.8.8.8")]);

    expect(outcome.eligibleAddressCount).toBe(0);
    expect(outcome.queriedAddressCount).toBe(0);
    expect(outcome.totalBudgetInMs).toBe(0);
  });

  it("reads a nonsense or missing numeric field as unknown, never as a number", async () => {
    /*
     * These figures are printed on the status message. "NetBIOS named 0 of
     * NaN hosts" or "capped at -1 hosts" would be worse than a sentence that
     * says less, and a string "5" is a double describing a different type.
     */
    const nonsense: Array<unknown> = [
      NaN,
      -1,
      Infinity,
      -Infinity,
      "5",
      null,
      undefined,
      {},
      true,
    ];

    for (const value of nonsense) {
      mockNetbios(
        { "10.0.0.1": "reg01" },
        {
          resolution: {
            eligibleCount: value,
            queriedCount: value,
            maxHosts: value,
            totalBudgetInMs: value,
          },
        },
      );

      const outcome: NetbiosNamingOutcome =
        await SubnetScanner.attachNetbiosNames([pingOnly("10.0.0.1")]);

      expect(outcome.eligibleAddressCount).toBeUndefined();
      expect(outcome.queriedAddressCount).toBeUndefined();
      expect(outcome.maxHosts).toBeUndefined();
      expect(outcome.totalBudgetInMs).toBeUndefined();
      // The counts it derives itself are unaffected by a bad resolution.
      expect(outcome.resolvedCount).toBe(1);
      expect(outcome.namedAddressCount).toBe(1);
      expect(outcome.unnamedAddressCount).toBe(1);
    }
  });

  it("floors a fractional figure rather than printing it", async () => {
    mockNetbios(
      {},
      {
        resolution: {
          eligibleCount: 3.9,
          queriedCount: 2.5,
          maxHosts: 2000.999,
          totalBudgetInMs: 30000.7,
        },
      },
    );

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames([pingOnly("10.0.0.1")]);

    expect(outcome.eligibleAddressCount).toBe(3);
    expect(outcome.queriedAddressCount).toBe(2);
    expect(outcome.maxHosts).toBe(2000);
    expect(outcome.totalBudgetInMs).toBe(30000);
  });
});

describe("SubnetScanner.attachNetbiosNames — the flags in its verdict", () => {
  it("carries isHostCapReached and isTimeBudgetExhausted when they are true", async () => {
    mockNetbios(
      { "10.0.0.1": "reg01" },
      { resolution: { isHostCapReached: true, isTimeBudgetExhausted: true } },
    );

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames([
        pingOnly("10.0.0.1"),
        pingOnly("10.0.0.2"),
      ]);

    expect(outcome.isHostCapReached).toBe(true);
    expect(outcome.isTimeBudgetExhausted).toBe(true);
    // A cut-short lookup still reports the names it did find.
    expect(outcome.resolvedCount).toBe(1);
  });

  it("reads a flag as false unless it is exactly true", async () => {
    /*
     * Either flag puts "stopped early" on the scan's status message. A double
     * that left the field out, or set it to 1, must not tell a customer their
     * lookup was cut short when it was not.
     */
    const notTrue: Array<unknown> = ["true", 1, {}, "yes", null, undefined];

    for (const value of notTrue) {
      mockNetbios(
        {},
        {
          resolution: {
            isHostCapReached: value,
            isTimeBudgetExhausted: value,
          },
        },
      );

      const outcome: NetbiosNamingOutcome =
        await SubnetScanner.attachNetbiosNames([pingOnly("10.0.0.1")]);

      expect(outcome.isHostCapReached).toBe(false);
      expect(outcome.isTimeBudgetExhausted).toBe(false);
    }
  });
});

describe("SubnetScanner.attachNetbiosNames — a failed socket in its verdict", () => {
  it("copies the resolver's failureReason, trimmed", async () => {
    mockNetbios(
      {},
      { resolution: { failureReason: "  bind EACCES 0.0.0.0:0 \n" } },
    );

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames([pingOnly("10.0.0.1")]);

    expect(outcome.failureReason).toBe("bind EACCES 0.0.0.0:0");
    // A failed socket is the resolver's verdict, not a throw.
    expect(outcome.error).toBeUndefined();
  });

  it("keeps the names found before the socket failed", async () => {
    mockNetbios(
      { "10.0.0.1": "reg01" },
      { resolution: { failureReason: "socket closed", queriedCount: 1 } },
    );

    const hosts: Array<DiscoveredHost> = [
      pingOnly("10.0.0.1"),
      pingOnly("10.0.0.2"),
    ];

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames(hosts);

    expect(hosts[0]!.netbiosName).toBe("reg01");
    expect(outcome).toMatchObject({
      resolvedCount: 1,
      namedAddressCount: 1,
      unnamedAddressCount: 2,
      queriedAddressCount: 1,
      failureReason: "socket closed",
    });
  });

  it("reads a blank or non-string failureReason as no failure at all", async () => {
    /*
     * "NetBIOS lookups stopped because the probe's UDP socket failed ()" is
     * a sentence that accuses the socket of something and names nothing.
     */
    const notAReason: Array<unknown> = [
      "",
      "   ",
      "\n\t",
      42,
      { message: "socket error" },
      null,
      undefined,
      true,
    ];

    for (const value of notAReason) {
      mockNetbios({}, { resolution: { failureReason: value } });

      const outcome: NetbiosNamingOutcome =
        await SubnetScanner.attachNetbiosNames([pingOnly("10.0.0.1")]);

      expect(outcome.failureReason).toBeUndefined();
    }
  });
});

describe("SubnetScanner.attachNetbiosNames — when the lookup itself throws", () => {
  it("resolves with the error on the verdict, warns, and leaves the hosts as they were", async () => {
    mockNetbiosThrowing(new Error("socket factory exploded"));

    const hosts: Array<DiscoveredHost> = [
      pingOnly("10.0.0.1"),
      pingOnly("10.0.0.2"),
      pingOnly("10.0.0.2"),
    ];

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames(hosts);

    expect(outcome).toEqual({
      resolvedCount: 0,
      // Counted before the seam was called: the hosts it was about to ask.
      unnamedAddressCount: 2,
      namedAddressCount: 0,
      isHostCapReached: false,
      isTimeBudgetExhausted: false,
      error: "socket factory exploded",
    });
    expect(hosts).toHaveLength(3);
    for (const host of hosts) {
      expect(host).not.toHaveProperty("netbiosName");
    }
    expect(loggedLines(logger.warn)).toMatch(
      /NetBIOS enrichment failed.*socket factory exploded/,
    );
  });

  it("trims the error, and bounds it to 120 characters because it can reach the status message", async () => {
    mockNetbiosThrowing(new Error(`  ${"A".repeat(120)}TAIL-OF-A-STACK  `));

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames([pingOnly("10.0.0.1")]);

    expect(outcome.error).toBe("A".repeat(120));

    mockNetbiosThrowing(new Error("   bind failed   "));

    await expect(
      SubnetScanner.attachNetbiosNames([pingOnly("10.0.0.1")]),
    ).resolves.toMatchObject({ error: "bind failed" });
  });

  it("describes a thrown non-Error by its text", async () => {
    mockNetbiosThrowing("resolver said no");

    await expect(
      SubnetScanner.attachNetbiosNames([pingOnly("10.0.0.1")]),
    ).resolves.toMatchObject({ error: "resolver said no" });
  });

  it("says 'unknown error' when the throw carries no text", async () => {
    /*
     * An empty error would render as "NetBIOS lookups failed on this probe
     * ()." — and an undefined one would drop the error sentence entirely,
     * hiding that the lookup failed at all.
     */
    for (const thrown of ["", "   ", undefined, null, new Error("   ")]) {
      mockNetbiosThrowing(thrown);

      const outcome: NetbiosNamingOutcome =
        await SubnetScanner.attachNetbiosNames([pingOnly("10.0.0.1")]);

      expect(outcome.error).toBe("unknown error");
    }
  });

  it("counts the names already stamped when it throws part-way through stamping", async () => {
    /*
     * The verdict has to describe the hosts the caller is about to upload.
     * A throw after some hosts were named leaves those names on the hosts,
     * so reporting "named 0" would contradict the Review dialog.
     */
    const names: Map<string, string> = new Map<string, string>([
      ["10.0.0.1", "reg01"],
      ["10.0.0.3", "never-reached"],
    ]);
    const realGet: (key: string) => string | undefined = names.get.bind(names);

    names.get = (key: string): string | undefined => {
      if (key === "10.0.0.2") {
        throw new Error("name table corrupted");
      }

      return realGet(key);
    };

    mockNetbios({}, { resolution: { nameByIpAddress: names } });

    const hosts: Array<DiscoveredHost> = [
      pingOnly("10.0.0.1"),
      pingOnly("10.0.0.1"),
      pingOnly("10.0.0.2"),
      pingOnly("10.0.0.3"),
    ];

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames(hosts);

    expect(hosts[0]!.netbiosName).toBe("reg01");
    expect(hosts[1]!.netbiosName).toBe("reg01");
    expect(hosts[3]).not.toHaveProperty("netbiosName");
    expect(outcome).toMatchObject({
      resolvedCount: 2,
      namedAddressCount: 1,
      unnamedAddressCount: 3,
      error: "name table corrupted",
    });
  });

  it("counts every name when it throws after stamping them all", async () => {
    const resolution: NetbiosNameResolution = {
      nameByIpAddress: new Map<string, string>([
        ["10.0.0.1", "reg01"],
        ["10.0.0.2", "reg02"],
      ]),
      queriedCount: 2,
      skippedCount: 0,
      isTimeBudgetExhausted: false,
      isHostCapReached: false,
      eligibleCount: 2,
      maxHosts: 2000,
      totalBudgetInMs: 30000,
    };

    // Read only after every host has been stamped.
    Object.defineProperty(resolution, "isHostCapReached", {
      get: (): boolean => {
        throw new Error("flag getter exploded");
      },
    });

    jest
      .spyOn(SubnetScanner, "resolveNetbiosNames")
      .mockImplementation(async (): Promise<NetbiosNameResolution> => {
        return resolution;
      });

    const hosts: Array<DiscoveredHost> = [
      pingOnly("10.0.0.1"),
      pingOnly("10.0.0.2"),
    ];

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames(hosts);

    expect(hosts[1]!.netbiosName).toBe("reg02");
    expect(outcome).toMatchObject({
      resolvedCount: 2,
      namedAddressCount: 2,
      unnamedAddressCount: 2,
      isHostCapReached: false,
      error: "flag getter exploded",
    });
  });
});

describe("scanWithDeadline — a cut-short NetBIOS lookup keeps the sweep and says so", () => {
  it("a lookup that ran out of time returns every sweep host and carries the budget verdict", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    mockReverseDns({ "10.0.0.1": "gw.corp.example.com" });
    mockNetbios(
      { "10.0.0.2": "reg01" },
      {
        resolution: {
          isTimeBudgetExhausted: true,
          eligibleCount: 2,
          queriedCount: 1,
          totalBudgetInMs: 30000,
        },
      },
    );

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(
      result.discoveredHosts.map((host: DiscoveredHost) => {
        return host.ipAddress;
      }),
    ).toEqual(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    expect(hostAt(result, "10.0.0.2")?.netbiosName).toBe("reg01");
    expect(hostAt(result, "10.0.0.3")).not.toHaveProperty("netbiosName");
    expect(result.netbiosOutcome).toEqual({
      resolvedCount: 1,
      // The host reverse DNS named is not part of NetBIOS's denominator.
      unnamedAddressCount: 2,
      namedAddressCount: 1,
      eligibleAddressCount: 2,
      queriedAddressCount: 1,
      isHostCapReached: false,
      maxHosts: 2000,
      isTimeBudgetExhausted: true,
      totalBudgetInMs: 30000,
    });
    expect(result.netbiosResolvedCount).toBe(1);
    // And the reverse-DNS verdict travels beside it, over the whole sweep.
    expect(result.reverseDnsOutcome).toMatchObject({
      resolvedCount: 1,
      addressCount: 3,
      namedAddressCount: 1,
      isTimeBudgetExhausted: false,
      isReverseDnsAvailable: true,
    });
    expect(result.reverseDnsResolvedCount).toBe(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("a lookup that hit its host cap returns every sweep host and carries the cap verdict", async () => {
    mockPingAlive([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
      "10.0.0.4",
      "10.0.0.5",
      "10.0.0.6",
    ]);
    mockSnmp({ "10.0.0.1": "core-switch-01" });
    mockNetbios(
      { "10.0.0.2": "cam-lobby" },
      {
        resolution: {
          isHostCapReached: true,
          eligibleCount: 5,
          maxHosts: 3,
          queriedCount: 3,
        },
      },
    );

    const result: SubnetScanResult = await sweep(withSnmp(true));

    expect(result.discoveredHosts).toHaveLength(6);
    expect(hostAt(result, "10.0.0.1")?.sysName).toBe("core-switch-01");
    expect(hostAt(result, "10.0.0.2")?.netbiosName).toBe("cam-lobby");
    expect(result.netbiosOutcome).toMatchObject({
      resolvedCount: 1,
      unnamedAddressCount: 5,
      namedAddressCount: 1,
      eligibleAddressCount: 5,
      queriedAddressCount: 3,
      maxHosts: 3,
      isHostCapReached: true,
      isTimeBudgetExhausted: false,
    });
    expect(result.reverseDnsOutcome).toMatchObject({ addressCount: 6 });
  });

  it("carries both flags when the lookup hit the cap and then ran out of time", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    mockNetbios(
      {},
      {
        resolution: {
          isHostCapReached: true,
          isTimeBudgetExhausted: true,
          maxHosts: 2,
          queriedCount: 1,
        },
      },
    );

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(result.discoveredHosts).toHaveLength(3);
    expect(result.netbiosOutcome).toMatchObject({
      resolvedCount: 0,
      unnamedAddressCount: 3,
      isHostCapReached: true,
      isTimeBudgetExhausted: true,
    });
  });

  it("a lookup whose socket failed returns every sweep host and carries the reason", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockNetbios(
      {},
      {
        resolution: {
          failureReason: " bind EADDRINUSE 0.0.0.0:137 ",
          queriedCount: 0,
        },
      },
    );

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(result.discoveredHosts).toHaveLength(2);
    expect(result.netbiosOutcome).toMatchObject({
      resolvedCount: 0,
      unnamedAddressCount: 2,
      queriedAddressCount: 0,
      failureReason: "bind EADDRINUSE 0.0.0.0:137",
    });
    expect(result.netbiosOutcome?.error).toBeUndefined();
  });

  it("a lookup seam that rejects returns every sweep host with the error on the verdict", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockSnmp({ "10.0.0.1": "core-switch-01" });
    mockNetbiosThrowing(new Error("socket factory exploded"));

    const result: SubnetScanResult = await sweep(withSnmp(true));

    expect(result.discoveredHosts).toHaveLength(2);
    expect(result.netbiosOutcome).toEqual({
      resolvedCount: 0,
      unnamedAddressCount: 1,
      namedAddressCount: 0,
      isHostCapReached: false,
      isTimeBudgetExhausted: false,
      error: "socket factory exploded",
    });
    expect(result.netbiosResolvedCount).toBe(0);
    expect(result.reverseDnsOutcome).toMatchObject({ addressCount: 2 });
    expect(loggedLines(logger.warn)).toMatch(/socket factory exploded/);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

/*
 * Helpers for the sections below, which follow the verdict all the way to the
 * scan row: what runScan uploads is what the operator reads.
 */

// An ICMP-only scan row that opted in to NetBIOS, as the server hands it over.
function netbiosScanRow(): NetworkDeviceDiscoveryScan {
  return {
    id: ObjectID.generate(),
    cidr: "10.18.167.0/24",
    isSnmpEnabled: false,
    snmpVersion: null,
    snmpCommunityString: null,
    snmpPort: null,
    isNetbiosLookupEnabled: true,
  } as unknown as NetworkDeviceDiscoveryScan;
}

// Replaces the sweep with one that found exactly `ipAddresses`, ping only.
function mockIcmpSweepFinding(ipAddresses: Array<string>): void {
  jest.spyOn(SubnetScanner, "scan").mockResolvedValue({
    discoveredHosts: ipAddresses.map((ipAddress: string) => {
      return pingOnly(ipAddress);
    }),
    scannedHostCount: 254,
    scannedPorts: [],
    responderCountByConfigId: {},
    respondedToPingCount: ipAddresses.length,
    snmpErrorHostCount: 0,
    icmpFilteredFallbackHostCount: 0,
    isIcmpOnlySweep: true,
    isIcmpSweepIncomplete: false,
  } as SubnetScanResult);
}

// The body of the final (success: true, not partial) result upload.
function finalUploadBody(
  fetchSpy: ReturnType<typeof jest.spyOn>,
): JSONObject | undefined {
  return (fetchSpy.mock.calls as Array<Array<JSONObject>>)
    .map((call: Array<JSONObject>) => {
      return call[0]!["data"] as JSONObject;
    })
    .find((body: JSONObject) => {
      return body["success"] === true && body["isPartial"] !== true;
    });
}

/*
 * A name table whose lookup for `throwingAddress` throws `thrown`, so a test
 * can stop attachNetbiosNames part-way through stamping names onto hosts.
 */
function nameTableThrowingAt(
  nameByIpAddress: Record<string, string>,
  throwingAddress: string,
  thrown: unknown,
): Map<string, string> {
  const names: Map<string, string> = new Map<string, string>(
    Object.entries(nameByIpAddress),
  );
  const realGet: (key: string) => string | undefined = names.get.bind(names);

  names.get = (key: string): string | undefined => {
    if (key === throwingAddress) {
      throw thrown;
    }

    return realGet(key);
  };

  return names;
}

describe("netbiosOutcome.error — a rejection that carries no text says 'unknown error', whatever threw it", () => {
  /*
   * describeEnrichmentError used to fall back to String(error) whenever the
   * message was falsy. For an Error with an EMPTY message that is the class
   * name, so `new Error("")` put "NetBIOS lookups failed on this probe
   * (Error)." on the status message — naming nothing, while reading like a
   * reason — and `new Error(" ")` said "(unknown error)" about the same
   * nothing. An Error's message is now used even when empty.
   */

  // A subclass whose String() form is its own name, not "Error".
  class NetbiosSocketError extends Error {
    public constructor(message: string) {
      super(message);
      this.name = "NetbiosSocketError";
    }
  }

  it("for an Error of any class with an empty or blank message", async () => {
    const textless: Array<Error> = [
      new Error(""),
      new Error("  "),
      new TypeError(""),
      new RangeError("\n\t"),
      new NetbiosSocketError(""),
    ];

    for (const thrown of textless) {
      // What the old fallback would have printed: never blank, never a reason.
      expect(String(thrown).trim()).not.toBe("");

      mockPingAlive(["10.0.0.1", "10.0.0.2"]);
      mockNetbiosThrowing(thrown);

      const result: SubnetScanResult = await sweep(icmpOnly(true));

      expect(result.discoveredHosts).toHaveLength(2);
      expect(result.netbiosOutcome).toEqual({
        resolvedCount: 0,
        unnamedAddressCount: 2,
        namedAddressCount: 0,
        isHostCapReached: false,
        isTimeBudgetExhausted: false,
        error: "unknown error",
      });
      // The lookup still ran, so the tally is zero rather than absent.
      expect(result.netbiosResolvedCount).toBe(0);
    }
  });

  it("uses an Error's own message, trimmed, rather than its 'Class: message' form", async () => {
    mockPingAlive(["10.0.0.1"]);

    mockNetbiosThrowing(new TypeError("  bind EACCES 0.0.0.0:0  "));
    expect((await sweep(icmpOnly(true))).netbiosOutcome?.error).toBe(
      "bind EACCES 0.0.0.0:0",
    );

    mockNetbiosThrowing(new NetbiosSocketError("send EPERM"));
    expect((await sweep(icmpOnly(true))).netbiosOutcome?.error).toBe(
      "send EPERM",
    );
  });

  it("uses a rejected string as the reason, trimmed, and 'unknown error' for a blank one", async () => {
    mockPingAlive(["10.0.0.1"]);

    const cases: Array<{ thrown: unknown; error: string }> = [
      { thrown: "resolver said no", error: "resolver said no" },
      { thrown: "\t resolver said no \n", error: "resolver said no" },
      { thrown: "", error: "unknown error" },
      { thrown: "   ", error: "unknown error" },
    ];

    for (const { thrown, error } of cases) {
      mockNetbiosThrowing(thrown);

      const result: SubnetScanResult = await sweep(icmpOnly(true));

      expect(result.netbiosOutcome?.error).toBe(error);
    }
  });

  it("says 'unknown error' for a rejection with undefined or null, and uses a number's text", async () => {
    /*
     * undefined is the case that matters most: an outcome whose error is
     * undefined carries no error sentence at all, so the one lookup that
     * failed outright would read on the status message as one that simply
     * worked.
     */
    mockPingAlive(["10.0.0.1"]);

    const cases: Array<{ thrown: unknown; error: string }> = [
      { thrown: undefined, error: "unknown error" },
      { thrown: null, error: "unknown error" },
      { thrown: 42, error: "42" },
    ];

    for (const { thrown, error } of cases) {
      mockNetbiosThrowing(thrown);

      const result: SubnetScanResult = await sweep(icmpOnly(true));

      expect(result.netbiosOutcome?.error).toBe(error);
    }
  });

  it("puts '(unknown error)' on the uploaded status message, never '(Error)'", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const fetchSpy = jest
      .spyOn(API, "fetch")
      .mockResolvedValue({ data: [] } as never);
    mockIcmpSweepFinding(["10.18.167.31", "10.18.167.32"]);
    mockNetbiosThrowing(new Error(""));

    await runScan(netbiosScanRow());

    const statusMessage: string = String(
      finalUploadBody(fetchSpy)?.["statusMessage"],
    );

    expect(statusMessage).toBe(
      "Swept 254 hosts with ICMP ping only (Check SNMP is off for this scan): 2 answered ping. " +
        "NetBIOS lookups failed on this probe (unknown error).",
    );
    expect(statusMessage).not.toContain("(Error)");
  });
});

describe("netbiosOutcome.failureReason — read through the shared reason helper on the success path", () => {
  /*
   * The resolver's socket failure is copied by the same readReason helper
   * reverse DNS uses: a non-blank string, trimmed at both ends, or undefined.
   * It is quoted on the status message, so surrounding whitespace would put
   * "( bind EACCES\n)" in front of the operator, and a non-string would be
   * printed as "[object Object]" or "42".
   */

  it("trims surrounding whitespace of every kind, and keeps the whitespace inside the reason", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);

    const cases: Array<{ raw: string; reason: string }> = [
      {
        raw: " \t bind EACCES 0.0.0.0:137 \r\n",
        reason: "bind EACCES 0.0.0.0:137",
      },
      { raw: " socket closed ", reason: "socket closed" },
      { raw: "  send  EPERM\t10.0.0.2  ", reason: "send  EPERM\t10.0.0.2" },
    ];

    for (const { raw, reason } of cases) {
      mockNetbios(
        { "10.0.0.1": "reg01" },
        { resolution: { failureReason: raw, queriedCount: 1 } },
      );

      const result: SubnetScanResult = await sweep(icmpOnly(true));

      expect(result.netbiosOutcome).toEqual({
        resolvedCount: 1,
        unnamedAddressCount: 2,
        namedAddressCount: 1,
        eligibleAddressCount: 2,
        queriedAddressCount: 1,
        isHostCapReached: false,
        maxHosts: 2000,
        isTimeBudgetExhausted: false,
        totalBudgetInMs: 30000,
        failureReason: reason,
      });
      // A socket failure the resolver reported is a verdict, not a throw.
      expect(result.netbiosOutcome?.error).toBeUndefined();
      // And it costs no host the name it did get.
      expect(hostAt(result, "10.0.0.1")?.netbiosName).toBe("reg01");
    }
  });

  it("reads a non-string reason as no reason, even one that would print as text", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);

    const notAString: Array<unknown> = [
      42,
      0,
      NaN,
      { message: "bind EACCES" },
      {
        toString: (): string => {
          return "bind EACCES";
        },
      },
      new Error("bind EACCES"),
      ["bind EACCES"],
      // A String wrapper object is not a string either.
      new String("bind EACCES"),
    ];

    for (const value of notAString) {
      mockNetbios(
        { "10.0.0.1": "reg01" },
        { resolution: { failureReason: value } },
      );

      const result: SubnetScanResult = await sweep(icmpOnly(true));

      expect(result.netbiosOutcome?.failureReason).toBeUndefined();
      // The rest of the verdict is read as if the field were simply absent.
      expect(result.netbiosOutcome).toMatchObject({
        resolvedCount: 1,
        namedAddressCount: 1,
        unnamedAddressCount: 2,
      });
      expect(result.netbiosOutcome?.error).toBeUndefined();
    }
  });

  it("reads a reason exactly as reverse DNS reads the same raw value", async () => {
    /*
     * One helper, two passes: the same raw reason on both seams must come out
     * the same on both verdicts, or the two halves of one naming note would
     * quote a reason differently.
     */
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);

    const cases: Array<{ raw: unknown; reason: string | undefined }> = [
      {
        raw: "  ESERVFAIL 10.in-addr.arpa \n",
        reason: "ESERVFAIL 10.in-addr.arpa",
      },
      { raw: "ECONNREFUSED", reason: "ECONNREFUSED" },
      { raw: " \t ", reason: undefined },
      { raw: 42, reason: undefined },
      { raw: { message: "ETIMEOUT" }, reason: undefined },
    ];

    for (const { raw, reason } of cases) {
      jest
        .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
        .mockImplementation(async (): Promise<ReverseDnsResolution> => {
          return {
            hostnameByIpAddress: new Map<string, string>(),
            isReverseDnsAvailable: true,
            isTimeBudgetExhausted: false,
            lookedUpCount: 2,
            notLookedUpCount: 0,
            totalBudgetInMs: 60000,
            failureReason: raw,
          } as ReverseDnsResolution;
        });
      mockNetbios({}, { resolution: { failureReason: raw } });

      const result: SubnetScanResult = await sweep(icmpOnly(true));

      expect(result.netbiosOutcome?.failureReason).toBe(reason);
      expect(result.reverseDnsOutcome?.failureReason).toBe(reason);
    }
  });
});

describe("SubnetScanner.attachNetbiosNames — the recount when it throws after stamping names", () => {
  /*
   * The catch does not trust the counters it was building: it recounts the
   * names that are actually on the hosts, because those hosts are uploaded
   * as they are. Each case below stops the pass at a different point after
   * at least one name was stamped.
   */

  it("counts the names stamped before a host that could not take one", async () => {
    /*
     * A frozen host entry throws on assignment in strict mode — a TypeError
     * from the runtime itself, not from a test double's table.
     */
    mockNetbios(
      { "10.0.0.1": "reg01", "10.0.0.2": "reg02", "10.0.0.3": "reg03" },
      { resolution: { isHostCapReached: true, isTimeBudgetExhausted: true } },
    );

    const hosts: Array<DiscoveredHost> = [
      pingOnly("10.0.0.1"),
      Object.freeze(pingOnly("10.0.0.2")),
      pingOnly("10.0.0.3"),
    ];

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames(hosts);

    expect(hosts[0]!.netbiosName).toBe("reg01");
    expect(hosts[1]).not.toHaveProperty("netbiosName");
    expect(hosts[2]).not.toHaveProperty("netbiosName");
    /*
     * Exactly: the throw came before the resolution's flags and figures were
     * read, so none of them may appear — "cut short by its cap" would be a
     * claim nothing on this path checked.
     */
    expect(outcome).toEqual({
      resolvedCount: 1,
      unnamedAddressCount: 3,
      namedAddressCount: 1,
      isHostCapReached: false,
      isTimeBudgetExhausted: false,
      error: expect.stringMatching(/not extensible/),
    });
  });

  it("recounts stamped names and says 'unknown error' when the throw carries no text", async () => {
    mockNetbios(
      {},
      {
        resolution: {
          nameByIpAddress: nameTableThrowingAt(
            { "10.0.0.1": "reg01", "10.0.0.2": "reg02", "10.0.0.4": "reg04" },
            "10.0.0.3",
            new TypeError(""),
          ),
        },
      },
    );

    const hosts: Array<DiscoveredHost> = [
      pingOnly("10.0.0.1"),
      pingOnly("10.0.0.2"),
      pingOnly("10.0.0.2"),
      pingOnly("10.0.0.3"),
      pingOnly("10.0.0.4"),
    ];

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames(hosts);

    expect(hosts[2]!.netbiosName).toBe("reg02");
    expect(hosts[4]).not.toHaveProperty("netbiosName");
    expect(outcome).toEqual({
      // Three entries, two distinct addresses.
      resolvedCount: 3,
      unnamedAddressCount: 4,
      namedAddressCount: 2,
      isHostCapReached: false,
      isTimeBudgetExhausted: false,
      error: "unknown error",
    });
  });

  it("keeps what was already read off the resolution when the throw is the last read", async () => {
    /*
     * failureReason is read last. A throw there lands after every flag and
     * figure was copied, and those were read from a real resolution, so the
     * verdict keeps them beside the recount and the error.
     */
    const resolution: NetbiosNameResolution = {
      nameByIpAddress: new Map<string, string>([
        ["10.0.0.1", "reg01"],
        ["10.0.0.2", "reg02"],
      ]),
      queriedCount: 2,
      skippedCount: 0,
      isTimeBudgetExhausted: true,
      isHostCapReached: false,
      eligibleCount: 3,
      maxHosts: 2000,
      totalBudgetInMs: 30000,
    };

    Object.defineProperty(resolution, "failureReason", {
      get: (): string => {
        throw new Error("  reason getter exploded  ");
      },
    });

    jest
      .spyOn(SubnetScanner, "resolveNetbiosNames")
      .mockImplementation(async (): Promise<NetbiosNameResolution> => {
        return resolution;
      });

    const hosts: Array<DiscoveredHost> = [
      pingOnly("10.0.0.1"),
      pingOnly("10.0.0.2"),
      pingOnly("10.0.0.3"),
    ];

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames(hosts);

    expect(outcome).toEqual({
      resolvedCount: 2,
      unnamedAddressCount: 3,
      namedAddressCount: 2,
      eligibleAddressCount: 3,
      queriedAddressCount: 2,
      isHostCapReached: false,
      maxHosts: 2000,
      isTimeBudgetExhausted: true,
      totalBudgetInMs: 30000,
      error: "reason getter exploded",
    });
    // The read that threw produced no reason.
    expect(outcome.failureReason).toBeUndefined();
  });

  it("recounts only the hosts this pass was asking about, not a host SNMP or DNS already named", async () => {
    /*
     * A host with a sysName or a PTR name was never handed to NetBIOS, so a
     * netbiosName it happens to carry is not this pass's doing, and counting
     * it would make the recount claim names the pass never found.
     */
    mockNetbios(
      {},
      {
        resolution: {
          nameByIpAddress: nameTableThrowingAt(
            { "10.0.0.3": "reg03", "10.0.0.4": "reg04" },
            "10.0.0.4",
            new Error("name table corrupted"),
          ),
        },
      },
    );

    const hosts: Array<DiscoveredHost> = [
      {
        ipAddress: "10.0.0.1",
        snmpReachable: true,
        sysName: "core-switch-01",
        netbiosName: "carried-over",
      },
      {
        ipAddress: "10.0.0.2",
        snmpReachable: false,
        dnsHostname: "gw.corp.example.com",
        netbiosName: "carried-over",
      },
      pingOnly("10.0.0.3"),
      pingOnly("10.0.0.4"),
    ];

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames(hosts);

    expect(outcome).toEqual({
      resolvedCount: 1,
      unnamedAddressCount: 2,
      namedAddressCount: 1,
      isHostCapReached: false,
      isTimeBudgetExhausted: false,
      error: "name table corrupted",
    });
  });

  it("through scanWithDeadline, the recount and netbiosResolvedCount agree with the hosts returned", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    mockNetbios(
      {},
      {
        resolution: {
          nameByIpAddress: nameTableThrowingAt(
            { "10.0.0.1": "reg01", "10.0.0.3": "never-reached" },
            "10.0.0.2",
            new Error("name table corrupted"),
          ),
        },
      },
    );

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    const namedHostCount: number = result.discoveredHosts.filter(
      (host: DiscoveredHost) => {
        return host.netbiosName !== undefined;
      },
    ).length;

    expect(namedHostCount).toBe(1);
    expect(hostAt(result, "10.0.0.1")?.netbiosName).toBe("reg01");
    expect(hostAt(result, "10.0.0.3")).not.toHaveProperty("netbiosName");
    expect(result.netbiosOutcome).toEqual({
      resolvedCount: namedHostCount,
      unnamedAddressCount: 3,
      namedAddressCount: 1,
      isHostCapReached: false,
      isTimeBudgetExhausted: false,
      error: "name table corrupted",
    });
    expect(result.netbiosResolvedCount).toBe(namedHostCount);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("through runScan, uploads the stamped name, logs the recount, and reports the failure", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const fetchSpy = jest
      .spyOn(API, "fetch")
      .mockResolvedValue({ data: [] } as never);
    mockIcmpSweepFinding(["10.18.167.31", "10.18.167.32", "10.18.167.33"]);
    mockNetbios(
      {},
      {
        resolution: {
          nameByIpAddress: nameTableThrowingAt(
            { "10.18.167.31": "reg01", "10.18.167.33": "never-reached" },
            "10.18.167.32",
            new Error("name table corrupted."),
          ),
        },
      },
    );

    await runScan(netbiosScanRow());

    const body: JSONObject | undefined = finalUploadBody(fetchSpy);

    expect(body?.["discoveredDevices"]).toEqual([
      { ipAddress: "10.18.167.31", snmpReachable: false, netbiosName: "reg01" },
      { ipAddress: "10.18.167.32", snmpReachable: false },
      { ipAddress: "10.18.167.33", snmpReachable: false },
    ]);
    // The probe log's tally is the recount, matching the upload above.
    expect(loggedLines(logger.debug)).toMatch(/, 1 named by NetBIOS/);
    // The reason is quoted without its trailing period, so no "..).".
    expect(body?.["statusMessage"]).toBe(
      "Swept 254 hosts with ICMP ping only (Check SNMP is off for this scan): 3 answered ping. " +
        "NetBIOS lookups failed on this probe (name table corrupted).",
    );
  });
});
